/**
 * Races a data set adds to the game's own: the table's rule (`normalizeRaces`), a race's name by its byte, the hints a
 * mod's files give, which of the game's races a list of units plays as; `mod.json`'s `races` and the mod's hash; the
 * editor's data set profile (kept per id, through a re-attach), `api.gameData.races/setRaces` and `api.names`; the
 * Player Settings choices for a byte nobody names; a map's `scmjs\dataset.json` and Test Map's hand-over. Every file
 * here is made by the test.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeRaces, raceCandidates, raceChoices, raceLabel, racePlaysAs, sameRaces, GAME_RACE_NAMES, type DataSetRace } from "../src/formats/mod/races";
import { emptyManifest, readManifest, tidyManifest } from "../src/formats/mod/folder";
import { encodeTblFile } from "../src/formats/dat/tblFile";
import { playerRaceLabel } from "../src/data/players";
import { dataSetRaces, raceOptions, raceText } from "../src/data/races";
import { keptRaces, normalizeProfile, RACES_KEY, racesOf } from "../src/gamedata/profiles";
import { clearStoredDataAtom, clearStoredKeysAtom, exportStoredPreferences, importStoredPreferencesAtom, ownedStoredKeys } from "../src/atoms/preferencesAtoms";
import { browserStorage } from "../src/atoms/storage";
import { pickedFolderRaces, splitPickedFiles } from "../src/gamedata/install";
import { resetAssetSource, setAssetSource, type AssetSource } from "../src/gamedata/source";
import { dataSetRacesAtom, gameDataSourceAtom, keepRacesAtom } from "../src/atoms/gameDataAtoms";
import { Contributions, createPluginApi } from "../src/plugins/host";
import { DATASET_MEMBER, dataSetOf, offerMapDataSet, readDataSet, withDataSet } from "../src/services/mapDataSet";
import { testDataSet } from "../src/services/testMap";
import { createScenario } from "../src/formats/chk/create";
import { applyPlayerSettings, playerSlotViews, readPlayerSettings } from "../src/editor/settings";
import { mapStatistics } from "../src/editor/statistics";
import { openMod } from "../cli/src/mod/open";
import { sourceHash } from "../cli/src/mod/hash";
import { unpackMod } from "../cli/src/mod/unpack";

const text = (s: string) => new TextEncoder().encode(s);
const ADDED: DataSetRace[] = [{ id: 69, name: "Askosi", letter: "a", like: 1 }, { id: 70, name: "Bloodsummon" }];

describe("a data set's races, the rule", () => {
  it("keeps valid rows sorted by id, drops the rest, and never throws", () => {
    expect(normalizeRaces([
      { id: 70, name: " Bloodsummon " },
      { id: 69, name: "Askosi", letter: "A", like: 1, colour: "teal" },
      { id: 69, name: "Again" }, // a duplicate id: the first stands
      { id: 3, name: "Independent" }, // the game's own
      { id: 256, name: "Past a byte" },
      { id: 71.5, name: "Half" },
      { id: 72, name: "" },
      { id: 73, name: "x".repeat(41) },
      { id: 74, name: "Letters", letter: "ab", like: 6 }, // bad letter and like: left off, the row stays
      null, "Kogri", [75, "Kogri"],
    ])).toEqual([
      { id: 69, name: "Askosi", letter: "a", like: 1, colour: "teal" },
      { id: 70, name: "Bloodsummon" },
      { id: 74, name: "Letters" },
    ]);
    for (const nothing of [undefined, null, 7, "races", {}, { 0: { id: 9, name: "x" } }]) expect(normalizeRaces(nothing)).toEqual([]);
    expect(normalizeRaces([{ id: 8, name: "x".repeat(40) }, { id: 255, name: "Last" }]).map((r) => r.id)).toEqual([8, 255]);
    expect(sameRaces(normalizeRaces(ADDED), ADDED)).toBe(true);
    expect(sameRaces(ADDED, [ADDED[0]])).toBe(false);
  });

  it("names the game's eight first, then the declared, else Race n; with no table it is playerRaceLabel", () => {
    expect(GAME_RACE_NAMES).toEqual(["Zerg", "Terran", "Protoss", "Independent", "Neutral", "User Selectable", "Random", "Inactive"]);
    for (let v = 0; v < 256; v++) expect(raceLabel(v)).toBe(playerRaceLabel(v));
    expect(raceLabel(69, ADDED)).toBe("Askosi");
    expect(raceLabel(71, ADDED)).toBe("Race 71");
    // (A declared row cannot take the game's byte.)
    expect(raceLabel(1, [{ id: 1, name: "Not Terran" }])).toBe("Terran");
    expect(raceChoices(ADDED).map((c) => c.value)).toEqual([0, 1, 2, 5, 6, 3, 4, 7, 69, 70]);
    expect(raceChoices(ADDED).at(-2)).toEqual({ value: 69, label: "Askosi" });
  });

  it("offers names past the game's network.tbl and letters with console files, as hints", () => {
    const tbl = (n: number, extra: string[]) => encodeTblFile({ strings: [...Array.from({ length: n }, (_, i) => `String ${i}`), ...extra], encoding: "windows-1252" });
    const found = raceCandidates({
      network: tbl(168, ["Askosi", "\x02Bloodsummon", "", "Kogri"]),
      paths: ["game/aconsole.pcx", "Game\\TConsole.pcx", "rez\\statbtnf.bin", "game\\zconsole.pcx", "rez\\statbtnt.bin", "game\\aconover.pcx", "unit\\x.grp"],
    });
    expect(found).toEqual({ names: [{ index: 168, name: "Askosi" }, { index: 169, name: "Bloodsummon" }, { index: 171, name: "Kogri" }], letters: ["a", "f"] });
    // The game's own table, when a copy is read, says where the mod's start.
    expect(raceCandidates({ network: tbl(170, ["Kogri"]), gameNetwork: tbl(170, []), paths: [] }).names).toEqual([{ index: 170, name: "Kogri" }]);
    expect(raceCandidates({ network: null, paths: [] })).toEqual({ names: [], letters: [] });
    expect(raceCandidates({ network: new Uint8Array([1]), paths: [] }).names).toEqual([]);
  });

  it("works out the game's race a list of units plays as, by the group flags most carry", () => {
    const groupFlags = new Uint8Array(300);
    groupFlags[7] = 2; groupFlags[106] = 2; groupFlags[109] = 2; groupFlags[37] = 1; groupFlags[64] = 4; groupFlags[250] = 2 | 4;
    expect(racePlaysAs([7, 106, 109, 37], { groupFlags })).toBe(1);
    expect(racePlaysAs([37, 37, 64], { groupFlags })).toBe(0);
    expect(racePlaysAs([37, 64], { groupFlags })).toBeNull(); // as many of each: not guessed
    expect(racePlaysAs([], { groupFlags })).toBeNull();
    expect(racePlaysAs([0, 299], { groupFlags })).toBeNull(); // no flags
    expect(racePlaysAs([250, 64], { groupFlags })).toBe(2);
  });
});

describe("mod.json's races", () => {
  it("are read, tidied and written back; absent when there are none, so a folder without them writes the same file", () => {
    const plain = tidyManifest(emptyManifest("Made"));
    expect("races" in plain).toBe(false);
    expect(JSON.stringify(tidyManifest(readManifest(JSON.stringify(plain))!))).toBe(JSON.stringify(plain));
    const declared = readManifest(JSON.stringify({ ...plain, races: [{ id: 70, name: "Bloodsummon" }, { id: 69, name: " Askosi ", letter: "a", like: 1 }, { id: 2, name: "Protoss" }] }))!;
    expect(declared.races).toEqual(ADDED);
    const written = JSON.stringify(tidyManifest(declared));
    expect(JSON.parse(written).races).toEqual(ADDED);
    expect(JSON.stringify(tidyManifest(readManifest(written)!))).toBe(written);
    // A table of nothing usable is no table.
    expect("races" in readManifest(JSON.stringify({ ...plain, races: "Askosi" }))!).toBe(false);
    const emptied = { ...declared, races: [] };
    expect("races" in tidyManifest(emptied)).toBe(false);
  });

  it("leave the mod's hash as it was: a folder of the game's files and a folder mod unpack wrote", async () => {
    const root = mkdtempSync(join(tmpdir(), "scmjs-races-"));
    const dir = join(root, "Made");
    const put = (path: string, data: string) => { mkdirSync(join(dir, path, ".."), { recursive: true }); writeFileSync(join(dir, path), text(data)); };
    put("arr/units.dat", "a made units.dat");
    put("rez/network.tbl", "made strings");
    const before = await openMod(dir, null);
    const hash = await sourceHash(before);
    expect(before.races).toEqual([]);
    put("mod.json", JSON.stringify({ name: "Made", races: ADDED }));
    const after = await openMod(dir, null);
    expect(after.races).toEqual(ADDED);
    expect(after.files.has("mod.json")).toBe(false);
    expect(await sourceHash(after)).toMatchObject({ hash: hash.hash, withoutPlugins: hash.withoutPlugins });

    // Unpacked, the races go into the folder's mod.json; declared there or not, the hash is the release's.
    const unpacked = join(root, "unpacked");
    await unpackMod(after, unpacked, { base: null, palette: "jungle" });
    const manifest = JSON.parse(readFileSync(join(unpacked, "mod.json"), "utf8"));
    expect(manifest.races).toEqual(ADDED);
    const declaredHash = await sourceHash(await openMod(unpacked, null));
    expect((await openMod(unpacked, null)).races).toEqual(ADDED);
    delete manifest.races;
    writeFileSync(join(unpacked, "mod.json"), JSON.stringify(manifest, null, 2));
    const undeclared = await openMod(unpacked, null);
    expect(undeclared.races).toEqual([]);
    expect(await sourceHash(undeclared)).toMatchObject({ hash: declaredHash.hash, withoutPlugins: declaredHash.withoutPlugins });
    expect(declaredHash.hash).toBe(hash.hash);

    // A new release unpacked over the folder keeps the races declared there.
    writeFileSync(join(unpacked, "mod.json"), JSON.stringify({ ...manifest, races: [ADDED[1]] }, null, 2));
    await unpackMod(before, unpacked, { base: null, palette: "jungle" });
    expect(JSON.parse(readFileSync(join(unpacked, "mod.json"), "utf8")).races).toEqual([ADDED[1]]);
  });
});

describe("the editor's data set races", () => {
  afterEach(() => {
    resetAssetSource();
    browserStorage().removeItem(RACES_KEY);
    setAssetSource({ kind: "none", label: "", tried: [], profile: { id: "starcraft", name: "StarCraft: Brood War" } });
  });

  const stored = (id: string, more: Partial<AssetSource["profile"]> = {}): AssetSource => ({
    kind: "stored", label: "", tried: [], profile: { id, name: "My Mod", ...more },
    stored: { from: "", at: "", files: 1, bytes: 1, summary: "", profile: { id, name: "My Mod" }, hash: "0123456789abcdef", where: "memory" },
  });

  it("are kept per data set id, never for the game's own, and carried by the source's profile", () => {
    const store = createStore();
    const keep = (id: string, races: DataSetRace[]) => store.set(keepRacesAtom, { id, races });
    expect(keep("starcraft", ADDED)).toBe(false);
    expect(keep("remastered", ADDED)).toBe(false);
    expect(keptRaces("my-mod")).toBeNull();
    // A profile's own races are not read: what is handed in is kept first.
    expect(racesOf({ id: "my-mod" })).toEqual([]);
    expect(keep("my-mod", [ADDED[1], ADDED[0], { id: 1, name: "Terran" }])).toBe(true);
    expect(keptRaces("my-mod")).toEqual(ADDED);
    expect(JSON.parse(browserStorage().getItem(RACES_KEY)!)).toEqual({ "my-mod": ADDED });
    expect(racesOf({ id: "my-mod" })).toEqual(ADDED);
    expect(racesOf({ id: "starcraft" })).toEqual([]);
    expect(normalizeProfile({ id: "my-mod", name: "My Mod", races: [{ id: 2, name: "x" }] })).toEqual({ id: "my-mod", name: "My Mod" });
    expect(normalizeProfile({ id: "my-mod", name: "My Mod", races: ADDED })?.races).toEqual(ADDED);
    // A source made the session's carries them, and the editor names races by them.
    const source = stored("my-mod", { races: [ADDED[1]] });
    setAssetSource(source);
    expect(source.profile.races).toEqual(ADDED);
    expect(dataSetRaces()).toEqual(ADDED);
    // Declared as none: none.
    expect(keep("my-mod", [])).toBe(true);
    expect(keptRaces("my-mod")).toEqual([]);
    expect(racesOf({ id: "my-mod" })).toEqual([]);
  });

  it("are a stored key Preferences clears and imports live", () => {
    const store = createStore();
    const mod = stored("my-mod");
    setAssetSource(mod);
    store.set(gameDataSourceAtom, mod);
    expect(ownedStoredKeys()).toContain(RACES_KEY);
    store.set(keepRacesAtom, { id: "my-mod", races: ADDED });
    store.set(keepRacesAtom, { id: "other-mod", races: [ADDED[1]] });
    expect(store.get(dataSetRacesAtom)).toEqual(ADDED);
    const file = exportStoredPreferences();
    expect(JSON.parse(file.keys[RACES_KEY])).toEqual({ "my-mod": ADDED, "other-mod": [ADDED[1]] });
    // Cleared on its own: gone from storage, from the source in use and from the names, at once.
    expect(store.set(clearStoredKeysAtom, [RACES_KEY])).toBe(1);
    expect(browserStorage().getItem(RACES_KEY)).toBeNull();
    expect(store.get(dataSetRacesAtom)).toEqual([]);
    expect(store.get(gameDataSourceAtom)?.profile.races).toBeUndefined();
    expect(dataSetRaces()).toEqual([]);
    expect(raceText(69)).toBe("Race 69");
    // Imported: back, live.
    expect(store.set(importStoredPreferencesAtom, file)).toMatchObject({ ok: true });
    expect(keptRaces("other-mod")).toEqual([ADDED[1]]);
    expect(store.get(dataSetRacesAtom)).toEqual(ADDED);
    expect(raceText(69)).toBe("Askosi");
    // Clear all takes them too.
    store.set(clearStoredDataAtom);
    expect(store.get(dataSetRacesAtom)).toEqual([]);
    expect(keptRaces("my-mod")).toBeNull();
  });

  it("through the plugin API: setRaces, races(), names, a re-attach and a new release", async () => {
    const store = createStore();
    const mod = stored("my-mod");
    setAssetSource(mod);
    store.set(gameDataSourceAtom, mod);
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.gameData.races()).toEqual([]);
    expect(api.names.race(69)).toBe("Race 69");
    let events = 0;
    api.events.on("gameData", () => events++);
    const next = api.gameData.setRaces([{ id: 70, name: "Bloodsummon" }, { id: 69, name: "Askosi", letter: "a", like: 1 }, { id: 300, name: "No" }]);
    expect(next?.profile.races).toEqual(ADDED);
    expect(api.gameData.races()).toEqual(ADDED);
    expect(api.gameData.source()?.profile.races).toEqual(ADDED);
    expect(api.gameData.profile().races).toEqual(ADDED);
    expect(store.get(dataSetRacesAtom)).toEqual(ADDED);
    expect(events).toBe(1);
    expect(api.names.race(69)).toBe("Askosi");
    expect(api.names.race(1)).toBe("Terran");
    expect(api.names.race(71)).toBe("Race 71");
    expect(api.names.races().slice(8)).toEqual([{ value: 69, label: "Askosi" }, { value: 70, label: "Bloodsummon" }]);
    expect(api.names.races()).toHaveLength(10);
    // What a map saved now, and Test Map, carry.
    expect(testDataSet(store)).toEqual({ id: "my-mod", name: "My Mod", hash: "0123456789abcdef", races: ADDED });
    // The game's own takes none; a set not in use keeps them for later; a bad id is refused.
    expect(api.gameData.setRaces(ADDED, "starcraft")).toBeNull();
    expect(api.gameData.setRaces([ADDED[1]], "other-mod")).toBeNull();
    expect(keptRaces("other-mod")).toEqual([ADDED[1]]);
    expect(() => api.gameData.setRaces(ADDED, "Not An Id")).toThrow(/not a data set id/);

    // A plugin attaches the same set from memory with no races: the kept ones come back.
    const attached = await api.gameData.attach({ id: "my-mod", name: "My Mod" }, () => null, { hash: "fedcba9876543210" });
    expect(attached.profile.races).toEqual(ADDED);
    expect(api.names.race(70)).toBe("Bloodsummon");
    // A new release under the same id (a new hash), attached again: still kept.
    const release = await api.gameData.attach({ id: "my-mod", name: "My Mod 2" }, () => null, { hash: "1111111111111111" });
    expect(release.profile.races).toEqual(ADDED);
    // Races handed in with a profile are kept for its id, and come back without them.
    await api.gameData.attach({ id: "third-mod", name: "Third", races: [{ id: 80, name: "Third Race" }] }, () => null);
    expect(keptRaces("third-mod")).toEqual([{ id: 80, name: "Third Race" }]);
    const again = await api.gameData.attach({ id: "third-mod", name: "Third" }, () => null);
    expect(again.profile.races).toEqual([{ id: 80, name: "Third Race" }]);
    // Emptied: forgotten, and the names go back to Race n.
    expect(api.gameData.setRaces([])?.profile.races).toBeUndefined();
    expect(api.names.race(80)).toBe("Race 80");
    expect(api.gameData.races()).toEqual([]);
  });

  it("Player Settings keeps a byte nobody names as Race n and writes it back unchanged", () => {
    const scn = createScenario({ width: 64, height: 64, era: 0, name: "Races" });
    scn.playerRaces[0] = 69;
    scn.playerRaces[1] = 70;
    scn.dirty.clear();
    // Nothing declared: the select shows the game's eight and the map's byte as it is.
    const options = raceOptions(69, []);
    expect(options.slice(0, 8).map((o) => o.value)).toEqual([0, 1, 2, 5, 6, 3, 4, 7]);
    expect(options.at(-1)).toEqual({ value: 69, label: "Race 69" });
    expect(raceText(69, [])).toBe("Race 69");
    expect(raceText(1, [])).toBe("Terran");
    // Declared: by name, nothing added.
    expect(raceOptions(69, ADDED).filter((o) => o.value === 69)).toEqual([{ value: 69, label: "Askosi" }]);
    expect(raceText(69, ADDED)).toBe("Askosi");
    // The dialog's OK with nothing changed writes nothing; a change elsewhere keeps the byte.
    const local = readPlayerSettings(scn);
    applyPlayerSettings(scn, local);
    expect(scn.dirty.has("SIDE")).toBe(false);
    applyPlayerSettings(scn, { ...local, races: local.races.map((r, i) => (i === 2 ? 2 : r)) });
    expect(scn.dirty.has("SIDE")).toBe(true);
    expect(scn.playerRaces.slice(0, 3)).toEqual([69, 70, 2]);
    // The views name it by the data set in use.
    expect(playerSlotViews(scn)[0].raceName).toBe("Race 69");
    expect(mapStatistics(scn, null, null, null).players[0].race).toBe("Race 69");
    createStore().set(keepRacesAtom, { id: "my-mod", races: ADDED });
    setAssetSource(stored("my-mod"));
    expect(playerSlotViews(scn)[0].raceName).toBe("Askosi");
    expect(mapStatistics(scn, null, null, null).players[1].race).toBe("Bloodsummon");
  });

  it("a map's scmjs\\dataset.json carries them, reads them back and is safe with a table it cannot use", () => {
    const set = dataSetOf({ ...stored("my-mod"), profile: { id: "my-mod", name: "My Mod", races: ADDED } })!;
    expect(set.races).toEqual(ADDED);
    expect(dataSetOf(stored("my-mod"))).not.toHaveProperty("races");
    const extras = withDataSet(new Map<string, Uint8Array>(), set);
    expect(readDataSet(extras)).toEqual(set);
    // The same set says the same: nothing rewritten; other races: rewritten.
    expect(withDataSet(extras, { ...set, races: ADDED.map((r) => ({ ...r })) })).toBe(extras);
    expect(readDataSet(withDataSet(extras, { ...set, races: [ADDED[0]] }))?.races).toEqual([ADDED[0]]);
    const odd = new Map([[DATASET_MEMBER, text(JSON.stringify({ id: "my-mod", name: "My Mod", hash: "", races: [{ id: "69" }, { id: 69, name: "Askosi" }], later: 1 }))]]);
    expect(readDataSet(odd)).toEqual({ id: "my-mod", name: "My Mod", hash: "", races: [{ id: 69, name: "Askosi" }] });
    const broken = new Map([[DATASET_MEMBER, text(JSON.stringify({ id: "my-mod", name: "My Mod", hash: "", races: { 69: "Askosi" } }))]]);
    expect(readDataSet(broken)).toEqual({ id: "my-mod", name: "My Mod", hash: "" });
  });

  it("a map names races only for the set in use, and only when none were declared here", async () => {
    const store = createStore();
    const mod = stored("my-mod");
    setAssetSource(mod);
    store.set(gameDataSourceAtom, mod);
    const extras = withDataSet(new Map<string, Uint8Array>(), { id: "my-mod", name: "My Mod", hash: "", races: ADDED });
    await offerMapDataSet(store, extras);
    expect(keptRaces("my-mod")).toEqual(ADDED);
    expect(store.get(dataSetRacesAtom)).toEqual(ADDED);
    // Declared here already (even as none): the map's do not replace them.
    store.set(keepRacesAtom, { id: "my-mod", races: [] });
    await offerMapDataSet(store, extras);
    expect(keptRaces("my-mod")).toEqual([]);
    // A map of a set that is not loaded writes nothing for it; its member stays as it was.
    const other = withDataSet(new Map<string, Uint8Array>(), { id: "elsewhere", name: "Elsewhere", hash: "", races: ADDED });
    await offerMapDataSet(store, other);
    expect(keptRaces("elsewhere")).toBeNull();
    expect(readDataSet(other)?.races).toEqual(ADDED);
    expect(withDataSet(other, readDataSet(other))).toBe(other);
  });

  it("the plugin API's race hints: a set's own network.tbl past the game's and its letters, less what is declared", async () => {
    const store = createStore();
    const game: AssetSource = { kind: "none", label: "", tried: [], profile: { id: "starcraft", name: "StarCraft: Brood War" } };
    setAssetSource(game);
    store.set(gameDataSourceAtom, game);
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(await api.gameData.raceCandidates()).toEqual({ names: [], letters: [] });
    const files = new Map<string, Uint8Array>([
      ["rez/network.tbl", encodeTblFile({ strings: [...Array.from({ length: 168 }, (_, i) => `S${i}`), "Askosi", "Bloodsummon", "Kogri"], encoding: "windows-1252" })],
      ["game/aconsole.pcx", text("pcx")],
      ["rez/statbtnf.bin", text("bin")],
      ["game/tconsole.pcx", text("the game's own letter")],
    ]);
    const asked: string[] = [];
    await api.gameData.attach({ id: "fake-mod", name: "Fake Mod" }, (path) => { asked.push(path); return files.get(path) ?? null; });
    expect(await api.gameData.raceCandidates()).toEqual({ names: ["Askosi", "Bloodsummon", "Kogri"], letters: ["a", "f"] });
    expect(asked).toContain("game/qconsole.pcx");
    api.gameData.setRaces([{ id: 69, name: "askosi", letter: "a" }]);
    expect(await api.gameData.raceCandidates()).toEqual({ names: ["Bloodsummon", "Kogri"], letters: ["f"] });
  });

  it("Add a data set from a folder takes the races of the folder's own mod.json", async () => {
    const file = (path: string, body: string) => { const f = new File([body], path.split("/").pop()!); Object.defineProperty(f, "webkitRelativePath", { value: path }); return f; };
    const json = JSON.stringify({ name: "Mod", races: [{ id: 70, name: "Bloodsummon" }, { id: 69, name: "Askosi", letter: "a", like: 1 }, { id: 2, name: "No" }] });
    expect(await pickedFolderRaces([file("Mod/arr/units.dat", "u"), file("Mod/mod.json", json)])).toEqual(ADDED);
    // Only the one directly in the folder picked; a broken or absent one is none.
    expect(await pickedFolderRaces([file("Mod/arr/mod.json", json)])).toEqual([]);
    expect(await pickedFolderRaces([file("Mod/mod.json", "{ not json")])).toEqual([]);
    expect(await pickedFolderRaces([file("Mod/arr/units.dat", "u")])).toEqual([]);
    // Not a file of the set's: the split leaves it out, so the hash does not see it.
    expect(splitPickedFiles([file("Mod/arr/units.dat", "u"), file("Mod/mod.json", json)]).files.map((f) => f.path)).toEqual(["arr/units.dat"]);
  });
});
