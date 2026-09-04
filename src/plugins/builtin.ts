/**
 * Plugins compiled into the editor: every `plugins/<name>/` directory with a
 * `plugin.json` and a `plugin.ts`. Vite bundles them like any other module (the
 * `import.meta.glob` below), so they cost nothing at startup until activated, and they
 * go through the same `activate(api)` contract as a plugin loaded from a repository —
 * minus the fetch, which is exactly what makes them the *less* honest test of the API.
 *
 * The `plugins/` directory is **generated, not committed** (it is gitignored):
 * `scripts/vendor-plugins.mjs` writes each default plugin's own source into it at the
 * version `defaults.ts` pins, and every build runs that first (`prebuild`, and
 * `scripts/build-desktop.mjs` for its own bundle). So the defaults are compiled in rather
 * than fetched — the same code, since they are pinned — which takes 890 KB gzipped off a
 * first visit and lets an installed app, or a container on an intranet, start with all of
 * them and no network. A fork that wants a plugin of its own in the bundle drops a
 * directory in and it is picked up just the same.
 *
 * A vendored plugin carries a `vendored.json` naming the spec it was built from, which
 * is how `defaults.ts#pluginKey` knows `builtin:repair` is the plugin the remote default
 * `github:scm-js/plugin-repair@v1.0.0` names, and so lists it once rather than twice.
 */
import type { PluginManifest } from "./api";
import type { BuiltinPlugin } from "./loader";

const modules = import.meta.glob("../../plugins/*/plugin.ts");
const manifests = import.meta.glob("../../plugins/*/plugin.json", { eager: true, import: "default" }) as Record<string, PluginManifest>;
/** Icon files beside a built-in's manifest: Vite hashes them into the build, so the URL has to come from here. */
const icons = import.meta.glob("../../plugins/*/*.{png,svg,jpg,jpeg,gif,webp,avif,ico}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const vendored = import.meta.glob("../../plugins/*/vendored.json", { eager: true, import: "default" }) as Record<string, { spec?: string }>;

function nameOf(path: string): string {
  const m = /\/plugins\/([^/]+)\//.exec(path);
  return m ? m[1] : path;
}

export const BUILTIN_PLUGINS: Record<string, BuiltinPlugin> = {};
/** Built-in name → the remote spec it was vendored from, for the ones that were. */
export const BUILTIN_REPLACES: Record<string, string> = {};
for (const [path, meta] of Object.entries(vendored)) {
  if (typeof meta?.spec === "string" && meta.spec !== "") BUILTIN_REPLACES[nameOf(path)] = meta.spec;
}
for (const [path, load] of Object.entries(modules)) {
  const name = nameOf(path);
  const manifest = manifests[path.replace(/plugin\.ts$/, "plugin.json")] ?? { name };
  const iconUrl = manifest.icon ? icons[path.replace(/plugin\.ts$/, manifest.icon)] : undefined;
  BUILTIN_PLUGINS[name] = { manifest: { ...manifest, entry: "plugin.ts" }, iconUrl, load: load as () => Promise<unknown> };
}
