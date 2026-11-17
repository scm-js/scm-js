/**
 * Borrowed terrain (editor/modTerrain/borrow.ts): what is known per host tileset and how a scan is going.
 * Global, not per document: a table belongs to a pair of tilesets' contents, whatever map is in
 * front, so nothing here goes into `parkRegisters`.
 */
import { atom } from "jotai";
import type { BorrowedTerrain, BorrowKind } from "../editor/modTerrain/borrow";

export interface BorrowSourceInfo {
  sourceEra: number;
  /** `tilesetHash` of the source's files: the table's key with the host's. */
  sourceHash: string;
  /** The terrains it offers in this host. */
  terrains: BorrowedTerrain[];
  /** How the source's tiles were translated (`borrow.ts#tableCounts`). */
  counts: Record<BorrowKind | "none", number>;
  /** Set when a plugin gave the table (`api.terrain.provideBorrowTable`): its key. */
  provided?: string;
}

export interface BorrowHostInfo {
  /** `{tileset file}/{tilesetHash}` of the host. */
  key: string;
  sources: BorrowSourceInfo[];
  /** Whether the other tilesets were looked through (now or before); false while only provided tables are known. */
  scanned: boolean;
}

/** What is known, by host key: read from IndexedDB, or worked out by a scan this session. */
export const borrowHostsAtom = atom<ReadonlyMap<string, BorrowHostInfo>>(new Map());

/** A scan under way: for which host, which source it is on and how far (0–1 overall). */
export const borrowScanAtom = atom<{ hostKey: string; sourceEra: number; share: number } | null>(null);

/** A table a plugin handed in: source tile → host tile pairs for one (host tileset, source tileset). */
export interface ProvidedBorrow {
  /** `{plugin id}:{id}`. */
  key: string;
  /** The host's and the source's tileset ids (`badlands`, `install`, …). */
  tileset: string;
  source: string;
  pairs: readonly (readonly [number, number])[];
  /** Source tiles whose tile is only the nearest picture (stand-ins). */
  standIns?: readonly number[];
}

export const providedBorrowAtom = atom<readonly ProvidedBorrow[]>([]);
