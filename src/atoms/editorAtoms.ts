import { atom } from "jotai";
import type { TilesetId } from "../data/tilesets";
import { defaultForces, defaultPlayers, type ForceInfo, type PlayerSlot } from "../data/players";

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
export const activeUnitAtom = atom<string>("Marine");
export const unitOwnerAtom = atom<number>(0);

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
});

export const gridSizeAtom = atom<8 | 16 | 32 | 64 | 128>(32);
