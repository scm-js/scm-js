/**
 * `scmjs map heatmap <map> <replays…>`: where things happened on a map across many games — deaths, kills, buildings
 * placed, or where armies walked — drawn as heat over the map's picture (map preview's), in the terminal or as a PNG.
 *
 * Each replay is played to its end by the replay runner (`replay watch`'s, scm-sim's `src/exact/runReplay.ts`) with
 * `--events`: a line for each death, building and walking sample instead of a line a step. Only replays played on the
 * map count (the same scenario, else the same name and size; `--force` takes the rest). Replays are independent, so
 * several are played at once, and what each gave is kept in the cache by the replay's hash: a second run with more
 * replays plays only the new ones. The pure half (matching, choosing, the field, the ramp) is heat.ts.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import type { Writable } from "node:stream";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Replay } from "@scm-js/replay";
import { readArchive, type OpenedMap } from "../../src/editor/mapFile";
import { parseScenario, scenarioName, type Scenario } from "../../src/formats/chk/scenario";
import { MEGATILE_PX } from "../../src/formats/tileset/decode";
import { unitName } from "../../src/data/units";
import { GAP_COLOR, GEYSER_LANDMARK, START_LANDMARK } from "./diffpicture";
import { cacheRoot, ensureEngine, findGameCopy, runnerFor, startRunner } from "./engine";
import { writeOutput, type Written } from "./exchange";
import { loadReplayInput, readInput, STDIO, type Input } from "./files";
import { modReplayReason } from "./replaymod";
import { openGameFiles, type GameFiles } from "./gamefiles";
import {
  drawHeat, emptyEvents, EVENTS_VERSION, greyGround, HEAT_WHAT, heatField, heatPoints, matchReplay, rampStrip, SPREAD, takeEvent, tileCounts,
  type GameEvents, type HeatWhat, type MatchKind, type RunnerEventLine,
} from "./heat";
import { asciiShades, halfBlocks, inlineImage, sgr, type Depth } from "./paint";
import { encodePng } from "./png";
import { DEFAULT_PNG_SCALE, drawMarks, loadGraphics, mapPicture, placeMarks, PNG_SCALES, resizePicture, terminalInfo, terminalWidth, terrainPicture, tilesetOf, type GameGraphics, type Mark, type Picture, type TerminalInfo } from "./preview";
import { clock, parseClock } from "./watch";
import { t, translate } from "./i18n";
import { CliError, dot, gameText, mark, num, pc, size } from "./ui";
import type { DataSetRace } from "../../src/formats/mod/races";

/* ── The replays ────────────────────────────────────────────── */

/** The replays a list of paths names: files as given, and the `.rep` files in a folder by name — with `deep`, its sub-folders' too. */
export function replayFiles(paths: readonly string[], deep = false): string[] {
  const out: string[] = [];
  const folder = (p: string): string[] => {
    const entries = readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    return [
      ...entries.filter((e) => !e.isDirectory() && /\.rep$/i.test(e.name)).map((e) => join(p, e.name)),
      ...(deep ? entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).flatMap((e) => folder(join(p, e.name))) : []),
    ];
  };
  for (const p of paths) {
    let isFolder = false;
    try { isFolder = p !== STDIO && statSync(p).isDirectory(); } catch { /* a missing file is said by readInput */ }
    if (isFolder) out.push(...folder(p));
    else out.push(p);
  }
  return out;
}

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A map's scenario as the comparison takes it: the bytes' hash, its name and size. */
export async function mapIdentity(bytes: Uint8Array, scn: Scenario): Promise<{ hash: string; name: string; width: number; height: number }> {
  let chk = bytes;
  try { chk = (await readArchive(bytes)).chk; } catch { /* a bare scenario is its own bytes */ }
  return { hash: sha256(chk), name: scenarioName(scn) ?? "", width: scn.width, height: scn.height };
}

/** The replay's map as the comparison takes it. */
export function replayMapIdentity(rep: Replay): { hash: string; name: string; width: number; height: number } {
  try {
    const scn = parseScenario(rep.chk);
    return { hash: sha256(rep.chk), name: scenarioName(scn) ?? "", width: scn.width, height: scn.height };
  } catch {
    return { hash: sha256(rep.chk), name: rep.header.mapName, width: rep.header.mapWidth, height: rep.header.mapHeight };
  }
}

/* ── The cache ──────────────────────────────────────────────── */

/** Where a replay's events are kept: by the replay's hash, under the cache's `heatmap/v<form>/`. */
export const eventsCachePath = (hash: string, root = cacheRoot()): string => join(root, "heatmap", `v${EVENTS_VERSION}`, `${hash}.json.gz`);

export function readCachedEvents(hash: string, root?: string): GameEvents | null {
  const file = eventsCachePath(hash, root);
  if (!existsSync(file)) return null;
  try { return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as GameEvents; } catch { return null; }
}

export function writeCachedEvents(hash: string, ev: GameEvents, root?: string): number {
  const file = eventsCachePath(hash, root);
  mkdirSync(join(file, ".."), { recursive: true });
  const bytes = gzipSync(JSON.stringify(ev), { level: 6 });
  // Written whole or not at all: a half file would be taken for the replay's events next time.
  writeFileSync(`${file}.part`, bytes);
  renameSync(`${file}.part`, file);
  return bytes.length;
}

/* ── Playing a replay for its events ────────────────────────── */

class OlderRunner extends Error {}

/** One replay played to its end by the runner with `--events`; its lines kept as `GameEvents`. */
export async function playForEvents(runner: string, engineDir: string, starcraft: string, replay: string, node?: string): Promise<GameEvents> {
  const t0 = performance.now();
  const child = startRunner(runner, [resolve(replay), "--events", "--engine", engineDir, "--starcraft", starcraft], { node });
  const exited = new Promise<number>((done) => { child.on("error", () => done(2)); child.on("close", (c) => done(c ?? 2)); });
  let stderr = "";
  child.stderr!.on("data", (d) => { stderr += d; });
  let ev: GameEvents | null = null, error: string | null = null, ended = false, older = false;
  for await (const raw of createInterface({ input: child.stdout! })) {
    let l: { kind: string; [k: string]: unknown };
    try { l = JSON.parse(raw); } catch { continue; }
    if (l.kind === "start") {
      // A runner from before `--events` waits for steps on standard input and says nothing of events.
      if (typeof l.events !== "number") { older = true; child.kill(); break; }
      ev = emptyEvents(l as unknown as Parameters<typeof emptyEvents>[0]);
    } else if (l.kind === "death" || l.kind === "built" || l.kind === "walk") { if (ev) takeEvent(ev, l as unknown as RunnerEventLine); }
    else if (l.kind === "end" && ev) {
      const e = l as unknown as { frame: number; ended: boolean; by: string | null; events?: { unmatched: number } };
      ev.end = { frame: e.frame, ended: e.ended, by: e.by, unmatched: e.events?.unmatched ?? 0, ms: Math.round(performance.now() - t0) };
      ended = true;
    } else if (l.kind === "error") error = String(l.message);
  }
  const code = await exited;
  if (older) throw new OlderRunner();
  if (error) throw new CliError(error);
  if (!ev || !ended) throw new CliError(`${t("the runner stopped without a result (exit {code})", { code })}${stderr.trim() ? `: ${stderr.trim().split("\n").at(-1)}` : ""}`);
  return ev;
}

/* ── The command ────────────────────────────────────────────── */

export interface HeatmapOptions {
  out?: string;
  what?: string;
  player?: string;
  until?: string;
  sideBySide?: boolean;
  scale?: string;
  width?: string;
  blocks?: boolean;
  force?: boolean;
  parallel?: string;
  json?: boolean;
  starcraft?: string;
  engine?: string;
  /** The cache folder (`cacheRoot()` by default). */
  cache?: string;
  node?: string;
}

export interface HeatmapReplay {
  file: string;
  hash: string;
  match: MatchKind;
  players: string[];
  frames: number;
  /** Taken from the cache, not played this time. */
  cached: boolean;
  /** What the filter took from it. */
  count: number;
  ms: number;
}

export interface HeatmapReport {
  file: string;
  name: string;
  size: { width: number; height: number };
  what: HeatWhat;
  player?: string;
  until?: string;
  replays: HeatmapReplay[];
  /** Replays not counted: another map, or one the game could not play. */
  skipped: { file: string; reason: string }[];
  total: number;
  /** Per tile with anything, the busiest first: `[x, y, n]` in tiles. */
  tiles: [number, number, number][];
  /** By unit type, the most first (deaths, kills, buildings). */
  units?: { unit: number; name: string; count: number }[];
  picture?: { form: string; width: number; height: number; scale: number; columns?: number; rows?: number };
  out?: Written;
  engine?: { build: string; fetched: number };
  ms: { replays: number; draw: number; total: number };
}

/** What is counted, with its count. */
function counted(what: HeatWhat, n: number): string {
  switch (what) {
    case "deaths": return t("{n, plural, one {# death} other {# deaths}}", { n });
    case "kills": return t("{n, plural, one {# kill} other {# kills}}", { n });
    case "buildings": return t("{n, plural, one {# building placed} other {# buildings placed}}", { n });
    default: return t("{n, plural, one {# army position} other {# army positions}}", { n });
  }
}
const RACE_LETTER: Record<string, string> = { zerg: "Z", terran: "T", protoss: "P" };

/**
 * A player's race in a replay's line: Z, T or P; a race a data set declares (`races`) by its letter, when it declares
 * one and the runner names the race by its number; else `?`.
 */
export function raceLetter(race: string, races: readonly DataSetRace[] = []): string {
  const game = RACE_LETTER[race];
  if (game) return game;
  const id = /^\D*(\d+)$/.exec(race.trim())?.[1];
  const letter = id === undefined ? undefined : races.find((r) => r.id === Number(id))?.letter;
  return letter ? letter.toUpperCase() : "?";
}

/** Replays played at once: half the processors, four at most, and a game to each GB of memory (one takes about 750 MB). */
export const defaultParallel = (cpus = availableParallelism(), memory = totalmem()): number => Math.max(1, Math.min(4, Math.floor(cpus / 2), Math.floor(memory / 2 ** 30)));

/** The line a replay gets as it is done. */
export function replayLine(k: number, total: number, file: string, ev: GameEvents | null, o: { cached?: boolean; error?: string; what: HeatWhat; count?: number; races?: readonly DataSetRace[] }): string {
  const at = pc.dim(`${String(k).padStart(String(total).length)}/${total}`);
  if (!ev) return `${at} ${mark.error} ${file}: ${o.error ?? t("not played")}`;
  const races = ev.players.map((p) => raceLetter(String(p.race), o.races)).join("");
  const count = o.what === "paths" ? "" : `${dot}${counted(o.what, o.count ?? 0)}`;
  return `${at} ${mark.ok} ${file}  ${pc.dim(races)}${dot}${clock(ev.end.frame || ev.frames)}${count}${dot}${pc.dim(o.cached ? t("cached") : `${(ev.end.ms / 1000).toFixed(1)} s`)}`;
}

/** The busiest tile's words. */
const busiest = (tiles: HeatmapReport["tiles"]) => (tiles.length ? t("the most in one tile: {n}, at {x},{y}", { n: num(tiles[0][2]), x: tiles[0][0], y: tiles[0][1] }) : "");

/** The smallest PNG scale with at least `perTile` pixels a tile. */
const scaleFor = (perTile: number): number => PNG_SCALES.find((s) => s >= perTile) ?? 32;

/** The map's landmarks for the heat picture: resources in grey under the heat, start locations framed in white over it. */
function landmarks(scn: Scenario, graphics: GameGraphics, scale: number, pic: Picture): { under: Mark[]; over: Mark[] } {
  const marks = placeMarks(scn, graphics.units, scale / MEGATILE_PX, pic.width, pic.height);
  return {
    under: marks.filter((m) => m.kind === "mineral" || m.kind === "geyser").map((m) => ({ ...m, color: GEYSER_LANDMARK })),
    over: marks.filter((m) => m.kind === "start").map((m) => ({ ...m, color: START_LANDMARK })),
  };
}

/**
 * The heat over the map: the terrain in grey at a PNG scale (or fitted to `width` pixels), resources under the heat,
 * start locations framed over it. Pure: the map, its graphics and the field in, pixels out.
 */
export function heatPicture(scn: Scenario, graphics: GameGraphics, field: ReturnType<typeof heatField>, o: { scale?: number; width?: number } = {}): { picture: Picture; scale: number; marks: Mark[] } {
  const scale = o.width !== undefined ? scaleFor(o.width / scn.width) : o.scale ?? DEFAULT_PNG_SCALE;
  let picture = terrainPicture(scn, graphics.tileset, scale);
  greyGround(picture);
  const { under, over } = landmarks(scn, graphics, scale, picture);
  drawMarks(picture, under);
  drawHeat(picture, field, scale);
  drawMarks(picture, over);
  let marks = over;
  if (o.width !== undefined) {
    const width = Math.max(1, Math.round(o.width)), height = Math.max(1, Math.round((width * scn.height) / scn.width));
    picture = resizePicture(picture, width, height);
    marks = placeMarks(scn, graphics.units, width / scn.width / MEGATILE_PX, width, height).filter((m) => m.kind === "start").map((m) => ({ ...m, color: START_LANDMARK }));
  }
  return { picture, scale: picture.width / scn.width, marks };
}

/** Two pictures side by side, `gap` pixels of `GAP_COLOR` apart; the marks of each moved to where it is. */
export function besideEachOther(a: { picture: Picture; marks: Mark[] }, b: { picture: Picture; marks: Mark[] }, gap: number): { picture: Picture; marks: Mark[] } {
  const width = a.picture.width + gap + b.picture.width, height = Math.max(a.picture.height, b.picture.height);
  const pixels = new Uint8Array(width * height * 4);
  const g = parseInt(GAP_COLOR.slice(1), 16);
  for (let i = 0; i < width * height; i++) { pixels[i * 4] = (g >> 16) & 255; pixels[i * 4 + 1] = (g >> 8) & 255; pixels[i * 4 + 2] = g & 255; pixels[i * 4 + 3] = 255; }
  const blit = (p: Picture, x: number) => { for (let y = 0; y < p.height; y++) pixels.set(p.pixels.subarray(y * p.width * 4, (y + 1) * p.width * 4), (y * width + x) * 4); };
  blit(a.picture, 0);
  blit(b.picture, a.picture.width + gap);
  const dx = a.picture.width + gap;
  return { picture: { width, height, pixels }, marks: [...a.marks, ...b.marks.map((m) => ({ ...m, x0: m.x0 + dx, x1: m.x1 + dx }))] };
}

/** The ramp under the terminal picture: cool to hot, and what the top means. */
export function heatLegend(depth: Depth, unicode: boolean, words: string): string {
  if (depth === "none") return `  ${pc.dim(`${t("shades: . quiet to @ busiest")}${dot}${words}`)}`;
  const strip = rampStrip(12).map((c) => `\x1b[${sgr(38, c, depth)}m${unicode ? "█" : "#"}`).join("") + "\x1b[39m";
  return `  ${pc.dim(t("fewer"))} ${strip} ${pc.dim(t("more"))}${dot}${words}`;
}

const positive = (value: string | undefined, name: string, check: (n: number) => boolean, hint: string): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !check(n)) throw new CliError(t("--{name} takes {hint}, not \"{value}\"", { name, hint, value }), null, 2);
  return n;
};

/** `--player`: a number 1–8, or a name. */
export function parsePlayer(value: string | undefined): number | string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (n < 1 || n > 8) throw new CliError(t("--player takes a player from 1 to 8, or a name as the replays have it, not \"{value}\"", { value }), null, 2);
    return n;
  }
  if (!v) throw new CliError(t("--player takes a player from 1 to 8, or a name"), null, 2);
  return v;
}

/**
 * The command: the options checked, the replays read and matched to the map, the ones not in the cache played (a few
 * at once), the events chosen and drawn. `live` gets a line as each replay is done (standard error while the PNG goes
 * to standard output; nothing with `--json`).
 */
export async function heatmapMap(
  input: Input, map: OpenedMap, replayPaths: readonly string[], o: HeatmapOptions,
  { term = terminalInfo(), stdout = process.stdout as Writable, live = (_line: string) => {} }: { term?: TerminalInfo; stdout?: Writable; live?: (line: string) => void } = {},
): Promise<{ report: HeatmapReport; lines: string[] }> {
  const t0 = performance.now();
  const scn = map.scenario;
  const what = (o.what ?? "deaths") as HeatWhat;
  if (!(HEAT_WHAT as readonly string[]).includes(what)) throw new CliError(t("--what takes {list}, not \"{value}\"", { list: HEAT_WHAT.join(", "), value: String(o.what) }), null, 2);
  const png = o.out !== undefined;
  if (png && o.width !== undefined) throw new CliError(t("--width is the terminal picture's; a PNG's size is --scale pixels a tile"), null, 2);
  if (o.width !== undefined && o.scale !== undefined) throw new CliError(t("--width or --scale, not both"), null, 2);
  const scale = positive(o.scale, "scale", png ? (n) => (PNG_SCALES as readonly number[]).includes(n) : (n) => n > 0 && n <= 32, png ? PNG_SCALES.join(", ") : t("a number of pixels a tile, above 0 and up to 32"));
  const width = positive(o.width, "width", (n) => Number.isInteger(n) && n >= 8, t("a number of columns, 8 or more"));
  const parallel = positive(o.parallel, "parallel", (n) => Number.isInteger(n) && n >= 1, t("a whole number of replays, 1 or more")) ?? defaultParallel();
  const player = parsePlayer(o.player);
  let until: number | undefined;
  try { until = o.until === undefined ? undefined : parseClock(o.until); } catch { throw new CliError(t("--until takes m:ss (or h:mm:ss), not \"{value}\"", { value: String(o.until) }), null, 2); }
  if (!replayPaths.length) throw new CliError(t("Name the replays to take: files, or folders of them."), null, 2);

  // The replays, read and matched to the map.
  const mine = await mapIdentity(input.bytes, scn);
  const files = replayFiles(replayPaths);
  const skipped: HeatmapReport["skipped"] = [];
  const taken: { file: string; path: string; hash: string; match: MatchKind }[] = [];
  const hashes = new Set<string>();
  for (const path of files) {
    const name = basename(path);
    try {
      const rin = await readInput(path);
      if (rin.kind !== "replay") { skipped.push({ file: name, reason: t("not a replay") }); continue; }
      const hash = sha256(rin.bytes);
      if (hashes.has(hash)) { skipped.push({ file: name, reason: t("the same replay as one before it") }); continue; }
      hashes.add(hash);
      const rep = await loadReplayInput(rin);
      const modded = modReplayReason(rep);
      if (modded) { skipped.push({ file: name, reason: modded }); continue; }
      const m = matchReplay(mine, replayMapIdentity(rep), !!o.force);
      if (!m.match) { skipped.push({ file: name, reason: m.reason }); continue; }
      taken.push({ file: name, path, hash, match: m.match });
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      skipped.push({ file: name, reason: e.message.startsWith("No file ") ? t("no such file") : e.message });
    }
  }
  const mapName = gameText(scenarioName(scn) ?? "") || input.name;
  for (const line of skippedLines(skipped)) live(line);
  if (!taken.length) {
    const what = files.length === 1 ? t("{file} was not played on {map}.", { file: basename(files[0]), map: mapName }) : t("None of the {n, plural, one {# replay} other {# replays}} was played on {map}.", { n: files.length, map: mapName });
    throw new CliError(what, t("A replay counts when its map is this one, or has the same name and size; --force takes them anyway."), 2);
  }

  // The cache first; the rest played, a few at once.
  const cache = o.cache ?? cacheRoot();
  const events: (GameEvents | null)[] = taken.map((r) => readCachedEvents(r.hash, cache));
  const cached = events.map((e) => e !== null);
  const toPlay = taken.map((_, k) => k).filter((k) => !cached[k]);
  const at = Math.max(1, Math.min(parallel, toPlay.length));
  const plan = { cached: num(taken.length - toPlay.length), play: num(toPlay.length), at };
  const playing = !toPlay.length ? t("all cached")
    : toPlay.length === taken.length ? (at > 1 ? t("{play} to play, {at} at a time", plan) : t("{play} to play", plan))
    : at > 1 ? t("{cached} cached, {play} to play, {at} at a time", plan) : t("{cached} cached, {play} to play", plan);
  live(`${pc.bold(mapName)}${dot}${t("{n, plural, one {# replay} other {# replays}} played on it", { n: taken.length })}${dot}${playing}`);
  let engineInfo: HeatmapReport["engine"];
  const errors = new Map<number, string>();
  let done = 0;
  const say = (k: number) => {
    done++;
    const ev = events[k];
    const count = ev ? heatPoints([ev], { what, player, until }).games[0].count : 0;
    live(replayLine(done, taken.length, taken[k].file, ev, { cached: cached[k], error: errors.get(k), what, count }));
  };
  for (let k = 0; k < taken.length; k++) if (cached[k]) say(k);
  const t1 = performance.now();
  if (toPlay.length) {
    const game = findGameCopy(o.starcraft);
    const engine = await ensureEngine(o.engine, undefined, live);
    const runner = runnerFor(engine, "replay");
    engineInfo = { build: engine.build, fetched: engine.fetched };
    let next = 0, older = false;
    const worker = async () => {
      while (next < toPlay.length && !older) {
        const k = toPlay[next++];
        try {
          const ev = await playForEvents(runner, engine.dir, game.folder, taken[k].path, o.node);
          events[k] = ev;
          if (ev.end.ended) writeCachedEvents(taken[k].hash, ev, cache);
        } catch (e) {
          if (e instanceof OlderRunner) { older = true; return; }
          errors.set(k, e instanceof Error ? e.message : String(e));
        }
        say(k);
      }
    };
    await Promise.all(Array.from({ length: at }, worker));
    if (older) throw new CliError(t("The engine at {dir} has a replay runner from before map heatmap.", { dir: engine.dir }), t("A play page deployed since has one; the next run fetches it (or name a newer one with --engine)."));
  }
  const t2 = performance.now();
  for (const [k, reason] of errors) skipped.push({ file: taken[k].file, reason: t("the game could not play it: {reason}", { reason }) });
  if (errors.size) process.exitCode = Math.max(Number(process.exitCode ?? 0), 1);
  const played = taken.map((r, k) => ({ r, ev: events[k], k })).filter((x): x is { r: (typeof taken)[number]; ev: GameEvents; k: number } => x.ev !== null);
  if (!played.length) throw new CliError(t("The game played none of the {n, plural, one {# replay} other {# replays}}.", { n: taken.length }), t("The replay runner is scm-sim's; your own copy of StarCraft and replays the game itself plays are what it needs."));

  // What is counted, where.
  const chosen = heatPoints(played.map((p) => p.ev), { what, player, until });
  if (player !== undefined && !chosen.games.some((g) => g.player)) throw new CliError(typeof player === "number" ? t("No replay has a player {n}.", { n: player }) : t("No replay has a player called \"{name}\".", { name: player }), t("--player takes a player's number (1–8, as the map's slots) or a name as the replays have it."), 2);
  const tiles = tileCounts(chosen.points, scn.width, scn.height);
  const total = tiles.reduce((n, t) => n + t[2], 0);
  const units = what === "paths" ? undefined : [...chosen.units].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([unit, count]) => ({ unit, name: unitName(unit), count }));
  const replays: HeatmapReplay[] = played.map(({ r, ev, k }, i) => ({
    file: r.file, hash: r.hash, match: r.match, players: ev.players.map((p) => p.name), frames: ev.end.frame || ev.frames, cached: cached[k], count: chosen.games[i].count, ms: cached[k] ? 0 : ev.end.ms,
  }));
  const report: HeatmapReport = {
    file: input.path, name: mapName, size: { width: scn.width, height: scn.height }, what,
    ...(player !== undefined ? { player: String(player) } : {}), ...(o.until !== undefined ? { until: clock(until!) } : {}),
    replays, skipped, total, tiles, ...(units ? { units } : {}), ...(engineInfo ? { engine: engineInfo } : {}), ms: { replays: Math.round(t2 - t1), draw: 0, total: 0 },
  };
  const said = { counted: counted(what, total), who: player === undefined ? "" : typeof player === "number" ? t("player {n}", { n: player }) : player, time: until === undefined ? "" : clock(until), n: played.length };
  const words = player === undefined
    ? (until === undefined ? t("{counted} in {n, plural, one {# replay} other {# replays}}", said) : t("{counted} by {time} in {n, plural, one {# replay} other {# replays}}", said))
    : (until === undefined ? t("{counted} ({who}) in {n, plural, one {# replay} other {# replays}}", said) : t("{counted} ({who}) by {time} in {n, plural, one {# replay} other {# replays}}", said));
  const finish = (t3: number) => { report.ms.draw = Math.round(performance.now() - t3); report.ms.total = Math.round(performance.now() - t0); };
  if (o.json && !png) { finish(performance.now()); return { report, lines: [] }; }

  // The picture.
  const t3 = performance.now();
  const gameFiles: GameFiles = await openGameFiles(o.starcraft);
  const graphics = await loadGraphics(scn, gameFiles);
  const field = heatField(chosen.points, scn.width, scn.height, SPREAD[what]);
  const caption = [words, busiest(tiles), mostUnits(units)].filter(Boolean).join(dot);

  if (png) {
    const s = scale ?? DEFAULT_PNG_SCALE;
    let drawn = heatPicture(scn, graphics, field, { scale: s });
    if (o.sideBySide) { const plain = mapPicture(map, graphics, { scale: s }); drawn = { ...besideEachOther({ picture: plain.picture, marks: plain.marks }, drawn, Math.min(32, Math.max(4, 2 * s))), scale: s }; }
    const bytes = encodePng(drawn.picture.pixels, drawn.picture.width, drawn.picture.height);
    const out = await writeOutput(bytes, o.out!, stdout);
    report.picture = { form: "png", width: drawn.picture.width, height: drawn.picture.height, scale: s };
    report.out = out;
    finish(t3);
    return { report, lines: [
      `${mark.ok} ${pc.bold(mapName)}: ${caption}`,
      pc.dim(`  ${drawn.picture.width} × ${drawn.picture.height} PNG${o.sideBySide ? t(", the map beside the heat") : ""}, ${t("{n, plural, one {# pixel} other {# pixels}} a tile", { n: s })}${dot}${t("written to {path}", { path: out.path === STDIO ? t("standard output") : out.path })}${dot}${size(out.bytes)}${dot}${(report.ms.total / 1000).toFixed(1)} s`),
    ] };
  }

  const title = `${pc.bold(mapName)}  ${pc.dim(`${num(scn.width)} × ${num(scn.height)}${dot}${tilesetOf(scn)}${dot}${what}${dot}${gameFiles.label}`)}`;
  const legend = heatLegend(term.unicode ? term.depth : "none", term.unicode, caption);
  const inline = !o.blocks ? term.inline : null;
  if (inline) {
    const columns = width ?? Math.max(8, term.columns - 1);
    const drawn = heatPicture(scn, graphics, field, { scale: scaleFor((columns * 8) / scn.width) });
    report.picture = { form: inline, width: drawn.picture.width, height: drawn.picture.height, scale: drawn.scale, columns };
    finish(t3);
    return { report, lines: [title, inlineImage(encodePng(drawn.picture.pixels, drawn.picture.width, drawn.picture.height), inline, columns), legend] };
  }
  const blocks = term.unicode && term.depth !== "none";
  const paint = (p: { picture: Picture; marks: Mark[] }) => (blocks ? halfBlocks(p.picture, p.marks, term.depth as Exclude<Depth, "none">) : asciiShades(p.picture, p.marks, term.depth));
  let lines: string[];
  let note: string | null = null;
  const half = Math.floor((term.columns - 3) / 2);
  if (o.sideBySide && !width && terminalWidth(scn.width, scn.height, half + 1) >= 32) {
    const cols = terminalWidth(scn.width, scn.height, half + 1);
    const plain = mapPicture(map, graphics, { width: cols });
    const heat = heatPicture(scn, graphics, field, { width: cols });
    const both = besideEachOther({ picture: plain.picture, marks: plain.marks }, heat, 2);
    lines = paint(both);
    report.picture = { form: blocks ? "blocks" : "ascii", width: both.picture.width, height: both.picture.height, scale: Number(heat.scale.toFixed(3)), columns: both.picture.width, rows: lines.length };
  } else {
    if (o.sideBySide) note = pc.dim(`  ${t("(the terminal is too narrow for the map beside the heat: the heat alone)")}`);
    const cols = terminalWidth(scn.width, scn.height, term.columns, { width, scale });
    const heat = heatPicture(scn, graphics, field, { width: cols });
    lines = paint(heat);
    report.picture = { form: blocks ? "blocks" : "ascii", width: heat.picture.width, height: heat.picture.height, scale: Number(heat.scale.toFixed(3)), columns: cols, rows: lines.length };
  }
  finish(t3);
  return { report, lines: o.json ? [] : [title, ...lines, legend, ...(note ? [note] : [])] };
}

/** The three units most counted, for the caption. */
function mostUnits(units: HeatmapReport["units"]): string {
  if (!units?.length) return "";
  // The game's names as the editor shows them, without the race in front.
  return pc.dim(t("most: {list}", { list: units.slice(0, 3).map((u) => `${translate(u.name).replace(/^(Terran|Zerg|Protoss|테란|저그|프로토스) /, "")} ${num(u.count)}`).join(", ") }));
}

/** The replays left out, a line for each reason with the files it holds (three named, then how many more). */
export function skippedLines(skipped: HeatmapReport["skipped"]): string[] {
  const by = new Map<string, string[]>();
  for (const s of skipped) by.set(s.reason, [...(by.get(s.reason) ?? []), s.file]);
  return [...by].map(([reason, names]) => `${mark.warn} ${names.length > 3 ? t("{names} and {n} more", { names: names.slice(0, 3).join(", "), n: num(names.length - 3) }) : names.join(", ")} ${pc.dim(t("left out: {reason}", { reason }))}`);
}
