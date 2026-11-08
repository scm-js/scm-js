/**
 * `scmjs mod play <source> [--map <file>]`: the mod on the play page. The command serves a page on the loopback
 * address for a moment; that page opens the play page and, when it says it is ready, posts it **every file of the
 * mod** — the play page compares them with the person's own game itself and keeps those that differ — as
 *
 *   { type: "scmjs.play", dataSet: { name, hash, files: [{ path, file }] }, map?, name? }
 *
 * `path` is the game's path in lower case with forward slashes (`arr/weapons.dat`), a plugin the mod carries as a file
 * under `plugins/`, a FireGraft file under `firegraft/`; `file` a `File` of its bytes. The game files the page would
 * not take as loose files (one under `plugins\` or `firegraft\`, one beside the game's folders, a `.dll` or an archive's
 * name — members of the mod's own archive, such as Cosmonarchy's `plugins\apply`) go in one small MPQ,
 * `scmjs-members.mpq`, which the page opens as it opens the mod's own. `hash` is the mod's hash
 * (core's `modHashOfDigests`, sixteen hex digits), which the page works out again from the same files and arrives at,
 * so a page that already keeps that mod can say so and skip storing it again. With `--map`, `map` is the map's bytes and `name` its file name, as the play page's
 * hand-over has always taken a map. Every `scmjs.*` message the play page sends back is forwarded to the command;
 * `scmjs.play.started`, `scmjs.play.shown` or `scmjs.taken` end the wait, `scmjs.play.error` ends it with the page's
 * words. Nothing of the mod leaves this computer: the page is on the person's own browser.
 */
import { createServer } from "node:http";
import { Creator } from "mopaq";
import { randomBytes } from "node:crypto";
import { gameName } from "../../../src/formats/mod/sources";
import { openBrowser, PLAY_PAGE_URL } from "../open";
import { t } from "../i18n";
import { CliError, mark, pc } from "../ui";
import { modHashOfDigests } from "../../../src/formats/mod/hash";
import { fileDigest } from "../../../src/formats/mod/sources";
import type { ModSource } from "./source";

export interface PlayFile { path: string; name: string; bytes: Uint8Array }

export interface PlaySet {
  name: string;
  /** The mod's hash, and without its plugins' lines (what a page that runs none of them presents). */
  hash: string;
  withoutPlugins: string;
  files: PlayFile[];
  /** The mod's game files, and their bytes. */
  total: { files: number; bytes: number };
  /** The plugins and FireGraft files handed over with them. */
  plugins: number;
  firegraft: number;
}

/**
 * The files to hand over: every game file of the mod, the plugins it carries as files and its FireGraft files — what
 * the page's own hash is worked out from, so the page names the mod as this does.
 */
export async function playSet(source: ModSource): Promise<PlaySet> {
  const files: PlayFile[] = [], members: PlayFile[] = [];
  const digests: { game: { name: string; sha256: string }[]; plugins: { name: string; sha256: string }[]; firegraft: { name: string; sha256: string }[] } = { game: [], plugins: [], firegraft: [] };
  let bytes = 0, count = 0;
  for (const f of [...source.files.values()].sort((a, b) => (gameName(a.name) < gameName(b.name) ? -1 : 1))) {
    let data: Uint8Array;
    try { data = await f.read(); } catch { continue; }
    bytes += data.length; count++;
    digests.game.push({ name: f.name, sha256: await fileDigest(data) });
    (notLoose(gameName(f.name)) ? members : files).push({ path: gameName(f.name).replace(/\\/g, "/"), name: f.name, bytes: data });
  }
  if (!count) throw new CliError(t("{name} has no game files to hand over.", { name: source.name }), null, 1);
  if (members.length) {
    const mpq = new Creator({ listfile: true });
    for (const m of members) mpq.addFile(m.name, m.bytes, { compress: false });
    files.push({ path: HANDED_MEMBERS, name: HANDED_MEMBERS, bytes: await mpq.writeAsync() });
  }
  const leaf = (n: string) => n.split(/[\\/]/).pop()!;
  // (A plugin inside the mod's archive is not one the page loads, nor a line of the hash: it is not handed over.)
  const plugins = source.plugins.filter((p) => !p.member), firegraft = source.firegraft;
  for (const p of plugins) { const b = await p.read(); digests.plugins.push({ name: p.name, sha256: await fileDigest(b) }); files.push({ path: `plugins/${leaf(p.name)}`, name: leaf(p.name), bytes: b }); }
  for (const p of firegraft) { const b = await p.read(); digests.firegraft.push({ name: p.name, sha256: await fileDigest(b) }); files.push({ path: `firegraft/${leaf(p.name)}`, name: leaf(p.name), bytes: b }); }
  const h = await modHashOfDigests({ files: digests.game, plugins: digests.plugins, firegraft: digests.firegraft });
  return { name: source.name, hash: h.hash, withoutPlugins: h.withoutPlugins, files, total: { files: count, bytes }, plugins: plugins.length, firegraft: firegraft.length };
}

/** The MPQ the game files the page would not take loose are handed over in. */
export const HANDED_MEMBERS = "scmjs-members.mpq";

/**
 * A game name the play page would not take as a loose file: beside the game's folders, under `plugins\` or
 * `firegraft\` (a plugin's own files there are left out of a folder), a library, or an archive's or a plugin's name.
 */
export const notLoose = (name: string): boolean => !name.includes("\\") || /^(plugins|firegraft)\\/.test(name) || /\.(dll|zip|mpq|exe|qdp|bwl|fgp|fgd)$/.test(name);

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
        else if (m.type === "scmjs.play.error" || m.type === "scmjs.error") { outcome.error = String(m.message ?? t("the play page could not take the mod")); done(); }
        else if (m.type === "scmjs.waiting") say(`${mark.info} ${String(m.message ?? m.reason ?? t("waiting"))}`);
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r, j) => { server.once("error", j); server.listen(0, "127.0.0.1", () => r()); });
  const page = `http://127.0.0.1:${(server.address() as { port: number }).port}/${token}`;
  o.onAddress?.(page);
  openBrowser(page);
  say(`${mark.info} ${t("Opening the play page with {name} in your browser", { name: pc.bold(set.name) })}${pc.dim(`\n  ${t("If nothing opens, go to {page}", { page })}`)}`);
  const timer = setTimeout(() => done(), o.timeout ?? 300_000);
  await finished;
  clearTimeout(timer);
  server.close();
  if (!outcome.started && !outcome.shown && !outcome.error) throw new CliError(t("The play page did not take the mod"), t("Open {address} and drop the mod's folder on it.", { address: `${target.origin}${target.pathname}` }));
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
