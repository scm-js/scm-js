/**
 * Base terrain: the flat ground each tileset's ISOM palette is built from, and the fill
 * a brand new map is made of.
 *
 * CV5 groups come in left/right pairs, because an ISOM diamond is two tiles wide: flat
 * ground alternates group `g` on even columns with `g + 1` on odd ones, both using the
 * same variation slot. A pair's `index` field is its ISOM terrain id.
 */
import type { Tileset } from "./decode";

export interface BaseTerrain {
  /** CV5 group `index`, which is also the ISOM terrain id. */
  id: number;
  /** Even CV5 group of the pair; odd columns use `group + 1`. */
  group: number;
}

/** Groups 2/3 are the tileset's base ground (ISOM id 2) — used when graphics are missing. */
export const DIRT: BaseTerrain = { id: 2, group: 2 };

/** Doodad groups mark themselves with index 1. */
const DOODAD_INDEX = 1;

/**
 * The terrain a new map is filled with: the pair carrying `isomId`, or the lowest-id
 * pair that has real graphics — ISOM id 2 is the base ground everywhere except Space
 * Platform, where it is the empty void.
 *
 * Ids are not the order the palette lists terrain in (badlands numbers High Dirt 3 and
 * Mud 4, while StarEdit shows Mud first), so callers name the terrain they want by id.
 */
export function baseTerrain(tileset: Tileset | null, isomId?: number): BaseTerrain {
  if (!tileset) return DIRT;

  let fallback: BaseTerrain | null = null;
  for (let g = 2; g + 1 < tileset.groups.length; g += 2) {
    const id = tileset.groups[g].index;
    if (id === 0 || id === DOODAD_INDEX) continue;
    if (tileset.groups[g + 1].index !== id) continue; // not a left/right pair
    if (id === isomId) return { id, group: g };
    // Megatile 0 is the null megatile: a group holding it draws as black.
    if (tileset.groups[g].megatiles[0] === 0) continue;
    if (!fallback || id < fallback.id) fallback = { id, group: g };
  }
  return fallback ?? DIRT;
}

export interface TerrainFill {
  tiles: Uint16Array;
  isom: Uint16Array;
}

/** Megatile slot 0 is the null megatile, so a slot holding it is an unused variation. */
export interface Variations {
  /** Slots before the group's first gap: what flat ground is nearly always made of. */
  common: number[];
  /** Slots past the gap — the occasional cracked/scorched tile. */
  rare: number[];
}

/** Real maps draw a rare variation roughly one tile in twenty; StarCraft's own odds. */
const RARE_ODDS = 16;

export function variationsOf(tileset: Tileset | null, group: number): Variations {
  const megatiles = tileset?.groups[group]?.megatiles;
  if (!megatiles) return { common: [0], rare: [] };

  const common: number[] = [];
  const rare: number[] = [];
  let gap = false;
  for (let slot = 0; slot < megatiles.length; slot++) {
    if (megatiles[slot] === 0) { gap = true; continue; }
    (gap ? rare : common).push(slot);
  }
  return { common: common.length > 0 ? common : [0], rare };
}

/**
 * A map of nothing but one flat terrain, laid out the way StarEdit writes a new
 * scenario: MTXM in left/right pairs with a random variation, and ISOM as the two flat
 * quads that alternate across the diamond grid.
 */
/** One variation slot, weighted the way StarEdit weights them. */
export function pickVariation({ common, rare }: Variations, random: () => number = Math.random): number {
  const set = rare.length > 0 && random() * RARE_ODDS < 1 ? rare : common;
  return set[Math.min(set.length - 1, Math.floor(random() * set.length))];
}

export function flatTerrain(
  width: number,
  height: number,
  terrain: BaseTerrain,
  tileset: Tileset | null,
  random: () => number = Math.random,
): TerrainFill {
  const variations = variationsOf(tileset, terrain.group);
  const pick = () => pickVariation(variations, random);

  const tiles = new Uint16Array(width * height);
  const left = terrain.group << 4;
  const right = (terrain.group + 1) << 4;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x += 2) {
      const slot = pick();
      tiles[row + x] = left | slot;
      if (x + 1 < width) tiles[row + x + 1] = right | slot;
    }
  }

  // Each ISOM cell is four u16 (left, top, right, bottom). A terrain owns a block of
  // sixteen consecutive values starting at id * 8, and flat ground alternates these two
  // quads from that block by cell parity.
  const base = terrain.id * 8;
  const even = [base + 8, base + 10, base + 0, base + 2];
  const odd = [base + 4, base + 12, base + 14, base + 6];
  const cellsW = Math.floor(width / 2) + 1;
  const cellsH = height + 1;
  const isom = new Uint16Array(cellsW * cellsH * 4);
  for (let cy = 0; cy < cellsH; cy++) {
    for (let cx = 0; cx < cellsW; cx++) {
      isom.set((cx + cy) % 2 === 0 ? even : odd, (cy * cellsW + cx) * 4);
    }
  }

  return { tiles, isom };
}
