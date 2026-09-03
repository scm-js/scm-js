/**
 * Main-thread side of the compile worker. Requests are numbered; a result for anything
 * but the newest request is dropped, so a burst of keystrokes settles on the last one.
 * If the worker cannot start (an old browser, a broken bundle) the compiler runs on the
 * main thread instead — slower, never silent.
 */
import type { CompileRequest, CompileResponse, TranspileRequest, TranspileResponse } from "./compile.worker";
import type { CompileOptions, CompileResult } from "./compiler";
import { transpileTs } from "../plugins/transpile";

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, { resolve: (r: CompileResult) => void; reject: (e: Error) => void }>();
const pendingTranspile = new Map<number, { resolve: (code: string) => void; reject: (e: Error) => void }>();

/**
 * The worker is a whole TypeScript instance (tens of MB of heap) and it is only busy while a
 * plugin bundle is being transpiled or the Script Editor is checking as you type. It goes
 * away this long after its last answer — unless a `retainCompileWorker` lease is held, which
 * the open Script Editor does — and is started again on the next request.
 */
export const WORKER_IDLE_MS = 30_000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let leases = 0;

function busy() {
  if (idleTimer === null) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

/** Called after every answer: nothing left to do, nobody holding it — arm the idle shutdown. */
function settle() {
  if (!worker || leases > 0 || pending.size > 0 || pendingTranspile.size > 0) return;
  busy();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!worker || leases > 0 || pending.size > 0 || pendingTranspile.size > 0) return;
    worker.terminate();
    worker = null;
  }, WORKER_IDLE_MS);
}

/** Keep the worker alive until the returned function is called (idempotent). */
export function retainCompileWorker(): () => void {
  leases++;
  busy();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    leases--;
    settle();
  };
}

/** Whether a compile worker exists right now (tests and the About dialog). */
export function compileWorkerAlive(): boolean {
  return worker !== null;
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  busy();
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./compile.worker.ts", import.meta.url), { type: "module" });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<CompileResponse | TranspileResponse>) => {
    if ("kind" in e.data && e.data.kind === "transpile") {
      const t = pendingTranspile.get(e.data.id);
      if (!t) return;
      pendingTranspile.delete(e.data.id);
      if (e.data.code !== undefined) t.resolve(e.data.code);
      else t.reject(new Error(e.data.error ?? "Transpile failed."));
      settle();
      return;
    }
    const data = e.data as CompileResponse;
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.result) p.resolve(data.result);
    else p.reject(new Error(data.error ?? "Compile failed."));
    settle();
  };
  worker.onerror = () => {
    // The worker script itself failed: fall back for every outstanding request and from now on.
    workerBroken = true;
    worker?.terminate();
    worker = null;
    for (const [id, p] of pending) {
      pending.delete(id);
      p.reject(new Error("worker unavailable"));
    }
    for (const [id, t] of pendingTranspile) {
      pendingTranspile.delete(id);
      t.reject(new Error("worker unavailable"));
    }
  };
  return worker;
}

async function compileHere(source: string, declarations: string, options?: CompileOptions): Promise<CompileResult> {
  const [{ default: ts }, { compileScript }] = await Promise.all([import("typescript"), import("./compiler")]);
  return compileScript(ts, source, declarations, options);
}

export class CompileSuperseded extends Error {
  constructor() {
    super("A newer compile replaced this one.");
    this.name = "CompileSuperseded";
  }
}

/** Compile in the background. Rejects with `CompileSuperseded` when a newer request arrived first. */
export function compileInBackground(source: string, declarations: string, options?: CompileOptions): Promise<CompileResult> {
  const w = getWorker();
  if (!w) return compileHere(source, declarations, options);
  const id = ++seq;
  // Anything still in flight is stale now.
  for (const [old, p] of pending) {
    pending.delete(old);
    p.reject(new CompileSuperseded());
  }
  return new Promise<CompileResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: CompileRequest = { id, source, declarations, options };
    w.postMessage(req);
  }).catch((err: Error) => {
    if (err.message === "worker unavailable") return compileHere(source, declarations, options);
    throw err;
  });
}

async function transpileHere(source: string, fileName: string): Promise<string> {
  const { default: ts } = await import("typescript");
  return transpileTs(ts, source, fileName);
}

/**
 * TypeScript → JavaScript for a plugin file, in the worker (no supersede rule — every
 * request is answered, since a plugin bundle needs all of its files).
 */
export function transpileInBackground(source: string, fileName: string): Promise<string> {
  const w = getWorker();
  if (!w) return transpileHere(source, fileName);
  const id = ++seq;
  return new Promise<string>((resolve, reject) => {
    pendingTranspile.set(id, { resolve, reject });
    const req: TranspileRequest = { kind: "transpile", id, source, fileName };
    w.postMessage(req);
  }).catch((err: Error) => {
    if (err.message === "worker unavailable") return transpileHere(source, fileName);
    throw err;
  });
}
