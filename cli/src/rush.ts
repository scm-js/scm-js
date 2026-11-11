/**
 * `scmjs map rush <map>`: how far apart the map's start locations are by ground, measured by the game's own pathing.
 * A unit of one kind (an SCV unless `--unit` names another) is walked by the game from each start location to every
 * other; each walk gives the frames it took, the pixels it covered and how it ended, beside the straight line between
 * the two starts. The game is scm-sim's lifted engine, fetched and found as `engine.ts` says; the walks are the map
 * runner's `--rush` mode (the same runner as `map trace`, one game for all the walks).
 *
 * The runner speaks JSON lines — start, a walk as each ends, end — kept here and laid out as a table of the starts.
 */
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { UNIT_NAMES, unitName } from "../../src/data/units";
import { ensureEngine, findGameCopy, noResultHint, runnerFor, startRunner } from "./engine";
import { removeGameMap } from "./trace";
import { locale, t, translate } from "./i18n";
import { CliError, columns, dot, mark, num, padColumns, pc, table, unicode } from "./ui";

/* ── The runner's lines (scm-sim's src/exact/mapRush.ts, through runMap.ts --rush) ──────── */

/**
 * arrived, stopped (short of the base), stuck, limit (still walking), apart (no ground joins the two), unmoved; and,
 * the command's own, unwalked: the game walked no unit of the kind asked between the two (see `rushReport`).
 */
export type WalkOutcome = "arrived" | "stopped" | "stuck" | "limit" | "apart" | "unmoved" | "unwalked";
export interface RushStartLine { kind: "start"; mode?: "rush"; map: { name: string; width: number; height: number; tileset: string }; copy: string; seed: number; unit: number; starts: { owner: number; x: number; y: number }[]; walks: number; ms: { load: number; start: number } }
export interface RushWalkLine { kind: "walk"; from: number; to: number; unit: number; outcome: WalkOutcome; frames: number; travelled: number; off: number; regions: number; air: number; at: { x: number; y: number }; ms: number }
export interface RushEndLine { kind: "end"; mode?: "rush"; walks: Omit<RushWalkLine, "kind">[]; ms: { load: number; start: number; walk: number; total: number } }
export type RushRunnerLine = RushStartLine | RushWalkLine | RushEndLine | { kind: "error"; message: string } | { kind: "progress" };

/** units.dat's Terran SCV: the unit walked unless another is named. */
export const RUSH_UNIT = 7;
/** Milliseconds a frame at Fastest. */
const FRAME_MS = 42;
/** One way, both ways, and the table's corner; ASCII on the old Windows console (as `ui.ts`'s marks). */
const TO = unicode ? "→" : "->", BOTH = unicode ? "↔" : "<->";
const corner = () => (unicode ? t("from ╲ to") : t("from \\ to"));

export interface RushOptions {
  /** units.dat id of the unit walked (`unitByName`). */
  unit?: number;
  /** Frames a walk may take before it is given up. */
  limit?: number;
  seed?: number;
  starcraft?: string;
  /** The play page's address, or a folder holding the engine. */
  engine?: string;
  /** Each line as it comes, already worded; absent, nothing is printed as it goes. */
  live?: (line: string) => void;
  signal?: AbortSignal;
  node?: string;
}

export interface RushOutcome {
  engine: { build: string; dir: string; fetched: number };
  game: { folder: string; kind: "remastered" | "classic" };
  start: RushStartLine;
  end: RushEndLine;
}

/* ── The unit, by name ──────────────────────────────────────── */

const RACES = /^(terran|zerg|protoss) /;
const fold = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The unit a name means: a units.dat id, the editor's name ("Zerg Zergling"), or the name without its race
 * ("Zergling", "SCV"); failing those, the one name that starts with the words given ("Siege Tank" is two, and says so).
 */
export function unitByName(name: string): number {
  const asked = fold(name);
  if (/^\d+$/.test(asked)) {
    const id = Number(asked);
    if (id >= UNIT_NAMES.length) throw new CliError(t("There is no unit {id}: units.dat's ids run from 0 to {last}.", { id, last: UNIT_NAMES.length - 1 }), null, 2);
    return id;
  }
  const names = UNIT_NAMES.map((n, id) => ({ id, full: fold(n), short: fold(n).replace(RACES, "") }));
  const exact = names.find((n) => n.full === asked || n.short === asked);
  if (exact) return exact.id;
  const starts = names.filter((n) => n.full.startsWith(asked) || n.short.startsWith(asked));
  if (starts.length === 1) return starts[0].id;
  const near = starts.length ? starts : names.filter((n) => n.full.includes(asked));
  const listed = near.slice(0, 6).map((n) => `"${unitName(n.id)}" (${n.id})`).join(", ");
  throw new CliError(!near.length ? t("No unit is called \"{name}\".", { name }) : near.length > 6 ? t("\"{name}\" could be any of {n} units: {list}, …", { name, n: near.length, list: listed }) : t("\"{name}\" could be {list}.", { name, list: listed }), t("Name it as the editor does (Zerg Zergling), without the race (Zergling), or by its units.dat id."), 2);
}

/* ── The run ────────────────────────────────────────────────── */

const cancelled = () => new CliError(t("The run was cancelled: the game was stopped before it finished."), null);

/**
 * Walks the unit between the map's start locations in the game and keeps what the runner said. `map` is the file the
 * game is handed (`trace.ts#gameMap`'s copy for a 1.00 map, deleted once the runner has ended). The engine is fetched
 * when it is not cached.
 */
export async function runRush(map: string, o: RushOptions = {}): Promise<RushOutcome> {
  try { return await rush(map, o); } finally { removeGameMap(map); }
}

async function rush(map: string, o: RushOptions): Promise<RushOutcome> {
  if (!existsSync(map)) throw new CliError(t("No file {name}", { name: map }), null, 2);
  const game = findGameCopy(o.starcraft);
  const engine = await ensureEngine(o.engine, undefined, o.live ?? (() => {}));
  const runner = runnerFor(engine, "map");
  const args = [resolve(map), "--rush", "--engine", engine.dir, "--starcraft", game.folder, "--unit", String(o.unit ?? RUSH_UNIT)];
  if (o.limit !== undefined) args.push("--limit", String(o.limit));
  if (o.seed !== undefined) args.push("--seed", String(o.seed));
  if (o.signal?.aborted) throw cancelled();
  const child = startRunner(runner, args, { node: o.node });
  const exited = new Promise<number>((done) => { child.on("error", () => done(2)); child.on("close", (c) => done(c ?? 2)); });
  const stop = () => { child.kill(); };
  o.signal?.addEventListener("abort", stop, { once: true });
  let stderr = "";
  child.stderr!.on("data", (d) => { stderr += d; });
  let start: RushStartLine | null = null, end: RushEndLine | null = null, error: string | null = null, older = false;
  let pending: RushWalkLine[] = [];
  const said = () => {
    const from = start?.starts.find((s) => s.owner === pending[0]?.from);
    const w = from && start ? walkerOf(pending, start.unit, from) : undefined;
    if (w) o.live?.(wordWalk(w));
    pending = [];
  };
  try {
    for await (const raw of createInterface({ input: child.stdout! })) {
      let l: RushRunnerLine;
      try { l = JSON.parse(raw) as RushRunnerLine; } catch { continue; }
      if (l.kind === "start") {
        // A runner from before `--rush` ignores the flag and runs the triggers: its start has no mode.
        if (l.mode !== "rush") { older = true; child.kill(); break; }
        start = l;
        o.live?.(wordStart(l));
      } else if (l.kind === "walk") {
        // A pair's walks are said once the pair is done: the map's own units may be walked beside the one placed.
        if (pending.length && (pending[0].from !== l.from || pending[0].to !== l.to)) said();
        pending.push(l);
      }
      else if (l.kind === "end") { said(); end = l; }
      else if (l.kind === "error") error = l.message;
    }
  } finally { o.signal?.removeEventListener("abort", stop); }
  const exitCode = await exited;
  if (o.signal?.aborted) throw cancelled();
  if (older) throw new CliError(t("The game engine at {dir} is from before map rush.", { dir: engine.dir }), t("A play page deployed since has one; the next run fetches it (or name a newer one with --engine)."));
  if (error) {
    if (/does not walk/.test(error)) throw new CliError(t("The {unit} does not walk: it is a building, a flyer or a turret.", { unit: unitShown(o.unit ?? RUSH_UNIT) }), t("Name a ground unit with --unit (Zergling, Dragoon, Marine…); a flyer goes in a straight line, which the report gives as the air distance."), 2);
    throw new CliError(error, t("A map StarCraft itself opens, with two start locations, and your own copy of the game are what it needs."));
  }
  if (!start || !end) throw new CliError(`${t("The walks did not finish: the game stopped without a result (exit {code}).", { code: exitCode })}${stderr.trim() ? `\n${stderr.trim().split("\n").slice(-6).join("\n")}` : ""}`, noResultHint(engine.dir));
  return { engine: { build: engine.build, dir: engine.dir, fetched: engine.fetched }, game, start, end };
}

/* ── The report ─────────────────────────────────────────────── */

/** Where a point is on the map as a clock face from the middle: 12 at the top, 6 at the bottom. */
export function clockOf(x: number, y: number, width: number, height: number): number {
  const angle = Math.atan2(x - width * 16, -(y - height * 16));
  const hour = Math.round(((angle / (2 * Math.PI)) * 12 + 12) % 12);
  return hour === 0 ? 12 : hour;
}

export interface RushStart { player: number; x: number; y: number; clock: number }
export interface RushPair {
  /** Players (1–8) of the start walked from and the one walked to. */
  from: number;
  to: number;
  outcome: WalkOutcome;
  /** For an unwalked pair: whether the game walked the map's own units there instead (else it walked nothing). */
  instead?: boolean;
  frames: number;
  /** At Fastest. */
  seconds: number;
  pixels: number;
  tiles: number;
  /** Pixels in a straight line between the two start locations. */
  air: number;
  /** Pixels from the start walked to where the unit stopped. */
  off: number;
}

export interface RushReport {
  file: string;
  unit: { id: number; name: string };
  map: RushStartLine["map"];
  starts: RushStart[];
  /** Every walk, from each start to every other, in the order walked. */
  walks: RushPair[];
  /** `matrix[i][k]`: the walk from `starts[i]` to `starts[k]`; null on the diagonal. */
  matrix: (RushPair | null)[][];
  /** Of the walks that arrived, the shortest way and the longest, in pixels walked (the quicker, for the same). */
  shortest: RushPair | null;
  longest: RushPair | null;
  /** The walks that did not arrive. */
  short: RushPair[];
}

/**
 * The report: a walk for each start to every other. The game is asked to walk one unit of the kind named; where the
 * map places units of its own for the player who walks, the game walks those as well, or instead (a fault of the
 * engine's, not of the map) — only the walks of the unit asked are taken, and a pair it did not walk is `unwalked`.
 */
/**
 * Of the walks between two starts, the one of the unit the game placed: of the kind asked, and of those (a map may
 * place units of that kind for the player too) the one that set out nearest the start walked from.
 */
function walkerOf<W extends Pick<RushWalkLine, "unit" | "at">>(walks: readonly W[], unit: number, from: { x: number; y: number }): W | undefined {
  const near = (w: W) => Math.hypot(w.at.x - from.x, w.at.y - from.y);
  return walks.filter((w) => w.unit === unit).sort((a, b) => near(a) - near(b))[0];
}

export function rushReport(file: string, r: RushOutcome): RushReport {
  const { map } = r.start;
  const starts = r.start.starts.map((s) => ({ player: s.owner + 1, x: s.x, y: s.y, clock: clockOf(s.x, s.y, map.width, map.height) }));
  const pair = (w: Omit<RushWalkLine, "kind">): RushPair => ({
    from: w.from + 1, to: w.to + 1, outcome: w.outcome, frames: w.frames, seconds: secondsOf(w.frames),
    pixels: w.travelled, tiles: Math.round(w.travelled / 32), air: w.air, off: w.off,
  });
  const walks: RushPair[] = [];
  for (const a of starts) for (const b of starts) {
    if (a === b) continue;
    const said = r.end.walks.filter((w) => w.from + 1 === a.player && w.to + 1 === b.player);
    const own = walkerOf(said, r.start.unit, a);
    const air = Math.round(Math.hypot(a.x - b.x, a.y - b.y));
    walks.push(own ? pair(own) : { from: a.player, to: b.player, outcome: "unwalked", instead: said.length > 0, frames: 0, seconds: 0, pixels: 0, tiles: 0, air, off: air });
  }
  const matrix = starts.map((a) => starts.map((b) => (a === b ? null : walks.find((w) => w.from === a.player && w.to === b.player) ?? null)));
  const arrived = walks.filter((w) => w.outcome === "arrived").sort((a, b) => a.pixels - b.pixels || a.frames - b.frames);
  return {
    file, unit: { id: r.start.unit, name: unitName(r.start.unit) }, map, starts, walks, matrix,
    shortest: arrived[0] ?? null, longest: arrived.at(-1) ?? null, short: walks.filter((w) => w.outcome !== "arrived"),
  };
}

/** `map rush --json`: the report, with where the engine and the game came from and the run's times. */
export function rushJson(file: string, r: RushOutcome) {
  return { ...rushReport(file, r), seed: r.start.seed, engine: r.engine, game: r.game, ms: r.end.ms };
}

const seconds = (s: number) => `${s.toFixed(1)} s`;
/** Frames as seconds at Fastest, to a tenth: one rounding for the progress line, the table and the JSON. */
const secondsOf = (frames: number) => Math.round((frames * FRAME_MS) / 100) / 10;
const pixels = (n: number) => `${num(n)} px`;
/** The unit's name without its race, as people say it: "SCV", "Zergling". */
const shortName = (id: number) => unitName(id).replace(RACES_NAMED, "");
const RACES_NAMED = /^(Terran|Zerg|Protoss) /;
/** The name with "a" or "an" before it ("an SCV": the letters are said). */
const withArticle = (name: string) => `${/^([aeiou]|SCV)/i.test(name) ? "an" : "a"} ${name}`;
/** The unit's short name as the editor shows it: in English with its article, in Korean as the editor's name. */
const unitShown = (id: number) => (locale() === "en" ? shortName(id) : translate(unitName(id)).replace(/^(테란|저그|프로토스) /, ""));
const unitWithArticle = (id: number) => (locale() === "en" ? withArticle(shortName(id)) : unitShown(id));

export function wordStart(l: RushStartLine): string {
  return `${pc.bold(l.map.name)} ${pc.dim(`${l.map.width} × ${l.map.height}, ${l.map.tileset}`)}${dot}${t("{n, plural, one {# start location} other {# start locations}}", { n: l.starts.length })}${dot}${t("{unit} walked {n, plural, one {# time} other {# times}}", { unit: unitWithArticle(l.unit), n: l.walks })}${dot}${t("{copy} files", { copy: l.copy === "remastered" ? t("Remastered") : "1.16.1" })}`;
}

/** A walk's outcome, in words. */
function outcomeWord(o: WalkOutcome): string {
  switch (o) {
    case "stopped": return t("stopped");
    case "stuck": return t("stuck");
    case "limit": return t("limit");
    case "apart": return t("apart");
    case "unmoved": return t("unmoved");
    case "unwalked": return t("not walked");
    default: return t("arrived");
  }
}

/** What a walk that did not arrive came to, in words. */
function shortfall(w: RushPair): string {
  switch (w.outcome) {
    case "apart": return t("no ground joins them (an island, or ground walled off)");
    case "stopped": return t("stopped {px} short of the base after {time}: the game found no way all the way", { px: pixels(w.off), time: seconds(w.seconds) });
    case "stuck": return t("stuck {px} from the base after {time}", { px: pixels(w.off), time: seconds(w.seconds) });
    case "limit": return t("still walking after {time}, {px} from the base", { px: pixels(w.off), time: seconds(w.seconds) });
    case "unmoved": return t("the unit never took its order to move");
    case "unwalked": return w.instead ? t("the game walked the map's own units of player {n} there, not the unit asked for", { n: w.from }) : t("the game could not put the unit at start {n} to walk it", { n: w.from });
    default: return t("arrived");
  }
}

export function wordWalk(l: RushWalkLine): string {
  const w = `${l.from + 1} ${TO} ${l.to + 1}`;
  if (l.outcome === "arrived") return `  ${pc.dim(`${w}  ${pixels(l.travelled)}, ${seconds(secondsOf(l.frames))}`)}`;
  return `  ${pc.yellow(`${w}  ${outcomeWord(l.outcome)}`)}`;
}

/** A cell of the table: pixels walked and seconds, the seconds alone, or the pixels alone. */
function cell(w: RushPair | null, show: "both" | "seconds" | "pixels"): string {
  if (!w) return pc.dim("–");
  if (w.outcome === "apart") return pc.yellow(t("no way"));
  if (w.outcome !== "arrived") return pc.yellow(outcomeWord(w.outcome));
  return show === "both" ? `${pixels(w.pixels)}, ${seconds(w.seconds)}` : show === "seconds" ? seconds(w.seconds) : num(w.pixels);
}

/** The starts as rows (from) and columns (to), each cell right-aligned. */
function matrixLines(rep: RushReport, show: "both" | "seconds" | "pixels"): string[] {
  const head = [pc.dim(corner()), ...rep.starts.map((s) => pc.dim(String(s.player)))];
  const body = rep.starts.map((s, i) => [`${s.player} ${pc.dim(t("{clock} o'clock", { clock: s.clock }))}`, ...rep.matrix[i].map((w) => cell(w, show))]);
  const widths = head.map((h, k) => Math.max(columns(h), ...body.map((r) => columns(r[k]))));
  const right = (c: string, k: number) => (k === 0 ? c : " ".repeat(widths[k] - columns(c)) + c);
  return table([head.map(right), ...body.map((r) => r.map(right))], 2);
}

/** The report's lines: the run in one, the table of the starts, the shortest and longest, the walks that did not arrive. */
export function printRush(file: string, r: RushOutcome, { width = process.stdout.columns || 100 } = {}): string[] {
  const rep = rushReport(file, r);
  const n = rep.starts.length, apart = rep.short.filter((w) => w.outcome === "apart");
  const head = `${rep.short.length ? mark.warn : mark.ok} ${pc.bold(file)}: ${t("{unit} walked between {n, plural, one {# start location} other {# start locations}} by the game", { unit: unitWithArticle(rep.unit.id), n })}${dot}${t("{n, plural, one {# walk} other {# walks}}", { n: rep.walks.length })}${dot}${(r.end.ms.total / 1000).toFixed(1)} s`;
  const out = [head];
  // Nothing walked at all: no ground joins the starts, or the game walked nothing; the straight lines are what there is.
  if (!rep.walks.some((w) => w.outcome !== "apart" && w.outcome !== "unwalked")) {
    const unwalked = rep.walks.filter((w) => w.outcome === "unwalked");
    const why = !unwalked.length ? t("No two start locations are joined by ground: an island map.")
      : unwalked.some((w) => w.instead) ? t("The game walked the map's own units, not {unit}: map rush cannot measure this map. map analyze reads its ground without the game.", { unit: unitWithArticle(rep.unit.id) })
      : t("The game could not put {unit} at the start locations to walk it: there may be no ground to walk there. map analyze reads the ground without the game.", { unit: unitWithArticle(rep.unit.id) });
    out.push("", `${mark.warn} ${pc.yellow(why)}`, `  ${pc.dim(t("The straight lines between them:"))}`);
    for (const a of rep.starts) for (const b of rep.starts) if (a.player < b.player) out.push(`  ${a.player} ${BOTH} ${b.player}  ${pixels(Math.round(Math.hypot(a.x - b.x, a.y - b.y)))}`);
    return out;
  }
  const both = matrixLines(rep, "both");
  if (Math.max(...both.map(columns)) <= width) out.push("", ...both);
  else out.push("", pc.dim(`  ${t("Seconds at Fastest")}`), ...matrixLines(rep, "seconds"), "", pc.dim(`  ${t("Pixels walked")}`), ...matrixLines(rep, "pixels"));
  const line = (label: string, w: RushPair) => `  ${padColumns(label, 9)}${w.from} ${TO} ${w.to}: ${pixels(w.pixels)} ${pc.dim(`(${t("{n} tiles", { n: num(w.tiles) })})`)}, ${seconds(w.seconds)}${dot}${pc.dim(t("air {px}, {ratio}× the straight line", { px: pixels(w.air), ratio: (w.pixels / Math.max(1, w.air)).toFixed(2) }))}`;
  if (rep.shortest && rep.longest) {
    out.push("");
    if (rep.shortest === rep.longest) out.push(line(t("Walk"), rep.shortest));
    else out.push(line(t("Shortest"), rep.shortest), line(t("Longest"), rep.longest));
  }
  const others = rep.short.filter((w) => w.outcome !== "apart");
  if (apart.length) {
    const pairs = apart.filter((w) => w.from < w.to || !apart.some((x) => x.from === w.to && x.to === w.from)).map((w) => `${w.from} ${BOTH} ${w.to}`);
    out.push("", `  ${pc.yellow("▸")} ${t("No ground joins {pairs}:", { pairs: pairs.join(", ") })} ${pc.dim(t("an island, or ground walled off — the way there is by air or by drop"))}`);
  }
  for (const w of others) out.push(`  ${pc.yellow("▸")} ${w.outcome === "unwalked" ? t("{walk} not walked:", { walk: `${w.from} ${TO} ${w.to}` }) : t("{walk} did not arrive:", { walk: `${w.from} ${TO} ${w.to}` })} ${pc.dim(shortfall(w))}`);
  return out;
}
