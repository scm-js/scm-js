/**
 * `scmjs replay sync [folders…] [--watch]`: the player's new replays stored on their scmjs.dev account by themselves.
 *
 * The folders are StarCraft's own when none are named (`usualReplayFolders`): Remastered's under the person's Documents
 * (`StarCraft/Maps/Replays`, with `AutoSave/<yyyymmdd>/<hhmmss>,<map>.rep` beside `LastReplay.rep` and the games saved
 * by name), and a 1.16.1 installation's `maps/replays`. From WSL, the Windows users' Documents under `/mnt/c/Users`,
 * a OneDrive one included. Every `.rep` under them, sub-folders too, is a candidate.
 *
 * What is uploaded: a replay whose bytes the account does not have yet (`GET /v1/replays` lists each one's SHA-256,
 * read once a run; the server's own dedup is the backstop) and that is not older than the start. The start is fixed by
 * the first sync on a server: the moment it ran, unless the person said otherwise (the question on a terminal,
 * `--since`, `--all`), so a first run does not fill the storage with years of games. A small state file beside the
 * session (`replay-sync.json`) keeps that start, what was uploaded by hash, and each file's size, time and hash, so a
 * later run reads only the files that changed. `LastReplay.rep`, which the game writes over every game, is one more
 * file whose hash changes: each game it holds is uploaded once, named after the game (`<date> <time>,<map>.rep`).
 *
 * The replays are stored, not linked: a link is public to whoever has it, and a person's every game linked by itself
 * is not what a sync is for. `--link` asks for one each (with the map's picture for its card, as `replay share`).
 * `replay share` on a stored replay later gives it its link, since the same bytes answer the same replay.
 *
 * `--watch` polls (inotify does not reach Windows' drives from WSL, and a file there is slow to read): each pass
 * looks at the folders' own times and lists only the folders that changed, looks again at the files not yet settled
 * and at each `LastReplay.rep` (written over in place, which does not change its folder), and reads nothing else.
 * A file is taken once its size and time have held for `settleMs`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { detectFormat, parseReplay, type Replay } from "@scm-js/replay";
import { Client, linkTo, requireSession, serverUrl, sessionPath, type StorageView } from "./account";
import { findGameCopy, usualGameFolders } from "./engine";
import { t } from "./i18n";
import { replayPicture } from "./replayshare";
import { CliError, dot, duration, gameText, mark, pc, size, visible } from "./ui";

/** The server's default for one replay (ai-server `maps.maxReplayMb`); a larger file is not sent. */
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;
/** How long a file's size and time must hold before it is read: the game may still be writing it. */
export const SETTLE_MS = 2000;
/** Between two passes of `--watch`. */
export const WATCH_INTERVAL_MS = 5000;
const LAST_REPLAY = /^lastreplay\.rep$/i;

/* ── Where the replays are ─────────────────────────────────────── */

/** A folder's child by name in any case (a 1.16.1 copy may have `maps\replays` or `Maps\Replays`). */
function childAnyCase(dir: string, name: string): string | null {
  let names: string[];
  try { names = readdirSync(dir); } catch { return null; }
  const hit = names.find((n) => n.toLowerCase() === name.toLowerCase());
  return hit ? join(dir, hit) : null;
}

const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** Windows' own profile folders under `C:\Users`, which hold no person's Documents. */
const NOT_PEOPLE = new Set(["all users", "default", "default user", "public", "defaultapppool", "wsiaccount"]);

/** The Documents folders StarCraft: Remastered may keep its replays under, on this system (and the Windows WSL runs in). */
export function documentsFolders(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir(), windowsUsers = "/mnt/c/Users"): string[] {
  const out: string[] = [];
  const oneDrives = (base: string) => {
    let names: string[] = [];
    try { names = readdirSync(base); } catch { /* none */ }
    return names.filter((n) => /^onedrive( - .+)?$/i.test(n)).map((n) => join(base, n, "Documents"));
  };
  if (platform === "win32") {
    const profile = env.USERPROFILE || home;
    out.push(join(profile, "Documents"));
    for (const v of [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial]) if (v) out.push(join(v, "Documents"));
    out.push(...oneDrives(profile));
  } else if (platform === "darwin") {
    out.push(join(home, "Library", "Application Support", "Blizzard"), join(home, "Documents"));
  } else {
    out.push(join(home, "Documents"));
    // Wine keeps a Documents per user under its prefix.
    const wineUsers = join(home, ".wine", "drive_c", "users");
    let users: string[] = [];
    try { users = readdirSync(wineUsers); } catch { /* no Wine */ }
    for (const u of users) out.push(join(wineUsers, u, "Documents"), join(wineUsers, u, "My Documents"));
    // WSL: every Windows user's Documents, OneDrive's too (it often holds Documents).
    let people: string[] = [];
    try { people = readdirSync(windowsUsers); } catch { /* not WSL */ }
    for (const p of people) {
      if (NOT_PEOPLE.has(p.toLowerCase()) || p.includes(".")) continue;
      const profile = join(windowsUsers, p);
      out.push(join(profile, "Documents"), ...oneDrives(profile));
    }
  }
  return [...new Set(out)];
}

/**
 * The replay folders on this computer: `StarCraft/Maps/Replays` under each Documents folder (Remastered; on a Mac
 * under Application Support's `Blizzard`), then each usual installation's `maps/replays` (1.16.1). Only those there.
 */
export function usualReplayFolders(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir(), windowsUsers = "/mnt/c/Users"): string[] {
  const out: string[] = [];
  for (const docs of documentsFolders(env, platform, home, windowsUsers)) {
    const sc = childAnyCase(docs, "StarCraft");
    const maps = sc && childAnyCase(sc, "Maps");
    const replays = maps && childAnyCase(maps, "Replays");
    if (replays && isDir(replays)) out.push(replays);
  }
  for (const game of usualGameFolders(env)) {
    const maps = childAnyCase(game, "maps");
    const replays = maps && childAnyCase(maps, "replays");
    if (replays && isDir(replays)) out.push(replays);
  }
  return [...new Set(out)];
}

/* ── The folders' files ────────────────────────────────────────── */

export interface ReplayFileStat { path: string; size: number; mtimeMs: number }

/**
 * What is in the folders and what has changed in them: a full listing once, then `changed()` looks at each folder's
 * own time, lists again only those that changed (a new file or folder in them), and looks at the files it was told to
 * keep an eye on (`watch`): those not yet settled, and each `LastReplay.rep`.
 */
export class ReplayFolders {
  readonly roots: string[];
  private dirs = new Map<string, number>();
  private files = new Map<string, ReplayFileStat>();
  private watched = new Set<string>();
  constructor(roots: string[]) { this.roots = roots.map((r) => resolve(r)); }

  /** Every `.rep` under the folders, sub-folders too. */
  all(): ReplayFileStat[] {
    this.dirs.clear(); this.files.clear();
    for (const root of this.roots) this.walk(root);
    return [...this.files.values()];
  }

  /** The files new or changed since the last look. */
  changed(): ReplayFileStat[] {
    const out = new Map<string, ReplayFileStat>();
    for (const [dir, was] of this.dirs) {
      let now: number;
      try { now = statSync(dir).mtimeMs; } catch { this.forgetDir(dir); continue; }
      if (now === was) continue;
      for (const f of this.list(dir)) out.set(f.path, f);
    }
    for (const path of [...this.watched, ...[...this.files.keys()].filter((p) => LAST_REPLAY.test(basename(p)))]) {
      const before = this.files.get(path);
      const f = this.stat(path);
      if (!f) { this.files.delete(path); this.watched.delete(path); continue; }
      if (!before || before.size !== f.size || before.mtimeMs !== f.mtimeMs || this.watched.has(path)) out.set(path, f);
    }
    return [...out.values()];
  }

  /** Looked at again on each pass until `unwatch`: a file not yet settled. */
  watch(path: string): void { this.watched.add(path); }
  unwatch(path: string): void { this.watched.delete(path); }

  private stat(path: string): ReplayFileStat | null {
    try {
      const s = statSync(path);
      if (!s.isFile()) return null;
      const f = { path, size: s.size, mtimeMs: s.mtimeMs };
      this.files.set(path, f);
      return f;
    } catch { return null; }
  }

  private forgetDir(dir: string): void {
    for (const d of this.dirs.keys()) if (d === dir || d.startsWith(dir + "/") || d.startsWith(dir + "\\")) this.dirs.delete(d);
    for (const p of this.files.keys()) if (dirname(p) === dir || p.startsWith(dir + "/") || p.startsWith(dir + "\\")) { this.files.delete(p); this.watched.delete(p); }
  }

  /** The folder listed again: its new files looked at, new sub-folders walked, what went forgotten. New or changed files back. */
  private list(dir: string): ReplayFileStat[] {
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { this.forgetDir(dir); return []; }
    try { this.dirs.set(dir, statSync(dir).mtimeMs); } catch { /* gone between the two */ }
    const out: ReplayFileStat[] = [];
    const here = new Set<string>();
    for (const e of entries) {
      const path = join(dir, e.name);
      here.add(path);
      if (e.isDirectory()) { if (!this.dirs.has(path)) out.push(...this.walk(path)); continue; }
      if (!e.isFile() || !/\.rep$/i.test(e.name)) continue;
      const before = this.files.get(path);
      const f = this.stat(path);
      if (f && (!before || before.size !== f.size || before.mtimeMs !== f.mtimeMs)) out.push(f);
    }
    for (const p of this.files.keys()) if (dirname(p) === dir && !here.has(p)) { this.files.delete(p); this.watched.delete(p); }
    for (const d of this.dirs.keys()) if (dirname(d) === dir && !here.has(d)) this.forgetDir(d);
    return out;
  }

  /** A folder new to the listing: listed, and its sub-folders in turn. */
  private walk(dir: string): ReplayFileStat[] { return this.list(dir); }
}

/* ── The state file ────────────────────────────────────────────── */

export interface SyncedReplay { file: string; name: string; at: string; id: string; link?: string }
export interface ServerSyncState {
  /** The first sync's start: replays older than this are left (null: all of them). */
  since: string | null;
  firstSync: string;
  /** By SHA-256: what this command uploaded. */
  uploaded: Record<string, SyncedReplay>;
  /** By SHA-256: the server's refusal of that replay (not sent again). */
  refused?: Record<string, string>;
}
export interface FileMemo { size: number; mtimeMs: number; sha256?: string; skip?: "not-a-replay" | "too-large" }
export interface SyncState { version: 1; servers: Record<string, ServerSyncState>; files: Record<string, FileMemo> }

/** `replay-sync.json` in the session's folder (`~/.config/scmjs`, `%APPDATA%\scmjs`). */
export function syncStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SCMJS_REPLAY_SYNC ? resolve(env.SCMJS_REPLAY_SYNC) : join(dirname(sessionPath(env)), "replay-sync.json");
}

export function readSyncState(path: string): SyncState {
  try {
    const s = JSON.parse(readFileSync(path, "utf8")) as Partial<SyncState>;
    if (s && s.version === 1 && typeof s.servers === "object" && typeof s.files === "object") return { version: 1, servers: s.servers ?? {}, files: s.files ?? {} };
  } catch { /* none yet, or not ours: started again */ }
  return { version: 1, servers: {}, files: {} };
}

/** Written whole (a `.part` and a rename), so a stop part way leaves the last good one. */
export function saveSyncState(state: SyncState, path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(`${path}.part`, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(`${path}.part`, path);
}

/* ── What a replay is, for its line ────────────────────────────── */

const LETTER = ["Z", "T", "P"];
/** `PvT`, as the server writes it: each team's races by initial, teams in order; with no teams, each player one. */
export function matchupOf(players: { race: number; team: number }[]): string {
  const letter = (p: { race: number }) => LETTER[p.race] ?? "?";
  const teams = new Set(players.map((p) => p.team));
  if (teams.size <= 1) return players.map(letter).join("v");
  return [...teams].sort((a, b) => a - b).map((team) => players.filter((p) => p.team === team).map(letter).join("")).join("v");
}

/** The map's name as a file name may hold it: no colour codes, nothing Windows refuses. */
// eslint-disable-next-line no-control-regex -- control bytes are left out of a file name
const UNSAFE = /[<>:"/\\|?*\x00-\x1f]/g;
const fileSafe = (s: string) => visible(gameText(s)).replace(UNSAFE, "").replace(/\s+/g, " ").trim().slice(0, 80);
const two = (n: number) => String(n).padStart(2, "0");

/**
 * The name a replay is kept under: its own, except `LastReplay.rep`, which every game reuses: that one is named as
 * the game's AutoSave copy is, with the date in front (`2026-11-16 211503,(2)Destination.rep`), by when it was saved.
 */
export function uploadName(path: string, rep: Replay, mtimeMs: number): string {
  const name = basename(path);
  if (!LAST_REPLAY.test(name)) return name;
  const d = new Date(mtimeMs);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())},${fileSafe(rep.header.mapName) || "replay"}.rep`;
}

/* ── The sync ──────────────────────────────────────────────────── */

export interface SyncUpload {
  file: string;
  /** The name it is kept under on the account. */
  name: string;
  sha256: string;
  bytes: number;
  mapName: string;
  matchup: string;
  players: string[];
  durationSec: number;
  /** With `--link`: the link to watch it. */
  link: string | null;
  /** The server had it already (another file with the same bytes, uploaded meanwhile). */
  existing: boolean;
  /** `--dry-run`: what would go up; nothing was sent. */
  dryRun?: boolean;
}

export interface SyncReport {
  server: string;
  folders: string[];
  /** The start this run went by: replays older are left. Null: every replay. */
  since: string | null;
  /** The first sync on this server: the start was fixed now. */
  firstRun: boolean;
  uploaded: SyncUpload[];
  /** Replays the account has already. */
  already: number;
  /** Replays older than the start, and their size. */
  older: { count: number; bytes: number };
  /** Files that are not replays, larger than the server takes, or refused by it, with why. */
  skipped: { file: string; why: string }[];
  /** Files still being written when the run ended: the next one takes them. */
  unsettled: number;
  storage?: StorageView;
  /** Why the run stopped before it was through: the server's refusal (storage full, too many replays), or a stop. */
  stopped?: { message: string; hint?: string; exitCode: number } | { signal: true };
}

export interface SyncOptions {
  /** Replays from this time on (ms since the epoch), for this run. */
  since?: number;
  /** Every replay, whatever its age, for this run. */
  all?: boolean;
  dryRun?: boolean;
  /** A link for each upload, and the map's picture for its card unless `picture` is false. */
  link?: boolean;
  picture?: boolean;
  starcraft?: string;
}

export interface SyncDeps {
  server?: string;
  /** The session file. */
  file?: string;
  /** The state file. */
  stateFile?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  settleMs?: number;
  /** The first run, on a terminal: replays older than now were found; true uploads them too. */
  ask?: (older: { count: number; bytes: number }) => Promise<boolean>;
  /** Each upload as it is made (or would be, with `dryRun`). */
  onUpload?: (u: SyncUpload) => void;
  /** Said along the way (a server that could not be reached, while watching). */
  onNote?: (line: string) => void;
  /** Ends the run between two files (Ctrl+C). */
  signal?: AbortSignal;
}

interface Refusal { code?: string; message?: string }

/** One run's work: the session, the state, what the account has; `pass` takes a list of files through it. */
class Sync {
  readonly server: string;
  readonly report: SyncReport;
  /** Watching: a server that cannot be reached is tried again on the next pass, not the end of the run. */
  watching = false;
  private readonly client: Client;
  private readonly state: SyncState;
  private readonly stateFile: string;
  private readonly mine: ServerSyncState;
  private readonly known = new Set<string>();
  private readonly cutoff: number | null;
  private readonly deps: SyncDeps;
  private readonly o: SyncOptions;
  private readonly now: () => number;
  private readonly settleMs: number;
  private refusal: Refusal | null = null;
  private unreachable = false;

  private constructor(p: { server: string; client: Client; state: SyncState; stateFile: string; mine: ServerSyncState; cutoff: number | null; report: SyncReport; deps: SyncDeps; o: SyncOptions }) {
    this.server = p.server; this.client = p.client; this.state = p.state; this.stateFile = p.stateFile; this.mine = p.mine; this.cutoff = p.cutoff; this.report = p.report;
    this.deps = p.deps; this.o = p.o;
    this.now = p.deps.now ?? Date.now;
    this.settleMs = p.deps.settleMs ?? SETTLE_MS;
  }

  /** The session, what the account has (`GET /v1/replays`), and the start: the state's, or fixed now on a first run. */
  static async open(folders: string[], files: ReplayFileStat[], o: SyncOptions, deps: SyncDeps): Promise<Sync> {
    const server = (deps.server ?? serverUrl()).replace(/\/+$/, "");
    const session = requireSession(server, deps.file ?? sessionPath());
    // The server's refusal in its own code, beside the message the client throws, and whether it could be reached at all.
    let self: Sync | null = null;
    const base = deps.fetchImpl ?? fetch;
    const fetchImpl: typeof fetch = async (input, init) => {
      let res: Response;
      try { res = await base(input, init); } catch (e) { if (self) self.unreachable = true; throw e; }
      if (!res.ok && self) self.refusal = ((await res.clone().json().catch(() => null)) as { error?: Refusal } | null)?.error ?? {};
      return res;
    };
    const client = new Client({ server, session: session.session, fetchImpl });
    const listed = await client.request<{ replays: { sha256?: string }[]; storage?: StorageView } | null>("GET", "/v1/replays", undefined, { missingOk: true });
    if (!listed) throw new CliError(t("{server} keeps no replays", { server }), t("SCMJS_SERVER names the server."));
    const stateFile = deps.stateFile ?? syncStatePath();
    const state = readSyncState(stateFile);
    const now = (deps.now ?? Date.now)();
    const had = state.servers[server];
    const firstRun = !had;
    let since: number | null;
    if (o.all) since = null;
    else if (o.since !== undefined) since = o.since;
    else if (had) since = had.since === null ? null : Date.parse(had.since);
    else {
      // The first sync: what is there already stays, unless the person, asked on a terminal, says to take it too.
      since = now;
      const older = countOlder(files, now);
      if (older.count && deps.ask && await deps.ask(older)) since = null;
    }
    const mine: ServerSyncState = had ?? { since: since === null ? null : new Date(since).toISOString(), firstSync: new Date(now).toISOString(), uploaded: {} };
    const report: SyncReport = { server, folders, since: since === null ? null : new Date(since).toISOString(), firstRun, uploaded: [], already: 0, older: { count: 0, bytes: 0 }, skipped: [], unsettled: 0, ...(listed.storage ? { storage: listed.storage } : {}) };
    const sync = new Sync({ server, client, state, stateFile, mine, cutoff: since, report, deps, o });
    self = sync;
    for (const r of listed.replays) if (r.sha256) sync.known.add(r.sha256);
    for (const sha of Object.keys(mine.uploaded)) sync.known.add(sha);
    if (firstRun && !o.dryRun) { state.servers[server] = mine; sync.save(); }
    return sync;
  }

  private save(): void { if (!this.o.dryRun) saveSyncState(this.state, this.stateFile); }

  /** When each file not yet settled was first seen as it is now. */
  private readonly seenAt = new Map<string, { size: number; mtimeMs: number; at: number }>();

  /**
   * True when the file has not changed for `settleMs`, by its time or by what was seen of it: the game is done writing
   * it. (Seen, for a time ahead of this clock: Windows' and WSL's may differ a little.)
   */
  settled(f: ReplayFileStat): boolean {
    const now = this.now();
    if (now - f.mtimeMs >= this.settleMs) return true;
    const seen = this.seenAt.get(f.path);
    if (seen && seen.size === f.size && seen.mtimeMs === f.mtimeMs) return now - seen.at >= this.settleMs;
    this.seenAt.set(f.path, { size: f.size, mtimeMs: f.mtimeMs, at: now });
    return false;
  }

  /**
   * The files, oldest first (each `LastReplay.rep` after the others, so a game the game also saved under AutoSave goes
   * up under that name). Answers the paths not yet settled, to look at again.
   */
  async pass(files: ReplayFileStat[], { counting = true } = {}): Promise<{ unsettled: string[] }> {
    const unsettled: string[] = [];
    const order = [...files].sort((a, b) => Number(LAST_REPLAY.test(basename(a.path))) - Number(LAST_REPLAY.test(basename(b.path))) || a.mtimeMs - b.mtimeMs);
    for (const f of order) {
      if (this.deps.signal?.aborted || this.report.stopped) break;
      if (this.cutoff !== null && f.mtimeMs < this.cutoff) {
        // (Known from an earlier run: on the account already, or not a replay. Nothing is read to tell.)
        const memo = this.state.files[f.path];
        const same = memo && memo.size === f.size && memo.mtimeMs === f.mtimeMs;
        if (!counting || (same && memo.skip)) continue;
        if (same && memo.sha256 && this.known.has(memo.sha256)) this.report.already++;
        else { this.report.older.count++; this.report.older.bytes += f.size; }
        continue;
      }
      if (!this.settled(f)) { unsettled.push(f.path); continue; }
      await this.take(f, unsettled);
    }
    return { unsettled };
  }

  private skip(file: string, why: string): void { this.report.skipped.push({ file, why }); }

  private async take(f: ReplayFileStat, unsettled: string[]): Promise<void> {
    const memo = this.state.files[f.path];
    const same = memo && memo.size === f.size && memo.mtimeMs === f.mtimeMs;
    if (same && memo.skip) return this.skip(f.path, memo.skip === "too-large" ? t("larger than the server takes ({size})", { size: size(MAX_REPLAY_BYTES) }) : t("not a replay"));
    if (same && memo.sha256 && this.known.has(memo.sha256)) { this.report.already++; return; }
    if (same && memo.sha256 && this.mine.refused?.[memo.sha256]) return this.skip(f.path, this.mine.refused[memo.sha256]);
    if (f.size > MAX_REPLAY_BYTES) {
      this.state.files[f.path] = { size: f.size, mtimeMs: f.mtimeMs, skip: "too-large" }; this.save();
      return this.skip(f.path, t("larger than the server takes ({size})", { size: size(MAX_REPLAY_BYTES) }));
    }
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(readFileSync(f.path)); } catch { unsettled.push(f.path); return; }
    // Changed while it was read: the game is still at it.
    try { const s = statSync(f.path); if (s.size !== f.size || s.mtimeMs !== f.mtimeMs) { unsettled.push(f.path); return; } } catch { return; }
    let rep: Replay | null = null;
    if (detectFormat(bytes)) { try { rep = await parseReplay(bytes); } catch { rep = null; } }
    if (!rep) {
      this.state.files[f.path] = { size: f.size, mtimeMs: f.mtimeMs, skip: "not-a-replay" }; this.save();
      return this.skip(f.path, t("not a replay"));
    }
    const sha = createHash("sha256").update(bytes).digest("hex");
    this.state.files[f.path] = { size: f.size, mtimeMs: f.mtimeMs, sha256: sha };
    if (this.known.has(sha)) { this.report.already++; this.save(); return; }
    if (this.mine.refused?.[sha]) { this.save(); return this.skip(f.path, this.mine.refused[sha]); }
    const name = uploadName(f.path, rep, f.mtimeMs);
    const facts = { mapName: visible(gameText(rep.header.mapName)), matchup: matchupOf(rep.players), players: rep.players.map((p) => visible(gameText(p.name))), durationSec: Math.round(rep.header.frames * 42 / 1000) };
    if (this.o.dryRun) {
      this.known.add(sha);
      const u: SyncUpload = { file: f.path, name, sha256: sha, bytes: bytes.length, ...facts, link: null, existing: false, dryRun: true };
      this.report.uploaded.push(u); this.deps.onUpload?.(u);
      return;
    }
    const r = await this.upload(bytes, name, rep);
    if (r === "retry") { unsettled.push(f.path); return; }
    if (r === "stop") return;
    if ("refused" in r) {
      (this.mine.refused ??= {})[sha] = r.refused; this.save();
      return this.skip(f.path, r.refused);
    }
    this.known.add(sha);
    const link = r.token ? linkTo("replay", r.token, this.server) : null;
    this.mine.uploaded[sha] = { file: f.path, name, at: new Date(this.now()).toISOString(), id: r.id, ...(link ? { link } : {}) };
    this.state.servers[this.server] = this.mine;
    this.save();
    if (r.storage) this.report.storage = r.storage;
    const u: SyncUpload = { file: f.path, name, sha256: sha, bytes: bytes.length, ...facts, link, existing: r.existing };
    this.report.uploaded.push(u); this.deps.onUpload?.(u);
  }

  /**
   * One `POST /v1/replays`. A refusal of this replay (not a replay to the server, too large) skips it; the account's
   * limits (storage full, too many replays) and a session gone stop the run; a server that cannot be reached is tried
   * again on the next pass when watching, else stops the run.
   */
  private async upload(bytes: Uint8Array, name: string, rep: Replay): Promise<{ id: string; existing: boolean; token?: string; storage?: StorageView } | { refused: string } | "retry" | "stop"> {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart], { type: "application/octet-stream" }), name);
    form.append("fileName", name);
    if (this.o.link) {
      form.append("link", "1");
      if (this.o.picture !== false) {
        const pic = await replayPicture(rep, this.o.starcraft);
        if (pic.picture) form.append("picture", new Blob([pic.picture as BlobPart], { type: "image/png" }), "picture.png");
      }
    }
    this.refusal = null; this.unreachable = false;
    // (Set by the fetch beside the client, which TypeScript does not see from here.)
    const answered = () => ({ refusal: this.refusal as Refusal | null, unreachable: this.unreachable as boolean });
    try {
      const r = await this.client.request<{ replay: { id: string; links?: { token: string }[] }; storage?: StorageView; link?: { token: string }; existing?: boolean }>("POST", "/v1/replays", form, { timeoutMs: 120_000 });
      return { id: r.replay.id, existing: !!r.existing, token: this.o.link ? r.link?.token ?? r.replay.links?.[0]?.token : undefined, storage: r.storage };
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      const { refusal, unreachable } = answered();
      if (unreachable && this.watching) { this.deps.onNote?.(`${mark.warn} ${e.message} ${pc.dim(t("(trying again on the next pass)"))}`); return "retry"; }
      const code = refusal?.code;
      const message = refusal?.message ?? e.message;
      if (code === "invalid_input" && !/at most \d+ replays/i.test(message)) return { refused: message };
      this.report.stopped = { message: e.message, ...(e.hint ? { hint: e.hint } : code === "storage_full" || code === "invalid_input" ? { hint: t("Delete replays or map revisions in the editor's My Maps, then run scmjs replay sync again.") } : {}), exitCode: e.exitCode };
      return "stop";
    }
  }
}

/** The files older than `since`, and their size. */
function countOlder(files: ReplayFileStat[], since: number): { count: number; bytes: number } {
  let count = 0, bytes = 0;
  for (const f of files) if (f.mtimeMs < since) { count++; bytes += f.size; }
  return { count, bytes };
}

/** The folders named, or found; none is an error with where it looked. */
export function syncFolders(named: readonly string[] = []): string[] {
  if (named.length) {
    for (const f of named) if (!isDir(f)) throw new CliError(t("{folder} is not a folder", { folder: f }), t("Name the folders that hold your replays, or none for StarCraft's own."), 2);
    return named.map((f) => resolve(f));
  }
  const found = usualReplayFolders();
  if (!found.length) throw new CliError(t("No StarCraft replay folder was found on this computer"), t("Remastered keeps replays in Documents\\StarCraft\\Maps\\Replays, StarCraft 1.16.1 in its maps\\replays folder: name yours, as in scmjs replay sync <folder>."), 2);
  return found;
}

/** Waits for `ms`, or less when the run is stopped. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((done) => {
    if (signal?.aborted) return done();
    const timer = setTimeout(finish, ms);
    function finish() { clearTimeout(timer); signal?.removeEventListener("abort", finish); done(); }
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * One sync: every replay in the folders not on the account yet and not older than the start, uploaded. A file still
 * being written is waited for once, `settleMs`; one still changing after that is left for the next run.
 */
export async function syncReplays(folders: string[], o: SyncOptions = {}, deps: SyncDeps = {}): Promise<SyncReport> {
  const scan = new ReplayFolders(folders);
  const files = scan.all();
  const sync = await Sync.open(scan.roots, files, o, deps);
  let { unsettled } = await sync.pass(files);
  if (unsettled.length && !deps.signal?.aborted && !sync.report.stopped) {
    await pause(deps.settleMs ?? SETTLE_MS, deps.signal);
    const again = unsettled.map((p) => { try { const s = statSync(p); return { path: p, size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; } }).filter((f): f is ReplayFileStat => !!f);
    ({ unsettled } = await sync.pass(again, { counting: false }));
  }
  sync.report.unsettled = unsettled.length;
  if (deps.signal?.aborted && !sync.report.stopped) sync.report.stopped = { signal: true };
  return sync.report;
}

export interface WatchDeps extends SyncDeps {
  intervalMs?: number;
  /** Told once the first sync is through and the watch has begun. */
  onWatching?: (report: SyncReport) => void;
}

/**
 * `--watch`: the sync, then a pass every `intervalMs` over what changed, until `signal` (Ctrl+C) or the server's
 * refusal stops it. The report is the whole run's.
 */
export async function watchReplays(folders: string[], o: SyncOptions = {}, deps: WatchDeps = {}): Promise<SyncReport> {
  const scan = new ReplayFolders(folders);
  const files = scan.all();
  const sync = await Sync.open(scan.roots, files, o, deps);
  sync.watching = true;
  const look = (unsettled: string[]) => { for (const p of unsettled) scan.watch(p); };
  look((await sync.pass(files)).unsettled);
  deps.onWatching?.(sync.report);
  while (!deps.signal?.aborted && !sync.report.stopped) {
    await pause(deps.intervalMs ?? WATCH_INTERVAL_MS, deps.signal);
    if (deps.signal?.aborted) break;
    const changed = scan.changed();
    if (!changed.length) continue;
    for (const f of changed) scan.unwatch(f.path);
    look((await sync.pass(changed, { counting: false })).unsettled);
  }
  if (deps.signal?.aborted && !sync.report.stopped) sync.report.stopped = { signal: true };
  return sync.report;
}

/* ── What is printed ───────────────────────────────────────────── */

/** `✔ 211503,(2)Destination.rep · (2)Destination · PvT · Ann vs Bob · 12:04 · stored` (the link in place of "stored" with `--link`). */
export function printSyncUpload(u: SyncUpload): string {
  // (Past four players the matchup says enough: eight names do not fit a line.)
  const players = u.players.length <= 4 ? u.players.join(" vs ") : "";
  const end = u.dryRun ? pc.dim(t("would upload")) : u.link ? pc.cyan(u.link) : u.existing ? pc.dim(t("already on your account")) : pc.dim(t("stored"));
  return `${u.dryRun ? mark.info : mark.ok} ${[pc.bold(u.name), u.mapName || t("Untitled"), [u.matchup, players].filter(Boolean).join(" "), duration(u.durationSec * 1000)].join(dot)}${dot}${end}`;
}

/** The run in a few lines: what went up, what was there, what was left and why. */
export function printSyncSummary(r: SyncReport, o: { watch?: boolean; dryRun?: boolean } = {}): string[] {
  const n = r.uploaded.length, bytes = r.uploaded.reduce((s, u) => s + u.bytes, 0);
  const lines: string[] = [];
  const head = o.dryRun
    ? n ? t("{n, plural, one {# replay} other {# replays}} ({size}) would be uploaded", { n, size: size(bytes) }) : t("Nothing new to upload")
    : n ? t("Uploaded {n, plural, one {# replay} other {# replays}} ({size})", { n, size: size(bytes) }) : t("Nothing new to upload");
  const parts = [r.already ? t("{n} already on your account", { n: r.already }) : null,
    r.skipped.length ? t("{n} skipped", { n: r.skipped.length }) : null,
    r.unsettled ? t("{n} still being written", { n: r.unsettled }) : null].filter(Boolean);
  lines.push(`${n ? mark.ok : mark.info} ${head}${parts.length ? pc.dim(` · ${parts.join(", ")}`) : ""}`);
  for (const s of r.skipped.slice(0, 5)) lines.push(pc.dim(`  ${basename(s.file)}: ${s.why}`));
  if (r.skipped.length > 5) lines.push(pc.dim(`  ${t("and {n} more", { n: r.skipped.length - 5 })}`));
  if (r.older.count) {
    const d = r.since ? new Date(r.since) : null;
    const when = d ? `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` : "";
    lines.push(pc.dim(`${t("{n, plural, one {# replay} other {# replays}} ({size}) from before {date} left as they are: --since <date> or --all uploads them.", { n: r.older.count, size: size(r.older.bytes), date: when })}`));
  }
  if (r.storage && !o.dryRun) lines.push(pc.dim(t("Storage: {used} of {cap}", { used: size(r.storage.usedBytes), cap: size(r.storage.capBytes) })));
  return lines;
}

/** The folders, said before the run on standard error. */
export function printSyncFolders(folders: string[], home = homedir()): string {
  const short = folders.map((f) => (f.startsWith(home) ? `~${f.slice(home.length)}` : f));
  return pc.dim(t("Replays in {folders}", { folders: short.join(", ") }));
}

/**
 * `--since`: a date (`2026-11-01`, midnight where you are), a date and time (`2026-11-01T18:00`), or days back from
 * now (`7d`). Ms since the epoch.
 */
export function parseSince(value: string, now = Date.now()): number {
  const v = value.trim();
  const days = /^(\d+)\s*d$/i.exec(v);
  if (days) return now - Number(days[1]) * 86_400_000;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const ms = date ? new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3])).getTime() : /^\d{4}-\d{2}-\d{2}[T ]/.test(v) ? Date.parse(v) : NaN;
  if (Number.isNaN(ms)) throw new CliError(t("--since takes a date (2026-11-01) or a number of days (7d), not \"{value}\"", { value }), null, 2);
  return ms;
}

/* ── The command ───────────────────────────────────────────────── */

export interface ReplaySyncCommandOptions { watch?: boolean; since?: string; all?: boolean; dryRun?: boolean; link?: boolean; picture?: boolean; starcraft?: string; json?: boolean }

/** The first run's question, on a terminal: the replays there already, uploaded too? No unless the person says yes. */
async function askOlder(older: { count: number; bytes: number }): Promise<boolean> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  rl.on("SIGINT", () => { rl.close(); process.stderr.write("\n"); process.exit(130); });
  try {
    process.stderr.write(`${mark.info} ${t("This is your first replay sync. {n, plural, one {# replay} other {# replays}} ({size}) are in these folders already.", { n: older.count, size: size(older.bytes) })}\n`);
    const answer = await rl.question(`  ${t("Upload those too? Otherwise only games saved from now on go up. [y/N] ")}`);
    return /^\s*(y|yes|예|네|ㅇ)\s*$/i.test(answer);
  } finally { rl.close(); }
}

/** `scmjs replay sync`: the run, its lines as they come, the summary, Ctrl+C a clean end. */
export async function replaySyncCommand(named: string[], o: ReplaySyncCommandOptions): Promise<void> {
  if (o.all && o.since) throw new CliError(t("--all and --since both say where to start: use one"), null, 2);
  if (o.picture === false && !o.link) throw new CliError(t("--no-picture is for the link's card: use it with --link"), null, 2);
  const since = o.since ? parseSince(o.since) : undefined;
  // (A folder that is not a copy of the game is said now, not at the first upload.)
  if (o.link && o.starcraft) findGameCopy(o.starcraft, { pictures: true });
  const folders = syncFolders(named);
  if (!o.json) process.stderr.write(`${printSyncFolders(folders)}\n`);
  const stop = new AbortController();
  const onSignal = () => stop.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const out = (line: string) => process.stdout.write(`${line}\n`);
  const tty = !!process.stdin.isTTY && !!process.stderr.isTTY && !o.json && !o.dryRun;
  const deps: WatchDeps = {
    signal: stop.signal,
    ask: tty && since === undefined && !o.all ? askOlder : undefined,
    // (With --json, one object at the end; with --watch too, a line for each upload as it is made.)
    onUpload: o.json && !o.watch ? undefined : (u) => out(o.json ? JSON.stringify({ type: "upload", ...u }) : printSyncUpload(u)),
    onNote: (line) => process.stderr.write(`${line}\n`),
    onWatching: (r) => {
      if (o.json) return;
      if (r.older.count || r.skipped.length) for (const l of printSyncSummary(r).slice(1)) process.stderr.write(`${l}\n`);
      process.stderr.write(`${mark.info} ${t("Watching for new games. Ctrl+C stops.")}\n`);
    },
  };
  const options: SyncOptions = { since, all: o.all, dryRun: o.dryRun, link: o.link, picture: o.picture, starcraft: o.starcraft };
  let report: SyncReport;
  try {
    report = o.watch ? await watchReplays(folders, options, deps) : await syncReplays(folders, options, deps);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
  if (o.json) out(JSON.stringify(o.watch ? { type: "summary", ...report, uploaded: report.uploaded.length } : report, null, o.watch ? undefined : 2));
  else {
    // (After the ^C the terminal shows.)
    if (o.watch && process.stderr.isTTY) process.stderr.write("\n");
    for (const l of printSyncSummary(report, { dryRun: o.dryRun })) out(l);
  }
  const s = report.stopped;
  if (s && "message" in s) throw new CliError(s.message, s.hint ?? null, s.exitCode);
  // Ctrl+C ends a watch as it is meant to end; a sync cut short ends as a stopped command does.
  if (s && !o.watch) process.exitCode = 130;
}
