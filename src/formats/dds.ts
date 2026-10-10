/**
 * The two block-compressed picture formats StarCraft: Remastered's sprites use, read a
 * rectangle at a time. A sprite sheet is a thousand pixels a side and one frame of it is
 * fifty, and the blocks (4 × 4 pixels each) decode independently, so nothing here ever
 * expands a whole sheet.
 *
 * (`tileset/hd.ts` has its own DXT1 loop: terrain is always a whole 64 × 64 picture, has
 * no alpha, and is decoded thousands at a time, so it is written for that one case.)
 */

export type DxtFormat = "DXT1" | "DXT5";

export interface DdsImage {
  width: number;
  height: number;
  format: DxtFormat;
  /** Offset of the first block in the bytes the image was parsed from. */
  data: number;
}

const DDS_MAGIC = 0x20534444; // 'DDS '
const DDS_HEADER = 128;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** The DDS file starting at `offset`, or null when it is not one or not DXT1 / DXT5. */
export function parseDds(bytes: Uint8Array, offset: number, size: number): DdsImage | null {
  if (size < DDS_HEADER || offset + size > bytes.length || u32(bytes, offset) !== DDS_MAGIC) return null;
  const height = u32(bytes, offset + 12), width = u32(bytes, offset + 16);
  const fourcc = String.fromCharCode(bytes[offset + 84], bytes[offset + 85], bytes[offset + 86], bytes[offset + 87]);
  if (fourcc !== "DXT1" && fourcc !== "DXT5") return null;
  const blocks = Math.ceil(width / 4) * Math.ceil(height / 4);
  if (width === 0 || height === 0 || size < DDS_HEADER + blocks * (fourcc === "DXT1" ? 8 : 16)) return null;
  return { width, height, format: fourcc, data: offset + DDS_HEADER };
}

/**
 * Decode the rectangle (`x`, `y`, `w`, `h`) of `image` into `out` (RGBA, `w` × `h`). The
 * part of the rectangle outside the picture is left as it was. DXT1 comes out opaque
 * except where a block uses its transparent colour; DXT5 carries its own alpha.
 */
export function decodeDxtRect(bytes: Uint8Array, image: DdsImage, x: number, y: number, w: number, h: number, out: Uint8ClampedArray | Uint8Array): void {
  const dxt5 = image.format === "DXT5";
  const blockSize = dxt5 ? 16 : 8;
  const perRow = Math.ceil(image.width / 4);
  const x1 = Math.min(image.width, x + w), y1 = Math.min(image.height, y + h);
  const r = [0, 0, 0, 0], g = [0, 0, 0, 0], b = [0, 0, 0, 0], a = [255, 255, 255, 255];
  const alpha = new Uint8Array(8);
  for (let by = Math.max(0, y) >> 2; by * 4 < y1; by++) {
    for (let bx = Math.max(0, x) >> 2; bx * 4 < x1; bx++) {
      let p = image.data + (by * perRow + bx) * blockSize;
      let alphaLo = 0, alphaHi = 0;
      if (dxt5) {
        const a0 = bytes[p], a1 = bytes[p + 1];
        alpha[0] = a0;
        alpha[1] = a1;
        if (a0 > a1) {
          for (let i = 1; i < 7; i++) alpha[i + 1] = ((7 - i) * a0 + i * a1) / 7;
        } else {
          for (let i = 1; i < 5; i++) alpha[i + 1] = ((5 - i) * a0 + i * a1) / 5;
          alpha[6] = 0;
          alpha[7] = 255;
        }
        // Sixteen 3-bit picks in six bytes: the first eight in the low three, the rest in the high.
        alphaLo = bytes[p + 2] | (bytes[p + 3] << 8) | (bytes[p + 4] << 16);
        alphaHi = bytes[p + 5] | (bytes[p + 6] << 8) | (bytes[p + 7] << 16);
        p += 8;
      }
      const c0 = u16(bytes, p), c1 = u16(bytes, p + 2);
      r[0] = ((c0 >> 11) << 3) | (c0 >> 13); g[0] = (((c0 >> 5) & 63) << 2) | ((c0 >> 9) & 3); b[0] = ((c0 & 31) << 3) | ((c0 >> 2) & 7);
      r[1] = ((c1 >> 11) << 3) | (c1 >> 13); g[1] = (((c1 >> 5) & 63) << 2) | ((c1 >> 9) & 3); b[1] = ((c1 & 31) << 3) | ((c1 >> 2) & 7);
      a[3] = 255;
      if (dxt5 || c0 > c1) {
        r[2] = ((2 * r[0] + r[1]) / 3) | 0; g[2] = ((2 * g[0] + g[1]) / 3) | 0; b[2] = ((2 * b[0] + b[1]) / 3) | 0;
        r[3] = ((r[0] + 2 * r[1]) / 3) | 0; g[3] = ((g[0] + 2 * g[1]) / 3) | 0; b[3] = ((b[0] + 2 * b[1]) / 3) | 0;
      } else {
        r[2] = (r[0] + r[1]) >> 1; g[2] = (g[0] + g[1]) >> 1; b[2] = (b[0] + b[1]) >> 1;
        r[3] = 0; g[3] = 0; b[3] = 0; a[3] = 0;
      }
      const bits = u32(bytes, p + 4);
      for (let i = 0; i < 16; i++) {
        const px = bx * 4 + (i & 3), py = by * 4 + (i >> 2);
        if (px < x || py < y || px >= x1 || py >= y1) continue;
        const k = (bits >>> (i * 2)) & 3;
        const at = ((py - y) * w + (px - x)) * 4;
        out[at] = r[k]; out[at + 1] = g[k]; out[at + 2] = b[k];
        out[at + 3] = dxt5 ? alpha[((i < 8 ? alphaLo : alphaHi) >> ((i & 7) * 3)) & 7] : a[k];
      }
    }
  }
}
