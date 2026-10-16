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
import { SHARED_NIGHTLY } from "../site";
import type { PlayStamp } from "./play";
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
  /**
   * The copy also holds the files the game itself runs on (`play.ts`), which the site's play
   * page reads. Absent on a copy made by an editor before there were any, or from a source
   * whose game files were not all there.
   */
  play?: PlayStamp;
  /**
   * Made from Blizzard's free StarEdit download (`archives.ts#isStarEditDownload`): the play
   * page shows replays from it and starts no game.
   */
  staredit?: true;
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

/**
 * The OPFS root, or null where the API is missing or refused. The hosted nightly, sharing
 * its origin with the stable editor, keeps its copies here too (`site.ts`): the game's page
 * at `/play/` reads them from the root, so one install serves both editors and the game.
 */
async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const storage = (globalThis as { navigator?: { storage?: StorageManager } }).navigator?.storage;
    if (!storage?.getDirectory) return null;
    const root = await storage.getDirectory();
    if (SHARED_NIGHTLY) await (leftover ??= leaveNightlyFolder(root));
    return root;
  } catch {
    return null;
  }
}

let leftover: Promise<void> | null = null;

/**
 * For its first day on the shared origin the nightly kept its copies under `nightly/`, where
 * the game's page never looked. A copy left there is copied up to the root where the root has
 * none of that data set (its stamp last, so a copy cut short counts as nothing), and the folder
 * goes. Where that fails the data is installed again.
 */
async function leaveNightlyFolder(root: FileSystemDirectoryHandle): Promise<void> {
  const old = await root.getDirectoryHandle("nightly").catch(() => null);
  if (!old) return;
  const copyUp = async (from: FileSystemDirectoryHandle, name: string, to: FileSystemDirectoryHandle) => {
    const dir = await from.getDirectoryHandle(name).catch(() => null);
    if (!dir || !(await readStamp(dir))) return;
    const there = await to.getDirectoryHandle(name).catch(() => null);
    if (there && (await readStamp(there))) return;
    if (there) await to.removeEntry(name, { recursive: true });
    try {
      await copyInto(dir, await to.getDirectoryHandle(name, { create: true }), true);
    } catch {
      await to.removeEntry(name, { recursive: true }).catch(() => {});
    }
  };
  try {
    await copyUp(old, DIR, root);
    const profiles = await old.getDirectoryHandle(PROFILES_DIR).catch(() => null);
    if (profiles) {
      const ids = (await entriesOf(profiles)).filter(([, h]) => h.kind === "directory").map(([id]) => id);
      const to = await root.getDirectoryHandle(PROFILES_DIR, { create: true });
      for (const id of ids) await copyUp(profiles, id, to);
    }
  } catch {
    // Storage refused: the nightly installs again.
  } finally {
    await root.removeEntry("nightly", { recursive: true }).catch(() => {});
  }
}

async function entriesOf(dir: FileSystemDirectoryHandle): Promise<[string, FileSystemHandle][]> {
  const out: [string, FileSystemHandle][] = [];
  const it = (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
  for await (const entry of it) out.push(entry);
  return out;
}

/** Every file of `from` into `to`; with `stampLast`, the copy's stamp after all the rest. */
async function copyInto(from: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle, stampLast = false): Promise<void> {
  const entries = await entriesOf(from);
  const order = stampLast ? [...entries.filter(([n]) => n !== STAMP), ...entries.filter(([n]) => n === STAMP)] : entries;
  for (const [name, handle] of order) {
    if (handle.kind === "directory") {
      await copyInto(handle as FileSystemDirectoryHandle, await to.getDirectoryHandle(name, { create: true }));
    } else {
      const file = await (handle as FileSystemFileHandle).getFile();
      const writable = await (await to.getFileHandle(name, { create: true })).createWritable();
      await file.stream().pipeTo(writable);
    }
  }
}

const dirCache = new Map<string, Promise<FileSystemDirectoryHandle | null>>();

/**
 * Forget which folders were found and which were not. The worker writes a copy behind this
 * thread's back, and a folder looked for before the write (`gamedata-profiles/`, by the
 * dialog listing the data sets) is remembered as missing until this is called — which left
 * a data set just installed out of that list until the page was reloaded.
 */
export function forgetStoredFolders(): void {
  dirCache.clear();
}

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
 *
 * `more` writes further files after those and before the stamp, one at a time through the
 * writer it is handed — for what is too large to hold in a map first (`play.ts`) — and
 * answers what the stamp gains by them. The stamp as written is returned.
 */
export async function writeStoredCopy(
  files: Map<string, Uint8Array>,
  stamp: StoredStamp,
  progress?: (fraction: number) => void,
  profileId = DEFAULT_PROFILE.id,
  more?: (write: (path: string, data: Uint8Array) => Promise<void>) => Promise<Partial<StoredStamp>>,
): Promise<StoredStamp> {
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
  const written = more ? { ...stamp, ...(await more(write)) } : stamp;
  await write(STAMP, new TextEncoder().encode(JSON.stringify(written)));
  progress?.(1);
  return written;
}
