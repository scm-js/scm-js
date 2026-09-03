/**
 * RIFF/WAVE, the one sound format every StarCraft build plays. `parseWavHeader` reads the
 * `fmt ` and `data` chunks so the Sound Editor can say what a file is (and whether the game
 * or Web Audio will take it); `encodeWav` writes the plain PCM the import conversion
 * produces, and `decodeWav` reads every WAV encoding the game's own sounds and the usual
 * tools come in — 8/16/24/32-bit PCM, 32/64-bit float, A-law, µ-law, IMA ADPCM and
 * Microsoft ADPCM — so a sound lifted out of the game's archives plays and converts here
 * without the browser's help. Pure, so the round trips are tested under Node; the decoding
 * of MP3 / Ogg / FLAC and the resampling are the browser's (`services/audioConvert.ts`).
 */

/** `fmt ` format tags this module knows by name. */
export const WAV_FORMAT = {
  pcm: 1,
  msAdpcm: 2,
  float: 3,
  alaw: 6,
  mulaw: 7,
  imaAdpcm: 0x11,
  extensible: 0xfffe,
} as const;

export interface WavInfo {
  /** The `fmt ` tag; for WAVE_FORMAT_EXTENSIBLE the sub-format's tag (its GUID's first field). */
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** Byte length of the `data` chunk, clipped to the file. */
  dataLength: number;
  /** Offset of the first sample byte. */
  dataOffset: number;
  /** Bytes per frame (PCM) or per block (ADPCM), from the header. */
  blockAlign: number;
  /** The `fmt ` chunk's bytes past the 16 common ones (ADPCM's block parameters and coefficients). */
  extra: Uint8Array;
}

/** Whether Web Audio and the game both play the file as it is: integer PCM, 8 or 16 bits. */
export function isPlainPcm(info: WavInfo): boolean {
  return info.format === WAV_FORMAT.pcm && (info.bitsPerSample === 8 || info.bitsPerSample === 16) && info.channels >= 1;
}

/** Whether `decodeWav` reads this encoding. */
export function canDecodeWav(info: WavInfo): boolean {
  switch (info.format) {
    case WAV_FORMAT.pcm: return [8, 16, 24, 32].includes(info.bitsPerSample) && info.channels >= 1;
    case WAV_FORMAT.float: return (info.bitsPerSample === 32 || info.bitsPerSample === 64) && info.channels >= 1;
    case WAV_FORMAT.alaw: case WAV_FORMAT.mulaw: return info.bitsPerSample === 8 && info.channels >= 1;
    case WAV_FORMAT.imaAdpcm: return info.bitsPerSample === 4 && info.channels >= 1 && info.blockAlign > 4 * info.channels;
    case WAV_FORMAT.msAdpcm: return info.bitsPerSample === 4 && info.channels >= 1 && info.blockAlign > 7 * info.channels;
    default: return false;
  }
}

/** Frames in the data chunk, for any encoding this module knows. */
export function wavFrames(info: WavInfo): number {
  if (info.format === WAV_FORMAT.imaAdpcm || info.format === WAV_FORMAT.msAdpcm) {
    if (info.blockAlign <= 0) return 0;
    const blocks = Math.floor(info.dataLength / info.blockAlign);
    const tail = info.dataLength - blocks * info.blockAlign;
    const perBlock = adpcmSamplesPerBlock(info);
    // A short final block holds fewer samples; count what its bytes can carry.
    const tailSamples = tail > 0 ? Math.max(0, adpcmSamplesPerBlock({ ...info, blockAlign: tail })) : 0;
    return blocks * perBlock + tailSamples;
  }
  const frame = info.channels * Math.ceil(info.bitsPerSample / 8);
  return frame > 0 ? Math.floor(info.dataLength / frame) : 0;
}

/** Duration in seconds, from the header — no decoding needed. */
export function wavDuration(info: WavInfo): number {
  return info.sampleRate > 0 ? wavFrames(info) / info.sampleRate : 0;
}

/** Samples per block for the two ADPCM layouts: the header's own count when it carries one, else what the block size implies. */
function adpcmSamplesPerBlock(info: WavInfo): number {
  const declared = info.extra.length >= 4 ? info.extra[2] | (info.extra[3] << 8) : 0;
  if (info.format === WAV_FORMAT.imaAdpcm) {
    const implied = Math.floor((info.blockAlign - 4 * info.channels) * 8 / (4 * info.channels)) + 1;
    return declared > 0 ? Math.min(declared, implied) : implied;
  }
  const implied = Math.floor((info.blockAlign - 7 * info.channels) * 2 / info.channels) + 2;
  return declared > 0 ? Math.min(declared, implied) : implied;
}

/** A short label: `22050 Hz · 16-bit · mono`, with the codec named when it is not plain PCM. */
export function wavFormatLabel(info: WavInfo): string {
  const ch = info.channels === 1 ? "mono" : info.channels === 2 ? "stereo" : `${info.channels} ch`;
  const codec = wavCodecName(info.format);
  return `${info.sampleRate} Hz · ${info.bitsPerSample}-bit · ${ch}${codec ? ` · ${codec}` : ""}`;
}

export function wavCodecName(format: number): string | null {
  switch (format) {
    case WAV_FORMAT.pcm: return null;
    case WAV_FORMAT.msAdpcm: return "MS ADPCM";
    case WAV_FORMAT.imaAdpcm: return "IMA ADPCM";
    case WAV_FORMAT.float: return "float";
    case WAV_FORMAT.alaw: return "A-law";
    case WAV_FORMAT.mulaw: return "µ-law";
    default: return `format 0x${format.toString(16)}`;
  }
}

/** Reads the header of a RIFF/WAVE file; null when the bytes are not one. */
export function parseWavHeader(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 12 || tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WAVE") return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: Omit<WavInfo, "dataLength" | "dataOffset"> | null = null;
  let data: { offset: number; length: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(bytes, at);
    const size = dv.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= bytes.length) {
      let format = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      const sampleRate = dv.getUint32(body + 4, true);
      const blockAlign = dv.getUint16(body + 12, true);
      const bitsPerSample = dv.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: cbSize (16) validBits (18) channelMask (20) subFormat GUID (24..40),
      // whose first two bytes are the ordinary format tag.
      if (format === WAV_FORMAT.extensible && size >= 40 && body + 26 <= bytes.length) format = dv.getUint16(body + 24, true);
      const extra = bytes.subarray(body + 16, Math.min(body + size, bytes.length));
      fmt = { format, channels, sampleRate, bitsPerSample, blockAlign, extra };
    } else if (id === "data") {
      data = { offset: body, length: Math.min(size, bytes.length - body) };
      if (fmt) break; // fmt precedes data in every file the game writes; keep scanning otherwise
    }
    at = body + size + (size & 1); // chunks are word-aligned
  }
  if (!fmt) return null;
  return { ...fmt, dataLength: data?.length ?? 0, dataOffset: data?.offset ?? bytes.length };
}

function tag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

export type WavBits = 8 | 16;

/**
 * Writes plain PCM: 8-bit unsigned or 16-bit signed little-endian, channels interleaved.
 * Samples are floats in -1..1 and are clipped; every channel is taken to be `channels[0]`'s length.
 */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number, bits: WavBits): Uint8Array {
  if (channels.length === 0) throw new Error("encodeWav: no channels");
  const frames = channels[0].length;
  const bytesPerSample = bits / 8;
  const blockAlign = channels.length * bytesPerSample;
  const dataLength = frames * blockAlign;
  const out = new Uint8Array(44 + dataLength);
  const dv = new DataView(out.buffer);
  const ascii = (at: number, s: string) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  ascii(0, "RIFF");
  dv.setUint32(4, 36 + dataLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, WAV_FORMAT.pcm, true);
  dv.setUint16(22, channels.length, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bits, true);
  ascii(36, "data");
  dv.setUint32(40, dataLength, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) {
      const v = Math.max(-1, Math.min(1, ch[i] ?? 0));
      if (bits === 16) {
        dv.setInt16(at, Math.round(v < 0 ? v * 32768 : v * 32767), true);
        at += 2;
      } else {
        out[at++] = Math.round((v + 1) * 127.5);
      }
    }
  }
  return out;
}

export interface PcmAudio {
  sampleRate: number;
  /** One Float32Array per channel, samples in -1..1. */
  channels: Float32Array[];
}

/** Reads plain 8/16-bit PCM back into floats; null for anything else (`decodeWav` takes the rest). */
export function decodePcmWav(bytes: Uint8Array): PcmAudio | null {
  const info = parseWavHeader(bytes);
  if (!info || !isPlainPcm(info)) return null;
  return decodePcm(bytes, info);
}

/**
 * Reads any WAV encoding this module knows (`canDecodeWav`) back into floats — the game's
 * IMA ADPCM sounds included; null for a file that is not a WAV or is in an encoding it
 * does not know (then Web Audio may still take it).
 */
export function decodeWav(bytes: Uint8Array): PcmAudio | null {
  const info = parseWavHeader(bytes);
  if (!info || !canDecodeWav(info)) return null;
  switch (info.format) {
    case WAV_FORMAT.pcm: return decodePcm(bytes, info);
    case WAV_FORMAT.float: return decodeFloat(bytes, info);
    case WAV_FORMAT.alaw: return decodeCompanded(bytes, info, alawSample);
    case WAV_FORMAT.mulaw: return decodeCompanded(bytes, info, mulawSample);
    case WAV_FORMAT.imaAdpcm: return decodeImaAdpcm(bytes, info);
    case WAV_FORMAT.msAdpcm: return decodeMsAdpcm(bytes, info);
    default: return null;
  }
}

function decodePcm(bytes: Uint8Array, info: WavInfo): PcmAudio {
  const bytesPerSample = info.bitsPerSample / 8;
  const frames = Math.floor(info.dataLength / (info.channels * bytesPerSample));
  const channels = Array.from({ length: info.channels }, () => new Float32Array(frames));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = info.dataOffset;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < info.channels; c++) {
      switch (info.bitsPerSample) {
        case 8: channels[c][i] = bytes[at] / 127.5 - 1; break;
        case 16: { const s = dv.getInt16(at, true); channels[c][i] = s < 0 ? s / 32768 : s / 32767; break; }
        case 24: { const s = (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)) << 8 >> 8; channels[c][i] = s < 0 ? s / 8388608 : s / 8388607; break; }
        default: { const s = dv.getInt32(at, true); channels[c][i] = s < 0 ? s / 2147483648 : s / 2147483647; break; }
      }
      at += bytesPerSample;
    }
  }
  return { sampleRate: info.sampleRate, channels };
}

function decodeFloat(bytes: Uint8Array, info: WavInfo): PcmAudio {
  const bytesPerSample = info.bitsPerSample / 8;
  const frames = Math.floor(info.dataLength / (info.channels * bytesPerSample));
  const channels = Array.from({ length: info.channels }, () => new Float32Array(frames));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = info.dataOffset;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < info.channels; c++) {
      const v = bytesPerSample === 4 ? dv.getFloat32(at, true) : dv.getFloat64(at, true);
      channels[c][i] = Math.max(-1, Math.min(1, v));
      at += bytesPerSample;
    }
  }
  return { sampleRate: info.sampleRate, channels };
}

function decodeCompanded(bytes: Uint8Array, info: WavInfo, sample: (b: number) => number): PcmAudio {
  const frames = Math.floor(info.dataLength / info.channels);
  const channels = Array.from({ length: info.channels }, () => new Float32Array(frames));
  let at = info.dataOffset;
  for (let i = 0; i < frames; i++) for (let c = 0; c < info.channels; c++) channels[c][i] = sample(bytes[at++]) / 32768;
  return { sampleRate: info.sampleRate, channels };
}

/** ITU G.711 µ-law byte → 16-bit sample. */
function mulawSample(b: number): number {
  const u = ~b & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 7;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

/** ITU G.711 A-law byte → 16-bit sample. */
function alawSample(b: number): number {
  const a = b ^ 0x55;
  const sign = a & 0x80;
  const exponent = (a >> 4) & 7;
  const mantissa = a & 0x0f;
  const sample = exponent === 0 ? (mantissa << 4) + 8 : ((mantissa << 4) + 0x108) << (exponent - 1);
  return sign ? sample : -sample;
}

const IMA_INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const IMA_STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552,
  1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

/**
 * IMA ADPCM (format 0x11): per block, a 4-byte header per channel — the first sample as a
 * signed 16-bit value, then the step index — followed by 4-byte words of eight nibbles,
 * one word per channel in turn, low nibble first. What the game's own sound files are.
 */
function decodeImaAdpcm(bytes: Uint8Array, info: WavInfo): PcmAudio {
  const ch = info.channels;
  const perBlock = adpcmSamplesPerBlock(info);
  const frames = wavFrames(info);
  const channels = Array.from({ length: ch }, () => new Float32Array(frames));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const predictor = new Int32Array(ch), index = new Int32Array(ch);
  let frame = 0;
  const end = info.dataOffset + info.dataLength;
  for (let block = info.dataOffset; block + 4 * ch <= end && frame < frames; block += info.blockAlign) {
    const blockEnd = Math.min(block + info.blockAlign, end);
    let at = block;
    for (let c = 0; c < ch; c++) {
      predictor[c] = dv.getInt16(at, true);
      index[c] = Math.max(0, Math.min(88, bytes[at + 2]));
      channels[c][frame] = predictor[c] / 32768;
      at += 4;
    }
    let n = frame + 1;
    const blockLast = Math.min(frames, frame + perBlock);
    while (n < blockLast && at + 4 * ch <= blockEnd) {
      for (let c = 0; c < ch; c++) {
        for (let k = 0; k < 8 && n + (k >> 0) < blockLast; k++) {
          const nibble = k % 2 === 0 ? bytes[at + (k >> 1)] & 0x0f : bytes[at + (k >> 1)] >> 4;
          const step = IMA_STEP_TABLE[index[c]];
          let diff = step >> 3;
          if (nibble & 1) diff += step >> 2;
          if (nibble & 2) diff += step >> 1;
          if (nibble & 4) diff += step;
          if (nibble & 8) diff = -diff;
          predictor[c] = Math.max(-32768, Math.min(32767, predictor[c] + diff));
          index[c] = Math.max(0, Math.min(88, index[c] + IMA_INDEX_TABLE[nibble]));
          if (n + k < frames) channels[c][n + k] = predictor[c] / 32768;
        }
        at += 4;
      }
      n += 8;
    }
    frame = blockLast;
  }
  return { sampleRate: info.sampleRate, channels };
}

const MS_ADAPTATION = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];
const MS_COEFS: [number, number][] = [[256, 0], [512, -256], [0, 0], [192, 64], [240, 0], [460, -208], [392, -232]];

/**
 * Microsoft ADPCM (format 2): per block, a predictor index byte per channel, then a
 * 16-bit delta, first and second sample per channel, then nibbles high-first, channels
 * interleaved nibble by nibble. The coefficient table comes from the `fmt ` extra bytes
 * (the seven standard pairs when absent).
 */
function decodeMsAdpcm(bytes: Uint8Array, info: WavInfo): PcmAudio {
  const ch = info.channels;
  const perBlock = adpcmSamplesPerBlock(info);
  const frames = wavFrames(info);
  const channels = Array.from({ length: ch }, () => new Float32Array(frames));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const coefs: [number, number][] = [];
  const ex = info.extra;
  const count = ex.length >= 6 ? ex[4] | (ex[5] << 8) : 0;
  for (let i = 0; i < count && 6 + i * 4 + 3 < ex.length; i++) {
    const c1 = (ex[6 + i * 4] | (ex[7 + i * 4] << 8)) << 16 >> 16, c2 = (ex[8 + i * 4] | (ex[9 + i * 4] << 8)) << 16 >> 16;
    coefs.push([c1, c2]);
  }
  const table = coefs.length > 0 ? coefs : MS_COEFS;
  const end = info.dataOffset + info.dataLength;
  let frame = 0;
  const c1 = new Int32Array(ch), c2 = new Int32Array(ch), delta = new Int32Array(ch), s1 = new Int32Array(ch), s2 = new Int32Array(ch);
  for (let block = info.dataOffset; block + 7 * ch <= end && frame < frames; block += info.blockAlign) {
    const blockEnd = Math.min(block + info.blockAlign, end);
    let at = block;
    for (let c = 0; c < ch; c++) { const [a, b] = table[Math.min(bytes[at++], table.length - 1)]; c1[c] = a; c2[c] = b; }
    for (let c = 0; c < ch; c++) { delta[c] = dv.getInt16(at, true); at += 2; }
    for (let c = 0; c < ch; c++) { s1[c] = dv.getInt16(at, true); at += 2; }
    for (let c = 0; c < ch; c++) { s2[c] = dv.getInt16(at, true); at += 2; }
    const blockLast = Math.min(frames, frame + perBlock);
    for (let c = 0; c < ch; c++) {
      if (frame < frames) channels[c][frame] = s2[c] / 32768;
      if (frame + 1 < frames) channels[c][frame + 1] = s1[c] / 32768;
    }
    let n = frame + 2;
    let high = true;
    let c = 0;
    while (n < blockLast && at < blockEnd) {
      const nibble = high ? bytes[at] >> 4 : bytes[at] & 0x0f;
      if (!high) at++;
      high = !high;
      const signed = nibble >= 8 ? nibble - 16 : nibble;
      let predicted = ((s1[c] * c1[c] + s2[c] * c2[c]) >> 8) + signed * delta[c];
      predicted = Math.max(-32768, Math.min(32767, predicted));
      s2[c] = s1[c];
      s1[c] = predicted;
      delta[c] = Math.max(16, (MS_ADAPTATION[nibble] * delta[c]) >> 8);
      channels[c][n] = predicted / 32768;
      c++;
      if (c === ch) { c = 0; n++; }
    }
    frame = blockLast;
  }
  return { sampleRate: info.sampleRate, channels };
}
