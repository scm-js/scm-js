/**
 * The same tile twice: a mod's tileset repeats the game's pictures and its own, so the Tile
 * palette's lists would show one picture many times. "The same tile" is the same picture *and*
 * the same flags (`heal.ts#kindKey`: the group's flag word and the megatile's sixteen VF4
 * words). The same picture under other flags is another tile: it walks, builds or stands at
 * another height.
 *
 * The Grid view keeps one tile per exact picture and flags. The Pieces view folds a piece into
 * another of the same outline when every cell is the same tile, by exact picture or as a
 * re-dithered copy (`COPY_BLOCK_MEAN`, `COPY_CELL_MEAN`). The Sheet and Groups views hide
 * nothing: there a tile's place is the point. Measurements in `.claude/internals/terrain.md`.
 */
import { groupBuildable, megatileForTile, megatileHeight, TileFlag, tileGroupOf, type Tileset } from "../formats/tileset/decode";
import { kindKey } from "./heal";
import type { Piece } from "./pieces";

/**
 * A re-dithered copy: every 4 × 4 pixel block's mean colour within this much a channel of the
 * other picture's, and (below) the cell's mean pixel difference within `COPY_CELL_MEAN`.
 * Calibrated on the isometric spike's copies, where it passed none of the negative controls.
 * A mean over the whole piece instead is not safe: a small detail (a console on a wall) is lost
 * in it, and two pieces that differ only there would fold into one.
 */
export const COPY_BLOCK_MEAN = 2.5;
/** The cell's mean difference per pixel, the channels averaged; see `COPY_BLOCK_MEAN`. */
export const COPY_CELL_MEAN = 10;

/* ── A megatile's picture ───────────────────────────────── */

const pictures = new WeakMap<Tileset, Uint32Array>();

/** The palette index of pixel (x, y) of a megatile: its minitile, flipped where the reference says. */
function pixelIndex(tileset: Tileset, megatile: number, x: number, y: number): number {
  const ref = tileset.megatileRefs[megatile * 16 + (y >> 3) * 4 + (x >> 3)];
  const px = x & 7, py = y & 7;
  return tileset.minitiles[(ref >>> 1) * 64 + py * 8 + (ref & 1 ? 7 - px : px)] ?? 0;
}

/** Two 32-bit hashes of every megatile's pixels, kept per tileset: a pair equal means the same picture. */
function pictureHashes(tileset: Tileset): Uint32Array {
  const cached = pictures.get(tileset);
  if (cached) return cached;
  const out = new Uint32Array(tileset.megatileCount * 2);
  for (let m = 0; m < tileset.megatileCount; m++) {
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const v = pixelIndex(tileset, m, x, y);
        a = Math.imul(a ^ v, 0x01000193);
        b = Math.imul(b ^ (v + 0x9e), 0x85ebca6b) ^ (b >>> 13);
      }
    }
    out[m * 2] = a >>> 0;
    out[m * 2 + 1] = b >>> 0;
  }
  pictures.set(tileset, out);
  return out;
}

/** A tile's picture as a key ("" where it has none): equal keys, byte-identical pixels. */
export function pictureKey(tileset: Tileset, tile: number): string {
  const m = megatileForTile(tileset, tile);
  if (m <= 0) return "";
  const h = pictureHashes(tileset);
  return `${h[m * 2].toString(36)}.${h[m * 2 + 1].toString(36)}`;
}

const tileKeys = new WeakMap<Tileset, Map<number, string>>();

/** Picture and flags: two tiles with the same key are the same tile to the palette's lists. Kept per tileset. */
export function sameTileKey(tileset: Tileset, tile: number): string {
  let keys = tileKeys.get(tileset);
  if (!keys) tileKeys.set(tileset, (keys = new Map()));
  let key = keys.get(tile);
  if (key === undefined) keys.set(tile, (key = `${pictureKey(tileset, tile)}|${kindKey(tileset, tile)}`));
  return key;
}

/**
 * The tiles of `ids` with every repeat by picture and flags left out, the lowest id of each kept
 * (so where a mod repeats the game's tile, the game's is the one listed). `exclude` drops the
 * tiles whose key is among those (the game's part, for the "Added by" filter). Order kept.
 */
export function uniqueTiles(tileset: Tileset, ids: readonly number[], exclude?: ReadonlySet<string>): number[] {
  const keys = ids.map((id) => sameTileKey(tileset, id));
  const lowest = new Map<string, number>();
  ids.forEach((id, i) => {
    const was = lowest.get(keys[i]);
    if (was === undefined || id < was) lowest.set(keys[i], id);
  });
  return ids.filter((id, i) => lowest.get(keys[i]) === id && !exclude?.has(keys[i]));
}

/* ── Near copies ────────────────────────────────────────── */

const rgbCache = new WeakMap<Tileset, Map<number, { rgb: Uint8Array; blocks: Float32Array; mean: Float32Array }>>();

/** A megatile's pixels as RGB, its 64 block means (4 × 4 pixels each, R G B) and its mean: worked out on first use. */
function colours(tileset: Tileset, megatile: number) {
  let cache = rgbCache.get(tileset);
  if (!cache) rgbCache.set(tileset, (cache = new Map()));
  const was = cache.get(megatile);
  if (was) return was;
  const rgb = new Uint8Array(32 * 32 * 3);
  const blocks = new Float32Array(64 * 3);
  const mean = new Float32Array(3);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const c = pixelIndex(tileset, megatile, x, y) * 4;
      const at = (y * 32 + x) * 3;
      const block = ((y >> 2) * 8 + (x >> 2)) * 3;
      for (let k = 0; k < 3; k++) {
        const v = tileset.palette[c + k];
        rgb[at + k] = v;
        blocks[block + k] += v / 16;
        mean[k] += v / 1024;
      }
    }
  }
  const out = { rgb, blocks, mean };
  cache.set(megatile, out);
  return out;
}

/** Whether two megatiles show the same picture, exactly or as a re-dithered copy. */
export function samePicture(tileset: Tileset, a: number, b: number): boolean {
  if (a === b) return true;
  if (a <= 0 || b <= 0) return false;
  const h = pictureHashes(tileset);
  if (h[a * 2] === h[b * 2] && h[a * 2 + 1] === h[b * 2 + 1]) return true;
  const ca = colours(tileset, a), cb = colours(tileset, b);
  // Every block within the bound means the whole tile's mean is too: the cheap test first.
  for (let k = 0; k < 3; k++) if (Math.abs(ca.mean[k] - cb.mean[k]) > COPY_BLOCK_MEAN) return false;
  for (let i = 0; i < ca.blocks.length; i++) if (Math.abs(ca.blocks[i] - cb.blocks[i]) > COPY_BLOCK_MEAN) return false;
  let sum = 0;
  for (let i = 0; i < ca.rgb.length; i++) sum += Math.abs(ca.rgb[i] - cb.rgb[i]);
  return sum / ca.rgb.length <= COPY_CELL_MEAN;
}

/* ── Pieces ─────────────────────────────────────────────── */

/** What tells two tiles of one picture apart to the game, in the words the hover uses. */
export type FlagDifference = "height" | "walkable" | "buildable";

export interface PieceEntry {
  /** The piece listed: the most laid of those it stands for. */
  piece: Piece;
  /** The others, the same tile cell for cell. */
  copies: Piece[];
  /** Set when it is another entry's picture under other flags: that entry, and what differs. */
  copyOf?: { piece: Piece; differs: FlagDifference[] };
}

/** Cells as offsets in the piece's rectangle, so two pieces of one outline compare cell by cell. */
const outlineOf = (p: Piece) => `${p.cols}x${p.rows}:${p.tiles.map((t) => ((t >> 4) - p.group) * 16 + ((t & 15) - p.slot)).join(",")}`;

function differences(tileset: Tileset, a: Piece, b: Piece): FlagDifference[] {
  const out = new Set<FlagDifference>();
  for (let i = 0; i < a.tiles.length; i++) {
    const ma = megatileForTile(tileset, a.tiles[i]), mb = megatileForTile(tileset, b.tiles[i]);
    if (ma > 0 && mb > 0 && megatileHeight(tileset, ma) !== megatileHeight(tileset, mb)) out.add("height");
    for (let k = 0; k < 16; k++) {
      if (((tileset.megatileFlags[ma * 16 + k] ?? 0) & TileFlag.Walkable) !== ((tileset.megatileFlags[mb * 16 + k] ?? 0) & TileFlag.Walkable)) out.add("walkable");
    }
    const ga = tileset.groups[tileGroupOf(a.tiles[i], tileset.groups.length)], gb = tileset.groups[tileGroupOf(b.tiles[i], tileset.groups.length)];
    if (ga && gb && groupBuildable(ga) !== groupBuildable(gb)) out.add("buildable");
  }
  return [...out];
}

/**
 * The pieces as the Pieces view lists them: pieces of one outline whose every cell is the same
 * tile (picture, exact or re-dithered, and flags) are one entry, the most laid kept (ties: the
 * lowest first tile). A piece that is another's picture under other flags is an entry of its
 * own, placed right after the one it copies. In sheet order otherwise.
 */
export function collapsePieces(tileset: Tileset, pieces: readonly Piece[]): PieceEntry[] {
  const order = [...pieces].sort((a, b) => b.laid - a.laid || a.tiles[0] - b.tiles[0]);
  const megatiles = (p: Piece) => p.tiles.map((t) => megatileForTile(tileset, t));
  const kinds = (p: Piece) => p.tiles.map((t) => kindKey(tileset, t)).join(";");
  const exact = (p: Piece) => p.tiles.map((t) => pictureKey(tileset, t)).join(";");
  interface Rep { entry: PieceEntry; megatiles: number[]; kinds: string; exact: string }
  const byOutline = new Map<string, Rep[]>();
  const entries: PieceEntry[] = [];
  for (const p of order) {
    const outline = outlineOf(p);
    const reps = byOutline.get(outline) ?? [];
    const mine = { megatiles: megatiles(p), kinds: kinds(p), exact: exact(p) };
    const same = (r: Rep) => r.exact === mine.exact || r.megatiles.every((m, i) => samePicture(tileset, m, mine.megatiles[i]));
    const copy = reps.find((r) => r.kinds === mine.kinds && same(r));
    if (copy) {
      copy.entry.copies.push(p);
      continue;
    }
    const other = reps.find((r) => r.kinds !== mine.kinds && !r.entry.copyOf && same(r));
    const entry: PieceEntry = { piece: p, copies: [], ...(other ? { copyOf: { piece: other.entry.piece, differs: differences(tileset, other.entry.piece, p) } } : {}) };
    reps.push({ entry, ...mine });
    byOutline.set(outline, reps);
    entries.push(entry);
  }
  // Sheet order, each copy under other flags right after the entry it copies.
  const after = new Map<Piece, PieceEntry[]>();
  const main: PieceEntry[] = [];
  for (const e of entries) {
    if (e.copyOf) {
      const list = after.get(e.copyOf.piece);
      if (list) list.push(e);
      else after.set(e.copyOf.piece, [e]);
    } else main.push(e);
  }
  main.sort((a, b) => a.piece.tiles[0] - b.piece.tiles[0]);
  const out: PieceEntry[] = [];
  for (const e of main) {
    out.push(e);
    const next = after.get(e.piece);
    if (next) out.push(...next.sort((a, b) => a.piece.tiles[0] - b.piece.tiles[0]));
  }
  return out;
}

/** Every piece an entry stands for. */
export const entryPieces = (e: PieceEntry): Piece[] => [e.piece, ...e.copies];
