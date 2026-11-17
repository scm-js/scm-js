/**
 * A part of the editor that did not download, from wherever it was asked for.
 *
 * Vite's loader announces every failed `import()` of the build's chunks as a
 * `vite:preloadError` on the window, the error as its `payload`, before handing the
 * failure on to whoever asked — so this hears all of them in one place, and only listens:
 * the default is left alone, and the caller still fails and reports as it always did. The
 * dev server loads modules without that wrapper, so `DialogHost` also raises the notice for
 * a dialog's own chunk. Either way it is one notice (`services/chunkFailure.ts`).
 */
import { useEffect } from "react";
import { useStore } from "jotai";
import { isChunkLoadError } from "../app/chunks";
import { noticeChunkFailure } from "../services/chunkFailure";

export function useChunkFailures() {
  const store = useStore();
  useEffect(() => {
    const onFailure = (e: Event) => {
      if (isChunkLoadError((e as Event & { payload?: unknown }).payload)) noticeChunkFailure(store);
    };
    window.addEventListener("vite:preloadError", onFailure);
    return () => window.removeEventListener("vite:preloadError", onFailure);
  }, [store]);
}
