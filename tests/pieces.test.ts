import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cutPieces, decodeEvidence, emptyEvidence, encodeEvidence, gatherEvidence, mergeEvidence, pieceBlock, pieceIndex } from "../src/editor/pieces";
import { openMapBytes } from "../src/editor/mapFile";
import { decodeCv5, type Cv5Group } from "../src/formats/tileset/decode";
import { mapFiles } from "./support/maps";

/** A sheet of `count` groups, every slot with a picture; `doodads` are doodad groups. */
function sheet(count: number, doodads: number[] = [], empty: number[] = []): { groups: Cv5Group[] } {
  const groups = Array.from({ length: count }, (_, g) => ({
    index: doodads.includes(g) ? 1 : 0,
    megatiles: Uint16Array.from({ length: 16 }, (_, s) => (empty.includes((g << 4) | s) ? 0 : g * 16 + s + 1)),
  })) as unknown as Cv5Group[];
  return { groups };
}
const id = (group: number, slot: number) => (group << 4) | slot;

/** A map of `w` × `h` filled with `fill`, then `put` at cells. */
function map(w: number, h: number, fill: number, put: [x: number, y: number, tile: number][]): Uint16Array {
  const tiles = new Uint16Array(w * h).fill(fill);
  for (const [x, y, tile] of put) tiles[y * w + x] = tile;
  return tiles;
}
/** A 2 × 2 picture: groups `g` and `g + 1`, slots `s` and `s + 1`, with its corner at (x, y). */
const picture = (x: number, y: number, g: number, s: number): [number, number, number][] => [
  [x, y, id(g, s)], [x + 1, y, id(g, s + 1)], [x, y + 1, id(g + 1, s)], [x + 1, y + 1, id(g + 1, s + 1)],
];

describe("pieces", () => {
  const ts = sheet(12);

  it("cuts a picture laid whole, and leaves loose ground out", () => {
    const tiles = map(10, 6, id(0, 0), [...picture(1, 1, 4, 2), ...picture(6, 3, 4, 2)]);
    const pieces = cutPieces(gatherEvidence(emptyEvidence(), tiles, 10, 6, ts));
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ tiles: [id(4, 2), id(4, 3), id(5, 2), id(5, 3)], slot: 2, group: 4, cols: 2, rows: 2, laid: 8 });
  });

  it("keeps a piece laid once: its tiles are nowhere else", () => {
    const tiles = map(8, 4, id(0, 0), picture(2, 1, 6, 0));
    expect(cutPieces(gatherEvidence(emptyEvidence(), tiles, 8, 4, ts))).toHaveLength(1);
  });

  it("does not join ground whose tiles meet their sheet neighbour by chance", () => {
    // Sixteen variations of one group laid in an order that puts slot 3 beside slot 4 once in eight.
    const order = [3, 4, 9, 3, 1, 4, 7, 3, 12, 4, 0, 3, 15, 4, 6, 3, 2, 4, 11, 3, 5, 4, 8, 3, 10, 4, 13, 3, 14, 4, 6, 3];
    const tiles = Uint16Array.from(order, (s) => id(2, s));
    expect(cutPieces(gatherEvidence(emptyEvidence(), tiles, order.length, 1, ts))).toEqual([]);
  });

  it("counts a piece laid cut short toward the whole piece", () => {
    const whole = picture(0, 0, 4, 2);
    const cut: [number, number, number][] = [[5, 0, id(4, 2)], [6, 0, id(4, 3)]];
    const tiles = map(8, 3, id(0, 0), [...whole, ...picture(0, 0, 4, 2).map(([x, y, t]) => [x + 2, y, t] as [number, number, number]), ...cut]);
    const pieces = cutPieces(gatherEvidence(emptyEvidence(), tiles, 8, 3, ts));
    expect(pieces).toHaveLength(1);
    expect(pieces[0].tiles).toHaveLength(4);
  });

  it("does not run a row's last slot into the next group's first", () => {
    const tiles = map(4, 1, id(0, 0), [[1, 0, id(3, 15)], [2, 0, id(4, 0)]]);
    expect(cutPieces(gatherEvidence(emptyEvidence(), tiles, 4, 1, ts))).toEqual([]);
  });

  it("leaves doodad groups and slots without a picture out", () => {
    const withDoodad = sheet(12, [4, 5], [id(8, 1)]);
    const tiles = map(8, 4, id(0, 0), [...picture(1, 1, 4, 2), [5, 0, id(8, 0)], [6, 0, id(8, 1)]]);
    expect(cutPieces(gatherEvidence(emptyEvidence(), tiles, 8, 4, withDoodad))).toEqual([]);
  });

  it("reads a tile's group as the tileset's size says: bit 15 is the creep flag on a short table", () => {
    const tiles = map(6, 2, id(0, 0), picture(1, 0, 4, 2).map(([x, y, t]) => [x, y, t | 0x8000]));
    const pieces = cutPieces(gatherEvidence(emptyEvidence(), tiles, 6, 2, ts));
    expect(pieces[0]?.tiles).toEqual([id(4, 2), id(4, 3), id(5, 2), id(5, 3)]);
  });

  it("makes an L-shaped piece a block with a hole", () => {
    const tiles = map(6, 3, id(0, 0), [[1, 0, id(4, 2)], [2, 0, id(4, 3)], [1, 1, id(5, 2)]]);
    const [piece] = cutPieces(gatherEvidence(emptyEvidence(), tiles, 6, 3, ts));
    expect(pieceBlock(piece)).toEqual({ cols: 2, rows: 2, ids: [id(4, 2), id(4, 3), id(5, 2), -1], origin: { group: 4, slot: 2 } });
    expect(pieceIndex([piece]).get(id(5, 2))).toBe(piece);
  });

  it("adds two maps' evidence, and keeps it through its stored form", () => {
    const a = gatherEvidence(emptyEvidence(), map(8, 4, id(0, 0), picture(2, 1, 6, 0)), 8, 4, ts);
    const b = gatherEvidence(emptyEvidence(), map(8, 4, id(0, 1), picture(3, 2, 6, 0)), 8, 4, ts);
    const both = mergeEvidence(a, b);
    expect(both.maps).toBe(2);
    expect(cutPieces(both)[0].laid).toBe(8);
    const back = decodeEvidence(encodeEvidence(both));
    expect(back && cutPieces(back)).toEqual(cutPieces(both));
    expect(decodeEvidence([1, 5])).toBeNull();
    expect(decodeEvidence([1, 5, 1, -1, -1])).toBeNull();
  });
});

/**
 * Ground the game's brushes lay is never a run of the sheet: neighbouring columns take the
 * left and the right group of a pair, so no two neighbours share a group. With the game's
 * own tables every committed and fixture map must come out with no piece at all.
 */
const tilesetDir = join(import.meta.dirname, "..", "public", "tileset");
const NAMES = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"];
const haveTilesets = NAMES.every((n) => existsSync(join(tilesetDir, `${n}.cv5`)));

describe.skipIf(!haveTilesets)("pieces on maps laid with the game's brushes", () => {
  it("finds none", async () => {
    const groups = new Map(NAMES.map((n) => [n, decodeCv5(new Uint8Array(readFileSync(join(tilesetDir, `${n}.cv5`))))]));
    let seen = 0;
    for (const file of mapFiles()) {
      const { scenario } = await openMapBytes(new Uint8Array(readFileSync(file.path)), file.name);
      if (!scenario.tiles?.length) continue;
      const tileset = { groups: groups.get(NAMES[scenario.era & 7])! };
      const pieces = cutPieces(gatherEvidence(emptyEvidence(), scenario.tiles, scenario.width, scenario.height, tileset));
      expect(pieces, file.name).toEqual([]);
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });
});

/** A mod's own maps against its tilesets: `SCMJS_COSMONARCHY` (the release folder) and `SCMJS_COSMONARCHY_MAPS`. */
const modRoot = process.env.SCMJS_COSMONARCHY ?? "";
const modMaps = process.env.SCMJS_COSMONARCHY_MAPS ?? "";
const haveMod = modRoot !== "" && modMaps !== "" && existsSync(join(modRoot, "mpq/tileset")) && existsSync(modMaps);

describe.skipIf(!haveMod)("pieces a mod's maps lay", () => {
  it("cuts the mod's Badlands into pieces that cover most of what its maps lay", async () => {
    const dir = join(modRoot, "mpq/tileset");
    const cv5 = readdirSync(dir).find((f) => f.toLowerCase() === "badlands.cv5")!;
    const tileset = { groups: decodeCv5(new Uint8Array(readFileSync(join(dir, cv5)))) };
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.sc[xm]$/i.test(f)) files.push(p);
      }
    };
    walk(modMaps);
    const evidence = emptyEvidence();
    for (const file of files) {
      const { scenario } = await openMapBytes(new Uint8Array(readFileSync(file)), file);
      if ((scenario.era & 7) !== 0) continue;
      gatherEvidence(evidence, scenario.tiles, scenario.width, scenario.height, tileset);
    }
    const pieces = cutPieces(evidence);
    // Measured 2026-11-13 on 57 maps: 3,525 pieces, the largest 92 tiles; no piece may be a
    // blob of the sheet, which is what a rule that joined loose ground would give.
    expect(evidence.maps).toBeGreaterThan(20);
    expect(pieces.length).toBeGreaterThan(1000);
    expect(Math.max(...pieces.map((p) => p.tiles.length))).toBeLessThan(400);
  }, 120_000);
});
