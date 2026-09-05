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
   * Preview the `<XX>` colour codes in strings the way **1.16.1** drew them: the colour
   * resets at every line break. Off is Remastered's rule, which carries a colour onto the
   * next line — see `editor/textColors.ts`. It changes only what the editor draws, never
   * the map, and every preview in the chrome reads it.
   */
  classicText: boolean;
  /**
   * Tools ▸ Test Map: whether to start the game after writing the map (desktop build), and
   * the game folder to use when the desktop build should not search ("" = search). The
   * browser's folder is a handle in IndexedDB (`services/handleStore.ts`), not here.
   */
  testMap: { launch: boolean; dir: string };
  /**
   * The desktop build's in-app updates (`editor/updates.ts`, `desktop/updater.ts`); the
   * browser build shows none of this, having nothing to update. `checkOnStart` asks GitHub
   * for a newer version a few seconds after launch and raises a toast when there is one.
   * `nightly` follows the nightly channel instead of the numbered releases — one-way in
   * practice, since going back to a stable release is a downgrade the updater will not
   * offer.
   */
  updates: { checkOnStart: boolean; nightly: boolean };
  /**
   * What to do when an installed plugin has a newer release than the one running
   * (`plugins/updates.ts`). `notify` looks a few seconds after the plugins start and
   * raises a notice with a button to the rows offering the update; `manual` asks nothing
   * until **Check for update** is pressed on a row; `auto` installs what it finds, for the
   * plugins the user added — a default moves with the editor's own releases and is only
   * ever named in the notice. Every mode leaves the confirmation on a row's button alone.
   */
  plugins: { updates: PluginUpdateMode };
}

/** See `Preferences.plugins.updates`. */
export type PluginUpdateMode = "notify" | "manual" | "auto";

export const DEFAULT_PREFERENCES: Preferences = {
  splash: true,
  confirmClose: true,
  newMap: { tileset: "badlands", width: 128, height: 128 },
  animateWater: true,
  animateUnits: true,
  animateWaterSpeed: 1,
  animateUnitsSpeed: 1,
  classicText: false,
  testMap: { launch: true, dir: "" },
  updates: { checkOnStart: true, nightly: false },
  plugins: { updates: "notify" },
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
