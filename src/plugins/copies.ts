/**
 * Copied terrain on the plugin API (`api.terrain.copies` / `provideCopies`, and the `tx.paintCopy` the transaction runs
 * through `paintCopyIn`). Over the same functions the Isometric tab uses: `editor/modTerrain/terrainCopyTable.ts`,
 * `editor/modTerrain/terrainCopyLattice.ts`, `services/terrainCopies.ts`.
 */
import type { createStore } from "jotai";
import { copyHostsAtom, providedCopiesAtom, type ProvidedCopy } from "../atoms/copyAtoms";
import { archiveExtrasAtom, scenarioAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { TILESET_BY_ID, TILESETS } from "../data/tilesets";
import type { Diamond } from "../editor/isom";
import type { TileChange } from "../editor/terrain";
import { copiedParts, CopyStroke, COPY_MEMBER, groundUnder, isCopiedTerrain, patchAt } from "../editor/modTerrain/terrainCopyLattice";
import { tilesetIndex, type Scenario } from "../formats/chk/scenario";
import { peekTileset } from "../formats/tileset/load";
import { chooseBlock, copyHostKey, patchTable, republish, scanCopies, tableFor } from "../services/terrainCopies";
import { beforeDataSet } from "../services/dataSetTerrain";
import { isDataSetKey } from "../editor/modTerrain/pieceList";
import type { CopiedTerrainInfo, CopyBlockSpec, Disposable, TerrainApi } from "./api";
import { t } from "../i18n";

type Store = ReturnType<typeof createStore>;
interface Bag { add(dispose: () => void): Disposable }

const providerOf = (key: string) => (isDataSetKey(key) ? key.split(":").slice(0, 2).join(":") : key.slice(0, key.indexOf(":")));

export function copyCalls(store: Store, pluginId: string, bag: Bag): Pick<TerrainApi, "copies" | "provideCopies"> {
  const front = () => {
    const l = peekTileset(store.get(tilesetFileNameAtom)), scn = store.get(scenarioAtom);
    return l && scn ? { ts: l.tileset, era: tilesetIndex(scn) } : null;
  };
  return {
    copies: async (options) => {
      const f = front();
      if (!f) return [];
      if (options?.scan || !store.get(copyHostsAtom).has(copyHostKey(f.era, f.ts))) await scanCopies(store, f.era, f.ts).catch(() => undefined);
      const host = store.get(copyHostsAtom).get(copyHostKey(f.era, f.ts));
      return (host?.terrains ?? []).map((c): CopiedTerrainInfo => ({
        id: c.id, terrain: c.source, height: c.height, group: c.flat, complete: c.complete, missing: c.missing,
        blocks: c.blocks.map((b) => ({
          ground: b.outer?.kind === "pair" ? { pair: b.outer.group } : { terrain: b.outer?.index ?? 0 },
          complete: b.status === "complete", from: b.provided ? providerOf(b.provided) : "scan",
        })),
      }));
    },
    provideCopies: (spec: CopyBlockSpec) => {
      if (typeof spec?.id !== "string" || spec.id === "") throw new Error("provideCopies needs an id.");
      if (typeof spec.tileset !== "string" || !(spec.tileset in TILESET_BY_ID)) throw new Error(`provideCopies needs a tileset id: ${TILESETS.map((x) => x.id).join(", ")}.`);
      const whole = (v: unknown, hi: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= hi;
      if (!whole(spec.terrain, 0xff) || !whole(spec.height, 2)) throw new Error("provideCopies needs the terrain (its id) and the copy's height (0, 1 or 2).");
      const g = spec.ground as { terrain?: unknown; pair?: unknown } | undefined;
      const ground = g && whole(g.terrain, 0xff) ? { terrain: g.terrain as number } : g && whole(g.pair, 0xfff) && (g.pair as number) % 2 === 0 ? { pair: g.pair as number } : null;
      if (!ground) throw new Error("provideCopies needs the ground: { terrain } or { pair } (an even group).");
      if (!Array.isArray(spec.pieces)) throw new Error("provideCopies needs a list of [piece, tile] pairs.");
      const pieces = spec.pieces.filter((p) => Array.isArray(p) && whole(p[0], 0xffff) && whole(p[1], 0xffff)).map((p) => [p[0], p[1]] as const);
      const key = `${pluginId}:${spec.id}`;
      const row: ProvidedCopy = { key, tileset: spec.tileset, source: spec.terrain, height: spec.height, outer: ground, pieces };
      store.set(providedCopiesAtom, beforeDataSet(store.get(providedCopiesAtom).filter((r) => r.key !== key), row));
      const again = () => { const f = front(); if (f) republish(store, f.era, f.ts); };
      again();
      return bag.add(() => { store.set(providedCopiesAtom, store.get(providedCopiesAtom).filter((r) => r !== row)); again(); });
    },
  };
}

/**
 * `tx.paintCopy` on the map in front: the stroke, its outer ground's tiles and lattice recorded as they were applied
 * (`recordApplied`), the translated cells through `applyTiles`, and the member put in force; `members` records each
 * member's state before the transaction first changed it. False, with a note, when the terrain is not known.
 */
export function paintCopyIn(
  store: Store, scn: Scenario, diamonds: readonly Diamond[], terrainId: number, pinned: Uint8Array | null,
  applyTiles: (changes: TileChange[]) => number, recordApplied: (tiles: TileChange[], isom: TileChange[]) => void,
  members: Map<string, Uint8Array | null>, notes: string[],
): boolean {
  const l = peekTileset(store.get(tilesetFileNameAtom));
  if (!l || !isCopiedTerrain(terrainId)) { notes.push(t("terrain {terrainId} is not a copied terrain", { terrainId })); return false; }
  const era = tilesetIndex(scn);
  const terrain = store.get(copyHostsAtom).get(copyHostKey(era, l.tileset))?.terrains.find((c) => c.id === terrainId);
  if (!terrain) { notes.push(t("painting a copied terrain needs `await api.terrain.copies()` first")); return false; }
  const ds = diamonds.filter((d) => Number.isInteger(d?.x) && Number.isInteger(d?.y) && (d.x + d.y) % 2 === 0);
  if (ds.length === 0) return false;
  const before = store.get(archiveExtrasAtom).get(COPY_MEMBER) ?? null;
  const { source, height } = copiedParts(terrainId);
  const on = patchAt(before, scn, era, source, height, ds[0]);
  let table = on ? patchTable(store, era, l.tileset, on) : null;
  if (!table) {
    const pick = chooseBlock(l.tileset, era, terrain, groundUnder(scn, l.tileset, era, ds));
    if (!pick) return false;
    table = tableFor(l.tileset, era, pick.block, pick.ground);
  }
  const stroke = new CopyStroke(scn, table, before, pinned);
  const p = stroke.paint(ds);
  recordApplied(p.applied, p.isom);
  applyTiles(p.changes);
  const r = stroke.finish();
  if (r.refused > 0) notes.push(t("{n, plural, one {# diamond was} other {# diamonds were}} left: the copied terrain's pieces are drawn for a ground that is not under them", { n: r.refused }));
  if (!members.has(COPY_MEMBER)) members.set(COPY_MEMBER, before);
  const next = new Map(store.get(archiveExtrasAtom));
  if (r.after) next.set(COPY_MEMBER, r.after); else next.delete(COPY_MEMBER);
  store.set(archiveExtrasAtom, next);
  return true;
}
