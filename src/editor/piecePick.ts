/**
 * Which piece the map lays at a cell, for Alt+click: the cell's tile must be one of a piece's,
 * and laid beside at least one of its sheet neighbours from the same piece — the tile alone
 * says nothing, since a piece's corner tile can be laid on its own anywhere.
 */
import { tileGroupOf } from "../formats/tileset/decode";
import type { Piece } from "./pieces";

/** A map tile as the pieces name it: `group << 4 | slot`, the group read as the tileset's size says. */
export const sheetTile = (raw: number, groupCount: number) => (tileGroupOf(raw, groupCount) << 4) | (raw & 15);

export function laidPieceAt(
  map: { tiles: ArrayLike<number>; width: number; height: number },
  groupCount: number,
  index: ReadonlyMap<number, Piece>,
  x: number,
  y: number,
): Piece | null {
  const { tiles, width, height } = map;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const id = sheetTile(tiles[y * width + x], groupCount);
  const piece = index.get(id);
  if (!piece) return null;
  const at = (nx: number, ny: number) => (nx >= 0 && ny >= 0 && nx < width && ny < height ? sheetTile(tiles[ny * width + nx], groupCount) : -1);
  const slot = id & 15;
  const beside = [
    slot < 15 ? at(x + 1, y) === id + 1 : false,
    slot > 0 ? at(x - 1, y) === id - 1 : false,
    at(x, y + 1) === id + 16,
    at(x, y - 1) === id - 16,
  ];
  const neighbours = [id + 1, id - 1, id + 16, id - 16];
  return beside.some((b, i) => b && index.get(neighbours[i]) === piece) ? piece : null;
}
