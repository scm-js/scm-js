/**
 * The game engine for the commands that play: `scmjs bot run`, `scmjs replay watch`, `scmjs map trace` and `map cost`. The engine is scm-sim's
 * lifted game, the one the play page runs; its files (the module, the base image, the interface pack) and the
 * runners that drive a game from a terminal are fetched once from the play page's address — `play/engine/current.json`
 * names the current build and its runners — and kept under the user's cache folder. The game's own files come from the
 * player's installation of StarCraft, Remastered or 1.16.1, found in the usual places or named with `--starcraft`;
 * nothing of the game is fetched or carried.
 *
 * A runner is run in a process of its own (one game a process: the lifted game takes its memory when its module is
 * first imported) and speaks JSON lines, which each command turns into the terminal's.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { CliError, pc } from "./ui";

/** Where the play page is, and so where the engine's files are (`SCMJS_PLAY_URL` for another). */
export const PLAY_URL = "https://scmjs.dev/play";

/** The runners a deploy may name in `current.json`, by what they run, and the file name each goes by. */
export const RUNNERS = {
  bot: { key: "runner", file: /^run(-[0-9a-f]+)?\.(mjs|cjs)$/, command: "scmjs bot run" },
  replay: { key: "replayRunner", file: /^replay(-[0-9a-f]+)?\.(mjs|cjs)$/, command: "scmjs replay watch" },
  map: { key: "mapRunner", file: /^map(-[0-9a-f]+)?\.(mjs|cjs)$/, command: "scmjs map trace (and map cost)" },
} as const;
export type RunnerKind = keyof typeof RUNNERS;

/** What `play/engine/current.json` says (scm-sim's `scripts/deploy-play.mjs` writes it). */
export interface EngineCurrent {
  build: string;
  files: string[];
  /** The bot runner. */
  runner: string;
  runnerBytes?: number;
  /** The replay runner, in a deploy that has one. */
  replayRunner?: string;
  replayRunnerBytes?: number;
  /** The map runner (`scmjs map trace|cost`), in a deploy that has one. */
  mapRunner?: string;
  mapRunnerBytes?: number;
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
  /** The folder holding core.js, game.js, base-s1.bin, interface.bin and the runners. */
  dir: string;
  build: string;
  /** The bot runner's file in `dir`. */
  runner: string;
  /** Every runner's file in `dir`, by what it runs; a deploy older than a runner has not got it. */
  runners: Partial<Record<RunnerKind, string>>;
  /** Bytes fetched this time; 0 when everything was cached. */
  fetched: number;
}

/**
 * The engine's folder: `at` is a folder that already holds the files (a staged deploy, a clone's `data/lifted` with
 * the runners beside), else the play page's address, whose `engine/current.json` names the build to fetch into the
 * cache, runners and all.
 */
export async function ensureEngine(at: string = process.env.SCMJS_PLAY_URL || PLAY_URL, cache = cacheRoot(), say: (line: string) => void = () => {}): Promise<Engine> {
  if (!/^https?:\/\//.test(at)) {
    const dir = resolve(at);
    const current = join(dir, "current.json");
    if (existsSync(current)) {
      const c = JSON.parse(readFileSync(current, "utf8")) as EngineCurrent;
      const sub = existsSync(join(dir, c.build)) ? join(dir, c.build) : dir;
      return { dir: sub, build: c.build, runner: c.runner, runners: runnersNamed(c), fetched: 0 };
    }
    const files = existsSync(dir) ? readdirSafe(dir) : [];
    const runners: Engine["runners"] = {};
    for (const kind of Object.keys(RUNNERS) as RunnerKind[]) { const f = files.find((n) => RUNNERS[kind].file.test(n)); if (f) runners[kind] = f; }
    if (!Object.keys(runners).length) throw new CliError(`${at} holds no engine: no current.json and no run-<hash>.mjs beside the engine's files.`, "Name the play page's address, or a folder scm-sim's deploy-play.mjs staged.");
    return { dir, build: basename(dir), runner: runners.bot ?? "", runners, fetched: 0 };
  }
  const base = at.replace(/\/+$/, "");
  const current = JSON.parse(new TextDecoder().decode(await fetchBytes(`${base}/engine/current.json`))) as EngineCurrent;
  if (!current.build || !Array.isArray(current.files) || !current.runner) throw new CliError(`${base}/engine/current.json does not name an engine build and a runner.`);
  const dir = join(cache, "engine", current.build);
  mkdirSync(dir, { recursive: true });
  let fetched = 0;
  const runners = runnersNamed(current);
  const wanted = [...current.files, ...Object.values(runners)];
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
  return { dir, build: current.build, runner: current.runner, runners, fetched };
}

/** The runners `current.json` names, by kind. */
function runnersNamed(c: EngineCurrent): Engine["runners"] {
  const out: Engine["runners"] = {};
  for (const kind of Object.keys(RUNNERS) as RunnerKind[]) { const f = c[RUNNERS[kind].key]; if (typeof f === "string" && f) out[kind] = f; }
  return out;
}

/** The path of the engine's runner for `kind`, or a CliError when the deploy the engine came from had none. */
export function runnerFor(engine: Engine, kind: RunnerKind): string {
  const file = engine.runners[kind];
  if (!file) throw new CliError(`The engine at ${engine.dir} has no ${kind} runner.`, `${RUNNERS[kind].command} needs a play page deployed with one; a folder named with --engine must hold a ${RUNNERS[kind].file.source.split("(")[0].replace(/^\^/, "")}-<hash>.mjs.`);
  return join(engine.dir, file);
}

/** The folder's entries, none for a folder that is not there. */
function readdirSafe(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

/**
 * What a folder is: a StarCraft: Remastered installation, a 1.16.1 one, or neither (the runner's own rule). A 1.16.1
 * copy's StarDat.mpq and BrooDat.mpq are taken in any case, the folder listed once: a Linux file system tells
 * `StarDat.mpq` from `stardat.mpq`, and copies from old discs have capitals.
 */
export function gameCopyKind(folder: string): "remastered" | "classic" | null {
  if (existsSync(join(folder, ".build.info"))) return "remastered";
  const names = new Set(readdirSafe(folder).map((n) => n.toLowerCase()));
  if (names.has("stardat.mpq") && names.has("broodat.mpq")) return "classic";
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

/**
 * A runner started as a process of its own: `runner` is its file, `args` what follows it. Its standard output is a
 * pipe of JSON lines; its standard input a pipe too when `stdin` is asked for (a paced runner reads it), else closed.
 */
export function startRunner(runner: string, args: string[], { node = process.execPath, stdin = false } = {}): ChildProcess {
  return spawn(node, [runner, ...args], { stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"] });
}
