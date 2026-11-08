/**
 * A GIF from pictures, for `scmjs replay export --out clip.gif`. Each picture gets a
 * palette of its own (median cut over its colours, a 15-bit histogram): the game's classic pictures are themselves
 * drawn from 256 colours, so a picture of it loses little. A pixel that looks as it did in the picture before is left
 * transparent, which is what keeps a GIF of a still screen small; LZW as GIF has it. Pure, and written as the pictures
 * come, so only one is held at a time. Made from the pictures as the page draws them, it came out smaller than
 * ffmpeg's palettes made of the encoded clip (11.7 MB against 16–18 MB for eight seconds of a fight, cli.md), and
 * without the clip's own blur; about 80 ms a picture at 640 × 360.
 */

/** The transparent index: the palette has 255 colours and this. */
const CLEAR = 255;

/** Median cut: up to `most` colours for the 15-bit histogram `counts` (r5 g5 b5), each the mean of its box's pixels. */
export function paletteOf(counts: Uint32Array, sums: Float64Array, most = 255): number[][] {
  const present: number[] = [];
  for (let c = 0; c < 32768; c++) if (counts[c]) present.push(c);
  const channel = (c: number, k: number) => (c >> (10 - 5 * k)) & 31;
  type Box = { colours: number[]; pixels: number };
  const weight = (colours: number[]) => colours.reduce((n, c) => n + counts[c], 0);
  const boxes: Box[] = present.length ? [{ colours: present, pixels: weight(present) }] : [];
  while (boxes.length < most) {
    // The box with the most pixels that can still be cut, along its widest channel, at its median pixel.
    let pick = -1, best = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].colours.length > 1 && boxes[i].pixels > best) { best = boxes[i].pixels; pick = i; }
    if (pick < 0) break;
    const box = boxes[pick];
    let k = 0, widest = -1;
    for (let ch = 0; ch < 3; ch++) {
      let lo = 31, hi = 0;
      for (const c of box.colours) { const v = channel(c, ch); if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo > widest) { widest = hi - lo; k = ch; }
    }
    box.colours.sort((a, b) => channel(a, k) - channel(b, k));
    let seen = 0, cut = 1;
    for (let i = 0; i < box.colours.length - 1; i++) { seen += counts[box.colours[i]]; if (seen * 2 >= box.pixels) { cut = i + 1; break; } cut = i + 1; }
    const a = box.colours.slice(0, cut), b = box.colours.slice(cut);
    boxes.splice(pick, 1, { colours: a, pixels: weight(a) }, { colours: b, pixels: weight(b) });
  }
  return boxes.map((box) => {
    let r = 0, g = 0, bl = 0;
    for (const c of box.colours) { r += sums[c * 3]; g += sums[c * 3 + 1]; bl += sums[c * 3 + 2]; }
    return [Math.round(r / box.pixels), Math.round(g / box.pixels), Math.round(bl / box.pixels)];
  });
}

/** GIF's LZW of `indices` at 8 bits a code to start, packed into its sub-blocks of at most 255 bytes. */
export function lzw(indices: Uint8Array): Uint8Array {
  const out: number[] = [];
  let bits = 0, acc = 0;
  const emit = (code: number, size: number) => {
    acc |= code << bits; bits += size;
    while (bits >= 8) { out.push(acc & 0xff); acc >>>= 8; bits -= 8; }
  };
  const clear = 256, end = 257;
  let size = 9, nextCode = 258;
  let table = new Map<number, number>();
  emit(clear, size);
  let prefix = indices.length ? indices[0] : -1;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 256 + k;
    const found = table.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix, size);
    if (nextCode < 4096) {
      table.set(key, nextCode++);
      if (nextCode > 1 << size && size < 12) size++;
    } else { emit(clear, size); table = new Map(); size = 9; nextCode = 258; }
    prefix = k;
  }
  if (prefix >= 0) emit(prefix, size);
  emit(end, size);
  if (bits > 0) out.push(acc & 0xff);
  const blocks: number[] = [8];
  for (let i = 0; i < out.length; i += 255) { const n = Math.min(255, out.length - i); blocks.push(n, ...out.slice(i, i + n)); }
  blocks.push(0);
  return new Uint8Array(blocks);
}

/** A GIF written picture by picture: `add` each RGBA picture, `finish` for the file. `delay`: hundredths of a second a picture. */
export class GifWriter {
  private readonly parts: Uint8Array[] = [];
  private previous: Uint8Array | null = null;
  private readonly width: number;
  private readonly height: number;
  private readonly delay: number;
  constructor(width: number, height: number, delay: number) {
    this.width = width; this.height = height; this.delay = Math.max(2, Math.round(delay));
    const head = new Uint8Array(13 + 19);
    head.set([...new TextEncoder().encode("GIF89a"), width & 0xff, width >> 8, height & 0xff, height >> 8, 0, 0, 0]);
    // Looped for ever (the NETSCAPE2.0 extension).
    head.set([0x21, 0xff, 11, ...new TextEncoder().encode("NETSCAPE2.0"), 3, 1, 0, 0, 0], 13);
    this.parts.push(head);
  }

  add(rgba: Uint8Array | Uint8ClampedArray): void {
    const n = this.width * this.height;
    const counts = new Uint32Array(32768), sums = new Float64Array(32768 * 3), keys = new Uint16Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const key = ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3);
      keys[i] = key; counts[key]++;
      sums[key * 3] += rgba[p]; sums[key * 3 + 1] += rgba[p + 1]; sums[key * 3 + 2] += rgba[p + 2];
    }
    const palette = paletteOf(counts, sums);
    // Each colour present to its nearest in the palette, once.
    const nearest = new Int16Array(32768).fill(-1);
    for (let key = 0; key < 32768; key++) {
      if (!counts[key]) continue;
      const r = sums[key * 3] / counts[key], g = sums[key * 3 + 1] / counts[key], b = sums[key * 3 + 2] / counts[key];
      let best = 0, bestD = Infinity;
      for (let j = 0; j < palette.length; j++) {
        const dr = r - palette[j][0], dg = g - palette[j][1], db = b - palette[j][2], d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < bestD) { bestD = d; best = j; }
      }
      nearest[key] = best;
    }
    // What each pixel shows (as 24-bit colour), and the indices: transparent where it shows what it did before.
    const shown = new Uint8Array(n * 3), indices = new Uint8Array(n);
    const before = this.previous;
    let transparent = false;
    for (let i = 0; i < n; i++) {
      const c = palette[nearest[keys[i]]];
      shown[i * 3] = c[0]; shown[i * 3 + 1] = c[1]; shown[i * 3 + 2] = c[2];
      if (before && before[i * 3] === c[0] && before[i * 3 + 1] === c[1] && before[i * 3 + 2] === c[2]) { indices[i] = CLEAR; transparent = true; }
      else indices[i] = nearest[keys[i]];
    }
    this.previous = shown;
    const table = new Uint8Array(768);
    palette.forEach((c, j) => table.set(c, j * 3));
    const w = this.width, h = this.height;
    // Graphic control: left in place (disposal 1), the transparent index where any pixel is, the delay.
    const control = new Uint8Array([0x21, 0xf9, 4, (1 << 2) | (transparent ? 1 : 0), this.delay & 0xff, this.delay >> 8, CLEAR, 0]);
    const descriptor = new Uint8Array([0x2c, 0, 0, 0, 0, w & 0xff, w >> 8, h & 0xff, h >> 8, 0x87]);
    this.parts.push(control, descriptor, table, lzw(indices));
  }

  finish(): Uint8Array {
    this.parts.push(new Uint8Array([0x3b]));
    const out = new Uint8Array(this.parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of this.parts) { out.set(p, at); at += p.length; }
    return out;
  }
}
