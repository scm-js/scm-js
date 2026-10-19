import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { count, countingWanted, countPluginUse, extOf, flushCounts, gameDataOf, OFF_KEY, pluginCountName, resetCountsForTests, setCounting, waitingCounts } from "../src/services/usage";
import { changedPreferences, DEFAULT_PREFERENCES } from "../src/editor/preferences";
import type { AssetSource } from "../src/gamedata/source";
import { DEFAULT_PROFILE } from "../src/gamedata/profiles";

type Tracked = { name: string; props?: Record<string, unknown> };

describe("feature counts", () => {
  let sent: Tracked[];
  let stored: Map<string, string>;
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    stored = new Map();
    vi.stubGlobal("window", { scmjsHits: { track: (name: string, props?: Record<string, unknown>) => sent.push({ name, props }) }, addEventListener: () => {} });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => {} });
    vi.stubGlobal("localStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v), removeItem: (k: string) => stored.delete(k) });
    resetCountsForTests(true);
  });
  afterEach(() => {
    resetCountsForTests(false);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does nothing where the editor is not the hosted one", () => {
    resetCountsForTests(false);
    count("dialog", { id: "find" });
    expect(waitingCounts()).toEqual([]);
  });

  it("gathers the same feature with the same words into one line with a count", () => {
    count("edit", { layer: "terrain", part: "terrain" });
    count("edit", { part: "terrain", layer: "terrain" });
    count("edit", { layer: "units", part: "units" });
    count("undo");
    expect(waitingCounts()).toEqual([
      { name: "edit", props: { layer: "terrain", part: "terrain" }, n: 2 },
      { name: "edit", props: { layer: "units", part: "units" }, n: 1 },
      { name: "undo", props: undefined, n: 1 },
    ]);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(20_000);
    expect(sent).toEqual([
      { name: "edit", props: { layer: "terrain", part: "terrain", n: 2 } },
      { name: "edit", props: { layer: "units", part: "units" } },
      { name: "undo", props: undefined },
    ]);
    expect(waitingCounts()).toEqual([]);
  });

  it("keeps the counts until the site's script is there", () => {
    const hits = (window as unknown as { scmjsHits?: unknown }).scmjsHits;
    delete (window as unknown as { scmjsHits?: unknown }).scmjsHits;
    count("map.new", { tileset: "jungle" });
    flushCounts();
    expect(waitingCounts()).toHaveLength(1);
    (window as unknown as { scmjsHits?: unknown }).scmjsHits = hits;
    vi.advanceTimersByTime(20_000);
    expect(sent).toEqual([{ name: "map.new", props: { tileset: "jungle" } }]);
  });

  it("turned off, drops what was waiting, counts nothing and tells the site's script", () => {
    count("dialog", { id: "find" });
    setCounting(false);
    expect(stored.get(OFF_KEY)).toBe("off");
    count("dialog", { id: "find" });
    flushCounts();
    expect(sent).toEqual([]);
    expect(countingWanted()).toBe(false);
    setCounting(true);
    expect(stored.has(OFF_KEY)).toBe(false);
    expect(countingWanted()).toBe(true);
  });

  it("names only the project's own plugins", () => {
    expect(pluginCountName("github:scm-js/plugin-trigscript@v3.12.0")).toBe("plugin-trigscript");
    expect(pluginCountName("builtin:repair")).toBe("repair");
    expect(pluginCountName("github:someone/private-tool@main")).toBe("other");
    expect(pluginCountName("https://example.com/my/plugin.json")).toBe("other");
    expect(pluginCountName("github:friend/listed@v1", (s) => s.startsWith("github:friend/"))).toBe("friend/listed");
    countPluginUse({ source: "github:someone/private-tool" }, "menu", "Secret Thing");
    countPluginUse({ source: "github:scm-js/plugin-paint@v1.1.0" }, "menu", "Paint");
    expect(waitingCounts().map((c) => c.props)).toEqual([{ plugin: "other", via: "menu" }, { plugin: "plugin-paint", via: "menu", item: "Paint" }]);
  });

  it("says a file's kind, never its name", () => {
    expect(extOf("My Secret Map.SCX")).toBe("scx");
    expect(extOf("notes.docx")).toBe("other");
    expect(extOf(null)).toBe("none");
  });

  it("says which game data, in a word", () => {
    const base = { profile: DEFAULT_PROFILE, label: "", tried: [] };
    expect(gameDataOf(null)).toBe("unknown");
    expect(gameDataOf({ ...base, kind: "none" } as AssetSource)).toBe("none");
    expect(gameDataOf({ ...base, kind: "stored", stored: { from: "https://example.com/StarEdit.zip", at: "", files: 1, bytes: 1, summary: "", where: "opfs" } } as AssetSource)).toBe("download");
    expect(gameDataOf({ ...base, kind: "stored", stored: { from: "StarDat.mpq, BrooDat.mpq", at: "", files: 1, bytes: 1, summary: "", where: "opfs" } } as AssetSource)).toBe("classic");
  });

  it("names the preferences Apply changes, with the value only when it is on or off", () => {
    const after = {
      ...DEFAULT_PREFERENCES,
      multipleMaps: false,
      language: "ko" as const,
      save: { ...DEFAULT_PREFERENCES.save, backup: false },
      testMap: { ...DEFAULT_PREFERENCES.testMap, dir: "C:\\Users\\someone\\StarCraft" },
      hotkeys: { "file.save": ["Ctrl+Alt+S"] },
    };
    expect(changedPreferences(DEFAULT_PREFERENCES, after)).toEqual([
      { changed: "language" },
      { changed: "multipleMaps", to: false },
      { changed: "save.backup", to: false },
      { changed: "testMap.dir" },
      { changed: "hotkeys" },
    ]);
  });
});
