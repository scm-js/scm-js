/**
 * Plain types the chrome and the plugin API share: what the editor's layers, terrain
 * modes, View ticks and notices are called. No state lives here — the atoms in
 * `atoms/editorAtoms.ts` and `atoms/uiAtoms.ts` hold that and re-export these — so the
 * plugin typings (`npm run build:plugin-types`) can name them without dragging Jotai in.
 */

/** The classic SCMDraft layer combo; `"clipboard"` is Cut / Copy / Paste. */
export type EditorLayer =
  | "terrain"
  | "doodads"
  | "units"
  | "sprites"
  | "locations"
  | "fog"
  | "clipboard";

export type TerrainMode = "isom" | "rect" | "tile" | "blend";

export interface ViewFlags {
  grid: boolean;
  locations: boolean;
  locationNames: boolean;
  units: boolean;
  sprites: boolean;
  /** Off draws the ground under the doodads (TILE) instead of the picture (MTXM). */
  doodads: boolean;
  fog: boolean;
  /** Ground height per minitile, tinted (mid amber, high red). */
  elevation: boolean;
  /** Unbuildable tile groups, hatched in blue. */
  buildability: boolean;
  startLocations: boolean;
  /** Cycle the palette so water and lava animate as they do in game. */
  animateWater: boolean;
  /** Run the units' iscript idle animations (turrets, pulsing buildings, fires, smoke). */
  animateUnits: boolean;
}

/**
 * A short notice over the map that leaves by itself — what a save says when it is done,
 * since the status bar line is easy to miss and the menubar dot only stops glowing.
 */
export interface Toast {
  id: number;
  kind: "ok" | "info" | "warn" | "error";
  title: string;
  detail?: string;
  /** Milliseconds before it leaves on its own; 0 keeps it until dismissed. */
  ttl: number;
  /**
   * One button beside the text, for a notice that is really a question — the update
   * check's "Download". Pressing it dismisses the toast as well as running this.
   */
  action?: { label: string; run: () => void };
}
