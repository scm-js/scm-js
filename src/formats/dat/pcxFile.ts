/**
 * 8-bit PCX read and written (the game's `game\tunit.pcx`, `tileset\*\ofire.pcx`, …). `pcx.ts` is the editor's
 * reader; this one keeps the 128-byte header so a file comes back byte for byte, and writes new ones.
 *
 *   header (128 bytes): 0x0A, version 5, RLE 1, 8 bits, xmin ymin xmax ymax, dpi, 48-byte EGA palette, 0,
 *                       1 plane, bytes per line (even by the standard; game\thpbar.pcx has 19), palette type, screen size, 54 zero bytes
 *   pixels: each line `bytesPerLine` bytes, run-length coded — a byte ≥ 0xC0 is a count (low 6 bits) for the next
 *           byte; any other byte is itself. Runs do not cross lines.
 *   palette: 0x0C, then 256 × RGB.
 */

export interface PcxImage {
  width: number;
  height: number;
  /** `width × height` palette indices, row-major. */
  pixels: Uint8Array;
  /** 256 × RGB, or null for none. */
  palette: Uint8Array | null;
  /** The file's header as read, reused (with this image's size) when written. */
  header?: Uint8Array;
  /** Bytes a line takes in the file (≥ width; even in a standard file, odd in a few of the game's). */
  bytesPerLine?: number;
  /** The value a line's padding byte had. */
  padding?: number;
}

const HEADER = 128;

export function decodePcxImage(data: Uint8Array): PcxImage {
  if (data.length < HEADER || data[0] !== 0x0a) throw new Error("Not a PCX file");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data[3] !== 8 || data[65] !== 1) throw new Error(`Unsupported PCX: ${data[3]} bits × ${data[65]} planes (only 8-bit, one plane)`);
  const width = view.getUint16(8, true) - view.getUint16(4, true) + 1;
  const height = view.getUint16(10, true) - view.getUint16(6, true) + 1;
  const bytesPerLine = view.getUint16(66, true);
  if (bytesPerLine < width) throw new Error(`PCX lines are ${bytesPerLine} bytes for a ${width}-pixel width`);
  const hasPalette = data.length >= HEADER + 769 && data[data.length - 769] === 0x0c;
  const end = hasPalette ? data.length - 769 : data.length;
  const rows = new Uint8Array(bytesPerLine * height);
  let at = 0;
  for (let p = HEADER; p < end && at < rows.length; ) {
    let value = data[p++];
    let run = 1;
    if ((value & 0xc0) === 0xc0) { run = value & 0x3f; value = data[p++]; }
    for (let i = 0; i < run && at < rows.length; i++) rows[at++] = value;
  }
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) pixels.set(rows.subarray(y * bytesPerLine, y * bytesPerLine + width), y * width);
  return {
    width, height, pixels,
    palette: hasPalette ? data.slice(data.length - 768) : null,
    header: data.slice(0, HEADER),
    bytesPerLine,
    padding: bytesPerLine > width && height > 0 ? rows[width] : 0,
  };
}

/** A PCX: the image's own header when it has one (the size set from the image), else a standard one. */
export function encodePcxImage(image: PcxImage): Uint8Array {
  const { width, height } = image;
  if (width < 1 || height < 1 || width > 0xffff || height > 0xffff) throw new Error(`a PCX is 1–65535 pixels a side, not ${width} × ${height}`);
  if (image.pixels.length !== width * height) throw new Error(`a ${width} × ${height} PCX needs ${width * height} pixels, not ${image.pixels.length}`);
  const bytesPerLine = image.bytesPerLine !== undefined && image.bytesPerLine >= width ? image.bytesPerLine : width + (width & 1);
  const header = new Uint8Array(HEADER);
  if (image.header && image.header.length === HEADER) header.set(image.header);
  else {
    header[0] = 0x0a; header[1] = 5; header[2] = 1;
    const v = new DataView(header.buffer);
    v.setUint16(12, 72, true); v.setUint16(14, 72, true);
    v.setUint16(68, 1, true);
  }
  const hv = new DataView(header.buffer);
  header[3] = 8; header[65] = 1;
  hv.setUint16(4, 0, true); hv.setUint16(6, 0, true);
  hv.setUint16(8, width - 1, true); hv.setUint16(10, height - 1, true);
  hv.setUint16(66, bytesPerLine, true);
  const body: number[] = [];
  const line = new Uint8Array(bytesPerLine);
  const pad = image.padding ?? 0;
  for (let y = 0; y < height; y++) {
    line.set(image.pixels.subarray(y * width, (y + 1) * width));
    if (bytesPerLine > width) line[width] = pad;
    for (let x = 0; x < bytesPerLine; ) {
      const v = line[x];
      let n = 1;
      while (x + n < bytesPerLine && line[x + n] === v && n < 63) n++;
      if (n > 1 || v >= 0xc0) body.push(0xc0 | n, v);
      else body.push(v);
      x += n;
    }
  }
  const palette = image.palette;
  const out = new Uint8Array(HEADER + body.length + (palette ? 769 : 0));
  out.set(header);
  out.set(body, HEADER);
  if (palette) { out[HEADER + body.length] = 0x0c; out.set(palette.subarray(0, 768), HEADER + body.length + 1); }
  return out;
}
