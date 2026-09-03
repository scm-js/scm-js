/**
 * `npm run build:plugin-types`: the typings a plugin repository vendors as `plugin-api/`.
 *
 * `tsc -p tsconfig.plugin-api.json` emits a declaration for every file its program
 * reaches, which is far more than the contract needs (and drags Jotai atoms in through
 * the editor's own modules). So: emit, then keep only what `plugins/api.d.ts` reaches
 * through its imports, refuse a tree that still names `jotai` or `react` (a plugin
 * repository must not need either to compile), and put an `index.d.ts` and a
 * `package.json` at the top so `import type { PluginApi } from "./plugin-api"` works and
 * the copy says which editor and API version it came from.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "plugin-api");
const entry = "plugins/api.d.ts";

rmSync(out, { recursive: true, force: true });
execSync("npx tsc -p tsconfig.plugin-api.json", { cwd: root, stdio: "inherit" });

/** Every `.d.ts` under `out`, relative, forward slashes. */
function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else if (p.endsWith(".d.ts")) files.push(relative(out, p).split("\\").join("/"));
  }
  return files;
}

/** Relative specifiers a declaration file imports (`from "…"`, `import("…")`, `export … from "…"`). */
function specifiers(file) {
  const text = readFileSync(join(out, file), "utf8");
  const found = new Set();
  for (const m of text.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)) found.add(m[1]);
  return [...found];
}

const all = new Set(walk(out));
const keep = new Set();
const external = new Map();
const queue = [entry];
while (queue.length > 0) {
  const file = queue.pop();
  if (keep.has(file)) continue;
  keep.add(file);
  for (const spec of specifiers(file)) {
    if (!spec.startsWith(".")) { external.set(spec, [...(external.get(spec) ?? []), file]); continue; }
    const target = relative(out, resolve(out, dirname(file), spec)).split("\\").join("/") + ".d.ts";
    if (all.has(target)) queue.push(target);
    else console.warn(`plugin-api: ${file} imports ${spec}, which was not emitted`);
  }
}

for (const file of all) if (!keep.has(file)) rmSync(join(out, file));
// Directories left empty by the pruning.
function sweep(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { sweep(p); if (readdirSync(p).length === 0) rmSync(p, { recursive: true }); }
  }
}
sweep(out);

const forbidden = [...external.keys()].filter((s) => s === "jotai" || s.startsWith("jotai/") || s === "react" || s.startsWith("react/"));
if (forbidden.length > 0) {
  for (const s of forbidden) console.error(`plugin-api: the contract reaches "${s}" through ${external.get(s).join(", ")}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const apiVersion = Number(/PLUGIN_API_VERSION\s*=\s*(\d+)/.exec(readFileSync(join(root, "src/plugins/api.ts"), "utf8"))?.[1] ?? 0);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.d.ts"), `export * from "./plugins/api";\n`);
writeFileSync(join(out, "package.json"), JSON.stringify({
  name: "scm-js-plugin-api",
  version: `${apiVersion}.0.0-editor.${pkg.version}`,
  description: "Type declarations of the scmJS plugin API (vendored; regenerate with `npm run build:plugin-types` in scm-js)",
  types: "index.d.ts",
  private: true,
  scmjs: { pluginApiVersion: apiVersion, editorVersion: pkg.version, builtAt: new Date().toISOString() },
}, null, 2) + "\n");
const kept = [...keep].sort();
console.log(`plugin-api: ${kept.length} declaration files kept of ${all.size}; external: ${[...external.keys()].sort().join(", ") || "none"}`);
if (!existsSync(join(out, entry))) process.exit(1);
