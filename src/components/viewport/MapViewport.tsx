import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { ContextMenu } from "radix-ui";
import { Crosshair, Loader2 } from "lucide-react";
import {
  activeLayerAtom,
  brushSizeAtom,
  centerViewOnAtom,
  clipboardAtom,
  clipPartsAtom,
  clipPastingAtom,
  clipSelectionAtom,
  doodadPlacingAtom,
  fogModeAtom,
  fogViewPlayerAtom,
  gridSizeAtom,
  mapHeightAtom,
  mapTilesetAtom,
  mapWidthAtom,
  blendAnchorAtom,
  selectedDoodadsAtom,
  selectedLocationsAtom,
  selectedSpritesAtom,
  selectedUnitsAtom,
  spritePlacingAtom,
  symmetryAtom,
  terrainModeAtom,
  unitPlacingAtom,
  lockedLayersAtom,
  mapPointerHeldAtom,
  viewFlagsAtom,
  zoomAtom,
  type ViewFlags,
} from "../../atoms/editorAtoms";
import { animateUnitsSpeedAtom, animateWaterSpeedAtom, gridLookAtom, remasteredEffectsAtom } from "../../atoms/preferencesAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { activeDocumentIdAtom, doodadsRevisionAtom, locationsAtom, pinnedTilesAtom, scenarioAtom, startLocationsAtom, terrainRevisionAtom, viewOnlyAtom } from "../../atoms/documentAtoms";
import { useTileset } from "../../hooks/useTileset";
import { useMissingTerrain } from "../../hooks/useMissingTerrain";
import { paintsTiles, useTerrainTools, type MapPoint } from "../../hooks/useTerrainTools";
import { useFairness } from "../../hooks/useFairness";
import { mapPickAtom, mapViewStateAtom, mapToolAtom, pluginOverlaysAtom, shownMapViewAtom, viewFlashesAtom } from "../../atoms/pluginAtoms";
import type { PickedObject } from "../../plugins/api";
import PluginPanels from "../panels/PluginPanels";
import { useUnitTools } from "../../hooks/useUnitTools";
import { useDoodadTools } from "../../hooks/useDoodadTools";
import { useSpriteTools } from "../../hooks/useSpriteTools";
import { useFogTools } from "../../hooks/useFogTools";
import { useLocationTools } from "../../hooks/useLocationTools";
import { useClipboardTools } from "../../hooks/useClipboardTools";
import { useUnitAssets } from "../../hooks/useUnitAssets";
import { UnitAnimator } from "../../formats/units/animate";
import { TILESET_BY_ID } from "../../data/tilesets";
import { t, translate } from "../../i18n";
import type { Gesture, Tile } from "./gestures";
import { TILE } from "./paint/view";
import ViewportHud from "./ViewportHud";
import ViewportMenuItems, { type MenuTarget } from "./ViewportMenu";
import { useFrameLoop, useRepaints, useViewportSize } from "./useFrameLoop";
import { useViewMotion } from "./useViewMotion";
import { useEffectPass, useViewportDraw } from "./useViewportDraw";
import { useReleaseHold, useViewportPointer } from "./useViewportPointer";
import type { ViewportState } from "./viewportState";

/**
 * Entering a layer switches its overlay on; leaving switches it back off if the layer
 * was what turned it on. The View toggle stays in charge in between, so unticking it
 * hides the overlay even while editing.
 */
function useAutoShow(active: boolean, key: keyof ViewFlags, setFlags: (fn: (f: ViewFlags) => ViewFlags) => void) {
  const auto = useRef(false);
  useEffect(() => {
    if (active) {
      setFlags((f) => {
        if (f[key]) return f;
        auto.current = true;
        return { ...f, [key]: true };
      });
    } else if (auto.current) {
      auto.current = false;
      setFlags((f) => (f[key] ? { ...f, [key]: false } : f));
    }
  }, [active, key, setFlags]);
}

export default function MapViewport() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<Tile | null>(null);
  /** Pointer position in map pixels; the isometric brush needs finer than tile resolution. */
  const hoverPointRef = useRef<MapPoint | null>(null);
  /** The drag in progress, if any: one at a time, whichever layer or plugin it belongs to (see `gestures.ts`). */
  const gestureRef = useRef<Gesture | null>(null);
  /** Where the right-click that opened the context menu landed. */
  const [menuTarget, setMenuTarget] = useState<MenuTarget>({ tile: null, point: null });
  /** A plugin's `pickObject`: the unit or location under the pointer right now, outlined and named until the click. */
  const pickHoverRef = useRef<PickedObject | null>(null);
  // Remastered's water and lava: the WebGL pass that moves them, made when first wanted.
  const effectPass = useEffectPass();
  const size = useViewportSize(scrollerRef);

  const mapW = useAtomValue(mapWidthAtom);
  const mapH = useAtomValue(mapHeightAtom);
  const zoom = useAtomValue(zoomAtom);
  const store = useStore();
  const tileset = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const flags = useAtomValue(viewFlagsAtom);
  const waterSpeed = useAtomValue(animateWaterSpeedAtom);
  const effectTune = useAtomValue(remasteredEffectsAtom);
  const unitSpeed = useAtomValue(animateUnitsSpeedAtom);
  const gridSize = useAtomValue(gridSizeAtom);
  const gridLook = useAtomValue(gridLookAtom);
  const layer = useAtomValue(activeLayerAtom);
  const lockedLayers = useAtomValue(lockedLayersAtom);
  // A map open to look at only: presses select, and nothing that would change the map starts.
  const viewOnly = useAtomValue(viewOnlyAtom) !== null;
  const setPointerHeld = useSetAtom(mapPointerHeldAtom);
  useReleaseHold(setPointerHeld);
  const brush = useAtomValue(brushSizeAtom);
  const terrainMode = useAtomValue(terrainModeAtom);
  const symmetry = useAtomValue(symmetryAtom);
  const blendAnchor = useAtomValue(blendAnchorAtom);
  const tools = useTerrainTools();
  const unitTools = useUnitTools();
  const { loaded: unitAssets, error: unitError } = useUnitAssets();
  const selectedUnits = useAtomValue(selectedUnitsAtom);
  const placing = useAtomValue(unitPlacingAtom);
  const doodadTools = useDoodadTools();
  const doodadsRevision = useAtomValue(doodadsRevisionAtom);
  const selectedDoodads = useAtomValue(selectedDoodadsAtom);
  const placingDoodad = useAtomValue(doodadPlacingAtom);
  const spriteTools = useSpriteTools();
  const selectedSprites = useAtomValue(selectedSpritesAtom);
  const placingSprite = useAtomValue(spritePlacingAtom);
  const locationTools = useLocationTools();
  const selectedLocations = useAtomValue(selectedLocationsAtom);
  const clipTools = useClipboardTools();
  const clip = useAtomValue(clipboardAtom);
  const clipParts = useAtomValue(clipPartsAtom);
  const clipSelection = useAtomValue(clipSelectionAtom);
  const mapPick = useAtomValue(mapPickAtom);
  const mapTool = useAtomValue(mapToolAtom);
  // Plugin overlays (`api.ui.overlay`): drawn at their slot while visible, told the pointer, never given it.
  const overlays = useAtomValue(pluginOverlaysAtom);
  // `api.view.flash`: boxes fading over the map; an effect below keeps repainting while any live and sweeps them after.
  const flashes = useAtomValue(viewFlashesAtom);
  const pastingClip = useAtomValue(clipPastingAtom);
  const fogTools = useFogTools();
  const fogMode = useAtomValue(fogModeAtom);
  const fogViewPlayer = useAtomValue(fogViewPlayerAtom);
  const setFlags = useSetAtom(viewFlagsAtom);
  /** The iscript sprites for the placed units; lives as long as the unit tables do. */
  const animator = useMemo(() => (unitAssets ? new UnitAnimator(unitAssets) : null), [unitAssets]);
  const centerOn = useAtomValue(centerViewOnAtom);
  const open = useSetAtom(openDialogAtom);
  const scenario = useAtomValue(scenarioAtom);
  const terrainRevision = useAtomValue(terrainRevisionAtom);
  const pinned = useAtomValue(pinnedTilesAtom);
  /** Blend mode: a click picks the anchor cell; tiles are placed from the palette, never by stroke. */
  const blending = layer === "terrain" && scenario !== null && terrainMode === "blend";
  // (Never on a view-only map, so no brush outline promises a stroke that will not happen.)
  const painting = layer === "terrain" && scenario !== null && !blending && !viewOnly && (paintsTiles(terrainMode) || tools.isomReady);
  const unitsEditing = layer === "units" && scenario !== null;
  const unitPlacing = unitsEditing && placing;
  const doodadsEditing = layer === "doodads" && scenario !== null;
  const doodadPlacing = doodadsEditing && placingDoodad;
  const spritesEditing = layer === "sprites" && scenario !== null;
  const spritePlacing = spritesEditing && placingSprite;
  const fogPainting = layer === "fog" && scenario !== null && !viewOnly;
  const locationsEditing = layer === "locations" && scenario !== null;
  const clipEditing = layer === "clipboard" && scenario !== null;
  /** A plugin is waiting for a rectangle or a tile; the gesture goes to it ahead of every layer. */
  const picking = mapPick !== null && scenario !== null;
  /** A plugin's tool owns the pointer (a pick in progress still goes first). */
  const tooling = !picking && mapTool !== null && scenario !== null;
  /** The clip follows the pointer, a click stamps it. */
  const clipPasting = clipEditing && pastingClip && clip !== null;
  const showFog = scenario !== null && flags.fog;
  const locations = useAtomValue(locationsAtom);
  const mapStarts = useAtomValue(startLocationsAtom);
  const startLocations = useMemo(() => (scenario ? mapStarts : []), [scenario, mapStarts]);
  const { loaded: tilesetAssets, loading: tilesetLoading, error: tilesetError } = useTileset();
  // Terrain the data set in use has not got (a mod's map over the game's files): said once, as a toast.
  useMissingTerrain(tilesetAssets);
  // View ▸ Symmetry Differences: measured only while it is on.
  const fairness = useFairness(flags.asymmetry, tilesetAssets?.tileset ?? null);

  const tilePx = TILE * zoom;
  const worldW = mapW * tilePx;
  const worldH = mapH * tilePx;

  const state: ViewportState = {
    scrollerRef, canvasRef, topRef, leftRef, hoverRef, hoverPointRef, gestureRef, pickHoverRef, store,
    size, tileset, flags, gridSize, gridLook, brush, tilesetAssets, tilesetLoading, terrainRevision, doodadsRevision, pinned, fairness,
    locations, startLocations, blendAnchor, animator, showFog, fogViewPlayer, fogMode, clip, clipParts, clipSelection, symmetry, flashes,
    waterSpeed, effectTune, effectPass,
    scenario, mapW, mapH, zoom, tilePx, worldW, worldH, layer, lockedLayers, viewOnly, terrainMode, unitAssets,
    mapPick, mapTool, overlays, selectedUnits, selectedDoodads, selectedSprites, selectedLocations,
    picking, tooling, painting, blending, fogPainting, unitsEditing, placing, unitPlacing, doodadsEditing, placingDoodad, doodadPlacing,
    spritesEditing, placingSprite, spritePlacing, locationsEditing, clipEditing, clipPasting,
    tools, unitTools, doodadTools, spriteTools, locationTools, fogTools, clipTools,
  };

  // One paint: the passes of `paint/`, in painter's order.
  const { draw, inView } = useViewportDraw(state);

  /**
   * A plugin's view is shown in the map's place (`ui.mapView`): nothing of the map is seen, so
   * nothing is painted — a request waits in `drawPending` for the map to be shown again.
   */
  const covered = useAtomValue(shownMapViewAtom) !== null;
  /** The map offers other views: the switch between them sits in the area's top-left corner, over where the notices go. */
  const viewState = useAtomValue(mapViewStateAtom);
  const docId = useAtomValue(activeDocumentIdAtom) ?? -1;
  const switchShown = (viewState.offered.get(docId)?.length ?? 0) > 0;
  // Every repaint request goes through one animation frame; while a flash is live, every frame.
  const loop = useFrameLoop(draw, covered, flashes);
  const { scheduleDraw } = loop;

  /* ── the fog and locations layers show their overlays ── */
  useAutoShow(layer === "fog", "fog", setFlags);
  useAutoShow(layer === "locations", "locations", setFlags);
  useAutoShow(layer === "units", "units", setFlags);
  useAutoShow(layer === "sprites", "sprites", setFlags);
  useAutoShow(layer === "doodads", "doodads", setFlags);
  // The Locations layer sets its own pointer cursor (move / resize); drop it on leaving.
  useEffect(() => {
    if (layer !== "locations" && surfaceRef.current) surfaceRef.current.style.cursor = "";
  }, [layer]);

  // A new `draw` or size, a repaint-only atom, the water / lava / unit animation: each books a paint.
  const tilePxRef = useRepaints({
    canvasRef, scrollerRef, size, draw, store, loop, inView, tilePx, flags, tilesetAssets, scenario, animator, waterSpeed, unitSpeed,
  });

  // The view moving by itself: a glide to a point, the zoom's anchor, the wheel.
  const { glideRef, panRef } = useViewMotion({ scrollerRef, tilePxRef, centerOn, draw, scheduleDraw, zoom, store });

  const { onDown, onMove, onUp, onLeave, onContextMenu, onDoubleClick } = useViewportPointer(state, { scheduleDraw, glideRef, panRef, setMenuTarget, open });

  const menuTools = useMemo(
    () => ({ terrain: tools, units: unitTools, doodads: doodadTools, sprites: spriteTools, locations: locationTools, fog: fogTools, clip: clipTools }),
    [tools, unitTools, doodadTools, spriteTools, locationTools, fogTools, clipTools],
  );

  return (
    <div className="viewport">
      <div className="ruler-corner"><Crosshair size={11} /></div>
      <div className="ruler top"><canvas ref={topRef} /></div>
      <div className="ruler left"><canvas ref={leftRef} /></div>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div ref={scrollerRef} className="scroller" onScroll={scheduleDraw} tabIndex={0}>
            <div
              ref={surfaceRef}
              className={`map-surface ${painting || fogPainting ? "painting" : ""} ${unitPlacing || doodadPlacing || spritePlacing || clipPasting ? "placing" : ""}`}
              style={{ width: worldW, height: worldH, cursor: tooling ? mapTool?.spec.cursor ?? "crosshair" : undefined }}
              onPointerDown={(e) => { setPointerHeld(true); onDown(e); }}
              onPointerMove={onMove}
              onPointerUp={(e) => { onUp(e); setPointerHeld(false); }}
              onPointerCancel={(e) => { onUp(e); setPointerHeld(false); }}
              onLostPointerCapture={() => setPointerHeld(false)}
              onPointerLeave={onLeave}
              onContextMenu={onContextMenu}
              onDoubleClick={onDoubleClick}
            >
              <canvas ref={canvasRef} style={{ position: "sticky", top: 0, left: 0 }} />
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="menu-content">
            <ViewportMenuItems target={menuTarget} tools={menuTools} painting={painting} fogPainting={fogPainting} locationsEditing={locationsEditing} />
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {/* The map's own notices: not over another view shown in its place, and below the switch to it. */}
      {scenario && tilesetLoading && !covered && (
        <div className="viewport-loading" role="status" aria-live="polite">
          <Loader2 size={16} className="spin" aria-hidden />
          <span>{t("Loading {name} terrain…", { name: translate(tileset.name) })}</span>
        </div>
      )}
      {!covered && <div className={`viewport-notices${switchShown ? " below-switch" : ""}`}>
      {unitError && (layer === "units" || layer === "sprites") && scenario && (
        <div className="viewport-notice" role="status">
          <span><strong>{t("No unit graphics.")}</strong> {" "}{t("Units are drawn as player-coloured markers until the editor has the game's unit files.")}</span>
          <button type="button" className="btn sm" onClick={() => open("gameData")}>{t("Set up game data…")}</button>
        </div>
      )}
      {tilesetError && (
        <div className="viewport-notice" role="status">
          <span><strong>{t("No tileset graphics.")}</strong> {" "}{t("Terrain is drawn as flat colour until the editor has the game's tileset files.")}</span>
          <button type="button" className="btn sm" onClick={() => open("gameData")}>{t("Set up game data…")}</button>
        </div>
      )}
      </div>}
      <PluginPanels />
      <ViewportHud
        tilesetName={translate(tileset.name)}
        tilesetLoading={tilesetLoading}
        unitAssets={unitAssets}
        doodadTools={doodadTools}
        mode={{ picking, tooling, unitPlacing, spritePlacing, doodadPlacing, locationsEditing, clipEditing, clipPasting, showFog, fogPainting }}
      />
    </div>
  );
}
