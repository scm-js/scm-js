import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  datCount, decodeFlingyDat, decodeImagesDat, decodeSpritesDat, decodeTechdataDat, decodeUnitsDat, decodeUpgradesDat, decodeWeaponsDat,
} from "../src/formats/dat/dat";
import { decodeDat, encodeDat } from "../src/formats/dat/table";
import type { DatTableName } from "../src/formats/dat/schema";
import { decodeIscript } from "../src/formats/dat/iscript";
import { decodeTblEntries } from "../src/formats/dat/tbl";
import { extractUnits, type ReadMember } from "../src/gamedata/extract";
import { namesFromAssets, unitCatalogue } from "../src/data/gameNames";
import { dataSetUnitGroups, installNames, unitName, unitTypeCount } from "../src/data/units";
import { CLASSIC_GROUP_LIMIT, decodeCv5, hasCreepFlag, loadTileset, megatileForTile, tileGroupOf, TILE_CREEP_FLAG } from "../src/formats/tileset/decode";
import { extractOverCopy, filesHash, hdOffImages, storedPathOf } from "../src/gamedata/overCopy";
import { growDat, MADE_UNITS, madeName, madeUnitNames, madeUnitsDat } from "./support/madeDataSet";
import { cosmonarchyFile, haveCosmonarchy } from "./support/modFiles";

/**
 * The readers at the three widths a table comes in — the game's own, DatExtend's expanded
 * `.dat` and GPTP's `.datex` — each made at test time from the game's own files with
 * `encodeDat`, and the tileset readers at sizes past the game's. Skip without game data.
 */
const ARR = join(import.meta.dirname, "..", "public", "arr");
const TILESET = join(import.meta.dirname, "..", "public", "tileset");
const haveArr = existsSync(join(ARR, "units.dat")) && existsSync(join(ARR, "images.dat"));
const haveTiles = existsSync(join(TILESET, "jungle.cv5")) && existsSync(join(TILESET, "jungle.vx4"));
const arr = (name: string) => new Uint8Array(readFileSync(join(ARR, name)));

const READERS = {
  units: decodeUnitsDat, weapons: decodeWeaponsDat, flingy: decodeFlingyDat, sprites: decodeSpritesDat,
  images: decodeImagesDat, upgrades: decodeUpgradesDat, techdata: decodeTechdataDat,
} as const;

/** The first column of each reader's result, to compare entry by entry. */
const columns = (decoded: object) => Object.entries(decoded).filter(([, v]) => ArrayBuffer.isView(v)) as [string, ArrayLike<number>][];

describe.skipIf(!haveArr)("the editor's table readers at every width", () => {
  for (const [table, read] of Object.entries(READERS) as [keyof typeof READERS, (d: Uint8Array, f?: string) => object][]) {
    it(`${table}.dat: the game's, grown in the expanded layout and as .datex read the same entries`, () => {
      const game = arr(`${table}.dat`);
      const standard = read(game);
      const file = decodeDat(table as DatTableName, game);
      const count = file.count + 12;
      const expanded = encodeDat(growDat(file, count, "expanded", () => 0), "expanded");
      const datex = encodeDat(growDat(file, count, "datex", () => 0), "datex");
      const wide = read(expanded);
      const ex = read(datex, `${table}.datex`);
      for (const [name, col] of columns(standard)) {
        const a = (wide as Record<string, ArrayLike<number>>)[name];
        const b = (ex as Record<string, ArrayLike<number>>)[name];
        expect(a.length, name).toBe(count);
        expect(b.length, name).toBe(count);
        for (let id = 0; id < file.count; id++) {
          expect(a[id], `${name}[${id}] expanded`).toBe(col[id]);
          expect(b[id], `${name}[${id}] datex`).toBe(col[id]);
        }
      }
    });
  }

  it("the lists the editor builds follow units.dat's width: 240 types, named by unitnames.tbl, grouped by their flags", () => {
    const units = decodeUnitsDat(madeUnitsDat(arr("units.dat")));
    expect(datCount(units.flingy)).toBe(MADE_UNITS);
    const unitNames = decodeTblEntries(madeUnitNames());
    const assets = { units, unitNames, statTxt: null, weapons: null, upgrades: null, techs: null };
    installNames(namesFromAssets(assets), unitCatalogue(assets));
    try {
      expect(unitTypeCount()).toBe(MADE_UNITS);
      expect(unitName(239)).toBe(madeName(239));
      expect(unitName(0)).toBe("Terran Marine");
      const groups = dataSetUnitGroups();
      expect(groups.map((g) => [g.race, g.label, g.units.length])).toEqual([["terran", "Terran Units", 8], ["terran", "Terran Buildings", 4]]);
      expect(groups.flatMap((g) => g.units).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => 228 + i));
    } finally {
      installNames(null);
    }
    expect(unitTypeCount()).toBe(228);
  });

  it("the extraction walks a grown units table and stores a .datex as it found it", () => {
    const tables = new Map<string, Uint8Array>();
    for (const name of ["flingy.dat", "sprites.dat", "images.dat", "images.tbl", "weapons.dat", "upgrades.dat", "techdata.dat"]) tables.set(`arr\\${name}`, arr(name));
    const units = arr("units.dat");
    const base: ReadMember = (m) => tables.get(m.toLowerCase()) ?? (m === "game\\tunit.pcx" ? new Uint8Array(200) : m === "scripts\\iscript.bin" ? new Uint8Array([4, 0, 0, 0, 0xff, 0xff, 0, 0]) : null);
    const asDat = extractUnits((m) => (m === "arr\\units.dat" ? units : base(m)));
    const grown = extractUnits((m) => (m === "arr\\units.dat" ? units : m === "arr\\units.datex" ? madeUnitsDat(units, "datex") : base(m)));
    expect(grown.manifest.datex).toEqual(["units"]);
    expect(grown.files.has("arr/units.datex")).toBe(true);
    expect(grown.files.has("arr/units.dat")).toBe(false);
    // The new types draw with the game's pictures, so the graphics the walk reaches are the same.
    expect(grown.manifest.grps).toEqual(asDat.manifest.grps);
  });
});

describe.skipIf(!haveTiles)("the tileset readers past the game's sizes", () => {
  const files = (name: string) => ({
    cv5: new Uint8Array(readFileSync(join(TILESET, `${name}.cv5`))),
    vf4: new Uint8Array(readFileSync(join(TILESET, `${name}.vf4`))),
    vr4: new Uint8Array(readFileSync(join(TILESET, `${name}.vr4`))),
    vx4: new Uint8Array(readFileSync(join(TILESET, `${name}.vx4`))),
    wpe: new Uint8Array(readFileSync(join(TILESET, `${name}.wpe`))),
  });

  it("a cv5 grown by a group has the group, and a vx4ex made from the vx4 draws the same megatiles", () => {
    const f = files("jungle");
    const groups = f.cv5.length / 52;
    const grown = new Uint8Array(f.cv5.length + 52);
    grown.set(f.cv5);
    grown.set(f.cv5.subarray(0, 52), f.cv5.length);
    expect(decodeCv5(grown)).toHaveLength(groups + 1);
    // vx4ex: the same references as u32.
    const refs = new DataView(f.vx4.buffer, f.vx4.byteOffset, f.vx4.byteLength);
    const vx4ex = new Uint8Array(f.vx4.length * 2);
    const out = new DataView(vx4ex.buffer);
    for (let i = 0; i < f.vx4.length / 2; i++) out.setUint32(i * 4, refs.getUint16(i * 2, true), true);
    const classic = loadTileset(f);
    const extended = loadTileset({ ...f, cv5: grown, vx4: vx4ex, vx4Extended: true });
    expect(extended.megatileCount).toBe(classic.megatileCount);
    expect(Array.from(extended.megatileRefs)).toEqual(Array.from(classic.megatileRefs));
    expect(extended.groups).toHaveLength(groups + 1);
  });

  it("past 2,048 groups an MTXM value's group is twelve bits; below, bit 15 stays the creep flag", () => {
    const f = files("jungle");
    const per = 52;
    // Grow to 2,800 groups; group 2,774 points its slots at megatile 7 (and megatile refs past 0x7FFF are just u32s in a vx4ex).
    const cv5 = new Uint8Array(2800 * per);
    cv5.set(f.cv5);
    const view = new DataView(cv5.buffer);
    for (let s = 0; s < 16; s++) view.setUint16(2774 * per + 20 + s * 2, 7, true);
    const tileset = loadTileset({ ...f, cv5 });
    const id = (2774 << 4) | 3;
    expect(id & TILE_CREEP_FLAG).not.toBe(0);
    expect(tileGroupOf(id, tileset.groups.length)).toBe(2774);
    expect(megatileForTile(tileset, id)).toBe(7);
    expect(hasCreepFlag(id, tileset.groups.length)).toBe(false);
    // The game's own tileset: bit 15 is the flag and the group is eleven bits.
    expect(tileGroupOf(id, CLASSIC_GROUP_LIMIT)).toBe(2774 & 0x7ff);
    expect(hasCreepFlag(id, decodeCv5(f.cv5).length)).toBe(true);
  });
});

const PUBLIC = join(import.meta.dirname, "..", "public");
const haveCopy = haveArr && existsSync(join(PUBLIC, "unit", "manifest.json")) && existsSync(join(PUBLIC, "tileset", "manifest.json"));

describe.skipIf(!haveCopy)("a data set laid over a copy instead of the game's archives", () => {
  // The extracted tree under public/ stands in for a stored copy: the same paths.
  const copy = async (path: string) => {
    const file = join(PUBLIC, path);
    return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
  };
  const mine = new Map<string, Uint8Array>();

  it("takes its own files first and everything else from the copy, at the copy's paths", async () => {
    mine.set("arr\\units.dat", madeUnitsDat(arr("units.dat")));
    mine.set("rez\\unitnames.tbl", madeUnitNames());
    const over = await extractOverCopy((m) => mine.get(m.toLowerCase().replaceAll("/", "\\")) ?? null, copy);
    const units = decodeUnitsDat(over.result.files.get("arr/units.dat")!);
    expect(datCount(units.flingy)).toBe(MADE_UNITS);
    expect(over.result.units.manifest.optional).toEqual(["rez/unitnames.tbl"]);
    expect(over.result.tilesets.complete.length).toBeGreaterThan(0);
    // The game's pictures all come from the copy; the made types draw with them.
    const plain = JSON.parse(readFileSync(join(PUBLIC, "unit", "manifest.json"), "utf8")) as { grps: string[] };
    expect(over.result.units.manifest.grps).toEqual(plain.grps);
    expect(over.fromCopy.has("arr\\flingy.dat")).toBe(true);
    expect(over.fromCopy.has("arr\\units.dat")).toBe(false);
    // A copy without Remastered's sprites has nothing to turn off.
    expect(await hdOffImages(over, copy)).toEqual([]);
  });

  it("names its files by one digest, the same for the same files in any order", async () => {
    const a = await filesHash([{ path: "arr/units.dat", bytes: new Uint8Array([1, 2]) }, { path: "rez/unitnames.tbl", bytes: new Uint8Array([3]) }]);
    const b = await filesHash([{ path: "rez\\unitnames.tbl", bytes: new Uint8Array([3]) }, { path: "arr\\units.dat", bytes: new Uint8Array([1, 2]) }]);
    const c = await filesHash([{ path: "arr/units.dat", bytes: new Uint8Array([1, 3]) }, { path: "rez/unitnames.tbl", bytes: new Uint8Array([3]) }]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
});

describe("a stored copy's paths, for laying a data set over it", () => {
  it("are the extraction's names for each member", () => {
    expect(storedPathOf("arr\\units.dat")).toBe("arr/units.dat");
    expect(storedPathOf("rez\\stat_txt.tbl")).toBe("tileset/stat_txt.tbl");
    expect(storedPathOf("tileset\\Jungle\\ofire.pcx")).toBe("tileset/jungle.ofire.pcx");
    expect(storedPathOf("tileset\\badlands.vx4ex")).toBe("tileset/badlands.vx4ex");
    expect(storedPathOf("HD2\\anim\\main_007.anim")).toBe("unit/hd/main_007.anim");
    expect(storedPathOf("HD2\\tileset\\jungle.dds.vr4")).toBe("tileset/jungle.hd.vr4");
    expect(storedPathOf("unit\\Terran\\Marine.grp")).toBe("unit/terran/marine.grp");
  });
});

describe.skipIf(!haveCosmonarchy)("a mod's own files", () => {
  it("reads its .datex tables at their width", () => {
    expect(datCount(decodeUnitsDat(cosmonarchyFile("release/mpq/arr/units.datex"), "units.datex").flingy)).toBe(3000);
    expect(datCount(decodeImagesDat(cosmonarchyFile("release/mpq/arr/images.datex"), "images.datex").grp)).toBe(5000);
  });

  it("reads IceCC-compiled animation scripts, whose headers hold type + 1 entry points", () => {
    for (const part of ["general", "terran", "zerg", "protoss"]) {
      const bin = decodeIscript(cosmonarchyFile(`release/mpq/scripts/iscript_${part}.bin`));
      expect(bin.headers.size).toBeGreaterThan(0);
      for (const h of bin.headers.values()) expect(h.anims.length).toBe(h.type + 1);
    }
  });
});
