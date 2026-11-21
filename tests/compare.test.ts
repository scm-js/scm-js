/**
 * Tools ▸ Compare Maps… (src/editor/compare.ts, `compareBaseAtom`): the ground that differs joined into places, the
 * same comparison whichever way the command line and the editor reach it, and what a map is compared with staying
 * with that map when another comes to the front. The comparison itself (tiles, units paired as moved, locations) is
 * tested where it was first written, in tests/cli-diffpicture.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, serializeScenario, type Scenario } from "../src/formats/chk/scenario";
import { setString } from "../src/formats/chk/sections/strings";
import { loadMap } from "../src/formats/mpq/scm";
import { anyChange, changedPlaces, diffChanges, scenarioCopy, TILE_KIND } from "../src/editor/compare";
import { locationName } from "../src/editor/locations";
import { makeUnit } from "../src/editor/units";
import { diffChanges as cliDiffChanges } from "../cli/src/diffpicture";
import { activateDocumentAtom, activeDocumentIdAtom, applyDocumentAtom, closeDocumentAtom, compareBaseAtom, loadDocumentAtom, replaceScenarioAtom, scenarioAtom, undoAtom } from "../src/atoms/documentAtoms";
import { testMapFiles } from "./support/maps";

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

  /** Map `a` compared with the open map `b`, with `b` in front. */
  function comparedWithFront() {
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: jungle(16, 12, "b"), extras: new Map(), fileName: "b.scx" });
    const b = store.get(activeDocumentIdAtom)!;
    const bBefore = store.get(scenarioAtom)!;
    store.set(loadDocumentAtom, { scenario: jungle(16, 12, "a"), extras: new Map(), fileName: "a.scx", into: "tab" });
    const a = store.get(activeDocumentIdAtom)!;
    store.set(compareBaseAtom, { name: "b", scenario: bBefore });
    store.set(activateDocumentAtom, b);
    return { store, a, b, bBefore };
  }

  it("follows the other map when that map is read again into a new object", () => {
    const { store, a } = comparedWithFront();
    const next = repaint(jungle(16, 12, "b"), [[0, 0]]);
    store.set(replaceScenarioAtom, next);
    store.set(activateDocumentAtom, a);
    expect(store.get(compareBaseAtom)?.scenario).toBe(next);
  });

  it("follows the other map through a linked command's edit and its undo", () => {
    const { store, a, b, bBefore } = comparedWithFront();
    const next = repaint(jungle(16, 12, "b"), [[0, 0]]);
    expect(store.set(applyDocumentAtom, { scenario: next, extras: new Map(), stored: null }, "edit")).toBe(true);
    store.set(activateDocumentAtom, a);
    expect(store.get(compareBaseAtom)?.scenario).toBe(next);
    store.set(activateDocumentAtom, b);
    store.set(undoAtom);
    expect(store.get(scenarioAtom)).toBe(bBefore);
    store.set(activateDocumentAtom, a);
    expect(store.get(compareBaseAtom)?.scenario).toBe(bBefore);
  });

  it("keeps the other map as it last stood when that map closes", () => {
    const { store, a } = comparedWithFront();
    const next = repaint(jungle(16, 12, "b"), [[0, 0]]);
    store.set(replaceScenarioAtom, next);
    store.set(closeDocumentAtom);
    expect(store.get(activeDocumentIdAtom)).toBe(a);
    expect(store.get(compareBaseAtom)?.scenario).toBe(next);
  });
});

describe("a map kept as it is now", () => {
  it.each(testMapFiles().map((f) => [f.name, f.path] as const))("%s differs in nothing from its copy", async (_name, path) => {
    const scenario = parseScenario((await loadMap(new Uint8Array(readFileSync(path)))).chk);
    expect(anyChange(diffChanges(scenarioCopy(scenario), scenario).counts)).toBe(false);
  });

  it("keeps a location name the map's encoding cannot hold", () => {
    const s = jungle();
    s.strings.encoding = "windows-1252";
    s.locations[0] = { ...s.locations[0], left: 0, top: 0, right: 64, bottom: 64, nameIndex: setString(s.strings, 0, "본진") };
    s.dirty.add("STR ").add("MRGN");
    // What the copy must not do: this way round the name comes back as question marks.
    expect(locationName(parseScenario(serializeScenario(s)), 0)).not.toBe("본진");
    const copy = scenarioCopy(s);
    expect(locationName(copy, 0)).toBe("본진");
    expect(diffChanges(copy, s).locations).toEqual([]);
  });

  it("does not share what an edit of the map changes", () => {
    const s = jungle();
    const copy = scenarioCopy(s);
    repaint(s, [[0, 0]]);
    s.units.push(makeUnit(null, 0, 0, 100, 100, 1));
    expect(diffChanges(copy, s).counts).toMatchObject({ tiles: 1, unitsAdded: 1 });
  });
});
