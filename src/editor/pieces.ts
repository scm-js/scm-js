/**
 * Pieces: the parts of a tileset's sheet that maps lay whole.
 *
 * A tileset is a sheet sixteen tiles wide — a group a row, a slot a column — and the ground
 * a tileset adds past the game's own is drawn on it as pictures: a wall module, a ramp, a
 * wreck. Nothing in the files says where one picture ends and the next begins. The maps do:
 * a mapper lays a picture's tiles side by side as they are in the sheet, and lays loose
 * ground in any order. So the evidence is counted a *join* of the sheet at a time — how often
 * a tile and its sheet neighbour are laid as neighbours, against how often either is laid at
 * all — and a piece is a run of the sheet whose joins hold.
 *
 * Counting joins and not whole shapes is what lets a piece laid cut short, or with one tile
 * swapped, still count toward the piece; by whole shape the same ramp at three lengths is
 * three shapes and none of them is laid often. Measurements in `.claude/internals/terrain.md`.
 */
import { DOODAD_GROUP_INDEX, tileGroupOf, type Tileset } from "../formats/tileset/decode";
import { HOLE, type TileBlock } from "./tileSheet";

/** What maps have shown about one tileset's sheet. Tiles are `group << 4 | slot`. */
export interface PieceEvidence {
  /** How many maps were counted. */
  maps: number;
  /** Times each tile is laid. */
  laid: Map<number, number>;
  /** Times a tile has its sheet's right neighbour (same group, next slot) on its right. */
  across: Map<number, number>;
  /** Times a tile has its sheet's lower neighbour (next group, same slot) below it. */
  down: Map<number, number>;
}

export interface Piece {
  /** Its tiles, ascending: `group << 4 | slot`. */
  tiles: number[];
  /** The sheet rectangle around it, in slots and groups. */
  slot: number;
  group: number;
  cols: number;
  rows: number;
  /** Times its tiles are laid, all told: how much maps use it. */
  laid: number;
}

export interface CutOptions {
  /**
   * A join holds when the two tiles are laid together at least this share of the times the
   * rarer of them is laid at all.
   */
  share: number;
}

/** Half: a picture's tiles are together nearly always, loose ground about one time in sixteen. */
export const DEFAULT_CUT: CutOptions = { share: 0.5 };

export function emptyEvidence(): PieceEvidence {
  return { maps: 0, laid: new Map(), across: new Map(), down: new Map() };
}

const bump = (into: Map<number, number>, key: number, by = 1) => {
  into.set(key, (into.get(key) ?? 0) + by);
};

type Sheet = Pick<Tileset, "groups">;

/**
 * Count one map. A doodad group's tiles are left out (a doodad is already a whole thing, and
 * has its own palette), and so is a slot with no picture.
 */
export function gatherEvidence(into: PieceEvidence, tiles: ArrayLike<number>, width: number, height: number, tileset: Sheet): PieceEvidence {
  const count = tileset.groups.length;
  const ids = new Int32Array(width * height);
  for (let i = 0; i < ids.length; i++) {
    const raw = tiles[i] ?? 0;
    const group = tileGroupOf(raw, count);
    const slot = raw & 15;
    const g = tileset.groups[group];
    ids[i] = g && g.index !== DOODAD_GROUP_INDEX && g.megatiles[slot] !== 0 ? (group << 4) | slot : -1;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const id = ids[i];
      if (id < 0) continue;
      bump(into.laid, id);
      if (x + 1 < width && (id & 15) < 15 && ids[i + 1] === id + 1) bump(into.across, id);
      if (y + 1 < height && ids[i + width] === id + 16) bump(into.down, id);
    }
  }
  into.maps++;
  return into;
}

/** Two bodies of evidence as one (a learned collection and the map in front). */
export function mergeEvidence(a: PieceEvidence, b: PieceEvidence): PieceEvidence {
  const out: PieceEvidence = { maps: a.maps + b.maps, laid: new Map(a.laid), across: new Map(a.across), down: new Map(a.down) };
  for (const [k, n] of b.laid) bump(out.laid, k, n);
  for (const [k, n] of b.across) bump(out.across, k, n);
  for (const [k, n] of b.down) bump(out.down, k, n);
  return out;
}

/** The pieces the evidence shows, in sheet order. */
export function cutPieces(evidence: PieceEvidence, options: CutOptions = DEFAULT_CUT): Piece[] {
  const parent = new Map<number, number>();
  const root = (a: number): number => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(a) !== r) {
      const next = parent.get(a)!;
      parent.set(a, r);
      a = next;
    }
    return r;
  };
  const join = (a: number, b: number, together: number) => {
    const rarer = Math.min(evidence.laid.get(a) ?? 0, evidence.laid.get(b) ?? 0);
    if (rarer === 0 || together / rarer < options.share) return;
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(root(a), root(b));
  };
  for (const [a, n] of evidence.across) join(a, a + 1, n);
  for (const [a, n] of evidence.down) join(a, a + 16, n);

  const byRoot = new Map<number, number[]>();
  for (const a of parent.keys()) {
    const r = root(a);
    const list = byRoot.get(r);
    if (list) list.push(a);
    else byRoot.set(r, [a]);
  }
  const pieces: Piece[] = [];
  for (const tiles of byRoot.values()) {
    tiles.sort((a, b) => a - b);
    let slot = 15, right = 0, laid = 0;
    for (const t of tiles) {
      slot = Math.min(slot, t & 15);
      right = Math.max(right, t & 15);
      laid += evidence.laid.get(t) ?? 0;
    }
    const group = tiles[0] >> 4;
    pieces.push({ tiles, slot, group, cols: right - slot + 1, rows: (tiles[tiles.length - 1] >> 4) - group + 1, laid });
  }
  return pieces.sort((a, b) => a.tiles[0] - b.tiles[0]);
}

/** A piece as a block the Tile brush lays: its sheet rectangle, a hole where it has no tile. */
export function pieceBlock(piece: Piece): TileBlock {
  const ids = Array.from({ length: piece.cols * piece.rows }, () => HOLE);
  for (const t of piece.tiles) ids[((t >> 4) - piece.group) * piece.cols + ((t & 15) - piece.slot)] = t;
  return { cols: piece.cols, rows: piece.rows, ids, origin: { group: piece.group, slot: piece.slot } };
}

/** The piece a tile belongs to, by tile: built once per list. */
export function pieceIndex(pieces: readonly Piece[]): Map<number, Piece> {
  const out = new Map<number, Piece>();
  for (const p of pieces) for (const t of p.tiles) out.set(t, p);
  return out;
}

/** Evidence as plain numbers, for keeping: `[maps, laid…, -1, across…, -1, down…]` in pairs. */
export function encodeEvidence(e: PieceEvidence): number[] {
  const out = [e.maps];
  for (const part of [e.laid, e.across, e.down]) {
    for (const [k, n] of part) out.push(k, n);
    out.push(-1);
  }
  return out;
}

export function decodeEvidence(data: readonly number[]): PieceEvidence | null {
  if (!Array.isArray(data) || data.length < 4 || !data.every((n) => Number.isInteger(n))) return null;
  const out = emptyEvidence();
  out.maps = data[0];
  const parts = [out.laid, out.across, out.down];
  let part = 0;
  for (let i = 1; i < data.length; ) {
    if (data[i] === -1) {
      part++;
      i++;
      continue;
    }
    if (part > 2 || i + 1 >= data.length || data[i] < 0 || data[i + 1] < 1) return null;
    parts[part].set(data[i], data[i + 1]);
    i += 2;
  }
  return part === 3 ? out : null;
}
