/**
 * A doodad's twin: the doodad that is its picture seen in a mirror, left for right.
 *
 * A doodad cannot be flipped. A ramp that cuts a cliff running down to the right and the
 * ramp for a cliff running up to the right are two doodads, drawn as mirror images of
 * each other, and nothing in the game's files says they are a pair. Under a left-right
 * symmetry mode the image of the one is the other, so this finds the pair by looking: a
 * twin has the same footprint, tiles in the mirrored cells whose pictures are the
 * mirrored pictures, and all but a few of the mirrored flags.
 *
 * All but a few, because the game's own pairs are not exact. The pictures are (Badlands,
 * Jungle, Twilight and Ashworld ramps are mirror images to the pixel, flags and all), but
 * in three tilesets somebody set the flags of the two by hand and not alike: the Desert
 * Compound ramps differ in 30 minitiles of 736 (walkable, mid ground and ramp bits), the
 * Ice cliff ramps in 16 of 480, the Desert cliff ramps in 83 of 736, a Space Platform
 * bridge and its twin in 7 of 992. So a
 * ramp on one side of a mirrored map does not play quite as its image does, and that is
 * the game's doing. `twinDifference` counts it, for the editor to say so.
 *
 * Pure and canvas-free; `tests/doodad-twin.test.ts`.
 */
import { megatileForTile, tileGroupOf, type Tileset } from "../formats/tileset/decode";
import type { DoodadCatalogue, DoodadDef } from "../formats/tileset/doodads";
import { isStretched, type StretchedDoodad } from "./stretch";
import type { SymmetryMode } from "./symmetry";

/**
 * How far a mirrored picture may be from the candidate's, per channel on average, and
 * still be its twin. The pairs the game ships measure 0–2.6 (Installation's ramps 5.8);
 * unrelated doodads of one size, 20 and up.
 */
export const TWIN_PICTURE = 8;

/**
 * The share of a twin's minitiles whose flags may differ from the mirrored ones. The
 * game's pairs differ in 0–4%, and the two Desert cliff ramps in 11% (83 of 736: the mid
 * ground and ramp bits of whole tiles); a Compound ramp and the High Compound ramp that
 * is the same picture a level up, in most of them.
 */
export const TWIN_FLAGS = 0.2;

/** How many minitiles of megatile `b` do not carry the flags of megatile `a` seen in a mirror (each row reversed). */
function unlikeFlags(tileset: Tileset, a: number, b: number): number {
  let unlike = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) if (tileset.megatileFlags[a * 16 + r * 4 + c] !== tileset.megatileFlags[b * 16 + r * 4 + 3 - c]) unlike++;
  }
  return unlike;
}

function pixel(tileset: Tileset, megatile: number, x: number, y: number): number {
  const ref = tileset.megatileRefs[megatile * 16 + (y >> 3) * 4 + (x >> 3)] ?? 0;
  const px = x & 7;
  return (tileset.minitiles[(ref >>> 1) * 64 + (y & 7) * 8 + (ref & 1 ? 7 - px : px)] ?? 0) * 4;
}

/** The mean difference per channel between megatile `a` mirrored and megatile `b`. */
function mirroredPicture(tileset: Tileset, a: number, b: number): number {
  const { palette } = tileset;
  let sum = 0;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const p = pixel(tileset, a, x, y), q = pixel(tileset, b, 31 - x, y);
      sum += Math.abs(palette[p] - palette[q]) + Math.abs(palette[p + 1] - palette[q + 1]) + Math.abs(palette[p + 2] - palette[q + 2]);
    }
  }
  return sum / (1024 * 3);
}

/** How far `other` is from being `def` in a mirror — its picture, and how many minitiles play otherwise — or null when it is not that at all. */
function apart(tileset: Tileset, def: DoodadDef, other: DoodadDef): { picture: number; unlike: number } | null {
  if (other.width !== def.width || other.height !== def.height || (other.overlay === null) !== (def.overlay === null)) return null;
  let sum = 0, cells = 0, unlike = 0;
  for (let r = 0; r < def.height; r++) {
    for (let c = 0; c < def.width; c++) {
      const a = def.tiles[r * def.width + c], b = other.tiles[r * def.width + def.width - 1 - c];
      if ((a === 0) !== (b === 0)) return null;
      if (a === 0) continue;
      const ma = megatileForTile(tileset, a), mb = megatileForTile(tileset, b);
      if (tileset.groups[tileGroupOf(a, tileset.groups.length)]?.flags !== tileset.groups[tileGroupOf(b, tileset.groups.length)]?.flags) return null;
      unlike += unlikeFlags(tileset, ma, mb);
      sum += mirroredPicture(tileset, ma, mb);
      cells++;
    }
  }
  if (cells === 0 || unlike > TWIN_FLAGS * cells * 16 || sum / cells > TWIN_PICTURE) return null;
  return { picture: sum / cells, unlike };
}

/**
 * How many minitiles of `twin` do not carry the flags of `def` seen in a mirror: where a
 * unit walks, at what height, what is ramp. 0 for a pair that plays alike.
 */
export function twinDifference(tileset: Tileset, def: DoodadDef, twin: DoodadDef): number {
  return apart(tileset, def, twin)?.unlike ?? 0;
}

const twins = new WeakMap<DoodadCatalogue, Map<number, DoodadDef | null>>();

/**
 * The doodad that is `def` mirrored left for right, or null when the tileset has none.
 * A doodad that is its own mirror image is its own twin. Among several that qualify, the
 * one filed under the same category, then the one that plays most alike, then the
 * nearest picture.
 */
export function doodadTwin(tileset: Tileset, catalogue: DoodadCatalogue, def: DoodadDef): DoodadDef | null {
  let known = twins.get(catalogue);
  if (!known) twins.set(catalogue, (known = new Map()));
  const cached = known.get(def.id);
  if (cached !== undefined) return cached;
  let best: DoodadDef | null = null, bestApart = { picture: Infinity, unlike: Infinity };
  for (const other of catalogue.doodads) {
    const d = apart(tileset, def, other);
    if (!d) continue;
    const sameShelf = other.category === def.category, bestShelf = best?.category === def.category;
    const better = best === null || (sameShelf !== bestShelf ? sameShelf : d.unlike !== bestApart.unlike ? d.unlike < bestApart.unlike : d.picture < bestApart.picture);
    if (better) { best = other; bestApart = d; }
  }
  known.set(def.id, best);
  return best;
}

/** Whether image `element` of a symmetry mode is the map mirrored left for right, the one way a doodad has a twin for. */
export function mirrorsAcross(mode: SymmetryMode, element: number): boolean {
  return (mode === "h" || mode === "hv") && element === 1;
}

/**
 * `def` as it stands on the far side of a left-right mirror: its twin, and for a
 * stretched doodad its twin stretched the same, cell for mirrored cell. Not re-planned:
 * the twin's own plan can cut a line a cell away from where this one was cut, and two
 * ramps that should be images of each other would differ by a tile. Null when the
 * doodad has no twin.
 */
export function mirroredDoodad(tileset: Tileset, catalogue: DoodadCatalogue, def: DoodadDef): DoodadDef | null {
  if (!isStretched(def)) return doodadTwin(tileset, catalogue, def);
  const from = def.stretched.from;
  const twin = doodadTwin(tileset, catalogue, from);
  if (!twin) return null;
  // What each of the doodad's tiles, and each ground it wants, is on the twin: the mirrored cell's.
  const tileOf = new Map<number, number>([[0, 0]]), groundOf = new Map<number, number>([[0, 0]]);
  for (let r = 0; r < from.height; r++) {
    for (let c = 0; c < from.width; c++) {
      const cell = r * from.width + c, mirrored = r * from.width + from.width - 1 - c;
      if (!tileOf.has(from.tiles[cell])) tileOf.set(from.tiles[cell], twin.tiles[mirrored]);
      if (!groundOf.has(from.required[cell])) groundOf.set(from.required[cell], twin.required[mirrored]);
    }
  }
  const { width, height } = def;
  const tiles = new Uint16Array(width * height), required = new Uint16Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const at = r * width + width - 1 - c;
      tiles[at] = tileOf.get(def.tiles[r * width + c]) ?? 0;
      required[at] = groundOf.get(def.required[r * width + c]) ?? 0;
    }
  }
  // The twin as shipped stands where the doodad as shipped stands, mirrored within the footprint.
  const left = -def.stretched.offset.x;
  const mirrored: StretchedDoodad = {
    ...twin, width, height, tiles, required,
    stretched: { ...def.stretched, from: twin, offset: { x: -(width - left - from.width) || 0, y: def.stretched.offset.y } },
  };
  return mirrored;
}
