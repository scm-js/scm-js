import { atom } from "jotai";
import { activeTileAtom } from "./editorAtoms";
import { scenarioAtom, tilesetFileNameAtom } from "./documentAtoms";
import { gameDataRevisionAtom } from "./gameDataAtoms";
import { firstTile, HOLE, type TileBlock } from "../editor/tileSheet";
import type { Scenario } from "../formats/chk/scenario";

interface HeldBlock {
  block: TileBlock;
  /** What the block was picked against: the map in front, its tileset, the game data in use. */
  scenario: Scenario | null;
  tileset: string;
  revision: number;
  /** The Tile brush's tile the pick set; another tile picked anywhere drops the block. */
  tile: number;
}

const heldBlockAtom = atom<HeldBlock | null>(null);

/**
 * The block of tiles the Tile brush lays (picked by a drag in the Tile palette's sheet), or
 * null for the single tile in `activeTileAtom`. A palette pick like the tile, so global, not
 * per document — but it is the tileset's tiles, so it reads as null once the map in front, its
 * tileset or the data set in use is another than the one it was picked on, and once a single
 * tile is picked any way at all (the palette, the eyedropper, the Tile # box, Blend, a plugin's
 * `setBrush`): those all write `activeTileAtom`, which the block remembers. Writing a block
 * makes its first tile the Tile brush's tile, so the single-tile readers stay sensible.
 */
export const tileBlockAtom = atom(
  (get): TileBlock | null => {
    const held = get(heldBlockAtom);
    if (!held) return null;
    if (held.scenario !== get(scenarioAtom) || held.tileset !== get(tilesetFileNameAtom) || held.revision !== get(gameDataRevisionAtom)) return null;
    return get(activeTileAtom) === held.tile ? held.block : null;
  },
  (get, set, block: TileBlock | null) => {
    if (!block) {
      set(heldBlockAtom, null);
      return;
    }
    const tile = firstTile(block);
    if (tile === HOLE) return;
    set(activeTileAtom, tile);
    set(heldBlockAtom, { block, scenario: get(scenarioAtom), tileset: get(tilesetFileNameAtom), revision: get(gameDataRevisionAtom), tile });
  },
);
