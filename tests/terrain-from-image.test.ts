import { describe, expect, it } from "vitest";
import { adaptiveMatcher, bandByBrightness, boxBlur, cellsByTerrain, chromaticity, colorDistance, countCells, luminance, matchTerrains, nearestByColor, pack, unpack } from "../plugins/terrain-from-image/convert";

/** A width × height RGBA picture from a function of (x, y). */
function picture(width: number, height: number, at: (x: number, y: number) => [number, number, number, number?]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = at(x, y);
      out.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  return out;
}

const GRASS = { id: 5, color: pack(40, 120, 40) };
const WATER = { id: 7, color: pack(30, 60, 160) };
const DIRT = { id: 2, color: pack(120, 90, 50) };

describe("colour helpers", () => {
  it("pack and unpack round-trip and luma is ordered", () => {
    expect(unpack(pack(1, 2, 3))).toEqual([1, 2, 3]);
    expect(luminance(255, 255, 255)).toBeCloseTo(255);
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(0, 0, 255));
    expect(colorDistance(10, 10, 10, 10, 10, 10)).toBe(0);
  });

  it("finds the nearest terrain by colour and the band by brightness", () => {
    expect(nearestByColor(35, 110, 45, [GRASS, WATER, DIRT])).toBe(0);
    expect(nearestByColor(20, 50, 170, [GRASS, WATER, DIRT])).toBe(1);
    expect(nearestByColor(0, 0, 0, [])).toBe(-1);
    expect(bandByBrightness(0, 3)).toBe(0);
    expect(bandByBrightness(127, 3)).toBe(1);
    expect(bandByBrightness(255, 3)).toBe(2);
    expect(bandByBrightness(100, 0)).toBe(-1);
  });
});

describe("adaptive matching against real (dark) tileset averages", () => {
  // Jungle's actual atlas averages: every terrain is a murky brown, water a grey-blue.
  const JUNGLE = [
    { id: 5, color: 0x26273a }, // Water
    { id: 2, color: 0x33291a }, // Dirt
    { id: 4, color: 0x231f1a }, // Mud
    { id: 6, color: 0x21260b }, // Jungle
    { id: 12, color: 0x3b393b }, // Temple
    { id: 3, color: 0x4c402e }, // High Dirt
  ];

  it("sends a saturated blue to Water and a black band to the darkest ground", () => {
    const nearest = adaptiveMatcher(JUNGLE, [16, 200]);
    expect(JUNGLE[nearest(32, 58, 144)].id).toBe(5);
    expect(JUNGLE[nearest(16, 16, 16)].id).toBe(4);
    expect(JUNGLE[nearest(42, 90, 32)].id).toBe(6);
    expect(chromaticity(0, 0, 0)).toEqual([1 / 3, 1 / 3]);
    expect(adaptiveMatcher([], [0, 255])(1, 2, 3)).toBe(-1);
  });

  it("uses relative brightness so a flat image still resolves", () => {
    const nearest = adaptiveMatcher(JUNGLE, [100, 100]);
    expect(nearest(100, 100, 100)).toBeGreaterThanOrEqual(0);
  });
});

describe("matching", () => {
  it("assigns every opaque cell the nearest colour and skips transparent ones", () => {
    const rgba = picture(4, 2, (x, y) => (y === 0 ? [40, 120, 40] : x === 3 ? [0, 0, 0, 0] : [30, 60, 160]));
    const grid = matchTerrains(rgba, 4, 2, { terrains: [GRASS, WATER, DIRT], mode: "color", smooth: 0 });
    expect([...grid]).toEqual([5, 5, 5, 5, 7, 7, 7, -1]);
    expect(countCells(grid, [GRASS, WATER, DIRT])).toEqual([4, 3, 0]);
  });

  it("maps brightness bands in list order, dark to light", () => {
    const rgba = picture(3, 1, (x) => [x * 120, x * 120, x * 120]);
    const grid = matchTerrains(rgba, 3, 1, { terrains: [WATER, DIRT, GRASS], mode: "brightness", smooth: 0 });
    expect([...grid]).toEqual([7, 2, 5]);
  });

  it("returns -1 everywhere with no terrains", () => {
    const grid = matchTerrains(picture(2, 2, () => [1, 2, 3]), 2, 2, { terrains: [], mode: "color", smooth: 0 });
    expect([...grid]).toEqual([-1, -1, -1, -1]);
  });

  it("smoothing removes an isolated speck", () => {
    const rgba = picture(5, 5, (x, y) => (x === 2 && y === 2 ? [30, 60, 160] : [40, 120, 40]));
    const sharp = matchTerrains(rgba, 5, 5, { terrains: [GRASS, WATER], mode: "color", smooth: 0 });
    const soft = matchTerrains(rgba, 5, 5, { terrains: [GRASS, WATER], mode: "color", smooth: 1 });
    expect(sharp[12]).toBe(7);
    expect(soft[12]).toBe(5);
    expect(boxBlur(rgba, 5, 5, 0)).toBe(rgba);
    const blurred = boxBlur(rgba, 5, 5, 1);
    expect(blurred[12 * 4]).toBeGreaterThan(30);
    expect(blurred[0]).toBe(40); // corners of a flat field stay flat
  });

  it("groups cells by terrain with the rect origin applied", () => {
    const grid = new Int32Array([5, 7, -1, 5]);
    const groups = cellsByTerrain(grid, 2, 2, 3, 1, 10);
    expect([...groups.get(5)!]).toEqual([1 * 10 + 3, 2 * 10 + 4]);
    expect([...groups.get(7)!]).toEqual([1 * 10 + 4]);
    expect(groups.has(-1)).toBe(false);
  });
});
