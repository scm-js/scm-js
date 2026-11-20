/**
 * `api.document` and `api.sync`: the map in front, opening and making maps, saving, build steps and sharing.
 */
import { mapFileHandleAtom, mapFilePathAtom, mapModifiedAtom, mapOriginAtom, saveOptionsAtom } from "../../atoms/editorAtoms";
import { activeDocumentIdAtom, archiveExtrasAtom, archiveStoredAtom, builtByAtom, changeTilesetAtom, documentTabsAtom, redoAtom, redoStackAtom, resizeDocumentAtom, scenarioAtom, tilesetFileNameAtom, undoAtom, undoStackAtom, viewOnlyAtom } from "../../atoms/documentAtoms";
import { nextContributionKey, pluginBeforeBuildAtom, pluginBuildStepsAtom } from "../../atoms/pluginAtoms";
import { logInfo } from "../../app/log";
import { TILESETS } from "../../data/tilesets";
import { scenarioDescription, scenarioName, tilesetIndex } from "../../formats/chk/scenario";
import { ensureTileset, ensureTileset as loadTilesetFiles, TILESET_FILENAMES } from "../../formats/tileset/load";
import type { BeforeBuildSpec, BuildStepSpec, Disposable, PluginInfo, NewDocumentOptions, OpenDocumentOptions, DocumentApi, SyncApi } from "../api";
import { activateDocumentIn, askDialog, closeDocumentIn, guardedAction, newMapInto, openFileInto, saveDocument } from "../../services/documentActions";
import { DEFAULT_SAVE_OPTIONS, defaultSaveOptions, referencedMembers } from "../../editor/save";
import { unreachableStored, withoutUnreachable } from "../../formats/mpq/scm";
import { buildOutgoing } from "../../services/mapBuild";
import { outgoingExtras } from "../../services/mapDataSet";
import { writeTestFile } from "../../services/testMap";
import { currentSync, startSync } from "../../services/sync";
import { writeMapBytes } from "../../services/mapIo";
import { count, pluginName } from "../../services/usage";
import { DEFAULT_IMAGE_OPTIONS, exportMapImage } from "../../services/mapImage";
import { type Store, type Contributions, EMPTY_RESULT, DEACTIVATED_NOTE, assertWritable } from "./shared";
import { runTransaction } from "./transaction";
import { runUpdate } from "./update";
import { sectionsApi } from "./sections";

/**
 * `document.open` for a plugin: the bytes become a `File`, and the open goes through the
 * same unsaved-changes gate as File ▸ Open — the Close Scenario dialog when the map is
 * modified and Preferences say to ask. The dialog's `done` callback answers once the file
 * was opened (or failed to read); a dismissal — Cancel, Escape, the × — is seen from the
 * dialog stack: the entry leaves it without `taken` set. (An unmount effect in the dialog
 * would be simpler, but React's development double-mount runs it once at mount.)
 */
function openDocument(store: Store, source: File | Blob | Uint8Array, fileName?: string, options: OpenDocumentOptions = {}): Promise<boolean> {
  const name = fileName ?? (source instanceof File ? source.name : "map.scx");
  const file = source instanceof File && !fileName
    ? source
    : new File([source as unknown as BlobPart], name, { type: "application/octet-stream" });
  const { into, viewOnly } = options;
  if (viewOnly) {
    // Beside whatever is open, so nothing is replaced and nothing needs asking about.
    const label = typeof viewOnly === "object" && typeof viewOnly.label === "string" && viewOnly.label.trim() ? viewOnly.label.trim() : null;
    return openFileInto(store, file, null, "new", { label });
  }
  return guardedAction(store, () => openFileInto(store, file, null, into), (done) => ({ action: "open", file, into, done }));
}

/** `document.create`: File ▸ New through the same gate. */
function createDocument(store: Store, options: NewDocumentOptions): Promise<boolean> {
  const { into, ...rest } = options;
  const full = { name: "Untitled Scenario", description: "", ...rest };
  // As Resize: Remastered refuses a side past 256, and 1.16.1 runs past its terrain buffers.
  if (full.width !== undefined) full.width = Math.max(1, Math.min(256, Math.round(full.width)));
  if (full.height !== undefined) full.height = Math.max(1, Math.min(256, Math.round(full.height)));
  return guardedAction(store, () => newMapInto(store, full, false, into), (done) => ({ action: "new", options: full, into, done }));
}

/** `api.document.buildSteps.add`: kept on `pluginBuildStepsAtom`, in activation order, until disposed or the plugin goes. */
export function addBuildStep(store: Store, bag: Contributions, info: PluginInfo, spec: BuildStepSpec): Disposable {
  if (!spec || typeof spec.id !== "string" || !spec.id || typeof spec.applies !== "function" || typeof spec.run !== "function") throw new Error("buildSteps.add needs an id, applies() and run().");
  const key = nextContributionKey();
  // The same id again replaces the earlier registration: a plugin re-registering after a settings change.
  const others = store.get(pluginBuildStepsAtom).filter((e) => !(e.plugin.id === info.id && e.spec.id === spec.id));
  store.set(pluginBuildStepsAtom, [...others, { key, plugin: info, spec: { ...spec, label: String(spec.label || info.name) } }]);
  return bag.add(() => store.set(pluginBuildStepsAtom, store.get(pluginBuildStepsAtom).filter((e) => e.key !== key)));
}

/** `api.document.buildSteps.before`: kept on `pluginBeforeBuildAtom` until disposed or the plugin goes. */
export function addBeforeBuild(store: Store, bag: Contributions, info: PluginInfo, spec: BeforeBuildSpec): Disposable {
  if (!spec || typeof spec.id !== "string" || !spec.id || typeof spec.run !== "function") throw new Error("buildSteps.before needs an id and run().");
  const key = nextContributionKey();
  const others = store.get(pluginBeforeBuildAtom).filter((e) => !(e.plugin.id === info.id && e.spec.id === spec.id));
  store.set(pluginBeforeBuildAtom, [...others, { key, plugin: info, spec: { ...spec, label: String(spec.label || info.name) } }]);
  return bag.add(() => store.set(pluginBeforeBuildAtom, store.get(pluginBeforeBuildAtom).filter((e) => e.key !== key)));
}

/** `api.document`: the map in front — what it is, the three ways to write to it, and opening, saving and closing maps. */
export function documentApi(store: Store, info: PluginInfo, bag: Contributions, gone: (what: string) => boolean): DocumentApi {
  const scenario = () => store.get(scenarioAtom);
  return {
    isOpen: () => scenario() !== null,
    info: () => {
      const scn = scenario();
      if (!scn) return null;
      return {
        name: scenarioName(scn) ?? "",
        description: scenarioDescription(scn) ?? "",
        width: scn.width,
        height: scn.height,
        tileset: TILESETS[tilesetIndex(scn)].id,
        era: scn.era,
        version: scn.fileVersion,
        fileName: store.get(mapFilePathAtom),
        modified: store.get(mapModifiedAtom),
        viewOnly: store.get(viewOnlyAtom) !== null,
      };
    },
    scenario,
    id: () => (scenario() ? store.get(activeDocumentIdAtom) : null),
    list: () => store.get(documentTabsAtom).map((d) => ({ ...d })),
    activate: (id) => !gone("document.activate") && activateDocumentIn(store, id),
    edit: (label, build) => {
      if (gone("document.edit")) return { ...EMPTY_RESULT, notes: [DEACTIVATED_NOTE] };
      const result = runTransaction(store, label, build);
      // Counts, never the change lists: an entry that held them would pin every cell
      // record it touched for as long as the ring holds the line (`app/log.ts`).
      logInfo(info.name, `Edit: ${label}`, {
        changed: result.changed, tiles: result.tiles || undefined, isom: result.isom || undefined,
        units: result.units || undefined, doodads: result.doodads || undefined, sprites: result.sprites || undefined,
        locations: result.locations || undefined, fog: result.fog || undefined,
        notes: result.notes.length > 0 ? result.notes.join("; ") : undefined,
      });
      return result;
    },
    update: (label, build) => {
      if (gone("document.update")) return { changed: false, sections: [], notes: [DEACTIVATED_NOTE] };
      const result = runUpdate(store, label, build);
      logInfo(info.name, `Update: ${label}`, {
        changed: result.changed, sections: result.sections.join(",") || undefined,
        notes: result.notes.length > 0 ? result.notes.join("; ") : undefined,
      });
      return result;
    },
    undo: () => store.set(undoAtom),
    redo: () => store.set(redoAtom),
    history: () => {
      const u = store.get(undoStackAtom), r = store.get(redoStackAtom);
      return { undo: u.at(-1)?.label ?? null, redo: r.at(-1)?.label ?? null, undoDepth: u.length, redoDepth: r.length };
    },
    open: (source, fileName, options) => (gone("document.open") ? Promise.resolve(false) : openDocument(store, source, fileName, options)),
    create: (options) => (gone("document.create") ? Promise.resolve(false) : createDocument(store, options)),
    resize: (options) => {
      const scn = scenario();
      if (!scn || gone("document.resize")) return null;
      assertWritable(store);
      const width = Math.max(1, Math.min(256, Math.round(options.width)));
      const height = Math.max(1, Math.min(256, Math.round(options.height)));
      const anchor = Math.max(0, Math.min(8, Math.round(options.anchor ?? 4)));
      return store.set(resizeDocumentAtom, { width, height, anchor, terrainId: options.terrainId, clampLocations: options.clampLocations ?? true });
    },
    test: async (bytes, fileName, options = {}) => {
      if (gone("document.test")) return null;
      if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error("document.test needs the map's bytes.");
      return writeTestFile(store, bytes, String(fileName || "map.scx"), { launch: options.launch, noDownload: true });
    },
    export: async (options = {}) => {
      const scn = scenario();
      if (!scn) return null;
      const remembered = store.get(saveOptionsAtom) ?? defaultSaveOptions(scn, store.get(mapOriginAtom), store.get(mapFilePathAtom));
      const format = options.format ?? remembered.format;
      const name = options.fileName ?? store.get(mapFilePathAtom) ?? `${scenarioName(scn) || "Untitled Scenario"}.${format}`;
      const saveOptions = { ...DEFAULT_SAVE_OPTIONS, ...remembered, ...options.saveOptions, format };
      const extras = store.get(archiveExtrasAtom), stored = store.get(archiveStoredAtom);
      // A failed step answers the map without it, as Save does; the log has the reason.
      const bytes = options.built === false
        ? await writeMapBytes(scn, { format, extras: outgoingExtras(store, extras), stored, options: saveOptions })
        : (await buildOutgoing(store, { options: saveOptions, fileName: name, purpose: "export" })).bytes;
      return new File([bytes as unknown as BlobPart], name, { type: "application/octet-stream" });
    },
    save: async (options = {}) => {
      const scn = scenario();
      if (!scn || gone("document.save")) return false;
      if (!options.copy) assertWritable(store);
      const path = store.get(mapFilePathAtom);
      if (!options.copy && path) {
        const saveOptions = store.get(saveOptionsAtom) ?? defaultSaveOptions(scn, store.get(mapOriginAtom), path);
        return saveDocument(store, { fileName: path, handle: store.get(mapFileHandleAtom), options: saveOptions, copy: false });
      }
      return askDialog(store, "saveAs", { copy: options.copy === true });
    },
    saveAs: (options = {}) => {
      if (!scenario() || gone("document.saveAs")) return Promise.resolve(false);
      if (options.copy !== true) assertWritable(store);
      return askDialog(store, "saveAs", { copy: options.copy === true });
    },
    close: (id) => (!scenario() || gone("document.close") ? Promise.resolve(false) : closeDocumentIn(store, id)),
    changeTileset: async (options) => {
      if (!scenario() || gone("document.changeTileset")) return null;
      assertWritable(store);
      const era = Math.max(0, TILESETS.findIndex((t) => t.id === options.tileset));
      try { await loadTilesetFiles(TILESET_FILENAMES[era]); } catch { /* the fill uses the base ids without the graphics */ }
      if (!scenario() || gone("document.changeTileset")) return null;
      return store.set(changeTilesetAtom, { tileset: options.tileset, terrainId: options.terrainId, keepTiles: options.keepTiles });
    },
    renderImage: async (options = {}) => {
      const scn = scenario();
      if (!scn || typeof document === "undefined") return null;
      try {
        await ensureTileset(store.get(tilesetFileNameAtom));
      } catch {
        return null;
      }
      return exportMapImage(scn, { ...DEFAULT_IMAGE_OPTIONS, ...options });
    },
    extras: {
      list: () => (scenario() ? [...store.get(archiveExtrasAtom).keys()] : []),
      get: (name) => (scenario() ? store.get(archiveExtrasAtom).get(name) ?? null : null),
      set: (name, bytes) => {
        if (!scenario() || gone("document.extras.set")) return;
        assertWritable(store);
        const next = new Map(store.get(archiveExtrasAtom));
        next.set(name, bytes);
        store.set(archiveExtrasAtom, next);
        store.set(mapModifiedAtom, true);
      },
      remove: (name) => {
        if (!scenario() || !store.get(archiveExtrasAtom).has(name) || gone("document.extras.remove")) return false;
        assertWritable(store);
        const next = new Map(store.get(archiveExtrasAtom));
        next.delete(name);
        store.set(archiveExtrasAtom, next);
        store.set(mapModifiedAtom, true);
        return true;
      },
    },
    archive: {
      unreachable: () => {
        const scn = scenario();
        return scn ? unreachableStored(store.get(archiveStoredAtom), referencedMembers(scn)) : { count: 0, size: 0 };
      },
      dropUnreachable: (options = {}) => {
        const scn = scenario(), before = store.get(archiveStoredAtom);
        const none = { count: 0, undo: () => {} };
        if (!scn || !before || gone("document.archive.dropUnreachable")) return none;
        const { count } = unreachableStored(before, referencedMembers(scn));
        if (count === 0) return none;
        assertWritable(store);
        const after = withoutUnreachable(before, referencedMembers(scn));
        const doc = store.get(activeDocumentIdAtom);
        store.set(archiveStoredAtom, after);
        if (!options.asOpened) store.set(mapModifiedAtom, true);
        return {
          count,
          // Only onto the same map, and only while nothing else has replaced what was set.
          undo: () => {
            if (store.get(activeDocumentIdAtom) !== doc || store.get(archiveStoredAtom) !== after) return;
            store.set(archiveStoredAtom, before);
            if (!options.asOpened) store.set(mapModifiedAtom, true);
          },
        };
      },
    },
    sections: sectionsApi(store, () => !bag.disposed),
    buildSteps: {
      add: (spec) => addBuildStep(store, bag, info, spec),
      before: (spec) => addBeforeBuild(store, bag, info, spec),
      builtBy: () => store.get(builtByAtom)?.map((b) => ({ ...b })) ?? null,
    },
  };
}

/** `api.sync`: sharing the map in front. */
export function syncApi(store: Store, info: PluginInfo, bag: Contributions, gone: (what: string) => boolean): SyncApi {
  return {
    start: (options) => {
      if (gone("sync.start")) return null;
      // Sharing is editing together; a view-only map is shared by sharing an editable copy.
      if (store.get(scenarioAtom)) assertWritable(store);
      const session = startSync(store, options);
      if (session) { bag.add(() => session.stop()); count("map.share", { plugin: pluginName(info.source) }); }
      return session;
    },
    current: () => currentSync(store),
  };
}
