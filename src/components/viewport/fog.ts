/**
 * The fog of war overlay, drawn the way StarCraft shows ground it has explored but
 * cannot currently see: the terrain darkened through the tileset's `dark.pcx` remap.
 *
 * The game draws that state through row 18 of `tileset\<name>\dark.pcx`, a palette
 * remap that leaves roughly half the light with a slight blue bias. `FOG_TINT` holds
 * each tileset's mean per-channel ratio for that row (measured from the game's own
 * files); painting it with the `multiply` blend reproduces the remap's darkening
 * pixel for pixel, on units and overlays under the fog as well as on the ground.
 *
 * The section is tile-aligned, so the overlay is too, with one softening the game's
 * fog edges have: where two explored tiles meet a fogged corner the corner is cut at
 * 45°, and where two fogged tiles meet an explored corner the fog creeps in, so a
 * diagonal boundary reads as a line rather than a staircase.
 */
import type { Scenario } from "../../formats/chk/scenario";
import { playerBit } from "../../editor/fog";

/**
 * Mean RGB ratio of dark.pcx row 18 per tileset, in ERA order (badlands, platform,
 * install, ashworld, jungle, desert, ice, twilight), over palette entries 16–255.
 */
export const FOG_TINT: readonly (readonly [number, number, number])[] = [
  [0.517, 0.515, 0.580],
  [0.528, 0.532, 0.545],
  [0.530, 0.537, 0.545],
  [0.527, 0.534, 0.554],
  [0.521, 0.517, 0.569],
  [0.552, 0.568, 0.613],
  [0.660, 0.658, 0.708],
  [0.506, 0.493, 0.529],
];

/** The tint as a CSS colour, to be painted with the `multiply` blend. */
export function fogTintColor(tileset: number): string {
  const [r, g, b] = FOG_TINT[tileset & 7];
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

export interface FogView {
  /** Visible tile range, exclusive on the far side. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Screen pixels per tile and the scroll offset in screen pixels. */
  tilePx: number;
  sx: number;
  sy: number;
}

/** Darken `player`'s fogged tiles over whatever is on the canvas already. */
export function drawFogOverlay(ctx: CanvasRenderingContext2D, scn: Scenario, tileset: number, player: number, view: FogView) {
  const { width, height, mask } = scn;
  const bit = playerBit(player);
  const { x0, y0, x1, y1, tilePx, sx, sy } = view;
  // Outside the map counts as fogged so the edge of the map never gets a chamfer.
  const fogged = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height || !mask || (mask[y * width + x] & bit) !== 0;

  // Below a few pixels a tile the chamfers are sub-pixel noise; plain squares are faster.
  const chamfer = tilePx >= 6;
  const h = tilePx / 2;
  ctx.beginPath();
  for (let ty = y0; ty < y1; ty++) {
    const py = ty * tilePx - sy;
    for (let tx = x0; tx < x1; tx++) {
      const px = tx * tilePx - sx;
      const here = fogged(tx, ty);
      if (!chamfer) {
        if (here) ctx.rect(px, py, tilePx, tilePx);
        continue;
      }
      const n = fogged(tx, ty - 1), s = fogged(tx, ty + 1), w = fogged(tx - 1, ty), e = fogged(tx + 1, ty);
      if (here) {
        // A fogged tile: a square with each corner cut where both neighbours on it are explored.
        const nw = !n && !w, ne = !n && !e, se = !s && !e, sw = !s && !w;
        if (!nw && !ne && !se && !sw) { ctx.rect(px, py, tilePx, tilePx); continue; }
        if (nw) { ctx.moveTo(px, py + h); ctx.lineTo(px + h, py); } else ctx.moveTo(px, py);
        if (ne) { ctx.lineTo(px + tilePx - h, py); ctx.lineTo(px + tilePx, py + h); } else ctx.lineTo(px + tilePx, py);
        if (se) { ctx.lineTo(px + tilePx, py + tilePx - h); ctx.lineTo(px + tilePx - h, py + tilePx); } else ctx.lineTo(px + tilePx, py + tilePx);
        if (sw) { ctx.lineTo(px + h, py + tilePx); ctx.lineTo(px, py + tilePx - h); } else ctx.lineTo(px, py + tilePx);
        ctx.closePath();
      } else {
        // An explored tile: fog creeps into each corner where both neighbours on it are fogged.
        if (n && w) { ctx.moveTo(px, py); ctx.lineTo(px + h, py); ctx.lineTo(px, py + h); ctx.closePath(); }
        if (n && e) { ctx.moveTo(px + tilePx, py); ctx.lineTo(px + tilePx, py + h); ctx.lineTo(px + tilePx - h, py); ctx.closePath(); }
        if (s && e) { ctx.moveTo(px + tilePx, py + tilePx); ctx.lineTo(px + tilePx - h, py + tilePx); ctx.lineTo(px + tilePx, py + tilePx - h); ctx.closePath(); }
        if (s && w) { ctx.moveTo(px, py + tilePx); ctx.lineTo(px, py + tilePx - h); ctx.lineTo(px + h, py + tilePx); ctx.closePath(); }
      }
    }
  }
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = fogTintColor(tileset);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

/**
 * The same fog as an RGB image one pixel per tile for the minimap: the tint where
 * fogged, white elsewhere, meant to be drawn with the `multiply` blend.
 */
export function fogImageData(scn: Scenario, tileset: number, player: number): ImageData {
  const { width, height, mask } = scn;
  const bit = playerBit(player);
  const [r, g, b] = FOG_TINT[tileset & 7].map((v) => Math.round(v * 255));
  const img = new ImageData(width, height);
  for (let at = 0; at < width * height; at++) {
    const fogged = !mask || (mask[at] & bit) !== 0;
    const i = at * 4;
    img.data[i] = fogged ? r : 255;
    img.data[i + 1] = fogged ? g : 255;
    img.data[i + 2] = fogged ? b : 255;
    img.data[i + 3] = 255;
  }
  return img;
}
