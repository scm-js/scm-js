/**
 * Copied terrain, the table: a tileset that holds one of its own typed terrains again under other flags (an untyped
 * flat pair whose every picture is the terrain's — `palette.ts#terrainCopies`, "Mud (mid ground)") often holds that
 * terrain's edge set again beside it: untyped tiles that keep each edge piece's picture where the piece shows the
 * terrain, and show some other ground where it showed the terrain the set joins it to. This module finds those blocks
 * of tiles from the tileset's files alone, maps each piece of the edge set to the tile standing for it, and says
 * whether the block can be offered (`gateBlock`). `terrainCopyLattice.ts` is the brush that lays them.
 *
 * Nothing here knows a mod: a block is found by its pixels (whole 4 × 4 blocks kept at the same place), its flags (raised
 * as the copy is) and its layout (learned from the pieces it matches), never by a group number. Measured and
 * controlled in a spike (`.claude/internals/terrain.md` "Copied terrain"): synthetic mods in three layouts, the game's
 * own twins (High Jungle is Jungle's pictures) made anonymous, and a mod's hand-made correspondence.
 *
 * Kept free of the scenario and the i18n catalogue: the scan's worker (`borrowWorker.ts`) runs `findCopyBlocks`.
 * Pure and canvas-free; `tests/terrain-copies.test.ts`.
 */
import { GroupFlag, megatileHeight, minitileHeight, TileFlag, type Tileset } from "../formats/tileset/decode";
import { ISOM_TABLES } from "../data/isomTables";

/* ── Constants (each with its measurement in the internals note) ──────────── */

/** A pair (tile, piece) needs this many whole 4 × 4 pixel blocks of the piece kept at the same place. */
export const KEPT_BLOCKS = 2;
/** A tile's best pieces: those keeping within this many pixels of its best. */
export const TIE_PX = 16;
/** Groups holding candidates belong to one block unless more than this many in a row hold none. */
export const CLUSTER_GAP = 3;
/** A layout entry (a half's row, a variant's slot) is believed with this share of the votes. */
export const LAYOUT_AGREE = 0.6;
/** How far past a block's own groups the layout may place a piece. */
export const BLOCK_REACH = 2;
/** A block needs pieces found by pixels for at least this many of the set's halves… */
export const MIN_SHAPES = 4;
/** …and for at least this share of them. */
export const MIN_SHARE = 0.5;
/** The gate: this share of the drawn pieces' minitiles must walk as the source piece and stand as high as the copy raises it. */
export const GATE_FLAGS = 0.99;

const SOFT = 48;
const SIDES = ["left", "top", "right", "bottom"] as const;

/* ── Types ──────────────────────────────────────────────── */

/** A flat copy (`palette.ts#TerrainCopy`): the copy's even group, the typed terrain it copies and that terrain's group. */
export interface CopySource { group: number; source: number; sourceGroup: number }

export type CopyStatus = "complete" | "incomplete" | "rejected";

/** One block of a tileset standing for an edge set of one of its terrains, at the copy's height. JSON-able. */
export interface CopyBlock {
  /** A key that survives the tileset's groups moving: two hashes of the block's tiles' pictures (`blockKey`). */
  key: string;
  /** The copied terrain S (CV5 index), the copy S′'s even group and its height (VF4: 0 low, 1 mid, 2 high). */
  source: number;
  flat: number;
  height: number;
  /** How much higher the copy stands than S. */
  raise: number;
  /** The edge set E (CV5 index) and its other terrain O. */
  set: number;
  other: number;
  /** The tileset's groups the block was found in. */
  first: number;
  last: number;
  /** Piece of E (`group << 4 | slot`) → the tile standing for it. Pieces that are S alone map to the copy's own tile. */
  pieces: [number, number][];
  /** E's halves (groups) the brush can ask for, and those of them with no tile at all. */
  askable: number[];
  missing: number[];
  /** The gate's measures: share of minitiles with the source's walk bit and the copy's raise; share of pieces whose buildable bit changes as the copy's. */
  flags: number;
  build: number;
  status: CopyStatus;
}

/* ── A tileset's own typed sets ──────────────────────────── */

/** The flat terrains by the era's ISOM numbering (first 1,024 groups, as `isom.ts#buildLinks`): index → first even group; soft link → index. */
export function flatTerrainsOf(ts: Tileset, era: number): { flatGroup: Map<number, number>; softTo: Map<number, number>; linkOf: Map<number, number> } {
  const types = ISOM_TABLES[era & 7].terrainTypes;
  const half = Math.floor(types.length / 2);
  const flat = new Set(types.filter((t, i) => i >= 1 && i <= half && t.isomValue !== 0).map((t) => t.index));
  const flatGroup = new Map<number, number>(), softTo = new Map<number, number>(), linkOf = new Map<number, number>();
  for (let g = 0; g < Math.min(1024, ts.groups.length); g += 2) {
    const grp = ts.groups[g], e = grp.edges;
    if (!flat.has(grp.index) || flatGroup.has(grp.index)) continue;
    if (e.left !== e.top || e.left !== e.right || e.left !== e.bottom || e.left > SOFT) continue;
    flatGroup.set(grp.index, g);
    softTo.set(e.left, grp.index);
    linkOf.set(grp.index, e.left);
  }
  return { flatGroup, softTo, linkOf };
}

export interface EdgeSetInfo {
  index: number;
  /** The flat terrains its soft links name. */
  terrains: number[];
  /** Even groups (a rect's left half; the right is the next group). */
  groups: number[];
  /** Its two terrains stand at different heights: a cliff set. */
  cliff: boolean;
}

/** The tileset's edge sets (the era's second half of terrain types), read off its own CV5. */
export function edgeSetsOf(ts: Tileset, era: number): EdgeSetInfo[] {
  const types = ISOM_TABLES[era & 7].terrainTypes;
  const half = Math.floor(types.length / 2);
  const { softTo, flatGroup } = flatTerrainsOf(ts, era);
  const heightOf = (t: number) => { const g = flatGroup.get(t); const m = g === undefined ? 0 : ts.groups[g].megatiles.find((x) => x !== 0) ?? 0; return m ? megatileHeight(ts, m) : -1; };
  const out: EdgeSetInfo[] = [];
  for (const t of types.slice(half + 1)) {
    if (t.isomValue === 0) continue;
    const groups: number[] = [];
    for (let g = 0; g < Math.min(1024, ts.groups.length); g += 2) if (ts.groups[g].index === t.index) groups.push(g);
    if (groups.length === 0) continue;
    const terrains: number[] = [];
    for (const g of groups) for (const s of SIDES) {
      const l = ts.groups[g].edges[s];
      const terr = l <= SOFT ? softTo.get(l) : undefined;
      if (terr !== undefined && !terrains.includes(terr)) terrains.push(terr);
    }
    out.push({ index: t.index, terrains, groups, cliff: terrains.length >= 2 && new Set(terrains.map(heightOf)).size > 1 });
  }
  return out;
}

/* ── Pictures ───────────────────────────────────────────── */

interface Pix { pix: Uint8Array; hashes: Uint32Array }
const pixCache = new WeakMap<Tileset, Pix>();

/** Every megatile's 1,024 palette indices (the flip applied) and a hash per 8 × 8 minitile at its place. */
function picturesOf(ts: Tileset): Pix {
  const hit = pixCache.get(ts);
  if (hit) return hit;
  const pix = new Uint8Array(ts.megatileCount * 1024);
  const hashes = new Uint32Array(ts.megatileCount * 16);
  for (let m = 0; m < ts.megatileCount; m++) for (let i = 0; i < 16; i++) {
    const ref = ts.megatileRefs[m * 16 + i] ?? 0;
    const flip = (ref & 1) === 1, from = (ref >>> 1) * 64, ox = (i & 3) * 8, oy = (i >> 2) * 8;
    let h = 0x811c9dc5;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = ts.minitiles[from + y * 8 + (flip ? 7 - x : x)] ?? 0;
      pix[m * 1024 + (oy + y) * 32 + ox + x] = v;
      h = Math.imul(h ^ v, 0x01000193);
    }
    hashes[m * 16 + i] = h >>> 0;
  }
  const out = { pix, hashes };
  pixCache.set(ts, out);
  return out;
}

/** A megatile's picture as a key (two hashes of its 1,024 pixels). */
export function pictureKeyOf(ts: Tileset, m: number): string {
  const { pix } = picturesOf(ts);
  let h1 = 0x811c9dc5, h2 = 7;
  for (let i = 0; i < 1024; i++) { const v = pix[m * 1024 + i]; h1 = Math.imul(h1 ^ v, 0x01000193); h2 = Math.imul(h2 + v, 2654435761) ^ (h2 >>> 15); }
  return `${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}`;
}

/** Kept pixels and wholly kept 4 × 4 blocks of m against e; `mask` gets the kept pixels. */
function kept(pix: Uint8Array, m: number, e: number, mask: Uint8Array): { px: number; blocks: number } {
  let px = 0;
  const mo = m * 1024, eo = e * 1024;
  for (let i = 0; i < 1024; i++) { const k = pix[mo + i] === pix[eo + i] ? 1 : 0; mask[i] = k; px += k; }
  let blocks = 0;
  for (let by = 0; by < 32; by += 4) for (let bx = 0; bx < 32; bx += 4) {
    let whole = true;
    for (let y = 0; y < 4 && whole; y++) for (let x = 0; x < 4; x++) if (!mask[(by + y) * 32 + bx + x]) { whole = false; break; }
    if (whole) blocks++;
  }
  return { px, blocks };
}

/** How much higher m stands than e where m keeps e's minitiles whole (majority); the megatiles' difference when none is whole. */
function keptRaise(ts: Tileset, m: number, e: number, mask: Uint8Array): number {
  const counts = new Map<number, number>();
  for (let i = 0; i < 16; i++) {
    const ox = (i & 3) * 8, oy = (i >> 2) * 8;
    let whole = true;
    for (let y = 0; y < 8 && whole; y++) for (let x = 0; x < 8; x++) if (!mask[(oy + y) * 32 + ox + x]) { whole = false; break; }
    if (whole) { const d = minitileHeight(ts, m, i) - minitileHeight(ts, e, i); counts.set(d, (counts.get(d) ?? 0) + 1); }
  }
  if (counts.size === 0) return megatileHeight(ts, m) - megatileHeight(ts, e);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** The rect hash `isom.ts` looks a rect's tile group up by (six bits a link, the set's index when any link is hard). */
function linkHash(ts: Tileset, g: number): number {
  const l = ts.groups[g].edges;
  const anyHard = l.left >= SOFT || l.top >= SOFT || l.right >= SOFT || l.bottom >= SOFT;
  return ((((((((l.left << 6) | l.top) << 6) | l.right) << 6) | l.bottom) << 6) | (anyHard ? ts.groups[g].index : 0)) >>> 0;
}

/* ── The rule ───────────────────────────────────────────── */

export interface FindOptions {
  /** Awaited between edge sets (the page's sliced path gives a frame there). */
  pause?: () => Promise<void>;
  signal?: AbortSignal;
}

/**
 * The blocks standing for an edge set of a copied terrain, flat-to-flat sets only (a cliff set's faces carry their own
 * walk and height bits: measured, none passes the gate). Each block is mapped piece by piece and gated; blocks that
 * did not reach `MIN_SHAPES` / `MIN_SHARE`, or lost their groups to another set of the same copy, are left out.
 */
export async function findCopyBlocks(ts: Tileset, era: number, copies: readonly CopySource[], opts: FindOptions = {}): Promise<CopyBlock[]> {
  if (copies.length === 0) return [];
  const { pix, hashes } = picturesOf(ts);
  const mask = new Uint8Array(1024);
  // Candidates: megatiles of untyped groups no typed group uses, the copies themselves left out.
  const typed = new Set<number>();
  for (const g of ts.groups) if (g.index > 0) for (const m of g.megatiles) typed.add(m);
  const copyMegas = new Set<number>();
  for (const c of copies) for (const half of [c.group, c.group + 1]) for (const m of ts.groups[half]?.megatiles ?? []) copyMegas.add(m);
  const candidates = new Map<number, number>();
  for (let g = 0; g < ts.groups.length; g++) {
    if (ts.groups[g].index !== 0) continue;
    ts.groups[g].megatiles.forEach((m, s) => {
      if (!m || m >= ts.megatileCount || typed.has(m) || copyMegas.has(m) || candidates.has(m)) return;
      candidates.set(m, (g << 4) | s);
    });
  }
  const candIndex = new Map<number, number[]>();
  for (const m of candidates.keys()) for (let i = 0; i < 16; i++) {
    const k = hashes[m * 16 + i] * 16 + i;
    const l = candIndex.get(k);
    if (l) l.push(m); else candIndex.set(k, [m]);
  }
  const groupOf = (m: number) => candidates.get(m)! >> 4;
  const sets = edgeSetsOf(ts, era).filter((s) => !s.cliff && s.terrains.length === 2);

  const results: (CopyBlock & { votes: number; claims: Map<number, number>; share: number })[] = [];
  for (const copy of copies) {
    const height = megatileHeight(ts, ts.groups[copy.group].megatiles.find((m) => m !== 0)!);
    const raise = height - megatileHeight(ts, ts.groups[copy.sourceGroup].megatiles.find((m) => m !== 0)!);
    const sPictures = new Set<string>();
    for (const half of [copy.sourceGroup, copy.sourceGroup + 1]) for (const m of ts.groups[half].megatiles) if (m) sPictures.add(pictureKeyOf(ts, m));
    const flatTile = new Map<string, number[]>();
    for (const half of [copy.group, copy.group + 1]) ts.groups[half].megatiles.forEach((m, s) => { if (!m) return; const k = pictureKeyOf(ts, m); const l = flatTile.get(k) ?? []; l.push((half << 4) | s); flatTile.set(k, l); });
    for (const set of sets) {
      if (!set.terrains.includes(copy.source)) continue;
      if (opts.signal?.aborted) throw Object.assign(new Error("stopped"), { name: "AbortError" });
      await opts.pause?.();
      const other = set.terrains.find((t) => t !== copy.source)!;
      const pieces: { g: number; s: number; m: number; alone: boolean }[] = [];
      for (const g of set.groups) for (const half of [g, g + 1]) ts.groups[half].megatiles.forEach((m, s) => { if (m) pieces.push({ g: half, s, m, alone: sPictures.has(pictureKeyOf(ts, m)) }); });
      // 1. pairs sharing a whole minitile at the same place, kept by whole 4 × 4 blocks, raised as the copy is
      const score = new Map<number, Map<number, { px: number; blocks: number }>>();
      for (const e of new Set(pieces.filter((p) => !p.alone).map((p) => p.m))) {
        const ms = new Set<number>();
        for (let i = 0; i < 16; i++) for (const m of candIndex.get(hashes[e * 16 + i] * 16 + i) ?? []) ms.add(m);
        for (const m of ms) {
          const k = kept(pix, m, e, mask);
          if (k.blocks < KEPT_BLOCKS || keptRaise(ts, m, e, mask) !== raise) continue;
          let row = score.get(m);
          if (!row) score.set(m, (row = new Map()));
          row.set(e, k);
        }
      }
      const bestOf = new Map<number, Set<number>>();
      for (const [m, row] of score) {
        const top = Math.max(...[...row.values()].map((k) => k.px));
        bestOf.set(m, new Set([...row].filter(([, k]) => k.px >= top - TIE_PX).map(([e]) => e)));
      }
      // 2. blocks: the groups holding candidates, cut where more than CLUSTER_GAP groups hold none
      const gs = [...new Set([...score.keys()].map(groupOf))].sort((a, b) => a - b);
      const clusters: [number, number][] = [];
      for (const g of gs) { const c = clusters[clusters.length - 1]; if (c && g - c[1] <= CLUSTER_GAP) c[1] = g; else clusters.push([g, g]); }
      for (const [c0, c1] of clusters) {
        const inC = (m: number) => { const g = groupOf(m); return g >= c0 && g <= c1; };
        const byE = new Map<number, { m: number; px: number; blocks: number }[]>();
        for (const [m, es] of bestOf) if (inC(m)) for (const e of es) { const l = byE.get(e) ?? []; l.push({ m, ...score.get(m)!.get(e)! }); byE.set(e, l); }
        const rowVotesOf = new Map<number, Map<number, number>>();
        for (const p of pieces) {
          const l = byE.get(p.m) ?? [];
          const top = Math.max(-1, ...l.map((c) => c.px));
          const best = l.filter((c) => c.px === top);
          if (best.length !== 1 || bestOf.get(best[0].m)!.size !== 1) continue;
          const lv = rowVotesOf.get(p.g & ~1) ?? new Map<number, number>();
          lv.set(groupOf(best[0].m), (lv.get(groupOf(best[0].m)) ?? 0) + 1);
          rowVotesOf.set(p.g & ~1, lv);
        }
        const found = new Map<string, { g: number; s: number; m: number; mm: number; tile: number; px: number; how: "pixels" | "layout" | "flat" }>();
        for (const p of pieces) {
          if (p.alone) continue;
          const l = byE.get(p.m) ?? [];
          if (l.length === 0) continue;
          const lv = rowVotesOf.get(p.g & ~1);
          const c = [...l].sort((a, b) => b.px - a.px || (lv?.get(groupOf(b.m)) ?? 0) - (lv?.get(groupOf(a.m)) ?? 0) || candidates.get(a.m)! - candidates.get(b.m)!)[0];
          found.set(`${p.g}.${p.s}`, { g: p.g, s: p.s, m: p.m, mm: c.m, tile: candidates.get(c.m)!, px: c.px, how: "pixels" });
        }
        const shapes = new Set([...found.values()].map((f) => f.g));
        const halvesTotal = new Set(pieces.filter((p) => !p.alone).map((p) => p.g)).size;
        if (shapes.size < MIN_SHAPES || shapes.size < MIN_SHARE * halvesTotal) continue;
        // 3. the layout, learned from those matches: each half's row, each variant's slot by side, the row step between halves
        const learn = () => {
          const rows = new Map<number, Map<number, number>>(), slots = new Map<string, Map<number, number>>();
          const vote = <K,>(map: Map<K, Map<number, number>>, k: K, v: number) => { const x = map.get(k) ?? new Map<number, number>(); x.set(v, (x.get(v) ?? 0) + 1); map.set(k, x); };
          for (const f of found.values()) { vote(rows, f.g, f.tile >> 4); vote(slots, `${f.g & 1}.${f.s}`, f.tile & 15); }
          const agreed = (x: Map<number, number> | undefined): number | null => {
            if (!x || x.size === 0) return null;
            const tot = [...x.values()].reduce((a, b) => a + b, 0);
            const [v, n] = [...x].sort((a, b) => b[1] - a[1])[0];
            return n / tot >= LAYOUT_AGREE && (tot >= 2 || x.size === 1) ? v : null;
          };
          const rowOf = new Map<number, number>();
          for (const [h, x] of rows) { const v = agreed(x); if (v !== null) rowOf.set(h, v); }
          const deltas = new Map<number, number>();
          for (const [h, r] of rowOf) if (!(h & 1) && rowOf.has(h + 1)) deltas.set(rowOf.get(h + 1)! - r, (deltas.get(rowOf.get(h + 1)! - r) ?? 0) + 1);
          const delta = agreed(deltas);
          return (g: number, s: number): number | null => {
            let row = rowOf.get(g) ?? null;
            if (row === null && delta !== null) { const partner = rowOf.get(g ^ 1); if (partner !== undefined) row = g & 1 ? partner + delta : partner - delta; }
            const slot = agreed(slots.get(`${g & 1}.${s}`));
            if (row === null || slot === null || row < c0 - BLOCK_REACH || row > c1 + BLOCK_REACH) return null;
            return (row << 4) | slot;
          };
        };
        {
          // variants that keep the same S part tie: the layout says which is whose
          const at = learn();
          for (const p of pieces) {
            const f = found.get(`${p.g}.${p.s}`), want = at(p.g, p.s);
            if (!f || want === null || f.tile === want) continue;
            const c = (byE.get(p.m) ?? []).find((x) => candidates.get(x.m) === want && x.px >= f.px - TIE_PX);
            if (c) found.set(`${p.g}.${p.s}`, { ...f, tile: want, mm: c.m, px: c.px });
          }
        }
        const predict = learn();
        const usedM = new Set([...found.values()].map((f) => f.mm));
        for (const p of pieces) {
          if (p.alone || found.has(`${p.g}.${p.s}`)) continue;
          const tile = predict(p.g, p.s);
          if (tile === null) continue;
          const mm = ts.groups[tile >> 4]?.megatiles[tile & 15];
          if (!mm || !candidates.has(mm) || usedM.has(mm) || megatileHeight(ts, mm) - megatileHeight(ts, p.m) !== raise) continue;
          found.set(`${p.g}.${p.s}`, { g: p.g, s: p.s, m: p.m, mm, tile, px: kept(pix, mm, p.m, mask).px, how: "layout" });
        }
        for (const p of pieces) {
          if (!p.alone) continue;
          const l = flatTile.get(pictureKeyOf(ts, p.m));
          if (!l) continue;
          const tile = l.find((t) => ((t >> 4) & 1) === (p.g & 1)) ?? l[0];
          found.set(`${p.g}.${p.s}`, { g: p.g, s: p.s, m: p.m, mm: ts.groups[tile >> 4].megatiles[tile & 15], tile, px: 1024, how: "flat" });
        }
        // 4. the gate
        const piecesOut: [number, number][] = [...found.values()].map((f) => [(f.g << 4) | f.s, f.tile] as [number, number]).sort((a, b) => a[0] - b[0]);
        const gate = gateBlock(ts, era, { source: copy.source, flat: copy.group, raise, set: set.index, pieces: piecesOut });
        const claims = new Map<number, number>();
        for (const f of found.values()) if (f.how === "pixels") claims.set(f.mm, Math.max(claims.get(f.mm) ?? 0, f.px));
        results.push({
          key: blockKey(ts, piecesOut.map(([, t]) => t)), source: copy.source, flat: copy.group, height, raise, set: set.index, other,
          first: c0, last: c1, pieces: piecesOut, ...gate,
          votes: 0, claims, share: shapes.size / Math.max(1, halvesTotal),
        });
      }
    }
  }
  // A block belongs to one set: each of its megatiles votes for the set one of whose pieces it keeps most of.
  const overlap = (a: CopyBlock, b: CopyBlock) => a.flat === b.flat && a.first <= b.last + BLOCK_REACH && a.last >= b.first - BLOCK_REACH;
  for (const r of results) {
    const rivals = results.filter((q) => q !== r && overlap(q, r));
    for (const [m, k] of r.claims) if (rivals.every((q) => (q.claims.get(m) ?? 0) <= k)) r.votes++;
  }
  const kept_ = results.filter((r) => !results.some((q) => q !== r && overlap(q, r) && (q.votes > r.votes || (q.votes === r.votes && q.set < r.set))));
  return kept_.map(({ votes: _v, claims: _c, share: _s, ...b }) => b);
}

const firstOfHashCache = new WeakMap<Tileset, Map<number, number>>();

/**
 * The gate: which of the set's halves the brush can ask for (the first group the tileset holds for its rect's link hash:
 * `IsomPass.updateTile` takes that one), which of them have no tile, and whether the drawn pieces walk as their source
 * pieces and stand as high as the copy raises them (`GATE_FLAGS` of the minitiles), their buildable bit changing as the
 * copy's does. "rejected" fails the flags (not offered), "incomplete" misses a shape (offered, marked), else "complete".
 * Pieces mapped to the copy's own tiles (S alone) are not drawn pieces.
 */
export function gateBlock(ts: Tileset, era: number, b: { source: number; flat: number; raise: number; set: number; pieces: readonly (readonly [number, number])[] }): Pick<CopyBlock, "askable" | "missing" | "flags" | "build" | "status"> {
  let firstOfHash = firstOfHashCache.get(ts);
  if (!firstOfHash) {
    firstOfHash = new Map();
    for (let g = 0; g + 1 < ts.groups.length; g += 2) { const h = linkHash(ts, g); if (!firstOfHash.has(h)) firstOfHash.set(h, g); }
    firstOfHashCache.set(ts, firstOfHash);
  }
  const set = edgeSetsOf(ts, era).find((s) => s.index === b.set);
  const askable = set ? [...new Set(set.groups.filter((g) => firstOfHash.get(linkHash(ts, g)) === g).flatMap((g) => [g, g + 1]))].sort((x, y) => x - y) : [];
  const withTile = new Set(b.pieces.map(([piece]) => piece >> 4));
  const missing = askable.filter((h) => !withTile.has(h));
  const unb = (g: number) => ((ts.groups[g]?.flags ?? 0) & GroupFlag.Unbuildable) !== 0;
  const buildFlip = copyBuildFlip(ts, era, b);
  let minis = 0, okMinis = 0, drawn = 0, okBuild = 0;
  for (const [piece, tile] of b.pieces) {
    const tg = tile >> 4;
    if ((tg & ~1) === b.flat) continue;
    const e = ts.groups[piece >> 4]?.megatiles[piece & 15] ?? 0, m = ts.groups[tg]?.megatiles[tile & 15] ?? 0;
    if (!e || !m) continue;
    drawn++;
    if ((unb(piece >> 4) !== unb(tg)) === buildFlip) okBuild++;
    for (let i = 0; i < 16; i++) {
      minis++;
      const walk = (ts.megatileFlags[e * 16 + i] & TileFlag.Walkable) === (ts.megatileFlags[m * 16 + i] & TileFlag.Walkable);
      if (walk && minitileHeight(ts, m, i) - minitileHeight(ts, e, i) === b.raise) okMinis++;
    }
  }
  const flags = minis ? okMinis / minis : 0, build = drawn ? okBuild / drawn : 0;
  const status: CopyStatus = flags < GATE_FLAGS || build < GATE_FLAGS ? "rejected" : missing.length > 0 ? "incomplete" : "complete";
  return { askable, missing, flags, build, status };
}

/** Whether the copy's buildable bit differs from its terrain's (the pieces' should differ from theirs the same way). */
function copyBuildFlip(ts: Tileset, era: number, b: { source: number; flat: number }): boolean {
  const unb = (g: number) => ((ts.groups[g]?.flags ?? 0) & GroupFlag.Unbuildable) !== 0;
  const sGroup = flatTerrainsOf(ts, era).flatGroup.get(b.source);
  return sGroup === undefined ? false : unb(b.flat) !== unb(sGroup);
}

/** Two hashes of a block's tiles' pictures, in order: the same block's key when a mod update moves its groups. */
export function blockKey(ts: Tileset, tiles: readonly number[]): string {
  let a = 0x811c9dc5, b = 0x2545f491;
  for (const t of tiles) {
    const m = ts.groups[t >> 4]?.megatiles[t & 15] ?? 0;
    for (const c of pictureKeyOf(ts, m)) { a = Math.imul(a ^ c.charCodeAt(0), 0x01000193); b = Math.imul(b ^ c.charCodeAt(0), 0x85ebca6b) ^ (b >>> 13); }
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

/** The blocks as kept (JSON). */
export const encodeCopyBlocks = (blocks: readonly CopyBlock[]): string => JSON.stringify(blocks);
/** The blocks back, or null when the text is not a list of them. */
export function decodeCopyBlocks(text: unknown): CopyBlock[] | null {
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((b): b is CopyBlock => typeof b === "object" && b !== null && typeof (b as CopyBlock).key === "string" && Array.isArray((b as CopyBlock).pieces));
  } catch {
    return null;
  }
}
