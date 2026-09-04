/**
 * Small pictures of a terrain type, drawn straight from the tileset files.
 *
 * The New Scenario dialog shows all eight tilesets at once and the editor's ordinary
 * drawing path cannot serve that: `getTileset` rasterises a ~20 MB megatile atlas per
 * tileset, and eight of those is more memory than the rest of the editor. A patch is
 * instead painted megatile by megatile into a plain RGBA buffer — a few hundred
 * kilobytes at the sizes the dialog asks for — so the caller can decode a tileset,
 * take its patches and drop it again (`loadTilesetGraphics` in `load.ts`).
 *
 * The tiles come from `flatTiles`, the same fill `newMapInto` lays down, so what the
 * dialog shows is what the map is made of rather than a hand-drawn impression of it.
 */
import { drawMegatile, megatileForTile, MEGATILE_PX, type Tileset } from "./decode";
import { flatTiles, type BaseTerrain } from "./terrain";

/** A `cols`x`rows` block of flat terrain as RGBA pixels, 32 px per tile. */
export interface TerrainPatch {
  /** Allocated over a plain ArrayBuffer so it can go straight into an `ImageData`. */
  pixels: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  cols: number;
  rows: number;
}

/**
 * mulberry32. The fill is random, and a preview that reshuffled itself on every React
 * render would shimmer, so patches are drawn from a seed rather than `Math.random`.
 */
export function patchRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paint `cols`x`rows` tiles of one flat terrain. Ids with no megatile draw as void. */
export function renderTerrainPatch(
  tileset: Tileset,
  terrain: BaseTerrain,
  cols: number,
  rows: number,
  random: () => number = patchRandom(terrain.group * 8191 + 1),
): TerrainPatch {
  const width = cols * MEGATILE_PX;
  const height = rows * MEGATILE_PX;
  const pixels = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  const tiles = flatTiles(cols, rows, terrain, tileset, random);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const megatile = megatileForTile(tileset, tiles[y * cols + x]);
      if (megatile > 0) drawMegatile(tileset, megatile, pixels, width, x * MEGATILE_PX, y * MEGATILE_PX);
      else fillVoid(pixels, width, x * MEGATILE_PX, y * MEGATILE_PX);
    }
  }
  return { pixels, width, height, cols, rows };
}

/** Megatile 0 is the null megatile: opaque black, as the viewport draws it. */
function fillVoid(pixels: Uint8ClampedArray, width: number, dx: number, dy: number) {
  for (let y = 0; y < MEGATILE_PX; y++) {
    let at = ((dy + y) * width + dx) * 4;
    for (let x = 0; x < MEGATILE_PX; x++) {
      pixels[at] = 10; pixels[at + 1] = 12; pixels[at + 2] = 16; pixels[at + 3] = 255;
      at += 4;
    }
  }
}

/** Mean colour of a patch as `#rrggbb` — what the map preview falls back to per tile at far scales. */
export function patchAverage(patch: TerrainPatch): string {
  let r = 0, g = 0, b = 0;
  const n = patch.width * patch.height;
  for (let at = 0; at < n * 4; at += 4) { r += patch.pixels[at]; g += patch.pixels[at + 1]; b += patch.pixels[at + 2]; }
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
