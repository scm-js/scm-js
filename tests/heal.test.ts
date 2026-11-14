import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, tilesetIndex, type Scenario } from "../src/formats/chk/scenario";
import { loadMap } from "../src/formats/mpq/scm";
import { loadTileset, megatileForTile, tileGroupOf, type Tileset } from "../src/formats/tileset/decode";
import { TILESET_FILENAMES } from "../src/formats/tileset/load";
import { SEAM_SHOWS, seamStep } from "../src/editor/blend";
import { healTiles, shownSeams } from "../src/editor/heal";

/* ── A synthetic tileset ── */

const RED = 1, GREEN = 2, NEAR_RED = 3;

/**
 * Megatiles, all in group 2 (tile `0x20 + m - 1`) unless said:
 *   1 red, 2 green, 3 near-red,
 *   4 red with its last column of pixels green: red ground that ends on green,
 *   5 left half red, right half green: ends on green too, but is not red ground,
 *   6 (group 3, tile 0x30) the picture of 4 on a megatile a unit can walk.
 */
function synthetic(): Tileset {
  const palette = new Uint8Array(1024);
  const set = (i: number, r: number, g: number, b: number) => { palette[i * 4] = r; palette[i * 4 + 1] = g; palette[i * 4 + 2] = b; palette[i * 4 + 3] = 255; };
  set(RED, 255, 0, 0);
  set(GREEN, 0, 255, 0);
  set(NEAR_RED, 250, 4, 4);
  // minitiles: 0 unused, 1 red, 2 green, 3 near-red, 4 red with a green last column
  const minitiles = new Uint8Array(5 * 64);
  minitiles.fill(RED, 64, 128);
  minitiles.fill(GREEN, 128, 192);
  minitiles.fill(NEAR_RED, 192, 256);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) minitiles[256 + y * 8 + x] = x === 7 ? GREEN : RED;
  const count = 7;
  const vx4 = new Uint8Array(count * 32), vf4 = new Uint8Array(count * 32);
  const refs = new DataView(vx4.buffer), flags = new DataView(vf4.buffer);
  const paint = (m: number, mini: (col: number) => number) => { for (let i = 0; i < 16; i++) refs.setUint16((m * 16 + i) * 2, mini(i % 4) << 1, true); };
  paint(1, () => 1);
  paint(2, () => 2);
  paint(3, () => 3);
  paint(4, (c) => (c === 3 ? 4 : 1));
  paint(5, (c) => (c < 2 ? 1 : 2));
  paint(6, (c) => (c === 3 ? 4 : 1));
  for (let i = 0; i < 16; i++) flags.setUint16((6 * 16 + i) * 2, 1, true);
  const cv5 = new Uint8Array(4 * 52);
  const groups = new DataView(cv5.buffer);
  groups.setUint16(2 * 52, 2, true);
  for (let s = 0; s < 5; s++) groups.setUint16(2 * 52 + 20 + s * 2, s + 1, true);
  groups.setUint16(3 * 52, 3, true);
  groups.setUint16(3 * 52 + 20, 6, true);
  return loadTileset({ cv5, vf4, vr4: minitiles, vx4, wpe: palette });
}

const ts = synthetic();
const [R, G, NR, R_TO_G, HALF, WALKABLE] = [0x20, 0x21, 0x22, 0x23, 0x24, 0x30];

function map(width: number, tiles: number[]): Scenario {
  const scn = createScenario({ name: "t", description: "", width, height: tiles.length / width, era: 0, tiles: Uint16Array.from(tiles) });
  scn.dirty.clear();
  return scn;
}
const all = (scn: Scenario) => Array.from({ length: scn.width * scn.height }, (_, i) => i);

describe("the Heal brush", () => {
  it("lays the tile that joins, where the tileset has one that is the same to the game and the same ground", () => {
    // Red, red, green: the middle red ends on a green tile, and red-ending-on-green is in the tileset.
    const scn = map(3, [R, R, G]);
    expect(shownSeams(scn, ts, all(scn))).toBe(1);
    expect(healTiles(scn, ts, all(scn))).toEqual([{ at: 1, before: R, after: R_TO_G }]);
  });

  it("does not take a tile that plays differently, or one that is another kind of ground", () => {
    // Half red and half green ends on green as well, and its mean colour is nowhere near red.
    // The walkable copy of the right picture is in another group and walks: neither is offered.
    const scn = map(3, [R, R, G]);
    const changes = healTiles(scn, ts, all(scn));
    expect(changes.map((c) => c.after)).not.toContain(HALF);
    expect(changes.map((c) => c.after)).not.toContain(WALKABLE);
    // With the walkable one on the map there is no tile of its kind to trade it for.
    const walked = map(3, [R, WALKABLE, R]);
    expect(healTiles(walked, ts, all(walked))).toEqual([]);
  });

  it("leaves ground that joins as it was laid", () => {
    const scn = map(4, [R, NR, R, NR]);
    expect(shownSeams(scn, ts, all(scn))).toBe(0);
    expect(healTiles(scn, ts, all(scn))).toEqual([]);
  });

  it("heals only the cells it is given, against the ones beside them", () => {
    const scn = map(6, [R, R, G, R, R, G]);
    expect(healTiles(scn, ts, [1])).toEqual([{ at: 1, before: R, after: R_TO_G }]);
    expect(healTiles(scn, ts, [0, 3])).toEqual([]);
    expect(healTiles(scn, ts, all(scn)).map((c) => c.at)).toEqual([1, 4]);
  });

  it("leaves a placed doodad's tiles alone", () => {
    const scn = map(3, [R, R, G]);
    // The picture differs from the ground kept under it: a doodad stands on cell 1.
    scn.editorTiles[1] = NR;
    expect(healTiles(scn, ts, all(scn))).toEqual([]);
  });

  it("counts a join once, and only joins on the cells asked about", () => {
    const scn = map(3, [G, R, G]);
    expect(shownSeams(scn, ts, all(scn))).toBe(2);
    expect(shownSeams(scn, ts, [0])).toBe(1);
    expect(shownSeams(scn, ts, [1])).toBe(2);
  });
});

/* ── The game's maps, where they are present ── */

const TILESET_DIR = join(import.meta.dirname, "..", "public", "tileset");
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "maps");
const maps = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => /\.sc[mx]$/i.test(f)) : [];
const have = maps.length > 0 && TILESET_FILENAMES.every((n) => existsSync(join(TILESET_DIR, `${n}.cv5`)));

describe.skipIf(!have)("healing the game's own maps", () => {
  const tilesets = new Map<number, Tileset>();
  const tilesetOf = (era: number) => {
    let tileset = tilesets.get(era);
    if (!tileset) {
      const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `${TILESET_FILENAMES[era]}.${ext}`)));
      tileset = loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") });
      tilesets.set(era, tileset);
    }
    return tileset;
  };

  it("changes nothing the game could notice, touches little, and leaves fewer joins showing", async () => {
    for (const file of maps) {
      const scn = parseScenario((await loadMap(new Uint8Array(readFileSync(join(FIXTURES, file))))).chk);
      const tileset = tilesetOf(tilesetIndex(scn));
      const cells = all(scn);
      const before = shownSeams(scn, tileset, cells);
      const changes = healTiles(scn, tileset, cells);
      for (const c of changes) {
        // The same flags, minitile for minitile, in a group with the same flag word.
        const a = megatileForTile(tileset, c.before) * 16, b = megatileForTile(tileset, c.after) * 16;
        for (let m = 0; m < 16; m++) expect(tileset.megatileFlags[b + m], `${file} tile ${c.at}`).toBe(tileset.megatileFlags[a + m]);
        expect(tileset.groups[tileGroupOf(c.after, tileset.groups.length)].flags, `${file} tile ${c.at}`).toBe(tileset.groups[tileGroupOf(c.before, tileset.groups.length)].flags);
        // Not under a doodad.
        expect(scn.tiles[c.at], `${file} tile ${c.at}`).toBe(scn.editorTiles[c.at]);
        scn.tiles[c.at] = c.after;
      }
      expect(changes.length / cells.length, file).toBeLessThan(0.05);
      const after = shownSeams(scn, tileset, cells);
      expect(after, file).toBeLessThanOrEqual(before);
      // A second pass finds little left to do: what could be mended was.
      expect(healTiles(scn, tileset, cells).length, file).toBeLessThanOrEqual(changes.length / 4 + 2);
    }
  }, 60_000);

  it("draws no line where it laid a tile that was not there before", async () => {
    const file = maps[0];
    const scn = parseScenario((await loadMap(new Uint8Array(readFileSync(join(FIXTURES, file))))).chk);
    const tileset = tilesetOf(tilesetIndex(scn));
    const steps = (at: number) => {
      const x = at % scn.width, y = (at / scn.width) | 0;
      let lines = 0;
      for (const [side, dx, dy] of [["left", -1, 0], ["top", 0, -1], ["right", 1, 0], ["bottom", 0, 1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= scn.width || ny >= scn.height) continue;
        const a = megatileForTile(tileset, scn.tiles[at]), b = megatileForTile(tileset, scn.tiles[ny * scn.width + nx]);
        if (a > 0 && b > 0 && seamStep(tileset, a, side, b) > SEAM_SHOWS) lines++;
      }
      return lines;
    };
    const cells = all(scn);
    const before = new Map(cells.map((at) => [at, steps(at)]));
    const changes = healTiles(scn, tileset, cells);
    for (const c of changes) scn.tiles[c.at] = c.after;
    // Every tile it changed has no more lines around it than it had.
    for (const c of changes) expect(steps(c.at), `tile ${c.at}`).toBeLessThanOrEqual(before.get(c.at)!);
  });
});
