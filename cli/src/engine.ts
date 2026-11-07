/**
 * The game engine from the terminal, shared by `scmjs bot run`, `scmjs map trace` and `scmjs map cost`: scm-sim's
 * lifted game, the one the play page runs. Its files (the module, the base image, the interface pack) and the runners
 * that drive a game with no page are fetched once from the play page's address — `play/engine/current.json` names the
 * current build and its runners — and kept under the user's cache folder. The game's own files come from the player's
 * installation of StarCraft, Remastered or 1.16.1, found in the usual places or named; nothing of the game is fetched
 * or carried.
 *
 * A runner is run in a process of its own (one game a process: the lifted game takes its memory when its module is
 * first imported) and speaks JSON lines, which `runRunner` hands over one by one.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { CliError, pc } from "./ui";

/** Where the play page is, and so where the engine's files are (`SCMJS_PLAY_URL` for another). */
export const PLAY_URL = "https://scmjs.dev/play";

/** What `play/engine/current.json` says (scm-sim's `scripts/deploy-play.mjs` writes it). */
export interface EngineCurrent {
  build: string;
  files: string[];
  /** The bot runner (`scmjs bot run`). */
  runner: string;
  runnerBytes?: number;
  /** The map runner (`scmjs map trace|cost`); a deploy before it has none. */
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
  /** The map runner's file in `dir`, when the build has one. */
  mapRunner: string | null;
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
      return { dir: sub, build: c.build, runner: c.runner, mapRunner: c.mapRunner ?? null, fetched: 0 };
    }
    const names = existsSync(dir) ? readdirSafe(dir) : [];
    const runner = names.find((f) => /^run(-[0-9a-f]+)?\.mjs$/.test(f)) ?? null;
    if (!runner) throw new CliError(`${at} holds no engine: no current.json and no run-<hash>.mjs beside the engine's files.`, "Name the play page's address, or a folder scm-sim's deploy-play.mjs staged.");
    return { dir, build: basename(dir), runner, mapRunner: names.find((f) => /^map(-[0-9a-f]+)?\.mjs$/.test(f)) ?? null, fetched: 0 };
  }
  const base = at.replace(/\/+$/, "");
  const current = JSON.parse(new TextDecoder().decode(await fetchBytes(`${base}/engine/current.json`))) as EngineCurrent;
  if (!current.build || !Array.isArray(current.files) || !current.runner) throw new CliError(`${base}/engine/current.json does not name an engine build and a runner.`);
  const dir = join(cache, "engine", current.build);
  mkdirSync(dir, { recursive: true });
  let fetched = 0;
  const wanted = [...current.files, current.runner, ...(current.mapRunner ? [current.mapRunner] : [])];
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
  return { dir, build: current.build, runner: current.runner, mapRunner: current.mapRunner ?? null, fetched };
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

/**
 * Runs a runner script as a child process and hands each JSON line it prints to `onLine` as it comes. Resolves to the
 * exit code and what the runner wrote on stderr (its last lines, for an error nobody worded).
 */
export async function runRunner(script: string, args: string[], onLine: (line: Record<string, unknown>) => void, node = process.execPath): Promise<{ exitCode: number; stderr: string }> {
  const child = spawn(node, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  const lines = createInterface({ input: child.stdout });
  for await (const raw of lines) {
    let l: Record<string, unknown>;
    try { l = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }
    onLine(l);
  }
  const exitCode = await new Promise<number>((done) => { child.on("error", () => done(2)); child.on("close", (c) => done(c ?? 2)); });
  return { exitCode, stderr: stderr.trim() };
}
