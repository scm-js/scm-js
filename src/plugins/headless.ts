/**
 * The plugin host without the editor: a Jotai store holding one document and a `PluginApi` over it, for a plugin or
 * a script run under Node (`scmjs map run`). The API is the editor's own (`host.ts#createPluginApi`); what differs
 * is around it. There is no page, so the surfaces that would show something — the status line, toasts, the log —
 * are reported to `sinks` instead, dialogs and panels register and show nothing, and `pickFiles` answers none. A
 * map goes in as an `OpenedMap` and comes back out as one (`document()`), with whether the plugin changed it, so
 * the caller writes it where it wants to; `api.document.save()` is the editor's and does nothing useful here.
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
import type { PluginApi, PluginInfo, PluginManifest } from "./api";
import { pluginIdOf } from "./api";
import { pluginCommandsAtom } from "../atoms/pluginAtoms";
import { checkApiVersion, Contributions, createPluginApi, qualifyCommand, resolveActivate, type Store } from "./host";
import { loadPlugin, parseSpec, PluginLoadError, type LoaderDeps, type PluginSource } from "./loader";

export { parseSpec, PluginLoadError };
export { transpileTs, type TS } from "./transpile";
export type { LoaderDeps, PluginSource, Toast, LogEntry, OpenedMap };

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
  if (sinks.log) {
    let count = logEntries().length;
    stops.push(subscribeLog(() => { const all = logEntries(); for (const e of all.slice(count)) sinks.log!(e); count = all.length; }));
  }
  return () => { for (const stop of stops) stop(); };
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
