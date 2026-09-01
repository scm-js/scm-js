import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Writer } from "../src/formats/chk/binary";
import { createScenario } from "../src/formats/chk/create";
import { parseChk } from "../src/formats/chk/reader";
import { mapVersionOf, parseScenario, serializeScenario, setMapVersion, unitSettingsSections } from "../src/formats/chk/scenario";
import { ColorMode, decodePlayerRgb, defaultPlayerRgb, encodePlayerRgb, ForceFlag, PlayerRace, PlayerType } from "../src/formats/chk/sections/players";
import {
  decodeUnitAvailability, decodeUnitSettings, defaultUnitAvailability, defaultUnitSettings, encodeUnitAvailability, encodeUnitSettings,
  isUnitAvailable, PUNI_SIZE, puniIndex, UNIS_SIZE, UNIX_SIZE, WEAPONS_BW, WEAPONS_ORIGINAL,
} from "../src/formats/chk/sections/settings";
import { getString } from "../src/formats/chk/sections/strings";
import {
  applyForceSettings, applyPlayerColors, applyPlayerSettings, applyUnitSettings, forceName, internString, readForceSettings, readPlayerSettings, readUnitSettings, unitCustomName,
} from "../src/editor/settings";
import { loadMap } from "../src/formats/mpq/scm";

function section(name: string, data: Uint8Array | number[]): Uint8Array {
  const body = data instanceof Uint8Array ? data : new Uint8Array(data);
  const w = new Writer(8 + body.length);
  for (let i = 0; i < 4; i++) w.u8(name.charCodeAt(i));
  w.i32(body.length);
  w.bytes(body);
  return w.finish();
}

const names = (bytes: Uint8Array) => parseChk(bytes).sections.map((s) => s.name);
const sectionData = (bytes: Uint8Array, name: string) => parseChk(bytes).sections.find((s) => s.name === name)?.data;

/** A fresh Brood War scenario, saved and re-read so it has a real CHK behind it. */
function fresh() {
  return parseScenario(serializeScenario(createScenario({ width: 64, height: 64, era: 4, name: "T", description: "d" })));
}

describe("CRGB", () => {
  it("round-trips the eight RGB triples and modes", () => {
    const rgb = defaultPlayerRgb();
    rgb.rgb[2] = [1, 2, 3];
    rgb.mode[2] = ColorMode.Custom;
    rgb.mode[5] = ColorMode.Random;
    const bytes = encodePlayerRgb(rgb);
    expect(bytes.length).toBe(32);
    expect(Array.from(bytes.subarray(6, 9))).toEqual([1, 2, 3]);
    expect(bytes[24 + 2]).toBe(ColorMode.Custom);
    expect(decodePlayerRgb(bytes)).toEqual(rgb);
  });

  it("is absent until a slot needs it, then written and removable", () => {
    const scn = fresh();
    expect(scn.playerRgb).toBeNull();
    applyPlayerColors(scn, [7, 1, 2, 3, 4, 5, 6, 0], null);
    let out = serializeScenario(scn);
    expect(names(out)).not.toContain("CRGB");
    expect(Array.from(sectionData(out, "COLR")!)).toEqual([7, 1, 2, 3, 4, 5, 6, 0]);

    const rgb = defaultPlayerRgb();
    rgb.mode[0] = ColorMode.Custom;
    rgb.rgb[0] = [250, 100, 50];
    applyPlayerColors(scn, [7, 1, 2, 3, 4, 5, 6, 0], rgb);
    out = serializeScenario(scn);
    const back = parseScenario(out);
    expect(back.playerRgb).toEqual(rgb);
    expect(names(out).indexOf("CRGB")).toBe(names(out).length - 1);

    applyPlayerColors(back, back.playerColors, null);
    expect(names(serializeScenario(back))).not.toContain("CRGB");
  });
});

describe("unit settings", () => {
  it("encodes the original and Brood War layouts at their fixed sizes", () => {
    const s = defaultUnitSettings();
    s.useDefault[0] = 0;
    s.hitPoints[0] = 40 * 256;
    s.buildTime[0] = 360;
    s.nameIndex[0] = 9;
    s.weaponDamage[0] = 7;
    s.weaponBonus[129] = 3;
    const unis = encodeUnitSettings(s, WEAPONS_ORIGINAL);
    const unix = encodeUnitSettings(s, WEAPONS_BW);
    expect(unis.length).toBe(UNIS_SIZE);
    expect(unix.length).toBe(UNIX_SIZE);
    expect(decodeUnitSettings(unix)).toEqual(s);
    // UNIS only has room for the first 100 weapons.
    const short = decodeUnitSettings(unis);
    expect(short.weaponDamage[0]).toBe(7);
    expect(short.weaponBonus[129]).toBe(0);
    expect(short.useDefault[0]).toBe(0);
    expect(short.hitPoints[0]).toBe(40 * 256);
    expect(short.nameIndex[0]).toBe(9);
  });

  it("round-trips PUNI player-major", () => {
    const a = defaultUnitAvailability();
    a.playerUsesDefault[puniIndex(3, 7)] = 0;
    a.playerAvailable[puniIndex(3, 7)] = 0;
    a.defaultAvailable[7] = 1;
    const bytes = encodeUnitAvailability(a);
    expect(bytes.length).toBe(PUNI_SIZE);
    expect(bytes[3 * 228 + 7]).toBe(0);
    expect(bytes[228 * 12 + 7]).toBe(1);
    expect(bytes[228 * 12 + 228 + 3 * 228 + 7]).toBe(0);
    expect(decodeUnitAvailability(bytes)).toEqual(a);
    expect(isUnitAvailable(a, 3, 7)).toBe(false);
    expect(isUnitAvailable(a, 2, 7)).toBe(true);
    a.defaultAvailable[7] = 0;
    expect(isUnitAvailable(a, 2, 7)).toBe(false);
  });

  it("writes the sections the file's revision reads", () => {
    const scn = fresh();
    // A new Brood War map carries the `x` layout on its defaults, as a StarEdit map does.
    expect(scn.unitSettings!.useDefault.every((v) => v === 1)).toBe(true);
    expect(unitSettingsSections(scn)).toEqual(["UNIx"]);
    const { settings, availability } = readUnitSettings(scn);
    settings.useDefault[5] = 0;
    settings.mineralCost[5] = 123;
    availability.playerUsesDefault[puniIndex(0, 5)] = 0;
    availability.playerAvailable[puniIndex(0, 5)] = 0;
    applyUnitSettings(scn, settings, availability, new Map([[5, "Big Tank"]]));
    expect(unitCustomName(scn, 5)).toBe("Big Tank");

    const out = serializeScenario(scn);
    expect(names(out)).toContain("UNIx");
    expect(names(out)).toContain("PUNI");
    expect(names(out)).not.toContain("UNIS");
    const back = parseScenario(out);
    expect(back.unitSettings!.mineralCost[5]).toBe(123);
    expect(back.unitSettings!.useDefault[5]).toBe(0);
    expect(back.unitSettings!.useDefault[6]).toBe(1);
    expect(unitCustomName(back, 5)).toBe("Big Tank");
    expect(isUnitAvailable(back.unitAvailability!, 0, 5)).toBe(false);
    expect(isUnitAvailable(back.unitAvailability!, 1, 5)).toBe(true);
  });

  it("keeps both settings sections on a hybrid map and drops to UNIS for the original game", () => {
    const scn = fresh();
    setMapVersion(scn, "hybrid");
    expect(unitSettingsSections(scn).sort()).toEqual(["UNIS", "UNIx"]);
    const { settings, availability } = readUnitSettings(scn);
    applyUnitSettings(scn, settings, availability, new Map());
    const out = names(serializeScenario(scn));
    expect(out).toContain("UNIS");
    expect(out).toContain("UNIx");

    const orig = fresh();
    orig.chk.sections = orig.chk.sections.filter((s) => s.name !== "UNIx"); // a file the original game wrote never had one
    setMapVersion(orig, "original");
    expect(unitSettingsSections(orig)).toEqual(["UNIS"]);
    // A file that already has UNIx keeps it up to date whatever the revision says.
    const both = parseScenario(serializeScenario(scn));
    setMapVersion(both, "original");
    expect(unitSettingsSections(both).sort()).toEqual(["UNIS", "UNIx"]);
  });

  it("reads UNIx over UNIS when a file has both", () => {
    const a = defaultUnitSettings();
    a.armor[1] = 5;
    const b = defaultUnitSettings();
    b.armor[1] = 9;
    const base = serializeScenario(createScenario({ width: 64, height: 64, era: 0, name: "x" }));
    const file = new Uint8Array([...base, ...section("UNIS", encodeUnitSettings(a, WEAPONS_ORIGINAL)), ...section("UNIx", encodeUnitSettings(b, WEAPONS_BW))]);
    expect(parseScenario(file).unitSettings!.armor[1]).toBe(9);
  });
});

describe("map revision", () => {
  it("maps VER to a revision", () => {
    expect(mapVersionOf(59)).toBe("original");
    expect(mapVersionOf(63)).toBe("hybrid");
    expect(mapVersionOf(205)).toBe("broodwar");
    expect(mapVersionOf(206)).toBe("remastered");
  });

  it("writes VER and TYPE and converts the string table to STRx and back", () => {
    const scn = fresh();
    setMapVersion(scn, "remastered");
    expect(scn.fileVersion).toBe(206);
    expect(scn.strings.extended).toBe(true);
    let out = serializeScenario(scn);
    expect(names(out)).toContain("STRx");
    expect(names(out)).not.toContain("STR ");
    const ver = sectionData(out, "VER ")!;
    expect(ver[0] | (ver[1] << 8)).toBe(206);

    const back = parseScenario(out);
    expect(back.strings.extended).toBe(true);
    expect(getString(back.strings, back.nameIndex)).toBe("T");
    setMapVersion(back, "hybrid");
    expect(back.type).toBe("RAWS");
    out = serializeScenario(back);
    expect(names(out)).toContain("STR ");
    expect(names(out)).not.toContain("STRx");
    expect(new TextDecoder().decode(sectionData(out, "TYPE"))).toBe("RAWS");
    expect(getString(parseScenario(out).strings, back.nameIndex)).toBe("T");
  });

  it("can keep STR on a Remastered map when asked", () => {
    const scn = fresh();
    setMapVersion(scn, "remastered", false);
    expect(scn.fileVersion).toBe(206);
    expect(scn.strings.extended).toBe(false);
    expect(scn.dirty.has("STRx")).toBe(false);
  });
});

describe("players and forces", () => {
  it("writes OWNR with IOWN, SIDE, COLR and FORC for what changed", () => {
    const scn = fresh();
    const p = readPlayerSettings(scn);
    p.types[0] = PlayerType.Computer;
    p.races[0] = PlayerRace.Zerg;
    p.force[1] = 2;
    applyPlayerSettings(scn, p);
    expect([...scn.dirty].filter((n) => ["OWNR", "IOWN", "SIDE", "COLR", "FORC"].includes(n)).sort()).toEqual(["FORC", "IOWN", "OWNR", "SIDE"]);
    const back = parseScenario(serializeScenario(scn));
    expect(back.playerTypes[0]).toBe(PlayerType.Computer);
    expect(back.playerRaces[0]).toBe(PlayerRace.Zerg);
    expect(back.forces.playerForce[1]).toBe(2);
    expect(sectionData(serializeScenario(scn), "IOWN")![0]).toBe(PlayerType.Computer);
  });

  it("renames forces by interning strings and sets flags", () => {
    const scn = fresh();
    const f = readForceSettings(scn);
    expect(f.names).toEqual(["Force 1", "Force 2", "Force 3", "Force 4"]);
    f.names[0] = "Attackers";
    f.names[1] = "Force 1"; // an existing string is reused, not duplicated
    f.flags[0] = ForceFlag.Allied | ForceFlag.SharedVision;
    const before = scn.strings.strings.length;
    applyForceSettings(scn, f);
    expect(scn.strings.strings.length).toBe(before + 1);
    expect(scn.forces.nameIndex[1]).toBe(scn.strings.strings.indexOf("Force 1"));
    const back = parseScenario(serializeScenario(scn));
    expect(forceName(back, 0)).toBe("Attackers");
    expect(forceName(back, 1)).toBe("Force 1");
    expect(back.forces.flags[0]).toBe(ForceFlag.Allied | ForceFlag.SharedVision);
  });

  it("interns the empty string as no name", () => {
    const scn = fresh();
    expect(internString(scn, "")).toBe(0);
  });
});

const MAPS = join(import.meta.dirname, "..", "fixtures", "maps");
const mapFiles = existsSync(MAPS) ? readdirSync(MAPS).filter((f) => /\.(scx|scm)$/i.test(f)) : [];

describe.skipIf(mapFiles.length === 0)("real maps", () => {
  it("re-encode their settings sections byte for byte", async () => {
    for (const file of mapFiles) {
      const scn = parseScenario((await loadMap(new Uint8Array(readFileSync(join(MAPS, file))))).chk);
      for (const name of ["UNIS", "UNIx", "PUNI", "COLR", "CRGB", "FORC", "OWNR", "SIDE"]) {
        const original = scn.chk.sections.filter((s) => s.name === name).at(-1);
        if (!original) continue;
        scn.dirty.add(name);
        const data = sectionData(serializeScenario(scn), name)!;
        expect(data.length, `${file} ${name}`).toBe(original.data.length);
        expect(Buffer.from(data).equals(Buffer.from(original.data)), `${file} ${name}`).toBe(true);
      }
    }
  });
});
