/**
 * The borrowed-terrain table (see `borrow.ts`): which host megatiles are copies of which source
 * megatiles, and which host tile stands for each source tile. Apart from the rest of `borrow.ts`
 * so the scan's worker (`services/borrowTable.worker.ts`) carries only this and the tileset
 * decoder. Pure and canvas-free; `tests/borrow.test.ts`.
 */
import { megatileForTile, type Tileset } from "../formats/tileset/decode";
import { kindKey } from "../formats/tileset/kind";

/** A copy's 4 × 4-pixel block means are within this much a channel of the source's, on average over the blocks. */
export const BORROW_BLOCK = 2.5;
/** …and its pixels within this much a channel, on average (the dither's own noise). */
export const BORROW_PIXEL = 10;
/**
 * Where a source picture has no copy, the nearest host picture within these bounds stands in for
 * it and is counted as a stand-in. (Installation's Substructure / Floor edge has two such tiles in
 * Cosmonarchy's Badlands, 5.2 and 7.5 off.)
 */
export const STAND_IN_BLOCK = 6;
export const STAND_IN_PIXEL = 12;
/** Host tiles kept per source tile: the brush picks among them by how they join their neighbours. */
const MAX_CHOICES = 8;

/* ── A tileset's content, as a key ──────────────────────── */

const hashes = new WeakMap<Tileset, string>();

/**
 * Two 32-bit hashes of everything a table depends on — the groups, the megatile references, the
 * minitile pixels, the palette and the flags — so a stored table is found again for the same
 * files and never for others.
 */
export function tilesetHash(ts: Tileset): string {
  const was = hashes.get(ts);
  if (was) return was;
  let a = 0x811c9dc5, b = 0x9e3779b9 ^ ts.groups.length;
  const word = (v: number) => {
    a = Math.imul(a ^ v, 0x01000193);
    b = Math.imul(b ^ (v + 0x9e37), 0x85ebca6b) ^ (b >>> 13);
  };
  for (const g of ts.groups) {
    word(g.index); word(g.flags);
    word(g.edges.left); word(g.edges.top); word(g.edges.right); word(g.edges.bottom);
    word(g.stack.left); word(g.stack.top); word(g.stack.right); word(g.stack.bottom);
    for (let m = 0; m < 16; m++) word(g.megatiles[m]);
  }
  for (let i = 0; i < ts.megatileRefs.length; i++) word(ts.megatileRefs[i]);
  for (let i = 0; i < ts.megatileFlags.length; i++) word(ts.megatileFlags[i]);
  for (let i = 0; i + 3 < ts.minitiles.length; i += 4) word(ts.minitiles[i] | (ts.minitiles[i + 1] << 8) | (ts.minitiles[i + 2] << 16) | (ts.minitiles[i + 3] << 24));
  for (let i = 0; i < 256; i++) word(ts.palette[i * 4] | (ts.palette[i * 4 + 1] << 8) | (ts.palette[i * 4 + 2] << 16));
  const out = `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
  hashes.set(ts, out);
  return out;
}

/* ── Pictures, summarised ───────────────────────────────── */

export interface Pictures {
  count: number;
  /** Per megatile the 64 sums of a 4 × 4 block's pixels, R G B: `blocks[m * 192 + block * 3 + channel]`. */
  blocks: Uint16Array;
  /** The mean of all its pixels and channels. */
  lum: Float32Array;
  /** Megatiles by `lum`, and their `lum` in that order: the search window. */
  byLum: Uint32Array;
  lumSorted: Float32Array;
}

/** Long work yields this often (ms) when given a pause. */
const SLICE_MS = 12;

export interface Slicing {
  /** Awaited between slices so the page can draw; a test passes nothing. */
  pause?(): Promise<void>;
  /** Told as the work goes: how far, of how far. */
  progress?(done: number, total: number): void;
}

async function sliced(total: number, work: (i: number) => void, slicing: Slicing | undefined, offset = 0, all = total): Promise<void> {
  let since = performance.now();
  for (let i = 0; i < total; i++) {
    work(i);
    if (slicing?.pause && performance.now() - since > SLICE_MS) {
      slicing.progress?.(offset + i, all);
      await slicing.pause();
      since = performance.now();
    }
  }
}

const pictureCache = new WeakMap<Tileset, Pictures>();

/** A tileset's pictures summarised for the copy test, worked out once per tileset. */
export async function picturesOf(ts: Tileset, slicing?: Slicing): Promise<Pictures> {
  const was = pictureCache.get(ts);
  if (was) return was;
  const count = ts.megatileCount;
  const blocks = new Uint16Array(count * 192);
  const lum = new Float32Array(count);
  const { palette, minitiles, megatileRefs } = ts;
  await sliced(count, (m) => {
    let total = 0;
    for (let mt = 0; mt < 16; mt++) {
      const ref = megatileRefs[m * 16 + mt] ?? 0;
      const flip = ref & 1, at = (ref >>> 1) * 64;
      const bx = (mt & 3) * 2, by = (mt >> 2) * 2;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const c = (minitiles[at + y * 8 + (flip ? 7 - x : x)] ?? 0) * 4;
          const o = m * 192 + ((by + (y >> 2)) * 8 + bx + (x >> 2)) * 3;
          blocks[o] += palette[c]; blocks[o + 1] += palette[c + 1]; blocks[o + 2] += palette[c + 2];
          total += palette[c] + palette[c + 1] + palette[c + 2];
        }
      }
    }
    lum[m] = total / 3072;
  }, slicing);
  const byLum = Uint32Array.from({ length: count }, (_, i) => i).sort((x, y) => lum[x] - lum[y]);
  const lumSorted = Float32Array.from(byLum, (i) => lum[i]);
  const out = { count, blocks, lum, byLum, lumSorted };
  pictureCache.set(ts, out);
  return out;
}

/** A megatile's RGB pixels, 32 × 32 × 3. */
function rgbOf(ts: Tileset, m: number, out = new Uint8Array(3072)): Uint8Array {
  const { palette, minitiles, megatileRefs } = ts;
  for (let mt = 0; mt < 16; mt++) {
    const ref = megatileRefs[m * 16 + mt] ?? 0;
    const flip = ref & 1, at = (ref >>> 1) * 64;
    const bx = (mt & 3) * 8, by = (mt >> 2) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const c = (minitiles[at + y * 8 + (flip ? 7 - x : x)] ?? 0) * 4;
        const o = ((by + y) * 32 + bx + x) * 3;
        out[o] = palette[c]; out[o + 1] = palette[c + 1]; out[o + 2] = palette[c + 2];
      }
    }
  }
  return out;
}

/** Mean |Δ| of the 4 × 4 block means, or Infinity once it must exceed `limit`. */
function blockDistance(a: Pictures, am: number, b: Pictures, bm: number, limit: number): number {
  let sum = 0;
  const cap = limit * 16 * 192;
  const ao = am * 192, bo = bm * 192;
  for (let i = 0; i < 192; i++) {
    sum += Math.abs(a.blocks[ao + i] - b.blocks[bo + i]);
    if (sum > cap) return Infinity;
  }
  return sum / (16 * 192);
}

/** Mean |Δ| of the 8 × 8 block means (four blocks each): never more than `blockDistance`, so a cheap first test. */
function coarseWithin(a: Pictures, am: number, b: Pictures, bm: number, limit: number): boolean {
  let sum = 0;
  const cap = limit * 64 * 48;
  const ao = am * 192, bo = bm * 192;
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      for (let c = 0; c < 3; c++) {
        const i0 = ((cy * 2) * 8 + cx * 2) * 3 + c, i1 = i0 + 3, i2 = i0 + 24, i3 = i0 + 27;
        sum += Math.abs(a.blocks[ao + i0] + a.blocks[ao + i1] + a.blocks[ao + i2] + a.blocks[ao + i3] - b.blocks[bo + i0] - b.blocks[bo + i1] - b.blocks[bo + i2] - b.blocks[bo + i3]);
        if (sum > cap) return false;
      }
    }
  }
  return true;
}

function pixelDistance(a: Uint8Array, b: Uint8Array, limit: number): number {
  let sum = 0;
  const cap = limit * 3072;
  for (let i = 0; i < 3072; i++) {
    sum += Math.abs(a[i] - b[i]);
    if (sum > cap) return Infinity;
  }
  return sum / 3072;
}

export interface Copy {
  /** The host megatile. */
  m: number;
  /** Its block distance and pixel distance from the source's picture. */
  block: number;
  pixel: number;
}

/**
 * Every host megatile within `block` / `pixel` of source megatile `m`, nearest first. The overall
 * mean and the 8 × 8 means are never further apart than the 4 × 4 means, so the window on `lum`
 * and the coarse test lose nothing.
 */
export function copiesOf(source: Tileset, sp: Pictures, m: number, host: Tileset, hp: Pictures, block = BORROW_BLOCK, pixel = BORROW_PIXEL): Copy[] {
  const l = sp.lum[m];
  let lo = 0, hi = hp.count;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (hp.lumSorted[mid] < l - block) lo = mid + 1; else hi = mid; }
  const out: Copy[] = [];
  let srcRgb: Uint8Array | null = null;
  const hostRgb = new Uint8Array(3072);
  for (let i = lo; i < hp.count && hp.lumSorted[i] <= l + block; i++) {
    const c = hp.byLum[i];
    if (c === 0) continue; // the null megatile
    if (!coarseWithin(sp, m, hp, c, block)) continue;
    const d = blockDistance(sp, m, hp, c, block);
    if (d > block) continue;
    srcRgb ??= rgbOf(source, m);
    const p = pixelDistance(srcRgb, rgbOf(host, c, hostRgb), pixel);
    if (p <= pixel) out.push({ m: c, block: d, pixel: p });
  }
  return out.sort((x, y) => x.block - y.block || x.m - y.m);
}

/* ── The table ──────────────────────────────────────────── */

/**
 * How a source tile's host tile relates to it: the same megatile flags (VF4) and group flag word
 * (`"identical"`), the same VF4 under another flag word (`"vf4"`), the picture only (`"picture"`),
 * the nearest picture where there is no copy (`"standIn"`), or what a plugin said (`"provided"`).
 */
export type BorrowKind = "identical" | "vf4" | "picture" | "standIn" | "provided";
const KIND_CODES: readonly BorrowKind[] = ["identical", "vf4", "picture", "standIn", "provided"];

export interface BorrowTable {
  /** Source tile id → host tile ids showing its picture, all of one kind to the game, best first. */
  choices: Map<number, number[]>;
  /** How the choices relate to the source tile. */
  kinds: Map<number, BorrowKind>;
  /** Source megatile → host megatiles that are copies of it (stand-ins included): what the overwrite check reads. */
  copies: Map<number, number[]>;
}

/** Source tiles the brush can lay: tiles of typed groups (CV5 index ≥ 2) whose slot has a picture. */
export function sourceTiles(source: Tileset): number[] {
  const out: number[] = [];
  for (let g = 0; g < source.groups.length; g++) {
    const grp = source.groups[g];
    if (grp.index < 2) continue;
    for (let s = 0; s < 16; s++) if (grp.megatiles[s] !== 0 && grp.megatiles[s] < source.megatileCount) out.push((g << 4) | s);
  }
  return out;
}

const vf4Same = (a: Tileset, am: number, b: Tileset, bm: number) => {
  for (let i = 0; i < 16; i++) if (a.megatileFlags[am * 16 + i] !== b.megatileFlags[bm * 16 + i]) return false;
  return true;
};

/** Host megatile → the ground (non-doodad) tile ids that draw it, built once per host. */
const groundTilesCache = new WeakMap<Tileset, Map<number, number[]>>();
function groundTiles(host: Tileset): Map<number, number[]> {
  const was = groundTilesCache.get(host);
  if (was) return was;
  const out = new Map<number, number[]>();
  for (let g = 0; g < host.groups.length; g++) {
    if (host.groups[g].index === 1) continue;
    for (let s = 0; s < 16; s++) {
      const m = host.groups[g].megatiles[s];
      if (m === 0 || m >= host.megatileCount) continue;
      const list = out.get(m);
      if (list) list.push((g << 4) | s); else out.set(m, [(g << 4) | s]);
    }
  }
  groundTilesCache.set(host, out);
  return out;
}

/**
 * The table from `source` into `host`: for every source tile the brush can lay, the host tiles
 * showing a copy of its picture. Among them, a tile whose megatile's sixteen VF4 words and group
 * flag word equal the source's comes first; then the same VF4 words; then any. Only tiles of the
 * first one's kind to the game (`heal.ts#kindKey`) are kept, so choosing among them (which the
 * brush does, by how they join their neighbours) never changes how the ground walks or builds.
 * A source picture with no copy gets the nearest host picture within the stand-in bounds, else none.
 */
export async function borrowTable(host: Tileset, source: Tileset, slicing?: Slicing): Promise<BorrowTable> {
  const hp = await picturesOf(host, slicing && { pause: slicing.pause });
  const sp = await picturesOf(source);
  const ground = groundTiles(host);
  const tiles = sourceTiles(source);
  const megatiles = [...new Set(tiles.map((t) => source.groups[t >> 4].megatiles[t & 15]))];
  const copies = new Map<number, number[]>();
  const found = new Map<number, Copy[]>();
  const standIn = new Set<number>();
  await sliced(megatiles.length, (i) => {
    const m = megatiles[i];
    let list = copiesOf(source, sp, m, host, hp).filter((c) => ground.has(c.m));
    if (list.length === 0) {
      const near = copiesOf(source, sp, m, host, hp, STAND_IN_BLOCK, STAND_IN_PIXEL).filter((c) => ground.has(c.m));
      if (near.length > 0) { list = [near[0]]; standIn.add(m); }
    }
    found.set(m, list);
    if (list.length > 0) copies.set(m, list.map((c) => c.m));
  }, slicing, 0, megatiles.length);
  slicing?.progress?.(megatiles.length, megatiles.length);

  const choices = new Map<number, number[]>();
  const kinds = new Map<number, BorrowKind>();
  for (const t of tiles) {
    const m = source.groups[t >> 4].megatiles[t & 15];
    const list = found.get(m) ?? [];
    if (list.length === 0) continue;
    const flags = source.groups[t >> 4].flags;
    const rank = (hm: number, id: number) => (vf4Same(source, m, host, hm) ? (host.groups[id >> 4].flags === flags ? 0 : 1) : 2);
    const candidates: { id: number; rank: number; block: number }[] = [];
    for (const c of list) for (const id of ground.get(c.m) ?? []) candidates.push({ id, rank: rank(c.m, id), block: c.block });
    candidates.sort((a, b) => a.rank - b.rank || a.block - b.block || a.id - b.id);
    const first = candidates[0];
    const key = kindKey(host, first.id);
    const kept = candidates.filter((c) => c.rank === first.rank && kindKey(host, c.id) === key).slice(0, MAX_CHOICES).map((c) => c.id);
    choices.set(t, kept);
    kinds.set(t, standIn.has(m) ? "standIn" : first.rank === 0 ? "identical" : first.rank === 1 ? "vf4" : "picture");
  }
  return { choices, kinds, copies };
}

/**
 * A table a plugin hands in: source tile → host tile, as the author meant them. Kind
 * `"provided"`; the copies the check reads are the pairs' megatiles.
 */
export function providedTable(host: Tileset, source: Tileset, pairs: Iterable<readonly [number, number]>): BorrowTable {
  const choices = new Map<number, number[]>();
  const kinds = new Map<number, BorrowKind>();
  const copies = new Map<number, number[]>();
  for (const [s, h] of pairs) {
    const sm = megatileForTile(source, s), hm = megatileForTile(host, h);
    if (sm <= 0 || hm <= 0) continue;
    const list = choices.get(s);
    if (list) { if (!list.includes(h)) list.push(h); } else choices.set(s, [h]);
    kinds.set(s, "provided");
    const c = copies.get(sm);
    if (c) { if (!c.includes(hm)) c.push(hm); } else copies.set(sm, [hm]);
  }
  return { choices, kinds, copies };
}

/** The table as numbers, for keeping in IndexedDB. */
export function encodeBorrowTable(table: BorrowTable): Int32Array {
  const out: number[] = [1, table.choices.size];
  for (const [t, list] of table.choices) out.push(t, KIND_CODES.indexOf(table.kinds.get(t) ?? "picture"), list.length, ...list);
  out.push(table.copies.size);
  for (const [m, list] of table.copies) out.push(m, list.length, ...list);
  return Int32Array.from(out);
}

export function decodeBorrowTable(data: ArrayLike<number>): BorrowTable | null {
  if (data.length < 3 || data[0] !== 1) return null;
  const choices = new Map<number, number[]>();
  const kinds = new Map<number, BorrowKind>();
  const copies = new Map<number, number[]>();
  let i = 1;
  const n = data[i++];
  for (let k = 0; k < n; k++) {
    const t = data[i++], kind = KIND_CODES[data[i++]] ?? "picture", len = data[i++];
    const list: number[] = [];
    for (let j = 0; j < len; j++) list.push(data[i++]);
    choices.set(t, list); kinds.set(t, kind);
  }
  const c = data[i++];
  for (let k = 0; k < c; k++) {
    const m = data[i++], len = data[i++];
    const list: number[] = [];
    for (let j = 0; j < len; j++) list.push(data[i++]);
    copies.set(m, list);
  }
  return i === data.length ? { choices, kinds, copies } : null;
}

/** How many source tiles got each kind, and how many none. */
export function tableCounts(source: Tileset, table: BorrowTable): Record<BorrowKind | "none", number> {
  const out: Record<BorrowKind | "none", number> = { identical: 0, vf4: 0, picture: 0, standIn: 0, provided: 0, none: 0 };
  for (const t of sourceTiles(source)) {
    const k = table.kinds.get(t);
    out[k ?? "none"]++;
  }
  return out;
}

/** Whether a host tile is one the table writes, or a copy of one: true when `hostTile`'s picture is a copy of `sourceTile`'s. */
export function isCopyOf(table: BorrowTable, source: Tileset, sourceTile: number, host: Tileset, hostTile: number): boolean {
  const sm = megatileForTile(source, sourceTile), hm = megatileForTile(host, hostTile);
  if (sm <= 0 || hm <= 0) return false;
  return table.copies.get(sm)?.includes(hm) ?? false;
}
