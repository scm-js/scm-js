/**
 * Page side of the borrowed-terrain scan's worker (`borrowTable.worker.ts`): the table from a
 * source tileset into the host, worked out off the page's thread. `main.tsx` hands it to the scan
 * (`borrow.ts#setBorrowTableMaker`), so the command line, `@scm-js/core` and the headless plugin
 * host never reach the worker and keep the sliced path on their own thread.
 *
 * Each worker is given the host once and then sources one at a time; `POOL` workers take the
 * sources in turn. A worker that cannot start or fails rejects with `WorkerUnavailableError`,
 * which the scan answers by working that table out on the page as before. Stopping (the signal)
 * terminates the workers; when nothing is queued they are terminated too, since each holds a copy
 * of the host tileset and its picture summary.
 */
import type { Tileset } from "../formats/tileset/decode";
import { decodeBorrowTable, tilesetHash, type BorrowTable } from "../editor/modTerrain/borrowTable";
import { tilesetParts, type BorrowWorkerRequest, type BorrowWorkerResponse, type TilesetParts } from "../editor/modTerrain/borrowWorker";
import type { BorrowTableMaker } from "./borrow";
import { decodeCopyBlocks, type CopyBlock, type CopySource } from "../editor/modTerrain/terrainCopyTable";

/** The worker could not start, or failed: the caller works the table out itself. */
export class WorkerUnavailableError extends Error {
  constructor(message = "the scan's worker is unavailable") {
    super(message);
    this.name = "WorkerUnavailableError";
  }
}

/** Workers at most: measured, see `.claude/internals/terrain.md` "The scan in a worker". */
export const POOL = 2;

/** How many workers this machine gets: `POOL`, bounded by its cores less one, at least one. */
export function poolSize(cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency ?? 2 : 2): number {
  return Math.max(1, Math.min(POOL, cores - 1));
}

interface Job {
  host: Tileset;
  source: Tileset;
  progress(share: number): void;
  resolve(table: BorrowTable): void;
  reject(err: Error): void;
  signal?: AbortSignal;
}

interface Slot {
  worker: Worker;
  host: string | null;
  job: Job | null;
  id: number;
}

const parts = new WeakMap<Tileset, TilesetParts>();
const partsOf = (ts: Tileset) => { let p = parts.get(ts); if (!p) parts.set(ts, (p = tilesetParts(ts))); return p; };

let broken = false;
let seq = 0;
const slots: Slot[] = [];
const queue: Job[] = [];

/** What the last posts cost, for the measurements (`postMs`: time in `postMessage`, `bytes`: what was cloned). */
export const borrowWorkerStats = { workers: 0, hostPosts: 0, postMs: 0, bytes: 0, tables: [] as { ms: number }[] };

const partsBytes = (p: TilesetParts) => p.palette.byteLength + p.minitiles.byteLength + p.megatileRefs.byteLength + p.megatileFlags.byteLength + p.groups.byteLength;

function post(slot: Slot, message: BorrowWorkerRequest) {
  const started = performance.now();
  slot.worker.postMessage(message);
  borrowWorkerStats.postMs += performance.now() - started;
  borrowWorkerStats.bytes += message.kind === "host" ? partsBytes(message.host) : message.kind === "table" ? partsBytes(message.source) : partsBytes(message.tileset);
}

function startWorker(): Slot | null {
  if (broken || typeof Worker === "undefined") return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./borrowTable.worker.ts", import.meta.url), { type: "module" });
  } catch {
    broken = true;
    return null;
  }
  const slot: Slot = { worker, host: null, job: null, id: 0 };
  worker.onmessage = (e: MessageEvent<BorrowWorkerResponse>) => {
    const job = slot.job;
    if (!job || e.data.id !== slot.id) return;
    if (e.data.kind === "progress") { job.progress(e.data.done / Math.max(1, e.data.total)); return; }
    if (e.data.kind === "copies") return; // (answered to a worker of its own: `workerCopyScan`)
    slot.job = null;
    if (e.data.kind === "table") {
      borrowWorkerStats.tables.push({ ms: e.data.ms });
      const table = decodeBorrowTable(e.data.table);
      if (table) job.resolve(table); else job.reject(new WorkerUnavailableError("the worker's table did not read back"));
    } else job.reject(new WorkerUnavailableError(e.data.message));
    pump();
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    // The worker script itself failed: everything it and the queue hold goes back to the page.
    broken = true;
    stopAll(new WorkerUnavailableError(e.message || "the scan's worker failed"));
  };
  slots.push(slot);
  borrowWorkerStats.workers = Math.max(borrowWorkerStats.workers, slots.length);
  return slot;
}

function stopAll(err: Error) {
  for (const slot of slots.splice(0)) {
    slot.worker.terminate();
    slot.job?.reject(err);
  }
  for (const job of queue.splice(0)) job.reject(err);
}

/** Hand queued jobs to idle workers, starting workers up to the pool's size; terminate them all when nothing is left. */
function pump() {
  while (queue.length > 0) {
    let slot = slots.find((s) => !s.job) ?? null;
    if (!slot && slots.length < poolSize()) slot = startWorker();
    if (!slot) {
      if (slots.length === 0) for (const job of queue.splice(0)) job.reject(new WorkerUnavailableError());
      return;
    }
    const job = queue.shift()!;
    if (job.signal?.aborted) { job.reject(stoppedError()); continue; }
    const hostKey = tilesetHash(job.host);
    if (slot.host !== hostKey) { post(slot, { kind: "host", host: partsOf(job.host) }); slot.host = hostKey; borrowWorkerStats.hostPosts++; }
    slot.job = job;
    slot.id = ++seq;
    post(slot, { kind: "table", id: slot.id, source: partsOf(job.source) });
  }
  if (slots.every((s) => !s.job)) for (const slot of slots.splice(0)) slot.worker.terminate();
}

const stoppedError = () => Object.assign(new Error("stopped"), { name: "AbortError" });

/** The worker client as the scan's table maker. */
export const workerTableMaker: BorrowTableMaker = {
  stats() {
    const s = borrowWorkerStats;
    const out = { workers: s.workers, hostPosts: s.hostPosts, postMs: Math.round(s.postMs * 10) / 10, clonedMB: Math.round(s.bytes / 1e5) / 10, workerMsMax: Math.round(Math.max(0, ...s.tables.map((x) => x.ms))), workerMsSum: Math.round(s.tables.reduce((a, x) => a + x.ms, 0)) };
    Object.assign(s, { workers: slots.length, hostPosts: 0, postMs: 0, bytes: 0, tables: [] });
    return out;
  },
  table(host, source, progress, signal) {
    return new Promise<BorrowTable>((resolve, reject) => {
      if (signal?.aborted) { reject(stoppedError()); return; }
      const job: Job = { host, source, progress, resolve, reject, signal };
      signal?.addEventListener("abort", () => stopAll(stoppedError()), { once: true });
      queue.push(job);
      pump();
    });
  },
};

/** Forget a failed worker and the counts (tests). */
export function resetBorrowWorkerClient(): void {
  stopAll(new WorkerUnavailableError("reset"));
  broken = false;
  Object.assign(borrowWorkerStats, { workers: 0, hostPosts: 0, postMs: 0, bytes: 0, tables: [] });
}

/**
 * The copied-terrain scan (`editor/modTerrain/terrainCopyTable.ts#findCopyBlocks`) of `tileset`, in a worker of its own started for
 * it and ended after it. Rejects with `WorkerUnavailableError` when no worker can run it (the caller works it out on
 * the page), with an `AbortError` when `signal` stops it.
 */
export function workerCopyScan(tileset: Tileset, era: number, copies: CopySource[], signal?: AbortSignal): Promise<CopyBlock[]> {
  return new Promise<CopyBlock[]>((resolve, reject) => {
    if (signal?.aborted) { reject(stoppedError()); return; }
    if (broken || typeof Worker === "undefined") { reject(new WorkerUnavailableError()); return; }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./borrowTable.worker.ts", import.meta.url), { type: "module" });
    } catch {
      broken = true;
      reject(new WorkerUnavailableError());
      return;
    }
    const done = () => { worker.terminate(); signal?.removeEventListener("abort", stop); };
    const stop = () => { done(); reject(stoppedError()); };
    signal?.addEventListener("abort", stop, { once: true });
    worker.onmessage = (e: MessageEvent<BorrowWorkerResponse>) => {
      if (e.data.kind === "copies") { done(); const blocks = decodeCopyBlocks(e.data.blocks); if (blocks) resolve(blocks); else reject(new WorkerUnavailableError("the worker's blocks did not read back")); }
      else if (e.data.kind === "error") { done(); reject(new WorkerUnavailableError(e.data.message)); }
    };
    worker.onerror = (e) => { e.preventDefault?.(); broken = true; done(); reject(new WorkerUnavailableError(e.message || "the scan's worker failed")); };
    const started = performance.now();
    const parts = partsOf(tileset);
    worker.postMessage({ kind: "copies", id: ++seq, tileset: parts, era, copies } satisfies BorrowWorkerRequest);
    borrowWorkerStats.postMs += performance.now() - started;
    borrowWorkerStats.bytes += partsBytes(parts);
  });
}
