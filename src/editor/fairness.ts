/**
 * How alike a map plays on the sides of a symmetry.
 *
 * A melee map is fair when what one player has, the others have: the same ground to walk,
 * the same cliffs to hold, the same room to build, the same minerals. Map makers get there
 * by mirroring or turning one base's worth of map, and the game then undoes some of it
 * where nobody looks. A tile cannot be flipped, so the far side is built from other tiles,
 * and those do not always carry the flags of the ones they answer: the game's own ramp
 * pairs are mirror images in the picture and differ in which small squares walk
 * (doodadTwin.ts). A doodad set on one side only, a blend touched up on one side only, a
 * mineral field with 1500 where its image has 5000.
 *
 * This compares the map with its own image under a symmetry mode, at the size the game
 * decides things at: walking and height per small square (minitile, a quarter of a tile
 * each way), building per tile, and the resources and start locations by their images.
 * It reads `tiles` (MTXM), which is what the game plays on.
 *
 * Pure and canvas-free; `tests/fairness.test.ts`.
 */
import type { Scenario } from "../formats/chk/scenario";
import { groupBuildable, megatileForTile, tileGroupOf, TileFlag, type Tileset } from "../formats/tileset/decode";
import { symmetryAvailable, symmetryImages, type SymmetryMode } from "./symmetry";

/** Bits of a `FairnessReport.mask` byte: what differs between a small square and its images. */
export const UNLIKE_WALK = 1, UNLIKE_HEIGHT = 2, UNLIKE_BUILD = 4;

/** Minerals (three pictures of one thing), the geyser, the start location. */
const MINERALS = [176, 177, 178];
const GEYSER = 188, START = 214;
/** How far from its image's spot a counterpart may stand, in pixels: half a tile. */
const COUNTERPART_PX = 16;

export interface FairnessPlace {
  /** The tiles the place covers, on the side nearest the map's top-left; x1 and y1 are past the end. */
  x0: number; y0: number; x1: number; y1: number;
  /** Small squares that differ from an image, and how many of them in each way. */
  squares: number;
  walk: number;
  height: number;
  build: number;
}

export interface UnmatchedResource {
  /** Index into `scn.units`. */
  index: number;
  unitId: number;
  x: number;
  y: number;
  /** Nothing of its kind stands at an image of its spot, or what stands there holds another amount. */
  why: "missing" | "amount";
}

export interface FairnessReport {
  mode: SymmetryMode;
  /** Small squares compared: every square with its images, counted once. */
  compared: number;
  /** Of those, the ones that differ from an image in any way, and in each way. */
  unlike: number;
  walk: number;
  height: number;
  build: number;
  /** The share that plays alike, 0..1. */
  alike: number;
  /** Where the differences are, largest first. */
  places: FairnessPlace[];
  /** A byte per small square (`width * 4` across), `UNLIKE_*` bits, set on a square and on its images. */
  mask: Uint8Array;
  /** Minerals, geysers and start locations with no equal counterpart. */
  resources: UnmatchedResource[];
}

/** What the game decides per small square, in a byte: walkable, height (two bits), buildable. */
function squares(scn: Pick<Scenario, "width" | "height" | "tiles">, tileset: Tileset): Uint8Array {
  const W = scn.width * 4, H = scn.height * 4;
  const out = new Uint8Array(W * H);
  for (let ty = 0; ty < scn.height; ty++) {
    for (let tx = 0; tx < scn.width; tx++) {
      const tile = scn.tiles[ty * scn.width + tx];
      const megatile = megatileForTile(tileset, tile);
      const group = tileset.groups[tileGroupOf(tile, tileset.groups.length)];
      const build = group && groupBuildable(group) ? 8 : 0;
      for (let m = 0; m < 16; m++) {
        const flags = megatile >= 0 ? tileset.megatileFlags[megatile * 16 + m] ?? 0 : 0;
        const height = flags & TileFlag.HighGround ? 4 : flags & TileFlag.MidGround ? 2 : 0;
        out[(ty * 4 + (m >> 2)) * W + tx * 4 + (m & 3)] = (flags & TileFlag.Walkable ? 1 : 0) | height | build;
      }
    }
  }
  return out;
}

const kindOf = (unitId: number) => (MINERALS.includes(unitId) ? MINERALS[0] : unitId);

/**
 * The map against its own image under `mode`. Null when the mode has no image on a map of
 * this shape (none, or a turn or a diagonal on a map that is not square). `summary` leaves
 * out the places and the resources, for asking only how alike the sides are.
 */
export function fairnessReport(scn: Pick<Scenario, "width" | "height" | "tiles" | "units">, tileset: Tileset, mode: SymmetryMode, options: { summary?: boolean } = {}): FairnessReport | null {
  if (mode === "none" || !symmetryAvailable(mode, scn.width, scn.height)) return null;
  const W = scn.width * 4, H = scn.height * 4;
  const images = symmetryImages(mode, W, H);
  if (images.length === 0) return null;
  const props = squares(scn, tileset);
  const mask = new Uint8Array(W * H);
  const first = new Uint8Array(W * H);
  let compared = 0, unlike = 0, walk = 0, height = 0, build = 0;
  const members: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const at = y * W + x;
      // A square and its images are one group, judged where its lowest index is.
      members.length = 0;
      let lowest = true;
      for (const image of images) {
        const p = image.map(x + 0.5, y + 0.5);
        const other = Math.floor(p.y) * W + Math.floor(p.x);
        if (other < at) { lowest = false; break; }
        if (other !== at) members.push(other);
      }
      if (!lowest) continue;
      compared++;
      let differs = 0;
      for (const other of members) {
        const d = props[at] ^ props[other];
        if (d & 1) differs |= UNLIKE_WALK;
        if (d & 6) differs |= UNLIKE_HEIGHT;
        if (d & 8) differs |= UNLIKE_BUILD;
      }
      if (!differs) continue;
      unlike++;
      if (differs & UNLIKE_WALK) walk++;
      if (differs & UNLIKE_HEIGHT) height++;
      if (differs & UNLIKE_BUILD) build++;
      mask[at] |= differs;
      first[at] = differs;
      for (const other of members) mask[other] |= differs;
    }
  }
  const report: FairnessReport = { mode, compared, unlike, walk, height, build, alike: compared ? 1 - unlike / compared : 1, places: [], mask, resources: [] };
  if (options.summary) return report;

  // Places: the tiles holding a differing square, joined where they touch, corners included.
  const tw = scn.width, th = scn.height;
  const seen = new Uint8Array(tw * th);
  const holds = (tx: number, ty: number) => {
    for (let m = 0; m < 16; m++) if (first[(ty * 4 + (m >> 2)) * W + tx * 4 + (m & 3)]) return true;
    return false;
  };
  const stack: number[] = [];
  for (let start = 0; start < tw * th; start++) {
    if (seen[start] || !holds(start % tw, (start / tw) | 0)) continue;
    const place: FairnessPlace = { x0: tw, y0: th, x1: 0, y1: 0, squares: 0, walk: 0, height: 0, build: 0 };
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const tile = stack.pop()!;
      const tx = tile % tw, ty = (tile / tw) | 0;
      place.x0 = Math.min(place.x0, tx); place.y0 = Math.min(place.y0, ty);
      place.x1 = Math.max(place.x1, tx + 1); place.y1 = Math.max(place.y1, ty + 1);
      for (let m = 0; m < 16; m++) {
        const bits = first[(ty * 4 + (m >> 2)) * W + tx * 4 + (m & 3)];
        if (!bits) continue;
        place.squares++;
        if (bits & UNLIKE_WALK) place.walk++;
        if (bits & UNLIKE_HEIGHT) place.height++;
        if (bits & UNLIKE_BUILD) place.build++;
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = tx + dx, ny = ty + dy;
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= tw || ny >= th) continue;
          const next = ny * tw + nx;
          if (seen[next] || !holds(nx, ny)) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    report.places.push(place);
  }
  report.places.sort((a, b) => b.squares - a.squares || a.y0 - b.y0 || a.x0 - b.x0);

  // Resources and starts: each wants one of its kind at every image of its spot, holding as much.
  const pixelImages = symmetryImages(mode, scn.width * 32, scn.height * 32);
  const counted = scn.units.map((u, index) => ({ u, index })).filter(({ u }) => MINERALS.includes(u.unitId) || u.unitId === GEYSER || u.unitId === START);
  for (const { u, index } of counted) {
    let why: UnmatchedResource["why"] | null = null;
    for (const image of pixelImages) {
      const p = image.map(u.x, u.y);
      const there = counted.filter(({ u: v }) => kindOf(v.unitId) === kindOf(u.unitId) && Math.abs(v.x - p.x) <= COUNTERPART_PX && Math.abs(v.y - p.y) <= COUNTERPART_PX);
      if (there.length === 0) { why = "missing"; break; }
      if (u.unitId !== START && !there.some(({ u: v }) => v.resourceAmount === u.resourceAmount)) why = "amount";
    }
    if (why) report.resources.push({ index, unitId: u.unitId, x: u.x, y: u.y, why });
  }
  return report;
}

/** The modes a map of this shape can be held against, the two-way ones first. */
const JUDGED: readonly SymmetryMode[] = ["h", "v", "rot180", "diag", "adiag", "hv", "rot90"];

/** How alike the map is to its image under each mode that fits its shape, 0..1. */
export function symmetryShares(scn: Pick<Scenario, "width" | "height" | "tiles" | "units">, tileset: Tileset): Partial<Record<SymmetryMode, number>> {
  const out: Partial<Record<SymmetryMode, number>> = {};
  for (const mode of JUDGED) {
    const report = fairnessReport(scn, tileset, mode, { summary: true });
    if (report) out[mode] = report.alike;
  }
  return out;
}

/**
 * At or above this share a map is taken to have been made with the mode. Sixteen of the
 * game's own maps, drawn by hand with no mirror, measure 0.05 to 0.85 under every mode
 * (the highest, a fortress map turned half round, 0.853); the one that was mirrored,
 * 0.989 under its mode and 0.63 at most under the others.
 */
export const SYMMETRIC_SHARE = 0.9;

/**
 * The symmetry a map was made with, as far as its ground tells: the mode it is most alike
 * under, a four-way one when it holds nearly as well as the best two-way one. Null when
 * no mode reaches `SYMMETRIC_SHARE`.
 */
export function likelySymmetry(shares: Partial<Record<SymmetryMode, number>>): SymmetryMode | null {
  let best: SymmetryMode | null = null, bestShare = SYMMETRIC_SHARE;
  for (const mode of JUDGED) {
    const share = shares[mode];
    if (share === undefined || share < SYMMETRIC_SHARE) continue;
    const fourWay = mode === "hv" || mode === "rot90";
    if (best === null || share > bestShare + 1e-9 || (fourWay && share >= bestShare - 0.02)) { best = mode; bestShare = Math.max(share, fourWay ? share : bestShare); }
  }
  return best;
}
