/**
 * Kinds of file plugins open (`api.ui.fileType`): a file dropped on the editor or picked in
 * File ▸ Open whose name ends in a claimed extension goes to that plugin, not to the map
 * reader — which would otherwise take any file that is not an archive as a bare scenario
 * and make an empty 64 × 64 map of a replay.
 */
import type { createStore } from "jotai";
import { pluginFileTypesAtom, type PluginFileTypeEntry } from "../atoms/pluginAtoms";
import { logError } from "../editor/log";
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

/** File ▸ Open's extra types, for the picker: each plugin's own, after the editor's. */
export function pickerFileTypes(store: Store): { description: string; extensions: string[] }[] {
  return store.get(pluginFileTypesAtom).map((t) => ({ description: t.spec.name, extensions: t.extensions }));
}
