import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeFlingyDat, decodeImagesDat, decodeSpritesDat, decodeUnitsDat, decodeWeaponsDat, NO_UNIT, NO_WEAPON, RANDOM_DIRECTION, UnitFlag, UNITS_DAT_SIZE, WEAPONS_DAT_SIZE,
} from "../src/formats/dat/dat";
import { WEAPON_NAMES } from "../src/data/weapons";
import { decodeGrp, drawGrpFrame, facingFrame } from "../src/formats/dat/grp";
import { decodePcx } from "../src/formats/dat/pcx";
import { decodeTbl } from "../src/formats/dat/tbl";
import { UNIT_GROUPS, UNIT_NAMES, unitName } from "../src/data/units";

const PUBLIC = join(import.meta.dirname, "..", "public");
const read = (rel: string) => new Uint8Array(readFileSync(join(PUBLIC, rel)));
const haveUnitData = ["arr/units.dat", "arr/flingy.dat", "arr/sprites.dat", "arr/images.dat", "arr/images.tbl", "game/tunit.pcx", "unit/terran/marine.grp"]
  .every((f) => existsSync(join(PUBLIC, f)));

function bytes(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const u16 = (v: number) => [v & 255, v >> 8];
const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

/** Grey ramp palette: index i → (i, i, i). */
const ramp = new Uint8Array(1024);
for (let i = 0; i < 256; i++) ramp.set([i, i, i, 255], i * 4);

describe("tbl", () => {
  it("reads NUL-terminated strings by offset", () => {
    const strings = ["terran\\marine.grp", "b"];
    const body = bytes(...strings.map((s) => [...new TextEncoder().encode(s), 0]));
    const header = bytes(u16(2), u16(6), u16(6 + strings[0].length + 1));
    expect(decodeTbl(bytes(header, body))).toEqual(strings);
  });
});

describe("grp", () => {
  /**
   * One 4×2 frame at (1, 0) inside a 6×3 box:
   *   row 0: skip 1, literal 9 8, repeat 7 ×1   →  . 9 8 7
   *   row 1: repeat 5 ×4                          →  5 5 5 5
   */
  const line0 = [0x81, 0x02, 9, 8, 0x41, 7];
  const line1 = [0x44, 5];
  const frameData = bytes(u16(4), u16(4 + line0.length), line0, line1);
  const grpBytes = bytes(u16(1), u16(6), u16(3), [1, 0, 4, 2], u32(6 + 8), frameData);

  const render = (flip: boolean) => {
    const grp = decodeGrp(grpBytes);
    const dest = new Uint8ClampedArray(6 * 3 * 4);
    drawGrpFrame(grp, 0, dest, 6, 0, 0, ramp, null, flip);
    const rows: string[] = [];
    for (let y = 0; y < 3; y++) rows.push(Array.from({ length: 6 }, (_, x) => (dest[(y * 6 + x) * 4 + 3] ? String(dest[(y * 6 + x) * 4]) : ".")).join(" "));
    return rows;
  };

  it("decodes the header and frame table", () => {
    const grp = decodeGrp(grpBytes);
    expect(grp.width).toBe(6);
    expect(grp.height).toBe(3);
    expect(grp.frames).toEqual([{ x: 1, y: 0, width: 4, height: 2, offset: 14 }]);
  });

  it("expands skip, literal and repeat runs", () => {
    expect(render(false)).toEqual([". . 9 8 7 .", ". 5 5 5 5 .", ". . . . . ."]);
  });

  it("mirrors inside the box when flipped", () => {
    expect(render(true)).toEqual([". 7 8 9 . .", ". 5 5 5 5 .", ". . . . . ."]);
  });

  it("applies a palette lookup and keeps index 0 transparent", () => {
    const grp = decodeGrp(grpBytes);
    const lut = new Uint8Array(256).map((_, i) => i);
    lut[9] = 0; // knock out one pixel
    lut[5] = 200;
    const dest = new Uint8ClampedArray(6 * 3 * 4);
    drawGrpFrame(grp, 0, dest, 6, 0, 0, ramp, lut);
    expect(dest[2 * 4 + 3]).toBe(0); // row 0, column 2
    expect(dest[(1 * 6 + 1) * 4]).toBe(200);
  });

  it("maps directions onto the 17 stored frames", () => {
    expect(facingFrame(0)).toEqual({ frame: 0, flip: false });
    expect(facingFrame(16)).toEqual({ frame: 16, flip: false });
    expect(facingFrame(24)).toEqual({ frame: 8, flip: true });
    expect(facingFrame(31)).toEqual({ frame: 1, flip: true });
  });
});

describe("pcx", () => {
  it("decodes 8-bit RLE rows", () => {
    const header = new Uint8Array(128);
    header[0] = 0x0a; header[2] = 1; header[3] = 8; header[65] = 1;
    new DataView(header.buffer).setUint16(8, 3, true); // xmax → width 4
    new DataView(header.buffer).setUint16(10, 0, true);
    new DataView(header.buffer).setUint16(66, 4, true);
    const pcx = decodePcx(bytes(header, [0xc3, 7, 0x10]));
    expect(pcx.width).toBe(4);
    expect(pcx.height).toBe(1);
    expect([...pcx.pixels]).toEqual([7, 7, 7, 0x10]);
    expect(pcx.palette).toBeNull();
  });
});

describe("unit catalogue", () => {
  it("names all 228 unit types and files each in exactly one palette group", () => {
    expect(UNIT_NAMES).toHaveLength(228);
    const seen = new Map<number, string>();
    for (const g of UNIT_GROUPS) for (const id of g.units) {
      expect(seen.has(id), `${unitName(id)} in both ${seen.get(id)} and ${g.label}`).toBe(false);
      seen.set(id, g.label);
    }
    expect(seen.size).toBe(228);
    expect(unitName(0)).toBe("Terran Marine");
    expect(unitName(214)).toBe("Start Location");
  });
});

describe.skipIf(!haveUnitData)("real unit data (public/arr, public/unit)", () => {
  it("decodes units.dat with the known Brood War values", () => {
    const units = decodeUnitsDat(read("arr/units.dat"));
    expect(read("arr/units.dat")).toHaveLength(UNITS_DAT_SIZE);
    // Command Center: 4×3 tiles, symmetric extents, a building that lifts off.
    expect([units.placementWidth[106], units.placementHeight[106]]).toEqual([128, 96]);
    expect([units.extentLeft[106], units.extentUp[106], units.extentRight[106], units.extentDown[106]]).toEqual([58, 41, 58, 41]);
    expect(units.flags[106] & UnitFlag.Building).toBeTruthy();
    expect(units.flags[106] & UnitFlag.FlyingBuilding).toBeTruthy();
    // Marine: random facing, organic, no turret, 40 hp.
    expect(units.direction[0]).toBe(RANDOM_DIRECTION);
    expect(units.flags[0] & UnitFlag.Organic).toBeTruthy();
    expect(units.subunit[0]).toBe(NO_UNIT);
    expect(units.hitPoints[0] / 256).toBe(40);
    // Marine: 360 frames (24 s), no armour, Gauss Rifle at both ranges. A tank's Arclite Cannon is
    // on its turret (unit 6), ground-only; the hull carries no weapon.
    expect(units.buildTime[0]).toBe(360);
    expect(units.armor[0]).toBe(0);
    expect([units.groundWeapon[0], units.airWeapon[0]]).toEqual([0, 0]);
    expect([units.groundWeapon[5], units.airWeapon[5]]).toEqual([NO_WEAPON, NO_WEAPON]);
    expect([units.groundWeapon[6], units.airWeapon[6]]).toEqual([11, NO_WEAPON]);
    expect(units.armor[106]).toBe(1);
    expect(units.buildTime[106]).toBe(1800);
    // Goliath carries its turret; the start location is a 4×3 "building".
    expect(units.subunit[3]).toBe(4);
    expect([units.placementWidth[214], units.placementHeight[214]]).toEqual([128, 96]);
    expect(units.flags[214] & UnitFlag.Building).toBeTruthy();
  });

  it.skipIf(!existsSync(join(PUBLIC, "arr/weapons.dat")))("decodes weapons.dat damage and upgrade bonus", () => {
    const weapons = decodeWeaponsDat(read("arr/weapons.dat"));
    expect(read("arr/weapons.dat")).toHaveLength(WEAPONS_DAT_SIZE);
    expect([weapons.damage[0], weapons.bonus[0]]).toEqual([6, 1]); // Gauss Rifle
    expect([weapons.damage[11], weapons.bonus[11]]).toEqual([30, 3]); // Arclite Cannon
    expect([weapons.damage[30], weapons.bonus[30]]).toEqual([260, 0]); // Yamato Gun
    expect(WEAPON_NAMES).toHaveLength(130);
  });

  it("walks from a unit to its GRP path", () => {
    const units = decodeUnitsDat(read("arr/units.dat"));
    const flingy = decodeFlingyDat(read("arr/flingy.dat"));
    const sprites = decodeSpritesDat(read("arr/sprites.dat"));
    const images = decodeImagesDat(read("arr/images.dat"));
    const tbl = decodeTbl(read("arr/images.tbl"));
    const pathOf = (unit: number) => tbl[images.grp[sprites.image[flingy.sprite[units.flingy[unit]]]] - 1];
    expect(pathOf(0)).toBe("terran\\marine.grp");
    expect(pathOf(214)).toBe("thingy\\StartLoc.grp");
    expect(pathOf(176)).toBe("neutral\\min01.grp");
    expect(images.graphicTurns[sprites.image[flingy.sprite[units.flingy[0]]]]).toBe(1);
    expect(images.graphicTurns[sprites.image[flingy.sprite[units.flingy[106]]]]).toBe(0);
  });

  it("reads the team colour table as 16 rows of 8 palette indices", () => {
    const pcx = decodePcx(read("game/tunit.pcx"));
    expect([pcx.width, pcx.height]).toEqual([128, 1]);
    // Each row is a shaded ramp of palette indices; none may be the transparent index.
    for (let row = 0; row < 16; row++) {
      const slots = [...pcx.pixels.subarray(row * 8, row * 8 + 8)];
      expect(new Set(slots).size).toBeGreaterThanOrEqual(4);
      expect(slots).not.toContain(0);
    }
  });

  it("decodes marine.grp into sensible frames", () => {
    const grp = decodeGrp(read("unit/terran/marine.grp"));
    expect(grp.frames.length).toBeGreaterThanOrEqual(17);
    for (const f of grp.frames) {
      expect(f.x + f.width).toBeLessThanOrEqual(grp.width);
      expect(f.y + f.height).toBeLessThanOrEqual(grp.height);
    }
    const dest = new Uint8ClampedArray(grp.width * grp.height * 4);
    drawGrpFrame(grp, 0, dest, grp.width, 0, 0, ramp);
    let opaque = 0;
    for (let i = 3; i < dest.length; i += 4) if (dest[i]) opaque++;
    expect(opaque).toBeGreaterThan(50);
  });
});
