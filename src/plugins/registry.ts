/**
 * Plugin registries: the lists of plugins the editor offers to install, and the
 * searching over them behind Plugins ▸ Browse.
 *
 * A registry is one JSON file at a URL — `index.json` in `github.com/scm-js/registry`
 * for the ones the project publishes — holding an entry per plugin: its spec and the
 * fields its `plugin.json` carries, so a whole list can be shown from one request
 * instead of one `plugin.json` fetch per row. That is all it is. An entry is **not** a
 * way in: Install hands the entry's spec to the ordinary `inspectPlugin` →
 * `ConfirmPluginDialog` → `installPlugin` path, which fetches the real manifest, resolves
 * the commit and shows the same warning as a pasted address. The registry decides what
 * is *listed*, never what is trusted — there is no sandbox either way.
 *
 * Everything here is pure apart from `loadRegistry`, which needs the store to cache into;
 * the network comes in through a `fetchText` so `tests/plugins.test.ts` can drive it.
 */
import type { Store } from "./host";
import { canonicalSpec, parseSpec, resolveIcon, type PluginSource } from "./loader";
import type { PluginIcon } from "./api";
import { registryCacheAtom, registryStateAtom, userRegistriesAtom, type RegistryState } from "../atoms/pluginAtoms";
import { DEFAULT_REGISTRIES } from "./defaults";

/** One plugin as a registry lists it: the spec to install, plus what its manifest said. */
export interface RegistryEntry {
  /** Canonical spec — what `installedPluginsAtom` would hold, so rows match up. */
  spec: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  /** A page a person can read the plugin's source on. */
  repo?: string;
  homepage?: string;
  /** The manifest's `icon`, verbatim; `entryIcon` resolves it against the plugin's own files. */
  icon?: string;
  /** The plugin API version the plugin asks for. */
  api?: number;
  tags?: string[];
  /**
   * The commit the index was built from. Shown, never installed from: what gets pinned is
   * whatever the confirmation resolves at install time, which may be newer than the index.
   */
  commit?: string;
  /** When that commit landed (ISO 8601). */
  updated?: string;
  /** The editor already lists this one — it is one of `defaults.ts`. */
  default?: boolean;
  /**
   * Not from a registry at all: a plugin the editor has, made into a row by
   * `unlistedInstalls`. There is nothing to install, so the row says so instead of
   * offering it. A registry cannot claim this — `entryOf` builds its own entries.
   */
  unlisted?: boolean;
}

/** A registry as it was read: where from, what it calls itself, and its entries. */
export interface Registry {
  url: string;
  name: string;
  description?: string;
  /** When the index was built (ISO 8601). */
  generated?: string;
  plugins: RegistryEntry[];
  /** Entries dropped for being unusable, so the UI can say the list is short. */
  skipped: number;
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

/* ── Reading one ────────────────────────────────────────── */

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

function entryOf(raw: unknown): RegistryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const spec = str(e.spec);
  const name = str(e.name);
  if (!spec || !name) return null;
  let source: PluginSource;
  // An entry naming something the loader could not install is worse than no entry: the row
  // would offer an Install that cannot work.
  try { source = parseSpec(spec); } catch { return null; }
  const out: RegistryEntry = { spec: canonicalSpec(source), name };
  for (const k of ["version", "description", "author", "repo", "homepage", "icon", "commit", "updated"] as const) {
    const v = str(e[k]);
    if (v !== undefined) out[k] = v;
  }
  if (typeof e.api === "number") out.api = e.api;
  if (e.default === true) out.default = true;
  if (Array.isArray(e.tags)) {
    const tags = e.tags.map(str).filter((t): t is string => t !== undefined);
    if (tags.length > 0) out.tags = tags;
  }
  return out;
}

/**
 * A fetched index as a `Registry`. The file's shape is checked, the entries are not
 * trusted: anything unusable is dropped and counted rather than failing the whole list,
 * because one bad row in a generated file should not empty the browser.
 */
export function parseRegistry(raw: unknown, url: string): Registry {
  if (!raw || typeof raw !== "object") throw new RegistryError(`${url} is not a JSON object.`);
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.plugins)) throw new RegistryError(`${url} has no "plugins" list.`);
  const plugins: RegistryEntry[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const item of r.plugins) {
    const entry = entryOf(item);
    if (!entry || seen.has(entry.spec)) { skipped++; continue; }
    seen.add(entry.spec);
    plugins.push(entry);
  }
  return {
    url,
    name: str(r.name) ?? hostOf(url),
    description: str(r.description),
    generated: str(r.generated),
    plugins,
    skipped,
  };
}

/** The host part of a URL, as a registry with no name of its own is labelled. */
export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/** The icon to draw for an entry: a glyph, or an image resolved against the plugin's own files. */
export function entryIcon(entry: RegistryEntry): PluginIcon | null {
  if (!entry.icon) return null;
  let base: string | null = null;
  try {
    const source = parseSpec(entry.spec);
    base = source.kind === "remote" ? source.base : null;
  } catch {
    base = null;
  }
  return resolveIcon(entry.icon, base);
}

/* ── Plugins the editor has that no registry lists ──────── */

/** What the editor knows about an installed plugin, out of the manifest the loader read. */
export interface InstalledPlugin {
  spec: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** The manifest's `icon`, verbatim. */
  icon?: string;
  api?: number;
}

/**
 * Rows for the plugins this editor has that no registry lists — one pasted in by address,
 * one a registry has dropped or never carried.
 *
 * Browse is read as the list of plugins there *are*, so a plugin that is installed and
 * running but in no index looked like it was not there at all, and the answer to "where
 * is it?" was the other tab. But a registry decides what can be *installed*, never what
 * exists: what it does not carry is added here out of what the editor already knows, and
 * marked `unlisted` so the row states its position rather than offering an Install that
 * would mean nothing.
 *
 * Matching is by `identity` (`pluginKey`, passed in so this module stays free of the
 * defaults), because an install names a *version* — a pinned commit, a tag, the bundled
 * copy — and the registry names the plugin; comparing specs would add a second row for
 * every plugin already listed.
 */
export function unlistedInstalls(
  installed: readonly InstalledPlugin[],
  listed: readonly RegistryEntry[],
  identity: (spec: string) => string,
): RegistryEntry[] {
  const known = new Set(listed.map((e) => identity(e.spec)));
  const out: RegistryEntry[] = [];
  for (const p of installed) {
    const key = identity(p.spec);
    if (known.has(key)) continue;
    known.add(key);
    const entry: RegistryEntry = { spec: p.spec, name: p.name ?? p.spec, unlisted: true };
    for (const k of ["version", "description", "author", "homepage", "icon"] as const) {
      const v = str(p[k]);
      if (v !== undefined) entry[k] = v;
    }
    if (typeof p.api === "number") entry.api = p.api;
    // The row's Source button, for a plugin that has a page a person can read it on.
    try {
      const source = parseSpec(p.spec);
      if (source.kind === "remote" && source.webUrl) entry.repo = source.webUrl;
    } catch { /* an unusable spec still lists; it is already installed */ }
    out.push(entry);
  }
  return out;
}

/* ── Searching ──────────────────────────────────────────── */

/** Where a query matched, best first — the order the results are listed in. */
function score(entry: RegistryEntry, term: string): number {
  const name = entry.name.toLowerCase();
  if (name === term) return 0;
  if (name.startsWith(term)) return 1;
  if (name.includes(term)) return 2;
  if (entry.tags?.some((t) => t.toLowerCase() === term)) return 3;
  if (entry.tags?.some((t) => t.toLowerCase().includes(term))) return 4;
  if (entry.description?.toLowerCase().includes(term)) return 5;
  if (entry.author?.toLowerCase().includes(term)) return 6;
  if (entry.spec.toLowerCase().includes(term)) return 7;
  return -1;
}

/**
 * The entries matching a query, best match first. Every word has to match something
 * (name, tag, description, author or spec); an empty query is every entry in the order
 * the registry listed them, which is the generator's — alphabetical.
 */
export function searchRegistry(entries: readonly RegistryEntry[], query: string): RegistryEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...entries];
  const hits: { entry: RegistryEntry; rank: number }[] = [];
  for (const entry of entries) {
    let worst = 0;
    let ok = true;
    for (const term of terms) {
      const s = score(entry, term);
      if (s < 0) { ok = false; break; }
      worst = Math.max(worst, s);
    }
    if (ok) hits.push({ entry, rank: worst });
  }
  return hits
    .map((h, i) => ({ ...h, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((h) => h.entry);
}

/** Every entry of every registry, the first registry to list a spec winning. */
export function mergeRegistries(registries: readonly Registry[]): RegistryEntry[] {
  const out: RegistryEntry[] = [];
  const seen = new Set<string>();
  for (const r of registries) {
    for (const entry of r.plugins) {
      if (seen.has(entry.spec)) continue;
      seen.add(entry.spec);
      out.push(entry);
    }
  }
  return out;
}

/* ── Telling what is installed from what is not ─────────── */

/** Where a listed plugin already stands with this editor. */
export type InstallState = "new" | "installed" | "disabled";

/** The browse list split by that, each group keeping the order it came in. */
export interface BrowseGroups {
  /** Not in the installed list at all — the rows Install applies to. */
  available: RegistryEntry[];
  /** Already listed, whether it is running or turned off. */
  installed: RegistryEntry[];
}

/**
 * Split entries by whether the editor already has the plugin. Browse and Installed
 * overlap almost completely once the defaults are counted — every plugin the project
 * publishes is listed in both — so a flat list whose rows mostly carry an "installed"
 * badge answers the wrong question. The pane lists the two groups apart and filters on
 * them; this is the part of that worth testing on its own.
 */
export function groupByInstall(
  entries: readonly RegistryEntry[],
  stateOf: (entry: RegistryEntry) => InstallState,
): BrowseGroups {
  const available: RegistryEntry[] = [];
  const installed: RegistryEntry[] = [];
  for (const entry of entries) (stateOf(entry) === "new" ? available : installed).push(entry);
  return { available, installed };
}

/* ── Fetching, and the cache ────────────────────────────── */

/** The registries in use: the project's own, then whatever the user added. */
export function registryUrls(store: Store): string[] {
  const extra = store.get(userRegistriesAtom).filter((u) => !DEFAULT_REGISTRIES.includes(u));
  return [...DEFAULT_REGISTRIES, ...extra];
}

/** True for a registry the user cannot remove (it is one the editor ships with). */
export const isDefaultRegistry = (url: string): boolean => DEFAULT_REGISTRIES.includes(url);

export type FetchText = (url: string) => Promise<string>;

/**
 * The plain HTTP read a registry needs. It is not `browserLoaderDeps().fetchText` only so
 * that this module does not depend on the whole plugin host; the behaviour is the same.
 */
const httpText: FetchText = async (url) => {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
  return res.text();
};

/** How old a cached index may be before opening the browser refreshes it (one hour). */
export const REGISTRY_MAX_AGE = 60 * 60 * 1000;

function setState(store: Store, url: string, patch: Partial<RegistryState>) {
  const all = store.get(registryStateAtom);
  store.set(registryStateAtom, { ...all, [url]: { ...(all[url] ?? { status: "idle" }), ...patch } });
}

const inFlight = new WeakMap<Store, Map<string, Promise<Registry | null>>>();

function flightMap(store: Store): Map<string, Promise<Registry | null>> {
  let map = inFlight.get(store);
  if (!map) { map = new Map(); inFlight.set(store, map); }
  return map;
}

/**
 * Fetch one registry into `registryCacheAtom`, or answer from the cache when it is recent
 * enough and `force` was not asked for. A failure leaves whatever was cached alone and is
 * reported through `registryStateAtom` — the browser then shows the last list it had, said
 * to be from then, rather than emptying itself because the network blinked.
 */
export function loadRegistry(
  store: Store,
  url: string,
  opts: { force?: boolean; maxAge?: number; fetchText?: FetchText } = {},
): Promise<Registry | null> {
  const cached = store.get(registryCacheAtom)[url];
  const maxAge = opts.maxAge ?? REGISTRY_MAX_AGE;
  if (!opts.force && cached && Date.now() - cached.at < maxAge) return Promise.resolve(cached.registry);
  const flights = flightMap(store);
  const running = flights.get(url);
  if (running) return running;
  const fetchText = opts.fetchText ?? httpText;
  const run = (async (): Promise<Registry | null> => {
    setState(store, url, { status: "loading", error: null });
    try {
      const text = await fetchText(url);
      let json: unknown;
      try { json = JSON.parse(text); } catch { throw new RegistryError(`${url} did not answer with JSON.`); }
      const registry = parseRegistry(json, url);
      store.set(registryCacheAtom, { ...store.get(registryCacheAtom), [url]: { at: Date.now(), registry } });
      setState(store, url, { status: "ok", error: null });
      return registry;
    } catch (err) {
      setState(store, url, { status: "error", error: err instanceof Error ? err.message : String(err) });
      return store.get(registryCacheAtom)[url]?.registry ?? null;
    } finally {
      flights.delete(url);
    }
  })();
  flights.set(url, run);
  return run;
}

/** Fetch every registry in use, in parallel. Returns the ones there is a list for. */
export async function loadRegistries(
  store: Store,
  opts: { force?: boolean; maxAge?: number; fetchText?: FetchText } = {},
): Promise<Registry[]> {
  const results = await Promise.all(registryUrls(store).map((url) => loadRegistry(store, url, opts)));
  return results.filter((r): r is Registry => r !== null);
}

/** Whatever is cached for the registries in use, for a first paint before any fetch answers. */
export function cachedRegistries(store: Store): Registry[] {
  const cache = store.get(registryCacheAtom);
  return registryUrls(store).map((url) => cache[url]?.registry).filter((r): r is Registry => r !== undefined);
}

/** Add a registry to the user's list (canonicalised, no duplicates). Throws on a bad URL. */
export function addRegistry(store: Store, url: string): string {
  const s = url.trim();
  if (s === "") throw new RegistryError("Enter the address of a registry.");
  let parsed: URL;
  try { parsed = new URL(s); } catch { throw new RegistryError(`Not a valid URL: ${s}`); }
  if (!/^https?:$/.test(parsed.protocol)) throw new RegistryError("A registry must be an http or https address.");
  const href = parsed.href;
  const list = store.get(userRegistriesAtom);
  if (registryUrls(store).includes(href)) throw new RegistryError("That registry is already in the list.");
  store.set(userRegistriesAtom, [...list, href]);
  return href;
}

/** Drop a registry the user added (a default cannot be removed) and forget its cache. */
export function removeRegistry(store: Store, url: string) {
  if (isDefaultRegistry(url)) return;
  store.set(userRegistriesAtom, store.get(userRegistriesAtom).filter((u) => u !== url));
  const cache = { ...store.get(registryCacheAtom) };
  delete cache[url];
  store.set(registryCacheAtom, cache);
  const state = { ...store.get(registryStateAtom) };
  delete state[url];
  store.set(registryStateAtom, state);
}
