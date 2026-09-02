import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { decodeUnitsDat } from "../src/formats/dat/dat";
import { loadTileset, type Tileset } from "../src/formats/tileset/decode";
import { checkPlacement, collidesWith, DEFAULT_PLACEMENT, strandedUnits, terrainFits } from "../src/editor/placement";
import { addUnits, applyUnitChanges, makeUnit, unitGeometry } from "../src/editor/units";
import { applyChanges, stampTile } from "../src/editor/terrain";
import { isFlatPair } from "../src/formats/tileset/palette";
import { groupBuildable, TileFlag } from "../src/formats/tileset/decode";

const PUBLIC = join(import.meta.dirname, "..", "public");
const UNITS_DAT = join(PUBLIC, "arr", "units.dat");
const units = existsSync(UNITS_DAT) ? decodeUnitsDat(new Uint8Array(readFileSync(UNITS_DAT))) : null;

const tilesetFiles = ["cv5", "vf4", "vr4", "vx4", "wpe"].map((ext) => join(PUBLIC, "tileset", `badlands.${ext}`));
const haveTileset = tilesetFiles.every((f) => existsSync(f));

function loadBadlands(): Tileset {
  const read = (ext: string) => new Uint8Array(readFileSync(join(PUBLIC, "tileset", `badlands.${ext}`)));
  return loadTileset({ cv5: read("cv5"), vf4: read("vf4"), vr4: read("vr4"), vx4: read("vx4"), wpe: read("wpe") });
}

/** A tile id from the first flat pair that is buildable/walkable, and one that is water (unwalkable everywhere). */
function findTiles(ts: Tileset): { ground: number; water: number } {
  let ground = -1, water = -1;
  for (let g = 2; g + 1 < ts.groups.length && (ground < 0 || water < 0); g += 2) {
    if (!isFlatPair(ts, g)) continue;
    const id = g << 4;
    const mega = ts.groups[g].megatiles[0];
    if (!mega) continue;
    let walkable = 0;
    for (let i = 0; i < 16; i++) if (ts.megatileFlags[mega * 16 + i] & TileFlag.Walkable) walkable++;
    if (ground < 0 && walkable === 16 && groupBuildable(ts.groups[g])) ground = id;
    if (water < 0 && walkable === 0) water = id;
  }
  if (ground < 0 || water < 0) throw new Error("badlands has no plain ground / water pair?");
  return { ground, water };
}

// `if`, not `skipIf`: vitest runs a skipped describe's body to collect it, and this one reads the files.
if (units && haveTileset) describe("terrain checks against the real tileset", () => {
  const ts = loadBadlands();
  const { ground, water } = findTiles(ts);
  const scn = createScenario({ name: "t", description: "", width: 16, height: 16, tileset: 0 });
  scn.tiles.fill(ground);
  // Tiles 8..15 in every row are water.
  for (let y = 0; y < 16; y++) for (let x = 8; x < 16; x++) scn.tiles[y * 16 + x] = water;
  const marine = 0, cc = 106, overlord = 42;

  it("holds ground units and buildings on land but not on water", () => {
    expect(terrainFits(scn, ts, unitGeometry(units, marine), marine, 64, 64)).toBe(true);
    expect(terrainFits(scn, ts, unitGeometry(units, marine), marine, 12 * 32, 64)).toBe(false);
    expect(terrainFits(scn, ts, unitGeometry(units, cc), cc, 64, 48)).toBe(true); // 4x3 box at tiles 0..3
    expect(terrainFits(scn, ts, unitGeometry(units, cc), cc, 7 * 32, 48)).toBe(false); // straddles the shore
  });

  it("lets flyers and start locations go anywhere, and is lenient without a tileset", () => {
    expect(terrainFits(scn, ts, unitGeometry(units, overlord), overlord, 12 * 32, 64)).toBe(true);
    expect(terrainFits(scn, ts, unitGeometry(units, 214), 214, 12 * 32, 64)).toBe(true);
    expect(terrainFits(scn, null, unitGeometry(units, marine), marine, 12 * 32, 64)).toBe(true);
  });

  it("reports the failing check, honouring the options", () => {
    expect(checkPlacement(scn, ts, units, DEFAULT_PLACEMENT, marine, 12 * 32, 64)).toEqual({ problem: "terrain", blocker: -1, reason: "the ground is unwalkable" });
    expect(checkPlacement(scn, ts, units, { ...DEFAULT_PLACEMENT, checkTerrain: false }, marine, 12 * 32, 64).problem).toBeNull();
  });

  it("finds units stranded by a terrain edit, only among those touching changed tiles", () => {
    const map = createScenario({ name: "t", description: "", width: 16, height: 16, tileset: 0 });
    map.tiles.fill(ground);
    map.units = [];
    applyUnitChanges(map, addUnits(map, [
      makeUnit(units, marine, 0, 48, 48, 1), // tile 1,1
      makeUnit(units, marine, 0, 10 * 32 + 16, 48, 2), // tile 10,1
      makeUnit(units, overlord, 0, 48, 48, 3), // flyer over tile 1,1
    ]));
    const changes = stampTile(map, [0, 1 * 16 + 1, 2 * 16 + 2], water);
    applyChanges(map, changes);
    expect(strandedUnits(map, ts, units, changes.map((c) => c.at))).toEqual([0]);
    expect(strandedUnits(map, ts, units, [])).toEqual([]);
  });
});

describe.skipIf(!units)("collision checks", () => {
  const scn = createScenario({ name: "t", description: "", width: 16, height: 16, tileset: 0 });
  scn.units = [];
  applyUnitChanges(scn, addUnits(scn, [
    makeUnit(units, 0, 0, 100, 100, 1), // marine
    makeUnit(units, 42, 0, 200, 100, 2), // overlord
    makeUnit(units, 214, 0, 300, 100, 3), // start location
  ]));

  it("blocks ground units on ground units, ignores flyers and start locations", () => {
    const marine = unitGeometry(units, 0);
    expect(collidesWith(scn, units, marine, 0, 104, 100)).toBe(0);
    expect(collidesWith(scn, units, marine, 0, 130, 100)).toBe(-1);
    expect(collidesWith(scn, units, marine, 0, 200, 100)).toBe(-1); // under the overlord
    expect(collidesWith(scn, units, marine, 0, 300, 100)).toBe(-1); // on the start location
    expect(collidesWith(scn, units, unitGeometry(units, 42), 42, 100, 100)).toBe(-1); // a flyer over the marine
    expect(collidesWith(scn, units, marine, 0, 104, 100, new Set([0]))).toBe(-1); // the marine itself, when moving
  });

  it("is reported with the blocker, and can be switched off", () => {
    expect(checkPlacement(scn, null, units, DEFAULT_PLACEMENT, 0, 104, 100)).toEqual({ problem: "collision", blocker: 0, reason: "it overlaps Terran Marine" });
    expect(checkPlacement(scn, null, units, { ...DEFAULT_PLACEMENT, checkCollision: false }, 0, 104, 100).problem).toBeNull();
  });
});
