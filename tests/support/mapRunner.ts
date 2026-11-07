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

/** A folder shaped like a staged engine: the four files, both runners and current.json; `withMap` false leaves the map runner out, as an older deploy would. */
export function stagedEngine(dir: string, withMap = true): { dir: string; build: string } {
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
export function classicCopy(dir: string): string {
  for (const f of ["StarDat.mpq", "BrooDat.mpq"]) writeFileSync(join(dir, f), "mpq");
  return dir;
}
