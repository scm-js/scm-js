import type { Anim } from "../dat/anim";
import { DrawFunction, NO_UNIT, RANDOM_DIRECTION } from "../dat/dat";
import { drawGrpFrame, facingFrame } from "../dat/grp";
import { decodeDxtRect, parseDds, type DdsImage } from "../dds";
import { hdSprites, imageGrpPath, requestAnim, requestGrp, requestRemap, unitImageId, type UnitAssets } from "./load";
import { teamColorKey, teamColorLut, teamColorPalette, tunitRamp, type TeamColorSpec } from "./teamColor";
import { LruCache } from "../../lib/lru";

/**
 * One frame of one image rendered for one team colour and palette, as a canvas the size
 * of the GRP's full box (so it is drawn centred on the image's position).
 */
export interface ImageFrame {
  image: HTMLCanvasElement;
  /**
   * The box in map pixels — what the frame is drawn at, centred on the image's position.
   * Not the canvas's own size: see `scale`.
   */
  width: number;
  height: number;
  /**
   * Canvas pixels per map pixel: 1 for a GRP, 2 for a StarCraft: Remastered sprite. Every
   * draw gives the destination size from `width` / `height`, so only a caller that reads
   * the canvas's own pixels, or decides on smoothing, needs it.
   */
  scale: number;
  /** Fire and other remapped effects brighten what is under them rather than covering it. */
  additive: boolean;
  /** The part of the canvas the frame's pixels are in, in canvas pixels, where that is known without the GRP (a 2x sprite). */
  opaque?: { x: number; y: number; width: number; height: number };
}

/** Kept for callers that only need the unit's default picture. */
export type UnitSprite = ImageFrame;

/**
 * Rendered frames, bounded by pixel memory rather than count: unit animation asks for a
 * new frame every game tick and a map with eight players multiplies every frame by colour,
 * so an unbounded map grew for as long as the map stayed open. 64 MB of RGBA is on the
 * order of four thousand unit frames; the oldest go first and are simply drawn again.
 */
export const FRAME_CACHE_BUDGET = 64 * 1024 * 1024;
const cache = new LruCache<string, ImageFrame>(FRAME_CACHE_BUDGET, (f) => f.width * f.height * f.scale * f.scale * 4, (f) => {
  // Let the browser release the bitmap now rather than when the GC gets round to the canvas.
  f.image.width = 0;
  f.image.height = 0;
});

/** How much the frame cache holds, for the About dialog's memory line and tests. */
export function frameCacheUsage(): { frames: number; bytes: number; budget: number } {
  return { frames: cache.size, bytes: cache.used, budget: cache.budget };
}

/**
 * Drop every cached frame. The keys are image ids and palette *names*, not the objects
 * behind them, so after a switch to another data set (whose image 0 may be a different
 * picture) the cache would answer with the old set's pixels — this is what a switch calls.
 */
export function clearFrameCache(): void {
  cache.clear();
}

const luts = new Map<string, Uint8Array>();
const teamPalettes = new Map<string, Uint8Array>();
const remapPalettes = new Map<string, Uint8Array>();

/**
 * The frame the editor shows: the unit's default facing for directional GRPs (a random
 * facing is shown as "up", frame 0, which is also what buildings and doodads use).
 */
export function editorFrame(assets: UnitAssets, unitId: number, imageId: number): { frame: number; flip: boolean } {
  if (!assets.images.graphicTurns[imageId]) return { frame: 0, flip: false };
  const direction = assets.units.direction[unitId];
  return facingFrame(direction === RANDOM_DIRECTION ? 0 : direction);
}

/**
 * How a team colour is applied: a `tunit.pcx` row is an index remap (`lut`) and the same
 * on every tileset; an RGB with no row is drawn through a copy of the tileset palette
 * with slots 8–15 overridden (`palette`), cached per tileset.
 */
function teamPaint(assets: UnitAssets, palette: Uint8Array, paletteKey: string, spec: TeamColorSpec): { lut: Uint8Array | null; palette: Uint8Array } {
  if ("row" in spec) {
    const key = teamColorKey(spec);
    let lut = luts.get(key);
    if (!lut) {
      lut = teamColorLut(tunitRamp(assets.teamColors, spec.row));
      luts.set(key, lut);
    }
    return { lut, palette };
  }
  const key = `${paletteKey}:${teamColorKey(spec)}`;
  let p = teamPalettes.get(key);
  if (!p) {
    p = teamColorPalette(palette, spec.rgb);
    teamPalettes.set(key, p);
  }
  return { lut: null, palette: p };
}

/**
 * The palette a remapped image draws through. The game looks the effect's pixel up in a
 * 256-column table against the pixel already on screen; the editor composites in RGB, so
 * it takes the "over black" column and blends additively, which reads the same for fire.
 * Without the table (an older tileset extraction) a synthetic ramp stands in.
 */
function remapPalette(palette: Uint8Array, paletteKey: string, remapping: number, table: Uint8Array | null): Uint8Array {
  const key = `${paletteKey}:${remapping}:${table ? "t" : "f"}`;
  const hit = remapPalettes.get(key);
  if (hit) return hit;
  const out = new Uint8Array(1024);
  const rows = table ? Math.floor(table.length / 256) : 0;
  for (let i = 0; i < 256; i++) {
    if (table && i < rows) {
      const c = table[i * 256];
      out.set(palette.subarray(c * 4, c * 4 + 4), i * 4);
    } else if (!table && i > 0 && i < 64) {
      // A plausible ramp: dark → bright with the index, warm for fire, cool for the blue tables.
      const t = i / 63;
      const blue = remapping === 4;
      out[i * 4] = Math.round(255 * (blue ? t * t : Math.min(1, t * 1.6)));
      out[i * 4 + 1] = Math.round(255 * (blue ? Math.min(1, t * 1.3) : t * t));
      out[i * 4 + 2] = Math.round(255 * (blue ? Math.min(1, 0.4 + t) : Math.max(0, t - 0.7) * 3));
      out[i * 4 + 3] = 255;
    } else {
      out.set(palette.subarray(i * 4, i * 4 + 4), i * 4);
    }
  }
  remapPalettes.set(key, out);
  return out;
}

/* ── Remastered sprites ─────────────────────────────────── */

/** An anim's two pictures, found once. `team` is null for the many images with nothing to colour. */
const animPictures = new WeakMap<Anim, { diffuse: DdsImage; team: DdsImage | null } | null>();

function picturesOf(anim: Anim): { diffuse: DdsImage; team: DdsImage | null } | null {
  let found = animPictures.get(anim);
  if (found === undefined) {
    const layer = (name: string) => {
      const l = anim.layers.find((x) => x.name === name);
      return l && l.size > 0 ? parseDds(anim.bytes, l.offset, l.size) : null;
    };
    const diffuse = layer("diffuse");
    found = diffuse ? { diffuse, team: layer("teamcolor") } : null;
    animPictures.set(anim, found);
  }
  return found;
}

/**
 * The colour a player's units take in a 2x sprite. The classic graphics shade a team
 * colour through eight palette entries; here the sprite carries its own shading and is
 * multiplied by one colour, so it is the brightest of the eight (which for the game's own
 * rows is the colour itself — 244, 4, 4 for red).
 */
function teamRgb(assets: UnitAssets, palette: Uint8Array, spec: TeamColorSpec): readonly [number, number, number] {
  if ("rgb" in spec) return spec.rgb;
  const at = tunitRamp(assets.teamColors, spec.row)[0] * 4;
  return [palette[at], palette[at + 1], palette[at + 2]];
}

/**
 * One frame of a 2x sprite as a canvas the size of the image's box, as `getImageFrame`
 * makes one from a GRP. Only the frame's own rectangle of the sheet is decoded.
 */
function drawAnimFrame(anim: Anim, index: number, flip: boolean, team: readonly [number, number, number] | null, shadow: boolean, additive: boolean): ImageFrame | null {
  const pictures = picturesOf(anim);
  if (!pictures || anim.frames.length === 0 || typeof document === "undefined") return null;
  // A few files give no box (the start location's is one), and without it there is nothing
  // to centre the frame in: those images are drawn from their GRP.
  if (anim.width <= 0 || anim.height <= 0) return null;
  const f = anim.frames[Math.min(index, anim.frames.length - 1)];
  const width = Math.max(1, Math.ceil(anim.width)), height = Math.max(1, Math.ceil(anim.height));
  const fw = Math.min(f.width, width), fh = Math.min(f.height, height);
  const pixels = new ImageData(width, height);
  if (fw > 0 && fh > 0) {
    const rgba = new Uint8ClampedArray(fw * fh * 4);
    decodeDxtRect(anim.bytes, pictures.diffuse, f.x, f.y, fw, fh, rgba);

    if (shadow) {
      // The same half-transparent black the classic shadows get, through the sprite's own soft edge.
      for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] >>= 1; }
    } else if (team && pictures.team) {
      // The mask can be kept smaller than the colour picture; it is read at its own scale.
      const mask = pictures.team;
      const kx = mask.width / pictures.diffuse.width, ky = mask.height / pictures.diffuse.height;
      const mx = Math.floor(f.x * kx), my = Math.floor(f.y * ky);
      const mw = Math.max(1, Math.ceil((f.x + fw) * kx) - mx), mh = Math.max(1, Math.ceil((f.y + fh) * ky) - my);
      const m = new Uint8ClampedArray(mw * mh * 4);
      decodeDxtRect(anim.bytes, mask, mx, my, mw, mh, m);
      for (let y = 0; y < fh; y++) {
        const row = Math.min(mh - 1, Math.floor((f.y + y) * ky) - my) * mw;
        for (let x = 0; x < fw; x++) {
          const amount = m[(row + Math.min(mw - 1, Math.floor((f.x + x) * kx) - mx)) * 4];
          if (amount === 0) continue;
          const at = (y * fw + x) * 4;
          for (let c = 0; c < 3; c++) rgba[at + c] = (rgba[at + c] * (255 - amount) + (rgba[at + c] * team[c] * amount) / 255) / 255;
        }
      }
    }

    // Into the box at the frame's offset; mirrored, the offset is measured from the other side.
    const dx = Math.max(0, Math.min(width - fw, Math.round(flip ? anim.width - f.offsetX - f.width : f.offsetX)));
    const dy = Math.max(0, Math.min(height - fh, Math.round(f.offsetY)));
    for (let y = 0; y < fh; y++) {
      const from = y * fw * 4, to = ((dy + y) * width + dx) * 4;
      if (!flip) {
        pixels.data.set(rgba.subarray(from, from + fw * 4), to);
      } else {
        for (let x = 0; x < fw; x++) {
          const s = from + (fw - 1 - x) * 4, d = to + x * 4;
          pixels.data[d] = rgba[s]; pixels.data[d + 1] = rgba[s + 1]; pixels.data[d + 2] = rgba[s + 2]; pixels.data[d + 3] = rgba[s + 3];
        }
      }
    }
    const image = document.createElement("canvas");
    image.width = width;
    image.height = height;
    image.getContext("2d")!.putImageData(pixels, 0, 0);
    return { image, width: width / HD_SCALE, height: height / HD_SCALE, scale: HD_SCALE, additive, opaque: { x: dx, y: dy, width: fw, height: fh } };
  }
  const image = document.createElement("canvas");
  image.width = width;
  image.height = height;
  return { image, width: width / HD_SCALE, height: height / HD_SCALE, scale: HD_SCALE, additive };
}

/** Canvas pixels per map pixel in a 2x sprite. */
const HD_SCALE = 2;

/**
 * Frame `frame` of image `imageId` in team colour `team`, drawn through `palette`
 * (256 RGBA entries — the current tileset's, keyed by `paletteKey`, which is also the
 * tileset name the remap tables are fetched for). Returns null while anything it needs is
 * still loading, or when the image has no drawable graphic; `onGrpLoaded` fires when it is
 * worth asking again.
 *
 * With View ▸ Remastered Graphics on (`hd`, which callers leave to the session's setting
 * unless they need the canvas to be the GRP's own size) the frame comes from the image's
 * 2x sprite where the data set has one, and is twice the pixels for the same box — see
 * `ImageFrame.scale`. An image without one, or whose file is still on its way, is drawn
 * from its GRP as ever, so nothing waits on the 2x files and nothing goes missing.
 */
export function getImageFrame(assets: UnitAssets, imageId: number, frame: number, flip: boolean, team: TeamColorSpec, palette: Uint8Array, paletteKey: string, hd: boolean = hdSprites()): ImageFrame | null {
  const drawFunction = assets.images.drawFunction[imageId];
  if (drawFunction === DrawFunction.HpBar || drawFunction === DrawFunction.SelectionCircle) return null;
  const shadow = drawFunction === DrawFunction.Shadow;
  const remapping = drawFunction === DrawFunction.Remap ? assets.images.remapping[imageId] : 0;
  // Shadows and remapped effects (fire, sparks) carry no team colour: the fire GRPs use
  // source values 1–47, which include the team slots 8–15, and the remap table must see
  // them untouched. One cache entry serves every player.
  const teamColored = !shadow && !remapping;
  const key = `${imageId}:${frame}:${flip ? 1 : 0}:${teamColored ? teamColorKey(team) : "-"}:${paletteKey}`;
  if (hd) {
    const hdKey = `hd:${key}`;
    const hdHit = cache.get(hdKey);
    if (hdHit) return hdHit;
    const anim = requestAnim(imageId);
    if (anim) {
      // A remapped effect is already in its own colours here, with its glow in the alpha.
      const made = drawAnimFrame(anim, frame, flip, teamColored ? teamRgb(assets, palette, team) : null, shadow, remapping > 0);
      if (made) {
        cache.set(hdKey, made);
        return made;
      }
    }
  }
  const hit = cache.get(key);
  if (hit) return hit;

  const path = imageGrpPath(assets, imageId);
  if (!path) return null;
  const grp = requestGrp(path);
  if (!grp || grp.frames.length === 0) return null;

  let drawPalette = palette;
  let lut: Uint8Array | null = null;
  if (teamColored) ({ lut, palette: drawPalette } = teamPaint(assets, palette, paletteKey, team));
  if (remapping) {
    const table = requestRemap(paletteKey, remapping);
    if (table === undefined) return null; // still loading; a ramp would flash for a frame
    drawPalette = remapPalette(palette, paletteKey, remapping, table);
  }

  const width = Math.max(1, grp.width);
  const height = Math.max(1, grp.height);
  const pixels = new ImageData(width, height);
  drawGrpFrame(grp, Math.min(frame, grp.frames.length - 1), pixels.data, width, 0, 0, drawPalette, lut, flip);
  if (shadow) {
    // The game darkens what is under the silhouette; a half-transparent black does the same.
    const d = pixels.data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i]) { d[i - 3] = 0; d[i - 2] = 0; d[i - 1] = 0; d[i] = 128; }
    }
  }
  const image = document.createElement("canvas");
  image.width = width;
  image.height = height;
  image.getContext("2d")!.putImageData(pixels, 0, 0);
  const out: ImageFrame = { image, width, height, scale: 1, additive: remapping > 0 };
  cache.set(key, out);
  return out;
}

/** The unit type's main graphic in its editor pose — what previews and the placement ghost show. */
export function getUnitSprite(assets: UnitAssets, unitId: number, team: TeamColorSpec, palette: Uint8Array, paletteKey: string, hd: boolean = hdSprites()): UnitSprite | null {
  if (unitId < 0 || unitId >= NO_UNIT) return null;
  const imageId = unitImageId(assets, unitId);
  const { frame, flip } = editorFrame(assets, unitId, imageId);
  return getImageFrame(assets, imageId, frame, flip, team, palette, paletteKey, hd);
}

/** The turret (or other subunit) drawn on top of a unit, or NO_UNIT. */
export function subunitOf(assets: UnitAssets, unitId: number): number {
  return assets.units.subunit[unitId] ?? NO_UNIT;
}
