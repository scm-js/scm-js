/**
 * `node scripts/bundle-plugin-runtimes.mjs [outDir]` — copy the runtimes the default plugins
 * fetch at run time into a built bundle (default `dist/`), so the editor carries them.
 * The desktop build (`scripts/build-desktop.mjs`) and the container image run it; the hosted
 * editor does not, and its plugins keep fetching from their CDN.
 *
 * Why: vendoring (`scripts/vendor-plugins.mjs`) compiles the default plugins in, but a
 * plugin's *runtime* is not source — eudplib's is Pyodide and a wheel, about 15 MB, fetched
 * from jsDelivr on the first build. That left the one network dependency in an installed
 * app and an intranet container. The hosted build keeps the CDN on purpose: it is online by
 * definition, and GitHub Pages' bandwidth is better spent on the editor than on 15 MB a user.
 *
 * The plugin says what its runtime is: a `runtime.json` at the root of its repository,
 *
 *   { "plugin": "eudplib", "version": "0.3.0",
 *     "files": [{ "path": "pyodide/pyodide.mjs", "from": "https://cdn.jsdelivr.net/…" },
 *               { "path": "dist/worker.js", "from": "dist/worker.js" }, …] }
 *
 * where `from` is an address, or a path in the repository at the pinned tag. Each file lands
 * at `<outDir>/plugin-runtime/<plugin>/<version>/<path>`, with the manifest beside them —
 * which is what the plugin asks for at activation, at its *own* version, so a plugin updated
 * past the editor's copy goes back to its CDN instead of loading someone else's runtime.
 * A default with no `runtime.json` at its tag has nothing to carry and is skipped.
 *
 * The downloads are kept in the gitignored `plugin-runtimes/`, keyed by spec like
 * `plugins/`, so only the first build after a pin moves touches the network.
 * `SCMJS_SKIP_VENDOR=1` skips this too: the build then carries no runtimes, and the plugins
 * download theirs as the hosted editor's do.
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseDefaultSpecs, parseGithubSpec } from "./vendor-plugins.mjs";

const root = resolve(import.meta.dirname, "..");
const DEFAULTS = resolve(root, "src/plugins/defaults.ts");
const CACHE = resolve(root, "plugin-runtimes");
/** Where in a bundle the runtimes go; the plugins look there, relative to the page. */
export const RUNTIME_DIR = "plugin-runtime";

const headers = { "user-agent": "scm-js bundle-plugin-runtimes" };

/**
 * A manifest checked before any of it is trusted with a path: a plugin name and version
 * that are one directory each, and files that stay inside theirs. Throws on anything else.
 */
export function checkManifest(m, spec) {
  const bad = (why) => { throw new Error(`${spec}: runtime.json ${why}.`); };
  if (!m || typeof m !== "object") bad("is not an object");
  if (typeof m.plugin !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(m.plugin)) bad("names no plugin");
  if (typeof m.version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(m.version)) bad("names no version");
  if (!Array.isArray(m.files) || m.files.length === 0) bad("lists no files");
  const seen = new Set();
  for (const f of m.files) {
    if (!f || typeof f.path !== "string" || typeof f.from !== "string") bad("has a file without a path and a source");
    const parts = f.path.split("/");
    if (f.path === "runtime.json" || parts.some((p) => p === "" || p === "." || p === "..") || /[\\:]/.test(f.path)) bad(`has a file at "${f.path}"`);
    if (seen.has(f.path)) bad(`lists "${f.path}" twice`);
    seen.add(f.path);
    if (/^[a-z][a-z0-9+.-]*:/i.test(f.from) && !f.from.startsWith("https://")) bad(`fetches "${f.from}", which is not https`);
  }
  return m;
}

/** Where a file comes from: an address as it is, a repository path at the pinned tag. */
export function sourceUrl(from, gh) {
  if (from.startsWith("https://")) return from;
  const under = gh.dir ? `${gh.dir.replace(/^\/+|\/+$/g, "")}/` : "";
  return `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${gh.ref}/${under}${from.replace(/^\/+/, "")}`;
}

async function get(url) {
  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

const exists = (path) => stat(path).then(() => true, () => false);

/** The cached copy for a spec, fetched if it is not all there. Null when the plugin carries no runtime. */
async function fetchRuntime(spec, log) {
  const gh = parseGithubSpec(spec);
  if (!gh) throw new Error(`${spec} is not a pinned GitHub spec (see defaults.ts).`);
  const dir = resolve(CACHE, `${gh.owner}-${gh.repo}@${gh.ref}`.replace(/[^A-Za-z0-9@._-]/g, "_"));
  const cached = await readFile(resolve(dir, "runtime.json"), "utf8").then((t) => JSON.parse(t), () => null);
  if (cached) {
    const m = checkManifest(cached, spec);
    if ((await Promise.all(m.files.map((f) => exists(resolve(dir, f.path))))).every(Boolean)) {
      log(`  ${m.plugin.padEnd(18)} ${m.version.padEnd(8)} already here`);
      return { dir, manifest: m };
    }
  }
  const raw = await get(sourceUrl("runtime.json", gh));
  if (!raw) return null;
  const m = checkManifest(JSON.parse(raw.toString("utf8")), spec);
  await rm(dir, { recursive: true, force: true });
  let bytes = 0;
  for (const f of m.files) {
    const url = sourceUrl(f.from, gh);
    const body = await get(url);
    if (!body) throw new Error(`${spec}: ${url} is not there (runtime.json lists it as ${f.path}).`);
    const target = resolve(dir, f.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    bytes += body.length;
  }
  // Last, so a copy interrupted part way is fetched again rather than taken as whole.
  await writeFile(resolve(dir, "runtime.json"), raw);
  log(`  ${m.plugin.padEnd(18)} ${m.version.padEnd(8)} ${m.files.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
  return { dir, manifest: m };
}

/**
 * Put every default plugin's runtime into `outDir/plugin-runtime/`, replacing whatever an
 * earlier run left there, and drop cached copies no default names any more. Throws on the
 * first failure: a desktop build quietly missing its runtime would only show itself on a
 * user's first offline build.
 */
export async function bundleRuntimes({ outDir = resolve(root, "dist"), log = console.log } = {}) {
  if (!(await exists(resolve(outDir, "index.html")))) throw new Error(`${outDir} holds no built editor; build it first.`);
  const defaults = parseDefaultSpecs(await readFile(DEFAULTS, "utf8"));
  log(`Plugin runtimes into ${resolve(outDir, RUNTIME_DIR)}`);
  const target = resolve(outDir, RUNTIME_DIR);
  await rm(target, { recursive: true, force: true });
  const kept = new Set();
  const done = [];
  for (const { spec } of defaults) {
    const got = await fetchRuntime(spec, log);
    if (!got) continue;
    kept.add(got.dir);
    const into = resolve(target, got.manifest.plugin, got.manifest.version);
    await mkdir(into, { recursive: true });
    for (const f of got.manifest.files) {
      await mkdir(dirname(resolve(into, f.path)), { recursive: true });
      await cp(resolve(got.dir, f.path), resolve(into, f.path));
    }
    await cp(resolve(got.dir, "runtime.json"), resolve(into, "runtime.json"));
    done.push({ spec, plugin: got.manifest.plugin, version: got.manifest.version });
  }
  for (const name of await readdir(CACHE).catch(() => [])) {
    const dir = resolve(CACHE, name);
    if (!kept.has(dir)) await rm(dir, { recursive: true, force: true });
  }
  if (done.length === 0) log("  (no default plugin carries a runtime)");
  return done;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.env.SCMJS_SKIP_VENDOR === "1") {
    console.log("bundle-plugin-runtimes: SCMJS_SKIP_VENDOR=1 — carrying no runtimes; the plugins will download theirs.");
    process.exit(0);
  }
  try {
    await bundleRuntimes({ outDir: resolve(process.cwd(), process.argv[2] ?? resolve(root, "dist")) });
  } catch (err) {
    console.error(`bundle-plugin-runtimes: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
