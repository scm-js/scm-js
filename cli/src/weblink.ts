/**
 * scmjs.dev links as input: `https://scmjs.dev/editor/map/<token>` (a copy of a map), `/replay/<token>` and
 * `/editor/replay/<token>` (a replay, with or without `?t=…&play=…`), `/play/?replay=<token>` (where the site sends a
 * moment that is played from) and `/editor/share/<invite>` (a map shared for editing). A map or replay link is
 * downloaded through the server's public endpoints (`GET /v1/links/:token/file`, `GET /v1/replay-links/:token/file`):
 * no sign-in, and no session is sent. The server is the link's own `?scmjs-server=` when it carries one, else
 * `SCMJS_SERVER`, else scmjs.dev's.
 */
import { DEFAULT_SERVER, SERVER_QUERY, serverError, serverUrl } from "./account";
import type { Input } from "./files";
import { kindOf } from "./files";
import { t } from "./i18n";
import { CliError } from "./ui";

export type WebLinkKind = "map" | "replay" | "share";

export interface WebLink {
  kind: WebLinkKind;
  /** The link's token (a map or replay link) or the invite (a map shared for editing). */
  token: string;
  /** The server it belongs to, without a trailing slash. */
  server: string;
  /** The link as it was given. */
  url: string;
  /** A replay link's moment (`t`) and seat (`play`), as the link carries them. */
  at?: string;
  play?: string;
}

/** What a public map link opens (`GET /v1/links/:token`, ai-server's `PublicMapView`, the parts read here). */
export interface PublicMapView { token: string; name: string; description: string; owner: string | null; revision: number; fileName: string; sizeBytes: number; savedAt: string; meta?: { scenarioName?: string; width?: number; height?: number; tileset?: string } }
/** What a public replay link opens (`GET /v1/replay-links/:token`). */
export interface PublicReplayView { token: string; fileName: string; sizeBytes: number; note: string; uploadedAt: string; mapName: string; matchup: string; players: { name: string }[]; durationSec: number; gameTypeName?: string; playedAt: string | null }

/** Whether a command's argument is a web address rather than a file name. */
export const isWebAddress = (s: string): boolean => /^https?:\/\//i.test(s.trim());

const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;

/** Hosts a scmjs.dev link is on: scmjs.dev and its subdomains, this computer (the local stand-in), and `SCMJS_EDITOR_URL`'s. */
function ourHost(host: string, env: NodeJS.ProcessEnv): boolean {
  const h = host.toLowerCase();
  if (h === "scmjs.dev" || h.endsWith(".scmjs.dev") || h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
  try { return !!env.SCMJS_EDITOR_URL && new URL(env.SCMJS_EDITOR_URL).hostname.toLowerCase() === h; } catch { return false; }
}

/**
 * The link a command was given, or a CliError saying why it is not one a command reads. `scmjs.dev/…` without
 * `https://` is not taken: a file can have that name.
 */
export function parseWebLink(text: string, env: NodeJS.ProcessEnv = process.env): WebLink {
  const notOne = () => new CliError(t("{url} is not a scmjs.dev link to a map or replay", { url: text }), t("A link to a map is https://scmjs.dev/editor/map/…, to a replay https://scmjs.dev/replay/…"), 2);
  let url: URL;
  try { url = new URL(text.trim()); } catch { throw notOne(); }
  if (!ourHost(url.hostname, env)) throw notOne();
  const named = url.searchParams.get(SERVER_QUERY);
  let server = serverUrl(env);
  if (named) {
    try { const s = new URL(named); if (s.protocol === "http:" || s.protocol === "https:") server = `${s.origin}${s.pathname}`.replace(/\/+$/, ""); } catch { /* the default */ }
  }
  const moment = { ...(url.searchParams.get("t") ? { at: url.searchParams.get("t")! } : {}), ...(url.searchParams.has("play") ? { play: url.searchParams.get("play") ?? "" } : {}) };
  // The play page's form of a moment: /play/?replay=<token>&t=…&play=…
  const onPlay = url.searchParams.get("replay");
  if (/\/play\/?$/.test(url.pathname) && onPlay && TOKEN.test(onPlay)) return { kind: "replay", token: onPlay, server, url: text, ...moment };
  const m = /\/(map|replay|share)\/([^/]+)\/?$/.exec(url.pathname);
  if (!m || !TOKEN.test(m[2])) throw notOne();
  const kind = m[1] as WebLinkKind;
  return { kind, token: m[2], server, url: text, ...(kind === "replay" ? moment : {}) };
}

/** The file's name from a `Content-Disposition` (`filename*=UTF-8''…` first), or null. */
export function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch { /* the plain one */ } }
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/i.exec(header);
  const name = (plain?.[1] ?? plain?.[2] ?? "").trim();
  return name || null;
}

/** A file name a link's download may be written under: no folders, nothing a file system refuses. */
export function safeFileName(name: string, fallback: string): string {
  const base = name.replace(/^.*[\\/]/, "").replace(/[<>:"|?*\x00-\x1f]/g, "_").trim();
  return base && base !== "." && base !== ".." ? base.slice(0, 200) : fallback;
}

export interface Downloaded { bytes: Uint8Array; fileName: string; revision?: number }

async function reach(server: string, path: string, fetchImpl: typeof fetch, timeoutMs: number, session?: string): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/octet-stream, application/json" };
  if (session) headers.authorization = `Bearer ${session}`;
  try {
    return await fetchImpl(`${server}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const why = e instanceof Error && e.name === "TimeoutError" ? t("it did not answer in time") : (e as { cause?: { code?: string; message?: string } }).cause?.code ?? (e as { cause?: { message?: string } }).cause?.message ?? (e instanceof Error ? e.message : String(e));
    throw new CliError(t("Could not reach {server}: {why}", { server, why }), server === DEFAULT_SERVER ? t("Check the connection; scmjs.dev's status is on https://scmjs.dev.") : t("SCMJS_SERVER names the server."));
  }
}

/** A refusal: the server's own words, with a gone link said as such. */
async function refused(res: Response): Promise<CliError> {
  let data: unknown = null;
  try { data = JSON.parse(await res.text()); } catch { /* the status */ }
  const e = serverError(res, data);
  // A link that is gone is a file that is not there: the command could not start (exit 2).
  return res.status === 404 ? new CliError(e.message, e.hint, 2) : e;
}

/**
 * A file the server sends (`path` under `server`): the bytes, the name its `Content-Disposition` gives (`fallback`
 * without one) and a map's revision. `session` is sent only by the account's own downloads.
 */
export async function fetchFile(server: string, path: string, fallback: string, o: { fetchImpl?: typeof fetch; timeoutMs?: number; session?: string } = {}): Promise<Downloaded> {
  const res = await reach(server, path, o.fetchImpl ?? fetch, o.timeoutMs ?? 60_000, o.session);
  if (!res.ok) throw await refused(res);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const revision = Number(res.headers.get("x-map-revision")) || undefined;
  return { bytes, fileName: safeFileName(dispositionName(res.headers.get("content-disposition")) ?? fallback, fallback), ...(revision ? { revision } : {}) };
}

/** A map or replay link's file, through the public endpoint; counts as an open of the link, as the editor's does. */
export async function downloadLink(link: WebLink, o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<Downloaded> {
  if (link.kind === "share") throw shareLinkError(link);
  const path = link.kind === "map" ? `/v1/links/${encodeURIComponent(link.token)}/file` : `/v1/replay-links/${encodeURIComponent(link.token)}/file`;
  return fetchFile(link.server, path, `${link.token}.${link.kind === "map" ? "scx" : "rep"}`, o);
}

/** What a map or replay link opens, for anyone: its name, owner, revision, players. */
export async function linkFacts(link: WebLink, o: { fetchImpl?: typeof fetch } = {}): Promise<{ map: PublicMapView } | { replay: PublicReplayView }> {
  if (link.kind === "share") throw shareLinkError(link);
  const path = link.kind === "map" ? `/v1/links/${encodeURIComponent(link.token)}` : `/v1/replay-links/${encodeURIComponent(link.token)}`;
  const res = await reach(link.server, path, o.fetchImpl ?? fetch, 30_000);
  if (!res.ok) throw await refused(res);
  return (await res.json()) as { map: PublicMapView } | { replay: PublicReplayView };
}

/** A link to edit a map together is a room, not a file: it is opened in the editor. */
export function shareLinkError(link: WebLink): CliError {
  return new CliError(t("{url} is a link to edit a map together, not a file", { url: link.url }), t("Open it in your browser. Its owner gets the map with scmjs library get, or makes a copy link with scmjs map share."), 2);
}

/**
 * A command's input from a link: the file downloaded, named as the server names it. `path` stays the link, so a
 * command that would write back over its input refuses (`writeOutput`) and asks for `--out`.
 */
export async function readWebLink(text: string, o: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {}): Promise<Input> {
  const link = parseWebLink(text, o.env);
  const got = await downloadLink(link, o);
  return { path: text, name: got.fileName, bytes: got.bytes, kind: kindOf(got.fileName, got.bytes), link: text };
}

/** The error for writing to a link: the change is written to a file named with `--out`. */
export function linkWriteError(path: string): CliError {
  return new CliError(t("{url} is a link, and a link cannot be written to", { url: path }), t("Name a file to write with -o (--out); scmjs map share puts a map back on scmjs.dev."), 2);
}

/**
 * `map open` / `replay open` given a link: the link itself in the browser, since it is the editor's own address for
 * that map or replay (nothing is downloaded, so no open is counted twice).
 */
export function openWebLink(text: string, kinds: WebLinkKind[], open: (url: string) => void): WebLink {
  const link = parseWebLink(text);
  if (!kinds.includes(link.kind)) {
    const what = (k: WebLinkKind) => (k === "replay" ? t("a replay") : t("a map"));
    throw new CliError(t("{url} is a link to {kind}, not {wanted}", { url: text, kind: what(link.kind), wanted: what(kinds[0]) }), null, 2);
  }
  open(text);
  return link;
}
