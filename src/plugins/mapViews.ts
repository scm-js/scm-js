/**
 * The state of `ui.mapView` (`mapViewStateAtom`) as pure steps: which maps offer which views,
 * which view each shows. The host's `addMapView` and the switch over the map both go
 * through these, so the rules (one shown at a time, a view no longer offered is no longer
 * shown, a closed map forgotten) live in one place.
 */
import type { MapViewState } from "../atoms/pluginAtoms";
import type { MapViewCamera } from "./api";

/** `state` with view `key` offered, or no longer offered, on map `doc` (and shown there no longer when it is not offered). */
export function offerMapView(state: MapViewState, doc: number, key: number, on: boolean): MapViewState {
  const list = state.offered.get(doc) ?? [];
  if (on === list.includes(key)) return state;
  const offered = new Map(state.offered);
  const next = on ? [...list, key] : list.filter((k) => k !== key);
  if (next.length) offered.set(doc, next); else offered.delete(doc);
  if (on || state.shown.get(doc) !== key) return { offered, shown: state.shown };
  const shown = new Map(state.shown);
  shown.delete(doc);
  return { offered, shown };
}

/** `state` with map `doc` showing view `key`, offering it if it did not, or the map itself for null. */
export function showMapView(state: MapViewState, doc: number, key: number | null): MapViewState {
  const base = key === null ? state : offerMapView(state, doc, key, true);
  if ((base.shown.get(doc) ?? null) === key) return base;
  const shown = new Map(base.shown);
  if (key === null) shown.delete(doc); else shown.set(doc, key);
  return { offered: base.offered, shown };
}

/** `state` without the maps not in `live` (closed) and without the views not in `keys` (gone). */
export function pruneMapViews(state: MapViewState, live: ReadonlySet<number>, keys: ReadonlySet<number>): MapViewState {
  let changed = false;
  const offered = new Map<number, readonly number[]>();
  for (const [doc, list] of state.offered) {
    const kept = live.has(doc) ? list.filter((k) => keys.has(k)) : [];
    if (kept.length !== list.length) changed = true;
    if (kept.length) offered.set(doc, kept);
  }
  const shown = new Map<number, number>();
  for (const [doc, key] of state.shown) {
    if (live.has(doc) && keys.has(key)) shown.set(doc, key); else changed = true;
  }
  return changed ? { offered, shown } : state;
}

/** A map view's camera (map pixels, its middle and size) as the map's own view stands: `rect` in tiles. */
export function cameraOfMap(rect: { x: number; y: number; w: number; h: number }): MapViewCamera {
  return { x: (rect.x + rect.w / 2) * 32, y: (rect.y + rect.h / 2) * 32, width: rect.w * 32, height: rect.h * 32 };
}

/**
 * The map's view that looks where `camera` does: the zoom that shows the same amount of the map
 * in the viewport (`rect` and `zoom` as the viewport stands, so its size on screen is known),
 * within `range`, and the tile to centre.
 */
export function mapLookAt(camera: MapViewCamera, rect: { w: number; h: number }, zoom: number, range: readonly [number, number]): { zoom: number; x: number; y: number } {
  // Screen pixels per map pixel is the zoom (32 screen pixels to a tile at 1).
  const screenW = rect.w * 32 * zoom, screenH = rect.h * 32 * zoom;
  const fit = Math.min(camera.width > 0 ? screenW / camera.width : Infinity, camera.height > 0 ? screenH / camera.height : Infinity);
  const next = Number.isFinite(fit) && fit > 0 ? Math.max(range[0], Math.min(range[1], fit)) : zoom;
  return { zoom: next, x: camera.x / 32, y: camera.y / 32 };
}

/**
 * What a change of `mapViewStateAtom` or of the map in front means for the switch: on the same
 * map, the view shown went from `from` to `to` (null: the map itself); null when the map in front
 * changed (each keeps its own place) or nothing did.
 */
export function mapViewSwitch(before: { doc: number; shown: number | null }, after: { doc: number; shown: number | null }): { from: number | null; to: number | null } | null {
  if (before.doc !== after.doc || before.shown === after.shown) return null;
  return { from: before.shown, to: after.shown };
}
