/**
 * Preferences that survive a reload (localStorage), and the grid's look.
 *
 * Only settings something actually reads live here; `PreferencesDialog` shows nothing
 * else. The storage itself (and its memory fallback for when `localStorage` is
 * unavailable) is `atoms/storage.ts`, which also knows how to sweep the lot —
 * `clearStoredDataAtom` at the bottom is Preferences ▸ Clear browser data.
 */
import { atom } from "jotai";
import { atomWithStorage, createJSONStorage, RESET } from "jotai/utils";
import type { TilesetId } from "../data/tilesets";
import { installedPluginsAtom, pluginCodeAtom, pluginManifestCacheAtom, registryCacheAtom, userRegistriesAtom } from "./pluginAtoms";
import { browserStorage, clearStoredData, storedKeys } from "./storage";

export interface Preferences {
  /** Show the splash while the game data loads; off starts straight on the editor. */
  splash: boolean;
  /** Ask before closing or replacing a map with unsaved changes. */
  confirmClose: boolean;
  /** What File ▸ New and the startup map start with. */
  newMap: { tileset: TilesetId; width: number; height: number };
  /** Initial View ▸ Animate Water / Animate Units. */
  animateWater: boolean;
  animateUnits: boolean;
  /**
   * Where to fetch the game data from when this build has none and the browser keeps no
   * copy: the extracted tree, or the two archives, under one address. "" means the
   * build's own default (`VITE_GAME_DATA_URL`), which a desktop build leaves empty.
   */
  gameDataUrl: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  splash: true,
  confirmClose: true,
  newMap: { tileset: "badlands", width: 128, height: 128 },
  animateWater: true,
  animateUnits: true,
  gameDataUrl: "",
};

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

/** Stored values are merged over the defaults, so a preference added later still has one. */
function merged<T extends object>(defaults: T) {
  const json = createJSONStorage<T>(browserStorage);
  return {
    ...json,
    getItem: (key: string, initial: T): T => {
      const stored = json.getItem(key, initial);
      return stored && typeof stored === "object" ? { ...defaults, ...stored } : initial;
    },
  };
}

// getOnInit: the startup hooks read these through `store.get` before anything subscribes.
export const preferencesAtom = atomWithStorage<Preferences>("scmjs.prefs", DEFAULT_PREFERENCES, merged(DEFAULT_PREFERENCES), { getOnInit: true });
export const gridLookAtom = atomWithStorage<GridLook>("scmjs.grid", DEFAULT_GRID_LOOK, merged(DEFAULT_GRID_LOOK), { getOnInit: true });

/* ── Clearing ───────────────────────────────────────────── */

/**
 * Forget everything the editor keeps in the browser: the preferences, the grid look, the
 * installed plugin list, the copies of plugin code kept for the plugins marked *local*, the
 * registries browsed and their cached lists, and whatever the plugins themselves stored. The atoms are
 * `RESET` (which removes their keys and puts the defaults back live, so the plugin host
 * reloads the default set), then any remaining `scmjs.` key is swept. Returns how many
 * entries went, for the dialog to report. Nothing about the open map is touched — it was
 * never in storage.
 */
export const clearStoredDataAtom = atom(null, (_get, set): number => {
  const before = storedKeys().length;
  set(preferencesAtom, RESET);
  set(gridLookAtom, RESET);
  set(installedPluginsAtom, RESET);
  set(pluginManifestCacheAtom, RESET);
  set(pluginCodeAtom, RESET);
  set(userRegistriesAtom, RESET);
  set(registryCacheAtom, RESET);
  clearStoredData();
  return before;
});
