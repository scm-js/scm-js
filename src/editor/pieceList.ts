/**
 * What the Pieces view lists, and `api.terrain.pieces()` answers: named pieces plugins provide,
 * a section for each set, ahead of the pieces cut from maps (`pieces.ts`, folded by
 * `tileCopies.ts#collapsePieces`). A provided piece whose tiles the loaded table lacks is not
 * listed; a cut piece with the same tiles as a provided one is not listed again (the named one
 * wins). Also the flat ground plugins declare for the Rect brush. Pure.
 */
import { megatileForTile, type Tileset } from "../formats/tileset/decode";
import { pairTerrain, type TerrainType } from "../formats/tileset/palette";
import type { TerrainName } from "../data/tilesets";
import { pieceBlock } from "./pieces";
import { entryPieces, type PieceEntry } from "./tileCopies";
import { HOLE, type TileBlock } from "./tileSheet";

/** One named piece a plugin provides: a block of tiles, as `blockFrom` or `blockOf` give them. */
export interface ProvidedPiece {
  name?: string;
  category?: string;
  block: TileBlock;
}

/** A plugin's set of pieces, as the host keeps it: `key` is the plugin's id and the set's. */
export interface ProvidedPieceSet {
  key: string;
  /** The providing plugin's id. */
  source: string;
  label: string;
  pieces: readonly ProvidedPiece[];
}

/** Flat ground a plugin declares: a name for the pair whose left half is `group` (even). */
export interface DeclaredTerrain {
  name: string;
  group: number;
}

export interface ListedPiece {
  block: TileBlock;
  /** Its tiles, ascending, holes left out. */
  tiles: number[];
  /** Where its top-left is in the sheet: the block's origin, else its lowest tile's group and slot. */
  group: number;
  slot: number;
  name?: string;
  category?: string;
  /** `"maps"` for a cut piece, else the providing plugin's id. */
  source: string;
  /** Times its tiles are laid, all told (0 for a provided piece). */
  laid: number;
  /** A cut piece's entry: the copies it stands for, and what it copies under other flags. */
  entry?: PieceEntry;
}

export interface PieceSection {
  /** The providing set's label; null for the pieces cut from maps. */
  label: string | null;
  source: string;
  items: ListedPiece[];
}

/** A block's tiles, ascending, each once, holes left out. */
export function blockTiles(block: TileBlock): number[] {
  return [...new Set(block.ids.filter((id) => id !== HOLE))].sort((a, b) => a - b);
}

const keyOf = (tiles: readonly number[]) => tiles.join(",");

/** Whether every tile of a block has a picture in the loaded table (a group past it has none). */
export function blockFits(tileset: Pick<Tileset, "groups" | "megatileCount">, block: TileBlock): boolean {
  const tiles = blockTiles(block);
  return tiles.length > 0 && tiles.every((id) => (id >> 4) < tileset.groups.length && megatileForTile(tileset, id) > 0);
}

function provided(set: ProvidedPieceSet, p: ProvidedPiece): ListedPiece {
  const tiles = blockTiles(p.block);
  const first = tiles[0] ?? 0;
  const group = p.block.origin?.group ?? Math.min(...tiles.map((t) => t >> 4));
  const slot = p.block.origin?.slot ?? Math.min(...tiles.map((t) => t & 15));
  return { block: p.block, tiles, group: Number.isFinite(group) ? group : first >> 4, slot: Number.isFinite(slot) ? slot : first & 15, name: p.name, category: p.category, source: set.source, laid: 0 };
}

/**
 * The sections the Pieces view shows: each provided set that has a piece the table holds, in
 * the order given, then the cut pieces less those a provided piece already names.
 */
export function pieceSections(tileset: Pick<Tileset, "groups" | "megatileCount">, entries: readonly PieceEntry[], sets: readonly ProvidedPieceSet[]): PieceSection[] {
  const out: PieceSection[] = [];
  const named = new Set<string>();
  for (const set of sets) {
    const items = set.pieces.filter((p) => blockFits(tileset, p.block)).map((p) => provided(set, p));
    for (const i of items) named.add(keyOf(i.tiles));
    if (items.length > 0) out.push({ label: set.label, source: set.source, items });
  }
  const cut = entries
    .filter((e) => !entryPieces(e).some((p) => named.has(keyOf(p.tiles))))
    .map((e): ListedPiece => ({ block: pieceBlock(e.piece), tiles: e.piece.tiles, group: e.piece.group, slot: e.piece.slot, source: "maps", laid: e.piece.laid, entry: e }));
  out.push({ label: null, source: "maps", items: cut });
  return out;
}

/**
 * Declared flat ground as Rect brush terrains: the pair terrain of each group (`pairTerrain`,
 * so it lays, fills and replaces as a picked pair does) under the name the plugin gave. A group
 * that is not a pair in the loaded table is skipped, and so is one already listed.
 */
export function declaredTerrains(tileset: Tileset, names: readonly TerrainName[], declared: readonly DeclaredTerrain[]): TerrainType[] {
  const out: TerrainType[] = [];
  for (const d of declared) {
    const type = pairTerrain(tileset, names, d.group);
    if (!type || out.some((t) => t.id === type.id)) continue;
    out.push({ ...type, name: d.name, label: d.name });
  }
  return out;
}
