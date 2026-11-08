/**
 * A stand-in for scm-sim's map runner (`src/exact/runMap.ts`) and the folders it needs, for the tests of `scmjs map
 * trace|cost` and of the MCP server's game tools: the real runner needs the lifted game and a copy of StarCraft, which
 * CI has not got.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A runner that prints what scm-sim's does, from its arguments: a start, progress lines and an end whose trace is three
 * copies for ums.scx's three triggers (row 0 fired every pass, row 1 fired once and done, row 2 failed on its Bring
 * condition), and whose cost weighs when --weigh names a file. A map named `bad.scx` is refused; one named `slow.scx`
 * starts, writes the runner's process id beside the map (`slow.scx.pid`) and then waits to be killed, for a run to cancel.
 *
 * With `--play <replay>` (the map then optional), a replay's game as `src/exact/mapReplay.ts` reports one: a start with
 * `mode: "replay"`, two players (Ann, Bo), 1,000 frames unless `--frames`, a Use Map Settings game unless the replay's
 * name starts with "melee"; an end with `by`, the outcomes, the check (parted at frame 500 for `parted.rep`) and, with
 * `--order`, the firings in order. `OLD_RUNNER` is the same runner from before `--play`, which ignores it.
 */
export const FAKE_RUNNER = `
const fs = require("node:fs");
const args = process.argv.slice(2);
const has = (n) => args.includes("--" + n);
const flag = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (!fs.existsSync(flag("engine") + "/core.js")) { say({ kind: "error", message: "no engine at " + flag("engine") }); process.exit(2); }
if (has("weigh") && !fs.existsSync(flag("weigh"))) { say({ kind: "error", message: "no weigh module at " + flag("weigh") }); process.exit(2); }
const play = flag("play");
const mapArg = args[0] && !args[0].startsWith("--") ? args[0] : null;
if (!mapArg && !play) { say({ kind: "error", message: "--map is needed" }); process.exit(2); }
const name = require("node:path").basename(mapArg ?? play);
if (name === "bad.scx") { say({ kind: "error", message: "the game did not take this map" }); process.exit(2); }
const frames = Number(flag("frames") ?? (play ? 1000 : 2400)), every = Number(flag("every") ?? 600), seed = Number(flag("seed") ?? 1);
const replay = play ? { name: require("node:path").basename(play), frames: 1000, gameType: require("node:path").basename(play).startsWith("melee") ? 2 : 10, players: [{ slot: 0, name: "Ann", race: "terran", type: 2 }, { slot: 1, name: "Bo", race: "zerg", type: 2 }] } : null;
say({ kind: "start", ...(play ? { mode: "replay" } : {}), map: { name, width: 64, height: 64, tileset: "badlands" }, copy: "classic", seed: play ? 77 : seed, rows: 3, copies: 3, remastered: false, ...(play ? { replay, replaced: !!mapArg } : {}), ms: { load: 1, start: 2 } });
if (name === "slow.scx") { fs.writeFileSync(mapArg + ".pid", String(process.pid)); setInterval(() => {}, 1000); return; }
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
const parted = play && require("node:path").basename(play) === "parted.rep";
const order = [[2, 0, 1]];
for (let k = 0; k < passes; k++) order.push([2 + 31 * k, 0, 0]);
order.sort((a, b) => a[0] - b[0]);
const replayEnd = play ? { by: frames >= 1000 ? "victory" : null, order: has("order") ? order : null, orderDropped: 0, check: { named: 10, gone: 0, ahead: parted ? 1 : 0, parted: parted ? 500 : null }, outcomes: frames >= 1000 ? ["victory", "defeat"] : [null, null] } : {};
say({ kind: "end", ...(play ? { mode: "replay" } : {}), frame: frames, ended: !!play && frames >= 1000, reason: null, passes, trace, cost, ...replayEnd, ms: { load: 1, start: 2, game: frames / 10, total: frames / 8 } });
process.exit(0);
`;

/** The trace's stand-in as it was before `--play`: it ignores the flag, and wants a map. */
export const OLD_RUNNER = FAKE_RUNNER.replace('const play = flag("play");', "const play = undefined;");

/**
 * A stand-in for the map runner's test mode (`runMap.ts --test <spec> --replay <file>`, scm-sim's `src/exact/mapTest.ts`):
 * a start with `mode: "test"`, then an end that is the JSON file `SCMJS_TEST_ANSWER` names (frame, ended, trace,
 * observed), or an empty game of the spec's frames; the spec it was handed is appended as a line to `SCMJS_TEST_SPECS`
 * when that is set, and a replay of a few bytes is written where `--replay` says. A map named `bad.scx` is refused.
 * With `--play <replay>` the start and end say `driver: "replay"`, the start names the replay's players (Ann in slot
 * 1, Bo in slot 2) and the end carries the answer's `check` (or one that kept to the replay); `OLD_TEST_RUNNER` is
 * the same runner from before `--play`, which ignores it.
 */
export const FAKE_TEST_RUNNER = `
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (!fs.existsSync(flag("engine") + "/core.js")) { say({ kind: "error", message: "no engine at " + flag("engine") }); process.exit(2); }
if (path.basename(args[0]) === "bad.scx") { say({ kind: "error", message: "the game did not take this map" }); process.exit(2); }
const spec = JSON.parse(fs.readFileSync(flag("test"), "utf8"));
const play = flag("play");
if (process.env.SCMJS_TEST_SPECS) fs.appendFileSync(process.env.SCMJS_TEST_SPECS, JSON.stringify({ map: path.basename(args[0]), seed: Number(flag("seed")), spec, bytes: fs.statSync(args[0]).size, ...(play ? { play } : {}) }) + "\\n");
const driven = play ? { driver: "replay", replay: { name: path.basename(play), frames: 1000, gameType: 10, players: [{ slot: 0, name: "Ann", race: "terran", type: 2 }, { slot: 1, name: "Bo", race: "zerg", type: 2 }] } } : {};
say({ kind: "start", mode: "test", ...driven, map: { name: path.basename(args[0]), width: 64, height: 64, tileset: "badlands" }, copy: "classic", seed: Number(flag("seed") ?? 1), rows: 3, copies: 3, remastered: false, localPlayer: 0, ms: { load: 1, start: 2 } });
const answer = process.env.SCMJS_TEST_ANSWER ? JSON.parse(fs.readFileSync(process.env.SCMJS_TEST_ANSWER, "utf8")) : {};
const observed = { switches: [], deaths: [], resources: Array.from({ length: 12 }, () => [0, 0]), counts: spec.counts.map(() => 0), texts: [], outcomes: Array(8).fill(null), steps: spec.steps.map((s) => ({ frame: s.frame, kind: s.kind })), ...answer.observed };
if (flag("replay")) fs.writeFileSync(flag("replay"), "a replay");
say({ kind: "end", mode: "test", ...(play ? { driver: "replay", check: answer.check ?? { named: 0, gone: 0, ahead: 0, parted: null }, by: "replay" } : {}), frame: answer.frame ?? spec.frames, ended: answer.ended ?? false, reason: null, passes: 3, trace: answer.trace ?? [], observed, replay: flag("replay") ?? null, ms: { load: 1, start: 2, game: 3, total: 6 } });
process.exit(0);
`;

/** The test runner's stand-in as it was before `--play`: it ignores the flag and runs the scenario with nobody playing. */
export const OLD_TEST_RUNNER = FAKE_TEST_RUNNER.replace('const play = flag("play");', "const play = undefined;");

/**
 * A folder shaped like a staged engine: the four files, both runners and current.json; `withMap` false leaves the map
 * runner out, as an older deploy would. `mapRunner` is the map runner's text: the trace's stand-in by default (which is
 * also a runner from before map test), or `FAKE_TEST_RUNNER`.
 */
export function stagedEngine(dir: string, withMap = true, mapRunner = FAKE_RUNNER): { dir: string; build: string } {
  const build = "abcdef123456";
  const sub = join(dir, build);
  mkdirSync(sub, { recursive: true });
  for (const f of ["core.js", "game.js", "base-s1.bin", "interface.bin"]) writeFileSync(join(sub, f), `// ${f}\n`);
  writeFileSync(join(sub, "run-feedface.cjs"), "// the bot runner\n");
  writeFileSync(join(sub, "map-cafe0000.cjs"), mapRunner);
  writeFileSync(join(dir, "current.json"), JSON.stringify({ build, files: ["core.js", "game.js", "base-s1.bin", "interface.bin"], runner: "run-feedface.cjs", ...(withMap ? { mapRunner: "map-cafe0000.cjs", mapRunnerBytes: mapRunner.length } : {}) }));
  return { dir, build };
}

/** A folder shaped like a 1.16.1 copy of the game. */
export function classicCopy(dir: string): string {
  for (const f of ["StarDat.mpq", "BrooDat.mpq"]) writeFileSync(join(dir, f), "mpq");
  return dir;
}
