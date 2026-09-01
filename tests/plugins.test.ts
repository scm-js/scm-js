import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { flatTerrain } from "../src/formats/tileset/terrain";
import { loadTileset } from "../src/formats/tileset/decode";
import { primeTileset, type LoadedTileset } from "../src/formats/tileset/load";
import { NO_DOODADS } from "../src/formats/tileset/doodads";
import { hasIsom } from "../src/editor/isom";
import { scenarioAtom, redoAtom, undoAtom, undoStackAtom } from "../src/atoms/documentAtoms";
import { clipSelectionAtom, mapTilesetAtom, terrainModeAtom } from "../src/atoms/editorAtoms";
import { dialogStackAtom } from "../src/atoms/uiAtoms";
import { installedPluginsAtom, normalizeCombo, pluginContextItemsAtom, pluginHotkeysAtom, pluginMenuItemsAtom, pluginRuntimesAtom } from "../src/atoms/pluginAtoms";
import { bundleModule, findImports, loadPlugin, parseSpec, PluginLoadError, resolveIcon, resolvePlugin, validateManifest, type LoaderDeps } from "../src/plugins/loader";
import { transpileTs } from "../src/plugins/transpile";
import {
  activatePlugin, Contributions, createPluginApi, deactivatePlugin, effectiveInstalls, isPluginActive, resolveActivate, runTransaction, setInstalled,
} from "../src/plugins/host";
import { pluginContextRows } from "../src/plugins/contextMenu";
import { withPluginItems, type Menu } from "../src/components/chrome/MenuBar";
import { pluginIdOf, type PluginApi } from "../src/plugins/api";

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

  it("merges the persisted list over the built-ins", () => {
    expect(effectiveInstalls([], ["a", "b"])).toEqual([{ spec: "builtin:a", enabled: true }, { spec: "builtin:b", enabled: true }]);
    expect(effectiveInstalls([{ spec: "builtin:b", enabled: false }, { spec: "github:x/y", enabled: true }], ["a", "b"]))
      .toEqual([{ spec: "builtin:a", enabled: true }, { spec: "builtin:b", enabled: false }, { spec: "github:x/y", enabled: true }]);
    const store = createStore();
    setInstalled(store, "github:x/y", { enabled: true });
    setInstalled(store, "builtin:a", { enabled: false });
    expect(store.get(installedPluginsAtom)).toEqual([{ spec: "github:x/y", enabled: true }, { spec: "builtin:a", enabled: false }]);
    setInstalled(store, "github:x/y", { remove: true });
    expect(store.get(installedPluginsAtom)).toEqual([{ spec: "builtin:a", enabled: false }]);
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
