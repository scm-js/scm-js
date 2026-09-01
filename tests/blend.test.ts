import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createScenario } from "../src/formats/chk/create";
import { decodeCv5, loadTileset, MEGATILE_PX, type Tileset } from "../src/formats/tileset/decode";
import { TILESET_FILENAMES } from "../src/formats/tileset/load";
import { TILESETS } from "../src/data/tilesets";
import { isFlatPair, terrainTypes } from "../src/formats/tileset/palette";
import { applyChanges } from "../src/editor/terrain";
import {
  blendCandidates, blendSides, DEFAULT_BLEND_OPTIONS, drawableTiles, edgeDistance, edgeTable, neighbourOf, OPPOSITE, placeBlend, SIDES,
  type Side,
} from "../src/editor/blend";

/* ── A synthetic tileset with solid-colour and split megatiles ── */

const RED = 1, GREEN = 2, BLUE = 3, NEAR_RED = 4;

/**
 * Megatiles (VX4 index → picture):
 *   1  solid red
 *   2  solid green
 *   3  left half red, right half blue     (minitiles 0,1 red / 2,3 blue per row)
 *   4  solid near-red (250,4,4)
 *   5  a flipped minitile: the *unflipped* bitmap is red on its left 4 px, blue on its right 4 px,
 *      placed with the flip bit so the visible left edge is blue and the right edge red
 * Groups: 2 → slots [1, 2], 3 → slots [3, 4, 5], 4 → slot 0 reuses megatile 1 (a duplicate).
 */
function synthetic(): Tileset {
  const palette = new Uint8Array(256 * 4);
  const set = (i: number, r: number, g: number, b: number) => { palette[i * 4] = r; palette[i * 4 + 1] = g; palette[i * 4 + 2] = b; palette[i * 4 + 3] = 255; };
  set(RED, 255, 0, 0);
  set(GREEN, 0, 255, 0);
  set(BLUE, 0, 0, 255);
  set(NEAR_RED, 250, 4, 4);

  // minitile bitmaps: 0 red, 1 green, 2 blue, 3 near-red, 4 red|blue split
  const minitiles = new Uint8Array(5 * 64);
  minitiles.fill(RED, 0, 64);
  minitiles.fill(GREEN, 64, 128);
  minitiles.fill(BLUE, 128, 192);
  minitiles.fill(NEAR_RED, 192, 256);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) minitiles[256 + y * 8 + x] = x < 4 ? RED : BLUE;

  const megatileCount = 6;
  const refs = new Uint32Array(megatileCount * 16);
  const fillWith = (m: number, mini: number, flip = 0) => { for (let i = 0; i < 16; i++) refs[m * 16 + i] = (mini << 1) | flip; };
  fillWith(1, 0);
  fillWith(2, 1);
  for (let i = 0; i < 16; i++) refs[3 * 16 + i] = ((i % 4) < 2 ? 0 : 2) << 1;
  fillWith(4, 3);
  fillWith(5, 4, 1);

  const cv5 = new Uint8Array(5 * 52);
  const view = new DataView(cv5.buffer);
  const group = (g: number, index: number, slots: number[]) => {
    view.setUint16(g * 52, index, true);
    slots.forEach((m, s) => view.setUint16(g * 52 + 20 + s * 2, m, true));
  };
  group(2, 2, [1, 2]);
  group(3, 2, [3, 4, 5]);
  group(4, 3, [1]);

  return { palette, minitiles, megatileRefs: refs, megatileCount, extended: false, megatileFlags: new Uint16Array(megatileCount * 16), groups: decodeCv5(cv5) };
}

describe("edge table", () => {
  it("lifts the outermost pixel strips of each megatile, honouring the flip bit", () => {
    const ts = synthetic();
    const edges = edgeTable(ts);
    expect(edges.count).toBe(6);
    expect(edgeTable(ts)).toBe(edges); // cached per tileset

    const strip = (m: number, side: number) => {
      const at = m * 4 * MEGATILE_PX * 3 + side * MEGATILE_PX * 3;
      return Array.from(edges.data.subarray(at, at + 6)); // first two pixels
    };
    // megatile 3: left edge red, right edge blue, top/bottom start red and end blue
    expect(strip(3, 0)).toEqual([255, 0, 0, 255, 0, 0]);
    expect(strip(3, 2)).toEqual([0, 0, 255, 0, 0, 255]);
    expect(strip(3, 1)).toEqual([255, 0, 0, 255, 0, 0]);
    const bottomEnd = 3 * 4 * MEGATILE_PX * 3 + 3 * MEGATILE_PX * 3 + (MEGATILE_PX - 1) * 3;
    expect(Array.from(edges.data.subarray(bottomEnd, bottomEnd + 3))).toEqual([0, 0, 255]);
    // megatile 5 is drawn flipped: what was red-left/blue-right shows blue-left/red-right
    expect(strip(5, 0)).toEqual([0, 0, 255, 0, 0, 255]);
    expect(strip(5, 2)).toEqual([255, 0, 0, 255, 0, 0]);
  });

  it("measures the mean colour difference between two strips", () => {
    const edges = edgeTable(synthetic());
    expect(edgeDistance(edges, 1, "right", 1, "left")).toBe(0);
    expect(edgeDistance(edges, 1, "right", 4, "left")).toBeCloseTo((5 + 4 + 4) / 3, 5);
    expect(edgeDistance(edges, 1, "right", 2, "left")).toBeCloseTo(170, 5); // red vs green: 255+255+0 over 3
    // symmetric
    expect(edgeDistance(edges, 3, "right", 5, "left")).toBe(edgeDistance(edges, 5, "left", 3, "right"));
  });
});

describe("blend candidates", () => {
  it("lists one id per drawable megatile, lowest id first", () => {
    const ts = synthetic();
    // group 4 slot 0 re-uses megatile 1, which group 2 slot 0 already showed
    expect(Array.from(drawableTiles(ts))).toEqual([0x20, 0x21, 0x30, 0x31, 0x32]);
  });

  it("ranks by the seam against the opposite edge and cuts at the tolerance", () => {
    const ts = synthetic();
    // Right of solid red: red (0), the split tile's red left edge (0), near-red (4.3); blue-left (5) and green are out.
    const right = blendCandidates(ts, 0x20, "right", { maxDistance: 24, limit: 48 });
    expect(right.map((c) => [c.id, Math.round(c.distance * 10) / 10])).toEqual([[0x20, 0], [0x30, 0], [0x31, 4.3]]);
    // Left of solid red: the split tile's *right* edge is blue, so it drops out; the flipped tile's right edge is red.
    const left = blendCandidates(ts, 0x20, "left", { maxDistance: 24, limit: 48 });
    expect(left.map((c) => c.id)).toEqual([0x20, 0x32, 0x31]);
    // The limit keeps the best.
    expect(blendCandidates(ts, 0x20, "right", { maxDistance: 255, limit: 2 }).map((c) => c.id)).toEqual([0x20, 0x30]);
    // A filter narrows the pool.
    expect(blendCandidates(ts, 0x20, "right", { maxDistance: 255, limit: 48, include: (id) => id >> 4 === 3 }).map((c) => c.id)).toEqual([0x30, 0x31, 0x32]);
  });

  it("returns nothing for an anchor with no picture", () => {
    const ts = synthetic();
    expect(blendCandidates(ts, 0x00, "right")).toEqual([]);
    expect(blendCandidates(ts, 0x2f, "right")).toEqual([]);
    expect(blendCandidates(ts, 0xfff0, "right")).toEqual([]);
  });

  it("covers all four sides at once", () => {
    const sides = blendSides(synthetic(), 0x30, { maxDistance: 1, limit: 48 });
    // The split tile is red on the left and blue on the right: solid red and the flipped tile
    // (red right edge) go on its left, only the flipped tile (blue left edge) on its right, and
    // its mixed top/bottom strips match nothing but itself.
    expect(sides.left.map((c) => c.id)).toEqual([0x20, 0x32]);
    expect(sides.right.map((c) => c.id)).toEqual([0x32]);
    expect(sides.top.map((c) => c.id)).toEqual([0x30]);
    expect(sides.bottom.map((c) => c.id)).toEqual([0x30]);
  });
});

describe("placing a blend", () => {
  it("names the neighbour on each side and its facing edge", () => {
    expect(neighbourOf({ x: 4, y: 4 }, "left")).toEqual({ x: 3, y: 4 });
    expect(neighbourOf({ x: 4, y: 4 }, "top")).toEqual({ x: 4, y: 3 });
    expect(neighbourOf({ x: 4, y: 4 }, "right")).toEqual({ x: 5, y: 4 });
    expect(neighbourOf({ x: 4, y: 4 }, "bottom")).toEqual({ x: 4, y: 5 });
    for (const s of SIDES) expect(OPPOSITE[OPPOSITE[s]]).toBe(s);
  });

  it("writes one invertible change to the neighbour cell and refuses the map edge", () => {
    const scn = createScenario({ width: 8, height: 6, era: 0, name: "t" });
    const changes = placeBlend(scn, { x: 2, y: 2 }, "right", 0x123)!;
    expect(changes).toEqual([{ at: 2 * 8 + 3, before: scn.tiles[2 * 8 + 3], after: 0x123 }]);
    applyChanges(scn, changes);
    expect(scn.tiles[2 * 8 + 3]).toBe(0x123);
    expect(scn.dirty.has("MTXM")).toBe(true);
    applyChanges(scn, changes, "undo");
    expect(scn.tiles[2 * 8 + 3]).toBe(changes[0].before);

    expect(placeBlend(scn, { x: 2, y: 2 }, "right", 0x123)!.length).toBe(1);
    expect(placeBlend(scn, { x: 2, y: 2 }, "right", scn.tiles[2 * 8 + 3])).toEqual([]); // already there
    expect(placeBlend(scn, { x: 0, y: 2 }, "left", 0x123)).toBeNull();
    expect(placeBlend(scn, { x: 2, y: 0 }, "top", 0x123)).toBeNull();
    expect(placeBlend(scn, { x: 7, y: 2 }, "right", 0x123)).toBeNull();
    expect(placeBlend(scn, { x: 2, y: 5 }, "bottom", 0x123)).toBeNull();
  });
});

/* Runs only where scripts/extract-tilesets.mjs has been run. */
const TILESET_DIR = join(import.meta.dirname, "..", "public", "tileset");
const installed = TILESET_FILENAMES.filter((n) => existsSync(join(TILESET_DIR, `${n}.cv5`)));

describe.skipIf(installed.length === 0)("installed tilesets (public/tileset)", () => {
  it("finds every terrain's own left/right seam and lists matches for it", () => {
    for (const name of installed) {
      const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `${name}.${ext}`)));
      const ts = loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") });
      const info = TILESETS[TILESET_FILENAMES.indexOf(name)];
      const edges = edgeTable(ts);
      expect(edges.count).toBe(ts.megatileCount);
      const uncapped = { ...DEFAULT_BLEND_OPTIONS, limit: Infinity };

      for (const t of terrainTypes(ts, info.terrain)) {
        expect(isFlatPair(ts, t.group)).toBe(true);
        const L = ts.groups[t.group].megatiles;
        const R = ts.groups[t.group + 1].megatiles;
        if (L[0] === 0 || R[0] === 0) continue; // Space Platform's "Space" is the void

        // The pair was drawn to tile, so some L variation's right edge continues into some R
        // variation's left edge. Earthy ground measures 0–9; the structural terrains are grid
        // art with a bevel line on the seam — Installation Substructure 14.6, Platform's
        // Elevated Catwalk 17.6, Ice Outpost 23.0.
        let best = Infinity;
        for (let a = 0; a < 16; a++) {
          for (let b = 0; b < 16; b++) {
            if (L[a] === 0 || R[b] === 0 || L[a] >= ts.megatileCount || R[b] >= ts.megatileCount) continue;
            best = Math.min(best, edgeDistance(edges, L[a], "right", R[b], "left"));
          }
        }
        expect(best, `${name} ${t.name}`).toBeLessThan(25);

        // When a slot-0 seam is within tolerance, the partner is in the (uncapped) list: R to the
        // right of L, L to the left of R (the same seam), and L to the right of R (the row wraps).
        const seam = edgeDistance(edges, L[0], "right", R[0], "left");
        const wrap = edgeDistance(edges, R[0], "right", L[0], "left");
        const lists = (id: number, side: Side) => blendCandidates(ts, id, side, uncapped).map((c) => c.megatile);
        if (seam <= DEFAULT_BLEND_OPTIONS.maxDistance) {
          expect(lists(t.group << 4, "right"), `${name} ${t.name} right`).toContain(R[0]);
          expect(lists((t.group + 1) << 4, "left"), `${name} ${t.name} left`).toContain(L[0]);
        }
        if (wrap <= DEFAULT_BLEND_OPTIONS.maxDistance) expect(lists((t.group + 1) << 4, "right"), `${name} ${t.name} wrap`).toContain(L[0]);

        // The default lists are sorted, within tolerance and capped, and at least one side has
        // something in it (Installation's Bottomless Pit rim has no partner on its left at all).
        let listed = 0;
        for (const side of SIDES) {
          const list = blendCandidates(ts, t.group << 4, side);
          listed += list.length;
          expect(list.length).toBeLessThanOrEqual(DEFAULT_BLEND_OPTIONS.limit);
          for (let i = 1; i < list.length; i++) expect(list[i].distance).toBeGreaterThanOrEqual(list[i - 1].distance);
          for (const c of list) expect(c.distance).toBeLessThanOrEqual(DEFAULT_BLEND_OPTIONS.maxDistance);
        }
        expect(listed, `${name} ${t.name} has matches`).toBeGreaterThan(0);
      }
    }
  });
});
