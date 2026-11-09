import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScenario, serializeScenario } from "../src/formats/chk/scenario";
import { loadMap } from "../src/formats/mpq/scm";
import { tileGroup } from "../src/formats/chk/sections/terrain";
import { UNIT_TYPES } from "../src/formats/chk/sections/settings";
import { decodeUnitsDat } from "../src/formats/dat/dat";
import { decodeCv5 } from "../src/formats/tileset/decode";
import { cosmonarchyFile, haveCosmonarchy } from "./support/modFiles";
import { decodeTechdataDat, decodeUpgradesDat } from "../src/formats/dat/dat";
import { decodeTblEntries } from "../src/formats/dat/tbl";
import { namesFromAssets, unitCatalogue } from "../src/data/gameNames";
import { installNames, techName } from "../src/data/units";
import { nameFileText } from "../src/formats/mod/data";
import { triggerNames } from "../src/editor/triggers";
import { formatTriggers, parseTriggers } from "../src/formats/triggers/text";
import { actionDef, conditionDef } from "../src/data/triggerDefs";

/**
 * Cosmonarchy's maps, the corpus for maps made with a data set wider than the game's: unit
 * ids to 666 in UNIT, tile groups past 2,048 in MTXM, the settings sections at the format's
 * own size. Every one must open through the editor's parse and come back byte for byte.
 * The maps are read from `SCMJS_COSMONARCHY_MAPS`, or the download's
 * `cmbw-root-tree/CMBW-maps` under `SCMJS_COSMONARCHY`; without them this skips.
 */
const root = process.env.SCMJS_COSMONARCHY ?? "";
const mapsDir = process.env.SCMJS_COSMONARCHY_MAPS ?? (root ? join(root, "cmbw-root-tree/CMBW-maps") : "");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.sc[mx]$/i.test(name)) out.push(path);
  }
  return out;
}

const maps = mapsDir && existsSync(mapsDir) ? walk(mapsDir) : [];

describe.skipIf(maps.length === 0)("Cosmonarchy's maps", () => {
  it("open through the editor's parse and save byte for byte", async () => {
    const failed: string[] = [];
    let opened = 0, same = 0, maxUnit = 0, maxGroup = 0, past227 = 0;
    for (const path of maps) {
      try {
        const loaded = await loadMap(new Uint8Array(readFileSync(path)));
        const scn = parseScenario(loaded.chk);
        opened++;
        if (Buffer.from(serializeScenario(scn)).equals(Buffer.from(loaded.chk))) same++;
        else failed.push(`${path.slice(mapsDir.length + 1)}: saves differently`);
        for (const u of scn.units) { maxUnit = Math.max(maxUnit, u.unitId); if (u.unitId >= UNIT_TYPES) past227++; }
        // Twelve bits: Cosmonarchy's tilesets have more than 2,048 groups.
        for (const id of scn.tiles) maxGroup = Math.max(maxGroup, tileGroup(id, 4096));
        // The settings sections stay the format's size whatever the data set.
        if (scn.unitSettings) expect(scn.unitSettings.useDefault.length).toBe(UNIT_TYPES);
      } catch (err) {
        failed.push(`${path.slice(mapsDir.length + 1)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log(`Cosmonarchy maps: ${maps.length} found, ${opened} open, ${same} save byte for byte; units to id ${maxUnit} (${past227} placed past 227), tile groups to ${maxGroup}`);
    expect(failed).toEqual([]);
    expect(opened).toBe(maps.length);
  }, 600_000);

  it.skipIf(!haveCosmonarchy)("the release's tables and tilesets are wide enough for them", () => {
    const units = decodeUnitsDat(cosmonarchyFile("release/mpq/arr/units.datex"), "units.datex");
    expect(units.flingy.length).toBe(3000);
    expect(decodeCv5(cosmonarchyFile("release/mpq/tileset/badlands.cv5")).length).toBe(4094);
  });
});

/** The set's names as the editor installs them from the release's files. */
function installCosmonarchy(): void {
  const mpq = (p: string) => cosmonarchyFile(`release/mpq/${p}`);
  const units = decodeUnitsDat(mpq("arr/units.datex"), "units.datex");
  const assets = {
    units, statTxt: decodeTblEntries(mpq("rez/stat_txt.tbl")), unitNames: decodeTblEntries(mpq("rez/unitnames.tbl")),
    weapons: null, upgrades: decodeUpgradesDat(mpq("arr/upgrades.datex"), "upgrades.datex"), techs: decodeTechdataDat(mpq("arr/techdata.datex"), "techdata.datex"),
    nameTexts: { stat: nameFileText(mpq("rez/stat.txt")), upgrades: nameFileText(mpq("arr/upgrades.txt")), techdata: nameFileText(mpq("arr/techdata.txt")) },
  };
  const names = namesFromAssets(assets);
  installNames(names, unitCatalogue(assets, names));
}

describe.skipIf(maps.length === 0 || !haveCosmonarchy)("Cosmonarchy's maps under its own names", () => {
  it("every map's triggers come back from the text format unit for unit", async () => {
    installCosmonarchy();
    try {
      expect(techName(1)).toBe("Lobotomy Grenade (Francisco Goska)");
      const failed: string[] = [];
      let lists = 0;
      for (const path of maps) {
        const scn = parseScenario((await loadMap(new Uint8Array(readFileSync(path)))).chk);
        for (const [list, briefing] of [[scn.triggers, false], [scn.briefing, true]] as const) {
          if (!list?.length) continue;
          lists++;
          const names = triggerNames(scn);
          const text = formatTriggers(list, names, briefing);
          const back = parseTriggers(text, names, briefing).map((t) => t.trigger);
          // The unit arguments only: a record's unit field under a type that takes none is not in the text.
          const ids = (l: typeof list) => l.flatMap((t) => [
            ...t.conditions.filter((c) => conditionDef(c.type)?.args.some((a) => a.kind === "unit")).map((c) => c.unitId),
            ...t.actions.filter((a) => actionDef(a.type, briefing)?.args.some((x) => x.kind === "unit")).map((a) => a.unitId),
          ]);
          if (JSON.stringify(ids(back)) !== JSON.stringify(ids(list)) || formatTriggers(back, names, briefing) !== text) failed.push(path.slice(mapsDir.length + 1));
        }
      }
      console.log(`Cosmonarchy maps: ${lists} trigger lists round-tripped under the set's names`);
      expect(failed).toEqual([]);
    } finally {
      installNames(null);
    }
  }, 600_000);
});
