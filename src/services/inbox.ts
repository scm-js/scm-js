/**
 * The site's inbox: a file a page of the editor's own site leaves for it before sending the
 * browser here, so a map or a replay dropped on scmjs.dev's home page opens in this tab.
 *
 * The other way a page hands the editor a file is the opener's (`useOpenerHandoff`): it opens
 * the editor in a new tab and posts the file to it. A browser lets only a click open a tab, so
 * a dropped file could not be passed on without one more press. Pages of one origin share the
 * browser's private file storage, so the site writes the file there instead, then goes to the
 * editor at `?inbox`, which reads it and empties the inbox.
 *
 * In the storage's root, the folder `scmjs-inbox`: `meta.json` and the files' bytes as `0`,
 * `1`, … in the order `meta.json` lists their names. The play page reads the same folder for
 * what is left for it (`target: "play"`): the site's `open.js`, scm-sim's `web/inbox.ts` and
 * this file are three hands on one format, so change them together.
 */
export const INBOX_DIR = "scmjs-inbox";

/** How long a left file waits. Longer than any page load; short enough that a stale one is never opened by a kept address. */
export const INBOX_KEEPS_MS = 10 * 60 * 1000;

export interface InboxMeta {
  /** Who it is for: "editor" or "play". */
  target: string;
  /** When it was left, in milliseconds since the epoch. */
  at: number;
  /** The files' names, in the order of the bytes beside this file. */
  files: { name: string }[];
}

/** What `meta.json` holds, when it is for `target` and was left recently; null otherwise. */
export function inboxFor(meta: unknown, target: string, now: number): InboxMeta | null {
  const m = meta as Partial<InboxMeta> | null;
  if (!m || typeof m !== "object" || m.target !== target || typeof m.at !== "number" || !Array.isArray(m.files)) return null;
  if (now - m.at > INBOX_KEEPS_MS || m.at - now > INBOX_KEEPS_MS) return null;
  const files = m.files.filter((f) => f && typeof f.name === "string" && f.name).map((f) => ({ name: f.name.replace(/[\\/]/g, "_") }));
  return files.length ? { target, at: m.at, files } : null;
}

/**
 * The files left for `target`, taken: read, and the inbox emptied. Null when there is nothing
 * for it (no storage, no inbox, one meant for the other page, or one left too long ago).
 */
export async function takeInbox(target: string): Promise<File[] | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(INBOX_DIR);
    const meta = inboxFor(JSON.parse(await (await (await dir.getFileHandle("meta.json")).getFile()).text()), target, Date.now());
    if (!meta) return null;
    const files: File[] = [];
    for (let i = 0; i < meta.files.length; i++) {
      const bytes = await (await (await dir.getFileHandle(String(i))).getFile()).arrayBuffer();
      files.push(new File([bytes], meta.files[i].name));
    }
    await root.removeEntry(INBOX_DIR, { recursive: true }).catch(() => {});
    return files;
  } catch {
    return null;
  }
}
