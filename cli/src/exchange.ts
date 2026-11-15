/**
 * `scmjs map triggers export|import` and `scmjs map strings export|import`: a map's triggers and strings as files,
 * the forms the editor trades with SCMDraft and TrigEdit — text triggers, `.trg` records, `<index><TAB><text>` strings
 * — so they can live beside the map in version control, be diffed and edited, and go back in. Writing the map back is
 * `writeBack`, which keeps the archive's other members and how the scenario was compressed.
 */
import type { Writable } from "node:stream";
import { TriggerTextError } from "../../src/formats/triggers/text";
import type { OpenedMap } from "../../src/editor/mapFile";
import { writeMapBytes } from "../../src/editor/mapFile";
import { applyBriefing, applyTriggers, readBriefing, readTriggers } from "../../src/editor/triggers";
import type { TriggerRecord } from "../../src/formats/chk/sections/triggers";
import { applyStringImport, encodeTrg, formatStringTable, parseStringTable, readTriggerFile, triggerFormatOf, triggersToText } from "../../src/editor/exchange";
import { defaultSaveOptions, formatOf, type MapFormat } from "../../src/editor/save";
import { STDIO, toStdout, writeFileMade } from "./files";
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

export interface TriggerImportOptions {
  briefing?: boolean;
  append?: boolean;
  /** Take a file with no triggers in it (which, replacing, leaves the map with none); refused otherwise. */
  allowEmpty?: boolean;
}

/** The Mission Briefing condition: only a briefing's triggers have it. */
const BRIEFING_CONDITION = 13;
/** The highest action type a briefing has (Skip Tutorial Enabled); a trigger's go to 60. */
const LAST_BRIEFING_ACTION = 9;

/**
 * Whether `.trg` records are a briefing's or the triggers', when they say: a briefing's have the Mission Briefing
 * condition and only the briefing's nine actions, the triggers' never have that condition. Null when nothing tells.
 */
export function trgKind(records: readonly TriggerRecord[]): "briefing" | "triggers" | null {
  let briefing = false, triggers = false;
  for (const r of records) {
    for (const c of r.conditions) { if (c.type === BRIEFING_CONDITION) briefing = true; else if (c.type !== 0) triggers = true; }
    for (const a of r.actions) if (a.type > LAST_BRIEFING_ACTION) triggers = true;
  }
  return briefing === triggers ? null : briefing ? "briefing" : "triggers";
}

/**
 * Replace the map's triggers (or briefing) with a file's — text or `.trg` by extension — or add them after the
 * map's own with `append`. Text the map cannot resolve fails with its line, and nothing changes. A file with no
 * triggers in it is refused unless `allowEmpty` (an export that failed would otherwise empty the map), and so is a
 * `.trg` of the other kind (a briefing's records read as triggers do things the game does not have).
 */
export function importTriggers(doc: OpenedMap, fileName: string, bytes: Uint8Array, { briefing = false, append = false, allowEmpty = false }: TriggerImportOptions = {}): TriggerImport {
  let read: TriggerRecord[];
  try {
    read = readTriggerFile(doc.scenario, fileName, bytes, briefing);
  } catch (e) {
    if (e instanceof TriggerTextError) throw new CliError(t("{file}, line {line}: {message}", { file: fileName, line: e.line, message: e.message.replace(/^Line \d+: /, "") }), t("The text form is the trigger window's; docs.scmjs.dev/triggers lists every condition and action."));
    throw new CliError(t("{file} is not a trigger file this can read: {reason}", { file: fileName, reason: String(e instanceof Error ? e.message : e) }));
  }
  const current = briefing ? readBriefing(doc.scenario) : readTriggers(doc.scenario);
  if (!read.length && !allowEmpty) {
    throw new CliError(briefing ? t("{file} holds no briefing triggers", { file: fileName }) : t("{file} holds no triggers", { file: fileName }),
      append ? t("There is nothing to add.") : t("Imported, it would leave the map with none of its {n}; --allow-empty does that on purpose.", { n: current.length }), 2);
  }
  if (triggerFormatOf(fileName) === "trg") {
    const kind = trgKind(read);
    if (kind === "briefing" && !briefing) throw new CliError(t("{file} holds a mission briefing's triggers", { file: fileName }), t("Import it with --briefing."), 2);
    if (kind === "triggers" && briefing) throw new CliError(t("{file} holds triggers, not a mission briefing's", { file: fileName }), t("Import it without --briefing."), 2);
  }
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
  if (!parsed.entries.length) throw new CliError(t("{file} holds no strings", { file: fileName }), t("Each line is the string's number, a tab, and its text; map strings export writes such a file."), 2);
  // A number given twice: the later line would win without a word, and the counts would say two strings changed.
  const seen = new Set<number>();
  for (const e of parsed.entries) {
    if (seen.has(e.index)) throw new CliError(t("{file}: string {n} is on two lines", { file: fileName, n: e.index }), t("Keep one line for each number."));
    seen.add(e.index);
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
  await writeFileMade(path, bytes);
  return { path, bytes: bytes.length };
}
