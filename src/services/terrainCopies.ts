/**
 * Copied terrain, the editor's side (editor/terrainCopyTable.ts, terrainCopyLattice.ts): the scan of the tileset in
 * front, keeping what it found, the blocks plugins and data sets hand in, and what a stroke needs.
 *
 * The scan runs by itself when a loaded tileset has a copy (`palette.ts#terrainCopies`; the game's eight have none, so
 * they cost nothing): the pixel part in the borrowed-terrain scan's worker (`borrowTableClient.ts#workerCopyScan`, set
 * by `main.tsx`), else on this thread in slices; then, on this thread, each block's outer ground by paint and count.
 * What it found is kept in IndexedDB beside the borrowed tables (`BORROW_STORE`, `copies/{tilesetHash}`), so a tileset's
 * files are scanned once. Preferences ▸ Clear all data forgets it with the borrowed tables.
 *
 * Precedence, per copied terrain (source and height): a plugin's blocks (`api.terrain.provideCopies`) > a data set's
 * terrain file (`copies`) > the scan. React-free, so the plugin host can use it.
 */
import { copyHostsAtom, copyScanAtom, providedCopiesAtom, type CopyBlockInfo, type CopyHostInfo, type CopyTerrainInfo } from "../atoms/copyAtoms";
import { TILESETS } from "../data/tilesets";
import { megatileHeight, type Tileset } from "../formats/tileset/decode";
import { terrainCopies } from "../formats/tileset/palette";
import { TILESET_FILENAMES } from "../formats/tileset/load";
import { providedCopiesAtom as providedRows } from "../atoms/copyAtoms";
import { tilesetHash } from "../editor/borrowTable";
import { edgeSetsOf, findCopyBlocks, flatTerrainsOf, gateBlock, type CopyBlock, type CopySource } from "../editor/terrainCopyTable";
import {
  chooseOuter, copiedTerrainId, copyTable, COUNT_MARGIN, groundsOf, paintCount, rankGrounds, type CopyGround, type CopyPatch, type CopyTable, type RankedGround,
} from "../editor/terrainCopyLattice";
import { logInfo } from "../editor/log";
import { browserBorrowStore } from "./borrow";
import { scenarioAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { gameDataRevisionAtom } from "../atoms/gameDataAtoms";
import { peekTileset } from "../formats/tileset/load";
import { tilesetIndex } from "../formats/chk/scenario";
import type { PieceStore } from "./pieceStore";
import type { Store } from "../atoms/store";

/** The version of what is kept: a stored scan of another version is worked out again. */
const KEPT_VERSION = 2;

export const copyHostKey = (era: number, ts: Tileset): string => `${TILESET_FILENAMES[era & 7]}/${tilesetHash(ts)}`;
const keptKey = (ts: Tileset) => `copies/${tilesetHash(ts)}`;

/** What works the pixel part out: the editor's worker; else (the command line, `@scm-js/core`, the headless host) this thread. */
export type CopyScanMaker = (ts: Tileset, era: number, copies: CopySource[], signal?: AbortSignal) => Promise<CopyBlock[]>;
let preferredMaker: CopyScanMaker | null = null;
export function setCopyScanMaker(maker: CopyScanMaker | null): void { preferredMaker = maker; }

const framePause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const slicedMaker: CopyScanMaker = (ts, era, copies, signal) => findCopyBlocks(ts, era, copies, { pause: framePause, signal });

/* ── Terrains from blocks ───────────────────────────────── */

/** The palette's terrains: blocks grouped by source and height, rejected ones left out, complete terrains first. */
export function terrainsOf(blocks: readonly CopyBlockInfo[]): CopyTerrainInfo[] {
  const by = new Map<number, CopyBlockInfo[]>();
  for (const b of blocks) {
    if (b.status === "rejected" || !b.outer) continue;
    const id = copiedTerrainId(b.source, b.height);
    const l = by.get(id) ?? [];
    l.push(b);
    by.set(id, l);
  }
  const out: CopyTerrainInfo[] = [];
  for (const [id, list] of by) {
    list.sort((a, b) => (a.status === b.status ? a.first - b.first : a.status === "complete" ? -1 : 1));
    const complete = list.some((b) => b.status === "complete");
    out.push({ id, source: list[0].source, height: list[0].height, flat: list[0].flat, complete, missing: complete ? 0 : Math.min(...list.map((b) => b.missing.length)), blocks: list });
  }
  return out.sort((a, b) => (a.complete === b.complete ? a.source - b.source || a.height - b.height : a.complete ? -1 : 1));
}

/**
 * A block is not offered when, on its best ground, its pieces show more than this many joins per 100 border cells beyond
 * what the game's own edge set shows on the same strokes (S over O). Measured over a mod's blocks that pass the flags:
 * complete and incomplete ones that lay well are 0–22 above the game's set, the fragments 70–95 above.
 */
export const GATE_JOINS = 30;

/** What the game's own edge set shows on the counting strokes: the set laid S over O as it is. */
function baselineCount(ts: Tileset, era: number, b: CopyBlock): number {
  const set = edgeSetsOf(ts, era).find((x) => x.index === b.set);
  const sGroup = flatTerrainsOf(ts, era).flatGroup.get(b.source);
  const other = groundsOf(ts, era).get(`t${b.other}`);
  if (!set || sGroup === undefined || !other) return 0;
  const pieces: [number, number][] = [];
  for (const g of set.groups) for (const half of [g, g + 1]) ts.groups[half].megatiles.forEach((m, slot) => { if (m) pieces.push([(half << 4) | slot, (half << 4) | slot]); });
  return paintCount(copyTable(ts, era, { ...b, flat: sGroup, pieces }, other));
}

/**
 * Each block's grounds by the seam step and paint and count, and its outer ground; the gate's last test (`GATE_JOINS`
 * against the game's own set); a pause between grounds (each ~50–80 ms on a mod's tileset).
 */
async function withGrounds(ts: Tileset, era: number, blocks: readonly CopyBlock[], pause: () => Promise<void>, share?: (s: number) => void): Promise<CopyBlockInfo[]> {
  const out: CopyBlockInfo[] = [];
  for (const [i, b] of blocks.entries()) {
    if (b.status === "rejected") { out.push({ ...b, grounds: [], outer: null }); continue; }
    const grounds = rankGrounds(ts, era, b);
    for (const g of grounds) { g.count = paintCount(copyTable(ts, era, b, g)); await pause(); }
    const outer = chooseOuter(grounds);
    const baseline = baselineCount(ts, era, b);
    await pause();
    const tooMany = outer?.count !== undefined && outer.count > baseline + GATE_JOINS;
    out.push({ ...b, grounds, outer, baseline, ...(tooMany ? { status: "rejected" as const } : {}) });
    share?.((i + 1) / Math.max(1, blocks.length));
  }
  return out;
}

function publish(store: Store, key: string, blocks: readonly CopyBlockInfo[], scanned: boolean) {
  const next = new Map(store.get(copyHostsAtom));
  next.set(key, { key, terrains: terrainsOf(blocks), rejected: blocks.filter((b) => b.status === "rejected").length, scanned });
  store.set(copyHostsAtom, next);
}

/* ── The scan ───────────────────────────────────────────── */

const scanned = new Map<string, CopyBlockInfo[]>();
const running = new Map<string, Promise<CopyHostInfo>>();

export interface CopyScanDeps { db?: PieceStore; maker?: CopyScanMaker; pause?: () => Promise<void>; signal?: AbortSignal }

/**
 * What the tileset's files hold of copied terrain: read back if kept, else worked out (and kept). Published in
 * `copyHostsAtom` with the provided blocks taking their terrains' place. Nothing to do (and nothing kept) for a tileset
 * with no copy.
 */
export function scanCopies(store: Store, era: number, ts: Tileset, deps: CopyScanDeps = {}): Promise<CopyHostInfo> {
  const key = copyHostKey(era, ts);
  const was = running.get(key);
  if (was) return was;
  const run = (async () => {
    if (store.get(copyHostsAtom).size === 0) scanned.clear(); // (Clear all data emptied what was published: read the store again)
    const copies = [...terrainCopies(ts).values()];
    if (copies.length === 0) {
      scanned.set(key, []);
      republish(store, era, ts);
      return store.get(copyHostsAtom).get(key)!;
    }
    const db = deps.db ?? browserBorrowStore;
    const kept = await db.get(keptKey(ts)).catch(() => null);
    let blocks: CopyBlockInfo[] | null = null;
    if (typeof kept === "string") {
      try { const parsed = JSON.parse(kept) as { version?: number; blocks?: CopyBlockInfo[] }; if (parsed.version === KEPT_VERSION && Array.isArray(parsed.blocks)) blocks = parsed.blocks; } catch { /* worked out again */ }
    }
    if (!blocks) {
      const started = performance.now();
      store.set(copyScanAtom, { hostKey: key, share: 0 });
      try {
        const maker = deps.maker ?? preferredMaker ?? slicedMaker;
        let found: CopyBlock[];
        let onPage = maker === slicedMaker;
        try {
          found = await maker(ts, era, copies, deps.signal);
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") throw err;
          onPage = true;
          found = await slicedMaker(ts, era, copies, deps.signal);
        }
        const pixelsMs = performance.now() - started;
        store.set(copyScanAtom, { hostKey: key, share: 0.5 });
        blocks = await withGrounds(ts, era, found, deps.pause ?? framePause, (s) => store.set(copyScanAtom, { hostKey: key, share: 0.5 + s / 2 }));
        await db.put(keptKey(ts), JSON.stringify({ version: KEPT_VERSION, blocks })).catch(() => undefined);
        logInfo("terrain", "Looked through the tileset for copied terrain", {
          tileset: TILESET_FILENAMES[era & 7], copies: copies.length, blocks: blocks.length, offered: blocks.filter((b) => b.status !== "rejected").length,
          pixelsMs: Math.round(pixelsMs), ms: Math.round(performance.now() - started), onPage,
        });
      } finally {
        store.set(copyScanAtom, null);
      }
    }
    scanned.set(key, blocks);
    republish(store, era, ts);
    return store.get(copyHostsAtom).get(key)!;
  })();
  running.set(key, run);
  void run.catch(() => undefined).finally(() => running.delete(key));
  return run;
}

/** Whether the scan for these files has been done (or read back) and published (Clear all data empties the atom: scanned again). */
export const copiesKnown = (store: Store, era: number, ts: Tileset): boolean => scanned.has(copyHostKey(era, ts)) && store.get(copyHostsAtom).has(copyHostKey(era, ts));

/** Forget what was found for a tileset's files (tests; Clear all data clears the store and the atom). */
export function forgetCopies(): void {
  scanned.clear();
}

/* ── Blocks a plugin or a terrain file hands in ─────────── */

/** The provided rows for a tileset as blocks, gated as a scanned block is; rows naming no copy at that height are dropped. */
function providedBlocks(store: Store, era: number, ts: Tileset): CopyBlockInfo[] {
  const id = TILESETS[era & 7].id;
  const copies = [...terrainCopies(ts).values()];
  const { flatGroup } = flatTerrainsOf(ts, era);
  const out: CopyBlockInfo[] = [];
  const seen = new Set<string>();
  for (const row of store.get(providedCopiesAtom).filter((r) => r.tileset === id)) {
    const terrainKey = `${row.source}:${row.height}`;
    if (seen.has(terrainKey)) continue; // the first row for a terrain stands (plugins before a data set's file)
    const copy = copies.find((c) => c.source === row.source && megatileHeight(ts, ts.groups[c.group].megatiles.find((m) => m !== 0) ?? 0) === row.height);
    if (!copy || row.pieces.length === 0) continue;
    const set = row.pieces[0][0] >> 4;
    const setIndex = ts.groups[set]?.index ?? 0;
    const other = (() => { const s = ts.groups[set]; for (const [t, g] of flatGroup) if (t !== row.source && s && Object.values(s.edges).includes(ts.groups[g].edges.left)) return t; return -1; })();
    const raise = row.height - megatileHeight(ts, ts.groups[copy.sourceGroup].megatiles.find((m) => m !== 0) ?? 0);
    const pieces = row.pieces.map(([a, b]) => [a, b] as [number, number]);
    const gate = gateBlock(ts, era, { source: row.source, flat: copy.group, raise, set: setIndex, pieces });
    const outer = "terrain" in row.outer ? groundsOf(ts, era).get(`t${row.outer.terrain}`) : groundsOf(ts, era).get(`p${row.outer.pair}`);
    if (!outer) continue;
    const ranked: RankedGround = { id: outer.id, kind: outer.kind, index: outer.index, group: outer.group, step: 0, flags: 1 };
    const groups = pieces.map(([, t]) => t >> 4);
    out.push({
      key: `provided:${row.key}`, source: row.source, flat: copy.group, height: row.height, raise, set: setIndex, other,
      first: Math.min(...groups), last: Math.max(...groups), pieces, ...gate, grounds: [ranked], outer: ranked, provided: row.key,
    });
    seen.add(terrainKey);
  }
  return out;
}

/** Publish the tileset's terrains: the provided blocks, then the scan's for the terrains no row names. */
export function republish(store: Store, era: number, ts: Tileset): void {
  const key = copyHostKey(era, ts);
  const provided = providedBlocks(store, era, ts);
  const fromScan = (scanned.get(key) ?? []).filter((b) => !provided.some((p) => p.source === b.source && p.height === b.height));
  publish(store, key, [...provided, ...fromScan], scanned.has(key));
}

/* ── What a stroke needs ────────────────────────────────── */

const tables = new WeakMap<Tileset, Map<string, CopyTable>>();
const counts = new WeakMap<Tileset, Map<string, number>>();

/** The table for a block laid against a ground, kept per tileset. */
export function tableFor(ts: Tileset, era: number, block: CopyBlockInfo, ground: CopyGround): CopyTable {
  let byKey = tables.get(ts);
  if (!byKey) tables.set(ts, (byKey = new Map()));
  const k = `${block.key}|${ground.id}`;
  let t = byKey.get(k);
  if (!t) byKey.set(k, (t = copyTable(ts, era, block, ground)));
  return t;
}

/** A block's paint-and-count on a ground, from the scan's or worked out now (and kept for the session). */
function countOn(ts: Tileset, era: number, block: CopyBlockInfo, ground: CopyGround): number {
  const known = block.grounds.find((g) => g.id === ground.id)?.count;
  if (known !== undefined) return known;
  let byKey = counts.get(ts);
  if (!byKey) counts.set(ts, (byKey = new Map()));
  const k = `${block.key}|${ground.id}`;
  let c = byKey.get(k);
  if (c === undefined) byKey.set(k, (c = paintCount(tableFor(ts, era, block, ground))));
  return c;
}

/**
 * The block and ground a stroke lays a copied terrain with, on the ground under it (`groundUnder`): of the terrain's
 * blocks (complete ones, else the others), the one whose paint-and-count on that ground is lowest; laid against that
 * ground when its count there is within `COUNT_MARGIN` of the block's own outer ground's, else against its own.
 */
export function chooseBlock(ts: Tileset, era: number, terrain: CopyTerrainInfo, groundId: string | null): { block: CopyBlockInfo; ground: CopyGround } | null {
  const pool = terrain.blocks.some((b) => b.status === "complete") ? terrain.blocks.filter((b) => b.status === "complete") : terrain.blocks;
  if (pool.length === 0) return null;
  const under = groundId ? groundsOf(ts, era).get(groundId) ?? null : null;
  let best = pool[0], bestCount = Infinity;
  if (under) for (const b of pool) { const c = countOn(ts, era, b, under); if (c < bestCount) { best = b; bestCount = c; } }
  const own = best.outer!;
  const ground = under && bestCount <= (own.count ?? Infinity) + COUNT_MARGIN ? under : own;
  return { block: best, ground };
}

/** The table a patch of the member was laid with, or null when its block or ground is not known here (left as it is). */
export function patchTable(store: Store, era: number, ts: Tileset, p: CopyPatch): CopyTable | null {
  const host = store.get(copyHostsAtom).get(copyHostKey(era, ts));
  const terrain = host?.terrains.find((t) => t.source === p.source && t.height === p.height);
  const block = terrain?.blocks.find((b) => b.key === p.key);
  const ground = groundsOf(ts, era).get(p.ground);
  return block && ground ? tableFor(ts, era, block, ground) : null;
}

/** The known copied terrains of the tileset in front, if it has been scanned. */
export function copyTerrainsFor(store: Store, era: number, ts: Tileset): CopyTerrainInfo[] {
  return store.get(copyHostsAtom).get(copyHostKey(era, ts))?.terrains ?? [];
}

/* ── Running by itself ──────────────────────────────────── */

/**
 * Scan the tileset of the map in front whenever it changes, once it is loaded: `tileset()` answers it (or null while it
 * loads; asked again a little later). Returns the unsubscribe.
 */
export function watchTerrainCopies(store: Store, tileset: () => { ts: Tileset; era: number } | null, subscribe: (run: () => void) => () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tries = 0;
  const run = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const now = tileset();
    if (!now) { if (tries++ < 60) timer = setTimeout(run, 500); return; }
    tries = 0;
    if (copiesKnown(store, now.era, now.ts)) return;
    void scanCopies(store, now.era, now.ts).catch(() => undefined);
  };
  const off = subscribe(() => { tries = 0; run(); });
  run();
  return () => { off(); if (timer) clearTimeout(timer); };
}

/** `watchTerrainCopies` on the map in front (App): its tileset, scanned when it comes in front; provided blocks republished as they change. */
export function watchCopiesInFront(store: Store): () => void {
  const front = () => {
    const scn = store.get(scenarioAtom), l = peekTileset(store.get(tilesetFileNameAtom));
    return scn && l ? { ts: l.tileset, era: tilesetIndex(scn) } : null;
  };
  const offProvided = store.sub(providedRows, () => { const f = front(); if (f) republish(store, f.era, f.ts); });
  const stop = watchTerrainCopies(store, front, (run) => {
    const a = store.sub(tilesetFileNameAtom, run), b = store.sub(scenarioAtom, run), c = store.sub(gameDataRevisionAtom, run);
    return () => { a(); b(); c(); };
  });
  return () => { stop(); offProvided(); };
}
