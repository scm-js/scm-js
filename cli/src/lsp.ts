/**
 * `scmjs lsp`: TrigScript's language as a Language Server Protocol server on standard input and output, so an editor
 * other than the scmJS one (VS Code, Neovim, Helix, Zed, anything that speaks LSP) shows a script's errors as a build
 * would find them, completes the map's names, and goes to a definition in the standard library or a library.
 *
 * The language is TrigScript's own (`plugins/trigscript/language.ts`, `ScriptLanguage`): a TypeScript language service
 * over the script laid out as the compiler lays it out, and the compiler's check for the errors. This file is the
 * protocol round it, and the part only a file system has: which files are a script, which map names them.
 *
 * A script is the `trigscript/` folder of an unpacked map (`scmjs map unpack`, `archive.json` beside it), as the
 * archive keeps it: `trigscript\main.ts` is `trigscript/main.ts`, a library's copy is under `trigscript/@libraries/`.
 * The map's names come from `staredit/scenario.chk` beside it, read again when it changes. Any folder called
 * `trigscript` is a script too (with the fixed names, unless `--map` names a map), and `--map` with a map file makes
 * every `.ts` the editor opens a file of a script that map names.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CompletionItemKind, createConnection, DiagnosticSeverity, MarkupKind, ProposedFeatures, StreamMessageReader, StreamMessageWriter,
  SymbolKind, TextDocuments, TextDocumentSyncKind, type CompletionItem, type Connection, type Diagnostic, type DocumentSymbol, type Location,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { openMapBytes } from "../../src/editor/mapFile";
import { locationName, usedLocations } from "../../src/editor/locations";
import type { Scenario } from "../../src/formats/chk/scenario";
import type { Place, ScriptLanguage, ScriptSymbol } from "../../plugins/trigscript/language";
import type { ScriptDiagnostic, SourceRange } from "../../plugins/trigscript/compiler/compiler";
import { VERSION } from "./about";
import { MANIFEST_FILE } from "./archive";
import { loadTypeScript, mapNames, type TypeScriptModule } from "./build";
import { CliError } from "./ui";

/** Where the server's own words go: standard error, since standard output is the protocol (the client shows it as the server's log). */
const STDERR = (line: string) => process.stderr.write(`${line}\n`);

/** The plugin's modules the server needs; the bundle inlines them. */
async function trigscript() {
  try {
    const [language, script, version] = await Promise.all([
      import("../../plugins/trigscript/language"),
      import("../../plugins/trigscript/script"),
      import("../../plugins/trigscript/version"),
    ]);
    return { ...language, ...script, TRIGSCRIPT_VERSION: version.VERSION };
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ERR_MODULE_NOT_FOUND") throw e;
    throw new CliError("TrigScript's language is not in this build of scmjs.", "In a clone, npm run vendor:plugins fetches the plugins the editor ships, then build the command again.");
  }
}
type TrigScript = Awaited<ReturnType<typeof trigscript>>;

/** The folder a script is in on disk: `trigscript/`, as `map unpack` writes it. */
export const SCRIPT_FOLDER = "trigscript";
/** Where an unpacked map keeps its copies of other plugins' libraries, under the script's folder (`trigscript\@libraries\`). */
export const LIBRARIES_FOLDER = "@libraries";
const SCENARIO_FILE = join("staredit", "scenario.chk");

/** Whether a folder is an unpacked map: `archive.json`, or the scenario where the archive keeps it. */
export const isUnpackedMap = (dir: string): boolean => existsSync(join(dir, MANIFEST_FILE)) || existsSync(join(dir, SCENARIO_FILE));

/** The map a script's names come from: an unpacked map's folder, or a map file. */
export type MapSource = { kind: "folder"; dir: string } | { kind: "file"; path: string };

export interface ScriptHome {
  /** The script's folder: its `main.ts` is here, and a file's path in the script is relative to it. */
  root: string;
  map: MapSource | null;
}

/** The map `--map` names: a map file, or an unpacked map's folder. */
export function mapOption(path: string | undefined): MapSource | null {
  if (!path) return null;
  const at = resolve(path);
  if (!existsSync(at)) throw new CliError(`No file or folder ${path}`, "--map names a map (.scm, .scx) or a folder scmjs map unpack wrote.", 2);
  if (statSync(at).isDirectory()) {
    if (!isUnpackedMap(at)) throw new CliError(`${path} is not an unpacked map`, "--map names a map (.scm, .scx) or a folder scmjs map unpack wrote (archive.json is in it).", 2);
    return { kind: "folder", dir: at };
  }
  return { kind: "file", path: at };
}

/**
 * Which script a file on disk belongs to, or null when it is not TrigScript. The nearest folder above it called
 * `trigscript` is the script's, and its map is the unpacked map that folder is in (else `--map`'s). With no such
 * folder, `--map` decides: an unpacked map's own `trigscript/`, or, for a map file, the nearest folder above the file
 * with a `main.ts` or `main.tsx` in it (else the file's own folder).
 */
export function scriptHomeOf(file: string, map: MapSource | null): ScriptHome | null {
  if (!/\.tsx?$/i.test(file)) return null;
  for (let dir = dirname(resolve(file)); ; dir = dirname(dir)) {
    if (basename(dir).toLowerCase() === SCRIPT_FOLDER) {
      const parent = dirname(dir);
      return { root: dir, map: isUnpackedMap(parent) ? { kind: "folder", dir: parent } : map };
    }
    if (dirname(dir) === dir) break;
  }
  if (!map) return null;
  if (map.kind === "folder") {
    const root = join(map.dir, SCRIPT_FOLDER);
    return isUnder(file, root) ? { root, map } : null;
  }
  for (let dir = dirname(resolve(file)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "main.ts")) || existsSync(join(dir, "main.tsx"))) return { root: dir, map };
    if (dirname(dir) === dir) break;
  }
  return { root: dirname(resolve(file)), map };
}

const isUnder = (file: string, dir: string) => { const r = relative(dir, resolve(file)); return !!r && !r.startsWith("..") && !r.startsWith(sep) && !/^[a-z]:/i.test(r); };

/** Every file under `dir` as archive member names (`trigscript\ai\waves.ts`), skipping dot files and `node_modules`. */
function membersUnder(dir: string, prefix: string, out = new Map<string, Uint8Array>(), read = true): Map<string, Uint8Array> {
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) membersUnder(path, `${prefix}${e.name}\\`, out, read);
    else if (e.isFile()) out.set(`${prefix}${e.name}`, read ? new Uint8Array(readFileSync(path)) : new Uint8Array(0));
  }
  return out;
}

/** The locations' boxes in tiles, for hovers. */
function placesOf(scn: Scenario): Place[] {
  return usedLocations(scn).map((index) => {
    const l = scn.locations[index];
    const left = Math.min(l.left, l.right), top = Math.min(l.top, l.bottom);
    return { index, name: locationName(scn, index), x: Math.round(left / 32), y: Math.round(top / 32), w: Math.round(Math.abs(l.right - l.left) / 32), h: Math.round(Math.abs(l.bottom - l.top) / 32) };
  });
}

/** What the server has of one script: its language, where its files are, the files the editor has open. */
interface Workspace {
  home: ScriptHome;
  language: ScriptLanguage;
  /** Paths in the script of the files the editor holds, with their text. */
  open: Map<string, string>;
  /** When the map was last read: its scenario's (or file's) time and size. */
  mapStamp: string;
  /** The URIs that were last given diagnostics, to clear the ones that are clean now. */
  published: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  /** The map's own copies of libraries, for a map file (an unpacked map has them on disk). */
  mapLibraries: Record<string, Record<string, string>>;
}

/** A map's names and places, and its copies of libraries when it is a file. */
async function readMap(ts: TrigScript, map: MapSource): Promise<{ names: Awaited<ReturnType<typeof mapNames>>; places: Place[]; libraries: Record<string, Record<string, string>> }> {
  if (map.kind === "file") {
    const doc = await openMapBytes(new Uint8Array(readFileSync(map.path)), basename(map.path));
    return { names: await mapNames(doc.scenario, doc.extras), places: placesOf(doc.scenario), libraries: ts.librarySources(ts.readLibraries(doc.extras)) as Record<string, Record<string, string>> };
  }
  const doc = await openMapBytes(new Uint8Array(readFileSync(join(map.dir, SCENARIO_FILE))), "scenario.chk");
  // The archive's other members, by name: the sounds' slots name them (soundList); their bytes are not needed.
  const members = new Map<string, Uint8Array>();
  try {
    const manifest = JSON.parse(readFileSync(join(map.dir, MANIFEST_FILE), "utf8")) as { members?: { name: string }[] };
    for (const m of manifest.members ?? []) members.set(m.name, new Uint8Array(0));
  } catch { membersUnder(map.dir, "", members, false); }
  return { names: await mapNames(doc.scenario, members), places: placesOf(doc.scenario), libraries: {} };
}

function stampOf(map: MapSource | null): string {
  if (!map) return "";
  const path = map.kind === "file" ? map.path : join(map.dir, SCENARIO_FILE);
  try { const s = statSync(path); return `${s.mtimeMs}:${s.size}`; } catch { return "gone"; }
}

/** LSP's kinds for TypeScript's (`ts.ScriptElementKind`). */
const COMPLETION_KINDS: Record<string, CompletionItemKind> = {
  keyword: CompletionItemKind.Keyword, module: CompletionItemKind.Module, "external module name": CompletionItemKind.Module, script: CompletionItemKind.File,
  class: CompletionItemKind.Class, "local class": CompletionItemKind.Class, interface: CompletionItemKind.Interface, type: CompletionItemKind.Interface,
  "type parameter": CompletionItemKind.TypeParameter, enum: CompletionItemKind.Enum, "enum member": CompletionItemKind.EnumMember,
  var: CompletionItemKind.Variable, "local var": CompletionItemKind.Variable, let: CompletionItemKind.Variable, parameter: CompletionItemKind.Variable,
  const: CompletionItemKind.Constant, function: CompletionItemKind.Function, "local function": CompletionItemKind.Function,
  method: CompletionItemKind.Method, construct: CompletionItemKind.Constructor, constructor: CompletionItemKind.Constructor,
  property: CompletionItemKind.Property, getter: CompletionItemKind.Property, setter: CompletionItemKind.Property, accessor: CompletionItemKind.Property,
  alias: CompletionItemKind.Reference, string: CompletionItemKind.Value, directory: CompletionItemKind.Folder,
};
const SYMBOL_KINDS: Record<string, SymbolKind> = {
  module: SymbolKind.Module, class: SymbolKind.Class, "local class": SymbolKind.Class, interface: SymbolKind.Interface, type: SymbolKind.Interface,
  enum: SymbolKind.Enum, "enum member": SymbolKind.EnumMember, function: SymbolKind.Function, "local function": SymbolKind.Function,
  method: SymbolKind.Method, constructor: SymbolKind.Constructor, property: SymbolKind.Property, getter: SymbolKind.Property, setter: SymbolKind.Property,
  const: SymbolKind.Constant, let: SymbolKind.Variable, var: SymbolKind.Variable, "local var": SymbolKind.Variable, alias: SymbolKind.Variable,
};

const lspRange = (r: Pick<SourceRange, "line" | "column" | "endLine" | "endColumn">) => ({
  start: { line: r.line - 1, character: r.column - 1 },
  end: { line: r.endLine - 1, character: r.endColumn - 1 },
});

export interface LspOptions {
  /** `--map`: the map a script outside an unpacked map is named by. */
  map?: string;
  /** Where the server's log goes: standard error by default (an editor shows it as the server's output). */
  log?: (line: string) => void;
  /** Where to speak; standard input and output by default. */
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/** The server: answers until the client says exit, or closes the pipe. */
export async function serveLsp(options: LspOptions = {}): Promise<void> {
  const mapFromOption = mapOption(options.map);
  const stdio = !options.input;
  const log = options.log ?? STDERR;
  // Standard output is the protocol from here on: anything the editor's code would print goes to stderr.
  if (stdio) for (const k of ["log", "info", "debug", "warn", "error"] as const) console[k] = (...a: unknown[]) => STDERR(a.map(String).join(" "));
  const input = options.input ?? process.stdin, output = options.output ?? process.stdout;
  // A reader and a writer rather than the streams: given streams, the library ends the process when they close.
  const connection: Connection = createConnection(ProposedFeatures.all, new StreamMessageReader(input), new StreamMessageWriter(output));
  let shutdown = false;
  const documents = new TextDocuments(TextDocument);
  const workspaces = new Map<string, Promise<Workspace | null>>();
  /** Files the server wrote for a definition outside the script's folder (the standard library, the declarations): which script and path they are. */
  const shown = new Map<string, { ws: Workspace; path: string }>();
  let folder = process.cwd();
  let ts: TrigScript | null = null;
  const typescripts = new Map<string, Promise<TypeScriptModule | null>>();
  let toldNoTypeScript = false;

  const cacheDir = join(tmpdir(), "scmjs-lsp");

  async function typescriptFor(root: string): Promise<TypeScriptModule | null> {
    let p = typescripts.get(root);
    if (!p) {
      p = loadTypeScript(root).catch((e: unknown) => {
        if (!toldNoTypeScript) {
          toldNoTypeScript = true;
          const text = e instanceof CliError ? `${e.message}${e.hint ? ` ${e.hint}` : ""}` : String(e);
          void connection.window.showErrorMessage(`scmjs: ${text}`);
          log(text);
        }
        return null;
      });
      typescripts.set(root, p);
    }
    return p;
  }

  /** The script a file is in, made the first time it is asked for; null for a file that is not TrigScript. */
  async function workspaceOf(file: string): Promise<{ ws: Workspace; path: string } | null> {
    const shownAt = shown.get(resolve(file));
    if (shownAt) return shownAt;
    const home = scriptHomeOf(file, mapFromOption);
    if (!home) return null;
    // One per script, however many requests ask for it while it is made.
    let making = workspaces.get(home.root);
    if (!making) {
      making = (async () => {
        ts ??= await trigscript();
        const typescript = await typescriptFor(home.map?.kind === "folder" ? home.map.dir : home.root);
        if (!typescript) return null;
        const language = new ts.ScriptLanguage(typescript.ts, { lib: typescript.lib });
        const made: Workspace = { home, language, open: new Map(), mapStamp: "", published: new Set(), timer: null, mapLibraries: {} };
        log(`script ${home.root}${home.map ? `, named by ${home.map.kind === "folder" ? home.map.dir : home.map.path}` : ", no map: the fixed names"} (TypeScript ${typescript.version})`);
        await refresh(made);
        return made;
      })();
      workspaces.set(home.root, making);
    }
    const ws = await making;
    if (!ws) return null;
    return { ws, path: pathIn(ws, file) };
  }

  /** A file's path in the script: `main.ts`, `ai/waves.ts`; a library's copy is where the compiler keeps it. */
  function pathIn(ws: Workspace, file: string): string {
    const rel = relative(ws.home.root, resolve(file)).split(sep).join("/");
    const lib = rel.startsWith(`${LIBRARIES_FOLDER}/`) ? rel.slice(LIBRARIES_FOLDER.length + 1) : null;
    return lib ? `__libraries__/${lib}` : rel;
  }

  /** Where a path of the script is on disk, writing it out first when it has no file of its own (the standard library, the declarations). */
  function fileOf(ws: Workspace, path: string): string {
    if (ts!.isScriptFile(path)) return join(ws.home.root, ...path.split("/"));
    const lib = /^__libraries__\/(.+)$/.exec(path);
    if (lib && ws.home.map?.kind === "folder") {
      const onDisk = join(ws.home.root, LIBRARIES_FOLDER, ...lib[1].split("/"));
      if (existsSync(onDisk)) return onDisk;
    }
    const key = createHash("sha1").update(ws.home.root).digest("hex").slice(0, 12);
    const file = join(cacheDir, key, ...path.split("/"));
    const text = ws.language.text(path) ?? "";
    let was: string | null = null;
    try { was = readFileSync(file, "utf8"); } catch { /* not written yet */ }
    if (was !== text) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
    shown.set(resolve(file), { ws, path });
    return file;
  }

  /** The script's files and the map's names again from disk; the open files keep the editor's text. */
  async function refresh(ws: Workspace): Promise<void> {
    const stamp = stampOf(ws.home.map);
    if (stamp !== ws.mapStamp) {
      ws.mapStamp = stamp;
      if (ws.home.map) {
        try {
          const m = await readMap(ts!, ws.home.map);
          ws.language.setNames(m.names, m.places);
          ws.mapLibraries = m.libraries;
        } catch (e) {
          log(`the map's names could not be read: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    const members = membersUnder(ws.home.root, `${SCRIPT_FOLDER}\\`);
    const files = ts!.readFiles(members);
    for (const path of Object.keys(ws.language.files())) if (!(path in files) && !ws.open.has(path)) ws.language.deleteFile(path);
    for (const [path, text] of Object.entries(files)) if (!ws.open.has(path)) ws.language.setFile(path, text);
    for (const [path, text] of ws.open) if (ts!.isScriptFile(path)) ws.language.setFile(path, text);
    const onDisk = ts!.librarySources(ts!.readLibraries(members)) as Record<string, Record<string, string>>;
    ws.language.setLibraries({ ...ws.mapLibraries, ...onDisk });
  }

  function schedule(ws: Workspace, ms = 250): void {
    if (ws.timer) clearTimeout(ws.timer);
    ws.timer = setTimeout(() => { ws.timer = null; void check(ws); }, ms);
  }

  async function check(ws: Workspace): Promise<void> {
    await refresh(ws);
    const t0 = performance.now();
    const r = ws.language.check();
    const byFile = new Map<string, ScriptDiagnostic[]>();
    for (const d of r.diagnostics) {
      const list = byFile.get(d.file) ?? [];
      list.push(d);
      byFile.set(d.file, list);
    }
    const now = new Set<string>();
    for (const path of new Set([...Object.keys(ws.language.files()), ...byFile.keys()])) {
      if (!ts!.isScriptFile(path) || !/\.tsx?$/.test(path)) continue;
      const uri = pathToFileURL(fileOf(ws, path)).href;
      const list = byFile.get(path) ?? [];
      if (!list.length && !ws.published.has(uri)) continue;
      const diagnostics: Diagnostic[] = list.map((d) => ({ range: lspRange(d), severity: DiagnosticSeverity.Error, source: d.source === "typescript" ? "trigscript (typescript)" : "trigscript", message: d.message }));
      void connection.sendDiagnostics({ uri, diagnostics });
      if (list.length) now.add(uri);
    }
    ws.published = now;
    log(`checked ${ws.home.root}: ${r.diagnostics.length} error(s), ${Math.round(performance.now() - t0)} ms`);
  }

  const filePath = (uri: string): string | null => { try { return uri.startsWith("file:") ? fileURLToPath(uri) : null; } catch { return null; } };
  /** The script and path of a document the client names, null when it is not TrigScript. */
  async function at(uri: string) {
    const file = filePath(uri);
    return file ? workspaceOf(file) : null;
  }

  connection.onInitialize((params) => {
    const root = params.workspaceFolders?.[0]?.uri ?? params.rootUri;
    const path = root ? filePath(root) : null;
    if (path) folder = path;
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { triggerCharacters: [".", "\"", "'", "/"], resolveProvider: true },
        hoverProvider: true,
        definitionProvider: true,
        documentSymbolProvider: true,
      },
      serverInfo: { name: "scmjs", version: VERSION },
    };
  });
  connection.onInitialized(() => {
    log(`scmjs ${VERSION}: TrigScript language server on stdio, folder ${folder}${mapFromOption ? `, --map ${mapFromOption.kind === "folder" ? mapFromOption.dir : mapFromOption.path}` : ""}`);
  });

  documents.onDidOpen(async ({ document }) => {
    const w = await at(document.uri);
    if (!w || shown.has(resolve(filePath(document.uri)!))) return;
    w.ws.open.set(w.path, document.getText());
    if (ts!.isScriptFile(w.path)) w.ws.language.setFile(w.path, document.getText());
    schedule(w.ws, 0);
  });
  documents.onDidChangeContent(async ({ document }) => {
    const w = await at(document.uri);
    if (!w || shown.has(resolve(filePath(document.uri)!))) return;
    w.ws.open.set(w.path, document.getText());
    if (ts!.isScriptFile(w.path)) w.ws.language.setFile(w.path, document.getText());
    schedule(w.ws);
  });
  documents.onDidSave(async ({ document }) => {
    const w = await at(document.uri);
    if (w) schedule(w.ws, 0);
  });
  documents.onDidClose(async ({ document }) => {
    const w = await at(document.uri);
    if (!w) return;
    w.ws.open.delete(w.path);
    schedule(w.ws, 0);
  });

  /** Hold a request until the document's last change is in the language: the change handlers are async. */
  async function ready(uri: string) {
    const w = await at(uri);
    if (!w) return null;
    const doc = documents.get(uri);
    if (doc && ts!.isScriptFile(w.path) && !shown.has(resolve(filePath(uri)!))) {
      if (w.ws.language.text(w.path) !== doc.getText()) { w.ws.open.set(w.path, doc.getText()); w.ws.language.setFile(w.path, doc.getText()); }
    }
    return w;
  }

  connection.onCompletion(async ({ textDocument, position, context }): Promise<CompletionItem[]> => {
    const w = await ready(textDocument.uri);
    if (!w) return [];
    const where = { line: position.line + 1, column: position.character + 1 };
    return w.ws.language.completions(w.path, where, context?.triggerCharacter).map((c) => ({
      label: c.name,
      kind: COMPLETION_KINDS[c.kind] ?? CompletionItemKind.Text,
      sortText: c.sortText,
      ...(c.replace ? { textEdit: { range: lspRange(c.replace), newText: c.insertText ?? c.name } } : c.insertText ? { insertText: c.insertText } : {}),
      ...(c.modifiers?.includes("deprecated") ? { tags: [1] } : {}),
      data: { uri: textDocument.uri, line: where.line, column: where.column, name: c.name, source: c.source },
    }));
  });
  connection.onCompletionResolve(async (item) => {
    const d = item.data as { uri: string; line: number; column: number; name: string; source?: string } | undefined;
    if (!d) return item;
    const w = await ready(d.uri);
    const detail = w?.ws.language.completionDetail(w.path, { line: d.line, column: d.column }, { name: d.name, source: d.source });
    if (detail) {
      item.detail = detail.detail;
      if (detail.documentation) item.documentation = { kind: MarkupKind.Markdown, value: detail.documentation };
    }
    return item;
  });
  connection.onHover(async ({ textDocument, position }) => {
    const w = await ready(textDocument.uri);
    const h = w?.ws.language.hover(w.path, { line: position.line + 1, column: position.character + 1 });
    if (!h) return null;
    const value = [`\`\`\`typescript\n${h.signature}\n\`\`\``, h.documentation, ...h.notes].filter(Boolean).join("\n\n");
    return { contents: { kind: MarkupKind.Markdown, value }, range: lspRange(h.range) };
  });
  connection.onDefinition(async ({ textDocument, position }): Promise<Location[]> => {
    const w = await ready(textDocument.uri);
    if (!w) return [];
    return w.ws.language.definition(w.path, { line: position.line + 1, column: position.character + 1 })
      .map((r) => ({ uri: pathToFileURL(fileOf(w.ws, r.file)).href, range: lspRange(r) }));
  });
  connection.onDocumentSymbol(async ({ textDocument }): Promise<DocumentSymbol[]> => {
    const w = await ready(textDocument.uri);
    if (!w) return [];
    const symbol = (s: ScriptSymbol): DocumentSymbol => ({ name: s.name, kind: SYMBOL_KINDS[s.kind] ?? SymbolKind.Variable, range: lspRange(s.range), selectionRange: lspRange(s.selection), children: s.children.map(symbol) });
    return w.ws.language.symbols(w.path).map(symbol);
  });
  connection.onShutdown(() => {
    shutdown = true;
    for (const making of workspaces.values()) void making.then((ws) => { if (ws?.timer) clearTimeout(ws.timer); ws?.language.dispose(); });
  });

  documents.listen(connection);
  // The client's exit ends the process (the library does it, 0 after a shutdown, else 1); so does the pipe closing.
  await new Promise<void>((done) => {
    input.once("end", () => done());
    connection.listen();
  });
  connection.dispose();
  if (stdio) process.exit(shutdown ? 0 : 1);
}
