/**
 * Undo for what the dialogs write: the settings tables, the triggers, the briefing and the
 * string table.
 *
 * A dialog does not hand over a change list — it writes its tables and commits — so the
 * change is found afterwards, against a *baseline*: the tables as they were after the last
 * change the editor knows of. The difference becomes a `TablesEdit` on a history entry and
 * the baseline moves on. Everything else that changes the tables (an edit that names a
 * location, an undo, other people's changes on a shared map) moves the baseline too, so a
 * dialog's entry only ever holds what the dialog did.
 *
 * Applying one in either direction checks each part against what it expects to find and
 * leaves a part alone when the map has moved on — on a shared map someone else may have
 * written the same table since, and their newer write must not be undone with yours.
 *
 * The small tables are kept as JSON text. The trigger lists are kept as the records
 * themselves and compared field by field (JSON of a few thousand triggers is tens of
 * megabytes): nothing writes to a record in place (a list is always replaced by clones),
 * so entries share the records an edit left alone and a long history of trigger edits does
 * not hold a copy of the list per step.
 */
import { markDirty, strSectionName, type Scenario } from "../formats/chk/scenario";
import { cloneTrigger, type TriggerRecord } from "../formats/chk/sections/triggers";
import type { TextEncoding } from "../formats/text/encoding";
import { FIELD_SECTIONS, SYNC_FIELDS, pack, unpack, type SyncField } from "./sync";

type ListField = "triggers" | "briefing";
type ValueField = Exclude<SyncField, ListField>;

const LIST_FIELDS: readonly ListField[] = ["triggers", "briefing"];
const VALUE_FIELDS = SYNC_FIELDS.filter((f): f is ValueField => f !== "triggers" && f !== "briefing");

interface StringsFormat {
  extended: boolean;
  encoding: TextEncoding;
}

interface ListBaseline {
  /** The scenario's own array when the records were taken: the same array again means nothing changed. */
  source: TriggerRecord[];
  records: TriggerRecord[];
}

export interface TablesBaseline {
  values: Map<ValueField, string>;
  lists: Record<ListField, ListBaseline>;
  strings: (string | null)[];
  format: StringsFormat;
}

interface Change<T> {
  before: T;
  after: T;
}

/** What one dialog commit changed, each part with both of its sides. */
export interface TablesEdit {
  /** The changed tables as JSON text (`pack`ed). */
  values?: Partial<Record<ValueField, Change<string>>>;
  lists?: Partial<Record<ListField, Change<TriggerRecord[]>>>;
  /** String slots that changed: `[index, before, after]`. */
  strings?: [number, string | null, string | null][];
  stringsLength?: Change<number>;
  stringsFormat?: Change<StringsFormat>;
  /** The archive's files, when the commit changed them too (the Sound Editor). */
  extras?: Change<Map<string, Uint8Array>>;
}

const json = (value: unknown) => JSON.stringify(pack(value));

type Row = Readonly<Record<string, number>>;

function sameRows(a: readonly Row[], b: readonly Row[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    for (const k in x) if (x[k] !== y[k]) return false;
  }
  return true;
}

function sameRecord(a: TriggerRecord, b: TriggerRecord): boolean {
  if (a === b) return true;
  if (a.flags !== b.flags || a.currentAction !== b.currentAction || a.players.length !== b.players.length) return false;
  for (let i = 0; i < a.players.length; i++) if (a.players[i] !== b.players[i]) return false;
  return sameRows(a.conditions as unknown as Row[], b.conditions as unknown as Row[]) && sameRows(a.actions as unknown as Row[], b.actions as unknown as Row[]);
}

// A record's hash, computed once: records are never written in place. It only narrows the
// search — `sameRecord` decides.
const recordHash = new WeakMap<TriggerRecord, number>();
function hashOf(record: TriggerRecord): number {
  let h = recordHash.get(record);
  if (h !== undefined) return h;
  h = 0x811c9dc5 ^ record.flags;
  const mix = (v: number) => { h = Math.imul(h! ^ v, 0x01000193); };
  for (const p of record.players) mix(p);
  for (const rows of [record.conditions, record.actions] as unknown as Row[][]) {
    mix(rows.length);
    for (const row of rows) for (const k in row) mix(row[k]);
  }
  recordHash.set(record, h);
  return h;
}

function sameRecords(a: readonly TriggerRecord[], b: readonly TriggerRecord[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameRecord(a[i], b[i])) return false;
  return true;
}

export function captureTables(scn: Scenario): TablesBaseline {
  const values = new Map<ValueField, string>();
  for (const f of VALUE_FIELDS) values.set(f, json(scn[f]));
  return {
    values,
    lists: {
      triggers: { source: scn.triggers, records: scn.triggers.slice() },
      briefing: { source: scn.briefing, records: scn.briefing.slice() },
    },
    strings: scn.strings.strings.slice(),
    format: { extended: scn.strings.extended, encoding: scn.strings.encoding },
  };
}

/**
 * What took `base` to the map as it is now (null when nothing did), and the baseline to
 * carry on from.
 */
export function diffTables(scn: Scenario, base: TablesBaseline): { edit: TablesEdit | null; next: TablesBaseline } {
  const edit: TablesEdit = {};
  let any = false;

  const values = new Map(base.values);
  for (const f of VALUE_FIELDS) {
    const after = json(scn[f]);
    const before = base.values.get(f)!;
    if (after === before) continue;
    (edit.values ??= {})[f] = { before, after };
    values.set(f, after);
    any = true;
  }

  const lists = { ...base.lists };
  for (const f of LIST_FIELDS) {
    const now = scn[f];
    const was = base.lists[f];
    if (now === was.source) continue;
    if (sameRecords(now, was.records)) { lists[f] = { source: now, records: was.records }; continue; }
    // The records the edit left alone stay the ones the last entry holds, wherever they moved to.
    const known = new Map<number, TriggerRecord[]>();
    for (const r of was.records) {
      const bucket = known.get(hashOf(r));
      if (bucket) bucket.push(r);
      else known.set(hashOf(r), [r]);
    }
    const after = now.map((r) => known.get(hashOf(r))?.find((k) => sameRecord(k, r)) ?? r);
    (edit.lists ??= {})[f] = { before: was.records, after };
    lists[f] = { source: now, records: after };
    any = true;
  }

  const now = scn.strings.strings;
  const strings: [number, string | null, string | null][] = [];
  for (let i = 1; i < Math.max(now.length, base.strings.length); i++) {
    const b = base.strings[i] ?? null;
    const a = now[i] ?? null;
    if (a !== b) strings.push([i, b, a]);
  }
  if (strings.length) { edit.strings = strings; any = true; }
  if (now.length !== base.strings.length) { edit.stringsLength = { before: base.strings.length, after: now.length }; any = true; }
  const format: StringsFormat = { extended: scn.strings.extended, encoding: scn.strings.encoding };
  if (format.extended !== base.format.extended || format.encoding !== base.format.encoding) {
    edit.stringsFormat = { before: base.format, after: format };
    any = true;
  }

  return { edit: any ? edit : null, next: { values, lists, strings: now.slice(), format } };
}

/**
 * Apply an edit forward (`"do"`) or take it back (`"undo"`). A part is applied only where
 * the map still holds what the edit left there; the answer counts the parts applied and
 * the ones the map had moved on from. `extras` is the caller's (it lives in an atom).
 */
export function applyTables(scn: Scenario, edit: TablesEdit, direction: "do" | "undo"): { applied: number; skipped: number } {
  const from = <T>(c: Change<T>) => (direction === "do" ? c.before : c.after);
  const to = <T>(c: Change<T>) => (direction === "do" ? c.after : c.before);
  let applied = 0;
  let skipped = 0;

  // In `SYNC_FIELDS` order: the file version goes first, and the sections the unit,
  // upgrade and technology tables are written to follow from it.
  for (const f of VALUE_FIELDS) {
    const change = edit.values?.[f];
    if (!change) continue;
    if (json(scn[f]) !== from(change)) { skipped++; continue; }
    (scn as unknown as Record<string, unknown>)[f] = unpack(JSON.parse(to(change)));
    markDirty(scn, ...FIELD_SECTIONS[f](scn));
    applied++;
  }

  for (const f of LIST_FIELDS) {
    const change = edit.lists?.[f];
    if (!change) continue;
    if (!sameRecords(scn[f], from(change))) { skipped++; continue; }
    scn[f] = to(change).map(cloneTrigger);
    markDirty(scn, ...FIELD_SECTIONS[f](scn));
    applied++;
  }

  if (edit.stringsFormat) {
    const want = from(edit.stringsFormat);
    if (scn.strings.extended === want.extended && scn.strings.encoding === want.encoding) {
      const next = to(edit.stringsFormat);
      scn.strings.extended = next.extended;
      scn.strings.encoding = next.encoding;
      markDirty(scn, "STR ", "STRx");
      applied++;
    } else {
      skipped++;
    }
  }

  if (edit.strings || edit.stringsLength) {
    const table = scn.strings.strings.slice();
    for (const [i, before, after] of edit.strings ?? []) {
      const want = direction === "do" ? before : after;
      const next = direction === "do" ? after : before;
      if ((table[i] ?? null) !== want) { skipped++; continue; }
      while (table.length <= i) table.push(null);
      table[i] = next;
      applied++;
    }
    if (edit.stringsLength) {
      // Only blank slots are dropped: a string someone else put past the end stays.
      const length = Math.max(1, to(edit.stringsLength));
      let end = table.length;
      while (end > length && table[end - 1] === null) end--;
      table.length = end;
      while (table.length < length) table.push(null);
    }
    scn.strings.strings = table;
    markDirty(scn, strSectionName(scn));
  }

  return { applied, skipped };
}

/**
 * How much an edit keeps alive that nothing else does, in condition and action rows: the
 * trigger records on one side of it only. The history is trimmed by this as well as by
 * depth (`TABLES_BUDGET`) — a script that rebuilds thousands of triggers on every run would
 * otherwise hold a list per undo level.
 */
export function tablesWeight(edit: TablesEdit): number {
  let rows = 0;
  for (const f of LIST_FIELDS) {
    const change = edit.lists?.[f];
    if (!change) continue;
    const before = new Set(change.before);
    const after = new Set(change.after);
    for (const r of change.before) if (!after.has(r)) rows += r.conditions.length + r.actions.length;
    for (const r of change.after) if (!before.has(r)) rows += r.conditions.length + r.actions.length;
  }
  return rows;
}

/** The rows the history may hold for trigger edits: about 100 MB of records at the worst. */
export const TABLES_BUDGET = 1_000_000;

/** Which kind of change an edit mostly is, for the Edit menu's words when the caller gave none. */
export function tablesKind(edit: TablesEdit): "triggers" | "briefing" | "sounds" | "settings" | "strings" {
  if (edit.lists?.triggers) return "triggers";
  if (edit.lists?.briefing) return "briefing";
  if (edit.extras || edit.values?.wavs) return "sounds";
  if (edit.values) return "settings";
  return "strings";
}

/* ── The baseline of each open map ───────────────────────── */

// By scenario object, so a parked map keeps its own and a map parsed again starts afresh.
const baselines = new WeakMap<Scenario, TablesBaseline>();

/** Start following a map's tables, if they are not followed yet (a map just installed). */
export function followTables(scn: Scenario) {
  if (!baselines.has(scn)) baselines.set(scn, captureTables(scn));
}

/** The tables changed by other means than a dialog (a whole-document change, other people's edits): carry on from here. */
export function rebaseTables(scn: Scenario) {
  baselines.set(scn, captureTables(scn));
}

/** The string table alone, after an edit that may have named a location. */
export function rebaseStrings(scn: Scenario) {
  const base = baselines.get(scn);
  if (base) baselines.set(scn, { ...base, strings: scn.strings.strings.slice() });
}

/**
 * What a dialog just wrote, or null when nothing differs — or when the map was not being
 * followed (a scenario put in place behind the editor's back), in which case it is from now.
 */
export function takeTablesEdit(scn: Scenario): TablesEdit | null {
  const base = baselines.get(scn);
  if (!base) { baselines.set(scn, captureTables(scn)); return null; }
  const { edit, next } = diffTables(scn, base);
  baselines.set(scn, next);
  return edit;
}

/**
 * After an entry's tables were applied: carry on from the map as it is, keeping the trigger
 * records the entry holds where they are the ones now in the map.
 */
export function rebaseAfterTables(scn: Scenario, edit: TablesEdit, direction: "do" | "undo") {
  const base = captureTables(scn);
  for (const f of LIST_FIELDS) {
    const change = edit.lists?.[f];
    if (!change) continue;
    const records = direction === "do" ? change.after : change.before;
    if (sameRecords(scn[f], records)) base.lists[f] = { source: scn[f], records };
  }
  baselines.set(scn, base);
}
