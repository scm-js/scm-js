/**
 * RIFF/WAVE, the one sound format every StarCraft build plays. `parseWavHeader` reads the
 * `fmt ` and `data` chunks so the Sound Editor can say what a file is (and whether the game
 * or Web Audio will take it); `encodeWav` / `decodePcmWav` are the plain-PCM codec the import
 * conversion writes through. Pure, so the round trip is tested under Node; the decoding of
 * MP3 / Ogg / FLAC and the resampling are the browser's (`services/audioConvert.ts`).
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
}

/** Whether Web Audio and the game both play the file as it is: integer PCM, 8 or 16 bits. */
export function isPlainPcm(info: WavInfo): boolean {
  return info.format === WAV_FORMAT.pcm && (info.bitsPerSample === 8 || info.bitsPerSample === 16) && info.channels >= 1;
}

/** Duration in seconds, from the data length. */
export function wavDuration(info: WavInfo): number {
  const frame = info.channels * Math.ceil(info.bitsPerSample / 8);
  return frame > 0 && info.sampleRate > 0 ? info.dataLength / frame / info.sampleRate : 0;
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
      const bitsPerSample = dv.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: cbSize (16) validBits (18) channelMask (20) subFormat GUID (24..40),
      // whose first two bytes are the ordinary format tag.
      if (format === WAV_FORMAT.extensible && size >= 40 && body + 26 <= bytes.length) format = dv.getUint16(body + 24, true);
      fmt = { format, channels, sampleRate, bitsPerSample };
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

/** Reads plain 8/16-bit PCM back into floats; null for anything else. */
export function decodePcmWav(bytes: Uint8Array): PcmAudio | null {
  const info = parseWavHeader(bytes);
  if (!info || !isPlainPcm(info)) return null;
  const bytesPerSample = info.bitsPerSample / 8;
  const frames = Math.floor(info.dataLength / (info.channels * bytesPerSample));
  const channels = Array.from({ length: info.channels }, () => new Float32Array(frames));
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = info.dataOffset;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < info.channels; c++) {
      if (info.bitsPerSample === 16) {
        const s = dv.getInt16(at, true);
        channels[c][i] = s < 0 ? s / 32768 : s / 32767;
        at += 2;
      } else {
        channels[c][i] = bytes[at++] / 127.5 - 1;
      }
    }
  }
  return { sampleRate: info.sampleRate, channels };
}
