import { DrawFunction, NO_UNIT, RANDOM_DIRECTION } from "../dat/dat";
import { drawGrpFrame, facingFrame } from "../dat/grp";
import { imageGrpPath, requestGrp, requestRemap, unitImageId, type UnitAssets } from "./load";
import { teamColorKey, teamColorLut, teamColorPalette, tunitRamp, type TeamColorSpec } from "./teamColor";

/**
 * One frame of one image rendered for one team colour and palette, as a canvas the size
 * of the GRP's full box (so it is drawn centred on the image's position).
 */
export interface ImageFrame {
  image: HTMLCanvasElement;
  width: number;
  height: number;
  /** Fire and other remapped effects brighten what is under them rather than covering it. */
  additive: boolean;
}

/** Kept for callers that only need the unit's default picture. */
export type UnitSprite = ImageFrame;

const cache = new Map<string, ImageFrame>();
const luts = new Map<string, Uint8Array>();
const teamPalettes = new Map<string, Uint8Array>();
const remapPalettes = new Map<string, Uint8Array>();

/**
 * The frame the editor shows: the unit's default facing for directional GRPs (a random
 * facing is shown as "up", frame 0, which is also what buildings and doodads use).
 */
export function editorFrame(assets: UnitAssets, unitId: number, imageId: number): { frame: number; flip: boolean } {
  if (!assets.images.graphicTurns[imageId]) return { frame: 0, flip: false };
  const direction = assets.units.direction[unitId];
  return facingFrame(direction === RANDOM_DIRECTION ? 0 : direction);
}

/**
 * How a team colour is applied: a `tunit.pcx` row is an index remap (`lut`) and the same
 * on every tileset; an RGB with no row is drawn through a copy of the tileset palette
 * with slots 8–15 overridden (`palette`), cached per tileset.
 */
function teamPaint(assets: UnitAssets, palette: Uint8Array, paletteKey: string, spec: TeamColorSpec): { lut: Uint8Array | null; palette: Uint8Array } {
  if ("row" in spec) {
    const key = teamColorKey(spec);
    let lut = luts.get(key);
    if (!lut) {
      lut = teamColorLut(tunitRamp(assets.teamColors, spec.row));
      luts.set(key, lut);
    }
    return { lut, palette };
  }
  const key = `${paletteKey}:${teamColorKey(spec)}`;
  let p = teamPalettes.get(key);
  if (!p) {
    p = teamColorPalette(palette, spec.rgb);
    teamPalettes.set(key, p);
  }
  return { lut: null, palette: p };
}

/**
 * The palette a remapped image draws through. The game looks the effect's pixel up in a
 * 256-column table against the pixel already on screen; the editor composites in RGB, so
 * it takes the "over black" column and blends additively, which reads the same for fire.
 * Without the table (an older tileset extraction) a synthetic ramp stands in.
 */
function remapPalette(palette: Uint8Array, paletteKey: string, remapping: number, table: Uint8Array | null): Uint8Array {
  const key = `${paletteKey}:${remapping}:${table ? "t" : "f"}`;
  const hit = remapPalettes.get(key);
  if (hit) return hit;
  const out = new Uint8Array(1024);
  const rows = table ? Math.floor(table.length / 256) : 0;
  for (let i = 0; i < 256; i++) {
    if (table && i < rows) {
      const c = table[i * 256];
      out.set(palette.subarray(c * 4, c * 4 + 4), i * 4);
    } else if (!table && i > 0 && i < 64) {
      // A plausible ramp: dark → bright with the index, warm for fire, cool for the blue tables.
      const t = i / 63;
      const blue = remapping === 4;
      out[i * 4] = Math.round(255 * (blue ? t * t : Math.min(1, t * 1.6)));
      out[i * 4 + 1] = Math.round(255 * (blue ? Math.min(1, t * 1.3) : t * t));
      out[i * 4 + 2] = Math.round(255 * (blue ? Math.min(1, 0.4 + t) : Math.max(0, t - 0.7) * 3));
      out[i * 4 + 3] = 255;
    } else {
      out.set(palette.subarray(i * 4, i * 4 + 4), i * 4);
    }
  }
  remapPalettes.set(key, out);
  return out;
}

/**
 * Frame `frame` of image `imageId` in team colour `team`, drawn through `palette`
 * (256 RGBA entries — the current tileset's, keyed by `paletteKey`, which is also the
 * tileset name the remap tables are fetched for). Returns null while anything it needs is
 * still loading, or when the image has no drawable graphic; `onGrpLoaded` fires when it is
 * worth asking again.
 */
export function getImageFrame(assets: UnitAssets, imageId: number, frame: number, flip: boolean, team: TeamColorSpec, palette: Uint8Array, paletteKey: string): ImageFrame | null {
  const drawFunction = assets.images.drawFunction[imageId];
  if (drawFunction === DrawFunction.HpBar || drawFunction === DrawFunction.SelectionCircle) return null;
  const shadow = drawFunction === DrawFunction.Shadow;
  const remapping = drawFunction === DrawFunction.Remap ? assets.images.remapping[imageId] : 0;
  // Shadows and remapped effects (fire, sparks) carry no team colour: the fire GRPs use
  // source values 1–47, which include the team slots 8–15, and the remap table must see
  // them untouched. One cache entry serves every player.
  const teamColored = !shadow && !remapping;
  const key = `${imageId}:${frame}:${flip ? 1 : 0}:${teamColored ? teamColorKey(team) : "-"}:${paletteKey}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const path = imageGrpPath(assets, imageId);
  if (!path) return null;
  const grp = requestGrp(path);
  if (!grp || grp.frames.length === 0) return null;

  let drawPalette = palette;
  let lut: Uint8Array | null = null;
  if (teamColored) ({ lut, palette: drawPalette } = teamPaint(assets, palette, paletteKey, team));
  if (remapping) {
    const table = requestRemap(paletteKey, remapping);
    if (table === undefined) return null; // still loading; a ramp would flash for a frame
    drawPalette = remapPalette(palette, paletteKey, remapping, table);
  }

  const width = Math.max(1, grp.width);
  const height = Math.max(1, grp.height);
  const pixels = new ImageData(width, height);
  drawGrpFrame(grp, Math.min(frame, grp.frames.length - 1), pixels.data, width, 0, 0, drawPalette, lut, flip);
  if (shadow) {
    // The game darkens what is under the silhouette; a half-transparent black does the same.
    const d = pixels.data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i]) { d[i - 3] = 0; d[i - 2] = 0; d[i - 1] = 0; d[i] = 128; }
    }
  }
  const image = document.createElement("canvas");
  image.width = width;
  image.height = height;
  image.getContext("2d")!.putImageData(pixels, 0, 0);
  const out: ImageFrame = { image, width, height, additive: remapping > 0 };
  cache.set(key, out);
  return out;
}

/** The unit type's main graphic in its editor pose — what previews and the placement ghost show. */
export function getUnitSprite(assets: UnitAssets, unitId: number, team: TeamColorSpec, palette: Uint8Array, paletteKey: string): UnitSprite | null {
  if (unitId < 0 || unitId >= NO_UNIT) return null;
  const imageId = unitImageId(assets, unitId);
  const { frame, flip } = editorFrame(assets, unitId, imageId);
  return getImageFrame(assets, imageId, frame, flip, team, palette, paletteKey);
}

/** The turret (or other subunit) drawn on top of a unit, or NO_UNIT. */
export function subunitOf(assets: UnitAssets, unitId: number): number {
  return assets.units.subunit[unitId] ?? NO_UNIT;
}
