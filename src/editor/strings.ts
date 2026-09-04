/**
 * The string table as the String Editor sees it: where every entry is referenced, which
 * ones nothing refers to, and how control bytes are shown.
 *
 * Indices are never renumbered (see the header of `sections/strings.ts`) — several
 * sections we round-trip as raw bytes may point into the table — so "deleting" a string
 * blanks its slot, and only unused slots at the very end are dropped.
 */
import { markDirty, scenarioDescription, scenarioName, strSectionName, type Scenario } from "../formats/chk/scenario";
import type { ActionRecord } from "../formats/chk/sections/triggers";
import { actionStrings } from "./triggers";
import { unitName } from "../data/units";

export type StringUsageKind = "name" | "description" | "force" | "location" | "unit" | "switch" | "trigger" | "briefing" | "wav";

export interface StringUsage {
  kind: StringUsageKind;
  /** What the kind indexes: force / slot / unit id / switch / trigger index / WAV slot; 0 for name and description. */
  ref: number;
  label: string;
}

/** Highest string index the game addresses: STR is a 16-bit table (StarEdit stops at 1024), STRx a 32-bit one. */
export function stringCapacity(scn: Scenario): number {
  return scn.strings.extended ? 65535 : 1024;
}

/** Every reference into the string table, by index. Index 0 ("none") is never listed. */
export function stringUsages(scn: Scenario): Map<number, StringUsage[]> {
  const out = new Map<number, StringUsage[]>();
  const add = (index: number, usage: StringUsage) => {
    if (index <= 0) return;
    const list = out.get(index);
    if (list) list.push(usage);
    else out.set(index, [usage]);
  };

  add(scn.nameIndex, { kind: "name", ref: 0, label: "Scenario name" });
  add(scn.descriptionIndex, { kind: "description", ref: 0, label: "Scenario description" });
  scn.forces.nameIndex.forEach((i, f) => add(i, { kind: "force", ref: f, label: `Force ${f + 1} name` }));
  scn.locations.forEach((l, i) => add(l.nameIndex, { kind: "location", ref: i, label: `Location ${i} name` }));
  scn.unitSettings?.nameIndex.forEach((i, id) => add(i, { kind: "unit", ref: id, label: `Unit name: ${unitName(id)}` }));
  scn.switchNames?.forEach((i, s) => add(i, { kind: "switch", ref: s, label: `Switch ${s + 1} name` }));
  scn.wavs?.forEach((i, slot) => add(i, { kind: "wav", ref: slot, label: `Sound ${slot}` }));

  const actions = (kind: "trigger" | "briefing", list: { actions: ActionRecord[] }[]) => {
    const noun = kind === "trigger" ? "Trigger" : "Briefing";
    list.forEach((t, ti) => {
      for (const a of t.actions) {
        for (const s of actionStrings(a, kind === "briefing")) add(s.index, { kind, ref: ti, label: `${noun} ${ti + 1}: ${s.action}${s.kind === "wav" ? " (WAV)" : ""}` });
      }
    });
  };
  actions("trigger", scn.triggers);
  actions("briefing", scn.briefing);
  return out;
}

/** Indices holding a string that nothing refers to. */
export function unusedStrings(scn: Scenario, usages = stringUsages(scn)): number[] {
  const out: number[] = [];
  for (let i = 1; i < scn.strings.strings.length; i++) if (scn.strings.strings[i] !== null && !usages.has(i)) out.push(i);
  return out;
}

/* ── Control bytes ───────────────────────────────────────── */

/**
 * StarCraft reads bytes 0x01–0x1F as colour and layout codes; `editor/textColors.ts` is
 * the table of what each one means and what it looks like. Tab, line feed and carriage
 * return stay literal so multi-line text edits naturally; everything else below 0x20
 * shows as `<XX>`.
 */
const LITERAL_CONTROLS = new Set([0x09, 0x0a, 0x0d]);

export function escapeControls(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    out += c < 0x20 && !LITERAL_CONTROLS.has(c) ? `<${c.toString(16).toUpperCase().padStart(2, "0")}>` : ch;
  }
  return out;
}

/** The inverse: `<XX>` with a hex value below 0x20 becomes that byte; any other text is left as typed. */
export function unescapeControls(text: string): string {
  return text.replace(/<([0-9A-Fa-f]{2})>/g, (m, hex: string) => {
    const c = parseInt(hex, 16);
    return c < 0x20 ? String.fromCharCode(c) : m;
  });
}

/* ── Working copies ──────────────────────────────────────── */

export function readStrings(scn: Scenario): (string | null)[] {
  return scn.strings.strings.slice();
}

/** Blank every entry nothing refers to (slots stay; see `applyStrings`). */
export function deleteUnused(list: (string | null)[], usages: Map<number, StringUsage[]>): (string | null)[] {
  return list.map((s, i) => (i === 0 || s === null || usages.has(i) ? s : null));
}

/**
 * Install an edited copy of the table. Trailing blank slots nothing refers to are dropped;
 * every other index keeps its place. Marks STR / STRx dirty only when something differs.
 */
export function applyStrings(scn: Scenario, next: (string | null)[], usages = stringUsages(scn)): boolean {
  const list = next.slice();
  if (list.length === 0) list.push(null);
  list[0] = null;
  let end = list.length;
  while (end > 1 && list[end - 1] === null && !usages.has(end - 1)) end--;
  list.length = end;
  const before = scn.strings.strings;
  const same = before.length === list.length && before.every((s, i) => s === list[i]);
  if (same) return false;
  scn.strings.strings = list;
  markDirty(scn, strSectionName(scn));
  return true;
}

/** One-line preview of an entry for lists: control codes escaped, line breaks flattened. */
export function previewString(text: string | null): string {
  return text === null ? "" : escapeControls(text).replace(/\r?\n/g, " ⏎ ");
}

export { scenarioName, scenarioDescription };
