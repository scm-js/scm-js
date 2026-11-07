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
  const width = Math.max(0, ...shown.map((p) => (p ? p[0].length : 0)));
  return shown.map((p) => (p ? `${" ".repeat(indent)}${pc.dim(p[0].padEnd(width))}  ${p[1].split("\n").join("\n" + " ".repeat(indent + width + 2))}` : ""));
}

/** A table's lines: columns padded to their widest cell (measured as the terminal shows it), none after the last. */
export function table(cells: string[][], indent = 4): string[] {
  const widths: number[] = [];
  for (const r of cells) r.forEach((c, i) => { widths[i] = Math.max(widths[i] ?? 0, columns(c)); });
  return cells.map((r) => " ".repeat(indent) + r.map((c, i) => (i === r.length - 1 ? c : c + " ".repeat(widths[i] - columns(c)))).join("  ").trimEnd());
}

// Hangul, CJK, kana and the full-width forms take two columns in a terminal; a map's name is often Korean.
const WIDE = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;
/** The columns a string takes in the terminal, without its colour codes. */
export function columns(s: string): number {
  let n = 0;
  for (const ch of visible(s)) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

// eslint-disable-next-line no-control-regex -- the terminal's colour codes
const ANSI = /\x1b\[[0-9;]*m/g;
/** Text as it shows, without colour codes. */
export const visible = (s: string) => s.replace(ANSI, "");

export const num = (n: number) => n.toLocaleString("en-US");
export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
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
