/**
 * `scmjs map test` (cli/src/maptest.ts, the test forms in cli/src/report.ts): a tests file read and each scenario
 * planned against the map — its setup and timed effects made triggers of a copy, the person's commands and the counts
 * handed to the runner, the expectations resolved by the map's own names — then judged against what a game left, and
 * run through a stand-in for the map runner's test mode (the real one needs the lifted game and a copy of StarCraft,
 * which CI has not got). The sample beside the test map, tests/maps/ums.tests.json, is the one the docs show.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareOf, compareWords, defaultOut, defaultTests, firstInGame, formatTests, framesOf, happened, happenedLines, holds, judge, planInline, planScenario, readMapForTests, readTests, recordLines, recordTest, REPLAY_END, runTests, saveScenarios, scenarioLines,
  secondOf, shownText, slug, snapshotExpect, testSummary, updateTests, type Happened, type Observed, type PlannedScenario, type ScenarioResult,
} from "../cli/src/maptest";
import { githubTestAnnotations, junitTestXml, sarifTestJson, type TestReport } from "../cli/src/report";
import { CliError, visible } from "../cli/src/ui";
import { buildProgram, typedOptions } from "../cli/src/main";
import type { Command } from "commander";
import { ActionType, ConditionType } from "../src/formats/chk/sections/triggers";
import { parseScenario, serializeScenario } from "../src/formats/chk/scenario";
import { testMap } from "./support/maps";
import { classicCopy, FAKE_TEST_RUNNER, OLD_TEST_RUNNER, stagedEngine } from "./support/mapRunner";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-maptest-"));
const ums = async () => readMapForTests(new Uint8Array(readFileSync(testMap("ums.scx"))));
const DEFAULTS = { frames: 2400, seed: 1 };
const plan = async (raw: object) => planScenario((await ums()).chk, raw as Record<string, unknown>, "ums.tests.json", 0, DEFAULTS);
/** The exit code of a CliError thrown by `f`, with its message. */
async function refused(f: () => unknown): Promise<{ code: number; message: string }> {
  try { await f(); } catch (e) { if (e instanceof CliError) return { code: e.exitCode, message: e.message }; throw e; }
  throw new Error("not refused");
}
const nothing = (counts: number): Observed => ({ switches: [], deaths: [], resources: Array.from({ length: 12 }, () => [0, 0]), counts: Array(counts).fill(0), texts: [], outcomes: Array(8).fill(null), steps: [] });

afterEach(() => { delete process.env.SCMJS_TEST_ANSWER; delete process.env.SCMJS_TEST_SPECS; });

describe("scmjs map test: the file's small forms", () => {
  it("reads frames, comparisons and names for files", () => {
    expect(framesOf(240, "at")).toBe(240);
    expect(framesOf("1:05", "at")).toBe(65 * 24);
    expect(() => framesOf("soon", "at")).toThrow(CliError);
    expect(compareOf(3, "is")).toEqual({ op: "=", n: 3 });
    expect(compareOf(">= 2", "is")).toEqual({ op: ">=", n: 2 });
    expect(compareOf("== 0", "is")).toEqual({ op: "=", n: 0 });
    expect(compareOf(true, "fired")).toEqual({ op: ">=", n: 1 });
    expect(compareOf(false, "fired")).toEqual({ op: "=", n: 0 });
    expect(() => compareOf("lots", "is")).toThrow(/comparison/);
    expect([holds({ op: "<", n: 2 }, 1), holds({ op: "!=", n: 2 }, 2), holds({ op: ">", n: 2 }, 3), holds({ op: "<=", n: 2 }, 3)]).toEqual([true, false, true, false]);
    expect(compareWords({ op: "<", n: 2 })).toBe("fewer than 2");
    // The game's clock: a second every 16 frames, and a step never lands before its frame.
    expect([secondOf(0), secondOf(16), secondOf(17), secondOf(120)]).toEqual([0, 1, 2, 8]);
    expect(slug("A Marine brought to the middle — raises the alarm!")).toBe("a-marine-brought-to-the-middle-raises-the-alarm");
    expect(slug("리마스터 시험")).toBe("리마스터-시험");
    expect(defaultTests(join("maps", "(2)Ridge.scx"))).toBe(join("maps", "(2)Ridge.tests.json"));
    expect(defaultOut(join("maps", "(2)Ridge.scx"))).toBe(join("maps", "(2)Ridge.tests"));
  });
});

describe("scmjs map test: a scenario planned against the map", () => {
  it("makes the setup a trigger before the map's own and each timed effect one after, the first player in the game owning them", async () => {
    const p = await plan({
      name: "everything", frames: "0:30",
      setup: [{ create: "Marine", player: 1, count: 4, location: "Middle" }, { switch: "Alarm raised" }, { minerals: 500, player: 1 }, { deaths: "Zerg Zergling", player: 2, count: "+3" }],
      steps: [
        { at: 100, kill: "Any unit", player: 2, location: "Nest" },
        { at: "0:10", action: "Set Countdown Timer(Set To, 60)" },
        { at: 48, order: "move", unit: "Terran Ghost", location: "Base", to: "Middle" },
        { at: 30, chat: "gg" },
      ],
      expect: [{ trigger: "Opening" }, { trigger: 2, fired: ">= 2" }, { units: "Terran Ghost", player: 1, location: "Base", is: ">= 2" }, { units: "Men", player: "All Players" }, { switch: 1, is: "clear" }],
    });
    expect(firstInGame(p.scenario)).toBe(0);
    expect(p.frames).toBe(720);
    expect(p.rows).toBe(3);
    expect(p.before).toHaveLength(1);
    expect(p.after).toHaveLength(2);
    // The copy's triggers: the setup, the map's three, the two timed effects.
    expect(p.scenario.triggers).toHaveLength(6);
    const [setup] = p.scenario.triggers;
    expect(setup.players[0]).toBe(1);
    expect(setup.conditions[0].type).toBe(ConditionType.Always);
    expect(setup.actions.map((a) => a.type)).toEqual([ActionType.CreateUnit, ActionType.SetSwitch, ActionType.SetResources, ActionType.SetDeaths]);
    expect(setup.actions[0]).toMatchObject({ player: 0, unitId: 0, modifier: 4, location: 3 });
    expect(setup.actions[3]).toMatchObject({ player: 1, unitId: 37, modifier: 8, target: 3 });
    const kill = p.scenario.triggers[4], timer = p.scenario.triggers[5];
    expect(kill.conditions[0]).toMatchObject({ type: ConditionType.ElapsedTime, amount: 7 });
    expect(kill.actions[0]).toMatchObject({ type: ActionType.KillUnitAt, player: 1, unitId: 229, modifier: 0, location: 2 });
    expect(timer.conditions[0].amount).toBe(15);
    expect(timer.actions[0].type).toBe(ActionType.SetCountdownTimer);
    // The person's commands go to the runner, in frame order; the counts are the units expectations'.
    expect(p.spec).toEqual({
      frames: 720,
      steps: [{ frame: 30, kind: "chat", text: "gg" }, { frame: 48, kind: "order", order: "move", unit: 1, location: 1, to: 3 }],
      counts: [{ player: 0, unit: 1, location: 1 }, { player: 17, unit: 230, location: 0 }],
    });
    expect(p.expect.map((x) => x.what)).toEqual([
      'trigger #1 "Opening" fired', "trigger #2 fired at least 2 times", "Terran Ghost of Player 1 in Base: at least 2", "Men of All Players: at least 1", 'switch "Alarm raised" is clear',
    ]);
    // The map itself is untouched: the copy is the scenario's own.
    expect((await planScenario((await ums()).chk, { name: "none" }, "f", 0, DEFAULTS)).scenario.triggers).toHaveLength(3);
  });

  it("refuses what it cannot read, saying where and what the map has (exit 2)", async () => {
    const cases: [object, RegExp][] = [
      [{ setup: [{ create: "Marine", player: 1, location: "Moon" }] }, /setup\[0\]\.location: the map has no location "Moon" \(it has "Base", "Nest", "Middle"/],
      [{ expect: [{ trigger: "Finale" }] }, /no trigger has the comment "Finale" \(the map's comments: "Opening"\)/],
      [{ expect: [{ trigger: 9 }] }, /the map has 3 triggers: 9 is not one of them/],
      [{ expect: [{ units: "Marine", is: "lots" }] }, /expect\[0\]\.is: takes true, false, a number or a comparison/],
      [{ expect: [{ deaths: "Marine", player: 1, is: "lots" }] }, /expect\[0\]\.is: takes a number or a comparison/],
      [{ expect: [{ trigger: 2, fired: "yes" }] }, /expect\[0\]\.fired: takes true, false, a number or a comparison/],
      // A key the tests do not know, at every level, with the nearest they do.
      [{ frams: "0:05", expect: [{ trigger: 2 }] }, /"bad": "frams" is not something the tests know: did you mean "frames"\?/],
      [{ expect: [{ trigger: 2, fird: false }] }, /expect\[0\]: "fird" is not something the tests know: did you mean "fired"\?/],
      [{ expect: [{ units: "Terran Marine", playr: 2, is: 0 }] }, /expect\[0\]: "playr" .*did you mean "player"\?/],
      [{ setup: [{ create: "Marine", player: 1, cont: 2 }] }, /setup\[0\]: "cont" .*did you mean "count"\?/],
      [{ steps: [{ at: 10, chat: "hi", colour: 3 }] }, /steps\[0\]: "colour" is not something the tests know \(chat, at\)/],
      [{ step: [{ at: 10, chat: "hi" }], expect: [{ ended: true }] }, /"step" .*did you mean "steps"\?/],
      [{ expect: [{ trigger: 2, switch: 1 }] }, /expects trigger and switch at once/],
      [{ frames: 100, steps: [{ at: 100, chat: "late" }] }, /is at frame 100, and the scenario runs 100 frames/],
      [{ steps: [{ at: 10, chat: "hi", kill: "Any unit" }] }, /does kill and chat at once|does .* at once/],
      [{ steps: [{ chat: "hi" }] }, /says when with "at"/],
      [{ steps: [{ at: 10, order: "move" }] }, /a move order needs "to"/],
      [{ steps: [{ at: 10, action: "Make It Rain()" }] }, /steps\[0\]\.action: /],
      [{ setup: [{ create: "Siege Tank", player: 1 }] }, /could be/],
      [{ expect: [{ score: 3 }] }, /expects nothing the tests know/],
      [{ expect: [{ outcome: "victory", player: 9 }] }, /an outcome is a player's from 1 to 8/],
    ];
    for (const [raw, message] of cases) {
      const r = await refused(() => plan({ name: "bad", ...raw }));
      expect(r.code, JSON.stringify(raw)).toBe(2);
      expect(r.message, JSON.stringify(raw)).toMatch(message);
    }
    const chk = (await ums()).chk;
    expect((await refused(() => readTests("t.json", "{ nope", chk, DEFAULTS))).message).toMatch(/t\.json is not JSON/);
    expect((await refused(() => readTests("t.json", "{}", chk, DEFAULTS))).message).toMatch(/no "scenarios" list/);
    // At the top of the file, a scenario that expects nothing, and two of one name; a // key is a comment.
    expect((await refused(() => readTests("t.json", JSON.stringify({ scenarios: [], sed: 3 }), chk, DEFAULTS))).message).toMatch(/t\.json: "sed" .*did you mean "seed"\?/);
    expect((await refused(() => readTests("t.json", JSON.stringify({ scenarios: [{ name: "x", frames: "0:05" }] }), chk, DEFAULTS))).message).toMatch(/"x": expects nothing, so it would pass whatever the game did/);
    expect((await refused(() => readTests("t.json", JSON.stringify([{ name: "x", expect: [{ ended: true }] }, { name: "X", expect: [{ ended: false }] }]), chk, DEFAULTS))).message).toMatch(/has two scenarios named "X"/);
    expect(readTests("t.json", JSON.stringify({ "//": "the map's tests", scenarios: [{ name: "x", "// why": "a note", expect: [{ ended: true, "//": "ok" }] }] }), chk, DEFAULTS)).toHaveLength(1);
    // A list alone is taken as the scenarios; the file's frames and seed are every scenario's unless one says.
    const list = readTests("t.json", JSON.stringify([{ name: "a", expect: [{ ended: true }] }]), chk, DEFAULTS);
    expect(list.map((s) => [s.name, s.frames, s.seed, s.line])).toEqual([["a", 2400, 1, 1]]);
    const top = readTests("t.json", JSON.stringify({ frames: "0:10", seed: 7, scenarios: [{ name: "a", expect: [{ ended: true }] }, { name: "b", frames: 50, seed: 2, expect: [{ ended: true }] }] }, null, 2), chk, DEFAULTS);
    expect(top.map((s) => [s.frames, s.seed, s.line])).toEqual([[240, 7, 6], [50, 2, 14]]);
  });

  it("reads the sample beside the test map", async () => {
    const file = testMap("ums.tests.json");
    const list = readTests(file, readFileSync(file, "utf8"), (await ums()).chk, DEFAULTS);
    expect(list.map((s) => s.name)).toEqual(["the alarm wins the game", "the carrier flies to the middle, which is not a Marine", "a Marine brought to the middle raises the alarm"]);
    expect(list.every((s) => s.expect.length > 0)).toBe(true);
  });
});

describe("scmjs map test: judging what the game left", () => {
  it("holds each expectation to the end, counting the map's own rows past the setup's trigger", async () => {
    const p = await plan({
      name: "judged", setup: [{ switch: 1 }],
      expect: [
        { trigger: "Opening", fired: 1 }, { trigger: 2 }, { trigger: 3, fired: false }, { switch: "Alarm raised" }, { deaths: "Zerg Zergling", player: 2, is: 4 }, { minerals: ">= 50", player: 1 }, { gas: 0, player: 2 },
        { units: "Terran Ghost", player: 1, location: "Base", is: 2 }, { text: "Hold the base." }, { text: "You lose", shown: false }, { outcome: "victory", player: 1 }, { ended: true },
      ],
    });
    const line = (row: number, fired: number, lastFail: { slot: number; type: number; frame: number } | null = null) => ({ player: 0, row, fired, continued: 0, failed: fired ? 0 : 5, firstFired: fired ? 33 : null, lastFired: fired ? 33 : null, lastFail, flags: 0 });
    const observed: Observed = {
      ...nothing(1), switches: [0], deaths: [[1, 37, 4]], resources: Array.from({ length: 12 }, (_, i) => (i === 0 ? [75, 0] : [0, 0])), counts: [1],
      texts: [{ frame: 2, text: "\x04Hold the base." }, { frame: 40, text: "scmjs:\x07 gg" }], outcomes: ["victory", "defeat", null, null, null, null, null, null],
    };
    // Row 0 of the trace is the setup's trigger; the map's rows are 1–3 there.
    const results = judge(p, { frame: 80, ended: true, trace: [line(0, 1), line(1, 1), line(2, 0, { slot: 0, type: 3, frame: 64 }), line(3, 2)], observed });
    expect(results.map((r) => [r.ok, r.actual])).toEqual([
      [true, "it fired once, first at frame 33"],
      [false, "it never fired: Bring (condition 1) said no last, at frame 64"],
      [false, "it fired 2 times, first at frame 33"],
      [true, "it is set"],
      [true, "they are 4"],
      [true, "it has 75"],
      [true, "it has 0"],
      [false, "it has 1"],
      [true, "shown at frame 2"],
      [true, 'it was not; 2 lines shown, the last "scmjs: gg"'],
      [true, "it ended in victory"],
      [true, "it ended at frame 80"],
    ]);
    // A trigger nobody in the game owns, and an outcome not decided.
    const q = await plan({ name: "q", expect: [{ trigger: 3 }, { outcome: "defeat", player: 2 }, { ended: true }] });
    expect(judge(q, { frame: 100, ended: false, trace: [], observed: nothing(0) }).map((r) => r.actual)).toEqual(["it never fired: no player in the game owns it", "it has none: the game was still going at frame 100", "it was still going at frame 100"]);
  });
});

describe("scmjs map test: the runner", () => {
  it("plays each scenario in a game of its own, hands the runner its spec and seed, and keeps the replay of one that failed", async () => {
    const staged = stagedEngine(tmp(), true, FAKE_TEST_RUNNER), copy = classicCopy(tmp()), out = join(tmp(), "ums.tests");
    const specs = join(tmp(), "specs.jsonl"), answer = join(tmp(), "answer.json");
    process.env.SCMJS_TEST_SPECS = specs;
    process.env.SCMJS_TEST_ANSWER = answer;
    writeFileSync(answer, JSON.stringify({ frame: 240, ended: true, observed: { switches: [0], outcomes: ["victory", null, null, null, null, null, null, null], texts: [{ frame: 1, text: "WARNING: Unit unplaceable! (Terran Marine) (1040,976)" }] } }));
    const map = await ums();
    const scenarios: PlannedScenario[] = [
      await planScenario(map.chk, { name: "wins", seed: 4, setup: [{ switch: 1 }], steps: [{ at: 24, chat: "glhf" }], expect: [{ switch: "Alarm raised" }, { outcome: "victory", player: 1 }] }, "ums.tests.json", 0, DEFAULTS),
      await planScenario(map.chk, { name: "loses", expect: [{ switch: "Alarm raised", is: "clear" }, { ended: false }] }, "ums.tests.json", 1, DEFAULTS),
    ];
    // The replay of a time "wins" failed: it goes once it passes.
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "ums.tests.wins.rep"), "an old failure");
    const lines: string[] = [];
    let started = 0;
    const run = await runTests("ums.scx", scenarios, map, { out, engine: staged.dir, starcraft: copy, live: (l) => lines.push(visible(l)), onStart: () => started++ });
    expect(started).toBe(1);
    expect(run.scenarios.map((s) => [s.name, s.ok])).toEqual([["wins", true], ["loses", false]]);
    const [wins, loses] = run.scenarios;
    expect(wins.replay).toBeNull();
    // Named after the tests file and the scenario, as the clips are.
    expect(loses.replay).toBe(join(out, "ums.tests.loses.rep"));
    expect(readFileSync(loses.replay!, "utf8")).toBe("a replay");
    expect(existsSync(join(out, "ums.tests.wins.rep"))).toBe(false);
    expect(loses.notices).toEqual(["WARNING: Unit unplaceable! (Terran Marine) (1040,976)"]);
    const handed = readFileSync(specs, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(handed.map((h) => [h.map, h.seed, h.spec.frames, h.spec.steps])).toEqual([["ums.scx", 4, 2400, [{ frame: 24, kind: "chat", text: "glhf" }]], ["ums.scx", 1, 2400, []]]);
    expect(handed[0].bytes).toBeGreaterThan(handed[1].bytes);
    expect(lines.join("\n")).toMatch(/✔ wins .*2 of 2 expectations held/);
    expect(lines.join("\n")).toMatch(/✖ loses .*0 of 2 expectations held\n.*switch "Alarm raised" is clear — it is set\n.*the game was still going — it ended at frame 240\n.*the game said: WARNING: Unit unplaceable!.*\n.*replay: .*loses\.rep, open it with scmjs replay open/);
    expect(visible(testSummary(run))).toMatch(/^✖ 1 of 2 scenarios failed/);
    expect(visible(testSummary({ ...run, scenarios: [wins] }))).toMatch(/^✔ the scenario passed/);
    expect(scenarioLines(wins)).toHaveLength(1);
  });

  it("says when the engine's map runner is from before map test, or the game refused the map", async () => {
    const copy = classicCopy(tmp()), map = await ums();
    const p = await planScenario(map.chk, { name: "a" }, "t.json", 0, DEFAULTS);
    // The trace's stand-in is such a runner: it ignores --test and starts with no mode.
    await expect(runTests("ums.scx", [p], map, { out: tmp(), engine: stagedEngine(tmp()).dir, starcraft: copy })).rejects.toThrow(/is from before map test/);
    await expect(runTests("ums.scx", [p], map, { out: tmp(), engine: stagedEngine(tmp(), false).dir, starcraft: copy })).rejects.toThrow(/has no map runner/);
    await expect(runTests("bad.scx", [p], map, { out: tmp(), engine: stagedEngine(tmp(), true, FAKE_TEST_RUNNER).dir, starcraft: copy })).rejects.toThrow(/did not take this map/);
    await expect(runTests("ums.scx", [p], map, { out: tmp(), engine: stagedEngine(tmp(), true, FAKE_TEST_RUNNER).dir, starcraft: tmp() })).rejects.toThrow(/not a copy of StarCraft/);
  });
});

describe("scmjs map test: scenarios driven by a replay", () => {
  /** A folder with a tests file's place and a replay beside it (the stand-in reads only the replay's name). */
  const folder = () => { const dir = tmp(); writeFileSync(join(dir, "bug.rep"), "a replay"); return { dir, tests: join(dir, "ums.tests.json") }; };
  const ANN_BO = [{ slot: 0, name: "Ann", computer: false }, { slot: 1, name: "Bo", computer: false }];

  it("finds the replay from the tests file's folder, runs it to its end, and takes no setup or steps", async () => {
    const { dir, tests } = folder(), map = await ums();
    const p = planScenario(map.chk, { name: "bug", replay: "bug.rep", expect: [{ trigger: 1 }] }, tests, 0, DEFAULTS);
    expect(p.replay).toBe(join(dir, "bug.rep"));
    expect(p.frames).toBe(REPLAY_END);
    expect(planScenario(map.chk, { name: "bug", replay: "bug.rep", frames: "1:00" }, tests, 0, DEFAULTS).frames).toBe(1440);
    expect((await refused(() => planScenario(map.chk, { name: "bug", replay: "bug.rep", steps: [{ at: 1, chat: "hi" }] }, tests, 0, DEFAULTS))).message).toMatch(/driven by a replay, which takes no setup or steps/);
    expect((await refused(() => planScenario(map.chk, { name: "bug", replay: "gone.rep" }, tests, 0, DEFAULTS)))).toMatchObject({ code: 2, message: expect.stringMatching(/names gone\.rep, which is not there/) });
  });

  it("plays the replay through the runner, says where the game parted from it, and with -u takes what no longer holds", async () => {
    const { dir, tests } = folder(), map = await ums();
    const staged = stagedEngine(tmp(), true, FAKE_TEST_RUNNER), copy = classicCopy(tmp());
    const specs = join(tmp(), "specs.jsonl"), answer = join(tmp(), "answer.json");
    process.env.SCMJS_TEST_SPECS = specs;
    process.env.SCMJS_TEST_ANSWER = answer;
    writeFileSync(answer, JSON.stringify({ frame: 1000, ended: true, check: { named: 9, gone: 0, ahead: 1, parted: 720 }, observed: { switches: [0], resources: Array.from({ length: 12 }, (_, i) => (i === 0 ? [80, 8] : [0, 0])) } }));
    writeFileSync(tests, formatTests({ scenarios: [{ name: "steady", setup: [], expect: [{ ended: true }] }, { name: "bug", replay: "bug.rep", expect: [{ switch: "Alarm raised", is: "clear" }, { minerals: ">= 50", player: 1 }, { gas: 3, player: 1 }] }] }));
    const scenarios = readTests(tests, readFileSync(tests, "utf8"), map.chk, DEFAULTS);
    const lines: string[] = [];
    const run = await runTests("ums.scx", scenarios, map, { out: tmp(), engine: staged.dir, starcraft: copy, live: (l) => lines.push(visible(l)) });
    const handed = readFileSync(specs, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(handed.map((h) => h.play ?? null)).toEqual([null, join(dir, "bug.rep")]);
    expect(handed[1].spec.frames).toBe(REPLAY_END);
    const bug = run.scenarios[1];
    expect(bug).toMatchObject({ ok: false, playing: join(dir, "bug.rep"), parted: 720, replay: null, updated: [] });
    expect(bug.results.map((x) => [x.ok, x.value])).toEqual([[false, "set"], [true, 80], [false, 8]]);
    expect(lines.join("\n")).toMatch(/✖ bug .*bug\.rep · 1 of 3 expectations held\n.*▲ the game parted from the replay at 0:30 \(frame 720\)/);
    // -u: the expectations that no longer hold are taken from this game, and the scenario passes.
    const updating = await runTests("ums.scx", scenarios, map, { out: tmp(), engine: staged.dir, starcraft: copy, update: true });
    expect(updating.scenarios[1]).toMatchObject({ ok: true, updated: [{ expect: 0, kind: "switch", value: "set" }, { expect: 2, kind: "gas", value: 8 }] });
    expect(scenarioLines(updating.scenarios[1]).map(visible)[1]).toBe("      ✎ 2 expectations written anew from this game:");
    expect(updateTests(updating.scenarios)).toEqual([{ file: tests, expectations: 2 }]);
    const written = JSON.parse(readFileSync(tests, "utf8"));
    expect(written.scenarios[1].expect).toEqual([{ switch: "Alarm raised", is: "set" }, { minerals: ">= 50", player: 1 }, { gas: 8, player: 1 }]);
    expect(written.scenarios[0]).toEqual({ name: "steady", setup: [], expect: [{ ended: true }] });
    // A runner from before --play ran it with nobody playing: said, not judged.
    const old = stagedEngine(tmp(), true, OLD_TEST_RUNNER);
    await expect(runTests("ums.scx", [scenarios[1]], map, { out: tmp(), engine: old.dir, starcraft: copy })).rejects.toThrow(/is from before tests driven by a replay/);
  });

  it("makes expectations from the end of a game, in the file's own words", async () => {
    const { tests } = folder(), map = await ums();
    const p = planScenario(map.chk, { name: "snap", replay: "bug.rep" }, tests, 0, DEFAULTS);
    // The lines come as the map's bytes: this map's text is UTF-8.
    expect(p.encoding).toBe("utf-8");
    const line = (row: number, fired: number) => ({ player: 0, row, fired, continued: 0, failed: 0, firstFired: fired ? 2 : null, lastFired: fired ? 2 : null, lastFail: null, flags: 0 });
    const observed: Observed = {
      ...nothing(4), switches: [0, 9], deaths: [[1, 37, 4]], counts: [3, 1, 0, 2], outcomes: ["victory", "defeat", null, null, null, null, null, null],
      texts: [{ frame: 2, text: "\x04Hold the base." }, { frame: 3, text: "Ann:\x02 gg" }, { frame: 4, text: "\x04Hold the base." }, { frame: 5, text: "Caf\xc3\xa9 open" }],
      resources: Array.from({ length: 12 }, (_, i) => (i === 0 ? [75, 5] : [0, 0])),
    };
    const expect_ = snapshotExpect(p, { ended: true, trace: [line(0, 1), line(1, 3), { ...line(2, 0), player: 1 }], observed }, ANN_BO);
    expect(expect_).toEqual([
      { trigger: "Opening", fired: 1 }, { trigger: 2, fired: 3 }, { trigger: 3, fired: 0 },
      { switch: "Alarm raised", is: "set" }, { switch: 10, is: "set" },
      { text: "Hold the base.", shown: true }, { text: "Café open", shown: true },
      { outcome: "victory", player: 1 }, { outcome: "defeat", player: 2 }, { ended: true },
      { units: "Men", player: 1, is: 3 }, { units: "Buildings", player: 1, is: 1 }, { units: "Men", player: 2, is: 0 }, { units: "Buildings", player: 2, is: 2 },
      { minerals: 75, player: 1 }, { gas: 5, player: 1 }, { minerals: 0, player: 2 }, { gas: 0, player: 2 },
      { deaths: "Zerg Zergling", player: 2, is: 4 },
    ]);
    // Every entry holds against the game it came from.
    const back = planScenario(map.chk, { name: "snap", replay: "bug.rep", expect: expect_ }, tests, 0, DEFAULTS);
    expect(judge(back, { frame: 1000, ended: true, trace: [line(0, 1), line(1, 3), { ...line(2, 0), player: 1 }], observed }).every((x) => x.ok)).toBe(true);
    expect(shownText("Caf\xe9", "windows-1252")).toBe("Café");
  });

  it("records a replay into the tests file: a new scenario, then the same one written anew", async () => {
    const { dir, tests } = folder(), map = await ums();
    const staged = stagedEngine(tmp(), true, FAKE_TEST_RUNNER), copy = classicCopy(tmp());
    const answer = join(tmp(), "answer.json");
    process.env.SCMJS_TEST_ANSWER = answer;
    writeFileSync(answer, JSON.stringify({ frame: 1000, ended: true, trace: [{ player: 0, row: 0, fired: 1, continued: 0, failed: 0, firstFired: 2, lastFired: 2, lastFail: null, flags: 8 }], observed: { switches: [0], outcomes: ["victory", "defeat", null, null, null, null, null, null] } }));
    writeFileSync(tests, formatTests([{ name: "kept", setup: [] }]));
    const o = { name: "bug report", out: tmp(), engine: staged.dir, starcraft: copy };
    const r = await recordTest("ums.scx", map, { path: join(dir, "bug.rep"), frames: 1000, players: ANN_BO }, tests, o);
    expect(r).toMatchObject({ file: tests, map: "ums.scx", name: "bug report", replaced: false, frames: 1000, frame: 1000, parted: null });
    const file = JSON.parse(readFileSync(tests, "utf8"));
    expect(file.map((x: { name: string }) => x.name)).toEqual(["kept", "bug report"]);
    expect(file[1]).toMatchObject({ name: "bug report", replay: "bug.rep", frames: 1000 });
    expect(file[1].expect.slice(0, 2)).toEqual([{ trigger: "Opening", fired: 1 }, { switch: "Alarm raised", is: "set" }]);
    // One expectation a line, so trimming is deleting lines.
    expect(readFileSync(tests, "utf8")).toContain('\n      { "trigger": "Opening", "fired": 1 },\n');
    expect(visible(recordLines(r)[0])).toMatch(/^✔ Recorded "bug report" into .*ums\.tests\.json · 1,000 frames \(0:42\) · \d+ expectations · /);
    const again = await recordTest("ums.scx", map, { path: join(dir, "bug.rep"), frames: 1000, players: ANN_BO }, tests, { ...o, frames: 600 });
    expect(again).toMatchObject({ replaced: true, frames: 600 });
    expect(JSON.parse(readFileSync(tests, "utf8")).map((x: { frames?: number }) => x.frames ?? null)).toEqual([null, 600]);
  });

  it("writes JSON a person trims: plain objects on a line, the rest indented", () => {
    expect(formatTests({ scenarios: [{ name: "a", replay: "b.rep", expect: [{ trigger: 1, fired: 2 }, { text: "x", shown: true }] }] })).toBe([
      "{", '  "scenarios": [', "    {", '      "name": "a",', '      "replay": "b.rep",', '      "expect": [', '        { "trigger": 1, "fired": 2 },', '        { "text": "x", "shown": true }', "      ]", "    }", "  ]", "}",
    ].join("\n"));
    expect(formatTests({ steps: [], setup: {} })).toBe('{ "steps": [], "setup": {} }');
  });
});

describe("scmjs map test record: its options", () => {
  it("reads --json, --frames, --starcraft and --engine typed after it, which map test declares too", async () => {
    const program = buildProgram();
    const record = program.commands.find((c) => c.name() === "map")!.commands.find((c) => c.name() === "test")!.commands.find((c) => c.name() === "record")!;
    let seen: Record<string, unknown> = {};
    record.action((_m: string, _r: string, local: Record<string, unknown>, cmd: Command) => { seen = typedOptions(cmd, local, ["json", "frames", "starcraft", "engine", "name"]); });
    await program.parseAsync(["map", "test", "record", "a.scx", "b.rep", "--tests", "e.json", "--frames", "1000", "--json", "--starcraft", "/sc", "--name", "x"], { from: "user" });
    expect(seen).toMatchObject({ json: true, frames: "1000", starcraft: "/sc", name: "x", tests: "e.json" });
    // Not typed: map test's own default (2,400 frames) is not taken for the recording's.
    await program.parseAsync(["map", "test", "record", "a.scx", "b.rep"], { from: "user" });
    expect(seen.frames).toBeUndefined();
  });
});

describe("scmjs map test, trace and balance: options that cannot go together", () => {
  it("refuses them before anything is read or played (exit 2)", async () => {
    const refused = async (args: string[]) => {
      const program = buildProgram();
      program.exitOverride();
      try { await program.parseAsync(args, { from: "user" }); } catch (e) { return [(e as CliError).exitCode, (e as Error).message]; }
      return null;
    };
    expect(await refused(["map", "test", "nowhere.scx", "--json", "--format", "junit"])).toEqual([2, "--json and --format junit both say what standard output holds: give one."]);
    expect(await refused(["map", "test", "nowhere.scx", "--clips-format", "webm"])).toEqual([2, "--clips-format says what the clips are: use it with --clips."]);
    expect(await refused(["map", "test", "nowhere.scx", "--frames", "soon"])).toEqual([2, '--frames takes a number of frames or a time (m:ss), not "soon"']);
    expect(await refused(["map", "test", "nowhere.scx", "--save"])).toEqual([2, "--save keeps the scenarios read from standard input: give - as a tests file."]);
    expect(await refused(["map", "test", "nowhere.scx", "--all"])).toEqual([2, "--all lists what --show cuts: use it with --show."]);
    expect(await refused(["map", "test", "-", "-"])).toEqual([2, "The map and the scenarios cannot both come from standard input"]);
    expect(await refused(["map", "test", "nowhere.scx", "-", "-"])).toEqual([2, "Standard input is read once: name - once."]);
    expect(await refused(["map", "trace", "--replay", "nowhere.rep", "--seed", "3"])).toEqual([2, "--seed does nothing with --replay: the game plays with the replay's own seed."]);
    expect(await refused(["map", "trace", "nowhere.scx", "--every", "often"])).toEqual([2, '--every takes a whole number, not "often"']);
    expect(await refused(["map", "balance", "nowhere.scx", "--bots", "a.scmbot", "--games", "3", "--seeds", "1,2"])).toEqual([2, "--games and --seeds both say which games to play: give one."]);
  });
});

describe("scmjs map test: what a tool hands over and is told", () => {
  const fired = (row: number, n: number, first: number | null) => ({ player: 0, row, fired: n, continued: 0, failed: 0, firstFired: first, lastFired: first, lastFail: null, flags: 0 });

  it("aims an order at a tile through a location of the copy alone, with no string added", async () => {
    const map = await ums();
    const before = parseScenario(map.chk);
    const p = await plan({ name: "walk", steps: [{ at: 24, order: "move", to: [10, 12] }, { at: 48, order: "attack", to: [10, 12] }, { at: 72, order: "move", to: [3, 4] }] });
    const [a, b, c] = p.spec.steps as { to: number }[];
    // One location a tile, in slots the map does not use; the same tile is the same location.
    expect(a.to).toBe(b.to);
    expect(c.to).not.toBe(a.to);
    expect(before.locations[a.to - 1].right - before.locations[a.to - 1].left).toBe(0);
    expect(p.scenario.locations[a.to - 1]).toEqual({ left: 320, top: 384, right: 352, bottom: 416, nameIndex: 0, elevationFlags: 0 });
    expect(p.scenario.strings.strings).toEqual(before.strings.strings);
    // The copy the game is handed holds it; the map's own bytes were never touched.
    expect(parseScenario(serializeScenario(p.scenario)).locations[a.to - 1].left).toBe(320);
    expect((await refused(() => plan({ name: "off", steps: [{ at: 1, order: "move", to: [64, 0] }] }))).message).toMatch(/steps\[0\]\.to: takes a location's name or a tile as \[x, y\] on the map \(64 × 64\), not \[64,0\]/);
    expect((await refused(() => plan({ name: "off", steps: [{ at: 1, order: "move", to: [1] }] }))).message).toMatch(/a tile as \[x, y\]/);
  });

  it("plans scenarios given as values, one that expects nothing among them, and refuses two of a name", async () => {
    const map = await ums();
    const planned = planInline(map.chk, [{ name: "look", frames: "0:10" }, { expect: [{ ended: false }] }], "ums.tests.json", DEFAULTS);
    expect(planned.map((p) => [p.name, p.frames, p.expect.length])).toEqual([["look", 240, 0], ["scenario 2", 2400, 1]]);
    expect(() => planInline(map.chk, [{ name: "a" }, { name: "A" }], "ums.tests.json", DEFAULTS)).toThrow(/two scenarios named "A"/);
    expect(() => planInline(map.chk, [{ name: "a", stpes: [] }], "ums.tests.json", DEFAULTS)).toThrow(/"stpes" is not something the tests know: did you mean "steps"\?/);
  });

  it("says what a game did: the end, the person's resources, each line once, the map's triggers in the order they fired, orders that found no unit", async () => {
    const p = await plan({ name: "x", setup: [{ switch: 1 }] });
    const observed: Observed = { ...nothing(0), resources: [[100, 25], ...Array.from({ length: 11 }, () => [0, 0] as [number, number])], outcomes: ["victory", null, "defeat", null, null, null, null, null],
      texts: [{ frame: 2, text: "Hold the base." }, { frame: 33, text: "Hold the base." }, { frame: 64, text: "\x04Well done" }, { frame: 70, text: "  " }],
      steps: [{ frame: 24, kind: "order", units: 0 }, { frame: 48, kind: "order", units: 2 }, { frame: 60, kind: "chat" }] };
    // Row 0 is the setup's trigger: the map's own rows come after it, and are numbered as the map has them.
    const h = happened(p, { localPlayer: 0 }, { frame: 190, ended: true, trace: [fired(0, 1, 0), fired(1, 1, 2), fired(2, 0, null), fired(3, 4, 1)], observed });
    expect(h).toEqual({
      frame: 190, ended: true, person: 0, minerals: 100, gas: 25,
      outcomes: [{ player: 0, outcome: "victory" }, { player: 2, outcome: "defeat" }],
      texts: [{ frame: 2, text: "Hold the base." }, { frame: 64, text: "Well done" }],
      fired: [{ row: 2, comment: null, fired: 4, first: 1 }, { row: 0, comment: "Opening", fired: 1, first: 2 }],
      idle: [{ frame: 24, kind: "order" }],
    });
  });

  it("reads scenarios handed over on standard input: named by where they came from, one that expects nothing taken", async () => {
    const map = await ums();
    const from = { from: "standard input" };
    // A list or a whole tests file; planned as if in the map's own tests file, which is where they are kept.
    const listed = readTests("ums.tests.json", '[{ "name": "look", "frames": "0:10" }]', map.chk, DEFAULTS, from);
    expect(listed.map((p) => [p.name, p.frames, p.expect.length, p.file, p.line])).toEqual([["look", 240, 0, "ums.tests.json", null]]);
    const whole = readTests("ums.tests.json", '{ "frames": 100, "scenarios": [{ "name": "a", "expect": [{ "ended": false }] }] }', map.chk, DEFAULTS, from);
    expect(whole.map((p) => [p.name, p.frames])).toEqual([["a", 100]]);
    // The same text read as the file's own is refused: a test that expects nothing passes whatever happens.
    expect(() => readTests("ums.tests.json", '[{ "name": "look" }]', map.chk, DEFAULTS)).toThrow(/ums\.tests\.json: "look".*expects nothing/s);
    expect(() => readTests("ums.tests.json", "[{", map.chk, DEFAULTS, from)).toThrow(/^standard input is not JSON/);
    expect(() => readTests("ums.tests.json", '{ "tests": [] }', map.chk, DEFAULTS, from)).toThrow(/^standard input has no "scenarios" list/);
    expect(() => readTests("ums.tests.json", '[{ "name": "a" }, { "name": "A" }]', map.chk, DEFAULTS, from)).toThrow(/standard input.*two scenarios named "A"/s);
  });

  it("words what a game did under its scenario, lists cut at 30 unless all are asked for", () => {
    const h: Happened = {
      frame: 190, ended: true, person: 0, minerals: 1500, gas: 25, outcomes: [{ player: 0, outcome: "victory" }, { player: 2, outcome: "defeat" }],
      texts: Array.from({ length: 32 }, (_, i) => ({ frame: i * 24, text: `line ${i + 1}` })),
      fired: [{ row: 2, comment: null, fired: 4, first: 1 }, { row: 0, comment: "Opening", fired: 1, first: 2 }], idle: [{ frame: 24, kind: "order" }],
    };
    const lines = happenedLines(h, false, "--all").map((l) => l.trim());
    expect(lines.slice(0, 3)).toEqual(["ran to 0:08 (frame 190): the game ended, Player 1 victory, Player 3 defeat; Player 1 has 1,500 minerals and 25 gas", "▲ the order at 0:01 found no unit to give it to", "shown (32 lines):"]);
    expect(lines.slice(3, 5)).toEqual(['0:00  "line 1"', '0:01  "line 2"']);
    expect(lines).toContain("… and 2 more (--all lists them)");
    expect(lines.slice(-3)).toEqual(["fired (2 triggers), by when first:", "0:00  #3 × 4", '0:00  #1 "Opening"']);
    const all = happenedLines(h, true, "`all`");
    expect(all.filter((l) => l.includes('"line '))).toHaveLength(32);
    expect(all.join("\n")).not.toMatch(/more/);
    const quiet = happenedLines({ ...h, ended: false, outcomes: [], texts: [], fired: [], idle: [] }, false, "--all").map((l) => l.trim());
    expect(quiet).toEqual(["ran to 0:08 (frame 190): the game was still going; Player 1 has 1,500 minerals and 25 gas", "shown: nothing", "fired: none of the map's triggers"]);
  });

  it("counts a scenario that expects nothing as played, neither passed nor failed", () => {
    const one = (name: string, ok: boolean, results: number) => ({ name, ok, results: Array(results).fill({ ok }), ms: 800, playing: null, parted: null, updated: [], notices: [], replay: null }) as unknown as ScenarioResult;
    const said = (scenarios: ScenarioResult[]) => visible(testSummary({ scenarios, ms: 1200 }));
    expect(said([one("look", true, 0)])).toBe("ℹ 1 scenario played, expecting nothing (1.2 s)");
    expect(said([one("a", true, 2), one("look", true, 0)])).toBe("✔ 1 scenario passed · 1 scenario played, expecting nothing (1.2 s)");
    expect(said([one("a", false, 2), one("b", true, 1), one("look", true, 0)])).toBe("✖ 1 of 2 scenarios failed · 1 scenario played, expecting nothing (1.2 s)");
    expect(said([one("a", true, 2), one("b", true, 1)])).toBe("✔ both scenarios passed (1.2 s)");
    expect(visible(scenarioLines(one("look", true, 0))[0])).toMatch(/^ {2}ℹ look/);
  });

  it("keeps scenarios in a tests file: one of a name replaced, the rest added, the file made when it is not there", async () => {
    const file = join(tmp(), "ums.tests.json");
    expect(saveScenarios(file, [{ name: "a", expect: [{ ended: false }] }, { name: "b", frames: 100, expect: [{ ended: true }] }])).toEqual({ added: ["a", "b"], replaced: [] });
    expect(saveScenarios(file, [{ name: "A", frames: "0:05", expect: [{ ended: true }] }, { name: "c", expect: [{ switch: 1 }] }])).toEqual({ added: ["c"], replaced: ["A"] });
    const read = readTests(file, readFileSync(file, "utf8"), (await ums()).chk, DEFAULTS);
    expect(read.map((p) => [p.name, p.frames])).toEqual([["A", 120], ["b", 100], ["c", 2400]]);
    // What a tests file would refuse is not written, and the file stays as it was.
    const was = readFileSync(file, "utf8");
    expect(() => saveScenarios(file, [{ name: "d", expect: [{ ended: true }] }, { name: "e" }])).toThrow(/"e": expects nothing/);
    expect(() => saveScenarios(file, [{ expect: [{ ended: true }] }])).toThrow(/needs a "name"/);
    expect(readFileSync(file, "utf8")).toBe(was);
  });
});

describe("scmjs map test: the forms CI reads", () => {
  const report: TestReport = {
    map: "maps/ums.scx", name: "Test Scenario",
    cases: [
      { name: "wins", file: "maps/ums.tests.json", line: 4, ok: true, ms: 1500, failures: [], replay: null },
      { name: "loses, <badly>", file: "maps/ums.tests.json", line: 23, ok: false, ms: 1700, failures: [{ kind: "trigger", what: "trigger #2 fired", actual: "it never fired: Bring (condition 1) said no last, at frame 591" }, { kind: "switch", what: 'switch "Alarm raised" is set', actual: "it is clear" }], replay: "maps/ums.tests/loses.rep" },
    ],
  };
  it("writes an annotation per expectation that did not hold, JUnit with a case per scenario, and SARIF at the scenario's line", () => {
    const github = githubTestAnnotations([report]);
    expect(github).toHaveLength(2);
    expect(github[0]).toBe("::error file=maps/ums.tests.json,line=23,title=Test Scenario · loses%2C <badly>::trigger #2 fired — it never fired: Bring (condition 1) said no last, at frame 591%0Areplay: maps/ums.tests/loses.rep (scmjs replay open maps/ums.tests/loses.rep)");
    const junit = junitTestXml([report]);
    expect(junit).toContain('<testsuites name="scmjs map test" tests="2" failures="1">');
    expect(junit).toContain('<testcase name="wins" classname="maps/ums.scx" file="maps/ums.tests.json" line="4" time="1.500">');
    expect(junit).toContain('<testcase name="loses, &lt;badly&gt;"');
    expect(junit).toContain('<failure message="2 expectations did not hold">trigger #2 fired');
    const sarif = JSON.parse(sarifTestJson([report], "1.2.3"));
    expect(sarif.runs[0].tool.driver.rules.map((r: { id: string }) => r.id)).toEqual(["scmjs/test-trigger", "scmjs/test-switch"]);
    expect(sarif.runs[0].results[0].locations[0].physicalLocation).toEqual({ artifactLocation: { uri: "maps/ums.tests.json", uriBaseId: "%SRCROOT%" }, region: { startLine: 23 } });
  });
});
