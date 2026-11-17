/**
 * A data set's terrain file (`formats/mod/terrain.ts`): kept with the data set's id, and while that data set is in use
 * its sections are provided through the same atoms the plugins' `provide*` calls feed — named pieces, named flat
 * ground, exact borrow tables — under a provider that is the data set (`@dataset:<id>`), not a plugin.
 *
 * - Kept in IndexedDB, in the learned pieces' store (`terrain/<id>`, the file's text): it can hold thousands of pieces,
 *   so not in localStorage beside the races. Adding the data set again replaces it, removing it or Clear all data
 *   forgets it.
 * - A plugin's declaration of the same thing wins: the plugins' rows stay ahead of the data set's in each atom
 *   (`beforeDataSet`), and every reader lets the first of a duplicate stand.
 * - A section is used only when its `table` is the hash of the tileset in use's group table (`pieceLearn.ts#tableHash`,
 *   the key learned pieces are kept under); otherwise it is said once (a toast per data set, tileset and hash) and left.
 * - When another data set comes into use, or the game's own, every row of the file is taken back.
 *
 * Per data set, not per document: nothing here is parked with a map, and nothing is written to a map.
 */
import { providedBorrowAtom, type ProvidedBorrow } from "../atoms/borrowAtoms";
import { providedBordersAtom, type ProvidedBorder } from "../atoms/borderAtoms";
import { providedCopiesAtom, type ProvidedCopy } from "../atoms/copyAtoms";
import { scenarioAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { gameDataRevisionAtom, gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { providedPiecesAtom, providedTypesAtom } from "../atoms/pieceAtoms";
import { pushToastAtom } from "../atoms/uiAtoms";
import { TILESETS, type TilesetId } from "../data/tilesets";
import { tableHash } from "../editor/modTerrain/pieceLearn";
import { DATA_SET_KEY, isDataSetKey } from "../editor/modTerrain/pieceList";
import { tilesetIndex } from "../formats/chk/scenario";
import { readTerrainFile, type TerrainFile } from "../formats/mod/terrain";
import { loadTilesetGroups, peekTileset, TILESET_FILENAMES } from "../formats/tileset/load";
import { logInfo } from "../app/log";
import { t, translate } from "../i18n";
import { drawsFromGame, refreshProvided } from "./borrow";
import { browserPieceStore, type PieceStore } from "./pieceStore";
import type { Store } from "../atoms/store";

const fileKey = (id: string) => `terrain/${id}`;

/** Keep a data set's terrain file (its text), or forget it for null. Never throws. */
export async function keepDataSetTerrain(id: string, text: string | null, db: PieceStore = browserPieceStore): Promise<void> {
  try {
    if (text) await db.put(fileKey(id), text);
    else await db.delete(fileKey(id));
  } catch { /* a browser keeping nothing: it lasts the session in memory, or not at all */ }
}

/** The terrain file kept for a data set, read; null when none is. */
export async function keptDataSetTerrain(id: string, db: PieceStore = browserPieceStore): Promise<TerrainFile | null> {
  const text = await db.get(fileKey(id)).catch(() => null);
  return typeof text === "string" ? readTerrainFile(text).file : null;
}

/** The kept text, as it was given (for the writer to keep a file's other sections). */
export async function keptDataSetTerrainText(id: string, db: PieceStore = browserPieceStore): Promise<string | null> {
  const text = await db.get(fileKey(id)).catch(() => null);
  return typeof text === "string" ? text : null;
}

/** A row put in ahead of the data set's: a plugin's declaration is closer to the mapper than the mod's file. */
export function beforeDataSet<T extends { key: string }>(rows: readonly T[], row: T): T[] {
  return [...rows.filter((r) => !isDataSetKey(r.key)), row, ...rows.filter((r) => isDataSetKey(r.key))];
}

/** The tables in use, by tileset id: what a section's `table` must match. Read from the data set in use, CV5 alone. */
export type TableHashes = (tileset: TilesetId) => Promise<string | null>;
const tablesInUse: TableHashes = async (tileset) => {
  const groups = await loadTilesetGroups(TILESET_FILENAMES[TILESETS.findIndex((x) => x.id === tileset)]).catch(() => null);
  return groups ? tableHash(groups) : null;
};

/** What the data set's file provides now: the sections used and those whose table differs. */
export interface DataSetTerrainState {
  id: string;
  used: TilesetId[];
  mismatched: TilesetId[];
}

const told = new Set<string>();
let generation = 0;

/**
 * Put the data set in use's file in force: take back every row an earlier file provided, then provide this one's
 * sections whose table matches. Called when the data set in use changes, after a file is kept, and on a reload.
 */
export async function applyDataSetTerrain(store: Store, deps: { db?: PieceStore; tables?: TableHashes } = {}): Promise<DataSetTerrainState | null> {
  const mine = ++generation;
  const source = store.get(gameDataSourceAtom);
  const id = source && !drawsFromGame(source) ? source.profile.id : null;
  const file = id ? await keptDataSetTerrain(id, deps.db) : null;
  const used: TilesetId[] = [], mismatched: TilesetId[] = [];
  type PieceRow = (typeof providedPiecesAtom extends { init: readonly (infer R)[] } ? R : never);
  type TypeRow = (typeof providedTypesAtom extends { init: readonly (infer R)[] } ? R : never);
  const pieces: PieceRow[] = [];
  const types: TypeRow[] = [];
  const borrow: ProvidedBorrow[] = [];
  const borders: ProvidedBorder[] = [];
  const copies: ProvidedCopy[] = [];
  if (id && file) {
    const name = source!.profile.name;
    const provider = `${DATA_SET_KEY}${id}`;
    for (const [tileset, section] of Object.entries(file.tilesets) as [TilesetId, TerrainFile["tilesets"][string]][]) {
      const hash = await (deps.tables ?? tablesInUse)(tileset);
      if (mine !== generation) return null; // another data set came in meanwhile
      if (hash !== section.table) {
        mismatched.push(tileset);
        const key = `${id}|${tileset}|${section.table}`;
        if (!told.has(key)) {
          told.add(key);
          store.set(pushToastAtom, {
            kind: "warn",
            title: t("{name}'s terrain file does not fit its {tileset}", { name, tileset: translate(TILESETS.find((x) => x.id === tileset)!.name) }),
            detail: t("The file was made for another version of this tileset's tile table, so its pieces, terrain names and tables for that tileset are not used. Save a new terrain file from the Tile palette's pieces to make one that fits."),
          });
        }
        continue;
      }
      used.push(tileset);
      if (section.pieces.length > 0) {
        pieces.push({ key: `${provider}:${tileset}`, source: provider, label: name, tileset, pieces: section.pieces.map((p) => ({ ...(p.name ? { name: p.name } : {}), ...(p.category ? { category: p.category } : {}), block: { cols: p.cols, rows: p.rows, ids: [...p.tiles] } })) });
      }
      if (section.terrains.length > 0) types.push({ key: `${provider}:${tileset}`, source: provider, tileset, types: section.terrains.map((x) => ({ ...x })) });
      for (const b of section.borrow) borrow.push({ key: `${provider}:${tileset}:${b.source}`, tileset, source: b.source, pairs: b.pairs, ...(b.standIns ? { standIns: b.standIns } : {}) });
      (section.copies ?? []).forEach((c, i) => copies.push({ key: `${provider}:${tileset}:copies:${i}`, tileset, source: c.terrain, height: c.height, outer: c.ground, pieces: c.pieces }));
      for (const b of section.borders) borders.push({ key: `${provider}:${tileset}:${b.source}:${b.terrain}:${b.ground}`, tileset, source: b.source, terrain: b.terrain, ground: b.ground, shapes: b.shapes });
    }
  }
  if (mine !== generation) return null;
  store.set(providedPiecesAtom, [...store.get(providedPiecesAtom).filter((r) => !isDataSetKey(r.key)), ...pieces]);
  store.set(providedTypesAtom, [...store.get(providedTypesAtom).filter((r) => !isDataSetKey(r.key)), ...types]);
  store.set(providedBorrowAtom, [...store.get(providedBorrowAtom).filter((r) => !isDataSetKey(r.key)), ...borrow]);
  store.set(providedBordersAtom, [...store.get(providedBordersAtom).filter((r) => !isDataSetKey(r.key)), ...borders]);
  store.set(providedCopiesAtom, [...store.get(providedCopiesAtom).filter((r) => !isDataSetKey(r.key)), ...copies]);
  // The borrowed terrains of the map in front follow at once.
  const scn = store.get(scenarioAtom), host = peekTileset(store.get(tilesetFileNameAtom))?.tileset;
  if (scn && host) await refreshProvided(store, tilesetIndex(scn), host).catch(() => undefined);
  if (id && file) logInfo("gamedata", "The data set's terrain file is in force", { set: id, used: used.join(" ") || undefined, mismatched: mismatched.join(" ") || undefined, pieces: pieces.reduce((n, p) => n + p.pieces.length, 0), terrains: types.reduce((n, x) => n + x.types.length, 0), borrow: borrow.length, borders: borders.length, copies: copies.length });
  return id ? { id, used, mismatched } : null;
}

/** Follow the data set in use (and a reload of it) for as long as the store lives; the returned function stops. */
export function watchDataSetTerrain(store: Store): () => void {
  let last: unknown = undefined;
  const run = () => {
    const now = [store.get(gameDataSourceAtom), store.get(gameDataRevisionAtom)];
    if (Array.isArray(last) && last[0] === now[0] && last[1] === now[1]) return;
    last = now;
    void applyDataSetTerrain(store);
  };
  const a = store.sub(gameDataSourceAtom, run);
  const b = store.sub(gameDataRevisionAtom, run);
  run();
  return () => { a(); b(); };
}
