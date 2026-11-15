/**
 * Drawn borders, the pass: lay the border cells of a borrowed patch from the pair's table (`borderTable.ts`), with the
 * seams as the judge.
 *
 * Each border cell's candidates are the shape's own tiles (the eight most laid), and where those give nothing that joins,
 * the sheet's pool around them. Cells choose by `seamStep` against all four neighbours, again and again until nothing
 * changes; then a cell whose worst join shows is given up to the hard edge (the patch's tile on the patch's side, the
 * ground's own tile on the other), and the rest choose again. On the ground's side, the tile that was there before
 * stays wherever it joins its neighbours without showing: a border tile is laid only where it is needed.
 *
 * Measured in the spike (terrain.md "Drawn borders"): this is what works; the same picture shared between shapes, the
 * pool without the judge, and choosing a rect's two tiles together were tried and are not here. Pure.
 */
import { edgeGrain, edgeTable, SEAM_SHOWS, seamStep, type Side } from "./blend";
import { megatileForTile, type Tileset } from "../formats/tileset/decode";
import type { BorderPairTable } from "./borderTable";

export interface BorderCell {
  /** The cell, row-major. */
  i: number;
  /** Its shape (`borderLattice.ts`), and the pair whose table it is laid from. */
  shape: string;
  table: BorderPairTable;
  /** Leans to the patch: the hard edge there is the patch's tile (`xTile`), else the ground's own tile before. */
  leansX: boolean;
  xTile: number;
}

export interface BorderPassResult {
  /** Cells laid with a tile of the table or the pool. */
  drawn: number;
  fromPool: number;
  /** Cells left as the hard edge: no candidate joins there. */
  hard: number;
  /** Cells on the ground's side where the tile that was there joins and stays. */
  kept: number;
  /** The cells (indices) left hard, and kept. */
  hardCells: number[];
  keptCells: number[];
  ms: number;
}

/** The eight most laid tiles per shape. */
const TOP = 8;
/** What a pool tile costs over a tile the maps lay in the shape: a little evidence is worth a little seam. */
const POOL_COST = 6;

const SIDES: [number, number, Side][] = [[-1, 0, "left"], [1, 0, "right"], [0, -1, "top"], [0, 1, "bottom"]];
const SIDE_INDEX: Record<Side, number> = { left: 0, top: 1, right: 2, bottom: 3 };
const OPP: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };

/** Per megatile and side, the mean colour of its outermost pixels: `[m * 12 + side * 3 + channel]`. A seam's lower bound. */
const meansCache = new WeakMap<Tileset, Float32Array>();
function edgeMeans(host: Tileset): Float32Array {
  const was = meansCache.get(host);
  if (was) return was;
  const { data } = edgeTable(host); // `m * 384 + side * 96 + pixel * 3`, sides left, top, right, bottom
  const out = new Float32Array(host.megatileCount * 12);
  const per = 32;
  for (let m = 0; m < host.megatileCount; m++) for (let s = 0; s < 4; s++) {
    let r = 0, g = 0, b = 0;
    const base = m * 384 + s * 96;
    for (let p = 0; p < per; p++) { r += data[base + p * 3]; g += data[base + p * 3 + 1]; b += data[base + p * 3 + 2]; }
    out[m * 12 + s * 3] = r / per; out[m * 12 + s * 3 + 1] = g / per; out[m * 12 + s * 3 + 2] = b / per;
  }
  meansCache.set(host, out);
  return out;
}

/** Work out the measures the pass reads (the tileset's edges, their grain and means) ahead of the first stroke. */
export function warmBorderPass(host: Tileset): void {
  edgeMeans(host);
  edgeGrain(host);
}

/**
 * Lay `cells` into `tiles` (the map as it will be around them: the patch laid, the ground as it was), `before` the
 * ground's own tiles. `pools` gives the sheet's further candidates per table.
 */
export function layBorder(host: Tileset, w: number, h: number, tiles: Uint16Array, cells: readonly BorderCell[], before: ArrayLike<number>, pools: ReadonlyMap<BorderPairTable, readonly number[]>, opts: { keepGround?: boolean } = {}): BorderPassResult {
  const keepGround = opts.keepGround ?? true;
  const t0 = performance.now();
  const means = edgeMeans(host), grain = edgeGrain(host);
  const own = new Map<number, number[]>();
  for (const c of cells) {
    const list = c.table.shapes.get(c.shape) ?? c.table.shapes.get(withoutStack(c.shape)) ?? [];
    own.set(c.i, list.slice(0, TOP).map(([id]) => id));
  }
  const hardTile = (c: BorderCell) => (c.leansX ? c.xTile : before[c.i]);
  const joins = (i: number, id: number) => {
    const a = megatileForTile(host, id);
    if (a <= 0) return { cost: Infinity, worst: Infinity };
    const x = i % w, y = (i / w) | 0;
    let cost = 0, worst = -Infinity;
    for (const [dx, dy, side] of SIDES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const b = megatileForTile(host, tiles[ny * w + nx]);
      if (b <= 0) continue;
      const s = seamStep(host, a, side, b);
      cost += Math.max(0, s);
      if (s > worst) worst = s;
    }
    return { cost, worst };
  };
  /**
   * A lower bound on a candidate's cost, from the edge means alone (a mean's difference never exceeds the mean
   * difference): a pool tile whose bound is no better than the best so far is not measured. Exact pruning, cheap.
   */
  const costAtLeast = (i: number, id: number) => {
    const a = megatileForTile(host, id);
    if (a <= 0) return Infinity;
    const x = i % w, y = (i / w) | 0;
    let lb = 0;
    for (const [dx, dy, side] of SIDES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const b = megatileForTile(host, tiles[ny * w + nx]);
      if (b <= 0) continue;
      const sa = SIDE_INDEX[side], sb = SIDE_INDEX[OPP[side]];
      const d = (Math.abs(means[a * 12 + sa * 3] - means[b * 12 + sb * 3]) + Math.abs(means[a * 12 + sa * 3 + 1] - means[b * 12 + sb * 3 + 1]) + Math.abs(means[a * 12 + sa * 3 + 2] - means[b * 12 + sb * 3 + 2])) / 3;
      lb += Math.max(0, d - (grain[a * 4 + sa] + grain[b * 4 + sb]) / 2);
    }
    return lb;
  };

  const hard = new Set<number>();
  const kept = new Set<number>();
  const usePool = new Set<number>();
  const fromPool = new Set<number>();
  for (const c of cells) {
    const list = own.get(c.i)!;
    if (list.length === 0) { if (pools.get(c.table)?.length) usePool.add(c.i); else hard.add(c.i); }
    tiles[c.i] = list[0] ?? hardTile(c);
  }
  const choose = () => {
    let changed = 0;
    for (const c of cells) {
      if (hard.has(c.i)) continue;
      // The ground's own tile stays where it already joins: a border tile only where one is needed.
      if (keepGround && !c.leansX && joins(c.i, before[c.i]).worst <= SEAM_SHOWS) {
        if (tiles[c.i] !== before[c.i]) { tiles[c.i] = before[c.i]; changed++; }
        kept.add(c.i);
        continue;
      }
      kept.delete(c.i);
      let best = tiles[c.i], bestCost = Infinity, bestPool = false;
      for (const id of own.get(c.i)!) {
        const v = joins(c.i, id).cost;
        if (v < bestCost) { bestCost = v; best = id; bestPool = false; }
      }
      if (usePool.has(c.i)) {
        for (const id of pools.get(c.table) ?? []) {
          if (costAtLeast(c.i, id) + POOL_COST >= bestCost) continue;
          const v = joins(c.i, id).cost + POOL_COST;
          if (v < bestCost) { bestCost = v; best = id; bestPool = true; }
        }
      }
      if (bestPool) fromPool.add(c.i); else fromPool.delete(c.i);
      if (best !== tiles[c.i]) { tiles[c.i] = best; changed++; }
    }
    return changed;
  };
  for (let round = 0; round < 6; round++) {
    for (let pass = 0; pass < 8; pass++) if (choose() === 0 && pass >= 1) break;
    let rejected = 0;
    for (const c of cells) {
      if (hard.has(c.i) || kept.has(c.i)) continue;
      if (joins(c.i, tiles[c.i]).worst > SEAM_SHOWS) {
        // a cell that could not use the pool yet gets it before it is given up
        if (!usePool.has(c.i) && pools.get(c.table)?.length) { usePool.add(c.i); rejected++; continue; }
        hard.add(c.i);
        tiles[c.i] = hardTile(c);
        fromPool.delete(c.i);
        rejected++;
      }
    }
    if (rejected === 0) break;
  }
  // A drawn piece's other half: where the rect's other tile is drawn, a kept ground tile cuts the line the two draw
  // across the rect, so it takes the shape's own tile instead wherever one joins.
  const byCell = new Map(cells.map((c) => [c.i, c]));
  for (const c of cells) {
    if (!kept.has(c.i)) continue;
    const other = byCell.get(c.shape.endsWith("|L") ? c.i + 1 : c.i - 1);
    if (!other || other.shape.slice(0, -2) !== c.shape.slice(0, -2) || kept.has(other.i) || hard.has(other.i)) continue;
    let best = -1, bestCost = Infinity;
    for (const id of own.get(c.i)!) {
      const j = joins(c.i, id);
      if (j.worst <= SEAM_SHOWS && j.cost < bestCost) { bestCost = j.cost; best = id; }
    }
    if (best >= 0) { tiles[c.i] = best; kept.delete(c.i); }
  }
  const drawn = cells.filter((c) => !hard.has(c.i) && !kept.has(c.i)).length;
  return { drawn, fromPool: fromPool.size, hard: hard.size, kept: kept.size, hardCells: [...hard], keptCells: [...kept], ms: performance.now() - t0 };
}

/** A shape without its stack values (`a,b,c,d|s1.0|L` → `a,b,c,d|L`): a table learned on another stand-in's stacks. */
function withoutStack(shape: string): string {
  const parts = shape.split("|");
  return parts.length === 3 ? `${parts[0]}|${parts[2]}` : shape;
}
