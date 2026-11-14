/**
 * The isometric brush laying a borrowed terrain (`borrow.ts`): StarEdit's own brush, run on a
 * lattice in the *source* tileset's numbering, each tile it lays written into the map as a host
 * tile showing the same picture.
 *
 * The map's ISOM holds the host's numbering, so the borrowed lattice lives beside it, as a member
 * of the map's archive per source tileset (`borrowMember`): the diamonds that differ from the
 * source's base ground, sparse. Where nothing borrowed was painted the lattice is that base
 * ground (`borrow.ts#borrowBase`, what a new map of the source tileset is filled with), so a
 * first stroke lays what it would on a fresh map of that tileset — and only the cells the stroke
 * changes are written, never a fill of the base. Being an archive member, the lattice is saved
 * with the map, parked with it, undone through the history entry (`HistoryEdit.members`) and
 * sent on a shared map like the pins (`pins.ts`).
 *
 * Other tools may write over borrowed ground (Rect, Tile, Heal, paste, the host's own brush). So
 * before a stroke the lattice is checked against the map: a borrowed rect whose tiles are no
 * longer copies of what the lattice lays there goes back to the base ground, and the stroke
 * does not continue edges that are gone.
 *
 * Pure and canvas-free; `tests/borrow.test.ts`.
 */
import { markDirty, type Scenario } from "../formats/chk/scenario";
import { megatileForTile, type Tileset } from "../formats/tileset/decode";
import { flatTerrain } from "../formats/tileset/terrain";
import { TILESETS } from "../data/tilesets";
import { isomValueOf } from "../data/isomTables";
import { SEAM_SHOWS, seamStep, SIDES, type Side } from "./blend";
import { borrowBase, type BorrowTable } from "./borrow";
import { diamondsOfRect, diamondValue, isomHeight, isomWidth, paintIsomDiamonds, setDiamondValue, tilesFromIsom, type Diamond } from "./isom";
import type { TileChange } from "./terrain";

type Size = Pick<Scenario, "width" | "height">;
type Isomed = Scenario & { isom: Uint16Array };

/** The member holding the lattice borrowed from tileset `sourceEra` (`scmjs\borrowed-install.bin`). */
export const borrowMember = (sourceEra: number): string => `scmjs\\borrowed-${TILESETS[sourceEra & 7].id}.bin`;

/** Every borrowed-lattice member, by the source's ERA. */
export const BORROW_MEMBERS: readonly string[] = TILESETS.map((_, era) => borrowMember(era));

/**
 * "BOR1", the map's width and height (u16 LE), the source's ERA (u8), a zero byte, the entry count's
 * low 16 bits (a check: the count is the length's), then per diamond its index (u32,
 * `y * (isomWidth + 1) + x`) and value (u16, the source's shape-link row).
 */
const MAGIC = [0x42, 0x4f, 0x52, 0x31];
const HEADER = 12;
const ENTRY = 6;

/** The lattice of the source's base ground for a map of this size. */
export function baseLattice(size: Size, sourceEra: number): Uint16Array {
  return flatTerrain(size.width, size.height, { id: borrowBase(sourceEra), group: 0 }, null, () => 0, sourceEra).isom;
}

const baseValue = (sourceEra: number) => isomValueOf(sourceEra, borrowBase(sourceEra));

/** The member for a lattice: the diamonds that are not the base ground. Null when all of them are. */
export function encodeBorrowLattice(size: Size, sourceEra: number, isom: Uint16Array): Uint8Array | null {
  const w = isomWidth(size), h = isomHeight(size), dw = w + 1;
  const base = baseValue(sourceEra);
  const entries: [number, number][] = [];
  for (let y = 0; y <= h; y++) {
    for (let x = (y & 1); x <= w; x += 2) {
      const v = diamondValue(isom, w, h, { x, y });
      if (v >= 0 && v !== base) entries.push([y * dw + x, v]);
    }
  }
  if (entries.length === 0) return null;
  const out = new Uint8Array(HEADER + entries.length * ENTRY);
  const view = new DataView(out.buffer);
  out.set(MAGIC);
  view.setUint16(4, size.width, true);
  view.setUint16(6, size.height, true);
  out[8] = sourceEra & 7;
  view.setUint16(10, entries.length & 0xffff, true);
  entries.forEach(([at, v], i) => {
    view.setUint32(HEADER + i * ENTRY, at, true);
    view.setUint16(HEADER + i * ENTRY + 4, v, true);
  });
  return out;
}

/** The diamonds a member holds for a map of this size and source, or null when it is not ours or for another size. */
export function decodeBorrowLattice(member: Uint8Array | null | undefined, size: Size, sourceEra: number): [number, number][] | null {
  if (!member || member.length < HEADER || MAGIC.some((b, i) => member[i] !== b)) return null;
  const view = new DataView(member.buffer, member.byteOffset, member.byteLength);
  if (view.getUint16(4, true) !== size.width || view.getUint16(6, true) !== size.height || member[8] !== (sourceEra & 7)) return null;
  const count = (member.length - HEADER) / ENTRY;
  if (!Number.isInteger(count) || (count & 0xffff) !== view.getUint16(10, true)) return null;
  const out: [number, number][] = [];
  for (let i = 0; i < count; i++) out.push([view.getUint32(HEADER + i * ENTRY, true), view.getUint16(HEADER + i * ENTRY + 4, true)]);
  return out;
}

/** The whole lattice a member stands for: the base ground with its diamonds set. */
export function latticeOf(member: Uint8Array | null | undefined, size: Size, sourceEra: number): Uint16Array {
  const isom = baseLattice(size, sourceEra);
  const w = isomWidth(size), h = isomHeight(size), dw = w + 1;
  for (const [at, v] of decodeBorrowLattice(member, size, sourceEra) ?? []) setDiamondValue(isom, w, h, { x: at % dw, y: Math.floor(at / dw) }, v);
  return isom;
}

/** The member after a resize that moved the map's old top-left tile to (dx, dy). Null when nothing is left, or `dx` is odd (a lattice moves by whole rects, two tiles). */
export function resizeBorrowMember(member: Uint8Array | null, from: Size, to: Size, sourceEra: number, dx: number, dy: number): Uint8Array | null {
  const entries = decodeBorrowLattice(member, from, sourceEra);
  if (!entries || dx % 2 !== 0) return null;
  const fw = isomWidth(from) + 1;
  const isom = baseLattice(to, sourceEra);
  const w = isomWidth(to), h = isomHeight(to);
  for (const [at, v] of entries) {
    const x = (at % fw) + dx / 2, y = Math.floor(at / fw) + dy;
    if (x < 0 || y < 0 || x > w || y > h) continue;
    setDiamondValue(isom, w, h, { x, y }, v);
  }
  return encodeBorrowLattice(to, sourceEra, isom);
}

/** The archive's files with a member set, or removed for null. A new map; `extras` is not touched. */
export function withMember(extras: ReadonlyMap<string, Uint8Array>, name: string, member: Uint8Array | null): Map<string, Uint8Array> {
  const next = new Map(extras);
  if (member) next.set(name, member);
  else next.delete(name);
  return next;
}

/* ── The brush ──────────────────────────────────────────── */

export interface BorrowContext {
  host: Tileset;
  source: Tileset;
  sourceEra: number;
  table: BorrowTable;
}

/** The source tiles a lattice lays, worked out once per member (a lattice is mostly base ground). */
const shadowCache = new WeakMap<Uint8Array, Uint16Array>();
const baseShadows = new Map<string, Uint16Array>();

function shadowTiles(member: Uint8Array | null, size: Size, ctx: BorrowContext, isom: Uint16Array): Uint16Array {
  const known = member ? shadowCache.get(member) : baseShadows.get(`${size.width}x${size.height}:${ctx.sourceEra}`);
  if (known && known.length === size.width * size.height) return known.slice();
  const shadow = makeShadow(size, ctx.sourceEra, new Uint16Array(size.width * size.height), isom.slice());
  layShadow(shadow, ctx);
  remember(member, size, ctx.sourceEra, shadow.tiles);
  return shadow.tiles.slice();
}

/**
 * No tile: what the shadow holds where the lattice is base ground. The map there is the host's
 * own, so nothing the brush lays may count as "unchanged" against it; and as a group past the
 * table it is never taken for a cliff face to continue (`IsomPass.updateTile`).
 */
const NO_TILE = 0xffff;

/** The source tiles the lattice lays where it is borrowed, `NO_TILE` elsewhere. */
function layShadow(shadow: Isomed, ctx: BorrowContext) {
  shadow.tiles.fill(0);
  tilesFromIsom(shadow, ctx.source, () => 0);
  const borrowed = borrowedCells(shadow, ctx.sourceEra, shadow.isom);
  for (let at = 0; at < shadow.tiles.length; at++) if (!borrowed[at]) shadow.tiles[at] = NO_TILE;
}

function remember(member: Uint8Array | null, size: Size, sourceEra: number, tiles: Uint16Array) {
  if (member) shadowCache.set(member, tiles.slice());
  else {
    if (baseShadows.size > 8) baseShadows.clear();
    baseShadows.set(`${size.width}x${size.height}:${sourceEra}`, tiles.slice());
  }
}

/** The source's own map behind a borrowed stroke: the lattice and the source tiles it lays. */
function makeShadow(size: Size, sourceEra: number, tiles: Uint16Array, isom: Uint16Array): Isomed {
  return { width: size.width, height: size.height, era: sourceEra, tiles, editorTiles: tiles, isom, dirty: new Set<string>() } as unknown as Isomed;
}

export interface BorrowStrokeResult {
  /** The member as the stroke left it (null: all base ground), and as it was. */
  before: Uint8Array | null;
  after: Uint8Array | null;
  /** Cells the brush would have written and did not, because they are pinned. */
  kept: number[];
  /** Cells whose source tile has no host tile at all: left as they were. */
  untranslated: number;
  /** Cells laid with a stand-in (the nearest picture where there is no copy). */
  standIns: number;
  /** Borrowed diamonds put back to the base ground before the stroke because other tools had written over their tiles. */
  reset: number;
  /** Joins between the stroke's cells and the map's own ground that the Seam Overlay draws. */
  seams: number;
}

/**
 * One stroke of the borrowed brush on a map: built from the member as the stroke starts, fed
 * diamonds as the pointer moves (`paint`, which answers the changes to apply to the map, live),
 * and finished once (`finish`, the member to store and the counts for the status line).
 */
export class BorrowStroke {
  private readonly shadow: Isomed;
  private readonly touched = new Set<number>();
  private readonly keptAt = new Set<number>();
  private untranslated = new Set<number>();
  private standIns = new Set<number>();
  readonly reset: number;
  readonly scn: Scenario;
  readonly ctx: BorrowContext;
  readonly before: Uint8Array | null;
  private readonly pinned: Uint8Array | null;

  constructor(scn: Scenario, ctx: BorrowContext, before: Uint8Array | null, pinned: Uint8Array | null = null) {
    this.scn = scn;
    this.ctx = ctx;
    this.before = before;
    this.pinned = pinned;
    const isom = latticeOf(before, scn, ctx.sourceEra);
    this.shadow = makeShadow(scn, ctx.sourceEra, shadowTiles(before, scn, ctx, isom), isom);
    this.reset = this.checkAgainstMap();
  }

  /**
   * Put back to the base ground every borrowed diamond whose rect's tiles are no longer copies of
   * what the lattice lays there (written over by another tool), and lay the shadow again there.
   * Doodads' cells are judged by the ground under them.
   */
  private checkAgainstMap(): number {
    const { scn, ctx, shadow } = this;
    const w = isomWidth(scn), h = isomHeight(scn);
    const base = baseValue(ctx.sourceEra);
    const reset: Diamond[] = [];
    for (let y = 0; y < scn.height; y++) {
      for (let x = 0; x < Math.floor(scn.width / 2); x++) {
        const ds = diamondsOfRect(x, y);
        if (ds.every((d) => diamondValue(shadow.isom, w, h, d) === base)) continue;
        let fine = true;
        for (const at of [y * scn.width + 2 * x, y * scn.width + 2 * x + 1]) {
          const group = shadow.tiles[at] >> 4;
          if (shadow.tiles[at] === NO_TILE || !ctx.source.groups[group]) continue;
          // Any variation of the group the lattice lays here: the shadow's own slot need not be the one painted (a reopened map's is laid afresh).
          if (!copiesOfGroup(ctx, group).has(megatileForTile(ctx.host, scn.editorTiles[at]))) fine = false;
        }
        if (!fine) for (const d of ds) if (diamondValue(shadow.isom, w, h, d) !== base) reset.push(d);
      }
    }
    if (reset.length === 0) return 0;
    const seen = new Set<string>();
    for (const d of reset) {
      const key = `${d.x},${d.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      setDiamondValue(shadow.isom, w, h, d, base);
    }
    layShadow(shadow, ctx);
    return seen.size;
  }

  /**
   * Paint the source terrain `index` (its CV5 index) on `diamonds` and answer the changes to the
   * map: the cells whose source tile changed, as host tiles. Null when the source cannot paint it.
   */
  paint(diamonds: readonly Diamond[], index: number, random: () => number = Math.random): TileChange[] | null {
    const { scn, ctx, shadow } = this;
    const edit = paintIsomDiamonds(shadow, ctx.source, diamonds, index, random, this.pinned);
    if (!edit) return null;
    for (const at of edit.kept) this.keptAt.add(at);
    const cells = edit.tiles.map((c) => c.at);
    const chosen = new Map<number, number>();
    const tileAt = (at: number) => chosen.get(at) ?? scn.tiles[at];
    // Twice over, as Heal does: a cell chosen late in the first pass changes what its earlier neighbours meet.
    for (let pass = 0; pass < 2; pass++) {
      for (const at of cells) {
        const choices = ctx.table.choices.get(shadow.tiles[at]);
        if (!choices || choices.length === 0) {
          if (pass === 0) { this.untranslated.add(at); this.standIns.delete(at); }
          continue;
        }
        this.untranslated.delete(at);
        if (ctx.table.kinds.get(shadow.tiles[at]) === "standIn") this.standIns.add(at); else this.standIns.delete(at);
        chosen.set(at, choices.length === 1 ? choices[0] : this.bestJoin(at, choices, tileAt));
      }
    }
    const changes: TileChange[] = [];
    for (const [at, after] of chosen) {
      this.touched.add(at);
      if (scn.tiles[at] !== after) changes.push({ at, before: scn.tiles[at], after });
    }
    return changes.sort((a, b) => a.at - b.at);
  }

  /** The choice that leaves the least step across its four joins. */
  private bestJoin(at: number, choices: readonly number[], tileAt: (at: number) => number): number {
    const { scn, ctx } = this;
    const x = at % scn.width, y = (at / scn.width) | 0;
    let best = choices[0], bestScore = Infinity;
    for (const id of choices) {
      const m = megatileForTile(ctx.host, id);
      let score = 0;
      for (const side of SIDES) {
        const nx = x + OFFSET[side][0], ny = y + OFFSET[side][1];
        if (nx < 0 || ny < 0 || nx >= scn.width || ny >= scn.height) continue;
        const other = megatileForTile(ctx.host, tileAt(ny * scn.width + nx));
        if (other > 0) score += Math.max(0, seamStep(ctx.host, m, side, other));
      }
      if (score < bestScore - 1e-6) { best = id; bestScore = score; }
    }
    return best;
  }

  /** The member as the stroke left it and what the status line says. */
  finish(): BorrowStrokeResult {
    const { scn, ctx, shadow } = this;
    const after = encodeBorrowLattice(scn, ctx.sourceEra, shadow.isom);
    remember(after, scn, ctx.sourceEra, shadow.tiles);
    markDirty(scn, "MTXM", "TILE");
    // Joins to the map's own ground: from a cell the stroke laid to a neighbour that is not borrowed.
    const borrowed = borrowedCells(scn, ctx.sourceEra, shadow.isom);
    for (const at of this.touched) borrowed[at] = 1;
    let seams = 0;
    for (const at of this.touched) {
      const m = megatileForTile(ctx.host, scn.tiles[at]);
      if (m <= 0) continue;
      const x = at % scn.width, y = (at / scn.width) | 0;
      for (const side of SIDES) {
        const nx = x + OFFSET[side][0], ny = y + OFFSET[side][1];
        if (nx < 0 || ny < 0 || nx >= scn.width || ny >= scn.height || borrowed[ny * scn.width + nx]) continue;
        const other = megatileForTile(ctx.host, scn.tiles[ny * scn.width + nx]);
        if (other > 0 && seamStep(ctx.host, m, side, other) > SEAM_SHOWS) seams++;
      }
    }
    return { before: this.before, after, kept: [...this.keptAt], untranslated: this.untranslated.size, standIns: this.standIns.size, reset: this.reset, seams };
  }
}

const groupCopies = new WeakMap<BorrowContext["table"], Map<number, Set<number>>>();
/** The host megatiles that are copies of any slot of source group `group`. */
function copiesOfGroup(ctx: BorrowContext, group: number): Set<number> {
  let byGroup = groupCopies.get(ctx.table);
  if (!byGroup) groupCopies.set(ctx.table, (byGroup = new Map()));
  let set = byGroup.get(group);
  if (!set) {
    set = new Set();
    for (const m of ctx.source.groups[group].megatiles) for (const hm of (m ? ctx.table.copies.get(m) : undefined) ?? []) set.add(hm);
    byGroup.set(group, set);
  }
  return set;
}

const OFFSET: Record<Side, [number, number]> = { left: [-1, 0], top: [0, -1], right: [1, 0], bottom: [0, 1] };

/** A byte per tile, 1 where the borrowed lattice is not the base ground (either diamond of the tile's rect). */
export function borrowedCells(size: Size, sourceEra: number, isom: Uint16Array): Uint8Array {
  const w = isomWidth(size), h = isomHeight(size);
  const base = baseValue(sourceEra);
  const out = new Uint8Array(size.width * size.height);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < Math.floor(size.width / 2); x++) {
      if (diamondsOfRect(x, y).every((d) => diamondValue(isom, w, h, d) === base)) continue;
      out[y * size.width + 2 * x] = 1;
      out[y * size.width + 2 * x + 1] = 1;
    }
  }
  return out;
}
