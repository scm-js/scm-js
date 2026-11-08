/**
 * Game-data extraction, shared by every place the editor can get its graphics from: the
 * Node scripts (`scripts/extract-*.mjs`), the browser (Help ▸ Game Data…, in a worker) and
 * the desktop build's first run. The input is a `ReadMember` over the MPQ archives; the
 * output is a map of file paths — the same paths `public/` holds and the loaders fetch
 * (`tileset/badlands.cv5`, `arr/units.dat`, `unit/…/marine.grp`, the two manifests) — to
 * bytes. Nothing here touches a file system or the network.
 *
 * This module imports only `iscript.ts`, `anim.ts` and the table codec (`table.ts`,
 * `schema.ts`), which import nothing but each other, so Node can run it under its built-in
 * type stripping without a build step. Keep it that way: the import specifiers carry the
 * `.ts` extension for the same reason. That is also
 * why its words are not translated here: the i18n module brings a JSON catalogue Node will
 * not import bare. Each step and error carries its English template and values beside the
 * English text (`ExtractText`), translated where they are shown (`install.ts#runWorker`); the
 * type-only import below is erased by Node and lets `scripts/i18n.mjs` see the `msg()` calls.
 */
import type { Params } from "../i18n";
import { animMember, animPath, imagesSharingGrp, slimAnim } from "../formats/dat/anim.ts";
import { decodeIscript, IMAGE_SPAWN_OPS, Op, walkAnimation } from "../formats/dat/iscript.ts";
import { datShape, decodeDat, type DatFile } from "../formats/dat/table.ts";
import type { DatTableName } from "../formats/dat/schema.ts";

/** The member from whichever archive has it (later archives win), or null when none does. */
export type ReadMember = (member: string) => Uint8Array | null;

/** A message as a template and its values, for a caller that translates (`translate(text, params)`). */
export interface ExtractText { text: string; params?: Params }

/** Marks a template for the catalogue (`i18n#msg`, which this module cannot import). */
const msg = (text: string) => text;
/** A template in English: `{name}` filled, the way `i18n#format` does it. */
const fill = (text: string, params?: Params) => (params ? text.replace(/\{(\w+)\}/g, (all, k: string) => (k in params ? String(params[k]) : all)) : text);

/** `fraction` is 0..1 within the extraction; `label` names the current step in English, `message` the same to translate. */
export type ExtractProgress = (fraction: number, label: string, message?: ExtractText) => void;

/** Reports a step as English and as its template; the progress callbacks of `remastered.ts`, `play.ts` and the worker use it too. */
export const reportStep = (progress: ExtractProgress | undefined, fraction: number, text: string, params?: Params) => progress?.(fraction, fill(text, params), { text, params });

export const TILESET_NAMES = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"] as const;
const REQUIRED = ["cv5", "vf4", "vr4", "wpe"];
const OPTIONAL = ["vx4", "vx4ex"];
/** Effect remap tables, `tileset\<name>\<table>.pcx`, written as `<name>.<table>.pcx`. */
const REMAPS = ["ofire", "gfire", "bfire", "bexpl"];
/** Per-tileset files under `tileset\<name>\`, written as `<name>.<file>`. */
const SUBFILES = ["dddata.bin"];
/**
 * StarCraft: Remastered's terrain at twice the size, one file per tileset, written as
 * `<name>.hd.vr4`. Only a Remastered installation has them (the archives answer null), and
 * a tileset is complete without one: they are what View ▸ Remastered Terrain draws from.
 */
const HD_TILES: [member: (name: string) => string, ext: string][] = [
  [(name) => `HD2\\tileset\\${name}.dds.vr4`, "hd.vr4"],
  // Where that tileset's water or lava is, for the effect that moves it: the table from
  // megatile to mask, and the masks. Space Platform and Installation have neither.
  [(name) => `HD2\\tileset\\${name}.tmsk`, "hd.tmsk"],
  [(name) => `HD2\\tileset\\${name}_mask.dds.grp`, "hd.mask"],
];
/** Files shared by every tileset, written under their own name. */
const SHARED: [member: string, file: string][] = [
  ["rez\\stat_txt.tbl", "stat_txt.tbl"],
  // What Remastered's water and lava are bent through (`formats/tileset/hd.ts`): two
  // sequences of ripple pictures and a square of noise. Only a Remastered installation has them.
  ["HD2\\effect\\water_normal_1.dds.grp", "water_large.hd.grp"],
  ["HD2\\effect\\water_normal_2.dds.grp", "water_fine.hd.grp"],
  ["HD2\\effect\\noise.dds", "heat_noise.hd.dds"],
];

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
    reportStep(progress, i / TILESET_NAMES.length, msg("Tileset · {name}"), { name });
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
    for (const [member, ext] of HD_TILES) take(member(name), ext);
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
  reportStep(progress, 1, msg("Tilesets"));
  return { files, manifest, complete, incomplete };
}

/* ── Units ──────────────────────────────────────────────── */

/**
 * The tables the extraction reads at the width the data set has them. A data set made with
 * GPTP's DatExtend carries `arr\<name>.datex` (every column at the full count, a few of them
 * widened); where it has one that is read and stored in place of the `.dat`, and the
 * manifest's `datex` says which. DatExtend's other layout keeps the `.dat` name and is told
 * by its length (`table.ts#datShape`).
 */
export const DATEX_TABLES: readonly DatTableName[] = ["units", "weapons", "flingy", "sprites", "images", "upgrades", "techdata", "orders", "portdata", "mapdata"];
/** A table's `.datex`, when the data set has one that is a whole number of GPTP's entries. */
function datexOf(read: ReadMember, table: DatTableName): Uint8Array | null {
  const data = read(`arr\\${table}.datex`);
  return data && data.length > 0 && datShape(table, data.length, `${table}.datex`) ? data : null;
}

/** Tables the unit renderer cannot start without. MPQ paths, as the game names them. */
export const UNIT_TABLES = [
  "arr\\units.dat", "arr\\weapons.dat", "arr\\upgrades.dat", "arr\\techdata.dat", "arr\\flingy.dat", "arr\\sprites.dat", "arr\\images.dat", "arr\\images.tbl",
  "game\\tunit.pcx", "scripts\\iscript.bin",
];
/**
 * Tables the editor never reads but copies when the archives have them — with the ones
 * above and `SOUND_TABLES`, every file the game keeps under `arr\` (fifteen in 1.16.1) —
 * for plugins that read or run the game's own files (`api.gameData.read`): OpenBW, behind
 * the Walkability plugin's game pathing, will not start without the orders table, and a mod
 * editor compares a mod's portraits and campaign map list against the game's rather than
 * counting them as new. A copy made before 2026-11-08 lacks `portdata` and `mapdata` (the
 * play set has `portdata` at the same path).
 */
export const EXTRA_TABLES = ["arr\\orders.dat", "arr\\portdata.dat", "arr\\portdata.tbl", "arr\\mapdata.dat", "arr\\mapdata.tbl"];
/**
 * The game's list of its own sounds — which file each sound id plays — copied when the
 * archives have it. Only the list: the sounds themselves stay where they are. The sound
 * picker (`editor/stockSounds.ts`) names them from this, and does without when a copy
 * made before 2026-10-12 lacks it.
 */
export const SOUND_TABLES = ["arr\\sfxdata.dat", "arr\\sfxdata.tbl"];
/**
 * The command card's icons and their colours, copied when the archives have them: the
 * pictures `api.graphics.icon` hands plugins for a unit type, an upgrade or a technology.
 * A copy made before 2026-10-15 lacks them, and plugins then show names.
 */
export const ICON_FILES = ["unit\\cmdbtns\\cmdicons.grp", "unit\\cmdbtns\\ticon.pcx"];
/**
 * Files a data set with more unit types than the game's 228 names and pictures them with,
 * copied when present and listed in the manifest's `optional`: the names of every type by
 * id, and a command card picture for each (GPTP's DatExtend convention).
 */
export const UNIT_EXTRA_FILES = ["rez\\unitnames.tbl", "unit\\cmdbtns\\uniticons.grp"];
/** Images the engine creates without an opcode: damage flames/sparks/blood (450–493) and geyser smoke (430–439). */
const ENGINE_IMAGES = [...Array.from({ length: 44 }, (_, i) => 450 + i), ...Array.from({ length: 10 }, (_, i) => 430 + i)];

export interface UnitManifest {
  images: number[];
  grps: string[];
  overlays: string[];
  missing: string[];
  /**
   * The images whose StarCraft: Remastered 2x sprite is here, written as
   * `unit/hd/main_NNN.anim`. Only an extraction from a Remastered installation has any;
   * absent from a manifest written before there were. An image that is not in the list
   * may still be drawn from the file of another image of its GRP that is (a few of those
   * are in this list without being in `images`, kept for that reason alone).
   */
  hd?: number[];
  /** The tables stored as `arr/<name>.datex` rather than `.dat` (`DATEX_TABLES`); absent when none is. */
  datex?: string[];
  /** The `UNIT_EXTRA_FILES` the copy has, as stored paths; absent when it has none. */
  optional?: string[];
}

export interface UnitExtraction {
  files: Map<string, Uint8Array>;
  manifest: UnitManifest;
}

export class ExtractError extends Error {
  /** The message as its template and values, for `translate`. */
  readonly text: ExtractText;

  constructor(text: string, params?: Params) {
    super(fill(text, params));
    this.name = "ExtractError";
    this.text = { text, params };
  }
}

/** An MPQ member path as the loaders fetch it: forward slashes, lower case. */
export const assetPath = (member: string) => member.toLowerCase().replaceAll("\\", "/");

/**
 * The unit half: the tables, then every GRP and `.lo` file reachable from the unit types
 * and the sprites (228 and 517 in the game's tables, as many as a data set's have) through their iscripts (the walk is what decides which of the
 * archive's thousands of graphics ship), plus `unit/manifest.json`. Throws `ExtractError`
 * when a table is missing, is no layout of its table, or units.dat is the original game's
 * — the archives are the wrong ones, and nothing downstream would work.
 */
export function extractUnits(read: ReadMember, progress?: ExtractProgress): UnitExtraction {
  reportStep(progress, 0, msg("Reading the unit tables"));
  const tables = new Map<string, Uint8Array>();
  const datex: string[] = [];
  for (const wanted of UNIT_TABLES) {
    const table = DATEX_TABLES.find((t) => wanted === `arr\\${t}.dat`);
    const extended = table ? datexOf(read, table) : null;
    const member = extended ? `arr\\${table}.datex` : wanted;
    const data = extended ?? read(wanted);
    if (!data) throw new ExtractError(msg("{member} is missing from the archives."), { member: wanted });
    if (extended) datex.push(table!);
    tables.set(member, data);
  }
  const table = (name: DatTableName): DatFile => {
    const member = datex.includes(name) ? `arr\\${name}.datex` : `arr\\${name}.dat`;
    const data = tables.get(member)!;
    try {
      return decodeDat(name, data, { fileName: member });
    } catch {
      // units.dat of no known width is most likely StarDat's alone: say what is wanted.
      if (member === "arr\\units.dat") throw new ExtractError(msg("units.dat is {size} bytes; expected the Brood War layout ({expected}). Is BrooDat.mpq present?"), { size: data.length, expected: 19876 });
      throw new ExtractError(msg("{member} is {size} bytes, which is no layout of the table the editor reads."), { member, size: data.length });
    }
  };
  const unitsDat = table("units");
  if (unitsDat.legacy) {
    throw new ExtractError(msg("units.dat is {size} bytes; expected the Brood War layout ({expected}). Is BrooDat.mpq present?"), { size: tables.get("arr\\units.dat")!.length, expected: 19876 });
  }

  /*
   * The walk from a unit to its picture, at whatever width the tables have:
   *   units.dat graphics → flingy.dat sprite → sprites.dat image → images.dat grp (1-based into images.tbl)
   * Turrets and the like are units themselves, so walking every type covers subunits too.
   */
  const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
  const flingy = table("flingy").columns.sprite;
  const spritesDat = table("sprites");
  const spriteImage = spritesDat.columns.image;
  const imagesDat = table("images");
  const imageCount = imagesDat.count;
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
  const ic = imagesDat.columns;
  const overlays = [ic.shield_overlay, ic.attack_overlay, ic.damage_overlay, ic.special_overlay, ic.landing_dust_overlay, ic.lift_off_dust_overlay];
  const imageGrp = (i: number) => tblEntry(ic.grp_file[i]);
  const imageIscript = (i: number) => ic.iscript_id[i];
  const imageLos = (i: number) => overlays.map((col) => tblEntry(col[i])).filter((p): p is string => p !== null);

  // A script this cannot read (a mod's compiler, opcodes a plugin added) costs the images
  // only it would have reached, not the extraction.
  let iscript: ReturnType<typeof decodeIscript> | null = null;
  try {
    iscript = decodeIscript(tables.get("scripts\\iscript.bin")!);
  } catch {
    iscript = null;
  }

  reportStep(progress, 0.05, msg("Walking the animation scripts"));
  const reachable = new Set<number>();
  const todo = [...ENGINE_IMAGES];
  const unitGraphics = unitsDat.columns.graphics;
  for (let unit = 0; unit < unitsDat.count; unit++) todo.push(spriteImage[flingy[unitGraphics[unit]]] ?? 0);
  // Every sprites.dat entry too: the Sprites layer places any of them as a pure sprite, and
  // doodad overlays (tree canopies, Installation doors) are sprites no unit ever draws.
  for (let sprite = 0; sprite < spritesDat.count; sprite++) todo.push(spriteImage[sprite]);
  while (todo.length > 0) {
    const image = todo.pop()!;
    if (image >= imageCount || reachable.has(image)) continue;
    reachable.add(image);
    const header = iscript?.headers.get(imageIscript(image));
    if (!iscript || !header) continue;
    for (let anim = 0; anim < header.anims.length; anim++) {
      try {
        walkAnimation(iscript, header.id, anim, (ins) => {
          if (IMAGE_SPAWN_OPS.has(ins.op)) todo.push(ins.args[0]);
          else if (ins.op === Op.imgulnextid) todo.push(image + 1);
        });
      } catch {
        // An opcode this does not know: the rest of that animation is not followed.
      }
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
  for (const member of [...EXTRA_TABLES, ...SOUND_TABLES, ...ICON_FILES]) {
    // orders.dat, like the tables above, at the width the data set has it.
    const table = DATEX_TABLES.find((t) => member === `arr\\${t}.dat`);
    const extended = table ? datexOf(read, table) : null;
    if (extended) { files.set(assetPath(`arr\\${table}.datex`), extended); datex.push(table!); continue; }
    const data = read(member);
    if (data) files.set(assetPath(member), data);
  }
  const optional: string[] = [];
  for (const member of UNIT_EXTRA_FILES) {
    const data = read(member);
    if (!data) continue;
    files.set(assetPath(member), data);
    optional.push(assetPath(member));
  }
  const wanted = [...grpPaths, ...loPaths].sort();
  wanted.forEach((rel, i) => {
    if (i % 25 === 0) reportStep(progress, 0.1 + (i / wanted.length) * 0.9, msg("Unit graphics · {done} of {total}"), { done: i, total: wanted.length });
    const member = `unit\\${rel}`;
    const data = read(member);
    if (data) files.set(assetPath(member), data);
    else missing.push(member);
  });

  // Remastered's own sprites for the same images, where the source has them (the archives
  // never do): the two layers the editor draws from, out of the seven the game keeps.
  const imageIds = [...reachable].sort((a, b) => a - b);
  const hd: number[] = [];
  imageIds.forEach((image, i) => {
    const data = read(animMember(image));
    if (!data) return;
    if (i % 25 === 0) reportStep(progress, 1, msg("Remastered sprites · {done} of {total}"), { done: i, total: imageIds.length });
    files.set(animPath(image), slimAnim(data));
    hd.push(image);
  });
  // An image with no file of its own is drawn from the file of another image of its GRP
  // (`imagesSharingGrp`). That one is usually reachable itself and already here; where it
  // is not, its file is taken too, under its own number, so the loader finds it there.
  const grpColumn = ic.grp_file;
  for (const image of imageIds) {
    if (files.has(animPath(image))) continue;
    for (const other of imagesSharingGrp(grpColumn, image)) {
      if (files.has(animPath(other))) break;
      const data = read(animMember(other));
      if (!data) continue;
      files.set(animPath(other), slimAnim(data));
      hd.push(other);
      break;
    }
  }
  hd.sort((a, b) => a - b);

  const manifest: UnitManifest = {
    images: imageIds,
    grps: [...grpPaths].sort().map((p) => p.toLowerCase()),
    overlays: [...loPaths].sort().map((p) => p.toLowerCase()),
    missing,
    ...(hd.length > 0 ? { hd } : {}),
    ...(datex.length > 0 ? { datex } : {}),
    ...(optional.length > 0 ? { optional } : {}),
  };
  files.set("unit/manifest.json", json(manifest));
  reportStep(progress, 1, msg("Unit graphics"));
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
  const tilesets = extractTilesets(read, (f, label, m) => progress?.(f * 0.15, label, m));
  const units = extractUnits(read, (f, label, m) => progress?.(0.15 + f * 0.85, label, m));
  const files = new Map([...tilesets.files, ...units.files]);
  let bytes = 0;
  for (const data of files.values()) bytes += data.length;
  return { files, tilesets, units, bytes };
}

/**
 * A one-line account of what an extraction produced, for logs and the dialog. English: it is
 * kept in the copy's stamp (the desktop app writes one too), and `source.ts#summaryText`
 * reads it into the user's language where it is shown.
 */
export function describeExtraction(x: GameDataExtraction): string {
  const parts = [`${x.tilesets.complete.length} of ${TILESET_NAMES.length} tilesets`, `${x.units.manifest.grps.length} unit graphics`];
  if (x.units.manifest.hd?.length) parts.push(`${x.units.manifest.hd.length} Remastered sprites`);
  if (x.units.manifest.missing.length) parts.push(`${x.units.manifest.missing.length} missing`);
  return parts.join(", ");
}
