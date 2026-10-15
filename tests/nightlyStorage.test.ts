import { describe, expect, it } from "vitest";
import { namespaced } from "../src/atoms/storage";

/** A plain Storage over a Map, as localStorage behaves. */
function memory(entries: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(entries));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

describe("the hosted nightly's storage, on the stable editor's origin", () => {
  it("keeps the editor's keys under a space of its own, by the names the editor uses", () => {
    const raw = memory({ "scmjs.prefs": "stable", "scmjs-moved": "1", "other": "x" });
    const nightly = namespaced(raw, "nightly");
    expect(nightly.getItem("scmjs.prefs")).toBeNull();
    nightly.setItem("scmjs.prefs", "nightly");
    nightly.setItem("scmjs.plugin.aftermath.settings", "{}");
    expect(raw.getItem("scmjs-nightly.prefs")).toBe("nightly");
    expect(raw.getItem("scmjs.prefs")).toBe("stable");
    expect(nightly.getItem("scmjs.prefs")).toBe("nightly");
    // The move-in's note has a space of its own too, so the stable editor's does not stop the nightly asking.
    expect(nightly.getItem("scmjs-moved")).toBeNull();
    nightly.setItem("scmjs-moved", "1");
    expect(raw.getItem("scmjs-nightly-moved")).toBe("1");
  });

  it("lists its own keys and any that are not the editor's, never the stable editor's, and clears only its own", () => {
    const raw = memory({ "scmjs.prefs": "stable", "scmjs-moved": "1", "other": "x", "scmjs-nightly.grid": "{}" });
    const nightly = namespaced(raw, "nightly");
    const keys = Array.from({ length: nightly.length }, (_, i) => nightly.key(i));
    expect(keys.sort()).toEqual(["other", "scmjs.grid"]);
    nightly.clear();
    expect(raw.getItem("scmjs-nightly.grid")).toBeNull();
    expect(raw.getItem("scmjs.prefs")).toBe("stable");
    expect(raw.getItem("scmjs-moved")).toBe("1");
    expect(raw.getItem("other")).toBe("x");
  });
});
