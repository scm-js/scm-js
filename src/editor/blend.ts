/**
 * The Blend brush: given one tile on the map, which tiles in the tileset would join it
 * seamlessly on each side?
 *
 * The game data has no such table. The CV5 edge links only say which cliff pieces the
 * isometric brush pairs with which, and say nothing about doodad tiles, the odd slots
 * of an edge set, or the hand-blends mappers make between two tilesets' worth of
 * ground. So this reads the pixels instead: each megatile's four outermost pixel
 * rows/columns are lifted straight out of the VR4 (`edgeTable`, cached per tileset),
 * and a candidate for a side scores by the mean per-channel difference between the
 * anchor's edge and the candidate's *opposite* edge — the anchor's right column against
 * the candidate's left column, and so on. 0 is a pixel-identical seam, a few units is a
 * seam the eye will not find, and flat ground against a cliff face is 50 and up.
 *
 * Everything here is pure and canvas-free so it runs in tests against the real files.
 */
import type { Scenario } from "../formats/chk/scenario";
import { MEGATILE_PX, MINITILE_PX, MINITILES_PER_EDGE, type Tileset } from "../formats/tileset/decode";
import { stampTile, type TileChange } from "./terrain";

export type Side = "left" | "top" | "right" | "bottom";

export const SIDES: readonly Side[] = ["left", "top", "right", "bottom"];

/** The side of a neighbour that touches `side` of the anchor. */
export const OPPOSITE: Record<Side, Side> = { left: "right", top: "bottom", right: "left", bottom: "top" };

const SIDE_INDEX: Record<Side, number> = { left: 0, top: 1, right: 2, bottom: 3 };
const OFFSET: Record<Side, { dx: number; dy: number }> = {
  left: { dx: -1, dy: 0 },
  top: { dx: 0, dy: -1 },
  right: { dx: 1, dy: 0 },
  bottom: { dx: 0, dy: 1 },
};

/** Pixels along one megatile edge. */
export const EDGE_PX = MEGATILE_PX;
/** Bytes per edge strip: RGB for each pixel. */
const EDGE_BYTES = EDGE_PX * 3;
const MEGATILE_BYTES = EDGE_BYTES * 4;

export interface EdgeTable {
  count: number;
  /**
   * `megatile * 384 + side * 96 + pixel * 3` → R, G, B. Left/right strips run top to
   * bottom, top/bottom strips left to right.
   */
  data: Uint8Array;
}

/** Palette index of pixel (px, py) inside a megatile, honouring the minitile flip bit. */
function paletteIndexAt(tileset: Tileset, megatile: number, px: number, py: number): number {
  const mx = (px / MINITILE_PX) | 0;
  const my = (py / MINITILE_PX) | 0;
  const ref = tileset.megatileRefs[megatile * 16 + my * MINITILES_PER_EDGE + mx] ?? 0;
  const flipped = (ref & 1) === 1;
  const x = px % MINITILE_PX;
  const y = py % MINITILE_PX;
  return tileset.minitiles[(ref >>> 1) * MINITILE_PX * MINITILE_PX + y * MINITILE_PX + (flipped ? MINITILE_PX - 1 - x : x)] ?? 0;
}

const tables = new WeakMap<Tileset, EdgeTable>();

/** The outermost pixel strips of every megatile, built once per tileset. */
export function edgeTable(tileset: Tileset): EdgeTable {
  const cached = tables.get(tileset);
  if (cached) return cached;

  const count = tileset.megatileCount;
  const data = new Uint8Array(count * MEGATILE_BYTES);
  const { palette } = tileset;
  const last = MEGATILE_PX - 1;
  const put = (at: number, index: number) => {
    data[at] = palette[index * 4];
    data[at + 1] = palette[index * 4 + 1];
    data[at + 2] = palette[index * 4 + 2];
  };
  for (let m = 0; m < count; m++) {
    const base = m * MEGATILE_BYTES;
    for (let i = 0; i < EDGE_PX; i++) {
      put(base + SIDE_INDEX.left * EDGE_BYTES + i * 3, paletteIndexAt(tileset, m, 0, i));
      put(base + SIDE_INDEX.top * EDGE_BYTES + i * 3, paletteIndexAt(tileset, m, i, 0));
      put(base + SIDE_INDEX.right * EDGE_BYTES + i * 3, paletteIndexAt(tileset, m, last, i));
      put(base + SIDE_INDEX.bottom * EDGE_BYTES + i * 3, paletteIndexAt(tileset, m, i, last));
    }
  }

  const table = { count, data };
  tables.set(tileset, table);
  return table;
}

/** Mean absolute per-channel difference, 0..255, between two edge strips. */
export function edgeDistance(edges: EdgeTable, a: number, sideA: Side, b: number, sideB: Side): number {
  const { data } = edges;
  let at = a * MEGATILE_BYTES + SIDE_INDEX[sideA] * EDGE_BYTES;
  let bt = b * MEGATILE_BYTES + SIDE_INDEX[sideB] * EDGE_BYTES;
  let sum = 0;
  for (let i = 0; i < EDGE_BYTES; i++) sum += Math.abs(data[at++] - data[bt++]);
  return sum / EDGE_BYTES;
}

/* ── Candidates ─────────────────────────────────────────── */

export interface BlendCandidate {
  /** MTXM tile id to place. */
  id: number;
  megatile: number;
  /** `edgeDistance` between the anchor's side and this tile's opposite side. */
  distance: number;
}

export interface BlendOptions {
  /** Largest distance still listed. */
  maxDistance: number;
  /** Most candidates listed per side. */
  limit: number;
  /** Optional filter over tile ids (the palette's group-kind dropdown). */
  include?: (id: number) => boolean;
}

/**
 * Designed left/right pairs measure 0.2–8 across the eight tilesets and the 5th percentile
 * of all tiles is 6–18, so 16 keeps the lists to seams the eye accepts; the palette lets
 * the user raise it.
 */
export const DEFAULT_BLEND_OPTIONS: BlendOptions = { maxDistance: 16, limit: 48 };

const drawable = new WeakMap<Tileset, Uint32Array>();

/**
 * Every tile id that draws something, one per megatile — several ids can share a
 * megatile (a doodad group re-using ground art), and listing the same picture twice
 * helps nobody, so the lowest id wins.
 */
export function drawableTiles(tileset: Tileset): Uint32Array {
  const cached = drawable.get(tileset);
  if (cached) return cached;
  const seen = new Uint8Array(tileset.megatileCount);
  const ids: number[] = [];
  for (let g = 0; g < tileset.groups.length; g++) {
    const megatiles = tileset.groups[g].megatiles;
    for (let s = 0; s < 16; s++) {
      const m = megatiles[s];
      if (m === 0 || m >= tileset.megatileCount || seen[m]) continue;
      seen[m] = 1;
      ids.push((g << 4) | s);
    }
  }
  const out = Uint32Array.from(ids);
  drawable.set(tileset, out);
  return out;
}

/** Tiles that would sit against `side` of `anchorId`, best seam first. */
export function blendCandidates(tileset: Tileset, anchorId: number, side: Side, options: BlendOptions = DEFAULT_BLEND_OPTIONS): BlendCandidate[] {
  const group = tileset.groups[anchorId >> 4];
  const anchor = group ? group.megatiles[anchorId & 15] : 0;
  if (!anchor || anchor >= tileset.megatileCount) return [];
  const edges = edgeTable(tileset);
  const opposite = OPPOSITE[side];
  const out: BlendCandidate[] = [];
  for (const id of drawableTiles(tileset)) {
    if (options.include && !options.include(id)) continue;
    const megatile = tileset.groups[id >> 4].megatiles[id & 15];
    const distance = edgeDistance(edges, anchor, side, megatile, opposite);
    if (distance <= options.maxDistance) out.push({ id, megatile, distance });
  }
  out.sort((a, b) => a.distance - b.distance || a.id - b.id);
  return out.length > options.limit ? out.slice(0, options.limit) : out;
}

/** All four sides at once. */
export function blendSides(tileset: Tileset, anchorId: number, options: BlendOptions = DEFAULT_BLEND_OPTIONS): Record<Side, BlendCandidate[]> {
  return {
    left: blendCandidates(tileset, anchorId, "left", options),
    top: blendCandidates(tileset, anchorId, "top", options),
    right: blendCandidates(tileset, anchorId, "right", options),
    bottom: blendCandidates(tileset, anchorId, "bottom", options),
  };
}

/* ── Placing ────────────────────────────────────────────── */

export interface TilePos {
  x: number;
  y: number;
}

export function neighbourOf(at: TilePos, side: Side): TilePos {
  return { x: at.x + OFFSET[side].dx, y: at.y + OFFSET[side].dy };
}

export function inMap(scn: Pick<Scenario, "width" | "height">, at: TilePos): boolean {
  return at.x >= 0 && at.y >= 0 && at.x < scn.width && at.y < scn.height;
}

/**
 * The change that puts `id` on the `side` neighbour of `anchor`, or null when that cell
 * is off the map. Empty when the tile is already there.
 */
export function placeBlend(scn: Scenario, anchor: TilePos, side: Side, id: number): TileChange[] | null {
  const at = neighbourOf(anchor, side);
  if (!inMap(scn, at)) return null;
  return stampTile(scn, [at.y * scn.width + at.x], id);
}
