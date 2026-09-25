/**
 * Recovery copies: which maps are copied and when their copies go (the pure plan), which
 * copies count as left over, and the store half — a copy written for a modified map, not
 * rewritten while it is unchanged, dropped on save, and opened back as an unsaved map.
 * Node has no IndexedDB, so the copies here are the memory stand-in's.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { documentsAtom, loadDocumentAtom, scenarioAtom, terrainRevisionAtom } from "../src/atoms/documentAtoms";
import { mapFilePathAtom, mapModifiedAtom } from "../src/atoms/editorAtoms";
import { DEFAULT_PREFERENCES, preferencesAtom } from "../src/atoms/preferencesAtoms";
import { createScenario } from "../src/formats/chk/create";
import { markDirty, scenarioName, setScenarioName } from "../src/formats/chk/scenario";
import { leftoverCopies, planRecovery } from "../src/editor/recovery";
import { listCopies, putCopy, removeCopy, SESSION, type RecoveryRecord } from "../src/services/recovery";
import { leftoverEntries, RecoveryCopier, restoreCopy } from "../src/hooks/useRecovery";
import { serializeScenario } from "../src/formats/chk/scenario";

afterEach(async () => {
  for (const r of await listCopies()) await removeCopy(r.key);
});

describe("the plan", () => {
  it("copies a modified map that changed, or has no copy yet", () => {
    const plan = planRecovery([{ id: 1, modified: true, changed: true }, { id: 2, modified: true, changed: false }, { id: 3, modified: false, changed: true }], new Set([2]), true);
    expect(plan).toEqual({ write: [1], remove: [] });
    expect(planRecovery([{ id: 2, modified: true, changed: false }], new Set(), true).write).toEqual([2]);
  });

  it("drops the copy of a map saved, closed, or with copies switched off", () => {
    expect(planRecovery([{ id: 1, modified: false, changed: false }], new Set([1]), true).remove).toEqual([1]);
    expect(planRecovery([], new Set([4]), true).remove).toEqual([4]);
    expect(planRecovery([{ id: 1, modified: true, changed: true }], new Set([1]), false)).toEqual({ write: [], remove: [1] });
  });

  it("offers only the copies of sessions that are not running, newest first", () => {
    const records = [{ session: "me", at: 5 }, { session: "old", at: 1 }, { session: "other-window", at: 9 }, { session: "older", at: 3 }];
    expect(leftoverCopies(records, "me", new Set(["me", "other-window"])).map((r) => r.session)).toEqual(["older", "old"]);
    // A browser without Web Locks cannot tell a running window from an ended one.
    expect(leftoverCopies(records, "me", null).map((r) => r.session)).toEqual(["other-window", "older", "old"]);
  });
});

function openMap(store: ReturnType<typeof createStore>, name = "Recover me") {
  const scenario = createScenario({ width: 16, height: 16, era: 0, name });
  store.set(loadDocumentAtom, { scenario, extras: new Map([["staredit\\wav\\a.wav", new Uint8Array([1, 2, 3])]]), fileName: "recover.scx" });
  return scenario;
}

/** An edit as far as the copier can see: the tiles changed and the map is marked. */
function edit(store: ReturnType<typeof createStore>) {
  const scn = store.get(scenarioAtom)!;
  scn.tiles[0] = 7;
  markDirty(scn, "MTXM");
  store.set(mapModifiedAtom, true);
  store.set(terrainRevisionAtom, store.get(terrainRevisionAtom) + 1);
}

describe("the copier", () => {
  it("copies a modified map once, and not again until it changes", async () => {
    const store = createStore();
    const c = new RecoveryCopier(store);
    openMap(store);
    await c.flush();
    expect(await listCopies()).toHaveLength(0);

    edit(store);
    c.markFront();
    await c.flush();
    const [first] = await listCopies();
    expect(first.session).toBe(SESSION);
    expect(first.fileName).toBe("recover.scx");
    expect(first.extras.get("staredit\\wav\\a.wav")).toEqual(new Uint8Array([1, 2, 3]));

    await c.flush();
    expect((await listCopies())[0]).toBe(first);

    edit(store);
    c.markFront();
    await c.flush();
    expect((await listCopies())[0]).not.toBe(first);
  });

  it("drops the copy when the map is saved, and when copies are switched off", async () => {
    const store = createStore();
    const c = new RecoveryCopier(store);
    openMap(store);
    edit(store);
    c.markFront();
    await c.flush();
    expect(await listCopies()).toHaveLength(1);
    store.set(mapModifiedAtom, false);
    await c.flush(true);
    expect(await listCopies()).toHaveLength(0);

    edit(store);
    c.markFront();
    await c.flush();
    store.set(preferencesAtom, { ...DEFAULT_PREFERENCES, recovery: { enabled: false, minutes: 2 } });
    await c.flush();
    expect(await listCopies()).toHaveLength(0);
  });

  it("copies a parked map too, and forgets a closed one", async () => {
    const store = createStore();
    const c = new RecoveryCopier(store);
    openMap(store, "First");
    edit(store);
    c.markFront();
    const second = createScenario({ width: 16, height: 16, era: 0, name: "Second" });
    store.set(loadDocumentAtom, { scenario: second, extras: new Map(), fileName: null, into: "tab" });
    await c.flush();
    const copies = await listCopies();
    expect(copies.map((r) => r.name)).toEqual(["First"]);
    // Close the parked one by dropping its slot, as closing it after switching would.
    store.set(documentsAtom, store.get(documentsAtom).filter((d) => d.parked === null));
    await c.flush(true);
    expect(await listCopies()).toHaveLength(0);
  });
});

describe("coming back", () => {
  it("opens an earlier session's copy as an unsaved map, and drops the copy", async () => {
    const scn = createScenario({ width: 16, height: 16, era: 0, name: "Lost work" });
    setScenarioName(scn, "Lost work, edited");
    const record: RecoveryRecord = {
      key: "old:1", session: "old", docId: 1, at: Date.now() - 60_000, name: "Lost work, edited", fileName: "lost.scx", width: 16, height: 16, tileset: "badlands",
      size: 0, chk: serializeScenario(scn), extras: new Map(), stored: null, origin: null, builtBy: null, saveOptions: null, handle: null,
    };
    await putCopy(record);
    expect((await leftoverEntries()).map((e) => e.key)).toEqual(["old:1"]);

    const store = createStore();
    expect(await restoreCopy(store, "old:1")).toBe(true);
    expect(scenarioName(store.get(scenarioAtom)!)).toBe("Lost work, edited");
    expect(store.get(mapModifiedAtom)).toBe(true);
    expect(store.get(mapFilePathAtom)).toBe("lost.scx");
    expect(await leftoverEntries()).toHaveLength(0);
    expect(await restoreCopy(store, "old:1")).toBe(false);
  });
});
