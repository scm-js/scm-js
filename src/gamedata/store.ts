/**
 * The copy of the game data the browser keeps: the files an extraction produced, in the
 * Origin Private File System under `gamedata/`, so an upload survives a reload. The worker
 * writes it (`writeStoredCopy`, sync access handles are worker-only); the main thread
 * reads it (`readStored`) and clears it. A stamp file written last says what it is —
 * a directory without one is a write that did not finish and counts as nothing.
 *
 * Where there is no OPFS (a browser that blocks site data, tests) the files stay in
 * memory for the session (`keepInMemory`); `storedCopy()` reports which.
 */

const DIR = "gamedata";
const STAMP = "stamp.json";

export interface StoredStamp {
  /** Where the files came from: archive names, or the URL. */
  from: string;
  /** ISO time of the extraction. */
  at: string;
  files: number;
  bytes: number;
  /** What produced the copy, for the dialog. */
  summary: string;
}

export interface StoredCopy extends StoredStamp {
  where: "opfs" | "memory";
}

let memory: Map<string, Uint8Array> | null = null;
let memoryStamp: StoredStamp | null = null;

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

/** The stored copy's stamp, or null when there is none. */
export async function storedCopy(): Promise<StoredCopy | null> {
  if (memoryStamp) return { ...memoryStamp, where: "memory" };
  const root = await opfsRoot();
  if (!root) return null;
  const dir = await directory(root, [DIR]);
  if (!dir) return null;
  try {
    const file = await (await dir.getFileHandle(STAMP)).getFile();
    const stamp = JSON.parse(await file.text()) as StoredStamp;
    return { ...stamp, where: "opfs" };
  } catch {
    return null;
  }
}

/** One file of the copy as a `File`, or null when it is not there. */
export async function readStored(path: string): Promise<Blob | null> {
  if (memory) {
    const data = memory.get(path);
    return data ? new Blob([data as unknown as BlobPart]) : null;
  }
  const root = await opfsRoot();
  if (!root) return null;
  const segments = path.split("/");
  const name = segments.pop()!;
  const dir = await directory(root, [DIR, ...segments]);
  if (!dir) return null;
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

/** Forget the copy, wherever it is. */
export async function clearStoredCopy(): Promise<void> {
  memory = null;
  memoryStamp = null;
  dirCache.clear();
  const root = await opfsRoot();
  if (!root) return;
  try {
    await root.removeEntry(DIR, { recursive: true });
  } catch {
    // Already gone.
  }
}

/** The session fallback: hold the files here when the worker could not write them. */
export function keepInMemory(files: Map<string, Uint8Array>, stamp: StoredStamp): void {
  memory = files;
  memoryStamp = stamp;
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
 * Replace the copy with `files`, stamp last. Throws when OPFS is unavailable here, in
 * which case the caller falls back to `keepInMemory` on the main thread.
 */
export async function writeStoredCopy(files: Map<string, Uint8Array>, stamp: StoredStamp, progress?: (fraction: number) => void): Promise<void> {
  const root = await opfsRoot();
  if (!root) throw new Error("This browser has no private file storage.");
  try {
    await root.removeEntry(DIR, { recursive: true });
  } catch {
    // Nothing to replace.
  }
  const base = await root.getDirectoryHandle(DIR, { create: true });
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
