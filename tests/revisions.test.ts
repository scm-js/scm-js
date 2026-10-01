import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import {
  commitEditAtom, doodadsRevisionAtom, loadDocumentAtom, locationsRevisionAtom, objectEditRevisionAtom, redoAtom, rollbackEntryAtom, scenarioAtom,
  terrainRevisionAtom, undoAtom, unitsRevisionAtom,
} from "../src/atoms/documentAtoms";
import { applyEntry, touchesGround, type HistoryEntry } from "../src/editor/history";
import { addUnits, makeUnit } from "../src/editor/units";
import { Contributions, createPluginApi } from "../src/plugins/host";
import type { EditTransaction } from "../src/plugins/api";

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

const REVISIONS = { terrain: terrainRevisionAtom, objects: objectEditRevisionAtom, units: unitsRevisionAtom, doodads: doodadsRevisionAtom, locations: locationsRevisionAtom };
type Counts = Record<keyof typeof REVISIONS, number>;

function read(store: ReturnType<typeof createStore>): Counts {
  return Object.fromEntries(Object.entries(REVISIONS).map(([k, a]) => [k, store.get(a)])) as Counts;
}

/** How far each revision moved since `from`. */
function moved(store: ReturnType<typeof createStore>, from: Counts): Counts {
  const now = read(store);
  return Object.fromEntries(Object.keys(now).map((k) => [k, now[k as keyof Counts] - from[k as keyof Counts]])) as Counts;
}

const NONE: Counts = { terrain: 0, objects: 0, units: 0, doodads: 0, locations: 0 };

describe("which revision an edit moves", () => {
  it("leaves the terrain revision alone for an edit of units only, through undo and redo too", () => {
    const store = open();
    const scn = store.get(scenarioAtom)!;
    const before = read(store);

    commit(store, { label: "Place", changes: [], units: addUnits(scn, [makeUnit(null, 0, 0, 48, 48, 1)]) });
    expect(scn.units).toHaveLength(1);
    expect(moved(store, before)).toEqual({ ...NONE, objects: 1, units: 1 });

    store.set(undoAtom);
    expect(scn.units).toHaveLength(0);
    store.set(redoAtom);
    expect(scn.units).toHaveLength(1);
    expect(moved(store, before)).toEqual({ ...NONE, objects: 3, units: 3 });
  });

  it("moves the terrain revision, and only it, for a tile edit", () => {
    const store = open();
    const scn = store.get(scenarioAtom)!;
    const before = read(store);

    commit(store, { label: "Paint", changes: [{ at: 3, before: scn.tiles[3], after: scn.tiles[3] ^ 16 }] });
    store.set(undoAtom);
    expect(moved(store, before)).toEqual({ ...NONE, terrain: 2 });
  });

  it("repaints a rolled-back entry through the same revisions, without recording anything", () => {
    const store = open();
    const scn = store.get(scenarioAtom)!;
    const entry: HistoryEntry = { label: "Place", changes: [], units: addUnits(scn, [makeUnit(null, 0, 0, 48, 48, 1)]) };
    applyEntry(scn, entry, "do");
    const before = read(store);
    store.set(rollbackEntryAtom, entry);
    expect(scn.units).toHaveLength(0);
    expect(moved(store, before)).toEqual({ ...NONE, objects: 1, units: 1 });
  });

  it("counts tiles, the lattice, doodad tiles and fog as the ground, and nothing else", () => {
    const tile = [{ at: 0, before: 1, after: 2 }];
    const ground: Partial<HistoryEntry>[] = [
      { changes: tile }, { isom: tile }, { createdIsom: new Uint16Array(4) }, { rebuiltIsom: true },
      { doodadTiles: tile }, { fog: tile }, { createdMask: new Uint8Array(4) },
    ];
    for (const part of ground) expect(touchesGround({ changes: [], ...part }), Object.keys(part)[0]).toBe(true);
    const objects: Partial<HistoryEntry>[] = [{}, { units: [] }, { units: [{ index: 0, before: null, after: makeUnit(null, 0, 0, 16, 16, 1) }] }, { doodads: [] }, { sprites: [] }, { locations: [] }, { isom: [] }, { fog: [] }, { doodadTiles: [] }];
    for (const part of objects) expect(touchesGround({ changes: [], ...part }), Object.keys(part)[0] ?? "empty").toBe(false);
  });
});

/**
 * The same through the plugin API, which is the real route — a transaction, the commit atom,
 * undo and redo — for every kind of edit a layer makes. Each row says which revisions one
 * commit moves; undo and redo must move the same ones. The `"terrain"` event is documented
 * as every committed edit, whatever it touched.
 */
describe("each kind of edit, through a transaction", () => {
  const edits: { name: string; edit: (tx: EditTransaction) => void; moves: Partial<Counts> }[] = [
    { name: "a tile", edit: (tx) => { tx.setTile(1, 1, 0x21); }, moves: { terrain: 1 } },
    { name: "a unit", edit: (tx) => { tx.placeUnit(0, 0, 80, 80); }, moves: { objects: 1, units: 1 } },
    { name: "a sprite", edit: (tx) => { tx.placeSprite("pure", 5, 0, 80, 80); }, moves: { objects: 1, doodads: 1 } },
    { name: "a location", edit: (tx) => { tx.addLocation({ left: 32, top: 32, right: 96, bottom: 96 }, "here"); }, moves: { objects: 1, locations: 1 } },
    { name: "fog", edit: (tx) => { tx.setFog({ x0: 0, y0: 0, x1: 2, y1: 2 }, 1, "clear"); }, moves: { terrain: 1 } },
    { name: "a tile and a unit together", edit: (tx) => { tx.setTile(1, 1, 0x21); tx.placeUnit(0, 0, 80, 80); }, moves: { terrain: 1, units: 1 } },
  ];

  for (const { name, edit, moves } of edits) {
    it(`${name}: the commit, its undo and its redo move the same revisions, and "terrain" hears all three`, () => {
      const store = open();
      const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
      let terrainEvents = 0;
      api.events.on("terrain", () => terrainEvents++);
      const expected = { ...NONE, ...moves };

      let before = read(store);
      api.document.edit("Edit", edit);
      expect(moved(store, before), "commit").toEqual(expected);
      expect(terrainEvents, "commit").toBe(1);

      before = read(store);
      expect(api.document.undo()).toBe("Edit");
      expect(moved(store, before), "undo").toEqual(expected);
      expect(terrainEvents, "undo").toBe(2);

      before = read(store);
      expect(api.document.redo()).toBe("Edit");
      expect(moved(store, before), "redo").toEqual(expected);
      expect(terrainEvents, "redo").toBe(3);
    });
  }

  it("says nothing for a transaction that changed nothing", () => {
    const store = open();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    let terrainEvents = 0;
    api.events.on("terrain", () => terrainEvents++);
    const before = read(store);
    api.document.edit("Nothing", () => {});
    expect(moved(store, before)).toEqual(NONE);
    expect(terrainEvents).toBe(0);
  });
});
