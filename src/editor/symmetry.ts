/**
 * Symmetry for the brushes: every cell a stroke touches is mirrored across the map's
 * axes (or rotated about its centre) before the brush runs, so the Rect, Tile and Fog
 * brushes lay the same thing down on both sides at once. The mirroring works on *sets
 * of cells*, not on strokes — `stampTerrain` then derives left/right pairs from column
 * parity as usual, so a mirrored Rect footprint still comes out as valid pairs whatever
 * the map's width. The isometric and Blend brushes are not covered: the ISOM lattice
 * does not mirror cell by cell.
 */
import type { Rect, TileChange } from "./terrain";

export type SymmetryMode = "none" | "h" | "v" | "hv" | "rot180" | "rot90" | "diag" | "adiag";

export interface SymmetryModeInfo {
  id: SymmetryMode;
  label: string;
  hint: string;
  /** Only meaningful when the map is square. */
  square?: boolean;
}

export const SYMMETRY_MODES: readonly SymmetryModeInfo[] = [
  { id: "none", label: "None", hint: "Brushes paint where you point them" },
  { id: "h", label: "Mirror horizontally", hint: "Left ↔ right across the vertical centre line" },
  { id: "v", label: "Mirror vertically", hint: "Top ↔ bottom across the horizontal centre line" },
  { id: "hv", label: "Mirror both axes (4-way)", hint: "Every stroke lands in all four quadrants" },
  { id: "rot180", label: "Rotational 180°", hint: "Point-mirrored through the map centre (2-player maps)" },
  { id: "rot90", label: "Rotational 90° (4-way)", hint: "Repeated at each quarter turn about the centre", square: true },
  { id: "diag", label: "Diagonal", hint: "Mirrored across the top-left ↔ bottom-right diagonal", square: true },
  { id: "adiag", label: "Anti-diagonal", hint: "Mirrored across the top-right ↔ bottom-left diagonal", square: true },
];

export const requiresSquare = (mode: SymmetryMode) => SYMMETRY_MODES.find((m) => m.id === mode)?.square === true;

/** Whether the mode can run on a map of these dimensions. */
export function symmetryAvailable(mode: SymmetryMode, width: number, height: number): boolean {
  return !requiresSquare(mode) || width === height;
}

export function symmetryLabel(mode: SymmetryMode): string {
  return SYMMETRY_MODES.find((m) => m.id === mode)?.label ?? mode;
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
 * A pixel position and its images — the continuous version of `mirrorPoints`, for
 * anything placed by pixel rather than by tile (a unit's centre). `width`/`height` are
 * in tiles; the map is `width * 32` pixels wide.
 */
export function mirrorPixel(mode: SymmetryMode, px: number, py: number, width: number, height: number): Point[] {
  const w = width * 32, h = height * 32;
  const mx = w - px, my = h - py;
  let images: Point[];
  switch (mode) {
    case "h": images = [{ x: mx, y: py }]; break;
    case "v": images = [{ x: px, y: my }]; break;
    case "hv": images = [{ x: mx, y: py }, { x: px, y: my }, { x: mx, y: my }]; break;
    case "rot180": images = [{ x: mx, y: my }]; break;
    case "rot90": images = w === h ? [{ x: w - py, y: px }, { x: mx, y: my }, { x: py, y: h - px }] : []; break;
    case "diag": images = w === h ? [{ x: py, y: px }] : []; break;
    case "adiag": images = w === h ? [{ x: h - py, y: w - px }] : []; break;
    default: images = [];
  }
  const out: Point[] = [{ x: px, y: py }];
  for (const p of images) if (!out.some((q) => q.x === p.x && q.y === p.y)) out.push(p);
  return out;
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

/**
 * Merge several change lists over the same map into one: a cell that appears more than
 * once keeps its first `before` and its last `after`, and cells that end where they
 * started are dropped. Order follows first appearance.
 */
export function mergeChanges(lists: readonly (readonly TileChange[])[]): TileChange[] {
  const merged = new Map<number, TileChange>();
  for (const list of lists) {
    for (const c of list) {
      const prev = merged.get(c.at);
      if (prev) prev.after = c.after;
      else merged.set(c.at, { ...c });
    }
  }
  return [...merged.values()].filter((c) => c.before !== c.after);
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
