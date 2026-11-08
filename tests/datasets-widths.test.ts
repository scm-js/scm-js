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
import { EXTRA_TABLES, extractUnits, SOUND_TABLES, UNIT_TABLES, type ReadMember } from "../src/gamedata/extract";
import { DAT_SCHEMAS } from "../src/formats/dat/schema";
import { openArchives, readerFor } from "../src/gamedata/archives";
import { namesFromAssets, unitCatalogue } from "../src/data/gameNames";
import { dataSetUnitGroups, installNames, unitName, unitTypeCount } from "../src/data/units";
import { CLASSIC_GROUP_LIMIT, decodeCv5, hasCreepFlag, loadTileset, megatileForTile, tileGroupOf, TILE_CREEP_FLAG } from "../src/formats/tileset/decode";
import { changedFiles, changedFilesHash, extractOverCopy, firstOf, hdOffImages, storedPathOf } from "../src/gamedata/overCopy";
import { dataSetHash } from "../src/formats/mod/sources";
import { Archive, Creator } from "mopaq";
import type { ExtractRequest, ExtractResponse } from "../src/gamedata/extract.worker";
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
});

describe("a data set's hash", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  const base = new Map([["arr\\weapons.dat", bytes(9, 9)], ["arr\\units.dat", bytes(1, 1)]]);
  const baseRead = (n: string) => base.get(n) ?? null;

  it("is core's dataSetHash over the files that differ from the base, whatever their order or slashes", async () => {
    const own = new Map([["arr\\units.dat", bytes(1, 2)], ["arr\\weapons.dat", bytes(9, 9)], ["rez\\unitnames.tbl", bytes(3)]]);
    const hash = await changedFilesHash(["rez/unitnames.tbl", "ARR\\Units.dat", "arr/weapons.dat", "arr/flingy.dat"], (n) => own.get(n) ?? null, baseRead);
    // weapons.dat is the base's byte for byte and flingy.dat is not the set's: neither is in it.
    expect(hash).toBe(await dataSetHash([{ name: "arr\\units.dat", bytes: bytes(1, 2) }, { name: "rez\\unitnames.tbl", bytes: bytes(3) }]));
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(await changedFilesHash(["arr\\weapons.dat"], (n) => own.get(n) ?? null, baseRead)).toBeNull();
  });

  it("compares a file the copy underneath lacks with the game's, and lists the ones nothing had", async () => {
    // A copy made before the extraction kept mapdata: it has portdata (the play set's) and no mapdata.
    const copy = new Map([["arr/portdata.dat", bytes(5, 5)]]);
    const game = new Map([["arr\\mapdata.dat", bytes(6, 6)], ["arr\\portdata.dat", bytes(5, 5)]]);
    const copyRead = (n: string) => copy.get(storedPathOf(n)) ?? null;
    const gameRead = (n: string) => game.get(n) ?? null;
    // The mod ships the game's mapdata as it is, a portdata of its own, and a new picture.
    const own = new Map([["arr\\mapdata.dat", bytes(6, 6)], ["arr\\portdata.dat", bytes(5, 9)], ["unit\\new\\thing.grp", bytes(1)]]);
    const names = [...own.keys()];
    const withGame = await changedFiles(names, (n) => own.get(n) ?? null, firstOf(copyRead, gameRead));
    expect(withGame.unbased).toEqual(["unit\\new\\thing.grp"]);
    expect(withGame.hash).toBe(await dataSetHash([{ name: "arr\\portdata.dat", bytes: bytes(5, 9) }, { name: "unit\\new\\thing.grp", bytes: bytes(1) }]));
    // Without the game at hand the copy's gap counts: mapdata is hashed, and the stamp can say why.
    const copyOnly = await changedFiles(names, (n) => own.get(n) ?? null, firstOf(copyRead, null));
    expect(copyOnly.unbased).toEqual(["arr\\mapdata.dat", "unit\\new\\thing.grp"]);
    expect(copyOnly.hash).not.toBe(withGame.hash);
  });
});

describe("the extraction's tables", () => {
  it("are every file the game keeps under arr\\: the eleven tables and their four string tables", () => {
    const kept = new Set([...UNIT_TABLES, ...EXTRA_TABLES, ...SOUND_TABLES].filter((m) => m.startsWith("arr\\")));
    const game = [...Object.values(DAT_SCHEMAS).map((s) => s.file), "arr\\images.tbl", "arr\\sfxdata.tbl", "arr\\portdata.tbl", "arr\\mapdata.tbl"];
    expect(game.length).toBe(15);
    for (const member of game) expect(kept.has(member), member).toBe(true);
  });
});

const FIXTURE_DATA = join(import.meta.dirname, "..", "fixtures", "data");
const haveArchives = existsSync(join(FIXTURE_DATA, "StarDat.mpq")) && existsSync(join(FIXTURE_DATA, "BrooDat.mpq"));

describe.skipIf(!haveArchives)("a made data set installed through the editor's extraction", () => {
  it("is stamped with the hash the command line and the play page compute for the same files", async () => {
    const archive = (name: string) => new Uint8Array(readFileSync(join(FIXTURE_DATA, name)));
    const stardat = archive("StarDat.mpq"), broodat = archive("BrooDat.mpq");
    const game = Archive.open(broodat);
    const unitsDat = madeUnitsDat(game.readFile("arr\\units.dat"));
    const unitNames = madeUnitNames();
    const sound = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);
    // The mod's own archive holds the units table; its loose files the names, a sound and a table the game has as it is.
    const mod = new Creator({ listfile: true });
    mod.addFile("arr\\units.dat", unitsDat);
    const modMpq = mod.write();
    const ab = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;
    const req: ExtractRequest = {
      kind: "extract", from: "test", profile: { id: "made", name: "Made" },
      archives: [{ name: "StarDat.mpq", bytes: ab(stardat) }, { name: "BrooDat.mpq", bytes: ab(broodat) }, { name: "made.mpq", bytes: ab(modMpq) }],
      overlay: [{ path: "rez/unitnames.tbl", bytes: ab(unitNames) }, { path: "arr/weapons.dat", bytes: ab(game.readFile("arr\\weapons.dat")) }],
      hashOnly: [{ path: "sound/made/new.wav", data: new Blob([ab(sound)]) }],
    };
    const replies: ExtractResponse[] = [];
    const done = new Promise<ExtractResponse>((resolve) => {
      (globalThis as unknown as { self: unknown }).self = { postMessage: (r: ExtractResponse) => { replies.push(r); if (r.kind !== "progress") resolve(r); } };
    });
    await import("../src/gamedata/extract.worker");
    const worker = (globalThis as unknown as { self: { onmessage: (e: { data: ExtractRequest }) => Promise<void> } }).self;
    await worker.onmessage({ data: req });
    const reply = await done;
    if (reply.kind === "error") throw new Error(reply.message);
    expect(reply.kind).toBe("done");
    const stamp = (reply as Extract<ExtractResponse, { kind: "done" }>).stamp;
    expect(datCount(decodeUnitsDat(new Uint8Array((reply as Extract<ExtractResponse, { kind: "done" }>).files!.find(([p]) => p === "arr/units.dat")![1])).flingy)).toBe(MADE_UNITS);
    expect(stamp.hash).toBe(await dataSetHash([
      { name: "arr/units.dat", bytes: unitsDat }, { name: "rez/unitnames.tbl", bytes: unitNames }, { name: "sound/made/new.wav", bytes: sound },
    ]));
    // The two the game has not got are named as counted for want of a base; units.dat differs from the game's.
    expect(stamp.hashUnbased).toEqual(["rez\\unitnames.tbl", "sound\\made\\new.wav"]);
  }, 180_000);
});

describe.skipIf(!haveArchives)("a copy extracted from the game's archives", () => {
  it("keeps every arr\\ table, portraits and campaign maps among them, byte for byte", () => {
    const archive = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(join(FIXTURE_DATA, name))) });
    const read = readerFor(openArchives([archive("StarDat.mpq"), archive("BrooDat.mpq")]).archives);
    const { files } = extractUnits(read);
    for (const member of ["arr\\portdata.dat", "arr\\portdata.tbl", "arr\\mapdata.dat", "arr\\mapdata.tbl", "arr\\orders.dat", "arr\\sfxdata.tbl"]) {
      const kept = files.get(storedPathOf(member));
      const game = read(member)!;
      expect(kept, member).toBeDefined();
      expect(kept!.length, member).toBe(game.length);
      expect(kept!.every((b, i) => b === game[i]), member).toBe(true);
    }
    expect([...files.keys()].filter((p) => p.startsWith("arr/")).length).toBe(15);
  }, 60_000);
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
