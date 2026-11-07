/**
 * `--qr`: a link as a QR code in the terminal, for a phone to open. The encoder is in this file — byte mode, error
 * correction L or M, versions 1 to 40 — so the command keeps having no dependencies. It is adapted from Project
 * Nayuki's QR Code generator library (https://www.nayuki.io/page/qr-code-generator-library, copyright Project
 * Nayuki, MIT; the notice is in ATTRIBUTION.md): the data-module count, the alignment spacing, the Reed–Solomon
 * divisor and the block interleaving are its, cut down to byte mode; the penalty rules are the standard's (ISO/IEC
 * 18004). `tests/cli-qr.test.ts` holds it to a matrix checked against the `qrcode` package and read back by a
 * decoder. The drawing is two module rows a line in half blocks (as `replay watch` draws the minimap), dark on a
 * light ground; ASCII where `ui.ts` has no Unicode.
 */
import { pc, unicode } from "./ui";

export type QrLevel = "L" | "M";

/** A QR code: `size` × `size` modules, `true` dark, row by row. */
export interface QrCode { version: number; level: QrLevel; mask: number; size: number; modules: boolean[][] }

// Per version (index 1–40): error-correction codewords in each block, and the number of blocks.
const ECC_PER_BLOCK: Record<QrLevel, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
};
const BLOCKS: Record<QrLevel, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
};
/** The two bits the format information gives each level. */
const LEVEL_BITS: Record<QrLevel, number> = { L: 1, M: 0 };

/** Modules left for data and error correction once the function patterns are drawn. */
function rawDataModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

/** Data codewords a version holds at a level. */
export function dataCodewords(ver: number, level: QrLevel): number {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[level][ver] * BLOCKS[level][ver];
}

/** How many bytes a version holds in byte mode: what is left after the mode and the count. */
export function byteCapacity(ver: number, level: QrLevel): number {
  return Math.floor((dataCodewords(ver, level) * 8 - 4 - (ver < 10 ? 8 : 16)) / 8);
}

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** The Reed–Solomon generator of `degree`, highest term left out. */
function rsDivisor(degree: number): number[] {
  const result = Array.from({ length: degree }, () => 0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}

/** The error-correction codewords for `data`. */
export function rsRemainder(data: readonly number[], degree: number): number[] {
  const divisor = rsDivisor(degree);
  const result = Array.from({ length: degree }, () => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < degree; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

/** The 15 format bits for a level and mask, masked as they are drawn. */
export function formatBits(level: QrLevel, mask: number): number {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits, from version 7 on. */
export function versionBits(ver: number): number {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 17 - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/**
 * `text` (UTF-8) as a QR code in byte mode: the smallest version that holds it at `level`, and at that version the
 * mask with the lowest penalty, unless `mask` names one.
 */
export function encodeQr(text: string, { level = "M", mask: forcedMask }: { level?: QrLevel; mask?: number } = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  while (byteCapacity(ver, level) < bytes.length) if (++ver > 40) throw new Error(`${bytes.length} bytes is more than a QR code holds`);

  // The bits: byte mode, the count, the bytes, the terminator, then padding to the version's data codewords.
  const bits: number[] = [];
  const put = (value: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacityBits = dataCodewords(ver, level) * 8;
  put(0, Math.min(4, capacityBits - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCodewords(ver, level); pad ^= 0xec ^ 0x11) data.push(pad);

  // Split into blocks, each with its error correction, and interleave them.
  const numBlocks = BLOCKS[level][ver], eccLen = ECC_PER_BLOCK[level][ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const shortBlocks = numBlocks - (raw % numBlocks), shortLen = Math.floor(raw / numBlocks);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, eccLen);
    if (i < shortBlocks) dat.push(0);
    blocks.push([...dat, ...ecc]);
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) codewords.push(b[i]); });

  // The function patterns, then the codewords in the zigzag, then the mask.
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const fixed = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const set = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; fixed[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const align = alignmentPositions(ver);
  for (const [i, ay] of align.entries()) for (const [j, ax] of align.entries()) {
    if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (m: number) => {
    const f = formatBits(level, m), bit = (i: number) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0); // reserves the area; drawn again with the mask chosen
  if (ver >= 7) {
    const v = versionBits(ver);
    for (let i = 0; i < 18; i++) {
      const dark = ((v >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, dark); set(b, a, dark);
    }
  }
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (!fixed[y][x] && i < codewords.length * 8) { modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const applyMask = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[m](x, y)) modules[y][x] = !modules[y][x];
  };
  let mask = forcedMask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const p = penalty(modules);
      if (p < best) { best = p; mask = m; }
      applyMask(m); // XOR undoes it
    }
  }
  applyMask(mask); drawFormat(mask);
  return { version: ver, level, mask, size, modules };
}

/** The standard's four penalty rules: runs, 2 × 2 blocks, finder-like patterns, and the balance of dark and light. */
export function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const lines: boolean[][] = [];
  for (let y = 0; y < size; y++) lines.push(m[y]);
  for (let x = 0; x < size; x++) lines.push(m.map((row) => row[x]));
  const finderA = [true, false, true, true, true, false, true, false, false, false, false];
  const finderB = [false, false, false, false, true, false, true, true, true, false, true];
  for (const line of lines) {
    for (let i = 0; i < size;) {
      let j = i;
      while (j < size && line[j] === line[i]) j++;
      if (j - i >= 5) score += 3 + (j - i - 5);
      i = j;
    }
    for (let i = 0; i + 11 <= size; i++) {
      if (finderA.every((v, k) => line[i + k] === v)) score += 40;
      if (finderB.every((v, k) => line[i + k] === v)) score += 40;
    }
  }
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) {
    const c = m[y][x];
    if (m[y][x + 1] === c && m[y + 1][x] === c && m[y + 1][x + 1] === c) score += 3;
  }
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

/** Light modules round the code; the standard asks for four, phones read two, and the terminal's width is short. */
export const QUIET = 2;

/**
 * The code as terminal lines. With Unicode: two module rows a line in half blocks, so it is `size + 2 × QUIET`
 * columns wide. Without (the old Windows console): a module is two characters wide and one line high. With colour,
 * dark modules are black on a white ground whatever the terminal's own colours; without colour the code is drawn for
 * a dark terminal (the light modules are the marks), which phones read too.
 */
export function qrLines(code: QrCode, { ascii = !unicode, color = pc.isColorSupported }: { ascii?: boolean; color?: boolean } = {}): string[] {
  const n = code.size + QUIET * 2;
  const dark = (x: number, y: number) => {
    const cx = x - QUIET, cy = y - QUIET;
    return cx >= 0 && cy >= 0 && cx < code.size && cy < code.size && code.modules[cy][cx];
  };
  // In colour the marks are the dark modules (black on white); without colour they are the light ones.
  const mark = (x: number, y: number) => (y < n && (color ? dark(x, y) : !dark(x, y)));
  const paint = (s: string) => (color ? `\x1b[30;107m${s}\x1b[0m` : s);
  const out: string[] = [];
  if (ascii) {
    for (let y = 0; y < n; y++) {
      let line = "";
      for (let x = 0; x < n; x++) line += mark(x, y) ? "##" : "  ";
      out.push(paint(line));
    }
    return out;
  }
  for (let y = 0; y < n; y += 2) {
    let line = "";
    for (let x = 0; x < n; x++) {
      const top = mark(x, y), bottom = y + 1 < n ? mark(x, y + 1) : !color;
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    out.push(paint(line));
  }
  return out;
}

/** The link's code, ready to print under it. */
export function qrFor(link: string, options?: { ascii?: boolean; color?: boolean }): string[] {
  return qrLines(encodeQr(link), options);
}
