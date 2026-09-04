/**
 * The `scmjs.` corner of browser storage: enumeration, sizes, removing one entry or the
 * lot, and the atoms that own a key — including a sweep of the source for a stored atom
 * nobody registered, since such a key can be removed but not put back on its default.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { createStore } from "jotai";
import { browserStorage, clearStoredData, removeStoredKeys, STORAGE_PREFIX, storagePersists, storedKeys, storedKeysUnder, storedSize, storedValue } from "../src/atoms/storage";
import { clearStoredDataAtom, clearStoredKeysAtom, DEFAULT_PREFERENCES, ownedStoredKeys, preferencesAtom } from "../src/atoms/preferencesAtoms";
import { gridSizeAtom } from "../src/atoms/editorAtoms";
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

describe("removing single entries", () => {
  it("removes the keys that were there, and refuses anything outside the prefix", () => {
    store.setItem("scmjs.grid", "{}");
    store.setItem("someone-elses-key", "keep me");
    expect(removeStoredKeys(["scmjs.grid", "scmjs.missing", "someone-elses-key"])).toEqual(["scmjs.grid"]);
    expect(store.getItem("someone-elses-key")).toBe("keep me");
  });

  it("reads a value back and groups a plugin's keys by prefix", () => {
    store.setItem(`${STORAGE_PREFIX}plugin.paint.brush`, "3");
    store.setItem(`${STORAGE_PREFIX}plugin.paint.color`, "7");
    store.setItem(`${STORAGE_PREFIX}plugin.repair.seen`, "1");
    expect(storedValue(`${STORAGE_PREFIX}plugin.paint.brush`)).toBe("3");
    expect(storedValue("scmjs.missing")).toBe(null);
    expect(storedKeysUnder(`${STORAGE_PREFIX}plugin.paint.`)).toEqual([
      "scmjs.plugin.paint.brush",
      "scmjs.plugin.paint.color",
    ]);
  });
});

describe("clearStoredKeysAtom", () => {
  it("resets the atom behind a key and leaves the other entries alone", () => {
    const store = createStore();
    store.set(preferencesAtom, { ...DEFAULT_PREFERENCES, splash: false });
    store.set(gridSizeAtom, 64);
    browserStorage().setItem(`${STORAGE_PREFIX}plugin.paint.brush`, "3");

    expect(store.set(clearStoredKeysAtom, ["scmjs.prefs"])).toBe(1);
    expect(store.get(preferencesAtom)).toEqual(DEFAULT_PREFERENCES);
    expect(store.get(gridSizeAtom)).toBe(64);
    expect(storedKeys()).toEqual(["scmjs.gridSize", "scmjs.plugin.paint.brush"]);
  });

  it("sweeps a plugin's own keys, which no atom owns", () => {
    const store = createStore();
    browserStorage().setItem(`${STORAGE_PREFIX}plugin.paint.brush`, "3");
    browserStorage().setItem(`${STORAGE_PREFIX}plugin.repair.seen`, "1");
    expect(store.set(clearStoredKeysAtom, [`${STORAGE_PREFIX}plugin.paint.brush`])).toBe(1);
    expect(storedKeys()).toEqual(["scmjs.plugin.repair.seen"]);
  });

  it("counts only the keys that were actually stored", () => {
    const store = createStore();
    browserStorage().setItem("scmjs.grid", "{}");
    expect(store.set(clearStoredKeysAtom, ["scmjs.grid", "scmjs.docks"])).toBe(1);
  });
});

/** Every `atomWithStorage("scmjs.…")` in the source, so the table below cannot fall behind. */
function storedAtomKeys(): string[] {
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) {
        const src = readFileSync(path, "utf8");
        for (const at of src.matchAll(/atomWithStorage/g)) {
          const key = /"(scmjs\.[^"]+)"/.exec(src.slice(at.index, at.index + 200));
          if (key) keys.add(key[1]);
        }
      }
    }
  };
  walk(join(__dirname, "..", "src"));
  return [...keys].sort();
}

describe("ownedStoredKeys", () => {
  it("covers every atom that writes to storage", () => {
    expect(ownedStoredKeys()).toEqual(storedAtomKeys());
  });
});
