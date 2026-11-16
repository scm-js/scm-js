/**
 * `scmjs library`: what the scmjs.dev account keeps — maps with their revisions and copy links, replays with their
 * links, maps shared for editing — and `library get | rm | unlink | rename | note` on them. The site's Library page
 * and the editor's My Maps, from the terminal. Everything here returns data and prints nothing (`print*` make the
 * lines), so the MCP server can wrap the same functions.
 *
 * Things are named by a link (`https://scmjs.dev/editor/map/…`), an id (the 8 characters the list shows, or more), a
 * map's name or file name, or a replay's file name. `library get` also takes any public map or replay link, signed in
 * or not.
 */
import { createInterface } from "node:readline";
import { Client, linkTo, requireSession, serverUrl, sessionPath, keepWords, type KeepDays, type SharedMapView, type StorageView } from "./account";
import { t } from "./i18n";
import { CliError, dot, duration, gameText, padColumns, columns, pc, size } from "./ui";
import { fetchFile, isWebAddress, linkFacts, parseWebLink, shareLinkError, type PublicMapView, type PublicReplayView, type WebLink } from "./weblink";

/* ── What the server answers (ai-server's protocol.ts, the parts read here) ─────────── */

interface RevisionView { number: number; note: string; fileName: string; sizeBytes: number; createdAt: string; meta?: { scenarioName?: string; width?: number; height?: number; tileset?: string } }
interface MapLinkView { token: string; revision: number | null; opens?: number; createdAt?: string }
interface MapSummary { id: string; name: string; description?: string; createdAt?: string; updatedAt: string; revisions: number; head: RevisionView; links?: number }
interface MapDetail extends MapSummary { history: RevisionView[]; linkList: MapLinkView[] }
interface ReplayLinkView { token: string; opens?: number; createdAt?: string }
interface ReplayView {
  id: string; fileName: string; note: string; sizeBytes: number; uploadedAt: string;
  mapName: string; mapWidth?: number; mapHeight?: number; players: { name: string; race?: string | null }[]; matchup: string; durationSec: number; gameTypeName?: string; playedAt: string | null;
  links: ReplayLinkView[];
}

/* ── What this module answers ─────────────────────────────────────── */

export interface LibraryDeps { server?: string; file?: string; fetchImpl?: typeof fetch }

export interface LibraryLink {
  url: string; token: string;
  /** A map link: the revision it always opens, or null for whichever is newest. */
  revision?: number | null;
  opens: number; createdAt: string | null;
}
export interface LibraryMap {
  id: string; name: string; description: string; fileName: string;
  revisions: number; head: number;
  /** The newest revision's size. */
  sizeBytes: number;
  updatedAt: string;
  width: number | null; height: number | null; tileset: string | null;
  links: LibraryLink[];
  /** It is kept open for editing together: that link (the shared section has it too). */
  shared: string | null;
}
export interface LibraryReplay {
  id: string; fileName: string; note: string; sizeBytes: number; uploadedAt: string;
  mapName: string; matchup: string; players: string[]; durationSec: number; gameType: string | null; playedAt: string | null;
  links: LibraryLink[];
}
export interface LibraryShared {
  id: string; kind: "live" | "kept"; name: string; url: string; people: string[]; createdAt: string;
  /** Kept open: for how long after its last edit (null until ended); absent for a live one. */
  keepDays?: KeepDays; endsAt?: string; lastEditAt?: string;
}
export type LibraryPart = "maps" | "replays" | "shared";
export interface LibraryReport {
  server: string;
  storage: StorageView | null;
  /** null: not asked for, or a server that keeps none. */
  maps: LibraryMap[] | null;
  replays: LibraryReplay[] | null;
  shared: { rooms: LibraryShared[]; limit: number } | null;
  /** The parts this server does not have (maps off, replays off, sharing off). */
  missing: LibraryPart[];
}

const session = (o: LibraryDeps) => {
  const server = (o.server ?? serverUrl()).replace(/\/+$/, "");
  const s = requireSession(server, o.file ?? sessionPath());
  return { server, session: s.session, client: new Client({ server, session: s.session, fetchImpl: o.fetchImpl }) };
};
const enc = encodeURIComponent;

/** At most `n` at once: a detail per map with links, on an account with many. */
async function inTurns<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

const mapLink = (l: MapLinkView, server: string): LibraryLink => ({ url: linkTo("map", l.token, server), token: l.token, revision: l.revision, opens: l.opens ?? 0, createdAt: l.createdAt ?? null });
const replayLink = (l: ReplayLinkView, server: string): LibraryLink => ({ url: linkTo("replay", l.token, server), token: l.token, opens: l.opens ?? 0, createdAt: l.createdAt ?? null });

function libraryMap(m: MapSummary, links: MapLinkView[], server: string, shared: LibraryShared[]): LibraryMap {
  const meta = m.head.meta ?? {};
  return {
    id: m.id, name: m.name, description: m.description ?? "", fileName: m.head.fileName, revisions: m.revisions, head: m.head.number, sizeBytes: m.head.sizeBytes, updatedAt: m.updatedAt,
    width: meta.width ?? null, height: meta.height ?? null, tileset: meta.tileset ?? null,
    links: links.map((l) => mapLink(l, server)),
    shared: shared.find((r) => r.kind === "kept" && r.id === m.id)?.url ?? null,
  };
}

function libraryReplay(r: ReplayView, server: string): LibraryReplay {
  return {
    id: r.id, fileName: r.fileName, note: r.note, sizeBytes: r.sizeBytes, uploadedAt: r.uploadedAt, mapName: r.mapName, matchup: r.matchup,
    players: r.players.map((p) => p.name), durationSec: r.durationSec, gameType: r.gameTypeName ?? null, playedAt: r.playedAt, links: r.links.map((l) => replayLink(l, server)),
  };
}

const sharedOf = (r: SharedMapView, server: string): LibraryShared => ({
  id: r.id, kind: r.kind, name: r.name, url: linkTo("share", r.invite, server), people: r.people, createdAt: r.createdAt,
  ...(r.kind === "kept" ? { keepDays: r.keepDays ?? null } : {}), ...(r.endsAt ? { endsAt: r.endsAt } : {}), ...(r.lastEditAt ? { lastEditAt: r.lastEditAt } : {}),
});

/** Every map with its links (a map's links come with its detail, asked only for a map that has some). */
async function allMaps(client: Client): Promise<{ maps: { summary: MapSummary; links: MapLinkView[] }[]; storage: StorageView } | null> {
  const list = await client.request<{ maps: MapSummary[]; storage: StorageView } | null>("GET", "/v1/maps", undefined, { missingOk: true });
  if (!list) return null;
  const maps = await inTurns(list.maps, 6, async (m) => ({ summary: m, links: m.links === 0 ? [] : (await client.request<{ map: MapDetail }>("GET", `/v1/maps/${enc(m.id)}`)).map.linkList }));
  return { maps, storage: list.storage };
}

/** What the account keeps: all of it, or one part (`only`). */
export async function libraryReport(o: LibraryDeps & { only?: LibraryPart } = {}): Promise<LibraryReport> {
  const { server, client } = session(o);
  const want = (p: LibraryPart) => !o.only || o.only === p;
  const missing: LibraryPart[] = [];
  // The shared maps first: a map kept open for editing says so in its row.
  const rooms = want("shared") || want("maps") ? await client.request<{ rooms: SharedMapView[]; limit: number } | null>("GET", "/v1/rooms/mine", undefined, { missingOk: true }) : null;
  const shared = rooms ? rooms.rooms.map((r) => sharedOf(r, server)) : [];
  if (want("shared") && !rooms) missing.push("shared");
  let storage: StorageView | null = null;
  let maps: LibraryMap[] | null = null;
  if (want("maps")) {
    const got = await allMaps(client);
    if (got) { maps = got.maps.map((m) => libraryMap(m.summary, m.links, server, shared)); storage = got.storage; } else missing.push("maps");
  }
  let replays: LibraryReplay[] | null = null;
  if (want("replays")) {
    const got = await client.request<{ replays: ReplayView[]; storage: StorageView } | null>("GET", "/v1/replays", undefined, { missingOk: true });
    if (got) { replays = got.replays.map((r) => libraryReplay(r, server)); storage = got.storage; } else missing.push("replays");
  }
  if (!storage && o.only === "shared") storage = (await client.request<{ storage: StorageView } | null>("GET", "/v1/storage", undefined, { missingOk: true }))?.storage ?? null;
  return { server, storage, maps, replays, shared: want("shared") && rooms ? { rooms: shared, limit: rooms.limit } : null, missing };
}

/* ── Naming one thing ─────────────────────────────────────────────── */

export type Found =
  | { kind: "map"; map: MapDetail; link?: LibraryLink }
  | { kind: "replay"; replay: ReplayView; link?: LibraryLink }
  | { kind: "shared"; room: SharedMapView };

/** The short id the list shows. */
export const shortId = (id: string): string => id.replace(/-/g, "").slice(0, 8);
const idMatches = (id: string, what: string) => {
  const w = what.toLowerCase().replace(/-/g, "");
  return w.length >= 6 && /^[0-9a-f]+$/.test(w) && id.toLowerCase().replace(/-/g, "").startsWith(w);
};

/**
 * The account's map, replay or shared map that `what` names: a link to it, its id (from 6 characters), a map's name or
 * file name, a replay's file name. More than one is an error that lists them with their ids.
 */
export async function findInLibrary(what: string, o: LibraryDeps & { kinds?: Found["kind"][] } = {}): Promise<Found> {
  const { server, client } = session(o);
  const kinds = o.kinds ?? ["map", "replay", "shared"];
  const detail = async (id: string) => (await client.request<{ map: MapDetail }>("GET", `/v1/maps/${enc(id)}`)).map;
  if (isWebAddress(what)) {
    const link = parseWebLink(what);
    if (link.server !== server) throw new CliError(t("{url} is a link on {other}, and you are signed in to {server}", { url: what, other: link.server, server }), t("SCMJS_SERVER names the server."), 2);
    const notYours = () => new CliError(t("{url} is not a link to anything on your account", { url: what }), t("scmjs library lists your maps and replays with their links; scmjs library get downloads anyone's."), 2);
    if (link.kind === "share") {
      if (!kinds.includes("shared") && !kinds.includes("map")) throw notYours();
      const rooms = await client.request<{ rooms: SharedMapView[] } | null>("GET", "/v1/rooms/mine", undefined, { missingOk: true });
      const room = rooms?.rooms.find((r) => r.invite === link.token);
      if (!room) throw notYours();
      if (!kinds.includes("shared")) {
        if (room.kind !== "kept") throw new CliError(t("{name} is shared for editing until everyone leaves, and is not kept on your account", { name: room.name }), t("Open the link and save the map from the editor."), 2);
        return { kind: "map", map: await detail(room.id) };
      }
      return { kind: "shared", room };
    }
    if (link.kind === "map") {
      const got = (await allMaps(client))?.maps ?? [];
      const hit = got.find((m) => m.links.some((l) => l.token === link.token));
      if (!hit || !kinds.includes("map")) throw notYours();
      const map = await detail(hit.summary.id);
      return { kind: "map", map, link: mapLink(map.linkList.find((l) => l.token === link.token)!, server) };
    }
    const list = await client.request<{ replays: ReplayView[] } | null>("GET", "/v1/replays", undefined, { missingOk: true });
    const replay = list?.replays.find((r) => r.links.some((l) => l.token === link.token));
    if (!replay || !kinds.includes("replay")) throw notYours();
    return { kind: "replay", replay, link: replayLink(replay.links.find((l) => l.token === link.token)!, server) };
  }
  const maps = kinds.includes("map") ? (await client.request<{ maps: MapSummary[] } | null>("GET", "/v1/maps", undefined, { missingOk: true }))?.maps ?? [] : [];
  const replays = kinds.includes("replay") ? (await client.request<{ replays: ReplayView[] } | null>("GET", "/v1/replays", undefined, { missingOk: true }))?.replays ?? [] : [];
  const low = what.trim().toLowerCase();
  const byId = [...maps.filter((m) => idMatches(m.id, what)).map((m) => ({ kind: "map" as const, m })), ...replays.filter((r) => idMatches(r.id, what)).map((r) => ({ kind: "replay" as const, r }))];
  const byName = byId.length ? [] : [
    ...maps.filter((m) => m.name.toLowerCase() === low || m.head.fileName.toLowerCase() === low).map((m) => ({ kind: "map" as const, m })),
    ...replays.filter((r) => r.fileName.toLowerCase() === low).map((r) => ({ kind: "replay" as const, r })),
  ];
  const hits = byId.length ? byId : byName;
  if (!hits.length) {
    const what2 = kinds.includes("replay") && kinds.includes("map") ? t("map or replay") : kinds.includes("replay") ? t("replay") : t("map");
    throw new CliError(t("No {what} on your account is called {name}", { what: what2, name: what }), t("scmjs library lists them; name one by its name, its file name, its id or a link to it."), 2);
  }
  if (hits.length > 1) {
    const rows = hits.map((h) => (h.kind === "map" ? `  ${shortId(h.m.id)}  ${t("map")}  ${h.m.name} (${h.m.head.fileName})` : `  ${shortId(h.r.id)}  ${t("replay")}  ${h.r.fileName} (${h.r.mapName}, ${h.r.matchup})`));
    throw new CliError(`${t("{n} things on your account are called {name}; name one by its id:", { n: hits.length, name: what })}\n${rows.join("\n")}`, null, 2);
  }
  const hit = hits[0];
  if (hit.kind === "map") return { kind: "map", map: await detail(hit.m.id) };
  return { kind: "replay", replay: hit.r };
}

/* ── library get ──────────────────────────────────────────────────── */

export interface Got {
  kind: "map" | "replay";
  bytes: Uint8Array;
  /** The file's name on the server. */
  fileName: string;
  /** The map's name, or the replay's map and players. */
  name: string;
  /** A map's revision. */
  revision?: number;
  /** From the account, or through a public link (anyone's). */
  from: "account" | "link";
  owner?: string | null;
}

/** A map (its newest revision, or `revision`) or replay from the account, or from any public link, signed in or not. */
export async function getFromLibrary(what: string, o: LibraryDeps & { revision?: number } = {}): Promise<Got> {
  if (isWebAddress(what)) {
    const link = parseWebLink(what);
    if (link.kind !== "share") {
      if (o.revision !== undefined) throw new CliError(t("--revision is for a map on your account; a link opens the revision it was made for"), t("Name the map instead: scmjs library get <name> --revision {n}", { n: o.revision }), 2);
      return getByLink(link, o);
    }
    if (!sessionOrNull(o)) throw shareLinkError(link);
  }
  const { server, session: token } = session(o);
  const found = await findInLibrary(what, { ...o, kinds: ["map", "replay"] });
  if (found.kind === "replay") {
    if (o.revision !== undefined) throw new CliError(t("--revision is for maps; a replay has one file"), null, 2);
    const r = found.replay;
    const got = await fetchFile(server, `/v1/replays/${enc(r.id)}/file`, r.fileName, { fetchImpl: o.fetchImpl, session: token });
    return { kind: "replay", bytes: got.bytes, fileName: got.fileName, name: replayTitle(r), from: "account" };
  }
  if (found.kind !== "map") throw new CliError(t("{name} is not a map or a replay", { name: what }), null, 2);
  const m = found.map;
  const n = o.revision ?? m.head.number;
  if (!m.history.some((r) => r.number === n)) throw new CliError(t("{name} has no revision {n}", { name: m.name, n }), t("Its revisions: {list}.", { list: m.history.map((r) => r.number).join(", ") }), 2);
  const fallback = m.history.find((r) => r.number === n)?.fileName ?? `${m.name}.scx`;
  const got = await fetchFile(server, `/v1/maps/${enc(m.id)}/revisions/${n}/file`, fallback, { fetchImpl: o.fetchImpl, session: token });
  return { kind: "map", bytes: got.bytes, fileName: got.fileName, name: m.name, revision: n, from: "account" };
}

function sessionOrNull(o: LibraryDeps): boolean {
  try { session(o); return true; } catch { return false; }
}

async function getByLink(link: WebLink, o: LibraryDeps): Promise<Got> {
  const facts = await linkFacts(link, o);
  const got = await fetchFile(link.server, link.kind === "map" ? `/v1/links/${enc(link.token)}/file` : `/v1/replay-links/${enc(link.token)}/file`, `${link.token}.${link.kind === "map" ? "scx" : "rep"}`, o);
  if ("map" in facts) {
    const m: PublicMapView = facts.map;
    return { kind: "map", bytes: got.bytes, fileName: got.fileName, name: m.name, revision: got.revision ?? m.revision, from: "link", owner: m.owner };
  }
  const r: PublicReplayView = facts.replay;
  return { kind: "replay", bytes: got.bytes, fileName: got.fileName, name: replayTitle(r), from: "link" };
}

const replayTitle = (r: { mapName: string; matchup: string; players: { name: string }[] }) => [gameText(r.mapName) || t("Untitled"), r.matchup, r.players.map((p) => gameText(p.name)).join(" vs ")].filter(Boolean).join(" · ");

/* ── library rm, unlink ───────────────────────────────────────────── */

/** What a removal takes with it, said before it is made. */
export interface Removal {
  kind: "map" | "revision" | "replay";
  id: string; name: string;
  /** The revision that goes (`revision`), or the map's count of them (`map`). */
  revision?: number; revisions?: number;
  /** The links that stop working. */
  links: LibraryLink[];
  /** A map kept open for editing: its link stops working too. */
  shared?: string;
  /** Removing the newest revision: links to "the newest" open this one after. */
  newestAfter?: number;
  bytes: number;
}

export async function planRemoval(what: string, o: LibraryDeps & { revision?: number } = {}): Promise<Removal> {
  const { server, client } = session(o);
  const found = await findInLibrary(what, { ...o, kinds: ["map", "replay"] });
  if (found.kind === "replay") {
    if (o.revision !== undefined) throw new CliError(t("--revision is for maps; a replay has one file"), null, 2);
    const r = found.replay;
    return { kind: "replay", id: r.id, name: replayTitle(r), links: r.links.map((l) => replayLink(l, server)), bytes: r.sizeBytes };
  }
  if (found.kind !== "map") throw new CliError(t("{name} is not a map or a replay", { name: what }), null, 2);
  const m = found.map;
  if (o.revision === undefined) {
    const rooms = await client.request<{ rooms: SharedMapView[] } | null>("GET", "/v1/rooms/mine", undefined, { missingOk: true });
    const kept = rooms?.rooms.find((r) => r.kind === "kept" && r.id === m.id);
    return {
      kind: "map", id: m.id, name: m.name, revisions: m.history.length, links: m.linkList.map((l) => mapLink(l, server)),
      ...(kept ? { shared: linkTo("share", kept.invite, server) } : {}), bytes: m.history.reduce((n, r) => n + r.sizeBytes, 0),
    };
  }
  const n = o.revision;
  const rev = m.history.find((r) => r.number === n);
  if (!rev) throw new CliError(t("{name} has no revision {n}", { name: m.name, n }), t("Its revisions: {list}.", { list: m.history.map((r) => r.number).join(", ") }), 2);
  if (m.history.length <= 1) throw new CliError(t("{name} keeps its last revision", { name: m.name }), t("scmjs library rm \"{name}\" deletes the map.", { name: m.name }), 2);
  const newest = n === m.head.number ? m.history.filter((r) => r.number !== n).reduce((a, r) => Math.max(a, r.number), 0) : undefined;
  return {
    kind: "revision", id: m.id, name: m.name, revision: n, links: m.linkList.filter((l) => l.revision === n).map((l) => mapLink(l, server)),
    ...(newest !== undefined && m.linkList.some((l) => l.revision === null) ? { newestAfter: newest } : {}), bytes: rev.sizeBytes,
  };
}

/** The removal made; the account's storage after it. */
export async function removeFromLibrary(r: Removal, o: LibraryDeps = {}): Promise<{ storage: StorageView | null }> {
  const { client } = session(o);
  if (r.kind === "replay") return { storage: (await client.request<{ storage: StorageView }>("DELETE", `/v1/replays/${enc(r.id)}`)).storage };
  if (r.kind === "map") return { storage: (await client.request<{ storage: StorageView }>("DELETE", `/v1/maps/${enc(r.id)}`)).storage };
  return { storage: (await client.request<{ storage: StorageView }>("DELETE", `/v1/maps/${enc(r.id)}/revisions/${r.revision}`)).storage };
}

/** One link that stops working, said before it is removed. */
export interface Unlinking {
  kind: "map" | "replay" | "shared";
  /** The map's, replay's or shared map's id. */
  id: string; name: string; url: string; token: string;
  opens?: number; revision?: number | null;
  /** A shared map: the people in it now, and whether it is kept (it stays on the account as last edited). */
  people?: string[]; kept?: boolean;
}

export async function planUnlink(url: string, o: LibraryDeps = {}): Promise<Unlinking> {
  if (!isWebAddress(url)) throw new CliError(t("library unlink takes a link"), t("scmjs library lists your links; to delete a map or replay with all its links, scmjs library rm."), 2);
  const found = await findInLibrary(url, o);
  const link = parseWebLink(url);
  if (found.kind === "shared") {
    const r = found.room;
    return { kind: "shared", id: r.id, name: r.name, url, token: r.invite, people: r.people, kept: r.kind === "kept" };
  }
  if (found.kind === "map") return { kind: "map", id: found.map.id, name: found.map.name, url, token: link.token, opens: found.link?.opens ?? 0, revision: found.link?.revision ?? null };
  return { kind: "replay", id: found.replay.id, name: replayTitle(found.replay), url, token: link.token, opens: found.link?.opens ?? 0 };
}

export async function unlink(u: Unlinking, o: LibraryDeps = {}): Promise<void> {
  const { client } = session(o);
  if (u.kind === "map") await client.request("DELETE", `/v1/maps/${enc(u.id)}/links/${enc(u.token)}`);
  else if (u.kind === "replay") await client.request("DELETE", `/v1/replays/${enc(u.id)}/links/${enc(u.token)}`);
  else await client.request("DELETE", `/v1/rooms/mine/${enc(u.id)}`);
}

/* ── library rename, note ─────────────────────────────────────────── */

export async function renameMap(what: string, name: string, o: LibraryDeps = {}): Promise<{ id: string; was: string; name: string }> {
  const { client } = session(o);
  if (!name.trim()) throw new CliError(t("A map needs a name"), null, 2);
  const found = await findInLibrary(what, { ...o, kinds: ["map"] });
  if (found.kind !== "map") throw new CliError(t("Only a map has a name to change"), null, 2);
  const r = await client.request<{ map: MapDetail }>("PATCH", `/v1/maps/${enc(found.map.id)}`, { name: name.trim() });
  return { id: r.map.id, was: found.map.name, name: r.map.name };
}

export async function noteRevision(what: string, note: string, o: LibraryDeps & { revision?: number } = {}): Promise<{ id: string; name: string; revision: number; note: string }> {
  const { client } = session(o);
  const found = await findInLibrary(what, { ...o, kinds: ["map"] });
  if (found.kind !== "map") throw new CliError(t("Only a map's revisions have notes"), null, 2);
  const n = o.revision ?? found.map.head.number;
  if (!found.map.history.some((r) => r.number === n)) throw new CliError(t("{name} has no revision {n}", { name: found.map.name, n }), null, 2);
  const r = await client.request<{ map: MapDetail }>("PATCH", `/v1/maps/${enc(found.map.id)}/revisions/${n}`, { note });
  return { id: r.map.id, name: r.map.name, revision: n, note: r.map.history.find((x) => x.number === n)?.note ?? note };
}

/* ── Asking first ─────────────────────────────────────────────────── */

/**
 * Whether to go ahead with something that cannot be undone: `--yes`, else the person's answer on a terminal; with no
 * terminal to ask on (a script, a pipe), an error that asks for `--yes`.
 */
export async function confirmed(question: string, o: { yes?: boolean; input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; tty?: boolean } = {}): Promise<boolean> {
  if (o.yes) return true;
  const tty = o.tty ?? (!!process.stdin.isTTY && !!process.stdout.isTTY);
  if (!tty) throw new CliError(t("This cannot be undone, and there is no terminal to ask on"), t("Add --yes to go ahead without being asked."), 2);
  const rl = createInterface({ input: o.input ?? process.stdin, output: o.output ?? process.stdout });
  try {
    const answer = await new Promise<string>((done) => rl.question(`${question} ${pc.dim(t("[y/N]"))} `, done));
    return /^(y|yes|예|네|ㅇ)$/i.test(answer.trim());
  } finally { rl.close(); }
}

/* ── The lines ────────────────────────────────────────────────────── */

/** A date as the person's computer has it: 2026-11-14. */
export function day(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const opened = (n: number) => t("{n, plural, =0 {not opened yet} one {opened once} other {opened # times}}", { n });
const revisionWord = (r: number | null | undefined) => (r === null || r === undefined ? t("the newest revision") : t("revision {n}", { n: r }));

/** `scmjs library`: each part with its rows, a row's links under it, the storage at the end. */
export function printLibrary(r: LibraryReport): string[] {
  const lines: string[] = [];
  const pad = (names: string[]) => Math.min(36, Math.max(0, ...names.map(columns)));
  const linkRows = (links: LibraryLink[], what: (l: LibraryLink) => string) => links.map((l) => `    ${pc.cyan(l.url)}${dot}${pc.dim(what(l))}`);
  if (r.maps) {
    lines.push(pc.bold(t("Maps")));
    if (!r.maps.length) lines.push(pc.dim(`  ${t("None yet. scmjs map share <map> puts one on your account with a link.")}`));
    const w = pad(r.maps.map((m) => gameText(m.name)));
    for (const m of r.maps) {
      const facts = [t("{n, plural, one {# revision} other {# revisions}}", { n: m.revisions }), size(m.sizeBytes), m.width && m.height ? `${m.width} × ${m.height}` : "", day(m.updatedAt)].filter(Boolean).join(" · ");
      lines.push(`  ${padColumns(gameText(m.name), w)}  ${facts}  ${pc.dim(shortId(m.id))}`);
      lines.push(...linkRows(m.links, (l) => `${revisionWord(l.revision)}, ${opened(l.opens)}`));
      if (m.shared) lines.push(`    ${pc.cyan(m.shared)}${dot}${pc.dim(t("shared for editing"))}`);
    }
  }
  if (r.replays) {
    if (lines.length) lines.push("");
    lines.push(pc.bold(t("Replays")));
    if (!r.replays.length) lines.push(pc.dim(`  ${t("None yet. scmjs replay share <replay> puts one on your account with a link.")}`));
    const titles = r.replays.map((x) => [gameText(x.mapName) || t("Untitled"), x.matchup].filter(Boolean).join(" · "));
    const w = pad(titles);
    r.replays.forEach((x, i) => {
      const facts = [x.players.map(gameText).join(" vs "), duration(x.durationSec * 1000), size(x.sizeBytes), day(x.playedAt ?? x.uploadedAt)].filter(Boolean).join(" · ");
      lines.push(`  ${padColumns(titles[i], w)}  ${facts}  ${pc.dim(shortId(x.id))}`);
      lines.push(...linkRows(x.links, (l) => opened(l.opens)));
    });
  }
  if (r.shared) {
    if (lines.length) lines.push("");
    lines.push(`${pc.bold(t("Shared for editing"))}${pc.dim(`  ${t("{n} of {limit} at once", { n: r.shared.rooms.length, limit: r.shared.limit })}`)}`);
    if (!r.shared.rooms.length) lines.push(pc.dim(`  ${t("None. scmjs map share <map> --edit makes a link to edit a map together.")}`));
    const w = pad(r.shared.rooms.map((s) => gameText(s.name)));
    for (const s of r.shared.rooms) {
      const state = s.kind === "kept" ? t("kept open {keep}", { keep: keepWords(s.keepDays ?? null) }) : t("open until everyone leaves");
      const people = s.people.length ? t("{n, plural, one {# person} other {# people}} in it", { n: s.people.length }) : t("nobody in it");
      lines.push(`  ${padColumns(gameText(s.name), w)}  ${state} · ${people}`, `    ${pc.cyan(s.url)}`);
    }
  }
  const missing = r.missing.map((p) => (p === "maps" ? t("this server keeps no maps") : p === "replays" ? t("this server keeps no replays") : t("this server shares no maps for editing")));
  if (missing.length) lines.push("", ...missing.map((m) => pc.dim(`  ${m}`)));
  const st = r.storage;
  if (st) {
    lines.push("", `${pc.bold(t("Storage"))}  ${t("{used} of {cap}", { used: size(st.usedBytes), cap: size(st.capBytes) })}${dot}${t("{maps, plural, one {# map} other {# maps}}, {revisions, plural, one {# revision} other {# revisions}}", { maps: st.maps, revisions: st.revisions })}${st.replays !== undefined ? `, ${t("{n, plural, one {# replay} other {# replays}}", { n: st.replays })}` : ""}`);
  }
  return lines;
}

/** `library get`: one line, what came and where it went. */
export function printGot(g: Got, where: string): string[] {
  const what = g.kind === "map" ? `${pc.bold(gameText(g.name))}${g.revision ? `, ${t("revision {n}", { n: g.revision })}` : ""}` : pc.bold(g.name);
  const from = g.from === "link" ? (g.owner ? t("from {owner}'s link", { owner: g.owner }) : t("from the link")) : t("from your account");
  return [`${what}${dot}${from}${dot}${t("written to {where}", { where })}${dot}${size(g.bytes.length)}`];
}

/** What a removal takes with it, in the words the question is asked after. */
export function removalLines(r: Removal): string[] {
  const links = r.links.length;
  if (r.kind === "replay") {
    return [t("Deletes the replay {name} ({size}){links, plural, =0 {.} one { and its link.} other { and its # links.}}", { name: r.name, size: size(r.bytes), links }),
      ...(links ? [t("{links, plural, one {People with that link can no longer watch it.} other {People with those links can no longer watch it.}}", { links })] : [])];
  }
  if (r.kind === "map") {
    return [t("Deletes the map {name}: {revisions, plural, one {its revision} other {its # revisions}} ({size}){links, plural, =0 {} one { and its link} other { and its # links}}.", { name: r.name, revisions: r.revisions ?? 1, size: size(r.bytes), links }),
      ...(links ? [t("{links, plural, one {People with that link can no longer open it.} other {People with those links can no longer open it.}}", { links })] : []),
      ...(r.shared ? [t("It is shared for editing too: that link stops working and anyone in it is sent out.")] : [])];
  }
  return [t("Deletes revision {n} of {name} ({size}){links, plural, =0 {.} one {, and the link to it.} other {, and the # links to it.}}", { n: r.revision!, name: r.name, size: size(r.bytes), links }),
    ...(links ? [t("{links, plural, one {People with that link can no longer open it.} other {People with those links can no longer open it.}}", { links })] : []),
    ...(r.newestAfter ? [t("Links to the newest revision open revision {n} from then on.", { n: r.newestAfter })] : [])];
}

export function unlinkLines(u: Unlinking): string[] {
  if (u.kind === "shared") {
    return [t("Stops sharing {name} for editing: {url} stops working.", { name: u.name, url: u.url }),
      ...(u.people?.length ? [t("{n, plural, one {The person in it is sent out.} other {The # people in it are sent out.}}", { n: u.people.length })] : []),
      u.kept ? t("The map stays on your account as it was last edited.") : t("The map is not kept on your account; save it from the editor first if you want it.")];
  }
  const what = u.kind === "map" ? t("the map {name} ({revision})", { name: u.name, revision: revisionWord(u.revision) }) : t("the replay {name}", { name: u.name });
  return [t("Removes the link {url} to {what}; it was {opened}.", { url: u.url, what, opened: opened(u.opens ?? 0) }),
    u.kind === "map" ? t("People with it can no longer open the map. The map stays on your account.") : t("People with it can no longer watch the replay. The replay stays on your account.")];
}

export const storageLine = (st: StorageView | null): string | null => (st ? pc.dim(`  ${t("Storage: {used} of {cap}", { used: size(st.usedBytes), cap: size(st.capBytes) })}`) : null);
