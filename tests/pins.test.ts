import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import type { Scenario } from "../src/formats/chk/scenario";
import { loadTileset } from "../src/formats/tileset/decode";
import { TILESET_FILENAMES } from "../src/formats/tileset/load";
import { baseTerrain, flatTerrain } from "../src/formats/tileset/terrain";
import { TILESETS } from "../src/data/tilesets";
import { paintIsom } from "../src/editor/isom";
import { applyChanges } from "../src/editor/terrain";
import { countPins, decodePins, encodePins, handLaidCells, pinCells, PINS_MEMBER, pinsOf, resizePins, withoutPinned, withPinsMember } from "../src/editor/pins";
import {
  archiveExtrasAtom, commitEditAtom, loadDocumentAtom, pinCellsAtom, pinnedTilesAtom, redoAtom, resizeDocumentAtom, scenarioAtom, undoAtom, undoStackAtom,
} from "../src/atoms/documentAtoms";

const size = { width: 10, height: 6 };

describe("the pins file", () => {
  it("holds a bit per tile and comes back as it went in", () => {
    const pinned = pinCells(size, null, [0, 9, 13, 59], true)!;
    const member = encodePins(size, pinned)!;
    expect(member.length).toBe(8 + Math.ceil(60 / 8));
    expect([...decodePins(member, size)!]).toEqual([...pinned]);
    expect(countPins(decodePins(member, size))).toBe(4);
  });

  it("is not written when nothing is pinned", () => {
    expect(encodePins(size, null)).toBeNull();
    expect(encodePins(size, new Uint8Array(60))).toBeNull();
    const extras = withPinsMember(new Map([["a", new Uint8Array(1)]]), null);
    expect([...extras.keys()]).toEqual(["a"]);
  });

  it("is ignored for a map of another size, and when it is not a pins file", () => {
    const member = encodePins(size, pinCells(size, null, [3], true))!;
    expect(decodePins(member, { width: 12, height: 6 })).toBeNull();
    expect(decodePins(new Uint8Array([1, 2, 3, 4, 10, 0, 6, 0, 0xff]), size)).toBeNull();
    expect(decodePins(member.subarray(0, 10), size)).toBeNull();
    expect(pinsOf(new Map(), size)).toBeNull();
  });

  it("is read among a map's files", () => {
    const extras = withPinsMember(new Map(), encodePins(size, pinCells(size, null, [7], true)));
    expect(extras.has(PINS_MEMBER)).toBe(true);
    expect(pinsOf(extras, size)![7]).toBe(1);
    // Decoded once for a member.
    expect(pinsOf(extras, size)).toBe(pinsOf(extras, size));
  });
});

describe("pinning and unpinning", () => {
  it("answers a copy, and null when nothing would change", () => {
    const first = pinCells(size, null, [1, 2], true)!;
    expect(pinCells(size, first, [1, 2], true)).toBeNull();
    expect(pinCells(size, null, [1], false)).toBeNull();
    const second = pinCells(size, first, [2, 3], true)!;
    expect(second).not.toBe(first);
    expect([first[3], second[3]]).toEqual([0, 1]);
    expect(countPins(pinCells(size, second, [1, 2, 3], false))).toBe(0);
    // Cells off the map are nothing.
    expect(pinCells(size, null, [-1, 60], true)).toBeNull();
  });

  it("takes the changes to pinned tiles out of a brush's list", () => {
    const pinned = pinCells(size, null, [5], true);
    const changes = [{ at: 4, before: 1, after: 2 }, { at: 5, before: 1, after: 2 }];
    expect(withoutPinned(changes, pinned)).toEqual({ changes: [changes[0]], kept: 1 });
    expect(withoutPinned(changes, null)).toEqual({ changes, kept: 0 });
  });

  it("moves with the tiles when the map is resized", () => {
    const pinned = pinCells(size, null, [0, 11, 59], true);
    const grown = resizePins(pinned, size, { width: 12, height: 8 }, 1, 1)!;
    expect([grown[1 * 12 + 1], grown[2 * 12 + 2], grown[6 * 12 + 10]]).toEqual([1, 1, 1]);
    expect(countPins(grown)).toBe(3);
    // Cut off with the tiles they were on.
    expect(countPins(resizePins(pinned, size, { width: 4, height: 4 }, 0, 0))).toBe(2);
    expect(resizePins(pinned, size, { width: 4, height: 4 }, -5, -3)).toBeNull();
  });
});

describe("pins in the history", () => {
  function open() {
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 16, height: 16, era: 0, name: "p" }), extras: new Map([["other", new Uint8Array([1])]]), fileName: "p.scx" });
    return store;
  }

  it("are a file of the archive, and undo and redo with the edit that made them", () => {
    const store = open();
    const scn = store.get(scenarioAtom)!;
    const pins = store.set(pinCellsAtom, { cells: [3, 4], on: true })!;
    expect(pins.before).toBeNull();
    store.set(commitEditAtom, { label: "Pin tiles", changes: [], pins });
    expect(countPins(store.get(pinnedTilesAtom))).toBe(2);
    expect(store.get(archiveExtrasAtom).has("other")).toBe(true);

    // With tiles in the same entry: one step takes both back.
    const changes = [{ at: 20, before: scn.tiles[20], after: 0x21 }];
    applyChanges(scn, changes);
    const more = store.set(pinCellsAtom, { cells: [20], on: true })!;
    store.set(commitEditAtom, { label: "Place as terrain", changes, pins: more });
    expect(store.get(undoStackAtom).length).toBe(2);
    expect(countPins(store.get(pinnedTilesAtom))).toBe(3);

    store.set(undoAtom);
    expect(scn.tiles[20]).toBe(changes[0].before);
    expect(countPins(store.get(pinnedTilesAtom))).toBe(2);
    store.set(undoAtom);
    expect(store.get(pinnedTilesAtom)).toBeNull();
    expect(store.get(archiveExtrasAtom).has(PINS_MEMBER)).toBe(false);
    expect(store.get(archiveExtrasAtom).has("other")).toBe(true);

    store.set(redoAtom);
    store.set(redoAtom);
    expect(scn.tiles[20]).toBe(0x21);
    expect(countPins(store.get(pinnedTilesAtom))).toBe(3);
  });

  it("answers null and records nothing when the tiles are pinned already", () => {
    const store = open();
    store.set(commitEditAtom, { label: "Pin tiles", changes: [], pins: store.set(pinCellsAtom, { cells: [3], on: true })! });
    expect(store.set(pinCellsAtom, { cells: [3], on: true })).toBeNull();
    expect(store.get(undoStackAtom).length).toBe(1);
  });

  it("follow a resize", () => {
    const store = open();
    store.set(commitEditAtom, { label: "Pin tiles", changes: [], pins: store.set(pinCellsAtom, { cells: [0, 17], on: true })! });
    store.set(resizeDocumentAtom, { width: 32, height: 32, anchor: 4, terrainId: 0, clampLocations: true });
    const scn = store.get(scenarioAtom)!;
    const pinned = store.get(pinnedTilesAtom)!;
    expect(countPins(pinned)).toBe(2);
    // The old top-left tile is in the middle now.
    expect(pinned[8 * scn.width + 8]).toBe(1);
  });
});

/* ── The isometric brush, with the game's tilesets where they are installed ── */

const TILESET_DIR = join(import.meta.dirname, "..", "public", "tileset");
const installed = TILESET_FILENAMES.filter((n) => existsSync(join(TILESET_DIR, `${n}.cv5`)));

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000);
}

describe.skipIf(installed.length === 0)("the isometric brush and pinned tiles", () => {
  function plain(name: string) {
    const era = TILESET_FILENAMES.indexOf(name);
    const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `${name}.${ext}`)));
    const tileset = loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") });
    const info = TILESETS[era];
    const W = 64, H = 48;
    const { tiles, isom } = flatTerrain(W, H, baseTerrain(tileset, info.defaultIsom), tileset, seeded(7), era);
    const scn = { width: W, height: H, era, tiles, editorTiles: tiles.slice(), isom, dirty: new Set<string>() } as unknown as Scenario & { isom: Uint16Array };
    const high = info.terrain.find((t) => /^High |Platform|Substructure|Temple/.test(t.name));
    return { tileset, scn, high };
  }

  it("leaves pinned tiles as they are, lays the ground around them, and says how many it kept", () => {
    let painted = 0;
    for (const name of installed) {
      const { tileset, scn, high } = plain(name);
      if (!high) continue;
      // A block in the brush's way, pinned.
      const cells: number[] = [];
      for (let y = 20; y < 24; y++) for (let x = 28; x < 36; x++) cells.push(y * scn.width + x);
      const pinned = pinCells(scn, null, cells, true)!;
      const before = scn.tiles.slice();
      const edit = paintIsom(scn, tileset, { x: 16, y: 22 }, high.id, 7, seeded(3), pinned);
      if (!edit) continue;
      painted++;
      for (const at of cells) expect(scn.tiles[at], `${name} ${at}`).toBe(before[at]);
      expect(edit.tiles.every((c) => !pinned[c.at]), name).toBe(true);
      expect(edit.tiles.length, name).toBeGreaterThan(40);
      expect(edit.kept.length, name).toBeGreaterThan(0);
      expect(edit.kept.every((at) => pinned[at] === 1), name).toBe(true);
      // The lattice changed under the pinned block as it would have without the pin.
      const free = plain(name);
      paintIsom(free.scn, free.tileset, { x: 16, y: 22 }, high.id, 7, seeded(3));
      expect([...scn.isom], name).toEqual([...free.scn.isom]);
    }
    expect(painted).toBeGreaterThan(0);
  });

  it("finds the tiles laid by hand: none on painted ground, and the ones the lattice does not account for", () => {
    for (const name of installed) {
      const { tileset, scn, high } = plain(name);
      if (!high || !paintIsom(scn, tileset, { x: 16, y: 22 }, high.id, 5, seeded(3))) continue;
      expect(handLaidCells(scn, tileset), name).toEqual([]);
      // A tile of the plateau's top set down on the low ground by hand.
      const top = scn.tiles[22 * scn.width + 32];
      const at = 4 * scn.width + 6;
      expect(scn.tiles[at]).not.toBe(top);
      scn.tiles[at] = top;
      scn.editorTiles[at] = top;
      expect(handLaidCells(scn, tileset), name).toEqual([at]);
      expect(handLaidCells(scn, tileset, { x0: 10, y0: 0, x1: 20, y1: 10 }), name).toEqual([]);
    }
  });
});
