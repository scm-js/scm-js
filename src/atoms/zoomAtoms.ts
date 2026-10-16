/**
 * The editor's zoom commands — View ▸ Zoom In, Zoom Out, a level, Zoom to Fit, the toolbar's
 * buttons and their keys — and the zoom the toolbar and the status bar show. Both are the map's
 * own (`zoomAtom`) unless a plugin's view is shown in the map's place and zooms (`ui.mapView`
 * with `onZoom`): then they are that view's, its zoom worked out from where it last said it
 * looks and its size on the screen, and a command asks it to look at the new scale.
 */
import { atom, type Getter } from "jotai";
import { mapHeightAtom, mapWidthAtom, viewportRectAtom, zoomAtom, zoomToFitAtom, ZOOM_STEPS } from "./editorAtoms";
import { mapViewCamerasAtom, shownMapViewAtom, type PluginMapViewEntry } from "./pluginAtoms";
import { fitLook, lookAtZoom, stepZoom, zoomOfView, type ViewSize } from "../plugins/mapViews";
import type { MapViewCamera } from "../plugins/api";
import { logError } from "../editor/log";

/** A zoom command: a step in or out, one of the levels, or the whole map. */
export type ZoomTo = "in" | "out" | "fit" | number;

/** The view shown that zooms, and where it looks, or null when the zoom is the map's. */
function zoomingView(get: Getter): { entry: PluginMapViewEntry; camera: MapViewCamera; size: ViewSize } | null {
  const entry = get(shownMapViewAtom);
  if (!entry?.spec.onZoom) return null;
  const camera = get(mapViewCamerasAtom).get(entry.key);
  if (!camera) return null;
  // The view's element covers the map's area; without one (or before it is laid out) the map's
  // own viewport, which stays as it was last painted while covered, is the same size near enough.
  const el = entry.element;
  if (el && el.clientWidth > 0 && el.clientHeight > 0) return { entry, camera, size: { width: el.clientWidth, height: el.clientHeight } };
  const r = get(viewportRectAtom), zoom = get(zoomAtom);
  return { entry, camera, size: { width: r.w * 32 * zoom, height: r.h * 32 * zoom } };
}

/**
 * The look last asked of each view, and its camera then: steps that come faster than the view says
 * where it looks (a wheel turned quickly) go on from the look asked, not the old scale again. Only
 * for a moment — a view that could not take the look never says another camera.
 */
const asked = new WeakMap<PluginMapViewEntry, { from: MapViewCamera; look: MapViewCamera; at: number }>();
const ASKED_MS = 300;

/** The zoom the toolbar and the status bar show: the shown view's when it zooms, else the map's. */
export const shownZoomAtom = atom((get) => {
  const v = zoomingView(get);
  return v ? zoomOfView(v.camera, v.size) : get(zoomAtom);
});

/**
 * Zoom the map, or the shown view that zooms. `anchor` (map pixels) keeps that point where it is
 * on the screen — the wheel's pointer, a view's only (the map's wheel keeps its own anchor).
 */
export const zoomToAtom = atom(null, (get, set, to: ZoomTo, anchor?: { x: number; y: number }) => {
  const v = zoomingView(get);
  if (!v) {
    if (to === "fit") set(zoomToFitAtom);
    else set(zoomAtom, typeof to === "number" ? to : stepZoom(get(zoomAtom), to === "in" ? 1 : -1, ZOOM_STEPS));
    return;
  }
  const { entry, size } = v;
  const pending = asked.get(entry), now = performance.now();
  const camera = pending && pending.from === v.camera && now - pending.at < ASKED_MS ? pending.look : v.camera;
  let look: MapViewCamera;
  if (to === "fit") look = fitLook({ width: get(mapWidthAtom) * 32, height: get(mapHeightAtom) * 32 }, size, ZOOM_STEPS);
  else {
    const was = zoomOfView(camera, size);
    const zoom = typeof to === "number" ? to : stepZoom(was, to === "in" ? 1 : -1, ZOOM_STEPS);
    if (zoom === was) return;
    look = lookAtZoom(camera, size, zoom, anchor);
  }
  asked.set(entry, { from: v.camera, look, at: now });
  try { entry.spec.onZoom!(look); }
  catch (err) { logError(entry.plugin.name, "A map view's onZoom failed", err); }
});
