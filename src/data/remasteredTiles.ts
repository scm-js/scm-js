/**
 * Which tiles only StarCraft: Remastered has. Remastered added doodads to seven of the
 * eight tilesets, and with them tile groups the 1.16 tables do not hold: every group past
 * the end of the 1.16 table, and on three tilesets a run of groups below 1024 that 1.16
 * had left empty and Remastered filled. A map that uses one of these tiles is drawn only
 * from Remastered's files. A group past Remastered's table too is no StarCraft's: the map
 * was made on a mod's tileset (Cosmonarchy's Jungle has 4,095 groups).
 *
 * The figures are the tile tables' own, measured from both sets of files
 * (`tests/remastered.test.ts` checks them against the real ones when it can): per tileset,
 * in ERA order, the number of groups in the 1.16 table, the number in Remastered's, and
 * the first of the low groups Remastered filled (1024 where it filled none).
 */
const GROUPS: readonly (readonly [classic: number, remastered: number, filledFrom: number])[] = [
  [1665, 1979, 1024], // Badlands
  [1513, 2046, 933],  // Space Platform
  [1265, 1265, 1024], // Installation
  [1262, 1418, 1024], // Ashworld
  [1578, 2046, 1024], // Jungle
  [1520, 2046, 770],  // Desert
  [1415, 2039, 1024], // Ice
  [1494, 2047, 797],  // Twilight
];

/** Doodad groups start here; the groups below are terrain, which is where 1.16 had room left. */
const FIRST_DOODAD_GROUP = 1024;

/** The group counts and filled range for a tileset, by its ERA index. */
export function tileGroupRanges(era: number): { classic: number; remastered: number; filledFrom: number } {
  const [classic, remastered, filledFrom] = GROUPS[era & 7];
  return { classic, remastered, filledFrom };
}

/**
 * The group an MTXM value names with all twelve bits above the slot, bit 15 included: what a
 * mod's extended tileset reads (`decode.ts#tileGroupOf` past 2,048 groups). The game's own
 * tilesets take bit 15 as the creep flag, but maps made for them do not set it (of some 600
 * on hand, Blizzard's and the ladder's, only a probe made to test the flag does), while a
 * map made on a mod's extended tileset sets it on every tile past group 2,047 (291 of
 * Cosmonarchy's 404 maps). So the questions here — whose tile is this, and has
 * the data set in use got it — are asked of the whole group; drawing keeps the game's rule.
 */
const fullGroup = (tile: number): number => (tile >> 4) & 0xfff;

/** Whether a tile (an MTXM value) is one only Remastered's tables have, on the tileset with ERA index `era`. */
export function isRemasteredOnlyTile(era: number, tile: number): boolean {
  const group = fullGroup(tile);
  const [classic, remastered, filledFrom] = GROUPS[era & 7];
  if (group >= classic) return group < remastered;
  return group >= filledFrom && group < FIRST_DOODAD_GROUP;
}

/**
 * Whether a tile's group is past Remastered's table too: terrain no StarCraft has, in 1.16.1
 * or Remastered, so the map was made on a mod's tileset.
 */
export function isModTile(era: number, tile: number): boolean {
  return fullGroup(tile) >= GROUPS[era & 7][1];
}

/**
 * Whether a tileset of `groups` groups (the one the data set in use gave for ERA `era`) has
 * the tile. A group past its table it has not; nor, when its table is shorter than
 * Remastered's, one of the low groups 1.16 left empty and Remastered filled, which a 1.16
 * table holds with no picture.
 */
export function tilesetHasTile(era: number, tile: number, groups: number): boolean {
  const group = fullGroup(tile);
  if (group >= groups) return false;
  const [classic, remastered] = GROUPS[era & 7];
  return !(group < classic && groups < remastered && isRemasteredOnlyTile(era, tile));
}

/** What of a map's terrain a tileset has not got: tiles from past Remastered's table (a mod's), and from Remastered's additions. */
export interface MissingTerrain {
  mod: number;
  remastered: number;
}

/** Count the tiles of a map on ERA `era` that a tileset of `groups` groups has not got, by whose they are. */
export function missingTerrain(tiles: ArrayLike<number>, era: number, groups: number): MissingTerrain {
  const out: MissingTerrain = { mod: 0, remastered: 0 };
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (tilesetHasTile(era, tile, groups)) continue;
    if (isModTile(era, tile)) out.mod++;
    else if (isRemasteredOnlyTile(era, tile)) out.remastered++;
  }
  return out;
}
