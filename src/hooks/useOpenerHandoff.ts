import { useEffect } from "react";
import { useStore } from "jotai";
import { pluginsStartedAtom } from "../atoms/pluginAtoms";
import { handFilesToPlugins } from "../plugins/fileTypes";
import { guardedAction, openFileInto } from "./useMapFileActions";
import type { MapFileHandle } from "../services/mapIo";

type Store = ReturnType<typeof useStore>;

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

/**
 * Files given to the editor from outside (the desktop's open-with, `scmjs … open`): once the plugins have started,
 * the ones a plugin claims (a replay) go to it, and the first of the rest opens as File ▸ Open would, through the
 * unsaved-changes gate.
 */
export async function openGivenFiles(store: Store, files: File[], handle: MapFileHandle | null = null): Promise<void> {
  if (!store.get(pluginsStartedAtom)) {
    await new Promise<void>((resolve) => {
      const stop = store.sub(pluginsStartedAtom, () => { if (store.get(pluginsStartedAtom)) { stop(); resolve(); } });
    });
  }
  const rest = handFilesToPlugins(store, files);
  const file = rest[0];
  if (!file) return;
  const own = file === files[0] ? handle : null;
  await guardedAction(store, () => openFileInto(store, file, own), (done) => ({ action: "open", file, handle: own, done }));
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
      void openGivenFiles(store, files).finally(() => opener.postMessage({ type: "scmjs.taken" }, e.origin));
    };
    window.addEventListener("message", onMessage);
    // (Nothing in it: any page may know the editor is ready, only a loopback one or the site's own is listened to.)
    opener.postMessage({ type: "scmjs.ready" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [store]);
}
