/**
 * Borrowed terrain, the editor's side (editor/modTerrain/borrow.ts, editor/modTerrain/borrowLattice.ts): where the
 * source tilesets come from, the scan that works the tables out, and keeping them.
 *
 * The source is the game's own tileset *beneath* the data set in use — the base a mod's folder is
 * attached over, else this build's game files, else the stored copy of the game's own. When the
 * data set in use is the game's own (or Remastered), there is nothing to borrow and nothing is
 * offered.
 *
 * A table is worked out once per pair of tilesets' contents and kept in IndexedDB (`BORROW_STORE`):
 * `table/{host hash}/{source hash}` the table as numbers, and `index/{host key}` what the scan
 * found for a host (each source's hash, its terrains, the counts), which is what the palette reads
 * on mount. The scan is asked for by the person (it reads seven tilesets and takes seconds), and
 * runs in slices with a pause between them so the page keeps drawing.
 *
 * React-free, so the plugin host can use it too.
 */
import { borrowHostsAtom, borrowScanAtom, providedBorrowAtom, type BorrowHostInfo, type BorrowSourceInfo } from "../atoms/borrowAtoms";
import { gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { TILESETS } from "../data/tilesets";
import { borrowableTerrains, borrowTable, decodeBorrowTable, encodeBorrowTable, providedTable, tableCounts, tilesetHash, type BorrowTable } from "../editor/modTerrain/borrow";
import type { BorrowContext } from "../editor/modTerrain/borrowLattice";
import { loadTileset, type Tileset } from "../formats/tileset/decode";
import { peekTileset, TILESET_FILENAMES } from "../formats/tileset/load";
import { DEFAULT_PROFILE, isDefaultProfile, REMASTERED_PROFILE } from "../gamedata/profiles";
import { readFrom, type AssetSource } from "../gamedata/source";
import { readStored } from "../gamedata/store";
import { BORROW_STORE } from "./handleStore";
import { logInfo, type LogData } from "../app/log";
import { browserStore, type PieceStore } from "./pieceStore";
import type { Store } from "../atoms/store";

/** The editor's store of borrowed-terrain tables. */
export const browserBorrowStore: PieceStore = browserStore(BORROW_STORE);

/** Whether the data set in use is the game's own (or Remastered): its tilesets hold no other tileset's pictures to borrow. */
export function drawsFromGame(source: AssetSource | null): boolean {
  if (!source) return true;
  return source.kind !== "reader" && (isDefaultProfile(source.profile.id) || source.profile.id === REMASTERED_PROFILE.id);
}

/* ── The source tilesets ─────────────────────────────────── */

/** A file of the game's own data set beneath `source`: a reader's base; else this build's files, else the stored copy. */
async function readGameOwn(source: AssetSource | null, path: string): Promise<Uint8Array | null> {
  if (source?.kind === "reader") return readFrom(source.reader?.base ?? null, path);
  const bundled = await readFrom({ kind: "bundled", profile: DEFAULT_PROFILE, base: import.meta.env.BASE_URL ?? "/", label: "", tried: [] }, path).catch(() => null);
  if (bundled) return bundled;
  const blob = await readStored(path).catch(() => null);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

const sourceCache = new WeakMap<object, Map<number, Promise<Tileset | null>>>();
const NO_SOURCE = {};

/** One of the game's own tilesets as it lies beneath the data set in use (the four files, decoded; no atlas), or null without it. */
export function gameOwnTileset(store: Store, era: number): Promise<Tileset | null> {
  const source = store.get(gameDataSourceAtom);
  const key = source ?? NO_SOURCE;
  let byEra = sourceCache.get(key);
  if (!byEra) sourceCache.set(key, (byEra = new Map()));
  let hit = byEra.get(era);
  if (!hit) {
    hit = (async () => {
      const name = TILESET_FILENAMES[era & 7];
      // With the game's own data in use, a tileset already loaded is the game's own.
      const loaded = drawsFromGame(source) ? peekTileset(name) : null;
      if (loaded) return loaded.tileset;
      const read = (ext: string) => readGameOwn(source, `tileset/${name}.${ext}`);
      const [cv5, vf4, vr4, wpe, vx4ex] = await Promise.all([read("cv5"), read("vf4"), read("vr4"), read("wpe"), read("vx4ex")]);
      const vx4 = vx4ex ?? (await read("vx4"));
      if (!cv5 || !vf4 || !vr4 || !wpe || !vx4) return null;
      return loadTileset({ cv5, vf4, vr4, wpe, vx4, vx4Extended: vx4ex !== null });
    })().catch(() => null);
    byEra.set(era, hit);
  }
  return hit;
}

/* ── Keys and records ────────────────────────────────────── */

/** A host's key: the tileset's file name and the hash of its files. */
export const hostKeyOf = (era: number, host: Tileset): string => `${TILESET_FILENAMES[era & 7]}/${tilesetHash(host)}`;
const indexKey = (hostKey: string) => `index/${hostKey}`;
const tableKey = (host: Tileset, sourceHash: string) => `table/${tilesetHash(host)}/${sourceHash}`;

/** What a scan found for a host, as kept. */
async function readIndex(db: PieceStore, hostKey: string): Promise<BorrowSourceInfo[] | null> {
  const value = await db.get(indexKey(hostKey)).catch(() => null);
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as { sources?: BorrowSourceInfo[] };
    return Array.isArray(parsed.sources) ? parsed.sources : null;
  } catch {
    return null;
  }
}

function publish(store: Store, hostKey: string, sources: BorrowSourceInfo[], scanned: boolean) {
  const next = new Map(store.get(borrowHostsAtom));
  // Nothing scanned and nothing provided: no entry, so the palette offers the scan.
  if (!scanned && sources.length === 0) next.delete(hostKey);
  else next.set(hostKey, { key: hostKey, sources, scanned });
  store.set(borrowHostsAtom, next);
}

/** What is known for the host in front, read from the store into `borrowHostsAtom` (once per key). Nothing is worked out. */
export async function readKnownBorrowed(store: Store, era: number, host: Tileset, db: PieceStore = browserBorrowStore): Promise<BorrowHostInfo | null> {
  const key = hostKeyOf(era, host);
  const known = store.get(borrowHostsAtom).get(key);
  if (known?.scanned) return known;
  const sources = await readIndex(db, key);
  if (!sources) return known ?? null;
  publish(store, key, withProvided(store, era, sources), true);
  return store.get(borrowHostsAtom).get(key) ?? null;
}

/* ── The scan ───────────────────────────────────────────── */

/**
 * What works a table out: the table from `source` into `host`, telling `progress` how far it is
 * (0–1). The editor hands the scan its worker client (`borrowTableClient.ts`, from `main.tsx`);
 * without one, and for any table a worker could not do, the table is worked out on this thread in
 * slices (`slicedTableMaker`).
 */
export interface BorrowTableMaker {
  table(host: Tileset, source: Tileset, progress: (share: number) => void, signal?: AbortSignal): Promise<BorrowTable>;
  /** Counts for the scan's log line since the last call (the worker client: workers, what was cloned). */
  stats?(): LogData;
}

let preferredMaker: BorrowTableMaker | null = null;

/** The table maker scans use by default (the editor's worker client); null for the sliced path alone. */
export function setBorrowTableMaker(maker: BorrowTableMaker | null): void {
  preferredMaker = maker;
}

const framePause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const stopped = () => Object.assign(new Error("stopped"), { name: "AbortError" });
/** Whether an error is a stop (the palette's Stop, or a signal), not a failure. */
export const isStopped = (err: unknown): boolean => err instanceof Error && err.name === "AbortError";

/** The table on this thread, in slices with a pause between them; one table at a time. */
export function slicedTableMaker(pause: () => Promise<void> = framePause): BorrowTableMaker {
  let turn: Promise<unknown> = Promise.resolve();
  return {
    table(host, source, progress, signal) {
      const run = turn.then(() => {
        if (signal?.aborted) throw stopped();
        return borrowTable(host, source, {
          pause: async () => { if (signal?.aborted) throw stopped(); await pause(); },
          progress: (done, total) => progress(done / Math.max(1, total)),
        });
      });
      turn = run.catch(() => undefined);
      return run;
    },
  };
}

export interface ScanDeps {
  db?: PieceStore;
  /** Awaited between slices on the sliced path; the default gives the page a frame. */
  pause?(): Promise<void>;
  /** The game's own tileset of an ERA; the default reads it beneath the data set in use. */
  source?(era: number): Promise<Tileset | null>;
  /** What works the tables out; the default is the one `setBorrowTableMaker` set, else the sliced path. */
  tables?: BorrowTableMaker;
  /** Stops the scan: it rejects with an error `isStopped` knows, and publishes nothing. */
  signal?: AbortSignal;
}

let running: AbortController | null = null;

/** Stop the scan under way, if there is one (the palette's Stop). Tables already worked out are kept. */
export function stopBorrowScan(): boolean {
  if (!running) return false;
  running.abort();
  return true;
}

/**
 * Work out, or read back, the table from each of the game's other tilesets into `host`, and the
 * terrains each offers; publish them in `borrowHostsAtom` and keep them. The tables still to be
 * worked out go to the table maker together (a pool of workers takes them in turn); each is kept
 * as it lands, so a stopped scan loses none of them. Progress in `borrowScanAtom`. A source that
 * is the host's own files (the same hash) is skipped.
 */
export async function scanBorrowed(store: Store, era: number, host: Tileset, deps: ScanDeps = {}): Promise<BorrowHostInfo> {
  const db = deps.db ?? browserBorrowStore;
  const sliced = slicedTableMaker(deps.pause ?? framePause);
  const maker = deps.tables ?? preferredMaker ?? sliced;
  const sourceOf = deps.source ?? ((e: number) => gameOwnTileset(store, e));
  const controller = new AbortController();
  deps.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  running?.abort();
  running = controller;
  const signal = controller.signal;
  const hostKey = hostKeyOf(era, host);
  const hostHash = tilesetHash(host);
  const eras = TILESETS.map((_, e) => e).filter((e) => e !== (era & 7));
  const share = new Map<number, number>(eras.map((e) => [e, 0]));
  const tell = () => {
    const next = eras.find((e) => share.get(e)! < 1) ?? eras[eras.length - 1];
    store.set(borrowScanAtom, { hostKey, sourceEra: next, share: [...share.values()].reduce((a, b) => a + b, 0) / eras.length });
  };
  const found: { sourceEra: number; source: Tileset; sourceHash: string; table: BorrowTable | null }[] = [];
  const started = performance.now();
  let fellBack = 0, kept = 0;
  maker.stats?.();
  try {
    // The sources, and the tables already kept: on this thread, short steps.
    for (const sourceEra of eras) {
      tell();
      if (signal.aborted) throw stopped();
      const source = await sourceOf(sourceEra);
      const sourceHash = source ? tilesetHash(source) : "";
      if (!source || sourceHash === hostHash) { share.set(sourceEra, 1); continue; }
      const table = await readTable(db, host, sourceHash);
      if (table) { share.set(sourceEra, 1); kept++; }
      found.push({ sourceEra, source, sourceHash, table });
    }
    tell();
    // The rest, together: a worker pool takes them in turn; what a worker cannot do comes back here.
    await Promise.all(found.filter((f) => !f.table).map(async (f) => {
      const progress = (s: number) => { share.set(f.sourceEra, Math.min(0.99, s)); tell(); };
      try {
        f.table = await maker.table(host, f.source, progress, signal);
      } catch (err) {
        if (isStopped(err) || signal.aborted || maker === sliced) throw err;
        fellBack++;
        f.table = await sliced.table(host, f.source, progress, signal);
      }
      share.set(f.sourceEra, 1);
      tell();
      await db.put(tableKey(host, f.sourceHash), encodeBorrowTable(f.table)).catch(() => undefined);
    }));
    if (signal.aborted) throw stopped();
  } finally {
    if (running === controller) running = null;
    store.set(borrowScanAtom, null);
  }
  const sources: BorrowSourceInfo[] = [];
  for (const f of found) {
    const table = f.table!;
    sources.push({ sourceEra: f.sourceEra, sourceHash: f.sourceHash, terrains: borrowableTerrains(host, era, f.source, f.sourceEra, table), counts: tableCounts(f.source, table) });
    keep(`${hostKey}|${f.sourceEra}`, { host, source: f.source, sourceEra: f.sourceEra, table });
  }
  await db.put(indexKey(hostKey), JSON.stringify({ sources })).catch(() => undefined);
  publish(store, hostKey, withProvided(store, era, sources), true);
  logInfo("terrain", "Looked through the other tilesets for borrowed terrain", {
    tileset: TILESET_FILENAMES[era & 7], sources: found.length, kept, ms: Math.round(performance.now() - started),
    onPage: maker === sliced ? found.length : fellBack, ...maker.stats?.(),
  });
  return store.get(borrowHostsAtom).get(hostKey)!;
}

async function readTable(db: PieceStore, host: Tileset, sourceHash: string): Promise<BorrowTable | null> {
  const value = await db.get(tableKey(host, sourceHash)).catch(() => null);
  if (!(value instanceof Int32Array) && !Array.isArray(value)) return null;
  return decodeBorrowTable(value as ArrayLike<number>);
}

/** Forget what was worked out for a host (the palette's "Scan again"): its index and its tables. */
export async function forgetBorrowed(store: Store, era: number, host: Tileset, db: PieceStore = browserBorrowStore): Promise<void> {
  const key = hostKeyOf(era, host);
  for (const s of (await readIndex(db, key)) ?? []) await db.delete(tableKey(host, s.sourceHash)).catch(() => undefined);
  await db.delete(indexKey(key)).catch(() => undefined);
  const next = new Map(store.get(borrowHostsAtom));
  next.delete(key);
  store.set(borrowHostsAtom, next);
  for (const k of [...tablesKeys()]) if (k.startsWith(`${key}|`)) drop(k);
}

/* ── Tables a plugin hands in ────────────────────────────── */

/** The scanned sources with a plugin's table taking the place of the scan's for its source, and listed even without a scan. */
function withProvided(store: Store, era: number, scanned: BorrowSourceInfo[]): BorrowSourceInfo[] {
  const rows = store.get(providedBorrowAtom).filter((r) => r.tileset === TILESETS[era & 7].id);
  if (rows.length === 0) return scanned;
  const provided = providedInfo.get(TILESETS[era & 7].id) ?? [];
  return [...provided, ...scanned.filter((s) => !provided.some((p) => p.sourceEra === s.sourceEra))];
}

/** The provided tables' terrains, by host tileset id, worked out when they were given (`refreshProvided`). */
const providedInfo = new Map<string, BorrowSourceInfo[]>();

/**
 * Work out what the plugins' tables offer for the host in front and publish it with the scan's.
 * Called when a table is given or taken back, and when a map on another tileset comes in front.
 */
export async function refreshProvided(store: Store, era: number, host: Tileset, deps: Pick<ScanDeps, "source"> = {}): Promise<void> {
  const sourceOf = deps.source ?? ((e: number) => gameOwnTileset(store, e));
  const id = TILESETS[era & 7].id;
  const hostKey = hostKeyOf(era, host);
  const out: BorrowSourceInfo[] = [];
  for (const row of store.get(providedBorrowAtom).filter((r) => r.tileset === id)) {
    const sourceEra = TILESETS.findIndex((t) => t.id === row.source);
    // (rows come plugins first, a data set's terrain file after: the first table for a source stands)
    if (sourceEra < 0 || sourceEra === (era & 7) || out.some((o) => o.sourceEra === sourceEra)) continue;
    const source = await sourceOf(sourceEra);
    if (!source) continue;
    const table = providedTable(host, source, row.pairs, row.standIns ?? []);
    out.push({ sourceEra, sourceHash: tilesetHash(source), terrains: borrowableTerrains(host, era, source, sourceEra, table), counts: tableCounts(source, table), provided: row.key });
    keep(`${hostKey}|${sourceEra}`, { host, source, sourceEra, table });
  }
  providedInfo.set(id, out);
  const scanned = (store.get(borrowHostsAtom).get(hostKey)?.sources ?? []).filter((s) => !s.provided);
  // A source whose provided table went away goes back to the scan's (read again on the next stroke).
  for (const k of [...tablesKeys()]) if (k.startsWith(`${hostKey}|`) && !out.some((o) => k === `${hostKey}|${o.sourceEra}`)) drop(k);
  publish(store, hostKey, withProvided(store, era, scanned), store.get(borrowHostsAtom).get(hostKey)?.scanned ?? false);
}

/* ── The brush's context ─────────────────────────────────── */

const tables = new Map<string, Promise<BorrowContext | null>>();
const settled = new Map<string, BorrowContext | null>();
const tablesKeys = () => tables.keys();
function keep(key: string, ctx: BorrowContext) { tables.set(key, Promise.resolve(ctx)); settled.set(key, ctx); }
function drop(key: string) { tables.delete(key); settled.delete(key); }

/**
 * What the brush needs to lay a source's terrain in the host: the source tileset and the table
 * (a plugin's, else the scan's as kept). Null when the source or the table cannot be had.
 */
export function borrowContext(store: Store, era: number, host: Tileset, sourceEra: number, deps: ScanDeps = {}): Promise<BorrowContext | null> {
  const key = `${hostKeyOf(era, host)}|${sourceEra}`;
  let hit = tables.get(key);
  if (!hit) {
    hit = (async () => {
      const source = await (deps.source ?? ((e: number) => gameOwnTileset(store, e)))(sourceEra);
      if (!source) return null;
      const info = store.get(borrowHostsAtom).get(hostKeyOf(era, host))?.sources.find((s) => s.sourceEra === sourceEra);
      if (info && info.sourceHash !== tilesetHash(source)) return null; // the game's files changed since the scan
      const table = await readTable(deps.db ?? browserBorrowStore, host, tilesetHash(source));
      return table ? { host, source, sourceEra, table } : null;
    })().catch(() => null);
    tables.set(key, hit);
  }
  void hit.then((ctx) => { if (tables.get(key) === hit) settled.set(key, ctx); });
  return hit;
}

/** The context if it has been had already: what a stroke starts from without waiting. */
export function peekBorrowContext(era: number, host: Tileset, sourceEra: number): BorrowContext | null {
  return settled.get(`${hostKeyOf(era, host)}|${sourceEra}`) ?? null;
}
