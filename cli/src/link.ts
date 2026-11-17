/**
 * A map linked to the editor: `scmjs map open --live`, and the MCP server's `editor_open`. The command hands the map
 * to the editor in the browser, as `map open` does, and the page it served stays open between the two. While the link
 * holds, every `scmjs` command on this computer that names the file reads the map as the editor has it, unsaved
 * changes included, and puts a changed map back there as one undo step; the editor's Save writes the file.
 *
 * Three parties. The **owner** is the process that opened the link: it serves the page on the loopback address and
 * keeps a line about the link in the cache folder. The **page** carries messages between the owner (an event stream
 * down, a POST up) and the editor it opened (`postMessage`; src/services/editorLink.ts is the other end). A **peer**
 * is any other scmjs process: it finds the line by the file's path and asks the owner over the loopback address, with
 * the key only that line holds. Nothing listens beyond 127.0.0.1, and nothing answers without the token or the key.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, join, resolve } from "node:path";
import { cacheRoot } from "./engine";
import { t } from "./i18n";
import { EDITOR_URL, openBrowser } from "./open";
import { CliError, mark, pc } from "./ui";
import { listenLoopback, loopbackToken, pageWait, readBody, requestUrl } from "./loopback";

/** What a request came back with: the JSON part and, beside it, bytes (a map, a picture). */
export interface LinkAnswer { result: Record<string, unknown>; bytes: Uint8Array | null }

/** The editor refused a request: `code` says why in a word (`changed`, `behind`, `busy`, `view-only`, `ended`). */
export class LinkError extends CliError {
  readonly code: string;
  constructor(code: string, message: string, hint: string | null = null) { super(message, hint); this.code = code; }
}

/** One end of a link, the owner's own or a peer's way to it. */
export interface Link {
  /** The file's absolute path. */
  readonly path: string;
  readonly name: string;
  call(method: string, params?: Record<string, unknown>, bytes?: Uint8Array): Promise<LinkAnswer>;
  /** End the link: the map stays open in the editor, as an ordinary map with unsaved changes if it has any. */
  close(): Promise<void>;
}

/** The link's line in the cache folder, for peers. */
interface LinkRecord { path: string; name: string; port: number; key: string; pid: number; since: string }

const linksDir = () => join(cacheRoot(), "links");
const recordFile = (path: string) => join(linksDir(), `${createHash("sha256").update(path).digest("hex").slice(0, 24)}.json`);

/** How long the editor has to answer: a change waits up to 20 s there for a stroke or a dialog to finish. */
const ANSWER_MS = 45_000;

const HINTS: Record<string, () => string> = {
  changed: () => t("Run the command again: it read the map before the change."),
  ended: () => t("scmjs map open --live links it again."),
};

/** A message as it travels over HTTP: a line of JSON, then the bytes. */
function frame(json: unknown, bytes?: Uint8Array | null): Buffer {
  return Buffer.concat([Buffer.from(`${JSON.stringify(json)}\n`, "utf8"), bytes ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Buffer.alloc(0)]);
}
function unframe(body: Buffer): { json: Record<string, unknown>; bytes: Uint8Array | null } {
  const at = body.indexOf(0x0a);
  const head = at < 0 ? body : body.subarray(0, at);
  const rest = at < 0 ? null : body.subarray(at + 1);
  return { json: JSON.parse(head.toString("utf8")) as Record<string, unknown>, bytes: rest && rest.length ? new Uint8Array(rest) : null };
}
/* ── The owner ──────────────────────────────────────────── */

/** The links this process owns, by path. */
const owned = new Map<string, LinkOwner>();

export interface OpenLinkOptions {
  /** The editor's address (`SCMJS_EDITOR_URL`, scmjs.dev's by default). */
  editor?: string;
  /** How long to wait for the editor to take the map. */
  timeout?: number;
  /** Lines for the person while the link opens (the page's address). */
  say?: (...lines: string[]) => void;
}

export class LinkOwner implements Link {
  readonly path: string;
  readonly name: string;
  private readonly token = loopbackToken();
  private readonly key = randomBytes(16).toString("hex");
  private server: Server | null = null;
  private stream: ServerResponse | null = null;
  private readonly queued: string[] = [];
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly waiting = new Map<string, { done: (a: LinkAnswer) => void; fail: (e: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;
  private beat: NodeJS.Timeout | null = null;
  private over: string | null = null;
  private readonly watchers: ((reason: string) => void)[] = [];
  private taken: ((linked: string | null) => void) | null = null;
  /** What the editor saved through the link, newest last: the size of each write. */
  saves = 0;

  /** The map as it was handed over, then as the editor last saved it. */
  private bytes: Uint8Array;

  constructor(path: string, bytes: Uint8Array) {
    this.bytes = bytes;
    this.path = resolve(path);
    this.name = basename(this.path);
  }

  /** Why the link ended, or null while it holds. */
  get ended(): string | null { return this.over; }
  /** Hear the link end (once), with the reason in a few words. */
  onEnd(fn: (reason: string) => void): void { if (this.over !== null) fn(this.over); else this.watchers.push(fn); }

  /** Serve the page, open it, and wait for the editor to take the map and link it. */
  async open(options: OpenLinkOptions = {}): Promise<void> {
    const editor = new URL(options.editor ?? process.env.SCMJS_EDITOR_URL ?? EDITOR_URL);
    editor.searchParams.set("handoff", "1");
    const { server, port, origin } = await listenLoopback((req, res) => { void this.serve(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
    this.server = server;
    const page = `${origin}/${this.token}`;
    this.pageHtml = linkPage(this.name, editor.href, this.token);
    const linked = pageWait<string | null>();
    this.taken = linked.settle;
    openBrowser(page);
    const say = options.say ?? (() => {});
    if (process.env.BROWSER === "none") say(`${mark.info} ${t("Open {page} in your browser to link {name} to the editor", { page, name: pc.bold(this.name) })}`);
    else say(`${mark.info} ${t("Opening {name} in the editor in your browser", { name: pc.bold(this.name) })}`, pc.dim(`  ${t("If nothing opens, go to {page}", { page })}`));
    const answer = await linked.within(options.timeout ?? 120_000, null);
    linked.stop();
    this.taken = null;
    if (answer !== "yes") {
      this.end(answer === null ? "not taken" : "not linked");
      if (answer === null) throw new CliError(t("The editor did not take the file"), t("Open {address} and drop {name} on it.", { address: editor.origin + editor.pathname, name: this.name }));
      if (answer === "no") throw new CliError(t("The editor did not open {name}, so it is not linked", { name: this.name }), t("It asks before it replaces a map with unsaved changes: answer it, then link again."));
      throw new CliError(t("The editor at {address} opened {name} but cannot link to scmjs yet", { address: editor.origin, name: this.name }), t("It is older than this scmjs. The map is open there as a copy; nothing the commands do will reach it."));
    }
    owned.set(this.path, this);
    mkdirSync(linksDir(), { recursive: true });
    const record: LinkRecord = { path: this.path, name: this.name, port, key: this.key, pid: process.pid, since: new Date().toISOString() };
    writeFileSync(recordFile(this.path), `${JSON.stringify(record)}\n`, { mode: 0o600 });
    this.beat = setInterval(() => this.stream?.write(": still here\n\n"), 15_000);
    this.beat.unref();
    process.once("exit", () => this.forget());
  }

  private pageHtml = "";

  private forget(): void {
    try { const file = recordFile(this.path); if (existsSync(file) && (JSON.parse(readFileSync(file, "utf8")) as LinkRecord).pid === process.pid) rmSync(file); } catch { /* another link's by now */ }
  }

  /** End the link from this side: the editor is told, the page says so, the server stops. */
  end(reason: string): void {
    if (this.over !== null) return;
    this.over = reason;
    if (this.beat) clearInterval(this.beat);
    this.push({ method: "ended", params: { reason } });
    for (const w of this.waiting.values()) { clearTimeout(w.timer); w.fail(new LinkError("ended", t("The link to {name} has ended", { name: this.name }), HINTS.ended())); }
    this.waiting.clear();
    owned.delete(this.path);
    this.forget();
    // The page hears the end on the stream; give it a moment before the stream goes.
    setTimeout(() => { this.stream?.end(); this.server?.close(); this.server?.closeAllConnections?.(); }, 150).unref();
    for (const fn of this.watchers.splice(0)) fn(reason);
  }

  async close(): Promise<void> { this.end(t("scmjs ended it")); }

  private push(message: Record<string, unknown>): void {
    const line = `data: ${JSON.stringify(message)}\n\n`;
    if (this.stream) this.stream.write(line); else this.queued.push(line);
  }

  call(method: string, params: Record<string, unknown> = {}, bytes?: Uint8Array): Promise<LinkAnswer> {
    if (this.over !== null) return Promise.reject(new LinkError("ended", t("The link to {name} has ended", { name: this.name }), HINTS.ended()));
    const id = `c${this.nextId++}`;
    if (bytes) this.blobs.set(id, bytes);
    return new Promise<LinkAnswer>((done, fail) => {
      const timer = setTimeout(() => { this.waiting.delete(id); this.blobs.delete(id); fail(new LinkError("silent", t("The editor did not answer for {name}", { name: this.name }), t("Is its tab still open? Closing the map or the scmjs page ends the link."))); }, ANSWER_MS);
      this.waiting.set(id, { done, fail, timer });
      this.push({ id, method, params, blob: !!bytes });
    });
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = requestUrl(req);
    const [, first, second, third] = url.pathname.split("/");
    // A peer: another scmjs process, which read the key from the cache folder.
    if (first === "rpc" && req.method === "POST") {
      if (req.headers["x-scmjs-key"] !== this.key) { res.writeHead(403).end(); return; }
      const { json, bytes } = unframe(await readBody(req));
      let out: Buffer;
      try {
        if (json.method === "end") this.end(t("scmjs ended it"));
        const a = json.method === "alive" || json.method === "end" ? { result: { name: this.name }, bytes: null } : await this.call(String(json.method), (json.params ?? {}) as Record<string, unknown>, bytes ?? undefined);
        out = frame({ ok: true, result: a.result }, a.bytes);
      } catch (e) {
        out = frame({ ok: false, error: { code: e instanceof LinkError ? e.code : "failed", message: e instanceof Error ? e.message : String(e) } });
      }
      res.writeHead(200, { "content-type": "application/octet-stream" }).end(out);
      return;
    }
    if (first !== this.token) { res.writeHead(404).end(); return; }
    if (!second) { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(this.pageHtml); return; }
    if (second === "file") { res.writeHead(200, { "content-type": "application/octet-stream" }).end(Buffer.from(this.bytes)); return; }
    if (second === "blob" && third) {
      const blob = this.blobs.get(third);
      this.blobs.delete(third);
      res.writeHead(blob ? 200 : 404, { "content-type": "application/octet-stream" }).end(blob ? Buffer.from(blob) : undefined);
      return;
    }
    if (second === "events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      this.stream = res;
      // (Something at once, so the headers go out and the page's stream opens.)
      res.write(": open\n\n");
      for (const line of this.queued.splice(0)) res.write(line);
      // The page closed (or its browser did): nothing carries messages any more.
      req.on("close", () => { if (this.stream === res) { this.stream = null; if (this.over === null && this.taken === null) this.end(t("the scmjs page was closed")); } });
      return;
    }
    if (second === "up" && req.method === "POST") {
      const { json, bytes } = unframe(await readBody(req));
      res.writeHead(200, { "content-type": "application/octet-stream" }).end(await this.fromPage(json, bytes));
      return;
    }
    res.writeHead(404).end();
  }

  /** A message the page passed up: an answer to a request of ours, or a request of the editor's (answered in the response). */
  private async fromPage(m: Record<string, unknown>, bytes: Uint8Array | null): Promise<Buffer> {
    if (m.type === "scmjs.taken") { this.taken?.(typeof m.linked === "string" ? m.linked : "old"); return frame({}); }
    if (m.type === "scmjs.page") { if (this.over === null && this.taken === null) this.end(m.event === "editor-closed" ? t("the editor's tab was closed") : t("the scmjs page was closed")); return frame({}); }
    if (m.type === "scmjs.link.reply") {
      const w = this.waiting.get(String(m.id));
      if (w) {
        this.waiting.delete(String(m.id));
        clearTimeout(w.timer);
        const error = m.error as { code?: string; message?: string } | undefined;
        if (m.ok) w.done({ result: (m.result ?? {}) as Record<string, unknown>, bytes });
        else w.fail(new LinkError(error?.code ?? "failed", error?.message ?? t("The editor refused"), HINTS[error?.code ?? ""]?.() ?? null));
      }
      return frame({});
    }
    if (m.type !== "scmjs.link") return frame({});
    try {
      if (m.method === "ended") { this.end((m.params as { reason?: string } | undefined)?.reason === "closed" ? t("the map was closed in the editor") : t("the editor ended it")); return frame({}); }
      // The editor's Save: the file on disk, written here.
      if (m.method === "write") {
        if (!bytes?.length) throw new Error("no bytes to write");
        writeFileSync(this.path, bytes);
        this.bytes = bytes;
        this.saves++;
        for (const fn of this.saved) fn(bytes.length);
        return frame({ ok: true, result: { bytes: bytes.length } });
      }
      // The file as it is on disk now (what Save is about to write over).
      if (m.method === "file") return frame({ ok: true, result: {} }, new Uint8Array(await readFile(this.path)));
      return frame({ ok: false, error: { code: "unknown", message: `scmjs does not know "${String(m.method)}"` } });
    } catch (e) {
      return frame({ ok: false, error: { code: "failed", message: e instanceof Error ? e.message : String(e) } });
    }
  }

  private readonly saved: ((bytes: number) => void)[] = [];
  /** Hear each save the editor writes through the link. */
  onSave(fn: (bytes: number) => void): void { this.saved.push(fn); }
}

/** End every link this process owns (the MCP server going away, a command stopped). */
export function closeOwnedLinks(reason: string): void {
  for (const owner of [...owned.values()]) owner.end(reason);
}

/** Link `path` to the editor: hand it over and keep the page between the two. The owner is this process. */
export async function openLink(path: string, bytes: Uint8Array, options: OpenLinkOptions = {}): Promise<LinkOwner> {
  const abs = resolve(path);
  const has = await linkFor(abs);
  if (has) throw new CliError(t("{name} is already linked to the editor", { name: basename(abs) }), t("Close the map in the editor to end that link."), 2);
  const owner = new LinkOwner(abs, bytes);
  // A new link counts its changes from nothing: what was read over an earlier one says nothing about it.
  readAt.delete(abs);
  await owner.open(options);
  return owner;
}

/* ── A peer ─────────────────────────────────────────────── */

function post(record: LinkRecord, body: Buffer, timeout: number): Promise<Buffer> {
  return new Promise<Buffer>((done, fail) => {
    const req = request({ host: "127.0.0.1", port: record.port, path: "/rpc", method: "POST", headers: { "x-scmjs-key": record.key, "content-length": body.length }, timeout }, (res) => {
      if (res.statusCode !== 200) { res.resume(); fail(new Error(`status ${res.statusCode}`)); return; }
      void readBody(res).then(done, fail);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", fail);
    req.end(body);
  });
}

function peer(record: LinkRecord): Link {
  return {
    path: record.path, name: record.name,
    async close() { try { await post(record, frame({ method: "end" }), 3_000); } catch { /* gone already */ } },
    async call(method, params = {}, bytes) {
      let body: Buffer;
      try { body = await post(record, frame({ method, params }, bytes), ANSWER_MS + 5_000); }
      catch { throw new LinkError("ended", t("The link to {name} has ended", { name: record.name }), HINTS.ended()); }
      const { json, bytes: back } = unframe(body);
      if (json.ok) return { result: (json.result ?? {}) as Record<string, unknown>, bytes: back };
      const error = json.error as { code?: string; message?: string } | undefined;
      throw new LinkError(error?.code ?? "failed", error?.message ?? t("The editor refused"), HINTS[error?.code ?? ""]?.() ?? null);
    },
  };
}

function readRecord(file: string): LinkRecord | null {
  try {
    const r = JSON.parse(readFileSync(file, "utf8")) as LinkRecord;
    return typeof r.path === "string" && typeof r.port === "number" && typeof r.key === "string" ? r : null;
  } catch { return null; }
}

/** A record whose owner still answers; one whose owner is gone is dropped. */
async function alive(file: string): Promise<LinkRecord | null> {
  const record = readRecord(file);
  if (!record) return null;
  try { await post(record, frame({ method: "alive" }), 1_500); return record; }
  catch { try { rmSync(file); } catch { /* gone already */ } return null; }
}

/** The live link to the file at `path`, or null: this process's own, else another's found in the cache folder. */
export async function linkFor(path: string): Promise<Link | null> {
  const abs = resolve(path);
  const own = owned.get(abs);
  if (own) return own;
  const file = recordFile(abs);
  if (!existsSync(file)) return null;
  const record = await alive(file);
  return record && record.path === abs ? peer(record) : null;
}

/** Every live link on this computer: this process's and the others'. */
export async function allLinks(): Promise<Link[]> {
  const out: Link[] = [...owned.values()];
  let files: string[] = [];
  try { files = readdirSync(linksDir()).filter((f) => f.endsWith(".json")); } catch { /* no links yet */ }
  for (const f of files) {
    const record = await alive(join(linksDir(), f));
    if (record && !owned.has(record.path)) out.push(peer(record));
  }
  return out;
}

/* ── What the commands go through ───────────────────────── */

/** The revision each linked map was last read at, so a change made from older bytes is refused rather than applied. */
const readAt = new Map<string, number>();
let label = "scmjs";

/** The words the editor's Undo shows for the next change: the command or tool that makes it. */
export function setLinkLabel(text: string): void { label = text; }

/** A linked map as the editor has it now, or null when the file is not linked. */
export async function linkedRead(path: string): Promise<Uint8Array | null> {
  const link = await linkFor(path);
  if (!link) return null;
  const a = await link.call("read");
  if (!a.bytes) throw new LinkError("failed", t("The editor sent no map for {name}", { name: link.name }));
  readAt.set(link.path, Number(a.result.rev));
  return a.bytes;
}

/** Put `bytes` in the editor as the linked map at `path`, one undo step. False when the file is not linked. */
export async function linkedWrite(path: string, bytes: Uint8Array): Promise<boolean> {
  const link = await linkFor(path);
  if (!link) return false;
  const base = readAt.get(link.path);
  const a = await link.call("apply", { label, ...(base === undefined ? {} : { base }) }, bytes);
  // What this process holds is now what the editor holds: a second change in the same run starts from here.
  if (typeof a.result.rev === "number") readAt.set(link.path, a.result.rev);
  return true;
}

/* ── The editor's game data ─────────────────────────────── */

/** The editor's own data set, lent through a link: files by the path the editor's loaders ask for. */
export interface LentGame {
  /** What it is, for a person: "the editor's game data (StarCraft: Brood War)". */
  label: string;
  readStored(path: string): Promise<Uint8Array | null>;
}

const lent = new Map<string, { stamp: string; game: LentGame }>();

/**
 * The game data of the editor a file is linked to, for this process's plugin host (`run.ts#giveHostGame`): the
 * tables of the data set the editor is drawing the map with, so terrain is laid with the tileset the person sees,
 * a mod's among them, and no installation is needed here. Null when the file is not linked, the editor has no game
 * data, or it is an editor from before this (it answers `unknown`).
 *
 * The same object is answered while the editor's data set is the same one, so the host keeps what it decoded and
 * each file crosses the link once; a data set in memory with no digest (a mod being edited) is asked afresh.
 */
export async function linkedGame(path: string): Promise<LentGame | null> {
  const link = await linkFor(path);
  if (!link) return null;
  let info: Record<string, unknown>;
  try { info = (await link.call("gamedata")).result; } catch (e) {
    if (e instanceof LinkError && e.code === "unknown") return null;
    throw e;
  }
  if (typeof info.kind !== "string" || info.kind === "none") return null;
  const stamp = `${info.kind}|${String(info.profile)}|${String(info.hash ?? "")}`;
  const had = lent.get(link.path);
  if (had && had.stamp === stamp && (info.kind !== "reader" || info.hash)) return had.game;
  const files = new Map<string, Promise<Uint8Array | null>>();
  const game: LentGame = {
    label: t("the editor's game data ({name})", { name: String(info.name ?? info.profile ?? "") }),
    readStored: (file) => {
      let reading = files.get(file);
      if (!reading) {
        // A file the link does not carry (a picture the loaders probe for) is one the copy does not have.
        reading = link.call("gamefile", { path: file }).then((a) => a.bytes ?? null, (e) => { if (e instanceof LinkError && e.code === "failed") return null; throw e; });
        files.set(file, reading);
      }
      return reading;
    },
  };
  lent.set(link.path, { stamp, game });
  return game;
}

/* ── The page ───────────────────────────────────────────── */

/** The page between the command and the editor: it opens the editor, hands it the map, then carries the link's messages. */
function linkPage(name: string, editor: string, token: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const origin = new URL(editor).origin;
  return `<!doctype html><meta charset="utf-8"><title>${esc(name)} · scmjs link</title>
<style>body{font:15px system-ui,sans-serif;background:#14141c;color:#d8d8e8;display:grid;place-items:center;height:90vh;margin:0}
main{text-align:center;max-width:34em;padding:0 1em}button{font:inherit;padding:.6em 1.4em;border-radius:6px;border:1px solid #4a4a6a;background:#262640;color:#fff;cursor:pointer}
p{color:#9898b0}b{color:#fff}</style>
<main><h2>${esc(name)}</h2><p id="say">Opening the editor…</p><button id="go" hidden>Open in the editor</button></main>
<script>
const editor = ${JSON.stringify(editor)}, origin = ${JSON.stringify(origin)}, base = "/" + ${JSON.stringify(token)}, name = ${JSON.stringify(name)};
const say = (t) => { document.getElementById("say").textContent = t; };
let win = null, linked = false, over = false;
// A line of JSON, then bytes: up to the command, and its answer back the same way.
async function up(json, bytes) {
  const res = await fetch(base + "/up", { method: "POST", body: new Blob([JSON.stringify(json) + "\\n", bytes || new Uint8Array()]) });
  const buf = new Uint8Array(await res.arrayBuffer());
  const at = buf.indexOf(10);
  const head = new TextDecoder().decode(at < 0 ? buf : buf.subarray(0, at));
  const rest = at < 0 ? null : buf.slice(at + 1);
  return { json: head ? JSON.parse(head) : {}, bytes: rest && rest.length ? rest : null };
}
function ended(text) {
  if (over) return;
  over = true;
  say(text);
  document.title = name + " · link ended";
}
addEventListener("message", async (e) => {
  if (e.origin !== origin || e.source !== win) return;
  const d = e.data, type = d && d.type;
  if (typeof type !== "string" || !type.startsWith("scmjs.")) return;
  if (type === "scmjs.ready") {
    if (linked) return;
    const bytes = new Uint8Array(await (await fetch(base + "/file")).arrayBuffer());
    win.postMessage({ type: "scmjs.open", files: [{ name, bytes }], link: true }, origin, [bytes.buffer]);
  } else if (type === "scmjs.taken") {
    linked = d.linked === "yes";
    await up({ type, linked: typeof d.linked === "string" ? d.linked : "old" });
    if (linked) say("Linked to scmjs. Keep this tab open: closing it ends the link.");
    else ended(d.linked === "no" ? "The editor did not open the map, so it is not linked." : "The editor opened the map as a copy: it is older than this scmjs and cannot link.");
  } else if (type === "scmjs.link.reply") {
    const { bytes, ...json } = d;
    await up(json, bytes);
  } else if (type === "scmjs.link") {
    const { bytes, ...json } = d;
    const r = await up(json, bytes);
    if (d.method === "ended") ended("The link has ended: the map was closed in the editor. You can close this tab.");
    else if (d.id) win.postMessage({ type: "scmjs.link.reply", id: d.id, ...r.json, ...(r.bytes ? { bytes: r.bytes } : {}) }, origin, r.bytes ? [r.bytes.buffer] : []);
  }
});
// The command's requests come down this stream; a map's bytes are fetched beside it.
const stream = new EventSource(base + "/events");
stream.onmessage = async (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "ended" && !m.id) { ended("The link has ended: scmjs closed it. You can close this tab."); stream.close(); }
  if (!win) return;
  const bytes = m.blob ? new Uint8Array(await (await fetch(base + "/blob/" + m.id)).arrayBuffer()) : null;
  win.postMessage({ type: "scmjs.link", id: m.id, method: m.method, params: m.params, ...(bytes ? { bytes } : {}) }, origin, bytes ? [bytes.buffer] : []);
};
stream.onerror = () => {
  stream.close();
  if (win && !win.closed && linked && !over) win.postMessage({ type: "scmjs.link", method: "ended", params: { reason: "scmjs stopped" } }, origin);
  ended("The link has ended: scmjs is no longer running. You can close this tab.");
};
// The editor's tab closing ends the link too.
setInterval(() => { if (linked && !over && win && win.closed) { ended("The link has ended: the editor's tab was closed. You can close this tab."); up({ type: "scmjs.page", event: "editor-closed" }).catch(() => {}); } }, 1000);
addEventListener("pagehide", () => { if (!over) navigator.sendBeacon(base + "/up", JSON.stringify({ type: "scmjs.page", event: "closed" }) + "\\n"); });
// A page holding a lock is not put to sleep in the background, and this one must keep carrying messages there.
if (navigator.locks) navigator.locks.request("scmjs-link-" + base, () => new Promise(() => {}));
function go() { win = open(editor, "_blank"); if (win) { document.getElementById("go").hidden = true; say("Waiting for the editor…"); } return !!win; }
if (!go()) { say("Your browser asks before opening the editor."); document.getElementById("go").hidden = false; }
document.getElementById("go").onclick = go;
</script>`;
}
