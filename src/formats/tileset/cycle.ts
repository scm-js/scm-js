/**
 * Palette colour cycling — how StarCraft animates water and lava.
 *
 * Tileset graphics are 8-bit indexed. The game never swaps tiles to animate water:
 * instead a few short bands of the WPE palette are rotated one entry to the right every
 * few ticks, and every pixel that references one of those indices moves with them. Which
 * bands rotate depends on the tileset; Platform and Installation have none.
 *
 * Band tables are from Chkdraft's `color_cycler.h` (jjf28/Chkdraft), which mirrors the
 * game's own rotator structs: each rotator counts down 8 ticks between rotations.
 *
 * Timing: Chkdraft ticks those counters on a ~15.6 ms wall clock, which runs visibly
 * faster than the game. In StarCraft the water slows down with the game-speed setting,
 * so the counter is stepped per game frame; this uses the "Fastest" frame (42 ms).
 */

import type { Tileset } from "./decode";

/** One rotating run of palette entries, `min..max` inclusive. */
export interface PaletteBand {
  min: number;
  max: number;
}

const BADLANDS_JUNGLE: readonly PaletteBand[] = [{ min: 1, max: 6 }, { min: 7, max: 13 }, { min: 248, max: 254 }];
const ASHWORLD: readonly PaletteBand[] = [{ min: 1, max: 4 }, { min: 5, max: 8 }, { min: 9, max: 13 }];
const DESERT_ICE_TWILIGHT: readonly PaletteBand[] = [{ min: 1, max: 13 }, { min: 248, max: 254 }];
const NONE: readonly PaletteBand[] = [];

/** Cycling bands per tileset, in ERA order (badlands, platform, install, ashworld, jungle, desert, ice, twilight). */
export const CYCLE_BANDS: readonly (readonly PaletteBand[])[] = [
  BADLANDS_JUNGLE,
  NONE,
  NONE,
  ASHWORLD,
  BADLANDS_JUNGLE,
  DESERT_ICE_TWILIGHT,
  DESERT_ICE_TWILIGHT,
  DESERT_ICE_TWILIGHT,
];

/** One game frame on the "Fastest" speed setting. */
export const GAME_FRAME_MS = 42;
/** Game frames between two rotations of every band (the rotators' countdown). */
export const CYCLE_FRAMES = 8;
/** Wall-clock time between two rotations of every band. */
export const CYCLE_STEP_MS = CYCLE_FRAMES * GAME_FRAME_MS;

export function cycleBands(tilesetIndex: number): readonly PaletteBand[] {
  return CYCLE_BANDS[tilesetIndex] ?? NONE;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Rotations until every band is back where it started (1 when nothing cycles). */
export function cycleLength(bands: readonly PaletteBand[]): number {
  let length = 1;
  for (const { min, max } of bands) {
    const n = max - min + 1;
    length = (length * n) / gcd(length, n);
  }
  return length;
}

/** Which rotation the wall clock is on right now. */
export function cycleStepAt(nowMs: number, length: number): number {
  return Math.floor(nowMs / CYCLE_STEP_MS) % length;
}

/**
 * The palette after `step` rotations: every band has moved `step` entries to the right,
 * wrapping within itself. Entries outside the bands are copied through unchanged.
 */
export function cyclePalette(
  base: Uint8Array,
  bands: readonly PaletteBand[],
  step: number,
  out: Uint8Array = new Uint8Array(base.length),
): Uint8Array {
  if (out !== base) out.set(base);
  for (const { min, max } of bands) {
    const n = max - min + 1;
    const shift = ((step % n) + n) % n;
    if (shift === 0) continue;
    for (let i = 0; i < n; i++) {
      const from = (min + i) * 4;
      const to = (min + ((i + shift) % n)) * 4;
      out[to] = base[from];
      out[to + 1] = base[from + 1];
      out[to + 2] = base[from + 2];
      out[to + 3] = base[from + 3];
    }
  }
  return out;
}

/** Megatile indices (ascending) that reference at least one cycling palette entry. */
export function cyclingMegatiles(tileset: Tileset, bands: readonly PaletteBand[]): Uint32Array {
  if (bands.length === 0) return new Uint32Array(0);

  const cycling = new Uint8Array(256);
  for (const { min, max } of bands) cycling.fill(1, min, max + 1);

  // Minitiles are shared between megatiles, so classify each one once.
  const { minitiles, megatileRefs, megatileCount } = tileset;
  const minitileCount = Math.floor(minitiles.length / 64);
  const minitileCycles = new Uint8Array(minitileCount);
  for (let m = 0; m < minitileCount; m++) {
    const at = m * 64;
    for (let p = 0; p < 64; p++) {
      if (cycling[minitiles[at + p]]) { minitileCycles[m] = 1; break; }
    }
  }

  const out: number[] = [];
  for (let mt = 0; mt < megatileCount; mt++) {
    const base = mt * 16;
    for (let s = 0; s < 16; s++) {
      if (minitileCycles[megatileRefs[base + s] >>> 1]) { out.push(mt); break; }
    }
  }
  return Uint32Array.from(out);
}
