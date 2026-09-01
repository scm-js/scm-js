/**
 * WAV: the sound table — 512 string indices, each the archive path of a sound file
 * (`staredit\wav\name.wav`), 0 for an empty slot. Play WAV / Transmission actions store
 * the *string index* itself, not the slot, so the table is only StarEdit's bookkeeping of
 * which sounds the map has; the files live beside scenario.chk in the MPQ.
 */
import { Reader, Writer } from "../binary";

export const WAV_SLOTS = 512;
export const WAV_SIZE = WAV_SLOTS * 4;

export function decodeWavs(data: Uint8Array): number[] {
  const r = new Reader(data);
  const out: number[] = [];
  for (let i = 0; i < WAV_SLOTS; i++) out.push(r.remaining >= 4 ? r.u32() : 0);
  return out;
}

export function encodeWavs(wavs: number[]): Uint8Array {
  const w = new Writer(WAV_SIZE);
  for (let i = 0; i < WAV_SLOTS; i++) w.u32(wavs[i] ?? 0);
  return w.finish();
}

/** An empty table. */
export function defaultWavs(): number[] {
  return Array.from({ length: WAV_SLOTS }, () => 0);
}
