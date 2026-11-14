/**
 * A made-up tileset for copied terrain (`editor/terrainCopyTable.ts`, `terrainCopyLattice.ts`), built from the editor's
 * own code alone so CI runs the rule, the gate and the brush with no game data. Numbered as the game's Badlands (ERA 0):
 *
 * - typed flat terrains: Dirt (the base), High Dirt (mid ground), Grass;
 * - the Grass/Dirt edge set, its links and stacks those the isometric brush's shapes make (`borderWorld.ts#edgeSetRecords`,
 *   checked against the game's own set where the game's files are here), two variations a group, each piece Grass on
 *   the sides its links say and Dirt on the others;
 * - a **copy** of Grass on mid ground: an untyped pair, Grass's pictures under raised VF4 flags;
 * - a **block** of untyped tiles standing for the edge set at that height: each piece's Grass kept pixel for pixel, its
 *   Dirt repainted with the outer ground's (High Dirt; or kept as Dirt for `repaint: "none"`), raised as the copy is, laid
 *   out in one of three ways.
 *
 * Nothing in it is anybody's art.
 */
import { loadTileset, type Tileset } from "../../src/formats/tileset/decode";
import { createScenario } from "../../src/formats/chk/create";
import type { Scenario } from "../../src/formats/chk/scenario";
import { flatTerrain } from "../../src/formats/tileset/terrain";
import { edgeSetRecords } from "./borderWorld";

export const DIRT = 2, HIGH_DIRT = 3, GRASS = 6, EDGE_SET = 20;
const D = 1, G = 2, HD = 3; // soft links

export type CopyLayout = "two-groups" | "interleaved" | "shuffled";

export interface CopyWorldOptions {
  layout?: CopyLayout;
  /** What the pieces' Dirt part is repainted with: High Dirt's pictures (the outer ground High Dirt), or kept (outer ground Dirt). */
  repaint?: "high-dirt" | "none";
  /** Halves of the set the block holds no tile for (by index into the set's 48 halves). */
  drop?: readonly number[];
  /** Leave the walkable bit off on this share of the pieces' minitiles (the gate must refuse it). */
  unwalkable?: number;
  /** Leave the copy out (nothing is a copy: nothing must be found). */
  noCopy?: boolean;
}

export interface CopyWorld {
  ts: Tileset;
  /** The edge set's halves (groups) in order, and the planted tile for each piece `group << 4 | slot`. */
  halves: number[];
  planted: Map<number, number>;
  /** The copy's even group, the block's first and last group. */
  copy: number;
  block: [number, number];
  dirtGroup: number;
  highDirtGroup: number;
  grassGroup: number;
}

interface Group { index: number; flags: number; edges: number[]; stack: [number, number]; megatiles: number[]; vf4: number }

const PALETTE: number[][] = Array.from({ length: 256 }, (_, i) => [(i * 37 + 11) % 256, (i * 91 + 7) % 256, (i * 53 + 3) % 256]);
for (let k = 0; k < 8; k++) {
  PALETTE[10 + k] = [110 + k * 3, 75 + k * 2, 40 + k]; // dirt
  PALETTE[30 + k] = [40 + k * 2, 110 + k * 3, 40 + k]; // grass
  PALETTE[50 + k] = [150 + k * 3, 140 + k * 3, 120 + k * 2]; // high dirt
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** A noise texture in one of the three grounds' colours. */
const noise = (base: number, random: () => number) => Array.from({ length: 1024 }, () => base + Math.floor(random() * 8));

/** Which pixels of a piece are Grass, by the rect's soft links: each pixel takes the ground of the nearest soft side. */
function grassMask(edges: number[], side: 0 | 1): boolean[] {
  const out: boolean[] = [];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const gx = side * 32 + x;
    const dist = [gx, y, 63 - gx, 31 - y];
    let best = -1, bd = Infinity;
    for (let k = 0; k < 4; k++) if (edges[k] <= 48 && dist[k] < bd) { bd = dist[k]; best = k; }
    // a rect with no soft side (an inner corner, a narrow straight): Grass on its left half, as a solid region
    out.push(best >= 0 ? edges[best] === G : gx < 32);
  }
  // every piece keeps some Grass (a game piece always shows a little of both): a 16 × 16 blob on the minitile grid where it has too little
  if (out.filter(Boolean).length < 256) for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) out[y * 32 + x] = true;
  return out;
}

export function copyWorld(opts: CopyWorldOptions = {}): CopyWorld {
  const random = seeded(17);
  const layout = opts.layout ?? "two-groups";
  const pics: number[][] = [];
  const pic = (p: number[]) => { pics.push(p); return pics.length; }; // megatile id (0 is left black)
  const groups: Group[] = [];
  const empty = (): Group => ({ index: 0, flags: 0, edges: [0, 0, 0, 0], stack: [0, 0], megatiles: [], vf4: 0x0001 });
  const flatPair = (index: number, link: number, base: number, vf4: number) => {
    const g = groups.length;
    const megas = Array.from({ length: 4 }, () => [pic(noise(base, random)), pic(noise(base, random))]);
    groups.push({ index, flags: 0, edges: [link, link, link, link], stack: [0, 0], megatiles: megas.map((m) => m[0]), vf4 });
    groups.push({ index, flags: 0, edges: [link, link, link, link], stack: [0, 0], megatiles: megas.map((m) => m[1]), vf4 });
    return g;
  };
  groups.push(empty(), empty());
  const dirtGroup = flatPair(DIRT, D, 10, 0x0001);
  const highDirtGroup = flatPair(HIGH_DIRT, HD, 50, 0x0003);
  const grassGroup = flatPair(GRASS, G, 30, 0x0001);
  // The edge set: 24 rects, two variations a half.
  const halves: number[] = [];
  const sourcePix = new Map<number, number[]>(); // piece → its pixels
  for (const r of edgeSetRecords()) {
    for (let side = 0 as 0 | 1; side < 2; side = (side + 1) as 0 | 1) {
      const mask = grassMask(r.edges, side);
      const megas: number[] = [];
      for (let v = 0; v < 2; v++) {
        const grass = noise(30, random), dirt = noise(10, random);
        const p = mask.map((gr, i) => (gr ? grass[i] : dirt[i]));
        megas.push(pic(p));
        sourcePix.set(((groups.length) << 4) | v, p);
      }
      halves.push(groups.length);
      groups.push({ index: EDGE_SET, flags: 0, edges: [...r.edges], stack: r.stack, megatiles: megas, vf4: 0x0001 });
    }
  }
  while (groups.length < 1024) groups.push(empty()); // the typed sets live in the first 1,024 groups, as the game's do
  // The copy of Grass on mid ground: Grass's pictures, raised.
  const copy = groups.length;
  if (!opts.noCopy) {
    for (const half of [grassGroup, grassGroup + 1]) groups.push({ ...empty(), megatiles: groups[half].megatiles.map((m) => pic(pics[m - 1])), vf4: 0x0003 });
  } else groups.push(empty(), empty());
  groups.push(empty(), empty()); // a gap
  // The block: each piece's Grass kept, its Dirt repainted, raised; then laid out.
  const hd = Array.from({ length: 4 }, () => noise(50, random));
  const made = new Map<number, number>(); // piece → megatile
  const dropped = new Set((opts.drop ?? []).map((i) => halves[i]));
  let k = 0;
  for (const [piece, p] of sourcePix) {
    if (dropped.has(piece >> 4)) continue;
    const mask = grassMask(groups[piece >> 4].edges, (halves.indexOf(piece >> 4) & 1) as 0 | 1);
    const out = opts.repaint === "none" ? p : p.map((v, i) => (mask[i] ? v : hd[k % 4][i]));
    made.set(piece, pic(out));
    k++;
  }
  const blockStart = groups.length;
  const planted = new Map<number, number>();
  const raisedVf4 = (piece: number) => (opts.unwalkable && (piece % 3 === 0) ? 0x0002 : 0x0003);
  if (layout === "two-groups") {
    for (const h of halves) {
      const g = groups.length;
      const megas: number[] = [];
      let vf = 0x0003;
      for (let v = 0; v < 2; v++) { const m = made.get((h << 4) | v); if (m) { megas[v] = m; planted.set((h << 4) | v, (g << 4) | v); vf = raisedVf4((h << 4) | v); } }
      groups.push({ ...empty(), megatiles: megas.map((m) => m ?? 0), vf4: vf });
    }
  } else if (layout === "interleaved") {
    for (let i = 0; i < halves.length; i += 2) {
      const g = groups.length;
      const megas: number[] = Array(16).fill(0);
      let vf = 0x0003;
      for (let v = 0; v < 2; v++) for (const side of [0, 1]) {
        const piece = (halves[i + side] << 4) | v, m = made.get(piece);
        if (m) { megas[2 * v + side] = m; planted.set(piece, (g << 4) | (2 * v + side)); vf = raisedVf4(piece); }
      }
      groups.push({ ...empty(), megatiles: megas, vf4: vf });
    }
  } else {
    const pieces = [...made.keys()];
    const rows = Math.ceil(pieces.length / 10) + 1;
    const cells = Array.from({ length: rows * 16 }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    const megas: number[][] = Array.from({ length: rows }, () => Array(16).fill(0));
    pieces.forEach((piece, i) => { const c = cells[i]; megas[c >> 4][c & 15] = made.get(piece)!; planted.set(piece, ((blockStart + (c >> 4)) << 4) | (c & 15)); });
    for (const m of megas) groups.push({ ...empty(), megatiles: m, vf4: 0x0003 });
  }
  const block: [number, number] = [blockStart, groups.length - 1];
  if (groups.length % 2) groups.push(empty());

  // Files: per megatile the VF4 of the group that holds it.
  const vf4Of = new Map<number, number>();
  for (const g of groups) for (const m of g.megatiles) if (m) vf4Of.set(m, g.vf4);
  const wpe = new Uint8Array(1024);
  PALETTE.forEach(([r, gr, b], i) => { wpe[i * 4] = r; wpe[i * 4 + 1] = gr; wpe[i * 4 + 2] = b; });
  const count = pics.length + 1;
  const vr4 = new Uint8Array(count * 16 * 64), vx4 = new Uint8Array(count * 16 * 2), vf4 = new Uint8Array(count * 32);
  const vx = new DataView(vx4.buffer), vf = new DataView(vf4.buffer);
  pics.forEach((p, i) => {
    const m = i + 1;
    for (let mt = 0; mt < 16; mt++) {
      const mini = m * 16 + mt;
      vx.setUint16(mini * 2, mini << 1, true);
      vf.setUint16(mini * 2, vf4Of.get(m) ?? 0x0001, true);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) vr4[mini * 64 + y * 8 + x] = p[((mt >> 2) * 8 + y) * 32 + (mt & 3) * 8 + x];
    }
  });
  const cv5 = new Uint8Array(groups.length * 52);
  const cv = new DataView(cv5.buffer);
  groups.forEach((g, i) => {
    cv.setUint16(i * 52, g.index, true);
    cv.setUint16(i * 52 + 2, g.flags, true);
    g.edges.forEach((v, j) => cv.setUint16(i * 52 + 4 + j * 2, v, true));
    cv.setUint16(i * 52 + 14, g.stack[0], true);
    cv.setUint16(i * 52 + 18, g.stack[1], true);
    g.megatiles.forEach((m, s) => cv.setUint16(i * 52 + 20 + s * 2, m, true));
  });
  const ts = loadTileset({ cv5, vf4, vr4, vx4, wpe });
  return { ts, halves, planted, copy, block, dirtGroup, highDirtGroup, grassGroup };
}

/** A map of the world's tileset filled with a typed terrain (with its lattice). */
export function groundScenario(w: CopyWorld, terrain: number, width = 48, height = 48): Scenario & { isom: Uint16Array } {
  const group = terrain === DIRT ? w.dirtGroup : terrain === HIGH_DIRT ? w.highDirtGroup : w.grassGroup;
  const fill = flatTerrain(width, height, { id: terrain, group }, w.ts, () => 0, 0);
  return createScenario({ width, height, era: 0, name: "copies", tiles: fill.tiles, isom: fill.isom }) as Scenario & { isom: Uint16Array };
}
