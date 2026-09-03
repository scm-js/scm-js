import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createScenario, rawCreatedSections, REQUIRED_EXPANSION_SECTIONS, REQUIRED_ORIGINAL_SECTIONS, requiredSections } from "../src/formats/chk/create";
import { parseChk } from "../src/formats/chk/reader";
import {
  markDirty, parseScenario, serializeScenario, setMapVersion, techRestrictionSections, techSettingsSections, upgradeRestrictionSections, upgradeSettingsSections,
} from "../src/formats/chk/scenario";
import {
  decodeTechRestrictions, decodeTechSettings, decodeUpgradeRestrictions, decodeUpgradeSettings, DEFAULT_UPGRADE_MAX,
  defaultTechRestrictions, defaultTechSettings, defaultUpgradeRestrictions, defaultUpgradeSettings,
  encodeTechRestrictions, encodeTechSettings, encodeUpgradeRestrictions, encodeUpgradeSettings,
  PTEC_SIZE, PTEX_SIZE, PUPX_SIZE, TECHS_BW, TECHS_ORIGINAL, TECS_SIZE, TECX_SIZE, techIndex, techState,
  UPGR_SIZE, UPGRADES_BW, UPGRADES_ORIGINAL, UPGS_SIZE, UPGX_SIZE, upgradeIndex, upgradeLevels,
} from "../src/formats/chk/sections/settings";
import { decodeWavs, encodeWavs, WAV_SIZE, WAV_SLOTS } from "../src/formats/chk/sections/sounds";
import { defaultVcod, VCOD_SIZE } from "../src/formats/chk/sections/vcod";
import { decodeTechdataDat, decodeUpgradesDat, TECHDATA_DAT_SIZE, UPGRADES_DAT_SIZE } from "../src/formats/dat/dat";
import { applyTechSettings, applyUpgradeSettings, readTechSettings, readUpgradeSettings } from "../src/editor/settings";
import { isUnusedTech, isUnusedUpgrade, TECH_NAMES, TECH_RACE, UPGRADE_NAMES, UPGRADE_RACE } from "../src/data/units";
import { loadMap } from "../src/formats/mpq/scm";

const names = (bytes: Uint8Array) => parseChk(bytes).sections.map((s) => s.name);
const sectionData = (bytes: Uint8Array, name: string) => parseChk(bytes).sections.find((s) => s.name === name)?.data;

function fresh() {
  return parseScenario(serializeScenario(createScenario({ width: 64, height: 64, era: 4, name: "T", description: "d" })));
}

describe("upgrade settings (UPGS / UPGx)", () => {
  it("encodes both layouts at their fixed sizes and round-trips", () => {
    const s = defaultUpgradeSettings();
    s.useDefault[0] = 0;
    s.mineralCost[0] = 150;
    s.mineralFactor[0] = 25;
    s.timeCost[60] = 999;
    const upgs = encodeUpgradeSettings(s, UPGRADES_ORIGINAL);
    const upgx = encodeUpgradeSettings(s, UPGRADES_BW);
    expect(upgs.length).toBe(UPGS_SIZE);
    expect(upgx.length).toBe(UPGX_SIZE);
    expect(upgx[UPGRADES_BW]).toBe(0); // the unused byte after the use-default column
    expect(decodeUpgradeSettings(upgx)).toEqual(s);
    const short = decodeUpgradeSettings(upgs);
    expect(short.useDefault[0]).toBe(0);
    expect(short.mineralCost[0]).toBe(150);
    expect(short.mineralFactor[0]).toBe(25);
    expect(short.timeCost[60]).toBe(0); // UPGS has no room past 46
    expect(short.useDefault[60]).toBe(1);
  });
});

describe("upgrade restrictions (UPGR / PUPx)", () => {
  it("round-trips player-major and re-strides the 46-wide layout", () => {
    const r = defaultUpgradeRestrictions();
    r.playerUsesDefault[upgradeIndex(3, 7)] = 0;
    r.playerMax[upgradeIndex(3, 7)] = 2;
    r.playerStart[upgradeIndex(3, 7)] = 1;
    r.playerMax[upgradeIndex(11, 45)] = 9;
    r.playerMax[upgradeIndex(11, 46)] = 9;
    r.defaultStart[16] = 1;
    const pupx = encodeUpgradeRestrictions(r, UPGRADES_BW);
    const upgr = encodeUpgradeRestrictions(r, UPGRADES_ORIGINAL);
    expect(pupx.length).toBe(PUPX_SIZE);
    expect(upgr.length).toBe(UPGR_SIZE);
    expect(pupx[3 * 61 + 7]).toBe(2);
    expect(upgr[3 * 46 + 7]).toBe(2);
    expect(pupx[61 * 12 + 3 * 61 + 7]).toBe(1);
    expect(decodeUpgradeRestrictions(pupx)).toEqual(r);
    const back = decodeUpgradeRestrictions(upgr);
    expect(back.playerMax[upgradeIndex(3, 7)]).toBe(2);
    expect(back.playerMax[upgradeIndex(11, 44)]).toBe(DEFAULT_UPGRADE_MAX[44]);
    expect(back.playerMax[upgradeIndex(11, 45)]).toBe(9); // the last id UPGR holds
    expect(back.playerMax[upgradeIndex(11, 46)]).toBe(DEFAULT_UPGRADE_MAX[46]); // past 46: the model's default
    expect(upgradeLevels(r, 3, 7)).toEqual({ start: 1, max: 2 });
    expect(upgradeLevels(r, 2, 7)).toEqual({ start: 0, max: 3 });
    expect(upgradeLevels(r, 0, 16)).toEqual({ start: 1, max: 1 });
  });

  it("defaults every player to the dat level caps", () => {
    const r = defaultUpgradeRestrictions();
    expect(DEFAULT_UPGRADE_MAX.length).toBe(UPGRADES_BW);
    for (let p = 0; p < 12; p++) for (let u = 0; u < UPGRADES_BW; u++) expect(r.playerMax[upgradeIndex(p, u)]).toBe(DEFAULT_UPGRADE_MAX[u]);
    expect(r.playerUsesDefault.every((v) => v === 1)).toBe(true);
  });
});

describe("technology settings (TECS / TECx, PTEC / PTEx)", () => {
  it("encodes both layouts and round-trips", () => {
    const s = defaultTechSettings();
    s.useDefault[1] = 0;
    s.energyCost[1] = 75;
    s.researchTime[43] = 5;
    const tecs = encodeTechSettings(s, TECHS_ORIGINAL);
    const tecx = encodeTechSettings(s, TECHS_BW);
    expect(tecs.length).toBe(TECS_SIZE);
    expect(tecx.length).toBe(TECX_SIZE);
    expect(decodeTechSettings(tecx)).toEqual(s);
    const short = decodeTechSettings(tecs);
    expect(short.energyCost[1]).toBe(75);
    expect(short.researchTime[43]).toBe(0);

    const r = defaultTechRestrictions();
    r.playerUsesDefault[techIndex(5, 2)] = 0;
    r.playerAvailable[techIndex(5, 2)] = 0;
    r.playerResearched[techIndex(0, 0)] = 1;
    r.playerUsesDefault[techIndex(0, 0)] = 0;
    r.defaultResearched[40] = 1;
    const ptex = encodeTechRestrictions(r, TECHS_BW);
    const ptec = encodeTechRestrictions(r, TECHS_ORIGINAL);
    expect(ptex.length).toBe(PTEX_SIZE);
    expect(ptec.length).toBe(PTEC_SIZE);
    expect(ptex[5 * 44 + 2]).toBe(0);
    expect(ptec[5 * 24 + 2]).toBe(0);
    expect(decodeTechRestrictions(ptex)).toEqual(r);
    expect(decodeTechRestrictions(ptec).defaultResearched[40]).toBe(0);
    expect(techState(r, 5, 2)).toEqual({ available: false, researched: false });
    expect(techState(r, 0, 0)).toEqual({ available: true, researched: true });
    expect(techState(r, 1, 40)).toEqual({ available: true, researched: true });
  });
});

describe("WAV table", () => {
  it("is 512 string indices", () => {
    const w = decodeWavs(new Uint8Array(0));
    expect(w.length).toBe(WAV_SLOTS);
    w[0] = 12;
    w[511] = 70000;
    const bytes = encodeWavs(w);
    expect(bytes.length).toBe(WAV_SIZE);
    expect(decodeWavs(bytes)).toEqual(w);
  });
});

describe("a new scenario", () => {
  it("writes every section the game requires, with StarEdit's verification table", () => {
    const out = serializeScenario(createScenario({ width: 64, height: 64, era: 0, name: "n" }));
    const have = names(out);
    for (const name of requiredSections(205)) expect(have, name).toContain(name);
    // Blizzard's Brood War maps carry only the `x` layouts; the original ones belong to 1.00 / hybrid files.
    for (const name of REQUIRED_ORIGINAL_SECTIONS) expect(have, name).not.toContain(name);
    expect(requiredSections(59)).toEqual(expect.arrayContaining(REQUIRED_ORIGINAL_SECTIONS));
    expect(requiredSections(59)).not.toEqual(expect.arrayContaining(REQUIRED_EXPANSION_SECTIONS));
    expect(requiredSections(63)).toEqual(expect.arrayContaining([...REQUIRED_ORIGINAL_SECTIONS, ...REQUIRED_EXPANSION_SECTIONS]));
    expect(have).toContain("IVE2");
    expect(sectionData(out, "VCOD")!.length).toBe(VCOD_SIZE);
    expect(defaultVcod().length).toBe(VCOD_SIZE);
    expect(Array.from(sectionData(out, "VCOD")!)).toEqual(Array.from(defaultVcod()));
    // The opcode bytes at the end of the table are StarEdit's fixed sequence.
    expect(Array.from(defaultVcod().subarray(1024))).toEqual([1, 4, 5, 6, 2, 1, 5, 2, 0, 3, 7, 7, 5, 4, 6, 3]);
    expect(sectionData(out, "UPRP")!.length).toBe(1280);
    expect(sectionData(out, "UPUS")!.length).toBe(64);
    expect(sectionData(out, "MASK")!.every((b) => b === 0xff)).toBe(true);
    expect(rawCreatedSections().map((s) => s.name)).toEqual(["IVE2", "VCOD"]);

    const back = parseScenario(out);
    expect(back.upgradeSettings!.useDefault.every((v) => v === 1)).toBe(true);
    expect(back.upgradeRestrictions!.defaultMax[0]).toBe(3);
    expect(back.techSettings!.useDefault.every((v) => v === 1)).toBe(true);
    expect(back.techRestrictions!.defaultAvailable.every((v) => v === 1)).toBe(true);
    expect(back.wavs!.every((v) => v === 0)).toBe(true);
    expect(back.warnings).toEqual([]);
  });

  it("chooses the settings sections by revision, keeping whichever the file has", () => {
    const scn = fresh();
    expect(upgradeSettingsSections(scn)).toEqual(["UPGx"]);
    expect(techRestrictionSections(scn)).toEqual(["PTEx"]);
    const hybrid = fresh();
    setMapVersion(hybrid, "hybrid");
    expect(upgradeSettingsSections(hybrid).sort()).toEqual(["UPGS", "UPGx"]);
    expect(techRestrictionSections(hybrid).sort()).toEqual(["PTEC", "PTEx"]);
    const orig = fresh();
    orig.chk.sections = orig.chk.sections.filter((s) => !["UPGx", "PUPx", "TECx", "PTEx"].includes(s.name));
    setMapVersion(orig, "original");
    expect(upgradeSettingsSections(orig)).toEqual(["UPGS"]);
    expect(upgradeRestrictionSections(orig)).toEqual(["UPGR"]);
    expect(techSettingsSections(orig)).toEqual(["TECS"]);
    expect(techRestrictionSections(orig)).toEqual(["PTEC"]);
  });

  it("installs edited upgrade and tech tables as one transaction", () => {
    const scn = fresh();
    setMapVersion(scn, "hybrid"); // so both layouts get written and can be compared
    const up = readUpgradeSettings(scn);
    up.settings.useDefault[3] = 0;
    up.settings.gasCost[3] = 42;
    up.restrictions.playerUsesDefault[upgradeIndex(1, 3)] = 0;
    up.restrictions.playerStart[upgradeIndex(1, 3)] = 2;
    applyUpgradeSettings(scn, up.settings, up.restrictions);
    const te = readTechSettings(scn);
    te.settings.useDefault[8] = 0;
    te.settings.energyCost[8] = 100;
    te.restrictions.defaultResearched[8] = 1;
    applyTechSettings(scn, te.settings, te.restrictions);
    for (const n of ["UPGS", "UPGx", "UPGR", "PUPx", "TECS", "TECx", "PTEC", "PTEx"]) expect(scn.dirty.has(n), n).toBe(true);
    const back = parseScenario(serializeScenario(scn));
    expect(back.upgradeSettings!.gasCost[3]).toBe(42);
    expect(upgradeLevels(back.upgradeRestrictions!, 1, 3)).toEqual({ start: 2, max: 3 });
    expect(back.techSettings!.energyCost[8]).toBe(100);
    expect(techState(back.techRestrictions!, 4, 8).researched).toBe(true);
    // The original-layout copies carry the same values for the ids they can hold.
    expect(decodeUpgradeSettings(sectionData(serializeScenario(scn), "UPGS")!).gasCost[3]).toBe(42);
    expect(decodeTechRestrictions(sectionData(serializeScenario(scn), "PTEC")!).defaultResearched[8]).toBe(1);
  });
});

describe("names", () => {
  it("cover every dat id and mark the unused slots", () => {
    expect(UPGRADE_NAMES.length).toBe(UPGRADES_BW);
    expect(UPGRADE_RACE.length).toBe(UPGRADES_BW);
    expect(TECH_NAMES.length).toBe(TECHS_BW);
    expect(TECH_RACE.length).toBe(TECHS_BW);
    expect(UPGRADE_NAMES[47]).toBe("Argus Jewel");
    expect(TECH_NAMES[34]).toBe("Healing");
    expect(isUnusedUpgrade(45)).toBe(true);
    expect(isUnusedUpgrade(54)).toBe(false);
    expect(isUnusedTech(26)).toBe(true);
    expect(isUnusedTech(32)).toBe(false);
    // The unused slots are exactly the ones upgrades.dat / techdata.dat cannot research.
    UPGRADE_NAMES.forEach((n, i) => expect(n.startsWith("Unused"), n).toBe(isUnusedUpgrade(i)));
    TECH_NAMES.forEach((n, i) => expect(n.startsWith("Unused"), n).toBe(isUnusedTech(i)));
  });
});

const PUBLIC = join(import.meta.dirname, "..", "public");
const haveDat = existsSync(join(PUBLIC, "arr/upgrades.dat")) && existsSync(join(PUBLIC, "arr/techdata.dat"));

describe.skipIf(!haveDat)("upgrades.dat / techdata.dat", () => {
  it("decode the columns the settings dialogs show as defaults", () => {
    const up = decodeUpgradesDat(new Uint8Array(readFileSync(join(PUBLIC, "arr/upgrades.dat"))));
    const te = decodeTechdataDat(new Uint8Array(readFileSync(join(PUBLIC, "arr/techdata.dat"))));
    expect(UPGRADES_DAT_SIZE).toBe(1281);
    expect(TECHDATA_DAT_SIZE).toBe(836);
    // Terran Infantry Armor: 100 + 75 per level, 4000 frames + 480 per level, three levels.
    expect([up.mineralCost[0], up.mineralFactor[0], up.timeCost[0], up.timeFactor[0], up.maxRepeats[0]]).toEqual([100, 75, 4000, 480, 3]);
    expect(Array.from(up.maxRepeats)).toEqual(DEFAULT_UPGRADE_MAX);
    expect(up.broodWar[46]).toBe(1);
    expect(up.broodWar[45]).toBe(0);
    // Stim Packs 100/100, 80 seconds; Yamato Gun costs 150 energy; Restoration is the first Brood War ability.
    expect([te.mineralCost[0], te.vespeneCost[0], te.researchTime[0], te.energyCost[0]]).toEqual([100, 100, 1200, 0]);
    expect(te.energyCost[8]).toBe(150);
    expect(te.broodWar[23]).toBe(0);
    expect(te.broodWar[24]).toBe(1);
  });
});

const MAPS = join(import.meta.dirname, "..", "fixtures", "maps");
const fixtures = existsSync(MAPS) ? readdirSync(MAPS).filter((f) => /\.(scx|scm)$/i.test(f)) : [];

describe.skipIf(fixtures.length === 0)("fixture maps", () => {
  for (const file of fixtures) {
    it(`re-encodes the settings sections of ${file} byte for byte`, async () => {
      const { chk } = await loadMap(new Uint8Array(readFileSync(join(MAPS, file))));
      const scn = parseScenario(chk);
      const original = parseChk(chk).sections;
      const present = ["UPGS", "UPGx", "UPGR", "PUPx", "TECS", "TECx", "PTEC", "PTEx", "WAV "].filter((n) => original.some((s) => s.name === n));
      expect(present.length).toBeGreaterThan(0);
      markDirty(scn, ...present);
      const out = parseChk(serializeScenario(scn)).sections;
      for (const name of present) {
        const a = original.find((s) => s.name === name)!.data;
        const b = out.find((s) => s.name === name)!.data;
        expect(Array.from(b), name).toEqual(Array.from(a));
      }
    });
  }
});
