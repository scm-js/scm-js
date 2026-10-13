import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeSfxdataDat, decodeUnitsDat, VOICED_UNITS, type UnitsDat } from "../src/formats/dat/dat";
import { decodeTbl } from "../src/formats/dat/tbl";
import { buildStockSounds, findStockSound, isStockPath, searchStockSounds } from "../src/editor/stockSounds";
import { UNIT_NAMES } from "../src/data/units";

const PUBLIC = join(import.meta.dirname, "..", "public");
const read = (rel: string) => new Uint8Array(readFileSync(join(PUBLIC, rel)));
const have = ["arr/units.dat", "arr/sfxdata.dat", "arr/sfxdata.tbl"].every((f) => existsSync(join(PUBLIC, f)));

/** Sound ids 1–6 play table entries 1–6; unit 0 is trained with 1, says 2–3 when clicked and 4 when ordered. */
function voices(): UnitsDat {
  const zero = (n: number) => new Uint16Array(n);
  const units = {
    readySound: zero(VOICED_UNITS), whatSoundStart: zero(228), whatSoundEnd: zero(228),
    annoyedSoundStart: zero(VOICED_UNITS), annoyedSoundEnd: zero(VOICED_UNITS), yesSoundStart: zero(VOICED_UNITS), yesSoundEnd: zero(VOICED_UNITS),
  };
  units.readySound[0] = 1;
  units.whatSoundStart[0] = 2; units.whatSoundEnd[0] = 3;
  units.yesSoundStart[0] = 4; units.yesSoundEnd[0] = 4;
  // A hero with the same clicks, and a building past the voiced units with a "what" only.
  units.whatSoundStart[20] = 2; units.whatSoundEnd[20] = 3;
  units.whatSoundStart[110] = 5; units.whatSoundEnd[110] = 5;
  return units as unknown as UnitsDat;
}
const NAMES = ["Terran\\Marine\\TMaRdy00.wav", "Terran\\Marine\\TMaWht00.wav", "Terran\\MARINE\\TMaWht01.wav", "Terran\\Marine\\TMaYes00.wav", "Misc\\Button.wav", "Bullet\\TMaFir00.wav"];
const sfx = { file: Uint32Array.from([0, 1, 2, 3, 4, 5, 6]) };
const unitName = (id: number) => UNIT_NAMES[id] ?? "";
const kindName = (k: string) => k;

describe("stock sounds", () => {
  it("lists every file under sound\\ with the folder it is grouped by", () => {
    const stock = buildStockSounds(NAMES, sfx, voices());
    expect(stock.sounds.map((s) => s.path)).toEqual([
      "sound\\Terran\\Marine\\TMaRdy00.wav", "sound\\Terran\\Marine\\TMaWht00.wav", "sound\\Terran\\MARINE\\TMaWht01.wav", "sound\\Terran\\Marine\\TMaYes00.wav",
      "sound\\Misc\\Button.wav", "sound\\Bullet\\TMaFir00.wav",
    ]);
    expect(stock.sounds[0]).toMatchObject({ folder: "Terran\\Marine", file: "TMaRdy00.wav" });
    expect(stock.sounds[2]).toMatchObject({ folder: "Terran\\Marine", path: "sound\\Terran\\MARINE\\TMaWht01.wav" });
  });

  it("says whose voice a sound is, and when", () => {
    const stock = buildStockSounds(NAMES, sfx, voices());
    expect(findStockSound(stock, "sound/terran/marine/tmawht00.WAV")?.voices).toEqual([{ unit: 0, kind: "what" }, { unit: 20, kind: "what" }]);
    expect(stock.byUnit.get(0)?.map((l) => `${l.kind} ${l.sound.file}`)).toEqual(["ready TMaRdy00.wav", "what TMaWht00.wav", "what TMaWht01.wav", "yes TMaYes00.wav"]);
    expect(stock.byUnit.get(110)?.map((l) => l.sound.file)).toEqual(["Button.wav"]);
    expect(findStockSound(stock, "sound\\Bullet\\TMaFir00.wav")?.voices).toEqual([]);
  });

  it("is complete without the unit tables, and keeps one entry for a repeated file", () => {
    const stock = buildStockSounds([...NAMES, "misc\\BUTTON.wav", ""], null, null);
    expect(stock.sounds).toHaveLength(6);
    expect(stock.byUnit.size).toBe(0);
  });

  it("finds by path, unit name and moment together", () => {
    const stock = buildStockSounds(NAMES, sfx, voices());
    const find = (q: string) => searchStockSounds(stock, q, unitName, kindName).map((s) => s.file);
    expect(find("marine yes")).toEqual(["TMaYes00.wav"]);
    expect(find("BUTTON")).toEqual(["Button.wav"]);
    expect(find(unitName(20).toLowerCase())).toEqual(["TMaWht00.wav", "TMaWht01.wav"]);
    expect(find("")).toHaveLength(6);
    expect(find("marine nothing")).toEqual([]);
  });

  it("tells a path into the game's sound folder from a map's own", () => {
    expect(isStockPath("Sound/Zerg/Drone/ZDrErr00.wav")).toBe(true);
    expect(isStockPath("staredit\\wav\\boom.wav")).toBe(false);
  });
});

describe.skipIf(!have)("the game's own sound tables (public/arr)", () => {
  const stock = () => buildStockSounds(decodeTbl(read("arr/sfxdata.tbl")), decodeSfxdataDat(read("arr/sfxdata.dat")), decodeUnitsDat(read("arr/units.dat")));

  it("names the Marine's lines", () => {
    const lines = stock().byUnit.get(0)!.map((l) => `${l.kind} ${l.sound.path.toLowerCase()}`);
    expect(lines).toContain("ready sound\\terran\\marine\\tmardy00.wav");
    expect(lines.filter((l) => l.startsWith("yes "))).toHaveLength(4);
    expect(lines.filter((l) => l.startsWith("what "))).toHaveLength(4);
    expect(lines.filter((l) => l.startsWith("annoyed ")).length).toBeGreaterThan(4);
  });

  it("covers the table, and every voice points at a listed file", () => {
    const s = stock();
    expect(s.sounds.length).toBeGreaterThan(1000);
    expect(s.byUnit.size).toBeGreaterThan(100);
    for (const lines of s.byUnit.values()) for (const l of lines) expect(s.byPath.get(l.sound.path.toLowerCase())).toBe(l.sound);
  });
});
