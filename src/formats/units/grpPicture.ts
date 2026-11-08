/**
 * A GRP's frame painted the way the editor paints a unit's: through a tileset's palette
 * (`<tileset>.wpe`, four bytes an entry), with the team colour slots (indices 8–15) swapped
 * for a player's ramp from `game\tunit.pcx`, or a ramp made from a colour; index 0 is
 * transparent; a shadow is a half-transparent black silhouette. What `api.graphics.grpImage`
 * draws a plugin's own GRP bytes with. Either encoding of the file (run-length, or the
 * interface pictures' uncompressed frames: `grpFile.ts#decodeGrpImage`).
 *
 * Pure: RGBA bytes out, no canvas, so it runs anywhere.
 */
import type { GrpImage } from "../dat/grpFile";
import { teamColorLut, teamColorPalette, tunitRamp, type TeamColorSpec } from "./teamColor";

export interface GrpPaint {
  /** The tileset's palette, 256 entries of four bytes (r, g, b, unused). */
  palette: Uint8Array;
  /** The team colour, or null to leave slots 8–15 the palette's own. */
  team: TeamColorSpec | null;
  /** `tunit.pcx`'s rows, for a `{ row }` team colour; without them such a colour is not applied. */
  teamColors: Uint8Array | null;
  flip?: boolean;
  shadow?: boolean;
}

/** The frame as RGBA, the size of the GRP's whole box; null for a frame the GRP has not got. */
export function paintGrpFrame(grp: GrpImage, frame: number, paint: GrpPaint): { width: number; height: number; data: Uint8ClampedArray } | null {
  const f = grp.frames[frame];
  if (!f || !Number.isInteger(frame)) return null;
  const width = Math.max(1, grp.width);
  const height = Math.max(1, grp.height);
  let palette = paint.palette;
  let lut: Uint8Array | null = null;
  if (paint.team && !paint.shadow) {
    if ("row" in paint.team) { if (paint.teamColors) lut = teamColorLut(tunitRamp(paint.teamColors, paint.team.row)); }
    else palette = teamColorPalette(palette, paint.team.rgb);
  }
  const data = new Uint8ClampedArray(width * height * 4);
  const left = paint.flip ? grp.width - f.x - f.width : f.x;
  for (let row = 0; row < f.height; row++) {
    const py = f.y + row;
    if (py < 0 || py >= height) continue;
    for (let col = 0; col < f.width; col++) {
      const index = f.pixels[row * f.width + col];
      const c = lut ? lut[index] : index;
      if (c === 0) continue;
      const px = left + (paint.flip ? f.width - 1 - col : col);
      if (px < 0 || px >= width) continue;
      const at = (py * width + px) * 4;
      if (paint.shadow) { data[at + 3] = 128; continue; }
      data[at] = palette[c * 4];
      data[at + 1] = palette[c * 4 + 1];
      data[at + 2] = palette[c * 4 + 2];
      data[at + 3] = 255;
    }
  }
  return { width, height, data };
}
