/**
 * Main-thread side of installing game data into the browser: hand the archives to the
 * extraction worker, relay its progress, keep the files in memory when it could not
 * store them. Two ways in, and they are the two the Game Data dialog offers: Blizzard's own
 * StarEdit package, read member by member out of the zip (`installFromZipUrl`), or the two
 * archives the user picked off their own disk (`installFromFiles`).
 */
import { isGameArchive, sortArchives } from "./archives";
import type { ExtractRequest, ExtractResponse } from "./extract.worker";
import { keepInMemory, type StoredCopy } from "./store";
import { findMembers, httpRangeReader, readZipDirectory, readZipMember, ZipError } from "./zip";

export type InstallProgress = (fraction: number, label: string) => void;

export const ARCHIVE_NAMES = ["StarDat.mpq", "BrooDat.mpq"] as const;

/**
 * Blizzard's own standalone StarEdit package, which carries both archives and is offered
 * free. It is fetched through a forwarder (`github.com/scm-js/cloudflare-blizzard-forwarder`)
 * for the one reason a browser cannot go to Blizzard directly: `download.blizzard.com`
 * answers with a certificate for `*.cloudfront.net`, plain HTTP is mixed content on an
 * HTTPS page, and no route there sends `Access-Control-Allow-Origin`. The desktop build
 * uses the same address: its renderer is an ordinary page under `app://scmjs/` and enforces
 * CORS like any other, so going to Blizzard directly there would mean a download in the main
 * process and an IPC channel to carry it — for a route the disk search already covers.
 *
 * The archives inside are the trimmed StarEdit distribution, not the game's own, which
 * matters only in that they are enough: they extract to the same files a 1.16 install does,
 * byte for byte. The `patch_rt.mpq` that also rides in the zip is deliberately left alone —
 * folding it in would change seven tables and diverge from every other install route.
 */
export const BLIZZARD_ZIP_URL = "https://gamedata.scmjs.dev/StarEdit.zip";

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

/**
 * Install from a zip that carries the two archives, without downloading the rest of it:
 * the zip's directory says where each member's bytes are, so only those are fetched and
 * inflated (82 MB of Blizzard's 101 MB package). The server has to answer range requests,
 * which is the forwarder's whole job.
 */
export async function installFromZipUrl(url: string, progress?: InstallProgress): Promise<StoredCopy> {
  progress?.(0, "Reading the download");
  const entries = await readZipDirectory(httpRangeReader(url)).catch((err) => {
    throw new InstallError(err instanceof ZipError ? err.message : `${url} could not be read (${err instanceof Error ? err.message : String(err)}).`);
  });

  const { found, missing } = findMembers(entries, ARCHIVE_NAMES);
  if (missing.length > 0) throw new InstallError(`${url} does not carry ${missing.join(" or ")}.`);

  // The download is the first half of the bar and the extraction the second, as an install
  // from loose archives has it; within the download, each member is weighted by its size.
  const wanted = ARCHIVE_NAMES.map((name) => ({ name, entry: found.get(name)! }));
  const total = wanted.reduce((n, w) => n + w.entry.compressedSize, 0);
  let doneBytes = 0;

  const inputs: ExtractRequest["archives"] = [];
  for (const { name, entry } of wanted) {
    const reader = httpRangeReader(url, {
      onProgress: (received) => progress?.(((doneBytes + received) / total) * 0.5, `Downloading ${name}`),
    });
    const bytes = await readZipMember(reader, entry).catch((err) => {
      throw new InstallError(err instanceof ZipError ? err.message : `${name} could not be read from ${url} (${err instanceof Error ? err.message : String(err)}).`);
    });
    doneBytes += entry.compressedSize;
    inputs.push({ name, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  }

  return runWorker(inputs, url, (f, label) => progress?.(0.5 + f * 0.5, label));
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
