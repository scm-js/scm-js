/**
 * Two maps held against each other, without graphics: which tiles differ, which units
 * were added, removed, moved or changed where they stood, and which locations changed.
 * `scmjs map diff --picture` draws its picture from this and Tools ▸ Compare Maps… marks
 * the open map with it, so the two always agree.
 *
 * The first map is the one compared *with* (the older one, as a rule), the second the
 * one the changes are told of: a unit only the second has is "added".
 */
import type { Scenario } from "../formats/chk/scenario";
import { ANYWHERE_INDEX, type LocationRecord, type UnitRecord } from "../formats/chk/sections/objects";
import { MEGATILE_PX } from "../formats/tileset/decode";
import { locationName } from "./locations";
import { plainText } from "./textColors";

export type Change = "added" | "removed" | "changed";

/** What the open map is held against: a map and what to call it. */
export interface CompareBase { name: string; scenario: Scenario }

/**
 * A map as it stands, to compare with later. Cloned rather than saved and read again: a
 * save turns characters the map's encoding cannot hold into `?` and a read guesses the
 * encoding anew, and either would show as a renamed location with nothing changed.
 */
export const scenarioCopy = (s: Scenario): Scenario => structuredClone(s);

/** A unit as a comparison matches it: the whole record but its serial number. */
export const unitKey = (u: UnitRecord) => JSON.stringify({ ...u, serial: 0 });

/** A location in words: its name, its box and its flags. Two that read alike are the same location. */
export const locationText = (s: Scenario, i: number) => { const l = s.locations[i]; return `${plainText(locationName(s, i))} ${l.left},${l.top}–${l.right},${l.bottom}${l.elevationFlags ? ` flags ${l.elevationFlags}` : ""}`; };

/** Locations by slot: placed on one side only (added, removed), or on both with another name, place or flags (changed). */
export function locationChanges(a: Scenario, b: Scenario): { index: number; change: Change }[] {
  const out: { index: number; change: Change }[] = [];
  const n = Math.max(a.locations.length, b.locations.length);
  const placed = (s: Scenario, i: number) => { const l = s.locations[i]; return !!l && (l.left !== l.right || l.top !== l.bottom); };
  for (let i = 0; i < n; i++) {
    const pa = placed(a, i), pb = placed(b, i);
    if (!pa && !pb) continue;
    if (pa && !pb) out.push({ index: i, change: "removed" });
    else if (!pa && pb) out.push({ index: i, change: "added" });
    else if (locationText(a, i) !== locationText(b, i)) out.push({ index: i, change: "changed" });
  }
  return out;
}

/** A tile on the canvas: the same in both maps, another id, in the first or the second map only, or in neither. */
export const TILE_KIND = { same: 0, changed: 1, aOnly: 2, bOnly: 3, neither: 4 } as const;

/** A removed and an added unit of one type and owner this near (map pixels) are one unit moved: four tiles. */
export const MOVE_RADIUS = 4 * MEGATILE_PX;

export interface UnitDifference {
  /** `moved`: a removed and an added unit paired by type, owner and nearness; `changed`: paired where it stood. */
  change: "added" | "removed" | "moved" | "changed";
  unitId: number;
  owner: number;
  /** Where it is (where it was, for a removed unit), in map pixels. */
  x: number;
  y: number;
  /** Where a moved unit was. */
  from?: { x: number; y: number };
}

export interface LocationDifference { index: number; change: Change; a?: LocationRecord; b?: LocationRecord }

/** A box of tiles. */
export interface TileBox { x: number; y: number; width: number; height: number }

export interface DiffCounts {
  /** Tiles both maps have whose ids differ. */
  tiles: number;
  /** Tiles only one of the maps has (one of them was resized). */
  resized: number;
  unitsAdded: number;
  unitsRemoved: number;
  unitsMoved: number;
  /** Paired where they stood: the same type, owner and place, another property (hit points, resources, …). */
  unitsChanged: number;
  locations: number;
}

export interface DiffChanges {
  /** The canvas in tiles: the larger of the two maps each way. */
  width: number;
  height: number;
  /** A `TILE_KIND` value per canvas tile, row by row. */
  tiles: Uint8Array;
  units: UnitDifference[];
  locations: LocationDifference[];
  counts: DiffCounts;
  bounds: { tiles: TileBox | null; all: TileBox | null };
  /** The second map's units that are in the first as they are. */
  kept: UnitRecord[];
}

/**
 * Units added and removed as `map diff` counts them (the record but its serial), then each removed one paired with
 * the nearest added one of the same type and owner within `radius` map pixels, nearest pairs first: moved, or
 * changed where it stood.
 */
export function unitChanges(as: readonly UnitRecord[], bs: readonly UnitRecord[], radius = MOVE_RADIUS): { changes: UnitDifference[]; kept: UnitRecord[] } {
  const count = new Map<string, number>();
  for (const u of as) count.set(unitKey(u), (count.get(unitKey(u)) ?? 0) + 1);
  const added: UnitRecord[] = [], kept: UnitRecord[] = [];
  for (const u of bs) {
    const k = unitKey(u), n = count.get(k) ?? 0;
    if (n > 0) { count.set(k, n - 1); kept.push(u); } else added.push(u);
  }
  const removed: UnitRecord[] = [];
  for (const u of as) {
    const k = unitKey(u), n = count.get(k) ?? 0;
    if (n > 0) { count.set(k, n - 1); removed.push(u); }
  }
  const byKind = new Map<string, number[]>();
  added.forEach((u, j) => { const k = `${u.unitId}:${u.owner}`; byKind.set(k, [...(byKind.get(k) ?? []), j]); });
  const pairs: { i: number; j: number; d: number }[] = [];
  removed.forEach((r, i) => {
    for (const j of byKind.get(`${r.unitId}:${r.owner}`) ?? []) {
      const d = Math.hypot(added[j].x - r.x, added[j].y - r.y);
      if (d <= radius) pairs.push({ i, j, d });
    }
  });
  pairs.sort((p, q) => p.d - q.d || p.i - q.i || p.j - q.j);
  const usedA = new Set<number>(), usedB = new Set<number>();
  const paired: UnitDifference[] = [];
  for (const { i, j, d } of pairs) {
    if (usedA.has(i) || usedB.has(j)) continue;
    usedA.add(i); usedB.add(j);
    const r = removed[i], u = added[j];
    paired.push(d === 0 ? { change: "changed", unitId: u.unitId, owner: u.owner, x: u.x, y: u.y } : { change: "moved", unitId: u.unitId, owner: u.owner, x: u.x, y: u.y, from: { x: r.x, y: r.y } });
  }
  const one = (change: "added" | "removed") => (u: UnitRecord): UnitDifference => ({ change, unitId: u.unitId, owner: u.owner, x: u.x, y: u.y });
  return {
    changes: [...removed.filter((_, i) => !usedA.has(i)).map(one("removed")), ...added.filter((_, j) => !usedB.has(j)).map(one("added")), ...paired],
    kept,
  };
}

/** A location's box, the right way round. */
const boxOf = (l: LocationRecord) => ({ left: Math.min(l.left, l.right), top: Math.min(l.top, l.bottom), right: Math.max(l.left, l.right), bottom: Math.max(l.top, l.bottom) });

/** Everything `--picture` marks, from the two scenarios alone: the tiles compared by id, the units paired, the locations by slot. */
export function diffChanges(a: Scenario, b: Scenario, radius = MOVE_RADIUS): DiffChanges {
  const width = Math.max(a.width, b.width), height = Math.max(a.height, b.height);
  const tiles = new Uint8Array(width * height);
  let changed = 0, resized = 0;
  const grow = (box: { x0: number; y0: number; x1: number; y1: number } | null, x0: number, y0: number, x1: number, y1: number) =>
    box ? { x0: Math.min(box.x0, x0), y0: Math.min(box.y0, y0), x1: Math.max(box.x1, x1), y1: Math.max(box.y1, y1) } : { x0, y0, x1, y1 };
  let tileBox: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const inA = tx < a.width && ty < a.height, inB = tx < b.width && ty < b.height;
      let v: number = TILE_KIND.neither;
      if (inA && inB) v = (a.tiles[ty * a.width + tx] ?? 0) !== (b.tiles[ty * b.width + tx] ?? 0) ? TILE_KIND.changed : TILE_KIND.same;
      else if (inA) v = TILE_KIND.aOnly;
      else if (inB) v = TILE_KIND.bOnly;
      tiles[ty * width + tx] = v;
      if (v === TILE_KIND.changed) { changed++; tileBox = grow(tileBox, tx, ty, tx + 1, ty + 1); }
      else if (v === TILE_KIND.aOnly || v === TILE_KIND.bOnly) resized++;
    }
  }
  const { changes: units, kept } = unitChanges(a.units, b.units, radius);
  const locations: LocationDifference[] = locationChanges(a, b).map(({ index, change }) => ({
    index, change, ...(change !== "added" ? { a: a.locations[index] } : {}), ...(change !== "removed" ? { b: b.locations[index] } : {}),
  }));
  let all = tileBox;
  const T = MEGATILE_PX;
  const at = (x: number, y: number) => { const tx = Math.max(0, Math.min(width - 1, Math.floor(x / T))), ty = Math.max(0, Math.min(height - 1, Math.floor(y / T))); all = grow(all, tx, ty, tx + 1, ty + 1); };
  for (const u of units) { at(u.x, u.y); if (u.from) at(u.from.x, u.from.y); }
  for (const l of locations) {
    if (l.index === ANYWHERE_INDEX) continue;
    for (const r of [l.a, l.b]) if (r) { const bx = boxOf(r); at(bx.left, bx.top); at(Math.max(bx.left, bx.right - 1), Math.max(bx.top, bx.bottom - 1)); }
  }
  const asBox = (b: { x0: number; y0: number; x1: number; y1: number } | null): TileBox | null => (b ? { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 } : null);
  const n = (c: UnitDifference["change"]) => units.filter((u) => u.change === c).length;
  return {
    width, height, tiles, units, locations, kept,
    counts: { tiles: changed, resized, unitsAdded: n("added"), unitsRemoved: n("removed"), unitsMoved: n("moved"), unitsChanged: n("changed"), locations: locations.length },
    bounds: { tiles: asBox(tileBox), all: asBox(all) },
  };
}

/** Whether there is anything to mark. */
export const anyChange = (c: DiffCounts): boolean => Object.values(c).some((n) => n > 0);

/** A place where the ground differs: a box of tiles and how many of them do. */
export interface ChangedPlace { x0: number; y0: number; x1: number; y1: number; tiles: number }

/**
 * The tiles whose ids differ, joined where they touch (corners included) into places,
 * the largest first: what a list of "go there" is made from. Tiles only one of the maps
 * has are not places; a resize is said as a whole.
 */
export function changedPlaces(d: DiffChanges): ChangedPlace[] {
  const { width, height, tiles } = d;
  const seen = new Uint8Array(width * height);
  const places: ChangedPlace[] = [];
  const stack: number[] = [];
  for (let start = 0; start < tiles.length; start++) {
    if (seen[start] || tiles[start] !== TILE_KIND.changed) continue;
    const place: ChangedPlace = { x0: width, y0: height, x1: 0, y1: 0, tiles: 0 };
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const tile = stack.pop()!;
      const tx = tile % width, ty = (tile / width) | 0;
      place.x0 = Math.min(place.x0, tx); place.y0 = Math.min(place.y0, ty);
      place.x1 = Math.max(place.x1, tx + 1); place.y1 = Math.max(place.y1, ty + 1);
      place.tiles++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = tx + dx, ny = ty + dy;
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] || tiles[next] !== TILE_KIND.changed) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    places.push(place);
  }
  return places.sort((p, q) => q.tiles - p.tiles || p.y0 - q.y0 || p.x0 - q.x0);
}
