/**
 * Import conversion for the Sound Editor: any file the browser can decode (MP3, Ogg Vorbis /
 * Opus, FLAC, AAC / M4A, WebM, WAV in any of its encodings) becomes a plain PCM WAV the game
 * plays. Decoding is Web Audio's `decodeAudioData`; resampling and the mono downmix are an
 * `OfflineAudioContext` render, so the quality is the browser's resampler, not a hand-rolled
 * one; the WAV writer is `formats/wav.ts`. No library is involved — the platform decoders
 * cover every format worth accepting, and a WASM decoder bundle would be several megabytes
 * for the same result.
 */
import { encodeWav, isPlainPcm, parseWavHeader, type WavBits, type WavInfo } from "../formats/wav";

export interface WavTarget {
  sampleRate: number;
  channels: 1 | 2;
  bits: WavBits;
}

export interface WavPreset {
  id: string;
  label: string;
  target: WavTarget;
}

/**
 * What the game's own sounds are (22050 Hz, 16-bit, mono) first; the rest are the other
 * rates StarCraft's mixer takes. 8-bit is for maps chasing the file-size limit.
 */
export const WAV_PRESETS: readonly WavPreset[] = [
  { id: "22k16m", label: "22050 Hz · 16-bit · mono (game standard)", target: { sampleRate: 22050, channels: 1, bits: 16 } },
  { id: "22k16s", label: "22050 Hz · 16-bit · stereo", target: { sampleRate: 22050, channels: 2, bits: 16 } },
  { id: "44k16m", label: "44100 Hz · 16-bit · mono", target: { sampleRate: 44100, channels: 1, bits: 16 } },
  { id: "44k16s", label: "44100 Hz · 16-bit · stereo", target: { sampleRate: 44100, channels: 2, bits: 16 } },
  { id: "11k8m", label: "11025 Hz · 8-bit · mono (smallest)", target: { sampleRate: 11025, channels: 1, bits: 8 } },
];

export const DEFAULT_WAV_PRESET = WAV_PRESETS[0];

/** File extensions the import dialog offers; anything else still goes through the decoder. */
export const IMPORT_EXTENSIONS = [".wav", ".ogg", ".oga", ".opus", ".mp3", ".flac", ".m4a", ".aac", ".webm", ".weba"];

export function matchesTarget(info: WavInfo, target: WavTarget): boolean {
  return isPlainPcm(info) && info.sampleRate === target.sampleRate && info.channels === target.channels && info.bitsPerSample === target.bits;
}

/** Decodes with a throw-away offline context, which needs no user gesture and no output device. */
export async function decodeAudio(bytes: Uint8Array): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
}

/** Resamples and down- or up-mixes `buffer` to the target through an offline render. */
export async function renderTo(buffer: AudioBuffer, target: WavTarget): Promise<Float32Array[]> {
  const frames = Math.max(1, Math.ceil(buffer.duration * target.sampleRate));
  const ctx = new OfflineAudioContext(target.channels, frames, target.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  const out = await ctx.startRendering();
  return Array.from({ length: target.channels }, (_, c) => out.getChannelData(c));
}

export interface ConvertResult {
  bytes: Uint8Array;
  /** False when the input was already a PCM WAV in the target format and was kept byte for byte. */
  converted: boolean;
  seconds: number;
}

/** `bytes` as a PCM WAV in `target`; a file already in that format is returned unchanged. */
export async function convertToWav(bytes: Uint8Array, target: WavTarget): Promise<ConvertResult> {
  const info = parseWavHeader(bytes);
  if (info && matchesTarget(info, target)) return { bytes, converted: false, seconds: info.dataLength / (info.channels * (info.bitsPerSample / 8)) / info.sampleRate };
  const buffer = await decodeAudio(bytes);
  const channels = await renderTo(buffer, target);
  return { bytes: encodeWav(channels, target.sampleRate, target.bits), converted: true, seconds: buffer.duration };
}

/** `name.mp3` → `name.wav`; a name without an extension gets one. */
export function withWavExtension(name: string): string {
  return name.replace(/\.[^./\\]*$/, "") + ".wav";
}
