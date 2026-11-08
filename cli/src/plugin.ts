/**
 * `scmjs plugin new | check | dev`: writing a plugin for the editor (docs/plugins.md, .claude/internals/cli.md).
 *
 * - `new` writes a plugin to start from, set up as the project's own are (Hello World's layout: manifest, source,
 *   Korean catalogue and its test, typings, build, the shared CI).
 * - `check` reads the plugin as the editor would load it (`validateManifest`, the file it would import, the imports
 *   it would refuse) and says what would go wrong, for a person or a CI step.
 * - `dev` serves the folder on the loopback address, builds it when it names a build, and opens the editor with
 *   `?plugin-dev=` (src/hooks/usePluginDev.ts), which installs it the usual way the first time and reloads it on
 *   every change the page is told of here.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { PLUGIN_API_VERSION } from "../../src/plugins/api";
import { resolveIcon, validateManifest } from "../../src/plugins/loader";
import { VERSION } from "./about";
import { EDITOR_URL, openBrowser } from "./open";
import { t } from "./i18n";
import { CliError, dot, mark, pc, print } from "./ui";

/* ── new ───────────────────────────────────────────────── */

/** `Base Check` → `base-check`. */
export const pluginId = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "my-plugin";
/** `base-check` or `plugin-base-check` → `Base Check`. */
export const nameFromFolder = (folder: string) => basename(folder).replace(/^(?:scmjs-)?plugin-/, "").split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || "My Plugin";

function gitUser(): string {
  const r = spawnSync("git", ["config", "user.name"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

/** The files of a new plugin, by path. */
export function pluginFiles(o: { name: string; id: string; author: string; year: number }): Record<string, string> {
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  const lit = JSON.stringify(o.name);
  return {
    "plugin.json": json({
      name: o.name, id: o.id, version: "0.1.0",
      description: `${o.name}: a plugin for the scmJS map editor.`,
      ...(o.author ? { author: o.author } : {}),
      entry: "plugin.ts", build: "dist/plugin.js", icon: "🧩", api: PLUGIN_API_VERSION,
    }),
    "plugin.ts": `/**
 * ${o.name}: a plugin for the scmJS map editor.
 *
 * It adds Tools ▸ ${o.name}…, which opens a pane about the map that is open. Change it into your own; the API is
 * documented at https://docs.scmjs.dev/plugins/.
 *
 *   npm start           the editor with this plugin, reloaded each time you save (scmjs plugin dev)
 *   npm test            the tests, including the one that keeps ko.ts complete
 *   npm run check       what the editor would make of this folder (scmjs plugin check)
 */
import type { PluginApi } from "@scm-js/plugin-api";
import { KO } from "./ko";

export default function activate(api: PluginApi) {
  // The Korean for what the plugin shows (ko.ts). English is the key: pass every string to t() as a literal.
  api.i18n.register({ ko: KO });
  const t = api.i18n.t;

  api.menu.add("Tools", {
    label: ${JSON.stringify(`${o.name}…`)},
    enabled: () => api.document.isOpen(),
    run: () => {
      const info = api.document.info();
      const units = api.document.scenario()?.units.length ?? 0;
      api.ui.dialog({
        title: ${lit},
        size: "sm",
        mount(body) {
          // Plain DOM: the editor gives the plugin an empty element to fill.
          const name = document.createElement("p");
          name.textContent = info?.name ?? ""; // the map's own text, never translated
          const count = document.createElement("p");
          count.textContent = t("{n, plural, one {# unit} other {# units}} on the map", { n: units });
          body.append(name, count);
        },
        buttons: [{ label: t("Close") }],
      });
    },
  });
}
`,
    "ko.ts": `// Korean for every string the plugin shows; English is the key. tests/ko.test.ts keeps it complete.
export const KO: Record<string, string> = {
  "Close": "닫기",
  "{n, plural, one {# unit} other {# units}} on the map": "맵의 유닛 {n, plural, other {#개}}",
};
`,
    "tests/ko.test.ts": `import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KO } from "../ko";

// Every string the plugin shows through \`t("…")\`, or hands the editor as \`msg("…")\`, read from the source.
// A plugin with more files lists them here.
const files = ["plugin.ts"];
const sources = files.map((f) => readFileSync(new URL(\`../\${f}\`, import.meta.url), "utf8"));
const keys = new Set(sources.flatMap((source) => [...source.matchAll(/\\b(?:t|msg)\\("((?:[^"\\\\]|\\\\.)*)"/g)].map((m) => JSON.parse(\`"\${m[1]}"\`) as string)));

describe("the Korean catalogue", () => {
  it("has every string the plugin shows", () => {
    expect([...keys].filter((k) => !(k in KO))).toEqual([]);
  });
  it("has nothing the plugin no longer shows", () => {
    expect(Object.keys(KO).filter((k) => !keys.has(k))).toEqual([]);
  });
});
`,
    "package.json": json({
      name: `scmjs-plugin-${o.id}`, version: "0.1.0", private: true,
      description: `${o.name}: a plugin for the scmJS map editor.`,
      ...(o.author ? { author: o.author } : {}), license: "MIT", type: "module",
      scripts: {
        start: "scmjs plugin dev",
        check: "scmjs plugin check",
        build: "esbuild plugin.ts --bundle --format=esm --target=es2022 --platform=browser --outfile=dist/plugin.js --banner:js=\"// Generated by npm run build - do not edit; the source is plugin.ts.\"",
        typecheck: "tsc -p tsconfig.json",
        test: "vitest run",
      },
      devDependencies: {
        "@scm-js/cli": `^${VERSION}`,
        "@scm-js/plugin-api": `^${PLUGIN_API_VERSION}`,
        esbuild: "^0.28.2",
        typescript: "~6.0.2",
        vitest: "^5.1.0",
      },
    }),
    "tsconfig.json": json({
      compilerOptions: {
        target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], module: "ESNext", moduleResolution: "bundler", types: [],
        strict: true, noUnusedLocals: true, noUnusedParameters: true, verbatimModuleSyntax: true, erasableSyntaxOnly: true,
        isolatedModules: true, skipLibCheck: true, noEmit: true,
      },
      include: ["plugin.ts", "ko.ts"],
    }),
    ".gitignore": "node_modules/\n*.tsbuildinfo\n",
    ".github/workflows/ci.yml": `# Type-check, test, and build dist/plugin.js, the bundle the editor loads (\`build\` in plugin.json), with the
# workflow every scm-js plugin uses: on a push to main it commits the rebuilt bundle, on a v* tag it checks the
# committed one matches, and weekly it type-checks against the newest @scm-js/plugin-api.
name: CI

on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:
  schedule:
    - cron: "0 6 * * 1"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  ci:
    uses: scm-js/.github/.github/workflows/plugin-ci.yml@main
`,
    "README.md": `# ${o.name}

A plugin for [scmJS](https://scmjs.dev/editor/), the StarCraft: Brood War map editor.

## Developing

\`\`\`sh
npm install
npm start          # opens the editor with the plugin, and reloads it each time you save
\`\`\`

\`npm test\` runs the tests, \`npm run typecheck\` the type-check, and \`npm run check\` says what the editor would
make of the folder. The plugin guide is at [docs.scmjs.dev/plugins](https://docs.scmjs.dev/plugins/).

## Installing

Once this is a public GitHub repository, paste \`github:<you>/<repository>\` into Plugins ▸ Manage Plugins….
Tag releases (\`v1.0.0\`): they are what the editor's update check offers.
`,
    LICENSE: `MIT License

Copyright (c) ${o.year} ${o.author || "the authors"}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  };
}

/** `scmjs plugin new [name]`: a folder `plugin-<id>` (or `--dir`) with a plugin to start from. */
export function newPlugin(o: { name?: string; dir?: string }): { dir: string; files: string[] } {
  const name = (o.name?.trim() || (o.dir ? nameFromFolder(resolve(o.dir)) : "")).slice(0, 64);
  if (!name) throw new CliError(t("Name the plugin"), t("scmjs plugin new \"Base Check\"  (or --dir <folder>)"), 2);
  const id = pluginId(name);
  const dir = resolve(o.dir ?? `plugin-${id}`);
  if (existsSync(dir) && readdirSync(dir).filter((f) => f !== ".git").length > 0) throw new CliError(t("{dir} is not empty", { dir: relative(process.cwd(), dir) || "." }), t("Give an empty or new folder with --dir."), 2);
  const files = pluginFiles({ name, id, author: gitUser(), year: new Date().getFullYear() });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return { dir, files: Object.keys(files) };
}

/* ── check ─────────────────────────────────────────────── */

export interface PluginIssue { level: "error" | "warn" | "info"; message: string; hint?: string }
export interface PluginCheck { dir: string; name: string | null; id: string | null; version: string | null; loads: string | null; issues: PluginIssue[] }

const SOURCE_EXT = [".ts", ".tsx", ".mts", ".js", ".mjs"];

/** The imports of a source file the editor would follow or refuse (type-only imports are erased first). */
export function sourceImports(code: string): string[] {
  const text = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const out: string[] = [];
  const re = /\b(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s*)?(['"])([^'"\n]+)\3|\bimport\s*\(\s*(['"])([^'"\n]+)\5\s*\)/g;
  for (const m of text.matchAll(re)) {
    if (m[2]) continue; // import type … / export type …
    out.push(m[4] ?? m[6]);
  }
  return out;
}

/** The file a relative import names, as the editor's loader looks for it (`./x`, `./x.js` meaning `x.ts`, `./dir`). */
function importedFile(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  const tries = [base, ...SOURCE_EXT.map((e) => base + e), base.replace(/\.js$/, ".ts"), ...SOURCE_EXT.map((e) => join(base, "index" + e))];
  return tries.find((f) => existsSync(f) && statSync(f).isFile()) ?? null;
}

const newest = (dir: string, skip: Set<string>): number => {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules" || skip.has(join(dir, e.name))) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) t = Math.max(t, newest(p, skip));
    else if (SOURCE_EXT.includes(extname(e.name)) && !e.name.endsWith(".d.ts") && !p.includes(`${sep}tests${sep}`)) t = Math.max(t, statSync(p).mtimeMs);
  }
  return t;
};

/** `scmjs plugin check`: the plugin in `dir` as the editor would load it. */
export function checkPlugin(dirArg = "."): PluginCheck {
  const dir = resolve(dirArg);
  const out: PluginCheck = { dir, name: null, id: null, version: null, loads: null, issues: [] };
  const add = (level: PluginIssue["level"], message: string, hint?: string) => out.issues.push({ level, message, ...(hint ? { hint } : {}) });
  const file = join(dir, "plugin.json");
  if (!existsSync(file)) throw new CliError(relative(process.cwd(), dir) ? t("No plugin.json in {dir}", { dir: relative(process.cwd(), dir) }) : t("No plugin.json in this folder"), t("Run this in the plugin's folder, or start one with scmjs plugin new."), 2);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (e) { add("error", t("plugin.json is not valid JSON: {message}", { message: (e as Error).message })); return out; }
  let m;
  try { m = validateManifest(raw, "plugin.json"); } catch (e) { add("error", (e as Error).message); return out; }
  out.name = m.name; out.id = m.id ?? pluginId(m.name); out.version = m.version ?? null;

  if (m.api === undefined) add("warn", t("plugin.json names no \"api\""), t("Add \"api\": {version}, so an older editor says it is too old instead of failing.", { version: PLUGIN_API_VERSION }));
  else if (m.api > PLUGIN_API_VERSION) add("error", t("It needs plugin API {api}; the editor provides {version}", { api: m.api, version: PLUGIN_API_VERSION }));
  if (!m.id) add("info", t("No \"id\": the editor uses \"{id}\", made from the name", { id: out.id }), t("An id keeps storage and commands the same if the name changes."));
  for (const k of ["version", "description", "author", "homepage"] as const) if (!m[k]) add("info", t("No \"{field}\": shown when someone adds the plugin", { field: k }));

  const icon = resolveIcon(m.icon, "file:///plugin/plugin.json");
  if (!m.icon) add("info", t("No \"icon\": the default plugin mark is shown"));
  else if (!icon) add("warn", t("The icon \"{icon}\" is not one the editor shows", { icon: m.icon }), t("An image beside plugin.json, an https or data: image, or up to four characters."));
  else if (icon.kind === "image" && icon.url.startsWith("file:///plugin/") && !existsSync(join(dir, decodeURIComponent(icon.url.slice("file:///plugin/".length))))) add("error", t("The icon {icon} is not in the folder", { icon: m.icon }));

  const entry = m.entry ?? ["plugin.ts", "plugin.js"].find((f) => existsSync(join(dir, f)));
  const entryFile = entry ? join(dir, entry) : null;
  if (!entryFile || !existsSync(entryFile)) add("error", entry ? t("The entry {entry} is not there", { entry }) : t("No \"entry\", and neither plugin.ts nor plugin.js is there"));

  if (m.build) {
    const built = join(dir, m.build);
    out.loads = m.build;
    if (!existsSync(built)) add("error", entry ? t("The build {build} is not there, and the editor loads it instead of {entry}", { build: m.build, entry }) : t("The build {build} is not there, and the editor loads it instead of the source", { build: m.build }), existsSync(join(dir, "package.json")) ? t("Run npm run build (scmjs plugin dev builds it for you).") : t("Build it, or take \"build\" out of plugin.json."));
    else if (newest(dir, new Set([built])) > statSync(built).mtimeMs + 1000) add("warn", t("{build} is older than the source", { build: m.build }), t("Run npm run build, or the editor loads what it was."));
  } else if (entryFile && existsSync(entryFile)) {
    out.loads = entry!;
    // Without a build the editor compiles the source file by file: relative imports must be there, packages cannot be.
    const seen = new Set<string>(), todo = [entryFile];
    while (todo.length) {
      const f = todo.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const spec of sourceImports(readFileSync(f, "utf8"))) {
        if (/^(?:\.{1,2}\/|\/)/.test(spec)) {
          const to = importedFile(f, spec);
          if (to) todo.push(to);
          else add("error", t("{file} imports {spec}, which is not there", { file: relative(dir, f), spec }));
        } else if (!/^https?:\/\//.test(spec)) add("error", t("{file} imports the package \"{spec}\"", { file: relative(dir, f), spec }), t("The editor loads source without a module resolver: bundle the plugin and name the bundle as \"build\"."));
      }
    }
  }
  if (out.issues.some((i) => i.level === "error")) out.loads = null;
  return out;
}

export function printPluginCheck(c: PluginCheck, all: boolean): string[] {
  const shown = c.issues.filter((i) => all || i.level !== "info");
  const errors = c.issues.filter((i) => i.level === "error").length, warns = c.issues.filter((i) => i.level === "warn").length;
  const head = `${pc.bold(c.name ?? basename(c.dir))}${c.version ? pc.dim(` ${c.version}`) : ""}  ${errors ? `${mark.error} ${t("{n, plural, one {# error} other {# errors}}", { n: errors })}` : warns ? `${mark.warn} ${t("{n, plural, one {# warning} other {# warnings}}", { n: warns })}` : `${mark.ok} ${t("loads")}`}${c.loads && !errors ? pc.dim(` (${c.loads})`) : ""}`;
  const order = { error: 0, warn: 1, info: 2 };
  return [head, ...shown.sort((a, b) => order[a.level] - order[b.level]).flatMap((i) => [
    `  ${i.level === "error" ? mark.error : i.level === "warn" ? mark.warn : mark.info} ${i.message}`,
    ...(i.hint ? [pc.dim(`    ${i.hint}`)] : []),
  ])];
}

/* ── dev ───────────────────────────────────────────────── */

const TYPES: Record<string, string> = {
  ".json": "application/json", ".js": "text/javascript", ".mjs": "text/javascript", ".ts": "text/plain", ".tsx": "text/plain", ".mts": "text/plain",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".css": "text/css", ".html": "text/html", ".txt": "text/plain", ".md": "text/plain",
};
const HEADERS = { "access-control-allow-origin": "*", "access-control-allow-private-network": "true", "cache-control": "no-store" };

/** The editor's address that loads the plugin served at `served` (src/plugins/devLink.ts reads it). */
export const devEditorUrl = (editor: string, served: string) => { const u = new URL(editor); u.searchParams.set("plugin-dev", served); return u.href; };

/** `scmjs plugin dev`: serve, build, open the editor, and tell it to reload on each change, until Ctrl+C. */
export async function devPlugin(o: { dir?: string; port: number; open: boolean; editor?: string }): Promise<void> {
  const dir = resolve(o.dir ?? ".");
  checkPlugin(dir); // no plugin.json: stop here, before serving anything
  const manifest = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8")) as { build?: string; name?: string };
  const pkg = existsSync(join(dir, "package.json")) ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> } : null;
  const builds = !!(manifest.build && pkg?.scripts?.build);
  if (builds && !existsSync(join(dir, "node_modules"))) throw new CliError(t("The plugin's packages are not installed"), t("Run npm install in its folder first."), 2);

  const clients = new Set<ServerResponse>();
  const send = (event: string, data: unknown) => { for (const c of clients) c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  let connected = false;

  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") { res.writeHead(204, { ...HEADERS, "access-control-allow-methods": "GET", "access-control-allow-headers": "*" }).end(); return; }
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
    if (path === "/__scmjs/events") {
      res.writeHead(200, { ...HEADERS, "content-type": "text/event-stream", connection: "keep-alive" });
      res.write(`event: hello\ndata: ${JSON.stringify({ name: manifest.name })}\n\n`);
      clients.add(res);
      if (!connected) { connected = true; print(`${mark.ok} ${t("The editor is connected")}`); }
      req.on("close", () => clients.delete(res));
      return;
    }
    const file = resolve(dir, "." + (path.endsWith("/") ? path + "index.html" : path));
    const inside = file === dir || file.startsWith(dir + sep);
    if (!inside || /(?:^|[\\/])(?:node_modules|\.git)(?:[\\/]|$)/.test(relative(dir, file)) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, HEADERS).end();
      return;
    }
    res.writeHead(200, { ...HEADERS, "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", (e: NodeJS.ErrnoException) => fail(e.code === "EADDRINUSE" ? new CliError(t("Port {port} is in use", { port: o.port }), t("Pick another with --port. The editor keeps one install per address, so stay with the one you choose.")) : e));
    server.listen(o.port, "127.0.0.1", () => ok());
  });
  const served = `http://127.0.0.1:${o.port}/`;
  const heartbeat = setInterval(() => { for (const c of clients) c.write(": still here\n\n"); }, 20_000);

  const build = () => new Promise<string | null>((done) => {
    if (!builds) return done(null);
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build", "--silent"], { cwd: dir, shell: process.platform === "win32" });
    let text = "";
    child.stdout.on("data", (d) => { text += d; });
    child.stderr.on("data", (d) => { text += d; });
    child.on("close", (code) => done(code === 0 ? null : text.trim() || t("npm run build exited with {code}", { code: String(code) })));
    child.on("error", (e) => done(e.message));
  });

  // Built first, so what is reported is what the editor will load.
  const failed = await build();
  const first = checkPlugin(dir);
  print(`${pc.bold(first.name ?? basename(dir))}${first.version ? pc.dim(` ${first.version}`) : ""}`);
  if (failed) print(`${mark.error} ${t("The build failed")}`, pc.dim(failed.split("\n").map((l) => `  ${l}`).join("\n")));
  else for (const line of printPluginCheck(first, false).slice(1)) print(line);
  const url = devEditorUrl(o.editor ?? process.env.SCMJS_EDITOR_URL ?? EDITOR_URL, served);
  print(`${mark.info} ${t("Serving it at {url}", { url: pc.cyan(served) })}${builds ? dot + t("built with npm run build") : ""}`);
  if (o.open && process.env.BROWSER !== "none") { openBrowser(url); print(`${mark.info} ${t("Opening the editor. The first time, it asks you to add the plugin.")}`); }
  print(pc.dim(`  ${t("If nothing opens, go to {url}", { url })}`), pc.dim(`  ${t("Watching for changes. Ctrl+C stops.")}`));

  let timer: ReturnType<typeof setTimeout> | null = null, changed = new Set<string>(), running = false;
  // What the build writes is not a change to build again: the bundle, and the folder it is in when only it is there.
  const built = manifest.build?.replace(/^\.\//, "") ?? null;
  const skip = (f: string) => { const p = f.replace(/\\/g, "/"); return /(^|\/)(?:node_modules|\.git)(\/|$)/.test(p) || (!!built && (p === built || p === dirname(built))); };
  const flush = async () => {
    if (running) { timer = setTimeout(flush, 100); return; }
    running = true;
    const files = [...changed]; changed = new Set();
    const err = await build();
    const at = new Date().toTimeString().slice(0, 8);
    if (err) { print(`${mark.error} ${pc.dim(at)} ${t("The build failed")}`, pc.dim(err.split("\n").slice(0, 12).map((l) => `  ${l}`).join("\n"))); send("failed", { text: err.split("\n").slice(0, 3).join("\n") }); }
    else { send("reload", { files }); print(`${mark.ok} ${pc.dim(at)} ${files.length > 3 ? t("{files} and {n} more", { files: files.slice(0, 3).join(", "), n: files.length - 3 }) : files.join(", ")}${clients.size ? t("; reloaded in the editor") : pc.dim(t("; no editor connected"))}`); }
    running = false;
  };
  const watcher = watch(dir, { recursive: true }, (_e, f) => {
    if (!f || skip(f)) return;
    changed.add(f.replace(/\\/g, "/"));
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 150);
  });

  await new Promise<void>((done) => {
    const stop = () => { watcher.close(); clearInterval(heartbeat); for (const c of clients) c.end(); server.close(); print("", pc.dim(t("Stopped."))); done(); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
