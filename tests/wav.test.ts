import { describe, expect, it } from "vitest";
import { decodePcmWav, encodeWav, isPlainPcm, parseWavHeader, WAV_FORMAT, wavDuration, wavFormatLabel } from "../src/formats/wav";
import { matchesTarget, WAV_PRESETS, withWavExtension } from "../src/services/audioConvert";

function tone(frames: number, rate: number, hz: number) {
  return Float32Array.from({ length: frames }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate) * 0.8);
}

describe("wav", () => {
  it("round-trips 16-bit stereo PCM through the header and the samples", () => {
    const l = tone(2205, 22050, 440);
    const r = tone(2205, 22050, 660);
    const bytes = encodeWav([l, r], 22050, 16);
    expect(bytes.length).toBe(44 + 2205 * 4);
    const info = parseWavHeader(bytes)!;
    expect(info).toMatchObject({ format: WAV_FORMAT.pcm, channels: 2, sampleRate: 22050, bitsPerSample: 16, dataLength: 2205 * 4, dataOffset: 44 });
    expect(isPlainPcm(info)).toBe(true);
    expect(wavDuration(info)).toBeCloseTo(0.1, 5);
    expect(wavFormatLabel(info)).toBe("22050 Hz · 16-bit · stereo");
    const back = decodePcmWav(bytes)!;
    expect(back.sampleRate).toBe(22050);
    expect(back.channels.length).toBe(2);
    for (let i = 0; i < l.length; i += 97) {
      expect(back.channels[0][i]).toBeCloseTo(l[i], 3);
      expect(back.channels[1][i]).toBeCloseTo(r[i], 3);
    }
  });

  it("writes 8-bit as unsigned bytes and clips out-of-range samples", () => {
    const bytes = encodeWav([Float32Array.from([0, 1, -1, 2, -2])], 11025, 8);
    expect(Array.from(bytes.subarray(44))).toEqual([128, 255, 0, 255, 0]);
    const info = parseWavHeader(bytes)!;
    expect(info).toMatchObject({ channels: 1, sampleRate: 11025, bitsPerSample: 8, dataLength: 5 });
    expect(wavFormatLabel(info)).toBe("11025 Hz · 8-bit · mono");
    const back = decodePcmWav(bytes)!;
    expect(Array.from(back.channels[0]).map((v) => Math.round(v * 100) / 100)).toEqual([0, 1, -1, 1, -1]);
  });

  it("names non-PCM encodings and refuses to decode them", () => {
    const bytes = encodeWav([new Float32Array(4)], 22050, 16);
    new DataView(bytes.buffer).setUint16(20, WAV_FORMAT.imaAdpcm, true);
    const info = parseWavHeader(bytes)!;
    expect(info.format).toBe(WAV_FORMAT.imaAdpcm);
    expect(isPlainPcm(info)).toBe(false);
    expect(wavFormatLabel(info)).toBe("22050 Hz · 16-bit · mono · IMA ADPCM");
    expect(decodePcmWav(bytes)).toBeNull();
  });

  it("reads WAVE_FORMAT_EXTENSIBLE through to the sub-format and skips odd-sized chunks", () => {
    // RIFF, WAVE, a 3-byte LIST chunk (padded to 4), an extensible fmt (40 bytes), data.
    const data = new Uint8Array(8);
    const out = new Uint8Array(12 + 8 + 4 + 8 + 40 + 8 + data.length);
    const dv = new DataView(out.buffer);
    const ascii = (at: number, s: string) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
    ascii(0, "RIFF"); dv.setUint32(4, out.length - 8, true); ascii(8, "WAVE");
    ascii(12, "LIST"); dv.setUint32(16, 3, true);
    const fmt = 12 + 8 + 4;
    ascii(fmt, "fmt "); dv.setUint32(fmt + 4, 40, true);
    dv.setUint16(fmt + 8, WAV_FORMAT.extensible, true);
    dv.setUint16(fmt + 10, 2, true);
    dv.setUint32(fmt + 12, 44100, true);
    dv.setUint16(fmt + 22, 16, true);
    dv.setUint16(fmt + 24, 22, true); // cbSize
    dv.setUint16(fmt + 32, WAV_FORMAT.pcm, true); // sub-format GUID's first field
    const d = fmt + 48;
    ascii(d, "data"); dv.setUint32(d + 4, data.length, true);
    const info = parseWavHeader(out)!;
    expect(info).toMatchObject({ format: WAV_FORMAT.pcm, channels: 2, sampleRate: 44100, bitsPerSample: 16, dataLength: 8, dataOffset: d + 8 });
    expect(isPlainPcm(info)).toBe(true);
  });

  it("returns null for anything that is not RIFF/WAVE", () => {
    expect(parseWavHeader(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull(); // ID3 (MP3)
    expect(parseWavHeader(new Uint8Array(0))).toBeNull();
    const riffOnly = encodeWav([new Float32Array(1)], 8000, 8).subarray(0, 20); // truncated before fmt's body
    expect(parseWavHeader(riffOnly)).toBeNull();
  });

  it("matches a file against a preset and renames converted imports", () => {
    const game = WAV_PRESETS[0].target;
    expect(game).toEqual({ sampleRate: 22050, channels: 1, bits: 16 });
    expect(matchesTarget(parseWavHeader(encodeWav([new Float32Array(10)], 22050, 16))!, game)).toBe(true);
    expect(matchesTarget(parseWavHeader(encodeWav([new Float32Array(10)], 44100, 16))!, game)).toBe(false);
    expect(matchesTarget(parseWavHeader(encodeWav([new Float32Array(10), new Float32Array(10)], 22050, 16))!, game)).toBe(false);
    expect(withWavExtension("Round Start.mp3")).toBe("Round Start.wav");
    expect(withWavExtension("a.b.flac")).toBe("a.b.wav");
    expect(withWavExtension("noext")).toBe("noext.wav");
    expect(withWavExtension("dir.v2\\clip")).toBe("dir.v2\\clip.wav");
  });
});

/* ── The other encodings ────────────────────────────────── */

import { canDecodeWav, decodeWav, wavFrames } from "../src/formats/wav";

/** A RIFF/WAVE file around a `fmt ` body and a data chunk, for the encoders below. */
function wavFile(fmtBody: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + 8 + fmtBody.length + 8 + data.length);
  const dv = new DataView(out.buffer);
  const ascii = (at: number, s: string) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  ascii(0, "RIFF"); dv.setUint32(4, out.length - 8, true); ascii(8, "WAVE");
  ascii(12, "fmt "); dv.setUint32(16, fmtBody.length, true); out.set(fmtBody, 20);
  const d = 20 + fmtBody.length;
  ascii(d, "data"); dv.setUint32(d + 4, data.length, true); out.set(data, d + 8);
  return out;
}

function fmtBody(format: number, channels: number, rate: number, bits: number, blockAlign: number, extra: Uint8Array = new Uint8Array(0)): Uint8Array {
  const body = new Uint8Array(16 + (extra.length > 0 ? 2 + extra.length : 0));
  const dv = new DataView(body.buffer);
  dv.setUint16(0, format, true); dv.setUint16(2, channels, true); dv.setUint32(4, rate, true);
  dv.setUint32(8, rate * blockAlign, true); dv.setUint16(12, blockAlign, true); dv.setUint16(14, bits, true);
  if (extra.length > 0) { dv.setUint16(16, extra.length, true); body.set(extra, 18); }
  return body;
}

const sine = (n: number, hz: number, rate: number, amp = 0.6) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate) * amp);
const rms = (a: Float32Array, b: Float32Array) => Math.sqrt(a.reduce((s, v, i) => s + (v - (b[i] ?? 0)) ** 2, 0) / a.length);

const IMA_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
const IMA_STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];

/** A textbook IMA ADPCM encoder (the same one every WAV tool uses), mono or stereo, block size in bytes. */
function encodeIma(channels: Float32Array[], rate: number, blockAlign: number): Uint8Array {
  const ch = channels.length;
  const perBlock = Math.floor((blockAlign - 4 * ch) * 8 / (4 * ch)) + 1;
  const frames = channels[0].length;
  const blocks = Math.ceil(frames / perBlock);
  const data = new Uint8Array(blocks * blockAlign);
  const dv = new DataView(data.buffer);
  const pred = new Int32Array(ch), index = new Int32Array(ch);
  const s16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  for (let b = 0; b < blocks; b++) {
    let at = b * blockAlign;
    const start = b * perBlock;
    for (let c = 0; c < ch; c++) {
      pred[c] = s16(channels[c][start] ?? 0);
      dv.setInt16(at, pred[c], true); data[at + 2] = index[c]; data[at + 3] = 0;
      at += 4;
    }
    for (let n = start + 1; n < start + perBlock; n += 8) {
      for (let c = 0; c < ch; c++) {
        for (let k = 0; k < 8; k++) {
          const sample = s16(channels[c][n + k] ?? 0);
          const step = IMA_STEP[index[c]];
          let diff = sample - pred[c];
          let nibble = 0;
          if (diff < 0) { nibble = 8; diff = -diff; }
          let d = step >> 3;
          if (diff >= step) { nibble |= 4; diff -= step; d += step; }
          if (diff >= step >> 1) { nibble |= 2; diff -= step >> 1; d += step >> 1; }
          if (diff >= step >> 2) { nibble |= 1; d += step >> 2; }
          pred[c] = Math.max(-32768, Math.min(32767, pred[c] + (nibble & 8 ? -d : d)));
          index[c] = Math.max(0, Math.min(88, index[c] + IMA_INDEX[nibble]));
          if (k % 2 === 0) data[at + (k >> 1)] = nibble; else data[at + (k >> 1)] |= nibble << 4;
        }
        at += 4;
      }
    }
  }
  const extra = new Uint8Array(2);
  new DataView(extra.buffer).setUint16(0, perBlock, true);
  return wavFile(fmtBody(WAV_FORMAT.imaAdpcm, ch, rate, 4, blockAlign, extra), data);
}

const MS_ADAPT = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];

/** A Microsoft ADPCM encoder on predictor 0 (coefficients 256, 0), mono. */
function encodeMs(samples: Float32Array, rate: number, blockAlign: number): Uint8Array {
  const perBlock = (blockAlign - 7) * 2 + 2;
  const blocks = Math.ceil(samples.length / perBlock);
  const data = new Uint8Array(blocks * blockAlign);
  const dv = new DataView(data.buffer);
  const s16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  for (let b = 0; b < blocks; b++) {
    const start = b * perBlock;
    let at = b * blockAlign;
    let s2 = s16(samples[start] ?? 0), s1 = s16(samples[start + 1] ?? 0), delta = 16;
    data[at++] = 0;
    dv.setInt16(at, delta, true); at += 2;
    dv.setInt16(at, s1, true); at += 2;
    dv.setInt16(at, s2, true); at += 2;
    let high = true;
    for (let n = start + 2; n < start + perBlock; n++) {
      const predicted = (s1 * 256) >> 8; // predictor 0: coefficients 256, 0
      const sample = s16(samples[n] ?? 0);
      let nib = Math.round((sample - predicted) / delta);
      nib = Math.max(-8, Math.min(7, nib));
      const decoded = Math.max(-32768, Math.min(32767, predicted + nib * delta));
      const code = nib & 0x0f;
      if (high) data[at] = code << 4; else data[at++] |= code;
      high = !high;
      s2 = s1; s1 = decoded;
      delta = Math.max(16, (MS_ADAPT[code] * delta) >> 8);
    }
  }
  const extra = new Uint8Array(4 + 7 * 4);
  const ev = new DataView(extra.buffer);
  ev.setUint16(0, perBlock, true); ev.setUint16(2, 7, true);
  [[256, 0], [512, -256], [0, 0], [192, 64], [240, 0], [460, -208], [392, -232]].forEach(([a, c], i) => { ev.setInt16(4 + i * 4, a, true); ev.setInt16(6 + i * 4, c, true); });
  return wavFile(fmtBody(WAV_FORMAT.msAdpcm, 1, rate, 4, blockAlign, extra), data);
}

function mulawByte(sample: number): number {
  const BIAS = 0x84, CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1) { /* find the segment */ }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** G.711's own linear → A-law (Sun's g711.c), on the 13-bit value. */
function alawByte(sample: number): number {
  let pcm = sample >> 3;
  let mask: number;
  if (pcm >= 0) mask = 0xd5; else { mask = 0x55; pcm = -pcm - 1; }
  const ends = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];
  let seg = 0;
  while (seg < 8 && pcm > ends[seg]) seg++;
  if (seg >= 8) return (0x7f ^ mask) & 0xff;
  let aval = seg << 4;
  aval |= seg < 2 ? (pcm >> 1) & 0x0f : (pcm >> seg) & 0x0f;
  return (aval ^ mask) & 0xff;
}

describe("wav decoders", () => {
  const rate = 22050;
  const tone = sine(2205, 440, rate);

  it("reads IMA ADPCM — mono, stereo, and a short last block — close to the original", () => {
    for (const [channels, block] of [[[tone], 1024], [[tone, sine(2205, 220, rate, 0.3)], 2048], [[tone], 256]] as [Float32Array[], number][]) {
      const bytes = encodeIma(channels, rate, block);
      const info = parseWavHeader(bytes)!;
      expect(canDecodeWav(info)).toBe(true);
      expect(wavFormatLabel(info)).toContain("IMA ADPCM");
      const out = decodeWav(bytes)!;
      expect(out.sampleRate).toBe(rate);
      expect(out.channels).toHaveLength(channels.length);
      // The encoder pads the last block; the frames counted off the header cover the tone and the padding only.
      expect(out.channels[0].length).toBeGreaterThanOrEqual(tone.length);
      expect(wavFrames(info)).toBe(out.channels[0].length);
      channels.forEach((c, i) => expect(rms(c, out.channels[i])).toBeLessThan(0.02));
      expect(Math.abs(wavDuration(info) - tone.length / rate)).toBeLessThan(0.1);
    }
  });

  it("reads Microsoft ADPCM close to the original", () => {
    const bytes = encodeMs(tone, rate, 512);
    const info = parseWavHeader(bytes)!;
    expect(canDecodeWav(info)).toBe(true);
    const out = decodeWav(bytes)!;
    expect(out.channels[0].length).toBeGreaterThanOrEqual(tone.length);
    expect(rms(tone, out.channels[0])).toBeLessThan(0.03);
  });

  it("reads µ-law, A-law, 24-bit, 32-bit and float PCM", () => {
    const n = tone.length;
    const s16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    const mu = wavFile(fmtBody(WAV_FORMAT.mulaw, 1, rate, 8, 1), Uint8Array.from(tone, (v) => mulawByte(s16(v))));
    expect(rms(tone, decodeWav(mu)!.channels[0])).toBeLessThan(0.02);
    const a = wavFile(fmtBody(WAV_FORMAT.alaw, 1, rate, 8, 1), Uint8Array.from(tone, (v) => alawByte(s16(v))));
    expect(rms(tone, decodeWav(a)!.channels[0])).toBeLessThan(0.02);

    const p24 = new Uint8Array(n * 3);
    tone.forEach((v, i) => { const s = Math.round(v * 8388607); p24[i * 3] = s & 0xff; p24[i * 3 + 1] = (s >> 8) & 0xff; p24[i * 3 + 2] = (s >> 16) & 0xff; });
    expect(rms(tone, decodeWav(wavFile(fmtBody(WAV_FORMAT.pcm, 1, rate, 24, 3), p24))!.channels[0])).toBeLessThan(1e-5);

    const p32 = new Uint8Array(n * 4);
    const v32 = new DataView(p32.buffer);
    tone.forEach((v, i) => v32.setInt32(i * 4, Math.round(v * 2147483647), true));
    expect(rms(tone, decodeWav(wavFile(fmtBody(WAV_FORMAT.pcm, 1, rate, 32, 4), p32))!.channels[0])).toBeLessThan(1e-6);

    const f32 = new Uint8Array(n * 4);
    const vf = new DataView(f32.buffer);
    tone.forEach((v, i) => vf.setFloat32(i * 4, v, true));
    const f = wavFile(fmtBody(WAV_FORMAT.float, 1, rate, 32, 4), f32);
    expect(isPlainPcm(parseWavHeader(f)!)).toBe(false);
    expect(rms(tone, decodeWav(f)!.channels[0])).toBeLessThan(1e-6);
    expect(wavDuration(parseWavHeader(f)!)).toBeCloseTo(n / rate, 5);
  });

  it("still answers null for what it does not know", () => {
    const bytes = encodeWav([tone], rate, 16);
    new DataView(bytes.buffer).setUint16(20, 0x55, true); // MPEG layer 3 in a WAV wrapper
    expect(canDecodeWav(parseWavHeader(bytes)!)).toBe(false);
    expect(decodeWav(bytes)).toBeNull();
    expect(decodeWav(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
