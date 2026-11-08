/**
 * GRP sprite sheets as pictures, and written back. `grp.ts` draws straight from the file; this module turns a GRP
 * into its frames' pixels (palette indices, 0 = transparent) and encodes frames into a GRP the way the game's own
 * files are encoded, so that the game's GRPs decode and encode to the same bytes.
 *
 *   header      u16 frames, u16 width, u16 height
 *   frame table u8 x, u8 y, u8 width, u8 height, u32 offset       (8 bytes each)
 *   frame data  u16 lineOffset[height] (from the frame's start), then each line:
 *                 0x80|n  n transparent pixels (n ≤ 127)
 *                 0x40|n  the next byte, n times (n ≤ 63)
 *                 n       the next n bytes (n ≤ 63)
 *
 * The game's encoder (as measured on the 838 GRPs of 1.16.1): a run of transparent pixels is always a skip; a run of
 * four or more equal pixels is a repeat; anything else is copied, at most 63 bytes at a time — and while copying, a
 * run is measured only as far as the copy has room, so a run that starts near a full copy's end is copied. Trailing
 * transparency is written like any other. A frame whose bytes equal an earlier frame's points at
 * that frame's data instead of a copy of it.
 */

/** One frame: its box inside the GRP's shared box, and `width × height` palette indices. */
export interface GrpFramePixels {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface GrpImage {
  width: number;
  height: number;
  frames: GrpFramePixels[];
}

export function decodeGrpImage(data: Uint8Array): GrpImage {
  if (data.length < 6) throw new Error(`GRP too short (${data.length} bytes)`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint16(0, true);
  const width = view.getUint16(2, true);
  const height = view.getUint16(4, true);
  if (data.length < 6 + count * 8) throw new Error(`GRP declares ${count} frames but is only ${data.length} bytes`);
  const frames: GrpFramePixels[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 8;
    const fw = data[at + 2], fh = data[at + 3];
    const offset = view.getUint32(at + 4, true);
    const pixels = new Uint8Array(fw * fh);
    for (let row = 0; row < fh; row++) {
      const lineAt = offset + row * 2;
      if (lineAt + 2 > data.length) throw new Error(`GRP frame ${i}: line ${row} is outside the file`);
      let p = offset + view.getUint16(lineAt, true);
      let col = 0;
      const base = row * fw;
      while (col < fw) {
        if (p >= data.length) throw new Error(`GRP frame ${i}: line ${row} runs past the end of the file`);
        const op = data[p++];
        if (op & 0x80) col += op & 0x7f;
        else if (op & 0x40) {
          const n = op & 0x3f, c = data[p++];
          for (let k = 0; k < n && col < fw; k++) pixels[base + col++] = c;
        } else {
          for (let k = 0; k < op && col < fw; k++) pixels[base + col++] = data[p++];
          if (op === 0 && col < fw) throw new Error(`GRP frame ${i}: line ${row} has an empty copy, which would never end`);
        }
      }
    }
    frames.push({ x: data[at], y: data[at + 1], width: fw, height: fh, pixels });
  }
  return { width, height, frames };
}

const MAX_SKIP = 0x7f;
const MAX_RUN = 0x3f;
/** Equal pixels in a row from which the game's encoder writes a repeat instead of copying them. */
const RUN_FROM = 4;

/** One line's bytes, the way the game's encoder writes them. */
export function encodeGrpLine(pixels: Uint8Array, out: number[]) {
  const end = pixels.length;
  let i = 0;
  const runAt = (at: number, cap: number) => {
    let n = 1;
    while (at + n < end && pixels[at + n] === pixels[at] && n < cap) n++;
    return n;
  };
  while (i < end) {
    if (pixels[i] === 0) {
      let n = 0;
      while (i < end && pixels[i] === 0 && n < MAX_SKIP) { n++; i++; }
      out.push(0x80 | n);
      continue;
    }
    const run = runAt(i, MAX_RUN);
    if (run >= RUN_FROM) {
      out.push(0x40 | run, pixels[i]);
      i += run;
      continue;
    }
    const start = i;
    // The game's encoder measures a run only as far as the copy still has room, so a run near a full copy's end is copied.
    while (i < end && pixels[i] !== 0 && i - start < MAX_RUN && runAt(i, MAX_RUN - (i - start)) < RUN_FROM) i++;
    out.push(i - start);
    for (let k = start; k < i; k++) out.push(pixels[k]);
  }
}

/** One frame's data: the line table, then the lines. */
export function encodeGrpFrame(frame: GrpFramePixels): Uint8Array {
  const lines: number[] = [];
  const offsets: number[] = [];
  const table = frame.height * 2;
  for (let row = 0; row < frame.height; row++) {
    offsets.push(table + lines.length);
    encodeGrpLine(frame.pixels.subarray(row * frame.width, (row + 1) * frame.width), lines);
  }
  if (offsets.some((o) => o > 0xffff)) throw new Error("GRP frame too large: a line starts past the 65535 bytes a line offset reaches");
  const out = new Uint8Array(table + lines.length);
  offsets.forEach((o, r) => { out[r * 2] = o & 0xff; out[r * 2 + 1] = o >> 8; });
  out.set(lines, table);
  return out;
}

export function encodeGrpImage(image: GrpImage): Uint8Array {
  if (image.frames.length > 0xffff) throw new Error(`a GRP holds at most 65535 frames, not ${image.frames.length}`);
  const header = 6 + image.frames.length * 8;
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  const seen = new Map<string, number>();
  let at = header;
  for (const frame of image.frames) {
    if (frame.width > 255 || frame.height > 255 || frame.x > 255 || frame.y > 255) throw new Error(`a GRP frame's box is at most 255 × 255 at (≤255, ≤255); this one is ${frame.width} × ${frame.height} at (${frame.x}, ${frame.y})`);
    if (frame.pixels.length !== frame.width * frame.height) throw new Error(`a ${frame.width} × ${frame.height} frame needs ${frame.width * frame.height} pixels, not ${frame.pixels.length}`);
    const bytes = encodeGrpFrame(frame);
    const key = keyOf(bytes);
    const again = seen.get(key);
    if (again !== undefined) { offsets.push(again); continue; }
    seen.set(key, at);
    offsets.push(at);
    chunks.push(bytes);
    at += bytes.length;
  }
  const out = new Uint8Array(at);
  const view = new DataView(out.buffer);
  view.setUint16(0, image.frames.length, true);
  view.setUint16(2, image.width, true);
  view.setUint16(4, image.height, true);
  image.frames.forEach((f, i) => {
    const h = 6 + i * 8;
    out[h] = f.x; out[h + 1] = f.y; out[h + 2] = f.width; out[h + 3] = f.height;
    view.setUint32(h + 4, offsets[i], true);
  });
  let p = header;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

function keyOf(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return s;
}

/** The smallest box around a frame's opaque pixels, as the game's frames are cut: `{ x, y, width, height }` inside the frame. */
export function opaqueBox(pixels: Uint8Array, width: number, height: number): { x: number; y: number; width: number; height: number } {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[y * width + x] === 0) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < 0 ? { x: 0, y: 0, width: 0, height: 0 } : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** A whole picture as a frame: the opaque part cut out, with its offset kept (how the game's frames are stored). */
export function frameFromPicture(pixels: Uint8Array, width: number, height: number): GrpFramePixels {
  const box = opaqueBox(pixels, width, height);
  const out = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) out.set(pixels.subarray((box.y + y) * width + box.x, (box.y + y) * width + box.x + box.width), y * box.width);
  return { ...box, pixels: out };
}

/** A frame drawn into the GRP's full box (`image.width × image.height` indices, 0 outside the frame). */
export function framePicture(image: GrpImage, index: number): Uint8Array {
  const f = image.frames[index];
  const out = new Uint8Array(image.width * image.height);
  for (let y = 0; y < f.height; y++) {
    const ty = f.y + y;
    if (ty >= image.height) break;
    for (let x = 0; x < f.width; x++) {
      const tx = f.x + x;
      if (tx < image.width) out[ty * image.width + tx] = f.pixels[y * f.width + x];
    }
  }
  return out;
}
