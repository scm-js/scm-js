/**
 * The terrain a mod declares: `terrain.json`, beside `mod.json` (in the folder named, or one folder down, never in one
 * of the game's folders). Per tileset, what a plugin could otherwise hand the editor at run time, so that everyone who
 * adds the mod gets it without learning or scanning anything:
 *
 * - `terrains`: named flat ground for the Rect brush and the fills (what `api.terrain.provideTypes` takes);
 * - `pieces`: named blocks of tiles for the Tile palette's pieces (what `providePieces` takes), each `cols × rows`
 *   tile ids row by row, -1 for a hole;
 * - `borrow`: exact source tile → tile pairs for the borrowed isometric brush (what `provideBorrowTable` takes), with
 *   the source tiles that are only stand-ins (the nearest picture where the tileset has no copy), so the terrains a
 *   file offers are the ones a scan would;
 * - `borders`: drawn borders between a borrowed terrain and the tileset's own ground (what `provideBorderTable` takes):
 *   per pair, the tiles to lay for each border shape, the shapes named as the editor reads them (`editor/borderLattice.ts`).
 *
 * Each tileset's section names the group table its numbers are for (`table`, `editor/pieceLearn.ts#tableHash`, the
 * hash learned pieces are kept under); a tileset whose table has another hash does not use the section.
 *
 * Like `mod.json` it is none of the mod's game files, so the mod's hash does not change with it. The reader never
 * throws: a bad row is dropped and said (`TerrainFileRead.dropped`), sizes are bounded, unknown keys are kept and
 * written back, so the file can grow (a `borders` section, say) without an older editor losing it.
 *
 * Pure; `tests/terrain-file.test.ts`.
 */
import { GAME_FOLDERS } from "@scm-js/mod";
import { TILESETS } from "../../data/tilesets";

export const TERRAIN_FILE = "terrain.json";
export const TERRAIN_FORMAT = 1;

/** The bounds a row must keep to; past them the row (or the rest of a list) is dropped. */
export const TERRAIN_LIMITS = {
  nameLength: 60,
  categoryLength: 40,
  terrains: 2048,
  pieces: 20000,
  pieceSide: 64,
  pairs: 200000,
  /** A table hash: the 13–14 base-36 characters `tableHash` gives, with room. */
  tableLength: 32,
  borders: 2048,
  borderShapes: 1024,
  shapeLength: 80,
  shapeTiles: 64,
} as const;

export interface TerrainFileTerrain { name: string; group: number }
export interface TerrainFilePiece { name?: string; category?: string; cols: number; rows: number; tiles: number[] }
export interface TerrainFileBorrow {
  source: string;
  pairs: [number, number][];
  /** Source tiles whose tile here is only the nearest picture (no copy): what the editor's scan calls a stand-in. */
  standIns?: number[];
}

/** A drawn border: the borrowed terrain (`terrain`, its index in `source`) on this tileset's ground (`ground`, its index here). */
export interface TerrainFileBorder {
  source: string;
  terrain: number;
  ground: number;
  /** Shape → the tiles to lay there, the likeliest first. */
  shapes: Record<string, number[]>;
}

export interface TerrainFileSection {
  table: string;
  terrains: TerrainFileTerrain[];
  pieces: TerrainFilePiece[];
  borrow: TerrainFileBorrow[];
  borders: TerrainFileBorder[];
  /** Keys this reader does not know, kept as they were. */
  extra: Record<string, unknown>;
}

export interface TerrainFile {
  format: number;
  /** By tileset id (`badlands`, `install`, …). */
  tilesets: Record<string, TerrainFileSection>;
  /** Keys this reader does not know, kept as they were (an unknown tileset name included). */
  extra: Record<string, unknown>;
}

/** Why a row was left out. */
export type TerrainDropReason =
  | "not-json" | "not-an-object" | "format" | "tileset" | "table" | "not-a-list" | "too-many" | "name" | "group"
  | "size" | "tiles" | "empty" | "source" | "pair" | "duplicate" | "terrain";

export interface TerrainDrop {
  /** Where, as a path in the file: `tilesets.badlands.pieces[3]`. */
  at: string;
  reason: TerrainDropReason;
}

export interface TerrainFileRead {
  file: TerrainFile;
  dropped: TerrainDrop[];
}

export const emptyTerrainFile = (): TerrainFile => ({ format: TERRAIN_FORMAT, tilesets: {}, extra: {} });
export const emptyTerrainSection = (table: string): TerrainFileSection => ({ table, terrains: [], pieces: [], borrow: [], borders: [], extra: {} });

const TILESET_IDS: readonly string[] = TILESETS.map((t) => t.id);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isWhole = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const textOf = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.length <= max ? s : null;
};

/** Read a terrain file from its text (or an already parsed value). Never throws. */
export function readTerrainFile(input: string | unknown): TerrainFileRead {
  const dropped: TerrainDrop[] = [];
  const file = emptyTerrainFile();
  let value: unknown = input;
  if (typeof input === "string") {
    try { value = JSON.parse(input); } catch { return { file, dropped: [{ at: "", reason: "not-json" }] }; }
  }
  if (!isObject(value)) return { file, dropped: [{ at: "", reason: "not-an-object" }] };
  if (value.format !== undefined && value.format !== TERRAIN_FORMAT) {
    // A later format: what this reader knows of it may not mean the same, so nothing is used.
    return { file: { ...file, format: isWhole(value.format, 0, 1e6) ? value.format : TERRAIN_FORMAT, extra: { ...value } }, dropped: [{ at: "format", reason: "format" }] };
  }
  for (const [key, v] of Object.entries(value)) {
    if (key === "format") continue;
    if (key !== "tilesets") { file.extra[key] = v; continue; }
    if (!isObject(v)) { dropped.push({ at: "tilesets", reason: "not-an-object" }); continue; }
    const unknownTilesets: Record<string, unknown> = {};
    for (const [id, raw] of Object.entries(v)) {
      if (!TILESET_IDS.includes(id)) { unknownTilesets[id] = raw; dropped.push({ at: `tilesets.${id}`, reason: "tileset" }); continue; }
      const section = readSection(id, raw, `tilesets.${id}`, dropped);
      if (section) file.tilesets[id] = section;
    }
    if (Object.keys(unknownTilesets).length > 0) file.extra[" tilesets"] = unknownTilesets;
  }
  return { file, dropped };
}

function readSection(id: string, raw: unknown, at: string, dropped: TerrainDrop[]): TerrainFileSection | null {
  if (!isObject(raw)) { dropped.push({ at, reason: "not-an-object" }); return null; }
  const table = typeof raw.table === "string" && /^[0-9a-z]{1,32}$/.test(raw.table) ? raw.table : null;
  if (!table) { dropped.push({ at: `${at}.table`, reason: "table" }); return null; }
  const section = emptyTerrainSection(table);
  const list = (key: string, max: number, read: (row: unknown, where: string) => void) => {
    const rows = raw[key];
    if (rows === undefined) return;
    if (!Array.isArray(rows)) { dropped.push({ at: `${at}.${key}`, reason: "not-a-list" }); return; }
    rows.forEach((row, i) => {
      if (i >= max) { if (i === max) dropped.push({ at: `${at}.${key}[${i}]`, reason: "too-many" }); return; }
      read(row, `${at}.${key}[${i}]`);
    });
  };
  const groups = new Set<number>();
  list("terrains", TERRAIN_LIMITS.terrains, (row, where) => {
    if (!isObject(row)) { dropped.push({ at: where, reason: "not-an-object" }); return; }
    const name = textOf(row.name, TERRAIN_LIMITS.nameLength);
    if (!name) { dropped.push({ at: where, reason: "name" }); return; }
    if (!isWhole(row.group, 0, 0xfff) || row.group % 2 !== 0) { dropped.push({ at: where, reason: "group" }); return; }
    if (groups.has(row.group)) { dropped.push({ at: where, reason: "duplicate" }); return; }
    groups.add(row.group);
    section.terrains.push({ name, group: row.group });
  });
  list("pieces", TERRAIN_LIMITS.pieces, (row, where) => {
    if (!isObject(row)) { dropped.push({ at: where, reason: "not-an-object" }); return; }
    if (!isWhole(row.cols, 1, TERRAIN_LIMITS.pieceSide) || !isWhole(row.rows, 1, TERRAIN_LIMITS.pieceSide)) { dropped.push({ at: where, reason: "size" }); return; }
    const tiles = row.tiles;
    if (!Array.isArray(tiles) || tiles.length !== row.cols * row.rows || !tiles.every((t) => isWhole(t, -1, 0xffff))) { dropped.push({ at: where, reason: "tiles" }); return; }
    if (tiles.every((t) => t === -1)) { dropped.push({ at: where, reason: "empty" }); return; }
    const piece: TerrainFilePiece = { cols: row.cols, rows: row.rows, tiles: [...tiles] as number[] };
    if (row.name !== undefined) {
      const name = textOf(row.name, TERRAIN_LIMITS.nameLength);
      if (!name) { dropped.push({ at: where, reason: "name" }); return; }
      piece.name = name;
    }
    if (row.category !== undefined) {
      const category = textOf(row.category, TERRAIN_LIMITS.categoryLength);
      if (!category) { dropped.push({ at: where, reason: "name" }); return; }
      piece.category = category;
    }
    section.pieces.push(piece);
  });
  const sources = new Set<string>();
  list("borrow", TILESET_IDS.length, (row, where) => {
    if (!isObject(row)) { dropped.push({ at: where, reason: "not-an-object" }); return; }
    const source = typeof row.source === "string" ? row.source : "";
    if (!TILESET_IDS.includes(source) || source === id) { dropped.push({ at: where, reason: "source" }); return; }
    if (sources.has(source)) { dropped.push({ at: where, reason: "duplicate" }); return; }
    if (!Array.isArray(row.pairs)) { dropped.push({ at: `${where}.pairs`, reason: "not-a-list" }); return; }
    const pairs: [number, number][] = [];
    row.pairs.forEach((p, i) => {
      if (i >= TERRAIN_LIMITS.pairs) { if (i === TERRAIN_LIMITS.pairs) dropped.push({ at: `${where}.pairs[${i}]`, reason: "too-many" }); return; }
      if (!Array.isArray(p) || p.length !== 2 || !isWhole(p[0], 0, 0xffff) || !isWhole(p[1], 0, 0xffff)) { dropped.push({ at: `${where}.pairs[${i}]`, reason: "pair" }); return; }
      pairs.push([p[0], p[1]]);
    });
    if (pairs.length === 0) { dropped.push({ at: where, reason: "empty" }); return; }
    let standIns: number[] | undefined;
    if (row.standIns !== undefined) {
      if (!Array.isArray(row.standIns) || row.standIns.length > TERRAIN_LIMITS.pairs || !row.standIns.every((t) => isWhole(t, 0, 0xffff))) dropped.push({ at: `${where}.standIns`, reason: "tiles" });
      else if (row.standIns.length > 0) standIns = [...row.standIns] as number[];
    }
    sources.add(source);
    section.borrow.push({ source, pairs, ...(standIns ? { standIns } : {}) });
  });
  const pairsSeen = new Set<string>();
  list("borders", TERRAIN_LIMITS.borders, (row, where) => {
    if (!isObject(row)) { dropped.push({ at: where, reason: "not-an-object" }); return; }
    const source = typeof row.source === "string" ? row.source : "";
    if (!TILESET_IDS.includes(source) || source === id) { dropped.push({ at: where, reason: "source" }); return; }
    if (!isWhole(row.terrain, 0, 0xff) || !isWhole(row.ground, 0, 0xff)) { dropped.push({ at: where, reason: "terrain" }); return; }
    const key = `${source}:${row.terrain}|${row.ground}`;
    if (pairsSeen.has(key)) { dropped.push({ at: where, reason: "duplicate" }); return; }
    if (!isObject(row.shapes)) { dropped.push({ at: `${where}.shapes`, reason: "not-an-object" }); return; }
    const shapes: Record<string, number[]> = {};
    let n = 0;
    for (const [shape, tiles] of Object.entries(row.shapes)) {
      if (n >= TERRAIN_LIMITS.borderShapes) { dropped.push({ at: `${where}.shapes`, reason: "too-many" }); break; }
      if (shape.length === 0 || shape.length > TERRAIN_LIMITS.shapeLength || !Array.isArray(tiles) || tiles.length === 0 || tiles.length > TERRAIN_LIMITS.shapeTiles || !tiles.every((t) => isWhole(t, 0, 0xffff))) {
        dropped.push({ at: `${where}.shapes[${JSON.stringify(shape)}]`, reason: "tiles" });
        continue;
      }
      shapes[shape] = [...tiles] as number[];
      n++;
    }
    if (n === 0) { dropped.push({ at: where, reason: "empty" }); return; }
    pairsSeen.add(key);
    section.borders.push({ source, terrain: row.terrain, ground: row.ground, shapes });
  });
  for (const [key, v] of Object.entries(raw)) if (!["table", "terrains", "pieces", "borrow", "borders"].includes(key)) section.extra[key] = v;
  return section;
}

/**
 * What of a section the loaded table cannot use: a terrain whose group is no pair of flat ground with pictures, a piece
 * with a tile past the table or on a slot with no picture, a borrow pair whose tile is past the host's table. For
 * `mod check`; the editor leaves such rows out where it lists them, as it does a plugin's.
 */
export function sectionAgainstTable(section: TerrainFileSection, id: string, table: { groups: number; hasPicture(tile: number): boolean }): TerrainDrop[] {
  const out: TerrainDrop[] = [];
  const at = `tilesets.${id}`;
  section.terrains.forEach((t, i) => {
    if (t.group + 1 >= table.groups || !table.hasPicture(t.group << 4) || !table.hasPicture((t.group + 1) << 4)) out.push({ at: `${at}.terrains[${i}]`, reason: "group" });
  });
  section.pieces.forEach((p, i) => {
    if (p.tiles.some((t) => t !== -1 && ((t >> 4) >= table.groups || !table.hasPicture(t)))) out.push({ at: `${at}.pieces[${i}]`, reason: "tiles" });
  });
  section.borrow.forEach((b, i) => {
    const bad = b.pairs.filter(([, h]) => (h >> 4) >= table.groups || !table.hasPicture(h)).length;
    if (bad > 0) out.push({ at: `${at}.borrow[${i}]`, reason: "pair" });
  });
  section.borders.forEach((b, i) => {
    if (Object.values(b.shapes).some((tiles) => tiles.some((t) => (t >> 4) >= table.groups || !table.hasPicture(t)))) out.push({ at: `${at}.borders[${i}]`, reason: "tiles" });
  });
  return out;
}

/** The file with `id`'s section replaced (or removed for null); every other section and unknown key kept. */
export function withTerrainSection(file: TerrainFile, id: string, section: TerrainFileSection | null): TerrainFile {
  const tilesets = { ...file.tilesets };
  if (section) tilesets[id] = section;
  else delete tilesets[id];
  return { ...file, tilesets };
}

/**
 * The file as text: known keys first, in a fixed order, each row on one line (a file of thousands of pieces stays
 * readable and diffs by row), then the unknown keys as they were read.
 */
export function writeTerrainFile(file: TerrainFile): string {
  const j = (v: unknown) => JSON.stringify(v);
  const lines: string[] = ["{", `  "format": ${TERRAIN_FORMAT},`, `  "tilesets": {`];
  const ids = [...TILESET_IDS.filter((id) => file.tilesets[id]), ...Object.keys(file.tilesets).filter((id) => !TILESET_IDS.includes(id))];
  const unknownTilesets = isObject(file.extra[" tilesets"]) ? (file.extra[" tilesets"] as Record<string, unknown>) : {};
  const blocks: string[] = [];
  for (const id of ids) {
    const s = file.tilesets[id];
    const parts: string[] = [`      "table": ${j(s.table)}`];
    const rows = (key: string, list: unknown[]) => {
      if (list.length === 0) { parts.push(`      ${j(key)}: []`); return; }
      parts.push(`      ${j(key)}: [\n${list.map((r) => `        ${j(r)}`).join(",\n")}\n      ]`);
    };
    rows("terrains", s.terrains);
    rows("pieces", s.pieces.map((p) => ({ ...(p.name ? { name: p.name } : {}), ...(p.category ? { category: p.category } : {}), cols: p.cols, rows: p.rows, tiles: p.tiles })));
    if (s.borrow.length === 0) parts.push(`      "borrow": []`);
    else parts.push(`      "borrow": [\n${s.borrow.map((b) => `        { "source": ${j(b.source)}, "pairs": ${j(b.pairs)}${b.standIns?.length ? `, "standIns": ${j(b.standIns)}` : ""} }`).join(",\n")}\n      ]`);
    if (s.borders.length > 0) parts.push(`      "borders": [\n${s.borders.map((b) => `        { "source": ${j(b.source)}, "terrain": ${b.terrain}, "ground": ${b.ground}, "shapes": ${j(b.shapes)} }`).join(",\n")}\n      ]`);
    for (const [key, v] of Object.entries(s.extra)) parts.push(`      ${j(key)}: ${j(v)}`);
    blocks.push(`    ${j(id)}: {\n${parts.join(",\n")}\n    }`);
  }
  for (const [id, v] of Object.entries(unknownTilesets)) blocks.push(`    ${j(id)}: ${j(v)}`);
  lines.push(blocks.join(",\n"));
  const extras = Object.entries(file.extra).filter(([k]) => k !== " tilesets");
  lines.push(extras.length > 0 ? "  }," : "  }");
  extras.forEach(([k, v], i) => lines.push(`  ${j(k)}: ${j(v)}${i < extras.length - 1 ? "," : ""}`));
  lines.push("}");
  return lines.join("\n") + "\n";
}

/** Counts per tileset, for `mod info` and the editor's notes. */
export function terrainFileCounts(file: TerrainFile): Record<string, { terrains: number; pieces: number; borrow: { source: string; pairs: number }[]; borders: { source: string; terrain: number; ground: number; shapes: number }[] }> {
  const out: ReturnType<typeof terrainFileCounts> = {};
  for (const [id, s] of Object.entries(file.tilesets)) out[id] = { terrains: s.terrains.length, pieces: s.pieces.length, borrow: s.borrow.map((b) => ({ source: b.source, pairs: b.pairs.length })), borders: s.borders.map((b) => ({ source: b.source, terrain: b.terrain, ground: b.ground, shapes: Object.keys(b.shapes).length })) };
  return out;
}

/**
 * Whether a `terrain.json` at `path` (forward slashes) is the mod's: by `mod.json`'s rule (`@scm-js/mod`'s
 * `isModJsonPath`) — in the folder everything given is in (`top`; "" for none), or one folder down from it, never in one
 * of the game's folders. Of several, the caller takes the shallowest.
 */
export function isTerrainFilePath(path: string, top: string, gameFolders: readonly string[] = GAME_FOLDERS): boolean {
  const parts = path.split("/");
  if (parts.pop()?.toLowerCase() !== TERRAIN_FILE) return false;
  if (top) {
    if (parts[0] !== top) return false;
    parts.shift();
  }
  return parts.length === 0 || (parts.length === 1 && !gameFolders.includes(parts[0].toLowerCase()));
}

/** Of the paths given, the mod's `terrain.json` (the shallowest by `isTerrainFilePath`), or null. */
export function terrainFileOf(paths: readonly string[], top: string, gameFolders: readonly string[] = GAME_FOLDERS): string | null {
  return paths.filter((p) => isTerrainFilePath(p, top, gameFolders)).sort((a, b) => a.split("/").length - b.split("/").length)[0] ?? null;
}
