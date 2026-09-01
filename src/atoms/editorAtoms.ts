import { atom } from "jotai";
import type { TilesetId } from "../data/tilesets";
import { defaultForces, defaultPlayers, type ForceInfo, type PlayerSlot } from "../data/players";
import { DEFAULT_PLACEMENT, type PlacementOptions } from "../editor/placement";
import { DEFAULT_DOODAD_PLACEMENT, type DoodadPlacementOptions } from "../editor/doodads";
import type { FogMode } from "../editor/fog";

/* ── Screens ────────────────────────────────────────────── */

export type EditorScreen = "splash" | "editor";
export const screenAtom = atom<EditorScreen>("splash");

/* ── Layers (classic SCMDraft layer combo) ──────────────── */

export type EditorLayer =
  | "terrain"
  | "doodads"
  | "units"
  | "sprites"
  | "locations"
  | "fog"
  | "clipboard";

export const activeLayerAtom = atom<EditorLayer>("terrain");

/** Terrain sub-mode inside the Terrain palette. */
export type TerrainMode = "isom" | "rect" | "tile";
export const TERRAIN_MODES: readonly TerrainMode[] = ["isom", "rect", "tile"];
export const terrainModeAtom = atom<TerrainMode>("isom");

export const brushSizeAtom = atom<number>(1);
/** ISOM terrain id the Isometric and Rect brushes paint. See data/tilesets.ts. */
export const activeTerrainAtom = atom<number>(2);
/** Variation slot the Rect brush uses for every pair, or -1 for StarEdit's random pick. */
export const rectVariationAtom = atom<number>(-1);
/** Raw MTXM tile id the Tile brush paints. */
export const activeTileAtom = atom<number>(0x20);
/** units.dat id the Units layer places. */
export const activeUnitAtom = atom<number>(0);
export const unitOwnerAtom = atom<number>(0);
/** Indices into `scenario.units` of the selected units; cleared whenever the list is edited under it. */
export const selectedUnitsAtom = atom<number[]>([]);
/**
 * Whether a click on empty ground places `activeUnitAtom`. Picking a unit in the palette
 * arms it; Escape or a right-click disarms it, leaving plain select mode.
 */
export const unitPlacingAtom = atom<boolean>(false);
/** The Units layer's placement checks (see editor/placement.ts). */
export const placementOptionsAtom = atom<PlacementOptions>(DEFAULT_PLACEMENT);

/* ── Doodads layer (see editor/doodads.ts) ──────────────── */

/** dddata index of the doodad the palette has picked, or -1 before anything was picked. */
export const activeDoodadAtom = atom<number>(-1);
/** Palette category the doodad grid shows; "" = the tileset's first. */
export const doodadCategoryAtom = atom<string>("");
/** Whether a click on the map places `activeDoodadAtom` (armed by the palette, disarmed by Esc / right-click). */
export const doodadPlacingAtom = atom<boolean>(false);
/** Indices into `scenario.doodads` of the selected doodads; cleared whenever the list is edited under it. */
export const selectedDoodadsAtom = atom<number[]>([]);
/** "Place anywhere" (off) and "Snap to grid" (on) — StarEdit's defaults. */
export const doodadPlacementAtom = atom<DoodadPlacementOptions>(DEFAULT_DOODAD_PLACEMENT);

/* ── Fog of war layer (see editor/fog.ts) ───────────────── */

/** Bit mask of the players (bit n = player n+1) the fog brush paints for. */
export const fogPlayersAtom = atom<number>(0x01);
/** Whether the brush lays fog (unexplored) or clears it (explored). */
export const fogModeAtom = atom<FogMode>("fog");
/** Whose fog the viewport and minimap draw, 0–7 (shown while `viewFlags.fog` is on). */
export const fogViewPlayerAtom = atom<number>(0);

/* ── Map document (placeholder — no real parsing yet) ───── */

export const mapNameAtom = atom<string>("Untitled Scenario");
export const mapDescriptionAtom = atom<string>("Destroy all enemy buildings.");
export const mapTilesetAtom = atom<TilesetId>("badlands");
export const mapWidthAtom = atom<number>(128);
export const mapHeightAtom = atom<number>(128);
export const mapModifiedAtom = atom<boolean>(false);
export const mapFilePathAtom = atom<string | null>(null);
export const mapVersionAtom = atom<"original" | "hybrid" | "broodwar" | "remastered">("broodwar");

export const playersAtom = atom<PlayerSlot[]>(defaultPlayers());
export const forcesAtom = atom<ForceInfo[]>(defaultForces());

/* ── Viewport ───────────────────────────────────────────── */

export const zoomAtom = atom<number>(1);
export const cursorTileAtom = atom<{ x: number; y: number }>({ x: 0, y: 0 });
export const viewportRectAtom = atom<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 1, h: 1 });

/**
 * One-shot request to centre the main viewport on a tile — set by the minimap,
 * consumed (and cleared) by MapViewport.
 */
export const centerViewOnAtom = atom<{ x: number; y: number } | null>(null);

export interface ViewFlags {
  grid: boolean;
  locations: boolean;
  locationNames: boolean;
  units: boolean;
  sprites: boolean;
  doodads: boolean;
  fog: boolean;
  elevation: boolean;
  buildability: boolean;
  startLocations: boolean;
  /** Cycle the palette so water and lava animate as they do in game. */
  animateWater: boolean;
  /** Run the units' iscript idle animations (turrets, pulsing buildings, fires, smoke). */
  animateUnits: boolean;
}

export const viewFlagsAtom = atom<ViewFlags>({
  // StarEdit draws no grid until you ask for one, and terrain reads better without it.
  grid: false,
  locations: true,
  locationNames: true,
  units: true,
  sprites: true,
  doodads: true,
  fog: false,
  elevation: false,
  buildability: false,
  startLocations: true,
  animateWater: true,
  animateUnits: true,
});

export const gridSizeAtom = atom<8 | 16 | 32 | 64 | 128>(32);
