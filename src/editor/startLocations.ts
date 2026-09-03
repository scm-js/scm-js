/**
 * Tools ▸ Auto-place Start Locations: one start location per player, on a ring or in the
 * corners, each nudged to the nearest spot the placement checks accept. The Melee Wizard
 * plugin does the elaborate version (bases, symmetry from a picked point); this is the
 * built-in "give me N sensible starts" a fresh melee map needs before anything else, and
 * it goes through the ordinary unit change lists so it is one undo step.
 *
 * Ideal points: `ring` spaces the players evenly on an ellipse inset by `margin` tiles,
 * starting top-left and going clockwise, so two players sit on a diagonal and four in
 * the corners; `corners` fills the four corners first and the edge midpoints after. The
 * spiral search then walks outward tile by tile until `checkPlacement` (terrain and
 * collision as the Units palette has them set) says the start location fits.
 */
import type { Scenario } from "../formats/chk/scenario";
import type { Tileset } from "../formats/tileset/decode";
import type { UnitsDat } from "../formats/dat/dat";
import { PlayerType } from "../formats/chk/sections/players";
import { START_LOCATION } from "../data/units";
import { checkPlacement, type PlacementOptions } from "./placement";
import { addUnits, applyUnitChanges, makeUnit, nextSerial, removeUnits, snapPlacement, unitGeometry, TILE_PX, type UnitChange } from "./units";

export type StartLayout = "ring" | "corners";

export interface StartPlacementOptions {
  /** How many players get a start location, 1..8; players are numbered from 1. */
  players: number;
  layout: StartLayout;
  /** Distance from the map edge to the ideal points, in tiles. */
  margin: number;
  /** Remove the start locations already on the map first. */
  replace: boolean;
  /** How far (in tiles) the search may wander from the ideal point before giving up. */
  searchRadius?: number;
  placement: PlacementOptions;
}

export const DEFAULT_START_PLACEMENT: Omit<StartPlacementOptions, "placement"> = { players: 2, layout: "ring", margin: 6, replace: true, searchRadius: 16 };

export interface StartPlacementResult {
  changes: UnitChange[];
  /** Per player (0-based), where the start location landed, or null when nothing within reach fit. */
  placed: ({ x: number; y: number } | null)[];
  removed: number;
}

/** The players a map's slots say are playable — what the dialog offers as its default count. */
export function playableCount(scn: Scenario): number {
  const n = scn.playerTypes.slice(0, 8).filter((t) => t === PlayerType.Human || t === PlayerType.Computer).length;
  return Math.max(2, Math.min(8, n || 2));
}

/** The ideal centre points, in map pixels, for `players` under a layout. */
export function idealStarts(width: number, height: number, players: number, layout: StartLayout, margin: number): { x: number; y: number }[] {
  const w = width * TILE_PX, h = height * TILE_PX;
  const m = Math.max(0, Math.min(margin, Math.floor(Math.min(width, height) / 2) - 2)) * TILE_PX;
  const out: { x: number; y: number }[] = [];
  if (layout === "corners") {
    const pts = [
      { x: m, y: m }, { x: w - m, y: h - m }, { x: w - m, y: m }, { x: m, y: h - m },
      { x: w / 2, y: m }, { x: w / 2, y: h - m }, { x: m, y: h / 2 }, { x: w - m, y: h / 2 },
    ];
    for (let i = 0; i < players; i++) out.push(pts[i % pts.length]);
    return out;
  }
  const cx = w / 2, cy = h / 2, rx = w / 2 - m, ry = h / 2 - m;
  // Start at the top-left diagonal so two players face each other across the map.
  const start = -Math.PI * 3 / 4;
  for (let i = 0; i < players; i++) {
    const a = start + (i * 2 * Math.PI) / players;
    out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return out;
}

/** Cells of a spiral around (0, 0) out to `radius`, nearest first (Chebyshev rings, ordered by distance inside each). */
function spiral(radius: number): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = [{ dx: 0, dy: 0 }];
  for (let r = 1; r <= radius; r++) {
    const ring: { dx: number; dy: number }[] = [];
    for (let dx = -r; dx <= r; dx++) { ring.push({ dx, dy: -r }); ring.push({ dx, dy: r }); }
    for (let dy = -r + 1; dy <= r - 1; dy++) { ring.push({ dx: -r, dy }); ring.push({ dx: r, dy }); }
    ring.sort((a, b) => a.dx * a.dx + a.dy * a.dy - (b.dx * b.dx + b.dy * b.dy));
    out.push(...ring);
  }
  return out;
}

/**
 * Compute and apply the placement: returns the change list (already applied to `scn`,
 * removals first) and where each player landed. Every start is checked against the
 * ones placed before it, so they never overlap each other.
 */
export function placeStartLocations(scn: Scenario, tileset: Tileset | null, tables: UnitsDat | null, options: StartPlacementOptions): StartPlacementResult {
  const players = Math.max(1, Math.min(8, Math.floor(options.players)));
  const changes: UnitChange[] = [];
  let removed = 0;
  if (options.replace) {
    const existing = scn.units.map((u, i) => (u.unitId === START_LOCATION ? i : -1)).filter((i) => i >= 0);
    if (existing.length > 0) {
      const list = removeUnits(scn, existing);
      applyUnitChanges(scn, list);
      changes.push(...list);
      removed = existing.length;
    }
  }
  const g = unitGeometry(tables, START_LOCATION);
  const ideal = idealStarts(scn.width, scn.height, players, options.layout, options.margin);
  const steps = spiral(Math.max(0, options.searchRadius ?? DEFAULT_START_PLACEMENT.searchRadius!));
  const placed: ({ x: number; y: number } | null)[] = [];
  let serial = nextSerial(scn);
  for (let p = 0; p < players; p++) {
    const want = ideal[p];
    let found: { x: number; y: number } | null = null;
    for (const s of steps) {
      const { x, y } = snapPlacement(g, want.x + s.dx * TILE_PX, want.y + s.dy * TILE_PX, scn.width, scn.height, true);
      if (checkPlacement(scn, tileset, tables, options.placement, START_LOCATION, x, y).problem === null) { found = { x, y }; break; }
    }
    placed.push(found);
    if (!found) continue;
    const list = addUnits(scn, [makeUnit(tables, START_LOCATION, p, found.x, found.y, serial++)]);
    applyUnitChanges(scn, list);
    changes.push(...list);
  }
  return { changes, placed, removed };
}
