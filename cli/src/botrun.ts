/**
 * `scmjs bot run <bot.scmbot> <map>`: a BWAPI bot plays a melee game against the game's own computers, with no page
 * and no editor. The game is scm-sim's lifted engine, the one the play page runs; its files (the module, the base
 * image, the interface pack) and the runner that drives a game from a terminal are fetched once from the play
 * page's address — `play/engine/current.json` names the current build and runner — and kept under the user's cache
 * folder. The game's own files come from the player's installation of StarCraft, Remastered or 1.16.1, found in the
 * usual places or named with `--starcraft`; nothing of the game is fetched or carried.
 *
 * The runner is run in a process of its own (one game a process: the lifted game takes its memory when its module is
 * first imported) and speaks JSON lines — start, text, progress, end — which this turns into the terminal's lines.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { CliError, dot, mark, pc, plural, print, size } from "./ui";

/** Where the play page is, and so where the engine's files are (`SCMJS_PLAY_URL` for another). */
export const PLAY_URL = "https://scmjs.dev/play";

/** What `play/engine/current.json` says (scm-sim's `scripts/deploy-play.mjs` writes it). */
export interface EngineCurrent {
  build: string;
  files: string[];
  runner: string;
  runnerBytes?: number;
}

/** The user's cache folder for scmjs: XDG's, Windows's local app data, else `~/.cache`. */
export function cacheRoot(env = process.env, home = homedir()): string {
  if (env.SCMJS_CACHE) return env.SCMJS_CACHE;
  if (env.XDG_CACHE_HOME) return join(env.XDG_CACHE_HOME, "scmjs");
  if (process.platform === "win32" && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, "scmjs", "cache");
  return join(home, ".cache", "scmjs");
}

/** `.gz` bytes, or bytes a server sent compressed without saying so, made plain. */
const plain = (bytes: Uint8Array): Uint8Array => (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? new Uint8Array(gunzipSync(bytes)) : bytes);

async function fetchBytes(url: string): Promise<Uint8Array> {
  let r: Response;
  try {
    r = await fetch(url);
  } catch (e) {
    throw new CliError(`${url} could not be fetched (${e instanceof Error ? e.message : e}).`, "The engine comes from the play page once; connect, or name a folder that has it with --engine.");
  }
  if (!r.ok) throw new CliError(`${url} answered ${r.status}.`, "The engine comes from the play page once; name a folder that has it with --engine if the page is down.");
  return plain(new Uint8Array(await r.arrayBuffer()));
}

export interface Engine {
  /** The folder holding core.js, game.js, base-s1.bin, interface.bin and the runner. */
  dir: string;
  build: string;
  /** The runner's file in `dir`. */
  runner: string;
  /** Bytes fetched this time; 0 when everything was cached. */
  fetched: number;
}

/**
 * The engine's folder: `at` is a folder that already holds the files (a staged deploy, a clone's `data/lifted` with a
 * runner beside), else the play page's address, whose `engine/current.json` names the build to fetch into the cache.
 */
export async function ensureEngine(at: string = process.env.SCMJS_PLAY_URL || PLAY_URL, cache = cacheRoot(), say: (line: string) => void = () => {}): Promise<Engine> {
  if (!/^https?:\/\//.test(at)) {
    const dir = resolve(at);
    const current = join(dir, "current.json");
    if (existsSync(current)) {
      const c = JSON.parse(readFileSync(current, "utf8")) as EngineCurrent;
      const sub = existsSync(join(dir, c.build)) ? join(dir, c.build) : dir;
      return { dir: sub, build: c.build, runner: c.runner, fetched: 0 };
    }
    const runner = existsSync(dir) ? (readdirSafe(dir).find((f) => /^run(-[0-9a-f]+)?\.mjs$/.test(f)) ?? null) : null;
    if (!runner) throw new CliError(`${at} holds no engine: no current.json and no run-<hash>.mjs beside the engine's files.`, "Name the play page's address, or a folder scm-sim's deploy-play.mjs staged.");
    return { dir, build: basename(dir), runner, fetched: 0 };
  }
  const base = at.replace(/\/+$/, "");
  const current = JSON.parse(new TextDecoder().decode(await fetchBytes(`${base}/engine/current.json`))) as EngineCurrent;
  if (!current.build || !Array.isArray(current.files) || !current.runner) throw new CliError(`${base}/engine/current.json does not name an engine build and a runner.`);
  const dir = join(cache, "engine", current.build);
  mkdirSync(dir, { recursive: true });
  let fetched = 0;
  const wanted = [...current.files, current.runner];
  const missing = wanted.filter((f) => !existsSync(join(dir, f)));
  if (missing.length) say(`${pc.dim(`Fetching the game engine from ${base} (about 25 MB, once) → ${dir}`)}`);
  for (const name of missing) {
    const bytes = await fetchBytes(`${base}/engine/${current.build}/${name}`);
    // Written whole or not at all: a half file would be taken for the engine next time.
    const part = join(dir, `${name}.part`);
    writeFileSync(part, bytes);
    renameSync(part, join(dir, name));
    fetched += bytes.length;
  }
  return { dir, build: current.build, runner: current.runner, fetched };
}

/** The folder's entries, none for a folder that is not there. */
function readdirSafe(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

/** What a folder is: a StarCraft: Remastered installation, a 1.16.1 one, or neither (the runner's own rule). */
export function gameCopyKind(folder: string): "remastered" | "classic" | null {
  if (existsSync(join(folder, ".build.info"))) return "remastered";
  if (existsSync(join(folder, "StarDat.mpq")) && existsSync(join(folder, "BrooDat.mpq"))) return "classic";
  return null;
}

/** Where a copy of the game usually is, on this system and, under WSL, on the Windows it runs in. */
export function usualGameFolders(env = process.env): string[] {
  const out: string[] = [];
  if (env.SCMJS_STARCRAFT) out.push(env.SCMJS_STARCRAFT);
  const windows = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs") : null].filter((p): p is string => !!p);
  for (const p of windows) out.push(join(p, "StarCraft"));
  for (const p of ["/mnt/c/Program Files (x86)/StarCraft", "/mnt/c/Program Files/StarCraft", "/Applications/StarCraft", join(homedir(), "Applications", "StarCraft"), join(homedir(), ".wine", "drive_c", "Program Files (x86)", "StarCraft")]) out.push(p);
  return [...new Set(out)];
}

/** The copy of the game to play with: the one named, else the first usual folder that holds one. */
export function findGameCopy(named: string | undefined): { folder: string; kind: "remastered" | "classic" } {
  if (named) {
    const kind = gameCopyKind(resolve(named));
    if (!kind) throw new CliError(`${named} is not a copy of StarCraft.`, "A Remastered installation (with .build.info) or a 1.16.1 one (StarDat.mpq and BrooDat.mpq).");
    return { folder: resolve(named), kind };
  }
  for (const folder of usualGameFolders()) {
    const kind = gameCopyKind(folder);
    if (kind) return { folder, kind };
  }
  throw new CliError("No copy of StarCraft was found on this computer.", "The game plays with your own installation's files: name its folder with --starcraft (or SCMJS_STARCRAFT).");
}

/* ── The runner's lines ───────────────────────────────────── */

export interface PlayerLine { slot: number; kind: "bot" | "computer"; race: string; minerals: number; gas: number; supplyUsed: number; supplyAvailable: number; outcome: "victory" | "defeat" | "draw" | null }
export interface StartLine { kind: "start"; bot: { name: string; commit: string; memoryPages: number }; map: { name: string; width: number; height: number; tileset: string }; copy: string; seed: number; players: PlayerLine[]; ms: { load: number; start: number } }
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
}

const RACE_LETTER: Record<string, string> = { zerg: "Z", terran: "T", protoss: "P" };
const side = (p: PlayerLine) => `P${p.slot + 1} ${pc.bold(p.kind === "bot" ? "bot" : "computer")} ${RACE_LETTER[p.race] ?? "?"} ${pc.dim(`${p.minerals}/${p.gas}`)} ${p.supplyUsed}/${p.supplyAvailable}`;

/** A runner's line as the terminal's. Null for lines that say nothing to a person. */
export function wordLine(l: RunnerLine): string | null {
  switch (l.kind) {
    case "start": return `${pc.bold(l.bot.name)} on ${pc.cyan(l.map.name)} ${pc.dim(`${l.map.width} × ${l.map.height}, ${l.map.tileset}`)}${dot}${l.players.map((p) => `${p.kind === "bot" ? "bot" : "computer"} ${p.race}`).join(" vs ")}${dot}seed ${l.seed}${dot}${l.copy === "remastered" ? "Remastered" : "1.16.1"} files`;
    case "text": return `  ${pc.dim(l.text)}`;
    case "progress": return `  ${pc.dim(`frame ${String(l.frame).padStart(6)}`)}  ${l.players.map(side).join(pc.dim("  |  "))}`;
    case "end": {
      const won = l.outcome === "victory" ? `${mark.ok} ${pc.bold("the bot won")}` : l.outcome === "defeat" ? `${mark.error} ${pc.bold("the bot lost")}` : l.outcome === "draw" ? `${mark.info} a draw` : `${mark.warn} no outcome after ${plural(l.frame, "frame")}`;
      const frames = Math.max(1, l.frame);
      return `${won}${l.ended ? ` at frame ${l.frame}` : ""}${dot}${size(l.commandBytes)} of orders${l.errors.length ? `${dot}${pc.red(plural(l.errors.length, "error"))}` : ""}${dot}${(l.ms.game / frames).toFixed(2)} ms a frame game, ${(l.ms.bot / frames).toFixed(2)} bot${dot}${(l.ms.total / 1000).toFixed(1)} s`;
    }
    case "error": return `${mark.error} ${l.message}`;
  }
}

/**
 * Run the bot over the map. The engine is fetched when it is not cached; the runner's lines go to `live` as they
 * come and into the outcome. A runner that could not start throws a CliError with its own words.
 */
export async function runBotGame(bot: string, map: string, o: BotRunOptions = {}): Promise<BotRunOutcome> {
  if (!existsSync(bot)) throw new CliError(`No file ${bot}`, "scmjs bot build writes out/<key>.scmbot in the bot's folder.", 2);
  if (!existsSync(map)) throw new CliError(`No file ${map}`, null, 2);
  const game = findGameCopy(o.starcraft);
  const engine = await ensureEngine(o.engine, undefined, o.live ?? (() => {}));
  const args = [join(engine.dir, engine.runner), resolve(map), resolve(bot), "--engine", engine.dir, "--starcraft", game.folder];
  if (o.race) args.push("--race", o.race);
  if (o.opponents?.length) args.push("--opponents", o.opponents.join(","));
  if (o.seed !== undefined) args.push("--seed", String(o.seed));
  if (o.frames !== undefined) args.push("--frames", String(o.frames));
  if (o.every !== undefined) args.push("--every", String(o.every));
  if (o.data) args.push("--data", resolve(o.data));
  const outcome: BotRunOutcome = { engine: { build: engine.build, dir: engine.dir, fetched: engine.fetched }, game, start: null, texts: [], progress: [], end: null, exitCode: 0 };
  const child = spawn(o.node ?? process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  let error: string | null = null;
  const lines = createInterface({ input: child.stdout });
  for await (const raw of lines) {
    let l: RunnerLine;
    try { l = JSON.parse(raw) as RunnerLine; } catch { continue; }
    if (l.kind === "start") outcome.start = l;
    else if (l.kind === "text") outcome.texts.push(l.text);
    else if (l.kind === "progress") outcome.progress.push(l);
    else if (l.kind === "end") outcome.end = l;
    else if (l.kind === "error") error = l.message;
    const worded = wordLine(l);
    if (worded && l.kind !== "error") o.live?.(worded);
  }
  outcome.exitCode = await new Promise<number>((done) => { child.on("error", () => done(2)); child.on("close", (c) => done(c ?? 2)); });
  if (error) throw new CliError(error, "The runner is scm-sim's; a map StarCraft itself opens, a .scmbot the toolchain built, and your own copy of the game are what it needs.");
  if (!outcome.end) throw new CliError(`The game did not finish: the runner stopped without a result (exit ${outcome.exitCode}).${stderr.trim() ? `\n${stderr.trim().split("\n").slice(-6).join("\n")}` : ""}`);
  return outcome;
}

/** Prints the outcome's lines when they were not printed as they came. */
export function printBotRun(r: BotRunOutcome): void {
  if (r.start) print(wordLine(r.start)!);
  for (const t of r.texts) print(wordLine({ kind: "text", text: t })!);
  for (const p of r.progress) print(wordLine(p)!);
  if (r.end) print(wordLine(r.end)!);
}
