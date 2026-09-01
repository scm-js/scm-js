/**
 * Location (MRGN) edits as invertible change lists.
 *
 * MRGN is a fixed table of slots — 64 in original maps, 255 in Brood War — so unlike
 * units and sprites nothing is ever inserted or removed: a "new" location fills the
 * lowest unused slot and "deleting" one blanks its slot. A `LocationChange` is therefore
 * always a replacement, `before` and `after` both whole records, and selection indices
 * survive every edit. Naming a location may also add a string to the table (`string`),
 * which undo takes out again; like StarEdit, an identical string already in the table
 * is reused rather than stored twice.
 *
 * Slot 63 — "Anywhere", the 64th location — is special: it is the location every
 * trigger's "Anywhere" refers to, StarEdit pins it to the map bounds and refuses to move,
 * resize, rename or delete it, and some maps deliberately depend on it being exactly
 * that. Nothing here changes it except `restoreAnywhere`, and `locationAt` never picks
 * it, so a click on the map cannot land on it.
 */
import { markDirty, strSectionName, type Scenario } from "../formats/chk/scenario";
import { ANYWHERE_INDEX, ELEVATION_MASK, isLocationUsed, type LocationRecord } from "../formats/chk/sections/objects";
import { findString, getString } from "../formats/chk/sections/strings";
import { TILE_PX } from "./units";

export interface LocationStringChange {
  index: number;
  before: string | null;
  after: string | null;
}

export interface LocationChange {
  index: number;
  before: LocationRecord;
  after: LocationRecord;
  /** A string slot the edit adds (a name no existing string matched); removed again on undo. */
  string?: LocationStringChange;
}

/** StarEdit writes 64 slots for original / hybrid maps and 255 for Brood War ones. */
export const ORIGINAL_LOCATION_SLOTS = 64;
export const BW_LOCATION_SLOTS = 255;
export const ANYWHERE_NAME = "Anywhere";

export function blankLocation(): LocationRecord {
  return { left: 0, top: 0, right: 0, bottom: 0, nameIndex: 0, elevationFlags: 0 };
}

/** How many slots the map's MRGN has room for (a longer table than expected is kept as it is). */
export function locationCapacity(scn: Scenario): number {
  return Math.max(scn.locations.length, scn.fileVersion >= 205 ? BW_LOCATION_SLOTS : ORIGINAL_LOCATION_SLOTS);
}

/**
 * Grow a short table to its capacity with blank slots. Blank slots mean nothing to the
 * game, so this is not an undoable edit — it just makes room. True when it grew.
 */
export function ensureLocationSlots(scn: Scenario): boolean {
  const cap = locationCapacity(scn);
  if (scn.locations.length >= cap) return false;
  while (scn.locations.length < cap) scn.locations.push(blankLocation());
  markDirty(scn, "MRGN");
  return true;
}

/* ── Geometry ────────────────────────────────────────────── */

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function normalizeBounds(b: Bounds): Bounds {
  return { left: Math.min(b.left, b.right), top: Math.min(b.top, b.bottom), right: Math.max(b.left, b.right), bottom: Math.max(b.top, b.bottom) };
}

/** MRGN allows right < left / bottom < top; the game reads such a location as its normalised box, and some maps use the trick. */
export function isInverted(r: Bounds): boolean {
  return r.right < r.left || r.bottom < r.top;
}

/** A record's box, normalised. */
export function boundsOf(r: Bounds): Bounds {
  return normalizeBounds(r);
}

export function clampBounds(b: Bounds, scn: { width: number; height: number }): Bounds {
  const w = scn.width * TILE_PX, h = scn.height * TILE_PX;
  const cx = (v: number) => Math.min(w, Math.max(0, Math.round(v)));
  const cy = (v: number) => Math.min(h, Math.max(0, Math.round(v)));
  return { left: cx(b.left), top: cy(b.top), right: cx(b.right), bottom: cy(b.bottom) };
}

export function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

/** Round to the nearest multiple of `step` (0 = no snapping). */
export function snapTo(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : Math.round(v);
}

/**
 * The box a create-drag from `from` to `to` makes. With snapping on it is every grid cell
 * the drag touched, so a drag inside one tile makes a one-tile location the way StarEdit
 * does; without, the raw pixel rectangle.
 */
export function dragBounds(from: { px: number; py: number }, to: { px: number; py: number }, step: number, scn: { width: number; height: number }): Bounds {
  if (step <= 0) return clampBounds(normalizeBounds({ left: from.px, top: from.py, right: to.px, bottom: to.py }), scn);
  const cellsX = Math.ceil((scn.width * TILE_PX) / step), cellsY = Math.ceil((scn.height * TILE_PX) / step);
  const cell = (v: number, cells: number) => Math.min(cells - 1, Math.max(0, Math.floor(v / step)));
  const x0 = cell(from.px, cellsX), x1 = cell(to.px, cellsX), y0 = cell(from.py, cellsY), y1 = cell(to.py, cellsY);
  return clampBounds({ left: Math.min(x0, x1) * step, top: Math.min(y0, y1) * step, right: (Math.max(x0, x1) + 1) * step, bottom: (Math.max(y0, y1) + 1) * step }, scn);
}

/* ── Resize handles ──────────────────────────────────────── */

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function handlePoint(b: Bounds, h: Handle): { x: number; y: number } {
  const x = h.includes("w") ? b.left : h.includes("e") ? b.right : (b.left + b.right) / 2;
  const y = h.includes("n") ? b.top : h.includes("s") ? b.bottom : (b.top + b.bottom) / 2;
  return { x, y };
}

/** The handle within `tolerance` map pixels of the point, corners winning over edges. */
export function handleAt(b: Bounds, px: number, py: number, tolerance: number): Handle | null {
  for (const h of HANDLES) {
    const p = handlePoint(b, h);
    if (Math.abs(px - p.x) <= tolerance && Math.abs(py - p.y) <= tolerance) return h;
  }
  return null;
}

export const HANDLE_CURSOR: Record<Handle, string> = {
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize",
};

/** `origin` with the edge(s) the handle owns moved to the (snapped) pointer; crossing an edge flips the box. */
export function resizeBounds(origin: Bounds, h: Handle, px: number, py: number, step: number): Bounds {
  const b = { ...origin };
  const x = snapTo(px, step), y = snapTo(py, step);
  if (h.includes("w")) b.left = x;
  if (h.includes("e")) b.right = x;
  if (h.includes("n")) b.top = y;
  if (h.includes("s")) b.bottom = y;
  return normalizeBounds(b);
}

/* ── Lookup ──────────────────────────────────────────────── */

/** The location's name, or StarEdit's default for its slot. */
export function locationName(scn: Scenario, index: number): string {
  const r = scn.locations[index];
  return (r && getString(scn.strings, r.nameIndex)) ?? `Location ${index}`;
}

/** Indices of the slots in use, Anywhere included. */
export function usedLocations(scn: Scenario): number[] {
  const out: number[] = [];
  scn.locations.forEach((l, i) => { if (isLocationUsed(l)) out.push(i); });
  return out;
}

/**
 * The location under a map pixel: the *smallest* one containing it, so a small location
 * inside a big one can still be picked; equal areas go to the higher slot. Anywhere is
 * never picked.
 */
export function locationAt(scn: Scenario, px: number, py: number): number {
  let best = -1, bestArea = Infinity;
  scn.locations.forEach((l, i) => {
    if (i === ANYWHERE_INDEX || !isLocationUsed(l)) return;
    const b = boundsOf(l);
    if (px < b.left || px >= b.right || py < b.top || py >= b.bottom) return;
    const area = (b.right - b.left) * (b.bottom - b.top);
    if (area <= bestArea) { best = i; bestArea = area; }
  });
  return best;
}

/** The lowest unused slot other than Anywhere, or -1 when the table is full. */
export function firstFreeSlot(scn: Scenario): number {
  for (let i = 0; i < scn.locations.length; i++) if (i !== ANYWHERE_INDEX && !isLocationUsed(scn.locations[i])) return i;
  return -1;
}

export function anywhereBounds(scn: { width: number; height: number }): Bounds {
  return { left: 0, top: 0, right: scn.width * TILE_PX, bottom: scn.height * TILE_PX };
}

/** Whether slot 63 is what StarEdit keeps it as: named, and exactly the map. */
export function isAnywhereIntact(scn: Scenario): boolean {
  const r = scn.locations[ANYWHERE_INDEX];
  return !!r && getString(scn.strings, r.nameIndex) !== null && sameBounds(r, anywhereBounds(scn));
}

/* ── Building change lists ───────────────────────────────── */

/**
 * The string index for a name: an identical string already in the table (or pending in
 * this same edit), else a new slot appended after the pending ones.
 */
function nameString(scn: Scenario, text: string, pending: LocationStringChange[]): { nameIndex: number; string?: LocationStringChange } {
  const existing = findString(scn.strings, text);
  if (existing > 0) return { nameIndex: existing };
  const queued = pending.find((p) => p.after === text);
  if (queued) return { nameIndex: queued.index };
  const string = { index: scn.strings.strings.length + pending.length, before: null, after: text };
  pending.push(string);
  return { nameIndex: string.index, string };
}

/**
 * Put Anywhere back in slot 63 — the map's bounds and a name — when it is missing or
 * has drifted. The existing name and elevation flags are kept when there are any; only
 * an unnamed slot gets "Anywhere". Null when it is already intact.
 */
export function restoreAnywhere(scn: Scenario, pending: LocationStringChange[] = []): LocationChange | null {
  if (isAnywhereIntact(scn)) return null;
  const before = scn.locations[ANYWHERE_INDEX];
  if (!before) return null;
  const named = getString(scn.strings, before.nameIndex) !== null;
  const n = named ? { nameIndex: before.nameIndex } : nameString(scn, ANYWHERE_NAME, pending);
  return { index: ANYWHERE_INDEX, before, after: { ...before, ...anywhereBounds(scn), nameIndex: n.nameIndex }, string: n.string };
}

/**
 * A new location in the lowest free slot, named `Location <slot>` unless told otherwise.
 * A map whose Anywhere is missing gets it back in the same step. `index` is -1 when every
 * slot is taken (call `ensureLocationSlots` first so a short table has its full capacity).
 */
export function addLocation(scn: Scenario, bounds: Bounds, name?: string, elevationFlags = 0): { index: number; changes: LocationChange[] } {
  const index = firstFreeSlot(scn);
  if (index < 0) return { index, changes: [] };
  const pending: LocationStringChange[] = [];
  const changes: LocationChange[] = [];
  const anywhere = restoreAnywhere(scn, pending);
  if (anywhere) changes.push(anywhere);
  const n = nameString(scn, name ?? `Location ${index}`, pending);
  const box = clampBounds(normalizeBounds(bounds), scn);
  changes.push({ index, before: scn.locations[index], after: { ...box, nameIndex: n.nameIndex, elevationFlags: elevationFlags & ELEVATION_MASK }, string: n.string });
  return { index, changes };
}

/** Editable slots among `indices`: in use, and not Anywhere. */
function editable(scn: Scenario, indices: number[]): number[] {
  return [...new Set(indices)].filter((i) => i !== ANYWHERE_INDEX && scn.locations[i] && isLocationUsed(scn.locations[i]));
}

/**
 * Shift locations by a pixel delta, clamped so the whole group stays on the map. An
 * inverted box keeps its inversion: all four edges move together.
 */
export function moveLocations(scn: Scenario, indices: number[], dx: number, dy: number): LocationChange[] {
  const set = editable(scn, indices);
  if (set.length === 0) return [];
  const union = set.map((i) => boundsOf(scn.locations[i])).reduce((u, b) => ({
    left: Math.min(u.left, b.left), top: Math.min(u.top, b.top), right: Math.max(u.right, b.right), bottom: Math.max(u.bottom, b.bottom),
  }));
  dx = Math.round(Math.min(scn.width * TILE_PX - union.right, Math.max(-union.left, dx)));
  dy = Math.round(Math.min(scn.height * TILE_PX - union.bottom, Math.max(-union.top, dy)));
  if (dx === 0 && dy === 0) return [];
  return set.map((i) => {
    const r = scn.locations[i];
    return { index: i, before: r, after: { ...r, left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy } };
  });
}

/** Give a location new bounds (normalised and clamped); a zero-area box or no change yields nothing. */
export function resizeLocation(scn: Scenario, index: number, bounds: Bounds): LocationChange[] {
  if (editable(scn, [index]).length === 0) return [];
  const b = clampBounds(normalizeBounds(bounds), scn);
  if (b.right === b.left || b.bottom === b.top) return [];
  const r = scn.locations[index];
  if (sameBounds(r, b)) return [];
  return [{ index, before: r, after: { ...r, ...b } }];
}

export interface LocationPatch {
  name?: string;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  elevationFlags?: number;
}

/**
 * Change any of a location's fields as one step. Bounds are taken as given (not
 * normalised — the properties dialog may set an inverted box on purpose) but clamped
 * to the map; an empty name clears the string reference. Nothing for Anywhere.
 */
export function editLocation(scn: Scenario, index: number, patch: LocationPatch): LocationChange | null {
  if (editable(scn, [index]).length === 0) return null;
  const before = scn.locations[index];
  const box = clampBounds({ left: patch.left ?? before.left, top: patch.top ?? before.top, right: patch.right ?? before.right, bottom: patch.bottom ?? before.bottom }, scn);
  const after: LocationRecord = { ...before, ...box, elevationFlags: (patch.elevationFlags ?? before.elevationFlags) & ELEVATION_MASK };
  let string: LocationStringChange | undefined;
  if (patch.name !== undefined && patch.name !== locationName(scn, index)) {
    if (patch.name === "") after.nameIndex = 0;
    else {
      const n = nameString(scn, patch.name, []);
      after.nameIndex = n.nameIndex;
      string = n.string;
    }
  }
  if ((Object.keys(after) as (keyof LocationRecord)[]).every((k) => after[k] === before[k])) return null;
  return { index, before, after, string };
}

/** Blank the slots at `indices`; the name strings stay in the table (StarEdit leaves them too). */
export function removeLocations(scn: Scenario, indices: number[]): LocationChange[] {
  return editable(scn, indices).sort((a, b) => a - b).map((i) => ({ index: i, before: scn.locations[i], after: blankLocation() }));
}

/* ── Applying ────────────────────────────────────────────── */

export function applyLocationChanges(scn: Scenario, changes: readonly LocationChange[], direction: "do" | "undo" = "do") {
  const ordered = direction === "do" ? changes : [...changes].reverse();
  let strings = false;
  for (const c of ordered) {
    while (scn.locations.length <= c.index) scn.locations.push(blankLocation());
    scn.locations[c.index] = direction === "do" ? c.after : c.before;
    if (c.string) {
      const table = scn.strings.strings;
      const value = direction === "do" ? c.string.after : c.string.before;
      // Undoing an append takes the slot out again so the table does not grow with every
      // rename; anything else is set in place (padding with empty slots if need be).
      if (value === null && c.string.index === table.length - 1) table.pop();
      else {
        while (table.length <= c.string.index) table.push(null);
        table[c.string.index] = value;
      }
      strings = true;
    }
  }
  if (changes.length > 0) markDirty(scn, "MRGN");
  if (strings) markDirty(scn, strSectionName(scn));
}
