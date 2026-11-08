import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { fetchAsset, readUnder, resetAssetSource, setAssetSource, type AssetSource, type DataSetReadContext } from "../src/gamedata/source";
import { clearStoredCopy, keepInMemory, storedCopy } from "../src/gamedata/store";
import { memberOfStored, storedPathOf } from "../src/gamedata/paths";
import { datEntrySize } from "../src/formats/dat/table";
import { gameDataRevisionAtom, gameDataSourceAtom } from "../src/atoms/gameDataAtoms";
import { Contributions, createPluginApi } from "../src/plugins/host";
import { testDataSet } from "../src/services/testMap";

const bytes = async (path: string) => { const res = await fetchAsset(path); return res.ok ? [...new Uint8Array(await res.arrayBuffer())] : res.status; };

/** A stored copy held in memory under the id "under", as the set a reader lays over. */
async function underCopy(files: [string, Uint8Array][]): Promise<AssetSource> {
  const stamp = { from: "test", at: "", files: files.length, bytes: 0, summary: "", profile: { id: "under", name: "Under" } };
  keepInMemory(new Map(files), stamp, "under");
  return { kind: "stored", label: "", tried: [], profile: stamp.profile, stored: (await storedCopy("under"))! };
}

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** A data set that is a function in memory: its files first, the rest from the source under it, nothing stored. */
describe("a data set read through a function", () => {
  afterEach(async () => { resetAssetSource(); await clearStoredCopy("under"); });

  it("answers its own files and leaves the rest to the copy under it", async () => {
    const base = await underCopy([["arr/units.dat", new Uint8Array([1, 1])], ["arr/flingy.dat", new Uint8Array([2, 2])]]);
    const asked: string[] = [];
    setAssetSource({
      kind: "reader", label: "", tried: [], profile: { id: "draft", name: "Draft" },
      reader: { read: (path) => { asked.push(path); return path === "arr/units.dat" ? new Uint8Array([9]) : null; }, base },
    });
    expect(await bytes("arr/units.dat")).toEqual([9]);
    expect(await bytes("arr/flingy.dat")).toEqual([2, 2]);
    expect(await bytes("arr/images.dat")).toBe(404);
    expect(asked).toEqual(["arr/units.dat", "arr/flingy.dat", "arr/images.dat"]);
  });

  it("tells the reader the game's name for each file, and reads the set under it", async () => {
    const base = await underCopy([["arr/units.dat", new Uint8Array([1, 1])], ["tileset/stat_txt.tbl", new Uint8Array([7])]]);
    const told: [string, string | null][] = [];
    const read = async (path: string, file: DataSetReadContext) => {
      told.push([path, file.member]);
      // A mod that changes units.dat by one byte of the game's, read from beneath it.
      if (file.member === "arr\\units.dat") { const game = (await file.under(path))!; return new Uint8Array([game[0] + 1, game[1]]); }
      return null;
    };
    setAssetSource({ kind: "reader", label: "", tried: [], profile: { id: "draft", name: "Draft" }, reader: { read, base } });
    expect(await bytes("arr/units.dat")).toEqual([2, 1]);
    expect(await bytes("tileset/stat_txt.tbl")).toEqual([7]);
    expect(await bytes("tileset/jungle.ofire.pcx")).toBe(404);
    expect(told.slice(0, 3)).toEqual([["arr/units.dat", "arr\\units.dat"], ["tileset/stat_txt.tbl", "rez\\stat_txt.tbl"], ["tileset/jungle.ofire.pcx", "tileset\\jungle\\ofire.pcx"]]);
    // Beneath the reader, whatever it answers: the copy's own files.
    expect([...(await readUnder("arr/units.dat"))!]).toEqual([1, 1]);
    expect(await readUnder("arr/images.dat")).toBeNull();
  });

  it("works out which tables are .datex and which optional files are there, when the reader writes no manifest", async () => {
    const baseManifest = { images: [0, 1], grps: ["terran\\marine.grp"], overlays: [], missing: [], datex: ["units", "sprites"], optional: ["unit/cmdbtns/uniticons.grp"] };
    const base = await underCopy([["unit/manifest.json", json(baseManifest)]]);
    const weaponsDatex = new Uint8Array(datEntrySize("weapons", "datex") * 140);
    const mine = new Map<string, Uint8Array>([
      ["arr/units.dat", new Uint8Array(19876)], // the game's layout again: no longer .datex
      ["arr/weapons.datex", weaponsDatex], // GPTP's layout, a whole number of entries
      ["arr/flingy.datex", new Uint8Array(7)], // not a whole number of entries: left as it was
      ["rez/unitnames.tbl", new Uint8Array([1, 0, 4, 0, 0])],
    ]);
    setAssetSource({ kind: "reader", label: "", tried: [], profile: { id: "draft", name: "Draft" }, reader: { read: (path) => mine.get(path) ?? null, base } });
    const res = await fetchAsset("unit/manifest.json");
    const manifest = JSON.parse(await res.text()) as typeof baseManifest;
    expect(manifest.datex).toEqual(["sprites", "weapons"]);
    expect(manifest.optional).toEqual(["rez/unitnames.tbl", "unit/cmdbtns/uniticons.grp"]);
    expect(manifest.grps).toEqual(baseManifest.grps);
    // A reader that answers the manifest itself is taken at its word.
    mine.set("unit/manifest.json", json({ datex: ["orders"] }));
    expect(JSON.parse(await (await fetchAsset("unit/manifest.json")).text())).toEqual({ datex: ["orders"] });
  });
});

describe("a stored copy's paths and the game's names", () => {
  it("go both ways, the extraction's renamed files included", () => {
    const pairs: [string, string][] = [
      ["arr\\units.dat", "arr/units.dat"],
      ["arr\\mapdata.tbl", "arr/mapdata.tbl"],
      ["rez\\stat_txt.tbl", "tileset/stat_txt.tbl"],
      ["rez\\unitnames.tbl", "rez/unitnames.tbl"],
      ["tileset\\jungle\\ofire.pcx", "tileset/jungle.ofire.pcx"],
      ["tileset\\badlands\\dddata.bin", "tileset/badlands.dddata.bin"],
      // The play set keeps the rest of a tileset's folder where the game names it.
      ["tileset\\jungle\\dark.pcx", "tileset/jungle/dark.pcx"],
      ["tileset\\badlands.vx4ex", "tileset/badlands.vx4ex"],
      ["hd2\\anim\\main_007.anim", "unit/hd/main_007.anim"],
      ["hd2\\tileset\\jungle.dds.vr4", "tileset/jungle.hd.vr4"],
      ["hd2\\tileset\\ice.tmsk", "tileset/ice.hd.tmsk"],
      ["hd2\\tileset\\ice_mask.dds.grp", "tileset/ice.hd.mask"],
      ["hd2\\effect\\noise.dds", "tileset/heat_noise.hd.dds"],
      ["unit\\terran\\marine.grp", "unit/terran/marine.grp"],
      ["sound\\misc\\buzz.wav", "sound/misc/buzz.wav"],
    ];
    for (const [member, path] of pairs) {
      expect(storedPathOf(member), member).toBe(path);
      expect(memberOfStored(path), path).toBe(member);
    }
    expect(storedPathOf("ARR/Units.DAT")).toBe("arr/units.dat");
    expect(memberOfStored("/Unit/Manifest.json")).toBeNull();
    expect(memberOfStored("tileset/manifest.json")).toBeNull();
  });
});

describe("plugin game data in memory", () => {
  afterEach(async () => { resetAssetSource(); await clearStoredCopy("under"); });

  it("takes a new hash without reading anything again, and Test Map hands it on", async () => {
    const store = createStore();
    const base = await underCopy([["arr/units.dat", new Uint8Array([1, 1])]]);
    setAssetSource(base);
    store.set(gameDataSourceAtom, base);
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.gameData.rehash("0123456789abcdef")).toBeNull(); // no set in memory yet
    let reads = 0;
    const read = (path: string) => { reads++; return path === "arr/units.dat" ? new Uint8Array([5]) : null; };
    const attached = await api.gameData.attach({ id: "draft", name: "Draft" }, read);
    expect(attached).toMatchObject({ kind: "reader", base: "under" });
    expect(attached.hash).toBeUndefined();
    const revision = store.get(gameDataRevisionAtom);
    let events = 0;
    api.events.on("gameData", () => events++);
    const next = api.gameData.rehash("0123456789abcdef");
    expect(next).toMatchObject({ kind: "reader", hash: "0123456789abcdef", profile: { id: "draft" } });
    expect(api.gameData.source()?.hash).toBe("0123456789abcdef");
    expect(testDataSet(store)).toEqual({ id: "draft", name: "Draft", hash: "0123456789abcdef" });
    expect(store.get(gameDataRevisionAtom)).toBe(revision); // nothing decoded is dropped
    expect(events).toBe(1);
    // The same reader still answers, and the session's source carries the hash.
    expect(await bytes("arr/units.dat")).toEqual([5]);
    expect(reads).toBeGreaterThan(0);
    expect(api.gameData.rehash(null)?.hash).toBeUndefined();
    expect(() => api.gameData.rehash(42 as unknown as string)).toThrow(/hash or null/);
  });

  it("reads under the attached set, and names a member's stored path", async () => {
    const store = createStore();
    const base = await underCopy([["arr/units.dat", new Uint8Array([1, 1])]]);
    setAssetSource(base);
    store.set(gameDataSourceAtom, base);
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    await api.gameData.attach({ id: "draft", name: "Draft" }, (path) => (path === "arr/units.dat" ? new Uint8Array([5]) : null));
    expect([...(await api.gameData.read("arr/units.dat"))!]).toEqual([5]);
    expect([...(await api.gameData.read("ARR\\Units.dat", { under: true }))!]).toEqual([1, 1]);
    expect(await api.gameData.read("../arr/units.dat", { under: true })).toBeNull();
    expect(api.gameData.storedPath("rez\\stat_txt.tbl")).toBe("tileset/stat_txt.tbl");
    expect(api.gameData.storedPath("Tileset\\Jungle\\OFire.pcx")).toBe("tileset/jungle.ofire.pcx");
  });
});
