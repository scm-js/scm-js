/**
 * The pure half of Terrain from Image: given one RGBA sample per target cell, decide
 * which terrain each cell becomes. No DOM, no canvas — `tests/terrain-from-image.test.ts`
 * runs this in Node; `plugin.ts` does the resampling and the painting.
 */

export interface TerrainChoice {
  /** ISOM terrain id (CV5 pair index). */
  id: number;
  /** Packed `0xRRGGBB`. */
  color: number;
}

/**
 * `color`: every cell takes the terrain whose swatch is nearest by hue and relative
 * brightness (see `adaptiveMatcher`). `brightness`: the terrains in list order become
 * equal bands from dark to light, so a heightmap's greys map low → high in the order
 * the list gives.
 */
export type MatchMode = "color" | "brightness";

export interface ConvertOptions {
  terrains: readonly TerrainChoice[];
  mode: MatchMode;
  /** Box-blur radius in cells (0 = none) applied to the samples before matching, to calm noise and dithering. */
  smooth: number;
}

export const unpack = (color: number): [number, number, number] => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
export const pack = (r: number, g: number, b: number): number => ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);

/** Rec. 601 luma, 0..255. */
export const luminance = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * "Redmean" colour distance: a cheap approximation of perceptual distance that weights
 * the channels by where the colour sits on the red axis.
 */
export function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** Index of the nearest choice by colour, or -1 with no choices. */
export function nearestByColor(r: number, g: number, b: number, terrains: readonly TerrainChoice[]): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < terrains.length; i++) {
    const [tr, tg, tb] = unpack(terrains[i].color);
    const d = colorDistance(r, g, b, tr, tg, tb);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Chromaticity — each channel's share of the total — which is what survives when a
 * picture's saturated colours are compared with a tileset's murky averages.
 */
export function chromaticity(r: number, g: number, b: number): [number, number] {
  const s = r + g + b;
  return s === 0 ? [1 / 3, 1 / 3] : [r / s, g / s];
}

/**
 * A matcher that ignores the absolute darkness of the tile graphics: hue is compared as
 * chromaticity, and brightness only relative to each side's own range — the picture's
 * darkest cell is as dark as the darkest terrain, its brightest as bright as the
 * brightest (auto-levels), so a blue lake goes to Water and a black band to the darkest
 * ground even though every terrain swatch is a shade of brown.
 */
export function adaptiveMatcher(terrains: readonly TerrainChoice[], imageLumRange: [number, number]): (r: number, g: number, b: number) => number {
  if (terrains.length === 0) return () => -1;
  const swatches = terrains.map((t) => { const [r, g, b] = unpack(t.color); return { chroma: chromaticity(r, g, b), lum: luminance(r, g, b) }; });
  const lo = Math.min(...swatches.map((s) => s.lum)), hi = Math.max(...swatches.map((s) => s.lum));
  const [ilo, ihi] = imageLumRange;
  const CHROMA = 2 * 255; // a full chromaticity step weighs about twice the whole brightness range
  return (r, g, b) => {
    const [cr, cg] = chromaticity(r, g, b);
    const relative = ihi > ilo ? (luminance(r, g, b) - ilo) / (ihi - ilo) : 0.5;
    const lum = lo + relative * (hi - lo);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < swatches.length; i++) {
      const s = swatches[i];
      const dr = (cr - s.chroma[0]) * CHROMA, dg = (cg - s.chroma[1]) * CHROMA, dl = lum - s.lum;
      const d = dr * dr + dg * dg + dl * dl;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
}

/** Which of `count` equal brightness bands (0 = darkest) a luma value falls in. */
export function bandByBrightness(luma: number, count: number): number {
  if (count <= 0) return -1;
  return Math.min(count - 1, Math.max(0, Math.floor((luma / 256) * count)));
}

/** Separable box blur over RGBA samples; edge cells reuse the nearest sample. */
export function boxBlur(rgba: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  if (radius <= 0 || width === 0 || height === 0) return rgba;
  const r = Math.floor(radius);
  const tmp = new Float32Array(width * height * 4);
  const out = new Uint8ClampedArray(width * height * 4);
  const span = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
      for (let k = -r; k <= r; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        const i = (y * width + sx) * 4;
        a0 += rgba[i]; a1 += rgba[i + 1]; a2 += rgba[i + 2]; a3 += rgba[i + 3];
      }
      const o = (y * width + x) * 4;
      tmp[o] = a0 / span; tmp[o + 1] = a1 / span; tmp[o + 2] = a2 / span; tmp[o + 3] = a3 / span;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
      for (let k = -r; k <= r; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        const i = (sy * width + x) * 4;
        a0 += tmp[i]; a1 += tmp[i + 1]; a2 += tmp[i + 2]; a3 += tmp[i + 3];
      }
      const o = (y * width + x) * 4;
      out[o] = Math.round(a0 / span); out[o + 1] = Math.round(a1 / span); out[o + 2] = Math.round(a2 / span); out[o + 3] = Math.round(a3 / span);
    }
  }
  return out;
}

/**
 * One terrain id per cell (-1 where the image is transparent or no terrain was chosen),
 * row-major over `width × height`.
 */
export function matchTerrains(rgba: Uint8ClampedArray, width: number, height: number, opts: ConvertOptions): Int32Array {
  const out = new Int32Array(width * height).fill(-1);
  if (opts.terrains.length === 0) return out;
  const samples = boxBlur(rgba, width, height, opts.smooth);
  let ilo = 255, ihi = 0;
  for (let i = 0; i < width * height; i++) {
    if (samples[i * 4 + 3] < 8) continue;
    const l = luminance(samples[i * 4], samples[i * 4 + 1], samples[i * 4 + 2]);
    if (l < ilo) ilo = l;
    if (l > ihi) ihi = l;
  }
  const nearest = adaptiveMatcher(opts.terrains, [ilo, ihi]);
  for (let i = 0; i < width * height; i++) {
    const r = samples[i * 4], g = samples[i * 4 + 1], b = samples[i * 4 + 2], a = samples[i * 4 + 3];
    if (a < 8) continue;
    const idx = opts.mode === "color" ? nearest(r, g, b) : bandByBrightness(luminance(r, g, b), opts.terrains.length);
    if (idx >= 0) out[i] = opts.terrains[idx].id;
  }
  return out;
}

/** How many cells each terrain got, in `terrains` order — the dialog's summary line. */
export function countCells(grid: Int32Array, terrains: readonly TerrainChoice[]): number[] {
  const counts = Array.from({ length: terrains.length }, () => 0);
  const at = new Map(terrains.map((t, i) => [t.id, i]));
  for (const id of grid) {
    const i = at.get(id);
    if (i !== undefined) counts[i]++;
  }
  return counts;
}

/** The cells of `grid` (offset into the map by the rect origin) grouped by terrain id. */
export function cellsByTerrain(grid: Int32Array, gridWidth: number, gridHeight: number, originX: number, originY: number, mapWidth: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const id = grid[y * gridWidth + x];
      if (id < 0) continue;
      let list = out.get(id);
      if (!list) { list = []; out.set(id, list); }
      list.push((originY + y) * mapWidth + originX + x);
    }
  }
  return out;
}
