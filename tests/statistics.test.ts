import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario } from "../src/formats/chk/scenario";
import { ActionType, PlayerGroup, TriggerFlag } from "../src/formats/chk/sections/triggers";
import { UnitUsed } from "../src/formats/chk/sections/objects";
import { makeSprite } from "../src/editor/sprites";
import { makeUnit } from "../src/editor/units";
import { newAction, newTrigger } from "../src/editor/triggers";
import { mapStatistics, statisticsText } from "../src/editor/statistics";
import { START_LOCATION } from "../src/data/units";
import { loadMap } from "../src/formats/mpq/scm";

function fresh() {
  return createScenario({ width: 64, height: 64, era: 4, name: "T", description: "d" });
}

describe("map statistics", () => {
  it("counts units, resources, starts, sprites, locations and triggers", () => {
    const scn = fresh();
    scn.units.push(makeUnit(null, 0, 0, 100, 100, 1), makeUnit(null, 0, 0, 200, 100, 2), makeUnit(null, 7, 1, 300, 100, 3));
    scn.units.push(makeUnit(null, START_LOCATION, 0, 64, 64, 4), makeUnit(null, START_LOCATION, 1, 128, 64, 5));
    const field = makeUnit(null, 176, 11, 500, 500, 6);
    field.validStates |= UnitUsed.Resources;
    field.resourceAmount = 750;
    const geyser = makeUnit(null, 188, 11, 600, 500, 7);
    scn.units.push(field, geyser, makeUnit(null, 0, 13, 700, 700, 8));
    scn.sprites.push(makeSprite("pure", 5, 0, 10, 10), makeSprite("unit", 3, 0, 20, 20));
    scn.locations[0] = { left: 0, top: 0, right: 64, bottom: 64, nameIndex: 1, elevationFlags: 0 };
    const t = newTrigger([PlayerGroup.Player1]);
    t.actions.push(newAction(ActionType.Victory), newAction(ActionType.PreserveTrigger));
    const d = newTrigger([PlayerGroup.Player2]);
    d.flags |= TriggerFlag.Disabled;
    scn.triggers.push(t, d);
    scn.switchNames = Array.from({ length: 256 }, (_, i) => (i < 2 ? 1 : 0));
    scn.wavs![3] = 1;

    const s = mapStatistics(scn, null, null, null);
    expect([s.width, s.height, s.tileset, s.revision]).toEqual([64, 64, "Jungle World", "Brood War 1.04"]);
    expect(s.units.total).toBe(8);
    expect(s.units.buildings).toBeNull();
    expect(s.unownedUnits).toBe(1);
    expect(s.units.top[0]).toEqual({ id: 0, name: "Terran Marine", count: 3 });
    expect(s.players[0].units).toBe(3);
    expect(s.players[0].startLocations).toBe(1);
    expect(s.players[1].startLocations).toBe(1);
    expect(s.players[1].units).toBe(2);
    expect(s.players[11].units).toBe(2);
    expect(s.resources).toEqual({ minerals: 750, gas: 5000, fields: 1, geysers: 1 });
    expect(s.sprites).toEqual({ pure: 1, unit: 1 });
    expect(s.locations).toBe(1); // Anywhere is not counted
    expect(s.triggers).toEqual({ count: 2, conditions: 0, actions: 2, preserved: 1, disabled: 1 });
    expect(s.switchesNamed).toBe(2);
    expect(s.sounds).toBe(1);
    expect(s.strings.set).toBe(7);
    expect(s.terrain).toBeNull();
    const text = statisticsText(s);
    expect(text).toContain("3 × Terran Marine");
    expect(text).toContain("750 minerals in 1 fields");
    expect(text).toContain("buildings n/a");
  });
});

const MAPS = join(import.meta.dirname, "..", "fixtures", "maps");
const fixtures = existsSync(MAPS) ? readdirSync(MAPS).filter((f) => /\.(scx|scm)$/i.test(f)) : [];

describe.skipIf(fixtures.length === 0)("fixture maps", () => {
  for (const file of fixtures) {
    it(`sums to the record counts of ${file}`, async () => {
      const { chk } = await loadMap(new Uint8Array(readFileSync(join(MAPS, file))));
      const scn = parseScenario(chk);
      const s = mapStatistics(scn, null, null, null);
      expect(s.players.reduce((n, p) => n + p.units, 0) + s.unownedUnits).toBe(scn.units.length);
      expect(s.units.top.reduce((n, t) => n + t.count, 0)).toBeLessThanOrEqual(scn.units.length);
      expect(s.sprites.pure + s.sprites.unit).toBe(scn.sprites.length);
      expect(s.triggers.count).toBe(scn.triggers.length);
      expect(s.sections).toBe(scn.chk.sections.length);
      expect(s.players.filter((p) => p.startLocations > 0).length).toBeGreaterThan(0);
    });
  }
});
