import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pluginsStartedAtom } from "../src/atoms/pluginAtoms";
import { closeDialogAtom, dialogStackAtom, openDialogAtom } from "../src/atoms/uiAtoms";
import { offerGameDataWhenClear, PLUGIN_WAIT_MS } from "../src/hooks/usePreload";

const ids = (store: ReturnType<typeof createStore>) => store.get(dialogStackAtom).map((d) => d.id);

describe("the Game Data offer at startup", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("opens at once when the plugins have started and nothing else is open", () => {
    const store = createStore();
    store.set(pluginsStartedAtom, true);
    offerGameDataWhenClear(store, () => true);
    expect(ids(store)).toEqual(["gameData"]);
  });

  it("waits for the plugins, and for what they opened (a shared map's Join) to close", () => {
    const store = createStore();
    offerGameDataWhenClear(store, () => true);
    expect(ids(store)).toEqual([]);
    store.set(openDialogAtom, "pluginDialog"); // the plugin opens Join as it starts
    store.set(pluginsStartedAtom, true);
    expect(ids(store)).toEqual(["pluginDialog"]);
    store.set(closeDialogAtom);
    expect(ids(store)).toEqual(["gameData"]);
    // Once only.
    store.set(closeDialogAtom);
    store.set(openDialogAtom, "mapProperties");
    store.set(closeDialogAtom);
    vi.advanceTimersByTime(PLUGIN_WAIT_MS * 2);
    expect(ids(store)).toEqual([]);
  });

  it("stops waiting for plugins that never finish starting", () => {
    const store = createStore();
    offerGameDataWhenClear(store, () => true);
    vi.advanceTimersByTime(PLUGIN_WAIT_MS - 1);
    expect(ids(store)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ids(store)).toEqual(["gameData"]);
  });

  it("does not open when the data arrived while it waited", () => {
    const store = createStore();
    let missing = true;
    store.set(openDialogAtom, "pluginDialog");
    store.set(pluginsStartedAtom, true);
    offerGameDataWhenClear(store, () => missing);
    missing = false;
    store.set(closeDialogAtom);
    expect(ids(store)).toEqual([]);
  });
});
