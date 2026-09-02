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
 * default too; today nothing is.
 */
import { BUILTIN_PLUGINS } from "./builtin";

/** A default: its spec, and whether it runs before the user has said anything. */
export interface DefaultPlugin {
  spec: string;
  enabled: boolean;
}

/**
 * Plugins loaded from their own repositories, pinned to no ref so Reload takes the latest.
 * One that starts off is still listed (badged *default*, no Remove button); ticking it on
 * is remembered like any other change.
 */
export const DEFAULT_REMOTE_PLUGINS: readonly DefaultPlugin[] = [
  { spec: "github:scm-js/plugin-image-to-terrain", enabled: true },
  { spec: "github:scm-js/plugin-paint", enabled: false },
  { spec: "github:scm-js/plugin-section-explorer", enabled: false },
  { spec: "github:scm-js/plugin-scm-scx", enabled: true },
];

/** Every default: the built-ins (on), then the remotes. */
export const defaultPlugins = (): DefaultPlugin[] => [
  ...Object.keys(BUILTIN_PLUGINS).map((name) => ({ spec: `builtin:${name}`, enabled: true })),
  ...DEFAULT_REMOTE_PLUGINS,
];

/** The defaults' specs, for telling a default row from one the user added. */
export const defaultPluginSpecs = (): string[] => defaultPlugins().map((d) => d.spec);
