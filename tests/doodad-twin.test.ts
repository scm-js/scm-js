import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadTileset, megatileForTile, type Tileset } from "../src/formats/tileset/decode";
import { buildDoodadCatalogue, type DoodadCatalogue, type DoodadDef } from "../src/formats/tileset/doodads";
import { TILESET_FILENAMES } from "../src/formats/tileset/load";
import { decodeTbl } from "../src/formats/dat/tbl";
import { doodadTwin, mirroredDoodad, mirrorsAcross, TWIN_PICTURE } from "../src/editor/doodadTwin";
import { isStretched, soundAxes, stretchDoodad } from "../src/editor/stretch";

/* ── A synthetic tileset: a half-and-half tile and its mirror image ── */

const RED = 1, GREEN = 2;

/**
 * Megatiles, all in group 2 (tile `0x20 + m - 1`):
 *   1 every minitile red on its left half and green on its right; its two left columns walk,
 *   2 the same minitile flipped, its two right columns walking: megatile 1 in a mirror,
 *   3 red, 4 green,
 *   5 the picture of megatile 2 with nothing walking: megatile 1's picture mirrored, not its flags.
 */
function synthetic(): Tileset {
  const palette = new Uint8Array(1024);
  palette.set([255, 0, 0, 255], RED * 4);
  palette.set([0, 255, 0, 255], GREEN * 4);
  // minitiles: 0 unused, 1 red | green, 2 red, 3 green
  const minitiles = new Uint8Array(4 * 64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) minitiles[64 + y * 8 + x] = x < 4 ? RED : GREEN;
  minitiles.fill(RED, 128, 192);
  minitiles.fill(GREEN, 192, 256);
  const count = 6;
  const vx4 = new Uint8Array(count * 32), vf4 = new Uint8Array(count * 32);
  const refs = new DataView(vx4.buffer), flags = new DataView(vf4.buffer);
  const paint = (m: number, ref: number, walks: (col: number) => boolean) => {
    for (let i = 0; i < 16; i++) {
      refs.setUint16((m * 16 + i) * 2, ref, true);
      flags.setUint16((m * 16 + i) * 2, walks(i % 4) ? 1 : 0, true);
    }
  };
  paint(1, 1 << 1, (c) => c < 2);
  paint(2, (1 << 1) | 1, (c) => c >= 2);
  paint(3, 2 << 1, () => false);
  paint(4, 3 << 1, () => true);
  paint(5, (1 << 1) | 1, () => false);
  const cv5 = new Uint8Array(3 * 52);
  const groups = new DataView(cv5.buffer);
  groups.setUint16(2 * 52, 2, true);
  for (let s = 0; s < 5; s++) groups.setUint16(2 * 52 + 20 + s * 2, s + 1, true);
  return loadTileset({ cv5, vf4, vr4: minitiles, vx4, wpe: palette });
}

const ts = synthetic();
const [HALF, FLIPPED, R, G, FLIPPED_WALL] = [0x20, 0x21, 0x22, 0x23, 0x24];
const def = (id: number, tiles: number[], required: number[], category = "Cliff"): DoodadDef =>
  ({ id, group: 0, width: 2, height: 1, category, flags: 0, overlay: null, tiles: Uint16Array.from(tiles), required: Uint16Array.from(required), ramp: false });
const catalogueOf = (doodads: DoodadDef[]): DoodadCatalogue => ({ doodads, byId: new Map(doodads.map((d) => [d.id, d])), categories: [], hasPlacementData: true });

const left = def(1, [HALF, R], [7, 8]);
const right = def(2, [R, FLIPPED], [9, 10]);
const lookalike = def(3, [R, FLIPPED_WALL], [9, 10]);
const symmetric = def(4, [G, G], [5, 5]);
const cat = catalogueOf([left, lookalike, right, symmetric]);

describe("a doodad's twin", () => {
  it("is the doodad whose tiles are its own in a mirror, pictures and flags both", () => {
    expect(doodadTwin(ts, cat, left)).toBe(right);
    expect(doodadTwin(ts, cat, right)).toBe(left);
  });

  it("is not a doodad that only looks the part", () => {
    // The mirrored picture, with nothing walking where the mirrored flags walk.
    expect(doodadTwin(ts, catalogueOf([left, lookalike]), left)).toBeNull();
    expect(doodadTwin(ts, cat, lookalike)).toBeNull();
  });

  it("is itself for a doodad that is its own mirror image", () => {
    expect(doodadTwin(ts, cat, symmetric)).toBe(symmetric);
  });

  it("is the one filed under the same category when two would do", () => {
    const elsewhere = { ...right, id: 9, category: "Wall" };
    expect(doodadTwin(ts, catalogueOf([left, elsewhere, right]), left)).toBe(right);
    expect(doodadTwin(ts, catalogueOf([left, right, elsewhere]), left)).toBe(right);
  });

  it("stands in for the doodad across a left-right mirror, and nowhere else", () => {
    expect(mirrorsAcross("h", 1)).toBe(true);
    expect(mirrorsAcross("hv", 1)).toBe(true);
    expect(mirrorsAcross("hv", 2)).toBe(false);
    expect(mirrorsAcross("hv", 3)).toBe(false);
    expect(mirrorsAcross("v", 1)).toBe(false);
    expect(mirrorsAcross("rot180", 1)).toBe(false);
    expect(mirrorsAcross("h", 0)).toBe(false);
  });
});

describe("a stretched doodad in the mirror", () => {
  it("is its twin stretched the same, cell for mirrored cell, on the twin's ground", () => {
    const long = stretchDoodad(ts, left, "e", 1);
    expect([...long.tiles]).toEqual([HALF, R, HALF, R]);
    const image = mirroredDoodad(ts, cat, long)!;
    expect(image.id).toBe(right.id);
    expect([image.width, image.height]).toEqual([4, 1]);
    expect([...image.tiles]).toEqual([R, FLIPPED, R, FLIPPED]);
    expect([...image.required]).toEqual([9, 10, 9, 10]);
    // The twin as shipped stands at the far end of the footprint, where the doodad as shipped stands at the near one.
    expect(isStretched(image) && image.stretched.from).toBe(right);
    expect(isStretched(image) && image.stretched.offset).toEqual({ x: -2, y: 0 });
  });

  it("is the twin itself for a doodad that is not stretched, and nothing for one with no twin", () => {
    expect(mirroredDoodad(ts, cat, left)).toBe(right);
    expect(mirroredDoodad(ts, cat, stretchDoodad(ts, lookalike, "e", 1))).toBeNull();
  });
});

/* ── The game's tilesets, where they are installed ── */

const TILESET_DIR = join(import.meta.dirname, "..", "public", "tileset");
const installed = TILESET_FILENAMES.filter((n) => existsSync(join(TILESET_DIR, `${n}.cv5`)) && existsSync(join(TILESET_DIR, `${n}.dddata.bin`)));
const haveNames = existsSync(join(TILESET_DIR, "stat_txt.tbl"));

function real(name: string) {
  const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `${name}.${ext}`)));
  const tileset = loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") });
  return { tileset, catalogue: buildDoodadCatalogue(tileset, part("dddata.bin"), haveNames ? decodeTbl(new Uint8Array(readFileSync(join(TILESET_DIR, "stat_txt.tbl")))) : null) };
}

describe.skipIf(installed.length === 0)("the game's doodads and their twins", () => {
  it("pairs every ramp with the ramp for the cliff that runs the other way", () => {
    for (const name of installed) {
      const { tileset, catalogue } = real(name);
      for (const ramp of catalogue.doodads.filter((d) => d.ramp)) {
        const twin = doodadTwin(tileset, catalogue, ramp);
        expect(twin, `${name} #${ramp.id}`).not.toBeNull();
        expect(twin!.id, `${name} #${ramp.id}`).not.toBe(ramp.id);
        expect(twin!.ramp, `${name} #${ramp.id}`).toBe(true);
        // And back again.
        expect(doodadTwin(tileset, catalogue, twin!)?.id, `${name} #${ramp.id}`).toBe(ramp.id);
        if (haveNames) expect(twin!.category, `${name} #${ramp.id}`).toBe(ramp.category);
      }
    }
  });

  it.skipIf(!haveNames)("pairs every bridge with the bridge that runs the other way", () => {
    for (const name of installed) {
      const { tileset, catalogue } = real(name);
      for (const bridge of catalogue.doodads.filter((d) => d.category === "Bridges")) {
        const twin = doodadTwin(tileset, catalogue, bridge);
        expect(twin?.category, `${name} #${bridge.id}`).toBe("Bridges");
        expect(doodadTwin(tileset, catalogue, twin!)?.id, `${name} #${bridge.id}`).toBe(bridge.id);
      }
    }
  });

  it("mirrors a stretched ramp tile for tile: each cell is the far cell's picture in a mirror", () => {
    for (const name of installed) {
      const { tileset, catalogue } = real(name);
      const pixelAt = (megatile: number, x: number, y: number) => {
        const ref = tileset.megatileRefs[megatile * 16 + (y >> 3) * 4 + (x >> 3)];
        return tileset.minitiles[(ref >>> 1) * 64 + (y & 7) * 8 + (ref & 1 ? 7 - (x & 7) : x & 7)] * 4;
      };
      for (const ramp of catalogue.doodads.filter((d) => d.ramp)) {
        const [axis] = soundAxes(tileset, ramp);
        if (!axis) continue;
        const long = stretchDoodad(tileset, ramp, axis, 3);
        const image = mirroredDoodad(tileset, catalogue, long)!;
        expect([image.width, image.height], `${name} #${ramp.id}`).toEqual([long.width, long.height]);
        let sum = 0, cells = 0;
        for (let r = 0; r < long.height; r++) {
          for (let c = 0; c < long.width; c++) {
            const a = long.tiles[r * long.width + c], b = image.tiles[r * long.width + long.width - 1 - c];
            expect(a === 0, `${name} #${ramp.id}`).toBe(b === 0);
            if (!a) continue;
            const ma = megatileForTile(tileset, a), mb = megatileForTile(tileset, b);
            for (let y = 0; y < 32; y += 3) {
              for (let x = 0; x < 32; x += 3) {
                const p = pixelAt(ma, x, y), q = pixelAt(mb, 31 - x, y);
                sum += (Math.abs(tileset.palette[p] - tileset.palette[q]) + Math.abs(tileset.palette[p + 1] - tileset.palette[q + 1]) + Math.abs(tileset.palette[p + 2] - tileset.palette[q + 2])) / 3;
                cells++;
              }
            }
          }
        }
        expect(sum / cells, `${name} #${ramp.id}`).toBeLessThan(TWIN_PICTURE);
      }
    }
  });
});
