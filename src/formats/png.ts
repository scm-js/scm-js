/**
 * PNG read and written with nothing but the platform: zlib is the `CompressionStream` / `DecompressionStream`
 * ("deflate") every browser and Node 18+ has, so this works in the editor, the command line and a worker alike, and
 * is async for that reason.
 *
 * Read: 8-bit (and 16-bit, kept to the high byte) greyscale, RGB, palette (1/2/4/8-bit), grey+alpha and RGBA, not
 * interlaced; `tRNS` honoured. Written: RGBA, or palette images with their PLTE/tRNS. `tEXt` chunks both ways.
 */

export interface PngImage {
  width: number;
  height: number;
  /** `width × height × 4` RGBA. */
  rgba: Uint8Array;
  /** For a palette image: its indices and palette (256 × RGBA at most), as stored. */
  indexed?: { indices: Uint8Array; palette: Uint8Array };
  /** tEXt chunks. */
  text: Record<string, string>;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function through(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close()).catch(() => { /* surfaced by the reader */ });
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** zlib (RFC 1950) inflate and deflate, by the platform. */
export const inflate = (data: Uint8Array) => through(data, new DecompressionStream("deflate"));
export const deflate = (data: Uint8Array) => through(data, new CompressionStream("deflate"));

export function isPng(data: Uint8Array): boolean {
  return data.length >= 8 && SIGNATURE.every((b, i) => data[i] === b);
}

export async function decodePng(data: Uint8Array): Promise<PngImage> {
  if (!isPng(data)) throw new Error("Not a PNG file");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 8;
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  let plte: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  const text: Record<string, string> = {};
  while (at + 8 <= data.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...data.subarray(at + 4, at + 8));
    const body = data.subarray(at + 8, at + 8 + len);
    if (at + 12 + len > data.length) throw new Error(`PNG chunk ${type} runs past the end`);
    if (crc32(data, at + 4, at + 8 + len) !== view.getUint32(at + 8 + len)) throw new Error(`PNG chunk ${type} fails its checksum`);
    if (type === "IHDR") {
      width = view.getUint32(at + 8); height = view.getUint32(at + 12);
      depth = body[8]; colour = body[9]; interlace = body[12];
    } else if (type === "PLTE") plte = body.slice();
    else if (type === "tRNS") trns = body.slice();
    else if (type === "IDAT") idat.push(body);
    else if (type === "tEXt") {
      const zero = body.indexOf(0);
      if (zero > 0) text[latin1(body.subarray(0, zero))] = latin1(body.subarray(zero + 1));
    } else if (type === "IEND") break;
    at += 12 + len;
  }
  if (!width || !height) throw new Error("PNG has no IHDR");
  if (interlace) throw new Error("interlaced PNGs are not read; save it without interlacing");
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colour];
  if (!channels) throw new Error(`PNG colour type ${colour} is not one PNG defines`);
  if (colour === 3 ? ![1, 2, 4, 8].includes(depth) : ![8, 16].includes(depth) && !(colour === 0 && [1, 2, 4].includes(depth))) throw new Error(`PNG bit depth ${depth} with colour type ${colour} is not read`);
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of idat) { joined.set(c, p); p += c.length; }
  const raw = await inflate(joined);
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * height) throw new Error("PNG image data is shorter than its size says");
  const lines = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filter !== 0) throw new Error(`PNG line ${y} has filter ${filter}`);
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  const sample = (y: number, i: number): number => {
    // i-th sample of line y, scaled to 8 bits (palette indices are not scaled).
    if (depth === 8) return lines[y * stride + i];
    if (depth === 16) return lines[y * stride + i * 2];
    const perByte = 8 / depth;
    const byte = lines[y * stride + Math.floor(i / perByte)];
    const v = (byte >> (8 - depth * ((i % perByte) + 1))) & ((1 << depth) - 1);
    return colour === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  const rgba = new Uint8Array(width * height * 4);
  let indexed: PngImage["indexed"];
  if (colour === 3) {
    if (!plte) throw new Error("palette PNG has no PLTE");
    const n = plte.length / 3;
    const palette = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { palette.set(plte.subarray(i * 3, i * 3 + 3), i * 4); palette[i * 4 + 3] = trns && i < trns.length ? trns[i] : 255; }
    const indices = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const k = sample(y, x);
      indices[y * width + x] = k;
      rgba.set(k < n ? palette.subarray(k * 4, k * 4 + 4) : [0, 0, 0, 255], (y * width + x) * 4);
    }
    indexed = { indices, palette };
  } else {
    const key = trns && (colour === 0 || colour === 2) ? Array.from({ length: trns.length / 2 }, (_, i) => trns![i * 2 + (depth === 16 ? 0 : 1)]) : null;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colour === 0 || colour === 4) {
        const g = sample(y, x * channels);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = colour === 4 ? sample(y, x * channels + 1) : key && g === key[0] ? 0 : 255;
      } else {
        rgba[o] = sample(y, x * channels); rgba[o + 1] = sample(y, x * channels + 1); rgba[o + 2] = sample(y, x * channels + 2);
        rgba[o + 3] = colour === 6 ? sample(y, x * channels + 3) : key && rgba[o] === key[0] && rgba[o + 1] === key[1] && rgba[o + 2] === key[2] ? 0 : 255;
      }
    }
  }
  return { width, height, rgba, ...(indexed ? { indexed } : {}), text };
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function latin1Bytes(s: string): number[] {
  return Array.from(s, (c) => { const v = c.charCodeAt(0); if (v > 255) throw new Error(`PNG text holds Latin-1 only; "${c}" is not`); return v; });
}

export interface EncodePngInput {
  width: number;
  height: number;
  /** RGBA pixels, or palette indices with `palette`. */
  rgba?: Uint8Array;
  indices?: Uint8Array;
  /** 256 × RGB or × RGBA (an index whose alpha is below 255 gets a tRNS entry). */
  palette?: Uint8Array;
  text?: Record<string, string>;
}

export async function encodePng(image: EncodePngInput): Promise<Uint8Array> {
  const { width, height } = image;
  const indexed = !!image.indices;
  if (indexed && !image.palette) throw new Error("a palette PNG needs its palette");
  const channels = indexed ? 1 : 4;
  const pixels = indexed ? image.indices! : image.rgba!;
  if (!pixels || pixels.length !== width * height * channels) throw new Error(`a ${width} × ${height} PNG needs ${width * height * channels} values`);
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const chunks: [string, Uint8Array][] = [];
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = indexed ? 3 : 6;
  chunks.push(["IHDR", ihdr]);
  if (indexed) {
    const pal = image.palette!;
    const per = pal.length % 4 === 0 && pal.length / 4 <= 256 && pal.length !== 768 ? 4 : 3;
    const n = Math.min(256, pal.length / per);
    const plte = new Uint8Array(n * 3);
    const alpha: number[] = [];
    for (let i = 0; i < n; i++) { plte.set(pal.subarray(i * per, i * per + 3), i * 3); alpha.push(per === 4 ? pal[i * per + 3] : 255); }
    chunks.push(["PLTE", plte]);
    let last = alpha.length;
    while (last > 0 && alpha[last - 1] === 255) last--;
    if (last) chunks.push(["tRNS", new Uint8Array(alpha.slice(0, last))]);
  }
  for (const [k, v] of Object.entries(image.text ?? {})) chunks.push(["tEXt", new Uint8Array([...latin1Bytes(k), 0, ...latin1Bytes(v)])]);
  chunks.push(["IDAT", await deflate(raw)]);
  chunks.push(["IEND", new Uint8Array(0)]);
  const out = new Uint8Array(8 + chunks.reduce((n, [, b]) => n + 12 + b.length, 0));
  out.set(SIGNATURE);
  const view = new DataView(out.buffer);
  let at = 8;
  for (const [type, body] of chunks) {
    view.setUint32(at, body.length);
    for (let i = 0; i < 4; i++) out[at + 4 + i] = type.charCodeAt(i);
    out.set(body, at + 8);
    view.setUint32(at + 8 + body.length, crc32(out, at + 4, at + 8 + body.length));
    at += 12 + body.length;
  }
  return out;
}
