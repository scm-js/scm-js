/**
 * `api.ui`: dialogs, panels, pickers, and the surfaces in `surfaces.ts` and `mapView.ts`.
 */
import { viewportRepaintAtom } from "../../atoms/editorAtoms";
import { closeDialogAtom, dialogStackAtom, openDialogAtom, pushToastAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import { nextContributionKey, pluginDialogSlotsAtom, pluginPreferencesPagesAtom, pluginTestTargetsAtom, pluginPanelsAtom, pluginFileTypesAtom, type BusyBox, type TitleBox, type MaximizedBox } from "../../atoms/pluginAtoms";
import { logError, logWarn } from "../../editor/log";
import { folderReading, MAP_EXTENSIONS, normalExtension } from "../fileTypes";
import type { Rect } from "../../editor/terrain";
import { alertDialog, confirmDialog, progressPanel, promptDialog } from "../prompts";
import { createWidgets, el } from "../widgets";
import { attachTooltip } from "../tooltip";
import type { DialogHandle, PanelHandle, PickedObject, PluginInfo, FolderFile, PickFilesOptions, UiApi } from "../api";
import { directoryHandlePaths, directoryPicker, folderInputFiles, handleFile, isAbort, readFound } from "../folders";
import { loadImage, readClipboardImage } from "../images";
import { askDialog } from "../../services/documentActions";
import { saveBlob } from "../../services/mapIo";
import { countReplays } from "../../services/usage";
import type { Store, Contributions } from "./shared";
import { addStatusItem, addMapButton, startMapTool, registerOverlay, pickOnMap } from "./surfaces";
import { addMapView } from "./mapView";

/**
 * `ui.pickFiles({ directory: true })`: the browser's folder picker where it has one, else the
 * file input's folder mode; the folder's files with their paths (`folders.ts`), or none on cancel.
 * The picker's folder is walked here, one call a file, so the status bar counts it as it goes
 * (`folderReading`); the input's is walked by the browser before it answers.
 * Also how the editor itself asks for a mod's folder (`services/missingTerrain.ts`).
 */
export async function pickFolder(store: Store): Promise<FolderFile[]> {
  if (typeof document === "undefined") return [];
  const picker = directoryPicker();
  if (picker) {
    try {
      const handle = await picker({ mode: "read", id: "plugin-folder" });
      const reading = folderReading(store, handle.name);
      try {
        return await readFound(await directoryHandlePaths(handle, handle.name, reading.found), handleFile, reading.read);
      } finally {
        reading.end();
      }
    } catch (err) {
      if (isAbort(err)) return [];
      // Refused (a page in a frame, a folder the browser keeps to itself): the input may still be allowed.
      logWarn("plugins", "The folder picker failed; trying the file input's folder mode", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return new Promise<FolderFile[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.addEventListener("change", () => resolve(folderInputFiles(input.files ? [...input.files] : [])), { once: true });
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.click();
  });
}

/** `api.ui`: dialogs, panels, the status bar, the map's surfaces and pickers. */
export function uiApi(store: Store, info: PluginInfo, bag: Contributions): UiApi {
  const widgets = createWidgets();
  const ui: UiApi = {
    openDialogs: () => store.get(dialogStackAtom).map((d) => d.id),
    status: (text) => store.set(statusMessageAtom, text),
    statusText: () => store.get(statusMessageAtom),
    toast: (t) => { store.set(pushToastAtom, { kind: t.kind ?? "info", title: t.title, detail: t.detail, ttl: t.ttl }); },
    saveFile: async (data, fileName) => {
      const blob = data instanceof Blob ? data : new Blob([data as unknown as BlobPart], { type: "application/octet-stream" });
      const out = await saveBlob(blob, fileName, null);
      return out ? { route: out.route === "download" ? "download" : "picker", fileName: out.fileName } : null;
    },
    dialog: (spec) => {
      let key = -1;
      // The frame reads the title through this box, so `setTitle` reaches it without touching the spec.
      const title: TitleBox = { value: spec.title, listeners: new Set<() => void>() };
      // And what the dialog is working on, the same way: the footer shows it and disables its buttons.
      const busy: BusyBox = { value: null, listeners: new Set<() => void>() };
      const handle: DialogHandle = {
        close: () => { if (key >= 0) store.set(closeDialogAtom, key); },
        isOpen: () => store.get(dialogStackAtom).some((d) => d.key === key),
        setTitle: (t) => { title.value = t; for (const l of title.listeners) l(); },
        setBusy: (label) => { busy.value = label === false ? null : label; for (const l of busy.listeners) l(); },
      };
      key = store.set(openDialogAtom, "pluginDialog", { spec, handle, plugin: info, title, busy });
      // Closed with the plugin — and taken off the list once it closes by itself, so a plugin
      // that opens dialogs in a loop does not grow the bag for the life of the plugin.
      const sweep = bag.add(() => { if (handle.isOpen()) handle.close(); });
      const unsub = store.sub(dialogStackAtom, () => { if (!handle.isOpen()) { unsub(); sweep.dispose(); } });
      return handle;
    },
    panel: (spec) => {
      const key = nextContributionKey();
      const title: TitleBox = { value: spec.title, listeners: new Set<() => void>() };
      let closed = false;
      const handle: PanelHandle = {
        close: () => {
          if (closed) return;
          closed = true;
          store.set(pluginPanelsAtom, store.get(pluginPanelsAtom).filter((p) => p.key !== key));
          try { spec.onClose?.(); } catch (err) { logError(info.name, "A panel's onClose failed", err); }
        },
        isOpen: () => !closed,
        setTitle: (t) => { title.value = t; for (const l of title.listeners) l(); },
        maximize: (on) => {
          if (!spec.maximizable || (spec.dock ?? "float") !== "float") return;
          const next = on ?? !maximized.value;
          if (next === maximized.value) return;
          maximized.value = next;
          for (const l of maximized.listeners) l();
        },
        isMaximized: () => maximized.value,
      };
      const maximized: MaximizedBox = { value: false, listeners: new Set<() => void>() };
      store.set(pluginPanelsAtom, [...store.get(pluginPanelsAtom), { key, plugin: info, spec, handle, title, maximized }]);
      const sweep = bag.add(() => handle.close());
      const unsub = store.sub(pluginPanelsAtom, () => { if (closed) { unsub(); sweep.dispose(); } });
      return handle;
    },
    fileType: (spec) => {
      const key = nextContributionKey();
      const taken = new Set(store.get(pluginFileTypesAtom).flatMap((t) => t.extensions));
      const extensions = [...new Set(spec.extensions.map(normalExtension))].filter((ext) => {
        if (MAP_EXTENSIONS.includes(ext)) { logWarn(info.name, `ui.fileType: ${ext} is the editor's own and stays with it`); return false; }
        if (taken.has(ext)) { logWarn(info.name, `ui.fileType: ${ext} is already claimed by another plugin`); return false; }
        return true;
      });
      if (extensions.length > 0 || typeof spec.openFolder === "function") store.set(pluginFileTypesAtom, [...store.get(pluginFileTypesAtom), { key, plugin: info, spec, extensions }]);
      return bag.add(() => store.set(pluginFileTypesAtom, store.get(pluginFileTypesAtom).filter((e) => e.key !== key)));
    },
    statusItem: (spec) => addStatusItem(store, bag, info, spec),
    mapButton: (spec) => addMapButton(store, bag, info, spec),
    mapView: (spec) => addMapView(store, bag, info, spec),
    dialogSlot: (dialog, spec) => {
      const key = nextContributionKey();
      store.set(pluginDialogSlotsAtom, [...store.get(pluginDialogSlotsAtom), { key, plugin: info, dialog, spec }]);
      return bag.add(() => store.set(pluginDialogSlotsAtom, store.get(pluginDialogSlotsAtom).filter((e) => e.key !== key)));
    },
    preferencesPage: (spec) => {
      const key = nextContributionKey();
      // One page per plugin: a second registration takes the first one's place.
      store.set(pluginPreferencesPagesAtom, [...store.get(pluginPreferencesPagesAtom).filter((e) => e.plugin.id !== info.id), { key, plugin: info, spec }]);
      return bag.add(() => store.set(pluginPreferencesPagesAtom, store.get(pluginPreferencesPagesAtom).filter((e) => e.key !== key)), "preferences");
    },
    testTarget: (spec) => {
      const key = nextContributionKey();
      // One target per plugin, as with a Preferences page.
      store.set(pluginTestTargetsAtom, [...store.get(pluginTestTargetsAtom).filter((e) => e.plugin.id !== info.id), { key, plugin: info, spec }]);
      return bag.add(() => store.set(pluginTestTargetsAtom, store.get(pluginTestTargetsAtom).filter((e) => e.key !== key)));
    },
    mapTool: (spec) => startMapTool(store, bag, info, spec),
    overlay: (spec) => registerOverlay(store, bag, info, spec),
    pickFiles: ((options: PickFilesOptions = {}) => (options.directory === true ? pickFolder(store) : new Promise<File[]>((resolve) => {
      if (typeof document === "undefined") { resolve([]); return; }
      const input = document.createElement("input");
      input.type = "file";
      if (options.accept) input.accept = options.accept;
      input.multiple = options.multiple ?? false;
      input.addEventListener("change", () => { const files = input.files ? [...input.files] : []; countReplays(files, "pick"); resolve(files); }, { once: true });
      input.addEventListener("cancel", () => resolve([]), { once: true });
      input.click();
    }))) as UiApi["pickFiles"],
    pickArea: (options) => pickOnMap(store, bag, info, "area", options) as Promise<Rect | null>,
    pickTile: (options) => pickOnMap(store, bag, info, "tile", options) as Promise<{ x: number; y: number } | null>,
    pickObject: (options) => pickOnMap(store, bag, info, "object", options) as Promise<PickedObject | null>,
    loadImage,
    readClipboardImage,
    confirm: (message, options) => confirmDialog(ui.dialog, message, options),
    alert: (message, options) => alertDialog(ui.dialog, message, options),
    prompt: (message, options) => promptDialog(ui.dialog, message, options),
    progress: (label, options) => progressPanel(ui.panel, label, options),
    tooltip: (target, content, options) => {
      if (!(target instanceof HTMLElement) || (typeof content !== "string" && typeof content !== "function")) throw new Error("ui.tooltip needs an element and its content.");
      const tip = attachTooltip(target, content, options);
      const sweep = bag.add(() => tip.dispose());
      return { refresh: tip.refresh, hide: tip.hide, dispose: () => sweep.dispose() };
    },
    el,
    widgets,
    open: (dialog, payload) => { store.set(openDialogAtom, dialog, payload); },
    ask: (dialog, payload) => askDialog(store, dialog, payload),
    repaint: () => store.set(viewportRepaintAtom, store.get(viewportRepaintAtom) + 1),
  };
  return ui;
}
