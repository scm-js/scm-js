import { describe, expect, it } from "vitest";
import { STORAGE_PREFIX } from "../src/atoms/storage";
import { MOVED_KEY, owed, SITE_ORIGIN, takeIn, TRIES_KEY } from "../src/moveIn";

function store(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

describe("moving in from the editor's old address", () => {
  it("asks only on the site, once, and gives up after three silent visits", () => {
    expect(owed(SITE_ORIGIN, store())).toBe(true);
    expect(owed("https://nightly.editor.scmjs.dev", store())).toBe(false);
    expect(owed("http://localhost:5173", store())).toBe(false);
    expect(owed("scmjs://app", store())).toBe(false);
    expect(owed(SITE_ORIGIN, store({ [MOVED_KEY]: "1" }))).toBe(false);
    expect(owed(SITE_ORIGIN, store({ [TRIES_KEY]: "2" }))).toBe(true);
    expect(owed(SITE_ORIGIN, store({ [TRIES_KEY]: "3" }))).toBe(false);
  });

  it("takes the editor's keys, and never over one already here", () => {
    const s = store({ "scmjs.prefs": '{"language":"ko"}' });
    const written = takeIn(s, {
      "scmjs.prefs": '{"language":"en"}',
      "scmjs.plugins": "[]",
      "scmjs.plugin.scmjs-dev.settings": '{"session":"x"}',
      "other.key": "no",
      "scmjs.grid": 4,
    });
    expect(written).toBe(2);
    expect(s.map.get("scmjs.prefs")).toBe('{"language":"ko"}');
    expect(s.map.get("scmjs.plugins")).toBe("[]");
    expect(s.map.get("scmjs.plugin.scmjs-dev.settings")).toBe('{"session":"x"}');
    expect(s.map.has("other.key")).toBe(false);
    expect(s.map.has("scmjs.grid")).toBe(false);
  });

  it("keeps its own marks where Clear all data does not reach", () => {
    expect(MOVED_KEY.startsWith(STORAGE_PREFIX)).toBe(false);
    expect(TRIES_KEY.startsWith(STORAGE_PREFIX)).toBe(false);
  });

  it("takes nothing from an answer that is not a set of entries", () => {
    for (const answer of [null, undefined, "text", 3]) expect(takeIn(store(), answer)).toBe(0);
  });

  it("goes on past a key that does not fit", () => {
    const s = store();
    const full = { ...s, setItem: (k: string, v: string) => { if (k === "scmjs.big") throw new Error("quota"); s.setItem(k, v); } };
    expect(takeIn(full, { "scmjs.big": "x", "scmjs.small": "y" })).toBe(1);
    expect(s.map.get("scmjs.small")).toBe("y");
  });
});
