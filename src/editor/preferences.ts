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
   * How fast the two animations run, as a multiple of the game's own speed (1 = the
   * game's "Fastest"). One of `ANIMATION_SPEEDS`; applied live, not just at startup.
   */
  animateWaterSpeed: number;
  animateUnitsSpeed: number;
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
  animateWaterSpeed: 1,
  animateUnitsSpeed: 1,
  testMap: { launch: true, dir: "" },
};

/** The speeds the Preferences sliders offer, slowest first. */
export const ANIMATION_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** The nearest offered speed to `value`, so a stored or reset value always lands on a step. */
export function animationSpeedIndex(value: number): number {
  let best = 0;
  for (let i = 1; i < ANIMATION_SPEEDS.length; i++) {
    if (Math.abs(ANIMATION_SPEEDS[i] - value) < Math.abs(ANIMATION_SPEEDS[best] - value)) best = i;
  }
  return best;
}
