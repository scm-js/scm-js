/** The grid and the rulers: the two things that only measure the map. */
import type { GridLook } from "../../../atoms/preferencesAtoms";
import { TILE, type PaintView } from "./view";

/** View ▸ Grid: Preferences ▸ Editing picks the spacing, colour, opacity and style (lines / dots / crosses). */
export function drawGrid(v: PaintView, gridSize: number, look: GridLook) {
  const { ctx, sx, sy, worldW, worldH } = v;
  const step = (gridSize / TILE) * v.tilePx;
  if (step < 6) return;
  ctx.strokeStyle = look.color;
  ctx.fillStyle = look.color;
  ctx.globalAlpha = (look.opacity / 100) * (step >= 16 ? 1 : 0.65);
  ctx.lineWidth = 1;
  const gx0 = Math.floor(sx / step) * step, gx1 = Math.min(worldW, sx + v.w);
  const gy0 = Math.floor(sy / step) * step, gy1 = Math.min(worldH, sy + v.h);
  ctx.beginPath();
  if (look.style === "lines") {
    for (let gx = gx0; gx <= gx1; gx += step) {
      const px = Math.round(gx - sx) + 0.5;
      ctx.moveTo(px, Math.max(0, -sy));
      ctx.lineTo(px, Math.min(v.h, worldH - sy));
    }
    for (let gy = gy0; gy <= gy1; gy += step) {
      const py = Math.round(gy - sy) + 0.5;
      ctx.moveTo(Math.max(0, -sx), py);
      ctx.lineTo(Math.min(v.w, worldW - sx), py);
    }
    ctx.stroke();
  } else {
    const arm = look.style === "crosses" ? Math.max(2, Math.min(6, step / 6)) : 0;
    for (let gx = gx0; gx <= gx1; gx += step) {
      for (let gy = gy0; gy <= gy1; gy += step) {
        const px = Math.round(gx - sx), py = Math.round(gy - sy);
        if (arm > 0) {
          ctx.moveTo(px - arm, py + 0.5); ctx.lineTo(px + arm + 1, py + 0.5);
          ctx.moveTo(px + 0.5, py - arm); ctx.lineTo(px + 0.5, py + arm + 1);
        } else {
          ctx.rect(px - 0.5, py - 0.5, 2, 2);
        }
      }
    }
    if (arm > 0) ctx.stroke(); else ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * One ruler, redrawn only when what it shows moved. A ruler shows the scroll, the scale and
 * the tile under the pointer along its own axis; most paints (an animation frame, a ghost
 * following the pointer inside one tile, a scroll along the other axis) change none of
 * them, and `keys` remembers what each was last drawn for.
 */
export function drawRuler(v: PaintView, c: HTMLCanvasElement | null, horizontal: boolean, hover: { x: number; y: number } | null, keys: { top: string; left: string }) {
  if (!c) return;
  const { dpr, tilePx } = v;
  const len = horizontal ? v.w : v.h;
  const scroll = horizontal ? v.sx : v.sy;
  const tiles = horizontal ? v.mapW : v.mapH;
  const key = `${len}|${dpr}|${scroll}|${tilePx}|${tiles}|${hover ? (horizontal ? hover.x : hover.y) : ""}`;
  const side = horizontal ? "top" : "left";
  if (keys[side] === key) return;
  keys[side] = key;
  const labelEvery = [1, 2, 4, 8, 16, 32].find((n) => n * tilePx >= 40) ?? 32;
  const tick = tilePx >= 8 ? 1 : labelEvery / 2;
  // Setting a canvas's size reallocates it, even to the size it has.
  const cw = Math.floor((horizontal ? len : 20) * dpr), ch = Math.floor((horizontal ? 20 : len) * dpr);
  if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
  const rc = c.getContext("2d")!;
  rc.setTransform(dpr, 0, 0, dpr, 0, 0);
  rc.fillStyle = "#191d25";
  rc.fillRect(0, 0, horizontal ? len : 20, horizontal ? 20 : len);
  rc.font = `9.5px ${v.monoFont()}`;
  rc.textAlign = "left";
  rc.fillStyle = "#99a2b3";
  rc.strokeStyle = "#3b4453";
  rc.lineWidth = 1;
  rc.beginPath();
  for (let t = Math.floor(scroll / tilePx / tick) * tick; t <= tiles; t += tick) {
    const p = Math.round(t * tilePx - scroll) + 0.5;
    if (p < 0 || p > len) continue;
    const major = t % labelEvery === 0;
    const l = major ? 8 : 4;
    if (horizontal) { rc.moveTo(p, 20); rc.lineTo(p, 20 - l); } else { rc.moveTo(20, p); rc.lineTo(20 - l, p); }
    if (major && t < tiles) {
      if (horizontal) rc.fillText(String(t), p + 3, 9);
      else {
        rc.save();
        rc.translate(9, p + 3);
        rc.rotate(-Math.PI / 2);
        rc.textAlign = "right";
        rc.fillText(String(t), 0, 0);
        rc.restore();
      }
    }
  }
  rc.stroke();
  if (hover) {
    rc.fillStyle = "rgba(230,185,92,0.35)";
    const p = (horizontal ? hover.x : hover.y) * tilePx - scroll;
    if (horizontal) rc.fillRect(p, 0, tilePx, 20); else rc.fillRect(0, p, 20, tilePx);
  }
}

/** Tools ▸ Symmetry…: the mirror lines the brushes paint and the palettes place across, and the centre a rotation turns about. */
export function drawSymmetryAxes(v: PaintView, axes: { lines: readonly { x0: number; y0: number; x1: number; y1: number }[]; centre: boolean }) {
  const { ctx, sx, sy, tilePx } = v;
  ctx.strokeStyle = "rgba(142,240,164,0.85)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  for (const l of axes.lines) {
    ctx.moveTo(Math.round(l.x0 * tilePx - sx) + 0.5, Math.round(l.y0 * tilePx - sy) + 0.5);
    ctx.lineTo(Math.round(l.x1 * tilePx - sx) + 0.5, Math.round(l.y1 * tilePx - sy) + 0.5);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (axes.centre) {
    const cx = (v.mapW / 2) * tilePx - sx, cy = (v.mapH / 2) * tilePx - sy;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
    ctx.stroke();
  }
}
