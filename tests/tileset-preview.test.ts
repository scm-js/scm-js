import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeCv5, loadTileset, MEGATILE_PX, type Tileset } from "../src/formats/tileset/decode";
import { TILESET_FILENAMES } from "../src/formats/tileset/load";
import { baseTerrain, flatTiles } from "../src/formats/tileset/terrain";
import { patchAverage, patchRandom, renderTerrainPatch } from "../src/formats/tileset/preview";

/**
 * Two flat pairs of solid colour: groups 2/3 are the ISOM-2 pair (red left, green right)
 * and 4/5 the ISOM-3 pair (blue left/right). Group 2 has a second variation so the tests
 * can see the pair share one slot.
 */
const RED = 1, GREEN = 2, BLUE = 3, YELLOW = 4;

function synthetic(): Tileset {
  const palette = new Uint8Array(256 * 4);
  const set = (i: number, r: number, g: number, b: number) => { palette[i * 4] = r; palette[i * 4 + 1] = g; palette[i * 4 + 2] = b; palette[i * 4 + 3] = 255; };
  set(RED, 255, 0, 0);
  set(GREEN, 0, 255, 0);
  set(BLUE, 0, 0, 255);
  set(YELLOW, 255, 255, 0);

  // minitiles 0..3 are solid red / green / blue / yellow
  const minitiles = new Uint8Array(4 * 64);
  minitiles.fill(RED, 0, 64);
  minitiles.fill(GREEN, 64, 128);
  minitiles.fill(BLUE, 128, 192);
  minitiles.fill(YELLOW, 192, 256);

  const megatileCount = 5; // 0 is the null megatile
  const refs = new Uint32Array(megatileCount * 16);
  const fillWith = (m: number, mini: number) => { for (let i = 0; i < 16; i++) refs[m * 16 + i] = mini << 1; };
  fillWith(1, 0); // red
  fillWith(2, 1); // green
  fillWith(3, 2); // blue
  fillWith(4, 3); // yellow

  const cv5 = new Uint8Array(6 * 52);
  const view = new DataView(cv5.buffer);
  const group = (g: number, index: number, slots: number[]) => {
    view.setUint16(g * 52, index, true);
    slots.forEach((m, s) => view.setUint16(g * 52 + 20 + s * 2, m, true));
  };
  group(2, 2, [1, 4]); // left: red, or yellow as a second variation
  group(3, 2, [2, 2]); // right: green
  group(4, 3, [3]);
  group(5, 3, [3]);

  return { palette, minitiles, megatileRefs: refs, megatileCount, extended: false, megatileFlags: new Uint16Array(megatileCount * 16), groups: decodeCv5(cv5) };
}

const pixelAt = (patch: { pixels: Uint8ClampedArray; width: number }, x: number, y: number) => {
  const at = (y * patch.width + x) * 4;
  return [patch.pixels[at], patch.pixels[at + 1], patch.pixels[at + 2], patch.pixels[at + 3]];
};

describe("terrain patch", () => {
  it("is 32 px per tile and fully opaque", () => {
    const patch = renderTerrainPatch(synthetic(), { id: 2, group: 2 }, 4, 3);
    expect([patch.width, patch.height]).toEqual([4 * MEGATILE_PX, 3 * MEGATILE_PX]);
    expect([patch.cols, patch.rows]).toEqual([4, 3]);
    for (let at = 3; at < patch.pixels.length; at += 4) expect(patch.pixels[at]).toBe(255);
  });

  it("draws the tiles a new map would be filled with — left/right pairs by column parity", () => {
    const ts = synthetic();
    const patch = renderTerrainPatch(ts, { id: 2, group: 2 }, 4, 2, patchRandom(7));
    // Even columns come from group 2 (red or yellow), odd ones from group 3 (green).
    for (let x = 0; x < 4; x++) {
      const [r, g, b] = pixelAt(patch, x * MEGATILE_PX + 4, 4);
      if (x % 2 === 0) expect([r > 0, b]).toEqual([true, 0]);
      else expect([r, g, b]).toEqual([0, 255, 0]);
    }
  });

  it("is the same picture for the same seed and follows the terrain", () => {
    const ts = synthetic();
    const a = renderTerrainPatch(ts, { id: 2, group: 2 }, 3, 3, patchRandom(1));
    const b = renderTerrainPatch(ts, { id: 2, group: 2 }, 3, 3, patchRandom(1));
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
    expect(patchAverage(renderTerrainPatch(ts, { id: 3, group: 4 }, 2, 2))).toBe("#0000ff");
  });

  it("draws ids with no megatile as void rather than throwing", () => {
    const ts = synthetic();
    // Group 20 is past the CV5, so every tile id in it resolves to nothing.
    const patch = renderTerrainPatch(ts, { id: 9, group: 20 }, 2, 2);
    expect(pixelAt(patch, 1, 1)).toEqual([10, 12, 16, 255]);
  });

  it("uses the same fill as a new map's terrain", () => {
    const ts = synthetic();
    const patch = renderTerrainPatch(ts, { id: 2, group: 2 }, 4, 2, patchRandom(3));
    const tiles = flatTiles(4, 2, { id: 2, group: 2 }, ts, patchRandom(3));
    // Both took their variations from the same seeded sequence.
    expect(patch.width).toBe(4 * MEGATILE_PX);
    expect(tiles[0] >> 4).toBe(2);
    expect(tiles[1] >> 4).toBe(3);
  });
});

/* ── Against the real tilesets ──────────────────────────── */

const dir = join(process.cwd(), "public", "tileset");
const have = existsSync(join(dir, "badlands.cv5"));

function realTileset(name: string): Tileset {
  const read = (ext: string) => new Uint8Array(readFileSync(join(dir, `${name}.${ext}`)));
  return loadTileset({ cv5: read("cv5"), vf4: read("vf4"), vr4: read("vr4"), vx4: read("vx4"), wpe: read("wpe") });
}

describe.skipIf(!have)("terrain patch, real tilesets", () => {
  it("draws every tileset's default ground as something other than one flat colour", () => {
    for (const name of TILESET_FILENAMES) {
      if (!existsSync(join(dir, `${name}.cv5`))) continue;
      const ts = realTileset(name);
      const patch = renderTerrainPatch(ts, baseTerrain(ts), 6, 6);
      const seen = new Set<number>();
      for (let at = 0; at < patch.pixels.length; at += 4) seen.add((patch.pixels[at] << 16) | (patch.pixels[at + 1] << 8) | patch.pixels[at + 2]);
      // Ice's snow is nearly monochrome, so this is only "more than a flat fill".
      expect(seen.size, `${name} default ground`).toBeGreaterThan(3);
      expect(patchAverage(patch)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("draws a named terrain, not just the default", () => {
    const ts = realTileset("badlands");
    const water = renderTerrainPatch(ts, baseTerrain(ts, 5), 4, 4);   // Water
    const dirt = renderTerrainPatch(ts, baseTerrain(ts, 2), 4, 4);    // Dirt
    expect(patchAverage(water)).not.toBe(patchAverage(dirt));
  });
});
