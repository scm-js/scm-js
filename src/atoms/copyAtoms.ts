/**
 * Copied terrain (editor/terrainCopyTable.ts, terrainCopyLattice.ts): what is known per tileset's files, a scan under
 * way, and the blocks plugins and data sets hand in. Global, not per document — a table belongs to a tileset's files,
 * whatever map is in front — so nothing here goes into `parkRegisters`.
 */
import { atom } from "jotai";
import type { CopyBlock } from "../editor/terrainCopyTable";
import type { RankedGround } from "../editor/terrainCopyLattice";

/** A block as the editor keeps it: the table's block, the grounds it was counted against and the one it is drawn for. */
export interface CopyBlockInfo extends CopyBlock {
  /** Candidates by the seam step, each with its paint-and-count. */
  grounds: RankedGround[];
  outer: RankedGround | null;
  /** What the game's own edge set shows on the same counting strokes (joins per 100 border cells). */
  baseline?: number;
  /** Set when a plugin or a data set's terrain file gave it: the row's key. */
  provided?: string;
}

/** A copied terrain the Isometric tab lists: one per source terrain and height. */
export interface CopyTerrainInfo {
  /** `copiedTerrainId(source, height)`. */
  id: number;
  source: number;
  height: number;
  /** The copy's even group (the Rect tab's pair, which names it). */
  flat: number;
  /** Complete: some block has a tile for every shape the brush asks for. */
  complete: boolean;
  /** For an incomplete terrain, the fewest shapes any of its blocks lacks. */
  missing: number;
  /** Its blocks, complete ones first (rejected ones are not here). */
  blocks: CopyBlockInfo[];
}

export interface CopyHostInfo {
  /** `{tileset file}/{tilesetHash}`. */
  key: string;
  terrains: CopyTerrainInfo[];
  /** Blocks the gate refused (their pieces do not walk or stand as the copy says): counted, never offered. */
  rejected: number;
  scanned: boolean;
}

export const copyHostsAtom = atom<ReadonlyMap<string, CopyHostInfo>>(new Map());

/** A scan under way, for the quiet line in the Isometric tab. */
export const copyScanAtom = atom<{ hostKey: string; share: number } | null>(null);

/** A block a plugin or a data set's terrain file hands in (`api.terrain.provideCopies`, the file's `copies`). */
export interface ProvidedCopy {
  /** `{plugin id}:{id}`, or `@dataset:<id>:…` for a terrain file. */
  key: string;
  /** The tileset id (`jungle`, …). */
  tileset: string;
  /** The copied terrain (its CV5 index) and the copy's height (0 low, 1 mid, 2 high). */
  source: number;
  height: number;
  /** The outer ground: a terrain id of the tileset, or an untyped pair by its even group. */
  outer: { terrain: number } | { pair: number };
  /** Piece of the edge set (`group << 4 | slot`) → the tile standing for it. */
  pieces: readonly (readonly [number, number])[];
}

export const providedCopiesAtom = atom<readonly ProvidedCopy[]>([]);
