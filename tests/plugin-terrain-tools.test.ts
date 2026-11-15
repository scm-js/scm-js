import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { loadTileset } from "../src/formats/tileset/decode";
import { buildDoodadCatalogue } from "../src/formats/tileset/doodads";
import { primeTileset, type LoadedTileset } from "../src/formats/tileset/load";
import { flatTerrain } from "../src/formats/tileset/terrain";
import { archiveExtrasAtom, scenarioAtom, undoAtom, redoAtom, undoStackAtom } from "../src/atoms/documentAtoms";
import { mapTilesetAtom } from "../src/atoms/editorAtoms";
import { PINS_MEMBER } from "../src/editor/pins";
import { Contributions, createPluginApi } from "../src/plugins/host";

const plugin = { id: "t", name: "T", source: "s" };

describe("pins through the plugin API", () => {
  function blank() {
    const store = createStore();
    const scn = createScenario({ width: 8, height: 6, era: 0, name: "p" });
    store.set(scenarioAtom, scn);
    return { store, scn, api: createPluginApi(store, plugin, new Contributions()) };
  }

  it("pins and unpins in a transaction, as one undo step with whatever else it did", () => {
    const { store, scn, api } = blank();
    const result = api.document.edit("Lay and pin", (tx) => {
      tx.setTile(2, 1, 0x21);
      expect(tx.pin([10, 11, 12])).toBe(3);
      expect(tx.pin([12])).toBe(0);
      expect(tx.pin([12], false)).toBe(1);
    });
    expect(result.changed).toBe(true);
    expect(api.terrain.pinned()).toEqual([10, 11]);
    expect(store.get(archiveExtrasAtom).has(PINS_MEMBER)).toBe(true);
    expect(store.get(undoStackAtom)).toHaveLength(1);
    store.set(undoAtom);
    expect(api.terrain.pinned()).toEqual([]);
    expect(scn.tiles[10]).not.toBe(0x21);
    store.set(redoAtom);
    expect(api.terrain.pinned()).toEqual([10, 11]);
    expect(scn.tiles[10]).toBe(0x21);
  });

  it("records a transaction that only pins", () => {
    const { store, api } = blank();
    expect(api.document.edit("Pin", (tx) => { tx.pin({ x0: 0, y0: 0, x1: 2, y1: 2 }); }).changed).toBe(true);
    expect(api.terrain.pinned()).toEqual([0, 1, 8, 9]);
    expect(store.get(undoStackAtom)).toHaveLength(1);
    // Nothing to pin, nothing recorded.
    expect(api.document.edit("Pin again", (tx) => { tx.pin([0, 1]); }).changed).toBe(false);
    expect(store.get(undoStackAtom)).toHaveLength(1);
  });

  it("leaves pinned tiles alone in a fill, and writes them where a tile is set outright", () => {
    const { scn, api } = blank();
    const before = scn.tiles[9];
    api.document.edit("Pin", (tx) => { tx.pin([9]); });
    api.document.edit("Fill", (tx) => { expect(tx.fillArea(0, 0, { tileId: 0x25 })).toBe(8 * 6 - 1); });
    expect(scn.tiles[9]).toBe(before);
    expect(scn.tiles[8]).toBe(0x25);
    api.document.edit("Set", (tx) => { tx.setTile(1, 1, 0x26); });
    expect(scn.tiles[9]).toBe(0x26);
  });

  it("takes the pins back when the builder throws", () => {
    const { store, api } = blank();
    expect(() => api.document.edit("Pin", (tx) => { tx.pin([3]); throw new Error("no"); })).toThrow("no");
    expect(api.terrain.pinned()).toEqual([]);
    expect(store.get(undoStackAtom)).toHaveLength(0);
  });

  it("answers nothing for what needs the graphics when they are not installed", () => {
    const { api } = blank();
    expect(api.terrain.seamStep(0x20, "right", 0x21)).toBeNull();
    expect(api.terrain.seams()).toBe(0);
    expect(api.terrain.handLaid()).toEqual([]);
    expect(api.terrain.symmetryShares()).toEqual({});
    expect(api.terrain.fairness("h")).toBeNull();
    expect(api.palette.stretchAxes(12)).toEqual([]);
    expect(api.palette.doodadTwin(12)).toBeNull();
    expect(api.document.edit("Stretch", (tx) => { expect(tx.placeStretchedDoodad(12, 2, 2, "se", 2)).toEqual([]); expect(tx.heal([1, 2])).toBe(0); }).changed).toBe(false);
  });
});

/* ── With the game's Jungle tileset ─────────────────────── */

const TILESET_DIR = join(import.meta.dirname, "..", "public", "tileset");
const haveJungle = ["cv5", "vf4", "vr4", "vx4", "wpe", "dddata.bin"].every((ext) => existsSync(join(TILESET_DIR, `jungle.${ext}`)));

describe.skipIf(!haveJungle)("stretching, healing and fairness through the plugin API", () => {
  const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `jungle.${ext}`)));
  const tileset = haveJungle ? loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") }) : null;
  const doodads = haveJungle ? buildDoodadCatalogue(tileset!, part("dddata.bin"), null) : null;

  function jungle(width = 64, height = 48) {
    const loaded: LoadedTileset = {
      name: "jungle",
      tileset: tileset!,
      atlas: { image: {} as CanvasImageSource, columns: 1, tileSize: 32, count: tileset!.megatileCount, averages: new Uint32Array(tileset!.megatileCount).fill(0x336633), animation: null },
      doodads: doodads!,
    };
    primeTileset(loaded);
    const store = createStore();
    const flat = flatTerrain(width, height, { id: 2, group: 2 }, tileset, () => 0, 4);
    const scn = createScenario({ width, height, era: 4, name: "j", tiles: flat.tiles, isom: flat.isom });
    store.set(scenarioAtom, scn);
    store.set(mapTilesetAtom, "jungle");
    return { store, scn, api: createPluginApi(store, plugin, new Contributions()) };
  }
  const ramp = () => doodads!.doodads.find((d) => d.ramp)!;

  it("says which way a ramp stretches and which doodad is its mirror image", () => {
    const { api } = jungle();
    const def = ramp();
    const axes = api.palette.stretchAxes(def.id);
    expect(axes).toHaveLength(1);
    expect(["se", "ne"]).toContain(axes[0]);
    const twin = api.palette.doodadTwin(def.id)!;
    expect(twin).not.toBe(def.id);
    expect(api.palette.doodadTwin(twin)).toBe(def.id);
    expect(api.palette.stretchAxes(twin)).toEqual([axes[0] === "se" ? "ne" : "se"]);
  });

  it("lays a stretched doodad as terrain and answers its tiles", () => {
    const { scn, api } = jungle();
    const def = ramp();
    const [axis] = api.palette.stretchAxes(def.id);
    let cells: number[] = [];
    const result = api.document.edit("Wide ramp", (tx) => { cells = tx.placeStretchedDoodad(def.id, 20, 20, axis, 3); });
    expect(result.changed).toBe(true);
    // Three steps: six tiles wider, and every line of the ramp three cells longer.
    expect(cells.length).toBeGreaterThan(Array.from(def.tiles).filter((id) => id !== 0).length);
    expect(scn.doodads).toHaveLength(0);
    for (const at of cells) expect(scn.tiles[at]).toBe(scn.editorTiles[at]);
    // No stretch at all is the doodad as shipped; one that runs off the map is nothing.
    api.document.edit("Plain", (tx) => { expect(tx.placeStretchedDoodad(def.id, 2, 2, axis, 0)).toHaveLength(Array.from(def.tiles).filter((id) => id !== 0).length); });
    expect(api.document.edit("Off the map", (tx) => { expect(tx.placeStretchedDoodad(def.id, 60, 44, axis, 3)).toEqual([]); }).changed).toBe(false);
  });

  it("keeps a pinned ramp whole under the isometric brush, and finds hand-laid tiles to pin", () => {
    const { scn, api } = jungle();
    const def = ramp();
    const [axis] = api.palette.stretchAxes(def.id);
    let cells: number[] = [];
    api.document.edit("Wide ramp", (tx) => { cells = tx.placeStretchedDoodad(def.id, 20, 20, axis, 2); });
    // Laid on flat ground, it is nothing the lattice accounts for.
    const handLaid = new Set(api.terrain.handLaid());
    expect(cells.filter((at) => handLaid.has(at)).length).toBeGreaterThan(cells.length / 2);
    api.document.edit("Pin", (tx) => { expect(tx.pin(cells)).toBe(cells.length); });
    const before = cells.map((at) => scn.tiles[at]);
    const high = api.terrain.isomTypes().find((id) => id !== 2)!;
    const painted = api.document.edit("Paint over it", (tx) => {
      for (const d of api.terrain.diamondsIn({ x0: 16, y0: 16, x1: 40, y1: 32 })) tx.paintIsom(d, high);
    });
    expect(painted.tiles).toBeGreaterThan(50);
    expect(cells.map((at) => scn.tiles[at])).toEqual(before);
  });

  it("measures a join, counts the ones that show, and heals what it can", () => {
    const { scn, api } = jungle(16, 16);
    expect(api.terrain.seams()).toBe(0);
    const step = api.terrain.seamStep(scn.tiles[0], "right", scn.tiles[1])!;
    expect(step).toBeLessThan(8);
    expect(api.terrain.seamStep(0, "right", scn.tiles[1])).toBeNull();
    const def = ramp();
    api.document.edit("Ramp tiles on flat ground", (tx) => { tx.placeStretchedDoodad(def.id, 4, 4, api.palette.stretchAxes(def.id)[0], 1); });
    const shown = api.terrain.seams();
    expect(shown).toBeGreaterThan(0);
    expect(api.terrain.seams({ x0: 0, y0: 0, x1: 2, y1: 2 })).toBe(0);
    api.document.edit("Heal", (tx) => { tx.heal({ x0: 0, y0: 0, x1: 16, y1: 16 }); });
    expect(api.terrain.seams()).toBeLessThanOrEqual(shown);
  });

  it("holds the map against its image", () => {
    const { api } = jungle(32, 32);
    expect(api.terrain.symmetryShares().h).toBe(1);
    expect(api.terrain.fairness()).toBeNull(); // the symmetry tool is off
    expect(api.terrain.fairness("h")!.unlike).toBe(0);
    const def = ramp();
    api.document.edit("One side only", (tx) => { tx.placeStretchedDoodad(def.id, 2, 10, api.palette.stretchAxes(def.id)[0], 0); });
    const report = api.terrain.fairness("h")!;
    expect(report.unlike).toBeGreaterThan(0);
    expect(report.places).toHaveLength(1);
    expect(report.places[0].x0).toBeGreaterThanOrEqual(2);
    expect(api.terrain.symmetryShares().h).toBeLessThan(1);
    api.terrain.setSymmetry("h");
    expect(api.terrain.fairness()!.unlike).toBe(report.unlike);
  });
});
