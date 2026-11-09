/**
 * Kinds of file plugins open (`api.ui.fileType`): a file dropped on the editor or picked in
 * File ▸ Open whose name ends in a claimed extension goes to that plugin, not to the map
 * reader — which would otherwise take any file that is not an archive as a bare scenario
 * and make an empty 64 × 64 map of a replay. A dropped folder goes, as its files with their
 * paths, to a plugin whose type opens folders (`takeDroppedFolders`).
 */
import type { createStore } from "jotai";
import { pluginFileTypesAtom, type PluginFileTypeEntry } from "../atoms/pluginAtoms";
import { logError, logInfo, logWarn } from "../editor/log";
import { folderReadsAtom, type FolderRead } from "../atoms/uiAtoms";
import type { FolderFile } from "./api";
import { droppedFileReader, droppedFolders, entryPaths, readFound, type DataTransferLike, type DroppedFolder } from "./folders";
import { count, countReplays, extOf, pluginName } from "../services/usage";

type Store = ReturnType<typeof createStore>;

/** The editor's own: never handed to a plugin. */
export const MAP_EXTENSIONS: readonly string[] = [".scm", ".scx", ".chk"];

/** `".REP"` and `"rep"` both as `".rep"`. */
export function normalExtension(ext: string): string {
  const e = ext.trim().toLowerCase();
  return e.startsWith(".") ? e : `.${e}`;
}

/** The registered type that claims `fileName`, or null — the first registered wins a shared extension. */
export function fileTypeFor(types: readonly PluginFileTypeEntry[], fileName: string): PluginFileTypeEntry | null {
  const name = fileName.toLowerCase();
  return types.find((t) => t.extensions.some((ext) => name.endsWith(ext))) ?? null;
}

/**
 * Hand every claimed file to its plugin, the files of one type together, and answer the
 * ones nobody claimed (the editor opens the first of those as a map, as before).
 */
export function handFilesToPlugins(store: Store, files: readonly File[]): File[] {
  const types = store.get(pluginFileTypesAtom);
  if (types.length === 0) return [...files];
  const claimed = new Map<PluginFileTypeEntry, File[]>();
  const rest: File[] = [];
  for (const file of files) {
    const type = fileTypeFor(types, file.name);
    if (!type) { rest.push(file); continue; }
    claimed.set(type, [...(claimed.get(type) ?? []), file]);
  }
  for (const [type, list] of claimed) {
    for (const f of list) count("file.open", { plugin: pluginName(type.plugin.source), ext: extOf(f.name) });
    countReplays(list, "open");
    try {
      const done = type.spec.open(list);
      if (done && typeof (done as Promise<void>).then === "function") (done as Promise<void>).catch((err) => logError(type.plugin.name, `Opening ${list.map((f) => f.name).join(", ")} failed`, err));
    } catch (err) {
      logError(type.plugin.name, `Opening ${list.map((f) => f.name).join(", ")} failed`, err);
    }
  }
  return rest;
}

/**
 * The folders of a drop, for the plugins that open folders (`FileTypeSpec.openFolder`):
 * each is walked for its paths and offered on its own, in registration order, to the first
 * type whose `acceptsFolder` passes (or that has none); only then are its `File`s read, for
 * that type's `openFolder`. Every file in the folder is listed and handed over, the ones a
 * browser keeps back from a folder pick among them (`droppedFolderPaths`). The status bar
 * says the folder is being read, with a count, from the drop until it is handed over or
 * left. Answers the indexes among the drop's files of the folders' placeholders, which the
 * caller leaves out of the files it opens, and a promise of the offers being made. With no
 * plugin that opens folders nothing is taken and a drop goes on as it always has.
 */
export function takeDroppedFolders(store: Store, data: DataTransferLike): { taken: Set<number>; done: Promise<void> } {
  const types = store.get(pluginFileTypesAtom).filter((t) => typeof t.spec.openFolder === "function");
  if (types.length === 0) return { taken: new Set(), done: Promise.resolve() };
  // The entries are taken while the drop event lasts; walking them can come after.
  const folders = droppedFolders(data);
  const done = Promise.all(folders.map((folder) => offerFolder(store, types, folder))).then(() => undefined);
  return { taken: new Set(folders.map((f) => f.index)), done };
}

/**
 * A dropped folder's paths, and how to get its `File`s. The paths are the entry's, which
 * lists every file; a handle leaves out the names the browser keeps back from it
 * (`folders.ts`), so it is never what says which files there are. The `File`s come by the
 * handle wherever the drop gave one and it has the file, since the browser answers its
 * `getFile()` many at a time, and by the entry for the rest: with no handle, or one that
 * fails, that is all of them. No `File` is asked for, and nothing of the handle is listed,
 * until `files` is called.
 */
async function droppedFolderPaths(folder: DroppedFolder, onFound: (n: number) => void): Promise<{ paths: string[]; files: (onRead: (n: number) => void) => Promise<FolderFile[]> }> {
  const { entry } = folder;
  const found = await entryPaths(entry, entry.name, onFound);
  const files = async (onRead: (n: number) => void) => {
    const handle = folder.handle ? await folder.handle : null;
    let warned = false;
    const { read, reads } = droppedFileReader(handle, entry.name, (err, path) => {
      // Once a folder: a handle that fails for one file usually fails for more.
      if (warned) return;
      warned = true;
      logWarn("plugins", `Reading ${path} of a dropped folder by its handle failed; the entry reads what the handle does not`, { error: err instanceof Error ? err.message : String(err) });
    });
    const out = await readFound(found, read, onRead);
    logInfo("plugins", `Read the dropped folder ${entry.name}`, { files: out.length, byHandle: reads.byHandle, byEntry: reads.byEntry, firstByEntry: reads.firstByEntry ?? undefined });
    return out;
  };
  return { paths: found.map((f) => f.path), files };
}

async function offerFolder(store: Store, types: readonly PluginFileTypeEntry[], folder: DroppedFolder): Promise<void> {
  const { entry } = folder;
  const reading = folderReading(store, entry.name);
  try {
    // The paths alone first: a `File` is a browser call per file, and a folder nobody takes needs none.
    const { paths, files: readFiles } = await droppedFolderPaths(folder, reading.found);
    const type = types.find((t) => {
      try {
        return t.spec.acceptsFolder ? t.spec.acceptsFolder(paths) === true : true;
      } catch (err) {
        logError(t.plugin.name, `Asking whether it opens the folder ${entry.name} failed`, err);
        return false;
      }
    });
    if (!type) { logInfo("plugins", `No plugin opens the dropped folder ${entry.name}`, { files: paths.length }); return; }
    const files = await readFiles(reading.read);
    // From here the plugin says what it is doing.
    reading.end();
    count("file.open", { plugin: pluginName(type.plugin.source), ext: "folder" });
    try {
      await type.spec.openFolder!(files);
    } catch (err) {
      logError(type.plugin.name, `Opening the folder ${entry.name} failed`, err);
    }
  } catch (err) {
    logError("plugins", `Reading the dropped folder ${entry.name} failed`, err);
  } finally {
    reading.end();
  }
}

/** How often a folder's status bar cell takes a new count: a write per directory read would be a render each. */
const FOLDER_READ_EVERY_MS = 150;
let nextFolderRead = 1;

/**
 * A folder being read, shown in the status bar (`folderReadsAtom`) from now until `end()`:
 * `found` and `read` take the counts as the walk goes and write them at most every
 * `FOLDER_READ_EVERY_MS`. `end()` may be called more than once.
 */
export function folderReading(store: Store, name: string): { found: (n: number) => void; read: (n: number) => void; end: () => void } {
  const id = nextFolderRead++;
  let now: FolderRead = { id, name, found: 0, read: null };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ended = false;
  const write = () => {
    timer = null;
    if (!ended) store.set(folderReadsAtom, store.get(folderReadsAtom).map((r) => (r.id === id ? now : r)));
  };
  const soon = () => { if (timer === null && !ended) timer = setTimeout(write, FOLDER_READ_EVERY_MS); };
  store.set(folderReadsAtom, [...store.get(folderReadsAtom), now]);
  return {
    found: (n) => { now = { ...now, found: n }; soon(); },
    read: (n) => { now = { ...now, read: n }; soon(); },
    end: () => {
      if (ended) return;
      ended = true;
      if (timer !== null) clearTimeout(timer);
      store.set(folderReadsAtom, store.get(folderReadsAtom).filter((r) => r.id !== id));
    },
  };
}

/** File ▸ Open's extra types, for the picker: each plugin's own, after the editor's. */
export function pickerFileTypes(store: Store): { description: string; extensions: string[] }[] {
  return store.get(pluginFileTypesAtom).filter((t) => t.extensions.length > 0).map((t) => ({ description: t.spec.name, extensions: t.extensions }));
}
