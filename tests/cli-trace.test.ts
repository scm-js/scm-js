/**
 * `scmjs map trace` and `scmjs map cost` (cli/src/trace.ts, cli/src/engine.ts): the engine's map runner found in
 * `current.json` and fetched with the rest, run as a process over a map, its lines kept and worded against the map's own
 * triggers. The runner here is a stand-in script that prints what scm-sim's `src/exact/runMap.ts` prints; the real one
 * needs the lifted game and a copy of StarCraft, which CI has not got. The weigher itself (cli/src/weigh.ts) is
 * checked where the plugin's source is vendored.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureEngine } from "../cli/src/engine";
import { costReport, printCost, printTrace, runMapInGame, summarizeRows, traceReport, weighModule, type CopyLine } from "../cli/src/trace";
import { CliError, visible } from "../cli/src/ui";
import { openMapBytes } from "../src/editor/mapFile";
import { testMap } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-trace-"));
const plain = (lines: string[]) => lines.map(visible);

/**
 * A runner that prints what scm-sim's does, from its arguments: a start, progress lines and an end whose trace is three
 * copies for ums.scx's three triggers (row 0 fired every pass, row 1 fired once and done, row 2 failed on its Bring
 * condition), and whose cost weighs when --weigh names a file.
 */
const FAKE_RUNNER = `
const fs = require("node:fs");
const args = process.argv.slice(2);
const has = (n) => args.includes("--" + n);
const flag = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (!fs.existsSync(flag("engine") + "/core.js")) { say({ kind: "error", message: "no engine at " + flag("engine") }); process.exit(2); }
if (has("weigh") && !fs.existsSync(flag("weigh"))) { say({ kind: "error", message: "no weigh module at " + flag("weigh") }); process.exit(2); }
if (require("node:path").basename(args[0]) === "bad.scx") { say({ kind: "error", message: "the game did not take this map" }); process.exit(2); }
const frames = Number(flag("frames") ?? 2400), every = Number(flag("every") ?? 600), seed = Number(flag("seed") ?? 1);
say({ kind: "start", map: { name: require("node:path").basename(args[0]), width: 64, height: 64, tileset: "badlands" }, copy: "classic", seed, rows: 3, copies: 3, remastered: false, ms: { load: 1, start: 2 } });
for (let f = every; every && f <= frames; f += every) say({ kind: "progress", frame: f, passes: Math.floor(f / 31), ms: { game: f / 10 } });
const passes = Math.floor(frames / 31);
const trace = has("no-trace") ? null : [
  { player: 0, row: 0, fired: passes, continued: 0, failed: 0, firstFired: 2, lastFired: 2 + 31 * (passes - 1), lastFail: null, flags: 4 },
  { player: 0, row: 1, fired: 1, continued: 1, failed: 0, firstFired: 2, lastFired: 2, lastFail: null, flags: 8 },
  { player: 1, row: 2, fired: 0, continued: 0, failed: passes, firstFired: null, lastFired: null, lastFail: { slot: 0, type: 3, frame: 2 + 31 * (passes - 1) }, flags: 0 },
];
const weighed = has("weigh");
const ns = Array.from({ length: frames - 2 }, (_, i) => ((i + 2) % 31 === 2 ? (weighed ? 24_000 : 0) : 0));
const cost = has("no-cost") ? null : { from: 2, ns, records: ns.map((n) => (n || (i => 0)(0)) ? 6 : 0), triggers: ns.map((n) => (n ? 3 : 0)), rows: [
  { row: 0, conditions: passes, actions: passes * 2, triggers: passes, frames: passes, ns: weighed ? 14_000 * passes : 0, peakNs: weighed ? 14_000 : 0, peakNsFrame: 2 },
  { row: 2, conditions: passes, actions: 0, triggers: passes, frames: passes, ns: weighed ? 10_000 * passes : 0, peakNs: weighed ? 10_000 : 0, peakNsFrame: 2 },
], ungroupedRecords: ns.map((n) => (n ? 2 : 0)), ungroupedNs: ns.map((n) => (n ? 1_000 : 0)), byConditionType: [], byActionType: [], limits: weighed ? { smoothMs: 15, mostMs: 36.6 } : null, weighed };
say({ kind: "end", frame: frames, ended: false, reason: null, passes, trace, cost, ms: { load: 1, start: 2, game: frames / 10, total: frames / 8 } });
process.exit(0);
`;

/** A folder shaped like a staged engine: the four files, both runners and current.json; `withMap` false leaves the map runner out, as an older deploy would. */
function stagedEngine(dir: string, withMap = true): { dir: string; build: string } {
  const build = "abcdef123456";
  const sub = join(dir, build);
  mkdirSync(sub, { recursive: true });
  for (const f of ["core.js", "game.js", "base-s1.bin", "interface.bin"]) writeFileSync(join(sub, f), `// ${f}\n`);
  writeFileSync(join(sub, "run-feedface.cjs"), "// the bot runner\n");
  writeFileSync(join(sub, "map-cafe0000.cjs"), FAKE_RUNNER);
  writeFileSync(join(dir, "current.json"), JSON.stringify({ build, files: ["core.js", "game.js", "base-s1.bin", "interface.bin"], runner: "run-feedface.cjs", ...(withMap ? { mapRunner: "map-cafe0000.cjs", mapRunnerBytes: FAKE_RUNNER.length } : {}) }));
  return { dir, build };
}

/** A folder shaped like a 1.16.1 copy of the game. */
function classicCopy(dir: string): string {
  for (const f of ["StarDat.mpq", "BrooDat.mpq"]) writeFileSync(join(dir, f), "mpq");
  return dir;
}

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
