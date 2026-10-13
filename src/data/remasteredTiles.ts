/**
 * Which tiles only StarCraft: Remastered has. Remastered added doodads to seven of the
 * eight tilesets, and with them tile groups the 1.16 tables do not hold: every group past
 * the end of the 1.16 table, and on three tilesets a run of groups below 1024 that 1.16
 * had left empty and Remastered filled. A map that uses one of these tiles is drawn only
 * from Remastered's files.
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

/** Whether a tile (an MTXM value) is one only Remastered's tables have, on the tileset with ERA index `era`. */
export function isRemasteredOnlyTile(era: number, tile: number): boolean {
  const group = tile >> 4;
  const [classic, remastered, filledFrom] = GROUPS[era & 7];
  if (group >= classic) return group < remastered;
  return group >= filledFrom && group < FIRST_DOODAD_GROUP;
}
