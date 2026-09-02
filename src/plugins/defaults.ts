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

/** Plugins loaded from their own repositories, pinned to no ref so Reload takes the latest. */
export const DEFAULT_REMOTE_PLUGINS: readonly string[] = ["github:scm-js/plugin-image-to-terrain", "github:scm-js/plugin-paint"];

/** Every spec that is installed unless the user says otherwise: the built-ins, then the remotes. */
export const defaultPluginSpecs = (): string[] => [
  ...Object.keys(BUILTIN_PLUGINS).map((name) => `builtin:${name}`),
  ...DEFAULT_REMOTE_PLUGINS,
];
