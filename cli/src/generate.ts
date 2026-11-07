/**
 * `scmjs map generate`: a melee map from a seed — high-ground mains with one ramp out, a natural under each ramp, free
 * bases where there is room, an open middle with mesas and lakes — laid with the editor's own isometric brush and
 * checked before it is written.
 *
 * Three steps, each a pure function:
 *
 *  1. **The plan** (`planMap`, no game data): a terrain class for every diamond of the ISOM lattice (low, high, water,
 *     and where the ground only changes its look) plus the bases. Every player's *base complex* — main plateau, ramp,
 *     apron, natural — is one template laid down at each player's natural, flipped left-right for the players on the
 *     right, so the bases are copies of each other. The naturals stand at the images of one point under the symmetry,
 *     and so does every obstacle in the middle. The complexes are not turned upside down for the players at the
 *     bottom, because StarCraft's ramps only ever face south (the tilesets have no ramp up a north-facing cliff): a
 *     bottom player's main is above its natural, as a top player's is. The ground distances still match, since every
 *     walk out of a main goes main → ramp → natural, which is the same walk for everybody.
 *  2. **The ground** (`buildScenario`, needs the tileset's CV5 and dddata.bin): the base terrain filled in, then one
 *     isometric stroke a terrain (`paintIsomDiamonds` — the brush with a footprint of any shape), so every edge is the
 *     brush's own transition; the ramps are the tileset's ramp doodads, placed where StarEdit's rule accepts them; the
 *     resources are laid out by the Melee Wizard's rules (`bases.ts`) on ground the game would build on.
 *  3. **The checks** (`measureMap`): ground reach from every start to every other over the walkable minitiles, the
 *     resources each player owns, Check Map. A layout that fails is thrown away and the next inner seed tried.
 */
import { createScenario } from "../../src/formats/chk/create";
import { markDirty, type Scenario } from "../../src/formats/chk/scenario";
import { PlayerType } from "../../src/formats/chk/sections/players";
import { applyPlayerSettings, readPlayerSettings } from "../../src/editor/settings";
import { baseTerrain, flatTerrain } from "../../src/formats/tileset/terrain";
import { groupBuildable, megatileForTile, megatileHeight, TileFlag, type Tileset } from "../../src/formats/tileset/decode";
import { type DoodadCatalogue, type DoodadDef } from "../../src/formats/tileset/doodads";
import { applyDoodadChanges, checkDoodadPlacement, DEFAULT_DOODAD_PLACEMENT, placeDoodad } from "../../src/editor/doodads";
import { applyChanges } from "../../src/editor/terrain";
import { checkIsom, hasIsom, isomTables, paintIsomDiamonds, type Diamond } from "../../src/editor/isom";
import { symmetryImages, type SymmetryMode } from "../../src/editor/symmetry";
import { addUnits, applyUnitChanges, makeUnit, DEFAULT_GAS } from "../../src/editor/units";
import { validateScenario, type Issue } from "../../src/editor/validate";
import { START_LOCATION } from "../../src/data/units";
import { TILESETS, type TilesetId } from "../../src/data/tilesets";
import { centreOf, chebGap, GEYSER, HALL, layoutBase, MINERAL, mineralLooks, TILE, type TileRect } from "./bases";

/* ── Options ──────────────────────────────────────────────── */

export const GEN_SYMMETRIES = ["rotational", "mirror-x", "mirror-y", "diagonal"] as const;
export type GenSymmetry = (typeof GEN_SYMMETRIES)[number];
export const GEN_STYLES = ["open", "chokes"] as const;
export type GenStyle = (typeof GEN_STYLES)[number];
export const GEN_PLAYERS = [2, 3, 4, 6, 8] as const;

export interface GenerateOptions {
  width: number;
  height: number;
  players: number;
  tileset: TilesetId;
  seed: number;
  symmetry: GenSymmetry;
  style: GenStyle;
}

/** Mineral amounts and counts, the standard melee ones. */
export const MAIN_MINERALS = 9, NATURAL_MINERALS = 7, FREE_MINERALS = 6;
export const MINERAL_AMOUNT = 1500;
const NEUTRAL = 11;
/** How many inner seeds a layout may take before the command gives up. */
export const ATTEMPTS = 12;
/** Ground distances between equivalent pairs may differ by this share before a layout is called unbalanced. */
export const BALANCE_TOLERANCE = 0.08;

/** The smallest side each player count is laid out on: the bases are a fixed size, so small maps run out of room. */
export function smallestSide(players: number): number {
  return players <= 2 ? 96 : players <= 6 ? 128 : 192;
}

/** The editor's symmetry mode a `--symmetry` means for a player count, or why it cannot be had. */
export function resolveSymmetry(players: number, symmetry: GenSymmetry, width: number, height: number): { mode: SymmetryMode } | { problem: string } {
  const square = width === height;
  if (players === 2) {
    if (symmetry === "rotational") return { mode: "rot180" };
    if (symmetry === "mirror-x") return { mode: "h" };
    if (symmetry === "mirror-y") return { mode: "v" };
    return square ? { mode: "diag" } : { problem: "diagonal symmetry needs a square map" };
  }
  if (symmetry === "diagonal") return { problem: `diagonal symmetry holds two players, not ${players}` };
  if (players === 6) {
    if (symmetry === "mirror-y" && width < 192) return { problem: "six players mirrored top to bottom need a map 192 wide or more" };
    return { mode: symmetry === "mirror-y" ? "v" : symmetry === "rotational" ? "rot180" : "h" };
  }
  // Four and eight: the four-way mirror. A quarter turn would need a ramp up a north-facing cliff for one of the four,
  // and StarCraft's tilesets have none, so "rotational" is the four-way mirror too (the bases are equal either way).
  return { mode: "hv" };
}

/** What `--symmetry` defaults to: rotational on a square map, mirrored left to right otherwise. */
export function defaultSymmetry(players: number, width: number, height: number): GenSymmetry {
  return width === height || players === 2 ? "rotational" : "mirror-x";
}

/* ── Terrain per tileset ──────────────────────────────────── */

/**
 * The terrains a map is built from, by CV5 index (`data/tilesets.ts` names them): the ground most of it is, the high
 * ground of the mains and mesas, what cannot be walked (water, tar, ice, lava, space), and a second look for each level.
 */
export interface Recipe {
  low: number;
  high: number;
  /** The cliff between the two: the edge set whose ramps join them. */
  cliff: number;
  water: number | null;
  lowDeco: number | null;
  highDeco: number | null;
  /** Whether a building may stand on the second looks; where not, they stay out of the bases. */
  decoBuilds: boolean;
}

const JUNGLE_FAMILY: Recipe = { low: 2, high: 3, cliff: 34, water: 5, lowDeco: 8, highDeco: 10, decoBuilds: true };
/** Installation is not here: none of its ground can be built on, so there is no melee on it. */
export const RECIPES: Partial<Record<TilesetId, Recipe>> = {
  badlands: { low: 2, high: 3, cliff: 34, water: 5, lowDeco: 6, highDeco: 7, decoBuilds: true },
  // Space between the platforms is the "water"; the ramps go up from Platform to High Platform.
  platform: { low: 3, high: 5, cliff: 21, water: 2, lowDeco: 4, highDeco: 6, decoBuilds: true },
  // Shale and High Shale cannot be built on.
  ashworld: { low: 2, high: 4, cliff: 16, water: 8, lowDeco: 6, highDeco: 7, decoBuilds: false },
  jungle: JUNGLE_FAMILY,
  desert: JUNGLE_FAMILY,
  ice: JUNGLE_FAMILY,
  twilight: JUNGLE_FAMILY,
};

/** The recipe of a tileset, or an error naming why it has none. */
export function recipeOf(tileset: TilesetId): Recipe {
  const recipe = RECIPES[tileset];
  if (!recipe) throw new Error(`${TILESETS.find((t) => t.id === tileset)?.name ?? tileset} has no ground a building can stand on, so it has no melee maps`);
  return recipe;
}

/* ── Random numbers ───────────────────────────────────────── */

/** mulberry32: small, fast and the same everywhere, so a seed is a map. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The inner seed of attempt `n`: the seed itself first, then a hash of the two. */
export function innerSeed(seed: number, attempt: number): number {
  if (attempt === 0) return seed >>> 0;
  let h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(attempt, 0xc2b2ae35);
  h ^= h >>> 13;
  return Math.imul(h, 0x27d4eb2f) >>> 0;
}

/* ── The lattice ──────────────────────────────────────────── */

/** Diamond classes. Water and high never touch low through less than a transition's room (`settle`). */
export const LOW = 0, HIGH = 1, WATER = 2;
export type TerrainClass = typeof LOW | typeof HIGH | typeof WATER;

/** The ISOM lattice as the generator sees it: diamond (dx, dy) with dx + dy even, centred on tile (2dx, dy). */
export class Lattice {
  readonly w: number;
  readonly h: number;
  readonly cls: Uint8Array;
  /** Low ground nothing may be built over: the bases' flat ground, the ramps' aprons. */
  readonly locked: Uint8Array;
  /** Where the ground takes its other look (low or high deco). */
  readonly deco: Uint8Array;
  /** The players' base complexes: copies of one template, which do not turn with the map. */
  readonly complex: Uint8Array;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.w = Math.floor(width / 2) + 1;
    this.h = height + 1;
    this.cls = new Uint8Array(this.w * this.h);
    this.locked = new Uint8Array(this.w * this.h);
    this.deco = new Uint8Array(this.w * this.h);
    this.complex = new Uint8Array(this.w * this.h);
  }
  in(dx: number, dy: number): boolean { return dx >= 0 && dy >= 0 && dx < this.w && dy < this.h && ((dx + dy) & 1) === 0; }
  at(dx: number, dy: number): number { return dy * this.w + dx; }
  /** Every diamond, row by row. */
  *all(): Generator<Diamond> { for (let y = 0; y < this.h; y++) for (let x = y & 1; x < this.w; x += 2) yield { x, y }; }
  /** The four diamonds sharing an edge. */
  edges(dx: number, dy: number): Diamond[] { return [{ x: dx - 1, y: dy - 1 }, { x: dx + 1, y: dy - 1 }, { x: dx + 1, y: dy + 1 }, { x: dx - 1, y: dy + 1 }].filter((d) => this.in(d.x, d.y)); }
  /** The eight around it: the four edges and the four corners. */
  ring(dx: number, dy: number): Diamond[] { return [...this.edges(dx, dy), ...[{ x: dx - 2, y: dy }, { x: dx + 2, y: dy }, { x: dx, y: dy - 2 }, { x: dx, y: dy + 2 }].filter((d) => this.in(d.x, d.y))]; }
  /** Steps over the ring to the nearest diamond `is` accepts, up to `max` (and `max + 1` beyond it). */
  distance(is: (i: number) => boolean, max: number): Uint8Array {
    const far = max + 1;
    const out = new Uint8Array(this.w * this.h).fill(far);
    let frontier: Diamond[] = [];
    for (const d of this.all()) if (is(this.at(d.x, d.y))) { out[this.at(d.x, d.y)] = 0; frontier.push(d); }
    for (let step = 1; step <= max && frontier.length; step++) {
      const next: Diamond[] = [];
      for (const d of frontier) for (const n of this.ring(d.x, d.y)) { const i = this.at(n.x, n.y); if (out[i] === far) { out[i] = step; next.push(n); } }
      frontier = next;
    }
    return out;
  }
}

/** The diamond whose centre is nearest a tile position. */
export function snapDiamond(x: number, y: number): Diamond {
  const cands: Diamond[] = [];
  for (let dy = Math.floor(y) - 1; dy <= Math.ceil(y) + 1; dy++) {
    for (let dx = Math.floor(x / 2) - 1; dx <= Math.ceil(x / 2) + 1; dx++) if (((dx + dy) & 1) === 0) cands.push({ x: dx, y: dy });
  }
  cands.sort((a, b) => Math.hypot(2 * a.x - x, a.y - y) - Math.hypot(2 * b.x - x, b.y - y) || a.y - b.y || a.x - b.x);
  return cands[0];
}

/** An isometric rectangle on the lattice: |u| ≤ a and |v| ≤ b around a centre, u running south-east and v north-east. */
function inIsoRect(ddx: number, ddy: number, a: number, b: number): boolean {
  const u = (ddx + ddy) / 2, v = (ddx - ddy) / 2;
  return Math.abs(u) <= a + 1e-6 && Math.abs(v) <= b + 1e-6;
}

/* ── The base complex ─────────────────────────────────────── */

/** Offsets in diamonds from the main's diamond, for a player whose natural lies to the right (flip x for the others). */
interface Template {
  high: Diamond[];
  locked: Diamond[];
  highDeco: Diamond[];
  /** The edge diamond the ramp goes on, and the facing (south-east) the ramp leads down. */
  ramp: Diamond;
  /** The middle of the apron at the ramp's foot: what the symmetry places (see `planMap`). */
  foot: Diamond;
  natural: Diamond;
}

function makeTemplate(r: () => number): Template {
  const a = 4 + Math.floor(r() * 2), b = 4 + Math.floor(r() * 2);
  const high: Diamond[] = [], locked: Diamond[] = [], highDeco: Diamond[] = [];
  const seen = new Map<Diamond[], Set<string>>();
  const add = (list: Diamond[], d: Diamond) => {
    const k = `${d.x},${d.y}`;
    const set = seen.get(list) ?? new Set<string>();
    seen.set(list, set);
    if (!set.has(k)) { set.add(k); list.push(d); }
  };
  // Lobes behind the core: up and to the back (away from the natural), a corner of the plateau the minerals go into.
  const lobes: { u: number; v: number; a: number; b: number }[] = [{ u: 0, v: 0, a, b }];
  const back = 2 + Math.floor(r() * 2);
  lobes.push({ u: -back - 1, v: Math.floor(r() * 3) - 1, a: 2 + Math.floor(r() * 2), b: 3 });
  if (r() < 0.6) lobes.push({ u: -1, v: b, a: 2, b: 1 + Math.floor(r() * 2) });
  const span = 12;
  for (let ddy = -span; ddy <= span; ddy++) {
    for (let ddx = -span; ddx <= span; ddx++) {
      if (((ddx + ddy) & 1) !== 0) continue;
      const u = (ddx + ddy) / 2, v = (ddx - ddy) / 2;
      if (lobes.some((l) => Math.abs(u - l.u) <= l.a && Math.abs(v - l.v) <= l.b)) add(high, { x: ddx, y: ddy });
      if (Math.abs(u + back) <= 1 && Math.abs(v) <= 1) highDeco.push({ x: ddx, y: ddy });
    }
  }
  // The ramp sits on the core's south-east edge, toward its east corner, which keeps the walk out short.
  const vr = Math.min(b - 2, Math.floor(r() * 3));
  const ramp = { x: a + vr, y: a - vr };
  // The apron below the ramp, and the natural further down the slope.
  for (let du = 2; du <= 4; du++) for (let dv = -2; dv <= 2; dv++) add(locked, { x: a + du + vr + dv, y: a + du - vr - dv });
  const nt = { x: 2 * ramp.x + 11 + Math.floor(r() * 3), y: ramp.y + 5 + Math.floor(r() * 3) };
  const natural = snapDiamond(nt.x, nt.y);
  for (let ddy = -10; ddy <= 10; ddy++) {
    for (let ddx = -6; ddx <= 6; ddx++) {
      if (((ddx + ddy) & 1) !== 0) continue;
      if (Math.hypot(2 * ddx, ddy) <= 9.5) add(locked, { x: natural.x + ddx, y: natural.y + ddy });
    }
  }
  // Between apron and natural: low ground on the line, so nothing stands across the walk.
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const cx = (2 * ramp.x + 4) * (1 - t) + 2 * natural.x * t, cy = (ramp.y + 3) * (1 - t) + natural.y * t;
    for (const d of [snapDiamond(cx, cy), snapDiamond(cx + 2, cy), snapDiamond(cx - 2, cy), snapDiamond(cx, cy + 1), snapDiamond(cx, cy - 1)]) add(locked, d);
  }
  return { high: high.filter((d) => !locked.some((l) => l.x === d.x && l.y === d.y)), locked, highDeco, ramp, foot: { x: ramp.x + 3, y: ramp.y + 3 }, natural };
}

/** One player's complex on the map. */
export interface Complex {
  /** 0-based player slot, or -1 for a base complex left without a player (three players on a four-way map). */
  owner: number;
  /** +1 when the natural lies to the right of the main, -1 to the left. */
  sx: number;
  main: Diamond;
  natural: Diamond;
  ramp: Diamond;
  /** The middle of the apron below the ramp; the symmetry's images of one point. */
  foot: Diamond;
}

/** A free base: low ground with resources and no player. */
export interface FreeBase { at: Diamond }

/** An obstacle in the middle, as a test of a tile position; laid down at every image of its own position. */
interface Obstacle { kind: "mesa" | "lake" | "patch"; contains(x: number, y: number): boolean }

/* ── The plan ─────────────────────────────────────────────── */

export interface Plan {
  options: GenerateOptions;
  mode: SymmetryMode;
  lattice: Lattice;
  complexes: Complex[];
  free: FreeBase[];
  /** For each element of the symmetry, which complex each complex's natural lands on: the pairs that should match. */
  images: number[][];
}

type PointMap = (x: number, y: number) => { x: number; y: number };

/** The group of a mode as maps of tile positions, the identity first, with each map's inverse. */
function groupOf(mode: SymmetryMode, w: number, h: number): { map: PointMap; inverse: PointMap }[] {
  const images = symmetryImages(mode, w, h);
  const id: PointMap = (x, y) => ({ x, y });
  const out = [{ map: id, inverse: id }];
  for (const img of images) {
    // Every element is its own inverse but the quarter turns, which are each other's.
    const inv = mode === "rot90" && img.element !== 2 ? images.find((o) => o.element === 4 - img.element)!.map : img.map;
    out.push({ map: img.map, inverse: inv });
  }
  return out;
}

/**
 * The naturals of the fundamental region, in tiles, for a player count and mode; their images are every player's. A
 * main stands `off` up and outward of its natural, so the corner ones are pushed in far enough for the main to fit,
 * and kept on the corner's diagonal so a quarter turn takes one onto the next.
 */
function fundamentalNaturals(players: number, mode: SymmetryMode, w: number, h: number, off: { x: number; y: number }): { x: number; y: number }[] {
  const kx = off.x + 20, ky = off.y + 18;
  switch (mode) {
    case "h": return players === 6 ? [{ x: kx, y: ky }, { x: kx, y: h / 2 + 4 }, { x: kx, y: h - 18 }] : [{ x: kx, y: h / 2 + 4 }];
    case "v": return players === 6 ? [{ x: kx, y: ky }, { x: kx + 56, y: ky }, { x: w - kx, y: ky }] : [{ x: w / 2 - 8, y: ky }];
    case "rot180": return players === 6 ? [{ x: kx, y: ky }, { x: kx, y: h / 2 + 4 }, { x: w / 2 + 12, y: ky }] : [{ x: kx, y: ky }];
    // The diagonal swaps the axes, so the natural sits on the corner's diagonal for its image to have room too.
    case "diag": { const k = Math.max(kx, ky); return [{ x: w - k, y: k }]; }
    default: return players === 8 ? [{ x: kx, y: ky }, { x: kx, y: h / 2 - Math.round(h / 10) }] : [{ x: kx, y: ky }];
  }
}

/** A plan for one inner seed: the lattice classes and the bases. Pure; the same options and seed give the same plan. */
export function planMap(o: GenerateOptions, seed: number): Plan {
  const resolved = resolveSymmetry(o.players, o.symmetry, o.width, o.height);
  if ("problem" in resolved) throw new Error(resolved.problem);
  const { mode } = resolved;
  const r = rng(seed);
  const W = o.width, H = o.height;
  const L = new Lattice(W, H);
  const group = groupOf(mode, W, H);
  const template = makeTemplate(r);

  // Naturals: the fundamental ones and their images, one per player, in an order that puts player 2 across from 1.
  // Where the complexes go. The layout is drawn as naturals (`fundamentalNaturals`), but what the symmetry places is the
  // foot of each ramp: every walk out of a main leaves by its ramp, so with the feet at exact images the walks from the
  // mains to anything else match, though the complexes do not turn (a ramp only ever faces south).
  const feet: { x: number; y: number }[] = [];
  for (const f of fundamentalNaturals(o.players, mode, W, H, { x: 2 * template.natural.x, y: template.natural.y })) {
    const n = snapDiamond(f.x, f.y);
    const sx = 2 * n.x < W / 2 ? 1 : -1;
    // Snapped to the lattice before it is mapped, so a mirror's image is the mirrored diamond exactly.
    const at = { x: n.x - sx * (template.natural.x - template.foot.x), y: n.y - (template.natural.y - template.foot.y) };
    for (const g of group) {
      const p = g.map(2 * at.x, at.y);
      if (!feet.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 4)) feet.push(p);
    }
  }
  // Group images come as the identity, then each image in turn; reorder each four so player 2 is across from player 1.
  const order = feet.map((_, i) => i);
  for (let k = 0; k + 4 <= order.length && (mode === "rot90" || mode === "hv"); k += 4) {
    order.splice(k, 4, ...(mode === "rot90" ? [k, k + 2, k + 1, k + 3] : [k, k + 3, k + 1, k + 2]));
  }
  const complexes: Complex[] = order.map((i, slot) => {
    const f = feet[i];
    const sx = f.x < W / 2 || (f.x === W / 2 && f.y < H / 2) ? 1 : -1;
    const foot = snapDiamond(f.x, f.y);
    const main = { x: foot.x - sx * template.foot.x, y: foot.y - template.foot.y };
    const at = (d: Diamond) => ({ x: main.x + sx * d.x, y: main.y + d.y });
    return { owner: slot < o.players ? slot : -1, sx, main, natural: at(template.natural), ramp: at(template.ramp), foot };
  });
  const images = group.map((g) => complexes.map((c) => {
    const p = g.map(2 * c.foot.x, c.foot.y);
    let best = 0;
    complexes.forEach((d, j) => { if (Math.hypot(2 * d.foot.x - p.x, d.foot.y - p.y) < Math.hypot(2 * complexes[best].foot.x - p.x, complexes[best].foot.y - p.y)) best = j; });
    return best;
  }));

  // Lay the complexes down: plateau, aprons and naturals.
  const place = (c: Complex, d: Diamond) => ({ x: c.main.x + c.sx * d.x, y: c.main.y + d.y });
  for (const c of complexes) {
    for (const d of template.high) { const p = place(c, d); if (L.in(p.x, p.y)) { L.cls[L.at(p.x, p.y)] = HIGH; L.complex[L.at(p.x, p.y)] = 1; } }
  }
  for (const c of complexes) {
    for (const d of template.locked) { const p = place(c, d); if (L.in(p.x, p.y)) { L.cls[L.at(p.x, p.y)] = LOW; L.locked[L.at(p.x, p.y)] = 1; L.complex[L.at(p.x, p.y)] = 1; } }
    if (recipeOf(o.tileset).decoBuilds) for (const d of template.highDeco) { const p = place(c, d); if (L.in(p.x, p.y)) L.deco[L.at(p.x, p.y)] = 1; }
  }
  // What the middle may not cover: the complexes and a margin round them.
  const taken = L.distance((i) => L.cls[i] === HIGH || L.locked[i] === 1, 3);

  // Free bases: candidates at the images of a few points, kept where every image is clear of everything else.
  const free: FreeBase[] = [];
  const freeCands = [
    // None against the sides: a bottom player's main stands above its ramp, between it and anything up the side, so
    // the walk there would be longer for the bottom players than for the top ones.
    { x: W / 2, y: 18 }, { x: W - 20, y: 20 }, { x: W * 0.36, y: H * 0.5 }, { x: W * 0.5, y: H * 0.3 }, { x: W * 0.36, y: H * 0.36 },
  ];
  const freeAt: Diamond[] = [];
  for (const f of freeCands) {
    const at = snapDiamond(f.x, f.y);
    // A point on an axis is its own image (give or take the lattice under the diagonal): one base, not two side by side.
    const apart = (a: Diamond, b: Diamond) => Math.hypot(2 * (a.x - b.x), a.y - b.y);
    const images = group.map((g) => { const p = g.map(2 * at.x, at.y); return snapDiamond(p.x, p.y); }).filter((d, i, all) => all.findIndex((e) => apart(d, e) < 8) === i);
    if (images.some((d, i) => images.some((e, j) => j > i && apart(d, e) < 30))) continue;
    const clear = images.every((d) => {
      if (!L.in(d.x, d.y)) return false;
      for (const q of L.all()) {
        if (Math.hypot(2 * (q.x - d.x), q.y - d.y) > 12) continue;
        if (taken[L.at(q.x, q.y)] <= 3) return false;
      }
      return [...freeAt].every((e) => Math.hypot(2 * (e.x - d.x), e.y - d.y) > 30) && 2 * d.x >= 10 && 2 * d.x <= W - 10 && d.y >= 9 && d.y <= H - 9;
    });
    if (!clear) continue;
    for (const d of images) { freeAt.push(d); free.push({ at: d }); }
  }
  // Three players on a four-way layout: the fourth complex stays, without a start, as a base anyone may take.
  for (const d of freeAt) {
    for (const q of L.all()) {
      if (Math.hypot(2 * (q.x - d.x), q.y - d.y) <= 8.5) { L.cls[L.at(q.x, q.y)] = LOW; L.locked[L.at(q.x, q.y)] = 1; }
    }
  }

  // Paths that stay open: from every natural toward the middle.
  const lanes: { x: number; y: number }[][] = complexes.map((c) => [{ x: 2 * c.natural.x, y: c.natural.y }, { x: W / 2, y: H / 2 }]);
  const nearLane = (x: number, y: number, width: number) => lanes.some(([p, q]) => {
    const dx = q.x - p.x, dy = q.y - p.y, len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / len));
    return Math.hypot(x - p.x - t * dx, y - p.y - t * dy) < width;
  });

  // Obstacles: drawn in the fundamental region, each kept only when all its images stay off the bases and off what
  // is already there, then laid into the lattice at once so the next one sees it.
  const recipe = recipeOf(o.tileset);
  const area = (W * H) / (128 * 128);
  const per = (n: number) => Math.max(1, Math.round((n * area) / group.length));
  const want = o.style === "chokes"
    ? { mesa: per(10), lake: recipe.water === null ? 0 : per(4), patch: per(4) }
    : { mesa: per(6), lake: recipe.water === null ? 0 : per(3), patch: per(6) };
  const got = { mesa: 0, lake: 0, patch: 0 };
  const mesa = (cx: number, cy: number, a: number, b: number): Obstacle => ({ kind: "mesa", contains: (x, y) => inIsoRect((x - cx) / 2, y - cy, a, b) });
  const lake = (cx: number, cy: number, rx: number, ry: number): Obstacle => ({ kind: "lake", contains: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 });
  const patch = (cx: number, cy: number, rx: number, ry: number): Obstacle => ({ kind: "patch", contains: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 });
  const imaged = (ob: Obstacle): Obstacle => ({ kind: ob.kind, contains: (x, y) => group.some((g) => { const p = g.inverse(x, y); return ob.contains(p.x, p.y); }) });
  let nearHigh = L.distance((i) => L.cls[i] === HIGH || L.locked[i] === 1, 4);
  let nearWater = L.distance((i) => L.cls[i] === WATER, 4);
  /** Lay an obstacle (all its images) when it fits: `margin` steps from the bases and the high ground, more from water. */
  const lay = (ob: Obstacle, laneWidth: number): boolean => {
    const all = imaged(ob);
    const cells: number[] = [];
    for (const d of L.all()) {
      const x = 2 * d.x, y = d.y;
      if (!all.contains(x, y)) continue;
      const i = L.at(d.x, d.y);
      if (ob.kind !== "patch") {
        if (L.cls[i] !== LOW || L.locked[i]) return false;
        if (ob.kind === "mesa" ? nearHigh[i] < 4 || nearWater[i] < 4 : nearHigh[i] < 4 || nearWater[i] < 4) return false;
        if (laneWidth > 0 && nearLane(x, y, laneWidth)) return false;
        if (x < 4 || y < 3 || x > W - 4 || y > H - 3) return false;
      }
      cells.push(i);
    }
    if (cells.length === 0) return false;
    for (const i of cells) {
      if (ob.kind === "mesa") L.cls[i] = HIGH;
      else if (ob.kind === "lake") L.cls[i] = WATER;
      else if (L.cls[i] === LOW && !L.locked[i]) L.deco[i] = 1;
    }
    got[ob.kind]++;
    nearHigh = L.distance((i) => L.cls[i] === HIGH || L.locked[i] === 1, 4);
    nearWater = L.distance((i) => L.cls[i] === WATER, 4);
    return true;
  };
  const lane = o.style === "chokes" ? 4 : 7;
  // A centre piece for the maps that turn: a mesa or a lake on the centre point, the same under every image.
  if (mode !== "h" && mode !== "v" && r() < 0.7) {
    const cd = snapDiamond(W / 2, H / 2);
    lay(recipe.water !== null && r() < 0.5 ? lake(2 * cd.x, cd.y, 8 + r() * 4, 5 + r() * 2) : mesa(2 * cd.x, cd.y, 1 + Math.floor(r() * 2), 1 + Math.floor(r() * 2)), 0);
  }
  // Chokes: two mesas either side of each natural's way out, which leaves a gap a few units wide.
  if (o.style === "chokes") {
    const c = complexes[0];
    const nx = 2 * c.natural.x, ny = c.natural.y;
    const dx = W / 2 - nx, dy = H / 2 - ny, len = Math.hypot(dx, dy) || 1;
    const along = 16 + r() * 3, side = 8 + r() * 2;
    for (const s of [-1, 1]) {
      const d = snapDiamond(nx + (dx / len) * along - (dy / len) * side * s, ny + (dy / len) * along + (dx / len) * side * s);
      lay(mesa(2 * d.x, d.y, 1 + Math.floor(r() * 2), 1 + Math.floor(r() * 2)), 0);
    }
  }
  for (let k = 0; k < 80 && (got.mesa < want.mesa || got.lake < want.lake || got.patch < want.patch); k++) {
    const d = snapDiamond(8 + r() * (W - 16), 6 + r() * (H - 12));
    const roll = r();
    const kind = roll < 0.45 ? "mesa" : roll < 0.75 ? "lake" : "patch";
    if (got[kind] >= want[kind]) continue;
    if (kind === "mesa") lay(mesa(2 * d.x, d.y, 1 + Math.floor(r() * 3), 1 + Math.floor(r() * 2)), lane);
    else if (kind === "lake") lay(lake(2 * d.x, d.y, 7 + r() * 6, 4 + r() * 3), lane);
    else lay(patch(2 * d.x, d.y, 6 + r() * 8, 4 + r() * 4), 0);
  }
  settle(L);
  return { options: o, mode, lattice: L, complexes, free, images };
}

/** The eight around a diamond as lattice directions (u south-east, v north-east): the edges are steps, the corners diagonals. */
const RING: readonly { dx: number; dy: number; u: number; v: number }[] = [
  [-1, -1], [1, -1], [1, 1], [-1, 1], [-2, 0], [2, 0], [0, -2], [0, 2],
].map(([dx, dy]) => ({ dx, dy, u: (dx + dy) / 2, v: (dx - dy) / 2 }));

/**
 * Whether a diamond lies between two diamonds `is` accepts that face each other across it — more than 120° apart on
 * the lattice. No tile joins the two transitions such a diamond would have to be at once, so it is filled instead.
 */
function squeezed(L: Lattice, d: Diamond, is: (i: number) => boolean): boolean {
  const hits = RING.filter((n) => L.in(d.x + n.dx, d.y + n.dy) && is(L.at(d.x + n.dx, d.y + n.dy)));
  for (let a = 0; a < hits.length; a++) {
    for (let b = a + 1; b < hits.length; b++) {
      const p = hits[a], q = hits[b];
      if ((p.u * q.u + p.v * q.v) / (Math.hypot(p.u, p.v) * Math.hypot(q.u, q.v)) < -0.5) return true;
    }
  }
  return false;
}

/**
 * Make the classes paintable: no high spur a diamond wide, no low gap a diamond wide between high ground, water kept
 * four steps from high ground and three from a base, and the second looks only where a level has room around them.
 * Every rule looks at a diamond's neighbours alone, so a symmetric plan stays symmetric.
 */
export function settle(L: Lattice): void {
  for (let round = 0; round < 12; round++) {
    let changed = false;
    const next = new Uint8Array(L.cls);
    for (const d of L.all()) {
      const i = L.at(d.x, d.y);
      const c = L.cls[i];
      const edges = L.edges(d.x, d.y).map((n) => L.cls[L.at(n.x, n.y)]);
      const same = (k: number) => edges.filter((e) => e === k).length;
      if (c === HIGH && same(HIGH) < 2) next[i] = LOW;
      else if (c === WATER && same(WATER) < 2) next[i] = LOW;
      else if (c === LOW && !L.locked[i]) {
        for (const k of [HIGH, WATER]) {
          if (!(same(k) >= 3 || squeezed(L, d, (j) => L.cls[j] === k))) continue;
          next[i] = k;
          // Filled between a corner and something across: the diamond would be a spur on its own and go again next
          // round, so the two diamonds between it and the corner come with it.
          if (same(k) >= 2) continue;
          for (const [cx, cy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
            if (!L.in(d.x + cx, d.y + cy) || L.cls[L.at(d.x + cx, d.y + cy)] !== k) continue;
            const between = cx !== 0 ? [[cx / 2, -1], [cx / 2, 1]] : [[-1, cy / 2], [1, cy / 2]];
            for (const [bx, by] of between) {
              const j = L.in(d.x + bx, d.y + by) ? L.at(d.x + bx, d.y + by) : -1;
              if (j >= 0 && L.cls[j] === LOW && !L.locked[j]) next[j] = k;
            }
          }
        }
      }
      if (next[i] !== c) changed = true;
    }
    L.cls.set(next);
    const nearHigh = L.distance((i) => L.cls[i] === HIGH, 4);
    const nearBase = L.distance((i) => L.locked[i] === 1, 3);
    for (const d of L.all()) {
      const i = L.at(d.x, d.y);
      if (L.cls[i] === WATER && (nearHigh[i] < 4 || nearBase[i] < 3)) { L.cls[i] = LOW; changed = true; }
    }
    if (!changed) break;
  }
  // Should the rules above not have settled, spurs go for good: a squeeze left over is caught as a hole when the ground
  // is laid, and that layout is thrown away.
  for (let round = 0; round < 12; round++) {
    let changed = false;
    for (const d of L.all()) {
      const i = L.at(d.x, d.y);
      if ((L.cls[i] === HIGH || L.cls[i] === WATER) && L.edges(d.x, d.y).filter((n) => L.cls[L.at(n.x, n.y)] === L.cls[i]).length < 2) { L.cls[i] = LOW; changed = true; }
    }
    if (!changed) break;
  }
  // The second looks: a diamond keeps one only with three steps of its own level all round, and the patches are
  // smoothed by the same rules as the levels (no spur, no gap a diamond wide), or the brush has no tile for a neck.
  const notLow = L.distance((i) => L.cls[i] !== LOW, 3);
  const notHigh = L.distance((i) => L.cls[i] !== HIGH, 3);
  const room = (i: number) => (L.cls[i] === LOW ? notLow[i] >= 3 && L.locked[i] === 0 : L.cls[i] === HIGH ? notHigh[i] >= 3 : false);
  for (const d of L.all()) { const i = L.at(d.x, d.y); if (L.deco[i] && !room(i)) L.deco[i] = 0; }
  for (let round = 0; round < 12; round++) {
    const next = new Uint8Array(L.deco);
    for (const d of L.all()) {
      const i = L.at(d.x, d.y);
      const at = (dx: number, dy: number) => (L.in(d.x + dx, d.y + dy) && L.deco[L.at(d.x + dx, d.y + dy)] === 1 && L.cls[L.at(d.x + dx, d.y + dy)] === L.cls[i]);
      const edges = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)].filter(Boolean).length;
      if (L.deco[i]) { if (edges < 2) next[i] = 0; continue; }
      if ((edges >= 3 || squeezed(L, d, (j) => L.deco[j] === 1 && L.cls[j] === L.cls[i])) && room(i)) next[i] = 1;
    }
    const same = next.every((v, i) => v === L.deco[i]);
    L.deco.set(next);
    if (same) break;
  }
}

/* ── The ground ───────────────────────────────────────────── */

export interface Graphics {
  tileset: Tileset;
  doodads: DoodadCatalogue;
}

export interface PlacedBase {
  kind: "main" | "natural" | "free";
  /** The player whose base it is, or -1. */
  owner: number;
  hall: TileRect;
  minerals: number;
  mineralTotal: number;
  geysers: number;
  gasTotal: number;
}

export interface Built {
  scenario: Scenario;
  bases: PlacedBase[];
  /** Start locations by player, in pixels. */
  starts: { owner: number; x: number; y: number }[];
  ramps: { owner: number; doodad: number; x: number; y: number }[];
}

/** A base's player for a message. */
const whose = (owner: number) => (owner >= 0 ? `player ${owner + 1}` : "a base without a player");

/** Why a layout was thrown away; with the map as far as it got, for a look at what went wrong. */
export class LayoutError extends Error {
  readonly scenario?: Scenario;
  constructor(message: string, scenario?: Scenario) { super(message); this.scenario = scenario; }
}

const STRAIGHT_WALK = 5, DIAGONAL_WALK = 7;

/**
 * Lay the plan's ground with the tileset, place the ramps, the start locations and the resources. Throws `LayoutError`
 * when the plan cannot be laid out (the brush left a gap, no ramp fits a main, a base has no room).
 */
export function buildScenario(plan: Plan, g: Graphics, seed: number, name: string, description: string): Built {
  const ground = layGround(plan, g, seed, name, description);
  return placeBases(plan, g, ground);
}

/** The terrain and the ramps, laid; what `placeBases` puts the bases on. */
export interface Ground { scenario: Scenario; ramps: Built["ramps"]; rampBoxes: TileRect[] }

export function layGround(plan: Plan, g: Graphics, seed: number, name: string, description: string): Ground {
  const { options: o, lattice: L } = plan;
  const era = Math.max(0, TILESETS.findIndex((t) => t.id === o.tileset));
  const recipe = recipeOf(o.tileset);
  const r = rng(seed ^ 0x5bd1e995);
  const { tiles, isom } = flatTerrain(o.width, o.height, baseTerrain(g.tileset, recipe.low), g.tileset, r, era);
  const scn = createScenario({ width: o.width, height: o.height, era, name, description, tiles, isom });
  if (!hasIsom(scn)) throw new LayoutError("the new map has no ISOM section");
  isomTables(g.tileset, era);

  const pick = (test: (i: number) => boolean) => [...L.all()].filter((d) => test(L.at(d.x, d.y)));
  const strokes: [number | null, Diamond[]][] = [
    [recipe.water, pick((i) => L.cls[i] === WATER)],
    [recipe.high, pick((i) => L.cls[i] === HIGH)],
    [recipe.lowDeco, pick((i) => L.cls[i] === LOW && L.deco[i] === 1)],
    [recipe.highDeco, pick((i) => L.cls[i] === HIGH && L.deco[i] === 1)],
  ];
  for (const [terrain, diamonds] of strokes) {
    if (terrain === null || diamonds.length === 0) continue;
    if (!paintIsomDiamonds(scn, g.tileset, diamonds, terrain, r)) throw new LayoutError(`the tileset has no isometric terrain ${terrain}`, scn);
  }
  // A rect whose links name no tile group comes out as tile 0: the brush could not join the ground there.
  const holes = scn.tiles.reduce<number[]>((list, t, i) => (t === 0 ? [...list, i] : list), []);
  if (holes.length > 0) throw new LayoutError(`${holes.length} tiles the brush could not join (the first at ${holes[0] % o.width}, ${Math.floor(holes[0] / o.width)})`, scn);
  if (checkIsom(scn, g.tileset).mismatched > 0) throw new LayoutError("the lattice does not describe the tiles", scn);

  // Ramps: the tileset's ramp doodads between the two levels, at the place nearest each complex's ramp diamond.
  const { groups } = g.tileset;
  // A ramp drawn for this cliff: it needs the cliff under it (StarEdit's own rule then says where it fits).
  const ramps = g.doodads.doodads.filter((d) => d.ramp && [...d.required].some((x) => x !== 0 && groups[x]?.index === recipe.cliff));
  if (ramps.length === 0) throw new LayoutError(`${TILESETS[era].name} has no ramp between its two levels`, scn);
  // The tileset's own ramps come first, the ones every version of the game has: the first run of ids (a gap of more than
  // 20 ends it). Remastered adds narrow cliff pieces with the ramp bit much later in the table, which StarEdit's rule
  // takes at a ramp's place but the game does not always walk (2 × 5 pieces left a main walled off in Remastered's own
  // pathing while ours walked it), so they are only tried when no ramp of the first run fits.
  ramps.sort((a, b) => a.id - b.id);
  const firstRun = new Set<number>();
  for (const [k, d] of ramps.entries()) { if (k > 0 && d.id - ramps[k - 1].id > 20) break; firstRun.add(d.id); }
  const placedRamps: Built["ramps"] = [];
  const rampBoxes: TileRect[] = [];
  for (const c of plan.complexes) {
    // The diamond is the last high one; its centre is tile (2x, y) and the cliff runs below and to the facing side.
    const ax = 2 * c.ramp.x + c.sx * 2, ay = c.ramp.y + 1;
    const fits: { def: DoodadDef; x: number; y: number; d: number }[] = [];
    for (const def of ramps) {
      for (let ty = Math.floor(ay - 8); ty <= ay + 4; ty++) {
        for (let tx = Math.floor((ax - 10) / 2) * 2; tx <= ax + 6; tx += 2) {
          const d = Math.hypot(tx + def.width / 2 - ax, ty + def.height / 2 - ay);
          if (d > 7 || !checkDoodadPlacement(scn, g.tileset, def, tx, ty, DEFAULT_DOODAD_PLACEMENT).ok) continue;
          fits.push({ def, x: tx, y: ty, d });
        }
      }
    }
    const rank = (f: (typeof fits)[number]) => (firstRun.has(f.def.id) ? 0 : 1);
    fits.sort((p, q) => rank(p) - rank(q) || p.d - q.d || p.def.id - q.def.id || p.y - q.y || p.x - q.x);
    // StarEdit's rule says where a ramp may go, not that a unit can walk it, so each is tried in that order and kept
    // when it joins the plateau to the ground below.
    const top = { x: (2 * c.ramp.x - c.sx * 3) * 32 + 16, y: (c.ramp.y - 1) * 32 + 16 };
    const foot = { x: (2 * c.ramp.x + c.sx * 6) * 32 + 16, y: (c.ramp.y + 3) * 32 + 16 };
    let kept: (typeof fits)[number] | null = null;
    for (const f of fits.slice(0, 40)) {
      const edit = placeDoodad(scn, f.def, f.x, f.y, NEUTRAL);
      applyChanges(scn, edit.tiles, "do", "mtxm");
      if (walksBetween(scn, g.tileset, top, foot)) {
        applyDoodadChanges(scn, edit.doodads);
        placedRamps.push({ owner: c.owner, doodad: f.def.id, x: edit.doodads[0].after!.x, y: edit.doodads[0].after!.y });
        rampBoxes.push({ x: f.x, y: f.y, w: f.def.width, h: f.def.height });
        kept = f;
        break;
      }
      applyChanges(scn, edit.tiles, "undo", "mtxm");
    }
    if (!kept) throw new LayoutError(`no ramp fits the main of ${whose(c.owner)}`, scn);
  }

  return { scenario: scn, ramps: placedRamps, rampBoxes };
}

/** Start locations, resources and the player slots, on ground `layGround` laid. */
export function placeBases(plan: Plan, g: Graphics, ground: Ground): Built {
  const { options: o } = plan;
  const { scenario: scn, ramps: placedRamps, rampBoxes } = ground;
  const { groups } = g.tileset;
  const recipe = recipeOf(o.tileset);
  /** The height the game gives a terrain's flat ground (Jungle's High Dirt is the middle level, Space Platform's the top). */
  const heightOf = (terrain: number) => {
    const group = groups.findIndex((gr, i) => i % 2 === 0 && gr.index === terrain);
    const mega = group < 0 ? -1 : groups[group].megatiles.find((m) => m > 0) ?? -1;
    return mega < 0 ? -1 : megatileHeight(g.tileset, mega);
  };
  const levels = { low: heightOf(recipe.low), high: heightOf(recipe.high) };
  // Ground a building may stand on, at a level: buildable, all walkable, the level's height, not a ramp.
  const level = (tx: number, ty: number): number => {
    if (tx < 0 || ty < 0 || tx >= o.width || ty >= o.height) return -1;
    const id = scn.tiles[ty * o.width + tx];
    const group = groups[id >> 4];
    const mega = megatileForTile(g.tileset, id);
    if (!group || mega < 0 || !groupBuildable(group)) return -1;
    for (let m = 0; m < 16; m++) {
      const f = g.tileset.megatileFlags[mega * 16 + m] ?? 0;
      if (!(f & TileFlag.Walkable) || f & TileFlag.Ramp) return -1;
    }
    return megatileHeight(g.tileset, mega);
  };
  const used: TileRect[] = [];
  const clearOf = (rect: TileRect, gap: number) => used.every((u) => chebGap(u, rect) >= gap) && rampBoxes.every((b) => chebGap(b, rect) >= 3);
  const flat = (rect: TileRect, h: number) => {
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) if (level(x, y) !== h) return false;
    return true;
  };
  /** The hall position nearest a point that has its level all round, with a tile of it to spare. */
  const hallNear = (px: number, py: number, h: number): TileRect | null => {
    let best: TileRect | null = null, bestD = Infinity;
    for (let y = Math.round(py) - 6; y <= Math.round(py) + 6; y++) {
      for (let x = Math.round(px) - 8; x <= Math.round(px) + 8; x++) {
        const rect = { x: x - 2, y: y - 1, w: HALL.w, h: HALL.h };
        const d = Math.hypot(x - px, y - py + 0.5);
        if (d >= bestD) continue;
        if (!flat({ x: rect.x - 1, y: rect.y - 1, w: rect.w + 2, h: rect.h + 2 }, h) || !clearOf(rect, 4)) continue;
        best = rect; bestD = d;
      }
    }
    return best;
  };

  const bases: PlacedBase[] = [];
  const units: { unitId: number; owner: number; x: number; y: number; amount: number }[] = [];
  const starts: Built["starts"] = [];
  const centre = { x: o.width / 2, y: o.height / 2 };
  const layBase = (kind: PlacedBase["kind"], owner: number, hall: TileRect, h: number, minerals: number, direction: number) => {
    used.push(hall);
    const fitsRes = (rect: TileRect) => flat(rect, h) && clearOf(rect, 1) && rampBoxes.every((b) => chebGap(b, rect) >= 3);
    const layout = layoutBase(hall, { minerals, geysers: 1, direction, fits: fitsRes });
    if (layout.short.minerals > 0 || layout.short.geysers > 0) {
      throw new LayoutError(`the ${kind} of ${whose(owner)} has room for ${layout.minerals.length} of ${minerals} mineral fields`, scn);
    }
    const looks = mineralLooks(layout.minerals);
    layout.minerals.forEach((m, k) => { used.push(m); const c = centreOf(m); units.push({ unitId: looks[k], owner: NEUTRAL, x: c.x, y: c.y, amount: MINERAL_AMOUNT }); });
    for (const gz of layout.geysers) { used.push(gz); const c = centreOf(gz); units.push({ unitId: 188, owner: NEUTRAL, x: c.x, y: c.y, amount: DEFAULT_GAS }); }
    bases.push({ kind, owner, hall, minerals: layout.minerals.length, mineralTotal: layout.minerals.length * MINERAL_AMOUNT, geysers: layout.geysers.length, gasTotal: layout.geysers.length * DEFAULT_GAS });
  };

  for (const c of plan.complexes) {
    const mx = 2 * c.main.x, my = c.main.y;
    const highLevel = levels.high;
    const hall = hallNear(mx, my, highLevel);
    if (!hall) throw new LayoutError(`no room for a town hall in the main of ${whose(c.owner)}`, scn);
    // The mineral line goes behind the hall, away from the ramp.
    const rx = 2 * c.ramp.x, ry = c.ramp.y;
    const hc = centreOf(hall);
    layBase("main", c.owner, hall, highLevel, MAIN_MINERALS, Math.atan2(hc.y / TILE - ry, hc.x / TILE - rx));
    if (c.owner >= 0) starts.push({ owner: c.owner, ...hc });
  }
  for (const c of plan.complexes) {
    const nx = 2 * c.natural.x, ny = c.natural.y;
    const lowLevel = levels.low;
    const hall = hallNear(nx, ny, lowLevel);
    if (!hall) throw new LayoutError(`no room for a town hall at the natural of ${whose(c.owner)}`, scn);
    // Away from both the way up the ramp and the way to the middle: the line stays off every walk.
    const toRamp = Math.atan2(c.ramp.y + 2 - ny, 2 * c.ramp.x + c.sx * 4 - nx);
    const toMiddle = Math.atan2(centre.y - ny, centre.x - nx);
    const outward = Math.atan2(ny - centre.y, nx - centre.x);
    let best = 0, bestScore = -Infinity;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 - Math.PI;
      const off = (b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
      const score = Math.min(off(toRamp), off(toMiddle)) * 2 - off(outward) * 0.3;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    layBase("natural", c.owner, hall, lowLevel, NATURAL_MINERALS, best);
  }
  for (const f of plan.free) {
    const fx = 2 * f.at.x, fy = f.at.y;
    const lowLevel = levels.low;
    const hall = hallNear(fx, fy, lowLevel);
    if (!hall) throw new LayoutError("no room for a town hall at a free base", scn);
    let dir = Math.atan2(fy - centre.y, fx - centre.x);
    if (Math.abs(fx - centre.x) < 2 && Math.abs(fy - centre.y) < 2) dir = -Math.PI / 2;
    layBase("free", -1, hall, lowLevel, FREE_MINERALS, dir);
  }

  // Start locations first, then the resources in the order they were laid.
  const records = [
    ...starts.map((s, k) => makeUnit(null, START_LOCATION, s.owner, s.x, s.y, k)),
    ...units.map((u, k) => ({ ...makeUnit(null, u.unitId, u.owner, u.x, u.y, starts.length + k), resourceAmount: u.amount })),
  ];
  applyUnitChanges(scn, addUnits(scn, records));
  const settings = readPlayerSettings(scn);
  for (let slot = 0; slot < 8; slot++) if (slot >= o.players) settings.types[slot] = PlayerType.Inactive;
  applyPlayerSettings(scn, settings);
  markDirty(scn, "UNIT");
  return { scenario: scn, bases, starts, ramps: placedRamps };
}

/* ── The checks ───────────────────────────────────────────── */

export interface StartReport {
  owner: number;
  x: number;
  y: number;
  /** The player's own bases: the main and the natural. */
  minerals: number;
  mineralFields: number;
  gas: number;
  geysers: number;
  /** Ground distance in pixels to each other start (by player), null where there is no ground between. */
  ground: (number | null)[];
  /** Straight-line distance in pixels to each other start. */
  air: number[];
  /** Ground distance in pixels to the middle of the map (the walkable ground nearest it). */
  toMiddle: number | null;
  /** Ground distances in pixels to the free bases' town halls, nearest first. */
  toFree: number[];
}

export interface Measure {
  starts: StartReport[];
  /** Every start reaches every other on foot. */
  connected: boolean;
  /** The largest difference between distances that should be equal, as a share of the shorter: the larger of the two below. */
  spread: number;
  /** Start to start: a pair of starts against its image under the symmetry. */
  startSpread: number;
  /** Each start's walks to the free bases, nearest first, against its image's. */
  freeSpread: number;
  /** How many comparisons each is made of (two players have one pair, its own image, so none start to start). */
  compared: { starts: number; free: number };
  issues: Issue[];
}

/**
 * Where a unit can walk, a minitile at a time (8 × 8 pixels): walkable by the tileset's flags with all eight
 * neighbours walkable too (a unit is about two minitiles across), and not under a mineral field or geyser.
 */
export function walkGrid(scn: Scenario, tileset: Tileset, window?: { x0: number; y0: number; x1: number; y1: number }): Uint8Array {
  const W = scn.width * 4, H = scn.height * 4;
  const raw = new Uint8Array(W * H);
  const win = window ?? { x0: 0, y0: 0, x1: scn.width, y1: scn.height };
  for (let ty = win.y0; ty < win.y1; ty++) {
    for (let tx = win.x0; tx < win.x1; tx++) {
      const mega = megatileForTile(tileset, scn.tiles[ty * scn.width + tx]);
      for (let m = 0; m < 16; m++) {
        const f = mega < 0 ? 0 : tileset.megatileFlags[mega * 16 + m] ?? 0;
        if (f & TileFlag.Walkable) raw[(ty * 4 + (m >> 2)) * W + tx * 4 + (m & 3)] = 1;
      }
    }
  }
  for (const u of scn.units) {
    const box = u.unitId === 188 ? GEYSER : u.unitId >= 176 && u.unitId <= 178 ? MINERAL : null;
    if (!box) continue;
    const x0 = Math.round(u.x / 8 - box.w * 2), y0 = Math.round(u.y / 8 - box.h * 2);
    for (let y = y0; y < y0 + box.h * 4; y++) for (let x = x0; x < x0 + box.w * 4; x++) if (x >= 0 && y >= 0 && x < W && y < H) raw[y * W + x] = 0;
  }
  const out = new Uint8Array(W * H);
  for (let y = Math.max(1, win.y0 * 4); y < Math.min(H - 1, win.y1 * 4); y++) {
    for (let x = Math.max(1, win.x0 * 4); x < Math.min(W - 1, win.x1 * 4); x++) {
      let ok = 1;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!raw[(y + dy) * W + x + dx]) { ok = 0; break; }
      out[y * W + x] = ok;
    }
  }
  return out;
}

/** Whether a unit walks from one pixel to another within a window of 24 tiles round them (a ramp's own test). */
export function walksBetween(scn: Scenario, tileset: Tileset, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const grid = walkGrid(scn, tileset, {
    x0: Math.max(0, Math.floor(Math.min(a.x, b.x) / 32) - 12), y0: Math.max(0, Math.floor(Math.min(a.y, b.y) / 32) - 12),
    x1: Math.min(scn.width, Math.ceil(Math.max(a.x, b.x) / 32) + 12), y1: Math.min(scn.height, Math.ceil(Math.max(a.y, b.y) / 32) + 12),
  });
  const dist = groundFrom(grid, scn.width, scn.height, a.x, a.y);
  return groundAt(dist, scn.width, b.x, b.y) !== null;
}

/** Ground distance in pixels from a pixel to every minitile (Dial's algorithm, straight 5, diagonal 7); -1 unreached. */
export function groundFrom(grid: Uint8Array, mapW: number, mapH: number, px: number, py: number): Float64Array {
  const W = mapW * 4, H = mapH * 4;
  const dist = new Int32Array(W * H).fill(-1);
  const out = new Float64Array(W * H).fill(-1);
  // The start's own minitile may be under the hall's footprint edge; begin from the nearest walkable one.
  let sx = Math.floor(px / 8), sy = Math.floor(py / 8);
  if (!grid[sy * W + sx]) {
    let found = false;
    for (let rad = 1; rad < 12 && !found; rad++) {
      for (let dy = -rad; dy <= rad && !found; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const x = sx + dx, y = sy + dy;
        if (x >= 0 && y >= 0 && x < W && y < H && grid[y * W + x]) { sx = x; sy = y; found = true; break; }
      }
    }
    if (!found) return out;
  }
  const buckets: number[][] = [[sy * W + sx]];
  dist[sy * W + sx] = 0;
  for (let d = 0; d < buckets.length; d++) {
    const list = buckets[d];
    if (!list) continue;
    for (const i of list) {
      if (dist[i] !== d) continue;
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (!grid[j]) continue;
          if (dx && dy && (!grid[y * W + nx] || !grid[ny * W + x])) continue;
          const nd = d + (dx && dy ? DIAGONAL_WALK : STRAIGHT_WALK);
          if (dist[j] >= 0 && dist[j] <= nd) continue;
          dist[j] = nd;
          (buckets[nd] ??= []).push(j);
        }
      }
    }
  }
  for (let i = 0; i < dist.length; i++) if (dist[i] >= 0) out[i] = (dist[i] / STRAIGHT_WALK) * 8;
  return out;
}

/** The ground distance at a pixel, from the nearest reached minitile around it (up to `reach` minitiles away). */
function groundAt(dist: Float64Array, mapW: number, px: number, py: number, reach = 12): number | null {
  const W = mapW * 4, H = dist.length / W;
  let best: number | null = null;
  const cx = Math.floor(px / 8), cy = Math.floor(py / 8);
  for (let rad = 0; rad < reach && best === null; rad++) {
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad || cx + dx < 0 || cy + dy < 0 || cx + dx >= W || cy + dy >= H) continue;
      const v = dist[(cy + dy) * W + cx + dx];
      if (v !== undefined && v >= 0 && (best === null || v < best)) best = v;
    }
  }
  return best;
}

/** The checks of a built map: Check Map, the walks between starts, and what each player owns. */
export function measureMap(built: Built, plan: Plan, tileset: Tileset): Measure {
  const scn = built.scenario;
  const grid = walkGrid(scn, tileset);
  const fields = built.starts.map((s) => groundFrom(grid, scn.width, scn.height, s.x, s.y));
  const starts: StartReport[] = built.starts.map((s, i) => {
    const own = built.bases.filter((b) => b.owner === s.owner && b.kind !== "free");
    return {
      owner: s.owner, x: s.x, y: s.y,
      minerals: own.reduce((t, b) => t + b.mineralTotal, 0), mineralFields: own.reduce((t, b) => t + b.minerals, 0),
      gas: own.reduce((t, b) => t + b.gasTotal, 0), geysers: own.reduce((t, b) => t + b.geysers, 0),
      ground: built.starts.map((o) => (o === s ? 0 : groundAt(fields[i], scn.width, o.x, o.y))),
      air: built.starts.map((o) => Math.hypot(o.x - s.x, o.y - s.y)),
      toMiddle: groundAt(fields[i], scn.width, scn.width * 16, scn.height * 16, 96),
      toFree: built.bases.filter((b) => b.kind === "free").map((b) => groundAt(fields[i], scn.width, (b.hall.x + 2) * 32, (b.hall.y + 1.5) * 32)).filter((d): d is number => d !== null).sort((a, b) => a - b),
    };
  });
  const connected = starts.every((s) => s.ground.every((d) => d !== null));
  // Pairs the symmetry makes equal: a pair of starts and its image under every element of the symmetry, where both
  // images are starts too (three players on a four-way map leave one complex without a start).
  let startSpread = 0, freeSpread = 0;
  const compared = { starts: 0, free: 0 };
  if (connected) {
    const startOf = (complex: number) => built.starts.findIndex((st) => st.owner === plan.complexes[complex].owner && plan.complexes[complex].owner >= 0);
    const complexOf = (start: number) => plan.complexes.findIndex((c) => c.owner === built.starts[start].owner);
    for (const perm of plan.images) {
      for (let i = 0; i < starts.length; i++) {
        for (let j = i + 1; j < starts.length; j++) {
          const pi = startOf(perm[complexOf(i)]), pj = startOf(perm[complexOf(j)]);
          if (pi < 0 || pj < 0 || pi === pj || (Math.min(pi, pj) === i && Math.max(pi, pj) === j)) continue;
          compared.starts++;
          const a = starts[i].ground[j]!, b = starts[pi].ground[pj]!;
          startSpread = Math.max(startSpread, Math.abs(a - b) / Math.min(a, b));
        }
        // Each start against its image on its own: the walks to the free bases, nearest first. (The walk to the middle
        // is reported but not compared: when a mesa or lake stands on the centre, where "the middle" is depends on the
        // side you come from.)
        const pi = startOf(perm[complexOf(i)]);
        if (pi < 0 || pi === i) continue;
        starts[i].toFree.forEach((a, k) => {
          const b = starts[pi].toFree[k];
          if (b === undefined || Math.min(a, b) <= 0) return;
          compared.free++;
          freeSpread = Math.max(freeSpread, Math.abs(a - b) / Math.min(a, b));
        });
      }
    }
  }
  const issues = validateScenario(scn, { tileset });
  return { starts, connected, spread: Math.max(startSpread, freeSpread), startSpread, freeSpread, compared, issues };
}

/* ── A map from a seed ────────────────────────────────────── */

export interface Generated {
  options: GenerateOptions;
  plan: Plan;
  built: Built;
  measure: Measure;
  /** Which inner seed the map came from (0 = the seed itself), and how many were tried. */
  attempt: number;
  innerSeed: number;
  tried: number;
  /** Why the layouts before it were thrown away. */
  rejected: string[];
}

/**
 * The map for the options: inner seeds tried in turn until a layout passes every check and its equal pairs are within
 * `BALANCE_TOLERANCE`; when none is that close, the closest that passes. Throws `LayoutError` when no layout passes.
 */
export function generateMap(o: GenerateOptions, g: Graphics, name: string, description: string, attempts = ATTEMPTS): Generated {
  let best: Generated | null = null;
  const rejected: string[] = [];
  let tried = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    tried++;
    const seed = innerSeed(o.seed, attempt);
    let plan: Plan, built: Built;
    try {
      plan = planMap(o, seed);
      built = buildScenario(plan, g, seed, name, description);
    } catch (e) {
      if (!(e instanceof LayoutError)) throw e;
      rejected.push(e.message);
      continue;
    }
    const measure = measureMap(built, plan, g.tileset);
    const error = measure.issues.find((i) => i.level === "error");
    if (!measure.connected) { rejected.push("a start location has no ground to another"); continue; }
    if (error) { rejected.push(`Check Map: ${error.text}`); continue; }
    if (!best || measure.spread < best.measure.spread) best = { options: o, plan, built, measure, attempt, innerSeed: seed, tried, rejected: [...rejected] };
    if (measure.spread <= BALANCE_TOLERANCE) break;
  }
  if (!best) throw new LayoutError(`no layout of ${attempts} passed its checks (${[...new Set(rejected)].slice(0, 3).join("; ")})`);
  return { ...best, tried };
}
