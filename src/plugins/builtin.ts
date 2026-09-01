/**
 * The plugins that ship with the editor: every `plugins/<name>/` directory with a
 * `plugin.json` and a `plugin.ts`. Vite bundles them like any other module (the
 * `import.meta.glob` below), so they cost nothing at startup until activated, and they
 * go through the same `activate(api)` contract as a plugin loaded from a repository —
 * which is the point: they are the proof the API can express a real feature.
 */
import type { PluginManifest } from "./api";
import type { BuiltinPlugin } from "./loader";

const modules = import.meta.glob("../../plugins/*/plugin.ts");
const manifests = import.meta.glob("../../plugins/*/plugin.json", { eager: true, import: "default" }) as Record<string, PluginManifest>;
/** Icon files beside a built-in's manifest: Vite hashes them into the build, so the URL has to come from here. */
const icons = import.meta.glob("../../plugins/*/*.{png,svg,jpg,jpeg,gif,webp,avif,ico}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

function nameOf(path: string): string {
  const m = /\/plugins\/([^/]+)\//.exec(path);
  return m ? m[1] : path;
}

export const BUILTIN_PLUGINS: Record<string, BuiltinPlugin> = {};
for (const [path, load] of Object.entries(modules)) {
  const name = nameOf(path);
  const manifest = manifests[path.replace(/plugin\.ts$/, "plugin.json")] ?? { name };
  const iconUrl = manifest.icon ? icons[path.replace(/plugin\.ts$/, manifest.icon)] : undefined;
  BUILTIN_PLUGINS[name] = { manifest: { ...manifest, entry: "plugin.ts" }, iconUrl, load: load as () => Promise<unknown> };
}
