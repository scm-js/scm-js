/**
 * What a plugin puts on the map and around it: picks, map tools, overlays, status bar cells and map buttons.
 */
import { msg, t, translate } from "../../i18n";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { statusMessageAtom } from "../../atoms/uiAtoms";
import { mapPickAtom, mapToolAtom, mapToolRevisionAtom, nextContributionKey, overlayMemoryKey, overlayVisibilityMemory, pluginOverlayRevisionAtom, pluginOverlaysAtom, pluginMapButtonsAtom, pluginStatusItemsAtom, setOverlayVisibleAtom, type MapPickKind, type MapPickResult } from "../../atoms/pluginAtoms";
import { logError } from "../../editor/log";
import type { MapToolHandle, MapToolSpec, MapToolStopReason, OverlayHandle, OverlaySpec, PickObjectOptions, StatusItemHandle, StatusItemSpec, MapButtonHandle, MapButtonSpec, PluginInfo } from "../api";
import type { Store, Contributions } from "./shared";

const PICK_PROMPTS: Record<MapPickKind, string> = { area: msg("Drag a rectangle on the map"), tile: msg("Click a tile on the map"), object: msg("Click a unit or a location on the map") };

/**
 * Put a `MapPickRequest` in front of the viewport and resolve when it (or Esc, a
 * right-click, a document change, the plugin's deactivation, or a newer pick) finishes it.
 * The request's `finish` clears the atom itself, so the viewport only ever calls it.
 */
export function pickOnMap(store: Store, bag: Contributions, info: PluginInfo, kind: MapPickKind, options: PickObjectOptions = {}): Promise<MapPickResult | null> {
  return new Promise((resolve) => {
    store.get(mapPickAtom)?.finish(null);
    if (!store.get(scenarioAtom)) { resolve(null); return; }
    const key = nextContributionKey();
    const prompt = options.prompt?.trim() || translate(PICK_PROMPTS[kind]);
    let done = false;
    let unsubDoc = () => {};
    let disposable = { dispose: () => {} };
    const finish = (result: MapPickResult | null) => {
      if (done) return;
      done = true;
      unsubDoc();
      disposable.dispose();
      if (store.get(mapPickAtom)?.key === key) store.set(mapPickAtom, null);
      store.set(statusMessageAtom, result ? t("{prompt} — done", { prompt }) : t("{prompt} — cancelled", { prompt }));
      resolve(result);
    };
    unsubDoc = store.sub(scenarioAtom, () => finish(null));
    disposable = bag.add(() => finish(null));
    store.set(mapPickAtom, { key, kind, prompt, pluginId: info.id, ...(options.kinds ? { kinds: options.kinds } : {}), finish });
    store.set(statusMessageAtom, t("{prompt} — Esc or right-click to cancel", { prompt }));
  });
}

/**
 * Put a `MapToolRequest` in front of the viewport. It runs until its handle's `stop`,
 * Esc / right-click (`cancelMapToolAtom`, unless the spec keeps it), a scenario change,
 * the plugin's deactivation, or a newer tool; `finish` clears the atom itself and
 * tells the spec once. A pick in progress is left alone — the viewport serves it first.
 */
export function startMapTool(store: Store, bag: Contributions, info: PluginInfo, spec: MapToolSpec): MapToolHandle {
  store.get(mapToolAtom)?.finish("replaced");
  const key = nextContributionKey();
  let done = false;
  let unsubDoc = () => {};
  let disposable = { dispose: () => {} };
  const finish = (reason: MapToolStopReason) => {
    if (done) return;
    done = true;
    unsubDoc();
    disposable.dispose();
    if (store.get(mapToolAtom)?.key === key) store.set(mapToolAtom, null);
    store.set(statusMessageAtom, reason === "stopped" ? t("{name} — done", { name: spec.name }) : reason === "cancelled" ? t("{name} — cancelled", { name: spec.name }) : t("{name} — stopped", { name: spec.name }));
    try { spec.onStop?.(reason); } catch (err) { logError(info.name, "A map tool's onStop failed", err); }
    store.set(mapToolRevisionAtom, store.get(mapToolRevisionAtom) + 1);
  };
  unsubDoc = store.sub(scenarioAtom, () => finish("document"));
  disposable = bag.add(() => finish("disabled"));
  store.set(mapToolAtom, { key, pluginId: info.id, spec, finish });
  store.set(statusMessageAtom, spec.hint ? t("{name} — {hint} — Esc or right-click to stop", { name: spec.name, hint: spec.hint }) : t("{name} — Esc or right-click to stop", { name: spec.name }));
  return {
    stop: () => finish("stopped"),
    isActive: () => !done,
    redraw: () => { if (!done) store.set(mapToolRevisionAtom, store.get(mapToolRevisionAtom) + 1); },
  };
}

/**
 * `api.ui.overlay`: one `PluginOverlayEntry` in `pluginOverlaysAtom`, which `MapViewport`
 * draws at its slot while visible and forwards the pointer to, and which the View menu
 * and the Layers panel list with a tick. Visibility changes all go through
 * `setOverlayVisibleAtom`, so `onToggle` fires the same way for the handle and the
 * chrome. Nothing about a document is held: the overlay stays registered across maps
 * (its `draw` is simply not called while none is open) and leaves with the plugin.
 */
export function registerOverlay(store: Store, bag: Contributions, info: PluginInfo, spec: OverlaySpec): OverlayHandle {
  const key = nextContributionKey();
  const remembered = overlayVisibilityMemory.get(overlayMemoryKey(info.id, spec.name));
  const visible = remembered ?? spec.visible ?? true;
  let removed = false;
  const entry = () => store.get(pluginOverlaysAtom).find((o) => o.key === key);
  const bump = () => store.set(pluginOverlayRevisionAtom, store.get(pluginOverlayRevisionAtom) + 1);
  const remove = () => {
    if (removed) return;
    removed = true;
    disposable.dispose();
    store.set(pluginOverlaysAtom, store.get(pluginOverlaysAtom).filter((o) => o.key !== key));
    bump();
  };
  const disposable = bag.add(remove);
  store.set(pluginOverlaysAtom, [...store.get(pluginOverlaysAtom), { key, plugin: info, spec, visible }]);
  bump();
  const set = (v: boolean) => { if (!removed) store.set(setOverlayVisibleAtom, key, v); };
  return {
    show: () => set(true),
    hide: () => set(false),
    toggle: () => set(!(entry()?.visible ?? false)),
    isVisible: () => entry()?.visible ?? false,
    redraw: () => { if (!removed) bump(); },
    remove,
  };
}

/** `api.ui.statusItem`: one cell in the status bar, kept on `pluginStatusItemsAtom` until removed or the plugin goes. */
export function addStatusItem(store: Store, bag: Contributions, info: PluginInfo, spec: StatusItemSpec): StatusItemHandle {
  const key = nextContributionKey();
  let shown = true;
  const write = (next: StatusItemSpec) => store.set(pluginStatusItemsAtom, store.get(pluginStatusItemsAtom).map((e) => (e.key === key ? { ...e, spec: next } : e)));
  const handle: StatusItemHandle = {
    set: (patch) => {
      if (!shown) return;
      const cur = store.get(pluginStatusItemsAtom).find((e) => e.key === key)?.spec ?? spec;
      write({ ...cur, ...patch });
    },
    remove: () => {
      if (!shown) return;
      shown = false;
      store.set(pluginStatusItemsAtom, store.get(pluginStatusItemsAtom).filter((e) => e.key !== key));
    },
    isShown: () => shown,
  };
  store.set(pluginStatusItemsAtom, [...store.get(pluginStatusItemsAtom), { key, plugin: info, spec: { ...spec } }]);
  const sweep = bag.add(() => handle.remove());
  const unsub = store.sub(pluginStatusItemsAtom, () => { if (!shown) { unsub(); sweep.dispose(); } });
  return handle;
}

/** `api.ui.mapButton`: one button in the map's corner row, kept on `pluginMapButtonsAtom` until removed or the plugin goes. */
export function addMapButton(store: Store, bag: Contributions, info: PluginInfo, spec: MapButtonSpec): MapButtonHandle {
  if (!spec || typeof spec.label !== "string" || typeof spec.onClick !== "function") throw new Error("ui.mapButton needs a label and onClick.");
  const key = nextContributionKey();
  let shown = true;
  const handle: MapButtonHandle = {
    set: (patch) => {
      if (!shown) return;
      store.set(pluginMapButtonsAtom, store.get(pluginMapButtonsAtom).map((e) => (e.key === key ? { ...e, spec: { ...e.spec, ...patch } } : e)));
    },
    remove: () => {
      if (!shown) return;
      shown = false;
      store.set(pluginMapButtonsAtom, store.get(pluginMapButtonsAtom).filter((e) => e.key !== key));
    },
    isShown: () => shown,
  };
  store.set(pluginMapButtonsAtom, [...store.get(pluginMapButtonsAtom), { key, plugin: info, spec: { ...spec } }]);
  const sweep = bag.add(() => handle.remove());
  const unsub = store.sub(pluginMapButtonsAtom, () => { if (!shown) { unsub(); sweep.dispose(); } });
  return handle;
}
