import { describe, expect, it, vi } from "vitest";
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
import { closeDocumentAtom, isomRevisionAtom, loadDocumentAtom, scenarioAtom, redoAtom, undoAtom, undoStackAtom } from "../src/atoms/documentAtoms";
import { defaultVcod } from "../src/formats/chk/sections/vcod";
import { parseChk, serializeChk } from "../src/formats/chk/reader";
import { scenarioName } from "../src/formats/chk/scenario";
import {
  ActionFlag, ActionType, AllianceStatus, BriefingActionType, Comparison, ConditionFlag, ConditionType,
  Order, PlayerGroup, ResourceType, ScoreType, SetModifier, SwitchAction, SwitchState, TriggerFlag,
  UnitClass, UnitState as TriggerUnitState,
} from "../src/formats/chk/sections/triggers";
import { START_LOCATION } from "../src/data/units";
import { Elevation, SpriteFlag, UnitRelation, UnitState, UnitUsed, UnitValid } from "../src/formats/chk/sections/objects";
import { DEATHS_TABLE_ADDRESS } from "../src/data/triggerDefs";
import { DEFAULT_GAS, DEFAULT_MINERALS, isResource, MINERAL_FIELD_IDS, TILE_PX, VESPENE_GEYSER } from "../src/editor/units";
import {
  activeUnitAtom, centerViewOnAtom, clipSelectionAtom, mapModifiedAtom, mapNameAtom, mapTilesetAtom, terrainModeAtom, unitOwnerAtom,
} from "../src/atoms/editorAtoms";
import { preferencesAtom } from "../src/atoms/preferencesAtoms";
import type { PendingAction } from "../src/hooks/useMapFileActions";
import { closeDialogAtom, dialogStackAtom } from "../src/atoms/uiAtoms";
import {
  cancelMapPickAtom, cancelMapToolAtom, installedPluginsAtom, mapPickAtom, mapToolAtom, mapToolRevisionAtom, normalizeCombo, overlayVisibilityMemory, pluginCodeAtom,
  pluginOverlayRevisionAtom, pluginOverlaysAtom, setOverlayVisibleAtom,
  pluginCommandsAtom, pluginContextItemsAtom, pluginHotkeysAtom, pluginManifestCacheAtom, pluginMenuItemsAtom, pluginPanelsAtom, pluginRuntimesAtom,
  pluginDialogSlotsAtom, pluginStatusItemsAtom, viewFlashesAtom,
} from "../src/atoms/pluginAtoms";
import { looksLikeImageUrl, transferOf } from "../src/plugins/images";
import {
  addressesOf, blankLiterals, bundleModule, candidateUrls, canonicalSpec, findImports, isPinned, listTags, loadPlugin, newestTag, parseSpec, PluginLoadError, pluginIdentity, previewPlugin,
  resolveIcon, resolvePlugin, tagVersion, unpin, validateManifest, type LoaderDeps,
} from "../src/plugins/loader";
import { transpileTs } from "../src/plugins/transpile";
import {
  activatePlugin, checkForUpdate, Contributions, createPluginApi, deactivatePlugin, describePlugin, effectiveInstalls, forgetDescription, installPlugin, isPluginActive,
  reloadPlugin, resolveActivate, runTransaction, runUpdate, setInstalled,
} from "../src/plugins/host";
import { pluginContextRows } from "../src/plugins/contextMenu";
import { DEFAULT_REGISTRIES, DEFAULT_REMOTE_PLUGINS, defaultPlugins, defaultPluginSpecs, pluginKey, updateAddress } from "../src/plugins/defaults";
import { BUILTIN_REPLACES } from "../src/plugins/builtin";
import { failureToast, pluginFailures } from "../src/plugins/failures";
import {
  addRegistry, cachedRegistries, entryIcon, groupByInstall, isDefaultRegistry, loadRegistries, loadRegistry, mergeRegistries, parseRegistry, registryUrls,
  RegistryError, removeRegistry, searchRegistry, unlistedInstalls, type InstallState, type RegistryEntry,
} from "../src/plugins/registry";
import { pluginTriggerClaimsAtom, registryCacheAtom, registryStateAtom } from "../src/atoms/pluginAtoms";
import { claimAt, claimBadge, claimDescription, locateClaims } from "../src/plugins/claims";
import { withPluginItems, type Menu } from "../src/components/chrome/MenuBar";
import { pluginIdOf, type EditTransaction, type MapToolStopReason, type PluginApi } from "../src/plugins/api";

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
    expect(await resolvePlugin(parseSpec("https://x/a/"), { fetchText, builtins: {} })).toEqual({ manifest: { name: "A", entry: "src/main.ts" }, entryUrl: "https://x/a/src/main.ts", built: false });
    expect(await resolvePlugin(parseSpec("https://x/b/"), { fetchText, builtins: {} })).toEqual({ manifest: { name: "B", entry: "plugin.js" }, entryUrl: "https://x/b/plugin.js" });
    expect(await resolvePlugin(parseSpec("https://x/c/main.ts"), { fetchText, builtins: {} })).toEqual({ manifest: { name: "main", entry: "main.ts" }, entryUrl: "https://x/c/main.ts" });
    await expect(resolvePlugin(parseSpec("https://x/none/"), { fetchText, builtins: {} })).rejects.toThrow(/Could not fetch/);
    await expect(resolvePlugin(parseSpec("builtin:nope"), { fetchText, builtins: {} })).rejects.toThrow(/No built-in/);
  });

  it("loads the manifest's build in place of its entry, and says which", async () => {
    const manifest = { name: "Built", entry: "plugin.ts", build: "dist/plugin.js" };
    const files: Record<string, string> = { "https://x/a/plugin.json": JSON.stringify(manifest) };
    const fetchText = async (url: string) => { if (url in files) return files[url]; throw new Error("404"); };
    const source = parseSpec("https://x/a/");
    // The bundle is what runs; `entry` stays in the manifest as the source it was built from.
    expect(await resolvePlugin(source, { fetchText, builtins: {} })).toEqual({ manifest, entryUrl: "https://x/a/dist/plugin.js", built: true });
    // …and the confirmation names the same file, so what is shown is what will run.
    expect(addressesOf(source, manifest)).toMatchObject({ entryUrl: "https://x/a/dist/plugin.js", built: true });
    // Nothing is fetched for it on the describe path, as for `entry`.
    expect(await resolvePlugin(source, { fetchText, builtins: {} }, { entry: false })).toMatchObject({ entryUrl: null });
    // An absolute build is refused for the same reason an absolute entry is.
    expect(() => validateManifest({ name: "N", build: "https://elsewhere/x.js" }, "m")).toThrow(/"build" must be a path relative/);
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

  // The point of the group is that a plugin stops writing the hex itself, so what it is
  // handed has to be the editor's own tables and not a second copy that can drift.
  it("hands over the record constants the editor writes records with", () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const c = api.consts;
    expect(c.tile).toBe(TILE_PX);
    expect(c.unit.valid).toBe(UnitValid);
    expect(c.unit.used).toBe(UnitUsed);
    expect(c.unit.state).toBe(UnitState);
    expect(c.unit.relation).toBe(UnitRelation);
    expect(c.sprite.flags).toBe(SpriteFlag);
    expect(c.location.elevation).toBe(Elevation);
    expect(c.location.anywhere).toBe(ANYWHERE_INDEX);
    expect(c.unit.startLocation).toBe(START_LOCATION);
    expect(c.unit.mineralFields).toEqual(MINERAL_FIELD_IDS);
    expect(c.unit.vespeneGeyser).toBe(VESPENE_GEYSER);
    expect(c.unit.defaultMinerals).toBe(DEFAULT_MINERALS);
    expect(c.unit.defaultGas).toBe(DEFAULT_GAS);
    expect([c.isResource(c.unit.mineralFields[0]), c.isResource(c.unit.vespeneGeyser), c.isResource(0)])
      .toEqual([isResource(176), true, false]);
  });

  // The trigger half, same rule: a plugin comparing `type` against these is comparing
  // against the numbers `sections/triggers.ts` encodes, not a copy of them.
  it("hands over the trigger enumerations by identity", () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const t = api.consts.triggers;
    expect(t.condition).toBe(ConditionType);
    expect(t.action).toBe(ActionType);
    expect(t.briefingAction).toBe(BriefingActionType);
    expect(t.player).toBe(PlayerGroup);
    expect(t.comparison).toBe(Comparison);
    expect(t.switchState).toBe(SwitchState);
    expect(t.switchAction).toBe(SwitchAction);
    expect(t.modifier).toBe(SetModifier);
    expect(t.unitState).toBe(TriggerUnitState);
    expect(t.order).toBe(Order);
    expect(t.alliance).toBe(AllianceStatus);
    expect(t.resource).toBe(ResourceType);
    expect(t.score).toBe(ScoreType);
    expect(t.unitClass).toBe(UnitClass);
    expect(t.conditionFlags).toBe(ConditionFlag);
    expect(t.actionFlags).toBe(ActionFlag);
    expect(t.triggerFlags).toBe(TriggerFlag);
    expect(t.deathsTable).toBe(DEATHS_TABLE_ADDRESS);
  });

  // Every argument group is keyed by `ArgDef.kind`, which is what lets a generic argument
  // editor look one up with the kind the def handed it.
  it("keys the argument enumerations by the def's own `kind`", () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const t = api.consts.triggers as unknown as Record<string, unknown>;
    const kinds = new Set(api.triggers.defs.conditions().concat(api.triggers.defs.actions() as never[])
      .flatMap((d) => d.args.map((a) => a.kind)));
    const enumerated = ["comparison", "switchState", "switchAction", "modifier", "unitState", "order", "alliance", "resource", "score"];
    for (const kind of enumerated) {
      expect(kinds.has(kind as never), `${kind} is no longer an ArgKind`).toBe(true);
      expect(t[kind], `consts.triggers.${kind}`).toBeTypeOf("object");
    }
  });

  // What it is for: building a record without a magic number in the plugin, and reading
  // it back through the editor's own codec.
  it("is enough to write a trigger without a magic number", () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const t = api.consts.triggers;
    const result = api.document.update("add", (tx) => {
      const trigger = api.triggers.newTrigger([t.player.Player1]);
      const cond = api.triggers.newCondition(t.condition.CountdownTimer);
      cond.comparison = t.comparison.AtMost;
      cond.amount = 30;
      trigger.conditions[0] = cond;
      const say = api.triggers.newAction(t.action.DisplayText);
      say.text = tx.strings.intern("30 seconds remaining");
      trigger.actions[0] = say;
      trigger.actions[1] = api.triggers.newAction(t.action.PreserveTrigger);
      tx.triggers.add(trigger);
    });
    expect(result.sections).toContain("TRIG");
    const added = api.triggers.list().at(-1)!;
    expect(api.triggers.isPreserved(added)).toBe(true);
    expect(api.names.condition(added.conditions[0]!.type)).toBe("Countdown Timer");
    expect(api.names.action(added.actions[0]!.type)).toBe("Display Text Message");
    expect(api.names.string(added.actions[0]!.text)).toBe("30 seconds remaining");
  });

  // What the group is for, end to end: a record the plugin builds itself reads back the
  // way the editor reads it, with no literal in the plugin.
  it("is enough to write a unit and a sprite record without a hex literal", () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const c = api.consts;
    api.document.edit("place", (tx) => {
      tx.placeUnit(c.unit.mineralFields[0], 0, 2 * c.tile, 2 * c.tile);
      tx.placeSprite("pure", 1, 3 * c.tile, 3 * c.tile);
    });
    const scn = store.get(scenarioAtom)!;
    const unit = scn.units[scn.units.length - 1]!;
    expect(unit.validStates & c.unit.used.Resources).toBeTruthy();
    expect(unit.resourceAmount).toBe(c.unit.defaultMinerals);
    const sprite = scn.sprites[scn.sprites.length - 1]!;
    expect(sprite.flags & c.sprite.flags.PureSprite).toBeTruthy();
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
    // The bare chk is the serialisation; the archive is what Save writes for a new map (PKWARE, encrypted), so it is the smaller one.
    expect(chk!.size).toBe(serializeScenario(scn).length);
    expect(file!.size).toBeGreaterThan(0);
    expect(file!.size).toBeLessThan(chk!.size);

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

  // TypeScript refuses an async builder (`Sync` in api.ts); a plain-JavaScript plugin
  // gets told here instead of through an undo entry that holds half the work.
  it("says so when a builder is async", () => {
    const { store, scn } = blankStore();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const build = (async (tx: EditTransaction) => { tx.setTile(0, 0, 0x21); await Promise.resolve(); }) as (tx: EditTransaction) => unknown;
    const result = runTransaction(store, "async", build);
    expect(result.notes.some((n) => /async/.test(n))).toBe(true);
    expect(errors).toHaveBeenCalled();
    expect(scn.tiles[0]).toBe(0x21); // what ran before the await is still in the entry
    errors.mockRestore();

    const errors2 = vi.spyOn(console, "error").mockImplementation(() => {});
    const update = runUpdate(store, "async", (() => Promise.resolve()) as () => unknown);
    expect(update.notes.some((n) => /async/.test(n))).toBe(true);
    errors2.mockRestore();
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

describe("plugin settings", () => {
  const apiOf = (store: ReturnType<typeof createStore>) => createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());

  it("reads and patches players and forces as one transaction", () => {
    const { store, scn } = blankStore();
    const api = apiOf(store);
    expect(api.settings.players()).toHaveLength(12);
    expect(api.settings.player(0)?.force).toBe(0);
    expect(api.settings.player(9)?.color).toBeNull();
    const result = api.document.update("players", (tx) => {
      expect(tx.players.set(0, { type: 5, race: 2, color: 3, force: 1 })).toBe(true);
      expect(tx.players.set(0, { type: 5 })).toBe(false); // already that
      expect(tx.players.set(1, { rgb: [10, 20, 30] })).toBe(true);
      expect(tx.forces.set(1, { name: "Attackers", allied: true, sharedVision: true, players: [2] })).toBe(true);
      expect(tx.forces.set(1, { allied: true })).toBe(false);
      expect(tx.players.list()[2].force).toBe(1);
    });
    expect(result.changed).toBe(true);
    expect(result.sections.sort()).toEqual(["COLR", "CRGB", "FORC", "IOWN", "OWNR", "SIDE", "STR "]);
    const p0 = api.settings.player(0)!;
    expect([p0.type, p0.race, p0.color, p0.force, p0.forceName]).toEqual([5, 2, 3, 1, "Attackers"]);
    expect(api.settings.player(1)?.rgb).toEqual([10, 20, 30]);
    const f1 = api.settings.forces()[1];
    expect(f1.allied && f1.sharedVision && !f1.alliedVictory).toBe(true);
    expect(f1.players.sort()).toEqual([0, 2]);
    expect(scn.dirty.has("FORC")).toBe(true);
    // Back to the palette colour on every slot drops CRGB again.
    api.document.update("palette", (tx) => { tx.players.set(1, { rgb: null }); });
    expect(scn.playerRgb).toBeNull();
    expect(api.settings.player(1)?.rgb).toBeNull();
  });

  it("patches unit types, upgrades and technologies, seeding untouched rows and marking the revision's sections", () => {
    const { store, scn } = blankStore();
    const api = apiOf(store);
    const before = api.settings.unitType(0)!;
    expect(before.useDefault).toBe(true);
    expect(before.name).toBe("Terran Marine");
    const result = api.document.update("marine", (tx) => {
      expect(tx.unitTypes.set(0, { hitPoints: 55, name: "Grunt", available: [{ player: 0, value: false }, { player: "default", value: true }] })).toBe(true);
      expect(tx.unitTypes.get(0).useDefault).toBe(false);
      expect(tx.upgrades.set(0, { mineralCost: 150, levels: [{ player: 1, start: 1, max: 2 }, { player: "default", max: 3 }] })).toBe(true);
      expect(tx.techs.set(0, { energyCost: 75, state: [{ player: 0, researched: true }] })).toBe(true);
      expect(tx.techs.set(0, { energyCost: 75 })).toBe(false);
    });
    expect(result.changed).toBe(true);
    // A new map is Brood War: the x layouts are what get written.
    expect(result.sections.sort()).toEqual(["PTEx", "PUNI", "PUPx", "STR ", "TECx", "UNIx", "UPGx"]);
    const marine = api.settings.unitType(0)!;
    expect(marine.hitPoints).toBe(55);
    expect(marine.name).toBe("Grunt");
    expect(marine.customName).toBe("Grunt");
    expect(marine.availability.players[0]).toBe(false);
    expect(marine.availability.players[1]).toBe("default");
    expect(scn.unitSettings!.hitPoints[0]).toBe(55 * 256);
    const armor = api.settings.upgrade(0)!;
    expect(armor.useDefault).toBe(false);
    expect(armor.mineralCost).toBe(150);
    expect(armor.levels.players[1]).toEqual({ start: 1, max: 2, usesDefault: false });
    expect(armor.levels.players[0].usesDefault).toBe(true);
    expect(armor.levels.defaultMax).toBe(3);
    const stim = api.settings.tech(0)!;
    expect(stim.energyCost).toBe(75);
    expect(stim.state.players[0].researched).toBe(true);
    expect(stim.state.players[1].usesDefault).toBe(true);
    // Back on the defaults: the stored row stays, the flag flips.
    api.document.update("default", (tx) => { expect(tx.unitTypes.set(0, { useDefault: true })).toBe(true); });
    expect(api.settings.unitType(0)!.useDefault).toBe(true);
    expect(api.settings.unitTypes().length).toBeGreaterThan(200);
    expect(api.settings.upgrades().every((u) => u.name)).toBe(true);
    expect(api.settings.techs().every((t) => t.name)).toBe(true);
  });

  it("adds and removes sounds with their archive members, and changes the map version", () => {
    const { store, scn } = blankStore();
    const api = apiOf(store);
    expect(api.settings.version()?.version).toBe("broodwar");
    const result = api.document.update("sounds", (tx) => {
      expect(tx.sounds.add("alarm.wav", new Uint8Array([1, 2, 3]))).toBe(0);
      expect(tx.sounds.add("alarm.wav")).toBe(0); // already listed
      expect(tx.sounds.add("staredit\\wav\\second.wav")).toBe(1);
      tx.setVersion("remastered");
    });
    expect(result.sections.sort()).toEqual(["STR ", "STRx", "VER ", "WAV "]);
    const sounds = api.settings.sounds();
    expect(sounds.map((s) => s.path)).toEqual(["staredit\\wav\\alarm.wav", "staredit\\wav\\second.wav"]);
    expect(sounds[0].present).toBe(true);
    expect(sounds[1].present).toBe(false);
    expect(api.document.extras.list()).toContain("staredit\\wav\\alarm.wav");
    expect(api.settings.version()).toMatchObject({ version: "remastered", extendedStrings: true, fileVersion: 206 });
    expect(scn.strings.extended).toBe(true);
    api.document.update("drop", (tx) => { expect(tx.sounds.remove(0, true)).toBe(true); expect(tx.sounds.remove(0)).toBe(false); });
    expect(api.settings.sounds().map((s) => s.slot)).toEqual([1]);
    expect(api.document.extras.list()).not.toContain("staredit\\wav\\alarm.wav");
    expect(api.document.update("same", (tx) => { tx.setVersion("remastered"); }).changed).toBe(false);
  });

  it("resizes the map as a transaction that drops the history", () => {
    const { store, scn } = blankStore(8, 6);
    const api = apiOf(store);
    api.document.edit("unit", (tx) => { tx.addUnits([tx.makeUnit(0, 0, 7 * 32 + 16, 5 * 32 + 16)]); });
    expect(api.document.history().undoDepth).toBe(1);
    const r = api.document.resize({ width: 6, height: 6, anchor: 0 });
    expect(r).toMatchObject({ dx: 0, dy: 0, unitsDropped: 1 });
    expect(scn.width).toBe(6);
    expect(api.document.info()?.width).toBe(6);
    expect(api.document.history()).toEqual({ undo: null, redo: null, undoDepth: 0, redoDepth: 0 });
    expect(store.get(mapModifiedAtom)).toBe(true);
    expect(createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions()).document.resize({ width: 4, height: 4 })).toBeNull();
    expect(api.settings.version()).not.toBeNull();
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

  it("ships scmscx.com, Repair, Walkability, Terrain from Image and Paint on, pinned to a version", () => {
    // Which five, in which order, and all on — the versions deliberately not, since every
    // plugin release would otherwise have to come back and edit this.
    expect(DEFAULT_REMOTE_PLUGINS.map((d) => pluginIdentity(d.spec))).toEqual([
      "github:scm-js/plugin-scm-scx",
      "github:scm-js/plugin-repair",
      "github:scm-js/plugin-walkability",
      "github:scm-js/plugin-image-to-terrain",
      "github:scm-js/plugin-paint",
    ]);
    expect(DEFAULT_REMOTE_PLUGINS.every((d) => d.enabled)).toBe(true);
    // The point of the pin: a released editor loads the code it was tested against, and
    // the desktop build can compile that exact version in. A default on a moving branch
    // would change under everyone who already has the editor. A version tag, not a bare
    // commit, so what it names can be read.
    for (const d of DEFAULT_REMOTE_PLUGINS) {
      expect(isPinned(d.spec), d.spec).toBe(true);
      expect(d.spec, d.spec).toMatch(/@v\d+\.\d+\.\d+$/);
    }
    // A default is an ordinary spec: it resolves to a fetchable manifest like any other,
    // at the tag it names.
    const tagOf = (spec: string) => spec.slice(spec.lastIndexOf("@") + 1);
    expect(parseSpec(DEFAULT_REMOTE_PLUGINS[0].spec)).toMatchObject({
      kind: "remote",
      manifestUrl: `https://raw.githubusercontent.com/scm-js/plugin-scm-scx/${tagOf(DEFAULT_REMOTE_PLUGINS[0].spec)}/plugin.json`,
    });
    // Whether this build bundled them (`scripts/vendor-plugins.mjs`, which the desktop
    // build runs) or fetches them, every default is in the list exactly once and under
    // the same identity — that is what stops a bundled copy appearing beside its remote.
    expect(defaultPlugins().map((d) => pluginKey(d.spec))).toEqual(DEFAULT_REMOTE_PLUGINS.map((d) => pluginKey(d.spec)));
    expect(defaultPluginSpecs()).toEqual(defaultPlugins().map((d) => d.spec));
    // A fresh editor runs all five, Walkability and Paint with the rest.
    const fresh = effectiveInstalls([]).map((p) => pluginKey(p.spec));
    expect(fresh).toContain("github:scm-js/plugin-walkability");
    expect(fresh).toContain("github:scm-js/plugin-paint");
    // scmscx.com starts on: it needs no address, and it only reaches the network when its dialog is opened.
    expect(fresh).toContain("github:scm-js/plugin-scm-scx");
    expect(effectiveInstalls([]).every((p) => p.enabled)).toBe(true);
    // Melee Wizard, Trigger Script and Section Explorer are not defaults: they are found and
    // installed through Browse Plugins.
    for (const spec of ["plugin-melee-wizard", "plugin-trigger-script", "plugin-section-explorer"]) {
      expect(defaultPluginSpecs().some((s) => s.includes(spec))).toBe(false);
    }
  });

  it("folds a stored row onto the default it belongs to, whatever version either names", () => {
    const defaults = [{ spec: "github:scm-js/plugin-repair@v1.0.0", enabled: true }];
    // The spec an older editor stored, before the defaults were pinned. Matching on the
    // string would list Repair twice and run it twice — two dialogs on every map opened.
    expect(effectiveInstalls([{ spec: "github:scm-js/plugin-repair", enabled: false }], defaults))
      .toEqual([{ spec: "github:scm-js/plugin-repair@v1.0.0", enabled: false }]);
    // A version the user pinned deliberately (the Update button) is kept: the default's
    // spec wins only over one that was never a choice.
    const sha = "a".repeat(40);
    expect(effectiveInstalls([{ spec: `github:scm-js/plugin-repair@${sha}`, enabled: true }], defaults))
      .toEqual([{ spec: `github:scm-js/plugin-repair@${sha}`, enabled: true }]);
    // A bundled copy stands in the same place, and the stored row folds onto it too.
    expect(pluginKey("github:scm-js/plugin-repair@v1.0.0")).toBe("github:scm-js/plugin-repair");
    // That is `BUILTIN_REPLACES`, which `scripts/vendor-plugins.mjs` fills in: every copy
    // this build bundled answers for the spec it was built from. The loop is empty until
    // the vendoring has run, so this is the one place a test may read it.
    for (const [name, spec] of Object.entries(BUILTIN_REPLACES)) {
      expect(pluginKey(`builtin:${name}`), name).toBe(pluginKey(spec));
    }
    // Something else entirely still follows the defaults, in the order it was added.
    expect(effectiveInstalls([{ spec: "https://x/p/", enabled: true }], defaults))
      .toEqual([{ spec: "github:scm-js/plugin-repair@v1.0.0", enabled: true }, { spec: "https://x/p/", enabled: true }]);
  });

  it("says so when a plugin nobody asked for does not load", () => {
    const rt = (spec: string, error: string, name?: string) => ({
      [spec]: { spec, status: "error" as const, manifest: name ? ({ name } as never) : null, icon: null, error, contributions: { menu: 0, contextMenu: 0, hotkeys: 0, events: 0 } },
    });
    const offline = "Failed to fetch.";
    const wanted = [
      { spec: "github:scm-js/plugin-repair@v1.0.0", enabled: true },
      { spec: "github:scm-js/plugin-paint@v1.0.0", enabled: true },
      { spec: "github:scm-js/plugin-off@v1", enabled: false },
    ];
    const runtimes = { ...rt(wanted[0].spec, offline), ...rt(wanted[1].spec, offline), ...rt(wanted[2].spec, offline) };
    const failures = pluginFailures(wanted, runtimes);
    // The one that is switched off did not fail; it was never tried.
    expect(failures.map((f) => f.name)).toEqual(["repair", "paint"]);
    let opened = 0;
    const toast = failureToast(failures, () => { opened++; });
    expect(toast).toMatchObject({ kind: "warn", title: "repair and paint did not load", ttl: 0 });
    // The message, and where they came from — which is the part that says what to do.
    expect(toast!.detail).toBe("repair: Failed to fetch. They are fetched from their repositories when the editor starts. Everything else in the editor works.");
    toast!.action!.run();
    expect(opened).toBe(1);
    // Beyond a pair they are counted: five failures offline is one problem, not five.
    const many = ["a", "b", "c", "d", "e"].map((n) => ({ spec: `github:o/plugin-${n}@v1`, enabled: true }));
    const manyRt = Object.assign({}, ...many.map((p) => rt(p.spec, offline)));
    expect(failureToast(pluginFailures(many, manyRt), () => {})!.title).toBe("5 plugins did not load");
    // A manifest that was read names the plugin properly; so does one an earlier session cached.
    expect(pluginFailures([wanted[0]], rt(wanted[0].spec, offline, "Repair"))[0].name).toBe("Repair");
    expect(pluginFailures([wanted[0]], rt(wanted[0].spec, offline), { [wanted[0].spec]: { manifest: { name: "Repair" }, icon: null, at: 0 } } as never)[0].name).toBe("Repair");
    // One that is compiled in was not fetched from anywhere, so it is not explained as if it had been.
    const builtin = [{ spec: "builtin:repair", enabled: true }];
    expect(failureToast(pluginFailures(builtin, rt("builtin:repair", "boom")), () => {})!.detail).toBe("boom. Everything else in the editor works.");
    // Nothing wrong, nothing said.
    expect(pluginFailures(wanted, {})).toEqual([]);
    expect(failureToast([], () => {})).toBeNull();
  });

  it("tells a version from a branch, and one plugin from another", () => {
    const sha = "0".repeat(40);
    expect(isPinned(`github:o/p@${sha}`)).toBe(true);
    expect(isPinned("github:o/p@v1.2.0")).toBe(true);
    expect(isPinned("github:o/p")).toBe(false);
    // Naming a branch is not pinning, however explicitly it is named.
    expect(isPinned("github:o/p@main")).toBe(false);
    expect(isPinned("github:o/p@HEAD")).toBe(false);
    expect(isPinned("https://x/p/")).toBe(false);
    expect(unpin("github:o/p@v1.2.0/sub")).toBe("github:o/p/sub");
    // The identity is the repository, whatever version is named — and only the GitHub
    // form is case-folded, since a URL's path is the server's business.
    expect(pluginIdentity("github:O/P@v1.2.0")).toBe("github:o/p");
    expect(pluginIdentity(`github:o/p@${sha}`)).toBe(pluginIdentity("github:o/p"));
    expect(pluginIdentity("https://x/P/")).toBe("https://x/P/");
  });
});

/* ── Sections and names ─────────────────────────────────── */

describe("plugin sections", () => {
  const apiOver = (store: ReturnType<typeof createStore>) => createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());

  it("lists the file Save would write, dirty sections encoded", () => {
    const { store, scn } = blankStore(4, 2);
    const api = apiOver(store);
    const list = api.document.sections.list();
    // Every section of a new map is written where APPEND_ORDER puts it — the raw ones
    // (IVE2, VCOD) among the encoded ones rather than ahead of them, as StarEdit writes it.
    expect(list.map((s) => s.name).slice(0, 6)).toEqual(["TYPE", "VER ", "IVE2", "VCOD", "IOWN", "OWNR"]);
    expect(list[0]).toMatchObject({ index: 0, offset: 0, size: 4, declaredSize: 4, truncated: false, occurrence: 0, occurrences: 1, dirty: true });
    // IVE2 is one of the four a new map carries as raw bytes: written, but not from the model.
    expect(list[2]).toMatchObject({ name: "IVE2", size: 2, dirty: false });
    expect(list[0].spec).toMatchObject({ name: "TYPE", mode: "last", size: 4, stride: null, modelled: true, what: "Map type (RAWS/RAWB/RAWU)" });
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
    api.document.sections.bytes(0)[0] = 0;
    expect(api.document.sections.bytes(0)).toEqual(new Uint8Array([0x52, 0x41, 0x57, 0x42]));
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
    expect(list[1]).toMatchObject({ name: "TYPE", offset: 11 });
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

describe("plugin sections: defaults, rebuild, trailing, required", () => {
  const apiOver = (store: ReturnType<typeof createStore>) => createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());

  it("hands out the bytes a new map writes for a section, sized for the open map", () => {
    const { store, scn } = blankStore(4, 2);
    const api = apiOver(store);
    const { sections } = api.document;
    expect(sections.defaults("VCOD")).toEqual(defaultVcod());
    expect(sections.defaults("MTXM")).toEqual(new Uint8Array(4 * 2 * 2));
    expect(sections.defaults("DIM ")).toEqual(new Uint8Array([4, 0, 2, 0]));
    expect(sections.defaults("DIM")).toEqual(new Uint8Array([4, 0, 2, 0]));
    expect(sections.defaults("UNIT")).toEqual(new Uint8Array(0));
    expect(sections.defaults("UNIx")!.length).toBe(4168);
    expect(sections.defaults("MASK")).toEqual(new Uint8Array(8).fill(0xff));
    // Follows the map's revision: an original-game file gets the original layouts and the extended-string form follows the table.
    expect(sections.defaults("UNIS")!.length).toBe(4048);
    expect(sections.defaults("STRx")).toBeNull();
    scn.strings.extended = true;
    expect(sections.defaults("STR ")).toBeNull();
    expect(sections.defaults("STRx")).not.toBeNull();
    // Unmodelled, optional-and-absent, and unknown names have no default.
    expect(sections.defaults("IVER")).toBeNull();
    expect(sections.defaults("CRGB")).toBeNull();
    expect(sections.defaults("ZZZZ")).toBeNull();
    expect(createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions()).document.sections.defaults("VCOD")).toBeNull();
    // A copy: the caller cannot change the table it came from.
    sections.defaults("VCOD")![0] = 0xaa;
    expect(sections.defaults("VCOD")![0]).toBe(defaultVcod()[0]);
  });

  it("lists the required sections for the map's revision", () => {
    const { store, scn } = blankStore(4, 2);
    const api = apiOver(store);
    expect(api.document.sections.required()).toEqual(expect.arrayContaining(["VER ", "VCOD", "MTXM", "STR ", "UNIx", "PTEx"]));
    expect(api.document.sections.required()).not.toContain("UNIS");
    scn.fileVersion = 59;
    expect(api.document.sections.required()).toEqual(expect.arrayContaining(["UNIS", "UPGR"]));
    expect(api.document.sections.required()).not.toContain("UNIx");
    scn.fileVersion = 206;
    scn.strings.extended = true;
    expect(api.document.sections.required()).toContain("STRx");
    expect(api.document.sections.required()).not.toContain("STR ");
    expect(createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions()).document.sections.required()).toEqual([]);
  });

  it("rebuilds sections from the model, collapsing repeats and fixing sizes", () => {
    const { store } = blankStore(4, 2);
    const api = apiOver(store);
    const { sections } = api.document;
    // A protected-looking file: DIM twice (the second one a fragment), an oversized ERA, a stripped TILE, and junk after a negative header.
    const file = parseChk(sections.file());
    file.sections = file.sections.filter((s) => s.name !== "TILE");
    const dim = file.sections.findIndex((s) => s.name === "DIM ");
    file.sections.splice(dim + 1, 0, { name: "DIM ", offset: -1, declaredSize: 2, data: new Uint8Array([4, 0]) });
    const era = file.sections.find((s) => s.name === "ERA ")!;
    era.data = new Uint8Array([0, 0, 0xee, 0xee]);
    era.declaredSize = 4;
    const bytes = new Uint8Array(serializeChk(file).length + 12);
    bytes.set(serializeChk(file));
    bytes.set([0x4a, 0x55, 0x4e, 0x4b, 0xff, 0xff, 0xff, 0xff, 1, 2, 3, 4], serializeChk(file).length);
    sections.replaceFile(bytes);
    expect(sections.trailing()).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(sections.list().filter((s) => s.name === "DIM ")).toHaveLength(2);
    expect(sections.list().some((s) => s.name === "TILE")).toBe(false);
    expect(sections.list().find((s) => s.name === "ERA ")!.size).toBe(4);

    let events = 0;
    api.events.on("document", () => { events++; });
    const r = sections.rebuild(["DIM ", "ERA", "TILE", "ISOM", "VCOD", "CRGB", "ZZZZ"]);
    // Modelled names with a model come back; VCOD is raw, CRGB has no model on this map, ZZZZ is nothing.
    // The junk header keeps its negative length through the rebuild (Save writes a header it did not
    // model as it found it), so the fresh parse warns about it again.
    expect(r.rebuilt).toEqual(["DIM ", "ERA ", "TILE", "ISOM"]);
    expect(r.warnings).toEqual([expect.stringMatching(/JUNK .*negative/)]);
    expect(events).toBe(1);
    const list = sections.list();
    expect(list.filter((s) => s.name === "DIM ")).toHaveLength(1);
    expect(list.find((s) => s.name === "ERA ")!.size).toBe(2);
    // TILE came back from the editor's ground tiles, at the spot APPEND_ORDER puts it —
    // between ISOM and DD2, not after the junk chunk at the end of the file.
    const names = list.map((s) => s.name);
    expect(names.slice(names.indexOf("ISOM"), names.indexOf("ISOM") + 3)).toEqual(["ISOM", "TILE", "DD2 "]);
    expect(names.indexOf("TILE")).toBeLessThan(names.indexOf("JUNK"));
    expect(sections.combined("TILE")).toEqual(sections.combined("MTXM"));
    // The junk chunk and the bytes after it are untouched by a rebuild: Save keeps what it does not model.
    expect(list.some((s) => s.name === "JUNK")).toBe(true);
    expect(sections.trailing()).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(store.get(undoStackAtom)).toEqual([]);
    expect(store.get(mapModifiedAtom)).toBe(true);
    // Everything modelled, by omission; a second pass changes nothing.
    const all = sections.rebuild();
    expect(all.rebuilt).toEqual(expect.arrayContaining(["MTXM", "UNIT", "TRIG", "STR "]));
    expect(all.rebuilt).not.toContain("STRx");
    expect(sections.file()).toEqual(sections.file());
    expect(() => createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions()).document.sections.rebuild()).toThrow(/No map/);
    expect(createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions()).document.sections.trailing()).toBeNull();
  });
});

describe("plugin document events", () => {
  it("says why the document changed and which file it is", () => {
    const store = createStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const seen: unknown[] = [];
    api.events.on("document", (e) => { seen.push(e); });
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 4, height: 2, era: 0, name: "a" }), extras: new Map(), fileName: "a.scx" });
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 4, height: 2, era: 0, name: "b" }), extras: new Map(), fileName: null, reason: "new" });
    api.document.sections.write(api.document.sections.list().findIndex((s) => s.name === "DIM "), new Uint8Array([6, 0, 3, 0]));
    store.set(closeDocumentAtom);
    expect(seen).toEqual([
      { reason: "open", fileName: "a.scx" },
      { reason: "new", fileName: null },
      { reason: "replace", fileName: null },
      { reason: "close", fileName: null },
    ]);
    // A scenario installed behind the writers' backs is still an open, and the other events carry nothing.
    let payload: unknown = "unset";
    api.events.on("terrain", (...args: unknown[]) => { payload = args[0]; });
    store.set(scenarioAtom, createScenario({ width: 4, height: 2, era: 0, name: "c" }));
    expect(seen.at(-1)).toEqual({ reason: "open", fileName: null });
    api.document.edit("t", (tx) => tx.setTile(0, 0, 5));
    expect(payload).toMatchObject({ reason: "open" });
  });
});

describe("plugin game data", () => {
  it("answers the game's own set with nothing resolved, and switches through the chain", async () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.gameData.source()).toBeNull();
    expect(api.gameData.profile()).toEqual({ id: "starcraft", name: "StarCraft: Brood War" });
    expect(await api.gameData.profiles()).toEqual([{ id: "starcraft", name: "StarCraft: Brood War" }]);
    await expect(api.gameData.select("Not An Id")).rejects.toThrow(/not a data set id/);
    let events = 0;
    api.events.on("gameData", () => events++);
    // Under Node the chain finds nothing: the switch still lands, with the set falling back to the game's own.
    const source = await api.gameData.select("some-mod");
    expect(source.kind).toBe("none");
    expect(source.profile.id).toBe("starcraft");
    expect(api.gameData.source()).toEqual(source);
    expect(events).toBeGreaterThan(0);
    expect(await api.gameData.remove("some-mod")).toBe(false);
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

describe("plugin text codes", () => {
  const RED = "\x06";
  const WHITE = "\x04";

  it("hands over the editor's own table", () => {
    const api = createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions());
    const codes = api.text.codes();
    expect(codes[0].byte).toBe(0x01);
    expect(codes.at(-1)!.byte).toBe(0x1f);
    expect(api.text.code(0x06)).toMatchObject({ code: "<06>", effect: "color", rgb: "#c81818" });
    // The numbering that was wrong before it was checked against the player palette.
    expect(api.text.code(0x12)).toMatchObject({ effect: "align" });
    expect(api.text.code(0x18)).toMatchObject({ rgb: "#088008", player: 9 });
    expect(api.text.code(0x20)).toBeNull();
    expect(api.text.escape(0x0e)).toBe("<0E>");
    expect(api.text.defaultColor()).toBe("#b8b8e8");
    // The button set leaves out whitespace and the byte that does nothing.
    expect(api.text.insertable().map((c) => c.byte)).not.toContain(0x0a);
    expect(api.text.insertable().map((c) => c.byte)).not.toContain(0x1a);
  });

  it("reads a string the way the game draws it, under either game's rule", () => {
    const api = createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions());
    const text = `${RED}Objective:\nDestroy the base`;
    expect(api.text.plain(text)).toBe("Objective:\nDestroy the base");
    // Remastered carries the colour on; 1.16.1 reset it at the break.
    expect(api.text.runs(text)[1].runs[0].color).toBe("#c81818");
    expect(api.text.runs(text, { resetPerLine: true })[1].runs[0].color).toBe("#b8b8e8");
  });

  it("finds and fixes the lines Remastered recoloured", () => {
    const api = createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.text.bleedingLines(`${RED}a\nb`)).toMatchObject([{ line: 1, carried: { code: "<06>", rgb: "#c81818" } }]);
    expect(api.text.bleedingLines(`${RED}a\n${WHITE}b`)).toEqual([]);
    const fixed = api.text.fixBleeding(`${RED}a\nb`);
    expect(fixed).toBe(`${RED}a\n\x02b`);
    expect(api.text.bleedingLines(fixed)).toEqual([]);
    // Both games now draw it alike, which is the whole point.
    const colors = (resetPerLine: boolean) => api.text.runs(fixed, { resetPerLine }).map((l) => l.runs.map((r) => r.color));
    expect(colors(false)).toEqual(colors(true));
  });

  it("needs no map", () => {
    const api = createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions());
    expect(() => api.text.runs("anything")).not.toThrow();
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

/** The `/tags` answer for a repository, newest-release-first order deliberately not assumed. */
function taggedFiles(owner: string, repo: string, tags: [string, string][]) {
  return {
    [`https://api.github.com/repos/${owner}/${repo}/tags?per_page=100`]: JSON.stringify(tags.map(([name, sha]) => ({ name, commit: { sha } }))),
  };
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OLDER = "1111111111111111111111111111111111111111";

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
      built: false,
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

  it("checks for an update by commit, so a tag-pinned install is not offered its own code", async () => {
    const files = githubFiles("o", "preview", SHA, { name: "Preview", version: "1.1" });
    // The tag the install names resolves to the same commit the branch holds.
    files[`https://api.github.com/repos/o/preview/commits/v1.0`] = JSON.stringify({ sha: SHA });
    const { deps, asked } = servedDeps(files);

    const onTag = await checkForUpdate("github:o/preview@v1.0", deps);
    expect(onTag.current).toBe(SHA);
    // Comparing specs would say "newer" here for ever: `@v1.0` is never spelt like a hash.
    expect(onTag.newer).toBe(false);
    expect(onTag.preview.manifest?.name).toBe("Preview");

    // A hash-pinned install answers for itself: no second request to resolve the ref.
    asked.length = 0;
    const onSha = await checkForUpdate(`github:o/preview@${SHA}`, deps);
    expect(onSha).toMatchObject({ current: SHA, newer: false });
    expect(asked.filter((u) => u.includes("/commits/"))).toEqual(["https://api.github.com/repos/o/preview/commits/HEAD"]);
  });

  it("offers the update when the branch has moved past the installed commit", async () => {
    const older = "1111111111111111111111111111111111111111";
    const { deps } = servedDeps(githubFiles("o", "preview", SHA, { name: "Preview", version: "1.2" }));
    const check = await checkForUpdate(`github:o/preview@${older}`, deps);
    expect(check).toMatchObject({ current: older, newer: true });
    expect(check.preview.pin?.spec).toBe(`github:o/preview@${SHA}`);
  });

  it("falls back to comparing specs when the installed ref cannot be resolved", async () => {
    // The tag is gone from the repository; the branch still answers.
    const { deps } = servedDeps(githubFiles("o", "preview", SHA, { name: "Preview" }));
    const check = await checkForUpdate("github:o/preview@v9", deps);
    // Erring towards offering the update rather than hiding one.
    expect(check).toMatchObject({ current: null, newer: true });
  });

  it("ranks release tags itself, since GitHub's tag order is not version order", () => {
    expect(tagVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(tagVersion("1.2")).toEqual([1, 2, 0]);
    // A release candidate is not a release: an update check offers what the author published.
    expect(tagVersion("v1.2.3-rc.1")).toBeNull();
    expect(tagVersion("nightly")).toBeNull();
    const tag = (name: string) => ({ name, ref: name });
    expect(newestTag([tag("v1.9.0"), tag("v1.10.0"), tag("v1.2.0")])?.name).toBe("v1.10.0");
    expect(newestTag([tag("v2.0.0-rc.1"), tag("v1.4.2")])?.name).toBe("v1.4.2");
    expect(newestTag([tag("nightly"), tag("latest")])).toBeNull();
    expect(newestTag([])).toBeNull();
  });

  it("reads the tags of a repository, and steps over anything that is not one", async () => {
    const url = "https://api.github.com/repos/o/preview/tags?per_page=100";
    const { deps } = servedDeps({ [url]: JSON.stringify([
      { name: "v1.1.0", commit: { sha: SHA } },
      { name: "broken", commit: {} },
      { nope: true },
    ]) });
    expect(await listTags({ owner: "o", repo: "preview" }, deps.fetchText)).toEqual([{ name: "v1.1.0", ref: SHA }]);
    // A repository that will not answer is "no releases to compare", never a failed check.
    const { deps: empty } = servedDeps({});
    await expect(listTags({ owner: "o", repo: "preview" }, empty.fetchText)).rejects.toThrow(PluginLoadError);
  });

  it("asks the newest release, not the branch, so a commit landing after the tag is not an update", async () => {
    // The state that made every editor offer an update to the code it was already running:
    // the pinned tag is the newest release, but main has a documentation commit on top.
    const moved = "2222222222222222222222222222222222222222";
    const { deps, asked } = servedDeps({
      ...taggedFiles("o", "preview", [["v1.1.2", SHA], ["v1.1.1", OLDER]]),
      ...githubFiles("o", "preview", moved, { name: "Preview", version: "1.1.2" }),
      [`https://raw.githubusercontent.com/o/preview/${SHA}/plugin.json`]: JSON.stringify({ name: "Preview", version: "1.1.2" }),
    });

    const check = await checkForUpdate("github:o/preview@v1.1.2", deps);
    expect(check).toMatchObject({ tag: "v1.1.2", current: SHA, newer: false });
    expect(check.preview.manifest?.version).toBe("1.1.2");
    // The branch was never asked, and neither was the tag: the tag list carried both commits.
    expect(asked.filter((u) => u.includes("/commits/"))).toEqual([]);
  });

  it("offers a release that really is newer, and names it by its tag", async () => {
    const { deps } = servedDeps({
      // Out of order on purpose: the API's order is not the ranking.
      ...taggedFiles("o", "preview", [["v1.1.2", OLDER], ["v1.2.0", SHA]]),
      [`https://raw.githubusercontent.com/o/preview/${SHA}/plugin.json`]: JSON.stringify({ name: "Preview", version: "1.2.0" }),
    });
    const check = await checkForUpdate("github:o/preview@v1.1.2", deps, { version: "1.1.2" });
    expect(check).toMatchObject({ tag: "v1.2.0", current: OLDER, newer: true });
    // What a confirmation would install, and the tag it would show for it.
    expect(check.preview.spec).toBe("github:o/preview@v1.2.0");
    expect(check.preview.pin?.spec).toBe(`github:o/preview@${SHA}`);
  });

  it("takes the running version as the last word on whether a release is a new one", async () => {
    // A retagged release: a different commit under a version already installed. Offering it
    // would print "Update to v1.1.2" on a row reading v1.1.2, which is no answer at all.
    const { deps } = servedDeps({
      ...taggedFiles("o", "preview", [["v1.1.2", SHA]]),
      [`https://raw.githubusercontent.com/o/preview/${SHA}/plugin.json`]: JSON.stringify({ name: "Preview", version: "1.1.2" }),
    });
    const spec = `github:o/preview@${OLDER}`;
    expect(await checkForUpdate(spec, deps, { version: "1.1.2" })).toMatchObject({ newer: false });
    // Without it the commits still disagree, which is what the backstop is behind.
    expect(await checkForUpdate(spec, deps)).toMatchObject({ newer: true });
  });

  it("has an address to check for every default, bundled or not", () => {
    // The check button used to be `isPinned(spec)`, which vendoring turned off: a bundled
    // default is `builtin:paint`, so the one button that moves a plugin forward appeared on
    // every row except the ones the editor ships — and only in builds that did not vendor.
    for (const d of defaultPlugins()) {
      const address = updateAddress(d.spec);
      expect(address, d.spec).not.toBeNull();
      expect(pluginKey(address!), d.spec).toBe(pluginKey(d.spec));
      expect(isPinned(address!), d.spec).toBe(true);
    }
    // A plugin that follows a branch has no update to check for — Reload is its update.
    expect(updateAddress("github:o/p")).toBeNull();
    expect(updateAddress("github:o/p@main")).toBeNull();
    expect(updateAddress("https://example.com/p/plugin.json")).toBeNull();
    expect(updateAddress("builtin:not-vendored-here")).toBeNull();
    expect(updateAddress("github:o/p@v1.2.0")).toBe("github:o/p@v1.2.0");
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
    expect(addressesOf(parseSpec("builtin:hello"), null)).toEqual({ manifestUrl: null, entryUrl: null, built: false, base: null, webUrl: null });
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
    // A submenu that does not exist is made for the plugin, at the end after a separator.
    expect(merged[0].items.map((i) => (i.kind === "item" ? i.label : i.kind === "sub" ? `sub:${i.label}` : i.kind))).toEqual(["New", "sub:Import", "sep", "sub:Nope"]);
    expect((merged[0].items[3] as Extract<Menu["items"][number], { kind: "sub" }>).items.map((i) => (i.kind === "item" ? i.label : i.kind))).toEqual(["Deep"]);
    // A top-level menu that does not exist is made for the plugin, before Help (here: at the end).
    expect(merged.map((m) => m.label)).toEqual(["File", "Plugins", "Nowhere"]);
    expect(merged[1].items.map((i) => (i.kind === "item" ? i.label : i.kind))).toEqual(["Manage Plugins…"]);
    expect(merged[2].items.map((i) => (i.kind === "item" ? i.label : i.kind))).toEqual(["Lost"]);
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

describe("plugin overlays", () => {
  it("list in the registry, toggle through the handle and the chrome alike, redraw on request and leave with the plugin", () => {
    overlayVisibilityMemory.clear();
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    const toggles: string[] = [];
    const a = api.ui.overlay({ name: "Walkability", draw: () => {}, onToggle: (v) => toggles.push(`a:${v}`) });
    const b = api.ui.overlay({ name: "Heat", visible: false, above: "objects", draw: () => {}, onToggle: (v) => toggles.push(`b:${v}`) });
    expect(store.get(pluginOverlaysAtom).map((o) => [o.spec.name, o.visible, o.plugin.id])).toEqual([["Walkability", true, "t"], ["Heat", false, "t"]]);
    expect(a.isVisible()).toBe(true);
    expect(b.isVisible()).toBe(false);
    // The chrome writes the same atom the handle does; onToggle fires once per real change.
    const key = store.get(pluginOverlaysAtom)[0].key;
    expect(store.set(setOverlayVisibleAtom, key, false)).toBe(true);
    expect(store.set(setOverlayVisibleAtom, key, false)).toBe(false);
    a.show();
    a.show();
    b.toggle();
    b.hide();
    expect(toggles).toEqual(["a:false", "a:true", "b:true", "b:false"]);
    expect(store.get(pluginOverlaysAtom).map((o) => o.visible)).toEqual([true, false]);
    const rev = store.get(pluginOverlayRevisionAtom);
    a.redraw();
    expect(store.get(pluginOverlayRevisionAtom)).toBe(rev + 1);
    // Removed: gone from the list, its handle inert, its slot in the bag released.
    a.remove();
    a.remove();
    a.show();
    expect(a.isVisible()).toBe(false);
    expect(store.get(pluginOverlaysAtom).map((o) => o.spec.name)).toEqual(["Heat"]);
    expect(toggles).toHaveLength(4);
    bag.dispose();
    expect(store.get(pluginOverlaysAtom)).toEqual([]);
    expect(b.isVisible()).toBe(false);
  });

  it("come back the way the user left them for the session, per plugin and name", () => {
    overlayVisibilityMemory.clear();
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    api.ui.overlay({ name: "Walkability", draw: () => {} }).hide();
    bag.dispose();
    // A reload registers again: the user's choice wins over the spec's default …
    const again = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions()).ui.overlay({ name: "Walkability", draw: () => {} });
    expect(again.isVisible()).toBe(false);
    // … but not for another plugin's overlay of the same name, and a `visible` default is only that.
    const other = createPluginApi(store, { id: "u", name: "U", source: "s" }, new Contributions()).ui.overlay({ name: "Walkability", visible: false, draw: () => {} });
    expect(other.isVisible()).toBe(false);
    other.show();
    expect(store.get(pluginOverlaysAtom).map((o) => [o.plugin.id, o.visible])).toEqual([["t", false], ["u", true]]);
    overlayVisibilityMemory.clear();
  });

  it("raise the view event when one is shown or hidden", () => {
    overlayVisibilityMemory.clear();
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    let views = 0;
    api.events.on("view", () => views++);
    const o = api.ui.overlay({ name: "X", draw: () => {} });
    const before = views;
    o.hide();
    expect(views).toBe(before + 1);
    bag.dispose();
  });
});

describe("docked panels, status items, dialog slots and flashes", () => {
  it("keeps a docked panel in the same registry, marked by its spec", () => {
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    const docked = api.ui.panel({ title: "Assistant", dock: "right", grow: true, mount: () => {} });
    api.ui.panel({ title: "Float", mount: () => {} });
    expect(store.get(pluginPanelsAtom).map((p) => [p.spec.title, p.spec.dock ?? "float"])).toEqual([["Assistant", "right"], ["Float", "float"]]);
    docked.close();
    expect(store.get(pluginPanelsAtom).map((p) => p.spec.title)).toEqual(["Float"]);
    bag.dispose();
    expect(store.get(pluginPanelsAtom)).toEqual([]);
  });

  it("adds a status bar cell, patches it through the handle, and removes it with the plugin", () => {
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    const item = api.ui.statusItem({ text: "AI · idle" });
    expect(store.get(pluginStatusItemsAtom).map((e) => [e.plugin.id, e.spec.text, e.spec.busy])).toEqual([["t", "AI · idle", undefined]]);
    item.set({ text: "AI · working", busy: true });
    expect(store.get(pluginStatusItemsAtom)[0].spec).toEqual({ text: "AI · working", busy: true });
    item.set({ busy: false });
    expect(store.get(pluginStatusItemsAtom)[0].spec).toEqual({ text: "AI · working", busy: false });
    expect(item.isShown()).toBe(true);
    const other = api.ui.statusItem({ text: "2" });
    item.remove();
    item.remove();
    item.set({ text: "gone" });
    expect(store.get(pluginStatusItemsAtom).map((e) => e.spec.text)).toEqual(["2"]);
    expect(item.isShown()).toBe(false);
    bag.dispose();
    expect(other.isShown()).toBe(false);
    expect(store.get(pluginStatusItemsAtom)).toEqual([]);
  });

  it("registers a dialog slot per dialog id and takes it back on dispose", () => {
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    const a = api.ui.dialogSlot("mapProperties", { mount: () => {} });
    api.ui.dialogSlot("textTriggerEditor", { mount: () => {} });
    expect(store.get(pluginDialogSlotsAtom).map((e) => [e.plugin.id, e.dialog])).toEqual([["t", "mapProperties"], ["t", "textTriggerEditor"]]);
    a.dispose();
    expect(store.get(pluginDialogSlotsAtom).map((e) => e.dialog)).toEqual(["textTriggerEditor"]);
    bag.dispose();
    expect(store.get(pluginDialogSlotsAtom)).toEqual([]);
  });

  it("turns a flash target into boxes in map pixels, clamped, and forgets expired ones", () => {
    const { store, scn } = blankStore(8, 6);
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    api.view.flash({ rect: { x0: -2, y0: 1, x1: 3, y1: 99 } });
    let list = store.get(viewFlashesAtom);
    expect(list.map((f) => [f.box, f.kind, f.ms])).toEqual([[{ left: 0, top: 32, right: 96, bottom: 192 }, "change", 600]]);
    // Units by index: the placement box round the unit; a missing index is skipped.
    api.document.edit("unit", (tx) => { tx.addUnits([tx.makeUnit(0, 0, 100, 100)]); });
    expect(scn.units.length).toBe(1);
    api.view.flash({ units: [0, 7], kind: "attention", ms: 100 });
    list = store.get(viewFlashesAtom);
    expect(list.length).toBe(2);
    expect(list[1].kind).toBe("attention");
    expect(list[1].box.left).toBeLessThan(100);
    expect(list[1].box.right).toBeGreaterThan(100);
    // Locations: slot 63 (Anywhere) and unused slots are skipped; tiles are one box each.
    api.view.flash({ locations: [63, 5] });
    expect(store.get(viewFlashesAtom).length).toBe(2);
    api.view.flash({ tiles: [{ x: 1, y: 1 }, { x: 99, y: 0 }] });
    expect(store.get(viewFlashesAtom).at(-1)?.box).toEqual({ left: 32, top: 32, right: 64, bottom: 64 });
    // A new flash sweeps the expired ones; nothing to flash writes nothing.
    const stale = store.get(viewFlashesAtom).map((f) => ({ ...f, start: f.start - 10_000 }));
    store.set(viewFlashesAtom, stale);
    api.view.flash({ rect: { x0: 0, y0: 0, x1: 1, y1: 1 } });
    expect(store.get(viewFlashesAtom).length).toBe(1);
    api.view.flash({ rect: { x0: 5, y0: 5, x1: 5, y1: 5 } });
    expect(store.get(viewFlashesAtom).length).toBe(1);
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
    // The palette's snap is on by default, so a non-building lands on the tile centre.
    expect(scn.units[0]).toMatchObject({ unitId: 0, owner: 2, x: 48, y: 48 });
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

  it("rebuilds the ISOM from the tiles and measures it", async () => {
    const { store, scn } = jungleStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const good = await api.terrain.checkIsom();
    expect(good).toMatchObject({ stale: false, mismatched: 0, inherent: 0 });
    expect(good!.rects).toBeGreaterThan(0);
    // Matching already: nothing to change, no undo entry.
    const same = api.document.edit("same", (tx) => { expect(tx.rebuildIsom()).toMatchObject({ created: false, changed: 0 }); });
    expect(same.changed).toBe(false);
    // A stripped ISOM comes back from the tiles as one entry that undo removes again.
    const lattice = scn.isom!;
    scn.isom = null;
    expect(api.terrain.hasIsom()).toBe(false);
    expect(await api.terrain.checkIsom()).toBeNull();
    const created = api.document.edit("rebuild", (tx) => {
      const r = tx.rebuildIsom()!;
      expect(r.created).toBe(true);
      expect(r.diamonds).toBeGreaterThan(0);
      expect(r.changed).toBe(lattice.length);
    });
    expect(created).toMatchObject({ changed: true, isom: lattice.length });
    expect(api.terrain.hasIsom()).toBe(true);
    expect(scn.isom).toEqual(lattice);
    expect(scn.dirty.has("ISOM")).toBe(true);
    expect(store.get(undoStackAtom).at(-1)).toMatchObject({ label: "rebuild", createdIsom: lattice });
    store.set(undoAtom);
    expect(scn.isom).toBeNull();
    store.set(redoAtom);
    expect(scn.isom).toEqual(lattice);
    // A lattice put out of step by a flat stamp is corrected diamond by diamond.
    const other = api.terrain.types().find((t) => t.id !== 2 && api.terrain.isomTypes().includes(t.id))!;
    api.document.edit("stamp", (tx) => { tx.stampTerrain({ x0: 4, y0: 4, x1: 12, y1: 12 }, other.id); });
    const stale = await api.terrain.checkIsom();
    expect(stale!.mismatched).toBeGreaterThan(0);
    expect(stale).toMatchObject({ stale: true });
    expect(stale!.inherent).toBeLessThan(stale!.mismatched);
    // A rebuild over an existing lattice bumps the ISOM revision, so the palette's badge
    // and Check Map re-measure: without that they kept saying "stale" after the repair.
    const revision = store.get(isomRevisionAtom);
    const fixed = api.document.edit("fix", (tx) => { expect(tx.rebuildIsom()).toMatchObject({ created: false }); });
    expect(fixed.isom).toBeGreaterThan(0);
    expect(store.get(undoStackAtom).at(-1)).toMatchObject({ label: "fix", rebuiltIsom: true });
    expect(store.get(isomRevisionAtom)).toBe(revision + 1);
    store.set(undoAtom);
    expect(store.get(isomRevisionAtom)).toBe(revision + 2);
    store.set(redoAtom);
    expect(store.get(isomRevisionAtom)).toBe(revision + 3);
    // And the repair does not survive itself: what is left is what no lattice describes.
    const after = (await api.terrain.checkIsom())!;
    expect(after.mismatched).toBeLessThan(stale!.mismatched);
    expect(after).toMatchObject({ stale: false });
    expect(after.inherent).toBe(after.mismatched);
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

/* ── Registries ─────────────────────────────────────────── */

const REGISTRY_URL = DEFAULT_REGISTRIES[0];

const indexOf = (...plugins: unknown[]) => JSON.stringify({ format: 1, name: "Test registry", plugins });

/** A `fetchText` serving fixed bodies, counting the calls per URL. */
function servedText(files: Record<string, string>) {
  const asked: string[] = [];
  const fetchText = async (url: string) => {
    asked.push(url);
    const body = files[url];
    if (body === undefined) throw new Error(`404 ${url}`);
    return body;
  };
  return { fetchText, asked };
}

describe("plugin registries", () => {
  it("reads an index, canonicalises specs and drops what it cannot use", () => {
    const registry = parseRegistry(
      {
        name: "Test registry",
        generated: "2026-09-02T00:00:00Z",
        plugins: [
          { spec: "https://github.com/o/one", name: "One", version: "1.0", tags: ["terrain", 7], api: 1 },
          // The same plugin under its other spelling: one row, the first one.
          { spec: "github:o/one", name: "One again" },
          { name: "No spec" },
          { spec: "not a location", name: "Unusable" },
          { spec: "github:o/two", name: "  Two  ", description: " ", unknown: "ignored" },
        ],
      },
      REGISTRY_URL,
    );
    expect(registry.name).toBe("Test registry");
    expect(registry.skipped).toBe(3);
    expect(registry.plugins).toEqual([
      { spec: "github:o/one", name: "One", version: "1.0", tags: ["terrain"], api: 1 },
      { spec: "github:o/two", name: "Two" },
    ]);
    expect(() => parseRegistry({ plugins: "no" }, REGISTRY_URL)).toThrow(RegistryError);
  });

  it("drops a field the index carries that is not a string", () => {
    const registry = parseRegistry(
      {
        plugins: [
          { spec: "github:o/one", name: "One", version: "1.0.0", author: "A" },
          { spec: "github:o/odd", name: "Odd", author: true },
          { spec: "github:o/blank", name: "Blank", author: "  " },
        ],
      },
      REGISTRY_URL,
    );
    expect(registry.plugins).toEqual([
      { spec: "github:o/one", name: "One", version: "1.0.0", author: "A" },
      { spec: "github:o/odd", name: "Odd" },
      { spec: "github:o/blank", name: "Blank" },
    ]);
  });

  it("resolves an entry's icon against the plugin's own files", () => {
    expect(entryIcon({ spec: "github:o/p", name: "P", icon: "icon.svg" }))
      .toEqual({ kind: "image", url: "https://raw.githubusercontent.com/o/p/HEAD/icon.svg" });
    expect(entryIcon({ spec: "github:o/p", name: "P", icon: "\u{1f3a8}" })).toEqual({ kind: "text", text: "\u{1f3a8}" });
    expect(entryIcon({ spec: "github:o/p", name: "P", icon: "javascript:alert(1)" })).toBeNull();
    expect(entryIcon({ spec: "github:o/p", name: "P" })).toBeNull();
  });

  it("searches name, tags, description and author, best match first", () => {
    const entries: RegistryEntry[] = [
      { spec: "github:o/a", name: "Walkability", description: "Shows where units can walk.", tags: ["analysis"] },
      { spec: "github:o/b", name: "Paint", description: "Drawing tools for terrain.", author: "Jeany" },
      { spec: "github:o/c", name: "Terrain from Image", description: "Turns a picture into terrain." },
    ];
    expect(searchRegistry(entries, "").length).toBe(3);
    // A name beats a description: "Terrain from Image" before "Paint", which only mentions terrain.
    expect(searchRegistry(entries, "terrain").map((e) => e.name)).toEqual(["Terrain from Image", "Paint"]);
    expect(searchRegistry(entries, "analysis").map((e) => e.name)).toEqual(["Walkability"]);
    expect(searchRegistry(entries, "jeany").map((e) => e.name)).toEqual(["Paint"]);
    // Every word has to match something.
    expect(searchRegistry(entries, "terrain picture").map((e) => e.name)).toEqual(["Terrain from Image"]);
    expect(searchRegistry(entries, "terrain nothing")).toEqual([]);
  });

  it("splits the browse list by what is installed already, keeping each group's order", () => {
    const entries: RegistryEntry[] = [
      { spec: "github:o/a", name: "A" },
      { spec: "github:o/b", name: "B" },
      { spec: "github:o/c", name: "C" },
      { spec: "github:o/d", name: "D" },
    ];
    const here: Record<string, InstallState> = { "github:o/b": "installed", "github:o/d": "disabled" };
    const groups = groupByInstall(entries, (e) => here[e.spec] ?? "new");
    // Turned off still counts as installed — the row's action is Turn on, never Install.
    expect(groups.available.map((e) => e.name)).toEqual(["A", "C"]);
    expect(groups.installed.map((e) => e.name)).toEqual(["B", "D"]);
    expect(groupByInstall([], () => "new")).toEqual({ available: [], installed: [] });
  });

  it("adds a row for an installed plugin no registry lists, and none for one they do", () => {
    const listed: RegistryEntry[] = [
      { spec: "github:scm-js/plugin-paint", name: "Paint", version: "1.0.1" },
      { spec: "github:scm-js/plugin-repair", name: "Repair" },
    ];
    // `pluginKey` folds a bundled copy onto the spec it was vendored from by reading the
    // generated `plugins/` tree, which a fresh clone has not got — and neither has CI,
    // where the tests run before the build vendors anything. `unlistedInstalls` takes the
    // key function rather than importing it for exactly that reason, so this stands in for
    // a build that bundled Repair and the test says the same thing either way.
    const key = (spec: string) => pluginKey(spec === "builtin:repair" ? "github:scm-js/plugin-repair" : spec);
    // The identity a spec is matched on: the plugin, not the version of it that is installed.
    const rows = unlistedInstalls(
      [
        // Installed pinned, and bundled — both are Paint, which is listed. Neither is added.
        { spec: "github:scm-js/plugin-paint@v1.0.1", name: "Paint" },
        { spec: "builtin:repair", name: "Repair" },
        { spec: "github:scm-js/plugin-ai@abc1234", name: "AI", version: "0.4.0", description: "Tools that use a language model.", author: "Jeany", icon: "icon.svg" },
        { spec: "https://example.com/mine/plugin.json", name: "Mine" },
        // The same plugin at another version is one row, not two.
        { spec: "github:scm-js/plugin-ai@0000000", name: "AI" },
      ],
      listed,
      key,
    );
    expect(rows.map((e) => e.name)).toEqual(["AI", "Mine"]);
    expect(rows.every((e) => e.unlisted)).toBe(true);
    const ai = rows[0];
    expect(ai.version).toBe("0.4.0");
    expect(ai.author).toBe("Jeany");
    // The row can be searched for and its icon and source page resolved, like any other.
    expect(ai.repo).toBe("https://github.com/scm-js/plugin-ai/tree/abc1234");
    expect(entryIcon(ai)).toEqual({ kind: "image", url: "https://raw.githubusercontent.com/scm-js/plugin-ai/abc1234/icon.svg" });
    // ("ai" alone is a substring of half the specs — plugin-p*ai*nt, rep*ai*r.)
    expect(searchRegistry([...listed, ...rows], "language").map((e) => e.name)).toEqual(["AI"]);
    expect(searchRegistry([...listed, ...rows], "ai")[0].name).toBe("AI");
    // Nothing installed, or everything already listed: no extra rows.
    expect(unlistedInstalls([], listed, key)).toEqual([]);
    // A plugin with no manifest read yet still gets a row, named by its spec.
    expect(unlistedInstalls([{ spec: "https://x/p/plugin.json" }], [], key))
      .toEqual([{ spec: "https://x/p/plugin.json", name: "https://x/p/plugin.json", unlisted: true }]);
  });

  it("merges registries, the first to list a spec winning", () => {
    const first = parseRegistry({ plugins: [{ spec: "github:o/a", name: "A" }] }, "https://one/index.json");
    const second = parseRegistry({ plugins: [{ spec: "github:o/a", name: "A elsewhere" }, { spec: "github:o/b", name: "B" }] }, "https://two/index.json");
    expect(mergeRegistries([first, second]).map((e) => e.name)).toEqual(["A", "B"]);
  });

  it("caches an index, refetches only when asked, and keeps the list when a refetch fails", async () => {
    const store = createStore();
    const { fetchText, asked } = servedText({ [REGISTRY_URL]: indexOf({ spec: "github:o/a", name: "A" }) });
    const first = await loadRegistry(store, REGISTRY_URL, { fetchText });
    expect(first?.plugins.map((e) => e.name)).toEqual(["A"]);
    expect(store.get(registryStateAtom)[REGISTRY_URL]).toEqual({ status: "ok", error: null });
    expect(store.get(registryCacheAtom)[REGISTRY_URL].registry.plugins).toHaveLength(1);

    // Recent enough: no second request.
    await loadRegistry(store, REGISTRY_URL, { fetchText });
    expect(asked).toHaveLength(1);
    // Old enough, or forced: asked again.
    await loadRegistry(store, REGISTRY_URL, { fetchText, maxAge: 0 });
    expect(asked).toHaveLength(2);

    // A failure is reported but does not empty the browser: the cached list is still there.
    const offline = { fetchText: async () => { throw new Error("offline"); } };
    const kept = await loadRegistry(store, REGISTRY_URL, { ...offline, force: true });
    expect(kept?.plugins.map((e) => e.name)).toEqual(["A"]);
    expect(store.get(registryStateAtom)[REGISTRY_URL]).toMatchObject({ status: "error", error: "offline" });
    expect(store.get(registryCacheAtom)[REGISTRY_URL].registry.plugins).toHaveLength(1);

    // So is a body that is not a registry at all.
    await loadRegistry(store, REGISTRY_URL, { force: true, fetchText: async () => "<html>nope</html>" });
    expect(store.get(registryStateAtom)[REGISTRY_URL].status).toBe("error");
    expect(store.get(registryCacheAtom)[REGISTRY_URL].registry.plugins).toHaveLength(1);
  });

  it("browses the default registry plus the ones the user added, and cannot drop a default", async () => {
    const store = createStore();
    expect(registryUrls(store)).toEqual([...DEFAULT_REGISTRIES]);
    expect(isDefaultRegistry(REGISTRY_URL)).toBe(true);

    const mine = addRegistry(store, "https://example.com/plugins/index.json");
    expect(registryUrls(store)).toEqual([...DEFAULT_REGISTRIES, mine]);
    expect(() => addRegistry(store, mine)).toThrow(RegistryError);
    expect(() => addRegistry(store, REGISTRY_URL)).toThrow(RegistryError);
    expect(() => addRegistry(store, "github:o/p")).toThrow(RegistryError);

    const { fetchText } = servedText({
      [REGISTRY_URL]: indexOf({ spec: "github:o/a", name: "A" }),
      [mine]: indexOf({ spec: "github:o/b", name: "B" }),
    });
    // maxAge 0: `atomWithStorage` shares one browser storage across the stores in this file,
    // so a list another test cached would otherwise be recent enough to answer from.
    const all = await loadRegistries(store, { fetchText, maxAge: 0 });
    expect(mergeRegistries(all).map((e) => e.name)).toEqual(["A", "B"]);
    expect(cachedRegistries(store)).toHaveLength(2);

    removeRegistry(store, REGISTRY_URL);
    expect(registryUrls(store)).toContain(REGISTRY_URL);
    removeRegistry(store, mine);
    expect(registryUrls(store)).toEqual([...DEFAULT_REGISTRIES]);
    expect(store.get(registryCacheAtom)[mine]).toBeUndefined();
    expect(store.get(registryStateAtom)[mine]).toBeUndefined();
  });
});

/* ── Script and create ──────────────────────────────────── */

describe("plugin services", () => {
  it("holds an object out under a namespaced name that other plugins get, watch and outlive", () => {
    const { store } = blankStore(16, 16);
    const providerBag = new Contributions();
    const provider = createPluginApi(store, { id: "scmjs-dev", name: "scmjs.dev", source: "s" }, providerBag);
    const consumer = createPluginApi(store, { id: "ai", name: "AI", source: "s" }, new Contributions());
    const seen: (string | null)[] = [];
    const infos: unknown[] = [];
    consumer.services.watch<{ who: string }>("scmjs-dev.account", (svc, info) => { seen.push(svc?.who ?? null); infos.push(info); });
    expect(seen).toEqual([null]);
    expect(consumer.services.get("scmjs-dev.account")).toBeNull();
    expect(consumer.services.has("scmjs-dev.account")).toBe(false);

    const account = { who: "jeany" };
    const handle = provider.services.provide("account", account, { version: 2 });
    expect(provider.services.has("account")).toBe(true);
    expect(consumer.services.get<{ who: string }>("scmjs-dev.account")).toBe(account);
    expect(consumer.services.list()).toEqual([{ id: "scmjs-dev.account", pluginId: "scmjs-dev", version: 2 }]);
    expect(seen).toEqual([null, "jeany"]);
    expect(infos[1]).toEqual({ id: "scmjs-dev.account", pluginId: "scmjs-dev", version: 2 });

    // Another plugin's service does not wake this watcher.
    consumer.services.provide("other", {});
    expect(seen).toEqual([null, "jeany"]);

    // Replacing under the same name is one change; withdrawing is another.
    const next = { who: "jeany2" };
    provider.services.provide("account", next);
    expect(seen).toEqual([null, "jeany", "jeany2"]);
    handle.dispose();
    // The first handle's key is gone already (replaced), so disposing it withdraws nothing.
    expect(consumer.services.get("scmjs-dev.account")).toBe(next);
    providerBag.dispose();
    expect(consumer.services.get("scmjs-dev.account")).toBeNull();
    expect(seen).toEqual([null, "jeany", "jeany2", null]);
  });

  it("raises the services event and survives a watcher that throws", () => {
    const { store } = blankStore(16, 16);
    const provider = createPluginApi(store, { id: "p", name: "P", source: "s" }, new Contributions());
    const consumer = createPluginApi(store, { id: "c", name: "C", source: "s" }, new Contributions());
    let events = 0;
    consumer.events.on("services", () => { events++; });
    const stop = consumer.services.watch("p.thing", () => { throw new Error("boom"); });
    const d = provider.services.provide("thing", { a: 1 });
    expect(events).toBe(1);
    stop.dispose();
    d.dispose();
    expect(events).toBe(2);
    expect(consumer.services.list()).toEqual([]);
  });
});

describe("plugin trigger claims and commands", () => {
  it("claims a run of triggers by content, describes it, refreshes and removes it", () => {
    const { store, scn } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "gen", name: "Generator", source: "s" }, bag);
    const hand = api.triggers.newTrigger([PlayerGroup.Player1]);
    const made = api.triggers.newTrigger([PlayerGroup.Player2]);
    made.actions.push(api.triggers.newAction(ActionType.Victory));
    const list = [hand, made, api.triggers.newTrigger([PlayerGroup.Player3])];
    api.document.update("seed", (tx) => tx.triggers.set(list));

    let located = 0;
    const claim = api.triggers.claim({
      label: "the generator",
      badge: "gen",
      locate: (l) => { located++; const at = l.findIndex((t) => t.actions.some((a) => a.type === ActionType.Victory)); return at < 0 ? null : { start: at, count: 1 }; },
      describe: (i) => `Made by the generator at #${i + 1}.`,
      open: () => {},
      openLabel: "Open Generator",
    });
    const claims = store.get(pluginTriggerClaimsAtom);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ pluginId: "gen", pluginName: "Generator", revision: 0 });

    // Found by content wherever the run is, in whatever list an editor holds.
    const ranges = locateClaims(claims, scn.triggers);
    expect(ranges).toEqual([{ claim: claims[0], start: 1, count: 1 }]);
    expect(claimAt(ranges, 1)?.claim.pluginId).toBe("gen");
    expect(claimAt(ranges, 0)).toBeNull();
    expect(claimBadge(ranges[0])).toBe("gen");
    expect(claimDescription(ranges[0], 1, scn.triggers)).toBe("Made by the generator at #2.");
    const shifted = [api.triggers.newTrigger(), ...scn.triggers];
    expect(locateClaims(claims, shifted)[0]).toMatchObject({ start: 2, count: 1 });
    expect(locateClaims(claims, [hand])).toEqual([]);
    // Out-of-range answers are clamped rather than trusted.
    const wild = locateClaims([{ ...claims[0], spec: { label: "x", locate: () => ({ start: 2, count: 50 }) } }], scn.triggers);
    expect(wild[0]).toMatchObject({ start: 2, count: 1 });
    // A locate that throws is a skipped claim, not a broken dialog.
    expect(locateClaims([{ ...claims[0], spec: { label: "x", locate: () => { throw new Error("no"); } } }], scn.triggers)).toEqual([]);
    expect(claimDescription({ ...ranges[0], claim: { ...claims[0], spec: { label: "the generator", locate: () => null } } }, 1, scn.triggers)).toMatch(/generated by the generator/);
    expect(located).toBeGreaterThan(0);

    claim.refresh();
    expect(store.get(pluginTriggerClaimsAtom)[0].revision).toBe(1);
    claim.remove();
    expect(store.get(pluginTriggerClaimsAtom)).toEqual([]);

    // The plugin's disposal sweeps a claim it never removed.
    api.triggers.claim({ label: "again", locate: () => null });
    expect(store.get(pluginTriggerClaimsAtom)).toHaveLength(1);
    bag.dispose();
    expect(store.get(pluginTriggerClaimsAtom)).toEqual([]);
  });

  it("tells a plugin when another registers a command it calls by id", () => {
    const { store } = blankStore();
    const consumer = createPluginApi(store, { id: "ai", name: "AI", source: "s" }, new Contributions());
    const providerBag = new Contributions();
    const provider = createPluginApi(store, { id: "trigger-script", name: "Trigger Script", source: "s" }, providerBag);
    const seen: boolean[] = [];
    consumer.events.on("commands", () => seen.push(consumer.commands.has("trigger-script.compile")));
    expect(consumer.commands.has("trigger-script.compile")).toBe(false);
    provider.commands.register({ id: "compile", title: "Compile", run: (src: unknown) => `compiled ${String(src)}` });
    expect(seen).toEqual([true]);
    expect(consumer.commands.run("trigger-script.compile", "x")).toBe("compiled x");
    providerBag.dispose();
    expect(seen).toEqual([true, false]);
    expect(consumer.commands.run("trigger-script.compile", "x")).toBeUndefined();
  });

  it("creates a blank map through document.create and honours the close gate", async () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const events: string[] = [];
    api.events.on("document", (e) => events.push(e.reason));
    expect(await api.document.create({ width: 64, height: 32, tileset: "ice", name: "Frost" })).toBe(true);
    expect(api.document.info()).toMatchObject({ name: "Frost", width: 64, height: 32, tileset: "ice", fileName: null, modified: false });
    expect(events).toEqual(["new"]);
    expect(store.get(scenarioAtom)?.tiles.length).toBe(64 * 32);

    // Modified map + the preference: the Close Scenario dialog holds the create; cancelling keeps the map.
    store.set(mapModifiedAtom, true);
    store.set(preferencesAtom, { ...store.get(preferencesAtom), confirmClose: true });
    const held = api.document.create({ width: 96, height: 96, tileset: "jungle" });
    const entry = store.get(dialogStackAtom).find((d) => d.id === "confirmClose");
    expect(entry?.payload?.pending).toMatchObject({ action: "new", options: { width: 96, name: "Untitled Scenario" } });
    store.set(closeDialogAtom, entry!.key);
    expect(await held).toBe(false);
    expect(api.document.info()?.name).toBe("Frost");
  });
});

/* ── Conveniences the AI plugin asked for ──────────────── */

describe("plugin api conveniences", () => {
  it("peeks at the history without moving it", () => {
    const { store } = blankStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.document.history()).toEqual({ undo: null, redo: null, undoDepth: 0, redoDepth: 0 });
    api.document.edit("AI: first", (tx) => { tx.setTile(0, 0, 7); });
    api.document.edit("AI: second", (tx) => { tx.setTile(1, 0, 7); });
    expect(api.document.history()).toEqual({ undo: "AI: second", redo: null, undoDepth: 2, redoDepth: 0 });
    api.document.undo();
    expect(api.document.history()).toEqual({ undo: "AI: first", redo: "AI: second", undoDepth: 1, redoDepth: 1 });
  });

  it("puts a separator above a plugin item that asks for one, but never two in a row", () => {
    const menus: Menu[] = [{ label: "Tools", items: [{ kind: "item", label: "Statistics…" }] }];
    const merged = withPluginItems(menus, [
      { key: 5, pluginId: "p", path: "Tools", label: "Top", separator: true, run: () => {} },
      { key: 1, pluginId: "p", path: "Tools/AI", label: "Generate…", run: () => {} },
      { key: 2, pluginId: "p", path: "Tools/AI", label: "Review…", run: () => {} },
      { key: 3, pluginId: "p", path: "Tools/AI", label: "Assistant", separator: true, run: () => {} },
      { key: 4, pluginId: "p", path: "Tools/AI", label: "Settings…", separator: true, run: () => {} },
    ]);
    const sub = merged[0].items[3] as Extract<Menu["items"][number], { kind: "sub" }>;
    expect(sub.items.map((i) => (i.kind === "item" ? i.label : i.kind))).toEqual(["Generate…", "Review…", "sep", "Assistant", "sep", "Settings…"]);
    // The first plugin item in a built-in menu already gets one separator; `separator` does not add a second.
    expect(merged[0].items.map((i) => (i.kind === "item" ? i.label : i.kind))).toEqual(["Statistics…", "sep", "Top", "sub"]);
  });

  it("makes a top-level menu of the plugin's own before Help", () => {
    const menus: Menu[] = [{ label: "File", items: [{ kind: "item", label: "Open…" }] }, { label: "Help", items: [{ kind: "item", label: "About" }] }];
    const merged = withPluginItems(menus, [
      { key: 1, pluginId: "p", path: "Account", label: "Sign in…", run: () => {} },
      { key: 2, pluginId: "p", path: "Account", label: "Sign out", separator: true, run: () => {} },
      { key: 3, pluginId: "p", path: "Account/Maps", label: "Open…", run: () => {} },
    ]);
    expect(merged.map((m) => m.label)).toEqual(["File", "Account", "Help"]);
    expect(merged[1].items.map((i) => (i.kind === "item" ? i.label : i.kind === "sub" ? `sub:${i.label}` : i.kind))).toEqual(["Sign in…", "sep", "Sign out", "sub:Maps"]);
    expect(menus.map((m) => m.label)).toEqual(["File", "Help"]);
  });

  it("tells a placement verdict's reason in words", () => {
    const { store } = blankStore(16, 16);
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    api.document.edit("marine", (tx) => { tx.addUnits([tx.makeUnit(0, 0, 100, 100)]); });
    const verdict = api.query.placement(0, 104, 100);
    expect(verdict).toMatchObject({ problem: "collision", blocker: 0, reason: "it overlaps Terran Marine" });
    expect(api.query.placement(0, 400, 400).reason).toBeNull();
  });
});

describe.skipIf(!haveJungle)("terrainAt against the real tileset", () => {
  it("names the flat ground under a tile and the lattice's terrain under a cliff", async () => {
    const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `jungle.${ext}`)));
    const tileset = loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") });
    primeTileset({
      name: "jungle",
      tileset,
      atlas: { image: {} as CanvasImageSource, columns: 1, tileSize: 32, count: tileset.megatileCount, averages: new Uint32Array(tileset.megatileCount), animation: null },
      doodads: NO_DOODADS,
    });
    const { store } = blankStore(32, 32);
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(await api.document.create({ width: 32, height: 32, tileset: "jungle" })).toBe(true);
    const types = api.terrain.types();
    const ground = api.terrain.terrainAt(1, 1);
    expect(types.some((t) => t.id === ground)).toBe(true);
    const high = types.find((t) => t.height > 0 && api.terrain.isomTypes().includes(t.id))!;
    api.document.edit("hill", (tx) => { tx.paintIsom({ x: 8, y: 16 }, high.id, 3); });
    const scn = api.document.scenario()!;
    // Somewhere the hill's cliff was drawn, the tile is not flat ground — and terrainAt still answers a terrain id.
    let cliff: { x: number; y: number } | null = null;
    for (let y = 0; y < 32 && !cliff; y++) for (let x = 0; x < 32; x++) {
      const info = api.terrain.tileInfo(scn.tiles[y * 32 + x])!;
      if (info.kind === "edge") { cliff = { x, y }; break; }
    }
    expect(cliff).not.toBeNull();
    const at = api.terrain.terrainAt(cliff!.x, cliff!.y);
    expect(at).not.toBeNull();
    expect(types.some((t) => t.id === at)).toBe(true);
    expect(api.terrain.terrainAt(16, 16)).toBe(high.id);
    expect(api.terrain.terrainAt(-1, 0)).toBeNull();
  });
});

/* ── The beta additions ─────────────────────────────────── */

import { toastsAtom } from "../src/atoms/uiAtoms";
import { symmetryAtom } from "../src/atoms/editorAtoms";
import { ANYWHERE_INDEX } from "../src/formats/chk/sections/objects";
import { isLocationUsed } from "../src/formats/chk/sections/objects";

describe("plugin api: editing additions", () => {
  const apiOver = (store: ReturnType<typeof createStore>) => createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());

  it("fills areas, replaces tiles and mirrors cells under the symmetry mode", () => {
    const { store, scn } = blankStore(8, 8);
    const api = apiOver(store);
    scn.tiles.fill(0x20);
    for (let i = 0; i < 4; i++) scn.tiles[i] = 0x31;
    expect(api.terrain.floodRegion(0, 0, "tile")).toEqual([0, 1, 2, 3]);
    const r = api.document.edit("fill", (tx) => { expect(tx.fillArea(0, 0, { tileId: 0x42 }, "tile")).toBe(4); });
    expect(r.tiles).toBe(4);
    expect(scn.tiles[3]).toBe(0x42);
    api.terrain.setSymmetry("h");
    expect(api.terrain.symmetry()).toBe("h");
    expect(api.terrain.symmetryAvailable("rot90")).toBe(true);
    expect(api.terrain.mirror([0]).sort((a, b) => a - b)).toEqual([0, 7]);
    expect(api.terrain.mirrorPoint(32, 32)).toEqual([{ x: 32, y: 32 }, { x: 224, y: 32 }]);
    const r2 = api.document.edit("replace", (tx) => {
      expect(tx.mirror({ x0: 0, y0: 0, x1: 1, y1: 1 }).sort((a, b) => a - b)).toEqual([0, 7]);
      expect(tx.replaceTerrain({ kind: "tile", id: 0x42 }, { kind: "tile", id: 0x20 })).toBe(4);
      expect(tx.replaceTerrain({ kind: "tile", id: 0x99 }, { kind: "tile", id: 0x20 })).toBe(0);
    });
    expect(r2.tiles).toBe(4);
    expect(api.terrain.flatGroupOf(2)).toBe(-1);
    expect(api.terrain.blendCandidates(0x20, "left")).toEqual([]);
    expect(api.document.undo()).toBe("replace");
    expect(scn.tiles[0]).toBe(0x42);
    api.terrain.setSymmetry("none");
  });

  it("moves and patches objects, restores Anywhere, and edits fog in every way", () => {
    const { store, scn } = blankStore(8, 8);
    const api = apiOver(store);
    const r = api.document.edit("objects", (tx) => {
      const [u] = tx.addUnits([tx.makeUnit(0, 0, 40, 40)]);
      expect(tx.moveUnits([u], 32, 0, false)).toBe(1);
      expect(scn.units[u].x).toBe(72);
      const s = tx.placeSprite("pure", 1, 0, 50, 50);
      expect(tx.updateSprites([s], () => ({ owner: 3 }))).toBe(1);
      expect(tx.moveSprites([s], -100, 0)).toBe(1);
      expect(scn.sprites[s].x).toBe(0);
      expect(tx.updateDoodads([0], { owner: 1 })).toBe(0);
      scn.locations[ANYWHERE_INDEX] = { ...scn.locations[ANYWHERE_INDEX], right: 32 };
      expect(tx.restoreAnywhere()).toBe(true);
      expect(scn.locations[ANYWHERE_INDEX].right).toBe(8 * 32);
      expect(tx.restoreAnywhere()).toBe(false);
      expect(tx.setFog({ x0: 0, y0: 0, x1: 2, y1: 1 }, 0x01, "clear")).toBe(2);
      expect(tx.invertFog(0x01)).toBe(64);
      expect(tx.copyFog(0, 0x02)).toBe(62);
      expect(tx.floodFog(0, 0, 0, 0x04, "clear")).toBe(2);
    });
    expect(r).toMatchObject({ changed: true, units: 2, sprites: 3, locations: 1 });
    expect(api.query.fogAt(0, 0) & 0x07).toBe(0x03);
    expect(api.query.fogAt(5, 5) & 0x07).toBe(0x04);
    expect(api.document.undo()).toBe("objects");
    expect(scn.units).toHaveLength(0);
    expect(isLocationUsed(scn.locations[ANYWHERE_INDEX])).toBe(true);
  });

  it("auto-places start locations for N players", () => {
    const { store, scn } = blankStore(32, 32);
    const api = apiOver(store);
    const r = api.document.edit("starts", (tx) => {
      const out = tx.placeStartLocations({ players: 4, layout: "corners", margin: 2 });
      expect(out.placed.filter(Boolean)).toHaveLength(4);
      expect(out.removed).toBe(0);
      const again = tx.placeStartLocations({ players: 2, replace: true });
      expect(again.removed).toBe(4);
    });
    expect(r.changed).toBe(true);
    expect(scn.units.map((u) => u.owner)).toEqual([0, 1]);
    expect(api.query.startLocations()).toHaveLength(2);
  });

  it("copies, cuts and pastes through the clipboard", () => {
    const { store, scn } = blankStore(16, 8);
    const api = apiOver(store);
    api.document.edit("seed", (tx) => { tx.placeUnit(0, 0, 40, 40); tx.setTile(1, 1, 0x77); });
    expect(api.clipboard.clip()).toBeNull();
    expect(api.clipboard.copy()).toBeNull();
    api.selection.markArea({ x0: 0, y0: 0, x1: 4, y1: 4 });
    const clip = api.clipboard.copy()!;
    expect(clip).toMatchObject({ width: 4, height: 4 });
    expect(api.clipboard.summary(clip)).toContain("1 unit");
    expect(api.clipboard.clip()).toBe(clip);
    api.clipboard.setParts({ terrain: false });
    expect(api.clipboard.parts().terrain).toBe(false);
    api.clipboard.setMode("replace");
    expect(api.clipboard.mode()).toBe("replace");
    const pasted = api.clipboard.paste(8, 0)!;
    expect(pasted.counts.units).toBe(1);
    expect(pasted.counts.tiles).toBe(0);
    expect(scn.units).toHaveLength(2);
    expect(api.selection.markedArea()).toEqual({ x0: 8, y0: 0, x1: 12, y1: 4 });
    expect(api.document.history().undo).toContain("Paste");
    // Cut by explicit objects takes them off the map.
    const cut = api.clipboard.cut({ units: [0] })!;
    expect(cut.units).toHaveLength(1);
    expect(scn.units).toHaveLength(1);
    api.clipboard.setPasting(true);
    expect(api.clipboard.pasting()).toBe(true);
    expect(api.selection.layer()).toBe("clipboard");
    api.clipboard.setPasting(false);
    api.clipboard.setClip(null);
    expect(api.clipboard.paste(0, 0)).toBeNull();
  });

  it("round-trips .trg and the strings text through api.exchange and tx.strings.import", () => {
    const { store, scn } = blankStore();
    const api = apiOver(store);
    const t = api.triggers.newTrigger([17]);
    const bytes = api.exchange.encodeTrg([t]);
    expect(bytes.length).toBe(2400);
    expect(api.exchange.decodeTrg(bytes)).toEqual([t]);
    const text = api.exchange.formatStrings();
    expect(text).toContain("1\tp");
    const parsed = api.exchange.parseStrings("2\tHello\n99\tNew one\nbad line\n");
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.errors).toHaveLength(1);
    const r = api.document.update("import", (tx) => { expect(tx.strings.import("2\tHello\n99\tNew one\n")).toEqual({ replaced: 1, added: 1 }); });
    expect(r.changed).toBe(true);
    expect(api.names.string(2)).toBe("Hello");
    expect(scn.strings.strings.at(-1)).toBe("New one");
  });

  it("reads and sets the editing options, copies selections, and reports placement honestly", () => {
    const { store } = blankStore();
    const api = apiOver(store);
    api.palette.setPlacementOptions({ checkCollision: false });
    expect(api.palette.placementOptions().checkCollision).toBe(false);
    api.palette.setDoodadPlacement({ placeAnywhere: true });
    expect(api.palette.doodadPlacement().placeAnywhere).toBe(true);
    api.palette.setLocationSnap(8);
    expect(api.palette.locationSnap()).toBe(8);
    api.palette.setActive({ fogViewPlayer: 3 });
    expect(api.palette.active().fogViewPlayer).toBe(3);
    api.selection.setUnits([0]);
    const mine = api.selection.units();
    mine.push(99);
    expect(api.selection.units()).toEqual([0]);
    api.selection.setLayerLocked("units", true);
    expect(api.selection.lockedLayers()).toEqual(["units"]);
    api.selection.setLayerLocked("units", false);
    expect(api.selection.lockedLayers()).toEqual([]);
    expect(api.terrain.active().variation).toBe(-1);
    api.terrain.setActive({ variation: 3 });
    expect(api.terrain.active().variation).toBe(3);
    expect(api.settings.unitAvailable(0, 0)).toBe(true);
    expect(api.query.strings()).toHaveLength(store.get(scenarioAtom)!.strings.strings.length);
    const empty = createPluginApi(createStore(), { id: "t", name: "T", source: "s" }, new Contributions());
    expect(empty.query.placement(0, 0, 0)).toBeNull();
    expect(empty.query.fogAt(0, 0)).toBe(0xff);
    expect(empty.query.strings()).toEqual([]);
  });

  it("raises the options and file events, and the UI extras work", async () => {
    const { store } = blankStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    let options = 0, file = 0;
    api.events.on("options", () => { options++; });
    api.events.on("file", () => { file++; });
    store.set(symmetryAtom, "v");
    api.palette.setLocationSnap(16);
    api.document.extras.set("x\\y.txt", new Uint8Array([1]));
    expect(options).toBeGreaterThanOrEqual(2);
    expect(file).toBeGreaterThanOrEqual(1);
    api.ui.status("hello");
    expect(api.ui.statusText()).toBe("hello");
    api.ui.toast({ title: "Done", detail: "all good" });
    expect(store.get(toastsAtom).at(-1)).toMatchObject({ kind: "info", title: "Done", detail: "all good" });
    // Export with explicit options: uncompressed is larger than the remembered PKWARE default.
    const packed = await api.document.export();
    const plain = await api.document.export({ saveOptions: { compression: "none", encrypt: false } });
    expect(plain!.size).toBeGreaterThan(packed!.size);
    expect(api.tileset.name()).toBe("Badlands");
    bag.dispose();
  });
});
