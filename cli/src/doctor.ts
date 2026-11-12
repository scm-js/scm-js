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
import { msg, t, translate } from "./i18n";
import { CliError, columns, mark, padColumns, pc, visible } from "./ui";

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
const joinAnd = (xs: string[]) => (xs.length < 2 ? xs.join("") : t("{list} and {last}", { list: xs.slice(0, -1).join(", "), last: xs.at(-1)! }));

/** Is Node older than `engines` says. The single executable carries its own, which is never too old. */
export function nodeCheck(version = process.version, kind: InstallKind = INSTALL): Check {
  const v = version.replace(/^v/, "");
  return kind === "npm" && olderThan(v, NODE_MIN)
    ? { what: "Node", state: "bad", detail: t("{version}, needs {min} or newer", { version, min: NODE_MIN }), fix: t("Install the current LTS from https://nodejs.org (or nvm install 22)") }
    : { what: "Node", state: "ok", detail: `${version}${pc.dim(` · ${process.platform} ${process.arch}`)}`};
}

export function typescriptCheck(cwd = process.cwd()): Check {
  const path = findTypeScript(cwd);
  if (!path) return { what: "TypeScript", state: "warn", detail: t("not found"), fix: t("npm install typescript   (in the map's project, or npm install -g typescript)"), note: t("scmjs map build and a .ts plugin under scmjs map run compile with it.") + (INSTALL === "binary" ? ` ${t("It is installed with npm, which comes with Node.")}` : "") };
  // `path` is typescript/lib/typescript.js; the package.json two folders up says the version.
  let version = "";
  for (let dir = dirname(path); dir !== dirname(dir); dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
      if (pkg.name === "typescript") { version = pkg.version ?? ""; break; }
    } catch { /* not this folder */ }
  }
  return { what: "TypeScript", state: "ok", detail: `${version || t("found")}${pc.dim(` · ${path}`)}`, path: dirname(dirname(path)) };
}

export function dockerCheck(): Check {
  const running = dockerVersion();
  if (running) return { what: "Docker", state: "ok", detail: running };
  const installed = spawnSync("docker", ["--version"], { stdio: "ignore" }).status === 0;
  return installed
    ? { what: "Docker", state: "warn", detail: t("installed, not running"), fix: t("Start Docker (Docker Desktop on Windows and macOS)"), note: t("scmjs bot new|init|build run the bot toolchain in it.") }
    : { what: "Docker", state: "warn", detail: t("not found"), fix: "https://docs.docker.com/get-docker/", note: t("scmjs bot new|init|build run the bot toolchain in it.") };
}

export function starcraftCheck(): Check {
  try {
    const { folder, kind } = findGameCopy(undefined);
    return { what: "StarCraft", state: "ok", detail: `${kind === "remastered" ? t("Remastered") : "1.16.1"}${pc.dim(` · ${folder}`)}`, path: folder };
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    return { what: "StarCraft", state: "warn", detail: t("not found"), fix: t("scmjs bot run … --starcraft <folder>   (or SCMJS_STARCRAFT=<folder>)"), note: t("bot run, replay watch, replay export, map trace, map cost, map preview, map analyze and map generate use your own installation's files.") };
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
  const what = msg("Game engine");
  if (at && !/^https?:\/\//.test(at)) {
    // A staged folder: its current.json names a build folder inside it, or the files are beside.
    let dir = resolve(at);
    try { const b = (JSON.parse(readFileSync(join(dir, "current.json"), "utf8")) as { build?: string }).build; if (b && isDir(join(dir, b))) dir = join(dir, b); } catch { /* the files are beside */ }
    const runners = runnersIn(dir);
    const missing = KINDS.filter((k) => !runners.includes(k));
    return {
      what, state: missing.length ? "warn" : "ok", detail: `${t("the folder SCMJS_PLAY_URL names")}${pc.dim(` · ${dir}`)}`, path: dir, engine: { dir, build: basename(dir), runners },
      note: runnerNote(runners, missing),
      fix: missing.length ? t("Stage a {runner}-<hash>.mjs there, or unset SCMJS_PLAY_URL to fetch from the play page", { runner: RUNNERS[missing[0]].file.source.split("(")[0].slice(1) }) : undefined,
    };
  }
  const dir = join(cache, "engine");
  const mtime = (p: string) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
  const builds = (existsSync(dir) ? readdirSync(dir) : []).filter((d) => isDir(join(dir, d)) && readdirSync(join(dir, d)).length > 0)
    .sort((a, b) => mtime(join(dir, b)) - mtime(join(dir, a)));
  if (!builds.length) return { what, state: "ok", detail: pc.dim(t("not fetched yet")), engine: { dir, build: null, runners: [] }, note: t("The first scmjs bot run, replay watch or map trace fetches it from the play page (about 25 MB) into {dir}", { dir }) };
  const build = builds[0];
  const runners = runnersIn(join(dir, build));
  const missing = KINDS.filter((k) => !runners.includes(k));
  const command = missing.includes("replay") ? "scmjs replay watch <replay>" : missing.includes("map") ? "scmjs map trace <map>" : missing.includes("match") ? "scmjs bot ladder <bots…> --maps <map>" : "scmjs bot run <bot> <map>";
  return {
    what, state: missing.length ? "warn" : "ok",
    detail: `${builds.length > 1 ? t("build {build} (the newest of {n})", { build, n: builds.length }) : t("build {build}", { build })}${pc.dim(` · ${dir}`)}`,
    path: dir, engine: { dir: join(dir, build), build, runners },
    note: runnerNote(runners, missing, true),
    fix: missing.length ? t("{command} fetches {n, plural, one {it once the play page has one} other {them once the play page has them}}", { command, n: missing.length }) : undefined,
  };
}

function runnerNote(runners: RunnerKind[], missing: RunnerKind[], fetched = false): string {
  const list = joinAnd(runners.map((k) => RUNNER_COMMANDS[k]));
  if (!missing.length) return runners.length ? t("Runners for {list}.", { list }) : t("No runners.");
  const none = joinAnd(missing.map((k) => RUNNER_COMMANDS[k]));
  if (runners.length) return fetched ? t("Runners for {list}; none for {none} in this build.", { list, none }) : t("Runners for {list}; none for {none}.", { list, none });
  return fetched ? t("No runners; none for {none} in this build.", { none }) : t("No runners; none for {none}.", { none });
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
  try { cfg = JSON.parse(readFileSync(config, "utf8")); } catch { return { what, state: "ok", detail: pc.dim(t("Claude Code not found")) }; }
  const has = (servers: Record<string, unknown> | undefined) => !!servers && typeof servers === "object" && Object.values(servers).some(startsScmjsMcp);
  const why = t("scmjs mcp lets Claude Code read, check and change maps with these commands.");
  if (has(cfg?.mcpServers)) return { what, state: "ok", detail: `${t("registered with Claude Code")}${pc.dim(` · ${t("every folder")}`)}` };
  const projects = cfg?.projects && typeof cfg.projects === "object" ? cfg.projects : {};
  if (has(projects[resolve(cwd)]?.mcpServers ?? undefined)) return { what, state: "ok", detail: `${t("registered with Claude Code")}${pc.dim(` · ${t("this folder")}`)}` };
  const others = Object.values(projects).filter((p) => has(p?.mcpServers ?? undefined)).length;
  if (others) return { what, state: "ok", detail: `${t("registered with Claude Code")}${pc.dim(` · ${t("{n, plural, one {another folder} other {# other folders}}", { n: others })}`)}`, note: t("Claude Code starts it only in the folders it was added in; in your maps folder:"), fix: add };
  return { what, state: "ok", detail: t("not registered"), note: why, fix: add };
}

/**
 * Whether the browser starts: `--version`, five seconds at most. Null when it does, else the first line it said
 * (a Linux build without its libraries: "error while loading shared libraries: libnspr4.so: …"). Not tried on
 * Windows, where a browser asked its version may open a window instead.
 */
export function browserStarts(path: string, run: typeof spawnSync = spawnSync): string | null {
  if (process.platform === "win32" || /\.exe$/i.test(path)) return null;
  const r = run(path, ["--version"], { encoding: "utf8", timeout: 5000 });
  if (r.error) return (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT" ? t("it did not answer within 5 seconds") : r.error.message;
  if (r.status === 0) return null;
  const said = `${r.stderr ?? ""}\n${r.stdout ?? ""}`.split("\n").map((l) => l.trim()).find(Boolean);
  return said ? said.replace(`${path}: `, "") : t("it stopped with exit code {code}", { code: String(r.status) });
}

/** A browser `replay export` and `map test --clips` can draw with: Chrome, Chromium, Edge (or SCMJS_BROWSER's), and that it starts. */
export function browserCheck(found = findBrowser(), starts: (path: string) => string | null = browserStarts): Check {
  if (!found) return { what: msg("Browser"), state: "warn", detail: t("not found"), fix: translate(NO_BROWSER), note: t("scmjs replay export draws its clips in one, started without a window.") };
  const problem = starts(found);
  if (problem) return { what: msg("Browser"), state: "warn", detail: `${t("does not start")}${pc.dim(` · ${found}`)}`, path: found, note: `${problem}\n      ${t("scmjs replay export and map test --clips draw in it; the other commands do not need it.")}`, fix: process.platform === "linux" ? t("npx playwright install-deps chromium installs what it lacks, or SCMJS_BROWSER names another browser") : t("Install Chrome, Chromium or Edge again, or name another with SCMJS_BROWSER") };
  return { what: msg("Browser"), state: "ok", detail: `${t("found")}${pc.dim(` · ${found}`)}`, path: found };
}

/** ffmpeg, optional: `replay export` makes .mp4 files with it. */
export function ffmpegCheck(found = findFfmpeg()): Check {
  return found
    ? { what: "ffmpeg", state: "ok", detail: `${found.version}${pc.dim(` · ${found.path}`)}` }
    : { what: "ffmpeg", state: "ok", detail: pc.dim(t("not installed")), note: t("scmjs replay export makes .webm and .gif clips without it; an .mp4 needs it."), fix: "https://ffmpeg.org/download.html (winget install ffmpeg, brew install ffmpeg, apt install ffmpeg)" };
}

export function desktopAppCheck(): Check {
  const app = findDesktopApp();
  return app
    ? { what: msg("Desktop app"), state: "ok", detail: app, path: app }
    : { what: msg("Desktop app"), state: "ok", detail: pc.dim(t("not installed")), note: t("scmjs map open and replay open use the editor in your browser instead; the app is at https://scmjs.dev/editor/#download") };
}

/**
 * Whether a scmjs.dev session is kept here (`scmjs login`), read from the session file alone — no request: the name
 * is the one the sign-in gave. Not signed in is no problem, so the state is `ok` either way, as Claude Code's.
 */
export function scmjsDevCheck(file = sessionPath(), server = serverUrl()): Check {
  const what = "scmjs.dev";
  const s = readSession(file);
  if (s && s.server === server) return { what, state: "ok", detail: `${t("signed in as {name}", { name: s.name ?? t("(no name)") })}${pc.dim(` · ${file}`)}`, path: file };
  return { what, state: "ok", detail: pc.dim(s ? t("not signed in to {server}", { server: serverLabel(server) }) : t("not signed in")), note: t("scmjs map share makes links to maps with it."), fix: "scmjs login" };
}

/**
 * This version against npm's newest, and how it was installed: the single executable says so in the detail (the
 * npm package is the usual case and says nothing), and the fix is the line that updates this install.
 */
export async function versionCheck(latest: string | null | undefined = undefined, install: Install = installInfo()): Promise<Check> {
  if (latest === undefined) latest = await newestVersion();
  const kind = install.kind === "binary" ? ` · ${installLabel(install)}` : "";
  if (latest === null) return { what: "scmjs", state: "ok", detail: `${VERSION}${pc.dim(` · ${t("could not ask npm for a newer one")}${kind}`)}` };
  if (olderThan(VERSION, latest)) return { what: "scmjs", state: "warn", detail: `${t("{version}, {latest} is out", { version: VERSION, latest })}${kind}`, fix: updateCommand(install, PACKAGE) };
  return { what: "scmjs", state: "ok", detail: `${VERSION}${pc.dim(` · ${latest === VERSION ? t("the newest") : t("{latest} on npm", { latest })}${kind}`)}` };
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
  { commands: "map preview|generate|analyze", needs: ["StarCraft"] },
  { commands: "bot new|build", needs: ["Docker"] },
  { commands: RUNNER_COMMANDS.bot, needs: ["StarCraft", "bot"] },
  { commands: RUNNER_COMMANDS.replay, needs: ["StarCraft", "replay"] },
  { commands: "replay export", needs: ["StarCraft", "Browser"] },
  { commands: "map test --clips", needs: ["StarCraft", "map", "Browser"] },
  { commands: RUNNER_COMMANDS.map, needs: ["StarCraft", "map"] },
  { commands: RUNNER_COMMANDS.match, needs: ["StarCraft", "match"] },
  { commands: "map balance", needs: ["StarCraft", "match", "replay"] },
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

/**
 * What the report says, in JSON: the same checks without colour, named and judged as the text shows them — Claude
 * Code's row is "Claude Code", and a thing that is fine but not there (shown with a dot) is "absent", not "ok" — and
 * what is ready.
 */
export function doctorJson(r: { checks: Check[]; blocked: boolean; install?: Install }) {
  return {
    blocked: r.blocked, ...(r.install ? { install: r.install } : {}),
    checks: r.checks.map((c) => ({ ...c, what: c.what === "MCP" ? "Claude Code" : c.what, state: absent(c) ? "absent" : c.state, detail: visible(c.detail) })),
    ready: readiness(r.checks),
  };
}

/** A path for the eye: the home folder as `~`, and cut from the left to `room` columns. */
export function shortPath(path: string, room: number, home = homedir()): string {
  let p = path.startsWith(home) ? `~${path.slice(home.length)}` : path;
  if (columns(p) > room) p = `…${p.slice(Math.max(0, p.length - room + 1))}`;
  return p;
}

/** What a not-ready group is missing, in a few words; the rows above carry what to do about it. */
function lackLine(g: Ready, checks: Check[]): string {
  if (g.lacks === "engine runner") return t("no runner for it in the fetched engine");
  const c = g.lacks ? checks.find((x) => x.what === g.lacks) : undefined;
  return c ? `${translate(c.what)} ${valueOf(c)}` : g.lacks ?? "";
}

/**
 * The ready summary: one line when every command can run, else a line per group that cannot, with the one thing it
 * lacks and what to do about it.
 */
export function readyLines(ready: Ready[], checks: Check[] = []): string[] {
  const missing = ready.filter((g) => !g.ok);
  if (!missing.length) return [`  ${mark.ok} ${pc.bold(t("Every command is ready on this computer."))}`];
  const width = Math.max(...missing.map((g) => g.commands.length));
  return [`  ${pc.bold(t("Not ready"))}`, ...missing.map((g) => `  ${mark.error} ${g.commands.padEnd(width)}  ${pc.dim(lackLine(g, checks))}`)];
}

/** The groups the checks are shown in; a check that is fine and belongs in the title (Node, scmjs) is not a row. */
const GROUPS: { title: string; whats: string[] }[] = [
  { title: msg("Tools"), whats: ["TypeScript", "Docker", "Browser", "ffmpeg", "Desktop app", "MCP", "scmjs.dev"] },
  { title: msg("The game"), whats: ["StarCraft", "Game engine"] },
];
/** The value column: the detail with its path taken out, in a few words. */
function valueOf(c: Check): string {
  if (c.what === "MCP") {
    const d = visible(c.detail);
    return d === t("not registered") ? t("scmjs mcp not added") : d === t("Claude Code not found") ? t("not found") : t("scmjs mcp added");
  }
  if ((c.what === "Desktop app" || c.what === "Browser") && c.path && c.state === "ok") return basename(c.path);
  if (c.what === "Game engine" && c.engine?.build) return c.engine.build;
  const d = visible(c.detail);
  return c.path && d.includes(" · ") ? d.slice(0, d.indexOf(" · ")) : d;
}

/**
 * A value that is fine but not there (not installed, not signed in, not fetched yet), which gets a quiet dot: the
 * English starts with "not", the Korean ends in 않음 / 못함 / 없음.
 */
const ABSENT = /^not |(?:않음|못함|없음)$/;

/** Fine, but not there (no desktop app, Claude Code without scmjs mcp, not signed in): a dot in the text. */
const absent = (c: Check) => c.state === "ok" && ABSENT.test(valueOf(c).replace(/^scmjs mcp /, ""));

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
    const m = absent(c) ? pc.dim("·") : marks[c.state];
    const name = c.what === "MCP" ? "Claude Code" : translate(c.what);
    const head = `  ${m} ${pc.bold(padColumns(name, 12))} ${padColumns(valueOf(c), 14)}`;
    const room = width - columns(head) - 2;
    const tail = c.path && room > 12 ? pc.dim(shortPath(c.path, room)) : c.what === "Game engine" && c.engine?.runners.length ? pc.dim(t("runners for {list}", { list: joinAnd(c.engine.runners.map((k) => RUNNER_COMMANDS[k])) })) : "";
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
    lines.push(`  ${pc.dim(translate(g.title))}`);
    for (const c of rows) row(c);
    lines.push("");
  }
  lines.push(...(r.blocked ? [`  ${mark.error} ${pc.bold(t("Nothing runs until Node is updated."))}`] : readyLines(readiness(r.checks), r.checks)));
  return lines;
}
