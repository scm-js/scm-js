/**
 * What the toolbar, the menus, the keys and the status bar offer for the map in front, by what
 * it shows: the map to edit, a map open to look at only (`viewOnlyAtom`), or a plugin's view in
 * the map's place (`shownMapViewAtom`, a replay's game). The rule is the same everywhere: the
 * toolbar leaves out what cannot do anything, the menus grey it, a key says why in the status
 * bar. What a view takes on carries over to it — the zoom (`zoomAtoms.ts`), the grid, locations
 * and other plugins' overlays (`onRepaint` + `paintOver`), the fog (`onFog` + `setFog`) and the
 * pointer (`setPointer`) — and the rest is the hidden map's, so it is off while the view is shown.
 */
import { atom } from "jotai";
import { t } from "../i18n";
import type { ViewFlags } from "../editor/view";
import { logError } from "../editor/log";
import { locationsAutoHiddenAtom, viewFlagsAtom, viewOnlyAtom } from "./editorAtoms";
import { mapViewFogAtom, mapViewPointerAtom, shownMapViewAtom, type PluginMapViewEntry, type PluginOverlayEntry } from "./pluginAtoms";
import { statusMessageAtom } from "./uiAtoms";

export interface ChromeMode {
  /** The map is open to look at only. */
  viewOnly: boolean;
  /** The plugin's view shown in the map's place, or null when the map is. */
  view: PluginMapViewEntry | null;
  /** That view's fog as its `setFog` last said: undefined before it says, null when it has none to show. */
  viewFog: boolean | null | undefined;
  /** Whether that view has said where the pointer is over it (`setPointer`), and it is on the view. */
  viewPointer: boolean;
}

export const chromeModeAtom = atom<ChromeMode>((get) => {
  const view = get(shownMapViewAtom);
  return {
    viewOnly: get(viewOnlyAtom) !== null,
    view,
    viewFog: view ? get(mapViewFogAtom).get(view.key) : undefined,
    viewPointer: view ? (get(mapViewPointerAtom).get(view.key) ?? null) !== null : false,
  };
});

/** The toggles a view that draws the editor's drawing over itself (`onRepaint`) shows. */
const PAINTED: ReadonlySet<keyof ViewFlags> = new Set(["grid", "locations", "locationNames"]);
/** The toggles a view reads for itself whatever it is (the game's Remastered pictures). */
const READ_BY_VIEWS: ReadonlySet<keyof ViewFlags> = new Set(["hdGraphics"]);

/** Whether a View toggle means anything for what the map in front shows. */
export function flagOffered(mode: ChromeMode, k: keyof ViewFlags): boolean {
  const v = mode.view;
  if (!v) return true;
  if (k === "fog") return !!v.spec.onFog && mode.viewFog !== null;
  if (PAINTED.has(k)) return !!v.spec.onRepaint;
  return READ_BY_VIEWS.has(k);
}

/** A toggle as it shows: the fog is the view's own while one that has fog is shown. */
export function flagShown(mode: ChromeMode, flags: ViewFlags, k: keyof ViewFlags): boolean {
  if (k === "fog" && mode.view?.spec.onFog) return mode.viewFog === true;
  return flags[k];
}

/** A plugin's overlay can be seen: over the map, or over a view that draws the others' (`paintOver`), or it is the view's own. */
export function overlayOffered(mode: ChromeMode, o: PluginOverlayEntry): boolean {
  const v = mode.view;
  return !v || !!v.spec.onRepaint || o.plugin.id === v.plugin.id;
}

/** The map's own tools — its layers, selection, clipboard, find, brush and symmetry — are the map's in front. */
export const mapInFront = (mode: ChromeMode): boolean => mode.view === null;

/** What the status bar says when a command is the hidden map's. */
export function notOnView(view: PluginMapViewEntry): string {
  return t("Not in the {view} view: switch to Map for that", { view: view.spec.title });
}

/** View ▸ a toggle, its toolbar button or its key: the map's flag, or the view's fog; `on` sets it rather than flipping it. */
export const toggleFlagAtom = atom(null, (get, set, k: keyof ViewFlags, on?: boolean) => {
  const mode = get(chromeModeAtom);
  if (mode.view && !flagOffered(mode, k)) { set(statusMessageAtom, notOnView(mode.view)); return; }
  const next = on ?? !flagShown(mode, get(viewFlagsAtom), k);
  const view = mode.view;
  if (k === "fog" && view?.spec.onFog) {
    try { view.spec.onFog(next); } catch (err) { logError(view.plugin.name, "A map view's onFog failed", err); }
    return;
  }
  set(viewFlagsAtom, (f) => ({ ...f, [k]: next }));
  if (k === "locations") set(locationsAutoHiddenAtom, false);
});
