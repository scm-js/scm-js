/**
 * Whether a unit can stand where it is: the checks StarEdit and SCMDraft offer as
 * placement options, and the game itself applies when it loads a map (a preplaced unit
 * that does not fit is silently dropped).
 *
 *   - terrain: a building's placement box must sit on buildable tiles; a ground unit's
 *     collision box on walkable minitiles (VF4 flags). Flyers go anywhere.
 *   - collision: ground units and buildings may not overlap each other's collision boxes.
 *
 * Start locations are markers rather than units and skip both checks.
 */
import type { Scenario } from "../formats/chk/scenario";
import type { UnitsDat } from "../formats/dat/dat";
import { groupBuildable, megatileForTile, TileFlag, type Tileset } from "../formats/tileset/decode";
import { placementBox, TILE_PX, unitBox, unitGeometry, type PixelBox, type UnitGeometry } from "./units";
import { unitName } from "../data/units";

export interface PlacementOptions {
  /** Refuse to put a unit on top of another (ground units and buildings only). */
  checkCollision: boolean;
  /** Refuse unwalkable ground for units and unbuildable tiles for buildings. */
  checkTerrain: boolean;
  /** After a terrain edit, remove units the new terrain can no longer hold (the Terrain palette's toggle). */
  removeStranded: boolean;
  /** Buildings snap their placement box to the tile grid (StarEdit always does; SCMDraft lets you turn it off). */
  snapToGrid: boolean;
}

export const DEFAULT_PLACEMENT: PlacementOptions = { checkCollision: true, checkTerrain: true, removeStranded: true, snapToGrid: true };

export type PlacementProblem = "terrain" | "collision";

export const START_LOCATION = 214;

const MINITILE = 8;

function tileIndexRange(box: PixelBox, mapW: number, mapH: number) {
  return {
    x0: Math.max(0, Math.floor(box.left / TILE_PX)),
    y0: Math.max(0, Math.floor(box.top / TILE_PX)),
    x1: Math.min(mapW - 1, Math.floor((box.right - 1) / TILE_PX)),
    y1: Math.min(mapH - 1, Math.floor((box.bottom - 1) / TILE_PX)),
  };
}

/** Does the terrain under (x, y) hold a unit of this geometry? True when there is no tileset to ask. */
export function terrainFits(scn: Scenario, tileset: Tileset | null, g: UnitGeometry, unitId: number, x: number, y: number): boolean {
  if (!tileset || g.flyer || unitId === START_LOCATION) return true;
  if (g.building) {
    const box = placementBox(g, x, y);
    if (box.left < 0 || box.top < 0 || box.right > scn.width * TILE_PX || box.bottom > scn.height * TILE_PX) return false;
    const r = tileIndexRange(box, scn.width, scn.height);
    for (let ty = r.y0; ty <= r.y1; ty++) {
      for (let tx = r.x0; tx <= r.x1; tx++) {
        const id = scn.tiles[ty * scn.width + tx];
        const group = tileset.groups[id >> 4];
        if (!group || !groupBuildable(group) || megatileForTile(tileset, id) <= 0) return false;
      }
    }
    return true;
  }
  const box = unitBox(g, x, y);
  const mx0 = Math.floor(Math.max(0, box.left) / MINITILE);
  const my0 = Math.floor(Math.max(0, box.top) / MINITILE);
  const mx1 = Math.floor(Math.min(scn.width * TILE_PX - 1, box.right) / MINITILE);
  const my1 = Math.floor(Math.min(scn.height * TILE_PX - 1, box.bottom) / MINITILE);
  for (let my = my0; my <= my1; my++) {
    for (let mx = mx0; mx <= mx1; mx++) {
      const id = scn.tiles[(my >> 2) * scn.width + (mx >> 2)];
      const megatile = megatileForTile(tileset, id);
      if (megatile <= 0) return false;
      if (!(tileset.megatileFlags[megatile * 16 + (my & 3) * 4 + (mx & 3)] & TileFlag.Walkable)) return false;
    }
  }
  return true;
}

function overlaps(a: PixelBox, b: PixelBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Index of the first placed unit whose collision box a unit here would overlap, or -1. */
export function collidesWith(scn: Scenario, tables: UnitsDat | null, g: UnitGeometry, unitId: number, x: number, y: number, ignore?: ReadonlySet<number>): number {
  if (g.flyer || unitId === START_LOCATION) return -1;
  const box = unitBox(g, x, y);
  for (let i = 0; i < scn.units.length; i++) {
    if (ignore?.has(i)) continue;
    const u = scn.units[i];
    if (u.unitId === START_LOCATION) continue;
    const og = unitGeometry(tables, u.unitId);
    if (og.flyer) continue;
    if (overlaps(box, unitBox(og, u.x, u.y))) return i;
  }
  return -1;
}

export interface PlacementVerdict {
  problem: PlacementProblem | null;
  /** The unit in the way, for collision problems. */
  blocker: number;
  /** The problem as a sentence fragment — "the ground is unwalkable", "it overlaps Terran Marine" — null when it fits. */
  reason: string | null;
}

/** The words for a verdict's problem, given the record list the blocker indexes. */
export function placementReason(tables: UnitsDat | null, unitId: number, problem: PlacementProblem | null, blocker: number, units: readonly { unitId: number }[]): string | null {
  if (problem === null) return null;
  if (problem === "terrain") return `the ground is ${unitGeometry(tables, unitId).building ? "unbuildable" : "unwalkable"}`;
  const other = units[blocker];
  return `it overlaps ${other ? unitName(other.unitId) : "another unit"}`;
}

/** Apply the enabled checks to a unit of type `unitId` at (x, y); `ignore` are indices that do not count as blockers (the units being moved). */
export function checkPlacement(
  scn: Scenario, tileset: Tileset | null, tables: UnitsDat | null, opts: PlacementOptions, unitId: number, x: number, y: number, ignore?: ReadonlySet<number>,
): PlacementVerdict {
  const g = unitGeometry(tables, unitId);
  if (opts.checkTerrain && !terrainFits(scn, tileset, g, unitId, x, y)) return { problem: "terrain", blocker: -1, reason: placementReason(tables, unitId, "terrain", -1, scn.units) };
  if (opts.checkCollision) {
    const blocker = collidesWith(scn, tables, g, unitId, x, y, ignore);
    if (blocker >= 0) return { problem: "collision", blocker, reason: placementReason(tables, unitId, "collision", blocker, scn.units) };
  }
  return { problem: null, blocker: -1, reason: null };
}

/**
 * Units that no longer fit their terrain after the tiles at `changedTiles` (flat indices)
 * were replaced — only units touching a changed tile are re-examined.
 */
export function strandedUnits(scn: Scenario, tileset: Tileset | null, tables: UnitsDat | null, changedTiles: Iterable<number>): number[] {
  if (!tileset) return [];
  const changed = changedTiles instanceof Set ? changedTiles : new Set(changedTiles);
  if (changed.size === 0) return [];
  const out: number[] = [];
  scn.units.forEach((u, i) => {
    const g = unitGeometry(tables, u.unitId);
    if (g.flyer || u.unitId === START_LOCATION) return;
    const box = g.building ? placementBox(g, u.x, u.y) : unitBox(g, u.x, u.y);
    const r = tileIndexRange(box, scn.width, scn.height);
    let touched = false;
    for (let ty = r.y0; ty <= r.y1 && !touched; ty++) {
      for (let tx = r.x0; tx <= r.x1; tx++) if (changed.has(ty * scn.width + tx)) { touched = true; break; }
    }
    if (touched && !terrainFits(scn, tileset, g, u.unitId, u.x, u.y)) out.push(i);
  });
  return out;
}
