import { useCallback } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { archiveExtrasAtom, closeDocumentAtom, loadDocumentAtom, recentFilesAtom, scenarioAtom } from "../atoms/documentAtoms";
import { mapFileHandleAtom, mapFilePathAtom, mapModifiedAtom, mapOriginAtom, saveOptionsAtom, screenAtom } from "../atoms/editorAtoms";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { dialogStackAtom, openDialogAtom, pushToastAtom, statusMessageAtom, type DialogId } from "../atoms/uiAtoms";
import { createScenario } from "../formats/chk/create";
import { ensureTileset, peekTileset, TILESET_FILENAMES } from "../formats/tileset/load";
import { baseTerrain, flatTerrain } from "../formats/tileset/terrain";
import { terrainName, TILESETS, TILESET_BY_ID, type TilesetId } from "../data/tilesets";
import { openMapFile, saveBytes, type MapFileHandle, type SaveOutcome } from "../services/mapIo";
import { buildMapFile, defaultSaveOptions, formatBytes, type SaveOptions } from "../editor/save";

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
  /** `done` and `taken` as for "open": a plugin's `document.create` waits on them. */
  | { action: "new"; options: NewMapOptions; done?: (created: boolean) => void; taken?: boolean }
  /**
   * `done` hears how it went: true once the file is open, false when the file was unreadable.
   * The Close Scenario dialog sets `taken` the moment the user chooses to go on, so whoever
   * watches the dialog stack can tell a dismissal (Cancel, Escape, the ×) from an open in progress.
   */
  | { action: "open"; file: File; handle?: MapFileHandle | null; done?: (opened: boolean) => void; taken?: boolean }
  /**
   * The window or the tab is going away (`useCloseGuard`): nothing here replaces the document,
   * the answer *is* the point — `done` is what tells the desktop's main process whether to go
   * on closing, and a dismissal reaches it as false through `taken`, as for "open".
   */
  | { action: "quit"; done?: (quit: boolean) => void; taken?: boolean }
  | { action: "close" };

type Store = ReturnType<typeof useStore>;

/**
 * Read a map file and install it as the open document, reporting on the status bar.
 * The store-level half of `openFile`, so the plugin host can open a map without React.
 */
export async function openFileInto(store: Store, file: File, handle: MapFileHandle | null = null): Promise<boolean> {
  store.set(statusMessageAtom, `Opening ${file.name}…`);
  try {
    const doc = await openMapFile(file, handle);
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

/**
 * Build a blank scenario and install it as the open document. The tileset graphics
 * decide which tiles the fill uses, so they are fetched first; without them the map
 * is still made of dirt ids and the viewport falls back to flat colour. The store-level
 * half of `newMap`, so the plugin host can make a map without React.
 *
 * `onlyWhenEmpty` is for the startup map: a file opened while the tileset was still
 * loading wins over it. Returns whether a map was installed.
 */
export async function newMapInto(store: Store, options: NewMapOptions = DEFAULT_NEW_MAP, onlyWhenEmpty = false): Promise<boolean> {
  const { width, height, name, description } = options;
  const info = TILESET_BY_ID[options.tileset];
  const era = Math.max(0, TILESETS.findIndex((t) => t.id === options.tileset));
  const loaded = peekTileset(TILESET_FILENAMES[era]) ?? await ensureTileset(TILESET_FILENAMES[era]).catch(() => null);
  if (onlyWhenEmpty && store.get(scenarioAtom)) return false;

  const terrain = baseTerrain(loaded?.tileset ?? null, options.terrainId ?? info.defaultIsom);
  const { tiles, isom } = flatTerrain(width, height, terrain, loaded?.tileset ?? null, Math.random, era);

  store.set(loadDocumentAtom, {
    scenario: createScenario({ width, height, era, name, description, tiles, isom }),
    extras: new Map(),
    fileName: null,
    reason: "new",
  });
  store.set(statusMessageAtom, `New ${width}×${height} ${info.name} scenario — ${terrainName(info, terrain.id)}`);
  return true;
}

/** Whether replacing the document should go through the Close Scenario dialog first. */
export function needsCloseConfirm(store: Store): boolean {
  return store.get(preferencesAtom).confirmClose && store.get(mapModifiedAtom) && store.get(scenarioAtom) !== null;
}

/**
 * Run an action that would lose unsaved work, or park it in the Close Scenario dialog when
 * `needsCloseConfirm` says to ask first; `pending` builds the dialog's payload around the
 * promise's `done`. A dismissal — Cancel, Escape, the × — is seen from the dialog stack: the
 * entry leaves it without `taken`, which the dialog sets the moment the user chooses to go on.
 * (An unmount effect in the dialog would be simpler, but React's development double-mount runs
 * it once at mount.) The store-level gate behind the plugin host's `document.open` / `create`
 * and behind `useCloseGuard`.
 */
export function guardedAction(
  store: Store,
  run: () => Promise<boolean>,
  pending: (done: (ok: boolean) => void) => PendingAction & { taken?: boolean },
): Promise<boolean> {
  if (!needsCloseConfirm(store)) return run();
  return new Promise((resolve) => {
    const p = pending(resolve);
    store.set(openDialogAtom, "confirmClose", { pending: p });
    const unsub = store.sub(dialogStackAtom, () => {
      if (store.get(dialogStackAtom).some((d) => d.payload?.pending === p)) return;
      unsub();
      if (!p.taken) resolve(false);
    });
  });
}

/**
 * Open a dialog and wait for its answer. The dialog calls `payload.done(true)` (after setting
 * `payload.taken`) when it went through; a dismissal — Cancel, Escape, the × — is seen from
 * the dialog stack, as in `guardedAction`, and answers false.
 */
export function askDialog(store: Store, id: DialogId, payload: Record<string, unknown> = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const p: Record<string, unknown> & { taken?: boolean } = { ...payload, done: resolve };
    store.set(openDialogAtom, id, p);
    const unsub = store.sub(dialogStackAtom, () => {
      if (store.get(dialogStackAtom).some((d) => d.payload === p)) return;
      unsub();
      if (!p.taken) resolve(false);
    });
  });
}

/** One write of the open map. */
export interface SaveRequest {
  fileName: string;
  /** Write straight back here when set and the browser allows it. */
  handle: MapFileHandle | null;
  options: SaveOptions;
  /** A copy leaves the document's name, handle, options and modified state alone. */
  copy: boolean;
  /** The bytes, when the caller already built them (the dialog's preview); built here otherwise. */
  bytes?: Uint8Array;
}

/** What `saveBytes` does, so tests can stand in for the browser. */
export type SaveWriter = (bytes: Uint8Array, fileName: string, handle: MapFileHandle | null) => Promise<SaveOutcome | null>;

/**
 * Write the open map and record the result: the file name and handle to write back to next
 * time, the options to reuse, the clean state, a status line and a toast that says where the
 * bytes went — "downloaded" is a different outcome from "saved" and is worded as one, because
 * a browser without the File System Access API can only download, and that is easy to miss.
 * False when the user dismissed the browser's dialog or the write failed (the toast says so).
 */
export async function saveDocument(store: Store, req: SaveRequest, write: SaveWriter = saveBytes): Promise<boolean> {
  const scenario = store.get(scenarioAtom);
  if (!scenario) { store.set(statusMessageAtom, "Nothing to save — open or create a map first."); return false; }
  const what = req.copy ? "copy" : "map";
  try {
    const bytes = req.bytes ?? await buildMapFile(scenario, store.get(archiveExtrasAtom), req.options);
    const outcome = await write(bytes, req.fileName, req.handle);
    if (!outcome) return false;
    const size = formatBytes(bytes.length);
    if (!req.copy) {
      store.set(mapFilePathAtom, outcome.fileName);
      store.set(mapFileHandleAtom, outcome.handle ?? (outcome.route === "file" ? req.handle : null));
      store.set(saveOptionsAtom, req.options);
      store.set(mapModifiedAtom, false);
      store.set(recentFilesAtom, [outcome.fileName, ...store.get(recentFilesAtom).filter((f) => f !== outcome.fileName)].slice(0, 10));
    }
    if (outcome.route === "download") {
      store.set(statusMessageAtom, `Downloaded ${outcome.fileName} — ${size}`);
      store.set(pushToastAtom, {
        kind: "ok",
        title: req.copy ? "Copy downloaded" : "Downloaded",
        detail: `${outcome.fileName} (${size}) is in the browser's downloads folder. This browser cannot write a file back in place, so every save is a new download.`,
      });
    } else {
      store.set(statusMessageAtom, `Saved ${outcome.fileName} — ${size}`);
      store.set(pushToastAtom, { kind: "ok", title: req.copy ? "Copy saved" : "Saved", detail: `${outcome.fileName} (${size})` });
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.set(statusMessageAtom, `Could not save the ${what}: ${message}`);
    store.set(pushToastAtom, { kind: "error", title: `Could not save the ${what}`, detail: message });
    return false;
  }
}

/** Drop the open document (File ▸ Close). */
export function closeMapIn(store: Store) {
  store.set(closeDocumentAtom);
  store.set(statusMessageAtom, "Closed the scenario — File ▸ New or Open to continue.");
}

/**
 * Carry out a `PendingAction` — what the Close Scenario dialog does once the question is
 * answered, and what `guard` does straight away when there is no question. The action runs
 * whether or not anyone is listening: not `p.done?.(await …)`, since an optional call skips
 * its arguments when there is no callee, which is exactly the menu's and a drop's case.
 */
export async function runPendingAction(store: Store, p: PendingAction): Promise<void> {
  if (p.action === "new") {
    const created = await newMapInto(store, p.options);
    p.done?.(created);
  } else if (p.action === "open") {
    const opened = await openFileInto(store, p.file, p.handle ?? null);
    p.done?.(opened);
  } else if (p.action === "quit") {
    p.done?.(true);
  } else {
    closeMapIn(store);
  }
}

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
    if (!scenario) { setStatus("Nothing to save — open or create a map first."); return false; }
    if (mode === "save" && path) {
      const options = store.get(saveOptionsAtom) ?? defaultSaveOptions(scenario, store.get(mapOriginAtom), path);
      return saveDocument(store, { fileName: path, handle: store.get(mapFileHandleAtom), options, copy: false });
    }
    return askDialog(store, "saveAs", { copy: mode === "copy" });
  }, [path, scenario, setStatus, store]);

  /** Drop the open document (File ▸ Close). */
  const closeMap = useCallback(() => closeMapIn(store), [store]);

  const runPending = useCallback((p: PendingAction) => runPendingAction(store, p), [store]);

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
