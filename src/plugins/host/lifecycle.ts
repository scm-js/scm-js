/**
 * Starting and stopping plugins: loading, `activate`, the bag swept on deactivation, and reading a manifest
 * without running the plugin.
 */
import { t } from "../../i18n";
import { installedPluginsAtom, pluginCodeAtom, pluginManifestCacheAtom, pluginRuntimesAtom, type CachedManifest, type PluginInstall, type PluginRuntime } from "../../atoms/pluginAtoms";
import { logError, logInfo, logWarn } from "../../editor/log";
import { installFor, requirementsOf } from "../requires";
import { specLabel } from "../failures";
import { pluginIdOf, PLUGIN_API_VERSION, type Deactivate, type PluginIcon, type PluginInfo, type PluginManifest, type PluginModule } from "../api";
import { loadPlugin, parseSpec, recordingDeps, resolvePlugin, storedDeps, type LoaderDeps } from "../loader";
import { BUILTIN_PLUGINS } from "../builtin";
import { pluginKey } from "../defaults";
import { transpileInBackground } from "../transpileClient";
import { noteModuleSource, pluginName } from "../../services/usage";
import { Contributions, type Store } from "./shared";
import { createPluginApi } from "./pluginApi";
import { effectiveInstalls } from "./installList";

interface Active {
  token: number;
  bag: Contributions;
  deactivate?: Deactivate;
  /** The load in flight, so a second caller awaits the first rather than a resolved promise. */
  promise?: Promise<void>;
}

const actives = new WeakMap<Store, Map<string, Active>>();

let activationSeq = 0;

function activeMap(store: Store): Map<string, Active> {
  let m = actives.get(store);
  if (!m) { m = new Map(); actives.set(store, m); }
  return m;
}

function setRuntime(store: Store, spec: string, patch: Partial<PluginRuntime>) {
  const all = store.get(pluginRuntimesAtom);
  const prev = all[spec] ?? { spec, status: "disabled" as const, manifest: null, icon: null, error: null, contributions: { menu: 0, contextMenu: 0, hotkeys: 0, events: 0, preferences: 0 } };
  store.set(pluginRuntimesAtom, { ...all, [spec]: { ...prev, ...patch } });
}

function runDeactivate(d: Deactivate | undefined, spec: string) {
  try {
    if (typeof d === "function") d();
    else if (d && typeof d === "object" && typeof d.dispose === "function") d.dispose();
  } catch (err) {
    logError("plugins", "A plugin's deactivate failed", err, { spec }, { step: "deactivate", plugin: pluginName(spec) });
  }
}

/** The entry module's `activate`, whichever way it was exported. */
export function resolveActivate(module: unknown): PluginModule["activate"] {
  const m = module as Record<string, unknown> | null;
  const candidates = [m?.default, (m?.default as Record<string, unknown> | undefined)?.activate, m?.activate];
  for (const c of candidates) if (typeof c === "function") return c as PluginModule["activate"];
  throw new Error(t("The plugin's entry module exports no activate function ({example}).", { example: "export default function activate(api) {…}" }));
}

/** What the browser build uses to fetch, transpile and import plugin code. */
export function browserLoaderDeps(): LoaderDeps {
  return {
    fetchText: async (url) => {
      const res = await fetch(url, { cache: "no-cache" });
      // The callers all name the URL they asked for, so this does not: "Could not fetch
      // <url>: 404 fetching <url>" is the same address twice in one line.
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
      return res.text();
    },
    transpile: (source, fileName) => transpileInBackground(source, fileName),
    createModuleUrl: (code, sourceUrl) => {
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      // So a frame in it can be counted as the file it came from (`services/usage.ts`).
      noteModuleSource(url, sourceUrl);
      return url;
    },
    importModule: async (url) => {
      try { return await import(/* @vite-ignore */ url); } finally { if (url.startsWith("blob:")) URL.revokeObjectURL(url); }
    },
    builtins: BUILTIN_PLUGINS,
  };
}

/** What the installed list says about one spec (defaults merged in), or nothing. */
function installOf(store: Store, spec: string): PluginInstall | undefined {
  return effectiveInstalls(store.get(installedPluginsAtom)).find((p) => p.spec === spec);
}

/** A snapshot larger than this is not worth a `localStorage` slot; the copy is skipped and the plugin stays remote. */
const MAX_SNAPSHOT = 2 * 1024 * 1024;

/**
 * The deps one activation should use.
 *
 * A plugin the user asked to keep a copy of (`PluginInstall.local`) loads out of
 * `pluginCodeAtom` and touches nothing else; until there *is* a copy it loads normally
 * with every fetch recorded, and the recording is stored on success. Everything else
 * loads straight from `deps`, and `files` stays empty.
 */
function loadDepsFor(store: Store, spec: string, deps: LoaderDeps): { deps: LoaderDeps; files: Record<string, string> | null; from: "network" | "browser" } {
  if (!installOf(store, spec)?.local) return { deps, files: null, from: "network" };
  const snapshot = store.get(pluginCodeAtom)[spec];
  if (snapshot && Object.keys(snapshot.files).length > 0) return { deps: storedDeps(deps, snapshot.files), files: null, from: "browser" };
  const files: Record<string, string> = {};
  return { deps: recordingDeps(deps, files), files, from: "network" };
}

/** Keep what a load fetched, so the next one does not have to. Too big to store is not an error, just no copy. */
function storeSnapshot(store: Store, spec: string, files: Record<string, string>) {
  const size = Object.entries(files).reduce((n, [url, text]) => n + url.length + text.length, 0);
  if (size === 0) return;
  if (size > MAX_SNAPSHOT) {
    logWarn("plugins", `${specLabel(spec)}: ${size} characters is too much to keep in browser storage; it will load from its address.`);
    return;
  }
  store.set(pluginCodeAtom, { ...store.get(pluginCodeAtom), [spec]: { files, at: Date.now(), size } });
}

/** Throw away the copy of one plugin's code (Reload, Remove, turning the option off). */
export function forgetSnapshot(store: Store, spec: string) {
  const all = store.get(pluginCodeAtom);
  if (!(spec in all)) return;
  const next = { ...all };
  delete next[spec];
  store.set(pluginCodeAtom, next);
}

/**
 * Load and activate a plugin; a no-op when it is already active or loading.
 *
 * "No-op" still answers with the load that is in flight, not an immediately resolved
 * promise: React mounts this hook's effect twice in development, so the second pass finds
 * every spec already loading, and a caller that awaited *that* would read the runtimes
 * before a single fetch had finished — which is what made the notice for a plugin that
 * failed to load never appear (`hooks/usePlugins.ts`).
 */
export function activatePlugin(store: Store, spec: string, deps: LoaderDeps = browserLoaderDeps()): Promise<void> {
  const map = activeMap(store);
  const already = map.get(spec);
  if (already) return already.promise ?? Promise.resolve();
  const entry: Active = { token: ++activationSeq, bag: new Contributions() };
  map.set(spec, entry);
  entry.promise = loadAndRun(store, spec, deps, entry);
  return entry.promise;
}

/** The one compatibility rule: a manifest may not ask for a newer API than the host provides. */
export function checkApiVersion(manifest: PluginManifest): void {
  if (manifest.api !== undefined && manifest.api > PLUGIN_API_VERSION) {
    throw new Error(t("The plugin needs plugin API {needed}; this editor provides {provided}.", { needed: manifest.api, provided: PLUGIN_API_VERSION }));
  }
}

/** The activation itself, once the slot in the active map is taken. */
async function loadAndRun(store: Store, spec: string, deps: LoaderDeps, entry: Active): Promise<void> {
  const map = activeMap(store);
  const { bag } = entry;
  setRuntime(store, spec, { status: "loading", error: null });
  const stillWanted = () => map.get(spec) === entry;
  const local = loadDepsFor(store, spec, deps);
  // Which half failed, for the error's count: fetching, checking and importing the code, or the plugin's own `activate`.
  let step = "load";
  try {
    // The manifest is read first and the module imported only once it is accepted: a plugin
    // this editor cannot run has its top-level code never evaluated.
    const { manifest, icon, module } = await loadPlugin(spec, local.deps, { accept: checkApiVersion });
    if (!stillWanted()) return;
    // A requirement that is not in the list is the install path's job, not a reason to
    // refuse the plugin: it starts, and its `services.watch` sees no provider.
    for (const r of requirementsOf(manifest)) {
      if (!installFor(r, effectiveInstalls(store.get(installedPluginsAtom)), pluginKey)) logWarn("plugins", `${manifest.name} requires ${r}, which is not installed`, { spec, required: r });
    }
    if (local.files) storeSnapshot(store, spec, local.files);
    const info: PluginInfo = { id: pluginIdOf(manifest), name: manifest.name, source: spec, version: manifest.version, icon };
    setRuntime(store, spec, { manifest, icon: icon ?? null });
    const api = createPluginApi(store, info, bag);
    const activate = resolveActivate(module);
    step = "activate";
    const result = await activate(api);
    if (!stillWanted()) { runDeactivate(result, spec); bag.dispose(); return; }
    entry.deactivate = result;
    setRuntime(store, spec, { status: "active", error: null, loadedFrom: local.from, contributions: { ...bag.counts } });
    logInfo("plugins", `${manifest.name} started`, { version: manifest.version, from: spec.startsWith("builtin:") ? "bundled" : local.from, api: manifest.api, spec });
  } catch (err) {
    bag.dispose();
    if (stillWanted()) map.delete(spec);
    const message = err instanceof Error ? err.message : String(err);
    logError("plugins", `${specLabel(spec)} did not load`, err, { spec }, { step, plugin: pluginName(spec) });
    setRuntime(store, spec, { status: "error", error: message });
  }
}

const describing = new WeakMap<Store, Map<string, Promise<void>>>();

/** An icon URL longer than this is not worth a `localStorage` slot (a fat `data:` icon). */
const MAX_CACHED_ICON = 32 * 1024;

function describeMap(store: Store): Map<string, Promise<void>> {
  let m = describing.get(store);
  if (!m) { m = new Map(); describing.set(store, m); }
  return m;
}

/**
 * Read a plugin's manifest — name, version, description, icon — **without running it**.
 *
 * A plugin that is listed but turned off used to be a bare spec in Manage Plugins,
 * because the only thing that ever filled `pluginRuntimesAtom` was `activatePlugin`,
 * i.e. the call that also imports and executes the code. This is the other half:
 * `resolvePlugin(..., { entry: false })` fetches the one `plugin.json` and stops, so a
 * row can be named and described at the cost of a JSON file and no execution at all.
 *
 * It never touches `status` and never reports an error: a description is a nicety, and a
 * plugin the network could not describe is still just *off*, not broken. The manifest is
 * cached in `pluginManifestCacheAtom` so the next visit renders from storage at once and
 * this refreshes behind it. One attempt per spec per store — `forgetDescription` (which
 * `reloadPlugin` calls) is what asks again.
 */
export function describePlugin(store: Store, spec: string, deps: Pick<LoaderDeps, "fetchText" | "builtins"> = browserLoaderDeps()): Promise<void> {
  const map = describeMap(store);
  const existing = map.get(spec);
  if (existing) return existing;
  const promise = runDescribe(store, spec, deps);
  map.set(spec, promise);
  return promise;
}

async function runDescribe(store: Store, spec: string, deps: Pick<LoaderDeps, "fetchText" | "builtins">): Promise<void> {
  const cached: CachedManifest | undefined = store.get(pluginManifestCacheAtom)[spec];
  if (cached && !store.get(pluginRuntimesAtom)[spec]?.manifest) {
    setRuntime(store, spec, { manifest: cached.manifest, icon: cached.icon });
  }
  setRuntime(store, spec, { describing: true });
  try {
    const source = parseSpec(spec);
    // A plugin the user keeps a copy of is described out of that copy: its address is
    // not touched at all while the option is on and a copy exists.
    const snapshot = installOf(store, spec)?.local ? store.get(pluginCodeAtom)[spec] : undefined;
    const use = snapshot && source.kind === "remote" && source.manifestUrl && snapshot.files[source.manifestUrl] ? storedDeps(deps, snapshot.files) : deps;
    const { manifest, icon } = await resolvePlugin(source, use, { entry: false });
    // An activation that started meanwhile has the last word: it ran the code, this did not.
    rememberManifest(store, spec, manifest, icon ?? null, { runtime: !activeMap(store).has(spec), cache: source.kind !== "builtin" });
  } catch (err) {
    // Not an error state: the row keeps whatever it had (a cached manifest, or the spec).
    logWarn("plugins", `Could not read ${specLabel(spec)}'s manifest: ${err instanceof Error ? err.message : String(err)}`, { spec });
  } finally {
    setRuntime(store, spec, { describing: false });
  }
}

/**
 * Keep what a `plugin.json` said: on the runtime (so the row is named at once) and in
 * `pluginManifestCacheAtom` (so the next visit renders before the network answers).
 * A built-in is never cached — there is nothing to fetch and its icon URL is build-hashed.
 */
export function rememberManifest(
  store: Store,
  spec: string,
  manifest: PluginManifest,
  icon: PluginIcon | null,
  opts: { runtime?: boolean; cache?: boolean } = {},
) {
  if (opts.runtime !== false) setRuntime(store, spec, { manifest, icon });
  if (opts.cache === false || spec.startsWith("builtin:")) return;
  const keep = icon && (icon.kind === "text" || icon.url.length <= MAX_CACHED_ICON) ? icon : null;
  store.set(pluginManifestCacheAtom, { ...store.get(pluginManifestCacheAtom), [spec]: { manifest, icon: keep, at: Date.now() } });
}

/** Ask for a plugin's manifest again on the next `describePlugin` (Reload, Remove). */
export function forgetDescription(store: Store, spec: string) {
  describeMap(store).delete(spec);
}

export function deactivatePlugin(store: Store, spec: string) {
  const map = activeMap(store);
  const entry = map.get(spec);
  if (!entry) {
    if (store.get(pluginRuntimesAtom)[spec]) setRuntime(store, spec, { status: "disabled", error: null });
    return;
  }
  map.delete(spec);
  runDeactivate(entry.deactivate, spec);
  entry.bag.dispose();
  setRuntime(store, spec, { status: "disabled", error: null, contributions: { menu: 0, contextMenu: 0, hotkeys: 0, events: 0, preferences: 0 } });
  logInfo("plugins", `${store.get(pluginRuntimesAtom)[spec]?.manifest?.name ?? specLabel(spec)} stopped`, { spec });
}

/** Fetch a plugin again from its address, replacing any copy kept in the browser. */
export async function reloadPlugin(store: Store, spec: string, deps?: LoaderDeps) {
  forgetDescription(store, spec);
  forgetSnapshot(store, spec);
  deactivatePlugin(store, spec);
  await activatePlugin(store, spec, deps);
}

export function isPluginActive(store: Store, spec: string): boolean {
  return activeMap(store).has(spec);
}

export function activePluginSpecs(store: Store): string[] {
  return [...activeMap(store).keys()];
}
