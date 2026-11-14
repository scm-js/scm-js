/**
 * The pieces learned from a folder of maps, kept in the browser between sessions: one record
 * per tileset *table* — the tileset's name and a hash of its CV5 (`pieceLearn.ts#tableHash`) —
 * the evidence in `pieces.ts`' flat number form as an `Int32Array`. Evidence is about one
 * table's tile ids, so a mod attached from its folder and the same mod installed under another
 * name share it, and an update that changes a table starts that tileset afresh. A few MB for
 * eight tilesets, so IndexedDB (`handleStore.ts`' database, its own store), not localStorage.
 * Behind `PieceStore` so a test can hand in a map of its own.
 */
import { TILESET_FILENAMES } from "../formats/tileset/load";
import type { Cv5Group } from "../formats/tileset/decode";
import { decodeEvidence, encodeEvidence, type PieceEvidence } from "../editor/pieces";
import { tableHash } from "../editor/pieceLearn";
import { idbRequest, PIECES_STORE } from "./handleStore";

export interface PieceStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** A store in memory: the stand-in without IndexedDB, and a test's. */
export function memoryPieceStore(): PieceStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => data.get(key),
    put: async (key, value) => { data.set(key, value); },
    delete: async (key) => { data.delete(key); },
    clear: async () => { data.clear(); },
  };
}

const memory = memoryPieceStore();
const hasIdb = () => typeof indexedDB !== "undefined";

/** The editor's store: IndexedDB, or memory where the browser keeps none (then learning lasts the session). */
export const browserPieceStore: PieceStore = {
  async get(key) {
    if (!hasIdb()) return memory.get(key);
    try { return await idbRequest(PIECES_STORE, "readonly", (s) => s.get(key)); } catch { return memory.get(key); }
  },
  async put(key, value) {
    if (!hasIdb()) return memory.put(key, value);
    try { await idbRequest(PIECES_STORE, "readwrite", (s) => s.put(value, key)); } catch { await memory.put(key, value); }
  },
  async delete(key) {
    await memory.delete(key);
    if (!hasIdb()) return;
    try { await idbRequest(PIECES_STORE, "readwrite", (s) => s.delete(key)); } catch { /* stays until the site data is cleared */ }
  },
  async clear() {
    await memory.clear();
    if (!hasIdb()) return;
    try { await idbRequest(PIECES_STORE, "readwrite", (s) => s.clear()); } catch { /* as above */ }
  },
};

/** The record's key: the tileset's file name and its table's hash. */
export const piecesKey = (era: number, groups: readonly Cv5Group[]) => `${TILESET_FILENAMES[era & 7]}/${tableHash(groups)}`;

/** The learned evidence under a key, or null when none was learned (or it no longer reads). */
export async function readLearned(store: PieceStore, key: string): Promise<PieceEvidence | null> {
  const value = await store.get(key);
  if (!(value instanceof Int32Array) && !Array.isArray(value)) return null;
  return decodeEvidence(Array.from(value as ArrayLike<number>));
}

/** Learning again replaces what was learned for the tables in use: every key in `keys` goes, then `evidence` is written. */
export async function writeLearned(store: PieceStore, keys: readonly string[], evidence: ReadonlyMap<string, PieceEvidence>): Promise<void> {
  await forgetLearned(store, keys);
  for (const [key, e] of evidence) await store.put(key, Int32Array.from(encodeEvidence(e)));
}

export async function forgetLearned(store: PieceStore, keys: readonly string[]): Promise<void> {
  for (const key of keys) await store.delete(key);
}
