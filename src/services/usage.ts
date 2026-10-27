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

const lineKey = (name: string, props: CountProps | undefined) =>
  props ? `${name}\u0000${JSON.stringify(Object.entries(props).sort(([a], [b]) => (a < b ? -1 : 1)))}` : name;

/** Count one use of `name`. The props are a few words from fixed lists, never the user's text. */
export function count(name: string, props?: CountProps): void {
  if (!hosted || !on) return;
  const key = lineKey(name, props);
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
  moduleSources.clear();
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

/* ── Errors ─────────────────────────────────────────────── */

/** Frames an error line carries, from where it was thrown outwards, and the characters of each. */
const STACK_FRAMES = 6;
const FRAME_CHARS = 90;
/**
 * Error lines with frames waiting at once; past this an error is counted without them. The
 * site's script sends up to 20 lines a request and the worker refuses a request over 16 KB,
 * which would lose the other counts with it: six lines of frames are about 4 KB.
 */
const MAX_STACKS_WAITING = 6;

/** Where each plugin module's `blob:` URL was fetched from, so a frame in it can say which file. */
const moduleSources = new Map<string, string>();

/** The plugin loader made `moduleUrl` from the file at `sourceUrl`. */
export function noteModuleSource(moduleUrl: string, sourceUrl: string): void {
  moduleSources.set(moduleUrl, sourceUrl);
}

const CHROME_FRAME = /^\s+at (?:async )?(?:new )?(?:(.+?) \()?(\S+):(\d+):(\d+)\)?$/;
const OTHER_FRAME = /^(.*?)@(\S+):(\d+):(\d+)$/;
const CODE_NAME = /^[A-Za-z_$][\w$.]{0,47}$/;
const OWN_PLUGIN_FILE = /^https:\/\/raw\.githubusercontent\.com\/scm-js\/([\w.-]+)\/([^/]+)\/(.+)$/;

/**
 * The file a frame ran in, as the counts name it: a path of the editor's own (`editor/assets/
 * index-….js`, which the release's source maps turn back into the source), a file of a plugin
 * the project publishes (`plugin-trigscript@v4.1.0/src/build.ts`), or `plugin` / `other` for
 * anything else — a plugin installed from someone's own address, a browser extension.
 */
function frameFile(url: string): string | null {
  const source = moduleSources.get(url);
  const own = source ? OWN_PLUGIN_FILE.exec(source) : null;
  if (own) return `${own[1].toLowerCase()}@${own[2].slice(0, 12)}/${own[3]}`;
  if (source || url.startsWith("blob:")) return null;
  try {
    const u = new URL(url);
    if (typeof location !== "undefined" && u.origin === location.origin) return u.pathname.slice(1);
  } catch { /* not an address */ }
  return null;
}

/** One frame, or `plugin` / `other` for code that is not the project's, with neither its name nor its place. */
function frameOf(name: string | undefined, url: string, line: string, col: string): string {
  const file = frameFile(url);
  if (!file) return url.startsWith("blob:") ? "plugin" : "other";
  const at = `${file}:${line}:${col}`;
  const named = name && CODE_NAME.test(name) ? `${name} ${at}` : at;
  return named.length <= FRAME_CHARS ? named : at.slice(-FRAME_CHARS);
}

/** Frames of a render error's line kept for the components it threw inside, at most. */
const COMPONENT_FRAMES = 3;

/** Up to `max` frames of one stack, in either browser's form. */
function framesOf(stack: string, max: number): string[] {
  const lines = stack.split("\n");
  const chrome = lines.some((l) => /^\s+at /.test(l));
  const frames: string[] = [];
  for (const l of lines) {
    if (frames.length >= max) break;
    const m = chrome ? CHROME_FRAME.exec(l) : OTHER_FRAME.exec(l.trim());
    if (!m) continue;
    const f = frameOf(m[1], m[2], m[3], m[4]);
    if (f !== frames[frames.length - 1]) frames.push(f);
  }
  return frames;
}

/**
 * An error's stack as props, `frame0` (where it was thrown) to `frame5`: the function's name
 * when it is a plain identifier, and the file, line and column. Never the error's message,
 * which can carry a file name or a map's text, and nothing of code that is not the project's.
 * A frame in the same place as the one before (`other` after `other`) is left out.
 *
 * `components` is React's component stack for a render error. Its own stack is React's
 * internals from top to bottom — a node removed from the wrong parent says nothing of which
 * panel — so up to three of the frames go to the components, innermost first, marked `in`.
 */
export function stackProps(stack: string, components?: string): CountProps | null {
  const inside = components
    ? framesOf(components, COMPONENT_FRAMES).map((f) => (f.length <= FRAME_CHARS - 3 ? `in ${f}` : `in ${f.slice(3 - FRAME_CHARS)}`))
    : [];
  const frames = [...framesOf(stack, STACK_FRAMES - inside.length), ...inside];
  return frames.length ? Object.fromEntries(frames.map((f, i) => [`frame${i}`, f])) : null;
}

/**
 * Whether the browser is translating the page. Its translator rewrites text React owns —
 * Chrome's marks `<html>` and wraps the text in `<font>`, Edge's tags the elements — and React
 * then fails to remove a node that is no longer where it put it (`NotFoundError`).
 */
function pageTranslated(): boolean {
  if (typeof document === "undefined") return false;
  const html = document.documentElement;
  return html.classList.contains("translated-ltr") || html.classList.contains("translated-rtl")
    || document.querySelector("#root font, #root [_msttexthash]") !== null;
}

/**
 * One error: where (`props`, from fixed lists), whether the page was being translated, and,
 * while few are waiting, the frames of `stack` (and of `components`, for a render error).
 */
export function countError(props: CountProps, stack?: string, components?: string): void {
  if (pageTranslated()) props = { ...props, translated: true };
  const frames = stack || components ? stackProps(stack ?? "", components) : null;
  if (frames) {
    const full = { ...props, ...frames };
    const stacks = [...waiting.values()].filter((l) => l.name === "error" && l.props && "frame0" in l.props).length;
    if (waiting.has(lineKey("error", full)) || stacks < MAX_STACKS_WAITING) return count("error", full);
  }
  count("error", props);
}

/** An error's kind (`TypeError`, `PluginLoadError`), as long as it is a plain identifier. */
export function errorKind(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  return /^[A-Za-z_$][\w$]{0,39}$/.test(err.name) ? err.name : "other";
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
