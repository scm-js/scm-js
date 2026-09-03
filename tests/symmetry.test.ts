import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { decodeCv5, type Tileset } from "../src/formats/tileset/decode";
import { brushRect, stampTerrain, stampTile } from "../src/editor/terrain";
import {
  keepsShape, mirrorBox, mirrorIndices, mirrorPixel, mirrorPoints, mirrorRect, mirrorTileRect, requiresSquare, symmetryAvailable, symmetryAxes, SYMMETRY_MODES, type SymmetryMode,
} from "../src/editor/symmetry";

/** A tileset with one dirt pair (groups 2/3), nine variations — the same rig as tests/terrain-edit.test.ts. */
function dirtTileset(): Tileset {
  const cv5 = new Uint8Array(4 * 52);
  const view = new DataView(cv5.buffer);
  for (const group of [2, 3]) {
    const at = group * 52;
    view.setUint16(at, 2, true);
    for (let e = 0; e < 4; e++) view.setUint16(at + 4 + e * 2, 1, true);
    for (let slot = 0; slot < 9; slot++) view.setUint16(at + 20 + slot * 2, 1 + slot + (group - 2) * 16, true);
  }
  return { groups: decodeCv5(cv5) } as Tileset;
}

const blank = (width: number, height: number) => createScenario({ width, height, era: 0, name: "t" });
const pts = (mode: SymmetryMode, x: number, y: number, w: number, h: number) => mirrorPoints(mode, x, y, w, h).map((p) => `${p.x},${p.y}`);

describe("mirrored points", () => {
  it("keeps the original first and drops duplicates on the axis", () => {
    expect(pts("none", 3, 4, 10, 8)).toEqual(["3,4"]);
    expect(pts("h", 1, 2, 10, 8)).toEqual(["1,2", "8,2"]);
    expect(pts("v", 1, 2, 10, 8)).toEqual(["1,2", "1,5"]);
    expect(pts("hv", 1, 2, 10, 8)).toEqual(["1,2", "8,2", "1,5", "8,5"]);
    expect(pts("rot180", 0, 0, 10, 8)).toEqual(["0,0", "9,7"]);
    // A cell on the centre column of an odd-width map is its own mirror image.
    expect(pts("h", 2, 1, 5, 3)).toEqual(["2,1"]);
    expect(pts("hv", 2, 1, 5, 3)).toEqual(["2,1"]);
    expect(pts("hv", 2, 0, 5, 3)).toEqual(["2,0", "2,2"]);
    expect(pts("rot180", 2, 1, 5, 3)).toEqual(["2,1"]);
  });

  it("rotates and reflects square maps, and leaves those modes alone on others", () => {
    expect(pts("rot90", 1, 0, 6, 6)).toEqual(["1,0", "5,1", "4,5", "0,4"]);
    expect(pts("diag", 1, 4, 6, 6)).toEqual(["1,4", "4,1"]);
    expect(pts("diag", 2, 2, 6, 6)).toEqual(["2,2"]);
    expect(pts("adiag", 0, 0, 6, 6)).toEqual(["0,0", "5,5"]);
    expect(pts("adiag", 1, 0, 6, 6)).toEqual(["1,0", "5,4"]);
    expect(pts("rot90", 1, 0, 8, 6)).toEqual(["1,0"]);
    expect(pts("diag", 1, 0, 8, 6)).toEqual(["1,0"]);
    for (const m of SYMMETRY_MODES) {
      expect(requiresSquare(m.id)).toBe(["rot90", "diag", "adiag"].includes(m.id));
      expect(symmetryAvailable(m.id, 64, 64)).toBe(true);
      expect(symmetryAvailable(m.id, 64, 96)).toBe(!requiresSquare(m.id));
    }
  });

  it("is an involution: mirroring an image gives the original back", () => {
    for (const m of SYMMETRY_MODES) {
      for (const [w, h] of [[8, 8], [7, 7], [10, 6]]) {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          for (const p of mirrorPoints(m.id, x, y, w, h)) {
            expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThan(w);
            expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThan(h);
            expect(pts(m.id, p.x, p.y, w, h)).toContain(`${x},${y}`);
          }
        }
      }
    }
  });

  it("mirrors pixels continuously about the map's edges", () => {
    expect(mirrorPixel("h", 40, 50, 4, 4)).toEqual([{ x: 40, y: 50 }, { x: 88, y: 50 }]);
    expect(mirrorPixel("rot180", 0, 0, 4, 4)).toEqual([{ x: 0, y: 0 }, { x: 128, y: 128 }]);
    expect(mirrorPixel("rot90", 32, 0, 4, 4).map((p) => `${p.x},${p.y}`)).toEqual(["32,0", "128,32", "96,128", "0,96"]);
    expect(mirrorPixel("diag", 64, 64, 4, 4)).toEqual([{ x: 64, y: 64 }]);
  });

  it("mirrors a location's box, normalised, under every mode", () => {
    const box = { left: 0, top: 32, right: 64, bottom: 96 };
    expect(mirrorBox("h", box, 4, 4)).toEqual([box, { left: 64, top: 32, right: 128, bottom: 96 }]);
    expect(mirrorBox("rot180", box, 4, 4)[1]).toEqual({ left: 64, top: 32, right: 128, bottom: 96 });
    // A quarter turn of a 2×2 box at the left edge lands it against the top edge.
    expect(mirrorBox("rot90", box, 4, 4).map((b) => `${b.left},${b.top},${b.right},${b.bottom}`)).toEqual(["0,32,64,96", "32,0,96,64", "64,32,128,96", "32,64,96,128"]);
    expect(mirrorBox("none", box, 4, 4)).toEqual([box]);
    // A box straddling the axis is its own image.
    expect(mirrorBox("v", { left: 0, top: 32, right: 64, bottom: 96 }, 4, 4)).toHaveLength(1);
  });

  it("mirrors a doodad footprint by its top-left, and refuses to turn a non-square one", () => {
    expect(mirrorTileRect("h", 1, 2, 3, 2, 10, 8)).toEqual([{ x: 1, y: 2 }, { x: 6, y: 2 }]);
    expect(mirrorTileRect("v", 1, 2, 3, 2, 10, 8)).toEqual([{ x: 1, y: 2 }, { x: 1, y: 4 }]);
    expect(mirrorTileRect("rot90", 0, 0, 3, 2, 8, 8)).toEqual([{ x: 0, y: 0 }]);
    expect(mirrorTileRect("rot90", 0, 0, 2, 2, 8, 8)).toHaveLength(4);
    expect(keepsShape("rot90", 3, 2)).toBe(false);
    expect(keepsShape("hv", 3, 2)).toBe(true);
    expect(keepsShape("diag", 2, 2)).toBe(true);
  });
});

describe("mirrored footprints", () => {
  it("covers the brush rect and its images once each", () => {
    const cells = mirrorRect("hv", brushRect(0, 0, 2, 8, 6), 8, 6);
    expect([...cells].sort((a, b) => a - b)).toEqual([0, 1, 6, 7, 8, 9, 14, 15, 32, 33, 38, 39, 40, 41, 46, 47]);
    expect(mirrorRect("none", brushRect(1, 1, 3, 8, 6), 8, 6).size).toBe(9);
    // A footprint straddling the axis overlaps its own image; cells are still counted once.
    expect(mirrorRect("h", { x0: 3, y0: 0, x1: 5, y1: 1 }, 8, 6).size).toBe(2);
    expect([...mirrorIndices("v", [0, 1], 8, 6)].sort((a, b) => a - b)).toEqual([0, 1, 40, 41]);
  });

  it("gives the Rect brush valid left/right pairs across a horizontal mirror, whatever the width", () => {
    const tileset = dirtTileset();
    for (const width of [8, 9]) {
      const scn = blank(width, 4);
      const cells = mirrorRect("h", brushRect(1, 1, 2, width, 4), width, 4);
      const changes = stampTerrain(scn, tileset, { group: 2, variation: 4 }, cells);
      expect(changes.length).toBe(cells.size);
      for (const c of changes) {
        const x = c.at % width;
        expect(c.after >> 4, `x=${x}`).toBe(x % 2 === 0 ? 2 : 3);
        expect(c.after & 15).toBe(4);
      }
      // The mirrored side is a real pair: an even column with its right neighbour painted alongside.
      const xs = changes.map((c) => c.at % width).filter((x) => x >= width / 2).sort((a, b) => a - b);
      expect(xs.length).toBeGreaterThan(0);
    }
    // Both halves of a pair that fall inside the set share a variation when it is random.
    const scn = blank(8, 4);
    const cells = mirrorRect("h", brushRect(0, 0, 2, 8, 4), 8, 4);
    const changes = stampTerrain(scn, tileset, { group: 2 }, cells);
    const byAt = new Map(changes.map((c) => [c.at, c.after]));
    expect(byAt.get(0)! & 15).toBe(byAt.get(1)! & 15);
    expect(byAt.get(6)! & 15).toBe(byAt.get(7)! & 15);
  });

  it("mirrors the Tile brush", () => {
    const scn = blank(8, 6);
    const a = stampTile(scn, mirrorRect("rot180", brushRect(0, 0, 1, 8, 6), 8, 6), 0x20);
    expect(a.map((c) => c.at).sort((x, y) => x - y)).toEqual([0, 47]);
  });
});

describe("axes", () => {
  it("describe the mirror lines and a centre mark for rotations", () => {
    expect(symmetryAxes("h", 8, 6)).toEqual({ lines: [{ x0: 4, y0: 0, x1: 4, y1: 6 }], centre: false });
    expect(symmetryAxes("hv", 7, 5).lines).toHaveLength(2);
    expect(symmetryAxes("rot180", 8, 6)).toEqual({ lines: [], centre: true });
    expect(symmetryAxes("rot90", 8, 8).centre).toBe(true);
    expect(symmetryAxes("adiag", 8, 8).lines).toEqual([{ x0: 8, y0: 0, x1: 0, y1: 8 }]);
    expect(symmetryAxes("none", 8, 8)).toEqual({ lines: [], centre: false });
  });
});
