import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { decodeCv5, TileFlag, type Tileset } from "../src/formats/tileset/decode";
import {
  copiedTerrains, isLoosePair, isPairTerrain, pairTerrain, pairTerrainGroup, pairTerrainId, terrainCopies, terrainKeyOfTile, terrainOf,
  tileGroups, tileInfo,
} from "../src/formats/tileset/palette";
import { flatGroupOf, laidPairAt, laidPairs, LAID_PAIR_MIN, matchingTiles, replaceTerrain } from "../src/editor/terrain";

/**
 * Flat ground a tileset holds without typing it: the pairs a mod adds past the game's groups,
 * every one with CV5 `index` 0 and no ISOM links. Made here from nothing of anyone's — solid
 * colour minitiles — in the layout Cosmonarchy's Jungle has: the game's pair, the same pictures
 * again under raised VF4 heights, and new pictures the files say nothing about.
 */

const NAMES = [{ id: 2, name: "Dirt" }, { id: 3, name: "Mud" }];

/** Megatile `m` shows minitile `pictures[m]` in all sixteen places; several megatiles may share a picture. */
function tilesetOf(o: {
  pictures: number[];
  /** VF4 flags of every minitile of megatile `m`; walkable low ground where not given. */
  flags?: Record<number, number>;
  groups: Record<number, { index: number; megatiles: number[]; unbuildable?: boolean; edges?: number }>;
}): Tileset {
  const megatileCount = o.pictures.length;
  const kinds = Math.max(...o.pictures) + 1;
  // Minitile k is filled with palette index k, and a second copy of every minitile sits `kinds` on
  // with the same pixels, so two megatiles can hold one picture through different minitiles.
  const minitiles = new Uint8Array(kinds * 2 * 64);
  for (let k = 0; k < kinds * 2; k++) minitiles.fill(k % kinds, k * 64, (k + 1) * 64);
  const megatileRefs = new Uint32Array(megatileCount * 16);
  const megatileFlags = new Uint16Array(megatileCount * 16);
  o.pictures.forEach((k, m) => {
    // Odd megatiles go through the second copy of the minitile: equal pixels, unequal refs.
    megatileRefs.fill((m % 2 === 1 ? k + kinds : k) << 1, m * 16, m * 16 + 16);
    megatileFlags.fill(o.flags?.[m] ?? TileFlag.Walkable, m * 16, m * 16 + 16);
  });
  const count = Math.max(...Object.keys(o.groups).map(Number)) + 1;
  const cv5 = new Uint8Array(count * 52);
  const view = new DataView(cv5.buffer);
  for (const [g, def] of Object.entries(o.groups)) {
    const at = Number(g) * 52;
    view.setUint16(at, def.index, true);
    view.setUint16(at + 2, def.unbuildable ? 0x80 : 0, true);
    for (let e = 0; e < 4; e++) view.setUint16(at + 4 + e * 2, def.edges ?? 0, true);
    def.megatiles.forEach((m, slot) => view.setUint16(at + 20 + slot * 2, m, true));
  }
  const palette = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) palette.set([i * 20, i * 10, i * 5, 255], i * 4);
  return { palette, minitiles, megatileRefs, megatileCount, extended: true, megatileFlags, groups: decodeCv5(cv5) };
}

const MID = TileFlag.Walkable | TileFlag.MidGround;
const HIGH = TileFlag.Walkable | TileFlag.HighGround;

/**
 * Megatiles 1–4 are Dirt (left 1, 2; right 3, 4), pictures 1–4. 5–8 are the same four pictures
 * with the mid flag, 9–12 with the high flag, 13–16 the same pictures and the same flags as Dirt,
 * 17–20 pictures nobody else has, on high ground. 21 is a filler megatile.
 */
function modTileset(): Tileset {
  const pictures = [0, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const flags: Record<number, number> = {};
  for (const m of [5, 6, 7, 8]) flags[m] = MID;
  for (const m of [9, 10, 11, 12, 17, 18, 19, 20]) flags[m] = HIGH;
  return tilesetOf({
    pictures,
    flags,
    groups: {
      2: { index: 2, megatiles: [1, 2], edges: 1 },
      3: { index: 2, megatiles: [3, 4], edges: 1 },
      4: { index: 0, megatiles: [5, 6] }, // Dirt's pictures, mid ground
      5: { index: 0, megatiles: [7, 8] },
      6: { index: 0, megatiles: [9, 10] }, // Dirt's pictures, high ground
      7: { index: 0, megatiles: [11, 12] },
      8: { index: 0, megatiles: [13, 14] }, // Dirt again, flag for flag
      9: { index: 0, megatiles: [15, 16] },
      10: { index: 0, megatiles: [17, 18] }, // new pictures
      11: { index: 0, megatiles: [19, 20] },
      12: { index: 0, megatiles: [21] }, // filler: the same megatile on both sides
      13: { index: 0, megatiles: [21] },
      14: { index: 0, megatiles: [5, 9] }, // two heights in one group
      15: { index: 0, megatiles: [7, 11] },
      16: { index: 0, megatiles: [5, 6] }, // the slots do not line up
      17: { index: 0, megatiles: [7] },
      18: { index: 0, megatiles: [1, 2] }, // Dirt's megatiles themselves, unbuildable
      19: { index: 0, megatiles: [3, 4], unbuildable: true },
    },
  });
}

describe("a pair the tileset does not type", () => {
  const ts = modTileset();

  it("is two index-0 groups with a left and a right, the same slots, one height, one buildability", () => {
    expect([4, 6, 8, 10].map((g) => isLoosePair(ts, g))).toEqual([true, true, true, true]);
    expect(isLoosePair(ts, 2)).toBe(false); // typed: the game's own terrain
    expect(isLoosePair(ts, 5)).toBe(false); // odd
    expect(isLoosePair(ts, 12)).toBe(false); // filler
    expect(isLoosePair(ts, 14)).toBe(false); // two heights
    expect(isLoosePair(ts, 16)).toBe(false); // slots differ
    expect(isLoosePair(ts, 18)).toBe(false); // one half buildable, the other not
    expect(isLoosePair(ts, 40)).toBe(false); // past the table
  });

  it("has an id no CV5 index can be", () => {
    expect(pairTerrainId(7)).toBe(pairTerrainId(6));
    expect(isPairTerrain(pairTerrainId(6))).toBe(true);
    expect(isPairTerrain(35)).toBe(false);
    expect(pairTerrainGroup(pairTerrainId(4094))).toBe(4094);
  });
});

describe("the game's ground under other flags", () => {
  const ts = modTileset();

  it("is found by its pictures, whichever minitiles they come through", () => {
    const copies = terrainCopies(ts);
    expect([...copies.keys()].sort((a, b) => a - b)).toEqual([4, 6]);
    expect(copies.get(4)).toEqual({ group: 4, source: 2, sourceGroup: 2 });
  });

  it("leaves out the same ground again and pictures the game does not have", () => {
    const copies = terrainCopies(ts);
    expect(copies.has(8)).toBe(false); // flag for flag Dirt
    expect(copies.has(10)).toBe(false); // new pictures
  });

  it("is named after the ground and its height, low ground first", () => {
    expect(copiedTerrains(ts, NAMES).map((t) => [t.name, t.group, t.height, t.buildable])).toEqual([
      ["Dirt (mid ground)", 4, 1, true],
      ["Dirt (high ground)", 6, 2, true],
    ]);
    expect(copiedTerrains(null, NAMES)).toEqual([]);
    // Without a name for the source there is nothing to call it.
    expect(copiedTerrains(ts, [])).toEqual([]);
  });

  it("is listed as flat terrain where the groups are browsed", () => {
    const groups = tileGroups(ts, NAMES);
    expect(groups.find((g) => g.group === 4)).toMatchObject({ kind: "terrain", label: "Dirt (mid ground) L" });
    expect(groups.find((g) => g.group === 7)).toMatchObject({ kind: "terrain", label: "Dirt (high ground) R" });
    expect(groups.find((g) => g.group === 10)).toMatchObject({ kind: "other" });
    expect(tileInfo(ts, NAMES, (5 << 4) | 1)).toMatchObject({ kind: "terrain", label: "Dirt (mid ground)", height: 1 });
  });

  it("takes a duplicate that differs only in buildability as a copy", () => {
    const twice = tilesetOf({
      pictures: [0, 1, 2, 3, 4, 1, 2, 3, 4],
      groups: {
        2: { index: 2, megatiles: [1, 2], edges: 1 },
        3: { index: 2, megatiles: [3, 4], edges: 1 },
        4: { index: 0, megatiles: [5, 6], unbuildable: true },
        5: { index: 0, megatiles: [7, 8], unbuildable: true },
      },
    });
    expect(copiedTerrains(twice, NAMES).map((t) => [t.name, t.buildable])).toEqual([["Dirt (low ground)", false]]);
  });

  it("is not a copy of one terrain when its pictures are two terrains'", () => {
    const mixed = tilesetOf({
      pictures: [0, 1, 2, 3, 4, 1, 3, 2, 4],
      flags: { 5: MID, 6: MID, 7: MID, 8: MID },
      groups: {
        2: { index: 2, megatiles: [1], edges: 1 },
        3: { index: 2, megatiles: [2], edges: 1 },
        4: { index: 3, megatiles: [3], edges: 2 },
        5: { index: 3, megatiles: [4], edges: 2 },
        6: { index: 0, megatiles: [5, 6] }, // one Dirt picture, one Mud picture
        7: { index: 0, megatiles: [7, 8] },
      },
    });
    expect(terrainCopies(mixed).size).toBe(0);
  });
});

describe("a pair as a terrain", () => {
  const ts = modTileset();

  it("is named by its group when the files say nothing more", () => {
    expect(pairTerrain(ts, NAMES, 10)).toMatchObject({ id: pairTerrainId(10), name: "Group 10", group: 10, height: 2, buildable: true });
    expect(pairTerrain(ts, NAMES, 12)).toBeNull();
  });

  it("answers to its id beside the game's terrains", () => {
    expect(terrainOf(ts, NAMES, 2)).toMatchObject({ name: "Dirt", group: 2 });
    expect(terrainOf(ts, NAMES, pairTerrainId(4))).toMatchObject({ name: "Dirt (mid ground)", group: 4 });
    expect(terrainOf(ts, NAMES, pairTerrainId(12))).toBeNull();
    expect(terrainOf(ts, NAMES, 9)).toBeNull();
    expect(terrainOf(null, NAMES, 2)).toBeNull();
  });

  it("is its own terrain to a flood fill, where the game's are their index", () => {
    expect(terrainKeyOfTile(ts, (2 << 4) | 1)).toBe(2);
    expect(terrainKeyOfTile(ts, 3 << 4)).toBe(2);
    expect(terrainKeyOfTile(ts, 10 << 4)).toBe(pairTerrainId(10));
    expect(terrainKeyOfTile(ts, (11 << 4) | 1)).toBe(pairTerrainId(10));
    expect(terrainKeyOfTile(ts, 4 << 4)).not.toBe(terrainKeyOfTile(ts, 10 << 4));
  });
});

describe("pairs a map lays as ground", () => {
  const ts = modTileset();
  const map = () => createScenario({ width: 16, height: 8, era: 4, name: "t" });
  /** Lay `pairs` whole pairs of `group` along row `y` from column `x` (even). */
  const lay = (scn: ReturnType<typeof map>, group: number, y: number, x: number, pairs: number) => {
    for (let i = 0; i < pairs; i++) {
      const slot = i % 2;
      scn.tiles[y * scn.width + x + i * 2] = (group << 4) | slot;
      scn.tiles[y * scn.width + x + i * 2 + 1] = ((group + 1) << 4) | slot;
    }
  };

  it("are the untyped pairs laid left and right in step, often enough", () => {
    const scn = map();
    lay(scn, 10, 0, 0, LAID_PAIR_MIN);
    lay(scn, 4, 1, 0, LAID_PAIR_MIN - 1); // one short
    lay(scn, 2, 2, 0, 8); // the game's own: typed, never listed here
    expect(laidPairs(scn, ts)).toEqual([10]);
    lay(scn, 4, 3, 0, 1);
    expect(laidPairs(scn, ts)).toEqual([4, 10]);
  });

  it("do not count tiles that only sit side by side", () => {
    const scn = map();
    for (let x = 0; x < 16; x += 2) {
      // The right half on the even column, or the halves in different variations: seam pieces, not ground.
      scn.tiles[x] = 11 << 4;
      scn.tiles[x + 1] = 10 << 4;
      scn.tiles[16 + x] = 10 << 4;
      scn.tiles[16 + x + 1] = (11 << 4) | 1;
    }
    expect(laidPairs(scn, ts)).toEqual([]);
  });

  it("are found under a pick only where the pair is whole", () => {
    const scn = map();
    lay(scn, 10, 0, 2, 1);
    expect(laidPairAt(scn, ts, 2, 0)).toBe(10);
    expect(laidPairAt(scn, ts, 3, 0)).toBe(10);
    scn.tiles[16 + 4] = 10 << 4; // a left half on its own
    expect(laidPairAt(scn, ts, 4, 1)).toBe(-1);
    scn.tiles[32 + 6] = 2 << 4; // the game's Dirt: typed
    scn.tiles[32 + 7] = 3 << 4;
    expect(laidPairAt(scn, ts, 6, 2)).toBe(-1);
  });

  it("are matched and written by Replace Terrain like any terrain", () => {
    const scn = map();
    lay(scn, 2, 0, 0, 8);
    lay(scn, 10, 1, 0, 8);
    const dirt = { kind: "terrain", id: 2 } as const;
    const high = { kind: "terrain", id: pairTerrainId(6) } as const;
    const added = { kind: "terrain", id: pairTerrainId(10) } as const;
    expect(flatGroupOf(ts, high.id)).toBe(6);
    expect(flatGroupOf(ts, pairTerrainId(12))).toBe(-1);
    expect(matchingTiles(scn, ts, added)).toEqual(Array.from({ length: 16 }, (_, i) => 16 + i));
    expect(matchingTiles(scn, null, added)).toEqual([]);

    // Dirt becomes the high-ground copy, left and right halves in step.
    const up = replaceTerrain(scn, ts, dirt, high, undefined, () => 0);
    expect(up).toHaveLength(16);
    expect(up.map((c) => c.after >> 4)).toEqual(Array.from({ length: 16 }, (_, i) => 6 + (i % 2)));
    expect(up[0].after & 15).toBe(up[1].after & 15);

    // And an added pair goes back to the game's terrain.
    const back = replaceTerrain(scn, ts, added, dirt, { x0: 0, y0: 1, x1: 4, y1: 2 }, () => 0);
    expect(back.map((c) => c.at)).toEqual([16, 17, 18, 19]);
    expect(back.map((c) => c.after >> 4)).toEqual([2, 3, 2, 3]);
  });
});
