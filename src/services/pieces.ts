/**
 * The pieces of the map in front, without React: the cut shared by the Pieces view, Alt+click and
 * the plugin API (`api.terrain.pieces`), the learned part read into `learnedPiecesAtom` on first
 * use, and the sections with the plugins' provided sets ahead of the cut.
 */
import type { createStore } from "jotai";
import { learnedPiecesAtom, providedPiecesAtom } from "../atoms/pieceAtoms";
import { mapTilesetAtom } from "../atoms/editorAtoms";
import { scenarioAtom, terrainRevisionAtom } from "../atoms/documentAtoms";
import { tilesetIndex, type Scenario } from "../formats/chk/scenario";
import type { Tileset } from "../formats/tileset/decode";
import { cutPieces, emptyEvidence, gatherEvidence, mergeEvidence, pieceIndex, type Piece, type PieceEvidence } from "../editor/pieces";
import { collapsePieces, type PieceEntry } from "../editor/tileCopies";
import { pieceSections, type PieceSection } from "../editor/pieceList";
import { browserPieceStore, piecesKey, readLearned } from "./pieceStore";

type Store = ReturnType<typeof createStore>;

/** Read the learned pieces for a key into `learnedPiecesAtom`, once. */
export async function loadLearnedPieces(store: Store, key: string): Promise<void> {
  if (key in store.get(learnedPiecesAtom)) return;
  const evidence = await readLearned(browserPieceStore, key).catch(() => null);
  if (!(key in store.get(learnedPiecesAtom))) store.set(learnedPiecesAtom, { ...store.get(learnedPiecesAtom), [key]: evidence });
}

/** The key the learned pieces of the map in front are kept under: its tileset and that table. */
export function learnedKeyOf(scn: Scenario | null, tileset: Tileset | null): string | null {
  return scn && tileset ? piecesKey(tilesetIndex(scn), tileset.groups) : null;
}

export interface PiecesInFront {
  pieces: Piece[];
  index: Map<number, Piece>;
  /** Maps the learned part counted (0 without one). */
  learnedMaps: number;
}

let last: { scn: Scenario; revision: number; tileset: Tileset; learned: PieceEvidence | null; out: PiecesInFront } | null = null;

/**
 * The pieces of the map in front: its own evidence (one pass over its tiles) merged with the
 * learned collection, cut. Kept for the last (map, terrain revision, tileset, collection), so the
 * view, Alt+click and the plugin API share one cut until the ground changes.
 */
export function piecesInFront(scn: Scenario, revision: number, tileset: Tileset, learned: PieceEvidence | null): PiecesInFront {
  if (last && last.scn === scn && last.revision === revision && last.tileset === tileset && last.learned === learned) return last.out;
  const own = gatherEvidence(emptyEvidence(), scn.tiles, scn.width, scn.height, tileset);
  const pieces = cutPieces(learned ? mergeEvidence(learned, own) : own);
  const out = { pieces, index: pieceIndex(pieces), learnedMaps: learned?.maps ?? 0 };
  last = { scn, revision, tileset, learned, out };
  return out;
}

/** The same, read through the store (the learned part asked for when it has not been): null without a map or a tileset. */
export function piecesFromStore(store: Store, tileset: Tileset | null): PiecesInFront | null {
  const scn = store.get(scenarioAtom);
  const key = learnedKeyOf(scn, tileset);
  if (!scn || !tileset || !key) return null;
  if (!(key in store.get(learnedPiecesAtom))) void loadLearnedPieces(store, key);
  return piecesInFront(scn, store.get(terrainRevisionAtom), tileset, store.get(learnedPiecesAtom)[key] ?? null);
}

const collapsed = new WeakMap<Piece[], PieceEntry[]>();

/** `collapsePieces` of a cut, kept with it. */
export function entriesOf(tileset: Tileset, pieces: Piece[]): PieceEntry[] {
  let out = collapsed.get(pieces);
  if (!out) collapsed.set(pieces, (out = collapsePieces(tileset, pieces)));
  return out;
}

/** The sections the Pieces view lists for the map in front, through the store: the provided sets on its tileset, then the cut. */
export function sectionsFromStore(store: Store, tileset: Tileset | null): PieceSection[] {
  const cut = piecesFromStore(store, tileset);
  if (!cut || !tileset) return [];
  const id = store.get(mapTilesetAtom);
  return pieceSections(tileset, entriesOf(tileset, cut.pieces), store.get(providedPiecesAtom).filter((s) => s.tileset === id));
}
