import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { borrowTable } from "../src/editor/modTerrain/borrow";
import { BorrowStroke, borrowMember, latticeOf, type BorrowContext } from "../src/editor/modTerrain/borrowLattice";
import { bordersMember, decodeBorderRecord, encodeBorderRecord, resizeBorderRecord } from "../src/editor/modTerrain/borderRecord";
import { badlandsStandIns, flatTerrainsOf, type StandIns } from "../src/editor/modTerrain/borderLattice";
import {
  borderClasses, cutBorderTables, decodeBorderEvidence, emptyBorderEvidence, encodeBorderEvidence, gatherBorderEvidence, mergeBorderEvidence, pairKey,
  type BorderEvidence, type BorderSetup,
} from "../src/editor/modTerrain/borderTable";
import { shownSeams } from "../src/editor/heal";
import { brushDiamonds, diamondAt, diamondsOfRect, isDiamond, isomWidth, tilesFromIsom, type Diamond } from "../src/editor/isom";
import { openMapBytes, writeMapBytes } from "../src/editor/mapFile";
import { learnFromMaps } from "../src/editor/modTerrain/pieceLearn";
import { applyChanges } from "../src/editor/terrain";
import { readTerrainFile, sectionAgainstTable, writeTerrainFile } from "../src/formats/mod/terrain";
import { loadTileset, megatileForTile, type Tileset } from "../src/formats/tileset/decode";
import type { Scenario } from "../src/formats/chk/scenario";
import { borderWorld, DIRT, dirtMap, edgeSetRecords, EDGE_SET, GRASS, HOST_ERA, mapperMap } from "./support/borderWorld";

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const union = (...ls: Diamond[][]) => { const seen = new Set<string>(); const o: Diamond[] = []; for (const l of ls) for (const d of l) { const k = `${d.x},${d.y}`; if (!seen.has(k)) { seen.add(k); o.push(d); } } return o; };
const drag = (extent: number, centres: [number, number][], w = 64, h = 48) => union(...centres.map(([x, y]) => brushDiamonds({ width: w, height: h }, { x, y }, extent)));

/**
 * Cells whose rect is made of two borrowed terrains (both diamonds painted, with different terrains, and every diamond
 * around painted too: none of the tileset's ground near) that do not hold a copy of the tile the source's lattice lays
 * there. Between two borrowed terrains the source's own edge stands.
 */
function latticeEdgesBroken(scn: Scenario, ctx: BorrowContext, lattice: Uint8Array | null, record: Uint8Array | null): string[] {
  const rec = decodeBorderRecord(record, scn, ctx.sourceEra);
  if (!rec) return [];
  const isom = latticeOf(lattice, scn, ctx.sourceEra);
  const tiles = new Uint16Array(scn.width * scn.height);
  tilesFromIsom({ width: scn.width, height: scn.height, era: ctx.sourceEra, tiles, editorTiles: tiles, isom, dirty: new Set() } as unknown as Scenario & { isom: Uint16Array }, ctx.source, () => 0);
  const dw = isomWidth(scn) + 1;
  const painted = (x: number, y: number) => rec.painted.get(y * dw + x);
  const out: string[] = [];
  for (let y = 0; y < scn.height; y++) for (let rx = 0; rx < scn.width / 2; rx++) {
    const ds = diamondsOfRect(rx, y);
    const t = ds.map((d) => painted(d.x, d.y));
    if (t[0] === undefined || t[1] === undefined || t[0] === t[1]) continue;
    if (ds.some((d) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dy]) => painted(d.x + dx, d.y + dy) === undefined))) continue;
    for (const at of [y * scn.width + 2 * rx, y * scn.width + 2 * rx + 1]) {
      const g = tiles[at] >> 4;
      if (!ctx.source.groups[g]) continue;
      const copies = new Set<number>();
      for (const sm of ctx.source.groups[g].megatiles) for (const hm of (sm ? ctx.table.copies.get(sm) : undefined) ?? []) copies.add(hm);
      if (!copies.has(megatileForTile(ctx.host, scn.tiles[at]))) out.push(`${at % scn.width},${y}`);
    }
  }
  return out;
}

describe("the Drawn borders switch", () => {
  it("is on in a store with no browser storage behind it (Node, the headless host), and is a stored setting", async () => {
    const { createStore } = await import("jotai");
    const { drawnBordersAtom } = await import("../src/atoms/borderAtoms");
    const store = createStore();
    expect(store.get(drawnBordersAtom)).toBe(true);
    store.set(drawnBordersAtom, false);
    expect(store.get(drawnBordersAtom)).toBe(false);
    const { browserStorage } = await import("../src/app/storage");
    expect(browserStorage().getItem("scmjs.drawnBorders")).toBe("false"); // what the next page load reads
    store.set(drawnBordersAtom, true);
  });
});

describe("the border record", () => {
  it("keeps the painted base ground and each cell's host tile, and moves with a resize", () => {
    const size = { width: 64, height: 48 };
    const dw = isomWidth(size) + 1;
    const r = { painted: new Map([[3 * dw + 5, 2], [10 * dw + 12, 3]]), cells: new Map([[100, 0x20], [101, 0x21], [64 * 40 + 3, 0x30]]) };
    const bytes = encodeBorderRecord(size, 2, r)!;
    expect(bytes.length).toBe(18 + 2 * 6 + 3 * 6);
    const back = decodeBorderRecord(bytes, size, 2)!;
    expect([...back.painted]).toEqual([...r.painted]);
    expect([...back.cells]).toEqual([...r.cells]);
    expect(decodeBorderRecord(bytes, { width: 96, height: 48 }, 2)).toBeNull(); // another size
    expect(decodeBorderRecord(bytes, size, 3)).toBeNull(); // another source
    expect(encodeBorderRecord(size, 2, { painted: new Map(), cells: new Map() })).toBeNull();
    // moved 4 tiles right and 2 down on a map grown to 96 × 64
    const moved = decodeBorderRecord(resizeBorderRecord(bytes, size, { width: 96, height: 64 }, 2, 4, 2), { width: 96, height: 64 }, 2)!;
    expect(moved.cells.get((1 + 2) * 96 + 36 + 4)).toBe(0x20);
    expect(moved.painted.get((3 + 2) * (isomWidth({ width: 96 }) + 1) + 5 + 2)).toBe(2);
    expect(resizeBorderRecord(bytes, size, size, 2, 1, 0)).toBeNull(); // an odd shift: the lattice cannot follow
  });
});

describe("a terrain file's borders", () => {
  it("reads, checks and writes them back", () => {
    const text = JSON.stringify({ format: 1, tilesets: { badlands: { table: "abc", borders: [
      { source: "install", terrain: 3, ground: 2, shapes: { "A,A,B,h53|L": [0x9b20, 0x9b21], "bad|L": ["x"] } },
      { source: "badlands", terrain: 3, ground: 2, shapes: { a: [1] } },
      { source: "install", terrain: 3, ground: 2, shapes: { a: [1] } },
      { source: "install", terrain: 300, ground: 2, shapes: { a: [1] } },
    ] } } });
    const { file, dropped } = readTerrainFile(text);
    expect(file.tilesets.badlands.borders).toEqual([{ source: "install", terrain: 3, ground: 2, shapes: { "A,A,B,h53|L": [0x9b20, 0x9b21] } }]);
    expect(dropped.map((d) => d.reason).sort()).toEqual(["duplicate", "source", "terrain", "tiles"]);
    const again = readTerrainFile(writeTerrainFile(file));
    expect(again.dropped).toEqual([]);
    expect(again.file.tilesets.badlands.borders).toEqual(file.tilesets.badlands.borders);
    expect(sectionAgainstTable(file.tilesets.badlands, "badlands", { groups: 100, hasPicture: () => true })).toEqual([{ at: "tilesets.badlands.borders[0]", reason: "tiles" }]);
  });
});

/* ── The whole path on a made-up world ── */

describe("drawn borders on a made-up tileset", async () => {
  const w = borderWorld();
  const table = await borrowTable(w.host, w.source);
  const ctx = { host: w.host, source: w.source, sourceEra: 0, table };
  const classes = borderClasses(w.host, [ctx]);
  const srcGrass = flatTerrainsOf(w.source, 0).flatGroup.get(GRASS)!;
  const grassTile = table.choices.get(srcGrass << 4)![0];
  const learnPatch = union(drag(4, [[10, 20], [14, 20], [18, 20]]), drag(3, [[24, 30]]), drag(5, [[40, 16]]));
  const mapper = mapperMap(w, grassTile, learnPatch);
  const bytes = await writeMapBytes(mapper, { format: "scx" });

  it("lays the edge set the brush's shapes make", () => {
    // the brush laid the stand-in's own set on the mapper's map
    expect([...w.pieceOf.values()].some((t) => mapper.tiles.includes(t))).toBe(true);
    expect(edgeSetRecords()).toHaveLength(24);
  });

  const learned = await learnFromMaps([{ name: "mapper.scx", bytes: async () => bytes }], {
    groups: async (era) => (era === HOST_ERA ? w.host.groups : null),
    borders: async (era) => (era === HOST_ERA ? { classes, standIns: w.standIns } : null),
  });
  const evidence = learned.borders.get(HOST_ERA)!;
  const tables = cutBorderTables(evidence);
  const pair = tables.find((t) => t.key === pairKey(0, GRASS, DIRT))!;
  const setup: BorderSetup = { tables: new Map(tables.map((t) => [t.key, t])), standIns: w.standIns, classes, pools: new Map() };

  it("learns the pair's pieces from a map, keepable and mergeable", () => {
    expect(learned.read).toBe(1);
    expect(pair).toBeDefined();
    expect(pair.shapes.size).toBeGreaterThanOrEqual(10);
    // every shape's most laid tile is the mapper's piece for it
    let right = 0;
    for (const [shape, tiles] of pair.shapes) if (w.pieceOf.get(shape) === tiles[0][0]) right++;
    expect(right / pair.shapes.size).toBeGreaterThan(0.9);
    const kept = decodeBorderEvidence(encodeBorderEvidence(evidence))!;
    expect(cutBorderTables(kept)[0].shapes.size).toBe(pair.shapes.size);
    const twice = mergeBorderEvidence(mergeBorderEvidence(emptyBorderEvidence(), evidence), kept);
    expect(twice.pairs.get(pair.key)!.maps).toBe(2);
  });

  const strokePatch = union(drag(4, [[12, 22], [16, 22]]), drag(3, [[20, 26]]));
  const lay = (scn: Scenario, diamonds: Diamond[], borders: BorderSetup | null, members: { lattice: Uint8Array | null; record: Uint8Array | null }, take = false) => {
    const s = new BorrowStroke(scn, ctx, members.lattice, null, { record: members.record, borders });
    applyChanges(scn, take ? s.takeBack(diamonds) : s.paint(diamonds, GRASS, seeded(3))!);
    const r = s.finish();
    applyChanges(scn, r.changes);
    members.lattice = r.after;
    members.record = r.recordAfter;
    return r;
  };

  it("draws the border a stroke makes, where without it the two grounds touch", () => {
    const off = dirtMap(w), on = dirtMap(w), orig = on.tiles.slice();
    lay(off, strokePatch, null, { lattice: null, record: null });
    const r = lay(on, strokePatch, setup, { lattice: null, record: null });
    expect(r.borders).not.toBeNull();
    expect(r.borders!.drawn).toBeGreaterThan(20);
    expect(r.borders!.hard).toBeLessThanOrEqual(r.borders!.cells / 10);
    expect(r.borders!.unlike).toBe(0); // every tile of this world walks: no border tile walks unlike either side
    const scope = new Set<number>();
    for (let i = 0; i < orig.length; i++) if (on.tiles[i] !== orig[i] || off.tiles[i] !== orig[i]) for (const d of [0, -1, 1, -64, 64]) if (i + d >= 0 && i + d < orig.length) scope.add(i + d);
    expect(shownSeams(on, w.host, scope)).toBeLessThan(shownSeams(off, w.host, scope) / 4);
    // everything laid is the host's: Dirt, the copy of Grass, a piece
    for (let i = 0; i < orig.length; i++) if (on.tiles[i] !== orig[i]) expect(on.tiles[i] === grassTile || w.pieces.has(on.tiles[i]) || on.tiles[i] === w.dirtTile).toBe(true);
    // no source edge piece is left around the patch (the staircase the brush lays without borders)
    const edgeCopies = new Set<number>();
    for (let g = 0; g < w.source.groups.length; g++) if (w.source.groups[g].index === EDGE_SET) for (const id of table.choices.get(g << 4) ?? []) edgeCopies.add(id);
    expect(on.tiles.some((t) => edgeCopies.has(t))).toBe(false);
    expect(off.tiles.some((t) => edgeCopies.has(t))).toBe(true);
  });

  it("keeps the ground's own tile where it joins, and leaves pinned cells", () => {
    const scn = dirtMap(w);
    const pinned = new Uint8Array(64 * 48);
    pinned[22 * 64 + 26] = 1;
    const s = new BorrowStroke(scn, ctx, null, pinned, { borders: setup });
    applyChanges(scn, s.paint(strokePatch, GRASS, seeded(3))!);
    const r = s.finish();
    applyChanges(scn, r.changes);
    expect(r.borders!.kept).toBeGreaterThan(0);
    expect(scn.tiles[22 * 64 + 26]).toBe(w.dirtTile);
  });

  it("takes ground back to the tiles it had, border and all, across strokes", () => {
    const scn = dirtMap(w), orig = scn.tiles.slice();
    const m = { lattice: null as Uint8Array | null, record: null as Uint8Array | null };
    lay(scn, drag(4, [[10, 20], [14, 20]]), setup, m);
    const r2 = lay(scn, drag(4, [[16, 26], [18, 22]]), setup, m);
    expect(r2.reset).toBe(0);
    expect(decodeBorderRecord(m.record, scn, 0)!.cells.size).toBeGreaterThan(50);
    lay(scn, drag(4, [[16, 26]]), setup, m, true);
    const part = scn.tiles.filter((t, i) => t !== orig[i]).length;
    expect(part).toBeGreaterThan(0);
    lay(scn, union(drag(5, [[10, 20], [14, 20], [16, 26], [18, 22]])), setup, m, true);
    expect(scn.tiles.filter((t, i) => t !== orig[i]).length).toBe(0);
    expect(m.record).toBeNull();
    expect(m.lattice).toBeNull();
  });

  it("takes ground back without drawn borders too", () => {
    const scn = dirtMap(w), orig = scn.tiles.slice();
    const m = { lattice: null as Uint8Array | null, record: null as Uint8Array | null };
    lay(scn, strokePatch, null, m);
    lay(scn, union(drag(6, [[12, 22], [16, 22], [20, 26]])), null, m, true);
    expect(scn.tiles.filter((t, i) => t !== orig[i]).length).toBe(0);
  });

  it("is saved with the map and continued after it is opened again", async () => {
    const scn = dirtMap(w);
    const m = { lattice: null as Uint8Array | null, record: null as Uint8Array | null };
    lay(scn, strokePatch, setup, m);
    const extras = new Map<string, Uint8Array>([[borrowMember(0), m.lattice!], [bordersMember(0), m.record!]]);
    const opened = await openMapBytes(await writeMapBytes(scn, { format: "scx", extras }), "b.scx");
    expect(opened.extras.get(bordersMember(0))).toEqual(m.record);
    const again = { lattice: opened.extras.get(borrowMember(0))!, record: opened.extras.get(bordersMember(0))! };
    const r = lay(opened.scenario, drag(4, [[22, 22], [26, 22]]), setup, again);
    expect(r.reset).toBe(0);
    expect(r.borders!.drawn).toBeGreaterThan(10);
    // an editor that knows only the lattice carries the record along: the record still reads after a stroke without it
    expect(decodeBorderRecord(again.record, opened.scenario, 0)!.cells.size).toBeGreaterThan(0);
  });

  it("never takes its own work for another tool's, and gives everything back, over many strokes of every kind", () => {
    const scn = dirtMap(w), orig = scn.tiles.slice();
    const m = { lattice: null as Uint8Array | null, record: null as Uint8Array | null };
    const random = seeded(42);
    for (let n = 0; n < 60; n++) {
      const kind = Math.floor(random() * 4); // 0 Grass with borders, 1 Grass without, 2 the base ground, 3 take back
      const x = 4 + Math.floor(random() * 22), y = 4 + Math.floor(random() * 36);
      const ds = drag(1 + Math.floor(random() * 4), [[x - (x + y) % 2, y], [x - (x + y) % 2 + 2 * Math.floor(random() * 3), y]]);
      const s = new BorrowStroke(scn, ctx, m.lattice, null, { record: m.record, borders: kind === 1 ? null : setup });
      expect(s.reset).toBe(0);
      const ch = kind === 3 ? s.takeBack(ds) : s.paint(ds, kind === 2 ? DIRT : GRASS, seeded(n));
      if (ch) applyChanges(scn, ch);
      const r = s.finish();
      applyChanges(scn, r.changes);
      m.lattice = r.after; m.record = r.recordAfter;
      // after a stroke with drawn borders, nothing it settled is left outside the patch and its border
      if (kind !== 1 && r.box) expect(new BorrowStroke(scn, ctx, m.lattice, null, { record: m.record, borders: setup }).strays(r.box)).toEqual([]);
      expect(latticeEdgesBroken(scn, ctx, m.lattice, m.record)).toEqual([]);
    }
    const all: Diamond[] = [];
    for (let y = 0; y <= 48; y++) for (let x = y & 1; x <= 32; x += 2) all.push({ x, y });
    lay(scn, all, setup, m, true);
    expect(scn.tiles.filter((t, i) => t !== orig[i]).length).toBe(0);
    expect(m.record).toBeNull();
  });

  it("leaves the source's own edge where two borrowed terrains meet, in one session and after the map is saved", async () => {
    const scn = dirtMap(w);
    const m = { lattice: null as Uint8Array | null, record: null as Uint8Array | null };
    const paintWith = (target: Scenario, diamonds: Diamond[], terrain: number) => {
      const s = new BorrowStroke(target, ctx, m.lattice, null, { record: m.record, borders: setup });
      applyChanges(target, s.paint(diamonds, terrain, seeded(7))!);
      const r = s.finish();
      applyChanges(target, r.changes);
      m.lattice = r.after; m.record = r.recordAfter;
    };
    paintWith(scn, drag(5, [[10, 20], [14, 20]]), DIRT); // the source's base ground
    paintWith(scn, drag(3, [[12, 16], [12, 20], [12, 24]]), GRASS); // across it, out onto the tileset's ground
    expect(latticeEdgesBroken(scn, ctx, m.lattice, m.record)).toEqual([]);
    const extras = new Map<string, Uint8Array>([[borrowMember(0), m.lattice!], [bordersMember(0), m.record!]]);
    const opened = await openMapBytes(await writeMapBytes(scn, { format: "scx", extras }), "b.scx");
    m.lattice = opened.extras.get(borrowMember(0))!; m.record = opened.extras.get(bordersMember(0))!;
    paintWith(opened.scenario, drag(3, [[16, 18], [16, 22]]), GRASS);
    expect(latticeEdgesBroken(opened.scenario, ctx, m.lattice, m.record)).toEqual([]);
  });

  it("paints the base ground as borrowed ground too", () => {
    const scn = dirtMap(w);
    // Dirt is the source's base ground: the lattice cannot hold it, the record does
    const s = new BorrowStroke(scn, ctx, null, null, { borders: setup });
    applyChanges(scn, s.paint(drag(3, [[14, 20]]), DIRT, seeded(1))!);
    const r = s.finish();
    applyChanges(scn, r.changes);
    expect(r.after).toBeNull();
    expect(decodeBorderRecord(r.recordAfter, scn, 0)!.painted.size).toBeGreaterThan(0);
  });
});

/* ── Gated: the game's own files ── */

const TILES = "public/tileset";
const haveGame = existsSync(`${TILES}/badlands.cv5`) && existsSync(`${TILES}/install.cv5`);
const game = (name: string): Tileset => {
  const r = (e: string) => new Uint8Array(readFileSync(`${TILES}/${name}.${e}`));
  return loadTileset({ cv5: r("cv5"), vf4: r("vf4"), vr4: r("vr4"), wpe: r("wpe"), vx4: r("vx4") });
};
function walk(d: string, out: string[] = []): string[] {
  if (!existsSync(d)) return out;
  for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.sc[xm]$/i.test(f)) out.push(p); }
  return out;
}

describe.skipIf(!haveGame)("the game's own files", () => {
  it("the made-up edge set is the game's Grass/Dirt set", () => {
    const bad = game("badlands");
    const real = bad.groups.map((g, i) => ({ g, i })).filter(({ g, i }) => g.index === EDGE_SET && i % 2 === 0)
      .map(({ g }) => ({ edges: [g.edges.left, g.edges.top, g.edges.right, g.edges.bottom], stack: [g.stack.top, g.stack.bottom] }));
    expect(real).toEqual(edgeSetRecords());
  });

  it("learns nothing from the game's own maps, and a stroke is what it was", async () => {
    const host = game("badlands"), sources = [["install", 2], ["jungle", 4]] as const;
    const ctxs = await Promise.all(sources.map(async ([n, e]) => { const s = game(n); return { host, source: s, sourceEra: e, table: await borrowTable(host, s) }; }));
    const classes = borderClasses(host, ctxs);
    const sis = badlandsStandIns(host);
    const ev = emptyBorderEvidence();
    let read = 0;
    for (const p of walk("fixtures/maps").slice(0, 40)) {
      try {
        const { scenario } = await openMapBytes(new Uint8Array(readFileSync(p)), p);
        if ((scenario.era & 7) !== 0) continue;
        gatherBorderEvidence(ev, scenario.tiles, scenario.width, scenario.height, classes, sis);
        read++;
      } catch { /* not a map we read */ }
    }
    expect(cutBorderTables(ev)).toEqual([]);
    void read;
  }, 120_000);
});

/* ── Gated: a mod's tileset and maps (SCMJS_COSMONARCHY, SCMJS_COSMONARCHY_MAPS) ── */

const MOD = process.env.SCMJS_COSMONARCHY, MAPS = process.env.SCMJS_COSMONARCHY_MAPS;
function modTileset(name: string): Tileset | null {
  const dir = MOD ? join(MOD, "mpq", "tileset") : "";
  if (!dir || !existsSync(dir)) return null;
  const files = readdirSync(dir);
  const f = (ext: string) => { const hit = files.find((x) => x.toLowerCase() === `${name}.${ext}`); return hit ? new Uint8Array(readFileSync(join(dir, hit))) : null; };
  const [cv5, vf4, vr4, wpe, vx4] = [f("cv5"), f("vf4"), f("vr4"), f("wpe"), f("vx4ex")];
  return cv5 && vf4 && vr4 && wpe && vx4 ? loadTileset({ cv5, vf4, vr4, wpe, vx4, vx4Extended: true }) : null;
}

describe.skipIf(!haveGame || !MAPS || !existsSync(MAPS ?? "") || !modTileset("badlands"))("drawn borders in a mod's Badlands (the spike's numbers)", () => {
  /** The mod's Badlands, every game tileset's table into it, and what its Badlands maps teach: built once. */
  const learned = (() => {
    let made: Promise<{ host: Tileset; ctxs: BorrowContext[]; classes: ReturnType<typeof borderClasses>; sis: StandIns; ev: BorderEvidence }> | null = null;
    return () => (made ??= (async () => {
      const host = modTileset("badlands")!;
      const sources: [string, number][] = [["install", 2], ["platform", 1], ["ashworld", 3], ["jungle", 4], ["desert", 5], ["ice", 6], ["twilight", 7]];
      const ctxs = await Promise.all(sources.map(async ([n, e]) => { const s = game(n); return { host, source: s, sourceEra: e, table: await borrowTable(host, s) }; }));
      const classes = borderClasses(host, ctxs);
      const sis = badlandsStandIns(game("badlands"));
      const ev = emptyBorderEvidence();
      for (const p of walk(MAPS!)) {
        try {
          const { scenario } = await openMapBytes(new Uint8Array(readFileSync(p)), p);
          if ((scenario.era & 7) === 0 && scenario.tiles.every((t) => (t >> 4) < host.groups.length)) gatherBorderEvidence(ev, scenario.tiles, scenario.width, scenario.height, classes, sis);
        } catch { /* skipped */ }
      }
      return { host, ctxs, classes, sis, ev };
    })());
  })();

  it("learns the pairs, draws the three brush patches within the spike's joins, keeps rubble off plain ground, takes back clean", async () => {
    const { host, ctxs, classes, sis, ev } = await learned();
    const install = ctxs[0];
    const tables = cutBorderTables(ev).filter((t) => t.sourceEra === 2);
    const SUB = 2, FLOOR = 3, DIRT_B = 2;
    const sub = tables.find((t) => t.x === SUB && t.y === DIRT_B)!, floor = tables.find((t) => t.x === FLOOR && t.y === DIRT_B)!;
    // the spike: 29 of 48 shapes (Substructure / Dirt), 43 of 72 (Floor / Dirt)
    expect(sub.shapes.size).toBeGreaterThanOrEqual(25);
    expect(floor.shapes.size).toBeGreaterThanOrEqual(30);
    const setup: BorderSetup = { tables: new Map(tables.map((t) => [t.key, t])), standIns: sis, classes, pools: new Map() };
    const W = 64, H = 48;
    const fill = flatTerrainsOf(host, 0).flatGroup.get(DIRT_B)!;
    const { createScenario } = await import("../src/formats/chk/create");
    const { flatTerrain } = await import("../src/formats/tileset/terrain");
    const mapOf = () => createScenario({ width: W, height: H, era: 0, name: "m", tiles: flatTerrain(W, H, { id: DIRT_B, group: fill }, host, seeded(1), 0).tiles }) as Scenario;
    const minus = (a: Diamond[], b: Diamond[]) => a.filter((d) => !b.some((e) => e.x === d.x && e.y === d.y));
    const patches: [string, Diamond[]][] = [
      ["drag", drag(4, [[10, 20], [12, 20], [14, 20], [16, 20], [18, 20]])],
      ["notch-and-bar", union(minus(drag(7, [[14, 22]]), drag(3, [[17, 19]])), Array.from({ length: 6 }, (_, k) => ({ x: 19 + k, y: 25 + k })))],
      ["two strokes", union(drag(4, [[8, 16], [10, 18], [12, 20]]), drag(4, [[12, 28], [14, 26], [16, 24], [18, 22]]))],
    ];
    // joins showing per 100 border cells in the spike, per pair and patch
    const spike: Record<number, number[]> = { [SUB]: [7.4, 5.4, 7.1], [FLOOR]: [7.0, 7.9, 0.9] };
    for (const x of [SUB, FLOOR]) {
      patches.forEach(([, diamonds], k) => {
        const scn = mapOf(), orig = scn.tiles.slice();
        const s = new BorrowStroke(scn, install, null, null, { borders: setup });
        applyChanges(scn, s.paint(diamonds, x, seeded(5))!);
        const r = s.finish();
        applyChanges(scn, r.changes);
        const scope = new Set<number>();
        for (let i = 0; i < W * H; i++) if (scn.tiles[i] !== orig[i]) for (const d of [0, -1, 1, -W, W]) if (i + d >= 0 && i + d < W * H) scope.add(i + d);
        const per100 = (100 * shownSeams(scn, host, scope)) / r.borders!.cells;
        expect(per100).toBeLessThanOrEqual(spike[x][k] + 0.5);
        expect(r.borders!.kept).toBeGreaterThan(0); // the plain ground keeps its own tile where it joins: no rubble on it
      });
    }
    // a crossing stroke, then all of it taken back
    const scn = mapOf(), orig = scn.tiles.slice();
    let lattice: Uint8Array | null = null, record: Uint8Array | null = null;
    const run = (diamonds: Diamond[], take: boolean) => {
      const s = new BorrowStroke(scn, install, lattice, null, { record, borders: setup });
      applyChanges(scn, take ? s.takeBack(diamonds) : s.paint(diamonds, SUB, seeded(2))!);
      const r = s.finish();
      applyChanges(scn, r.changes);
      lattice = r.after; record = r.recordAfter;
      return r;
    };
    run(drag(4, [[8, 16], [10, 18], [12, 20]]), false);
    expect(run(drag(4, [[10, 26], [12, 24], [14, 22], [16, 20]]), false).reset).toBe(0);
    run(drag(6, [[8, 16], [10, 18], [12, 20], [10, 26], [12, 24], [14, 22], [16, 20]]), true);
    expect(scn.tiles.filter((t, i) => t !== orig[i]).length).toBe(0);
    expect(record).toBeNull();
  }, 600_000);

  it("the browser session's strokes, one by one as the pointer lays them, leave nothing behind outside the patch", async () => {
    const { host, ctxs, classes, sis, ev } = await learned();
    const install = ctxs[0];
    const tables = cutBorderTables(ev).filter((t) => t.sourceEra === 2);
    const setup: BorderSetup = { tables: new Map(tables.map((t) => [t.key, t])), standIns: sis, classes, pools: new Map() };
    const { createScenario } = await import("../src/formats/chk/create");
    const { flatTerrain } = await import("../src/formats/tileset/terrain");
    const flats = flatTerrainsOf(host, 0).flatGroup;
    const W = 96, H = 64;
    const random = seeded(1);
    const dirt = flatTerrain(W, H, { id: 2, group: flats.get(2)! }, host, random, 0), asphalt = flatTerrain(W, H, { id: 14, group: flats.get(14)! }, host, random, 0);
    const tiles = dirt.tiles.slice();
    for (let y = 0; y < H; y++) for (let x = 64; x < W; x++) tiles[y * W + x] = asphalt.tiles[y * W + x];
    let scn = createScenario({ width: W, height: H, era: 0, name: "Dirt and Asphalt", tiles }) as Scenario;
    const m = { lattice: null as Uint8Array | null, record: null as Uint8Array | null };
    const SUB = 2, FLOOR = 3, TAKE = -1;
    /** A drag of brush 4 through tile points, a brush application per new diamond under the pointer (as the hook does), the pointer moving in six steps between points. */
    const stroke = (terrain: number, points: [number, number][], borders: boolean) => {
      const s = new BorrowStroke(scn, install, m.lattice, null, { record: m.record, borders: borders ? setup : null });
      expect(s.reset).toBe(0);
      let last: Diamond | null = null;
      const at = (px: number, py: number) => {
        const d = diamondAt(px, py);
        if ((last && last.x === d.x && last.y === d.y) || !isDiamond(d)) return;
        last = d;
        const ds = brushDiamonds(scn, d, 4);
        const ch = terrain === TAKE ? s.takeBack(ds) : s.paint(ds, terrain, seeded(d.x * 97 + d.y));
        if (ch) applyChanges(scn, ch);
      };
      // the browser session's points were screen positions: map pixels are 100 left and 50 up of the tile grid it named
      const px0 = (tx: number) => tx * 32 - 100, py0 = (ty: number) => ty * 32 - 50;
      let [px, py] = [px0(points[0][0]), py0(points[0][1])];
      at(px, py);
      for (const [tx, ty] of points.slice(1)) {
        const [qx, qy] = [px0(tx), py0(ty)];
        for (let k = 1; k <= 6; k++) at(px + ((qx - px) * k) / 6, py + ((qy - py) * k) / 6);
        [px, py] = [qx, qy];
      }
      const r = s.finish();
      applyChanges(scn, r.changes);
      m.lattice = r.after; m.record = r.recordAfter;
      return r;
    };
    // After a stroke with drawn borders, nothing in what it settled is left outside the patch and its border.
    const strays = (r: { box: { x0: number; y0: number; x1: number; y1: number } | null }) =>
      new BorrowStroke(scn, install, m.lattice, null, { record: m.record, borders: setup }).strays(r.box ?? undefined).map((at) => `${at % W},${Math.floor(at / W)}`);
    expect(strays(stroke(SUB, [[6, 5], [8, 6], [10, 7]], true))).toEqual([]);
    stroke(SUB, [[20, 5], [22, 6], [24, 7]], false);
    expect(strays(stroke(FLOOR, [[6, 16], [8, 17], [10, 18]], true))).toEqual([]);

    expect(strays(stroke(SUB, [[11, 10], [12, 8], [13, 6]], true))).toEqual([]);
    expect(strays(stroke(TAKE, [[8, 6], [9, 6]], true))).toEqual([]);
    // saved and opened again, then the two strokes after it
    const extras = new Map<string, Uint8Array>([[borrowMember(2), m.lattice!], [bordersMember(2), m.record!]]);
    const opened = await openMapBytes(await writeMapBytes(scn, { format: "scx", extras }), "b.scx");
    scn = opened.scenario;
    m.lattice = opened.extras.get(borrowMember(2))!; m.record = opened.extras.get(bordersMember(2))!;
    expect(strays(stroke(SUB, [[20, 16], [22, 17], [24, 18]], true))).toEqual([]);
    expect(strays(stroke(SUB, [[15, 17], [17, 17], [19, 17]], true))).toEqual([]);
    // where Floor and Substructure meet (the stroke that joined them after the map was opened again), the lattice's edge
    expect(latticeEdgesBroken(scn, install, m.lattice, m.record)).toEqual([]);
  }, 600_000);

  it("many strokes of every kind: no false resets, nothing left outside the patch, the lattice's edges kept, all given back", async () => {
    const { host, ctxs, classes, sis, ev } = await learned();
    const install = ctxs[0];
    const tables = cutBorderTables(ev).filter((t) => t.sourceEra === 2);
    const setup: BorderSetup = { tables: new Map(tables.map((t) => [t.key, t])), standIns: sis, classes, pools: new Map() };
    const { createScenario } = await import("../src/formats/chk/create");
    const { flatTerrain } = await import("../src/formats/tileset/terrain");
    const W = 96, H = 64;
    const scn = createScenario({ width: W, height: H, era: 0, name: "m", tiles: flatTerrain(W, H, { id: 2, group: flatTerrainsOf(host, 0).flatGroup.get(2)! }, host, seeded(1), 0).tiles }) as Scenario;
    const orig = scn.tiles.slice();
    const m = { lattice: null as Uint8Array | null, record: null as Uint8Array | null };
    const random = seeded(99);
    for (let n = 0; n < 80; n++) {
      const kind = Math.floor(random() * 5); // 0 Substructure, 1 Substructure without borders, 2 Floor, 3 take back, 4 Floor without borders
      const x = 6 + Math.floor(random() * 30), y = 6 + Math.floor(random() * 40);
      const ds = drag(1 + Math.floor(random() * 4), [[x - (x + y) % 2, y], [x - (x + y) % 2 + 2 * Math.floor(random() * 3), y]], W, H);
      const borders = kind !== 1 && kind !== 4;
      const s = new BorrowStroke(scn, install, m.lattice, null, { record: m.record, borders: borders ? setup : null });
      expect(s.reset).toBe(0);
      const ch = kind === 3 ? s.takeBack(ds) : s.paint(ds, kind === 2 || kind === 4 ? 3 : 2, seeded(n));
      if (ch) applyChanges(scn, ch);
      const r = s.finish();
      applyChanges(scn, r.changes);
      m.lattice = r.after; m.record = r.recordAfter;
      if (borders && r.box) {
        expect(new BorrowStroke(scn, install, m.lattice, null, { record: m.record, borders: setup }).strays(r.box)).toEqual([]);
      }
      expect(latticeEdgesBroken(scn, install, m.lattice, m.record)).toEqual([]);
    }
    const all: Diamond[] = [];
    for (let y = 0; y <= H; y++) for (let x = y & 1; x <= W / 2; x += 2) all.push({ x, y });
    const s = new BorrowStroke(scn, install, m.lattice, null, { record: m.record, borders: setup });
    applyChanges(scn, s.takeBack(all));
    const r = s.finish();
    applyChanges(scn, r.changes);
    expect(scn.tiles.filter((t, i) => t !== orig[i]).length).toBe(0);
    expect(r.recordAfter).toBeNull();
  }, 900_000);
});
