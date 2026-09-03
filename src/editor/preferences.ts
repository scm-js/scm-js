/**
 * The preferences Edit ▸ Preferences keeps (the values themselves live in
 * `atoms/preferencesAtoms.ts`, in localStorage). Plain types, so the plugin typings can
 * name them without the atoms.
 */
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
  /**
   * Tools ▸ Test Map: whether to start the game after writing the map (desktop build), and
   * the game folder to use when the desktop build should not search ("" = search). The
   * browser's folder is a handle in IndexedDB (`services/handleStore.ts`), not here.
   */
  testMap: { launch: boolean; dir: string };
}

export const DEFAULT_PREFERENCES: Preferences = {
  splash: true,
  confirmClose: true,
  newMap: { tileset: "badlands", width: 128, height: 128 },
  animateWater: true,
  animateUnits: true,
  testMap: { launch: true, dir: "" },
};
