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

/**
 * Pixels of border around every megatile in an atlas, filled with the megatile's own edge
 * pixels. Below 100% the viewport blits with smoothing on, and a bilinear sample at a
 * tile's edge reaches half a source pixel past the 32×32 rect — into the next megatile
 * in the atlas, which for a snow tile is often a cliff piece, so every such edge carried
 * a dark hairline. With the gutter the sample lands on the tile's own colour instead.
 */
export const ATLAS_GUTTER = 1;
/** The distance between one megatile's origin and the next, in atlas pixels. */
export const ATLAS_PITCH = MEGATILE_PX + 2 * ATLAS_GUTTER;

/** Atlas pixel coordinates of slot `i`'s megatile (the pixel inside its gutter). */
export function atlasCell(i: number, columns: number): { x: number; y: number } {
  return { x: (i % columns) * ATLAS_PITCH + ATLAS_GUTTER, y: Math.floor(i / columns) * ATLAS_PITCH + ATLAS_GUTTER };
}

/** Draw a megatile into slot `i` of a `columns`-wide RGBA atlas and fill its gutter with its edges. */
function drawAtlasCell(tileset: Tileset, megatile: number, dest: Uint8ClampedArray | Uint8Array, columns: number, i: number, palette?: Uint8Array) {
  const width = columns * ATLAS_PITCH;
  const { x, y } = atlasCell(i, columns);
  drawMegatile(tileset, megatile, dest, width, x, y, palette);
  const copy = (fromX: number, fromY: number, toX: number, toY: number) => {
    const from = (fromY * width + fromX) * 4, to = (toY * width + toX) * 4;
    dest[to] = dest[from]; dest[to + 1] = dest[from + 1]; dest[to + 2] = dest[from + 2]; dest[to + 3] = dest[from + 3];
  };
  for (let g = 1; g <= ATLAS_GUTTER; g++) {
    for (let k = 0; k < MEGATILE_PX; k++) {
      copy(x + k, y, x + k, y - g);
      copy(x + k, y + MEGATILE_PX - 1, x + k, y + MEGATILE_PX - 1 + g);
      copy(x, y + k, x - g, y + k);
      copy(x + MEGATILE_PX - 1, y + k, x + MEGATILE_PX - 1 + g, y + k);
    }
    for (let h = 1; h <= ATLAS_GUTTER; h++) {
      copy(x, y, x - h, y - g);
      copy(x + MEGATILE_PX - 1, y, x + MEGATILE_PX - 1 + h, y - g);
      copy(x, y + MEGATILE_PX - 1, x - h, y + MEGATILE_PX - 1 + g);
      copy(x + MEGATILE_PX - 1, y + MEGATILE_PX - 1, x + MEGATILE_PX - 1 + h, y + MEGATILE_PX - 1 + g);
    }
  }
}

export function buildAtlasImageData(tileset: Tileset): { pixels: Uint8ClampedArray<ArrayBuffer>; width: number; height: number; columns: number } {
  const count = Math.max(1, tileset.megatileCount);
  const columns = Math.min(ATLAS_COLUMNS, count);
  const rows = Math.ceil(count / columns);
  const width = columns * ATLAS_PITCH;
  const height = rows * ATLAS_PITCH;
  const pixels = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));

  for (let i = 0; i < count; i++) drawAtlasCell(tileset, i, pixels, columns, i);

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
    const { x: ox, y: oy } = atlasCell(i, columns);
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

/** Rasterise `megatiles` in slot order, gutters and all, into a `columns`-wide RGBA buffer using `palette`. */
export function drawAnimationPixels(
  tileset: Tileset,
  megatiles: Uint32Array,
  palette: Uint8Array,
  columns: number,
  dest: Uint8ClampedArray | Uint8Array,
) {
  for (let s = 0; s < megatiles.length; s++) drawAtlasCell(tileset, megatiles[s], dest, columns, s, palette);
}

function buildAnimation(tileset: Tileset, bands: readonly PaletteBand[]): AtlasAnimation | null {
  const megatiles = cyclingMegatiles(tileset, bands);
  if (megatiles.length === 0) return null;

  const columns = Math.min(ATLAS_COLUMNS, megatiles.length);
  const rows = Math.ceil(megatiles.length / columns);
  const slot = new Int32Array(Math.max(1, tileset.megatileCount)).fill(-1);
  megatiles.forEach((m, s) => { slot[m] = s; });

  const image = document.createElement("canvas");
  image.width = columns * ATLAS_PITCH;
  image.height = rows * ATLAS_PITCH;
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
    const { x, y } = atlasCell(slot, anim.columns);
    return { image: anim.image, sx: x, sy: y, animated: true };
  }
  const { x, y } = atlasCell(megatile, atlas.columns);
  return { image: atlas.image, sx: x, sy: y, animated: false };
}
