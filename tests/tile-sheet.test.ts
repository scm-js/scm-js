import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { loadTileset, megatileForTile, type Tileset } from "../src/formats/tileset/decode";
import { buildDoodadCatalogue } from "../src/formats/tileset/doodads";
import { tileGroups } from "../src/formats/tileset/palette";
import { TILESETS } from "../src/data/tilesets";
import { addedGroupsFrom, tileGroupRanges } from "../src/data/remasteredTiles";
import { applyChanges, Stroke } from "../src/editor/terrain";
import {
  blockCells, blockFromRect, blockRect, firstTile, HOLE, layBlock, layPattern, PatternStroke, patternOrigin, patternTileAt, runBounds,
  SHEET_BRIDGE, sheetRows, type TileBlock,
} from "../src/editor/tileSheet";
import { activeTileAtom } from "../src/atoms/editorAtoms";
import { commitTerrainAtom, loadDocumentAtom, redoAtom, scenarioAtom, undoAtom } from "../src/atoms/documentAtoms";
import { tileBlockAtom } from "../src/atoms/tileBlockAtoms";

const groupsOf = (rows: ReturnType<typeof sheetRows>) => rows.map((r) => `${r.group}${r.blank ? "b" : ""}@${r.run}`).join(" ");

describe("the sheet's rows", () => {
  it("puts consecutive groups in one run and starts a new run at a gap", () => {
    const rows = sheetRows([3, 4, 5, 9, 10, 20]);
    expect(groupsOf(rows)).toBe("3@0 4@0 5@0 9@1 10@1 20@2");
    expect(runBounds(rows, 1)).toEqual({ first: 0, last: 2 });
    expect(runBounds(rows, 3)).toEqual({ first: 3, last: 4 });
    expect(runBounds(rows, 5)).toEqual({ first: 5, last: 5 });
  });

  it("bridges a short run of empty groups with void rows, but not a long one or one with pictures", () => {
    const empty = (g: number) => g === 6 || g === 7 || (g > 100 && g < 200);
    expect(groupsOf(sheetRows([5, 8], empty))).toBe("5@0 6b@0 7b@0 8@0");
    // Group 7 has pictures but is not listed (the filter left it out): a break.
    expect(groupsOf(sheetRows([5, 8], (g) => g === 6))).toBe("5@0 8@1");
    // Ninety-nine empty groups are past the bridge.
    expect(groupsOf(sheetRows([100, 200], empty))).toBe("100@0 200@1");
    expect(SHEET_BRIDGE).toBeLessThan(99);
  });

  it("ignores repeats and groups out of order", () => {
    expect(groupsOf(sheetRows([1, 1, 2, 0]))).toBe("1@0 2@0");
  });
});

describe("a block from the sheet", () => {
  // Groups 10–12 then 20; slot 3 of group 11 and every slot past 7 are void.
  const rows = sheetRows([10, 11, 12, 20]);
  const isVoid = (id: number) => id === ((11 << 4) | 3) || (id & 15) > 7;

  it("reads a rectangle row by row, a void slot as a hole", () => {
    const block = blockFromRect(rows, { row0: 0, col0: 2, row1: 1, col1: 4 }, isVoid)!;
    expect(block.cols).toBe(3);
    expect(block.rows).toBe(2);
    expect(block.ids).toEqual([0xa2, 0xa3, 0xa4, 0xb2, HOLE, 0xb4]);
    expect(block.origin).toEqual({ group: 10, slot: 2 });
    expect(firstTile(block)).toBe(0xa2);
  });

  it("takes the corners in either order", () => {
    expect(blockFromRect(rows, { row0: 1, col0: 4, row1: 0, col1: 2 }, isVoid)).toEqual(blockFromRect(rows, { row0: 0, col0: 2, row1: 1, col1: 4 }, isVoid));
  });

  it("refuses a rectangle across a break, off the sheet, or holding nothing", () => {
    expect(blockFromRect(rows, { row0: 2, col0: 0, row1: 3, col1: 1 }, isVoid)).toBeNull();
    expect(blockFromRect(rows, { row0: 0, col0: 15, row1: 0, col1: 16 }, isVoid)).toBeNull();
    expect(blockFromRect(rows, { row0: 0, col0: 8, row1: 2, col1: 15 }, isVoid)).toBeNull();
  });

  it("makes a blank row a row of holes", () => {
    const bridged = sheetRows([10, 12], (g) => g === 11);
    const block = blockFromRect(bridged, { row0: 0, col0: 0, row1: 2, col1: 1 }, () => false)!;
    expect(block.ids).toEqual([0xa0, 0xa1, HOLE, HOLE, 0xc0, 0xc1]);
  });

  it("finds where it came from while its rows are listed", () => {
    const block = blockFromRect(rows, { row0: 1, col0: 0, row1: 2, col1: 5 }, isVoid)!;
    expect(blockRect(rows, block)).toEqual({ row0: 1, col0: 0, row1: 2, col1: 5 });
    expect(blockRect(sheetRows([11, 12]), block)).toEqual({ row0: 0, col0: 0, row1: 1, col1: 5 });
    expect(blockRect(sheetRows([11]), block)).toBeNull();
  });
});

describe("laying a block", () => {
  const block: TileBlock = { cols: 3, rows: 2, ids: [1, HOLE, 3, 4, 5, 6] };

  it("writes every cell but the holes, with its top-left at the cell given", () => {
    const scn = createScenario({ width: 8, height: 6, era: 0, name: "t" });
    scn.tiles[2 * 8 + 4] = 99; // under the hole
    const changes = layBlock(scn, block, 3, 2);
    expect(changes.map((c) => [c.at % 8, Math.floor(c.at / 8), c.after])).toEqual([[3, 2, 1], [5, 2, 3], [3, 3, 4], [4, 3, 5], [5, 3, 6]]);
    applyChanges(scn, changes);
    expect(scn.tiles[2 * 8 + 4]).toBe(99);
    expect(scn.dirty.has("MTXM")).toBe(true);
    expect(layBlock(scn, block, 3, 2)).toEqual([]);
  });

  it("clips at the map's edge on every side", () => {
    const scn = createScenario({ width: 8, height: 6, era: 0, name: "t" });
    expect(layBlock(scn, block, 6, 5).map((c) => [c.at % 8, Math.floor(c.at / 8)])).toEqual([[6, 5]]);
    expect(layBlock(scn, block, -2, -1).map((c) => [c.at % 8, Math.floor(c.at / 8)])).toEqual([[0, 0]]);
    expect(blockCells(block, -2, -1, 8, 6)).toEqual([{ x: 0, y: 0, id: 6 }]);
  });
});

describe("a block repeated along a drag", () => {
  const block: TileBlock = { cols: 3, rows: 2, ids: [1, 2, 3, 4, 5, 6] };

  it("lines each copy up on the press, in whole blocks either way", () => {
    const o = { x: 10, y: 10 };
    expect(patternOrigin(block, o, 10, 10)).toEqual({ x: 10, y: 10 });
    expect(patternOrigin(block, o, 12, 11)).toEqual({ x: 10, y: 10 });
    expect(patternOrigin(block, o, 13, 12)).toEqual({ x: 13, y: 12 });
    expect(patternOrigin(block, o, 9, 9)).toEqual({ x: 7, y: 8 });
    expect(patternOrigin(block, o, 7, 8)).toEqual({ x: 7, y: 8 });
    expect(patternOrigin(block, o, 6, 7)).toEqual({ x: 4, y: 6 });
    expect(patternTileAt(block, o, 9, 9)).toBe(6);
    expect(patternTileAt(block, o, 13, 12)).toBe(1);
  });

  it("lays each copy once and makes the whole drag one change list", () => {
    const scn = createScenario({ width: 12, height: 6, era: 0, name: "t" });
    const pattern = new PatternStroke(block, { x: 1, y: 1 });
    const stroke = new Stroke();
    for (let x = 1; x <= 9; x++) {
      const changes = pattern.at(scn, x, 1);
      applyChanges(scn, changes);
      stroke.add(changes);
    }
    expect(pattern.copies).toBe(3);
    const all = stroke.finish();
    expect(all).toHaveLength(18);
    // A seamless row of three copies: 1 2 3 1 2 3 1 2 3 over 4 5 6 4 5 6 4 5 6.
    expect(Array.from(scn.tiles.slice(12 + 1, 12 + 10))).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3]);
    expect(Array.from(scn.tiles.slice(24 + 1, 24 + 10))).toEqual([4, 5, 6, 4, 5, 6, 4, 5, 6]);
    // Back over a copy already down: nothing more.
    expect(pattern.at(scn, 2, 2)).toEqual([]);
  });

  it("tiles a region lined up on its origin, holes left as they are", () => {
    const scn = createScenario({ width: 4, height: 2, era: 0, name: "t" });
    scn.tiles.fill(7);
    const holed: TileBlock = { cols: 2, rows: 1, ids: [1, HOLE] };
    applyChanges(scn, layPattern(scn, holed, { x: 1, y: 0 }, scn.tiles.keys()));
    expect(Array.from(scn.tiles)).toEqual([7, 1, 7, 1, 7, 1, 7, 1]);
  });

  it("goes on the undo stack as one entry, through the editor's terrain commit", () => {
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 12, height: 8, era: 0, name: "t" }), extras: new Map(), fileName: null });
    const scn = store.get(scenarioAtom)!;
    const pattern = new PatternStroke(block, { x: 0, y: 0 });
    const stroke = new Stroke();
    for (const [x, y] of [[0, 0], [4, 0], [7, 3], [10, 5]]) {
      const changes = pattern.at(scn, x, y);
      applyChanges(scn, changes);
      stroke.add(changes);
    }
    store.set(commitTerrainAtom, { entry: { label: "Place 3×2 tiles", changes: stroke.finish() }, summary: "" });
    expect(store.get(undoAtom)).toBe("Place 3×2 tiles");
    store.set(undoAtom);
    expect(store.get(undoAtom)).toBeNull();
    expect(scn.tiles.every((t) => t === 0)).toBe(true);
    store.set(redoAtom);
    expect(scn.tiles[0]).toBe(1);
    expect(scn.tiles[5 * 12 + 11]).toBe(6);
  });
});

describe("the Tile brush's block", () => {
  const block: TileBlock = { cols: 2, rows: 1, ids: [HOLE, 0x45] };
  const open = () => {
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 8, height: 8, era: 0, name: "a" }), extras: new Map(), fileName: null });
    return store;
  };

  it("makes its first tile the brush's tile, and drops when another tile is picked", () => {
    const store = open();
    store.set(tileBlockAtom, block);
    expect(store.get(tileBlockAtom)).toBe(block);
    expect(store.get(activeTileAtom)).toBe(0x45);
    store.set(activeTileAtom, 0x46);
    expect(store.get(tileBlockAtom)).toBeNull();
    store.set(activeTileAtom, 0x45);
    store.set(tileBlockAtom, null);
    expect(store.get(tileBlockAtom)).toBeNull();
  });

  it("is not taken onto another map", () => {
    const store = open();
    store.set(tileBlockAtom, block);
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 8, height: 8, era: 0, name: "b" }), extras: new Map(), fileName: null });
    expect(store.get(tileBlockAtom)).toBeNull();
  });

  it("is not kept over a block of nothing but holes", () => {
    const store = open();
    store.set(tileBlockAtom, { cols: 1, rows: 1, ids: [HOLE] });
    expect(store.get(tileBlockAtom)).toBeNull();
  });
});

describe("what a data set adds", () => {
  it("is past the 1.16 table, only on a table longer than any of the game's", () => {
    for (let era = 0; era < 8; era++) {
      const { classic, remastered } = tileGroupRanges(era);
      expect(addedGroupsFrom(era, classic)).toBeNull();
      expect(addedGroupsFrom(era, remastered)).toBeNull();
      expect(addedGroupsFrom(era, remastered + 1)).toBe(classic);
    }
  });
});

/* ── Against the game's own tilesets ───────────────────── */

const TILESET_DIR = join(__dirname, "..", "public", "tileset");
const have = existsSync(join(TILESET_DIR, "badlands.cv5")) && existsSync(join(TILESET_DIR, "badlands.dddata.bin"));

function read(dir: string, base: string, ext: string): Uint8Array | null {
  const hit = readdirSync(dir).find((f) => f.toLowerCase() === `${base}.${ext}`.toLowerCase());
  return hit ? new Uint8Array(readFileSync(join(dir, hit))) : null;
}

function load(dir: string, base: string): Tileset {
  const vx4ex = read(dir, base, "vx4ex");
  return loadTileset({ cv5: read(dir, base, "cv5")!, vf4: read(dir, base, "vf4")!, vr4: read(dir, base, "vr4")!, vx4: vx4ex ?? read(dir, base, "vx4")!, vx4Extended: vx4ex !== null, wpe: read(dir, base, "wpe")! });
}

const emptyIn = (ts: Tileset) => (g: number) => ts.groups[g].megatiles.every((m) => m === 0 || m >= ts.megatileCount);

if (have) {
  describe("the sheet of Badlands", () => {
    const ts = load(TILESET_DIR, "badlands");
    const rows = sheetRows(tileGroups(ts, TILESETS[0].terrain).map((g) => g.group), emptyIn(ts));
    const isVoid = (id: number) => megatileForTile(ts, id) <= 0;

    it("picks every doodad whole as the block of its picture", () => {
      const catalogue = buildDoodadCatalogue(ts, new Uint8Array(readFileSync(join(TILESET_DIR, "badlands.dddata.bin"))), null);
      expect(catalogue.doodads.length).toBeGreaterThan(100);
      for (const d of catalogue.doodads) {
        const row0 = rows.findIndex((r) => r.group === d.group);
        expect(row0, `doodad ${d.id}`).toBeGreaterThanOrEqual(0);
        const block = blockFromRect(rows, { row0, col0: 0, row1: row0 + d.height - 1, col1: d.width - 1 }, isVoid);
        expect(block, `doodad ${d.id}`).not.toBeNull();
        const want = Array.from(d.tiles, (id) => (id === 0 || isVoid(id) ? HOLE : id));
        expect(block!.ids, `doodad ${d.id}`).toEqual(want);
      }
    });
  });
}

/* ── Against a mod's tileset, where one is at hand ─────── */

const MOD = process.env.SCMJS_COSMONARCHY;
const modDir = MOD ? join(MOD, "mpq", "tileset") : "";
const haveMod = !!MOD && existsSync(modDir) && read(modDir, "badlands", "cv5") !== null;

if (haveMod) {
  describe("the sheet of a mod's Badlands", () => {
    it("lists what the data set adds, its pictures in runs of consecutive groups", () => {
      const ts = load(modDir, "badlands");
      const from = addedGroupsFrom(0, ts.groups.length);
      expect(from).toBe(tileGroupRanges(0).classic);
      const added = tileGroups(ts, TILESETS[0].terrain).filter((g) => g.group >= from!).map((g) => g.group);
      const rows = sheetRows(added, emptyIn(ts));
      const runs = new Set(rows.map((r) => r.run)).size;
      // Thousands of groups, and empty groups between pictures bridged rather than breaking them up.
      expect(added.length).toBeGreaterThan(1000);
      expect(runs).toBeLessThan(added.length / 50);
    });
  });
}
