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

/** How large a view is on the screen, in CSS pixels. */
export interface ViewSize { width: number; height: number }

/** A view's zoom — screen pixels to a map pixel, as the map's own — from where it looks and its size: the tighter side's. */
export function zoomOfView(camera: MapViewCamera, size: ViewSize): number {
  return Math.min(size.width / camera.width, size.height / camera.height);
}

/**
 * The next of `steps` from `zoom`, `dir` 1 in and -1 out; a zoom between two steps goes to the
 * nearer one that way (a view's zoom is seldom one of them), the last either way stays.
 */
export function stepZoom(zoom: number, dir: 1 | -1, steps: readonly number[]): number {
  // (A hair of room: 0.75 worked out from a camera may be 0.7499.)
  const next = dir > 0 ? steps.find((z) => z > zoom * 1.001) : [...steps].reverse().find((z) => z < zoom / 1.001);
  return next ?? zoom;
}

/**
 * Where a view looks at `zoom`: as much of the map as its size shows at that scale, and the map
 * pixel at `anchor` where it is on the screen now (the middle when left out), as the map's own
 * zoom toward the pointer keeps it.
 */
export function lookAtZoom(camera: MapViewCamera, size: ViewSize, zoom: number, anchor?: { x: number; y: number }): MapViewCamera {
  const width = size.width / zoom, height = size.height / zoom;
  if (!anchor) return { x: camera.x, y: camera.y, width, height };
  const k = zoomOfView(camera, size) / zoom;
  return { x: anchor.x - (anchor.x - camera.x) * k, y: anchor.y - (anchor.y - camera.y) * k, width, height };
}

/** Where a view looks to show the whole map (`map` in map pixels): its middle, at the largest of `steps` it fits at, as Zoom to Fit does for the map. */
export function fitLook(map: { width: number; height: number }, size: ViewSize, steps: readonly number[]): MapViewCamera {
  const need = Math.min(size.width / map.width, size.height / map.height);
  const zoom = [...steps].reverse().find((z) => z <= need) ?? steps[0];
  return { x: map.width / 2, y: map.height / 2, width: size.width / zoom, height: size.height / zoom };
}

/**
 * The wheel's zoom rule, the map's and a view's (`MapViewHandle.wheel`): whether this wheel
 * zooms — with Ctrl or ⌘, or alone (not with Shift, which scrolls sideways) where the
 * preference says the wheel zooms — and, adding it to `acc`, the step it makes: 1 in, -1 out,
 * 0 none yet (a step is 40 pixels of wheel; a line is 40). `acc` is what is left for the next.
 */
export function wheelStep(acc: number, e: { deltaY: number; deltaMode?: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, wheel: "scroll" | "zoom"): { zooms: boolean; acc: number; dir: 1 | -1 | 0 } {
  if (!(e.ctrlKey || e.metaKey || (wheel === "zoom" && !e.shiftKey))) return { zooms: false, acc: 0, dir: 0 };
  // (WheelEvent.DOM_DELTA_PIXEL is 0, and a plain object said nothing.)
  const next = acc + (!e.deltaMode ? e.deltaY : e.deltaY * 40);
  if (Math.abs(next) < 40) return { zooms: true, acc: next, dir: 0 };
  return { zooms: true, acc: 0, dir: next < 0 ? 1 : -1 };
}
