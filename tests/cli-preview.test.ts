/**
 * `scmjs map preview` (cli/src/preview.ts, paint.ts, png.ts, gamefiles.ts): the PNG encoder against zlib, the terminal's
 * half blocks and 256-colour and ASCII fallbacks from known pixels, where marks land, a 1.16.1 copy's archives layered
 * as the game layers them (built here from a made-up tileset), and — only where this computer has a copy of
 * StarCraft, which CI has not — the real thing.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { inflateSync } from "node:zlib";
import { Creator } from "mopaq";
import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { loadTileset, type Tileset } from "../src/formats/tileset/decode";
import { makeUnit } from "../src/editor/units";
import { START_LOCATION } from "../src/data/units";
import { findGameCopy } from "../cli/src/engine";
import type { Input } from "../cli/src/files";
import { archiveFiles, classicArchives, openGameFiles, readTileset, readUnitsDat } from "../cli/src/gamefiles";
import { ansi256, asciiShades, halfBlocks, inlineImage, inlineProtocol, legendLine } from "../cli/src/paint";
import { crc32, encodePng } from "../cli/src/png";
import { GEYSER_COLOR, mapPicture, MINERAL_COLOR, placeMarks, previewMap, previewPng, resizePicture, terminalWidth, terrainPicture, type Picture } from "../cli/src/preview";
import { CliError } from "../cli/src/ui";
import { openMapBytes } from "../src/editor/mapFile";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-preview-"));

/** The chunks of a PNG: type, data, and whether its CRC is right. */
function chunks(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
  for (let at = 8; at < png.length;) {
    const n = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    out.push({ type, data: png.subarray(at + 8, at + 8 + n), crcOk: view.getUint32(at + 8 + n) === crc32(png, at + 4, at + 8 + n) });
    at += 12 + n;
  }
  return out;
}

/** A picture from rows of `#rrggbb`. */
function picture(rows: string[][]): Picture {
  const height = rows.length, width = rows[0].length;
  const pixels = new Uint8Array(width * height * 4);
  rows.forEach((r, y) => r.forEach((hex, x) => {
    const n = parseInt(hex.slice(1), 16), at = (y * width + x) * 4;
    pixels.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], at);
  }));
  return { width, height, pixels };
}

/**
 * A made-up tileset: CV5 group 0 slot 0 is megatile 1, whose sixteen minitiles are all minitile 1, all palette index
 * 5 — so tile id 0 draws as one flat colour. Group 0 slot 1 (tile id 1) names megatile 9, which does not exist.
 */
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
const fakeTileset = (rgb: [number, number, number]): Tileset => loadTileset(fakeTilesetFiles(rgb));

describe("png", () => {
  it("writes a PNG that zlib reads back: dimensions, filter 0, the pixels, every CRC", () => {
    expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082);
    const pic = picture([["#ff0000", "#00ff00", "#0000ff"], ["#010203", "#fefdfc", "#808080"]]);
    const png = encodePng(pic.pixels, pic.width, pic.height);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parts = chunks(png);
    expect(parts.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(parts.every((c) => c.crcOk)).toBe(true);
    const ihdr = new DataView(parts[0].data.buffer, parts[0].data.byteOffset);
    expect([ihdr.getUint32(0), ihdr.getUint32(4), parts[0].data[8], parts[0].data[9], parts[0].data[12]]).toEqual([3, 2, 8, 2, 0]);
    const raw = inflateSync(parts[1].data);
    expect(raw.length).toBe(2 * (3 * 3 + 1));
    expect([raw[0], raw[10]]).toEqual([0, 0]);
    expect([...raw.subarray(1, 10)]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    expect([...raw.subarray(11, 20)]).toEqual([1, 2, 3, 254, 253, 252, 128, 128, 128]);
  });

  it("keeps the alpha when asked (colour type 6) and refuses too few bytes", () => {
    const png = encodePng(Uint8Array.of(9, 8, 7, 6), 1, 1, { alpha: true });
    const [ihdr, idat] = chunks(png);
    expect(ihdr.data[9]).toBe(6);
    expect([...inflateSync(idat.data)]).toEqual([0, 9, 8, 7, 6]);
    expect(() => encodePng(new Uint8Array(4), 2, 2)).toThrow(/needs 16 bytes/);
  });
});

describe("the terminal's forms", () => {
  const pic = picture([["#ff0000", "#000000"], ["#0000ff", "#808080"], ["#ffffff", "#ffffff"]]);

  it("half blocks: the upper pixel as foreground, the lower as background, 24-bit", () => {
    const lines = halfBlocks(pic, [], "truecolor");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("\x1b[38;2;255;0;0;48;2;0;0;255m▀\x1b[38;2;0;0;0;48;2;128;128;128m▀\x1b[0m");
    // The odd last row: the terminal's own background under it, and one code for two cells of one colour.
    expect(lines[1]).toBe("\x1b[38;2;255;255;255;49m▀▀\x1b[0m");
  });

  it("the nearest of the 256 colours: cube or grey", () => {
    expect(ansi256(255, 0, 0)).toBe(196);
    expect(ansi256(0, 0, 0)).toBe(16);
    expect(ansi256(255, 255, 255)).toBe(231);
    expect(ansi256(128, 128, 128)).toBe(244);
    expect(ansi256(95, 135, 175)).toBe(16 + 36 * 1 + 6 * 2 + 3);
    expect(halfBlocks(pic, [], "256")[0]).toBe("\x1b[38;5;196;48;5;21m▀\x1b[38;5;16;48;5;244m▀\x1b[0m");
  });

  it("ASCII: shades by brightness, marks as letters, a start location's number, and no codes without colour", () => {
    const shades = picture([["#000000", "#404040", "#808080", "#ffffff"], ["#000000", "#404040", "#808080", "#ffffff"]]);
    expect(asciiShades(shades, [], "none")).toEqual([" :=@"]);
    const marked = asciiShades(shades, [
      { kind: "mineral", owner: 11, color: MINERAL_COLOR, x0: 0, y0: 0, x1: 1, y1: 1 },
      { kind: "start", owner: 1, color: "#0c48cc", x0: 2, y0: 0, x1: 4, y1: 2, label: "2" },
    ], "none");
    expect(marked[0]).toBe("$:2@");
    expect(asciiShades(shades, [], "256")[0]).toContain("\x1b[38;5;");
  });

  it("a start location's number sits on its colour in the cell holding its middle", () => {
    const flat = picture(Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => "#000000")));
    const lines = halfBlocks(flat, [{ kind: "start", owner: 0, color: "#f40404", x0: 2, y0: 1, x1: 5, y1: 4, label: "1" }], "truecolor");
    expect(lines[1]).toContain("\x1b[38;2;255;255;255;48;2;244;4;4m1");
    expect(lines[1].split("▀")).toHaveLength(6); // five blocks and the number
  });

  it("the picture protocols: kitty in pieces, iTerm2 whole, only on a terminal and not through tmux", () => {
    expect(inlineProtocol({ KITTY_WINDOW_ID: "1" }, true)).toBe("kitty");
    expect(inlineProtocol({ TERM: "xterm-kitty" }, true)).toBe("kitty");
    expect(inlineProtocol({ TERM_PROGRAM: "iTerm.app" }, true)).toBe("iterm");
    expect(inlineProtocol({ TERM_PROGRAM: "iTerm.app" }, false)).toBeNull();
    expect(inlineProtocol({ KITTY_WINDOW_ID: "1", TMUX: "/tmp/x" }, true)).toBeNull();
    expect(inlineProtocol({ TERM: "xterm-256color" }, true)).toBeNull();
    const png = new Uint8Array(5000).fill(7);
    const kitty = inlineImage(png, "kitty", 80);
    const pieces = kitty.split("\x1b\\").filter(Boolean);
    expect(pieces).toHaveLength(Math.ceil(Buffer.from(png).toString("base64").length / 4096));
    // eslint-disable-next-line no-control-regex -- the protocols' escape codes
    expect(pieces[0]).toMatch(/^\x1b_Gf=100,a=T,q=2,c=80,m=1;/);
    // eslint-disable-next-line no-control-regex -- the protocols' escape codes
    expect(pieces.at(-1)).toMatch(/^\x1b_Gm=0;/);
    expect(pieces.map((p) => p.replace(/^[^;]*;/, "")).join("")).toBe(Buffer.from(png).toString("base64"));
    // eslint-disable-next-line no-control-regex -- the protocols' escape codes
    expect(inlineImage(png, "iterm", 80)).toMatch(/^\x1b\]1337;File=inline=1;size=5000;width=80;preserveAspectRatio=1:[A-Za-z0-9+/=]+\x07$/);
  });

  it("sizes the picture to the terminal: its columns less one, two a tile at most, a tall map no taller than wide", () => {
    expect(terminalWidth(128, 128, 100)).toBe(99);
    expect(terminalWidth(64, 64, 200)).toBe(128);
    expect(terminalWidth(64, 128, 100)).toBe(49);
    expect(terminalWidth(128, 128, 100, { width: 40 })).toBe(40);
    expect(terminalWidth(128, 128, 100, { scale: 0.5 })).toBe(64);
  });
});

describe("the picture", () => {
  const tileset = fakeTileset([200, 100, 50]);

  it("draws each tile's megatile at the scale asked, reduced by averaging; an id with no megatile is black", () => {
    const scn = createScenario({ width: 64, height: 64, era: 4, name: "t" });
    scn.tiles[1] = 1; // megatile 9: not in the table
    for (const scale of [1, 4, 32]) {
      const pic = terrainPicture(scn, tileset, scale);
      expect([pic.width, pic.height]).toEqual([64 * scale, 64 * scale]);
      expect([...pic.pixels.subarray(0, 4)]).toEqual([200, 100, 50, 255]);
      expect([...pic.pixels.subarray(scale * 4, scale * 4 + 4)]).toEqual([0, 0, 0, 255]);
    }
    expect(() => terrainPicture(scn, tileset, 3)).toThrow(/not one of/);
    const half = resizePicture(picture([["#000000", "#ffffff"], ["#000000", "#ffffff"]]), 1, 1);
    expect([...half.pixels]).toEqual([128, 128, 128, 255]);
  });

  it("puts a unit at map pixel x,y into the picture pixel and terminal cell it is in", () => {
    const scn = createScenario({ width: 64, height: 64, era: 4, name: "t" });
    scn.playerColors[2] = 7; // yellow
    scn.units.push(makeUnit(null, 0, 2, 40 * 32 + 16, 21 * 32 + 16, 1)); // a marine, P3, in tile (40, 21)
    scn.units.push(makeUnit(null, 176, 11, 10 * 32, 50 * 32, 2)); // a mineral field
    scn.units.push(makeUnit(null, 188, 11, 30 * 32, 50 * 32, 3)); // a geyser
    scn.units.push(makeUnit(null, START_LOCATION, 0, 8 * 32, 8 * 32, 4));
    const marks = placeMarks(scn, null, 1 / 32, 64, 64);
    expect(marks.map((m) => m.kind)).toEqual(["mineral", "geyser", "unit", "start"]);
    expect(marks[2]).toMatchObject({ x0: 40, y0: 21, x1: 41, y1: 22, color: "#fcfc38" });
    expect(marks[0].color).toBe(MINERAL_COLOR);
    expect(marks[1].color).toBe(GEYSER_COLOR);
    expect(marks[3].label).toBe("1");

    // At one pixel a tile, the marine is pixel (40, 21): column 40 of the terminal's line 10, the lower half.
    const drawn = mapPicture(scn, { tileset, units: null }, { scale: 1 });
    const at = (21 * 64 + 40) * 4;
    expect([...drawn.picture.pixels.subarray(at, at + 3)]).toEqual([0xfc, 0xfc, 0x38]);
    const line = halfBlocks(drawn.picture, drawn.marks, "truecolor")[10];
    const cells = line.split("▀");
    expect(cells[40]).toContain("48;2;252;252;56");
    expect(drawn.counts).toEqual({ starts: 1, buildings: 0, units: 1, minerals: 1, geysers: 1 });
    expect(mapPicture(scn, { tileset, units: null }, { scale: 1, marks: false }).marks).toEqual([]);

    // Fitted to a width: half a pixel a tile puts it at (20, 10).
    const small = mapPicture(scn, { tileset, units: null }, { width: 32 });
    expect([small.picture.width, small.picture.height, small.scale]).toEqual([32, 32, 0.5]);
    const m = small.marks.find((k) => k.kind === "unit")!;
    expect([m.x0, m.y0]).toEqual([20, 10]);
    expect(legendLine(small.marks, "none", true)).toBe("P1  P3  $ minerals  $ gas  numbers: start locations  # buildings, o units");
  });

  it("a PNG of the map at the scale asked", () => {
    const scn = createScenario({ width: 64, height: 96, era: 4, name: "t" });
    const { png, picture: pic } = previewPng(scn, { tileset, units: null }, { scale: 2 });
    expect([pic.width, pic.height]).toEqual([128, 192]);
    const ihdr = new DataView(chunks(png)[0].data.buffer, chunks(png)[0].data.byteOffset);
    expect([ihdr.getUint32(0), ihdr.getUint32(4)]).toEqual([128, 192]);
  });
});

describe("a 1.16.1 copy", () => {
  /** StarDat with the tileset, BrooDat with another palette over it — the game reads the later archive's. */
  function copy(): string {
    const dir = tmp();
    const stardat = new Creator({});
    for (const [ext, data] of Object.entries(fakeTilesetFiles([200, 100, 50]))) stardat.addFile(`tileset\\jungle.${ext}`, data);
    const broodat = new Creator({});
    broodat.addFile("tileset\\jungle.wpe", fakeTilesetFiles([1, 2, 3]).wpe);
    const patch = new Creator({});
    patch.addFile("readme.txt", new TextEncoder().encode("a patch with no tiles"));
    writeFileSync(join(dir, "StarDat.mpq"), stardat.write());
    writeFileSync(join(dir, "BrooDat.mpq"), broodat.write());
    writeFileSync(join(dir, "PATCH_RT.MPQ"), patch.write()); // any case: copies from old discs have capitals
    writeFileSync(join(dir, "Music.mpq"), new Uint8Array(4));
    return dir;
  }

  it("reads the tileset from the archives in the game's order, the later one winning", async () => {
    const dir = copy();
    expect(classicArchives(dir).map((p) => p.slice(dir.length + 1))).toEqual(["StarDat.mpq", "BrooDat.mpq", "PATCH_RT.MPQ"]);
    const files = archiveFiles(dir);
    expect(files.kind).toBe("classic");
    const tileset = await readTileset(files, "jungle");
    expect([...tileset.palette.subarray(20, 24)]).toEqual([1, 2, 3, 255]);
    expect(tileset.extended).toBe(false);
    expect(await readUnitsDat(files)).toBeNull();
    await expect(readTileset(files, "ice")).rejects.toThrow(/has no ice\.cv5/);
  });

  it("the command: checks its options before it looks for the game, and says when the folder is not a copy", async () => {
    const input: Input = { path: "x.scx", name: "x.scx", bytes: new Uint8Array(), kind: "map" };
    const map = { scenario: createScenario({ width: 64, height: 64, era: 4, name: "t" }), extras: new Map(), fileName: "x.scx" };
    const term = { columns: 80, depth: "none" as const, unicode: true, inline: null };
    const refused = async (o: Parameters<typeof previewMap>[2]) => previewMap(input, map, o, term).then(() => null, (e: CliError) => [e.exitCode, e.message]);
    expect(await refused({ out: "a.png", scale: "3" })).toEqual([2, '--scale takes 1, 2, 4, 8, 16, 32, not "3"']);
    expect(await refused({ out: "a.png", width: "80" })).toEqual([2, expect.stringMatching(/--width is the terminal/)]);
    expect(await refused({ width: "4" })).toEqual([2, expect.stringMatching(/--width takes/)]);
    expect(await refused({ starcraft: tmp() })).toEqual([1, expect.stringMatching(/is not a copy of StarCraft/)]);
    const ice = { ...map, scenario: createScenario({ width: 64, height: 64, era: 6, name: "t" }) };
    expect(await previewMap(input, ice, { starcraft: copy() }, term).catch((e: CliError) => e.message)).toMatch(/StarCraft 1\.16\.1 \(3 archives\) in .* has no ice\.cv5/);

    // A jungle map through the stand-in copy, end to end: the terminal form without colour is the shades.
    const shown = await previewMap(input, map, { starcraft: copy() }, term);
    expect(shown.report).toMatchObject({ tileset: "jungle", copy: { kind: "classic" }, picture: { form: "ascii", columns: 79, rows: 40, depth: "none" } });
    expect(shown.lines).toHaveLength(1 + 40); // the title and the picture; no legend for a map with nothing on it
    expect(shown.lines.slice(1).every((l) => !l.includes("\x1b"))).toBe(true);
  });
});

/** The copy of the game on this computer, if there is one (never on CI). */
const found = (() => { try { return findGameCopy(process.env.SCMJS_STARCRAFT); } catch { return null; } })();

describe.skipIf(!found)("the copy of the game on this computer", () => {
  it("draws a committed map from it, as a PNG and in the terminal", async () => {
    const files = await openGameFiles(undefined);
    expect(files.kind).toBe(found!.kind);
    const tileset = await readTileset(files, "badlands");
    expect(tileset.megatileCount).toBeGreaterThan(1000);
    expect((await readUnitsDat(files))?.placementWidth[106]).toBe(128); // the command centre

    const bytes = new Uint8Array(readFileSync(join(__dirname, "maps", "ums.scx")));
    const map = await openMapBytes(bytes, "ums.scx");
    const input: Input = { path: "ums.scx", name: "ums.scx", bytes, kind: "map" };
    const term = { columns: 80, depth: "truecolor" as const, unicode: true, inline: null };
    const shown = await previewMap(input, map, {}, term);
    expect(shown.report.picture).toMatchObject({ form: "blocks", columns: 79 });
    expect(shown.lines.length).toBe(1 + shown.report.picture.rows! + 1);

    const sink = new PassThrough();
    const got: Buffer[] = [];
    sink.on("data", (c: Buffer) => got.push(c));
    const written = await previewMap(input, map, { out: "-", scale: "2" }, term, sink);
    expect(written.report.out?.bytes).toBe(Buffer.concat(got).length);
    expect(written.report.picture).toMatchObject({ form: "png", width: 128, height: 128, scale: 2 });
    expect(written.report.drawn.starts).toBeGreaterThan(0);
  }, 20_000);
});
