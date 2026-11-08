/**
 * `scmjs replay export`: a replay as a video or a GIF, drawn with the game's own pictures, for sharing where nobody
 * has the game. The play page's replay viewer (scm-sim `web/viewer.ts`, `?view`) does the drawing: this serves the
 * page on this machine's loopback address — its files from the play page's address, kept in the cache as the engine
 * is, and the game's files from the person's own copy of StarCraft — opens it headless in a browser already on the
 * computer (driven over the DevTools protocol, `browser.ts`), hands it the replay as Aftermath does, and asks it to
 * record (`scmjs.view.record`). The page steps the game picture by picture and encodes each with the browser's own
 * video encoder, so the clip has every picture at the speed asked, made as fast as the computer goes. It sends back a
 * WebM file; an MP4 is made from that by ffmpeg when it is installed. A GIF is made here from the pictures as the
 * page draws them (`gif.ts`), which comes out smaller and truer than ffmpeg's from the encoded clip.
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { FRAME_MS, type Replay, type ReplayPlayer } from "@scm-js/replay";
import { parseScenario } from "../../src/formats/chk/scenario";
import { START_LOCATION } from "../../src/data/units";
import { findBrowser, launchBrowser, NO_BROWSER, type Launched } from "./browser";
import { actionTrack, followTrack, type Sample, type Track } from "./camera";
import { cacheRoot, ensureEngine, findGameCopy, PLAY_URL, runnerFor, startRunner } from "./engine";
import type { Input } from "./files";
import { openGameFiles, type GameFiles } from "./gamefiles";
import { GifWriter } from "./gif";
import { parseClock } from "./watch";
import { t, translate } from "./i18n";
import { CliError, duration, mark, num, pc, size } from "./ui";

export type ClipFormat = "webm" | "mp4" | "gif";

/** What the command was asked, as typed. */
export interface ExportOptions {
  out?: string;
  from?: string;
  to?: string;
  follow?: string;
  at?: string;
  all?: boolean;
  speed?: string;
  size?: string;
  fps?: string;
  json?: boolean;
  starcraft?: string;
  browser?: string;
  play?: string;
}

/** The clip as settled from the options and the replay. */
export interface ClipPlan {
  out: string;
  format: ClipFormat;
  width: number;
  height: number;
  fps: number;
  speed: number;
  /** Game frames. */
  from: number;
  to: number;
  pictures: number;
  /** Map pixels top to bottom. */
  rows: number;
  camera: Camera;
}

export type Camera = { kind: "follow"; player: ReplayPlayer } | { kind: "at"; x: number; y: number } | { kind: "all" };

/** The defaults: a video at 720p and the game's pace, a GIF smaller and slower (GIF's delays are in hundredths). */
const DEFAULTS = { video: { width: 1280, height: 720, fps: 24 }, gif: { width: 640, height: 360, fps: 12 } };

/** The kind of file `out` names, by its extension. */
export function clipFormat(out: string): ClipFormat {
  const ext = extname(out).toLowerCase();
  if (ext === ".webm") return "webm";
  if (ext === ".mp4" || ext === ".m4v") return "mp4";
  if (ext === ".gif") return "gif";
  throw new CliError(ext ? t("--out names a {ext} file; a clip is .webm, .mp4 or .gif", { ext }) : t("--out names a nameless file; a clip is .webm, .mp4 or .gif"), null, 2);
}

/** `WxH`, each even (video encoders work in pairs of pixels). */
export function parseSize(spec: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/i.exec(spec.trim());
  const width = m ? Number(m[1]) : NaN, height = m ? Number(m[2]) : NaN;
  if (!m || width < 64 || height < 64 || width > 3840 || height > 2160) throw new CliError(t("--size takes WxH in pixels, from 64x64 to 3840x2160, not \"{spec}\"", { spec }), null, 2);
  return { width: Math.round(width / 2) * 2, height: Math.round(height / 2) * 2 };
}

/** Pictures a second; a GIF's is what its hundredths of a second allow (12 → 12.5, a picture every 8). */
export function parseFps(spec: string, format: ClipFormat): number {
  const fps = Number(spec);
  if (!(fps >= 1 && fps <= 60)) throw new CliError(t("--fps takes a number from 1 to 60, not \"{spec}\"", { spec }), null, 2);
  return format === "gif" ? 100 / Math.max(2, Math.round(100 / fps)) : fps;
}

export function parseSpeed(spec: string): number {
  const speed = Number(spec);
  if (!(speed >= 0.25 && speed <= 64)) throw new CliError(t("--speed takes a number from 0.25 to 64, not \"{spec}\"", { spec }), null, 2);
  return speed;
}

/** `x,y` in tiles: the middle of the view on that tile. */
export function parseAt(spec: string, map: { width: number; height: number }): { x: number; y: number } {
  const m = /^\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*$/.exec(spec);
  if (!m) throw new CliError(t("--at takes x,y in tiles, not \"{spec}\"", { spec }), null, 2);
  const x = Number(m[1]), y = Number(m[2]);
  if (x >= map.width || y >= map.height) throw new CliError(t("--at {spec} is off the map, which is {width} × {height} tiles", { spec, width: map.width, height: map.height }), null, 2);
  return { x: x * 32 + 16, y: y * 32 + 16 };
}

/** The player `who` names: a number as `replay info` lists them (from 1), or a name, whole or the start of one. */
export function pickPlayer(players: readonly ReplayPlayer[], who: string | undefined): ReplayPlayer {
  const humans = players.filter((p) => p.type === 2);
  if (who === undefined) {
    const first = humans[0] ?? players[0];
    if (!first) throw new CliError(t("The replay names no players to follow."), t("Use --at x,y or --all."), 2);
    return first;
  }
  const n = Number(who);
  if (/^\d+$/.test(who.trim()) && n >= 1 && n <= players.length) return players[n - 1];
  const name = who.trim().toLowerCase();
  const exact = players.filter((p) => p.name.toLowerCase() === name);
  const start = players.filter((p) => p.name.toLowerCase().startsWith(name));
  const found = exact.length === 1 ? exact : start.length === 1 ? start : [];
  if (found.length) return found[0];
  const list = players.map((p, i) => `${i + 1} ${p.name}`).join(", ");
  throw new CliError(start.length > 1 ? t("--follow {who} is more than one player", { who }) : t("--follow {who} is nobody in this replay", { who }), t("The players: {list}.", { list }), 2);
}

/**
 * How much of the map the clip shows top to bottom: the game's own screen (480 rows) drawn at a whole number of
 * pixels a map pixel, so the game's pictures stay sharp — 360 rows at 720p (two pixels to one), 540 at 1080p.
 */
export function rowsFor(height: number): number {
  return height / Math.max(1, Math.round(height / 480));
}

/** The clip from the options and the replay; nothing is looked for on the computer yet. */
export function planClip(input: Input, rep: Replay, o: ExportOptions, map: { width: number; height: number }): ClipPlan {
  const out = resolve(o.out ?? join(input.path === "-" ? "." : dirname(input.path), `${basename(input.name, extname(input.name)) || "replay"}.webm`));
  const format = clipFormat(out);
  const d = format === "gif" ? DEFAULTS.gif : DEFAULTS.video;
  const { width, height } = o.size ? parseSize(o.size) : d;
  const fps = parseFps(o.fps ?? String(d.fps), format);
  const speed = parseSpeed(o.speed ?? "1");
  const frames = Math.max(rep.header.frames, rep.commands.at(-1)?.frame ?? 0);
  const from = o.from ? parseClock(o.from, "--from") : 0;
  const to = o.to ? Math.min(frames, parseClock(o.to, "--to")) : frames;
  if (from >= frames) throw new CliError(t("--from {from} is past the replay's end ({end})", { from: String(o.from), end: duration(frames * FRAME_MS) }), null, 2);
  if (to <= from) throw new CliError(t("--to {to} is not after --from {from}", { to: String(o.to), from: o.from ?? "0:00" }), null, 2);
  const chosen = [o.follow !== undefined, o.at !== undefined, !!o.all].filter(Boolean).length;
  if (chosen > 1) throw new CliError(t("--follow, --at and --all each place the camera: give one"), null, 2);
  const camera: Camera = o.all ? { kind: "all" } : o.at !== undefined ? { kind: "at", ...parseAt(o.at, map) } : { kind: "follow", player: pickPlayer(rep.players, o.follow) };
  const pictures = Math.max(1, Math.floor(((to - from) * FRAME_MS * fps) / (1000 * speed)) + 1);
  return { out, format, width, height, fps, speed, from, to, pictures, rows: rowsFor(height), camera };
}

/** ffmpeg: `SCMJS_FFMPEG`, else on the PATH; its version line, or null when there is none. */
export function findFfmpeg(): { path: string; version: string } | null {
  const path = process.env.SCMJS_FFMPEG || "ffmpeg";
  const r = spawnSync(path, ["-version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (r.status !== 0 || !r.stdout) return null;
  const m = /ffmpeg version (\S+)/.exec(r.stdout);
  return { path, version: m ? m[1] : "found" };
}

/* ── The page's server ──────────────────────────────────────── */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".bin": "application/octet-stream",
};
const typeOf = (path: string) => TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

/**
 * Where a file of the play page is kept: the engine's files beside the other commands' copy (`engine/<build>/`), the
 * page's own under `page/<host>/`. Null for what is asked again each time (the page itself, `current.json`).
 */
export function pageCachePath(path: string, prefix: string, host: string, cache = cacheRoot()): string | null {
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  if (rest.split("/").some((p) => p === ".." || p === "")) return null;
  const engine = /^engine\/([0-9a-z]+)\/([^/]+)$/i.exec(rest);
  if (engine) return join(cache, "engine", engine[1], engine[2]);
  if (/^(assets|bots)\//.test(rest)) return join(cache, "page", host.replace(/[^a-z0-9.-]/gi, "_"), rest);
  return null;
}

/** The game's files a page may ask for: the classic ones (Remastered's pictures are the editor's to make, not served). */
export function servedGamePath(path: string): string | null {
  const p = path.toLowerCase();
  if (!/^[a-z0-9_ .\-/]+$/.test(p) || p.split("/").some((s) => s === ".." || s === "." || s === "")) return null;
  if (/^(hd2?|anim|sd|carbot)\//.test(p) || p.includes("/hd/") || /\.hd\./.test(p) || /\.dds(\.grp)?$/.test(p)) return null;
  return p.replaceAll("/", "\\");
}

/** What the page that frames the viewer tells the command (`/message`). */
interface HostNews { type: string; message?: string; done?: number; pictures?: number; frame?: number; ms?: number; frames?: number; mime?: string }

/** The job the framing page reads first (`/job`). */
export interface Job {
  name: string;
  page: string;
  width: number;
  height: number;
  record: Record<string, unknown>;
}
/** The camera's track as JSON (`/track`); the framing page makes the viewer's typed arrays of it. */
export interface JobTrack { every: number; x: number[]; y: number[]; cut: number[] }

/** The page that frames the viewer: hands it the replay, the camera and the recording, and passes everything back. */
export function hostPage(): string {
  return `<!doctype html><meta charset="utf-8"><title>scmjs replay export</title>
<style>html,body{margin:0;background:#000;overflow:hidden}iframe{border:0;display:block}</style>
<script type="module">
const tell = (m) => fetch("message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m) }).catch(() => {});
addEventListener("error", (e) => tell({ type: "error", message: String(e.message || e) }));
addEventListener("unhandledrejection", (e) => tell({ type: "error", message: String(e.reason && e.reason.message || e.reason) }));
const job = await (await fetch("job")).json();
const frame = document.createElement("iframe");
frame.width = String(job.width); frame.height = String(job.height);
const say = (m, transfer = []) => frame.contentWindow.postMessage(m, location.origin, transfer);
let asked = false, chain = Promise.resolve();
addEventListener("message", async (e) => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
  const m = e.data;
  if (!m || typeof m.type !== "string" || !m.type.startsWith("scmjs.view.")) return;
  if (m.type === "scmjs.view.ready") {
    if (asked) return;
    if (!m.files) { tell({ type: "error", message: m.why || "The page has none of the game's files." }); return; }
    if (!m.record) { tell({ type: "old" }); return; }
    asked = true;
    const bytes = new Uint8Array(await (await fetch("replay")).arrayBuffer());
    say({ type: "scmjs.view.load", replay: bytes, name: job.name }, [bytes.buffer]);
    tell({ type: "loading" });
  } else if (m.type === "scmjs.view.loaded") {
    tell({ type: "loaded", frames: m.frames });
    // (The camera's track is worked out while the page starts; it is asked for once the replay is loaded.)
    const track = await (await fetch("track")).json();
    if (track) say({ type: "scmjs.view.follow", track: { every: track.every, x: Float32Array.from(track.x), y: Float32Array.from(track.y), cut: Uint8Array.from(track.cut) } });
    say({ type: "scmjs.view.record", ...job.record });
  } else if (m.type === "scmjs.view.recording") {
    tell({ type: "progress", done: m.done, pictures: m.pictures, frame: m.frame });
  } else if (m.type === "scmjs.view.picture") {
    const index = m.index, pixels = m.pixels;
    chain = chain.then(async () => { await fetch("picture", { method: "POST", body: pixels }); say({ type: "scmjs.view.taken", index }); });
  } else if (m.type === "scmjs.view.recorded") {
    await chain;
    if (m.bytes) await fetch("clip", { method: "POST", body: m.bytes });
    tell({ type: "done", pictures: m.pictures, ms: m.ms, mime: m.mime });
  } else if (m.type === "scmjs.view.error") {
    tell({ type: "error", message: m.message });
  }
});
frame.src = job.page;
document.body.append(frame);
</script>`;
}

/** `.gz` bytes, or bytes a server sent compressed without saying so, made plain (as `ensureEngine` does). */
const plain = (bytes: Uint8Array): Uint8Array => (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? new Uint8Array(gunzipSync(bytes)) : bytes);

const readBody = (req: IncomingMessage): Promise<Buffer> => new Promise((r, j) => { const parts: Buffer[] = []; req.on("data", (c: Buffer) => parts.push(c)); req.on("end", () => r(Buffer.concat(parts))); req.on("error", j); });

interface Served {
  url: string;
  close(): void;
}

/**
 * The loopback server: the play page under its own path (from the play page's address, kept), the framing page and
 * what it reads and posts under a random token, and the game's files from the person's copy.
 */
async function serve(play: URL, token: string, job: Job, track: Promise<JobTrack | null>, replay: Uint8Array, files: GameFiles, on: { news(n: HostNews): void; clip(b: Buffer): void; picture(b: Buffer): void }): Promise<Served> {
  const prefix = play.pathname.endsWith("/") ? play.pathname : `${play.pathname}/`;
  const host = play.host;
  const fetched = new Map<string, Promise<{ bytes: Uint8Array; type: string } | null>>();
  const pageFile = (path: string) => {
    let p = fetched.get(path);
    if (!p) {
      p = (async () => {
        const kept = pageCachePath(path, prefix, host);
        if (kept && existsSync(kept)) return { bytes: new Uint8Array(readFileSync(kept)), type: typeOf(path) };
        let r: Response;
        try { r = await fetch(new URL(path, play.origin)); } catch (e) {
          // (The page itself is asked each time; offline, the last copy kept.)
          const last = join(cacheRoot(), "page", host.replace(/[^a-z0-9.-]/gi, "_"), "index.html");
          if (path === prefix && existsSync(last)) return { bytes: new Uint8Array(readFileSync(last)), type: TYPES[".html"] };
          throw e;
        }
        if (!r.ok) return null;
        const type = r.headers.get("content-type") ?? typeOf(path);
        const bytes = kept ? plain(new Uint8Array(await r.arrayBuffer())) : new Uint8Array(await r.arrayBuffer());
        if (kept) { mkdirSync(dirname(kept), { recursive: true }); writeFileSync(`${kept}.part`, bytes); renameSync(`${kept}.part`, kept); }
        if (path === prefix) { const last = join(cacheRoot(), "page", host.replace(/[^a-z0-9.-]/gi, "_"), "index.html"); mkdirSync(dirname(last), { recursive: true }); writeFileSync(last, bytes); }
        return { bytes, type };
      })();
      // (Only what came is remembered: a failure is asked again.)
      p.catch(() => fetched.delete(path));
      fetched.set(path, p);
    }
    return p;
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = decodeURIComponent(url.pathname);
      const send = (status: number, body: Uint8Array | string, type = "text/plain; charset=utf-8") => { res.writeHead(status, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
      if (path.startsWith(`/${token}/`)) {
        const rest = path.slice(token.length + 2);
        if (rest === "") return send(200, hostPage(), TYPES[".html"]);
        if (rest === "job") return send(200, JSON.stringify(job), TYPES[".json"]);
        // (Answered once the camera's track is worked out, which goes on beside the page's start.)
        if (rest === "track") return send(200, JSON.stringify(await track), TYPES[".json"]);
        if (rest === "replay") return send(200, replay, "application/octet-stream");
        if (rest === "message" && req.method === "POST") { const b = await readBody(req); send(204, ""); try { on.news(JSON.parse(b.toString("utf8")) as HostNews); } catch { /* not ours */ } return; }
        if (rest === "clip" && req.method === "POST") { const b = await readBody(req); send(204, ""); on.clip(b); return; }
        if (rest === "picture" && req.method === "POST") { const b = await readBody(req); on.picture(b); send(204, ""); return; }
        if (process.env.SCMJS_DEBUG && !rest.startsWith("files/")) process.stderr.write(`[serve] ${req.method} ${rest}\n`);
        if (rest.startsWith("files/")) {
          const member = servedGamePath(rest.slice("files/".length));
          const bytes = member ? await files.read(member).catch(() => null) : null;
          return bytes ? send(200, bytes, "application/octet-stream") : send(404, "not in the copy");
        }
        return send(404, "not found");
      }
      if (path === prefix.slice(0, -1)) { res.writeHead(301, { location: prefix }); res.end(); return; }
      if (path.startsWith(prefix)) {
        const got = await pageFile(path);
        if (process.env.SCMJS_DEBUG) process.stderr.write(`[serve] ${path} ${got ? got.bytes.length : 404}\n`);
        if (!got && path === prefix) on.news({ type: "error", message: t("{url} answered no page", { url: new URL(path, play.origin).href }) });
        return got ? send(200, got.bytes, got.type) : send(404, "not found");
      }
      send(404, "not found");
    })().catch((e) => { try { res.writeHead(502, { "content-type": "text/plain" }); res.end(String(e instanceof Error ? e.message : e)); } catch { /* gone */ } });
  });
  await new Promise<void>((r, j) => { server.once("error", j); server.listen(0, "127.0.0.1", () => r()); });
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: () => { server.closeAllConnections?.(); server.close(); } };
}

/* ── Where the action is ───────────────────────────────────────── */

/** Game frames between the moments the camera is worked out from. */
const SAMPLE_EVERY = 8;

/**
 * Moments of the game from `from` to `to` for following a player: the replay played by the engine's replay runner
 * (what `replay watch` runs) with no picture, a moment every few frames, every unit in each. The runner reads the
 * replay from a file; one from standard input is written to the temporary folder first.
 */
export async function gameMoments(input: Input, from: number, to: number, o: { play: string; starcraft?: string }): Promise<{ samples: Sample[]; players: { slot: number; name: string }[] }> {
  const engine = await ensureEngine(o.play);
  const runner = runnerFor(engine, "replay");
  const copy = findGameCopy(o.starcraft);
  let file = resolve(input.path), work: string | null = null;
  if (!existsSync(file)) { work = mkdtempSync(join(tmpdir(), "scmjs-export-")); file = join(work, "replay.rep"); writeFileSync(file, input.bytes); }
  try {
    const child = startRunner(runner, [file, "--engine", engine.dir, "--starcraft", copy.folder, "--every", String(SAMPLE_EVERY), "--from", String(Math.max(0, from)), "--to", String(to)]);
    let said = "";
    child.stderr?.on("data", (d: Buffer) => { said = (said + d.toString("utf8")).slice(-2000); });
    const samples: Sample[] = [];
    let players: { slot: number; name: string }[] = [], failed: string | null = null;
    for await (const raw of createInterface({ input: child.stdout! })) {
      let l: { kind?: string; frame?: number; units?: number[]; players?: { slot: number; name: string }[]; message?: string };
      try { l = JSON.parse(raw); } catch { continue; }
      if (l.kind === "start" && Array.isArray(l.players)) players = l.players;
      else if (l.kind === "frame" && typeof l.frame === "number" && Array.isArray(l.units)) samples.push({ frame: l.frame, units: l.units });
      else if (l.kind === "error") failed = l.message ?? "the runner failed";
    }
    const code = await new Promise<number | null>((r) => { if (child.exitCode !== null) r(child.exitCode); else child.once("close", r); });
    if (failed || (code !== 0 && !samples.length)) throw new Error(failed ?? (said.trim().split("\n").at(-1) || `the runner stopped (${code})`));
    return { samples, players };
  } finally {
    if (work) rmSync(work, { recursive: true, force: true });
  }
}

/* ── The command ────────────────────────────────────────────── */

export interface ExportResult {
  file: string;
  bytes: number;
  format: ClipFormat;
  width: number;
  height: number;
  fps: number;
  speed: number;
  pictures: number;
  from: number;
  to: number;
  /** Seconds of clip. */
  seconds: number;
  camera: string;
  /** Milliseconds: the page and the game loaded, the recording, ffmpeg's part. */
  ms: { load: number; record: number; convert: number; total: number };
  browser: string;
  encodedBy: "browser" | "ffmpeg" | "scmjs";
}

/** Where the view looks, in words. */
function cameraWords(c: Camera): string {
  return c.kind === "follow" ? t("following {name}", { name: c.player.name }) : c.kind === "at" ? t("at {x},{y}", { x: Math.floor(c.x / 32), y: Math.floor(c.y / 32) }) : t("the whole map");
}

export async function exportReplay(input: Input, rep: Replay, o: ExportOptions, progress: (line: string, done: boolean) => void = () => {}): Promise<ExportResult> {
  const started = Date.now();
  const debug = (line: string) => { if (process.env.SCMJS_DEBUG) process.stderr.write(`[export ${((Date.now() - started) / 1000).toFixed(1)} s] ${line}\n`); };
  let scn: ReturnType<typeof parseScenario>;
  try { scn = parseScenario(rep.chk); } catch (e) { throw new CliError(t("The replay's map could not be read ({message}).", { message: String(e instanceof Error ? e.message : e) }), null, 2); }
  const map = { width: scn.width, height: scn.height };
  const plan = planClip(input, rep, o, map);
  const ffmpeg = plan.format === "mp4" ? findFfmpeg() : null;
  if (plan.format === "mp4" && !ffmpeg) throw new CliError(t("An .mp4 is made with ffmpeg, which is not installed here."), t("Install ffmpeg (https://ffmpeg.org/download.html; winget install ffmpeg, brew install ffmpeg, apt install ffmpeg), or export a .webm, which needs nothing more."));
  // A GIF is made here from the pictures as drawn: smaller and truer than one ffmpeg makes from the encoded clip (cli.md).
  const jsGif = plan.format === "gif";
  const browserPath = findBrowser(o.browser ?? process.env.SCMJS_BROWSER);
  if (!browserPath) throw new CliError(t("No browser to draw the clip with was found."), translate(NO_BROWSER));
  if (o.browser && !existsSync(o.browser)) throw new CliError(t("{path} is not there.", { path: o.browser }), translate(NO_BROWSER), 2);
  debug(`browser ${browserPath}`);
  const files = await openGameFiles(o.starcraft, t("The clip is drawn with your own installation's pictures"));
  debug(`game files ${files.label} in ${files.folder}`);
  const playUrl = new URL((o.play ?? process.env.SCMJS_PLAY_URL ?? PLAY_URL).replace(/\/*$/, "/"));
  if (!/^https?:$/.test(playUrl.protocol)) throw new CliError(t("{url} is not a web address; replay export needs the play page's address.", { url: playUrl.href }), null, 2);

  // The camera: the player's clicks made into a track, a fixed place, or the whole map.
  const viewWidth = (plan.width * plan.rows) / plan.height;
  const mapPx = { width: map.width * 32, height: map.height * 32 };
  // Following a player: where their army is and where it fights, from the game played through by the replay runner
  // (beside the page's own start, which takes as long); from their clicks when the runner cannot be had.
  let followedBy: "game" | "clicks" | null = null;
  const trackReady: Promise<Track | null> = (async () => {
    if (plan.camera.kind !== "follow") return null;
    const who = plan.camera.player;
    const options = { view: { width: viewWidth, height: plan.rows }, map: mapPx, frames: plan.to + 48, rate: (1000 * plan.speed) / FRAME_MS };
    try {
      const lead = Math.round(3000 / FRAME_MS);
      const m = await gameMoments(input, plan.from - lead, plan.to + SAMPLE_EVERY, { play: playUrl.href.replace(/\/$/, ""), starcraft: o.starcraft });
      const k = rep.players.filter((p) => p.type === 2 || p.type === 1).indexOf(who);
      const side = m.players.find((p) => p.name === who.name) ?? m.players[k];
      const track = side ? actionTrack(m.samples, side.slot, options) : null;
      debug(`${m.samples.length} moments of the game; ${track ? "following the game" : "nothing of the player's in them"}`);
      if (track) { followedBy = "game"; return track; }
    } catch (e) { debug(`the replay runner: ${e instanceof Error ? e.message : e}`); }
    const start = scn.units.find((u) => u.unitId === START_LOCATION && u.owner === who.index);
    followedBy = "clicks";
    return followTrack(rep.commands, who.id, { ...options, start: start ? { x: start.x, y: start.y } : null });
  })();
  const token = randomBytes(12).toString("hex");
  const record: Record<string, unknown> = {
    width: plan.width, height: plan.height, fps: plan.fps, speed: plan.speed, from: plan.from, to: plan.to, rows: plan.rows,
    whole: plan.camera.kind === "all", camera: plan.camera.kind === "at" ? { x: plan.camera.x, y: plan.camera.y } : null,
    format: jsGif ? "frames" : "webm",
    // (For ffmpeg to make an MP4 from, more: the file is thrown away after.)
    bitrate: Math.round(Math.min(12_000_000, Math.max(1_000_000, plan.width * plan.height * plan.fps * (plan.format === "mp4" ? 0.2 : 0.08)))),
  };
  const job: Job = {
    name: input.name.toLowerCase().endsWith(".rep") ? input.name : `${input.name}.rep`,
    page: `${playUrl.pathname}?view&files=/${token}/files/`,
    width: plan.width, height: plan.height, record,
  };
  const trackJson: Promise<JobTrack | null> = trackReady.then((track) => track && { every: track.every, x: Array.from(track.x, (v) => Math.round(v * 10) / 10), y: Array.from(track.y, (v) => Math.round(v * 10) / 10), cut: Array.from(track.cut) });

  const gif = jsGif ? new GifWriter(plan.width, plan.height, 100 / plan.fps) : null;
  let clip: Buffer | null = null;
  let failure: CliError | null = null;
  let finished: () => void = () => {};
  const over = new Promise<void>((r) => { finished = r; });
  const fail = (e: CliError) => { failure ??= e; finished(); };
  const times = { loaded: 0, recorded: 0 };
  let last = Date.now(), lastDone = -1;
  const clock = (frame: number) => duration(frame * FRAME_MS);
  const served = await serve(playUrl, token, job, trackJson, input.bytes, files, {
    news: (n) => {
      last = Date.now();
      if (process.env.SCMJS_DEBUG && n.type !== "progress") process.stderr.write(`\n[host] ${JSON.stringify(n)}\n`);
      if (n.type === "loading") progress(pc.dim(t("Loading the replay in the game…")), false);
      else if (n.type === "loaded") { times.loaded = Date.now(); progress(pc.dim(t("Recording…")), false); }
      else if (n.type === "progress" && typeof n.done === "number" && typeof n.pictures === "number") {
        if (n.done === lastDone) return;
        if (n.done === 0) { progress(pc.dim(t("Going to {clock} in the game…", { clock: clock(n.frame ?? 0) })), false); return; }
        lastDone = n.done;
        const secs = (Date.now() - (times.loaded || started)) / 1000;
        progress(`${t("Recording {done}/{pictures} pictures", { done: num(n.done), pictures: num(n.pictures) })}${pc.dim(` · ${t("{clock} in the game", { clock: clock(n.frame ?? 0) })} · ${secs.toFixed(0)} s · ${t("{n} a second", { n: (n.done / Math.max(0.1, secs)).toFixed(0) })}`)}`, false);
      } else if (n.type === "done") { times.recorded = Date.now(); finished(); }
      else if (n.type === "old") fail(new CliError(t("The play page at {url} cannot record: it is older than replay export.", { url: playUrl.href }), t("It needs a deploy of the play page from November 2026 or later; name another with SCMJS_PLAY_URL.")));
      else if (n.type === "error") fail(new CliError(n.message ? t("The play page could not record the replay: {message}", { message: n.message }) : t("The play page could not record the replay: no reason given")));
    },
    clip: (b) => { clip = b; },
    picture: (b) => { gif?.add(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)); },
  });

  let browser: Launched | null = null;
  const watchdog = setInterval(() => {
    const quiet = Date.now() - last;
    // (The first run fetches the engine, about 25 MB, through this server before the page says anything.)
    if (quiet > (times.loaded ? 60_000 : 300_000)) fail(new CliError(t("The play page said nothing for {n} s.", { n: Math.round(quiet / 1000) }), t("Try again; --browser names another browser.")));
  }, 2000);
  try {
    debug(`serving ${served.url}/${token}/`);
    browser = launchBrowser(browserPath, { width: plan.width, height: plan.height });
    void browser.exited.then(() => fail(new CliError(t("The browser stopped before the clip was made."), t("{browser} may be too old: a Chrome, Chromium or Edge from 2023 or later records.", { browser: browserPath }))));
    const errors: string[] = [];
    browser.cdp.on((m) => {
      // (SCMJS_DEBUG: what the page says in its console, for finding out why a recording went wrong.)
      if (process.env.SCMJS_DEBUG && m.method === "Runtime.consoleAPICalled") process.stderr.write(`\n[page ${String(m.params?.type)}] ${((m.params?.args as { value?: unknown; description?: string }[] | undefined) ?? []).map((a) => a.value ?? a.description ?? "").join(" ")}\n`);
      if (process.env.SCMJS_DEBUG && m.method === "Runtime.exceptionThrown") process.stderr.write(`\n[page exception] ${JSON.stringify(m.params).slice(0, 600)}\n`);
      if (m.method === "Runtime.exceptionThrown") errors.push(String((m.params?.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined)?.exception?.description ?? (m.params?.exceptionDetails as { text?: string })?.text ?? "").split("\n")[0]);
      if (m.method === "Inspector.targetCrashed") fail(new CliError(t("The page crashed while recording."), t("The browser ran out of memory, perhaps; a smaller --size helps.")));
    });
    const { targetId } = await browser.cdp.send("Target.createTarget", { url: `${served.url}/${token}/` }) as { targetId: string };
    const { sessionId } = await browser.cdp.send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId: string };
    await browser.cdp.send("Runtime.enable", {}, sessionId).catch(() => {});
    await over;
    if (failure) {
      const f = failure as CliError;
      throw errors.length && !f.hint ? new CliError(f.message, t("The page said: {errors}", { errors: errors.slice(-2).join("; ") })) : f;
    }
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new CliError(t("The browser could not record the clip ({message}).", { message: String(e instanceof Error ? e.message : e) }), translate(NO_BROWSER));
  } finally {
    clearInterval(watchdog);
    await browser?.stop();
    served.close();
  }

  // The file: the page's WebM as it is, or made into the kind asked for.
  const convertStart = Date.now();
  mkdirSync(dirname(plan.out), { recursive: true });
  let encodedBy: ExportResult["encodedBy"] = "browser";
  const got = clip as Buffer | null;
  if (gif) { writeFileSync(plan.out, gif.finish()); encodedBy = "scmjs"; }
  else if (!got) throw new CliError(t("The play page finished without a clip."));
  else if (plan.format === "webm") writeFileSync(plan.out, got);
  else {
    const work = mkdtempSync(join(tmpdir(), "scmjs-export-"));
    try {
      const webm = join(work, "clip.webm");
      writeFileSync(webm, got);
      const args = ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "medium", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", plan.out];
      const r = spawnSync(ffmpeg!.path, args, { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
      if (r.status !== 0) throw new CliError(t("ffmpeg could not make the MP4: {message}", { message: (r.stderr || r.error?.message || "").trim().split("\n").slice(-2).join(" ") }), t("--out clip.webm keeps the browser's own file."));
      encodedBy = "ffmpeg";
    } finally { rmSync(work, { recursive: true, force: true }); }
  }
  const now = Date.now();
  return {
    file: plan.out, bytes: statSync(plan.out).size, format: plan.format, width: plan.width, height: plan.height, fps: plan.fps, speed: plan.speed,
    pictures: plan.pictures, from: plan.from, to: plan.to, seconds: plan.pictures / plan.fps, camera: followedBy === "clicks" ? t("{camera} (by their clicks)", { camera: cameraWords(plan.camera) }) : cameraWords(plan.camera),
    ms: { load: (times.loaded || now) - started, record: (times.recorded || now) - (times.loaded || started), convert: now - convertStart, total: now - started },
    browser: browserPath, encodedBy,
  };
}

/** The line the command ends with. */
export function exportSummary(r: ExportResult, cwd = process.cwd()): string {
  const shown = r.file.startsWith(`${cwd}/`) ? r.file.slice(cwd.length + 1) : r.file;
  return `${mark.ok} ${pc.bold(shown)}${pc.dim(` · ${size(r.bytes)} · ${r.width} × ${r.height} · ${t("{length} at {fps} a second", { length: duration(r.seconds * 1000), fps: r.fps % 1 ? r.fps.toFixed(1) : r.fps })} · ${t("{from}–{to} of the game at {speed}×", { from: duration(r.from * FRAME_MS), to: duration(r.to * FRAME_MS), speed: r.speed })} · ${r.camera} · ${t("made in {seconds} s", { seconds: (r.ms.total / 1000).toFixed(1) })}`)}`;
}
