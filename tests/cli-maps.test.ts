/**
 * The `scmjs map` commands that take a map apart and put it back (cli/src/exchange.ts), compare two maps
 * (cli/src/diff.ts) and the shell completions made from the command tree (cli/src/completion.ts). Everything runs on
 * the committed maps in tests/maps; writes go to a temporary folder.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openMapBytes } from "../src/editor/mapFile";
import { readTriggers, sameTriggers } from "../src/editor/triggers";
import { applyUnitChanges, removeUnits } from "../src/editor/units";
import { validateScenario } from "../src/editor/validate";
import { scenarioName } from "../src/formats/chk/scenario";
import { PlayerType } from "../src/formats/chk/sections/players";
import { START_LOCATION } from "../src/data/units";
import { commandTree, completionScript, SHELLS } from "../cli/src/completion";
import { nameFromFile, newScenario, parseSize, parseTileset, writeNewMap, type NewMapOptions } from "../cli/src/create";
import { diffMaps, printDiff } from "../cli/src/diff";
import { dumpMap, printDump, sectionBytes, unitLine } from "../cli/src/dump";
import { findInMap, KINDS, parseKinds, printHits } from "../cli/src/find";
import { exportStrings, exportTriggers, importStrings, importTriggers, writeBack } from "../cli/src/exchange";
import { program } from "../cli/src/main";
import { CliError, visible } from "../cli/src/ui";
import { testMap } from "./support/maps";

const open = async (name: string) => openMapBytes(new Uint8Array(readFileSync(testMap(name))), name);
const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-maps-"));

describe("scmjs map triggers", () => {
  it("exports the text form and reads it back to the same triggers", async () => {
    const doc = await open("ums.scx");
    const out = exportTriggers(doc, null);
    expect(out.count).toBe(3);
    expect(out.text).toContain('Trigger("Player 1"){');
    const copy = await open("ums.scx");
    const r = importTriggers(copy, "t.txt", new TextEncoder().encode(out.text!));
    expect(r).toEqual({ before: 3, after: 3, read: 3 });
    expect(sameTriggers(readTriggers(copy.scenario), readTriggers(doc.scenario))).toBe(true);
  });

  it("writes .trg records by the file's extension, and appends", async () => {
    const doc = await open("ums.scx");
    const trg = exportTriggers(doc, "out.trg");
    expect(trg.text).toBeNull();
    expect(trg.bytes!.length).toBe(3 * 2400);
    const r = importTriggers(doc, "out.trg", trg.bytes!, { append: true });
    expect(r).toEqual({ before: 3, after: 6, read: 3 });
    expect(readTriggers(doc.scenario)).toHaveLength(6);
  });

  it("does the briefing too, and refuses text it cannot resolve with the line", async () => {
    const doc = await open("ums.scx");
    expect(exportTriggers(doc, null, true).text).toContain("Mission Briefing()");
    const bad = new TextEncoder().encode('Trigger("Player 1"){\nConditions:\n\tNoSuchCondition();\n}\n');
    expect(() => importTriggers(doc, "bad.txt", bad)).toThrow(CliError);
    expect(() => importTriggers(doc, "bad.txt", bad)).toThrow(/bad\.txt, line 3/);
    expect(readTriggers(doc.scenario)).toHaveLength(3);
  });
});

describe("scmjs map strings", () => {
  it("exports one line per string and imports in place and past the end", async () => {
    const doc = await open("ums.scx");
    const out = exportStrings(doc);
    expect(out.count).toBe(20);
    expect(out.text.split("\n")[0]).toBe("1\tTest Scenario");
    const r = importStrings(doc, "s.txt", "3\tRenamed\n30\tNew one\n# a comment\n");
    expect(r).toEqual({ replaced: 1, added: 1, unchanged: 0 });
    expect(doc.scenario.strings.strings[3]).toBe("Renamed");
    expect(doc.scenario.strings.strings[30]).toBe("New one");
    expect(() => importStrings(doc, "s.txt", "not a line\n")).toThrow(/s\.txt, line 1/);
  });
});

describe("scmjs: writing a map back", () => {
  it("keeps the archive's members and the format of the name it is given", async () => {
    const dir = tmp();
    const doc = await open("ums.scx");
    importStrings(doc, "s.txt", "1\tWritten back\n");
    const w = await writeBack(doc, testMap("ums.scx"), join(dir, "copy.scm"));
    expect(w.path).toBe(join(dir, "copy.scm"));
    const again = await openMapBytes(new Uint8Array(readFileSync(w.path)), "copy.scm");
    expect(again.scenario.strings.strings[1]).toBe("Written back");
    expect([...again.extras.keys()].map((k) => k.toLowerCase())).toEqual([...doc.extras.keys()].map((k) => k.toLowerCase()));
    expect(again.origin?.compression).toBe(doc.origin?.compression);
    expect(readTriggers(again.scenario)).toHaveLength(3);
  });
});

describe("scmjs map diff", () => {
  it("finds nothing between a map and itself", async () => {
    const a = await open("ums.scx");
    const d = diffMaps({ name: "a", doc: a }, { name: "b", doc: await open("ums.scx") });
    expect(d.same).toBe(true);
    expect(printDiff(d).map(visible).at(-1)).toMatch(/The maps are the same/);
  });

  it("says what changed, in the map's terms", async () => {
    const a = await open("ums.scx"), b = await open("ums.scx");
    importStrings(b, "s.txt", "3\tRenamed\n");
    importTriggers(b, "t.trg", exportTriggers(a, "t.trg").bytes!.subarray(0, 2400), { append: true });
    applyUnitChanges(b.scenario, removeUnits(b.scenario, [b.scenario.units.length - 1]));
    const d = diffMaps({ name: "a", doc: a }, { name: "b", doc: b });
    expect(d.same).toBe(false);
    expect(d.strings).toEqual([{ change: "changed", text: "3", a: "Force 1", b: "Renamed" }]);
    expect(d.triggers).toHaveLength(1);
    expect(d.triggers[0].change).toBe("added");
    expect(d.units).toHaveLength(1);
    expect(d.units[0].change).toBe("removed");
    expect(d.players).toEqual([]);
    expect(d.sections.map((s) => s.name).sort()).toEqual(["STR ", "TRIG", "UNIT"].sort());
    const lines = printDiff(d).map(visible);
    expect(lines.some((l) => l.startsWith("Triggers +1"))).toBe(true);
    expect(lines.some((l) => l === "  ~ 3  Force 1 → Renamed")).toBe(true);
  });

  it("compares two different maps across every group, and cuts long lists", async () => {
    const d = diffMaps({ name: "ums.scx", doc: await open("ums.scx") }, { name: "melee.scx", doc: await open("melee.scx") });
    expect(d.header.map((f) => f.field)).toContain("Name");
    expect(d.players.length).toBeGreaterThan(0);
    expect(d.units.length + d.locations.length + d.triggers.length).toBeGreaterThan(0);
    const cut = printDiff(d).map(visible), all = printDiff(d, true).map(visible);
    expect(all.length).toBeGreaterThanOrEqual(cut.length);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });
});

describe("scmjs map dump", () => {
  it("says everything the map holds, part by part, in a form that is the same twice over", async () => {
    const doc = await open("ums.scx");
    const d = dumpMap(doc, "ums.scx");
    const text = printDump(d, doc.scenario);
    expect(text.split("\n")[0]).toBe("# ums.scx — scmjs map dump 1");
    for (const part of ["## Map", "## Players", "## Forces", "## Units (21)", "## Locations (4)", "## Triggers (3)", "## Briefing (1)", "## Strings (", "## Archive members (1)", "## Sections"]) expect(text).toContain(part);
    expect(text).toContain("  Name         Test Scenario");
    expect(text).toContain("  1  Human      Terran           Red      force 1");
    expect(text).toContain("  Start Location  Player 1  336,1744");
    expect(text).toContain('Trigger("Player 1"){');
    expect(text).toContain("  13\tTest Marine");
    expect(text).toMatch(/ {2}staredit\\wav\\tone\.wav {2}\d+ B {2}sha1 [0-9a-f]{12}/);
    expect(text).toMatch(/ {2}TRIG {2}\d+ B/);
    expect(visible(text)).toBe(text);
    const again = await open("ums.scx");
    expect(printDump(dumpMap(again, "ums.scx"), again.scenario)).toBe(text);
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
    expect(d.units).toHaveLength(21);
    expect(d.strings[0]).toBe("Test Scenario");
  });

  it("shows a change where it is and nowhere else", async () => {
    const a = await open("ums.scx"), b = await open("ums.scx");
    importStrings(b, "s.txt", "3\tRenamed\n");
    const [ta, tb] = [printDump(dumpMap(a, "x"), a.scenario).split("\n"), printDump(dumpMap(b, "x"), b.scenario).split("\n")];
    const changed = ta.filter((l) => !tb.includes(l));
    // String 3 is not a force's name in this map, and "Renamed" is as long as "Force 1": only the one line moves.
    expect(changed).toEqual(["  3\tForce 1"]);
    expect(tb.filter((l) => !ta.includes(l))).toEqual(["  3\tRenamed"]);
    expect(sectionBytes(b.scenario).get("STR ")).not.toEqual(sectionBytes(a.scenario).get("STR "));
  });

  it("words a unit's record: what, whose, where and the properties that are set", async () => {
    const { scenario } = await open("ums.scx");
    expect(unitLine(scenario.units[1])).toBe("Mineral Field (Type 1)  Neutral  176,1552  resources 1500");
    expect(unitLine(scenario.units.find((u) => u.hangarUnits)!)).toMatch(/^Protoss Carrier {2}Player 1 {2}\d+,\d+ {2}hangar 4$/);
  });
});

describe("scmjs map find", () => {
  it("finds what the Find dialog finds, kind by kind, and says where", async () => {
    const doc = await open("ums.scx");
    const hits = findInMap(doc, "ums.scx", "marine", KINDS);
    expect(hits.map((h) => h.kind)).toEqual(["units", "strings", "strings", "triggers"]);
    expect(hits[0]).toMatchObject({ file: "ums.scx", label: "Test Marine", x: 14.5, y: 50.5 });
    expect(findInMap(doc, "ums.scx", "Marine", KINDS, true).map((h) => h.kind)).toEqual(["units", "strings", "strings", "triggers"]);
    expect(findInMap(doc, "ums.scx", "MARINE", KINDS, true)).toEqual([]);
    expect(findInMap(doc, "ums.scx", "middle", ["locations"]).map((h) => h.label)).toEqual(["Middle"]);
    expect(findInMap(doc, "ums.scx", "zzzz", KINDS)).toEqual([]);
    const lines = printHits(hits).map(visible);
    expect(lines[0]).toBe("  unit     Test Marine  Player 1 · 14, 50");
    expect(lines[3]).toMatch(/^ {2}trigger {2}Trigger 1 {2}Bring a Marine/);
  });
  it("takes --in as the kinds, and refuses one it does not know", () => {
    expect(parseKinds(undefined)).toEqual(KINDS);
    expect(parseKinds("strings, Units,strings")).toEqual(["strings", "units"]);
    expect(() => parseKinds("units,maps")).toThrow(CliError);
  });
});

describe("scmjs map new", () => {
  const base: NewMapOptions = { width: 96, height: 64, tileset: "jungle", name: "Ridge", description: "A test.", version: "broodwar", players: 2, layout: "ring" };

  it("reads a size and a tileset the way the New dialog offers them", () => {
    expect(parseSize("128x96")).toEqual({ width: 128, height: 96 });
    expect(parseSize("64")).toEqual({ width: 64, height: 64 });
    expect(parseSize("256 × 192")).toEqual({ width: 256, height: 192 });
    for (const bad of ["100x100", "128by96", ""]) expect(() => parseSize(bad), bad).toThrow(CliError);
    expect(parseTileset("Jungle World")).toBe("jungle");
    expect(parseTileset("ICE")).toBe("ice");
    expect(() => parseTileset("moon")).toThrow(CliError);
    expect(nameFromFile("maps/(2)Ridge.scx")).toBe("(2)Ridge");
  });

  it("makes the map File ▸ New makes: flat ground, the players asked for and their start locations, passing Check Map", () => {
    const { scenario, starts } = newScenario(base);
    expect([scenario.width, scenario.height, scenario.era]).toEqual([96, 64, 4]);
    expect(scenarioName(scenario)).toBe("Ridge");
    expect(starts).toBe(2);
    expect(scenario.units.filter((u) => u.unitId === START_LOCATION).map((u) => u.owner)).toEqual([0, 1]);
    expect(scenario.playerTypes.slice(0, 8)).toEqual([PlayerType.Human, PlayerType.Human, ...Array(6).fill(PlayerType.Inactive)]);
    expect(scenario.tiles.every((t) => t !== 0)).toBe(true);
    expect(validateScenario(scenario).filter((i) => i.level === "error")).toEqual([]);
    const open8 = newScenario({ ...base, players: 0 });
    expect(open8.starts).toBe(0);
    expect(open8.scenario.playerTypes.slice(0, 8).every((t) => t === PlayerType.Human)).toBe(true);
    expect(newScenario({ ...base, version: "remastered" }).scenario.fileVersion).toBe(206);
  });

  it("writes a file that opens again as that map, the same bytes for the same arguments", async () => {
    const dir = tmp();
    const r = await writeNewMap(join(dir, "ridge.scx"), base);
    expect(existsSync(r.path)).toBe(true);
    expect(r).toMatchObject({ starts: 2, width: 96, height: 64, tileset: "Jungle World", version: "Brood War 1.04" });
    const reopened = await openMapBytes(new Uint8Array(readFileSync(r.path)), "ridge.scx");
    expect(scenarioName(reopened.scenario)).toBe("Ridge");
    expect(reopened.scenario.units).toHaveLength(2);
    expect(reopened.origin?.compression).toBe("pkware");
    const twice = await writeNewMap(join(dir, "again.scx"), base);
    expect(Buffer.from(readFileSync(twice.path)).equals(readFileSync(r.path))).toBe(true);
    const chk = await writeNewMap(join(dir, "bare.chk"), base);
    expect((await openMapBytes(new Uint8Array(readFileSync(chk.path)), "bare.chk")).scenario.width).toBe(96);
  });
});

describe("scmjs completion", () => {
  const tree = commandTree(program);
  const names = (n: ReturnType<typeof commandTree>): string[] => [n.name, ...n.children.flatMap(names)];

  it("is made from the command tree, hidden commands and help left out", () => {
    const all = names(tree);
    for (const n of ["info", "map", "triggers", "export", "import", "strings", "diff", "replay", "plugin", "bot", "about"]) expect(all).toContain(n);
    expect(all).not.toContain("completion");
    expect(all).not.toContain("help");
  });

  it("writes a script for each shell that names every command", () => {
    for (const shell of SHELLS) {
      const script = completionScript(program, shell);
      for (const n of names(tree).slice(1)) expect(script, `${shell}: ${n}`).toContain(n);
      expect(script).toContain(shell === "fish" ? "-l json" : "--json");
    }
    expect(completionScript(program, "zsh").startsWith("#compdef scmjs")).toBe(true);
    expect(completionScript(program, "fish")).toContain("complete -c scmjs -n '__fish_use_subcommand' -a map");
  });

  it("writes bash that bash accepts", () => {
    const has = spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0;
    if (!has) return;
    const file = join(tmp(), "scmjs.bash");
    writeFileSync(file, completionScript(program, "bash"));
    const r = spawnSync("bash", ["-n", file], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
