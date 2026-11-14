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
import { megatileForTile, TileFlag, tileGroupOf, type Tileset } from "../formats/tileset/decode";
import { flatTerrain } from "../formats/tileset/terrain";
import { TILESETS } from "../data/tilesets";
import { ISOM_TABLES, isomValueOf } from "../data/isomTables";
import { SEAM_SHOWS, seamStep, SIDES, type Side } from "./blend";
import { borrowBase, type BorrowTable } from "./borrow";
import { diamondsOfRect, diamondValue, isomHeight, isomWidth, paintIsomDiamonds, setDiamondValue, tilesFromIsom, type Diamond } from "./isom";
import type { TileChange } from "./terrain";
import { decodeBorderRecord, emptyRecord, encodeBorderRecord, type BorderRecord } from "./borderRecord";
import { flatTerrainsOf, standInShapes, type BorderShape } from "./borderLattice";
import { hostTerrainOf, pairKey, pairStandIn, poolOf, type BorderPairTable, type BorderSetup } from "./borderTable";
import { layBorder, type BorderCell } from "./borderPass";

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

/** The source tiles the lattice lays where it is borrowed, `NO_TILE` elsewhere. `base`: diamonds of base ground that are borrowed too. */
function layShadow(shadow: Isomed, ctx: BorrowContext, base?: { has(d: number): boolean }) {
  shadow.tiles.fill(0);
  tilesFromIsom(shadow, ctx.source, () => 0);
  const borrowed = borrowedCells(shadow, ctx.sourceEra, shadow.isom, base);
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
  /** The border record (`borderRecord.ts`) as it was and as the stroke left it. */
  recordBefore: Uint8Array | null;
  recordAfter: Uint8Array | null;
  /** Changes made when the stroke finished (the drawn borders), for the caller to apply and keep with the stroke's. */
  changes: TileChange[];
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
  /** The cells the stroke reached (its settle writes these and a margin); null when it reached none. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Drawn borders, when the stroke laid them: border cells laid with a drawn tile, left as the hard edge, and drawn tiles that walk unlike both sides (`unlike`). */
  borders: { cells: number; drawn: number; hard: number; kept: number; unlike: number; ms: number } | null;
}

/** A rectangle of cells, inclusive. */
interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * One stroke of the borrowed brush on a map: built from the member as the stroke starts, fed
 * diamonds as the pointer moves (`paint`, which answers the changes to apply to the map, live),
 * and finished once (`finish`, the member to store and the counts for the status line).
 *
 * With a border setup (`BorderSetup`: the drawn-border tables for this tileset and source),
 * `finish` lays the patch's border where it meets the tileset's own ground (`borderPass.ts`):
 * the map as it was before any borrowed stroke is rebuilt from the record (`borderRecord.ts`),
 * the interior laid as the source's brush lays it, every border cell whose pair has a table
 * handed to the border pass, and only the difference written. Without one, the stroke is what
 * it always was, and still keeps the record, so ground can be taken back (`takeBack`).
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
  readonly recordBefore: Uint8Array | null;
  private readonly rec: BorderRecord;
  /** Cells this stroke changed that the record does not hold yet: the tile they had. */
  private readonly firstBefore = new Map<number, number>();
  private readonly borders: BorderSetup | null;
  /** The cells the stroke reached, for the finishing pass. */
  private box: Box | null = null;

  constructor(scn: Scenario, ctx: BorrowContext, before: Uint8Array | null, pinned: Uint8Array | null = null, opts: { record?: Uint8Array | null; borders?: BorderSetup | null } = {}) {
    this.scn = scn;
    this.ctx = ctx;
    this.before = before;
    this.pinned = pinned;
    this.recordBefore = opts.record ?? null;
    this.rec = decodeBorderRecord(this.recordBefore, scn, ctx.sourceEra) ?? emptyRecord();
    this.borders = opts.borders && opts.borders.tables.size > 0 ? opts.borders : null;
    const isom = latticeOf(before, scn, ctx.sourceEra);
    this.shadow = makeShadow(scn, ctx.sourceEra, shadowTiles(before, scn, ctx, isom), isom);
    if (this.rec.painted.size > 0) layShadow(this.shadow, ctx, this.rec.painted);
    // A cell the borrowed brush wrote never holds the tileset's own ground (that is a cell back at its host tile, dropped
    // from the record); one that does now had it laid by another tool, or by an editor that does not keep the record.
    for (const [at, was] of this.rec.cells) if (scn.tiles[at] !== was && hostTerrainOf(ctx.host, scn.tiles[at]) >= 0) this.rec.cells.delete(at);
    this.reset = this.checkAgainstMap();
  }

  /**
   * Whether a diamond is the patch a border runs around, and its terrain: a diamond the brush painted (the record), or
   * one holding a terrain of the source other than its base ground (a map whose record an older editor did not keep).
   * An edge value the brush laid around a patch is not the patch. `NOT_PATCH`, else the terrain's CV5 index, or
   * `PATCH_EDGE` for a painted diamond that is an edge now (between two borrowed terrains).
   */
  private inPatch(d: Diamond): number {
    const w = isomWidth(this.scn), h = isomHeight(this.scn), dw = w + 1;
    if (d.x < 0 || d.y < 0 || d.x > w || d.y > h) return NOT_PATCH;
    const v = diamondValue(this.shadow.isom, w, h, d);
    const base = baseValue(this.ctx.sourceEra);
    const flat = flatValues(this.ctx.sourceEra);
    const painted = this.rec.painted.get(d.y * dw + d.x);
    if (painted === undefined) return v !== base ? flat.get(v) ?? NOT_PATCH : NOT_PATCH;
    if (v === isomValueOf(this.ctx.sourceEra, painted)) return painted;
    // Changed since by the brush (an edge between two terrains, a buffer it laid): still the patch between borrowed
    // ground, not where it meets the tileset's own (the brush laid that for ground taken back).
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const n = { x: d.x + dx, y: d.y + dy };
      if (n.x < 0 || n.y < 0 || n.x > w || n.y > h) continue;
      const nv = diamondValue(this.shadow.isom, w, h, n);
      if (!this.rec.painted.has(n.y * dw + n.x) && (nv === base || !flat.has(nv))) return NOT_PATCH;
    }
    return flat.get(v) ?? (v === base ? painted : PATCH_EDGE);
  }

  /**
   * Put back to the base ground every borrowed diamond whose rect's tiles are no longer copies of
   * what the lattice lays there (written over by another tool), and lay the shadow again there.
   * Doodads' cells are judged by the ground under them. With drawn borders, a rect that touches
   * the tileset's own ground holds border tiles, not copies, and is left to the border pass.
   */
  private checkAgainstMap(): number {
    const { scn, ctx, shadow } = this;
    const w = isomWidth(scn), h = isomHeight(scn), dw = w + 1;
    const base = baseValue(ctx.sourceEra);
    const reset: Diamond[] = [];
    const borrowedD = (d: Diamond) => diamondValue(shadow.isom, w, h, d) !== base || this.rec.painted.has(d.y * dw + d.x);
    // Where borders may have been drawn (a setup now, or a record kept), only a rect inside the patch (`inPatch`) is the
    // source's own: one that touches the tileset's ground holds border pieces, the ground's own tile or a hard edge.
    const flat = this.borders || this.rec.cells.size > 0 || this.rec.painted.size > 0;
    const inside = (d: Diamond) => this.inPatch(d) !== NOT_PATCH;
    for (let y = 0; y < scn.height; y++) {
      for (let x = 0; x < Math.floor(scn.width / 2); x++) {
        const ds = diamondsOfRect(x, y);
        if (!ds.some(borrowedD)) continue;
        if (flat && !ds.every(inside)) continue;
        let fine = true;
        for (const at of [y * scn.width + 2 * x, y * scn.width + 2 * x + 1]) {
          const group = shadow.tiles[at] >> 4;
          if (shadow.tiles[at] === NO_TILE || !ctx.source.groups[group]) continue;
          // Any variation of the group the lattice lays here: the shadow's own slot need not be the one painted (a reopened map's is laid afresh).
          if (copiesOfGroup(ctx, group).has(megatileForTile(ctx.host, scn.editorTiles[at]))) continue;
          // A cell the borrowed brush wrote that holds an untyped tile is a border piece it laid (a cliff's stand-in can
          // reach inside the patch); the tileset's own ground or a doodad there was laid by another tool.
          if (flat && this.rec.cells.has(at) && ctx.host.groups[tileGroupOf(scn.editorTiles[at], ctx.host.groups.length)]?.index === 0) continue;
          fine = false;
        }
        if (!fine) for (const d of ds) if (borrowedD(d)) reset.push(d);
      }
    }
    if (reset.length === 0) return 0;
    const seen = new Set<string>();
    for (const d of reset) {
      const key = `${d.x},${d.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      setDiamondValue(shadow.isom, w, h, d, base);
      this.rec.painted.delete(d.y * dw + d.x);
    }
    layShadow(shadow, ctx, this.rec.painted);
    return seen.size;
  }

  private grow(at: number) {
    const x = at % this.scn.width, y = Math.floor(at / this.scn.width);
    const b = this.box;
    if (!b) this.box = { x0: x, y0: y, x1: x, y1: y };
    else { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); }
  }

  private growDiamond(d: Diamond) {
    for (const [cx, cy] of [[2 * d.x - 2, d.y - 1], [2 * d.x + 1, d.y]]) {
      const x = Math.max(0, Math.min(this.scn.width - 1, cx)), y = Math.max(0, Math.min(this.scn.height - 1, cy));
      this.grow(y * this.scn.width + x);
    }
  }

  /** The map tile a cell had before any borrowed stroke. */
  private hostBefore(at: number): number {
    return this.rec.cells.get(at) ?? this.firstBefore.get(at) ?? this.scn.tiles[at];
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
    // The footprints are the patch (the source's base ground painted included, which the lattice cannot tell from none).
    {
      const w = isomWidth(scn), h = isomHeight(scn);
      for (const d of diamonds) if (d.x >= 0 && d.y >= 0 && d.x <= w && d.y <= h && (this.pinned === null || !pinnedDiamond(this.pinned, scn, d))) this.rec.painted.set(d.y * (w + 1) + d.x, index);
    }
    for (const d of diamonds) this.growDiamond(d);
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
    return this.write(chosen);
  }

  /**
   * Take ground back: the diamonds go back to the source's base ground and stop being borrowed, and every cell whose
   * rect is no longer borrowed gets the tile it had before the borrowed brush wrote it. The border around what is
   * left is laid again when the stroke finishes.
   */
  takeBack(diamonds: readonly Diamond[], random: () => number = Math.random): TileChange[] {
    const { scn, ctx, shadow } = this;
    const w = isomWidth(scn), h = isomHeight(scn), dw = w + 1, base = baseValue(ctx.sourceEra);
    // Only borrowed diamonds are given back: painting the base ground over the tileset's own would lay the source's
    // edges around nothing.
    const given = diamonds.filter((d) => d.x >= 0 && d.y >= 0 && d.x <= w && d.y <= h && (this.rec.painted.has(d.y * dw + d.x) || diamondValue(shadow.isom, w, h, d) !== base));
    const edit = given.length > 0 ? paintIsomDiamonds(shadow, ctx.source, given, borrowBase(ctx.sourceEra), random, this.pinned) : null;
    for (const d of diamonds) { this.rec.painted.delete(d.y * dw + d.x); this.growDiamond(d); }
    if (edit) for (const at of edit.kept) this.keptAt.add(at);
    const cells = new Set<number>(edit?.tiles.map((c) => c.at) ?? []);
    for (const d of diamonds) {
      for (const [cx, cy] of [[2 * d.x - 2, d.y - 1], [2 * d.x - 1, d.y - 1], [2 * d.x, d.y - 1], [2 * d.x + 1, d.y - 1], [2 * d.x - 2, d.y], [2 * d.x - 1, d.y], [2 * d.x, d.y], [2 * d.x + 1, d.y]]) {
        if (cx >= 0 && cy >= 0 && cx < scn.width && cy < scn.height) cells.add(cy * scn.width + cx);
      }
    }
    const borrowed = borrowedCells(scn, ctx.sourceEra, shadow.isom, this.rec.painted);
    const chosen = new Map<number, number>();
    for (const at of cells) {
      if (this.pinned?.[at]) { if (scn.tiles[at] !== this.hostBefore(at)) this.keptAt.add(at); continue; }
      if (!borrowed[at]) { shadow.tiles[at] = NO_TILE; chosen.set(at, this.hostBefore(at)); continue; }
      const choices = ctx.table.choices.get(shadow.tiles[at]);
      if (choices && choices.length > 0) chosen.set(at, choices.includes(scn.tiles[at]) ? scn.tiles[at] : this.bestJoin(at, choices, (a) => chosen.get(a) ?? scn.tiles[a]));
    }
    return this.write(chosen);
  }

  /** The chosen tiles as changes to the map, noting what they were for the record. */
  private write(chosen: ReadonlyMap<number, number>): TileChange[] {
    const { scn } = this;
    const changes: TileChange[] = [];
    for (const [at, after] of chosen) {
      this.touched.add(at);
      this.grow(at);
      if (scn.tiles[at] === after) continue;
      if (!this.rec.cells.has(at) && !this.firstBefore.has(at)) this.firstBefore.set(at, scn.tiles[at]);
      changes.push({ at, before: scn.tiles[at], after });
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

  /**
   * Lay the border of the borrowed ground over the stroke's box (and a margin): the map before any borrowed stroke
   * rebuilt from the record, the stand-in's reading of where the border runs and in which shape, the interior from
   * the shadow, each border cell from its pair's table (`layBorder`), and the cells the stand-in leaves outside back
   * to their host tile. Answers the changes against the map as it stands.
   */
  private settle(setup: BorderSetup | null, opts: { whole?: boolean; box?: Box } = {}): { changes: TileChange[]; cells: number; drawn: number; hard: number; kept: number; unlike: number; ms: number; outside: number[] } {
    const t0 = performance.now();
    const { scn, ctx, shadow } = this;
    const W = scn.width, H = scn.height;
    const b = opts.box ?? (opts.whole ? { x0: 0, y0: 0, x1: W - 1, y1: H - 1 } : this.box!);
    // Write over the box and a margin; read the lattice over a wider window, so the stand-in's brush sees what is around.
    const wx0 = Math.max(0, b.x0 - 4), wy0 = Math.max(0, b.y0 - 3), wx1 = Math.min(W - 1, b.x1 + 4), wy1 = Math.min(H - 1, b.y1 + 3);
    const lx0 = Math.max(0, Math.floor((wx0 - 8) / 4) * 4), ly0 = Math.max(0, Math.floor((wy0 - 6) / 2) * 2);
    const lx1 = Math.min(W, wx1 + 9), ly1 = Math.min(H, wy1 + 7);
    const win = { x0: lx0, y0: ly0, w: lx1 - lx0 + ((lx1 - lx0) & 1 && lx1 < W ? 1 : 0), h: ly1 - ly0 };
    // Which diamonds are the patch, and their terrain (`inPatch`).
    const terrainAt = (d: Diamond): number => this.inPatch(d);
    const patch: Diamond[] = [];
    for (let y = win.y0; y <= win.y0 + win.h; y++) for (let x = win.x0 / 2 + ((win.x0 / 2 + y) & 1); x <= win.x0 / 2 + Math.floor(win.w / 2) + 1; x += 2) {
      if (terrainAt({ x, y }) !== NOT_PATCH) patch.push({ x, y });
    }
    // The map before any borrowed stroke, whole (the pass reads neighbours anywhere).
    const host0 = scn.tiles.slice();
    for (const [at, t] of this.rec.cells) host0[at] = t;
    for (const [at, t] of this.firstBefore) host0[at] = t;
    // Per border cell: its patch terrain (from the diamonds around), its ground (the host terrain most common within two cells before any borrowed stroke).
    const xOfCell = (at: number): number => {
      const rx = Math.floor((at % W) / 2), ry = Math.floor(at / W);
      for (const d of diamondsOfRect(rx, ry)) { const t = terrainAt(d); if (t >= 0) return t; }
      // nearest first, out to two diamonds (a cliff stand-in's border reaches that far); then an edge the brush made of
      // painted ground, the terrain painted there. The same answer whatever stroke asks (no "last painted" guess).
      for (const ring of NEAR_RINGS) for (const [dx, dy] of ring) for (const d of diamondsOfRect(rx, ry)) { const t = terrainAt({ x: d.x + dx, y: d.y + dy }); if (t >= 0) return t; }
      const dw = isomWidth(scn) + 1;
      for (const ring of NEAR_RINGS) for (const [dx, dy] of [[0, 0], ...ring]) for (const d of diamondsOfRect(rx, ry)) { const t = this.rec.painted.get((d.y + dy) * dw + d.x + dx); if (t !== undefined) return t; }
      return -1;
    };
    const yOfCell = (at: number): number => {
      const counts = new Map<number, number>();
      const cx = at % W, cy = Math.floor(at / W);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const t = hostTerrainOf(ctx.host, host0[y * W + x]);
        if (t >= 0) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      let best = -1, n = 0;
      for (const [t, k] of counts) if (k > n || (k === n && t < best)) { best = t; n = k; }
      return best;
    };
    // The stand-ins the pairs here need, each laid once over the window.
    const laid = new Map<string, ReturnType<typeof standInShapes>>();
    const shapesFor = (table: BorderPairTable) => {
      const si = pairStandIn(setup!.standIns, setup!.classes, ctx.sourceEra, table.x, table.y);
      const key = `${si.y}:${si.x}:${si.set}`;
      let got = laid.get(key);
      if (!got) laid.set(key, (got = standInShapes(si, win, patch)));
      return got;
    };
    // Every stand-in the tables here use, so a cell any of them borders or widens into is looked at.
    const kinds = setup ? [...setup.tables.values()].map(shapesFor) : [];
    /** Whether the patch is within a diamond of a cell's rect. */
    const nearPatch = (at: number): boolean => {
      for (const d of diamondsOfRect(Math.floor((at % W) / 2), Math.floor(at / W))) {
        for (const [dx, dy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) if (terrainAt({ x: d.x + dx, y: d.y + dy }) !== NOT_PATCH) return true;
      }
      return false;
    };
    /**
     * Whether a cell's rect is made of ground that is not the patch: a diamond of it is the tileset's own. (Not the
     * diamonds around: where two borrowed terrains meet beside the tileset's ground, their edge is the lattice's.)
     */
    const onGround = (at: number): boolean => diamondsOfRect(Math.floor((at % W) / 2), Math.floor(at / W)).some((d) => terrainAt(d) === NOT_PATCH);
    const local = (at: number) => ((Math.floor(at / W) - win.y0) * win.w + (at % W) - win.x0);
    const work = scn.tiles.slice();
    const borrowed = borrowedCells(scn, ctx.sourceEra, shadow.isom, this.rec.painted);
    const cells: BorderCell[] = [];
    const pools = new Map<BorderPairTable, number[]>();
    const srcFlat = flatTerrainsOf(ctx.source, ctx.sourceEra).flatGroup;
    const xTileOf = (x: number, at: number): number => {
      const g0 = srcFlat.get(x);
      if (g0 === undefined) return host0[at];
      const g = g0 + ((at % W) & 1);
      const megas = ctx.source.groups[g]?.megatiles ?? [];
      for (let slot = 0; slot < 16; slot++) if (megas[slot]) { const c = ctx.table.choices.get((g << 4) | slot); if (c?.length) return c[0]; }
      return host0[at];
    };
    const translate = (at: number): number | null => {
      const choices = ctx.table.choices.get(shadow.tiles[at]);
      if (shadow.tiles[at] === NO_TILE || !choices?.length) return null;
      // a copy of any slot of the group the lattice lays here stands (a variation chosen before)
      if (choices.includes(scn.tiles[at]) || copiesOfGroup(ctx, shadow.tiles[at] >> 4).has(megatileForTile(ctx.host, scn.tiles[at]))) return scn.tiles[at];
      return this.bestJoin(at, choices, (a) => work[a]);
    };
    const outside: number[] = [];
    for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) {
      const at = y * W + x;
      if (this.pinned?.[at]) continue;
      const li = local(at);
      const standIn = kinds.some((k) => k.shapes[li] || k.inner[li]);
      // (for `strays`: a cell no patch diamond touches and no stand-in of its own pair names)
      const rectPatch = diamondsOfRect(Math.floor(x / 2), y).some((d) => terrainAt(d) !== NOT_PATCH);
      const out = () => { if (!rectPatch) outside.push(at); };
      if (!borrowed[at] && !standIn) { work[at] = host0[at]; out(); continue; }
      // With drawn borders, the lattice's edges where no stand-in reaches and no patch is near (left where ground was
      // taken back) are the tileset's ground again; without, the brush's edges stand as it lays them.
      if (setup && !standIn && !nearPatch(at)) { work[at] = host0[at]; out(); continue; }
      const xTerr = setup ? xOfCell(at) : -1, yTerr = setup ? yOfCell(at) : -1;
      const table = setup && yTerr >= 0 && xTerr >= 0 ? setup.tables.get(pairKey(ctx.sourceEra, xTerr, yTerr)) ?? null : null;
      if (!table) {
        // No table for this pair: as the brush lays it without drawn borders. With drawn borders, a cell no patch
        // terrain is known around is the brush's leftover: the tileset's ground.
        work[at] = borrowed[at] && !(setup && xTerr < 0) ? translate(at) ?? host0[at] : host0[at];
        if (xTerr < 0 || !borrowed[at]) out(); // (a pair with no table is laid as the brush lays it: not a stray)
        continue;
      }
      const laid = shapesFor(table);
      const shape: BorderShape | null = laid.shapes[li];
      if (shape) {
        if (!pools.has(table)) pools.set(table, poolOf(setup!, table));
        cells.push({ i: at, shape: shape.shape, table, leansX: shape.leansX, xTile: xTileOf(xTerr, at) });
      } else if (laid.inner[li]) {
        // Inside the patch the lattice's tile, unless it is the source's edge to its base ground laid where the patch
        // meets the tileset's own (the brush's buffer around ground taken back): there the patch's own flat tile.
        const sg = shadow.tiles[at] === NO_TILE ? undefined : ctx.source.groups[shadow.tiles[at] >> 4];
        work[at] = sg && sg.index !== xTerr && onGround(at) ? xTileOf(xTerr, at) : translate(at) ?? xTileOf(xTerr, at);
      }
      else { work[at] = host0[at]; out(); } // the stand-in leaves it outside the patch
    }
    const r = layBorder(ctx.host, W, H, work, cells, host0, pools);
    const changes: TileChange[] = [];
    for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) {
      const at = y * W + x;
      if (this.pinned?.[at]) { if (work[at] !== scn.tiles[at]) this.keptAt.add(at); continue; }
      if (work[at] === scn.tiles[at]) continue;
      if (!this.rec.cells.has(at) && !this.firstBefore.has(at)) this.firstBefore.set(at, scn.tiles[at]);
      changes.push({ at, before: scn.tiles[at], after: work[at] });
      this.touched.add(at);
    }
    // Drawn tiles that walk unlike both sides: a border that changes where units go.
    let unlike = 0;
    const walks = (id: number) => { const m = megatileForTile(ctx.host, id); let n = 0; for (let k = 0; k < 16; k++) if (ctx.host.megatileFlags[m * 16 + k] & TileFlag.Walkable) n++; return n === 16 ? 2 : n === 0 ? 0 : 1; };
    for (const c of cells) {
      const t = work[c.i];
      if (t === c.xTile || t === host0[c.i]) continue;
      if (walks(t) !== walks(c.xTile) && walks(t) !== walks(host0[c.i])) unlike++;
    }
    return { changes: changes.sort((a, b) => a.at - b.at), cells: cells.length, drawn: r.drawn, hard: r.hard, kept: r.kept, unlike, ms: performance.now() - t0, outside };
  }

  /**
   * The cells that are outside the patch and outside every border cell the stand-in names, yet do not hold the tile
   * they had before any borrowed stroke: what a stroke with drawn borders should never leave. Over the whole map, or
   * the box a stroke settled (`BorrowStrokeResult.box`). For tests, on a stroke made and not painted.
   */
  strays(box?: { x0: number; y0: number; x1: number; y1: number }): number[] {
    const host0 = (at: number) => this.rec.cells.get(at) ?? this.scn.tiles[at];
    return this.settle(this.borders, box ? { box } : { whole: true }).outside.filter((at) => this.scn.tiles[at] !== host0(at));
  }

  /**
   * The member as the stroke left it, the border record, the changes the finishing pass made (drawn borders) and what
   * the status line says. The caller applies `changes` to the map before committing.
   */
  finish(): BorrowStrokeResult {
    const { scn, ctx, shadow } = this;
    const after = encodeBorrowLattice(scn, ctx.sourceEra, shadow.isom);
    remember(after, scn, ctx.sourceEra, shadow.tiles);
    let changes: TileChange[] = [];
    let borders: BorrowStrokeResult["borders"] = null;
    // The stroke's surroundings settled: interior as the lattice lays it, cells no longer borrowed back at their host
    // tile, and with a setup the border drawn.
    if (this.box) {
      const d = this.settle(this.borders);
      changes = d.changes;
      if (this.borders) borders = { cells: d.cells, drawn: d.drawn, hard: d.hard, kept: d.kept, unlike: d.unlike, ms: d.ms };
    }
    const tileNow = new Map(changes.map((c) => [c.at, c.after]));
    const now = (at: number) => tileNow.get(at) ?? scn.tiles[at];
    // The record: every cell the brush wrote keeps its host tile until it is back at it.
    for (const [at, was] of this.firstBefore) if (now(at) !== was) this.rec.cells.set(at, was);
    for (const [at, was] of this.rec.cells) if (now(at) === was) this.rec.cells.delete(at);
    const recordAfter = encodeBorderRecord(scn, ctx.sourceEra, this.rec);
    markDirty(scn, "MTXM", "TILE");
    // Joins to the map's own ground: from a cell the stroke laid to a neighbour that is not borrowed.
    const borrowed = borrowedCells(scn, ctx.sourceEra, shadow.isom, this.rec.painted);
    for (const at of this.touched) borrowed[at] = 1;
    let seams = 0;
    for (const at of this.touched) {
      const m = megatileForTile(ctx.host, now(at));
      if (m <= 0 || !this.rec.cells.has(at)) continue;
      const x = at % scn.width, y = (at / scn.width) | 0;
      for (const side of SIDES) {
        const nx = x + OFFSET[side][0], ny = y + OFFSET[side][1];
        if (nx < 0 || ny < 0 || nx >= scn.width || ny >= scn.height || borrowed[ny * scn.width + nx]) continue;
        const other = megatileForTile(ctx.host, now(ny * scn.width + nx));
        if (other > 0 && seamStep(ctx.host, m, side, other) > SEAM_SHOWS) seams++;
      }
    }
    return {
      before: this.before, after, recordBefore: this.recordBefore, recordAfter, changes, box: this.box ? { ...this.box } : null,
      kept: [...this.keptAt], untranslated: this.untranslated.size, standIns: this.standIns.size, reset: this.reset, seams, borders,
    };
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

/** A tileset's flat terrains by their ISOM value: value → CV5 index. */
const flatCache = new Map<number, Map<number, number>>();
function flatValues(era: number): Map<number, number> {
  let out = flatCache.get(era & 7);
  if (!out) {
    const types = ISOM_TABLES[era & 7].terrainTypes;
    const half = Math.floor(types.length / 2);
    out = new Map();
    types.forEach((t, i) => { if (i >= 1 && i <= half && t.isomValue !== 0) out!.set(t.isomValue, t.index); });
    flatCache.set(era & 7, out);
  }
  return out;
}

/** Diamonds one and two steps from a diamond, nearest first. */
const NEAR_RINGS: readonly (readonly [number, number])[][] = [
  [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  [[0, -2], [0, 2], [-2, 0], [2, 0], [-2, -2], [2, -2], [-2, 2], [2, 2]],
];

/** `BorrowStroke.inPatch`: not the patch, and the patch where its terrain is an edge now. */
const NOT_PATCH = -1, PATCH_EDGE = -2;

/** Whether the rects a diamond's quadrants fall on are all pinned (the brush leaves such a diamond's tiles as they are). */
function pinnedDiamond(pinned: Uint8Array, size: Size, d: Diamond): boolean {
  let any = false;
  for (const [cx, cy] of [[2 * d.x - 2, d.y - 1], [2 * d.x - 1, d.y - 1], [2 * d.x, d.y], [2 * d.x + 1, d.y]]) {
    if (cx < 0 || cy < 0 || cx >= size.width || cy >= size.height) continue;
    any = true;
    if (!pinned[cy * size.width + cx]) return false;
  }
  return any;
}

const OFFSET: Record<Side, [number, number]> = { left: [-1, 0], top: [0, -1], right: [1, 0], bottom: [0, 1] };

/**
 * A byte per tile, 1 where the borrowed lattice is not the base ground (either diamond of the tile's rect), or where a
 * diamond of `base` (the diamonds the brush painted, `borderRecord.ts`) is.
 */
export function borrowedCells(size: Size, sourceEra: number, isom: Uint16Array, base?: { has(d: number): boolean }): Uint8Array {
  const w = isomWidth(size), h = isomHeight(size), dw = w + 1;
  const bv = baseValue(sourceEra);
  const out = new Uint8Array(size.width * size.height);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < Math.floor(size.width / 2); x++) {
      if (diamondsOfRect(x, y).every((d) => diamondValue(isom, w, h, d) === bv && !base?.has(d.y * dw + d.x))) continue;
      out[y * size.width + 2 * x] = 1;
      out[y * size.width + 2 * x + 1] = 1;
    }
  }
  return out;
}
