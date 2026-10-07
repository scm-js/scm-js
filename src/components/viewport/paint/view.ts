/**
 * What every draw pass of the map view is handed, and the handful of shapes they share.
 *
 * A pass is a plain function of a `PaintView` and the things it draws — no component state,
 * no refs — so `MapViewport`'s `draw` is the list of passes in painter's order and each one
 * can be read (and changed) by itself. Everything here is in CSS pixels of the canvas unless
 * it says otherwise; the context arrives scaled by the device pixel ratio.
 */
import type { TileRect } from "../../../editor/doodads";
import type { ViewFlash } from "../../../atoms/pluginAtoms";

export const TILE = 32;

export interface PaintView {
  ctx: CanvasRenderingContext2D;
  /** Screen pixels per map pixel, and per tile. */
  zoom: number;
  tilePx: number;
  /** The scroll position and the size of the canvas. */
  sx: number;
  sy: number;
  w: number;
  h: number;
  dpr: number;
  /** Visible tile range, exclusive on the far side. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The map in tiles, and in screen pixels at this zoom. */
  mapW: number;
  mapH: number;
  worldW: number;
  worldH: number;
  /** The chrome's fonts, read from the tokens once per paint at most. */
  uiFont(): string;
  monoFont(): string;
}

/** A box in map pixels. */
export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The colours the overlays are drawn in: gold for what the tool will do, green for a selection, teal for locations and picks, red for a refusal. */
export const INK = {
  gold: "#e6b95c",
  goldPale: "#f4d08a",
  goldHover: "rgba(230,185,92,0.7)",
  green: "#8ef0a4",
  teal: "#4fd1c5",
  tealPale: "#bff5ef",
  red: "#f05a5a",
  plate: "rgba(10,12,16,0.8)",
} as const;

/** The dashes of a selection, of the thing under the pointer, and of an area being marked. */
export const DASH = { selected: [4, 3], hover: [2, 2], area: [5, 3] } as const;

/**
 * A one-pixel outline of a box in map pixels, on whole screen pixels. `shrink` takes a pixel
 * off the far edges, for a box whose right and bottom are exclusive.
 */
export function strokeBox(v: PaintView, b: PixelBox, color: string, dash: readonly number[] | null = null, shrink = 0) {
  const { ctx, zoom, sx, sy } = v;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(dash ? [...dash] : []);
  ctx.strokeRect(Math.round(b.left * zoom - sx) + 0.5, Math.round(b.top * zoom - sy) + 0.5, Math.round((b.right - b.left) * zoom) - shrink, Math.round((b.bottom - b.top) * zoom) - shrink);
  ctx.setLineDash([]);
}

/** The outline of a block of tiles. */
export function strokeTileRect(v: PaintView, r: TileRect, color: string, dash: readonly number[] | null = null) {
  const { ctx, tilePx, sx, sy } = v;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(dash ? [...dash] : []);
  ctx.strokeRect(Math.round(r.x0 * tilePx - sx) + 0.5, Math.round(r.y0 * tilePx - sy) + 0.5, Math.round((r.x1 - r.x0) * tilePx) - 1, Math.round((r.y1 - r.y0) * tilePx) - 1);
  ctx.setLineDash([]);
}

/** A small label on a dark plate off the bottom-right corner of a shape, in screen pixels: the size of what is being dragged. */
export function sizeChip(v: PaintView, label: string, right: number, bottom: number, color: string) {
  const { ctx } = v;
  ctx.font = `10px ${v.monoFont()}`;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = INK.plate;
  ctx.fillRect(right + 4, bottom + 4, tw + 8, 15);
  ctx.fillStyle = color;
  ctx.fillText(label, right + 8, bottom + 15);
}

/** A block of tiles being marked: a wash, a dashed outline and its label. */
export function markedTiles(v: PaintView, r: TileRect, wash: string, color: string, label: string, labelColor: string) {
  const { ctx, tilePx, sx, sy } = v;
  const mx = r.x0 * tilePx - sx, my = r.y0 * tilePx - sy, mw = (r.x1 - r.x0) * tilePx, mh = (r.y1 - r.y0) * tilePx;
  ctx.fillStyle = wash;
  ctx.fillRect(mx, my, mw, mh);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([...DASH.area]);
  ctx.strokeRect(Math.round(mx) + 0.5, Math.round(my) + 0.5, Math.round(mw) - 1, Math.round(mh) - 1);
  ctx.setLineDash([]);
  sizeChip(v, label, mx + mw, my + mh, labelColor);
}

/** A box in map pixels being dragged out: a wash and a dashed outline. Returns its far corner in screen pixels, for a label. */
export function draggedBox(v: PaintView, b: PixelBox, wash: string, color: string): { right: number; bottom: number } {
  const { ctx, zoom, sx, sy } = v;
  const x = b.left * zoom - sx, y = b.top * zoom - sy, w = (b.right - b.left) * zoom, h = (b.bottom - b.top) * zoom;
  ctx.fillStyle = wash;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([...DASH.selected]);
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  ctx.setLineDash([]);
  return { right: x + w, bottom: y + h };
}

/** The box-select rectangle of an object-layer drag, between two map points. */
export function drawMarquee(v: PaintView, from: { px: number; py: number }, to: { px: number; py: number }) {
  draggedBox(v, { left: Math.min(from.px, to.px), top: Math.min(from.py, to.py), right: Math.max(from.px, to.px), bottom: Math.max(from.py, to.py) }, "rgba(142,240,164,0.10)", INK.green);
}

/** `api.view.flash`: a box that swells a little and fades, gold for a change, teal for attention. */
export function drawFlashes(v: PaintView, flashes: readonly ViewFlash[], now: number) {
  const { ctx, zoom, sx, sy } = v;
  for (const f of flashes) {
    const t = Math.min(1, Math.max(0, (now - f.start) / f.ms));
    if (t >= 1) continue;
    const a = 1 - t;
    const grow = 2 + 6 * t;
    const [r, g, b] = f.kind === "attention" ? [79, 209, 197] : [230, 185, 92];
    const left = f.box.left * zoom - sx - grow, top = f.box.top * zoom - sy - grow;
    const w = (f.box.right - f.box.left) * zoom + grow * 2, h = (f.box.bottom - f.box.top) * zoom + grow * 2;
    ctx.fillStyle = `rgba(${r},${g},${b},${(0.22 * a).toFixed(3)})`;
    ctx.fillRect(left, top, w, h);
    ctx.strokeStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  }
}

/** A plugin's object pick: the unit or location under the pointer, outlined with its name above it. */
export function drawPickedObject(v: PaintView, box: PixelBox, label: string) {
  const { ctx, zoom, sx, sy } = v;
  const bx = box.left * zoom - sx, by = box.top * zoom - sy, bw = (box.right - box.left) * zoom, bh = (box.bottom - box.top) * zoom;
  ctx.strokeStyle = INK.tealPale;
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.max(2, Math.round(bw)), Math.max(2, Math.round(bh)));
  ctx.lineWidth = 1;
  ctx.font = `11px ${v.uiFont()}`;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(10,12,16,0.85)";
  ctx.fillRect(bx, by - 18, tw + 10, 16);
  ctx.fillStyle = INK.tealPale;
  ctx.fillText(label, bx + 5, by - 6);
}
