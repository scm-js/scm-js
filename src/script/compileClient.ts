/**
 * Main-thread side of the compile worker. Requests are numbered; a result for anything
 * but the newest request is dropped, so a burst of keystrokes settles on the last one.
 * If the worker cannot start (an old browser, a broken bundle) the compiler runs on the
 * main thread instead — slower, never silent.
 */
import type { CompileRequest, CompileResponse } from "./compile.worker";
import type { CompileOptions, CompileResult } from "./compiler";

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, { resolve: (r: CompileResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./compile.worker.ts", import.meta.url), { type: "module" });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<CompileResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.result) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error ?? "Compile failed."));
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
