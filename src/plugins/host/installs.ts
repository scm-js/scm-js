/**
 * Adding, updating and turning on plugins, with what they require.
 */
import { installedPluginsAtom, pluginManifestCacheAtom, pluginRuntimesAtom, type PluginInstall } from "../../atoms/pluginAtoms";
import { logWarn } from "../../editor/log";
import { activationOrder, installFor, requiredInstalls, requirementsOf, type ManifestLookup } from "../requires";
import { specLabel } from "../failures";
import { canonicalSpec, githubSource, HASH_REF, listTags, newestTag, parseSpec, previewPlugin, resolveCommit, unpin, type LoaderDeps, type PluginPreview, type RepoTag } from "../loader";
import { pluginKey } from "../defaults";
import { count, pluginName } from "../../services/usage";
import type { Store } from "./shared";
import { effectiveInstalls } from "./installList";
import { browserLoaderDeps, deactivatePlugin, rememberManifest, activatePlugin, forgetSnapshot } from "./lifecycle";

/** What an update check found: the newest release the address holds, and whether it is other code. */
export interface UpdateCheck {
  /** The plugin at its newest release — or, for a repository with none, at its branch tip. */
  preview: PluginPreview;
  /** The commit the installed version resolves to, when it could be worked out. */
  current: string | null;
  /** The release the check compared against, null when the repository had none to offer. */
  tag: string | null;
  /** True when there is a newer release than the one installed. */
  newer: boolean;
}

/**
 * Ask a plugin's address whether it has released a version past the one installed. Two
 * GitHub requests at most and one `plugin.json`; no plugin code is fetched, transpiled or
 * run, and nothing is asked until the user presses the button.
 *
 * It asks about the newest **release tag**, not the branch tip. Asking the branch made
 * every plugin look out of date the moment anything landed on it after its tag — a
 * documentation commit, a rebuilt `dist/plugin.js` — and the "update" it then offered was
 * an untagged commit whose `plugin.json` carried the version already running. See
 * `newestTag`. A repository with no release tags has only its branch to compare, which is
 * what it falls back to.
 *
 * The comparison itself is by **commit, not spec**. Comparing the spec strings said
 * "newer" for every tag-pinned install for ever, since a tag is never spelt like the
 * commit hash a check resolves. The installed tag's commit usually comes out of the same
 * tag list, a hash-pinned spec answers for itself, and only a ref in neither camp costs a
 * request; if it cannot be resolved at all the spec comparison is the fallback, which
 * errs towards offering the update rather than hiding one.
 *
 * `installed.version` is the version the plugin is *running* (its loaded manifest), and
 * it is the last word: a release naming that version is the release already installed,
 * whatever the commits say. It is what stops "Update to v1.1.2" appearing on a row that
 * reads v1.1.2 — the one answer a check must never give. The cost is that a plugin
 * republished under an unchanged version is not offered, which is the author saying it
 * is not a new release.
 */
export async function checkForUpdate(
  spec: string,
  deps: Pick<LoaderDeps, "fetchText" | "builtins"> = browserLoaderDeps(),
  installed: { version?: string | null } = {},
): Promise<UpdateCheck> {
  const source = parseSpec(spec);
  const gh = source.kind === "remote" ? source.github : null;
  // A refusal here (no tags, rate limited, not GitHub) is ordinary: it leaves the branch
  // as the only thing to compare, which is what this used to do for everything.
  const tags = gh ? await listTags(gh, deps.fetchText).catch(() => [] as RepoTag[]) : [];
  const release = newestTag(tags);
  const address = gh && release ? canonicalSpec(githubSource(gh.owner, gh.repo, release.name, gh.dir)) : unpin(spec);
  const preview = await previewPlugin(address, deps, release ? { commit: release.ref } : {});

  let current: string | null = null;
  if (gh?.ref) {
    current = HASH_REF.test(gh.ref)
      ? gh.ref.toLowerCase()
      : tags.find((t) => t.name === gh.ref)?.ref ?? await resolveCommit(gh, deps.fetchText).catch(() => null);
  }
  // Three ways of saying "this is what is already installed", any one of which is enough:
  // the release is the ref the spec names, the release carries the running version, or it
  // resolves to the commit installed.
  const sameTag = release !== null && gh?.ref === release.name;
  const sameVersion = installed.version != null && preview.manifest?.version === installed.version;
  const sameCommit = preview.pin !== null && (current === null ? preview.pin.spec === spec : preview.pin.ref === current);
  const newer = preview.pin !== null && !sameTag && !sameVersion && !sameCommit;
  return { preview, current, tag: release?.name ?? null, newer };
}

/**
 * What the Add Plugin confirmation shows before anything of the plugin runs: its
 * manifest and the addresses it will be fetched from, and nothing else (`previewPlugin`
 * reads one `plugin.json`). It throws only when the *spec* is unusable — a manifest that
 * cannot be fetched comes back as `preview.problem`, since the user may still add it.
 */
export function inspectPlugin(spec: string, deps: Pick<LoaderDeps, "fetchText" | "builtins"> = browserLoaderDeps()): Promise<PluginPreview> {
  return previewPlugin(spec, deps);
}

/**
 * Add a plugin the user has just confirmed. The manifest read for the confirmation is
 * kept (`rememberManifest`), so the new row is named and described the instant it
 * appears instead of after another fetch, and only then is the code fetched and run.
 */
export async function installPlugin(
  store: Store,
  preview: PluginPreview,
  opts: { enabled?: boolean; pin?: boolean; local?: boolean; replaces?: string; deps?: LoaderDeps; requirements?: readonly RequirementPreview[]; seen?: Set<string> } = {},
) {
  const enabled = opts.enabled !== false;
  const deps = opts.deps ?? browserLoaderDeps();
  // A requirement installed along the way is counted on its own call (`seen` is shared then).
  count("plugin.install", { plugin: pluginName(preview.spec), ...(opts.seen ? { required: true } : {}), ...(opts.replaces ? { replacing: true } : {}) });
  // What this plugin requires goes in first, with the same choices, so the plugin never
  // runs a moment without its provider. One already in the list is not installed again —
  // only turned on, if it was off and this one is going on. The confirmation hands over the
  // previews it fetched to show; a caller with none gets them read here. A requirement
  // that cannot be read is still added, so its failure is on a row in Manage Plugins
  // rather than nowhere.
  const seen = opts.seen ?? new Set<string>([preview.spec]);
  for (const required of requirementsOf(preview.manifest)) {
    if (seen.has(required)) continue;
    seen.add(required);
    const found = installFor(required, effectiveInstalls(store.get(installedPluginsAtom)), pluginKey);
    if (found) {
      if (enabled && !found.enabled) await enableWithRequirements(store, found.spec, deps);
      continue;
    }
    const given = opts.requirements?.find((r) => r.spec === required)?.preview;
    const rp = given ?? await previewPlugin(required, deps).catch(() => null);
    if (!rp) { logWarn("plugins", `${preview.manifest?.name ?? preview.spec} requires ${required}, which could not be read`, { required }); continue; }
    await installPlugin(store, rp, { enabled, pin: opts.pin, local: opts.local, deps, requirements: opts.requirements, seen });
  }
  // Pinning is what actually gets stored: `github:owner/repo@<sha>` instead of a ref that moves.
  const pinned = opts.pin !== false && preview.pin !== null;
  const spec = pinned ? preview.pin!.spec : preview.spec;
  // Updating a pinned plugin: the old commit's install, copy and running instance all go,
  // since the new spec is a different plugin as far as everything here is concerned.
  if (opts.replaces && opts.replaces !== spec) {
    deactivatePlugin(store, opts.replaces);
    setInstalled(store, opts.replaces, { remove: true });
  }
  if (preview.manifest) rememberManifest(store, spec, preview.manifest, preview.icon);
  setInstalled(store, spec, { enabled, local: opts.local === true });
  if (enabled) await activatePlugin(store, spec, deps);
}

/** A required plugin as the confirmation read it: its spec and the preview, or null when it could not be read. */
export interface RequirementPreview {
  spec: string;
  preview: PluginPreview | null;
}

/** The manifest the editor holds for a spec — the running one, else the last one read for the row. */
export function manifestLookup(store: Store): ManifestLookup {
  const runtimes = store.get(pluginRuntimesAtom);
  const cache = store.get(pluginManifestCacheAtom);
  return (spec) => runtimes[spec]?.manifest ?? cache[spec]?.manifest ?? null;
}

/**
 * Turn a plugin on, and with it whatever it requires. The one rule behind the Manage
 * Plugins tick and Browse's *Turn on*: a plugin enabled without its provider would sit
 * with a dead button, and neither screen should have to know what it needs. Works from
 * the manifests the editor has read — a plugin whose manifest is not in yet enables
 * alone, and its load logs what is missing.
 */
export async function enableWithRequirements(store: Store, spec: string, deps: LoaderDeps = browserLoaderDeps(), seen = new Set<string>()): Promise<void> {
  if (seen.has(spec)) return;
  seen.add(spec);
  const installs = effectiveInstalls(store.get(installedPluginsAtom));
  for (const r of requiredInstalls(spec, installs, manifestLookup(store), pluginKey)) {
    if (!r.enabled) await enableWithRequirements(store, r.spec, deps, seen);
  }
  setInstalled(store, spec, { enabled: true });
  await activatePlugin(store, spec, deps);
}

/** The installed list in the order to start it: each plugin after the ones it requires (`plugins/requires.ts`). */
export function orderedInstalls(store: Store, installs: readonly PluginInstall[]): PluginInstall[] {
  return activationOrder(installs, manifestLookup(store), pluginKey, (problem) => {
    logWarn("plugins", problem.kind === "cycle" ? `${specLabel(problem.spec)} and ${problem.required} require each other` : `${specLabel(problem.spec)} requires ${problem.required}, which is not installed`, { spec: problem.spec, required: problem.required });
  });
}

/** Add, remove or toggle a plugin in the persisted list (Remove also drops its copy). */
export function setInstalled(store: Store, spec: string, patch: { enabled?: boolean; local?: boolean; remove?: boolean }) {
  const stored = store.get(installedPluginsAtom);
  const others = stored.filter((p) => p.spec !== spec);
  if (patch.remove) { forgetSnapshot(store, spec); store.set(installedPluginsAtom, others); return; }
  const prev = stored.find((p) => p.spec === spec);
  const local = patch.local ?? prev?.local ?? false;
  // The copy only exists to serve `local`; dropping the option drops it, so turning the
  // option back on fetches the plugin again rather than reviving something months old.
  if (!local) forgetSnapshot(store, spec);
  const next: PluginInstall = { spec, enabled: patch.enabled ?? prev?.enabled ?? true, ...(local ? { local: true } : {}) };
  store.set(installedPluginsAtom, prev ? stored.map((p) => (p.spec === spec ? next : p)) : [...stored, next]);
}
