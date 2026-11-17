import { useCallback } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { canEdit, scenarioAtom, type RecentEntry } from "../atoms/documentAtoms";
import { mapFileHandleAtom, mapFilePathAtom, mapOriginAtom, saveOptionsAtom } from "../atoms/editorAtoms";
import { openDialogAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { defaultSaveOptions } from "../editor/save";
import { handFilesToPlugins } from "../plugins/fileTypes";
import {
  askDialog, closeMapIn, DEFAULT_NEW_MAP, needsCloseConfirm, newMapInto, openFileInto, openRecentInto, runPendingAction, saveDocument,
  type NewMapOptions, type PendingAction,
} from "../services/documentActions";
import type { MapFileHandle } from "../services/mapIo";
import { t } from "../i18n";

/** New, open and save actions shared by the menu, hotkeys, splash and drag-and-drop. */
export function useMapFileActions() {
  const store = useStore();
  const scenario = useAtomValue(scenarioAtom);
  const path = useAtomValue(mapFilePathAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const setPath = useSetAtom(mapFilePathAtom);
  const openDialog = useSetAtom(openDialogAtom);

  /** File ▸ New: `newMapInto` over this store. */
  const newMap = useCallback(async (options: NewMapOptions = DEFAULT_NEW_MAP, onlyWhenEmpty = false) => {
    await newMapInto(store, options, onlyWhenEmpty);
  }, [store]);

  const openFile = useCallback((file: File, handle: MapFileHandle | null = null) => openFileInto(store, file, handle), [store]);

  /**
   * Ctrl+S: write the map back where it came from with the options last confirmed for it —
   * straight into the file when the browser gave a handle, else through the browser's save
   * dialog or as a download. A map with no file name yet goes through Save As. `"saveAs"`
   * and `"copy"` open the Save dialog; the promise answers once the file is written (true)
   * or the dialog is dismissed (false), so Close Scenario's Save can wait on it.
   */
  const save = useCallback(async (mode: "save" | "saveAs" | "copy" = "save"): Promise<boolean> => {
    if (!scenario) { setStatus(t("Nothing to save — open or create a map first.")); return false; }
    // A view-only map is saved only as a copy; Save and Save As say why instead.
    if (mode !== "copy" && !canEdit(store.get, store.set)) return false;
    if (mode === "save" && path) {
      const options = store.get(saveOptionsAtom) ?? defaultSaveOptions(scenario, store.get(mapOriginAtom), path);
      return saveDocument(store, { fileName: path, handle: store.get(mapFileHandleAtom), options, copy: false });
    }
    return askDialog(store, "saveAs", { copy: mode === "copy" });
  }, [path, scenario, setStatus, store]);

  /** Drop the open document (File ▸ Close). */
  const closeMap = useCallback(() => closeMapIn(store), [store]);

  const runPending = useCallback((p: PendingAction) => runPendingAction(store, p), [store]);

  const openRecent = useCallback((entry: RecentEntry) => openRecentInto(store, entry), [store]);

  /**
   * Run a document-replacing action, or park it behind the Close Scenario dialog when the
   * map has unsaved changes and Preferences say to ask. True when the dialog took over.
   */
  const guard = useCallback((p: PendingAction): boolean => {
    // A file a plugin claimed (a replay) is that plugin's to open: File ▸ Open, Open Recent, a drop, the desktop's open-with.
    if (p.action === "open" && handFilesToPlugins(store, [p.file]).length === 0) return false;
    if (!needsCloseConfirm(store, p)) { void runPending(p); return false; }
    openDialog("confirmClose", { pending: p });
    return true;
  }, [store, openDialog, runPending]);

  return { newMap, openFile, openRecent, save, setPath, closeMap, runPending, guard };
}
