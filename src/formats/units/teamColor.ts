/**
 * Team colours. Unit GRPs paint their coloured parts with palette indices 8–15; the game
 * replaces those eight slots per player from `game\tunit.pcx`, a 128×1 image whose pixels
 * are palette indices: row `c` (bytes c*8 … c*8+7) is the ramp for colour `c`.
 * The ramp indexes the *tileset* palette, so a red marine is the same red on every map.
 *
 * The file only has sixteen rows. The editor's colour table goes further (Remastered's
 * Pink … Black, ids 16+) and a CRGB slot can be any RGB at all, so a colour with no row
 * gets a ramp *synthesised* from its RGB (`synthesizeRamp`): the table's average
 * bright-to-dark profile applied to the target, in true colour. The 8-bit tileset palettes
 * have no pink (or lime, or navy) to snap to, so the renderer draws such a ramp by
 * overriding palette slots 8–15 rather than through the index remap — an approximation of
 * what Remastered shows, but the swatches and the sprites agree.
 */

export const TEAM_COLOR_ROWS = 16;
export const TEAM_SLOT_FIRST = 8;
export const TEAM_SLOT_COUNT = 8;

export type Rgb = readonly [number, number, number];

/**
 * How to colour a player's units: a `tunit.pcx` row (0 … 15), or an RGB the renderer
 * builds a ramp for. `data/players.ts#playerTeamColor` turns COLR/CRGB into one of these.
 */
export type TeamColorSpec = { row: number } | { rgb: Rgb };

/** A short, stable cache key for a spec (`r3`, `c255,196,228`). */
export function teamColorKey(spec: TeamColorSpec): string {
  return "row" in spec ? `r${spec.row}` : `c${spec.rgb[0]},${spec.rgb[1]},${spec.rgb[2]}`;
}

/**
 * The game's shading profile for a team colour: each step's luminance as a fraction of
 * the brightest, averaged over the sixteen `tunit.pcx` rows through the Jungle palette
 * (red alone is steeper — 1, .74, .74, .56, .38, .28, .21, .06 — the pale colours gentler).
 */
export const SHADE_PROFILE: readonly number[] = [1, 0.9, 0.82, 0.73, 0.56, 0.45, 0.38, 0.22];

/** The eight palette indices of `tunit.pcx` row `row` (clamped into the table). */
export function tunitRamp(teamColors: Uint8Array, row: number): Uint8Array {
  const r = Math.min(TEAM_COLOR_ROWS - 1, Math.max(0, row | 0));
  return teamColors.slice(r * TEAM_SLOT_COUNT, r * TEAM_SLOT_COUNT + TEAM_SLOT_COUNT);
}

/** A 256-entry palette-index remap that swaps in the eight-index `ramp` from the table. */
export function teamColorLut(ramp: Uint8Array): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = i;
  for (let s = 0; s < TEAM_SLOT_COUNT; s++) lut[TEAM_SLOT_FIRST + s] = ramp[s] ?? TEAM_SLOT_FIRST + s;
  return lut;
}

/** Eight RGB triples (24 bytes, bright → dark) for a colour the table has no row for. */
export function synthesizeRamp(rgb: Rgb): Uint8Array {
  const out = new Uint8Array(TEAM_SLOT_COUNT * 3);
  for (let s = 0; s < TEAM_SLOT_COUNT; s++) {
    const f = SHADE_PROFILE[s];
    for (let c = 0; c < 3; c++) out[s * 3 + c] = Math.max(0, Math.min(255, Math.round(rgb[c] * f)));
  }
  return out;
}

/**
 * A copy of `palette` (256 RGBA entries) with slots 8–15 replaced by the synthesised
 * ramp for `rgb` — what a GRP draws through, with no index remap, to come out in a colour
 * the palette itself does not have.
 */
export function teamColorPalette(palette: Uint8Array, rgb: Rgb): Uint8Array {
  const out = palette.slice();
  const ramp = synthesizeRamp(rgb);
  for (let s = 0; s < TEAM_SLOT_COUNT; s++) {
    const at = (TEAM_SLOT_FIRST + s) * 4;
    out[at] = ramp[s * 3];
    out[at + 1] = ramp[s * 3 + 1];
    out[at + 2] = ramp[s * 3 + 2];
    out[at + 3] = 255;
  }
  return out;
}
