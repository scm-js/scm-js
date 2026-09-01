import { Writer } from "../binary";

/**
 * STR/STRx string table.
 *
 * Index 0 means "no string" and is never stored. Indices are referenced from TRIG,
 * MRGN, SPRP and friends — several of which we round-trip as raw bytes — so the table
 * must keep its index space stable across a save. Entries are therefore addressed by
 * position, never renumbered.
 */
export interface StringTable {
  /** `strings[i]` is string index `i`; slot 0 is always null. */
  strings: (string | null)[];
  /** True when the source section was STRx (Remastered, 32-bit count and offsets). */
  extended: boolean;
}

const decoder = new TextDecoder("latin1");

export function decodeStrings(data: Uint8Array, extended: boolean): StringTable {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = extended ? 4 : 2;
  const read = (at: number) => (extended ? view.getUint32(at, true) : view.getUint16(at, true));

  if (data.length < width) return { strings: [null], extended };
  const count = read(0);
  const strings: (string | null)[] = [null];

  for (let i = 1; i <= count; i++) {
    const at = i * width;
    if (at + width > data.length) { strings.push(null); continue; }
    const offset = read(at);
    if (offset >= data.length) { strings.push(null); continue; }
    let end = offset;
    while (end < data.length && data[end] !== 0) end++;
    strings.push(decoder.decode(data.subarray(offset, end)));
  }

  return { strings, extended };
}

export function encodeStrings(table: StringTable): Uint8Array {
  const { strings, extended } = table;
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
      for (let c = 0; c < s.length; c++) body.u8(s.charCodeAt(c) & 0xff);
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
