import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TILESET_FILENAMES } from "../src/formats/tileset/load";
import { TILESETS } from "../src/data/tilesets";
import { decodeCv5, GroupFlag, loadTileset, type Tileset } from "../src/formats/tileset/decode";
import { hexTile, isFlatPair, terrainTypes, tileGroups, tileInfo } from "../src/formats/tileset/palette";

/**
 * Groups 2/3: flat "Dirt" (index 2, buildable, low). Groups 4/5: flat "High Dirt"
 * (index 3, high ground). Group 6: an edge piece (index 20, mixed edges). Group 7: a
 * doodad (index 1). Group 8: index 0 but with a megatile, i.e. unlisted.
 */
function cv5(): Uint8Array {
  const data = new Uint8Array(9 * 52);
  const view = new DataView(data.buffer);
  const group = (g: number, index: number, flags: number, edges: number[], slots: number[]) => {
    const at = g * 52;
    view.setUint16(at, index, true);
    view.setUint16(at + 2, flags, true);
    edges.forEach((e, i) => view.setUint16(at + 4 + i * 2, e, true));
    slots.forEach((m, s) => view.setUint16(at + 20 + s * 2, m, true));
  };
  group(2, 2, GroupFlag.Walkable, [1, 1, 1, 1], [1, 2, 3]);
  group(3, 2, GroupFlag.Walkable, [1, 1, 1, 1], [4, 5, 6]);
  group(4, 3, GroupFlag.Walkable | GroupFlag.HighGround, [2, 2, 2, 2], [7]);
  group(5, 3, GroupFlag.Walkable | GroupFlag.HighGround, [2, 2, 2, 2], [8]);
  group(6, 20, GroupFlag.Unbuildable, [1, 1, 51, 51], [9, 0, 10]);
  group(7, 1, 0, [0, 0, 0, 0], [11]);
  group(8, 0, 0, [0, 0, 0, 0], [12]);
  return data;
}

function tileset(): Tileset {
  const flags = new Uint16Array(13 * 16);
  for (let i = 0; i < 16; i++) flags[9 * 16 + i] = i < 4 ? 1 : 0; // megatile 9: 4 walkable minitiles
  return { groups: decodeCv5(cv5()), megatileCount: 13, megatileFlags: flags } as Tileset;
}

const NAMES = [{ id: 3, name: "High Dirt" }, { id: 2, name: "Dirt" }, { id: 99, name: "Nowhere" }];

describe("terrain palette", () => {
  it("recognises flat pairs", () => {
    const ts = tileset();
    expect(isFlatPair(ts, 2)).toBe(true);
    expect(isFlatPair(ts, 4)).toBe(true);
    expect(isFlatPair(ts, 3)).toBe(false); // odd start
    expect(isFlatPair(ts, 6)).toBe(false); // edges differ
    expect(isFlatPair(ts, 0)).toBe(false);
  });

  it("lists terrain types in palette order, dropping names with no graphics", () => {
    const types = terrainTypes(tileset(), NAMES);
    expect(types.map((t) => [t.name, t.group, t.height, t.buildable])).toEqual([
      ["High Dirt", 4, 2, true],
      ["Dirt", 2, 0, true],
    ]);
    expect(terrainTypes(null, NAMES)).toEqual([]);
  });

  it("catalogues every drawable group with its kind", () => {
    const groups = tileGroups(tileset(), NAMES);
    expect(groups.map((g) => [g.group, g.kind, g.label, g.slots])).toEqual([
      [2, "terrain", "Dirt L", [0, 1, 2]],
      [3, "terrain", "Dirt R", [0, 1, 2]],
      [4, "terrain", "High Dirt L", [0]],
      [5, "terrain", "High Dirt R", [0]],
      [6, "edge", "Edge set 20", [0, 2]],
      [7, "doodad", "Doodad", [0]],
      [8, "other", "Unlisted", [0]],
    ]);
  });

  it("describes a tile id", () => {
    const ts = tileset();
    expect(tileInfo(ts, NAMES, 0x60)).toMatchObject({ group: 6, slot: 0, megatile: 9, kind: "edge", buildable: false, walkable: 4 });
    expect(tileInfo(ts, NAMES, 0x41)).toMatchObject({ kind: "terrain", label: "High Dirt", height: 2, megatile: -1, buildable: false });
    expect(tileInfo(ts, NAMES, 0xfff0)).toMatchObject({ kind: "other", megatile: -1 });
    expect(hexTile(0x2a)).toBe("0x002A");
  });
});

/* Runs only where scripts/extract-tilesets.mjs has been run. */
const TILESET_DIR = join(import.meta.dirname, "..", "public", "tileset");
const installed = TILESET_FILENAMES.filter((n) => existsSync(join(TILESET_DIR, `${n}.cv5`)));

describe.skipIf(installed.length === 0)("installed tilesets (public/tileset)", () => {
  it("has a flat pair for every terrain name, and a name for every flat pair", () => {
    for (const name of installed) {
      const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `${name}.${ext}`)));
      const ts = loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") });
      const info = TILESETS[TILESET_FILENAMES.indexOf(name)];

      const types = terrainTypes(ts, info.terrain);
      expect(types.map((t) => t.id), name).toEqual(info.terrain.map((t) => t.id));

      const pairs = new Set<number>();
      for (let g = 2; g + 1 < ts.groups.length; g += 2) if (isFlatPair(ts, g)) pairs.add(ts.groups[g].index);
      expect([...pairs].sort((a, b) => a - b), name).toEqual(info.terrain.map((t) => t.id).sort((a, b) => a - b));

      // Every listed terrain draws: slot 0 of its left group is a real megatile. The one
      // exception is Space Platform's "Space", which really is the void.
      for (const t of types) {
        if (name === "platform" && t.name === "Space") continue;
        expect(tileInfo(ts, info.terrain, t.group << 4).megatile, `${name} ${t.name}`).toBeGreaterThan(0);
      }
    }
  });
});
