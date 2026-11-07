/**
 * PNG files from RGBA pixels, written by hand over `node:zlib`: the signature, IHDR, one IDAT and IEND, every row
 * with filter 0. Small and dependency-free; the pictures `scmjs map preview` writes are opaque, so they go out as
 * 8-bit RGB unless alpha is asked for.
 */
import { deflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** The CRC-32 PNG puts after each chunk (ISO 3309, as zlib's `crc32`). */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Length, type, data, then the CRC of type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** `rgba` is `width × height × 4` bytes, row by row. `alpha: false` (the default) drops the fourth byte. */
export function encodePng(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, { alpha = false } = {}): Uint8Array {
  if (width < 1 || height < 1 || rgba.length < width * height * 4) throw new Error(`encodePng: ${width} × ${height} needs ${width * height * 4} bytes, got ${rgba.length}`);
  const channels = alpha ? 4 : 3;
  const stride = width * channels + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    let o = y * stride;
    raw[o++] = 0; // filter: none
    let i = y * width * 4;
    for (let x = 0; x < width; x++, i += 4) {
      raw[o++] = rgba[i]; raw[o++] = rgba[i + 1]; raw[o++] = rgba[i + 2];
      if (alpha) raw[o++] = rgba[i + 3];
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bits a channel
  ihdr[9] = alpha ? 6 : 2; // colour type: RGBA or RGB
  // 10–12: compression 0, filter method 0, no interlace
  const parts = [SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
