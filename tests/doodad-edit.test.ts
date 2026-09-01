import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, serializeScenario, tilesetIndex, type Scenario } from "../src/formats/chk/scenario";
import { SpriteFlag } from "../src/formats/chk/sections/objects";
import { loadMap } from "../src/formats/mpq/scm";
import { decodeCv5, DoodadFlag, loadTileset, type Tileset } from "../src/formats/tileset/decode";
import { buildDoodadCatalogue, DDDATA_SIZE, doodadCenter, doodadOrigin, type DoodadCatalogue } from "../src/formats/tileset/doodads";
import { TILESET_FILENAMES } from "../src/formats/tileset/load";
import { decodeTbl } from "../src/formats/dat/tbl";
import { applyChanges, mirrorEditorTiles, stampTile } from "../src/editor/terrain";
import {
  applyDoodadChanges, applySpriteChanges, checkDoodadPlacement, DEFAULT_DOODAD_PLACEMENT, doodadAt, doodadsInBox, groundUnder, placeDoodad,
  removeDoodads, snapDoodad, strandedDoodads, updateDoodads, type DoodadEdit,
} from "../src/editor/doodads";

/* ── A synthetic tileset: 2 flat pairs, a 2×1 tree with a sprite overlay, a 4×2 ramp ── */

const CV5 = 52;
function group(index: number, flags: number, megatiles: number[], doodad?: { overlay: number; name: number; dd: number; w: number; h: number }): Uint8Array {
  const out = new Uint8Array(CV5);
  const v = new DataView(out.buffer);
  v.setUint16(0, index, true);
  v.setUint16(2, flags, true);
  if (doodad) {
    v.setUint16(4, doodad.overlay, true);
    v.setUint16(8, doodad.name, true);
    v.setUint16(12, doodad.dd, true);
    v.setUint16(14, doodad.w, true);
    v.setUint16(16, doodad.h, true);
  } else {
    for (let i = 4; i < 12; i += 2) v.setUint16(i, index, true); // flat: all four edges equal
  }
  megatiles.forEach((m, i) => v.setUint16(20 + i * 2, m, true));
  return out;
}

/** Groups 0–1 unused, 2/3 = dirt (ISOM id 2), 4/5 = grass (id 3), 6–7 tree (dd 7), 8–9 ramp (dd 9). */
function syntheticTileset(): Tileset {
  const groups = [
    group(0, 0, []), group(0, 0, []),
    group(2, 0, [1, 2, 3]), group(2, 0, [4, 5, 6]),
    group(3, 0, [7, 8]), group(3, 0, [9, 10]),
    // tree: 2×1, sprite overlay 300, category name 1
    group(1, 0x1380, [11, 12], { overlay: 300, name: 1, dd: 7, w: 2, h: 1 }),
    group(1, 0x1380, [], { overlay: 300, name: 1, dd: 7, w: 2, h: 1 }),
    // ramp: 4×2, no overlay, category name 2; the top row has no tile in its last two cells
    group(1, 0x80, [13, 14, 0, 0], { overlay: 0, name: 2, dd: 9, w: 4, h: 2 }),
    group(1, 0x80, [15, 16, 17, 18], { overlay: 0, name: 2, dd: 9, w: 4, h: 2 }),
  ];
  const cv5 = new Uint8Array(groups.length * CV5);
  groups.forEach((g, i) => cv5.set(g, i * CV5));
  const megatiles = 19;
  // The ramp's bottom-left megatile (15) carries the VF4 ramp bit on one minitile.
  const vf4 = new Uint8Array(megatiles * 32);
  new DataView(vf4.buffer).setUint16(15 * 32 + 6 * 2, 0x0001 | 0x0010, true);
  return loadTileset({
    cv5,
    vf4,
    vr4: new Uint8Array(64),
    vx4: new Uint8Array(megatiles * 32),
    wpe: new Uint8Array(1024),
  });
}

function syntheticDdData(): Uint8Array {
  const dd = new Uint8Array(DDDATA_SIZE);
  const v = new DataView(dd.buffer);
  // tree (dd 7): both cells want dirt, left/right groups.
  v.setUint16((7 * 256 + 0) * 2, 2, true);
  v.setUint16((7 * 256 + 1) * 2, 3, true);
  // ramp (dd 9): top row wants grass on its two tile-less cells, bottom row wants dirt.
  const ramp = [0, 0, 4, 5, 2, 3, 2, 3];
  ramp.forEach((r, i) => v.setUint16((9 * 256 + i) * 2, r, true));
  return dd;
}

const NAMES = ["Trees", "Ramps"];

/** A 16×8 map of dirt pairs (2/3 slot 0), with a TILE copy. */
function fresh(): Scenario {
  const tiles = new Uint16Array(16 * 8);
  for (let i = 0; i < tiles.length; i++) tiles[i] = (i % 16) % 2 === 0 ? 0x20 : 0x30;
  const scn = createScenario({ name: "t", description: "", width: 16, height: 8, era: 4, tiles });
  scn.dirty.clear();
  return scn;
}

function applyEdit(scn: Scenario, edit: DoodadEdit, direction: "do" | "undo" = "do") {
  if (direction === "do") {
    applyChanges(scn, edit.tiles, "do", "mtxm");
    applyDoodadChanges(scn, edit.doodads, "do");
    applySpriteChanges(scn, edit.sprites, "do");
  } else {
    applySpriteChanges(scn, edit.sprites, "undo");
    applyDoodadChanges(scn, edit.doodads, "undo");
    applyChanges(scn, edit.tiles, "undo", "mtxm");
  }
}

const ts = syntheticTileset();
const cat = buildDoodadCatalogue(ts, syntheticDdData(), NAMES);
const tree = cat.byId.get(7)!;
const ramp = cat.byId.get(9)!;
const opts = DEFAULT_DOODAD_PLACEMENT;

describe("doodad catalogue", () => {
  it("reads one doodad per dddata index, a row per group, and names its category", () => {
    expect(cat.doodads.map((d) => d.id)).toEqual([7, 9]);
    expect(tree).toMatchObject({ group: 6, width: 2, height: 1, category: "Trees", flags: 0x1380 });
    expect(tree.overlay).toEqual({ kind: "sprite", id: 300, flipped: false });
    expect([...tree.tiles]).toEqual([0x60, 0x61]);
    expect([...tree.required]).toEqual([2, 3]);
    expect(ramp).toMatchObject({ group: 8, width: 4, height: 2, category: "Ramps", overlay: null, ramp: true });
    expect(tree.ramp).toBe(false);
    expect([...ramp.tiles]).toEqual([0x80, 0x81, 0, 0, 0x90, 0x91, 0x92, 0x93]);
    expect([...ramp.required]).toEqual([0, 0, 4, 5, 2, 3, 2, 3]);
    expect(cat.categories.map((c) => c.name)).toEqual(["Trees", "Ramps"]);
    expect(cat.hasPlacementData).toBe(true);
  });

  it("works without dddata or names: no requirements, one unlisted category", () => {
    const bare = buildDoodadCatalogue(ts, null, null);
    expect(bare.hasPlacementData).toBe(false);
    expect(bare.byId.get(9)!.required.every((r) => r === 0)).toBe(true);
    expect(bare.categories.map((c) => c.name)).toEqual(["Unlisted"]);
  });

  it("decodes the doodad record from the CV5 bytes", () => {
    const groups = decodeCv5(ts.groups.length ? syntheticTileset().groups && new Uint8Array(0) : new Uint8Array(0));
    expect(groups).toEqual([]);
    expect(ts.groups[6].doodad).toEqual({ overlay: 300, nameIndex: 1, ddData: 7, width: 2, height: 1 });
    expect(ts.groups[2].doodad).toBeUndefined();
    expect(DoodadFlag.SpriteOverlay & 0x1380).toBeTruthy();
  });

  it("converts between the DD2 centre and the top-left tile", () => {
    expect(doodadCenter(tree, 4, 3)).toEqual({ x: 4 * 32 + 32, y: 3 * 32 + 16 });
    expect(doodadOrigin(tree, 160, 112)).toEqual({ x: 4, y: 3 });
    expect(doodadOrigin(ramp, 6 * 32 + 64, 2 * 32 + 32)).toEqual({ x: 6, y: 2 });
  });
});

describe("snapping", () => {
  it("centres the footprint on the pointer, keeps the left column even, and stays in the map", () => {
    expect(snapDoodad(tree, 5 * 32 + 16, 3 * 32 + 16, 16, 8)).toEqual({ x: 4, y: 3 });
    expect(snapDoodad(tree, 6 * 32 + 20, 3 * 32 + 16, 16, 8)).toEqual({ x: 6, y: 3 });
    expect(snapDoodad(tree, 5 * 32 + 16, 3 * 32 + 16, 16, 8, false)).toEqual({ x: 4, y: 3 });
    expect(snapDoodad(tree, 5 * 32 + 24, 3 * 32 + 16, 16, 8, false)).toEqual({ x: 5, y: 3 });
    expect(snapDoodad(ramp, 0, 0, 16, 8)).toEqual({ x: 0, y: 0 });
    expect(snapDoodad(ramp, 16 * 32, 8 * 32, 16, 8)).toEqual({ x: 12, y: 6 });
    // An odd-width map: the snapped maximum stays even.
    expect(snapDoodad(tree, 15 * 32, 0, 15, 8)).toEqual({ x: 12, y: 0 });
    expect(snapDoodad(tree, 15 * 32, 0, 15, 8, false)).toEqual({ x: 13, y: 0 });
  });
});

describe("placement checks", () => {
  it("accepts matching ground and refuses the rest, naming the cells", () => {
    const scn = fresh();
    expect(checkDoodadPlacement(scn, ts, tree, 4, 3, opts)).toEqual({ ok: true, outOfBounds: false, bad: [] });
    // Off the pair grid the left cell sees the right dirt group.
    expect(checkDoodadPlacement(scn, ts, tree, 5, 3, opts).bad).toEqual([0, 1]);
    // The ramp wants grass under its top-right cells: not on plain dirt.
    expect(checkDoodadPlacement(scn, ts, ramp, 4, 2, opts).bad).toEqual([2, 3]);
    applyChanges(scn, stampTile(scn, [2 * 16 + 6, 2 * 16 + 7], 0x40));
    scn.tiles[2 * 16 + 7] = 0x50;
    expect(checkDoodadPlacement(scn, ts, ramp, 4, 2, opts).ok).toBe(true);
  });

  it("never allows the footprint off the map, place-anywhere included", () => {
    const scn = fresh();
    const anywhere = { placeAnywhere: true, snapToGrid: false };
    expect(checkDoodadPlacement(scn, ts, ramp, 14, 0, anywhere)).toMatchObject({ ok: false, outOfBounds: true });
    expect(checkDoodadPlacement(scn, ts, ramp, 4, 7, anywhere)).toMatchObject({ ok: false, outOfBounds: true });
    expect(checkDoodadPlacement(scn, ts, tree, 5, 3, anywhere).ok).toBe(true);
  });

  it("refuses to bury another doodad unless placing anywhere", () => {
    const scn = fresh();
    applyEdit(scn, placeDoodad(scn, tree, 4, 3, 0));
    expect(checkDoodadPlacement(scn, ts, tree, 4, 3, opts).bad).toEqual([0, 1]);
    expect(checkDoodadPlacement(scn, ts, tree, 4, 3, { ...opts, placeAnywhere: true }).ok).toBe(true);
    // The ramp's tile-less top-right cells may sit over a tree when nothing is required there;
    // its bottom row, which has tiles, may not.
    const bare = buildDoodadCatalogue(ts, null, null).byId.get(9)!;
    applyEdit(scn, placeDoodad(scn, tree, 4, 1, 0));
    expect(checkDoodadPlacement(scn, ts, bare, 2, 1, opts).ok).toBe(true);
    expect(checkDoodadPlacement(scn, ts, bare, 2, 0, opts).ok).toBe(false);
  });

  it("checks a supplied view of the tiles, for moves", () => {
    const scn = fresh();
    applyEdit(scn, placeDoodad(scn, tree, 4, 3, 0));
    const lifted = removeDoodads(scn, ts, cat, [0]);
    const under = new Map(lifted.tiles.map((c) => [c.at, c.after]));
    expect(checkDoodadPlacement(scn, ts, tree, 4, 3, opts, (at) => under.get(at) ?? scn.tiles[at]).ok).toBe(true);
  });
});

describe("placing and removing", () => {
  it("stamps MTXM only, adds a DD2 record and the overlay sprite with the CV5 flags", () => {
    const scn = fresh();
    const edit = placeDoodad(scn, tree, 4, 3, 5);
    expect(edit.tiles).toEqual([
      { at: 3 * 16 + 4, before: 0x20, after: 0x60 },
      { at: 3 * 16 + 5, before: 0x30, after: 0x61 },
    ]);
    applyEdit(scn, edit);
    expect(scn.tiles[3 * 16 + 4]).toBe(0x60);
    expect(scn.editorTiles[3 * 16 + 4]).toBe(0x20);
    expect(scn.doodads).toEqual([{ doodadId: 7, x: 4 * 32 + 32, y: 3 * 32 + 16, owner: 5, disabled: 0 }]);
    expect(scn.sprites).toEqual([{ spriteId: 300, x: 4 * 32 + 32, y: 3 * 32 + 16, owner: 5, unused: 0, flags: 0x1380 }]);
    expect(scn.sprites[0].flags & SpriteFlag.PureSprite).toBeTruthy();
    expect([...scn.dirty].sort()).toEqual(["DD2 ", "MTXM", "THG2", "TILE"]);
  });

  it("skips the cells a doodad has no tile for", () => {
    const scn = fresh();
    const edit = placeDoodad(scn, ramp, 4, 2, 0);
    expect(edit.tiles.map((c) => c.at)).toEqual([2 * 16 + 4, 2 * 16 + 5, 3 * 16 + 4, 3 * 16 + 5, 3 * 16 + 6, 3 * 16 + 7]);
    expect(edit.sprites).toEqual([]);
  });

  it("removal restores the ground from TILE and drops the record and its sprite; undo brings all back", () => {
    const scn = fresh();
    applyEdit(scn, placeDoodad(scn, tree, 4, 3, 0));
    applyEdit(scn, placeDoodad(scn, ramp, 8, 2, 0));
    scn.dirty.clear();
    const gone = removeDoodads(scn, ts, cat, [0]);
    expect(gone.doodads).toEqual([{ index: 0, before: scn.doodads[0], after: null }]);
    expect(gone.sprites).toEqual([{ index: 0, before: scn.sprites[0], after: null }]);
    expect(gone.tiles).toEqual([
      { at: 3 * 16 + 4, before: 0x60, after: 0x20 },
      { at: 3 * 16 + 5, before: 0x61, after: 0x30 },
    ]);
    applyEdit(scn, gone);
    expect(scn.doodads).toHaveLength(1);
    expect(scn.doodads[0].doodadId).toBe(9);
    expect(scn.sprites).toHaveLength(0);
    expect(scn.tiles[3 * 16 + 4]).toBe(0x20);
    applyEdit(scn, gone, "undo");
    expect(scn.doodads.map((d) => d.doodadId)).toEqual([7, 9]);
    expect(scn.sprites).toHaveLength(1);
    expect(scn.tiles[3 * 16 + 5]).toBe(0x61);
  });

  it("orders multi-removals highest index first so the indices stay valid", () => {
    const scn = fresh();
    applyEdit(scn, placeDoodad(scn, tree, 0, 0, 0));
    applyEdit(scn, placeDoodad(scn, tree, 2, 0, 0));
    applyEdit(scn, placeDoodad(scn, tree, 4, 0, 0));
    const gone = removeDoodads(scn, ts, cat, [0, 2, 0]);
    expect(gone.doodads.map((c) => c.index)).toEqual([2, 0]);
    expect(gone.sprites.map((c) => c.index)).toEqual([2, 0]);
    applyEdit(scn, gone);
    expect(scn.doodads.map((d) => d.x)).toEqual([2 * 32 + 32]);
    expect(scn.sprites.map((s) => s.x)).toEqual([2 * 32 + 32]);
  });

  it("leaves a cell alone when something else was laid over the doodad since", () => {
    const scn = fresh();
    applyEdit(scn, placeDoodad(scn, tree, 4, 3, 0));
    scn.tiles[3 * 16 + 5] = 0x41; // a hand-placed tile over the right half
    const gone = removeDoodads(scn, ts, cat, [0]);
    expect(gone.tiles.map((c) => c.at)).toEqual([3 * 16 + 4]);
  });

  it("falls back to the required group when TILE also holds a doodad tile", () => {
    const scn = fresh();
    applyEdit(scn, placeDoodad(scn, tree, 4, 3, 0));
    scn.editorTiles[3 * 16 + 4] = 0x60; // an editor that wrote doodads into TILE too
    const restored = groundUnder(scn, ts, tree, 0, 3 * 16 + 4, () => 0);
    expect(restored >> 4).toBe(2);
    // No requirement and no ground on record: the tile stays.
    const bare = buildDoodadCatalogue(ts, null, null).byId.get(7)!;
    expect(groundUnder(scn, ts, bare, 0, 3 * 16 + 4)).toBe(0x60);
  });

  it("re-owns and disables through the record and its overlay sprite", () => {
    const scn = fresh();
    applyEdit(scn, placeDoodad(scn, tree, 4, 3, 0));
    const edit = updateDoodads(scn, cat, [0], { owner: 11, disabled: 1 });
    applyEdit(scn, edit);
    expect(scn.doodads[0]).toMatchObject({ owner: 11, disabled: 1 });
    expect(scn.sprites[0].owner).toBe(11);
    expect(scn.sprites[0].flags & SpriteFlag.Disabled).toBeTruthy();
    expect(updateDoodads(scn, cat, [0], { owner: 11 }).doodads).toEqual([]);
  });
});

describe("picking", () => {
  it("finds the topmost doodad with a tile on a cell, and footprints in a box", () => {
    const scn = fresh();
    applyEdit(scn, placeDoodad(scn, ramp, 4, 2, 0));
    applyEdit(scn, placeDoodad(scn, tree, 6, 2, 0));
    expect(doodadAt(scn, cat, 4, 2)).toBe(0);
    expect(doodadAt(scn, cat, 6, 2)).toBe(1); // the ramp has no tile there; the tree does
    expect(doodadAt(scn, cat, 7, 3)).toBe(0);
    expect(doodadAt(scn, cat, 0, 0)).toBe(-1);
    expect(doodadsInBox(scn, cat, { x0: 7, y0: 0, x1: 9, y1: 1 })).toEqual([]);
    expect(doodadsInBox(scn, cat, { x0: 7, y0: 0, x1: 9, y1: 2 })).toEqual([0, 1]);
    expect(doodadsInBox(scn, cat, { x0: 3, y0: 3, x1: 4, y1: 3 })).toEqual([0]);
  });
});

describe("terrain edits over doodads", () => {
  it("terrain changes write both MTXM and TILE, remembering what TILE held for undo", () => {
    const scn = fresh();
    applyEdit(scn, placeDoodad(scn, tree, 4, 3, 0));
    const changes = stampTile(scn, [3 * 16 + 4], 0x41);
    applyChanges(scn, changes);
    expect(changes[0].under).toBe(0x20);
    expect(scn.tiles[3 * 16 + 4]).toBe(0x41);
    expect(scn.editorTiles[3 * 16 + 4]).toBe(0x41);
    applyChanges(scn, changes, "undo");
    expect(scn.tiles[3 * 16 + 4]).toBe(0x60);
    expect(scn.editorTiles[3 * 16 + 4]).toBe(0x20);
    // The isometric brush writes tiles itself and mirrors afterwards.
    scn.tiles[3 * 16 + 5] = 0x51;
    const mirrored = [{ at: 3 * 16 + 5, before: 0x61, after: 0x51 }];
    mirrorEditorTiles(scn, mirrored);
    expect(mirrored[0]).toMatchObject({ under: 0x30 });
    expect(scn.editorTiles[3 * 16 + 5]).toBe(0x51);
  });

  it("reports doodads that lost a tile to a terrain edit", () => {
    const scn = fresh();
    applyEdit(scn, placeDoodad(scn, tree, 4, 3, 0));
    applyEdit(scn, placeDoodad(scn, ramp, 8, 2, 0));
    const changes = stampTile(scn, [3 * 16 + 5, 0], 0x41);
    applyChanges(scn, changes);
    expect(strandedDoodads(scn, cat, changes.map((c) => c.at))).toEqual([0]);
    expect(strandedDoodads(scn, cat, [2 * 16 + 6])).toEqual([]); // a cell the ramp has no tile for
  });

  it("round-trips TILE separately from MTXM through the file", () => {
    const scn = fresh();
    applyEdit(scn, placeDoodad(scn, tree, 4, 3, 0));
    const again = parseScenario(serializeScenario(scn));
    expect(again.tiles[3 * 16 + 4]).toBe(0x60);
    expect(again.editorTiles[3 * 16 + 4]).toBe(0x20);
    expect(again.doodads).toEqual(scn.doodads);
    expect(again.sprites).toEqual(scn.sprites);
    // A file without TILE starts with TILE = MTXM.
    const stripped = parseScenario(serializeScenario({ ...again, chk: { sections: again.chk.sections.filter((s) => s.name !== "TILE") }, dirty: new Set() }));
    expect(stripped.editorTiles[3 * 16 + 4]).toBe(0x60);
  });
});

/* ── Real data ───────────────────────────────────────────── */

const TILESET_DIR = join(import.meta.dirname, "..", "public", "tileset");
const MAPS = join(import.meta.dirname, "..", "fixtures", "maps");
const installed = TILESET_FILENAMES.filter((n) => existsSync(join(TILESET_DIR, `${n}.cv5`)) && existsSync(join(TILESET_DIR, `${n}.dddata.bin`)));
const haveNames = existsSync(join(TILESET_DIR, "stat_txt.tbl"));

function realTileset(name: string): { tileset: Tileset; catalogue: DoodadCatalogue } {
  const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `${name}.${ext}`)));
  const tileset = loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") });
  const names = haveNames ? decodeTbl(new Uint8Array(readFileSync(join(TILESET_DIR, "stat_txt.tbl")))) : null;
  return { tileset, catalogue: buildDoodadCatalogue(tileset, part("dddata.bin"), names) };
}

describe.skipIf(installed.length === 0)("real tilesets", () => {
  it.each(installed)("%s lists doodads under StarEdit's category names", (name) => {
    const { catalogue } = realTileset(name);
    expect(catalogue.doodads.length).toBeGreaterThan(50);
    expect(catalogue.hasPlacementData).toBe(true);
    const named = catalogue.categories.filter((c) => c.name !== "Unlisted");
    if (haveNames) expect(named.length).toBeGreaterThan(3);
    for (const d of catalogue.doodads) {
      expect(d.width).toBeLessThanOrEqual(16);
      expect(d.tiles.some((t) => t !== 0)).toBe(true);
      // Every tile the doodad places is one of its own groups.
      for (let i = 0; i < d.tiles.length; i++) if (d.tiles[i]) expect(d.tiles[i] >> 4).toBe(d.group + Math.floor(i / d.width));
    }
  });

  it.each(installed)("%s tags its ramps from the VF4 ramp bit", (name) => {
    const { catalogue } = realTileset(name);
    const ramps = catalogue.doodads.filter((d) => d.ramp);
    // Every tileset has a few ramps, in left/right-facing pairs, and they are a small minority.
    expect(ramps.length).toBeGreaterThan(0);
    expect(ramps.length % 2).toBe(0);
    expect(ramps.length).toBeLessThan(catalogue.doodads.length / 10);
    for (const c of catalogue.categories) expect(c.doodads.filter((d) => d.ramp).length % 2).toBe(0);
    // Jungle's "Cliff" category: twelve 4×4 cliff ornaments, then the two 6×6 ramps.
    if (haveNames && name === "jungle") expect(catalogue.doodads.filter((d) => d.category === "Cliff" && d.ramp).map((d) => d.id)).toEqual([12, 13]);
  });

  it("names the categories the way StarEdit does", () => {
    if (!haveNames || !installed.includes("jungle")) return;
    const names = realTileset("jungle").catalogue.categories.map((c) => c.name);
    expect(names).toContain("Cliff");
    expect(names).toContain("Bridges");
    expect(names.at(-1)).toBe("Unlisted");
  });
});

const maps = existsSync(MAPS) ? readdirSync(MAPS).filter((f) => /\.sc[mx]$/i.test(f)) : [];

describe.skipIf(maps.length === 0 || installed.length === 0)("real maps", () => {
  it.each(maps)("%s: every DD2 record's tiles are on the map where the centre says, over ground kept in TILE", async (file) => {
    const { chk } = await loadMap(new Uint8Array(readFileSync(join(MAPS, file))));
    const scn = parseScenario(chk);
    const name = TILESET_FILENAMES[tilesetIndex(scn)];
    if (!installed.includes(name)) return;
    const { tileset, catalogue } = realTileset(name);
    let cells = 0, matched = 0, groundKept = 0;
    for (const rec of scn.doodads) {
      const def = catalogue.byId.get(rec.doodadId);
      expect(def).toBeDefined();
      const o = doodadOrigin(def!, rec.x, rec.y);
      expect(o.x % 2).toBe(0); // StarEdit snaps to the two-tile grid
      for (let row = 0; row < def!.height; row++) {
        for (let col = 0; col < def!.width; col++) {
          const id = def!.tiles[row * def!.width + col];
          if (!id) continue;
          cells++;
          const at = (o.y + row) * scn.width + o.x + col;
          if (scn.tiles[at] === id) matched++;
          if (tileset.groups[scn.editorTiles[at] >> 4]?.index !== 1) groundKept++;
        }
      }
      // Every overlay is in THG2 at the doodad's centre with the CV5 flag word.
      if (def!.overlay) {
        const sprite = scn.sprites.find((s) => s.spriteId === def!.overlay!.id && s.x === rec.x && s.y === rec.y);
        expect(sprite?.flags).toBe(def!.flags);
      }
    }
    if (cells === 0) return;
    // Blizzard's own maps overlap the odd doodad; well over 95% of cells still show their doodad.
    expect(matched / cells).toBeGreaterThan(0.95);
    expect(groundKept).toBe(cells);
  });

  it("lifting a real doodad puts the TILE ground back and removing all leaves no doodad tiles", async () => {
    const file = maps.find((f) => /Ice Floes/.test(f)) ?? maps[0];
    const { chk } = await loadMap(new Uint8Array(readFileSync(join(MAPS, file))));
    const scn = parseScenario(chk);
    const name = TILESET_FILENAMES[tilesetIndex(scn)];
    if (!installed.includes(name) || scn.doodads.length === 0) return;
    const { tileset, catalogue } = realTileset(name);
    const edit = removeDoodads(scn, tileset, catalogue, scn.doodads.map((_, i) => i));
    applyEdit(scn, edit);
    expect(scn.doodads).toHaveLength(0);
    for (let i = 0; i < scn.tiles.length; i++) expect(tileset.groups[scn.tiles[i] >> 4]?.index).not.toBe(1);
    expect(scn.sprites.every((s) => !(s.flags & SpriteFlag.PureSprite) || !catalogue.doodads.some((d) => d.overlay?.id === s.spriteId))).toBe(true);
  });
});
