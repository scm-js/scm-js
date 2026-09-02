import { useCallback } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { archiveExtrasAtom, closeDocumentAtom, loadDocumentAtom, scenarioAtom } from "../atoms/documentAtoms";
import { mapFilePathAtom, mapModifiedAtom, screenAtom } from "../atoms/editorAtoms";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { openDialogAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { createScenario } from "../formats/chk/create";
import { ensureTileset, peekTileset, TILESET_FILENAMES } from "../formats/tileset/load";
import { baseTerrain, flatTerrain } from "../formats/tileset/terrain";
import { terrainName, TILESETS, TILESET_BY_ID, type TilesetId } from "../data/tilesets";
import { openMapFile, saveBytes, writeMapBytes, type MapFormat } from "../services/mapIo";

export interface NewMapOptions {
  width: number;
  height: number;
  tileset: TilesetId;
  name: string;
  description: string;
  /** ISOM id of the terrain to fill with; the tileset's default when omitted. */
  terrainId?: number;
}

/** What StarEdit starts on, give or take its 64x64: a blank Badlands scenario. */
export const DEFAULT_NEW_MAP: NewMapOptions = {
  width: 128,
  height: 128,
  tileset: "badlands",
  name: "Untitled Scenario",
  description: "",
};

/**
 * Something that replaces or closes the open document. When the map has unsaved changes
 * and the preference is on, it is held in the Close Scenario dialog's payload until the
 * user chooses Save / Don't Save (`runPending`), else it runs at once.
 */
export type PendingAction =
  | { action: "new"; options: NewMapOptions }
  /**
   * `done` hears how it went: true once the file is open, false when the file was unreadable.
   * The Close Scenario dialog sets `taken` the moment the user chooses to go on, so whoever
   * watches the dialog stack can tell a dismissal (Cancel, Escape, the ×) from an open in progress.
   */
  | { action: "open"; file: File; done?: (opened: boolean) => void; taken?: boolean }
  | { action: "close" };

type Store = ReturnType<typeof useStore>;

/**
 * Read a map file and install it as the open document, reporting on the status bar.
 * The store-level half of `openFile`, so the plugin host can open a map without React.
 */
export async function openFileInto(store: Store, file: File): Promise<boolean> {
  store.set(statusMessageAtom, `Opening ${file.name}…`);
  try {
    const doc = await openMapFile(file);
    store.set(loadDocumentAtom, doc);
    store.set(screenAtom, "editor");
    const warnings = doc.scenario.warnings.length;
    store.set(
      statusMessageAtom,
      `Opened ${file.name} — ${doc.scenario.width}×${doc.scenario.height}, ` +
      `${doc.scenario.units.length} units` +
      (warnings > 0 ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""),
    );
    return true;
  } catch (err) {
    store.set(statusMessageAtom, `Could not open ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Whether replacing the document should go through the Close Scenario dialog first. */
export function needsCloseConfirm(store: Store): boolean {
  return store.get(preferencesAtom).confirmClose && store.get(mapModifiedAtom) && store.get(scenarioAtom) !== null;
}

/** New, open and save actions shared by the menu, hotkeys, splash and drag-and-drop. */
export function useMapFileActions() {
  const store = useStore();
  const scenario = useAtomValue(scenarioAtom);
  const extras = useAtomValue(archiveExtrasAtom);
  const path = useAtomValue(mapFilePathAtom);
  const load = useSetAtom(loadDocumentAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const setModified = useSetAtom(mapModifiedAtom);
  const setPath = useSetAtom(mapFilePathAtom);
  const openDialog = useSetAtom(openDialogAtom);

  /**
   * Build a blank scenario and install it as the open document. The tileset graphics
   * decide which tiles the fill uses, so they are fetched first; without them the map
   * is still made of dirt ids and the viewport falls back to flat colour.
   *
   * `onlyWhenEmpty` is for the startup map: a file opened while the tileset was still
   * loading wins over it.
   */
  const newMap = useCallback(async (options: NewMapOptions = DEFAULT_NEW_MAP, onlyWhenEmpty = false) => {
    const { width, height, name, description } = options;
    const info = TILESET_BY_ID[options.tileset];
    const era = Math.max(0, TILESETS.findIndex((t) => t.id === options.tileset));
    const loaded = peekTileset(TILESET_FILENAMES[era]) ?? await ensureTileset(TILESET_FILENAMES[era]).catch(() => null);
    if (onlyWhenEmpty && store.get(scenarioAtom)) return;

    const terrain = baseTerrain(loaded?.tileset ?? null, options.terrainId ?? info.defaultIsom);
    const { tiles, isom } = flatTerrain(width, height, terrain, loaded?.tileset ?? null, Math.random, era);

    load({
      scenario: createScenario({ width, height, era, name, description, tiles, isom }),
      extras: new Map(),
      fileName: null,
    });
    setStatus(`New ${width}×${height} ${info.name} scenario — ${terrainName(info, terrain.id)}`);
  }, [load, setStatus, store]);

  const openFile = useCallback((file: File) => openFileInto(store, file), [store]);

  /** Ctrl+S: write straight back to the current file name, or fall back to Save As. */
  const save = useCallback(async () => {
    if (!scenario) { setStatus("Nothing to save — open or create a map first."); return false; }
    if (!path) { openDialog("saveAs"); return false; }

    const format = (path.split(".").pop()?.toLowerCase() ?? "scx") as MapFormat;
    try {
      const bytes = await writeMapBytes(scenario, { format, extras });
      if (!(await saveBytes(bytes, path))) return false;
      setModified(false);
      setStatus(`Saved ${path} — ${(bytes.length / 1024).toFixed(1)} KB`);
      return true;
    } catch (err) {
      setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, [extras, openDialog, path, scenario, setModified, setStatus]);

  /** Drop the open document (File ▸ Close). */
  const closeMap = useCallback(() => {
    store.set(closeDocumentAtom);
    setStatus("Closed the scenario — File ▸ New or Open to continue.");
  }, [store, setStatus]);

  const runPending = useCallback(async (p: PendingAction) => {
    if (p.action === "new") await newMap(p.options);
    else if (p.action === "open") p.done?.(await openFile(p.file));
    else closeMap();
  }, [newMap, openFile, closeMap]);

  /**
   * Run a document-replacing action, or park it behind the Close Scenario dialog when the
   * map has unsaved changes and Preferences say to ask. True when the dialog took over.
   */
  const guard = useCallback((p: PendingAction): boolean => {
    if (!needsCloseConfirm(store)) { void runPending(p); return false; }
    openDialog("confirmClose", { pending: p });
    return true;
  }, [store, openDialog, runPending]);

  return { newMap, openFile, save, setPath, closeMap, runPending, guard };
}
