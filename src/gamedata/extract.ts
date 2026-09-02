/**
 * Game-data extraction, shared by every place the editor can get its graphics from: the
 * Node scripts (`scripts/extract-*.mjs`), the browser (Help ▸ Game Data…, in a worker) and
 * the desktop build's first run. The input is a `ReadMember` over the MPQ archives; the
 * output is a map of file paths — the same paths `public/` holds and the loaders fetch
 * (`tileset/badlands.cv5`, `arr/units.dat`, `unit/…/marine.grp`, the two manifests) — to
 * bytes. Nothing here touches a file system or the network.
 *
 * This module imports only `iscript.ts`, which has no imports of its own, so Node can
 * run it under its built-in type stripping without a build step. Keep it that way: the
 * import specifiers carry the `.ts` extension for the same reason.
 */
import { ANIM_COUNT_BY_TYPE, decodeIscript, IMAGE_SPAWN_OPS, Op, walkAnimation } from "../formats/dat/iscript.ts";

/** The member from whichever archive has it (later archives win), or null when none does. */
export type ReadMember = (member: string) => Uint8Array | null;

/** `fraction` is 0..1 within the extraction; `label` names the current step. */
export type ExtractProgress = (fraction: number, label: string) => void;

export const TILESET_NAMES = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"] as const;
const REQUIRED = ["cv5", "vf4", "vr4", "wpe"];
const OPTIONAL = ["vx4", "vx4ex"];
/** Effect remap tables, `tileset\<name>\<table>.pcx`, written as `<name>.<table>.pcx`. */
const REMAPS = ["ofire", "gfire", "bfire", "bexpl"];
/** Per-tileset files under `tileset\<name>\`, written as `<name>.<file>`. */
const SUBFILES = ["dddata.bin"];
/** Files shared by every tileset, written under their own name. */
const SHARED: [member: string, file: string][] = [["rez\\stat_txt.tbl", "stat_txt.tbl"]];

export interface TilesetManifest {
  [name: string]: { complete: boolean; files: string[] } | string[];
  shared: string[];
}

export interface TilesetExtraction {
  files: Map<string, Uint8Array>;
  manifest: TilesetManifest;
  complete: string[];
  incomplete: string[];
}

const encoder = new TextEncoder();
const json = (value: unknown) => encoder.encode(JSON.stringify(value, null, 2) + "\n");

/** The tileset half: `tileset/<name>.<ext>` per tileset plus `tileset/manifest.json`. */
export function extractTilesets(read: ReadMember, progress?: ExtractProgress): TilesetExtraction {
  const files = new Map<string, Uint8Array>();
  const have = new Map<string, string[]>();
  TILESET_NAMES.forEach((name, i) => {
    progress?.(i / TILESET_NAMES.length, `Tileset · ${name}`);
    const got: string[] = [];
    const take = (member: string, ext: string) => {
      const data = read(member);
      if (!data) return;
      files.set(`tileset/${name}.${ext}`, data);
      got.push(ext);
    };
    for (const ext of [...REQUIRED, ...OPTIONAL]) take(`tileset\\${name}.${ext}`, ext);
    for (const table of REMAPS) take(`tileset\\${name}\\${table}.pcx`, `${table}.pcx`);
    for (const file of SUBFILES) take(`tileset\\${name}\\${file}`, file);
    have.set(name, got);
  });
  const shared: string[] = [];
  for (const [member, file] of SHARED) {
    const data = read(member);
    if (!data) continue;
    files.set(`tileset/${file}`, data);
    shared.push(file);
  }

  const manifest = {} as TilesetManifest;
  const complete: string[] = [];
  const incomplete: string[] = [];
  for (const name of TILESET_NAMES) {
    const got = have.get(name)!;
    const ok = REQUIRED.every((ext) => got.includes(ext)) && (got.includes("vx4") || got.includes("vx4ex"));
    manifest[name] = { complete: ok, files: got };
    (ok ? complete : incomplete).push(name);
  }
  manifest.shared = shared;
  files.set("tileset/manifest.json", json(manifest));
  progress?.(1, "Tilesets");
  return { files, manifest, complete, incomplete };
}

/* ── Units ──────────────────────────────────────────────── */

const UNIT_COUNT = 228;
const SPRITE_COUNT = 517;
const IMAGE_COUNT = 999;
/** The Brood War units.dat; the original game's is shorter and the decoder does not take it. */
const UNITS_DAT_SIZE = 19876;
/** Tables the unit renderer cannot start without. MPQ paths, as the game names them. */
export const UNIT_TABLES = [
  "arr\\units.dat", "arr\\weapons.dat", "arr\\upgrades.dat", "arr\\techdata.dat", "arr\\flingy.dat", "arr\\sprites.dat", "arr\\images.dat", "arr\\images.tbl",
  "game\\tunit.pcx", "scripts\\iscript.bin",
];
/** Images the engine creates without an opcode: damage flames/sparks/blood (450–493) and geyser smoke (430–439). */
const ENGINE_IMAGES = [...Array.from({ length: 44 }, (_, i) => 450 + i), ...Array.from({ length: 10 }, (_, i) => 430 + i)];

export interface UnitManifest {
  images: number[];
  grps: string[];
  overlays: string[];
  missing: string[];
}

export interface UnitExtraction {
  files: Map<string, Uint8Array>;
  manifest: UnitManifest;
}

export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractError";
  }
}

/** An MPQ member path as the loaders fetch it: forward slashes, lower case. */
export const assetPath = (member: string) => member.toLowerCase().replaceAll("\\", "/");

/**
 * The unit half: the tables, then every GRP and `.lo` file reachable from the 228 unit
 * types and the 517 sprites through their iscripts (the walk is what decides which of the
 * archive's thousands of graphics ship), plus `unit/manifest.json`. Throws `ExtractError`
 * when a table is missing or units.dat is not the Brood War layout — the archives are the
 * wrong ones, and nothing downstream would work.
 */
export function extractUnits(read: ReadMember, progress?: ExtractProgress): UnitExtraction {
  progress?.(0, "Reading the unit tables");
  const tables = new Map<string, Uint8Array>();
  for (const member of UNIT_TABLES) {
    const data = read(member);
    if (!data) throw new ExtractError(`${member} is missing from the archives.`);
    tables.set(member, data);
  }
  const units = tables.get("arr\\units.dat")!;
  if (units.length !== UNITS_DAT_SIZE) {
    throw new ExtractError(`units.dat is ${units.length} bytes; expected the Brood War layout (${UNITS_DAT_SIZE}). Is BrooDat.mpq present?`);
  }

  /*
   * The walk from a unit to its picture, kept in sync with src/formats/dat/dat.ts:
   *   units.dat graphics (u8, offset 0) → flingy.dat sprite (u16, offset 0)
   *   → sprites.dat image (u16, offset 0) → images.dat grp (u32, offset 0, 1-based into images.tbl)
   * Turrets and the like are units themselves, so walking all 228 covers subunits too.
   */
  const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
  const u32 = (b: Uint8Array, o: number) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;
  const flingy = tables.get("arr\\flingy.dat")!;
  const sprites = tables.get("arr\\sprites.dat")!;
  const images = tables.get("arr\\images.dat")!;
  const tbl = tables.get("arr\\images.tbl")!;
  const tblCount = u16(tbl, 0);
  const latin1 = new TextDecoder("latin1");
  const tblString = (i: number) => {
    const at = u16(tbl, 2 + i * 2);
    let end = at;
    while (end < tbl.length && tbl[end] !== 0) end++;
    return latin1.decode(tbl.subarray(at, end));
  };
  const tblEntry = (index1: number) => (index1 > 0 && index1 <= tblCount ? tblString(index1 - 1) : null);
  // images.dat fields, struct-of-arrays: grp u32 ×999, then 6 u8 columns, iscript u32, six .lo u32 columns.
  const imageGrp = (i: number) => tblEntry(u32(images, i * 4));
  const imageIscript = (i: number) => u32(images, IMAGE_COUNT * 10 + i * 4);
  const imageLos = (i: number) =>
    Array.from({ length: 6 }, (_, k) => tblEntry(u32(images, IMAGE_COUNT * (14 + k * 4) + i * 4))).filter((p): p is string => p !== null);

  const iscript = decodeIscript(tables.get("scripts\\iscript.bin")!);

  progress?.(0.05, "Walking the animation scripts");
  const reachable = new Set<number>();
  const todo = [...ENGINE_IMAGES];
  for (let unit = 0; unit < UNIT_COUNT; unit++) todo.push(u16(sprites, u16(flingy, units[unit] * 2) * 2));
  // Every sprites.dat entry too: the Sprites layer places any of them as a pure sprite, and
  // doodad overlays (tree canopies, Installation doors) are sprites no unit ever draws.
  for (let sprite = 0; sprite < SPRITE_COUNT; sprite++) todo.push(u16(sprites, sprite * 2));
  while (todo.length > 0) {
    const image = todo.pop()!;
    if (image >= IMAGE_COUNT || reachable.has(image)) continue;
    reachable.add(image);
    const header = iscript.headers.get(imageIscript(image));
    if (!header) continue;
    for (let anim = 0; anim < ANIM_COUNT_BY_TYPE[header.type]; anim++) {
      walkAnimation(iscript, header.id, anim, (ins) => {
        if (IMAGE_SPAWN_OPS.has(ins.op)) todo.push(ins.args[0]);
        else if (ins.op === Op.imgulnextid) todo.push(image + 1);
      });
    }
  }

  const grpPaths = new Set<string>();
  const loPaths = new Set<string>();
  for (const image of reachable) {
    const grp = imageGrp(image);
    if (grp) grpPaths.add(grp);
    for (const lo of imageLos(image)) loPaths.add(lo);
  }

  const files = new Map<string, Uint8Array>();
  const missing: string[] = [];
  for (const [member, data] of tables) files.set(assetPath(member), data);
  const wanted = [...grpPaths, ...loPaths].sort();
  wanted.forEach((rel, i) => {
    if (i % 25 === 0) progress?.(0.1 + (i / wanted.length) * 0.9, `Unit graphics · ${i} of ${wanted.length}`);
    const member = `unit\\${rel}`;
    const data = read(member);
    if (data) files.set(assetPath(member), data);
    else missing.push(member);
  });

  const manifest: UnitManifest = {
    images: [...reachable].sort((a, b) => a - b),
    grps: [...grpPaths].sort().map((p) => p.toLowerCase()),
    overlays: [...loPaths].sort().map((p) => p.toLowerCase()),
    missing,
  };
  files.set("unit/manifest.json", json(manifest));
  progress?.(1, "Unit graphics");
  return { files, manifest };
}

/* ── Both ───────────────────────────────────────────────── */

export interface GameDataExtraction {
  /** Every file, keyed by its path under `public/` (or the stored copy): both halves merged. */
  files: Map<string, Uint8Array>;
  tilesets: TilesetExtraction;
  units: UnitExtraction;
  /** Sum of the file sizes, for the UI. */
  bytes: number;
}

/** Everything the editor needs, in one pass. The tilesets come first (they are quick), then the units. */
export function extractGameData(read: ReadMember, progress?: ExtractProgress): GameDataExtraction {
  const tilesets = extractTilesets(read, (f, label) => progress?.(f * 0.15, label));
  const units = extractUnits(read, (f, label) => progress?.(0.15 + f * 0.85, label));
  const files = new Map([...tilesets.files, ...units.files]);
  let bytes = 0;
  for (const data of files.values()) bytes += data.length;
  return { files, tilesets, units, bytes };
}

/** A one-line account of what an extraction produced, for logs and the dialog. */
export function describeExtraction(x: GameDataExtraction): string {
  const parts = [`${x.tilesets.complete.length} of ${TILESET_NAMES.length} tilesets`, `${x.units.manifest.grps.length} unit graphics`];
  if (x.units.manifest.missing.length) parts.push(`${x.units.manifest.missing.length} missing`);
  return parts.join(", ");
}
