/**
 * The ground of a map as a unit walks it, for `scmjs map analyze`: a grid of minitiles (8 × 8 pixels, sixteen to a
 * tile), each walkable or not by the tileset's VF4 flags, with the ground under buildings and resources taken out.
 *
 * Why minitiles and not tiles: walkability is defined per minitile — a ramp, a cliff's edge or a doodad's foot is a
 * few minitiles, not a whole tile — and the game's own pathing is built on them too, so a tile grid would close
 * one-tile passages and open cliffs a unit cannot climb. A 128 × 128 map is 512 × 512 cells; a walk over all of them
 * is a few milliseconds.
 *
 * The pieces are the editor's Walkability plugin's (github.com/scm-js/plugin-walkability, `analysis.ts`, MIT, the same
 * authors), copied rather than imported because plugins are not in the command's bundle: the exact Euclidean distance
 * to the nearest wall (Felzenszwalb–Huttenlocher), the width of a passage through a cell, and Dial's algorithm with
 * straight steps of 5 and diagonal steps of 7 (an octile metric: 7/5 = 1.4 ≈ √2) that never cuts a wall's corner.
 */

export const CELL_PX = 8;
export const CELLS_PER_TILE = 4;
/** Step costs: a straight step is 5, a diagonal 7 (so a distance of 5 is one cell, 8 pixels). */
export const STRAIGHT = 5, DIAGONAL = 7;
/**
 * Cells of clearance a walking unit keeps from every wall: a cell is walked on only when no wall is directly beside it.
 * That is a small unit (Zergling, Marine, SCV, about two minitiles across), the Walkability plugin's default.
 */
export const UNIT_RADIUS = 1;

/** VF4 minitile flags (the tileset's `TileFlag`). */
const WALKABLE = 0x0001, MID = 0x0002, HIGH = 0x0004;

export interface Ground {
  /** In cells. */
  w: number;
  h: number;
  /** 1 on minitiles the tileset flags walkable. */
  walkable: Uint8Array;
  /** Ground height per cell: 0 low, 1 mid, 2 high. */
  level: Uint8Array;
  /** 1 under a building or a resource. */
  blocked: Uint8Array;
}

/** A box in map pixels, right and bottom exclusive. */
export interface PixelBox { left: number; top: number; right: number; bottom: number }

/**
 * The ground from a map's tiles: `flagsOf(tileId)` answers the sixteen VF4 words of the tile's megatile (row by row,
 * four to a row), or null for a tile with no picture, which is a wall as the game takes it.
 */
export function groundFromTiles(width: number, height: number, tiles: ArrayLike<number>, flagsOf: (tileId: number) => ArrayLike<number> | null): Ground {
  const w = width * CELLS_PER_TILE, h = height * CELLS_PER_TILE;
  const walkable = new Uint8Array(w * h), level = new Uint8Array(w * h);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const flags = flagsOf(tiles[ty * width + tx] ?? 0);
      if (!flags) continue;
      for (let m = 0; m < 16; m++) {
        const f = flags[m] ?? 0;
        const at = (ty * CELLS_PER_TILE + (m >> 2)) * w + tx * CELLS_PER_TILE + (m & 3);
        walkable[at] = f & WALKABLE ? 1 : 0;
        level[at] = f & HIGH ? 2 : f & MID ? 1 : 0;
      }
    }
  }
  return { w, h, walkable, level, blocked: new Uint8Array(w * h) };
}

/** Mark the cells under each box as blocked; how many walkable cells it took. */
export function blockBoxes(g: Ground, boxes: Iterable<PixelBox>): number {
  let n = 0;
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.left / CELL_PX)), y0 = Math.max(0, Math.floor(b.top / CELL_PX));
    const x1 = Math.min(g.w, Math.ceil(b.right / CELL_PX)), y1 = Math.min(g.h, Math.ceil(b.bottom / CELL_PX));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const at = y * g.w + x;
      if (!g.blocked[at]) { g.blocked[at] = 1; if (g.walkable[at]) n++; }
    }
  }
  return n;
}

/** 1 where a cell is walkable and nothing stands on it. */
export function openCells(g: Ground): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  for (let i = 0; i < out.length; i++) out[i] = g.walkable[i] && !g.blocked[i] ? 1 : 0;
  return out;
}

/**
 * Euclidean distance in cells from every open cell to the nearest closed one or the map's edge (0 on closed cells,
 * 1 with a wall directly beside, √2 with one diagonally beside). Exact: Felzenszwalb & Huttenlocher's transform.
 */
export function clearance(open: Uint8Array, w: number, h: number): Float32Array {
  const W = w + 2, H = h + 2, INF = 1e20;
  const f = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = x >= 1 && y >= 1 && x <= w && y <= h;
    f[y * W + x] = inside && open[(y - 1) * w + (x - 1)] ? INF : 0;
  }
  const len = Math.max(W, H);
  const v = new Int32Array(len), z = new Float64Array(len + 1), tmp = new Float64Array(len);
  const line = (offset: number, stride: number, count: number) => {
    for (let i = 0; i < count; i++) tmp[i] = f[offset + i * stride];
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < count; q++) {
      let s = ((tmp[q] + q * q) - (tmp[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((tmp[q] + q * q) - (tmp[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < count; q++) {
      while (z[k + 1] < q) k++;
      f[offset + q * stride] = (q - v[k]) * (q - v[k]) + tmp[v[k]];
    }
  };
  for (let x = 0; x < W; x++) line(x, W, H);
  for (let y = 0; y < H; y++) line(y * W, 1, W);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = y * w + x;
    out[at] = open[at] ? Math.sqrt(f[(y + 1) * W + x + 1]) : 0;
  }
  return out;
}

/** The cells a unit of `radius` cells walks on: open, with more than `radius` cells of clearance. */
export function passableCells(clear: Float32Array, radius = UNIT_RADIUS): Uint8Array {
  const out = new Uint8Array(clear.length);
  for (let i = 0; i < clear.length; i++) out[i] = clear[i] > radius ? 1 : 0;
  return out;
}

/**
 * `open` with every closed patch smaller than `minCells` (8-connected, not touching the map's edge) opened: the specks
 * of a doodad's shadow or a stray unwalkable minitile, which a unit walks round and which are no wall of a passage.
 */
export function withoutSpecks(open: Uint8Array, w: number, h: number, minCells: number): Uint8Array {
  const out = open.slice();
  const seen = new Uint8Array(w * h);
  const stack: number[] = [], patch: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (open[i] || seen[i]) continue;
    patch.length = 0;
    let edge = false;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const at = stack.pop()!;
      patch.push(at);
      const x = at % w, y = (at - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!open[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (!edge && patch.length < minCells) for (const at of patch) out[at] = 1;
  }
  return out;
}

/**
 * Ground distance from a cell to every cell, in steps (straight 5, diagonal 7; −1 where it cannot be walked to):
 * Dial's algorithm over the passable cells, a diagonal step only where both cells beside it are passable.
 */
export function distancesFrom(passable: Uint8Array, w: number, h: number, from: number): Int32Array {
  const n = w * h;
  const dist = new Int32Array(n).fill(-1);
  if (from < 0 || !passable[from]) return dist;
  const B = DIAGONAL + 1;
  const buckets: Int32Array[] = Array.from({ length: B }, () => new Int32Array(64));
  const lengths = new Int32Array(B);
  const push = (b: number, at: number) => {
    if (lengths[b] === buckets[b].length) { const grown = new Int32Array(buckets[b].length * 2); grown.set(buckets[b]); buckets[b] = grown; }
    buckets[b][lengths[b]++] = at;
  };
  dist[from] = 0;
  push(0, from);
  let pending = 1;
  for (let d = 0; pending > 0; d++) {
    const b = d % B;
    const count = lengths[b];
    lengths[b] = 0;
    // Pushes during this pass go to other buckets: every step costs at least 5.
    const list = buckets[b];
    for (let i = 0; i < count; i++) {
      const at = list[i];
      pending--;
      if (dist[at] !== d) continue;
      const x = at % w, y = (at - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if ((!dx && !dy) || nx < 0 || nx >= w) continue;
          const nb = ny * w + nx;
          if (!passable[nb]) continue;
          if (dx && dy && (!passable[y * w + nx] || !passable[ny * w + x])) continue;
          const nd = d + (dx && dy ? DIAGONAL : STRAIGHT);
          if (dist[nb] < 0 || nd < dist[nb]) { dist[nb] = nd; push(nd % B, nb); pending++; }
        }
      }
    }
  }
  return dist;
}

/**
 * Ground distances from a cell as `distancesFrom` measures them, only as far as `limit` steps: a map of the cells
 * reached. For the short walks between a base's resources, where a whole map's field would be waste.
 */
export function distancesWithin(passable: Uint8Array, w: number, h: number, from: number, limit: number): Map<number, number> {
  const dist = new Map<number, number>();
  if (from < 0 || !passable[from]) return dist;
  const buckets: number[][] = [[from]];
  dist.set(from, 0);
  for (let d = 0; d <= limit && d < buckets.length; d++) {
    for (const at of buckets[d] ?? []) {
      if (dist.get(at) !== d) continue;
      const x = at % w, y = (at - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nb = ny * w + nx;
        if (!passable[nb] || (dx && dy && (!passable[y * w + nx] || !passable[ny * w + x]))) continue;
        const nd = d + (dx && dy ? DIAGONAL : STRAIGHT);
        if (nd > limit) continue;
        const old = dist.get(nb);
        if (old === undefined || nd < old) { dist.set(nb, nd); (buckets[nd] ??= []).push(nb); }
      }
    }
  }
  return dist;
}

/** Steps to pixels. */
export const stepsToPx = (steps: number): number => (steps / STRAIGHT) * CELL_PX;

/**
 * The cells of a shortest walk to `to`, from the cell the distances were measured from, in walking order: followed
 * back from `to` down the distances, preferring straight steps. Empty when `to` was not reached.
 */
export function pathTo(dist: Int32Array, passable: Uint8Array, w: number, h: number, to: number): number[] {
  if (to < 0 || dist[to] < 0) return [];
  const out = [to];
  let at = to;
  while (dist[at] > 0) {
    const x = at % w, y = (at - x) / w;
    let next = -1;
    for (const diagonal of [false, true]) {
      for (let dy = -1; dy <= 1 && next < 0; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || !!(dx && dy) !== diagonal) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nb = ny * w + nx;
        if (dist[nb] < 0 || dist[nb] + (diagonal ? DIAGONAL : STRAIGHT) !== dist[at]) continue;
        if (diagonal && (!passable[y * w + nx] || !passable[ny * w + x])) continue;
        next = nb;
        break;
      }
      if (next >= 0) break;
    }
    if (next < 0) break; // cannot happen on a field distancesFrom made
    out.push(next);
    at = next;
  }
  return out.reverse();
}

/** The passable cell nearest (x, y) by rings, within `reach` cells; −1 when there is none. */
export function nearestCell(passable: Uint8Array, w: number, h: number, x: number, y: number, reach = 48): number {
  const cx = Math.min(w - 1, Math.max(0, Math.floor(x))), cy = Math.min(h - 1, Math.max(0, Math.floor(y)));
  for (let r = 0; r <= reach; r++) {
    let best = -1, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !passable[ny * w + nx]) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = ny * w + nx; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * How wide the passage through a cell is, in cells: the shortest straight line through it from wall to wall, across,
 * down or along either diagonal (a diagonal line crosses √2 cells a step).
 */
export function passageWidth(open: Uint8Array, w: number, h: number, x: number, y: number): number {
  if (!open[y * w + x]) return 0;
  const run = (dx: number, dy: number) => {
    let n = 0, cx = x + dx, cy = y + dy;
    while (cx >= 0 && cy >= 0 && cx < w && cy < h && open[cy * w + cx]) { n++; cx += dx; cy += dy; }
    return n;
  };
  const straight = Math.min(run(1, 0) + run(-1, 0), run(0, 1) + run(0, -1)) + 1;
  const diagonal = (Math.min(run(1, 1) + run(-1, -1), run(1, -1) + run(-1, 1)) + 1) * Math.SQRT2;
  return Math.min(straight, diagonal);
}

/** The narrowest passage a walk goes through: the cell and its width in cells, the first `skip` cells at either end left out. */
export function narrowestOn(path: readonly number[], open: Uint8Array, w: number, h: number, skip: number): { cell: number; width: number } | null {
  let best: { cell: number; width: number } | null = null;
  for (let i = skip; i < path.length - skip; i++) {
    const at = path[i], x = at % w, y = (at - x) / w;
    const width = passageWidth(open, w, h, x, y);
    if (!best || width < best.width) best = { cell: at, width };
  }
  return best;
}
