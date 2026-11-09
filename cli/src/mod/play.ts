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
 *
 * With `--bot` (the mods plan's C6) the message also carries
 *
 *   bot: { key, race? } | { file, name, race? }, setup: true unless --start, useMapSettings: true | null
 *
 * — a bot of the play page's catalogue by its key, or a `.scmbot` file's bytes as a `File` (the page keeps it as
 * Options → Add a bot from a file… keeps one); `race` its race (0 zerg, 1 terran, 2 protoss, 6 random); the setup
 * screen shown with the bot's row filled, or the game started at once; the map with its own settings for a mod with
 * plugins or a FireGraft project (as the runners play one), else the page's guess. The page answers `shown` or
 * `started` with `bot`, the row as the screen words it, and `scmjs.play.waiting` while it asks the person to sign in
 * (a catalogue bot takes an account). A mod with plugins or a FireGraft project is handed to the page at
 * `?lift=live`, where they run.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename } from "node:path";
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

/** What the play page said; `bot` is the bot's row as its setup screen words it. */
export interface PlayOutcome { started: boolean; shown: boolean; error: string | null; bot: string | null; said: { type: string; [key: string]: unknown }[] }

/** The bot for the other side: a catalogue bot by its key, or a `.scmbot` file. */
export type PlayBot = { key: string } | { name: string; bytes: Uint8Array };

export interface PlayOptions {
  map?: { name: string; bytes: Uint8Array } | null;
  /** A bot for the other side, and its race (0 zerg, 1 terran, 2 protoss, 6 random). */
  bot?: PlayBot | null;
  botRace?: number;
  /** Start the game at once rather than show the setup screen (with a bot; a map alone always starts). */
  start?: boolean;
  play?: string;
  /** Hand over at `?lift=live`, where plugins and FireGraft's exe edits run: by default when the mod has either. */
  lift?: boolean;
  live?: (line: string) => void;
  onAddress?: (page: string) => void;
  timeout?: number;
}

/** What the loopback page adds to the `scmjs.play` message besides the mod and the map (absent: nothing). */
export interface HandoffExtra {
  setup?: boolean;
  useMapSettings?: boolean | null;
  bot?: ({ key: string } | { file: string }) & { race?: number };
}

/** The races `--race` takes, as the play page numbers them. */
export const PAGE_RACES: Record<string, number> = { z: 0, zerg: 0, t: 1, terran: 1, p: 2, protoss: 2, r: 6, random: 6 };

/** `--race`: a race's name or letter, as the play page numbers it. */
export function pageRace(race: string): number {
  const n = PAGE_RACES[race.trim().toLowerCase()];
  if (n === undefined) throw new CliError(t("--race {value} is not a race: zerg, terran, protoss or random", { value: race }), null, 2);
  return n;
}

/**
 * `--bot`: a `.scmbot` file (read here, handed over as bytes), or the key of a bot in the play page's catalogue
 * (`example`, `mcrave`, `ualbertabot`, `cosmonarchy-example`), which the page checks.
 */
export function playBotOf(bot: string): PlayBot {
  if (/\.scmbot$/i.test(bot) || /[\\/]/.test(bot) || (existsSync(bot) && statSync(bot).isFile())) {
    if (!existsSync(bot) || !statSync(bot).isFile()) throw new CliError(t("No bot file {file}", { file: bot }), t("--bot takes a .scmbot file (scmjs bot build writes one in out/) or a bot of the play page by its key, such as cosmonarchy-example."), 2);
    return { name: basename(bot), bytes: new Uint8Array(readFileSync(bot)) };
  }
  if (!/^[A-Za-z0-9][\w.-]{0,63}$/.test(bot)) throw new CliError(t("--bot {value} is neither a .scmbot file nor a bot's key", { value: bot }), t("A key is a word such as cosmonarchy-example or mcrave."), 2);
  return { key: bot };
}

/**
 * The hand-over's additions for `o`: with a bot, the bot (a file by its name: its bytes are fetched apart), the setup
 * screen unless `start`, and the map's own settings for a mod with code (null: the page's guess).
 */
export function handoffExtra(set: PlaySet, o: PlayOptions): HandoffExtra | null {
  if (!o.bot) return null;
  const race = o.botRace !== undefined ? { race: o.botRace } : {};
  return {
    ...(o.start ? {} : { setup: true }),
    useMapSettings: set.plugins + set.firegraft > 0 ? true : null,
    bot: "key" in o.bot ? { key: o.bot.key, ...race } : { file: o.bot.name, ...race },
  };
}

/** Hands the set to the play page through a loopback page and waits for it to start (or show, or refuse). */
export async function playOnPage(set: PlaySet, o: PlayOptions = {}): Promise<PlayOutcome> {
  const token = randomBytes(12).toString("hex");
  const target = new URL(o.play ?? process.env.SCMJS_PLAY_URL ?? PLAY_PAGE_URL);
  target.searchParams.set("handoff", "1");
  // (the page runs a mod's plugins and FireGraft's exe edits only at ?lift=live)
  if ((o.lift ?? set.plugins + set.firegraft > 0) && !target.searchParams.has("lift")) target.searchParams.set("lift", "live");
  const say = o.live ?? (() => {});
  const outcome: PlayOutcome = { started: false, shown: false, error: null, bot: null, said: [] };
  let done: () => void = () => {};
  const finished = new Promise<void>((r) => { done = r; });
  const extra = handoffExtra(set, o);
  const botBytes = o.bot && "bytes" in o.bot ? o.bot.bytes : null;
  const manifest = { name: set.name, hash: set.hash, files: set.files.map((f) => ({ path: f.path, size: f.bytes.length })), map: o.map?.name ?? null, ...(extra ? { handoff: extra } : {}) };
  let readies = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const p = url.pathname;
    if (p === `/${token}`) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(loopbackPage(set.name, target.href, token)); return; }
    if (p === `/${token}/manifest`) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(manifest)); return; }
    const file = /^\/([0-9a-f]+)\/file\/(\d+)$/.exec(p);
    if (file && file[1] === token && set.files[Number(file[2])]) { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(set.files[Number(file[2])].bytes); return; }
    if (p === `/${token}/map` && o.map) { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(o.map.bytes); return; }
    if (p === `/${token}/bot` && botBytes) { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(botBytes); return; }
    if (p === `/${token}/message` && req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(204).end();
        let m: { type: string; [key: string]: unknown } | null = null;
        try { m = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* not ours */ }
        if (!m || typeof m.type !== "string") return;
        outcome.said.push(m);
        if (typeof m.bot === "string") outcome.bot = m.bot;
        if (m.type === "scmjs.play.started" || m.type === "scmjs.taken") { outcome.started = true; done(); }
        else if (m.type === "scmjs.play.shown") { outcome.shown = true; done(); }
        else if (m.type === "scmjs.play.error" || m.type === "scmjs.error") { outcome.error = String(m.message ?? t("the play page could not take the mod")); done(); }
        else if (m.type === "scmjs.waiting" || m.type === "scmjs.play.waiting") say(`${mark.info} ${String(m.message ?? m.reason ?? t("waiting"))}`);
        else if (m.type === "scmjs.ready" || m.type === "scmjs.play.ready") say(`${mark.info} ${readies++ ? t("The play page is ready again: the mod is handed over again") : t("The play page is ready: the mod is handed over")}`);
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
  const h = m.handoff;
  if (h) {
    if (h.setup) built.setup = true;
    if ("useMapSettings" in h) built.useMapSettings = h.useMapSettings;
    if (h.bot) {
      const race = typeof h.bot.race === "number" ? { race: h.bot.race } : {};
      built.bot = h.bot.file ? { file: new File([await (await fetch("/" + token + "/bot")).arrayBuffer()], h.bot.file), name: h.bot.file, ...race } : { key: h.bot.key, ...race };
    }
  }
  return built;
}
addEventListener("message", async (e) => {
  if (e.origin !== origin || e.source !== win) return;
  const type = e.data?.type;
  if (typeof type !== "string" || !type.startsWith("scmjs.")) return;
  // (each time it says it is ready: a first visit takes the game's files and loads again)
  if (type === "scmjs.ready" || type === "scmjs.play.ready") { win.postMessage(await message(), origin); say("Handed to the play page."); await tell({ type }); return; }
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
