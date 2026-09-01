/**
 * Import / export of triggers and strings as files, the way SCMDraft trades them:
 *
 * - `.trg` is the raw TRIG record stream — one 2400-byte record per trigger, exactly the
 *   bytes of the section — so a file from SCMDraft's "Export triggers" reads here and ours
 *   reads there. The records carry string *indices*, so a .trg only makes sense between
 *   copies of the same map (or after the strings are imported too).
 * - Text triggers are the TrigEdit format (`formats/triggers/text.ts`), resolved through
 *   the open map's names; text the map cannot resolve fails with the line.
 * - Strings are one line per entry, `<index><TAB><text>`, with `\\`, `\n`, `\t` escaped
 *   and every other control character (the game's colour codes) written as `<XX>` hex;
 *   a literal `<` is written `\<`. Importing sets the given indices in place and appends
 *   past the end — never renumbers, since triggers and locations hold the indices.
 */
import { markDirty, strSectionName, type Scenario } from "../formats/chk/scenario";
import { setString, type StringTable } from "../formats/chk/sections/strings";
import { decodeTriggers, encodeTriggers, TRIGGER_STRIDE, type TriggerRecord } from "../formats/chk/sections/triggers";
import { formatTriggers, parseTriggers } from "../formats/triggers/text";
import { triggerNames } from "./triggers";

/* ── Triggers ────────────────────────────────────────────── */

export function encodeTrg(triggers: TriggerRecord[]): Uint8Array {
  return encodeTriggers(triggers);
}

/** Read a .trg; throws when the length is not a whole number of records. */
export function decodeTrg(bytes: Uint8Array): TriggerRecord[] {
  if (bytes.length === 0 || bytes.length % TRIGGER_STRIDE !== 0) {
    throw new Error(`Not a trigger file: ${bytes.length} bytes is not a multiple of ${TRIGGER_STRIDE}.`);
  }
  return decodeTriggers(bytes);
}

export function triggersToText(scn: Scenario, triggers: TriggerRecord[], briefing = false): string {
  return formatTriggers(triggers, triggerNames(scn), briefing);
}

/** Parse TrigEdit text against the map's names; throws `TriggerTextError` with the line. */
export function triggersFromText(scn: Scenario, text: string, briefing = false): TriggerRecord[] {
  return parseTriggers(text, triggerNames(scn), briefing).map((t) => t.trigger);
}

export type TriggerFileFormat = "trg" | "txt";

/** The format a file name implies: `.trg` is binary, anything else text. */
export function triggerFormatOf(fileName: string): TriggerFileFormat {
  return /\.trg$/i.test(fileName) ? "trg" : "txt";
}

/** Read either kind of trigger file. */
export function readTriggerFile(scn: Scenario, fileName: string, bytes: Uint8Array, briefing = false): TriggerRecord[] {
  if (triggerFormatOf(fileName) === "trg") return decodeTrg(bytes);
  return triggersFromText(scn, new TextDecoder("latin1").decode(bytes), briefing);
}

/* ── Strings ─────────────────────────────────────────────── */

export function escapeStringText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch === "<") out += "\\<";
    else if (code < 0x20) out += `<${code.toString(16).toUpperCase().padStart(2, "0")}>`;
    else out += ch;
  }
  return out;
}

export function unescapeStringText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      const next = text[++i];
      out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
      continue;
    }
    const m = ch === "<" ? /^<([0-9A-Fa-f]{2})>/.exec(text.slice(i)) : null;
    if (m) { out += String.fromCharCode(parseInt(m[1], 16)); i += 3; continue; }
    out += ch;
  }
  return out;
}

/** The whole table as text; unset slots are skipped. */
export function formatStringTable(table: StringTable): string {
  const lines: string[] = [];
  for (let i = 1; i < table.strings.length; i++) {
    const s = table.strings[i];
    if (s !== null && s !== undefined) lines.push(`${i}\t${escapeStringText(s)}`);
  }
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

export interface StringImport {
  entries: { index: number; text: string }[];
  /** Lines that were not `N<TAB>text`, with their 1-based line numbers. */
  errors: { line: number; message: string }[];
}

/** Parse the text format; blank lines and `#` / `//` comments are ignored. */
export function parseStringTable(text: string): StringImport {
  const entries: StringImport["entries"] = [];
  const errors: StringImport["errors"] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/^﻿/, "");
    if (line.trim() === "" || line.startsWith("#") || line.startsWith("//")) return;
    const m = /^(\d+)\t(.*)$/.exec(line);
    if (!m) { errors.push({ line: i + 1, message: "expected <index><TAB><text>" }); return; }
    const index = Number(m[1]);
    if (index < 1 || index > 0xffff) { errors.push({ line: i + 1, message: `string index ${index} is out of range (1–65535)` }); return; }
    entries.push({ index, text: unescapeStringText(m[2]) });
  });
  return { entries, errors };
}

/**
 * Write imported entries into the table: existing indices are replaced in place, an index
 * past the end appends (filling any gap with unset slots so the numbers stay as written).
 */
export function applyStringImport(scn: Scenario, entries: readonly { index: number; text: string }[]): { replaced: number; added: number } {
  let replaced = 0, added = 0;
  const table = scn.strings;
  for (const { index, text } of [...entries].sort((a, b) => a.index - b.index)) {
    if (index < table.strings.length) {
      if (table.strings[index] !== text) replaced++;
      setString(table, index, text);
    } else {
      while (table.strings.length < index) table.strings.push(null);
      table.strings.push(text);
      added++;
    }
  }
  if (replaced > 0 || added > 0) markDirty(scn, strSectionName(scn));
  return { replaced, added };
}
