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

export function encodeStrings(table: StringTable): Uint8Array {
  const { strings, extended, encoding } = table;
  const count = strings.length - 1;
  const width = extended ? 4 : 2;
  const headerSize = width * (count + 1);

  // Identical strings share one blob, which is what StarEdit does and keeps files small.
  const blobs = new Map<string, number>();
  const body = new Writer(1024);
  body.u8(0); // shared empty string, so unset slots point somewhere harmless
  const offsets: number[] = [];

  for (let i = 1; i <= count; i++) {
    const s = strings[i];
    if (s === null || s === undefined) { offsets.push(headerSize); continue; }
    let at = blobs.get(s);
    if (at === undefined) {
      at = headerSize + body.length;
      blobs.set(s, at);
      body.bytes(encodeText(s, encoding));
      body.u8(0);
    }
    offsets.push(at);
  }

  const out = new Writer(headerSize + 1024);
  if (extended) out.u32(count); else out.u16(count);
  // Slot 0 has no string; point it at the first byte past the offset table.
  for (const off of offsets) { if (extended) out.u32(off); else out.u16(off); }
  out.bytes(body.finish());
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
