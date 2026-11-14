/**
 * The Heal brush: where a tile joins its neighbours visibly, lay in its place one that
 * joins them better and is, to the game, the same tile.
 *
 * "The same to the game" is the whole of the brush's promise. A candidate has the
 * sixteen VF4 flag words of the tile it replaces, bit for bit (what walks, at what
 * height, what blocks sight, what is ramp), and its CV5 group has the same flag word
 * (buildable or not, creep, cover). Nothing a unit, a building or a shot could notice
 * changes; only the picture does. And the picture stays the kind of ground it was: a
 * candidate's mean colour is near the old tile's, so dirt is not traded for grass that
 * happens to end on the right pixels.
 *
 * What "joins better" means is the Seam Overlay's measure (`seamStep` in blend.ts), summed
 * over the tile's four sides, so the brush mends what the overlay marks.
 *
 * Pure and canvas-free; `tests/heal.test.ts`.
 */
import type { Scenario } from "../formats/chk/scenario";
import { megatileForTile, tileGroupOf, type Tileset } from "../formats/tileset/decode";
import { drawableTiles, SEAM_SHOWS, seamStep, SIDES, type Side } from "./blend";
import type { TileChange } from "./terrain";

/**
 * With as many of its joins showing as before, a tile is replaced only when they get
 * better by at least this much in all. (The first cut of the brush replaced any tile
 * whose joins improved, and over one of the game's own Badlands maps that was a fifth of
 * the ground, one variation of dirt traded for another, for a tenth fewer lines.)
 */
export const HEAL_GAIN = 6;
/** How far a candidate's mean colour may be from the old tile's, per channel on average. */
export const HEAL_SAME_GROUND = 14;

interface HealTables {
  /** Tiles by what they are to the game: the key is the group's flag word and the megatile's sixteen flag words. */
  byKind: Map<string, number[]>;
  kindOf: Map<number, string>;
  /** `megatile * 3` → mean R, G, B. */
  means: Float32Array;
}

const tables = new WeakMap<Tileset, HealTables>();

/**
 * What a tile is to the game, as a string: its CV5 group's flag word and its megatile's sixteen
 * VF4 words. Two tiles with the same key walk, build, block sight and stand at the same height
 * alike; the Tile palette's lists also take it as half of "the same tile" (`tileCopies.ts`).
 */
export function kindKey(tileset: Tileset, tile: number): string {
  const group = tileset.groups[tileGroupOf(tile, tileset.groups.length)];
  const base = megatileForTile(tileset, tile) * 16;
  let key = String(group?.flags ?? 0);
  for (let m = 0; m < 16; m++) key += `,${tileset.megatileFlags[base + m] ?? 0}`;
  return key;
}

function healTables(tileset: Tileset): HealTables {
  const cached = tables.get(tileset);
  if (cached) return cached;
  const byKind = new Map<string, number[]>();
  const kindOf = new Map<number, string>();
  for (const tile of drawableTiles(tileset)) {
    const key = kindKey(tileset, tile);
    kindOf.set(tile, key);
    const list = byKind.get(key);
    if (list) list.push(tile);
    else byKind.set(key, [tile]);
  }
  const means = new Float32Array(tileset.megatileCount * 3);
  const { palette, minitiles, megatileRefs } = tileset;
  for (let megatile = 0; megatile < tileset.megatileCount; megatile++) {
    let r = 0, g = 0, b = 0;
    for (let m = 0; m < 16; m++) {
      const at = (megatileRefs[megatile * 16 + m] >>> 1) * 64;
      for (let p = 0; p < 64; p++) {
        const index = (minitiles[at + p] ?? 0) * 4;
        r += palette[index];
        g += palette[index + 1];
        b += palette[index + 2];
      }
    }
    means[megatile * 3] = r / 1024;
    means[megatile * 3 + 1] = g / 1024;
    means[megatile * 3 + 2] = b / 1024;
  }
  const out = { byKind, kindOf, means };
  tables.set(tileset, out);
  return out;
}

const OFFSET: Record<Side, [number, number]> = { left: [-1, 0], top: [0, -1], right: [1, 0], bottom: [0, 1] };

/**
 * How many joins the Seam Overlay draws on the cells of `indices`: each join between two
 * tiles once, when either of them is among the cells.
 */
export function shownSeams(scn: Pick<Scenario, "width" | "height" | "tiles">, tileset: Tileset, indices: Iterable<number>): number {
  const { width, height, tiles } = scn;
  const cells = new Set(indices);
  let shown = 0;
  for (const at of cells) {
    const megatile = megatileForTile(tileset, tiles[at]);
    if (megatile <= 0) continue;
    const x = at % width, y = (at / width) | 0;
    for (const side of SIDES) {
      const nx = x + OFFSET[side][0], ny = y + OFFSET[side][1];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const other = ny * width + nx;
      // A join between two of the cells is met from both sides: count it from the left or the top.
      if (cells.has(other) && (side === "left" || side === "top")) continue;
      const neighbour = megatileForTile(tileset, tiles[other]);
      if (neighbour > 0 && seamStep(tileset, megatile, side, neighbour) > SEAM_SHOWS) shown++;
    }
  }
  return shown;
}

/**
 * The changes that mend the joins around the cells of `indices`, in the order given, each
 * against its neighbours as the ones before it left them. Cells under a placed doodad are
 * left alone (the picture there is the doodad's, and trading one of its tiles would strand
 * it): convert the doodad to terrain first. Nothing is applied.
 */
export function healTiles(scn: Scenario, tileset: Tileset, indices: Iterable<number>): TileChange[] {
  const { width, height } = scn;
  const { byKind, kindOf, means } = healTables(tileset);
  const now = new Map<number, number>();
  const tileAt = (at: number) => now.get(at) ?? scn.tiles[at];
  const megatileAt = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : megatileForTile(tileset, tileAt(y * width + x)));
  /**
   * What shows around a megatile set at (x, y): how many of its four joins the Seam
   * Overlay would draw, and the steps over all four, a smooth join counting for nothing.
   */
  const shows = (megatile: number, x: number, y: number): { lines: number; steps: number } => {
    let lines = 0, steps = 0;
    for (const side of SIDES) {
      const other = megatileAt(x + OFFSET[side][0], y + OFFSET[side][1]);
      if (other <= 0) continue;
      const step = seamStep(tileset, megatile, side, other);
      if (step > SEAM_SHOWS) lines++;
      if (step > 0) steps += step;
    }
    return { lines, steps };
  };
  const cells = [...indices];
  // Twice over: a tile mended late in the first pass changes what its earlier neighbours join.
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (const at of cells) {
      if (at < 0 || at >= width * height) continue;
      if (scn.tiles[at] !== scn.editorTiles[at]) continue; // a doodad's tile
      const tile = tileAt(at);
      const megatile = megatileForTile(tileset, tile);
      if (megatile <= 0) continue;
      const x = at % width, y = (at / width) | 0;
      const before = shows(megatile, x, y);
      // Only a tile on a join that shows: ground that already meets its neighbours is left as laid.
      if (before.lines === 0) continue;
      const pool = byKind.get(kindOf.get(tile) ?? kindKey(tileset, tile));
      if (!pool) continue;
      let best = tile, bestLines = before.lines, bestSteps = before.steps - HEAL_GAIN;
      for (const candidate of pool) {
        const other = megatileForTile(tileset, candidate);
        if (other === megatile) continue;
        const apart = (Math.abs(means[other * 3] - means[megatile * 3]) + Math.abs(means[other * 3 + 1] - means[megatile * 3 + 1]) + Math.abs(means[other * 3 + 2] - means[megatile * 3 + 2])) / 3;
        if (apart > HEAL_SAME_GROUND) continue;
        const after = shows(other, x, y);
        if (after.lines < bestLines || (after.lines === bestLines && after.steps < bestSteps - 1e-6)) {
          bestLines = after.lines;
          bestSteps = after.steps;
          best = candidate;
        }
      }
      if (best !== tile) { now.set(at, best); changed = true; }
    }
    if (!changed) break;
  }
  const out: TileChange[] = [];
  for (const [at, after] of now) if (after !== scn.tiles[at]) out.push({ at, before: scn.tiles[at], after });
  return out.sort((a, b) => a.at - b.at);
}
