import { useEffect, useRef } from "react";
import { useStore } from "jotai";
import { storedKeys } from "../atoms/storage";
import { openDialogAtom, pushToastAtom, whatsNewSeenAtom } from "../atoms/uiAtoms";
import { notesVersionFor, shouldAnnounce } from "../editor/releaseNotes";
import { APP_VERSION } from "../version";
import { t } from "../i18n";

/**
 * Tells someone the editor has changed since they last used it. The browser build updates
 * itself between visits and the desktop one restarts into a new version, and neither says
 * what is different — so the first launch on a release with notes newer than the last ones
 * seen raises a notice, once, whose button opens Help ▸ What's New.
 *
 * A **toast**, for the reasons the update check's is one (`useUpdateCheck`): it lands on
 * top of a session already under way, and the dialogs that open themselves at startup
 * would queue in front of a modal. It has no `ttl`, so it cannot expire behind the splash.
 *
 * What is remembered is the *notes'* version, not the build's: a nightly shows the last
 * release's notes, and comparing builds would announce the same notes every night. A first
 * visit — nothing remembered and nothing else stored — is recorded without a notice.
 */
const STARTUP_DELAY_MS = 5000;

export function useWhatsNew() {
  const store = useStore();
  const ran = useRef(false);

  useEffect(() => {
    // React's dev double-mount would otherwise announce twice.
    if (ran.current) return;
    ran.current = true;
    // Read now, before the plugins and the preload start writing their own keys.
    const returning = storedKeys().some((key) => key !== "scmjs.whatsNew");
    // Late enough that the splash has gone; the notes are a chunk of their own, fetched here.
    setTimeout(() => {
      void import("../data/releaseNotes").then(({ RELEASE_NOTES }) => {
        const current = notesVersionFor(APP_VERSION, RELEASE_NOTES.map((n) => n.version));
        if (!current) return;
        const seen = store.get(whatsNewSeenAtom);
        if (seen === current) return;
        store.set(whatsNewSeenAtom, current);
        if (!shouldAnnounce(seen, current, returning)) return;
        store.set(pushToastAtom, {
          kind: "info",
          title: t("scmJS has been updated"),
          detail: t("See what changed in {version}.", { version: current }),
          ttl: 0,
          action: { label: t("What's New"), run: () => store.set(openDialogAtom, "whatsNew") },
        });
      }).catch(() => { /* A chunk that will not load costs the notice, nothing else. */ });
    }, STARTUP_DELAY_MS);
  }, [store]);
}
