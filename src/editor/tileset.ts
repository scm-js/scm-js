/**
 * Scenario ▸ Map Properties ▸ Tileset: change the map's tileset (ERA). Tile ids mean
 * something different in every tileset — Badlands dirt is Jungle water is Ice nothing —
 * so the terrain cannot be carried across: the map is refilled with the new tileset's
 * chosen terrain, laid the way a new map is (`flatTerrain`, ISOM lattice included when the
 * map has one), and the doodads go with it, since a doodad is a set of the old tileset's
 * tiles. Units, sprites, locations, fog, triggers and settings stay where they are.
 * `keepTiles` leaves the tile numbers in place instead — what SCMDraft's tileset switch
 * does — for the author who wants to see what those numbers draw in the new tileset.
 *
 * Not an undoable edit: like Resize it is a transaction applied through
 * `changeTilesetAtom`, which drops the history and bumps every revision.
 */
import { markDirty, tilesetIndex, type Scenario } from "../formats/chk/scenario";
import type { Tileset } from "../formats/tileset/decode";
import type { DoodadCatalogue } from "../formats/tileset/doodads";
import { flatTerrain, type BaseTerrain } from "../formats/tileset/terrain";
import { isomSize } from "../formats/chk/sections/terrain";
import { overlaySpriteIndex } from "./doodads";

export interface ChangeTilesetOptions {
  /** ERA index of the new tileset, 0..7. */
  era: number;
  /** Terrain the map is refilled with (ignored with `keepTiles`). */
  fill: BaseTerrain;
  /** The *new* tileset's graphics, when loaded; without them the fill uses the base ids. */
  tileset: Tileset | null;
  /** The *old* tileset's doodad catalogue, to find the overlay sprites the dropped doodads own. */
  doodads?: DoodadCatalogue | null;
  /** Keep the tile numbers and only change ERA. */
  keepTiles?: boolean;
  random?: () => number;
}

export interface ChangeTilesetResult {
  from: number;
  to: number;
  doodadsDropped: number;
  /** Overlay sprites that belonged to the dropped doodads. */
  spritesDropped: number;
  refilled: boolean;
}

export function changeTileset(scn: Scenario, options: ChangeTilesetOptions): ChangeTilesetResult {
  const from = tilesetIndex(scn);
  const to = options.era & 7;
  const result: ChangeTilesetResult = { from, to, doodadsDropped: 0, spritesDropped: 0, refilled: false };
  scn.era = (scn.era & ~7) | to;
  markDirty(scn, "ERA ");
  if (options.keepTiles) return result;

  const { width, height } = scn;
  const flat = flatTerrain(width, height, options.fill, options.tileset, options.random ?? Math.random, to);
  scn.tiles = flat.tiles;
  scn.editorTiles = new Uint16Array(flat.tiles);
  markDirty(scn, "MTXM", "TILE");
  if (scn.isom) {
    scn.isom = flat.isom.length === isomSize(width, height) / 2 ? flat.isom : new Uint16Array(isomSize(width, height) / 2);
    markDirty(scn, "ISOM");
  }
  // Doodads are the old tileset's tiles; their overlay sprites are the old tileset's graphics.
  if (scn.doodads.length > 0) {
    const overlays = new Set<number>();
    if (options.doodads) {
      for (const d of scn.doodads) {
        const def = options.doodads.byId.get(d.doodadId);
        if (!def) continue;
        const i = overlaySpriteIndex(scn, def, d, overlays);
        if (i >= 0) overlays.add(i);
      }
    }
    result.doodadsDropped = scn.doodads.length;
    scn.doodads = [];
    markDirty(scn, "DD2 ");
    if (overlays.size > 0) {
      scn.sprites = scn.sprites.filter((_, i) => !overlays.has(i));
      result.spritesDropped = overlays.size;
      markDirty(scn, "THG2");
    }
  }
  result.refilled = true;
  return result;
}
