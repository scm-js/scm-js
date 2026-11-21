import { useCallback, useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { tileBlockAtom } from "../../atoms/tileBlockAtoms";
import { viewportRectAtom } from "../../atoms/editorAtoms";
import type { MapView, OverlayAbove } from "../../plugins/api";
import { tileRect } from "../../editor/clipboard";
import { boundsOf } from "../../editor/locations";
import { drawFogLayer, type FogLayer } from "./fog";
import { ANYWHERE_INDEX } from "../../formats/chk/sections/objects";
import { tilesetIndex } from "../../formats/chk/scenario";
import { mapLacks } from "../../data/remasteredTiles";
import { unitBox, unitGeometry } from "../../editor/units";
import { unitLabel } from "../../data/units";
import { symmetryAvailable, symmetryAxes } from "../../editor/symmetry";
import { inMap as inMapBounds } from "../../editor/blend";
import { t } from "../../i18n";
import { objectGestureOn } from "./gestures";
import { drawBlendAnchor, drawBrushSquare, drawClipGhost, drawDoodadGhost, drawIsomDiamonds, drawSpriteGhosts, drawTileGhost, drawUnitGhosts } from "./paint/ghosts";
import { drawGrid, drawRuler, drawSymmetryAxes } from "./paint/grid";
import { drawChangedGround, drawChangedObjects } from "./paint/changes";
import { EffectPass } from "./effectPass";
import { paintFlatGround, paintGround, paintLoadingPlate, type GroundLayer } from "./paint/ground";
import { drawLocationHandles, drawLocations, drawStartLocations } from "./paint/locations";
import { drawObjects, spritePainter } from "./paint/objects";
import { DASH, draggedBox, drawFlashes, drawMarquee, drawPickedObject, INK, markedTiles, sizeChip, strokeBox, strokeTileRect, TILE, type PaintView } from "./paint/view";
import type { InView } from "./useFrameLoop";
import type { ViewportState } from "./viewportState";

const fmtTiles = (px: number) => (Number.isInteger(px / TILE) ? String(px / TILE) : (px / TILE).toFixed(2));

/** Remastered's water and lava need a WebGL pass of their own; this holds it for the viewport's life. */
export function useEffectPass() {
  /**
   * The pass that moves Remastered's water and lava, made the first time it is wanted. A context the browser
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
  return effectPass;
}

/**
 * The viewport's paint: `draw` runs the passes of `paint/` over the canvas and the rulers. Its
 * identity changes with everything the picture is drawn from (its deps are only what it
 * closes over), which is how a state change reaches the canvas (`useRepaints`). Holds the
 * ground and fog caches, the rulers' keys, and what the last paint found in view.
 */
export function useViewportDraw(state: ViewportState): { draw: () => void; inView: InView } {
  const {
    scrollerRef, canvasRef, topRef, leftRef, hoverRef, hoverPointRef, gestureRef, pickHoverRef, store,
    size, tileset, flags, gridSize, gridLook, brush, tilesetAssets, tilesetLoading, terrainRevision, doodadsRevision, pinned, fairness, comparison,
    locations, startLocations, blendAnchor, animator, showFog, fogViewPlayer, fogMode, clip, clipParts, clipSelection, symmetry, flashes,
    waterSpeed, effectTune, effectPass,
    scenario, mapW, mapH, zoom, tilePx, worldW, worldH, layer, terrainMode, unitAssets,
    mapPick, mapTool, overlays, selectedUnits, selectedDoodads, selectedSprites, selectedLocations,
    picking, tooling, painting, blending, fogPainting, unitsEditing, unitPlacing, doodadsEditing, doodadPlacing,
    spritesEditing, spritePlacing, locationsEditing, clipEditing, clipPasting,
    tools, unitTools, doodadTools, spriteTools, locationTools, clipTools,
  } = state;
  const setViewportRect = useSetAtom(viewportRectAtom);
  /** Whether the last paint blitted any cycling (water/lava) megatile, so the animation loop knows when a repaint shows anything. */
  const animatedInViewRef = useRef(false);
  /** Whether the last paint ran Remastered's water or lava over the terrain, so the loop keeps it moving. */
  const movingInViewRef = useRef(false);
  /** The ground and the fog, cached between paints; see `paint/ground.ts` and `fog.ts`. */
  const groundLayerRef = useRef<GroundLayer | null>(null);
  const fogLayerRef = useRef<FogLayer | null>(null);
  /** Whether the last paint drew any unit, so the unit animation loop can skip repaints of empty views. */
  const unitsInViewRef = useRef(false);
  const lastViewportRect = useRef({ x: -1, y: -1, w: -1, h: -1 });
  /** What each ruler was last drawn for, so a paint that moves neither leaves them alone. */
  const rulerKeysRef = useRef({ top: "", left: "" });

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
        scenario, tiles, assets: tilesetAssets, terrainRevision, doodadsRevision, elevation: flags.elevation, buildability: flags.buildability, seams: flags.seams || (layer === "terrain" && terrainMode === "heal"),
        pins: flags.pins || (layer === "terrain" && terrainMode === "pin") ? pinned : null,
        unlike: fairness?.report?.mask ?? null,
        lacks: scenario ? mapLacks(tiles, tilesetIndex(scenario), tilesetAssets.tileset.groups.length, terrainRevision + doodadsRevision) : null,
        motion: flags.animateWater ? { pass: effectPass, seconds: (performance.now() / 1000) * waterSpeed, tune: effectTune } : null,
      }));
    } else if (tiles && tilesetLoading) {
      paintLoadingPlate(v);
    } else {
      paintFlatGround(v, tileset.color);
    }
    if (comparison && scenario) drawChangedGround(v, comparison.changes, comparison.sameTileset);
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
    if (comparison && scenario) drawChangedObjects(v, comparison.changes, unitTables);
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
      const label = mapPick?.kind === "tile" ? `${gesture.to.x}, ${gesture.to.y}` : t("{w} × {h} at {x}, {y}", { w: r.x1 - r.x0, h: r.y1 - r.y0, x: r.x0, y: r.y0 });
      markedTiles(v, r, "rgba(79,209,197,0.12)", INK.teal, label, INK.teal);
    }

    // Cut / Copy / Paste layer: the marked area with its size, and the clip under the pointer while pasting.
    if (clipEditing && scenario) {
      const marking = gesture?.kind === "clip" ? gesture : null;
      const marked = marking ? tileRect(marking.from, marking.to) : clipSelection;
      if (marked) markedTiles(v, marked, "rgba(230,185,92,0.10)", INK.gold, `${marked.x1 - marked.x0} × ${marked.y1 - marked.y0}`, INK.goldPale);
      const at = hoverRef.current;
      // While a press is pulling the clip out, it stands where the press put it.
      const pulling = gesture?.kind === "paste" ? gesture : null;
      const ghost = clipPasting && clip && !marking && (pulling ?? at) ? clipTools.ghostAt((pulling?.from ?? at!).x, (pulling?.from ?? at!).y) : null;
      // The parts ticked decide what of the clip shows; stretched, it is its terrain and nothing else.
      if (ghost) drawClipGhost(v, paint, scenario, tilesetAssets, doodadTools.catalogue, ghost.clip, ghost.stretched ? ghost.parts : clipParts, ghost.x, ghost.y);
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
    } else if (doodadDrag?.mode === "stretch") {
      // The doodad pulled out along the drag, standing where the press put it.
      doodadTools.ghostsAt(doodadDrag.from).forEach((ghost, i) => drawDoodadGhost(v, paint, tilesetAssets, ghost, ghost.verdict.ok ? (i === 0 ? 0.75 : 0.5) : 0.45));
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
        // A block on the Tile brush stands with its top-left under the pointer, as a paste does.
        const block = terrainMode === "tile" ? store.get(tileBlockAtom) : null;
        if (block && layer === "terrain") strokeTileRect(v, { x0: hv.x, y0: hv.y, x1: hv.x + block.cols, y1: hv.y + block.rows }, INK.gold);
        else drawBrushSquare(v, hv, side, null);
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
  }, [size, tilePx, zoom, mapW, mapH, worldW, worldH, tileset, flags, gridSize, gridLook, layer, brush, setViewportRect, scenario, tilesetAssets, terrainRevision, pinned, fairness, comparison, locations, startLocations, terrainMode, painting, blending, blendAnchor, tools, tilesetLoading, unitsEditing, unitPlacing, unitTools, unitAssets, animator, selectedUnits, showFog, fogViewPlayer, fogPainting, fogMode, doodadsEditing, doodadPlacing, doodadTools, doodadsRevision, selectedDoodads, clipEditing, clipPasting, clip, clipParts, clipSelection, clipTools, picking, mapPick, tooling, mapTool, overlays, spritesEditing, spritePlacing, spriteTools, selectedSprites, locationsEditing, locationTools, selectedLocations, symmetry, flashes, waterSpeed, effectTune, effectPass, store, scrollerRef, canvasRef, gestureRef, hoverPointRef, hoverRef, pickHoverRef, topRef, leftRef]);

  return { draw, inView: { animatedInViewRef, movingInViewRef, unitsInViewRef } };
}
