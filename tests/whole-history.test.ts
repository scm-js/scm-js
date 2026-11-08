import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, serializeScenario, setScenarioName, tilesetIndex } from "../src/formats/chk/scenario";
import {
  changeTilesetAtom, commitEditAtom, commitNoticeAtom, commitSettingsAtom, loadDocumentAtom, redoAtom, redoStackAtom,
  resizeDocumentAtom, scenarioAtom, undoAtom, undoStackAtom,
} from "../src/atoms/documentAtoms";
import { mapHeightAtom, mapTilesetAtom, mapWidthAtom } from "../src/atoms/editorAtoms";
import { applyChanges } from "../src/editor/terrain";
import { applyUnitChanges, makeUnit } from "../src/editor/units";
import { startSync } from "../src/services/sync";
import type { HistoryEntry } from "../src/editor/history";

type Store = ReturnType<typeof createStore>;

function open() {
  const store = createStore();
  store.set(loadDocumentAtom, { scenario: createScenario({ width: 16, height: 12, era: 0, name: "whole" }), extras: new Map(), fileName: null });
  return { store, scn: store.get(scenarioAtom)! };
}

const bytesOf = (store: Store) => Array.from(serializeScenario(store.get(scenarioAtom)!));

/** Paint one tile and place one unit, as a stroke and a click would, each its own step. */
function edit(store: Store, tile: number, x: number) {
  const scn = store.get(scenarioAtom)!;
  const paint: HistoryEntry = { label: "Paint", changes: [{ at: tile, before: scn.tiles[tile], after: 0x1234 }] };
  applyChanges(scn, paint.changes, "do");
  store.set(commitEditAtom, paint);
  const units = [{ index: scn.units.length, before: null, after: makeUnit(null, 0, 0, x, 64, 100 + x) }];
  applyUnitChanges(scn, units);
  store.set(commitEditAtom, { label: "Place unit", changes: [], units });
}

describe("Resize and Change Tileset are undo steps", () => {
  it("takes a resize back to the byte, with the edits on either side of it", () => {
    const { store, scn } = open();
    const start = bytesOf(store);
    edit(store, 5, 96);
    const beforeResize = bytesOf(store);

    store.set(resizeDocumentAtom, { width: 24, height: 12, anchor: 4, clampLocations: true });
    expect(scn.width).toBe(24);
    const afterResize = bytesOf(store);
    edit(store, 30, 400);
    const end = bytesOf(store);
    expect(store.get(undoStackAtom).map((e) => e.label)).toEqual(["Paint", "Place unit", "Resize map", "Paint", "Place unit"]);

    store.set(undoAtom);
    store.set(undoAtom);
    expect(bytesOf(store)).toEqual(afterResize);
    expect(store.set(undoAtom)).toBe("Resize map");
    expect(scn.width).toBe(16);
    expect(store.get(mapWidthAtom)).toBe(16);
    expect(bytesOf(store)).toEqual(beforeResize);
    expect(store.get(commitNoticeAtom)).toMatchObject({ reason: "undo", label: "Resize map", area: null, parts: { terrain: true, units: true, triggers: false } });
    store.set(undoAtom);
    store.set(undoAtom);
    expect(bytesOf(store)).toEqual(start);

    for (let i = 0; i < 5; i++) store.set(redoAtom);
    expect(store.get(redoStackAtom)).toEqual([]);
    expect(scn.width).toBe(24);
    expect(bytesOf(store)).toEqual(end);
  });

  it("undoes and redoes the same resize more than once", () => {
    const { store } = open();
    const before = bytesOf(store);
    store.set(resizeDocumentAtom, { width: 8, height: 8, anchor: 0, clampLocations: true });
    const after = bytesOf(store);
    for (let i = 0; i < 3; i++) {
      store.set(undoAtom);
      expect(bytesOf(store)).toEqual(before);
      store.set(redoAtom);
      expect(bytesOf(store)).toEqual(after);
      expect(store.get(mapHeightAtom)).toBe(8);
    }
  });

  it("gives back the units a crop dropped", () => {
    const { store, scn } = open();
    edit(store, 0, 15 * 32);
    store.set(resizeDocumentAtom, { width: 8, height: 12, anchor: 0, clampLocations: true });
    expect(scn.units).toHaveLength(0);
    store.set(undoAtom);
    expect(scn.units).toHaveLength(1);
    expect(scn.units[0].x).toBe(15 * 32);
  });

  it("takes a tileset change back, terrain and all", () => {
    const { store, scn } = open();
    edit(store, 5, 96);
    const before = bytesOf(store);
    store.set(changeTilesetAtom, { tileset: "jungle" });
    expect(store.get(mapTilesetAtom)).toBe("jungle");
    expect(tilesetIndex(scn)).not.toBe(0);
    const after = bytesOf(store);

    expect(store.set(undoAtom)).toBe("Change tileset");
    expect(tilesetIndex(scn)).toBe(0);
    expect(store.get(mapTilesetAtom)).toBe("badlands");
    expect(scn.tiles[5]).toBe(0x1234);
    expect(bytesOf(store)).toEqual(before);

    store.set(redoAtom);
    expect(store.get(mapTilesetAtom)).toBe("jungle");
    expect(bytesOf(store)).toEqual(after);
  });

  it("keeps the dialogs' steps on either side in order", () => {
    const { store, scn } = open();
    setScenarioName(scn, "renamed");
    store.set(commitSettingsAtom);
    store.set(resizeDocumentAtom, { width: 20, height: 12, anchor: 4, clampLocations: true });
    setScenarioName(scn, "renamed again");
    store.set(commitSettingsAtom);
    expect(store.get(undoStackAtom).map((e) => e.label)).toEqual(["Edit strings", "Resize map", "Edit strings"]);
    store.set(undoAtom);
    store.set(undoAtom);
    store.set(undoAtom);
    expect(scn.width).toBe(16);
    expect(bytesOf(store)).toEqual(Array.from(serializeScenario(createScenario({ width: 16, height: 12, era: 0, name: "whole" }))));
  });

  it("still drops the history on a shared map, where the change replaced everyone's map", () => {
    const store = createStore();
    const bytes = serializeScenario(createScenario({ width: 16, height: 12, era: 0, name: "shared" }));
    store.set(loadDocumentAtom, { scenario: parseScenario(bytes), extras: new Map(), fileName: "shared.scx" });
    expect(startSync(store, { send: () => {} })).not.toBeNull();
    edit(store, 5, 96);
    store.set(resizeDocumentAtom, { width: 20, height: 12, anchor: 4, clampLocations: true });
    expect(store.get(undoStackAtom)).toEqual([]);
  });
});
