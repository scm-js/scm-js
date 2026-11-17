/**
 * The preferences added in the Preferences rework, at the points where each takes effect:
 * the merge that gives an old stored object the new fields, the undo depth and recents
 * cap read at commit time, the new map's revision, the Save dialog's starting options,
 * the preferences file that carries the lot between browsers, and what the dialog's two
 * resets put back.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { browserStorage, mergeDefaults } from "../src/atoms/storage";
import { DEFAULT_PREFERENCES, exportStoredPreferences, gridLookAtom, importStoredPreferencesAtom, preferencesAtom } from "../src/atoms/preferencesAtoms";
import { gridSizeAtom, mapModifiedAtom } from "../src/atoms/editorAtoms";
import { commitEditAtom, pushRecentAtom, recentFilesAtom, scenarioAtom, undoStackAtom } from "../src/atoms/documentAtoms";
import { createScenario } from "../src/formats/chk/create";
import { defaultSaveOptions, initialSaveOptions } from "../src/editor/save";
import { NEVER_RESET, PREFERENCES_PAGE_KEYS, resetPreferences, type Preferences, type PreferencesPage } from "../src/editor/preferences";
import { newMapInto } from "../src/services/documentActions";

beforeEach(() => {
  browserStorage().clear();
});

describe("the preferences object", () => {
  it("gives an old stored object the new fields, one level down as well", () => {
    const old = { language: "ko", newMap: { tileset: "jungle", width: 64, height: 64 }, updates: { nightly: true } } as never;
    const merged = mergeDefaults(DEFAULT_PREFERENCES, old);
    expect(merged.language).toBe("ko");
    expect(merged.newMap).toEqual({ tileset: "jungle", width: 64, height: 64, version: "broodwar" });
    expect(merged.updates).toEqual({ checkOnStart: true, nightly: true });
    expect(merged.view).toEqual(DEFAULT_PREFERENCES.view);
    expect(merged.undoLevels).toBe(200);
  });
});

describe("what the preferences drive", () => {
  const stroke = (n: number) => ({ label: `s${n}`, changes: [{ x: 0, y: 0, from: 0, to: n }] });

  it("keeps as many undo levels as the preference says, from the next commit on", () => {
    const store = createStore();
    store.set(scenarioAtom, createScenario({ width: 8, height: 8, era: 0, name: "p" }));
    store.set(preferencesAtom, { ...DEFAULT_PREFERENCES, undoLevels: 20 });
    for (let i = 0; i < 25; i++) store.set(commitEditAtom, stroke(i));
    expect(store.get(undoStackAtom)).toHaveLength(20);
    expect(store.get(undoStackAtom)[0].label).toBe("s5");
    expect(store.get(mapModifiedAtom)).toBe(true);
    store.set(preferencesAtom, { ...DEFAULT_PREFERENCES, undoLevels: 30 });
    for (let i = 25; i < 35; i++) store.set(commitEditAtom, stroke(i));
    expect(store.get(undoStackAtom)).toHaveLength(30);
  });

  it("keeps as many recent files as the preference says", () => {
    const store = createStore();
    store.set(preferencesAtom, { ...DEFAULT_PREFERENCES, startup: { reopenLast: false, recents: 5 } });
    for (let i = 0; i < 8; i++) store.set(pushRecentAtom, { name: `m${i}.scx`, handle: null });
    expect(store.get(recentFilesAtom).map((r) => r.name)).toEqual(["m7.scx", "m6.scx", "m5.scx", "m4.scx", "m3.scx"]);
  });

  it("starts a new map on the revision the preference names", async () => {
    const store = createStore();
    store.set(preferencesAtom, { ...DEFAULT_PREFERENCES, newMap: { ...DEFAULT_PREFERENCES.newMap, version: "remastered" } });
    await newMapInto(store, { width: 64, height: 64, tileset: "badlands", name: "n", description: "" });
    expect(store.get(scenarioAtom)?.fileVersion).toBe(206);
    expect(store.get(scenarioAtom)?.strings.extended).toBe(true);
    // Asked for on the call itself, the option wins over the preference.
    await newMapInto(store, { width: 64, height: 64, tileset: "badlands", name: "n", description: "", version: "broodwar" }, false, "replace");
    expect(store.get(scenarioAtom)?.fileVersion).toBe(205);
  });

  it("seeds the Save dialog from the preferences when the map has no options of its own yet", () => {
    const scn = createScenario({ width: 8, height: 8, era: 0, name: "p" });
    // A fresh map follows the compression preference, and takes no encryption outside PKWARE.
    expect(defaultSaveOptions(scn, null, null, "zlib")).toMatchObject({ compression: "zlib", encrypt: false });
    expect(defaultSaveOptions(scn, null, null, "none")).toMatchObject({ compression: "none", encrypt: false });
    expect(defaultSaveOptions(scn, null, null, "pkware")).toMatchObject({ compression: "pkware", encrypt: true });
    // An opened file is stored the way it came whatever the preference says.
    const origin = { compression: "none" as const, encrypted: false, storedSize: 1, size: 1, sectorSize: 4096 };
    expect(defaultSaveOptions(scn, origin, "a.scx", "zlib")).toMatchObject({ compression: "none", encrypt: false });
    // The preset the preference names is applied over that base.
    expect(initialSaveOptions(scn, null, null, null, { start: "smallest", compression: "asOpened" })).toMatchObject({ compression: "pkware", stripTerrainEditing: true, dropTrailing: true });
    expect(initialSaveOptions(scn, origin, "a.scx", null, { start: "everything", compression: "zlib" })).toMatchObject({ compression: "none", stripTerrainEditing: false });
    // Options confirmed in this session win over everything.
    const stored = { ...defaultSaveOptions(scn, null, null), format: "scm" as const };
    expect(initialSaveOptions(scn, null, null, stored, { start: "smallest", compression: "zlib" })).toBe(stored);
  });
});

describe("the preferences file", () => {
  it("carries every setting and the plugins' own, but not the caches or the recents", () => {
    const storage = browserStorage();
    storage.setItem("scmjs.prefs", JSON.stringify({ ...DEFAULT_PREFERENCES, language: "ko" }));
    storage.setItem("scmjs.grid", JSON.stringify({ color: "#ff0000", opacity: 50, style: "dots" }));
    storage.setItem("scmjs.plugin.magenta.layout", JSON.stringify({ dock: "right" }));
    storage.setItem("scmjs.recents", "[]");
    storage.setItem("scmjs.plugin-code", "{}");
    storage.setItem("other.thing", "1");
    const file = exportStoredPreferences();
    expect(file).toMatchObject({ scmjs: "preferences", version: 1 });
    expect(Object.keys(file.keys).sort()).toEqual(["scmjs.grid", "scmjs.plugin.magenta.layout", "scmjs.prefs"]);
  });

  it("comes back live: the atoms take the imported values without a reload", () => {
    const store = createStore();
    store.set(gridSizeAtom, 64);
    expect(store.get(gridLookAtom).color).toBe("#000000");
    const r = store.set(importStoredPreferencesAtom, {
      scmjs: "preferences",
      version: 1,
      keys: {
        "scmjs.prefs": JSON.stringify({ language: "ko", undoLevels: 50 }),
        "scmjs.grid": JSON.stringify({ color: "#ff0000", opacity: 50, style: "dots" }),
        "scmjs.gridSize": "16",
        "scmjs.plugin.magenta.layout": JSON.stringify({ dock: "right" }),
        "scmjs.plugin-code": "{}",
        "not.ours": "1",
        "scmjs.broken": "{",
      },
    });
    expect(r).toEqual({ ok: true, keys: 4 });
    expect(store.get(preferencesAtom)).toMatchObject({ language: "ko", undoLevels: 50, newMap: DEFAULT_PREFERENCES.newMap });
    expect(store.get(gridLookAtom)).toEqual({ color: "#ff0000", opacity: 50, style: "dots" });
    expect(store.get(gridSizeAtom)).toBe(16);
    expect(browserStorage().getItem("scmjs.plugin.magenta.layout")).toBe(JSON.stringify({ dock: "right" }));
    expect(browserStorage().getItem("scmjs.plugin-code")).toBeNull();
    expect(browserStorage().getItem("not.ours")).toBeNull();
    expect(store.set(importStoredPreferencesAtom, { hello: 1 })).toEqual({ ok: false, reason: "not a preferences file" });
  });
});

describe("the Preferences dialog's resets", () => {
  const pages = Object.keys(PREFERENCES_PAGE_KEYS) as PreferencesPage[];
  /** Every preference moved off its default, so a reset shows in each one. */
  const changed: Preferences = {
    ...DEFAULT_PREFERENCES,
    language: "ko",
    splash: false,
    newMap: { ...DEFAULT_PREFERENCES.newMap, tileset: "jungle" },
    save: { ...DEFAULT_PREFERENCES.save, backup: false },
    undoLevels: 50,
    classicText: true,
    testMap: { ...DEFAULT_PREFERENCES.testMap, dir: "C:/StarCraft" },
    plugins: { updates: "manual" },
    hotkeys: { "tools.preferences": [] },
    counting: false,
  };

  // The other half of adding a preference: give it the page that shows it, so that page's
  // Reset puts it back. A key on no page is one neither reset reaches.
  it("puts every preference on exactly one page, or on the short list a reset never touches", () => {
    const owners = new Map<string, string[]>();
    for (const page of pages) for (const key of PREFERENCES_PAGE_KEYS[page]) owners.set(key, [...(owners.get(key) ?? []), page]);
    for (const key of NEVER_RESET) owners.set(key, [...(owners.get(key) ?? []), "never reset"]);
    const lost = Object.keys(DEFAULT_PREFERENCES).filter((key) => !owners.has(key));
    expect(lost, "on no page's list in PREFERENCES_PAGE_KEYS (editor/preferences.ts)").toEqual([]);
    const twice = [...owners].filter(([, where]) => where.length > 1);
    expect(twice, "on more than one list").toEqual([]);
    expect([...owners.keys()].filter((key) => !(key in DEFAULT_PREFERENCES)), "listed but not a preference").toEqual([]);
  });

  it("puts back only the page it is asked for", () => {
    const files = resetPreferences(changed, ["files"]);
    expect(files.newMap).toEqual(DEFAULT_PREFERENCES.newMap);
    expect(files.save).toEqual(DEFAULT_PREFERENCES.save);
    expect(files.language).toBe("ko");
    expect(files.hotkeys).toEqual(changed.hotkeys);
    expect(resetPreferences(changed, ["storage"])).toEqual(changed);
    expect(resetPreferences(changed, ["hotkeys"]).hotkeys).toEqual({});
  });

  it("puts every page back but never turns counting on again", () => {
    const all = resetPreferences(changed, pages);
    expect(all).toEqual({ ...DEFAULT_PREFERENCES, counting: false });
    for (const page of pages) expect(resetPreferences(changed, [page]).counting).toBe(false);
    expect(resetPreferences(DEFAULT_PREFERENCES, pages).counting).toBe(true);
  });
});
