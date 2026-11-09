import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { gameDataSourceAtom } from "../src/atoms/gameDataAtoms";
import { toastsAtom } from "../src/atoms/uiAtoms";
import { createScenario } from "../src/formats/chk/create";
import { folderFileSize, folderReader, folderSet, type FolderPiece } from "../src/gamedata/folderSet";
import { DEFAULT_PROFILE } from "../src/gamedata/profiles";
import { fetchAsset, readContext, resetAssetSource, setAssetSource, type AssetSource } from "../src/gamedata/source";
import { clearStoredCopy, keepInMemory, storedCopy } from "../src/gamedata/store";
import { drawFromModFolder, updateMissingTerrain } from "../src/services/missingTerrain";

const JUNGLE = 4;

/** A file of a picked folder that counts how often it is read. */
function piece(path: string, bytes: Uint8Array | number, reads?: string[]): FolderPiece {
  const data = typeof bytes === "number" ? new Uint8Array(bytes) : bytes;
  return { path, file: { size: data.length, arrayBuffer: async () => { reads?.push(path); return data.slice().buffer; } } };
}

/** A mod's release folder as a pick hands it over: the game's folders one folder down, a loader and an archive beside them. */
function release(groups: number, reads?: string[]): FolderPiece[] {
  return [
    piece("Release/Cosmonarchy BW.exe", 64, reads),
    piece("Release/README.md", 10, reads),
    piece("Release/temp.mpq", 64, reads),
    piece("Release/mpq/arr/units.dat", new Uint8Array([7, 7, 7]), reads),
    piece("Release/mpq/rez/stat_txt.tbl", new Uint8Array([1, 2]), reads),
    piece("Release/mpq/tileset/Jungle.cv5", groups * 52, reads),
    piece("Release/mpq/tileset/jungle/ofire.pcx", new Uint8Array([9]), reads),
    piece("Release/mpq/notes.txt", 5, reads),
    piece("Release/plugins/aise.dll", 5, reads),
  ];
}

/** A Jungle map with one tile of group 3,734 (bit 15 set), and when asked one of group 2,500. */
function modMap(second = false) {
  const scn = createScenario({ width: 64, height: 64, era: JUNGLE, name: "m" });
  scn.tiles[10] = (3734 << 4) | 5;
  if (second) scn.tiles[11] = (2500 << 4) | 1;
  return scn;
}

describe("a mod's folder as the files the editor asks for", () => {
  it("finds the game's files where they start, by the game's names, and lists the archives apart", () => {
    const set = folderSet(release(4095));
    expect(set.name).toBe("Release");
    expect(set.root).toBe("Release/mpq");
    expect([...set.files.keys()].sort()).toEqual(["arr\\units.dat", "rez\\stat_txt.tbl", "tileset\\jungle.cv5", "tileset\\jungle\\ofire.pcx"]);
    expect(set.archives).toEqual(["Cosmonarchy BW.exe", "temp.mpq"]);
    expect(folderFileSize(set, "tileset\\jungle.cv5")).toBe(4095 * 52);
    expect(folderFileSize(set, "Tileset/Jungle.cv5")).toBe(4095 * 52);
    expect(folderFileSize(set, "tileset\\ice.cv5")).toBeNull();
  });

  it("takes the game's folders at the folder's own root too, and a folder that is one of them", () => {
    expect([...folderSet([piece("My Mod/arr/units.dat", 1), piece("My Mod/unit/terran/marine.grp", 1), piece("My Mod/readme.txt", 1)]).files.keys()]).toEqual(["arr\\units.dat", "unit\\terran\\marine.grp"]);
    expect([...folderSet([piece("arr/units.dat", 1)]).files.keys()]).toEqual(["arr\\units.dat"]);
    expect(folderSet([piece("Stuff/readme.txt", 1), piece("Stuff/deep/notes.txt", 1)]).files.size).toBe(0);
    expect(folderSet([]).name).toBe("");
  });

  it("answers a file when it is asked for and not before, by the member the editor names", async () => {
    const reads: string[] = [];
    const set = folderSet(release(4095, reads));
    const read = folderReader(set);
    const ask = (path: string) => read(path, readContext({ read, base: null }, path));
    expect(reads).toEqual([]);
    expect([...(await ask("arr/units.dat"))!]).toEqual([7, 7, 7]);
    // The extraction's own names for a member: the shared string table, a tileset's remap table.
    expect([...(await ask("tileset/stat_txt.tbl"))!]).toEqual([1, 2]);
    expect([...(await ask("tileset/jungle.ofire.pcx"))!]).toEqual([9]);
    expect((await ask("tileset/jungle.cv5"))!.length).toBe(4095 * 52);
    expect(reads).toEqual(["Release/mpq/arr/units.dat", "Release/mpq/rez/stat_txt.tbl", "Release/mpq/tileset/jungle/ofire.pcx", "Release/mpq/tileset/Jungle.cv5"]);
    // What the folder has not got is left to the data set underneath, the copy's own lists among it.
    expect(await ask("arr/weapons.dat")).toBeNull();
    expect(await ask("unit/manifest.json")).toBeNull();
    expect(await ask("tileset/jungle.vx4ex")).toBeNull();
  });

  it("gives its own megatile table in the wide form when it has only the classic one", async () => {
    const vx4 = new Uint8Array(64);
    new DataView(vx4.buffer).setUint16(2, 0x1234, true);
    new DataView(vx4.buffer).setUint16(62, 0xfffe, true);
    const set = folderSet([piece("Mod/tileset/ice.cv5", 52), piece("Mod/tileset/ice.vx4", vx4), piece("Mod/tileset/desert.vx4", vx4)]);
    const read = folderReader(set);
    const ask = (path: string) => read(path, readContext({ read, base: null }, path));
    const wide = (await ask("tileset/ice.vx4ex"))!;
    expect(wide.length).toBe(128);
    const view = new DataView(wide.buffer);
    expect([view.getUint32(0, true), view.getUint32(4, true), view.getUint32(124, true)]).toEqual([0, 0x1234, 0xfffe]);
    // A megatile table without the folder's own group table is not laid under the game's groups.
    expect(await ask("tileset/desert.vx4ex")).toBeNull();
  });
});

describe("drawing from a mod's folder chosen in the terrain notice", () => {
  const toasts = (store: ReturnType<typeof createStore>) => store.get(toastsAtom).map((t) => ({ kind: t.kind, title: t.title, detail: t.detail, actions: t.actions?.map((a) => a.label) }));

  /** A store drawing from a copy of the game held in memory, as the data set in use. */
  async function editor() {
    const stamp = { from: "test", at: "", files: 1, bytes: 0, summary: "" };
    keepInMemory(new Map([["arr/units.dat", new Uint8Array([1])]]), stamp);
    const source: AssetSource = { kind: "stored", label: "", tried: [], profile: DEFAULT_PROFILE, stored: (await storedCopy())! };
    setAssetSource(source);
    const store = createStore();
    store.set(gameDataSourceAtom, source);
    return { store, source };
  }
  afterEach(async () => { resetAssetSource(); await clearStoredCopy(); });

  it("draws from a folder that has the terrain: in memory, the notice gone, the files read when asked", async () => {
    const { store } = await editor();
    const scn = modMap();
    await updateMissingTerrain(store, scn, 1578);
    expect(toasts(store).map((t) => t.kind)).toEqual(["warn"]);
    const reads: string[] = [];
    expect(await drawFromModFolder(store, scn, { pick: async () => release(4095, reads), groups: 1578 })).toBe("drawn");
    expect(reads).toEqual([]); // nothing was read to decide, or to attach
    const now = store.get(gameDataSourceAtom)!;
    expect(now).toMatchObject({ kind: "reader", profile: { id: "release", name: "Release" } });
    expect(now.reader?.base?.profile.id).toBe("starcraft");
    expect(now.reader?.hash).toBeUndefined();
    expect(toasts(store)).toEqual([{ kind: "ok", title: "Now drawing from Release.", detail: "Its files are read from the folder as they are needed; nothing is installed or kept. Help ▸ Game Data… switches back.", actions: undefined }]);
    // The editor's loaders now get the folder's files, and the game's for the rest.
    expect((await (await fetchAsset("tileset/jungle.cv5")).arrayBuffer()).byteLength).toBe(4095 * 52);
    expect([...new Uint8Array(await (await fetchAsset("arr/units.dat")).arrayBuffer())]).toEqual([7, 7, 7]);
    expect(reads).toEqual(["Release/mpq/tileset/Jungle.cv5", "Release/mpq/arr/units.dat"]);
    // The notice's own rule, with the folder's tileset loaded: nothing to say.
    await updateMissingTerrain(store, scn, 4095);
    expect(toasts(store).map((t) => t.kind)).toEqual(["ok"]);
  });

  it("takes a folder that brings some of the terrain, and the notice says what is left", async () => {
    const { store } = await editor();
    const scn = modMap(true);
    await updateMissingTerrain(store, scn, 1578);
    expect(await drawFromModFolder(store, scn, { pick: async () => release(3000), groups: 1578 })).toBe("drawn");
    await updateMissingTerrain(store, scn, 3000);
    expect(toasts(store).map((t) => t.title)).toEqual(["Now drawing from Release.", "Release has not got some of this map's terrain"]);
    expect(toasts(store)[1].detail).toMatch(/^1 tile of this Jungle World map is terrain/);
  });

  it("says when the folder has not got the terrain either, and leaves the data set in use alone", async () => {
    const { store, source } = await editor();
    const scn = modMap();
    await updateMissingTerrain(store, scn, 2046);
    expect(await drawFromModFolder(store, scn, { pick: async () => release(2046), groups: 2046 })).toBe("no-terrain");
    expect(store.get(gameDataSourceAtom)).toBe(source);
    expect(toasts(store).map((t) => t.title)).toEqual(["StarCraft: Brood War has not got some of this map's terrain", "Release has not got this map's terrain either"]);
    expect(toasts(store)[1]).toMatchObject({
      kind: "warn",
      detail: "Its Jungle World tileset has 2,046 tile groups, and this map uses tiles past them, so the data set in use stays as it is. The folder also holds archives (Cosmonarchy BW.exe, temp.mpq), which are not read this way: Help ▸ Game Data… ▸ Add a data set… reads them.",
      actions: ["Game Data…"],
    });
    // A mod with no tileset of this kind at all.
    const other = await editor();
    expect(await drawFromModFolder(other.store, scn, { pick: async () => [piece("Small Mod/arr/units.dat", 3)], groups: 1578 })).toBe("no-terrain");
    expect(toasts(other.store)).toEqual([{ kind: "warn", title: "Small Mod has not got this map's terrain either", detail: "It has no Jungle World tileset of its own (tileset\\jungle.cv5), so the data set in use stays as it is.", actions: undefined }]);
    expect(other.store.get(gameDataSourceAtom)).toBe(other.source);
  });

  it("says a folder of archives is for Add a data set, and that a folder with no game files is no mod's", async () => {
    const { store, source } = await editor();
    const scn = modMap();
    const archives = [piece("Mod/patch.mpq", 64), piece("Mod/Mod.exe", 64), piece("Mod/a.mpq", 1), piece("Mod/b.mpq", 1), piece("Mod/readme.txt", 5)];
    expect(await drawFromModFolder(store, scn, { pick: async () => archives, groups: 1578 })).toBe("archives-only");
    expect(await drawFromModFolder(store, scn, { pick: async () => [piece("Stuff/readme.txt", 5)], groups: 1578 })).toBe("no-game-files");
    expect(await drawFromModFolder(store, scn, { pick: async () => [], groups: 1578 })).toBe("cancelled");
    expect(toasts(store)).toEqual([
      { kind: "warn", title: "Mod has no loose game files", detail: "It holds archives (patch.mpq, Mod.exe, a.mpq…), which are not read from a folder this way. Help ▸ Game Data… ▸ Add a data set… reads archives.", actions: ["Game Data…"] },
      { kind: "warn", title: "Stuff is not a mod's folder", detail: "None of the game's folders (arr, unit, tileset…) is in it or in a folder inside it.", actions: undefined },
    ]);
    expect(store.get(gameDataSourceAtom)).toBe(source);
  });

  it("opens one picker at a time", async () => {
    const { store } = await editor();
    const scn = modMap();
    let open!: (pieces: FolderPiece[]) => void;
    const first = drawFromModFolder(store, scn, { pick: () => new Promise((resolve) => { open = resolve; }), groups: 1578 });
    expect(await drawFromModFolder(store, scn, { pick: async () => release(4095), groups: 1578 })).toBe("cancelled");
    open([]);
    expect(await first).toBe("cancelled");
    expect(store.get(gameDataSourceAtom)?.kind).toBe("stored");
  });

  it("does not take the game's own id for a folder called after the game", async () => {
    const { store } = await editor();
    const pieces = [piece("StarCraft/tileset/jungle.cv5", 4095 * 52)];
    expect(await drawFromModFolder(store, modMap(), { pick: async () => pieces, groups: 1578 })).toBe("drawn");
    expect(store.get(gameDataSourceAtom)?.profile).toEqual({ id: "starcraft-folder", name: "StarCraft" });
  });
});
