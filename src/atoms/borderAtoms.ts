/**
 * Drawn borders (editor/borderTable.ts): what is known per host and source, what plugins and the data set's terrain
 * file provide, and the switch. Global, not per document: a table belongs to a pair of tilesets' contents, whatever map
 * is in front, so nothing here goes into `parkRegisters`.
 */
import { atom } from "jotai";
import type { BorderEvidence } from "../editor/borderTable";

/** Evidence learned from maps, by `{host tilesetHash}/{source tilesetHash}` (null: read, and none is kept). */
export const learnedBordersAtom = atom<Readonly<Record<string, BorderEvidence | null>>>({});

/** A border table handed in: by a plugin (`api.terrain.provideBorderTable`) or a data set's terrain file. */
export interface ProvidedBorder {
  /** `{plugin id}:{id}`, or `@dataset:<id>:…` for a terrain file's. */
  key: string;
  /** The host's and the source's tileset ids. */
  tileset: string;
  source: string;
  /** The borrowed terrain (its CV5 index in the source) and the host's ground (its CV5 index here). */
  terrain: number;
  ground: number;
  shapes: Readonly<Record<string, readonly number[]>>;
}
export const providedBordersAtom = atom<readonly ProvidedBorder[]>([]);

/** The From other tilesets switch: lay drawn borders where a table is known. On by default; the session keeps it. */
export const drawnBordersAtom = atom(true);
