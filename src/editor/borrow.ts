/**
 * Borrowed terrain: a tileset that holds another tileset's pictures.
 *
 * A mod's tileset can carry thousands of groups with no terrain type and no isometric links,
 * much of it another game tileset's ground copied in (Installation's floors and walls inside a
 * Badlands, say). The isometric brush cannot lay that ground from the host's own tables, but it
 * can lay it from the *source's* tables, with each tile it lays translated to a host tile that
 * shows the same picture. This module is the translation: which host megatiles are copies of
 * which source megatiles, which host tile stands for each source tile, and which of the
 * source's terrains are whole in the host. `borrowLattice.ts` is the brush side.
 *
 * The copies are not index-remapped: they were dithered into the host's palette (inside one
 * picture the same source index lands on different host indices, and the error falls with the
 * block size), and a host may hold several differently dithered copies of one picture. So a copy
 * is found by its pixels: the mean difference of the 4 × 4-pixel block means within
 * `BORROW_BLOCK` a channel, and of the pixels within `BORROW_PIXEL`. Calibrated against a
 * negative control (the same sources into the game's tileset of the host's name, which holds none
 * of their art): `.claude/internals/terrain.md` "Borrowed terrain".
 *
 * Fit for the browser: per megatile the 64 block sums only (384 bytes), the pixels read from the
 * tileset when a candidate gets that far, and the long loops `await` a pause now and then.
 * Pure and canvas-free; `tests/borrow.test.ts`.
 */
import type { Tileset } from "../formats/tileset/decode";
import { TILESETS } from "../data/tilesets";
import { isomTables, isomTerrains } from "./isom";
import { sourceTiles, type BorrowTable } from "./borrowTable";

// The table itself (the copy test, `borrowTable`, keeping it) is its own module, which the scan's worker loads.
export * from "./borrowTable";

/** A terrain is whole with stand-ins for at most this share of its tiles (a tenth): the odd missing tile, not the terrain. */
export const STAND_IN_SHARE = 0.1;
/* ── Terrain ids ────────────────────────────────────────── */

/**
 * A terrain id at or above this names a borrowed terrain: `BORROWED_TERRAIN + (source ERA << 8)
 * + CV5 index`. Like the pair ids (`palette.ts#PAIR_TERRAIN`) it is the editor's own and never
 * written to a map.
 */
export const BORROWED_TERRAIN = 0x40000;
export const borrowedTerrainId = (sourceEra: number, index: number): number => BORROWED_TERRAIN + ((sourceEra & 7) << 8) + (index & 0xff);
export const isBorrowedTerrain = (id: number): boolean => id >= BORROWED_TERRAIN && id < BORROWED_TERRAIN + (8 << 8);
export const borrowedParts = (id: number): { sourceEra: number; index: number } => ({ sourceEra: ((id - BORROWED_TERRAIN) >> 8) & 7, index: (id - BORROWED_TERRAIN) & 0xff });

/* ── What can be painted ────────────────────────────────── */

export interface BorrowedTerrain {
  /** `borrowedTerrainId(sourceEra, index)`. */
  id: number;
  sourceEra: number;
  /** The CV5 index of the terrain in the source tileset (what the isometric brush paints there). */
  index: number;
  /** The source palette's name (English; shown through `translate`). */
  name: string;
  /** Tiles of the terrain and of the ground it is laid onto that have no copy and lay a stand-in. */
  standIns: number;
  /** A host tile showing the terrain, for a swatch. */
  tile: number;
}

/**
 * The ground a borrowed stroke meets where nothing borrowed was painted: the terrain a new map
 * of the source tileset is filled with (StarEdit's), so a first stroke lays what it would lay on
 * a fresh map of that tileset.
 */
export const borrowBase = (sourceEra: number): number => TILESETS[sourceEra & 7].defaultIsom;

/**
 * The source's terrains the host can lay whole: a terrain is offered when every tile of its own
 * groups, and of every type the brush steps through between it and the source's base ground
 * (the edge sets and the terrains between, `terrainTypeMap`'s path), has a host tile, stand-ins
 * being at most `STAND_IN_SHARE` of a type's tiles. A terrain the host already types as its own
 * ground (every tile with a copy in a typed group: a Jungle's Dirt in a Badlands) is left out: the
 * game's own brush lays it. Nothing for the host's own tileset. In the source palette's order.
 */
export function borrowableTerrains(host: Tileset, hostEra: number, source: Tileset, sourceEra: number, table: BorrowTable): BorrowedTerrain[] {
  if ((hostEra & 7) === (sourceEra & 7)) return [];
  const tables = isomTables(source, sourceEra);
  const paintable = new Set(isomTerrains(tables));
  const byType = new Map<number, number[]>();
  for (const t of sourceTiles(source)) {
    const index = source.groups[t >> 4].index;
    const list = byType.get(index);
    if (list) list.push(t); else byType.set(index, [t]);
  }
  // Whole: every tile has a host tile, and stand-ins are the odd missing tile, not the terrain
  // (a two-tile flat whose both tiles only look like something in the host is not there).
  const whole = (index: number) => {
    const list = byType.get(index);
    if (!list || !list.every((t) => table.choices.has(t))) return false;
    const standIns = list.filter((t) => table.kinds.get(t) === "standIn").length;
    return standIns <= STAND_IN_SHARE * list.length;
  };
  // The host's typed ground: a terrain whose every tile has a copy there is the host's own.
  const typed = new Set<number>();
  for (const g of host.groups) if (g.index >= 2) for (const m of g.megatiles) if (m !== 0) typed.add(m);
  const n = tables.terrainTypes.length;
  const base = borrowBase(sourceEra);
  const pathTo = (from: number): number[] => {
    const out = [from];
    let at = from;
    for (let step = 0; step < n && at !== base; step++) {
      const next = tables.terrainTypeMap[at * n + base];
      if (next === 0 || next === at || out.includes(next)) return [];
      out.push(next);
      at = next;
    }
    return at === base ? out : [];
  };
  const out: BorrowedTerrain[] = [];
  for (const { id, name } of TILESETS[sourceEra & 7].terrain) {
    if (!paintable.has(id)) continue;
    const path = pathTo(id);
    if (path.length === 0 || !path.every(whole)) continue;
    const own = byType.get(id)!.every((t) => table.copies.get(source.groups[t >> 4].megatiles[t & 15])?.some((m) => typed.has(m)) ?? false);
    if (own) continue;
    let standIns = 0;
    for (const type of path) for (const t of byType.get(type) ?? []) if (table.kinds.get(t) === "standIn") standIns++;
    out.push({ id: borrowedTerrainId(sourceEra, id), sourceEra, index: id, name, standIns, tile: table.choices.get(byType.get(id)![0])![0] });
  }
  return out;
}
