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
import { ensureEngine, findGameCopy, runnerFor, startRunner } from "./engine";
import { removeGameMap } from "./trace";
import { CliError, columns, dot, mark, num, pc, plural, table, unicode } from "./ui";

/* ── The runner's lines (scm-sim's src/exact/mapRush.ts, through runMap.ts --rush) ──────── */

/** arrived, stopped (short of the base), stuck, limit (still walking), apart (no ground joins the two), unmoved. */
export type WalkOutcome = "arrived" | "stopped" | "stuck" | "limit" | "apart" | "unmoved";
export interface RushStartLine { kind: "start"; mode?: "rush"; map: { name: string; width: number; height: number; tileset: string }; copy: string; seed: number; unit: number; starts: { owner: number; x: number; y: number }[]; walks: number; ms: { load: number; start: number } }
export interface RushWalkLine { kind: "walk"; from: number; to: number; unit: number; outcome: WalkOutcome; frames: number; travelled: number; off: number; regions: number; air: number; at: { x: number; y: number }; ms: number }
export interface RushEndLine { kind: "end"; mode?: "rush"; walks: Omit<RushWalkLine, "kind">[]; ms: { load: number; start: number; walk: number; total: number } }
export type RushRunnerLine = RushStartLine | RushWalkLine | RushEndLine | { kind: "error"; message: string } | { kind: "progress" };

/** units.dat's Terran SCV: the unit walked unless another is named. */
export const RUSH_UNIT = 7;
/** Milliseconds a frame at Fastest. */
const FRAME_MS = 42;
/** One way, both ways, and the table's corner; ASCII on the old Windows console (as `ui.ts`'s marks). */
const TO = unicode ? "→" : "->", BOTH = unicode ? "↔" : "<->", CORNER = unicode ? "from ╲ to" : "from \\ to";

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
    if (id >= UNIT_NAMES.length) throw new CliError(`There is no unit ${id}: units.dat's ids run from 0 to ${UNIT_NAMES.length - 1}.`, null, 2);
    return id;
  }
  const names = UNIT_NAMES.map((n, id) => ({ id, full: fold(n), short: fold(n).replace(RACES, "") }));
  const exact = names.find((n) => n.full === asked || n.short === asked);
  if (exact) return exact.id;
  const starts = names.filter((n) => n.full.startsWith(asked) || n.short.startsWith(asked));
  if (starts.length === 1) return starts[0].id;
  const near = starts.length ? starts : names.filter((n) => n.full.includes(asked));
  const listed = near.slice(0, 6).map((n) => `"${unitName(n.id)}" (${n.id})`).join(", ");
  throw new CliError(near.length ? `"${name}" could be ${near.length > 6 ? `any of ${near.length} units: ${listed}, …` : listed}.` : `No unit is called "${name}".`, "Name it as the editor does (Zerg Zergling), without the race (Zergling), or by its units.dat id.", 2);
}

/* ── The run ────────────────────────────────────────────────── */

const cancelled = () => new CliError("The run was cancelled: the game was stopped before it finished.", null);

/**
 * Walks the unit between the map's start locations in the game and keeps what the runner said. `map` is the file the
 * game is handed (`trace.ts#gameMap`'s copy for a 1.00 map, deleted once the runner has ended). The engine is fetched
 * when it is not cached.
 */
export async function runRush(map: string, o: RushOptions = {}): Promise<RushOutcome> {
  try { return await rush(map, o); } finally { removeGameMap(map); }
}

async function rush(map: string, o: RushOptions): Promise<RushOutcome> {
  if (!existsSync(map)) throw new CliError(`No file ${map}`, null, 2);
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
  try {
    for await (const raw of createInterface({ input: child.stdout! })) {
      let l: RushRunnerLine;
      try { l = JSON.parse(raw) as RushRunnerLine; } catch { continue; }
      if (l.kind === "start") {
        // A runner from before `--rush` ignores the flag and runs the triggers: its start has no mode.
        if (l.mode !== "rush") { older = true; child.kill(); break; }
        start = l;
        o.live?.(wordStart(l));
      } else if (l.kind === "walk") o.live?.(wordWalk(l));
      else if (l.kind === "end") end = l;
      else if (l.kind === "error") error = l.message;
    }
  } finally { o.signal?.removeEventListener("abort", stop); }
  const exitCode = await exited;
  if (o.signal?.aborted) throw cancelled();
  if (older) throw new CliError(`The engine at ${engine.dir} has a map runner from before map rush.`, "A play page deployed since has one; the next run fetches it (or name a newer one with --engine).");
  if (error) {
    if (/does not walk/.test(error)) throw new CliError(`The ${shortName(o.unit ?? RUSH_UNIT)} does not walk: it is a building, a flyer or a turret.`, "Name a ground unit with --unit (Zergling, Dragoon, Marine…); a flyer goes in a straight line, which the report gives as the air distance.", 2);
    throw new CliError(error, "The runner is scm-sim's; a map StarCraft itself opens, with two start locations, and your own copy of the game are what it needs.");
  }
  if (!start || !end) throw new CliError(`The walks did not finish: the runner stopped without a result (exit ${exitCode}).${stderr.trim() ? `\n${stderr.trim().split("\n").slice(-6).join("\n")}` : ""}`);
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
  /** Of the walks that arrived, the quickest and the slowest. */
  shortest: RushPair | null;
  longest: RushPair | null;
  /** The walks that did not arrive. */
  short: RushPair[];
}

export function rushReport(file: string, r: RushOutcome): RushReport {
  const { map } = r.start;
  const starts = r.start.starts.map((s) => ({ player: s.owner + 1, x: s.x, y: s.y, clock: clockOf(s.x, s.y, map.width, map.height) }));
  const walks: RushPair[] = r.end.walks.map((w) => ({
    from: w.from + 1, to: w.to + 1, outcome: w.outcome, frames: w.frames, seconds: Math.round((w.frames * FRAME_MS) / 100) / 10,
    pixels: w.travelled, tiles: Math.round(w.travelled / 32), air: w.air, off: w.off,
  }));
  const matrix = starts.map((a) => starts.map((b) => (a === b ? null : walks.find((w) => w.from === a.player && w.to === b.player) ?? null)));
  const arrived = walks.filter((w) => w.outcome === "arrived").sort((a, b) => a.frames - b.frames || a.pixels - b.pixels);
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
const pixels = (n: number) => `${num(n)} px`;
/** The unit's name without its race, as people say it: "SCV", "Zergling". */
const shortName = (id: number) => unitName(id).replace(RACES_NAMED, "");
const RACES_NAMED = /^(Terran|Zerg|Protoss) /;
/** The name with "a" or "an" before it ("an SCV": the letters are said). */
const withArticle = (name: string) => `${/^([aeiou]|SCV)/i.test(name) ? "an" : "a"} ${name}`;

export function wordStart(l: RushStartLine): string {
  return `${pc.bold(l.map.name)} ${pc.dim(`${l.map.width} × ${l.map.height}, ${l.map.tileset}`)}${dot}${plural(l.starts.length, "start location")}${dot}${withArticle(shortName(l.unit))} walked ${plural(l.walks, "time")}${dot}${l.copy === "remastered" ? "Remastered" : "1.16.1"} files`;
}

/** What a walk that did not arrive came to, in words. */
function shortfall(w: RushPair): string {
  switch (w.outcome) {
    case "apart": return "no ground joins them (an island, or ground walled off)";
    case "stopped": return `stopped ${pixels(w.off)} short of the base after ${seconds(w.seconds)}: the game found no way all the way`;
    case "stuck": return `stuck ${pixels(w.off)} from the base after ${seconds(w.seconds)}`;
    case "limit": return `still walking after ${seconds(w.seconds)}, ${pixels(w.off)} from the base`;
    case "unmoved": return "the unit never took its order to move";
    default: return "arrived";
  }
}

export function wordWalk(l: RushWalkLine): string {
  const w = `${l.from + 1} ${TO} ${l.to + 1}`;
  if (l.outcome === "arrived") return `  ${pc.dim(`${w}  ${pixels(l.travelled)}, ${seconds((l.frames * FRAME_MS) / 1000)}`)}`;
  return `  ${pc.yellow(`${w}  ${l.outcome}`)}`;
}

/** A cell of the table: pixels walked and seconds, the seconds alone, or the pixels alone. */
function cell(w: RushPair | null, show: "both" | "seconds" | "pixels"): string {
  if (!w) return pc.dim("–");
  if (w.outcome === "apart") return pc.yellow("no way");
  if (w.outcome !== "arrived") return pc.yellow(w.outcome);
  return show === "both" ? `${pixels(w.pixels)}, ${seconds(w.seconds)}` : show === "seconds" ? seconds(w.seconds) : num(w.pixels);
}

/** The starts as rows (from) and columns (to), each cell right-aligned. */
function matrixLines(rep: RushReport, show: "both" | "seconds" | "pixels"): string[] {
  const head = [pc.dim(CORNER), ...rep.starts.map((s) => pc.dim(String(s.player)))];
  const body = rep.starts.map((s, i) => [`${s.player} ${pc.dim(`${s.clock} o'clock`)}`, ...rep.matrix[i].map((w) => cell(w, show))]);
  const widths = head.map((h, k) => Math.max(columns(h), ...body.map((r) => columns(r[k]))));
  const right = (c: string, k: number) => (k === 0 ? c : " ".repeat(widths[k] - columns(c)) + c);
  return table([head.map(right), ...body.map((r) => r.map(right))], 2);
}

/** The report's lines: the run in one, the table of the starts, the shortest and longest, the walks that did not arrive. */
export function printRush(file: string, r: RushOutcome, { width = process.stdout.columns || 100 } = {}): string[] {
  const rep = rushReport(file, r);
  const n = rep.starts.length, apart = rep.short.filter((w) => w.outcome === "apart");
  const head = `${rep.short.length ? mark.warn : mark.ok} ${pc.bold(file)}: ${withArticle(shortName(rep.unit.id))} walked between ${plural(n, "start location")} by the game${dot}${plural(rep.walks.length, "walk")}${dot}${(r.end.ms.total / 1000).toFixed(1)} s`;
  const out = [head];
  if (apart.length === rep.walks.length) {
    out.push("", `  ${pc.yellow("No two start locations are joined by ground: an island map.")} ${pc.dim("The straight lines between them:")}`);
    for (const w of rep.walks.filter((x) => x.from < x.to)) out.push(`  ${w.from} ${BOTH} ${w.to}  ${pixels(w.air)}`);
    return out;
  }
  const both = matrixLines(rep, "both");
  if (Math.max(...both.map(columns)) <= width) out.push("", ...both);
  else out.push("", pc.dim("  Seconds at Fastest"), ...matrixLines(rep, "seconds"), "", pc.dim("  Pixels walked"), ...matrixLines(rep, "pixels"));
  const line = (label: string, w: RushPair) => `  ${label.padEnd(9)}${w.from} ${TO} ${w.to}: ${pixels(w.pixels)} ${pc.dim(`(${num(w.tiles)} tiles)`)}, ${seconds(w.seconds)}${dot}${pc.dim(`air ${pixels(w.air)}, ${(w.pixels / Math.max(1, w.air)).toFixed(2)}× the straight line`)}`;
  if (rep.shortest && rep.longest) {
    out.push("");
    if (rep.shortest === rep.longest) out.push(line("Walk", rep.shortest));
    else out.push(line("Shortest", rep.shortest), line("Longest", rep.longest));
  }
  const others = rep.short.filter((w) => w.outcome !== "apart");
  if (apart.length) {
    const pairs = apart.filter((w) => w.from < w.to || !apart.some((x) => x.from === w.to && x.to === w.from)).map((w) => `${w.from} ${BOTH} ${w.to}`);
    out.push("", `  ${pc.yellow("▸")} No ground joins ${pairs.join(", ")}: ${pc.dim("an island, or ground walled off — the way there is by air or by drop")}`);
  }
  for (const w of others) out.push(`  ${pc.yellow("▸")} ${w.from} ${TO} ${w.to} did not arrive: ${pc.dim(shortfall(w))}`);
  return out;
}
