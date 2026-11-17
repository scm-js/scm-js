import type { RefObject } from "react";
import type { ExtractAtomValue, useStore } from "jotai";
import type {
  activeLayerAtom, blendAnchorAtom, clipboardAtom, clipPartsAtom, clipSelectionAtom, fogModeAtom, gridSizeAtom, symmetryAtom, ViewFlags,
  lockedLayersAtom, selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom, terrainModeAtom,
} from "../../atoms/editorAtoms";
import type { gridLookAtom, remasteredEffectsAtom } from "../../atoms/preferencesAtoms";
import type { locationsAtom, pinnedTilesAtom, scenarioAtom, startLocationsAtom } from "../../atoms/documentAtoms";
import type { mapPickAtom, mapToolAtom, pluginOverlaysAtom, viewFlashesAtom } from "../../atoms/pluginAtoms";
import type { TilesetInfo } from "../../data/tilesets";
import type { UnitAnimator } from "../../formats/units/animate";
import type { TilesetState } from "../../hooks/useTileset";
import type { Fairness } from "../../hooks/useFairness";
import type { EffectPass } from "./effectPass";
import type { PickedObject } from "../../plugins/api";
import type { MapPoint, useTerrainTools } from "../../hooks/useTerrainTools";
import type { useUnitTools } from "../../hooks/useUnitTools";
import type { useDoodadTools } from "../../hooks/useDoodadTools";
import type { useSpriteTools } from "../../hooks/useSpriteTools";
import type { useLocationTools } from "../../hooks/useLocationTools";
import type { useFogTools } from "../../hooks/useFogTools";
import type { useClipboardTools } from "../../hooks/useClipboardTools";
import type { UnitAssetsState } from "../../hooks/useUnitAssets";
import type { Gesture, Tile } from "./gestures";

type Of<A> = ExtractAtomValue<A>;

/**
 * What `MapViewport` gathers in a render and its hooks read: the refs more than one of them
 * shares, the atoms' values, the tools, and what the active layer is doing. Built afresh
 * each render and never a dependency itself — a hook takes the fields it needs apart.
 */
export interface ViewportState {
  scrollerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The rulers' canvases. */
  topRef: RefObject<HTMLCanvasElement | null>;
  leftRef: RefObject<HTMLCanvasElement | null>;
  /** The tile under the pointer, null off the map. */
  hoverRef: RefObject<Tile | null>;
  /** Pointer position in map pixels; the isometric brush needs finer than tile resolution. */
  hoverPointRef: RefObject<MapPoint | null>;
  /** The drag in progress, if any: one at a time, whichever layer or plugin it belongs to (see `gestures.ts`). */
  gestureRef: RefObject<Gesture | null>;
  /** A plugin's `pickObject`: the unit or location under the pointer right now, outlined and named until the click. */
  pickHoverRef: RefObject<PickedObject | null>;
  store: ReturnType<typeof useStore>;

  /** The scroller's size in CSS pixels (`useViewportSize`). */
  size: { w: number; h: number };
  tileset: TilesetInfo;
  flags: ViewFlags;
  gridSize: Of<typeof gridSizeAtom>;
  gridLook: Of<typeof gridLookAtom>;
  brush: number;
  tilesetAssets: TilesetState["loaded"];
  tilesetLoading: boolean;
  terrainRevision: number;
  doodadsRevision: number;
  pinned: Of<typeof pinnedTilesAtom>;
  fairness: Fairness | null;
  locations: Of<typeof locationsAtom>;
  startLocations: Of<typeof startLocationsAtom>;
  blendAnchor: Of<typeof blendAnchorAtom>;
  /** The iscript sprites for the placed units; lives as long as the unit tables do. */
  animator: UnitAnimator | null;
  showFog: boolean;
  fogViewPlayer: number;
  fogMode: Of<typeof fogModeAtom>;
  clip: Of<typeof clipboardAtom>;
  clipParts: Of<typeof clipPartsAtom>;
  clipSelection: Of<typeof clipSelectionAtom>;
  symmetry: Of<typeof symmetryAtom>;
  flashes: Of<typeof viewFlashesAtom>;
  waterSpeed: number;
  effectTune: Of<typeof remasteredEffectsAtom>;
  /** Remastered's water and lava pass (`useEffectPass`). */
  effectPass: () => EffectPass | null;

  scenario: Of<typeof scenarioAtom>;
  mapW: number;
  mapH: number;
  zoom: number;
  tilePx: number;
  worldW: number;
  worldH: number;
  layer: Of<typeof activeLayerAtom>;
  lockedLayers: Of<typeof lockedLayersAtom>;
  viewOnly: boolean;
  terrainMode: Of<typeof terrainModeAtom>;
  unitAssets: UnitAssetsState["loaded"];
  mapPick: Of<typeof mapPickAtom>;
  mapTool: Of<typeof mapToolAtom>;
  overlays: Of<typeof pluginOverlaysAtom>;
  selectedUnits: Of<typeof selectedUnitsAtom>;
  selectedDoodads: Of<typeof selectedDoodadsAtom>;
  selectedSprites: Of<typeof selectedSpritesAtom>;
  selectedLocations: Of<typeof selectedLocationsAtom>;

  // What the active layer is doing (see `MapViewport`).
  picking: boolean;
  tooling: boolean;
  painting: boolean;
  blending: boolean;
  fogPainting: boolean;
  unitsEditing: boolean;
  placing: boolean;
  unitPlacing: boolean;
  doodadsEditing: boolean;
  placingDoodad: boolean;
  doodadPlacing: boolean;
  spritesEditing: boolean;
  placingSprite: boolean;
  spritePlacing: boolean;
  locationsEditing: boolean;
  clipEditing: boolean;
  clipPasting: boolean;

  // The tools, one object each: they hold drag state in refs and must not be instantiated twice.
  tools: ReturnType<typeof useTerrainTools>;
  unitTools: ReturnType<typeof useUnitTools>;
  doodadTools: ReturnType<typeof useDoodadTools>;
  spriteTools: ReturnType<typeof useSpriteTools>;
  locationTools: ReturnType<typeof useLocationTools>;
  fogTools: ReturnType<typeof useFogTools>;
  clipTools: ReturnType<typeof useClipboardTools>;
}
