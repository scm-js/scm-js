import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { scenarioAtom } from "../src/atoms/documentAtoms";
import { mapModifiedAtom } from "../src/atoms/editorAtoms";
import { START_LOCATION } from "../src/data/units";
import { DEFAULT_NEW_MAP, newMapInto } from "../src/hooks/useMapFileActions";

/**
 * File ▸ New can lay start locations down with the terrain (the New Scenario dialog's
 * "Place automatically"). They are part of making the map rather than an edit on it, so
 * they are in the file the moment it exists and there is no history to undo them from.
 */
describe("a new scenario's start locations", () => {
  const make = async (startLocations?: number) => {
    const store = createStore();
    await newMapInto(store, { ...DEFAULT_NEW_MAP, width: 64, height: 64, startLocations });
    return store.get(scenarioAtom)!;
  };
  const starts = (scn: { units: { unitId: number; owner: number }[] }) => scn.units.filter((u) => u.unitId === START_LOCATION);

  it("places none by default, as File ▸ New always did", async () => {
    expect(starts(await make())).toHaveLength(0);
    expect(starts(await make(0))).toHaveLength(0);
  });

  it("places one per player, owned by players 1..N, inside the map", async () => {
    const scn = await make(4);
    const placed = starts(scn);
    expect(placed).toHaveLength(4);
    expect(placed.map((u) => u.owner).sort()).toEqual([0, 1, 2, 3]);
    for (const u of scn.units) {
      expect(u.x).toBeGreaterThanOrEqual(0);
      expect(u.x).toBeLessThan(64 * 32);
      expect(u.y).toBeLessThan(64 * 32);
    }
    expect(scn.dirty.has("UNIT")).toBe(true);
  });

  it("caps at the eight players the game has", async () => {
    expect(starts(await make(12))).toHaveLength(8);
  });

  it("leaves the map unmodified — nothing has been edited yet", async () => {
    const store = createStore();
    await newMapInto(store, { ...DEFAULT_NEW_MAP, width: 64, height: 64, startLocations: 2 });
    expect(store.get(mapModifiedAtom)).toBe(false);
  });
});
