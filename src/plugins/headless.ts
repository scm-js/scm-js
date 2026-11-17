/**
 * The plugin host without the editor: a Jotai store holding one document and a `PluginApi` over it, for a plugin or
 * a script run under Node (`scmjs map run`), or over it with no plugin at all (`headlessApi`, for `scmjs map edit`).
 * The API is the editor's own (`host/pluginApi.ts#createPluginApi`); what differs is around it. There is no page, so the
 * surfaces that would show something — the status line, toasts, the log —
 * are reported to `sinks` instead, dialogs and panels register and show nothing, and `pickFiles` answers none. A
 * map goes in as an `OpenedMap` and comes back out as one (`document()`), with whether the plugin changed it, so
 * the caller writes it where it wants to; `api.document.save()` resolves true and writes nothing (the caller
 * writes the map), `saveAs()` resolves false (no dialog).
 *
 * Loading code is the editor's loader (`loader.ts`) with deps the caller brings (`LoaderDeps`: the command's read
 * files from disk, transpile with the TypeScript it found, and write modules to a folder to import them). Nothing
 * here is Node's: this file is in the editor's tree and type-checks with it; `cli/src/run.ts` is the Node half.
 */
import { createStore } from "jotai";
import { archiveExtrasAtom, archiveStoredAtom, builtByAtom, loadDocumentAtom, scenarioAtom } from "../atoms/documentAtoms";
import { mapModifiedAtom } from "../atoms/editorAtoms";
import { statusMessageAtom, toastsAtom, type Toast } from "../atoms/uiAtoms";
import { logEntries, subscribeLog, type LogEntry } from "../editor/log";
import type { OpenedMap } from "../editor/mapFile";
import type { EditTransaction, PluginApi, PluginInfo, PluginManifest } from "./api";
import { pluginIdOf } from "./api";
import { pluginCommandsAtom } from "../atoms/pluginAtoms";
import { checkApiVersion, Contributions, createPluginApi, qualifyCommand, resolveActivate, type Store } from "./host";
import { loadPlugin, parseSpec, PluginLoadError, type LoaderDeps, type PluginSource } from "./loader";

import { tilesetIndex } from "../formats/chk/scenario";
import { DEFAULT_PROFILE } from "../gamedata/profiles";
import { setAssetSource } from "../gamedata/source";
import { ensureTileset, TILESET_FILENAMES } from "../formats/tileset/load";
import { getUnitAssets } from "../formats/units/load";
import { dropDecodedData } from "../services/gameData";

export { parseSpec, PluginLoadError };
export { transpileTs, type TS } from "./transpile";
export type { LoaderDeps, PluginSource, Toast, LogEntry, OpenedMap, PluginApi, EditTransaction };

/** Where the surfaces the editor would draw go instead. Each is optional. */
export interface HeadlessSinks {
  status?(text: string): void;
  toast?(toast: Toast): void;
  /** Every line the editor's log gets while the plugin runs, the plugin's own among them. */
  log?(entry: LogEntry): void;
}

export interface HeadlessHost {
  store: Store;
  api: PluginApi;
  info: PluginInfo;
  manifest: PluginManifest;
  /** The document as the plugin left it, in the shape it came in. */
  document(): OpenedMap;
  /** Whether the plugin changed the map (the editor's modified flag). */
  modified(): boolean;
  /** Run one of the plugin's commands, by its id or `plugin.id`; what the command returned, awaited. Throws when there is none. */
  command(id: string, ...args: unknown[]): Promise<unknown>;
  /** The plugin's deactivation and the sweep of its contributions; the sinks stop. */
  dispose(): Promise<void>;
}

/** A store with the map in it, as File ▸ Open would leave it. */
export function headlessStore(doc: OpenedMap): Store {
  const store = createStore();
  store.set(loadDocumentAtom, { scenario: doc.scenario, extras: doc.extras, stored: doc.stored ?? null, fileName: doc.fileName, origin: doc.origin ?? null, builtBy: doc.builtBy ?? null, reason: "open" });
  return store;
}

/** The store's document in the shape it was opened in. */
export function documentOf(store: Store, opened: OpenedMap): OpenedMap {
  const scenario = store.get(scenarioAtom);
  if (!scenario) throw new Error("The plugin closed the map.");
  return { ...opened, scenario, extras: store.get(archiveExtrasAtom), stored: store.get(archiveStoredAtom), builtBy: store.get(builtByAtom) };
}

/** Report the status line, the toasts and the log to the sinks until the returned function is called. */
export function attachSinks(store: Store, sinks: HeadlessSinks): () => void {
  const stops: (() => void)[] = [];
  if (sinks.status) {
    let last = store.get(statusMessageAtom);
    stops.push(store.sub(statusMessageAtom, () => { const now = store.get(statusMessageAtom); if (now !== last) { last = now; sinks.status!(now); } }));
  }
  if (sinks.toast) {
    const seen = new Set(store.get(toastsAtom).map((t) => t.id));
    stops.push(store.sub(toastsAtom, () => { for (const t of store.get(toastsAtom)) if (!seen.has(t.id)) { seen.add(t.id); sinks.toast!(t); } }));
  }
  // The log wakes its listeners on a timer (a burst is one wake), so an entry written just before the plugin is
  // disposed would reach the sink or not by timing alone: detaching reads what is left first.
  let flush = () => {};
  if (sinks.log) {
    let count = logEntries().length;
    flush = () => { const all = logEntries(); for (const e of all.slice(count)) sinks.log!(e); count = all.length; };
    stops.push(subscribeLog(flush));
  }
  return () => { flush(); for (const stop of stops) stop(); };
}

/* ── A copy of the game ─────────────────────────────────── */

/**
 * A copy of the game the caller opened (the command's is the person's installation, `cli/src/gamefiles.ts`): a file
 * by the game's own name for it (`tileset\jungle.cv5`, `arr\units.dat`), null when the copy has none.
 */
export interface GameCopy {
  /** What the copy is, for a person: the source's label. */
  label: string;
  read?(member: string): Promise<Uint8Array | null>;
  /**
   * In place of `read`, for a copy that is already an extraction (the editor's own data set, lent through a link):
   * a file by the path the loaders ask for (`tileset/jungle.cv5`, `unit/manifest.json`), the lists the extraction
   * wrote among them.
   */
  readStored?(path: string): Promise<Uint8Array | null>;
}

/** What of a copy is in memory for a map: its tileset's tables and doodads, and the unit tables. */
export interface GameCopyLoaded { tileset: boolean; units: boolean }

let copyInUse: GameCopy | null = null;

/**
 * Make `copy` the game data every host in this process reads, and load what `doc` needs of it before a host is
 * made: the map's tileset (its terrain table, megatiles and doodads, with no picture: there is no page to draw on,
 * `atlas.ts#buildAtlas`) and the unit tables. Without this a host has no game data at all, and what reads the
 * game's files does nothing and says so in a note: terrain by type, doodads, the placement checks.
 *
 * The copy is a `reader` source with nothing under it, so the editor's own loaders do the reading and decoding, a
 * plugin's `api.tileset.load()` and `api.data.load()` answer true, and a tileset change reads the next tileset from
 * the same copy. The decoded files are the module's (one process, one copy): a second call with the same copy reads
 * only a tileset not yet in memory, and another copy drops what the first decoded. A part the copy lacks is false
 * in the answer, and the host does without it as before.
 */
export async function loadGameCopy(copy: GameCopy, doc: OpenedMap): Promise<GameCopyLoaded> {
  if (copyInUse !== copy) {
    dropDecodedData();
    setAssetSource({ kind: "reader", profile: DEFAULT_PROFILE, label: copy.label, tried: [], reader: { base: null, read: (path, context) => (copy.readStored ? copy.readStored(path) : context.member && copy.read ? copy.read(context.member) : null) } });
    copyInUse = copy;
  }
  const [tileset, units] = await Promise.all([
    ensureTileset(TILESET_FILENAMES[tilesetIndex(doc.scenario)]).then(() => true, () => false),
    getUnitAssets().then(() => true, () => false),
  ]);
  return { tileset, units };
}

/**
 * Take the copy away again: the hosts made from here on have no game data, as before any copy was given. For a
 * caller that runs many maps in one process (the command's MCP server) and must not let one call's copy change
 * what the next call does. What was decoded is dropped; the caller keeps its copy open and gives it again when asked.
 */
export function dropGameCopy(): void {
  if (!copyInUse) return;
  dropDecodedData();
  setAssetSource({ kind: "none", profile: DEFAULT_PROFILE, label: "", tried: [] });
  copyInUse = null;
}

/** The host for a function: the API over one map, with no plugin loaded. */
export interface HeadlessApi {
  store: Store;
  api: PluginApi;
  /** The document as the caller's edits left it, in the shape it came in. */
  document(): OpenedMap;
  /** Whether the map was changed (the editor's modified flag). */
  modified(): boolean;
  /** The sweep of what was registered through the API; the sinks stop. */
  dispose(): void;
}

/**
 * The plugin API over a map for a caller that is not a plugin: a command of the command line that changes a map
 * through `api.document.edit`, as a plugin would, with nothing to load or activate (`scmjs map edit`). `name` is
 * what the log and the undo entry call the caller.
 */
export function headlessApi(doc: OpenedMap, name: string, sinks: HeadlessSinks = {}): HeadlessApi {
  const store = headlessStore(doc);
  const detach = attachSinks(store, sinks);
  const bag = new Contributions();
  const api = createPluginApi(store, { id: pluginIdOf({ name }), name, source: `builtin:${name}` }, bag);
  api.document.save = async () => true;
  api.document.saveAs = async () => false;
  return {
    store, api,
    document: () => documentOf(store, doc),
    modified: () => store.get(mapModifiedAtom),
    dispose: () => { bag.dispose(); detach(); },
  };
}

/**
 * Load the plugin and activate it against the map, as the editor would: the manifest read and checked first, the
 * module imported, `activate(api)` awaited. Throws what the loader or the plugin threw, worded by them.
 */
export async function runHeadless(source: PluginSource | string, doc: OpenedMap, deps: LoaderDeps, sinks: HeadlessSinks = {}): Promise<HeadlessHost> {
  const spec = typeof source === "string" ? source : source.kind === "builtin" ? `builtin:${source.name}` : source.display;
  const store = headlessStore(doc);
  const detach = attachSinks(store, sinks);
  const bag = new Contributions();
  let deactivate: unknown;
  try {
    const { manifest, icon, module } = await loadPlugin(source, deps, { accept: checkApiVersion });
    const info: PluginInfo = { id: pluginIdOf(manifest), name: manifest.name, source: spec, version: manifest.version, icon };
    const api = createPluginApi(store, info, bag);
    // Saving is the caller's, once the plugin is done (`scmjs map run` writes the map): Save resolves as if it wrote,
    // and Save As has no dialog to show. The editor's would reach for the page's file APIs, which are not here.
    api.document.save = async () => true;
    api.document.saveAs = async () => false;
    // A script that hands toast a plain string means it as the title, as a reader would.
    const toast = api.ui.toast;
    api.ui.toast = (x) => toast(typeof x === "string" ? { title: x } : x);
    deactivate = await resolveActivate(module)(api);
    const host: HeadlessHost = {
      store, api, info, manifest,
      document: () => documentOf(store, doc),
      modified: () => store.get(mapModifiedAtom),
      command: async (id, ...args) => {
        // The command itself, not `runCommand`: that logs a throw and answers undefined, and a terminal wants the throw.
        const full = qualifyCommand(info.id, id);
        const command = store.get(pluginCommandsAtom).find((c) => c.id === full);
        if (!command) {
          const own = store.get(pluginCommandsAtom).filter((c) => c.pluginId === info.id).map((c) => c.id);
          throw new Error(`${manifest.name} has no command "${id}"${own.length ? `; it has ${own.join(", ")}` : ""}.`);
        }
        if (command.enabled && !command.enabled()) throw new Error(`The command ${full} is not enabled for this map.`);
        return await command.run(...args);
      },
      dispose: async () => {
        try { if (typeof deactivate === "function") await deactivate(); } finally { bag.dispose(); detach(); }
      },
    };
    return host;
  } catch (err) {
    bag.dispose();
    detach();
    throw err;
  }
}
