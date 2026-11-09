/**
 * The marker for a tile the data set in use has not got (`data/remasteredTiles.ts`): a dark
 * plate with thin amber diagonals, drawn where the tile's picture would be. Without it such
 * a tile came out black, or — its twelve-bit group read with eleven — as some other tile,
 * which looks like a broken map or like terrain that is not the map's.
 *
 * One look everywhere the map's ground is drawn: the viewport and the image export fill
 * with `missingTilePattern`, the minimap asks `missingTileRgb` a pixel at a time. The
 * hatch is laid in screen pixels from the map's corner, not per tile, so a run of missing
 * tiles reads as one hatched area at any zoom, and a tile a scroll uncovers continues its
 * neighbours' lines.
 *
 * The colours are the design tokens' (`styles/tokens.css`): `--bg-2` for the plate and
 * `--warn`, the colour of the notice that speaks of these tiles, for the lines — at part
 * strength in the map, where a thousand such tiles should not shout, and at full strength
 * in the minimap, where a few pixels have to be told from terrain.
 */

const PLATE = [0x19, 0x1d, 0x25] as const; // --bg-2
const WARN = [0xe0, 0xa5, 0x45] as const; // --warn
/** The lines' strength over the plate in the map. */
const STRENGTH = 0.6;
/** Screen pixels from one line to the next, and a line's width. */
const PERIOD = 8;
const WIDTH = 1.5;
/** The minimap's: its picture is 256 pixels a side and shown smaller still, so the lines are half the hatch. */
const MINI_PERIOD = 4;
const MINI_WIDTH = 2;

const mix = (k: number) => PLATE.map((p, i) => Math.round(p + (WARN[i] - p) * k));
const LINE = mix(STRENGTH);

/** Whether the pixel (`x`, `y`) from the map's corner is on a line of a hatch of `period` and `width` pixels. */
export function onMissingLine(x: number, y: number, period: number, width: number): boolean {
  return (((x - y) % period) + period) % period < width;
}

/** The minimap's marker at one of its pixels, packed 0xRRGGBB. */
export function missingTileRgb(px: number, py: number): number {
  const [r, g, b] = onMissingLine(px, py, MINI_PERIOD, MINI_WIDTH) ? WARN : PLATE;
  return (r << 16) | (g << 8) | b;
}

const stamps = new Map<number, HTMLCanvasElement>();

/** One period of the hatch at `scale` device pixels a screen pixel: a square that tiles without a seam. */
function stamp(scale: number): HTMLCanvasElement {
  const period = Math.max(4, Math.round(PERIOD * scale));
  const width = Math.max(1, Math.round(WIDTH * scale));
  let canvas = stamps.get(period * 64 + width);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = canvas.height = period;
    const c = canvas.getContext("2d")!;
    const img = c.createImageData(period, period);
    for (let y = 0; y < period; y++) {
      for (let x = 0; x < period; x++) {
        const [r, g, b] = onMissingLine(x, y, period, width) ? LINE : PLATE;
        const at = (y * period + x) * 4;
        img.data[at] = r; img.data[at + 1] = g; img.data[at + 2] = b; img.data[at + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    stamps.set(period * 64 + width, canvas);
  }
  return canvas;
}

/**
 * The marker as a fill for `ctx`, at `scale` device pixels a screen pixel, laid from the
 * point (`originX`, `originY`) of the context's own space — where the map's corner is.
 * The plate's plain colour where the context makes no patterns.
 */
export function missingTilePattern(ctx: CanvasRenderingContext2D, scale: number, originX = 0, originY = 0): CanvasPattern | string {
  const pattern = ctx.createPattern(stamp(scale), "repeat");
  if (!pattern) return `rgb(${PLATE.join(",")})`;
  if (originX !== 0 || originY !== 0) pattern.setTransform(new DOMMatrix([1, 0, 0, 1, originX, originY]));
  return pattern;
}
