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
 */
export const FAKE_RUNNER = `
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
if (require("node:path").basename(args[0]) === "slow.scx") { fs.writeFileSync(args[0] + ".pid", String(process.pid)); setInterval(() => {}, 1000); return; }
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

/**
 * A stand-in for the map runner's test mode (`runMap.ts --test <spec> --replay <file>`, scm-sim's `src/exact/mapTest.ts`):
 * a start with `mode: "test"`, then an end that is the JSON file `SCMJS_TEST_ANSWER` names (frame, ended, trace,
 * observed), or an empty game of the spec's frames; the spec it was handed is appended as a line to `SCMJS_TEST_SPECS`
 * when that is set, and a replay of a few bytes is written where `--replay` says. A map named `bad.scx` is refused.
 */
export const FAKE_TEST_RUNNER = `
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (!fs.existsSync(flag("engine") + "/core.js")) { say({ kind: "error", message: "no engine at " + flag("engine") }); process.exit(2); }
if (path.basename(args[0]) === "bad.scx") { say({ kind: "error", message: "the game did not take this map" }); process.exit(2); }
const spec = JSON.parse(fs.readFileSync(flag("test"), "utf8"));
if (process.env.SCMJS_TEST_SPECS) fs.appendFileSync(process.env.SCMJS_TEST_SPECS, JSON.stringify({ map: path.basename(args[0]), seed: Number(flag("seed")), spec, bytes: fs.statSync(args[0]).size }) + "\\n");
say({ kind: "start", mode: "test", map: { name: path.basename(args[0]), width: 64, height: 64, tileset: "badlands" }, copy: "classic", seed: Number(flag("seed") ?? 1), rows: 3, copies: 3, remastered: false, localPlayer: 0, ms: { load: 1, start: 2 } });
const answer = process.env.SCMJS_TEST_ANSWER ? JSON.parse(fs.readFileSync(process.env.SCMJS_TEST_ANSWER, "utf8")) : {};
const observed = { switches: [], deaths: [], resources: Array.from({ length: 12 }, () => [0, 0]), counts: spec.counts.map(() => 0), texts: [], outcomes: Array(8).fill(null), steps: spec.steps.map((s) => ({ frame: s.frame, kind: s.kind })), ...answer.observed };
if (flag("replay")) fs.writeFileSync(flag("replay"), "a replay");
say({ kind: "end", mode: "test", frame: answer.frame ?? spec.frames, ended: answer.ended ?? false, reason: null, passes: 3, trace: answer.trace ?? [], observed, replay: flag("replay") ?? null, ms: { load: 1, start: 2, game: 3, total: 6 } });
process.exit(0);
`;

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
