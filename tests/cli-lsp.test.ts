/**
 * `scmjs lsp` (cli/src/lsp.ts): the Language Server Protocol spoken to it as an editor speaks it — initialize, a
 * TrigScript file opened, its errors pushed, then completion, hover, go to definition and the outline. The script is
 * in an unpacked copy of tests/maps/ums.scx (`trigscript/main.ts`), with TrigScript's example library
 * (`examples/library` in the plugin) as the map's copy under `trigscript/@libraries/waves/`.
 *
 * Twice: in this process over a pair of pipes, and against the built command (`cli/dist/scmjs.mjs`, `npm run
 * build:cli`) over its standard input and output, when it is built. Both need the plugin's language service
 * (`plugins/trigscript/language.ts`, TrigScript 4.2 on), vendored by `npm run vendor:plugins`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unpackMap } from "../cli/src/archive";
import { isUnpackedMap, mapOption, scriptHomeOf } from "../cli/src/lsp";
import { testMap } from "./support/maps";

const PLUGIN = join(import.meta.dirname, "..", "plugins", "trigscript");
const haveLanguage = existsSync(join(PLUGIN, "language.ts"));
const BUNDLE = join(import.meta.dirname, "..", "cli", "dist", "scmjs.mjs");
const haveBundle = haveLanguage && existsSync(BUNDLE) && readFileSync(BUNDLE, "utf8").includes("TrigScript language server");

/** A client of the protocol: Content-Length frames on a pair of streams. */
class Client {
  private buffer = Buffer.alloc(0);
  private next = 1;
  private pending = new Map<number, (r: { result?: unknown; error?: unknown }) => void>();
  private waiters: { method: string; test: (p: any) => boolean; resolve: (p: any) => void }[] = [];
  readonly notifications: { method: string; params: any }[] = [];

  constructor(private toServer: Writable, fromServer: Readable) {
    fromServer.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const end = this.buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        const length = Number(/Content-Length: (\d+)/i.exec(this.buffer.subarray(0, end).toString())?.[1]);
        if (this.buffer.length < end + 4 + length) return;
        const message = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString());
        this.buffer = this.buffer.subarray(end + 4 + length);
        this.receive(message);
      }
    });
  }

  private receive(m: { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown }) {
    if (m.method && m.id !== undefined) { this.send({ jsonrpc: "2.0", id: m.id, result: null }); return; }
    if (m.method) {
      this.notifications.push({ method: m.method, params: m.params });
      for (const w of [...this.waiters]) if (w.method === m.method && w.test(m.params)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m.params); }
      return;
    }
    this.pending.get(m.id!)?.(m);
    this.pending.delete(m.id!);
  }

  private send(message: object) {
    const body = Buffer.from(JSON.stringify(message));
    this.toServer.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.toServer.write(body);
  }

  request<T = any>(method: string, params: unknown): Promise<T> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (r) => (r.error ? reject(new Error(JSON.stringify(r.error))) : resolve(r.result as T)));
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  /** The next notification of `method` that passes `test`, or one already received. */
  waitFor<T = any>(method: string, test: (p: T) => boolean = () => true, ms = 20_000): Promise<T> {
    const had = this.notifications.find((n) => n.method === method && test(n.params));
    if (had) return Promise.resolve(had.params);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${method} in ${ms} ms; had: ${JSON.stringify(this.notifications.map((n) => n.method))}`)), ms);
      this.waiters.push({ method, test, resolve: (p) => { clearTimeout(timer); resolve(p); } });
    });
  }
}

const MAIN = `// Waves, as the example library's own comment has them.
import { announce, spawnWave } from "waves";
import { fog } from "trigscript/fog";

/** How many waves there are. */
const WAVES = 5;

program(() => {
  let wave = 1;
  while (wave <= WAVES) {
    announce(\`Wave \${wave}\`);
    spawnWave(P2, units.ZergZergling, wave, locations.Spawn);
    wave++;
    sleep(seconds(20));
  }
  fog.reveal(P1);
});
`;

/** ums.scx unpacked into a new folder, with the script and the library's copy in it. */
async function unpackedMap(): Promise<{ dir: string; main: string; spawn: string }> {
  const dir = join(mkdtempSync(join(tmpdir(), "scmjs-lsp-")), "ums");
  await unpackMap(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx", dir);
  const main = join(dir, "trigscript", "main.ts");
  mkdirSync(join(dir, "trigscript", "@libraries", "waves"), { recursive: true });
  writeFileSync(main, MAIN);
  writeFileSync(join(dir, "trigscript", "@libraries", "waves", "library.json"), JSON.stringify({ label: "Waves", version: "1.0.0" }));
  for (const f of ["index.ts", "announce.ts", "spawn.ts"]) writeFileSync(join(dir, "trigscript", "@libraries", "waves", f), readFileSync(join(PLUGIN, "examples", "library", "lib", f)));
  return { dir, main, spawn: join(dir, "trigscript", "@libraries", "waves", "spawn.ts") };
}

/** The 0-based position of `needle` in a text, plus `skip`. */
function position(text: string, needle: string, skip = 0) {
  const before = text.slice(0, text.indexOf(needle) + skip).split("\n");
  return { line: before.length - 1, character: before[before.length - 1].length };
}

/** What an editor does, start to end; `client` is connected to a server. */
function conversation(start: () => Promise<{ client: Client; stop: () => Promise<void> }>) {
  let client: Client, stop: () => Promise<void>, map: Awaited<ReturnType<typeof unpackedMap>>, uri: string;
  let text = MAIN;
  beforeAll(async () => {
    map = await unpackedMap();
    uri = pathToFileURL(map.main).href;
    ({ client, stop } = await start());
  }, 60_000);
  afterAll(async () => { await stop?.(); });

  it("starts, and says what it can do", async () => {
    const r = await client.request("initialize", { processId: null, rootUri: pathToFileURL(map.dir).href, capabilities: {} });
    expect(r.serverInfo.name).toBe("scmjs");
    expect(r.capabilities).toMatchObject({ hoverProvider: true, definitionProvider: true, documentSymbolProvider: true, completionProvider: { resolveProvider: true } });
    client.notify("initialized", {});
  });

  it("checks a script when it is opened, against the map's names", async () => {
    client.notify("textDocument/didOpen", { textDocument: { uri, languageId: "typescript", version: 1, text } });
    const d = await client.waitFor<{ uri: string; diagnostics: any[] }>("textDocument/publishDiagnostics", (p) => p.uri === uri && p.diagnostics.length > 0, 60_000);
    // ums.scx has no location called Spawn.
    expect(d.diagnostics.map((x: any) => [x.range.start.line, x.severity, x.source])).toEqual([[position(text, "locations.Spawn").line, 1, "trigscript (typescript)"]]);
    expect(d.diagnostics[0].message).toMatch(/Property 'Spawn' does not exist/);
  }, 60_000);

  it("checks it again as it changes, and clears what was fixed", async () => {
    text = MAIN.replace("locations.Spawn", "locations.Nest");
    client.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text }] });
    const d = await client.waitFor<{ uri: string; diagnostics: any[] }>("textDocument/publishDiagnostics", (p) => p.uri === uri && p.diagnostics.length === 0, 60_000);
    expect(d.diagnostics).toEqual([]);
  }, 60_000);

  it("completes the map's locations", async () => {
    const r = await client.request<any[]>("textDocument/completion", { textDocument: { uri }, position: position(text, "locations.Nest", "locations.".length), context: { triggerKind: 2, triggerCharacter: "." } });
    const labels = r.map((c) => c.label);
    for (const name of ["Base", "Nest", "Middle", "Anywhere"]) expect(labels).toContain(name);
    expect(r.find((c) => c.label === "Nest").kind).toBe(10); // Property
  });

  it("completes the script's own names and the library's, with their signatures on resolve", async () => {
    const r = await client.request<any[]>("textDocument/completion", { textDocument: { uri }, position: position(text, "  fog.reveal") });
    const labels = r.map((c) => c.label);
    for (const name of ["WAVES", "announce", "spawnWave", "trigger", "program", "units", "while"]) expect(labels).toContain(name);
    const item = await client.request("completionItem/resolve", r.find((c) => c.label === "spawnWave"));
    expect(item.detail).toContain("spawnWave(player: Player, unit: UnitType, n: number, at: Location): void");
    expect(item.documentation.value).toContain("Make wave `n`");
  });

  it("hovers a location with where it is on the map", async () => {
    const h = await client.request("textDocument/hover", { textDocument: { uri }, position: position(text, "locations.Nest", "locations.".length + 1) });
    expect(h.contents.kind).toBe("markdown");
    expect(h.contents.value).toMatch(/\*\*locations\.Nest\*\* is location \d+: \d+ × \d+ tiles at \d+, \d+\./);
  });

  it("hovers a program's variable with what it holds", async () => {
    const h = await client.request("textDocument/hover", { textDocument: { uri }, position: position(text, "wave <= WAVES") });
    expect(h.contents.value).toContain("let wave: number");
    expect(h.contents.value).toContain("**wave** is a variable of the program: a number");
  });

  it("goes to a definition in the library's copy, and in the standard library", async () => {
    const lib = await client.request<any[]>("textDocument/definition", { textDocument: { uri }, position: position(text, "spawnWave(P2") });
    expect(lib.map((l) => l.uri)).toEqual([pathToFileURL(map.spawn).href]);
    const std = await client.request<any[]>("textDocument/definition", { textDocument: { uri }, position: position(text, "trigscript/fog", 2) });
    expect(std[0].uri).toMatch(/\/__trigscript__\/fog\.ts$/);
    const shown = new URL(std[0].uri);
    expect(readFileSync(shown, "utf8")).toContain("export const reveal");
    // The standard library's file answers too: a hover there is the language's.
    const h = await client.request("textDocument/hover", { textDocument: { uri: std[0].uri }, position: position(readFileSync(shown, "utf8"), "export const reveal", "export const ".length) });
    expect(h.contents.value).toContain("reveal");
  });

  it("outlines the file", async () => {
    const s = await client.request<any[]>("textDocument/documentSymbol", { textDocument: { uri } });
    expect(s.map((x) => x.name)).toContain("WAVES");
  });

  it("shuts down", async () => {
    expect(await client.request("shutdown", null)).toBe(null);
  });
}

describe("which files are a script", () => {
  it("is the trigscript folder of an unpacked map, named by the map beside it", async () => {
    const { dir, main } = await unpackedMap();
    expect(isUnpackedMap(dir)).toBe(true);
    expect(scriptHomeOf(main, null)).toEqual({ root: join(dir, "trigscript"), map: { kind: "folder", dir } });
    expect(scriptHomeOf(join(dir, "notes.txt"), null)).toBe(null);
    expect(scriptHomeOf(join(dir, "elsewhere.ts"), null)).toBe(null);
  });

  it("is any .ts with --map naming a map file", async () => {
    const { dir } = await unpackedMap();
    const other = mkdtempSync(join(tmpdir(), "scmjs-lsp-"));
    writeFileSync(join(other, "main.ts"), "");
    mkdirSync(join(other, "ai"));
    const map = mapOption(testMap("ums.scx"));
    expect(scriptHomeOf(join(other, "ai", "waves.ts"), map)).toEqual({ root: other, map });
    expect(mapOption(dir)).toEqual({ kind: "folder", dir });
    expect(() => mapOption(join(other, "ai"))).toThrow(/not an unpacked map/);
  });
});

describe.skipIf(!haveLanguage)("scmjs lsp, in this process", () => {
  conversation(async () => {
    const { serveLsp } = await import("../cli/src/lsp");
    const toServer = new PassThrough(), fromServer = new PassThrough();
    const done = serveLsp({ input: toServer, output: fromServer, log: (line) => { if (process.env.SCMJS_LSP_LOG) process.stderr.write(`${line}\n`); } });
    return { client: new Client(toServer, fromServer), stop: async () => { toServer.end(); await done; } };
  });
});

describe.skipIf(!haveBundle)("scmjs lsp, the built command over standard input and output", () => {
  let child: ChildProcess;
  conversation(async () => {
    // Without VITEST, which the command reads as "imported by a test: do not run".
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("VITEST")));
    child = spawn(process.execPath, [BUNDLE, "lsp", "--stdio"], { stdio: ["pipe", "pipe", "pipe"], env });
    child.stderr!.on("data", (d: Buffer) => { if (process.env.SCMJS_LSP_LOG) process.stderr.write(d); });
    return {
      client: new Client(child.stdin!, child.stdout!),
      stop: async () => {
        const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
        child.stdin!.write(`Content-Length: 33\r\n\r\n{"jsonrpc":"2.0","method":"exit"}`);
        expect(await exited).toBe(0);
      },
    };
  });
});
