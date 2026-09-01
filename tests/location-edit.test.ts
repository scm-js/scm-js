import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, serializeScenario, type Scenario } from "../src/formats/chk/scenario";
import { loadMap } from "../src/formats/mpq/scm";
import { ANYWHERE_INDEX, Elevation, ELEVATION_MASK, isLocationUsed } from "../src/formats/chk/sections/objects";
import { findString, getString } from "../src/formats/chk/sections/strings";
import {
  addLocation, applyLocationChanges, blankLocation, BW_LOCATION_SLOTS, dragBounds, editLocation, ensureLocationSlots, firstFreeSlot, handleAt,
  isAnywhereIntact, isInverted, locationAt, locationCapacity, locationName, moveLocations, ORIGINAL_LOCATION_SLOTS, removeLocations, resizeBounds,
  resizeLocation, restoreAnywhere, snapTo, usedLocations,
} from "../src/editor/locations";

function fresh(): Scenario {
  const scn = createScenario({ name: "t", description: "", width: 64, height: 64, era: 4 });
  scn.dirty.clear();
  return scn;
}

/** Undo every change, in reverse (the history walks entries back in this order too). */
const undo = (scn: Scenario, changes: ReturnType<typeof addLocation>["changes"]) => applyLocationChanges(scn, changes, "undo");

describe("slots", () => {
  it("has 255 slots on a Brood War map and 64 on an original one", () => {
    const bw = fresh();
    expect(bw.fileVersion).toBe(205);
    expect(locationCapacity(bw)).toBe(BW_LOCATION_SLOTS);
    bw.locations = bw.locations.slice(0, 64);
    expect(ensureLocationSlots(bw)).toBe(true);
    expect(bw.locations).toHaveLength(255);
    expect(bw.dirty.has("MRGN")).toBe(true);
    expect(ensureLocationSlots(bw)).toBe(false);

    const og = fresh();
    og.fileVersion = 59;
    og.locations = [];
    expect(locationCapacity(og)).toBe(ORIGINAL_LOCATION_SLOTS);
    ensureLocationSlots(og);
    expect(og.locations).toHaveLength(64);
    // A longer table than expected is left alone.
    og.locations.push(blankLocation());
    expect(locationCapacity(og)).toBe(65);
  });

  it("fills the lowest free slot and never Anywhere", () => {
    const scn = fresh();
    expect(firstFreeSlot(scn)).toBe(0);
    for (let i = 0; i < 63; i++) scn.locations[i] = { left: 0, top: 0, right: 32, bottom: 32, nameIndex: 0, elevationFlags: 0 };
    expect(firstFreeSlot(scn)).toBe(64);
    scn.locations.length = 64;
    expect(firstFreeSlot(scn)).toBe(-1);
    expect(addLocation(scn, { left: 0, top: 0, right: 32, bottom: 32 }).index).toBe(-1);
  });
});

describe("creating", () => {
  it("names a new location after its slot, reusing an identical string, and marks MRGN + STR dirty", () => {
    const scn = fresh();
    const { index, changes } = addLocation(scn, { left: 64, top: 32, right: 0, bottom: 96 });
    expect(index).toBe(0);
    expect(changes).toHaveLength(1);
    applyLocationChanges(scn, changes);
    const r = scn.locations[0];
    expect(r).toMatchObject({ left: 0, top: 32, right: 64, bottom: 96, elevationFlags: 0 }); // normalised
    expect(locationName(scn, 0)).toBe("Location 0");
    expect(changes[0].string).toEqual({ index: r.nameIndex, before: null, after: "Location 0" });
    expect(scn.dirty.has("MRGN")).toBe(true);
    expect(scn.dirty.has("STR ")).toBe(true);

    // The same name again does not grow the string table.
    const before = scn.strings.strings.length;
    const again = addLocation(scn, { left: 0, top: 0, right: 32, bottom: 32 }, "Location 0");
    expect(again.changes[0].string).toBeUndefined();
    expect(again.changes[0].after.nameIndex).toBe(r.nameIndex);
    applyLocationChanges(scn, again.changes);
    expect(scn.strings.strings.length).toBe(before);

    // Undo takes the appended string out again.
    undo(scn, again.changes);
    undo(scn, changes);
    expect(isLocationUsed(scn.locations[0])).toBe(false);
    expect(scn.strings.strings.length).toBe(before - 1);
    expect(findString(scn.strings, "Location 0")).toBe(-1);
  });

  it("restores a missing Anywhere in the same step", () => {
    const scn = fresh();
    scn.locations[ANYWHERE_INDEX] = blankLocation();
    expect(isAnywhereIntact(scn)).toBe(false);
    const { changes } = addLocation(scn, { left: 0, top: 0, right: 32, bottom: 32 });
    expect(changes.map((c) => c.index)).toEqual([ANYWHERE_INDEX, 0]);
    applyLocationChanges(scn, changes);
    expect(isAnywhereIntact(scn)).toBe(true);
    expect(scn.locations[ANYWHERE_INDEX]).toMatchObject({ left: 0, top: 0, right: 64 * 32, bottom: 64 * 32 });
    expect(locationName(scn, ANYWHERE_INDEX)).toBe("Anywhere"); // reused the existing string
    expect(changes[0].string).toBeUndefined();
    expect(changes[1].string!.index).toBe(scn.locations[0].nameIndex);
    undo(scn, changes);
    expect(isLocationUsed(scn.locations[ANYWHERE_INDEX])).toBe(false);
  });

  it("restores a drifted Anywhere keeping its name, and is a no-op when intact", () => {
    const scn = fresh();
    expect(restoreAnywhere(scn)).toBeNull();
    scn.locations[ANYWHERE_INDEX] = { ...scn.locations[ANYWHERE_INDEX], right: 1024 };
    const c = restoreAnywhere(scn)!;
    expect(c.after).toMatchObject({ right: 64 * 32, nameIndex: scn.locations[ANYWHERE_INDEX].nameIndex });
    // An unnamed but correctly sized slot gets the name.
    scn.locations[ANYWHERE_INDEX] = { ...scn.locations[ANYWHERE_INDEX], right: 64 * 32, nameIndex: 0 };
    expect(getString(scn.strings, restoreAnywhere(scn)!.after.nameIndex)).toBe("Anywhere");
  });
});

describe("geometry", () => {
  it("snaps and turns a drag into the cells it touched", () => {
    expect(snapTo(47, 32)).toBe(32);
    expect(snapTo(49, 32)).toBe(64);
    expect(snapTo(49.6, 0)).toBe(50);
    const scn = fresh();
    // Inside one tile: that tile.
    expect(dragBounds({ px: 40, py: 40 }, { px: 50, py: 60 }, 32, scn)).toEqual({ left: 32, top: 32, right: 64, bottom: 64 });
    // Backwards across tiles: still the covered cells, normalised.
    expect(dragBounds({ px: 100, py: 100 }, { px: 10, py: 40 }, 32, scn)).toEqual({ left: 0, top: 32, right: 128, bottom: 128 });
    // Past the map edge: clamped to it.
    expect(dragBounds({ px: 2000, py: 2100 }, { px: 2040, py: 2050 }, 32, scn)).toEqual({ left: 1984, top: 2016, right: 2048, bottom: 2048 });
    // Snapping off: raw pixels.
    expect(dragBounds({ px: 10.4, py: 20 }, { px: 5, py: 30.6 }, 0, scn)).toEqual({ left: 5, top: 20, right: 10, bottom: 31 });
  });

  it("finds handles, corners first, and resizes through the opposite edge", () => {
    const b = { left: 64, top: 64, right: 192, bottom: 128 };
    expect(handleAt(b, 64, 64, 4)).toBe("nw");
    expect(handleAt(b, 128, 64, 4)).toBe("n");
    expect(handleAt(b, 192, 96, 4)).toBe("e");
    expect(handleAt(b, 190, 126, 4)).toBe("se");
    expect(handleAt(b, 100, 100, 4)).toBeNull();
    expect(resizeBounds(b, "e", 250, 999, 32)).toEqual({ left: 64, top: 64, right: 256, bottom: 128 });
    expect(resizeBounds(b, "sw", 100, 140, 32)).toEqual({ left: 96, top: 64, right: 192, bottom: 128 });
    // Dragging the left edge past the right one flips the box instead of collapsing it.
    expect(resizeBounds(b, "w", 224, 0, 32)).toEqual({ left: 192, top: 64, right: 224, bottom: 128 });
  });

  it("picks the smallest location under a point and never Anywhere", () => {
    const scn = fresh();
    applyLocationChanges(scn, addLocation(scn, { left: 0, top: 0, right: 640, bottom: 640 }).changes);
    applyLocationChanges(scn, addLocation(scn, { left: 64, top: 64, right: 128, bottom: 128 }).changes);
    applyLocationChanges(scn, addLocation(scn, { left: 64, top: 64, right: 128, bottom: 128 }).changes); // same box, later slot
    expect(locationAt(scn, 300, 300)).toBe(0);
    expect(locationAt(scn, 70, 70)).toBe(2);
    expect(locationAt(scn, 128, 128)).toBe(0); // right/bottom edges are exclusive
    expect(locationAt(scn, 1000, 1000)).toBe(-1); // only Anywhere covers it
    expect(usedLocations(scn)).toEqual([0, 1, 2, ANYWHERE_INDEX]);
  });
});

describe("editing", () => {
  it("moves as a group, clamped to the map, keeping an inverted box inverted", () => {
    const scn = fresh();
    applyLocationChanges(scn, addLocation(scn, { left: 0, top: 0, right: 64, bottom: 64 }).changes);
    scn.locations[1] = { left: 256, top: 256, right: 128, bottom: 128, nameIndex: 0, elevationFlags: 0 }; // inverted, unnamed but sized
    expect(isInverted(scn.locations[1])).toBe(true);
    const mv = moveLocations(scn, [0, 1, ANYWHERE_INDEX, 7], -100, 32);
    expect(mv.map((c) => c.index)).toEqual([0, 1]); // Anywhere and empty slots are skipped
    expect(mv[0].after).toMatchObject({ left: 0, top: 32, right: 64, bottom: 96 }); // the group could only move 0 left
    expect(mv[1].after).toMatchObject({ left: 256, top: 288, right: 128, bottom: 160 });
    expect(isInverted(mv[1].after)).toBe(true);
    expect(moveLocations(scn, [0], 0, 0)).toEqual([]);
    expect(moveLocations(scn, [ANYWHERE_INDEX], 5, 5)).toEqual([]);
  });

  it("resizes to a normalised, clamped, non-empty box", () => {
    const scn = fresh();
    applyLocationChanges(scn, addLocation(scn, { left: 0, top: 0, right: 64, bottom: 64 }).changes);
    expect(resizeLocation(scn, 0, { left: 96, top: 0, right: 32, bottom: 3000 })).toEqual([{ index: 0, before: scn.locations[0], after: { ...scn.locations[0], left: 32, top: 0, right: 96, bottom: 2048 } }]);
    expect(resizeLocation(scn, 0, { left: 0, top: 0, right: 0, bottom: 64 })).toEqual([]);
    expect(resizeLocation(scn, 0, { left: 0, top: 0, right: 64, bottom: 64 })).toEqual([]);
    expect(resizeLocation(scn, ANYWHERE_INDEX, { left: 0, top: 0, right: 64, bottom: 64 })).toEqual([]);
  });

  it("edits name, bounds and elevation as one change, never Anywhere", () => {
    const scn = fresh();
    applyLocationChanges(scn, addLocation(scn, { left: 0, top: 0, right: 64, bottom: 64 }).changes);
    const c = editLocation(scn, 0, { name: "Base", right: 5000, elevationFlags: Elevation.HighAir | 0x100 })!;
    expect(c.after).toMatchObject({ right: 2048, elevationFlags: Elevation.HighAir });
    expect(c.string).toEqual({ index: c.after.nameIndex, before: null, after: "Base" });
    applyLocationChanges(scn, [c]);
    expect(locationName(scn, 0)).toBe("Base");
    expect(editLocation(scn, 0, { name: "Base" })).toBeNull();
    // Renaming to the map's own name reuses that string.
    const same = editLocation(scn, 0, { name: "t" })!;
    expect(same.after.nameIndex).toBe(scn.nameIndex);
    expect(same.string).toBeUndefined();
    // An empty name drops the reference; the box keeps the slot in use.
    const cleared = editLocation(scn, 0, { name: "" })!;
    expect(cleared.after.nameIndex).toBe(0);
    expect(isLocationUsed(cleared.after)).toBe(true);
    // The dialog may set an inverted box on purpose; it is stored as given.
    expect(editLocation(scn, 0, { left: 100, right: 50 })!.after).toMatchObject({ left: 100, right: 50 });
    expect(editLocation(scn, ANYWHERE_INDEX, { name: "Everywhere" })).toBeNull();
    expect(editLocation(scn, 9, { name: "Nothing" })).toBeNull();
    expect(ELEVATION_MASK).toBe(0x3f);
    undo(scn, [c]);
    expect(locationName(scn, 0)).toBe("Location 0");
    expect(findString(scn.strings, "Base")).toBe(-1);
  });

  it("deletes by blanking the slot, keeping the string, and refuses Anywhere", () => {
    const scn = fresh();
    applyLocationChanges(scn, addLocation(scn, { left: 0, top: 0, right: 64, bottom: 64 }).changes);
    const strings = scn.strings.strings.length;
    const rm = removeLocations(scn, [0, 0, ANYWHERE_INDEX, 50]);
    expect(rm).toHaveLength(1);
    applyLocationChanges(scn, rm);
    expect(scn.locations[0]).toEqual(blankLocation());
    expect(scn.strings.strings.length).toBe(strings);
    expect(isAnywhereIntact(scn)).toBe(true);
    undo(scn, rm);
    expect(locationName(scn, 0)).toBe("Location 0");
  });
});

describe("MRGN round trip", () => {
  it("survives serialize → parse with names, bounds and flags intact", () => {
    const scn = fresh();
    applyLocationChanges(scn, addLocation(scn, { left: 32, top: 64, right: 96, bottom: 128 }, "Alpha", Elevation.LowAir).changes);
    applyLocationChanges(scn, addLocation(scn, { left: 500, top: 500, right: 600, bottom: 700 }).changes);
    applyLocationChanges(scn, [editLocation(scn, 1, { left: 600, right: 500 })!]); // inverted on purpose
    const again = parseScenario(serializeScenario(scn));
    expect(again.locations).toHaveLength(BW_LOCATION_SLOTS);
    expect(again.locations[0]).toMatchObject({ left: 32, top: 64, right: 96, bottom: 128, elevationFlags: Elevation.LowAir });
    expect(locationName(again, 0)).toBe("Alpha");
    expect(again.locations[1]).toMatchObject({ left: 600, top: 500, right: 500, bottom: 700 });
    expect(locationName(again, 1)).toBe("Location 1");
    expect(isAnywhereIntact(again)).toBe(true);
    expect(usedLocations(again)).toEqual([0, 1, ANYWHERE_INDEX]);
  });
});

const MAPS = join(__dirname, "..", "fixtures", "maps");
const mapFiles = existsSync(MAPS) ? readdirSync(MAPS).filter((f) => /\.(scx|scm)$/i.test(f)) : [];

describe.skipIf(mapFiles.length === 0)("real maps", () => {
  it.each(mapFiles)("%s keeps Anywhere in slot 63 and round-trips its locations", async (file) => {
    const scn = parseScenario((await loadMap(readFileSync(join(MAPS, file)))).chk);
    expect(scn.locations.length).toBeGreaterThanOrEqual(ORIGINAL_LOCATION_SLOTS);
    expect(isAnywhereIntact(scn)).toBe(true);
    expect(locationName(scn, ANYWHERE_INDEX)).toBe("Anywhere");
    // A new location goes in the first free slot and comes back out of the file.
    ensureLocationSlots(scn);
    const { index, changes } = addLocation(scn, { left: 32, top: 32, right: 96, bottom: 96 }, "Round trip");
    expect(index).not.toBe(ANYWHERE_INDEX);
    applyLocationChanges(scn, changes);
    const again = parseScenario(serializeScenario(scn));
    expect(locationName(again, index)).toBe("Round trip");
    expect(again.locations[index]).toMatchObject({ left: 32, top: 32, right: 96, bottom: 96 });
    expect(again.locations.filter(isLocationUsed).length).toBe(scn.locations.filter(isLocationUsed).length);
  });
});
