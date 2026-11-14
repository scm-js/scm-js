import { atom } from "jotai";
import type { PieceEvidence } from "../editor/pieces";

/**
 * The learned pieces read so far, by `pieceStore.ts#piecesKey` (data set and tileset): the
 * evidence, null for "nothing learned", absent while not yet asked. Global like the store
 * behind it; a learn or a forget writes the keys it changed.
 */
export const learnedPiecesAtom = atom<Readonly<Record<string, PieceEvidence | null>>>({});

/** A learn in progress: maps done of how many. Outlives the palette, which may close meanwhile. */
export const pieceLearningAtom = atom<{ done: number; total: number } | null>(null);

/** What the last learn found, for the Pieces view to say until the next. */
export const pieceLearnReportAtom = atom<string | null>(null);
