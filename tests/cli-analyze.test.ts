/**
 * `scmjs map analyze` (cli/src/analyze.ts, walk.ts) and the walking speed it times the walks with
 * (src/formats/dat/speed.ts): the grid, the walk and the narrowest point on made-up grids, the bases, the fairness
 * numbers and the verdicts' thresholds, a whole map laid out with a made-up tileset (a wall with a gap), the command over
 * a stand-in 1.16.1 copy built here, and the committed melee map. Nothing needs the game's files, so all of it runs on CI.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Creator } from "mopaq";
import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import type { Scenario } from "../src/formats/chk/scenario";
import { loadTileset, type Tileset } from "../src/formats/tileset/decode";
import { walkSpeed, type SpeedTables } from "../src/formats/dat/speed";
import { makeUnit } from "../src/editor/units";
import { openMapBytes } from "../src/editor/mapFile";
import { START_LOCATION } from "../src/data/units";
import type { Input } from "../cli/src/files";
import {
  analyzeLayout, analyzeMap, apartFrom, blockers, CHOKE_NARROW, clusterResources, layoutPicture, medianOf, NATURAL_TILES, rankSpread, sideOf,
  spreadOf, verdictsOf, type Layout, type Resource, type StartLayout,
} from "../cli/src/analyze";
import {
  clearance, distancesFrom, distancesWithin, groundFromTiles, narrowestOn, nearestCell, openCells, passableCells, passageWidth, pathTo,
  stepsToPx, withoutSpecks,
} from "../cli/src/walk";
import { CliError, visible } from "../cli/src/ui";
import { testMap } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-analyze-"));

/** A grid of cells from rows of `.` (open) and `#` (wall). */
function grid(rows: string[]): { open: Uint8Array; w: number; h: number } {
  const h = rows.length, w = rows[0].length;
  const open = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => { open[y * w + x] = c === "#" ? 0 : 1; }));
  return { open, w, h };
}

/** A `w × h` open grid with a wall down column `wallX`, open only at rows `gap[0]` to `gap[1]`. */
function wallWithGap(w: number, h: number, wallX: number, gap: [number, number]): { open: Uint8Array; w: number; h: number } {
  const open = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < h; y++) if (y < gap[0] || y > gap[1]) open[y * w + wallX] = 0;
  return { open, w, h };
}

describe("the walk", () => {
  it("is octile: straight steps 5, diagonal 7, a distance of 5 a cell", () => {
    const { open, w, h } = grid(Array.from({ length: 12 }, () => ".".repeat(12)));
    const d = distancesFrom(open, w, h, 0);
    expect(d[10]).toBe(50); // ten cells along
    expect(d[5 * w + 10]).toBe(5 * 7 + 5 * 5); // five diagonal steps, five straight
    expect(stepsToPx(50)).toBe(80);
  });

  it("goes round a wall through its gap, and never cuts a wall's corner", () => {
    const g = wallWithGap(40, 40, 20, [30, 33]);
    const from = 5 * 40 + 5, to = 5 * 40 + 35;
    const d = distancesFrom(g.open, g.w, g.h, from);
    const path = pathTo(d, g.open, g.w, g.h, to);
    expect(path[0]).toBe(from);
    expect(path.at(-1)).toBe(to);
    // Every step is to a neighbour, and the walk crosses the wall's column only in the gap.
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]];
      expect(Math.max(Math.abs((a % 40) - (b % 40)), Math.abs(Math.floor(a / 40) - Math.floor(b / 40)))).toBe(1);
    }
    const crossing = path.filter((c) => c % 40 === 20).map((c) => Math.floor(c / 40));
    expect(crossing.every((y) => y >= 30 && y <= 33)).toBe(true);
    expect(d[to]).toBeGreaterThan(30 * 5); // a detour: far more than the 30 cells straight across
    // A diagonal step past a wall's corner is refused: (0,0) → (1,1) with (1,0) and (0,1) walls.
    const corner = grid([".#", "#."]);
    expect(distancesFrom(corner.open, 2, 2, 0)[3]).toBe(-1);
  });

  it("finds the narrowest point of a walk: the gap, with its width", () => {
    const g = wallWithGap(40, 40, 20, [30, 33]);
    const d = distancesFrom(g.open, g.w, g.h, 5 * 40 + 5);
    const path = pathTo(d, g.open, g.w, g.h, 5 * 40 + 35);
    const n = narrowestOn(path, g.open, g.w, g.h, 4)!;
    expect(n.cell % 40).toBe(20);
    expect(n.width).toBe(4);
    expect(passageWidth(g.open, g.w, g.h, 20, 31)).toBe(4);
    expect(passageWidth(g.open, g.w, g.h, 20, 10)).toBe(0); // a wall cell
  });

  it("measures clearance from the walls and the map's edge, and keeps a small unit a cell off them", () => {
    const g = wallWithGap(9, 9, 4, [4, 4]);
    const c = clearance(g.open, 9, 9);
    expect(c[2 * 9 + 3]).toBe(1); // beside the wall
    expect(c[4 * 9 + 3]).toBeCloseTo(Math.SQRT2); // in front of the gap: the wall is diagonally beside
    expect(c[0]).toBe(1); // the corner: the edge counts
    expect(c[2 * 9 + 2]).toBe(2);
    const passable = passableCells(c);
    expect(passable[4 * 9 + 4]).toBe(0); // the one-cell gap is too narrow for the unit
    expect(passable[2 * 9 + 2]).toBe(1);
  });

  it("opens small patches of wall standing alone, not the map's edge or a big one", () => {
    const g = grid([
      "##........",
      "..........",
      "....#.....",
      "..........",
      "......####",
      "......####",
      "......####",
      "..........",
    ]);
    const out = withoutSpecks(g.open, g.w, g.h, 4);
    expect(out[2 * 10 + 4]).toBe(1); // the speck
    expect(out[0]).toBe(0); // touches the edge
    expect(out[5 * 10 + 7]).toBe(0); // 12 cells
  });

  it("finds the nearest walkable cell, and walks a short way as the whole walk does", () => {
    const g = wallWithGap(20, 20, 10, [3, 5]);
    expect(nearestCell(g.open, 20, 20, 10, 12)).toBe(12 * 20 + 9);
    const full = distancesFrom(g.open, 20, 20, 0);
    const near = distancesWithin(g.open, 20, 20, 0, 60);
    for (const [cell, d] of near) expect(full[cell]).toBe(d);
    expect([...near.values()].every((d) => d <= 60)).toBe(true);
  });

  it("builds the ground from the tiles' minitile flags", () => {
    const g = groundFromTiles(2, 1, [0, 1], (id) => (id === 0 ? new Array(16).fill(0x0001 | 0x0004) : null));
    expect([g.w, g.h]).toEqual([8, 4]);
    expect(g.walkable[0]).toBe(1);
    expect(g.level[0]).toBe(2);
    expect(g.walkable[4]).toBe(0); // the tile with no picture is a wall
    expect(openCells(g)[0]).toBe(1);
  });
});

describe("the numbers", () => {
  it("spreads, medians and the starts set apart", () => {
    expect(spreadOf([100, 110])).toBeCloseTo(0.1);
    expect(spreadOf([100])).toBeNull();
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
    // Two values: the larger against the smaller, once.
    expect(apartFrom([30, 36], 5)).toEqual([{ index: 1, by: 6, against: 30, other: 0 }]);
    expect(apartFrom([30, 34], 5)).toEqual([]);
    // More: each against the median.
    expect(apartFrom([30, 31, 32, 40], 5)).toEqual([{ index: 3, by: 8.5, against: 31.5, other: null }]);
  });

  it("compares starts' walks rank by rank: a square of four is fair however far the corners", () => {
    const square = [[null, 100, 141, 100], [100, null, 100, 141], [141, 100, null, 100], [100, 141, 100, null]];
    expect(rankSpread(square)).toMatchObject({ spread: 0 });
    const skewed = [[null, 100, 141, 100], [100, null, 100, 141], [141, 100, null, 120], [100, 141, 120, null]];
    expect(rankSpread(skewed)).toMatchObject({ rank: 2, spread: expect.closeTo(0.2) });
    expect(rankSpread([[null, 1], [1, null]])).toBeNull();
    expect(rankSpread([[null, 1, null], [1, null, 1], [null, 1, null]])).toBeNull(); // a start cut off
  });

  it("names where a start is", () => {
    expect(sideOf(5, 5, 128, 128)).toBe("top left");
    expect(sideOf(64, 120, 128, 128)).toBe("bottom");
    expect(sideOf(64, 64, 128, 128)).toBe("middle");
    expect(sideOf(120, 64, 128, 128)).toBe("right");
  });

  it("groups resources into bases: lines and their geyser, walls left out, two bases kept apart when the ground says so", () => {
    const at = (kind: Resource["kind"], tx: number, ty: number, amount = kind === "mineral" ? 1500 : 5000): Resource => ({ kind, x: tx * 32, y: ty * 32, amount });
    const main = [0, 1, 2, 3, 4, 5].map((k) => at("mineral", 2, 2 + k));
    const nat = [0, 1, 2, 3].map((k) => at("mineral", 40, 30 + k));
    const wall = [0, 1, 2].map((k) => at("mineral", 70, 70 + k, 8));
    const all = [...main, at("geyser", 10, 2), ...nat, at("geyser", 30, 60), ...wall, at("mineral", 90, 90)];
    const bases = clusterResources(all);
    expect(bases.map((b) => [b.filter((r) => r.kind === "mineral").length, b.filter((r) => r.kind === "geyser").length])).toEqual([[6, 1], [4, 0], [0, 1]]);
    // The main's line and its geyser 8 tiles off stay one base unless the ground between says otherwise.
    const apart = clusterResources(all, (a, b) => !(all[a].kind === "geyser" || all[b].kind === "geyser") || all[a].x > 2000 || all[b].x > 2000);
    expect(apart.map((b) => b.length).sort((a, b) => b - a)).toEqual([6, 4, 1, 1]);
  });

  it("puts buildings and resources in the way, not units or a pure sprite", () => {
    const scn = createScenario({ width: 32, height: 32, era: 4, name: "t" });
    scn.units.push(makeUnit(null, 176, 11, 320, 320, 1), makeUnit(null, 188, 11, 640, 640, 2), makeUnit(null, 0, 0, 100, 100, 3), makeUnit(null, START_LOCATION, 0, 200, 200, 4));
    scn.sprites.push({ spriteId: 100, x: 50, y: 50, owner: 0, unused: 0, flags: 0x1000 });
    const { boxes, resource } = blockers(scn, null);
    expect(resource).toEqual([true, true]);
    expect(boxes[0]).toEqual({ left: 288, top: 304, right: 352, bottom: 336 }); // a field: 2 × 1 tiles
    expect(boxes[1].right - boxes[1].left).toBe(128); // a geyser: 4 tiles wide
  });
});

/** A made-up tileset: CV5 group 0's slots 0, 1 and 2 are megatiles 1 (walkable low ground), 2 (a wall) and 3 (walkable high ground). */
function standInTileset() {
  const cv5 = new Uint8Array(52);
  const view = new DataView(cv5.buffer);
  [1, 2, 3].forEach((m, slot) => view.setUint16(20 + slot * 2, m, true));
  const vx4 = new Uint8Array(4 * 32);
  const vf4 = new Uint8Array(4 * 32);
  const flags = [0, 0x0001, 0, 0x0001 | 0x0004];
  for (let m = 0; m < 4; m++) for (let i = 0; i < 16; i++) new DataView(vf4.buffer).setUint16((m * 16 + i) * 2, flags[m], true);
  const vr4 = new Uint8Array(2 * 64);
  const wpe = new Uint8Array(1024);
  return { cv5, vf4, vr4, vx4, wpe };
}
const tileset = (): Tileset => loadTileset(standInTileset());

/**
 * A 64 × 64 two-player map: a wall down the middle with a one-tile gap at y 40, each player's main in a top corner
 * with 8 fields and a geyser, and a natural below it — the left one with a geyser, the right one without.
 */
function twoBases(): Scenario {
  const scn = createScenario({ width: 64, height: 64, era: 4, name: "Wall" });
  for (let ty = 0; ty < 64; ty++) if (ty !== 40) scn.tiles[ty * 64 + 32] = 1;
  let serial = 1;
  const put = (id: number, owner: number, tx: number, ty: number) => scn.units.push(makeUnit(null, id, owner, tx * 32 + 16, ty * 32 + 16, serial++));
  put(START_LOCATION, 0, 8, 8);
  put(START_LOCATION, 1, 56, 8);
  for (let k = 0; k < 8; k++) { put(176, 11, 2, 3 + k); put(176, 11, 61, 3 + k); }
  put(188, 11, 9, 2);
  put(188, 11, 54, 2);
  for (let k = 0; k < 6; k++) { put(176, 11, 4, 28 + k); put(176, 11, 59, 28 + k); }
  put(188, 11, 10, 35);
  return scn;
}

describe("a map laid out", () => {
  it("reports the starts, mains, naturals, the walk round the wall and its gap", () => {
    const l = analyzeLayout(twoBases(), { tileset: tileset(), units: null, speeds: null });
    expect(l.starts.map((s) => [s.player, s.side, s.main.fields, s.main.geysers])).toEqual([[1, "top left", 8, 1], [2, "top right", 8, 1]]);
    expect(l.bases).toHaveLength(4);
    expect(l.starts[0].natural).toMatchObject({ fields: 6, geysers: 1 });
    expect(l.starts[1].natural).toMatchObject({ fields: 6, geysers: 0 });
    const [pair] = l.pairs;
    expect(pair.air).toBe(48);
    expect(pair.ground).toBeGreaterThan(70); // down to the gap and back up
    expect(pair.ratio).toBeGreaterThan(1.5);
    expect(pair.seconds).toBeNull(); // no speeds without the game's tables
    expect(pair.narrowest).toMatchObject({ width: 1, at: { x: 32, y: 40 } });
    expect(l.spread).toBeNull();
    expect(l.terrain).toMatchObject({ walkable: expect.closeTo(100 - (63 / 4096) * 100, 1), high: 0, low: 100 });
    const words = l.verdicts.map((v) => `${v.level} ${v.text}`);
    expect(words).toContain("warn Start 2 has no gas at its natural.");
    expect(words).toContain("warn A 1-tile choke between starts 1 and 2 at (32, 40).");
    expect(words.some((t) => t.startsWith("info One pair of starts"))).toBe(true);
    expect(words).toContain("ok Every main has 8 mineral fields and 1 geyser, 12,000 minerals and 5,000 gas.");
    // The picture: the map's own at 2 px a tile, the walk drawn white over the black void of the made-up tiles.
    const pic = layoutPicture(twoBases(), { tileset: tileset(), units: null, speeds: null }, l, 2);
    expect([pic.width, pic.height]).toEqual([128, 128]);
    const bright = (x: number, y: number) => pic.pixels[(y * 128 + x) * 4] > 150;
    expect([79, 80, 81, 82].some((y) => bright(64, y) || bright(65, y))).toBe(true); // the walk through the gap
    expect(bright(10, 10)).toBe(false);
  });

  it("refuses a map with fewer than two start locations (exit 2)", () => {
    const scn = createScenario({ width: 32, height: 32, era: 4, name: "one" });
    scn.units.push(makeUnit(null, START_LOCATION, 0, 100, 100, 1));
    expect(() => analyzeLayout(scn, { tileset: tileset(), units: null, speeds: null })).toThrow(CliError);
    try { analyzeLayout(scn, { tileset: tileset(), units: null, speeds: null }); } catch (e) { expect((e as CliError).exitCode).toBe(2); }
  });
});

/** A layout with only what the verdicts read. */
function layoutOf(starts: Partial<StartLayout>[], pairs: Layout["pairs"] = []): Layout {
  const full = starts.map((s, i): StartLayout => ({
    player: i + 1, x: 0, y: 0, tile: { x: 0, y: 0 }, clock: 12, side: "top", level: "low",
    main: { fields: 8, minerals: 12000, geysers: 1, gas: 5000, fieldTiles: 6, geyserTiles: 7 },
    natural: null, wayOut: null, around: { radius: 12, high: 0, mid: 0, low: 100 }, ...s,
  }));
  const joined = pairs.filter((p) => p.ground !== null).sort((a, b) => a.ground! - b.ground!);
  const matrix = full.map((a) => full.map((b) => { const p = pairs.find((q) => (q.a === a.player && q.b === b.player) || (q.a === b.player && q.b === a.player)); return p?.ground ?? null; }));
  return {
    size: { width: 128, height: 128 }, grid: { cellPixels: 8, unitRadius: 1 }, starts: full, pairs,
    shortest: joined[0] ?? null, longest: joined.at(-1) ?? null, spread: spreadOf(joined.map((p) => p.ground!)), rankSpread: rankSpread(matrix),
    terrain: { walkable: 60, unwalkable: 40, buildable: 50, high: 0, mid: 0, low: 100 }, bases: [], blocking: { buildings: 0, resources: 0 }, speeds: [], verdicts: [], paths: { pairs: [], naturals: [] },
  };
}
const natural = (ground: number, geysers = 1) => ({ base: 0, at: { x: 0, y: 0 }, ground, air: ground, fields: 7, minerals: 10500, geysers, gas: geysers * 5000, sharedWith: [] });
const pair = (a: number, b: number, ground: number | null, narrowest: number | null = null): Layout["pairs"][number] => ({ a, b, ground, air: 100, ratio: ground && ground / 100, seconds: null, narrowest: narrowest === null ? null : { width: narrowest, at: { x: 10, y: 20 } } });

describe("the verdicts' thresholds", () => {
  it("ground distances: within 8% is fair; a square's near and far pairs are fair by rank", () => {
    const close = verdictsOf(layoutOf([{}, {}, {}], [pair(1, 2, 100), pair(1, 3, 106), pair(2, 3, 107)]));
    expect(close[0]).toEqual({ level: "ok", text: "Ground distances between starts within 7% of each other (100 to 107 tiles)." });
    const square = verdictsOf(layoutOf([{}, {}, {}, {}], [pair(1, 2, 100), pair(1, 3, 141), pair(1, 4, 100), pair(2, 3, 100), pair(2, 4, 141), pair(3, 4, 100)]));
    expect(square[0].level).toBe("ok");
    expect(square[0].text).toMatch(/nearest to farthest, within 0%; near and far pairs differ by 41%/);
    const skewed = verdictsOf(layoutOf([{}, {}, {}, {}], [pair(1, 2, 100), pair(1, 3, 141), pair(1, 4, 100), pair(2, 3, 100), pair(2, 4, 141), pair(3, 4, 120)]));
    expect(skewed[0]).toMatchObject({ level: "warn", text: expect.stringMatching(/second nearest opponent is 20% farther/) });
    expect(verdictsOf(layoutOf([{}, {}], [pair(1, 2, null)]))[0].text).toMatch(/island map/);
  });

  it(`naturals: ${NATURAL_TILES} tiles apart is named, one less is not; no gas is named; a narrow choke under ${CHOKE_NARROW} tiles is named`, () => {
    const at = (a: number, b: number, gas = 1) => verdictsOf(layoutOf([{ natural: natural(a) }, { natural: natural(b, gas) }], [pair(1, 2, 100, 3)])).map((v) => v.text);
    expect(at(30, 30 + NATURAL_TILES)).toContain(`Start 2's natural is ${NATURAL_TILES} tiles farther than start 1's (${30 + NATURAL_TILES} against 30 by ground).`);
    expect(at(30, 30 + NATURAL_TILES - 1)).toContain(`Naturals 30 to ${30 + NATURAL_TILES - 1} tiles from their mains by ground.`);
    expect(at(30, 30, 0)).toContain("Start 2 has no gas at its natural.");
    const choke = (w: number) => verdictsOf(layoutOf([{}, {}], [pair(1, 2, 100, w)])).map((v) => v.text);
    expect(choke(CHOKE_NARROW - 0.5)).toContain(`A ${CHOKE_NARROW - 0.5}-tile choke between starts 1 and 2 at (10, 20).`);
    expect(choke(CHOKE_NARROW).some((t) => t.includes("choke"))).toBe(false);
  });

  it("mains: a start with fewer fields is named", () => {
    const v = verdictsOf(layoutOf([{}, {}, { main: { fields: 7, minerals: 10500, geysers: 1, gas: 5000, fieldTiles: 6, geyserTiles: 7 } }]));
    expect(v.map((x) => x.text)).toContain("Start 3's main has 7 mineral fields, the others 8.");
  });
});

describe("the walking speed", () => {
  it("is flingy.dat's top speed, or the walking animation's moves over its frames", () => {
    // iscript.bin: an entry table at 2 naming script 5 at 10; a type-12 header (14 animations); Walking (11) at 46:
    // move 4, wait 1, move 3, wait 1, goto 46.
    const bin = new Uint8Array(64);
    const v = new DataView(bin.buffer);
    v.setUint16(0, 2, true);
    v.setUint16(2, 5, true); v.setUint16(4, 10, true); v.setUint16(6, 0xffff, true);
    bin.set([0x53, 0x43, 0x50, 0x45, 12], 10);
    v.setUint16(18 + 11 * 2, 46, true);
    bin.set([0x29, 4, 0x05, 1, 0x29, 3, 0x05, 1, 0x07, 46, 0], 46);
    const tables = {
      units: { flingy: Uint8Array.from([0, 1]) },
      flingy: { sprite: Uint16Array.from([0, 0]), topSpeed: Uint32Array.from([1280, 1]), moveControl: Uint8Array.from([0, 2]) },
      sprites: { image: Uint16Array.from([0]) },
      images: { iscript: Uint32Array.from([5]) },
    } as unknown as Omit<SpeedTables, "iscript">;
    return import("../src/formats/dat/iscript").then(({ decodeIscript }) => {
      const t = { ...tables, iscript: decodeIscript(bin) } as SpeedTables;
      expect(walkSpeed(t, 0)).toBe(5); // an SCV's 1280 / 256
      expect(walkSpeed(t, 1)).toBe(3.5);
      expect(walkSpeed(t, 7)).toBeNull();
    });
  });
});

describe("the command", () => {
  /** A 1.16.1 copy with only the jungle tileset in StarDat: no units.dat, so no walking speeds. */
  function copy(): string {
    const dir = tmp();
    const stardat = new Creator({});
    for (const [ext, data] of Object.entries(standInTileset())) stardat.addFile(`tileset\\jungle.${ext}`, data);
    writeFileSync(join(dir, "StarDat.mpq"), stardat.write());
    writeFileSync(join(dir, "BrooDat.mpq"), new Creator({}).write());
    return dir;
  }
  const input: Input = { path: "wall.scx", name: "wall.scx", bytes: new Uint8Array(), kind: "map" };

  it("checks its options and the starts before it looks for the game", async () => {
    const map = { scenario: twoBases(), extras: new Map(), fileName: "wall.scx" };
    const refused = (o: Parameters<typeof analyzeMap>[2], m = map) => analyzeMap(input, m, o).then(() => null, (e: CliError) => [e.exitCode, e.message]);
    expect(await refused({ scale: "4" })).toEqual([2, expect.stringMatching(/--scale is the picture's/)]);
    expect(await refused({ picture: "a.png", scale: "3" })).toEqual([2, expect.stringMatching(/--scale takes 1, 2, 4/)]);
    const lone = createScenario({ width: 32, height: 32, era: 4, name: "one" });
    expect(await refused({ starcraft: "/nowhere" }, { ...map, scenario: lone })).toEqual([2, "wall.scx has 0 start locations: map analyze compares starts, and needs two or more."]);
    expect(await refused({ starcraft: tmp() })).toEqual([1, expect.stringMatching(/is not a copy of StarCraft/)]);
  });

  it("reports through a stand-in copy, and writes the picture", async () => {
    const map = { scenario: twoBases(), extras: new Map(), fileName: "wall.scx" };
    const out = join(tmp(), "wall.png");
    const { report, lines } = await analyzeMap(input, map, { starcraft: copy(), picture: out, scale: "2" });
    expect(report).toMatchObject({ tileset: "jungle", copy: { kind: "classic" }, speeds: [], picture: { width: 128, height: 128, scale: 2, path: out } });
    expect(report.ms.total).toBeLessThan(5000);
    expect([...readFileSync(out).subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    const text = lines.map(visible).join("\n");
    expect(text).toMatch(/1 top left, 11 o'clock/);
    expect(text).toMatch(/1 ↔ 2 +\d+ tiles +air 48/);
    expect(text).toMatch(/No walking speeds/);
    expect(text).toMatch(/▲ A 1-tile choke between starts 1 and 2 at \(32, 40\)\./);
    expect(text).toMatch(/Picture: 128 × 128 PNG, 2 pixels a tile/);
    expect(JSON.parse(JSON.stringify(report)).paths).toBeUndefined();
  });

  it("reads the committed melee map: two starts on flat ground, each with its main", async () => {
    const bytes = new Uint8Array(readFileSync(testMap("melee.scx")));
    const map = await openMapBytes(bytes, "melee.scx");
    const { report } = await analyzeMap({ path: "melee.scx", name: "melee.scx", bytes, kind: "map" }, map, { starcraft: copy() });
    expect(report.starts).toHaveLength(2);
    expect(report.pairs[0].ground).not.toBeNull();
    expect(report.pairs[0].ratio).toBeGreaterThanOrEqual(1);
    expect(report.terrain.walkable).toBe(100);
  });
});
