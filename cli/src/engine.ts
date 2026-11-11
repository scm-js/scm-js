/**
 * The game engine for the commands that play: `scmjs bot run`, `bot ladder`, `scmjs replay watch`, `map heatmap`, `scmjs map trace`, `map cost`,
 * `map rush` and `map test`. The engine is scm-sim's lifted game, the one the play page runs; its files (the module,
 * the base image, the interface pack) and the runners that drive a game from a terminal are fetched once from the play
 * page's address — `play/engine/current.json` names the current build and its runners — and kept under the user's cache
 * folder. The game's own files come from the player's installation of StarCraft, Remastered or 1.16.1, found in the
 * usual places or named with `--starcraft`; nothing of the game is fetched or carried.
 *
 * A runner is run in a process of its own (one game a process: the lifted game takes its memory when its module is
 * first imported) and speaks JSON lines, which each command turns into the terminal's.
 */
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { spawnOwned } from "./lifecycle";
import { runnerEnv } from "./runtime";
import { msg, t, translate } from "./i18n";
import { CliError, dot, mark, pc } from "./ui";

/** Where the play page is, and so where the engine's files are (`SCMJS_PLAY_URL` for another). */
export const PLAY_URL = "https://scmjs.dev/play";

/** The runners a deploy may name in `current.json`, by what they run, and the file name each goes by. */
export const RUNNERS = {
  bot: { key: "runner", file: /^run(-[0-9a-f]+)?\.(mjs|cjs)$/, command: msg("scmjs bot run") },
  replay: { key: "replayRunner", file: /^replay(-[0-9a-f]+)?\.(mjs|cjs)$/, command: msg("scmjs replay watch (and map heatmap)") },
  map: { key: "mapRunner", file: /^map(-[0-9a-f]+)?\.(mjs|cjs)$/, command: msg("scmjs map trace (and map cost, rush and test)") },
  match: { key: "matchRunner", file: /^match(-[0-9a-f]+)?\.(mjs|cjs)$/, command: msg("scmjs bot ladder (and map balance)") },
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
  /** The match runner (`scmjs bot ladder`: two bots, or a bot and the computer), in a deploy that has one. */
  matchRunner?: string;
  matchRunnerBytes?: number;
  /** The version of the mod overlay the deploy's runners take (`--mod <folder>`); absent in a deploy from before mods. */
  mods?: number;
}

/**
 * The mod overlay version this command knows: 1 is `--mod <folder>`, a folder of the mod's files in the game's paths;
 * 2 adds the mod's code beside a bot (`bot run`, `bot ladder`): the folder's `plugins/` and `firegraft/` loaded before
 * the game starts, `mod.json` naming the mod and its hash, a use-map-settings game (`--ums`), and a `start` line that
 * says whether the bot was made for the mod (scm-sim `src/bwapi/modCode.ts`). A command asks for the version it needs.
 */
export const MOD_OVERLAY = 2;
/** The overlay version that carries a mod's code (plugins and FireGraft project) beside a bot. */
export const MOD_CODE = 2;

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
    throw new CliError(t("{url} could not be fetched ({message}).", { url, message: String(e instanceof Error ? e.message : e) }), t("The engine comes from the play page once; connect, or name a folder that has it with --engine."));
  }
  if (!r.ok) throw new CliError(t("{url} answered {status}.", { url, status: r.status }), t("The engine comes from the play page once; name a folder that has it with --engine if the page is down."));
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
  /** The mod overlay version its runners take; 0 when they take none. */
  mods: number;
}

/**
 * The engine's folder: `at` is a folder that already holds the files (a staged deploy, a clone's `data/lifted` with
 * the runners beside), else the play page's address, whose `engine/current.json` names the build to fetch into the
 * cache, runners and all. A fetch is said on standard error, by every command alike and whatever else it prints (a
 * `--json` command's standard output is its JSON alone). The third argument, once where that line went, is not read.
 */
export async function ensureEngine(at: string = process.env.SCMJS_PLAY_URL || PLAY_URL, cache = cacheRoot(), _say?: (line: string) => void): Promise<Engine> {
  const say = (line: string) => { process.stderr.write(`${line}\n`); };
  if (!/^https?:\/\//.test(at)) {
    const dir = resolve(at);
    const current = join(dir, "current.json");
    if (existsSync(current)) {
      const c = JSON.parse(readFileSync(current, "utf8")) as EngineCurrent;
      const sub = existsSync(join(dir, c.build)) ? join(dir, c.build) : dir;
      return { dir: sub, build: c.build, runner: c.runner, runners: runnersNamed(c), fetched: 0, mods: modsOf(c) };
    }
    const files = existsSync(dir) ? readdirSafe(dir) : [];
    const runners: Engine["runners"] = {};
    for (const kind of Object.keys(RUNNERS) as RunnerKind[]) { const f = files.find((n) => RUNNERS[kind].file.test(n)); if (f) runners[kind] = f; }
    if (!Object.keys(runners).length) throw new CliError(t("{folder} holds no engine: no current.json and no run-<hash>.mjs beside the engine's files.", { folder: at }), t("Name the play page's address, or a folder scm-sim's deploy-play.mjs staged."));
    return { dir, build: basename(dir), runner: runners.bot ?? "", runners, fetched: 0, mods: 0 };
  }
  const base = at.replace(/\/+$/, "");
  const current = JSON.parse(new TextDecoder().decode(await fetchBytes(`${base}/engine/current.json`))) as EngineCurrent;
  if (!current.build || !Array.isArray(current.files) || !current.runner) throw new CliError(t("{file} does not name an engine build and a runner.", { file: `${base}/engine/current.json` }));
  const dir = join(cache, "engine", current.build);
  mkdirSync(dir, { recursive: true });
  let fetched = 0;
  const runners = runnersNamed(current);
  const wanted = [...current.files, ...Object.values(runners)];
  const missing = wanted.filter((f) => !existsSync(join(dir, f)));
  // (A build fetched before a runner was deployed lacks only that runner: a small fetch, said as such.)
  if (missing.some((f) => current.files.includes(f))) say(`${pc.dim(t("Fetching the game engine from {url} (about 25 MB to download, 105 MB on disk, once) → {dir}", { url: base, dir }))}`);
  else if (missing.length) say(`${pc.dim(t("Fetching the newer runners from {url} → {dir}", { url: base, dir }))}`);
  for (const name of missing) {
    const bytes = await fetchBytes(`${base}/engine/${current.build}/${name}`);
    // Written whole or not at all: a half file would be taken for the engine next time.
    const part = join(dir, `${name}.part`);
    writeFileSync(part, bytes);
    renameSync(part, join(dir, name));
    fetched += bytes.length;
  }
  if (missing.length) pruneRunners(dir, new Set(wanted));
  return { dir, build: current.build, runner: current.runner, runners, fetched, mods: modsOf(current) };
}

/**
 * The runners a build's folder holds that the play page no longer names, removed once newer ones are fetched: every
 * command reads `current.json` before it plays, so none starts an old one again (a game playing one now has it loaded
 * already). Only runners: the engine's own files are the build's and stay with it.
 */
function pruneRunners(dir: string, named: ReadonlySet<string>): void {
  for (const name of readdirSafe(dir)) {
    const runner = (Object.keys(RUNNERS) as RunnerKind[]).some((k) => RUNNERS[k].file.test(name));
    if (runner && !named.has(name)) { try { rmSync(join(dir, name), { force: true }); } catch { /* in use (Windows): next time */ } }
  }
}

const modsOf = (c: EngineCurrent) => (typeof c.mods === "number" && c.mods > 0 ? c.mods : 0);

/**
 * The runner's arguments for a mod laid over the game (`--mod <folder>`, once a layer, the later winning), or a
 * CliError when the engine's runners take no mod: a deploy from before mods. Nothing when there is no mod.
 */
export function modArgs(engine: Engine, folders: string | readonly string[] | null | undefined, need = 1): string[] {
  const layers = typeof folders === "string" ? [folders] : folders ?? [];
  if (!layers.length) return [];
  if (engine.mods < need) {
    if (need >= MOD_CODE && engine.mods >= 1) throw new CliError(t("The game engine at {dir} (build {build}) lays a mod's files over the game but cannot run its plugins beside a bot: that needs runners of mod overlay version {version} (\"mods\": {version} in the play page's engine/current.json), which loads a mod's plugins and FireGraft project, plays its maps with their own settings, and says whether the bot was made for the mod.", { dir: engine.dir, build: engine.build, version: need }), t("A play page deployed with scm-sim's mod support has them; the next run fetches it (or name a newer one with --engine)."));
    throw new CliError(t("The game engine at {dir} (build {build}) cannot lay a mod over the game: --mod needs runners of mod overlay version {version} or newer (\"mods\": {version} in the play page's engine/current.json).", { dir: engine.dir, build: engine.build, version: need }), t("A play page deployed with scm-sim's mod support has them; the next run fetches it (or name a newer one with --engine)."));
  }
  return layers.flatMap((f) => ["--mod", f]);
}

/** What a bot runner's `start` line says of the mod's code (overlay 2, scm-sim `src/bwapi/modCode.ts`, `ModCodeReport`). */
export interface RunnerCodeReport {
  name: string;
  link?: string;
  /** The mod's hash, and its hash without the plugins' lines. */
  hash: string;
  withoutPlugins: string;
  /** Each plugin's load and init, in the runner's words; those left out and why. */
  plugins: string[];
  skipped: string[];
  firegraft: { name: string; from: string | null; edits: number } | null;
  hashMs: number;
}

/** How a bot fits the game's mod (scm-sim `BotFitReport`): made for it, playing vanilla data, or made for another. */
export interface BotFitReport { mod: { name: string; hash: string; link?: string } | null; fit: "made" | "vanilla" | "other"; words: string }

/** The mod's code under a run's first line: its name and hash, the plugins initialized, the FireGraft project, the kind of game. */
export function codeWords(c: RunnerCodeReport, game?: "melee" | "ums"): string {
  const failed = c.plugins.filter((p) => / failed: /.test(p));
  const plugins = c.plugins.length ? t("{n, plural, one {# plugin} other {# plugins}} loaded", { n: c.plugins.length - failed.length }) : t("no plugins");
  const fg = c.firegraft ? `${dot}${t("FireGraft project {name} ({n, plural, one {# edit} other {# edits}})", { name: c.firegraft.name, n: c.firegraft.edits })}` : "";
  const kind = game === "ums" ? `${dot}${t("the map's own settings")}` : "";
  return `  ${pc.dim(`${t("mod:")} ${c.name}${dot}${c.hash}${dot}${plugins}${fg}${kind}`)}${failed.map((f) => `\n  ${mark.warn} ${f}`).join("")}`;
}

/** How the bot fits the mod, in a line: "made for Cosmonarchy BW", "plays vanilla data", or a warning. `who` names the bot in a ladder. */
export function fitWords(f: BotFitReport, game: { name: string; hash: string } | null, who?: string): string {
  const name = who ? `${who}: ` : "";
  if (f.fit === "made") return `  ${mark.ok} ${name}${t("made for {mod}", { mod: f.mod!.name })}`;
  if (f.fit === "vanilla") return `  ${pc.dim(`${name}${game ? t("plays vanilla data") : t("plays the game's own data")}`)}`;
  return `  ${mark.warn} ${name}${game ? t("made for {mod} ({hash}), not for this game's {game} ({gameHash}): it plays all the same", { mod: f.mod!.name, hash: f.mod!.hash, game: game.name, gameHash: game.hash }) : t("made for {mod} ({hash}), and this game has no mod: it plays the game's own data", { mod: f.mod!.name, hash: f.mod!.hash })}`;
}

/** What a runner's `start` line says of the mod it laid over the game (scm-sim `src/exact/modRunner.ts`, `ModReport`). */
export interface RunnerModReport {
  /** The layers, in load order. */
  paths: string[];
  /** How many files the mod holds. */
  files: number;
  /** The mod's files the game read, by the game's names. */
  read: string[];
  /** The startup data read again (names served and refused), or null when the mod holds none of it. */
  reloaded: { served: number; refused: string[]; heapBytes: number; ms: number } | null;
  /** On a Remastered copy: how many of the game's own files the command laid under the mod for that reload (`mod/overlay.ts`). */
  game?: number;
}

/** The mod's line under a run's first: what the game read of it, and the startup data read again. */
export function modWords(m: RunnerModReport): string {
  const read = t("{read} of the mod's {n, plural, one {# file} other {# files}} read", { read: m.read.length, n: m.files });
  const r = m.reloaded;
  const refused = r ? `${r.refused.slice(0, 3).join(", ")}${r.refused.length > 3 ? ` ${t("and {n} more", { n: r.refused.length - 3 })}` : ""}` : "";
  const reload = !r ? "" : r.refused.length ? `; ${t("the startup data read again, refused {list}", { list: refused })}` : `; ${t("the startup data read again ({n, plural, one {# file} other {# files}})", { n: r.served })}`;
  return `  ${pc.dim(`${t("mod:")} ${read}${reload}${m.game ? `, ${t("the game's own pictures from your Remastered copy under it")}` : ""}`)}`;
}

/**
 * What to do when a runner ended without a word of its game: the game copy or the engine's cache is at fault, and
 * doctor tells which; a cache it calls ready but that will not play is fetched again once its folder is gone.
 */
export function noResultHint(engineDir: string): string {
  return t("Run scmjs doctor to check your copy of the game and the engine. If it says both are ready, remove the engine's folder {dir}; the next command fetches it again.", { dir: engineDir });
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
  if (!file) throw new CliError(t("The engine at {dir} has no {kind} runner.", { dir: engine.dir, kind }), t("{command} needs a play page deployed with one; a folder named with --engine must hold a {file}-<hash>.mjs.", { command: translate(RUNNERS[kind].command), file: RUNNERS[kind].file.source.split("(")[0].replace(/^\^/, "") }));
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

/** Said once a run: SCMJS_STARCRAFT names a folder that holds no copy of the game. */
let saidSetting = false;

/**
 * The copy of the game to play with: the one named, else the first usual folder that holds one. None is a mistake the
 * person fixes before anything plays (exit 2), as is a `SCMJS_STARCRAFT` that names no copy, which is said on standard
 * error with the copy used instead.
 */
export function findGameCopy(named: string | undefined): { folder: string; kind: "remastered" | "classic" } {
  if (named) {
    const kind = gameCopyKind(resolve(named));
    if (!kind) throw new CliError(t("{folder} is not a copy of StarCraft.", { folder: named }), t("A Remastered installation (with .build.info) or a 1.16.1 one (StarDat.mpq and BrooDat.mpq)."), 2);
    return { folder: resolve(named), kind };
  }
  const setting = process.env.SCMJS_STARCRAFT;
  const settingBad = !!setting && !gameCopyKind(resolve(setting));
  for (const folder of usualGameFolders()) {
    const kind = gameCopyKind(folder);
    if (!kind) continue;
    if (settingBad && !saidSetting) { saidSetting = true; process.stderr.write(`${mark.warn} ${t("SCMJS_STARCRAFT names {setting}, which is not a copy of StarCraft; playing with the one in {folder}.", { setting: setting!, folder })}\n`); }
    return { folder, kind };
  }
  if (settingBad) throw new CliError(t("SCMJS_STARCRAFT names {setting}, which is not a copy of StarCraft, and there is none in the usual places.", { setting: setting! }), t("A Remastered installation (with .build.info) or a 1.16.1 one (StarDat.mpq and BrooDat.mpq)."), 2);
  throw new CliError(t("No copy of StarCraft was found on this computer."), t("The game plays with your own installation's files: name its folder with --starcraft (or SCMJS_STARCRAFT)."), 2);
}

/**
 * A runner started as a process of its own: `runner` is its file, `args` what follows it. Its standard output is a
 * pipe of JSON lines; its standard input a pipe too when `stdin` is asked for (a paced runner reads it), else closed.
 */
export function startRunner(runner: string, args: string[], { node = process.execPath, stdin = false } = {}): ChildProcess {
  // The runner's real path: it starts its game only when it is the main module, which it tells by comparing the path
  // it was started with to its own, and Node gives a module its real one — a cache reached through a link differs.
  let real = runner;
  try { real = realpathSync(runner); } catch { /* not there: the spawn says so */ }
  // In the single executable `process.execPath` is scmjs itself, which runs the script as Node would when told to.
  // Ended with the command, whatever ends it, with any process it starts (lifecycle.ts).
  return spawnOwned(node, [real, ...args], { stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"], env: runnerEnv(node) });
}
