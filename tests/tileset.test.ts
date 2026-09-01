import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TILESET_FILENAMES } from "../src/formats/tileset/load";
import { TILESETS } from "../src/data/tilesets";
import { buildAtlasImageData, megatileAverages } from "../src/formats/tileset/atlas";
import {
  decodeCv5, decodePalette, drawMegatile, loadTileset, megatileForTile,
  MEGATILE_PX, minitileHeight, TileFlag, type Tileset,
} from "../src/formats/tileset/decode";
import { baseTerrain, DIRT, flatTerrain } from "../src/formats/tileset/terrain";

/** A deterministic stand-in for Math.random, so the fill tests are reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * A two-megatile tileset built by hand, so a wrong byte offset in any of the five
 * files shows up as a wrong pixel rather than a plausible-looking mess.
 */
function syntheticTileset() {
  // WPE: index i -> (i, 2i, 255 - i)
  const wpe = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) {
    wpe[i * 4] = i;
    wpe[i * 4 + 1] = (i * 2) & 0xff;
    wpe[i * 4 + 2] = 255 - i;
  }

  // VR4: minitile 0 is flat colour 1; minitile 1 is a left-to-right ramp 0..7.
  const vr4 = new Uint8Array(2 * 64);
  vr4.fill(1, 0, 64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) vr4[64 + y * 8 + x] = x;

  // VX4: megatile 0 uses minitile 0 everywhere except slot 1, which is minitile 1
  // horizontally flipped. Megatile 1 is entirely minitile 1, unflipped.
  const vx4 = new Uint8Array(2 * 32);
  const vx4View = new DataView(vx4.buffer);
  vx4.fill(0, 0, 32); // megatile 0 defaults to minitile 0, unflipped
  vx4View.setUint16(1 * 2, (1 << 1) | 1, true);
  for (let i = 0; i < 16; i++) vx4View.setUint16(32 + i * 2, 1 << 1, true);

  // VF4: megatile 0 walkable and high ground, megatile 1 unwalkable.
  const vf4 = new Uint8Array(2 * 32);
  const vf4View = new DataView(vf4.buffer);
  for (let i = 0; i < 16; i++) vf4View.setUint16(i * 2, TileFlag.Walkable | TileFlag.HighGround, true);

  // CV5: one group whose slot 0 is megatile 1 and slot 3 is megatile 0.
  const cv5 = new Uint8Array(52);
  const cv5View = new DataView(cv5.buffer);
  cv5View.setUint16(0, 7, true);        // index
  cv5[2] = 0x0f;                        // buildability
  cv5[3] = 2;                           // ground height
  cv5View.setUint16(4, 11, true);       // left edge
  const slot = (n: number) => 20 + n * 2;
  cv5View.setUint16(slot(0), 1, true);
  cv5View.setUint16(slot(3), 0, true);

  return loadTileset({ cv5, vf4, vr4, vx4, wpe });
}

describe("tileset decoding", () => {
  it("expands WPE into opaque RGBA", () => {
    const palette = decodePalette(new Uint8Array([10, 20, 30, 0, 40, 50, 60, 0]));
    expect([...palette.subarray(0, 8)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it("reads CV5 fields at the right offsets", () => {
    const ts = syntheticTileset();
    const group = ts.groups[0];
    expect(group.index).toBe(7);
    expect(group.buildability).toBe(0x0f);
    expect(group.groundHeight).toBe(2);
    expect(group.edges.left).toBe(11);
    expect(group.megatiles[0]).toBe(1);
    expect(group.megatiles[3]).toBe(0);
  });

  it("resolves an MTXM id through CV5 to a megatile", () => {
    const ts = syntheticTileset();
    expect(ts.megatileCount).toBe(2);
    expect(megatileForTile(ts, 0x0000)).toBe(1); // group 0, slot 0
    expect(megatileForTile(ts, 0x0003)).toBe(0); // group 0, slot 3
    expect(megatileForTile(ts, 0x0010)).toBe(-1); // group 1 does not exist
  });

  it("paints minitiles, honouring the horizontal flip bit", () => {
    const ts = syntheticTileset();
    const px = new Uint8ClampedArray(MEGATILE_PX * MEGATILE_PX * 4);
    drawMegatile(ts, 0, px, MEGATILE_PX, 0, 0);

    const at = (x: number, y: number) => [...px.subarray((y * MEGATILE_PX + x) * 4, (y * MEGATILE_PX + x) * 4 + 4)];
    // Slot 0 is flat palette index 1 -> (1, 2, 254).
    expect(at(0, 0)).toEqual([1, 2, 254, 255]);
    // Slot 1 is the ramp flipped, so its leftmost pixel is ramp value 7.
    expect(at(8, 0)).toEqual([7, 14, 248, 255]);
    expect(at(15, 0)).toEqual([0, 0, 255, 255]);
    // The second row of minitiles falls back to slot 0's flat colour.
    expect(at(0, 8)).toEqual([1, 2, 254, 255]);
  });

  it("draws an unflipped megatile in source order", () => {
    const ts = syntheticTileset();
    const px = new Uint8ClampedArray(MEGATILE_PX * MEGATILE_PX * 4);
    drawMegatile(ts, 1, px, MEGATILE_PX, 0, 0);
    expect(px[0]).toBe(0); // ramp starts at 0
    expect(px[7 * 4]).toBe(7);
  });

  it("reads VF4 elevation flags per minitile", () => {
    const ts = syntheticTileset();
    expect(minitileHeight(ts, 0, 0)).toBe(2);
    expect(minitileHeight(ts, 1, 0)).toBe(0);
  });

  it("lays every megatile into the atlas and averages them", () => {
    const ts = syntheticTileset();
    const { pixels, width, height, columns } = buildAtlasImageData(ts);
    expect(columns).toBe(2);
    expect(width).toBe(2 * MEGATILE_PX);
    expect(height).toBe(MEGATILE_PX);

    const averages = megatileAverages(pixels, width, columns, ts.megatileCount);
    // Megatile 1 is the ramp everywhere: mean red is (0+1+..+7)/8 = 3.5 -> 3.
    expect(averages[1] >> 16).toBe(3);
    // Megatile 0 is mostly flat colour 1, so its mean red sits just above 1.
    expect(averages[0] >> 16).toBeGreaterThanOrEqual(1);
    expect(averages[0] >> 16).toBeLessThan(3);
  });
});

/**
 * Terrain pairs built by hand: group 2 is nine flat variations then a gap then two rare
 * ones, group 3 is its right-hand twin. Both carry index 2, the dirt id.
 */
function terrainCv5(): Uint8Array {
  const cv5 = new Uint8Array(4 * 52);
  const view = new DataView(cv5.buffer);
  const slots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 10, 11, 0, 0, 0, 0];
  for (const group of [2, 3]) {
    const at = group * 52;
    view.setUint16(at, 2, true); // index: dirt
    slots.forEach((megatile, slot) => {
      view.setUint16(at + 20 + slot * 2, megatile === 0 ? 0 : megatile + (group - 2) * 16, true);
    });
  }
  return cv5;
}

function terrainTileset(): Tileset {
  return { groups: decodeCv5(terrainCv5()) } as Tileset;
}

describe("base terrain", () => {
  it("finds a terrain pair by ISOM id", () => {
    expect(baseTerrain(terrainTileset(), 2)).toEqual({ id: 2, group: 2 });
  });

  it("falls back to the lowest drawable pair for an unknown id", () => {
    expect(baseTerrain(terrainTileset(), 99)).toEqual({ id: 2, group: 2 });
    expect(baseTerrain(null, 99)).toEqual(DIRT);
  });

  it("fills a map in tile pairs that share one variation", () => {
    const { tiles } = flatTerrain(8, 4, DIRT, terrainTileset(), seeded(1));
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x += 2) {
        const left = tiles[y * 8 + x];
        const right = tiles[y * 8 + x + 1];
        expect(left >> 4).toBe(2);
        expect(right >> 4).toBe(3);
        expect(right & 15).toBe(left & 15);
        // Slots 9 and 12-15 hold the null megatile, so nothing may land on them.
        expect([9, 12, 13, 14, 15]).not.toContain(left & 15);
      }
    }
  });

  it("keeps rare variations rare", () => {
    const { tiles } = flatTerrain(64, 64, DIRT, terrainTileset(), seeded(7));
    const rare = [...tiles].filter((t) => (t & 15) >= 10).length;
    expect(rare).toBeGreaterThan(0);
    expect(rare / tiles.length).toBeLessThan(0.2);
  });

  it("writes the two flat ISOM quads by cell parity", () => {
    const { isom } = flatTerrain(8, 4, DIRT, terrainTileset(), seeded(3));
    const cellsW = 8 / 2 + 1;
    const cell = (cx: number, cy: number) => [...isom.subarray((cy * cellsW + cx) * 4, (cy * cellsW + cx) * 4 + 4)];
    // Dirt owns the block of values at id * 8 = 16.
    expect(cell(0, 0)).toEqual([24, 26, 16, 18]);
    expect(cell(1, 0)).toEqual([20, 28, 30, 22]);
    expect(cell(1, 1)).toEqual([24, 26, 16, 18]);
    expect(isom.length).toBe(cellsW * (4 + 1) * 4);
  });

  it("still produces dirt tiles when the graphics are missing", () => {
    const { tiles } = flatTerrain(4, 2, DIRT, null);
    expect([...tiles]).toEqual([0x20, 0x30, 0x20, 0x30, 0x20, 0x30, 0x20, 0x30]);
  });
});

/* Runs only where scripts/extract-tilesets.mjs has been run. */
const TILESET_DIR = join(import.meta.dirname, "..", "public", "tileset");
const installed = TILESET_FILENAMES.filter((n) => existsSync(join(TILESET_DIR, `${n}.cv5`)));

describe.skipIf(installed.length === 0)("installed tilesets (public/tileset)", () => {
  it("fills a new map of every tileset with drawable terrain", () => {
    for (const name of installed) {
      const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `${name}.${ext}`)));
      const ts = loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") });
      const info = TILESETS[TILESET_FILENAMES.indexOf(name)];

      const terrain = baseTerrain(ts, info.defaultIsom);
      if (info.defaultIsom !== undefined) expect(terrain.id, name).toBe(info.defaultIsom);

      // Nothing may land on the null megatile, which is what the void looks like.
      const { tiles } = flatTerrain(32, 32, terrain, ts);
      const drawable = [...tiles].every((t) => megatileForTile(ts, t) > 0);
      expect(drawable, name).toBe(true);
    }
  });
});
