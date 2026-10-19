/**
 * What the hosted editor counts of its own use: the name of a feature when it is used — a
 * dialog opening, a map saved, a plugin's menu item, an edit on a layer — with a few words
 * about it from fixed lists (the tileset, the dialog's id, the file's extension). Never the
 * map, its name or a file name, nothing typed, and no identifier: what arrives is a count
 * on the scmjs.dev server's `/admin` page, beside the visits the site's counting script
 * already sends.
 *
 * The sending is the site's: the front-door worker serves the counting script at
 * `scmjs.dev/_e.js` (`index.html` loads it on the hosted editor only), and it puts
 * `window.scmjsHits` on the page. Nothing here runs in the desktop app, a container or a
 * local build: `count` does nothing unless the page is on scmjs.dev, which is asked of the
 * address rather than the build, since the stable site's files are also the release zip,
 * the container and the desktop bundle. The script itself refuses anything but scmjs.dev
 * and an automated browser.
 *
 * Counts are gathered for `FLUSH_MS` and sent together: the same feature with the same
 * words is one line with `n` uses, so a painting session is a handful of lines rather than
 * a request per stroke. Leaving or hiding the page sends what is waiting, so the long wait
 * only costs the counts of a tab that crashed or was killed.
 *
 * Preferences ▸ General ▸ Privacy turns it off (`Preferences.counting`, on by default).
 * Off also writes `OFF_KEY` — outside the editor's own keys and the nightly's prefix, since
 * it is the site's script that reads it — so the visit count stops for this browser on the
 * whole of scmjs.dev, not just the feature counts. The site's privacy page has a button that
 * writes the same entry, so at startup the preference follows it (`useUsageCounts`).
 */
import { copyKind } from "../gamedata/copies";
import type { AssetSource } from "../gamedata/source";
import { APP_VERSION } from "../version";

export type CountProps = Record<string, string | number | boolean>;

interface HitsWindow {
  scmjsHits?: { track(name: string, props?: CountProps): void };
  scmjsVersion?: string;
}

/** What the site's counting script reads before it sends anything. */
export const OFF_KEY = "scmjs.counting";

/** Two minutes: an hour of steady editing is about 30 requests. */
const FLUSH_MS = 120_000;
/** Lines waiting while the script has not arrived (or never will); past this, new ones are dropped. */
const MAX_WAITING = 200;

let hosted = typeof location !== "undefined" && location.hostname === "scmjs.dev";
let on = true;
const waiting = new Map<string, { name: string; props: CountProps | undefined; n: number }>();
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
let listed: (spec: string) => boolean = () => false;

const hitsWindow = (): HitsWindow | null => (typeof window === "undefined" ? null : (window as unknown as HitsWindow));

/** Count one use of `name`. The props are a few words from fixed lists, never the user's text. */
export function count(name: string, props?: CountProps): void {
  if (!hosted || !on) return;
  const key = props ? `${name}\u0000${JSON.stringify(Object.entries(props).sort(([a], [b]) => (a < b ? -1 : 1)))}` : name;
  const line = waiting.get(key);
  if (line) line.n++;
  else if (waiting.size < MAX_WAITING) waiting.set(key, { name, props, n: 1 });
  listen();
  timer ??= setTimeout(flushCounts, FLUSH_MS);
}

/** Send what is waiting, when the site's script is there to send it; otherwise it waits for the next try. */
export function flushCounts(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  const hits = hitsWindow()?.scmjsHits;
  if (!hits || waiting.size === 0) {
    if (waiting.size > 0) timer = setTimeout(flushCounts, FLUSH_MS);
    return;
  }
  for (const { name, props, n } of waiting.values()) {
    try { hits.track(name, n > 1 ? { ...props, n } : props); } catch { /* the script's own business */ }
  }
  waiting.clear();
}

/** Turn the counting on or off for this browser (the preference). Off drops what was waiting. */
export function setCounting(next: boolean): void {
  on = next;
  if (!on) { waiting.clear(); if (timer) { clearTimeout(timer); timer = null; } }
  if (!hosted) return;
  const w = hitsWindow();
  if (w) w.scmjsVersion = APP_VERSION;
  try {
    if (on) localStorage.removeItem(OFF_KEY); else localStorage.setItem(OFF_KEY, "off");
  } catch {
    // A browser that keeps nothing: the script cannot read the switch either, and the preference still stops the counts here.
  }
}

/**
 * What this browser said last, from `OFF_KEY`: the site's privacy page writes it too, so it is
 * the one answer the editor's preference follows at startup. True where nothing can be read.
 */
export function countingWanted(): boolean {
  try { return localStorage.getItem(OFF_KEY) !== "off"; } catch { return true; }
}

/** Whether this build counts at all (the hosted editor) — the switch is only shown where it does something. */
export function countingHere(): boolean {
  return hosted;
}

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushCounts(); });
  window.addEventListener("pagehide", flushCounts);
}

/** Tests: act as the hosted editor (or not), with nothing waiting. */
export function resetCountsForTests(asHosted: boolean): void {
  hosted = asHosted;
  on = true;
  waiting.clear();
  if (timer) { clearTimeout(timer); timer = null; }
}

/** Tests: what is waiting to be sent. */
export function waitingCounts(): { name: string; props: CountProps | undefined; n: number }[] {
  return [...waiting.values()];
}

/* ── Words for the props ────────────────────────────────── */

/** A map's size as the game lists it: `128x128`. */
export const sizeOf = (w: number, h: number) => `${w}x${h}`;

/** A file name's extension, lower case, from the ones the editor reads; anything else is `other`. */
export function extOf(fileName: string | null | undefined): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(fileName ?? "")?.[1]?.toLowerCase();
  if (!fileName) return "none";
  return ext && ["scm", "scx", "chk", "rep", "png", "json", "txt", "wav", "ogg", "mpq", "zip"].includes(ext) ? ext : "other";
}

/**
 * What a plugin is called in the counts: the repository name of one the project publishes
 * (`github:scm-js/…`, a bundled one, or one listed in a registry the editor read), and
 * `other` for anything else — a plugin someone installed from their own address is theirs.
 */
export function pluginCountName(spec: string, listed: (spec: string) => boolean = () => false): string {
  const s = spec.trim();
  const builtin = /^builtin:([\w-]+)$/i.exec(s);
  if (builtin) return builtin[1].toLowerCase();
  const own = /^(?:github:)?scm-js\/([\w.-]+?)(?:@.*)?$/i.exec(s);
  if (own) return own[1].toLowerCase();
  if (listed(s)) {
    const gh = /^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:@.*)?$/i.exec(s);
    if (gh) return `${gh[1]}/${gh[2]}`.toLowerCase().slice(0, 64);
  }
  return "other";
}

/** Which plugins the registries list (`useUsageCounts` keeps it current from what Browse last read). */
export function setListedPlugins(fn: (spec: string) => boolean): void {
  listed = fn;
}

/** Replays counted lately, by name, size and date, so one file reaching a plugin two ways (a drop, then the plugin's own handler) counts once. */
const replaysSeen = new Map<string, number>();
const REPLAY_SAME_MS = 10_000;

/**
 * Replays opened in the editor, one `replay.open` each: every `.rep` among `files`, `via`
 * how they came (`drop`, `open` for File ▸ Open, `pick` for a plugin's own file dialog).
 * Counted however they arrive, since a replay viewer may take them through its own panel.
 */
export function countReplays(files: readonly File[], via: string, now = Date.now()): void {
  for (const [key, at] of replaysSeen) if (now - at > REPLAY_SAME_MS) replaysSeen.delete(key);
  for (const f of files) {
    if (!/\.rep$/i.test(f.name)) continue;
    const key = `${f.name}\u0000${f.size}\u0000${f.lastModified}`;
    if (replaysSeen.has(key)) continue;
    replaysSeen.set(key, now);
    count("replay.open", { where: "editor", via });
  }
}

/** `pluginCountName` with the registries' lists. */
export const pluginName = (spec: string) => pluginCountName(spec, listed);

/**
 * One use of something a plugin added — a menu item, a context menu item, a hotkey, a map
 * button: the plugin, how it was reached, and which item (its English label or command id),
 * only for a plugin the project publishes.
 */
export function countPluginUse(plugin: { source: string }, via: string, item?: string): void {
  const name = pluginName(plugin.source);
  count("plugin.use", name === "other" || !item ? { plugin: name, via } : { plugin: name, via, item: item.slice(0, 100) });
}

/**
 * The game data in use, in a word: `none`, the files a build came with (`bundled`), or the
 * kind of copy kept in the browser (`copyKind`: `download`, `classic`, `remastered`, `mod`).
 */
export function gameDataOf(source: AssetSource | null): string {
  if (!source) return "unknown";
  return source.kind === "stored" && source.stored ? copyKind(source.stored) : source.kind;
}
