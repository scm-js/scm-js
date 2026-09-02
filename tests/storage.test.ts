/** The `scmjs.` corner of browser storage: enumeration, sizes and the clear-all sweep. */
import { describe, expect, it, beforeEach } from "vitest";
import { createStore } from "jotai";
import { browserStorage, clearStoredData, STORAGE_PREFIX, storagePersists, storedKeys, storedSize } from "../src/atoms/storage";
import { clearStoredDataAtom, DEFAULT_PREFERENCES, preferencesAtom } from "../src/atoms/preferencesAtoms";
import { installedPluginsAtom } from "../src/atoms/pluginAtoms";

const store = browserStorage();

beforeEach(() => {
  store.clear();
});

describe("browser storage", () => {
  it("falls back to memory under Node, where nothing persists", () => {
    expect(storagePersists()).toBe(false);
    store.setItem("scmjs.prefs", "{}");
    expect(store.getItem("scmjs.prefs")).toBe("{}");
  });

  it("lists only the editor's keys, sorted", () => {
    store.setItem("scmjs.prefs", "{}");
    store.setItem("scmjs.grid", "{}");
    store.setItem(`${STORAGE_PREFIX}plugin.paint.brush`, "3");
    store.setItem("someone-elses-key", "keep me");
    expect(storedKeys()).toEqual(["scmjs.grid", "scmjs.plugin.paint.brush", "scmjs.prefs"]);
  });

  it("sizes an entry from its key and value", () => {
    store.setItem("scmjs.grid", "1234");
    expect(storedSize("scmjs.grid")).toBe(("scmjs.grid".length + 4) * 2);
    expect(storedSize("scmjs.missing")).toBe("scmjs.missing".length * 2);
  });

  it("clears every editor key and leaves the rest alone", () => {
    store.setItem("scmjs.prefs", "{}");
    store.setItem(`${STORAGE_PREFIX}plugin.paint.brush`, "3");
    store.setItem("someone-elses-key", "keep me");
    expect(clearStoredData()).toEqual(["scmjs.plugin.paint.brush", "scmjs.prefs"]);
    expect(storedKeys()).toEqual([]);
    expect(store.getItem("someone-elses-key")).toBe("keep me");
  });
});

describe("clearStoredDataAtom", () => {
  it("puts the atoms back on their defaults and sweeps the keys", () => {
    const store = createStore();
    store.set(preferencesAtom, { ...DEFAULT_PREFERENCES, splash: false });
    store.set(installedPluginsAtom, [{ spec: "github:someone/plugin", enabled: true }]);
    browserStorage().setItem(`${STORAGE_PREFIX}plugin.paint.brush`, "3");
    expect(storedKeys().length).toBe(3);

    expect(store.set(clearStoredDataAtom)).toBe(3);
    expect(storedKeys()).toEqual([]);
    expect(store.get(preferencesAtom)).toEqual(DEFAULT_PREFERENCES);
    expect(store.get(installedPluginsAtom)).toEqual([]);
  });
});
