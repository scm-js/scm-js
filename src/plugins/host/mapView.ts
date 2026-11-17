/**
 * `ui.mapView`: a plugin's view in the map's place, and the switch between it and the map. The pure steps
 * are `../mapViews.ts`.
 */
import type { PrimitiveAtom } from "jotai";
import { centerViewOnAtom, cursorPixelAtom, cursorTileAtom, gridSizeAtom, mapHeightAtom, mapWidthAtom, viewFlagsAtom, viewportRectAtom, zoomAtom } from "../../atoms/editorAtoms";
import { activeDocumentIdAtom, documentsAtom, locationsAtom, locationsRevisionAtom, scenarioAtom } from "../../atoms/documentAtoms";
import { cameraOfMap, mapLookAt, mapViewSwitch, offerMapView, pruneMapViews, showMapView, wheelStep } from "../mapViews";
import { zoomToAtom } from "../../atoms/zoomAtoms";
import { paintOverView } from "../../components/viewport/paint/overView";
import { gridLookAtom, preferencesAtom } from "../../atoms/preferencesAtoms";
import { nextContributionKey, pluginOverlayRevisionAtom, pluginOverlaysAtom, pluginMapViewsAtom, mapViewStateAtom, mapViewCamerasAtom, mapViewFogAtom, mapViewMinimapRevisionAtom, mapViewPointerAtom } from "../../atoms/pluginAtoms";
import { logError, logWarn } from "../../editor/log";
import type { MapView, MapViewCamera, MapViewHandle, MapViewPointer, MapViewSpec, MapViewWheel, PluginInfo } from "../api";
import type { Store, Contributions } from "./shared";
import { ZOOM_RANGE } from "./view";

/** The map a map view's state is kept under: the one in front, or -1 when there is a map and no slot. */
const mapViewDocument = (store: Store): number => store.get(activeDocumentIdAtom) ?? -1;

/**
 * The switch keeps the person where they were: a view shown in the map's place is told where the
 * map (or the view before it) was looking (`onShow`), and the map shown again opens where the view
 * last looked (`setCamera`), at the same scale. Watched once per store, for every view.
 */
const switchesWatched = new WeakSet<Store>();

function watchMapViewSwitches(store: Store): void {
  if (switchesWatched.has(store)) return;
  switchesWatched.add(store);
  const now = () => { const doc = mapViewDocument(store); return { doc, shown: store.get(mapViewStateAtom).shown.get(doc) ?? null }; };
  let last = now();
  const check = () => {
    const next = now(), change = mapViewSwitch(last, next);
    last = next;
    if (!change) return;
    const cameras = store.get(mapViewCamerasAtom);
    const viewed = change.from === null ? undefined : cameras.get(change.from);
    if (change.to === null) {
      if (!viewed) return;
      const look = mapLookAt(viewed, store.get(viewportRectAtom), store.get(zoomAtom), ZOOM_RANGE);
      store.set(zoomAtom, look.zoom);
      store.set(centerViewOnAtom, { x: look.x, y: look.y });
      return;
    }
    const entry = store.get(pluginMapViewsAtom).find((e) => e.key === change.to);
    if (!entry?.spec.onShow) return;
    try { entry.spec.onShow(viewed ?? cameraOfMap(store.get(viewportRectAtom))); }
    catch (err) { logError(entry.plugin.name, "A map view's onShow failed", err); }
  };
  store.sub(mapViewStateAtom, check);
  store.sub(activeDocumentIdAtom, check);
}

/**
 * `ui.mapView`: one element for the view's life, made here and handed to `spec.mount`; the
 * state of which map offers and shows it is `mapViewStateAtom`'s, pruned as maps close.
 */
export function addMapView(store: Store, bag: Contributions, info: PluginInfo, spec: MapViewSpec): MapViewHandle {
  if (!spec || typeof spec.title !== "string" || typeof spec.mount !== "function") throw new Error("ui.mapView needs a title and mount().");
  const key = nextContributionKey();
  const element = typeof document === "undefined" ? null : document.createElement("div");
  if (element) element.className = "plugin-map-view-body";
  let unmount: (() => void) | null = null;
  if (element) {
    try { const r = spec.mount(element); if (typeof r === "function") unmount = r; }
    catch (err) { logError(info.name, "A map view's mount failed", err); }
  }
  watchMapViewSwitches(store);
  store.set(pluginMapViewsAtom, [...store.get(pluginMapViewsAtom), { key, plugin: info, spec: { ...spec }, element }]);
  let live = true;
  let minimapRaf = 0;
  /** What the wheel has turned toward the next zoom step (`wheelStep`). */
  let wheelLeft = 0;
  const listeners = new Set<(shown: boolean) => void>();
  const isShown = () => live && store.get(mapViewStateAtom).shown.get(mapViewDocument(store)) === key;
  let was = false;
  const tell = () => {
    const now = isShown();
    if (now === was) return;
    was = now;
    for (const l of listeners) { try { l(now); } catch (err) { logError(info.name, "A map view's onChange listener failed", err); } }
  };
  const docOf = (documentId?: number): number | null => {
    if (documentId === undefined) return mapViewDocument(store);
    if (store.get(documentsAtom).some((d) => d.id === documentId)) return documentId;
    logWarn(info.name, `ui.mapView: no open map has the id ${documentId}`);
    return null;
  };
  const prune = () => {
    const ids = new Set(store.get(documentsAtom).map((d) => d.id));
    if (store.get(activeDocumentIdAtom) === null) ids.add(-1);
    const keys = new Set(store.get(pluginMapViewsAtom).map((e) => e.key));
    const state = store.get(mapViewStateAtom), next = pruneMapViews(state, ids, keys);
    if (next !== state) store.set(mapViewStateAtom, next);
  };
  const unsubs = [store.sub(mapViewStateAtom, tell), store.sub(activeDocumentIdAtom, tell), store.sub(documentsAtom, prune)];
  // What `paintOver` draws changed: the view is asked to draw again, once a frame at most, while it is shown.
  let repaintRaf = 0;
  const repaint = () => {
    if (!live || !spec.onRepaint || repaintRaf || !isShown()) return;
    const run = () => {
      repaintRaf = 0;
      if (!live || !isShown()) return;
      try { spec.onRepaint?.(); } catch (err) { logError(info.name, "A map view's onRepaint failed", err); }
    };
    if (typeof requestAnimationFrame === "undefined") { run(); return; }
    repaintRaf = requestAnimationFrame(run);
  };
  if (spec.onRepaint) {
    for (const a of [viewFlagsAtom, gridSizeAtom, gridLookAtom, locationsRevisionAtom, pluginOverlaysAtom, pluginOverlayRevisionAtom, mapViewStateAtom, activeDocumentIdAtom] as const) unsubs.push(store.sub(a, repaint));
  }
  /** A view's own map of something by entry key, with this one's entry set or (undefined) taken out. */
  const setKeyed = <T,>(a: PrimitiveAtom<ReadonlyMap<number, T>>, value: T | undefined) => {
    const was = store.get(a);
    if (value === undefined ? !was.has(key) : was.has(key) && was.get(key) === value) return;
    const next = new Map(was);
    if (value === undefined) next.delete(key); else next.set(key, value);
    store.set(a, next);
  };
  const handle: MapViewHandle = {
    offer: (on, documentId) => {
      const doc = live ? docOf(documentId) : null;
      if (doc !== null) store.set(mapViewStateAtom, offerMapView(store.get(mapViewStateAtom), doc, key, on));
    },
    show: (on, documentId) => {
      const doc = live ? docOf(documentId) : null;
      if (doc === null) return;
      const state = store.get(mapViewStateAtom);
      // Hiding the view shows the map, but only where this view was the one shown.
      if (!on && state.shown.get(doc) !== key) return;
      store.set(mapViewStateAtom, showMapView(state, doc, on ? key : null));
    },
    isShown,
    onChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => { listeners.delete(listener); } };
    },
    setCamera: (camera: MapViewCamera) => {
      if (!live || !camera) return;
      const { x, y, width, height } = camera;
      if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n)) || width <= 0 || height <= 0) {
        logWarn(info.name, "ui.mapView: setCamera needs a finite x and y and a width and height over 0");
        return;
      }
      const was = store.get(mapViewCamerasAtom).get(key);
      if (was && was.x === x && was.y === y && was.width === width && was.height === height) return;
      store.set(mapViewCamerasAtom, new Map(store.get(mapViewCamerasAtom)).set(key, { x, y, width, height }));
    },
    wheel: (w: MapViewWheel) => {
      if (!w || typeof w.deltaY !== "number" || !Number.isFinite(w.deltaY) || !isShown() || !spec.onZoom) { wheelLeft = 0; return false; }
      const view = store.get(preferencesAtom).view;
      const step = wheelStep(wheelLeft, w, view.wheel);
      wheelLeft = step.acc;
      if (step.dir) {
        const at = view.zoomToCursor && Number.isFinite(w.x) && Number.isFinite(w.y) ? { x: w.x, y: w.y } : undefined;
        store.set(zoomToAtom, step.dir > 0 ? "in" : "out", at);
      }
      return step.zooms;
    },
    setFog: (on: boolean | null) => {
      if (!live) return;
      if (on !== null && typeof on !== "boolean") { logWarn(info.name, "ui.mapView: setFog needs true, false or null"); return; }
      setKeyed(mapViewFogAtom, on);
    },
    setPointer: (at: MapViewPointer | null) => {
      if (!live) return;
      if (at === null) { setKeyed(mapViewPointerAtom, null); return; }
      if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) { logWarn(info.name, "ui.mapView: setPointer needs a finite x and y, or null"); return; }
      const was = store.get(mapViewPointerAtom).get(key);
      if (was && was.x === at.x && was.y === at.y) return;
      setKeyed(mapViewPointerAtom, { x: at.x, y: at.y });
      // The status bar's tile and position are the map's pointer's, and the map's own does not move under the view.
      if (!isShown()) return;
      const px = Math.floor(at.x), py = Math.floor(at.y);
      store.set(cursorPixelAtom, { x: px, y: py });
      store.set(cursorTileAtom, { x: Math.floor(px / 32), y: Math.floor(py / 32) });
    },
    paintOver: (ctx: CanvasRenderingContext2D, view: MapView) => {
      if (!live || !isShown() || !ctx || !view || typeof view.x !== "function" || typeof view.y !== "function") return;
      if (!store.get(scenarioAtom)) return;
      const flags = store.get(viewFlagsAtom);
      const overlays = store.get(pluginOverlaysAtom).filter((o) => o.visible && o.plugin.id !== info.id);
      try {
        paintOverView(ctx, view, {
          flags, gridSize: store.get(gridSizeAtom), gridLook: store.get(gridLookAtom), locations: store.get(locationsAtom),
          mapW: store.get(mapWidthAtom), mapH: store.get(mapHeightAtom), overlays,
        });
      } catch (err) { logError(info.name, "Drawing the map's grid and locations over a map view failed", err); }
    },
    redrawMinimap: () => {
      if (!live || minimapRaf) return;
      const bump = () => { minimapRaf = 0; if (live) store.set(mapViewMinimapRevisionAtom, (n) => n + 1); };
      if (typeof requestAnimationFrame === "undefined") { bump(); return; }
      minimapRaf = requestAnimationFrame(bump);
    },
    dispose: () => {
      if (!live) return;
      live = false;
      if (minimapRaf) cancelAnimationFrame(minimapRaf);
      if (repaintRaf) cancelAnimationFrame(repaintRaf);
      setKeyed(mapViewFogAtom, undefined);
      setKeyed(mapViewPointerAtom, undefined);
      if (store.get(mapViewCamerasAtom).has(key)) { const cameras = new Map(store.get(mapViewCamerasAtom)); cameras.delete(key); store.set(mapViewCamerasAtom, cameras); }
      for (const u of unsubs) u();
      store.set(pluginMapViewsAtom, store.get(pluginMapViewsAtom).filter((e) => e.key !== key));
      prune();
      listeners.clear();
      try { unmount?.(); } catch (err) { logError(info.name, "A map view's unmount failed", err); }
      element?.remove();
    },
  };
  bag.add(() => handle.dispose());
  return handle;
}
