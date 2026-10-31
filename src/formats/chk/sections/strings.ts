import { Writer } from "../binary";
import { decodeText, detectTextEncoding, encodeText, unencodable, type TextEncoding } from "../../text/encoding";

/**
 * STR/STRx string table.
 *
 * Index 0 means "no string" and is never stored. Indices are referenced from TRIG,
 * MRGN, SPRP and friends — several of which we round-trip as raw bytes — so the table
 * must keep its index space stable across a save. Entries are therefore addressed by
 * position, never renumbered.
 *
 * The bytes carry no note of their encoding (see `text/encoding.ts`): `decodeStrings`
 * guesses one from the whole table's bytes unless told, and `encodeStrings` writes the
 * table's, so a file opened and saved keeps its bytes and a Korean file edited on a
 * Korean game stays readable there.
 */
export interface StringTable {
  /** `strings[i]` is string index `i`; slot 0 is always null. */
  strings: (string | null)[];
  /** True when the source section was STRx (Remastered, 32-bit count and offsets). */
  extended: boolean;
  /** How the text is written to bytes; guessed on open, a setting afterwards. */
  encoding: TextEncoding;
}

export function decodeStrings(data: Uint8Array, extended: boolean, encoding?: TextEncoding): StringTable {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = extended ? 4 : 2;
  const read = (at: number) => (extended ? view.getUint32(at, true) : view.getUint16(at, true));

  if (data.length < width) return { strings: [null], extended, encoding: encoding ?? detectTextEncoding(data) };
  const count = read(0);
  const strings: (string | null)[] = [null];
  const spans: [number, number][] = [];

  for (let i = 1; i <= count; i++) {
    const at = i * width;
    if (at + width > data.length) { strings.push(null); continue; }
    const offset = read(at);
    if (offset >= data.length) { strings.push(null); continue; }
    let end = offset;
    while (end < data.length && data[end] !== 0) end++;
    strings.push("");
    spans.push([offset, end]);
  }

  // The guess reads every string's bytes at once, so one Hangul name among ASCII
  // triggers is enough to tip it and one stray high byte is not.
  if (!encoding) {
    const total = spans.reduce((n, [a, b]) => n + (b - a), 0);
    const all = new Uint8Array(total);
    let n = 0;
    for (const [a, b] of spans) { all.set(data.subarray(a, b), n); n += b - a; }
    encoding = detectTextEncoding(all);
  }
  let s = 0;
  for (let i = 1; i <= count; i++) {
    if (strings[i] === "") { const [a, b] = spans[s++]; strings[i] = decodeText(data.subarray(a, b), encoding); }
  }

  return { strings, extended, encoding };
}

/**
 * Every string with a character the table's encoding cannot hold — what `encodeStrings`
 * would write as `?` — by index, with the characters themselves.
 */
export function unencodableStrings(table: StringTable): { index: number; chars: string[] }[] {
  const out: { index: number; chars: string[] }[] = [];
  for (let i = 1; i < table.strings.length; i++) {
    const s = table.strings[i];
    if (s === null || s === undefined) continue;
    const chars = unencodable(s, table.encoding);
    if (chars.length > 0) out.push({ index: i, chars });
  }
  return out;
}

/** The highest offset STR's 16-bit table can hold: a string must start at or before it. */
export const STR_OFFSET_LIMIT = 0xffff;

/**
 * Where each string goes: offsets by index and the text blobs in file order. Identical
 * strings share one blob, which is what StarEdit does and keeps files small. `packed` is
 * the layout for a table that does not fit that way: a string whose bytes end another one
 * points into it rather than having its own blob — a file whose strings start inside other
 * strings decodes to far more text than it holds, and only this gets it back under STR's
 * 64 KB — and the longest blob goes at the end, since only where a string starts has to fit.
 */
function layoutStrings(table: StringTable, packed: boolean): { headerSize: number; offsets: number[]; blobs: Uint8Array[] } {
  const { strings, extended, encoding } = table;
  const count = strings.length - 1;
  const width = extended ? 4 : 2;
  const headerSize = width * (count + 1);

  const encoded = new Map<string, Uint8Array>();
  for (let i = 1; i <= count; i++) {
    const s = strings[i];
    if (s !== null && s !== undefined && !encoded.has(s)) encoded.set(s, encodeText(s, encoding));
  }
  const hosts = packed ? suffixHosts(encoded) : new Map<string, string>();
  const order = [...encoded.keys()].filter((s) => !hosts.has(s));
  if (packed && order.length > 1) {
    let longest = 0;
    order.forEach((s, i) => { if (encoded.get(s)!.length > encoded.get(order[longest])!.length) longest = i; });
    order.push(...order.splice(longest, 1));
  }
  // A shared empty string first, so unset slots point somewhere harmless.
  const at = new Map<string, number>();
  let next = headerSize + 1;
  const blobs: Uint8Array[] = [new Uint8Array(1)];
  for (const s of order) {
    const bytes = encoded.get(s)!;
    at.set(s, next);
    blobs.push(bytes, new Uint8Array(1));
    next += bytes.length + 1;
  }
  for (const [s, host] of hosts) at.set(s, at.get(host)! + encoded.get(host)!.length - encoded.get(s)!.length);
  const offsets: number[] = [];
  for (let i = 1; i <= count; i++) {
    const s = strings[i];
    offsets.push(s === null || s === undefined ? headerSize : at.get(s)!);
  }
  return { headerSize, offsets, blobs };
}

/**
 * For each string whose bytes are the end of another string's, the string it can point
 * into — one that is not itself the end of any other, so it keeps a blob of its own. Sorted
 * by their bytes read backwards, the strings one is the end of come straight after it.
 */
function suffixHosts(encoded: Map<string, Uint8Array>): Map<string, string> {
  const keys = [...encoded.keys()];
  const backwards = (a: Uint8Array, b: Uint8Array) => {
    for (let i = 1; i <= a.length && i <= b.length; i++) {
      const d = a[a.length - i] - b[b.length - i];
      if (d !== 0) return d;
    }
    return a.length - b.length;
  };
  const ends = (short: Uint8Array, long: Uint8Array) => {
    if (short.length > long.length) return false;
    for (let i = 1; i <= short.length; i++) if (short[short.length - i] !== long[long.length - i]) return false;
    return true;
  };
  keys.sort((a, b) => backwards(encoded.get(a)!, encoded.get(b)!));
  const hosts = new Map<string, string>();
  let host = keys.length - 1;
  for (let i = keys.length - 2; i >= 0; i--) {
    if (ends(encoded.get(keys[i])!, encoded.get(keys[i + 1])!)) hosts.set(keys[i], keys[host]);
    else host = i;
  }
  return hosts;
}

const overflowing = (offsets: number[]) => offsets.filter((o) => o > STR_OFFSET_LIMIT).length;

/** Whether a table needs the packed layout: STR's whose offsets would wrap, or an STRx whose text runs past 64 KB, which only a file whose strings overlap gets to. */
function needsPacking(extended: boolean, layout: ReturnType<typeof layoutStrings>): boolean {
  if (!extended) return overflowing(layout.offsets) > 0;
  let end = layout.headerSize;
  for (const b of layout.blobs) end += b.length;
  return end > STR_OFFSET_LIMIT + 1;
}

/**
 * How many strings would start past what STR's 16-bit offsets reach, so that the game (and
 * the editor, reading the file back) would show other text in their place. Always 0 for
 * STRx, whose offsets are 32-bit.
 */
export function stringTableOverflow(table: StringTable): number {
  if (table.extended) return 0;
  const plain = layoutStrings(table, false);
  return needsPacking(false, plain) ? overflowing(layoutStrings(table, true).offsets) : 0;
}

/**
 * The table's bytes. STR offsets that would wrap are the caller's to prevent — Save refuses
 * a table `stringTableOverflow` counts, and Check Map reports it.
 */
export function encodeStrings(table: StringTable): Uint8Array {
  const { extended } = table;
  let layout = layoutStrings(table, false);
  if (needsPacking(extended, layout)) layout = layoutStrings(table, true);
  const { headerSize, offsets, blobs } = layout;

  const out = new Writer(headerSize + 1024);
  if (extended) out.u32(offsets.length); else out.u16(offsets.length);
  for (const off of offsets) { if (extended) out.u32(off); else out.u16(off & 0xffff); }
  for (const b of blobs) out.bytes(b);
  return out.finish();
}

/** Read a string by index, with 0 / out-of-range meaning "none". */
export function getString(table: StringTable, index: number): string | null {
  return index > 0 && index < table.strings.length ? table.strings[index] : null;
}

/** Set the text at an existing index, or append a new one and return its index. */
export function setString(table: StringTable, index: number, text: string): number {
  if (index > 0 && index < table.strings.length) {
    table.strings[index] = text;
    return index;
  }
  table.strings.push(text);
  return table.strings.length - 1;
}

/** The lowest index holding exactly `text`, or -1 — StarEdit recycles identical strings rather than storing them twice. */
export function findString(table: StringTable, text: string): number {
  for (let i = 1; i < table.strings.length; i++) if (table.strings[i] === text) return i;
  return -1;
}
