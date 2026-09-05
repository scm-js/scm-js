/**
 * The copies of the game data the browser keeps: the files an extraction produced, in the
 * Origin Private File System, so an upload survives a reload. The worker writes them
 * (`writeStoredCopy`, sync access handles are worker-only); the main thread reads them
 * (`readStored`) and clears them. A stamp file written last says what a copy is — a
 * directory without one is a write that did not finish and counts as nothing.
 *
 * There is one copy per data set (`profiles.ts`): the game's own under `gamedata/`, where
 * it has always been, and every other under `gamedata-profiles/<id>/`, which is what lets
 * removing one leave the rest alone. Every function takes the profile id and means the
 * default without one.
 *
 * Where there is no OPFS (a browser that blocks site data, tests) the files stay in
 * memory for the session (`keepInMemory`); `storedCopy()` reports which.
 */
import { DEFAULT_PROFILE, isDefaultProfile, isProfileId, type GameDataProfile } from "./profiles";

const DIR = "gamedata";
const PROFILES_DIR = "gamedata-profiles";
const STAMP = "stamp.json";

/** Where a data set's copy lives, as path segments under the OPFS root. */
export function profileDir(profileId: string): string[] {
  return isDefaultProfile(profileId) ? [DIR] : [PROFILES_DIR, profileId];
}

export interface StoredStamp {
  /** Where the files came from: archive names, or the URL. */
  from: string;
  /** ISO time of the extraction. */
  at: string;
  files: number;
  bytes: number;
  /** What produced the copy, for the dialog. */
  summary: string;
  /** The data set this is a copy of; absent on a copy an older editor wrote, which is the game's own. */
  profile?: GameDataProfile;
}

export interface StoredCopy extends StoredStamp {
  where: "opfs" | "memory";
}

/** A copy's data set: the stamp's, or the default for one written before there were any. */
export const profileOf = (stamp: StoredStamp): GameDataProfile => stamp.profile ?? DEFAULT_PROFILE;

interface MemoryCopy {
  files: Map<string, Uint8Array>;
  stamp: StoredStamp;
}

const memory = new Map<string, MemoryCopy>();

/** The OPFS root, or null where the API is missing or refused. */
async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const storage = (globalThis as { navigator?: { storage?: StorageManager } }).navigator?.storage;
    if (!storage?.getDirectory) return null;
    return await storage.getDirectory();
  } catch {
    return null;
  }
}

const dirCache = new Map<string, Promise<FileSystemDirectoryHandle | null>>();

/** `gamedata/<a>/<b>` as a handle, cached; null when any segment is missing. */
function directory(root: FileSystemDirectoryHandle, segments: string[]): Promise<FileSystemDirectoryHandle | null> {
  const key = segments.join("/");
  let p = dirCache.get(key);
  if (!p) {
    p = (async () => {
      let dir = root;
      for (const seg of segments) {
        try {
          dir = await dir.getDirectoryHandle(seg);
        } catch {
          return null;
        }
      }
      return dir;
    })();
    dirCache.set(key, p);
  }
  return p;
}

async function readStamp(dir: FileSystemDirectoryHandle): Promise<StoredStamp | null> {
  try {
    const file = await (await dir.getFileHandle(STAMP)).getFile();
    return JSON.parse(await file.text()) as StoredStamp;
  } catch {
    return null;
  }
}

/** A data set's stored copy's stamp, or null when there is none. */
export async function storedCopy(profileId = DEFAULT_PROFILE.id): Promise<StoredCopy | null> {
  const held = memory.get(profileId);
  if (held) return { ...held.stamp, where: "memory" };
  const root = await opfsRoot();
  if (!root) return null;
  const dir = await directory(root, profileDir(profileId));
  if (!dir) return null;
  const stamp = await readStamp(dir);
  return stamp ? { ...stamp, where: "opfs" } : null;
}

/**
 * Every data set with a copy here, the game's own included when it has one — the stamps,
 * memory copies first. A folder under `gamedata-profiles/` with no stamp is an unfinished
 * write and is not listed.
 */
export async function listStoredCopies(): Promise<StoredCopy[]> {
  const out: StoredCopy[] = [];
  const seen = new Set<string>();
  for (const [id, held] of memory) {
    out.push({ ...held.stamp, where: "memory" });
    seen.add(id);
  }
  const root = await opfsRoot();
  if (!root) return out;
  if (!seen.has(DEFAULT_PROFILE.id)) {
    const copy = await storedCopy();
    if (copy) out.push(copy);
  }
  const profiles = await directory(root, [PROFILES_DIR]);
  if (!profiles) return out;
  const entries = (profiles as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries?.();
  if (!entries) return out;
  for await (const [name, handle] of entries) {
    if (handle.kind !== "directory" || !isProfileId(name) || seen.has(name)) continue;
    const stamp = await readStamp(handle as FileSystemDirectoryHandle);
    if (stamp) out.push({ ...stamp, where: "opfs" });
  }
  return out;
}

/** One file of a data set's copy as a `Blob`, or null when it is not there. */
export async function readStored(path: string, profileId = DEFAULT_PROFILE.id): Promise<Blob | null> {
  const held = memory.get(profileId);
  if (held) {
    const data = held.files.get(path);
    return data ? new Blob([data as unknown as BlobPart]) : null;
  }
  const root = await opfsRoot();
  if (!root) return null;
  const segments = path.split("/");
  const name = segments.pop()!;
  const dir = await directory(root, [...profileDir(profileId), ...segments]);
  if (!dir) return null;
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

/** Forget a data set's copy, wherever it is. The other sets' copies are untouched. */
export async function clearStoredCopy(profileId = DEFAULT_PROFILE.id): Promise<void> {
  memory.delete(profileId);
  dirCache.clear();
  const root = await opfsRoot();
  if (!root) return;
  const segments = profileDir(profileId);
  const parent = segments.length > 1 ? await directory(root, segments.slice(0, -1)) : root;
  if (!parent) return;
  try {
    await parent.removeEntry(segments[segments.length - 1], { recursive: true });
  } catch {
    // Already gone.
  }
}

/** The session fallback: hold a data set's files here when the worker could not write them. */
export function keepInMemory(files: Map<string, Uint8Array>, stamp: StoredStamp, profileId = DEFAULT_PROFILE.id): void {
  memory.set(profileId, { files, stamp });
  dirCache.clear();
}

/* ── Writing (worker only) ──────────────────────────────── */

/** Sync access handles are the one OPFS write path every browser has, and they exist only in workers. */
interface SyncHandle {
  write(data: Uint8Array, options?: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

/**
 * Replace a data set's copy with `files`, stamp last. Throws when OPFS is unavailable
 * here, in which case the caller falls back to `keepInMemory` on the main thread.
 */
export async function writeStoredCopy(
  files: Map<string, Uint8Array>,
  stamp: StoredStamp,
  progress?: (fraction: number) => void,
  profileId = DEFAULT_PROFILE.id,
): Promise<void> {
  const root = await opfsRoot();
  if (!root) throw new Error("This browser has no private file storage.");
  const segments = profileDir(profileId);
  let parent = root;
  for (const seg of segments.slice(0, -1)) parent = await parent.getDirectoryHandle(seg, { create: true });
  const leaf = segments[segments.length - 1];
  try {
    await parent.removeEntry(leaf, { recursive: true });
  } catch {
    // Nothing to replace.
  }
  const base = await parent.getDirectoryHandle(leaf, { create: true });
  const dirs = new Map<string, FileSystemDirectoryHandle>([["", base]]);
  const dirFor = async (segments: string[]): Promise<FileSystemDirectoryHandle> => {
    const key = segments.join("/");
    let dir = dirs.get(key);
    if (!dir) {
      const parent = await dirFor(segments.slice(0, -1));
      dir = await parent.getDirectoryHandle(segments[segments.length - 1], { create: true });
      dirs.set(key, dir);
    }
    return dir;
  };
  const write = async (path: string, data: Uint8Array) => {
    const segments = path.split("/");
    const name = segments.pop()!;
    const handle = await (await dirFor(segments)).getFileHandle(name, { create: true });
    const sync = await (handle as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();
    try {
      sync.truncate(0);
      sync.write(data, { at: 0 });
      sync.flush();
    } finally {
      sync.close();
    }
  };
  let i = 0;
  for (const [path, data] of files) {
    await write(path, data);
    if (++i % 50 === 0) progress?.(i / files.size);
  }
  await write(STAMP, new TextEncoder().encode(JSON.stringify(stamp)));
  progress?.(1);
}
