/**
 * Plugin updates found without being asked for: the startup check behind
 * Preferences ▸ Plugins, and what it does with what it finds.
 *
 * The row's **Check for update** button asks GitHub two or three times per plugin, with
 * no token and a limit of sixty requests an hour per address. Six plugins on every
 * launch — and a page reloaded a few times in development — would spend that and then
 * answer *Could not check* to the button itself. So the startup check reads the
 * **registries** instead: one index (`plugins/registry.ts`, cached for an hour) already
 * carries every listed plugin's version at its newest release, which is exactly the
 * question. Only a plugin no registry lists is asked at its own address, and the whole
 * pass runs at most once per `RECHECK_MS`, like the desktop's own update check.
 *
 * What it finds lands in `pluginUpdatesAtom`, which is what Manage Plugins draws — the
 * notice's button opens the dialog with *Update to v…* already on the rows, and pressing
 * one goes through the same confirmation as a first install. `auto` installs without the
 * confirmation, for the plugins it may (`autoUpdateBlock`): never a default, which moves
 * with the editor's own releases and would otherwise turn from a copy compiled into the
 * build into a fetch at every start; never a plugin loading from a saved copy, since that
 * tick exists to not fetch; never a release asking for a newer plugin API than this
 * editor has; and always release tag to release tag in the same repository, which is
 * what `checkForUpdate` offers.
 *
 * The pure half is tested against stand-ins in `tests/plugin-updates.test.ts`; the pass
 * itself takes its collaborators as `UpdateDeps` for the same reason.
 */
import type { Toast } from "../editor/view";
import type { PluginUpdateMode } from "../editor/preferences";
import { RECHECK_MS } from "../editor/updates";
import { installedPluginsAtom, pluginManifestCacheAtom, pluginRuntimesAtom, pluginUpdateCheckAtom, pluginUpdatesAtom, type CachedManifest, type PluginInstall, type PluginRuntime, type PluginUpdateAnswer } from "../atoms/pluginAtoms";
import { PLUGIN_API_VERSION } from "./api";
import { defaultPlugins, pluginKey, updateAddress } from "./defaults";
import { checkForUpdate, effectiveInstalls, installPlugin, type Store, type UpdateCheck } from "./host";
import type { PluginPreview } from "./loader";
import { loadRegistries, type Registry, type RegistryEntry } from "./registry";

/** One plugin with a newer release than the one it runs. */
export interface PluginUpdate {
  /** The row: the spec installed (a bundled default's is `builtin:…`). */
  spec: string;
  /** What to ask about — the spec, or the address a bundled copy was built from. */
  address: string;
  name: string;
  /** The version running, when it is known. */
  from: string | null;
  /** The version offered. */
  to: string;
  /** The preview an address check found, when one was made; a registry answer has none yet. */
  preview: PluginPreview | null;
}

/** A plugin the registries could not answer for, to be asked at its own address. */
export interface PluginToAsk {
  spec: string;
  address: string;
  name: string;
  from: string | null;
}

/* ── Versions ───────────────────────────────────────────── */

/**
 * Compare two versions as `plugin.json` writes them: dotted numbers, an optional `v`, and
 * a prerelease suffix that ranks below the release it precedes. Anything that is not a
 * number compares as text, so a plugin that versions itself oddly still sorts stably.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [main, pre] = v.trim().replace(/^v/i, "").split("-", 2);
    return { parts: main.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)), pre: pre ?? null };
  };
  const x = split(a), y = split(b);
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const p = x.parts[i] ?? 0, q = y.parts[i] ?? 0;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p < q ? -1 : 1;
    return String(p) < String(q) ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** Whether a pass is due: never in `manual`, and not again within `RECHECK_MS`. */
export function shouldCheckPlugins(mode: PluginUpdateMode, lastCheck: number | null, now: number): boolean {
  if (mode === "manual") return false;
  return lastCheck === null || lastCheck === 0 || now - lastCheck >= RECHECK_MS;
}

/* ── Reading the registries ─────────────────────────────── */

/** The version a row is running: the loaded manifest's, else the one cached from an earlier session. */
export function runningVersion(spec: string, runtimes: Record<string, PluginRuntime>, cached: Record<string, CachedManifest>): string | null {
  return runtimes[spec]?.manifest?.version ?? cached[spec]?.manifest.version ?? null;
}

function rowName(spec: string, runtimes: Record<string, PluginRuntime>, cached: Record<string, CachedManifest>, entry?: RegistryEntry): string {
  return runtimes[spec]?.manifest?.name ?? cached[spec]?.manifest.name ?? entry?.name ?? spec;
}

/**
 * What the registries say is newer than what is installed, and which installed plugins
 * they say nothing about. A plugin that follows a branch (no `updateAddress`) has Reload
 * for its update and is skipped. So is a listed plugin whose running version is unknown
 * — off, with no manifest cached — since asking its address instead would put the
 * defaults back on GitHub's meter the moment one is switched off; the row's button is
 * there for it. Only a plugin **no** registry lists is asked at its own address, which
 * bounds the requests to the plugins the user added by hand.
 */
export function updatesFromRegistries(
  installs: readonly PluginInstall[],
  runtimes: Record<string, PluginRuntime>,
  cached: Record<string, CachedManifest>,
  registries: readonly Registry[],
): { found: PluginUpdate[]; ask: PluginToAsk[] } {
  const listed = new Map<string, RegistryEntry>();
  for (const r of registries) for (const e of r.plugins) if (!e.unlisted && !listed.has(pluginKey(e.spec))) listed.set(pluginKey(e.spec), e);
  const found: PluginUpdate[] = [];
  const ask: PluginToAsk[] = [];
  for (const p of installs) {
    const address = updateAddress(p.spec);
    if (address === null) continue;
    const entry = listed.get(pluginKey(p.spec));
    const from = runningVersion(p.spec, runtimes, cached);
    const name = rowName(p.spec, runtimes, cached, entry);
    if (!entry) {
      ask.push({ spec: p.spec, address, name, from });
      continue;
    }
    if (!entry.version || from === null) continue;
    if (compareVersions(entry.version, from) > 0) found.push({ spec: p.spec, address, name, from, to: entry.version, preview: null });
  }
  return { found, ask };
}

/* ── Installing on its own ──────────────────────────────── */

/**
 * Why `auto` must leave a plugin to the button, or null when it may install it. The
 * reasons are the ones the module comment gives; each is a sentence because the notice
 * names it.
 */
export function autoUpdateBlock(install: PluginInstall, opts: { needsApi?: number | null; defaults?: readonly string[] } = {}): string | null {
  const defaults = opts.defaults ?? defaultPlugins().map((d) => d.spec);
  if (defaults.some((d) => pluginKey(d) === pluginKey(install.spec))) return "a default, which moves with the editor's own releases";
  if (!install.enabled) return "turned off";
  if (install.local) return "loaded from a copy saved here";
  if (opts.needsApi != null && opts.needsApi > PLUGIN_API_VERSION) return `built for a newer plugin API (${opts.needsApi}) than this editor has`;
  return null;
}

/* ── The notices ────────────────────────────────────────── */

const listNames = (names: readonly string[]) =>
  names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

const versionLine = (u: PluginUpdate) => (u.from ? `${u.name} ${u.from} to ${u.to}` : `${u.name} to ${u.to}`);

/**
 * The notice for updates found and not installed: what is newer, and a button to the rows
 * that offer it. No `ttl`, since it lands seconds after launch while the splash may still
 * be up, and an offer that expires unseen was never made.
 */
export function updateToast(updates: readonly PluginUpdate[], openPlugins: () => void): Omit<Toast, "id"> | null {
  if (updates.length === 0) return null;
  const title = updates.length === 1
    ? `${updates[0].name} ${updates[0].to} is available`
    : `${updates.length} plugins have newer versions`;
  const detail = updates.length === 1
    ? (updates[0].from ? `You have ${updates[0].from}. Each update shows what it is before anything changes.` : "The update shows what it is before anything changes.")
    : `${updates.map(versionLine).join(", ")}. Each update shows what it is before anything changes.`;
  return { kind: "info", title, detail, ttl: 0, action: { label: "Plugins…", run: openPlugins } };
}

/** What an `auto` pass did, for the notice that says so. */
export interface AutoUpdateOutcome {
  installed: PluginUpdate[];
  /** Updates found but left to the button, each with why. */
  skipped: { update: PluginUpdate; reason: string }[];
  /** Updates that could not be installed, each with the error. */
  failed: { update: PluginUpdate; error: string }[];
}

/**
 * The notice after an `auto` pass. Only what happened is said — what was installed, what
 * could not be, and what was left for the button — and nothing at all when the pass found
 * nothing, since "no updates" is not news.
 */
export function autoUpdateToast(outcome: AutoUpdateOutcome, openPlugins: () => void): Omit<Toast, "id"> | null {
  const { installed, skipped, failed } = outcome;
  if (installed.length === 0 && skipped.length === 0 && failed.length === 0) return null;
  const parts: string[] = [];
  if (installed.length > 0) parts.push(`Updated ${listNames(installed.map(versionLine))}.`);
  if (failed.length > 0) parts.push(`Could not update ${listNames(failed.map((f) => f.update.name))}: ${failed[0].error}`);
  if (skipped.length > 0) parts.push(`${listNames(skipped.map((s) => `${s.update.name} ${s.update.to}`))} ${skipped.length === 1 ? "is" : "are"} available; ${skipped.length === 1 ? "it is" : "they are"} left to the row's button, being ${skipped[0].reason}.`);
  const title = installed.length === 1 ? `${installed[0].name} updated to ${installed[0].to}`
    : installed.length > 1 ? `${installed.length} plugins updated`
    : failed.length > 0 ? "A plugin update failed"
    : skipped.length === 1 ? `${skipped[0].update.name} ${skipped[0].update.to} is available`
    : `${skipped.length} plugins have newer versions`;
  return { kind: failed.length > 0 ? "warn" : "info", title, detail: parts.join(" "), ttl: 0, action: { label: "Plugins…", run: openPlugins } };
}

/* ── The pass ───────────────────────────────────────────── */

/** The collaborators the pass takes, so a test can drive it without a network or a plugin. */
export interface UpdateDeps {
  loadRegistries: (store: Store) => Promise<Registry[]>;
  checkForUpdate: (address: string, installed: { version?: string | null }) => Promise<UpdateCheck>;
  installPlugin: (store: Store, preview: PluginPreview, opts: { replaces: string; pin: true; local: false }) => Promise<void>;
  now: () => number;
}

export const browserUpdateDeps = (): UpdateDeps => ({
  loadRegistries: (store) => loadRegistries(store),
  checkForUpdate: (address, installed) => checkForUpdate(address, undefined, installed),
  installPlugin: (store, preview, opts) => installPlugin(store, preview, opts),
  now: () => Date.now(),
});

export interface UpdatePassResult {
  found: PluginUpdate[];
  outcome: AutoUpdateOutcome | null;
}

/** What the confirmation would offer for an address check, or null when it is not an update. */
function offered(check: UpdateCheck): { to: string; preview: PluginPreview } | null {
  if (!check.newer || !check.preview.manifest || !check.preview.pin) return null;
  return { to: check.preview.manifest.version ?? check.tag ?? check.preview.pin.short, preview: check.preview };
}

/**
 * Find what is newer, record it for Manage Plugins, and in `auto` install what may be.
 * Never throws: a registry or an address that does not answer is a plugin with no news.
 */
export async function runUpdatePass(store: Store, mode: PluginUpdateMode, deps: UpdateDeps = browserUpdateDeps()): Promise<UpdatePassResult> {
  store.set(pluginUpdateCheckAtom, { at: deps.now() });
  const installs = effectiveInstalls(store.get(installedPluginsAtom));
  const runtimes = store.get(pluginRuntimesAtom);
  const cached = store.get(pluginManifestCacheAtom);
  const registries = await deps.loadRegistries(store).catch(() => [] as Registry[]);
  const { found, ask } = updatesFromRegistries(installs, runtimes, cached, registries);
  for (const a of ask) {
    try {
      const got = offered(await deps.checkForUpdate(a.address, { version: a.from }));
      if (got) found.push({ ...a, to: got.to, preview: got.preview });
    } catch { /* a plugin with no news */ }
  }
  const answers: Record<string, PluginUpdateAnswer> = { ...store.get(pluginUpdatesAtom) };
  for (const u of found) answers[u.spec] = { kind: "newer", version: u.to, preview: u.preview };
  store.set(pluginUpdatesAtom, answers);
  if (mode !== "auto") return { found, outcome: null };

  const outcome: AutoUpdateOutcome = { installed: [], skipped: [], failed: [] };
  for (const u of found) {
    const install = installs.find((p) => p.spec === u.spec)!;
    try {
      // A registry answer carries no preview; the address check makes one, and is also the
      // second opinion — a registry an hour stale may name a version the repository has
      // since replaced, and the check compares commits.
      const got = u.preview ? { to: u.to, preview: u.preview } : offered(await deps.checkForUpdate(u.address, { version: u.from }));
      if (!got) { outcome.skipped.push({ update: u, reason: "already the newest release by the repository's account" }); continue; }
      const block = autoUpdateBlock(install, { needsApi: got.preview.needsApi });
      if (block) { outcome.skipped.push({ update: u, reason: block }); continue; }
      await deps.installPlugin(store, got.preview, { replaces: u.spec, pin: true, local: false });
      outcome.installed.push({ ...u, to: got.to, preview: got.preview });
      const rest = { ...store.get(pluginUpdatesAtom) };
      delete rest[u.spec];
      store.set(pluginUpdatesAtom, rest);
    } catch (err) {
      outcome.failed.push({ update: u, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { found, outcome };
}
