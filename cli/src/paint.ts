/**
 * A picture in the terminal, for `scmjs map preview`: colour half blocks (`▀`, foreground the upper pixel and
 * background the lower, so a character cell is two square-ish pixels), in 24-bit colour or the nearest of the
 * 256-colour cube; ASCII shades where the terminal cannot draw blocks or has no colour; or, in kitty and iTerm2, the
 * PNG itself through their image protocols. Pure functions of an RGBA picture and the marks drawn on it (preview.ts).
 */
import type { Mark, Picture } from "./preview";

/** What colour the terminal takes. */
export type Depth = "truecolor" | "256" | "none";
export type InlineProtocol = "kitty" | "iterm";

type Rgb = [number, number, number];

/* ── Colour ─────────────────────────────────────────────────── */

const CUBE = [0, 95, 135, 175, 215, 255];
const cubeStep = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));

/** The nearest of xterm's 256 colours outside the first sixteen: the 6 × 6 × 6 cube (16–231) or the greys (232–255). */
export function ansi256(r: number, g: number, b: number): number {
  const cr = cubeStep(r), cg = cubeStep(g), cb = cubeStep(b);
  const cube = 16 + 36 * cr + 6 * cg + cb;
  const dCube = (CUBE[cr] - r) ** 2 + (CUBE[cg] - g) ** 2 + (CUBE[cb] - b) ** 2;
  const grey = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)));
  const v = 8 + grey * 10;
  const dGrey = (v - r) ** 2 + (v - g) ** 2 + (v - b) ** 2;
  return dGrey < dCube ? 232 + grey : cube;
}

/** The SGR parameters for a colour as foreground (38) or background (48). */
export function sgr(layer: 38 | 48, [r, g, b]: Rgb, depth: Exclude<Depth, "none">): string {
  return depth === "truecolor" ? `${layer};2;${r};${g};${b}` : `${layer};5;${ansi256(r, g, b)}`;
}

const hexRgb = (hex: string): Rgb => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const luma = ([r, g, b]: Rgb) => 0.299 * r + 0.587 * g + 0.114 * b;
const pixel = (pic: Picture, x: number, y: number): Rgb => { const at = (y * pic.width + x) * 4; return [pic.pixels[at], pic.pixels[at + 1], pic.pixels[at + 2]]; };

/** The cell a start location's number goes in: the one holding its box's middle. */
function labelCells(pic: Picture, marks: Mark[]): Map<number, Mark> {
  const cells = new Map<number, Mark>();
  for (const m of marks) {
    if (!m.label) continue;
    const x = Math.min(pic.width - 1, Math.floor((m.x0 + m.x1 - 1) / 2));
    const y = Math.min(pic.height - 1, Math.floor((m.y0 + m.y1 - 1) / 2));
    cells.set(Math.floor(y / 2) * pic.width + x, m);
  }
  return cells;
}

/* ── The forms ──────────────────────────────────────────────── */

/**
 * The picture as lines of `▀`: a line per two pixel rows, a column per pixel, the colour codes written only where they
 * change and reset at each line's end. A start location's cell holds its number on the slot's colour. An odd last
 * row has the terminal's own background below it.
 */
export function halfBlocks(pic: Picture, marks: Mark[], depth: Exclude<Depth, "none">): string[] {
  const labels = labelCells(pic, marks);
  const lines: string[] = [];
  for (let row = 0; row * 2 < pic.height; row++) {
    let line = "", last = "";
    for (let x = 0; x < pic.width; x++) {
      const label = labels.get(row * pic.width + x);
      let code: string, ch: string;
      if (label) {
        const c = hexRgb(label.color);
        code = `${sgr(38, luma(c) > 140 ? [0, 0, 0] : [255, 255, 255], depth)};${sgr(48, c, depth)}`;
        ch = label.label!;
      } else {
        const lower = row * 2 + 1 < pic.height ? sgr(48, pixel(pic, x, row * 2 + 1), depth) : "49";
        code = `${sgr(38, pixel(pic, x, row * 2), depth)};${lower}`;
        ch = "▀";
      }
      if (code !== last) { line += `\x1b[${code}m`; last = code; }
      line += ch;
    }
    lines.push(line + "\x1b[0m");
  }
  return lines;
}

/** Dark to light, for a cell's brightness. `#`, `o` and `$` are left out of it: they are the marks. */
export const SHADES = " .:-=+*%@";
/** What a mark is in ASCII: a building, a unit, a mineral field or geyser; a start location is its number. */
const ASCII_MARK: Record<Mark["kind"], string> = { start: "", building: "#", unit: "o", mineral: "$", geyser: "$" };

/**
 * The picture as ASCII: a character a cell (two pixel rows), its shade from how bright the cell is against the rest
 * of the picture, the marks as `#` `o` `$` and start locations' numbers; coloured where the terminal takes colour,
 * plain text where it does not. `overlay` puts a character of its own in a cell (row × width + column), over
 * everything else — `map diff --picture`'s marks for what changed.
 */
export function asciiShades(pic: Picture, marks: Mark[], depth: Depth, overlay?: ReadonlyMap<number, { ch: string; color: string }>): string[] {
  const rows = Math.ceil(pic.height / 2);
  const chars: string[] = Array.from({ length: rows * pic.width }, () => " ");
  const colors: Rgb[] = Array.from({ length: rows * pic.width }, (): Rgb => [0, 0, 0]);
  for (let row = 0; row < rows; row++) {
    for (let x = 0; x < pic.width; x++) {
      const top = pixel(pic, x, row * 2), bottom = row * 2 + 1 < pic.height ? pixel(pic, x, row * 2 + 1) : top;
      const c: Rgb = [(top[0] + bottom[0]) >> 1, (top[1] + bottom[1]) >> 1, (top[2] + bottom[2]) >> 1];
      colors[row * pic.width + x] = c;
    }
  }
  // Shades spread over the picture's own range (2nd to 98th percentile), or a dark tileset is all dots.
  const lumas = colors.map(luma).sort((p, q) => p - q);
  const lo = lumas[Math.floor(lumas.length * 0.02)] ?? 0, hi = lumas[Math.floor(lumas.length * 0.98)] ?? 255;
  colors.forEach((c, i) => {
    const f = hi > lo ? (luma(c) - lo) / (hi - lo) : 0.5;
    chars[i] = SHADES[Math.max(0, Math.min(SHADES.length - 1, Math.floor(f * SHADES.length)))];
  });
  for (const m of marks) {
    const ch = ASCII_MARK[m.kind];
    if (!ch) continue;
    for (let row = Math.floor(m.y0 / 2); row <= Math.floor((m.y1 - 1) / 2); row++) {
      for (let x = m.x0; x < m.x1; x++) { chars[row * pic.width + x] = ch; colors[row * pic.width + x] = hexRgb(m.color); }
    }
  }
  for (const [cell, m] of labelCells(pic, marks)) { chars[cell] = m.label!; colors[cell] = hexRgb(m.color); }
  for (const [cell, o] of overlay ?? []) { chars[cell] = o.ch; colors[cell] = hexRgb(o.color); }
  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    let line = "", last = "";
    for (let x = 0; x < pic.width; x++) {
      const at = row * pic.width + x;
      if (depth !== "none") {
        const code = sgr(38, colors[at], depth);
        if (code !== last) { line += `\x1b[${code}m`; last = code; }
      }
      line += chars[at];
    }
    lines.push(depth === "none" ? line.trimEnd() : line + "\x1b[0m");
  }
  return lines;
}

/** The terminal's own picture protocol, where it has one this can use: kitty's or iTerm2's, on a terminal, not through tmux or screen. */
export function inlineProtocol(env: NodeJS.ProcessEnv, isTTY: boolean): InlineProtocol | null {
  if (!isTTY || env.TMUX || env.STY) return null;
  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty") return "kitty";
  if (env.TERM_PROGRAM === "iTerm.app") return "iterm";
  return null;
}

/**
 * The PNG as the terminal's own picture, `columns` cells wide and as tall as its shape makes it. kitty: the graphics
 * protocol, the base64 in pieces of 4096 (`f=100` PNG, `a=T` show it, `q=2` no answer back). iTerm2: its inline file.
 */
export function inlineImage(png: Uint8Array, protocol: InlineProtocol, columns: number): string {
  const data = Buffer.from(png).toString("base64");
  if (protocol === "iterm") return `\x1b]1337;File=inline=1;size=${png.length};width=${columns};preserveAspectRatio=1:${data}\x07`;
  let out = "";
  for (let at = 0; at < data.length; at += 4096) {
    const more = at + 4096 < data.length ? 1 : 0;
    out += `\x1b_G${at === 0 ? `f=100,a=T,q=2,c=${columns},` : ""}m=${more};${data.slice(at, at + 4096)}\x1b\\`;
  }
  return out;
}

/** The colour key under the picture: each player on it, the resources, and what the numbers and letters are. */
export function legendLine(marks: Mark[], depth: Depth, unicode: boolean): string {
  const players = new Map<number, string>();
  const kinds = new Map<Mark["kind"], string>();
  for (const m of marks) {
    if (!kinds.has(m.kind)) kinds.set(m.kind, m.color);
    if (m.kind !== "mineral" && m.kind !== "geyser" && !players.has(m.owner)) players.set(m.owner, m.color);
  }
  const swatch = (hex: string, text: string) => (depth === "none" ? text : `\x1b[${sgr(38, hexRgb(hex), depth)}m${unicode ? "■" : "#"}\x1b[39m ${text}`);
  const parts = [...players].sort(([a], [b]) => a - b).map(([owner, hex]) => swatch(hex, owner === 11 ? "neutral" : `P${owner + 1}`));
  if (kinds.has("mineral")) parts.push(swatch(kinds.get("mineral")!, depth === "none" ? "$ minerals" : "minerals"));
  if (kinds.has("geyser")) parts.push(swatch(kinds.get("geyser")!, depth === "none" ? "$ gas" : "gas"));
  if (kinds.has("start")) parts.push("numbers: start locations");
  if (depth === "none" && (kinds.has("building") || kinds.has("unit"))) parts.push("# buildings, o units");
  return parts.join("  ");
}
