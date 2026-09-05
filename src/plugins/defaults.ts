/**
 * The plugins a fresh editor starts with.
 *
 * A default is nothing more than a spec that is in the installed list before the user
 * adds anything — it is fetched, transpiled and imported by `loader.ts` exactly like a
 * plugin somebody pastes into Manage Plugins, and it is the same code the author
 * publishes. That is the point: the plugin that ships with the editor is the proof the
 * loading path works, not an exception to it.
 *
 * The user can turn a default off (the `enabled: false` is persisted) but not remove
 * it from the list, which is why `effectiveInstalls` merges these in rather than
 * seeding the stored list once. Anything bundled into the build (`builtin.ts`) is a
 * default too, and stands in for the remote spec it was built from — see `pluginKey`.
 */
import { BUILTIN_PLUGINS, BUILTIN_REPLACES } from "./builtin";
import { isPinned, pluginIdentity } from "./loader";

/** A default: its spec, and whether it runs before the user has said anything. */
export interface DefaultPlugin {
  spec: string;
  enabled: boolean;
}

/**
 * Plugins loaded from their own repositories, **pinned to the version this editor was
 * released with**.
 *
 * They used to name no ref, which meant a push to any of these repositories changed
 * every copy of the editor already in use, and no released version could be rebuilt to
 * behave as it did when it shipped. A tag is what makes a release a release: the editor
 * loads the code this version was tested against, and moving a default forward is a
 * commit here that goes out with the next version, reviewable like any other change.
 *
 * Keep the tags real ones from the plugin's own repository — `resolvePlugin` fetches
 * `raw.githubusercontent.com/<owner>/<repo>/<ref>/plugin.json` verbatim, so a ref that
 * does not exist is a plugin that does not load, and `tests/plugin-network.test.ts` reads
 * every one of them over the network for exactly that reason.
 *
 * Every build compiles these exact versions in rather than fetching them
 * (`scripts/vendor-plugins.mjs`, run by `prebuild` — 890 KB gzipped off a first visit,
 * and no third-party request at startup), which is only sound because they are pinned:
 * bundled and fetched are then the same code. A build that skipped the vendoring
 * (`SCMJS_SKIP_VENDOR=1`, or a fork that does not run it) falls back to fetching them at
 * startup, which still works and is the path these specs describe.
 *
 * One that starts off is still listed (badged *default*, no Remove button); ticking it
 * on is remembered like any other change.
 */
export const DEFAULT_REMOTE_PLUGINS: readonly DefaultPlugin[] = [
  { spec: "github:scm-js/plugin-scm-scx@v1.1.2", enabled: true },
  { spec: "github:scm-js/plugin-repair@v1.1.1", enabled: true },
  { spec: "github:scm-js/plugin-walkability@v1.1.2", enabled: true },
  { spec: "github:scm-js/plugin-image-to-terrain@v1.0.2", enabled: true },
  { spec: "github:scm-js/plugin-paint@v1.0.1", enabled: true },
];

/**
 * The plugin registries the editor browses (Plugins ▸ Browse). One JSON file listing the
 * plugins the project publishes — see `plugins/registry.ts` and `github.com/scm-js/registry`.
 * It is fetched from the same host the plugins themselves come from, on the same terms:
 * being listed there is being *offered*, not being trusted, and installing still goes
 * through the confirmation. The user can add more; a default cannot be removed.
 */
export const DEFAULT_REGISTRIES: readonly string[] = [
  "https://raw.githubusercontent.com/scm-js/registry/main/index.json",
];

/**
 * What makes two specs the same plugin *here*: `pluginIdentity` (the repository behind
 * any version of it), with a bundled copy answering for the spec it was built from.
 *
 * It is the answer to every "is this one already here?" the editor asks — the installed
 * list folding a stored row onto the default it belongs to, Browse choosing between
 * *Install* and *Manage*, and the desktop's `builtin:repair` standing where the web
 * build's `github:scm-js/plugin-repair@v1.0.0` stands, so neither build shows the same
 * plugin twice.
 */
export function pluginKey(spec: string): string {
  const builtin = /^builtin:([\w-]+)$/i.exec(spec.trim());
  const replaced = builtin ? BUILTIN_REPLACES[builtin[1]] : undefined;
  return pluginIdentity(replaced ?? spec);
}

/**
 * Every default, in the order they are listed above.
 *
 * A bundled plugin takes the place of the remote default it was built from — same
 * plugin, same version, no fetch — rather than appearing beside it, so the list reads
 * the same and in the same order whether this build fetches its defaults (every web
 * build) or has them compiled in (the desktop). Anything else in `BUILTIN_PLUGINS` is a
 * plugin a fork put there and follows at the end.
 */
export const defaultPlugins = (): DefaultPlugin[] => {
  const bundled = new Map(Object.keys(BUILTIN_PLUGINS).map((name) => [pluginKey(`builtin:${name}`), `builtin:${name}`]));
  const out = DEFAULT_REMOTE_PLUGINS.map((d) => {
    const spec = bundled.get(pluginKey(d.spec));
    if (spec !== undefined) bundled.delete(pluginKey(d.spec));
    // A bundled copy inherits the answer the remote default gave, so bundling a plugin
    // never turns one on that was meant to start off.
    return { spec: spec ?? d.spec, enabled: d.enabled };
  });
  for (const spec of bundled.values()) out.push({ spec, enabled: true });
  return out;
};

/**
 * The address an update check asks about for an installed plugin, or null when there is
 * nothing to ask — the plugin follows a branch already (Reload is its update), or it came
 * from somewhere with no versions to compare.
 *
 * A *bundled* plugin is the reason this is not simply `isPinned(spec)`. Vendoring swaps a
 * default's spec for `builtin:paint`, which is not pinned and so grew no check button,
 * which made the check appear on every row **except** the ones the editor ships — and only
 * in builds that vendored, so whether a plugin offered an update depended on how the
 * editor showing it was packaged. `BUILTIN_REPLACES` holds the exact spec each copy was
 * built from, which is the address to ask about; nothing is fetched until the user asks.
 *
 * Updating a bundled plugin makes it an ordinary remote one — fetched at startup like any
 * other, which is what the vendoring was avoiding — so `ConfirmPluginDialog` says so
 * before it happens.
 */
export function updateAddress(spec: string): string | null {
  const builtin = /^builtin:([\w-]+)$/i.exec(spec.trim());
  if (builtin) {
    const from = BUILTIN_REPLACES[builtin[1]];
    return from && isPinned(from) ? from : null;
  }
  return isPinned(spec) ? spec : null;
}

/** The defaults' specs, for telling a default row from one the user added. */
export const defaultPluginSpecs = (): string[] => defaultPlugins().map((d) => d.spec);
