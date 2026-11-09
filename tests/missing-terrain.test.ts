import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { archiveExtrasAtom } from "../src/atoms/documentAtoms";
import { gameDataSourceAtom } from "../src/atoms/gameDataAtoms";
import { toastsAtom } from "../src/atoms/uiAtoms";
import { fillTerrain, type MinimapTileset } from "../src/components/panels/minimapTerrain";
import { missingTileRgb, onMissingLine } from "../src/components/viewport/missingTile";
import { isLackedTile, isModTile, isRemasteredOnlyTile, lackedGroups, mapLacks, missingGroups, missingTerrain, tilesetHasTile } from "../src/data/remasteredTiles";
import { createScenario } from "../src/formats/chk/create";
import { megatileForTile } from "../src/formats/tileset/decode";
import { DEFAULT_PROFILE, REMASTERED_PROFILE, type GameDataProfile } from "../src/gamedata/profiles";
import type { AssetSource } from "../src/gamedata/source";
import { clearStoredCopy, keepInMemory } from "../src/gamedata/store";
import { encodeDataSet } from "../src/services/mapDataSet";
import { offerOrder, otherSetTables, setWithTerrain, updateMissingTerrain } from "../src/services/missingTerrain";

const JUNGLE = 4, DESERT = 5;
const game: AssetSource = { kind: "bundled", label: "", tried: [], profile: DEFAULT_PROFILE, base: "/" };
const remastered: AssetSource = { kind: "stored", label: "", tried: [], profile: REMASTERED_PROFILE };
const mod: AssetSource = { kind: "stored", label: "", tried: [], profile: { id: "cosmonarchy", name: "Cosmonarchy" } };

/** A Jungle map with BattleGuard's highest tile: group 3,734, bit 15 set. */
function modMap() {
  const scn = createScenario({ width: 64, height: 64, era: JUNGLE, name: "m" });
  scn.tiles[10] = (3734 << 4) | 5;
  return scn;
}

describe("whose terrain a tile is, by its whole group", () => {
  it("tells a mod's tile from Remastered's additions, bit 15 included", () => {
    const tile = (3734 << 4) | 5;
    expect(isModTile(JUNGLE, tile)).toBe(true);
    expect(isRemasteredOnlyTile(JUNGLE, tile)).toBe(false); // eleven bits would read 1,686, one Remastered added
    expect(isModTile(JUNGLE, 2045 << 4)).toBe(false);
    expect(isRemasteredOnlyTile(JUNGLE, 2045 << 4)).toBe(true);
    expect(isModTile(JUNGLE, 2046 << 4)).toBe(true);
  });

  it("has a tile only when the loaded table holds it, with a picture", () => {
    const tile = (3734 << 4) | 5;
    expect([1578, 2046, 3734, 3735, 4095].map((groups) => tilesetHasTile(JUNGLE, tile, groups))).toEqual([false, false, false, true, true]);
    // Desert's low groups 770–1023: in the 1.16 table, but empty until Remastered filled them.
    expect([1520, 2046, 4095].map((groups) => tilesetHasTile(DESERT, 800 << 4, groups))).toEqual([false, true, true]);
    expect(tilesetHasTile(DESERT, 769 << 4, 1520)).toBe(true);
  });

  it("counts what a tileset has not got, by whose it is", () => {
    const scn = modMap();
    scn.tiles[11] = 1600 << 4;
    expect(missingTerrain(scn.tiles, JUNGLE, 1578)).toEqual({ mod: 1, remastered: 1 });
    expect(missingTerrain(scn.tiles, JUNGLE, 2046)).toEqual({ mod: 1, remastered: 0 });
    expect(missingTerrain(scn.tiles, JUNGLE, 4095)).toEqual({ mod: 0, remastered: 0 });
  });
});

/** A data set kept here (in memory, as where there is no private file storage) whose Jungle table has `groups` groups. */
function keep(profile: GameDataProfile, groups: number, file = "jungle") {
  keepInMemory(new Map([[`tileset/${file}.cv5`, new Uint8Array(groups * 52)]]), { from: "test", at: "", files: 1, bytes: 0, summary: "", profile }, profile.id);
}
const COSMONARCHY: GameDataProfile = { id: "cosmonarchy", name: "Cosmonarchy" };
const OTHER_MOD: GameDataProfile = { id: "another-mod", name: "Another Mod" };

describe("the groups a tileset has not got, as the drawing asks", () => {
  it("is the rule's answer for every group, at every length that matters", () => {
    for (const era of [JUNGLE, DESERT]) {
      for (const groups of [0, 1520, 1578, 2046, 3000, 4095, 4096, 5000]) {
        const table = missingGroups(era, groups);
        for (let group = 0; group < 4096; group++) {
          const tile = (group << 4) | (group & 15);
          if ((table[group] === 1) !== !tilesetHasTile(era, tile, groups)) throw new Error(`era ${era}, ${groups} groups, group ${group}`);
        }
      }
    }
    expect(missingGroups(JUNGLE, 1578)).toBe(missingGroups(JUNGLE, 1578)); // one table, kept
  });

  it("marks exactly the tiles the notice counts, and nothing on a map with all its terrain", () => {
    const scn = modMap();
    scn.tiles[11] = 1600 << 4; // one Remastered added
    scn.tiles[12] = (2148 << 4) | 3; // a mod's, which eleven bits read as group 100: a tile with a picture
    scn.tiles[13] = (1577 << 4) | 1; // the last group 1.16 has
    for (const groups of [1578, 2046, 3000, 4095]) {
      const lacks = lackedGroups(scn.tiles, JUNGLE, groups);
      const marked = [...scn.tiles].map((tile, i) => (isLackedTile(lacks, tile) ? i : -1)).filter((i) => i >= 0);
      const missing = [...scn.tiles].map((tile, i) => (tilesetHasTile(JUNGLE, tile, groups) ? -1 : i)).filter((i) => i >= 0);
      expect(marked).toEqual(missing);
      const counted = missingTerrain(scn.tiles, JUNGLE, groups);
      expect(marked.length).toBe(counted.mod + counted.remastered);
    }
    expect(lackedGroups(scn.tiles, JUNGLE, 4095)).toBeNull();
    expect(lackedGroups(createScenario({ width: 64, height: 64, era: JUNGLE, name: "p" }).tiles, JUNGLE, 1578)).toBeNull();
    expect(isLackedTile(null, (3734 << 4) | 5)).toBe(false);
  });

  it("is worked out once for a map, a tileset and a revision of the tiles", () => {
    const scn = modMap();
    const first = mapLacks(scn.tiles, JUNGLE, 1578, 1);
    expect(first).toBe(missingGroups(JUNGLE, 1578));
    scn.tiles[10] = 0; // changed behind its back: the same revision answers from memory
    expect(mapLacks(scn.tiles, JUNGLE, 1578, 1)).toBe(first);
    expect(mapLacks(scn.tiles, JUNGLE, 1578, 2)).toBeNull();
    expect(mapLacks(scn.tiles, JUNGLE, 1578, 2)).toBeNull();
    scn.tiles[10] = (3734 << 4) | 5;
    expect(mapLacks(scn.tiles, JUNGLE, 4095, 2)).toBeNull(); // another tileset: looked at again
    expect(mapLacks(scn.tiles, JUNGLE, 1578, 3)).toBe(first);
  });
});

describe("the marker in the minimap", () => {
  const GREEN = 0x00ff00;
  /** A tileset of `groups` groups, every megatile plain green. */
  const tileset = (groups: number): MinimapTileset => ({
    atlas: { averages: new Uint32Array(groups * 16).fill(GREEN) },
    tileset: { megatileCount: groups * 16, groups: Array.from({ length: groups }, (_, g) => ({ megatiles: new Uint16Array(16).fill(g) })) as never },
  });
  const paint = (tiles: ArrayLike<number>, w: number, h: number, groups: number) => {
    const img = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    fillTerrain(img, w, h, 1, tiles, tileset(groups), false, "#000000", JUNGLE);
    return Array.from({ length: w * h }, (_, i) => (img.data[i * 4] << 16) | (img.data[i * 4 + 1] << 8) | img.data[i * 4 + 2]);
  };

  it("hatches a missing tile, whether the game's rule would read it as nothing or as another tile", () => {
    const w = 8, h = 8;
    const tiles = new Uint16Array(w * h).fill(5 << 4);
    const black = (3734 << 4) | 5, wrong = (2148 << 4) | 3;
    // What the game's rule makes of the two over a 1.16 table: no megatile, and group 100's.
    expect(megatileForTile(tileset(1578).tileset, black)).toBe(-1);
    expect(megatileForTile(tileset(1578).tileset, wrong)).toBe(100);
    for (let x = 0; x < w; x++) { tiles[2 * w + x] = black; tiles[5 * w + x] = wrong; }
    const pixels = paint(tiles, w, h, 1578);
    const marker = new Set([missingTileRgb(0, 0), missingTileRgb(2, 0)]);
    expect(marker.size).toBe(2); // the plate and the line
    expect(marker.has(GREEN) || marker.has(0)).toBe(false);
    for (let y = 0; y < h; y++) {
      const row = pixels.slice(y * w, (y + 1) * w);
      if (y === 2 || y === 5) {
        expect(row.every((rgb) => marker.has(rgb))).toBe(true);
        expect(new Set(row).size).toBe(2); // a few pixels of it already show both
      } else {
        expect(row.every((rgb) => rgb === GREEN)).toBe(true);
      }
    }
    // With the mod's table the same tiles are terrain again.
    expect(paint(tiles, w, h, 4095).every((rgb) => rgb === GREEN)).toBe(true);
  });

  it("lays its lines from the map's corner, the same at every period", () => {
    for (const [period, width] of [[4, 2], [8, 2], [12, 3]]) {
      for (let y = 0; y < period * 2; y++) {
        for (let x = 0; x < period * 2; x++) {
          expect(onMissingLine(x, y, period, width)).toBe(onMissingLine(x + period, y, period, width));
          expect(onMissingLine(x, y, period, width)).toBe(onMissingLine(x + 1, y + 1, period, width));
        }
        expect(Array.from({ length: period }, (_, x) => onMissingLine(x, y, period, width)).filter(Boolean)).toHaveLength(width);
      }
    }
  });
});

describe("a data set already here that has the map's terrain", () => {
  afterEach(async () => { for (const p of [COSMONARCHY, OTHER_MOD, REMASTERED_PROFILE]) await clearStoredCopy(p.id); });

  it("is told by the length of its group table alone", () => {
    const scn = modMap();
    const sets = [{ profile: REMASTERED_PROFILE, groups: 2046 }, { profile: OTHER_MOD, groups: 3734 }, { profile: COSMONARCHY, groups: 4095 }];
    expect(setWithTerrain(scn.tiles, JUNGLE, sets)).toEqual(COSMONARCHY); // group 3,734 needs 3,735 groups
    expect(setWithTerrain(scn.tiles, JUNGLE, sets.slice(0, 2))).toBeNull();
    expect(setWithTerrain(scn.tiles, JUNGLE, [])).toBeNull();
    // A map on what Remastered added: Remastered's copy has it, and so has any longer table after it.
    const added = createScenario({ width: 64, height: 64, era: DESERT, name: "r" });
    added.tiles[3] = 800 << 4;
    expect(setWithTerrain(added.tiles, DESERT, [{ profile: DEFAULT_PROFILE, groups: 1520 }, { profile: REMASTERED_PROFILE, groups: 2046 }, { profile: COSMONARCHY, groups: 4095 }])).toEqual(REMASTERED_PROFILE);
    expect(setWithTerrain(added.tiles, DESERT, [{ profile: DEFAULT_PROFILE, groups: 1520 }, { profile: COSMONARCHY, groups: 4095 }])).toEqual(COSMONARCHY);
  });

  it("prefers the game's own files, then Remastered, then the others as the dialog lists them", () => {
    expect(offerOrder([COSMONARCHY, REMASTERED_PROFILE, OTHER_MOD, DEFAULT_PROFILE]).map((p) => p.id)).toEqual(["starcraft", "remastered", "another-mod", "cosmonarchy"]);
    expect(offerOrder([]).map((p) => p.id)).toEqual(["starcraft"]);
  });

  it("reads the lengths off the stored files, leaving out the copy in use and a set without the tileset", async () => {
    keep(COSMONARCHY, 4095);
    keep(REMASTERED_PROFILE, 2046);
    keep(OTHER_MOD, 3000, "desert");
    expect(await otherSetTables("jungle", game)).toEqual([{ profile: REMASTERED_PROFILE, groups: 2046 }, { profile: COSMONARCHY, groups: 4095 }]);
    expect(await otherSetTables("jungle", remastered)).toEqual([{ profile: COSMONARCHY, groups: 4095 }]);
    expect(await otherSetTables("desert", mod)).toEqual([{ profile: OTHER_MOD, groups: 3000 }]);
    // A set in memory under a stored set's id is not that copy: the copy is still one to offer.
    const folder: AssetSource = { kind: "reader", label: "", tried: [], profile: COSMONARCHY, reader: { read: () => null, base: game } };
    expect((await otherSetTables("jungle", folder)).map((s) => s.profile.id)).toEqual(["remastered", "cosmonarchy"]);
  });

  it("is named in the notice, with a button that switches to it", async () => {
    keep(REMASTERED_PROFILE, 2046);
    keep(COSMONARCHY, 4095);
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    await updateMissingTerrain(store, modMap(), 1578);
    const [toast] = store.get(toastsAtom);
    expect(toast.detail).toBe("1 tile of this Jungle World map is terrain neither StarCraft 1.16.1 nor Remastered has: the map was made for a mod, and here those tiles are drawn hatched. Cosmonarchy, a data set installed here, has this terrain.");
    expect(toast.actions?.map((a) => a.label)).toEqual(["Switch to Cosmonarchy", "Choose the mod's folder…", "Game Data…"]);
    expect(toast.actions?.map((a) => a.keep === true)).toEqual([false, true, false]);
    // A map on Remastered's additions: the Remastered copy before the mod's, and no folder to choose.
    const added = createScenario({ width: 64, height: 64, era: JUNGLE, name: "r" });
    added.tiles[3] = 1600 << 4;
    const other = createStore();
    other.set(gameDataSourceAtom, game);
    await updateMissingTerrain(other, added, 1578);
    expect(other.get(toastsAtom)[0].detail).toBe("1 tile of this Jungle World map is from what StarCraft: Remastered added, which the files in use have not got, so here they are drawn hatched. StarCraft: Remastered, a data set installed here, has this terrain.");
    expect(other.get(toastsAtom)[0].actions?.map((a) => a.label)).toEqual(["Switch to StarCraft: Remastered", "Game Data…"]);
  });
});

describe("the notice when the data set in use lacks a map's terrain", () => {
  const toasts = (store: ReturnType<typeof createStore>) => store.get(toastsAtom);

  it("says it once while the data set stays, and takes it down when the data set has the terrain", async () => {
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    const scn = modMap();
    await updateMissingTerrain(store, scn, 1578);
    expect(toasts(store)).toHaveLength(1);
    expect(toasts(store)[0]).toMatchObject({ kind: "warn", ttl: 0, title: "StarCraft: Brood War has not got some of this map's terrain" });
    expect(toasts(store)[0].detail).toBe("1 tile of this Jungle World map is terrain neither StarCraft 1.16.1 nor Remastered has: the map was made for a mod, and here those tiles are drawn hatched. Choose the mod's folder to draw from its files now, with nothing installed, or add the mod as a data set (Help ▸ Game Data…).");
    expect(toasts(store)[0].actions?.map((a) => a.label)).toEqual(["Choose the mod's folder…", "Game Data…"]);
    // A repaint, or the same answer again, says nothing more.
    await updateMissingTerrain(store, scn, 1578);
    expect(toasts(store)).toHaveLength(1);
    // The switch to the mod: the toast goes while its tileset loads, and nothing comes back.
    store.set(gameDataSourceAtom, mod);
    await updateMissingTerrain(store, scn, null);
    expect(toasts(store)).toEqual([]);
    await updateMissingTerrain(store, scn, 4095);
    expect(toasts(store)).toEqual([]);
    // Back on the game's own the hatching is back, and so is the notice.
    store.set(gameDataSourceAtom, game);
    await updateMissingTerrain(store, scn, null);
    await updateMissingTerrain(store, scn, 1578);
    expect(toasts(store).map((t) => t.title)).toEqual(["StarCraft: Brood War has not got some of this map's terrain"]);
    // Remastered's files lack it too, and that is a data set of its own.
    store.set(gameDataSourceAtom, remastered);
    await updateMissingTerrain(store, scn, 2046);
    expect(toasts(store).map((t) => t.title)).toEqual(["StarCraft: Remastered has not got some of this map's terrain"]);
  });

  it("counts Remastered's additions beside a mod's tiles over a 1.16 copy, since both are hatched", async () => {
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    const scn = modMap();
    scn.tiles.fill(1600 << 4, 20, 23);
    await updateMissingTerrain(store, scn, 1578);
    expect(toasts(store)[0].detail).toBe("1 tile of this Jungle World map is terrain neither StarCraft 1.16.1 nor Remastered has, and 3 more are from what Remastered added: the map was made for a mod, and here those tiles are drawn hatched. Choose the mod's folder to draw from its files now, with nothing installed, or add the mod as a data set (Help ▸ Game Data…).");
  });

  it("goes with the map: another map in front takes it down, and coming back does not repeat it", async () => {
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    const a = modMap(), b = modMap();
    await updateMissingTerrain(store, a, 1578);
    await updateMissingTerrain(store, b, null);
    expect(toasts(store)).toEqual([]);
    await updateMissingTerrain(store, b, 1578);
    expect(toasts(store)).toHaveLength(1);
    await updateMissingTerrain(store, a, 1578);
    expect(toasts(store)).toEqual([]);
  });

  it("is not counted as said for a map that left the front before the toast was up", async () => {
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    const a = modMap(), b = createScenario({ width: 64, height: 64, era: JUNGLE, name: "plain" });
    const first = updateMissingTerrain(store, a, 1578); // still looking at the data sets here
    await updateMissingTerrain(store, b, 1578);
    await first;
    expect(toasts(store)).toEqual([]);
    await updateMissingTerrain(store, a, 1578);
    expect(toasts(store)).toHaveLength(1);
  });

  it("says it again when the same data set, read afresh, lacks another number of tiles", async () => {
    const store = createStore();
    store.set(gameDataSourceAtom, mod);
    const scn = modMap();
    scn.tiles[11] = (3000 << 4) | 1;
    await updateMissingTerrain(store, scn, 2500);
    expect(toasts(store)[0].detail).toMatch(/^2 tiles /);
    await updateMissingTerrain(store, scn, 3500);
    expect(toasts(store).map((t) => t.detail?.slice(0, 7))).toEqual(["1 tile "]);
  });

  it("names Remastered's files for its additions over a 1.16 copy", async () => {
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    const scn = createScenario({ width: 64, height: 64, era: DESERT, name: "r" });
    scn.tiles.fill(800 << 4, 0, 3);
    await updateMissingTerrain(store, scn, 1520);
    expect(toasts(store)[0].detail).toBe("3 tiles of this Desert map are from what StarCraft: Remastered added, which the files in use have not got, so here they are drawn hatched. Help ▸ Game Data… adds StarCraft: Remastered from your installation.");
    expect(toasts(store)[0].actions?.map((a) => a.label)).toEqual(["Game Data…"]);
    // A map of the game's own tiles says nothing.
    const plain = createScenario({ width: 64, height: 64, era: DESERT, name: "p" });
    const other = createStore();
    other.set(gameDataSourceAtom, game);
    await updateMissingTerrain(other, plain, 1520);
    expect(toasts(other)).toEqual([]);
  });

  it("leaves a map that names another data set to the offer to switch, and says nothing without game data", async () => {
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    store.set(archiveExtrasAtom, new Map([["scmjs\\dataset.json", encodeDataSet({ id: "cosmonarchy", name: "Cosmonarchy", hash: "" })]]));
    await updateMissingTerrain(store, modMap(), 1578);
    expect(toasts(store)).toEqual([]);
    // The map names the data set in use, which still lacks the terrain: then it is said.
    store.set(gameDataSourceAtom, mod);
    await updateMissingTerrain(store, modMap(), 3000);
    expect(toasts(store)).toHaveLength(1);
    const none = createStore();
    none.set(gameDataSourceAtom, { kind: "none", label: "", tried: [], profile: DEFAULT_PROFILE });
    await updateMissingTerrain(none, modMap(), 1578);
    expect(toasts(none)).toEqual([]);
  });
});
