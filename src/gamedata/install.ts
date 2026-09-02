/**
 * Main-thread side of installing game data into the browser: hand the archives to the
 * extraction worker, relay its progress, keep the files in memory when it could not
 * store them. Two ways in — files the user picked, or a URL that serves the archives.
 */
import { isGameArchive, sortArchives } from "./archives";
import type { ExtractRequest, ExtractResponse } from "./extract.worker";
import { keepInMemory, type StoredCopy } from "./store";

export type InstallProgress = (fraction: number, label: string) => void;

export const ARCHIVE_NAMES = ["StarDat.mpq", "BrooDat.mpq"] as const;

export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallError";
  }
}

/** The game's archives among a pick or a dropped folder, or an `InstallError` naming what is missing. */
export function pickArchives(files: readonly File[]): File[] {
  const archives = sortArchives(files.filter((f) => isGameArchive(f.name)));
  const names = archives.map((f) => f.name.toLowerCase());
  const missing = ARCHIVE_NAMES.filter((n) => !names.includes(n.toLowerCase()));
  if (missing.length > 0) {
    throw new InstallError(
      archives.length === 0
        ? `No StarCraft archives among the files picked. The editor needs ${ARCHIVE_NAMES.join(" and ")}.`
        : `${missing.join(" and ")} missing — the editor needs both archives.`,
    );
  }
  return archives;
}

/** Extract from the archives and store the result. Resolves with the copy's stamp. */
export async function installFromFiles(files: readonly File[], progress?: InstallProgress): Promise<StoredCopy> {
  const archives = pickArchives(files);
  progress?.(0, "Reading the archives");
  const inputs: ExtractRequest["archives"] = [];
  for (const file of archives) inputs.push({ name: file.name, bytes: await file.arrayBuffer() });
  return runWorker(inputs, archives.map((f) => f.name).join(" + "), progress);
}

/** Download `StarDat.mpq` and `BrooDat.mpq` from under `base` (a URL ending in `/`), then the same. */
export async function installFromUrl(base: string, progress?: InstallProgress): Promise<StoredCopy> {
  const inputs: ExtractRequest["archives"] = [];
  let i = 0;
  for (const name of ARCHIVE_NAMES) {
    const url = base + name;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new InstallError(`${url} could not be fetched (${err instanceof Error ? err.message : String(err)}). The server has to allow cross-origin requests.`);
    }
    if (!res.ok) throw new InstallError(`${url}: HTTP ${res.status}`);
    const share = 1 / ARCHIVE_NAMES.length;
    const bytes = await readWithProgress(res, (f) => progress?.((i + f) * share * 0.5, `Downloading ${name}`));
    inputs.push({ name, bytes });
    i++;
  }
  return runWorker(inputs, base, (f, label) => progress?.(0.5 + f * 0.5, label));
}

async function readWithProgress(res: Response, report: (fraction: number) => void): Promise<ArrayBuffer> {
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body || total <= 0) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    report(Math.min(1, size / total));
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out.buffer;
}

function runWorker(archives: ExtractRequest["archives"], from: string, progress?: InstallProgress): Promise<StoredCopy> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./extract.worker.ts", import.meta.url), { type: "module" });
    } catch (err) {
      reject(new InstallError(`The extraction worker could not start: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }
    worker.onerror = (e) => {
      worker.terminate();
      reject(new InstallError(e.message || "The extraction failed."));
    };
    worker.onmessage = (e: MessageEvent<ExtractResponse>) => {
      const msg = e.data;
      if (msg.kind === "progress") {
        progress?.(msg.fraction, msg.label);
        return;
      }
      worker.terminate();
      if (msg.kind === "error") {
        reject(new InstallError(msg.message));
        return;
      }
      for (const p of msg.problems) console.warn("game data:", p);
      if (msg.where === "memory") {
        keepInMemory(new Map((msg.files ?? []).map(([path, buf]) => [path, new Uint8Array(buf)])), msg.stamp);
      }
      resolve({ ...msg.stamp, where: msg.where });
    };
    const req: ExtractRequest = { kind: "extract", archives, from };
    worker.postMessage(req, archives.map((a) => a.bytes));
  });
}
