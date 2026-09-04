/**
 * `npm run vendor:plugins` — write the default plugins' own source into `plugins/`, at
 * the versions `src/plugins/defaults.ts` pins, so the build can compile them in. Every
 * build runs it (`prebuild`, and `scripts/build-desktop.mjs` for its own bundle).
 *
 * Why: the defaults used to be fetched from their repositories at the start of every
 * session, and that cost more than it looked. A `.ts` plugin has to be transpiled before
 * the browser will import it, one transpile starts the compile worker, and TypeScript is
 * inlined into that worker — so five default plugins pulled **3.4 MB (975 KB gzipped)**
 * of compiler onto the cold path, plus twenty cross-origin requests. Measured on the
 * production build, a first visit went from 1235 KB gzipped to 344 KB by compiling them
 * in. It is all or nothing: one remote `.ts` default starts the worker and costs the lot.
 *
 * The rest follows from that. An installed application stops needing the network at all
 * (its game data is already on the disk, and Repair checks every map that opens). The
 * container image works on an intranet, and so does any browser behind a proxy that does
 * not allow raw.githubusercontent.com. Nothing is fetched from a third party at startup.
 *
 * It is only sound because the defaults are pinned: `github:scm-js/plugin-repair@v1.0.0`
 * and the copy taken from that tag are the same code, so a bundled build and a fetching
 * one behave identically. Never vendor from a moving ref — the check below refuses one —
 * or the two drift apart with nothing to show it.
 *
 * What it costs: the remote loading path is no longer exercised by simply starting the
 * editor, which it used to be on every session. `tests/plugin-network.test.ts` is the
 * deliberate replacement — a real plugin fetched, transpiled and imported over the
 * network, run in CI.
 *
 * What lands in `plugins/<name>/` is the plugin's runtime source and nothing else: the
 * manifest, the icon, every `.ts`/`.js` file outside the excluded directories, and the
 * LICENSE (all five are MIT, and the copy travels with it). The source, not the plugin's
 * own `dist/plugin.js`: Vite compiles what lands here into the app's chunk graph and
 * tree-shakes it, which a prebuilt bundle would defeat — `dist/` is in `SKIP_DIRS` for
 * that reason, and the manifest's `build` is ignored by `builtin.ts`. `@scm-js/plugin-api`
 * comes in the same way it does for a plugin's own build: not at all, because plugins
 * import it with `import type`, which is erased before the bundler ever resolves it. If a
 * plugin ever imports a *value* from a package, this build fails loudly, which is correct
 * — and that plugin should ship a `build` and stop being vendored as source.
 *
 * The directory is gitignored and generated. `--clean` empties it again.
 *
 *   node scripts/vendor-plugins.mjs             # bring plugins/ up to the pinned defaults
 *   node scripts/vendor-plugins.mjs --force     # fetch again even where the spec matches
 *   node scripts/vendor-plugins.mjs --clean     # remove plugins/ and stop
 *   node scripts/vendor-plugins.mjs --list      # print what would be vendored
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const DEFAULTS = resolve(root, "src/plugins/defaults.ts");

/** Directories and files that are not the plugin's runtime source. */
const SKIP_DIRS = ["plugin-api/", "node_modules/", "tests/", "test/", "dist/", ".github/", ".git/"];
const SKIP_FILES = [/^package(-lock)?\.json$/, /^tsconfig.*\.json$/, /^vitest\.config\./, /^README/i, /^\./, /\.test\.[cm]?[jt]sx?$/, /\.d\.ts$/];
const KEEP = [/\.[cm]?[jt]sx?$/, /^plugin\.json$/, /\.(svg|png|jpe?g|gif|webp|avif|ico)$/i, /^LICENSE/];

/**
 * The pinned defaults, read out of `defaults.ts` rather than imported: that module pulls
 * in `builtin.ts`, whose `import.meta.glob` only exists inside Vite. The shape it looks
 * for is the one the file is written in, and it throws rather than guessing, so a
 * default that stops matching stops the build instead of quietly not being vendored.
 */
export function parseDefaultSpecs(source) {
  const block = /DEFAULT_REMOTE_PLUGINS[^=]*=\s*\[([\s\S]*?)\]/.exec(source);
  if (!block) throw new Error("Could not find DEFAULT_REMOTE_PLUGINS in defaults.ts.");
  const out = [];
  for (const m of block[1].matchAll(/\{\s*spec:\s*"([^"]+)"\s*,\s*enabled:\s*(true|false)\s*\}/g)) {
    out.push({ spec: m[1], enabled: m[2] === "true" });
  }
  if (out.length === 0) throw new Error("DEFAULT_REMOTE_PLUGINS lists no plugins in the expected shape.");
  return out;
}

/** `github:owner/repo@ref[/dir]` → its parts, or null for anything else. */
export function parseGithubSpec(spec) {
  const m = /^github:([^/@\s]+)\/([^/@\s]+)@([^/\s]+)(?:\/(.*))?$/i.exec(spec.trim());
  return m ? { owner: m[1], repo: m[2], ref: m[3], dir: m[4] ?? "" } : null;
}

/** The `plugins/<name>/` a spec is vendored into: the repository without its `plugin-` prefix. */
export const dirNameFor = (repo) => repo.replace(/^plugin-/i, "").toLowerCase();

/** True for a path worth compiling in. */
export function keepPath(path) {
  if (SKIP_DIRS.some((d) => path.startsWith(d) || path.includes(`/${d}`))) return false;
  const file = path.slice(path.lastIndexOf("/") + 1);
  if (SKIP_FILES.some((r) => r.test(file))) return false;
  return KEEP.some((r) => r.test(file));
}

const headers = { "user-agent": "scm-js vendor-plugins" };
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
if (token) headers.authorization = `Bearer ${token}`;

async function get(url, kind = "text") {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  return kind === "json" ? res.json() : Buffer.from(await res.arrayBuffer());
}

/** What a directory was last vendored from, or null when it holds no copy of ours. */
async function vendoredSpec(dir) {
  try {
    const meta = JSON.parse(await readFile(resolve(dir, "vendored.json"), "utf8"));
    return typeof meta.spec === "string" ? meta.spec : null;
  } catch {
    return null;
  }
}

async function vendorOne({ spec }, outRoot, log, force) {
  const gh = parseGithubSpec(spec);
  if (!gh) throw new Error(`${spec} is not a pinned GitHub spec; a default has to name a tag or commit to be vendored (see defaults.ts).`);
  const dir = resolve(outRoot, dirNameFor(gh.repo));
  // A pinned spec names code that cannot change, so a copy of the same spec is already
  // the answer. That is what keeps an ordinary `npm run build` off the network: only the
  // first one after a clone, or after a pin moves, fetches anything.
  if (!force && (await vendoredSpec(dir)) === spec) {
    log(`  ${dirNameFor(gh.repo).padEnd(18)} ${gh.ref.padEnd(8)} already here`);
    return { spec, dir: dirNameFor(gh.repo), files: 0, bytes: 0, skipped: true };
  }
  const tree = await get(`https://api.github.com/repos/${gh.owner}/${gh.repo}/git/trees/${encodeURIComponent(gh.ref)}?recursive=1`, "json");
  if (tree.truncated) throw new Error(`${spec}: GitHub truncated the file list; the repository is too large to vendor this way.`);
  const under = gh.dir ? `${gh.dir.replace(/^\/+|\/+$/g, "")}/` : "";
  const files = tree.tree
    .filter((e) => e.type === "blob" && e.path.startsWith(under))
    .map((e) => ({ path: e.path, rel: e.path.slice(under.length) }))
    .filter((e) => keepPath(e.rel));
  if (!files.some((f) => f.rel === "plugin.json")) throw new Error(`${spec}: no plugin.json at ${gh.ref}.`);
  if (!files.some((f) => f.rel === "plugin.ts")) throw new Error(`${spec}: no plugin.ts at ${gh.ref}; only a TypeScript entry can be compiled in.`);

  await rm(dir, { recursive: true, force: true });
  let bytes = 0;
  for (const f of files) {
    const body = await get(`https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${gh.ref}/${f.path}`);
    const target = resolve(dir, f.rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    bytes += body.length;
  }
  // What `builtin.ts` reads to know this copy stands in for the remote default, so the
  // installed list shows the plugin once rather than as a built-in beside a remote.
  await writeFile(resolve(dir, "vendored.json"), `${JSON.stringify({ spec, files: files.length, at: new Date().toISOString() }, null, 2)}\n`);
  log(`  ${dirNameFor(gh.repo).padEnd(18)} ${gh.ref.padEnd(8)} ${files.length} files, ${Math.round(bytes / 1024)} KB`);
  return { spec, dir: dirNameFor(gh.repo), files: files.length, bytes };
}

/**
 * Vendor every pinned default into `outRoot`, and drop any copy of ours that is no longer
 * one — a plugin dropped from the defaults, or a version left behind by a pin that moved.
 * A directory without a `vendored.json` was put there by hand and is left alone.
 *
 * Throws on the first failure, and the build stops with it: a bundle quietly missing the
 * plugins it is supposed to have is exactly the silence this whole change is against.
 */
export async function vendorPlugins({ outRoot = resolve(root, "plugins"), log = console.log, force = false } = {}) {
  const defaults = parseDefaultSpecs(await readFile(DEFAULTS, "utf8"));
  log(`Default plugins (${defaults.length}) in ${outRoot}`);
  const done = [];
  for (const d of defaults) done.push(await vendorOne(d, outRoot, log, force));
  const wanted = new Set(done.map((d) => d.dir));
  for (const name of await readdir(outRoot, { withFileTypes: true }).catch(() => [])) {
    if (!name.isDirectory() || wanted.has(name.name)) continue;
    const dir = resolve(outRoot, name.name);
    if ((await vendoredSpec(dir)) === null) continue;
    await rm(dir, { recursive: true, force: true });
    log(`  ${name.name.padEnd(18)} removed (no longer a default)`);
  }
  return done;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const argv = process.argv.slice(2);
  const outRoot = resolve(root, "plugins");
  // The deliberate way out, for a build with no network and no copy yet: the editor then
  // fetches its defaults at startup as it used to, which still works — it is only slower
  // and needs the browser to reach GitHub. Anything else that goes wrong is an error.
  if (process.env.SCMJS_SKIP_VENDOR === "1" && !argv.includes("--clean")) {
    console.log("vendor-plugins: SCMJS_SKIP_VENDOR=1 — leaving plugins/ alone; the build will fetch its defaults at startup.");
    process.exit(0);
  }
  try {
    if (argv.includes("--clean")) {
      await rm(outRoot, { recursive: true, force: true });
      console.log(`Removed ${outRoot}`);
    } else if (argv.includes("--list")) {
      for (const d of parseDefaultSpecs(await readFile(DEFAULTS, "utf8"))) console.log(d.spec);
    } else {
      await vendorPlugins({ outRoot, force: argv.includes("--force") });
    }
  } catch (err) {
    console.error(`vendor-plugins: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
