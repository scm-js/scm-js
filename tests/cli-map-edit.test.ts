/**
 * `scmjs map edit`, `map units`, `map locations` (cli/src/mapedit.ts, objects.ts): a list of edits applied through
 * the editor's plugin host with no editor around it. Each kind of edit on tests/maps/ums.scx, the list as all or
 * nothing, what an index means while units come and go, the dry run, `--out`, and the commands as the program runs
 * them. Nothing here has the game's files: that is the case the command is made for.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";
import { openMapBytes } from "../src/editor/mapFile";
import { locationName } from "../src/editor/locations";
import { UnitState, UnitUsed } from "../src/editor/units";
import { loadMapInput, readInput } from "../cli/src/files";
import { buildProgram, run } from "../cli/src/main";
import { EDIT_OPS, editMap, parseEdits, printEdits, type MapEdit } from "../cli/src/mapedit";
import { listLocations, listUnits, locationIndex, printLocations, printUnits } from "../cli/src/objects";
import { CliError, visible } from "../cli/src/ui";
import { headlessApi } from "../src/plugins/headless";
import { testMap } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-edit-"));
/** A copy of ums.scx to change, with what the command reads of it. */
async function copy(name = "ums.scx") {
  const path = join(tmp(), name);
  copyFileSync(testMap("ums.scx"), path);
  const input = await readInput(path);
  return { path, input, doc: await loadMapInput(input) };
}
const reopen = async (path: string) => openMapBytes(new Uint8Array(readFileSync(path)), path);
const failure = async (p: Promise<unknown>): Promise<CliError> => p.then(() => { throw new Error("did not fail"); }, (e: unknown) => e as CliError);

/** `scmjs …` as the command runs it: what it wrote where, and its exit code. */
async function scmjs(...args: string[]): Promise<{ out: string; err: string; code: number }> {
  let out = "", err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out += String(s); return true; });
  const e = vi.spyOn(process.stderr, "write").mockImplementation((s) => { err += String(s); return true; });
  process.exitCode = 0;
  try {
    const program = buildProgram();
    const override = (c: Command): void => { c.exitOverride(); c.commands.forEach(override); };
    override(program);
    await run(args, program);
  } finally { o.mockRestore(); e.mockRestore(); }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { out: visible(out), err: visible(err), code };
}
afterEach(() => { process.exitCode = 0; });

describe("map units, map locations", () => {
  it("lists units with their index, and narrows by type, player and area", async () => {
    const { doc } = await copy();
    const all = listUnits(doc, "ums.scx");
    expect(all.total).toBe(21);
    expect(all.units.map((u) => u.index)).toEqual(Array.from({ length: 21 }, (_, i) => i));
    expect(all.units[17]).toEqual({ index: 17, id: 0, unit: "Terran Marine", player: 1, x: 464, y: 1616, tileX: 14, tileY: 50, hitPoints: 50 });
    expect(all.units[18]).toMatchObject({ unit: "Terran Ghost", energy: 75, states: ["cloaked"] });
    expect(all.units[1]).toMatchObject({ unit: "Mineral Field (Type 1)", player: 12, resources: 1500 });
    expect(listUnits(doc, "ums.scx", { player: 1 }).units.map((u) => u.index)).toEqual([0, 16, 17, 18, 19]);
    expect(listUnits(doc, "ums.scx", { unit: "Zergling" }).units.map((u) => u.index)).toEqual([20]);
    expect(listUnits(doc, "ums.scx", { unit: 214 }).matched).toBe(2);
    expect(listUnits(doc, "ums.scx", { location: "Base" }).units.map((u) => u.index)).toEqual([0, 16, 17, 18]);
    expect(listUnits(doc, "ums.scx", { location: 2 }).units.map((u) => u.unit)).toEqual(["Start Location", "Zerg Zergling"]);
    expect(listUnits(doc, "ums.scx", { tiles: { x0: 14, y0: 50, x1: 16, y1: 51 }, player: 1 }).units.map((u) => u.index)).toEqual([17, 18]);
    expect(listUnits(doc, "ums.scx", { rect: { left: 464, top: 1616, right: 465, bottom: 1617 } }).units.map((u) => u.index)).toEqual([17]);
    // The text is cut; the rows are not.
    const text = printUnits("ums.scx", all).map(visible);
    expect(text[0]).toBe("ums.scx  21 units");
    expect(text.some((l) => /^\s+17\s+Terran Marine\s+Player 1\s+464,1616\s+14,50\s+hp 50%$/.test(l))).toBe(true);
    expect(printUnits("ums.scx", listUnits(doc, "ums.scx", { player: 2 })).map(visible)[0]).toBe("ums.scx  2 of 21 units");
  });

  it("says what is wrong with a filter", async () => {
    const { doc } = await copy();
    expect(() => listUnits(doc, "x", { unit: "Siege Tank" })).toThrow(/could be "Terran Siege Tank \(Tank Mode\)" \(5\)/);
    expect(() => listUnits(doc, "x", { location: "Nope" })).toThrow(/No location is called "Nope"/);
    expect(() => listUnits(doc, "x", { location: 9 })).toThrow(/There is no location 9/);
    expect(() => listUnits(doc, "x", { rect: { left: 0, top: 0, right: 4000, bottom: 10 } })).toThrow(/leaves the map, which is 2048 × 2048 pixels/);
    expect(() => listUnits(doc, "x", { tiles: { x0: 4, y0: 4, x1: 4, y1: 9 } })).toThrow(/is empty/);
    expect(() => listUnits(doc, "x", { location: "Base", tiles: { x0: 0, y0: 0, x1: 1, y1: 1 } })).toThrow(/an area is one of rect \(pixels\), tiles or location/);
  });

  it("lists locations by the number triggers count them with", async () => {
    const { doc } = await copy();
    const r = listLocations(doc, "ums.scx");
    expect(r.locations.map((l) => [l.number, l.index, l.name, l.units])).toEqual([[1, 0, "Base", 4], [2, 1, "Nest", 2], [3, 2, "Middle", 0], [64, 63, "Anywhere", 21]]);
    expect(r.locations[0]).toMatchObject({ left: 192, top: 1600, right: 512, bottom: 1856, tiles: { x0: 6, y0: 50, x1: 16, y1: 58 } });
    expect(printLocations("ums.scx", r).map(visible)[0]).toBe("ums.scx  3 locations, and Anywhere");
    expect(locationIndex(doc.scenario, "base")).toBe(0);
    expect(locationIndex(doc.scenario, 3)).toBe(2);
    expect(locationIndex(doc.scenario, "3")).toBe(2);
  });

  it("the commands print the rows, or the data with --json", async () => {
    const { path } = await copy();
    const units = await scmjs("map", "units", path, "--player", "2");
    expect(units.code).toBe(0);
    expect(units.out).toMatch(/2 of 21 units\n\s+index\s+unit\s+player\s+x,y\s+tile\n\s+8\s+Start Location\s+Player 2\s+1744,336\s+54,10\n\s+20\s+Zerg Zergling\s+Player 2\s+1616,464\s+50,14\s+burrowed\n$/);
    const json = JSON.parse((await scmjs("map", "units", path, "--tiles", "0,48,20,60", "--unit", "176", "--json")).out) as { matched: number; units: { index: number }[] };
    expect(json.units.map((u) => u.index)).toEqual([1, 2, 3, 4, 5, 6]);
    const locations = await scmjs("map", "locations", path);
    expect(locations.out).toMatch(/\n\s+2\s+Nest\s+1536,192–1856,512\s+48,6–58,16\s+2\n/);
    for (const [args, said] of [[["--player", "13"], /--player is 1 to 12/], [["--rect", "1,2,3"], /--rect takes four whole numbers/]] as const) {
      const r = await scmjs("map", "units", path, ...args);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(said);
    }
  });
});

describe("map edit: each kind of edit", () => {
  it("places units where it is told, with the properties given, and says the index each got", async () => {
    const { path, input, doc } = await copy();
    const r = await editMap(input, doc, [
      { op: "place_unit", unit: "Terran Marine", player: 1, x: 401, y: 1703 },
      { op: "place_unit", unit: "Zergling", player: 2, tileX: 52, tileY: 12, burrowed: true, hitPoints: 40 },
      { op: "place_unit", unit: 188, player: 12, x: 1000, y: 1000, resources: 2500 },
    ]);
    expect(r.edits).toEqual([
      { op: "place_unit", unit: "Terran Marine", player: 1, x: 401, y: 1703, index: 21 },
      { op: "place_unit", unit: "Zerg Zergling", player: 2, x: 52 * 32 + 16, y: 12 * 32 + 16, index: 22 },
      { op: "place_unit", unit: "Vespene Geyser", player: 12, x: 1000, y: 1000, index: 23 },
    ]);
    expect(r.modified).toBe(true);
    expect(r.diff!.units.map((u) => `${u.change} ${u.text}`)).toEqual(["added Terran Marine (Player 1) at 401,1703", "added Zerg Zergling (Player 2) at 1680,400", "added Vespene Geyser (Neutral) at 1000,1000, 2,500 resources"]);
    const after = (await reopen(path)).scenario;
    expect(after.units).toHaveLength(24);
    // Pixels are kept as given (the palette would have snapped the marine to a tile's centre).
    expect(after.units[21]).toMatchObject({ unitId: 0, owner: 0, x: 401, y: 1703, hitPointsPercent: 100 });
    expect(after.units[22]).toMatchObject({ unitId: 37, owner: 1, hitPointsPercent: 40, stateFlags: UnitState.Burrowed });
    expect(after.units[22].validStates & (UnitUsed.HitPoints | UnitUsed.State)).toBe(UnitUsed.HitPoints | UnitUsed.State);
    expect(after.units[23]).toMatchObject({ unitId: 188, owner: 11, resourceAmount: 2500 });
    // Serials stay apart from the map's own.
    expect(new Set(after.units.map((u) => u.serial)).size).toBe(24);
  });

  it("moves units to a position or by an offset", async () => {
    const { path, input, doc } = await copy();
    const r = await editMap(input, doc, [
      { op: "move_units", indices: [17], tileX: 15, tileY: 51 },
      { op: "move_units", where: { unit: "Mineral Field (Type 1)", tiles: { x0: 0, y0: 40, x1: 20, y1: 64 } }, dx: 0, dy: -32 },
      { op: "move_units", where: { unit: "Terran Wraith" }, dx: 5 },
      { op: "move_units", indices: [20], x: 1616, y: 464 },
    ]);
    expect(r.edits).toEqual([
      { op: "move_units", matched: 1, changed: 1 }, { op: "move_units", matched: 6, changed: 6 },
      { op: "move_units", matched: 0, changed: 0 }, { op: "move_units", matched: 1, changed: 0 },
    ]);
    const after = (await reopen(path)).scenario;
    expect([after.units[17].x, after.units[17].y]).toEqual([496, 1648]);
    expect(after.units.slice(1, 7).map((u) => u.y)).toEqual([1520, 1520, 1520, 1520, 1520, 1520]);
    expect(after.units.slice(9, 15).map((u) => u.y)).toEqual([528, 528, 528, 528, 528, 528]);
    const lines = printEdits("ums.scx", r).map(visible);
    expect(lines[2]).toMatch(/2\s+move_units\s+no unit matches/);
    expect(lines[3]).toMatch(/3\s+move_units\s+0 units moved \(1 already there\)/);
  });

  it("changes owner, vitals, resources and states, and only what was given", async () => {
    const { path, input, doc } = await copy();
    const before = doc.scenario.units.map((u) => ({ ...u }));
    await editMap(input, doc, [
      { op: "update_units", where: { player: 1, location: "Base", unit: "Terran Ghost" }, energy: 100, invincible: true, cloaked: false },
      { op: "update_units", indices: [19], player: 2, hitPoints: 50, shields: 25, hangar: 8 },
      { op: "update_units", where: { unit: 188 }, resources: 300 },
      { op: "update_units", indices: [16], lifted: true, hallucinated: false },
    ]);
    const after = (await reopen(path)).scenario.units;
    expect(after[18]).toMatchObject({ energyPercent: 100, stateFlags: UnitState.Invincible, owner: 0, hitPointsPercent: before[18].hitPointsPercent });
    expect(after[19]).toMatchObject({ owner: 1, hitPointsPercent: 50, shieldPercent: 25, hangarUnits: 8 });
    expect(after[19].validStates & (UnitUsed.HitPoints | UnitUsed.Shields | UnitUsed.Hangar)).toBe(UnitUsed.HitPoints | UnitUsed.Shields | UnitUsed.Hangar);
    expect([after[7].resourceAmount, after[15].resourceAmount]).toEqual([300, 300]);
    expect(after[16].stateFlags).toBe(UnitState.InTransit);
    // The others are the records they were.
    for (const i of [0, 1, 8, 17, 20]) expect(after[i]).toEqual(before[i]);
  });

  it("removes units by index or by what they are", async () => {
    const { path, input, doc } = await copy();
    const r = await editMap(input, doc, [{ op: "remove_units", indices: [17, 18] }, { op: "remove_units", where: { unit: "Vespene Geyser", location: "Anywhere" } }]);
    expect(r.edits).toEqual([{ op: "remove_units", matched: 2, changed: 2 }, { op: "remove_units", matched: 2, changed: 2 }]);
    const after = (await reopen(path)).scenario;
    expect(after.units).toHaveLength(17);
    expect(after.units.some((u) => [0, 1, 188].includes(u.unitId))).toBe(false);
  });

  it("adds, changes and removes locations by name or number", async () => {
    const { path, input, doc } = await copy();
    const r = await editMap(input, doc, [
      { op: "add_location", name: "Ramp", tiles: { x0: 20, y0: 40, x1: 24, y1: 44 } },
      { op: "edit_location", location: "Middle", name: "Centre", rect: { left: 864, top: 864, right: 1184, bottom: 1184 } },
      { op: "edit_location", location: "Ramp", tiles: { x0: 20, y0: 40, x1: 26, y1: 44 } },
      { op: "remove_locations", locations: [2] },
      { op: "add_location", name: "Gate", rect: { left: 0, top: 0, right: 64, bottom: 32 } },
    ]);
    expect(r.edits).toEqual([
      { op: "add_location", number: 4, index: 3, name: "Ramp", left: 640, top: 1280, right: 768, bottom: 1408 },
      { op: "edit_location", changed: true, number: 3, index: 2, name: "Centre", left: 864, top: 864, right: 1184, bottom: 1184 },
      { op: "edit_location", changed: true, number: 4, index: 3, name: "Ramp", left: 640, top: 1280, right: 832, bottom: 1408 },
      { op: "remove_locations", removed: [{ number: 2, index: 1, name: "Nest" }] },
      // The lowest free slot, which is the one just emptied.
      { op: "add_location", number: 2, index: 1, name: "Gate", left: 0, top: 0, right: 64, bottom: 32 },
    ]);
    const after = (await reopen(path)).scenario;
    expect([0, 1, 2, 3].map((i) => locationName(after, i))).toEqual(["Base", "Gate", "Centre", "Ramp"]);
    expect(after.locations[2]).toMatchObject({ left: 864, top: 864, right: 1184, bottom: 1184 });
    expect(r.diff!.locations.map((l) => l.change).sort()).toEqual(["added", "changed", "changed"]);
  });

  it("places and removes sprites, and sets fog", async () => {
    const { path, input, doc } = await copy();
    const r = await editMap(input, doc, [
      { op: "place_sprite", sprite: 318, x: 1000, y: 1001 },
      { op: "place_sprite", unit: "Terran Marine", player: 3, tileX: 30, tileY: 31, disabled: true, flipped: true },
      { op: "remove_sprites", indices: [0] },
      { op: "remove_sprites", where: { unit: "Terran Marine", player: 1 } },
      { op: "set_fog", players: [1, 2], mode: "clear", tiles: { x0: 0, y0: 0, x1: 4, y1: 2 } },
      { op: "set_fog", players: [2], mode: "fog", tiles: { x0: 0, y0: 0, x1: 1, y1: 1 } },
      { op: "set_fog", players: [8], mode: "clear", location: "Middle" },
    ]);
    expect(r.edits).toEqual([
      { op: "place_sprite", kind: "pure", sprite: "sprite 318", player: 1, x: 1000, y: 1001, index: 0 },
      { op: "place_sprite", kind: "unit", sprite: "Terran Marine", player: 3, x: 976, y: 1008, index: 1 },
      { op: "remove_sprites", matched: 1, changed: 1 },
      { op: "remove_sprites", matched: 1, changed: 1 },
      { op: "set_fog", mode: "clear", players: [1, 2], tiles: 8 },
      { op: "set_fog", mode: "fog", players: [2], tiles: 1 },
      { op: "set_fog", mode: "clear", players: [8], tiles: 64 },
    ]);
    const after = (await reopen(path)).scenario;
    expect(after.sprites).toEqual([
      { spriteId: 318, x: 1000, y: 1001, owner: 0, unused: 0, flags: 0x1000 },
      { spriteId: 0, x: 976, y: 1008, owner: 2, unused: 0, flags: 0x4000 | 0x8000 },
    ]);
    expect([after.mask![0] & 3, after.mask![1] & 3, after.mask![64 * 2] & 3]).toEqual([2, 0, 3]);
    expect(after.mask![28 * 64 + 28] & 0x80).toBe(0);
    expect(r.diff!.sections.map((s) => s.name)).toEqual(expect.arrayContaining(["THG2", "MASK"]));
  });
});

describe("map edit: indices, all or nothing, the dry run", () => {
  it("an index is the unit's place before the call, whatever the list removed before it", async () => {
    const { path, input, doc } = await copy();
    const r = await editMap(input, doc, [
      { op: "remove_units", indices: [1, 2] },
      { op: "place_unit", unit: "Terran Marine", player: 1, x: 100, y: 100 },
      { op: "update_units", indices: [17], hitPoints: 77 },
      { op: "place_unit", unit: "Terran Firebat", player: 1, x: 200, y: 100 },
      { op: "update_units", where: { unit: "Terran Marine", tiles: { x0: 0, y0: 0, x1: 8, y1: 8 } }, hitPoints: 9 },
      { op: "remove_units", indices: [20] },
      { op: "remove_units", where: { unit: "Terran Firebat" } },
    ]);
    // 21 − 2 − 1 units of the map's own, then the marine; the firebat came and went.
    expect(r.edits[1]).toMatchObject({ unit: "Terran Marine", index: 18 });
    expect(r.edits[3]).toMatchObject({ unit: "Terran Firebat", index: null });
    const after = (await reopen(path)).scenario.units;
    expect(after).toHaveLength(19);
    expect(after[15]).toMatchObject({ unitId: 0, x: 464, hitPointsPercent: 77 });
    expect(after[18]).toMatchObject({ unitId: 0, x: 100, hitPointsPercent: 9 });
    expect(printEdits("ums.scx", r).map(visible)[3]).toMatch(/Terran Firebat · Player 1 · 200,100 · removed again/);
  });

  it("applies every edit or none: the failing one is named by its place, and the file is as it was", async () => {
    const { path, input, doc } = await copy();
    const before = readFileSync(path);
    const cases: [MapEdit[], RegExp][] = [
      [[{ op: "place_unit", unit: "Terran Marine", player: 1, x: 100, y: 100 }, { op: "add_location", name: "New", tiles: { x0: 1, y0: 1, x1: 2, y1: 2 } }, { op: "remove_units", indices: [99] }], /^edits\[2\] \(remove_units\): there is no unit 99: the map's units are 0 to 20$/],
      [[{ op: "remove_units", indices: [3] }, { op: "update_units", indices: [3], hitPoints: 5 }], /^edits\[1\] \(update_units\): unit 3 was removed by edits\[0\]$/],
      [[{ op: "place_unit", unit: "Siege Tank", player: 1, x: 1, y: 1 }], /^edits\[0\] \(place_unit\): "Siege Tank" could be/],
      [[{ op: "place_unit", unit: 0, player: 1, x: 4000, y: 1 }], /4000,1 is off the map, which is 2048 × 2048 pixels/],
      [[{ op: "place_unit", unit: 0, player: 1, tileX: 64, tileY: 1 }], /tile 64,1 is off the map, which is 64 × 64 tiles/],
      [[{ op: "place_unit", unit: 0, player: 1 }], /say where/],
      [[{ op: "place_unit", unit: 0, player: 1, x: 1, y: 1, tileX: 1, tileY: 1 }], /not both/],
      [[{ op: "move_units", where: { player: 1 }, x: 3, y: 4 }], /5 units match, and a position is for one/],
      [[{ op: "move_units", indices: [0], dx: -4000 }], /Start Location at 336,1744 would leave the map/],
      [[{ op: "move_units", indices: [0] }], /say where to/],
      [[{ op: "remove_units" }], /name the units with `indices` or with `where`/],
      [[{ op: "remove_units", where: {} }], /an empty `where` is every unit on the map/],
      [[{ op: "update_units", indices: [0] }], /nothing to change/],
      [[{ op: "edit_location", location: "Anywhere", name: "x" }], /Anywhere covers the whole map/],
      [[{ op: "edit_location", location: 7, name: "x" }], /There is no location 7/],
      [[{ op: "edit_location", location: "Base", name: "nest" }], /location 2 is already called "Nest"/],
      [[{ op: "add_location", name: "base", tiles: { x0: 1, y0: 1, x1: 2, y1: 2 } }], /location 1 is already called "Base"/],
      [[{ op: "add_location", name: "Wide", tiles: { x0: 60, y0: 1, x1: 70, y1: 2 } }], /leaves the map, which is 64 × 64 tiles/],
      [[{ op: "remove_locations", locations: ["Base", 64] }], /Anywhere covers the whole map/],
      [[{ op: "place_sprite", x: 1, y: 1 }], /give `sprite` \(a sprites.dat id\) or `unit`/],
      [[{ op: "remove_sprites", indices: [2] }], /there is no sprite 2: the map's sprites are 0 to 1/],
      [[{ op: "set_fog", players: [1], mode: "fog", location: "Nope" }], /No location is called "Nope"/],
    ];
    for (const [edits, said] of cases) {
      const e = await failure(editMap(input, await loadMapInput(input), edits));
      expect(e, JSON.stringify(edits)).toBeInstanceOf(CliError);
      expect(e.message, JSON.stringify(edits)).toMatch(said);
      expect(e.hint).toMatch(/Nothing was changed: the edits are applied together or not at all\.$/);
    }
    // The reason's own hint comes first.
    expect((await failure(editMap(input, doc, [{ op: "edit_location", location: 7, name: "x" }]))).hint).toMatch(/^The map has 1 "Base", 2 "Nest", 3 "Middle", 64 "Anywhere"\. Nothing was changed/);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("a transaction that throws leaves the document as it was", async () => {
    const { doc } = await copy();
    const host = headlessApi(doc, "test");
    expect(() => host.api.document.edit("half", (tx) => { tx.addUnits([tx.makeUnit(0, 0, 10, 10)]); tx.addLocation({ left: 0, top: 0, right: 32, bottom: 32 }, "Half"); throw new Error("stop"); })).toThrow("stop");
    expect(host.modified()).toBe(false);
    expect(host.document().scenario.units).toHaveLength(21);
    expect(locationName(host.document().scenario, 3)).toBe("Location 3");
    expect(host.api.plugin).toMatchObject({ id: "test", name: "test" });
    host.dispose();
  });

  it("a dry run says what would change and writes nothing; --out leaves the map alone", async () => {
    const { path, input, doc } = await copy();
    const before = readFileSync(path);
    const edits: MapEdit[] = [{ op: "place_unit", unit: "Terran Marine", player: 1, x: 400, y: 1700 }, { op: "remove_locations", locations: ["Nest"] }];
    const dry = await editMap(input, doc, edits, { dryRun: true });
    expect(dry.written).toBeNull();
    expect(dry.modified).toBe(true);
    expect(readFileSync(path).equals(before)).toBe(true);
    const lines = printEdits("ums.scx", dry, { dryRun: true }).map(visible);
    expect(lines).toContain("  + Terran Marine (Player 1) at 400,1700");
    expect(lines).toContain("  − 2  Nest 1536,192–1856,512");
    expect(lines.at(-1)).toBe("ℹ ums.scx: 2 edits · 1 unit added, 1 location removed · not written (--dry-run)");

    const out = join(tmp(), "sub", "out.scx");
    const r = await editMap(input, await loadMapInput(input), edits, { out });
    expect(r.written).toEqual({ path: out, bytes: readFileSync(out).length });
    expect(readFileSync(path).equals(before)).toBe(true);
    expect((await reopen(out)).scenario.units).toHaveLength(22);
    expect(printEdits("ums.scx", r).map(visible).at(-1)).toMatch(/^✔ ums.scx: 2 edits · 1 unit added, 1 location removed · written to .*out\.scx · /);

    // Edits that change nothing write nothing, unless --out asks for the file.
    const same = await editMap(input, await loadMapInput(input), [{ op: "update_units", indices: [17], hitPoints: 50 }]);
    expect([same.modified, same.written, same.diff]).toEqual([false, null, null]);
    expect(printEdits("ums.scx", same).map(visible).at(-1)).toBe("✔ ums.scx: 1 edit · the map is unchanged");
    const copied = join(tmp(), "same.scx");
    expect((await editMap(input, await loadMapInput(input), [{ op: "update_units", indices: [17], hitPoints: 50 }], { out: copied })).written?.path).toBe(copied);
  });
});

describe("map edit: the list as JSON", () => {
  it("takes a list or { edits }, and names the entry that is not an edit", () => {
    const one = { op: "remove_units", indices: [1] };
    expect(parseEdits([one])).toEqual([one]);
    expect(parseEdits({ edits: [one] })).toEqual([one]);
    expect(EDIT_OPS).toEqual(["place_unit", "move_units", "update_units", "remove_units", "add_location", "edit_location", "remove_locations", "place_sprite", "remove_sprites", "set_fog", "paint_terrain", "place_doodad", "scatter_doodads", "remove_doodads"]);
    const cases: [unknown, RegExp][] = [
      [{}, /The edits are a JSON list/],
      ["x", /The edits are a JSON list/],
      [[], /The list of edits is empty/],
      [[one, { op: "place_unit", unit: "Marine", player: 1, x: 4, y: 4, colour: 3 }], /^edits\[1\] \(place_unit\): `colour` is not a field of place_unit: it takes `unit`, `player`, `x`, `y`, `tileX`, `tileY`, `hitPoints`/],
      [[{ op: "raise_ground", terrain: 3 }], /^edits\[0\] \(raise_ground\): `op` is one of place_unit, .*set_fog, paint_terrain, place_doodad, scatter_doodads, remove_doodads$/],
      [[{ unit: 3 }], /^edits\[0\]: `op` is one of/],
      [[{ op: "place_unit", unit: "Marine", player: 13, x: "4", y: 1 }], /^edits\[0\] \(place_unit\): `player`: Too big: expected number to be <=12; `x`: expected number, received string$/],
      [[{ op: "update_units", where: { owner: 1 }, hitPoints: 5 }], /^edits\[0\] \(update_units\): `where`: Unrecognized key: "owner"$/],
      [[{ op: "set_fog", players: [9], mode: "fog" }], /`players\[0\]`: Too big/],
      [[one, 7], /^edits\[1\]: /],
    ];
    for (const [value, said] of cases) {
      let thrown: unknown;
      try { parseEdits(value); } catch (e) { thrown = e; }
      expect(thrown, JSON.stringify(value)).toBeInstanceOf(CliError);
      expect((thrown as CliError).message, JSON.stringify(value)).toMatch(said);
      expect((thrown as CliError).exitCode).toBe(2);
    }
  });

  it("the command reads the file, applies it and prints a line an edit", async () => {
    const { path } = await copy();
    const dir = tmp(), file = join(dir, "edits.json"), out = join(dir, "out.scx");
    const before = readFileSync(path);
    writeFileSync(file, JSON.stringify({ edits: [{ op: "place_unit", unit: "Terran Marine", player: 1, tileX: 12, tileY: 53 }, { op: "update_units", where: { unit: "Terran Marine", location: "Base" }, invincible: true }, { op: "add_location", name: "Ramp", tiles: { x0: 20, y0: 40, x1: 24, y1: 44 } }] }));

    const dry = await scmjs("map", "edit", path, "--edits", file, "--dry-run");
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("  0  place_unit    Terran Marine · Player 1 · 400,1712 · unit 21\n  1  update_units  2 units changed\n  2  add_location  4  Ramp · 640,1280–768,1408\n");
    expect(dry.out).toContain("Locations +1\n  + 4  Ramp 640,1280–768,1408");
    expect(dry.out).toMatch(/ℹ ums\.scx: 3 edits · .*1 location added, 1 string added · not written \(--dry-run\)\n$/);
    expect(readFileSync(path).equals(before)).toBe(true);

    const json = JSON.parse((await scmjs("map", "edit", path, "--edits", file, "--out", out, "--json")).out) as { edits: { op: string; index?: number }[]; modified: boolean; dryRun: boolean; written: { path: string }; diff: { locations: unknown[] } };
    expect(json).toMatchObject({ modified: true, dryRun: false, written: { path: out } });
    expect(json.edits.map((e) => e.op)).toEqual(["place_unit", "update_units", "add_location"]);
    expect(json.diff.locations).toHaveLength(1);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect((await reopen(out)).scenario.units.filter((u) => u.unitId === 0).map((u) => u.stateFlags)).toEqual([UnitState.Invincible, UnitState.Invincible]);

    const written = await scmjs("map", "edit", path, "--edits", file);
    expect(written.out).toMatch(/✔ ums\.scx: 3 edits · .* · written to .*ums\.scx · /);
    expect(readFileSync(path).equals(before)).toBe(false);
  });

  it("the command's failures: a file that is not there or not JSON exits 2, an edit that cannot be done 1", async () => {
    const { path } = await copy();
    const dir = tmp(), file = join(dir, "edits.json");
    const before = readFileSync(path);
    const missing = await scmjs("map", "edit", path, "--edits", join(dir, "nope.json"));
    expect([missing.code, missing.err]).toEqual([2, expect.stringMatching(/No file .*nope\.json/)]);
    writeFileSync(file, "[{ op: 1 }]");
    const notJson = await scmjs("map", "edit", path, "--edits", file);
    expect([notJson.code, notJson.err]).toEqual([2, expect.stringMatching(/edits\.json is not JSON: /)]);
    writeFileSync(file, JSON.stringify([{ op: "place_unit", unit: "Terran Marine", player: 1, x: 1, y: 1, colour: 2 }]));
    const shape = await scmjs("map", "edit", path, "--edits", file);
    expect([shape.code, shape.err]).toEqual([2, expect.stringMatching(/edits\[0\] \(place_unit\): `colour` is not a field of place_unit/)]);
    writeFileSync(file, JSON.stringify([{ op: "place_unit", unit: "Terran Marine", player: 1, x: 1, y: 1 }, { op: "remove_units", indices: [50] }]));
    const refused = await scmjs("map", "edit", path, "--edits", file, "--out", join(dir, "never.scx"));
    expect([refused.code, refused.out]).toEqual([1, ""]);
    expect(refused.err).toContain("edits[1] (remove_units): there is no unit 50: the map's units are 0 to 20\n  Nothing was changed: the edits are applied together or not at all.");
    expect(existsSync(join(dir, "never.scx"))).toBe(false);
    expect((await scmjs("map", "edit", path)).err).toMatch(/required option '--edits <file>' not given/);
    expect((await scmjs("map", "edit", "-", "--edits", "-")).err).toMatch(/cannot both come from standard input/);
    expect(readFileSync(path).equals(before)).toBe(true);
  });
});
