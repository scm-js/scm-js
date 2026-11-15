/**
 * `scmjs bot run <bot> <map>`: a bot plays a melee game against the game's own computers, with no page and no editor.
 * The bot is a BWAPI bot's `.scmbot`, or a JavaScript bot's module (`.js`, `.mjs`, `.ts`: scm-sim's `BOT_API`, which
 * the runner plays as BWAPI's client). The game is scm-sim's lifted engine, fetched once and kept, and the player's
 * own copy of the game (`engine.ts`); the bot runner is run in a process of its own and speaks JSON lines — start, text, progress, end —
 * which this turns into the terminal's lines.
 *
 * `--mod` lays a mod over the game with its code (overlay version 2, `mod/overlay.ts`): its plugins and FireGraft
 * project run beside the bot, its maps are played with their own settings, and the run says whether the bot was made
 * for the mod (its `.scmbot`'s `mod`, from `scmjs mod header --bot`), plays vanilla data, or was made for another.
 */
import { createInterface } from "node:readline";
import { readdirSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Archive } from "mopaq";
import { openMapBytes } from "../../src/editor/mapFile";
import { looksLikeMpq } from "../../src/formats/mpq/scm";
import { START_LOCATION } from "../../src/data/units";
import { PlayerType } from "../../src/formats/chk/sections/players";
import { isJsBot, kindOf, typeScriptBotProblem } from "./files";
import { debug, plainRunnerError } from "./runnerwords";
import { parseFrames, parseRaceWord, parseWhole, type RaceWord } from "./values";
import { codeWords, ensureEngine, findGameCopy, fitWords, MOD_CODE, modArgs, modWords, runnerFor, startRunner, type BotFitReport, type RunnerCodeReport, type RunnerModReport } from "./engine";
import type { ModOverlay } from "./mod/overlay";
import { t, translate } from "./i18n";
import { CliError, dot, mark, pc, print, size } from "./ui";

// The engine, the cache and the copy of the game are `engine.ts`'s, shared with `scmjs replay watch`; named here still
// for what imports them from here (doctor.ts, the tests).
export { plainRunnerError } from "./runnerwords";
export { cacheRoot, ensureEngine, findGameCopy, gameCopyKind, PLAY_URL, usualGameFolders, type Engine, type EngineCurrent } from "./engine";

/* ── The runner's lines ───────────────────────────────────── */

export interface PlayerLine { slot: number; kind: "bot" | "computer"; race: string; minerals: number; gas: number; supplyUsed: number; supplyAvailable: number; outcome: "victory" | "defeat" | "draw" | null }
export interface StartLine {
  kind: "start"; bot: { name: string; commit: string; memoryPages: number; mod?: { name: string; hash: string; link?: string } }; map: { name: string; width: number; height: number; tileset: string }; copy: string; seed: number; players: PlayerLine[]; ms: { load: number; start: number };
  /** With `--mod`: what the game read of it; its code and name (overlay 2); the kind of game; how the bot fits the mod. */
  mod?: RunnerModReport; code?: RunnerCodeReport; game?: "melee" | "ums"; fit?: BotFitReport;
}
export interface ProgressLine { kind: "progress"; frame: number; units: { visible: number; hidden: number }; players: PlayerLine[]; ms: { game: number; bot: number } }
export interface EndLine extends Omit<ProgressLine, "kind"> { kind: "end"; bot: StartLine["bot"]; seed: number; ended: boolean; outcome: "victory" | "defeat" | "draw" | null; reason: string | null; commandBytes: number; errors: string[]; hash: number; ms: { game: number; bot: number; load: number; start: number; total: number } }
export type RunnerLine = StartLine | { kind: "text"; text: string } | ProgressLine | EndLine | { kind: "error"; message: string };

export interface BotRunOptions {
  race?: string;
  opponents?: string[];
  seed?: number;
  frames?: number;
  every?: number;
  /** A folder the bot keeps its files in between games. */
  data?: string;
  starcraft?: string;
  /** The play page's address, or a folder holding the engine. */
  engine?: string;
  /** Each line as it comes, already worded; absent, nothing is printed as it goes. */
  live?: (line: string) => void;
  /** The `node` to run the runner with. */
  node?: string;
  /** A mod laid over the game with its code (`--mod`, `modOverlay(…, { code: true })`). */
  mod?: ModOverlay | null;
  /** The kind of game (`--ums`, `--melee`); the runner's rule without. */
  game?: "melee" | "ums";
}

export interface BotRunOutcome {
  engine: { build: string; dir: string; fetched: number };
  game: { folder: string; kind: "remastered" | "classic" };
  start: StartLine | null;
  texts: string[];
  progress: ProgressLine[];
  end: EndLine | null;
  /** The runner's exit code: 0 the game ran, 1 the bot printed errors, 2 it could not start. */
  exitCode: number;
  /** The game seated nobody against the bot (the map's own settings): its outcome means nothing. */
  alone?: boolean;
}

/**
 * The kind of game to ask for when `--ums` and `--melee` are not given: a melee game on a melee map when the mod
 * carries no plugins, and the runner's own rule otherwise (the map's own settings for a map that looks made for them,
 * or a mod's plugins). The runner counts a FireGraft project as a reason for the map's own settings even with no edits
 * in it, which on a melee map leaves the bot alone; the guide's rule is the plugins.
 */
export async function gameKind(mapSettings: boolean, mod: ModOverlay | null | undefined): Promise<"melee" | undefined> {
  if (!mod || mapSettings || !mod.plugins) return undefined;
  return (await mod.plugins()) ? undefined : "melee";
}

/**
 * Whether a map looks made for its own settings, as the runners judge it: a computer's slot, or units of a player's
 * other than start locations.
 */
export function looksLikeMapSettings(scn: { playerTypes: number[]; units: { owner: number; unitId: number }[] }): boolean {
  for (let slot = 0; slot < 8; slot++) if (scn.playerTypes[slot] === PlayerType.Computer) return true;
  return scn.units.some((u) => u.owner < 8 && u.unitId !== START_LOCATION);
}

const RACE_LETTER: Record<string, string> = { zerg: "Z", terran: "T", protoss: "P" };
const side = (p: PlayerLine) => `P${p.slot + 1} ${pc.bold(p.kind === "bot" ? t("bot") : t("computer"))} ${RACE_LETTER[p.race] ?? "?"} ${pc.dim(`${p.minerals}/${p.gas}`)} ${p.supplyUsed}/${p.supplyAvailable}`;

/** A runner's line as the terminal's. Null for lines that say nothing to a person. */
export function wordLine(l: RunnerLine): string | null {
  switch (l.kind) {
    case "start": {
      const first = `${t("{bot} on {map}", { bot: pc.bold(l.bot.name), map: pc.cyan(l.map.name) })} ${pc.dim(`${l.map.width} × ${l.map.height}, ${translate(l.map.tileset)}`)}${dot}${l.players.map((p) => `${p.kind === "bot" ? t("bot") : t("computer")} ${p.race}`).join(" vs ")}${dot}${t("seed {seed}", { seed: l.seed })}${dot}${l.copy === "remastered" ? t("Remastered files") : t("1.16.1 files")}`;
      // (with a mod: what the game read of it, its code, and how the bot fits it)
      const mod = [l.mod ? modWords(l.mod) : null, l.code ? codeWords(l.code, l.game) : null, l.fit && (l.code || l.fit.mod) ? fitWords(l.fit, l.code ? { name: l.code.name, hash: l.code.hash } : null) : null];
      return [first, ...mod.filter((x): x is string => !!x)].join("\n");
    }
    case "text": return `  ${pc.dim(l.text)}`;
    case "progress": return `  ${pc.dim(`${t("frame")} ${String(l.frame).padStart(6)}`)}  ${l.players.map(side).join(pc.dim("  |  "))}`;
    case "end": {
      const won = l.outcome === "victory" ? `${mark.ok} ${pc.bold(t("the bot won"))}` : l.outcome === "defeat" ? `${mark.warn} ${pc.bold(t("the bot lost"))}` : l.outcome === "draw" ? `${mark.info} ${t("a draw")}` : `${mark.warn} ${t("no outcome after {n, plural, one {# frame} other {# frames}}", { n: l.frame })}`;
      const frames = Math.max(1, l.frame);
      return `${won}${l.ended ? ` ${t("at frame {frame}", { frame: l.frame })}` : ""}${dot}${t("{size} of orders", { size: size(l.commandBytes) })}${l.errors.length ? `${dot}${pc.red(t("{n, plural, one {# error} other {# errors}}", { n: l.errors.length }))}` : ""}${dot}${t("{game} ms a frame game, {bot} bot", { game: (l.ms.game / frames).toFixed(2), bot: (l.ms.bot / frames).toFixed(2) })}${dot}${(l.ms.total / 1000).toFixed(1)} s`;
    }
    case "error": return `${mark.error} ${l.message}`;
  }
}

/**
 * Run the bot over the map. The engine is fetched when it is not cached; the runner's lines go to `live` as they
 * come and into the outcome. A runner that could not start throws a CliError with its own words.
 */
export async function runBotGame(bot: string, map: string, o: BotRunOptions = {}): Promise<BotRunOutcome> {
  const checked = await checkBotGame(bot, map, { opponents: o.opponents?.length, game: o.game, mod: !!o.mod });
  const kind = o.game ?? await gameKind(checked.mapSettings, o.mod);
  if (kind === "melee" && !o.game) await checkBotGame(bot, map, { opponents: o.opponents?.length, game: kind });
  const game = findGameCopy(o.starcraft);
  const engine = await ensureEngine(o.engine, undefined, o.live ?? (() => {}));
  const args = [resolve(map), resolve(bot), "--engine", engine.dir, "--starcraft", game.folder];
  if (o.race) args.push("--race", o.race);
  if (o.opponents?.length) args.push("--opponents", o.opponents.join(","));
  if (o.seed !== undefined) args.push("--seed", String(o.seed));
  if (o.frames !== undefined) args.push("--frames", String(o.frames));
  if (o.every !== undefined) args.push("--every", String(o.every));
  if (o.data) args.push("--data", resolve(o.data));
  // (the engine is asked first, so that an older one is said before the mod is written out)
  if (o.mod) { modArgs(engine, "?", MOD_CODE); args.push(...modArgs(engine, await o.mod.layers(), MOD_CODE)); }
  if (kind) args.push(`--${kind}`);
  const outcome: BotRunOutcome = { engine: { build: engine.build, dir: engine.dir, fetched: engine.fetched }, game, start: null, texts: [], progress: [], end: null, exitCode: 0 };
  const child = startRunner(runnerFor(engine, "bot"), args, { node: o.node });
  let stderr = "";
  child.stderr!.on("data", (d) => { stderr += d; });
  let error: string | null = null;
  const lines = createInterface({ input: child.stdout! });
  for await (const raw of lines) {
    let l: RunnerLine;
    try { l = JSON.parse(raw) as RunnerLine; } catch { continue; }
    if (l.kind === "start") {
      if (l.mod && o.mod) l.mod = o.mod.report(l.mod);
      outcome.start = l;
      // (a game with the map's own settings may seat nobody against the bot: the game then ends at once, said)
      if (!l.players.some((p) => p.kind !== "bot")) outcome.alone = true;
    }
    else if (l.kind === "text") {
      // (the game names the bot's player "oracle", the engine's word: said as the bot's name)
      l.text = l.text.replace(/\boracle\b/g, outcome.start?.bot.name ?? t("bot"));
      outcome.texts.push(l.text);
    }
    else if (l.kind === "progress") outcome.progress.push(l);
    else if (l.kind === "end") outcome.end = l;
    else if (l.kind === "error") error = l.message;
    const worded = wordLine(l);
    if (worded && l.kind !== "error") o.live?.(worded);
    if (l.kind === "start" && outcome.alone) {
      const warning = `${mark.warn} ${t("Nobody plays against the bot: the map's own settings seat no other player. --melee plays a melee game against --opponents.")}`;
      if (o.live) o.live(warning); else process.stderr.write(`${warning}\n`);
    }
  }
  outcome.exitCode = await new Promise<number>((done) => { child.on("error", () => done(2)); child.on("close", (c) => done(c ?? 2)); });
  // (2 from the runner: the game could not start; anything else, it started and did not go through.)
  const code = outcome.exitCode === 2 ? 2 : 1;
  if (error) { const said = plainRunnerError(error); throw new CliError(said, said.includes("scmjs bot update") ? t("In the bot's folder: scmjs bot update, then scmjs bot build.") : RUNNER_HINT(), code); }
  if (!outcome.end) throw new CliError(`${t("The game did not finish: it stopped without a result.")}${debug() && stderr.trim() ? `\n${stderr.trim().split("\n").slice(-6).join("\n")}` : ""}`, RUNNER_HINT(), code);
  return outcome;
}

/**
 * `bot run`'s options read as values (`values.ts`), each refused with exit 2 before anything starts: the races as the
 * runner's words (`t` or `Terran` alike), a computer for each race named, whole numbers for the seed and progress lines
 * (0: none), frames or a time for `--frames`, and `--data` a folder or nothing there yet.
 */
export async function botRunValues(o: { race: string; opponents: string; seed?: string; frames: string; every: string; data?: string }): Promise<{ race: RaceWord; opponents: RaceWord[]; seed: number | undefined; frames: number; every: number }> {
  const race = parseRaceWord(o.race, "--race");
  const opponents = o.opponents.split(",").map((x) => x.trim()).filter(Boolean).map((x) => parseRaceWord(x, "--opponents"));
  if (!opponents.length) throw new CliError(t("--opponents names no race"), t("A race for each of the game's computers, with commas: --opponents zerg,terran."), 2);
  const seed = o.seed === undefined ? undefined : parseWhole(o.seed, "seed");
  const frames = parseFrames(o.frames, "frames");
  const every = parseWhole(o.every, "every");
  if (o.data) {
    let st = null;
    try { st = await stat(o.data); } catch { /* made by the runner */ }
    if (st && !st.isDirectory()) throw new CliError(t("--data {path} is a file, not a folder.", { path: o.data }), t("--data names a folder the bot keeps its files in."), 2);
  }
  return { race, opponents, seed, frames, every };
}

/**
 * `bot ladder`'s numbers read as values (`values.ts`), each refused with exit 2 before anything starts: `--games`,
 * `--parallel` and `--timeout` whole numbers of 1 or more, each of `--seeds` a whole number, `--frames` frames or a time.
 */
export function ladderValues(o: { games: string; seeds?: string; frames: string; parallel: string; timeout: string }): { seeds: number[]; frames: number; parallel: number; timeout: number } {
  const games = parseWhole(o.games, "games", 1);
  const seeds = o.seeds ? o.seeds.split(",").map((x) => x.trim()).filter(Boolean).map((x) => parseWhole(x, "seeds")) : Array.from({ length: games }, (_, k) => k + 1);
  if (o.seeds !== undefined && !seeds.length) throw new CliError(t("--seeds names no seed"), null, 2);
  return { seeds, frames: parseFrames(o.frames, "frames"), parallel: parseWhole(o.parallel, "parallel", 1), timeout: parseWhole(o.timeout, "timeout", 1) };
}

/** What to do when the game would not play: the files it needs, and how to see the game's own words. */
const RUNNER_HINT = () => t("The game needs a map StarCraft itself opens, a bot scmjs bot build wrote, and your own copy of the game (scmjs doctor checks it). SCMJS_DEBUG=1 shows the game's own words.");

/** The scenario's member in a map's archive. */
const MAP_ARCHIVE_SCENARIO = "staredit\\scenario.chk";

/**
 * The bot and the map, looked at before the game is fetched or started: each the kind of file it must be (said with the
 * command when they are the other way round, a replay or a folder), the map one the game opens (StarCraft 1.16.1 reads
 * no zlib), and room on a melee map for the bot and its opponents. Exit 2 for each.
 */
export async function checkBotGame(bot: string, map: string, o: { opponents?: number; game?: "melee" | "ums"; mod?: boolean } = {}): Promise<{ starts: number; mapSettings: boolean }> {
  const usage = "scmjs bot run <bot> <map>";
  const read = async (path: string) => {
    let st;
    try { st = await stat(path); } catch { return null; }
    if (st.isDirectory()) return "folder" as const;
    return new Uint8Array(await readFile(path));
  };
  const b = await read(bot);
  if (b === null) throw new CliError(t("No file {path}", { path: bot }), t("scmjs bot build writes out/<key>.scmbot in the bot's folder."), 2);
  if (b === "folder") {
    const built = (() => { try { return readdirSync(join(bot, "out")).filter((f) => f.endsWith(".scmbot")).map((f) => join(bot, "out", f)); } catch { return []; } })();
    throw new CliError(built.length === 1 ? t("{folder} is a folder: its built bot is {file}", { folder: bot, file: built[0] }) : t("{folder} is a folder, not a bot", { folder: bot }), built.length === 1 ? `scmjs bot run ${quoteArg(built[0])} ${quoteArg(map)}` : t("scmjs bot build writes out/<key>.scmbot in the bot's folder."), 2);
  }
  // A JavaScript bot's module (BOT_API), played as BWAPI's client: its extension says what it is.
  const ts = typeScriptBotProblem(bot);
  if (ts) throw new CliError(ts, null, 2);
  const bk = isJsBot(bot) ? "bot" : kindOf(bot, b);
  if (bk !== "bot") {
    const m = await read(map);
    if (bk === "map" && m !== null && m !== "folder" && kindOf(map, m) === "bot") throw new CliError(t("{file} is a map, not a bot: the bot comes first.", { file: bot }), usage, 2);
    throw new CliError(t("{file} is not a bot (.scmbot)", { file: bot }), t("scmjs bot build writes out/<key>.scmbot in the bot's folder."), 2);
  }
  const m = await read(map);
  if (m === null) throw new CliError(t("No file {path}", { path: map }), null, 2);
  if (m === "folder") throw new CliError(t("{folder} is a folder, not a map.", { folder: map }), usage, 2);
  const mk = kindOf(map, m);
  if (mk === "replay") throw new CliError(t("{file} is a replay, not a map.", { file: map }), t("scmjs replay map writes the map a replay was played on."), 2);
  if (mk === "bot") throw new CliError(t("{file} is a bot, not a map.", { file: map }), usage, 2);
  let doc;
  try { doc = await openMapBytes(m, basename(map)); } catch (e) {
    throw new CliError(t("{name} is not a map this can read: {reason}", { name: map, reason: e instanceof Error ? e.message : String(e) }), null, 2);
  }
  // (zlib is Remastered's: the game here is 1.16.1's code, whose archive reader has none)
  if (looksLikeMpq(m)) {
    let compression: unknown = null;
    try { compression = Archive.open(m).fileInfo(MAP_ARCHIVE_SCENARIO)?.compression ?? null; } catch { compression = null; }
    if (compression === "zlib" || compression === "bzip2") throw new CliError(t("{file} is compressed with {method}, which only StarCraft: Remastered opens; the game here plays as 1.16.1, which cannot.", { file: map, method: compression }), t("Save a copy with PKWARE compression for it: scmjs map optimize <map> --compression pkware --out <copy>"), 2);
  }
  const starts = doc.scenario.units.filter((u) => u.unitId === START_LOCATION && u.owner < 8).length;
  // (a melee game deals the map's start locations: one for the bot, one for each computer)
  const melee = o.game === "melee" || (!o.game && !o.mod);
  if (melee && o.opponents && starts && o.opponents + 1 > starts) throw new CliError(t("{file} has {n, plural, one {# start location} other {# start locations}}: the bot and {opponents, plural, one {# computer} other {# computers}} do not fit.", { file: map, n: starts, opponents: o.opponents }), t("Name fewer --opponents, or a map with more start locations."), 2);
  return { starts, mapSettings: looksLikeMapSettings(doc.scenario) };
}

/** A path as a shell takes it. */
const quoteArg = (p: string) => (/[\s"'()]/.test(p) ? JSON.stringify(p) : p);

/** Prints the outcome's lines when they were not printed as they came. */
export function printBotRun(r: BotRunOutcome): void {
  if (r.start) print(wordLine(r.start)!);
  for (const text of r.texts) print(wordLine({ kind: "text", text })!);
  for (const p of r.progress) print(wordLine(p)!);
  if (r.end) print(wordLine(r.end)!);
}
