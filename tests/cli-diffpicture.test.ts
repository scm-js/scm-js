/**
 * `scmjs map diff --picture` (cli/src/diffpicture.ts): the units paired as moved, the tiles and locations compared,
 * the change picture from a made-up tileset with a known changed tile and a moved unit landing in the right pixels,
 * side by side, maps of two tilesets, the terminal's forms and the command through a stand-in 1.16.1 copy — and, only
 * where this computer has a copy of StarCraft, the real thing.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Creator } from "mopaq";
import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import type { Scenario } from "../src/formats/chk/scenario";
import { loadTileset } from "../src/formats/tileset/decode";
import { makeUnit } from "../src/editor/units";
import { START_LOCATION } from "../src/data/units";
import { openMapBytes, type OpenedMap } from "../src/editor/mapFile";
import { findGameCopy } from "../cli/src/engine";
import type { Input } from "../cli/src/files";
import {
  ADDED_COLOR, asciiOverlay, GAP_COLOR, changePicture, diffChanges, diffLegend, diffPicture, MOVED_COLOR, PAD_COLOR, REMOVED_COLOR, sideBySide, TILE, TILE_COLOR, unitChanges,
} from "../cli/src/diffpicture";
import { asciiShades } from "../cli/src/paint";
import { plainShade } from "../cli/src/preview";
import { visible, type CliError } from "../cli/src/ui";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-diffpicture-"));

/** As tests/cli-preview.test.ts: tile id 0 is megatile 1, one flat colour; tile id 1 names megatile 9, which is not there (black). */
function fakeTilesetFiles([r, g, b]: [number, number, number]) {
  const cv5 = new Uint8Array(52 * 2);
  new DataView(cv5.buffer).setUint16(20, 1, true);
  new DataView(cv5.buffer).setUint16(22, 9, true);
  const vx4 = new Uint8Array(2 * 16 * 2);
  for (let i = 0; i < 16; i++) new DataView(vx4.buffer).setUint16((16 + i) * 2, 1 << 1, true);
  const vr4 = new Uint8Array(2 * 64);
  vr4.fill(5, 64);
  const vf4 = new Uint8Array(2 * 16 * 2);
  const wpe = new Uint8Array(1024);
  wpe.set([r, g, b, 0], 5 * 4);
  return { cv5, vf4, vr4, vx4, wpe };
}
const GROUND: [number, number, number] = [200, 100, 50];
const graphics = { tileset: loadTileset(fakeTilesetFiles(GROUND)), units: null };

const rgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** `c` over `under` at `a`, as the picture blends. */
const over = (under: number[], c: [number, number, number], a: number) => under.map((v, i) => Math.round(v * (1 - a) + c[i] * a));
/** The unchanged ground: darkened to 60%. */
const DIMMED = GROUND.map((v) => Math.round(v * 0.6));
const px = (pic: { width: number; pixels: Uint8Array }, x: number, y: number) => [...pic.pixels.subarray((y * pic.width + x) * 4, (y * pic.width + x) * 4 + 3)];

const MARINE = 0, ZEALOT = 65, COMMAND_CENTER = 106;
const at = (tile: number) => tile * 32 + 16;
const jungle = (w = 64, h = 64): Scenario => createScenario({ width: w, height: h, era: 4, name: "t" });

describe("what changed", () => {
  it("pairs a removed and an added unit of one type and owner, nearest first, as moved; edited where it stood; the rest added or removed", () => {
    const a = [
      makeUnit(null, MARINE, 0, 100, 100, 1), makeUnit(null, MARINE, 0, 300, 100, 2),
      makeUnit(null, ZEALOT, 1, 500, 500, 3), makeUnit(null, COMMAND_CENTER, 0, 1000, 1000, 4),
      makeUnit(null, ZEALOT, 1, 800, 800, 5),
    ];
    const b = [
      makeUnit(null, MARINE, 0, 310, 100, 11), makeUnit(null, MARINE, 0, 110, 100, 12), // each marine moved ten pixels
      makeUnit(null, ZEALOT, 1, 2000, 2000, 13), // too far from the zealot at 500,500 to be it
      makeUnit(null, COMMAND_CENTER, 0, 1000, 1000, 14), // the same but its serial
      { ...makeUnit(null, ZEALOT, 1, 800, 800, 15), hitPointsPercent: 50 }, // edited where it stood
      makeUnit(null, MARINE, 2, 120, 100, 16), // another owner's marine: not the first marine
    ];
    const { changes, kept } = unitChanges(a, b);
    expect(kept.map((u) => u.serial)).toEqual([14]);
    expect(changes).toEqual([
      { change: "removed", unitId: ZEALOT, owner: 1, x: 500, y: 500 },
      { change: "added", unitId: ZEALOT, owner: 1, x: 2000, y: 2000 },
      { change: "added", unitId: MARINE, owner: 2, x: 120, y: 100 },
      { change: "changed", unitId: ZEALOT, owner: 1, x: 800, y: 800 },
      { change: "moved", unitId: MARINE, owner: 0, x: 110, y: 100, from: { x: 100, y: 100 } },
      { change: "moved", unitId: MARINE, owner: 0, x: 310, y: 100, from: { x: 300, y: 100 } },
    ]);
    // A tighter radius: ten pixels away is no longer the same unit.
    expect(unitChanges(a.slice(0, 1), b.slice(1, 2), 5).changes.map((c) => c.change)).toEqual(["removed", "added"]);
  });

  it("compares tiles by id on a canvas the size of the larger map, and gives the bounds", () => {
    const a = jungle(64, 64), b = jungle(64, 96);
    b.tiles[5 * 64 + 7] = 1;
    b.tiles[9 * 64 + 12] = 1;
    b.units.push(makeUnit(null, MARINE, 0, at(30), at(40), 1));
    b.locations[0] = { left: 320, top: 320, right: 640, bottom: 480, nameIndex: 0, elevationFlags: 0 };
    const d = diffChanges(a, b);
    expect([d.width, d.height]).toEqual([64, 96]);
    expect(d.tiles[5 * 64 + 7]).toBe(TILE.changed);
    expect(d.tiles[0]).toBe(TILE.same);
    expect(d.tiles[70 * 64]).toBe(TILE.bOnly);
    expect(d.counts).toEqual({ tiles: 2, resized: 64 * 32, unitsAdded: 1, unitsRemoved: 0, unitsMoved: 0, unitsChanged: 0, locations: 2 }); // location 0, and Anywhere grew
    expect(d.bounds.tiles).toEqual({ x: 7, y: 5, width: 6, height: 5 });
    expect(d.bounds.all).toEqual({ x: 7, y: 5, width: 24, height: 36 }); // to the marine's tile (30, 40)
    expect(diffChanges(a, jungle(64, 64)).bounds).toEqual({ tiles: null, all: null });
  });
});

describe("the change picture", () => {
  /** Tile (5, 5) changed; a marine moved from tile (40, 21) to (42, 21); a mineral field kept; a start location kept. */
  function pair() {
    const a = jungle(), b = jungle();
    b.tiles[5 * 64 + 5] = 1;
    for (const [s, x] of [[a, 40], [b, 42]] as const) {
      s.units.push(makeUnit(null, MARINE, 0, at(x), at(21), 1));
      s.units.push(makeUnit(null, 176, 11, at(10), at(50), 2));
      s.units.push(makeUnit(null, START_LOCATION, 0, at(8), at(8), 3));
    }
    return { a, b };
  }

  it("tints the changed tile, darkens the rest, and puts the moved unit's box and line in the pixels it moved through", () => {
    const { a, b } = pair();
    const cp = changePicture(a, b, graphics, { scale: 1 });
    expect([cp.picture.width, cp.picture.height, cp.scale]).toEqual([64, 64, 1]);
    expect(px(cp.picture, 0, 0)).toEqual(DIMMED);
    expect(px(cp.picture, 5, 5)).toEqual(over([0, 0, 0], rgb(TILE_COLOR), 0.6)); // tile id 1 draws black, then the tint
    // One pixel a tile: the box is the two tiles round it (the least a changed unit's box is), a frame where it was
    // (also two tiles), and a line between their middles.
    const yellow = over(DIMMED, rgb(MOVED_COLOR), 0.9), twice = over(yellow, rgb(MOVED_COLOR), 0.9);
    expect(px(cp.picture, 42, 21)).toEqual(twice); // the line, then the box
    expect(px(cp.picture, 43, 22)).toEqual(yellow); // the box alone
    expect(px(cp.picture, 41, 22)).toEqual(yellow); // the old frame alone
    expect(px(cp.picture, 39, 21)).toEqual(DIMMED);
    expect(px(cp.picture, 44, 21)).toEqual(DIMMED);
    expect(cp.diff.counts).toMatchObject({ tiles: 1, unitsMoved: 1, unitsAdded: 0, unitsRemoved: 0 });
    // The kept landmarks are drawn as preview draws them; the moved marine is not among them.
    expect(cp.marks.map((m) => m.kind)).toEqual(["mineral", "start"]);
    expect(cp.changes).toEqual([expect.objectContaining({ kind: "unit", change: "moved", color: MOVED_COLOR, x0: 42, y0: 21, x1: 44, y1: 23, line: [40, 21, 42, 21], was: { x0: 40, y0: 21, x1: 42, y1: 23 } })]);
  });

  it("without the game's graphics: plain greys, one a tile group, with the same changes marked", () => {
    const { a, b } = pair();
    b.tiles[6 * 64 + 6] = 0x123; // another group: its own grey
    const cp = changePicture(a, b, { tileset: null, units: null }, { scale: 1 });
    const dim = (c: number[]) => c.map((v) => Math.round(v * 0.6));
    expect(px(cp.picture, 0, 0)).toEqual(dim(plainShade(a.tiles[0])));
    expect(px(cp.picture, 6, 6)).toEqual(over(plainShade(0x123), rgb(TILE_COLOR), 0.6));
    expect(plainShade(0x123)).not.toEqual(plainShade(a.tiles[0]));
    expect(plainShade(0x120)).toEqual(plainShade(0x12f)); // a group's tiles share theirs
    expect(plainShade(0)).toEqual([0, 0, 0]);
    expect(cp.diff.counts).toMatchObject({ tiles: 2, unitsMoved: 1 });
    expect(cp.changes).toEqual([expect.objectContaining({ kind: "unit", change: "moved", x0: 42, y0: 21 })]);
  });

  it("at four pixels a tile: a box with a dark edge, a frame where it was, the tile's sixteen pixels tinted", () => {
    const { a, b } = pair();
    const cp = changePicture(a, b, graphics, { scale: 4 });
    expect(cp.picture.width).toBe(256);
    for (const [x, y] of [[20, 20], [23, 23]]) expect(px(cp.picture, x, y)).toEqual(over([0, 0, 0], rgb(TILE_COLOR), 0.6));
    expect(px(cp.picture, 24, 24)).toEqual(DIMMED);
    const box = cp.changes[0];
    expect([box.x0, box.y0, box.x1, box.y1]).toEqual([166, 82, 174, 90]); // 42.5 × 4 − 4: two tiles round it
    expect(px(cp.picture, 170, 86)[0]).toBeGreaterThan(240);
    expect(px(cp.picture, 170, 90)).toEqual(over(DIMMED, [0, 0, 0], 0.8)); // the dark edge under it
    expect(px(cp.picture, 163, 85)).toEqual(over(DIMMED, rgb(MOVED_COLOR), 0.9)); // the line, from the old box's middle
    expect(px(cp.picture, 158, 87)).toEqual(over(DIMMED, rgb(MOVED_COLOR), 0.9)); // the old box's frame
  });

  it("marks units added and removed, locations as outlines, and stripes the tiles only one map has", () => {
    const a = jungle(64, 64), b = jungle(64, 80);
    a.units.push(makeUnit(null, MARINE, 0, at(10), at(10), 1));
    b.units.push(makeUnit(null, MARINE, 3, at(20), at(10), 1));
    b.locations[0] = { left: 30 * 32, top: 30 * 32, right: 34 * 32, bottom: 33 * 32, nameIndex: 0, elevationFlags: 0 };
    const cp = changePicture(a, b, graphics, { scale: 1 });
    expect(cp.picture.height).toBe(80);
    expect(px(cp.picture, 10, 10)).toEqual(over(DIMMED, rgb(REMOVED_COLOR), 0.9));
    expect(px(cp.picture, 20, 10)).toEqual(over(DIMMED, rgb(ADDED_COLOR), 0.9));
    expect(px(cp.picture, 30, 30)).toEqual(over(DIMMED, rgb(ADDED_COLOR), 0.9)); // the location's corner
    expect(px(cp.picture, 31, 31)).toEqual(DIMMED); // its inside
    // Rows 64–79 are the second map's alone: striped diagonally, two pixels light and two dark.
    expect(px(cp.picture, 0, 70)).toEqual(px(cp.picture, 1, 70));
    expect(px(cp.picture, 0, 70)).not.toEqual(px(cp.picture, 2, 70));
    expect(cp.diff.counts.resized).toBe(64 * 16);
    // Where neither map has ground (a wider and b taller), the canvas's own colour.
    const c = changePicture(jungle(96, 64), jungle(64, 96), graphics, { scale: 1 });
    expect(px(c.picture, 80, 80)).toEqual(rgb(PAD_COLOR));
  });

  it("refuses maps of two tilesets; side by side draws them as a | b, and a | changes | b when they share one", () => {
    const ice = createScenario({ width: 64, height: 64, era: 6, name: "t" });
    expect(() => changePicture(jungle(), ice, graphics)).toThrow(/tilesets differ \(jungle, ice\)/);
    const two = sideBySide(jungle(), ice, { a: graphics, b: graphics }, { scale: 1, gap: 4 });
    expect(two.change).toBeNull();
    expect(two.panels).toEqual([{ name: "a", x: 0, width: 64 }, { name: "b", x: 68, width: 64 }]);
    expect(px(two.picture, 66, 0)).toEqual(rgb(GAP_COLOR));
    const { a, b } = pair();
    const three = sideBySide(a, b, { a: graphics, b: graphics }, { scale: 2 });
    expect(three.panels.map((p) => [p.name, p.x])).toEqual([["a", 0], ["changes", 132], ["b", 264]]);
    expect(three.picture.width).toBe(3 * 128 + 2 * 4);
    // The first panel is the map as preview draws it: ground at full brightness.
    expect(px(three.picture, 0, 0)).toEqual(GROUND);
    expect(px(three.picture, 132, 0)).toEqual(DIMMED);
    // A start location's number moves with its panel.
    const starts = three.marks.filter((m) => m.label).map((m) => m.x0);
    expect(starts).toEqual([starts[0], starts[0] + 132, starts[0] + 264]);
  });

  it("in ASCII: letters for what changed over the ground's shades, and the legend", () => {
    const a = jungle(), b = jungle();
    b.tiles[0] = 1;
    a.units.push(makeUnit(null, MARINE, 0, at(40), at(20), 1));
    const cp = changePicture(a, b, graphics, { width: 64 });
    const lines = asciiShades(cp.picture, cp.marks, "none", asciiOverlay(cp));
    expect(lines).toHaveLength(32);
    expect(lines[0][0]).toBe("x");
    expect(lines[10][40]).toBe("R");
    expect(diffLegend(cp.diff.counts, "none", true, true)).toBe("A +0 units  R −1 units  x ~1 tiles  # ~0 locations");
    expect(diffLegend(diffChanges(a, a).counts, "none", true, false)).toBe("nothing changed");
    // eslint-disable-next-line no-control-regex -- the colour codes
    expect(diffLegend(cp.diff.counts, "truecolor", true, false)).toMatch(/^\x1b\[38;2;46;230;90m■\x1b\[39m \+0 units/);
  });
});

describe("the command, through a stand-in 1.16.1 copy", () => {
  function copy(): string {
    const dir = tmp();
    const stardat = new Creator({});
    for (const [ext, data] of Object.entries(fakeTilesetFiles(GROUND))) {
      stardat.addFile(`tileset\\jungle.${ext}`, data);
      stardat.addFile(`tileset\\ice.${ext}`, data);
    }
    writeFileSync(join(dir, "StarDat.mpq"), stardat.write());
    writeFileSync(join(dir, "BrooDat.mpq"), new Creator({}).write());
    return dir;
  }
  const opened = (name: string, scenario: Scenario): { input: Input; doc: OpenedMap } => ({
    input: { path: name, name, bytes: new Uint8Array(), kind: "map" }, doc: { scenario, extras: new Map(), fileName: name } as unknown as OpenedMap,
  });
  const ascii = { columns: 80, depth: "none" as const, unicode: true, inline: null };
  const wide = { columns: 160, depth: "truecolor" as const, unicode: true, inline: null };

  it("checks its options before it looks for the game", async () => {
    const x = opened("a.scx", jungle()), y = opened("b.scx", jungle());
    const refused = (o: Parameters<typeof diffPicture>[2]) => diffPicture(x, y, o, ascii).then(() => null, (e: CliError) => [e.exitCode, e.message]);
    expect(await refused({ out: "d.png", scale: "3" })).toEqual([2, '--scale takes 1, 2, 4, 8, 16, 32, not "3"']);
    expect(await refused({ out: "d.png", width: "80" })).toEqual([2, expect.stringMatching(/--width is the terminal/)]);
    expect(await refused({ starcraft: tmp() })).toEqual([1, expect.stringMatching(/is not a copy of StarCraft/)]);
  });

  it("the terminal: the change picture titled a → b with its legend; three side by side when there is room", async () => {
    const a = jungle(), b = jungle();
    b.tiles[3] = 1;
    b.units.push(makeUnit(null, MARINE, 0, at(20), at(20), 1));
    const starcraft = copy();
    const shown = await diffPicture(opened("a.scx", a), opened("b.scx", b), { starcraft }, ascii);
    expect(shown.report).toMatchObject({ layout: "changes", picture: { form: "ascii", columns: 79, rows: 40 }, counts: { tiles: 1, unitsAdded: 1 }, bounds: { tiles: { x: 3, y: 0, width: 1, height: 1 } } });
    expect(visible(shown.lines[0])).toMatch(/^a\.scx → b\.scx {2}64 × 64 · jungle · StarCraft 1\.16\.1/);
    expect(visible(shown.lines.at(-1) ?? "")).toBe("A +1 units  R −0 units  x ~1 tiles  # ~0 locations");
    expect(shown.lines.slice(1, -1).join("\n")).toContain("A");

    // Too narrow for three: the changes alone, and it says so.
    const narrow = await diffPicture(opened("a.scx", a), opened("b.scx", b), { starcraft, sideBySide: true }, ascii);
    expect(narrow.report.layout).toBe("changes");
    expect(narrow.lines[1]).toMatch(/Too narrow for three pictures side by side \(80 columns\)/);

    const three = await diffPicture(opened("a.scx", a), opened("b.scx", b), { starcraft, sideBySide: true }, wide);
    expect(three.report).toMatchObject({ layout: "side-by-side", picture: { form: "blocks", width: 3 * 51 + 4 } });
    expect(visible(three.lines[1])).toMatch(/a\.scx {46,}changes {44,}b\.scx/);
  });

  it("maps of two tilesets: side by side, nothing marked, and it says so", async () => {
    const ice = createScenario({ width: 64, height: 64, era: 6, name: "t" });
    const shown = await diffPicture(opened("a.scx", jungle()), opened("b.scx", ice), { starcraft: copy() }, wide);
    expect(shown.report).toMatchObject({ layout: "side-by-side", tilesets: { a: "jungle", b: "ice" }, note: expect.stringMatching(/tilesets differ \(jungle, ice\)/) });
    expect(shown.lines[1]).toContain("tilesets differ");
    expect(shown.lines.at(-1)).not.toMatch(/tiles/);
  });

  it("--out writes the PNG (to a stream for -), side by side when asked", async () => {
    const a = jungle(), b = jungle(64, 96);
    const sink = new PassThrough();
    const got: Buffer[] = [];
    sink.on("data", (c: Buffer) => got.push(c));
    const written = await diffPicture(opened("a.scx", a), opened("b.scx", b), { starcraft: copy(), out: "-", scale: "2", sideBySide: true }, ascii, sink);
    expect(written.report.picture).toEqual({ form: "png", width: 3 * 128 + 2 * 4, height: 192, scale: 2 });
    expect(written.report.out?.bytes).toBe(Buffer.concat(got).length);
    expect(Buffer.concat(got).subarray(1, 4).toString()).toBe("PNG");
    expect(written.report.counts.resized).toBe(64 * 32);
  });
});

/** The copy of the game on this computer, if there is one (never on CI). */
const found = (() => { try { return findGameCopy(process.env.SCMJS_STARCRAFT); } catch { return null; } })();

describe.skipIf(!found)("the copy of the game on this computer", () => {
  it("marks a moved unit and a painted tile on a committed map", async () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, "maps", "melee.scx")));
    const a = await openMapBytes(bytes, "melee.scx"), b = await openMapBytes(bytes, "melee.scx");
    const s = b.scenario;
    s.tiles[10 * s.width + 10] = 0x10;
    const unit = s.units.find((u) => u.unitId !== START_LOCATION) ?? s.units[0];
    unit.x += 64;
    const input = (name: string): Input => ({ path: name, name, bytes, kind: "map" });
    const sink = new PassThrough();
    sink.resume();
    const r = await diffPicture({ input: input("a.scx"), doc: a }, { input: input("b.scx"), doc: b }, { out: "-" }, { columns: 80, depth: "truecolor", unicode: true, inline: null }, sink);
    expect(r.report.counts).toMatchObject({ tiles: 1, unitsMoved: 1 });
    expect(r.report.picture).toMatchObject({ form: "png", width: s.width * 4, scale: 4 });
    expect(r.report.copy.kind).toBe(found!.kind);
  }, 20_000);
});
