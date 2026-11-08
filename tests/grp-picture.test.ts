import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { decodeGrpImage, encodeGrpImage, type GrpImage } from "../src/formats/dat/grpFile";
import { paintGrpFrame } from "../src/formats/units/grpPicture";
import { Contributions, createPluginApi } from "../src/plugins/host";

/** A palette whose entry i is (i, 255 - i, 7). */
const palette = Uint8Array.from({ length: 1024 }, (_, k) => (k % 4 === 0 ? k / 4 : k % 4 === 1 ? 255 - (k - 1) / 4 : k % 4 === 2 ? 7 : 0));
/** tunit.pcx's rows, made: row r's eight slots are 100 + r * 8 + s. */
const teamColors = Uint8Array.from({ length: 128 }, (_, i) => 100 + i);

/** A 4 × 2 GRP whose one frame is 3 × 1 at (1, 1): a transparent pixel, team slot 8, colour 50. */
const made: GrpImage = { width: 4, height: 2, frames: [{ x: 1, y: 1, width: 3, height: 1, pixels: Uint8Array.from([0, 8, 50]) }] };
const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

describe("a GRP painted the editor's way", () => {
  it("through the palette, with the team slots in a player's ramp, index 0 left clear", () => {
    const grp = decodeGrpImage(encodeGrpImage(made));
    const p = paintGrpFrame(grp, 0, { palette, team: { row: 2 }, teamColors })!;
    expect([p.width, p.height]).toEqual([4, 2]);
    expect(pixel(p.data, 4, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(p.data, 4, 2, 1)).toEqual([116, 139, 7, 255]); // slot 8 of row 2 = index 116
    expect(pixel(p.data, 4, 3, 1)).toEqual([50, 205, 7, 255]);
    // No team colour: slot 8 is the palette's own.
    expect(pixel(paintGrpFrame(grp, 0, { palette, team: null, teamColors })!.data, 4, 2, 1)).toEqual([8, 247, 7, 255]);
  });

  it("mirrored, as a shadow, from an uncompressed GRP, and null past the last frame", () => {
    const grp = decodeGrpImage(encodeGrpImage({ ...made, raw: true }));
    const flipped = paintGrpFrame(grp, 0, { palette, team: null, teamColors: null, flip: true })!;
    // The frame's box mirrors within the GRP's: x 1..3 becomes 0..2, its pixels reversed.
    expect(pixel(flipped.data, 4, 0, 1)).toEqual([50, 205, 7, 255]);
    expect(pixel(flipped.data, 4, 2, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(paintGrpFrame(grp, 0, { palette, team: { rgb: [1, 2, 3] }, teamColors: null, shadow: true })!.data, 4, 3, 1)).toEqual([0, 0, 0, 128]);
    expect(paintGrpFrame(grp, 1, { palette, team: null, teamColors: null })).toBeNull();
  });

  it("is api.graphics.grpImage, which refuses a palette that is no tileset's", async () => {
    const api = createPluginApi(createStore(), { id: "p", name: "P", source: "s" }, new Contributions());
    await expect(api.graphics.grpImage(encodeGrpImage(made), 0, { palette: "mars" })).rejects.toThrow(/not a tileset/);
    // No game data here: nothing to take the palette from.
    expect(await api.graphics.grpImage(encodeGrpImage(made), 0, { palette: "jungle" })).toBeNull();
    expect(await api.graphics.grpImage(new Uint8Array([1, 2]), 0)).toBeNull();
  });
});
