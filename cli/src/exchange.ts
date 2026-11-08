/**
 * `scmjs map triggers export|import` and `scmjs map strings export|import`: a map's triggers and strings as files,
 * the forms the editor trades with SCMDraft and TrigEdit — text triggers, `.trg` records, `<index><TAB><text>` strings
 * — so they can live beside the map in version control, be diffed and edited, and go back in. Writing the map back is
 * `writeBack`, which keeps the archive's other members and how the scenario was compressed.
 */
import { writeFile } from "node:fs/promises";
import type { Writable } from "node:stream";
import { TriggerTextError } from "../../src/formats/triggers/text";
import type { OpenedMap } from "../../src/editor/mapFile";
import { writeMapBytes } from "../../src/editor/mapFile";
import { applyBriefing, applyTriggers, readBriefing, readTriggers } from "../../src/editor/triggers";
import { applyStringImport, encodeTrg, formatStringTable, parseStringTable, readTriggerFile, triggerFormatOf, triggersToText } from "../../src/editor/exchange";
import { defaultSaveOptions, formatOf, type MapFormat } from "../../src/editor/save";
import { STDIO, toStdout } from "./files";
import { t } from "./i18n";
import { CliError } from "./ui";

export interface TriggerExport {
  /** How many triggers went out. */
  count: number;
  /** The text form, or null when the file is `.trg`. */
  text: string | null;
  /** The `.trg` records, or null for text. */
  bytes: Uint8Array | null;
}

/** The map's triggers (or its briefing) as text, or as `.trg` records when `fileName` ends in `.trg`. */
export function exportTriggers(doc: OpenedMap, fileName: string | null, briefing = false): TriggerExport {
  const triggers = briefing ? readBriefing(doc.scenario) : readTriggers(doc.scenario);
  if (fileName && triggerFormatOf(fileName) === "trg") return { count: triggers.length, text: null, bytes: encodeTrg(triggers) };
  return { count: triggers.length, text: triggersToText(doc.scenario, triggers, briefing), bytes: null };
}

export interface TriggerImport { before: number; after: number; read: number }

/**
 * Replace the map's triggers (or briefing) with a file's — text or `.trg` by extension — or add them after the
 * map's own with `append`. Text the map cannot resolve fails with its line, and nothing changes.
 */
export function importTriggers(doc: OpenedMap, fileName: string, bytes: Uint8Array, { briefing = false, append = false } = {}): TriggerImport {
  let read;
  try {
    read = readTriggerFile(doc.scenario, fileName, bytes, briefing);
  } catch (e) {
    if (e instanceof TriggerTextError) throw new CliError(t("{file}, line {line}: {message}", { file: fileName, line: e.line, message: e.message.replace(/^Line \d+: /, "") }), t("The text form is the trigger window's; docs.scmjs.dev/triggers lists every condition and action."));
    throw new CliError(t("{file} is not a trigger file this can read: {reason}", { file: fileName, reason: String(e instanceof Error ? e.message : e) }));
  }
  const current = briefing ? readBriefing(doc.scenario) : readTriggers(doc.scenario);
  const next = append ? [...current, ...read] : read;
  if (briefing) applyBriefing(doc.scenario, next); else applyTriggers(doc.scenario, next);
  return { before: current.length, after: next.length, read: read.length };
}

/** The string table as `<index><TAB><text>` lines. */
export function exportStrings(doc: OpenedMap): { count: number; text: string } {
  const text = formatStringTable(doc.scenario.strings);
  return { count: text === "" ? 0 : text.trimEnd().split("\n").length, text };
}

export interface StringImportResult { replaced: number; added: number; unchanged: number }

/** Set the strings a file names, in place by index; a line that is not `<index><TAB><text>` fails the import. */
export function importStrings(doc: OpenedMap, fileName: string, text: string): StringImportResult {
  const parsed = parseStringTable(text);
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new CliError(`${t("{file}, line {line}: {message}", { file: fileName, line: first.line, message: first.message })}${parsed.errors.length > 1 ? ` ${t("(and {n} more)", { n: parsed.errors.length - 1 })}` : ""}`, t("Each line is the string's number, a tab, and its text; # starts a comment."));
  }
  const { replaced, added } = applyStringImport(doc.scenario, parsed.entries);
  return { replaced, added, unchanged: parsed.entries.length - replaced - added };
}

/**
 * Write the map to `outPath`, or over the file it came from. The format follows the name's extension (the input's
 * when the name has none the editor writes); the archive's other members come along; the scenario is compressed
 * and encrypted as it was opened, as Save As would — the editor's own rule (`defaultSaveOptions`).
 */
export async function writeBack(doc: OpenedMap, inputPath: string, outPath: string | null, stdout?: Writable): Promise<Written> {
  const path = toStdout(inputPath, outPath) ? STDIO : outPath ?? inputPath;
  const format = outputFormat(doc, inputPath, outPath);
  const { format: _format, ...asOpened } = defaultSaveOptions(doc.scenario, doc.origin ?? null, path === STDIO ? doc.fileName : path);
  const bytes = await writeMapBytes(doc.scenario, { format, extras: doc.extras, stored: doc.stored ?? null, options: asOpened });
  return writeOutput(bytes, path, stdout);
}

/** What was written: the path (`-` for standard output) and the size. */
export interface Written { path: string; bytes: number }

/**
 * The form a map is written back in: the output name's extension, else the input's, else the form it came in (a map
 * from a pipe is `stdin.scx` or `stdin.chk` by its bytes).
 */
export function outputFormat(doc: OpenedMap, inputPath: string, outPath: string | null): MapFormat {
  return formatOf(outPath) ?? formatOf(inputPath) ?? formatOf(doc.fileName) ?? (doc.origin ? "scx" : "chk");
}

/** The bytes to the file, or to standard output for `-` (so a command can be one step of a pipe). */
export async function writeOutput(bytes: Uint8Array, path: string, stdout: Writable = process.stdout): Promise<Written> {
  if (path === STDIO) {
    await new Promise<void>((resolve, reject) => stdout.write(bytes, (e) => (e ? reject(e) : resolve())));
    return { path, bytes: bytes.length };
  }
  try {
    await writeFile(path, bytes);
  } catch (e) {
    throw new CliError(t("{path} could not be written ({code})", { path, code: String((e as NodeJS.ErrnoException).code ?? e) }));
  }
  return { path, bytes: bytes.length };
}
