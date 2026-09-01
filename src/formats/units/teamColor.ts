/**
 * Team colours. Unit GRPs paint their coloured parts with palette indices 8–15; the game
 * replaces those eight slots per player from `game\tunit.pcx`, a 128×1 image whose pixels
 * are palette indices: row `c` (bytes c*8 … c*8+7) is the ramp for colour `c`.
 * The ramp indexes the *tileset* palette, so a red marine is the same red on every map.
 */

export const TEAM_COLOR_ROWS = 16;
export const TEAM_SLOT_FIRST = 8;
export const TEAM_SLOT_COUNT = 8;

/** A 256-entry palette-index remap that swaps in colour row `row`. */
export function teamColorLut(teamColors: Uint8Array, row: number): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = i;
  const r = Math.min(TEAM_COLOR_ROWS - 1, Math.max(0, row | 0));
  for (let s = 0; s < TEAM_SLOT_COUNT; s++) lut[TEAM_SLOT_FIRST + s] = teamColors[r * TEAM_SLOT_COUNT + s];
  return lut;
}
