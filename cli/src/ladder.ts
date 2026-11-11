/**
 * `scmjs bot ladder <bots…> --maps <maps…>`: a round robin of BWAPI bots, and the game's own computer, over a set of
 * maps, with no page. Every pairing plays on every map, in every race given, both ways round when both are bots, once
 * a seed; each game is scm-sim's match runner (`engine.ts`'s `match` runner) in a process of its own — two bots are
 * two copies of the game kept in step by the runner, a bot against the computer one. A line as each game ends, then
 * the standing: games, wins, losses, undecided, the average length, each bot's time a frame, an Elo rating and the
 * head-to-head. Every game's replay is saved under the ladder's folder, named by its pairing, map, races and seed.
 */
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { codeWords, ensureEngine, findGameCopy, fitWords, MOD_CODE, modArgs, modWords, runnerFor, startRunner, type BotFitReport, type Engine, type RunnerCodeReport, type RunnerModReport } from "./engine";
import type { ModOverlay } from "./mod/overlay";
import { t } from "./i18n";
import { CliError, dot, duration, mark, num, pc, print, table } from "./ui";

/** A frame of the game on Fastest, as the clock counts it. */
const FRAME_MS = 42;
/** Elo: where every entrant starts, and how far one game moves it. */
export const ELO_START = 1500, ELO_K = 32;

/* ── Who plays ─────────────────────────────────────────────── */

export type RaceLetter = "z" | "t" | "p" | "r";
const RACE_WORD: Record<RaceLetter, string> = { z: "zerg", t: "terran", p: "protoss", r: "random" };
const RACE_UPPER: Record<string, string> = { zerg: "Z", terran: "T", protoss: "P", random: "R", unknown: "?" };

/** A race as a letter: `z`, `zerg`, `Z` alike; null when it is not one. */
export function raceLetter(s: string): RaceLetter | null {
  const k = s.trim().toLowerCase();
  if (k === "z" || k === "zerg") return "z";
  if (k === "t" || k === "terran") return "t";
  if (k === "p" || k === "protoss") return "p";
  if (k === "r" || k === "random") return "r";
  return null;
}

/** `--races tpz`: the letters, each once, in the order given. */
export function parseRaces(s: string): RaceLetter[] {
  const out: RaceLetter[] = [];
  for (const ch of s.replace(/[\s,]/g, "")) {
    const r = raceLetter(ch);
    if (!r) throw new CliError(t("--races {races}: \"{letter}\" is not a race", { races: s, letter: ch }), t("Letters of z, t, p and r (random): --races tpz."), 2);
    if (!out.includes(r)) out.push(r);
  }
  if (!out.length) throw new CliError(t("--races names no race"), t("Letters of z, t, p and r (random): --races tpz."), 2);
  return out;
}

/** One side of the ladder: a bot from its file, or the game's computer in one race. */
export interface Entrant {
  /** Unique in the ladder, for the folders and the JSON: the bot's key, `computer-t`. */
  key: string;
  /** As the tables show it: the bot's name, "Terran computer". */
  label: string;
  kind: "bot" | "computer";
  /** The `.scmbot`, for a bot. */
  file?: string;
  /** The race it always plays (`mybot.scmbot:p`, a computer's), or null for each of `--races` in turn. */
  race: RaceLetter | null;
}

/** A `.scmbot`'s header: what the toolchain wrote about the bot. */
export function readBotHeader(bytes: Uint8Array): { key: string; name: string; commit?: string } {
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== "SCMBOT1\n") throw new Error("not a .scmbot file");
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + n))) as { key?: string; name?: string; commit?: string };
  return { key: String(h.key ?? "bot"), name: String(h.name ?? h.key ?? "bot"), commit: h.commit };
}

/**
 * The entrants the command line names: `mybot.scmbot`, `mybot.scmbot:p` (always protoss), `computer` (the game's
 * computer, once for each of `races`), `computer:t`. A race after the last colon only when it is one (a Windows path
 * has a colon of its own). `read` gives a file's bytes (the tests hand their own).
 */
export function parseEntrants(specs: readonly string[], races: readonly RaceLetter[], read: (file: string) => Uint8Array = (f) => new Uint8Array(readFileSync(f))): Entrant[] {
  const out: Entrant[] = [];
  const add = (e: Entrant) => {
    let key = e.key, k = 2;
    while (out.some((x) => x.key === key)) key = `${e.key}-${k++}`;
    const label = out.some((x) => x.label === e.label) ? `${e.label} (${key})` : e.label;
    out.push({ ...e, key, label });
  };
  for (const spec of specs) {
    const colon = spec.lastIndexOf(":");
    const suffix = colon > 0 ? raceLetter(spec.slice(colon + 1)) : null;
    const name = suffix ? spec.slice(0, colon) : spec;
    if (name.toLowerCase() === "computer") {
      for (const r of suffix ? [suffix] : races) add({ key: `computer-${r}`, label: r === "r" ? "Random computer" : `${RACE_WORD[r][0].toUpperCase()}${RACE_WORD[r].slice(1)} computer`, kind: "computer", race: r });
      continue;
    }
    if (!existsSync(name)) throw new CliError(t("No file {name}", { name }), t("A bot is a .scmbot file (scmjs bot build writes out/<key>.scmbot), or computer for the game's own."), 2);
    let header: ReturnType<typeof readBotHeader>;
    try { header = readBotHeader(read(name)); }
    catch { throw new CliError(t("{name} is not a bot file", { name }), t("A bot is a .scmbot file, as scmjs bot build writes it."), 2); }
    add({ key: slug(header.key) || "bot", label: header.name, kind: "bot", file: resolve(name), race: suffix });
  }
  if (out.length < 2) throw new CliError(t("A ladder needs two sides at least"), t("Name two bots, or a bot and computer: scmjs bot ladder mybot.scmbot computer --maps (2)Boxer.scm"), 2);
  if (!out.some((e) => e.kind === "bot")) throw new CliError(t("A ladder needs a bot: the game's computers alone do not play one"), null, 2);
  return out;
}

/** A name for a file: lower case letters, digits and dashes. */
export const slug = (s: string) => s.toLowerCase().replace(/\.(scm|scx|chk)$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/* ── The schedule ──────────────────────────────────────────── */

/** One game of the ladder: who sits first and second in the lobby, their races, the map and the seed. */
export interface ScheduledGame {
  /** 1 to the number of games, in the order they are played. */
  index: number;
  /** Entrant indexes: lobby order (the first is player 1 of the lobby; the game deals the start locations itself). */
  sides: [number, number];
  races: [RaceLetter, RaceLetter];
  map: string;
  seed: number;
  /** The replay's file name, unique in the ladder. */
  replay: string;
}

/**
 * Every game: for each seed (a round), each map, each pairing of two entrants (not two computers), each race either
 * plays — its own, or each of `races` — and, between two bots, both ways round (who is first in the lobby). Rounds
 * first, so a ladder cut short has played every pairing about as often.
 */
export function schedule(entrants: readonly Entrant[], maps: readonly string[], races: readonly RaceLetter[], seeds: readonly number[]): ScheduledGame[] {
  const out: ScheduledGame[] = [];
  const names = new Set<string>();
  for (const seed of seeds) for (const map of maps) {
    for (let i = 0; i < entrants.length; i++) for (let j = i + 1; j < entrants.length; j++) {
      const a = entrants[i], b = entrants[j];
      if (a.kind === "computer" && b.kind === "computer") continue;
      for (const ra of a.race ? [a.race] : races) for (const rb of b.race ? [b.race] : races) {
        // A bot comes first against the computer (whose seat in the lobby is the game's own); two bots both ways.
        const orders: [number, number][] = a.kind === "bot" && b.kind === "bot" ? [[i, j], [j, i]] : a.kind === "bot" ? [[i, j]] : [[j, i]];
        for (const [x, y] of orders) {
          const rx = x === i ? ra : rb, ry = y === i ? ra : rb;
          let name = replayName(entrants[x], entrants[y], rx, ry, map, seed);
          for (let k = 2; names.has(name); k++) name = replayName(entrants[x], entrants[y], rx, ry, map, seed, k);
          names.add(name);
          out.push({ index: out.length + 1, sides: [x, y], races: [rx, ry], map, seed, replay: name });
        }
      }
    }
  }
  return out;
}

/** `mcrave-vs-ualbertabot_boxer_ZvP_seed1.rep`: the pairing in lobby order, the map, the races and the seed. */
export function replayName(a: Entrant, b: Entrant, ra: RaceLetter, rb: RaceLetter, map: string, seed: number, n = 1): string {
  const mapName = slug(basename(map, extname(map)).replace(/^\(\d\)/, "")) || "map";
  return `${a.key}-vs-${b.key}_${mapName}_${ra.toUpperCase()}v${rb.toUpperCase()}_seed${seed}${n > 1 ? `-${n}` : ""}.rep`;
}

/* ── The runner's lines ────────────────────────────────────── */

export interface MatchPlayer { side: number; slot: number; kind: "bot" | "computer"; name: string; race: string; minerals: number; gas: number; supplyUsed: number; supplyAvailable: number; outcome: "victory" | "defeat" | "draw" | null }
export interface MatchBotStats { side: number; name: string; commit: string; state: "running" | "failed" | "ended" | "left" | "crashed" | "loading"; error: string | null; frames: number; ms: number; maxMs: number; over55: number; over1s: number; over10s: number; commands: number; kept: number | null }
export interface MatchEnd {
  frame: number; players: MatchPlayer[]; seed: number; decided: boolean; winner: number | null; by: "victory" | "left" | "frames" | "desync";
  bots: MatchBotStats[]; replay: { file: string; bytes: number; agreed: boolean | null } | null; hashes: { compared: number; differedAt: number | null };
  ms: { game: number; bots: number[]; total: number };
}
export type MatchLine =
  | { kind: "start"; map: { name: string; width: number; height: number; tileset: string }; copy: string; seed: number; players: MatchPlayer[]; seats: number; ms: { load: number; start: number }; mod?: RunnerModReport; code?: RunnerCodeReport; game?: "melee" | "ums"; fits?: { side: number; name: string; fit: BotFitReport }[] }
  | { kind: "text"; side: number; text: string }
  | { kind: "progress"; frame: number; players: MatchPlayer[]; ms: { game: number; bots: number[] } }
  | ({ kind: "end" } & MatchEnd)
  | { kind: "error"; message: string };

/** A game as it went: the runner's end, or why there is none. */
export interface GameResult {
  game: ScheduledGame;
  end: MatchEnd | null;
  /** The game could not be played (the runner refused the map, say): the reason. */
  error: string | null;
  /** The winner as an entrant index, null for none. */
  winner: number | null;
  /** The replay's path, when it was written. */
  replay: string | null;
  /** The runner's start line (the mod, its code, each bot's fit to it). */
  start?: Extract<MatchLine, { kind: "start" }> | null;
}

/** What a game counts as for entrant `e`: won, lost, undecided (the frame limit or a draw), or not counted. */
export function scoreFor(r: GameResult, e: number): "won" | "lost" | "undecided" | null {
  if (!r.end || r.end.by === "desync" || !r.game.sides.includes(e)) return null;
  if (r.winner === null) return "undecided";
  return r.winner === e ? "won" : "lost";
}

/* ── The standing ──────────────────────────────────────────── */

/** The expected score of a side rated `a` against one rated `b`. */
export const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));

/**
 * Elo over the games in the order they were scheduled (not the order they ended, so `--parallel` changes nothing): a
 * win 1, a loss 0, undecided ½; games not counted (not played, the copies out of step) leave the ratings alone.
 */
export function eloRatings(count: number, results: readonly GameResult[], k = ELO_K, start = ELO_START): number[] {
  const r = Array.from({ length: count }, () => start);
  for (const g of [...results].sort((x, y) => x.game.index - y.game.index)) {
    const [a, b] = g.game.sides;
    const s = scoreFor(g, a);
    if (s === null) continue;
    const sa = s === "won" ? 1 : s === "lost" ? 0 : 0.5;
    const ea = expected(r[a], r[b]);
    r[a] += k * (sa - ea);
    r[b] += k * ((1 - sa) - (1 - ea));
  }
  return r;
}

export interface Standing {
  entrant: number;
  key: string;
  label: string;
  elo: number;
  games: number;
  won: number;
  lost: number;
  undecided: number;
  /** Games that could not be counted: not played, or out of step. */
  uncounted: number;
  /** The bot's copy failed or died, in this many games. */
  crashed: number;
  /** Average game length in frames, over the games counted. */
  frames: number;
  /** The bot's milliseconds a frame over all its games (null for the computer). */
  msPerFrame: number | null;
  /** The longest frame it took, and frames over the tournaments' 55 ms. */
  maxMs: number | null;
  over55: number;
}

/** Each entrant's line of the table, best Elo first. */
export function standings(entrants: readonly Entrant[], results: readonly GameResult[]): Standing[] {
  const elo = eloRatings(entrants.length, results);
  const out = entrants.map((e, i): Standing => {
    let games = 0, won = 0, lost = 0, undecided = 0, uncounted = 0, crashed = 0, frames = 0, ms = 0, botFrames = 0, maxMs = 0, over55 = 0;
    for (const r of results) {
      if (!r.game.sides.includes(i)) continue;
      const s = scoreFor(r, i);
      if (s === null) { uncounted++; continue; }
      games++; frames += r.end!.frame;
      if (s === "won") won++; else if (s === "lost") lost++; else undecided++;
      const side = r.game.sides.indexOf(i);
      const b = r.end!.bots.find((x) => x.side === side);
      if (b) {
        ms += b.ms; botFrames += b.frames; maxMs = Math.max(maxMs, b.maxMs); over55 += b.over55;
        if (b.state === "crashed" || b.state === "failed") crashed++;
      }
    }
    return { entrant: i, key: e.key, label: e.label, elo: elo[i], games, won, lost, undecided, uncounted, crashed, frames: games ? frames / games : 0, msPerFrame: e.kind === "bot" && botFrames ? ms / botFrames : null, maxMs: e.kind === "bot" && botFrames ? maxMs : null, over55 };
  });
  return out.sort((a, b) => b.elo - a.elo || b.won - a.won || a.entrant - b.entrant);
}

/** Wins of row against column, `[won, lost, undecided]`, for every pair that met. */
export function headToHead(count: number, results: readonly GameResult[]): ([number, number, number] | null)[][] {
  const m: ([number, number, number] | null)[][] = Array.from({ length: count }, () => Array.from({ length: count }, () => null));
  for (const r of results) {
    const [a, b] = r.game.sides;
    for (const [x, y] of [[a, b], [b, a]]) {
      const s = scoreFor(r, x);
      if (s === null) continue;
      const cell = (m[x][y] ??= [0, 0, 0]);
      cell[s === "won" ? 0 : s === "lost" ? 1 : 2]++;
    }
  }
  return m;
}

/* ── Words ─────────────────────────────────────────────────── */

const clock = (frames: number) => duration(frames * FRAME_MS);
const sideWord = (e: Entrant, race: string) => `${pc.bold(e.label)} ${pc.dim(RACE_UPPER[race] ?? "?")}`;

/** The line a game gets as it ends. */
export function gameLine(r: GameResult, entrants: readonly Entrant[], total: number): string {
  const g = r.game;
  const at = pc.dim(`${String(g.index).padStart(String(total).length)}/${total}`);
  const mapName = basename(g.map);
  const seed = t("seed {seed}", { seed: g.seed });
  if (!r.end) return `${at} ${mark.error} ${t("{a} vs {b} on {map}", { a: entrants[g.sides[0]].label, b: entrants[g.sides[1]].label, map: mapName })}${dot}${seed}: ${r.error ?? t("not played")}`;
  const e = r.end;
  // The races the game dealt (random drawn), by side.
  const race = (k: number) => e.players.find((p) => p.side === k)?.race ?? RACE_WORD[g.races[k]];
  const a = sideWord(entrants[g.sides[0]], race(0)), b = sideWord(entrants[g.sides[1]], race(1));
  const where = `${t("on {map}", { map: pc.cyan(mapName) })}${dot}${seed}${dot}${clock(e.frame)}`;
  const failed = e.bots.filter((x) => x.state === "crashed" || x.state === "failed");
  const names = failed.map((x) => entrants[g.sides[x.side]].label).join(t(" and "));
  const why = failed.length ? `${dot}${pc.red(failed.some((x) => x.state === "crashed") ? t("{names} crashed", { names }) : t("{names} failed", { names }))}` : "";
  const file = r.replay ? `  ${pc.dim(basename(r.replay))}` : "";
  if (e.by === "desync") return `${at} ${mark.error} ${a} vs ${b} ${where}${dot}${pc.red(t("the copies went out of step at frame {frame}", { frame: num(e.hashes.differedAt ?? e.frame) }))}${why}${file}`;
  if (r.winner === null) return `${at} ${mark.warn} ${e.by === "frames" ? t("{a} and {b} undecided", { a, b }) : t("{a} and {b} drew", { a, b })} ${where}${e.by === "frames" ? pc.dim(` ${t("(the frame limit)")}`) : ""}${why}${file}`;
  const [w, l] = r.winner === g.sides[0] ? [a, b] : [b, a];
  const how = e.by === "left" ? pc.dim(` ${t("(the other left)")}`) : "";
  return `${at} ${mark.ok} ${t("{winner} beat {loser}", { winner: w, loser: l })} ${where}${how}${why}${file}`;
}

/** The standing and the head-to-head as the terminal's lines. */
export function ladderLines(entrants: readonly Entrant[], results: readonly GameResult[]): string[] {
  const table1 = standings(entrants, results);
  const lines = ["", pc.bold(t("Standing")), ...table([
    ["#", "", "Elo", t("Games"), t("Won"), t("Lost"), t("Undecided"), t("Length"), t("ms a frame"), t("Longest"), "> 55 ms"].map((h) => pc.dim(h)),
    ...table1.map((s, i) => [String(i + 1), pc.bold(s.label), String(Math.round(s.elo)), String(s.games), String(s.won), String(s.lost), String(s.undecided), s.games ? clock(s.frames) : "-", s.msPerFrame === null ? pc.dim("-") : s.msPerFrame.toFixed(2), s.maxMs === null ? pc.dim("-") : `${Math.round(s.maxMs)} ms`, s.msPerFrame === null ? pc.dim("-") : String(s.over55)]),
  ], 2)];
  const uncounted = table1.filter((s) => s.uncounted || s.crashed);
  for (const s of uncounted) lines.push(pc.dim(`  ${s.label}: ${[s.crashed ? t("its copy failed in {n, plural, one {# game} other {# games}}", { n: s.crashed }) : "", s.uncounted ? t("{n, plural, one {# game} other {# games}} not counted", { n: s.uncounted }) : ""].filter(Boolean).join(", ")}`));
  const h2h = headToHead(entrants.length, results);
  const order = table1.map((s) => s.entrant);
  if (entrants.length > 2) {
    lines.push("", `${pc.bold(t("Head to head"))} ${pc.dim(t("(the row's wins-losses against the column, then undecided)"))}`, ...table([
      ["", ...order.map((i) => pc.dim(entrants[i].label))],
      ...order.map((i) => [pc.bold(entrants[i].label), ...order.map((j) => { const c = h2h[i][j]; return i === j || !c ? pc.dim("-") : `${c[0]}-${c[1]}${c[2] ? pc.dim(`-${c[2]}`) : ""}`; })]),
    ], 2));
  }
  return lines;
}

/* ── Running it ────────────────────────────────────────────── */

export interface LadderOptions {
  maps: string[];
  /** The file the game is handed for a map, where it is not the map itself (a 1.00 map converted to Brood War). */
  play?: ReadonlyMap<string, string>;
  races?: RaceLetter[];
  seeds?: number[];
  frames?: number;
  /** The folder the replays and the results go in; a `ladder-<date>-<time>` folder here by default. */
  out?: string;
  /** A folder the bots keep their files in between games, one folder a bot; the ladder's own by default. */
  data?: string;
  /** Games at once. */
  parallel?: number;
  /** Seconds a bot may think over one frame before its copy is taken for hung (the runner's default 60; its first frame five minutes at least). */
  timeout?: number;
  starcraft?: string;
  engine?: string;
  /** Each game's line as it ends, and the engine's fetch. */
  live?: (line: string) => void;
  /** What a bot prints, as it comes: `(side label, text)`. */
  text?: (who: string, text: string) => void;
  node?: string;
  /** The time now, for the default folder's name. */
  now?: Date;
  /** A mod laid over every game with its code (`--mod`, `modOverlay(…, { code: true })`). */
  mod?: ModOverlay | null;
  /** The kind of game (`--ums`, `--melee`); the runner's rule without. */
  game?: "melee" | "ums";
  /** Without `game`: the kind of game a map is played as when the command has decided it (`botrun.ts`'s `gameKind`). */
  gameOf?: ReadonlyMap<string, "melee" | "ums">;
}

export interface LadderOutcome {
  out: string;
  engine: { build: string; dir: string; fetched: number };
  game: { folder: string; kind: "remastered" | "classic" };
  entrants: Entrant[];
  results: GameResult[];
  standings: Standing[];
  headToHead: ([number, number, number] | null)[][];
  ms: number;
}

/** `ladder-2026-11-07-1532` in `dir`, with `-2`, `-3` after it when that is taken. */
export function ladderFolder(dir: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const base = join(dir, `ladder-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`);
  let out = base;
  for (let k = 2; existsSync(out); k++) out = `${base}-${k}`;
  return out;
}

/** One game: the runner started on it, its lines read until its end. */
export async function playGame(runner: string, engine: Engine, copy: string, entrants: readonly Entrant[], g: ScheduledGame, o: { out: string; data: string; frames?: number; timeout?: number; node?: string; text?: (who: string, text: string) => void; play?: ReadonlyMap<string, string>; /** `--mod <layer>` and the kind of game, as the runner takes them. */ extra?: string[] }): Promise<GameResult> {
  const replay = join(o.out, g.replay);
  const args = [resolve(o.play?.get(g.map) ?? g.map), "--engine", engine.dir, "--starcraft", copy, "--seed", String(g.seed), "--every", "0", "--replay", replay];
  if (o.frames !== undefined) args.push("--frames", String(o.frames));
  if (o.timeout !== undefined) args.push("--timeout", String(o.timeout));
  if (o.extra) args.push(...o.extra);
  g.sides.forEach((e, k) => {
    const x = entrants[e];
    if (x.kind === "computer") args.push("--computer", RACE_WORD[g.races[k]]);
    else args.push("--bot", `${x.file}|${RACE_WORD[g.races[k]]}|${join(o.data, x.key)}`);
  });
  const child = startRunner(runner, args, { node: o.node });
  let stderr = "";
  child.stderr!.on("data", (d) => { stderr = (stderr + d).slice(-4000); });
  const exit = new Promise<number>((done) => { child.on("error", () => done(2)); child.on("close", (c) => done(c ?? 2)); });
  let end: MatchEnd | null = null, error: string | null = null, start: Extract<MatchLine, { kind: "start" }> | null = null;
  for await (const raw of createInterface({ input: child.stdout! })) {
    let l: MatchLine;
    try { l = JSON.parse(raw) as MatchLine; } catch { continue; }
    if (l.kind === "start") start = l;
    else if (l.kind === "end") end = l;
    else if (l.kind === "error") error = l.message;
    else if (l.kind === "text") o.text?.(entrants[g.sides[l.side]]?.label ?? "?", l.text);
  }
  const code = await exit;
  // (English whatever the language: the error goes into ladder.json, a file.)
  if (!end && !error) error = `the runner stopped without a result (exit ${code})${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" | ")}` : ""}`;
  const winner = end && end.winner !== null ? g.sides[end.winner] ?? null : null;
  return { game: g, end, error: end ? null : error, winner, replay: end?.replay ? replay : null, start };
}

/** The ladder: every game scheduled, played one at a time (or `parallel` at once), then the standing. */
export async function runLadder(entrants: Entrant[], o: LadderOptions): Promise<LadderOutcome> {
  const t0 = performance.now();
  if (!o.maps.length) throw new CliError(t("A ladder needs a map"), t("Name them with --maps: --maps \"(2)Boxer.scm\" \"(4)Lost Temple.scm\"."), 2);
  for (const m of o.maps) if (!existsSync(o.play?.get(m) ?? m)) throw new CliError(t("No file {name}", { name: m }), null, 2);
  const races = o.races ?? ["r"];
  const seeds = o.seeds ?? [1];
  const games = schedule(entrants, o.maps, races, seeds);
  if (!games.length) throw new CliError(t("Nothing to play: no pairing has a bot in it"), null, 2);
  const game = findGameCopy(o.starcraft);
  const say = o.live ?? (() => {});
  const engine = await ensureEngine(o.engine, undefined, say);
  const runner = runnerFor(engine, "match");
  const out = resolve(o.out ?? ladderFolder(process.cwd(), o.now ?? new Date()));
  mkdirSync(out, { recursive: true });
  const data = resolve(o.data ?? join(out, "bwapi-data"));
  // (a mod with its code in every game; the engine asked first, so that an older one is said before the mod is written out)
  const extra: string[] = [];
  if (o.mod) { modArgs(engine, "?", MOD_CODE); extra.push(...modArgs(engine, await o.mod.layers(), MOD_CODE)); }
  if (o.game) extra.push(`--${o.game}`);
  say(`${pc.bold(t("{n, plural, one {# game} other {# games}}", { n: games.length }))}${dot}${entrants.map((e) => e.label).join(", ")}${dot}${t("{n, plural, one {# map} other {# maps}}", { n: o.maps.length })}${dot}${pc.dim(relative(process.cwd(), out) || out)}`);

  const results: GameResult[] = [];
  const parallel = Math.max(1, Math.min(o.parallel ?? 1, games.length));
  let next = 0, told = false;
  const worker = async () => {
    while (next < games.length) {
      const g = games[next++];
      const kind = o.game ? undefined : o.gameOf?.get(g.map);
      const r = await playGame(runner, engine, game.folder, entrants, g, { out, data, frames: o.frames, timeout: o.timeout, node: o.node, text: o.text, play: o.play, extra: kind ? [...extra, `--${kind}`] : extra });
      results.push(r);
      // The mod, once: what the first game read of it, its code, and how each bot fits it.
      if (!told && r.start && (r.start.code || r.start.mod)) { told = true; for (const line of modLines(r.start, entrants, g, o.mod)) say(line); }
      say(gameLine(r, entrants, games.length));
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  results.sort((a, b) => a.game.index - b.game.index);
  const outcome: LadderOutcome = {
    out, engine: { build: engine.build, dir: engine.dir, fetched: engine.fetched }, game, entrants, results,
    standings: standings(entrants, results), headToHead: headToHead(entrants.length, results), ms: performance.now() - t0,
  };
  writeFileSync(join(out, "ladder.json"), JSON.stringify(ladderJson(outcome), null, 2) + "\n");
  return outcome;
}

/** A game's start as the ladder's lines about the mod: what was read of it, its code, each bot's fit. */
function modLines(start: Extract<MatchLine, { kind: "start" }>, entrants: readonly Entrant[], g: ScheduledGame, overlay: ModOverlay | null | undefined): string[] {
  const out: string[] = [];
  if (start.mod) out.push(modWords(overlay ? overlay.report(start.mod) : start.mod));
  if (start.code) out.push(codeWords(start.code, start.game));
  const game = start.code ? { name: start.code.name, hash: start.code.hash } : null;
  for (const f of start.fits ?? []) out.push(fitWords(f.fit, game, entrants[g.sides[f.side]]?.label ?? f.name));
  return out;
}

/** The ladder as data: `--json`, and `ladder.json` beside the replays. */
export function ladderJson(r: LadderOutcome) {
  return {
    out: r.out, engine: r.engine, game: r.game, ms: Math.round(r.ms),
    entrants: r.entrants.map((e) => ({ key: e.key, label: e.label, kind: e.kind, file: e.file ?? null, race: e.race ? RACE_WORD[e.race] : null })),
    standings: r.standings.map((s) => ({ ...s, elo: Math.round(s.elo * 10) / 10, entrant: r.entrants[s.entrant].key })),
    headToHead: Object.fromEntries(r.entrants.map((e, i) => [e.key, Object.fromEntries(r.entrants.flatMap((f, j) => { const c = r.headToHead[i][j]; return c ? [[f.key, { won: c[0], lost: c[1], undecided: c[2] }]] : []; }))])),
    games: r.results.map((x) => ({
      index: x.game.index, map: x.game.map, seed: x.game.seed,
      sides: x.game.sides.map((e, k) => ({ entrant: r.entrants[e].key, race: RACE_WORD[x.game.races[k]], played: x.end?.players.find((p) => p.side === k)?.race ?? null, slot: x.end?.players.find((p) => p.side === k)?.slot ?? null })),
      winner: x.winner === null ? null : r.entrants[x.winner].key, by: x.end?.by ?? null, frames: x.end?.frame ?? null, clock: x.end ? clock(x.end.frame) : null,
      replay: x.replay, error: x.error, bots: x.end?.bots ?? [], hashes: x.end?.hashes ?? null, replayAgreed: x.end?.replay?.agreed ?? null, ms: x.end ? Math.round(x.end.ms.total) : null,
      ...(x.start?.code ? { mod: { name: x.start.code.name, hash: x.start.code.hash, game: x.start.game ?? null, fits: (x.start.fits ?? []).map((f) => ({ entrant: r.entrants[x.game.sides[f.side]]?.key ?? null, fit: f.fit.fit, mod: f.fit.mod })) } } : {}),
    })),
  };
}

/** The end of a ladder as the terminal's lines: the standing, where the replays are, how long it took. */
export function printLadder(r: LadderOutcome): void {
  print(...ladderLines(r.entrants, r.results));
  const played = r.results.filter((x) => x.end).length;
  const at = relative(process.cwd(), r.out) || ".";
  print("", `${mark.info} ${t("{n, plural, one {# replay} other {# replays}} in {folder}", { n: played, folder: pc.cyan(at + "/") })}${dot}${pc.dim(`scmjs replay watch ${at}/<file>`)}${dot}${pc.dim(`${(r.ms / 1000).toFixed(0)} s`)}`);
}
