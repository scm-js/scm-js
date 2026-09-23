import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, serializeScenario } from "../src/formats/chk/scenario";
import {
  archiveExtrasAtom, closeDocumentAtom, commitEditAtom, isomRevisionAtom, commitSettingsAtom, loadDocumentAtom, redoAtom, redoStackAtom, resizeDocumentAtom, scenarioAtom, syncTapAtom,
  undoAtom, undoStackAtom,
} from "../src/atoms/documentAtoms";
import { mapModifiedAtom, mapNameAtom, mapPointerHeldAtom, mapWidthAtom, selectedUnitsAtom } from "../src/atoms/editorAtoms";
import { closeDialogAtom, openDialogAtom } from "../src/atoms/uiAtoms";
import { applyEntry, type HistoryEntry } from "../src/editor/history";
import { makeUnit } from "../src/editor/units";
import { setScenarioName } from "../src/formats/chk/scenario";
import { startSync, type SyncSession } from "../src/services/sync";
import type { SyncOp } from "../src/editor/sync";
import { loadMap } from "../src/formats/mpq/scm";

const bytes = serializeScenario(createScenario({ width: 16, height: 12, era: 0, name: "shared" }));

/** Two editors with the same map open, joined through a server that orders their ops. */
function room() {
  const log: { from: number; op: SyncOp }[] = [];
  const editors = [0, 1].map((i) => {
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: parseScenario(bytes), extras: new Map(), fileName: "shared.scx" });
    const session = startSync(store, { send: (op) => log.push({ from: i, op: JSON.parse(JSON.stringify(op)) }) })!;
    return { store, session, cursor: 0 };
  });
  /** Hand every editor what the server has for it. */
  const flush = () => {
    for (const [i, e] of editors.entries()) {
      while (e.cursor < log.length) {
        const m = log[e.cursor++];
        if (m.from === i) e.session.confirm();
        else e.session.receive(m.op);
      }
    }
  };
  const edit = (store: ReturnType<typeof createStore>, entry: HistoryEntry) => {
    applyEntry(store.get(scenarioAtom)!, entry, "do");
    store.set(commitEditAtom, entry);
  };
  const same = () => {
    const [a, b] = editors.map((e) => serializeScenario(e.store.get(scenarioAtom)!));
    return a.length === b.length && a.every((v, i) => v === b[i]);
  };
  return { log, editors, flush, edit, same };
}

describe("a shared map's session", () => {
  it("sends each edit and applies the other editor's", () => {
    const { editors: [a, b], flush, edit, same, log } = room();
    edit(a.store, { label: "Paint", changes: [{ at: 3, before: 0, after: 77 }] });
    edit(b.store, { label: "Place", changes: [], units: [{ index: 0, before: null, after: makeUnit(null, 0, 0, 64, 64, 1) }] });
    expect(log.map((m) => m.op.kind)).toEqual(["edit", "edit"]);
    flush();
    expect(same()).toBe(true);
    expect(b.store.get(scenarioAtom)!.tiles[3]).toBe(77);
    expect(a.store.get(scenarioAtom)!.units).toHaveLength(1);
    expect(a.session.pending()).toBe(0);
    expect(a.store.get(mapModifiedAtom)).toBe(true);
  });

  it("holds other people's edits while a stroke is under way, and applies them when it ends", () => {
    const { editors: [a, b], flush, edit, same } = room();
    b.store.set(mapPointerHeldAtom, true);
    edit(a.store, { label: "Paint", changes: [{ at: 5, before: 0, after: 9 }] });
    flush();
    expect(b.session.holding()).toBe("stroke");
    expect(b.session.waiting()).toBe(1);
    expect(b.store.get(scenarioAtom)!.tiles[5]).toBe(0);
    // B's own stroke commits on mouse-up, before the hold lifts.
    edit(b.store, { label: "Paint", changes: [{ at: 5, before: 0, after: 11 }] });
    b.store.set(mapPointerHeldAtom, false);
    expect(b.session.waiting()).toBe(0);
    flush();
    expect(same()).toBe(true);
    // The server had A's first: B's later stroke wins the cell.
    expect(a.store.get(scenarioAtom)!.tiles[5]).toBe(11);
  });

  it("holds while a dialog that edits the map is open", () => {
    const { editors: [a, b], flush, edit } = room();
    const key = b.store.set(openDialogAtom, "unitProperties");
    edit(a.store, { label: "Paint", changes: [{ at: 1, before: 0, after: 4 }] });
    flush();
    expect(b.session.holding()).toBe("dialog");
    b.store.set(closeDialogAtom, key);
    expect(b.store.get(scenarioAtom)!.tiles[1]).toBe(4);
  });

  it("undoes by content on a shared map, and keeps someone else's newer paint", () => {
    const { editors: [a, b], flush, edit, same } = room();
    edit(a.store, { label: "Paint", changes: [{ at: 2, before: 0, after: 5 }, { at: 3, before: 0, after: 5 }] });
    flush();
    edit(b.store, { label: "Paint", changes: [{ at: 3, before: 5, after: 8 }] });
    flush();
    a.store.set(undoAtom);
    flush();
    expect(same()).toBe(true);
    const tiles = a.store.get(scenarioAtom)!.tiles;
    expect([tiles[2], tiles[3]]).toEqual([0, 8]);
    expect(a.store.get(redoStackAtom)).toHaveLength(1);
    a.store.set(redoAtom);
    flush();
    expect(same()).toBe(true);
    expect(b.store.get(scenarioAtom)!.tiles[2]).toBe(5);
    expect(a.store.get(undoStackAtom)).toHaveLength(1);
  });

  it("keeps a unit selected when another editor's insertion moves it down the list", () => {
    const { editors: [a, b], flush, edit } = room();
    edit(a.store, { label: "Place", changes: [], units: [{ index: 0, before: null, after: makeUnit(null, 0, 0, 64, 64, 1) }] });
    flush();
    a.store.set(selectedUnitsAtom, [0]);
    edit(b.store, { label: "Place", changes: [], units: [{ index: 0, before: null, after: makeUnit(null, 1, 0, 96, 96, 2) }] });
    flush();
    expect(a.store.get(selectedUnitsAtom)).toEqual([1]);
    expect(a.store.get(scenarioAtom)!.units[1].serial).toBe(1);
  });

  it("carries a settings dialog's write and the name the chrome shows", () => {
    const { editors: [a, b], flush, same } = room();
    setScenarioName(a.store.get(scenarioAtom)!, "Renamed");
    a.store.set(commitSettingsAtom);
    flush();
    expect(same()).toBe(true);
    expect(b.store.get(mapNameAtom)).toBe("Renamed");
  });

  it("carries a resize as the whole document, and archive files as files", () => {
    const { editors: [a, b], flush, same } = room();
    a.store.set(resizeDocumentAtom, { width: 20, height: 12, anchor: 4, clampLocations: true });
    a.store.set(archiveExtrasAtom, new Map([["staredit\\wav\\hi.wav", new Uint8Array([1, 2, 3])]]));
    flush();
    expect(same()).toBe(true);
    expect(b.store.get(mapWidthAtom)).toBe(20);
    expect([...b.store.get(archiveExtrasAtom).keys()]).toEqual(["staredit\\wav\\hi.wav"]);
  });

  it("ends when the shared map is closed, and stops hooking the store", () => {
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: parseScenario(bytes), extras: new Map(), fileName: "x.scx" });
    let ended = "";
    const s: SyncSession = startSync(store, { send: () => {}, onEnd: (r) => { ended = r; } })!;
    expect(startSync(store, { send: () => {} })).toBeNull();
    store.set(closeDocumentAtom);
    expect(ended).toBe("closed");
    expect(store.get(syncTapAtom)).toBeNull();
    expect(s.receive({ kind: "edit", label: "", width: 16, height: 12 })).toBe(false);
  });

  it("copies the map for someone joining only when nothing is pending, as of that moment", async () => {
    const { editors: [a], edit, flush } = room();
    edit(a.store, { label: "Paint", changes: [{ at: 0, before: 0, after: 42 }] });
    expect(await a.session.snapshot()).toBeNull();
    flush();
    const copy = a.session.snapshot();
    // A change after the call is not in the copy.
    edit(a.store, { label: "Paint", changes: [{ at: 1, before: 0, after: 43 }] });
    const bytes = await copy;
    expect(bytes).not.toBeNull();
    const scenario = parseScenario((await loadMap(bytes!)).chk);
    expect([scenario.tiles[0], scenario.tiles[1]]).toEqual([42, 0]);
  });

  it("keeps what the commit reads from an entry after sending it", () => {
    const { editors: [a] } = room();
    const scn = a.store.get(scenarioAtom)!;
    const entry: HistoryEntry = { label: "Rebuild ISOM", changes: [], isom: [{ at: 0, before: scn.isom![0], after: 7 }], rebuiltIsom: true };
    applyEntry(scn, entry, "do");
    const before = a.store.get(isomRevisionAtom);
    a.store.set(commitEditAtom, entry);
    expect(entry.rebuiltIsom).toBe(true);
    expect(a.store.get(isomRevisionAtom)).toBe(before + 1);
  });

  it("refuses what is not an op", () => {
    const { editors: [a] } = room();
    expect(a.session.receive({ kind: "edit", terrain: "x" })).toBe(false);
    expect(a.session.waiting()).toBe(0);
  });
});
