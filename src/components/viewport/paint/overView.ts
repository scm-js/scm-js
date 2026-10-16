/**
 * What the editor draws over a map, drawn over a plugin's map view instead (`MapViewHandle.paintOver`):
 * the grid, the locations and the other plugins' overlays, mapped by the view's own `MapView` so they
 * sit on the view's picture exactly as they sit on the map. The rest of the map's passes — its ground,
 * objects, fog and the tools' drawing — are the map's own and stay behind the view.
 */
import type { MapView, OverlayAbove } from "../../../plugins/api";
import type { ViewFlags } from "../../../editor/view";
import type { GridLook } from "../../../atoms/preferencesAtoms";
import type { ViewLocation } from "../../../atoms/documentAtoms";
import type { PluginOverlayEntry } from "../../../atoms/pluginAtoms";
import { drawGrid } from "./grid";
import { drawLocations } from "./locations";
import { TILE, type PaintView } from "./view";

export interface OverViewPaint {
  flags: Pick<ViewFlags, "grid" | "locations" | "locationNames">;
  gridSize: number;
  gridLook: GridLook;
  locations: readonly ViewLocation[];
  /** The map in tiles. */
  mapW: number;
  mapH: number;
  /** The visible overlays to draw, the view's own plugin's left out. */
  overlays: readonly PluginOverlayEntry[];
}

const ORDER: readonly OverlayAbove[] = ["terrain", "objects", "everything"];

let uiFontName: string | undefined;
let monoFontName: string | undefined;

/** The canvas's size in CSS pixels and its pixel ratio, from the context's scale (`setTransform(dpr, …)`). */
function canvasSize(ctx: CanvasRenderingContext2D): { w: number; h: number; dpr: number } {
  const dpr = (typeof ctx.getTransform === "function" ? ctx.getTransform().a : 0) || 1;
  return { w: ctx.canvas.width / dpr, h: ctx.canvas.height / dpr, dpr };
}

/** A `PaintView` that maps as `view` does, for the map's own passes. */
export function paintViewOf(ctx: CanvasRenderingContext2D, view: MapView, mapW: number, mapH: number): PaintView {
  const { w, h, dpr } = canvasSize(ctx);
  const zoom = view.zoom, tilePx = view.tilePx || TILE * zoom;
  return {
    ctx, zoom, tilePx, sx: -view.x(0), sy: -view.y(0), w, h, dpr,
    x0: view.visible.x0, y0: view.visible.y0, x1: view.visible.x1, y1: view.visible.y1,
    mapW, mapH, worldW: mapW * tilePx, worldH: mapH * tilePx,
    uiFont: () => (uiFontName ??= typeof document === "undefined" ? "sans-serif" : getComputedStyle(document.body).getPropertyValue("--font-ui") || "sans-serif"),
    monoFont: () => (monoFontName ??= typeof document === "undefined" ? "monospace" : getComputedStyle(document.body).getPropertyValue("--font-mono") || "monospace"),
  };
}

/** In the map's order: the grid, overlays over the terrain, the locations, then the overlays over objects and over everything. */
export function paintOverView(ctx: CanvasRenderingContext2D, view: MapView, p: OverViewPaint): void {
  const v = paintViewOf(ctx, view, p.mapW, p.mapH);
  const overlaysAt = (above: OverlayAbove) => {
    for (const o of p.overlays) {
      if ((o.spec.above ?? "terrain") !== above) continue;
      ctx.save();
      try { o.spec.draw(ctx, view); } catch (err) { console.error(`[${o.plugin.name}] overlay draw failed`, err); }
      ctx.restore();
    }
  };
  if (p.flags.grid) { ctx.save(); drawGrid(v, p.gridSize, p.gridLook); ctx.restore(); }
  overlaysAt(ORDER[0]);
  if (p.flags.locations && p.locations.length > 0) {
    ctx.save();
    drawLocations(v, p.locations, { selected: new Set(), hover: -1, names: p.flags.locationNames });
    ctx.restore();
  }
  overlaysAt(ORDER[1]);
  overlaysAt(ORDER[2]);
}
