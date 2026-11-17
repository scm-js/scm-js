/**
 * A made-up world for drawn borders (`editor/modTerrain/borderTable.ts`), built from the editor's own code alone so CI runs the
 * whole path with no game data:
 *
 * - a **source** numbered as the game's Badlands (ERA 0): Dirt (its base ground), Grass and the Grass/Dirt edge set,
 *   whose links and stacks follow the rects the isometric brush's shapes make (`isom.ts`). It is the stand-in too.
 *   `tests/borders.test.ts` checks the edge set against the game's own where the game's files are here.
 * - a **host** numbered as another tileset: its own typed Dirt (the source's Dirt picture), untyped copies of every
 *   source picture, and a drawn border piece per border shape (a fine checker of the two grounds, so it joins both
 *   while Grass against Dirt shows).
 * - a **mapper's map** on the host: a Grass patch with a drawn piece on every border cell, to learn from.
 */
import { loadTileset, type Tileset } from "../../src/formats/tileset/decode";
import { createScenario } from "../../src/formats/chk/create";
import type { Scenario } from "../../src/formats/chk/scenario";
import { badlandsStandIns, flatTerrainsOf, patternKey, standInShapes, type StandIns } from "../../src/editor/modTerrain/borderLattice";
import type { Diamond } from "../../src/editor/isom";

export const DIRT = 2, GRASS = 6, EDGE_SET = 20;
/** The host's ERA (any but the source's). */
export const HOST_ERA = 3;
const D = 1, G = 2; // the soft links of Dirt and Grass

/**
 * The edge set's rects, by their hard links (0 for a soft side): the brush's shapes give one rect per quadrant pattern,
 * and the inner corners and the narrow straights put two patterns into one rect.
 */
const RECTS: number[][] = [
  [0, 0, 51, 51], [51, 51, 0, 0], [49, 0, 0, 49], [0, 49, 49, 0], [0, 0, 52, 52], [52, 52, 0, 0], [50, 0, 0, 50], [0, 50, 50, 0],
  [0, 0, 51, 53], [0, 53, 50, 0], [49, 0, 0, 54], [52, 54, 0, 0], [0, 0, 55, 55], [0, 55, 55, 0], [56, 0, 0, 56], [56, 56, 0, 0],
  [51, 51, 52, 52], [50, 49, 49, 50], [51, 51, 55, 55], [56, 49, 49, 56], [50, 55, 55, 50], [56, 56, 52, 52], [56, 55, 55, 56], [56, 56, 55, 55],
];

/** Which ground a rect's soft sides are: the outer (Dirt) or the inner (Grass), by where its hard links sit. */
function softOf([l, t, r, b]: number[]): number {
  const has = (x: number) => [l, t, r, b].includes(x);
  if (has(53) || has(54)) return D;
  if (has(55) || has(56)) return G;
  const at = (x: number, sides: number[]) => sides.some((s) => [l, t, r, b][s] === x);
  if (has(51)) return at(51, [2, 3]) ? D : G;
  if (has(52)) return at(52, [2, 3]) ? G : D;
  if (has(49)) return at(49, [0, 3]) ? D : G;
  return at(50, [0, 3]) ? G : D;
}
const stackCode = (link: number) => (link >= 49 && link <= 52 ? 1 : link === 53 || link === 55 ? 2 : link === 54 || link === 56 ? 3 : 0);

/** The edge set's even groups as (edges, stack): what the gated test holds against the game's. */
export function edgeSetRecords(): { edges: [number, number, number, number]; stack: [number, number] }[] {
  return RECTS.map((r) => {
    const soft = softOf(r);
    const e = r.map((x) => x || soft) as [number, number, number, number];
    return { edges: e, stack: [stackCode(e[1]), stackCode(e[3])] };
  });
}

interface Group { index: number; flags: number; edges: number[]; stack: [number, number]; megatiles: number[] }

const PALETTE: number[][] = Array.from({ length: 256 }, (_, i) => [(i * 37 + 11) % 256, (i * 91 + 7) % 256, (i * 53 + 3) % 256]);
PALETTE[0] = [0, 0, 0];
PALETTE[1] = [120, 80, 40]; // dirt
PALETTE[2] = [40, 120, 40]; // grass
PALETTE[3] = [200, 200, 60]; // a piece's mark

function build(pictures: number[][], groups: Group[]): Tileset {
  const wpe = new Uint8Array(1024);
  PALETTE.forEach(([r, g, b], i) => { wpe[i * 4] = r; wpe[i * 4 + 1] = g; wpe[i * 4 + 2] = b; });
  const count = pictures.length + 1;
  const vr4 = new Uint8Array(count * 16 * 64), vx4 = new Uint8Array(count * 16 * 2), vf4 = new Uint8Array(count * 32);
  const vx = new DataView(vx4.buffer), vf = new DataView(vf4.buffer);
  pictures.forEach((pix, k) => {
    const m = k + 1;
    for (let mt = 0; mt < 16; mt++) {
      const mini = m * 16 + mt;
      vx.setUint16(mini * 2, mini << 1, true);
      vf.setUint16(mini * 2, 0x0001, true); // walkable, low ground
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) vr4[mini * 64 + y * 8 + x] = pix[((mt >> 2) * 8 + y) * 32 + (mt & 3) * 8 + x];
    }
  });
  const cv5 = new Uint8Array(groups.length * 52);
  const cv = new DataView(cv5.buffer);
  groups.forEach((g, i) => {
    cv.setUint16(i * 52, g.index, true);
    cv.setUint16(i * 52 + 2, g.flags, true);
    g.edges.forEach((v, k) => cv.setUint16(i * 52 + 4 + k * 2, v, true));
    cv.setUint16(i * 52 + 14, g.stack[0], true);
    cv.setUint16(i * 52 + 18, g.stack[1], true);
    g.megatiles.forEach((m, s) => cv.setUint16(i * 52 + 20 + s * 2, m, true));
  });
  return loadTileset({ cv5, vf4, vr4, vx4, wpe });
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const solid = (i: number) => Array.from({ length: 1024 }, () => i);
/** A picture of 4 × 4-pixel blocks of random colours: unlike any other. */
const blocks = (random: () => number) => {
  const c = Array.from({ length: 64 }, () => 10 + Math.floor(random() * 240));
  return Array.from({ length: 1024 }, (_, p) => c[((p >> 7) << 3) | ((p & 31) >> 2)]);
};
/** A drawn border piece: a one-pixel checker of dirt and grass (it joins both), and a mark that makes it its own. */
const piece = (k: number) => Array.from({ length: 1024 }, (_, p) => {
  const x = p & 31, y = p >> 5;
  if (y >= 12 && y < 20 && x >= 12 && x < 20 && ((x - 12) + (y - 12) * 8) === (k % 64)) return 3;
  return (x + y) & 1 ? 1 : 2;
});

export interface BorderWorld {
  source: Tileset;
  host: Tileset;
  standIns: StandIns;
  /** Host tiles: its own Dirt, and the drawn piece per shape. */
  dirtTile: number;
  pieceOf: Map<string, number>;
  pieces: Set<number>;
}

export function borderWorld(): BorderWorld {
  const random = seeded(7);
  // The source: 0/1 nothing, 2/3 Dirt, 4/5 Grass, then the edge set's 24 pairs.
  const sPics: number[][] = [solid(1), solid(2)];
  const sGroups: Group[] = [
    { index: 0, flags: 0, edges: [0, 0, 0, 0], stack: [0, 0], megatiles: [] }, { index: 0, flags: 0, edges: [0, 0, 0, 0], stack: [0, 0], megatiles: [] },
    { index: DIRT, flags: 1, edges: [D, D, D, D], stack: [0, 0], megatiles: [1] }, { index: DIRT, flags: 1, edges: [D, D, D, D], stack: [0, 0], megatiles: [1] },
    { index: GRASS, flags: 1, edges: [G, G, G, G], stack: [0, 0], megatiles: [2] }, { index: GRASS, flags: 1, edges: [G, G, G, G], stack: [0, 0], megatiles: [2] },
  ];
  for (const r of edgeSetRecords()) {
    for (let side = 0; side < 2; side++) {
      sPics.push(blocks(random));
      sGroups.push({ index: EDGE_SET, flags: 1, edges: [...r.edges], stack: r.stack, megatiles: [sPics.length] });
    }
  }
  const source = build(sPics, sGroups);
  const standIns = badlandsStandIns(source);

  // The shapes the stand-in names: one per edge-set rect and side.
  const { softTo } = flatTerrainsOf(source, 0);
  const shapes: string[] = [];
  for (let g = 6; g < sGroups.length; g += 2) {
    const e = source.groups[g];
    const key = patternKey(e.edges, softTo, DIRT, GRASS) + (e.stack.top || e.stack.bottom ? `|s${e.stack.top}.${e.stack.bottom}` : "");
    shapes.push(`${key}|L`, `${key}|R`);
  }

  // The host: its own Dirt (the source's picture), untyped copies of the source's pictures, a piece per shape.
  const hPics: number[][] = [solid(1)];
  const hGroups: Group[] = [
    { index: 0, flags: 0, edges: [0, 0, 0, 0], stack: [0, 0], megatiles: [] }, { index: 0, flags: 0, edges: [0, 0, 0, 0], stack: [0, 0], megatiles: [] },
    { index: DIRT, flags: 1, edges: [D, D, D, D], stack: [0, 0], megatiles: [1] }, { index: DIRT, flags: 1, edges: [D, D, D, D], stack: [0, 0], megatiles: [1] },
  ];
  for (let k = 1; k < sPics.length; k++) {
    hPics.push(sPics[k]);
    hGroups.push({ index: 0, flags: 1, edges: [0, 0, 0, 0], stack: [0, 0], megatiles: [hPics.length] });
  }
  if (hGroups.length % 2) hGroups.push({ index: 0, flags: 0, edges: [0, 0, 0, 0], stack: [0, 0], megatiles: [] });
  const pieceOf = new Map<string, number>();
  shapes.forEach((shape, k) => {
    hPics.push(piece(k));
    hGroups.push({ index: 0, flags: 1, edges: [0, 0, 0, 0], stack: [0, 0], megatiles: [hPics.length] });
    pieceOf.set(shape, (hGroups.length - 1) << 4);
  });
  const host = build(hPics, hGroups);
  return { source, host, standIns, dirtTile: 2 << 4, pieceOf, pieces: new Set(pieceOf.values()) };
}

/** A host map of Dirt. */
export function dirtMap(w: BorderWorld, width = 64, height = 48): Scenario {
  return createScenario({ width, height, era: HOST_ERA, name: "borders", tiles: new Uint16Array(width * height).fill(w.dirtTile) });
}

/**
 * The mapper's map: Grass on `diamonds` laid on the host's Dirt, its inside as the host's copy of Grass and every border
 * cell the drawn piece for its shape, as the stand-in reads it.
 */
export function mapperMap(w: BorderWorld, grassTile: number, diamonds: readonly Diamond[], width = 64, height = 48): Scenario {
  const scn = dirtMap(w, width, height);
  const laid = standInShapes(w.standIns.flat, { x0: 0, y0: 0, w: width, h: height }, diamonds);
  for (let i = 0; i < width * height; i++) {
    const s = laid.shapes[i];
    if (s) scn.tiles[i] = w.pieceOf.get(s.shape) ?? scn.tiles[i];
    else if (laid.inner[i]) scn.tiles[i] = grassTile;
  }
  return scn;
}
