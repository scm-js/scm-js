import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { decodeCv5, type Cv5Group } from "../src/formats/tileset/decode";
import { writeMapBytes } from "../src/editor/mapFile";
import { applyChanges } from "../src/editor/terrain";
import { layBlock } from "../src/editor/tileSheet";
import { cutPieces, emptyEvidence, gatherEvidence, pieceBlock, pieceIndex } from "../src/editor/pieces";
import { shelfLayout, shelvesIn } from "../src/editor/pieceShelves";
import { isMapName, learnFromMaps, piecesPerTileset, tableHash, type LearnFile } from "../src/editor/pieceLearn";
import { laidPieceAt } from "../src/editor/piecePick";
import { forgetLearned, memoryPieceStore, piecesKey, readLearned, writeLearned } from "../src/services/pieceStore";
import { testMapFiles } from "./support/maps";

/** A sheet of `count` groups, every slot with a picture; groups from `doodadsFrom` on are doodad groups. */
function sheet(count: number, doodadsFrom = Infinity): Cv5Group[] {
  return Array.from({ length: count }, (_, g) => ({
    index: g >= doodadsFrom ? 1 : 0,
    megatiles: Uint16Array.from({ length: 16 }, (_, s) => g * 16 + s + 1),
  })) as unknown as Cv5Group[];
}
const id = (group: number, slot: number) => (group << 4) | slot;
const file = (name: string, bytes: Uint8Array): LearnFile => ({ name, bytes: async () => bytes });

/** A 3 × 2 picture of groups 40–41, slots 5–7, as a block. */
const PICTURE = { cols: 3, rows: 2, ids: [id(40, 5), id(40, 6), id(40, 7), id(41, 5), id(41, 6), id(41, 7)] };

async function mapWith(places: [number, number][], era = 0): Promise<Uint8Array> {
  const scn = createScenario({ width: 16, height: 16, era, name: "pieces" });
  for (const [x, y] of places) applyChanges(scn, layBlock(scn, PICTURE, x, y));
  return writeMapBytes(scn, { format: "scx" });
}

describe("the Pieces view's shelves", () => {
  it("lays pieces left to right and starts a shelf when the next one does not fit", () => {
    const layout = shelfLayout([{ cols: 2, rows: 1 }, { cols: 3, rows: 2 }, { cols: 4, rows: 1 }], 100, 16, 4);
    expect(layout.boxes.map((b) => [b.x, b.y, b.w, b.h])).toEqual([[0, 0, 32, 16], [36, 0, 48, 32], [0, 36, 64, 16]]);
    expect(layout.shelves).toEqual([{ top: 0, height: 32, first: 0, last: 1 }, { top: 36, height: 16, first: 2, last: 2 }]);
    expect(layout.height).toBe(52);
  });

  it("scales a piece wider than the panel down to its width, and keeps it on a shelf of its own", () => {
    const layout = shelfLayout([{ cols: 1, rows: 1 }, { cols: 12, rows: 10 }, { cols: 1, rows: 1 }], 100, 16, 4);
    const big = layout.boxes[1];
    expect(big.tile).toBe(8);
    expect([big.x, big.y, big.w, big.h]).toEqual([0, 20, 96, 80]);
    expect(layout.boxes[2].y).toBe(104);
  });

  it("finds the shelves in a band", () => {
    const layout = shelfLayout(Array.from({ length: 50 }, () => ({ cols: 5, rows: 1 })), 100, 16, 4);
    // One a shelf, 20 px apart.
    expect(shelvesIn(layout, 0, 0)).toEqual({ first: 0, last: 0 });
    expect(shelvesIn(layout, 45, 85)).toEqual({ first: 2, last: 4 });
    expect(shelvesIn(layout, 5000, 6000).last).toBeLessThan(shelvesIn(layout, 5000, 6000).first);
    expect(shelfLayout([], 100, 16, 4)).toEqual({ boxes: [], shelves: [], height: 0 });
  });
});

describe("the learned collection", () => {
  it("is kept by tileset table, replaced for the tables in use on learning again, and forgotten", async () => {
    const store = memoryPieceStore();
    const tiles = new Uint16Array(16 * 16);
    PICTURE.ids.forEach((t, i) => { tiles[(2 + Math.floor(i / 3)) * 16 + 3 + (i % 3)] = t; });
    const table = sheet(64);
    const e = gatherEvidence(emptyEvidence(), tiles, 16, 16, { groups: table });
    const a = piecesKey(0, table), b = piecesKey(4, table);
    expect(a).toMatch(/^badlands\/[0-9a-f]{16}$/);
    await writeLearned(store, [a, b], new Map([[a, e], [b, e]]));
    expect(cutPieces((await readLearned(store, b))!)).toEqual(cutPieces(e));
    // The same table reached another way (another data set's copy of it) shares the key; another table does not.
    expect(piecesKey(0, sheet(64))).toBe(a);
    expect(piecesKey(0, sheet(65))).not.toBe(a);
    expect(await readLearned(store, piecesKey(0, sheet(65)))).toBeNull();
    await writeLearned(store, [a, b], new Map([[a, e]]));
    expect(await readLearned(store, b)).toBeNull();
    await forgetLearned(store, [a, b]);
    expect(store.data.size).toBe(0);
    await store.put(a, "not evidence");
    expect(await readLearned(store, a)).toBeNull();
    await store.clear();
    expect(store.data.size).toBe(0);
  });

  it("tells one table from another by any word of a record", () => {
    const one = sheet(8), two = sheet(8);
    (two[3] as { megatiles: Uint16Array }).megatiles = Uint16Array.from(two[3].megatiles, (m, i) => (i === 5 ? m + 1 : m));
    expect(tableHash(one)).toBe(tableHash(sheet(8)));
    expect(tableHash(two)).not.toBe(tableHash(one));
  });
});

describe("learning from a folder of maps", () => {
  const groups = async () => sheet(64);

  it("finds the piece a made map lays, and counts what it skips", async () => {
    const progress: number[] = [];
    const past = createScenario({ width: 8, height: 8, era: 0, name: "past" });
    past.tiles[0] = id(3000, 0); // past a 64-group table: made for other tiles
    applyChanges(past, [{ at: 0, before: 0, after: id(3000, 0) }]);
    const result = await learnFromMaps([
      file("a.scx", await mapWith([[1, 1], [8, 9]])),
      file("past.scx", await writeMapBytes(past, { format: "scx" })),
      file("broken.scm", new Uint8Array([1, 2, 3])),
    ], { groups, progress: (done) => progress.push(done) });
    expect(result.read).toBe(1);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual(["notOurs", "unreadable"]);
    expect(progress).toEqual([1, 2, 3]);
    const pieces = cutPieces(result.evidence.get(0)!);
    expect(pieces).toHaveLength(1);
    expect(pieceBlock(pieces[0])).toEqual({ ...PICTURE, origin: { group: 40, slot: 5 } });
    expect(piecesPerTileset(result).get(0)).toBe(1);
  });

  it("stops when told, keeping what it read", async () => {
    let n = 0;
    const bytes = await mapWith([[1, 1]]);
    const result = await learnFromMaps([file("a.scx", bytes), file("b.scx", bytes)], { groups, stopped: () => n++ > 0 });
    expect(result.read).toBe(1);
  });

  it("finds nothing in the committed test maps, which are laid with the game's brushes", async () => {
    const files = testMapFiles();
    expect(files.length).toBeGreaterThan(0);
    // The game's tables put doodads from group 1024 up; a stand-in sheet like that, or the real one where present.
    const dir = join(import.meta.dirname, "..", "public", "tileset");
    const names = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"];
    const real = names.every((n) => existsSync(join(dir, `${n}.cv5`)));
    for (const tables of real ? ["stand-in", "real"] : ["stand-in"]) {
      const result = await learnFromMaps(files.map((f) => file(f.name, new Uint8Array(readFileSync(f.path)))), {
        groups: async (era) => (tables === "real" ? decodeCv5(new Uint8Array(readFileSync(join(dir, `${names[era]}.cv5`)))) : sheet(2048, 1024)),
      });
      expect(result.read, tables).toBe(files.length);
      for (const [era, n] of piecesPerTileset(result)) expect(n, `${tables} ${names[era]}`).toBe(0);
    }
  });

  it("knows a map by its name", () => {
    expect(["a.scx", "B.SCM", "c.chk", "d.scx.bak"].map(isMapName)).toEqual([true, true, false, false]);
  });
});

describe("Alt+click on a laid piece", () => {
  const groups = sheet(64);
  const scn = { width: 12, height: 8, tiles: new Uint16Array(12 * 8) };
  PICTURE.ids.forEach((t, i) => { scn.tiles[(2 + Math.floor(i / 3)) * 12 + 3 + (i % 3)] = t; });
  // The picture's corner tile laid alone elsewhere.
  scn.tiles[7 * 12 + 10] = id(40, 5);
  const pieces = cutPieces(gatherEvidence(emptyEvidence(), scn.tiles, 12, 8, { groups }));
  const index = pieceIndex(pieces);

  it("picks the piece where its tile sits beside a sheet neighbour of the piece", () => {
    expect(laidPieceAt(scn, 64, index, 3, 2)).toBe(pieces[0]);
    expect(laidPieceAt(scn, 64, index, 5, 3)).toBe(pieces[0]);
  });

  it("does not where the tile is laid alone, or is in no piece", () => {
    expect(laidPieceAt(scn, 64, index, 10, 7)).toBeNull();
    expect(laidPieceAt(scn, 64, index, 0, 0)).toBeNull();
    expect(laidPieceAt(scn, 64, index, 99, 0)).toBeNull();
  });
});
