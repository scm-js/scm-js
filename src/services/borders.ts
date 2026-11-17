/**
 * Drawn borders, the editor's side (editor/borderTable.ts, borderPass.ts): the tables a borrowed stroke draws borders
 * from, where they come from, and keeping what was learned.
 *
 * A pair's table comes from, first to last: a plugin (`api.terrain.provideBorderTable`), the data set's terrain file
 * (its `borders` section), maps (Learn from Maps…). Learned evidence is kept in IndexedDB, in the learned pieces' store,
 * per host and source (`borders/{host tilesetHash}/{source tilesetHash}`), so Forget and Clear all data forget it with
 * the pieces. It is learned only for sources whose borrow table is known (scanned or provided): telling a copy of the
 * source's ground from a drawn piece needs it, and every known table helps (a copy of any other tileset is no piece).
 *
 * The stand-in the shapes are read with is the game's own Badlands beneath the data set (`gameOwnTileset`).
 * React-free, so the plugin host can use it too.
 */
import { borrowHostsAtom } from "../atoms/borrowAtoms";
import { drawnBordersAtom, learnedBordersAtom, providedBordersAtom } from "../atoms/borderAtoms";
import { TILESETS } from "../data/tilesets";
import { tilesetHash } from "../editor/borrow";
import { badlandsStandIns, type StandIns } from "../editor/borderLattice";
import { warmBorderPass } from "../editor/borderPass";
import {
  borderClasses, cutBorderTables, decodeBorderEvidence, emptyBorderEvidence, encodeBorderEvidence, pairKey, pairOf,
  type BorderClasses, type BorderEvidence, type BorderPairTable, type BorderSetup,
} from "../editor/borderTable";
import type { BorrowContext } from "../editor/borrowLattice";
import type { Tileset } from "../formats/tileset/decode";
import { borrowContext, gameOwnTileset, hostKeyOf, readKnownBorrowed } from "./borrow";
import { browserPieceStore, type PieceStore } from "./pieceStore";
import type { Store } from "../atoms/store";

export const bordersKey = (hostHash: string, sourceHash: string) => `borders/${hostHash}/${sourceHash}`;

/** What a host's borders need, once worked out: the stand-ins and the contexts of every source whose table is known. */
interface Prepared { standIns: StandIns; ctxs: BorrowContext[]; classes: BorderClasses }
const prepared = new Map<string, Prepared>();
const preparing = new Map<string, Promise<Prepared | null>>();

/** The contexts of every source whose borrow table is known for the host (scanned or provided). */
async function knownContexts(store: Store, era: number, host: Tileset): Promise<BorrowContext[]> {
  const info = store.get(borrowHostsAtom).get(hostKeyOf(era, host)) ?? (await readKnownBorrowed(store, era, host).catch(() => null));
  const out: BorrowContext[] = [];
  for (const s of info?.sources ?? []) {
    const ctx = await borrowContext(store, era, host, s.sourceEra).catch(() => null);
    if (ctx) out.push(ctx);
  }
  return out;
}

/**
 * Get a host ready for drawn borders: the stand-ins, the known sources' contexts, what was learned for them, and the
 * seam measures warmed (the first stroke would otherwise pay for them). Null when the game's Badlands is not to be had
 * or no source is known. Called when the From other tilesets list shows, and again after a scan or a learn.
 */
export function prepareBorders(store: Store, era: number, host: Tileset, db: PieceStore = browserPieceStore, again = false): Promise<Prepared | null> {
  const key = hostKeyOf(era, host);
  let hit = again ? undefined : preparing.get(key);
  if (!hit) {
    hit = (async () => {
      const bad = await gameOwnTileset(store, 0).catch(() => null);
      const ctxs = await knownContexts(store, era, host);
      if (!bad || ctxs.length === 0) { prepared.delete(key); return null; }
      const p: Prepared = { standIns: badlandsStandIns(bad), ctxs, classes: borderClasses(host, ctxs) };
      prepared.set(key, p);
      await readLearnedBorders(store, host, ctxs, db);
      setTimeout(() => warmBorderPass(host), 0);
      return p;
    })().catch(() => null);
    preparing.set(key, hit);
  }
  return hit;
}

/** Read what was learned for these sources into `learnedBordersAtom` (once per key). */
export async function readLearnedBorders(store: Store, host: Tileset, ctxs: readonly BorrowContext[], db: PieceStore = browserPieceStore): Promise<void> {
  const hostHash = tilesetHash(host);
  const next: Record<string, BorderEvidence | null> = { ...store.get(learnedBordersAtom) };
  let changed = false;
  for (const ctx of ctxs) {
    const key = bordersKey(hostHash, tilesetHash(ctx.source));
    if (key in next) continue;
    next[key] = decodeBorderEvidence(await db.get(key).catch(() => null));
    changed = true;
  }
  if (changed) store.set(learnedBordersAtom, next);
}

const cut = new WeakMap<BorderEvidence, BorderPairTable[]>();
const learnedTables = (e: BorderEvidence) => {
  let t = cut.get(e);
  if (!t) cut.set(e, (t = cutBorderTables(e)));
  return t;
};

/**
 * A source's tables for a host, by pair: a plugin's first, then the data set's file, then what maps taught. Empty when
 * nothing is known.
 */
export function borderTables(store: Store, era: number, host: Tileset, source: BorrowContext): Map<string, BorderPairTable> {
  const out = new Map<string, BorderPairTable>();
  const hostId = TILESETS[era & 7].id, sourceId = TILESETS[source.sourceEra & 7].id;
  // (plugins' rows stand ahead of the data set's in the atom: the first row for a pair stands)
  for (const row of store.get(providedBordersAtom)) {
    if (row.tileset !== hostId || row.source !== sourceId) continue;
    const key = pairKey(source.sourceEra, row.terrain, row.ground);
    if (out.has(key)) continue;
    out.set(key, {
      key, x: row.terrain, y: row.ground, sourceEra: source.sourceEra & 7, mode: "neutral", from: row.key,
      shapes: new Map(Object.entries(row.shapes).map(([shape, tiles]) => [shape, tiles.map((id, i) => [id, tiles.length - i] as [number, number])])),
    });
  }
  const learned = store.get(learnedBordersAtom)[bordersKey(tilesetHash(host), tilesetHash(source.source))];
  if (learned) for (const t of learnedTables(learned)) if (t.sourceEra === (source.sourceEra & 7) && !out.has(t.key)) out.set(t.key, t);
  return out;
}

const setups = new Map<string, { tables: Map<string, BorderPairTable>; classes: BorderClasses; setup: BorderSetup }>();

/**
 * What a borrowed stroke draws borders with, if it can now: null when the switch is off, the host is not prepared yet
 * (it is started) or no pair has a table. The same object while nothing changed, so its pools are cut once.
 */
export function peekBorderSetup(store: Store, era: number, host: Tileset, ctx: BorrowContext): BorderSetup | null {
  if (!store.get(drawnBordersAtom)) return null;
  const p = prepared.get(hostKeyOf(era, host));
  if (!p) { void prepareBorders(store, era, host); return null; }
  const tables = borderTables(store, era, host, ctx);
  if (tables.size === 0) return null;
  const key = `${hostKeyOf(era, host)}|${ctx.sourceEra}`;
  const was = setups.get(key);
  if (was && was.classes === p.classes && sameTables(was.tables, tables)) return was.setup;
  const setup: BorderSetup = { tables, standIns: p.standIns, classes: p.classes, pools: new Map() };
  setups.set(key, { tables, classes: p.classes, setup });
  return setup;
}

function sameTables(a: Map<string, BorderPairTable>, b: Map<string, BorderPairTable>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, t] of a) if (b.get(k) !== t) return false;
  return true;
}

/** Per borrowed terrain of a source, the host terrains (CV5 index) a table is known against, and where each came from. */
export function bordersKnown(store: Store, era: number, host: Tileset, ctx: BorrowContext): Map<number, { ground: number; from: string }[]> {
  const out = new Map<number, { ground: number; from: string }[]>();
  for (const t of borderTables(store, era, host, ctx).values()) {
    const list = out.get(t.x) ?? [];
    list.push({ ground: t.y, from: t.from });
    out.set(t.x, list);
  }
  return out;
}

/** The setup a learn reads maps with, for a host tileset: null when it is not prepared (no source known). */
export async function learningSetup(store: Store, era: number, host: Tileset): Promise<{ classes: BorderClasses; standIns: StandIns } | null> {
  const p = await prepareBorders(store, era, host, browserPieceStore, true);
  return p ? { classes: p.classes, standIns: p.standIns } : null;
}

/**
 * Keep what a learn found for a host: per known source its share of the evidence, replacing what was kept (a source the
 * maps showed nothing for is forgotten).
 */
export async function keepLearnedBorders(store: Store, era: number, host: Tileset, evidence: BorderEvidence | null, db: PieceStore = browserPieceStore): Promise<void> {
  const p = prepared.get(hostKeyOf(era, host));
  if (!p) return;
  const hostHash = tilesetHash(host);
  const next: Record<string, BorderEvidence | null> = { ...store.get(learnedBordersAtom) };
  for (const ctx of p.ctxs) {
    const mine = emptyBorderEvidence();
    for (const [key, pair] of evidence?.pairs ?? []) if (pairOf(key).sourceEra === (ctx.sourceEra & 7)) mine.pairs.set(key, pair);
    const key = bordersKey(hostHash, tilesetHash(ctx.source));
    if (mine.pairs.size > 0) { await db.put(key, encodeBorderEvidence(mine)).catch(() => undefined); next[key] = mine; }
    else { await db.delete(key).catch(() => undefined); next[key] = null; }
  }
  store.set(learnedBordersAtom, next);
}

/** Forget what was learned for a host's known sources. */
export async function forgetLearnedBorders(store: Store, era: number, host: Tileset, db: PieceStore = browserPieceStore): Promise<void> {
  await prepareBorders(store, era, host, db);
  await keepLearnedBorders(store, era, host, null, db);
}
