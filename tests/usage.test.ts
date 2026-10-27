import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { count, countError, countingWanted, countPluginUse, countReplays, errorKind, extOf, flushCounts, gameDataOf, noteModuleSource, OFF_KEY, pluginCountName, resetCountsForTests, setCounting, stackProps, waitingCounts } from "../src/services/usage";
import { logError, logRenderError, resetLogForTests } from "../src/editor/log";
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
    vi.advanceTimersByTime(120_000);
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
    vi.advanceTimersByTime(120_000);
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

  it("counts each replay once, however many ways it reached a plugin", () => {
    const rep = new File([new Uint8Array(10)], "My Game.rep", { lastModified: 1 });
    const other = new File([new Uint8Array(10)], "map.scx", { lastModified: 1 });
    countReplays([rep, other], "drop", 1_000);
    countReplays([rep], "open", 2_000);
    expect(waitingCounts()).toEqual([{ name: "replay.open", props: { where: "editor", via: "drop" }, n: 1 }]);
    // Opened again later: a second replay opened.
    countReplays([rep], "pick", 20_000);
    expect(waitingCounts().map((c) => [c.props, c.n])).toEqual([[{ where: "editor", via: "drop" }, 1], [{ where: "editor", via: "pick" }, 1]]);
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

describe("error counts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { origin: "https://scmjs.dev", hostname: "scmjs.dev" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    resetCountsForTests(true);
    resetLogForTests();
  });
  afterEach(() => {
    resetCountsForTests(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const chrome = [
    "TypeError: Cannot read properties of undefined (reading 'x') in My Secret Map.scx",
    "    at Ab (https://scmjs.dev/editor/assets/index-B1x2.js:1:48211)",
    "    at async run (blob:https://scmjs.dev/0f1e-22)",
    "    at lower (blob:https://scmjs.dev/0f1e-22:120:5)",
    "    at blob:https://scmjs.dev/aaaa-11:3:9",
    "    at chrome-extension://abc/inject.js:10:2",
    "    at chrome-extension://abc/inject.js:11:2",
    "    at Object.Cd [as run] (https://scmjs.dev/editor/assets/index-B1x2.js:1:9000)",
  ].join("\n");

  it("turns a stack into frames: the project's files with line and column, anything else in a word", () => {
    noteModuleSource("blob:https://scmjs.dev/0f1e-22", "https://raw.githubusercontent.com/scm-js/plugin-trigscript/v4.1.0/src/lower.ts");
    noteModuleSource("blob:https://scmjs.dev/aaaa-11", "https://raw.githubusercontent.com/someone/private-tool/main/plugin.js");
    expect(stackProps(chrome)).toEqual({
      frame0: "Ab editor/assets/index-B1x2.js:1:48211",
      frame1: "lower plugin-trigscript@v4.1.0/src/lower.ts:120:5",
      frame2: "plugin",
      frame3: "other",
      frame4: "editor/assets/index-B1x2.js:1:9000",
    });
  });

  it("reads Firefox and Safari stacks, and never the message", () => {
    const firefox = "draw@https://scmjs.dev/editor/assets/index-B1x2.js:1:300\n@https://scmjs.dev/editor/assets/index-B1x2.js:1:20\n";
    expect(stackProps(firefox)).toEqual({ frame0: "draw editor/assets/index-B1x2.js:1:300", frame1: "editor/assets/index-B1x2.js:1:20" });
    expect(stackProps("Error: at https://scmjs.dev/x.js:1:2 secret")).toBeNull();
  });

  it("keeps at most six frames, each short", () => {
    const long = Array.from({ length: 10 }, (_, i) => `    at f${i} (https://scmjs.dev/editor/assets/${"a".repeat(120)}.js:1:${i})`).join("\n");
    const props = stackProps(`Error\n${long}`)!;
    expect(Object.keys(props)).toEqual(["frame0", "frame1", "frame2", "frame3", "frame4", "frame5"]);
    for (const v of Object.values(props)) expect(String(v).length).toBeLessThanOrEqual(90);
  });

  it("names an error's kind only when it is an identifier", () => {
    expect(errorKind(new TypeError("x"))).toBe("TypeError");
    const odd = new Error("x");
    odd.name = "my map.scx";
    expect(errorKind(odd)).toBe("other");
    expect(errorKind("thrown text")).toBe("string");
  });

  it("counts a logged error with its area, the caller's words, its kind and its frames", () => {
    const err = new TypeError("in My Secret Map.scx");
    err.stack = chrome;
    logError("document", "Could not save the map", err, { file: "My Secret Map.scx" }, { step: "save" });
    const [line] = waitingCounts();
    expect(line.name).toBe("error");
    expect(line.props).toMatchObject({ area: "document", step: "save", type: "TypeError", frame0: "Ab editor/assets/index-B1x2.js:1:48211" });
    expect(JSON.stringify(line.props)).not.toContain("Secret");
  });

  // React's commit removing a node it no longer holds, from inside two of the editor's components.
  const commit = [
    "NotFoundError: Failed to execute 'removeChild' on 'Node'",
    ...["fl:98049", "_l:99568", "yl:101993", "_l:99693", "yl:99815"].map((f) => `    at ${f.split(":")[0]} (https://scmjs.dev/editor/assets/src-DM4OGw6D.js:8:${f.split(":")[1]})`),
  ].join("\n");
  const components = ["    at Pn (https://scmjs.dev/editor/assets/Panels-Ab12.js:1:500)", "    at Suspense", "    at Qx (https://scmjs.dev/editor/assets/src-DM4OGw6D.js:9:10)", "    at Rz (https://scmjs.dev/editor/assets/src-DM4OGw6D.js:9:20)", "    at St (https://scmjs.dev/editor/assets/src-DM4OGw6D.js:9:30)"].join("\n");

  it("gives a render error's components half the frames, marked `in`", () => {
    expect(stackProps(commit, components)).toEqual({
      frame0: "fl editor/assets/src-DM4OGw6D.js:8:98049",
      frame1: "_l editor/assets/src-DM4OGw6D.js:8:99568",
      frame2: "yl editor/assets/src-DM4OGw6D.js:8:101993",
      frame3: "in Pn editor/assets/Panels-Ab12.js:1:500",
      frame4: "in Qx editor/assets/src-DM4OGw6D.js:9:10",
      frame5: "in Rz editor/assets/src-DM4OGw6D.js:9:20",
    });
    // Firefox's component stack, and a long frame still fits.
    const long = `Xy@https://scmjs.dev/editor/assets/${"a".repeat(120)}.js:1:2`;
    const props = stackProps("", long)!;
    expect(String(props.frame0)).toMatch(/^in .*\.js:1:2$/);
    expect(String(props.frame0).length).toBeLessThanOrEqual(90);
  });

  it("counts a render error with the components it threw inside", () => {
    const err = new Error("Failed to execute 'removeChild' on 'Node'");
    err.name = "NotFoundError";
    err.stack = commit;
    logRenderError("Render failed", err, `\n${components}`, { surface: "editor" });
    const [line] = waitingCounts();
    expect(line.props).toMatchObject({ area: "app", type: "NotFoundError", frame0: "fl editor/assets/src-DM4OGw6D.js:8:98049", frame3: "in Pn editor/assets/Panels-Ab12.js:1:500" });
    expect(line.props).not.toHaveProperty("translated");
  });

  it("says when the browser was translating the page", () => {
    const page = (classes: string[], found: boolean) => vi.stubGlobal("document", {
      documentElement: { classList: { contains: (c: string) => classes.includes(c) } },
      querySelector: () => (found ? {} : null),
    });
    page(["translated-ltr"], false);
    countError({ area: "app" });
    page([], true);
    countError({ area: "document" });
    page([], false);
    countError({ area: "edit" });
    expect(waitingCounts().map((l) => l.props)).toEqual([{ area: "app", translated: true }, { area: "document", translated: true }, { area: "edit" }]);
  });

  it("stops sending frames past six waiting stacks, but still counts the error", () => {
    for (let i = 0; i < 8; i++) countError({ area: "app" }, `Error\n    at f (https://scmjs.dev/editor/assets/index.js:1:${i})`);
    countError({ area: "app" }, "Error\n    at f (https://scmjs.dev/editor/assets/index.js:1:0)");
    const lines = waitingCounts();
    expect(lines.filter((l) => l.props && "frame0" in l.props)).toHaveLength(6);
    expect(lines[0].n).toBe(2);
    expect(lines.find((l) => l.props && !("frame0" in l.props))).toEqual({ name: "error", props: { area: "app" }, n: 2 });
  });
});
