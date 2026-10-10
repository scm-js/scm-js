// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ANIM_VERSION_HD2, animMember, animPath, isAnim, parseAnim, slimAnim } from "../src/formats/dat/anim";
import { decodeDxtRect, parseDds } from "../src/formats/dds";

/* ── Files built from the formats ───────────────────────── */

const le16 = (v: number) => [v & 255, (v >> 8) & 255];
const le32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const rgb565 = (r: number, g: number, b: number) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);

/** Sixteen 2-bit colour picks, all the block's first colour unless given. */
const colourBlock = (c0: number, c1: number, picks: number[] = Array.from({ length: 16 }, () => 0)) => {
  let bits = 0;
  picks.forEach((k, i) => { bits |= k << (i * 2); });
  return [...le16(c0), ...le16(c1), ...le32(bits >>> 0)];
};
/** A DXT5 alpha block: two alphas and sixteen 3-bit picks. */
const alphaBlock = (a0: number, a1: number, picks: number[]) => {
  let lo = 0, hi = 0;
  picks.forEach((k, i) => { if (i < 8) lo |= k << (i * 3); else hi |= k << ((i - 8) * 3); });
  return [a0, a1, lo & 255, (lo >> 8) & 255, (lo >> 16) & 255, hi & 255, (hi >> 8) & 255, (hi >> 16) & 255];
};

function dds(fourcc: string, width: number, height: number, blocks: number[][]): Uint8Array {
  const header = new Uint8Array(128);
  header.set([0x44, 0x44, 0x53, 0x20, ...le32(124)], 0);
  header.set(le32(height), 12);
  header.set(le32(width), 16);
  header.set([...fourcc].map((c) => c.charCodeAt(0)), 84);
  return new Uint8Array([...header, ...blocks.flat()]);
}

const RED = rgb565(255, 0, 0), GREEN = rgb565(0, 255, 0), BLUE = rgb565(0, 0, 255), WHITE = rgb565(255, 255, 255);
const OPAQUE = Array.from({ length: 16 }, () => 0);

/** An anim as the game writes one: every named layer in the table, the frame table after the pictures. */
function anim(layers: { name: string; picture: Uint8Array | null; width: number; height: number }[], frames: number[][], box = [32, 16]): Uint8Array {
  const names = new Uint8Array(320);
  layers.forEach((l, i) => names.set([...l.name].map((c) => c.charCodeAt(0)), i * 32));
  const head = 12 + 320 + 12 + layers.length * 12;
  let at = head;
  const table: number[] = [];
  const data: number[] = [];
  for (const l of layers) {
    if (!l.picture) { table.push(...le32(0), ...le32(0), ...le16(0), ...le16(0)); continue; }
    table.push(...le32(at), ...le32(l.picture.length), ...le16(l.width), ...le16(l.height));
    data.push(...l.picture);
    at += l.picture.length;
  }
  const frameBytes = frames.flatMap((f) => [...le16(f[0]), ...le16(f[1]), ...le16(f[2] & 0xffff), ...le16(f[3] & 0xffff), ...le16(f[4]), ...le16(f[5]), 0, 0, 0, 0]);
  return new Uint8Array([
    0x41, 0x4e, 0x49, 0x4d, ...le16(ANIM_VERSION_HD2), 0, 0, ...le16(layers.length), ...le16(1),
    ...names,
    ...le16(frames.length), 0xff, 0xff, ...le16(box[0]), ...le16(box[1]), ...le32(at),
    ...table, ...data, ...frameBytes,
  ]);
}

const picture = (fourcc: "DXT1" | "DXT5", colour: number) =>
  dds(fourcc, 8, 4, [0, 1].map(() => (fourcc === "DXT5" ? [...alphaBlock(255, 0, OPAQUE), ...colourBlock(colour, colour)] : colourBlock(colour, colour))));

const GAME_LAYERS = ["diffuse", "bright", "teamcolor", "emissive", "normal", "specular", "ao_depth"];
const fullAnim = () => anim(
  GAME_LAYERS.map((name) => ({
    name,
    picture: name === "emissive" ? null : picture(name === "teamcolor" || name === "specular" ? "DXT1" : "DXT5", name === "diffuse" ? RED : name === "teamcolor" ? WHITE : GREEN),
    width: 8,
    height: 4,
  })),
  // x, y, offset x, offset y, width, height — in 4x pixels, as the files keep them
  [[0, 0, 6, 2, 8, 8], [8, 0, -3, 5, 7, 5]],
);

describe("a DDS picture", () => {
  it("is recognised with its size and where its blocks start", () => {
    const bytes = new Uint8Array([9, 9, 9, ...picture("DXT5", RED)]);
    expect(parseDds(bytes, 3, bytes.length - 3)).toEqual({ width: 8, height: 4, format: "DXT5", data: 3 + 128 });
  });

  it("is refused when it is not one, is another compression, or is cut short", () => {
    const good = picture("DXT1", RED);
    expect(parseDds(new Uint8Array(200), 0, 200)).toBeNull();
    expect(parseDds(dds("DXT3", 8, 4, [colourBlock(RED, RED), colourBlock(RED, RED)]), 0, 144)).toBeNull();
    expect(parseDds(good, 0, good.length - 1)).toBeNull();
    expect(parseDds(good, 0, good.length)).not.toBeNull();
  });

  it("decodes only the rectangle asked for, across block edges", () => {
    // Two blocks side by side: red, then blue.
    const bytes = dds("DXT1", 8, 4, [colourBlock(RED, RED), colourBlock(BLUE, BLUE)]);
    const image = parseDds(bytes, 0, bytes.length)!;
    const out = new Uint8ClampedArray(4 * 2 * 4);
    decodeDxtRect(bytes, image, 2, 1, 4, 2, out);
    const px = (x: number, y: number) => [...out.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4)];
    expect(px(0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(1, 1)).toEqual([255, 0, 0, 255]);
    expect(px(2, 0)).toEqual([0, 0, 255, 255]);
    expect(px(3, 1)).toEqual([0, 0, 255, 255]);
  });

  it("leaves what lies outside the picture alone", () => {
    const bytes = dds("DXT1", 4, 4, [colourBlock(GREEN, GREEN)]);
    const out = new Uint8ClampedArray(6 * 6 * 4).fill(7);
    decodeDxtRect(bytes, parseDds(bytes, 0, bytes.length)!, 2, 2, 6, 6, out);
    expect([...out.subarray(0, 4)]).toEqual([0, 255, 0, 255]);
    expect([...out.subarray((1 * 6 + 1) * 4, (1 * 6 + 1) * 4 + 4)]).toEqual([0, 255, 0, 255]);
    expect([...out.subarray(2 * 4, 2 * 4 + 4)]).toEqual([7, 7, 7, 7]);
    expect([...out.subarray(2 * 6 * 4, 2 * 6 * 4 + 4)]).toEqual([7, 7, 7, 7]);
  });

  it("reads DXT5's alpha: the two stored values, the steps between, and the 0 and 255 of the short form", () => {
    // a0 > a1: six steps between. Picks 0 and 1 are the stored two, 2 is one step from a0, 7 one from a1.
    const long = dds("DXT5", 4, 4, [[...alphaBlock(210, 0, [0, 1, 2, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]), ...colourBlock(RED, RED)]]);
    const out = new Uint8ClampedArray(64);
    decodeDxtRect(long, parseDds(long, 0, long.length)!, 0, 0, 4, 4, out);
    expect([out[3], out[7], out[11], out[15]]).toEqual([210, 0, 180, 30]);
    expect(out[63]).toBe(150);
    expect([...out.subarray(0, 3)]).toEqual([255, 0, 0]);

    // a0 <= a1: four steps, then 0 and 255 outright.
    const short = dds("DXT5", 4, 4, [[...alphaBlock(0, 100, [0, 1, 2, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...colourBlock(RED, RED)]]);
    decodeDxtRect(short, parseDds(short, 0, short.length)!, 0, 0, 4, 4, out);
    expect([out[3], out[7], out[11], out[15], out[19]]).toEqual([0, 100, 20, 0, 255]);
  });

  it("gives DXT1's fourth colour as transparent black only when the first colour is not the larger", () => {
    const picks = [3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const out = new Uint8ClampedArray(64);
    const transparent = dds("DXT1", 4, 4, [colourBlock(BLUE, WHITE, picks)]);
    decodeDxtRect(transparent, parseDds(transparent, 0, transparent.length)!, 0, 0, 4, 4, out);
    expect([...out.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    const opaque = dds("DXT1", 4, 4, [colourBlock(WHITE, BLUE, picks)]);
    decodeDxtRect(opaque, parseDds(opaque, 0, opaque.length)!, 0, 0, 4, 4, out);
    expect(out[3]).toBe(255);
    expect([...out.subarray(0, 3)]).toEqual([85, 85, 255]);
  });
});

describe("a 2x sprite file", () => {
  it("is read into its box, its layers and its frames, halved from the 4x table", () => {
    const bytes = fullAnim();
    expect(isAnim(bytes)).toBe(true);
    const parsed = parseAnim(bytes)!;
    expect([parsed.width, parsed.height]).toEqual([16, 8]);
    expect(parsed.layers.map((l) => l.name)).toEqual(GAME_LAYERS);
    expect(parsed.layers.find((l) => l.name === "emissive")!.size).toBe(0);
    expect(parsed.frames[0]).toEqual({ x: 0, y: 0, width: 4, height: 4, offsetX: 3, offsetY: 1 });
    // Odd edges: the half pixel belongs to the frame, and an offset can sit on one.
    expect(parsed.frames[1]).toEqual({ x: 4, y: 0, width: 4, height: 3, offsetX: -1.5, offsetY: 2.5 });
    // Each layer's picture is where the table says it is.
    const diffuse = parsed.layers[0];
    expect(parseDds(bytes, diffuse.offset, diffuse.size)).toMatchObject({ width: 8, height: 4, format: "DXT5" });
  });

  it("is refused when it is something else or points outside itself", () => {
    const bytes = fullAnim();
    expect(parseAnim(new TextEncoder().encode("<!doctype html>" + " ".repeat(400)))).toBeNull();
    expect(parseAnim(bytes.subarray(0, bytes.length - 8))).toBeNull();
    const fourTimes = bytes.slice();
    fourTimes[4] = 0x04; // the 4x files: same layout, not read
    expect(isAnim(fourTimes)).toBe(false);
  });

  it("is cut down to the colour picture and the team mask, with the same frames", () => {
    const bytes = fullAnim();
    const slim = slimAnim(bytes);
    const before = parseAnim(bytes)!, after = parseAnim(slim)!;
    // Smaller by exactly the pictures dropped: the header and both tables are kept whole.
    const dropped = before.layers.filter((l) => l.name !== "diffuse" && l.name !== "teamcolor").reduce((n, l) => n + l.size, 0);
    expect(dropped).toBeGreaterThan(0);
    expect(slim.length).toBe(bytes.length - dropped);
    expect(after.frames).toEqual(before.frames);
    expect([after.width, after.height]).toEqual([before.width, before.height]);
    expect(after.layers.map((l) => l.name)).toEqual(GAME_LAYERS);
    expect(after.layers.filter((l) => l.size > 0).map((l) => l.name)).toEqual(["diffuse", "teamcolor"]);
    // The two pictures kept are the same bytes.
    for (const name of ["diffuse", "teamcolor"]) {
      const a = before.layers.find((l) => l.name === name)!, b = after.layers.find((l) => l.name === name)!;
      expect(Buffer.compare(slim.subarray(b.offset, b.offset + b.size), bytes.subarray(a.offset, a.offset + a.size)), name).toBe(0);
      expect([b.width, b.height]).toEqual([a.width, a.height]);
    }
  });

  it("is left as it is when already cut down, or when it is not a sprite file", () => {
    const slim = slimAnim(fullAnim());
    expect(slimAnim(slim)).toBe(slim);
    const other = new Uint8Array([1, 2, 3]);
    expect(slimAnim(other)).toBe(other);
  });

  it("is named by its image number, in the installation and in the copy", () => {
    expect(animMember(7)).toBe("HD2\\anim\\main_007.anim");
    expect(animPath(588)).toBe("unit/hd/main_588.anim");
  });
});
