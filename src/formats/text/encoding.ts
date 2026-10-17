/**
 * The byte encodings a map's text can be in, and how to tell which one a file used.
 *
 * StarEdit wrote the string table in whatever code page Windows was running — EUC-KR
 * (CP949) on a Korean machine, Shift_JIS on a Japanese one, Windows-1252 nearly everywhere
 * else — and 1.16.1 still reads it that way. Remastered writes UTF-8 and, reading, tries
 * UTF-8 first and falls back to the client's legacy code page when the bytes are not
 * valid UTF-8. The file itself carries no note of which was used, so a table is *guessed*
 * on open (`detectTextEncoding`) and the guess is a setting the user can correct
 * (Scenario ▸ Map Revision).
 *
 * Decoding is the platform's (`TextDecoder` knows every label here). Encoding is not —
 * `TextEncoder` is UTF-8 only — so each legacy encoding's table is built once, lazily,
 * by decoding every byte and every lead/trail byte pair it has and remembering what came
 * back (`reverseTable`). A character the encoding cannot hold is written as `?`, the
 * way StarEdit's own dialogs did, and `unencodable` lists them so Check Map and the
 * dialog can say so before the file is written.
 */

import { msg } from "../../i18n";

export type TextEncoding = "utf-8" | "euc-kr" | "shift_jis" | "gbk" | "big5" | "windows-1251" | "windows-1252";

export interface TextEncodingInfo {
  id: TextEncoding;
  /** English; show it through `t()`. */
  label: string;
  /** Which game reads it, in a phrase. English; show it through `t()`. */
  hint: string;
  /** Two bytes per character for some characters (a lead byte and a trail byte). */
  multibyte: boolean;
  /** The block(s) a text in this encoding's language mostly falls in — how detection scores a candidate. */
  script: RegExp | null;
}

export const TEXT_ENCODINGS: readonly TextEncodingInfo[] = [
  { id: "utf-8", label: msg("UTF-8"), hint: msg("Remastered; any language"), multibyte: true, script: null },
  { id: "euc-kr", label: msg("Korean (EUC-KR / CP949)"), hint: msg("1.16.1 on a Korean Windows"), multibyte: true, script: /[가-힣ㄱ-ㆎ]/u },
  { id: "shift_jis", label: msg("Japanese (Shift_JIS)"), hint: msg("1.16.1 on a Japanese Windows"), multibyte: true, script: /[぀-ヿ一-鿿ｦ-ﾟ]/u },
  { id: "gbk", label: msg("Chinese, simplified (GBK)"), hint: msg("1.16.1 on a Chinese Windows"), multibyte: true, script: /[一-鿿　-〿]/u },
  { id: "big5", label: msg("Chinese, traditional (Big5)"), hint: msg("1.16.1 on a Taiwanese Windows"), multibyte: true, script: /[一-鿿　-〿]/u },
  { id: "windows-1251", label: msg("Cyrillic (Windows-1251)"), hint: msg("1.16.1 on a Russian Windows"), multibyte: false, script: /[Ѐ-ӿ]/u },
  { id: "windows-1252", label: msg("Western (Windows-1252)"), hint: msg("1.16.1 on a Western Windows"), multibyte: false, script: /[À-ɏ]/u },
];

export const DEFAULT_TEXT_ENCODING: TextEncoding = "utf-8";

export function textEncodingInfo(id: TextEncoding): TextEncodingInfo {
  return TEXT_ENCODINGS.find((e) => e.id === id) ?? TEXT_ENCODINGS[0];
}

export function isTextEncoding(value: unknown): value is TextEncoding {
  return typeof value === "string" && TEXT_ENCODINGS.some((e) => e.id === value);
}

/**
 * Windows-1252's 0x80–0x9F, as the WHATWG Encoding Standard (and so every browser) has
 * them. Node's ICU-backed `TextDecoder` reads that range as the C1 controls of
 * ISO-8859-1 instead, which would make the test suite and the browser disagree about a
 * curly quote or a euro sign; spelling the 32 entries out makes the encoding exact
 * everywhere. Five bytes are undefined and stay the control character.
 */
const WINDOWS_1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];
const C1 = /[\u0080-\u009f]/g;
const fixWindows1252 = (text: string) => text.replace(C1, (c) => String.fromCodePoint(WINDOWS_1252_HIGH[c.charCodeAt(0) - 0x80]));

const decoders = new Map<string, TextDecoder>();
function decoderFor(encoding: TextEncoding, fatal: boolean): TextDecoder {
  const key = `${encoding}:${fatal}`;
  let d = decoders.get(key);
  if (!d) { d = new TextDecoder(encoding, { fatal }); decoders.set(key, d); }
  return d;
}

/** Bytes to text; a sequence the encoding does not define becomes U+FFFD rather than failing. */
export function decodeText(bytes: Uint8Array, encoding: TextEncoding): string {
  const text = decoderFor(encoding, false).decode(bytes);
  return encoding === "windows-1252" ? fixWindows1252(text) : text;
}

/** True when every byte sequence is one the encoding defines. */
export function decodesCleanly(bytes: Uint8Array, encoding: TextEncoding): boolean {
  try { decoderFor(encoding, true).decode(bytes); return true; } catch { return false; }
}

/* ── Encoding ───────────────────────────────────────────── */

type ReverseTable = Map<number, number>; // code point → byte value, or (lead << 8 | trail)
const tables = new Map<TextEncoding, ReverseTable>();

/**
 * Every character the encoding has, mapped back to its bytes. Single bytes 0x80–0xFF first
 * (the whole of a single-byte code page; Shift_JIS's half-width katakana), then every
 * lead/trail pair 0x81–0xFE × 0x40–0xFE for the double-byte ones, decoded as one buffer
 * with an ASCII newline between the pairs — the WHATWG decoders hand an ASCII byte back
 * to the stream when it is not a valid trail, so the separators survive an invalid pair
 * and the result splits back into one entry per pair. A pair that did not decode to
 * exactly one character (invalid, or one of Big5's two-code-point entries) is skipped.
 */
function reverseTable(encoding: TextEncoding): ReverseTable {
  let table = tables.get(encoding);
  if (table) return table;
  table = new Map();
  const info = textEncodingInfo(encoding);
  const decoder = decoderFor(encoding, false);
  const take = (text: string, bytes: number) => {
    if (text.length === 0 || text.length > 2) return;
    const cp = text.codePointAt(0)!;
    if (cp === 0xfffd || cp < 0x80 || String.fromCodePoint(cp) !== text) return;
    if (!table!.has(cp)) table!.set(cp, bytes);
  };
  for (let b = 0x80; b <= 0xff; b++) take(decodeText(new Uint8Array([b]), encoding), b);
  if (info.multibyte) {
    const pairs: number[] = [];
    const buf = new Uint8Array(126 * 191 * 3);
    let n = 0;
    for (let lead = 0x81; lead <= 0xfe; lead++) {
      for (let trail = 0x40; trail <= 0xfe; trail++) {
        buf[n++] = lead; buf[n++] = trail; buf[n++] = 0x0a;
        pairs.push((lead << 8) | trail);
      }
    }
    const parts = decoder.decode(buf.subarray(0, n)).split("\n");
    // A decoder that swallowed a separator leaves fewer parts than pairs; the alignment is
    // then unknown from that point on, and the table stops there rather than lie.
    const count = Math.min(parts.length - 1, pairs.length);
    for (let i = 0; i < count; i++) take(parts[i], pairs[i]);
  }
  tables.set(encoding, table);
  return table;
}

const utf8 = new TextEncoder();

/** Text to bytes in the encoding; a character it cannot hold is written as `?`. */
export function encodeText(text: string, encoding: TextEncoding): Uint8Array {
  if (encoding === "utf-8") return utf8.encode(text);
  const table = reverseTable(encoding);
  const out = new Uint8Array(text.length * 2);
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) { out[n++] = cp; continue; }
    const bytes = table.get(cp);
    if (bytes === undefined) out[n++] = 0x3f;
    else if (bytes > 0xff) { out[n++] = bytes >> 8; out[n++] = bytes & 0xff; }
    else out[n++] = bytes;
  }
  return out.slice(0, n);
}

/** The distinct characters of `text` the encoding cannot hold, in order of first appearance. */
export function unencodable(text: string, encoding: TextEncoding): string[] {
  if (encoding === "utf-8") return [];
  const table = reverseTable(encoding);
  const out: string[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x80 && !table.has(cp) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

/* ── Detection ──────────────────────────────────────────── */

const NOT_LETTERS = /\P{L}+/u;

/** Over the words with a non-ASCII letter in them, the mean share of letters that are non-ASCII. */
function highLetterShare(text: string): number {
  let words = 0;
  let total = 0;
  for (const word of text.split(NOT_LETTERS)) {
    if (word.length === 0) continue;
    let high = 0;
    let n = 0;
    for (const ch of word) { n++; if (ch.codePointAt(0)! >= 0x80) high++; }
    if (high === 0) continue;
    words++;
    total += high / n;
  }
  return words === 0 ? 0 : total / words;
}

/**
 * The encoding a file's text is most likely in. Pure ASCII is called UTF-8 (nothing tells
 * the two apart, and UTF-8 is what a new file gets). Valid UTF-8 wins outright: legacy
 * text that happens to be valid UTF-8 is vanishingly rare, and Remastered makes the same
 * call. Otherwise every legacy encoding that decodes the bytes without error is scored
 * by how much of the non-ASCII text lands in its own script, and the best score above a
 * half wins; the candidates are tried in `preferred` order first, then the table's, so a
 * tie — Korean and Chinese bytes are often valid in each other's encoding — goes to the
 * one the user is likelier to want.
 *
 * The two single-byte encodings decode anything, and each one's accented letters are the
 * other's, so they cannot be told apart by validity or by script. What does tell them
 * apart is where the high bytes sit: a Cyrillic word is high bytes throughout, a Western
 * one is ASCII with the odd accent. So, over the words that have any non-ASCII letter
 * at all (the English a map table is full of — "Force 1", "Anywhere" — does not count),
 * the mean share of non-ASCII letters weights Windows-1251's score one way and
 * Windows-1252's the other; the pair sums to one and whichever way the words lean wins.
 * Windows-1252 is the floor when nothing scores: it decodes anything.
 */
export function detectTextEncoding(bytes: Uint8Array, preferred: readonly TextEncoding[] = []): TextEncoding {
  let high = false;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) { high = true; break; }
  if (!high) return DEFAULT_TEXT_ENCODING;
  if (decodesCleanly(bytes, "utf-8")) return "utf-8";

  const order: TextEncoding[] = [];
  for (const id of [...preferred, ...TEXT_ENCODINGS.map((e) => e.id)]) if (id !== "utf-8" && !order.includes(id)) order.push(id);

  let best: TextEncoding = "windows-1252";
  let bestScore = 0;
  for (const id of order) {
    const info = textEncodingInfo(id);
    if (!info.script || !decodesCleanly(bytes, id)) continue;
    const text = decodeText(bytes, id);
    let nonAscii = 0;
    let own = 0;
    for (const ch of text) {
      if (ch.codePointAt(0)! < 0x80) continue;
      nonAscii++;
      if (info.script.test(ch)) own++;
    }
    let score = nonAscii === 0 ? 0 : own / nonAscii;
    if (!info.multibyte) {
      const lean = highLetterShare(text);
      score *= id === "windows-1251" ? lean : 1 - lean;
    } else if (score <= 0.5) score = 0;
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best;
}
