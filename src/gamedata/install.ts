/**
 * Main-thread side of installing game data into the browser: hand the archives to the
 * extraction worker, relay its progress, keep the files in memory when it could not
 * store them. Two ways in, and they are the two the Game Data dialog offers: Blizzard's own
 * StarEdit package, read member by member out of the zip (`installFromZipUrl`), or the two
 * archives the user picked off their own disk (`installFromFiles`).
 *
 * A third is a *data set* of its own (`profiles.ts`): the same extraction over the game's
 * archives plus whatever a mod adds — more archives, or loose files by member path laid
 * over them (`installDataSet`) — stored under the set's id rather than as the game's own.
 */
import { isGameArchive, memberKey, sortArchives } from "./archives";
import type { ExtractRequest, ExtractResponse } from "./extract.worker";
import { DEFAULT_PROFILE, isDefaultProfile, normalizeProfile, type GameDataProfile } from "./profiles";
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

/** Extract from the archives and store the result as the game's own data. Resolves with the copy's stamp. */
export async function installFromFiles(files: readonly File[], progress?: InstallProgress): Promise<StoredCopy> {
  const archives = pickArchives(files);
  progress?.(0, "Reading the archives");
  const inputs: ExtractRequest["archives"] = [];
  for (const file of archives) inputs.push({ name: file.name, bytes: await file.arrayBuffer() });
  return runWorker(inputs, archives.map((f) => f.name).join(" + "), progress);
}

/* ── Data sets ──────────────────────────────────────────── */

/** Bytes for the worker: a `File` / `Blob`, or already an array. */
export type InstallBytes = Blob | Uint8Array;

/** What a data set is made of. */
export interface GameDataFiles {
  /**
   * The archives, `StarDat.mpq` and `BrooDat.mpq` among them (a mod replaces files, it
   * does not bring the rest); the game's own are read first and any other after them in
   * the order given, later ones winning as in the game.
   */
  archives: readonly { name: string; data: InstallBytes }[];
  /** Loose files by member path (`arr/units.dat`, `unit/terran/marine.grp`), read before any archive. */
  files?: readonly { path: string; data: InstallBytes }[];
}

/** The member prefixes an extraction ever asks for: anything else in a picked folder is not sent to the worker. */
const MEMBER_PREFIXES = ["arr\\", "tileset\\", "unit\\", "game\\", "scripts\\", "rez\\"];

/** Whether a loose file could be a game data member: its path starts with one of the folders the extraction reads. */
export function isMemberPath(path: string): boolean {
  const key = memberKey(path);
  return MEMBER_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * A folder pick as `GameDataFiles`: every `.mpq` is an archive, and every other file whose
 * path (relative to the picked folder) starts with a game data folder is a loose member.
 * The picked folder's own name is the first segment of `webkitRelativePath` and is dropped,
 * so a mod's `mpq/arr/units.dat` is the member `arr\units.dat`.
 */
export function splitPickedFiles(files: readonly File[]): GameDataFiles {
  const archives: { name: string; data: InstallBytes }[] = [];
  const loose: { path: string; data: InstallBytes }[] = [];
  for (const file of files) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const segments = rel.split(/[\\/]/).filter(Boolean);
    if (/\.mpq$/i.test(file.name)) {
      archives.push({ name: file.name, data: file });
      continue;
    }
    // Drop the picked folder's name, then look for a member path; a mod folder named
    // `mpq` or a StarCraft folder both put the game folders one level down.
    for (let skip = 0; skip < Math.min(3, segments.length - 1); skip++) {
      const path = segments.slice(skip).join("/");
      if (isMemberPath(path)) {
        loose.push({ path, data: file });
        break;
      }
    }
  }
  return { archives, files: loose };
}

/** The archives in the game's order: `StarDat`, `BrooDat`, then the rest as given. */
function orderArchives<T extends { name: string }>(archives: readonly T[]): T[] {
  const known = sortArchives(archives.filter((a) => isGameArchive(a.name)));
  const rest = archives.filter((a) => !isGameArchive(a.name));
  return [...known, ...rest];
}

const bytesOf = async (data: InstallBytes): Promise<ArrayBuffer> =>
  data instanceof Uint8Array ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer) : await data.arrayBuffer();

/**
 * Extract a data set and store it under its id. The game's own archives must be among
 * `input.archives` (the same rule as `pickArchives`); a mod's archives and loose files are
 * laid over them. Installing under the default id is `installFromFiles` with extras.
 */
export async function installDataSet(profile: GameDataProfile, input: GameDataFiles, progress?: InstallProgress): Promise<StoredCopy> {
  const normalized = normalizeProfile(profile);
  if (!normalized) throw new InstallError(`"${profile.id}" is not a usable data set id: lower-case letters, digits and hyphens, up to 40 characters.`);
  const names = input.archives.map((a) => ({ name: a.name }));
  pickArchives(names.map((n) => new File([], n.name))); // throws naming what is missing
  progress?.(0, "Reading the archives");
  const archives: ExtractRequest["archives"] = [];
  for (const a of orderArchives(input.archives)) archives.push({ name: a.name, bytes: await bytesOf(a.data) });
  const overlay: NonNullable<ExtractRequest["overlay"]> = [];
  for (const f of input.files ?? []) {
    if (!isMemberPath(f.path)) continue;
    overlay.push({ path: f.path, bytes: await bytesOf(f.data) });
  }
  const from = [...archives.map((a) => a.name), ...(overlay.length ? [`${overlay.length} loose file${overlay.length === 1 ? "" : "s"}`] : [])].join(" + ");
  return runWorker(archives, from, progress, isDefaultProfile(normalized.id) ? undefined : normalized, overlay);
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

function runWorker(
  archives: ExtractRequest["archives"],
  from: string,
  progress?: InstallProgress,
  profile?: GameDataProfile,
  overlay: NonNullable<ExtractRequest["overlay"]> = [],
): Promise<StoredCopy> {
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
        keepInMemory(new Map((msg.files ?? []).map(([path, buf]) => [path, new Uint8Array(buf)])), msg.stamp, profile?.id ?? DEFAULT_PROFILE.id);
      }
      resolve({ ...msg.stamp, where: msg.where });
    };
    const req: ExtractRequest = { kind: "extract", archives, from, profile, overlay };
    worker.postMessage(req, [...archives.map((a) => a.bytes), ...overlay.map((o) => o.bytes)]);
  });
}
