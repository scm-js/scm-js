/**
 * Terrain edits as invertible change lists.
 *
 * Every brush computes the tiles it would change without touching the scenario, the
 * caller applies them, and the same list undoes the stroke. MTXM and TILE are kept in
 * step because the game reads one and StarEdit the other (TILE being the ground without
 * doodads, a change records what TILE held separately — see `TileChange.under`); ISOM
 * is deliberately left alone — these brushes place tiles the ISOM model has no
 * vocabulary for, which is exactly what SCMDraft does in its Rectangular/Subtile modes.
 */
import { markDirty, type Scenario } from "../formats/chk/scenario";
import type { Tileset } from "../formats/tileset/decode";
import { pickVariation, variationsOf } from "../formats/tileset/terrain";

export interface TileChange {
  /** Flat index into `scenario.tiles`. */
  at: number;
  before: number;
  after: number;
  /**
   * What `scenario.editorTiles` (TILE) held before a terrain change, when that differs
   * from `before` (the cell was under a doodad). Filled in by `applyChanges` the first
   * time a change is applied, so undo can put the ground back rather than the doodad tile.
   */
  under?: number;
}

export interface Rect {
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
}

/**
 * The tiles an N×N brush centred on (x, y) covers, the way the viewport's hover
 * outline draws it: even sizes hang one more tile to the right and bottom.
 */
export function brushRect(x: number, y: number, size: number, width: number, height: number): Rect {
  const off = Math.floor((size - 1) / 2);
  return {
    x0: Math.max(0, x - off),
    y0: Math.max(0, y - off),
    x1: Math.min(width, x - off + size),
    y1: Math.min(height, y - off + size),
  };
}

function rectIndices(rect: Rect, width: number): number[] {
  const out: number[] = [];
  for (let y = rect.y0; y < rect.y1; y++) for (let x = rect.x0; x < rect.x1; x++) out.push(y * width + x);
  return out;
}

/** Write one tile id over a set of tiles. */
export function stampTile(scn: Scenario, indices: Iterable<number>, id: number): TileChange[] {
  const out: TileChange[] = [];
  for (const at of indices) {
    const before = scn.tiles[at];
    if (before !== id) out.push({ at, before, after: id });
  }
  return out;
}

export function stampTileAt(scn: Scenario, x: number, y: number, size: number, id: number): TileChange[] {
  return stampTile(scn, rectIndices(brushRect(x, y, size, scn.width, scn.height), scn.width), id);
}

export interface FlatBrush {
  /** Even CV5 group of the terrain's flat pair. */
  group: number;
  /** A fixed variation slot, or -1 to draw one per pair. */
  variation?: number;
}

/**
 * Lay flat terrain over a set of tiles. Pairs follow the map's own parity — even
 * columns take the left group, odd the right — and both halves of a pair share one
 * variation when both fall inside the set, so the result is indistinguishable from
 * ground StarEdit laid down itself.
 */
export function stampTerrain(
  scn: Scenario,
  tileset: Tileset,
  brush: FlatBrush,
  indices: Iterable<number>,
  random: () => number = Math.random,
): TileChange[] {
  const set = indices instanceof Set ? indices : new Set(indices);
  const variations = variationsOf(tileset, brush.group);
  const fixed = brush.variation !== undefined && brush.variation >= 0 ? brush.variation : -1;
  const pick = () => (fixed >= 0 ? fixed : pickVariation(variations, random));
  const left = brush.group << 4;
  const right = (brush.group + 1) << 4;

  const out: TileChange[] = [];
  const write = (at: number, id: number) => {
    const before = scn.tiles[at];
    if (before !== id) out.push({ at, before, after: id });
  };

  for (const at of [...set].sort((a, b) => a - b)) {
    const x = at % scn.width;
    if (x % 2 === 0) {
      const slot = pick();
      write(at, left | slot);
      // The right half is the next index only while it stays on this row.
      if (x + 1 < scn.width && set.has(at + 1)) write(at + 1, right | slot);
    } else if (!set.has(at - 1)) {
      write(at, right | pick());
    }
  }
  return out;
}

export function stampTerrainAt(
  scn: Scenario,
  tileset: Tileset,
  brush: FlatBrush,
  x: number,
  y: number,
  size: number,
  random: () => number = Math.random,
): TileChange[] {
  return stampTerrain(scn, tileset, brush, rectIndices(brushRect(x, y, size, scn.width, scn.height), scn.width), random);
}

/**
 * The 4-connected region around (x, y) whose tiles all satisfy `same`, as flat
 * indices. Capped so a runaway predicate on a 256x256 map still returns.
 */
export function floodRegion(scn: Scenario, x: number, y: number, same: (id: number) => boolean): Set<number> {
  const { width, height, tiles } = scn;
  const out = new Set<number>();
  if (x < 0 || y < 0 || x >= width || y >= height) return out;
  const start = y * width + x;
  if (!same(tiles[start])) return out;

  const stack = [start];
  out.add(start);
  while (stack.length > 0) {
    const at = stack.pop()!;
    const ax = at % width;
    const neighbours = [
      ax > 0 ? at - 1 : -1,
      ax + 1 < width ? at + 1 : -1,
      at - width,
      at + width < tiles.length ? at + width : -1,
    ];
    for (const n of neighbours) {
      if (n < 0 || out.has(n) || !same(tiles[n])) continue;
      out.add(n);
      stack.push(n);
    }
  }
  return out;
}

/**
 * Apply a change list, or take it back. Terrain edits (`layer` "terrain") write MTXM and
 * TILE alike, remembering what TILE held in `under` on first application; doodad edits
 * ("mtxm") touch only MTXM's contents, leaving TILE as the ground beneath.
 */
export function applyChanges(scn: Scenario, changes: readonly TileChange[], direction: "do" | "undo" = "do", layer: "terrain" | "mtxm" = "terrain") {
  if (changes.length === 0) return;
  for (const c of changes) {
    if (direction === "do") {
      if (layer === "terrain") {
        c.under ??= scn.editorTiles[c.at];
        scn.editorTiles[c.at] = c.after;
      }
      scn.tiles[c.at] = c.after;
    } else {
      if (layer === "terrain") scn.editorTiles[c.at] = c.under ?? c.before;
      scn.tiles[c.at] = c.before;
    }
  }
  // Doodad edits leave TILE's contents alone but still write the section: a file that
  // never had one gets the ground record it needs for the doodads to be removable later.
  markDirty(scn, "MTXM", "TILE");
}

/**
 * For code that has already written `scn.tiles` itself (the isometric brush): bring
 * TILE along and record what it held, exactly as `applyChanges` would have.
 */
export function mirrorEditorTiles(scn: Scenario, changes: readonly TileChange[]) {
  for (const c of changes) {
    c.under ??= scn.editorTiles[c.at];
    scn.editorTiles[c.at] = c.after;
  }
  if (changes.length > 0) markDirty(scn, "TILE");
}

/**
 * Accumulates one drag's worth of changes so the stroke undoes as a unit: a tile
 * painted twice keeps its original `before` and its final `after`.
 */
export class Stroke {
  private readonly changes = new Map<number, TileChange>();

  add(changes: readonly TileChange[]) {
    for (const c of changes) {
      const prev = this.changes.get(c.at);
      if (prev) prev.after = c.after;
      else this.changes.set(c.at, { ...c });
    }
  }

  /** Whether the stroke has touched this cell. */
  has(at: number): boolean {
    return this.changes.has(at);
  }

  get size(): number {
    return this.changes.size;
  }

  /** The net change list, dropping tiles that ended where they started. */
  finish(): TileChange[] {
    return [...this.changes.values()].filter((c) => c.before !== c.after);
  }
}

/** Integer points from (x0, y0) to (x1, y1) inclusive, so a fast drag leaves no gaps. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  for (;;) {
    out.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}
