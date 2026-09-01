/**
 * Preferences that survive a reload (localStorage), and the grid's look.
 *
 * Only settings something actually reads live here; `PreferencesDialog` shows nothing
 * else. `localStorage` can be unavailable (a sandboxed frame, tests) — the storage falls
 * back to memory so the atoms always work.
 */
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import type { TilesetId } from "../data/tilesets";

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

const memory = new Map<string, string>();
const memoryStorage: Storage = {
  get length() { return memory.size; },
  clear: () => memory.clear(),
  getItem: (k) => memory.get(k) ?? null,
  key: (i) => [...memory.keys()][i] ?? null,
  removeItem: (k) => { memory.delete(k); },
  setItem: (k, v) => { memory.set(k, v); },
};

function storage(): Storage {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Access itself can throw (storage disabled); fall through.
  }
  return memoryStorage;
}

/** Stored values are merged over the defaults, so a preference added later still has one. */
function merged<T extends object>(defaults: T) {
  const json = createJSONStorage<T>(storage);
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
