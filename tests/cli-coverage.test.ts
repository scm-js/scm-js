/**
 * `scmjs map coverage` (cli/src/coverage.ts): the replays read, matched to the map and played by the engine's map runner
 * as `map trace --replay` plays one, a few at once, every game's trace added up per trigger; a game that parted from the
 * map counted only to there; a tests file's scenarios as games; the report and its CI forms. The runner is the stand-in
 * of tests/support/mapRunner.ts — the real one needs the lifted game and a copy of StarCraft, which CI has not got.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chk, cmds, writeReplay } from "@scm-js/replay/write";
import { afterEach, describe, expect, it } from "vitest";
import { addGames, coverageForm, coverageJson, coverageScenario, gameRows, printCoverage, runCoverage } from "../cli/src/coverage";
import type { Input } from "../cli/src/files";
import { githubCoverageAnnotations, junitCoverageXml, sarifCoverageJson } from "../cli/src/report";
import type { CopyLine } from "../cli/src/trace";
import { CliError, visible } from "../cli/src/ui";
import { openMapBytes, readArchive } from "../src/editor/mapFile";
import { testMap } from "./support/maps";
import { classicCopy, FAKE_TEST_RUNNER, OLD_RUNNER, stagedEngine } from "./support/mapRunner";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-coverage-"));
const plain = (lines: string[]) => lines.map(visible);
afterEach(() => { process.exitCode = 0; });

const copy = (o: Partial<CopyLine> & Pick<CopyLine, "player" | "row">): CopyLine => ({ fired: 0, continued: 0, failed: 0, firstFired: null, lastFired: null, lastFail: null, flags: 0, ...o });

describe("map coverage: adding up the games", () => {
  it("folds a game to the map's rows, and counts a game that parted only to there", () => {
    const lines = [
      copy({ player: 0, row: 0, fired: 30, firstFired: 2, lastFired: 900 }),
      copy({ player: 1, row: 0, fired: 30, firstFired: 2, lastFired: 900 }),
      copy({ player: 0, row: 1, fired: 1, firstFired: 600, lastFired: 600 }),
      copy({ player: 1, row: 2, failed: 30, lastFail: { slot: 0, type: 3, frame: 900 } }),
      copy({ player: 0, row: 7 }),
    ];
    const whole = gameRows(lines, 3);
    expect(whole.map((s) => [s.players, s.fired, s.first])).toEqual([[[0, 1], 60, 2], [[0], 1, 600], [[1], 0, null]]);
    expect(whole[2].lastFail).toEqual({ slot: 0, type: 3, frame: 900 });
    // Parted at 500: the firings in order before it; row 1 first fired after it, and the failure after it is not said.
    const parted = gameRows(lines, 3, 500, [[2, 0, 0], [2, 1, 0], [33, 0, 0], [600, 0, 1]]);
    expect(parted.map((s) => [s.fired, s.first])).toEqual([[3, 2], [0, null], [0, null]]);
    expect(parted[2].lastFail).toBeNull();
    // The order the runner kept ran out before the parting: a copy that first fired before it counts once.
    expect(gameRows([copy({ player: 0, row: 1, fired: 9, firstFired: 100 })], 3, 500, [])[1]).toMatchObject({ fired: 1, first: 100 });
    // A test's setup triggers come before the map's own: shifted back.
    expect(gameRows([copy({ player: 0, row: 2, fired: 4, firstFired: 2 })], 2, null, null, 1)[1]).toMatchObject({ fired: 4, first: 2 });
  });

  it("adds the games up: games fired in, firings, the first one and where, the last failing condition", () => {
    const g1 = gameRows([copy({ player: 0, row: 0, fired: 2, firstFired: 50 }), copy({ player: 0, row: 1, failed: 3, lastFail: { slot: 1, type: 3, frame: 90 } })], 3);
    const g2 = gameRows([copy({ player: 0, row: 0, fired: 1, firstFired: 10 }), copy({ player: 2, row: 1, failed: 3, lastFail: { slot: 0, type: 2, frame: 400 } })], 3);
    const all = addGames([{ name: "a.rep", rows: g1 }, { name: "b.rep", rows: g2 }], 3);
    expect(all[0]).toMatchObject({ players: [0], games: 2, fired: 3, first: 10, firstIn: "b.rep" });
    expect(all[1]).toMatchObject({ players: [0, 2], games: 0, fired: 0, lastFail: { slot: 0, type: 2, frame: 400, game: "b.rep" } });
    expect(all[2]).toMatchObject({ players: [], games: 0 });
  });
});

describe("map coverage: the run", () => {
  const map = readFileSync(testMap("ums.scx"));
  const input: Input = { path: testMap("ums.scx"), name: "ums.scx", bytes: new Uint8Array(map), kind: "map" };
  const doc = () => openMapBytes(input.bytes, "ums.scx");
  const rep = async (names: string[], gameType = 10, scenario?: Uint8Array) => writeReplay({ format: "legacy", gameType, players: names.map((name, i) => ({ index: i, id: i, name, type: 2 })), commands: cmds([]), chk: scenario ?? (await readArchive(input.bytes)).chk });

  /** A folder of replays: three of this map played as Use Map Settings (one in a sub-folder, one that parts), and five that do not count. */
  async function replays() {
    const dir = join(tmp(), "reps");
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "a.rep"), await rep(["Ann", "Bo"]));
    writeFileSync(join(dir, "dup.rep"), await rep(["Ann", "Bo"]));
    writeFileSync(join(dir, "parted.rep"), await rep(["Cy", "Di"]));
    writeFileSync(join(dir, "sub", "b.rep"), await rep(["Ed", "Flo"]));
    writeFileSync(join(dir, "melee.rep"), await rep(["Gus", "Hal"], 2));
    writeFileSync(join(dir, "other.rep"), await rep(["Ann", "Bo"], 10, chk(96, 64, 4, 0)));
    writeFileSync(join(dir, "notes.rep"), "hello");
    return dir;
  }

  it("plays the Use Map Settings replays of this map, a few at once, and adds their traces up", async () => {
    const staged = stagedEngine(tmp()), sc = classicCopy(tmp()), dir = await replays();
    const live: string[] = [];
    const r = await runCoverage(input, await doc(), [dir], { engine: staged.dir, starcraft: sc, parallel: "2" }, (l) => live.push(visible(l)));
    expect(r.games.map((g) => [g.name, g.match, g.parted, g.fired, g.players])).toEqual([
      ["a.rep", "same", null, 2, ["Ann", "Bo"]], ["parted.rep", "same", 500, 2, ["Ann", "Bo"]], ["b.rep", "same", null, 2, ["Ann", "Bo"]],
    ]);
    expect(r.skipped.map((s) => [s.file.replace(/^.*reps\//, ""), s.reason])).toEqual([
      ["dup.rep", "the same replay as one before it"],
      ["melee.rep", "not Use Map Settings: in a Melee game the game runs its own triggers, not the map's"],
      ["notes.rep", "not a replay"],
      ["other.rep", "played on a map with no name (96 × 64), another size"],
    ]);
    // Row 1 fires every pass (32 a game, 17 before the parting at frame 500), row 2 once a game, row 3 never.
    expect(r.rows.map((c) => [c.games, c.fired, c.first, c.firstIn, c.players])).toEqual([[3, 81, 2, "a.rep", [0]], [3, 3, 2, "a.rep", [0]], [0, 0, null, null, [1]]]);
    expect(r.rows[2].lastFail).toEqual({ slot: 0, type: 3, frame: 963, game: "a.rep" });
    expect(r).toMatchObject({ triggers: 3, owned: 3, fired: 2, never: 1, name: "Test Scenario" });
    expect(live.some((l) => /^▲ .*melee\.rep left out: not Use Map Settings/.test(l))).toBe(true);
    expect(live).toContain("ums.scx · 3 triggers · 3 replays to play, 2 at a time");
    // A line as each game is done, in the order they end (two at a time): the counter, then the game.
    const done = live.filter((l) => /^\d\/3 /.test(l)).map((l) => l.slice(4)).sort();
    expect(done).toHaveLength(3);
    expect(done[0]).toMatch(/^▲ parted\.rep {2}0:42 · 2 players · 2 triggers fired · parted at 0:21, counted to there · /);
    expect(done[1]).toMatch(/^✔ a\.rep {2}0:42 · 2 players · 2 triggers fired · /);
    expect(done[2]).toMatch(/^✔ b\.rep {2}0:42 · 2 players · 2 triggers fired · /);

    const scn = await coverageScenario(input);
    const lines = plain(printCoverage(r, scn, { width: 120 }));
    expect(lines[0]).toBe("▲ ums.scx: 2 of 3 triggers fired in 3 games; 1 never fired");
    expect(lines[1]).toBe("▲ 1 game parted from the map: parted.rep at 0:21. What fired after that is not counted: the players' commands were meant for another game.");
    expect(lines[3]).toMatch(/^ {2}# {2}Games {2}Fired {2}First {2}Players {2}Trigger$/);
    expect(lines[4]).toMatch(/^ {2}1 +3\/3 +81 +0:00 +P1 +Always\(\) → Display Text Message/);
    expect(lines[6]).toMatch(/^ {2}3 +0\/3 +0 +– +P2 +Switch\("Alarm raised", set\) → Victory\(\)$/);
    expect(lines.slice(-3)).toEqual(["  Never fired (1 of 3)", expect.stringMatching(/^ {2}▸ #3 {2}Switch\("Alarm raised", set\) → Victory\(\)/), "      Bring (condition 1) said no last, in a.rep at 0:40"]);
    expect(plain(printCoverage(r, scn, { strict: true }))[0]).toMatch(/^✖ /);
    const json = coverageJson(r, scn);
    expect(json.rows[2]).toMatchObject({ number: 3, owned: true, fired: 0, firstClock: null, owners: "Force 1", text: 'Switch("Alarm raised", set) → Victory()', why: "Bring (condition 1) said no last, in a.rep at 0:40" });
    expect(json.rows[0]).toMatchObject({ number: 1, firstClock: "0:00" });
    expect(json.rows[0]).not.toHaveProperty("why");
  });

  it("writes the triggers that never fired, and the games that parted, for CI", async () => {
    const r = await runCoverage(input, await doc(), [await replays()], { engine: stagedEngine(tmp()).dir, starcraft: classicCopy(tmp()), parallel: "1" });
    const scn = await coverageScenario(input);
    const gh = githubCoverageAnnotations([coverageForm(input.path, r, scn, false)]);
    expect(gh).toEqual([
      expect.stringMatching(/^::warning file=.*ums\.scx,title=Test Scenario · trigger #3::Trigger #3 never fired in 3 games: Switch\("Alarm raised", set\) → Victory\(\)%0ABring \(condition 1\) said no last, in a\.rep at 0:40$/),
      expect.stringMatching(/^::notice file=.*ums\.scx,title=Test Scenario · parted\.rep::parted\.rep parted from the map at 0:21: what fired after that is not counted$/),
    ]);
    expect(githubCoverageAnnotations([coverageForm(input.path, r, scn, true)])[0]).toMatch(/^::error /);
    const junit = junitCoverageXml([coverageForm(input.path, r, scn, false)]);
    expect(junit).toContain(`<testsuites name="scmjs map coverage" tests="3" skipped="1">`);
    expect(junit).toContain(`<skipped message="Trigger #3 never fired in 3 games: Switch(&quot;Alarm raised&quot;, set) → Victory()"/>`);
    expect(junitCoverageXml([coverageForm(input.path, r, scn, true)])).toContain(`<failure message="never fired">`);
    const sarif = JSON.parse(sarifCoverageJson([coverageForm(input.path, r, scn, true)], "1.2.3"));
    expect(sarif.runs[0].tool.driver).toMatchObject({ name: "scmjs map coverage", version: "1.2.3" });
    expect(sarif.runs[0].results.map((x: { ruleId: string; level: string }) => [x.ruleId, x.level])).toEqual([["scmjs/coverage-never-fired", "error"], ["scmjs/coverage-parted", "note"]]);
  });

  it("counts a tests file's scenarios as games", async () => {
    const dir = tmp();
    const tests = join(dir, "ums.tests.json");
    writeFileSync(tests, JSON.stringify({ scenarios: [{ name: "quiet", frames: 100, expect: [{ ended: false }] }, { name: "quiet again", frames: 200, expect: [{ ended: false }] }] }));
    const answer = join(dir, "answer.json");
    writeFileSync(answer, JSON.stringify({ frame: 100, trace: [copy({ player: 0, row: 0, fired: 3, firstFired: 2 }), copy({ player: 0, row: 1, failed: 3, lastFail: { slot: 0, type: 3, frame: 64 } }), copy({ player: 1, row: 2, fired: 1, firstFired: 50 })] }));
    process.env.SCMJS_TEST_ANSWER = answer;
    try {
      const live: string[] = [];
      const r = await runCoverage(input, await doc(), [tests], { engine: stagedEngine(tmp(), true, FAKE_TEST_RUNNER).dir, starcraft: classicCopy(tmp()) }, (l) => live.push(visible(l)));
      expect(r.games.map((g) => [g.kind, g.name, g.fired])).toEqual([["test", "quiet", 2], ["test", "quiet again", 2]]);
      expect(r.rows.map((c) => [c.games, c.fired])).toEqual([[2, 6], [0, 0], [2, 2]]);
      expect(r.rows[1].lastFail?.game).toBe('test "quiet"');
      expect(live).toContain("ums.scx · 3 triggers · 2 test scenarios to play");
      expect(live).toContainEqual(expect.stringMatching(/^1\/2 ✔ test "quiet" {2}0:04 · 2 triggers fired · /));
    } finally { delete process.env.SCMJS_TEST_ANSWER; }
  });

  it("refuses what it cannot count, and an engine from before replays", async () => {
    const staged = stagedEngine(tmp()), sc = classicCopy(tmp());
    const fail = (p: Promise<unknown>) => p.then(() => null, (e: CliError) => [e.exitCode, e.message]);
    const dir = await replays();
    expect(await fail(runCoverage(input, await doc(), [], { engine: staged.dir, starcraft: sc }))).toEqual([2, expect.stringMatching(/^Name the replays to count/)]);
    expect(await fail(runCoverage(input, await doc(), [join(dir, "melee.rep")], { engine: staged.dir, starcraft: sc }))).toEqual([2, `${join(dir, "melee.rep")} is not a Use Map Settings game on ums.scx.`]);
    expect(await fail(runCoverage(input, await doc(), [join(dir, "a.rep")], { engine: staged.dir, starcraft: sc, parallel: "0" }))).toEqual([2, expect.stringMatching(/^--parallel takes a whole number/)]);
    // --tests with no tests file beside the map.
    const elsewhere: Input = { ...input, path: join(tmp(), "ums.scx") };
    writeFileSync(elsewhere.path, input.bytes);
    expect(await fail(runCoverage(elsewhere, await doc(), [join(dir, "a.rep")], { engine: staged.dir, starcraft: sc, tests: true }))).toEqual([2, expect.stringMatching(/^No tests file .*ums\.tests\.json$/)]);
    // Another map's replay with --force: played all the same.
    const forced = await runCoverage(input, await doc(), [join(dir, "other.rep")], { engine: staged.dir, starcraft: sc, force: true });
    expect(forced.games[0].match).toBe("forced");
    const old = stagedEngine(tmp(), true, OLD_RUNNER);
    expect(await fail(runCoverage(input, await doc(), [join(dir, "a.rep")], { engine: old.dir, starcraft: sc }))).toEqual([1, expect.stringMatching(/is from before map trace --replay/)]);
    // A game the engine could not play is left out and said, and the command fails; with none played, it says so.
    const refused: Input = { ...input, path: join(tmp(), "bad.scx"), name: "bad.scx" };
    writeFileSync(refused.path, input.bytes);
    const live: string[] = [];
    expect(await fail(runCoverage(refused, await doc(), [join(dir, "a.rep")], { engine: staged.dir, starcraft: sc }, (l) => live.push(visible(l))))).toEqual([1, "The game played none of the 1 replay."]);
    expect(live.find((l) => l.startsWith("1/1 ✖ "))).toMatch(/a\.rep: the game did not take this map$/);
    expect(process.exitCode).toBe(1);
  });
});
