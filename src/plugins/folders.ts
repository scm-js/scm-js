/**
 * A folder's files with their paths, from each of the three ways a browser hands a folder
 * over: the folder picker (`showDirectoryPicker`, a handle walked), the folder input
 * (`<input webkitdirectory>`, each file with its `webkitRelativePath`) and a drop (the
 * dropped item's `webkitGetAsEntry()`, walked). All three give the same shape — the path
 * from the folder's parent with forward slashes, the folder's own name first — which is
 * what `api.ui.pickFiles({ directory: true })` and a `fileType`'s `openFolder` receive.
 *
 * The two walks come in two steps: the paths (`entryPaths`, `directoryHandlePaths`), then
 * the `File`s (`readFound`), so a drop can ask the plugins about the paths before paying a
 * browser call for every file, and both steps report a count as they go.
 *
 * The browser types are described structurally here, so the tests can hand in made ones.
 */
import type { FolderFile } from "./api";

/** The part of `FileSystemDirectoryHandle` the walk uses. */
export interface DirectoryHandleLike {
  kind: "directory";
  name: string;
  values(): AsyncIterable<DirectoryHandleLike | FileHandleLike>;
}
/** The part of `FileSystemFileHandle` the walk uses. */
export interface FileHandleLike {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

/** The part of a dropped item's `FileSystemEntry` the walk uses. */
export interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (file: File) => void, fail?: (err: unknown) => void): void;
  createReader?(): { readEntries(ok: (entries: EntryLike[]) => void, fail?: (err: unknown) => void): void };
}
/** The part of a `DataTransfer` a drop's folders are read from. */
export interface DataTransferLike {
  items?: ArrayLike<{ kind: string; webkitGetAsEntry?(): EntryLike | null; getAsFileSystemHandle?(): Promise<DirectoryHandleLike | FileHandleLike | null> }> | null;
}

/**
 * A dropped folder: its item's index among the drop's files, its entry, and — where the
 * browser has `getAsFileSystemHandle` (Chromium, so the desktop app too) — a promise of its
 * handle. Both are asked for inside the drop event; either walks the same folder, and the
 * handle's `getFile()` answers many at once where the entry's `file()` answers one after another.
 */
export interface DroppedFolder {
  index: number;
  entry: EntryLike;
  handle: Promise<DirectoryHandleLike | null> | null;
}

const join = (prefix: string, name: string) => (prefix ? `${prefix}/${name}` : name);
const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The files of a folder input (`webkitdirectory`): `webkitRelativePath` already starts with the folder's name. */
export function folderInputFiles(files: readonly File[]): FolderFile[] {
  return files.map((file) => ({ path: ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replaceAll("\\", "/"), file })).sort(byPath);
}

/**
 * A file found in a folder but not read yet: its path and what its `File` comes from — a
 * dropped entry or a picked handle. Walking a folder for its paths alone is one browser call
 * a directory (a drop's `readEntries` hands a hundred names at a time); a `File` is one call
 * *a file*, so the walk asks for paths first and the files only for a folder something takes.
 */
export interface FoundFile<F> {
  path: string;
  from: F;
}

/** One child of a directory being walked: a directory to walk, or a file to find. */
type Child<D, F> = { name: string; dir?: D; file?: F };

/** How many directories are listed at once, and how many `File`s asked for at once. */
const DIRS_AT_ONCE = 8;
const FILES_AT_ONCE = 32;

/**
 * Every file under `root` with its path, sorted by path. `list` hands over one directory's
 * children in pieces; several directories are listed at once, and `onFound` hears the count
 * of files found so far after each piece. The first failure stops the walk and is thrown.
 */
async function walkPaths<D, F>(
  root: D, prefix: string,
  list: (dir: D) => AsyncIterable<Child<D, F>[]>,
  onFound?: (found: number) => void,
): Promise<FoundFile<F>[]> {
  const found: FoundFile<F>[] = [];
  const queue: { dir: D; path: string }[] = [{ dir: root, path: prefix }];
  let active = 0;
  let failed = false;
  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      if (failed) return;
      if (queue.length === 0 && active === 0) { resolve(); return; }
      while (active < DIRS_AT_ONCE && queue.length > 0) {
        const { dir, path } = queue.shift()!;
        active++;
        (async () => {
          for await (const piece of list(dir)) {
            for (const child of piece) {
              const at = join(path, child.name);
              if (child.dir !== undefined) queue.push({ dir: child.dir, path: at });
              else if (child.file !== undefined) found.push({ path: at, from: child.file });
            }
            onFound?.(found.length);
            pump();
          }
        })().then(() => { active--; pump(); }, (err) => { failed = true; reject(err); });
      }
    };
    pump();
  });
  return found.sort(byPath);
}

/**
 * The `File`s of found files, in the same order, asked for `FILES_AT_ONCE` at a time rather
 * than one after another; `onRead` hears how many have arrived. The first failure is thrown.
 */
export async function readFound<F>(found: readonly FoundFile<F>[], read: (from: F) => Promise<File>, onRead?: (read: number) => void): Promise<FolderFile[]> {
  const out: FolderFile[] = Array.from({ length: found.length });
  let next = 0;
  let done = 0;
  let failed = false;
  const worker = async () => {
    while (next < found.length && !failed) {
      const i = next++;
      try {
        out[i] = { path: found[i].path, file: await read(found[i].from) };
      } catch (err) {
        failed = true;
        throw err;
      }
      onRead?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FILES_AT_ONCE, found.length) }, worker));
  return out;
}

/** A directory handle's children, one at a time as `values()` gives them. */
async function* handleChildren(dir: DirectoryHandleLike): AsyncIterable<Child<DirectoryHandleLike, FileHandleLike>[]> {
  for await (const child of dir.values()) yield [child.kind === "directory" ? { name: child.name, dir: child } : { name: child.name, file: child }];
}

/** Every file's path under a directory handle, from the handle's parent (`prefix` names the handle itself); no `File` is asked for. */
export function directoryHandlePaths(handle: DirectoryHandleLike, prefix = handle.name, onFound?: (found: number) => void): Promise<FoundFile<FileHandleLike>[]> {
  return walkPaths(handle, prefix, handleChildren, onFound);
}

/** The `File` behind a picked handle. */
export const handleFile = (handle: FileHandleLike) => handle.getFile();

/** Every file under a directory handle, its path from the handle's parent (`prefix` names the handle itself). */
export async function directoryHandleFiles(handle: DirectoryHandleLike, prefix = handle.name): Promise<FolderFile[]> {
  return readFound(await directoryHandlePaths(handle, prefix), handleFile);
}

/** A dropped directory's children, in the pieces `readEntries` hands them over in (Chromium: 100 at a time) until it hands over none. */
async function* entryChildren(dir: EntryLike): AsyncIterable<Child<EntryLike, EntryLike>[]> {
  if (!dir.createReader) return;
  const reader = dir.createReader();
  for (;;) {
    const batch = await new Promise<EntryLike[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) return;
    yield batch.flatMap((child): Child<EntryLike, EntryLike>[] => (child.isDirectory ? [{ name: child.name, dir: child }] : child.isFile && child.file ? [{ name: child.name, file: child }] : []));
  }
}

/** Every file's path under a dropped folder's entry, from the folder's parent; no `File` is asked for. */
export async function entryPaths(entry: EntryLike, prefix = entry.name, onFound?: (found: number) => void): Promise<FoundFile<EntryLike>[]> {
  if (entry.isFile && entry.file) return [{ path: prefix, from: entry }];
  if (!entry.isDirectory) return [];
  return walkPaths(entry, prefix, entryChildren, onFound);
}

/** The `File` behind a dropped file's entry. */
export const entryFile = (entry: EntryLike) => new Promise<File>((ok, fail) => entry.file!(ok, fail));

/** Every file under a dropped folder's entry, its path from the folder's parent. */
export async function entryFiles(entry: EntryLike, prefix = entry.name): Promise<FolderFile[]> {
  return readFound(await entryPaths(entry, prefix), entryFile);
}

/**
 * The dropped folders, by the index of their item among the drop's files (which is where
 * `DataTransfer.files` holds a placeholder for each). Read at once: a drop's items are
 * gone when the event ends, the entries they gave are not.
 */
export function droppedFolders(data: DataTransferLike): DroppedFolder[] {
  const out: DroppedFolder[] = [];
  const items = data.items;
  if (!items) return out;
  let index = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== "file") continue;
    let entry: EntryLike | null = null;
    try {
      entry = item.webkitGetAsEntry?.() ?? null;
    } catch {
      entry = null;
    }
    if (entry?.isDirectory) {
      let handle: Promise<DirectoryHandleLike | null> | null = null;
      try {
        // Refused for a folder the browser keeps to itself, or not there at all: the entry is walked instead.
        handle = item.getAsFileSystemHandle?.().then((h) => (h?.kind === "directory" ? h : null), () => null) ?? null;
      } catch {
        handle = null;
      }
      out.push({ index, entry, handle });
    }
    index++;
  }
  return out;
}

/** The folder picker where the browser has one, else null (the folder input is then the way). */
export function directoryPicker(): ((options: { mode: "read"; id?: string }) => Promise<DirectoryHandleLike>) | null {
  if (typeof window === "undefined") return null;
  const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: "read"; id?: string }) => Promise<DirectoryHandleLike> }).showDirectoryPicker;
  return typeof picker === "function" ? picker.bind(window) : null;
}

/** The user dismissed the picker: an `AbortError`, which is no failure. */
export const isAbort = (err: unknown) => typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError";
