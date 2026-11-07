/**
 * `scmjs map generate` (cli/src/generate.ts, generatecmd.ts, bases.ts): the plan's invariants with no game data — the
 * same seed is the same plan, the lattice is its own image under the mirrors and the half turn, every player's bases
 * are one template, the classes are paintable — and, where `public/tileset` has been extracted (CI has none), the map
 * itself: the brush leaves no gap, the ramps are what joins each main to the ground below, every start reaches every
 * other, Check Map passes, each player owns the same resources, and the same options write the same bytes.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTileset } from "../src/formats/tileset/decode";
import { buildDoodadCatalogue } from "../src/formats/tileset/doodads";
import { checkIsom, hasIsom } from "../src/editor/isom";
import { openMapBytes, writeMapBytes } from "../src/editor/mapFile";
import { validateScenario } from "../src/editor/validate";
import { START_LOCATION } from "../src/data/units";
import { chebGap, HALL, layoutBase, ringPositions, MINERAL } from "../cli/src/bases";
import {
  BALANCE_TOLERANCE, generateMap, groundFrom, HIGH, innerSeed, LOW, MAIN_MINERALS, MINERAL_AMOUNT, NATURAL_MINERALS, planMap, resolveSymmetry,
  walkGrid, WATER, type GenerateOptions, type Graphics, type Plan,
} from "../cli/src/generate";
import { generateOptions, readGraphics, runGenerate } from "../cli/src/generatecmd";
import { CliError } from "../cli/src/ui";

const base: GenerateOptions = { width: 128, height: 128, players: 2, tileset: "jungle", seed: 7, symmetry: "rotational", style: "open" };

/** The class, lock and look of every diamond, as one string, for comparing plans. */
const fingerprint = (p: Plan) => `${Array.from(p.lattice.cls).join("")}|${Array.from(p.lattice.locked).join("")}|${Array.from(p.lattice.deco).join("")}|${JSON.stringify(p.complexes)}|${JSON.stringify(p.free)}`;

describe("map generate: options", () => {
  const refused = (f: Parameters<typeof generateOptions>[0]) => {
    try { generateOptions(f); } catch (e) { return e instanceof CliError ? e.exitCode : -1; }
    return 0;
  };
  it("takes the defaults and a seed", () => {
    expect(generateOptions({ seed: "12" })).toEqual({ ...base, seed: 12 });
    expect(generateOptions({ players: "8" }, () => 0.5)).toMatchObject({ width: 192, height: 192, players: 8, seed: 500_000_000 });
    expect(generateOptions({ players: "4", size: "192x128" }).symmetry).toBe("mirror-x");
  });
  it("refuses what cannot be laid out, with exit 2", () => {
    expect(refused({ players: "5" })).toBe(2);
    expect(refused({ players: "4", size: "96x96" })).toBe(2);
    expect(refused({ players: "8", size: "128x128" })).toBe(2);
    expect(refused({ tileset: "install" })).toBe(2);
    expect(refused({ tileset: "mars" })).toBe(2);
    expect(refused({ symmetry: "spiral" })).toBe(2);
    expect(refused({ players: "4", symmetry: "diagonal" })).toBe(2);
    expect(refused({ symmetry: "diagonal", size: "128x96" })).toBe(2);
    expect(refused({ style: "maze" })).toBe(2);
    expect(refused({ seed: "-1" })).toBe(2);
    expect(refused({ seed: "1.5" })).toBe(2);
  });
  it("turns two players half round and mirrors four both ways", () => {
    expect(resolveSymmetry(2, "rotational", 128, 128)).toEqual({ mode: "rot180" });
    expect(resolveSymmetry(2, "mirror-x", 128, 96)).toEqual({ mode: "h" });
    expect(resolveSymmetry(2, "diagonal", 128, 128)).toEqual({ mode: "diag" });
    // A quarter turn would need a ramp up a north-facing cliff, which no tileset has.
    expect(resolveSymmetry(4, "rotational", 128, 128)).toEqual({ mode: "hv" });
    expect(resolveSymmetry(6, "mirror-y", 128, 128)).toHaveProperty("problem");
  });
  it("gives every attempt its own inner seed, the seed itself first", () => {
    expect(innerSeed(7, 0)).toBe(7);
    const seeds = new Set(Array.from({ length: 12 }, (_, k) => innerSeed(7, k)));
    expect(seeds.size).toBe(12);
  });
});

describe("map generate: the plan (no game data)", () => {
  it("is the same for the same seed and different for another", () => {
    expect(fingerprint(planMap(base, 7))).toBe(fingerprint(planMap(base, 7)));
    expect(fingerprint(planMap(base, 8))).not.toBe(fingerprint(planMap(base, 7)));
  });

  const exact: [Partial<GenerateOptions>, (x: number, y: number, w: number, h: number) => [number, number]][] = [
    [{ symmetry: "mirror-x" }, (x, y, w) => [w - x, y]],
    [{ symmetry: "mirror-y" }, (x, y, _w, h) => [x, h - y]],
    [{ symmetry: "rotational" }, (x, y, w, h) => [w - x, h - y]],
    [{ players: 4, symmetry: "rotational" }, (x, y, w, h) => [w - x, h - y]],
    [{ players: 4, symmetry: "mirror-x", width: 192 }, (x, y, w) => [w - x, y]],
  ];
  it.each(exact.map(([o, f], i) => [i, o, f] as const))("lays the middle out as its own image (%i)", (_i, o, f) => {
    for (const seed of [1, 2, 3]) {
      const p = planMap({ ...base, ...o }, seed);
      const L = p.lattice;
      // The obstacles and the free bases are exact images of each other; the base complexes are copies of one
      // template (below), which do not turn, so only their footprint is left out here.
      const near = L.distance((i) => L.complex[i] === 1, 3);
      const inComplex = near.map((v) => (v <= 3 ? 1 : 0));
      let differ = 0, compared = 0;
      const where: string[] = [];
      for (const d of L.all()) {
        const [ix, iy] = f(d.x, d.y, L.w - 1, L.h - 1);
        if (!L.in(ix, iy) || inComplex[L.at(d.x, d.y)] || inComplex[L.at(ix, iy)]) continue;
        compared++;
        if (L.cls[L.at(d.x, d.y)] !== L.cls[L.at(ix, iy)]) { differ++; where.push(`${d.x},${d.y}`); }
      }
      expect(compared).toBeGreaterThan(1000);
      expect(differ, `seed ${seed}: ${where.slice(0, 6).join(" ")}`).toBe(0);
    }
  });

  it("gives every player the same complex, flipped for the players whose natural is to the left", () => {
    for (const o of [base, { ...base, players: 4 }, { ...base, players: 8, width: 192, height: 192 }, { ...base, players: 6, symmetry: "mirror-x" as const }]) {
      const p = planMap(o, 3);
      expect(p.complexes.length).toBe(o.players);
      expect(new Set(p.complexes.map((c) => c.owner))).toEqual(new Set(Array.from({ length: o.players }, (_, i) => i)));
      const shape = (c: Plan["complexes"][number]) => [c.sx * (c.natural.x - c.main.x), c.natural.y - c.main.y, c.sx * (c.ramp.x - c.main.x), c.ramp.y - c.main.y].join(",");
      expect(new Set(p.complexes.map(shape)).size).toBe(1);
    }
  });

  it("keeps a fourth complex without a player for three players", () => {
    const p = planMap({ ...base, players: 3 }, 5);
    expect(p.complexes.map((c) => c.owner).sort()).toEqual([-1, 0, 1, 2]);
  });

  it("leaves the classes paintable: no high spur, water clear of the cliffs", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { lattice: L } = planMap({ ...base, style: "chokes", players: 4 }, seed);
      const nearHigh = L.distance((i) => L.cls[i] === HIGH, 4);
      for (const d of L.all()) {
        const i = L.at(d.x, d.y);
        const same = L.edges(d.x, d.y).filter((n) => L.cls[L.at(n.x, n.y)] === L.cls[i]).length;
        if (L.cls[i] === HIGH || L.cls[i] === WATER) expect(same, `${d.x},${d.y}`).toBeGreaterThanOrEqual(2);
        if (L.cls[i] === WATER) expect(nearHigh[i]).toBeGreaterThanOrEqual(4);
        if (L.locked[i]) expect(L.cls[i]).toBe(LOW);
      }
    }
  });
});

describe("map generate: the Melee Wizard's base layout", () => {
  it("lays a line three tiles from the hall, the geyser past one end", () => {
    const hall = { x: 20, y: 20, ...HALL };
    const b = layoutBase(hall, { minerals: MAIN_MINERALS, geysers: 1, direction: Math.PI });
    expect(b.minerals).toHaveLength(9);
    expect(b.geysers).toHaveLength(1);
    for (const m of b.minerals) expect(chebGap(m, hall)).toBe(3);
    expect(chebGap(b.geysers[0], hall)).toBe(3);
    for (const m of b.minerals) expect(chebGap(m, b.geysers[0])).toBeGreaterThanOrEqual(1);
    // Every patch is on the hall's west side or wraps its corners, toward the direction asked.
    for (const m of b.minerals) expect(m.x + m.w / 2).toBeLessThan(hall.x + hall.w / 2 + 1);
    expect(ringPositions(hall, MINERAL, 3).length).toBeGreaterThan(20);
  });
  it("closes the line over refused positions", () => {
    const hall = { x: 20, y: 20, ...HALL };
    const b = layoutBase(hall, { minerals: 7, geysers: 1, direction: Math.PI, fits: (r) => r.y >= 20 });
    expect(b.minerals.every((m) => m.y >= 20)).toBe(true);
    expect(b.short.minerals).toBe(0);
  });
});

const tilesets = join(process.cwd(), "public/tileset");
const have = ["jungle", "badlands"].every((t) => existsSync(join(tilesets, `${t}.cv5`)) && existsSync(join(tilesets, `${t}.dddata.bin`)));

function graphicsOf(name: string): Graphics {
  const T = (e: string) => new Uint8Array(readFileSync(join(tilesets, `${name}.${e}`)));
  const ts = loadTileset({ cv5: T("cv5"), vf4: T("vf4"), vr4: T("vr4"), wpe: T("wpe"), vx4: T("vx4"), vx4Extended: false });
  return { tileset: ts, doodads: buildDoodadCatalogue(ts, T("dddata.bin"), null) };
}

describe.skipIf(!have)("map generate: the map (public/tileset)", () => {
  const cases: GenerateOptions[] = [
    base,
    { ...base, tileset: "badlands", players: 4, style: "chokes", seed: 11 },
    { ...base, players: 2, symmetry: "mirror-x", width: 128, height: 96, seed: 3 },
    { ...base, players: 3, seed: 21 },
  ];
  it.each(cases.map((o) => [`${o.players} players, ${o.tileset}, ${o.symmetry}, ${o.width}x${o.height}`, o] as const))("%s", (_name, o) => {
    const g = graphicsOf(o.tileset);
    const r = generateMap(o, g, "Test", "");
    const scn = r.built.scenario;
    // Every edge is the brush's own: no tile it could not join, and the lattice describes every tile.
    expect(scn.tiles.every((t) => t !== 0)).toBe(true);
    expect(hasIsom(scn) && checkIsom(scn, g.tileset).mismatched).toBe(0);
    // Check Map, with the tileset (units standing where they cannot walk are errors there).
    expect(validateScenario(scn, { tileset: g.tileset }).filter((i) => i.level === "error")).toEqual([]);
    // A ramp per complex, the starts, and each player's own resources.
    expect(r.built.ramps.length).toBe(r.plan.complexes.length);
    expect(scn.units.filter((u) => u.unitId === START_LOCATION).map((u) => u.owner).sort()).toEqual(Array.from({ length: o.players }, (_, i) => i));
    for (const s of r.measure.starts) {
      expect(s.mineralFields).toBe(MAIN_MINERALS + NATURAL_MINERALS);
      expect(s.minerals).toBe((MAIN_MINERALS + NATURAL_MINERALS) * MINERAL_AMOUNT);
      expect(s.geysers).toBe(2);
    }
    // Every start reaches every other on foot, and the pairs the symmetry makes equal are.
    expect(r.measure.connected).toBe(true);
    // Start to start the walks match closely; the free bases less so (a bottom player's main stands above its ramp,
    // between it and a base against the side), which is what the tolerance and the retries are for.
    expect(r.measure.startSpread).toBeLessThanOrEqual(0.03);
    expect(r.measure.spread).toBeLessThanOrEqual(2 * BALANCE_TOLERANCE);
  });

  it("joins each main to the ground only by its ramp", () => {
    const g = graphicsOf("jungle");
    const r = generateMap(base, g, "Test", "");
    const scn = r.built.scenario;
    const [a, b] = r.built.starts;
    const reach = (tiles: Uint16Array) => {
      const grid = walkGrid({ ...scn, tiles }, g.tileset);
      return groundFrom(grid, scn.width, scn.height, a.x, a.y)[Math.floor(b.y / 8) * scn.width * 4 + Math.floor(b.x / 8)];
    };
    expect(reach(scn.tiles)).toBeGreaterThan(0);
    // TILE keeps the ground under a doodad, so it is the map without its ramps.
    expect(reach(scn.editorTiles)).toBe(-1);
  });

  it("writes the same bytes for the same options, and different ones for another seed", async () => {
    const g = graphicsOf("badlands");
    const o = { ...base, tileset: "badlands" as const };
    const bytes = async (seed: number) => writeMapBytes(generateMap({ ...o, seed }, g, "Same", "").built.scenario, { format: "scx" });
    const first = await bytes(5);
    expect(Buffer.from(await bytes(5)).equals(Buffer.from(first))).toBe(true);
    expect(Buffer.from(await bytes(6)).equals(Buffer.from(first))).toBe(false);
  });

  it("writes a map that opens again, with the summary's numbers (the command, from a folder of tilesets)", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "scmjs-generate-")), "duel.scx");
    const { report } = await runGenerate(path, { seed: "9", tilesets }, "Duel");
    const opened = await openMapBytes(new Uint8Array(readFileSync(path)), "duel.scx");
    expect(opened.scenario.width).toBe(128);
    expect(report).toMatchObject({ players: 2, seed: 9, tileset: "Jungle World", balanced: true, check: { errors: 0 }, ramps: 2 });
    expect(report.starts.map((s) => s.minerals)).toEqual([24000, 24000]);
    expect(report.starts[0].ground["2"]).toBe(report.starts[1].ground["1"]);
    expect(report.bases.filter((b) => b.kind === "main")).toHaveLength(2);
  });

  it("says plainly when the folder has no tileset", async () => {
    await expect(readGraphics("jungle", { tilesets: tmpdir() })).rejects.toThrow(/no complete jungle tileset/);
  });
});
