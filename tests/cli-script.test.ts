/**
 * A map's TrigScript script read, written and looked up without the editor: the declarations cut into entries and
 * searched (cli/src/scriptapi.ts), the script's files put into a map (cli/src/build.ts), the three tools over them
 * (`map_script_export`, `map_script_import`, `map_script_api`), and which TypeScript the build takes. The suites that
 * need the compiler run where the plugin is vendored (`npm run vendor:plugins`), as cli-build.test.ts does.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { openMapBytes } from "../src/editor/mapFile";
import { changeScript, loadTypeScript, locateTypeScript, readScript, scriptDeclarations, type ScriptReport } from "../cli/src/build";
import { buildProgram } from "../cli/src/main";
import { importScript, lookUpApi, printScriptImport, scriptFilesFrom, scriptFilesWanted, scriptHeader, scriptNames, scriptStateWords, scriptText, writeScriptFiles } from "../cli/src/script";
import { createMcpServer } from "../cli/src/mcp";
import { API_BUDGET, apiEntries, apiOverview, searchApi } from "../cli/src/scriptapi";
import { CliError, visible } from "../cli/src/ui";
import { TEST_MAPS_DIR, testMap } from "./support/maps";

const have = existsSync(join(import.meta.dirname, "..", "plugins", "trigscript", "script.ts"));
const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-script-"));
const ums = async () => openMapBytes(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx");
async function refused(f: () => unknown): Promise<string> {
  try { await f(); } catch (e) { if (e instanceof CliError) return e.hint ? `${e.message} | ${e.hint}` : e.message; throw e; }
  throw new Error("not refused");
}

/** Declarations laid out as the generator lays them out, small enough to read. */
const SAMPLE = `// ── TrigScript ────────────────────────────────────────────────
// Generated for the open map; rebuilt whenever the map's names change. Do not edit.
//
// A script is ordinary TypeScript that runs when you build.

type Brand<K extends string> = { readonly __kind?: K };
/** A location (locations.*). */
type Location<N extends number = number> = N & Brand<"location">;

/**
 * Define one trigger. A body with braces: \`program(() => { … })\`.
 * @param players The player the trigger runs for.
 */
declare function trigger(players: number, conditions: unknown[], actions: unknown[]): void;

/** A unit on the map. */
interface Unit {
  /** Hit points, in whole points. */
  hp: number;
  /** Who owns the unit. */
  readonly owner: number;
${Array.from({ length: 50 }, (_, i) => `  /** Field ${i}. */\n  f${i}: number;`).join("\n")}
}

// ── Conditions ──
/** Bring — Player, Unit, Location, Comparison, Amount */
declare function bring(player: number, unit: number, location: number, comparison: string, amount: number): unknown;
/** Bring, as a number: what the condition compares. */
declare function bring(player: number, unit: number, location: number): number;

// ── Actions ──
/** Display Text Message — Display, Text */
declare function displayText(text: string, always?: boolean): unknown;
declare function __hidden(): void;

// ── The map ──
/** Player 1 */
declare const P1: number;
declare const locations: {
  readonly NoLocation: Location<0>;
  readonly "No Location": Location<0>;
  /** Elder (location 1) */
  readonly Elder: Location<1>;
  readonly Location7: Location<7>;
  readonly Anywhere: Location<64>;
};
declare const units: {
${Array.from({ length: 60 }, (_, i) => `  readonly Unit${i}: number;`).join("\n")}
  /** Terran Marine */
  readonly TerranMarine: number;
};

// ── The same names, as a module: import { trigger, units } from "trigscript"; ──
declare module "trigscript" {
  export function trigger(players: number): void;
  export function onlyInTheModule(): void;
}
`;

describe("TrigScript's declarations as something to search", () => {
  const entries = apiEntries(SAMPLE);

  it("cuts the text into entries, a declaration with the comment above it, by section, and stops at the repeat", () => {
    expect(entries.map((e) => `${e.section}/${e.kind}/${e.name}`)).toEqual([
      "The language/type/Brand", "The language/type/Location", "The language/function/trigger", "The language/interface/Unit",
      "Conditions/function/bring", "Conditions/function/bring", "Actions/function/displayText", "Actions/function/__hidden",
      "The map/const/P1", "The map/const/locations", "The map/const/units",
    ]);
    const trigger = entries.find((e) => e.name === "trigger")!;
    expect(trigger.lines[0]).toBe("/**");
    expect(trigger.lines.at(-1)).toBe("declare function trigger(players: number, conditions: unknown[], actions: unknown[]): void;");
    expect(entries.find((e) => e.name === "Unit")!.lines.at(-1)).toBe("}");
    expect(entries.some((e) => e.name === "onlyInTheModule")).toBe(false);
  });

  it("finds what holds every word, a name before a mention, and a long entry by its matching members", () => {
    const text = searchApi(entries, "display text");
    expect(text.lines).toEqual(["// ── Actions ──", "/** Display Text Message — Display, Text */", "declare function displayText(text: string, always?: boolean): unknown;", ""]);
    // Both overloads, each an entry.
    expect(searchApi(entries, "BRING").shown).toBe(2);
    // A table of sixty names answers with the one asked for; so does an interface, by a member's documentation.
    expect(searchApi(entries, "marine").lines).toEqual(["// ── The map ──", "declare const units: {", "  /** Terran Marine */", "  readonly TerranMarine: number;", "  …", ""]);
    expect(searchApi(entries, "owns").lines.slice(1, 5)).toEqual(["interface Unit {", "  /** Who owns the unit. */", "  readonly owner: number;", "  …"]);
    // Asked for by its own name, a long entry comes whole.
    expect(searchApi(entries, "Unit").lines.slice(0, 3)).toEqual(["// ── The language ──", "/** A unit on the map. */", "interface Unit {"]);
    expect(searchApi(entries, "Unit").lines).toContain("  f49: number;");
    expect(searchApi(entries, "elder").lines).toContain("  readonly Elder: Location<1>;");
    expect(searchApi(entries, "nothing-here")).toEqual({ lines: [], shown: 0, more: [] });
    expect(searchApi(entries, "  ")).toEqual({ lines: [], shown: 0, more: [] });
  });

  it("keeps to its budget and names what it left out", () => {
    const a = searchApi(entries, "number", 300);
    expect(a.shown).toBeGreaterThan(0);
    expect(a.more.length).toBeGreaterThan(0);
    expect(a.shown + a.more.length).toBeLessThanOrEqual(entries.length);
    expect(API_BUDGET).toBeGreaterThan(5000);
  });

  it("lists what there is: the opening lines, each section's names, the map's own names and a count of the game's", () => {
    const o = apiOverview(SAMPLE, entries);
    expect(o.slice(0, 3)).toEqual(["TrigScript", "", "A script is ordinary TypeScript that runs when you build."]);
    expect(o).toContain("  functions: trigger");
    expect(o).toContain("  types: Brand, Location, Unit");
    expect(o).toContain("  functions: bring");
    // What the map never named, and what a script does not write, are left out.
    expect(o).toContain("  functions: displayText");
    expect(o).toContain("  locations.*: NoLocation, Elder, Anywhere");
    expect(o).toContain("  units.*: 61 names");
    expect(o.join("\n")).not.toMatch(/__hidden|Location7|Generated for/);
  });
});

describe("which TypeScript a build takes", () => {
  /** A folder with a `typescript` package of a version in it, as npm leaves one. */
  function project(version: string, main = "lib/typescript.js") {
    const dir = tmp(), pkg = join(dir, "node_modules", "typescript");
    mkdirSync(join(pkg, "lib"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "typescript", version, main }));
    writeFileSync(join(pkg, main), "module.exports = { version: '0' };\n");
    return dir;
  }

  it("passes over one too new to drive and says which, taking the next place's", async () => {
    const seven = project("7.0.2", "lib/version.cjs");
    const found = locateTypeScript(seven);
    expect(found.unusable).toEqual([{ path: join(seven, "node_modules", "typescript", "lib", "version.cjs"), version: "7.0.2" }]);
    // The repository's own, beside the command, is the next place.
    expect(found.path).toMatch(/node_modules[\\/]typescript[\\/]lib[\\/]typescript\.js$/);
    const six = project("6.0.3");
    expect(locateTypeScript(six)).toEqual({ path: join(six, "node_modules", "typescript", "lib", "typescript.js"), unusable: [] });
  });

  it("passes over TypeScript 5 for a script, which it refuses on the first line, and takes it for a plugin's source", () => {
    const five = project("5.9.3"), at = join(five, "node_modules", "typescript", "lib", "typescript.js");
    const found = locateTypeScript(five);
    expect(found.unusable).toEqual([{ path: at, version: "5.9.3" }]);
    expect(found.path).not.toBe(at);
    expect(locateTypeScript(five, process.execPath, "npm", "plugin")).toEqual({ path: at, unusable: [] });
    // 7 has no compiler to call at all: a plugin cannot use it either.
    const seven = project("7.0.2", "lib/version.cjs");
    expect(locateTypeScript(seven, process.execPath, "npm", "plugin").unusable).toHaveLength(1);
  });

  it("looks beside a single executable for the copy an MCP bundle carries", () => {
    const dir = tmp(), exe = join(dir, "server", "scmjs");
    mkdirSync(join(dir, "server", "typescript", "lib"), { recursive: true });
    writeFileSync(join(dir, "server", "typescript", "package.json"), JSON.stringify({ name: "typescript", version: "6.0.3" }));
    writeFileSync(join(dir, "server", "typescript", "lib", "typescript.js"), "");
    expect(locateTypeScript(tmp(), exe, "binary").path).toBe(join(dir, "server", "typescript", "lib", "typescript.js"));
    // The project's own comes first, when it has one.
    const own = project("6.0.3");
    expect(locateTypeScript(own, exe, "binary").path).toBe(join(own, "node_modules", "typescript", "lib", "typescript.js"));
  });

  it("loads the repository's TypeScript", async () => {
    expect((await loadTypeScript()).version).toBe(JSON.parse(readFileSync("node_modules/typescript/package.json", "utf8")).version);
  });
});

describe("scmjs map script: the files a command names", () => {
  it("takes a file under its own name, a folder's files at their paths inside it, and main.ts from standard input", async () => {
    const dir = tmp();
    mkdirSync(join(dir, "src", "quests"), { recursive: true });
    mkdirSync(join(dir, "src", "node_modules", "x"), { recursive: true });
    writeFileSync(join(dir, "src", "main.ts"), "\uFEFFexport {};\n");
    writeFileSync(join(dir, "src", "quests", "shop.tsx"), "export const price = 150;\n");
    // What an editor's project has and a script does not.
    writeFileSync(join(dir, "src", "trigscript.d.ts"), "declare const x: number;\n");
    writeFileSync(join(dir, "src", "node_modules", "x", "index.ts"), "export {};\n");
    writeFileSync(join(dir, "src", "notes.md"), "notes\n");
    expect(await scriptFilesFrom([join(dir, "src")])).toEqual({ "main.ts": "export {};\n", "quests/shop.tsx": "export const price = 150;\n" });
    expect(await scriptFilesFrom([join(dir, "src", "quests", "shop.tsx")])).toEqual({ "shop.tsx": "export const price = 150;\n" });
    expect(await scriptFilesFrom(["-"], Readable.from([Buffer.from("trigger(P1, [], []);\n")]))).toEqual({ "main.ts": "trigger(P1, [], []);\n" });
    expect(await refused(() => scriptFilesFrom([join(dir, "src"), join(dir, "src", "main.ts")]))).toMatch(/^main\.ts is given twice/);
    expect(await refused(() => scriptFilesFrom([join(dir, "nowhere.ts")]))).toMatch(/^No file /);
    mkdirSync(join(dir, "empty"));
    expect(await refused(() => scriptFilesFrom([join(dir, "empty")]))).toMatch(/has no \.ts or \.tsx files\.$/);
  });

  it("prints one file as it is and several each under its name, and writes them into a folder at their names", async () => {
    const r = { files: { "quests/shop.ts": "export const price = 150;", "main.ts": "export {};\n" }, state: "unbuilt", block: null, programs: 0, libraries: [], trigscript: "4" } as ScriptReport;
    expect(scriptNames(r.files)).toEqual(["main.ts", "quests/shop.ts"]);
    expect(scriptText(r, ["quests/shop.ts"])).toBe("export const price = 150;\n");
    expect(scriptText(r, ["main.ts", "quests/shop.ts"])).toBe("// ── main.ts ──\nexport {};\n\n// ── quests/shop.ts ──\nexport const price = 150;\n");
    expect(scriptFilesWanted("a.scx", "a.scx", r, [])).toEqual(["main.ts", "quests/shop.ts"]);
    expect(scriptFilesWanted("a.scx", "a.scx", r, ["trigscript\\quests\\shop.ts"])).toEqual(["quests/shop.ts"]);
    expect(await refused(() => scriptFilesWanted("a.scx", "a.scx", r, ["gone.ts"]))).toBe("The script has no file gone.ts | It has main.ts, quests/shop.ts.");
    expect(await refused(() => scriptFilesWanted("a.scx", "maps/a.scx", { ...r, files: {}, state: "none" }, []))).toBe("a.scx has no TrigScript script. | scmjs map script import writes one: scmjs map script import maps/a.scx main.ts");
    const dir = join(tmp(), "out");
    expect(await writeScriptFiles(dir, r, ["main.ts", "quests/shop.ts"])).toEqual([join(dir, "main.ts"), join(dir, "quests", "shop.ts")]);
    expect(readFileSync(join(dir, "quests", "shop.ts"), "utf8")).toBe("export const price = 150;");
    // How the script stands to the map's triggers, in the header's words.
    expect(scriptStateWords(r)).toBe("not applied: the script was never built; scmjs map build applies it");
    expect(scriptStateWords({ ...r, state: "applied", block: { start: 3, count: 2 }, programs: 1 })).toBe("applied: triggers #4 to #5 of the map are this script's, with 1 program (the map needs StarCraft: Remastered)");
    expect(scriptStateWords({ ...r, block: { start: 3, count: 2 } })).toMatch(/^not applied: the files changed since the map's triggers were made from them \(triggers #4 to #5\)/);
    expect(visible(scriptHeader("a.scx", r))).toBe("a.scx: 2 files, 36 B · not applied: the script was never built; scmjs map build applies it");
  });

  it("has the commands, each in the map group's help", () => {
    const map = buildProgram().commands.find((c) => c.name() === "map")!;
    const script = map.commands.find((c) => c.name() === "script")!;
    expect(script.commands.map((c) => c.name()).filter((n) => n !== "help")).toEqual(["export", "import", "api"]);
  });
});

describe.skipIf(!have)("scmjs map script: in and out of a map", () => {
  it("writes the files and says whether they compile, keeping them either way, and looks names up for the map", async () => {
    const dir = tmp(), map = join(dir, "ums.scx");
    copyFileSync(testMap("ums.scx"), map);
    const open = async () => openMapBytes(new Uint8Array(readFileSync(map)), "ums.scx");
    const bad = await importScript(await open(), map, { "main.ts": 'trigger(P1, [always()], [displayText(locations.Gate)]);\n' }, null);
    expect(bad).toMatchObject({ added: ["main.ts"], compiles: false, unchecked: null, written: { path: map } });
    const lines = printScriptImport("ums.scx", bad).map(visible);
    expect(lines[0]).toMatch(/^ums\.scx: main\.ts added · written to .*ums\.scx · /);
    expect(lines[1]).toMatch(/^main\.ts:1:\d+ error Property 'Gate' does not exist/);
    expect(lines.at(-1)).toMatch(/^✖ 1 error in the script\. The files are kept in the map: import the corrected ones\.$/);
    // Kept in the file, though it does not compile.
    expect((await readScript(await open())).files).toEqual({ "main.ts": 'trigger(P1, [always()], [displayText(locations.Gate)]);\n' });
    const good = await importScript(await open(), map, { "main.ts": 'trigger(P1, [always()], [displayText("hi")]);\n' }, null);
    expect(good).toMatchObject({ changed: ["main.ts"], compiles: true });
    expect(printScriptImport("ums.scx", good).map(visible).slice(1)).toEqual([expect.stringMatching(/^✔ compiles: 1 trigger · TrigScript \S+, TypeScript \S+$/), "The map's triggers are as they were: scmjs map build applies the script."]);
    // The map's triggers wait for a build.
    expect((await readScript(await open())).state).toBe("unbuilt");
    await expect(importScript(await ums(), join(dir, "bare.chk"), { "main.ts": "export {};" }, null)).rejects.toThrow(/A bare \.chk has nowhere to keep a script/);

    const doc = await open();
    const overview = await lookUpApi(doc, "ums.scx", "");
    expect(overview.lines[0]).toBe("TrigScript, as ums.scx has them. Words after the command give a name's declaration and documentation.");
    expect(overview.lines.join("\n")).toMatch(/locations\.\*: .*Middle/);
    const found = await lookUpApi(null, null, "display text");
    expect(found.shown).toBeGreaterThan(0);
    expect(found.lines.join("\n")).toContain("declare function displayText(");
    expect((await lookUpApi(null, null, "nosuchthingatall")).lines).toEqual(['Nothing in TrigScript holds "nosuchthingatall" (with the game\'s own names). Fewer words find more; with none every name is listed.']);
  });
});

describe.skipIf(!have)("a map's script, read and written", () => {
  it("says a map has none, then keeps the files given and tells them apart from what was there", async () => {
    const doc = await ums();
    expect(await readScript(doc)).toMatchObject({ files: {}, state: "none", block: null, programs: 0 });
    expect(await changeScript(doc, { "main.ts": "trigger(P1, [always()], []);\n", "quests/shop.ts": "export const price = 150;\n" })).toEqual({ added: ["main.ts", "quests/shop.ts"], changed: [], removed: [], unchanged: [] });
    expect([...doc.extras.keys()].filter((k) => k.startsWith("trigscript")).sort()).toEqual(["trigscript\\main.ts", "trigscript\\quests\\shop.ts"]);
    // Never built: the map's triggers are not this script's yet.
    expect(await readScript(doc)).toMatchObject({ state: "unbuilt", files: { "main.ts": "trigger(P1, [always()], []);\n", "quests/shop.ts": "export const price = 150;\n" } });
    expect(await changeScript(doc, { "main.ts": "trigger(P1, [always()], []);\n", "quests/shop.ts": "export const price = 200;\n", "notes.ts": "export {};\n" })).toEqual({ added: ["notes.ts"], changed: ["quests/shop.ts"], removed: [], unchanged: ["main.ts"] });
    expect(await changeScript(doc, { "notes.ts": null })).toEqual({ added: [], changed: [], removed: ["notes.ts"], unchanged: [] });
    expect(Object.keys((await readScript(doc)).files).sort()).toEqual(["main.ts", "quests/shop.ts"]);
  });

  it("refuses a name a script cannot use, a file that is not there, a script without its first file, and taking the last file out", async () => {
    const doc = await ums();
    expect(await refused(() => changeScript(doc, { "../evil.ts": "x" }))).toMatch(/^"\.\.\/evil\.ts" is not a name a script's file can have\. \| Letters, digits/);
    expect(await refused(() => changeScript(doc, { "main.js": "x" }))).toMatch(/is not a name/);
    expect(await refused(() => changeScript(doc, { "shop.ts": "export {};" }))).toBe("A script starts at main.ts, and this one would have none. | Write main.ts too; it imports the other files.");
    await changeScript(doc, { "main.ts": "export {};" });
    expect(await refused(() => changeScript(doc, { "gone.ts": null }))).toBe("The script has no file gone.ts to remove. | It has main.ts.");
    expect(await refused(() => changeScript(doc, { "main.ts": null }))).toMatch(/^That would leave the map with no script, and its triggers behind\./);
    // Nothing of a refused change stays.
    expect(Object.keys((await readScript(doc)).files)).toEqual(["main.ts"]);
  });

  it("generates the declarations for the map, with its own locations and switches by name", async () => {
    const text = await scriptDeclarations(await ums());
    const entries = apiEntries(text);
    // The layout scriptapi.ts reads, on the real text: the sections, the functions and the map's tables are found.
    expect([...new Set(entries.map((e) => e.section))]).toEqual(["The language", "Conditions", "Actions", "The map"]);
    for (const name of ["trigger", "program", "bring", "deaths", "displayText", "createUnit", "locations", "switches", "units"]) expect(entries.some((e) => e.name === name), name).toBe(true);
    const overview = apiOverview(text, entries).join("\n");
    expect(overview).toMatch(/^TrigScript\n\nA script is ordinary TypeScript/);
    expect(overview).toContain("  locations.*: NoLocation, Base, Nest, Middle, Anywhere");
    expect(overview).toContain("  switches.*: AlarmRaised");
    expect(overview).toMatch(/ {2}units\.\*: \d{3} names/);
    expect(searchApi(entries, "display text").lines.slice(0, 3)).toEqual(["// ── Actions ──", "/** Display Text Message — Display, Text */", "declare function displayText(text: string, always?: boolean): Action;"]);
    expect(searchApi(entries, "middle").lines.join("\n")).toMatch(/readonly Middle: Location<\d+>;/);
    // With no map, the game's own names.
    expect(apiOverview(await scriptDeclarations(null), apiEntries(await scriptDeclarations(null))).join("\n")).not.toContain("AlarmRaised");
  });
});

describe.skipIf(!have)("scmjs mcp: the script tools", () => {
  type Result = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  const text = (r: Result) => r.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  async function connected() {
    const dir = tmp(), map = join(dir, "ums.scx");
    copyFileSync(join(TEST_MAPS_DIR, "ums.scx"), map);
    const client = new Client({ name: "test", version: "0" });
    const { server } = createMcpServer({ root: dir });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Result;
    return { client, call, map, dir };
  }

  it("writes a script, says what does not compile by the map's own names, and builds it once it does", async () => {
    const { client, call, map } = await connected();
    try {
      const none = await call("map_script_export", { path: map });
      expect(text(none).split("\n")[0]).toBe("ums.scx has no TrigScript script.");
      expect(none.structuredContent).toMatchObject({ state: "none", files: [] });
      expect(text(await call("map_build", { path: map }))).toBe("ums.scx has no TrigScript script.\nmap_script_import writes one into the map.");

      const wrong = await call("map_script_import", { path: map, files: { "main.ts": 'import { hail } from "./hail";\nhail(locations.Midle);\n', "hail.ts": 'export function hail(where: Location) {\n  trigger(P1, [bring(P1, units.TerranMarine, where, ">=", 1)], [displayText("Hail.")]);\n}\n' } });
      expect(wrong.isError).toBeFalsy();
      const lines = text(wrong).split("\n");
      expect(lines[0]).toBe("ums.scx: main.ts, hail.ts added");
      expect(lines[1]).toMatch(/^main\.ts:2:16 error Property 'Midle' does not exist on type .*Did you mean 'Middle'\?/);
      expect(lines.slice(-3)).toEqual(["✖ 1 error in the script. The files are kept in the map; send the corrected ones.", expect.stringMatching(/^Written to .*ums\.scx/), "The map's triggers are as they were."]);
      expect(wrong.structuredContent).toMatchObject({ compiles: false, added: ["main.ts", "hail.ts"] });

      // Only the file that changes is sent; the other is kept.
      const right = await call("map_script_import", { path: map, files: { "main.ts": 'import { hail } from "./hail";\nhail(locations.Middle);\nhail(locations.Base);\n' } });
      expect(text(right).split("\n").slice(0, 2)).toEqual(["ums.scx: main.ts changed", expect.stringMatching(/^✔ compiles: 2 triggers {2}TrigScript \d+\.\d+\.\d+, TypeScript \d/)]);
      expect(text(right)).toMatch(/The map's triggers are as they were: map_build applies the script\.$/);
      expect(text(await call("map_script_export", { path: map })).split("\n")[0]).toMatch(/^ums\.scx: 2 files, \d+ B · not applied: the files changed since the map's triggers were made from them, or were never built; map_build applies them$/);

      const built = await call("map_build", { path: map });
      expect(built.isError).toBeFalsy();
      expect(text(built)).toMatch(/✔ ums\.scx: 2 triggers → #4–#5/);
      const after = await call("map_script_export", { path: map, files: ["hail.ts"] });
      expect(text(after).split("\n")).toEqual([expect.stringMatching(/^ums\.scx: 2 files, \d+ B · applied: triggers #4 to #5 of the map are this script's$/), expect.stringMatching(/^ {2}main\.ts {2}\d+ B, 4 lines$/), "", "── hail.ts ──", "export function hail(where: Location) {", '  trigger(P1, [bring(P1, units.TerranMarine, where, ">=", 1)], [displayText("Hail.")]);', "}", ""]);
      expect(after.structuredContent).toMatchObject({ state: "applied", block: { start: 3, count: 2 } });
      expect(text(await call("map_triggers_export", { path: map }))).toContain('Display Text Message(Always Display, "Hail.");');
    } finally { await client.close(); }
  });

  it("refuses what it cannot keep, and writes nothing then", async () => {
    const { client, call, map, dir } = await connected();
    try {
      const before = readFileSync(map);
      expect(text(await call("map_script_import", { path: map, files: {} }))).toBe("`files` is empty: give at least one file, such as main.ts");
      expect(text(await call("map_script_import", { path: map, files: { "shop.ts": "export {};" } }))).toMatch(/^A script starts at main\.ts/);
      expect(text(await call("map_script_import", { path: map, out: "bare.chk", files: { "main.ts": "export {};" } }))).toMatch(/^A bare \.chk has nowhere to keep a script\./);
      expect(text(await call("map_script_export", { path: map, files: ["nope.ts"] }))).toBe("ums.scx has no TrigScript script.\nmap_script_import writes one: a file main.ts, such as  trigger(P1, [bring(P1, units.AnyUnit, locations.Beacon, \">=\", 1)], [displayText(\"You found the beacon.\"), victory()]);\nmap_script_api says what a script can call, with this map's own locations, switches and units by name.");
      expect(readFileSync(map)).toEqual(before);
      expect(existsSync(join(dir, "bare.chk"))).toBe(false);
    } finally { await client.close(); }
  });

  it("looks the language up for a map: everything by name, then a search", async () => {
    const { client, call, map } = await connected();
    try {
      const all = await call("map_script_api", { path: map });
      expect(text(all).split("\n")[0]).toBe("TrigScript, as ums.scx has them. `search` gives a name's declaration and documentation.");
      expect(text(all)).toContain("  locations.*: NoLocation, Base, Nest, Middle, Anywhere");
      expect(text(all).length).toBeLessThan(9000);
      const found = await call("map_script_api", { path: map, search: "set switch" });
      expect(text(found)).toContain("declare function setSwitch(");
      expect(text(await call("map_script_api", { search: "zzzz" }))).toBe('Nothing in TrigScript holds "zzzz" (with the game\'s own names). Fewer words find more; with no `search` every name is listed.');
      expect(text(await call("map_script_api", {})).split("\n")[0]).toBe("TrigScript, with the game's own names. `search` gives a name's declaration and documentation.");
    } finally { await client.close(); }
  });
});
