/**
 * Copied terrain, the brush (the table is `terrainCopyTable.ts`): a copied terrain S is laid by the game's own
 * isometric brush on a *shadow* — a scenario in the tileset's own numbering filled with the edge set's other terrain O —
 * and each cell the shadow makes S or a piece of the edge set is written to the map translated: S to the copy's tile,
 * a piece to the tile the block holds for it. Cells the shadow leaves O are the map's own: the block's pieces were drawn
 * to meet its *outer ground* G, which the stroke lays first with the game's brush on the map's real ISOM when G is a
 * typed terrain (so the lattice says G under the patch and the game's brush borders it as G against everything
 * else), and which must already be there when G is an untyped pair (the lattice cannot hold it).
 *
 * The footprint — the diamonds painted, per block — is a member of the map's archive (`COPY_MEMBER`), as the borrowed
 * lattice is: saved, parked, undone through the history entry and sent on a shared map. After another isometric
 * stroke the patches it reached are laid again from what of their footprint the real lattice still holds as G
 * (`relayCopies`), in the same undo step.
 *
 * Which block, and which outer ground: a block's ground is the one on which painting the fixed strokes shows the
 * fewest joins (`paintCount`), the seam step against the pieces' outer sides breaking near-ties (`rankGrounds`); at
 * stroke time the block of the terrain whose count is lowest against the ground under the stroke is used.
 *
 * Pure and canvas-free; `tests/terrain-copies.test.ts`.
 */
import { createScenario } from "../formats/chk/create";
import type { Scenario } from "../formats/chk/scenario";
import { megatileForTile, tileGroupOf, type Tileset } from "../formats/tileset/decode";
import { flatTerrain } from "../formats/tileset/terrain";
import { isLoosePair } from "../formats/tileset/palette";
import { isomValueOf } from "../data/isomTables";
import { SEAM_SHOWS, seamStep, type Side } from "./blend";
import { diamondsOfRect, diamondValue, isomHeight, isomWidth, paintIsomDiamonds, tilesFromIsom, type Diamond } from "./isom";
import type { TileChange } from "./terrain";
import { BLOCK_REACH, flatTerrainsOf, type CopyBlock } from "./terrainCopyTable";

type Isomed = Scenario & { isom: Uint16Array };

/* ── Terrain ids ────────────────────────────────────────── */

/**
 * A terrain id at or above this names a copied terrain for the isometric brush: `COPIED_TERRAIN + (height << 8) + CV5
 * index`. The editor's own, never written to a map (as the pair and borrowed ids).
 */
export const COPIED_TERRAIN = 0x48000;
export const copiedTerrainId = (source: number, height: number): number => COPIED_TERRAIN + ((height & 3) << 8) + (source & 0xff);
export const isCopiedTerrain = (id: number): boolean => id >= COPIED_TERRAIN && id < COPIED_TERRAIN + (4 << 8);
export const copiedParts = (id: number): { source: number; height: number } => ({ source: (id - COPIED_TERRAIN) & 0xff, height: ((id - COPIED_TERRAIN) >> 8) & 3 });

/* ── Grounds ────────────────────────────────────────────── */

/** A ground a block can be drawn to meet: a typed flat terrain (`t<index>`) or an untyped flat pair (`p<even group>`). */
export interface CopyGround { id: string; kind: "typed" | "pair"; index: number; group: number }

/** A ground with what the seam step and the paint-and-count said of it. */
export interface RankedGround extends CopyGround { step: number; flags: number; count?: number }

const groundsCache = new WeakMap<Tileset, Map<string, CopyGround & { megas: number[] }>>();

/** The tileset's grounds: every typed flat terrain (all its flat groups) and every loose pair. */
export function groundsOf(ts: Tileset, era: number): Map<string, CopyGround & { megas: number[] }> {
  const hit = groundsCache.get(ts);
  if (hit) return hit;
  const { flatGroup } = flatTerrainsOf(ts, era);
  const out = new Map<string, CopyGround & { megas: number[] }>();
  for (let g = 0; g + 1 < Math.min(1024, ts.groups.length); g += 2) {
    const a = ts.groups[g], e = a.edges;
    if (!flatGroup.has(a.index) || e.left !== e.top || e.left !== e.right || e.left !== e.bottom) continue;
    const id = `t${a.index}`;
    const gr = out.get(id) ?? { id, kind: "typed" as const, index: a.index, group: flatGroup.get(a.index)!, megas: [] };
    for (const half of [g, g + 1]) for (const m of ts.groups[half].megatiles) if (m && !gr.megas.includes(m)) gr.megas.push(m);
    out.set(id, gr);
  }
  for (let g = 0; g + 1 < ts.groups.length; g += 2) {
    if (!isLoosePair(ts, g)) continue;
    const megas: number[] = [];
    for (const half of [g, g + 1]) for (const m of ts.groups[half].megatiles) if (m && !megas.includes(m)) megas.push(m);
    out.set(`p${g}`, { id: `p${g}`, kind: "pair", index: 0, group: g, megas });
  }
  groundsCache.set(ts, out);
  return out;
}

/** The ground a map tile is: its typed flat terrain, or the loose pair it belongs to; null for anything else. */
export function groundOfTile(ts: Tileset, era: number, tile: number): string | null {
  const g = tileGroupOf(tile, ts.groups.length) & ~1;
  const grp = ts.groups[g];
  if (!grp) return null;
  if (grp.index >= 2) { const id = `t${grp.index}`; return groundsOf(ts, era).has(id) && grp.edges.left === grp.edges.top && grp.edges.left === grp.edges.right ? id : null; }
  return groundsOf(ts, era).has(`p${g}`) ? `p${g}` : null;
}

/* ── The table a stroke reads ───────────────────────────── */

/** A block made ready to lay, with the outer ground it is laid against. */
export interface CopyTable {
  ts: Tileset;
  era: number;
  block: CopyBlock;
  /** S's typed flat groups (even), O's first flat group. */
  sGroups: Set<number>;
  oGroup: number;
  /** Piece → tile; per E half the tiles held for it (any slot). */
  tileOf: Map<number, number>;
  halfTiles: Map<number, number[]>;
  /** The copy's tiles by side (0 left, 1 right) and slot. */
  sTiles: [number[], number[]];
  outer: CopyGround;
  gTiles: [number[], number[]];
  /** The tiles a cell with no drawn piece chooses from (by its joins). */
  pool: number[];
}

const tilesOfGroup = (ts: Tileset, g: number) => { const out: number[] = []; ts.groups[g]?.megatiles.forEach((m, s) => { if (m) out.push((g << 4) | s); }); return out; };

export function copyTable(ts: Tileset, era: number, block: CopyBlock, outer: CopyGround): CopyTable {
  const sGroups = new Set<number>();
  for (let g = 0; g + 1 < Math.min(1024, ts.groups.length); g += 2) {
    const grp = ts.groups[g], e = grp.edges;
    if (grp.index === block.source && e.left === e.top && e.left === e.right && e.left === e.bottom) sGroups.add(g);
  }
  const oGroup = flatTerrainsOf(ts, era).flatGroup.get(block.other) ?? 0;
  const tileOf = new Map<number, number>(), halfTiles = new Map<number, number[]>();
  for (const h of block.askable) halfTiles.set(h, []);
  for (const [piece, tile] of block.pieces) {
    tileOf.set(piece, tile);
    const l = halfTiles.get(piece >> 4) ?? [];
    if (!l.includes(tile)) l.push(tile);
    halfTiles.set(piece >> 4, l);
  }
  const sTiles: [number[], number[]] = [tilesOfGroup(ts, block.flat), tilesOfGroup(ts, block.flat + 1)];
  const gTiles: [number[], number[]] = [tilesOfGroup(ts, outer.group), tilesOfGroup(ts, outer.group + 1)];
  const pool = [...new Set([...tileOf.values(), ...sTiles[0], ...sTiles[1], ...gTiles[0], ...gTiles[1]])];
  return { ts, era, block, sGroups, oGroup, tileOf, halfTiles, sTiles, outer, gTiles, pool };
}

/* ── The shadow and the translation ─────────────────────── */

/** The shadow: a map of O the size of `size`, with S painted on `diamonds`. */
function shadowOf(t: CopyTable, size: { width: number; height: number }, diamonds: readonly Diamond[], random: () => number): Isomed {
  const fill = flatTerrain(size.width, size.height, { id: t.block.other, group: t.oGroup }, t.ts, () => 0, t.era);
  const scn = createScenario({ width: size.width, height: size.height, era: t.era, name: "shadow", tiles: fill.tiles, isom: fill.isom }) as Isomed;
  if (diamonds.length > 0) paintIsomDiamonds(scn, t.ts, diamonds, t.block.source, random);
  return scn;
}

/** What the shadow's tile at a cell is: S's flat ground, a piece of E, or neither (the map's own ground). */
function shadowKind(t: CopyTable, tile: number): "s" | "piece" | null {
  const g = tile >> 4;
  if (t.sGroups.has(g & ~1)) return "s";
  return t.halfTiles.has(g) ? "piece" : null;
}

const OFF: [number, number, Side][] = [[-1, 0, "left"], [1, 0, "right"], [0, -1, "top"], [0, 1, "bottom"]];

/** The tile among `choices` that leaves the least step across its four joins (neighbours as `tileAt` says). */
function bestJoin(ts: Tileset, w: number, h: number, at: number, choices: readonly number[], tileAt: (at: number) => number): number {
  const x = at % w, y = Math.floor(at / w);
  let best = choices[0], bestCost = Infinity;
  for (const id of choices) {
    const m = megatileForTile(ts, id);
    let c = 0;
    for (const [dx, dy, side] of OFF) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const o = megatileForTile(ts, tileAt(ny * w + nx));
      if (o > 0) c += Math.max(0, seamStep(ts, m, side, o));
    }
    if (c < bestCost - 1e-6) { best = id; bestCost = c; }
  }
  return best;
}

/**
 * The map tile for a shadow cell: S → the copy's tile in the same slot; a piece → its tile, else another variant of the
 * same half, else (a shape the mod did not draw) the pool's best join, counted in `missing`.
 */
function translate(t: CopyTable, shadowTile: number, at: number, w: number, h: number, tileAt: (at: number) => number, random: () => number, missing: Set<number>): number | null {
  const kind = shadowKind(t, shadowTile);
  if (!kind) return null;
  if (kind === "s") {
    const l = t.sTiles[(shadowTile >> 4) & 1];
    return l.find((x) => (x & 15) === (shadowTile & 15)) ?? l[Math.floor(random() * l.length)] ?? null;
  }
  const exact = t.tileOf.get(shadowTile);
  if (exact !== undefined) { missing.delete(at); return exact; }
  const any = t.halfTiles.get(shadowTile >> 4) ?? [];
  if (any.length > 0) { missing.delete(at); return any[Math.floor(random() * any.length)]; }
  missing.add(at);
  return bestJoin(t.ts, w, h, at, t.pool, tileAt);
}

/* ── The footprint member ───────────────────────────────── */

/** The archive member holding the copied terrains' footprints (`scmjs\copies.bin`). */
export const COPY_MEMBER = "scmjs\\copies.bin";

/**
 * One patch: the terrain (S and the height), the block (`CopyBlock.key`, its pictures' hash, so the block is found again
 * when a mod update moves its groups), the outer ground it was laid against (`t<terrain>` / `p<pair group>`) and the
 * diamonds painted (`y * (isomWidth + 1) + x`).
 */
export interface CopyPatch { source: number; height: number; key: string; ground: string; diamonds: Set<number> }

const MAGIC = [0x43, 0x50, 0x59, 0x31]; // "CPY1"

/**
 * The member for a set of patches: "CPY1", width, height (u16 LE), ERA, 0, patch count (u16); per patch S (u8), height
 * (u8), key length (u8) and key (ASCII), ground length (u8) and ground (ASCII), diamond count (u32), the diamonds (u32).
 * Null when no patch has a diamond.
 */
export function encodeCopyMember(size: { width: number; height: number }, era: number, patches: readonly CopyPatch[]): Uint8Array | null {
  const live = patches.filter((p) => p.diamonds.size > 0);
  if (live.length === 0) return null;
  let bytes = 12;
  for (const p of live) bytes += 4 + p.key.length + p.ground.length + 4 + p.diamonds.size * 4;
  const out = new Uint8Array(bytes);
  const v = new DataView(out.buffer);
  out.set(MAGIC);
  v.setUint16(4, size.width, true); v.setUint16(6, size.height, true);
  out[8] = era & 7;
  v.setUint16(10, live.length, true);
  let at = 12;
  for (const p of live) {
    out[at++] = p.source & 0xff; out[at++] = p.height & 3; out[at++] = p.key.length;
    for (let i = 0; i < p.key.length; i++) out[at++] = p.key.charCodeAt(i) & 0x7f;
    out[at++] = p.ground.length;
    for (let i = 0; i < p.ground.length; i++) out[at++] = p.ground.charCodeAt(i) & 0x7f;
    v.setUint32(at, p.diamonds.size, true); at += 4;
    for (const d of [...p.diamonds].sort((a, b) => a - b)) { v.setUint32(at, d, true); at += 4; }
  }
  return out;
}

/** The patches a member holds for a map of this size and tileset, or [] when it is not ours, for another size or ERA. */
export function decodeCopyMember(member: Uint8Array | null | undefined, size: { width: number; height: number }, era: number): CopyPatch[] {
  if (!member || member.length < 12 || MAGIC.some((b, i) => member[i] !== b)) return [];
  const v = new DataView(member.buffer, member.byteOffset, member.byteLength);
  if (v.getUint16(4, true) !== size.width || v.getUint16(6, true) !== size.height || member[8] !== (era & 7)) return [];
  const out: CopyPatch[] = [];
  let at = 12;
  try {
    for (let k = v.getUint16(10, true); k > 0; k--) {
      const source = member[at++], height = member[at++], len = member[at++];
      let key = "";
      for (let i = 0; i < len; i++) key += String.fromCharCode(member[at++]);
      let ground = "";
      for (let i = member[at++]; i > 0; i--) ground += String.fromCharCode(member[at++]);
      const n = v.getUint32(at, true); at += 4;
      const diamonds = new Set<number>();
      for (let i = 0; i < n; i++) { diamonds.add(v.getUint32(at, true)); at += 4; }
      if (at > member.length) return [];
      out.push({ source, height, key, ground, diamonds });
    }
  } catch {
    return [];
  }
  return out;
}

/** The member after a resize that moved the map's old top-left tile to (dx, dy): diamonds move by whole rects; an odd column shift drops it. */
export function resizeCopyMember(member: Uint8Array | null, from: { width: number; height: number }, to: { width: number; height: number }, era: number, dx: number, dy: number): Uint8Array | null {
  const patches = decodeCopyMember(member, from, era);
  if (patches.length === 0 || dx % 2 !== 0) return null;
  const fw = isomWidth(from) + 1, tw = isomWidth(to) + 1, w = isomWidth(to), h = isomHeight(to);
  for (const p of patches) {
    const next = new Set<number>();
    for (const at of p.diamonds) {
      const x = (at % fw) + dx / 2, y = Math.floor(at / fw) + dy;
      if (x < 0 || y < 0 || x > w || y > h) continue;
      next.add(y * tw + x);
    }
    p.diamonds = next;
  }
  return encodeCopyMember(to, era, patches);
}

const diamondAtIndex = (at: number, dw: number): Diamond => ({ x: at % dw, y: Math.floor(at / dw) });

/* ── The stroke ─────────────────────────────────────────── */

export interface CopyPaint {
  /** Changes the game's brush already applied laying the outer ground (tiles), and its lattice changes. */
  applied: TileChange[];
  isom: TileChange[];
  /** The translated cells, for the caller to apply. */
  changes: TileChange[];
}

export interface CopyStrokeResult {
  before: Uint8Array | null;
  after: Uint8Array | null;
  /** Cells laid with no drawn piece for their shape (the block is incomplete there). */
  missing: number;
  /** Diamonds not laid: the outer ground is an untyped pair and was not under them. */
  refused: number;
  /** Cells the brush would have written and did not, because they are pinned. */
  kept: number[];
}

/**
 * One stroke of a copied terrain on a map: built from the member as the stroke starts, fed diamonds as the pointer moves
 * (`paint`), finished once. `table` is the block chosen for the stroke (`chooseBlock`).
 */
export class CopyStroke {
  readonly t: CopyTable;
  private readonly scn: Scenario;
  private readonly pinned: Uint8Array | null;
  private readonly random: () => number;
  private readonly shadow: Isomed;
  private readonly patches: CopyPatch[];
  private readonly patch: CopyPatch;
  readonly before: Uint8Array | null;
  private readonly missingAt = new Set<number>();
  private readonly keptAt = new Set<number>();
  private refused = 0;

  constructor(scn: Scenario, t: CopyTable, before: Uint8Array | null, pinned: Uint8Array | null = null, random: () => number = Math.random) {
    this.scn = scn; this.t = t; this.pinned = pinned; this.random = random; this.before = before;
    this.patches = decodeCopyMember(before, scn, t.era);
    const own = this.patches.find((p) => p.source === t.block.source && p.height === t.block.height && p.key === t.block.key && p.ground === t.outer.id);
    this.patch = own ?? { source: t.block.source, height: t.block.height, key: t.block.key, ground: t.outer.id, diamonds: new Set() };
    if (!own) this.patches.push(this.patch);
    const dw = isomWidth(scn) + 1;
    this.shadow = shadowOf(t, scn, [...this.patch.diamonds].map((d) => diamondAtIndex(d, dw)), () => 0);
  }

  /** Whether a diamond can be laid: with a pair for outer ground, its rects (and the ring's) must be that ground already, or the patch. */
  private onGround(d: Diamond): boolean {
    if (this.t.outer.kind === "typed" && this.scn.isom) return true;
    const { scn } = this, W = scn.width, H = scn.height, dw = isomWidth(scn) + 1;
    const gGroups = new Set([this.t.outer.group, this.t.outer.group + 1]);
    for (const [ox, oy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const c = { x: d.x + ox, y: d.y + oy };
      if (this.patch.diamonds.has(c.y * dw + c.x)) continue;
      for (const [cx, cy] of [[2 * c.x - 2, c.y - 1], [2 * c.x - 1, c.y - 1], [2 * c.x, c.y - 1], [2 * c.x + 1, c.y - 1], [2 * c.x - 2, c.y], [2 * c.x - 1, c.y], [2 * c.x, c.y], [2 * c.x + 1, c.y]]) {
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
        if (!gGroups.has(tileGroupOf(scn.tiles[cy * W + cx], this.t.ts.groups.length))) return false;
      }
    }
    return true;
  }

  /** Paint the copied terrain on `diamonds`. */
  paint(diamonds: readonly Diamond[]): CopyPaint {
    const { scn, t } = this, W = scn.width, H = scn.height, w = isomWidth(scn), h = isomHeight(scn), dw = w + 1;
    const fresh = diamonds.filter((d) => (d.x + d.y) % 2 === 0 && d.x >= 0 && d.y >= 0 && d.x <= w && d.y <= h);
    const laid: Diamond[] = [];
    for (const d of fresh) { if (this.onGround(d)) laid.push(d); else this.refused++; }
    const out: CopyPaint = { applied: [], isom: [], changes: [] };
    if (laid.length === 0) return out;
    for (const d of laid) this.patch.diamonds.add(d.y * dw + d.x);
    const cells = new Set<number>();
    // The outer ground on the real lattice, over the footprint and the ring the shadow's edge stands on.
    if (t.outer.kind === "typed" && scn.isom) {
      const ring = new Map<string, Diamond>();
      for (const d of laid) for (const [ox, oy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) ring.set(`${d.x + ox},${d.y + oy}`, { x: d.x + ox, y: d.y + oy });
      const edit = paintIsomDiamonds(scn as Isomed, t.ts, [...ring.values()], t.outer.index, this.random, this.pinned);
      if (edit) {
        out.applied = edit.tiles; out.isom = edit.isom;
        for (const c of edit.tiles) cells.add(c.at);
        for (const at of edit.kept) this.keptAt.add(at);
      }
    }
    const sEdit = paintIsomDiamonds(this.shadow, t.ts, laid, t.block.source, this.random);
    for (const c of sEdit?.tiles ?? []) cells.add(c.at);
    // and every cell of the new diamonds' rects (an unchanged shadow tile may still need writing on the map)
    for (const d of laid) for (const [cx, cy] of [[2 * d.x - 2, d.y - 1], [2 * d.x - 1, d.y - 1], [2 * d.x, d.y - 1], [2 * d.x + 1, d.y - 1], [2 * d.x - 2, d.y], [2 * d.x - 1, d.y], [2 * d.x, d.y], [2 * d.x + 1, d.y]]) {
      if (cx >= 0 && cy >= 0 && cx < W && cy < H) cells.add(cy * W + cx);
    }
    const chosen = new Map<number, number>();
    const tileAt = (at: number) => chosen.get(at) ?? scn.tiles[at];
    for (let pass = 0; pass < 2; pass++) for (const at of [...cells].sort((a, b) => a - b)) {
      const tile = translate(t, this.shadow.tiles[at], at, W, H, tileAt, this.random, this.missingAt);
      if (tile !== null) chosen.set(at, tile);
    }
    for (const [at, after] of chosen) {
      if (this.pinned?.[at]) { if (scn.tiles[at] !== after) this.keptAt.add(at); continue; }
      if (scn.tiles[at] !== after) out.changes.push({ at, before: scn.tiles[at], after });
    }
    return out;
  }

  finish(): CopyStrokeResult {
    return { before: this.before, after: encodeCopyMember(this.scn, this.t.era, this.patches), missing: this.missingAt.size, refused: this.refused, kept: [...this.keptAt] };
  }
}

/* ── Re-laying after another isometric stroke ───────────── */

export interface RelayResult {
  changes: TileChange[];
  after: Uint8Array | null;
  /** Diamonds given up (the lattice under them is not the outer ground any more, or their tiles were written over). */
  dropped: number;
  /** Joins that show between a re-laid cell and a cell the patch could not keep. */
  hard: number;
}

/**
 * After an isometric stroke of another terrain (the game's brush, a borrowed one) or another tool wrote over a patch:
 * every patch keeps the footprint diamonds the real lattice still holds as its outer ground (typed) with their four
 * neighbours too, so the shadow's edge ring stands on it; a diamond whose rects hold a tile the patch could not have
 * laid is given up. Footprint diamonds are then given up until every cell the shadow names lies on rects of the outer
 * ground alone (the shrink that removes the hard cut). The shadow is laid again, its cells written, and cells the patch
 * held that are outside it now go back to the outer ground's own tile where the lattice is that ground.
 * `tableOf` resolves a patch to its block's table (null: the block is not known, the patch is left alone).
 */
export function relayCopies(scn: Scenario, member: Uint8Array | null, era: number, tableOf: (p: CopyPatch) => CopyTable | null, opts: { pinned?: Uint8Array | null; random?: () => number; touched?: Iterable<number>; shrink?: boolean } = {}): RelayResult {
  const pinned = opts.pinned ?? null, random = opts.random ?? Math.random;
  const patches = decodeCopyMember(member, scn, era);
  const out: RelayResult = { changes: [], after: member, dropped: 0, hard: 0 };
  if (patches.length === 0) return out;
  const W = scn.width, H = scn.height, w = isomWidth(scn), h = isomHeight(scn), dw = w + 1;
  const written = new Map<number, number>();
  let changed = false;
  // The tiles the real lattice lays, worked out once when a cell needs one (a copy of the map, every rect re-derived).
  let real: Uint16Array | null = null;
  const realTile = (at: number, ts: Tileset): number | null => {
    if (!scn.isom) return null;
    if (!real) {
      const scratch = { ...scn, tiles: scn.tiles.slice(), editorTiles: scn.editorTiles.slice(), isom: scn.isom.slice(), dirty: new Set<string>() } as Isomed;
      tilesFromIsom(scratch, ts, () => 0);
      real = scratch.tiles;
    }
    return real[at];
  };
  const touched = opts.touched ? [...opts.touched] : null;
  for (const p of patches) {
    const t = tableOf(p);
    if (!t) continue;
    if (touched) {
      // only a patch the stroke came near: its footprint's cells and two diamonds round them
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const at of p.diamonds) { const d = diamondAtIndex(at, dw); x0 = Math.min(x0, 2 * d.x - 6); x1 = Math.max(x1, 2 * d.x + 5); y0 = Math.min(y0, d.y - 3); y1 = Math.max(y1, d.y + 2); }
      if (!touched.some((at) => { const x = at % W, y = Math.floor(at / W); return x >= x0 && x <= x1 && y >= y0 && y <= y1; })) continue;
    }
    const isG = (d: Diamond) => {
      if (t.outer.kind !== "typed" || !scn.isom) return true;
      const v = diamondValue(scn.isom, w, h, d);
      return v < 0 || v === isomValueOf(era, t.outer.index);
    };
    const footprint = [...p.diamonds].map((d) => diamondAtIndex(d, dw));
    const oldShadow = shadowOf(t, scn, footprint, () => 0);
    // tiles the patch could have laid: its block, the copy, the outer ground (and anything the shadow lays as O)
    const own = new Set<number>(t.pool);
    const ownCell = (at: number) => own.has(scn.tiles[at]) || shadowKind(t, oldShadow.tiles[at]) === null;
    // the patch's tiles alone (its pieces and the copy), without the outer ground's
    const groundTiles = new Set<number>([...t.gTiles[0], ...t.gTiles[1]]);
    const patchTiles = new Set<number>(t.pool.filter((x) => !groundTiles.has(x)));
    const rectCells = (d: Diamond) => [[2 * d.x - 2, d.y - 1], [2 * d.x - 1, d.y - 1], [2 * d.x, d.y - 1], [2 * d.x + 1, d.y - 1], [2 * d.x - 2, d.y], [2 * d.x - 1, d.y], [2 * d.x, d.y], [2 * d.x + 1, d.y]]
      .filter(([cx, cy]) => cx >= 0 && cy >= 0 && cx < W && cy < H).map(([cx, cy]) => cy * W + cx);
    let keep = footprint.filter((d) => isG(d) && [[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([ox, oy]) => isG({ x: d.x + ox, y: d.y + oy })) && rectCells(d).every(ownCell));
    // Shrink until every cell the shadow names stands on rects of the outer ground.
    let shadow = shadowOf(t, scn, keep, random);
    for (let round = 0; round < (opts.shrink === false ? 0 : 8); round++) {
      const bad = new Set<number>();
      for (let at = 0; at < W * H; at++) {
        if (!shadowKind(t, shadow.tiles[at])) continue;
        const ds = diamondsOfRect(Math.floor((at % W) / 2), Math.floor(at / W));
        if (ds.every(isG)) continue;
        for (const d of ds) for (const [ox, oy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) bad.add((d.y + oy) * dw + d.x + ox);
      }
      const next = keep.filter((d) => !bad.has(d.y * dw + d.x));
      if (next.length === keep.length) break;
      keep = next;
      shadow = shadowOf(t, scn, keep, random);
    }
    out.dropped += p.diamonds.size - keep.length;
    if (keep.length !== p.diamonds.size) changed = true;
    p.diamonds = new Set(keep.map((d) => d.y * dw + d.x));
    const missing = new Set<number>();
    const tileAt = (at: number) => written.get(at) ?? scn.tiles[at];
    for (let at = 0; at < W * H; at++) {
      const was = shadowKind(t, oldShadow.tiles[at]), now = shadowKind(t, shadow.tiles[at]);
      if (!was && !now) continue;
      const rectG = diamondsOfRect(Math.floor((at % W) / 2), Math.floor(at / W)).every(isG);
      let tile: number | null = null;
      if (now && rectG) {
        // keep a tile that is already a right choice for the cell (a variation laid before)
        const cur = scn.tiles[at];
        // a tile that is neither the patch's nor its ground's was laid there since (by hand, by a borrowed stroke): it stays
        if (!own.has(cur)) continue;
        const ok = now === "s" ? t.sTiles[(shadow.tiles[at] >> 4) & 1].includes(cur) : (t.halfTiles.get(shadow.tiles[at] >> 4) ?? []).includes(cur);
        tile = ok ? cur : translate(t, shadow.tiles[at], at, W, H, tileAt, random, missing);
      } else if (patchTiles.has(scn.tiles[at])) {
        // A cell the patch held that it does not now, still showing the patch's tile: what the real lattice lays
        // there, as the game's brush would. A cell someone laid by hand over the patch since is theirs and stays.
        tile = realTile(at, t.ts);
      }
      if (tile === null || tile === scn.tiles[at] || pinned?.[at]) continue;
      written.set(at, tile);
    }
  }
  for (const [at, after] of written) out.changes.push({ at, before: scn.tiles[at], after });
  // joins that show between a cell written and a neighbour not written that is not the patch's own
  for (const [at, tile] of written) {
    const x = at % W, y = Math.floor(at / W);
    for (const [dx, dy, side] of OFF) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const b = ny * W + nx; if (written.has(b)) continue;
      const ts = tableOf(patches[0])?.ts;
      if (ts && seamStep(ts, megatileForTile(ts, tile), side, megatileForTile(ts, scn.tiles[b])) > SEAM_SHOWS) out.hard++;
    }
  }
  if (changed) out.after = encodeCopyMember(scn, era, patches);
  return out;
}

/* ── Choosing a block and its outer ground ──────────────── */

/** Fixed strokes a mapper makes (a diamond, blobs 2–5 wide, lines, an L, a ring, a blob with a hole, walks), around (cx, cy). */
export function countStrokes(cx: number, cy: number): Diamond[][] {
  const at = (u: number, v: number): Diamond => ({ x: cx + u + v, y: cy + u - v });
  const blob = (n: number) => { const l: Diamond[] = []; const lo = -Math.floor((n - 1) / 2); for (let u = lo; u < lo + n; u++) for (let v = lo; v < lo + n; v++) l.push(at(u, v)); return l; };
  const out: Diamond[][] = [[at(0, 0)], blob(2), blob(3), blob(4), blob(5)];
  out.push(Array.from({ length: 7 }, (_, i) => at(i - 3, 0)));
  out.push(Array.from({ length: 6 }, (_, i) => ({ x: cx - 6 + 2 * i, y: cy })));
  out.push([...Array.from({ length: 5 }, (_, i) => at(i - 2, -2)), ...Array.from({ length: 4 }, (_, i) => at(-2, i - 1))]);
  const ring: Diamond[] = [], hole: Diamond[] = [];
  for (let u = -3; u <= 3; u++) for (let v = -3; v <= 3; v++) { const r = Math.max(Math.abs(u), Math.abs(v)); if (r === 2) ring.push(at(u, v)); if (r >= 2) hole.push(at(u, v)); }
  out.push(ring, hole);
  let s = 101;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let k = 0; k < 4; k++) {
    let u = 0, v = 0;
    const l = new Map<string, Diamond>([["0,0", at(0, 0)]]);
    for (let i = 0; i < 14; i++) { const r = Math.floor(rnd() * 4); if (r === 0) u++; else if (r === 1) u--; else if (r === 2) v++; else v--; u = Math.max(-5, Math.min(5, u)); v = Math.max(-5, Math.min(5, v)); const d = at(u, v); l.set(`${d.x},${d.y}`, d); }
    out.push([...l.values()]);
  }
  return out;
}

/** The side of the map the counts are painted on, and where the strokes are centred. */
const COUNT_SIZE = 48;

/** A map of a ground: a typed one laid as a new map is, a pair laid as the Rect brush lays it (the lattice O, which nothing reads). */
function groundMap(t: CopyTable, size: number): Scenario {
  const fi = flatTerrainsOf(t.ts, t.era);
  if (t.outer.kind === "typed") {
    const fill = flatTerrain(size, size, { id: t.outer.index, group: fi.flatGroup.get(t.outer.index) ?? t.outer.group }, t.ts, () => 0, t.era);
    return createScenario({ width: size, height: size, era: t.era, name: "count", tiles: fill.tiles, isom: fill.isom });
  }
  const fill = flatTerrain(size, size, { id: t.block.other, group: t.oGroup }, t.ts, () => 0, t.era);
  let k = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x += 2) {
    const l = t.gTiles[0], r = t.gTiles[1];
    const i = k++ % Math.max(1, l.length);
    fill.tiles[y * size + x] = l[i] ?? fill.tiles[y * size + x];
    if (x + 1 < size) fill.tiles[y * size + x + 1] = r[Math.min(i, r.length - 1)] ?? fill.tiles[y * size + x + 1];
  }
  return createScenario({ width: size, height: size, era: t.era, name: "count", tiles: fill.tiles, isom: fill.isom });
}

/**
 * Paint and count: the fixed strokes painted with the block on a map of `t.outer`, each on a fresh map; joins showing
 * (`SEAM_SHOWS`) per 100 border cells (cells where the shadow lays a piece). What the brush would show on that ground.
 */
export function paintCount(t: CopyTable): number {
  let border = 0, showing = 0;
  const c = COUNT_SIZE / 4;
  for (const st of countStrokes(c, COUNT_SIZE / 2)) {
    const scn = groundMap(t, COUNT_SIZE);
    let seed = 5;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const stroke = new CopyStroke(scn, t, null, null, rnd);
    const p = stroke.paint(st);
    for (const ch of p.changes) scn.tiles[ch.at] = ch.after;
    const W = COUNT_SIZE;
    const shadow = shadowOf(t, scn, st, () => 0);
    const seen = new Set<string>();
    for (let at = 0; at < W * W; at++) {
      if (shadowKind(t, shadow.tiles[at]) !== "piece") continue;
      border++;
      const x = at % W, y = Math.floor(at / W);
      for (const [dx, dy, side] of OFF) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
        const b = ny * W + nx, k = at < b ? `${at}|${b}` : `${b}|${at}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (seamStep(t.ts, megatileForTile(t.ts, scn.tiles[at]), side, megatileForTile(t.ts, scn.tiles[b])) > SEAM_SHOWS) showing++;
      }
    }
  }
  return border ? (showing / border) * 100 : Infinity;
}

/** Ground candidates by paint and count; this close to the best (joins per 100) the seam step's tie-break decides. */
export const COUNT_MARGIN = 1;
/** Ground candidates kept from the seam step for paint and count. */
export const GROUND_CANDIDATES = 8;

/**
 * The grounds a block could be drawn to meet, ranked by the mean seam step across the pieces' outer sides (the sides
 * whose link is O's), each ground's tiles averaged as the brush lays any of them; ties by the share of the repainted
 * minitiles whose VF4 word the ground carries. The block's own rows (they look like loose pairs), S's own ground and the
 * copy are left out.
 */
export function rankGrounds(ts: Tileset, era: number, block: CopyBlock): RankedGround[] {
  const { linkOf } = flatTerrainsOf(ts, era);
  const oLink = linkOf.get(block.other) ?? -1;
  const blockMegas = new Set(block.pieces.map(([, tile]) => ts.groups[tile >> 4]?.megatiles[tile & 15] ?? 0));
  const sides: { mm: number; side: Side }[] = [];
  const repaintWords = new Map<number, number>();
  for (const [piece, tile] of block.pieces) {
    const e = ts.groups[piece >> 4];
    const mm = ts.groups[tile >> 4]?.megatiles[tile & 15] ?? 0;
    const pm = e?.megatiles[piece & 15] ?? 0;
    if (!e || !mm || tile >> 4 === block.flat || tile >> 4 === block.flat + 1) continue;
    for (const side of ["left", "top", "right", "bottom"] as const) if (e.edges[side] === oLink) sides.push({ mm, side });
    for (let i = 0; i < 16; i++) if (ts.megatileRefs[mm * 16 + i] !== ts.megatileRefs[pm * 16 + i]) { const wd = ts.megatileFlags[mm * 16 + i]; repaintWords.set(wd, (repaintWords.get(wd) ?? 0) + 1); }
  }
  const repaintTotal = [...repaintWords.values()].reduce((a, b) => a + b, 0);
  const out: RankedGround[] = [];
  for (const g of groundsOf(ts, era).values()) {
    if (g.id === `t${block.source}` || g.group === block.flat) continue;
    if (g.kind === "pair" && g.group >= block.first - BLOCK_REACH && g.group <= block.last + BLOCK_REACH) continue;
    if (g.megas.some((m) => blockMegas.has(m)) || g.megas.length === 0 || sides.length === 0) continue;
    let sum = 0;
    for (const { mm, side } of sides) { let s = 0; for (const m of g.megas) s += Math.max(0, seamStep(ts, mm, side, m)); sum += s / g.megas.length; }
    const words = new Set<number>();
    for (const m of g.megas) for (let i = 0; i < 16; i++) words.add(ts.megatileFlags[m * 16 + i]);
    let agree = 0;
    for (const [wd, n] of repaintWords) if (words.has(wd)) agree += n;
    out.push({ id: g.id, kind: g.kind, index: g.index, group: g.group, step: sum / sides.length, flags: repaintTotal ? agree / repaintTotal : 0 });
  }
  return out.sort((a, b) => a.step - b.step).slice(0, GROUND_CANDIDATES);
}

/** The outer ground among counted candidates: the lowest count, then within `COUNT_MARGIN` the flags and typed before a pair. */
export function chooseOuter(ranked: readonly RankedGround[]): RankedGround | null {
  const counted = ranked.filter((g) => g.count !== undefined && Number.isFinite(g.count)).sort((a, b) => a.count! - b.count!);
  if (counted.length === 0) return ranked[0] ?? null;
  const close = counted.filter((g) => g.count! <= counted[0].count! + COUNT_MARGIN);
  return close.sort((a, b) => b.flags - a.flags || (a.kind === b.kind ? a.count! - b.count! : a.kind === "typed" ? -1 : 1))[0];
}

/**
 * The ground under and around a stroke's first diamonds: the commonest ground of the cells of their rects and the rects
 * around them. Null when none of them is a ground.
 */
export function groundUnder(scn: Scenario, ts: Tileset, era: number, diamonds: readonly Diamond[]): string | null {
  const counts = new Map<string, number>();
  const W = scn.width, H = scn.height;
  for (const d of diamonds) for (let y = d.y - 3; y <= d.y + 2; y++) for (let x = 2 * d.x - 6; x <= 2 * d.x + 5; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const g = groundOfTile(ts, era, scn.tiles[y * W + x]);
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let best: string | null = null, n = 0;
  for (const [g, k] of counts) if (k > n || (k === n && best !== null && g < best)) { best = g; n = k; }
  return best;
}

/** The patch of the same terrain that a stroke starting on `d` continues (a footprint diamond within one of it), if any. */
export function patchAt(member: Uint8Array | null, size: { width: number; height: number }, era: number, source: number, height: number, d: Diamond): CopyPatch | null {
  const dw = isomWidth(size) + 1;
  for (const p of decodeCopyMember(member, size, era)) {
    if (p.source !== source || p.height !== height) continue;
    for (const [ox, oy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) if (p.diamonds.has((d.y + oy) * dw + d.x + ox)) return p;
  }
  return null;
}
