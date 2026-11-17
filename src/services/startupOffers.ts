import { pluginsStartedAtom } from "../atoms/pluginAtoms";
import type { Store } from "../atoms/store";
import { dialogStackAtom, openDialogAtom } from "../atoms/uiAtoms";

/** How long the offer waits for the plugins to start before it stops waiting for them. */
export const PLUGIN_WAIT_MS = 5000;

/**
 * Open the Game Data dialog once the plugins have started and no other dialog is open.
 * A dialog up by then is there for a reason the user came with — a shared map's Join,
 * a copy link's Open a Copy, both opened by the scmjs.dev plugin as it starts — and
 * stacking Game Data on it (or under it) hid one behind the other, in an order that
 * depended on which finished first; after it closes, the offer follows over whatever it
 * opened. Waiting for the plugins is capped at `PLUGIN_WAIT_MS`, so one stuck on the
 * network cannot hold the offer back. `stillNeeded` is asked at the moment of opening,
 * so data installed meanwhile (Help ▸ Game Data…) cancels it.
 */
export function offerGameDataWhenClear(store: Store, stillNeeded: () => boolean, waitMs = PLUGIN_WAIT_MS): void {
  whenDialogsClear(store, () => { if (stillNeeded()) store.set(openDialogAtom, "gameData", { auto: true }); }, waitMs);
}

/**
 * Run `open` once the plugins have started (or `waitMs` has passed) and no dialog is open —
 * the rule every dialog the editor raises by itself at start follows, so two of them (Game
 * Data, Recover Maps) come one after the other rather than stacked.
 */
export function whenDialogsClear(store: Store, open: () => void, waitMs = PLUGIN_WAIT_MS): void {
  let waited = false;
  let done = false;
  const unsubs: (() => void)[] = [];
  const timer = setTimeout(() => { waited = true; offer(); }, waitMs);
  function offer() {
    if (done) return;
    if (!store.get(pluginsStartedAtom) && !waited) return;
    if (store.get(dialogStackAtom).length > 0) return;
    done = true;
    clearTimeout(timer);
    for (const u of unsubs) u();
    open();
  }
  unsubs.push(store.sub(dialogStackAtom, offer), store.sub(pluginsStartedAtom, offer));
  offer();
}
