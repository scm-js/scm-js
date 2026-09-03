/**
 * Deterministic per-tile pseudo-noise in [0, 1): the mottling the viewport and minimap
 * paint over the tileset's flat colour when the graphics are not installed, so a map
 * without game data still reads as ground rather than a solid block.
 */
export function hashNoise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
