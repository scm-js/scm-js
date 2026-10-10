// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { atlasSource, atlasTileSize, type TilesetAtlas } from "../src/formats/tileset/atlas";
import {
  buildHdEffects, decodeDxt1, decodeHdCell, decodeRawDds, HD_GUTTER, HD_TILE_PX, looksLikeHdTiles, parseDdsGrp, parseHdTiles, parseTileMasks,
} from "../src/formats/tileset/hd";
import {
  ensureTileset, hdTerrainMissing, peekTileset, primeTileset, releaseTileset, retryTilesetParts, setHdTerrain, tilesetSettled, type LoadedTileset,
} from "../src/formats/tileset/load";
import { extractTilesets } from "../src/gamedata/extract";
import { adoptStoredCopy, resetAssetSource } from "../src/gamedata/source";
import { clearStoredCopy, keepInMemory } from "../src/gamedata/store";

/* ── A 2x tile file, built from the format ──────────────── */

const le16 = (v: number) => [v & 255, (v >> 8) & 255];
const le32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const rgb565 = (r: number, g: number, b: number) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);

/** A DXT1 block: two colours and sixteen 2-bit picks, row by row from the top left. */
function block(c0: number, c1: number, picks: number[]): number[] {
  let bits = 0;
  picks.forEach((k, i) => { bits |= k << (i * 2); });
  return [...le16(c0), ...le16(c1), ...le32(bits >>> 0)];
}

/** One 64 × 64 picture as a whole DDS file, every block the same. */
function dds(blockBytes: number[], fourcc = "DXT1", size = HD_TILE_PX): Uint8Array {
  const header = new Uint8Array(128);
  header.set([0x44, 0x44, 0x53, 0x20, ...le32(124)], 0);
  header.set(le32(size), 12);
  header.set(le32(size), 16);
  header.set([...fourcc].map((c) => c.charCodeAt(0)), 84);
  const body: number[] = [];
  for (let i = 0; i < (size / 4) * (size / 4); i++) body.push(...blockBytes);
  return new Uint8Array([...header, ...body]);
}

/** A `.dds.vr4`: size, count, version, then each picture behind its twelve-byte header. */
function hdFile(pictures: Uint8Array[], size = HD_TILE_PX): Uint8Array {
  const parts: number[] = [];
  for (const picture of pictures) parts.push(...le32(0), ...le16(size), ...le16(size), ...le32(picture.length), ...picture);
  return new Uint8Array([...le32(8 + parts.length), ...le16(pictures.length), ...le16(0x1002), ...parts]);
}

/** Sixteen picks of a block's first colour. */
const FIRST = Array.from({ length: 16 }, () => 0);
const RED = rgb565(255, 0, 0), BLUE = rgb565(0, 0, 255);
const solid = (colour: number) => dds(block(colour, colour, FIRST));

describe("DXT1", () => {
  it("decodes the two stored colours and the two between them", () => {
    // c0 > c1: picks 2 and 3 are the thirds between the two.
    const bytes = new Uint8Array(block(rgb565(255, 255, 255), rgb565(0, 0, 0), [0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const out = new Uint8ClampedArray(4 * 4 * 4);
    decodeDxt1(bytes, 0, 4, 4, out, 4, 0, 0);
    expect([...out.subarray(0, 16)]).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 170, 170, 170, 255, 85, 85, 85, 255]);
  });

  it("takes the midpoint, and black, when the first colour is not the larger", () => {
    const bytes = new Uint8Array(block(rgb565(0, 0, 0), rgb565(255, 255, 255), [0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    const out = new Uint8ClampedArray(4 * 4 * 4);
    decodeDxt1(bytes, 0, 4, 4, out, 4, 0, 0);
    expect([...out.subarray(0, 16)]).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 127, 127, 127, 255, 0, 0, 0, 255]);
  });

  it("writes each block where it belongs in a wider picture", () => {
    // Two blocks side by side, red then blue, into a 12-wide buffer at (2, 1).
    const bytes = new Uint8Array([...block(RED, RED, FIRST), ...block(BLUE, BLUE, FIRST)]);
    const out = new Uint8ClampedArray(12 * 6 * 4);
    decodeDxt1(bytes, 0, 8, 4, out, 12, 2, 1);
    const at = (x: number, y: number) => [...out.subarray((y * 12 + x) * 4, (y * 12 + x) * 4 + 4)];
    expect(at(2, 1)).toEqual([255, 0, 0, 255]);
    expect(at(5, 4)).toEqual([255, 0, 0, 255]);
    expect(at(6, 1)).toEqual([0, 0, 255, 255]);
    expect(at(9, 4)).toEqual([0, 0, 255, 255]);
    expect(at(1, 1)).toEqual([0, 0, 0, 0]);
    expect(at(2, 0)).toEqual([0, 0, 0, 0]);
    expect(at(10, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe("a 2x tile file", () => {
  it("lists where each megatile's pixels are", () => {
    const file = parseHdTiles(hdFile([solid(RED), solid(BLUE), solid(RED)]))!;
    expect(file.count).toBe(3);
    const picture = 128 + 16 * 16 * 8;
    expect([...file.offsets]).toEqual([8 + 12 + 128, 8 + 12 + picture + 12 + 128, 8 + 2 * (12 + picture) + 12 + 128]);
  });

  it("is refused when it is something else", () => {
    const html = new TextEncoder().encode("<!doctype html><html><head></head><body>" + "x".repeat(200) + "</body></html>");
    expect(looksLikeHdTiles(html)).toBe(false);
    expect(parseHdTiles(html)).toBeNull();
    expect(parseHdTiles(new Uint8Array(4))).toBeNull();
    // Pictures of another size, another compression, or a file cut short.
    expect(parseHdTiles(hdFile([dds(block(RED, RED, FIRST), "DXT1", 128)], 128))).toBeNull();
    expect(parseHdTiles(hdFile([dds(block(RED, RED, FIRST), "DXT5")]))).toBeNull();
    const whole = hdFile([solid(RED), solid(BLUE)]);
    expect(parseHdTiles(whole.subarray(0, whole.length - 10))).toBeNull();
    expect(looksLikeHdTiles(whole)).toBe(true);
  });

  it("decodes a megatile with its own edges repeated into the gutter", () => {
    // Left half red, right half blue: the gutter must take the colour of the side it is on.
    const half: number[] = [];
    for (let by = 0; by < 16; by++) for (let bx = 0; bx < 16; bx++) half.push(...block(bx < 8 ? RED : BLUE, bx < 8 ? RED : BLUE, FIRST));
    const header = dds([]).subarray(0, 128);
    const file = parseHdTiles(hdFile([new Uint8Array([...header, ...half])]))!;
    const pitch = HD_TILE_PX + 2 * HD_GUTTER;
    const out = new Uint8ClampedArray(pitch * pitch * 4);
    decodeHdCell(file, 0, out);
    const at = (x: number, y: number) => [...out.subarray((y * pitch + x) * 4, (y * pitch + x) * 4 + 3)];
    expect(at(HD_GUTTER, HD_GUTTER)).toEqual([255, 0, 0]);
    expect(at(pitch - HD_GUTTER - 1, HD_GUTTER)).toEqual([0, 0, 255]);
    for (let y = 0; y < pitch; y++) {
      expect(at(0, y), `left gutter row ${y}`).toEqual([255, 0, 0]);
      expect(at(pitch - 1, y), `right gutter row ${y}`).toEqual([0, 0, 255]);
    }
    for (let x = HD_GUTTER; x < pitch / 2; x++) expect(at(x, 0)).toEqual([255, 0, 0]);
    // Every pixel is opaque, gutter included.
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
  });
});

describe("the classic atlas, asked where a megatile is", () => {
  const atlas = { image: {} as CanvasImageSource, columns: 64, tileSize: 32, count: 100, averages: new Uint32Array(100), animation: null } as TilesetAtlas;

  it("answers at 32 pixels a tile", () => {
    expect(atlasTileSize(atlas)).toBe(32);
    expect(atlasSource(atlas, 5)).toMatchObject({ size: 32, animated: false });
  });

  it("answers at 64 once it carries 2x pictures, and falls back for a megatile they lack", () => {
    const file = parseHdTiles(hdFile([solid(RED), solid(BLUE)]))!;
    const hd = { file, tileSize: HD_TILE_PX, pages: [], slot: new Int32Array(2).fill(-1), used: 0, scratch: null };
    const withHd = { ...atlas, hd };
    expect(atlasTileSize(withHd)).toBe(64);
    // No canvas in this environment and megatile 7 is past the file: both draw the classic picture.
    expect(atlasSource(withHd, 7).size).toBe(32);
    expect(atlasSource(withHd, 1).size).toBe(32);
  });
});

/* ── The loader's two answers ───────────────────────────── */

const stamp = { from: "test", at: "2026-10-09T00:00:00.000Z", files: 1, bytes: 1, summary: "test" };
const fakeTileset = (name: LoadedTileset["name"], megatileCount: number): LoadedTileset => ({
  name,
  tileset: { megatileCount } as never,
  atlas: { image: {}, columns: 64, tileSize: 32, count: megatileCount, averages: new Uint32Array(megatileCount), animation: null } as never,
  doodads: {} as never,
});

describe("Remastered terrain in the tileset loader", () => {
  const serve = (files: Record<string, Uint8Array>) => {
    keepInMemory(new Map(Object.entries(files)), stamp);
    adoptStoredCopy({ ...stamp, where: "memory" });
  };

  afterEach(async () => {
    setHdTerrain(false);
    for (const name of ["ice", "jungle", "desert"] as const) releaseTileset(name);
    await clearStoredCopy();
    resetAssetSource();
  });

  it("hands out the classic tileset until the option is on, then a variant carrying the 2x pictures", async () => {
    serve({ "tileset/ice.hd.vr4": hdFile([solid(RED), solid(BLUE), solid(RED)]) });
    const classic = fakeTileset("ice", 3);
    primeTileset(classic);
    expect(await ensureTileset("ice")).toBe(classic);
    expect(tilesetSettled("ice")).toBe(true);

    expect(setHdTerrain(true)).toBe(true);
    expect(setHdTerrain(true)).toBe(false);
    // Asked for but not fetched yet: the classic one still answers, and says it is not final.
    expect(peekTileset("ice")).toBe(classic);
    expect(tilesetSettled("ice")).toBe(false);

    const hd = await ensureTileset("ice");
    expect(hd).not.toBe(classic);
    expect(hd.tileset).toBe(classic.tileset);
    expect(hd.doodads).toBe(classic.doodads);
    expect(atlasTileSize(hd.atlas)).toBe(64);
    expect(peekTileset("ice")).toBe(hd);
    expect(await ensureTileset("ice")).toBe(hd);
    expect(hdTerrainMissing("ice")).toBe(false);

    // Off again: the classic object, the same one as before, with no fetch.
    setHdTerrain(false);
    expect(peekTileset("ice")).toBe(classic);
    setHdTerrain(true);
    expect(peekTileset("ice")).toBe(hd);
  });

  it("stays classic, and says so, when the data set has no 2x file", async () => {
    serve({ "tileset/other.bin": new Uint8Array(1) });
    const classic = fakeTileset("jungle", 3);
    primeTileset(classic);
    setHdTerrain(true);
    expect(await ensureTileset("jungle")).toBe(classic);
    expect(hdTerrainMissing("jungle")).toBe(true);
    expect(tilesetSettled("jungle")).toBe(true);
    expect(peekTileset("jungle")).toBe(classic);
  });

  it("asks again after new game data is installed", async () => {
    serve({ "tileset/other.bin": new Uint8Array(1) });
    const classic = fakeTileset("jungle", 2);
    primeTileset(classic);
    setHdTerrain(true);
    await ensureTileset("jungle");
    expect(hdTerrainMissing("jungle")).toBe(true);

    serve({ "tileset/jungle.hd.vr4": hdFile([solid(RED), solid(BLUE)]) });
    retryTilesetParts();
    expect(hdTerrainMissing("jungle")).toBe(false);
    expect(atlasTileSize((await ensureTileset("jungle")).atlas)).toBe(64);
  });

  it("refuses 2x pictures that are fewer than the tileset's megatiles", async () => {
    // A file from other tile tables: its numbering is not this tileset's.
    serve({ "tileset/desert.hd.vr4": hdFile([solid(RED), solid(BLUE)]) });
    const classic = fakeTileset("desert", 5);
    primeTileset(classic);
    setHdTerrain(true);
    expect(await ensureTileset("desert")).toBe(classic);
    expect(hdTerrainMissing("desert")).toBe(true);
  });

  it("forgets the variant with the tileset", async () => {
    serve({ "tileset/ice.hd.vr4": hdFile([solid(RED)]) });
    primeTileset(fakeTileset("ice", 1));
    setHdTerrain(true);
    await ensureTileset("ice");
    releaseTileset("ice");
    expect(peekTileset("ice")).toBeNull();
    const again = fakeTileset("ice", 1);
    primeTileset(again);
    expect(peekTileset("ice")).toBe(again);
    expect(tilesetSettled("ice")).toBe(false);
  });
});

describe("extracting the 2x tile files", () => {
  it("takes them where the source has them and leaves a tileset complete without", () => {
    const files: Record<string, Uint8Array> = { "hd2\\tileset\\ice.dds.vr4": hdFile([solid(RED)]) };
    for (const ext of ["cv5", "vf4", "vr4", "wpe", "vx4ex"]) for (const name of ["ice", "jungle"]) files[`tileset\\${name}.${ext}`] = new Uint8Array(4);
    const { files: out, manifest, complete } = extractTilesets((member) => files[member.toLowerCase()] ?? null);
    expect(out.has("tileset/ice.hd.vr4")).toBe(true);
    expect(out.has("tileset/jungle.hd.vr4")).toBe(false);
    expect(complete.sort()).toEqual(["ice", "jungle"]);
    expect((manifest.ice as { files: string[] }).files).toContain("hd.vr4");
    expect((manifest.jungle as { files: string[] }).files).not.toContain("hd.vr4");
  });
});

/* ── Water and lava ─────────────────────────────────────── */

/** A `.tmsk`: 'KSMT', version 1, a count, then megatile and mask number pairs. */
const tmsk = (pairs: [number, number][]) => new Uint8Array([0x4b, 0x53, 0x4d, 0x54, ...le16(1), ...le16(pairs.length), ...pairs.flatMap(([megatile, mask]) => [...le16(megatile), ...le16(mask)])]);

/** A picture of any square size, every block one colour, wrapped as a `.dds.grp` would hold it. */
describe("the files that say where water and lava are", () => {
  it("reads the table from megatile to mask", () => {
    const table = parseTileMasks(tmsk([[49, 455], [50, 456], [4841, 3]]))!;
    expect([...table]).toEqual([[49, 455], [50, 456], [4841, 3]]);
  });

  it("refuses a table that is something else or is cut short", () => {
    expect(parseTileMasks(new TextEncoder().encode("<!doctype html>"))).toBeNull();
    const whole = tmsk([[1, 2], [3, 4]]);
    expect(parseTileMasks(whole.subarray(0, whole.length - 2))).toBeNull();
    expect(parseTileMasks(tmsk([]))!.size).toBe(0);
  });

  it("lists the pictures of a ripple file, whatever their size", () => {
    // Each picture carries its own size in its header; the two ripple files are 64 and 256 square.
    const one = (size: number) => { const picture = dds(block(RED, RED, FIRST), "DXT1", size); return [...le32(0), ...le16(size), ...le16(size), ...le32(picture.length), ...picture]; };
    const body = [...one(64), ...one(256), ...one(64)];
    const bytes = new Uint8Array([...le32(8 + body.length), ...le16(3), ...le16(0x1002), ...body]);
    const pictures = parseDdsGrp(bytes)!;
    expect(pictures.map((p) => [p.width, p.height, p.size])).toEqual([[64, 64, 2048], [256, 256, 32768], [64, 64, 2048]]);
    expect(pictures[0].data).toBe(8 + 12 + 128);
    expect(pictures[1].data).toBe(8 + 12 + 128 + 2048 + 12 + 128);
    expect(parseDdsGrp(bytes.subarray(0, bytes.length - 4))).toBeNull();
    expect(parseDdsGrp(new Uint8Array(8))).toBeNull();
  });

  it("reads the heat's noise as the bytes it is, and nothing compressed", () => {
    const header = new Uint8Array(128);
    header.set([0x44, 0x44, 0x53, 0x20, ...le32(124)], 0);
    header.set(le32(2), 12);
    header.set(le32(2), 16);
    header.set(le32(0x41), 80); // uncompressed, with alpha
    header.set(le32(32), 88);
    header.set(le32(0xff), 92);
    const pixels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const noise = decodeRawDds(new Uint8Array([...header, ...pixels]))!;
    expect([noise.width, noise.height, [...noise.rgba]]).toEqual([2, 2, pixels]);
    expect(decodeRawDds(solid(RED))).toBeNull();
    expect(decodeRawDds(new Uint8Array([...header, 1, 2, 3]))).toBeNull();
  });
});

describe("a tileset's moving water or lava", () => {
  const masks = parseHdTiles(hdFile([solid(RED), solid(BLUE)]))!;
  const water = { large: { bytes: new Uint8Array(1), pictures: [] }, fine: { bytes: new Uint8Array(1), pictures: [] } };

  it("maps each megatile to its mask and leaves the rest still", () => {
    const effects = buildHdEffects("water", 10, new Map([[3, 1], [7, 0]]), masks, water)!;
    expect(effects.kind).toBe("water");
    expect([...effects.maskOf]).toEqual([-1, -1, -1, 1, -1, -1, -1, 0, -1, -1]);
  });

  it("drops a megatile this tileset does not have and a mask the file does not hold", () => {
    const effects = buildHdEffects("water", 5, new Map([[2, 0], [9, 0], [4, 7]]), masks, water)!;
    expect([...effects.maskOf]).toEqual([-1, -1, 0, -1, -1]);
    expect(buildHdEffects("water", 5, new Map([[9, 0]]), masks, water)).toBeNull();
  });

  it("is nothing without the textures its kind is read from", () => {
    const table = new Map([[1, 0]]);
    expect(buildHdEffects("heat", 5, table, masks, water)).toBeNull();
    expect(buildHdEffects("water", 5, table, masks, { noise: { width: 1, height: 1, rgba: new Uint8Array(4) } })).toBeNull();
    expect(buildHdEffects("heat", 5, table, masks, { noise: { width: 1, height: 1, rgba: new Uint8Array(4) } })!.kind).toBe("heat");
  });
});

describe("the tileset loader, with the effect files in the copy", () => {
  const serve = (files: Record<string, Uint8Array>) => {
    keepInMemory(new Map(Object.entries(files)), stamp);
    adoptStoredCopy({ ...stamp, where: "memory" });
  };
  const ripple = () => { const picture = dds(block(RED, RED, FIRST)); return new Uint8Array([...le32(0), ...le16(1), ...le16(0x1002), ...le32(0), ...le16(64), ...le16(64), ...le32(picture.length), ...picture]); };
  const noiseFile = () => { const h = new Uint8Array(128 + 4); h.set([0x44, 0x44, 0x53, 0x20], 0); h.set(le32(1), 12); h.set(le32(1), 16); h.set(le32(0x41), 80); h.set(le32(32), 88); h.set(le32(0xff), 92); return h; };

  afterEach(async () => {
    setHdTerrain(false);
    for (const name of ["ice", "ashworld", "jungle"] as const) releaseTileset(name);
    retryTilesetParts();
    await clearStoredCopy();
    resetAssetSource();
  });

  it("gives a water tileset its ripples and Ashworld its heat", async () => {
    serve({
      "tileset/ice.hd.vr4": hdFile([solid(RED), solid(BLUE), solid(RED)]),
      "tileset/ice.hd.tmsk": tmsk([[1, 0]]),
      "tileset/ice.hd.mask": hdFile([solid(RED)]),
      "tileset/ashworld.hd.vr4": hdFile([solid(RED), solid(BLUE)]),
      "tileset/ashworld.hd.tmsk": tmsk([[0, 0], [1, 0]]),
      "tileset/ashworld.hd.mask": hdFile([solid(RED)]),
      "tileset/water_large.hd.grp": ripple(),
      "tileset/water_fine.hd.grp": ripple(),
      "tileset/heat_noise.hd.dds": noiseFile(),
    });
    primeTileset(fakeTileset("ice", 3));
    primeTileset(fakeTileset("ashworld", 2));
    setHdTerrain(true);
    const ice = (await ensureTileset("ice")).atlas.hd!.effects!;
    expect(ice.kind).toBe("water");
    expect([...ice.maskOf]).toEqual([-1, 0, -1]);
    expect(ice.textures.large!.pictures).toHaveLength(1);
    const ash = (await ensureTileset("ashworld")).atlas.hd!.effects!;
    expect(ash.kind).toBe("heat");
    expect([...ash.maskOf]).toEqual([0, 0]);
    expect(ash.textures.noise!.width).toBe(1);
  });

  it("leaves the terrain still, and still drawn at 2x, when the copy has no effect files", async () => {
    serve({ "tileset/jungle.hd.vr4": hdFile([solid(RED), solid(BLUE)]) });
    primeTileset(fakeTileset("jungle", 2));
    setHdTerrain(true);
    const jungle = await ensureTileset("jungle");
    expect(atlasTileSize(jungle.atlas)).toBe(64);
    expect(jungle.atlas.hd!.effects).toBeNull();
  });
});

describe("extracting the effect files", () => {
  it("takes the mask table and masks per tileset, and the shared textures once", () => {
    const files: Record<string, Uint8Array> = {
      "hd2\\tileset\\ice.tmsk": tmsk([[1, 0]]),
      "hd2\\tileset\\ice_mask.dds.grp": hdFile([solid(RED)]),
      "hd2\\effect\\water_normal_1.dds.grp": new Uint8Array(3),
      "hd2\\effect\\water_normal_2.dds.grp": new Uint8Array(4),
      "hd2\\effect\\noise.dds": new Uint8Array(5),
    };
    const { files: out, manifest } = extractTilesets((member) => files[member.toLowerCase()] ?? null);
    expect(out.has("tileset/ice.hd.tmsk")).toBe(true);
    expect(out.has("tileset/ice.hd.mask")).toBe(true);
    expect(out.has("tileset/jungle.hd.tmsk")).toBe(false);
    expect(out.get("tileset/water_large.hd.grp")!.length).toBe(3);
    expect(out.get("tileset/water_fine.hd.grp")!.length).toBe(4);
    expect(out.get("tileset/heat_noise.hd.dds")!.length).toBe(5);
    expect(manifest.shared).toEqual(["water_large.hd.grp", "water_fine.hd.grp", "heat_noise.hd.dds"]);
  });
});
