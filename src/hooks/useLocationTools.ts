import { useCallback, useMemo, useRef } from "react";
import { useSetAtom, useStore } from "jotai";
import { centerViewOnAtom, locationSnapAtom, selectedLocationsAtom, symmetryAtom, viewportRectAtom } from "../atoms/editorAtoms";
import { mirrorBox } from "../editor/symmetry";
import { commitEditAtom, deleteSelectedLocationsAtom, locationsRevisionAtom, scenarioAtom } from "../atoms/documentAtoms";
import { statusMessageAtom } from "../atoms/uiAtoms";
import {
  addLocation, applyLocationChanges, boundsOf, clampBounds, dragBounds, editLocation, ensureLocationSlots, handleAt, isAnywhereIntact, locationAt,
  locationCapacity, locationName, removeLocations, resizeBounds, restoreAnywhere, snapTo, type Bounds, type Handle, type LocationChange, type LocationPatch,
} from "../editor/locations";
import { TILE_PX } from "../editor/units";
import { ANYWHERE_INDEX, ELEVATIONS, isLocationUsed, type LocationRecord } from "../formats/chk/sections/objects";
import type { MapPoint } from "./useTerrainTools";

/** How close (in screen pixels) the pointer must be to a handle to grab it. */
const HANDLE_GRAB_PX = 6;

const tiles = (b: Bounds) => `${(b.right - b.left) / TILE_PX} × ${(b.bottom - b.top) / TILE_PX} tiles`;
const at = (b: Bounds) => `${b.left / TILE_PX}, ${b.top / TILE_PX}`;

/**
 * The Locations layer's tools: create by dragging, pick, select, drag-move, resize by the
 * handles, rename, re-flag and delete MRGN slots — all reading the live store so pointer
 * handlers never go stale. Moves and resizes are applied live during the drag and
 * committed once on release, like a unit drag. Anywhere (slot 63) is never picked up or
 * changed here; `restoreAnywhere` is the one deliberate exception.
 */
export function useLocationTools() {
  const store = useStore();
  const commit = useSetAtom(commitEditAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const bump = useSetAtom(locationsRevisionAtom);
  const setSelected = useSetAtom(selectedLocationsAtom);
  const setCenter = useSetAtom(centerViewOnAtom);
  const deleteSelectedLocations = useSetAtom(deleteSelectedLocationsAtom);
  const drag = useRef<
    | { kind: "move"; from: MapPoint; origin: Map<number, LocationRecord> }
    | { kind: "resize"; index: number; handle: Handle; origin: LocationRecord }
    | null
  >(null);

  const snap = useCallback(() => store.get(locationSnapAtom), [store]);

  /** Apply a change list that is not yet in the scenario and record it as one undo step. */
  const run = useCallback((label: string, locations: LocationChange[], status?: string): boolean => {
    const scn = store.get(scenarioAtom);
    if (!scn || locations.length === 0) return false;
    applyLocationChanges(scn, locations);
    commit({ label, changes: [], locations });
    if (status) setStatus(status);
    return true;
  }, [store, commit, setStatus]);

  const pickAt = useCallback((p: MapPoint): number => {
    const scn = store.get(scenarioAtom);
    return scn ? locationAt(scn, p.px, p.py) : -1;
  }, [store]);

  /** The resize handle under the pointer, when exactly one editable location is selected. */
  const handleAtPoint = useCallback((p: MapPoint, zoom: number): Handle | null => {
    const scn = store.get(scenarioAtom);
    const selected = store.get(selectedLocationsAtom);
    if (!scn || selected.length !== 1 || selected[0] === ANYWHERE_INDEX) return null;
    const r = scn.locations[selected[0]];
    if (!r || !isLocationUsed(r)) return null;
    return handleAt(boundsOf(r), p.px, p.py, HANDLE_GRAB_PX / zoom);
  }, [store]);

  const select = useCallback((indices: number[], additive = false) => {
    if (!additive) { setSelected(indices); return; }
    const set = new Set(store.get(selectedLocationsAtom));
    for (const i of indices) { if (set.has(i)) set.delete(i); else set.add(i); }
    setSelected([...set]);
  }, [store, setSelected]);

  /** Scroll the viewport to a location's centre. */
  const centerOn = useCallback((index: number) => {
    const scn = store.get(scenarioAtom);
    const r = scn?.locations[index];
    if (!r) return;
    const b = boundsOf(r);
    setCenter({ x: (b.left + b.right) / 2 / TILE_PX, y: (b.top + b.bottom) / 2 / TILE_PX });
  }, [store, setCenter]);

  /** Whether any part of the location is inside the current view. */
  const inView = useCallback((index: number): boolean => {
    const scn = store.get(scenarioAtom);
    const r = scn?.locations[index];
    if (!r) return false;
    const b = boundsOf(r), v = store.get(viewportRectAtom);
    return b.right / TILE_PX > v.x && b.left / TILE_PX < v.x + v.w && b.bottom / TILE_PX > v.y && b.top / TILE_PX < v.y + v.h;
  }, [store]);

  /* ── create ──────────────────────────────────────────── */

  /** The box a create-drag would make, for the ghost. */
  const dragRect = useCallback((from: MapPoint, to: MapPoint): Bounds | null => {
    const scn = store.get(scenarioAtom);
    return scn ? dragBounds(from, to, snap(), scn) : null;
  }, [store, snap]);

  /**
   * Make a location in the lowest free slot — and, under a symmetry mode, one per image of
   * its box, as one undo step; returns the first's index, or -1 when there is no room.
   */
  const create = useCallback((bounds: Bounds, name?: string): number => {
    const scn = store.get(scenarioAtom);
    if (!scn) return -1;
    ensureLocationSlots(scn);
    const boxes = mirrorBox(store.get(symmetryAtom), bounds, scn.width, scn.height);
    const all: LocationChange[] = [];
    const made: number[] = [];
    for (const box of boxes) {
      const { index, changes } = addLocation(scn, box, name);
      if (index < 0) break;
      applyLocationChanges(scn, changes);
      all.push(...changes);
      made.push(index);
    }
    if (made.length === 0) {
      setStatus(`All ${locationCapacity(scn) - 1} location slots are in use — delete one first`);
      return -1;
    }
    const index = made[0];
    const restored = all.some((c) => c.index === ANYWHERE_INDEX);
    const b = scn.locations[index];
    // `run` applies the list; the boxes are already in place, so hand it an empty apply — commit only.
    commit({ label: made.length === 1 ? `Create location ${locationName(scn, index) === `Location ${index}` ? index : ""}`.trimEnd() : `Create ${made.length} locations`, changes: [], locations: all });
    setStatus(`Created location ${index} "${locationName(scn, index)}" at ${at(b)} — ${tiles(b)}${made.length > 1 ? ` and ${made.length - 1} mirror image${made.length === 2 ? "" : "s"}` : ""}${restored ? " · restored Anywhere in slot 63" : ""}${made.length < boxes.length ? " · the table filled up before every image was made" : ""}`);
    setSelected(made);
    return index;
  }, [store, commit, setStatus, setSelected]);

  /** The palette's New button: a 4×4-tile location in the middle of the view. */
  const createInView = useCallback((): number => {
    const scn = store.get(scenarioAtom);
    if (!scn) return -1;
    const v = store.get(viewportRectAtom), step = snap() || TILE_PX;
    const size = 4 * TILE_PX;
    const cx = snapTo((v.x + v.w / 2) * TILE_PX - size / 2, step), cy = snapTo((v.y + v.h / 2) * TILE_PX - size / 2, step);
    const box = clampBounds({ left: cx, top: cy, right: cx + size, bottom: cy + size }, scn);
    // Clamping may have squashed the box against an edge; pull it back inside instead.
    if (box.right - box.left < size) box.left = Math.max(0, box.right - size);
    if (box.bottom - box.top < size) box.top = Math.max(0, box.bottom - size);
    return create(box);
  }, [store, snap, create]);

  /* ── move / resize ───────────────────────────────────── */

  const beginMove = useCallback((p: MapPoint) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const origin = new Map<number, LocationRecord>();
    for (const i of store.get(selectedLocationsAtom)) {
      const r = scn.locations[i];
      if (i !== ANYWHERE_INDEX && r && isLocationUsed(r)) origin.set(i, r);
    }
    drag.current = origin.size > 0 ? { kind: "move", from: p, origin } : null;
  }, [store]);

  const beginResize = useCallback((index: number, handle: Handle) => {
    const scn = store.get(scenarioAtom);
    const r = scn?.locations[index];
    if (!scn || !r || index === ANYWHERE_INDEX) return;
    drag.current = { kind: "resize", index, handle, origin: r };
  }, [store]);

  const dragTo = useCallback((p: MapPoint) => {
    const scn = store.get(scenarioAtom);
    const d = drag.current;
    if (!scn || !d) return;
    const step = snap();
    let changed = false;
    if (d.kind === "move") {
      // Snap the first location's corner rather than the pointer, so a box picked up
      // off-grid lands on it; the rest follow by the same delta and keep their spacing.
      const first = d.origin.values().next().value!;
      const fb = boundsOf(first);
      let dx = snapTo(fb.left + (p.px - d.from.px), step) - fb.left;
      let dy = snapTo(fb.top + (p.py - d.from.py), step) - fb.top;
      const union = [...d.origin.values()].map(boundsOf).reduce((u, b) => ({
        left: Math.min(u.left, b.left), top: Math.min(u.top, b.top), right: Math.max(u.right, b.right), bottom: Math.max(u.bottom, b.bottom),
      }));
      dx = Math.min(scn.width * TILE_PX - union.right, Math.max(-union.left, dx));
      dy = Math.min(scn.height * TILE_PX - union.bottom, Math.max(-union.top, dy));
      for (const [i, before] of d.origin) {
        const cur = scn.locations[i];
        const next = { ...before, left: before.left + dx, right: before.right + dx, top: before.top + dy, bottom: before.bottom + dy };
        if (cur.left !== next.left || cur.top !== next.top || cur.right !== next.right || cur.bottom !== next.bottom) { scn.locations[i] = next; changed = true; }
      }
    } else {
      const b = clampBounds(resizeBounds(boundsOf(d.origin), d.handle, p.px, p.py, step), scn);
      if (b.right === b.left || b.bottom === b.top) return;
      const cur = scn.locations[d.index];
      if (cur.left !== b.left || cur.top !== b.top || cur.right !== b.right || cur.bottom !== b.bottom) { scn.locations[d.index] = { ...d.origin, ...b }; changed = true; }
    }
    if (changed) bump((r) => r + 1);
  }, [store, snap, bump]);

  /** Commit the drag as one step; true when anything actually changed. */
  const endDrag = useCallback((): boolean => {
    const scn = store.get(scenarioAtom);
    const d = drag.current;
    drag.current = null;
    if (!scn || !d) return false;
    const locations: LocationChange[] = [];
    const differs = (a: LocationRecord, b: LocationRecord) => a.left !== b.left || a.top !== b.top || a.right !== b.right || a.bottom !== b.bottom;
    if (d.kind === "move") {
      for (const [i, before] of d.origin) {
        const after = scn.locations[i];
        if (after && differs(before, after)) locations.push({ index: i, before, after });
      }
    } else {
      const after = scn.locations[d.index];
      if (after && differs(d.origin, after)) locations.push({ index: d.index, before: d.origin, after });
    }
    if (locations.length === 0) return false;
    // The records are already in place; this records the step and marks the file dirty.
    applyLocationChanges(scn, locations);
    const n = locations.length;
    const one = locations[0];
    const b = boundsOf(one.after);
    if (d.kind === "move") {
      commit({ label: n === 1 ? `Move location ${locationName(scn, one.index)}` : `Move ${n} locations`, changes: [], locations });
      setStatus(n === 1 ? `Moved location ${one.index} "${locationName(scn, one.index)}" to ${at(b)}` : `Moved ${n} locations`);
    } else {
      commit({ label: `Resize location ${locationName(scn, one.index)}`, changes: [], locations });
      setStatus(`Resized location ${one.index} "${locationName(scn, one.index)}" to ${tiles(b)} at ${at(b)}`);
    }
    return true;
  }, [store, commit, setStatus]);

  /* ── field edits ─────────────────────────────────────── */

  /** Change any of a location's fields as one undo step; false when nothing changed (or for Anywhere). */
  const edit = useCallback((index: number, patch: LocationPatch, label?: string): boolean => {
    const scn = store.get(scenarioAtom);
    if (!scn) return false;
    const was = locationName(scn, index);
    const change = editLocation(scn, index, patch);
    if (!change) return false;
    const renamed = patch.name !== undefined && patch.name !== was;
    const ok = run(label ?? (renamed ? `Rename location ${was}` : `Edit location ${was}`), [change]);
    if (ok) setStatus(renamed ? `Renamed location ${index} "${was}" to "${locationName(scn, index)}"` : `Edited location ${index} "${was}"`);
    return ok;
  }, [store, run, setStatus]);

  const rename = useCallback((index: number, name: string) => edit(index, { name }), [edit]);

  /** Tick or untick one elevation on the selection (a ticked box is a *clear* bit). */
  const setElevation = useCallback((bit: number, enabled: boolean, indices?: number[]) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const changes: LocationChange[] = [];
    for (const i of indices ?? store.get(selectedLocationsAtom)) {
      const r = scn.locations[i];
      if (!r) continue;
      const c = editLocation(scn, i, { elevationFlags: enabled ? r.elevationFlags & ~bit : r.elevationFlags | bit });
      if (c) changes.push(c);
    }
    const what = changes.length === 1 ? `location ${changes[0].index} "${locationName(scn, changes[0].index)}"` : `${changes.length} locations`;
    const label = ELEVATIONS.find((e) => e.bit === bit)?.label.toLowerCase() ?? `bit ${bit}`;
    run(`${enabled ? "Allow" : "Exclude"} ${label} on ${what}`, changes, `${enabled ? "Allowed" : "Excluded"} ${label} on ${what}`);
  }, [store, run]);

  const remove = useCallback((indices: number[]): number => {
    const scn = store.get(scenarioAtom);
    if (!scn) return 0;
    const locations = removeLocations(scn, indices);
    if (locations.length === 0) return 0;
    const label = locations.length === 1 ? `Delete location ${locationName(scn, locations[0].index)}` : `Delete ${locations.length} locations`;
    run(label, locations, locations.length === 1 ? `Deleted location ${locations[0].index}` : `Deleted ${locations.length} locations`);
    setSelected(store.get(selectedLocationsAtom).filter((i) => !locations.some((c) => c.index === i)));
    return locations.length;
  }, [store, run, setSelected]);

  const deleteSelected = useCallback(() => {
    const n = deleteSelectedLocations();
    if (n > 0) setStatus(`Deleted ${n} location${n === 1 ? "" : "s"}`);
    return n;
  }, [deleteSelectedLocations, setStatus]);

  /** Put slot 63 back to the map bounds (and a name, if it has none). */
  const fixAnywhere = useCallback((): boolean => {
    const scn = store.get(scenarioAtom);
    if (!scn) return false;
    ensureLocationSlots(scn);
    const change = restoreAnywhere(scn);
    if (!change) return false;
    return run("Restore Anywhere", [change], `Restored Anywhere (slot 63) to the whole ${scn.width}×${scn.height} map`);
  }, [store, run]);

  const anywhereIntact = useCallback((): boolean => {
    const scn = store.get(scenarioAtom);
    return !!scn && isAnywhereIntact(scn);
  }, [store]);

  return useMemo(
    () => ({ snap, pickAt, handleAtPoint, select, centerOn, inView, dragRect, create, createInView, beginMove, beginResize, dragTo, endDrag, edit, rename, setElevation, remove, deleteSelected, fixAnywhere, anywhereIntact }),
    [snap, pickAt, handleAtPoint, select, centerOn, inView, dragRect, create, createInView, beginMove, beginResize, dragTo, endDrag, edit, rename, setElevation, remove, deleteSelected, fixAnywhere, anywhereIntact],
  );
}
