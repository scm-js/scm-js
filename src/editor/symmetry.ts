/**
 * Symmetry for the brushes: every cell a stroke touches is mirrored across the map's
 * axes (or rotated about its centre) before the brush runs, so the Rect, Tile and Fog
 * brushes lay the same thing down on both sides at once. The mirroring works on *sets
 * of cells*, not on strokes — `stampTerrain` then derives left/right pairs from column
 * parity as usual, so a mirrored Rect footprint still comes out as valid pairs whatever
 * the map's width. Objects go through the continuous versions (`mirrorPixel`,
 * `mirrorBox`, `mirrorTileRect`): a unit's centre, a location's box, a doodad's
 * footprint. The isometric brush mirrors the *point* it paints at (the diamond under each
 * image), so a cliff drawn on one side is drawn on the other by the same brush; only Blend
 * stays out, since it places from a picked anchor rather than a point.
 *
 * Each image is an element of the mode's group (`symmetryImages`), which is what gives a
 * placed copy its own player (`mirroredOwner`). Selecting, moving and deleting work by
 * matching: a click selects what stands at the images too (`withMirrorImages`), and a
 * drag moves each selected thing by the movement its image turns it into (`mirrorMoves`),
 * so Delete needs nothing of its own.
 */
import type { Rect } from "./terrain";
import { msg, translate } from "../i18n";

export type SymmetryMode = "none" | "h" | "v" | "hv" | "rot180" | "rot90" | "diag" | "adiag";

export interface SymmetryModeInfo {
  id: SymmetryMode;
  label: string;
  /** The toolbar's name for it, where room is short. */
  short: string;
  hint: string;
  /** Only meaningful when the map is square. */
  square?: boolean;
}

export const SYMMETRY_MODES: readonly SymmetryModeInfo[] = [
  { id: "none", label: msg("None"), short: msg("Off"), hint: msg("Brushes paint where you point them") },
  { id: "h", label: msg("Mirror horizontally"), short: msg("Left ↔ right"), hint: msg("Left ↔ right across the vertical centre line") },
  { id: "v", label: msg("Mirror vertically"), short: msg("Top ↔ bottom"), hint: msg("Top ↔ bottom across the horizontal centre line") },
  { id: "hv", label: msg("Mirror both axes (4-way)"), short: msg("Four-way mirror"), hint: msg("Every stroke lands in all four quadrants") },
  { id: "rot180", label: msg("Rotational 180°"), short: msg("Turn 180°"), hint: msg("Point-mirrored through the map centre (2-player maps)") },
  { id: "rot90", label: msg("Rotational 90° (4-way)"), short: msg("Turn 90°"), hint: msg("Repeated at each quarter turn about the centre"), square: true },
  { id: "diag", label: msg("Diagonal"), short: msg("Diagonal"), hint: msg("Mirrored across the top-left ↔ bottom-right diagonal"), square: true },
  { id: "adiag", label: msg("Anti-diagonal"), short: msg("Anti-diagonal"), hint: msg("Mirrored across the top-right ↔ bottom-left diagonal"), square: true },
];

export const requiresSquare = (mode: SymmetryMode) => SYMMETRY_MODES.find((m) => m.id === mode)?.square === true;

/** Whether the mode can run on a map of these dimensions. */
export function symmetryAvailable(mode: SymmetryMode, width: number, height: number): boolean {
  return !requiresSquare(mode) || width === height;
}

export function symmetryLabel(mode: SymmetryMode): string {
  return translate(SYMMETRY_MODES.find((m) => m.id === mode)?.label ?? mode);
}

export interface Point { x: number; y: number }

/**
 * The tile (x, y) and its images under `mode`, the original first, duplicates (a cell on
 * an axis, the centre of a rotation) dropped. Modes that need a square map fall back to
 * the original alone on a map that is not.
 */
export function mirrorPoints(mode: SymmetryMode, x: number, y: number, width: number, height: number): Point[] {
  const mx = width - 1 - x, my = height - 1 - y;
  let images: Point[];
  switch (mode) {
    case "h": images = [{ x: mx, y }]; break;
    case "v": images = [{ x, y: my }]; break;
    case "hv": images = [{ x: mx, y }, { x, y: my }, { x: mx, y: my }]; break;
    case "rot180": images = [{ x: mx, y: my }]; break;
    case "rot90": images = width === height ? [{ x: width - 1 - y, y: x }, { x: mx, y: my }, { x: y, y: height - 1 - x }] : []; break;
    case "diag": images = width === height ? [{ x: y, y: x }] : []; break;
    case "adiag": images = width === height ? [{ x: height - 1 - y, y: width - 1 - x }] : []; break;
    default: images = [];
  }
  const out: Point[] = [{ x, y }];
  for (const p of images) if (!out.some((q) => q.x === p.x && q.y === p.y)) out.push(p);
  return out;
}

/**
 * One image of a mode, as a map from a point to its image over a continuous plane `w` by
 * `h` (pixels or tiles, whichever the caller measures in), with the same map's linear part
 * — how a movement turns — and which element of the mode's group it is. The elements are
 * numbered so that `mirroredOwner` can hand each image a player consistently: for the
 * reflections 1 is the one flip (and in "hv" 2 is the other, 3 both), for the quarter turn
 * 1, 2 and 3 are the turns clockwise.
 */
export interface SymmetryImage {
  element: number;
  map(x: number, y: number): Point;
  linear(dx: number, dy: number): Point;
}

/** The images of `mode` other than the identity; modes that turn the plane need it square and answer nothing otherwise. */
export function symmetryImages(mode: SymmetryMode, w: number, h: number): SymmetryImage[] {
  const flipX = (element: number): SymmetryImage => ({ element, map: (x, y) => ({ x: w - x, y }), linear: (dx, dy) => ({ x: -dx, y: dy }) });
  const flipY = (element: number): SymmetryImage => ({ element, map: (x, y) => ({ x, y: h - y }), linear: (dx, dy) => ({ x: dx, y: -dy }) });
  const turn = (element: number): SymmetryImage => ({ element, map: (x, y) => ({ x: w - x, y: h - y }), linear: (dx, dy) => ({ x: -dx, y: -dy }) });
  switch (mode) {
    case "h": return [flipX(1)];
    case "v": return [flipY(1)];
    case "hv": return [flipX(1), flipY(2), turn(3)];
    case "rot180": return [turn(1)];
    case "rot90": return w === h ? [
      { element: 1, map: (x, y) => ({ x: w - y, y: x }), linear: (dx, dy) => ({ x: -dy, y: dx }) },
      turn(2),
      { element: 3, map: (x, y) => ({ x: y, y: h - x }), linear: (dx, dy) => ({ x: dy, y: -dx }) },
    ] : [];
    case "diag": return w === h ? [{ element: 1, map: (x, y) => ({ x: y, y: x }), linear: (dx, dy) => ({ x: dy, y: dx }) }] : [];
    case "adiag": return w === h ? [{ element: 1, map: (x, y) => ({ x: h - y, y: w - x }), linear: (dx, dy) => ({ x: -dy, y: -dx }) }] : [];
    default: return [];
  }
}

/**
 * The player an image of something `owner` placed belongs to, when Symmetry hands each
 * copy its own player. The eight players go in groups of as many as the mode has images —
 * P1–P2, P3–P4, … for the two-way modes, P1–P4 and P5–P8 for the four-way ones — and the
 * copy takes the player in the same group the image's element leads to, so whichever
 * player you place for, each corner keeps its own: under "hv" P1 top-left gives P2
 * top-right, P3 bottom-left and P4 bottom-right, and placing for P3 bottom-left gives the
 * same four. Neutral and the rescuable players (9–12) are left alone.
 */
export function mirroredOwner(mode: SymmetryMode, owner: number, element: number): number {
  if (element === 0 || owner < 0 || owner > 7) return owner;
  const size = mode === "hv" || mode === "rot90" ? 4 : 2;
  const slot = owner % size;
  return owner - slot + (mode === "rot90" ? (slot + element) % size : slot ^ element);
}

/** A point and the element of the image it is (0 for the original). */
export interface MirrorImage extends Point { element: number }

/** Whether a mode's images keep a `rw` × `rh` box's shape (a quarter turn or a diagonal swaps the sides). */
export function keepsShape(mode: SymmetryMode, rw: number, rh: number): boolean {
  return rw === rh || !(mode === "rot90" || mode === "diag" || mode === "adiag");
}

/**
 * A pixel position and its images — the continuous version of `mirrorPoints`, for
 * anything placed by pixel rather than by tile (a unit's centre). `width`/`height` are
 * in tiles; the map is `width * 32` pixels wide.
 */
export function mirrorPixel(mode: SymmetryMode, px: number, py: number, width: number, height: number): Point[] {
  return mirrorPixelImages(mode, px, py, width, height).map(({ x, y }) => ({ x, y }));
}

/** `mirrorPixel` with the element each image is, so a copy can be given its player (`mirroredOwner`). */
export function mirrorPixelImages(mode: SymmetryMode, px: number, py: number, width: number, height: number): MirrorImage[] {
  const out: MirrorImage[] = [{ x: px, y: py, element: 0 }];
  for (const img of symmetryImages(mode, width * 32, height * 32)) {
    const p = img.map(px, py);
    if (!out.some((q) => q.x === p.x && q.y === p.y)) out.push({ ...p, element: img.element });
  }
  return out;
}

export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * A pixel box and its images, normalised — a location's bounds. A quarter turn of a box
 * is still a box, so every mode applies. `width`/`height` in tiles.
 */
export function mirrorBox(mode: SymmetryMode, box: Box, width: number, height: number): Box[] {
  const out: Box[] = [{ ...box }];
  for (const image of symmetryImages(mode, width * 32, height * 32)) {
    const img = boxImage(image, box);
    if (!out.some((q) => q.left === img.left && q.top === img.top && q.right === img.right && q.bottom === img.bottom)) out.push(img);
  }
  return out;
}

/**
 * The top-left tiles of a `rw` × `rh` footprint's images — a doodad's. An image that
 * would turn the footprint on its side is dropped (`keepsShape`), since the doodad cannot
 * be turned.
 */
export function mirrorTileRect(mode: SymmetryMode, x: number, y: number, rw: number, rh: number, width: number, height: number): Point[] {
  return mirrorTileRectImages(mode, x, y, rw, rh, width, height).map(({ x, y }) => ({ x, y }));
}

/** `mirrorTileRect` with the element each image is. */
export function mirrorTileRectImages(mode: SymmetryMode, x: number, y: number, rw: number, rh: number, width: number, height: number): MirrorImage[] {
  const out: MirrorImage[] = [{ x, y, element: 0 }];
  if (!keepsShape(mode, rw, rh)) return out;
  for (const img of symmetryImages(mode, width, height)) {
    const a = img.map(x, y), b = img.map(x + rw, y + rh);
    const p = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
    if (!out.some((q) => q.x === p.x && q.y === p.y)) out.push({ ...p, element: img.element });
  }
  return out;
}

/**
 * Something on the map, for finding its mirror images among the others: its centre in
 * pixels and what it is (a unit type, a doodad, a box's size). Moving and deleting under
 * a symmetry mode work on what is selected, and a click selects the thing *and* the things
 * standing at its images — matched by kind and position, within `tolerance` pixels, since
 * a building or a doodad snapped to the grid can sit a little off the exact image. A map
 * made symmetric by hand is matched the same way as one built with the mode on.
 */
export interface Placed { x: number; y: number; kind: number }

function nearestAt(items: readonly (Placed | null)[], kind: number, p: Point, tolerance: number, skip?: (i: number) => boolean): number {
  let best = -1, bestD = tolerance * tolerance;
  items.forEach((it, i) => {
    if (!it || it.kind !== kind || skip?.(i)) return;
    const d = (it.x - p.x) ** 2 + (it.y - p.y) ** 2;
    if (d <= bestD) { best = i; bestD = d; }
  });
  return best;
}

/** `picked` and, under the mode, whatever stands at each one's images — what a click on the map selects. */
export function withMirrorImages(mode: SymmetryMode, items: readonly (Placed | null)[], picked: readonly number[], width: number, height: number, tolerance: number): number[] {
  const out = new Set(picked);
  const images = symmetryImages(mode, width * 32, height * 32);
  if (images.length === 0) return [...out];
  for (const i of picked) {
    const it = items[i];
    if (!it) continue;
    for (const img of images) {
      const j = nearestAt(items, it.kind, img.map(it.x, it.y), tolerance);
      if (j >= 0) out.add(j);
    }
  }
  return [...out];
}

/**
 * The things among `candidates` standing at the mirror images of item `i`, each with the
 * image that takes `i` there — each candidate at most once, the nearest to the image.
 */
export function mirrorPartners(mode: SymmetryMode, items: readonly (Placed | null)[], i: number, candidates: readonly number[], width: number, height: number, tolerance: number): { index: number; image: SymmetryImage }[] {
  const it = items[i];
  if (!it) return [];
  const pool = new Set(candidates);
  pool.delete(i);
  const out: { index: number; image: SymmetryImage }[] = [];
  for (const image of symmetryImages(mode, width * 32, height * 32)) {
    const j = nearestAt(items, it.kind, image.map(it.x, it.y), tolerance, (k) => !pool.has(k));
    if (j >= 0) { out.push({ index: j, image }); pool.delete(j); }
  }
  return out;
}

/** How a drag's movement turns for one of the things it moves. */
export type Linear = (dx: number, dy: number) => Point;
/** The movement as it is: what whatever follows the pointer moves by. */
export const SAME_MOVE: Linear = (dx, dy) => ({ x: dx, y: dy });

/**
 * How each of `selected` moves when the pointer moves by (dx, dy) from `from`. The
 * selection is taken apart into groups of mirror images: the one nearest the pointer in
 * each group follows the pointer, and the others move the way their image turns the
 * movement (left for right under a horizontal mirror, a quarter turn under rotation), so a
 * moved base and its copies stay mirror images. Something with no image in the selection
 * follows the pointer. With the mode off everything follows the pointer, as before.
 */
export function mirrorMoves(mode: SymmetryMode, items: readonly (Placed | null)[], selected: readonly number[], from: Point, width: number, height: number, tolerance: number): Map<number, Linear> {
  const out = new Map<number, Linear>();
  const dist = (i: number) => { const it = items[i]; return it ? (it.x - from.x) ** 2 + (it.y - from.y) ** 2 : Infinity; };
  const order = [...selected].sort((a, b) => dist(a) - dist(b));
  for (const i of order) {
    if (out.has(i)) continue;
    out.set(i, SAME_MOVE);
    const free = selected.filter((k) => !out.has(k));
    for (const { index, image } of mirrorPartners(mode, items, i, free, width, height, tolerance)) out.set(index, image.linear);
  }
  return out;
}

/** A pixel box's image under one of a mode's images (made over the map in pixels), normalised — a mirrored location as it is resized. */
export function boxImage(image: SymmetryImage, box: Box): Box {
  const a = image.map(box.left, box.top), b = image.map(box.right, box.bottom);
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

/** Flat tile indices of a brush footprint and all its images, each cell once. */
export function mirrorRect(mode: SymmetryMode, rect: Rect, width: number, height: number): Set<number> {
  const out = new Set<number>();
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      if (mode === "none") { out.add(y * width + x); continue; }
      for (const p of mirrorPoints(mode, x, y, width, height)) out.add(p.y * width + p.x);
    }
  }
  return out;
}

/** The same for an arbitrary set of cells (a flood-fill region). */
export function mirrorIndices(mode: SymmetryMode, indices: Iterable<number>, width: number, height: number): Set<number> {
  const out = new Set<number>();
  for (const at of indices) {
    if (mode === "none") { out.add(at); continue; }
    for (const p of mirrorPoints(mode, at % width, Math.floor(at / width), width, height)) out.add(p.y * width + p.x);
  }
  return out;
}

export interface AxisLine {
  /** Endpoints in tile units (may be fractional: the centre of a map of odd width is x = w / 2). */
  x0: number; y0: number; x1: number; y1: number;
}

export interface SymmetryAxes {
  lines: AxisLine[];
  /** Whether the mode turns about the map centre (draw a centre mark). */
  centre: boolean;
}

/** What to draw for a mode: its mirror lines, and a centre mark for the rotations. */
export function symmetryAxes(mode: SymmetryMode, width: number, height: number): SymmetryAxes {
  const cx = width / 2, cy = height / 2;
  const vertical: AxisLine = { x0: cx, y0: 0, x1: cx, y1: height };
  const horizontal: AxisLine = { x0: 0, y0: cy, x1: width, y1: cy };
  switch (mode) {
    case "h": return { lines: [vertical], centre: false };
    case "v": return { lines: [horizontal], centre: false };
    case "hv": return { lines: [vertical, horizontal], centre: false };
    case "rot180": return { lines: [], centre: true };
    case "rot90": return { lines: [vertical, horizontal], centre: true };
    case "diag": return { lines: [{ x0: 0, y0: 0, x1: width, y1: height }], centre: false };
    case "adiag": return { lines: [{ x0: width, y0: 0, x1: 0, y1: height }], centre: false };
    default: return { lines: [], centre: false };
  }
}
