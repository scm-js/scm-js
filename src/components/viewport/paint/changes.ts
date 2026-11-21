/**
 * View ▸ Differences: what differs between the open map and the one it is compared with
 * (editor/compare.ts), drawn over the map. The colours are the ones `scmjs map diff
 * --picture` uses, so a picture in a review and the editor read alike: magenta ground,
 * green for what this map has and the other has not, red for what only the other has
 * (drawn where it was), yellow for what moved or changed.
 */
import { TILE_KIND as KIND, type DiffChanges } from "../../../editor/compare";
import { unitBox, unitGeometry } from "../../../editor/units";
import { ANYWHERE_INDEX, type LocationRecord } from "../../../formats/chk/sections/objects";
import type { UnitsDat } from "../../../formats/dat/dat";
import type { PaintView, PixelBox } from "./view";

export const CHANGE_INK = { added: "#2ee65a", removed: "#ff3b3b", moved: "#ffd21f", changed: "#ffd21f" } as const;
const TILE_WASH = "rgba(255,43,214,0.34)";
const TILE_EDGE = "rgba(255,43,214,0.9)";
/** Tiles only this map has: the other is smaller. */
const NEW_GROUND = "rgba(255,255,255,0.16)";
/** A mark is never smaller than this on screen, so a marine still shows with the whole map in view. */
const MIN_PX = 7;

/** A box in map pixels as a rectangle on the canvas, grown about its middle to `MIN_PX`. */
function screenBox(v: PaintView, b: PixelBox): { x: number; y: number; w: number; h: number } {
  let x = b.left * v.zoom - v.sx, y = b.top * v.zoom - v.sy, w = (b.right - b.left) * v.zoom, h = (b.bottom - b.top) * v.zoom;
  if (w < MIN_PX) { x -= (MIN_PX - w) / 2; w = MIN_PX; }
  if (h < MIN_PX) { y -= (MIN_PX - h) / 2; h = MIN_PX; }
  return { x: Math.round(x) + 0.5, y: Math.round(y) + 0.5, w: Math.round(w), h: Math.round(h) };
}

const locationBox = (l: LocationRecord): PixelBox => ({ left: Math.min(l.left, l.right), top: Math.min(l.top, l.bottom), right: Math.max(l.left, l.right), bottom: Math.max(l.top, l.bottom) });

/**
 * The ground that differs, under the units. `ground` false leaves it out: the maps are of
 * two tilesets, whose tile numbers cannot be compared.
 */
export function drawChangedGround(v: PaintView, d: DiffChanges, ground: boolean): void {
  const { ctx, tilePx, sx, sy } = v;
  for (let ty = v.y0; ty < Math.min(v.y1, d.height); ty++) {
    for (let tx = v.x0; tx < Math.min(v.x1, d.width); tx++) {
      const kind = d.tiles[ty * d.width + tx];
      if (kind !== KIND.bOnly && !(ground && kind === KIND.changed)) continue;
      const px = Math.round(tx * tilePx - sx), py = Math.round(ty * tilePx - sy);
      const pw = Math.round((tx + 1) * tilePx - sx) - px, ph = Math.round((ty + 1) * tilePx - sy) - py;
      ctx.fillStyle = kind === KIND.changed ? TILE_WASH : NEW_GROUND;
      ctx.fillRect(px, py, pw, ph);
      // A corner tab, which still reads when the wash is lost on bright ground.
      if (kind === KIND.changed && tilePx >= 12) {
        const tab = Math.max(2, Math.round(pw / 4));
        ctx.fillStyle = TILE_EDGE;
        ctx.beginPath();
        ctx.moveTo(px + pw, py);
        ctx.lineTo(px + pw - tab, py);
        ctx.lineTo(px + pw, py + tab);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

/** The units and locations that differ, over everything the map draws of its own. */
export function drawChangedObjects(v: PaintView, d: DiffChanges, units: UnitsDat | null): void {
  const { ctx } = v;
  ctx.lineWidth = 1;
  const frame = (b: PixelBox, color: string, fill: boolean, dashed: boolean) => {
    const r = screenBox(v, b);
    if (r.x > v.w || r.y > v.h || r.x + r.w < 0 || r.y + r.h < 0) return;
    if (fill) { ctx.globalAlpha = 0.3; ctx.fillStyle = color; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.globalAlpha = 1; }
    // A dark line outside the coloured one keeps it legible over bright ground.
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    ctx.strokeStyle = color;
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
  };
  for (const l of d.locations) {
    if (l.index === ANYWHERE_INDEX) continue;
    // Where it was, when it is somewhere else now or gone.
    if (l.a && l.change !== "added") frame(locationBox(l.a), CHANGE_INK.removed, false, true);
    if (l.b && l.change !== "removed") frame(locationBox(l.b), CHANGE_INK[l.change], false, false);
  }
  for (const u of d.units) {
    const g = unitGeometry(units, u.unitId);
    if (u.from) {
      frame(unitBox(g, u.from.x, u.from.y), CHANGE_INK.moved, false, true);
      ctx.strokeStyle = CHANGE_INK.moved;
      ctx.beginPath();
      ctx.moveTo(u.from.x * v.zoom - v.sx, u.from.y * v.zoom - v.sy);
      ctx.lineTo(u.x * v.zoom - v.sx, u.y * v.zoom - v.sy);
      ctx.stroke();
    }
    frame(unitBox(g, u.x, u.y), CHANGE_INK[u.change], true, u.change === "removed");
  }
}
