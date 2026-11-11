/**
 * `scmjs map run <plugin> <map>`: a plugin, or a script written like one (`export default function activate(api)`),
 * run against a map with the editor's plugin API and no editor — the headless host (`src/plugins/headless.ts`).
 * What the plugin would have shown is printed: its status line, its toasts, what it logged. When it is done (or
 * after `--command` ran one of its commands) the map is written back if it changed, or the change is only described
 * with `--dry-run`, as `map diff` would describe it.
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { inspect } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { t } from "./i18n";
import { CliError, dot, mark, pc, size } from "./ui";
import { openMapBytes } from "../../src/editor/mapFile";
// The one module of the editor's the command takes that is not the library's: the plugin host is the editor's
// (`tests/core.test.ts` names this exception).
import { parseSpec, PluginLoadError, runHeadless, transpileTs, type HeadlessHost, type LoaderDeps, type LogEntry, type OpenedMap, type PluginSource, type Toast, type TS } from "../../src/plugins/headless";
import { loadTypeScript } from "./build";
import { diffMaps, printDiff, summarizeDiff, type MapDiff } from "./diff";

export { summarizeDiff };
import { writeBack } from "./exchange";
import { toStdout } from "./files";

export interface NodeLoaderOptions {
  /** TypeScript, for a plugin that is source with `.ts` files; absent, such a file is refused with the reason. */
  typescript?: () => Promise<TS> | TS;
  /** Where the modules are written before they are imported; a fresh temporary folder by default. */
  moduleDir?: string;
}

/** The loader's deps for Node: `file:` URLs read from disk, the rest fetched; modules written to a folder and imported. */
export function nodeLoaderDeps(options: NodeLoaderOptions = {}): LoaderDeps {
  const dir = options.moduleDir ?? mkdtempSync(join(tmpdir(), "scmjs-run-"));
  let n = 0;
  return {
    fetchText: async (url) => {
      if (url.startsWith("file:")) {
        const text = await readFile(fileURLToPath(url), "utf8");
        return /\/plugin\.json$/i.test(url) ? sourceWhenNotBuilt(text, dirname(fileURLToPath(url))) : text;
      }
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
      return res.text();
    },
    transpile: async (source, fileName) => {
      if (!options.typescript) throw new Error(t("{file} is TypeScript, and no TypeScript is installed here to compile it; build the plugin, or npm install typescript.", { file: fileName }));
      return transpileTs(await options.typescript(), source, fileName);
    },
    createModuleUrl: (code, sourceUrl) => {
      const file = join(dir, `${String(++n).padStart(3, "0")}-${basename(sourceUrl).replace(/\.(?:ts|tsx|mts)$/i, "").replace(/[^\w.-]/g, "_")}.mjs`);
      writeFileSync(file, `${code}\n//# sourceURL=${sourceUrl}\n`);
      return pathToFileURL(file).href;
    },
    importModule: (url) => import(/* @vite-ignore */ url),
    builtins: {},
  };
}

/**
 * A plugin on this computer whose manifest names a build that is not there (a clone nobody built yet) is loaded from
 * its source, as `scmjs plugin dev` serves it: the manifest is read without its `build` when its `entry` is there.
 */
export function sourceWhenNotBuilt(manifestText: string, dir: string): string {
  try {
    const m = JSON.parse(manifestText) as { build?: unknown; entry?: unknown };
    if (typeof m.build === "string" && !existsSync(join(dir, m.build)) && typeof m.entry === "string" && existsSync(join(dir, m.entry))) {
      delete m.build;
      return JSON.stringify(m);
    }
  } catch { /* the loader says what is wrong with it */ }
  return manifestText;
}

const SCRIPT = /\.(?:ts|tsx|mts|js|mjs)$/i;
const HINT = () => t("A folder with a plugin.json, a plugin.json, a .js or .ts script, github:owner/repo, or a URL.");

/**
 * What a path or spec names: a folder holding `plugin.json`, a `plugin.json`, a script file (`plugin.ts`, `x.js`),
 * each as `file:` URLs the loader reads; `github:…` or a URL goes to the editor's `parseSpec`. A path that is not
 * there, a file that is none of these, and a folder with no `plugin.json` are said in one line (exit 2).
 */
export function sourceFor(target: string, cwd = process.cwd()): PluginSource {
  const path = resolve(cwd, target);
  if (!existsSync(path)) {
    if (/^(?:github:|builtin:|https?:\/\/)/i.test(target.trim())) return parseSpec(target);
    throw new CliError(t("No file or folder {path}", { path: target }), HINT(), 2);
  }
  const url = pathToFileURL(path).href;
  const isFolder = statSync(path).isDirectory();
  if (!isFolder && /\.json$/i.test(path)) return { kind: "remote", manifestUrl: url, entryUrl: null, base: url.slice(0, url.lastIndexOf("/") + 1), display: target };
  if (!isFolder && SCRIPT.test(path)) return { kind: "remote", manifestUrl: null, entryUrl: url, base: url.slice(0, url.lastIndexOf("/") + 1), display: target };
  if (!isFolder) throw new CliError(t("{path} is not a plugin", { path: target }), HINT(), 2);
  if (!existsSync(join(path, "plugin.json"))) throw new CliError(t("{path} has no plugin.json", { path: target }), HINT(), 2);
  const base = url.endsWith("/") ? url : `${url}/`;
  return { kind: "remote", manifestUrl: `${base}plugin.json`, entryUrl: null, base, display: target };
}

/** A console argument as one line: an error by its message (a stack is the plugin's business, not the terminal's). */
const consoleText = (args: unknown[]) => args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : inspect(a, { depth: 2, breakLength: Infinity }))).join(" ");

/**
 * While the plugin runs, what it (or the editor code under it) writes to the console goes to standard error, an
 * error as one line: standard output is the command's (its JSON, or the map in a pipe).
 */
export function consoleToStderr(): () => void {
  const saved = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
  const to = (prefix: string) => (...args: unknown[]) => { process.stderr.write(`${prefix}${consoleText(args)}\n`); };
  console.log = to(""); console.info = to(""); console.debug = to("");
  console.warn = to(`${mark.warn} `); console.error = to(`${mark.error} `);
  return () => { Object.assign(console, saved); };
}

/** The resources Node counts as work in hand (file reads, sockets, timers) by kind, less the poll's own. */
function resources(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of process.getActiveResourcesInfo()) if (r !== "Immediate") counts.set(r, (counts.get(r) ?? 0) + 1);
  return counts;
}

/** Whether there is more work in hand of some kind than `baseline` had (a file closing then does not hide a timer). */
const busier = (baseline: ReadonlyMap<string, number>) => [...resources()].some(([kind, n]) => n > (baseline.get(kind) ?? 0));

/**
 * The timers set while the plugin runs, until they fire or are cleared: what a plugin that does not wait for its own
 * work leaves pending, which a busy process's other timers would otherwise hide from `busier`.
 */
function trackTimers(): { pending(): number; restore(): void } {
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const pending = new Set<unknown>();
  globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const handle = set(() => { pending.delete(handle); fn(...args); }, ms);
    pending.add(handle);
    return handle;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => { pending.delete(handle); clear(handle); }) as typeof clearTimeout;
  return { pending: () => pending.size, restore: () => { globalThis.setTimeout = set; globalThis.clearTimeout = clear; } };
}

/**
 * Wait for what the plugin set off and did not wait for (a command that starts its work and returns at once): until
 * none of the timers it set is pending and the process has no more file reads or fetches in hand than before it
 * started, or `limit` ms. Returns whether it went quiet.
 */
export async function settle(baseline: ReadonlyMap<string, number>, timers: () => number = () => 0, limit = 10_000): Promise<boolean> {
  const wait = setTimeout;
  const end = Date.now() + limit;
  let quiet = 0;
  while (Date.now() < end) {
    await new Promise((r) => setImmediate(r));
    if (!timers() && !busier(baseline)) { if (++quiet >= 5) return true; continue; }
    quiet = 0;
    await new Promise((r) => wait(r, 10));
  }
  return false;
}

export interface RunOptions {
  /** One of the plugin's commands to run after it activated, by id (`plugin.id` or the short form), with its arguments. */
  command?: string;
  args?: string[];
  /** Where the changed map goes; null writes over the input. */
  out?: string | null;
  /** Describe the change and write nothing. */
  dryRun?: boolean;
  /** Where the plugin's status, toasts and log lines go as they happen; absent, they are kept in the outcome only. */
  live?: (line: string) => void;
}

export interface RunEvent { kind: "status" | "toast" | "log"; level: "info" | "warn" | "error"; text: string }

export interface RunOutcome {
  plugin: { id: string; name: string; version: string | null };
  /** What the plugin's `activate` (or the command) returned, when it is JSON; else null. */
  result: unknown;
  events: RunEvent[];
  /** Whether the plugin changed the map. */
  modified: boolean;
  /** The change, as `map diff` sees it, when the map was modified. */
  diff: MapDiff | null;
  written: { path: string; bytes: number } | null;
}

const toastLevel = (kind: Toast["kind"] | undefined): RunEvent["level"] => (kind === "error" ? "error" : kind === "warn" ? "warn" : "info");

/** The event as a line for the terminal. */
export function eventLine(e: RunEvent): string {
  const m = e.level === "error" ? mark.error : e.level === "warn" ? mark.warn : mark.info;
  return `${m} ${e.text}`;
}

/**
 * Run the plugin over the map. Throws a CliError when the plugin cannot be loaded, its `activate` or the command
 * threw, or the written map could not be written; a plugin that ran and changed nothing is an outcome, not an error.
 */
export async function runOnMap(doc: OpenedMap, inputPath: string, inputBytes: Uint8Array, target: string, options: RunOptions = {}): Promise<RunOutcome> {
  let source;
  try {
    source = sourceFor(target);
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new CliError(e instanceof Error ? e.message : String(e), HINT(), 2);
  }
  const baseline = resources();
  const restoreConsole = consoleToStderr();
  const timers = trackTimers();
  const events: RunEvent[] = [];
  const note = (e: RunEvent) => { events.push(e); options.live?.(eventLine(e)); };
  // TypeScript only when a `.ts` turns up: a built plugin or a JavaScript script needs none.
  let typescript: ReturnType<typeof loadTypeScript> | null = null;
  const deps = nodeLoaderDeps({ typescript: async () => (await (typescript ??= loadTypeScript())).ts });
  let host: HeadlessHost;
  try {
    host = await runHeadless(source, doc, deps, {
      status: (text) => note({ kind: "status", level: "info", text }),
      // Plain text in the event (it goes into --json too); the colour is the printed line's.
      toast: (toast) => note({ kind: "toast", level: toastLevel(toast.kind), text: toast.detail ? `${toast.title}: ${toast.detail}` : toast.title }),
      // Warnings and errors only: the info tier is the host's own trace of the plugin ("Update: Rename", a command's
      // timing), which the status line already said; a plugin's api.log goes to the console, which is this terminal.
      log: (e: LogEntry) => { if (e.level !== "info") note({ kind: "log", level: e.level, text: `${e.source}: ${e.message}` }); },
    });
  } catch (e) {
    restoreConsole();
    timers.restore();
    if (e instanceof CliError) throw e;
    if (e instanceof PluginLoadError) throw new CliError(e.message, t("scmjs plugin check says what the editor would make of the plugin."));
    throw new CliError(t("{plugin} failed in activate: {reason}", { plugin: target, reason: String(e instanceof Error ? e.message : e) }));
  }
  let result: unknown = null;
  try {
    if (options.command) {
      try {
        result = await host.command(options.command, ...(options.args ?? []));
      } catch (e) {
        throw new CliError(`${host.manifest.name}: ${e instanceof Error ? e.message : e}`);
      }
    }
    // A command that starts its work and returns without waiting for it: its work is waited for here.
    await settle(baseline, timers.pending);
    const modified = host.modified();
    const after = host.document();
    const name = doc.fileName ?? inputPath;
    const diff = modified ? diffMaps({ name, doc: await openMapBytes(inputBytes, name) }, { name: options.out ?? name, doc: after }) : null;
    const outcome: RunOutcome = {
      plugin: { id: host.info.id, name: host.manifest.name, version: host.manifest.version ?? null },
      result: isJson(result) ? result : null, events, modified, diff, written: null,
    };
    // Changed, or --out named, or the map going down a pipe: the next step needs a map either way.
    if ((modified || options.out || toStdout(inputPath, options.out)) && !options.dryRun) outcome.written = await writeBack(after, inputPath, options.out ?? null);
    return outcome;
  } finally {
    await host.dispose().catch(() => {});
    restoreConsole();
    timers.restore();
  }
}

const isJson = (v: unknown): boolean => { try { return v !== undefined && JSON.stringify(v) !== undefined; } catch { return false; } };

/** The closing line (the events were printed as they came, or are printed first when they were not). */
export function printRun(name: string, r: RunOutcome, { events = false, dryRun = false } = {}): string[] {
  const lines: string[] = events ? r.events.map(eventLine) : [];
  const who = `${r.plugin.name}${r.plugin.version ? pc.dim(` ${r.plugin.version}`) : ""}`;
  const where = (path: string) => (path === "-" ? t("standard output") : pc.cyan(path));
  if (!r.modified) { lines.push(`${mark.ok} ${pc.bold(name)}: ${t("{plugin} ran", { plugin: who })}${dot}${r.written ? t("unchanged, written to {path}", { path: where(r.written.path) }) : t("the map is unchanged")}`); return lines; }
  if (dryRun && r.diff) lines.push(...printDiff(r.diff), "");
  const change = r.diff ? summarizeDiff(r.diff) : t("changed");
  lines.push(`${mark.ok} ${pc.bold(name)}: ${t("{plugin} ran", { plugin: who })}${dot}${change}${dot}${r.written ? `${t("written to {where}", { where: where(r.written.path) })}${dot}${size(r.written.bytes)}` : pc.dim(t("not written (--dry-run)"))}`);
  return lines;
}
