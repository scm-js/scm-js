/**
 * Drawn borders, the table: which tile a tileset's maps lay for each shape of the border between a borrowed terrain
 * (X, a terrain of another tileset laid by the borrowed brush, `borrow.ts`) and the tileset's own ground (Y).
 *
 * Learned from maps the way pieces are: evidence gathered a map at a time (`gatherBorderEvidence`), mergeable and
 * storable, cut into a table per pair when used (`cutBorderTables`). A map's cells are classed per pair — X (a copy of
 * the source terrain's picture, by the pair's borrow table), Y (a typed flat terrain of the host), T (an untyped tile
 * that is no copy of the source's: a transition piece the mod draws) — the lattice is read off them and laid on a
 * stand-in (`borderLattice.ts`), and each transition cell counts its tile for its shape. Both readings of transition
 * cells (as neither terrain, as the ground) are counted; the one that reads the maps more consistently is used.
 *
 * Nothing here names a mod, a group or a tile: the pairs, shapes and tiles all come from the maps and the tables.
 * Telling a transition piece's shape from its picture alone was tried and failed its control (terrain.md "Drawn
 * borders"), so a table needs maps that lay one, or an author who provides one.
 */
import { megatileForTile, megatileHeight, tileGroupOf, type Tileset } from "../formats/tileset/decode";
import { isFlatPair } from "../formats/tileset/palette";
import { ISOM_TABLES } from "../data/isomTables";
import type { BorrowTable } from "./borrowTable";
import { BORDER_MODES, C_O, C_T, C_X, C_Y, diamondsOf, standInFor, standInShapes, type BorderMode, type StandIn, type StandIns } from "./borderLattice";

/** A pair's key: the source's ERA, the source terrain (X), the host terrain (Y). */
export const pairKey = (sourceEra: number, x: number, y: number) => `${sourceEra & 7}:${x}|${y}`;
export function pairOf(key: string): { sourceEra: number; x: number; y: number } {
  const [e, rest] = key.split(":");
  const [x, y] = rest.split("|").map(Number);
  return { sourceEra: Number(e), x, y };
}

/** Counts per pair: maps it was seen on, and per reading (`BORDER_MODES`) shape → tile → times laid. */
export interface BorderEvidence {
  pairs: Map<string, { maps: number; modes: Map<string, Map<number, number>>[] }>;
}
export const emptyBorderEvidence = (): BorderEvidence => ({ pairs: new Map() });

/** What telling cells apart needs for one host and one source: the host, the source, its borrow table. */
export interface BorderSourceCtx {
  host: Tileset;
  source: Tileset;
  sourceEra: number;
  table: BorrowTable;
}

/**
 * What telling cells apart needs for one host and every source whose borrow table is known: which host megatiles are
 * copies of a source's flat terrain (X, as `sourceEra << 10 | terrain index`), and which are copies of any source
 * picture at all (never a transition piece). Built once per learn or per stroke (`borderClasses`).
 */
export interface BorderClasses {
  host: Tileset;
  ctxs: readonly BorderSourceCtx[];
  xOf: Map<number, number>;
  anyCopy: Set<number>;
  /** Per packed X, its commonest megatile height on the host (filled when asked). */
  heights: Map<number, number>;
}
const classCache = new WeakMap<BorrowTable, { xOf: Map<number, number>; anyCopy: Set<number> }>();

function classesOfOne(ctx: BorderSourceCtx) {
  const was = classCache.get(ctx.table);
  if (was) return was;
  const types = ISOM_TABLES[ctx.sourceEra & 7].terrainTypes;
  const half = Math.floor(types.length / 2);
  const flat = new Set(types.filter((t, i) => i >= 1 && i <= half && t.isomValue !== 0).map((t) => t.index));
  // a source megatile's flat terrain, where it draws one
  const srcFlat = new Map<number, number>();
  ctx.source.groups.forEach((g) => { if (flat.has(g.index)) for (const m of g.megatiles) if (m && !srcFlat.has(m)) srcFlat.set(m, g.index); });
  const xOf = new Map<number, number>();
  const anyCopy = new Set<number>();
  for (const [sm, hms] of ctx.table.copies) {
    const x = srcFlat.get(sm);
    for (const hm of hms) { anyCopy.add(hm); if (x !== undefined && !xOf.has(hm)) xOf.set(hm, ((ctx.sourceEra & 7) << 10) | x); }
  }
  const out = { xOf, anyCopy };
  classCache.set(ctx.table, out);
  return out;
}

export function borderClasses(host: Tileset, ctxs: readonly BorderSourceCtx[]): BorderClasses {
  const xOf = new Map<number, number>();
  const anyCopy = new Set<number>();
  for (const ctx of ctxs) {
    const one = classesOfOne(ctx);
    for (const [m, v] of one.xOf) if (!xOf.has(m)) xOf.set(m, v);
    for (const m of one.anyCopy) anyCopy.add(m);
  }
  return { host, ctxs, xOf, anyCopy, heights: new Map() };
}

const typedCache = new WeakMap<Tileset, { groups: Int16Array; megatiles: Map<number, number>; typed: Set<number> }>();
/**
 * The host's typed flat ground: per group, its terrain index when it is (half of) a typed pair of flat ground, else -1;
 * and per megatile those groups draw, the terrain (first claim wins). A map may lay the same picture from an untyped
 * group of the sheet; by its megatile it is still that ground.
 */
function typedFlat(host: Tileset) {
  const was = typedCache.get(host);
  if (was) return was;
  const groups = new Int16Array(host.groups.length).fill(-1);
  const megatiles = new Map<number, number>();
  for (let g = 2; g + 1 < host.groups.length; g += 2) {
    if (!isFlatPair(host, g)) continue;
    groups[g] = host.groups[g].index; groups[g + 1] = host.groups[g].index;
    for (const k of [g, g + 1]) for (const m of host.groups[k].megatiles) if (m && m < host.megatileCount && !megatiles.has(m)) megatiles.set(m, host.groups[g].index);
  }
  // The same picture under another megatile number (a sheet's own copy of its ground) is that ground too.
  const byPicture = new Map<string, number>();
  for (const [m, t] of megatiles) byPicture.set(pictureKey(host, m), t);
  // Pictures of the host's own typed sets (its edges and cliffs): never a drawn border piece, wherever they sit.
  const typedPictures = new Set<string>();
  for (const g of host.groups) if (g.index >= 2) for (const m of g.megatiles) if (m && m < host.megatileCount) typedPictures.add(pictureKey(host, m));
  const typed = new Set<number>();
  for (let m = 1; m < host.megatileCount; m++) {
    const key = pictureKey(host, m);
    if (typedPictures.has(key)) typed.add(m);
    if (megatiles.has(m)) continue;
    const t = byPicture.get(key);
    if (t !== undefined) megatiles.set(m, t);
  }
  const out = { groups, megatiles, typed };
  typedCache.set(host, out);
  return out;
}

/** A megatile's picture as a key: its sixteen minitiles' pixels, flipped as drawn. */
function pictureKey(ts: Tileset, m: number): string {
  let h1 = 0x811c9dc5, h2 = 0;
  for (let k = 0; k < 16; k++) {
    const ref = ts.megatileRefs[m * 16 + k];
    const base = (ref >>> 1) * 64, flip = ref & 1;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = ts.minitiles[base + y * 8 + (flip ? 7 - x : x)];
      h1 = Math.imul(h1 ^ v, 16777619);
      h2 = (Math.imul(h2, 31) + v) | 0;
    }
  }
  return `${h1 >>> 0}:${h2 >>> 0}`;
}

/** A cell's host terrain as Y: a typed flat terrain's index (by its picture), else -1. */
export function hostTerrainOf(host: Tileset, tile: number): number {
  return typedFlat(host).megatiles.get(megatileForTile(host, tile)) ?? -1;
}

/** A host tile's kind for borders: an X (packed source terrain), a Y (host terrain index), a transition piece, or nothing. */
export function cellKind(c: BorderClasses, tile: number): { x: number; y: number; t: boolean } {
  const host = c.host;
  const g = host.groups[tileGroupOf(tile, host.groups.length)];
  const m = megatileForTile(host, tile);
  if (!g || m <= 0 || g.index === 1) return { x: -1, y: -1, t: false };
  const y = typedFlat(host).megatiles.get(m);
  if (y !== undefined) return { x: -1, y, t: false };
  const x = c.xOf.get(m);
  if (x !== undefined) return { x, y: -1, t: false };
  return { x: -1, y: -1, t: g.index === 0 && !c.anyCopy.has(m) && !typedFlat(host).typed.has(m) };
}

/** The commonest height (`megatileHeight`) among some megatiles; 0 for none. */
function heightOf(host: Tileset, megatiles: Iterable<number>): number {
  const n = [0, 0, 0];
  for (const m of megatiles) n[megatileHeight(host, m)]++;
  return n.indexOf(Math.max(...n));
}

/** The stand-in a pair is laid with: by the heights of the host's copies of X and of its Y ground. */
export function pairStandIn(sis: StandIns, c: BorderClasses, sourceEra: number, x: number, y: number): StandIn {
  const packed = ((sourceEra & 7) << 10) | x;
  let hx = c.heights.get(packed);
  if (hx === undefined) c.heights.set(packed, (hx = heightOf(c.host, [...c.xOf].filter(([, v]) => v === packed).map(([m]) => m))));
  let hy = c.heights.get(-1 - y);
  if (hy === undefined) {
    const ym: number[] = [];
    for (const [m, t] of typedFlat(c.host).megatiles) if (t === y) ym.push(m);
    c.heights.set(-1 - y, (hy = heightOf(c.host, ym)));
  }
  return standInFor(sis, hx, hy);
}

/**
 * Count one map's borders into `into`: for each pair a transition cell sits between (a transition tile with exactly one
 * source flat terrain and one host flat terrain next to it, else within two cells), the lattice read in each mode over the
 * window around its transition cells, and each transition cell near both terrains counted for its shape.
 */
export function gatherBorderEvidence(into: BorderEvidence, tiles: ArrayLike<number>, w: number, h: number, c: BorderClasses, sis: StandIns): void {
  const n = w * h;
  const kx = new Int16Array(n), ky = new Int16Array(n), kt = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const k = cellKind(c, tiles[i]); kx[i] = k.x; ky[i] = k.y; kt[i] = k.t ? 1 : 0; }
  // Per pair, the box of its transition cells: those with both grounds next to them, and (kept apart) those with one
  // within two cells only — a drawn border two cells thick has its pieces between the two. The second are used only
  // for a pair the map shows none of the first for: they read more loosely.
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const near1 = new Map<string, Box>(), near2 = new Map<string, Box>();
  for (let i = 0; i < n; i++) {
    if (!kt[i]) continue;
    const x = i % w, y = (i / w) | 0;
    for (const r of [1, 2]) {
      let xs = -1, ys = -1, many = false;
      for (let dy = -r; dy <= r && !many; dy++) for (let dx = -r; dx <= r; dx++) {
        if (r === 1 && dx !== 0 && dy !== 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (kx[j] >= 0) { if (xs >= 0 && xs !== kx[j]) many = true; xs = kx[j]; }
        if (ky[j] >= 0) { if (ys >= 0 && ys !== ky[j]) many = true; ys = ky[j]; }
      }
      if (many) break;
      if (xs < 0 || ys < 0) continue;
      const into = r === 1 ? near1 : near2;
      const key = pairKey(xs >> 10, xs & 1023, ys);
      const b = into.get(key);
      if (b) { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); }
      else into.set(key, { x0: x, y0: y, x1: x, y1: y });
      break;
    }
  }
  const boxes = new Map(near1);
  for (const [key, b] of near2) if (!boxes.has(key)) boxes.set(key, b);
  for (const [key, box] of boxes) {
    const { sourceEra, x: X, y: Y } = pairOf(key);
    const si = pairStandIn(sis, c, sourceEra, X, Y);
    const XP = (sourceEra << 10) | X;
    // the window around the pair's transition cells, lined up so the lattice keeps its parity
    const m = 6;
    const x0 = Math.max(0, Math.floor((box.x0 - m) / 4) * 4), y0 = Math.max(0, Math.floor((box.y0 - m) / 2) * 2);
    const x1 = Math.min(w, box.x1 + 1 + m), y1 = Math.min(h, box.y1 + 1 + m);
    const ww = (x1 - x0) & 1 ? Math.min(w - x0, x1 - x0 + 1) : x1 - x0, wh = y1 - y0;
    const cls = new Uint8Array(ww * wh);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const i = (y0 + y) * w + x0 + x;
      cls[y * ww + x] = kx[i] === XP ? C_X : ky[i] === Y ? C_Y : kt[i] ? C_T : C_O;
    }
    const near = nearBoth(cls, ww, wh, 2);
    let pair = into.pairs.get(key);
    if (!pair) into.pairs.set(key, (pair = { maps: 0, modes: BORDER_MODES.map(() => new Map()) }));
    pair.maps++;
    BORDER_MODES.forEach((mode, mi) => {
      const { shapes } = standInShapes(si, { x0: 0, y0: 0, w: ww, h: wh }, diamondsOf(cls, ww, wh, mode));
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i];
        if (!s || !near[i] || cls[i] !== C_T) continue;
        const tile = tiles[(y0 + ((i / ww) | 0)) * w + x0 + (i % ww)];
        let byTile = pair!.modes[mi].get(s.shape);
        if (!byTile) pair!.modes[mi].set(s.shape, (byTile = new Map()));
        byTile.set(tile, (byTile.get(tile) ?? 0) + 1);
      }
    });
  }
}

/** Cells within `r` 8-neighbour steps of both an X cell and a Y cell: where a border between them can run. */
function nearBoth(cls: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const dist = (want: number) => {
    const d = new Int32Array(w * h).fill(1e9);
    const q: number[] = [];
    for (let i = 0; i < w * h; i++) if (cls[i] === want) { d[i] = 0; q.push(i); }
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = i % w, y = (i / w) | 0;
      if (d[i] >= r) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && d[ny * w + nx] > d[i] + 1) { d[ny * w + nx] = d[i] + 1; q.push(ny * w + nx); }
      }
    }
    return d;
  };
  const dx = dist(C_X), dy = dist(C_Y);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (dx[i] <= r && dy[i] <= r) out[i] = 1;
  return out;
}

/** `from` added into `into`. */
export function mergeBorderEvidence(into: BorderEvidence, from: BorderEvidence): BorderEvidence {
  for (const [key, p] of from.pairs) {
    let q = into.pairs.get(key);
    if (!q) into.pairs.set(key, (q = { maps: 0, modes: BORDER_MODES.map(() => new Map()) }));
    q.maps += p.maps;
    p.modes.forEach((shapes, mi) => {
      for (const [shape, tiles] of shapes) {
        let t = q!.modes[mi].get(shape);
        if (!t) q!.modes[mi].set(shape, (t = new Map()));
        for (const [tile, n] of tiles) t.set(tile, (t.get(tile) ?? 0) + n);
      }
    });
  }
  return into;
}

/** The evidence as plain data (JSON), for IndexedDB. */
export function encodeBorderEvidence(e: BorderEvidence): string {
  return JSON.stringify({ v: 1, pairs: [...e.pairs].map(([k, p]) => [k, p.maps, p.modes.map((m) => [...m].map(([s, t]) => [s, [...t].flat()]))]) });
}
export function decodeBorderEvidence(text: unknown): BorderEvidence | null {
  if (typeof text !== "string") return null;
  try {
    const d = JSON.parse(text) as { v: number; pairs: [string, number, [string, number[]][][]][] };
    if (d.v !== 1 || !Array.isArray(d.pairs)) return null;
    const out = emptyBorderEvidence();
    for (const [k, maps, modes] of d.pairs) {
      out.pairs.set(k, { maps, modes: BORDER_MODES.map((_, mi) => new Map((modes[mi] ?? []).map(([s, flat]) => {
        const t = new Map<number, number>();
        for (let i = 0; i + 1 < flat.length; i += 2) t.set(flat[i], flat[i + 1]);
        return [s, t];
      }))) });
    }
    return out;
  } catch {
    return null;
  }
}

/** A pair's table: the reading it uses, and per shape the tiles laid there, most laid first, with the times. */
export interface BorderPairTable {
  key: string;
  x: number;
  y: number;
  sourceEra: number;
  mode: BorderMode;
  shapes: Map<string, [tile: number, laid: number][]>;
  /** Where it came from: `"maps"`, a plugin's id, or `@dataset:<id>`. */
  from: string;
}

/**
 * The tables the evidence gives: per pair, the reading whose tiles keep to one shape the most (a tile laid in two
 * shapes is a misreading of one of them). A pair seen on fewer than `minMaps` maps is left out.
 */
export function cutBorderTables(e: BorderEvidence, minMaps = 1): BorderPairTable[] {
  const out: BorderPairTable[] = [];
  for (const [key, p] of e.pairs) {
    if (p.maps < minMaps) continue;
    let best: { mode: BorderMode; consistency: number; shapes: Map<string, Map<number, number>> } | null = null;
    p.modes.forEach((shapes, mi) => {
      const byTile = new Map<number, number[]>();
      for (const t of shapes.values()) for (const [tile, n] of t) { const l = byTile.get(tile); if (l) l.push(n); else byTile.set(tile, [n]); }
      let all = 0, top = 0;
      for (const l of byTile.values()) { all += l.reduce((a, b) => a + b, 0); top += Math.max(...l); }
      const consistency = all ? top / all : 0;
      if (shapes.size > 0 && (!best || consistency > best.consistency)) best = { mode: BORDER_MODES[mi], consistency, shapes };
    });
    if (!best) continue;
    const { x, y, sourceEra } = pairOf(key);
    const b = best as { mode: BorderMode; shapes: Map<string, Map<number, number>> };
    out.push({ key, x, y, sourceEra, mode: b.mode, from: "maps", shapes: new Map([...b.shapes].map(([s, t]) => [s, [...t].sort((a, b) => b[1] - a[1] || a[0] - b[0])])) });
  }
  return out;
}

/**
 * Further candidates from the sheet: the untyped tiles, no copy of the source's pictures, in groups within `reach` of a
 * group the table names — the rest of a drawn set the maps do not show whole. Doodad groups left out.
 */
export function sheetPool(c: BorderClasses, table: BorderPairTable, reach = 2): number[] {
  const host = c.host;
  const known = new Set<number>();
  const groups = new Set<number>();
  for (const tiles of table.shapes.values()) for (const [id] of tiles) { known.add(id); for (let d = -reach; d <= reach; d++) groups.add((id >> 4) + d); }
  const out: number[] = [];
  for (const g of [...groups].sort((a, b) => a - b)) {
    const grp = host.groups[g];
    if (!grp || grp.index !== 0) continue;
    for (let s = 0; s < 16; s++) {
      const m = grp.megatiles[s];
      const id = (g << 4) | s;
      if (!m || m >= host.megatileCount || c.anyCopy.has(m) || typedFlat(host).typed.has(m) || known.has(id)) continue;
      out.push(id);
    }
  }
  return out;
}

/**
 * What a borrowed stroke needs to draw borders for one host and one source: the tables by pair (`pairKey`), the
 * stand-ins, the classes the tables were read with (for a pair's stand-in and the sheet's pool) and the pools, cut when
 * first asked (`poolOf`).
 */
export interface BorderSetup {
  tables: ReadonlyMap<string, BorderPairTable>;
  standIns: StandIns;
  classes: BorderClasses;
  pools: Map<BorderPairTable, number[]>;
}

export function poolOf(setup: BorderSetup, table: BorderPairTable): number[] {
  let pool = setup.pools.get(table);
  if (!pool) setup.pools.set(table, (pool = sheetPool(setup.classes, table)));
  return pool;
}
