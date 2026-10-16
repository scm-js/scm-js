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
 * Manage Plugins' *Check all for updates* and *Update all* are here too
 * (`checkAllForUpdates`, `updateAllPlugins`): the same registry-first reading, asked for,
 * and the same install, pressed for.
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
import { t } from "../i18n";

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

/** A listed plugin the registry names at the version it runs, or an older one. */
export interface PluginCurrent {
  spec: string;
  name: string;
  /** The registry's newest release. */
  version: string;
}

/**
 * What the registries answer about the installed plugins. The startup pass reads `found`
 * and `ask`; *Check all for updates* reads all four, since a press is owed an answer for
 * every row — `unversioned` is a listed plugin with no running version to compare (off,
 * nothing cached), which only a press goes on to ask at its address.
 */
export interface RegistryAnswers {
  found: PluginUpdate[];
  ask: PluginToAsk[];
  current: PluginCurrent[];
  unversioned: (PluginToAsk & { listed: string | null })[];
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
): RegistryAnswers {
  const listed = new Map<string, RegistryEntry>();
  for (const r of registries) for (const e of r.plugins) if (!e.unlisted && !listed.has(pluginKey(e.spec))) listed.set(pluginKey(e.spec), e);
  const found: PluginUpdate[] = [];
  const ask: PluginToAsk[] = [];
  const current: PluginCurrent[] = [];
  const unversioned: RegistryAnswers["unversioned"] = [];
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
    if (!entry.version || from === null) { unversioned.push({ spec: p.spec, address, name, from, listed: entry.version ?? null }); continue; }
    if (compareVersions(entry.version, from) > 0) found.push({ spec: p.spec, address, name, from, to: entry.version, preview: null });
    else current.push({ spec: p.spec, name, version: entry.version });
  }
  return { found, ask, current, unversioned };
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
    ? t("{name} {version} is available", { name: updates[0].name, version: updates[0].to })
    : t("{n} plugin updates are available", { n: updates.length });
  const detail = updates.length === 1
    ? (updates[0].from ? t("You have {current}.", { current: updates[0].from }) : undefined)
    : `${updates.map(versionLine).join(", ")}.`;
  return { kind: "info", title, detail, ttl: 0, action: { label: t("Plugins…"), run: openPlugins } };
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
  return { kind: failed.length > 0 ? "warn" : "info", title, detail: parts.join(" "), ttl: 0, action: { label: t("Plugins…"), run: openPlugins } };
}

/* ── The pass ───────────────────────────────────────────── */

/** The collaborators the pass takes, so a test can drive it without a network or a plugin. */
export interface UpdateDeps {
  loadRegistries: (store: Store, opts?: { force?: boolean }) => Promise<Registry[]>;
  checkForUpdate: (address: string, installed: { version?: string | null }) => Promise<UpdateCheck>;
  installPlugin: (store: Store, preview: PluginPreview, opts: { replaces: string; pin: true; local: boolean; enabled?: boolean }) => Promise<void>;
  now: () => number;
}

export const browserUpdateDeps = (): UpdateDeps => ({
  loadRegistries: (store, opts) => loadRegistries(store, opts),
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

/* ── Asked for: Check all, Update all ───────────────────── */

/**
 * What an address check says about one row, in the words the row shows. The row's own
 * **Check for update** and *Check all* both answer through this.
 */
export function answerFor(check: UpdateCheck): PluginUpdateAnswer {
  const { preview, newer, tag } = check;
  if (!preview.manifest) return { kind: "problem", text: `${t("Could not find plugin data at that address.")} ${preview.problem ?? ""}`.trim() };
  if (newer && preview.pin) return { kind: "newer", version: preview.manifest.version ?? tag, preview };
  if (!preview.pin) return { kind: "problem", text: preview.pinProblem ?? t("Could not ask for a newer version.") };
  // Naming the version is the whole answer: "the newest commit" said nothing about whether
  // the plugin had been released since, which is what was actually asked.
  const at = tag ?? (preview.manifest.version ? `v${preview.manifest.version}` : preview.pin.short);
  return { kind: "current", text: t("{name} {at} is the newest version there is.", { name: preview.manifest.name, at }) };
}

/** How a *Check all* came out, counted over the rows it answered for. */
export interface CheckAllResult {
  newer: number;
  current: number;
  problem: number;
}

/**
 * *Check all for updates*: an answer on every row that has an address, the way the
 * startup pass finds them — the registries first (fetched fresh, since this was asked
 * for), and the address only for a plugin no registry lists or one with no running
 * version to compare. Asking every address in turn was two or three GitHub requests a
 * row against sixty an hour, so three presses with the defaults installed spent the limit
 * and the row buttons then answered *Could not check*. A registry an hour behind a
 * release is caught by the row's own button, which always asks the address.
 */
export async function checkAllForUpdates(store: Store, deps: UpdateDeps = browserUpdateDeps()): Promise<CheckAllResult> {
  store.set(pluginUpdateCheckAtom, { at: deps.now() });
  const installs = effectiveInstalls(store.get(installedPluginsAtom));
  const runtimes = store.get(pluginRuntimesAtom);
  const cached = store.get(pluginManifestCacheAtom);
  const registries = await deps.loadRegistries(store, { force: true }).catch(() => [] as Registry[]);
  const { found, ask, current, unversioned } = updatesFromRegistries(installs, runtimes, cached, registries);
  const answers: Record<string, PluginUpdateAnswer> = {};
  for (const u of found) answers[u.spec] = { kind: "newer", version: u.to, preview: null };
  const currentAnswer = (name: string, version: string): PluginUpdateAnswer =>
    ({ kind: "current", text: t("{name} {at} is the newest version there is.", { name, at: `v${version.replace(/^v/i, "")}` }) });
  for (const c of current) answers[c.spec] = currentAnswer(c.name, c.version);
  // A plugin that is off has no running version, but one pinned to a release tag names it.
  const toAsk: PluginToAsk[] = [...ask];
  for (const u of unversioned) {
    const tagged = tagVersion(u.address);
    if (!tagged || !u.listed) { toAsk.push(u); continue; }
    answers[u.spec] = compareVersions(u.listed, tagged) > 0
      ? { kind: "newer", version: u.listed, preview: null }
      : currentAnswer(u.name, u.listed);
  }
  for (const a of toAsk) {
    try {
      answers[a.spec] = answerFor(await deps.checkForUpdate(a.address, { version: a.from }));
    } catch (err) {
      answers[a.spec] = { kind: "problem", text: err instanceof Error ? err.message : String(err) };
    }
  }
  store.set(pluginUpdatesAtom, { ...store.get(pluginUpdatesAtom), ...answers });
  const result: CheckAllResult = { newer: 0, current: 0, problem: 0 };
  for (const a of Object.values(answers)) result[a.kind]++;
  return result;
}

/** The release a spec is pinned to, when its ref is a version tag (`…@v1.2.0`). */
function tagVersion(spec: string): string | null {
  const m = /@v?(\d+(?:\.\d+)*(?:-[\w.]+)?)$/.exec(spec);
  return m ? m[1] : null;
}

/** The rows Manage Plugins offers an update on, as updates — what *Update all* would install. */
export function offeredUpdates(store: Store): PluginUpdate[] {
  const answers = store.get(pluginUpdatesAtom);
  const runtimes = store.get(pluginRuntimesAtom);
  const cached = store.get(pluginManifestCacheAtom);
  return effectiveInstalls(store.get(installedPluginsAtom)).flatMap((p) => {
    const a = answers[p.spec];
    const address = updateAddress(p.spec);
    if (a?.kind !== "newer" || address === null) return [];
    const to = a.preview?.manifest?.version ?? a.version ?? "?";
    return [{ spec: p.spec, address, name: rowName(p.spec, runtimes, cached), from: runningVersion(p.spec, runtimes, cached), to, preview: a.preview }];
  });
}

/**
 * *Update all*: install every update the rows offer, one after another, keeping each
 * row's own choices (on or off, loaded from a saved copy or not). Unlike `auto` it takes
 * the defaults too — the press is the user's, as the row's own button is — and leaves
 * only a release built for a newer plugin API than this editor has. A registry answer
 * carries no preview, so the address is asked first, which is also the second opinion on
 * whether the release is newer at all.
 */
export async function updateAllPlugins(store: Store, deps: UpdateDeps = browserUpdateDeps()): Promise<AutoUpdateOutcome> {
  const outcome: AutoUpdateOutcome = { installed: [], skipped: [], failed: [] };
  for (const u of offeredUpdates(store)) {
    const install = effectiveInstalls(store.get(installedPluginsAtom)).find((p) => p.spec === u.spec);
    if (!install) continue;
    try {
      const got = u.preview ? { to: u.to, preview: u.preview } : offered(await deps.checkForUpdate(u.address, { version: u.from }));
      if (!got) {
        outcome.skipped.push({ update: u, reason: t("already the newest release") });
        const rest = { ...store.get(pluginUpdatesAtom) };
        delete rest[u.spec];
        store.set(pluginUpdatesAtom, rest);
        continue;
      }
      const needsApi = got.preview.needsApi;
      if (needsApi != null && needsApi > PLUGIN_API_VERSION) {
        outcome.skipped.push({ update: u, reason: t("built for a newer plugin API ({needsApi}) than this editor has", { needsApi }) });
        continue;
      }
      await deps.installPlugin(store, got.preview, { replaces: u.spec, pin: true, local: install.local === true, enabled: install.enabled });
      outcome.installed.push({ ...u, to: got.to, preview: got.preview });
      const rest = { ...store.get(pluginUpdatesAtom) };
      delete rest[u.spec];
      store.set(pluginUpdatesAtom, rest);
    } catch (err) {
      outcome.failed.push({ update: u, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return outcome;
}
