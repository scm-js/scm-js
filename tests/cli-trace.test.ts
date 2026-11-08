/**
 * `scmjs map trace` and `scmjs map cost` (cli/src/trace.ts, cli/src/engine.ts): the engine's map runner found in
 * `current.json` and fetched with the rest, run as a process over a map, its lines kept and worded against the map's own
 * triggers. The runner here is a stand-in script that prints what scm-sim's `src/exact/runMap.ts` prints; the real one
 * needs the lifted game and a copy of StarCraft, which CI has not got. The weigher itself (cli/src/weigh.ts) is
 * checked where the plugin's source is vendored.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureEngine } from "../cli/src/engine";
import { costReport, gameClock, gameMap, printCost, printTrace, replayRun, runMapInGame, summarizeRows, traceReport, weighModule, type CopyLine } from "../cli/src/trace";
import { readArchive } from "../src/editor/mapFile";
import type { Replay } from "@scm-js/replay";
import { CliError, visible } from "../cli/src/ui";
import { openMapBytes } from "../src/editor/mapFile";
import { mapVersionOf } from "../src/formats/chk/scenario";
import { testMap } from "./support/maps";
import { classicCopy, OLD_RUNNER, stagedEngine } from "./support/mapRunner";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-trace-"));
const plain = (lines: string[]) => lines.map(visible);

/** The stand-in runner's process id, once it has written it beside the map (`slow.scx`). */
async function runnerPid(file: string): Promise<number> {
  for (let i = 0; i < 200 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 25));
  return Number(readFileSync(file, "utf8"));
}
/** Whether a process is still there. */
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const ums = async () => (await openMapBytes(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx")).scenario;

describe("scmjs map trace | cost: the runner", () => {
  it("finds the map runner in current.json, and says when a build has none", async () => {
    const staged = stagedEngine(tmp());
    expect((await ensureEngine(staged.dir)).runners.map).toBe("map-cafe0000.cjs");
    expect((await ensureEngine(stagedEngine(tmp(), false).dir)).runners.map).toBeUndefined();
    const copy = classicCopy(tmp());
    const dir = tmp();
    writeFileSync(join(dir, "m.scx"), "MPQ");
    await expect(runMapInGame(join(dir, "m.scx"), "trace", { engine: stagedEngine(tmp(), false).dir, starcraft: copy })).rejects.toThrow(/has no map runner/);
    await expect(runMapInGame(join(dir, "nowhere.scx"), "trace", { engine: staged.dir, starcraft: copy })).rejects.toThrow(/No file/);
    writeFileSync(join(dir, "bad.scx"), "MPQ");
    await expect(runMapInGame(join(dir, "bad.scx"), "trace", { engine: staged.dir, starcraft: copy })).rejects.toThrow(/did not take this map/);
    // The cost needs the weigher: a named module that is not there, and none beside the source.
    await expect(runMapInGame(join(dir, "m.scx"), "cost", { engine: staged.dir, starcraft: copy, weigh: join(dir, "none.mjs") })).rejects.toThrow(/No file/);
    expect(() => weighModule()).toThrow(CliError);
  });

  it("hands the game a file: the map itself, a copy of one read from a pipe, a Brood War copy of a StarCraft 1.00 map", async () => {
    const ums = await openMapBytes(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx");
    expect(await gameMap(ums, testMap("ums.scx"))).toEqual({ path: testMap("ums.scx"), converted: false });
    const piped = await gameMap(ums, "-", "stdin.scx");
    expect(piped.converted).toBe(false);
    expect(piped.path).toMatch(/stdin\.scx$/);
    expect((await openMapBytes(new Uint8Array(readFileSync(piped.path)), "stdin.scx")).scenario.triggers).toHaveLength(3);
    const original = await openMapBytes(new Uint8Array(readFileSync(testMap("original.scm"))), "original.scm");
    const bw = await gameMap(original, testMap("original.scm"));
    expect(bw.converted).toBe(true);
    expect(bw.path).toMatch(/original\.scx$/);
    expect(mapVersionOf((await openMapBytes(new Uint8Array(readFileSync(bw.path)), "original.scx")).scenario.fileVersion)).toBe("broodwar");
    expect(mapVersionOf(original.scenario.fileVersion)).toBe("original");
  });

  it("deletes the copy it handed the game once the runner has ended, whether the run worked or not", async () => {
    const staged = stagedEngine(tmp()), copy = classicCopy(tmp());
    const ums = await openMapBytes(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx");
    const piped = await gameMap(ums, "-", "stdin.scx");
    expect(existsSync(piped.path)).toBe(true);
    await runMapInGame(piped.path, "trace", { engine: staged.dir, starcraft: copy, frames: 62 });
    expect(existsSync(dirname(piped.path))).toBe(false);
    // A run the game refused, and one that never started (no copy of the game).
    const refused = await gameMap(ums, "-", "bad.scx");
    await expect(runMapInGame(refused.path, "trace", { engine: staged.dir, starcraft: copy })).rejects.toThrow(/did not take this map/);
    expect(existsSync(dirname(refused.path))).toBe(false);
    const original = await openMapBytes(new Uint8Array(readFileSync(testMap("original.scm"))), "original.scm");
    const converted = await gameMap(original, testMap("original.scm"));
    await expect(runMapInGame(converted.path, "trace", { engine: staged.dir, starcraft: tmp() })).rejects.toThrow(/not a copy of StarCraft/);
    expect(existsSync(dirname(converted.path))).toBe(false);
    // The person's own map is never touched.
    const own = join(tmp(), "own.scx");
    copyFileSync(testMap("ums.scx"), own);
    expect(await gameMap(ums, own)).toEqual({ path: own, converted: false });
    await runMapInGame(own, "trace", { engine: staged.dir, starcraft: copy, frames: 62 });
    expect(existsSync(own)).toBe(true);
  });

  it("stops the game when the run is cancelled, and fails saying so", async () => {
    const staged = stagedEngine(tmp()), copy = classicCopy(tmp());
    const ums = await openMapBytes(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx");
    const slow = await gameMap(ums, "-", "slow.scx");
    const stop = new AbortController();
    const run = runMapInGame(slow.path, "trace", { engine: staged.dir, starcraft: copy, signal: stop.signal });
    const pid = await runnerPid(`${slow.path}.pid`);
    expect(alive(pid)).toBe(true);
    stop.abort();
    await expect(run).rejects.toThrow(/^The run was cancelled/);
    expect(alive(pid)).toBe(false);
    expect(existsSync(dirname(slow.path))).toBe(false);
    // Cancelled before it started: no runner at all.
    await expect(runMapInGame(testMap("ums.scx"), "trace", { engine: staged.dir, starcraft: copy, signal: AbortSignal.abort() })).rejects.toThrow(/cancelled/);
  });

  it("runs the trace, words it live and reports each trigger against the map's own", async () => {
    const staged = stagedEngine(tmp()), copy = classicCopy(tmp());
    const live: string[] = [];
    const r = await runMapInGame(testMap("ums.scx"), "trace", { engine: staged.dir, starcraft: copy, frames: 310, every: 100, seed: 5, live: (l) => live.push(visible(l)) });
    expect(r.start).toMatchObject({ map: { name: "ums.scx" }, seed: 5, rows: 3 });
    expect(r.progress.map((p) => p.frame)).toEqual([100, 200, 300]);
    expect(r.end.cost).toBeNull();
    expect(live[0]).toMatch(/^ums\.scx 64 × 64, badlands · 3 triggers · seed 5 · 1\.16\.1 files$/);
    expect(live[1]).toMatch(/frame\s+100\s+3 passes of the triggers/);

    const scn = await ums();
    const rep = traceReport("ums.scx", scn, r);
    expect(rep.rows.map((s) => [s.fired, s.failed, s.players])).toEqual([[10, 0, [0]], [1, 0, [0]], [0, 10, [1]]]);
    expect(rep.rows[1].done).toBe(true);
    expect(rep.rows[2].lastFail).toEqual({ slot: 0, type: 3, frame: 281 });
    const lines = plain(printTrace("ums.scx", scn, r, { width: 120 }));
    expect(lines[0]).toMatch(/^✔ ums\.scx: 3 triggers · 310 frames \(0:13 of play\) · 10 passes · 2 fired · 1 never · 0\.0 s$/);
    expect(lines[2]).toMatch(/^ {2}# +Fired +First +Last +Players +Trigger$/);
    expect(lines[3]).toMatch(/^ {2}1 +10 +2 +281 +P1 +.+→ .+/);
    expect(lines[4]).toMatch(/^ {2}2 +1 \+1 +2 +2 +P1 /);
    expect(lines[5]).toMatch(/^ {2}3 +0 +– +– +P2 /);
    expect(lines).toContain("  Never fired (1 of 3)");
    expect(lines.at(-1)).toMatch(/Bring \(condition 1\) said no last, at frame 281/);
    // A row nobody in the game owns, and one the game never asked.
    const rows = summarizeRows([{ player: 0, row: 0, fired: 0, continued: 0, failed: 0, firstFired: null, lastFired: null, lastFail: null, flags: 0 }] as CopyLine[], 2);
    expect(rows[0].players).toEqual([0]);
    expect(rows[1].players).toEqual([]);
    const never = plain(printTrace("ums.scx", scn, { ...r, end: { ...r.end, trace: [rows[0]] } }, { width: 120 }));
    expect(never.filter((l) => /no player in the game owns it|it was never asked/.test(l))).toHaveLength(3);
  });

  it("runs the cost with the weigher and reports a frame's cost against Remastered's", async () => {
    const staged = stagedEngine(tmp()), copy = classicCopy(tmp());
    const weigh = join(tmp(), "weigh.mjs");
    writeFileSync(weigh, "export const weigher = () => ({ trigger: () => 0, record: () => 0 });\n");
    const r = await runMapInGame(testMap("ums.scx"), "cost", { engine: staged.dir, starcraft: copy, frames: 310, every: 0, weigh });
    expect(r.progress).toEqual([]);
    expect(r.end.trace).toBeNull();
    expect(r.end.cost?.weighed).toBe(true);
    const rep = costReport("ums.scx", r);
    expect(rep.ranIn).toBe(10);
    expect(rep.averageMs).toBeCloseTo(0.024, 5);
    expect(rep.peakMs).toBeCloseTo(0.024, 5);
    expect(rep.peakFrame).toBe(2);
    expect(rep.rows.map((x) => [x.row, Number(x.msAFrame.toFixed(3))])).toEqual([[0, 0.014], [2, 0.01]]);
    const scn = await ums();
    const lines = plain(printCost("ums.scx", scn, r, { width: 120 }));
    expect(lines[0]).toMatch(/^✔ ums\.scx: triggers cost 0\.024 ms a frame on average where they ran \(10 of 308 frames\), 0\.024 ms at the most \(frame 2: 6 records, 3 triggers\)$/);
    expect(lines[1]).toMatch(/smooth to about 15 ms of triggers a frame, slows past 37 ms/);
    expect(lines[2]).toMatch(/^ {2}20 of the records ran in no trigger of the map — a program's own \(TrigScript, eudplib\), 0\.010 ms in all$/);
    expect(rep.ungrouped).toEqual({ records: 20, ms: 0.01 });
    expect(lines[4]).toBe("  Costliest triggers, a frame they ran in");
    expect(lines[6]).toMatch(/^ {2}1 +0\.014 ms +10 +30 +.+→ .+/);
    expect(lines[7]).toMatch(/^ {2}3 +0\.010 ms +10 +10 +/);

    // A run in which the triggers ran nothing.
    const quiet = { ...r, end: { ...r.end, cost: { ...r.end.cost!, ns: r.end.cost!.ns.map(() => 0) } } };
    expect(plain(printCost("ums.scx", scn, quiet))[0]).toBe("✔ ums.scx: the triggers ran nothing in 308 frames");
  });
});

describe("scmjs map trace | cost --replay: a replay's game", () => {
  /** A file the stand-in takes for a replay (it reads only the name). */
  const replayFile = (name: string) => { const f = join(tmp(), name); writeFileSync(f, "a replay"); return f; };

  it("hands the runner the replay, words the game by its clock, and lists the firings in order", async () => {
    const staged = stagedEngine(tmp()), copy = classicCopy(tmp());
    const live: string[] = [];
    const r = await runMapInGame(null, "trace", { engine: staged.dir, starcraft: copy, replay: replayFile("bug.rep"), order: true, every: 500, live: (l) => live.push(visible(l)) });
    expect(r.start).toMatchObject({ mode: "replay", replaced: false, replay: { name: "bug.rep", frames: 1000 } });
    expect(live[0]).toBe("bug.rep 64 × 64, badlands · 2 players · 0:42 · 3 triggers · 1.16.1 files");
    expect(live[1]).toMatch(/^ +0:21 {2}frame +500 {2}16 passes of the triggers$/);
    const scn = await ums();
    const rep = traceReport("bug.rep", scn, r);
    expect(rep.replay).toMatchObject({ gameType: "Use Map Settings", mapSettings: true, by: "victory", replaced: false, parted: null, orderDropped: 0 });
    expect(rep.replay!.players).toEqual([{ slot: 0, name: "Ann", race: "terran", outcome: "victory" }, { slot: 1, name: "Bo", race: "zerg", outcome: "defeat" }]);
    expect(rep.replay!.order!.slice(0, 3)).toEqual([{ frame: 2, clock: "0:00", player: 0, row: 1 }, { frame: 2, clock: "0:00", player: 0, row: 0 }, { frame: 33, clock: "0:01", player: 0, row: 0 }]);
    const lines = plain(printTrace("bug.rep", scn, r, { width: 120 }));
    expect(lines[0]).toMatch(/^✔ bug\.rep: 3 triggers · 1,000 frames \(0:42\), Ann won · 32 passes · 2 fired · 1 never · 0\.1 s$/);
    // First and last as the game's clock; the last firing of row 0 is at frame 963.
    expect(lines.find((l) => /^ {2}1 +32 /.test(l))).toMatch(/^ {2}1 +32 +0:00 +0:40 +P1 /);
    const at = lines.indexOf("  In the order they fired (33)");
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toMatch(/^ {2}Clock +Frame +Player +# +Trigger$/);
    expect(lines[at + 2]).toMatch(/^ {2}0:00 +2 +P1 Ann +#2 +/);
    expect(lines.at(-1)).toMatch(/^ {2}0:40 +963 +P1 Ann +#1 +/);
    expect(gameClock(14603)).toBe("10:13");
  });

  it("plays a map given in place of the replay's own, and warns when the game parted from the replay", async () => {
    const staged = stagedEngine(tmp()), copy = classicCopy(tmp());
    const r = await runMapInGame(testMap("ums.scx"), "trace", { engine: staged.dir, starcraft: copy, replay: replayFile("parted.rep"), frames: 400 });
    expect(r.start).toMatchObject({ replaced: true, map: { name: "ums.scx" } });
    const scn = await ums();
    const lines = plain(printTrace("parted.rep", scn, r, { width: 120 }));
    expect(lines[0]).toMatch(/^✔ parted\.rep: .* 400 frames \(0:17\), stopped there · /);
    expect(lines[1]).toBe("▲ The game parted from the replay at 0:21 (frame 500): the players' commands after it were meant for another game, so what fired after that is not what happened.");
    expect(traceReport("parted.rep", scn, r).replay!.order).toBeNull();
    // A melee game runs the game's own triggers.
    const melee = await runMapInGame(null, "trace", { engine: staged.dir, starcraft: copy, replay: replayFile("melee.rep") });
    expect(plain(printTrace("melee.rep", scn, melee))[1]).toBe("ℹ The replay is a Melee game: the game ran its own triggers for it, not the map's.");
    // The cost of a replay's game.
    const cost = await runMapInGame(null, "cost", { engine: staged.dir, starcraft: copy, replay: replayFile("bug.rep"), weigh: weighStandIn() });
    expect(costReport("bug.rep", cost).frames).toBe(998);
  });

  it("says when the engine's map runner is from before replays, or there is nothing to run", async () => {
    const old = stagedEngine(tmp(), true, OLD_RUNNER), copy = classicCopy(tmp());
    await expect(runMapInGame(null, "trace", { engine: old.dir, starcraft: copy, replay: replayFile("a.rep") })).rejects.toThrow(/map runner from before map trace --replay/);
    await expect(runMapInGame(testMap("ums.scx"), "trace", { engine: old.dir, starcraft: copy, replay: replayFile("a.rep") })).rejects.toThrow(/map runner from before map trace --replay/);
    await expect(runMapInGame(null, "trace", { engine: old.dir, starcraft: copy })).rejects.toThrow(/name one, or a replay/);
    await expect(runMapInGame(null, "trace", { engine: old.dir, starcraft: copy, replay: join(tmp(), "none.rep") })).rejects.toThrow(/No file/);
  });

  it("compares a map given with the replay's: the same scenario is no difference, another is named", async () => {
    const ums = new Uint8Array(readFileSync(testMap("ums.scx"))), melee = new Uint8Array(readFileSync(testMap("melee.scx")));
    const rep = { chk: (await readArchive(ums)).chk } as Replay;
    const own = await replayRun(rep, null);
    expect(own).toMatchObject({ map: null, converted: false, differs: null });
    expect(own.scenario.triggers).toHaveLength(3);
    const same = await replayRun(rep, { doc: await openMapBytes(ums, "ums.scx"), path: testMap("ums.scx"), name: "ums.scx", bytes: ums });
    expect(same).toMatchObject({ map: testMap("ums.scx"), converted: false, differs: null });
    const other = await replayRun(rep, { doc: await openMapBytes(melee, "melee.scx"), path: testMap("melee.scx"), name: "melee.scx", bytes: melee });
    expect(other.differs).toMatch(/changed|added|removed/);
    // A replay of a StarCraft 1.00 map is played as a converted copy, deleted with the run.
    const original = { chk: (await readArchive(new Uint8Array(readFileSync(testMap("original.scm"))))).chk } as Replay;
    const converted = await replayRun(original, null);
    expect(converted.converted).toBe(true);
    expect(converted.map).toMatch(/replay\.scx$/);
    await runMapInGame(converted.map, "trace", { engine: stagedEngine(tmp()).dir, starcraft: classicCopy(tmp()), replay: replayFile("old.rep") });
    expect(existsSync(dirname(converted.map!))).toBe(false);
  });
});

/** A weigher that weighs nothing, for a cost run of the stand-in. */
function weighStandIn(): string {
  const f = join(tmp(), "weigh.mjs");
  writeFileSync(f, "export const weigher = () => ({ trigger: () => 0, record: () => 0 });\n");
  return f;
}

const have = existsSync(join(import.meta.dirname, "..", "plugins", "trigscript", "compiler", "remasteredCost.ts"));
describe.skipIf(!have)("scmjs map cost: the weigher", () => {
  it("is TrigScript's model of Remastered, over a memory, with its two limits", async () => {
    const { weigher, SMOOTH_MS, MOST_MS } = await import("../cli/src/weigh");
    expect(SMOOTH_MS).toBe(15);
    expect(MOST_MS).toBeCloseTo(36.6, 1);
    const w = weigher(new DataView(new ArrayBuffer(64)));
    // A trigger the walk passes with neither cache holding its region: the walk and a search; a condition outside the emulator.
    expect(w.trigger(0x1000)).toBeCloseTo(8.6 + 7.3, 5);
    expect(w.record(0, 22, false)).toBeCloseTo(3.6, 5);
  });
});
