/**
 * The ground: the terrain picture, and the elevation / buildability overlays that say what
 * its minitile flags mean. Both are a property of the tile, so both live in one cached
 * layer that a paint copies with a single `drawImage`.
 */
import type { RemasteredEffects } from "../../../editor/preferences";
import type { LoadedTileset } from "../../../formats/tileset/load";
import { atlasSource, atlasTileSize } from "../../../formats/tileset/atlas";
import { groupBuildable, groupHeight, megatileForTile, minitileHeight } from "../../../formats/tileset/decode";
import { HD_TILE_PX, hdSource, type HdEffects } from "../../../formats/tileset/hd";
import type { EffectPass } from "../effectPass";
import { hashNoise } from "../noise";
import { TILE, type PaintView } from "./view";

/** The cached ground and what it was drawn for. */
export interface GroundLayer {
  canvas: HTMLCanvasElement;
  scenario: unknown;
  tiles: ArrayLike<number>;
  assets: unknown;
  /** The scroll position the layer is drawn at, in whole device pixels. */
  ox: number;
  oy: number;
  w: number;
  h: number;
  dpr: number;
  tilePx: number;
  terrainRevision: number;
  doodadsRevision: number;
  elevation: boolean;
  buildability: boolean;
  /** The water-cycle step the layer's cycling tiles show. */
  step: number;
  /** Whether any visible tile cycles — what decides if a step repaints. */
  animated: boolean;
  /**
   * Remastered's moving water or lava (`effectPass.ts`): the effect the layer was drawn
   * for, and a second canvas kept in step with the first — white where the effect is,
   * black elsewhere, tile for tile. Null when the tileset has none or water is not animated.
   */
  effects: HdEffects | null;
  mask: HTMLCanvasElement | null;
  /** Counts every time the two canvases are drawn into, so the pass knows when to take them again. */
  version: number;
  /** Whether any visible tile takes the effect — what decides if the pass runs and frames repaint. */
  moving: boolean;
}

/** What Remastered's water and lava need of the viewport, when View ▸ Animate Water is on. */
export interface GroundMotion {
  /** The pass that moves them, made on first use; null where there is no WebGL. */
  pass(): EffectPass | null;
  /** Where the motion is, in seconds, already at the water speed. */
  seconds: number;
  tune: RemasteredEffects;
}

/** What a paint of the ground found in view. */
export interface GroundPaint {
  /** A tile that cycles its palette (classic water, lava): repaint when the cycle steps. */
  animated: boolean;
  /** Remastered's water or lava, moved by the pass: repaint every frame. */
  moving: boolean;
}

export interface Ground {
  scenario: unknown;
  /** MTXM, or TILE with View ▸ Doodads off. */
  tiles: ArrayLike<number>;
  assets: LoadedTileset;
  terrainRevision: number;
  doodadsRevision: number;
  /** View ▸ Elevation Overlay: ground height as a tint per minitile (mid amber, high red). */
  elevation: boolean;
  /** View ▸ Buildability Overlay: unbuildable groups washed and hatched in blue. */
  buildability: boolean;
  /** Set while View ▸ Animate Water is on; the 2x terrain's water and lava then move. */
  motion: GroundMotion | null;
}

const MID = "rgba(230,185,92,0.30)";
const HIGH = "rgba(240,90,90,0.32)";
const UNBUILDABLE = "rgba(80,140,240,0.26)";
const HATCH = "rgba(80,140,240,0.55)";

/**
 * The diagonal that marks an unbuildable tile, drawn once per tile size and stamped. A tile
 * is redrawn alone when it cycles or a scroll uncovers it, and it has to come out as it did
 * in a whole redraw to the last pixel — which one stroke through every tile of a pass does
 * not promise (how a path's edges are smoothed depends on the rest of the path), and a copy
 * of the same few pixels does. Half a line's width in from the corners, so the ends stay in
 * the tile.
 */
const hatches = new Map<string, HTMLCanvasElement>();
function hatchStamp(pw: number, ph: number, dpr: number): HTMLCanvasElement {
  const key = `${pw}|${ph}|${dpr}`;
  let stamp = hatches.get(key);
  if (!stamp) {
    // A size per zoom and display scale, two where a tile is a pixel wider here and there.
    if (hatches.size > 64) hatches.clear();
    stamp = document.createElement("canvas");
    stamp.width = pw;
    stamp.height = ph;
    const c = stamp.getContext("2d")!;
    c.strokeStyle = HATCH;
    c.lineWidth = dpr;
    c.beginPath();
    c.moveTo(dpr / 2, ph - dpr / 2);
    c.lineTo(pw - dpr / 2, dpr / 2);
    c.stroke();
    hatches.set(key, stamp);
  }
  return stamp;
}

/**
 * Bring the cached layer up to date and copy it to the canvas. Answers whether any visible
 * tile cycles (water, lava), which is what the animation loop needs to know.
 *
 * The layer is redrawn whole when the size, zoom, tiles or overlays change, shifted when the
 * view scrolls, and only its cycling tiles are redrawn when the water steps — so a paint
 * that changes nothing under the ground (a unit animation frame, a hover ghost, a selection)
 * costs one drawImage instead of a thousand.
 */
export function paintGround(v: PaintView, cache: { current: GroundLayer | null }, g: Ground): GroundPaint {
  const { ctx, sx, sy, dpr, tilePx, x0, y0, x1, y1, mapW } = v;
  const { tiles } = g;
  const { atlas, tileset: ts } = g.assets;
  const step = atlas.animation?.step ?? 0;
  // Remastered's water and lava move by bending the finished layer, so the layer needs
  // its mask beside it — only while water is animated, and not at the far zooms. The
  // overlays are part of the layer and bend with the water under them, which is as it should be.
  const effects: HdEffects | null = g.motion && tilePx >= 4 ? atlas.hd?.effects ?? null : null;
  let layer = cache.current;
  const sameGround = layer !== null && layer.scenario === g.scenario && layer.tiles === tiles && layer.assets === g.assets && layer.effects === effects &&
    layer.w === v.w && layer.h === v.h && layer.dpr === dpr && layer.tilePx === tilePx &&
    layer.terrainRevision === g.terrainRevision && layer.doodadsRevision === g.doodadsRevision &&
    layer.elevation === g.elevation && layer.buildability === g.buildability;
  // The layer sits at the scroll position rounded to a device pixel, and every tile at
  // its own place on the map rounded likewise. A tile's pixels then depend on the tile
  // alone, not on the scroll, so a scroll moves the picture by a whole number of
  // pixels and nothing else about it changes.
  const ox = Math.round(sx * dpr), oy = Math.round(sy * dpr);
  const same = sameGround && layer!.ox === ox && layer!.oy === oy;
  // A scroll over the same ground therefore shifts the layer and blits only the strips
  // the scroll uncovered, instead of every visible megatile.
  const dx = sameGround ? ox - layer!.ox : 0, dy = sameGround ? oy - layer!.oy : 0;
  // Not at a scale that enlarges a tile by anything but a whole factor (150%, or 100%
  // on a display scaled to 125%): the blit is unsmoothed there and half its samples
  // land exactly between two source pixels, where the side they fall depends on where
  // on the canvas the tile is — a tile that was moved and one drawn afresh would differ
  // by a pixel column here and there, and the next whole redraw would show it. (A
  // smoothed blit can still round a channel one step the other way; nothing shows.)
  // "Enlarges" is against the source's own size: the 2x pictures are 64 pixels a tile,
  // so they are being reduced (and smoothed) up to 200% and copied exactly there.
  const sourcePx = atlasTileSize(atlas);
  const exact = tilePx < sourcePx || Number.isInteger((tilePx * dpr) / sourcePx);
  const shifts = sameGround && !same && exact && Math.abs(dx) < layer!.canvas.width && Math.abs(dy) < layer!.canvas.height;
  if (!same && !shifts) {
    const canvas = layer?.canvas ?? document.createElement("canvas");
    // Whole device pixels: a fractional backing size would be truncated and the copy
    // below would then stretch the layer by a hair, doubling a row here and there.
    const devW = Math.round(v.w * dpr), devH = Math.round(v.h * dpr);
    if (canvas.width !== devW || canvas.height !== devH) {
      canvas.width = devW;
      canvas.height = devH;
    }
    let mask: HTMLCanvasElement | null = null;
    if (effects) {
      mask = layer?.mask ?? document.createElement("canvas");
      if (mask.width !== devW || mask.height !== devH) {
        mask.width = devW;
        mask.height = devH;
      }
    }
    layer = {
      canvas, scenario: g.scenario, tiles, assets: g.assets, ox, oy, w: v.w, h: v.h, dpr, tilePx,
      terrainRevision: g.terrainRevision, doodadsRevision: g.doodadsRevision, elevation: g.elevation, buildability: g.buildability,
      step, animated: false, effects, mask, version: (layer?.version ?? 0) + 1, moving: false,
    };
    cache.current = layer;
  }
  if (!same || layer!.step !== step) {
    const lc = layer!.canvas.getContext("2d")!;
    const devW = layer!.canvas.width, devH = layer!.canvas.height;
    // The mask is drawn tile for tile with the ground, in the same places, so the two
    // can never disagree about where the shore is.
    const mc = effects && layer!.mask ? layer!.mask.getContext("2d") : null;
    if (mc) {
      mc.setTransform(1, 0, 0, 1, 0, 0);
      mc.fillStyle = "#000";
    }
    let moving = false;
    layer!.version++;
    // The layer is drawn in device pixels, every tile snapped to whole ones: a tile
    // drawn at a fractional position (a fractional scroll offset, a display scaled to
    // 125%) is blended over its edges, and a hairline of the dark ground behind the
    // layer shows between it and its neighbour wherever the rounding lands the two
    // apart. Snapped, neighbours share an edge exactly; a tile is a device pixel
    // wider or narrower here and there, which nothing can see.
    lc.setTransform(1, 0, 0, 1, 0, 0);
    const devTile = tilePx * dpr;
    const snapX = (tx: number) => Math.round(tx * devTile) - ox;
    const snapY = (ty: number) => Math.round(ty * devTile) - oy;
    // Below ~4px a tile the atlas blit costs more than it shows, so fill with the
    // precomputed mean colour instead — and the overlays have nothing to say at that size.
    const flat = tilePx < 4;
    const perMini = tilePx / 4 >= 2;
    const hatched = g.buildability && tilePx >= 12;
    /**
     * What the overlays add to one tile, inside the tile's own pixels and nowhere else: a
     * tile is redrawn alone when it cycles or a scroll uncovers it, and anything that
     * spilled onto a neighbour would be laid down twice there.
     */
    const overlay = (id: number, megatile: number, px: number, py: number, pw: number, ph: number) => {
      if (g.elevation && megatile >= 0) {
        if (perMini) {
          for (let m = 0; m < 16; m++) {
            const height = minitileHeight(ts, megatile, m);
            if (height === 0) continue;
            const col = m & 3, row = m >> 2;
            const mx = px + Math.round((col * pw) / 4), my = py + Math.round((row * ph) / 4);
            lc.fillStyle = height === 2 ? HIGH : MID;
            lc.fillRect(mx, my, px + Math.round(((col + 1) * pw) / 4) - mx, py + Math.round(((row + 1) * ph) / 4) - my);
          }
        } else {
          const height = groupHeight(ts.groups[id >> 4] ?? ts.groups[0]);
          if (height > 0) { lc.fillStyle = height === 2 ? HIGH : MID; lc.fillRect(px, py, pw, ph); }
        }
      }
      if (g.buildability) {
        const group = ts.groups[id >> 4];
        if (group && !groupBuildable(group)) {
          lc.fillStyle = UNBUILDABLE;
          lc.fillRect(px, py, pw, ph);
          if (hatched) lc.drawImage(hatchStamp(pw, ph, dpr), px, py);
        }
      }
    };
    const overlays = !flat && (g.elevation || g.buildability);
    /** Blit the tiles of a block of the map — all of them, or only the ones that cycle — and say whether any cycles. */
    const blitTiles = (tx0: number, ty0: number, tx1: number, ty1: number, onlyAnimated: boolean): boolean => {
      let animated = false;
      lc.imageSmoothingEnabled = tilePx < sourcePx;
      if (mc) mc.imageSmoothingEnabled = tilePx < HD_TILE_PX;
      for (let ty = ty0; ty < ty1; ty++) {
        const row = ty * mapW;
        const py = snapY(ty), ph = snapY(ty + 1) - py;
        for (let tx = tx0; tx < tx1; tx++) {
          const id = tiles[row + tx];
          const megatile = megatileForTile(ts, id);
          const px = snapX(tx), pw = snapX(tx + 1) - px;
          if (mc && effects && !onlyAnimated) {
            const picture = megatile >= 0 && effects.maskOf[megatile] >= 0 ? hdSource(effects.masks, effects.maskOf[megatile]) : null;
            if (picture) {
              mc.drawImage(picture.image, picture.sx, picture.sy, HD_TILE_PX, HD_TILE_PX, px, py, pw, ph);
              moving = true;
            } else {
              mc.fillRect(px, py, pw, ph);
            }
          }
          if (megatile < 0) {
            if (onlyAnimated) continue;
            lc.fillStyle = "#000";
            lc.fillRect(px, py, pw, ph);
          } else if (flat) {
            if (onlyAnimated) continue;
            const rgb = atlas.averages[megatile];
            lc.fillStyle = `rgb(${rgb >> 16},${(rgb >> 8) & 255},${rgb & 255})`;
            lc.fillRect(px, py, pw, ph);
          } else {
            const src = atlasSource(atlas, megatile);
            if (src.animated) animated = true;
            else if (onlyAnimated) continue;
            lc.drawImage(src.image, src.sx, src.sy, src.size, src.size, px, py, pw, ph);
          }
          if (overlays) overlay(id, megatile, px, py, pw, ph);
        }
      }
      return animated;
    };
    if (same) {
      // A step change redraws only the tiles that cycle; everything else is still right.
      layer!.animated = blitTiles(x0, y0, x1, y1, true);
    } else if (shifts) {
      // "copy" replaces what is there, so the part the shifted picture no longer
      // covers comes out clear rather than keeping what was drawn before.
      lc.globalCompositeOperation = "copy";
      lc.imageSmoothingEnabled = false;
      lc.drawImage(layer!.canvas, -dx, -dy);
      lc.globalCompositeOperation = "source-over";
      if (mc && layer!.mask) {
        mc.globalCompositeOperation = "copy";
        mc.imageSmoothingEnabled = false;
        mc.drawImage(layer!.mask, -dx, -dy);
        mc.globalCompositeOperation = "source-over";
      }
      // Only ever raised on a shift, like `animated` below.
      moving = layer!.moving;
      layer!.ox = ox;
      layer!.oy = oy;
      // The tiles under an uncovered strip, a tile to spare each way: one that straddles
      // the strip's edge is drawn again whole, over the same pixels it already had.
      const tileSpan = (from: number, to: number, origin: number, lo: number, hi: number): [number, number] =>
        [Math.max(lo, Math.floor((from + origin) / devTile) - 1), Math.min(hi, Math.ceil((to + origin) / devTile) + 1)];
      let animated = layer!.animated;
      if (dx !== 0) {
        const [tx0, tx1] = dx > 0 ? tileSpan(devW - dx, devW, ox, x0, x1) : tileSpan(0, -dx, ox, x0, x1);
        if (blitTiles(tx0, y0, tx1, y1, false)) animated = true;
      }
      if (dy !== 0) {
        const [ty0, ty1] = dy > 0 ? tileSpan(devH - dy, devH, oy, y0, y1) : tileSpan(0, -dy, oy, y0, y1);
        if (blitTiles(x0, ty0, x1, ty1, false)) animated = true;
      }
      // Only ever raised here — the tiles that left are not counted out — and put
      // right by the next step, which looks at every visible tile.
      layer!.animated = animated;
      // The kept part still shows the step it was drawn at.
      if (layer!.step !== step) layer!.animated = blitTiles(x0, y0, x1, y1, true);
    } else {
      lc.clearRect(0, 0, devW, devH);
      mc?.fillRect(0, 0, devW, devH);
      layer!.animated = blitTiles(x0, y0, x1, y1, false);
    }
    layer!.step = step;
    if (!same) layer!.moving = moving;
  }
  // With water or lava in view, the layer goes through the pass that moves it and the
  // result is drawn in its place; without a pass (no WebGL) the layer is drawn as it is.
  let picture: CanvasImageSource = layer!.canvas;
  let moved = false;
  if (effects && g.motion && layer!.mask && layer!.moving) {
    const scale = (tilePx / TILE) * dpr;
    const out = g.motion.pass()?.draw(layer!.canvas, layer!.mask, layer!.version, effects, { originX: ox / scale, originY: oy / scale, scale }, g.motion.seconds, g.motion.tune) ?? null;
    if (out) {
      picture = out;
      moved = true;
    }
  }
  // Device pixel for device pixel: no resampling of the layer on its way to the screen.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(picture, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { animated: layer!.animated, moving: moved };
}

/** Map open, graphics still coming: a calm plate under the loading overlay. Anything tile-shaped here would just be wrong terrain for a moment. */
export function paintLoadingPlate(v: PaintView) {
  v.ctx.fillStyle = "#12161d";
  v.ctx.fillRect(-v.sx, -v.sy, v.worldW, v.worldH);
}

/** No map or no tileset graphics installed: flat tileset colour with light noise. */
export function paintFlatGround(v: PaintView, color: string) {
  const { ctx, sx, sy, tilePx } = v;
  const base = parseInt(color.slice(1), 16);
  const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255;
  ctx.fillStyle = color;
  ctx.fillRect(-sx, -sy, v.worldW, v.worldH);
  if (tilePx < 4) return;
  for (let ty = v.y0; ty < v.y1; ty++) {
    for (let tx = v.x0; tx < v.x1; tx++) {
      const n = (hashNoise(tx, ty) - 0.5) * 0.12 + (hashNoise(tx >> 2, ty >> 2) - 0.5) * 0.16;
      const k = 1 + n;
      ctx.fillStyle = `rgb(${br * k | 0},${bg * k | 0},${bb * k | 0})`;
      ctx.fillRect(tx * tilePx - sx, ty * tilePx - sy, tilePx + 0.5, tilePx + 0.5);
    }
  }
}
