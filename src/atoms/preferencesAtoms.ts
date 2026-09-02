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
import { installedPluginsAtom, pluginManifestCacheAtom } from "./pluginAtoms";
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
}

export const DEFAULT_PREFERENCES: Preferences = {
  splash: true,
  confirmClose: true,
  newMap: { tileset: "badlands", width: 128, height: 128 },
  animateWater: true,
  animateUnits: true,
};

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
 * installed plugin list and whatever the plugins themselves stored. The three atoms are
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
  clearStoredData();
  return before;
});
