import { atom } from "jotai";
import type { TilesetId } from "../data/tilesets";
import type { PieceEvidence } from "../editor/pieces";
import type { DeclaredTerrain, ProvidedPieceSet } from "../editor/pieceList";

/**
 * The learned pieces read so far, by `pieceStore.ts#piecesKey` (tileset and table): the
 * evidence, null for "nothing learned", absent while not yet asked. Global like the store
 * behind it; a learn, a forget or a clear writes the keys it changed.
 */
export const learnedPiecesAtom = atom<Readonly<Record<string, PieceEvidence | null>>>({});

/** A learn in progress: maps done of how many. Outlives the palette, which may close meanwhile. */
export const pieceLearningAtom = atom<{ done: number; total: number } | null>(null);

/** Named pieces plugins provide (`api.terrain.providePieces`), each set for one tileset; listed ahead of the cut ones. */
export const providedPiecesAtom = atom<readonly (ProvidedPieceSet & { tileset: TilesetId })[]>([]);

/** Flat ground plugins declare for the Rect brush (`api.terrain.provideTypes`), per tileset. */
export const providedTypesAtom = atom<readonly { key: string; source: string; tileset: TilesetId; types: readonly DeclaredTerrain[] }[]>([]);
