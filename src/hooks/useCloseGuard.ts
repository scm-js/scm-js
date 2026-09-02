import { useEffect, useRef } from "react";
import { useAtomValue, useStore } from "jotai";
import { scenarioAtom } from "../atoms/documentAtoms";
import { mapModifiedAtom } from "../atoms/editorAtoms";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { desktopBridge } from "../gamedata/desktop";
import { guardedAction } from "./useMapFileActions";

/**
 * Leaving the editor altogether — the tab's × , the window's, Alt+F4, Cmd+Q — with a map that
 * has unsaved changes. Both halves are gated on the same `confirmClose` preference and the same
 * three facts as `needsCloseConfirm`, so File ▸ Close and closing the app ask on the same terms.
 *
 * In a **browser** all that is on offer is `beforeunload`: the page cannot show its own dialog
 * there, cannot save first, and cannot even choose the wording — it can only say "ask", and the
 * browser prints its own generic question. The listener is added and removed with the unsaved
 * state rather than left on, so a clean document leaves the page's back/forward cache eligible.
 *
 * The **desktop** build can do the real thing: the main process holds the close back and asks
 * here (`desktop/main.ts#guardClose`), and this opens the editor's own Close Scenario dialog —
 * so Save writes the file through the ordinary path (Save As when the map has no file yet) and
 * Cancel keeps the window. `respondClose` carries the answer back; a dismissal reaches it as
 * false through `guardedAction`'s dialog-stack watch. Electron fires `beforeunload` on a window
 * close too, but returning a value there cancels it *silently* — which is why the browser half
 * is skipped whenever the bridge is there.
 */
export function useCloseGuard() {
  const store = useStore();
  const modified = useAtomValue(mapModifiedAtom);
  const scenario = useAtomValue(scenarioAtom);
  const { confirmClose } = useAtomValue(preferencesAtom);
  const ask = confirmClose && modified && scenario !== null;
  const asking = useRef(false);

  useEffect(() => {
    const bridge = desktopBridge();
    if (bridge) { bridge.window.setDirty(ask); return; }
    if (!ask) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => { window.removeEventListener("beforeunload", guard); };
  }, [ask]);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    return bridge.window.onCloseRequest(() => {
      // A second press of the close button while the dialog is up is not a second question.
      if (asking.current) return;
      asking.current = true;
      void guardedAction(store, async () => true, (done) => ({ action: "quit", done })).then((quit) => {
        asking.current = false;
        bridge.window.respondClose(quit);
      });
    });
  }, [store]);
}
