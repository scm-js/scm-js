/**
 * Borrowed terrain on the plugin API (`api.terrain.borrowed` / `provideBorrowTable`, and the
 * `tx.paintBorrowed` the transaction runs through `paintBorrowedIn`). Over the same functions the
 * Isometric tab uses: `editor/borrow.ts`, `editor/borrowLattice.ts`, `services/borrow.ts`.
 */
import type { createStore } from "jotai";
import { borrowHostsAtom, providedBorrowAtom, type ProvidedBorrow } from "../atoms/borrowAtoms";
import { archiveExtrasAtom, scenarioAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { TILESET_BY_ID, TILESETS } from "../data/tilesets";
import { borrowedParts, isBorrowedTerrain } from "../editor/borrow";
import { BorrowStroke, borrowMember } from "../editor/borrowLattice";
import type { Diamond } from "../editor/isom";
import type { TileChange } from "../editor/terrain";
import { tilesetIndex, type Scenario } from "../formats/chk/scenario";
import { peekTileset } from "../formats/tileset/load";
import { borrowContext, drawsFromGame, hostKeyOf, peekBorrowContext, readKnownBorrowed, isStopped, refreshProvided, scanBorrowed } from "../services/borrow";
import type { BorrowedTerrainInfo, BorrowTableSpec, Disposable, TerrainApi } from "./api";
import { t } from "../i18n";
import { beforeDataSet } from "../services/dataSetTerrain";
import { isDataSetKey } from "../editor/pieceList";

type Store = ReturnType<typeof createStore>;
interface Bag { add(dispose: () => void): Disposable }

type BorrowCalls = Pick<TerrainApi, "borrowed" | "provideBorrowTable">;

/** Who gave a table, from its row's key: a plugin's id, or `@dataset:<id>` for a data set's terrain file. */
const providerOf = (key: string) => (isDataSetKey(key) ? key.split(":").slice(0, 2).join(":") : key.slice(0, key.indexOf(":")));

export function borrowCalls(store: Store, pluginId: string, bag: Bag): BorrowCalls {
  const front = () => {
    const l = peekTileset(store.get(tilesetFileNameAtom)), scn = store.get(scenarioAtom);
    return l && scn ? { host: l.tileset, era: tilesetIndex(scn) } : null;
  };
  const tilesetOf = (id: unknown, what: string) => {
    if (typeof id !== "string" || !(id in TILESET_BY_ID)) throw new Error(`provideBorrowTable needs ${what}: ${TILESETS.map((t) => t.id).join(", ")}.`);
    return id;
  };
  return {
    borrowed: async (options) => {
      const f = front();
      if (!f) return [];
      await refreshProvided(store, f.era, f.host);
      let info = await readKnownBorrowed(store, f.era, f.host);
      if ((!info || !info.sources.some((s) => !s.provided)) && options?.scan && !drawsFromGame(store.get(gameDataSourceAtom))) info = await scanBorrowed(store, f.era, f.host).catch((err) => { if (isStopped(err)) return info; throw err; });
      info = store.get(borrowHostsAtom).get(hostKeyOf(f.era, f.host)) ?? info;
      const out: BorrowedTerrainInfo[] = [];
      for (const s of info?.sources ?? []) {
        if (s.terrains.length === 0 || !(await borrowContext(store, f.era, f.host, s.sourceEra))) continue;
        for (const b of s.terrains) out.push({ id: b.id, source: TILESETS[b.sourceEra].id, terrain: b.index, name: b.name, standIns: b.standIns, from: s.provided ? providerOf(s.provided) : "scan" });
      }
      return out;
    },
    provideBorrowTable: (spec: BorrowTableSpec) => {
      if (typeof spec?.id !== "string" || spec.id === "") throw new Error("provideBorrowTable needs an id.");
      const tileset = tilesetOf(spec.tileset, "a tileset id");
      const source = tilesetOf(spec.source, "a source tileset id");
      if (tileset === source) throw new Error("provideBorrowTable: the source must be another tileset.");
      if (!Array.isArray(spec.pairs)) throw new Error("provideBorrowTable needs a list of [source tile, tile] pairs.");
      const pairs = spec.pairs.filter((p) => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[1] >= 0 && p[0] <= 0xffff && p[1] <= 0xffff).map((p) => [p[0], p[1]] as const);
      const key = `${pluginId}:${spec.id}`;
      const standIns = Array.isArray(spec.standIns) ? spec.standIns.filter((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) : [];
      const row: ProvidedBorrow = { key, tileset, source, pairs, ...(standIns.length ? { standIns } : {}) };
      store.set(providedBorrowAtom, beforeDataSet(store.get(providedBorrowAtom).filter((r) => r.key !== key), row));
      const again = () => { const f = front(); if (f) void refreshProvided(store, f.era, f.host); };
      again();
      return bag.add(() => { store.set(providedBorrowAtom, store.get(providedBorrowAtom).filter((r) => r !== row)); again(); });
    },
  };
}

/**
 * `tx.paintBorrowed` on the map in front: the stroke, applied through `applyTiles`, and the
 * member it leaves put in force; `members` records each member's state before the
 * transaction first changed it. False when the terrain or its context is not there.
 */
export function paintBorrowedIn(
  store: Store, scn: Scenario, diamonds: readonly Diamond[], terrainId: number, pinned: Uint8Array | null,
  applyTiles: (changes: TileChange[]) => number, members: Map<string, Uint8Array | null>, notes: string[],
): boolean {
  const l = peekTileset(store.get(tilesetFileNameAtom));
  if (!l || !isBorrowedTerrain(terrainId)) { notes.push(t("terrain {terrainId} is not a terrain borrowed from another tileset", { terrainId })); return false; }
  const { sourceEra, index } = borrowedParts(terrainId);
  const ctx = peekBorrowContext(tilesetIndex(scn), l.tileset, sourceEra);
  if (!ctx) { notes.push(t("painting a borrowed terrain needs `await api.terrain.borrowed()` first")); return false; }
  const name = borrowMember(sourceEra);
  const before = store.get(archiveExtrasAtom).get(name) ?? null;
  const stroke = new BorrowStroke(scn, ctx, before, pinned);
  const changes = stroke.paint(diamonds.filter((d) => Number.isInteger(d?.x) && Number.isInteger(d?.y) && (d.x + d.y) % 2 === 0), index);
  if (!changes) return false;
  applyTiles(changes);
  const r = stroke.finish();
  if (!members.has(name)) members.set(name, before);
  const next = new Map(store.get(archiveExtrasAtom));
  if (r.after) next.set(name, r.after); else next.delete(name);
  store.set(archiveExtrasAtom, next);
  return true;
}
