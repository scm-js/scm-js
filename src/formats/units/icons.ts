/**
 * The command card's icons (`unit\cmdbtns\cmdicons.grp`): which frame pictures what, and
 * that frame painted as the game paints a button.
 *
 * A unit type's icon is the frame of its units.dat id; an upgrade's or a technology's is
 * the frame its dat file's `icon` column names. The sheet's pixels are 0–15, and
 * `ticon.pcx` turns them into palette colours: six looks of 16 entries side by side, of
 * which the first three are the ones the game shows (ready, unavailable, pressed).
 */
import { drawGrpFrame, type Grp } from "../dat/grp";
import type { TechdataDat, UpgradesDat } from "../dat/dat";

export type IconKind = "unit" | "upgrade" | "tech";
export type IconLook = "normal" | "disabled" | "selected";

/** Unit types with an icon of their own: the 228 of units.dat. */
const UNIT_ICONS = 228;
const LOOKS: Record<IconLook, number> = { normal: 0, disabled: 1, selected: 2 };

/**
 * The frame that pictures `id`, or -1 for none. The game's sheet keeps a place for every
 * unit type, and the ones no button ever shows (turrets, unused heroes, the start location)
 * hold the word BLANK — a 30 × 14 picture at the box's corner, which no real icon is.
 */
export function iconFrame(grp: Grp, kind: IconKind, id: number, tables: { upgrades: UpgradesDat | null; techs: TechdataDat | null }): number {
  let frame = -1;
  if (kind === "unit") frame = id >= 0 && id < UNIT_ICONS ? id : -1;
  else if (kind === "upgrade") frame = tables.upgrades?.icon[id] ?? -1;
  else frame = tables.techs?.icon[id] ?? -1;
  const f = grp.frames[frame];
  if (!f || isBlank(grp, frame)) return -1;
  // An upgrade or technology the game does not use is left at frame 0, the Marine's.
  if (kind !== "unit" && frame === 0) return -1;
  return frame;
}

/** Whether a frame is the sheet's BLANK placeholder. */
export function isBlank(grp: Grp, frame: number): boolean {
  const f = grp.frames[frame];
  return !f || (f.x === 0 && f.y === 0 && f.width === 30 && f.height === 14);
}

/** One icon as RGBA pixels the size of the sheet's box, transparent where the game draws nothing. */
export function paintIcon(grp: Grp, frame: number, colours: Uint8Array, palette: Uint8Array, look: IconLook = "normal"): { pixels: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const lut = new Uint8Array(256);
  const base = LOOKS[look] * 16;
  for (let i = 0; i < 16; i++) lut[i] = colours[base + i] ?? 0;
  const pixels = new Uint8ClampedArray(grp.width * grp.height * 4);
  drawGrpFrame(grp, frame, pixels, grp.width, 0, 0, palette, lut);
  return { pixels, width: grp.width, height: grp.height };
}
