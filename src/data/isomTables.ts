/**
 * The per-tileset tables StarEdit's isometric brush runs on.
 *
 * Nothing here can be read off the CV5: it is the numbering StarEdit compiled in, as
 * reverse-engineered for Chkdraft (src/mapping_core/sc.h, MIT, Justin Forsberg). Each
 * tileset has one row per CV5 terrain type (the `index` field of a tile group):
 *
 *  - `isomValue` — what the ISOM section stores (shifted left 4) for a diamond of that
 *    type, and the row of the shape-link table the type starts at. Flat terrains
 *    ("solid brushes") take one row; each cliff/edge set takes fourteen (one per shape).
 *  - `linkId` — the identity neighbours are compared by; unrelated to `isomValue`.
 *  - `brush` — position in StarEdit's palette, or -1 for types it does not offer.
 *
 * Row 0's `isomValue` is where the shape rows begin. Rows above the half-way point are
 * edge sets; their `isomValue` is the first of their fourteen shape rows.
 *
 * `terrainTypeMap` is the compressed adjacency list: "type A, then the types a search
 * for a neighbour of A starts at, 0" repeated, ending in 0. See editor/isom.ts.
 */

export interface IsomTerrainType {
  /** CV5 group `index`. */
  index: number;
  isomValue: number;
  linkId: number;
  brush: number;
}

type Row = readonly [index: number, isomValue?: number, brush?: number, linkId?: number];

function rows(list: readonly Row[]): IsomTerrainType[] {
  return list.map(([index, isomValue = 0, brush = -1, linkId = 0]) => ({ index, isomValue, linkId, brush }));
}

const BADLANDS = rows([
  [0, 10], [1],
  [2, 1, 0, 1],   // Dirt
  [3, 2, 2, 2],   // High Dirt
  [4, 9, 1, 4],   // Mud
  [5, 3, 3, 3],   // Water
  [6, 4, 4, 5],   // Grass
  [7, 7, 5, 6],   // High Grass
  [8], [9], [10], [11], [12], [13],
  [14, 5, 7, 9],  // Asphalt
  [15, 6, 8, 10], // Rocky Ground
  [16], [17],
  [18, 8, 6, 7],  // Structure
  [19, 0], [20, 41], [21, 69], [22, 111], [23], [24], [25], [26], [27, 83], [28, 55], [29], [30],
  [31, 97], [32], [33], [34, 13], [35, 27],
]);

const BADLANDS_MAP = [
  5, 35, 0,
  35, 5, 2, 20, 27, 28, 34, 22, 0,
  2, 34, 35, 20, 27, 28, 22, 0,
  34, 2, 3, 20, 21, 27, 28, 35, 22, 0,
  3, 34, 21, 0,
  6, 20, 0,
  20, 6, 2, 35, 34, 27, 28, 22, 0,
  14, 27, 31, 0,
  27, 14, 20, 2, 35, 34, 28, 22, 0,
  15, 28, 0,
  28, 15, 2, 34, 35, 20, 27, 22, 0,
  7, 21, 0,
  21, 7, 3, 34, 0,
  18, 31, 0,
  31, 18, 14, 0,
  4, 22, 0,
  22, 4, 2, 34, 35, 20, 27, 28, 0,
  0,
];

const PLATFORM = rows([
  [0, 3], [1],
  [2, 1, 0, 1],    // Space
  [3, 2, 3, 3],    // Platform
  [4, 11, 5, 4],   // Plating
  [5, 4, 7, 5],    // High Platform
  [6, 12, 8, 6],   // High Plating
  [7, 8, 6, 7],    // Solar Array
  [8, 9, 1, 8],    // Low Platform
  [9, 10, 2, 9],   // Rusty Pit
  [10, 13, 9, 10], // Elevated Catwalk
  [11, 14, 4, 2],  // Dark Platform
  [12, 0], [13, 136], [14, 94], [15, 108], [16, 52], [17, 66], [18, 80], [19, 122], [20, 24], [21, 38],
]);

const PLATFORM_MAP = [
  2, 20, 0,
  20, 2, 3, 16, 14, 21, 13, 0,
  3, 20, 21, 16, 17, 18, 14, 19, 13, 0,
  21, 3, 5, 14, 16, 15, 19, 20, 17, 13, 0,
  5, 21, 15, 0,
  7, 16, 0,
  16, 7, 3, 20, 21, 17, 18, 14, 19, 13, 0,
  8, 17, 0,
  17, 8, 3, 16, 14, 21, 13, 0,
  9, 18, 0,
  18, 9, 3, 16, 14, 13, 0,
  4, 14, 0,
  14, 4, 3, 20, 21, 16, 17, 18, 19, 13, 0,
  6, 15, 0,
  15, 6, 5, 21, 0,
  10, 19, 0,
  19, 10, 3, 16, 14, 21, 13, 0,
  11, 13, 0,
  13, 11, 3, 20, 21, 16, 17, 18, 14, 19, 0,
  0,
];

const INSTALL = rows([
  [0, 8], [1],
  [2, 1, 0, 1], // Substructure
  [3, 2, 1, 2], // Floor
  [4, 4, 3, 4], // Substructure Plating
  [5, 5, 4, 5], // Plating
  [6, 3, 2, 3], // Roof
  [7, 7, 6, 7], // Bottomless Pit
  [8, 6, 5, 6], // Substructure Panels
  [9, 0], [10, 50], [11, 64], [12, 22], [13, 36], [14, 78], [15, 92],
]);

const INSTALL_MAP = [
  2, 12, 10, 14, 15, 0,
  12, 2, 3, 10, 11, 13, 14, 15, 0,
  3, 12, 13, 11, 0,
  13, 6, 3, 11, 12, 0,
  6, 13, 0,
  4, 10, 0,
  10, 4, 2, 12, 14, 15, 0,
  5, 11, 0,
  11, 5, 3, 12, 13, 0,
  8, 14, 0,
  14, 8, 2, 12, 10, 15, 0,
  7, 15, 0,
  15, 7, 2, 12, 10, 14, 0,
  0,
];

const ASHWORLD = rows([
  [0, 9], [1],
  [2, 2, 1, 2], // Dirt
  [3, 3, 2, 3], // Lava
  [4, 5, 5, 5], // High Dirt
  [5, 6, 6, 6], // High Lava
  [6, 4, 3, 4], // Shale
  [7, 7, 7, 7], // High Shale
  [8, 1, 0, 1], // Magma
  [9, 8, 4, 8], // Broken Rock
  [10, 0], [11, 55], [12, 69], [13, 83], [14, 97], [15, 111], [16, 41], [17, 27],
]);

const ASHWORLD_MAP = [
  8, 17, 0,
  17, 8, 2, 11, 13, 16, 15, 0,
  2, 17, 16, 11, 13, 15, 0,
  3, 11, 0,
  11, 3, 2, 17, 16, 13, 15, 0,
  6, 13, 0,
  13, 6, 2, 17, 16, 11, 15, 0,
  9, 15, 0,
  15, 9, 13, 2, 17, 16, 11, 0,
  16, 2, 4, 11, 13, 12, 14, 17, 15, 0,
  4, 16, 12, 14, 0,
  5, 12, 0,
  12, 5, 4, 16, 14, 0,
  7, 14, 0,
  14, 7, 4, 16, 12, 0,
  0,
];

/** Jungle, Desert, Ice and Twilight share one layout; only the names differ. */
const JUNGLE_FAMILY = rows([
  [0, 14], [1],
  [2, 1, 1, 1],     // Dirt / Snow
  [3, 2, 8, 2],     // High Dirt / High Snow
  [4, 13, 2, 4],    // Mud / Dried Mud / Moguls
  [5, 3, 0, 3],     // Water / Tar / Ice
  [6], [7],
  [8, 4, 3, 8],     // Jungle / Sand Dunes / Dirt / Crushed Rock
  [9, 5, 6, 11],    // Raised Jungle / Sandy Sunken Pit / Water / Sunken Ground
  [10, 9, 9, 14],   // High Jungle / …
  [11, 7, 5, 12],   // Ruins / Crags / Grass / Flagstones
  [12, 10, 10, 15], // High Ruins / …
  [13, 11, 11, 16], // High Raised Jungle / …
  [14],
  [15, 6, 4, 10],   // Rocky Ground / Rocky Snow / Crevices
  [16, 8, 7, 13],   // Temple / Compound / Outpost / Basilica
  [17, 12, 12, 17], // High Temple / …
  [18],
  [19, 0], [20], [21],
  [22, 171], [23, 45], [24, 115], [25, 87], [26, 129], [27], [28, 59], [29, 73], [30, 143], [31],
  [32, 101], [33, 157], [34, 17], [35, 31],
]);

const JUNGLE_MAP = [
  5, 35, 0,
  35, 5, 2, 23, 28, 34, 22, 0,
  2, 34, 35, 23, 28, 22, 0,
  34, 2, 3, 24, 23, 28, 35, 22, 0,
  3, 34, 24, 0,
  8, 23, 29, 25, 32, 0,
  4, 22, 0,
  22, 4, 2, 34, 35, 23, 28, 0,
  23, 8, 2, 35, 34, 28, 25, 29, 22, 0,
  15, 28, 0,
  28, 15, 2, 34, 35, 23, 22, 0,
  9, 29, 0,
  29, 9, 8, 25, 32, 23, 0,
  11, 25, 0,
  25, 11, 8, 23, 29, 32, 0,
  16, 32, 0,
  32, 16, 8, 25, 29, 0,
  10, 24, 26, 30, 33, 0,
  24, 10, 3, 34, 26, 30, 0,
  12, 26, 0,
  26, 12, 10, 24, 30, 33, 0,
  13, 30, 0,
  30, 13, 10, 26, 24, 33, 0,
  17, 33, 0,
  33, 17, 10, 26, 30, 0,
  0,
];

export interface IsomTilesetTables {
  terrainTypes: readonly IsomTerrainType[];
  terrainTypeMap: readonly number[];
}

/** Indexed by ERA (0 badlands … 7 twilight). */
export const ISOM_TABLES: readonly IsomTilesetTables[] = [
  { terrainTypes: BADLANDS, terrainTypeMap: BADLANDS_MAP },
  { terrainTypes: PLATFORM, terrainTypeMap: PLATFORM_MAP },
  { terrainTypes: INSTALL, terrainTypeMap: INSTALL_MAP },
  { terrainTypes: ASHWORLD, terrainTypeMap: ASHWORLD_MAP },
  { terrainTypes: JUNGLE_FAMILY, terrainTypeMap: JUNGLE_MAP },
  { terrainTypes: JUNGLE_FAMILY, terrainTypeMap: JUNGLE_MAP },
  { terrainTypes: JUNGLE_FAMILY, terrainTypeMap: JUNGLE_MAP },
  { terrainTypes: JUNGLE_FAMILY, terrainTypeMap: JUNGLE_MAP },
];

/** The ISOM value a flat diamond of terrain `index` stores, or 0 when the tileset has no such brush. */
export function isomValueOf(era: number, index: number): number {
  return ISOM_TABLES[era]?.terrainTypes[index]?.isomValue ?? 0;
}
