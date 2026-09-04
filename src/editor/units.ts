import { markDirty, type Scenario } from "../formats/chk/scenario";
import { UnitUsed, UnitValid, type UnitRecord } from "../formats/chk/sections/objects";
import { NO_UNIT, UnitFlag, type UnitsDat } from "../formats/dat/dat";

/**
 * Unit edits as invertible change lists, in the same spirit as terrain's `TileChange`.
 * `before`/`after` are whole records: null `before` is an insertion at `index`, null
 * `after` a removal, both set a replacement. Removals are listed highest index first so
 * that applying them in order keeps the remaining indices valid; undo walks the list
 * backwards and so re-inserts lowest first.
 */
export interface UnitChange {
  index: number;
  before: UnitRecord | null;
  after: UnitRecord | null;
}

export const TILE_PX = 32;

export function applyUnitChanges(scn: Scenario, changes: UnitChange[], direction: "do" | "undo" = "do") {
  const ordered = direction === "do" ? changes : [...changes].reverse();
  for (const c of ordered) {
    const before = direction === "do" ? c.before : c.after;
    const after = direction === "do" ? c.after : c.before;
    if (before && after) scn.units[c.index] = after;
    else if (after) scn.units.splice(c.index, 0, after);
    else if (before) scn.units.splice(c.index, 1);
  }
  if (changes.length > 0) markDirty(scn, "UNIT");
}

/* ── Geometry ────────────────────────────────────────────── */

export interface UnitGeometry {
  building: boolean;
  flyer: boolean;
  /** StarEdit placement box, pixels. */
  placeW: number;
  placeH: number;
  /** Collision extents from the centre, pixels. */
  left: number;
  up: number;
  right: number;
  down: number;
}

const FALLBACK: UnitGeometry = { building: false, flyer: false, placeW: 32, placeH: 32, left: 16, up: 16, right: 16, down: 16 };

/** Sizes from units.dat, or a one-tile box when the tables are not loaded. */
export function unitGeometry(units: UnitsDat | null, unitId: number): UnitGeometry {
  if (!units || unitId < 0 || unitId >= NO_UNIT) return FALLBACK;
  const flags = units.flags[unitId];
  return {
    building: (flags & UnitFlag.Building) !== 0,
    flyer: (flags & UnitFlag.Flyer) !== 0,
    placeW: units.placementWidth[unitId],
    placeH: units.placementHeight[unitId],
    left: units.extentLeft[unitId],
    up: units.extentUp[unitId],
    right: units.extentRight[unitId],
    down: units.extentDown[unitId],
  };
}

export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The unit's collision box around its position; what selection and hit-testing use. */
export function unitBox(g: UnitGeometry, x: number, y: number): PixelBox {
  return { left: x - g.left, top: y - g.up, right: x + g.right, bottom: y + g.down };
}

/** The placement box (tile-aligned for buildings) around its position. */
export function placementBox(g: UnitGeometry, x: number, y: number): PixelBox {
  return { left: x - g.placeW / 2, top: y - g.placeH / 2, right: x + g.placeW / 2, bottom: y + g.placeH / 2 };
}

/**
 * Where a unit dropped at map pixel (px, py) lands. Buildings (and everything else with
 * the building flag: resources, start locations, beacons) snap their placement box to the
 * tile grid, which is why a Command Center's stored centre is always tile*32 + 64/48.
 * Anything else snaps its *centre* to the nearest tile centre — a marine on the grid the
 * palette's tick names, which is what SCMDraft's snap does; StarEdit has no such option
 * and always places non-buildings by the pixel, which is `snap` off. Everything stays
 * inside the map. With `snap` off a building lands at the pointer too, its box merely
 * kept inside the map.
 */
export function snapPlacement(g: UnitGeometry, px: number, py: number, mapW: number, mapH: number, snap = true): { x: number; y: number } {
  const maxX = mapW * TILE_PX - 1;
  const maxY = mapH * TILE_PX - 1;
  if (!g.building) {
    const half = TILE_PX / 2;
    const at = (v: number, max: number) =>
      Math.min(max, Math.max(0, snap ? Math.floor(v / TILE_PX) * TILE_PX + half : Math.round(v)));
    return { x: at(px, maxX), y: at(py, maxY) };
  }
  if (!snap) {
    const hw = g.placeW / 2, hh = g.placeH / 2;
    return {
      x: Math.round(Math.min(Math.max(hw, maxX + 1 - hw), Math.max(hw, px))),
      y: Math.round(Math.min(Math.max(hh, maxY + 1 - hh), Math.max(hh, py))),
    };
  }
  const wTiles = Math.max(1, Math.round(g.placeW / TILE_PX));
  const hTiles = Math.max(1, Math.round(g.placeH / TILE_PX));
  const tx = Math.min(Math.max(0, mapW - wTiles), Math.max(0, Math.round((px - g.placeW / 2) / TILE_PX)));
  const ty = Math.min(Math.max(0, mapH - hTiles), Math.max(0, Math.round((py - g.placeH / 2) / TILE_PX)));
  return { x: tx * TILE_PX + g.placeW / 2, y: ty * TILE_PX + g.placeH / 2 };
}

/* ── Ordering and picking ────────────────────────────────── */

/**
 * Draw order: ground units and buildings by y (the game's painter's order, so a unit
 * lower on the screen overlaps one above it), then flyers by y on top of everything.
 */
export function drawOrder(scn: Scenario, units: UnitsDat | null): number[] {
  const order = scn.units.map((_, i) => i);
  const flying = (i: number) => (unitGeometry(units, scn.units[i].unitId).flyer ? 1 : 0);
  order.sort((a, b) => flying(a) - flying(b) || scn.units[a].y - scn.units[b].y || a - b);
  return order;
}

/** Index of the topmost unit whose box contains map pixel (px, py), or -1. */
export function unitAt(scn: Scenario, units: UnitsDat | null, px: number, py: number): number {
  const order = drawOrder(scn, units);
  for (let k = order.length - 1; k >= 0; k--) {
    const u = scn.units[order[k]];
    const b = unitBox(unitGeometry(units, u.unitId), u.x, u.y);
    if (px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) return order[k];
  }
  return -1;
}

/** Indices of units whose boxes intersect the pixel rectangle. */
export function unitsInBox(scn: Scenario, units: UnitsDat | null, box: PixelBox): number[] {
  const left = Math.min(box.left, box.right), right = Math.max(box.left, box.right);
  const top = Math.min(box.top, box.bottom), bottom = Math.max(box.top, box.bottom);
  const out: number[] = [];
  scn.units.forEach((u, i) => {
    const b = unitBox(unitGeometry(units, u.unitId), u.x, u.y);
    if (b.right >= left && b.left <= right && b.bottom >= top && b.top <= bottom) out.push(i);
  });
  return out;
}

/* ── Building change lists ───────────────────────────────── */

export { UnitRelation, UnitState, UnitUsed, UnitValid } from "../formats/chk/sections/objects";

export const DEFAULT_MINERALS = 1500;
export const DEFAULT_GAS = 5000;

const MINERAL_FIELDS = new Set([176, 177, 178]);
const VESPENE_GEYSER = 188;

export function isResource(unitId: number): boolean {
  return MINERAL_FIELDS.has(unitId) || unitId === VESPENE_GEYSER;
}
const CARRIERS = new Set([72, 82, 83, 81]); // Carrier, Gantrithor, Reaver, Warbringer

/** Serial ids only need to be unique within the map; StarEdit hands them out increasing. */
export function nextSerial(scn: Scenario): number {
  let max = 0;
  for (const u of scn.units) if (u.serial > max) max = u.serial;
  return max + 1;
}

/**
 * A fresh record the way StarEdit writes one: 100% vitals, and the "valid"/"used" masks
 * describing only what applies to this unit type — a mineral field gets a resource
 * amount, a Templar an energy value, a marine neither. Start locations are all zeros.
 */
export function makeUnit(units: UnitsDat | null, unitId: number, owner: number, x: number, y: number, serial: number): UnitRecord {
  const flags = units ? units.flags[unitId] : 0;
  const has = (f: number) => (flags & f) !== 0;
  const isStart = unitId === 214;
  const resources = MINERAL_FIELDS.has(unitId) ? DEFAULT_MINERALS : unitId === VESPENE_GEYSER ? DEFAULT_GAS : 0;
  const shields = units ? units.shieldEnable[unitId] !== 0 : false;
  const energy = has(UnitFlag.Spellcaster);
  const hangar = CARRIERS.has(unitId);
  let valid = 0;
  let used = 0;
  if (!isStart) {
    valid = UnitValid.Invincible
      | (has(UnitFlag.Cloakable) || has(UnitFlag.PermanentCloak) ? UnitValid.Cloak : 0)
      | (has(UnitFlag.Burrowable) ? UnitValid.Burrow : 0)
      | (has(UnitFlag.FlyingBuilding) ? UnitValid.InTransit : 0)
      | (has(UnitFlag.Building) ? 0 : UnitValid.Hallucinated);
    used = UnitUsed.HitPoints
      | (shields ? UnitUsed.Shields : 0)
      | (energy ? UnitUsed.Energy : 0)
      | (resources > 0 ? UnitUsed.Resources : 0)
      | (hangar ? UnitUsed.Hangar : 0);
  }
  return {
    serial,
    x,
    y,
    unitId,
    relationType: 0,
    validProperties: valid,
    validStates: used,
    owner,
    hitPointsPercent: isStart ? 0 : 100,
    shieldPercent: shields ? 100 : 0,
    energyPercent: energy ? 100 : 0,
    resourceAmount: resources,
    hangarUnits: 0,
    stateFlags: 0,
    unused: 0,
    relatedSerial: 0,
  };
}

/** Append records to the end of the list. */
export function addUnits(scn: Scenario, records: UnitRecord[]): UnitChange[] {
  return records.map((r, i) => ({ index: scn.units.length + i, before: null, after: r }));
}

/** Remove the units at `indices`, highest first so the earlier indices stay valid. */
export function removeUnits(scn: Scenario, indices: number[]): UnitChange[] {
  return [...new Set(indices)]
    .filter((i) => i >= 0 && i < scn.units.length)
    .sort((a, b) => b - a)
    .map((i) => ({ index: i, before: scn.units[i], after: null }));
}

/** Replace fields on the units at `indices`; unchanged records produce no entry. */
export function updateUnits(scn: Scenario, indices: number[], patch: (u: UnitRecord) => Partial<UnitRecord>): UnitChange[] {
  const out: UnitChange[] = [];
  for (const i of new Set(indices)) {
    const before = scn.units[i];
    if (!before) continue;
    const after = { ...before, ...patch(before) };
    if ((Object.keys(after) as (keyof UnitRecord)[]).some((k) => after[k] !== before[k])) out.push({ index: i, before, after });
  }
  return out;
}

/**
 * Shift units by a pixel delta. With `snap` on the *destination* is snapped, not the
 * offset — a building keeps its tile alignment and anything else lands on a tile centre,
 * so a unit that was off the grid is brought onto it by moving it. Everything is clamped
 * to the map.
 */
export function moveUnits(scn: Scenario, units: UnitsDat | null, indices: number[], dx: number, dy: number, snap = true): UnitChange[] {
  return updateUnits(scn, indices, (u) => snapPlacement(unitGeometry(units, u.unitId), u.x + dx, u.y + dy, scn.width, scn.height, snap));
}
