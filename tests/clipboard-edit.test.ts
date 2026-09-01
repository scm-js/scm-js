import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, tilesetIndex, type Scenario } from "../src/formats/chk/scenario";
import { ANYWHERE_INDEX, isLocationUsed, SpriteFlag, type LocationRecord } from "../src/formats/chk/sections/objects";
import { loadMap } from "../src/formats/mpq/scm";
import { NO_DOODADS, type DoodadCatalogue, type DoodadDef } from "../src/formats/tileset/doodads";
import {
  clampRect, clipSummary, copyObjects, copyRegion, DEFAULT_CLIP_PARTS, ALL_CLIP_PARTS, pasteClip, regionObjects, removeObjects, selectionRect, tileRect,
  type Clip, type ClipParts,
} from "../src/editor/clipboard";
import { applyEntry, hasEdits, type HistoryEdit } from "../src/editor/history";
import { makeUnit } from "../src/editor/units";
import { makeSprite } from "../src/editor/sprites";
import { addLocation, applyLocationChanges, ensureLocationSlots, locationName, usedLocations } from "../src/editor/locations";
import { UnitRelation } from "../src/formats/chk/sections/objects";

/* ── A scenario with a bit of everything, and a two-doodad catalogue ─────────── */

const W = 16, H = 12;
const parts = (p: Partial<ClipParts>): ClipParts => ({ ...ALL_CLIP_PARTS, ...p });

/** A 2×1 tree with a sprite overlay (id 7) and a 1×1 rock without (id 9). */
function catalogue(): DoodadCatalogue {
  const tree: DoodadDef = {
    id: 7, group: 6, width: 2, height: 1, category: "Trees", flags: 0x1380, overlay: { kind: "sprite", id: 300, flipped: false },
    tiles: Uint16Array.from([0x60, 0x61]), required: Uint16Array.from([0, 0]), ramp: false,
  };
  const rock: DoodadDef = {
    id: 9, group: 8, width: 1, height: 1, category: "Rocks", flags: 0x80, overlay: null,
    tiles: Uint16Array.from([0x80]), required: Uint16Array.from([0]), ramp: false,
  };
  const doodads = [tree, rock];
  return { doodads, byId: new Map(doodads.map((d) => [d.id, d])), categories: [], hasPlacementData: false };
}

function fixture(): { scn: Scenario; cat: DoodadCatalogue } {
  const scn = createScenario({ width: W, height: H, era: 0, name: "clip" });
  const cat = catalogue();
  // Ground: tile id encodes the cell so a paste can be checked cell by cell.
  for (let i = 0; i < W * H; i++) { scn.tiles[i] = 0x20 + i; scn.editorTiles[i] = 0x20 + i; }
  // A tree at tiles (4,2)-(5,2): MTXM shows it, TILE keeps the ground; its overlay sprite sits at the centre.
  scn.tiles[2 * W + 4] = 0x60; scn.tiles[2 * W + 5] = 0x61;
  scn.doodads.push({ doodadId: 7, x: 5 * 32, y: 2 * 32 + 16, owner: 0, disabled: 0 });
  scn.sprites.push({ spriteId: 300, x: 5 * 32, y: 2 * 32 + 16, owner: 0, unused: 0, flags: 0x1380 });
  // A rock at (9,6), outside the region below.
  scn.tiles[6 * W + 9] = 0x80;
  scn.doodads.push({ doodadId: 9, x: 9 * 32 + 16, y: 6 * 32 + 16, owner: 0, disabled: 0 });
  // Units: a marine inside the region, a Command Center with an add-on link, a marine outside.
  scn.units.push(makeUnit(null, 0, 1, 3 * 32 + 16, 3 * 32 + 16, 1));
  scn.units.push({ ...makeUnit(null, 106, 2, 6 * 32, 5 * 32, 2), relationType: UnitRelation.Addon, relatedSerial: 3 });
  scn.units.push({ ...makeUnit(null, 107, 2, 8 * 32, 5 * 32, 3), relationType: UnitRelation.Addon, relatedSerial: 2 });
  scn.units.push(makeUnit(null, 0, 3, 12 * 32, 9 * 32, 4));
  // Sprites: a pure one inside, a unit sprite outside.
  scn.sprites.push(makeSprite("pure", 100, 0, 2 * 32, 4 * 32));
  scn.sprites.push(makeSprite("unit", 200, 0, 13 * 32, 2 * 32, { disabled: true }));
  // Locations: one inside the region, one straddling its edge.
  ensureLocationSlots(scn);
  applyLocationChanges(scn, addLocation(scn, { left: 2 * 32, top: 2 * 32, right: 4 * 32, bottom: 4 * 32 }, "Base").changes);
  applyLocationChanges(scn, addLocation(scn, { left: 6 * 32, top: 6 * 32, right: 10 * 32, bottom: 8 * 32 }, "Edge").changes);
  // Fog: player 1 explored in the top-left corner.
  scn.mask = new Uint8Array(W * H).fill(0xff);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) scn.mask[y * W + x] = 0xfe;
  scn.dirty.clear();
  return { scn, cat };
}

/** The region tests copy: tiles (2,2) to (7,6) inclusive. */
const REGION = tileRect({ x: 2, y: 2 }, { x: 7, y: 6 });

function snapshot(scn: Scenario) {
  return {
    tiles: Array.from(scn.tiles), ground: Array.from(scn.editorTiles), mask: scn.mask ? Array.from(scn.mask) : null,
    units: structuredClone(scn.units), sprites: structuredClone(scn.sprites), doodads: structuredClone(scn.doodads),
    locations: structuredClone(scn.locations), strings: [...scn.strings.strings],
  };
}

const bounds = (l: LocationRecord) => ({ left: l.left, top: l.top, right: l.right, bottom: l.bottom });

describe("regions", () => {
  it("builds inclusive tile rectangles from marquee corners and clamps them to the map", () => {
    expect(tileRect({ x: 5, y: 3 }, { x: 2, y: 4 })).toEqual({ x0: 2, y0: 3, x1: 6, y1: 5 });
    expect(clampRect({ x0: -2, y0: 10, x1: 20, y1: 14 }, { width: W, height: H })).toEqual({ x0: 0, y0: 10, x1: W, y1: H });
  });

  it("picks units and sprites by centre, doodads and locations when wholly inside, and never a doodad's overlay", () => {
    const { scn, cat } = fixture();
    const sel = regionObjects(scn, REGION, cat);
    expect(sel.units).toEqual([0, 1]);
    expect(sel.doodads).toEqual([0]);
    expect(sel.sprites).toEqual([1]); // the pure sprite at (2,4); sprite 0 is the tree's overlay
    expect(sel.locations).toEqual([0]); // "Base"; "Edge" straddles the boundary, Anywhere is never picked
    expect(selectionRect(scn, sel, cat)).toEqual({ x0: 2, y0: 2, x1: 7, y1: 6 }); // the Command Center at tile (6,5) reaches the bottom
  });
});

describe("copy", () => {
  it("captures both tile layers, fog, and objects with positions relative to the origin", () => {
    const { scn, cat } = fixture();
    const clip = copyRegion(scn, REGION, ALL_CLIP_PARTS, cat)!;
    expect([clip.width, clip.height, clip.era]).toEqual([6, 5, 0]);
    expect(clip.tiles![0]).toBe(0x20 + 2 * W + 2);
    expect(clip.tiles![2]).toBe(0x60); // the tree's left tile at clip cell (2,0)
    expect(clip.ground![2]).toBe(0x20 + 2 * W + 4); // TILE still holds the ground
    expect(clip.fog![0]).toBe(0xfe);
    expect(clip.fog![5]).toBe(0xff);
    expect(clip.doodads).toEqual([{ doodadId: 7, x: 3 * 32, y: 16, owner: 0, disabled: 0 }]);
    expect(clip.units.map((u) => [u.unitId, u.x, u.y])).toEqual([[0, 48, 48], [106, 4 * 32, 3 * 32]]);
    expect(clip.sprites.map((s) => [s.spriteId, s.x, s.y])).toEqual([[100, 0, 2 * 32]]);
    expect(clip.locations).toEqual([{ left: 0, top: 0, right: 64, bottom: 64, elevationFlags: 0, name: "Base" }]);
    expect(clipSummary(clip)).toBe("6×5 tiles · 1 doodad · 2 units · 1 sprite · 1 location · fog");
  });

  it("leaves out the parts not included, and returns null for a rectangle off the map", () => {
    const { scn, cat } = fixture();
    const clip = copyRegion(scn, REGION, parts({ terrain: false, fog: false, units: false }), cat)!;
    expect(clip.tiles).toBeNull();
    expect(clip.fog).toBeNull();
    expect(clip.units).toEqual([]);
    expect(clip.doodads).toHaveLength(1);
    expect(copyRegion(scn, { x0: 20, y0: 0, x1: 24, y1: 4 }, ALL_CLIP_PARTS, cat)).toBeNull();
  });

  it("copies a selection as its bounding box with only those objects", () => {
    const { scn, cat } = fixture();
    const clip = copyObjects(scn, { units: [1, 2], sprites: [], doodads: [], locations: [] }, DEFAULT_CLIP_PARTS, cat)!;
    expect([clip.width, clip.height]).toEqual([3, 1]);
    expect(clip.tiles).toBeNull();
    expect(clip.units.map((u) => [u.unitId, u.x, u.y])).toEqual([[106, 0, 0], [107, 64, 0]]);
    expect(copyObjects(scn, { units: [], sprites: [], doodads: [], locations: [] }, DEFAULT_CLIP_PARTS, cat)).toBeNull();
  });
});

describe("paste", () => {
  function pasted(clip: Clip, tx: number, ty: number, opts: Partial<Parameters<typeof pasteClip>[4]> = {}) {
    const { scn, cat } = fixture();
    const before = snapshot(scn);
    const result = pasteClip(scn, clip, tx, ty, { parts: ALL_CLIP_PARTS, mode: "merge", catalogue: cat, tileset: null, ...opts });
    return { scn, cat, before, result };
  }

  it("reproduces the picture, the ground and everything on it at the new origin, with fresh serials and remapped links", () => {
    const src = fixture();
    const clip = copyRegion(src.scn, REGION, ALL_CLIP_PARTS, src.cat)!;
    const { scn, result } = pasted(clip, 8, 6);
    expect(result.notes).toEqual([]);
    // The rock at (9,6) stood in the target area and lost its tile to the new ground, so it went.
    expect(result.counts).toMatchObject({ tiles: 30, doodads: 1, units: 2, sprites: 1, locations: 1, fog: 4, removed: 1 });
    expect(scn.doodads.some((d) => d.doodadId === 9)).toBe(false);
    // Tiles: the clip's cell (x, y) is now at (8 + x, 6 + y); the tree shows in MTXM and the ground stays in TILE.
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 6; x++) {
        expect(scn.tiles[(6 + y) * W + 8 + x]).toBe(clip.tiles![y * 6 + x]);
        expect(scn.editorTiles[(6 + y) * W + 8 + x]).toBe(clip.ground![y * 6 + x]);
      }
    }
    // The doodad record and its overlay were regenerated at the new centre.
    expect(scn.doodads.at(-1)).toEqual({ doodadId: 7, x: 11 * 32, y: 6 * 32 + 16, owner: 0, disabled: 0 });
    expect(scn.sprites.at(-2)).toMatchObject({ spriteId: 300, x: 11 * 32, y: 6 * 32 + 16, flags: 0x1380 });
    expect(scn.sprites.at(-1)).toMatchObject({ spriteId: 100, x: 8 * 32, y: 8 * 32, flags: SpriteFlag.PureSprite });
    // Units: new serials past the map's highest; the Command Center's add-on link pointed at a unit outside the clip, so it is dropped.
    const marine = scn.units.at(-2)!, cc = scn.units.at(-1)!;
    expect([marine.unitId, marine.x, marine.y, marine.serial]).toEqual([0, 9 * 32 + 16, 7 * 32 + 16, 5]);
    expect([cc.unitId, cc.serial, cc.relationType, cc.relatedSerial]).toEqual([106, 6, 0, 0]);
    // The location took the next free slot with its name and the offset box.
    const slot = usedLocations(scn).filter((i) => i !== ANYWHERE_INDEX).at(-1)!;
    expect(locationName(scn, slot)).toBe("Base");
    expect(bounds(scn.locations[slot])).toEqual({ left: 8 * 32, top: 6 * 32, right: 10 * 32, bottom: 8 * 32 });
    // Fog: the explored 2×2 corner of the clip landed at (8,6).
    expect(scn.mask![6 * W + 8]).toBe(0xfe);
    expect(scn.mask![7 * W + 9]).toBe(0xfe);
    expect(scn.mask![8 * W + 8]).toBe(0xff);
    // "Base" was already in the string table, so the name was reused and STR stays clean.
    expect([...scn.dirty].sort()).toEqual(["DD2 ", "MASK", "MRGN", "MTXM", "THG2", "TILE", "UNIT"]);
  });

  it("keeps add-on links between units that travel together", () => {
    const src = fixture();
    const clip = copyObjects(src.scn, { units: [1, 2], sprites: [], doodads: [], locations: [] }, DEFAULT_CLIP_PARTS, src.cat)!;
    const { scn } = pasted(clip, 0, 0);
    const [cc, addon] = scn.units.slice(-2);
    expect(cc.relatedSerial).toBe(addon.serial);
    expect(addon.relatedSerial).toBe(cc.serial);
    expect(cc.relationType).toBe(UnitRelation.Addon);
  });

  it("undoes and redoes as one entry, byte for byte", () => {
    const src = fixture();
    const clip = copyRegion(src.scn, REGION, ALL_CLIP_PARTS, src.cat)!;
    const { scn, before, result } = pasted(clip, 5, 3, { mode: "replace" });
    expect(result.counts.removed).toBeGreaterThan(0);
    const after = snapshot(scn);
    expect(hasEdits(result.edit)).toBe(true);
    applyEntry(scn, result.edit, "undo");
    expect(snapshot(scn)).toEqual(before);
    applyEntry(scn, result.edit, "do");
    expect(snapshot(scn)).toEqual(after);
    applyEntry(scn, result.edit, "undo");
    expect(snapshot(scn)).toEqual(before);
  });

  it("pasting a region back onto itself changes nothing in merge mode but the duplicates it adds", () => {
    const src = fixture();
    const clip = copyRegion(src.scn, REGION, ALL_CLIP_PARTS, src.cat)!;
    const { scn, before, result } = pasted(clip, REGION.x0, REGION.y0);
    expect(result.edit.changes).toEqual([]);
    expect(result.edit.doodadTiles ?? []).toEqual([]);
    expect(result.edit.fog ?? []).toEqual([]);
    expect(result.counts.removed).toBe(0);
    expect(Array.from(scn.tiles)).toEqual(before.tiles);
    expect(scn.units).toHaveLength(before.units.length + 2);
    expect(scn.doodads).toHaveLength(before.doodads.length + 1);
  });

  it("replace mode clears the area's units, sprites and doodads first, so a self-paste is a no-op in counts", () => {
    const src = fixture();
    const clip = copyRegion(src.scn, REGION, ALL_CLIP_PARTS, src.cat)!;
    const { scn, before, result } = pasted(clip, REGION.x0, REGION.y0, { mode: "replace" });
    expect(result.counts.removed).toBe(4); // 2 units, the pure sprite, the tree
    expect(scn.units).toHaveLength(before.units.length);
    expect(scn.sprites).toHaveLength(before.sprites.length);
    expect(scn.doodads).toHaveLength(before.doodads.length);
    expect(Array.from(scn.tiles)).toEqual(before.tiles);
    expect(Array.from(scn.editorTiles)).toEqual(before.ground);
    // Locations are never cleared by a paste: the copy of "Base" is added beside the original.
    expect(usedLocations(scn).length).toBe(before.locations.filter(isLocationUsed).length + 1);
  });

  it("removes a doodad the new ground cuts through, restoring its cells outside the paste", () => {
    const src = fixture();
    const clip = copyRegion(src.scn, { x0: 0, y0: 8, x1: 2, y1: 10 }, parts({ doodads: false }), src.cat)!; // plain ground
    // Paste over the tree's left tile only: the tree is stranded, its right tile goes back to the ground.
    const { scn, result } = pasted(clip, 3, 2);
    expect(result.counts.removed).toBe(1);
    expect(scn.doodads.some((d) => d.doodadId === 7)).toBe(false);
    expect(scn.sprites.some((s) => s.spriteId === 300)).toBe(false);
    expect(scn.tiles[2 * W + 5]).toBe(0x20 + 2 * W + 5);
    expect(scn.tiles[2 * W + 4]).toBe(clip.ground![1]); // clip cell (1,0)
  });

  it("pastes the ground under the doodads when doodads are left out, and the doodads' own tiles when terrain is", () => {
    const src = fixture();
    const clip = copyRegion(src.scn, REGION, ALL_CLIP_PARTS, src.cat)!;
    const groundOnly = pasted(clip, 8, 6, { parts: parts({ doodads: false }) });
    expect(groundOnly.scn.tiles[6 * W + 10]).toBe(clip.ground![2]);
    expect(groundOnly.scn.doodads.map((d) => d.doodadId)).toEqual([7]); // the rock at (9,6) lost its tile to the ground
    const doodadsOnly = pasted(clip, 8, 6, { parts: parts({ terrain: false }) });
    expect(doodadsOnly.scn.tiles[6 * W + 10]).toBe(0x60);
    expect(doodadsOnly.scn.tiles[6 * W + 11]).toBe(0x61);
    expect(doodadsOnly.scn.editorTiles[6 * W + 10]).toBe(0x20 + 6 * W + 10); // TILE untouched
    expect(doodadsOnly.scn.tiles[6 * W + 8]).toBe(0x20 + 6 * W + 8); // no ground pasted
    expect(doodadsOnly.result.edit.changes).toEqual([]);
  });

  it("clips at the map edge: tiles cell by cell, objects whole, with a note", () => {
    const src = fixture();
    const clip = copyRegion(src.scn, REGION, ALL_CLIP_PARTS, src.cat)!;
    const { scn, result } = pasted(clip, 13, 9);
    expect(result.counts.tiles).toBe(3 * 3);
    expect(scn.tiles[9 * W + 13]).toBe(clip.tiles![0]);
    // The tree's origin would be at (16, 11): off the map, so it and the units that land past the edge are skipped.
    expect(result.counts.doodads).toBe(0);
    expect(result.counts.units).toBe(1);
    expect(result.notes.join("; ")).toMatch(/doodad.*not pasted/);
    expect(result.notes.join("; ")).toMatch(/1 unit off the map/);
    expect(pasteClip(scn, clip, 40, 40, { parts: ALL_CLIP_PARTS, mode: "merge", catalogue: src.cat, tileset: null }).notes[0]).toMatch(/off the map/);
  });

  it("refuses terrain and doodads from another tileset but still pastes the objects", () => {
    const src = fixture();
    const clip = { ...copyRegion(src.scn, REGION, ALL_CLIP_PARTS, src.cat)!, era: 3 };
    const { scn, before, result } = pasted(clip, 8, 6);
    expect(result.notes[0]).toMatch(/different tileset/);
    expect(Array.from(scn.tiles)).toEqual(before.tiles);
    expect(scn.doodads).toHaveLength(before.doodads.length);
    expect(result.counts.units).toBe(2);
  });

  it("creates the MASK section for a map without one and undo removes it again", () => {
    const src = fixture();
    const clip = copyRegion(src.scn, REGION, ALL_CLIP_PARTS, src.cat)!;
    const { scn, cat } = fixture();
    scn.mask = null;
    const result = pasteClip(scn, clip, 0, 0, { parts: parts({ fog: true }), mode: "merge", catalogue: cat, tileset: null });
    expect(result.edit.createdMask).toBeDefined();
    expect(scn.mask![0]).toBe(0xfe);
    applyEntry(scn, result.edit, "undo");
    expect(scn.mask).toBeNull();
  });

  it("stops at a full location table and says so", () => {
    const src = fixture();
    const clip = copyRegion(src.scn, REGION, ALL_CLIP_PARTS, src.cat)!;
    const { scn, cat } = fixture();
    ensureLocationSlots(scn);
    scn.locations.forEach((l, i) => { if (i !== ANYWHERE_INDEX && !isLocationUsed(l)) scn.locations[i] = { ...l, right: 32, bottom: 32 }; });
    const result = pasteClip(scn, clip, 0, 0, { parts: parts({ locations: true }), mode: "merge", catalogue: cat, tileset: null });
    expect(result.counts.locations).toBe(0);
    expect(result.notes.join()).toMatch(/every slot is in use/);
  });
});

describe("cut", () => {
  it("removes the region's objects — the tree with its tiles and overlay — and leaves terrain and fog alone", () => {
    const { scn, cat } = fixture();
    const before = snapshot(scn);
    const sel = regionObjects(scn, REGION, cat);
    const edit: HistoryEdit = removeObjects(scn, sel, cat, null);
    expect(scn.units.map((u) => u.serial)).toEqual([3, 4]);
    expect(scn.sprites.map((s) => s.spriteId)).toEqual([200]);
    expect(scn.doodads.map((d) => d.doodadId)).toEqual([9]);
    expect(scn.tiles[2 * W + 4]).toBe(0x20 + 2 * W + 4); // ground back under the tree
    expect(isLocationUsed(scn.locations[0])).toBe(false);
    expect(scn.mask![0]).toBe(0xfe);
    applyEntry(scn, edit, "undo");
    expect(snapshot(scn)).toEqual(before);
  });

  it("follows sprite indices that shift when an overlay goes first", () => {
    const { scn, cat } = fixture();
    // Sprite 0 is the tree's overlay, sprite 1 the pure sprite: removing the tree shifts the pure one down to 0.
    const edit = removeObjects(scn, { units: [], sprites: [1], doodads: [0], locations: [] }, cat, null);
    expect(scn.sprites.map((s) => s.spriteId)).toEqual([200]);
    expect(edit.sprites!.map((c) => [c.index, c.before!.spriteId])).toEqual([[0, 300], [0, 100]]);
  });
});

/* ── Real maps: a region copied to a blank map of the same tileset comes back identical ── */

const mapsDir = join(__dirname, "..", "fixtures", "maps");
const realMap = join(mapsDir, "(4)Crescent Moon.scx");

describe.skipIf(!existsSync(realMap))("fixture maps", () => {
  it("round-trips a region through a blank map and self-pastes without changing a tile", async () => {
    const src = parseScenario((await loadMap(new Uint8Array(readFileSync(realMap)))).chk);
    // A 32×24 window around the first unit, so the clip is sure to carry some.
    const u0 = src.units[0];
    const region = clampRect({ x0: (u0.x >> 5) - 16, y0: (u0.y >> 5) - 12, x1: (u0.x >> 5) + 16, y1: (u0.y >> 5) + 12 }, src);
    const clip = copyRegion(src, region, ALL_CLIP_PARTS, NO_DOODADS)!;
    expect(clip.units.length).toBeGreaterThan(0);
    const blank = createScenario({ width: src.width, height: src.height, era: tilesetIndex(src), name: "blank" });
    const result = pasteClip(blank, clip, region.x0, region.y0, { parts: ALL_CLIP_PARTS, mode: "merge", catalogue: NO_DOODADS, tileset: null });
    expect(result.notes).toEqual([]);
    for (let y = region.y0; y < region.y1; y++) {
      for (let x = region.x0; x < region.x1; x++) {
        expect(blank.tiles[y * src.width + x]).toBe(src.tiles[y * src.width + x]);
        expect(blank.editorTiles[y * src.width + x]).toBe(src.editorTiles[y * src.width + x]);
      }
    }
    expect(blank.units.map((u) => [u.unitId, u.x, u.y, u.owner])).toEqual(clip.units.map((u) => [u.unitId, u.x + region.x0 * 32, u.y + region.y0 * 32, u.owner]));
    // Back onto the source in replace mode: same picture, same counts.
    const before = snapshot(src);
    const again = pasteClip(src, clip, region.x0, region.y0, { parts: ALL_CLIP_PARTS, mode: "replace", catalogue: NO_DOODADS, tileset: null });
    expect(again.edit.changes).toEqual([]);
    expect(src.units).toHaveLength(before.units.length);
    expect(src.sprites).toHaveLength(before.sprites.length);
    applyEntry(src, again.edit, "undo");
    expect(snapshot(src)).toEqual(before);
  });
});
