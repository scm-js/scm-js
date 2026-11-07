/**
 * `scmjs map merge` (cli/src/merge.ts): three versions of a map merged part by part, and the command as git's merge
 * driver. The versions are the committed tests/maps/ums.scx edited with the editor's own functions, as the maps in
 * tests/maps are made; the git suite makes a repository in a temporary folder and skips where git is missing.
 */
import { execFile, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openMapBytes, type OpenedMap } from "../src/editor/mapFile";
import { applyForceSettings, readForceSettings, internString } from "../src/editor/settings";
import { applyLocationChanges, editLocation, locationName } from "../src/editor/locations";
import { addUnits, applyUnitChanges, updateUnits, removeUnits } from "../src/editor/units";
import { newAction, newCondition, newTrigger } from "../src/editor/triggers";
import { validateScenario, issueCounts } from "../src/editor/validate";
import { markDirty, scenarioDescription, scenarioName, serializeScenario, setScenarioDescription, setScenarioName } from "../src/formats/chk/scenario";
import { parseChk } from "../src/formats/chk/reader";
import { ActionType, ConditionType, PlayerGroup } from "../src/formats/chk/sections/triggers";
import { PlayerRace } from "../src/formats/chk/sections/players";
import { ATTRIBUTE_LINES, GIT_SETTINGS, initFolder, missingLines, printRecipe, readmeText } from "../cli/src/init";
import { readInput } from "../cli/src/files";
import { writeBack } from "../cli/src/exchange";
import { around, asMap, diff3Chunks, lcsMatch, mergeDocs, mergeList, printMerge, runMerge, stagedInputs, tileRegions } from "../cli/src/merge";
import { program } from "../cli/src/main";
import { visible } from "../cli/src/ui";
import { mapFiles, testMap } from "./support/maps";

const UMS = readFileSync(testMap("ums.scx"));
const open = () => openMapBytes(new Uint8Array(UMS), "ums.scx");
const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-merge-"));
const MARINE = 0, ZERGLING = 37;

/** A version of ums.scx: opened, changed by `edit`, written, and opened again from its bytes as the merge reads it. */
async function version(edit: (doc: OpenedMap) => void): Promise<OpenedMap> {
  const doc = await open();
  edit(doc);
  const path = join(tmp(), "v.scx");
  await writeBack(doc, path, path);
  return openMapBytes(new Uint8Array(readFileSync(path)), "v.scx");
}
const merge = async (o: OpenedMap, t: OpenedMap, prefer: "ours" | "theirs" | null = null) => {
  const base = await open();
  const out = await openMapBytes(await bytesOf(o), "ours.scx");
  return mergeDocs(base, o, t, out, prefer);
};
async function bytesOf(doc: OpenedMap): Promise<Uint8Array> {
  const path = join(tmp(), "x.scx");
  await writeBack(doc, path, path);
  return new Uint8Array(readFileSync(path));
}
/** The merged map as written and opened again. */
const reopen = async (doc: OpenedMap) => openMapBytes(await bytesOf(doc), "merged.scx");

const textOf = (doc: OpenedMap, i: number) => doc.scenario.strings.strings[i] ?? null;
const displayTexts = (doc: OpenedMap) => doc.scenario.triggers.flatMap((t) => t.actions.filter((a) => a.type === ActionType.DisplayText).map((a) => textOf(doc, a.text)));

function addTrigger(doc: OpenedMap, message: string) {
  const t = newTrigger([PlayerGroup.Player1]);
  t.conditions.push(newCondition(ConditionType.Always));
  t.actions.push({ ...newAction(ActionType.DisplayText), text: internString(doc.scenario, message) });
  doc.scenario.triggers.push(t);
  markDirty(doc.scenario, "TRIG");
}
function setFirstMessage(doc: OpenedMap, message: string, trigger = 0) {
  const a = doc.scenario.triggers[trigger].actions.find((x) => x.type === ActionType.DisplayText || x.type === ActionType.Victory)!;
  if (a.type === ActionType.Victory) { a.type = ActionType.DisplayText; a.text = internString(doc.scenario, message); }
  else a.text = internString(doc.scenario, message);
  markDirty(doc.scenario, "TRIG");
}
function addMarines(doc: OpenedMap, ...tiles: [number, number][]) {
  const serial = Math.max(...doc.scenario.units.map((u) => u.serial)) + 1;
  applyUnitChanges(doc.scenario, addUnits(doc.scenario, tiles.map(([x, y], i) => ({ ...doc.scenario.units.find((u) => u.unitId === MARINE)!, serial: serial + i, x: x * 32 + 16, y: y * 32 + 16 }))));
}
function rename(doc: OpenedMap, index: number, name: string) {
  applyLocationChanges(doc.scenario, [editLocation(doc.scenario, index, { name })!]);
}
function paint(doc: OpenedMap, x0: number, y0: number, x1: number, y1: number, tile: number) {
  const s = doc.scenario;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { s.tiles[y * s.width + x] = tile; s.editorTiles[y * s.width + x] = tile; }
  markDirty(s, "MTXM", "TILE");
}

describe("diff3 over lists", () => {
  it("pairs a longest common subsequence", () => {
    expect(lcsMatch([1, 2, 3, 4], [1, 3, 4, 5])).toEqual([0, -1, 1, 2]);
    expect(lcsMatch([], [1])).toEqual([]);
    expect(lcsMatch([7, 8], [9])).toEqual([-1, -1]);
  });

  it("splits three lists into stable runs and the stretches between", () => {
    const c = diff3Chunks([1, 2, 3], [1, 9, 3], [1, 2, 3, 4]);
    expect(c.map((x) => x.stable)).toEqual([true, false, true, false]);
  });

  const run = (b: string[], o: string[], t: string[]) => {
    const r = mergeList(b, o, t, { b, o, t }, null);
    return { list: r.items.map((i) => i.item), from: r.items.map((i) => i.from), conflicts: r.conflicts.length };
  };

  it("keeps both sides' insertions, ours first, and one copy of what both inserted", () => {
    expect(run(["a", "b"], ["a", "x", "b"], ["a", "y", "b"]).list).toEqual(["a", "x", "y", "b"]);
    expect(run(["a"], ["a", "x"], ["a", "x"]).list).toEqual(["a", "x"]);
    expect(run(["a"], ["a", "x", "z"], ["a", "x", "y"]).list).toEqual(["a", "x", "z", "y"]);
  });

  it("merges edits to neighbouring items, and an insertion beside an edit", () => {
    expect(run(["a", "b", "c"], ["A", "b", "c"], ["a", "B", "c"])).toEqual({ list: ["A", "B", "c"], from: ["ours", "theirs", "ours"], conflicts: 0 });
    expect(run(["a", "b"], ["A", "b"], ["a", "n", "b"]).list).toEqual(["A", "n", "b"]);
    expect(run(["a", "b", "c"], ["a", "c"], ["a", "b", "n", "c"]).list).toEqual(["a", "n", "c"]);
  });

  it("is a conflict where both changed one item differently, or one deleted what the other changed", () => {
    const r = run(["a", "b", "c"], ["a", "X", "c"], ["a", "Y", "c"]);
    expect(r.conflicts).toBe(1);
    expect(r.list).toEqual(["a", "X", "c"]);
    expect(mergeList(["a", "b"], ["a", "X"], ["a", "Y"], { b: ["a", "b"], o: ["a", "X"], t: ["a", "Y"] }, "theirs").items.map((i) => i.item)).toEqual(["a", "Y"]);
    expect(run(["a", "b", "c"], ["a", "c"], ["a", "B", "c"]).conflicts).toBe(1);
  });

  it("cuts a long line around where the versions part", () => {
    const line = `${"a".repeat(150)}XYZ${"b".repeat(50)}`;
    expect(around(line, 150, 40)).toBe(`…${"a".repeat(13)}XYZ${"b".repeat(22)}…`);
    expect(around("short", 3, 40)).toBe("short");
    expect(around("x".repeat(50), 0, 40)).toBe(`${"x".repeat(39)}…`);
  });

  it("groups tiles into rectangles by 8-connected regions", () => {
    const w = 10;
    const tiles = new Set([0, 1, 11, 22, 55, 56]);
    expect(tileRegions(tiles, w)).toEqual([{ x0: 0, y0: 0, x1: 2, y1: 2, count: 4 }, { x0: 5, y0: 5, x1: 6, y1: 5, count: 2 }]);
  });
});

describe("scmjs map merge", () => {
  it("takes what each side changed: units and a trigger from one, a location's name and a string from the other", async () => {
    const base = await open();
    const hold = base.scenario.strings.strings.indexOf("Hold the base.");
    const ours = await version((d) => { addMarines(d, [20, 20], [21, 20]); addTrigger(d, "Reinforcements arrive."); });
    const theirs = await version((d) => { rename(d, 0, "Home Base"); d.scenario.strings.strings[hold] = "Hold the line."; markDirty(d.scenario, "STR "); });
    const r = await merge(ours, theirs);
    expect(r.conflicts).toEqual([]);
    const m = await reopen(r.doc);
    expect(m.scenario.units.length).toBe(base.scenario.units.length + 2);
    expect(new Set(m.scenario.units.map((u) => u.serial)).size).toBe(m.scenario.units.length);
    expect(locationName(m.scenario, 0)).toBe("Home Base");
    expect(displayTexts(m)).toEqual(["Hold the line.", "Reinforcements arrive."]);
    // The edit in place stays in place: the string kept its number and the old text is gone.
    expect(textOf(m, hold)).toBe("Hold the line.");
    expect(m.scenario.strings.strings).not.toContain("Hold the base.");
    expect(issueCounts(validateScenario(m.scenario, { extras: m.extras })).error).toBe(0);
    expect(r.changes.find((c) => c.part === "Units")).toEqual({ part: "Units", ours: 2, theirs: 0 });
    expect(r.changes.find((c) => c.part === "Locations")).toEqual({ part: "Locations", ours: 0, theirs: 1 });
  });

  it("gives a string of theirs a new number when ours put another string at its number", async () => {
    const ours = await version((d) => addTrigger(d, "Alpha"));
    const theirs = await version((d) => addTrigger(d, "Beta"));
    const alpha = ours.scenario.strings.strings.indexOf("Alpha");
    expect(theirs.scenario.strings.strings.indexOf("Beta")).toBe(alpha);
    const r = await merge(ours, theirs);
    expect(r.conflicts).toEqual([]);
    expect(r.renumbered).toBe(1);
    const m = await reopen(r.doc);
    expect(displayTexts(m)).toEqual(["Hold the base.", "Alpha", "Beta"]);
    expect(textOf(m, alpha)).toBe("Alpha");
  });

  it("writes the sections neither side's change touched byte for byte", async () => {
    const ours = await version((d) => addMarines(d, [30, 30]));
    const theirs = await version((d) => { d.scenario.playerRaces[0] = PlayerRace.Protoss; markDirty(d.scenario, "SIDE"); });
    const r = await merge(ours, theirs);
    const sections = (bytes: Uint8Array) => new Map(parseChk(bytes).sections.map((s) => [s.name, Buffer.from(s.data).toString("hex")]));
    const merged = sections(serializeScenario(r.doc.scenario)), mine = sections(serializeScenario(ours.scenario));
    const changed = [...merged.keys()].filter((k) => merged.get(k) !== mine.get(k));
    expect(changed).toEqual(["SIDE"]);
    expect(r.doc.scenario.units.length).toBe(ours.scenario.units.length);
  });

  it("reports both sides changing one trigger differently, and settles it with --ours or --theirs", async () => {
    const ours = await version((d) => setFirstMessage(d, "Hold fast."));
    const theirs = await version((d) => setFirstMessage(d, "Stand firm."));
    const r = await merge(ours, theirs);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ part: "Triggers", what: "trigger 1 of the base" });
    expect(r.conflicts[0].ours).toContain("Hold fast.");
    expect(r.conflicts[0].theirs).toContain("Stand firm.");
    expect(displayTexts(await reopen((await merge(ours, theirs, "ours")).doc))[0]).toBe("Hold fast.");
    expect(displayTexts(await reopen((await merge(ours, theirs, "theirs")).doc))[0]).toBe("Stand firm.");
  });

  it("merges edits to two different triggers, next to each other", async () => {
    const ours = await version((d) => setFirstMessage(d, "Hold fast.", 0));
    const theirs = await version((d) => setFirstMessage(d, "Victory is near.", 2));
    const r = await merge(ours, theirs);
    expect(r.conflicts).toEqual([]);
    expect(displayTexts(await reopen(r.doc))).toEqual(["Hold fast.", "Victory is near."]);
  });

  it("merges terrain tile by tile, and reports the tiles both painted as a rectangle", async () => {
    const ours = await version((d) => paint(d, 10, 10, 12, 12, 5));
    const theirs = await version((d) => paint(d, 11, 11, 13, 13, 7));
    const r = await merge(ours, theirs);
    expect(r.conflicts.map((c) => [c.part, c.what])).toEqual([["Terrain", "4 tiles at 11,11–12,12"]]);
    const settled = (await merge(ours, theirs, "theirs")).doc.scenario;
    const at = (x: number, y: number) => settled.tiles[y * settled.width + x];
    expect([at(10, 10), at(11, 11), at(13, 13), at(14, 14)]).toEqual([5, 7, 7, 0]);
    const apart = await merge(ours, await version((d) => paint(d, 40, 40, 41, 41, 9)));
    expect(apart.conflicts).toEqual([]);
    const s = apart.doc.scenario;
    expect([s.tiles[10 * s.width + 10], s.tiles[40 * s.width + 40], s.editorTiles[40 * s.width + 41]]).toEqual([5, 9, 9]);
  });

  it("matches units with no ids by what they are: an edit each side is a conflict only on the same unit", async () => {
    const ling = (d: OpenedMap) => d.scenario.units.findIndex((u) => u.unitId === ZERGLING);
    const move = (dx: number) => (d: OpenedMap) => applyUnitChanges(d.scenario, updateUnits(d.scenario, [ling(d)], (u) => ({ x: u.x + dx })));
    const r = await merge(await version(move(32)), await version(move(64)));
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ part: "Units" });
    expect(r.conflicts[0].ours).toMatch(/^changed to Zerg Zergling \(Player 2\) at 1648,/);
    const gone = await merge(await version((d) => applyUnitChanges(d.scenario, removeUnits(d.scenario, [ling(d)]))), await version(move(64)));
    expect(gone.conflicts.map((c) => [c.ours, c.theirs.slice(0, 10)])).toEqual([["removed", "changed to"]]);
    const both = await merge(await version(move(32)), await version((d) => addMarines(d, [5, 5])));
    expect(both.conflicts).toEqual([]);
    expect(both.doc.scenario.units.find((u) => u.unitId === ZERGLING)!.x).toBe(50 * 32 + 16 + 32);
  });

  it("merges settings field by field: a race on one side, a force's name on the other; the same field both ways is a conflict", async () => {
    const race = (r: number) => (d: OpenedMap) => { d.scenario.playerRaces[0] = r; markDirty(d.scenario, "SIDE"); };
    const force = (d: OpenedMap) => applyForceSettings(d.scenario, { ...readForceSettings(d.scenario), names: ["Guardians", "Swarm", "", ""] });
    const r = await merge(await version(race(PlayerRace.Protoss)), await version(force));
    expect(r.conflicts).toEqual([]);
    const m = await reopen(r.doc);
    expect(m.scenario.playerRaces[0]).toBe(PlayerRace.Protoss);
    expect(readForceSettings(m.scenario).names.slice(0, 2)).toEqual(["Guardians", "Swarm"]);
    const clash = await merge(await version(race(PlayerRace.Protoss)), await version(race(PlayerRace.Zerg)));
    expect(clash.conflicts.map((c) => [c.part, c.what, c.ours, c.theirs])).toEqual([["Players", "Player 1 race", "2", "0"]]);
  });

  it("carries a section nothing models from the side that changed it", async () => {
    const theirs = await version(() => {});
    theirs.scenario.chk.sections.push({ name: "ZZZZ", offset: -1, declaredSize: 3, data: new Uint8Array([1, 2, 3]) });
    const r = await merge(await version((d) => addMarines(d, [6, 6])), theirs);
    expect(r.conflicts).toEqual([]);
    expect(parseChk(serializeScenario(r.doc.scenario)).sections.find((s) => s.name === "ZZZZ")?.data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("takes a side whole, byte for byte, when the other did not change the map, and says what it did", async () => {
    const dir = tmp();
    const base = join(dir, "base.scx"), ours = join(dir, "ours.scx"), theirs = join(dir, "theirs.scx");
    copyFileSync(testMap("ums.scx"), base); copyFileSync(testMap("ums.scx"), ours);
    writeFileSync(theirs, await bytesOf(await version((d) => addMarines(d, [9, 9]))));
    const read = async () => ({ base: asMap(await readInput(base)), ours: asMap(await readInput(ours)), theirs: asMap(await readInput(theirs)) });
    const r = await runMerge(await read());
    expect(r.kind).toBe("theirs");
    expect(readFileSync(ours)).toEqual(readFileSync(theirs));
    expect(visible(printMerge(r)[0])).toBe(`✔ ours.scx: only theirs changed it since the common ancestor, so it is theirs · written to ${ours}`);
    const again = await runMerge(await read());
    expect(again.kind).toBe("same");
    expect(again.written).toBeNull();
  });

  it("writes nothing and exits 1 on a conflict, and says how to settle it", async () => {
    const dir = tmp();
    const base = join(dir, "base.scx"), ours = join(dir, "ours.scx"), theirs = join(dir, "theirs.scx");
    copyFileSync(testMap("ums.scx"), base);
    writeFileSync(ours, await bytesOf(await version((d) => setFirstMessage(d, "Hold fast."))));
    writeFileSync(theirs, await bytesOf(await version((d) => setFirstMessage(d, "Stand firm."))));
    const before = readFileSync(ours);
    const read = async () => ({ base: asMap(await readInput(base)), ours: asMap(await readInput(ours)), theirs: asMap(await readInput(theirs)) });
    const r = await runMerge(await read());
    expect(r.written).toBeNull();
    expect(readFileSync(ours)).toEqual(before);
    const text = printMerge(r).map(visible);
    expect(text[0]).toBe("✖ ours.scx: 1 conflict; nothing written");
    expect(text).toContain("  Triggers · trigger 1 of the base");
    expect(text.at(-1)).toBe("Add --ours or --theirs to settle each with that side's version.");
    const dry = await runMerge(await read(), { prefer: "theirs", dryRun: true });
    expect([dry.settled, dry.written]).toEqual(["theirs", null]);
    expect(readFileSync(ours)).toEqual(before);
    const out = join(dir, "merged.scx");
    const settled = await runMerge(await read(), { prefer: "theirs", out });
    expect(settled.settled).toBe("theirs");
    expect(visible(printMerge(settled)[0])).toMatch(/^▲ ours\.scx merged, 1 conflict settled as theirs: /);
    expect(displayTexts(await openMapBytes(new Uint8Array(readFileSync(out)), "merged.scx"))[0]).toBe("Stand firm.");
  });

  it("is a verb under map, with no row of its own in the overview", () => {
    const map = program.commands.find((c) => c.name() === "map")!;
    const cmd = map.commands.find((c) => c.name() === "merge")!;
    expect(cmd.options.map((o) => o.long)).toEqual(["--json", "--out", "--ours", "--theirs", "--name", "--dry-run"]);
    expect(program.helpInformation().split("\n").some((l) => l.includes("merge"))).toBe(false);
  });
});

describe("scmjs map merge on every map", () => {
  it("merges a new name on one side with a new description, a unit and a trigger on the other", async () => {
    for (const file of mapFiles()) {
      const bytes = new Uint8Array(readFileSync(file.path));
      const read = () => openMapBytes(bytes, file.name);
      const edit = async (fn: (d: OpenedMap) => void) => { const d = await read(); fn(d); return openMapBytes(await bytesOf(d), file.name); };
      const ours = await edit((d) => setScenarioName(d.scenario, "Merged name"));
      const theirs = await edit((d) => {
        setScenarioDescription(d.scenario, "Merged description");
        const u = d.scenario.units[0];
        if (u) applyUnitChanges(d.scenario, addUnits(d.scenario, [{ ...u, serial: Math.max(...d.scenario.units.map((x) => x.serial)) + 1, x: u.x + 32 }]));
        addTrigger(d, "From the other side");
      });
      const r = mergeDocs(await read(), ours, theirs, await openMapBytes(await bytesOf(ours), file.name));
      expect(r.conflicts, file.name).toEqual([]);
      const m = await reopen(r.doc);
      expect(scenarioName(m.scenario), file.name).toBe("Merged name");
      expect(scenarioDescription(m.scenario), file.name).toBe("Merged description");
      expect(m.scenario.units.length, file.name).toBe(theirs.scenario.units.length);
      expect(displayTexts(m).at(-1), file.name).toBe("From the other side");
      const before = issueCounts(validateScenario(theirs.scenario, { extras: theirs.extras })).error;
      expect(issueCounts(validateScenario(m.scenario, { extras: m.extras })).error, file.name).toBeLessThanOrEqual(before);
    }
  }, 60_000);
});

describe("scmjs init sets the merge driver", () => {
  it("names the driver in git's settings and the maps in .gitattributes", () => {
    expect(GIT_SETTINGS).toContainEqual(["merge.scmjs.driver", "scmjs map merge %O %A %B --out %A --name %P"]);
    expect(GIT_SETTINGS).toContainEqual(["merge.scmjs.name", "StarCraft maps, part by part (scmjs map merge)"]);
    for (const ext of ["scx", "scm", "chk"]) expect(ATTRIBUTE_LINES).toContain(`*.${ext} merge=scmjs`);
    // A pattern that already names a merge driver is left alone, as one naming a diff driver is.
    expect(missingLines("*.scx merge=binary\n*.scx diff=scmjs\n", ATTRIBUTE_LINES, true)).toEqual(["*.scm diff=scmjs", "*.chk diff=scmjs", "*.scm merge=scmjs", "*.chk merge=scmjs"]);
    expect(readmeText("maps", [])).toContain('git config merge.scmjs.driver "scmjs map merge %O %A %B --out %A --name %P"');
  });

  it("prints the driver in --print's recipe", async () => {
    const dir = tmp();
    const r = await initFolder(dir, { print: true });
    expect(printRecipe(r)).toContain('git config merge.scmjs.driver "scmjs map merge %O %A %B --out %A --name %P"');
    expect(printRecipe(r)).toContain("*.scx merge=scmjs");
  });
});

const hasGit = spawnSync("git", ["--version"]).status === 0;

/** git, waited for without blocking this process (the merge driver below calls back into it). */
function gitAsync(dir: string, ...args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((done) => execFile("git", ["-C", dir, ...args], { encoding: "utf8" }, (e, stdout, stderr) => done({ code: e ? Number((e as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` })));
}

describe.skipIf(!hasGit)("git merge with scmjs map merge as the driver", () => {
  it("merges two branches' changes to one map, and stops on a true conflict that --ours settles", async () => {
    const dir = tmp();
    const git = (...args: string[]) => { const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" }); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return r.stdout; };
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Test"); git("config", "user.email", "test@example.com"); git("config", "commit.gpgsign", "false");
    const map = join(dir, "map.scx");
    copyFileSync(testMap("ums.scx"), map);
    const init = await initFolder(dir);
    expect(init.git.find((g) => g.key === "merge.scmjs.driver")?.state).toBe("set");
    expect(git("config", "--get", "merge.scmjs.driver")).toBe("scmjs map merge %O %A %B --out %A --name %P\n");
    expect(git("check-attr", "merge", "--", "map.scx")).toBe("map.scx: merge: scmjs\n");

    // git runs the driver by name; `scmjs` is not on PATH here, so a stand-in hands git's arguments (the same line,
    // %O %A %B --out %A --name %P) to this process, which merges with the command's own function.
    const calls: string[][] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", async () => {
        const { cwd, args } = JSON.parse(body) as { cwd: string; args: string[] };
        calls.push(args);
        const [b, a, t, , out, , name] = args.map((x, i) => (i === 6 ? x : resolve(cwd, x)));
        const r = await runMerge({ base: asMap(await readInput(b)), ours: asMap(await readInput(a)), theirs: asMap(await readInput(t)) }, { out, name });
        res.end(JSON.stringify({ code: r.conflicts.length && !r.settled ? 1 : 0, out: printMerge(r).map(visible).join("\n") }));
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const driver = join(tmp(), "driver.mjs");
    writeFileSync(driver, `const [url, ...args] = process.argv.slice(2);
const r = await (await fetch(url, { method: "POST", body: JSON.stringify({ cwd: process.cwd(), args }) })).json();
console.log(r.out);
process.exit(r.code);
`);
    git("config", "merge.scmjs.driver", `node ${JSON.stringify(driver)} ${url} %O %A %B --out %A --name %P`);
    try {
      git("add", "-A"); git("commit", "-q", "-m", "base");
      const commit = async (branch: string, from: string, edit: (d: OpenedMap) => void) => {
        git("checkout", "-q", "-b", branch, from);
        const doc = await openMapBytes(new Uint8Array(readFileSync(map)), "map.scx");
        edit(doc);
        await writeBack(doc, map, map);
        git("commit", "-q", "-am", branch);
      };
      const hold = (await open()).scenario.strings.strings.indexOf("Hold the base.");
      await commit("units", "main", (d) => { addMarines(d, [20, 20], [21, 20]); addTrigger(d, "Reinforcements arrive."); });
      await commit("names", "main", (d) => { rename(d, 0, "Home Base"); d.scenario.strings.strings[hold] = "Hold the line."; markDirty(d.scenario, "STR "); });
      git("checkout", "-q", "units");
      const merged = await gitAsync(dir, "merge", "--no-stat", "--no-edit", "names");
      expect(merged.code, merged.out).toBe(0);
      expect(calls).toHaveLength(1);
      expect(calls[0][6]).toBe("map.scx");
      // Ours added two units and a trigger, theirs renamed a location and changed a trigger's text; the new strings of
      // both sides landed on one number, so theirs's took the next.
      expect(merged.out).toContain("✔ map.scx merged: 3 changes from ours, 2 from theirs · written to map.scx");
      expect(merged.out).toContain("Strings    1 string of theirs renumbered");
      const m = await openMapBytes(new Uint8Array(readFileSync(map)), "map.scx");
      expect(locationName(m.scenario, 0)).toBe("Home Base");
      expect(displayTexts(m)).toEqual(["Hold the line.", "Reinforcements arrive."]);
      expect(m.scenario.units.filter((u) => u.unitId === MARINE).length).toBe((await open()).scenario.units.filter((u) => u.unitId === MARINE).length + 2);
      expect(issueCounts(validateScenario(m.scenario, { extras: m.extras })).error).toBe(0);

      // Both edit the first trigger's message: git stops, the map is left as ours, and `map merge <map> --ours` settles it.
      const head = git("rev-parse", "HEAD").trim();
      await commit("fast", head, (d) => setFirstMessage(d, "Hold fast."));
      const ours = readFileSync(map);
      await commit("firm", head, (d) => setFirstMessage(d, "Stand firm."));
      git("checkout", "-q", "fast");
      const stopped = await gitAsync(dir, "merge", "--no-stat", "--no-edit", "firm");
      expect(stopped.code).not.toBe(0);
      expect(stopped.out).toContain("CONFLICT (content): Merge conflict in map.scx");
      expect(stopped.out).toContain("✖ map.scx: 1 conflict; nothing written");
      expect(stopped.out).toContain("scmjs map merge map.scx --ours (or --theirs) settles each with that side's version; then git add map.scx");
      expect(readFileSync(map)).toEqual(ours);
      expect(git("diff", "--name-only", "--diff-filter=U")).toBe("map.scx\n");
      const again = await runMerge(stagedInputs(map), { staged: true });
      expect(again.conflicts).toHaveLength(1);
      expect(again.written).toBeNull();
      const settled = await runMerge(stagedInputs(map), { prefer: "ours", staged: true });
      expect(settled.written?.path).toBe(map);
      const s = await openMapBytes(new Uint8Array(readFileSync(map)), "map.scx");
      expect(displayTexts(s)[0]).toBe("Hold fast.");
      git("add", "map.scx");
      git("commit", "-q", "--no-edit");
      expect(git("status", "--porcelain")).toBe("");
    } finally {
      server.close();
    }
  }, 60_000);
});
