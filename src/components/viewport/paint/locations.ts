/** Locations and start locations: the two things on a map that are places rather than objects. */
import type { ViewLocation, ViewStartLocation } from "../../../atoms/documentAtoms";
import { HANDLES, handlePoint } from "../../../editor/locations";
import { INK, type PaintView, type PixelBox } from "./view";

/**
 * The width of a name in a font. A map's location names are the same from paint to paint
 * and there can be a couple of hundred on screen, each measured for its plate — at the
 * rate units animate, that was the paint's largest fixed cost.
 */
const widths = new Map<string, number>();
// A web font arriving changes every width measured with its fallback.
if (typeof document !== "undefined") document.fonts?.addEventListener?.("loadingdone", () => widths.clear());
function textWidth(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const key = `${font}\n${text}`;
  let w = widths.get(key);
  if (w === undefined) {
    // Names come and go as a map is edited and the font follows the zoom; start over rather than grow without end.
    if (widths.size > 4096) widths.clear();
    w = ctx.measureText(text).width;
    widths.set(key, w);
  }
  return w;
}

/**
 * StarEdit's translucent plates with the name in the corner; overlaps stack darker, the
 * selection goes gold, the one under the pointer lights up. Anywhere (slot 63) is not in
 * the list — it is the whole map.
 */
export function drawLocations(v: PaintView, locations: readonly ViewLocation[], opts: { selected: ReadonlySet<number>; hover: number; names: boolean }) {
  const { ctx, zoom, sx, sy, tilePx } = v;
  const fontPx = Math.max(10, Math.min(13, tilePx * 0.4));
  const font = `${fontPx}px ${v.uiFont()}`;
  ctx.font = font;
  ctx.lineWidth = 1;
  for (const l of locations) {
    const lx = l.left * zoom - sx, ly = l.top * zoom - sy, lw = (l.right - l.left) * zoom, lh = (l.bottom - l.top) * zoom;
    if (lx > v.w || ly > v.h || lx + lw < 0 || ly + lh < 0) continue;
    const sel = opts.selected.has(l.index), hot = l.index === opts.hover;
    ctx.fillStyle = sel ? "rgba(230,185,92,0.22)" : hot ? "rgba(79,209,197,0.20)" : "rgba(79,209,197,0.13)";
    ctx.fillRect(lx, ly, lw, lh);
    const bx = Math.round(lx) + 0.5, by = Math.round(ly) + 0.5, bw = Math.round(lw), bh = Math.round(lh);
    // A dark hairline inside the coloured edge keeps the box legible over bright ground.
    if (bw > 2 && bh > 2) {
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    }
    ctx.strokeStyle = sel ? INK.goldPale : hot ? INK.tealPale : "rgba(79,209,197,0.9)";
    ctx.strokeRect(bx, by, Math.max(1, bw), Math.max(1, bh));
    if (opts.names && tilePx >= 8) {
      const tw = textWidth(ctx, font, l.name);
      const plateH = fontPx + 5;
      ctx.fillStyle = sel ? "rgba(58,44,10,0.85)" : "rgba(10,12,16,0.78)";
      ctx.fillRect(lx + 1, ly + 1, tw + 8, plateH);
      // An elevation-restricted location gets an amber tab on its plate.
      if (l.elevationFlags !== 0) {
        ctx.fillStyle = "#e0a545";
        ctx.fillRect(lx + 1, ly + 1, 2, plateH);
      }
      ctx.fillStyle = sel ? INK.goldPale : INK.tealPale;
      ctx.fillText(l.name, lx + 5, ly + 1 + fontPx);
    }
  }
}

/** The eight resize handles of the one selected location. */
export function drawLocationHandles(v: PaintView, bounds: PixelBox) {
  const { ctx, zoom, sx, sy } = v;
  ctx.lineWidth = 1;
  for (const h of HANDLES) {
    const p = handlePoint(bounds, h);
    const hx = Math.round(p.x * zoom - sx), hy = Math.round(p.y * zoom - sy);
    ctx.fillStyle = INK.goldPale;
    ctx.fillRect(hx - 3, hy - 3, 7, 7);
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeRect(hx - 3.5, hy - 3.5, 8, 8);
  }
}

/** Each player's start location: a disc in the player's colour with the player's number. */
export function drawStartLocations(v: PaintView, starts: readonly ViewStartLocation[], colorOf: (owner: number) => string) {
  const { ctx, sx, sy, tilePx } = v;
  for (const s of starts) {
    const cx = s.x * tilePx - sx, cy = s.y * tilePx - sy, r = tilePx * 1.5;
    if (cx + r < 0 || cy + r < 0 || cx - r > v.w || cy - r > v.h) continue;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = colorOf(s.player) + "55";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colorOf(s.player);
    ctx.stroke();
    if (tilePx >= 12) {
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.max(10, tilePx * 0.5)}px ${v.uiFont()}`;
      ctx.textAlign = "center";
      ctx.fillText(String(s.player + 1), cx, cy + tilePx * 0.18);
      ctx.textAlign = "left";
    }
  }
}
