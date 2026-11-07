/**
 * `scmjs map run <plugin> <map>`: a plugin, or a script written like one (`export default function activate(api)`),
 * run against a map with the editor's plugin API and no editor — the headless host (`src/plugins/headless.ts`).
 * What the plugin would have shown is printed: its status line, its toasts, what it logged. When it is done (or
 * after `--command` ran one of its commands) the map is written back if it changed, or the change is only described
 * with `--dry-run`, as `map diff` would describe it.
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CliError, dot, mark, pc, plural, size } from "./ui";
import { openMapBytes } from "../../src/editor/mapFile";
// The one module of the editor's the command takes that is not the library's: the plugin host is the editor's
// (`tests/core.test.ts` names this exception).
import { parseSpec, PluginLoadError, runHeadless, transpileTs, type HeadlessHost, type LoaderDeps, type LogEntry, type OpenedMap, type PluginSource, type Toast, type TS } from "../../src/plugins/headless";
import { loadTypeScript } from "./build";
import { diffMaps, printDiff, type MapDiff } from "./diff";
import { writeBack } from "./exchange";

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
      if (url.startsWith("file:")) return readFile(fileURLToPath(url), "utf8");
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
      return res.text();
    },
    transpile: async (source, fileName) => {
      if (!options.typescript) throw new Error(`${fileName} is TypeScript, and no TypeScript is installed here to compile it; build the plugin, or npm install typescript.`);
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
 * What a path or spec names: a folder holding `plugin.json`, a `plugin.json`, a script file (`plugin.ts`, `x.js`),
 * each as `file:` URLs the loader reads; anything else goes to the editor's `parseSpec` (`github:…`, a URL).
 */
export function sourceFor(target: string, cwd = process.cwd()): PluginSource {
  const path = resolve(cwd, target);
  if (!existsSync(path)) return parseSpec(target);
  const url = pathToFileURL(path).href;
  if (/\.json$/i.test(path)) return { kind: "remote", manifestUrl: url, entryUrl: null, base: url.slice(0, url.lastIndexOf("/") + 1), display: target };
  if (/\.(?:ts|tsx|mts|js|mjs)$/i.test(path)) return { kind: "remote", manifestUrl: null, entryUrl: url, base: url.slice(0, url.lastIndexOf("/") + 1), display: target };
  const base = url.endsWith("/") ? url : `${url}/`;
  return { kind: "remote", manifestUrl: `${base}plugin.json`, entryUrl: null, base, display: target };
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
    throw new CliError(e instanceof Error ? e.message : String(e), "A folder with a plugin.json, a plugin.ts or .js file, github:owner/repo, or a URL.", 2);
  }
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
      toast: (t) => note({ kind: "toast", level: toastLevel(t.kind), text: t.detail ? `${t.title}: ${t.detail}` : t.title }),
      // Warnings and errors only: the info tier is the host's own trace of the plugin ("Update: Rename", a command's
      // timing), which the status line already said; a plugin's api.log goes to the console, which is this terminal.
      log: (e: LogEntry) => { if (e.level !== "info") note({ kind: "log", level: e.level, text: `${e.source}: ${e.message}` }); },
    });
  } catch (e) {
    if (e instanceof CliError) throw e;
    if (e instanceof PluginLoadError) throw new CliError(e.message, "scmjs plugin check says what the editor would make of the plugin.");
    throw new CliError(`${target} failed in activate: ${e instanceof Error ? e.message : e}`);
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
    const modified = host.modified();
    const after = host.document();
    const name = doc.fileName ?? inputPath;
    const diff = modified ? diffMaps({ name, doc: await openMapBytes(inputBytes, name) }, { name: options.out ?? name, doc: after }) : null;
    const outcome: RunOutcome = {
      plugin: { id: host.info.id, name: host.manifest.name, version: host.manifest.version ?? null },
      result: isJson(result) ? result : null, events, modified, diff, written: null,
    };
    if ((modified || options.out) && !options.dryRun) outcome.written = await writeBack(after, inputPath, options.out ?? null);
    return outcome;
  } finally {
    await host.dispose().catch(() => {});
  }
}

const isJson = (v: unknown): boolean => { try { return v !== undefined && JSON.stringify(v) !== undefined; } catch { return false; } };

/** The change in a few words: "3 units added, 1 string changed". */
export function summarizeDiff(d: MapDiff): string {
  const parts: string[] = [];
  const list = (name: string, es: { change: string }[]) => {
    const n = (c: string) => es.filter((e) => e.change === c).length;
    if (n("added")) parts.push(`${plural(n("added"), name)} added`);
    if (n("removed")) parts.push(`${plural(n("removed"), name)} removed`);
    if (n("changed")) parts.push(`${plural(n("changed"), name)} changed`);
  };
  const fields = d.header.length + d.players.length + d.forces.length;
  if (fields) parts.push(`${plural(fields, "setting")} changed`);
  list("unit", d.units); list("location", d.locations); list("trigger", d.triggers); list("briefing trigger", d.briefing); list("string", d.strings); list("file", d.members);
  if (!parts.length && d.sections.length) parts.push(`${plural(d.sections.length, "section")} changed`);
  return parts.join(", ");
}

/** The closing line (the events were printed as they came, or are printed first when they were not). */
export function printRun(name: string, r: RunOutcome, { events = false, dryRun = false } = {}): string[] {
  const lines: string[] = events ? r.events.map(eventLine) : [];
  const who = `${r.plugin.name}${r.plugin.version ? pc.dim(` ${r.plugin.version}`) : ""}`;
  if (!r.modified) { lines.push(`${mark.ok} ${pc.bold(name)}: ${who} ran${dot}${r.written ? `unchanged, written to ${pc.cyan(r.written.path)}` : "the map is unchanged"}`); return lines; }
  if (dryRun && r.diff) lines.push(...printDiff(r.diff), "");
  const change = r.diff ? summarizeDiff(r.diff) : "changed";
  lines.push(`${mark.ok} ${pc.bold(name)}: ${who} ran${dot}${change}${dot}${r.written ? `written to ${pc.cyan(r.written.path)}${dot}${size(r.written.bytes)}` : pc.dim("not written (--dry-run)")}`);
  return lines;
}
