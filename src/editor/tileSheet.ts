/**
 * The Tile palette's sheet: every listed CV5 group as one row of its sixteen slots, rows touching,
 * in group order. Laid out so, a tileset's groups show the pictures its artist drew across slots
 * and groups (a doodad is one group a row, column c in slot c; a mod's added ground is drawn the
 * same way), and a rectangle of the sheet is a block of tiles that were meant to sit together on
 * the map. Pure: no tileset, no DOM; the caller says which slots are void.
 */
import type { Scenario } from "../formats/chk/scenario";
import type { TileChange } from "./terrain";

/** Slots in a CV5 group: the sheet's width. */
export const SHEET_COLUMNS = 16;

/**
 * The most empty groups (no slot with a picture) that may stand between two listed groups and
 * still count as one run: they are laid as void rows, so a picture with an empty row inside it
 * stays whole. Measured over the game's eight tilesets and Cosmonarchy's: gaps of one to four
 * empty groups are common inside the mod's pictures, and the game's own long empty stretches
 * (hundreds of groups between terrain and doodads) are far past this.
 */
export const SHEET_BRIDGE = 16;

export interface SheetRow {
  /** The CV5 group this row shows. */
  group: number;
  /** Which run the row belongs to: rows of one run are consecutive groups; a drag stays inside one. */
  run: number;
  /** A row bridged in between two listed groups: an empty group, drawn as void. */
  blank: boolean;
}

/**
 * The sheet's rows for the listed groups (ascending, as the palette's filter and search leave
 * them): consecutive groups share a run; a gap of no more than `bridge` groups that `isEmpty`
 * calls empty is filled with blank rows of the same run; any other gap starts a new run.
 */
export function sheetRows(listed: readonly number[], isEmpty: (group: number) => boolean = () => false, bridge = SHEET_BRIDGE): SheetRow[] {
  const rows: SheetRow[] = [];
  let run = -1;
  let prev = -2;
  for (const group of listed) {
    if (group <= prev) continue;
    const gap = group - prev - 1;
    let joined = prev >= 0 && gap === 0;
    if (prev >= 0 && gap > 0 && gap <= bridge) {
      let empty = true;
      for (let g = prev + 1; g < group && empty; g++) if (!isEmpty(g)) empty = false;
      if (empty) {
        for (let g = prev + 1; g < group; g++) rows.push({ group: g, run, blank: true });
        joined = true;
      }
    }
    if (!joined) run++;
    rows.push({ group, run, blank: false });
    prev = group;
  }
  return rows;
}

/** The first and last row (inclusive) of the run `row` is in. */
export function runBounds(rows: readonly SheetRow[], row: number): { first: number; last: number } {
  const run = rows[row]?.run;
  let first = row, last = row;
  while (first > 0 && rows[first - 1].run === run) first--;
  while (last < rows.length - 1 && rows[last + 1].run === run) last++;
  return { first, last };
}

/** A tile id written nowhere: a slot of the block that is left as the map has it. */
export const HOLE = -1;

/**
 * A rectangle of tiles picked from the sheet: `ids` row by row, `cols` × `rows` of them, a void
 * slot as {@link HOLE}. `origin` is where its top-left came from, for the sheet's outline.
 */
export interface TileBlock {
  cols: number;
  rows: number;
  ids: number[];
  origin?: { group: number; slot: number };
}

/** A sheet rectangle in rows and slots, both ends inclusive, in either order. */
export interface SheetRect {
  row0: number;
  col0: number;
  row1: number;
  col1: number;
}

/**
 * The block a rectangle of the sheet picks: null when it crosses a break between runs, leaves
 * the sheet, or holds no tile at all. `isVoid(id)` says which slots have no picture (the null
 * megatile); those and blank rows become holes.
 */
export function blockFromRect(rows: readonly SheetRow[], rect: SheetRect, isVoid: (id: number) => boolean): TileBlock | null {
  const r0 = Math.min(rect.row0, rect.row1), r1 = Math.max(rect.row0, rect.row1);
  const c0 = Math.min(rect.col0, rect.col1), c1 = Math.max(rect.col0, rect.col1);
  if (r0 < 0 || r1 >= rows.length || c0 < 0 || c1 >= SHEET_COLUMNS) return null;
  if (rows[r0].run !== rows[r1].run) return null;
  const cols = c1 - c0 + 1;
  const ids: number[] = [];
  let any = false;
  for (let r = r0; r <= r1; r++) {
    const row = rows[r];
    for (let c = c0; c <= c1; c++) {
      const id = (row.group << 4) | c;
      if (row.blank || isVoid(id)) ids.push(HOLE);
      else { ids.push(id); any = true; }
    }
  }
  return any ? { cols, rows: r1 - r0 + 1, ids, origin: { group: rows[r0].group, slot: c0 } } : null;
}

/** The block's first tile that is not a hole (what the Tile brush's single tile becomes), or HOLE. */
export function firstTile(block: TileBlock): number {
  return block.ids.find((id) => id !== HOLE) ?? HOLE;
}

/** Where on the sheet a block came from, as a rect, or null when its rows are not listed now. */
export function blockRect(rows: readonly SheetRow[], block: TileBlock): SheetRect | null {
  if (!block.origin) return null;
  const row0 = rows.findIndex((r) => r.group === block.origin!.group);
  if (row0 < 0) return null;
  const row1 = row0 + block.rows - 1;
  if (row1 >= rows.length || rows[row1].run !== rows[row0].run || rows[row1].group !== block.origin.group + block.rows - 1) return null;
  return { row0, col0: block.origin.slot, row1, col1: block.origin.slot + block.cols - 1 };
}

/** The cells of `block` laid with its top-left at map cell (x, y): holes and cells off the map left out. */
export function blockCells(block: TileBlock, x: number, y: number, width: number, height: number): { x: number; y: number; id: number }[] {
  const out: { x: number; y: number; id: number }[] = [];
  for (let j = 0; j < block.rows; j++) {
    const ty = y + j;
    if (ty < 0 || ty >= height) continue;
    for (let i = 0; i < block.cols; i++) {
      const tx = x + i;
      if (tx < 0 || tx >= width) continue;
      const id = block.ids[j * block.cols + i];
      if (id !== HOLE) out.push({ x: tx, y: ty, id });
    }
  }
  return out;
}

/** The changes laying `block` at (x, y) would make: holes and cells off the map skipped, tiles already right too. */
export function layBlock(scn: Scenario, block: TileBlock, x: number, y: number): TileChange[] {
  const out: TileChange[] = [];
  for (const c of blockCells(block, x, y, scn.width, scn.height)) {
    const at = c.y * scn.width + c.x;
    const before = scn.tiles[at];
    if (before !== c.id) out.push({ at, before, after: c.id });
  }
  return out;
}

/** Floor division that rounds toward minus infinity, so a drag up or left of the origin steps back whole blocks. */
const floorDiv = (a: number, b: number) => Math.floor(a / b);

/**
 * The top-left of the copy of the pattern under map cell (x, y), for a drag that started with
 * the block's top-left at `origin`: origin + (i·cols, j·rows) for the block cell the pointer is in.
 */
export function patternOrigin(block: Pick<TileBlock, "cols" | "rows">, origin: { x: number; y: number }, x: number, y: number): { x: number; y: number } {
  return {
    x: origin.x + floorDiv(x - origin.x, block.cols) * block.cols,
    y: origin.y + floorDiv(y - origin.y, block.rows) * block.rows,
  };
}

/** The pattern's tile at map cell (x, y) when its copies are laid from `origin`, or HOLE. */
export function patternTileAt(block: TileBlock, origin: { x: number; y: number }, x: number, y: number): number {
  const i = x - origin.x - floorDiv(x - origin.x, block.cols) * block.cols;
  const j = y - origin.y - floorDiv(y - origin.y, block.rows) * block.rows;
  return block.ids[j * block.cols + i];
}

/** The changes tiling `cells` (map indices) with the pattern laid from `origin`; holes leave a cell as it is. */
export function layPattern(scn: Scenario, block: TileBlock, origin: { x: number; y: number }, cells: Iterable<number>): TileChange[] {
  const out: TileChange[] = [];
  for (const at of cells) {
    const id = patternTileAt(block, origin, at % scn.width, Math.floor(at / scn.width));
    if (id === HOLE) continue;
    const before = scn.tiles[at];
    if (before !== id) out.push({ at, before, after: id });
  }
  return out;
}

/**
 * One drag of a block: the press sets the origin, and each cell the pointer reaches lays the copy
 * of the block it falls in, once. What it answers goes into the stroke's change list like any
 * brush's, so the whole drag is one undo step.
 */
export class PatternStroke {
  private readonly laid = new Set<string>();
  readonly block: TileBlock;
  readonly origin: { x: number; y: number };

  constructor(block: TileBlock, origin: { x: number; y: number }) {
    this.block = block;
    this.origin = origin;
  }

  /** The changes for the copy under (x, y), or none when that copy is already down in this drag. */
  at(scn: Scenario, x: number, y: number): TileChange[] {
    const o = patternOrigin(this.block, this.origin, x, y);
    const key = `${o.x},${o.y}`;
    if (this.laid.has(key)) return [];
    this.laid.add(key);
    return layBlock(scn, this.block, o.x, o.y);
  }

  /** How many copies the drag has laid. */
  get copies(): number {
    return this.laid.size;
  }
}
