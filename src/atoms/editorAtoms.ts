import { atom } from "jotai";
import type { MapFileHandle } from "../services/mapIo";
import type { MemberInfo } from "../formats/mpq/scm";
import type { SaveOptions } from "../editor/save";
import type { TilesetId } from "../data/tilesets";
import type { MapVersion } from "../formats/chk/scenario";
import { DEFAULT_PLACEMENT, type PlacementOptions } from "../editor/placement";
import { DEFAULT_DOODAD_PLACEMENT, type DoodadPlacementOptions } from "../editor/doodads";
import type { FogMode } from "../editor/fog";
import type { SpriteKind } from "../editor/sprites";
import type { SymmetryMode } from "../editor/symmetry";
import type { EditorLayer, TerrainMode, ViewFlags } from "../editor/view";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { browserStorage, mergedStorage } from "./storage";
import { DEFAULT_CLIP_PARTS, type Clip, type ClipParts, type PasteMode } from "../editor/clipboard";
import type { Rect } from "../editor/terrain";

/* ── Screens ────────────────────────────────────────────── */

export type EditorScreen = "splash" | "editor";
export const screenAtom = atom<EditorScreen>("splash");

/* ── Layers (classic SCMDraft layer combo) ──────────────── */

export type { EditorLayer, TerrainMode, ViewFlags } from "../editor/view";

export const activeLayerAtom = atom<EditorLayer>("terrain");

/** Terrain sub-mode inside the Terrain palette. */
export const TERRAIN_MODES: readonly TerrainMode[] = ["isom", "rect", "tile", "blend"];
export const terrainModeAtom = atom<TerrainMode>("isom");

export const brushSizeAtom = atom<number>(1);
/** ISOM terrain id the Isometric and Rect brushes paint. See data/tilesets.ts. */
export const activeTerrainAtom = atom<number>(2);
/** Variation slot the Rect brush uses for every pair, or -1 for StarEdit's random pick. */
export const rectVariationAtom = atom<number>(-1);
/** Raw MTXM tile id the Tile brush paints. */
export const activeTileAtom = atom<number>(0x20);
/** Map cell the Blend brush is matching against (see editor/blend.ts), or null before one is picked. */
export const blendAnchorAtom = atom<{ x: number; y: number } | null>(null);
/** Whether placing a blend candidate moves the anchor onto the tile it just placed. */
export const blendFollowAtom = atom<boolean>(true);
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
/** The Units layer's placement checks (see editor/placement.ts), remembered (`scmjs.placement`). */
export const placementOptionsAtom = atomWithStorage<PlacementOptions>("scmjs.placement", DEFAULT_PLACEMENT, mergedStorage(DEFAULT_PLACEMENT), { getOnInit: true });

/* ── Doodads layer (see editor/doodads.ts) ──────────────── */

/** dddata index of the doodad the palette has picked, or -1 before anything was picked. */
export const activeDoodadAtom = atom<number>(-1);
/** Palette category the doodad grid shows; "" = the tileset's first. */
export const doodadCategoryAtom = atom<string>("");
/** Whether a click on the map places `activeDoodadAtom` (armed by the palette, disarmed by Esc / right-click). */
export const doodadPlacingAtom = atom<boolean>(false);
/** Indices into `scenario.doodads` of the selected doodads; cleared whenever the list is edited under it. */
export const selectedDoodadsAtom = atom<number[]>([]);
/** "Place anywhere" (off) and "Snap to grid" (on) — StarEdit's defaults, remembered (`scmjs.doodadPlacement`). */
export const doodadPlacementAtom = atomWithStorage<DoodadPlacementOptions>("scmjs.doodadPlacement", DEFAULT_DOODAD_PLACEMENT, mergedStorage(DEFAULT_DOODAD_PLACEMENT), { getOnInit: true });

/* ── Sprites layer (see editor/sprites.ts) ──────────────── */

/** Whether the palette places a pure sprite (sprites.dat id) or a unit sprite (units.dat id). */
export const activeSpriteKindAtom = atom<SpriteKind>("pure");
/** sprites.dat id the Sprites layer places when the kind is "pure". */
export const activeSpriteAtom = atom<number>(0);
/** units.dat id it places when the kind is "unit"; doors and traps are what StarEdit uses this for. */
export const activeUnitSpriteAtom = atom<number>(0);
/** Whether a click on the map places the active sprite (armed by the palette, disarmed by Esc / right-click). */
export const spritePlacingAtom = atom<boolean>(false);
/** Indices into `scenario.sprites` of the selected sprites; cleared whenever the list is edited under it. */
export const selectedSpritesAtom = atom<number[]>([]);
/** Flags given to newly placed sprites: mirrored graphic, and (unit sprites only) starting disabled. */
export const spritePlaceOptionsAtom = atom<{ flipped: boolean; disabled: boolean }>({ flipped: false, disabled: false });

/* ── Locations layer (see editor/locations.ts) ──────────── */

/**
 * MRGN slot indices of the selected locations. Slots never shift, so a selection survives
 * every edit; it is only pruned when a slot it names stops being in use. Anywhere (slot
 * 63) can be selected from the list to read it, but never picked up on the map.
 */
export const selectedLocationsAtom = atom<number[]>([]);
/** Pixel grid a create, move or resize snaps to; 0 = off. StarEdit works in whole tiles. */
/** The Locations layer's snap step in pixels (0 = off), remembered (`scmjs.locationSnap`). */
export const locationSnapAtom = atomWithStorage<number>("scmjs.locationSnap", 32, createJSONStorage(browserStorage), { getOnInit: true });
export const LOCATION_SNAPS: readonly number[] = [0, 8, 16, 32, 64];

/* ── Fog of war layer (see editor/fog.ts) ───────────────── */

/** Bit mask of the players (bit n = player n+1) the fog brush paints for. */
export const fogPlayersAtom = atom<number>(0x01);
/** Whether the brush lays fog (unexplored) or clears it (explored). */
export const fogModeAtom = atom<FogMode>("fog");
/** Whose fog the viewport and minimap draw, 0–7 (shown while `viewFlags.fog` is on). */
export const fogViewPlayerAtom = atom<number>(0);

/* ── Cut / Copy / Paste layer (see editor/clipboard.ts) ──── */

/** What the last Cut / Copy captured; survives the map it came from being closed. */
export const clipboardAtom = atom<Clip | null>(null);
/** The tile rectangle marked on the clipboard layer (exclusive x1 / y1), or null. */
export const clipSelectionAtom = atom<Rect | null>(null);
/** Which parts a copy captures and a paste writes. */
export const clipPartsAtom = atom<ClipParts>(DEFAULT_CLIP_PARTS);
/** Whether a paste adds to the target area or clears its units, sprites and doodads first. */
export const clipPasteModeAtom = atom<PasteMode>("merge");
/** Whether the clip follows the pointer waiting for a click to stamp it (Esc / right-click stops). */
export const clipPastingAtom = atom<boolean>(false);

/* ── Map document mirrors: what the chrome displays (see CLAUDE.md, "two sources of truth") ── */

export const mapNameAtom = atom<string>("Untitled Scenario");
export const mapDescriptionAtom = atom<string>("Destroy all enemy buildings.");
export const mapTilesetAtom = atom<TilesetId>("badlands");
export const mapWidthAtom = atom<number>(128);
export const mapHeightAtom = atom<number>(128);
export const mapModifiedAtom = atom<boolean>(false);
export const mapFilePathAtom = atom<string | null>(null);
/**
 * The file the open map can be written straight back to — a File System Access handle from
 * the open picker, a drop or the save picker — or null when the browser handed over bytes
 * only, in which case Save has to ask where (or download).
 */
export const mapFileHandleAtom = atom<MapFileHandle | null>(null);
/** How the scenario was stored in the archive it was opened from; null for a new map or a bare .chk. */
export const mapOriginAtom = atom<MemberInfo | null>(null);
/** The Save options last confirmed for this document (Save As); null until then, so Save uses the defaults. */
export const saveOptionsAtom = atom<SaveOptions | null>(null);
export const mapVersionAtom = atom<MapVersion>("broodwar");

/* ── Viewport ───────────────────────────────────────────── */

export const zoomAtom = atom<number>(1);
export const cursorTileAtom = atom<{ x: number; y: number }>({ x: 0, y: 0 });
export const viewportRectAtom = atom<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 1, h: 1 });

/**
 * One-shot request to centre the main viewport on a tile — set by the minimap,
 * consumed (and cleared) by MapViewport.
 */
export const centerViewOnAtom = atom<{ x: number; y: number } | null>(null);

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

/** View ▸ Grid Settings' spacing, remembered like the grid's look (`scmjs.gridSize`). */
export const gridSizeAtom = atomWithStorage<8 | 16 | 32 | 64 | 128>("scmjs.gridSize", 32, createJSONStorage(browserStorage), { getOnInit: true });

/**
 * A layer the Layers panel has locked: its tools refuse to change the map (placing,
 * painting, dragging, deleting) until it is unlocked, while selecting and looking are
 * still fine. Session state, like the active layer.
 */
export const lockedLayersAtom = atom<Partial<Record<EditorLayer, boolean>>>({});

/** Bumped by `api.ui.repaint()`: the viewport redraws without any revision (and so any plugin event) moving. */
export const viewportRepaintAtom = atom(0);

/** The pointer's position in map pixels, for the status bar; the tile is `cursorTileAtom`. */
export const cursorPixelAtom = atom<{ x: number; y: number }>({ x: 0, y: 0 });

/**
 * View ▸ Zoom to Fit: the largest zoom step at which the whole map fits the viewport.
 * `viewportRectAtom` is in tiles at the current zoom, so the viewport's pixel size is
 * `w * zoom * 32`.
 */
export const zoomToFitAtom = atom(null, (get, set) => {
  const v = get(viewportRectAtom);
  const zoom = get(zoomAtom);
  const pxW = v.w * zoom * 32, pxH = v.h * zoom * 32;
  const need = Math.min(pxW / (get(mapWidthAtom) * 32), pxH / (get(mapHeightAtom) * 32));
  const fit = [...ZOOM_STEPS].reverse().find((z) => z <= need) ?? ZOOM_STEPS[0];
  set(zoomAtom, fit);
  return fit;
});

/** The zoom control's steps; `zoomToFitAtom` snaps to one of these. */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/* ── Symmetry (see editor/symmetry.ts) ───────────────────── */

/**
 * The mirror mode the Rect, Tile and Fog brushes paint under (Tools ▸ Symmetry…). The
 * isometric and Blend brushes ignore it. A square-only mode on a map that is not square
 * behaves as "none".
 */
export const symmetryAtom = atom<SymmetryMode>("none");
