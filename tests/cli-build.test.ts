/**
 * `scmjs map build` (cli/src/build.ts): a map's TrigScript script applied and its programs built under Node, with
 * the repository's own TypeScript. The script goes into a copy of tests/maps/ums.scx as the editor would keep it
 * (`trigscript\main.ts`); writes go to a temporary folder.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openMapBytes } from "../src/editor/mapFile";
import { readTriggers } from "../src/editor/triggers";
import { loadMap } from "../src/formats/mpq/scm";
import { parseScenario } from "../src/formats/chk/scenario";
import { buildMap, loadTypeScript, mapNames, printBuild, testWorld, type TypeScriptModule } from "../cli/src/build";
import { CliError, visible } from "../cli/src/ui";
import { testMap } from "./support/maps";

/** The plugin's source is vendored (`npm run vendor:plugins`), not in the repository: without it the build has no compiler. */
const have = existsSync(join(import.meta.dirname, "..", "plugins", "trigscript", "script.ts"));
const scriptState = async (...args: Parameters<typeof import("../plugins/trigscript/script").scriptState>) => (await import("../plugins/trigscript/script")).scriptState(...args);

const encoder = new TextEncoder();
const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-build-"));

/** ums.scx with a script in it, as the editor keeps one. */
async function withScript(main: string, more: Record<string, string> = {}) {
  const doc = await openMapBytes(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx");
  doc.extras.set("trigscript\\main.ts", encoder.encode(main));
  for (const [path, text] of Object.entries(more)) doc.extras.set(`trigscript\\${path.replace(/\//g, "\\")}`, encoder.encode(text));
  return doc;
}

const TRIGGERS = `
import { trigger, always, displayText, bring, createUnit, P1, test, expect } from "trigscript";

trigger(P1, [always()], [displayText("hello from the command line")]);
trigger(P1, [bring(P1, units.TerranMarine, locations.Middle, ">=", 1)], [createUnit(P1, units.TerranMarine, 2, locations.Base)]);

test("a marine in the middle brings two to the base", (sim) => {
  sim.place(P1, units.TerranMarine, locations.Middle);
  sim.seconds(3);
  expect(sim.count(P1, units.TerranMarine, locations.Base)).toBe(3);
});
`;

let typescript: Promise<TypeScriptModule> | null = null;
const ts = () => (typescript ??= loadTypeScript());

describe.skipIf(!have)("scmjs map build", () => {
  it("finds the repository's TypeScript and its standard library", async () => {
    const t = await ts();
    expect(t.version).toBe(JSON.parse(readFileSync("node_modules/typescript/package.json", "utf8")).version);
    expect(t.lib).toContain("interface Array<T>");
    expect(t.lib).toContain("findLastIndex");
  });

  it("reads the map's names and world as the plugin does", async () => {
    const doc = await withScript("");
    const names = await mapNames(doc.scenario, doc.extras);
    expect(names.locations.entries.map((e) => e.keys[0])).toEqual(["NoLocation", "Base", "Nest", "Middle", "Anywhere"]);
    expect(names.players.entries.find((e) => e.keys.includes("Defenders"))?.value).toBe(18);
    const world = testWorld(doc.scenario, { heapCells: 1, stackDepth: 2, testsGuardBuild: false });
    expect(world.players).toEqual([0, 1]);
    expect(world.computers).toEqual([1]);
    expect(world.units?.length).toBeGreaterThan(5);
    expect(world.locations?.[1]).toMatchObject({ left: 6 * 32, top: 50 * 32 });
  });

  it("applies the triggers, runs the tests, writes the map and is idempotent", async () => {
    const dir = tmp();
    const out = join(dir, "built.scx");
    const doc = await withScript(TRIGGERS);
    const r = await buildMap(doc, join(dir, "ums.scx"), await ts(), { test: true, out });
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([]);
    expect(r.tests).toMatchObject({ passed: 1, failed: 0 });
    expect(r.block).toEqual({ start: 3, count: 2 });
    expect(r.programs).toBe(0);
    expect(r.written?.path).toBe(out);
    expect(visible(printBuild("ums.scx", r).join("\n"))).toMatch(/2 triggers.*#4–#5.*1 test passed.*written to/);

    const again = await openMapBytes(new Uint8Array(readFileSync(out)), "built.scx");
    expect(again.builtBy).toBeNull();
    expect(readTriggers(again.scenario)).toHaveLength(5);
    const state = await scriptState(readTriggers(again.scenario), again.extras);
    expect(state.unbuilt).toBe(false);
    expect(state.stale).toBe(false);
    expect(state.block).toMatchObject({ start: 3, count: 2 });
    expect(state.files?.["main.ts"]).toBe(TRIGGERS);

    // The same build again changes nothing: the block is replaced by itself.
    const r2 = await buildMap(again, out, await ts(), { out: join(dir, "twice.scx") });
    expect(r2.block).toEqual({ start: 3, count: 2 });
    expect(r2.tests).toBeNull();
    expect(r2.testCount).toBe(1);
    const third = await openMapBytes(new Uint8Array(readFileSync(join(dir, "twice.scx"))), "twice.scx");
    expect(readTriggers(third.scenario)).toHaveLength(5);
  });

  it("reports a script that does not compile with its line and writes nothing", async () => {
    const dir = tmp();
    const out = join(dir, "built.scx");
    const doc = await withScript('import { trigger, always, displayText, P1 } from "trigscript";\n\ntrigger(P1, [always()], [displayText(42)]);\n');
    const r = await buildMap(doc, join(dir, "ums.scx"), await ts(), { out });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ file: "main.ts", line: 3 });
    expect(r.written).toBeNull();
    expect(existsSync(out)).toBe(false);
    expect(visible(printBuild("ums.scx", r).join("\n"))).toMatch(/main\.ts:3:\d+ error[\s\S]*1 error in the script.*nothing written/);
  });

  it("refuses the build on a failing test, and only checks with check", async () => {
    const dir = tmp();
    const out = join(dir, "built.scx");
    const failing = TRIGGERS.replace("toBe(3)", "toBe(4)");
    const doc = await withScript(failing);
    const r = await buildMap(doc, join(dir, "ums.scx"), await ts(), { test: true, out });
    expect(r.ok).toBe(false);
    expect(r.tests).toMatchObject({ passed: 0, failed: 1 });
    expect(r.tests?.failures[0]).toMatchObject({ name: "a marine in the middle brings two to the base", file: "main.ts" });
    expect(r.tests?.failures[0].message).toMatch(/4/);
    expect(existsSync(out)).toBe(false);
    expect(visible(printBuild("ums.scx", r).join("\n"))).toMatch(/1 test failed, 0 passed.*nothing written/);

    const checked = await buildMap(await withScript(TRIGGERS), join(dir, "ums.scx"), await ts(), { check: true, test: true, out });
    expect(checked.ok).toBe(true);
    expect(checked.triggerCount).toBe(2);
    expect(checked.block).toBeNull();
    expect(checked.written).toBeNull();
    expect(existsSync(out)).toBe(false);
    expect(visible(printBuild("ums.scx", checked).join("\n"))).toMatch(/compiles, nothing written/);
  });

  it("builds the programs into the file and keeps the source beside them", async () => {
    const dir = tmp();
    const out = join(dir, "built.scx");
    const doc = await withScript(`${TRIGGERS}
import { program, print, sleep, frames } from "trigscript";
program(() => {
  let n = 0;
  while (true) {
    n += 1;
    print(\`tick \${n}\`);
    sleep(frames(24));
  }
}, { name: "ticks" });
`);
    const r = await buildMap(doc, join(dir, "ums.scx"), await ts(), { out });
    expect(r.ok).toBe(true);
    expect(r.programs).toBe(1);
    expect(r.block).toEqual({ start: 3, count: 2 });
    expect(r.log.length).toBeGreaterThan(0);
    expect(visible(printBuild("ums.scx", r).join("\n"))).toMatch(/1 program \(Remastered\)/);

    // The editor restores the map as edited: the source scenario, the step named.
    const bytes = new Uint8Array(readFileSync(out));
    const again = await openMapBytes(bytes, "built.scx");
    expect(again.builtBy?.map((b) => b.label)).toEqual(["TrigScript"]);
    expect(readTriggers(again.scenario)).toHaveLength(5);
    // The game gets the build: the scenario in the archive has the programs' triggers laid out, far more than five.
    const raw = await loadMap(bytes);
    expect(readTriggers(parseScenario(raw.chk)).length).toBeGreaterThan(5);

    await expect(buildMap(await withScript(TRIGGERS), join(dir, "ums.scx"), await ts(), { out: join(dir, "x.chk") })).resolves.toMatchObject({ programs: 0 });
    await expect(buildMap(again, out, await ts(), { out: join(dir, "x.chk") })).rejects.toThrow(/bare \.chk/);
  });

  it("names a map with no script, and a stale block", async () => {
    const doc = await openMapBytes(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx");
    await expect(buildMap(doc, "ums.scx", await ts(), { out: join(tmp(), "x.scx") })).rejects.toThrow(CliError);
    await expect(buildMap(doc, "ums.scx", await ts(), { out: join(tmp(), "x.scx") })).rejects.toThrow(/no TrigScript script/);
  });
});
