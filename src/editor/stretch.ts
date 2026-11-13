/**
 * Stretching a piece of terrain: a ramp made wider, a bridge made longer, a cliff piece
 * carried on.
 *
 * Map makers do this by hand. A ramp doodad is two side walls with a body between them
 * and a bridge two ends with a deck between them, and the long ramps and bridges of
 * modern maps are those pieces pulled apart with the middle laid again and again in the
 * gap. Nothing in the game's data says where the middle is, so this finds it the way
 * the Blend brush finds a neighbour, from the pixels.
 *
 * A stretch goes along one of four axes (`STRETCH_STEP`): the two diagonals an isometric
 * cliff runs on, two tiles across for one down or up, and the two straight ones. The
 * straight-across step is two tiles as well, since ground is drawn in left and right
 * halves and a tile laid one column over would put two left halves side by side. The
 * cells of the piece that lie on one line along the axis form a *line*; a stretch by
 * `n` steps lays one cell of every line `n` more times and moves the rest of the line
 * along. Which cell — the *cut* — is what `stretchPlan` works out: the choice per line
 * that leaves the least visible seams in a stretched piece, with a tile beside bare
 * ground counted as a seam where the piece as shipped has none there, and a slight pull
 * towards the middle so that a piece that could be cut anywhere is cut through its
 * centre. A seam is measured two ways, by the Blend brush's edge distance and by the
 * step the Seam Overlay draws, and the cut is searched by each: neither finds the best
 * one for every doodad.
 *
 * Everything here is pure and canvas-free; `tests/stretch.test.ts` runs it against a
 * synthetic tileset and, where they are installed, the game's.
 */
import { megatileForTile, megatileHeight, TileFlag, type Tileset } from "../formats/tileset/decode";
import type { DoodadDef } from "../formats/tileset/doodads";
import { edgeDistance, edgeTable, SEAM_SHOWS, seamStep, type EdgeTable } from "./blend";

export type StretchAxis = "se" | "ne" | "e" | "s";

export const STRETCH_AXES: readonly StretchAxis[] = ["se", "ne", "e", "s"];

/** One step along each axis, in tiles. */
export const STRETCH_STEP: Record<StretchAxis, { dx: number; dy: number }> = {
  se: { dx: 2, dy: 1 },
  ne: { dx: 2, dy: -1 },
  e: { dx: 2, dy: 0 },
  s: { dx: 0, dy: 1 },
};

/** A rectangle of tiles, row-major; 0 where it leaves the map alone. A `DoodadDef` is one. */
export interface TilePiece {
  width: number;
  height: number;
  tiles: ArrayLike<number>;
  /** The CV5 group StarEdit wants under each cell, as a doodad has it. */
  required?: ArrayLike<number>;
}

export interface StretchPlan {
  axis: StretchAxis;
  /** Cell indices (row-major) of each line, in the order the axis runs. */
  lines: number[][];
  /** For each line, the position within it of the cell a stretch repeats. */
  cut: number[];
  /**
   * For each line, the tile the added cells get: the repeated cell's own, or one borrowed
   * from elsewhere in the piece where the cell's own would leave a rock standing on
   * ground a unit walks (see `borrowFloor`).
   */
  fill: number[];
  /**
   * How the seams a stretch adds compare with a visible one: the mean edge distance over
   * the joins the piece as shipped does not have (0 when it adds none), and how many of
   * them there are per step.
   */
  seam: number;
  seamsPerStep: number;
  /** How many of those joins per step View ▸ Seam Overlay draws (`seamStep` over `SEAM_SHOWS`). */
  shownPerStep: number;
  /**
   * The share of the minitile pairs facing each other across those added joins where one
   * can be walked and the other cannot: a wall end against open ground, which a doodad
   * as shipped has little of. 0 when the stretch adds no joins.
   */
  walkBreaks: number;
  /**
   * The pieces of wall and of floor a step of the stretch adds beyond those the piece as
   * shipped has: a rock left standing in the middle of a slope, a stretch of deck cut off
   * from the rest. 0 for a stretch that only makes the same walls and floors longer.
   */
  islandsPerStep: number;
  /**
   * Whether the ground the piece stands on carries on along the axis: the share of cell
   * pairs one step apart that want the same ground under them. Null for a piece that
   * says nothing about its ground.
   */
  groundContinues: number | null;
}

export interface StretchedPiece {
  width: number;
  height: number;
  tiles: Uint16Array;
  required: Uint16Array;
  /** 1 for the cells the stretch added. */
  added: Uint8Array;
  /** Where the top-left tile lands, relative to the top-left of the piece as shipped. */
  offset: { x: number; y: number };
}

/** A tile set beside bare ground where the piece as shipped has a tile: as bad as flat ground against a cliff. */
const BARE_COST = 48;
/** Steps the plan is judged at; a cut that tiles for three steps tiles for any number. */
const JUDGED_STEPS = 3;
/** What a line's cut costs per cell of distance from the piece's centre, against seams that run 5–50. */
const CENTRE_PULL = 1.5;
/** A seam the eye finds, as the Blend brush draws the line (`DEFAULT_BLEND_OPTIONS.maxDistance`). */
export const VISIBLE_SEAM = 16;
/**
 * What makes an axis one a piece stretches along (`soundAxes`), measured over every ramp
 * and bridge of the eight tilesets. Along the cliff a ramp was drawn for 78–100% of its
 * ground carries on, along any other line at most 54%. Along the deck of a bridge 0–11%
 * of the facing minitiles break, across it 13–50%. The second gap is narrow, and the
 * bridges nearest it (Ice) are the ones that join worst whichever way they go.
 */
export const SOUND_GROUND = 0.7;
export const SOUND_WALK_BREAKS = 0.12;

function linesOf(piece: TilePiece, axis: StretchAxis): number[][] {
  const { dx, dy } = STRETCH_STEP[axis];
  const { width, height } = piece;
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < width && r < height;
  const seen = new Uint8Array(width * height);
  const out: number[][] = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (seen[r * width + c]) continue;
      let sc = c, sr = r;
      while (inside(sc - dx, sr - dy)) { sc -= dx; sr -= dy; }
      const line: number[] = [];
      for (let x = sc, y = sr; inside(x, y); x += dx, y += dy) {
        line.push(y * width + x);
        seen[y * width + x] = 1;
      }
      out.push(line);
    }
  }
  return out;
}

/** The stretched piece for a cut. `steps` may be negative: the far end stays put and the near end moves back. */
function build(piece: TilePiece, axis: StretchAxis, lines: readonly number[][], cut: readonly number[], steps: number, fill?: readonly number[]): StretchedPiece {
  const { dx, dy } = STRETCH_STEP[axis];
  const n = Math.abs(steps);
  const width = piece.width + dx * n, height = piece.height + Math.abs(dy) * n;
  // Rows shift down when the axis climbs, so that the piece's first line still starts inside.
  const shiftY = dy < 0 ? -dy * n : 0;
  const tiles = new Uint16Array(width * height), required = new Uint16Array(width * height), added = new Uint8Array(width * height);
  lines.forEach((line, i) => {
    const m = cut[i];
    const c0 = line[0] % piece.width, r0 = (line[0] / piece.width) | 0;
    for (let j = 0; j < line.length + n; j++) {
      const cell = line[j < m ? j : j <= m + n ? m : j - n];
      const at = (r0 + dy * j + shiftY) * width + c0 + dx * j;
      const isAdded = j > m && j <= m + n;
      tiles[at] = isAdded && fill ? fill[i] : piece.tiles[cell];
      // An added cell stands on the ground its line's repeated cell stands on, whatever tile it shows.
      required[at] = piece.required?.[cell] ?? 0;
      if (isAdded) added[at] = 1;
    }
  });
  const forward = steps >= 0;
  return {
    width, height, tiles, required, added,
    // `|| 0`: a count of nothing would otherwise leave a negative zero behind.
    offset: { x: (forward ? 0 : -dx * n) || 0, y: (forward ? -shiftY : dy > 0 ? -dy * n : 0) || 0 },
  };
}

const H = 0, V = 1;

/** What a join is measured by while the cut is searched for. */
type SeamMeasure = "edge" | "step";

/** Seam costs between the piece's own tiles, with the joins it ships with remembered. */
class Seams {
  private readonly edges: EdgeTable;
  private readonly memo = new Map<number, number>();
  private readonly stepMemo = new Map<number, number>();
  /** `tile * 4 + side` for every side of a tile that the piece as shipped leaves bare (side: 0 left, 1 top, 2 right, 3 bottom). */
  private readonly bare = new Set<number>();
  /** `(a * 65536 + b) * 2 + orientation` for every pair the piece as shipped joins. */
  private readonly shipped = new Set<number>();

  private readonly tileset: Tileset;

  constructor(tileset: Tileset, piece: TilePiece) {
    this.tileset = tileset;
    this.edges = edgeTable(tileset);
    const { width, height, tiles } = piece;
    const at = (c: number, r: number) => (c < 0 || r < 0 || c >= width || r >= height ? 0 : tiles[r * width + c]);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const a = at(c, r);
        if (!a) continue;
        const right = at(c + 1, r), below = at(c, r + 1);
        if (right) this.shipped.add(this.key(a, right, H)); else this.bare.add(a * 4 + 2);
        if (below) this.shipped.add(this.key(a, below, V)); else this.bare.add(a * 4 + 3);
        if (!at(c - 1, r)) this.bare.add(a * 4);
        if (!at(c, r - 1)) this.bare.add(a * 4 + 1);
      }
    }
  }

  private key(a: number, b: number, o: number) { return (a * 65536 + b) * 2 + o; }

  isShipped(a: number, b: number, o: number) { return this.shipped.has(this.key(a, b, o)); }

  /**
   * `a` with `b` to its right (H) or below it (V); either may be 0 for bare ground. By
   * `edge`, how unlike the two rows of pixels that meet are; by `step`, that less the
   * grain of the two pictures there, which is what the Seam Overlay draws.
   */
  cost(a: number, b: number, o: number, measure: SeamMeasure = "edge"): number {
    if (!a && !b) return 0;
    if (!a) return this.bare.has(b * 4 + (o === H ? 0 : 1)) ? 0 : BARE_COST;
    if (!b) return this.bare.has(a * 4 + (o === H ? 2 : 3)) ? 0 : BARE_COST;
    return measure === "edge" ? this.edge(a, b, o) : Math.max(0, this.step(a, b, o));
  }

  private edge(a: number, b: number, o: number): number {
    const key = this.key(a, b, o);
    let d = this.memo.get(key);
    if (d === undefined) {
      const ma = megatileForTile(this.tileset, a), mb = megatileForTile(this.tileset, b);
      d = o === H ? edgeDistance(this.edges, ma, "right", mb, "left") : edgeDistance(this.edges, ma, "bottom", mb, "top");
      this.memo.set(key, d);
    }
    return d;
  }

  /** The step the Seam Overlay measures between two tiles (`seamStep`); over `SEAM_SHOWS` it draws the join. */
  step(a: number, b: number, o: number): number {
    const key = this.key(a, b, o);
    let d = this.stepMemo.get(key);
    if (d === undefined) {
      d = seamStep(this.tileset, megatileForTile(this.tileset, a), o === H ? "right" : "bottom", megatileForTile(this.tileset, b));
      this.stepMemo.set(key, d);
    }
    return d;
  }

  /** Every join of a stretched piece, the outline included. */
  total(g: StretchedPiece, measure: SeamMeasure = "edge"): number {
    const { width, height, tiles } = g;
    let sum = 0;
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const a = tiles[r * width + c];
        const right = c + 1 < width ? tiles[r * width + c + 1] : 0, below = r + 1 < height ? tiles[(r + 1) * width + c] : 0;
        sum += this.cost(a, right, H, measure);
        sum += this.cost(a, below, V, measure);
        if (c === 0) sum += this.cost(0, a, H, measure);
        if (r === 0) sum += this.cost(0, a, V, measure);
      }
    }
    return sum;
  }

  /** Whether the four minitiles along one side of a tile can be walked (side: 0 left, 1 top, 2 right, 3 bottom). */
  private walks(tile: number, side: number): boolean[] {
    const base = megatileForTile(this.tileset, tile) * 16;
    const out: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const minitile = side === 0 ? i * 4 : side === 2 ? i * 4 + 3 : side === 1 ? i : 12 + i;
      out.push(((this.tileset.megatileFlags[base + minitile] ?? 0) & TileFlag.Walkable) !== 0);
    }
    return out;
  }

  /**
   * The joins between two tiles that the piece as shipped does not have: their seam
   * costs, and the share of the minitile pairs across them that differ in whether they
   * walk.
   */
  fresh(g: StretchedPiece): { seams: number[]; walkBreaks: number; shown: number; steps: number } {
    const { width, height, tiles } = g;
    const seams: number[] = [];
    let pairs = 0, breaks = 0, shown = 0, steps = 0;
    const join = (a: number, b: number, o: number) => {
      if (!b || this.isShipped(a, b, o)) return;
      seams.push(this.cost(a, b, o));
      const step = this.step(a, b, o);
      if (step > SEAM_SHOWS) { shown++; steps += step; }
      const near = this.walks(a, o === H ? 2 : 3), far = this.walks(b, o === H ? 0 : 1);
      for (let i = 0; i < 4; i++) { pairs++; if (near[i] !== far[i]) breaks++; }
    };
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const a = tiles[r * width + c];
        if (!a) continue;
        join(a, c + 1 < width ? tiles[r * width + c + 1] : 0, H);
        join(a, r + 1 < height ? tiles[(r + 1) * width + c] : 0, V);
      }
    }
    return { seams, walkBreaks: pairs ? breaks / pairs : 0, shown, steps };
  }

  /**
   * How many separate pieces of floor and of wall a grid of tiles has, minitile by
   * minitile: floor joined along its sides, wall along its corners too (two rocks that
   * touch at a corner are one obstacle, and no unit passes between them). Bare cells are
   * neither. A stretch that only makes a doodad longer leaves this number alone.
   */
  islands(g: { width: number; height: number; tiles: ArrayLike<number> }): number {
    const w = g.width * 4, h = g.height * 4;
    // 0 bare, 1 floor, 2 wall
    const kind = new Uint8Array(w * h);
    const flags = this.tileset.megatileFlags;
    for (let r = 0; r < g.height; r++) {
      for (let c = 0; c < g.width; c++) {
        const tile = g.tiles[r * g.width + c];
        if (!tile) continue;
        const base = megatileForTile(this.tileset, tile) * 16;
        for (let m = 0; m < 16; m++) kind[(r * 4 + (m >> 2)) * w + c * 4 + (m & 3)] = (flags[base + m] ?? 0) & TileFlag.Walkable ? 1 : 2;
      }
    }
    const stack = new Int32Array(w * h);
    let count = 0;
    for (let start = 0; start < kind.length; start++) {
      const k = kind[start];
      if (k === 0 || k > 2) continue;
      count++;
      let top = 0;
      stack[top++] = start;
      kind[start] = k + 2; // seen
      while (top > 0) {
        const at = stack[--top];
        const x = at % w, y = (at / w) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx === 0 && dy === 0) || (k === 1 && dx !== 0 && dy !== 0)) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const n = ny * w + nx;
            if (kind[n] !== k) continue;
            kind[n] = k + 2;
            stack[top++] = n;
          }
        }
      }
    }
    return count;
  }
}

/** Which of a tile's sixteen minitiles a unit can walk, a bit each. */
function walkMask(tileset: Tileset, tile: number): number {
  const base = megatileForTile(tileset, tile) * 16;
  let mask = 0;
  for (let m = 0; m < 16; m++) if ((tileset.megatileFlags[base + m] ?? 0) & TileFlag.Walkable) mask |= 1 << m;
  return mask;
}

/**
 * The second pass over a plan, for the rocks the first leaves. The cut is chosen on looks,
 * and on some lines the cell that looks best is the tip of a wall: mostly floor, with two
 * or three minitiles of rock, which a stretch then stands on the walking surface at every
 * step. For such a line the added cells may show another of the piece's tiles instead,
 * on three conditions that keep this from doing what the failed attempts did (see the
 * note in .claude/internals/objects.md):
 *
 * - the tile walks everywhere the repeated cell walks, so it can only add floor, never
 *   lay wall across a slope;
 * - it is at the height the game takes the repeated cell to be at;
 * - the stretched piece ends up with fewer separate pieces of wall and floor than before,
 *   so a wall's edge that carries on along the axis is left alone (trading it for floor
 *   removes nothing), and only a rock that stood by itself goes.
 *
 * Among the tiles that qualify, the one that joins its neighbours best. Returns the fill
 * per line, the repeated cells' own where nothing was borrowed.
 */
function borrowFloor(tileset: Tileset, piece: TilePiece, axis: StretchAxis, lines: readonly number[][], cut: readonly number[], seams: Seams, measure: SeamMeasure): number[] {
  const fill = lines.map((line, i) => piece.tiles[line[cut[i]]]);
  // What a step adds, not what the stretch has: pulling the ends apart can part two rocks
  // the doodad ships touching, once, and that is nothing a tile could mend.
  const perStep = () => seams.islands(build(piece, axis, lines, cut, JUDGED_STEPS, fill)) - seams.islands(build(piece, axis, lines, cut, JUDGED_STEPS - 1, fill));
  if (perStep() <= 0) return fill;
  let islands = seams.islands(build(piece, axis, lines, cut, JUDGED_STEPS, fill));

  const pool = [...new Set(Array.from(piece.tiles).filter((t) => t !== 0))];
  const masks = new Map(pool.map((t) => [t, walkMask(tileset, t)]));
  const heights = new Map(pool.map((t) => [t, megatileHeight(tileset, megatileForTile(tileset, t))]));
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const own = piece.tiles[lines[i][cut[i]]];
      const mask = masks.get(own) ?? 0;
      if (own === 0 || mask === 0 || mask === 0xffff) continue; // bare, all wall or all floor: nothing to mend
      const before = fill[i];
      let best: { tile: number; islands: number; seam: number } | null = null;
      for (const tile of pool) {
        if (tile === before || ((masks.get(tile) ?? 0) & mask) !== mask || heights.get(tile) !== heights.get(own)) continue;
        fill[i] = tile;
        const g = build(piece, axis, lines, cut, JUDGED_STEPS, fill);
        const count = seams.islands(g);
        if (count >= islands) continue;
        const seam = seams.total(g, measure);
        if (!best || count < best.islands || (count === best.islands && seam < best.seam)) best = { tile, islands: count, seam };
      }
      fill[i] = best ? best.tile : before;
      if (best) { islands = best.islands; changed = true; }
    }
    if (!changed || perStep() <= 0) break;
  }
  return fill;
}

/** The share of cell pairs one step apart along `axis` that want the same ground; null when no two do. */
function groundContinues(piece: TilePiece, axis: StretchAxis): number | null {
  const { required, width, height } = piece;
  if (!required) return null;
  const { dx, dy } = STRETCH_STEP[axis];
  let pairs = 0, same = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c + dx < width; c++) {
      const r2 = r + dy;
      if (r2 < 0 || r2 >= height) continue;
      const a = required[r * width + c], b = required[r2 * width + c + dx];
      if (!a || !b) continue;
      pairs++;
      if (a === b) same++;
    }
  }
  return pairs ? same / pairs : null;
}

const plans = new WeakMap<object, Map<StretchAxis, StretchPlan>>();

/**
 * Where to cut `piece` for a stretch along `axis`. Cached on the piece's `tiles` (a
 * doodad's are made once per tileset), so a drag asks once.
 */
export function stretchPlan(tileset: Tileset, piece: TilePiece, axis: StretchAxis): StretchPlan {
  const cacheKey = piece.tiles as object;
  let byAxis = plans.get(cacheKey);
  if (!byAxis) plans.set(cacheKey, (byAxis = new Map()));
  const cached = byAxis.get(axis);
  if (cached) return cached;

  const { dx, dy } = STRETCH_STEP[axis];
  const lines = linesOf(piece, axis);
  const seams = new Seams(tileset, piece);
  const cx = (piece.width - 1) / 2, cy = (piece.height - 1) / 2;
  /**
   * How far a cell is from the line across the piece's centre, in steps, measured two
   * ways. Square to the axis on the tile grid suits a compact piece, a ramp. Along the
   * other diagonal, which is what "across" is on the isometric ground the tiles draw,
   * suits a long one crossed the short way: a bridge that runs down-right is crossed by
   * lines running up-right, and measured the square way the middle of its left end comes
   * out as its far rail and the middle of its right end as its near one, so a bridge made
   * wider had its rails laid again instead of its deck. Neither is right for both, so the
   * cut is searched from each and the one that joins better is kept.
   */
  const square = (cell: number) => Math.abs(((cell % piece.width) - cx) * dx + (((cell / piece.width) | 0) - cy) * dy) / (dx * dx + dy * dy);
  const isometric = (cell: number) => Math.abs(((cell % piece.width) - cx) / (2 * dx) + (((cell / piece.width) | 0) - cy) / (2 * dy));

  /** The cut that leaves the least, pulled towards the middle as `off` measures it, and what it leaves. */
  const search = (off: (cell: number) => number, measure: SeamMeasure): { cut: number[]; left: number; measure: SeamMeasure } => {
    // Start from the cut straight across the middle.
    const cut = lines.map((line) => {
      let best = 0;
      for (let i = 1; i < line.length; i++) if (off(line[i]) < off(line[best])) best = i;
      return best;
    });
    const pull = () => CENTRE_PULL * JUDGED_STEPS * lines.reduce((s, line, i) => s + off(line[cut[i]]), 0);
    // Looks alone choose the cut. Two attempts to have walkability choose it too made things
    // worse, since a cut can always buy clean walking by laying a wall across the slope: see
    // the note in .claude/internals/objects.md before trying a third.
    const score = () => seams.total(build(piece, axis, lines, cut, JUDGED_STEPS), measure) + pull();

    // One line at a time, to the cell that leaves the least; a few passes settle it, since a
    // line only meets the ones beside it.
    let current = score();
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (let i = 0; i < lines.length; i++) {
        const keep = cut[i];
        let best = keep, bestScore = current;
        for (let alt = 0; alt < lines[i].length; alt++) {
          if (alt === keep) continue;
          cut[i] = alt;
          const s = score();
          if (s < bestScore - 1e-6) { bestScore = s; best = alt; }
        }
        cut[i] = best;
        if (best !== keep) { moved = true; current = bestScore; }
      }
      if (!moved) break;
    }
    return { cut, left: seams.total(build(piece, axis, lines, cut, JUDGED_STEPS)), measure };
  };
  /** A cut made into a plan: mended, and measured. */
  const finish = ({ cut, left, measure }: { cut: number[]; left: number; measure: SeamMeasure }): { plan: StretchPlan; left: number; steps: number } => {
    // What tells a sound axis from a mess is measured on the cut as looks chose it, before any
    // mending: a measure stops telling once something is done to improve it.
    const { walkBreaks } = seams.fresh(build(piece, axis, lines, cut, JUDGED_STEPS));
    const fill = borrowFloor(tileset, piece, axis, lines, cut, seams, measure);
    const judged = build(piece, axis, lines, cut, JUDGED_STEPS, fill);
    const fresh = seams.fresh(judged);
    return {
      left,
      steps: fresh.steps,
      plan: {
        axis, lines, cut, fill,
        seam: fresh.seams.length ? fresh.seams.reduce((s, v) => s + v, 0) / fresh.seams.length : 0,
        seamsPerStep: fresh.seams.length / JUDGED_STEPS,
        shownPerStep: fresh.shown / JUDGED_STEPS,
        walkBreaks,
        islandsPerStep: Math.max(0, seams.islands(judged) - seams.islands(build(piece, axis, lines, cut, JUDGED_STEPS - 1, fill))),
        groundContinues: groundContinues(piece, axis),
      },
    };
  };
  // Four cuts on a diagonal, two on a straight axis (where the two middles are one): each
  // middle, searched by each measure of a join. By the edge difference alone the Twilight
  // ramps laid a lamp post and the plateau's paving down the slope, tiles whose last row of
  // pixels happens to be near the slope's; by the overlay's step alone the Badlands, Jungle
  // and Ashworld cliff ramps got a cut that leaves rocks. Of the cuts, the one that walks
  // more as the piece does (nothing left standing in the way, then fewer walls set against
  // floor), and among those that walk alike, the one with the fewest joins that show.
  const found = [finish(search(square, "edge")), finish(search(square, "step"))];
  if (dx !== 0 && dy !== 0) found.push(finish(search(isometric, "edge")), finish(search(isometric, "step")));
  type Found = (typeof found)[number];
  const order = (a: Found, b: Found): number => {
    if (a.plan.islandsPerStep !== b.plan.islandsPerStep) return a.plan.islandsPerStep - b.plan.islandsPerStep;
    if (Math.abs(a.plan.walkBreaks - b.plan.walkBreaks) > 1e-9) return a.plan.walkBreaks - b.plan.walkBreaks;
    if (a.plan.shownPerStep !== b.plan.shownPerStep) return a.plan.shownPerStep - b.plan.shownPerStep;
    if (Math.abs(a.steps - b.steps) > 1e-6) return a.steps - b.steps;
    return a.left - b.left;
  };
  let chosen = found[0];
  for (const f of found) if (order(f, chosen) < 0) chosen = f;
  const { plan } = chosen;
  byAxis.set(axis, plan);
  return plan;
}

/**
 * The axes `piece` stretches along, as opposed to the ones a stretch only makes a mess
 * on. How well the pictures join does not tell them apart (a ramp smeared across its
 * cliff seams about as well as one widened along it), so two other things do:
 *
 * - A ramp stretches the way its ground carries on: the cliff it cuts runs along the
 *   axis, so the stretched ramp still has a cliff to stand in, and the ground check
 *   will pass on a straight cliff. And only if what a step adds walks as the ramp does:
 *   a ramp two tiles wide, built into a wall, has both its sides in every tile, and
 *   stretched it is a row of half ramps with wedges of wall between them.
 * - Anything else stretches where the joins a stretch adds do not set wall against
 *   floor: a bridge along its deck, rail carrying on into rail and road into road. Across
 *   the deck every step puts rail ends against the road.
 *
 * A bridge's ground is no guide: it carries on *across* the bridge, along the channel.
 */
export function soundAxes(tileset: Tileset, piece: TilePiece & { ramp?: boolean }): StretchAxis[] {
  const plans = STRETCH_AXES.map((axis) => stretchPlan(tileset, piece, axis));
  if (piece.ramp) return plans.filter((p) => p.groundContinues !== null && p.groundContinues >= SOUND_GROUND && p.islandsPerStep === 0).map((p) => p.axis);
  return plans.filter((p) => p.walkBreaks <= SOUND_WALK_BREAKS).map((p) => p.axis);
}

/** `piece` stretched by `steps` along the plan's axis; a negative count stretches back from the far end. */
export function stretchPiece(piece: TilePiece, plan: StretchPlan, steps: number): StretchedPiece {
  return build(piece, plan.axis, plan.lines, plan.cut, steps, plan.fill);
}

/** A doodad stretched: the same doodad with a larger footprint, for the ghost, the ground check and the placement. */
export interface StretchedDoodad extends DoodadDef {
  stretched: { axis: StretchAxis; steps: number; plan: StretchPlan; offset: { x: number; y: number }; from: DoodadDef };
}

export function stretchDoodad(tileset: Tileset, def: DoodadDef, axis: StretchAxis, steps: number): StretchedDoodad {
  const plan = stretchPlan(tileset, def, axis);
  const g = stretchPiece(def, plan, steps);
  return { ...def, width: g.width, height: g.height, tiles: g.tiles, required: g.required, stretched: { axis, steps, plan, offset: g.offset, from: def } };
}

export const isStretched = (def: DoodadDef): def is StretchedDoodad => (def as Partial<StretchedDoodad>).stretched !== undefined;

/**
 * The stretch a drag asks for: the axis the drag lies closest to and how many steps along
 * it (negative against the axis), from the drag in map pixels. A drag shorter than half
 * a step is no stretch.
 */
export function stretchFromDrag(dxPx: number, dyPx: number, axes: readonly StretchAxis[] = STRETCH_AXES): { axis: StretchAxis; steps: number } {
  let best: { axis: StretchAxis; steps: number } = { axis: axes[0] ?? "se", steps: 0 };
  let bestMiss = Infinity;
  for (const axis of axes) {
    const sx = STRETCH_STEP[axis].dx * 32, sy = STRETCH_STEP[axis].dy * 32;
    const along = (dxPx * sx + dyPx * sy) / (sx * sx + sy * sy);
    const steps = Math.round(along);
    if (steps === 0) continue;
    // How far the pointer is from the axis itself, so the drag picks the direction and the length the count.
    const miss = Math.hypot(dxPx - along * sx, dyPx - along * sy);
    if (miss < bestMiss) { bestMiss = miss; best = { axis, steps }; }
  }
  return best;
}
