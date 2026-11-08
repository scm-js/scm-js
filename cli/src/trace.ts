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
import { openMapBytes, readArchive, writeMapBytes } from "../../src/editor/mapFile";
import { changeMapVersion } from "../../src/editor/settings";
import { readTriggers, triggerNames } from "../../src/editor/triggers";
import { summarizeTrigger } from "../../src/formats/triggers/text";
import { conditionDef } from "../../src/data/triggerDefs";
import { createInterface } from "node:readline";
import { FRAME_MS, type Replay } from "@scm-js/replay";
import { cacheRoot, ensureEngine, findGameCopy, runnerFor, startRunner, type Engine, modArgs, modWords, type RunnerModReport } from "./engine";
import { VERSION } from "./about";
import { assetFile, INSTALL } from "./runtime";
import { diffMaps, summarizeDiff } from "./diff";
import { GAME_TYPES } from "./replay";
import { t, translate } from "./i18n";
import { CliError, columns, dot, duration, mark, num, pc, table } from "./ui";

/* ── The runner's lines (scm-sim's src/exact/runMap.ts) ──────── */

/** A player of a replay, as the runner's start line names them. */
export interface ReplayPlayerLine { slot: number; name: string; race: string; type: number }
/** The replay's commands held against the game (scm-sim's `watch.ts`): `parted` is the first frame they were not the game played. */
export interface ReplayCheck { named: number; gone: number; ahead: number; parted: number | null }
export type Outcome = "victory" | "defeat" | "draw" | null;

export interface CopyLine { player: number; row: number; fired: number; continued: number; failed: number; firstFired: number | null; lastFired: number | null; lastFail: { slot: number; type: number; frame: number } | null; flags: number }
export interface RowCostLine { row: number; conditions: number; actions: number; triggers: number; frames: number; ns: number; peakNs: number; peakNsFrame: number }
export interface CostSeriesLine { from: number; ns: number[]; records: number[]; triggers: number[]; rows: RowCostLine[]; ungroupedRecords: number[]; ungroupedNs: number[]; byConditionType: number[]; byActionType: number[]; limits: { smoothMs: number; mostMs: number } | null; weighed: boolean }
export interface TraceStartLine {
  kind: "start";
  /** "replay" when the runner played a replay (`--play`); absent from a run with nobody playing, and from a runner older than replays. */
  mode?: "replay";
  map: { name: string; width: number; height: number; tileset: string };
  copy: string; seed: number; rows: number; copies: number; remastered: boolean;
  /** With a replay: its length and players, and whether a map file was played in place of its own. */
  replay?: { name: string; frames: number; gameType: number; players: ReplayPlayerLine[] };
  replaced?: boolean;
  /** With `--mod`: what the game read of the mod, and the startup data read again. */
  mod?: RunnerModReport;
  ms: { load: number; start: number };
}
export interface TraceProgressLine { kind: "progress"; frame: number; passes: number; ms: { game: number } }
export interface TraceEndLine {
  kind: "end"; frame: number; ended: boolean; reason: string | null; passes: number; trace: CopyLine[] | null; cost: CostSeriesLine | null;
  /** With a replay: how it ended ("victory": a side won, "replay": the replay ran out), the firings in order (frame, player 0–7, row) when asked for, and the check. */
  by?: "victory" | "replay" | null;
  order?: [number, number, number][] | null;
  orderDropped?: number;
  check?: ReplayCheck;
  /** Per replay player, in the start line's order. */
  outcomes?: Outcome[];
  ms: { load: number; start: number; game: number; total: number };
}
export type MapRunnerLine = TraceStartLine | TraceProgressLine | TraceEndLine | { kind: "error"; message: string };

export interface MapRunOptions {
  frames?: number;
  every?: number;
  seed?: number;
  starcraft?: string;
  /** The play page's address, or a folder holding the engine. */
  engine?: string;
  /** An engine already found, for several games in a row (`map coverage`): the page is asked once, not each game. */
  ready?: Engine;
  /** The weigher's module, instead of the `weigh.mjs` beside the command. */
  weigh?: string;
  /** A replay whose commands are the game (the runner's `--play`); the map given is then played in place of its own, or none is given. */
  replay?: string;
  /** Keep each firing in the order the game ran them (`--order`). */
  order?: boolean;
  /** Each line as it comes, already worded; absent, nothing is printed as it goes. */
  live?: (line: string) => void;
  /** Each progress line as it comes, unworded (the MCP server's progress notifications). */
  onProgress?: (line: TraceProgressLine) => void;
  /** Stops the run when it fires (an MCP client cancelling its request): the runner is killed and the run fails as cancelled. */
  signal?: AbortSignal;
  node?: string;
  /** A mod laid over the game: `folder` writes its files in the game's paths and says where (asked once the engine is known to take one). */
  mod?: { layers: () => Promise<string[]>; report?: (m: RunnerModReport) => RunnerModReport };
}

export interface MapRunOutcome {
  engine: { build: string; dir: string; fetched: number };
  game: { folder: string; kind: "remastered" | "classic" };
  start: TraceStartLine | null;
  progress: TraceProgressLine[];
  end: TraceEndLine;
}

/**
 * The weigher's module: named, or `weigh.mjs` beside the command (the build writes it; the source tree has none), or,
 * in the single executable, the copy it carries written out to the cache folder.
 */
export function weighModule(named?: string): string {
  if (named) {
    if (!existsSync(named)) throw new CliError(t("No file {file}", { file: named }), null, 2);
    return resolve(named);
  }
  if (INSTALL === "binary") {
    const file = assetFile("weigh.mjs", join(cacheRoot(), "weigh"), VERSION);
    if (!file) throw new CliError(t("This scmjs carries no weigher (weigh.mjs)."), t("scripts/build-cli-binary.mjs puts it inside the executable."));
    return file;
  }
  const beside = fileURLToPath(new URL("./weigh.mjs", import.meta.url));
  if (!existsSync(beside)) throw new CliError(t("The weigher is not beside the command (weigh.mjs)."), t("npm run build:cli writes it next to scmjs.mjs; the published package carries it."));
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

/** A frame as the game's clock on Fastest, `m:ss`: 42 ms a frame, as `replay info` and `replay watch` count it. */
export const gameClock = (frame: number) => duration(frame * FRAME_MS);

/** The start line as the terminal's. */
export function wordStart(l: TraceStartLine): string {
  const files = l.copy === "remastered" ? t("Remastered files") : t("1.16.1 files");
  const triggers = t("{n, plural, one {# trigger} other {# triggers}}", { n: l.rows });
  const copies = l.copies !== l.rows ? pc.dim(` ${t("({n, plural, one {# copy} other {# copies}} in the game)", { n: l.copies })}`) : "";
  if (l.mode === "replay" && l.replay) {
    const r = l.replay;
    return `${pc.bold(r.name)} ${pc.dim(`${l.map.width} × ${l.map.height}, ${translate(l.map.tileset)}`)}${l.replaced ? `${dot}${t("played on {map}", { map: l.map.name })}` : ""}${dot}${t("{n, plural, one {# player} other {# players}}", { n: r.players.length })}${dot}${gameClock(r.frames)}${dot}${triggers}${copies}${dot}${files}`;
  }
  return `${pc.bold(l.map.name)} ${pc.dim(`${l.map.width} × ${l.map.height}, ${translate(l.map.tileset)}`)}${dot}${triggers}${copies}${dot}${t("seed {seed}", { seed: l.seed })}${dot}${files}`;
}

/**
 * Runs the map in the game and keeps what the runner said. `what` is which tap the runner is asked for: the trace,
 * or the cost (with the weigher). The engine is fetched when it is not cached.
 */
export async function runMapInGame(map: string | null, what: "trace" | "cost", o: MapRunOptions = {}): Promise<MapRunOutcome> {
  try { return await runMap(map, what, o); } finally { if (map) removeGameMap(map); }
}

const cancelled = () => new CliError(t("The run was cancelled: the game was stopped before it finished."), null);

/** Said when the runner is older than the replays: it wanted a map, or ran the map with nobody playing. */
const olderThanReplays = (dir: string) => new CliError(t("The engine at {dir} has a map runner from before map trace --replay.", { dir }), t("A play page deployed since has one; the next run fetches it (or name a newer one with --engine)."));

async function runMap(map: string | null, what: "trace" | "cost", o: MapRunOptions): Promise<MapRunOutcome> {
  if (map !== null && !existsSync(map)) throw new CliError(t("No file {file}", { file: map }), null, 2);
  if (map === null && !o.replay) throw new CliError(t("No map to run: name one, or a replay with --replay."), null, 2);
  if (o.replay && !existsSync(o.replay)) throw new CliError(t("No file {file}", { file: o.replay }), null, 2);
  const weigh = what === "cost" ? weighModule(o.weigh) : null;
  const game = findGameCopy(o.starcraft);
  const engine = o.ready ?? await ensureEngine(o.engine, undefined, o.live ?? (() => {}));
  const runner = runnerFor(engine, "map");
  const modFlag = o.mod ? (modArgs(engine, "?"), modArgs(engine, await o.mod.layers())) : [];
  const args = [...(map !== null ? [resolve(map)] : []), ...modFlag, "--engine", engine.dir, "--starcraft", game.folder];
  if (o.replay) args.push("--play", resolve(o.replay));
  if (o.order) args.push("--order");
  if (o.frames !== undefined) args.push("--frames", String(o.frames));
  if (o.every !== undefined) args.push("--every", String(o.every));
  if (o.seed !== undefined) args.push("--seed", String(o.seed));
  if (what === "trace") args.push("--no-cost");
  else args.push("--no-trace", "--weigh", weigh!);
  let start: TraceStartLine | null = null, end: TraceEndLine | null = null;
  const progress: TraceProgressLine[] = [];
  let error: string | null = null, older = false;
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
      if (l.kind === "start") {
        // A runner from before `--play` ran the map with nobody playing: its start has no mode.
        if (o.replay && l.mode !== "replay") { older = true; child.kill(); break; }
        if (l.mod && o.mod?.report) l.mod = o.mod.report(l.mod);
        start = l; o.live?.(wordStart(l));
        if (l.mod) o.live?.(modWords(l.mod));
      }
      else if (l.kind === "progress") { progress.push(l); o.onProgress?.(l); o.live?.(`  ${pc.dim(`${start?.mode === "replay" ? `${gameClock(l.frame).padStart(5)}  ` : ""}${t("frame {frame}  {n, plural, one {# pass} other {# passes}} of the triggers", { frame: String(l.frame).padStart(6), n: l.passes })}`)}`); }
      else if (l.kind === "end") end = l;
      else if (l.kind === "error") error = l.message;
    }
  } finally { o.signal?.removeEventListener("abort", stop); }
  const exitCode = await exited;
  if (o.signal?.aborted) throw cancelled();
  if (older || (o.replay && error && /--map is needed/.test(error))) throw olderThanReplays(engine.dir);
  if (error) throw new CliError(error, o.replay ? t("The runner is scm-sim's; a replay StarCraft itself plays and your own copy of the game are what it needs.") : t("The runner is scm-sim's; a map StarCraft itself opens, with a slot for a person, and your own copy of the game are what it needs."));
  if (!end) throw new CliError(`${t("The game did not finish: the runner stopped without a result (exit {code}).", { code: exitCode })}${stderr.trim() ? `\n${stderr.trim().split("\n").slice(-6).join("\n")}` : ""}`);
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

const players = (slots: number[]) => (slots.length ? slots.map((p) => `P${p + 1}`).join(" ") : pc.dim(t("nobody")));
const frame = (f: number | null) => (f === null ? pc.dim("–") : num(f));
/** A frame as time on Fastest, `m:ss`. */
const clock = (frames: number) => duration((frames * 1000) / 24);

/** The trigger window's one line for a row: conditions → actions, cut to `width` columns. */
export function rowText(scn: Scenario, row: number, width = 80): string {
  const trig = readTriggers(scn)[row];
  if (!trig) return pc.dim(t("(not in the map)"));
  const s = summarizeTrigger(trig, triggerNames(scn));
  const text = `${s.conditions || pc.dim(t("(no conditions)"))} ${pc.dim("→")} ${s.actions || pc.dim(t("(no actions)"))}`.replace(/\s+/g, " ");
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

/** A replay's part of the report: who played and how it ended, whether the game kept to it, the firings in order. */
export interface ReplayReport {
  frames: number;
  gameType: string;
  /** Use Map Settings: only then does the game run the map's own triggers. */
  mapSettings: boolean;
  players: { slot: number; name: string; race: string; outcome: Outcome }[];
  by: "victory" | "replay" | null;
  /** A map file was played in place of the replay's own. */
  replaced: boolean;
  /** The first frame the replay's commands were not the game played, or null. */
  parted: number | null;
  /** Each firing of a map trigger in the order the game ran them, when asked for. */
  order: { frame: number; clock: string; player: number; row: number }[] | null;
  /** Firings past those the runner keeps. */
  orderDropped: number;
}

export interface TraceReport { file: string; rows: RowSummary[]; passes: number; frame: number; ended: boolean; reason: string | null; replay?: ReplayReport; mod?: RunnerModReport }

const USE_MAP_SETTINGS = 10;

/** The replay's part of a run, from the runner's lines; undefined for a run with nobody playing. */
export function replayReport(r: Pick<MapRunOutcome, "start" | "end">): ReplayReport | undefined {
  const s = r.start, e = r.end;
  if (s?.mode !== "replay" || !s.replay) return undefined;
  return {
    frames: s.replay.frames, gameType: GAME_TYPES[s.replay.gameType] ?? `Type ${s.replay.gameType}`, mapSettings: s.replay.gameType === USE_MAP_SETTINGS,
    players: s.replay.players.map((p, k) => ({ slot: p.slot, name: p.name, race: p.race, outcome: e.outcomes?.[k] ?? null })),
    by: e.by ?? null, replaced: !!s.replaced, parted: e.check?.parted ?? null,
    order: e.order ? e.order.map(([frame, player, row]) => ({ frame, clock: gameClock(frame), player, row })) : null, orderDropped: e.orderDropped ?? 0,
  };
}

/** The trace as data: one summary per map row. */
export function traceReport(file: string, scn: Scenario, r: MapRunOutcome): TraceReport {
  const rows = readTriggers(scn).length;
  const replay = replayReport(r);
  return { file, rows: summarizeRows(r.end.trace ?? [], rows), passes: r.end.passes, frame: r.end.frame, ended: r.end.ended, reason: r.end.reason, ...(replay ? { replay } : {}), ...(r.start?.mod ? { mod: r.start.mod } : {}) };
}

/** `map trace --json`: the report, with where the engine and the game came from, every copy's line and the run's times. */
export function traceJson(file: string, scn: Scenario, r: MapRunOutcome) {
  return { ...traceReport(file, scn, r), engine: r.engine, game: r.game, copies: r.end.trace, ms: r.end.ms };
}

/** Why a row never fired, in words. */
function neverWhy(s: RowSummary): string {
  return !s.players.length ? t("no player in the game owns it") : s.lastFail ? t("{condition} (condition {slot}) said no last, at frame {frame}", { condition: conditionDef(s.lastFail.type)?.name ?? `condition ${s.lastFail.type}`, slot: s.lastFail.slot + 1, frame: num(s.lastFail.frame) }) : s.failed ? t("its conditions said no") : t("it was never asked");
}

/** How a replay's run ended, in a few words: who won, the replay's end, or where it was stopped. */
function endWords(rep: TraceReport): string {
  const r = rep.replay!;
  if (r.by === "victory") { const won = r.players.filter((p) => p.outcome === "victory").map((p) => p.name); return won.length ? t("{players} won", { players: won.join(", ") }) : t("a side won"); }
  if (r.by === "replay") return t("to the replay's end");
  return rep.ended ? t("the game ended: {reason}", { reason: rep.reason ?? "over" }) : t("stopped there");
}

/** The trace's lines: the run in one, a table of the triggers, then the ones that never fired and why. With a replay, the firings in order after them when asked for. */
export function printTrace(file: string, scn: Scenario, r: MapRunOutcome, { all = false, width = process.stdout.columns || 100 } = {}): string[] {
  const rep = traceReport(file, scn, r);
  const replay = rep.replay;
  // A replay's game: the rows no player in the game owns are left out (a map for eight with four playing, or rows a map keeps for nobody).
  const listed = replay ? rep.rows.filter((s) => s.players.length) : rep.rows;
  const never = listed.filter((s) => s.fired === 0);
  const fired = listed.length - never.length;
  const when = replay ? (f: number | null) => (f === null ? pc.dim("–") : gameClock(f)) : frame;
  const out = replay
    ? [`${mark.ok} ${pc.bold(file)}: ${t("{n, plural, one {# trigger} other {# triggers}}", { n: rep.rows.length })}${listed.length !== rep.rows.length ? pc.dim(` ${t("({n} owned by the players)", { n: num(listed.length) })}`) : ""}${dot}${t("{frames} frames", { frames: num(rep.frame) })} ${pc.dim(`(${gameClock(rep.frame)})`)}, ${endWords(rep)}${dot}${t("{n, plural, one {# pass} other {# passes}}", { n: rep.passes })}${dot}${pc.green(t("{n} fired", { n: fired }))}${never.length ? `${dot}${pc.yellow(t("{n} never", { n: never.length }))}` : ""}${dot}${(r.end.ms.total / 1000).toFixed(1)} s`]
    : [`${mark.ok} ${pc.bold(file)}: ${t("{n, plural, one {# trigger} other {# triggers}}", { n: rep.rows.length })}${dot}${t("{frames} frames", { frames: num(rep.frame) })} ${pc.dim(t("({clock} of play)", { clock: clock(rep.frame) }))}${rep.ended ? pc.dim(t(", the game ended: {reason}", { reason: rep.reason ?? "over" })) : ""}${dot}${t("{n, plural, one {# pass} other {# passes}}", { n: rep.passes })}${dot}${pc.green(t("{n} fired", { n: fired }))}${never.length ? `${dot}${pc.yellow(t("{n} never", { n: never.length }))}` : ""}${dot}${(r.end.ms.total / 1000).toFixed(1)} s`];
  if (replay && replay.parted !== null) out.push(`${mark.warn} ${pc.yellow(t("The game parted from the replay at {clock} (frame {frame})", { clock: gameClock(replay.parted), frame: num(replay.parted) }))}${t(": the players' commands after it were meant for another game, so what fired after that is not what happened.")}`);
  if (replay && !replay.mapSettings) out.push(`${mark.info} ${pc.dim(t("The replay is a {type} game: the game ran its own triggers for it, not the map's.", { type: translate(replay.gameType) }))}`);
  if (!listed.length) return out;
  const limit = all ? Infinity : 40;
  const shown = listed.slice(0, limit);
  const head = ["#", t("Fired"), t("First"), t("Last"), t("Players"), t("Trigger")].map((h) => pc.dim(h));
  const fixed = shown.reduce((n, s) => Math.max(n, columns(`${s.row + 1}  ${num(s.fired)}  ${when(s.firstFired)}  ${when(s.lastFired)}  ${players(s.players)}  `)), 0) + 2;
  out.push("", ...table([head, ...shown.map((s) => [
    pc.dim(String(s.row + 1)), s.fired ? num(s.fired) + (s.continued ? pc.dim(` +${s.continued}`) : "") : pc.yellow("0"), when(s.firstFired), when(s.lastFired), players(s.players), rowText(scn, s.row, Math.max(30, width - fixed - 2)),
  ])], 2));
  if (listed.length > shown.length) out.push(pc.dim(`  ${t("… and {n} more (--all lists them)", { n: num(listed.length - shown.length) })}`));
  if (never.length) {
    out.push("", pc.dim(`  ${t("Never fired ({n} of {total})", { n: never.length, total: listed.length })}`));
    for (const s of never.slice(0, all ? Infinity : 20)) out.push(`  ${pc.yellow("▸")} ${pc.dim(`#${s.row + 1}`)}  ${rowText(scn, s.row, Math.max(30, width - 10))}`, `      ${pc.dim(neverWhy(s))}`);
    if (never.length > 20 && !all) out.push(pc.dim(`  ${t("… and {n} more (--all lists them)", { n: num(never.length - 20) })}`));
  }
  if (replay?.order) out.push("", ...orderLines(scn, replay, { all, width }));
  return out;
}

/** Firings listed in order before the list is cut (`--all` lists them all). */
const ORDER_SHOWN = 200;

/** The firings in the order the game ran them: the game's clock, the frame, whose copy, the trigger. */
export function orderLines(scn: Scenario, replay: ReplayReport, { all = false, width = process.stdout.columns || 100 } = {}): string[] {
  const order = replay.order ?? [];
  const total = order.length + replay.orderDropped;
  const out = [pc.dim(`  ${t("In the order they fired ({n})", { n: num(total) })}`)];
  if (!order.length) return [...out, pc.dim(`  ${t("(none of the map's triggers fired)")}`)];
  const nameOf = new Map(replay.players.map((p) => [p.slot, p.name]));
  const who = (p: number) => `P${p + 1}${nameOf.has(p) ? ` ${pc.dim(nameOf.get(p)!)}` : ""}`;
  const shown = all ? order : order.slice(0, ORDER_SHOWN);
  const fixed = shown.reduce((n, x) => Math.max(n, columns(`${x.clock}  ${num(x.frame)}  ${who(x.player)}  #${x.row + 1}  `)), 0) + 2;
  out.push(...table([[t("Clock"), t("Frame"), t("Player"), "#", t("Trigger")].map((h) => pc.dim(h)), ...shown.map((x) => [x.clock, num(x.frame), who(x.player), pc.dim(`#${x.row + 1}`), rowText(scn, x.row, Math.max(30, width - fixed - 2))])], 2));
  if (order.length > shown.length) out.push(pc.dim(`  ${t("… and {n} more (--all lists them)", { n: num(order.length - shown.length) })}`));
  if (replay.orderDropped) out.push(pc.dim(`  ${t("The game kept the first {kept}; {dropped} later firings are counted above but not listed.", { kept: num(order.length), dropped: num(replay.orderDropped) })}`));
  return out;
}

/* ── A replay as the game ─────────────────────────────────────── */

/** What `map trace|cost --replay` hands the runner, and what the trace is worded against. */
export interface ReplayRun {
  /** The map file handed to the game in place of the replay's own (a 1.00 map as a converted copy), or null: the replay's own. */
  map: string | null;
  /** The map (given, or the replay's) is in the StarCraft 1.00 form and a converted copy is played. */
  converted: boolean;
  /** The scenario the trace is worded against: the given map's as the game runs it, else the replay's. */
  scenario: Scenario;
  /** How the given map differs from the replay's, in a few words; null when it does not, or no map was given. */
  differs: string | null;
}

/**
 * The replay's game, made ready: with a map given, that map's scenario (a built map's built one, which is what the
 * game runs) is compared with the replay's, so the command can say when they differ — a changed map can make the
 * replay go out of step. A map in the StarCraft 1.00 form, given or the replay's own, is played as a converted copy,
 * as `map trace` plays one; the copy is deleted when the run ends.
 */
export async function replayRun(rep: Replay, map: { doc: OpenedMap; path: string; name: string; bytes: Uint8Array } | null): Promise<ReplayRun> {
  if (!map) {
    const doc = await openMapBytes(rep.chk, "replay.chk");
    if (mapVersionOf(doc.scenario.fileVersion) !== "original") return { map: null, converted: false, scenario: doc.scenario, differs: null };
    const game = await gameMap(doc, "-", "replay.scx");
    return { map: game.path, converted: true, scenario: doc.scenario, differs: null };
  }
  const chk = (await readArchive(map.bytes)).chk;
  const played = await openMapBytes(chk, `${map.name}.chk`), recorded = await openMapBytes(rep.chk, "replay.chk");
  const d = diffMaps({ name: "replay", doc: recorded }, { name: map.name, doc: played });
  // (A replay holds no archive members — sounds — so those are not a difference.)
  const changed = { ...d, members: [] };
  const same = !changed.header.length && !changed.players.length && !changed.forces.length && !changed.units.length && !changed.locations.length && !changed.triggers.length && !changed.briefing.length && !changed.strings.length && !changed.sections.length;
  const game = await gameMap(map.doc, map.path, map.name);
  return { map: game.path, converted: game.converted, scenario: played.scenario, differs: same ? null : summarizeDiff(changed) || t("the scenario's bytes differ") };
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
  if (!c) throw new CliError(t("The runner counted no cost."));
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
  return { ...costReport(file, r), ...(r.start?.mod ? { mod: r.start.mod } : {}), engine: r.engine, game: r.game, series: r.end.cost, ms: r.end.ms };
}

/** Milliseconds, with the digits a small number needs (a trigger of three records is a hundredth of a microsecond). */
const ms = (x: number) => `${x > 0 && x < 0.001 ? x.toFixed(5) : x > 0 && x < 0.1 ? x.toFixed(3) : x.toFixed(2)} ms`;

/** The cost's lines: what a frame costs against what Remastered can carry, then the costliest triggers. */
export function printCost(file: string, scn: Scenario, r: MapRunOutcome, { all = false, width = process.stdout.columns || 100 } = {}): string[] {
  const rep = costReport(file, r);
  if (!rep.ranIn) return [`${mark.ok} ${pc.bold(file)}: ${t("the triggers ran nothing in {frames} frames", { frames: num(rep.frames) })}`];
  const over = rep.limits && rep.peakMs > rep.limits.mostMs ? mark.error : rep.limits && rep.peakMs > rep.limits.smoothMs ? mark.warn : mark.ok;
  const out = [
    `${over} ${pc.bold(file)}: ${t("triggers cost {average} a frame on average where they ran {ranIn}, {peak} at the most {peakAt}", {
      average: pc.bold(ms(rep.averageMs)), ranIn: pc.dim(t("({ran} of {frames} frames)", { ran: num(rep.ranIn), frames: num(rep.frames) })), peak: pc.bold(ms(rep.peakMs)),
      peakAt: pc.dim(t("(frame {frame}: {records, plural, one {# record} other {# records}}, {triggers, plural, one {# trigger} other {# triggers}})", { frame: num(rep.peakFrame), records: rep.peakRecords, triggers: rep.peakTriggers })),
    })}`,
  ];
  if (rep.limits) out.push(`  ${pc.dim(t("Remastered on a fast computer: smooth to about {smooth} ms of triggers a frame, slows past {most} ms", { smooth: rep.limits.smoothMs, most: rep.limits.mostMs.toFixed(0) }))}`);
  if (rep.ungrouped.records) out.push(`  ${pc.dim(t("{n} of the records ran in no trigger of the map — a program's own (TrigScript, eudplib), {ms} in all", { n: num(rep.ungrouped.records), ms: ms(rep.ungrouped.ms) }))}`);
  const shown = rep.rows.slice(0, all ? Infinity : 12);
  if (shown.length) {
    const head = ["#", t("ms a frame"), t("Frames"), t("Records"), t("Trigger")].map((h) => pc.dim(h));
    const fixed = shown.reduce((n, x) => Math.max(n, columns(`${x.row + 1}  ${ms(x.msAFrame)}  ${num(x.frames)}  ${num(x.records)}  `)), 0) + 2;
    out.push("", pc.dim(`  ${t("Costliest triggers, a frame they ran in")}`), ...table([head, ...shown.map((x) => [pc.dim(String(x.row + 1)), ms(x.msAFrame), num(x.frames), num(x.records), rowText(scn, x.row, Math.max(30, width - fixed - 2))])], 2));
    if (rep.rows.length > shown.length) out.push(pc.dim(`  ${t("… and {n} more (--all lists them)", { n: num(rep.rows.length - shown.length) })}`));
  }
  return out;
}
