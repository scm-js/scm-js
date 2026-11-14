import { useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import { learnedPiecesAtom } from "../atoms/pieceAtoms";
import { scenarioAtom } from "../atoms/documentAtoms";
import type { Tileset } from "../formats/tileset/decode";
import type { PieceEvidence } from "../editor/pieces";
import { learnedKeyOf, loadLearnedPieces } from "../services/pieces";

export { entriesOf, piecesFromStore, piecesInFront, sectionsFromStore, type PiecesInFront } from "../services/pieces";

/** The learned evidence for the map in front's tileset table: undefined while it is read, null for none. */
export function useLearnedPieces(tileset: Tileset | null): { key: string | null; evidence: PieceEvidence | null | undefined } {
  const store = useStore();
  const scenario = useAtomValue(scenarioAtom);
  const learned = useAtomValue(learnedPiecesAtom);
  const key = learnedKeyOf(scenario, tileset);
  useEffect(() => {
    if (key) void loadLearnedPieces(store, key);
  }, [store, key]);
  return { key, evidence: key ? learned[key] : undefined };
}

