import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import type { Cv5Group, Tileset } from "../src/formats/tileset/decode";
import { NO_DOODADS } from "../src/formats/tileset/doodads";
import { primeTileset, type LoadedTileset } from "../src/formats/tileset/load";
import { scenarioAtom, undoAtom, undoStackAtom } from "../src/atoms/documentAtoms";
import { activeTileAtom, mapTilesetAtom } from "../src/atoms/editorAtoms";
import { providedTypesAtom } from "../src/atoms/pieceAtoms";
import { tileBlockAtom } from "../src/atoms/tileBlockAtoms";
import { declaredTerrains } from "../src/editor/pieceList";
import { replaceTerrain, stampTerrain } from "../src/editor/terrain";
import { TILESETS } from "../src/data/tilesets";
import { Contributions, createPluginApi } from "../src/plugins/host";
import { headlessStore } from "../src/plugins/headless";
import { writeMapBytes, openMapBytes } from "../src/editor/mapFile";
import type { TileBlock } from "../src/plugins/api";

const plugin = { id: "walls", name: "Walls", source: "s" };
const id = (group: number, slot: number) => (group << 4) | slot;

/**
 * A made Badlands of 64 groups: every group index 0 (untyped, as a mod's added ground), each slot
 * its own megatile with a picture of its own; group 60 has nothing in slots 8–15. Groups 40/41 are
 * a loose pair (same slots, left and right differ).
 */
function madeLoaded(): LoadedTileset {
  const groups = 64;
  const megatileCount = groups * 16 + 1;
  const refs = new Uint32Array(megatileCount * 16);
  const minitiles = new Uint8Array(megatileCount * 64);
  for (let m = 1; m < megatileCount; m++) {
    for (let k = 0; k < 16; k++) refs[m * 16 + k] = m << 1;
    for (let p = 0; p < 64; p++) minitiles[m * 64 + p] = (m * 7 + p) & 0xff;
  }
  const palette = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) palette.set([i, (i * 3) & 0xff, (i * 5) & 0xff, 255], i * 4);
  const cv5 = Array.from({ length: groups }, (_, g) => ({
    index: 0, flags: 0, edges: { left: 0, top: 0, right: 0, bottom: 0 }, stack: { left: 0, top: 0, right: 0, bottom: 0 },
    megatiles: Uint16Array.from({ length: 16 }, (_, s) => (g === 60 && s >= 8 ? 0 : g * 16 + s + 1)),
  })) as unknown as Cv5Group[];
  const tileset: Tileset = { palette, minitiles, megatileRefs: refs, megatileCount, extended: false, megatileFlags: new Uint16Array(megatileCount * 16).fill(1), groups: cv5 };
  return {
    name: "badlands",
    tileset,
    atlas: { image: {} as CanvasImageSource, columns: 1, tileSize: 32, count: megatileCount, averages: new Uint32Array(megatileCount), animation: null } as unknown as LoadedTileset["atlas"],
    doodads: NO_DOODADS,
  };
}

/** A 3 × 2 picture of groups 30–31, slots 5–7, laid twice on a 24 × 16 map. */
const PICTURE: TileBlock = { cols: 3, rows: 2, ids: [id(30, 5), id(30, 6), id(30, 7), id(31, 5), id(31, 6), id(31, 7)] };

function open() {
  primeTileset(madeLoaded());
  const store = createStore();
  const scn = createScenario({ width: 24, height: 16, era: 0, name: "p" });
  scn.tiles.fill(id(2, 0));
  scn.editorTiles.fill(id(2, 0));
  store.set(scenarioAtom, scn);
  store.set(mapTilesetAtom, "badlands");
  const bag = new Contributions();
  const api = createPluginApi(store, plugin, bag);
  return { store, scn, api, bag };
}

describe("blocks in a transaction", () => {
  it("places a block, holes and the map's edge skipped, as one undo entry", () => {
    const { store, scn, api } = open();
    const holed: TileBlock = { cols: 2, rows: 2, ids: [id(9, 1), -1, id(9, 3), id(9, 4)] };
    let n = 0;
    api.document.edit("Lay", (tx) => {
      n = tx.placeBlock(holed, 4, 4) + tx.placeBlock(holed, 23, 15);
    });
    expect(n).toBe(3 + 1);
    expect(scn.tiles[4 * 24 + 4]).toBe(id(9, 1));
    expect(scn.tiles[4 * 24 + 5]).toBe(id(2, 0));
    expect(scn.tiles[5 * 24 + 5]).toBe(id(9, 4));
    expect(scn.tiles[15 * 24 + 23]).toBe(id(9, 1));
    expect(store.get(undoStackAtom)).toHaveLength(1);
    store.set(undoAtom);
    expect(scn.tiles[4 * 24 + 4]).toBe(id(2, 0));
  });

  it("writes a pinned tile, as setTile does", () => {
    const { scn, api } = open();
    api.document.edit("Pin", (tx) => { tx.pin([0]); });
    api.document.edit("Lay", (tx) => { tx.placeBlock(PICTURE, 0, 0); });
    expect(scn.tiles[0]).toBe(id(30, 5));
  });

  it("repeats a block as a pattern from the map's corner, or from an origin", () => {
    const { scn, api } = open();
    const two: TileBlock = { cols: 2, rows: 1, ids: [id(7, 0), id(7, 1)] };
    api.document.edit("Strip", (tx) => { expect(tx.fillPattern({ x0: 0, y0: 0, x1: 5, y1: 1 }, two)).toBe(5); });
    expect(Array.from(scn.tiles.slice(0, 5))).toEqual([id(7, 0), id(7, 1), id(7, 0), id(7, 1), id(7, 0)]);
    api.document.edit("Strip", (tx) => { tx.fillPattern({ x0: 0, y0: 1, x1: 3, y1: 2 }, two, { x: 1, y: 1 }); });
    expect(Array.from(scn.tiles.slice(24, 27))).toEqual([id(7, 1), id(7, 0), id(7, 1)]);
  });

  it("refuses a block that is not one, and takes the transaction back", () => {
    const { store, api } = open();
    expect(() => api.document.edit("Bad", (tx) => { tx.placeBlock({ cols: 2, rows: 2, ids: [1, 2, 3] }, 0, 0); })).toThrow(/cols × rows/);
    expect(store.get(undoStackAtom)).toHaveLength(0);
  });
});

describe("the sheet and blocks from it", () => {
  it("answers the sheet's size and where a data set's groups begin", () => {
    const { api } = open();
    expect(api.terrain.sheet()).toEqual({ columns: 16, groups: 64, addedFrom: null });
  });

  it("takes a rectangle of the sheet as a block, a slot with no picture a hole", () => {
    const { api } = open();
    expect(api.terrain.blockFrom({ group: 59, slot: 7, cols: 2, rows: 2 })).toEqual({ cols: 2, rows: 2, ids: [id(59, 7), id(59, 8), id(60, 7), -1], origin: { group: 59, slot: 7 } });
    expect(api.terrain.blockFrom({ group: 60, slot: 8, cols: 2, rows: 1 })).toBeNull();
    expect(api.terrain.blockFrom({ group: 63, slot: 0, cols: 1, rows: 2 })).toBeNull();
    expect(api.terrain.blockFrom({ group: 0, slot: 15, cols: 2, rows: 1 })).toBeNull();
  });

  it("answers nothing without the graphics", () => {
    // Ice is never primed here.
    const store = createStore();
    store.set(scenarioAtom, createScenario({ width: 8, height: 8, era: 6, name: "i" }));
    store.set(mapTilesetAtom, "ice");
    const api = createPluginApi(store, plugin, new Contributions());
    expect(api.tileset.isLoaded()).toBe(false);
    expect(api.terrain.sheet()).toBeNull();
    expect(api.terrain.blockFrom({ group: 0, slot: 0, cols: 1, rows: 1 })).toBeNull();
    expect(api.terrain.pieces()).toEqual([]);
    expect(api.terrain.cutPieces([])).toEqual([]);
  });
});

describe("pieces on the API", () => {
  function laid() {
    const ctx = open();
    ctx.api.document.edit("Lay", (tx) => { tx.placeBlock(PICTURE, 2, 2); tx.placeBlock(PICTURE, 10, 8); });
    return ctx;
  }

  it("lists the pieces the map lays, gives each back as a block, and picks one where it is laid", () => {
    const { api } = laid();
    const [piece] = api.terrain.pieces();
    expect(piece).toMatchObject({ group: 30, slot: 5, cols: 3, rows: 2, laid: 12, copies: 0, source: "maps" });
    expect(api.terrain.blockOf(piece)).toEqual({ ...PICTURE, origin: { group: 30, slot: 5 } });
    expect(api.terrain.pieceAt(3, 3)?.tiles).toEqual(piece.tiles);
    expect(api.terrain.pieceAt(0, 0)).toBeNull();
  });

  it("cuts pieces from a plugin's own maps", () => {
    const { api, scn } = laid();
    const cut = api.terrain.cutPieces([{ tiles: scn.tiles, width: scn.width, height: scn.height }, { tiles: [1, 2], width: 9, height: 9 }]);
    expect(cut).toHaveLength(1);
    expect(cut[0].tiles).toEqual(PICTURE.ids.slice().sort((a, b) => a - b));
  });

  it("lists provided pieces first under their label; the named one wins over the same tiles cut from maps", () => {
    const { api, store } = laid();
    let fired = 0;
    api.events.on("pieces", () => { fired++; });
    const set = api.terrain.providePieces({
      id: "walls", label: "Walls", tileset: "badlands",
      pieces: [
        { name: "Wall corner", category: "Walls", block: PICTURE },
        { name: "Off the table", block: { cols: 1, rows: 1, ids: [id(200, 0)] } },
        { name: "Empty slot", block: { cols: 1, rows: 1, ids: [id(60, 9)] } },
        { name: "Other", block: { cols: 1, rows: 2, ids: [id(12, 3), id(13, 3)] } },
      ],
    });
    expect(fired).toBe(1);
    const list = api.terrain.pieces();
    expect(list.map((p) => p.name ?? p.source)).toEqual(["Wall corner", "Other"]);
    expect(list[0]).toMatchObject({ source: "walls", category: "Walls", laid: 0 });
    expect(api.terrain.blockOf(list[1])).toEqual({ cols: 1, rows: 2, ids: [id(12, 3), id(13, 3)] });
    // Another tileset's set is not listed with this map in front.
    api.terrain.providePieces({ id: "ice", label: "Ice", tileset: "ice", pieces: [{ name: "Ice", block: PICTURE }] });
    expect(api.terrain.pieces().map((p) => p.name)).not.toContain("Ice");
    set.dispose();
    expect(api.terrain.pieces().map((p) => p.source)).toEqual(["maps"]);
    expect(store.get(scenarioAtom)).not.toBeNull();
  });

  it("takes every provided set back with the plugin", () => {
    const { api, bag } = laid();
    api.terrain.providePieces({ id: "a", label: "A", tileset: "badlands", pieces: [{ block: { cols: 1, rows: 1, ids: [id(5, 5)] } }] });
    expect(api.terrain.pieces()).toHaveLength(2);
    bag.dispose();
    expect(api.terrain.pieces()).toHaveLength(1);
  });

  it("refuses a set without an id or a known tileset", () => {
    const { api } = open();
    expect(() => api.terrain.providePieces({ id: "", label: "x", tileset: "badlands", pieces: [] })).toThrow(/an id/);
    expect(() => api.terrain.providePieces({ id: "x", label: "x", tileset: "mars" as "ice", pieces: [] })).toThrow(/tileset id/);
  });
});

describe("the brush's block on the API", () => {
  it("arms the Tile brush with a block and drops it", () => {
    const { api, store } = open();
    api.terrain.setActive({ mode: "tile", block: PICTURE });
    expect(store.get(tileBlockAtom)?.cols).toBe(3);
    expect(store.get(activeTileAtom)).toBe(id(30, 5));
    expect(api.terrain.active().block).toEqual(PICTURE);
    api.terrain.setActive({ tile: id(4, 4) });
    expect(api.terrain.active().block).toBeNull();
    api.terrain.setActive({ block: PICTURE });
    api.terrain.setActive({ block: null });
    expect(api.terrain.active().block).toBeNull();
  });
});

describe("declared ground", () => {
  it("reaches the Rect brush's list under its name, and lays and replaces as a pair", () => {
    const { api, store, scn } = open();
    api.terrain.provideTypes({ id: "ground", tileset: "badlands", types: [{ name: "Swamp", group: 40 }, { name: "Odd", group: 41 }, { name: "Not a pair", group: 60 }] });
    const declared = store.get(providedTypesAtom).flatMap((d) => d.types);
    expect(declared.map((d) => d.name)).toEqual(["Swamp", "Not a pair"]);
    const tileset = api.tileset.raw()!.tileset;
    const types = declaredTerrains(tileset, TILESETS[0].terrain, declared);
    expect(types.map((t) => [t.name, t.group])).toEqual([["Swamp", 40]]);
    // Laid as the Rect brush lays a pair, and filled over the map by Replace Terrain.
    const stamp = stampTerrain(scn, tileset, { group: types[0].group, variation: 0 }, [0, 1]);
    expect(stamp.map((c) => c.after)).toEqual([id(40, 0), id(41, 0)]);
    const fill = replaceTerrain(scn, tileset, { kind: "tile", id: id(2, 0) }, { kind: "terrain", id: types[0].id, variation: 0 });
    expect(fill).toHaveLength(24 * 16);
    expect(fill.every((c) => c.after >> 4 === 40 + ((c.at % 24) & 1))).toBe(true);
  });
});

describe("the host without the editor", () => {
  it("lays a block in a transaction and answers the pieces it can", async () => {
    primeTileset(madeLoaded());
    const scn = createScenario({ width: 16, height: 16, era: 0, name: "h" });
    const doc = await openMapBytes(await writeMapBytes(scn, { format: "scx" }), "h.scx");
    const store = headlessStore(doc);
    const api = createPluginApi(store, plugin, new Contributions());
    api.document.edit("Lay", (tx) => { tx.placeBlock(PICTURE, 1, 1); tx.placeBlock(PICTURE, 8, 8); });
    expect(store.get(scenarioAtom)!.tiles[1 * 16 + 1]).toBe(id(30, 5));
    expect(api.terrain.pieces()).toHaveLength(1);
    const set = api.terrain.providePieces({ id: "p", label: "P", tileset: "badlands", pieces: [{ name: "One", block: PICTURE }] });
    expect(api.terrain.pieces().map((p) => p.name)).toEqual(["One"]);
    set.dispose();
  });
});
