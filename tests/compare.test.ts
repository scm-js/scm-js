/**
 * Tools ▸ Compare Maps… (src/editor/compare.ts, `compareBaseAtom`): the ground that differs joined into places, the
 * same comparison whichever way the command line and the editor reach it, and what a map is compared with staying
 * with that map when another comes to the front. The comparison itself (tiles, units paired as moved, locations) is
 * tested where it was first written, in tests/cli-diffpicture.test.ts.
 */
import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, serializeScenario, type Scenario } from "../src/formats/chk/scenario";
import { changedPlaces, diffChanges, TILE_KIND } from "../src/editor/compare";
import { makeUnit } from "../src/editor/units";
import { diffChanges as cliDiffChanges } from "../cli/src/diffpicture";
import { activateDocumentAtom, activeDocumentIdAtom, closeDocumentAtom, compareBaseAtom, loadDocumentAtom, replaceScenarioAtom, scenarioAtom } from "../src/atoms/documentAtoms";

const jungle = (w = 16, h = 12, name = "t"): Scenario => createScenario({ width: w, height: h, era: 4, name });
/** Another tile id at each of `cells`, whatever the map holds there. */
function repaint(s: Scenario, cells: [number, number][]): Scenario {
  for (const [x, y] of cells) s.tiles[y * s.width + x] = (s.tiles[y * s.width + x] ?? 0) + 16;
  return s;
}

describe("the ground that differs, in places", () => {
  it("joins tiles that touch, corners included, and lists the largest place first", () => {
    const a = jungle(), b = repaint(jungle(), [[1, 1], [2, 2], [3, 2], [10, 8], [14, 0]]);
    const d = diffChanges(a, b);
    expect(d.counts.tiles).toBe(5);
    expect(changedPlaces(d)).toEqual([
      { x0: 1, y0: 1, x1: 4, y1: 3, tiles: 3 },
      // Of one tile each: the upper one first.
      { x0: 14, y0: 0, x1: 15, y1: 1, tiles: 1 },
      { x0: 10, y0: 8, x1: 11, y1: 9, tiles: 1 },
    ]);
  });

  it("finds no place in two maps that are alike, and none in the tiles only one map has", () => {
    expect(changedPlaces(diffChanges(jungle(), jungle()))).toEqual([]);
    const d = diffChanges(jungle(8, 8), jungle(16, 12));
    expect(d.counts).toMatchObject({ tiles: 0, resized: 16 * 12 - 8 * 8 });
    expect(d.tiles[0]).toBe(TILE_KIND.same);
    expect(d.tiles[11 * 16 + 15]).toBe(TILE_KIND.bOnly);
    expect(changedPlaces(d)).toEqual([]);
  });

  it("is the comparison the command line draws its picture from", () => {
    expect(cliDiffChanges).toBe(diffChanges);
  });

  it("tells a unit the second map has more as added, from the first map to the second", () => {
    const a = jungle(), b = jungle();
    b.units.push(makeUnit(null, 0, 0, 100, 100, 1));
    expect(diffChanges(a, b).counts).toMatchObject({ unitsAdded: 1, unitsRemoved: 0 });
    expect(diffChanges(b, a).counts).toMatchObject({ unitsAdded: 0, unitsRemoved: 1 });
  });
});

describe("what a map is compared with", () => {
  it("stays with the map: another map in front has its own, and it is back when the map is", () => {
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: jungle(16, 12, "a"), extras: new Map(), fileName: "a.scx" });
    const a = store.get(activeDocumentIdAtom)!;
    const kept = { name: "a as it was", scenario: parseScenario(serializeScenario(store.get(scenarioAtom)!)) };
    store.set(compareBaseAtom, kept);

    store.set(loadDocumentAtom, { scenario: jungle(16, 12, "b"), extras: new Map(), fileName: null, reason: "new", into: "tab" });
    expect(store.get(compareBaseAtom)).toBeNull();

    store.set(activateDocumentAtom, a);
    expect(store.get(compareBaseAtom)).toBe(kept);
  });

  it("is kept when the same map is read again, and gone when the last map closes", () => {
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: jungle(), extras: new Map(), fileName: "a.scx" });
    const kept = { name: "before", scenario: jungle() };
    store.set(compareBaseAtom, kept);
    store.set(replaceScenarioAtom, repaint(jungle(), [[0, 0]]));
    expect(store.get(compareBaseAtom)).toBe(kept);
    store.set(closeDocumentAtom);
    expect(store.get(scenarioAtom)).toBeNull();
    expect(store.get(compareBaseAtom)).toBeNull();
  });
});
