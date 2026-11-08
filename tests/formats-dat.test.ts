/**
 * The `.dat` tables through one schema: every field, the three layouts (the game's, DatExtend's expanded, GPTP's
 * .datex) with the width from the length, rows, and PyDAT TXT both ways.
 */
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAT_SCHEMAS, DAT_TABLES, datTableOf } from "../src/formats/dat/schema";
import {
  datEntrySize, datFromRows, datFromText, datRow, datShape, datStandardSize, datToText, decodeDat, emptyDat, encodeDat, parseDatText, setDatRow,
} from "../src/formats/dat/table";
import { decodeFlingyDat, decodeUnitsDat } from "../src/formats/dat/dat";
import { cosmonarchyFile, cosmonarchyPath, gameFile, haveCosmonarchy, haveGameArchives, sameBytes } from "./support/modFiles";

describe("the schema", () => {
  it("adds up to the game's file sizes", () => {
    const sizes = Object.fromEntries(DAT_TABLES.map((t) => [t, datStandardSize(t)]));
    expect(sizes).toEqual({ units: 19876, weapons: 5460, flingy: 3135, sprites: 3229, images: 37962, upgrades: 1281, techdata: 836, orders: 4158, sfxdata: 10296, portdata: 1320, mapdata: 260 });
    expect(datStandardSize("units", true)).toBe(19192);
  });

  it("knows the expanded and .datex entry sizes", () => {
    expect(datEntrySize("units", "expanded")).toBe(97);
    expect(datEntrySize("units", "datex")).toBe(99);
    expect(datEntrySize("orders", "expanded")).toBe(22);
    expect(datEntrySize("orders", "datex")).toBe(23);
    expect(datEntrySize("sprites", "datex")).toBe(7);
    expect(datEntrySize("images", "datex")).toBe(38);
  });

  it("is plain JSON", () => {
    expect(JSON.parse(JSON.stringify(DAT_SCHEMAS))).toEqual(DAT_SCHEMAS);
    for (const t of DAT_TABLES) expect(new Set(DAT_SCHEMAS[t].fields.map((f) => f.name)).size).toBe(DAT_SCHEMAS[t].fields.length);
  });

  it("names a table from a file name", () => {
    expect(datTableOf("arr\\units.datex")).toBe("units");
    expect(datTableOf("SFXDATA.DAT")).toBe("sfxdata");
    expect(datTableOf("units.tbl")).toBeNull();
  });
});

describe("widths from the length", () => {
  it("tells the three layouts apart", () => {
    expect(datShape("units", 19876)).toEqual({ layout: "dat", count: 228, legacy: false });
    expect(datShape("units", 19192)).toEqual({ layout: "dat", count: 228, legacy: true });
    expect(datShape("units", 97 * 300)).toEqual({ layout: "expanded", count: 300, legacy: false });
    expect(datShape("units", 99 * 3000, "units.datex")).toEqual({ layout: "datex", count: 3000, legacy: false });
    expect(datShape("units", 99 * 301)).toEqual({ layout: "datex", count: 301, legacy: false });
    expect(datShape("units", 19877)).toBeNull();
    expect(() => decodeDat("units", new Uint8Array(19877))).toThrow(/no known layout/);
  });

  it("keeps the sub-range columns of the standard layout", () => {
    const units = emptyDat("units");
    setDatRow(units, 106, { infestation: 50, addon_position: { x: 3, y: 4 } });
    setDatRow(units, 0, { ready_sound: 7, unit_extents: { left: 1, up: 2, right: 3, down: 4 } });
    const back = decodeDat("units", encodeDat(units));
    expect(datRow(back, 106).infestation).toBe(50);
    expect(datRow(back, 106).addon_position).toEqual({ x: 3, y: 4 });
    expect(datRow(back, 0).ready_sound).toBe(7);
    expect(datRow(back, 0)).not.toHaveProperty("infestation");
    expect(datRow(back, 150)).not.toHaveProperty("ready_sound");
    expect(datRow(back, 0).unit_extents).toEqual({ left: 1, up: 2, right: 3, down: 4 });
  });

  it("widens units' flingy and weapons and orders' weapon in .datex", () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({ graphics: i + 700, ground_weapon: i + 300, air_weapon: 1000 - i }));
    const datex = datFromRows("units", rows, "datex");
    const bytes = encodeDat(datex);
    expect(bytes.length).toBe(300 * 99);
    const back = decodeDat("units", bytes, { fileName: "units.datex" });
    expect(datRow(back, 299)).toMatchObject({ graphics: 999, ground_weapon: 599, air_weapon: 701, infestation: 0 });
    // The expanded layout widens only the flingy, so a weapon past 255 does not fit it.
    expect(() => encodeDat(datex, "expanded")).toThrow(/ground_weapon of entry 0 is 300/);
    const orders = datFromRows("orders", [{ weapon_targeting: 600 }], "datex");
    expect(datRow(decodeDat("orders", encodeDat(orders), { fileName: "orders.datex" }), 0).weapon_targeting).toBe(600);
  });
});

describe("PyDAT TXT", () => {
  it("writes PyDAT's blocks", () => {
    const units = emptyDat("units");
    setDatRow(units, 0, { hit_points: (40 << 8) | 5, special_ability_flags: 0x8001_0000 + 1, supply_required: 3, staredit_placement_size: { width: 32, height: 16 } });
    const text = datToText(units, [0]);
    expect(text.startsWith("Unit(0):\n\tgraphics 0\n")).toBe(true);
    expect(text).toContain("\thit_points.whole 40\n\thit_points.fraction 5\n");
    expect(text).toContain("\tspecial_ability_flags.building True\n");
    expect(text).toContain("\tspecial_ability_flags.organic True\n");
    expect(text).toContain("\tspecial_ability_flags.produces_units True\n");
    expect(text).toContain("\tunknown_flags.flag_0x01 False\n");
    expect(text).toContain("\tsupply_required.whole 1\n\tsupply_required.half True\n");
    expect(text).toContain("\tstaredit_placement_size.width 32\n");
    expect(text).not.toContain("infestation");
  });

  it("writes portdata grouped the way PyDAT does", () => {
    const text = datToText(emptyDat("portdata"), [0]);
    expect(text).toBe("Portraits(0):\n\tidle.portrait_file 0\n\tidle.smk_change 0\n\tidle.unknown 0\n\ttalking.portrait_file 0\n\ttalking.smk_change 0\n\ttalking.unknown 0\n");
  });

  it("reads back what it writes, over a base or on its own", () => {
    const flingy = emptyDat("flingy");
    setDatRow(flingy, 3, { sprite: 200, speed: 1234, turn_radius: 40 });
    const again = datFromText("flingy", datToText(flingy));
    expect(sameBytes(encodeDat(again), encodeDat(flingy))).toBe(true);
    const edited = datFromText("flingy", "Flingy(3):\n\tspeed 99  # faster\n", { base: flingy });
    expect(datRow(edited, 3)).toMatchObject({ sprite: 200, speed: 99, turn_radius: 40 });
    expect(datRow(flingy, 3).speed).toBe(1234);
  });

  it("says what is wrong, and where", () => {
    expect(() => datFromText("flingy", "Flingy(0):\n\tsped 1\n")).toThrow(/line 2: Flingy has no field sped/);
    expect(() => datFromText("flingy", "Unit(0):\n\tsprite 1\n")).toThrow(/a Unit entry in a Flingy table/);
    expect(() => datFromText("units", "Unit(0):\n\tinfestation 1\n")).toThrow(/infestation is not stored for entry 0/);
    expect(() => parseDatText("Unit(0):\n\tgraphics one\n")).toThrow(/line 2/);
  });

  it("makes an expanded table from the entries present", () => {
    const text = Array.from({ length: 300 }, (_, i) => `Flingy(${i}):\n\tsprite ${i}\n`).join("\n");
    const file = datFromText("flingy", text);
    expect(file.count).toBe(300);
    expect(file.layout).toBe("expanded");
    expect(encodeDat(file).length).toBe(300 * 15);
  });
});

describe.skipIf(!haveGameArchives)("the game's tables (fixtures/data)", () => {
  for (const table of DAT_TABLES) {
    it(`${table}.dat comes back byte for byte, as binary and as PyDAT TXT`, () => {
      const bytes = gameFile(DAT_SCHEMAS[table].file)!;
      expect(bytes).not.toBeNull();
      const file = decodeDat(table, bytes);
      expect(file.layout).toBe("dat");
      expect(sameBytes(encodeDat(file), bytes)).toBe(true);
      expect(sameBytes(encodeDat(datFromText(table, datToText(file))), bytes)).toBe(true);
    });
  }

  it("agrees with the editor's own reader", () => {
    const bytes = gameFile("arr\\units.dat")!;
    const old = decodeUnitsDat(bytes);
    const file = decodeDat("units", bytes);
    expect(Array.from(file.columns.graphics)).toEqual(Array.from(old.flingy));
    expect(Array.from(file.columns.hit_points)).toEqual(Array.from(old.hitPoints));
    expect(Array.from(file.columns.staredit_availability_flags)).toEqual(Array.from(old.availability));
    expect(datRow(file, 0).unit_extents).toEqual({ left: old.extentLeft[0], up: old.extentUp[0], right: old.extentRight[0], down: old.extentDown[0] });
    expect(Array.from(decodeDat("flingy", gameFile("arr\\flingy.dat")!).columns.sprite)).toEqual(Array.from(decodeFlingyDat(gameFile("arr\\flingy.dat")!).sprite));
  });

  it("re-lays the game's table out as expanded and as .datex", () => {
    const file = decodeDat("units", gameFile("arr\\units.dat")!);
    for (const layout of ["expanded", "datex"] as const) {
      const wide = encodeDat({ ...file, layout }, layout);
      const back = decodeDat("units", wide, { layout });
      expect(back.count).toBe(228);
      expect(datRow(back, 5)).toMatchObject({ ...datRow(file, 5) });
    }
  });
});

describe.skipIf(!haveCosmonarchy)("a mod's .datex tables (SCMJS_COSMONARCHY)", () => {
  const files = haveCosmonarchy ? readdirSync(cosmonarchyPath("release/mpq/arr")).filter((n) => /\.datex$|sfxdata\.dat$/.test(n)) : [];
  it("are all there", () => expect(files.length).toBe(11));
  for (const name of files) {
    it(`${name} comes back byte for byte, as binary and as PyDAT TXT`, () => {
      const table = datTableOf(name)!;
      const bytes = cosmonarchyFile(`release/mpq/arr/${name}`);
      const file = decodeDat(table, bytes, { fileName: name });
      expect(file.layout).toBe(name.endsWith(".datex") ? "datex" : "expanded");
      expect(sameBytes(encodeDat(file), bytes)).toBe(true);
      expect(sameBytes(encodeDat(datFromText(table, datToText(file), { layout: file.layout, count: file.count })), bytes)).toBe(true);
    });
  }

  it("takes the width from the file, past PyMS's rules (3,000 units)", () => {
    const units = decodeDat("units", cosmonarchyFile("release/mpq/arr/units.datex"), { fileName: "units.datex" });
    expect(units.count).toBe(3000);
    expect(Math.max(...units.columns.graphics)).toBeGreaterThan(255);
  });
});
