import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScenario, scenarioName, serializeScenario, mapVersionOf } from "../src/formats/chk/scenario";
import { loadMap, readMembers } from "../src/formats/mpq/scm";
import { referencedMembers, soundList } from "../src/editor/sounds";
import { validateScenario } from "../src/editor/validate";
import { isLocationUsed } from "../src/formats/chk/sections/objects";
import { parseWavHeader } from "../src/formats/wav";
import { getString } from "../src/formats/chk/sections/strings";
import { testMap, testMapFiles } from "./support/maps";
import { testMaps } from "./support/testMaps";

/**
 * `tests/maps/` holds maps the repository can carry: built by `support/testMaps.ts` from
 * the editor's own code, with nothing of Blizzard's in them. These tests keep the files
 * and that code in step, and pin down what each map has in it — the other suites open
 * them expecting to find it.
 */
const open = async (name: string) => {
  const loaded = await loadMap(new Uint8Array(readFileSync(testMap(name))));
  return { loaded, scn: parseScenario(loaded.chk) };
};
const sectionNames = (scn: ReturnType<typeof parseScenario>) => scn.chk.sections.map((s) => s.name);

describe("the committed maps", () => {
  const built = testMaps();

  it("are the ones the generator makes, and no others", () => {
    expect(testMapFiles().map((f) => f.name)).toEqual(built.map((m) => m.name).sort());
  });

  // The scenario and the members rather than the archive's bytes: those are what the maps
  // are for, and a change in how the archive writer lays a file out is not a change here.
  it.each(built)("$name is what `npm run test:maps` writes", async (map) => {
    const { loaded, scn } = await open(map.name);
    expect(Buffer.from(loaded.chk).equals(Buffer.from(serializeScenario(map.scenario))), "run `npm run test:maps`").toBe(true);
    const { extras } = await readMembers(loaded.archive!, loaded.files, referencedMembers(scn));
    expect([...extras.keys()]).toEqual([...map.extras.keys()]);
    for (const [name, data] of map.extras) expect(extras.get(name)).toEqual(data);
    expect(loaded.files === null).toBe(!map.listfile);
    expect(loaded.scenarioInfo).toMatchObject({ compression: map.compress, encrypted: map.encrypt });
  });

  it.each(built)("$name opens without a warning and passes Check Map's errors", async (map) => {
    const { scn } = await open(map.name);
    expect(scn.warnings).toEqual([]);
    expect(validateScenario(scn).filter((p) => p.level === "error")).toEqual([]);
    expect(serializeScenario(scn)).toEqual((await open(map.name)).loaded.chk);
  });

  it("melee.scx is a plain Brood War map in StarEdit's archive layout", async () => {
    const { loaded, scn } = await open("melee.scx");
    expect(scenarioName(scn)).toBe("Test Melee");
    expect(mapVersionOf(scn.fileVersion)).toBe("broodwar");
    expect(loaded.scenarioInfo).toMatchObject({ compression: "pkware", encrypted: true, sectorSize: 4096 });
    expect(scn.units.filter((u) => u.unitId === 214)).toHaveLength(2);
    expect(scn.units.filter((u) => u.unitId === 176)).toHaveLength(12);
    expect(scn.triggers).toEqual([]);
  });

  it("ums.scx has triggers, a briefing, locations, a sound, a properties slot and a renamed unit", async () => {
    const { loaded, scn } = await open("ums.scx");
    expect(scn.triggers).toHaveLength(3);
    expect(scn.briefing).toHaveLength(1);
    expect(scn.locations.filter(isLocationUsed)).toHaveLength(4); // three and Anywhere
    expect(scn.sprites).toHaveLength(2);
    expect(scn.cuwpUsed[0]).toBe(true);
    expect(getString(scn.strings, scn.unitSettings.nameIndex[0])).toBe("Test Marine");
    expect(getString(scn.strings, scn.switchNames![0])).toBe("Alarm raised");
    expect(scn.forces.nameIndex.slice(0, 2).map((i) => getString(scn.strings, i))).toEqual(["Defenders", "Swarm"]);
    const { extras } = await readMembers(loaded.archive!, loaded.files, referencedMembers(scn));
    const sounds = soundList(scn, extras);
    expect(sounds).toHaveLength(1);
    expect(sounds[0]).toMatchObject({ present: true, usedBy: ["Trigger 1: Play WAV"] });
    expect(parseWavHeader(extras.get(sounds[0].member!)!)).toMatchObject({ channels: 1, sampleRate: 11025 });
  });

  it("original.scm and hybrid.scm carry the settings sections of their revisions", async () => {
    const o = (await open("original.scm")).scn;
    expect(mapVersionOf(o.fileVersion)).toBe("original");
    expect(sectionNames(o)).toEqual(expect.arrayContaining(["UNIS", "UPGS", "TECS", "UPGR", "PTEC"]));
    for (const x of ["UNIx", "UPGx", "TECx", "PUPx", "PTEx"]) expect(sectionNames(o)).not.toContain(x);
    const h = (await open("hybrid.scm")).scn;
    expect(mapVersionOf(h.fileVersion)).toBe("hybrid");
    expect(sectionNames(h)).toEqual(expect.arrayContaining(["UNIS", "UNIx", "UPGS", "UPGx", "TECS", "TECx", "UPGR", "PUPx", "PTEC", "PTEx"]));
  });

  it("remastered.scx has the wide string table, text outside Latin-1, its own colours and no file list", async () => {
    const { loaded, scn } = await open("remastered.scx");
    expect(mapVersionOf(scn.fileVersion)).toBe("remastered");
    expect(loaded.files).toBeNull();
    expect(sectionNames(scn)).toContain("STRx");
    expect(sectionNames(scn)).not.toContain("STR ");
    expect(scenarioName(scn)).toBe("Test Remastered 리마스터");
    expect(scn.playerRgb!.rgb[0]).toEqual([0x20, 0x90, 0xd0]);
  });
});
