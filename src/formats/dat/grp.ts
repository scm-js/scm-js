/**
 * GRP sprite sheets: palette-indexed, run-length encoded frames sharing one bounding box.
 *
 *   header      u16 frames, u16 width, u16 height
 *   frame table u8 x, u8 y, u8 width, u8 height, u32 offset       (8 bytes each)
 *   frame data  u16 lineOffset[height] (relative to the frame), then per line:
 *                 0x80|n  skip n transparent pixels
 *                 0x40|n  repeat the next byte n times
 *                 n       copy the next n bytes
 *
 * Palette index 0 is transparent. Indices 8–15 are the team colour slots the game remaps
 * per player (see `units/teamColor.ts`); a `lut` argument applies that remap here.
 */

export interface GrpFrame {
  /** Offset of the frame's pixels inside the shared box. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Byte offset of the frame's line table from the start of the file. */
  offset: number;
}

export interface Grp {
  width: number;
  height: number;
  frames: GrpFrame[];
  data: Uint8Array;
}

export function decodeGrp(data: Uint8Array): Grp {
  if (data.length < 6) throw new Error(`GRP too short (${data.length} bytes)`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint16(0, true);
  const width = view.getUint16(2, true);
  const height = view.getUint16(4, true);
  if (data.length < 6 + count * 8) throw new Error(`GRP declares ${count} frames but is only ${data.length} bytes`);
  const frames: GrpFrame[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 8;
    frames.push({ x: data[at], y: data[at + 1], width: data[at + 2], height: data[at + 3], offset: view.getUint32(at + 4, true) });
  }
  return { width, height, frames, data };
}

/**
 * Paint one frame into an RGBA buffer `destWidth` pixels wide, with the frame box's
 * top-left corner at (dx, dy). `palette` is 256 RGBA entries; `lut` optionally remaps
 * palette indices first. `flip` mirrors the frame inside the box, which is how the game
 * draws facings 17–31 from frames 15–1.
 */
export function drawGrpFrame(
  grp: Grp,
  frameIndex: number,
  dest: Uint8ClampedArray | Uint8Array,
  destWidth: number,
  dx: number,
  dy: number,
  palette: Uint8Array,
  lut: Uint8Array | null = null,
  flip = false,
) {
  const frame = grp.frames[frameIndex];
  if (!frame) return;
  const { data } = grp;
  const destHeight = dest.length / 4 / destWidth;
  const left = flip ? grp.width - frame.x - frame.width : frame.x;

  const put = (col: number, row: number, index: number) => {
    const c = lut ? lut[index] : index;
    if (c === 0) return;
    const px = dx + left + (flip ? frame.width - 1 - col : col);
    const py = dy + frame.y + row;
    if (px < 0 || py < 0 || px >= destWidth || py >= destHeight) return;
    const at = (py * destWidth + px) * 4;
    dest[at] = palette[c * 4];
    dest[at + 1] = palette[c * 4 + 1];
    dest[at + 2] = palette[c * 4 + 2];
    dest[at + 3] = 255;
  };

  for (let row = 0; row < frame.height; row++) {
    const lineAt = frame.offset + row * 2;
    if (lineAt + 2 > data.length) break;
    let p = frame.offset + (data[lineAt] | (data[lineAt + 1] << 8));
    let col = 0;
    while (col < frame.width && p < data.length) {
      const op = data[p++];
      if (op & 0x80) {
        col += op & 0x7f;
      } else if (op & 0x40) {
        const n = op & 0x3f;
        const c = data[p++];
        for (let i = 0; i < n && col < frame.width; i++) put(col++, row, c);
      } else {
        for (let i = 0; i < op && col < frame.width && p < data.length; i++) put(col++, row, data[p++]);
      }
    }
  }
}

/**
 * The frame that shows facing `direction` (0 = up, clockwise to 31) for a GRP whose
 * frames come in sets of 17: directions 0–16 are stored, 17–31 are the mirror of 15–1.
 */
export function facingFrame(direction: number): { frame: number; flip: boolean } {
  const d = ((direction % 32) + 32) % 32;
  return d <= 16 ? { frame: d, flip: false } : { frame: 32 - d, flip: true };
}
