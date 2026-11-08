/**
 * `scmjs map balance <map> --bots a.scmbot[,b.scmbot]`: a melee map maker's report card — is the map fair across its
 * start locations? The same two sides play game after game on the map (a bot against the game's computer, or two
 * bots), each game on scm-sim's match runner as `bot ladder` plays them, and each game's replay is played back by the
 * replay runner for its events (`map heatmap`'s): where each side's workers first walked says which start it was
 * dealt, and the first unit one side lost to the other is the first contact. Per start: games, wins, the win rate
 * against what the two sides' strength predicts, the average length and first contact; beside them the numbers that
 * need no game — the ground distance to the other starts (`map rush`'s walks) and the resources at each main.
 *
 * The game deals the start locations itself (melee), and the match runner has no option to fix them, so the starts are
 * read from each game's replay and the games binned by them; enough games give every start its turns.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { OpenedMap } from "../../src/editor/mapFile";
import { DEFAULT_GAS, DEFAULT_MINERALS, MINERAL_FIELD_IDS, UnitUsed, VESPENE_GEYSER } from "../../src/editor/units";
import { START_LOCATION } from "../../src/data/units";
import { scenarioName } from "../../src/formats/chk/scenario";
import { plainText } from "../../src/editor/textColors";
import { ensureEngine, findGameCopy, runnerFor, type Engine } from "./engine";
import { NOT_A_LOSS, type GameEvents } from "./heat";
import { defaultParallel, playForEvents } from "./heatmap";
import { parseEntrants, playGame, schedule, type Entrant, type GameResult, type RaceLetter, type ScheduledGame } from "./ladder";
import { clockOf, rushReport, runRush, type RushReport } from "./rush";
import { t } from "./i18n";
import { CliError, dot, duration, mark, num, pc, table } from "./ui";

/** A frame at Fastest. */
const FRAME_MS = 42;
/** A resource belongs to a start's main within this many pixels of the start location (12 tiles). */
export const MAIN_RADIUS = 12 * 32;
/** A start's win rate may stray this far from what its sides' strength predicts and still read as balanced. */
export const BALANCED_WITHIN = 0.1;
/** Workers seen within this many pixels of a start location were dealt it (20 tiles). */
const DEALT_RADIUS = 20 * 32;

/* ── What needs no game ────────────────────────────────────── */

export interface StartPlace { player: number; x: number; y: number; clock: number }
export interface MainResources {
  /** Mineral fields and their total, geysers and theirs. */
  fields: number; minerals: number; geysers: number; gas: number;
  /** Average distance in tiles from the start location to its mineral fields, and to its geysers (null with none). */
  fieldTiles: number | null; geyserTiles: number | null;
}

/** The map's start locations, by player (1–8), and where each is as a clock face from the middle. */
export function startPlaces(doc: Pick<OpenedMap, "scenario">): StartPlace[] {
  const scn = doc.scenario;
  return scn.units.filter((u) => u.unitId === START_LOCATION && u.owner < 8).sort((a, b) => a.owner - b.owner)
    .map((u) => ({ player: u.owner + 1, x: u.x, y: u.y, clock: clockOf(u.x, u.y, scn.width, scn.height) }));
}

/** The resources of each start's main: every field and geyser nearest that start and within `MAIN_RADIUS` of it. */
export function mainResources(doc: Pick<OpenedMap, "scenario">, starts: readonly StartPlace[]): MainResources[] {
  const out = starts.map((): MainResources & { fd: number[]; gd: number[] } => ({ fields: 0, minerals: 0, geysers: 0, gas: 0, fieldTiles: null, geyserTiles: null, fd: [], gd: [] }));
  const minerals = new Set<number>(MINERAL_FIELD_IDS);
  for (const u of doc.scenario.units) {
    const mineral = minerals.has(u.unitId);
    if (!mineral && u.unitId !== VESPENE_GEYSER) continue;
    let best = -1, dist = Infinity;
    starts.forEach((s, i) => { const d = Math.hypot(u.x - s.x, u.y - s.y); if (d < dist) { dist = d; best = i; } });
    if (best < 0 || dist > MAIN_RADIUS) continue;
    const amount = u.validStates & UnitUsed.Resources ? u.resourceAmount : mineral ? DEFAULT_MINERALS : DEFAULT_GAS;
    const m = out[best];
    if (mineral) { m.fields++; m.minerals += amount; m.fd.push(dist / 32); } else { m.geysers++; m.gas += amount; m.gd.push(dist / 32); }
  }
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return out.map(({ fd, gd, ...m }) => ({ ...m, fieldTiles: avg(fd), geyserTiles: avg(gd) }));
}

/* ── What a game's events say ──────────────────────────────── */

/**
 * The start a player (slot 0–7) was dealt: the start nearest where its workers first walked (they set out for the
 * minerals at once), else nearest its first building; null when neither is within reach of a start.
 */
export function dealtStart(ev: GameEvents, slot: number, starts: readonly StartPlace[]): number | null {
  const nearest = (x: number, y: number) => {
    let best: number | null = null, dist = DEALT_RADIUS;
    starts.forEach((s, i) => { const d = Math.hypot(x - s.x, y - s.y); if (d <= dist) { dist = d; best = i; } });
    return best;
  };
  for (let at = 0; at < ev.walks.length;) {
    const n = ev.walks[at + 1];
    let sx = 0, sy = 0, k = 0;
    for (let i = 0; i < n; i++) {
      const o = at + 2 + i * 4;
      if (ev.walks[o + 2] === slot) { sx += ev.walks[o]; sy += ev.walks[o + 1]; k++; }
    }
    at += 2 + n * 4;
    if (k) return nearest(sx / k, sy / k);
  }
  for (let at = 0; at < ev.built.length; at += 5) if (ev.built[at + 2] === slot) return nearest(ev.built[at + 3], ev.built[at + 4]);
  return null;
}

/** The first frame a unit of one of `slots` died to another of them (a Scarab or a Nuke going off is no loss). */
export function firstContact(ev: GameEvents, slots: readonly number[]): number | null {
  for (let at = 0; at < ev.deaths.length; at += 6) {
    const [frame, unit, owner, , , by] = ev.deaths.slice(at, at + 6);
    if (NOT_A_LOSS.has(unit) || by < 0 || by === owner) continue;
    if (slots.includes(owner) && slots.includes(by)) return frame;
  }
  return null;
}

/* ── One game ──────────────────────────────────────────────── */

export interface BalanceGame {
  game: ScheduledGame;
  result: GameResult;
  /** Per side (lobby order): the player slot it had in the game and the start it was dealt (an index into the starts). */
  slots: (number | null)[];
  starts: (number | null)[];
  /** The frame of the first unit lost to the other side, or null (none, or the replay could not be played). */
  contact: number | null;
  /** Why the replay could not be read for the starts, when it could not. */
  unread: string | null;
}

/** A game's side → slot and start, and its first contact, from the runner's end and the replay's events. */
export function readGame(game: ScheduledGame, result: GameResult, ev: GameEvents | null, starts: readonly StartPlace[], unread: string | null = null): BalanceGame {
  const slots = [0, 1].map((side) => result.end?.players.find((p) => p.side === side)?.slot ?? null);
  const dealt = slots.map((slot) => (ev && slot !== null ? dealtStart(ev, slot, starts) : null));
  const contact = ev ? firstContact(ev, slots.filter((s): s is number => s !== null)) : null;
  return { game, result, slots, starts: dealt, contact, unread: ev ? null : unread ?? (result.end ? t("no replay") : null) };
}

/* ── The report ────────────────────────────────────────────── */

export interface StartRow extends StartPlace {
  /** Games a side started here: all of them, and those decided. */
  games: number;
  won: number;
  lost: number;
  undecided: number;
  /** Won over decided, or null with none decided. */
  winRate: number | null;
  /** What the sides' own strength predicts for the games started here: the average of each side's share of wins. */
  expected: number | null;
  /** How far chance alone moves the win rate here (95%). */
  margin: number | null;
  /** Average game length and first contact, in frames, over the games started here. */
  frames: number | null;
  contact: number | null;
  /** Average seconds of the walks to the other starts, from `map rush`; null without it. */
  rushSeconds: number | null;
  resources: MainResources;
}

export interface Verdict {
  kind: "balanced" | "unbalanced" | "chance" | "one-sided" | "too-few";
  /** The largest difference between a start's win rate and what was expected, as a share. */
  spread: number | null;
  /** The start that strayed most (index into the starts), when one did. */
  start: number | null;
  text: string;
}

export interface BalanceReport {
  file: string;
  map: { name: string; width: number; height: number };
  sides: { key: string; label: string; kind: "bot" | "computer"; race: string | null; won: number; lost: number; undecided: number }[];
  starts: StartRow[];
  /** How often each pair of starts met (indices into the starts, a < b). */
  pairs: { a: number; b: number; games: number }[];
  games: BalanceGame[];
  verdict: Verdict;
  rush: RushReport | null;
  notes: string[];
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** The rows, the pairs and the verdict from the games played. */
export function balanceReport(file: string, doc: OpenedMap, starts: readonly StartPlace[], entrants: readonly Entrant[], games: readonly BalanceGame[], rush: RushReport | null): BalanceReport {
  const resources = mainResources(doc, starts);
  // Each side's share of the decided games: its strength, whatever start it had.
  const sides = entrants.map((e, i) => {
    let won = 0, lost = 0, undecided = 0;
    for (const g of games) {
      const k = g.game.sides.indexOf(i);
      if (k < 0 || !g.result.end || g.result.end.by === "desync") continue;
      if (g.result.winner === null) undecided++; else if (g.result.winner === i) won++; else lost++;
    }
    return { key: e.key, label: e.label, kind: e.kind, race: e.race, won, lost, undecided };
  });
  const share = sides.map((s) => (s.won + s.lost ? s.won / (s.won + s.lost) : 0.5));

  const rows: StartRow[] = starts.map((s, i) => {
    let won = 0, lost = 0, undecided = 0;
    const expect: number[] = [], frames: number[] = [], contact: number[] = [];
    for (const g of games) {
      if (!g.result.end || g.result.end.by === "desync") continue;
      g.starts.forEach((st, k) => {
        if (st !== i) return;
        const e = g.game.sides[k];
        frames.push(g.result.end!.frame);
        if (g.contact !== null) contact.push(g.contact);
        if (g.result.winner === null) { undecided++; return; }
        if (g.result.winner === e) won++; else lost++;
        expect.push(share[e]);
      });
    }
    const decided = won + lost;
    const variance = expect.reduce((t, p) => t + p * (1 - p), 0);
    const toOthers = rush ? rush.walks.filter((w) => w.from === s.player && w.outcome === "arrived").map((w) => w.seconds) : [];
    return {
      ...s, games: won + lost + undecided, won, lost, undecided,
      winRate: decided ? won / decided : null, expected: decided ? mean(expect) : null, margin: decided ? (1.96 * Math.sqrt(variance)) / decided : null,
      frames: mean(frames), contact: mean(contact), rushSeconds: mean(toOthers), resources: resources[i],
    };
  });

  const pairs: BalanceReport["pairs"] = [];
  for (let a = 0; a < starts.length; a++) for (let b = a + 1; b < starts.length; b++) {
    pairs.push({ a, b, games: games.filter((g) => g.result.end && g.starts.includes(a) && g.starts.includes(b)).length });
  }

  const notes: string[] = [];
  const unread = games.filter((g) => g.result.end && g.starts.some((s) => s === null));
  if (unread.length) {
    notes.push(unread[0].unread
      ? t("{n, plural, one {# game} other {# games}} could not be placed at a start ({why}) and {n, plural, one {is} other {are}} left out of the rows.", { n: unread.length, why: unread[0].unread })
      : t("{n, plural, one {# game} other {# games}} could not be placed at a start and {n, plural, one {is} other {are}} left out of the rows.", { n: unread.length }));
  }
  const never = rows.filter((r) => !r.games).map((r) => r.player);
  if (never.length) notes.push(t("Never dealt: start {list}. The game deals the starts at random; more games (--games) give each its turns.", { list: never.join(", ") }));
  return { file, map: { name: plainText(scenarioName(doc.scenario) ?? file), width: doc.scenario.width, height: doc.scenario.height }, sides, starts: rows, pairs, games: [...games], verdict: verdictOf(rows, sides), rush, notes };
}

/** The line at the end: balanced within N%, a start that wins more and what is different about it, or why no call. */
export function verdictOf(rows: readonly StartRow[], sides: BalanceReport["sides"]): Verdict {
  const counted = rows.map((r, i) => ({ r, i })).filter((x) => x.r.winRate !== null && x.r.expected !== null);
  if (counted.length < 2) return { kind: "too-few", spread: null, start: null, text: t("Too few games were decided to compare the starts: play more (--games) or longer (--frames).") };
  // A side that won (or lost) every game says nothing about the starts; when every side did, no game does.
  const playing = sides.filter((s) => s.won + s.lost > 0);
  if (playing.every((s) => s.won === 0 || s.lost === 0)) {
    const sweep = playing.find((s) => s.lost === 0) ?? playing[0];
    return { kind: "one-sided", spread: null, start: null, text: t("{side} won every decided game: the sides are too far apart for the starts to show. Play two sides of a strength (the same bot twice: --bots a.scmbot,a.scmbot).", { side: sweep.label }) };
  }
  const worst = counted.reduce((a, b) => (Math.abs(b.r.winRate! - b.r.expected!) > Math.abs(a.r.winRate! - a.r.expected!) ? b : a));
  const spread = Math.abs(worst.r.winRate! - worst.r.expected!);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const perStart = Math.round(mean(counted.map((x) => x.r.won + x.r.lost))!);
  if (spread <= BALANCED_WITHIN) return { kind: "balanced", spread, start: null, text: t("Balanced within {spread}: no start's win rate is further than that from what the sides' strength predicts ({n, plural, one {# decided game} other {# decided games}} a start).", { spread: pct(spread), n: perStart }) };
  const r = worst.r;
  const facts = { start: r.player, clock: r.clock, rate: pct(r.winRate!), expected: pct(r.expected!) };
  const said = r.winRate! > r.expected! ? t("Start {start} ({clock} o'clock) wins {rate} where {expected} was expected", facts) : t("Start {start} ({clock} o'clock) wins only {rate} where {expected} was expected", facts);
  if (r.margin !== null && spread <= r.margin) return { kind: "chance", spread, start: worst.i, text: t("{said}, but {n, plural, one {# decided game} other {# decided games}} cannot tell that from chance (±{margin}): play more (--games).", { said, n: r.won + r.lost, margin: pct(r.margin) }) };
  return { kind: "unbalanced", spread, start: worst.i, text: t("{said} — {why}.", { said, why: differs(rows, worst.i, r.winRate! > r.expected!) }) };
}

/**
 * What is different about one start, from the numbers that need no game: the one furthest from the others' average,
 * when it is 10% or more away, said as a fact ("its main has 5,000 gas; the others average 10,000").
 */
export function differs(rows: readonly StartRow[], i: number, favoured: boolean): string {
  const others = rows.filter((_, k) => k !== i);
  const r = rows[i];
  const facts: { off: number; text: string }[] = [];
  const add = (mine: number | null, theirs: (number | null)[], text: (m: string, o: string) => string, fmt: (x: number) => string) => {
    const avg = mean(theirs.filter((x): x is number => x !== null));
    if (mine === null || avg === null || avg === 0) return;
    const off = Math.abs(mine - avg) / avg;
    if (off >= 0.1) facts.push({ off, text: text(fmt(mine), fmt(avg)) });
  };
  const n = (x: number) => num(Math.round(x));
  add(r.resources.gas, others.map((o) => o.resources.gas), (m, o) => t("look at its gas: its main has {m}, the others average {o}", { m, o }), n);
  add(r.resources.minerals, others.map((o) => o.resources.minerals), (m, o) => t("look at its minerals: its main has {m}, the others average {o}", { m, o }), n);
  add(r.resources.fieldTiles, others.map((o) => o.resources.fieldTiles), (m, o) => t("look at its mineral line: {m} tiles from the start, the others {o}", { m, o }), (x) => x.toFixed(1));
  add(r.resources.geyserTiles, others.map((o) => o.resources.geyserTiles), (m, o) => t("look at its geyser: {m} tiles from the start, the others {o}", { m, o }), (x) => x.toFixed(1));
  add(r.rushSeconds, others.map((o) => o.rushSeconds), (m, o) => t("look at its distances: its walks to the other starts average {m}, the others' {o}", { m, o }), (x) => `${x.toFixed(1)} s`);
  add(r.contact, others.map((o) => o.contact), (m, o) => t("its games met the enemy at {m} on average, the others at {o}", { m, o }), (x) => duration(x * FRAME_MS));
  if (!facts.length) {
    return favoured
      ? t("its resources and distances are within 10% of the others', so the difference is in the ground around it or in how the games went")
      : t("its resources and distances are within 10% of the others', so the difference is in the ground or in how the games went");
  }
  return facts.sort((a, b) => b.off - a.off)[0].text;
}

/* ── Running it ────────────────────────────────────────────── */

export interface BalanceOptions {
  /** The bots: one (played against the game's computer) or two; `file:race` fixes a race. */
  bots: string[];
  races?: RaceLetter[];
  seeds?: number[];
  frames?: number;
  parallel?: number;
  timeout?: number;
  /** Keep the replays (and the bots' files) in this folder; a temporary one, removed, by default. */
  out?: string;
  /** Walk the starts with `map rush` too (default on). */
  rush?: boolean;
  starcraft?: string;
  engine?: string;
  /** The file the game is handed when it is not the map itself (a 1.00 map converted to Brood War). */
  play?: string;
  /** The same for the rush's walks (`map rush` deletes its copy when it ends). */
  rushPlay?: string;
  live?: (line: string) => void;
  node?: string;
}

export interface BalanceOutcome {
  report: BalanceReport;
  engine: { build: string; dir: string; fetched: number };
  game: { folder: string; kind: "remastered" | "classic" };
  out: string | null;
  ms: number;
  rushError: string | null;
}

/**
 * The schedule with each game between a bot and itself played once a seed and races: the seed deals the same starts
 * whichever copy is first in the lobby, and the same program then plays nearly the same game (measured with UAlbertaBot:
 * on Crescent Moon all 8 seeds' two orders were the same game to the second; on a generated map one seed's two lasted
 * 9:41 and 9:55, same starts, same winner), so the second would count one game twice and
 * make chance look like a cause.
 */
export function mirrorOnce(games: readonly ScheduledGame[], entrants: readonly Entrant[], read: (file: string) => Uint8Array = (f) => new Uint8Array(readFileSync(f))): ScheduledGame[] {
  const bots = entrants.filter((e) => e.kind === "bot" && e.file);
  const same = bots.length === 2 && Buffer.compare(read(bots[0].file!), read(bots[1].file!)) === 0;
  if (!same) return [...games];
  const seen = new Set<string>();
  return games.filter((g) => { const key = `${g.seed}|${g.races.join("")}`; if (seen.has(key)) return false; seen.add(key); return true; }).map((g, k) => ({ ...g, index: k + 1 }));
}

/** The line a game gets as it ends. */
export function balanceLine(g: BalanceGame, entrants: readonly Entrant[], starts: readonly StartPlace[], total: number): string {
  const at = pc.dim(`${String(g.game.index).padStart(String(total).length)}/${total}`);
  const r = g.result;
  const side = (k: number) => {
    const st = g.starts[k];
    const race = r.end?.players.find((p) => p.side === k)?.race;
    return `${pc.bold(entrants[g.game.sides[k]].label)}${race ? pc.dim(` ${race[0].toUpperCase()}`) : ""} ${pc.dim(st === null ? t("(start ?)") : t("(start {n}, {clock} o'clock)", { n: starts[st].player, clock: starts[st].clock }))}`;
  };
  const seed = t("seed {seed}", { seed: g.game.seed });
  if (!r.end) return `${at} ${mark.error} ${entrants[g.game.sides[0]].label} vs ${entrants[g.game.sides[1]].label}${dot}${seed}: ${r.error ?? t("not played")}`;
  const when = `${duration(r.end.frame * FRAME_MS)}${g.contact !== null ? `${dot}${t("first contact {time}", { time: duration(g.contact * FRAME_MS) })}` : ""}${dot}${seed}`;
  if (r.end.by === "desync") return `${at} ${mark.error} ${side(0)} vs ${side(1)}${dot}${pc.red(t("the copies went out of step"))}`;
  if (r.winner === null) return `${at} ${mark.warn} ${t("{a} and {b} undecided", { a: side(0), b: side(1) })}${dot}${when}`;
  const [w, l] = r.winner === g.game.sides[0] ? [0, 1] : [1, 0];
  return `${at} ${mark.ok} ${t("{winner} beat {loser}", { winner: side(w), loser: side(l) })}${dot}${when}`;
}

/** Every game played (`parallel` at once), each replay read for its starts and first contact, the rush walked. */
export async function runBalance(file: string, mapPath: string, doc: OpenedMap, o: BalanceOptions): Promise<BalanceOutcome> {
  const t0 = performance.now();
  const starts = startPlaces(doc);
  if (starts.length < 2) throw new CliError(starts.length ? t("{file} has one start location: balance compares two or more.", { file }) : t("{file} has no start locations: balance compares two or more.", { file }), t("A melee map places a Start Location for each player."), 2);
  if (!o.bots.length || o.bots.length > 2) throw new CliError(t("--bots names one bot (played against the computer) or two"), t("scmjs map balance map.scx --bots mybot.scmbot   (or --bots a.scmbot,b.scmbot)"), 2);
  const races = o.races ?? ["r"];
  // One bot plays the game's computer (once for each of --races); two bots play each other, both ways round.
  const entrants = parseEntrants(o.bots.length === 1 ? [o.bots[0], "computer"] : o.bots, races);
  const seeds = o.seeds ?? [1, 2, 3, 4, 5, 6, 7, 8];
  const played = o.play ?? mapPath;
  const games = mirrorOnce(schedule(entrants, [played], races, seeds), entrants);
  const say = o.live ?? (() => {});
  const game = findGameCopy(o.starcraft);
  const engine: Engine = await ensureEngine(o.engine, undefined, say);
  const matchRunner = runnerFor(engine, "match"), replayRunner = runnerFor(engine, "replay");

  // The walks between the starts first: a few seconds, and a map the game cannot path on says so before the games.
  let rush: RushReport | null = null, rushError: string | null = null;
  if (o.rush !== false) {
    try { rush = rushReport(file, await runRush(o.rushPlay ?? mapPath, { starcraft: o.starcraft, engine: o.engine, node: o.node })); }
    catch (e) { rushError = e instanceof Error ? e.message : String(e); }
  }

  const keep = !!o.out;
  const out = keep ? resolve(o.out!) : mkdtempSync(join(tmpdir(), "scmjs-balance-"));
  mkdirSync(out, { recursive: true });
  const data = join(out, "bwapi-data");
  say(`${pc.bold(t("{n, plural, one {# game} other {# games}}", { n: games.length }))}${dot}${entrants.map((e) => e.label).join(" vs ")}${dot}${t("{n, plural, one {# start location} other {# start locations}}", { n: starts.length })}${dot}${engine.build}${o.parallel && o.parallel > 1 ? `${dot}${t("{n} at once", { n: o.parallel })}` : ""}`);

  const done: BalanceGame[] = [];
  const parallel = Math.max(1, Math.min(o.parallel ?? defaultParallel(), games.length));
  let next = 0;
  try {
    const worker = async () => {
      while (next < games.length) {
        const g = games[next++];
        const result = await playGame(matchRunner, engine, game.folder, entrants, g, { out, data, frames: o.frames, timeout: o.timeout, node: o.node });
        let ev: GameEvents | null = null, unread: string | null = null;
        if (result.replay) {
          try { ev = await playForEvents(replayRunner, engine.dir, game.folder, result.replay, o.node); }
          catch (e) { unread = e instanceof Error && e.message ? e.message : t("the replay runner is from before map heatmap"); }
        }
        const b = readGame(g, result, ev, starts, unread);
        done.push(b);
        say(balanceLine(b, entrants, starts, games.length));
      }
    };
    await Promise.all(Array.from({ length: parallel }, worker));
  } finally {
    if (!keep) rmSync(out, { recursive: true, force: true });
  }
  done.sort((a, b) => a.game.index - b.game.index);
  return {
    report: balanceReport(file, doc, starts, entrants, done, rush),
    engine: { build: engine.build, dir: engine.dir, fetched: engine.fetched }, game, out: keep ? out : null, ms: performance.now() - t0, rushError,
  };
}

/* ── Words ─────────────────────────────────────────────────── */

const pct = (x: number | null) => (x === null ? pc.dim("-") : `${Math.round(x * 100)}%`);
const clockOrDash = (frames: number | null) => (frames === null ? pc.dim("-") : duration(frames * FRAME_MS));

/** The report as the terminal's lines: a row a start, the pairs that met, the verdict and the notes. */
export function printBalance(r: BalanceOutcome): string[] {
  const rep = r.report;
  const decided = rep.games.filter((g) => g.result.end && g.result.end.by !== "desync").length;
  const out = [
    `${pc.bold(rep.file)} ${pc.dim(`${rep.map.width} × ${rep.map.height}`)}${dot}${t("{n, plural, one {# game} other {# games}} played", { n: decided })}${dot}${rep.sides.map((s) => `${s.label} ${pc.dim(`${s.won}-${s.lost}${s.undecided ? `-${s.undecided}` : ""}`)}`).join(" vs ")}${dot}${pc.dim(`${(r.ms / 1000).toFixed(0)} s`)}`,
    "",
  ];
  const res = (m: MainResources) => `${m.fields} × ${num(m.fields ? Math.round(m.minerals / m.fields) : 0)}${m.fieldTiles !== null ? pc.dim(` · ${m.fieldTiles.toFixed(1)} t`) : ""}`;
  const gas = (m: MainResources) => (m.geysers ? `${m.geysers} × ${num(Math.round(m.gas / m.geysers))}${m.geyserTiles !== null ? pc.dim(` · ${m.geyserTiles.toFixed(1)} t`) : ""}` : pc.dim(t("none")));
  out.push(...table([
    [t("Start"), "", t("Games"), t("Won"), t("Lost"), t("Win rate"), t("Expected"), t("Length"), t("Contact"), t("Rush"), t("Minerals"), t("Gas")].map((h) => pc.dim(h)),
    ...rep.starts.map((s, i) => [
      pc.bold(String(s.player)), pc.dim(t("{clock} o'clock", { clock: s.clock })), String(s.games), String(s.won), String(s.lost), pct(s.winRate), pct(s.expected),
      clockOrDash(s.frames), clockOrDash(s.contact), s.rushSeconds === null ? pc.dim("-") : `${s.rushSeconds.toFixed(1)} s`, res(s.resources), gas(s.resources),
    ].map((c, k) => (rep.verdict.start === i && k === 5 ? pc.yellow(c) : c))),
  ], 2));
  out.push(...t(`Expected: what the two sides' own records predict for the games started there. Contact: the first unit lost to
the other side. Rush: the average walk to the other starts (map rush). t: tiles from the start location.`).split("\n").map((l) => pc.dim(`  ${l}`)));
  const met = rep.pairs.filter((p) => p.games).map((p) => `${rep.starts[p.a].player}–${rep.starts[p.b].player} ×${p.games}`);
  const unmet = rep.pairs.filter((p) => !p.games).map((p) => `${rep.starts[p.a].player}–${rep.starts[p.b].player}`);
  if (rep.starts.length > 2) out.push("", `  ${pc.dim(t("Pairs met:"))} ${met.join(", ") || t("none")}${unmet.length ? `${dot}${pc.dim(t("never:"))} ${unmet.join(", ")}` : ""}`);
  const v = rep.verdict;
  out.push("", `${v.kind === "balanced" ? mark.ok : v.kind === "unbalanced" ? mark.warn : mark.info} ${v.text}`);
  for (const n of rep.notes) out.push(pc.dim(`  ${n}`));
  out.push(pc.dim(`  ${t("The game deals the start locations; each game's are read from its replay (the match runner has no option to fix them).")}`));
  if (r.rushError) out.push(pc.dim(`  ${t("The walks between the starts could not be measured: {error}", { error: r.rushError })}`));
  if (r.out) out.push(`${mark.info} ${t("Replays in {folder}", { folder: pc.cyan(r.out) })}`);
  return out;
}

/** `--json`: the report, the games without their runner lines, where the engine and the game came from. */
export function balanceJson(r: BalanceOutcome) {
  const rep = r.report;
  return {
    file: rep.file, map: rep.map, sides: rep.sides,
    starts: rep.starts,
    pairs: rep.pairs.map((p) => ({ a: rep.starts[p.a].player, b: rep.starts[p.b].player, games: p.games })),
    verdict: { ...rep.verdict, start: rep.verdict.start === null ? null : rep.starts[rep.verdict.start].player },
    games: rep.games.map((g) => ({
      index: g.game.index, seed: g.game.seed,
      sides: g.game.sides.map((e, k) => ({ entrant: rep.sides[e].key, race: g.result.end?.players.find((p) => p.side === k)?.race ?? null, slot: g.slots[k], start: g.starts[k] === null ? null : rep.starts[g.starts[k]!].player })),
      winner: g.result.winner === null ? null : rep.sides[g.result.winner].key, by: g.result.end?.by ?? null, frames: g.result.end?.frame ?? null,
      contact: g.contact, replay: r.out ? g.result.replay : null, error: g.result.error, unread: g.unread,
    })),
    rush: rep.rush ? { unit: rep.rush.unit, walks: rep.rush.walks } : null, rushError: r.rushError,
    notes: rep.notes, out: r.out, engine: r.engine, game: r.game, ms: Math.round(r.ms),
  };
}
