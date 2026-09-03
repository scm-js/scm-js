import { useEffect } from "react";
import { useStore } from "jotai";
import { desktopBridge } from "../gamedata/desktop";
import { guardedAction, openFileInto } from "./useMapFileActions";

/**
 * The desktop build's "Open with": a map double-clicked in the file manager, dropped on
 * the app's icon, or named on the command line arrives from the main process as bytes
 * (`desktop/main.ts`, `files.onOpen`) and opens the way File ▸ Open does — through the
 * same unsaved-changes gate, so a modified map is asked about first. In a browser the
 * bridge is absent and this does nothing.
 */
export function useDesktopFiles() {
  const store = useStore();
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    return bridge.files.onOpen(({ name, bytes }) => {
      const file = new File([bytes as unknown as BlobPart], name);
      void guardedAction(store, () => openFileInto(store, file, null), (done) => ({ action: "open", file, handle: null, done }));
    });
  }, [store]);
}
