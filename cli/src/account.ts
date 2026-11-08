/**
 * `scmjs login | logout | account`: a scmjs.dev account from the terminal. The sign-in is the editor's — the provider
 * in a popup, the server's callback page posting the session to the window that opened it — with a page this command
 * serves on the loopback address as that window (as `map open`'s hand-over page, open.ts). The command asks the server
 * for the provider's address itself (`POST /v1/auth/start { cli: true }`, no Origin), so the page never calls the
 * server and needs nothing of CORS; the server returns a `cli` sign-in to a loopback origin only (ai-server 0.36.0).
 * The session is kept in a file of the person's own (`sessionPath`, mode 600) with the server it belongs to.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { openBrowser } from "./open";
import { qrFor } from "./qr";
import { t } from "./i18n";
import { CliError, dot, gameText, pc, rows, size, table } from "./ui";

/** The scmjs.dev service the editor's scmjs.dev plugin talks to. */
export const DEFAULT_SERVER = "https://api.scmjs.dev";
/** Where the links lead: the web editor, which opens `map/<token>` and `share/<invite>` itself. */
export const WEB_EDITOR = "https://scmjs.dev/editor/";
/** The query a link carries when it was made on another server, so the editor reaches that one (the plugin's `SERVER_QUERY`). */
export const SERVER_QUERY = "scmjs-server";
export const PROVIDERS = ["discord", "google", "battlenet"] as const;
export const PROVIDER_NAMES: Record<string, string> = { discord: "Discord", google: "Google", battlenet: "Battle.net" };
/** What the server's callback page posts to its opener. */
export const AUTH_MESSAGE_TYPE = "scmjs-ai-auth";
export const SIGN_IN_TIMEOUT_MS = 120_000;

/** The server: `SCMJS_SERVER`, else scmjs.dev's. */
export const serverUrl = (env: NodeJS.ProcessEnv = process.env): string => (env.SCMJS_SERVER?.trim() || DEFAULT_SERVER).replace(/\/+$/, "");

/** The session file: `SCMJS_SESSION`, else `scmjs/session.json` in the person's configuration folder. */
export function sessionPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (env.SCMJS_SESSION) return resolve(env.SCMJS_SESSION);
  const base = platform === "win32" ? env.APPDATA || join(home, "AppData", "Roaming") : env.XDG_CONFIG_HOME || join(home, ".config");
  return join(base, "scmjs", "session.json");
}

/* ── What the server answers (ai-server's src/protocol.ts, the parts read here) ───────── */

export interface StorageView { usedBytes: number; capBytes: number; maps: number; revisions: number }
export interface AccountView {
  kind: "trial" | "account";
  name?: string;
  role: string;
  providers: string[];
  storage?: StorageView;
}
export type KeepDays = 1 | 7 | 30 | null;
export interface SharedMapView { id: string; kind: "live" | "kept"; name: string; invite: string; people: string[]; createdAt: string; keepDays?: KeepDays; endsAt?: string; lastEditAt?: string }
export interface SharedMapsResponse { rooms: SharedMapView[]; limit: number }

/* ── The session file ────────────────────────────────────────────── */

export interface SavedSession {
  /** The server it was given by; a session is sent to no other. */
  server: string;
  session: string;
  name: string | null;
  provider: string;
  savedAt: string;
}

export function readSession(path = sessionPath()): SavedSession | null {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { return null; }
  try {
    const s = JSON.parse(raw) as Partial<SavedSession>;
    return typeof s.session === "string" && s.session && typeof s.server === "string"
      ? { server: s.server, session: s.session, name: typeof s.name === "string" ? s.name : null, provider: String(s.provider ?? ""), savedAt: String(s.savedAt ?? "") }
      : null;
  } catch { return null; }
}

/** Written whole (a `.part` and a rename) and readable by its owner only: folder 700, file 600. */
export function saveSession(s: SavedSession, path = sessionPath()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const part = `${path}.part`;
  writeFileSync(part, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
  // (`mode` applies only to a file it creates; a `.part` left behind by a crash keeps its own.)
  try { chmodSync(part, 0o600); } catch { /* Windows: the folder's permissions are what count */ }
  renameSync(part, path);
}

export function forgetSession(path = sessionPath()): boolean {
  try { rmSync(path); return true; } catch { return false; }
}

/** The session for `server`, or the CliError every account command answers without one. */
export function requireSession(server = serverUrl(), path = sessionPath()): SavedSession {
  const s = readSession(path);
  if (!s) throw new CliError(t("Sign in first: scmjs login"), null, 2);
  if (s.server !== server) throw new CliError(t("Sign in first: scmjs login"), t("The session in {path} is for {server}, not {wanted}.", { path, server: s.server, wanted: server }), 2);
  return s;
}

/* ── Talking to the server ───────────────────────────────────────── */

export interface ClientOptions { server?: string; session?: string | null; fetchImpl?: typeof fetch }

/** The account API: JSON in and out, the session as a bearer token, the server's own words for a refusal. */
export class Client {
  readonly server: string;
  private readonly session: string | null;
  private readonly fetchImpl: typeof fetch;
  constructor(o: ClientOptions = {}) {
    this.server = (o.server ?? serverUrl()).replace(/\/+$/, "");
    this.session = o.session ?? null;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  /** `body`: JSON, or a FormData for an upload. A 404 answers null when `missingOk` (a server without that part). */
  async request<T>(method: string, path: string, body?: unknown, o: { timeoutMs?: number; missingOk?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.session) headers.authorization = `Bearer ${this.session}`;
    let payload: string | FormData | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.server}${path}`, { method, headers, body: payload, signal: AbortSignal.timeout(o.timeoutMs ?? 30_000) });
    } catch (e) {
      const why = e instanceof Error && e.name === "TimeoutError" ? t("it did not answer in time") : (e as { cause?: { code?: string; message?: string } }).cause?.code ?? (e as { cause?: { message?: string } }).cause?.message ?? (e instanceof Error ? e.message : String(e));
      throw new CliError(t("Could not reach {server}: {why}", { server: this.server, why }), this.server === DEFAULT_SERVER ? t("Check the connection; scmjs.dev's status is on https://scmjs.dev.") : t("SCMJS_SERVER names the server."));
    }
    if (res.status === 404 && o.missingOk) return null as T;
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* said below */ }
    if (!res.ok) throw serverError(res, data);
    if (data === null) throw new CliError(t("{server} answered {method} {path} with something that is not JSON", { server: this.server, method, path }), t("SCMJS_SERVER may name something that is not a scmjs.dev server."));
    return data as T;
  }
}

/** A refusal in the server's words (`{ error: { code, message, retryAfterSec } }`); a session it no longer knows is exit 2 with the way back. */
function serverError(res: Response, data: unknown): CliError {
  const e = (data as { error?: { code?: string; message?: string; retryAfterSec?: number } } | null)?.error;
  const retry = e?.retryAfterSec ?? (Number(res.headers.get("retry-after")) || 0);
  const message = e?.message ?? t("The server answered {status}", { status: `${res.status} ${res.statusText}`.trim() });
  const later = !retry ? "" : ` ${retry >= 90 ? t("Try again in {n, plural, one {# minute} other {# minutes}}.", { n: Math.ceil(retry / 60) }) : t("Try again in {n, plural, one {# second} other {# seconds}}.", { n: retry })}`;
  if (res.status === 401 || e?.code === "unauthorized") return new CliError(message, t("scmjs login signs in again."), 2);
  return new CliError(`${message}${later}`);
}

/** `scmjs.dev` for the default server, else the address, for the lines that name it. */
export const serverLabel = (server: string): string => (server === DEFAULT_SERVER ? "scmjs.dev" : server);

/** The editor's address for a link: `<editor>map/<token>` or `share/<invite>`, carrying a server that is not scmjs.dev's. */
export function linkTo(kind: "map" | "share" | "replay", token: string, server = serverUrl()): string {
  const query = server !== DEFAULT_SERVER ? `?${new URLSearchParams({ [SERVER_QUERY]: server }).toString()}` : "";
  return `${WEB_EDITOR}${kind}/${token}${query}`;
}

/* ── Signing in ──────────────────────────────────────────────────── */

export interface LoginOptions {
  provider?: string;
  server?: string;
  file?: string;
  fetchImpl?: typeof fetch;
  /** Opens the page; the person's browser by default (`BROWSER=none` opens nothing). */
  open?: (url: string) => void;
  /** Told the page's address once it is served, before anything is opened. */
  say?: (page: string, providerName: string) => void;
  timeoutMs?: number;
}

export interface LoginOutcome { server: string; file: string; provider: string; account: AccountView }

/**
 * The sign-in: a page on 127.0.0.1 (a random port and path), which opens the provider in a popup; the server's
 * callback page posts the session back to it, and it posts the session here. The session is checked with
 * `GET /v1/account` before it is kept, and the page is told who signed in (or why not).
 */
export async function login(o: LoginOptions = {}): Promise<LoginOutcome> {
  const provider = (o.provider ?? "discord").toLowerCase();
  if (!(PROVIDERS as readonly string[]).includes(provider)) throw new CliError(t("{provider} is not a sign-in scmjs.dev offers", { provider: String(o.provider) }), t("One of {list}.", { list: PROVIDERS.join(", ") }), 2);
  const server = (o.server ?? serverUrl()).replace(/\/+$/, "");
  const file = o.file ?? sessionPath();
  const providerName = PROVIDER_NAMES[provider] ?? provider;
  const token = randomBytes(12).toString("hex");
  let finish: (r: { session: string; reply: (status: number, body: unknown) => void } | null) => void = () => {};
  const arrived = new Promise<{ session: string; reply: (status: number, body: unknown) => void } | null>((r) => { finish = r; });
  let providerUrl = "";
  let origin = "";
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, type: string, body: string) => { res.writeHead(status, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
    if (url.pathname === `/${token}` && req.method === "GET") return send(200, "text/html; charset=utf-8", loginPage({ providerUrl, providerName, server: new URL(server).origin, token }));
    if (url.pathname === `/${token}/session` && req.method === "POST") {
      // Only the page itself: a fetch from it carries its own origin.
      if (req.headers.origin !== origin) return send(403, "application/json", JSON.stringify({ error: "Not from the sign-in page." }));
      void readBody(req).then((text) => {
        let session = "";
        try { session = String((JSON.parse(text) as { session?: unknown }).session ?? ""); } catch { /* checked below */ }
        if (!session) return send(400, "application/json", JSON.stringify({ error: "No session came." }));
        finish({ session, reply: (status, body) => send(status, "application/json", JSON.stringify(body)) });
      });
      return;
    }
    send(404, "text/plain", "Not here.");
  });
  await new Promise<void>((r, j) => { http.once("error", j); http.listen(0, "127.0.0.1", () => r()); });
  origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const page = `${origin}/${token}`;
  const timer = setTimeout(() => finish(null), o.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
  try {
    const client = new Client({ server, fetchImpl: o.fetchImpl });
    try {
      providerUrl = (await client.request<{ url: string }>("POST", "/v1/auth/start", { provider, returnOrigin: origin, cli: true })).url;
    } catch (e) {
      // A server from before the command-line sign-in (ai-server 0.36.0) ignores `cli` and refuses the loopback page.
      if (e instanceof CliError && /not an allowed origin/.test(e.message)) throw new CliError(e.message, t("{server} does not take a sign-in from the command line yet.", { server: serverLabel(server) }));
      throw e;
    }
    o.say?.(page, providerName);
    (o.open ?? openBrowser)(page);
    const got = await arrived;
    if (!got) throw new CliError(t("The sign-in did not finish in {n, plural, one {# minute} other {# minutes}}", { n: Math.round((o.timeoutMs ?? SIGN_IN_TIMEOUT_MS) / 60_000) || 1 }), t("Run scmjs login again. BROWSER=none prints the address to open yourself."));
    let account: AccountView;
    try {
      account = (await new Client({ server, session: got.session, fetchImpl: o.fetchImpl }).request<{ account: AccountView }>("GET", "/v1/account")).account;
    } catch (e) {
      got.reply(502, { error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
    if (account.kind !== "account") { got.reply(400, { error: t("That is a trial session, not an account.") }); throw new CliError(t("The server gave a trial session, not an account"), t("Run scmjs login again.")); }
    saveSession({ server, session: got.session, name: account.name ?? null, provider, savedAt: new Date().toISOString() }, file);
    got.reply(200, { name: account.name ?? "" });
    return { server, file, provider, account };
  } finally {
    clearTimeout(timer);
    // (A moment for the page's answer to leave before the server stops.)
    await new Promise((r) => setTimeout(r, 50));
    http.closeAllConnections?.();
    http.close();
  }
}

function readBody(req: IncomingMessage, max = 16_384): Promise<string> {
  return new Promise((resolveBody) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => { text += c; if (text.length > max) { text = ""; req.destroy(); } });
    req.on("end", () => resolveBody(text));
    req.on("error", () => resolveBody(""));
  });
}

/**
 * The loopback page: opens the provider in a popup (a click where the browser blocks a window it opens by itself),
 * takes the session the server's callback page posts it — from the server's origin and that popup only — and hands
 * it to the command, then says who signed in.
 */
export function loginPage(p: { providerUrl: string; providerName: string; server: string; token: string }): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const js = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  // The words the page shows, in the reader's language; `{name}` is filled in by the page.
  const said = {
    signedIn: t("Signed in. Telling the command…"),
    signedInAs: t("Signed in as {name}. You can close this tab and go back to the terminal.", { name: "{name}" }),
    signedInNoName: t("Signed in. You can close this tab and go back to the terminal."),
    refused: t("The command did not take the sign-in."),
    stopped: t("The command has stopped waiting. Run scmjs login again."),
    waiting: t("Waiting for {provider}…", { provider: p.providerName }),
    blocked: t("Your browser asks before opening the sign-in window."),
  };
  return `<!doctype html><meta charset="utf-8"><title>${esc(t("Signing in to scmjs.dev"))}</title>
<style>body{font:15px system-ui,sans-serif;background:#14141c;color:#d8d8e8;display:grid;place-items:center;height:90vh;margin:0}
main{text-align:center;max-width:32em}button{font:inherit;padding:.6em 1.4em;border-radius:6px;border:1px solid #4a4a6a;background:#262640;color:#fff;cursor:pointer}
p{color:#9898b0}</style>
<main><h2>scmjs login</h2><p id="say">${esc(t("Opening {provider}…", { provider: p.providerName }))}</p><button id="go" hidden>${esc(t("Sign in with {provider}", { provider: p.providerName }))}</button></main>
<script>
const provider = ${js(p.providerUrl)}, server = ${js(p.server)}, token = ${js(p.token)}, said = ${js(said)};
const say = (t) => { document.getElementById("say").textContent = t; };
let win = null, done = false;
addEventListener("message", async (e) => {
  if (done || e.origin !== server || !win || e.source !== win) return;
  const m = e.data;
  if (!m || m.type !== ${js(AUTH_MESSAGE_TYPE)} || typeof m.session !== "string") return;
  done = true;
  say(said.signedIn);
  try {
    const r = await fetch("/" + token + "/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: m.session }) });
    const a = await r.json().catch(() => ({}));
    say(r.ok ? (a.name ? said.signedInAs.replace("{name}", a.name) : said.signedInNoName) : (a.error || said.refused));
  } catch (err) {
    say(said.stopped);
  }
});
function go() { win = open(provider, "scmjs-signin", "width=540,height=720,popup=yes"); if (win) { document.getElementById("go").hidden = true; say(said.waiting); } return !!win; }
if (!go()) { say(said.blocked); document.getElementById("go").hidden = false; }
document.getElementById("go").onclick = go;
</script>`;
}

/* ── Signing out, and the account ────────────────────────────────── */

export interface LogoutOutcome { file: string; was: SavedSession | null; told: boolean }

/** Ends the session on its server (`POST /v1/auth/logout`; unreachable is no reason to keep the file) and deletes the file. */
export async function logout(o: { file?: string; fetchImpl?: typeof fetch } = {}): Promise<LogoutOutcome> {
  const file = o.file ?? sessionPath();
  const was = readSession(file);
  let told = false;
  if (was) {
    try { await new Client({ server: was.server, session: was.session, fetchImpl: o.fetchImpl }).request("POST", "/v1/auth/logout", {}, { timeoutMs: 10_000 }); told = true; } catch { /* the file goes regardless */ }
  }
  forgetSession(file);
  return { file, was, told };
}

export interface AccountReport { server: string; file: string; account: AccountView; shared: SharedMapsResponse | null }

/** Who the session is (`GET /v1/account`) and the maps it is sharing (`GET /v1/rooms/mine`; null from a server without shared maps). */
export async function accountReport(o: { server?: string; file?: string; fetchImpl?: typeof fetch } = {}): Promise<AccountReport> {
  const server = (o.server ?? serverUrl()).replace(/\/+$/, "");
  const file = o.file ?? sessionPath();
  const s = requireSession(server, file);
  const client = new Client({ server, session: s.session, fetchImpl: o.fetchImpl });
  const { account } = await client.request<{ account: AccountView }>("GET", "/v1/account");
  const shared = account.kind === "account" ? await client.request<SharedMapsResponse | null>("GET", "/v1/rooms/mine", undefined, { missingOk: true }) : null;
  // (The name may have changed at the provider since the sign-in; the doctor reads it from the file.)
  if (account.name && account.name !== s.name) saveSession({ ...s, name: account.name }, file);
  return { server, file, account, shared };
}

/** How long a kept map stays open, in words. */
export function keepWords(keepDays: KeepDays | undefined): string {
  if (keepDays === undefined) return t("until everyone leaves");
  if (keepDays === null) return t("until you end it");
  return { 1: t("for a day"), 7: t("for a week"), 30: t("for a month") }[keepDays];
}

/** `scmjs account`: who, the role, storage, and the maps being shared with their links. */
export function printAccount(r: AccountReport, home = homedir(), { qr = false } = {}): string[] {
  const a = r.account;
  const st = a.storage;
  const file = r.file.startsWith(home) ? `~${r.file.slice(home.length)}` : r.file;
  const lines = [
    `${pc.bold(a.name ?? t("(no name)"))}${pc.dim(` · ${a.providers.length ? t("signed in to {server} with {providers}", { server: serverLabel(r.server), providers: a.providers.map((p) => PROVIDER_NAMES[p] ?? p).join(", ") }) : t("signed in to {server}", { server: serverLabel(r.server) })}`)}`, "",
    ...rows([
      [t("Role"), a.role],
      [t("Storage"), st ? `${t("{used} of {cap}", { used: size(st.usedBytes), cap: size(st.capBytes) })}${dot}${t("{maps, plural, one {# map} other {# maps}}, {revisions, plural, one {# revision} other {# revisions}}", { maps: st.maps, revisions: st.revisions })}` : pc.dim(t("this server keeps no maps"))],
      [t("Shared"), r.shared ? t("{n} of {limit} at once", { n: r.shared.rooms.length, limit: r.shared.limit }) : pc.dim(t("this server shares no maps for editing"))],
      [t("Session"), pc.dim(file)],
    ]),
  ];
  if (r.shared?.rooms.length) {
    lines.push("", ...table(r.shared.rooms.map((m) => [
      gameText(m.name),
      m.kind === "kept" ? t("kept open {keep}", { keep: keepWords(m.keepDays ?? null) }) : m.people.length ? t("{n, plural, one {# person} other {# people}} in it", { n: m.people.length }) : t("open, nobody in it"),
      pc.cyan(linkTo("share", m.invite, r.server)),
    ]), 2));
    // --qr: each link's code under its name, one after another.
    if (qr) for (const m of r.shared.rooms) lines.push("", `  ${gameText(m.name)}`, ...qrFor(linkTo("share", m.invite, r.server)).map((l) => `  ${l}`));
  }
  return lines;
}
