import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodePcx } from "../src/formats/dat/pcx";
import {
  SHADE_PROFILE,
  synthesizeRamp,
  teamColorKey,
  teamColorLut,
  teamColorPalette,
  TEAM_COLOR_ROWS,
  TEAM_SLOT_COUNT,
  TEAM_SLOT_FIRST,
  tunitRamp,
} from "../src/formats/units/teamColor";
import { displayColorHex, PLAYER_COLORS, playerTeamColor } from "../src/data/players";
import { ColorMode, defaultPlayerRgb } from "../src/formats/chk/sections/players";

const PUBLIC = join(__dirname, "..", "public");
const read = (rel: string) => new Uint8Array(readFileSync(join(PUBLIC, rel)));
const haveGameData = ["game/tunit.pcx", "tileset/jungle.wpe"].every((f) => existsSync(join(PUBLIC, f)));

/** A palette with a recognisable colour per index, slots 8–15 a blue placeholder ramp. */
function fakePalette(): Uint8Array {
  const p = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) p.set([i, 255 - i, (i * 7) & 255, 255], i * 4);
  return p;
}

describe("playerTeamColor", () => {
  it("uses the tunit row for the sixteen classic colours", () => {
    expect(playerTeamColor([0, 1, 2, 3, 4, 5, 6, 7], null, 0)).toEqual({ row: 0 });
    expect(playerTeamColor([15, 1, 2, 3, 4, 5, 6, 7], null, 0)).toEqual({ row: 15 });
    expect(playerTeamColor(null, null, 3)).toEqual({ row: 3 });
    // players 9–12 have no COLR byte and always use their own row
    expect(playerTeamColor([16, 16, 16, 16, 16, 16, 16, 16], null, 11)).toEqual({ row: 11 });
  });

  it("hands the later table entries (Pink … Black) over as an RGB, since tunit.pcx has no row for them", () => {
    const pink = PLAYER_COLORS.find((c) => c.name === "Pink")!;
    expect(pink.id).toBeGreaterThanOrEqual(TEAM_COLOR_ROWS);
    expect(playerTeamColor([pink.id, 1, 2, 3, 4, 5, 6, 7], null, 0)).toEqual({ rgb: [0xff, 0xc4, 0xe4] });
    for (const c of PLAYER_COLORS.filter((c) => c.id >= TEAM_COLOR_ROWS)) {
      const spec = playerTeamColor([c.id, 1, 2, 3, 4, 5, 6, 7], null, 0);
      expect("rgb" in spec).toBe(true);
    }
  });

  it("prefers a CRGB custom colour, and only for the slot that is on Custom", () => {
    const rgb = defaultPlayerRgb();
    rgb.mode[0] = ColorMode.Custom;
    rgb.rgb[0] = [10, 200, 30];
    rgb.rgb[1] = [99, 99, 99]; // stored but mode is Palette: ignored
    expect(playerTeamColor([0, 1, 2, 3, 4, 5, 6, 7], rgb, 0)).toEqual({ rgb: [10, 200, 30] });
    expect(playerTeamColor([0, 1, 2, 3, 4, 5, 6, 7], rgb, 1)).toEqual({ row: 1 });
    expect(displayColorHex([0, 1, 2, 3, 4, 5, 6, 7], rgb, 0)).toBe("#0ac81e");
    expect(displayColorHex([0, 1, 2, 3, 4, 5, 6, 7], rgb, 1)).toBe(PLAYER_COLORS[1].hex);
  });

  it("keys specs distinctly", () => {
    expect(teamColorKey({ row: 3 })).toBe("r3");
    expect(teamColorKey({ rgb: [255, 196, 228] })).toBe("c255,196,228");
    expect(teamColorKey({ row: 0 })).not.toBe(teamColorKey({ rgb: [0, 0, 0] }));
  });
});

describe("synthesised ramps", () => {
  it("scale the colour by the shade profile, bright to dark", () => {
    expect(SHADE_PROFILE).toHaveLength(TEAM_SLOT_COUNT);
    expect(SHADE_PROFILE[0]).toBe(1);
    for (let i = 1; i < SHADE_PROFILE.length; i++) expect(SHADE_PROFILE[i]).toBeLessThanOrEqual(SHADE_PROFILE[i - 1]);
    const ramp = synthesizeRamp([255, 196, 228]);
    expect(ramp).toHaveLength(TEAM_SLOT_COUNT * 3);
    expect(Array.from(ramp.subarray(0, 3))).toEqual([255, 196, 228]);
    for (let s = 1; s < TEAM_SLOT_COUNT; s++) {
      for (let c = 0; c < 3; c++) {
        expect(ramp[s * 3 + c]).toBeLessThanOrEqual(ramp[(s - 1) * 3 + c]);
        expect(ramp[s * 3 + c]).toBe(Math.round([255, 196, 228][c] * SHADE_PROFILE[s]));
      }
    }
  });

  it("override only slots 8–15 of a palette copy, leaving the original alone", () => {
    const palette = fakePalette();
    const before = palette.slice();
    const out = teamColorPalette(palette, [255, 196, 228]);
    expect(palette).toEqual(before);
    expect(out).not.toBe(palette);
    for (let i = 0; i < 256; i++) {
      const slot = i - TEAM_SLOT_FIRST;
      if (slot >= 0 && slot < TEAM_SLOT_COUNT) {
        expect(Array.from(out.subarray(i * 4, i * 4 + 4))).toEqual([
          Math.round(255 * SHADE_PROFILE[slot]), Math.round(196 * SHADE_PROFILE[slot]), Math.round(228 * SHADE_PROFILE[slot]), 255,
        ]);
      } else {
        expect(Array.from(out.subarray(i * 4, i * 4 + 4))).toEqual(Array.from(before.subarray(i * 4, i * 4 + 4)));
      }
    }
  });
});

describe("tunit ramps", () => {
  it("remap exactly the eight team slots", () => {
    const table = new Uint8Array(TEAM_COLOR_ROWS * TEAM_SLOT_COUNT).map((_, i) => 100 + i);
    const lut = teamColorLut(tunitRamp(table, 2));
    for (let i = 0; i < 256; i++) {
      const slot = i - TEAM_SLOT_FIRST;
      expect(lut[i]).toBe(slot >= 0 && slot < TEAM_SLOT_COUNT ? 100 + 2 * TEAM_SLOT_COUNT + slot : i);
    }
  });

  it("clamp an out-of-table row rather than reading past the pixels", () => {
    const table = new Uint8Array(TEAM_COLOR_ROWS * TEAM_SLOT_COUNT).map((_, i) => i);
    expect(Array.from(tunitRamp(table, 99))).toEqual(Array.from(tunitRamp(table, TEAM_COLOR_ROWS - 1)));
    expect(Array.from(tunitRamp(table, -4))).toEqual(Array.from(tunitRamp(table, 0)));
  });

  describe.skipIf(!haveGameData)("against the real tunit.pcx", () => {
    it("has exactly sixteen rows — which is why Pink and friends need synthesising", () => {
      const pcx = decodePcx(read("game/tunit.pcx"));
      expect(pcx.width).toBe(TEAM_COLOR_ROWS * TEAM_SLOT_COUNT);
      expect(pcx.height).toBe(1);
    });

    it("the red row through the Jungle palette is the red the table promises, and every row darkens", () => {
      const tunit = decodePcx(read("game/tunit.pcx")).pixels;
      const palette = read("tileset/jungle.wpe");
      const rgb = (i: number) => [palette[i * 4], palette[i * 4 + 1], palette[i * 4 + 2]];
      const lum = (i: number) => 0.299 * palette[i * 4] + 0.587 * palette[i * 4 + 1] + 0.114 * palette[i * 4 + 2];
      expect(rgb(tunitRamp(tunit, 0)[0])).toEqual([0xf4, 0x04, 0x04]);
      for (let row = 0; row < TEAM_COLOR_ROWS; row++) {
        const ramp = tunitRamp(tunit, row);
        expect(lum(ramp[0])).toBeGreaterThan(lum(ramp[TEAM_SLOT_COUNT - 1]));
      }
    });
  });
});
