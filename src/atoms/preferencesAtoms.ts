/**
 * Preferences that survive a reload (localStorage), and the grid's look.
 *
 * Only settings something actually reads live here; `PreferencesDialog` shows nothing
 * else. The storage itself (and its memory fallback for when `localStorage` is
 * unavailable) is `atoms/storage.ts`, which also knows how to sweep the lot —
 * `clearStoredDataAtom` at the bottom is Preferences ▸ Clear all data, and
 * `clearStoredKeysAtom` beside it is one row of that list.
 */
import { atom, type Getter, type Setter } from "jotai";
import { atomWithStorage, RESET } from "jotai/utils";
import { DEFAULT_PREFERENCES, type Preferences } from "../editor/preferences";
import { resolveLocale } from "../i18n";
import { installedPluginsAtom, pluginCodeAtom, pluginManifestCacheAtom, pluginUpdateCheckAtom, registryCacheAtom, userRegistriesAtom } from "./pluginAtoms";
import { browserStorage, mergedStorage, removeStoredKeys, STORAGE_PREFIX, storedKeys, storedValue } from "./storage";
import { doodadPlacementAtom, gridSizeAtom, locationSnapAtom, placementOptionsAtom } from "./editorAtoms";
import { dockWidthsAtom, panelsAtom } from "./uiAtoms";
import { consoleHeightAtom, debugConsoleAtom } from "./logAtoms";
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

/**
 * The language the preference resolves to — what `useApplyPreferences` hands
 * `setLocale`, and the atom behind the plugin `"language"` event. Derived, so it
 * changes exactly when the preference does.
 */
export const localeAtom = atom((get) => resolveLocale(get(preferencesAtom).language, typeof navigator === "undefined" ? undefined : navigator.language));
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
  "scmjs.console": (set) => set(debugConsoleAtom, RESET),
  "scmjs.consoleHeight": (set) => set(consoleHeightAtom, RESET),
  "scmjs.recents": (set) => { set(recentFilesAtom, RESET); void clearHandles(); },
  "scmjs.plugins": (set) => set(installedPluginsAtom, RESET),
  "scmjs.plugin-manifests": (set) => set(pluginManifestCacheAtom, RESET),
  "scmjs.plugin-code": (set) => set(pluginCodeAtom, RESET),
  "scmjs.plugin-registries": (set) => set(userRegistriesAtom, RESET),
  "scmjs.plugin-registry": (set) => set(registryCacheAtom, RESET),
  "scmjs.plugin-updates": (set) => set(pluginUpdateCheckAtom, RESET),
  // The choice only; the copies themselves are in the origin's file storage, which Game Data… removes.
  "scmjs.gameData": (set) => set(gameDataProfileAtom, RESET),
};

/** The keys an atom owns — everything Preferences can clear *and* put back live. */
export function ownedStoredKeys(): string[] {
  return Object.keys(STORED_RESETS).sort();
}

/* ── Export / import ────────────────────────────────────── */

/**
 * The keys a preferences file leaves out: caches the editor rebuilds, and the recents,
 * whose file handles live in this browser's IndexedDB and would not travel with them.
 */
const NOT_EXPORTED = new Set(["scmjs.plugin-code", "scmjs.plugin-manifests", "scmjs.plugin-registry", "scmjs.plugin-updates", "scmjs.recents"]);

/** The shape of the file Preferences ▸ Storage ▸ Export writes. */
export interface PreferencesFile {
  scmjs: "preferences";
  version: 1;
  /** Stored key → the JSON text the editor keeps under it. */
  keys: Record<string, string>;
}

/** Every setting worth carrying to another browser or machine, as the file's contents. */
export function exportStoredPreferences(): PreferencesFile {
  const keys: Record<string, string> = {};
  for (const key of storedKeys()) {
    if (NOT_EXPORTED.has(key)) continue;
    const value = storedValue(key);
    if (value !== null) keys[key] = value;
  }
  return { scmjs: "preferences", version: 1, keys };
}

/** What `importStoredPreferencesAtom` makes of a file: how many keys it took, or why not. */
export type PreferencesImport = { ok: true; keys: number } | { ok: false; reason: string };

/**
 * Take a preferences file into storage. Each key is written as the file has it, then the
 * atom behind it is `RESET` so `getOnInit` reads the new value back live; a key nothing
 * owns (a plugin's own) is just written, for the plugin to read when it next looks. Keys
 * outside the editor's prefix, and the caches never exported, are ignored.
 */
export const importStoredPreferencesAtom = atom(null, (get, set, file: unknown): PreferencesImport => {
  if (!file || typeof file !== "object" || (file as PreferencesFile).scmjs !== "preferences" || typeof (file as PreferencesFile).keys !== "object") return { ok: false, reason: "not a preferences file" };
  const entries = Object.entries((file as PreferencesFile).keys).filter(([key, value]) => key.startsWith(STORAGE_PREFIX) && !NOT_EXPORTED.has(key) && typeof value === "string");
  const storage = browserStorage();
  let taken = 0;
  for (const [key, value] of entries) {
    try { JSON.parse(value); } catch { continue; }
    try { storage.setItem(key, value); taken++; } catch { continue; }
    // RESET removes the key and puts the default back; write again, then re-read.
    const owner = STORED_RESETS[key];
    if (owner) {
      owner(set);
      try { storage.setItem(key, value); } catch { /* the first write went through, this one is the same bytes */ }
      RELOADS[key]?.(get, set);
    }
  }
  return { ok: true, keys: taken };
});

/**
 * Re-read an atom's value from storage after an import. `atomWithStorage` with
 * `getOnInit` reads once; setting the parsed value through the atom keeps the store and
 * storage in step without a reload. Every key in `STORED_RESETS` is here.
 */
const RELOADS: Record<string, (get: Getter, set: Setter) => void> = {
  "scmjs.prefs": (_get, set) => set(preferencesAtom, mergedStorage(DEFAULT_PREFERENCES).getItem("scmjs.prefs", DEFAULT_PREFERENCES)),
  "scmjs.grid": (_get, set) => set(gridLookAtom, mergedStorage(DEFAULT_GRID_LOOK).getItem("scmjs.grid", DEFAULT_GRID_LOOK)),
  "scmjs.gridSize": (_get, set) => set(gridSizeAtom, parsed("scmjs.gridSize", 32)),
  "scmjs.locationSnap": (_get, set) => set(locationSnapAtom, parsed("scmjs.locationSnap", 32)),
  "scmjs.placement": (get, set) => set(placementOptionsAtom, parsedMerged("scmjs.placement", get(placementOptionsAtom))),
  "scmjs.doodadPlacement": (get, set) => set(doodadPlacementAtom, parsedMerged("scmjs.doodadPlacement", get(doodadPlacementAtom))),
  "scmjs.panels": (get, set) => set(panelsAtom, parsedMerged("scmjs.panels", get(panelsAtom))),
  "scmjs.docks": (get, set) => set(dockWidthsAtom, parsedMerged("scmjs.docks", get(dockWidthsAtom))),
  "scmjs.console": (_get, set) => set(debugConsoleAtom, parsed("scmjs.console", false)),
  "scmjs.consoleHeight": (_get, set) => set(consoleHeightAtom, parsed("scmjs.consoleHeight", 176)),
  "scmjs.recents": () => {},
  "scmjs.plugins": (_get, set) => set(installedPluginsAtom, parsed("scmjs.plugins", [])),
  "scmjs.plugin-manifests": () => {},
  "scmjs.plugin-code": () => {},
  "scmjs.plugin-registries": (_get, set) => set(userRegistriesAtom, parsed("scmjs.plugin-registries", [])),
  "scmjs.plugin-registry": () => {},
  "scmjs.plugin-updates": () => {},
  "scmjs.gameData": (get, set) => set(gameDataProfileAtom, parsedMerged("scmjs.gameData", get(gameDataProfileAtom))),
};

function parsed<T>(key: string, fallback: T): T {
  const raw = storedValue(key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

/** The stored object over the value the atom holds now (which has every field), for the merged atoms. */
function parsedMerged<T extends object>(key: string, current: T): T {
  const raw = parsed<Partial<T> | null>(key, null);
  return raw && typeof raw === "object" ? { ...current, ...raw } : current;
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
