/**
 * `.tbl` string tables read *and* written, and PyTBL's text form. `tbl.ts` is the editor's reader (an entry's parts,
 * split at NULs); this is the file as a list of whole entries, the way PyTBL holds it, so a table comes back byte
 * for byte.
 *
 *   u16 count, u16 offset[count] (from the start of the file), then the strings.
 *
 * An entry is everything from its offset to the next offset in the file (or the end), NULs included — stat_txt.tbl's
 * unit entries are `Name\0Subname\0Category\0`. The text's encoding is guessed from the whole string area, as `tbl.ts`
 * does (the game's own tables are Windows-1252, a Korean 1.16.1's EUC-KR, Remastered's UTF-8), and kept for writing.
 *
 * PyTBL text is one entry a line, with `<N>` for a character below 32 and for `#`, `<` and `>`; a line that starts with
 * `#` is a comment, and a NUL is added to an entry that does not end with one.
 */
import { decodeText, detectTextEncoding, encodeText, type TextEncoding } from "../text/encoding";

export interface TblFile {
  /** Whole entries, NULs included. */
  strings: string[];
  encoding: TextEncoding;
}

export function decodeTblFile(data: Uint8Array, encoding?: TextEncoding): TblFile {
  if (data.length < 2) throw new Error(`.tbl file too short (${data.length} bytes)`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint16(0, true);
  if (2 + count * 2 > data.length) throw new Error(`.tbl declares ${count} entries but is only ${data.length} bytes`);
  const offsets = Array.from({ length: count }, (_, i) => view.getUint16(2 + i * 2, true));
  for (const o of offsets) if (o > data.length) throw new Error(`.tbl entry offset ${o} is past the end (${data.length} bytes)`);
  const enc = encoding ?? detectTextEncoding(data.subarray(Math.min(2 + count * 2, data.length)));
  // An entry runs to the next offset in the file, not the next entry's: entries may share a string or be out of order.
  const sorted = [...new Set(offsets)].sort((a, b) => a - b);
  const end = new Map<number, number>();
  sorted.forEach((o, i) => end.set(o, sorted[i + 1] ?? data.length));
  return { strings: offsets.map((o) => decodeText(data.subarray(o, end.get(o)), enc)), encoding: enc };
}

/** The bytes PyTBL writes: entries in order, each with a NUL added when it lacks one. */
export function encodeTblFile(file: TblFile): Uint8Array {
  const parts = file.strings.map((s) => encodeText(s.endsWith("\0") ? s : `${s}\0`, file.encoding));
  if (file.strings.length > 0xffff) throw new Error(`a .tbl holds at most 65535 entries, not ${file.strings.length}`);
  const header = 2 + parts.length * 2;
  const size = header + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint16(0, parts.length, true);
  let at = header;
  parts.forEach((p, i) => {
    if (at > 0xffff) throw new Error(`.tbl entry ${i} would start at byte ${at}, past the 65535 a u16 offset reaches`);
    view.setUint16(2 + i * 2, at, true);
    out.set(p, at);
    at += p.length;
  });
  return out;
}

// eslint-disable-next-line no-control-regex
const ESCAPED = /[\x00-\x1f#<>]/g;

/** One entry as a PyTBL line. */
export function tblEscape(s: string): string {
  return s.replace(ESCAPED, (c) => `<${c.charCodeAt(0)}>`);
}

/** A PyTBL line's entry: `<N>` (0–255) is that character. */
export function tblUnescape(s: string): string {
  return s.replace(/<(\d+)>/g, (m, n: string) => (Number(n) <= 255 ? String.fromCharCode(Number(n)) : m));
}

/** PyTBL text: a line an entry. */
export function tblToText(strings: readonly string[]): string {
  return strings.map((s) => `${tblEscape(s)}\n`).join("");
}

/** The entries of PyTBL text. A line beginning with `#` is a comment; everything after a `#` elsewhere is too. */
export function tblFromText(text: string): string[] {
  const lines = text.split("\n");
  const partial = lines.pop()!;
  const out: string[] = [];
  const take = (line: string, whole: boolean) => {
    const content = line.split("#", 1)[0];
    if (content === "" && (line.startsWith("#") || !whole)) return;
    out.push(tblUnescape(content.replace(/[\r\n]+$/, "")));
  };
  for (const line of lines) take(line, true);
  take(partial, false);
  return out;
}
