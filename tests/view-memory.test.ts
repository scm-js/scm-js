/**
 * The View menu's remembered ticks (`app/viewMemory.ts`, `viewMemoryAtom` behind
 * `viewFlagsAtom`): the grid, the location names, the two animations and Remastered
 * Graphics survive a reload, everything else is the session's; a choice an older version
 * kept in the preferences is carried over once; the animations start off under "reduce
 * motion" until the person sets them; and Preferences ▸ Storage puts them back live.
 *
 * A stored atom reads its key when its module loads, so a reload here is a fresh import of
 * the atoms over a `window.localStorage` that outlives it.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "jotai";
import { carryOverViewPreferences, sanitizeViewMemory, VIEW_MEMORY_KEY } from "../src/app/viewMemory";

const mem = new Map<string, string>();
const storage: Storage = {
  get length() { return mem.size; },
  clear: () => mem.clear(),
  getItem: (k) => mem.get(k) ?? null,
  key: (i) => [...mem.keys()][i] ?? null,
  removeItem: (k) => { mem.delete(k); },
  setItem: (k, v) => { mem.set(k, String(v)); },
};
let reduceMotion = false;
vi.stubGlobal("window", {
  localStorage: storage,
  matchMedia: (query: string) => ({ matches: reduceMotion && query.includes("prefers-reduced-motion: reduce") }),
  addEventListener: () => {},
  removeEventListener: () => {},
});
afterAll(() => { vi.unstubAllGlobals(); });

/** The editor as a page load finds it: the atoms freshly imported, over what storage holds now. */
async function reload() {
  vi.resetModules();
  const editor = await import("../src/atoms/editorAtoms");
  const prefs = await import("../src/atoms/preferencesAtoms");
  const mode = await import("../src/atoms/viewModeAtoms");
  const kept = await import("../src/app/storage");
  return { store: createStore(), ...editor, ...prefs, toggleFlagAtom: mode.toggleFlagAtom, storedKeys: kept.storedKeys };
}

const stored = () => JSON.parse(storage.getItem(VIEW_MEMORY_KEY) ?? "null") as unknown;

beforeEach(() => {
  mem.clear();
  reduceMotion = false;
});

describe("the View menu's remembered ticks", () => {
  it("keeps the grid, location names, animations and Remastered Graphics, and nothing else", async () => {
    const first = await reload();
    first.store.set(first.viewFlagsAtom, (f) => ({ ...f, grid: true, locationNames: false, animateWater: false, hdGraphics: true }));
    first.store.set(first.viewFlagsAtom, (f) => ({ ...f, elevation: true, fog: true, units: false, doodads: false, startLocations: false }));
    expect(stored()).toEqual({ grid: true, locationNames: false, animateWater: false, hdGraphics: true });

    const next = await reload();
    expect(next.store.get(next.viewFlagsAtom)).toEqual({
      grid: true, locationNames: false, animateWater: false, animateUnits: true, hdGraphics: true,
      elevation: false, fog: false, buildability: false, seams: false, pins: false, asymmetry: false, changes: false,
      units: true, doodads: true, startLocations: true, locations: true, sprites: true,
    });
  });

  it("remembers a tick whichever way it is changed: the menu or a hotkey, and a plain set as the plugin API makes", async () => {
    const page = await reload();
    page.store.set(page.toggleFlagAtom, "grid");
    page.store.set(page.viewFlagsAtom, { ...page.store.get(page.viewFlagsAtom), animateUnits: false });
    expect(stored()).toEqual({ grid: true, animateUnits: false });
    const next = await reload();
    expect(next.store.get(next.viewFlagsAtom)).toMatchObject({ grid: true, animateUnits: false });
  });


  it("tells nobody when an update hands back the ticks it was given", async () => {
    const page = await reload();
    let told = 0;
    const stop = page.store.sub(page.viewFlagsAtom, () => { told++; });
    const before = page.store.get(page.viewFlagsAtom);
    told = 0;
    page.store.set(page.viewFlagsAtom, (f) => f);
    expect(told).toBe(0);
    expect(page.store.get(page.viewFlagsAtom)).toBe(before);
    page.store.set(page.viewFlagsAtom, (f) => ({ ...f, fog: true }));
    expect(told).toBe(1);
    expect(mem.has(VIEW_MEMORY_KEY)).toBe(false);
    stop();
  });

  it("writes nothing for a change that leaves the remembered five alone", async () => {
    const page = await reload();
    page.store.set(page.viewFlagsAtom, (f) => ({ ...f, elevation: true }));
    expect(storage.getItem(VIEW_MEMORY_KEY)).toBe(null);
    expect(page.store.get(page.viewFlagsAtom).elevation).toBe(true);
  });

  it("drops whatever in the stored value is not one of the five ticks", async () => {
    expect(sanitizeViewMemory({ grid: true, elevation: true, hdGraphics: "yes", units: false })).toEqual({ grid: true });
    expect(sanitizeViewMemory([true])).toEqual({});
    storage.setItem(VIEW_MEMORY_KEY, '{"grid":true,"units":false}');
    const page = await reload();
    expect(page.store.get(page.viewFlagsAtom)).toMatchObject({ grid: true, units: true });
  });
});

describe("a choice made under Preferences ▸ View before", () => {
  it("is carried over the first time, and the preferences lose the three fields", async () => {
    storage.setItem("scmjs.prefs", JSON.stringify({ language: "ko", splash: false, animateWater: false, animateUnits: true, hdGraphics: true }));
    const page = await reload();
    expect(page.store.get(page.viewFlagsAtom)).toMatchObject({ animateWater: false, animateUnits: true, hdGraphics: true, grid: false });
    expect(stored()).toEqual({ animateWater: false, hdGraphics: true });
    expect(JSON.parse(storage.getItem("scmjs.prefs")!)).toEqual({ language: "ko", splash: false });
    expect(page.store.get(page.preferencesAtom)).toEqual({ ...page.DEFAULT_PREFERENCES, language: "ko", splash: false });
  });

  it("carries nothing when the old values were the old defaults", () => {
    storage.setItem("scmjs.prefs", JSON.stringify({ animateWater: true, animateUnits: true, hdGraphics: false }));
    carryOverViewPreferences(storage);
    expect(storage.getItem(VIEW_MEMORY_KEY)).toBe(null);
    expect(JSON.parse(storage.getItem("scmjs.prefs")!)).toEqual({});
  });

  it("does not override ticks already remembered, and does not come back after a clear", async () => {
    storage.setItem(VIEW_MEMORY_KEY, '{"grid":true}');
    storage.setItem("scmjs.prefs", JSON.stringify({ animateWater: false }));
    const page = await reload();
    expect(page.store.get(page.viewFlagsAtom)).toMatchObject({ grid: true, animateWater: true });
    expect(page.store.set(page.clearStoredKeysAtom, [VIEW_MEMORY_KEY])).toBe(1);
    const next = await reload();
    expect(next.store.get(next.viewFlagsAtom)).toMatchObject({ grid: false, animateWater: true });
  });
});

describe("reduce motion", () => {
  it("starts the animations off when the person has not set them", async () => {
    reduceMotion = true;
    const page = await reload();
    expect(page.store.get(page.viewFlagsAtom)).toMatchObject({ animateWater: false, animateUnits: false, grid: false, hdGraphics: false });
    expect(storage.getItem(VIEW_MEMORY_KEY)).toBe(null);
  });

  it("gives way to a tick the person set", async () => {
    reduceMotion = true;
    const page = await reload();
    page.store.set(page.toggleFlagAtom, "animateWater");
    expect(page.store.get(page.viewFlagsAtom)).toMatchObject({ animateWater: true, animateUnits: false });
    expect(stored()).toEqual({ animateWater: true });

    const next = await reload();
    expect(next.store.get(next.viewFlagsAtom)).toMatchObject({ animateWater: true, animateUnits: false });
  });

  it("gives way to a choice carried over from the preferences", async () => {
    reduceMotion = true;
    storage.setItem("scmjs.prefs", JSON.stringify({ animateWater: true, animateUnits: false }));
    const page = await reload();
    expect(page.store.get(page.viewFlagsAtom)).toMatchObject({ animateWater: false, animateUnits: false });
    page.store.set(page.toggleFlagAtom, "animateWater");
    const next = await reload();
    expect(next.store.get(next.viewFlagsAtom)).toMatchObject({ animateWater: true, animateUnits: false });
  });
});

describe("Preferences ▸ Storage", () => {
  it("clearing the row puts the five back on their defaults at once", async () => {
    const page = await reload();
    const { store } = page;
    store.set(page.viewFlagsAtom, (f) => ({ ...f, grid: true, locationNames: false, animateWater: false, animateUnits: false, hdGraphics: true, elevation: true }));
    expect(store.set(page.clearStoredKeysAtom, [VIEW_MEMORY_KEY])).toBe(1);
    expect(page.storedKeys()).toEqual([]);
    expect(store.get(page.viewMemoryAtom)).toEqual({});
    // The session's overlay is not the row's to clear.
    expect(store.get(page.viewFlagsAtom)).toMatchObject({ grid: false, locationNames: true, animateWater: true, animateUnits: true, hdGraphics: false, elevation: true });
  });

  it("Clear all data does the same", async () => {
    const page = await reload();
    page.store.set(page.viewFlagsAtom, (f) => ({ ...f, grid: true, hdGraphics: true }));
    page.store.set(page.clearStoredDataAtom);
    expect(page.store.get(page.viewFlagsAtom)).toMatchObject({ grid: false, hdGraphics: false });
  });

  it("Export carries the ticks and Import puts them on screen", async () => {
    const page = await reload();
    page.store.set(page.viewFlagsAtom, (f) => ({ ...f, grid: true, animateWater: false }));
    const file = page.exportStoredPreferences();
    expect(JSON.parse(file.keys[VIEW_MEMORY_KEY])).toEqual({ grid: true, animateWater: false });

    mem.clear();
    const other = await reload();
    expect(other.store.get(other.viewFlagsAtom)).toMatchObject({ grid: false, animateWater: true });
    expect(other.store.set(other.importStoredPreferencesAtom, file)).toEqual({ ok: true, keys: 1 });
    expect(other.store.get(other.viewFlagsAtom)).toMatchObject({ grid: true, animateWater: false });
  });

  it("Import of a file from before carries its choices over", async () => {
    const page = await reload();
    expect(page.store.get(page.viewFlagsAtom).hdGraphics).toBe(false);
    const file = { scmjs: "preferences", version: 1, keys: { "scmjs.prefs": JSON.stringify({ language: "ko", hdGraphics: true }) } };
    expect(page.store.set(page.importStoredPreferencesAtom, file)).toEqual({ ok: true, keys: 1 });
    expect(page.store.get(page.preferencesAtom).language).toBe("ko");
    expect(page.store.get(page.viewFlagsAtom).hdGraphics).toBe(true);
    expect(JSON.parse(storage.getItem("scmjs.prefs")!)).toEqual({ ...page.DEFAULT_PREFERENCES, language: "ko" });
  });
});
