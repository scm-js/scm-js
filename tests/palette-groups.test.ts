/**
 * The units palette's groups under a data set (C7 audit): StarEdit's groups hold ids 0–227 by what
 * the game made of them, so a mod's Zerg Liiralisk in the slot of a Terran building sat under Terran
 * Buildings. A type the data set renamed into something its StarEdit group no longer describes is
 * grouped by the set's own flags, as the types past 227 are; the game's own data moves nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { unitCatalogue } from "../src/data/gameNames";
import { dataSetUnitGroups, installNames, shownUnitGroups, starEditUnitGroups, UNIT_GROUPS, UNIT_NAMES, type LoadedNames } from "../src/data/units";
import { UnitFlag, type UnitsDat } from "../src/formats/dat/dat";

afterEach(() => installNames(null));

/** A units table of `count` types, every one a neutral non-building but where `set` says otherwise. */
function madeUnits(count: number, set: Record<number, { group: number; flags: number }>): UnitsDat {
  const groupFlags = new Uint8Array(count), flags = new Uint32Array(count);
  for (const [id, v] of Object.entries(set)) { groupFlags[Number(id)] = v.group; flags[Number(id)] = v.flags; }
  return { flingy: new Uint16Array(count), groupFlags, flags } as unknown as UnitsDat;
}

const ZERG = 1, TERRAN = 2;
const named = (units: Record<number, string>, count = 228): LoadedNames => ({
  units: Array.from({ length: count }, (_, id) => units[id] ?? null), weapons: [], upgrades: [], techs: [],
});
const every = (groups: { units: number[] }[]) => groups.flatMap((g) => g.units).sort((a, b) => a - b);

describe("the palette's groups", () => {
  it("are StarEdit's for the game's own data", () => {
    const units = madeUnits(228, { 112: { group: TERRAN, flags: UnitFlag.Building } });
    expect(unitCatalogue({ units }, null)).toBeNull();
    installNames(null, unitCatalogue({ units }, null));
    expect(starEditUnitGroups()).toBe(UNIT_GROUPS);
    expect(dataSetUnitGroups()).toEqual([]);
  });

  it("move a renamed type to the race its data gives, and leave one that still fits", () => {
    const units = madeUnits(228, {
      0: { group: TERRAN, flags: 0 }, // renamed, still a Terran unit: stays in Terran Units
      112: { group: ZERG, flags: 0 }, // a Terran building's slot holding a Zerg unit: moves
      16: { group: 4, flags: 0 }, // a Terran hero's slot holding a Protoss unit: moves
    });
    const names = named({ 0: "Terran Maverick", 112: "Zerg Liiralisk", 16: "Protoss Manifold" });
    installNames(names, unitCatalogue({ units }, names));
    const terranUnits = starEditUnitGroups().find((g) => g.label === "Terran Units")!;
    expect(terranUnits.units).toContain(0);
    expect(starEditUnitGroups().find((g) => g.label === "Terran Buildings")!.units).not.toContain(112);
    expect(dataSetUnitGroups().map((g) => [g.race, g.label, g.units])).toEqual([["zerg", "Zerg Units", [112]], ["protoss", "Protoss Units", [16]]]);
    const shown = shownUnitGroups("Made");
    expect(shown.find((g) => g.units.includes(112))?.label).toBe("Made · Zerg Units");
    // Every type is still listed exactly once.
    expect(every(shown)).toEqual(Array.from({ length: UNIT_NAMES.length }, (_, i) => i));
  });

  it("list the types past 227 after the moved ones, in id order", () => {
    const units = madeUnits(232, { 112: { group: ZERG, flags: 0 }, 229: { group: ZERG, flags: 0 } });
    const names = named({ 112: "Zerg Liiralisk" }, 232);
    installNames(names, unitCatalogue({ units }, names));
    expect(dataSetUnitGroups().find((g) => g.label === "Zerg Units")!.units).toEqual([112, 229]);
  });
});
