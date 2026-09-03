/**
 * Main-thread side of the transpile worker: TypeScript → JavaScript for a plugin file,
 * off the main thread. Every request is answered (a plugin bundle needs all of its
 * files), and if the worker cannot start — an old browser, a broken bundle — the
 * transpile runs on the main thread instead: slower, never silent.
 */
import type { TranspileRequest, TranspileResponse } from "./transpile.worker";
import { transpileTs } from "./transpile";

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, { resolve: (code: string) => void; reject: (e: Error) => void }>();

/**
 * The worker is a whole TypeScript instance (tens of MB of heap) and it is only busy while
 * a plugin bundle is being transpiled — at startup, on Add and on Reload. It goes away
 * this long after its last answer and is started again on the next request.
 */
export const WORKER_IDLE_MS = 30_000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function busy() {
  if (idleTimer === null) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

/** Called after every answer: nothing left to do — arm the idle shutdown. */
function settle() {
  if (!worker || pending.size > 0) return;
  busy();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!worker || pending.size > 0) return;
    worker.terminate();
    worker = null;
  }, WORKER_IDLE_MS);
}

/** Whether a transpile worker exists right now (tests). */
export function transpileWorkerAlive(): boolean {
  return worker !== null;
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  busy();
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./transpile.worker.ts", import.meta.url), { type: "module" });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<TranspileResponse>) => {
    const t = pending.get(e.data.id);
    if (!t) return;
    pending.delete(e.data.id);
    if (e.data.code !== undefined) t.resolve(e.data.code);
    else t.reject(new Error(e.data.error ?? "Transpile failed."));
    settle();
  };
  worker.onerror = () => {
    // The worker script itself failed: fall back for every outstanding request and from now on.
    workerBroken = true;
    worker?.terminate();
    worker = null;
    for (const [id, t] of pending) {
      pending.delete(id);
      t.reject(new Error("worker unavailable"));
    }
  };
  return worker;
}

async function transpileHere(source: string, fileName: string): Promise<string> {
  const { default: ts } = await import("typescript");
  return transpileTs(ts, source, fileName);
}

/** TypeScript → JavaScript for a plugin file, in the worker when there is one. */
export function transpileInBackground(source: string, fileName: string): Promise<string> {
  const w = getWorker();
  if (!w) return transpileHere(source, fileName);
  const id = ++seq;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: TranspileRequest = { id, source, fileName };
    w.postMessage(req);
  }).catch((err: Error) => {
    if (err.message === "worker unavailable") return transpileHere(source, fileName);
    throw err;
  });
}
