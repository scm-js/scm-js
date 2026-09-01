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

export async function buildAtlas(tileset: Tileset): Promise<TilesetAtlas> {
  const { pixels, width, height, columns } = buildAtlasImageData(tileset);
  const count = Math.max(1, tileset.megatileCount);
  const averages = megatileAverages(pixels, width, columns, count);
  const data = new ImageData(pixels, width, height);

  // An ImageBitmap is the cheapest thing to blit from; fall back to a canvas where
  // createImageBitmap is unavailable.
  if (typeof createImageBitmap === "function") {
    return { image: await createImageBitmap(data), columns, tileSize: MEGATILE_PX, count, averages };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(data, 0, 0);
  return { image: canvas, columns, tileSize: MEGATILE_PX, count, averages };
}

/** Source rectangle of one megatile within the atlas. */
export function atlasRect(atlas: TilesetAtlas, megatile: number): { sx: number; sy: number } {
  return {
    sx: (megatile % atlas.columns) * atlas.tileSize,
    sy: Math.floor(megatile / atlas.columns) * atlas.tileSize,
  };
}
