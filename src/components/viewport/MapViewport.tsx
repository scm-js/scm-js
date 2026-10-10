import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom, useStore, type Atom } from "jotai";
import { ContextMenu } from "radix-ui";
import { Crosshair, Loader2 } from "lucide-react";
import {
  activeDoodadAtom,
  activeLayerAtom,
  activeSpriteAtom,
  activeSpriteKindAtom,
  activeTerrainAtom,
  activeTileAtom,
  activeUnitAtom,
  activeUnitSpriteAtom,
  brushSizeAtom,
  centerViewOnAtom,
  clipboardAtom,
  clipPartsAtom,
  clipPastingAtom,
  clipSelectionAtom,
  cursorTileAtom,
  doodadPlacementAtom,
  doodadPlacingAtom,
  fogModeAtom,
  fogPlayersAtom,
  fogViewPlayerAtom,
  gridSizeAtom,
  locationSnapAtom,
  mapHeightAtom,
  mapTilesetAtom,
  mapWidthAtom,
  rectVariationAtom,
  blendAnchorAtom,
  selectedDoodadsAtom,
  selectedLocationsAtom,
  selectedSpritesAtom,
  selectedUnitsAtom,
  spritePlaceOptionsAtom,
  spritePlacingAtom,
  symmetryAtom,
  terrainModeAtom,
  unitOwnerAtom,
  unitPlacingAtom,
  lockedLayersAtom,
  cursorPixelAtom,
  mapPointerHeldAtom,
  viewportRepaintAtom,
  viewFlagsAtom,
  viewportRectAtom,
  zoomAtom,
  ZOOM_STEPS,
  type ViewFlags,
} from "../../atoms/editorAtoms";
import { animateUnitsSpeedAtom, animateWaterSpeedAtom, gridLookAtom, preferencesAtom, remasteredEffectsAtom } from "../../atoms/preferencesAtoms";
import { openDialogAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import { doodadsRevisionAtom, locationsAtom, scenarioAtom, startLocationsAtom, terrainRevisionAtom, unitsRevisionAtom } from "../../atoms/documentAtoms";
import { useTileset } from "../../hooks/useTileset";
import { paintsTiles, useTerrainTools, type MapPoint } from "../../hooks/useTerrainTools";
import { cancelMapPickAtom, cancelMapToolAtom, mapPickAtom, mapToolAtom, mapToolRevisionAtom, pluginOverlayRevisionAtom, pluginOverlaysAtom, viewFlashesAtom, type PluginOverlayEntry } from "../../atoms/pluginAtoms";
import type { MapPointer, MapView, OverlayAbove, PickedObject } from "../../plugins/api";
import PluginPanels from "../panels/PluginPanels";
import { useUnitTools } from "../../hooks/useUnitTools";
import { useDoodadTools } from "../../hooks/useDoodadTools";
import { useSpriteTools } from "../../hooks/useSpriteTools";
import { useFogTools } from "../../hooks/useFogTools";
import { useLocationTools } from "../../hooks/useLocationTools";
import { useClipboardTools } from "../../hooks/useClipboardTools";
import { tileRect } from "../../editor/clipboard";
import { boundsOf, HANDLE_CURSOR, locationAt } from "../../editor/locations";
import { drawFogLayer, type FogLayer } from "./fog";
import { useUnitAssets } from "../../hooks/useUnitAssets";
import { onGrpLoaded } from "../../formats/units/load";
import { UnitAnimator } from "../../formats/units/animate";
import { ANYWHERE_INDEX } from "../../formats/chk/sections/objects";
import { tilesetIndex } from "../../formats/chk/scenario";
import { unitAt, unitBox, unitGeometry } from "../../editor/units";
import { unitLabel } from "../../data/units";
import { symmetryAvailable, symmetryAxes } from "../../editor/symmetry";
import { diamondAt } from "../../editor/isom";
import { inMap as inMapBounds } from "../../editor/blend";
import { setAtlasStep } from "../../formats/tileset/atlas";
import { cycleStepAt, GAME_FRAME_MS } from "../../formats/tileset/cycle";
import { LAYERS } from "../chrome/MenuBar";
import { TILESET_BY_ID } from "../../data/tilesets";
import { t, translate } from "../../i18n";
import {
  beginAreaGesture, beginLocationGesture, beginObjectGesture, beginStrokeGesture, objectGestureOn,
  type Gesture, type ObjectLayer, type PointerSample, type Tile,
} from "./gestures";
import { drawBlendAnchor, drawBrushSquare, drawClipGhost, drawDoodadGhost, drawIsomDiamonds, drawSpriteGhosts, drawTileGhost, drawUnitGhosts } from "./paint/ghosts";
import { drawGrid, drawRuler, drawSymmetryAxes } from "./paint/grid";
import { EffectPass } from "./effectPass";
import { paintFlatGround, paintGround, paintLoadingPlate, type GroundLayer } from "./paint/ground";
import { drawLocationHandles, drawLocations, drawStartLocations } from "./paint/locations";
import { drawObjects, spritePainter, UNIT_MARGIN } from "./paint/objects";
import { DASH, draggedBox, drawFlashes, drawMarquee, drawPickedObject, INK, markedTiles, sizeChip, strokeBox, strokeTileRect, TILE, type PaintView } from "./paint/view";
import ViewportHud from "./ViewportHud";
import ViewportMenuItems, { type MenuTarget } from "./ViewportMenu";

/** The least time between two frames of Remastered's water or lava. */
const EFFECT_FRAME_MS = 1000 / 30;

/**
 * A drag that reaches the edge of the window scrolls the view under it: `EDGE_BAND` px
 * inside the scroller is the band where the pan starts, the speed ramps to `PAN_MAX` px/s
 * as the pointer pushes past it (a capture keeps the events coming well outside the
 * window, where it just runs at full speed). Screen pixels, not tiles, so the view moves
 * at the same rate however far out the map is zoomed.
 */
const EDGE_BAND = 28;
const PAN_MIN = 120;
const PAN_MAX = 1200;

/**
 * What the move path needs of a pointer event. A React `PointerEvent` satisfies it, and so
 * does the snapshot the auto-pan keeps, which is how a tick replays the last move against
 * a scroll position the pointer itself never moved through.
 */
interface MoveEvent {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  buttons: number;
  currentTarget: HTMLDivElement;
}

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

const fmtTiles = (px: number) => (Number.isInteger(px / TILE) ? String(px / TILE) : (px / TILE).toFixed(2));

/**
 * What `draw` reaches without closing over it — a revision of something mutated in place, a
 * palette choice the tools read from the store when asked for a ghost. A change to any of
 * them is a repaint and nothing else, so the viewport listens on the store instead of
 * rendering for it.
 */
const REPAINT_ATOMS: readonly Atom<unknown>[] = [
  activeTileAtom, activeTerrainAtom, rectVariationAtom,
  unitsRevisionAtom, activeUnitAtom, unitOwnerAtom,
  activeDoodadAtom, doodadPlacementAtom,
  activeSpriteKindAtom, activeSpriteAtom, activeUnitSpriteAtom, spritePlaceOptionsAtom,
  locationSnapAtom, fogPlayersAtom,
  mapToolRevisionAtom, pluginOverlayRevisionAtom, viewportRepaintAtom,
];

export default function MapViewport() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<Tile | null>(null);
  /** Pointer position in map pixels; the isometric brush needs finer than tile resolution. */
  const hoverPointRef = useRef<MapPoint | null>(null);
  /** Diamond under the pointer at the last redraw, so the isometric outline follows the pointer within a tile. */
  const hoverDiamondRef = useRef("");
  /** The drag in progress, if any: one at a time, whichever layer or plugin it belongs to (see `gestures.ts`). */
  const gestureRef = useRef<Gesture | null>(null);
  /** Where the right-click that opened the context menu landed. */
  const [menuTarget, setMenuTarget] = useState<MenuTarget>({ tile: null, point: null });
  /** A plugin's `pickObject`: the unit or location under the pointer right now, outlined and named until the click. */
  const pickHoverRef = useRef<PickedObject | null>(null);
  /** The last pointer move, kept so an auto-pan frame can replay it after it scrolls. */
  const lastMoveRef = useRef<MoveEvent | null>(null);
  /** The auto-pan in progress: its speed in px/s and the sub-pixel remainder each axis carries. */
  const panRef = useRef<{ raf: number; vx: number; vy: number; dx: number; dy: number; last: number } | null>(null);
  /** A middle-button drag panning the view: where the pointer was at the last move. */
  const panDragRef = useRef<{ x: number; y: number } | null>(null);
  /** Whether the last paint blitted any cycling (water/lava) megatile, so the animation loop knows when a repaint shows anything. */
  const animatedInViewRef = useRef(false);
  /** Whether the last paint ran Remastered's water or lava over the terrain, so the loop keeps it moving. */
  const movingInViewRef = useRef(false);
  /**
   * The pass that moves them, made the first time it is wanted. A context the browser
   * took back is replaced once or twice and then given up on — still water from there on.
   */
  const effectPassRef = useRef<{ pass: EffectPass | null; tries: number }>({ pass: null, tries: 0 });
  const effectPass = useCallback((): EffectPass | null => {
    const held = effectPassRef.current;
    if (held.pass?.dead) {
      held.pass.dispose();
      held.pass = null;
    }
    if (!held.pass && held.tries < 3) {
      held.tries++;
      held.pass = EffectPass.create();
    }
    return held.pass;
  }, []);
  useEffect(() => () => { effectPassRef.current.pass?.dispose(); effectPassRef.current.pass = null; }, []);
  /** The ground and the fog, cached between paints; see `paint/ground.ts` and `fog.ts`. */
  const groundLayerRef = useRef<GroundLayer | null>(null);
  const fogLayerRef = useRef<FogLayer | null>(null);
  /** Whether the last paint drew any unit, so the unit animation loop can skip repaints of empty views. */
  const unitsInViewRef = useRef(false);
  const lastViewportRect = useRef({ x: -1, y: -1, w: -1, h: -1 });
  /** What each ruler was last drawn for, so a paint that moves neither leaves them alone. */
  const rulerKeysRef = useRef({ top: "", left: "" });
  const [size, setSize] = useState({ w: 0, h: 0 });

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
  const setStatus = useSetAtom(statusMessageAtom);
  const setCursorPixel = useSetAtom(cursorPixelAtom);
  const setPointerHeld = useSetAtom(mapPointerHeldAtom);
  // A release the surface never sees (over a context menu, outside the window, a lost
  // focus) must still end the hold, or a shared map would wait for the next click. The
  // bubble phase, so the surface's own handler has committed the stroke first.
  useEffect(() => {
    const release = () => setPointerHeld(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("blur", release);
    };
  }, [setPointerHeld]);
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
  const setClipSelection = useSetAtom(clipSelectionAtom);
  const mapPick = useAtomValue(mapPickAtom);
  const cancelPick = useSetAtom(cancelMapPickAtom);
  const mapTool = useAtomValue(mapToolAtom);
  const cancelTool = useSetAtom(cancelMapToolAtom);
  // Plugin overlays (`api.ui.overlay`): drawn at their slot while visible, told the pointer, never given it.
  const overlays = useAtomValue(pluginOverlaysAtom);
  // `api.view.flash`: boxes fading over the map; an effect below keeps repainting while any live and sweeps them after.
  const flashes = useAtomValue(viewFlashesAtom);
  const setFlashes = useSetAtom(viewFlashesAtom);
  const pastingClip = useAtomValue(clipPastingAtom);
  const fogTools = useFogTools();
  const fogMode = useAtomValue(fogModeAtom);
  const fogViewPlayer = useAtomValue(fogViewPlayerAtom);
  const setFlags = useSetAtom(viewFlagsAtom);
  /** The iscript sprites for the placed units; lives as long as the unit tables do. */
  const animator = useMemo(() => (unitAssets ? new UnitAnimator(unitAssets) : null), [unitAssets]);
  const setCursor = useSetAtom(cursorTileAtom);
  const setViewportRect = useSetAtom(viewportRectAtom);
  const centerOn = useAtomValue(centerViewOnAtom);
  const clearCenterOn = useSetAtom(centerViewOnAtom);
  const open = useSetAtom(openDialogAtom);
  const scenario = useAtomValue(scenarioAtom);
  const terrainRevision = useAtomValue(terrainRevisionAtom);
  /** Blend mode: a click picks the anchor cell; tiles are placed from the palette, never by stroke. */
  const blending = layer === "terrain" && scenario !== null && terrainMode === "blend";
  const painting = layer === "terrain" && scenario !== null && !blending && (paintsTiles(terrainMode) || tools.isomReady);
  const unitsEditing = layer === "units" && scenario !== null;
  const unitPlacing = unitsEditing && placing;
  const doodadsEditing = layer === "doodads" && scenario !== null;
  const doodadPlacing = doodadsEditing && placingDoodad;
  const spritesEditing = layer === "sprites" && scenario !== null;
  const spritePlacing = spritesEditing && placingSprite;
  const fogPainting = layer === "fog" && scenario !== null;
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

  const tilePx = TILE * zoom;
  const worldW = mapW * tilePx;
  const worldH = mapH * tilePx;

  /* ── drawing ─────────────────────────────────────────── */
  /**
   * One paint: the passes of `paint/`, in painter's order. What each pass draws is its own
   * business; what is here is which of them the state calls for, and in what order.
   */
  const draw = useCallback(() => {
    const scroller = scrollerRef.current;
    const canvas = canvasRef.current;
    if (!scroller || !canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const sx = scroller.scrollLeft;
    const sy = scroller.scrollTop;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, 0, size.w, size.h);

    const x0 = Math.max(0, Math.floor(sx / tilePx));
    const y0 = Math.max(0, Math.floor(sy / tilePx));
    const x1 = Math.min(mapW, Math.ceil((sx + size.w) / tilePx));
    const y1 = Math.min(mapH, Math.ceil((sy + size.h) / tilePx));

    // The chrome's fonts, read from the tokens once per paint at most: a style read per
    // label adds up over a few hundred locations.
    let uiFontName: string | undefined, monoFontName: string | undefined;
    const v: PaintView = {
      ctx, zoom, tilePx, sx, sy, w: size.w, h: size.h, dpr, x0, y0, x1, y1, mapW, mapH, worldW, worldH,
      uiFont: () => (uiFontName ??= getComputedStyle(document.body).getPropertyValue("--font-ui")),
      monoFont: () => (monoFontName ??= getComputedStyle(document.body).getPropertyValue("--font-mono")),
    };
    /** Map pixels to canvas pixels, for plugin overlays and a plugin's map tool. */
    const view: MapView = {
      zoom,
      tilePx,
      x: (px: number) => px * zoom - sx,
      y: (py: number) => py * zoom - sy,
      visible: { x0, y0, x1, y1 },
    };
    /** The visible plugin overlays registered for `above`, in registration order, each in a clean context. */
    const drawOverlays = (above: OverlayAbove) => {
      if (!scenario) return;
      for (const o of overlays) {
        if (!o.visible || (o.spec.above ?? "terrain") !== above) continue;
        ctx.save();
        try { o.spec.draw(ctx, view); } catch (err) { console.error(`[${o.plugin.name}] overlay draw failed`, err); }
        ctx.restore();
      }
    };
    const gesture = gestureRef.current;
    const hoverPoint = hoverPointRef.current;

    // The ground — with View ▸ Doodads off, what the doodads stand on (TILE) instead of the picture (MTXM).
    const tiles = scenario ? (flags.doodads ? scenario.tiles : scenario.editorTiles) : undefined;
    let animatedInView = false;
    let movingInView = false;
    if (tiles && tilesetAssets) {
      ({ animated: animatedInView, moving: movingInView } = paintGround(v, groundLayerRef, {
        scenario, tiles, assets: tilesetAssets, terrainRevision, doodadsRevision, elevation: flags.elevation, buildability: flags.buildability,
        motion: flags.animateWater ? { pass: effectPass, seconds: (performance.now() / 1000) * waterSpeed, tune: effectTune } : null,
      }));
    } else if (tiles && tilesetLoading) {
      paintLoadingPlate(v);
    } else {
      paintFlatGround(v, tileset.color);
    }
    if (flags.grid) drawGrid(v, gridSize, gridLook);
    drawOverlays("terrain");

    // Units and sprites, then the selection's boxes over them.
    const paint = spritePainter(v, scenario, unitAssets, tilesetAssets);
    const unitTables = unitAssets?.units ?? null;
    let unitsInView = false;
    if ((flags.units || flags.sprites) && scenario && tilePx >= 3) {
      unitsInView = drawObjects(v, paint, scenario, unitAssets, animator, flags);
      if (layer === "units" && flags.units) {
        for (const i of selectedUnits) {
          const u = scenario.units[i];
          if (u) strokeBox(v, unitBox(unitGeometry(unitTables, u.unitId), u.x, u.y), INK.green, DASH.selected);
        }
      }
      if (spritesEditing && flags.sprites) {
        for (const i of selectedSprites) {
          const r = scenario.sprites[i];
          if (r) strokeBox(v, spriteTools.boxOf(r), INK.green, DASH.selected);
        }
        // The sprite under the pointer in select mode.
        if (hoverPoint && !spritePlacing && !objectGestureOn(gesture, "sprites")) {
          const hit = spriteTools.pickAt(hoverPoint);
          const r = hit >= 0 ? scenario.sprites[hit] : null;
          if (r && !selectedSprites.includes(hit)) strokeBox(v, spriteTools.boxOf(r), INK.goldHover, DASH.hover);
        }
      }
    }

    // Doodads layer: the selected footprints, and the doodad under the pointer in select mode.
    if (doodadsEditing && scenario) {
      for (const i of selectedDoodads) {
        const rec = scenario.doodads[i];
        const f = rec && doodadTools.footprintOf(rec);
        if (f) strokeTileRect(v, f, INK.green, DASH.selected);
      }
      const hvd = hoverRef.current;
      if (hvd && !doodadPlacing && !objectGestureOn(gesture, "doodads")) {
        const hit = doodadTools.pickAt(hvd.x, hvd.y);
        const rec = hit >= 0 ? scenario.doodads[hit] : null;
        const f = rec && doodadTools.footprintOf(rec);
        if (f && !selectedDoodads.includes(hit)) strokeTileRect(v, f, INK.goldHover, DASH.hover);
      }
    }

    if (flags.locations && scenario) {
      const dragging = gesture?.kind === "location" ? gesture : null;
      const hover = locationsEditing && hoverPoint && !dragging && !locationTools.handleAtPoint(hoverPoint, zoom) ? locationTools.pickAt(hoverPoint) : -1;
      drawLocations(v, locations, { selected: new Set(locationsEditing ? selectedLocations : []), hover, names: flags.locationNames });
      if (locationsEditing) {
        // Resize handles on a single selection; Anywhere has none, it cannot be resized.
        const only = selectedLocations.length === 1 && selectedLocations[0] !== ANYWHERE_INDEX ? scenario.locations[selectedLocations[0]] : null;
        if (only) drawLocationHandles(v, boundsOf(only));
        // The box a create-drag is about to make, with its size in tiles.
        const ghost = dragging?.mode === "create" ? locationTools.dragRect(dragging.from, dragging.to) : null;
        if (ghost) {
          const corner = draggedBox(v, ghost, "rgba(230,185,92,0.14)", INK.gold);
          sizeChip(v, `${fmtTiles(ghost.right - ghost.left)} × ${fmtTiles(ghost.bottom - ghost.top)}`, corner.right, corner.bottom, INK.goldPale);
        }
      }
    }
    if (flags.startLocations) drawStartLocations(v, startLocations, paint.colorOf);
    drawOverlays("objects");

    // Fog of war: over units, locations and markers alike, since in game it hides all of them.
    if (showFog && scenario) {
      drawFogLayer(ctx, fogLayerRef, scenario, tilesetIndex(scenario), fogViewPlayer, terrainRevision, { x0, y0, x1, y1, tilePx, sx, sy, w: size.w, h: size.h, dpr });
    }

    // The map's edge.
    ctx.strokeStyle = "rgba(230,185,92,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-sx + 0.5, -sy + 0.5, worldW - 1, worldH - 1);

    if (symmetry !== "none" && layer !== "clipboard" && symmetryAvailable(symmetry, mapW, mapH)) drawSymmetryAxes(v, symmetryAxes(symmetry, mapW, mapH));

    // A plugin's object pick: the unit or location under the pointer.
    const ph = pickHoverRef.current;
    if (picking && mapPick?.kind === "object" && ph && scenario) {
      if (ph.kind === "unit") {
        const u = scenario.units[ph.index];
        if (u) drawPickedObject(v, unitBox(unitGeometry(unitTables, u.unitId), u.x, u.y), unitLabel(u.unitId));
      } else {
        const l = locations.find((x) => x.index === ph.index);
        if (l) drawPickedObject(v, l, l.name);
      }
    }
    // A plugin's pick in progress: the rectangle being dragged, teal so it reads as "not the marked area".
    if (picking && gesture?.kind === "pick" && scenario) {
      const r = tileRect(gesture.from, gesture.to);
      const label = mapPick?.kind === "tile" ? `${gesture.to.x}, ${gesture.to.y}` : `${r.x1 - r.x0} × ${r.y1 - r.y0} at ${r.x0}, ${r.y0}`;
      markedTiles(v, r, "rgba(79,209,197,0.12)", INK.teal, label, INK.teal);
    }

    // Cut / Copy / Paste layer: the marked area with its size, and the clip under the pointer while pasting.
    if (clipEditing && scenario) {
      const marking = gesture?.kind === "clip" ? gesture : null;
      const marked = marking ? tileRect(marking.from, marking.to) : clipSelection;
      if (marked) markedTiles(v, marked, "rgba(230,185,92,0.10)", INK.gold, `${marked.x1 - marked.x0} × ${marked.y1 - marked.y0}`, INK.goldPale);
      const at = hoverRef.current;
      if (clipPasting && clip && at && !marking) drawClipGhost(v, paint, scenario, tilesetAssets, doodadTools.catalogue, clip, clipParts, at.x, at.y);
    }

    if (blending && blendAnchor && scenario && inMapBounds(scenario, blendAnchor)) drawBlendAnchor(v, scenario, blendAnchor);

    // Under the pointer: what the active tool would do there, or the drag it is in the middle of
    // (not while a plugin's pick or tool owns the pointer).
    const hv = picking || tooling ? null : hoverRef.current;
    const hp = hoverPoint;
    const doodadDrag = doodadsEditing ? objectGestureOn(gesture, "doodads") : null;
    const spriteDrag = spritesEditing ? objectGestureOn(gesture, "sprites") : null;
    const unitDrag = unitsEditing ? objectGestureOn(gesture, "units") : null;
    if (hv && hp && painting && terrainMode === "isom") {
      drawIsomDiamonds(v, tools.ghostDiamondsAt(hp));
    } else if (doodadDrag?.mode === "move") {
      for (const g of doodadTools.dragGhosts()) drawDoodadGhost(v, paint, tilesetAssets, g, 0.6);
    } else if (hp && doodadDrag?.mode === "marquee") {
      drawMarquee(v, doodadDrag.from, doodadDrag.to);
    } else if (hp && spriteDrag?.mode === "marquee") {
      drawMarquee(v, spriteDrag.from, spriteDrag.to);
    } else if (hv && hp && spritePlacing && !objectGestureOn(gesture, "sprites")) {
      drawSpriteGhosts(v, paint, spriteTools.ghostsAt(hp));
    } else if (hv && hp && doodadPlacing && !objectGestureOn(gesture, "doodads")) {
      // Under a symmetry mode the images follow, drawn fainter.
      doodadTools.ghostsAt(hp).forEach((ghost, i) => drawDoodadGhost(v, paint, tilesetAssets, ghost, ghost.verdict.ok ? (i === 0 ? 0.75 : 0.5) : 0.45));
    } else if (hp && unitDrag?.mode === "marquee") {
      drawMarquee(v, unitDrag.from, unitDrag.to);
    } else if (hv && hp && unitPlacing && !objectGestureOn(gesture, "units")) {
      drawUnitGhosts(v, paint, scenario, unitTables, unitTools.ghostsAt(hp));
    } else if (hv && !doodadsEditing && !spritesEditing && !locationsEditing && !clipEditing) {
      const side = (layer === "terrain" && !blending) || layer === "fog" ? brush : 1;
      if (painting && tilesetAssets && tilePx >= 4 && gesture?.kind !== "stroke") {
        // A preview of what the terrain brush would leave behind.
        if (drawTileGhost(v, tilesetAssets, tools.ghostAt(hv.x, hv.y))) animatedInView = true;
        drawBrushSquare(v, hv, side, null);
      } else {
        // On the fog layer the brush previews its effect: black lays fog, light lifts it.
        drawBrushSquare(v, hv, side, fogPainting ? (fogMode === "fog" ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.22)") : "rgba(230,185,92,0.12)");
      }
    }

    drawOverlays("everything");
    if (flashes.length > 0) drawFlashes(v, flashes, Date.now());

    // A plugin's map tool draws last, over everything, in canvas pixels through the view it is given.
    if (tooling && mapTool) {
      ctx.save();
      try { mapTool.spec.draw?.(ctx, view); } catch (err) { console.error("[plugins] map tool draw failed", err); }
      ctx.restore();
    }

    drawRuler(v, topRef.current, true, hv, rulerKeysRef.current);
    drawRuler(v, leftRef.current, false, hv, rulerKeysRef.current);

    animatedInViewRef.current = animatedInView;
    movingInViewRef.current = movingInView;
    unitsInViewRef.current = unitsInView;
    const rect = { x: sx / tilePx, y: sy / tilePx, w: size.w / tilePx, h: size.h / tilePx };
    const prev = lastViewportRect.current;
    if (rect.x !== prev.x || rect.y !== prev.y || rect.w !== prev.w || rect.h !== prev.h) {
      lastViewportRect.current = rect;
      setViewportRect(rect);
    }
  }, [size, tilePx, zoom, mapW, mapH, worldW, worldH, tileset, flags, gridSize, gridLook, layer, brush, setViewportRect, scenario, tilesetAssets, terrainRevision, locations, startLocations, terrainMode, painting, blending, blendAnchor, tools, tilesetLoading, unitsEditing, unitPlacing, unitTools, unitAssets, animator, selectedUnits, showFog, fogViewPlayer, fogPainting, fogMode, doodadsEditing, doodadPlacing, doodadTools, doodadsRevision, selectedDoodads, clipEditing, clipPasting, clip, clipParts, clipSelection, picking, mapPick, tooling, mapTool, overlays, spritesEditing, spritePlacing, spriteTools, selectedSprites, locationsEditing, locationTools, selectedLocations, symmetry, flashes, waterSpeed, effectTune, effectPass]);

  /**
   * Every repaint request — a pointer move, a scroll, a render that changed what is drawn —
   * goes through one animation frame. A burst of events therefore costs one paint at most,
   * and that paint happens immediately before the browser's own, which is the least latency
   * a canvas can have. `drawRef` is assigned during render so the frame always runs the
   * newest closure; an effect would land after the frame that a render's own request booked.
   */
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const drawPending = useRef(false);
  const drawRaf = useRef(0);
  const scheduleDraw = useCallback(() => {
    drawPending.current = true;
    if (drawRaf.current) return;
    drawRaf.current = requestAnimationFrame(() => {
      drawRaf.current = 0;
      if (!drawPending.current) return;
      drawPending.current = false;
      drawRef.current();
    });
  }, []);
  // The ref has to be cleared as well as the frame cancelled: React's development
  // double-mount runs this cleanup on a component that goes on living, and a stale
  // frame id here would make every later request think one was already booked.
  useEffect(() => () => {
    if (drawRaf.current) cancelAnimationFrame(drawRaf.current);
    drawRaf.current = 0;
    drawPending.current = false;
  }, []);

  // While any flash is live, paint every frame; once the last one has faded, sweep the list (which repaints once more, clean).
  useEffect(() => {
    if (flashes.length === 0) return;
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      const live = flashes.filter((f) => f.start + f.ms > now);
      if (live.length !== flashes.length) { setFlashes(live); return; }
      scheduleDraw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flashes, scheduleDraw, setFlashes]);

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

  /* ── sizing ──────────────────────────────────────────── */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // `draw` is in the deps on purpose: its identity changes with everything the picture is
  // drawn from, so this effect is how a state change reaches the canvas. Setting width or
  // height clears the bitmap, so only do it when the size really moved — in whole device
  // pixels, which is what a canvas holds: against the fractional product of a display
  // scaled to 125% the comparison never matched and every run reallocated it.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const devW = Math.round(size.w * dpr), devH = Math.round(size.h * dpr);
    if (c.width !== devW || c.height !== devH) {
      c.width = devW;
      c.height = devH;
      c.style.width = `${size.w}px`;
      c.style.height = `${size.h}px`;
    }
    scheduleDraw();
  }, [size, draw, scheduleDraw]);

  // What `draw` reads from the store or from something mutated in place repaints without a
  // render: the frame runs the closure it already has.
  useEffect(() => {
    const stops = REPAINT_ATOMS.map((a) => store.sub(a, scheduleDraw));
    stops.push(onGrpLoaded(scheduleDraw));
    return () => { for (const stop of stops) stop(); };
  }, [store, scheduleDraw]);

  /** The scale as the frame loops and effects below read it, without being re-created by a zoom. */
  const tilePxRef = useRef(tilePx);
  tilePxRef.current = tilePx;
  /* ── water / lava animation ──────────────────────────── */
  useEffect(() => {
    const anim = flags.animateWater ? tilesetAssets?.atlas.animation : undefined;
    const units = flags.animateUnits && (flags.units || flags.sprites) && animator?.enabled ? animator : null;
    // Remastered's water and lava have no steps to wait for: they move every frame they are in view.
    const moving = flags.animateWater && tilesetAssets?.atlas.hd?.effects ? true : false;
    if (!scenario || (!anim && !units && !moving)) return;
    let raf = 0;
    let lastMoved = 0;
    // Both speeds are multiples of the game's own rate (Preferences ▸ Display); moving a
    // slider re-runs this effect, so the frame counter starts again at the new rate.
    let lastFrame = Math.floor((performance.now() * unitSpeed) / GAME_FRAME_MS);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      let repaint = false;
      // Palette rotations follow the wall clock, so the phase survives re-mounts and
      // stays in step with the tile browser. Only repaint when something on screen cycles.
      if (anim && tilesetAssets && setAtlasStep(tilesetAssets.atlas, tilesetAssets.tileset, cycleStepAt(now, anim.length, waterSpeed)) && animatedInViewRef.current) repaint = true;
      if (units) {
        // Unit scripts advance once per game frame; after a stall (a hidden tab) catch up
        // by a few frames rather than replaying the whole gap.
        const frame = Math.floor((now * unitSpeed) / GAME_FRAME_MS);
        const steps = Math.min(4, frame - lastFrame);
        lastFrame = frame;
        // Every sprite advances, but only one standing near the view asks for a paint —
        // the same margin the draw pass culls by.
        const el = scrollerRef.current;
        const zoom = tilePxRef.current / TILE;
        const view = el ? {
          left: el.scrollLeft / zoom - UNIT_MARGIN, top: el.scrollTop / zoom - UNIT_MARGIN,
          right: (el.scrollLeft + el.clientWidth) / zoom + UNIT_MARGIN, bottom: (el.scrollTop + el.clientHeight) / zoom + UNIT_MARGIN,
        } : undefined;
        for (let i = 0; i < steps; i++) if (units.tick(view)) repaint = true;
        if (!unitsInViewRef.current) repaint = repaint && animatedInViewRef.current;
      }
      // Thirty frames a second is as smooth as ripples need, and half the repaints of sixty.
      if (moving && movingInViewRef.current && now - lastMoved >= EFFECT_FRAME_MS) repaint = true;
      // A repaint booked for this frame is served here rather than painted twice over.
      if (repaint || drawPending.current) { drawPending.current = false; lastMoved = now; drawRef.current(); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flags.animateWater, flags.animateUnits, flags.units, flags.sprites, tilesetAssets, scenario, animator, waterSpeed, unitSpeed]);

  /* recentring, from the minimap, `view.center` and `view.reveal` */
  /** The glide in progress, if any; a newer request or a scroll from elsewhere cancels it. */
  const glideRef = useRef<{ cancel(): void } | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !centerOn) return;
    const request = centerOn;
    clearCenterOn(null);
    glideRef.current?.cancel();
    glideRef.current = null;
    const targetLeft = () => request.x * tilePxRef.current - el.clientWidth / 2;
    const targetTop = () => request.y * tilePxRef.current - el.clientHeight / 2;
    // `done` is answered a frame after the paint that moved `viewportRectAtom`, so a plugin
    // hearing the "view" event knows every change before the answer was this request's own.
    const arrived = () => requestAnimationFrame(() => requestAnimationFrame(() => request.done?.(true)));
    if (!request.animate) {
      el.scrollLeft = targetLeft();
      el.scrollTop = targetTop();
      scheduleDraw();
      arrived();
      return;
    }
    // A glide of the viewport's own: eased over a duration that grows with the distance, and
    // given up the moment the scroll position is not where the last frame left it — the
    // user's wheel, a scrollbar drag, the keyboard — so the view never fights its owner.
    const fromLeft = el.scrollLeft, fromTop = el.scrollTop;
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth), maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const toLeft = Math.max(0, Math.min(maxLeft, targetLeft())), toTop = Math.max(0, Math.min(maxTop, targetTop()));
    const distance = Math.hypot(toLeft - fromLeft, toTop - fromTop);
    if (distance < 1) { arrived(); return; }
    const duration = Math.min(600, 220 + distance / 6);
    const start = performance.now();
    let lastLeft = fromLeft, lastTop = fromTop;
    let raf = 0;
    const glide = { cancel() { cancelAnimationFrame(raf); if (glideRef.current === glide) glideRef.current = null; request.done?.(false); } };
    glideRef.current = glide;
    const frame = (now: number) => {
      if (Math.abs(el.scrollLeft - lastLeft) > 1 || Math.abs(el.scrollTop - lastTop) > 1) { glide.cancel(); return; }
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - (1 - t) ** 3;
      lastLeft = Math.round(fromLeft + (toLeft - fromLeft) * e);
      lastTop = Math.round(fromTop + (toTop - fromTop) * e);
      el.scrollLeft = lastLeft;
      el.scrollTop = lastTop;
      // The scroller's own scroll event books the repaint; setting the same position fires none.
      lastLeft = el.scrollLeft; lastTop = el.scrollTop;
      if (t < 1) { raf = requestAnimationFrame(frame); return; }
      if (glideRef.current === glide) glideRef.current = null;
      scheduleDraw();
      arrived();
    };
    raf = requestAnimationFrame(frame);
  }, [centerOn, clearCenterOn, draw, scheduleDraw]);
  useEffect(() => () => { glideRef.current?.cancel(); if (panRef.current) cancelAnimationFrame(panRef.current.raf); }, []);

  /*
   * Keep a point of the view in place when zooming: the pointer, when the wheel zoomed
   * with `Preferences.view.zoomToCursor` on (the wheel handler leaves it in `zoomAnchorRef`
   * just before setting the zoom), else the centre — the menu, the keyboard and the toolbar.
   */
  const prevZoom = useRef(zoom);
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || prevZoom.current === zoom) return;
    const ratio = zoom / prevZoom.current;
    const anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    const ax = anchor?.x ?? el.clientWidth / 2;
    const ay = anchor?.y ?? el.clientHeight / 2;
    el.scrollLeft = (el.scrollLeft + ax) * ratio - ax;
    el.scrollTop = (el.scrollTop + ay) * ratio - ay;
    prevZoom.current = zoom;
    scheduleDraw();
  }, [zoom, draw, scheduleDraw]);

  /*
   * The wheel: Ctrl (Cmd) + wheel always zooms — and is taken from the browser, whose own
   * page zoom it would otherwise be; with `Preferences.view.wheel` on "zoom" a plain wheel
   * zooms too, and Shift+wheel is left to the scroller as sideways scrolling. A step per
   * notch: a trackpad's stream of small deltas is summed to the same threshold. Not a React
   * handler, because React's wheel listeners are passive and cannot preventDefault.
   */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      const view = store.get(preferencesAtom).view;
      const zooms = e.ctrlKey || e.metaKey || (view.wheel === "zoom" && !e.shiftKey);
      if (!zooms) { acc = 0; return; }
      e.preventDefault();
      acc += e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : e.deltaY * 40;
      if (Math.abs(acc) < 40) return;
      const dir = acc < 0 ? 1 : -1;
      acc = 0;
      const zoom = store.get(zoomAtom);
      const next = dir > 0 ? ZOOM_STEPS.find((z) => z > zoom) : [...ZOOM_STEPS].reverse().find((z) => z < zoom);
      if (next === undefined || next === zoom) return;
      const r = el.getBoundingClientRect();
      zoomAnchorRef.current = view.zoomToCursor ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
      store.set(zoomAtom, next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [store]);

  /* ── pointer ─────────────────────────────────────────── */
  const tileAt = (e: { clientX: number; clientY: number }) => {
    const el = scrollerRef.current!;
    const r = el.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - r.left + el.scrollLeft) / tilePx),
      y: Math.floor((e.clientY - r.top + el.scrollTop) / tilePx),
    };
  };
  /** For a plugin's `pickObject`: the unit, else the location, under a map pixel — of the kinds the pick asked for. */
  const objectUnder = (px: number, py: number): PickedObject | null => {
    if (!scenario) return null;
    const kinds = mapPick?.kinds;
    const wants = (k: PickedObject["kind"]) => !kinds || kinds.includes(k);
    if (wants("unit")) { const i = unitAt(scenario, unitAssets?.units ?? null, px, py); if (i >= 0) return { kind: "unit", index: i }; }
    if (wants("location")) { const i = locationAt(scenario, px, py); if (i >= 0) return { kind: "location", index: i }; }
    return null;
  };

  const pointAt = (e: { clientX: number; clientY: number }): MapPoint => {
    const el = scrollerRef.current!;
    const r = el.getBoundingClientRect();
    return { px: (e.clientX - r.left + el.scrollLeft) / zoom, py: (e.clientY - r.top + el.scrollTop) / zoom };
  };
  const clampPoint = (p: MapPoint): MapPoint => ({
    px: Math.min(mapW * TILE - 1, Math.max(0, p.px)),
    py: Math.min(mapH * TILE - 1, Math.max(0, p.py)),
  });
  const inMap = (t: { x: number; y: number }) => t.x >= 0 && t.y >= 0 && t.x < mapW && t.y < mapH;
  const clampToMap = (t: { x: number; y: number }) => ({ x: Math.min(mapW - 1, Math.max(0, t.x)), y: Math.min(mapH - 1, Math.max(0, t.y)) });

  /** What a plugin's map tool sees: the pointer in map pixels and tiles, kept on the map while it drags. */
  const toolPointer = (e: MoveEvent, down: boolean, inside = true): MapPointer => {
    const raw = pointAt(e);
    const p = down || !inside ? clampPoint(raw) : raw;
    const t = clampToMap(tileAt(e));
    return { px: p.px, py: p.py, tx: t.x, ty: t.y, inMap: inside && inMap(tileAt(e)), down, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
  };
  const callTool = (name: "onDown" | "onMove" | "onUp", p: MapPointer) => {
    try { mapTool?.spec[name]?.(p); } catch (err) { console.error(`[plugins] map tool ${name} failed`, err); }
  };
  /** Tell every visible overlay with an `onHover` where the pointer is (null: it left the map). */
  const hoverOverlays = (p: MapPointer | null) => {
    if (!scenario) return;
    for (const o of overlays as readonly PluginOverlayEntry[]) {
      if (!o.visible || !o.spec.onHover) continue;
      try { o.spec.onHover(p); } catch (err) { console.error(`[${o.plugin.name}] overlay onHover failed`, err); }
    }
  };

  /* ── the view follows a drag that reaches the edge ───── */

  /** Whether a drag the view should follow is in progress. */
  const gestureLive = () => gestureRef.current !== null;

  const stopAutoPan = () => {
    if (!panRef.current) return;
    cancelAnimationFrame(panRef.current.raf);
    panRef.current = null;
  };

  /**
   * One auto-pan frame: scroll by what the last move asked for, then run that move again at
   * the new scroll position. The pointer is standing still, so nothing else would tell the
   * gesture that the ground under it had moved — the stroke would paint one edge tile for
   * as long as the view slid past. The speed carries a sub-pixel remainder between frames,
   * or the slowest push would never round up to a whole pixel and nothing would move.
   */
  const panFrame = (now: number) => {
    const pan = panRef.current;
    const el = scrollerRef.current;
    if (!pan || !el) return;
    if (!gestureLive()) { stopAutoPan(); return; }
    const dt = Math.min(0.05, (now - pan.last) / 1000);
    pan.last = now;
    pan.dx += pan.vx * dt;
    pan.dy += pan.vy * dt;
    const stepX = Math.trunc(pan.dx), stepY = Math.trunc(pan.dy);
    pan.dx -= stepX;
    pan.dy -= stepY;
    const wasLeft = el.scrollLeft, wasTop = el.scrollTop;
    if (stepX) el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + stepX));
    if (stepY) el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + stepY));
    pan.raf = requestAnimationFrame(panFrame);
    // At the map's edge the scroll stops moving; the gesture has already seen this position.
    if (el.scrollLeft === wasLeft && el.scrollTop === wasTop) return;
    if (lastMoveRef.current) onMove(lastMoveRef.current);
  };

  /** How fast one axis pans: nothing inside the band, ramping to `PAN_MAX` as the pointer pushes past it. */
  const panSpeed = (pos: number, min: number, max: number) => {
    const over = pos < min + EDGE_BAND ? pos - (min + EDGE_BAND) : pos > max - EDGE_BAND ? pos - (max - EDGE_BAND) : 0;
    if (over === 0) return 0;
    const f = Math.min(1, Math.abs(over) / EDGE_BAND);
    return Math.sign(over) * (PAN_MIN + (PAN_MAX - PAN_MIN) * f * f);
  };

  /** Book (or drop) the auto-pan for where this move left the pointer. */
  const autoPanFrom = (e: MoveEvent) => {
    const el = scrollerRef.current;
    if (!el || !gestureLive()) { stopAutoPan(); return; }
    const r = el.getBoundingClientRect();
    // On a view too small to hold three bands the two sides would overlap and fight.
    const vx = r.width > EDGE_BAND * 3 ? panSpeed(e.clientX, r.left, r.right) : 0;
    const vy = r.height > EDGE_BAND * 3 ? panSpeed(e.clientY, r.top, r.bottom) : 0;
    if (vx === 0 && vy === 0) { stopAutoPan(); return; }
    const pan = panRef.current;
    if (pan) { pan.vx = vx; pan.vy = vy; return; }
    // The view belongs to the gesture now: a glide from the minimap or a plugin gives way.
    glideRef.current?.cancel();
    const started = { raf: 0, vx, vy, dx: 0, dy: 0, last: performance.now() };
    panRef.current = started;
    started.raf = requestAnimationFrame(panFrame);
  };

  /** The pointer as a gesture is told of it. */
  const sampleAt = (e: { clientX: number; clientY: number; shiftKey: boolean }): PointerSample => {
    const tile = tileAt(e), point = pointAt(e);
    return { tile, point, mapTile: clampToMap(tile), mapPoint: clampPoint(point), shift: e.shiftKey, zoom };
  };

  /** The active object layer as its gesture sees it; the three differ only in what they pick and box-select by. */
  const objectLayer = (): ObjectLayer | null => {
    if (unitsEditing) {
      return {
        id: "units", placing,
        pickAt: (s) => unitTools.pickAt(s.point),
        isSelected: (i) => selectedUnits.includes(i),
        select: unitTools.select, beginDrag: unitTools.beginDrag, dragTo: unitTools.dragTo, endDrag: unitTools.endDrag,
        selectInBox: (a, b, additive) => unitTools.selectInBox({ left: a.px, top: a.py, right: b.px, bottom: b.py }, additive),
        placeAt: (p) => { unitTools.placeAt(p); },
      };
    }
    if (doodadsEditing) {
      const tileOf = (px: number) => Math.floor(px / TILE);
      return {
        id: "doodads", placing: placingDoodad,
        pickAt: (s) => doodadTools.pickAt(s.tile.x, s.tile.y),
        isSelected: (i) => selectedDoodads.includes(i),
        select: doodadTools.select, beginDrag: doodadTools.beginDrag, dragTo: doodadTools.dragTo, endDrag: doodadTools.endDrag,
        selectInBox: (a, b, additive) => doodadTools.selectInBox({ x0: tileOf(a.px), y0: tileOf(a.py), x1: tileOf(b.px), y1: tileOf(b.py) }, additive),
        placeAt: (p) => { doodadTools.placeAt(p); },
      };
    }
    if (spritesEditing) {
      return {
        id: "sprites", placing: placingSprite,
        pickAt: (s) => spriteTools.pickAt(s.point),
        isSelected: (i) => selectedSprites.includes(i),
        select: spriteTools.select, beginDrag: spriteTools.beginDrag, dragTo: spriteTools.dragTo, endDrag: spriteTools.endDrag,
        selectInBox: (a, b, additive) => spriteTools.selectInBox({ left: a.px, top: a.py, right: b.px, bottom: b.py }, additive),
        placeAt: (p) => { spriteTools.placeAt(p); },
      };
    }
    return null;
  };

  /**
   * The gesture a primary press starts, if any: a plugin's pick ahead of every layer, then
   * the active layer's. (A plugin's tool is served before this, since it also hears the
   * pointer with no button down.) `"done"` where the press acted at once, null where it
   * only read the map or did nothing.
   */
  const gestureFor = (s: PointerSample, alt: boolean): Gesture | "done" | null => {
    const { tile } = s;
    if (picking) {
      if (mapPick?.kind === "object") {
        // An object pick answers on the press with what is under it; nothing there keeps the pick going.
        const o = objectUnder(s.point.px, s.point.py);
        if (o) { pickHoverRef.current = null; mapPick.finish(o); }
        return "done";
      }
      // Answered through the store, on the release: the pick may have been cancelled meanwhile.
      return beginAreaGesture("pick", s, { done: (r, last) => { const pick = store.get(mapPickAtom); pick?.finish(pick.kind === "tile" ? last : r); } });
    }
    const objects = objectLayer();
    if (objects) return beginObjectGesture(objects, s);
    if (locationsEditing) return beginLocationGesture({ ...locationTools, selected: selectedLocations }, s);
    if (clipEditing) {
      if (clipPasting) { clipTools.pasteAt(tile.x, tile.y); return "done"; }
      // Otherwise a drag marks the area Cut / Copy take; a click marks one tile.
      return beginAreaGesture("clip", s, { change: setClipSelection, done: (r) => setClipSelection(r) });
    }
    if (fogPainting) {
      // Alt-click reads the tile's fog into the player ticks; Shift paints the opposite of the palette's mode.
      if (alt) { fogTools.pickAt(tile.x, tile.y); return null; }
      return beginStrokeGesture({
        everyMove: false,
        begin: (at) => fogTools.beginStroke(at.tile.x, at.tile.y, at.shift),
        paintAt: (x, y) => fogTools.paintAt(x, y),
        end: fogTools.endStroke,
      }, s);
    }
    if (blending) { tools.pickAt(tile.x, tile.y); return null; }
    if (!painting) return null;
    if (alt) { tools.pickAt(tile.x, tile.y, s.point); return null; }
    return beginStrokeGesture({
      everyMove: terrainMode === "isom",
      begin: (at) => tools.beginStroke(at.tile.x, at.tile.y, at.point),
      paintAt: tools.paintAt,
      end: tools.endStroke,
    }, s);
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      // The middle button pans the view, on every layer and whatever the tool is doing.
      // Cancelling the press also suppresses the compatibility mouse event Chromium's own
      // middle-click autoscroll rides on.
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      panDragRef.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.style.cursor = "grabbing";
      glideRef.current?.cancel();
      return;
    }
    if (e.button !== 0) return;
    const s = sampleAt(e);
    if (!inMap(s.tile)) return;
    // A layer locked in the Layers panel takes no edits; a plugin's tool or pick still runs.
    if (!tooling && !picking && lockedLayers[layer]) {
      setStatus(t("The {layer} layer is locked — unlock it in the Layers panel to edit", { layer: translate(LAYERS.find((l) => l.id === layer)?.label ?? layer) }));
      return;
    }
    let started: Gesture | "done" | null;
    if (tooling) {
      started = { kind: "tool" };
      hoverRef.current = s.tile;
      hoverPointRef.current = s.point;
      setCursor(s.tile);
      callTool("onDown", toolPointer(e, true));
    } else {
      started = gestureFor(s, e.altKey);
    }
    // A press that only read the map (Alt, the Blend anchor) or did nothing is the browser's as it was.
    if (!started) return;
    e.preventDefault();
    if (started !== "done") {
      e.currentTarget.setPointerCapture(e.pointerId);
      gestureRef.current = started;
    }
    scheduleDraw();
  };

  const onMove = (e: MoveEvent) => {
    // Kept whole (never the React event itself, which is reused) so an auto-pan frame can
    // replay this move against a scroll position the pointer never travelled through.
    lastMoveRef.current = {
      clientX: e.clientX, clientY: e.clientY, buttons: e.buttons,
      shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey,
      currentTarget: e.currentTarget,
    };
    const drag = panDragRef.current;
    if (drag) {
      // A middle-button drag pans: the ground follows the pointer.
      const el = scrollerRef.current!;
      el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft - (e.clientX - drag.x)));
      el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop - (e.clientY - drag.y)));
      drag.x = e.clientX;
      drag.y = e.clientY;
      return;
    }
    autoPanFrom(e);
    const s = sampleAt(e);
    const { tile, point } = s;
    setCursorPixel({ x: Math.max(0, Math.min(worldW, Math.round(point.px))), y: Math.max(0, Math.min(worldH, Math.round(point.py))) });
    if (overlays.length) hoverOverlays(toolPointer(e, (e.buttons & 1) !== 0));
    const gesture = gestureRef.current;
    if (tooling || gesture?.kind === "tool") {
      const down = gesture?.kind === "tool";
      hoverRef.current = inMap(tile) || down ? s.mapTile : null;
      hoverPointRef.current = s.mapPoint;
      setCursor(s.mapTile);
      callTool("onMove", toolPointer(e, down));
      scheduleDraw();
      return;
    }
    if (gesture && gesture.kind !== "stroke") {
      // A drag follows the pointer along the map's edge once it leaves the map.
      gesture.move(s);
      hoverRef.current = s.mapTile;
      hoverPointRef.current = s.mapPoint;
      setCursor(s.mapTile);
      scheduleDraw();
      return;
    }
    if (picking && mapPick?.kind === "object") {
      const o = objectUnder(point.px, point.py);
      const was = pickHoverRef.current;
      if (o?.kind !== was?.kind || o?.index !== was?.index) { pickHoverRef.current = o; scheduleDraw(); }
    }
    if (picking) e.currentTarget.style.cursor = "crosshair";
    // A stroke paints along the edge too, but the brush under the pointer is shown where the pointer is.
    if (gesture) gesture.move(s);
    if (!inMap(tile)) {
      if (hoverRef.current) { hoverRef.current = null; hoverPointRef.current = null; scheduleDraw(); }
      return;
    }
    hoverPointRef.current = point;
    if (locationsEditing) {
      // A handle or a location under the pointer shows what a press would do.
      const h = locationTools.handleAtPoint(point, zoom);
      e.currentTarget.style.cursor = h ? HANDLE_CURSOR[h] : locationTools.pickAt(point) >= 0 ? "move" : "";
    }
    const diamond = terrainMode === "isom" ? diamondAt(point.px, point.py) : null;
    const diamondKey = diamond ? `${diamond.x},${diamond.y}` : "";
    const moved = !hoverRef.current || hoverRef.current.x !== tile.x || hoverRef.current.y !== tile.y || diamondKey !== hoverDiamondRef.current;
    if (moved) {
      hoverRef.current = tile;
      hoverDiamondRef.current = diamondKey;
      // The status bar's tile only changes with the tile, so leave the atom alone in between.
      setCursor(tile);
    }
    // The object layers' ghosts follow the pointer in pixels, not tiles, so they repaint on
    // every move; a terrain or fog brush is tile-shaped and only needs the crossings. The
    // frame coalescer is what makes "every move" cost one paint per frame at most.
    if (moved || unitsEditing || doodadsEditing || spritesEditing || locationsEditing) scheduleDraw();
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    stopAutoPan();
    const release = () => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); };
    if (panDragRef.current) {
      panDragRef.current = null;
      release();
      e.currentTarget.style.cursor = "";
      return;
    }
    const gesture = gestureRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    release();
    if (gesture.kind === "tool") callTool("onUp", toolPointer(e, false));
    else gesture.up();
    if (gesture.kind === "pick") e.currentTarget.style.cursor = "";
    scheduleDraw();
  };

  const onLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    if (tooling && gestureRef.current?.kind !== "tool") callTool("onMove", toolPointer(e, false, false));
    if (overlays.length) hoverOverlays(null);
    hoverRef.current = null;
    hoverPointRef.current = null;
    e.currentTarget.style.cursor = "";
    scheduleDraw();
  };
  const onContextMenu = (e: React.MouseEvent) => {
    /** Drop a plugin's drag without finishing it. */
    const drop = (kind: Gesture["kind"]) => { if (gestureRef.current?.kind === kind) gestureRef.current = null; };
    // While a plugin waits for a pick, a right-click cancels it instead of opening the menu.
    if (picking) { e.preventDefault(); drop("pick"); cancelPick(); (e.currentTarget as HTMLElement).style.cursor = ""; scheduleDraw(); return; }
    // A plugin's tool: the right-click is its cancel (the tool may keep running and only drop a gesture).
    if (tooling) { e.preventDefault(); drop("tool"); cancelTool(); scheduleDraw(); return; }
    // While placing, a right-click leaves placement mode instead of opening the menu.
    if (unitPlacing) { e.preventDefault(); unitTools.stopPlacing(); scheduleDraw(); return; }
    if (doodadPlacing) { e.preventDefault(); doodadTools.stopPlacing(); scheduleDraw(); return; }
    if (spritePlacing) { e.preventDefault(); spriteTools.stopPlacing(); scheduleDraw(); return; }
    if (clipPasting) { e.preventDefault(); clipTools.stopPasting(); scheduleDraw(); return; }
    if (locationsEditing && hoverPointRef.current) {
      // Right-clicking a location selects it so the menu's items act on it.
      const hit = locationTools.pickAt(hoverPointRef.current);
      if (hit >= 0 && !selectedLocations.includes(hit)) locationTools.select([hit]);
    }
    if (layer === "doodads" && hoverRef.current) {
      // Likewise a doodad: the menu's Delete and Convert act on it.
      const hit = doodadTools.pickAt(hoverRef.current.x, hoverRef.current.y);
      if (hit >= 0 && !selectedDoodads.includes(hit)) doodadTools.select([hit]);
    }
    // The menu's rows are built once it opens, for where this click landed.
    setMenuTarget({ tile: hoverRef.current, point: hoverPointRef.current });
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    if (locationsEditing) {
      const hit = locationTools.pickAt(pointAt(e));
      if (hit < 0) return;
      if (!selectedLocations.includes(hit)) locationTools.select([hit]);
      open("locationProperties", { index: hit });
      return;
    }
    if (spritesEditing) {
      const hit = spriteTools.pickAt(pointAt(e));
      if (hit < 0) return;
      const indices = selectedSprites.includes(hit) ? selectedSprites : [hit];
      if (indices !== selectedSprites) spriteTools.select(indices);
      open("spriteProperties", { indices });
      return;
    }
    if (!unitsEditing) return;
    const hit = unitTools.pickAt(pointAt(e));
    if (hit < 0) return;
    const indices = selectedUnits.includes(hit) ? selectedUnits : [hit];
    if (indices !== selectedUnits) unitTools.select(indices);
    open("unitProperties", { indices });
  };

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
      {scenario && tilesetLoading && (
        <div className="viewport-loading" role="status" aria-live="polite">
          <Loader2 size={16} className="spin" aria-hidden />
          <span>{t("Loading {name} terrain…", { name: translate(tileset.name) })}</span>
        </div>
      )}
      <div className="viewport-notices">
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
      </div>
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
