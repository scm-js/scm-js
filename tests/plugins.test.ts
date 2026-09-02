import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { serializeScenario } from "../src/formats/chk/scenario";
import { flatTerrain } from "../src/formats/tileset/terrain";
import { loadTileset } from "../src/formats/tileset/decode";
import { primeTileset, type LoadedTileset } from "../src/formats/tileset/load";
import { NO_DOODADS } from "../src/formats/tileset/doodads";
import { hasIsom } from "../src/editor/isom";
import { scenarioAtom, redoAtom, undoAtom, undoStackAtom } from "../src/atoms/documentAtoms";
import { scenarioName } from "../src/formats/chk/scenario";
import { ActionType, ConditionType } from "../src/formats/chk/sections/triggers";
import { START_LOCATION } from "../src/data/units";
import {
  activeUnitAtom, centerViewOnAtom, clipSelectionAtom, mapModifiedAtom, mapNameAtom, mapTilesetAtom, terrainModeAtom, unitOwnerAtom,
} from "../src/atoms/editorAtoms";
import { preferencesAtom } from "../src/atoms/preferencesAtoms";
import type { PendingAction } from "../src/hooks/useMapFileActions";
import { closeDialogAtom, dialogStackAtom } from "../src/atoms/uiAtoms";
import {
  cancelMapPickAtom, cancelMapToolAtom, installedPluginsAtom, mapPickAtom, mapToolAtom, mapToolRevisionAtom, normalizeCombo, pluginCodeAtom,
  pluginCommandsAtom, pluginContextItemsAtom, pluginHotkeysAtom, pluginManifestCacheAtom, pluginMenuItemsAtom, pluginPanelsAtom, pluginRuntimesAtom,
} from "../src/atoms/pluginAtoms";
import { looksLikeImageUrl, transferOf } from "../src/plugins/images";
import {
  addressesOf, blankLiterals, bundleModule, candidateUrls, canonicalSpec, findImports, isPinned, loadPlugin, parseSpec, PluginLoadError, previewPlugin, resolveIcon,
  resolvePlugin, unpin, validateManifest, type LoaderDeps,
} from "../src/plugins/loader";
import { transpileTs } from "../src/plugins/transpile";
import {
  activatePlugin, Contributions, createPluginApi, deactivatePlugin, describePlugin, effectiveInstalls, forgetDescription, installPlugin, isPluginActive,
  reloadPlugin, resolveActivate, runTransaction, setInstalled,
} from "../src/plugins/host";
import { pluginContextRows } from "../src/plugins/contextMenu";
import { DEFAULT_REMOTE_PLUGINS, defaultPlugins, defaultPluginSpecs } from "../src/plugins/defaults";
import { withPluginItems, type Menu } from "../src/components/chrome/MenuBar";
import { pluginIdOf, type MapToolStopReason, type PluginApi } from "../src/plugins/api";

/* ── Specs and manifests ────────────────────────────────── */

describe("plugin specs", () => {
  it("parse the built-in, github and URL forms", () => {
    expect(parseSpec("builtin:terrain-from-image")).toEqual({ kind: "builtin", name: "terrain-from-image" });
    expect(parseSpec("github:jeany55/scm-plugin")).toMatchObject({ kind: "remote", manifestUrl: "https://raw.githubusercontent.com/jeany55/scm-plugin/HEAD/plugin.json", base: "https://raw.githubusercontent.com/jeany55/scm-plugin/HEAD/" });
    expect(parseSpec("github:jeany55/scm-plugin@v1.2/plugins/hello")).toMatchObject({ manifestUrl: "https://raw.githubusercontent.com/jeany55/scm-plugin/v1.2/plugins/hello/plugin.json", display: "github:jeany55/scm-plugin@v1.2/plugins/hello" });
    expect(parseSpec("https://github.com/jeany55/scm-plugin")).toMatchObject({ manifestUrl: "https://raw.githubusercontent.com/jeany55/scm-plugin/HEAD/plugin.json" });
    expect(parseSpec("https://github.com/jeany55/scm-plugin/tree/main/hello/")).toMatchObject({ manifestUrl: "https://raw.githubusercontent.com/jeany55/scm-plugin/main/hello/plugin.json" });
    expect(parseSpec("https://example.com/p/plugin.json")).toMatchObject({ manifestUrl: "https://example.com/p/plugin.json", entryUrl: null, base: "https://example.com/p/" });
    expect(parseSpec("https://example.com/p/main.ts")).toMatchObject({ manifestUrl: null, entryUrl: "https://example.com/p/main.ts" });
    expect(parseSpec("http://localhost:3000")).toMatchObject({ manifestUrl: "http://localhost:3000/plugin.json", base: "http://localhost:3000/" });
    expect(() => parseSpec("hello")).toThrow(PluginLoadError);
    expect(() => parseSpec("")).toThrow(PluginLoadError);
  });

  it("validate manifests", () => {
    expect(validateManifest({ name: " Hello ", version: "1.0", api: 1, entry: "main.ts", icon: "icon.png", extra: 1 }, "m")).toEqual({ name: "Hello", version: "1.0", api: 1, entry: "main.ts", icon: "icon.png" });
    expect(() => validateManifest({}, "m")).toThrow(/needs a "name"/);
    expect(() => validateManifest({ name: "x", entry: "https://elsewhere/x.js" }, "m")).toThrow(/relative/);
    expect(pluginIdOf({ name: "Terrain from Image!" })).toBe("terrain-from-image");
    expect(pluginIdOf({ id: "My_Id", name: "x" })).toBe("my-id");
  });

  it("resolve a manifest icon, and refuse anything that is not one", () => {
    expect(resolveIcon("icon.svg", "https://x/a/plugin.json")).toEqual({ kind: "image", url: "https://x/a/icon.svg" });
    expect(resolveIcon("art/mark.png", "https://x/a/plugin.json")).toEqual({ kind: "image", url: "https://x/a/art/mark.png" });
    expect(resolveIcon("https://cdn/x.png", null)).toEqual({ kind: "image", url: "https://cdn/x.png" });
    expect(resolveIcon("data:image/svg+xml,<svg/>", null)).toEqual({ kind: "image", url: "data:image/svg+xml,<svg/>" });
    expect(resolveIcon(" \u{1f5fa}\u{fe0f} ", null)).toEqual({ kind: "text", text: "\u{1f5fa}\u{fe0f}" });
    expect(resolveIcon("icon.svg", null)).toBeNull();               // a built-in's file comes through iconUrl
    expect(resolveIcon("javascript:alert(1)", "https://x/a/")).toBeNull();
    expect(resolveIcon("data:text/html,<b>", null)).toBeNull();
    expect(resolveIcon("a whole sentence, not a glyph", null)).toBeNull();
    expect(resolveIcon(undefined, "https://x/a/")).toBeNull();
  });

  it("carries the icon through resolve and load", async () => {
    const files: Record<string, string> = {
      "https://x/a/plugin.json": JSON.stringify({ name: "A", entry: "main.ts", icon: "art/icon.png" }),
    };
    const fetchText = async (url: string) => { if (url in files) return files[url]; throw new Error("404"); };
    const builtins = {
      withFile: { manifest: { name: "F", icon: "icon.svg" }, iconUrl: "/assets/icon-abc123.svg", load: async () => ({}) },
      withGlyph: { manifest: { name: "G", icon: "\u{1f5fa}\u{fe0f}" }, load: async () => ({}) },
      bare: { manifest: { name: "B" }, load: async () => ({}) },
    };
    expect((await resolvePlugin(parseSpec("https://x/a/"), { fetchText, builtins: {} })).icon).toEqual({ kind: "image", url: "https://x/a/art/icon.png" });
    expect((await resolvePlugin(parseSpec("builtin:withFile"), { fetchText, builtins })).icon).toEqual({ kind: "image", url: "/assets/icon-abc123.svg" });
    expect((await resolvePlugin(parseSpec("builtin:withGlyph"), { fetchText, builtins })).icon).toEqual({ kind: "text", text: "\u{1f5fa}\u{fe0f}" });
    expect((await resolvePlugin(parseSpec("builtin:bare"), { fetchText, builtins })).icon).toBeUndefined();
  });

  it("resolve the entry from the manifest, or a default that exists", async () => {
    const files: Record<string, string> = {
      "https://x/a/plugin.json": JSON.stringify({ name: "A", entry: "src/main.ts" }),
      "https://x/b/plugin.json": JSON.stringify({ name: "B" }),
      "https://x/b/plugin.js": "export default () => {}",
    };
    const fetchText = async (url: string) => { if (url in files) return files[url]; throw new Error("404"); };
    expect(await resolvePlugin(parseSpec("https://x/a/"), { fetchText, builtins: {} })).toEqual({ manifest: { name: "A", entry: "src/main.ts" }, entryUrl: "https://x/a/src/main.ts" });
    expect(await resolvePlugin(parseSpec("https://x/b/"), { fetchText, builtins: {} })).toEqual({ manifest: { name: "B", entry: "plugin.js" }, entryUrl: "https://x/b/plugin.js" });
    expect(await resolvePlugin(parseSpec("https://x/c/main.ts"), { fetchText, builtins: {} })).toEqual({ manifest: { name: "main", entry: "main.ts" }, entryUrl: "https://x/c/main.ts" });
    await expect(resolvePlugin(parseSpec("https://x/none/"), { fetchText, builtins: {} })).rejects.toThrow(/Could not fetch/);
    await expect(resolvePlugin(parseSpec("builtin:nope"), { fetchText, builtins: {} })).rejects.toThrow(/No built-in/);
  });
});

/* ── Bundling ───────────────────────────────────────────── */

describe("plugin bundling", () => {
  it("finds static and dynamic import specifiers", () => {
    const code = `import a from "./a.js";\nimport { b } from './b.js'\nexport * from "./c.js";\nimport "./side.js";\nconst d = await import("./d.js");\nconst s = "not from 'x'";`;
    expect(findImports(code).map((i) => i.specifier)).toEqual(["./a.js", "./b.js", "./c.js", "./side.js", "./d.js"]);
    for (const ref of findImports(code)) expect(code.slice(ref.start, ref.end)).toBe(ref.specifier);
  });

  const transpile = async (source: string, fileName: string) => transpileTs(ts, source, fileName);

  function memoryDeps(files: Record<string, string>) {
    const modules = new Map<string, string>();
    let n = 0;
    const deps: Pick<LoaderDeps, "fetchText" | "transpile" | "createModuleUrl"> = {
      fetchText: async (url) => { if (url in files) return files[url]; throw new Error("404"); },
      transpile,
      createModuleUrl: (code) => { const url = `mem:${++n}`; modules.set(url, code); return url; },
    };
    return { deps, modules };
  }

  it("ignores the word import inside strings, templates, regexes and comments", () => {
    const src = [
      `// import "commented-out"`,
      `/* import x from "also-commented" */`,
      `import { a } from "./a";`,
      `const route = "/scmscx/import";`,
      `const t = \`import "\${route}"\`;`,
      `const re = /["']import"/g; const half = 6 / 2;`,
      `const s = 'it\\'s import "quoted"';`,
      `export * from "./b";`,
      `const m = await import("./c");`,
    ].join("\n");
    expect(findImports(src).map((i) => i.specifier)).toEqual(["./a", "./b", "./c"]);
    expect(blankLiterals(src)).toHaveLength(src.length);
    expect(blankLiterals(`a("x")\nimport "./y"`)).toBe(`a(" ")\nimport "   "`);
  });

  it("transpiles TypeScript, follows relative imports and rewrites them to module URLs", async () => {
    const { deps, modules } = memoryDeps({
      "https://x/p/plugin.ts": `import type { PluginApi } from "scm-js/plugin-api";\nimport { greet } from "./lib/greet.ts";\nexport default function activate(api: PluginApi): void { greet(api); }`,
      "https://x/p/lib/greet.ts": `export const greet = (api: { log(...a: unknown[]): void }): void => api.log("hi");`,
    });
    const entry = await bundleModule("https://x/p/plugin.ts", deps);
    const code = modules.get(entry)!;
    expect(code).not.toContain("scm-js/plugin-api"); // the type import is erased
    expect(code).toMatch(/from "mem:\d+"/);
    expect(code).not.toContain("./lib/greet.ts");
    expect(modules.size).toBe(2);
  });

  it("fetches a shared module once", async () => {
    const { deps, modules } = memoryDeps({
      "https://x/a.js": `import "./b.js"; import "./c.js";`,
      "https://x/b.js": `import "./c.js";`,
      "https://x/c.js": `export const c = 1;`,
    });
    await bundleModule("https://x/a.js", deps);
    expect(modules.size).toBe(3);
  });

  it("resolves an import that names no extension", async () => {
    // `import { greet } from "./greet"` is how TypeScript is normally written, and there
    // is no resolver behind a fetch — this is what the bundled built-in never exercised.
    const { deps, modules } = memoryDeps({
      "https://x/p/plugin.ts": `import { greet } from "./greet";\nimport { v } from "./lib";\nexport default () => greet(v);`,
      "https://x/p/greet.ts": `export const greet = (n: number): number => n;`,
      "https://x/p/lib/index.ts": `export const v = 1;`,
    });
    await bundleModule("https://x/p/plugin.ts", deps);
    expect(modules.size).toBe(3);
    expect(candidateUrls("./greet", "https://x/p/plugin.ts").slice(0, 2))
      .toEqual(["https://x/p/greet.ts", "https://x/p/greet.tsx"]);
    // A TypeScript project that writes `./greet.js` means `./greet.ts`.
    expect(candidateUrls("./greet.js", "https://x/p/plugin.ts"))
      .toEqual(["https://x/p/greet.js", "https://x/p/greet.ts", "https://x/p/greet.tsx"]);
    const missing = memoryDeps({ "https://x/p/plugin.ts": `import "./nope";` });
    await expect(bundleModule("https://x/p/plugin.ts", missing.deps)).rejects.toThrow(/any of .*nope\.ts.*nope\/index\.mjs/s);
  });

  it("refuses bare package imports and circular imports with the file named", async () => {
    const bare = memoryDeps({ "https://x/a.js": `import React from "react";` });
    await expect(bundleModule("https://x/a.js", bare.deps)).rejects.toThrow(/a\.js imports "react"/);
    const cyc = memoryDeps({ "https://x/a.js": `import "./b.js";`, "https://x/b.js": `import "./a.js";` });
    await expect(bundleModule("https://x/a.js", cyc.deps)).rejects.toThrow(/Circular import/);
  });

  it("reports a TypeScript syntax error with the file and line", async () => {
    await expect(transpile("const x: number = ;", "https://x/bad.ts")).rejects.toThrow(/bad\.ts:1/);
  });

  it("loads a built-in through the same path", async () => {
    let activated = 0;
    const deps: LoaderDeps = {
      fetchText: async () => { throw new Error("no network"); },
      transpile,
      createModuleUrl: () => "mem:0",
      importModule: async () => ({}),
      builtins: { hello: { manifest: { name: "Hello" }, load: async () => ({ default: () => { activated++; } }) } },
    };
    const loaded = await loadPlugin("builtin:hello", deps);
    expect(loaded.manifest.name).toBe("Hello");
    resolveActivate(loaded.module)(null as unknown as PluginApi);
    expect(activated).toBe(1);
    expect(() => resolveActivate({})).toThrow(/activate/);
    expect(typeof resolveActivate({ activate: () => {} })).toBe("function");
    expect(typeof resolveActivate({ default: { activate: () => {} } })).toBe("function");
  });
});

/* ── The host ───────────────────────────────────────────── */

function blankStore(width = 8, height = 6) {
  const store = createStore();
  const scn = createScenario({ width, height, era: 0, name: "p" });
  store.set(scenarioAtom, scn);
  return { store, scn };
}

const zero = { menu: 0, contextMenu: 0, hotkeys: 0, events: 0 };

describe("plugin api", () => {
  it("registers menu, context-menu and hotkey contributions and takes them back on dispose", () => {
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "builtin:t" }, bag);
    api.menu.add("File/Import", { label: "Do It…", run: () => {} });
    const item = api.contextMenu.add("viewport", { label: "Here", run: () => {} });
    api.hotkeys.add("shift+ctrl+i", () => {});
    expect(store.get(pluginMenuItemsAtom)).toMatchObject([{ pluginId: "t", path: "File/Import", label: "Do It…" }]);
    expect(store.get(pluginContextItemsAtom)).toMatchObject([{ pluginId: "t", surface: "viewport" }]);
    expect(store.get(pluginHotkeysAtom)).toMatchObject([{ combo: "Ctrl+Shift+I" }]);
    expect(bag.counts).toEqual({ menu: 1, contextMenu: 1, hotkeys: 1, events: 0 });
    item.dispose();
    expect(store.get(pluginContextItemsAtom)).toEqual([]);
    bag.dispose();
    expect(store.get(pluginMenuItemsAtom)).toEqual([]);
    expect(store.get(pluginHotkeysAtom)).toEqual([]);
    expect(normalizeCombo("Meta+alt+F9")).toBe("Alt+Meta+F9");
  });

  it("reads the document and the selection, and fires events", () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.document.isOpen()).toBe(true);
    expect(api.document.info()).toMatchObject({ name: "p", width: 8, height: 6, tileset: "badlands", version: 205 });
    expect(api.tileset.id()).toBe("badlands");
    expect(api.terrain.types()).toEqual([]); // no graphics in Node
    let terrainEvents = 0, selectionEvents = 0;
    api.events.on("terrain", () => terrainEvents++);
    api.events.on("selection", () => selectionEvents++);
    api.selection.markArea({ x0: 1, y0: 1, x1: 3, y1: 3 });
    expect(api.selection.markedArea()).toEqual({ x0: 1, y0: 1, x1: 3, y1: 3 });
    expect(selectionEvents).toBe(1);
    api.document.edit("tile", (tx) => { tx.setTile(0, 0, 0x123); });
    expect(terrainEvents).toBe(1);
    api.terrain.setActive({ mode: "tile", tile: 0x55 });
    expect(store.get(terrainModeAtom)).toBe("tile");
    expect(api.terrain.active().tile).toBe(0x55);
    expect(() => api.events.on("nope" as never, () => {})).toThrow(/Unknown plugin event/);
  });

  it("opens a dialog through the dialog stack and closes it from the handle", () => {
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    const handle = api.ui.dialog({ title: "Hi", mount: () => {} });
    expect(store.get(dialogStackAtom)).toMatchObject([{ id: "pluginDialog" }]);
    expect(handle.isOpen()).toBe(true);
    handle.close();
    expect(store.get(dialogStackAtom)).toEqual([]);
    expect(handle.isOpen()).toBe(false);
    api.ui.dialog({ title: "Again", mount: () => {} });
    bag.dispose(); // deactivation closes what the plugin left open
    expect(store.get(dialogStackAtom)).toEqual([]);
  });

  it("exports the map as a file, keeps archive extras, and opens a file in its place", async () => {
    const { store, scn } = blankStore();
    store.set(preferencesAtom, { ...store.get(preferencesAtom), confirmClose: false });
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.document.extras.list()).toEqual([]);
    api.document.extras.set("scm-server\\map.json", new TextEncoder().encode(`{"mapId":"m_1"}`));
    expect(api.document.extras.list()).toEqual(["scm-server\\map.json"]);
    expect(new TextDecoder().decode(api.document.extras.get("scm-server\\map.json")!)).toBe(`{"mapId":"m_1"}`);
    expect(store.get(mapModifiedAtom)).toBe(true);

    const file = await api.document.export();
    expect(file).toBeInstanceOf(File);
    expect(file!.name).toBe("p.scx");
    const chk = await api.document.export({ format: "chk", fileName: "raw.chk" });
    expect(chk!.name).toBe("raw.chk");
    expect(chk!.size).toBeLessThan(file!.size);

    // Open the export in place of the map: the extras come back with it, the scenario is a new object.
    store.set(mapModifiedAtom, false);
    api.document.edit("tile", (tx) => { tx.setTile(0, 0, 0x321); });
    expect(await api.document.open(file!)).toBe(true);
    expect(store.get(scenarioAtom)).not.toBe(scn);
    expect(api.document.info()).toMatchObject({ name: "p", fileName: "p.scx", modified: false });
    expect(api.document.extras.list()).toEqual(["scm-server\\map.json"]);
    expect(api.document.extras.remove("scm-server\\map.json")).toBe(true);
    expect(api.document.extras.remove("scm-server\\map.json")).toBe(false);

    // Bytes with a name, and something that is not a map.
    expect(await api.document.open(new Uint8Array(await chk!.arrayBuffer()), "again.chk")).toBe(true);
    expect(api.document.info()!.fileName).toBe("again.chk");
  });

  it("asks before replacing a modified map, and answers false when the user keeps it", async () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const file = (await api.document.export())!;
    store.set(preferencesAtom, { ...store.get(preferencesAtom), confirmClose: true });
    api.document.edit("tile", (tx) => { tx.setTile(0, 0, 0x321); });
    expect(store.get(mapModifiedAtom)).toBe(true);
    const opening = api.document.open(file);
    const entry = store.get(dialogStackAtom).find((d) => d.id === "confirmClose");
    expect(entry).toBeDefined();
    const pending = entry!.payload!.pending as PendingAction & { action: "open" };
    expect(pending.file).toBe(file);
    store.set(closeDialogAtom, entry!.key); // Cancel / Escape / the ×: the entry leaves the stack untaken
    expect(await opening).toBe(false);
    expect(store.get(mapModifiedAtom)).toBe(true);
    // Going on: the dialog marks the action taken before it closes, and `done` carries the result.
    const again = api.document.open(file);
    const entry2 = store.get(dialogStackAtom).find((d) => d.id === "confirmClose")!;
    const pending2 = entry2.payload!.pending as PendingAction & { action: "open" };
    pending2.taken = true;
    store.set(closeDialogAtom, entry2.key);
    pending2.done!(true);
    expect(await again).toBe(true);
    // Renders nothing without a browser canvas, rather than throwing.
    expect(await api.document.renderImage({ pixelsPerTile: 1 })).toBeNull();
  });

  it("keeps per-plugin storage without localStorage", () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.storage.get("k", 7)).toBe(7);
    api.storage.set("k", { a: 1 });
    expect(api.storage.get("k", null)).toEqual({ a: 1 });
    api.storage.remove("k");
    expect(api.storage.get("k", 7)).toBe(7);
  });

  it("answers with nothing when no map is open", () => {
    const store = createStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.document.isOpen()).toBe(false);
    expect(api.document.info()).toBeNull();
    expect(api.terrain.diamondsIn({ x0: 0, y0: 0, x1: 4, y1: 4 })).toEqual([]);
    expect(api.document.edit("x", (tx) => tx.setTile(0, 0, 1))).toMatchObject({ changed: false, notes: ["no map is open"] });
  });
});

describe("plugin transactions", () => {
  it("apply as they build and undo as one entry", () => {
    const { store, scn } = blankStore();
    const before = new Uint16Array(scn.tiles);
    const result = runTransaction(store, "mixed", (tx) => {
      tx.setTiles({ x0: 0, y0: 0, x1: 2, y1: 2 }, 0x21);
      expect(tx.tileAt(1, 1)).toBe(0x21); // later operations see earlier ones
      tx.setTile(1, 1, 0x22);
      const [i] = tx.addUnits([tx.makeUnit(0, 0, 48, 48)]);
      expect(i).toBe(0);
      expect(tx.addLocation({ left: 0, top: 0, right: 64, bottom: 64 }, "Base")).toBe(0);
      expect(tx.setFog({ x0: 0, y0: 0, x1: 8, y1: 6 }, 0x01, "clear")).toBe(48);
      tx.note("done");
    });
    expect(result).toMatchObject({ changed: true, tiles: 4, units: 1, locations: 1, fog: 48, notes: ["done"] });
    expect(scn.tiles[9]).toBe(0x22);
    expect(scn.editorTiles[9]).toBe(0x22);
    expect(scn.units).toHaveLength(1);
    expect(scn.mask![0]).toBe(0xfe); // a new map carries a MASK, so no createdMask here
    expect(store.get(undoStackAtom)).toHaveLength(1);
    expect(store.get(undoStackAtom)[0].label).toBe("mixed");
    expect(scn.dirty.has("MTXM") && scn.dirty.has("UNIT") && scn.dirty.has("MRGN") && scn.dirty.has("MASK")).toBe(true);

    store.set(undoAtom);
    expect(scn.tiles).toEqual(before);
    expect(scn.units).toHaveLength(0);
    expect(scn.mask![0]).toBe(0xff);
    store.set(redoAtom);
    expect(scn.tiles[9]).toBe(0x22);
    expect(scn.units).toHaveLength(1);
  });

  it("creates MASK on the first fog edit of a map without one and drops it on undo", () => {
    const { store, scn } = blankStore();
    scn.mask = null;
    const result = runTransaction(store, "fog", (tx) => { tx.setFog([0, 1], 0x03, "clear"); });
    expect(result.fog).toBe(2);
    expect(scn.mask![0]).toBe(0xfc);
    store.set(undoAtom);
    expect(scn.mask).toBeNull();
    store.set(redoAtom);
    expect(scn.mask![1]).toBe(0xfc);
  });

  it("records nothing for a transaction that changed nothing", () => {
    const { store, scn } = blankStore();
    const result = runTransaction(store, "noop", (tx) => { tx.setTile(0, 0, scn.tiles[0]); tx.removeUnits([5]); });
    expect(result.changed).toBe(false);
    expect(store.get(undoStackAtom)).toHaveLength(0);
  });

  it("refuses terrain painting without the graphics, with a note", () => {
    const { store } = blankStore();
    const result = runTransaction(store, "paint", (tx) => { expect(tx.stampTerrain({ x0: 0, y0: 0, x1: 2, y1: 2 }, 2)).toBe(0); });
    expect(result.changed).toBe(false);
    expect(result.notes[0]).toMatch(/tileset graphics/);
  });
});

/* ── Lifecycle ──────────────────────────────────────────── */

function fakeDeps(builtins: LoaderDeps["builtins"]): LoaderDeps {
  return { fetchText: async () => { throw new Error("offline"); }, transpile: async (s) => s, createModuleUrl: () => "mem:0", importModule: async () => ({}), builtins };
}

/* ── Update transactions, triggers, query, view, commands ─ */

describe("plugin updates", () => {
  const apiOf = (store: ReturnType<typeof createStore>) => createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());

  it("applies triggers, strings, switches and properties as one transaction", () => {
    const { store, scn } = blankStore();
    const api = apiOf(store);
    let events = 0;
    api.events.on("triggers", () => { events++; });

    const result = api.document.update("wave", (tx) => {
      const text = tx.strings.intern("Wave incoming");
      expect(text).toBeGreaterThan(0);
      expect(tx.strings.list()[text]).toBe("Wave incoming");
      const trigger = api.triggers.newTrigger();
      trigger.conditions[0] = api.triggers.newCondition(ConditionType.Always);
      const action = api.triggers.newAction(ActionType.DisplayText);
      action.text = text;
      trigger.actions[0] = action;
      expect(tx.triggers.add(trigger)).toBe(0);
      expect(tx.triggers.count()).toBe(1);
      tx.switches.setName(0, "armed");
      tx.properties({ name: "Renamed" });
    });

    expect(result.changed).toBe(true);
    expect(result.sections.sort()).toEqual(["SPRP", "STR ", "SWNM", "TRIG"]);
    expect(scn.triggers).toHaveLength(1);
    expect(api.triggers.switchNames()[0]).toBe("armed");
    expect(scenarioName(scn)).toBe("Renamed");
    expect(store.get(mapNameAtom)).toBe("Renamed");
    expect(store.get(mapModifiedAtom)).toBe(true);
    expect(events).toBe(1);
    expect(scn.dirty.has("TRIG")).toBe(true);
  });

  it("reports no change when every operation is a no-op, and refuses without a map", () => {
    const { store } = blankStore();
    const api = apiOf(store);
    expect(api.document.update("nothing", (tx) => { tx.properties({ name: "p" }); tx.note("nothing to do"); }))
      .toEqual({ changed: false, sections: [], notes: ["nothing to do"] });
    expect(store.get(mapModifiedAtom)).toBe(false);
    const empty = createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions());
    expect(empty.document.update("x", () => {})).toEqual({ changed: false, sections: [], notes: ["no map is open"] });
  });

  it("edits the list: replace, move, remove and text", () => {
    const { store, scn } = blankStore();
    const api = apiOf(store);
    api.document.update("three", (tx) => {
      for (let i = 0; i < 3; i++) {
        const t = api.triggers.newTrigger();
        t.conditions[0] = api.triggers.newCondition(ConditionType.Always);
        const a = api.triggers.newAction(ActionType.Comment);
        a.text = tx.strings.intern(`number ${i}`);
        t.actions[0] = a;
        tx.triggers.add(t);
      }
    });
    expect(api.triggers.list()).toHaveLength(3);
    expect(api.triggers.comment(api.triggers.list()[1])).toBe("number 1");

    api.document.update("shuffle", (tx) => {
      expect(tx.triggers.move(2, 0)).toBe(true);
      expect(tx.triggers.move(9, 0)).toBe(false);
      expect(tx.triggers.remove([1])).toBe(1);
      expect(tx.triggers.replace(0, api.triggers.setPreserved(tx.triggers.list()[0], true))).toBe(true);
      expect(tx.triggers.replace(9, api.triggers.newTrigger())).toBe(false);
    });
    const list = api.triggers.list();
    expect(list).toHaveLength(2);
    expect(api.triggers.comment(list[0])).toBe("number 2");
    expect(api.triggers.isPreserved(list[0])).toBe(true);

    // Print and parse: the text format is the same one File ▸ Export ▸ Triggers writes.
    const text = api.triggers.text.print(list);
    expect(text).toContain("Comment(\"number 2\")");
    const back = api.document.update("import", (tx) => { expect(tx.triggers.fromText(text, { replace: true })).toBe(2); });
    expect(back.changed).toBe(false); // the same two triggers: nothing to mark dirty
    api.document.update("append", (tx) => { tx.triggers.fromText(text); });
    expect(api.triggers.list()).toHaveLength(4);
    expect(() => api.document.update("bad", (tx) => { tx.triggers.fromText("Trigger("); })).toThrow();
    expect(scn.briefing).toHaveLength(0);
  });

  it("keeps string 0 and overwrites a slot in place", () => {
    const { store, scn } = blankStore();
    const api = apiOf(store);
    let index = 0;
    api.document.update("strings", (tx) => { index = tx.strings.intern("first"); });
    const result = api.document.update("strings", (tx) => {
      tx.strings.set(0, "nope");
      tx.strings.set(index, "second");
      tx.strings.set(index, "second"); // already that text: no change
    });
    expect(result.notes).toEqual(["string 0 is reserved; use intern to add one"]);
    expect(scn.strings.strings[index]).toBe("second");
    expect(api.query.stringUsage().size).toBeGreaterThan(0);
  });
});

describe("plugin triggers", () => {
  const apiOf = (store: ReturnType<typeof createStore>) => createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());

  it("exposes the definition tables the editor's own dialogs read", () => {
    const { store } = blankStore();
    const api = apiOf(store);
    expect(api.triggers.defs.condition(ConditionType.Bring)?.name).toBe("Bring");
    expect(api.triggers.defs.condition(ConditionType.Bring)?.args.map((a) => a.field)).toContain("location");
    expect(api.triggers.defs.action(ActionType.DisplayText)?.name).toBe("Display Text Message");
    expect(api.triggers.defs.actions(true).length).toBeGreaterThan(0);
    expect(api.triggers.defs.conditions().length).toBeGreaterThan(20);
    expect(api.triggers.defs.choiceLabel("comparison", 0)).toBe("At least");
    expect(api.triggers.defs.choiceValue("comparison", "At least")).toBe(0);
    expect(api.triggers.defs.choices("comparison").length).toBeGreaterThan(1);
    // Names resolve against the open map.
    expect(api.triggers.names().unit(0)).toBe("Terran Marine");
    expect(api.triggers.switchUsage()).toHaveLength(256);
    const summary = api.triggers.summarize(api.triggers.newTrigger());
    expect(summary.players).toContain("All Players");
  });

  it("answers empty without a map", () => {
    const api = createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.triggers.list()).toEqual([]);
    expect(api.triggers.briefing()).toEqual([]);
    expect(api.triggers.switchNames()).toEqual([]);
    expect(() => api.triggers.names()).toThrow(/No map/);
  });
});

describe("plugin query", () => {
  const apiOf = (store: ReturnType<typeof createStore>) => createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());

  it("finds what is where and runs the editor's analyses", () => {
    const { store, scn } = blankStore(16, 16);
    const api = apiOf(store);
    api.document.edit("place", (tx) => {
      tx.addUnits([tx.makeUnit(0, 0, 48, 48), tx.makeUnit(START_LOCATION, 1, 240, 80)]);
      tx.addLocation({ left: 32, top: 32, right: 96, bottom: 96 }, "Base");
    });
    expect(api.query.unitAt(48, 48)).toBe(0);
    expect(api.query.unitAt(400, 400)).toBe(-1);
    expect(api.query.unitsIn({ x0: 0, y0: 0, x1: 4, y1: 4 })).toEqual([0]);
    expect(api.query.unitsOf(1)).toEqual([1]);
    expect(api.query.startLocations()).toEqual([{ index: 1, owner: 1, x: 240, y: 80, tx: 7, ty: 2 }]);
    expect(api.query.locationAt(64, 64)).toBe(0);
    expect(api.query.locationsIn({ x0: 0, y0: 0, x1: 8, y1: 8 })).toEqual([0]);
    expect(api.query.locationsIn({ x0: 0, y0: 0, x1: 2, y1: 2 })).toEqual([]);
    expect(api.query.doodadAt(0, 0)).toBe(-1);
    expect(api.query.spriteAt(48, 48)).toBe(-1);
    expect(api.query.find({ kind: "locations", query: "base" })).toMatchObject([{ kind: "locations", index: 0 }]);
    expect(api.query.statistics()?.units.total).toBe(2);
    expect(api.query.validate().every((i) => typeof i.text === "string")).toBe(true);
    expect(api.query.placement(0, 48, 48).problem).toBe("collision");
    expect(api.query.unusedStrings()).toBeInstanceOf(Array);
    expect(scn.locations[0].nameIndex).toBeGreaterThan(0);
  });

  it("answers empty without a map", () => {
    const api = createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.query.unitAt(0, 0)).toBe(-1);
    expect(api.query.unitsIn({ x0: 0, y0: 0, x1: 4, y1: 4 })).toEqual([]);
    expect(api.query.statistics()).toBeNull();
    expect(api.query.validate()).toEqual([]);
    expect(api.query.find({ kind: "units", query: "x" })).toEqual([]);
    expect(api.query.stringUsage().size).toBe(0);
  });
});

describe("plugin view", () => {
  it("scrolls, zooms and goes to an object", () => {
    const { store } = blankStore(32, 32);
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    api.document.edit("place", (tx) => {
      tx.addUnits([tx.makeUnit(0, 0, 320, 160)]);
      tx.addLocation({ left: 0, top: 0, right: 64, bottom: 64 }, "Base");
    });
    let events = 0;
    api.events.on("view", () => { events++; });

    api.view.setZoom(99);
    expect(api.view.zoom()).toBe(8);
    api.view.setZoom(0.5);
    expect(api.view.zoom()).toBe(0.5);
    api.view.center(4, 5);
    expect(store.get(centerViewOnAtom)).toEqual({ x: 4, y: 5 });
    api.view.goTo({ kind: "unit", index: 0 });
    expect(store.get(centerViewOnAtom)).toEqual({ x: 10, y: 5 });
    expect(api.selection.units()).toEqual([0]);
    api.view.goTo({ kind: "location", index: 0 });
    expect(store.get(centerViewOnAtom)).toEqual({ x: 1, y: 1 });
    expect(api.selection.locations()).toEqual([0]);
    api.view.goTo({ kind: "unit", index: 9 }); // no such unit: nothing moves
    expect(store.get(centerViewOnAtom)).toEqual({ x: 1, y: 1 });
    api.view.setFlags({ grid: true });
    expect(api.view.flags().grid).toBe(true);
    api.view.setGridSize(64);
    expect(api.view.gridSize()).toBe(64);
    expect(api.view.visible()).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(api.view.cursorTile()).toEqual({ x: 0, y: 0 });
    expect(events).toBeGreaterThan(0);
  });
});

describe("plugin commands", () => {
  it("registers commands that menu items, hotkeys and other plugins can run", () => {
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "paint", name: "Paint", source: "s" }, bag);
    let ran = 0;
    let arg: unknown = null;
    const command = api.commands.register({ id: "draw", title: "Draw", run: (...args) => { ran++; arg = args[0]; return "drawn"; } });
    expect(store.get(pluginCommandsAtom)).toMatchObject([{ id: "paint.draw", pluginId: "paint", title: "Draw" }]);
    expect(api.commands.has("draw")).toBe(true);
    expect(api.commands.has("paint.draw")).toBe(true);
    expect(api.commands.run("draw", 7)).toBe("drawn");
    expect(arg).toBe(7);
    expect(api.commands.list()).toEqual([{ id: "paint.draw", title: "Draw", pluginId: "paint", enabled: true }]);

    api.menu.add("Tools", { label: "Draw…", command: "draw" });
    store.get(pluginMenuItemsAtom)[0].run();
    expect(ran).toBe(2);
    api.hotkeys.add("Ctrl+Alt+D", { command: "draw" });
    store.get(pluginHotkeysAtom)[0].run();
    expect(ran).toBe(3);
    api.contextMenu.add("viewport", { label: "Draw here", command: "draw" });
    store.get(pluginContextItemsAtom)[0].run({ surface: "viewport", tile: { x: 1, y: 1 }, point: null, layer: "terrain", terrainMode: "rect", terrain: 0, markedArea: null });
    expect(ran).toBe(4);
    expect((arg as { tile: { x: number } }).tile.x).toBe(1);

    // A command that says it is disabled does not run, and an unknown id is a no-op.
    const guarded = api.commands.register({ id: "off", title: "Off", enabled: () => false, run: () => { ran++; } });
    expect(api.commands.run("off")).toBeUndefined();
    expect(api.commands.list().find((c) => c.id === "paint.off")?.enabled).toBe(false);
    expect(api.commands.run("nope")).toBeUndefined();
    expect(ran).toBe(4);

    command.dispose();
    guarded.dispose();
    expect(store.get(pluginCommandsAtom)).toEqual([]);
    // Disabling the plugin takes the rest back too.
    bag.dispose();
    expect(store.get(pluginMenuItemsAtom)).toEqual([]);
  });
});

describe("plugin lifecycle", () => {
  it("activates, records the runtime and deactivates cleanly", async () => {
    const { store } = blankStore();
    let disposed = 0;
    const deps = fakeDeps({
      hello: {
        manifest: { name: "Hello", version: "0.1", api: 1, icon: "\u{1f9e9}" },
        load: async () => ({
          default: (api: PluginApi) => {
            api.menu.add("Tools", { label: "Hi", run: () => {} });
            api.events.on("document", () => {});
            return () => { disposed++; };
          },
        }),
      },
    });
    await activatePlugin(store, "builtin:hello", deps);
    expect(isPluginActive(store, "builtin:hello")).toBe(true);
    expect(store.get(pluginRuntimesAtom)["builtin:hello"]).toMatchObject({ status: "active", manifest: { name: "Hello" }, icon: { kind: "text", text: "\u{1f9e9}" }, contributions: { menu: 1, events: 1 } });
    expect(store.get(pluginMenuItemsAtom)).toHaveLength(1);
    await activatePlugin(store, "builtin:hello", deps); // idempotent
    expect(store.get(pluginMenuItemsAtom)).toHaveLength(1);
    deactivatePlugin(store, "builtin:hello");
    expect(disposed).toBe(1);
    expect(store.get(pluginMenuItemsAtom)).toEqual([]);
    expect(store.get(pluginRuntimesAtom)["builtin:hello"]).toMatchObject({ status: "disabled", contributions: zero });
  });

  it("reports a failing plugin without leaving contributions behind", async () => {
    const { store } = blankStore();
    const deps = fakeDeps({
      bad: { manifest: { name: "Bad" }, load: async () => ({ default: (api: PluginApi) => { api.menu.add("Tools", { label: "x", run: () => {} }); throw new Error("boom"); } }) },
      future: { manifest: { name: "Future", api: 99 }, load: async () => ({ default: () => {} }) },
    });
    await activatePlugin(store, "builtin:bad", deps);
    expect(store.get(pluginRuntimesAtom)["builtin:bad"]).toMatchObject({ status: "error", error: "boom" });
    expect(store.get(pluginMenuItemsAtom)).toEqual([]);
    expect(isPluginActive(store, "builtin:bad")).toBe(false);
    await activatePlugin(store, "builtin:future", deps);
    expect(store.get(pluginRuntimesAtom)["builtin:future"].error).toMatch(/plugin API 99/);
    await activatePlugin(store, "builtin:missing", deps);
    expect(store.get(pluginRuntimesAtom)["builtin:missing"].error).toMatch(/No built-in/);
  });

  it("merges the persisted list over the defaults", () => {
    const defaults = [{ spec: "builtin:a", enabled: true }, { spec: "github:d/p", enabled: true }, { spec: "github:off/q", enabled: false }];
    expect(effectiveInstalls([], defaults)).toEqual([{ spec: "builtin:a", enabled: true }, { spec: "github:d/p", enabled: true }, { spec: "github:off/q", enabled: false }]);
    // A default the user turned off (or on) keeps its place; anything else follows in the order it was added.
    expect(effectiveInstalls([{ spec: "github:d/p", enabled: false }, { spec: "github:x/y", enabled: true }, { spec: "github:off/q", enabled: true }], defaults))
      .toEqual([{ spec: "builtin:a", enabled: true }, { spec: "github:d/p", enabled: false }, { spec: "github:off/q", enabled: true }, { spec: "github:x/y", enabled: true }]);
    const store = createStore();
    setInstalled(store, "github:x/y", { enabled: true });
    setInstalled(store, "github:d/p", { enabled: false });
    expect(store.get(installedPluginsAtom)).toEqual([{ spec: "github:x/y", enabled: true }, { spec: "github:d/p", enabled: false }]);
    setInstalled(store, "github:x/y", { remove: true });
    expect(store.get(installedPluginsAtom)).toEqual([{ spec: "github:d/p", enabled: false }]);
  });

  it("ships scmscx.com and Terrain from Image on, and Paint, Section Explorer, Walkability and Melee Wizard off, as remote defaults", () => {
    expect(DEFAULT_REMOTE_PLUGINS).toEqual([
      { spec: "github:scm-js/plugin-scm-scx", enabled: true },
      { spec: "github:scm-js/plugin-image-to-terrain", enabled: true },
      { spec: "github:scm-js/plugin-paint", enabled: false },
      { spec: "github:scm-js/plugin-section-explorer", enabled: false },
      { spec: "github:scm-js/plugin-walkability", enabled: false },
      { spec: "github:scm-js/plugin-melee-wizard", enabled: false },
    ]);
    // A default is an ordinary spec: it resolves to a fetchable manifest like any other.
    expect(parseSpec(DEFAULT_REMOTE_PLUGINS[0].spec)).toMatchObject({
      kind: "remote",
      manifestUrl: "https://raw.githubusercontent.com/scm-js/plugin-scm-scx/HEAD/plugin.json",
    });
    expect(parseSpec(DEFAULT_REMOTE_PLUGINS[1].spec)).toMatchObject({ manifestUrl: "https://raw.githubusercontent.com/scm-js/plugin-image-to-terrain/HEAD/plugin.json" });
    expect(defaultPlugins()).toEqual(expect.arrayContaining([...DEFAULT_REMOTE_PLUGINS]));
    expect(defaultPluginSpecs()).toEqual(defaultPlugins().map((d) => d.spec));
    // A fresh editor lists Paint and Section Explorer but does not run them until the user ticks them.
    expect(effectiveInstalls([])).toContainEqual({ spec: "github:scm-js/plugin-paint", enabled: false });
    expect(effectiveInstalls([])).toContainEqual({ spec: "github:scm-js/plugin-section-explorer", enabled: false });
    expect(effectiveInstalls([])).toContainEqual({ spec: "github:scm-js/plugin-walkability", enabled: false });
    expect(effectiveInstalls([])).toContainEqual({ spec: "github:scm-js/plugin-melee-wizard", enabled: false });
    // scmscx.com starts on: it needs no address, and it only reaches the network when its dialog is opened.
    expect(effectiveInstalls([])).toContainEqual({ spec: "github:scm-js/plugin-scm-scx", enabled: true });
    expect(parseSpec("github:scm-js/plugin-scm-scx")).toMatchObject({ manifestUrl: "https://raw.githubusercontent.com/scm-js/plugin-scm-scx/HEAD/plugin.json" });
  });
});

/* ── Sections and names ─────────────────────────────────── */

describe("plugin sections", () => {
  const apiOver = (store: ReturnType<typeof createStore>) => createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());

  it("lists the file Save would write, dirty sections encoded", () => {
    const { store, scn } = blankStore(4, 2);
    const api = apiOver(store);
    const list = api.document.sections.list();
    // A new map carries its raw sections first and everything else is dirty, appended in APPEND_ORDER.
    expect(list.map((s) => s.name).slice(0, 6)).toEqual(["IVE2", "VCOD", "UPRP", "UPUS", "TYPE", "VER "]);
    expect(list[0]).toMatchObject({ index: 0, offset: 0, size: 2, declaredSize: 2, truncated: false, occurrence: 0, occurrences: 1, dirty: false });
    expect(list[4]).toMatchObject({ name: "TYPE", size: 4, dirty: true });
    expect(list[4].spec).toMatchObject({ name: "TYPE", mode: "last", size: 4, stride: null, modelled: true, what: "Map type (RAWS/RAWB/RAWU)" });
    const mtxm = list.find((s) => s.name === "MTXM")!;
    expect(mtxm).toMatchObject({ size: 16, spec: { size: 16, mode: "overlay" } });
    expect(list.find((s) => s.name === "VCOD")!.spec).toMatchObject({ modelled: false, size: 1040 });
    expect(list.find((s) => s.name === "UNIT")!.spec).toMatchObject({ mode: "append", stride: 36, size: null });
    // The bytes are the encoder's, and the whole file is the serialisation.
    expect(api.document.sections.bytes(list.indexOf(mtxm))).toEqual(new Uint8Array(scn.tiles.buffer.slice(0)));
    expect(api.document.sections.file()).toEqual(serializeScenario(scn));
    expect(api.document.sections.combined("DIM ")).toEqual(new Uint8Array([4, 0, 2, 0]));
    expect(api.document.sections.combined("NOPE")).toBeNull();
    expect(api.document.sections.spec("MRGN")).toMatchObject({ what: "Locations", stride: 20 });
    expect(api.document.sections.spec("ZZZZ")).toBeNull();
    expect(api.document.sections.known().map((k) => k.name)).toContain("STRx");
    // A copy: writing into what came back changes nothing.
    api.document.sections.bytes(4)[0] = 0;
    expect(api.document.sections.bytes(4)).toEqual(new Uint8Array([0x52, 0x41, 0x57, 0x42]));
    expect(createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions()).document.sections.list()).toEqual([]);
  });

  it("writes bytes through a fresh parse, dropping the history and firing document", () => {
    const { store, scn } = blankStore(4, 2);
    const api = apiOver(store);
    let events = 0;
    api.events.on("document", () => { events++; });
    // Something in the history first, so we can see it go.
    api.document.edit("tile", (tx) => tx.setTile(0, 0, 0x0123));
    expect(store.get(undoStackAtom)).toHaveLength(1);
    const before = api.document.sections.list();
    const dim = before.findIndex((s) => s.name === "DIM ");
    const result = api.document.sections.write(dim, new Uint8Array([6, 0, 3, 0]));
    expect(result).toEqual({ warnings: [] });
    const next = store.get(scenarioAtom)!;
    expect(next).not.toBe(scn);
    expect(next.width).toBe(6);
    expect(next.height).toBe(3);
    expect(next.dirty.size).toBe(0);
    // The typed model was rebuilt from the bytes: the earlier tile edit is in the file, and the MTXM is read for the new size.
    expect(next.tiles[0]).toBe(0x0123);
    expect(next.tiles).toHaveLength(18);
    expect(store.get(undoStackAtom)).toEqual([]);
    expect(store.get(mapModifiedAtom)).toBe(true);
    expect(events).toBe(1);
    // A section the editor never models is edited the same way and survives the round trip.
    const after = api.document.sections.list();
    const vcod = after.findIndex((s) => s.name === "VCOD");
    const bytes = api.document.sections.bytes(vcod);
    bytes[0] = 0xaa;
    api.document.sections.write(vcod, bytes);
    expect(api.document.sections.bytes(vcod)[0]).toBe(0xaa);
    expect(store.get(scenarioAtom)!.chk.sections.find((s) => s.name === "VCOD")!.data[0]).toBe(0xaa);
    expect(serializeScenario(store.get(scenarioAtom)!)).toEqual(api.document.sections.file());
  });

  it("inserts, renames, moves and removes occurrences, and replaces the whole file", () => {
    const { store } = blankStore(4, 2);
    const api = apiOver(store);
    const n = api.document.sections.list().length;
    api.document.sections.insert(n, "MYSC", new Uint8Array([1, 2, 3]));
    let list = api.document.sections.list();
    expect(list[n]).toMatchObject({ name: "MYSC", size: 3, spec: null, dirty: false });
    expect(store.get(scenarioAtom)!.chk.sections[n].data).toEqual(new Uint8Array([1, 2, 3]));
    api.document.sections.rename(n, "AB");
    expect(api.document.sections.list()[n].name).toBe("AB  ");
    api.document.sections.move(n, 0);
    list = api.document.sections.list();
    expect(list[0]).toMatchObject({ name: "AB  ", offset: 0 });
    expect(list[1]).toMatchObject({ name: "IVE2", offset: 11 });
    // A second DIM: the game (and the parser) read the last one.
    const dim = list.findIndex((s) => s.name === "DIM ");
    api.document.sections.insert(dim + 1, "DIM ", new Uint8Array([8, 0, 2, 0]));
    list = api.document.sections.list();
    expect(list.filter((s) => s.name === "DIM ").map((s) => [s.occurrence, s.occurrences])).toEqual([[0, 2], [1, 2]]);
    expect(store.get(scenarioAtom)!.width).toBe(8);
    expect(api.document.sections.combined("DIM ")).toEqual(new Uint8Array([8, 0, 2, 0]));
    api.document.sections.remove(dim + 1);
    expect(store.get(scenarioAtom)!.width).toBe(4);
    api.document.sections.remove(0);
    expect(api.document.sections.list().map((s) => s.name)).not.toContain("AB  ");
    expect(() => api.document.sections.bytes(99)).toThrow(RangeError);
    expect(() => api.document.sections.write(-1, new Uint8Array())).toThrow(RangeError);
    expect(() => api.document.sections.rename(0, "TOOLONG")).toThrow(RangeError);
    // The whole file, as File ▸ Open would read it — here a 2×2 map with nothing else.
    const tiny = serializeScenario(createScenario({ width: 2, height: 2, era: 3, name: "tiny" }));
    const r = api.document.sections.replaceFile(tiny);
    expect(r.warnings).toEqual([]);
    expect(store.get(scenarioAtom)).toMatchObject({ width: 2, height: 2, era: 3 });
    expect(api.document.info()).toMatchObject({ name: "tiny", tileset: "ashworld", modified: true });
    // A file the parser has to guess at reports it.
    expect(api.document.sections.replaceFile(new Uint8Array([0x54, 0x59, 0x50, 0x45, 4, 0, 0, 0, 0x52, 0x41])).warnings).toEqual(expect.arrayContaining([expect.stringContaining("TYPE declares 4 bytes")]));
    expect(() => createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions()).document.sections.write(0, new Uint8Array())).toThrow(/No map/);
  });
});

describe("plugin names", () => {
  it("answers from the editor's tables and the open map", () => {
    const { store, scn } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.names.unit(0)).toBe("Terran Marine");
    expect(api.names.unit(228)).toBe("Any unit");
    expect(api.names.units().length).toBe(232);
    expect(api.names.units()[231]).toEqual({ value: 231, label: "Factories" });
    expect(api.names.upgrade(16)).toBe("U-238 Shells");
    expect(api.names.upgrades()).toHaveLength(61);
    expect(api.names.tech(0)).toBe("Stim Packs");
    expect(api.names.techs()).toHaveLength(44);
    expect(api.names.weapon(0)).toBe("Gauss Rifle");
    expect(api.names.weapons()).toHaveLength(130);
    expect(api.names.playerType(6)).toBe("Human");
    expect(api.names.playerTypes()).toContainEqual({ value: 5, label: "Computer" });
    expect(api.names.race(1)).toBe("Terran");
    expect(api.names.races()[0]).toEqual({ value: 0, label: "Zerg" });
    expect(api.names.playerGroup(17)).toBe("All Players");
    expect(api.names.playerGroups()).toHaveLength(27);
    expect(api.names.condition(3)).toBe("Bring");
    expect(api.names.condition(0)).toBe("None");
    expect(api.names.conditions()[0]).toEqual({ value: 0, label: "None" });
    expect(api.names.conditions().map((c) => c.value)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(api.names.action(44)).toBe("Create Unit");
    expect(api.names.action(3, true)).toBe("Text Message");
    expect(api.names.actions()).toHaveLength(60);
    expect(api.names.actions(true)).toHaveLength(10);
    expect(api.names.aiScript(0x75434d54)).toBe("Terran Custom Level");
    expect(api.names.aiScript(0x41424344)).toBe("DCBA");
    expect(api.names.string(1)).toBe("p");
    expect(api.names.string(0)).toBeNull();
    expect(api.names.location(63)).toBe("Anywhere");
    expect(api.names.location(5)).toBe("Location 5");
    expect(api.names.switch(3)).toBe("Switch 4");
    expect(api.names.player(0)).toBe("Player 1");
    expect(api.names.tile(scn.tiles[0])).toBeNull();
    const none = createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions());
    expect(none.names.string(1)).toBeNull();
    expect(none.names.location(2)).toBe("Location 2");
  });
});

/* ── Describing (manifest only) ─────────────────────────── */

/** Serves the named URLs and throws for anything else, counting what was asked for. */
function servedDeps(files: Record<string, string>) {
  const asked: string[] = [];
  const deps: Pick<LoaderDeps, "fetchText" | "builtins"> = {
    fetchText: async (url) => {
      asked.push(url);
      const body = files[url];
      if (body === undefined) throw new Error(`404 ${url}`);
      return body;
    },
    builtins: {},
  };
  return { deps, asked };
}

describe("plugin descriptions", () => {
  const manifestUrl = "https://raw.githubusercontent.com/o/described/HEAD/plugin.json";

  it("reads a listed plugin's manifest without fetching or running its code", async () => {
    const { store } = blankStore();
    // No "entry": loading would probe for plugin.ts / plugin.js, describing must not.
    const { deps, asked } = servedDeps({ [manifestUrl]: JSON.stringify({ name: "Described", version: "2.0", description: "A plugin that says what it is.", icon: "\u{1f3a8}" }) });
    await describePlugin(store, "github:o/described", deps);
    expect(asked).toEqual([manifestUrl]);
    expect(store.get(pluginRuntimesAtom)["github:o/described"]).toMatchObject({
      status: "disabled",
      describing: false,
      error: null,
      manifest: { name: "Described", version: "2.0", description: "A plugin that says what it is." },
      icon: { kind: "text", text: "\u{1f3a8}" },
    });
    expect(isPluginActive(store, "github:o/described")).toBe(false);
    // One attempt per spec, until something asks again.
    await describePlugin(store, "github:o/described", deps);
    expect(asked).toHaveLength(1);
    forgetDescription(store, "github:o/described");
    await describePlugin(store, "github:o/described", deps);
    expect(asked).toHaveLength(2);
  });

  it("caches the manifest so the next visit renders before the network answers", async () => {
    const url = "https://raw.githubusercontent.com/o/cached/HEAD/plugin.json";
    const first = blankStore().store;
    const { deps } = servedDeps({ [url]: JSON.stringify({ name: "Cached", entry: "plugin.js" }) });
    await describePlugin(first, "github:o/cached", deps);
    expect(first.get(pluginManifestCacheAtom)["github:o/cached"]).toMatchObject({ manifest: { name: "Cached" } });

    // `atomWithStorage` reads its key once, when the module loads, so a page load starts
    // with that cache in hand: the row is named before the refresh is even sent, and a
    // refresh that fails leaves it alone rather than failing it.
    const next = blankStore().store;
    next.set(pluginManifestCacheAtom, first.get(pluginManifestCacheAtom));
    const offline: Pick<LoaderDeps, "fetchText" | "builtins"> = { fetchText: async () => { throw new Error("offline"); }, builtins: {} };
    const pending = describePlugin(next, "github:o/cached", offline);
    expect(next.get(pluginRuntimesAtom)["github:o/cached"]).toMatchObject({ manifest: { name: "Cached" }, describing: true });
    await pending;
    expect(next.get(pluginRuntimesAtom)["github:o/cached"]).toMatchObject({ status: "disabled", error: null, describing: false, manifest: { name: "Cached" } });
  });

  it("leaves a plugin it cannot describe as merely off", async () => {
    const { store } = blankStore();
    const { deps } = servedDeps({});
    await describePlugin(store, "github:o/gone", deps);
    expect(store.get(pluginRuntimesAtom)["github:o/gone"]).toMatchObject({ status: "disabled", error: null, manifest: null, describing: false });
    expect(store.get(pluginManifestCacheAtom)["github:o/gone"]).toBeUndefined();
  });

  it("describes a built-in from its bundled manifest and does not cache it", async () => {
    const { store } = blankStore();
    const deps = fakeDeps({ hello: { manifest: { name: "Hello", version: "0.1" }, load: async () => ({ default: () => {} }) } });
    await describePlugin(store, "builtin:hello", deps);
    expect(store.get(pluginRuntimesAtom)["builtin:hello"]).toMatchObject({ status: "disabled", manifest: { name: "Hello" } });
    expect(store.get(pluginManifestCacheAtom)["builtin:hello"]).toBeUndefined();
  });
});

/* ── Adding one: the confirmation ───────────────────────── */

/** A GitHub plugin's two reads: the commit the ref points at, and the manifest at that commit. */
function githubFiles(owner: string, repo: string, sha: string, manifest: object, ref = "HEAD") {
  return {
    [`https://api.github.com/repos/${owner}/${repo}/commits/${ref}`]: JSON.stringify({ sha, commit: { message: "x" } }),
    [`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/plugin.json`]: JSON.stringify(manifest),
  };
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("plugin previews", () => {
  it("reads one plugin.json at the commit the ref points at, and names every address", async () => {
    const { deps, asked } = servedDeps(githubFiles("o", "preview", SHA, {
      name: "Preview", version: "1.4", description: "Says what it does.", author: "Someone", homepage: "https://example.com/p", entry: "src/main.ts", icon: "\u{1f5fa}\u{fe0f}",
    }));
    const preview = await previewPlugin("https://github.com/o/preview", deps);
    // The user pasted a github.com URL; what gets stored is the short form, or its pinned twin.
    expect(preview.spec).toBe("github:o/preview");
    expect(preview.pin).toMatchObject({ spec: `github:o/preview@${SHA}`, ref: SHA, short: "0123456" });
    expect(preview).toMatchObject({ manifest: { name: "Preview", author: "Someone" }, icon: { kind: "text", text: "\u{1f5fa}\u{fe0f}" }, problem: null, pinProblem: null, ref: null });
    // Two requests, and the manifest came from the pinned commit: what is shown is what a pin runs.
    expect(asked).toEqual(["https://api.github.com/repos/o/preview/commits/HEAD", `https://raw.githubusercontent.com/o/preview/${SHA}/plugin.json`]);

    expect(addressesOf(preview.pin!.source, preview.manifest)).toEqual({
      manifestUrl: `https://raw.githubusercontent.com/o/preview/${SHA}/plugin.json`,
      entryUrl: `https://raw.githubusercontent.com/o/preview/${SHA}/src/main.ts`,
      base: `https://raw.githubusercontent.com/o/preview/${SHA}/`,
      webUrl: `https://github.com/o/preview/tree/${SHA}`,
    });
    // Unticking the pin: the same picture against the moving ref.
    expect(addressesOf(preview.source, preview.manifest)).toMatchObject({
      entryUrl: "https://raw.githubusercontent.com/o/preview/HEAD/src/main.ts",
      webUrl: "https://github.com/o/preview",
    });
    expect(isPinned(preview.pin!.spec)).toBe(true);
    expect(isPinned(preview.spec)).toBe(false);
  });

  it("pins the ref the user gave rather than the branch tip", async () => {
    const { deps } = servedDeps(githubFiles("o", "preview", SHA, { name: "Sub" }, "v2"));
    // The manifest lives under the resolved commit, not under `v2`.
    const preview = await previewPlugin("github:o/preview@v2", deps);
    expect(preview).toMatchObject({ spec: "github:o/preview@v2", ref: "v2", pin: { spec: `github:o/preview@${SHA}` }, manifest: { name: "Sub" } });
  });

  it("leaves the entry unnamed rather than probing for it", async () => {
    const url = "https://raw.githubusercontent.com/o/preview/v2/sub/plugin.json";
    const { deps, asked } = servedDeps({ [url]: JSON.stringify({ name: "Sub" }) });
    const preview = await previewPlugin("github:o/preview@v2/sub", deps);
    // GitHub would not answer, so this is the unpinned spec against the ref the user gave.
    expect(preview.pin).toBeNull();
    expect(preview.pinProblem).toMatch(/Could not fetch|404/);
    expect(addressesOf(preview.source, preview.manifest)).toMatchObject({
      entryUrl: null,
      base: "https://raw.githubusercontent.com/o/preview/v2/sub/",
      webUrl: "https://github.com/o/preview/tree/v2/sub",
    });
    expect(asked).toContain(url);
  });

  it("reports a manifest it could not read without refusing the plugin, and an API it is too old for", async () => {
    const { deps } = servedDeps({ "https://raw.githubusercontent.com/o/gone/HEAD/plugin.json": "{ nope" });
    const gone = await previewPlugin("github:o/gone", deps);
    expect(gone.manifest).toBeNull();
    expect(gone.problem).toMatch(/not valid JSON/);

    const url = "https://x/p/plugin.json";
    const future = await previewPlugin("https://x/p/", servedDeps({ [url]: JSON.stringify({ name: "Future", api: 99 }) }).deps);
    // Nothing outside GitHub has a commit to pin to, and the screen says so instead of offering it.
    expect(future).toMatchObject({ spec: "https://x/p/", needsApi: 99, pin: null, pinProblem: "Only plugins on GitHub can be pinned to a version." });

    // The spec itself being unusable is the one thing that throws — there is nothing to show.
    await expect(previewPlugin("nonsense", deps)).rejects.toThrow(PluginLoadError);
  });

  it("previews a built-in without a fetch", async () => {
    const deps = fakeDeps({ hello: { manifest: { name: "Hello", version: "0.1" }, load: async () => ({}) } });
    expect(await previewPlugin("builtin:hello", deps)).toMatchObject({ spec: "builtin:hello", manifest: { name: "Hello" }, pin: null, problem: null });
    expect(addressesOf(parseSpec("builtin:hello"), null)).toEqual({ manifestUrl: null, entryUrl: null, base: null, webUrl: null });
    expect(canonicalSpec(parseSpec("builtin:hello"))).toBe("builtin:hello");
  });

  it("installs what was confirmed: the pinned spec by default, the moving one when unticked", async () => {
    const { store } = blankStore();
    const { deps: read } = servedDeps(githubFiles("o", "p", SHA, { name: "P" }));
    const preview = await previewPlugin("github:o/p", read);
    const deps = fakeDeps({});

    await installPlugin(store, preview, { enabled: false, deps });
    expect(store.get(installedPluginsAtom)).toEqual([{ spec: `github:o/p@${SHA}`, enabled: false }]);
    // The row is named from the preview, so it never shows a bare spec while the code loads.
    expect(store.get(pluginRuntimesAtom)[`github:o/p@${SHA}`]).toMatchObject({ manifest: { name: "P" } });
    expect(store.get(pluginManifestCacheAtom)[`github:o/p@${SHA}`]).toMatchObject({ manifest: { name: "P" } });

    setInstalled(store, `github:o/p@${SHA}`, { remove: true });
    await installPlugin(store, preview, { enabled: false, pin: false, local: true, deps });
    expect(store.get(installedPluginsAtom)).toEqual([{ spec: "github:o/p", enabled: false, local: true }]);
  });

  it("swaps a pinned install for a newer commit, taking the old one's copy with it", async () => {
    const { store } = blankStore();
    const older = "1111111111111111111111111111111111111111";
    const deps = fakeDeps({});
    await installPlugin(store, await previewPlugin("github:o/p", servedDeps(githubFiles("o", "p", older, { name: "P" })).deps), { enabled: false, local: true, deps });
    store.set(pluginCodeAtom, { [`github:o/p@${older}`]: { files: { a: "b" }, at: 0, size: 1 } });
    expect(unpin(`github:o/p@${older}`)).toBe("github:o/p");
    expect(unpin(`github:o/p@${older}/sub`)).toBe("github:o/p/sub");
    expect(unpin("https://x/p/")).toBe("https://x/p/");

    const next = await previewPlugin("github:o/p", servedDeps(githubFiles("o", "p", SHA, { name: "P", version: "2" })).deps);
    await installPlugin(store, next, { enabled: false, local: true, replaces: `github:o/p@${older}`, deps });
    expect(store.get(installedPluginsAtom)).toEqual([{ spec: `github:o/p@${SHA}`, enabled: false, local: true }]);
    // The old commit's copy goes with its install; nothing of it is left to load.
    expect(store.get(pluginCodeAtom)[`github:o/p@${older}`]).toBeUndefined();
  });

  it("runs a plugin marked local out of the copy it kept, and goes back to the address on Reload", async () => {
    const { store } = blankStore();
    const base = "https://x/local/";
    const files = {
      [`${base}plugin.json`]: JSON.stringify({ name: "Local", entry: "plugin.js" }),
      [`${base}plugin.js`]: "export default () => {};",
    };
    let activated = 0;
    const asked: string[] = [];
    const deps: LoaderDeps = {
      fetchText: async (url) => { asked.push(url); const t = files[url]; if (t === undefined) throw new Error(`404 ${url}`); return t; },
      transpile: async (src) => src,
      createModuleUrl: () => "mem:0",
      importModule: async () => ({ default: () => { activated++; } }),
      builtins: {},
    };
    setInstalled(store, base, { enabled: true, local: true });

    await activatePlugin(store, base, deps);
    expect(asked).toEqual([`${base}plugin.json`, `${base}plugin.js`]);
    expect(store.get(pluginCodeAtom)[base].files).toEqual(files);
    expect(store.get(pluginRuntimesAtom)[base]).toMatchObject({ status: "active", loadedFrom: "network" });

    // The next start reads the copy and asks the network for nothing at all.
    deactivatePlugin(store, base);
    asked.length = 0;
    await activatePlugin(store, base, deps);
    expect(asked).toEqual([]);
    expect(activated).toBe(2);
    expect(store.get(pluginRuntimesAtom)[base]).toMatchObject({ status: "active", loadedFrom: "browser" });

    // Reload is how a copy is refreshed, and turning the option off throws it away.
    await reloadPlugin(store, base, deps);
    expect(asked).toEqual([`${base}plugin.json`, `${base}plugin.js`]);
    setInstalled(store, base, { local: false });
    expect(store.get(pluginCodeAtom)[base]).toBeUndefined();
    expect(store.get(installedPluginsAtom)).toEqual([{ spec: base, enabled: true }]);
  });

  it("fails a local plugin whose copy is missing a file rather than fetching it", async () => {
    const { store } = blankStore();
    const base = "https://x/torn/";
    setInstalled(store, base, { enabled: true, local: true });
    store.set(pluginCodeAtom, { [base]: { files: { [`${base}plugin.json`]: JSON.stringify({ name: "Torn", entry: "plugin.js" }) }, at: 0, size: 1 } });
    const deps: LoaderDeps = {
      fetchText: async () => { throw new Error("the network must not be used here"); },
      transpile: async (src) => src,
      createModuleUrl: () => "mem:0",
      importModule: async () => ({}),
      builtins: {},
    };
    await activatePlugin(store, base, deps);
    expect(store.get(pluginRuntimesAtom)[base]).toMatchObject({ status: "error" });
    expect(store.get(pluginRuntimesAtom)[base].error).toMatch(/not in the copy kept in this browser/);
  });
});

/* ── Surfaces ───────────────────────────────────────────── */

describe("plugin surfaces", () => {
  it("merge menu items into the top menu or submenu their path names", () => {
    const menus: Menu[] = [
      { label: "File", items: [{ kind: "item", label: "New" }, { kind: "sub", label: "Import", items: [{ kind: "item", label: "Strings" }] }] },
      { label: "Plugins", items: [{ kind: "item", label: "Manage Plugins…" }] },
    ];
    const merged = withPluginItems(menus, [
      { key: 1, pluginId: "p", path: "File/Import", label: "Terrain from Image…", run: () => {} },
      { key: 2, pluginId: "p", path: "File/Import", label: "Second", run: () => {}, enabled: () => false },
      { key: 3, pluginId: "p", path: "Nowhere" as never, label: "Lost", run: () => {} },
      { key: 4, pluginId: "p", path: "File/Nope", label: "Deep", run: () => {} },
    ]);
    const sub = merged[0].items[1] as Extract<Menu["items"][number], { kind: "sub" }>;
    expect(sub.items.map((i) => (i.kind === "sep" ? "—" : i.kind === "item" ? `${i.label}${i.disabled ? "!" : ""}` : "?"))).toEqual(["Strings", "—", "Terrain from Image…", "Second!"]);
    expect(merged[0].items.map((i) => (i.kind === "item" ? i.label : i.kind))).toEqual(["New", "sub", "sep", "Deep"]);
    expect(merged[1].items.map((i) => (i.kind === "item" ? i.label : i.kind))).toEqual(["Manage Plugins…", "sep", "Lost"]);
    // The caller's model is untouched.
    expect(menus[0].items).toHaveLength(2);
    expect((menus[0].items[1] as { items: unknown[] }).items).toHaveLength(1);
  });

  it("place an item under the built-in `after` names, with its icon, and fall back to the end", () => {
    const menus: Menu[] = [
      { label: "File", items: [{ kind: "item", label: "Open…" }, { kind: "sub", label: "Open Recent", items: [] }, { kind: "sep" }, { kind: "item", label: "Save" }] },
    ];
    const icon = { kind: "text" as const, text: "☁" };
    const merged = withPluginItems(menus, [
      { key: 1, pluginId: "p", path: "File", label: "Find Map…", after: "Open Recent", icon, run: () => {} },
      { key: 2, pluginId: "p", path: "File", label: "Second", after: "Open Recent", run: () => {} },
      { key: 3, pluginId: "p", path: "File", label: "Nowhere", after: "Nope", run: () => {} },
    ]);
    expect(merged[0].items.map((i) => (i.kind === "item" ? i.label : i.kind))).toEqual(["Open…", "sub", "Find Map…", "Second", "sep", "Save", "sep", "Nowhere"]);
    expect((merged[0].items[2] as { icon?: unknown }).icon).toBe(icon);
    expect(menus[0].items).toHaveLength(4);
  });

  it("resolves `icon: \"plugin\"` to the plugin's own icon when it registers", () => {
    const { store } = blankStore();
    const icon = { kind: "image" as const, url: "https://x/icon.svg" };
    const api = createPluginApi(store, { id: "t", name: "T", source: "s", icon }, new Contributions());
    api.menu.add("File", { label: "A", icon: "plugin", after: "Open Recent", run: () => {} });
    api.menu.add("File", { label: "B", icon: { kind: "text", text: "☁" }, run: () => {} });
    api.menu.add("File", { label: "C", run: () => {} });
    expect(store.get(pluginMenuItemsAtom).map((i) => i.icon)).toEqual([icon, { kind: "text", text: "☁" }, undefined]);
    expect(store.get(pluginMenuItemsAtom)[0].after).toBe("Open Recent");
  });

  it("build context-menu rows for one surface, honouring visible/enabled and dynamic labels", () => {
    const ctx = { surface: "viewport" as const, tile: { x: 1, y: 2 }, point: null, layer: "terrain" as const, terrainMode: "isom" as const, terrain: 2, markedArea: null };
    let ran = 0;
    const rows = pluginContextRows([
      { key: 1, pluginId: "p", surface: "viewport", label: (c) => `At ${c.tile?.x}`, run: () => { ran++; } },
      { key: 2, pluginId: "p", surface: "terrainPalette", label: "Other", run: () => {} },
      { key: 3, pluginId: "p", surface: "viewport", label: "Hidden", visible: () => false, run: () => {} },
      { key: 4, pluginId: "p", surface: "viewport", label: "Off", enabled: () => false, run: () => {} },
      { key: 5, pluginId: "p", surface: "viewport", label: "Broken", visible: () => { throw new Error("x"); }, run: () => {} },
    ], "viewport", ctx);
    expect(rows.map((r) => [r.label, r.disabled])).toEqual([["At 1", false], ["Off", true]]);
    rows[0].onSelect();
    expect(ran).toBe(1);
  });
});

/* ── Picks on the map, images, dialog titles ────────────── */

describe("plugin picks and images", () => {
  it("runs a pick through the atom and resolves with what the viewport hands back", async () => {
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    const area = api.ui.pickArea({ prompt: "Drag it" });
    const req = store.get(mapPickAtom)!;
    expect(req).toMatchObject({ kind: "area", prompt: "Drag it", pluginId: "t" });
    req.finish({ x0: 1, y0: 2, x1: 4, y1: 5 });
    expect(await area).toEqual({ x0: 1, y0: 2, x1: 4, y1: 5 });
    expect(store.get(mapPickAtom)).toBeNull();
    const tile = api.ui.pickTile();
    expect(store.get(mapPickAtom)).toMatchObject({ kind: "tile", prompt: "Click a tile on the map" });
    store.get(mapPickAtom)!.finish({ x: 3, y: 4 });
    expect(await tile).toEqual({ x: 3, y: 4 });
    expect(bag.disposables).toHaveLength(0); // a finished pick leaves nothing behind
  });

  it("cancels on Esc, when a newer pick starts, when the document changes and on deactivation", async () => {
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    const a = api.ui.pickTile();
    expect(store.set(cancelMapPickAtom)).toBe(true);
    expect(await a).toBeNull();
    expect(store.set(cancelMapPickAtom)).toBe(false);
    const b = api.ui.pickArea();
    const c = api.ui.pickArea();
    expect(await b).toBeNull();
    expect(store.get(mapPickAtom)).not.toBeNull();
    store.set(scenarioAtom, null);
    expect(await c).toBeNull();
    expect(store.get(mapPickAtom)).toBeNull();
    // No map: resolves at once.
    expect(await api.ui.pickArea()).toBeNull();
    const { store: store2 } = blankStore();
    const bag2 = new Contributions();
    const api2 = createPluginApi(store2, { id: "t", name: "T", source: "s" }, bag2);
    const d = api2.ui.pickArea();
    bag2.dispose();
    expect(await d).toBeNull();
    expect(store2.get(mapPickAtom)).toBeNull();
  });

  it("reads files and text out of a transfer and recognises image URLs", () => {
    expect(transferOf(null)).toEqual({ files: [], text: "" });
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    const dt = {
      items: [{ kind: "file", getAsFile: () => file }, { kind: "string", getAsFile: () => null }],
      files: [file],
      getData: (type: string) => (type === "text/plain" ? "  https://x/a.png \n" : ""),
    } as unknown as DataTransfer;
    expect(transferOf(dt)).toEqual({ files: [file], text: "https://x/a.png" });
    const uriOnly = { items: [], files: [], getData: (type: string) => (type === "text/uri-list" ? "# c\r\nhttps://y/b.jpg\r\n" : "") } as unknown as DataTransfer;
    expect(transferOf(uriOnly).text).toBe("https://y/b.jpg");
    expect(looksLikeImageUrl("https://a/b.png")).toBe(true);
    expect(looksLikeImageUrl(" http://localhost:3000/x ")).toBe(true);
    expect(looksLikeImageUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(looksLikeImageUrl("data:text/html,<b>")).toBe(false);
    expect(looksLikeImageUrl("hello there")).toBe(false);
    expect(looksLikeImageUrl("ftp://x/y.png")).toBe(false);
  });

  it("changes a dialog's title through the handle", () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const handle = api.ui.dialog({ title: "A", mount: () => {} });
    const box = store.get(dialogStackAtom)[0].payload?.title as { value: string; listeners: Set<() => void> };
    expect(box.value).toBe("A");
    let heard = 0;
    box.listeners.add(() => heard++);
    handle.setTitle("B");
    expect(box.value).toBe("B");
    expect(heard).toBe(1);
  });
});

/* ── Map tools, panels, palettes ────────────────────────── */

describe("plugin map tools", () => {
  it("run through the atom, hear the pointer, redraw on request and stop once", () => {
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    const heard: string[] = [];
    const stops: MapToolStopReason[] = [];
    const handle = api.ui.mapTool({
      name: "Line",
      hint: "drag",
      onDown: (p) => heard.push(`down ${p.px},${p.py}`),
      onMove: (p) => heard.push(`move ${p.tx},${p.ty}${p.down ? " held" : ""}`),
      onUp: (p) => heard.push(`up ${p.inMap ? "in" : "out"}`),
      onStop: (r) => stops.push(r),
    });
    const req = store.get(mapToolAtom)!;
    expect(req).toMatchObject({ pluginId: "t" });
    expect(req.spec.name).toBe("Line");
    expect(handle.isActive()).toBe(true);
    const pointer = { px: 40, py: 50, tx: 1, ty: 1, inMap: true, down: false, shift: false, ctrl: false, alt: false };
    req.spec.onDown!({ ...pointer, down: true });
    req.spec.onMove!({ ...pointer, tx: 2, down: true });
    req.spec.onUp!(pointer);
    expect(heard).toEqual(["down 40,50", "move 2,1 held", "up in"]);
    const rev = store.get(mapToolRevisionAtom);
    handle.redraw();
    expect(store.get(mapToolRevisionAtom)).toBe(rev + 1);
    handle.stop();
    handle.stop();
    expect(stops).toEqual(["stopped"]);
    expect(handle.isActive()).toBe(false);
    expect(store.get(mapToolAtom)).toBeNull();
    expect(bag.disposables).toHaveLength(0);
    handle.redraw(); // nothing to repaint for
    expect(store.get(mapToolRevisionAtom)).toBe(rev + 2);
  });

  it("stop on Esc unless the tool keeps itself, on a newer tool, on a map change and on deactivation", () => {
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    const stops: MapToolStopReason[] = [];
    let keep = true;
    const a = api.ui.mapTool({ name: "A", onCancel: () => keep, onStop: (r) => stops.push(`a:${r}` as MapToolStopReason) });
    expect(store.set(cancelMapToolAtom)).toBe(true);
    expect(a.isActive()).toBe(true); // it cancelled a gesture of its own and kept running
    keep = false;
    expect(store.set(cancelMapToolAtom)).toBe(true);
    expect(a.isActive()).toBe(false);
    expect(store.set(cancelMapToolAtom)).toBe(false);
    const b = api.ui.mapTool({ name: "B", onStop: (r) => stops.push(`b:${r}` as MapToolStopReason) });
    const c = api.ui.mapTool({ name: "C", onStop: (r) => stops.push(`c:${r}` as MapToolStopReason) });
    expect(b.isActive()).toBe(false);
    expect(store.get(mapToolAtom)!.spec.name).toBe("C");
    store.set(scenarioAtom, null);
    expect(c.isActive()).toBe(false);
    expect(store.get(mapToolAtom)).toBeNull();
    const { store: store2 } = blankStore();
    const bag2 = new Contributions();
    const d = createPluginApi(store2, { id: "t", name: "T", source: "s" }, bag2).ui.mapTool({ name: "D", onStop: (r) => stops.push(`d:${r}` as MapToolStopReason) });
    bag2.dispose();
    expect(d.isActive()).toBe(false);
    expect(stops).toEqual(["a:cancelled", "b:replaced", "c:document", "d:disabled"]);
  });
});

describe("plugin panels and palettes", () => {
  it("open a panel in the registry and close it from the handle, the plugin or deactivation", () => {
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    let closed = 0;
    const a = api.ui.panel({ title: "Paint", width: 300, mount: () => {}, onClose: () => closed++ });
    const b = api.ui.panel({ title: "Other", mount: () => {} });
    expect(store.get(pluginPanelsAtom).map((p) => p.spec.title)).toEqual(["Paint", "Other"]);
    expect(store.get(pluginPanelsAtom)[0].plugin.id).toBe("t");
    a.setTitle("Paint — Line");
    expect(store.get(pluginPanelsAtom)[0].title.value).toBe("Paint — Line");
    a.close();
    a.close();
    expect(closed).toBe(1);
    expect(a.isOpen()).toBe(false);
    expect(store.get(pluginPanelsAtom).map((p) => p.spec.title)).toEqual(["Other"]);
    bag.dispose();
    expect(b.isOpen()).toBe(false);
    expect(store.get(pluginPanelsAtom)).toEqual([]);
  });

  it("read and set what the palettes picked, and answer names and sizes without the game data", () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    store.set(activeUnitAtom, 7);
    store.set(unitOwnerAtom, 3);
    expect(api.palette.active()).toMatchObject({ unit: 7, owner: 3, spriteKind: "pure", doodad: -1, fogPlayers: 1, fogMode: "fog" });
    let heard = 0;
    api.events.on("palette", () => heard++);
    api.palette.setActive({ unit: 0, owner: 0, spriteFlipped: true, fogMode: "clear" });
    expect(api.palette.active()).toMatchObject({ unit: 0, owner: 0, spriteFlipped: true, spriteDisabled: false, fogMode: "clear" });
    expect(heard).toBeGreaterThanOrEqual(3);
    expect(api.palette.unitName(0)).toBe("Terran Marine");
    expect(api.palette.unitGroups().flatMap((g) => g.units)).toHaveLength(228);
    expect(api.palette.unitSize(106)).toEqual({ width: 32, height: 32, building: false, flyer: false }); // no units.dat here: the one-tile fallback
    expect(api.palette.spriteName("unit", 0)).toBe("Terran Marine");
    expect(api.palette.playerColor(0)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(api.palette.doodadCategories()).toEqual([]);
    expect(api.palette.doodadInfo(1)).toBeNull();
  });

  it("place units and sprites on the map in one call, and answer the placement checks", () => {
    const { store, scn } = blankStore();
    const result = runTransaction(store, "place", (tx) => {
      expect(tx.placeUnit(0, 2, 40, 40)).toBe(0);
      expect(tx.placeUnit(0, 2, 5000, -9)).toBe(1); // kept on the map
      expect(tx.canPlaceUnit(0, 40, 40)).toBe(false); // the first one is in the way
      expect(tx.canPlaceUnit(0, 120, 120)).toBe(true);
      expect(tx.placeSprite("pure", 3, 1, 64, 64, { flipped: true })).toBe(0);
    });
    expect(result).toMatchObject({ units: 2, sprites: 1 });
    expect(scn.units[0]).toMatchObject({ unitId: 0, owner: 2, x: 40, y: 40 });
    expect(scn.units[1].x).toBeLessThan(scn.width * 32);
    expect(scn.units[1].y).toBe(0);
    expect(scn.sprites[0]).toMatchObject({ spriteId: 3, owner: 1, x: 64, y: 64 });
    store.set(undoAtom);
    expect(scn.units).toHaveLength(0);
    expect(scn.sprites).toHaveLength(0);
  });
});

/* ── With the real tileset ──────────────────────────────── */

const TILESET_DIR = join(__dirname, "..", "public", "tileset");
const haveJungle = ["cv5", "vf4", "vr4", "vx4", "wpe"].every((ext) => existsSync(join(TILESET_DIR, `jungle.${ext}`)));

describe.skipIf(!haveJungle)("plugin transactions with the jungle tileset", () => {
  const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `jungle.${ext}`)));
  const tileset = haveJungle ? loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") }) : null;

  function jungleStore(width = 16, height = 16) {
    const loaded: LoadedTileset = {
      name: "jungle",
      tileset: tileset!,
      atlas: { image: {} as CanvasImageSource, columns: 1, tileSize: 32, count: tileset!.megatileCount, averages: new Uint32Array(tileset!.megatileCount).fill(0x336633), animation: null },
      doodads: NO_DOODADS,
    };
    primeTileset(loaded);
    const store = createStore();
    const flat = flatTerrain(width, height, { id: 2, group: 2 }, tileset, () => 0, 4);
    const scn = createScenario({ width, height, era: 4, name: "j", tiles: flat.tiles, isom: flat.isom });
    store.set(scenarioAtom, scn);
    store.set(mapTilesetAtom, "jungle");
    return { store, scn };
  }

  it("lists terrains and their colours", () => {
    const { store } = jungleStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.tileset.isLoaded()).toBe(true);
    const types = api.terrain.types();
    expect(types.length).toBeGreaterThan(5);
    expect(api.terrain.isomTypes()).toContain(2);
    expect(api.terrain.terrainColor(types[0].id)).toBe(0x336633);
    expect(api.terrain.tileInfo(0x20)?.group).toBe(2);
    expect(api.terrain.hasIsom()).toBe(true);
    expect(api.terrain.heightOf(2)).toBe(0);
    expect(api.terrain.heightOf(9999)).toBeNull();
    // Diamonds over the whole map include the last lattice column and row.
    const all = api.terrain.diamondsIn({ x0: 0, y0: 0, x1: 16, y1: 16 });
    expect(all.some((d) => d.x === 8)).toBe(true);
    expect(all.some((d) => d.y === 16)).toBe(true);
    expect(all.every((d) => (d.x + d.y) % 2 === 0)).toBe(true);
  });

  it("stamps, fills flat and paints isometrically, all undoable", () => {
    const { store, scn } = jungleStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const other = api.terrain.types().find((t) => t.id !== 2 && api.terrain.isomTypes().includes(t.id))!;
    const before = new Uint16Array(scn.tiles);
    const isomBefore = new Uint16Array(scn.isom!);

    const stamped = api.document.edit("stamp", (tx) => { expect(tx.stampTerrain({ x0: 2, y0: 2, x1: 6, y1: 4 }, other.id)).toBe(8); });
    expect(stamped.tiles).toBe(8);
    expect(scn.tiles[2 * 16 + 2] >> 4).toBe(other.group);
    expect(scn.tiles[2 * 16 + 3] >> 4).toBe(other.group + 1);

    const filled = api.document.edit("fill", (tx) => { tx.fillFlat({ x0: 8, y0: 8, x1: 16, y1: 16 }, other.id); });
    expect(filled.tiles).toBe(64);
    expect(filled.isom).toBeGreaterThan(0);

    const painted = api.document.edit("isom", (tx) => {
      for (const d of api.terrain.diamondsIn({ x0: 4, y0: 10, x1: 8, y1: 14 })) expect(tx.paintIsom(d, other.id)).toBe(true);
    });
    expect(painted.isom).toBeGreaterThan(0);
    expect(painted.tiles).toBeGreaterThan(0);
    expect(hasIsom(scn)).toBe(true);

    api.document.undo();
    api.document.undo();
    api.document.undo();
    expect(scn.tiles).toEqual(before);
    expect(scn.isom).toEqual(isomBefore);
    expect(store.get(clipSelectionAtom)).toBeNull();
  });
});
