import { describe, expect, it, vi } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { scenarioAtom } from "../src/atoms/documentAtoms";
import { preferencesAtom } from "../src/atoms/preferencesAtoms";
import { pluginTestTargetsAtom, type PluginTestTargetEntry } from "../src/atoms/pluginAtoms";
import { dialogStackAtom, statusMessageAtom, toastsAtom } from "../src/atoms/uiAtoms";
import { Contributions, createPluginApi } from "../src/plugins/host";
import type { TestMapFile, TestTargetSpec } from "../src/plugins/api";
import { resolveTarget, startTest, STARCRAFT } from "../src/services/testTargets";

function storeWithMap() {
  const store = createStore();
  store.set(scenarioAtom, createScenario({ width: 64, height: 64, era: 0, name: "Target practice" }));
  return store;
}

const entry = (id: string): PluginTestTargetEntry => ({ key: id.length, plugin: { id, name: id, source: "s" }, spec: { label: id, menuLabel: `Test in ${id}`, run: () => {} } });

const choose = (store: ReturnType<typeof createStore>, target: string) =>
  store.set(preferencesAtom, { ...store.get(preferencesAtom), testMap: { ...store.get(preferencesAtom).testMap, target } });

describe("where Test Map sends the map", () => {
  it("picks StarCraft, a named plugin's target, or by default the first plugin target there is", () => {
    const a = entry("scm-sim"), b = entry("other");
    expect(resolveTarget("", [])).toBeNull();
    expect(resolveTarget("", [a, b])).toBe(a);
    expect(resolveTarget(STARCRAFT, [a, b])).toBeNull();
    expect(resolveTarget("other", [a, b])).toBe(b);
    // A plugin turned off since it was chosen: StarCraft, not the other plugin.
    expect(resolveTarget("gone", [a, b])).toBeNull();
  });

  it("keeps one target per plugin and takes it back with the plugin", () => {
    const store = createStore();
    const bag = new Contributions();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, bag);
    api.ui.testTarget({ label: "One", menuLabel: "Test in One", run: () => {} });
    api.ui.testTarget({ label: "Two", menuLabel: "Test in Two", run: () => {} });
    expect(store.get(pluginTestTargetsAtom).map((e) => [e.plugin.id, e.spec.label])).toEqual([["t", "Two"]]);
    bag.dispose();
    expect(store.get(pluginTestTargetsAtom)).toEqual([]);
  });

  it("opens the Test Map dialog for StarCraft", () => {
    const store = storeWithMap();
    startTest(store);
    expect(store.get(dialogStackAtom).map((d) => [d.id, d.payload])).toEqual([["testMap", { run: true }]]);
  });

  it("runs a plugin's target inside the call, before the map is built, and hands it the map as Save writes it", async () => {
    const store = storeWithMap();
    let handed: Promise<TestMapFile | null> | null = null;
    const run = vi.fn((map: Promise<TestMapFile | null>) => { handed = map; return Promise.resolve("Playing it"); });
    const bag = new Contributions();
    createPluginApi(store, { id: "scm-sim", name: "scm-sim", source: "s" }, bag).ui.testTarget({ label: "This browser", menuLabel: "Test in Browser", run } satisfies TestTargetSpec);
    startTest(store);
    // Called before anything was awaited: a tab can still be opened from the click.
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.get(dialogStackAtom)).toEqual([]);
    const map = await handed!;
    expect(map?.name).toBe("Target practice.scx");
    // An MPQ archive: "MPQ\x1A", whatever comes before it.
    expect(new TextDecoder("latin1").decode(map!.bytes)).toContain("MPQ\x1a");
    await Promise.resolve();
    expect(store.get(statusMessageAtom)).toBe("Playing it");
    // StarCraft stays one choice away.
    choose(store, STARCRAFT);
    startTest(store);
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.get(dialogStackAtom).map((d) => d.id)).toEqual(["testMap"]);
    bag.dispose();
  });

  it("tells the user why a target did not start, and runs nothing without a map", async () => {
    const store = storeWithMap();
    const bag = new Contributions();
    const run = vi.fn(async () => { throw new Error("Pop-ups are blocked"); });
    createPluginApi(store, { id: "scm-sim", name: "scm-sim", source: "s" }, bag).ui.testTarget({ label: "This browser", menuLabel: "Test in Browser", run });
    startTest(store, "scm-sim");
    await vi.waitFor(() => expect(store.get(toastsAtom).map((t) => [t.kind, t.detail])).toEqual([["error", "This browser: Pop-ups are blocked"]]));
    store.set(scenarioAtom, null);
    startTest(store, "scm-sim");
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.get(statusMessageAtom)).toBe("Open or create a map first.");
    bag.dispose();
  });
});
