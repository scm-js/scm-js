import { describe, expect, it } from "vitest";
import type { Scenario } from "../src/formats/chk/scenario";
import { loadTileset, type Tileset } from "../src/formats/tileset/decode";
import { fairnessReport, likelySymmetry, symmetryShares, UNLIKE_BUILD, UNLIKE_HEIGHT, UNLIKE_WALK } from "../src/editor/fairness";

/**
 * A synthetic tileset. Group 2 (tiles 0x20..) is buildable, group 3 (0x30..) is not.
 * Megatiles: 1 floor, 2 wall, 3 high floor, 4 floor with its left column of small squares wall,
 * 5 floor with its right column wall (4 in a mirror).
 */
function synthetic(): Tileset {
  const count = 6;
  const vf4 = new Uint8Array(count * 32);
  const flags = new DataView(vf4.buffer);
  const set = (m: number, f: (col: number, row: number) => number) => { for (let i = 0; i < 16; i++) flags.setUint16((m * 16 + i) * 2, f(i & 3, i >> 2), true); };
  set(1, () => 1);
  set(2, () => 0);
  set(3, () => 1 | 4);
  set(4, (c) => (c === 0 ? 0 : 1));
  set(5, (c) => (c === 3 ? 0 : 1));
  const cv5 = new Uint8Array(4 * 52);
  const view = new DataView(cv5.buffer);
  for (const g of [2, 3]) {
    view.setUint16(g * 52, 2, true);
    if (g === 3) view.setUint16(g * 52 + 2, 0x0080, true);
    for (let s = 0; s < 5; s++) view.setUint16(g * 52 + 20 + s * 2, s + 1, true);
  }
  return loadTileset({ cv5, vf4, vr4: new Uint8Array(64), vx4: new Uint8Array(count * 32), wpe: new Uint8Array(1024) });
}

const FLOOR = 0x20, WALL = 0x21, HIGH = 0x22, LEFT_WALL = 0x23, RIGHT_WALL = 0x24, NO_BUILD = 0x30;

function map(width: number, height: number, rows: number[][], units: { unitId: number; x: number; y: number; resourceAmount?: number }[] = []) {
  return { width, height, tiles: Uint16Array.from(rows.flat()), units: units.map((u) => ({ resourceAmount: 0, ...u })) } as unknown as Scenario;
}

describe("a map against its own image", () => {
  const ts = synthetic();

  it("is alike all over when one side is the other in a mirror, flags mirrored inside the tile too", () => {
    const scn = map(4, 2, [
      [FLOOR, LEFT_WALL, RIGHT_WALL, FLOOR],
      [WALL, HIGH, HIGH, WALL],
    ]);
    const report = fairnessReport(scn, ts, "h")!;
    expect(report.compared).toBe(4 * 2 * 16 / 2);
    expect(report.unlike).toBe(0);
    expect(report.alike).toBe(1);
    expect(report.places).toEqual([]);
  });

  it("counts the small squares that differ, by what differs, and says where", () => {
    const scn = map(4, 2, [
      [FLOOR, LEFT_WALL, LEFT_WALL, FLOOR],   // the far side's wall is on the wrong edge of its tile
      [WALL, HIGH, FLOOR, NO_BUILD],          // height on one side only; and a wall against unbuildable floor
    ]);
    const report = fairnessReport(scn, ts, "h")!;
    // Row 0: tile 1's left column of wall answers tile 2's right column, which is floor, and the other way about.
    // Row 1: 16 squares of height, 16 of walking (and building, the tile over).
    expect(report.walk).toBe(8 + 16);
    expect(report.height).toBe(16);
    expect(report.build).toBe(16);
    expect(report.unlike).toBe(8 + 16 + 16);
    // One place: the tiles touch. On the left half, where the lower index of each pair is.
    expect(report.places).toEqual([{ x0: 0, y0: 0, x1: 2, y1: 2, squares: 40, walk: 24, height: 16, build: 16 }]);
    // The mask marks both sides.
    const W = 16;
    expect(report.mask[0 * W + 4] & UNLIKE_WALK).toBe(UNLIKE_WALK);
    expect(report.mask[0 * W + 11] & UNLIKE_WALK).toBe(UNLIKE_WALK);
    expect(report.mask[4 * W + 5] & UNLIKE_HEIGHT).toBe(UNLIKE_HEIGHT);
    expect(report.mask[4 * W + 15] & UNLIKE_BUILD).toBe(UNLIKE_BUILD);
    expect(report.mask[0 * W + 0]).toBe(0);
  });

  it("holds a square against all its images under a four-way mode", () => {
    const rows = [
      [FLOOR, FLOOR, FLOOR, FLOOR],
      [FLOOR, FLOOR, FLOOR, FLOOR],
      [FLOOR, FLOOR, FLOOR, FLOOR],
      [FLOOR, FLOOR, FLOOR, WALL],
    ];
    const report = fairnessReport(map(4, 4, rows), ts, "hv")!;
    expect(report.compared).toBe(64);
    expect(report.unlike).toBe(16);
    expect(report.places).toEqual([{ x0: 0, y0: 0, x1: 1, y1: 1, squares: 16, walk: 16, height: 0, build: 0 }]);
  });

  it("has nothing to say without a mode, or for a turn on a map that is not square", () => {
    const scn = map(4, 2, [[FLOOR, FLOOR, FLOOR, FLOOR], [FLOOR, FLOOR, FLOOR, FLOOR]]);
    expect(fairnessReport(scn, ts, "none")).toBeNull();
    expect(fairnessReport(scn, ts, "rot90")).toBeNull();
    expect(fairnessReport(scn, ts, "rot180")!.unlike).toBe(0);
  });

  it("wants every mineral field, geyser and start location to have its like at its image", () => {
    const row = [FLOOR, FLOOR, FLOOR, FLOOR, FLOOR, FLOOR, FLOOR, FLOOR];
    const scn = map(8, 4, [row, row, row, row], [
      { unitId: 214, x: 16, y: 16 }, { unitId: 214, x: 240, y: 16 },
      { unitId: 176, x: 32, y: 112, resourceAmount: 1500 }, { unitId: 178, x: 224, y: 112, resourceAmount: 1500 },   // another picture of a mineral field is a mineral field
      { unitId: 176, x: 96, y: 64, resourceAmount: 1500 }, { unitId: 176, x: 160, y: 64, resourceAmount: 500 },
      { unitId: 188, x: 64, y: 16, resourceAmount: 5000 },
      { unitId: 0, x: 20, y: 20 },                                                                                   // a marine is nobody's business here
    ]);
    const report = fairnessReport(scn, ts, "h")!;
    expect(report.resources).toEqual([
      { index: 4, unitId: 176, x: 96, y: 64, why: "amount" },
      { index: 5, unitId: 176, x: 160, y: 64, why: "amount" },
      { index: 6, unitId: 188, x: 64, y: 16, why: "missing" },
    ]);
  });

  it("tells which symmetry a map was made with", () => {
    const mirrored = map(4, 4, [
      [FLOOR, WALL, WALL, FLOOR],
      [HIGH, FLOOR, FLOOR, HIGH],
      [WALL, WALL, WALL, WALL],
      [FLOOR, FLOOR, FLOOR, FLOOR],
    ]);
    const shares = symmetryShares(mirrored, ts);
    expect(shares.h).toBe(1);
    expect(shares.v).toBeLessThan(0.9);
    expect(likelySymmetry(shares)).toBe("h");
    const four = map(4, 4, [
      [WALL, FLOOR, FLOOR, WALL],
      [FLOOR, HIGH, HIGH, FLOOR],
      [FLOOR, HIGH, HIGH, FLOOR],
      [WALL, FLOOR, FLOOR, WALL],
    ]);
    // Alike under every mode: the widest one that fits is the answer.
    expect(["hv", "rot90"]).toContain(likelySymmetry(symmetryShares(four, ts)));
    const none = map(4, 4, [
      [WALL, WALL, FLOOR, FLOOR],
      [HIGH, WALL, WALL, FLOOR],
      [FLOOR, HIGH, WALL, HIGH],
      [FLOOR, FLOOR, HIGH, WALL],
    ]);
    expect(likelySymmetry(symmetryShares(none, ts))).toBeNull();
  });
});
