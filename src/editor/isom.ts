/**
 * The isometric terrain brush — StarEdit's, as reverse-engineered for Chkdraft
 * (Justin Forsberg, MIT; src/mapping_core/{sc,scenario,chk}.{h,cpp}).
 *
 * The model: a lattice of diamonds, each 4 tiles wide and 2 tall, centred on the
 * corners of the ISOM rect grid (a rect is a 2x1 tile pair; diamond (x, y) is centred
 * on the top-left corner of rect (x, y), so only (x + y) even are diamonds). A diamond
 * has one ISOM value, stored redundantly in the four rects it overlaps — two u16 per
 * rect, `(value << 4) | flags`, the flags saying which quadrant of which diamond the
 * u16 belongs to. `value` is a row of the shape-link table: one row per flat terrain,
 * fourteen per cliff/edge set (one per shape: four edges, four outer and four inner
 * corners, two straights).
 *
 * The shape-link table is derived from the CV5 at load time (`isomTables`): each
 * tile group carries four ISOM links, and the fourteen shape definitions say which
 * link pattern belongs in which quadrant of which shape. Only the terrain-type
 * numbering and the adjacency lists (`data/isomTables.ts`) had to be copied in.
 *
 * Painting (`paintIsom`) sets the brush diamonds to the terrain's value, then walks
 * outward: each neighbouring diamond is re-picked as the table row that agrees with
 * the most of its four neighbours (a terrain that cannot touch the new one becomes
 * the intermediate terrain, which is why the brush bleeds). Finally every touched rect
 * is turned back into tiles by hashing its four links and looking the hash up among
 * the CV5 groups, with cliff faces continued upward along the groups' stack links.
 *
 * Everything here mutates the scenario in place and returns the change lists, in the
 * same `{ at, before, after }` form as the tile brushes so one history entry undoes
 * both `tiles` and `isom`.
 */
import { markDirty, tilesetIndex, type Scenario } from "../formats/chk/scenario";
import type { Cv5Group, Tileset } from "../formats/tileset/decode";
import { pickVariation, variationsOf } from "../formats/tileset/terrain";
import { ISOM_TABLES, type IsomTerrainType } from "../data/isomTables";
import type { TileChange } from "./terrain";

/* ── Links, quadrants and the shape catalogue ───────────── */

/** Links at or below this are "soft": shared with whatever terrain borders the piece. */
const SOFT_LINKS = 48;
/** Hard links pair pieces of the same edge set; the names are Chkdraft's. */
const BL = 49, TR = 50, BR = 51, TL = 52, FR = 53, FL = 54, LH = 55, RH = 56;

/** Link ids at or above `SAME_TYPE_ONLY` only ever match within one terrain type. */
const TRBL_NW = 255, TRBL_SE = 256, TLBR_NE = 257, TLBR_SW = 258;
const SAME_TYPE_ONLY = TRBL_NW;

/** Quadrants of a diamond's 2x2-rect projection, in the order the tables use. */
type Quadrant = 0 | 1 | 2 | 3;
const Q_TL = 0, Q_TR = 1, Q_BR = 2, Q_BL = 3;
const QUADRANTS: readonly Quadrant[] = [0, 1, 2, 3];
const opposite = (q: Quadrant): Quadrant => ((q + 2) & 3) as Quadrant;

/** Rect sides, which is also the u16 order inside an ISOM rect. */
type Side = 0 | 1 | 2 | 3;
const S_LEFT = 0, S_TOP = 1, S_RIGHT = 2, S_BOTTOM = 3;
const SIDE_NAME = ["left", "top", "right", "bottom"] as const;

/**
 * Each quadrant of a diamond covers two sides of one rect. The low nibble of an ISOM
 * u16 says which (quadrant, side) it is; bit 0 is scratch space (see `MODIFIED`).
 */
const PROJECTED: Record<Quadrant, { sides: [Side, Side]; flags: [number, number] }> = {
  0: { sides: [S_RIGHT, S_BOTTOM], flags: [0x0, 0x2] },
  1: { sides: [S_LEFT, S_BOTTOM], flags: [0x4, 0x6] },
  2: { sides: [S_LEFT, S_TOP], flags: [0x8, 0xa] },
  3: { sides: [S_TOP, S_RIGHT], flags: [0xc, 0xe] },
};
const FLAG_MASK = 0xe;

/** Editor scratch bits inside an ISOM u16; never written to disk. */
const MODIFIED = 0x0001;
const VISITED = 0x8000;
const CLEAR_FLAGS = 0x7ffe;

interface Links { left: number; top: number; right: number; bottom: number }

/** One quadrant of a shape-link row: the two links on its rect sides, and its identity. */
interface QuadLinks extends Links { linkId: number }

export interface ShapeLinks {
  /** CV5 `index` of the terrain or edge set this row belongs to; 0 for padding rows. */
  terrainType: number;
  quads: [QuadLinks, QuadLinks, QuadLinks, QuadLinks];
}

function emptyRow(terrainType = 0): ShapeLinks {
  const q = (): QuadLinks => ({ left: 0, top: 0, right: 0, bottom: 0, linkId: 0 });
  return { terrainType, quads: [q(), q(), q(), q()] };
}

/** The link an ISOM u16 stands for: its row's quadrant/side, per the flag nibble. */
function edgeLink(row: ShapeLinks, isomValue: number): number {
  const flags = isomValue & FLAG_MASK;
  const q = (flags >> 2) as Quadrant;
  const side = PROJECTED[q].sides[(flags >> 1) & 1];
  return row.quads[q][SIDE_NAME[side]];
}

interface ShapeQuad extends Links { linkId: number; stackTop: boolean }
type Shape = [ShapeQuad, ShapeQuad, ShapeQuad, ShapeQuad];

const sq = (o: Partial<ShapeQuad> = {}): ShapeQuad => ({ left: 0, top: 0, right: 0, bottom: 0, linkId: 0, stackTop: false, ...o });

const SH_EDGE_NW = 0, SH_EDGE_NE = 1, SH_EDGE_SE = 2, SH_EDGE_SW = 3;
const SH_OUT_N = 4, SH_OUT_E = 5, SH_OUT_S = 6, SH_OUT_W = 7;
const SH_IN_E = 8, SH_IN_W = 9, SH_IN_N = 10, SH_IN_S = 11;
// 12 and 13 are the horizontal and vertical straights; nothing refers to them by number.
const SHAPE_COUNT = 14;

/** Which link pattern sits in which quadrant of each of the fourteen shapes. */
const SHAPES: readonly Shape[] = [
  // edge north-west
  [sq(), sq({ right: BR, bottom: BR, linkId: TRBL_NW, stackTop: true }), sq({ left: BR, top: BR }), sq({ right: BR, bottom: FR, linkId: TRBL_NW, stackTop: true })],
  // edge north-east
  [sq({ left: BL, bottom: BL, linkId: TLBR_NE, stackTop: true }), sq(), sq({ left: BL, bottom: FL, linkId: TLBR_NE, stackTop: true }), sq({ top: BL, right: BL })],
  // edge south-east
  [sq({ right: TL, bottom: TL }), sq({ left: TL, top: FL, linkId: TRBL_SE }), sq(), sq({ left: TL, top: TL, linkId: TRBL_SE })],
  // edge south-west
  [sq({ top: FR, right: TR, linkId: TLBR_SW }), sq({ left: TR, bottom: TR }), sq({ top: TR, right: TR, linkId: TLBR_SW }), sq()],
  // jut out north
  [sq(), sq(), sq({ left: BL, bottom: BL, linkId: TLBR_NE, stackTop: true }), sq({ right: BR, bottom: BR, linkId: TRBL_NW, stackTop: true })],
  // jut out east
  [sq({ left: BL, bottom: FL, linkId: TLBR_NE, stackTop: true }), sq(), sq(), sq({ left: TL, top: FL, linkId: TRBL_SE })],
  // jut out south
  [sq({ top: TR, right: TR, linkId: TLBR_SW }), sq({ left: TL, top: TL, linkId: TRBL_SE }), sq(), sq()],
  // jut out west
  [sq(), sq({ right: BR, bottom: FR, linkId: TRBL_NW, stackTop: true }), sq({ top: FR, right: TR, linkId: TLBR_SW }), sq()],
  // jut in east
  [sq({ top: FR, right: TR, linkId: TLBR_SW }), sq({ left: RH, bottom: RH }), sq({ left: RH, top: RH }), sq({ right: BR, bottom: FR, linkId: TRBL_NW })],
  // jut in west
  [sq({ right: LH, bottom: LH }), sq({ left: TL, top: FL, linkId: TRBL_SE }), sq({ left: BL, bottom: FL, linkId: TLBR_NE }), sq({ top: LH, right: LH })],
  // jut in north
  [sq({ left: BL, bottom: BL, linkId: TLBR_NE, stackTop: true }), sq({ right: BR, bottom: BR, linkId: TRBL_NW, stackTop: true }), sq({ left: BR, top: BR }), sq({ top: BL, right: BL })],
  // jut in south
  [sq({ right: TL, bottom: TL }), sq({ left: TR, bottom: TR }), sq({ top: TR, right: TR, linkId: TLBR_SW }), sq({ left: TL, top: TL, linkId: TRBL_SE })],
  // horizontal
  [sq({ top: TR, right: TR, linkId: TLBR_SW }), sq({ left: TL, top: TL, linkId: TRBL_SE }), sq({ left: BL, bottom: BL, linkId: TLBR_NE }), sq({ right: BR, bottom: BR, linkId: TRBL_NW })],
  // vertical
  [sq({ left: BL, bottom: FL, linkId: TLBR_NE }), sq({ right: BR, bottom: FR, linkId: TRBL_NW }), sq({ top: FR, right: TR, linkId: TLBR_SW }), sq({ left: TL, top: FL, linkId: TRBL_SE })],
];

const isHard = (link: number) => link > SOFT_LINKS;

/** A CV5 group with some, but not all, hard links is a quadrant of some shape. */
function isShapeQuadrant(l: Links): boolean {
  const hard = [l.left, l.top, l.right, l.bottom].filter(isHard).length;
  return hard > 0 && hard < 4;
}

/** Hard links must match exactly; soft links match any soft link. */
function quadMatches(q: ShapeQuad, l: Links, noStackAbove: boolean): boolean {
  const same = (a: number, b: number) => a === b || (!isHard(a) && !isHard(b));
  return same(l.left, q.left) && same(l.top, q.top) && same(l.right, q.right) && same(l.bottom, q.bottom) && (noStackAbove || !q.stackTop);
}

/* ── Building the tables for a tileset ──────────────────── */

export interface IsomTables {
  era: number;
  links: ShapeLinks[];
  terrainTypes: readonly IsomTerrainType[];
  /** `[a * n + b]`: the terrain to try first when `b` must sit next to `a`. */
  terrainTypeMap: Uint16Array;
  /** Link hash of a left-hand CV5 group → the even group indices carrying it. */
  hashToGroups: Map<number, number[]>;
}

/** Six bits per link plus the terrain type — StarEdit's own hashing, collisions and all. */
function linkHash(l: Links, terrainType: number): number {
  return (((((((l.left << 6) | l.top) << 6) | l.right) << 6) | l.bottom) << 6 | terrainType) >>> 0;
}

/** Which CV5 groups fill each quadrant of each shape, needed to patch up the gaps below. */
type ShapeGroups = [number, number, number, number][];

function buildLinks(groups: readonly Cv5Group[], terrainTypes: readonly IsomTerrainType[]): ShapeLinks[] {
  const total = Math.min(1024, groups.length);
  const byType: number[][] = terrainTypes.map(() => []);
  for (let g = 0; g < total; g += 2) {
    const t = groups[g].index;
    if (t > 0 && t < byType.length) byType[t].push(g);
  }

  const solid: IsomTerrainType[] = [];
  const other: IsomTerrainType[] = [];
  let i = 1;
  for (; i <= Math.floor(terrainTypes.length / 2); i++) if (terrainTypes[i].isomValue !== 0) solid.push(terrainTypes[i]);
  for (; i < terrainTypes.length; i++) if (terrainTypes[i].isomValue !== 0) other.push(terrainTypes[i]);
  solid.sort((a, b) => a.isomValue - b.isomValue);
  other.sort((a, b) => a.isomValue - b.isomValue);

  const links: ShapeLinks[] = [];
  for (const s of solid) {
    while (links.length < s.isomValue) links.push(emptyRow());
    const group = groups[byType[s.index][0] ?? -1];
    if (!group) { links.push(emptyRow()); continue; } // the tileset has no graphics for this terrain
    const l = group.edges;
    links.push({
      terrainType: s.index,
      quads: [
        { left: 0, top: 0, right: l.right, bottom: l.bottom, linkId: s.linkId },
        { left: l.left, top: 0, right: 0, bottom: l.bottom, linkId: s.linkId },
        { left: l.left, top: l.top, right: 0, bottom: 0, linkId: s.linkId },
        { left: 0, top: l.top, right: l.right, bottom: 0, linkId: s.linkId },
      ],
    });
  }
  const totalSolid = links.length;
  if (other.length === 0) return links;
  while (links.length < other[0].isomValue) links.push(emptyRow());

  for (const o of other) {
    const start = links.length;
    for (let k = 0; k < SHAPE_COUNT; k++) links.push(emptyRow(o.index));
    const shapes = links.slice(start, start + SHAPE_COUNT);
    const shapeGroups: ShapeGroups = Array.from({ length: SHAPE_COUNT }, () => [-1, -1, -1, -1]);

    for (const g of byType[o.index]) {
      const group = groups[g];
      if (!isShapeQuadrant(group.edges)) continue;
      const noStackAbove = group.stack.top === 0;
      const l = group.edges;
      for (let s = 0; s < SHAPE_COUNT; s++) {
        const def = SHAPES[s];
        if (quadMatches(def[Q_TL], l, noStackAbove)) { shapes[s].quads[Q_TL].right = l.right; shapes[s].quads[Q_TL].bottom = l.bottom; shapeGroups[s][Q_TL] = g; }
        if (quadMatches(def[Q_TR], l, noStackAbove)) { shapes[s].quads[Q_TR].left = l.left; shapes[s].quads[Q_TR].bottom = l.bottom; shapeGroups[s][Q_TR] = g; }
        if (quadMatches(def[Q_BR], l, noStackAbove)) { shapes[s].quads[Q_BR].left = l.left; shapes[s].quads[Q_BR].top = l.top; shapeGroups[s][Q_BR] = g; }
        if (quadMatches(def[Q_BL], l, noStackAbove)) { shapes[s].quads[Q_BL].top = l.top; shapes[s].quads[Q_BL].right = l.right; shapeGroups[s][Q_BL] = g; }
      }
    }

    const edgesOf = (s: number, q: Quadrant): Links => groups[shapeGroups[s][q]]?.edges ?? { left: 0, top: 0, right: 0, bottom: 0 };

    // The far sides of the inward juts are missing from some edge sets (rocky ground);
    // StarEdit fills them from the plain edges.
    if (shapes[SH_IN_E].quads[Q_TR].left === 0) {
      shapes[SH_IN_E].quads[Q_TR].left = edgesOf(SH_EDGE_NE, Q_BL).left;
      shapes[SH_IN_E].quads[Q_TR].bottom = edgesOf(SH_EDGE_NE, Q_BL).bottom;
      shapes[SH_IN_E].quads[Q_BR].left = edgesOf(SH_EDGE_SE, Q_TL).left;
      shapes[SH_IN_E].quads[Q_BR].top = edgesOf(SH_EDGE_SE, Q_TL).top;
    }
    if (shapes[SH_IN_W].quads[Q_TL].right === 0) {
      shapes[SH_IN_W].quads[Q_TL].right = edgesOf(SH_EDGE_NW, Q_BR).right;
      shapes[SH_IN_W].quads[Q_TL].bottom = edgesOf(SH_EDGE_NW, Q_BR).bottom;
      shapes[SH_IN_W].quads[Q_BL].top = edgesOf(SH_EDGE_SW, Q_TR).top;
      shapes[SH_IN_W].quads[Q_BL].right = edgesOf(SH_EDGE_SW, Q_TR).right;
    }

    // Quadrants outside a shape's own pieces take the links of the pieces next to them.
    const q = (s: number, k: Quadrant) => shapes[s].quads[k];
    q(SH_EDGE_NW, Q_TL).right = q(SH_EDGE_NW, Q_TR).left;
    q(SH_EDGE_NW, Q_TL).bottom = q(SH_EDGE_NW, Q_BL).top;
    q(SH_EDGE_NE, Q_TR).left = q(SH_EDGE_NE, Q_TL).right;
    q(SH_EDGE_NE, Q_TR).bottom = q(SH_EDGE_NE, Q_BR).top;
    q(SH_EDGE_SE, Q_BR).left = q(SH_EDGE_SE, Q_BL).right;
    q(SH_EDGE_SE, Q_BR).top = q(SH_EDGE_SE, Q_TR).bottom;
    q(SH_EDGE_SW, Q_BL).top = q(SH_EDGE_SW, Q_TL).bottom;
    q(SH_EDGE_SW, Q_BL).right = q(SH_EDGE_SW, Q_BR).left;
    q(SH_OUT_N, Q_TL).bottom = q(SH_OUT_N, Q_BL).top;
    q(SH_OUT_N, Q_TL).right = q(SH_OUT_N, Q_TL).bottom;
    q(SH_OUT_N, Q_TR).bottom = q(SH_OUT_N, Q_BR).top;
    q(SH_OUT_N, Q_TR).left = q(SH_OUT_N, Q_TR).bottom;
    let fill = q(SH_OUT_E, Q_TL).right;
    q(SH_OUT_E, Q_TR).left = fill; q(SH_OUT_E, Q_TR).bottom = fill; q(SH_OUT_E, Q_BR).left = fill; q(SH_OUT_E, Q_BR).top = fill;
    q(SH_OUT_S, Q_BR).top = q(SH_OUT_S, Q_TR).bottom;
    q(SH_OUT_S, Q_BR).left = q(SH_OUT_S, Q_BR).top;
    q(SH_OUT_S, Q_BL).top = q(SH_OUT_S, Q_TL).bottom;
    q(SH_OUT_S, Q_BL).right = q(SH_OUT_S, Q_BL).top;
    fill = q(SH_OUT_W, Q_TR).left;
    q(SH_OUT_W, Q_TL).right = fill; q(SH_OUT_W, Q_TL).bottom = fill; q(SH_OUT_W, Q_BL).right = fill; q(SH_OUT_W, Q_BL).top = fill;

    // The hard-coded link ids are the same for every edge set.
    for (let s = 0; s < SHAPE_COUNT; s++) {
      for (const k of QUADRANTS) if (SHAPES[s][k].linkId >= SAME_TYPE_ONLY) shapes[s].quads[k].linkId = SHAPES[s][k].linkId;
    }

    // The soft-link quadrants get the link id of the flat terrain on that side of the edge.
    const fillOuter = (id: number) => {
      for (const [s, k] of [[SH_EDGE_NW, Q_TL], [SH_EDGE_NE, Q_TR], [SH_EDGE_SE, Q_BR], [SH_EDGE_SW, Q_BL], [SH_OUT_N, Q_TL], [SH_OUT_N, Q_TR], [SH_OUT_E, Q_TR], [SH_OUT_E, Q_BR], [SH_OUT_W, Q_TL], [SH_OUT_W, Q_BL], [SH_OUT_S, Q_BR], [SH_OUT_S, Q_BL]] as const) shapes[s].quads[k].linkId = id;
    };
    const fillInner = (id: number) => {
      for (const [s, k] of [[SH_EDGE_NW, Q_BR], [SH_EDGE_NE, Q_BL], [SH_EDGE_SE, Q_TL], [SH_EDGE_SW, Q_TR], [SH_IN_E, Q_TR], [SH_IN_E, Q_BR], [SH_IN_W, Q_TL], [SH_IN_W, Q_BL], [SH_IN_N, Q_BR], [SH_IN_N, Q_BL], [SH_IN_S, Q_TL], [SH_IN_S, Q_TR]] as const) shapes[s].quads[k].linkId = id;
    };
    const outerGroup = groups[shapeGroups[SH_EDGE_NW][Q_TR]];
    const innerGroup = groups[shapeGroups[SH_EDGE_NW][Q_BR]];
    for (let b = 0; b < totalSolid; b++) {
      const brushLink = links[b].quads[Q_TL].right;
      const brushLinkId = links[b].quads[Q_TL].linkId;
      if (outerGroup && brushLink === outerGroup.edges.left) fillOuter(brushLinkId);
      if (innerGroup && brushLink === innerGroup.edges.right) fillInner(brushLinkId);
    }
  }
  return links;
}

/** Expand the adjacency list into "first hop from a towards b" for every pair. */
function buildTerrainTypeMap(compressed: readonly number[], n: number): Uint16Array {
  const temp = new Uint16Array(n * n);
  for (let i = 0; compressed[i] !== 0; i++) {
    for (let j = n * compressed[i++]; compressed[i] !== 0; i++, j++) temp[j] = compressed[i];
  }

  const map = new Uint16Array(n * n);
  for (let i = n - 1; i >= 0; i--) {
    const rowData = new Uint16Array(n);
    const queue: number[] = [i];
    map[n * i + i] = i;
    while (queue.length > 0) {
      const destRow = queue.shift()!;
      const start = i * n;
      for (let j = destRow * n; j < (destRow + 1) * n && temp[j] !== 0; j++) {
        const path = temp[j];
        if (map[start + path] === 0) {
          const next = rowData[destRow] === 0 ? path : rowData[destRow];
          queue.push(path);
          map[start + path] = next;
          rowData[path] = next;
        }
      }
    }
  }
  return map;
}

const cache = new WeakMap<Tileset, IsomTables>();

/** The brush tables for a tileset's graphics, built once per loaded tileset. */
export function isomTables(tileset: Tileset, era: number): IsomTables {
  const hit = cache.get(tileset);
  if (hit && hit.era === era) return hit;
  const { terrainTypes, terrainTypeMap } = ISOM_TABLES[era % ISOM_TABLES.length];
  const hashToGroups = new Map<number, number[]>();
  for (let g = 0; g + 1 < tileset.groups.length; g += 2) {
    const l = tileset.groups[g].edges;
    const anyHard = l.left >= SOFT_LINKS || l.top >= SOFT_LINKS || l.right >= SOFT_LINKS || l.bottom >= SOFT_LINKS;
    const hash = linkHash(l, anyHard ? tileset.groups[g].index : 0);
    const list = hashToGroups.get(hash);
    if (list) list.push(g);
    else hashToGroups.set(hash, [g]);
  }
  const tables: IsomTables = {
    era,
    links: buildLinks(tileset.groups, terrainTypes),
    terrainTypes,
    terrainTypeMap: buildTerrainTypeMap(terrainTypeMap, terrainTypes.length),
    hashToGroups,
  };
  cache.set(tileset, tables);
  return tables;
}

/** The terrain types the tileset can actually paint isometrically, by CV5 index. */
export function isomTerrains(tables: IsomTables): number[] {
  return tables.terrainTypes
    .filter((t) => t.brush >= 0 && t.isomValue < tables.links.length && tables.links[t.isomValue].terrainType === t.index)
    .sort((a, b) => a.brush - b.brush)
    .map((t) => t.index);
}

/* ── Geometry ───────────────────────────────────────────── */

export interface Diamond { x: number; y: number }

export const isomWidth = (scn: { width: number }) => Math.floor(scn.width / 2) + 1;
export const isomHeight = (scn: { height: number }) => scn.height + 1;

/** Only lattice points with an even coordinate sum are diamonds. */
export const isDiamond = (d: Diamond) => (d.x + d.y) % 2 === 0;

/** The rect a diamond's quadrant lies in; diamond (x, y) is its own bottom-right rect. */
function rectOf(d: Diamond, q: Quadrant): Diamond {
  switch (q) {
    case Q_TL: return { x: d.x - 1, y: d.y - 1 };
    case Q_TR: return { x: d.x, y: d.y - 1 };
    case Q_BR: return d;
    default: return { x: d.x - 1, y: d.y };
  }
}

/** Neighbours in quadrant order — upper-left, upper-right, lower-right, lower-left. */
function neighbourOf(d: Diamond, q: Quadrant): Diamond {
  switch (q) {
    case Q_TL: return { x: d.x - 1, y: d.y - 1 };
    case Q_TR: return { x: d.x + 1, y: d.y - 1 };
    case Q_BR: return { x: d.x + 1, y: d.y + 1 };
    default: return { x: d.x - 1, y: d.y + 1 };
  }
}

/**
 * The diamond under a map pixel — StarEdit's own arithmetic. Diamond (x, y) is centred
 * on pixel (64x, 32y) and spans 128x64. The result can be off the map; check bounds.
 */
export function diamondAt(px: number, py: number): Diamond {
  const x = Math.max(0, Math.floor(px));
  const y = Math.max(0, Math.floor(py));
  let calcX = x - y * 2;
  let calcY = Math.floor(x / 2) + y;
  calcX -= (calcX - 64) & 127;
  calcY -= (calcY - 32) & 63;
  const half = Math.trunc(calcX / 2) + 32;
  return {
    x: Math.trunc(Math.trunc((calcY + 32 + half) / 32) / 2),
    y: Math.trunc(Math.trunc((calcY + 32 - half) / 2) / 32),
  };
}

/** Brush offsets StarEdit uses: an N-extent brush is N×N diamonds along the lattice axes. */
function brushRange(extent: number): { min: number; max: number } {
  let min = Math.trunc(extent / -2);
  let max = min + extent;
  if (extent % 2 === 0) { min++; max++; }
  return { min, max };
}

/** The in-bounds diamonds a brush of `extent` centred on `d` covers, for the hover preview. */
export function brushDiamonds(scn: { width: number; height: number }, d: Diamond, extent: number): Diamond[] {
  const w = isomWidth(scn), h = isomHeight(scn);
  const { min, max } = brushRange(extent);
  const out: Diamond[] = [];
  for (let ox = min; ox < max; ox++) {
    for (let oy = min; oy < max; oy++) {
      const x = d.x + ox - oy, y = d.y + ox + oy;
      if (x >= 0 && y >= 0 && x < w && y < h) out.push({ x, y });
    }
  }
  return out;
}

/* ── One brush operation ────────────────────────────────── */

export interface IsomEdit {
  tiles: TileChange[];
  /** Changes to `scenario.isom`, indexed by u16. */
  isom: TileChange[];
}

interface Neighbours {
  linkId: number[];
  isomValue: number[];
  modified: boolean[];
  maxModifiedType: number;
  best: { isomValue: number; count: number };
}

/**
 * A pass over one scenario: tracks what it touches so the caller gets change lists,
 * and keeps the scratch flags StarEdit leaves in the ISOM u16s while it works.
 */
class IsomPass {
  readonly scn: Scenario & { isom: Uint16Array };
  readonly tileset: Tileset;
  readonly tables: IsomTables;
  readonly random: () => number;
  readonly w: number;
  readonly h: number;
  readonly isom: Uint16Array;
  private readonly isomBefore = new Map<number, number>();
  private readonly tileBefore = new Map<number, number>();
  private changed = { left: 0, top: 0, right: -1, bottom: -1 };

  constructor(scn: Scenario & { isom: Uint16Array }, tileset: Tileset, tables: IsomTables, random: () => number) {
    this.scn = scn;
    this.tileset = tileset;
    this.tables = tables;
    this.random = random;
    this.w = isomWidth(scn);
    this.h = isomHeight(scn);
    this.isom = scn.isom;
    this.resetChanged();
  }

  private resetChanged() { this.changed = { left: this.w, top: this.h, right: 0, bottom: 0 }; }
  private touch(x: number, y: number) {
    const c = this.changed;
    c.left = Math.min(c.left, x); c.right = Math.max(c.right, x);
    c.top = Math.min(c.top, y); c.bottom = Math.max(c.bottom, y);
  }
  inBounds(p: Diamond) { return p.x >= 0 && p.y >= 0 && p.x < this.w && p.y < this.h; }
  private at(p: Diamond) { return (p.y * this.w + p.x) * 4; }

  private write(index: number, value: number) {
    if (!this.isomBefore.has(index)) this.isomBefore.set(index, this.isom[index]);
    this.isom[index] = value;
  }

  /** The value of the diamond whose bottom-right rect this is. */
  central(p: Diamond) { return this.isom[this.at(p) + S_LEFT] >> 4; }
  private centralModified(p: Diamond) { return (this.isom[this.at(p) + S_LEFT] & MODIFIED) !== 0; }
  private visited(p: Diamond) { return (this.isom[this.at(p) + S_RIGHT] & VISITED) !== 0; }
  private setVisited(p: Diamond) { const i = this.at(p) + S_RIGHT; this.write(i, this.isom[i] | VISITED); }

  private setIsomValue(p: Diamond, q: Quadrant, value: number) {
    if (!this.inBounds(p)) return;
    const { sides, flags } = PROJECTED[q];
    const base = this.at(p);
    this.write(base + sides[0], ((value << 4) | flags[0] | MODIFIED) & 0xffff);
    this.write(base + sides[1], ((value << 4) | flags[1] | MODIFIED) & 0xffff);
    this.touch(p.x, p.y);
  }

  private setDiamond(d: Diamond, value: number) {
    for (const q of QUADRANTS) this.setIsomValue(rectOf(d, q), q, value);
  }

  private needsUpdate(d: Diamond) {
    return this.inBounds(d) && !this.centralModified(d) && this.central(d) !== 0;
  }

  private loadNeighbours(d: Diamond): Neighbours {
    const n: Neighbours = { linkId: [0, 0, 0, 0], isomValue: [0, 0, 0, 0], modified: [false, false, false, false], maxModifiedType: 0, best: { isomValue: 0, count: 0 } };
    const { links } = this.tables;
    for (const q of QUADRANTS) {
      const nb = neighbourOf(d, q);
      if (!this.inBounds(nb)) continue;
      const v = this.central(nb);
      n.modified[q] = this.centralModified(nb);
      n.isomValue[q] = v;
      if (v < links.length) {
        n.linkId[q] = links[v].quads[opposite(q)].linkId;
        if (n.modified[q] && links[v].terrainType > n.maxModifiedType) n.maxModifiedType = links[v].terrainType;
      }
    }
    return n;
  }

  private countMatches(row: ShapeLinks, n: Neighbours): number {
    const { links } = this.tables;
    let total = 0;
    for (const q of QUADRANTS) {
      const nbRow = links[n.isomValue[q] < links.length ? n.isomValue[q] : 0];
      const id = row.quads[q].linkId;
      if (n.linkId[q] === id && (id < SAME_TYPE_ONLY || row.terrainType === nbRow.terrainType)) total++;
      else if (n.modified[q]) return 0; // a neighbour the brush just set must be matched
    }
    return total;
  }

  private search(startType: number, n: Neighbours) {
    const { links, terrainTypes } = this.tables;
    const untilHigher = startType === Math.floor(terrainTypes.length / 2) + 1;
    const untilEnd = startType === 0;
    for (let v = terrainTypes[startType]?.isomValue ?? 0; v < links.length; v++) {
      const type = links[v].terrainType;
      if (!untilEnd && type !== startType && (!untilHigher || type > startType)) break;
      const count = this.countMatches(links[v], n);
      if (count > n.best.count) n.best = { isomValue: v, count };
    }
  }

  private bestMatch(d: Diamond): number | null {
    const { links, terrainTypes, terrainTypeMap } = this.tables;
    const n = this.loadNeighbours(d);
    const prev = this.central(d);
    if (prev < links.length) {
      const prevType = links[prev].terrainType;
      this.search(terrainTypeMap[n.maxModifiedType * terrainTypes.length + prevType], n);
    }
    this.search(n.maxModifiedType, n);
    this.search(Math.floor(terrainTypes.length / 2) + 1, n);
    return n.best.isomValue === prev ? null : n.best.isomValue;
  }

  private propagate(queue: Diamond[]) {
    while (queue.length > 0) {
      const d = queue.shift()!;
      if (!this.needsUpdate(d) || this.visited(d)) continue;
      this.setVisited(d);
      this.touch(d.x, d.y);
      const best = this.bestMatch(d);
      if (best === null) continue;
      if (best !== 0) this.setDiamond(d, best);
      for (const q of QUADRANTS) {
        const nb = neighbourOf(d, q);
        if (this.needsUpdate(nb)) queue.push(nb);
      }
    }
  }

  /** Set the brush diamonds and let the change ripple out. False when the terrain cannot be painted. */
  place(d: Diamond, terrainType: number, extent: number): boolean {
    const { links, terrainTypes } = this.tables;
    const value = terrainTypes[terrainType]?.isomValue ?? 0;
    if (value === 0 || !isDiamond(d) || value >= links.length || links[value].terrainType === 0) return false;

    const { min, max } = brushRange(extent);
    const queue: Diamond[] = [];
    for (let ox = min; ox < max; ox++) {
      for (let oy = min; oy < max; oy++) {
        const b = { x: d.x + ox - oy, y: d.y + ox + oy };
        if (!this.inBounds(b)) continue;
        this.setDiamond(b, value);
        if (ox === min || ox === max - 1 || oy === min || oy === max - 1) {
          for (const q of QUADRANTS) {
            const nb = neighbourOf(b, q);
            if (this.needsUpdate(nb)) queue.push(nb);
          }
        }
      }
    }
    this.propagate(queue);
    return true;
  }

  /* — tiles — */

  private tile(x: number, y: number) { return this.scn.tiles[y * this.scn.width + x]; }
  private setTile(x: number, y: number, value: number) {
    if (x >= this.scn.width || y >= this.scn.height) return;
    const at = y * this.scn.width + x;
    if (!this.tileBefore.has(at)) this.tileBefore.set(at, this.scn.tiles[at]);
    this.scn.tiles[at] = value;
  }

  private rectHash(p: Diamond): number {
    const { links } = this.tables;
    const base = this.at(p);
    let hash = 0;
    let lastType = 0;
    for (let side = 0; side < 4; side++) {
      const v = this.isom[base + side] & CLEAR_FLAGS;
      const row = v >> 4;
      if (row >= links.length) continue;
      const link = edgeLink(links[row], v);
      hash = (hash | link) << 6;
      if (links[row].terrainType !== 0 && isHard(link)) lastType = links[row].terrainType;
    }
    return (hash | lastType) >>> 0;
  }

  /** The CV5 groups a rect's links resolve to, in the order StarEdit tries them. */
  groupsFor(p: Diamond): number[] | undefined {
    return this.tables.hashToGroups.get(this.rectHash(p));
  }

  /** Re-derive the tile pair under rect `p`, and the cliff face stacked above and below it. */
  updateTile(p: Diamond) {
    if (p.x + 1 >= this.w || p.y + 1 >= this.h) return;
    const { groups } = this.tileset;
    const total = groups.length;
    const leftX = 2 * p.x, rightX = leftX + 1;
    const found = this.groupsFor(p);
    if (!found) {
      this.setTile(leftX, p.y, 0);
      this.setTile(rightX, p.y, 0);
      return;
    }

    let dest = found[0];
    if (p.y > 0) {
      // Continue whatever cliff face the row above ends in.
      const above = this.tile(leftX, p.y - 1) >> 4;
      if (above < total) {
        const bottom = groups[above].stack.bottom;
        for (const g of found) if (groups[g].stack.top === bottom) { dest = g; break; }
      }
    }

    const sub = pickVariation(variationsOf(this.tileset, dest), this.random) & 15;
    this.setTile(leftX, p.y, 16 * dest + sub);
    this.setTile(rightX, p.y, 16 * (dest + 1) + sub);

    // Find the top of the stack this row belongs to…
    let topY = p.y;
    let curr = this.tile(leftX, topY) >> 4;
    while (topY > 0 && curr < total && groups[curr].stack.top !== 0) {
      const above = this.tile(leftX, topY - 1) >> 4;
      if (above >= total || groups[curr].stack.top !== groups[above].stack.bottom) break;
      curr = above;
      topY--;
    }
    this.setTile(leftX, topY, 16 * (this.tile(leftX, topY) >> 4) + sub);
    this.setTile(rightX, topY, 16 * (this.tile(rightX, topY) >> 4) + sub);

    // …and re-link everything below it, one variation for the whole face.
    for (let y = topY + 1; y < this.scn.height; y++) {
      const upper = this.tile(leftX, y - 1) >> 4;
      const lower = this.tile(leftX, y) >> 4;
      if (upper >= total || lower >= total || groups[upper].stack.bottom === 0 || groups[lower].stack.top === 0) break;
      const bottom = groups[upper].stack.bottom;
      let leftGroup = lower;
      let rightGroup = this.tile(rightX, y) >> 4;
      if (bottom !== groups[lower].stack.top) {
        const candidates = this.groupsFor({ x: p.x, y });
        if (candidates) {
          for (const g of candidates) if (groups[g].stack.top === bottom) { leftGroup = g; rightGroup = g + 1; break; }
        }
      }
      this.setTile(leftX, y, 16 * leftGroup + sub);
      this.setTile(rightX, y, 16 * rightGroup + sub);
    }
  }

  /** Turn every rect the pass touched back into tiles and drop the scratch flags. */
  updateTiles() {
    const c = this.changed;
    for (let y = c.top; y <= c.bottom; y++) {
      for (let x = c.left; x <= c.right; x++) {
        const base = this.at({ x, y });
        if ((this.isom[base + S_LEFT] | this.isom[base + S_RIGHT]) & MODIFIED) this.updateTile({ x, y });
        for (let s = 0; s < 4; s++) {
          const v = this.isom[base + s];
          if (v & ~CLEAR_FLAGS) this.write(base + s, v & CLEAR_FLAGS);
        }
      }
    }
    this.resetChanged();
  }

  /** What changed, net of anything that ended where it started. */
  finish(): IsomEdit {
    for (const i of this.isomBefore.keys()) this.isom[i] &= CLEAR_FLAGS;
    const isom: TileChange[] = [];
    for (const [at, before] of this.isomBefore) {
      const after = this.isom[at];
      if (after !== before) isom.push({ at, before, after });
    }
    const tiles: TileChange[] = [];
    for (const [at, before] of this.tileBefore) {
      const after = this.scn.tiles[at];
      if (after !== before) tiles.push({ at, before, after });
    }
    if (tiles.length > 0) markDirty(this.scn, "MTXM", "TILE");
    if (isom.length > 0) markDirty(this.scn, "ISOM");
    return { tiles, isom };
  }
}

/** True when the scenario carries an ISOM section the brush can work on. */
export function hasIsom(scn: Scenario | null): scn is Scenario & { isom: Uint16Array } {
  return scn !== null && scn.isom !== null && scn.isom.length >= isomWidth(scn) * isomHeight(scn) * 4;
}

/**
 * Paint `terrainType` (a CV5 index) with an `extent`-diamond brush centred on `d`.
 * Mutates `scn.tiles` and `scn.isom`; returns what changed, or null when the terrain is
 * not one the tileset paints isometrically or `d` is not a diamond.
 */
export function paintIsom(
  scn: Scenario & { isom: Uint16Array },
  tileset: Tileset,
  d: Diamond,
  terrainType: number,
  extent: number,
  random: () => number = Math.random,
): IsomEdit | null {
  const pass = new IsomPass(scn, tileset, isomTables(tileset, tilesetIndex(scn)), random);
  if (!pass.place(d, terrainType, extent)) return null;
  pass.updateTiles();
  return pass.finish();
}

/** Apply (or take back) the ISOM half of an edit. */
export function applyIsomChanges(scn: Scenario, changes: readonly TileChange[], direction: "do" | "undo" = "do") {
  if (changes.length === 0 || !scn.isom) return;
  for (const c of changes) scn.isom[c.at] = direction === "do" ? c.after : c.before;
  markDirty(scn, "ISOM");
}

/* ── Consistency and reconstruction ─────────────────────── */

export interface IsomCheck {
  /** Rects that have tiles under them. */
  rects: number;
  /** Rects whose tiles are not what their ISOM resolves to (doodad tiles are excused). */
  mismatched: number;
}

/** How well the ISOM section describes the tiles that are actually on the map. */
export function checkIsom(scn: Scenario & { isom: Uint16Array }, tileset: Tileset): IsomCheck {
  const pass = new IsomPass(scn, tileset, isomTables(tileset, tilesetIndex(scn)), Math.random);
  const { groups } = tileset;
  let rects = 0, mismatched = 0;
  for (let y = 0; y < scn.height; y++) {
    for (let x = 0; x < Math.floor(scn.width / 2); x++) {
      rects++;
      const actual = groups[scn.tiles[y * scn.width + 2 * x] >> 4]?.index ?? -1;
      if (actual === 1) continue; // a doodad laid over the terrain
      const found = pass.groupsFor({ x, y });
      const expected = found ? groups[found[0]].index : -1;
      if (actual !== expected) mismatched++;
    }
  }
  return { rects, mismatched };
}

export interface IsomRebuild {
  isom: Uint16Array;
  diamonds: number;
  /** Diamonds no tile gave a clue for (borrowed from a neighbour). */
  unresolved: number;
}

/**
 * Reconstruct an ISOM section from the tiles: every tile group's four links say which
 * table rows could have produced it on each side, and each diamond takes the row most
 * of its eight rect-sides agree on. Exact for terrain StarEdit laid down (bar the
 * doodads over it), a best guess for hand-placed tiles.
 */
export function rebuildIsomFromTiles(scn: Scenario, tileset: Tileset): IsomRebuild {
  const tables = isomTables(tileset, tilesetIndex(scn));
  const { links } = tables;
  const { groups } = tileset;
  const w = isomWidth(scn), h = isomHeight(scn);
  // Diamonds run one past the rect grid on both axes; index them on a (w + 1) x (h + 1) grid.
  const dw = w + 1;
  const votes = new Map<number, Map<number, number>>();
  const vote = (dx: number, dy: number, row: number) => {
    const key = dy * dw + dx;
    let m = votes.get(key);
    if (!m) votes.set(key, (m = new Map()));
    m.set(row, (m.get(row) ?? 0) + 1);
  };

  // For each (flag, link[, terrain type]) the rows that carry it — the inverse of edgeLink.
  const rowsFor = new Map<string, number[]>();
  for (let row = 0; row < links.length; row++) {
    if (links[row].terrainType === 0) continue;
    for (let flag = 0; flag < 16; flag += 2) {
      const link = edgeLink(links[row], flag);
      const key = `${flag}:${link}:${isHard(link) ? links[row].terrainType : 0}`;
      const list = rowsFor.get(key);
      if (list) list.push(row);
      else rowsFor.set(key, [row]);
    }
  }

  for (let y = 0; y < scn.height; y++) {
    for (let x = 0; x < Math.floor(scn.width / 2); x++) {
      const group = groups[scn.tiles[y * scn.width + 2 * x] >> 4];
      if (!group || group.index <= 1) continue; // unused, or a doodad
      const even = (x + y) % 2 === 0;
      // Which diamond and quadrant each side of this rect belongs to.
      const owners: { d: Diamond; q: Quadrant }[] = even
        ? [{ d: { x, y }, q: Q_BR }, { d: { x, y }, q: Q_BR }, { d: { x: x + 1, y: y + 1 }, q: Q_TL }, { d: { x: x + 1, y: y + 1 }, q: Q_TL }]
        : [{ d: { x, y: y + 1 }, q: Q_TR }, { d: { x: x + 1, y }, q: Q_BL }, { d: { x: x + 1, y }, q: Q_BL }, { d: { x, y: y + 1 }, q: Q_TR }];
      for (let side = 0; side < 4; side++) {
        const { d, q } = owners[side];
        const { sides, flags } = PROJECTED[q];
        const flag = flags[sides[0] === side ? 0 : 1];
        const link = group.edges[SIDE_NAME[side as Side]];
        const rows = rowsFor.get(`${flag}:${link}:${isHard(link) ? group.index : 0}`);
        if (rows) for (const row of rows) vote(d.x, d.y, row);
      }
    }
  }

  const chosen = new Int32Array(dw * (h + 1)).fill(-1);
  let diamonds = 0, unresolved = 0;
  for (let dy = 0; dy <= h; dy++) {
    for (let dx = 0; dx <= w; dx++) {
      if ((dx + dy) % 2 !== 0) continue;
      diamonds++;
      const m = votes.get(dy * dw + dx);
      if (!m) continue;
      let best = -1, bestCount = 0;
      for (const [row, count] of m) if (count > bestCount || (count === bestCount && row < best)) { best = row; bestCount = count; }
      chosen[dy * dw + dx] = best;
    }
  }
  // Diamonds nothing voted for (map corners, doodad-covered ground) borrow from the nearest decided one.
  const fallback = tables.terrainTypes.find((t) => t.brush === 0)?.isomValue ?? 1;
  for (let dy = 0; dy <= h; dy++) {
    for (let dx = 0; dx <= w; dx++) {
      if ((dx + dy) % 2 !== 0 || chosen[dy * dw + dx] >= 0) continue;
      unresolved++;
      let pick = -1;
      for (let r = 1; r <= 4 && pick < 0; r++) {
        for (const [ox, oy] of [[-r, -r], [r, -r], [r, r], [-r, r], [-2 * r, 0], [2 * r, 0], [0, -2 * r], [0, 2 * r]]) {
          const nx = dx + ox, ny = dy + oy;
          if (nx < 0 || ny < 0 || nx > w || ny > h) continue;
          const v = chosen[ny * dw + nx];
          if (v >= 0) { pick = v; break; }
        }
      }
      chosen[dy * dw + dx] = pick >= 0 ? pick : fallback;
    }
  }

  const isom = new Uint16Array(w * h * 4);
  for (let dy = 0; dy <= h; dy++) {
    for (let dx = 0; dx <= w; dx++) {
      if ((dx + dy) % 2 !== 0) continue;
      const value = chosen[dy * dw + dx];
      for (const q of QUADRANTS) {
        const r = rectOf({ x: dx, y: dy }, q);
        if (r.x < 0 || r.y < 0 || r.x >= w || r.y >= h) continue;
        const { sides, flags } = PROJECTED[q];
        const base = (r.y * w + r.x) * 4;
        isom[base + sides[0]] = (value << 4) | flags[0];
        isom[base + sides[1]] = (value << 4) | flags[1];
      }
    }
  }
  return { isom, diamonds, unresolved };
}

/**
 * Regenerate every tile from the ISOM section — what StarEdit does after any isometric
 * edit, applied to the whole map. Used to validate the port against real maps.
 */
export function tilesFromIsom(scn: Scenario & { isom: Uint16Array }, tileset: Tileset, random: () => number = Math.random): IsomEdit {
  const pass = new IsomPass(scn, tileset, isomTables(tileset, tilesetIndex(scn)), random);
  const w = isomWidth(scn), h = isomHeight(scn);
  for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) pass.updateTile({ x, y });
  return pass.finish();
}
