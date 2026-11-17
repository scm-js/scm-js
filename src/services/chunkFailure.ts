/**
 * The notice for a part of the editor that did not download (`app/chunks.ts`).
 *
 * Whatever needed the chunk has already failed in its own way — a dialog closes, a panel
 * shows its error. This says why and what to do about it, once however many chunks fail,
 * and stays until it is closed: nothing that needs a missing chunk works again until the
 * page is reloaded.
 */
import type { Store } from "../atoms/store";
import { pushToastAtom, toastsAtom } from "../atoms/uiAtoms";
import { t } from "../i18n";
import { writeCopiesNow } from "./recoveryCopier";

/** The notice on screen, so a second failure does not stack another. */
let showing: number | null = null;

export function noticeChunkFailure(store: Store): void {
  if (showing !== null && store.get(toastsAtom).some((toast) => toast.id === showing)) return;
  showing = store.set(pushToastAtom, {
    kind: "error",
    title: t("Part of the editor could not be downloaded"),
    detail: t("This page may be older than the editor on the site now, or the connection dropped. Reload to bring it up to date."),
    ttl: 0,
    action: {
      label: t("Reload"),
      // The recovery copies brought up to date first, so a map with unsaved changes is
      // offered back after the reload even when the browser does not ask about it.
      run: () => { void writeCopiesNow(store).catch(() => 0).finally(() => window.location.reload()); },
    },
  });
}
