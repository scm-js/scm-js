/**
 * What a tile is to the game (`kindKey`), apart from the brushes that compare by it (Heal, the
 * Tile palette's "same tile", the borrowed-terrain table), so the borrowed-terrain worker can use
 * it without the editor's brush modules.
 */
import { megatileForTile, tileGroupOf, type Tileset } from "./decode";

/**
 * What a tile is to the game, as a string: its CV5 group's flag word and its megatile's sixteen
 * VF4 words. Two tiles with the same key walk, build, block sight and stand at the same height
 * alike; the Tile palette's lists also take it as half of "the same tile" (`tileCopies.ts`).
 */
export function kindKey(tileset: Tileset, tile: number): string {
  const group = tileset.groups[tileGroupOf(tile, tileset.groups.length)];
  const base = megatileForTile(tileset, tile) * 16;
  let key = String(group?.flags ?? 0);
  for (let m = 0; m < 16; m++) key += `,${tileset.megatileFlags[base + m] ?? 0}`;
  return key;
}
