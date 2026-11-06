/**
 * The `scmjs map` commands that take a map apart and put it back (cli/src/exchange.ts), compare two maps
 * (cli/src/diff.ts) and the shell completions made from the command tree (cli/src/completion.ts). Everything runs on
 * the committed maps in tests/maps; writes go to a temporary folder.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openMapBytes } from "../src/editor/mapFile";
import { readTriggers, sameTriggers } from "../src/editor/triggers";
import { applyUnitChanges, removeUnits } from "../src/editor/units";
import { commandTree, completionScript, SHELLS } from "../cli/src/completion";
import { diffMaps, printDiff } from "../cli/src/diff";
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
