/**
 * The drags of the map view, one object each.
 *
 * A press on the map starts at most one gesture; it is told every move until the release
 * and then ends. The viewport holds the one in progress and knows nothing about what it
 * does — which layer's tools it calls, when a click turns into a marquee — and the draw
 * pass reads the gesture's public fields for what to show of it. Nothing here touches the
 * DOM or React, so a gesture can be driven from a test with a stand-in for the tools.
 */
import { tileRect } from "../../editor/clipboard";
import type { TileRect } from "../../editor/doodads";
import type { Handle } from "../../editor/locations";
import { linePoints } from "../../editor/terrain";
import type { MapPoint } from "../../hooks/useTerrainTools";
import type { PixelBox } from "./paint/view";

export interface Tile {
  x: number;
  y: number;
}

/** Where the pointer is, as a gesture needs it: raw, and kept on the map (a drag past the edge follows the edge, like StarEdit). */
export interface PointerSample {
  /** The tile and map pixel under the pointer; off the map when the pointer is. */
  tile: Tile;
  point: MapPoint;
  /** The same, clamped to the map. */
  mapTile: Tile;
  mapPoint: MapPoint;
  shift: boolean;
  /** Screen pixels per map pixel, for thresholds that are a distance on screen. */
  zoom: number;
}

interface Live {
  move(s: PointerSample): void;
  /** The release: commit what the drag did. */
  up(): void;
}

/** How far, in screen pixels, a press has to travel before it stops being a click. */
const DRAG_THRESHOLD = 4;
const travelled = (from: MapPoint, to: MapPoint, zoom: number) => Math.hypot(to.px - from.px, to.py - from.py) * zoom > DRAG_THRESHOLD;

/* ── Units, doodads, sprites ─────────────────────────────── */

export type ObjectLayerId = "units" | "doodads" | "sprites";

/** What the three object layers have in common, as their gesture uses it. */
export interface ObjectLayer {
  id: ObjectLayerId;
  /** Whether a click on empty ground places the palette's choice (else it clears the selection). */
  placing: boolean;
  /** The object under the pointer, or -1. */
  pickAt(s: PointerSample): number;
  isSelected(index: number): boolean;
  select(indices: number[], additive?: boolean): void;
  beginDrag(p: MapPoint): void;
  dragTo(p: MapPoint): void;
  endDrag(): void;
  selectInBox(from: MapPoint, to: MapPoint, additive: boolean): void;
  placeAt(p: MapPoint): void;
}

/**
 * An object-layer drag: moving the selection, or a press on empty ground that places (or,
 * in select mode, clears the selection) unless it grows into a marquee.
 */
export interface ObjectGesture extends Live {
  kind: "object";
  layer: ObjectLayerId;
  mode: "move" | "click" | "select" | "marquee";
  from: MapPoint;
  to: MapPoint;
  additive: boolean;
}

export function beginObjectGesture(layer: ObjectLayer, s: PointerSample): ObjectGesture {
  const p = s.point;
  const hit = layer.pickAt(s);
  const g: ObjectGesture = {
    kind: "object",
    layer: layer.id,
    mode: hit >= 0 ? "move" : layer.placing ? "click" : "select",
    from: p,
    to: p,
    additive: hit >= 0 ? false : s.shift,
    move(m) {
      g.to = m.mapPoint;
      if (g.mode === "move") layer.dragTo(g.to);
      else if (g.mode !== "marquee" && travelled(g.from, g.to, m.zoom)) g.mode = "marquee";
    },
    up() {
      if (g.mode === "move") layer.endDrag();
      else if (g.mode === "marquee") layer.selectInBox(g.from, g.to, g.additive);
      else {
        if (!g.additive) layer.select([]);
        if (g.mode === "click") layer.placeAt(g.from);
      }
    },
  };
  if (hit >= 0) {
    // Pressing an object selects it (shift toggles) and starts dragging the selection.
    if (s.shift) layer.select([hit], true);
    else if (!layer.isSelected(hit)) layer.select([hit]);
    layer.beginDrag(p);
  }
  return g;
}

/* ── Locations ───────────────────────────────────────────── */

export interface LocationLayer {
  selected: readonly number[];
  handleAtPoint(p: MapPoint, zoom: number): Handle | null;
  pickAt(p: MapPoint): number;
  select(indices: number[], additive?: boolean): void;
  beginResize(index: number, handle: Handle): void;
  beginMove(p: MapPoint): void;
  dragTo(p: MapPoint): void;
  endDrag(): void;
  dragRect(from: MapPoint, to: MapPoint): PixelBox | null;
  create(box: PixelBox): void;
}

/**
 * A Locations-layer drag: moving the selection, dragging a handle, or a press on empty
 * ground — a click clears the selection, a drag creates a location.
 */
export interface LocationGesture extends Live {
  kind: "location";
  mode: "move" | "resize" | "create" | "click";
  from: MapPoint;
  to: MapPoint;
  additive: boolean;
}

export function beginLocationGesture(layer: LocationLayer, s: PointerSample): LocationGesture {
  const p = s.point;
  const handle = layer.handleAtPoint(p, s.zoom);
  const hit = handle ? -1 : layer.pickAt(p);
  const g: LocationGesture = {
    kind: "location",
    mode: handle ? "resize" : hit >= 0 ? "move" : "click",
    from: p,
    to: p,
    additive: handle || hit >= 0 ? false : s.shift,
    move(m) {
      g.to = m.mapPoint;
      if (g.mode === "move" || g.mode === "resize") layer.dragTo(g.to);
      else if (g.mode === "click" && travelled(g.from, g.to, m.zoom)) g.mode = "create";
    },
    up() {
      if (g.mode === "move" || g.mode === "resize") layer.endDrag();
      else if (g.mode === "create") {
        const box = layer.dragRect(g.from, g.to);
        if (box) layer.create(box);
      } else if (!g.additive) {
        layer.select([]);
      }
    },
  };
  if (handle) {
    layer.beginResize(layer.selected[0], handle);
  } else if (hit >= 0) {
    if (s.shift) layer.select([hit], true);
    else if (!layer.selected.includes(hit)) layer.select([hit]);
    layer.beginMove(p);
  }
  return g;
}

/* ── A block of tiles ────────────────────────────────────── */

/**
 * A drag that marks a block of tiles: the Cut / Copy / Paste layer's area (told on every
 * tile crossed, so the chrome follows it) or a plugin's `pickArea` / `pickTile` (told once,
 * on the release).
 */
export interface AreaGesture extends Live {
  kind: "clip" | "pick";
  from: Tile;
  to: Tile;
}

export function beginAreaGesture(kind: "clip" | "pick", s: PointerSample, on: { change?(r: TileRect): void; done(r: TileRect, last: Tile): void }): AreaGesture {
  const g: AreaGesture = {
    kind,
    from: s.tile,
    to: s.tile,
    move(m) {
      const c = m.mapTile;
      if (c.x === g.to.x && c.y === g.to.y) return;
      g.to = c;
      on.change?.(tileRect(g.from, c));
    },
    up() {
      on.done(tileRect(g.from, g.to), g.to);
    },
  };
  on.change?.(tileRect(g.from, g.to));
  return g;
}

/* ── A brush stroke ──────────────────────────────────────── */

export interface Brush {
  /** The isometric brush fires once per diamond by itself and wants the pointer, so every move is forwarded; a tile brush is told each tile on the line from the last one. */
  everyMove: boolean;
  begin(s: PointerSample): void;
  paintAt(x: number, y: number, p?: MapPoint): void;
  end(): void;
}

/** A terrain or fog stroke; `last` is the tile it painted last, so a fast drag fills the gap with a line. */
export interface StrokeGesture extends Live {
  kind: "stroke";
  last: Tile;
}

export function beginStrokeGesture(brush: Brush, s: PointerSample): StrokeGesture {
  const g: StrokeGesture = {
    kind: "stroke",
    last: s.tile,
    move(m) {
      const c = m.mapTile;
      if (brush.everyMove) {
        brush.paintAt(c.x, c.y, m.mapPoint);
      } else {
        if (c.x === g.last.x && c.y === g.last.y) return;
        for (const p of linePoints(g.last.x, g.last.y, c.x, c.y).slice(1)) brush.paintAt(p.x, p.y);
      }
      g.last = c;
    },
    up() {
      brush.end();
    },
  };
  brush.begin(s);
  return g;
}

/** A plugin's map tool holding the primary button; the tool is told the moves itself, hover included. */
export interface ToolGesture {
  kind: "tool";
}

export type Gesture = ObjectGesture | LocationGesture | AreaGesture | StrokeGesture | ToolGesture;

/** The object-layer gesture in progress on `layer`, if that is what is in progress. */
export function objectGestureOn(g: Gesture | null, layer: ObjectLayerId): ObjectGesture | null {
  return g?.kind === "object" && g.layer === layer ? g : null;
}
