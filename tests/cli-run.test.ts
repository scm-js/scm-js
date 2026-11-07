/**
 * `scmjs map run` (cli/src/run.ts over src/plugins/headless.ts): a plugin or a script run against a map with the
 * editor's plugin API under Node. Plugins are written to a temporary folder; maps come from tests/maps.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openMapBytes } from "../src/editor/mapFile";
import { scenarioName } from "../src/formats/chk/scenario";
import { printRun, runOnMap, sourceFor, summarizeDiff } from "../cli/src/run";
import { CliError, visible } from "../cli/src/ui";
import { testMap } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-run-"));
const bytes = () => new Uint8Array(readFileSync(testMap("ums.scx")));
const open = async () => openMapBytes(bytes(), "ums.scx");

/** A plugin folder: plugin.json and the files given. */
function plugin(files: Record<string, string>, manifest: Record<string, unknown> = {}): string {
  const dir = join(tmp(), "plugin-test");
  mkdirSync(dir);
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "Test Plugin", id: "test", version: "1.2.3", api: 1, entry: Object.keys(files)[0], ...manifest }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const EDITING = `
export default function activate(api) {
  api.ui.status("Renaming the map");
  api.document.update("Rename", (tx) => tx.properties({ name: "Renamed by a plugin" }));
  api.document.edit("Add a marine", (tx) => tx.addUnits([tx.makeUnit(0, 0, 900, 900)]));
  api.ui.toast({ kind: "ok", title: "Done", detail: "one marine more" });
  api.commands.register({ id: "count", title: "Count units", run: () => api.document.scenario().units.length });
}
`;

describe("scmjs map run", () => {
  it("names what a path is: a folder, a manifest, a script, or the editor's specs", () => {
    const dir = plugin({ "plugin.js": EDITING });
    expect(sourceFor(dir)).toMatchObject({ kind: "remote", manifestUrl: expect.stringMatching(/plugin\.json$/), entryUrl: null });
    expect(sourceFor(join(dir, "plugin.json"))).toMatchObject({ kind: "remote", manifestUrl: expect.stringMatching(/^file:/), entryUrl: null });
    expect(sourceFor(join(dir, "plugin.js"))).toMatchObject({ kind: "remote", manifestUrl: null, entryUrl: expect.stringMatching(/plugin\.js$/) });
    expect(sourceFor("github:scm-js/plugin-repair")).toMatchObject({ kind: "remote", github: { owner: "scm-js", repo: "plugin-repair" } });
    expect(() => sourceFor("nothing-here-at-all")).toThrow(/Unrecognised plugin location/);
  });

  it("runs a plugin against the map, prints what it showed, and writes the change", async () => {
    const dir = plugin({ "plugin.js": EDITING });
    const out = join(tmp(), "out.scx");
    const lines: string[] = [];
    const r = await runOnMap(await open(), testMap("ums.scx"), bytes(), dir, { out, live: (l) => lines.push(visible(l)) });
    expect(r.plugin).toEqual({ id: "test", name: "Test Plugin", version: "1.2.3" });
    expect(r.result).toBeNull();
    expect(r.modified).toBe(true);
    // The status line follows each edit too, as it does in the editor.
    expect(r.events.map((e) => e.text)).toEqual(["Renaming the map", "Rename", "Add a marine", "Done: one marine more"]);
    expect(lines).toHaveLength(4);
    expect(summarizeDiff(r.diff!)).toBe("1 setting changed, 1 unit added, 1 string changed");
    expect(r.written?.path).toBe(out);
    const again = await openMapBytes(new Uint8Array(readFileSync(out)), "out.scx");
    expect(scenarioName(again.scenario)).toBe("Renamed by a plugin");
    expect(again.scenario.units).toHaveLength(22);
    expect(visible(printRun("ums.scx", r).join("\n"))).toMatch(/Test Plugin 1\.2\.3 ran.*1 setting changed, 1 unit added, 1 string changed.*written to/);
  });

  it("runs one of the plugin's commands and answers what it returned; a dry run writes nothing", async () => {
    const dir = plugin({ "plugin.js": EDITING });
    const out = join(tmp(), "out.scx");
    const r = await runOnMap(await open(), testMap("ums.scx"), bytes(), dir, { command: "count", out, dryRun: true });
    expect(r.result).toBe(22);
    expect(r.modified).toBe(true);
    expect(r.diff?.units.filter((u) => u.change === "added")).toHaveLength(1);
    expect(r.written).toBeNull();
    expect(existsSync(out)).toBe(false);
    expect(visible(printRun("ums.scx", r, { dryRun: true }).join("\n"))).toMatch(/Units \+1[\s\S]*not written \(--dry-run\)/);
    await expect(runOnMap(await open(), testMap("ums.scx"), bytes(), dir, { command: "nothing", dryRun: true })).rejects.toThrow(/has no command "nothing"; it has test\.count/);
  });

  it("leaves an unchanged map alone, and takes a TypeScript script through TypeScript", async () => {
    const quiet = join(tmp(), "quiet.mjs");
    writeFileSync(quiet, 'export default (api) => { api.ui.status(`${api.document.info().name}: ${api.document.scenario().units.length} units`); };\n');
    const r = await runOnMap(await open(), testMap("ums.scx"), bytes(), quiet, { out: join(tmp(), "never.scx") });
    expect(r.modified).toBe(false);
    expect(r.diff).toBeNull();
    expect(r.events[0].text).toBe("Test Scenario: 21 units");
    // --out with no change still writes the map, as asked.
    expect(r.written).not.toBeNull();
    expect(visible(printRun("ums.scx", r).join("\n"))).toMatch(/quiet ran · unchanged, written to/);

    const ts = join(tmp(), "rename.ts");
    writeFileSync(ts, 'import type { PluginApi } from "@scm-js/plugin-api";\nexport default function activate(api: PluginApi): void {\n  const n: string = "From TypeScript";\n  api.document.update("Rename", (tx) => tx.properties({ name: n }));\n}\n');
    const out = join(tmp(), "ts.scx");
    const t = await runOnMap(await open(), testMap("ums.scx"), bytes(), ts, { out });
    expect(t.modified).toBe(true);
    expect(scenarioName((await openMapBytes(new Uint8Array(readFileSync(out)), "ts.scx")).scenario)).toBe("From TypeScript");
  });

  it("says why a plugin did not run", async () => {
    const throwing = join(tmp(), "bad.mjs");
    writeFileSync(throwing, 'export default () => { throw new Error("no thanks"); };\n');
    await expect(runOnMap(await open(), testMap("ums.scx"), bytes(), throwing)).rejects.toThrow(CliError);
    await expect(runOnMap(await open(), testMap("ums.scx"), bytes(), throwing)).rejects.toThrow(/failed in activate: no thanks/);
    const empty = tmp();
    await expect(runOnMap(await open(), testMap("ums.scx"), bytes(), empty)).rejects.toThrow(/Could not fetch .*plugin\.json/);
    const noActivate = join(tmp(), "none.mjs");
    writeFileSync(noActivate, "export const x = 1;\n");
    await expect(runOnMap(await open(), testMap("ums.scx"), bytes(), noActivate)).rejects.toThrow(/exports no activate function/);
    const newer = plugin({ "plugin.js": EDITING }, { api: 99 });
    await expect(runOnMap(await open(), testMap("ums.scx"), bytes(), newer)).rejects.toThrow(/plugin API 99/);
  });
});
