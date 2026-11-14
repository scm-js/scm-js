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
 * Where the groups a data set adds to the game's begin, on a tileset of `groups` groups with ERA
 * index `era`, or null when it adds none: when the table is longer than any of the game's
 * (Remastered's is the longer), the groups past the 1.16 table's end. A mod's table is laid over
 * 1.16's and goes on from its end (Cosmonarchy's Badlands: 1,665 groups to 4,094, every added
 * one untyped); a mod made over Remastered's table would count Remastered's own additions among
 * its groups too, which no file says otherwise.
 */
export function addedGroupsFrom(era: number, groups: number): number | null {
  const { classic, remastered } = tileGroupRanges(era);
  return groups > remastered ? classic : null;
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

const lackTables = new Map<number, Uint8Array>();

/**
 * Which groups a tileset of `groups` groups on ERA `era` has not got: a byte for each of the
 * 4,096 groups a tile can name (index `(tile >> 4) & 0xfff`), 1 where `tilesetHasTile`
 * refuses the group. One table per era and length, kept: the answer depends on nothing else,
 * so the drawing asks a byte per tile, not the rule.
 */
export function missingGroups(era: number, groups: number): Uint8Array {
  const key = (era & 7) * 8192 + Math.max(0, Math.min(groups, 4096));
  let table = lackTables.get(key);
  if (!table) {
    table = new Uint8Array(4096);
    for (let group = 0; group < 4096; group++) table[group] = tilesetHasTile(era, group << 4, groups) ? 0 : 1;
    lackTables.set(key, table);
  }
  return table;
}

/**
 * `missingGroups`' table when `tiles` holds a tile the tileset has not got, and null when it
 * has them all — which is what lets a map with all its terrain be drawn exactly as before.
 * It reads every tile, so a caller that repaints asks through `mapLacks`.
 */
export function lackedGroups(tiles: ArrayLike<number>, era: number, groups: number): Uint8Array | null {
  const table = missingGroups(era, groups);
  for (let i = 0; i < tiles.length; i++) if (table[(tiles[i] >> 4) & 0xfff] === 1) return table;
  return null;
}

/** Whether `lacks` (a `missingGroups` table, or null for a map with all its terrain) marks the tile as one the tileset has not got. */
export const isLackedTile = (lacks: Uint8Array | null, tile: number): boolean => lacks !== null && lacks[(tile >> 4) & 0xfff] === 1;

interface Lacks {
  era: number;
  groups: number;
  revision: number;
  table: Uint8Array | null;
}
const lacksOf = new WeakMap<object, Lacks>();

/**
 * `lackedGroups`, worked out once for a tile array, tileset and `revision` (a number that
 * moves whenever the tiles change: the terrain and doodad revisions) and kept, so a repaint
 * of the same ground costs a lookup.
 */
export function mapLacks(tiles: ArrayLike<number>, era: number, groups: number, revision: number): Uint8Array | null {
  const was = lacksOf.get(tiles);
  if (was && was.era === era && was.groups === groups && was.revision === revision) return was.table;
  const table = lackedGroups(tiles, era, groups);
  lacksOf.set(tiles, { era, groups, revision, table });
  return table;
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
