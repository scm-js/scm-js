/**
 * `scmjs doctor`: what this computer has of what the commands need beyond Node — TypeScript for `map build` and a
 * `.ts` plugin, Docker for `bot new|build`, a copy of StarCraft and the fetched engine's runners for `bot run`,
 * `replay watch` and `map trace|cost`, a browser and ffmpeg for `replay export`, the desktop app for `map open`, whether Claude Code knows `scmjs mcp` — and the
 * command for each thing missing, then which commands are ready (`readiness`, read off the same checks). Nothing is
 * changed. Everything here is optional (`info` and `check` need none of it), so the exit code is 0 unless Node itself
 * is too old.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { newestVersion, olderThan, PACKAGE, VERSION } from "./about";
import { dockerVersion } from "./bot";
import { cacheRoot, findGameCopy } from "./botrun";
import { findTypeScript } from "./build";
import { RUNNERS, type RunnerKind } from "./engine";
import { findDesktopApp } from "./open";
import { findBrowser, NO_BROWSER } from "./browser";
import { findFfmpeg } from "./export";
import { readSession, serverLabel, serverUrl, sessionPath } from "./account";
import { INSTALL, installInfo, installLabel, updateCommand, type Install, type InstallKind } from "./runtime";
import { CliError, columns, mark, pc, visible } from "./ui";

/** The Node this package's `engines` asks for (cli/package.json). */
export const NODE_MIN = "22.12.0";

export type CheckState = "ok" | "warn" | "bad";
export interface Check {
  what: string;
  state: CheckState;
  detail: string;
  fix?: string;
  note?: string;
  /** Where the thing is (a folder or file), shown dimmed and shortened; `detail` carries it too for the JSON. */
  path?: string;
  /** The game engine's check only: the folder looked in, the build found there (null: none fetched yet) and its runners. */
  engine?: { dir: string; build: string | null; runners: RunnerKind[] };
}

/** The commands each runner plays, as the doctor names them. */
export const RUNNER_COMMANDS: Record<RunnerKind, string> = { bot: "bot run", replay: "replay watch", map: "map trace|cost", match: "bot ladder" };
const KINDS = Object.keys(RUNNERS) as RunnerKind[];

/** "a", "a and b", "a, b and c". */
const joinAnd = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Is Node older than `engines` says. The single executable carries its own, which is never too old. */
export function nodeCheck(version = process.version, kind: InstallKind = INSTALL): Check {
  const v = version.replace(/^v/, "");
  return kind === "npm" && olderThan(v, NODE_MIN)
    ? { what: "Node", state: "bad", detail: `${version}, needs ${NODE_MIN} or newer`, fix: "Install the current LTS from https://nodejs.org (or nvm install 22)" }
    : { what: "Node", state: "ok", detail: `${version}${pc.dim(` · ${process.platform} ${process.arch}`)}`};
}

export function typescriptCheck(cwd = process.cwd()): Check {
  const path = findTypeScript(cwd);
  if (!path) return { what: "TypeScript", state: "warn", detail: "not found", fix: "npm install typescript   (in the map's project, or npm install -g typescript)", note: `scmjs map build and a .ts plugin under scmjs map run compile with it.${INSTALL === "binary" ? " It is installed with npm, which comes with Node." : ""}` };
  // `path` is typescript/lib/typescript.js; the package.json two folders up says the version.
  let version = "";
  for (let dir = dirname(path); dir !== dirname(dir); dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
      if (pkg.name === "typescript") { version = pkg.version ?? ""; break; }
    } catch { /* not this folder */ }
  }
  return { what: "TypeScript", state: "ok", detail: `${version || "found"}${pc.dim(` · ${path}`)}`, path: dirname(dirname(path)) };
}

export function dockerCheck(): Check {
  const running = dockerVersion();
  if (running) return { what: "Docker", state: "ok", detail: running };
  const installed = spawnSync("docker", ["--version"], { stdio: "ignore" }).status === 0;
  return installed
    ? { what: "Docker", state: "warn", detail: "installed, not running", fix: "Start Docker (Docker Desktop on Windows and macOS)", note: "scmjs bot new|init|build run the bot toolchain in it." }
    : { what: "Docker", state: "warn", detail: "not found", fix: "https://docs.docker.com/get-docker/", note: "scmjs bot new|init|build run the bot toolchain in it." };
}

export function starcraftCheck(): Check {
  try {
    const { folder, kind } = findGameCopy(undefined);
    return { what: "StarCraft", state: "ok", detail: `${kind === "remastered" ? "Remastered" : "1.16.1"}${pc.dim(` · ${folder}`)}`, path: folder };
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    return { what: "StarCraft", state: "warn", detail: "not found", fix: "scmjs bot run … --starcraft <folder>   (or SCMJS_STARCRAFT=<folder>)", note: "bot run, replay watch, replay export, map trace, map cost, map preview and map generate use your own installation's files." };
  }
}

/** The runners an engine folder holds, by the file names `ensureEngine` knows them by. */
export function runnersIn(dir: string): RunnerKind[] {
  let files: string[];
  try { files = readdirSync(dir); } catch { return []; }
  return KINDS.filter((k) => files.some((f) => RUNNERS[k].file.test(f)));
}

/**
 * The engine the playing commands would use: a folder `SCMJS_PLAY_URL` names (as `--engine` takes one), else the
 * newest build fetched into the cache — `ensureEngine` asks the play page each time and fetches what the current build
 * lacks, so a build fetched before a runner was deployed is brought up to date by the next command that needs it.
 */
export function engineCheck(cache = cacheRoot(), at = process.env.SCMJS_PLAY_URL): Check {
  const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  const what = "Game engine";
  if (at && !/^https?:\/\//.test(at)) {
    // A staged folder: its current.json names a build folder inside it, or the files are beside.
    let dir = resolve(at);
    try { const b = (JSON.parse(readFileSync(join(dir, "current.json"), "utf8")) as { build?: string }).build; if (b && isDir(join(dir, b))) dir = join(dir, b); } catch { /* the files are beside */ }
    const runners = runnersIn(dir);
    const missing = KINDS.filter((k) => !runners.includes(k));
    return {
      what, state: missing.length ? "warn" : "ok", detail: `the folder SCMJS_PLAY_URL names${pc.dim(` · ${dir}`)}`, path: dir, engine: { dir, build: basename(dir), runners },
      note: runnerNote(runners, missing),
      fix: missing.length ? `Stage a ${RUNNERS[missing[0]].file.source.split("(")[0].slice(1)}-<hash>.mjs there, or unset SCMJS_PLAY_URL to fetch from the play page` : undefined,
    };
  }
  const dir = join(cache, "engine");
  const mtime = (p: string) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
  const builds = (existsSync(dir) ? readdirSync(dir) : []).filter((d) => isDir(join(dir, d)) && readdirSync(join(dir, d)).length > 0)
    .sort((a, b) => mtime(join(dir, b)) - mtime(join(dir, a)));
  if (!builds.length) return { what, state: "ok", detail: pc.dim("not fetched yet"), engine: { dir, build: null, runners: [] }, note: `The first scmjs bot run, replay watch or map trace fetches it from the play page (about 25 MB) into ${dir}` };
  const build = builds[0];
  const runners = runnersIn(join(dir, build));
  const missing = KINDS.filter((k) => !runners.includes(k));
  const command = missing.includes("replay") ? "scmjs replay watch <replay>" : missing.includes("map") ? "scmjs map trace <map>" : missing.includes("match") ? "scmjs bot ladder <bots…> --maps <map>" : "scmjs bot run <bot> <map>";
  return {
    what, state: missing.length ? "warn" : "ok",
    detail: `build ${build}${builds.length > 1 ? ` (the newest of ${builds.length})` : ""}${pc.dim(` · ${dir}`)}`,
    path: dir, engine: { dir: join(dir, build), build, runners },
    note: runnerNote(runners, missing, true),
    fix: missing.length ? `${command} fetches ${missing.length > 1 ? "them" : "it"} once the play page has ${missing.length > 1 ? "them" : "one"}` : undefined,
  };
}

function runnerNote(runners: RunnerKind[], missing: RunnerKind[], fetched = false): string {
  const has = runners.length ? `Runners for ${joinAnd(runners.map((k) => RUNNER_COMMANDS[k]))}` : "No runners";
  if (!missing.length) return `${has}.`;
  return `${has}; none for ${joinAnd(missing.map((k) => RUNNER_COMMANDS[k]))}${fetched ? " in this build" : ""}.`;
}

/** Does an `mcpServers` entry start `scmjs mcp` (by the package, the command, or a path to the built file). */
function startsScmjsMcp(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const { command, args } = entry as { command?: unknown; args?: unknown };
  const words = [command, ...(Array.isArray(args) ? args : [])].filter((w): w is string => typeof w === "string");
  return words.some((w) => /@scm-js\/cli|scmjs/.test(w)) && words.includes("mcp");
}

export const MCP_ADD = "claude mcp add scmjs -- npx -y @scm-js/cli mcp";

/**
 * The line that registers `scmjs mcp` with Claude Code for this install: npx for the npm package; for the single
 * executable `scmjs` when a package manager put it on PATH, else its own path (a download can be anywhere).
 */
export function mcpAddLine(install: Install = installInfo()): string {
  if (install.kind === "npm") return MCP_ADD;
  const path = install.manager ? "scmjs" : /^[\w./:\\-]+$/.test(install.path) ? install.path : `"${install.path}"`;
  return `claude mcp add scmjs -- ${path} mcp`;
}

/**
 * Whether Claude Code starts `scmjs mcp`: its `~/.claude.json` keeps `mcpServers` for every folder and, under
 * `projects`, for each folder. Only those entries are looked at; nothing else in the file is read out or printed.
 * Not having it is no problem, so the state is `ok` either way.
 */
export function mcpCheck(config = join(homedir(), ".claude.json"), cwd = process.cwd(), add = mcpAddLine()): Check {
  const what = "MCP";
  let cfg: { mcpServers?: Record<string, unknown>; projects?: Record<string, { mcpServers?: Record<string, unknown> } | null> };
  try { cfg = JSON.parse(readFileSync(config, "utf8")); } catch { return { what, state: "ok", detail: pc.dim("Claude Code not found") }; }
  const has = (servers: Record<string, unknown> | undefined) => !!servers && typeof servers === "object" && Object.values(servers).some(startsScmjsMcp);
  const why = "scmjs mcp lets Claude Code read, check and change maps with these commands.";
  if (has(cfg?.mcpServers)) return { what, state: "ok", detail: `registered with Claude Code${pc.dim(" · every folder")}` };
  const projects = cfg?.projects && typeof cfg.projects === "object" ? cfg.projects : {};
  if (has(projects[resolve(cwd)]?.mcpServers ?? undefined)) return { what, state: "ok", detail: `registered with Claude Code${pc.dim(" · this folder")}` };
  const others = Object.values(projects).filter((p) => has(p?.mcpServers ?? undefined)).length;
  if (others) return { what, state: "ok", detail: `registered with Claude Code${pc.dim(` · ${others === 1 ? "another folder" : `${others} other folders`}`)}`, note: "Claude Code starts it only in the folders it was added in; in your maps folder:", fix: add };
  return { what, state: "ok", detail: "not registered", note: why, fix: add };
}

/** A browser `replay export` can draw with: Chrome, Chromium, Edge (or one named with SCMJS_BROWSER). */
export function browserCheck(found = findBrowser()): Check {
  return found
    ? { what: "Browser", state: "ok", detail: `found${pc.dim(` · ${found}`)}`, path: found }
    : { what: "Browser", state: "warn", detail: "not found", fix: NO_BROWSER, note: "scmjs replay export draws its clips in one, started without a window." };
}

/** ffmpeg, optional: `replay export` makes .mp4 files with it. */
export function ffmpegCheck(found = findFfmpeg()): Check {
  return found
    ? { what: "ffmpeg", state: "ok", detail: `${found.version}${pc.dim(` · ${found.path}`)}` }
    : { what: "ffmpeg", state: "ok", detail: pc.dim("not installed"), note: "scmjs replay export makes .webm and .gif clips without it; an .mp4 needs it.", fix: "https://ffmpeg.org/download.html (winget install ffmpeg, brew install ffmpeg, apt install ffmpeg)" };
}

export function desktopAppCheck(): Check {
  const app = findDesktopApp();
  return app
    ? { what: "Desktop app", state: "ok", detail: app, path: app }
    : { what: "Desktop app", state: "ok", detail: pc.dim("not installed"), note: "scmjs map open and replay open use the editor in your browser instead; the app is at https://scmjs.dev/editor/#download" };
}

/**
 * Whether a scmjs.dev session is kept here (`scmjs login`), read from the session file alone — no request: the name
 * is the one the sign-in gave. Not signed in is no problem, so the state is `ok` either way, as Claude Code's.
 */
export function scmjsDevCheck(file = sessionPath(), server = serverUrl()): Check {
  const what = "scmjs.dev";
  const s = readSession(file);
  if (s && s.server === server) return { what, state: "ok", detail: `signed in as ${s.name ?? "(no name)"}${pc.dim(` · ${file}`)}`, path: file };
  return { what, state: "ok", detail: pc.dim(s ? `not signed in to ${serverLabel(server)}` : "not signed in"), note: "scmjs map share makes links to maps with it.", fix: "scmjs login" };
}

/**
 * This version against npm's newest, and how it was installed: the single executable says so in the detail (the
 * npm package is the usual case and says nothing), and the fix is the line that updates this install.
 */
export async function versionCheck(latest: string | null | undefined = undefined, install: Install = installInfo()): Promise<Check> {
  if (latest === undefined) latest = await newestVersion();
  const kind = install.kind === "binary" ? ` · ${installLabel(install)}` : "";
  if (latest === null) return { what: "scmjs", state: "ok", detail: `${VERSION}${pc.dim(` · could not ask npm for a newer one${kind}`)}` };
  if (olderThan(VERSION, latest)) return { what: "scmjs", state: "warn", detail: `${VERSION}, ${latest} is out${kind}`, fix: updateCommand(install, PACKAGE) };
  return { what: "scmjs", state: "ok", detail: `${VERSION}${pc.dim(`${latest === VERSION ? " · the newest" : ` · ${latest} on npm`}${kind}`)}` };
}

export async function doctorReport(): Promise<{ checks: Check[]; blocked: boolean; install?: Install }> {
  const checks = [nodeCheck(), await versionCheck(), typescriptCheck(), dockerCheck(), starcraftCheck(), engineCheck(), browserCheck(), ffmpegCheck(), desktopAppCheck(), mcpCheck(), scmjsDevCheck()];
  return { checks, blocked: checks.some((c) => c.state === "bad"), install: installInfo() };
}

/** A group of commands and whether this computer can run them now; `lacks` names the one thing missing. */
export interface Ready { commands: string; ok: boolean; lacks?: string }

/** What each group needs: a check by its name (ready unless it warns), or the engine runner of a kind. */
type Need = "TypeScript" | "Docker" | "StarCraft" | "Browser" | RunnerKind;
const READY: { commands: string; needs: Need[] }[] = [
  { commands: "map info|check|…", needs: [] },
  { commands: "replay info|open", needs: [] },
  { commands: "mcp", needs: [] },
  { commands: "map build", needs: ["TypeScript"] },
  { commands: "map preview|generate", needs: ["StarCraft"] },
  { commands: "bot new|build", needs: ["Docker"] },
  { commands: RUNNER_COMMANDS.bot, needs: ["StarCraft", "bot"] },
  { commands: RUNNER_COMMANDS.replay, needs: ["StarCraft", "replay"] },
  { commands: "replay export", needs: ["StarCraft", "Browser"] },
  { commands: RUNNER_COMMANDS.map, needs: ["StarCraft", "map"] },
  { commands: RUNNER_COMMANDS.match, needs: ["StarCraft", "match"] },
];

/**
 * Which commands can run now, read off the checks (no probe of its own): a check that warns blocks the commands that
 * need it; a fetched engine build without a kind's runner blocks that kind's commands (none fetched yet blocks
 * nothing: the first run fetches it); Node too old blocks everything. A check that is not there blocks nothing.
 */
export function readiness(checks: Check[]): Ready[] {
  const by = (what: string) => checks.find((c) => c.what === what);
  const nodeBad = by("Node")?.state === "bad";
  const engine = by("Game engine")?.engine;
  const lacking = (n: Need): string | null => {
    if (n === "TypeScript" || n === "Docker" || n === "StarCraft" || n === "Browser") return by(n)?.state === "warn" || by(n)?.state === "bad" ? n : null;
    return engine?.build && !engine.runners.includes(n) ? "engine runner" : null;
  };
  return READY.map(({ commands, needs }) => {
    const lacks = nodeBad ? "Node" : needs.map(lacking).find((l) => l !== null);
    return lacks ? { commands, ok: false, lacks } : { commands, ok: true };
  });
}

/** What the report says, in JSON: the same checks without colour, and what is ready. */
export function doctorJson(r: { checks: Check[]; blocked: boolean; install?: Install }) {
  return { blocked: r.blocked, ...(r.install ? { install: r.install } : {}), checks: r.checks.map((c) => ({ ...c, detail: visible(c.detail) })), ready: readiness(r.checks) };
}

/** A path for the eye: the home folder as `~`, and cut from the left to `room` columns. */
export function shortPath(path: string, room: number, home = homedir()): string {
  let p = path.startsWith(home) ? `~${path.slice(home.length)}` : path;
  if (columns(p) > room) p = `…${p.slice(Math.max(0, p.length - room + 1))}`;
  return p;
}

/** What a not-ready group is missing, in a few words; the rows above carry what to do about it. */
function lackLine(g: Ready, checks: Check[]): string {
  if (g.lacks === "engine runner") return "no runner for it in the fetched engine";
  const c = g.lacks ? checks.find((x) => x.what === g.lacks) : undefined;
  return c ? `${c.what} ${visible(c.detail)}` : g.lacks ?? "";
}

/**
 * The ready summary: one line when every command can run, else a line per group that cannot, with the one thing it
 * lacks and what to do about it.
 */
export function readyLines(ready: Ready[], checks: Check[] = []): string[] {
  const missing = ready.filter((g) => !g.ok);
  if (!missing.length) return [`  ${mark.ok} ${pc.bold("Every command is ready on this computer.")}`];
  const width = Math.max(...missing.map((g) => g.commands.length));
  return [`  ${pc.bold("Not ready")}`, ...missing.map((g) => `  ${mark.error} ${g.commands.padEnd(width)}  ${pc.dim(lackLine(g, checks))}`)];
}

/** The groups the checks are shown in; a check that is fine and belongs in the title (Node, scmjs) is not a row. */
const GROUPS: { title: string; whats: string[] }[] = [
  { title: "Tools", whats: ["TypeScript", "Docker", "Browser", "ffmpeg", "Desktop app", "MCP", "scmjs.dev"] },
  { title: "The game", whats: ["StarCraft", "Game engine"] },
];
/** The value column: the detail with its path taken out, in a few words. */
function valueOf(c: Check): string {
  if (c.what === "MCP") return c.detail.startsWith("registered") ? "scmjs mcp added" : visible(c.detail) === "not registered" ? "scmjs mcp not added" : visible(c.detail).replace(/^Claude Code /, "");
  if ((c.what === "Desktop app" || c.what === "Browser") && c.path) return basename(c.path);
  if (c.what === "Game engine" && c.engine?.build) return c.engine.build;
  const d = visible(c.detail);
  return c.path && d.includes(" · ") ? d.slice(0, d.indexOf(" · ")) : d;
}

export function printDoctor(r: { checks: Check[]; blocked: boolean }, width = process.stdout.columns || 100): string[] {
  const by = (what: string) => r.checks.find((c) => c.what === what);
  const node = by("Node"), self = by("scmjs");
  // The version and Node are the title when they are fine ("scmjs 0.9.0 · the newest · Node v24 · linux x64").
  const [version, ...rest] = self ? visible(self.detail).split(" · ") : [];
  const title = [self && self.state === "ok" ? `${pc.bold(pc.cyan("scmjs"))} ${pc.bold(version)}${rest.length ? pc.dim(` · ${rest.join(" · ")}`) : ""}` : pc.bold(pc.cyan("scmjs doctor")), node && node.state === "ok" ? pc.dim(`Node ${visible(node.detail)}`) : null].filter(Boolean).join(pc.dim(" · "));
  const lines: string[] = [title, ""];
  const marks: Record<CheckState, string> = { ok: mark.ok, warn: mark.warn, bad: mark.error };
  const row = (c: Check) => {
    // Fine, but not there (no desktop app, no Claude Code): a quiet dot rather than a tick.
    const m = c.state === "ok" && /^not /.test(valueOf(c).replace(/^scmjs mcp /, "")) ? pc.dim("·") : marks[c.state];
    const name = c.what === "MCP" ? "Claude Code" : c.what;
    const head = `  ${m} ${pc.bold(name.padEnd(12))} ${valueOf(c).padEnd(14)}`;
    const room = width - columns(head) - 2;
    const tail = c.path && room > 12 ? pc.dim(shortPath(c.path, room)) : c.what === "Game engine" && c.engine?.runners.length ? pc.dim(`runners for ${joinAnd(c.engine.runners.map((k) => RUNNER_COMMANDS[k]))}`) : "";
    lines.push(`${head}${tail ? ` ${tail}` : ""}`.trimEnd());
    // What is wrong and what to do about it, under the row; Claude Code's "not added" is not wrong, so only the line to run.
    if (c.state !== "ok") { if (c.note) lines.push(pc.dim(`      ${c.note}`)); if (c.fix) lines.push(`      ${c.fix}`); }
    else if ((c.what === "MCP" || c.what === "scmjs.dev" || c.what === "ffmpeg") && c.fix) lines.push(`      ${pc.dim(c.fix)}`);
  };
  // Node and scmjs are rows only when something is wrong with them.
  const first = [node, self].filter((c): c is Check => !!c && c.state !== "ok");
  if (first.length) { for (const c of first) row(c); lines.push(""); }
  for (const g of GROUPS) {
    const rows = g.whats.map(by).filter((c): c is Check => !!c);
    if (!rows.length) continue;
    lines.push(`  ${pc.dim(g.title)}`);
    for (const c of rows) row(c);
    lines.push("");
  }
  lines.push(...(r.blocked ? [`  ${mark.error} ${pc.bold("Nothing runs until Node is updated.")}`] : readyLines(readiness(r.checks), r.checks)));
  return lines;
}
