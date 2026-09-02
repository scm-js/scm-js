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
