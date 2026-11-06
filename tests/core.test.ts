/**
 * `@scm-js/core` (core/src/index.ts, docs/core.md): the editor's map code as a library. Three things hold it
 * together. The modules behind the entry reach no UI — no value import from the atoms, components, hooks, services
 * or the plugin host, and no package but the ones core/package.json declares — so the bundle runs in Node and the
 * declarations name no React or Jotai. The `scmjs` command imports from the editor only what the entry exports, so
 * the command stays a thin layer over the library. And the entry itself opens, checks, rewrites and reopens the
 * committed maps.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as core from "../core/src/index";
import { testMapFiles } from "./support/maps";

const root = resolve(import.meta.dirname, "..");
const ENTRY = join(root, "core/src/index.ts");
const rel = (file: string) => relative(root, file).replace(/\\/g, "/");

interface Edge { to: string; typeOnly: boolean }

/** What the library must not run: the state, the components, the hooks, the browser services, the plugin host, the game-data store, the desktop app. */
const UI = [/^src\/atoms\//, /^src\/components\//, /^src\/hooks\//, /^src\/services\//, /^src\/plugins\/(host|builtin|registry|updates|defaults|devLink)\.ts$/, /^src\/gamedata\//, /^desktop\//];
const isUi = (file: string) => UI.some((re) => re.test(rel(file)));

/** The modules a file imports or re-exports from, with whether the edge is erased at run time. */
function edges(file: string): Edge[] {
  const text = readFileSync(file, "utf8");
  const found: Edge[] = [];
  for (const m of text.matchAll(/(?:^|\n)[ \t]*(import|export)\s+(type\s+)?(\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+(?:\s*,\s*\{[^}]*\})?)\s*from\s*["']([^"']+)["']/g)) {
    const names = m[3].trim();
    const allTypes = names.startsWith("{") && names.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "));
    found.push({ to: m[4], typeOnly: !!m[2] || allTypes });
  }
  return found;
}

/** A relative specifier as a file, the way the bundler finds it; null for something that is not TypeScript. */
function resolveModule(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every module reachable from the entry, by value or by type, and the packages they import. */
function walk() {
  const modules = new Map<string, { byValue: boolean }>();
  const packages = new Map<string, { typeOnly: boolean; from: string }>();
  const queue: { file: string; byValue: boolean }[] = [{ file: ENTRY, byValue: true }];
  while (queue.length > 0) {
    const { file, byValue } = queue.shift()!;
    const seen = modules.get(file);
    if (seen && (seen.byValue || !byValue)) continue;
    modules.set(file, { byValue: byValue || !!seen?.byValue });
    for (const edge of edges(file)) {
      if (!edge.to.startsWith(".")) {
        // A package counts as run-time only when both the module and the import survive erasure.
        const typeOnly = edge.typeOnly || !byValue;
        const was = packages.get(edge.to);
        if (!was || (was.typeOnly && !typeOnly)) packages.set(edge.to, { typeOnly, from: rel(file) });
        continue;
      }
      const target = resolveModule(file, edge.to);
      if (!target) continue;
      const stillValue = byValue && !edge.typeOnly;
      // A type taken from the UI (a dialog id, an option shape) is followed no further: what the declarations may
      // name is the build's check, and the UI's own imports are no business of the library's.
      if (!stillValue && isUi(target)) continue;
      queue.push({ file: target, byValue: stillValue });
    }
  }
  return { modules, packages };
}

describe("@scm-js/core: the modules behind the entry", () => {
  const { modules, packages } = walk();

  it("reach the editor's formats, edits and tables, and nothing it draws with", () => {
    const reached = [...modules.entries()].filter(([, v]) => v.byValue).map(([f]) => rel(f));
    expect(reached.length).toBeGreaterThan(40);
    expect(reached.filter((f) => isUi(join(root, f)))).toEqual([]);
  });

  it("import no package at run time but the ones the library declares", () => {
    const declared = Object.keys(JSON.parse(readFileSync(join(root, "core/package.json"), "utf8")).dependencies ?? {});
    const atRunTime = [...packages.entries()].filter(([, v]) => !v.typeOnly).map(([name, v]) => `${name} (${v.from})`);
    expect(atRunTime.filter((line) => !declared.some((d) => line.startsWith(`${d} `)))).toEqual([]);
    for (const name of declared) expect(packages.get(name)?.typeOnly, `${name} is declared but never imported at run time`).toBe(false);
    // Types may reach further (the declaration bundle refuses what must not get in), but never these two.
    expect([...packages.keys()].filter((name) => /^(react|jotai)(\/|$)/.test(name))).toEqual([]);
  });
});

describe("@scm-js/core: the scmjs command is a thin layer over it", () => {
  /** What the entry exports, by the editor module it takes each name from. */
  function exported(): Map<string, Set<string>> {
    const byModule = new Map<string, Set<string>>();
    for (const m of readFileSync(ENTRY, "utf8").matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
      const file = resolveModule(ENTRY, m[2])!;
      const names = byModule.get(file) ?? new Set<string>();
      for (const spec of m[1].split(",")) {
        const name = spec.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop();
        if (name) names.add(name);
      }
      byModule.set(file, names);
    }
    return byModule;
  }

  it("imports from the editor only what the entry exports", () => {
    const api = exported();
    const strays: string[] = [];
    const cli = join(root, "cli/src");
    for (const name of ["about", "bot", "files", "main", "map", "open", "plugin", "replay", "ui"].map((n) => join(cli, `${n}.ts`))) {
      const text = readFileSync(name, "utf8");
      for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'](\.\.\/\.\.\/src\/[^"']+)["']/g)) {
        const file = resolveModule(name, m[2]);
        const names = file ? api.get(file) : undefined;
        for (const spec of m[1].split(",")) {
          const imported = spec.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
          if (imported && !names?.has(imported)) strays.push(`${rel(name)}: ${imported} from ${m[2]}`);
        }
      }
    }
    expect(strays).toEqual([]);
  });
});

describe("@scm-js/core: through the entry", () => {
  it("opens, checks, writes and reopens every committed map", async () => {
    for (const map of testMapFiles()) {
      const opened = await core.openMapBytes(new Uint8Array(readFileSync(map.path)), map.name);
      expect(opened.fileName).toBe(map.name);
      expect(opened.origin?.compression, map.name).toBeDefined();
      const issues = core.validateScenario(opened.scenario, { extras: opened.extras });
      expect(core.issueCounts(issues).error, map.name).toBe(0);
      const bytes = await core.writeMapBytes(opened.scenario, { format: core.formatOf(map.name), extras: opened.extras, stored: opened.stored });
      const again = await core.openMapBytes(bytes, map.name);
      expect(core.scenarioName(again.scenario)).toBe(core.scenarioName(opened.scenario));
      expect([again.scenario.width, again.scenario.height]).toEqual([opened.scenario.width, opened.scenario.height]);
      expect(again.scenario.chk.sections.map((s) => s.name)).toEqual(opened.scenario.chk.sections.map((s) => s.name));
      expect(core.readTriggers(again.scenario).length).toBe(core.readTriggers(opened.scenario).length);
    }
  });

  it("takes triggers to text and back unchanged", async () => {
    const { scenario } = await core.openMapBytes(new Uint8Array(readFileSync(join(root, "tests/maps/ums.scx"))), "ums.scx");
    const triggers = core.readTriggers(scenario);
    expect(triggers.length).toBeGreaterThan(0);
    const back = core.triggersFromText(scenario, core.triggersToText(scenario, triggers));
    expect(core.sameTriggers(back, triggers)).toBe(true);
  });

  it("makes a new two-player map that opens again and passes Check Map", async () => {
    const fresh = core.createScenario({ width: 96, height: 64, era: 4, name: "From core", description: "Made by the library." });
    const players = core.readPlayerSettings(fresh);
    for (let slot = 2; slot < 8; slot++) players.types[slot] = core.PlayerType.Inactive;
    core.applyPlayerSettings(fresh, players);
    const serial = core.nextSerial(fresh);
    // An edit is a change list, carried out (or undone) by `applyUnitChanges`, as in the editor.
    core.applyUnitChanges(fresh, core.addUnits(fresh, [core.makeUnit(null, core.START_LOCATION, 0, 10 * 32, 10 * 32, serial), core.makeUnit(null, core.START_LOCATION, 1, 86 * 32, 54 * 32, serial + 1)]));
    const reopened = await core.openMapBytes(await core.writeMapBytes(fresh, { format: "scx" }), "new.scx");
    expect(core.scenarioName(reopened.scenario)).toBe("From core");
    expect(core.mapStatistics(reopened.scenario, null, null, null).tileset).toBe("Jungle World");
    expect(reopened.scenario.units.filter((u) => u.unitId === core.START_LOCATION)).toHaveLength(2);
    expect(core.validateScenario(reopened.scenario).filter((i) => i.level === "error")).toEqual([]);
  });
});
