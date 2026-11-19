/**
 * `scmjs map script`: a map's TrigScript script written out as files, taken in from files, and the lookup of what a
 * script can call. It is the terminal's side of the `map_script_*` tools, over the same functions (build.ts reads and
 * writes the files and compiles them, scriptapi.ts searches the declarations): what differs is where the files are —
 * on disk here, in the tool's arguments there.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { Readable } from "node:stream";
import type { OpenedMap } from "../../src/editor/mapFile";
import { buildMap, changeScript, loadTypeScript, scriptDeclarations, type BuildOutcome, type ScriptChange, type ScriptReport } from "./build";
import { outputFormat, writeBack, type Written } from "./exchange";
import { readTextArg, STDIO } from "./files";
import { apiEntries, apiOverview, searchApi } from "./scriptapi";
import { t } from "./i18n";
import { CliError, dot, mark, num, pc, size } from "./ui";
import { outName } from "./cmdkit";

const isEntry = (name: string) => name === "main.ts" || name === "main.tsx";
/** The script's files in the order they are listed: the first file, then by name. */
export const scriptNames = (files: Readonly<Record<string, string>>): string[] =>
  Object.keys(files).sort((a, b) => Number(isEntry(b)) - Number(isEntry(a)) || a.localeCompare(b));

/** Whether the map's triggers are what the script compiles to, in words. */
export function scriptStateWords(r: ScriptReport): string {
  const block = r.block ? t("triggers #{from} to #{to}", { from: r.block.start + 1, to: r.block.start + r.block.count }) : t("no triggers");
  if (r.state === "applied") return `${t("applied: {block} of the map are this script's", { block })}${r.programs ? t(", with {n, plural, one {# program} other {# programs}} (the map needs StarCraft: Remastered)", { n: r.programs }) : ""}`;
  if (r.state === "unbuilt") return r.block ? t("not applied: the files changed since the map's triggers were made from them ({block}); scmjs map build applies them", { block }) : t("not applied: the script was never built; scmjs map build applies it");
  return t("its triggers were edited or removed outside the script, so map build refuses: the editor's TrigScript window chooses what becomes of them");
}

const noScript = (name: string, map: string) => new CliError(t("{name} has no TrigScript script.", { name }), t("scmjs map script import writes one: scmjs map script import {map} main.ts", { map }));

/** The files a `map script export` gives: those named, or all of them; a name the script lacks is refused with what it has. */
export function scriptFilesWanted(name: string, map: string, r: ScriptReport, wanted: readonly string[]): string[] {
  if (r.state === "none") throw noScript(name, map);
  const names = scriptNames(r.files);
  const asked = wanted.map((n) => n.replace(/\\/g, "/").replace(/^(?:\.\/|trigscript\/)/i, ""));
  const missing = asked.filter((n) => !(n in r.files));
  if (missing.length) throw new CliError(t("The script has no file {name}", { name: missing.join(", ") }), t("It has {list}.", { list: names.join(", ") }), 2);
  return asked.length ? asked : names;
}

/** The line that says what the script is: its files, their size, and how it stands to the map's triggers. */
export function scriptHeader(name: string, r: ScriptReport): string {
  const total = Object.values(r.files).reduce((n, text) => n + Buffer.byteLength(text), 0);
  return `${pc.bold(name)}: ${t("{n, plural, one {# file} other {# files}}", { n: Object.keys(r.files).length })}, ${size(total)}${dot}${scriptStateWords(r)}`;
}

/** The files as one text for standard output: a file alone as it is, several each under a comment line with its name. */
export function scriptText(r: ScriptReport, names: readonly string[]): string {
  const end = (text: string) => (text.endsWith("\n") ? text : `${text}\n`);
  if (names.length === 1) return end(r.files[names[0]]);
  return names.map((n) => `// ── ${n} ──\n${end(r.files[n])}`).join("\n");
}

/** The files written under a folder at their names, folders made as needed; the paths written, in the order given. */
export async function writeScriptFiles(dir: string, r: ScriptReport, names: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const name of names) {
    const path = join(dir, ...name.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, r.files[name]);
    out.push(path);
  }
  return out;
}

const SCRIPT_FILE = /\.tsx?$/i;

/**
 * The files a `map script import` names, as the script names them: a file by its own name (`src/main.ts` is main.ts),
 * a folder by every .ts and .tsx file in it at its path inside (`quests/shop.ts`), `-` as main.ts from standard
 * input. Declaration files (.d.ts) and node_modules are passed over: an editor's project has them, a script does not.
 */
export async function scriptFilesFrom(paths: readonly string[], stdin?: Readable): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const put = (name: string, text: string, from: string) => {
    if (name in files) throw new CliError(t("{name} is given twice ({from}).", { name, from }), t("A folder gives its files by their path inside it, a file by its own name."), 2);
    files[name] = text;
  };
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/^﻿/, "");
  for (const path of paths) {
    if (path === STDIO) { put("main.ts", text(await readTextArg(STDIO, stdin)), path); continue; }
    const info = await stat(path).catch(() => null);
    if (!info) throw new CliError(t("No file {path}", { path }), t("Check the name; put quotes round a name with spaces or brackets."), 2);
    if (!info.isDirectory()) { put(path.split(/[\\/]/).pop()!, text(await readTextArg(path)), path); continue; }
    const found = (await readdir(path, { recursive: true, withFileTypes: true }))
      .filter((e) => e.isFile() && SCRIPT_FILE.test(e.name) && !/\.d\.ts$/i.test(e.name))
      .map((e) => relative(path, join(e.parentPath, e.name)).split(sep).join("/"))
      .filter((name) => !name.split("/").includes("node_modules"))
      .sort();
    if (!found.length) throw new CliError(t("{path} has no .ts or .tsx files.", { path }), null, 2);
    for (const name of found) put(name, text(await readFile(join(path, ...name.split("/")))), path);
  }
  return files;
}

export interface ScriptImport extends ScriptChange {
  /** Whether what the map now holds compiles; null when it could not be compiled here (no TypeScript). */
  compiles: boolean | null;
  check: BuildOutcome | null;
  /** Why it was not compiled, when it was not. */
  unchecked: string | null;
  written: Written;
}

/**
 * Files of the script put into the map, the map written, and what it now holds compiled (nothing applied: the map's
 * triggers wait for a build). The files are kept whether or not they compile, so a script is fixed a file at a time.
 * A want of TypeScript leaves them written and unchecked.
 */
export async function importScript(doc: OpenedMap, inputPath: string, changes: Readonly<Record<string, string | null>>, out: string | null): Promise<ScriptImport> {
  if (outputFormat(doc, inputPath, out) === "chk") throw new CliError(t("A bare .chk has nowhere to keep a script."), t("Write an .scx instead: name one as the output."), 2);
  const change = await changeScript(doc, changes);
  const written = await writeBack(doc, inputPath, out);
  let check: BuildOutcome | null = null, unchecked: string | null = null;
  try { check = await buildMap(doc, inputPath, await loadTypeScript(), { check: true }); } catch (e) {
    if (!(e instanceof CliError)) throw e;
    unchecked = e.hint ? `${e.message} ${e.hint}` : e.message;
  }
  return { ...change, compiles: check ? check.ok : null, check, unchecked, written };
}

/** `map script import`'s lines: what changed, each error as file:line:column, whether it compiles, where it was written. */
export function printScriptImport(name: string, r: ScriptImport): string[] {
  const said = [
    r.added.length ? t("{files} added", { files: r.added.join(", ") }) : "", r.changed.length ? t("{files} changed", { files: r.changed.join(", ") }) : "",
    r.removed.length ? t("{files} removed", { files: r.removed.join(", ") }) : "", r.unchanged.length ? t("{files} as it was", { files: r.unchanged.join(", ") }) : "",
  ].filter(Boolean).join("; ");
  const where = `${t("written to {out}", { out: outName(r.written) })}${dot}${size(r.written.bytes)}`;
  const lines = [`${pc.bold(name)}: ${said}${dot}${where}`];
  const c = r.check;
  if (c?.ok) lines.push(`${mark.ok} ${t("compiles: {n, plural, one {# trigger} other {# triggers}}", { n: c.triggerCount })}${c.programs ? t(", {n, plural, one {# program} other {# programs}} (the map will need StarCraft: Remastered)", { n: c.programs }) : ""}${pc.dim(`${dot}TrigScript ${c.trigscript}, TypeScript ${c.typescript}`)}`, pc.dim(t("The map's triggers are as they were: scmjs map build applies the script.")));
  else if (c) {
    for (const d of c.diagnostics) lines.push(`${pc.cyan(d.file)}:${d.line}:${d.column} ${pc.red("error")} ${d.message.split("\n").join("\n    ")}`);
    lines.push(`${mark.error} ${t("{n, plural, one {# error} other {# errors}} in the script. The files are kept in the map: import the corrected ones.", { n: c.diagnostics.length })}`);
  } else lines.push(`${mark.warn} ${t("Not compiled: {why}", { why: r.unchecked ?? "" })}`);
  return lines;
}

export interface ApiLookup { shown: number; more: string[]; entries: number; lines: string[] }

/**
 * `map script api`: with no words, what a script is and every name there is to look up; with words, the declarations
 * that hold all of them, each with its documentation. `doc` gives the map whose names to use (the game's own otherwise).
 */
export async function lookUpApi(doc: OpenedMap | null, mapName: string | null, words: string): Promise<ApiLookup> {
  const text = await scriptDeclarations(doc);
  const entries = apiEntries(text);
  const of = mapName ? t("as {name} has them", { name: mapName }) : t("with the game's own names");
  if (!words.trim()) return { shown: 0, more: [], entries: entries.length, lines: [`${t("TrigScript, {of}. Words after the command give a name's declaration and documentation.", { of })}`, "", ...apiOverview(text, entries)] };
  const found = searchApi(entries, words);
  if (!found.shown) return { shown: 0, more: [], entries: entries.length, lines: [t("Nothing in TrigScript holds {words} ({of}). Fewer words find more; with none every name is listed.", { words: words.trim().split(/[\s,]+/).map((w) => JSON.stringify(w)).join(t(" and ")), of })] };
  const lines = [...found.lines];
  if (found.more.length) lines.push(t("… and {n} more that match, not shown: {names}. More words narrow it.", { n: num(found.more.length), names: `${found.more.slice(0, 40).join(", ")}${found.more.length > 40 ? ", …" : ""}` }));
  return { shown: found.shown, more: found.more, entries: entries.length, lines };
}
