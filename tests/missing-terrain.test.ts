import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { archiveExtrasAtom } from "../src/atoms/documentAtoms";
import { gameDataSourceAtom } from "../src/atoms/gameDataAtoms";
import { toastsAtom } from "../src/atoms/uiAtoms";
import { isModTile, isRemasteredOnlyTile, missingTerrain, tilesetHasTile } from "../src/data/remasteredTiles";
import { createScenario } from "../src/formats/chk/create";
import { DEFAULT_PROFILE, REMASTERED_PROFILE } from "../src/gamedata/profiles";
import type { AssetSource } from "../src/gamedata/source";
import { encodeDataSet } from "../src/services/mapDataSet";
import { updateMissingTerrain } from "../src/services/missingTerrain";

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

describe("the notice when the data set in use lacks a map's terrain", () => {
  const toasts = (store: ReturnType<typeof createStore>) => store.get(toastsAtom);

  it("says it once per map and data set, and takes it down when the data set has the terrain", () => {
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    const scn = modMap();
    updateMissingTerrain(store, scn, 1578);
    expect(toasts(store)).toHaveLength(1);
    expect(toasts(store)[0]).toMatchObject({ kind: "warn", ttl: 0, title: "StarCraft: Brood War has not got some of this map's terrain" });
    expect(toasts(store)[0].detail).toBe("1 tile of this Jungle World map is terrain neither StarCraft 1.16.1 nor Remastered has: the map was made for a mod, and here those tiles draw black or as other tiles. Open the mod (the Mod Editor plugin's File ▸ Open a Mod…) or choose its data set (Help ▸ Game Data…).");
    expect(toasts(store)[0].action?.label).toBe("Game Data…");
    // A repaint, or the same answer again, says nothing more.
    updateMissingTerrain(store, scn, 1578);
    expect(toasts(store)).toHaveLength(1);
    // The switch to the mod: the toast goes while its tileset loads, and nothing comes back.
    store.set(gameDataSourceAtom, mod);
    updateMissingTerrain(store, scn, null);
    expect(toasts(store)).toEqual([]);
    updateMissingTerrain(store, scn, 4095);
    expect(toasts(store)).toEqual([]);
    // Back on the game's own: already said for this map.
    store.set(gameDataSourceAtom, game);
    updateMissingTerrain(store, scn, 1578);
    expect(toasts(store)).toEqual([]);
    // Remastered's files lack it too, and that is a data set of its own.
    store.set(gameDataSourceAtom, remastered);
    updateMissingTerrain(store, scn, 2046);
    expect(toasts(store).map((t) => t.title)).toEqual(["StarCraft: Remastered has not got some of this map's terrain"]);
  });

  it("goes with the map: another map in front takes it down, and coming back does not repeat it", () => {
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    const a = modMap(), b = modMap();
    updateMissingTerrain(store, a, 1578);
    updateMissingTerrain(store, b, null);
    expect(toasts(store)).toEqual([]);
    updateMissingTerrain(store, b, 1578);
    expect(toasts(store)).toHaveLength(1);
    updateMissingTerrain(store, a, 1578);
    expect(toasts(store)).toEqual([]);
  });

  it("names Remastered's files for its additions over a 1.16 copy", () => {
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    const scn = createScenario({ width: 64, height: 64, era: DESERT, name: "r" });
    scn.tiles.fill(800 << 4, 0, 3);
    updateMissingTerrain(store, scn, 1520);
    expect(toasts(store)[0].detail).toBe("3 tiles of this Desert map are from what StarCraft: Remastered added, which the files in use have not got, so here they have no picture. Help ▸ Game Data… adds StarCraft: Remastered from your installation, or switches to it when it is there.");
    // A map of the game's own tiles says nothing.
    const plain = createScenario({ width: 64, height: 64, era: DESERT, name: "p" });
    const other = createStore();
    other.set(gameDataSourceAtom, game);
    updateMissingTerrain(other, plain, 1520);
    expect(toasts(other)).toEqual([]);
  });

  it("leaves a map that names another data set to the offer to switch, and says nothing without game data", () => {
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    store.set(archiveExtrasAtom, new Map([["scmjs\\dataset.json", encodeDataSet({ id: "cosmonarchy", name: "Cosmonarchy", hash: "" })]]));
    updateMissingTerrain(store, modMap(), 1578);
    expect(toasts(store)).toEqual([]);
    // The map names the data set in use, which still lacks the terrain: then it is said.
    store.set(gameDataSourceAtom, mod);
    updateMissingTerrain(store, modMap(), 3000);
    expect(toasts(store)).toHaveLength(1);
    const none = createStore();
    none.set(gameDataSourceAtom, { kind: "none", label: "", tried: [], profile: DEFAULT_PROFILE });
    updateMissingTerrain(none, modMap(), 1578);
    expect(toasts(none)).toEqual([]);
  });
});
