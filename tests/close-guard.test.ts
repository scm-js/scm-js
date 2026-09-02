import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { scenarioAtom } from "../src/atoms/documentAtoms";
import { mapModifiedAtom } from "../src/atoms/editorAtoms";
import { preferencesAtom } from "../src/atoms/preferencesAtoms";
import { closeDialogAtom, dialogStackAtom } from "../src/atoms/uiAtoms";
import { guardedAction, needsCloseConfirm, type PendingAction } from "../src/hooks/useMapFileActions";

/** A store with a map open, modified, and the preference on: what `useCloseGuard` guards. */
function dirtyStore() {
  const store = createStore();
  store.set(scenarioAtom, createScenario({ width: 8, height: 6, era: 0, name: "p" }));
  store.set(mapModifiedAtom, true);
  store.set(preferencesAtom, { ...store.get(preferencesAtom), confirmClose: true });
  return store;
}

/** The quit half of the pending action — what the desktop's close button and Cmd+Q go through. */
const quit = (done: (ok: boolean) => void): PendingAction => ({ action: "quit", done });

describe("close guard", () => {
  it("lets a clean map, an unmodified one and a switched-off preference go without asking", async () => {
    const store = dirtyStore();
    store.set(mapModifiedAtom, false);
    expect(needsCloseConfirm(store)).toBe(false);
    expect(await guardedAction(store, async () => true, quit)).toBe(true);

    store.set(mapModifiedAtom, true);
    store.set(preferencesAtom, { ...store.get(preferencesAtom), confirmClose: false });
    expect(await guardedAction(store, async () => true, quit)).toBe(true);

    store.set(preferencesAtom, { ...store.get(preferencesAtom), confirmClose: true });
    store.set(scenarioAtom, null);
    expect(await guardedAction(store, async () => true, quit)).toBe(true);
    expect(store.get(dialogStackAtom)).toEqual([]);
  });

  it("asks about a modified map and answers false when the dialog is dismissed", async () => {
    const store = dirtyStore();
    const asked = guardedAction(store, async () => true, quit);
    const entry = store.get(dialogStackAtom).find((d) => d.id === "confirmClose");
    expect((entry?.payload?.pending as PendingAction | undefined)?.action).toBe("quit");

    // Cancel / Escape / the ×: the entry leaves the stack untaken, so the window stays open.
    store.set(closeDialogAtom, entry!.key);
    expect(await asked).toBe(false);

    // Don't Save (or a successful Save): the dialog marks it taken, then `runPending` answers.
    const again = guardedAction(store, async () => true, quit);
    const entry2 = store.get(dialogStackAtom).find((d) => d.id === "confirmClose")!;
    const pending = entry2.payload!.pending as PendingAction & { action: "quit" };
    pending.taken = true;
    store.set(closeDialogAtom, entry2.key);
    pending.done!(true);
    expect(await again).toBe(true);
  });
});
