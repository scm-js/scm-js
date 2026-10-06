import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, scenarioName, serializeScenario, setScenarioName } from "../src/formats/chk/scenario";
import {
  activateDocumentAtom, activeDocumentIdAtom, archiveExtrasAtom, commitNoticeAtom, commitSettingsAtom, commitTriggersAtom, loadDocumentAtom, redoAtom, redoStackAtom, resizeDocumentAtom,
  scenarioAtom, triggersRevisionAtom, undoAtom, undoStackAtom,
} from "../src/atoms/documentAtoms";
import { mapNameAtom } from "../src/atoms/editorAtoms";
import { applyBriefing, applyTriggers, newAction, newTrigger, readTriggers } from "../src/editor/triggers";
import { applyForceSettings, applyPlayerSettings, readForceSettings, readPlayerSettings } from "../src/editor/settings";
import { ActionType } from "../src/formats/chk/sections/triggers";
import { locationName } from "../src/editor/locations";
import { Contributions, createPluginApi } from "../src/plugins/host";
import { startSync } from "../src/services/sync";
import type { SyncOp } from "../src/editor/sync";

type Store = ReturnType<typeof createStore>;

function open(name = "a") {
  const store = createStore();
  store.set(loadDocumentAtom, { scenario: createScenario({ width: 8, height: 6, era: 0, name }), extras: new Map(), fileName: null });
  return { store, scn: store.get(scenarioAtom)! };
}

const bytesOf = (store: Store) => Array.from(serializeScenario(store.get(scenarioAtom)!));

/** A trigger that can be told from another by its Wait. */
function waiting(ms: number) {
  const t = newTrigger();
  const a = newAction(ActionType.Wait);
  a.time = ms;
  t.actions.push(a);
  return t;
}

describe("undo for what the dialogs write", () => {
  it("takes a settings dialog's write back and puts it on again", () => {
    const { store, scn } = open("first");
    const before = bytesOf(store);

    setScenarioName(scn, "second");
    const players = readPlayerSettings(scn);
    players.races[0] = (players.races[0] + 1) % 3;
    applyPlayerSettings(scn, players);
    store.set(commitSettingsAtom);
    const after = bytesOf(store);
    expect(after).not.toEqual(before);
    expect(store.get(undoStackAtom).map((e) => e.label)).toEqual(["Edit settings"]);

    expect(store.set(undoAtom)).toBe("Edit settings");
    expect(scenarioName(scn)).toBe("first");
    expect(store.get(mapNameAtom)).toBe("first");
    expect(bytesOf(store)).toEqual(before);
    expect(store.get(commitNoticeAtom)).toMatchObject({ reason: "undo", label: "Edit settings", area: null, parts: { settings: true, triggers: false, terrain: false } });

    expect(store.set(redoAtom)).toBe("Edit settings");
    expect(store.get(mapNameAtom)).toBe("second");
    expect(bytesOf(store)).toEqual(after);
    expect(store.get(redoStackAtom)).toEqual([]);
  });

  it("survives a save: what undo puts back is written", () => {
    const { store, scn } = open();
    const forces = readForceSettings(scn);
    forces.names[0] = "Red team";
    applyForceSettings(scn, forces);
    store.set(commitSettingsAtom);
    // A save in between: every section clean again.
    scn.dirty.clear();
    store.set(undoAtom);
    const reread = parseScenario(serializeScenario(scn));
    expect(readForceSettings(reread).names[0]).not.toBe("Red team");
  });

  it("undoes trigger edits one OK at a time, and the briefing on its own", () => {
    const { store, scn } = open();
    const empty = bytesOf(store);
    applyTriggers(scn, [waiting(1), waiting(2)]);
    store.set(commitTriggersAtom);
    const two = bytesOf(store);
    applyTriggers(scn, [...readTriggers(scn), waiting(3)]);
    store.set(commitTriggersAtom);
    applyBriefing(scn, [newTrigger()]);
    store.set(commitTriggersAtom);
    expect(store.get(undoStackAtom).map((e) => e.label)).toEqual(["Edit triggers", "Edit triggers", "Edit mission briefing"]);

    const revision = store.get(triggersRevisionAtom);
    store.set(undoAtom);
    expect(scn.briefing).toHaveLength(0);
    expect(scn.triggers).toHaveLength(3);
    expect(store.get(triggersRevisionAtom)).toBeGreaterThan(revision);
    store.set(undoAtom);
    expect(bytesOf(store)).toEqual(two);
    store.set(undoAtom);
    expect(bytesOf(store)).toEqual(empty);
    store.set(redoAtom);
    store.set(redoAtom);
    expect(scn.triggers.map((t) => t.actions[0].time)).toEqual([1, 2, 3]);
  });

  it("shares the records an edit left alone between entries", () => {
    const { store, scn } = open();
    applyTriggers(scn, [waiting(1), waiting(2)]);
    store.set(commitTriggersAtom);
    // Insert at the top: every record moves, none changes.
    applyTriggers(scn, [waiting(0), ...readTriggers(scn)]);
    store.set(commitTriggersAtom);
    const [first, second] = store.get(undoStackAtom).map((e) => e.tables!.lists!.triggers!);
    expect(second.before).toBe(first.after);
    expect(second.after[1]).toBe(first.after[0]);
    expect(second.after[2]).toBe(first.after[1]);
  });

  it("records nothing for a commit that changed nothing, and one entry when both commits run", () => {
    const { store, scn } = open();
    store.set(commitSettingsAtom);
    store.set(commitTriggersAtom);
    expect(store.get(undoStackAtom)).toEqual([]);

    setScenarioName(scn, "both");
    applyTriggers(scn, [waiting(1)]);
    store.set(commitTriggersAtom, { notice: false, label: "Both" });
    store.set(commitSettingsAtom, { notice: false, label: "Both" });
    expect(store.get(undoStackAtom).map((e) => e.label)).toEqual(["Both"]);
    store.set(undoAtom);
    expect(scenarioName(scn)).toBe("a");
    expect(scn.triggers).toHaveLength(0);
  });

  it("keeps a location's name out of the next dialog's entry", () => {
    const { store, scn } = open();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    let slot = -1;
    api.document.edit("Location", (tx) => { slot = tx.addLocation({ left: 0, top: 0, right: 64, bottom: 64 }, "Base"); });
    api.document.update("Rename", (tx) => { tx.properties({ name: "renamed" }); });
    expect(api.document.history()).toMatchObject({ undo: "Rename", undoDepth: 2 });

    api.document.undo();
    expect(scenarioName(scn)).toBe("a");
    expect(locationName(scn, slot)).toBe("Base");
    api.document.undo();
    api.document.redo();
    api.document.redo();
    expect(scenarioName(scn)).toBe("renamed");
    expect(locationName(scn, slot)).toBe("Base");
  });

  it("puts a sound's file back with its slot", () => {
    const { store, scn } = open();
    const slots = () => (scn.wavs ?? []).filter((i) => i !== 0).length;
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const wav = new Uint8Array([1, 2, 3]);
    api.document.update("Add sound", (tx) => { tx.sounds.add("beep.wav", wav); });
    expect(store.get(archiveExtrasAtom).size).toBe(1);
    api.document.undo();
    expect(store.get(archiveExtrasAtom).size).toBe(0);
    expect(slots()).toBe(0);
    api.document.redo();
    expect([...store.get(archiveExtrasAtom).values()]).toEqual([wav]);
    expect(slots()).toBe(1);
  });

  it("goes with its map when another comes to the front", () => {
    const { store, scn } = open("one");
    const first = store.get(activeDocumentIdAtom)!;
    setScenarioName(scn, "one, renamed");
    store.set(commitSettingsAtom);
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 8, height: 6, era: 0, name: "two" }), extras: new Map(), fileName: null, into: "tab" });
    expect(store.get(undoStackAtom)).toEqual([]);
    setScenarioName(store.get(scenarioAtom)!, "two, renamed");
    store.set(commitSettingsAtom);

    store.set(activateDocumentAtom, first);
    store.set(undoAtom);
    expect(scenarioName(scn)).toBe("one");
    expect(store.get(mapNameAtom)).toBe("one");
  });

  it("drops the oldest steps when trigger edits hold too many records", () => {
    const { store, scn } = open();
    // Each run replaces 4,000 triggers of 64 actions: 256,000 rows it alone keeps alive, twice (both sides).
    const build = (seed: number) => Array.from({ length: 4000 }, (_, i) => {
      const t = newTrigger();
      for (let k = 0; k < 64; k++) { const a = newAction(ActionType.Wait); a.time = seed * 10000 + i; t.actions.push(a); }
      return t;
    });
    for (let run = 1; run <= 6; run++) {
      applyTriggers(scn, build(run));
      store.set(commitTriggersAtom);
    }
    const stack = store.get(undoStackAtom);
    expect(stack.length).toBeLessThan(6);
    expect(stack.length).toBeGreaterThanOrEqual(1);
    // What is left still undoes in order.
    store.set(undoAtom);
    expect(scn.triggers[0].actions[0].time).toBe(50000);
  });

  it("starts again after a resize, which drops the history", () => {
    const { store, scn } = open();
    setScenarioName(scn, "before the resize");
    store.set(commitSettingsAtom);
    store.set(resizeDocumentAtom, { width: 10, height: 6, anchor: 4, clampLocations: true });
    expect(store.get(undoStackAtom)).toEqual([]);
    applyTriggers(scn, [waiting(1)]);
    store.set(commitTriggersAtom);
    store.set(undoAtom);
    expect(scenarioName(scn)).toBe("before the resize");
    expect(scn.triggers).toHaveLength(0);
  });
});

describe("undoing a dialog on a shared map", () => {
  const bytes = serializeScenario(createScenario({ width: 16, height: 12, era: 0, name: "shared" }));

  function room() {
    const log: { from: number; op: SyncOp }[] = [];
    const editors = [0, 1].map((i) => {
      const store = createStore();
      store.set(loadDocumentAtom, { scenario: parseScenario(bytes), extras: new Map(), fileName: "shared.scx" });
      const session = startSync(store, { send: (op) => log.push({ from: i, op: JSON.parse(JSON.stringify(op)) }) })!;
      return { store, session, cursor: 0 };
    });
    const flush = () => {
      for (const [i, e] of editors.entries()) {
        while (e.cursor < log.length) {
          const m = log[e.cursor++];
          if (m.from === i) e.session.confirm();
          else e.session.receive(m.op);
        }
      }
    };
    const same = () => {
      const [a, b] = editors.map((e) => Array.from(serializeScenario(e.store.get(scenarioAtom)!)));
      return a.length === b.length && a.every((v, i) => v === b[i]);
    };
    return { editors, flush, same };
  }

  it("reaches the other editor", () => {
    const { editors: [a, b], flush, same } = room();
    applyTriggers(a.store.get(scenarioAtom)!, [waiting(1)]);
    a.store.set(commitTriggersAtom);
    flush();
    expect(b.store.get(scenarioAtom)!.triggers).toHaveLength(1);
    a.store.set(undoAtom);
    flush();
    expect(b.store.get(scenarioAtom)!.triggers).toHaveLength(0);
    expect(same()).toBe(true);
    a.store.set(redoAtom);
    flush();
    expect(b.store.get(scenarioAtom)!.triggers).toHaveLength(1);
    expect(same()).toBe(true);
  });

  it("leaves a table someone else has written since", () => {
    const { editors: [a, b], flush, same } = room();
    applyTriggers(a.store.get(scenarioAtom)!, [waiting(1)]);
    a.store.set(commitTriggersAtom);
    flush();
    // The other person's OK comes after: theirs is the newer write.
    applyTriggers(b.store.get(scenarioAtom)!, [waiting(1), waiting(2)]);
    b.store.set(commitTriggersAtom);
    flush();
    expect(b.store.get(undoStackAtom)).toHaveLength(1);

    a.store.set(undoAtom);
    flush();
    expect(a.store.get(scenarioAtom)!.triggers).toHaveLength(2);
    expect(b.store.get(scenarioAtom)!.triggers).toHaveLength(2);
    expect(same()).toBe(true);
    // Their own entry still undoes their own write.
    b.store.set(undoAtom);
    flush();
    expect(a.store.get(scenarioAtom)!.triggers).toHaveLength(1);
    expect(same()).toBe(true);
  });
});
