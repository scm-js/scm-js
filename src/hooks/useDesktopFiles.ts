import { useEffect } from "react";
import { useStore } from "jotai";
import { desktopBridge } from "../gamedata/desktop";
import { guardedAction, openFileInto } from "./useMapFileActions";
import { diskHandle } from "../services/diskFiles";

/**
 * The desktop build's "Open with": a map double-clicked in the file manager, dropped on
 * the app's icon, or named on the command line arrives from the main process as bytes
 * and its path (`desktop/main.ts`, `files.onOpen`) and opens the way File ▸ Open does — beside the open
 * map when Preferences allow several, else in its place through the same unsaved-changes
 * gate, so a modified map is asked about first. In a browser the bridge is absent and this
 * does nothing.
 */
export function useDesktopFiles() {
  const store = useStore();
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    return bridge.files.onOpen(({ name, path, bytes }) => {
      const file = new File([bytes as unknown as BlobPart], name);
      // With its path, so Save writes back in place and keeps a .bak (`services/diskFiles.ts`).
      const handle = diskHandle(path);
      void guardedAction(store, () => openFileInto(store, file, handle), (done) => ({ action: "open", file, handle, done }));
    });
  }, [store]);
}
