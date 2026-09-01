import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, serializeScenario } from "../src/formats/chk/scenario";
import { ANYWHERE_INDEX } from "../src/formats/chk/sections/objects";
import { DIRT } from "../src/formats/tileset/terrain";
import { resizeOffset, resizePreview, resizeScenario } from "../src/editor/resize";
import { makeUnit } from "../src/editor/units";
import { makeSprite } from "../src/editor/sprites";
import { anywhereBounds } from "../src/editor/locations";

/** An 8×6 map whose tiles encode their own position, so a copy can be checked cell by cell. */
function stamped(w = 8, h = 6) {
  const tiles = new Uint16Array(w * h);
  for (let i = 0; i < tiles.length; i++) tiles[i] = 0x1000 + i;
  const scn = createScenario({ width: w, height: h, era: 0, name: "r", tiles });
  scn.mask = new Uint8Array(w * h);
  scn.dirty.clear();
  return scn;
}

const opts = (width: number, height: number, anchor: number, clampLocations = true) => ({ width, height, anchor, fill: DIRT, tileset: null, era: 0, clampLocations, random: () => 0 });

describe("resize offsets", () => {
  it("follow the anchor and keep dx even", () => {
    expect(resizeOffset(8, 6, 12, 10, 0)).toEqual({ dx: 0, dy: 0 });
    expect(resizeOffset(8, 6, 12, 10, 4)).toEqual({ dx: 2, dy: 2 });
    expect(resizeOffset(8, 6, 12, 10, 8)).toEqual({ dx: 4, dy: 4 });
    expect(resizeOffset(8, 6, 4, 4, 8)).toEqual({ dx: -4, dy: -2 });
    // Odd distances round toward zero to the next even column; rows are free.
    expect(resizeOffset(8, 6, 14, 9, 4)).toEqual({ dx: 2, dy: 1 });
    expect(resizeOffset(8, 6, 15, 9, 2)).toEqual({ dx: 6, dy: 0 });
    expect(resizeOffset(8, 6, 5, 6, 5)).toEqual({ dx: -2, dy: 0 });
  });
});

describe("resizeScenario", () => {
  it("grows around the centre, copying tiles, editor tiles and mask", () => {
    const scn = stamped();
    scn.mask![0] = 0x55;
    scn.editorTiles[9] = 0x7777;
    const r = resizeScenario(scn, opts(12, 10, 4));
    expect(r).toMatchObject({ dx: 2, dy: 2, unitsDropped: 0, spritesDropped: 0, doodadsDropped: 0, locationsClamped: 0, isomRebuilt: false });
    expect(scn.width).toBe(12);
    expect(scn.height).toBe(10);
    expect(scn.tiles.length).toBe(120);
    // Old (x, y) lands at (x + 2, y + 2).
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) expect(scn.tiles[(y + 2) * 12 + x + 2]).toBe(0x1000 + y * 8 + x);
    expect(scn.editorTiles[(1 + 2) * 12 + 1 + 2]).toBe(0x7777);
    expect(scn.mask![2 * 12 + 2]).toBe(0x55);
    expect(scn.mask![0]).toBe(0xff); // new ground is unexplored
    expect(scn.tiles[0] >> 4).toBe(DIRT.group); // filled with the terrain's left tile
    expect(scn.isom!.length).toBe((Math.floor(12 / 2) + 1) * 11 * 4);
    for (const n of ["DIM ", "MTXM", "TILE", "ISOM", "MASK", "UNIT", "THG2", "DD2 ", "MRGN"]) expect(scn.dirty.has(n), n).toBe(true);
  });

  it("crops from the bottom-right anchor and drops what falls outside", () => {
    const scn = stamped();
    scn.units.push(makeUnit(null, 0, 0, 7 * 32 + 16, 5 * 32 + 16, 1)); // bottom-right corner: kept
    scn.units.push(makeUnit(null, 0, 0, 16, 16, 2)); // top-left: cropped away
    scn.sprites.push(makeSprite("pure", 0, 0, 3 * 32, 1 * 32)); // cropped
    scn.doodads.push({ doodadId: 0, x: 6 * 32, y: 4 * 32, owner: 0, disabled: 0 });
    scn.doodads.push({ doodadId: 0, x: 1 * 32, y: 1 * 32, owner: 0, disabled: 0 });
    const r = resizeScenario(scn, opts(4, 4, 8));
    expect(r).toMatchObject({ dx: -4, dy: -2, unitsDropped: 1, spritesDropped: 1, doodadsDropped: 1 });
    expect(scn.units.length).toBe(1);
    expect(scn.units[0]).toMatchObject({ serial: 1, x: 3 * 32 + 16, y: 3 * 32 + 16 });
    expect(scn.doodads[0]).toMatchObject({ x: 2 * 32, y: 2 * 32 });
    // Old (4, 2) is the new (0, 0).
    expect(scn.tiles[0]).toBe(0x1000 + 2 * 8 + 4);
    expect(scn.tiles[15]).toBe(0x1000 + 5 * 8 + 7);
  });

  it("shifts locations, clamps on request and resets Anywhere", () => {
    const scn = stamped();
    scn.locations[0] = { left: 6 * 32, top: 4 * 32, right: 8 * 32, bottom: 6 * 32, nameIndex: 1, elevationFlags: 0 };
    scn.locations[1] = { left: 0, top: 0, right: 32, bottom: 32, nameIndex: 1, elevationFlags: 0 };
    expect(resizePreview(scn, 4, 4, 0).locationsClamped).toBe(1);
    const r = resizeScenario(scn, opts(4, 4, 0));
    expect(r.locationsClamped).toBe(1);
    expect(scn.locations[0]).toMatchObject({ left: 4 * 32, top: 4 * 32, right: 4 * 32, bottom: 4 * 32 });
    expect(scn.locations[1]).toMatchObject({ left: 0, top: 0, right: 32, bottom: 32 });
    expect(scn.locations[ANYWHERE_INDEX]).toMatchObject(anywhereBounds({ width: 4, height: 4 }));

    const loose = stamped();
    loose.locations[0] = { left: 6 * 32, top: 4 * 32, right: 8 * 32, bottom: 6 * 32, nameIndex: 1, elevationFlags: 0 };
    resizeScenario(loose, opts(4, 4, 0, false));
    expect(loose.locations[0]).toMatchObject({ left: 6 * 32, right: 8 * 32 });
  });

  it("leaves a map without ISOM or MASK without them and survives a save", () => {
    const scn = stamped();
    scn.isom = null;
    scn.mask = null;
    resizeScenario(scn, opts(12, 10, 4));
    expect(scn.isom).toBeNull();
    expect(scn.mask).toBeNull();
    expect(scn.dirty.has("ISOM")).toBe(false);
    expect(scn.dirty.has("MASK")).toBe(false);
    const back = parseScenario(serializeScenario(scn));
    expect(back.width).toBe(12);
    expect(back.tiles[(0 + 2) * 12 + 0 + 2]).toBe(0x1000);
  });
});
