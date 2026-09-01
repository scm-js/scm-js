/**
 * `.lo?` overlay position files (`unit\terran\control.lof`, `neutral\geyser.los`, …):
 * where an image's overlays attach, per frame of the main graphic.
 *
 *   u32 frames, u32 overlays per frame, u32 offset[frames], then per frame
 *   `overlays` × (s8 x, s8 y). A slot of (127, 127) is unused.
 *
 * images.dat names one file per overlay kind (attack, damage, special, landing dust,
 * lift-off, shield); the editor uses the damage file for burning buildings and the
 * special file for geyser and refinery smoke.
 */

export interface LoFile {
  frames: number;
  overlays: number;
  /** `frames × overlays × 2` signed offsets, row-major. */
  offsets: Int8Array;
}

export const LO_UNUSED = 127;

export function decodeLo(data: Uint8Array): LoFile {
  if (data.length < 8) throw new Error(`.lo file too short (${data.length} bytes)`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const frames = view.getUint32(0, true);
  const overlays = view.getUint32(4, true);
  if (frames > 4096 || overlays > 64) throw new Error(`.lo file declares ${frames} frames × ${overlays} overlays`);
  const offsets = new Int8Array(frames * overlays * 2);
  for (let f = 0; f < frames; f++) {
    const at = view.getUint32(8 + f * 4, true);
    for (let i = 0; i < overlays * 2; i++) {
      const b = data[at + i];
      offsets[f * overlays * 2 + i] = b === undefined ? LO_UNUSED : b > 127 ? b - 256 : b;
    }
  }
  return { frames, overlays, offsets };
}

/** Offset of overlay slot `index` in `frame`, or null when the slot is unused. Frames past the end reuse the last one. */
export function loOffset(lo: LoFile, frame: number, index: number): { x: number; y: number } | null {
  if (lo.frames === 0 || index < 0 || index >= lo.overlays) return null;
  const f = Math.min(Math.max(0, frame), lo.frames - 1);
  const at = (f * lo.overlays + index) * 2;
  const x = lo.offsets[at], y = lo.offsets[at + 1];
  if (x === LO_UNUSED && y === LO_UNUSED) return null;
  return { x, y };
}

/** The slot indices of `frame` that are in use — not necessarily contiguous (the Missile Turret only fills slot 1). */
export function loUsedSlots(lo: LoFile, frame: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < lo.overlays; i++) if (loOffset(lo, frame, i)) out.push(i);
  return out;
}

/** How many slots of `frame` are in use. */
export function loSlotCount(lo: LoFile, frame: number): number {
  return loUsedSlots(lo, frame).length;
}
