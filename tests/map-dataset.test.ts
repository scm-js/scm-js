import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { archiveExtrasAtom } from "../src/atoms/documentAtoms";
import { gameDataSourceAtom } from "../src/atoms/gameDataAtoms";
import { dialogStackAtom } from "../src/atoms/uiAtoms";
import { createScenario } from "../src/formats/chk/create";
import { loadMap, readMembers } from "../src/formats/mpq/scm";
import { buildMapFile, defaultSaveOptions } from "../src/editor/save";
import { DEFAULT_PROFILE } from "../src/gamedata/profiles";
import type { AssetSource } from "../src/gamedata/source";
import { clearStoredCopy, keepInMemory } from "../src/gamedata/store";
import { DATASET_MEMBER, dataSetOf, offerMapDataSet, readDataSet, stampDataSet } from "../src/services/mapDataSet";
import { loadDocumentAtom } from "../src/atoms/documentAtoms";
import { Contributions, createPluginApi } from "../src/plugins/host";
import { testMapBytes } from "../src/services/testMap";
import { startSync } from "../src/services/sync";

/** A map remembers the data set it was made with (`scmjs\dataset.json`), and says so when it opens elsewhere. */
const mod: AssetSource = {
  kind: "stored", label: "", tried: [],
  profile: { id: "my-mod", name: "My Mod", url: "https://example.org/my-mod" },
  stored: { from: "", at: "", files: 1, bytes: 1, summary: "", profile: { id: "my-mod", name: "My Mod", url: "https://example.org/my-mod" }, hash: "ab".repeat(32), where: "memory" },
};
const game: AssetSource = { kind: "bundled", label: "", tried: [], profile: DEFAULT_PROFILE, base: "/" };

describe("the map's data set member", () => {
  it("is written on save with a data set other than the game's, and only then", () => {
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    expect(stampDataSet(store)).toBe(false);
    expect(store.get(archiveExtrasAtom).size).toBe(0);
    store.set(gameDataSourceAtom, mod);
    expect(stampDataSet(store)).toBe(true);
    expect(readDataSet(store.get(archiveExtrasAtom))).toEqual({ id: "my-mod", name: "My Mod", hash: "ab".repeat(32), url: "https://example.org/my-mod" });
    // Saved again with the same data set, nothing changes; back on the game's own data, the member stays.
    expect(stampDataSet(store)).toBe(false);
    store.set(gameDataSourceAtom, game);
    expect(stampDataSet(store)).toBe(false);
    expect(readDataSet(store.get(archiveExtrasAtom))?.id).toBe("my-mod");
  });

  it("rides in the archive and reads back", async () => {
    const scn = createScenario({ width: 16, height: 16, era: 0, name: "made for a data set" });
    const set = dataSetOf(mod)!;
    const extras = new Map([[DATASET_MEMBER, new TextEncoder().encode(JSON.stringify(set))]]);
    const bytes = await buildMapFile(scn, extras, defaultSaveOptions(scn, null, "made.scx"));
    const loaded = await loadMap(bytes);
    const back = await readMembers(loaded.archive!, loaded.files, new Set());
    expect(readDataSet(back.extras)).toEqual(set);
  });

  it("is ignored when it is not one (bad id, not JSON)", () => {
    const bad = (text: string) => readDataSet(new Map([[DATASET_MEMBER, new TextEncoder().encode(text)]]));
    expect(bad("{")).toBeNull();
    expect(bad(JSON.stringify({ id: "Not An Id", name: "x" }))).toBeNull();
    expect(bad(JSON.stringify({ id: "ok", name: "", url: "javascript:alert(1)" }))).toEqual({ id: "ok", name: "ok", hash: "" });
  });

  it("asks to switch when the data set is here, and says where it is published when it is not", async () => {
    const store = createStore();
    store.set(gameDataSourceAtom, game);
    const extras = new Map([[DATASET_MEMBER, new TextEncoder().encode(JSON.stringify(dataSetOf(mod)))]]);
    await offerMapDataSet(store, extras);
    expect(store.get(dialogStackAtom).map((d) => [d.id, d.payload?.installed, d.payload?.url])).toEqual([["mapDataSet", false, "https://example.org/my-mod"]]);
    keepInMemory(new Map(), mod.stored!, "my-mod");
    try {
      const again = createStore();
      again.set(gameDataSourceAtom, game);
      await offerMapDataSet(again, extras);
      expect(again.get(dialogStackAtom).map((d) => [d.id, d.payload?.installed])).toEqual([["mapDataSet", true]]);
      // Already drawing from it: nothing to ask.
      const same = createStore();
      same.set(gameDataSourceAtom, mod);
      await offerMapDataSet(same, extras);
      expect(same.get(dialogStackAtom)).toEqual([]);
    } finally {
      await clearStoredCopy("my-mod");
    }
  });
});

/** Every way a map leaves the editor carries the member when a data set other than the game's is in use (C7 audit). */
describe("the member on the way out", () => {
  function opened(source: AssetSource) {
    const store = createStore();
    store.set(gameDataSourceAtom, source);
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 16, height: 16, era: 2, name: "leaving" }), extras: new Map(), fileName: "leaving.scx" });
    return store;
  }
  const memberOf = async (bytes: Uint8Array | null | undefined) => {
    const file = await loadMap(bytes!);
    return readDataSet((await readMembers(file.archive!, file.files, new Set())).extras);
  };
  const set = dataSetOf(mod);

  it("is in what Export makes, built or not, and the document is left as it was", async () => {
    const store = opened(mod);
    const api = createPluginApi(store, { id: "p", name: "P", source: "s" }, new Contributions());
    const file = await api.document.export({ format: "scx" });
    expect(await memberOf(new Uint8Array(await file!.arrayBuffer()))).toEqual(set);
    const plain = await api.document.export({ format: "scx", built: false });
    expect(await memberOf(new Uint8Array(await plain!.arrayBuffer()))).toEqual(set);
    expect(store.get(archiveExtrasAtom).size).toBe(0);
  });

  it("is in the bytes Test Map builds", async () => {
    expect(await memberOf(await testMapBytes(opened(mod)))).toEqual(set);
  });

  it("is in the copy a shared map hands someone joining", async () => {
    const store = opened(mod);
    const session = startSync(store, { send: () => {} })!;
    expect(await memberOf(await session.snapshot())).toEqual(set);
    session.stop();
  });

  it("is not added for the game's own data", async () => {
    expect(await memberOf(await testMapBytes(opened(game)))).toBeNull();
    const store = opened(game);
    const api = createPluginApi(store, { id: "p", name: "P", source: "s" }, new Contributions());
    const file = await api.document.export({ format: "scx" });
    expect(await memberOf(new Uint8Array(await file!.arrayBuffer()))).toBeNull();
  });
});
