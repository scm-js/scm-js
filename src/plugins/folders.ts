/**
 * A folder's files with their paths, from each of the three ways a browser hands a folder
 * over: the folder picker (`showDirectoryPicker`, a handle walked), the folder input
 * (`<input webkitdirectory>`, each file with its `webkitRelativePath`) and a drop (the
 * dropped item's `webkitGetAsEntry()`, walked). All three give the same shape — the path
 * from the folder's parent with forward slashes, the folder's own name first — which is
 * what `api.ui.pickFiles({ directory: true })` and a `fileType`'s `openFolder` receive.
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
  items?: ArrayLike<{ kind: string; webkitGetAsEntry?(): EntryLike | null }> | null;
}

const join = (prefix: string, name: string) => (prefix ? `${prefix}/${name}` : name);
const byPath = (a: FolderFile, b: FolderFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The files of a folder input (`webkitdirectory`): `webkitRelativePath` already starts with the folder's name. */
export function folderInputFiles(files: readonly File[]): FolderFile[] {
  return files.map((file) => ({ path: ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replaceAll("\\", "/"), file })).sort(byPath);
}

/** Every file under a directory handle, its path from the handle's parent (`prefix` names the handle itself). */
export async function directoryHandleFiles(handle: DirectoryHandleLike, prefix = handle.name): Promise<FolderFile[]> {
  const out: FolderFile[] = [];
  const walk = async (dir: DirectoryHandleLike, at: string) => {
    for await (const child of dir.values()) {
      if (child.kind === "directory") await walk(child, join(at, child.name));
      else out.push({ path: join(at, child.name), file: await child.getFile() });
    }
  };
  await walk(handle, prefix);
  return out.sort(byPath);
}

/** Every file under a dropped folder's entry, its path from the folder's parent. */
export async function entryFiles(entry: EntryLike, prefix = entry.name): Promise<FolderFile[]> {
  const out: FolderFile[] = [];
  const walk = async (at: EntryLike, path: string): Promise<void> => {
    if (at.isFile && at.file) {
      const file = await new Promise<File>((ok, fail) => at.file!(ok, fail));
      out.push({ path, file });
      return;
    }
    if (!at.isDirectory || !at.createReader) return;
    const reader = at.createReader();
    // `readEntries` hands a folder over in pieces (Chromium: 100 at a time) until it hands over none.
    for (;;) {
      const batch = await new Promise<EntryLike[]>((ok, fail) => reader.readEntries(ok, fail));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, join(path, child.name));
    }
  };
  await walk(entry, prefix);
  return out.sort(byPath);
}

/**
 * The dropped folders, by the index of their item among the drop's files (which is where
 * `DataTransfer.files` holds a placeholder for each). Read at once: a drop's items are
 * gone when the event ends, the entries they gave are not.
 */
export function droppedFolders(data: DataTransferLike): { index: number; entry: EntryLike }[] {
  const out: { index: number; entry: EntryLike }[] = [];
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
    if (entry?.isDirectory) out.push({ index, entry });
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
