import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import type { UnitRecord } from "../src/formats/chk/sections/objects";
import { decodeUnitsDat, UNITS_DAT_SIZE } from "../src/formats/dat/dat";
import {
  addUnits, applyUnitChanges, drawOrder, makeUnit, moveUnits, nextSerial, removeUnits, snapPlacement, unitAt, unitGeometry,
  UnitUsed, UnitValid, updateUnits, type UnitGeometry,
} from "../src/editor/units";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const UNITS_DAT = join(import.meta.dirname, "..", "public", "arr", "units.dat");
const realUnits = existsSync(UNITS_DAT) ? decodeUnitsDat(new Uint8Array(readFileSync(UNITS_DAT))) : null;

function fresh() {
  const scn = createScenario({ name: "t", description: "", width: 64, height: 64, tileset: 4 });
  scn.units = [];
  scn.dirty.clear();
  return scn;
}

const cc: UnitGeometry = { building: true, flyer: false, placeW: 128, placeH: 96, left: 58, up: 41, right: 58, down: 41 };
const marine: UnitGeometry = { building: false, flyer: false, placeW: 32, placeH: 32, left: 8, up: 9, right: 8, down: 10 };

describe("placement snapping", () => {
  it("puts a building's placement box on the tile grid", () => {
    // Nearest tile corner for the 128x96 box's top-left is (1, 2) → centre (96, 112).
    expect(snapPlacement(cc, 100, 100, 64, 64)).toEqual({ x: 96, y: 112 });
    expect(snapPlacement(cc, 384, 240, 64, 64)).toEqual({ x: 384, y: 240 }); // already aligned (BGH start location)
  });

  it("lets a building sit anywhere when snapping is off, still inside the map", () => {
    expect(snapPlacement(cc, 100, 100, 64, 64, false)).toEqual({ x: 100, y: 100 });
    expect(snapPlacement(cc, 0, 0, 64, 64, false)).toEqual({ x: 64, y: 48 });
    expect(snapPlacement(cc, 64 * 32, 64 * 32, 64, 64, false)).toEqual({ x: 64 * 32 - 64, y: 64 * 32 - 48 });
  });

  it("keeps buildings inside the map", () => {
    expect(snapPlacement(cc, 0, 0, 64, 64)).toEqual({ x: 64, y: 48 });
    expect(snapPlacement(cc, 64 * 32, 64 * 32, 64, 64)).toEqual({ x: 60 * 32 + 64, y: 61 * 32 + 48 });
  });

  it("leaves other units at the pointer, clamped", () => {
    expect(snapPlacement(marine, 100.4, 77.6, 64, 64)).toEqual({ x: 100, y: 78 });
    expect(snapPlacement(marine, -5, 99999, 64, 64)).toEqual({ x: 0, y: 64 * 32 - 1 });
  });
});

describe("unit change lists", () => {
  it("adds, removes (highest index first) and undoes in reverse", () => {
    const scn = fresh();
    const mk = (id: number, x: number) => makeUnit(null, id, 0, x, 32, nextSerial(scn) + x);
    const add = addUnits(scn, [mk(0, 10), mk(0, 20), mk(0, 30)]);
    applyUnitChanges(scn, add);
    expect(scn.units.map((u) => u.x)).toEqual([10, 20, 30]);
    expect(scn.dirty.has("UNIT")).toBe(true);

    const rm = removeUnits(scn, [0, 2, 2]);
    expect(rm.map((c) => c.index)).toEqual([2, 0]);
    applyUnitChanges(scn, rm);
    expect(scn.units.map((u) => u.x)).toEqual([20]);

    applyUnitChanges(scn, rm, "undo");
    expect(scn.units.map((u) => u.x)).toEqual([10, 20, 30]);
    applyUnitChanges(scn, add, "undo");
    expect(scn.units).toHaveLength(0);
  });

  it("moves with snapping and skips no-op updates", () => {
    const scn = fresh();
    applyUnitChanges(scn, addUnits(scn, [makeUnit(null, 0, 0, 100, 100, 1)]));
    const mv = moveUnits(scn, null, [0], 5.4, -3);
    expect(mv).toHaveLength(1);
    applyUnitChanges(scn, mv);
    expect([scn.units[0].x, scn.units[0].y]).toEqual([105, 97]);
    expect(updateUnits(scn, [0], () => ({ owner: 0 }))).toEqual([]);
    const own = updateUnits(scn, [0], () => ({ owner: 3 }));
    applyUnitChanges(scn, own);
    expect(scn.units[0].owner).toBe(3);
    applyUnitChanges(scn, own, "undo");
    expect(scn.units[0].owner).toBe(0);
  });

  it("hands out increasing serials", () => {
    const scn = fresh();
    expect(nextSerial(scn)).toBe(1);
    applyUnitChanges(scn, addUnits(scn, [makeUnit(null, 0, 0, 1, 1, 500)]));
    expect(nextSerial(scn)).toBe(501);
  });
});

describe("picking", () => {
  it("finds the topmost unit under a point, flyers over ground", () => {
    const scn = fresh();
    applyUnitChanges(scn, addUnits(scn, [makeUnit(null, 0, 0, 100, 100, 1), makeUnit(null, 0, 1, 104, 96, 2)]));
    // Without tables every unit is a 32x32 box; the later-drawn (lower y first → unit 0 at y=100 draws after unit 1 at 96).
    expect(drawOrder(scn, null)).toEqual([1, 0]);
    expect(unitAt(scn, null, 100, 100)).toBe(0);
    expect(unitAt(scn, null, 300, 300)).toBe(-1);
  });
});

describe.skipIf(!realUnits)("StarEdit-style defaults from units.dat", () => {
  const u = realUnits!;
  const rec = (id: number, owner = 0): UnitRecord => makeUnit(u, id, owner, 64, 48, 1);

  it("marks only the properties that apply to the unit type", () => {
    const mineral = rec(176, 11);
    expect(mineral.validProperties).toBe(UnitValid.Invincible);
    expect(mineral.validStates).toBe(UnitUsed.HitPoints | UnitUsed.Resources);
    expect(mineral.resourceAmount).toBe(1500);
    expect(rec(188).resourceAmount).toBe(5000);

    const templar = rec(67);
    expect(templar.validStates & UnitUsed.Energy).toBeTruthy();
    expect(templar.validStates & UnitUsed.Shields).toBeTruthy();
    expect(templar.energyPercent).toBe(100);

    const marineRec = rec(0);
    expect(marineRec.validProperties).toBe(UnitValid.Invincible | UnitValid.Hallucinated);
    expect(marineRec.validStates).toBe(UnitUsed.HitPoints);
    expect(marineRec.shieldPercent).toBe(0);

    const ghost = rec(1);
    expect(ghost.validProperties & UnitValid.Cloak).toBeTruthy();
    expect(rec(106).validProperties & UnitValid.InTransit).toBeTruthy();

    const start = rec(214);
    expect([start.validProperties, start.validStates, start.hitPointsPercent]).toEqual([0, 0, 0]);
  });

  it("reads geometry from the tables", () => {
    const g = unitGeometry(u, 106);
    expect(g.building).toBe(true);
    expect([g.placeW, g.placeH, g.left, g.down]).toEqual([128, 96, 58, 41]);
    expect(unitGeometry(u, 42).flyer).toBe(true);
    expect(UNITS_DAT_SIZE).toBe(19876);
  });
});
