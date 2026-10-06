/**
 * Help ▸ What's New: the release notes in `docs/releases/`, as the editor reads them.
 *
 * The notes are the hand-written top of each GitHub release, kept as Markdown and bundled
 * with the build (`data/releaseNotes.ts`), so the dialog shows the notes of the build that
 * is running, offline, without asking GitHub anything. This module is the pure part: which
 * notes a build shows, when a new set is worth a notice, and a reader for the small part of
 * Markdown the notes are written in — headings, paragraphs, bullets one level deep, bold,
 * italic, code and links. It builds a tree for React to draw rather than HTML, so nothing
 * in a notes file is ever injected into the page.
 */

/** One set of notes: the release it belongs to and the Markdown as committed. */
export interface ReleaseNotes {
  version: string;
  markdown: string;
}

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "link"; url: string; children: Inline[] };

export interface ListItem {
  inline: Inline[];
  children: ListItem[];
}

export type Block =
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "list"; items: ListItem[] };

/** A `##` heading and what is under it; the text before the first heading has no title. */
export interface NotesSection {
  title: string | null;
  /** "For plugin authors": the part most map makers skip, which the dialog keeps folded. */
  forPluginAuthors: boolean;
  blocks: Block[];
}

/* ── Versions ───────────────────────────────────────────── */

/** `0.6.3-nightly.20261005.242` → `[0, 6, 3]`; a missing or unreadable part counts as 0. */
function core(version: string): number[] {
  const parts = version.split(/[-+]/)[0].split(".");
  return [0, 1, 2].map((i) => Number.parseInt(parts[i] ?? "0", 10) || 0);
}

/** Orders two versions by their release numbers alone; a nightly sorts with the release it is named for. */
export function compareVersions(a: string, b: string): number {
  const x = core(a), y = core(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** True for a build between releases (`0.6.3-nightly.…`), which has no notes of its own. */
export function isPrerelease(version: string): boolean {
  return version.includes("-");
}

/**
 * The notes a build opens on: the newest set no newer than the build itself. A release
 * finds its own; a nightly, named a patch above the last release, finds that release's;
 * a release cut with no notes file falls back to the one before it.
 */
export function notesVersionFor(appVersion: string, available: readonly string[]): string | null {
  let best: string | null = null;
  for (const v of available) {
    if (compareVersions(v, appVersion) > 0) continue;
    if (best === null || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

/**
 * Whether to raise the "what's new" notice. `seen` is the notes version last announced or
 * opened; with none remembered, only someone who has used the editor before (`returning`)
 * is told — a first visit has nothing to compare against.
 */
export function shouldAnnounce(seen: string | null, current: string | null, returning: boolean): boolean {
  if (!current) return false;
  if (!seen) return returning;
  return compareVersions(current, seen) > 0;
}

/* ── Markdown ───────────────────────────────────────────── */

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\*([^*\s](?:[^*]*[^*\s])?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Only a web address becomes a link; anything else stays the text it was written as. */
const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const push = (s: string) => {
    if (!s) return;
    const prev = out[out.length - 1];
    if (prev?.kind === "text") prev.text += s;
    else out.push({ kind: "text", text: s });
  };
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    push(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) out.push({ kind: "code", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "bold", children: parseInline(m[2]) });
    else if (m[3] !== undefined) out.push({ kind: "italic", children: parseInline(m[3]) });
    else if (isWebUrl(m[5])) out.push({ kind: "link", url: m[5], children: parseInline(m[4]) });
    else push(m[0]);
  }
  push(text.slice(last));
  return out;
}

const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*?)\s*#*$/;

/** Split a notes file into its sections. Wrapped lines are joined; a blank line ends a paragraph. */
export function parseNotes(markdown: string): NotesSection[] {
  const sections: NotesSection[] = [];
  let section: NotesSection = { title: null, forPluginAuthors: false, blocks: [] };
  let paragraph: string[] = [];
  /** The open list, and the text of its last item (top-level or nested) still being wrapped. */
  let list: { items: ListItem[]; top: string[]; nested: string[][] } | null = null;

  const closeItem = () => {
    if (!list || !list.top.length) return;
    list.items.push({
      inline: parseInline(list.top.join(" ")),
      children: list.nested.map((lines) => ({ inline: parseInline(lines.join(" ")), children: [] })),
    });
    list.top = [];
    list.nested = [];
  };
  const flush = () => {
    if (paragraph.length) section.blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join(" ")) });
    paragraph = [];
    closeItem();
    if (list?.items.length) section.blocks.push({ kind: "list", items: list.items });
    list = null;
  };
  const closeSection = () => {
    flush();
    if (section.title !== null || section.blocks.length) sections.push(section);
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    if (!line.trim()) {
      // A blank line ends a paragraph, but a list carries on across one.
      if (paragraph.length) flush();
    } else if (heading) {
      closeSection();
      const title = heading[1];
      section = { title, forPluginAuthors: /^for plugin authors\b/i.test(title), blocks: [] };
    } else if (bullet) {
      if (paragraph.length) flush();
      list ??= { items: [], top: [], nested: [] };
      if (bullet[1].length >= 2 && list.top.length) list.nested.push([bullet[2]]);
      else { closeItem(); list.top = [bullet[2]]; }
    } else if (list && /^\s/.test(line)) {
      // An indented line continues the item above it.
      (list.nested.length ? list.nested[list.nested.length - 1] : list.top).push(line.trim());
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  closeSection();
  return sections;
}
