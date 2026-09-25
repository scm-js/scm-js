/**
 * The preferences Edit ▸ Preferences keeps (the values themselves live in
 * `atoms/preferencesAtoms.ts`, in localStorage). Plain types, so the plugin typings can
 * name them without the atoms.
 */
import type { TilesetId } from "../data/tilesets";
import type { MapVersion } from "../formats/chk/scenario";
import type { ArchiveCompression } from "../formats/mpq/scm";
import type { LanguagePreference } from "../i18n";

export type { LanguagePreference };

export interface Preferences {
  /** The editor's own language: `"auto"` follows the browser's (the system's, in the desktop app), else one of `LOCALES`. Applied live. */
  language: LanguagePreference;
  /** Show the splash while the game data loads; off starts straight on the editor. */
  splash: boolean;
  /** Ask before closing or replacing a map with unsaved changes. */
  confirmClose: boolean;
  /**
   * Open each map beside the ones already open, in its own tab, rather than in place of
   * the open one. Off is StarEdit's one map at a time: Open and New replace the map, asking
   * about unsaved changes first. Either way the blank map the editor starts on, untouched,
   * is replaced by the first map opened rather than kept beside it.
   */
  multipleMaps: boolean;
  /**
   * What File ▸ New and the startup map start with. `version` is the file's revision:
   * Brood War (VER 205, what every build reads) or Remastered (206, 32-bit strings).
   */
  newMap: { tileset: TilesetId; width: number; height: number; version: NewMapVersion };
  /**
   * Startup: `reopenLast` opens the most recent file again in place of the blank map
   * (the desktop app straight away; a browser needs a click first, so it asks in a
   * notice), and `recents` is how many File ▸ Open Recent keeps.
   */
  startup: { reopenLast: boolean; recents: number };
  /**
   * What the Save dialog starts from: the options the file was opened with
   * (`"asOpened"`, the default), or one of its presets. `compression` is for a map with
   * no origin — new, or opened from a bare .chk — where there is nothing to follow;
   * `"asOpened"` there means StarEdit's PKWARE.
   */
  save: { start: "asOpened" | "everything" | "smallest"; compression: "asOpened" | ArchiveCompression };
  /**
   * Recovery copies (`hooks/useRecovery.ts`): while a map has unsaved changes, a copy of
   * it is kept in the browser's storage every `minutes` and when the editor goes to the
   * background, and dropped when the map is saved or closed. What a session that ended
   * without saving left behind is offered back at the next start. Off stops the copies
   * and drops this session's; copies left by earlier sessions are still offered.
   */
  recovery: { enabled: boolean; minutes: number };
  /** How many edits Undo keeps per map (SCMDraft keeps 200). */
  undoLevels: number;
  /**
   * The mouse wheel over the map: scrolling, with Ctrl+wheel zooming (the default), or
   * zooming, with Shift+wheel scrolling sideways. `zoomToCursor` keeps the tile under the
   * pointer in place when the wheel zooms; the menu and keyboard keep the centre.
   */
  view: { wheel: "scroll" | "zoom"; zoomToCursor: boolean };
  /**
   * What the palettes start on: the owner of placed units and sprites (0 = player 1),
   * the brush size (1–7), and the size of a location the Locations palette's New makes,
   * in tiles.
   */
  placement: { owner: number; brushSize: number; locationTiles: number };
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

/** The revisions a new map can start on; the two older ones are for opening old files, not making new ones. */
export type NewMapVersion = Extract<MapVersion, "broodwar" | "remastered">;

/** The bounds Preferences keeps the numbers in. */
export const PREFERENCE_LIMITS = {
  undoLevels: { min: 20, max: 1000 },
  recents: { min: 5, max: 30 },
  brushSize: { min: 1, max: 7 },
  locationTiles: { min: 1, max: 16 },
  recoveryMinutes: { min: 1, max: 30 },
} as const;

export const DEFAULT_PREFERENCES: Preferences = {
  language: "auto",
  splash: true,
  confirmClose: true,
  multipleMaps: true,
  newMap: { tileset: "badlands", width: 128, height: 128, version: "broodwar" },
  startup: { reopenLast: false, recents: 10 },
  save: { start: "asOpened", compression: "asOpened" },
  recovery: { enabled: true, minutes: 2 },
  undoLevels: 200,
  view: { wheel: "scroll", zoomToCursor: true },
  placement: { owner: 0, brushSize: 1, locationTiles: 4 },
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
