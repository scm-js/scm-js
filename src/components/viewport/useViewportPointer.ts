import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useSetAtom } from "jotai";
import { cursorPixelAtom, cursorTileAtom, clipSelectionAtom } from "../../atoms/editorAtoms";
import { openDialogAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import { canEdit } from "../../atoms/documentAtoms";
import { cancelMapPickAtom, cancelMapToolAtom, mapPickAtom, type PluginOverlayEntry } from "../../atoms/pluginAtoms";
import type { MapPointer, PickedObject } from "../../plugins/api";
import type { MapPoint } from "../../hooks/useTerrainTools";
import { HANDLE_CURSOR, locationAt } from "../../editor/locations";
import { unitAt } from "../../editor/units";
import { diamondAt } from "../../editor/isom";
import { LAYERS } from "../chrome/MenuBar";
import { t, translate } from "../../i18n";
import {
  beginAreaGesture, beginLocationGesture, beginObjectGesture, beginPasteGesture, beginStrokeGesture,
  type Gesture, type ObjectLayer, type PointerSample,
} from "./gestures";
import { autoPanner, type MoveEvent, type PanState } from "./autoPan";
import { TILE } from "./paint/view";
import type { MenuTarget } from "./ViewportMenu";
import type { ViewportState } from "./viewportState";

/** A press's hold on the map (`mapPointerHeldAtom`), ended by a release anywhere. */
export function useReleaseHold(setPointerHeld: (held: boolean) => void) {
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
}

interface PointerArgs {
  scheduleDraw: () => void;
  /** The glide in progress (`useViewMotion`): a middle-button press or an auto-pan cancels it. */
  glideRef: RefObject<{ cancel(): void } | null>;
  panRef: RefObject<PanState | null>;
  setMenuTarget: Dispatch<SetStateAction<MenuTarget>>;
  open: ReturnType<typeof useSetAtom<typeof openDialogAtom>>;
}

/**
 * The surface's pointer handlers: which gesture a press starts (`gestureFor`), the move,
 * release, leave, right-click and double-click paths, the middle-button pan and the auto-pan
 * at the edge. Plain functions made afresh each render, as they were in the component; what
 * must never be stale is read from the store (`store.get`).
 */
export function useViewportPointer(state: ViewportState, args: PointerArgs) {
  const {
    scrollerRef, hoverRef, hoverPointRef, gestureRef, pickHoverRef, store,
    scenario, mapW, mapH, zoom, tilePx, worldW, worldH, layer, lockedLayers, viewOnly, terrainMode, unitAssets,
    mapPick, mapTool, overlays, selectedUnits, selectedDoodads, selectedSprites, selectedLocations,
    picking, tooling, painting, blending, fogPainting, unitsEditing, placing, unitPlacing, doodadsEditing, placingDoodad, doodadPlacing,
    spritesEditing, placingSprite, spritePlacing, locationsEditing, clipEditing, clipPasting,
    tools, unitTools, doodadTools, spriteTools, locationTools, fogTools, clipTools,
  } = state;
  const { scheduleDraw, glideRef, panRef, setMenuTarget, open } = args;
  /** Diamond under the pointer at the last redraw, so the isometric outline follows the pointer within a tile. */
  const hoverDiamondRef = useRef("");
  /** The last pointer move, kept so an auto-pan frame can replay it after it scrolls. */
  const lastMoveRef = useRef<MoveEvent | null>(null);
  /** A middle-button drag panning the view: where the pointer was at the last move. */
  const panDragRef = useRef<{ x: number; y: number } | null>(null);
  const refuseViewOnly = () => { canEdit(store.get, store.set); };
  const setStatus = useSetAtom(statusMessageAtom);
  const setCursorPixel = useSetAtom(cursorPixelAtom);
  const setClipSelection = useSetAtom(clipSelectionAtom);
  const cancelPick = useSetAtom(cancelMapPickAtom);
  const cancelTool = useSetAtom(cancelMapToolAtom);
  const setCursor = useSetAtom(cursorTileAtom);

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

  // The view follows a drag that reaches the edge. `onMove` is read when a frame runs, by
  // which time it is defined below.
  const { autoPanFrom, stopAutoPan } = autoPanner({ scrollerRef, gestureRef, glideRef, panRef, lastMoveRef, onMove: (e) => onMove(e) });

  /** The pointer as a gesture is told of it. */
  const sampleAt = (e: { clientX: number; clientY: number; shiftKey: boolean }): PointerSample => {
    const tile = tileAt(e), point = pointAt(e);
    return { tile, point, mapTile: clampToMap(tile), mapPoint: clampPoint(point), shift: e.shiftKey, zoom };
  };

  /**
   * The active object layer as its gesture sees it; on a view-only map a press still picks
   * and box-selects, and moving and placing do nothing.
   */
  const objectLayer = (): ObjectLayer | null => {
    const layer = editableObjectLayer();
    return layer && viewOnly ? { ...layer, placing: false, beginDrag: () => {}, dragTo: () => {}, endDrag: () => {}, placeAt: () => {}, stretch: undefined } : layer;
  };

  /** The active object layer as its gesture sees it; the three differ only in what they pick and box-select by. */
  const editableObjectLayer = (): ObjectLayer | null => {
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
        stretch: { to: (from, p, any) => { doodadTools.stretchTo(from, p, any); }, end: doodadTools.endStretch },
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
    // A press meant for the terrain or fog brush on a view-only map: say why nothing happens.
    if (viewOnly && (layer === "terrain" || layer === "fog")) { refuseViewOnly(); return null; }
    const objects = objectLayer();
    if (objects) return beginObjectGesture(objects, s);
    if (locationsEditing) {
      // A view-only map's locations can be picked and box-selected; no handle, move or new box.
      const still = viewOnly ? { handleAtPoint: () => null, beginMove: () => {}, dragTo: () => {}, endDrag: () => {}, create: () => {} } : {};
      return beginLocationGesture({ ...locationTools, ...still, selected: selectedLocations }, s);
    }
    if (clipEditing) {
      if (clipPasting) {
        if (viewOnly) return "done";
        // A click stamps the clip; a drag pulls it out first, the way a doodad stretches.
        return beginPasteGesture(s, { stretch: (from, p, any) => { clipTools.stretchTo(from, p, any); }, paste: (at) => { clipTools.pasteAt(at.x, at.y); }, end: clipTools.endStretch });
      }
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
    if (doodadPlacing) { e.preventDefault(); drop("object"); doodadTools.endStretch(); doodadTools.stopPlacing(); scheduleDraw(); return; }
    if (spritePlacing) { e.preventDefault(); spriteTools.stopPlacing(); scheduleDraw(); return; }
    if (clipPasting) { e.preventDefault(); drop("paste"); clipTools.endStretch(); clipTools.stopPasting(); scheduleDraw(); return; }
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

  return { onDown, onMove, onUp, onLeave, onContextMenu, onDoubleClick };
}
