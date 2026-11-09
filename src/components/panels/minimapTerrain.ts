/**
 * The minimap's ground, a pixel of its picture at a time. Apart from the panel so that it
 * can be run without a canvas: what it writes is plain bytes.
 */
import { isLackedTile, lackedGroups } from "../../data/remasteredTiles";
import { megatileForTile } from "../../formats/tileset/decode";
import type { LoadedTileset } from "../../formats/tileset/load";
import { missingTileRgb } from "../viewport/missingTile";
import { hashNoise } from "../viewport/noise";

/** The part of an `ImageData` the fill writes. */
export interface MinimapPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** The part of a loaded tileset the fill reads. */
export type MinimapTileset = { atlas: Pick<LoadedTileset["atlas"], "averages">; tileset: Pick<LoadedTileset["tileset"], "groups" | "megatileCount"> };

/** The ground at minimap scale: the tiles' mean colours, a plain plate while the graphics load, the tileset's colour without them. */
export function fillTerrain(img: MinimapPixels, w: number, h: number, scale: number, tiles: ArrayLike<number> | undefined, assets: MinimapTileset | null, loading: boolean, fallback: string, era: number) {
  if (tiles && assets) {
    // One mean colour per megatile is exactly what a minimap wants.
    const { atlas, tileset: ts } = assets;
    // Terrain the data set has not got is hatched, as in the map, and not the colour of whatever tile its id reads as.
    const lacks = lackedGroups(tiles, era, ts.groups.length);
    for (let py = 0; py < img.height; py++) {
      const ty = Math.min(h - 1, Math.floor(py / scale));
      for (let px = 0; px < img.width; px++) {
        const tx = Math.min(w - 1, Math.floor(px / scale));
        const id = tiles[ty * w + tx];
        const megatile = megatileForTile(ts, id);
        const rgb = isLackedTile(lacks, id) ? missingTileRgb(px, py) : megatile < 0 ? 0 : atlas.averages[megatile];
        const i = (py * img.width + px) * 4;
        img.data[i] = rgb >> 16;
        img.data[i + 1] = (rgb >> 8) & 255;
        img.data[i + 2] = rgb & 255;
        img.data[i + 3] = 255;
      }
    }
  } else if (tiles && loading) {
    // Graphics for the map just opened are still coming; a plain plate reads as
    // "loading" instead of pretending to be terrain.
    img.data.fill(255);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 0x12; img.data[i + 1] = 0x16; img.data[i + 2] = 0x1d;
    }
  } else {
    const base = parseInt(fallback.slice(1), 16);
    const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255;
    for (let py = 0; py < img.height; py++) {
      for (let px = 0; px < img.width; px++) {
        const tx = Math.floor(px / scale), ty = Math.floor(py / scale);
        const n = (hashNoise(tx, ty) - 0.5) * 0.12 + (hashNoise(tx >> 2, ty >> 2) - 0.5) * 0.16;
        const k = 1 + n;
        const i = (py * img.width + px) * 4;
        img.data[i] = br * k;
        img.data[i + 1] = bg * k;
        img.data[i + 2] = bb * k;
        img.data[i + 3] = 255;
      }
    }
  }
}
