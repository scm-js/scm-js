/**
 * `scmjs mod play <source> [--map <file>]`: the mod on the play page. The command serves a page on the loopback
 * address for a moment; that page opens the play page and, when it says it is ready, posts it the mod's **changed
 * files** — those that differ from the person's own game, or all of them when no copy was found here — as
 *
 *   { type: "scmjs.play", dataSet: { name, hash, files: [{ path, file }] }, map?, name? }
 *
 * `path` is the game's path in lower case with forward slashes (`arr/weapons.dat`), `file` a `File` of its bytes;
 * `hash` is `dataSetHash` over the same files (sixteen hex digits), so a page that already keeps that mod can say so
 * and skip storing it again. With `--map`, `map` is the map's bytes and `name` its file name, as the play page's
 * hand-over has always taken a map. Every `scmjs.*` message the play page sends back is forwarded to the command;
 * `scmjs.play.started`, `scmjs.play.shown` or `scmjs.taken` end the wait, `scmjs.play.error` ends it with the page's
 * words. Nothing of the mod leaves this computer: the page is on the person's own browser.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { dataSetHash, gameName } from "../../../src/formats/mod/sources";
import type { GameFiles } from "../gamefiles";
import { openBrowser, PLAY_PAGE_URL } from "../open";
import { CliError, mark, pc } from "../ui";
import type { ModSource } from "./source";

export interface PlayFile { path: string; name: string; bytes: Uint8Array }

export interface PlaySet {
  name: string;
  hash: string;
  files: PlayFile[];
  /** Every file of the mod, and how many of them the person's game has the same. */
  total: { files: number; bytes: number };
  same: number;
  /** The copy of the game the files were compared with; null: none found, all are handed over. */
  against: string | null;
}

/** The files to hand over: the mod's that differ from the person's game (all of them without one). */
export async function playSet(source: ModSource, base: GameFiles | null): Promise<PlaySet> {
  const files: PlayFile[] = [];
  let bytes = 0, same = 0;
  for (const f of [...source.files.values()].sort((a, b) => (gameName(a.name) < gameName(b.name) ? -1 : 1))) {
    const data = await f.read();
    bytes += data.length;
    const theirs = base ? await base.read(f.name) : null;
    if (theirs && theirs.length === data.length && theirs.every((b, i) => b === data[i])) { same++; continue; }
    files.push({ path: gameName(f.name).replace(/\\/g, "/"), name: f.name, bytes: data });
  }
  if (!files.length) throw new CliError(`${source.name} changes nothing of the game here: every file is the same as ${base?.label ?? "the game's"}.`, null, 1);
  return { name: source.name, hash: await dataSetHash(files.map((f) => ({ name: f.name, bytes: f.bytes }))), files, total: { files: source.files.size, bytes }, same, against: base?.label ?? null };
}

/** What the play page said. */
export interface PlayOutcome { started: boolean; shown: boolean; error: string | null; said: { type: string; [key: string]: unknown }[] }

export interface PlayOptions {
  map?: { name: string; bytes: Uint8Array } | null;
  play?: string;
  live?: (line: string) => void;
  onAddress?: (page: string) => void;
  timeout?: number;
}

/** Hands the set to the play page through a loopback page and waits for it to start (or show, or refuse). */
export async function playOnPage(set: PlaySet, o: PlayOptions = {}): Promise<PlayOutcome> {
  const token = randomBytes(12).toString("hex");
  const target = new URL(o.play ?? process.env.SCMJS_PLAY_URL ?? PLAY_PAGE_URL);
  target.searchParams.set("handoff", "1");
  const say = o.live ?? (() => {});
  const outcome: PlayOutcome = { started: false, shown: false, error: null, said: [] };
  let done: () => void = () => {};
  const finished = new Promise<void>((r) => { done = r; });
  const manifest = { name: set.name, hash: set.hash, files: set.files.map((f) => ({ path: f.path, size: f.bytes.length })), map: o.map?.name ?? null };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const p = url.pathname;
    if (p === `/${token}`) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(loopbackPage(set.name, target.href, token)); return; }
    if (p === `/${token}/manifest`) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(manifest)); return; }
    const file = /^\/([0-9a-f]+)\/file\/(\d+)$/.exec(p);
    if (file && file[1] === token && set.files[Number(file[2])]) { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(set.files[Number(file[2])].bytes); return; }
    if (p === `/${token}/map` && o.map) { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(o.map.bytes); return; }
    if (p === `/${token}/message` && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(204).end();
        let m: { type: string; [key: string]: unknown } | null = null;
        try { m = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* not ours */ }
        if (!m || typeof m.type !== "string") return;
        outcome.said.push(m);
        if (m.type === "scmjs.play.started" || m.type === "scmjs.taken") { outcome.started = true; done(); }
        else if (m.type === "scmjs.play.shown") { outcome.shown = true; done(); }
        else if (m.type === "scmjs.play.error" || m.type === "scmjs.error") { outcome.error = String(m.message ?? "the play page could not take the mod"); done(); }
        else if (m.type === "scmjs.waiting") say(`${mark.info} ${String(m.message ?? m.reason ?? "waiting")}`);
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r, j) => { server.once("error", j); server.listen(0, "127.0.0.1", () => r()); });
  const page = `http://127.0.0.1:${(server.address() as { port: number }).port}/${token}`;
  o.onAddress?.(page);
  openBrowser(page);
  say(`${mark.info} Opening the play page with ${pc.bold(set.name)} in your browser${pc.dim(`\n  If nothing opens, go to ${page}`)}`);
  const timer = setTimeout(() => done(), o.timeout ?? 300_000);
  await finished;
  clearTimeout(timer);
  server.close();
  if (!outcome.started && !outcome.shown && !outcome.error) throw new CliError("The play page did not take the mod", `Open ${target.origin}${target.pathname} and drop the mod's folder on it.`);
  return outcome;
}

/** The loopback page: opens the play page and posts it the mod's files (and the map) when it says it is ready. */
function loopbackPage(name: string, play: string, token: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const origin = new URL(play).origin;
  return `<!doctype html><meta charset="utf-8"><title>Playing ${esc(name)} in scmJS</title>
<style>body{font:15px system-ui,sans-serif;background:#14141c;color:#d8d8e8;display:grid;place-items:center;height:90vh;margin:0}
main{text-align:center}button{font:inherit;padding:.6em 1.4em;border-radius:6px;border:1px solid #4a4a6a;background:#262640;color:#fff;cursor:pointer}
p{color:#9898b0}</style>
<main><h2>Playing ${esc(name)}</h2><p id="say">Opening the play page…</p><button id="go" hidden>Open the play page</button></main>
<script>
const play = ${JSON.stringify(play)}, origin = ${JSON.stringify(origin)}, token = ${JSON.stringify(token)};
const tell = (m) => fetch("/" + token + "/message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m) });
const say = (t) => { document.getElementById("say").textContent = t; };
const ENDS = ["scmjs.play.started", "scmjs.play.shown", "scmjs.taken", "scmjs.play.error", "scmjs.error"];
let win = null, built = null;
async function message() {
  if (built) return built;
  const m = await (await fetch("/" + token + "/manifest")).json();
  const files = [];
  for (let i = 0; i < m.files.length; i++) {
    say("Reading the mod: " + (i + 1) + " of " + m.files.length + " files…");
    const bytes = new Uint8Array(await (await fetch("/" + token + "/file/" + i)).arrayBuffer());
    files.push({ path: m.files[i].path, file: new File([bytes], m.files[i].path.split("/").pop()) });
  }
  built = { type: "scmjs.play", dataSet: { name: m.name, hash: m.hash, files } };
  if (m.map) { built.map = new Uint8Array(await (await fetch("/" + token + "/map")).arrayBuffer()); built.name = m.map; }
  return built;
}
addEventListener("message", async (e) => {
  if (e.origin !== origin || e.source !== win) return;
  const type = e.data?.type;
  if (typeof type !== "string" || !type.startsWith("scmjs.")) return;
  // (each time it says it is ready: a first visit takes the game's files and loads again)
  if (type === "scmjs.ready" || type === "scmjs.play.ready") { win.postMessage(await message(), origin); say("Handed to the play page."); return; }
  const { type: _t, ...rest } = e.data;
  await tell({ type, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v === "string")) });
  if (ENDS.includes(type)) { say(type.endsWith("error") ? (e.data.message || "The play page could not take the mod.") : "Playing. You can close this tab and go back to the terminal."); }
  else if (e.data.message) say(e.data.message);
});
function go() { win = open(play, "_blank"); if (win) { document.getElementById("go").hidden = true; say("Waiting for the play page…"); } return !!win; }
if (!go()) { say("Your browser asks before opening the play page."); document.getElementById("go").hidden = false; }
document.getElementById("go").onclick = go;
</script>`;
}
