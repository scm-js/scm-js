/**
 * Kinds of file plugins open (`api.ui.fileType`): a file dropped on the editor or picked in
 * File ▸ Open whose name ends in a claimed extension goes to that plugin, not to the map
 * reader — which would otherwise take any file that is not an archive as a bare scenario
 * and make an empty 64 × 64 map of a replay. A dropped folder goes, as its files with their
 * paths, to a plugin whose type opens folders (`takeDroppedFolders`).
 */
import type { createStore } from "jotai";
import { pluginFileTypesAtom, type PluginFileTypeEntry } from "../atoms/pluginAtoms";
import { logError, logInfo } from "../editor/log";
import type { FolderFile } from "./api";
import { droppedFolders, entryFiles, type DataTransferLike, type EntryLike } from "./folders";
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
 * each is walked and offered on its own, in registration order, to the first type whose
 * `acceptsFolder` passes (or that has none). Answers the indexes among the drop's files of
 * the folders' placeholders, which the caller leaves out of the files it opens, and a
 * promise of the offers being made. With no plugin that opens folders nothing is taken and
 * a drop goes on as it always has.
 */
export function takeDroppedFolders(store: Store, data: DataTransferLike): { taken: Set<number>; done: Promise<void> } {
  const types = store.get(pluginFileTypesAtom).filter((t) => typeof t.spec.openFolder === "function");
  if (types.length === 0) return { taken: new Set(), done: Promise.resolve() };
  // The entries are taken while the drop event lasts; walking them can come after.
  const folders = droppedFolders(data);
  const done = Promise.all(folders.map(({ entry }) => offerFolder(types, entry))).then(() => undefined);
  return { taken: new Set(folders.map((f) => f.index)), done };
}

async function offerFolder(types: readonly PluginFileTypeEntry[], entry: EntryLike): Promise<void> {
  let files: FolderFile[];
  try {
    files = await entryFiles(entry);
  } catch (err) {
    logError("plugins", `Reading the dropped folder ${entry.name} failed`, err);
    return;
  }
  const paths = files.map((f) => f.path);
  const type = types.find((t) => {
    try {
      return t.spec.acceptsFolder ? t.spec.acceptsFolder(paths) === true : true;
    } catch (err) {
      logError(t.plugin.name, `Asking whether it opens the folder ${entry.name} failed`, err);
      return false;
    }
  });
  if (!type) { logInfo("plugins", `No plugin opens the dropped folder ${entry.name}`, { files: files.length }); return; }
  count("file.open", { plugin: pluginName(type.plugin.source), ext: "folder" });
  try {
    await type.spec.openFolder!(files);
  } catch (err) {
    logError(type.plugin.name, `Opening the folder ${entry.name} failed`, err);
  }
}

/** File ▸ Open's extra types, for the picker: each plugin's own, after the editor's. */
export function pickerFileTypes(store: Store): { description: string; extensions: string[] }[] {
  return store.get(pluginFileTypesAtom).filter((t) => t.extensions.length > 0).map((t) => ({ description: t.spec.name, extensions: t.extensions }));
}
