/**
 * `scmjs map coverage <map> <replays…>`: which of a map's triggers fired in any of many games, how often, and which
 * never did. Each replay's game is played on the map by the map runner, as `map trace --replay` plays one (one game a
 * process, a few at once), and its trace is folded into one count a trigger; `--tests` counts the games of the map's
 * own tests (`map test`'s scenarios) as well. Only replays of this map count (the same scenario, or one with the same
 * name and size, as `map heatmap` takes them) and only Use Map Settings games, since in the others the game runs its
 * own melee triggers. A game whose players' commands parted from the map counts what fired before it parted, from the
 * firings in order the runner hands back, and is said.
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { openMapBytes, readArchive, type OpenedMap } from "../../src/editor/mapFile";
import { scenarioName, type Scenario } from "../../src/formats/chk/scenario";
import { readTriggers, triggerNames } from "../../src/editor/triggers";
import { summarizeTrigger } from "../../src/formats/triggers/text";
import { conditionDef } from "../../src/data/triggerDefs";
import { plainText } from "../../src/editor/textColors";
import { ensureEngine, findGameCopy, type Engine } from "./engine";
import { loadReplayInput, readInput, STDIO, type Input } from "./files";
import { matchReplay, type MatchKind } from "./heat";
import { defaultParallel, mapIdentity, replayFiles, replayMapIdentity, sha256, skippedLines } from "./heatmap";
import { defaultTests, readTests, runTests, type PlannedScenario } from "./maptest";
import { GAME_TYPES } from "./replay";
import { gameClock, gameMap, rowText, runMapInGame, type CopyLine } from "./trace";
import type { CoverageForm } from "./report";
import { CliError, columns, dot, mark, num, pc, plural, table, visible } from "./ui";

const USE_MAP_SETTINGS = 10;

export interface CoverageOptions {
  /** The map's own tests file (`<map>.tests.json` beside it) as games too. */
  tests?: boolean;
  /** Replays played at once. */
  parallel?: string;
  /** Take replays played on another map too. */
  force?: boolean;
  starcraft?: string;
  /** The play page's address, or a folder holding the engine. */
  engine?: string;
  signal?: AbortSignal;
  node?: string;
}

/** One game counted: a replay's, or a test scenario's. */
export interface CoverageGame {
  kind: "replay" | "test";
  /** The replay's file name, or the tests file. */
  file: string;
  /** The replay's file name, or the scenario's name. */
  name: string;
  /** How a replay's map matched this one. */
  match: MatchKind | null;
  frames: number;
  /** The players' names (a replay's), or none (a scenario with nobody playing). */
  players: string[];
  /** The first frame the players' commands were not the game played; what fired from there on is not counted. */
  parted: number | null;
  /** The map's triggers that fired in it. */
  fired: number;
  ms: number;
}

/** A map trigger over all the games. */
export interface CoverageRow {
  row: number;
  /** The players (0–7) who held a copy in any game: none means nobody who played owns it. */
  players: number[];
  /** Games it fired in, and how often in all of them. */
  games: number;
  fired: number;
  /** Its first firing in any game, and that game's name. */
  first: number | null;
  firstIn: string | null;
  /** For one that never fired: the condition that said no last, in which game. */
  lastFail: { slot: number; type: number; frame: number; game: string } | null;
}

export interface CoverageReport {
  file: string;
  name: string;
  /** The map's triggers, those a player in some game owned, those of them that fired, and those that never did. */
  triggers: number;
  owned: number;
  fired: number;
  never: number;
  games: CoverageGame[];
  /** Replays not counted, and why: another map, not Use Map Settings, the same replay twice, one the game could not play. */
  skipped: { file: string; reason: string }[];
  rows: CoverageRow[];
  engine?: { build: string; fetched: number };
  ms: number;
}

/** A trigger's part of one game: who held it, how often it fired (before a parting), its first firing, and its last failing condition. */
interface GameRow { players: number[]; fired: number; first: number | null; lastFail: CopyLine["lastFail"] }

/**
 * One game's trace folded to the map's rows. `shift` is the rows a test's setup put before the map's own. A game that
 * parted counts the firings before the parting from the firings in order; past what the runner kept of those, a copy
 * that first fired before the parting counts once.
 */
export function gameRows(lines: readonly CopyLine[], rows: number, parted: number | null = null, order: readonly (readonly [number, number, number])[] | null = null, shift = 0): GameRow[] {
  const out: GameRow[] = Array.from({ length: rows }, () => ({ players: [], fired: 0, first: null, lastFail: null }));
  const at = (row: number) => out[row - shift];
  for (const l of lines) {
    const s = at(l.row);
    if (!s) continue;
    if (!s.players.includes(l.player)) s.players.push(l.player);
    if (l.lastFail && (parted === null || l.lastFail.frame < parted) && (!s.lastFail || l.lastFail.frame > s.lastFail.frame)) s.lastFail = l.lastFail;
    if (parted !== null) continue;
    s.fired += l.fired;
    if (l.firstFired !== null && (s.first === null || l.firstFired < s.first)) s.first = l.firstFired;
  }
  if (parted !== null) {
    for (const [frame, , row] of order ?? []) {
      const s = at(row);
      if (!s || frame >= parted) continue;
      s.fired++;
      if (s.first === null || frame < s.first) s.first = frame;
    }
    for (const l of lines) {
      const s = at(l.row);
      if (s && !s.fired && l.firstFired !== null && l.firstFired < parted) { s.fired = 1; s.first = l.firstFired; }
    }
  }
  for (const s of out) s.players.sort((a, b) => a - b);
  return out;
}

/** The games' rows added up, one per map trigger. */
export function addGames(games: readonly { name: string; rows: GameRow[] }[], rows: number): CoverageRow[] {
  const out: CoverageRow[] = Array.from({ length: rows }, (_, row) => ({ row, players: [], games: 0, fired: 0, first: null, firstIn: null, lastFail: null }));
  for (const g of games) {
    g.rows.forEach((s, row) => {
      const c = out[row];
      if (!c) return;
      for (const p of s.players) if (!c.players.includes(p)) c.players.push(p);
      if (s.fired) { c.games++; c.fired += s.fired; }
      if (s.first !== null && (c.first === null || s.first < c.first)) { c.first = s.first; c.firstIn = g.name; }
      if (s.lastFail && (!c.lastFail || s.lastFail.frame > c.lastFail.frame)) c.lastFail = { ...s.lastFail, game: g.name };
    });
  }
  for (const c of out) c.players.sort((a, b) => a - b);
  return out;
}

/** The map's scenario as the game runs it: a built map's built one (the archive's scenario as stored), else the map's. */
export const coverageScenario = (input: Pick<Input, "bytes" | "name">) => gameScenario(input.bytes, input.name);
async function gameScenario(bytes: Uint8Array, name: string): Promise<Scenario> {
  let chk = bytes;
  try { chk = (await readArchive(bytes)).chk; } catch { /* a bare scenario is its own bytes */ }
  return (await openMapBytes(chk, `${name.replace(/\.(scm|scx|chk)$/i, "")}.chk`)).scenario;
}

/** A game as the report names it: the replay's file, or the test scenario's name. */
export const gameName = (g: Pick<CoverageGame, "kind" | "name">) => (g.kind === "test" ? `test ${JSON.stringify(g.name)}` : g.name);

/** The line a game gets as it is done: its place, ✔ or ▲ (parted) or ✖, its length, players and what fired. */
export function gameLine(k: number, total: number, g: CoverageGame | null, file: string, error?: string): string {
  const at = pc.dim(`${String(k).padStart(String(total).length)}/${total}`);
  if (!g) return `${at} ${mark.error} ${file}: ${error ?? "not played"}`;
  const who = gameName(g);
  const parted = g.parted !== null ? `${dot}${pc.yellow(`parted at ${gameClock(g.parted)}, counted to there`)}` : "";
  return `${at} ${g.parted !== null ? mark.warn : mark.ok} ${who}  ${gameClock(g.frames)}${g.players.length ? `${dot}${plural(g.players.length, "player")}` : ""}${dot}${plural(g.fired, "trigger")} fired${parted}${dot}${pc.dim(`${(g.ms / 1000).toFixed(1)} s`)}`;
}

/**
 * The command: the replays read and matched to the map, the Use Map Settings ones played a few at once, the tests'
 * scenarios played after them with `tests`, every game's trace added up per trigger. `live` gets a line as each game
 * is done.
 */
export async function runCoverage(input: Input, doc: OpenedMap, sources: readonly string[], o: CoverageOptions = {}, live: (line: string) => void = () => {}): Promise<CoverageReport> {
  const t0 = performance.now();
  const parallel = o.parallel === undefined ? defaultParallel() : Number(o.parallel);
  if (!Number.isInteger(parallel) || parallel < 1) throw new CliError(`--parallel takes a whole number of games, 1 or more, not "${o.parallel}"`, null, 2);
  const testFiles = sources.filter((s) => /\.json$/i.test(s));
  if (o.tests) {
    if (input.path === STDIO) throw new CliError("A map read from standard input has no tests beside it: name the tests file.", null, 2);
    testFiles.unshift(defaultTests(input.path));
  }
  const replayPaths = sources.filter((s) => !/\.json$/i.test(s));
  if (!replayPaths.length && !testFiles.length) throw new CliError("Name the replays to count: files, or folders of them (and --tests for the map's tests).", null, 2);
  const scn = await gameScenario(input.bytes, input.name);
  const rows = readTriggers(scn).length;

  // The replays, read and matched to the map; only Use Map Settings games run the map's triggers.
  const mine = await mapIdentity(input.bytes, doc.scenario);
  const files = replayFiles(replayPaths, true);
  const skipped: CoverageReport["skipped"] = [];
  const taken: { file: string; path: string; match: MatchKind; players: string[] }[] = [];
  const hashes = new Set<string>();
  for (const path of files) {
    const name = relative(process.cwd(), path) || basename(path);
    try {
      const rin = await readInput(path);
      if (rin.kind !== "replay") { skipped.push({ file: name, reason: "not a replay" }); continue; }
      if (rin.path === STDIO) throw new CliError("a replay from standard input: the game reads a file", null, 2);
      const hash = sha256(rin.bytes);
      if (hashes.has(hash)) { skipped.push({ file: name, reason: "the same replay as one before it" }); continue; }
      hashes.add(hash);
      const rep = await loadReplayInput(rin);
      const m = matchReplay(mine, replayMapIdentity(rep), !!o.force);
      if (!m.match) { skipped.push({ file: name, reason: m.reason }); continue; }
      if (rep.header.gameType !== USE_MAP_SETTINGS) { skipped.push({ file: name, reason: `not Use Map Settings: in a ${GAME_TYPES[rep.header.gameType] ?? "melee"} game the game runs its own triggers, not the map's` }); continue; }
      taken.push({ file: name, path, match: m.match, players: rep.players.filter((p) => p.type === 1 || p.type === 2).map((p) => p.name) });
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      skipped.push({ file: name, reason: e.message.replace(/^No file .*/, "no such file") });
    }
  }
  for (const line of skippedLines(skipped)) live(line);
  if (!taken.length && !testFiles.length) {
    const what = files.length === 1 ? `${basename(files[0])} is not a Use Map Settings game on ${input.name}.` : `None of the ${plural(files.length, "replay")} is a Use Map Settings game on ${input.name}.`;
    throw new CliError(what, "A replay counts when its map is this one, or has the same name and size (--force takes others), and it was played as Use Map Settings.", 2);
  }

  // The tests, read before anything is played: a mistake in the file is said at once.
  const scenarios: PlannedScenario[] = [];
  const archive = await readArchive(input.bytes).catch(() => null);
  for (const f of testFiles) {
    if (!existsSync(f)) throw new CliError(`No tests file ${f}`, o.tests ? "scmjs map test's tests are in <map>.tests.json beside the map; --tests counts its scenarios as games." : null, 2);
    scenarios.push(...readTests(f, readFileSync(f, "utf8"), archive?.chk ?? input.bytes, { frames: 2400, seed: 1 }));
  }

  const games: { game: CoverageGame; rows: GameRow[] }[] = [];
  const total = taken.length + scenarios.length;
  live(`${pc.bold(input.name)}${dot}${plural(rows, "trigger")}${dot}${[taken.length && plural(taken.length, "replay"), scenarios.length && plural(scenarios.length, "test scenario")].filter(Boolean).join(" and ")} to play${taken.length > 1 && parallel > 1 ? `, ${Math.min(parallel, taken.length)} at a time` : ""}`);
  const game = findGameCopy(o.starcraft);
  const engine: Engine = await ensureEngine(o.engine, undefined, live);
  let done = 0;

  // The replays, a few at once: one game a process, as map trace --replay plays one.
  const errors = new Map<number, string>();
  if (taken.length) {
    let next = 0, older: CliError | null = null;
    const results: (typeof games[number] | null)[] = taken.map(() => null);
    const worker = async () => {
      while (next < taken.length && !older) {
        const k = next++, r = taken[k];
        try {
          if (o.signal?.aborted) throw new CliError("The run was cancelled.");
          const target = await gameMap(doc, input.path, input.name);
          const run = await runMapInGame(target.path, "trace", { replay: r.path, order: true, every: 0, ready: engine, starcraft: game.folder, signal: o.signal, node: o.node });
          const parted = run.end.check?.parted ?? null;
          const folded = gameRows(run.end.trace ?? [], rows, parted, run.end.order ?? null);
          const g: CoverageGame = { kind: "replay", file: r.file, name: basename(r.path), match: r.match, frames: run.end.frame, players: run.start?.replay?.players.map((p) => p.name) ?? r.players, parted, fired: folded.filter((s) => s.fired).length, ms: run.end.ms.total };
          results[k] = { game: g, rows: folded };
          live(gameLine(++done, total, g, r.file));
        } catch (e) {
          if (e instanceof CliError && /from before/.test(e.message)) { older = e; return; }
          if (o.signal?.aborted) throw e;
          errors.set(k, e instanceof Error ? e.message.split("\n")[0] : String(e));
          live(gameLine(++done, total, null, r.file, errors.get(k)));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, taken.length)) }, worker));
    if (older) throw older;
    games.push(...results.filter((x): x is typeof games[number] => x !== null));
  }
  for (const [k, reason] of errors) skipped.push({ file: taken[k].file, reason: `the game could not play it: ${reason}` });
  if (errors.size) process.exitCode = Math.max(Number(process.exitCode ?? 0), 1);

  // The tests' scenarios, one game each; whether they pass is map test's business, not this one's.
  if (scenarios.length) {
    const out = mkdtempSync(join(tmpdir(), "scmjs-coverage-"));
    try {
      await runTests(input.name, scenarios, { extras: archive?.extras ?? new Map(), stored: archive?.stored ?? null }, {
        out, quiet: true, starcraft: game.folder, engine: o.engine, signal: o.signal, node: o.node, live,
        onEnd: (p, start, end) => {
          const parted = end.check?.parted ?? null;
          const folded = gameRows(end.trace, p.rows, parted, null, p.before.length);
          const players = (start as { replay?: { players: { name: string }[] } }).replay?.players.map((x) => x.name) ?? [];
          const g: CoverageGame = { kind: "test", file: relative(process.cwd(), p.file) || p.file, name: p.name, match: null, frames: end.frame, players, parted, fired: folded.filter((s) => s.fired).length, ms: end.ms.total };
          games.push({ game: g, rows: folded });
          live(gameLine(++done, total, g, g.file));
        },
      });
    } finally { rmSync(out, { recursive: true, force: true }); }
  }
  if (!games.length) throw new CliError(`The game played none of the ${plural(taken.length, "replay")}.`, "The map runner is scm-sim's; your own copy of StarCraft and replays the game itself plays are what it needs.");

  const all = addGames(games.map((g) => ({ name: gameName(g.game), rows: g.rows })), rows);
  const owned = all.filter((c) => c.players.length);
  const fired = owned.filter((c) => c.fired).length;
  return {
    file: input.name, name: plainText(scenarioName(scn) ?? "").trim(), triggers: rows, owned: owned.length, fired, never: owned.length - fired,
    games: games.map((g) => g.game), skipped, rows: all, engine: { build: engine.build, fetched: engine.fetched }, ms: performance.now() - t0,
  };
}

/* ── The report ─────────────────────────────────────────────── */

const players = (slots: number[]) => (slots.length ? slots.map((p) => `P${p + 1}`).join(" ") : pc.dim("nobody"));

/** Why a trigger never fired, in words. */
export function neverWhy(c: CoverageRow): string {
  if (!c.players.length) return "no player in these games owns it";
  if (c.lastFail) return `${conditionDef(c.lastFail.type)?.name ?? `condition ${c.lastFail.type}`} (condition ${c.lastFail.slot + 1}) said no last, in ${c.lastFail.game} at ${gameClock(c.lastFail.frame)}`;
  return "its conditions said no";
}

/** The trigger's one line as plain text (for the JSON and CI's annotations), cut to `width`. */
export const plainRow = (scn: Scenario, row: number, width = 160) => visible(rowText(scn, row, width));

/** The first line: how many of the triggers fired in how many games, and how many never did. */
export function coverageSummary(r: CoverageReport, strict = false): string {
  const m = r.never ? (strict ? mark.error : mark.warn) : mark.ok;
  const others = r.triggers - r.owned;
  return `${m} ${pc.bold(r.file)}: ${num(r.fired)} of ${plural(r.owned, "trigger")} fired in ${plural(r.games.length, "game")}; ${r.never ? pc.yellow(`${num(r.never)} never fired`) : pc.green("none never fired")}${others ? pc.dim(`${dot}${num(others)} more owned by no player in these games`) : ""}`;
}

/** The report's lines: the summary, a table of the triggers, then the ones that never fired and why. */
export function printCoverage(r: CoverageReport, scn: Scenario, { all = false, strict = false, width = process.stdout.columns || 100 } = {}): string[] {
  const out = [coverageSummary(r, strict)];
  const parted = r.games.filter((g) => g.parted !== null);
  if (parted.length) out.push(`${mark.warn} ${pc.yellow(`${plural(parted.length, "game")} parted from the map`)}: ${parted.slice(0, 3).map((g) => `${gameName(g)} at ${gameClock(g.parted!)}`).join(", ")}${parted.length > 3 ? ` and ${num(parted.length - 3)} more` : ""}. What fired after that is not counted: the players' commands were meant for another game.`);
  const listed = all ? r.rows : r.rows.filter((c) => c.players.length);
  if (!listed.length) return out;
  const shown = listed.slice(0, all ? Infinity : 40);
  const K = r.games.length;
  const first = (c: CoverageRow) => (c.first === null ? pc.dim("–") : gameClock(c.first));
  const head = ["#", "Games", "Fired", "First", "Players", "Trigger"].map((h) => pc.dim(h));
  const fixed = shown.reduce((n, c) => Math.max(n, columns(`${c.row + 1}  ${c.games}/${K}  ${num(c.fired)}  ${visible(first(c))}  ${visible(players(c.players))}  `)), 0) + 2;
  out.push("", ...table([head, ...shown.map((c) => [
    pc.dim(String(c.row + 1)), c.fired ? `${c.games}/${K}` : pc.yellow(`0/${K}`), c.fired ? num(c.fired) : pc.yellow("0"), first(c), players(c.players), rowText(scn, c.row, Math.max(30, width - fixed - 2)),
  ])], 2));
  if (listed.length > shown.length) out.push(pc.dim(`  … and ${num(listed.length - shown.length)} more (--all lists them)`));
  const never = r.rows.filter((c) => c.players.length && !c.fired);
  if (never.length) {
    out.push("", pc.dim(`  Never fired (${num(never.length)} of ${num(r.owned)})`));
    for (const c of never.slice(0, all ? Infinity : 20)) out.push(`  ${pc.yellow("▸")} ${pc.dim(`#${c.row + 1}`)}  ${rowText(scn, c.row, Math.max(30, width - 10))}`, `      ${pc.dim(neverWhy(c))}`);
    if (never.length > 20 && !all) out.push(pc.dim(`  … and ${num(never.length - 20)} more (--all lists them)`));
  }
  return out;
}

/** `map coverage --json`: the report, each trigger with its text, owned or not. */
export function coverageJson(r: CoverageReport, scn: Scenario) {
  const names = triggerNames(scn), list = readTriggers(scn);
  return {
    ...r,
    rows: r.rows.map((c) => ({
      number: c.row + 1, ...c, owned: c.players.length > 0, firstClock: c.first === null ? null : gameClock(c.first),
      owners: list[c.row] ? summarizeTrigger(list[c.row], names).players : "", text: plainRow(scn, c.row), ...(c.fired ? {} : { why: neverWhy(c) }),
    })),
  };
}

/** The run in the form report.ts's CI writers take: the triggers a player owned, and the games that parted. */
export function coverageForm(mapPath: string, r: CoverageReport, scn: Scenario, strict: boolean): CoverageForm {
  return {
    map: mapPath, name: r.name, games: r.games.length, strict,
    cases: r.rows.filter((c) => c.players.length).map((c) => ({ number: c.row + 1, text: plainRow(scn, c.row), games: c.games, fired: c.fired, why: c.fired ? null : neverWhy(c) })),
    parted: r.games.filter((g) => g.parted !== null).map((g) => ({ name: gameName(g), clock: gameClock(g.parted!) })),
  };
}
