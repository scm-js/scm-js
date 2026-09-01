import { cycleLength, cyclePalette, cyclingMegatiles, type PaletteBand } from "./cycle";
import { drawMegatile, MEGATILE_PX, type Tileset } from "./decode";

/**
 * All of a tileset's megatiles rendered once into a single image, so the viewport can
 * draw terrain with one `drawImage` per visible tile instead of decoding minitiles on
 * every frame.
 */
export interface TilesetAtlas {
  image: CanvasImageSource;
  /** Megatiles per atlas row. */
  columns: number;
  tileSize: number;
  count: number;
  /** Packed 0xRRGGBB average of each megatile, for minimap and far-zoom drawing. */
  averages: Uint32Array;
  /** The cycling (water/lava) megatiles, or null when the tileset has none. */
  animation: AtlasAnimation | null;
}

/**
 * A second, small atlas holding only the megatiles that reference cycling palette
 * entries. It is re-rasterised with the rotated palette on every step, while the main
 * atlas stays at step 0; `atlasSource` picks the right one per megatile.
 */
export interface AtlasAnimation {
  image: HTMLCanvasElement;
  columns: number;
  /** Megatile → slot in this atlas, or -1 for megatiles that do not cycle. */
  slot: Int32Array;
  megatiles: Uint32Array;
  bands: readonly PaletteBand[];
  /** Steps until the cycle repeats. */
  length: number;
  /** The step the image currently shows. */
  step: number;
  pixels: ImageData;
  /** Scratch palette, rotated in place each step. */
  palette: Uint8Array;
}

const ATLAS_COLUMNS = 64;

export function buildAtlasImageData(tileset: Tileset): { pixels: Uint8ClampedArray<ArrayBuffer>; width: number; height: number; columns: number } {
  const count = Math.max(1, tileset.megatileCount);
  const columns = Math.min(ATLAS_COLUMNS, count);
  const rows = Math.ceil(count / columns);
  const width = columns * MEGATILE_PX;
  const height = rows * MEGATILE_PX;
  const pixels = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));

  for (let i = 0; i < count; i++) {
    const x = (i % columns) * MEGATILE_PX;
    const y = Math.floor(i / columns) * MEGATILE_PX;
    drawMegatile(tileset, i, pixels, width, x, y);
  }

  return { pixels, width, height, columns };
}

/** Mean colour of each megatile, read straight off the finished atlas. */
export function megatileAverages(
  pixels: Uint8ClampedArray,
  width: number,
  columns: number,
  count: number,
): Uint32Array {
  const out = new Uint32Array(count);
  const area = MEGATILE_PX * MEGATILE_PX;

  for (let i = 0; i < count; i++) {
    const ox = (i % columns) * MEGATILE_PX;
    const oy = Math.floor(i / columns) * MEGATILE_PX;
    let r = 0, g = 0, b = 0;
    for (let y = 0; y < MEGATILE_PX; y++) {
      let at = ((oy + y) * width + ox) * 4;
      for (let x = 0; x < MEGATILE_PX; x++) {
        r += pixels[at]; g += pixels[at + 1]; b += pixels[at + 2];
        at += 4;
      }
    }
    out[i] = (((r / area) | 0) << 16) | (((g / area) | 0) << 8) | ((b / area) | 0);
  }
  return out;
}

/** Rasterise `megatiles` in slot order into a `columns`-wide RGBA buffer using `palette`. */
export function drawAnimationPixels(
  tileset: Tileset,
  megatiles: Uint32Array,
  palette: Uint8Array,
  columns: number,
  dest: Uint8ClampedArray | Uint8Array,
) {
  const width = columns * MEGATILE_PX;
  for (let s = 0; s < megatiles.length; s++) {
    const x = (s % columns) * MEGATILE_PX;
    const y = Math.floor(s / columns) * MEGATILE_PX;
    drawMegatile(tileset, megatiles[s], dest, width, x, y, palette);
  }
}

function buildAnimation(tileset: Tileset, bands: readonly PaletteBand[]): AtlasAnimation | null {
  const megatiles = cyclingMegatiles(tileset, bands);
  if (megatiles.length === 0) return null;

  const columns = Math.min(ATLAS_COLUMNS, megatiles.length);
  const rows = Math.ceil(megatiles.length / columns);
  const slot = new Int32Array(Math.max(1, tileset.megatileCount)).fill(-1);
  megatiles.forEach((m, s) => { slot[m] = s; });

  const image = document.createElement("canvas");
  image.width = columns * MEGATILE_PX;
  image.height = rows * MEGATILE_PX;
  const pixels = new ImageData(image.width, image.height);
  const palette = new Uint8Array(tileset.palette);
  drawAnimationPixels(tileset, megatiles, palette, columns, pixels.data);
  image.getContext("2d")!.putImageData(pixels, 0, 0);

  return { image, columns, slot, megatiles, bands, length: cycleLength(bands), step: 0, pixels, palette };
}

/**
 * Move the animated atlas to palette rotation `step`. Returns true when it changed and
 * anything drawn from it should be repainted.
 */
export function setAtlasStep(atlas: TilesetAtlas, tileset: Tileset, step: number): boolean {
  const anim = atlas.animation;
  if (!anim) return false;
  step = ((step % anim.length) + anim.length) % anim.length;
  if (step === anim.step) return false;

  cyclePalette(tileset.palette, anim.bands, step, anim.palette);
  drawAnimationPixels(tileset, anim.megatiles, anim.palette, anim.columns, anim.pixels.data);
  anim.image.getContext("2d")!.putImageData(anim.pixels, 0, 0);
  anim.step = step;
  return true;
}

export async function buildAtlas(tileset: Tileset, bands: readonly PaletteBand[] = []): Promise<TilesetAtlas> {
  const { pixels, width, height, columns } = buildAtlasImageData(tileset);
  const count = Math.max(1, tileset.megatileCount);
  const averages = megatileAverages(pixels, width, columns, count);
  const data = new ImageData(pixels, width, height);
  const animation = buildAnimation(tileset, bands);

  // An ImageBitmap is the cheapest thing to blit from; fall back to a canvas where
  // createImageBitmap is unavailable.
  if (typeof createImageBitmap === "function") {
    return { image: await createImageBitmap(data), columns, tileSize: MEGATILE_PX, count, averages, animation };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(data, 0, 0);
  return { image: canvas, columns, tileSize: MEGATILE_PX, count, averages, animation };
}

export interface AtlasSource {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  /** True when the megatile comes from the animated atlas. */
  animated: boolean;
}

/** Image and source rectangle to blit one megatile from, at the atlas's current step. */
export function atlasSource(atlas: TilesetAtlas, megatile: number): AtlasSource {
  const anim = atlas.animation;
  const slot = anim ? anim.slot[megatile] : -1;
  if (anim && slot >= 0) {
    return {
      image: anim.image,
      sx: (slot % anim.columns) * atlas.tileSize,
      sy: Math.floor(slot / anim.columns) * atlas.tileSize,
      animated: true,
    };
  }
  return {
    image: atlas.image,
    sx: (megatile % atlas.columns) * atlas.tileSize,
    sy: Math.floor(megatile / atlas.columns) * atlas.tileSize,
    animated: false,
  };
}
