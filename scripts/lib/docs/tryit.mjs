/**
 * "Try it" links: an example in the docs that runs as it is written opens in the editor's
 * API Playground plugin, ready to run. The link is
 * `<editor>/?plugin=github:scm-js/plugin-api-playground&playground=1<data>` — the first
 * parameter offers the plugin to a reader who does not have it (the editor only asks), and
 * the second is the snippet, in the plugin's link format (`link.ts` there): UTF-8, raw
 * deflate, base64url, behind a `1`. The editor never runs it until the reader presses Run.
 *
 * Which examples get a link is decided by type-checking them, not by hand: every
 * TypeScript or JavaScript example that mentions `api` goes into one program the way the
 * playground compiles a snippet (a module, `api` a global of type `PluginApi`, the DOM
 * library), and only the ones with no error get a link. A fragment that leans on a
 * variable it never declares gets none, so no link opens something that cannot run.
 */
import { deflateRawSync } from "node:zlib";
import ts from "typescript";

export const PLAYGROUND_SPEC = "github:scm-js/plugin-api-playground";

/** The `playground` parameter for `code`. */
export function playgroundParam(code) {
  return `1${deflateRawSync(Buffer.from(code, "utf8"), { level: 9 }).toString("base64url")}`;
}

export function playgroundUrl(editorUrl, code) {
  return `${editorUrl}/?plugin=${encodeURIComponent(PLAYGROUND_SPEC)}&playground=${playgroundParam(code)}`;
}

/** Worth checking: code that talks to the API. */
export const isCandidate = (code) => /\bapi\s*\.|\bPluginApi\b/.test(code);

/** The ```ts / ```js blocks of a Markdown source. */
export function codeBlocksOf(markdown) {
  return [...markdown.matchAll(/^```(?:ts|typescript|js|javascript)(?!\w)[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1].replace(/\n$/, ""));
}

const GLOBALS = `declare const api: import("@scm-js/plugin-api").PluginApi;\n`;

/**
 * The codes among `codes` that type-check as playground snippets against `dts` (the bundled
 * `index.d.ts`). One program for all of them, so the standard library is read once.
 */
export function runnableSnippets(codes, dts) {
  const unique = [...new Set(codes.filter(isCandidate))];
  const files = new Map([
    ["/globals.d.ts", GLOBALS],
    ["/node_modules/@scm-js/plugin-api/index.d.ts", dts],
    ["/node_modules/@scm-js/plugin-api/package.json", JSON.stringify({ name: "@scm-js/plugin-api", types: "index.d.ts" })],
  ]);
  unique.forEach((code, i) => files.set(`/snippet${i}.ts`, code));
  const options = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    types: [],
    noEmit: true,
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  const source = host.getSourceFile.bind(host);
  const dirExists = host.directoryExists?.bind(host);
  host.readFile = (f) => files.get(f) ?? read(f);
  host.fileExists = (f) => files.has(f) || exists(f);
  host.directoryExists = (d) => [...files.keys()].some((f) => f.startsWith(`${d.replace(/\/$/, "")}/`)) || (dirExists?.(d) ?? false);
  host.realpath = (p) => p;
  host.getSourceFile = (f, lang, ...rest) => (files.has(f) ? ts.createSourceFile(f, files.get(f), lang) : source(f, lang, ...rest));
  const roots = ["/globals.d.ts", ...unique.map((_, i) => `/snippet${i}.ts`)];
  const program = ts.createProgram(roots, options, host);
  const failed = new Set();
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const m = d.file && /^\/snippet(\d+)\.ts$/.exec(d.file.fileName);
    if (m) failed.add(Number(m[1]));
    // An error anywhere else (the bundle, the globals) would fail every snippet silently.
    else if (d.category === ts.DiagnosticCategory.Error) throw new Error(`Try it links: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  }
  return new Set(unique.filter((_, i) => !failed.has(i)));
}
