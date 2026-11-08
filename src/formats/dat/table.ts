/**
 * Every `arr\*.dat` table read and written through one schema (`schema.ts`), in all three layouts — the game's
 * `.dat`, DatExtend's expanded `.dat` and GPTP's `.datex` — with the width (the entry count) taken from the file's
 * length, never from a rule. Values come out as typed columns (`DatFile.columns`, one array a field, entry-major
 * for the struct fields) and as row objects; PyDAT TXT, PyMS's text form of a table, goes both ways.
 *
 * The older `dat.ts` decodes the handful of columns the editor draws with and stays as it is; this is the whole table.
 */
import { DAT_SCHEMAS, type DatField, type DatSchema, type DatTableName, type DatValueType } from "./schema";

export type DatLayout = "dat" | "expanded" | "datex";

type Column = Uint8Array | Uint16Array | Uint32Array;

export interface DatFile {
  table: DatTableName;
  layout: DatLayout;
  /** Entries in the file. */
  count: number;
  /** units.dat from before Brood War: no `broodwar_unit_flag` / `staredit_availability_flags` columns. */
  legacy: boolean;
  /**
   * One array a field, `count × parts` long (parts entry by entry: width, height, width, …). In the standard layout an
   * entry outside a field's stored range reads 0 and is not written.
   */
  columns: Record<string, Column>;
}

/** A row: plain fields as numbers, struct fields (`unit_extents`) as `{ left, up, right, down }`. A field the entry does not store is absent. */
export type DatRow = Record<string, number | Record<string, number>>;

const BYTES: Record<DatValueType, number> = { u8: 1, u16: 2, u32: 4 };
const MAX: Record<DatValueType, number> = { u8: 0xff, u16: 0xffff, u32: 0xffffffff };

export function datSchema(table: DatTableName | DatSchema): DatSchema {
  return typeof table === "string" ? DAT_SCHEMAS[table] : table;
}

/** The field's width in a layout. */
export function fieldType(field: DatField, layout: DatLayout): DatValueType {
  return layout === "datex" ? field.datex ?? field.type : layout === "expanded" ? field.expanded ?? field.type : field.type;
}

function partsOf(field: DatField): number {
  return field.parts?.length ?? 1;
}

/** The ids a field stores in a layout: [first, end). */
export function storedRange(field: DatField, layout: DatLayout, count: number): [number, number] {
  if (layout === "dat" && field.count !== undefined) return [field.first ?? 0, (field.first ?? 0) + field.count];
  return [0, count];
}

function fieldsOf(schema: DatSchema, legacy: boolean): readonly DatField[] {
  return legacy ? schema.fields.filter((f) => !f.broodWar) : schema.fields;
}

/** Bytes an entry takes when every column is at the full count (the expanded and `.datex` layouts). */
export function datEntrySize(table: DatTableName | DatSchema, layout: "expanded" | "datex"): number {
  return datSchema(table).fields.reduce((n, f) => n + BYTES[fieldType(f, layout)] * partsOf(f), 0);
}

/** The game's own file size for the table (19876 for units.dat; 19192 with `legacy`). */
export function datStandardSize(table: DatTableName | DatSchema, legacy = false): number {
  const schema = datSchema(table);
  return fieldsOf(schema, legacy).reduce((n, f) => n + BYTES[f.type] * partsOf(f) * (f.count ?? schema.entries), 0);
}

export interface DatShape {
  layout: DatLayout;
  count: number;
  legacy: boolean;
}

/**
 * The layout and width a file of `size` bytes has. A `.datex` name means GPTP's layout; otherwise the game's size is
 * the standard layout, and any other multiple of an entry is DatExtend's expanded one (PyMS's reading), else `.datex`'s.
 * Null when the size fits none.
 */
export function datShape(table: DatTableName | DatSchema, size: number, fileName?: string): DatShape | null {
  const schema = datSchema(table);
  const datex = datEntrySize(schema, "datex");
  if (fileName && /\.datex$/i.test(fileName)) return size % datex === 0 ? { layout: "datex", count: size / datex, legacy: false } : null;
  if (size === datStandardSize(schema)) return { layout: "dat", count: schema.entries, legacy: false };
  if (schema.fields.some((f) => f.broodWar) && size === datStandardSize(schema, true)) return { layout: "dat", count: schema.entries, legacy: true };
  const expanded = datEntrySize(schema, "expanded");
  if (size > 0 && size % expanded === 0) return { layout: "expanded", count: size / expanded, legacy: false };
  if (size > 0 && size % datex === 0) return { layout: "datex", count: size / datex, legacy: false };
  return null;
}

function newColumn(field: DatField, count: number): Column {
  const widest = Math.max(BYTES[field.type], BYTES[field.expanded ?? field.type], BYTES[field.datex ?? field.type]);
  const n = count * partsOf(field);
  return widest === 1 ? new Uint8Array(n) : widest === 2 ? new Uint16Array(n) : new Uint32Array(n);
}

/** An empty table of `count` entries (all zeros). */
export function emptyDat(table: DatTableName, count = DAT_SCHEMAS[table].entries, layout: DatLayout = count === DAT_SCHEMAS[table].entries ? "dat" : "expanded"): DatFile {
  const schema = DAT_SCHEMAS[table];
  const columns: Record<string, Column> = {};
  for (const f of schema.fields) columns[f.name] = newColumn(f, count);
  return { table, layout, count, legacy: false, columns };
}

export interface DecodeDatOptions {
  /** The file's name (`units.datex`): a `.datex` name picks GPTP's layout. */
  fileName?: string;
  /** Read as this layout, the count from the size. */
  layout?: DatLayout;
}

/** A whole table. Throws when the size fits no layout of the table. */
export function decodeDat(table: DatTableName, data: Uint8Array, options: DecodeDatOptions = {}): DatFile {
  const schema = DAT_SCHEMAS[table];
  let shape: DatShape | null;
  if (options.layout === "dat") shape = datShape(schema, data.length) ?? null;
  else if (options.layout) {
    const entry = datEntrySize(schema, options.layout);
    shape = data.length % entry === 0 ? { layout: options.layout, count: data.length / entry, legacy: false } : null;
  } else shape = datShape(schema, data.length, options.fileName);
  if (!shape || (options.layout && shape.layout !== options.layout)) {
    throw new Error(`${options.fileName ?? schema.file} is ${data.length} bytes, which is no ${options.layout ?? "known"} layout of ${table} (the game's is ${datStandardSize(schema)} bytes; an expanded entry is ${datEntrySize(schema, "expanded")}, a .datex one ${datEntrySize(schema, "datex")})`);
  }
  const { layout, count, legacy } = shape;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = emptyDat(table, count, layout);
  out.legacy = legacy;
  let at = 0;
  for (const field of fieldsOf(schema, legacy)) {
    const type = fieldType(field, layout);
    const parts = partsOf(field);
    const [from, to] = storedRange(field, layout, count);
    const col = out.columns[field.name];
    const n = (to - from) * parts;
    const base = from * parts;
    if (type === "u8") for (let i = 0; i < n; i++) col[base + i] = data[at + i];
    else if (type === "u16") for (let i = 0; i < n; i++) col[base + i] = view.getUint16(at + i * 2, true);
    else for (let i = 0; i < n; i++) col[base + i] = view.getUint32(at + i * 4, true);
    at += n * BYTES[type];
  }
  return out;
}

/** The file's bytes, in its own layout (or `layout`, at the same count). Throws when a value does not fit its column. */
export function encodeDat(file: DatFile, layout: DatLayout = file.layout): Uint8Array {
  const schema = DAT_SCHEMAS[file.table];
  if (layout === "dat" && file.count !== schema.entries) throw new Error(`${file.table}: the standard layout has ${schema.entries} entries, not ${file.count}`);
  const legacy = layout === "dat" && file.legacy;
  const fields = fieldsOf(schema, legacy);
  let size = 0;
  for (const f of fields) {
    const [from, to] = storedRange(f, layout, file.count);
    size += (to - from) * partsOf(f) * BYTES[fieldType(f, layout)];
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const field of fields) {
    const type = fieldType(field, layout);
    const parts = partsOf(field);
    const [from, to] = storedRange(field, layout, file.count);
    const col = file.columns[field.name];
    const n = (to - from) * parts;
    const base = from * parts;
    const max = MAX[type];
    for (let i = 0; i < n; i++) {
      const v = col[base + i];
      if (v > max) throw new Error(`${file.table} ${field.name} of entry ${Math.floor((base + i) / parts)} is ${v}, more than a ${type} column holds in the ${layout} layout`);
      if (type === "u8") out[at + i] = v;
      else if (type === "u16") view.setUint16(at + i * 2, v, true);
      else view.setUint32(at + i * 4, v, true);
    }
    at += n * BYTES[type];
  }
  return out;
}

/** Whether entry `id` stores `field` in the file's layout. */
export function datHas(file: DatFile, field: DatField, id: number): boolean {
  if (file.legacy && file.layout === "dat" && field.broodWar) return false;
  const [from, to] = storedRange(field, file.layout, file.count);
  return id >= from && id < to;
}

/** Entry `id` as a row. */
export function datRow(file: DatFile, id: number): DatRow {
  const row: DatRow = {};
  for (const field of DAT_SCHEMAS[file.table].fields) {
    if (!datHas(file, field, id)) continue;
    const col = file.columns[field.name];
    if (field.parts) {
      const parts: Record<string, number> = {};
      field.parts.forEach((p, i) => { parts[p] = col[id * field.parts!.length + i]; });
      row[field.name] = parts;
    } else row[field.name] = col[id];
  }
  return row;
}

/** Every entry as a row. */
export function datRows(file: DatFile): DatRow[] {
  return Array.from({ length: file.count }, (_, id) => datRow(file, id));
}

/** Set the fields a row names on entry `id` (others are left as they are). */
export function setDatRow(file: DatFile, id: number, row: DatRow) {
  const schema = DAT_SCHEMAS[file.table];
  for (const [name, value] of Object.entries(row)) {
    const field = schema.fields.find((f) => f.name === name);
    if (!field) throw new Error(`${file.table} has no field ${name}`);
    const col = file.columns[name];
    if (field.parts) {
      if (typeof value !== "object") throw new Error(`${file.table} ${name} is a struct (${field.parts.join(", ")})`);
      field.parts.forEach((p, i) => { if (value[p] !== undefined) col[id * field.parts!.length + i] = value[p]; });
    } else {
      if (typeof value !== "number") throw new Error(`${file.table} ${name} is a number`);
      col[id] = value;
    }
  }
}

/** A table from rows (entry i = rows[i]), in a layout. */
export function datFromRows(table: DatTableName, rows: readonly DatRow[], layout?: DatLayout): DatFile {
  const file = emptyDat(table, rows.length, layout);
  rows.forEach((row, id) => setDatRow(file, id, row));
  return file;
}

/* ── PyDAT TXT ─────────────────────────────────────────────────────────── */

const flagName = (bit: number, names: readonly string[]) => names[bit] || `flag_0x${(2 ** bit).toString(16).toUpperCase().padStart(2, "0")}`;
const boolText = (v: number) => (v === 0 ? "False" : v === 1 ? "True" : String(v));

/** The lines PyDAT TXT writes for one field of one entry. */
function fieldLines(field: DatField, file: DatFile, id: number, out: string[]) {
  const col = file.columns[field.name];
  const name = field.textName ?? field.name;
  if (field.parts) {
    field.parts.forEach((p, i) => out.push(`\t${name}.${p} ${col[id * field.parts!.length + i]}`));
    return;
  }
  const v = col[id];
  const text = field.text;
  if (!text) out.push(`\t${name} ${v}`);
  else if (text.kind === "bool") out.push(`\t${name} ${boolText(v)}`);
  else if (text.kind === "hitPoints") out.push(`\t${name}.whole ${Math.floor(v / 256)}`, `\t${name}.fraction ${v & 0xff}`);
  else if (text.kind === "supply") out.push(`\t${name}.whole ${v >> 1}`, `\t${name}.half ${v & 1 ? "True" : "False"}`);
  else {
    for (let bit = 0; bit < text.bits; bit++) out.push(`\t${name}.${flagName(bit, text.names)} ${(v >>> bit) & 1 ? "True" : "False"}`);
    // PyDAT writes only the bits it names; a bit beyond them that is set is kept, in PyDAT's own spelling.
    for (let bit = text.bits; bit < 32; bit++) if ((v >>> bit) & 1) out.push(`\t${name}.${flagName(bit, text.names)} True`);
  }
}

function textFields(schema: DatSchema): DatField[] {
  return schema.textOrder ? schema.textOrder.map((n) => schema.fields.find((f) => f.name === n)!) : [...schema.fields];
}

export interface DatToTextOptions {
  /** A name for an entry, written after its header as a comment (`Unit(0):  # Terran Marine`), which PyDAT skips. */
  name?: (id: number) => string | undefined;
}

/** PyDAT TXT: one block an entry (`Unit(0):`, then a tab-indented `field value` line each), a blank line after each. */
export function datToText(file: DatFile, ids?: readonly number[] | null, options: DatToTextOptions = {}): string {
  const schema = DAT_SCHEMAS[file.table];
  const fields = textFields(schema);
  const lines: string[] = [];
  for (const id of ids ?? Array.from({ length: file.count }, (_, i) => i)) {
    // (PyDAT's comment rule is `\s*#.+`: a name of nothing but spaces is left out rather than written as a bare `#`.)
    const name = options.name?.(id)?.replace(/[\r\n]+/g, " ").trim();
    lines.push(`${schema.textType}(${id}):${name ? `  # ${name}` : ""}`);
    for (const f of fields) if (datHas(file, f, id)) fieldLines(f, file, id, lines);
    lines.push("");
  }
  return lines.join("\n");
}

export interface DatTextEntry {
  type: string;
  id: number;
  /** Line number (1-based) of the header. */
  line: number;
  /** `field` or `field.part` → value; True/False as 1/0. */
  values: Map<string, { value: number; line: number }>;
}

export class DatTextError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}

/** PyDAT TXT's entries, as written (no schema applied). `#` starts a comment. */
export function parseDatText(text: string): DatTextEntry[] {
  const entries: DatTextEntry[] = [];
  const seen = new Set<number>();
  let entry: DatTextEntry | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const line = raw.replace(/\s*#.*$/, "");
    if (!line.trim()) return;
    const header = /^\s*(\w+)\((\d+)?\):\s*$/.exec(line);
    if (header) {
      if (header[2] === undefined) throw new DatTextError("entry header has no id", n);
      const id = Number(header[2]);
      if (seen.has(id)) throw new DatTextError(`entry ${id} appears twice`, n);
      seen.add(id);
      entry = { type: header[1], id, line: n, values: new Map() };
      entries.push(entry);
      return;
    }
    const prop = /^\s*(\w+(?:\.\w+)?)\s+(\d+|0x[0-9a-fA-F]+|True|False)\s*$/.exec(line);
    if (prop) {
      if (!entry) throw new DatTextError("a field before any entry header", n);
      const v = prop[2] === "True" ? 1 : prop[2] === "False" ? 0 : Number(prop[2]);
      entry.values.set(prop[1], { value: v, line: n });
      return;
    }
    throw new DatTextError(`expected an entry header (Name(id):) or a field line, got "${raw.trim()}"`, n);
  });
  return entries;
}

/** Apply one parsed entry's values to `file`. */
function applyTextEntry(file: DatFile, schema: DatSchema, entry: DatTextEntry) {
  if (entry.type !== schema.textType) throw new DatTextError(`a ${entry.type} entry in a ${schema.textType} table`, entry.line);
  if (entry.id >= file.count) throw new DatTextError(`entry ${entry.id} is past the table's ${file.count} entries`, entry.line);
  const left = new Map(entry.values);
  const take = (key: string) => { const v = left.get(key); left.delete(key); return v; };
  for (const field of schema.fields) {
    const name = field.textName ?? field.name;
    const touched = [...left.keys()].some((k) => k === name || k.startsWith(`${name}.`));
    if (!touched) continue;
    if (!datHas(file, field, entry.id)) {
      const first = [...left.entries()].find(([k]) => k === name || k.startsWith(`${name}.`))!;
      throw new DatTextError(`${name} is not stored for entry ${entry.id} in the ${file.layout} layout`, first[1].line);
    }
    const col = file.columns[field.name];
    const id = entry.id;
    if (field.parts) {
      field.parts.forEach((p, i) => { const v = take(`${name}.${p}`); if (v) col[id * field.parts!.length + i] = v.value; });
      continue;
    }
    const text = field.text;
    if (!text || text.kind === "bool") {
      const v = take(name);
      if (v) col[id] = v.value;
    } else if (text.kind === "hitPoints") {
      const whole = take(`${name}.whole`), fraction = take(`${name}.fraction`);
      col[id] = (whole ? whole.value : Math.floor(col[id] / 256)) * 256 + (fraction ? fraction.value : col[id] & 0xff);
    } else if (text.kind === "supply") {
      const whole = take(`${name}.whole`), half = take(`${name}.half`);
      col[id] = ((whole ? whole.value : col[id] >> 1) << 1) | (half ? half.value & 1 : col[id] & 1);
    } else {
      let v = 0;
      // Deleting the entry being visited is safe while iterating a Map.
      for (const [key, { value, line }] of left) {
        if (!key.startsWith(`${name}.`)) continue;
        const flag = key.slice(name.length + 1);
        let bit = text.names.indexOf(flag);
        if (bit < 0 || !flag) {
          const hex = /^flag_0x([0-9a-fA-F]+)$/.exec(flag);
          const mask = hex ? parseInt(hex[1], 16) : 0;
          if (!hex || mask === 0 || (mask & (mask - 1)) !== 0) throw new DatTextError(`${name} has no flag ${flag}`, line);
          bit = Math.log2(mask);
        }
        if (value) v = (v | 2 ** bit) >>> 0;
        left.delete(key);
      }
      col[id] = v;
    }
  }
  const stray = [...left.entries()][0];
  if (stray) throw new DatTextError(`${schema.textType} has no field ${stray[0]}`, stray[1].line);
}

export interface DatFromTextOptions {
  /** Apply the text over this table (a copy is made); entries and fields the text leaves out keep its values. */
  base?: DatFile;
  /** Without a base: the layout of the new table (the game's when the entries are its count, else expanded). */
  layout?: DatLayout;
  /** Without a base: the entry count (default: the highest id in the text + 1, at least the game's count). */
  count?: number;
}

/** A table from PyDAT TXT. */
export function datFromText(table: DatTableName, text: string, options: DatFromTextOptions = {}): DatFile {
  const schema = DAT_SCHEMAS[table];
  const entries = parseDatText(text);
  let file: DatFile;
  if (options.base) {
    file = { ...options.base, columns: Object.fromEntries(Object.entries(options.base.columns).map(([k, c]) => [k, c.slice()])) };
  } else {
    const count = options.count ?? Math.max(schema.entries, ...entries.map((e) => e.id + 1));
    file = emptyDat(table, count, options.layout ?? (count === schema.entries ? "dat" : "expanded"));
  }
  for (const entry of entries) applyTextEntry(file, schema, entry);
  return file;
}
