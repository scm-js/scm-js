/**
 * Minimal PCX reader for the game's 8-bit, single-plane images (game\tunit.pcx and
 * friends). Pixels come back as palette indices; the trailing 256-colour palette is
 * returned too when present.
 */
export interface Pcx {
  width: number;
  height: number;
  /** `width * height` palette indices, row-major. */
  pixels: Uint8Array;
  /** 256 × RGB, or null when the file has no palette block. */
  palette: Uint8Array | null;
}

const HEADER = 128;

export function decodePcx(data: Uint8Array): Pcx {
  if (data.length < HEADER || data[0] !== 0x0a) throw new Error("Not a PCX file");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bitsPerPixel = data[3];
  const planes = data[65];
  if (bitsPerPixel !== 8 || planes !== 1) throw new Error(`Unsupported PCX: ${bitsPerPixel} bpp × ${planes} planes`);
  const width = view.getUint16(8, true) - view.getUint16(4, true) + 1;
  const height = view.getUint16(10, true) - view.getUint16(6, true) + 1;
  const bytesPerLine = view.getUint16(66, true);

  const hasPalette = data.length >= HEADER + 769 && data[data.length - 769] === 0x0c;
  const end = hasPalette ? data.length - 769 : data.length;
  const rows = new Uint8Array(bytesPerLine * height);
  let at = 0;
  for (let p = HEADER; p < end && at < rows.length; ) {
    let value = data[p++];
    let run = 1;
    if ((value & 0xc0) === 0xc0) {
      run = value & 0x3f;
      value = data[p++];
    }
    for (let i = 0; i < run && at < rows.length; i++) rows[at++] = value;
  }

  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) pixels.set(rows.subarray(y * bytesPerLine, y * bytesPerLine + width), y * width);
  return { width, height, pixels, palette: hasPalette ? data.slice(data.length - 768) : null };
}
