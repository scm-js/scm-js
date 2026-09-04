import { useEffect, useRef } from "react";
import { useStore } from "jotai";
import { desktopBridge } from "../gamedata/desktop";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { openDialogAtom, pushToastAtom } from "../atoms/uiAtoms";
import {
  checkForUpdatesAtom, lastUpdateCheckAtom, updateDownloadedAtom, updateFailedAtom, updateProgressAtom,
} from "../atoms/updateAtoms";
import { shouldCheckOnStart } from "../editor/updates";

/**
 * The desktop build's startup update check, and the one subscription to the updater's
 * events. Mounted once by `App`; a no-op in a browser, where there is nothing to update.
 *
 * Finding a new version raises a **toast**, not a dialog. A modal here would land seconds
 * after launch on top of whatever the user had already started, and it would have to queue
 * behind the two dialogs that already open themselves — Game Data when there is none, and
 * the Repair plugin on a map that needs it. The toast's Download opens the ordinary
 * `update` dialog, which is also what Help ▸ Check for Updates… opens, so there is one
 * screen with the progress bar rather than two.
 *
 * It is given no `ttl`: an update notice waits to be answered rather than expiring, and
 * that also means it cannot quietly time out behind the splash.
 */
const STARTUP_DELAY_MS = 5000;

export function useUpdateCheck() {
  const store = useStore();
  const ran = useRef(false);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;

    // Progress, completion and failure all arrive as events from the main process, whoever
    // started the download — so this is subscribed for the session, not per dialog.
    const offProgress = bridge.updates.onProgress((p) => store.set(updateProgressAtom, p));
    const offDone = bridge.updates.onDownloaded(() => store.set(updateDownloadedAtom));
    const offError = bridge.updates.onError((message) => store.set(updateFailedAtom, message));

    // React's dev double-mount would otherwise ask twice.
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!ran.current) {
      ran.current = true;
      const prefs = store.get(preferencesAtom);
      if (shouldCheckOnStart(prefs.updates.checkOnStart, store.get(lastUpdateCheckAtom), Date.now())) {
        // Late enough that the splash has gone and the game-data dialog has had its turn.
        timer = setTimeout(() => {
          void store.set(checkForUpdatesAtom, { nightly: prefs.updates.nightly }).then((state) => {
            if (state.phase !== "available") return;
            store.set(pushToastAtom, {
              kind: "info",
              title: `scmJS ${state.info.version} is available`,
              detail: `You have ${state.current}.`,
              ttl: 0,
              action: { label: "Download", run: () => store.set(openDialogAtom, "update") },
            });
          });
        }, STARTUP_DELAY_MS);
      }
    }

    return () => {
      clearTimeout(timer);
      offProgress();
      offDone();
      offError();
    };
  }, [store]);
}
