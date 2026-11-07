/**
 * `scmjs map trace <map>` and `scmjs map cost <map>`: the map's triggers run by the game itself with nobody playing.
 * The game is scm-sim's lifted engine, the one the play page runs, fetched and found as `engine.ts` says; its map
 * runner starts the map as a Use Map Settings game, the person's seat idle and the computers as the map has them, and
 * steps it for a number of frames with two taps listening — the trigger trace (every condition asked, every action
 * run, with its answer) folded into one line per copy of a trigger, and the cost count (conditions, actions and
 * triggers passed a frame, by trigger). For the cost, the runner is handed TrigScript's weigher (`weigh.ts`, built
 * beside the command), which says in nanoseconds what Remastered charges for each.
 *
 * The runner speaks JSON lines — start, progress, end — kept here and worded against the map's own triggers, read
 * with the editor's code so a row is shown as the trigger window shows it.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mapVersionOf, parseScenario, serializeScenario, type Scenario } from "../../src/formats/chk/scenario";
import type { OpenedMap } from "../../src/editor/mapFile";
import { writeMapBytes } from "../../src/editor/mapFile";
import { changeMapVersion } from "../../src/editor/settings";
import { readTriggers, triggerNames } from "../../src/editor/triggers";
import { summarizeTrigger } from "../../src/formats/triggers/text";
import { conditionDef } from "../../src/data/triggerDefs";
import { createInterface } from "node:readline";
import { ensureEngine, findGameCopy, runnerFor, startRunner } from "./engine";
import { CliError, columns, dot, duration, mark, num, pc, plural, table } from "./ui";

/* ── The runner's lines (scm-sim's src/exact/runMap.ts) ──────── */

export interface CopyLine { player: number; row: number; fired: number; continued: number; failed: number; firstFired: number | null; lastFired: number | null; lastFail: { slot: number; type: number; frame: number } | null; flags: number }
export interface RowCostLine { row: number; conditions: number; actions: number; triggers: number; frames: number; ns: number; peakNs: number; peakNsFrame: number }
export interface CostSeriesLine { from: number; ns: number[]; records: number[]; triggers: number[]; rows: RowCostLine[]; ungroupedRecords: number[]; ungroupedNs: number[]; byConditionType: number[]; byActionType: number[]; limits: { smoothMs: number; mostMs: number } | null; weighed: boolean }
export interface TraceStartLine { kind: "start"; map: { name: string; width: number; height: number; tileset: string }; copy: string; seed: number; rows: number; copies: number; remastered: boolean; ms: { load: number; start: number } }
export interface TraceProgressLine { kind: "progress"; frame: number; passes: number; ms: { game: number } }
export interface TraceEndLine { kind: "end"; frame: number; ended: boolean; reason: string | null; passes: number; trace: CopyLine[] | null; cost: CostSeriesLine | null; ms: { load: number; start: number; game: number; total: number } }
export type MapRunnerLine = TraceStartLine | TraceProgressLine | TraceEndLine | { kind: "error"; message: string };

export interface MapRunOptions {
  frames?: number;
  every?: number;
  seed?: number;
  starcraft?: string;
  /** The play page's address, or a folder holding the engine. */
  engine?: string;
  /** The weigher's module, instead of the `weigh.mjs` beside the command. */
  weigh?: string;
  /** Each line as it comes, already worded; absent, nothing is printed as it goes. */
  live?: (line: string) => void;
  /** Each progress line as it comes, unworded (the MCP server's progress notifications). */
  onProgress?: (line: TraceProgressLine) => void;
  /** Stops the run when it fires (an MCP client cancelling its request): the runner is killed and the run fails as cancelled. */
  signal?: AbortSignal;
  node?: string;
}

export interface MapRunOutcome {
  engine: { build: string; dir: string; fetched: number };
  game: { folder: string; kind: "remastered" | "classic" };
  start: TraceStartLine | null;
  progress: TraceProgressLine[];
  end: TraceEndLine;
}

/** The weigher's module: named, or `weigh.mjs` beside the command (the build writes it; the source tree has none). */
export function weighModule(named?: string): string {
  if (named) {
    if (!existsSync(named)) throw new CliError(`No file ${named}`, null, 2);
    return resolve(named);
  }
  const beside = fileURLToPath(new URL("./weigh.mjs", import.meta.url));
  if (!existsSync(beside)) throw new CliError("The weigher is not beside the command (weigh.mjs).", "npm run build:cli writes it next to scmjs.mjs; the published package carries it.");
  return beside;
}

/**
 * The file the game is handed: the map itself; a map read from standard input written out, since the runner reads a
 * file; and a map in the original StarCraft 1.00 form, which reaches code the engine has not lifted, as a copy
 * converted to Brood War the way Scenario ▸ Map Properties converts it. Copies go in a temporary folder of their own,
 * which `runMapInGame` deletes once the runner has ended, whether the run succeeded or not (the MCP server runs for
 * hours); the document is not changed.
 */
export async function gameMap(doc: OpenedMap, inputPath: string, inputName = inputPath): Promise<{ path: string; converted: boolean }> {
  const converted = mapVersionOf(doc.scenario.fileVersion) === "original";
  if (!converted && inputPath !== "-") return { path: inputPath, converted: false };
  const copy = parseScenario(serializeScenario(doc.scenario));
  if (converted) changeMapVersion(copy, "broodwar");
  const path = join(mkdtempSync(join(tmpdir(), "scmjs-game-")), inputName.replace(/^.*[\\/]/, "").replace(/\.(scm|scx|chk)$/i, "") + ".scx");
  temporary.add(path);
  try { writeFileSync(path, await writeMapBytes(copy, { format: "scx", extras: doc.extras, stored: doc.stored ?? null })); } catch (e) { removeGameMap(path); throw e; }
  return { path, converted };
}

/** The copies `gameMap` wrote, until the run they were for has ended. */
const temporary = new Set<string>();

/** A copy `gameMap` wrote, deleted with its folder; anything else is left alone. */
export function removeGameMap(path: string): void {
  if (!temporary.delete(path)) return;
  try { rmSync(dirname(path), { recursive: true, force: true }); } catch { /* the temporary folder is the system's to clear */ }
}

/** The start line as the terminal's. */
export function wordStart(l: TraceStartLine): string {
  return `${pc.bold(l.map.name)} ${pc.dim(`${l.map.width} × ${l.map.height}, ${l.map.tileset}`)}${dot}${plural(l.rows, "trigger")}${l.copies !== l.rows ? pc.dim(` (${plural(l.copies, "copy", "copies")} in the game)`) : ""}${dot}seed ${l.seed}${dot}${l.copy === "remastered" ? "Remastered" : "1.16.1"} files`;
}

/**
 * Runs the map in the game and keeps what the runner said. `what` is which tap the runner is asked for: the trace,
 * or the cost (with the weigher). The engine is fetched when it is not cached.
 */
export async function runMapInGame(map: string, what: "trace" | "cost", o: MapRunOptions = {}): Promise<MapRunOutcome> {
  try { return await runMap(map, what, o); } finally { removeGameMap(map); }
}

const cancelled = () => new CliError("The run was cancelled: the game was stopped before it finished.", null);

async function runMap(map: string, what: "trace" | "cost", o: MapRunOptions): Promise<MapRunOutcome> {
  if (!existsSync(map)) throw new CliError(`No file ${map}`, null, 2);
  const weigh = what === "cost" ? weighModule(o.weigh) : null;
  const game = findGameCopy(o.starcraft);
  const engine = await ensureEngine(o.engine, undefined, o.live ?? (() => {}));
  const runner = runnerFor(engine, "map");
  const args = [resolve(map), "--engine", engine.dir, "--starcraft", game.folder];
  if (o.frames !== undefined) args.push("--frames", String(o.frames));
  if (o.every !== undefined) args.push("--every", String(o.every));
  if (o.seed !== undefined) args.push("--seed", String(o.seed));
  if (what === "trace") args.push("--no-cost");
  else args.push("--no-trace", "--weigh", weigh!);
  let start: TraceStartLine | null = null, end: TraceEndLine | null = null;
  const progress: TraceProgressLine[] = [];
  let error: string | null = null;
  if (o.signal?.aborted) throw cancelled();
  const child = startRunner(runner, args, { node: o.node });
  // Listened for from the start, so a runner that ends at once (or is killed) is not missed.
  const exited = new Promise<number>((done) => { child.on("error", () => done(2)); child.on("close", (c) => done(c ?? 2)); });
  const stop = () => { child.kill(); };
  o.signal?.addEventListener("abort", stop, { once: true });
  let stderr = "";
  child.stderr!.on("data", (d) => { stderr += d; });
  try {
    for await (const raw of createInterface({ input: child.stdout! })) {
      let l: MapRunnerLine;
      try { l = JSON.parse(raw) as MapRunnerLine; } catch { continue; }
      if (l.kind === "start") { start = l; o.live?.(wordStart(l)); }
      else if (l.kind === "progress") { progress.push(l); o.onProgress?.(l); o.live?.(`  ${pc.dim(`frame ${String(l.frame).padStart(6)}  ${plural(l.passes, "pass", "passes")} of the triggers`)}`); }
      else if (l.kind === "end") end = l;
      else if (l.kind === "error") error = l.message;
    }
  } finally { o.signal?.removeEventListener("abort", stop); }
  const exitCode = await exited;
  if (o.signal?.aborted) throw cancelled();
  if (error) throw new CliError(error, "The runner is scm-sim's; a map StarCraft itself opens, with a slot for a person, and your own copy of the game are what it needs.");
  if (!end) throw new CliError(`The game did not finish: the runner stopped without a result (exit ${exitCode}).${stderr.trim() ? `\n${stderr.trim().split("\n").slice(-6).join("\n")}` : ""}`);
  return { engine: { build: engine.build, dir: engine.dir, fetched: engine.fetched }, game, start, progress, end };
}

/* ── The report, against the map's own triggers ──────────── */

/** One map row over the run: its copies' lines added up. */
export interface RowSummary {
  row: number;
  /** The players whose lists held a copy (0–7). */
  players: number[];
  fired: number;
  continued: number;
  failed: number;
  firstFired: number | null;
  lastFired: number | null;
  lastFail: CopyLine["lastFail"];
  /** Every copy is done for good (ran once, not preserved). */
  done: boolean;
}

export function summarizeRows(lines: readonly CopyLine[], rows: number): RowSummary[] {
  const out: RowSummary[] = Array.from({ length: rows }, (_, row) => ({ row, players: [], fired: 0, continued: 0, failed: 0, firstFired: null, lastFired: null, lastFail: null, done: false }));
  const copies = new Map<number, number>();
  for (const l of lines) {
    const s = out[l.row];
    if (!s) continue;
    if (!s.players.includes(l.player)) s.players.push(l.player);
    copies.set(l.row, (copies.get(l.row) ?? 0) + 1);
    s.fired += l.fired; s.continued += l.continued; s.failed += l.failed;
    if (l.firstFired !== null && (s.firstFired === null || l.firstFired < s.firstFired)) s.firstFired = l.firstFired;
    if (l.lastFired !== null && (s.lastFired === null || l.lastFired > s.lastFired)) s.lastFired = l.lastFired;
    if (l.lastFail && (!s.lastFail || l.lastFail.frame > s.lastFail.frame)) s.lastFail = l.lastFail;
  }
  for (const s of out) {
    s.players.sort((a, b) => a - b);
    s.done = (copies.get(s.row) ?? 0) > 0 && lines.every((l) => l.row !== s.row || (l.flags & 8) !== 0);
  }
  return out;
}

const players = (slots: number[]) => (slots.length ? slots.map((p) => `P${p + 1}`).join(" ") : pc.dim("nobody"));
const frame = (f: number | null) => (f === null ? pc.dim("–") : num(f));
/** A frame as time on Fastest, `m:ss`. */
const clock = (frames: number) => duration((frames * 1000) / 24);

/** The trigger window's one line for a row: conditions → actions, cut to `width` columns. */
export function rowText(scn: Scenario, row: number, width = 80): string {
  const t = readTriggers(scn)[row];
  if (!t) return pc.dim("(not in the map)");
  const s = summarizeTrigger(t, triggerNames(scn));
  const text = `${s.conditions || pc.dim("(no conditions)")} ${pc.dim("→")} ${s.actions || pc.dim("(no actions)")}`.replace(/\s+/g, " ");
  return cut(text, width);
}

/** Text cut to `width` terminal columns, colour codes kept whole. */
function cut(text: string, width: number): string {
  if (columns(text) <= width) return text;
  let out = "", n = 0;
  // eslint-disable-next-line no-control-regex -- the terminal's colour codes
  for (const part of text.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith("\x1b")) { out += part; continue; }
    for (const ch of part) { const w = columns(ch); if (n + w > width - 1) return `${out}…`; out += ch; n += w; }
  }
  return out;
}

export interface TraceReport { file: string; rows: RowSummary[]; passes: number; frame: number; ended: boolean; reason: string | null }

/** The trace as data: one summary per map row. */
export function traceReport(file: string, scn: Scenario, r: MapRunOutcome): TraceReport {
  const rows = readTriggers(scn).length;
  return { file, rows: summarizeRows(r.end.trace ?? [], rows), passes: r.end.passes, frame: r.end.frame, ended: r.end.ended, reason: r.end.reason };
}

/** `map trace --json`: the report, with where the engine and the game came from, every copy's line and the run's times. */
export function traceJson(file: string, scn: Scenario, r: MapRunOutcome) {
  return { ...traceReport(file, scn, r), engine: r.engine, game: r.game, copies: r.end.trace, ms: r.end.ms };
}

/** The trace's lines: the run in one, a table of the triggers, then the ones that never fired and why. */
export function printTrace(file: string, scn: Scenario, r: MapRunOutcome, { all = false, width = process.stdout.columns || 100 } = {}): string[] {
  const rep = traceReport(file, scn, r);
  const never = rep.rows.filter((s) => s.fired === 0);
  const fired = rep.rows.length - never.length;
  const out = [`${mark.ok} ${pc.bold(file)}: ${plural(rep.rows.length, "trigger")}${dot}${num(rep.frame)} frames ${pc.dim(`(${clock(rep.frame)} of play)`)}${rep.ended ? pc.dim(`, the game ended: ${rep.reason ?? "over"}`) : ""}${dot}${plural(rep.passes, "pass", "passes")}${dot}${pc.green(`${fired} fired`)}${never.length ? `${dot}${pc.yellow(`${never.length} never`)}` : ""}${dot}${(r.end.ms.total / 1000).toFixed(1)} s`];
  if (!rep.rows.length) return out;
  const limit = all ? Infinity : 40;
  const shown = rep.rows.slice(0, limit);
  const head = ["#", "Fired", "First", "Last", "Players", "Trigger"].map((h) => pc.dim(h));
  const fixed = shown.reduce((n, s) => Math.max(n, columns(`${s.row + 1}  ${num(s.fired)}  ${frame(s.firstFired)}  ${frame(s.lastFired)}  ${players(s.players)}  `)), 0) + 2;
  out.push("", ...table([head, ...shown.map((s) => [
    pc.dim(String(s.row + 1)), s.fired ? num(s.fired) + (s.continued ? pc.dim(` +${s.continued}`) : "") : pc.yellow("0"), frame(s.firstFired), frame(s.lastFired), players(s.players), rowText(scn, s.row, Math.max(30, width - fixed - 2)),
  ])], 2));
  if (rep.rows.length > shown.length) out.push(pc.dim(`  … and ${num(rep.rows.length - shown.length)} more (--all lists them)`));
  if (never.length) {
    out.push("", pc.dim(`  Never fired (${never.length} of ${rep.rows.length})`));
    for (const s of never.slice(0, all ? Infinity : 20)) {
      const why = !s.players.length ? "no player in the game owns it" : s.lastFail ? `${conditionDef(s.lastFail.type)?.name ?? `condition ${s.lastFail.type}`} (condition ${s.lastFail.slot + 1}) said no last, at frame ${num(s.lastFail.frame)}` : s.failed ? "its conditions said no" : "it was never asked";
      out.push(`  ${pc.yellow("▸")} ${pc.dim(`#${s.row + 1}`)}  ${rowText(scn, s.row, Math.max(30, width - 10))}`, `      ${pc.dim(why)}`);
    }
    if (never.length > 20 && !all) out.push(pc.dim(`  … and ${num(never.length - 20)} more (--all lists them)`));
  }
  return out;
}

export interface CostReport {
  file: string;
  frames: number;
  /** Frames in which the triggers ran anything. */
  ranIn: number;
  /** Milliseconds a frame on average where anything ran, and the most in one frame. */
  averageMs: number;
  peakMs: number;
  peakFrame: number;
  peakRecords: number;
  peakTriggers: number;
  limits: CostSeriesLine["limits"];
  /** Records in no trigger of the map (a program's own, run through the EUD trigger chain), and what they cost in all. */
  ungrouped: { records: number; ms: number };
  /** By trigger, costliest first: milliseconds a frame it ran in. */
  rows: { row: number; msAFrame: number; frames: number; records: number; triggers: number; peakMs: number }[];
}

export function costReport(file: string, r: MapRunOutcome): CostReport {
  const c = r.end.cost;
  if (!c) throw new CliError("The runner counted no cost.");
  const ran = c.ns.map((n, i) => [n, i] as const).filter(([n]) => n > 0);
  const peak = ran.reduce((best, x) => (x[0] > best[0] ? x : best), [0, -1] as readonly [number, number]);
  const rows = c.rows.map((x) => ({ row: x.row, msAFrame: x.ns / 1e6 / Math.max(1, x.frames), frames: x.frames, records: x.conditions + x.actions, triggers: x.triggers, peakMs: x.peakNs / 1e6 })).sort((a, b) => b.msAFrame - a.msAFrame || b.records - a.records);
  return {
    file, frames: c.ns.length, ranIn: ran.length,
    averageMs: ran.length ? ran.reduce((n, [x]) => n + x, 0) / 1e6 / ran.length : 0,
    peakMs: peak[0] / 1e6, peakFrame: peak[1] >= 0 ? peak[1] + c.from : -1, peakRecords: peak[1] >= 0 ? c.records[peak[1]] : 0, peakTriggers: peak[1] >= 0 ? c.triggers[peak[1]] : 0,
    limits: c.limits, ungrouped: { records: c.ungroupedRecords.reduce((n, x) => n + x, 0), ms: c.ungroupedNs.reduce((n, x) => n + x, 0) / 1e6 }, rows,
  };
}

/** `map cost --json`: the report, with where the engine and the game came from, the frame-by-frame series and the run's times. */
export function costJson(file: string, r: MapRunOutcome) {
  return { ...costReport(file, r), engine: r.engine, game: r.game, series: r.end.cost, ms: r.end.ms };
}

/** Milliseconds, with the digits a small number needs (a trigger of three records is a hundredth of a microsecond). */
const ms = (x: number) => `${x > 0 && x < 0.001 ? x.toFixed(5) : x > 0 && x < 0.1 ? x.toFixed(3) : x.toFixed(2)} ms`;

/** The cost's lines: what a frame costs against what Remastered can carry, then the costliest triggers. */
export function printCost(file: string, scn: Scenario, r: MapRunOutcome, { all = false, width = process.stdout.columns || 100 } = {}): string[] {
  const rep = costReport(file, r);
  if (!rep.ranIn) return [`${mark.ok} ${pc.bold(file)}: the triggers ran nothing in ${num(rep.frames)} frames`];
  const over = rep.limits && rep.peakMs > rep.limits.mostMs ? mark.error : rep.limits && rep.peakMs > rep.limits.smoothMs ? mark.warn : mark.ok;
  const out = [
    `${over} ${pc.bold(file)}: triggers cost ${pc.bold(ms(rep.averageMs))} a frame on average where they ran ${pc.dim(`(${num(rep.ranIn)} of ${num(rep.frames)} frames)`)}, ${pc.bold(ms(rep.peakMs))} at the most ${pc.dim(`(frame ${num(rep.peakFrame)}: ${plural(rep.peakRecords, "record")}, ${plural(rep.peakTriggers, "trigger")})`)}`,
  ];
  if (rep.limits) out.push(`  ${pc.dim(`Remastered on a fast computer: smooth to about ${rep.limits.smoothMs} ms of triggers a frame, slows past ${rep.limits.mostMs.toFixed(0)} ms`)}`);
  if (rep.ungrouped.records) out.push(`  ${pc.dim(`${num(rep.ungrouped.records)} of the records ran in no trigger of the map — a program's own (TrigScript, eudplib), ${ms(rep.ungrouped.ms)} in all`)}`);
  const shown = rep.rows.slice(0, all ? Infinity : 12);
  if (shown.length) {
    const head = ["#", "ms a frame", "Frames", "Records", "Trigger"].map((h) => pc.dim(h));
    const fixed = shown.reduce((n, x) => Math.max(n, columns(`${x.row + 1}  ${ms(x.msAFrame)}  ${num(x.frames)}  ${num(x.records)}  `)), 0) + 2;
    out.push("", pc.dim("  Costliest triggers, a frame they ran in"), ...table([head, ...shown.map((x) => [pc.dim(String(x.row + 1)), ms(x.msAFrame), num(x.frames), num(x.records), rowText(scn, x.row, Math.max(30, width - fixed - 2))])], 2));
    if (rep.rows.length > shown.length) out.push(pc.dim(`  … and ${num(rep.rows.length - shown.length)} more (--all lists them)`));
  }
  return out;
}
