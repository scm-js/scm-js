/** GRP, PCX and `.lo?` read and written; PNG, and a GRP as a PNG sheet against a named palette. */
import { readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeGrpImage, encodeGrpImage, encodeGrpLine, frameFromPicture, type GrpImage } from "../src/formats/dat/grpFile";
import { decodeGrp, drawGrpFrame } from "../src/formats/dat/grp";
import { decodePcxImage, encodePcxImage } from "../src/formats/dat/pcxFile";
import { decodePcx } from "../src/formats/dat/pcx";
import { decodeLoFile, encodeLoFile, loFromText, loToText } from "../src/formats/dat/loFile";
import { decodeLo } from "../src/formats/dat/lo";
import { decodePng, encodePng } from "../src/formats/png";
import { grpToPng, pngToGrp, sheetColumns } from "../src/formats/dat/grpPng";
import { cosmonarchyFile, cosmonarchyPath, gameFile, gameImagePaths, haveCosmonarchy, haveGameArchives, sameBytes } from "./support/modFiles";

/** A small grey ramp palette with a few named colours, made here (no game palette is committed). */
function testPalette() {
  const colours = new Uint8Array(768);
  for (let i = 0; i < 256; i++) colours.set([i, (i * 7) & 255, 255 - i], i * 3);
  return { name: "test ramp", colours };
}

function sampleGrp(): GrpImage {
  const w = 20, h = 12;
  const frame = (seed: number) => {
    const pic = new Uint8Array(w * h);
    for (let y = 2; y < 10; y++) for (let x = 3 + seed; x < 15; x++) pic[y * w + x] = x < 8 ? 9 : ((x * 13 + y * seed) % 200) + 1;
    return frameFromPicture(pic, w, h);
  };
  return { width: w, height: h, frames: [frame(0), frame(1), frame(0), frame(2)] };
}

describe("GRP", () => {
  it("writes lines the way the game's encoder does", () => {
    const out: number[] = [];
    encodeGrpLine(new Uint8Array([0, 0, 5, 5, 5, 5, 5, 7, 8, 9, 9, 9, 0]), out);
    expect(out).toEqual([0x82, 0x45, 5, 5, 7, 8, 9, 9, 9, 0x81]);
  });

  it("encodes frames that the editor's reader draws, and shares equal frames", () => {
    const grp = sampleGrp();
    const bytes = encodeGrpImage(grp);
    const read = decodeGrp(bytes);
    expect(read.frames[2].offset).toBe(read.frames[0].offset);
    expect(decodeGrpImage(bytes)).toEqual(grp);
    const rgba = new Uint8Array(grp.width * grp.height * 4);
    const pal = new Uint8Array(1024).fill(255);
    drawGrpFrame(read, 1, rgba, grp.width, 0, 0, pal);
    expect(rgba[(2 * grp.width + 4) * 4 + 3]).toBe(255);
    expect(rgba[3]).toBe(0);
    expect(sameBytes(encodeGrpImage(decodeGrpImage(bytes)), bytes)).toBe(true);
  });
});

describe("PCX", () => {
  it("writes an 8-bit image that the editor's reader reads", () => {
    const pixels = Uint8Array.from({ length: 7 * 3 }, (_, i) => (i < 9 ? 200 : i));
    const palette = Uint8Array.from({ length: 768 }, (_, i) => i & 255);
    const bytes = encodePcxImage({ width: 7, height: 3, pixels, palette });
    const read = decodePcx(bytes);
    expect(Array.from(read.pixels)).toEqual(Array.from(pixels));
    expect(read.palette).toEqual(palette);
    expect(sameBytes(encodePcxImage(decodePcxImage(bytes)), bytes)).toBe(true);
  });
});

describe(".lo?", () => {
  it("goes to PyLO text and back", () => {
    const lo = { frames: [[[1, -2], [127, 127]], [[-128, 5], [0, 0]]] as [number, number][][] };
    const text = loToText(lo);
    expect(text).toBe("Frame:\n    (1, -2)\n    (127, 127)\n\nFrame:\n    (-128, 5)\n    (0, 0)\n\n");
    const bytes = encodeLoFile(loFromText(text));
    expect(decodeLo(bytes).offsets).toEqual(new Int8Array([1, -2, 127, 127, -128, 5, 0, 0]));
    expect(() => loFromText("Frame:\n(1, 2)\nFrame:\n(1, 2)\n(3, 4)\n")).toThrow(/overlays/);
  });

  it("keeps a file's shared frames, in binary and through the text's note", () => {
    const bytes = new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 16, 0, 0, 0, 16, 0, 0, 0, 3, 4]);
    const lo = decodeLoFile(bytes);
    expect(sameBytes(encodeLoFile(lo), bytes)).toBe(true);
    expect(sameBytes(encodeLoFile(loFromText(loToText(lo))), bytes)).toBe(true);
    expect(encodeLoFile({ frames: lo.frames }).length).toBe(20);
  });
});

describe("PNG", () => {
  it("writes and reads RGBA and palette images", async () => {
    const rgba = Uint8Array.from({ length: 5 * 4 * 4 }, (_, i) => (i * 37) & 255);
    const png = await encodePng({ width: 5, height: 4, rgba, text: { note: "hi" } });
    const back = await decodePng(png);
    expect(back.rgba).toEqual(rgba);
    expect(back.text.note).toBe("hi");
    const pal = new Uint8Array(1024);
    for (let i = 0; i < 256; i++) pal.set([i, 0, 0, i ? 255 : 0], i * 4);
    const ip = await decodePng(await encodePng({ width: 3, height: 1, indices: new Uint8Array([0, 1, 255]), palette: pal }));
    expect(Array.from(ip.indexed!.indices)).toEqual([0, 1, 255]);
    expect(Array.from(ip.rgba.subarray(0, 8))).toEqual([0, 0, 0, 0, 1, 0, 0, 255]);
  });

  it("takes a GRP to a sheet and back unchanged, and quantises what is not the palette's", async () => {
    const pal = testPalette();
    const grp = sampleGrp();
    const bytes = encodeGrpImage(grp);
    const png = await grpToPng(bytes, pal);
    const sheet = await decodePng(png);
    expect([sheet.width, sheet.height]).toEqual([grp.width * sheetColumns(4), grp.height * 2]);
    const back = await pngToGrp(png, pal);
    expect(sameBytes(back.grp, bytes)).toBe(true);
    expect(back.report.pixelsChanged).toBe(0);
    // The same sheet as RGBA with one pixel nudged off the palette: it comes back to the nearest colour, reported.
    const rgba = sheet.rgba.slice();
    const at = ((3 * sheet.width) + 10) * 4;
    rgba[at] = Math.min(255, rgba[at] + 1);
    const nudged = await pngToGrp(await encodePng({ width: sheet.width, height: sheet.height, rgba, text: sheet.text }), pal);
    expect(nudged.report.pixelsChanged).toBe(1);
    expect(nudged.report.coloursLost).toHaveLength(1);
    const other = await pngToGrp(png, { ...pal, name: "another" });
    expect(other.report.paletteMismatch).toBe("test ramp");
  });
});

describe.skipIf(!haveGameArchives)("the game's pictures (fixtures/data)", () => {
  it("every GRP images.tbl names encodes back byte for byte", { timeout: 30_000 }, () => {
    let n = 0;
    for (const p of gameImagePaths().filter((x) => /\.grp$/i.test(x))) {
      const bytes = gameFile(p);
      if (!bytes) continue;
      n++;
      expect(sameBytes(encodeGrpImage(decodeGrpImage(bytes)), bytes), p).toBe(true);
    }
    expect(n).toBeGreaterThan(800);
  });

  it("every .lo? file comes back byte for byte, in binary and through PyLO text", () => {
    let n = 0;
    for (const p of gameImagePaths().filter((x) => /\.lo.$/i.test(x))) {
      const bytes = gameFile(p);
      if (!bytes) continue;
      n++;
      const lo = decodeLoFile(bytes);
      expect(sameBytes(encodeLoFile(lo), bytes), p).toBe(true);
      expect(sameBytes(encodeLoFile(loFromText(loToText(lo))), bytes), p).toBe(true);
    }
    expect(n).toBeGreaterThan(90);
  });

  it("the game's PCX files come back byte for byte", () => {
    const names = ["game\\tunit.pcx", "game\\tminimap.pcx", "game\\tselect.pcx", "game\\tblink.pcx", "game\\thpbar.pcx", "unit\\cmdbtns\\ticon.pcx", "glue\\title\\title.pcx",
      ...["badlands", "platform", "install", "AshWorld", "Jungle", "Desert", "Ice", "Twilight"].flatMap((t) => ["ofire", "gfire", "bfire", "bexpl"].map((n) => `tileset\\${t}\\${n}.pcx`))];
    let n = 0;
    for (const name of names) {
      const bytes = gameFile(name);
      if (!bytes) continue;
      n++;
      expect(sameBytes(encodePcxImage(decodePcxImage(bytes)), bytes), name).toBe(true);
    }
    expect(n).toBeGreaterThan(30);
  });

  it("a GRP goes to a PNG sheet against the units palette and back to the same bytes", { timeout: 30_000 }, async () => {
    const palette = { name: "tileset\\badlands.wpe", colours: gameFile("tileset\\badlands.wpe")! };
    for (const p of ["unit\\terran\\marine.grp", "unit\\zerg\\zergling.grp", "unit\\protoss\\carrier.grp"]) {
      const bytes = gameFile(p);
      if (!bytes) continue;
      const { grp, report } = await pngToGrp(await grpToPng(bytes, palette), palette);
      expect(sameBytes(grp, bytes), p).toBe(true);
      expect(report.pixelsChanged).toBe(0);
    }
  });
});

describe.skipIf(!haveCosmonarchy)("a mod's GRPs (SCMJS_COSMONARCHY)", () => {
  // Made by another encoder, so not byte for byte (162 of its 1,569 are; ours are 4% larger in all): the pictures must be the same.
  it("decode, and encode to the same pictures", () => {
    const dir = "release/mpq/unit/terran";
    const names = readdirSync(cosmonarchyPath(dir)).filter((n) => /\.grp$/i.test(n) && statSync(cosmonarchyPath(`${dir}/${n}`)).size < 200_000).slice(0, 15);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      const image = decodeGrpImage(cosmonarchyFile(`${dir}/${n}`));
      const again = decodeGrpImage(encodeGrpImage(image));
      expect(again.frames.length, n).toBe(image.frames.length);
      again.frames.forEach((f, i) => {
        const was = image.frames[i];
        expect([f.x, f.y, f.width, f.height], n).toEqual([was.x, was.y, was.width, was.height]);
        expect(sameBytes(f.pixels, was.pixels), `${n} frame ${i}`).toBe(true);
      });
    }
  }, 30_000);
});
