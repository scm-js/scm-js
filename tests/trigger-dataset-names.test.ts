/**
 * The text trigger format under a data set whose names collide with StarEdit's (C7 audit): a mod's
 * "Terran Civilian" at 332 read back as StarEdit's 15, silently, on every Compile. The loaded names
 * win, a name two types share is written as `Unit #id`, and the round trip is the identity.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { ConditionType, emptyCondition, emptyTrigger, PlayerGroup, UnitClass, type TriggerRecord } from "../src/formats/chk/sections/triggers";
import { formatTriggers, parseTriggers } from "../src/formats/triggers/text";
import { triggerNames } from "../src/editor/triggers";
import { installNames, UNIT_NAMES } from "../src/data/units";

afterEach(() => installNames(null));

/** A made data set of 400 types: 15 renamed, StarEdit's "Terran Civilian" moved to 332, "Floor Hatch" twice, a type called "Men". */
function installCollidingSet(): void {
  const units: (string | null)[] = Array.from({ length: 400 }, () => null);
  units[0] = "Terran Maverick";
  units[15] = "Terran Shaman";
  units[332] = "Terran Civilian";
  units[204] = "Floor Hatch";
  units[385] = "Floor Hatch";
  units[333] = "Men";
  for (let id = 228; id < 400; id++) units[id] ??= `Mod Unit ${id}`;
  installNames({ units, weapons: [], upgrades: [], techs: [] }, { count: 400, extended: [] });
}

function killTrigger(units: number[]): TriggerRecord {
  const t = emptyTrigger();
  t.players[PlayerGroup.Player1] = 1;
  t.conditions = units.map((unitId) => ({ ...emptyCondition(), type: ConditionType.Kill, player: PlayerGroup.Player1, unitId, comparison: 0, amount: 1 }));
  return t;
}

const map = () => createScenario({ width: 64, height: 64, era: 2, name: "T", description: "d" });
const UNITS = [332, 15, 0, 204, 385, 333, 1, UnitClass.Any, UnitClass.Men, 399];

describe("unit names under a data set", () => {
  it("reads the set's name before StarEdit's: Terran Civilian is 332, not 15", () => {
    installCollidingSet();
    const names = triggerNames(map());
    expect(names.unitByName("Terran Civilian")).toBe(332);
    expect(names.unitByName("Terran Shaman")).toBe(15);
    // A StarEdit name the set does not use still reads: older text keeps working.
    expect(names.unitByName("Terran Marine")).toBe(0);
    expect(names.unitByName("Unit #385")).toBe(385);
  });

  it("writes a name two types share, or a class's, as the id", () => {
    installCollidingSet();
    const names = triggerNames(map());
    expect(names.unit(204)).toBe("Unit #204");
    expect(names.unit(385)).toBe("Unit #385");
    expect(names.unit(333)).toBe("Unit #333");
    expect(names.unit(332)).toBe("Terran Civilian");
    expect(names.unit(UnitClass.Men)).toBe("Men");
  });

  it("round-trips text → triggers → text exactly, every unit the one written", () => {
    installCollidingSet();
    const scn = map();
    const names = triggerNames(scn);
    const text = formatTriggers([killTrigger(UNITS)], names);
    const back = parseTriggers(text, names).map((t) => t.trigger);
    expect(back[0].conditions.map((c) => c.unitId)).toEqual(UNITS);
    expect(formatTriggers(back, names)).toBe(text);
  });

  it("leaves the game's own names as they were", () => {
    const names = triggerNames(map());
    for (let id = 0; id < UNIT_NAMES.length; id++) {
      expect(names.unit(id)).toBe(UNIT_NAMES[id]);
      expect(names.unitByName(UNIT_NAMES[id])).toBe(id);
    }
  });
});
