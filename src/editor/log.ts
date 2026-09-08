/**
 * The editor's own log: a ring buffer of what happened, for the times a user has to say
 * what went wrong.
 *
 * Before this, everything the editor knew about a misbehaving session went to
 * `console.error` — behind a key most map makers never press — or to a toast that expired
 * before it was read. `plugins/failures.ts` exists because silence was the bug for one
 * narrow case; this is the general answer, and the panel over it (View ▸ Debug Console)
 * is what a user copies into a bug report.
 *
 * **It records whether the panel is open or not.** The weird thing has already happened
 * by the time anyone thinks to look, so a log that starts when the window opens can only
 * ever catch a second occurrence — and the interesting ones do not repeat. What is always
 * recorded is cheap: map opens and saves, plugin activations, transactions, and every
 * error the page throws — tens of lines in a session, not thousands. The chatty tier
 * (every plugin API call, `setVerbose`) is off until someone is actually hunting.
 *
 * Two rules for anything that writes here, both learned the hard way in other editors:
 *
 * - **Counts, not payloads.** An entry holds flat scalars. Logging an edit's `changes`
 *   array would pin thousands of cell records for as long as the ring holds the entry and
 *   quietly defeat GC — the buffer is bounded in *entries*, so it can only be bounded in
 *   memory if entries are small. `data` is typed to scalars to make that hard to get wrong.
 * - **User intent, not the inner loop.** One line per stroke, never per tile; nothing on
 *   the paint path, the pointer path, or inside a transaction's cell writes.
 *
 * Pure — no atoms, no store, importable from anywhere including module scope. The panel
 * subscribes; `atoms/logAtoms.ts` is the store side.
 */

export type LogLevel = "info" | "warn" | "error";

/** Small, flat facts about one entry. Never a reference to editor state — see the note above. */
export type LogData = Record<string, string | number | boolean | null | undefined>;

export interface LogEntry {
  /** Monotonic and never reused, so the panel can key rows by it. */
  seq: number;
  /** Milliseconds since the log started (page load). Not a wall clock: a shared log should not carry one. */
  at: number;
  level: LogLevel;
  /** Who is speaking: `app`, `document`, `edit`, `plugins`, `gamedata`, or a plugin's name. */
  source: string;
  message: string;
  data?: LogData;
  /** An error's stack, when there was one. The only long string an entry may hold. */
  stack?: string;
  /**
   * How many times this line has been recorded lately (absent for the usual one). A menu's
   * `enabled` predicate asks `document.isOpen()` every time the menu is drawn, and five
   * plugins asking in turn is five lines a frame: a verbose minute would be nothing but
   * those, and the ring would evict what the reader opened it for. So an identical line
   * within `COLLAPSE_MS` bumps the one already there instead of taking a slot — not only
   * when it is the newest, since the flood is usually a round-robin rather than a loop.
   */
  repeat?: number;
}

/**
 * Entries kept. 2000 × a couple of hundred bytes is well under a megabyte, and holds a
 * long session of the always-on tier or a few minutes of verbose tracing — which is the
 * span that matters, since verbose is switched on to catch something about to happen.
 */
export const LOG_CAPACITY = 2000;

/** Subscribers are told at most this often, however fast the writes come. */
const NOTIFY_MS = 100;

/**
 * How long after a line was first recorded an identical one folds into it instead of taking
 * a slot. Long enough to swallow a redraw storm, short enough that a flood which really is
 * continuous still shows as a line a second rather than a single count with no shape.
 */
const COLLAPSE_MS = 1000;

/** Distinct lines watched for a repeat. Beyond this the oldest are forgotten, not searched. */
const COLLAPSE_WATCHED = 64;

const ring: (LogEntry | undefined)[] = Array.from({ length: LOG_CAPACITY });
let count = 0;
let seq = 0;
let dropped = 0;
let verbose = false;
let started = Date.now();

/** The lines open to being repeated into, newest last, keyed by everything but the time. */
const recent = new Map<string, LogEntry>();

const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Coalesced: a burst of writes wakes the panel once. Re-rendering a few hundred rows per
 * entry costs far more than the buffer ever does, and verbose tracing writes in bursts.
 */
function notify(): void {
  if (notifyTimer !== null || listeners.size === 0) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const fn of listeners) {
      try { fn(); } catch { /* a listener's failure is not the log's problem */ }
    }
  }, NOTIFY_MS);
}

/** Subscribe to (coalesced) writes. Returns the unsubscribe. */
export function subscribeLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Whether the chatty tier is recording. Callers on a hot path check this before building a message. */
export function isVerbose(): boolean {
  return verbose;
}

export function setVerbose(on: boolean): void {
  if (verbose === on) return;
  verbose = on;
  log("info", "app", on ? "Verbose logging on" : "Verbose logging off");
}

/**
 * Record one entry. Cheap enough to call unconditionally on the always-on tier; the
 * verbose tier must gate itself on `isVerbose()` so it does not build the message either.
 */
export function log(level: LogLevel, source: string, message: string, data?: LogData, stack?: string): void {
  const entry: LogEntry = { seq: ++seq, at: Date.now() - started, level, source, message };
  if (data) {
    // Undefined values are dropped rather than printed, so a caller can pass an optional
    // fact without a conditional at every call site.
    const kept: LogData = {};
    let any = false;
    for (const k in data) if (data[k] !== undefined) { kept[k] = data[k]; any = true; }
    if (any) entry.data = kept;
  }
  if (stack) entry.stack = stack;

  // Warnings and errors keep going to the browser's console as well: this buffer is for
  // the user who cannot open one, and it should not take anything away from the developer
  // who can — a stack there is clickable and one in a text log is not. `info` is not
  // mirrored; the always-on tier would fill a real console with the editor's own chatter.
  // Above the collapse below, so a console still sees every occurrence, as it always has.
  if (level !== "info") console[level](`[${source}] ${message}`, ...(data ? [data] : []), ...(stack ? [stack] : []));

  const key = lineKey(entry);
  const seen = recent.get(key);
  // Still in the ring, and still inside the window.
  if (seen && entry.at - seen.at < COLLAPSE_MS && ring[(seen.seq - 1) % LOG_CAPACITY] === seen) {
    // The time stays the first sighting's, so the list reads in order however much collapses
    // into it; a flood that outlasts the window simply starts another line with its own count.
    seen.repeat = (seen.repeat ?? 1) + 1;
    seq--;
    notify();
    return;
  }

  if (recent.size >= COLLAPSE_WATCHED) recent.delete(recent.keys().next().value!);
  recent.delete(key);
  recent.set(key, entry);

  if (count >= LOG_CAPACITY) dropped++;
  ring[(seq - 1) % LOG_CAPACITY] = entry;
  count = Math.min(count + 1, LOG_CAPACITY);
  notify();
}

/** Everything about a line but its time, as one string — two lines with the same key are the same line. */
function lineKey(e: LogEntry): string {
  return `${e.level}\u0000${e.source}\u0000${e.message}\u0000${e.data ? formatData(e.data) : ""}\u0000${e.stack ?? ""}`;
}

export const logInfo = (source: string, message: string, data?: LogData) => log("info", source, message, data);
export const logWarn = (source: string, message: string, data?: LogData) => log("warn", source, message, data);

/**
 * An error, from an `Error` or from whatever was actually thrown. The message goes on the
 * entry and the stack beside it, so the panel can stay one line a row and the copy can
 * carry the part that identifies the bug.
 */
export function logError(source: string, message: string, err?: unknown, data?: LogData): void {
  const detail = err === undefined ? "" : err instanceof Error ? err.message : String(err);
  const text = detail && !message.includes(detail) ? `${message}: ${detail}` : message;
  log("error", source, text, data, err instanceof Error ? err.stack : undefined);
}

/** Everything held, oldest first. A fresh array; the ring is not exposed. */
export function logEntries(): LogEntry[] {
  const out: LogEntry[] = [];
  const first = seq - count;
  for (let i = 0; i < count; i++) {
    const e = ring[(first + i) % LOG_CAPACITY];
    if (e) out.push(e);
  }
  return out;
}

/** How many entries the ring has overwritten, so a copy can say the log is not the whole session. */
export function logDropped(): number {
  return dropped;
}

/** Start again — Clear in the panel, before reproducing something. */
export function clearLog(): void {
  ring.fill(undefined);
  recent.clear();
  count = 0;
  dropped = 0;
  started = Date.now();
  notify();
}

/** Tests only: the module is a singleton and each case wants its own. */
export function resetLogForTests(): void {
  clearLog();
  seq = 0;
  verbose = false;
  listeners.clear();
  if (notifyTimer !== null) { clearTimeout(notifyTimer); notifyTimer = null; }
}

/* ── Rendering ──────────────────────────────────────────── */

/** `12.345` — seconds since the log started, which is what a reader needs to see gaps and bursts. */
export function stamp(at: number): string {
  return (at / 1000).toFixed(3).padStart(8, " ");
}

/** `key=value key=value`, for the panel's second line and for the text copy. */
export function formatData(data: LogData | undefined): string {
  if (!data) return "";
  return Object.entries(data)
    .map(([k, v]) => `${k}=${typeof v === "string" && /[\s=]/.test(v) ? JSON.stringify(v) : String(v)}`)
    .join(" ");
}

export function formatEntry(e: LogEntry): string {
  const level = e.level === "info" ? " " : e.level === "warn" ? "!" : "×";
  const data = formatData(e.data);
  return `${stamp(e.at)} ${level} ${e.source}: ${e.message}${data ? `  ${data}` : ""}${e.repeat ? ` ×${e.repeat}` : ""}`;
}

/**
 * Characters of entries Help ▸ Copy Bug Report will put on the clipboard, the header not
 * counted. A GitHub issue body is capped at 65536 characters and a paste over that is
 * rejected rather than trimmed, so an unbounded copy of a bad session — 2000 entries with
 * twelve stack lines under some of them — is a report that cannot be filed at all. The
 * always-on tier writes tens of lines a session, so in practice this cuts nothing; it
 * bites on a verbose session or an error flood, which are also the sessions where the tail
 * is the part worth reading. Debug Console ▸ Save… stays uncapped for those.
 */
export const BUG_REPORT_BUDGET = 48_000;

const PATHY = /^[([<]*(?:[a-z][a-z\d+.-]*:\/\/|[a-z]:[\\/]|[\\/])/i;

/**
 * One stack frame with the directories taken out of it, keeping the file, the line and the
 * column: `at draw (file:///C:/Users/someone/…/dist/index.js:12:5)` becomes
 * `at draw (index.js:12:5)`. A stack is the one long string an entry holds and the one
 * place a user's own name can still reach a shared log — `baseName` covers the map file
 * and `shortAgent` the browser, and this is the third door. Done here rather than at
 * capture, so the console mirror keeps the clickable path a developer needs.
 */
export function scrubFrame(line: string): string {
  return line.replace(/\S*[\\/]\S*/g, (run) => {
    // A lone slash between two words is arithmetic or prose, not a path; two of them, or a
    // scheme or a drive letter in front, is one. `bad ratio 3/4` survives, `a/b/c` does not.
    if (!PATHY.test(run) && (run.match(/[\\/]/g) ?? []).length < 2) return run;
    const open = (/^[([<]*/.exec(run) ?? [""])[0];
    const close = (/[)\]>]*$/.exec(run) ?? [""])[0];
    const parts = run.slice(open.length, run.length - close.length).split(/[\\/]/).filter(Boolean);
    const last = parts[parts.length - 1];
    return last ? `${open}${last}${close}` : run;
  });
}

/**
 * The whole log as text, with a header above it. This is what Copy and Save produce, and
 * it is meant to be pasted into a bug report as it stands — plain, one line an entry,
 * stacks indented under theirs.
 *
 * `budget` caps the *entries* at that many characters, keeping the newest and saying how
 * many it left out; the header is never cut, since it is the half of a report that answers
 * most questions. Without one the copy is the whole buffer.
 */
export function formatLog(entries: readonly LogEntry[], header = "", droppedCount = 0, budget = Infinity): string {
  // Render newest first into a budget, then turn it back the right way round: the tail is
  // what a reader wants, and an entry costs what its stack costs, which is not knowable
  // from the count.
  const body: string[] = [];
  let used = 0;
  let cut = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const block = [formatEntry(e)];
    if (e.stack) for (const line of e.stack.split("\n").slice(0, 12)) block.push(`         ${scrubFrame(line.trim())}`);
    const size = block.reduce((n, l) => n + l.length + 1, 0);
    // Always keep one entry, however big: a copy with nothing in it helps no one.
    if (used + size > budget && body.length > 0) { cut = i + 1; break; }
    used += size;
    for (let j = block.length - 1; j >= 0; j--) body.push(block[j]);
  }
  body.reverse();

  const lines: string[] = [];
  if (header) lines.push(header, "");
  const omitted = droppedCount + cut;
  if (omitted > 0) {
    lines.push(
      cut > 0
        ? `… ${omitted} earlier ${omitted === 1 ? "entry" : "entries"} left out — View ▸ Debug Console ▸ Save… writes the whole log`
        : `… ${omitted} earlier ${omitted === 1 ? "entry" : "entries"} dropped (the log keeps the last ${LOG_CAPACITY})`,
      "",
    );
  }
  lines.push(...body);
  return `${lines.join("\n")}\n`;
}

/**
 * A file's name without the folders in front of it. Desktop paths carry the user's own
 * name, and a log is written to be shared; nothing here needs the rest of the path.
 */
export function baseName(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const cut = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return cut[cut.length - 1] || undefined;
}
