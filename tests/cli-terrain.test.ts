/**
 * Terrain and doodads from the command line (cli/src/terrain.ts, the terrain and doodad edits of mapedit.ts) and the
 * plugin host given a copy of the game (src/plugins/headless.ts#loadGameCopy, cli/src/run.ts#giveHostGame).
 *
 * The first suites need no game: the list's shape, what a list needs, the failure without a copy, a host given a
 * copy that holds nothing. The last one lays real terrain and needs a copy of StarCraft on this computer (the one in
 * SCMJS_STARCRAFT, else the first in the usual places); CI has none, and it is skipped there.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { openMapBytes } from "../src/editor/mapFile";
import { buildAtlas } from "../src/formats/tileset/atlas";
import { headlessApi, loadGameCopy } from "../src/plugins/headless";
import { writeNewMap } from "../cli/src/create";
import { findGameCopy } from "../cli/src/engine";
import { loadMapInput, readInput } from "../cli/src/files";
import { editMap, needsGame, parseEdits, printEdits } from "../cli/src/mapedit";
import { createMcpServer } from "../cli/src/mcp";
import { runOnMap } from "../cli/src/run";
import { listDoodads, listTerrain, printDoodads, printTerrain, seeded } from "../cli/src/terrain";
import { CliError, visible } from "../cli/src/ui";
import { testMap } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-terrain-"));
const failure = async (p: Promise<unknown>): Promise<CliError> => p.then(() => { throw new Error("did not fail"); }, (e: unknown) => e as CliError);
const open = async (path: string) => { const input = await readInput(path); return { input, doc: await loadMapInput(input) }; };

describe("terrain and doodad edits: the list", () => {
  it("takes the four kinds with their fields, and holds each to its own", () => {
    const list = [
      { op: "paint_terrain", terrain: "High Dirt", tiles: { x0: 8, y0: 8, x1: 24, y1: 24 }, shape: "ellipse", symmetry: "rot180" },
      { op: "paint_terrain", terrain: 5, cover: 0.2, grain: 10, seed: 7 },
      { op: "place_doodad", doodad: "ramp", tileX: 12, tileY: 20, within: 6 },
      { op: "scatter_doodads", doodad: "Jungle", location: "Base", density: 0.1, seed: 3 },
      { op: "remove_doodads", where: { doodad: "Jungle", tiles: { x0: 0, y0: 0, x1: 8, y1: 8 } } },
      { op: "place_unit", unit: "Terran Command Center", player: 1, tileX: 10, tileY: 10, snap: true, check: true },
    ];
    expect(parseEdits(list)).toEqual(list);
    const cases: [unknown, RegExp][] = [
      [{ op: "paint_terrain", terrain: "Dirt", count: 3 }, /^edits\[0\] \(paint_terrain\): `count` is not a field of paint_terrain: it takes `terrain`, `rect`, `tiles`, `location`, `shape`, `cover`, `grain`, `seed`, `symmetry`/],
      [{ op: "paint_terrain", terrain: "Dirt", cover: 1.5 }, /^edits\[0\] \(paint_terrain\): `cover`: /],
      [{ op: "paint_terrain", terrain: "Dirt", symmetry: "spiral" }, /^edits\[0\] \(paint_terrain\): `symmetry`: /],
      [{ op: "place_doodad", doodad: "ramp", x: 100, y: 100 }, /`x`, `y` are not fields of place_doodad/],
      [{ op: "place_doodad", doodad: "ramp" }, /^edits\[0\] \(place_doodad\): `tileX`: /],
      [{ op: "fill_terrain", terrain: "Dirt" }, /`op` is one of place_unit, .* paint_terrain, place_doodad, scatter_doodads, remove_doodads$/],
    ];
    for (const [entry, said] of cases) expect(() => parseEdits([entry]), JSON.stringify(entry)).toThrow(said);
  });

  it("knows which lists read the game's files", () => {
    const edits = (list: unknown[]) => parseEdits(list);
    expect(needsGame(edits([{ op: "remove_units", indices: [1] }, { op: "place_unit", unit: "Terran Marine", player: 1, x: 64, y: 64 }]))).toBe(false);
    expect(needsGame(edits([{ op: "place_unit", unit: "Terran Marine", player: 1, x: 64, y: 64, check: true }]))).toBe(true);
    expect(needsGame(edits([{ op: "place_unit", unit: "Terran Bunker", player: 1, tileX: 4, tileY: 4, snap: true }]))).toBe(true);
    for (const e of [{ op: "paint_terrain", terrain: "Dirt" }, { op: "place_doodad", doodad: 3, tileX: 1, tileY: 1 }, { op: "scatter_doodads", doodad: "Dirt" }, { op: "remove_doodads", indices: [0] }]) expect(needsGame(edits([e])), e.op).toBe(true);
  });

  it("fails before anything is written when the folder named holds no copy of the game", async () => {
    const dir = tmp();
    const path = join(dir, "t.scx");
    await writeNewMap(path, { width: 64, height: 64, tileset: "jungle", name: "t", description: "", version: "broodwar", players: 2, layout: "ring" });
    const before = readFileSync(path);
    const { input, doc } = await open(path);
    const e = await failure(editMap(input, doc, parseEdits([{ op: "paint_terrain", terrain: "High Dirt" }]), { starcraft: dir }));
    expect(e).toBeInstanceOf(CliError);
    expect(e.message).toMatch(/is not a copy of StarCraft/);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("gives the same numbers for the same seed", () => {
    const a = seeded(7), b = seeded(7), c = seeded(8);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    for (const v of first) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe("the plugin host and a copy of the game", () => {
  it("builds a tileset's atlas without a page: the averages, and no picture", async () => {
    // One megatile of sixteen minitiles, each of palette colour 1 (red).
    const wpe = new Uint8Array(1024);
    wpe.set([255, 0, 0, 0], 4);
    const { loadTileset } = await import("../src/formats/tileset/decode");
    const tileset = loadTileset({ cv5: new Uint8Array(52), vf4: new Uint8Array(32), vr4: new Uint8Array(64).fill(1), wpe, vx4: new Uint8Array(32) });
    const atlas = await buildAtlas(tileset);
    expect(atlas.image).toBeNull();
    expect(atlas.animation).toBeNull();
    expect(atlas.count).toBe(tileset.megatileCount);
    expect(atlas.averages[0]).toBe(0xff0000);
  });

  it("does without what a copy lacks, as a host with no game data does", async () => {
    const bytes = new Uint8Array(readFileSync(testMap("ums.scx")));
    const doc = await openMapBytes(bytes, "ums.scx");
    const asked: string[] = [];
    const loaded = await loadGameCopy({ label: "An empty copy", read: async (member) => { asked.push(member); return null; } }, doc);
    expect(loaded).toEqual({ tileset: false, units: false });
    // The editor's own loaders did the asking, by the game's names for the files.
    expect(asked).toContain("arr\\units.dat");
    expect(asked.some((m) => /^tileset\\[a-z]+\.cv5$/.test(m))).toBe(true);
    const host = headlessApi(doc, "test");
    try {
      expect(host.api.gameData.source()).toMatchObject({ kind: "reader", label: "An empty copy" });
      expect(host.api.terrain.types()).toEqual([]);
      const r = host.api.document.edit("paint", (tx) => { expect(tx.paintIsom({ x: 4, y: 4 }, 2)).toBe(false); });
      expect(r.changed).toBe(false);
    } finally { host.dispose(); }
  });
});

const copy = (() => { try { return findGameCopy(process.env.SCMJS_STARCRAFT, { pictures: true }); } catch { return null; } })();

describe.skipIf(!copy)("terrain and doodads laid with a copy of the game", () => {
  /** A new 64 × 64 Jungle map of flat Dirt, with two start locations. */
  async function fresh(name = "t.scx") {
    const path = join(tmp(), name);
    await writeNewMap(path, { width: 64, height: 64, tileset: "jungle", name: "t", description: "", version: "broodwar", players: 2, layout: "ring" });
    return path;
  }
  const edit = async (path: string, list: unknown[], options: Parameters<typeof editMap>[3] = {}) => { const { input, doc } = await open(path); return editMap(input, doc, parseEdits(list), options); };
  const terrain = async (path: string, o: Parameters<typeof listTerrain>[2] = {}) => listTerrain((await open(path)).doc, "t.scx", { cell: 1, ...o });
  const share = (r: Awaited<ReturnType<typeof listTerrain>>, name: string) => r.terrains.find((x) => x.name === name)!.tiles;

  it("lists the tileset's terrains and draws the map as letters", async () => {
    const path = await fresh();
    const r = await terrain(path);
    expect([r.tileset, r.width, r.height, r.isometric]).toEqual(["Jungle World", 64, 64, true]);
    expect(r.terrains.map((x) => x.name)).toEqual(expect.arrayContaining(["Water", "Dirt", "High Dirt", "Jungle"]));
    expect(r.terrains.find((x) => x.name === "Dirt")).toMatchObject({ height: 0, buildable: true, tiles: 4096, share: 1, letter: "d" });
    expect(r.terrains.find((x) => x.name === "High Dirt")).toMatchObject({ height: 1, letter: "D", tiles: 0 });
    expect(new Set(r.terrains.map((x) => x.letter)).size).toBe(r.terrains.length);
    expect(r.grid.rows).toHaveLength(64);
    expect(r.grid.rows.every((row) => row === "d".repeat(64))).toBe(true);
    expect(r.grid.legend).toEqual({ d: "Dirt" });
    // Sixty-four columns at most unless told: a character every two tiles on a wider area would be `cell: 2`.
    expect((await terrain(path, { cell: 4 })).grid.rows).toEqual(Array.from({ length: 16 }, () => "d".repeat(16)));
    const lines = printTerrain("t.scx", r).map(visible);
    expect(lines[0]).toBe("t.scx  64 × 64 · Jungle World");
    expect(lines.some((l) => /^\s+d\s+Dirt\s+2\s+low\s+yes\s+4,096\s+100%$/.test(l))).toBe(true);
    expect(lines.at(-1)).toBe(`  63 ${"d".repeat(64)}`);
  });

  it("paints a plateau: the cliff forms on its own, and Check Map has nothing to say", async () => {
    const path = await fresh();
    const r = await edit(path, [{ op: "paint_terrain", terrain: "High Dirt", tiles: { x0: 20, y0: 16, x1: 44, y1: 40 }, shape: "ellipse" }]);
    expect(r.edits[0]).toMatchObject({ op: "paint_terrain", terrain: "High Dirt", refused: 0 });
    expect((r.edits[0] as { tiles: number }).tiles).toBeGreaterThan(300);
    expect(r.game).toMatchObject({ tileset: true });
    expect(printEdits("t.scx", r).map(visible)[0]).toMatch(/^\s+0 {2}paint_terrain {2}High Dirt · [\d,]+ tiles changed$/);
    const after = await terrain(path);
    expect(share(after, "High Dirt")).toBeGreaterThan(200);
    expect(after.edges).toBeGreaterThan(40);
    expect(after.grid.legend).toMatchObject({ d: "Dirt", D: "High Dirt", "#": expect.stringContaining("cliff") });
    // An ellipse, not the rectangle: the rectangle's corner is still Dirt, its middle High Dirt.
    expect(after.grid.rows[17][21]).toBe("d");
    expect(after.grid.rows[28][32]).toBe("D");
    const { validateScenario } = await import("../src/editor/validate");
    expect(validateScenario((await open(path)).doc.scenario).filter((i) => i.level === "error")).toEqual([]);
  });

  it("paints patches from a seed, the same for the same seed, and mirrors a stroke", async () => {
    const water = (seed: number, symmetry?: string) => [{ op: "paint_terrain", terrain: "Water", cover: 0.15, grain: 10, seed, ...(symmetry ? { symmetry } : {}) }];
    const [a, b, c] = [await fresh(), await fresh(), await fresh()];
    await edit(a, water(7));
    await edit(b, water(7));
    await edit(c, water(8));
    const [ga, gb, gc] = [await terrain(a), await terrain(b), await terrain(c)];
    expect(share(ga, "Water")).toBeGreaterThan(200);
    expect(share(ga, "Water")).toBeLessThan(2000);
    expect(gb.grid.rows).toEqual(ga.grid.rows);
    expect(gc.grid.rows).not.toEqual(ga.grid.rows);
    const turned = await fresh();
    await edit(turned, water(7, "rot180"));
    const rows = (await terrain(turned)).grid.rows;
    const water180 = rows.map((row) => [...row].map((ch) => ch === "w"));
    // Water where its half-turn image is water, but for the shore: a shore's tiles are not its own image turned
    // (the tileset draws a south shore deeper than a north one), so a few tiles at the edges differ.
    let same = 0, all = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { if (water180[y][x]) { all++; if (water180[63 - y][63 - x]) same++; } }
    expect(all).toBeGreaterThan(300);
    expect(same / all).toBeGreaterThan(0.9);
    expect((await failure(edit(await fresh("wide.scx"), [{ op: "paint_terrain", terrain: "Water", grain: 4 }]))).message).toMatch(/^edits\[0\] \(paint_terrain\): `grain` and `seed` shape the patches of `cover`/);
  });

  it("names a terrain it does not know with the ones the tileset has", async () => {
    const path = await fresh();
    const before = readFileSync(path);
    const unknown = await failure(edit(path, [{ op: "paint_terrain", terrain: "Lava" }]));
    expect(unknown.message).toBe("edits[0] (paint_terrain): No terrain is called \"Lava\"");
    expect(unknown.hint).toMatch(/^This tileset has Water, Dirt, .*High Dirt.*\. Nothing was changed/);
    expect((await failure(edit(path, [{ op: "paint_terrain", terrain: "Jungle" }, { op: "paint_terrain", terrain: "Ruin" }]))).message).toMatch(/^edits\[1\] \(paint_terrain\): "Ruin" is Ruins, High Ruins: say which$/);
    expect((await failure(edit(path, [{ op: "paint_terrain", terrain: 99 }]))).message).toMatch(/There is no terrain 99 in this tileset/);
    expect(readFileSync(path).equals(before)).toBe(true);
    // A name whole wins over a name it is part of; an id is the one map terrain lists.
    const r = await edit(path, [{ op: "paint_terrain", terrain: "dirt", tiles: { x0: 0, y0: 0, x1: 8, y1: 8 } }, { op: "paint_terrain", terrain: 3, tiles: { x0: 40, y0: 40, x1: 56, y1: 52 } }], { dryRun: true });
    expect(r.edits.map((e) => (e as { terrain: string }).terrain)).toEqual(["Dirt", "High Dirt"]);
    expect(r.written).toBeNull();
  });

  it("places a ramp where one fits, lists it, and takes it away again", async () => {
    const path = await fresh();
    const plateau = { op: "paint_terrain", terrain: "High Dirt", tiles: { x0: 20, y0: 16, x1: 44, y1: 40 }, shape: "ellipse" };
    // On flat Dirt no ramp fits, and the list is all or nothing: the plateau is not painted either.
    const before = readFileSync(path);
    const nowhere = await failure(edit(path, [plateau, { op: "place_doodad", doodad: "ramp", tileX: 2, tileY: 2 }]));
    expect(nowhere.message).toMatch(/^edits\[1\] \(place_doodad\): none of the \d+ doodads of ramp fits at 2,2$/);
    expect(nowhere.hint).toMatch(/`within` looks around for a place it fits/);
    expect(readFileSync(path).equals(before)).toBe(true);

    const r = await edit(path, [plateau, { op: "place_doodad", doodad: "ramp", tileX: 30, tileY: 38, within: 8 }]);
    const ramp = r.edits[1] as { op: string; index: number; id: number; name: string; tileX: number; tileY: number; width: number; height: number };
    expect(ramp).toMatchObject({ op: "place_doodad", index: 0 });
    expect(ramp.name).toMatch(/^Cliff #\d+$/);
    expect(Math.abs(ramp.tileX - 30)).toBeLessThanOrEqual(8);
    expect(Math.abs(ramp.tileY - 38)).toBeLessThanOrEqual(8);
    const { doc } = await open(path);
    const listed = await listDoodads(doc, "t.scx", { category: "ramp" });
    expect(listed.total).toBe(1);
    expect(listed.doodads).toEqual([{ index: 0, id: ramp.id, name: ramp.name, category: "Cliff", ramp: true, tileX: ramp.tileX, tileY: ramp.tileY, width: ramp.width, height: ramp.height }]);
    expect(listed.palette!.length).toBeGreaterThan(10);
    expect(listed.palette!.every((d) => d.ramp)).toBe(true);
    expect(listed.categories.find((c) => c.name === "Cliff")!.ramps).toBeGreaterThan(0);
    expect(printDoodads("t.scx", listed).map(visible).slice(0, 3).join("\n")).toMatch(/^t\.scx {2}1 doodad · Jungle World\n\s+index\s+doodad\s+id\s+tile\s+size\n\s+0\s+Cliff #\d+ \(ramp\)\s+\d+\s+\d+,\d+\s+\d × \d$/);

    const gone = await edit(path, [{ op: "remove_doodads", indices: [0] }]);
    expect(gone.edits[0]).toEqual({ op: "remove_doodads", matched: 1, changed: 1 });
    expect((await open(path)).doc.scenario.doodads).toHaveLength(0);
    expect((await failure(edit(path, [{ op: "remove_doodads", indices: [0] }]))).message).toBe("edits[0] (remove_doodads): there is no doodad 0: the map has no doodads");
  });

  it("scatters doodads where they fit, the same for the same seed, and removes them by what they are", async () => {
    const path = await fresh();
    const scatter = [{ op: "scatter_doodads", doodad: "Dirt", tiles: { x0: 8, y0: 8, x1: 40, y1: 40 }, count: 10, seed: 3 }];
    const r = await edit(path, scatter);
    const placed = (r.edits[0] as { placed: { index: number; id: number; name: string; tileX: number; tileY: number; width: number; height: number }[] }).placed;
    expect(placed).toHaveLength(10);
    expect(placed.map((d) => d.index)).toEqual(Array.from({ length: 10 }, (_, i) => i));
    for (const d of placed) {
      expect(d.name).toMatch(/^Dirt #\d+$/);
      expect([d.tileX >= 8, d.tileY >= 8, d.tileX + d.width <= 40, d.tileY + d.height <= 40]).toEqual([true, true, true, true]);
    }
    const again = await fresh();
    expect(((await edit(again, scatter)).edits[0] as { placed: unknown[] }).placed).toEqual(placed);
    // A doodad of High Dirt has no ground to go on here: nothing is placed, and that is an answer, not an error.
    const none = await edit(again, [{ op: "scatter_doodads", doodad: "High Dirt", count: 5 }], { dryRun: true });
    expect((none.edits[0] as { placed: unknown[] }).placed).toEqual([]);
    expect(printEdits("t.scx", none).map(visible)[0]).toMatch(/scatter_doodads {2}no doodad fits there$/);
    // Removed by category and area; an index is the map's before the call, whatever an earlier edit removed.
    const out = await edit(path, [{ op: "remove_doodads", indices: [0] }, { op: "remove_doodads", indices: [9] }, { op: "remove_doodads", where: { doodad: "Dirt", tiles: { x0: 0, y0: 0, x1: 64, y1: 64 } } }]);
    expect(out.edits.map((e) => (e as { changed: number }).changed)).toEqual([1, 1, 8]);
    expect((await open(path)).doc.scenario.doodads).toHaveLength(0);
    expect(share(await terrain(path), "Dirt")).toBe(4096);
  });

  it("puts a building on the building grid and refuses ground it cannot stand on", async () => {
    const path = await fresh();
    const lake = { op: "paint_terrain", terrain: "Water", tiles: { x0: 36, y0: 36, x1: 60, y1: 56 } };
    const r = await edit(path, [lake, { op: "place_unit", unit: "Terran Command Center", player: 1, tileX: 20, tileY: 30, snap: true, check: true }]);
    const placed = r.edits[1] as { x: number; y: number; index: number };
    // Four tiles by three: its centre is on a tile's edge across and in a tile's middle down.
    expect([placed.x % 32, placed.y % 32]).toEqual([0, 16]);
    expect((await open(path)).doc.scenario.units[placed.index]).toMatchObject({ unitId: 106, x: placed.x, y: placed.y });
    const wet = await failure(edit(path, [{ op: "place_unit", unit: "Terran Command Center", player: 1, tileX: 48, tileY: 46, snap: true, check: true }]));
    expect(wet.message).toMatch(/^edits\[0\] \(place_unit\): Terran Command Center cannot go at \d+,\d+: the ground is unbuildable$/);
    const onTop = await failure(edit(path, [{ op: "place_unit", unit: "Terran Marine", player: 1, x: placed.x, y: placed.y, check: true }]));
    expect(onTop.message).toMatch(/cannot go at \d+,\d+: it overlaps Terran Command Center$/);
  });

  describe("through the server", () => {
    type Result = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
    const text = (r: Result) => r.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    async function connected() {
      const client = new Client({ name: "test", version: "0" });
      const { server } = createMcpServer();
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(a), client.connect(b)]);
      return { client, call: async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Result };
    }

    it("map_terrain, map_edit and map_doodads lay a hill with a ramp and read it back", async () => {
      const { client, call } = await connected();
      try {
        const path = await fresh();
        const out = join(tmp(), "hill.scx");
        const flat = await call("map_terrain", { path, cell: 2 });
        expect(flat.isError).toBeFalsy();
        expect(text(flat)).toMatch(/^t\.scx {2}64 × 64 · Jungle World\n\s+letter\s+terrain\s+id\s+height\s+buildable\s+tiles\s+share\n/);
        expect((flat.structuredContent as { grid: { rows: string[]; cell: number } }).grid).toMatchObject({ cell: 2, rows: Array.from({ length: 32 }, () => "d".repeat(32)) });
        const edited = await call("map_edit", { path, out, edits: [
          { op: "paint_terrain", terrain: "High Dirt", tiles: { x0: 20, y0: 16, x1: 44, y1: 40 }, shape: "ellipse" },
          { op: "place_doodad", doodad: "ramp", tileX: 30, tileY: 38, within: 8 },
          { op: "scatter_doodads", doodad: "Dirt", count: 6, seed: 2 },
        ] });
        expect(edited.isError, text(edited)).toBeFalsy();
        expect(text(edited)).toMatch(/0 {2}paint_terrain\s+High Dirt · [\d,]+ tiles changed\n\s+1 {2}place_doodad\s+Cliff #\d+ · \d+,\d+ · \d × \d · doodad 0\n\s+2 {2}scatter_doodads {2}6 doodads placed\n/);
        expect((edited.structuredContent as { game: { tileset: boolean } }).game.tileset).toBe(true);
        const hill = await call("map_terrain", { path: out, tiles: { x0: 16, y0: 12, x1: 48, y1: 44 }, cell: 1 });
        const grid = (hill.structuredContent as { grid: { x0: number; y0: number; rows: string[]; legend: Record<string, string> } }).grid;
        expect([grid.x0, grid.y0, grid.rows.length, grid.rows[0].length]).toEqual([16, 12, 32, 32]);
        expect(grid.rows[16][16]).toBe("D");
        expect(grid.legend["#"]).toMatch(/cliff/);
        const doodads = await call("map_doodads", { path: out, category: "ramp" });
        expect(text(doodads)).toMatch(/^hill\.scx {2}1 of 7 doodads · Jungle World\n/);
        expect((doodads.structuredContent as { doodads: unknown[]; palette: unknown[] }).doodads).toHaveLength(1);
        // The map it started from is as it was: `out` took the change.
        expect((await open(path)).doc.scenario.doodads).toHaveLength(0);
        const unknown = await call("map_edit", { path, edits: [{ op: "paint_terrain", terrain: "Lava" }] });
        expect(unknown.isError).toBe(true);
        expect(text(unknown)).toMatch(/^edits\[0\] \(paint_terrain\): No terrain is called "Lava"\nThis tileset has Water, Dirt/);
      } finally { await client.close(); }
    });

    it("map_generate writes a melee map, and refuses a file that is there", async () => {
      const { client, call } = await connected();
      try {
        const path = join(tmp(), "duel.scx");
        const made = await call("map_generate", { path, seed: 7 });
        expect(made.isError, text(made)).toBeFalsy();
        expect(made.structuredContent).toMatchObject({ players: 2, seed: 7, width: 128, height: 128, tileset: "Jungle World" });
        const { doc } = await open(path);
        expect(doc.scenario.doodads.length).toBeGreaterThan(0);
        const again = await call("map_generate", { path, seed: 7 });
        expect(again.isError).toBe(true);
        expect(text(again)).toMatch(/is there already\nforce overwrites it\./);
      } finally { await client.close(); }
    }, 60_000);
  });

  it("gives a script run over the map the game's data, unless told not to", async () => {
    const path = await fresh();
    const dir = tmp();
    const script = join(dir, "probe.js");
    writeFileSync(script, "export async function activate(api) { api.ui.status(JSON.stringify({ loaded: await api.tileset.load(), types: api.terrain.types().length, units: api.data.ready() })); }\n");
    const { input, doc } = await open(path);
    const withGame = await runOnMap(doc, input.path, input.bytes, script, { dryRun: true, game: true });
    expect(withGame.game).toMatchObject({ tileset: true, units: true });
    expect(JSON.parse(withGame.events.find((e) => e.kind === "status")!.text)).toMatchObject({ loaded: true, units: true });
    expect(JSON.parse(withGame.events.find((e) => e.kind === "status")!.text).types).toBeGreaterThan(5);
    expect((await runOnMap(doc, input.path, input.bytes, script, { dryRun: true })).game).toBeNull();
  });
});
