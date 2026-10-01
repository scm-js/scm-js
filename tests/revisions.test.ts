import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import {
  commitEditAtom, loadDocumentAtom, objectEditRevisionAtom, redoAtom, scenarioAtom, terrainRevisionAtom, undoAtom, unitsRevisionAtom,
} from "../src/atoms/documentAtoms";
import { applyEntry, type HistoryEntry } from "../src/editor/history";
import { addUnits, makeUnit } from "../src/editor/units";

function open() {
  const store = createStore();
  store.set(loadDocumentAtom, { scenario: createScenario({ width: 8, height: 6, era: 0, name: "a" }), extras: new Map(), fileName: null });
  return store;
}

/** Apply and record an entry the way a tool does. */
function commit(store: ReturnType<typeof createStore>, entry: HistoryEntry) {
  applyEntry(store.get(scenarioAtom)!, entry, "do");
  store.set(commitEditAtom, entry);
}

describe("which revision an edit moves", () => {
  it("leaves the terrain revision alone for an edit of units only, through undo and redo too", () => {
    const store = open();
    const scn = store.get(scenarioAtom)!;
    const terrain = store.get(terrainRevisionAtom), units = store.get(unitsRevisionAtom), objects = store.get(objectEditRevisionAtom);

    commit(store, { label: "Place", changes: [], units: addUnits(scn, [makeUnit(null, 0, 0, 48, 48, 1)]) });
    expect(scn.units).toHaveLength(1);
    expect(store.get(terrainRevisionAtom)).toBe(terrain);
    expect(store.get(unitsRevisionAtom)).toBe(units + 1);
    expect(store.get(objectEditRevisionAtom)).toBe(objects + 1);

    store.set(undoAtom);
    expect(scn.units).toHaveLength(0);
    store.set(redoAtom);
    expect(scn.units).toHaveLength(1);
    expect(store.get(terrainRevisionAtom)).toBe(terrain);
    expect(store.get(unitsRevisionAtom)).toBe(units + 3);
    expect(store.get(objectEditRevisionAtom)).toBe(objects + 3);
  });

  it("moves the terrain revision, and only it, for a tile edit", () => {
    const store = open();
    const scn = store.get(scenarioAtom)!;
    const terrain = store.get(terrainRevisionAtom), objects = store.get(objectEditRevisionAtom);

    commit(store, { label: "Paint", changes: [{ at: 3, before: scn.tiles[3], after: scn.tiles[3] ^ 16 }] });
    store.set(undoAtom);
    expect(store.get(terrainRevisionAtom)).toBe(terrain + 2);
    expect(store.get(objectEditRevisionAtom)).toBe(objects);
  });
});
