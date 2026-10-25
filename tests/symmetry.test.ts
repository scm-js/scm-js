import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { decodeCv5, type Tileset } from "../src/formats/tileset/decode";
import { brushRect, stampTerrain, stampTile } from "../src/editor/terrain";
import {
  boxImage, keepsShape, mirrorBox, mirroredOwner, mirrorIndices, mirrorMoves, mirrorPixel, mirrorPixelImages, mirrorPoints, mirrorRect, mirrorTileRect, mirrorTileRectImages,
  requiresSquare, SAME_MOVE, symmetryAvailable, symmetryAxes, symmetryImages, SYMMETRY_MODES, withMirrorImages, type Placed, type SymmetryMode,
} from "../src/editor/symmetry";
import { addLocation, applyLocationChanges, ensureLocationSlots, moveLocationsMirrored, placedLocations } from "../src/editor/locations";

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

describe("copies for their own players", () => {
  const MODES: SymmetryMode[] = ["h", "v", "hv", "rot180", "rot90", "diag", "adiag"];

  it("numbers each image's element, the original 0", () => {
    expect(mirrorPixelImages("hv", 100, 60, 10, 8).map((p) => p.element)).toEqual([0, 1, 2, 3]);
    expect(mirrorPixelImages("rot90", 100, 60, 8, 8).map((p) => p.element)).toEqual([0, 1, 2, 3]);
    // On the axis an image is the original again, and is dropped.
    expect(mirrorPixelImages("h", 160, 60, 10, 8)).toEqual([{ x: 160, y: 60, element: 0 }]);
    expect(mirrorTileRectImages("v", 1, 2, 3, 2, 10, 8)).toEqual([{ x: 1, y: 2, element: 0 }, { x: 1, y: 4, element: 1 }]);
  });

  it("gives a two-way copy the other player of its pair, and leaves neutral alone", () => {
    expect(mirroredOwner("rot180", 0, 1)).toBe(1);
    expect(mirroredOwner("rot180", 1, 1)).toBe(0);
    expect(mirroredOwner("h", 4, 1)).toBe(5);
    expect(mirroredOwner("h", 7, 1)).toBe(6);
    expect(mirroredOwner("h", 11, 1)).toBe(11);
    expect(mirroredOwner("h", 8, 1)).toBe(8);
    expect(mirroredOwner("h", 0, 0)).toBe(0);
  });

  it("hands each corner the same player whichever player places", () => {
    const w = 16, h = 16, at = { x: 100, y: 70 };
    for (const mode of MODES) {
      for (const group of [0, 4]) {
        const corners = (owner: number, x: number, y: number) =>
          new Map(mirrorPixelImages(mode, x, y, w, h).map((p) => [`${p.x},${p.y}`, mirroredOwner(mode, owner, p.element)]));
        const fromFirst = corners(group, at.x, at.y);
        for (const [pos, owner] of fromFirst) {
          const [x, y] = pos.split(",").map(Number);
          expect(corners(owner, x, y), `${mode} from P${owner + 1}`).toEqual(fromFirst);
        }
        // Every copy goes to a different player of the group.
        expect(new Set(fromFirst.values()).size).toBe(fromFirst.size);
        for (const o of fromFirst.values()) expect(o >= group && o < group + 4).toBe(true);
      }
    }
  });

  it("goes clockwise under the quarter turn: P1 top-left, P2 top-right, P3 bottom-right, P4 bottom-left", () => {
    const out = mirrorPixelImages("rot90", 64, 64, 16, 16).map((p) => ({ x: p.x, y: p.y, owner: mirroredOwner("rot90", 0, p.element) }));
    expect(out).toEqual([{ x: 64, y: 64, owner: 0 }, { x: 448, y: 64, owner: 1 }, { x: 448, y: 448, owner: 2 }, { x: 64, y: 448, owner: 3 }]);
  });
});

describe("selecting and moving mirror images", () => {
  // A 10 × 8 map is 320 × 256 pixels.
  const items: (Placed | null)[] = [
    { x: 40, y: 50, kind: 7 }, // 0
    { x: 282, y: 50, kind: 7 }, // 1: the horizontal image of 0, two pixels off
    { x: 280, y: 50, kind: 9 }, // 2: at the image, but something else
    null, // 3: a removed slot
    { x: 40, y: 206, kind: 7 }, // 4: the vertical image of 0
    { x: 160, y: 128, kind: 7 }, // 5: on both axes
  ];

  it("selects what stands at the images, matched by kind within the tolerance", () => {
    expect(withMirrorImages("h", items, [0], 10, 8, 16)).toEqual([0, 1]);
    expect(withMirrorImages("h", items, [0], 10, 8, 1)).toEqual([0]);
    expect(withMirrorImages("hv", items, [0], 10, 8, 16).sort()).toEqual([0, 1, 4]);
    expect(withMirrorImages("v", items, [1], 10, 8, 16)).toEqual([1]);
    expect(withMirrorImages("hv", items, [5], 10, 8, 16)).toEqual([5]);
    expect(withMirrorImages("none", items, [0], 10, 8, 16)).toEqual([0]);
  });

  it("moves the one nearest the pointer as the pointer goes and its images as their mirrors", () => {
    const moves = mirrorMoves("h", items, [0, 1], { x: 45, y: 50 }, 10, 8, 16);
    expect(moves.get(0)).toBe(SAME_MOVE);
    expect(moves.get(1)!(10, 4)).toEqual({ x: -10, y: 4 });
    // Grabbed from the other side, that side follows the pointer instead.
    const back = mirrorMoves("h", items, [0, 1], { x: 280, y: 50 }, 10, 8, 16);
    expect(back.get(1)).toBe(SAME_MOVE);
    expect(back.get(0)!(10, 4)).toEqual({ x: -10, y: 4 });
    // Under "hv" the vertical image keeps x and turns y.
    const four = mirrorMoves("hv", items, [0, 1, 4], { x: 40, y: 50 }, 10, 8, 16);
    expect(four.get(4)!(10, 4)).toEqual({ x: 10, y: -4 });
    // Something with no image in the selection follows the pointer; so does everything with the mode off.
    expect(mirrorMoves("h", items, [0, 2], { x: 40, y: 50 }, 10, 8, 16).get(2)).toBe(SAME_MOVE);
    expect([...mirrorMoves("none", items, [0, 1], { x: 40, y: 50 }, 10, 8, 16).values()].every((m) => m === SAME_MOVE)).toBe(true);
  });

  it("keeps a moved point and its moved image mirror images, for every mode", () => {
    const w = 12, h = 12, p = { x: 70, y: 30 }, d = { x: 13, y: -7 };
    for (const mode of ["h", "v", "hv", "rot180", "rot90", "diag", "adiag"] as SymmetryMode[]) {
      for (const img of symmetryImages(mode, w * 32, h * 32)) {
        const q = img.map(p.x, p.y), m = img.linear(d.x, d.y);
        expect({ x: q.x + m.x, y: q.y + m.y }, mode).toEqual(img.map(p.x + d.x, p.y + d.y));
      }
    }
  });

  it("resizes and nudges a location's mirror images with it", () => {
    const scn = blank(10, 8);
    ensureLocationSlots(scn);
    const a = addLocation(scn, { left: 32, top: 32, right: 96, bottom: 64 });
    applyLocationChanges(scn, a.changes);
    const b = addLocation(scn, { left: 224, top: 32, right: 288, bottom: 64 });
    applyLocationChanges(scn, b.changes);
    const image = symmetryImages("h", 320, 256)[0];
    expect(boxImage(image, { left: 32, top: 32, right: 128, bottom: 64 })).toEqual({ left: 192, top: 32, right: 288, bottom: 64 });

    const placed = placedLocations(scn);
    expect(withMirrorImages("h", placed, [a.index], 10, 8, 8)).toEqual([a.index, b.index]);
    const moves = mirrorMoves("h", placed, [a.index, b.index], { x: 64, y: 48 }, 10, 8, 8);
    // Thirty-two pixels left would take the first box off the map; it stops at the edge, and the image stops with it.
    const changes = moveLocationsMirrored(scn, [a.index, b.index], -64, 0, moves);
    expect(changes.map((c) => [c.index, c.after.left, c.after.right])).toEqual([[a.index, 0, 64], [b.index, 256, 320]]);
  });
});
