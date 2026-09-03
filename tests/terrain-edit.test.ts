import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { decodeCv5, type Tileset } from "../src/formats/tileset/decode";
import {
  applyChanges, brushRect, floodRegion, linePoints, stampTerrain, stampTile, Stroke,
} from "../src/editor/terrain";

/** A tileset with one dirt pair (groups 2/3, index 2), nine variations and no rare ones. */
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

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function blank(width = 8, height = 6) {
  return createScenario({ width, height, era: 0, name: "t" });
}

const cells = (scn: { width: number; height: number }, x: number, y: number, size: number) => {
  const r = brushRect(x, y, size, scn.width, scn.height);
  const out: number[] = [];
  for (let ty = r.y0; ty < r.y1; ty++) for (let tx = r.x0; tx < r.x1; tx++) out.push(ty * scn.width + tx);
  return out;
};
const stampTileAt = (scn: Parameters<typeof stampTile>[0], x: number, y: number, size: number, id: number) => stampTile(scn, cells(scn, x, y, size), id);
const stampTerrainAt = (scn: Parameters<typeof stampTerrain>[0], ts: Parameters<typeof stampTerrain>[1], brush: Parameters<typeof stampTerrain>[2], x: number, y: number, size: number, random?: () => number) =>
  stampTerrain(scn, ts, brush, cells(scn, x, y, size), random);

describe("brush footprint", () => {
  it("centres odd brushes and hangs even ones right and down, clipped to the map", () => {
    expect(brushRect(4, 4, 1, 8, 8)).toEqual({ x0: 4, y0: 4, x1: 5, y1: 5 });
    expect(brushRect(4, 4, 3, 8, 8)).toEqual({ x0: 3, y0: 3, x1: 6, y1: 6 });
    expect(brushRect(4, 4, 2, 8, 8)).toEqual({ x0: 4, y0: 4, x1: 6, y1: 6 });
    expect(brushRect(0, 0, 5, 8, 8)).toEqual({ x0: 0, y0: 0, x1: 3, y1: 3 });
    expect(brushRect(7, 7, 4, 8, 8)).toEqual({ x0: 6, y0: 6, x1: 8, y1: 8 });
  });
});

describe("tile stamps", () => {
  it("writes one id across the footprint and skips tiles already holding it", () => {
    const scn = blank();
    scn.tiles[2 * 8 + 3] = 0x1234;
    const changes = stampTileAt(scn, 3, 2, 3, 0x1234);
    expect(changes).toHaveLength(8);
    expect(changes.every((c) => c.after === 0x1234 && c.before === 0)).toBe(true);
    expect(changes.map((c) => c.at)).not.toContain(2 * 8 + 3);
  });

  it("applies, marks MTXM and TILE dirty, and undoes back to the original", () => {
    const scn = blank();
    scn.dirty.clear();
    const before = Uint16Array.from(scn.tiles);
    const changes = stampTileAt(scn, 1, 1, 2, 0x0042);
    applyChanges(scn, changes);
    expect([...scn.dirty]).toEqual(["MTXM", "TILE"]);
    expect(scn.tiles[1 * 8 + 1]).toBe(0x42);
    expect(scn.tiles[2 * 8 + 2]).toBe(0x42);
    applyChanges(scn, changes, "undo");
    expect(scn.tiles).toEqual(before);
  });
});

describe("terrain stamps", () => {
  it("lays pairs by map parity and shares one variation across a pair", () => {
    const scn = blank(8, 4);
    const changes = stampTerrainAt(scn, dirtTileset(), { group: 2 }, 3, 1, 4, seeded(5));
    applyChanges(scn, changes);
    // 4x4 centred on (3,1): columns 2..5, rows 0..3.
    for (let y = 0; y < 4; y++) {
      for (let x = 2; x < 6; x += 2) {
        const left = scn.tiles[y * 8 + x];
        const right = scn.tiles[y * 8 + x + 1];
        expect(left >> 4).toBe(2);
        expect(right >> 4).toBe(3);
        expect(right & 15).toBe(left & 15);
      }
      expect(scn.tiles[y * 8 + 1]).toBe(0);
      expect(scn.tiles[y * 8 + 6]).toBe(0);
    }
  });

  it("gives an unpaired odd column the right-hand group with its own variation", () => {
    const scn = blank(8, 2);
    // Footprint starts on an odd column: x 3..4 -> (3 alone) (4 alone, since 5 is outside).
    const changes = stampTerrainAt(scn, dirtTileset(), { group: 2 }, 3, 0, 2, seeded(9));
    applyChanges(scn, changes);
    expect(scn.tiles[3] >> 4).toBe(3);
    expect(scn.tiles[4] >> 4).toBe(2);
    expect(scn.tiles[2]).toBe(0);
    expect(scn.tiles[5]).toBe(0);
  });

  it("does not pair across a row boundary", () => {
    const scn = blank(4, 2);
    // Indices 3 (x=3, y=0) and 4 (x=0, y=1) are consecutive but on different rows.
    const changes = stampTerrain(scn, dirtTileset(), { group: 2 }, [3, 4], seeded(1));
    applyChanges(scn, changes);
    expect(scn.tiles[3] >> 4).toBe(3);
    expect(scn.tiles[4] >> 4).toBe(2);
  });

  it("honours a fixed variation", () => {
    const scn = blank(4, 1);
    applyChanges(scn, stampTerrain(scn, dirtTileset(), { group: 2, variation: 7 }, [0, 1, 2, 3]));
    expect([...scn.tiles]).toEqual([0x27, 0x37, 0x27, 0x37]);
  });
});

describe("flood fill", () => {
  it("grows a 4-connected region of matching tiles", () => {
    const scn = blank(4, 3);
    // Row 1 is a wall of 9s; the fill must not cross it.
    for (let x = 0; x < 4; x++) scn.tiles[1 * 4 + x] = 9;
    scn.tiles[0] = 5; scn.tiles[1] = 5;
    const region = floodRegion(scn, 0, 0, (id) => id === 5);
    expect([...region].sort((a, b) => a - b)).toEqual([0, 1]);
    const bottom = floodRegion(scn, 0, 2, (id) => id === 0);
    expect(bottom.size).toBe(4);
    expect(floodRegion(scn, 9, 9, () => true).size).toBe(0);
  });

  it("refills the region with a tile id", () => {
    const scn = blank(4, 2);
    const region = floodRegion(scn, 0, 0, (id) => id === 0);
    applyChanges(scn, stampTile(scn, region, 0x77));
    expect([...scn.tiles].every((t) => t === 0x77)).toBe(true);
  });
});

describe("stroke bookkeeping", () => {
  it("keeps the first before and the last after per tile, and drops no-ops", () => {
    const s = new Stroke();
    s.add([{ at: 3, before: 1, after: 2 }, { at: 4, before: 1, after: 5 }]);
    s.add([{ at: 3, before: 2, after: 9 }, { at: 4, before: 5, after: 1 }]);
    expect(s.size).toBe(2);
    expect(s.finish()).toEqual([{ at: 3, before: 1, after: 9 }]);
  });

  it("walks a line with no gaps", () => {
    const pts = linePoints(0, 0, 3, 1);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts.at(-1)).toEqual({ x: 3, y: 1 });
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y)).toBeLessThanOrEqual(2);
    }
    expect(linePoints(2, 2, 2, 2)).toEqual([{ x: 2, y: 2 }]);
  });
});
