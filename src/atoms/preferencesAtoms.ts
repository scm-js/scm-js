/**
 * Preferences that survive a reload (localStorage), and the grid's look.
 *
 * Only settings something actually reads live here; `PreferencesDialog` shows nothing
 * else. The storage itself (and its memory fallback for when `localStorage` is
 * unavailable) is `atoms/storage.ts`, which also knows how to sweep the lot —
 * `clearStoredDataAtom` at the bottom is Preferences ▸ Clear all data, and
 * `clearStoredKeysAtom` beside it is one row of that list.
 */
import { atom, type Setter } from "jotai";
import { atomWithStorage, RESET } from "jotai/utils";
import { DEFAULT_PREFERENCES, type Preferences } from "../editor/preferences";
import { installedPluginsAtom, pluginCodeAtom, pluginManifestCacheAtom, registryCacheAtom, userRegistriesAtom } from "./pluginAtoms";
import { browserStorage, mergedStorage, removeStoredKeys, storedKeys } from "./storage";
import { doodadPlacementAtom, gridSizeAtom, locationSnapAtom, placementOptionsAtom } from "./editorAtoms";
import { dockWidthsAtom, panelsAtom } from "./uiAtoms";
import { clearHandles } from "../services/handleStore";
import { recentFilesAtom } from "./documentAtoms";
import { gameDataProfileAtom } from "./gameDataAtoms";

export type { Preferences } from "../editor/preferences";
export { ANIMATION_SPEEDS, animationSpeedIndex, DEFAULT_PREFERENCES } from "../editor/preferences";

/**
 * One preference straight from storage, for code that runs before (or outside) the
 * Jotai store — the game-data resolver can be asked by a viewport effect before the
 * app's own effects have run. The same JSON `atomWithStorage` reads.
 */
export function storedPreference<K extends keyof Preferences>(key: K, fallback: Preferences[K]): Preferences[K] {
  try {
    const raw = browserStorage().getItem("scmjs.prefs");
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as Partial<Preferences>;
    return stored[key] ?? fallback;
  } catch {
    return fallback;
  }
}

export type GridStyle = "lines" | "dots" | "crosses";

export interface GridLook {
  /** CSS hex colour. */
  color: string;
  /** 0–100. */
  opacity: number;
  style: GridStyle;
}

export const DEFAULT_GRID_LOOK: GridLook = { color: "#000000", opacity: 28, style: "lines" };

// getOnInit: the startup hooks read these through `store.get` before anything subscribes.
export const preferencesAtom = atomWithStorage<Preferences>("scmjs.prefs", DEFAULT_PREFERENCES, mergedStorage(DEFAULT_PREFERENCES), { getOnInit: true });
export const gridLookAtom = atomWithStorage<GridLook>("scmjs.grid", DEFAULT_GRID_LOOK, mergedStorage(DEFAULT_GRID_LOOK), { getOnInit: true });

/**
 * The animation speeds on their own, so the viewport's rAF loop follows a change to
 * either slider without re-running for every other preference.
 */
export const animateWaterSpeedAtom = atom((get) => get(preferencesAtom).animateWaterSpeed);
export const animateUnitsSpeedAtom = atom((get) => get(preferencesAtom).animateUnitsSpeed);

/* ── Clearing ───────────────────────────────────────────── */

/**
 * The stored keys an atom owns, and how to put that atom back on its default. Resetting is
 * what makes a clear take effect *live* (the plugin host reloads the default set, the grid
 * goes back to its look) instead of at the next reload, and `RESET` removes the key on the
 * way. Anything not listed here — the plugins' own `scmjs.plugin.<id>.…` keys — is nobody's
 * atom and is simply swept.
 *
 * Keep it complete: a stored key missing from this table is one that Preferences can only
 * remove from storage, leaving the value it holds live until the page is reloaded.
 */
const STORED_RESETS: Record<string, (set: Setter) => void> = {
  "scmjs.prefs": (set) => set(preferencesAtom, RESET),
  "scmjs.grid": (set) => set(gridLookAtom, RESET),
  "scmjs.gridSize": (set) => set(gridSizeAtom, RESET),
  "scmjs.locationSnap": (set) => set(locationSnapAtom, RESET),
  "scmjs.placement": (set) => set(placementOptionsAtom, RESET),
  "scmjs.doodadPlacement": (set) => set(doodadPlacementAtom, RESET),
  "scmjs.panels": (set) => set(panelsAtom, RESET),
  "scmjs.docks": (set) => set(dockWidthsAtom, RESET),
  "scmjs.recents": (set) => { set(recentFilesAtom, RESET); void clearHandles(); },
  "scmjs.plugins": (set) => set(installedPluginsAtom, RESET),
  "scmjs.plugin-manifests": (set) => set(pluginManifestCacheAtom, RESET),
  "scmjs.plugin-code": (set) => set(pluginCodeAtom, RESET),
  "scmjs.plugin-registries": (set) => set(userRegistriesAtom, RESET),
  "scmjs.plugin-registry": (set) => set(registryCacheAtom, RESET),
  // The choice only; the copies themselves are in the origin's file storage, which Game Data… removes.
  "scmjs.gameData": (set) => set(gameDataProfileAtom, RESET),
};

/** The keys an atom owns — everything Preferences can clear *and* put back live. */
export function ownedStoredKeys(): string[] {
  return Object.keys(STORED_RESETS).sort();
}

/**
 * Forget some of what the editor keeps in storage: the atom behind each key is `RESET`
 * (its default comes back live and the key goes with it), then whatever is left of the
 * listed keys is swept, so a plugin's own keys and any key from an older version go too.
 * Returns how many of them were actually there, for the dialog to report. Nothing about
 * the open map is touched — it was never in storage.
 */
export const clearStoredKeysAtom = atom(null, (_get, set, keys: readonly string[]): number => {
  const before = new Set(storedKeys());
  for (const key of keys) STORED_RESETS[key]?.(set);
  removeStoredKeys(keys);
  return keys.filter((key) => before.has(key)).length;
});

/**
 * Forget everything: the preferences, the grid look and what snaps to it, the placement
 * options of the Units and Doodads palettes, the panels and their widths, the recent files
 * (and the file handles behind them), the installed plugin list, the copies of plugin code
 * kept for the plugins marked *local*, the registries browsed and their cached lists, and
 * whatever the plugins themselves stored. Every atom is reset whether or not it had a key,
 * so the defaults come back live even for a setting that was never written.
 */
export const clearStoredDataAtom = atom(null, (_get, set): number => {
  const before = storedKeys().length;
  set(clearStoredKeysAtom, [...ownedStoredKeys(), ...storedKeys()]);
  return before;
});
