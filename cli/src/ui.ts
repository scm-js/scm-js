/**
 * How `scmjs` writes to the terminal: colour through picocolors (off for a pipe, `NO_COLOR` or `--no-color`), a few
 * marks, aligned label/value rows, and StarCraft's own text colours where a map or replay name has them.
 */
import pc from "picocolors";
import { TEXT_CODES } from "../../src/editor/textColors";

export { pc };

/** Unicode marks, where the terminal can be expected to draw them (the old Windows console cannot). */
export const unicode = process.platform !== "win32" || !!process.env.WT_SESSION || process.env.TERM_PROGRAM === "vscode" || !!process.env.CI;

export const mark = {
  ok: pc.green(unicode ? "✔" : "√"),
  error: pc.red(unicode ? "✖" : "×"),
  warn: pc.yellow(unicode ? "▲" : "!"),
  info: pc.cyan(unicode ? "ℹ" : "i"),
  arrow: pc.dim(unicode ? "→" : "->"),
};
export const dot = pc.dim(unicode ? " · " : " - ");

/** Lines to standard output. */
export function print(...lines: (string | null | undefined | false)[]): void {
  for (const l of lines) if (l !== null && l !== undefined && l !== false) process.stdout.write(l + "\n");
}

/**
 * `label  value` rows, the labels padded to one width and dimmed; rows with no value are left out, and a `null`
 * row is a blank line between groups (one width for all of them).
 */
export function rows(pairs: ([string, string | null | undefined | false] | null)[], indent = 2): string[] {
  const shown = pairs.filter((p): p is [string, string] | null => p === null || (typeof p[1] === "string" && p[1] !== ""));
  const width = Math.max(0, ...shown.map((p) => (p ? columns(p[0]) : 0)));
  return shown.map((p) => (p ? `${" ".repeat(indent)}${pc.dim(padColumns(p[0], width))}  ${p[1].split("\n").join("\n" + " ".repeat(indent + width + 2))}` : ""));
}

/** A table's lines: columns padded to their widest cell (measured as the terminal shows it), none after the last. */
export function table(cells: string[][], indent = 4): string[] {
  const widths: number[] = [];
  for (const r of cells) r.forEach((c, i) => { widths[i] = Math.max(widths[i] ?? 0, columns(c)); });
  return cells.map((r) => " ".repeat(indent) + r.map((c, i) => (i === r.length - 1 ? c : c + " ".repeat(widths[i] - columns(c)))).join("  ").trimEnd());
}

/**
 * East Asian wide and full-width characters (Unicode's East_Asian_Width W and F), which a terminal draws two columns
 * wide: Hangul — the command's own Korean, and a map's name often — CJK, kana, the full-width forms and the emoji
 * blocks. Sorted ranges of code points, first and last.
 */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4], [0x17000, 0x18cff], [0x1b000, 0x1b2ff], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f251], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff],
  [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
];
/** Characters a terminal draws over the one before: combining marks, the zero-width joiner and spaces, variation selectors. */
const ZERO: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f], [0x1160, 0x11ff], [0x200b, 0x200f], [0x20d0, 0x20ff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f], [0xfeff, 0xfeff],
];
const within = (ranges: readonly (readonly [number, number])[], code: number) => {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (code < ranges[mid][0]) hi = mid - 1;
    else if (code > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
};
/** The columns one character (a code point) takes in a terminal: 2 for East Asian wide, 0 for a combining mark, else 1. */
export function charWidth(code: number): 0 | 1 | 2 {
  if (code < 0x0300) return 1;
  if (within(ZERO, code)) return 0;
  return within(WIDE, code) ? 2 : 1;
}
/** The columns a string takes in the terminal, without its colour codes. */
export function columns(s: string): number {
  let n = 0;
  for (const ch of visible(s)) n += charWidth(ch.codePointAt(0)!);
  return n;
}
/** `s` padded with spaces to `width` terminal columns (as `padEnd` would, counting a Hangul syllable as two). */
export const padColumns = (s: string, width: number) => s + " ".repeat(Math.max(0, width - columns(s)));

// eslint-disable-next-line no-control-regex -- the terminal's colour codes
const ANSI = /\x1b\[[0-9;]*m/g;
/** Text as it shows, without colour codes. */
export const visible = (s: string) => s.replace(ANSI, "");

export const num = (n: number) => n.toLocaleString("en-US");
export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
/** A game's length, `m:ss` or `h:mm:ss`. */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** 24-bit colour, where the terminal says it has it. */
export const truecolor = pc.isColorSupported && /^(truecolor|24bit)$/i.test(process.env.COLORTERM ?? "");
export function rgb(hex: string, text: string): string {
  if (!truecolor) return text;
  const n = parseInt(hex.slice(1), 16);
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${text}\x1b[39m`;
}

const CODE_COLOR = new Map(TEXT_CODES.filter((c) => c.rgb).map((c) => [c.byte, c.rgb!]));
/**
 * Text from a map or replay as the game shows it: its colour codes as colours (in a terminal with 24-bit colour) and
 * every other control byte left out; one line.
 */
export function gameText(s: string): string {
  let out = "", run = "", color: string | null = null;
  const flush = () => { if (run) out += color ? rgb(color, run) : run; run = ""; };
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20) { run += ch; continue; }
    if (code === 0x0a || code === 0x09) { run += " "; continue; }
    const next = CODE_COLOR.get(code);
    if (next) { flush(); color = next; }
  }
  flush();
  return out.replace(/\s+/g, " ").trim();
}

/** Text of several lines (a description) as the game shows it, line by line, blank lines kept once. */
export function gameLines(s: string): string {
  return s.split(/\r?\n/).map(gameText).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** A failure the person can act on: said in red with a hint, and an exit code (1 by default, 2 for wrong usage). */
export class CliError extends Error {
  readonly hint: string | null;
  readonly exitCode: number;
  constructor(message: string, hint: string | null = null, exitCode = 1) { super(message); this.hint = hint; this.exitCode = exitCode; }
}
