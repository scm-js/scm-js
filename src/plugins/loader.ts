/**
 * Turning a plugin *spec* — what the user typed in Manage Plugins — into a loaded
 * module: parse the spec, fetch the manifest, fetch the entry **as text**, transpile
 * TypeScript, follow relative imports, and hand back `blob:` module URLs.
 *
 * Fetching as text is the whole trick: `raw.githubusercontent.com` serves `text/plain`,
 * which a browser refuses to `import()` as a module, and it is what lets a `.ts` file
 * be transpiled before it runs. Everything that touches the network or the platform
 * comes in through `LoaderDeps`, so `tests/plugins.test.ts` drives this in Node.
 */
import type { PluginIcon, PluginManifest } from "./api";

export type PluginSource =
  | { kind: "builtin"; name: string }
  | {
      kind: "remote";
      /** The `plugin.json` to fetch, or null when the spec named the entry file itself. */
      manifestUrl: string | null;
      /** The entry file, when the spec named it directly. */
      entryUrl: string | null;
      /** Where relative paths resolve from (ends with a slash). */
      base: string;
      /** Short form for the UI. */
      display: string;
    };

export interface BuiltinPlugin {
  manifest: PluginManifest;
  /** The bundled URL of the manifest's `icon`, when it names a file in the plugin's folder. */
  iconUrl?: string;
  load: () => Promise<unknown>;
}

export interface LoaderDeps {
  fetchText: (url: string) => Promise<string>;
  /** TypeScript source → JavaScript (ES modules). */
  transpile: (source: string, fileName: string) => Promise<string>;
  /** JavaScript module source → a URL `importModule` accepts (a `blob:` in the browser). */
  createModuleUrl: (code: string) => string;
  importModule: (url: string) => Promise<unknown>;
  builtins: Record<string, BuiltinPlugin>;
}

export class PluginLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginLoadError";
  }
}

/* ── Specs ──────────────────────────────────────────────── */

const ENTRY_EXT = /\.(?:ts|tsx|mts|js|mjs)$/i;
const DEFAULT_ENTRIES = ["plugin.ts", "plugin.js"];

function dirOf(url: string): string {
  return url.slice(0, url.lastIndexOf("/") + 1);
}

/**
 * `builtin:name`; `github:owner/repo[@ref][/dir]`; a github.com repository URL (with
 * an optional `/tree/ref/dir`); or any URL — a `.json` is the manifest, a script file
 * is the entry, anything else is a directory holding `plugin.json`.
 */
export function parseSpec(spec: string): PluginSource {
  const s = spec.trim();
  if (s === "") throw new PluginLoadError("Enter a plugin location.");

  const builtin = /^builtin:([\w-]+)$/i.exec(s);
  if (builtin) return { kind: "builtin", name: builtin[1] };

  const gh = /^github:([^/@\s]+)\/([^/@\s]+)(?:@([^/\s]+))?(?:\/(.*))?$/i.exec(s);
  if (gh) return githubSource(gh[1], gh[2], gh[3], gh[4]);

  const ghUrl = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/tree\/([^/\s]+)(?:\/(.*?))?)?\/?$/i.exec(s);
  if (ghUrl) return githubSource(ghUrl[1], ghUrl[2], ghUrl[3], ghUrl[4]);

  if (/^https?:\/\//i.test(s)) {
    let url: URL;
    try { url = new URL(s); } catch { throw new PluginLoadError(`Not a valid URL: ${s}`); }
    url.hash = "";
    const path = url.pathname;
    if (/\.json$/i.test(path)) return { kind: "remote", manifestUrl: url.href, entryUrl: null, base: dirOf(url.href), display: s };
    if (ENTRY_EXT.test(path)) return { kind: "remote", manifestUrl: null, entryUrl: url.href, base: dirOf(url.href), display: s };
    const base = url.href.endsWith("/") ? url.href : `${url.href}/`;
    return { kind: "remote", manifestUrl: `${base}plugin.json`, entryUrl: null, base, display: s };
  }

  throw new PluginLoadError(`Unrecognised plugin location "${s}". Paste a GitHub repository link such as https://github.com/owner/repo, the short form github:owner/repo, or a URL to a plugin.json or plugin.ts.`);
}

function githubSource(owner: string, repo: string, ref: string | undefined, dir: string | undefined): PluginSource {
  const sub = dir ? dir.replace(/^\/+|\/+$/g, "") : "";
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${ref ?? "HEAD"}/${sub ? `${sub}/` : ""}`;
  return { kind: "remote", manifestUrl: `${base}plugin.json`, entryUrl: null, base, display: `github:${owner}/${repo}${ref ? `@${ref}` : ""}${sub ? `/${sub}` : ""}` };
}

/* ── Manifest ───────────────────────────────────────────── */

export function validateManifest(raw: unknown, where: string): PluginManifest {
  if (!raw || typeof raw !== "object") throw new PluginLoadError(`${where} is not a JSON object.`);
  const m = raw as Record<string, unknown>;
  if (typeof m.name !== "string" || m.name.trim() === "") throw new PluginLoadError(`${where} needs a "name".`);
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : undefined);
  const out: PluginManifest = { name: m.name.trim() };
  for (const k of ["id", "version", "description", "author", "homepage", "entry", "icon"] as const) {
    const v = str(k);
    if (v !== undefined) out[k] = v;
  }
  if (typeof m.api === "number") out.api = m.api;
  if (out.entry && /^(?:[a-z]+:)?\/\//i.test(out.entry)) throw new PluginLoadError(`${where}: "entry" must be a path relative to the manifest.`);
  return out;
}

/* ── Icons ──────────────────────────────────────────────── */

const IMAGE_EXT = /\.(?:png|svg|jpe?g|gif|webp|avif|ico)$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * A manifest `icon` string as the chrome should show it. Four forms are understood —
 * a short glyph (an emoji), a `data:image/…` URI, an `http(s)` image, and a path
 * relative to the manifest — and nothing else is: any other scheme (`javascript:`
 * above all) and any long non-path string resolve to null and the plugin simply shows
 * the default icon. `base` is where relative paths resolve from; a built-in has none
 * (its file comes through `BuiltinPlugin.iconUrl` instead).
 */
export function resolveIcon(icon: string | undefined, base: string | null): PluginIcon | null {
  const s = icon?.trim();
  if (!s) return null;
  if (/^data:image\//i.test(s) || /^https?:\/\//i.test(s)) return { kind: "image", url: s };
  if (HAS_SCHEME.test(s)) return null;
  if (s.includes("/") || IMAGE_EXT.test(s)) {
    if (!base) return null;
    try { return { kind: "image", url: new URL(s, base).href }; } catch { return null; }
  }
  // Not a path: a glyph, if it is short enough to be one.
  return [...s].length <= 4 ? { kind: "text", text: s } : null;
}

export interface ResolvedPlugin {
  manifest: PluginManifest;
  /** Null for a built-in. */
  entryUrl: string | null;
  /** The manifest's `icon`, resolved against wherever it came from. */
  icon?: PluginIcon;
}

/**
 * The manifest and where its entry file lives.
 *
 * With `entry: false` the entry file is neither probed for nor reported (`entryUrl` is
 * null): that is the *describe* path — everything the chrome shows about a plugin comes
 * out of the manifest, so a listed-but-not-running plugin can be named and described
 * from one JSON fetch without any of its code being fetched, let alone imported.
 */
export async function resolvePlugin(
  source: PluginSource,
  deps: Pick<LoaderDeps, "fetchText" | "builtins">,
  opts: { entry?: boolean } = {},
): Promise<ResolvedPlugin> {
  const wantEntry = opts.entry !== false;
  if (source.kind === "builtin") {
    const b = deps.builtins[source.name];
    if (!b) throw new PluginLoadError(`No built-in plugin called "${source.name}".`);
    const icon = resolveIcon(b.manifest.icon, null) ?? (b.iconUrl ? { kind: "image" as const, url: b.iconUrl } : null);
    return { manifest: b.manifest, entryUrl: null, icon: icon ?? undefined };
  }
  if (source.entryUrl) {
    const file = source.entryUrl.slice(source.entryUrl.lastIndexOf("/") + 1);
    return { manifest: { name: file.replace(ENTRY_EXT, ""), entry: file }, entryUrl: wantEntry ? source.entryUrl : null };
  }
  const manifestUrl = source.manifestUrl!;
  let text: string;
  try {
    text = await deps.fetchText(manifestUrl);
  } catch (err) {
    throw new PluginLoadError(`Could not fetch ${manifestUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new PluginLoadError(`${manifestUrl} is not valid JSON.`); }
  const manifest = validateManifest(json, manifestUrl);
  const icon = resolveIcon(manifest.icon, manifestUrl) ?? undefined;
  if (manifest.entry) return { manifest, entryUrl: wantEntry ? new URL(manifest.entry, manifestUrl).href : null, icon };
  if (!wantEntry) return { manifest, entryUrl: null, icon };
  // No entry named: the first default that exists.
  const errors: string[] = [];
  for (const name of DEFAULT_ENTRIES) {
    const url = new URL(name, manifestUrl).href;
    try {
      await deps.fetchText(url);
      return { manifest: { ...manifest, entry: name }, entryUrl: url, icon };
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new PluginLoadError(`${manifestUrl} names no "entry" and neither default exists (${errors.join("; ")}).`);
}

/* ── Bundling ───────────────────────────────────────────── */

export interface ImportRef {
  specifier: string;
  /** Offsets of the specifier's characters (inside the quotes) in the source. */
  start: number;
  end: number;
}

const IMPORT_RE = /\b(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?(['"])([^'"\n]+)\1|\bimport\s*\(\s*(['"])([^'"\n]+)\3\s*\)/g;

/** Every static and dynamic import specifier in an ES module's source, in order. */
export function findImports(code: string): ImportRef[] {
  const out: ImportRef[] = [];
  for (const m of code.matchAll(IMPORT_RE)) {
    const quote = m[1] ?? m[3];
    const specifier = m[2] ?? m[4];
    const at = m.index + m[0].indexOf(quote + specifier + quote) + 1;
    out.push({ specifier, start: at, end: at + specifier.length });
  }
  return out;
}

export const isRelative = (spec: string) => spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/");
export const isAbsoluteUrl = (spec: string) => /^https?:\/\//i.test(spec);
export const isTypeScript = (url: string) => /\.(?:ts|tsx|mts)(?:[?#].*)?$/i.test(url);

/** Extensions tried for an import that names none, in order. */
const RESOLVE_EXT = [".ts", ".tsx", ".mts", ".js", ".mjs"];

/**
 * The URLs to try for one import specifier, best first.
 *
 * There is no resolver on the other end of a `fetch`: `import { x } from "./convert"` —
 * how TypeScript is normally written — has to become a request for `convert.ts` here,
 * or the plugin gets a 404 for a file it never named. So a specifier with a known
 * extension is taken as it stands (with the `.js` → `.ts` sibling behind it, since a
 * TypeScript project that writes `./convert.js` means the `.ts`), one with none is
 * tried with each extension and then as a directory `index`, and the first that fetches
 * wins. The common case hits on the first candidate; the rest only cost requests when
 * the plugin is already broken.
 */
export function candidateUrls(specifier: string, from: string): string[] {
  const url = new URL(specifier, from).href;
  const out: string[] = [];
  const push = (u: string) => { if (!out.includes(u)) out.push(u); };
  if (ENTRY_EXT.test(new URL(url).pathname)) {
    push(url);
    // `./x.js` in a TypeScript project usually means `./x.ts`.
    for (const [from_, to] of [[".js", ".ts"], [".js", ".tsx"], [".mjs", ".mts"]] as const) {
      if (url.toLowerCase().endsWith(from_)) push(url.slice(0, -from_.length) + to);
    }
    return out;
  }
  for (const ext of RESOLVE_EXT) push(url + ext);
  for (const ext of RESOLVE_EXT) push(`${url.replace(/\/$/, "")}/index${ext}`);
  return out;
}

/** The first candidate that fetches, or an error naming everything that was tried. */
async function fetchFirst(candidates: readonly string[], fetchText: LoaderDeps["fetchText"]): Promise<{ url: string; text: string }> {
  const errors: string[] = [];
  for (const url of candidates) {
    try {
      return { url, text: await fetchText(url) };
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new PluginLoadError(errors.length === 1 ? `Could not fetch ${errors[0]}` : `Could not fetch any of ${errors.join("; ")}`);
}

/**
 * Fetch a module and everything it imports, transpile what is TypeScript, rewrite the
 * import specifiers to module URLs and return the entry's URL. Depth first, one fetch
 * per file (`candidateUrls` may cost a few more for an extensionless import); circular
 * imports and bare package names are refused with the file named.
 */
export async function bundleModule(entryUrl: string, deps: Pick<LoaderDeps, "fetchText" | "transpile" | "createModuleUrl">): Promise<string> {
  const done = new Map<string, string>();
  const inProgress = new Set<string>();

  const visit = async (candidates: readonly string[], stack: string[]): Promise<string> => {
    for (const candidate of candidates) {
      const cached = done.get(candidate);
      if (cached) return cached;
      if (inProgress.has(candidate)) throw new PluginLoadError(`Circular import: ${[...stack, candidate].join(" → ")}`);
    }
    const { url, text } = await fetchFirst(candidates, deps.fetchText);
    inProgress.add(url);
    try {
      let code = isTypeScript(url) ? await deps.transpile(text, url) : text;
      const refs = findImports(code);
      const resolved: string[] = [];
      for (const ref of refs) {
        if (!isRelative(ref.specifier) && !isAbsoluteUrl(ref.specifier)) {
          throw new PluginLoadError(`${url} imports "${ref.specifier}", but plugins cannot import packages — use a relative path, or bundle the dependency into the plugin.`);
        }
        resolved.push(await visit(candidateUrls(ref.specifier, url), [...stack, url]));
      }
      // Rewrite from the end so earlier offsets stay valid.
      for (let i = refs.length - 1; i >= 0; i--) code = code.slice(0, refs[i].start) + resolved[i] + code.slice(refs[i].end);
      const moduleUrl = deps.createModuleUrl(code);
      done.set(url, moduleUrl);
      return moduleUrl;
    } finally {
      inProgress.delete(url);
    }
  };

  return visit([entryUrl], []);
}

/* ── The whole thing ────────────────────────────────────── */

export interface LoadedPlugin {
  source: PluginSource;
  manifest: PluginManifest;
  icon?: PluginIcon;
  module: unknown;
}

export async function loadPlugin(spec: string, deps: LoaderDeps): Promise<LoadedPlugin> {
  const source = parseSpec(spec);
  const { manifest, entryUrl, icon } = await resolvePlugin(source, deps);
  if (source.kind === "builtin") return { source, manifest, icon, module: await deps.builtins[source.name].load() };
  const url = await bundleModule(entryUrl!, deps);
  let module: unknown;
  try {
    module = await deps.importModule(url);
  } catch (err) {
    throw new PluginLoadError(`${manifest.name} failed to load: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { source, manifest, icon, module };
}
