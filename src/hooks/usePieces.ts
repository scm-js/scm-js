import { useEffect } from "react";
import { useAtomValue, useStore, type createStore } from "jotai";
import { gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { learnedPiecesAtom } from "../atoms/pieceAtoms";
import { scenarioAtom, terrainRevisionAtom } from "../atoms/documentAtoms";
import { DEFAULT_PROFILE } from "../gamedata/profiles";
import { currentAssetSource } from "../gamedata/source";
import { tilesetIndex, type Scenario } from "../formats/chk/scenario";
import type { Tileset } from "../formats/tileset/decode";
import { cutPieces, emptyEvidence, gatherEvidence, mergeEvidence, pieceIndex, type Piece, type PieceEvidence } from "../editor/pieces";
import { browserPieceStore, piecesKey, readLearned } from "../services/pieceStore";

type Store = ReturnType<typeof createStore>;

/** The data set the learned pieces are kept under: the one in use, by its profile id. */
export function pieceSetId(store: Store): string {
  return store.get(gameDataSourceAtom)?.profile.id ?? currentAssetSource()?.profile.id ?? DEFAULT_PROFILE.id;
}

/** Read the learned pieces for a key into `learnedPiecesAtom`, once. */
export async function loadLearnedPieces(store: Store, setId: string, era: number): Promise<void> {
  const key = piecesKey(setId, era);
  if (key in store.get(learnedPiecesAtom)) return;
  const evidence = await readLearned(browserPieceStore, setId, era).catch(() => null);
  store.set(learnedPiecesAtom, { ...store.get(learnedPiecesAtom), [key]: evidence });
}

/** The learned evidence for the map in front's data set and tileset: undefined while it is read, null for none. */
export function useLearnedPieces(): { key: string | null; evidence: PieceEvidence | null | undefined } {
  const store = useStore();
  const scenario = useAtomValue(scenarioAtom);
  const learned = useAtomValue(learnedPiecesAtom);
  const source = useAtomValue(gameDataSourceAtom);
  const setId = source?.profile.id ?? currentAssetSource()?.profile.id ?? DEFAULT_PROFILE.id;
  const era = scenario ? tilesetIndex(scenario) : -1;
  const key = era >= 0 ? piecesKey(setId, era) : null;
  useEffect(() => {
    if (era >= 0) void loadLearnedPieces(store, setId, era);
  }, [store, setId, era]);
  return { key, evidence: key ? learned[key] : undefined };
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
 * view and Alt+click share one cut until the ground changes.
 */
export function piecesInFront(scn: Scenario, revision: number, tileset: Tileset, learned: PieceEvidence | null): PiecesInFront {
  if (last && last.scn === scn && last.revision === revision && last.tileset === tileset && last.learned === learned) return last.out;
  const own = gatherEvidence(emptyEvidence(), scn.tiles, scn.width, scn.height, tileset);
  const pieces = cutPieces(learned ? mergeEvidence(learned, own) : own);
  const out = { pieces, index: pieceIndex(pieces), learnedMaps: learned?.maps ?? 0 };
  last = { scn, revision, tileset, learned, out };
  return out;
}

/** The same, read through the store, for a pick on the map: null without a map or a tileset. */
export function piecesFromStore(store: Store, tileset: Tileset | null): PiecesInFront | null {
  const scn = store.get(scenarioAtom);
  if (!scn || !tileset) return null;
  const learned = store.get(learnedPiecesAtom)[piecesKey(pieceSetId(store), tilesetIndex(scn))] ?? null;
  return piecesInFront(scn, store.get(terrainRevisionAtom), tileset, learned);
}
