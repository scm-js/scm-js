import { useEffect } from "react";
import { useStore } from "jotai";
import type { Store } from "../atoms/store";
import { openGivenFiles, saveDocument } from "../services/documentActions";
import { takeInbox } from "../services/inbox";

/** The pages that may hand the editor files: one on this machine's loopback address (`scmjs map open`). */
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
/** …or a page of the editor's own site (scmjs.dev/play hands over a game it saved as a replay). */
const mayHandOver = (origin: string) => LOOPBACK.test(origin) || origin === window.location.origin;

/**
 * Whether this page was opened to be handed a file: read once, as the page loads (the effect takes `?handoff` out of
 * the address, and runs twice in development), and the hand-over taken once.
 */
const HANDOFF = typeof window !== "undefined" && new URL(window.location.href).searchParams.has("handoff");
let handedOver = false;
/** …or to take a file a page of its own site left for it (`services/inbox.ts`): read once, the same way. */
const INBOX = typeof window !== "undefined" && new URL(window.location.href).searchParams.has("inbox");
let inboxTaken = false;

/**
 * A map handed over to stay linked (services/editorLink.ts, loaded only now): it opens with a handle that writes
 * through the link, and from then on the page's `scmjs.link` messages are the command's requests. The page hears
 * `linked` beside `scmjs.taken` when the link holds; when the open was refused (a plugin took the file, the person
 * kept the map they had), the map is not linked and the page is told so.
 */
async function openLinked(store: Store, opener: Window, origin: string, file: File): Promise<void> {
  const { createEditorLink } = await import("../services/editorLink");
  const link = createEditorLink(store, { post: (m, transfer) => opener.postMessage(m, origin, transfer ?? []) }, file.name, saveDocument);
  const onLink = (e: MessageEvent) => {
    if (e.source !== opener || e.origin !== origin) return;
    const type = (e.data as { type?: unknown } | null)?.type;
    if (type === "scmjs.link" || type === "scmjs.link.reply") link.receive(e.data);
  };
  window.addEventListener("message", onLink);
  // The page reloading or closing ends the link; the command hears it at once instead of waiting for silence.
  window.addEventListener("pagehide", () => link.end("closed"));
  try { await openGivenFiles(store, [file], link.handle); } catch { /* said by the open itself */ }
  const linked = link.attach();
  if (!linked) { link.end("not opened"); window.removeEventListener("message", onLink); }
  opener.postMessage({ type: "scmjs.taken", linked: linked ? "yes" : "no" }, origin);
}

/**
 * `scmjs map open` / `scmjs replay open` in a browser (cli/src/open.ts): the command serves a page on the loopback
 * address that opens the editor with `?handoff`; the editor says it is ready, the page posts it the file, and the
 * editor opens it as a dropped file. The site's play page does the same with a game saved as a replay ("Analyse in
 * the Editor"), from the editor's own origin. Only the page that opened this window is listened to.
 */
export function useOpenerHandoff() {
  const store = useStore();
  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener || !HANDOFF || handedOver) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("handoff")) { url.searchParams.delete("handoff"); window.history.replaceState(window.history.state, "", url); }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== opener || !mayHandOver(e.origin)) return;
      const data = e.data as { type?: string; files?: { name?: unknown; bytes?: unknown }[] } | null;
      if (data?.type !== "scmjs.open" || !Array.isArray(data.files)) return;
      const files = data.files
        .filter((f) => typeof f.name === "string" && f.bytes instanceof Uint8Array)
        .map((f) => new File([f.bytes as BlobPart], (f.name as string).replace(/[\\/]/g, "_")));
      if (!files.length || handedOver) return;
      handedOver = true;
      window.removeEventListener("message", onMessage);
      // `scmjs map open --live`: the page stays on the other end, and the map is linked to the command through it.
      if ((data as { link?: unknown }).link === true && LOOPBACK.test(e.origin)) { void openLinked(store, opener, e.origin, files[0]); return; }
      void openGivenFiles(store, files).finally(() => opener.postMessage({ type: "scmjs.taken" }, e.origin));
    };
    window.addEventListener("message", onMessage);
    // (Nothing in it: any page may know the editor is ready, only a loopback one or the site's own is listened to.)
    opener.postMessage({ type: "scmjs.ready" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [store]);

  // The site's inbox: a map or a replay dropped on a page of the site, which left it in the browser's
  // file storage and came here. Opened as a dropped file, in this tab.
  useEffect(() => {
    if (!INBOX || inboxTaken) return;
    inboxTaken = true;
    const url = new URL(window.location.href);
    if (url.searchParams.has("inbox")) { url.searchParams.delete("inbox"); window.history.replaceState(window.history.state, "", url); }
    void takeInbox("editor").then((files) => { if (files) void openGivenFiles(store, files); });
  }, [store]);
}
