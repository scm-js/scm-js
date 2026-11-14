/**
 * The pieces learned from a folder of maps, kept in the browser between sessions: one record
 * per data set (its profile id) and tileset, the evidence in `pieces.ts`' flat number form as an
 * `Int32Array`. A few MB for eight tilesets, so IndexedDB (`handleStore.ts`' database, its own
 * store), not localStorage. Behind `PieceStore` so a test can hand in a map of its own.
 */
import { TILESET_FILENAMES } from "../formats/tileset/load";
import { decodeEvidence, encodeEvidence, type PieceEvidence } from "../editor/pieces";
import { idbRequest, PIECES_STORE } from "./handleStore";

export interface PieceStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A store in memory: the stand-in without IndexedDB, and a test's. */
export function memoryPieceStore(): PieceStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => data.get(key),
    put: async (key, value) => { data.set(key, value); },
    delete: async (key) => { data.delete(key); },
  };
}

const memory = memoryPieceStore();

/** The editor's store: IndexedDB, or memory where the browser keeps none (then learning lasts the session). */
export const browserPieceStore: PieceStore = {
  async get(key) {
    if (typeof indexedDB === "undefined") return memory.get(key);
    try { return await idbRequest(PIECES_STORE, "readonly", (s) => s.get(key)); } catch { return memory.get(key); }
  },
  async put(key, value) {
    if (typeof indexedDB === "undefined") return memory.put(key, value);
    try { await idbRequest(PIECES_STORE, "readwrite", (s) => s.put(value, key)); } catch { await memory.put(key, value); }
  },
  async delete(key) {
    await memory.delete(key);
    if (typeof indexedDB === "undefined") return;
    try { await idbRequest(PIECES_STORE, "readwrite", (s) => s.delete(key)); } catch { /* stays until the site data is cleared */ }
  },
};

/** The record's key: the data set's id and the tileset's file name. */
export const piecesKey = (setId: string, era: number) => `${setId}/${TILESET_FILENAMES[era & 7]}`;

/** The learned evidence for a data set and tileset, or null when none was learned (or it no longer reads). */
export async function readLearned(store: PieceStore, setId: string, era: number): Promise<PieceEvidence | null> {
  const value = await store.get(piecesKey(setId, era));
  if (!(value instanceof Int32Array) && !Array.isArray(value)) return null;
  return decodeEvidence(Array.from(value as ArrayLike<number>));
}

/** Learning again replaces the data set's whole collection: every tileset's record goes, then what was learned is written. */
export async function writeLearned(store: PieceStore, setId: string, evidence: ReadonlyMap<number, PieceEvidence>): Promise<void> {
  await forgetLearned(store, setId);
  for (const [era, e] of evidence) await store.put(piecesKey(setId, era), Int32Array.from(encodeEvidence(e)));
}

export async function forgetLearned(store: PieceStore, setId: string): Promise<void> {
  for (let era = 0; era < TILESET_FILENAMES.length; era++) await store.delete(piecesKey(setId, era));
}
