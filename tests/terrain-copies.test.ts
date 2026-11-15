/**
 * Copied terrain: the rule and the gate (`editor/terrainCopyTable.ts`), the brush, its member and the re-lay
 * (`editor/terrainCopyLattice.ts`), on a tileset made by code (`support/copyWorld.ts`) so CI runs it all; then the
 * game's tilesets where they are here, and a mod's where `SCMJS_COSMONARCHY` names one.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { terrainCopies } from "../src/formats/tileset/palette";
import { loadTileset, megatileForTile, type Tileset } from "../src/formats/tileset/decode";
import { decodeCopyBlocks, encodeCopyBlocks, findCopyBlocks, pictureKeyOf, type CopyBlock } from "../src/editor/terrainCopyTable";
import {
  chooseOuter, copyTable, CopyStroke, COPY_MEMBER, decodeCopyMember, encodeCopyMember, groundsOf, groundUnder, paintCount, rankGrounds, relayCopies, resizeCopyMember,
  type CopyGround, type CopyTable,
} from "../src/editor/terrainCopyLattice";
import { diamondsOfRect, diamondValue, isomHeight, isomWidth, paintIsomDiamonds, type Diamond } from "../src/editor/isom";
import { isomValueOf } from "../src/data/isomTables";
import { applyChanges } from "../src/editor/terrain";
import { SEAM_SHOWS, seamStep } from "../src/editor/blend";
import { openMapBytes, writeMapBytes } from "../src/editor/mapFile";
import { copyWorld, DIRT, EDGE_SET, GRASS, groundScenario, HIGH_DIRT, type CopyWorld } from "./support/copyWorld";

const find = (w: CopyWorld) => findCopyBlocks(w.ts, 0, [...terrainCopies(w.ts).values()]);
const ground = (w: CopyWorld, id: number): CopyGround => ({ id: `t${id}`, kind: "typed", index: id, group: id === HIGH_DIRT ? w.highDirtGroup : w.dirtGroup });
const blob = (cx: number, cy: number, n: number): Diamond[] => { const out: Diamond[] = []; for (let u = 0; u < n; u++) for (let v = 0; v < n; v++) out.push({ x: cx + u + v, y: cy + u - v }); return out; };

/** Joins over SEAM_SHOWS among the cells given and their neighbours. */
function showing(ts: Tileset, scn: { width: number; height: number; tiles: Uint16Array }, cells: Iterable<number>): number {
  let n = 0;
  const W = scn.width, H = scn.height, seen = new Set<string>();
  for (const at of cells) {
    const x = at % W, y = Math.floor(at / W);
    for (const [dx, dy, side] of [[1, 0, "right"], [-1, 0, "left"], [0, 1, "bottom"], [0, -1, "top"]] as const) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const b = ny * W + nx, k = at < b ? `${at}|${b}` : `${b}|${at}`; if (seen.has(k)) continue; seen.add(k);
      if (seamStep(ts, megatileForTile(ts, scn.tiles[at]), side, megatileForTile(ts, scn.tiles[b])) > SEAM_SHOWS) n++;
    }
  }
  return n;
}

describe("copied terrain: the rule (a made-up tileset)", () => {
  for (const layout of ["two-groups", "interleaved", "shuffled"] as const) {
    it(`finds the block in the ${layout} layout, every piece on its planted tile, complete`, async () => {
      const w = copyWorld({ layout });
      const blocks = await find(w);
      expect(blocks).toHaveLength(1);
      const b = blocks[0];
      expect(b).toMatchObject({ source: GRASS, set: EDGE_SET, other: DIRT, height: 1, raise: 1, flat: w.copy, status: "complete" });
      expect(b.missing).toEqual([]);
      const got = new Map(b.pieces);
      let right = 0;
      for (const [piece, tile] of w.planted) if (got.get(piece) === tile || pictureKeyOf(w.ts, megatileForTile(w.ts, got.get(piece) ?? 0)) === pictureKeyOf(w.ts, megatileForTile(w.ts, tile))) right++;
      expect(right).toBe(w.planted.size);
      expect(decodeCopyBlocks(encodeCopyBlocks(blocks))).toEqual(blocks);
    });
  }

  it("finds nothing where nothing is a copy", async () => {
    expect(await find(copyWorld({ noCopy: true }))).toEqual([]);
  });

  it("says incomplete when shapes are missing, and names them", async () => {
    const w = copyWorld({ layout: "interleaved", drop: [6, 7, 20] });
    const [b] = await find(w);
    expect(b.status).toBe("incomplete");
    expect(b.missing.sort((x, y) => x - y)).toEqual([w.halves[6], w.halves[7], w.halves[20]].sort((x, y) => x - y));
  });

  it("refuses a block whose pieces do not walk as their source pieces", async () => {
    const [b] = await find(copyWorld({ layout: "two-groups", unwalkable: 1 }));
    expect(b.status).toBe("rejected");
    expect(b.flags).toBeLessThan(0.99);
  });

  it("keeps the same key when the block's groups move", async () => {
    const a = (await find(copyWorld({ layout: "two-groups" })))[0];
    const b = (await find(copyWorld({ layout: "interleaved" })))[0];
    expect(a.key).toBe(b.key);
  });
});

describe("copied terrain: the outer ground", () => {
  it("is High Dirt by the seam step and by paint and count, ahead of Dirt", async () => {
    const w = copyWorld();
    const [b] = await find(w);
    const ranked = rankGrounds(w.ts, 0, b);
    expect(ranked[0].id).toBe(`t${HIGH_DIRT}`);
    for (const g of ranked) g.count = paintCount(copyTable(w.ts, 0, b, g));
    const outer = chooseOuter(ranked)!;
    expect(outer.id).toBe(`t${HIGH_DIRT}`);
    const dirt = ranked.find((g) => g.id === `t${DIRT}`);
    if (dirt) expect(dirt.count!).toBeGreaterThan(outer.count!);
  });

  it("names the ground under a stroke", () => {
    const w = copyWorld();
    const scn = groundScenario(w, HIGH_DIRT);
    expect(groundUnder(scn, w.ts, 0, [{ x: 10, y: 20 }])).toBe(`t${HIGH_DIRT}`);
    expect(groundsOf(w.ts, 0).has(`t${GRASS}`)).toBe(true);
  });
});

describe("copied terrain: the brush", () => {
  const ready = async (opts: Parameters<typeof copyWorld>[0] = {}, outer = HIGH_DIRT): Promise<{ w: CopyWorld; b: CopyBlock; t: CopyTable }> => {
    const w = copyWorld(opts);
    const [b] = await find(w);
    return { w, b, t: copyTable(w.ts, 0, b, ground(w, outer)) };
  };

  it("lays a patch on its outer ground: the copy inside, the block's pieces round it, nothing black, no more joins than the game's own set", async () => {
    const { w, t } = await ready();
    // The game's own set, Grass on Dirt, the same diamonds: what this made-up art shows at its best.
    const own = groundScenario(w, DIRT);
    const ownEdit = paintIsomDiamonds(own, w.ts, blob(10, 22, 3), GRASS, () => 0)!;
    const ownShowing = showing(w.ts, own, ownEdit.tiles.map((c) => c.at));
    const scn = groundScenario(w, HIGH_DIRT);
    const stroke = new CopyStroke(scn, t, null);
    const p = stroke.paint(blob(10, 22, 3));
    expect(p.isom).toEqual([]); // on its own ground the lattice already says High Dirt
    applyChanges(scn, p.changes);
    const r = stroke.finish();
    expect(r.missing).toBe(0);
    const blockTiles = new Set(t.block.pieces.map(([, tile]) => tile));
    const copyTiles = new Set([...t.sTiles[0], ...t.sTiles[1]]);
    let pieces = 0, inside = 0;
    for (const c of p.changes) { expect(c.after >> 4).not.toBe(0); if (blockTiles.has(c.after)) pieces++; else if (copyTiles.has(c.after)) inside++; }
    expect(pieces).toBeGreaterThan(10);
    expect(inside).toBeGreaterThan(4);
    expect(showing(w.ts, scn, p.changes.map((c) => c.at))).toBeLessThanOrEqual(ownShowing + 2);
    expect(r.after).not.toBeNull();
    expect(decodeCopyMember(r.after, scn, 0)[0].diamonds.size).toBe(9);
  });

  it("lays only where an untyped outer ground already is, and says how many diamonds it left", async () => {
    const { w, b } = await ready();
    const pair: CopyGround = { id: `p${w.copy}`, kind: "pair", index: 0, group: w.copy }; // any untyped pair stands in
    const scn = groundScenario(w, HIGH_DIRT);
    const stroke = new CopyStroke(scn, copyTable(w.ts, 0, b, pair), null);
    stroke.paint(blob(10, 22, 2));
    expect(stroke.finish().refused).toBe(4);
  });

  it("respects pins", async () => {
    const { w, t } = await ready();
    const scn = groundScenario(w, HIGH_DIRT);
    const pinned = new Uint8Array(scn.width * scn.height).fill(1);
    const stroke = new CopyStroke(scn, t, null, pinned);
    expect(stroke.paint(blob(10, 22, 2)).changes).toEqual([]);
    expect(stroke.finish().kept.length).toBeGreaterThan(0);
  });

  it("an incomplete block lays its missing shapes from its own tiles and counts them", async () => {
    const { w, t } = await ready({ layout: "interleaved", drop: [0, 1, 2, 3, 4, 5] });
    expect(t.block.status).toBe("incomplete");
    const scn = groundScenario(w, HIGH_DIRT);
    const stroke = new CopyStroke(scn, t, null);
    applyChanges(scn, stroke.paint(blob(10, 22, 3)).changes);
    expect(stroke.finish().missing).toBeGreaterThan(0);
  });
});

describe("copied terrain: the member", () => {
  it("round-trips, resizes by whole rects and drops an odd shift", () => {
    const size = { width: 48, height: 40 };
    // diamonds are numbered y * (isomWidth + 1) + x: 26 a row for 48 tiles wide, 28 for 52
    const member = encodeCopyMember(size, 0, [{ source: GRASS, height: 1, key: "abc12", ground: "t3", diamonds: new Set([26 * 3 + 4, 26 * 10 + 6]) }]);
    expect(decodeCopyMember(member, size, 0)).toEqual([{ source: GRASS, height: 1, key: "abc12", ground: "t3", diamonds: new Set([82, 266]) }]);
    expect(decodeCopyMember(member, { width: 64, height: 40 }, 0)).toEqual([]);
    expect(decodeCopyMember(member, size, 1)).toEqual([]);
    const moved = resizeCopyMember(member, size, { width: 52, height: 44 }, 0, 4, 2);
    const p = decodeCopyMember(moved, { width: 52, height: 44 }, 0)[0];
    expect([...p.diamonds].sort((a, b) => a - b)).toEqual([28 * 5 + 6, 28 * 12 + 8]);
    expect(resizeCopyMember(member, size, { width: 50, height: 40 }, 0, 1, 0)).toBeNull();
    expect(encodeCopyMember(size, 0, [])).toBeNull();
  });

  it("is saved in the map's archive and read back", async () => {
    const w = copyWorld();
    const [b] = await find(w);
    const scn = groundScenario(w, HIGH_DIRT);
    const stroke = new CopyStroke(scn, copyTable(w.ts, 0, b, ground(w, HIGH_DIRT)), null);
    applyChanges(scn, stroke.paint(blob(10, 22, 2)).changes);
    const member = stroke.finish().after!;
    const bytes = await writeMapBytes(scn, { format: "scx", extras: new Map([[COPY_MEMBER, member]]) });
    const back = await openMapBytes(bytes, "c.scx");
    expect(back.extras.get(COPY_MEMBER)).toEqual(member);
    expect(back.scenario.tiles).toEqual(scn.tiles);
  });

  it("a second stroke continues the patch, and undoing it in reverse gives the map back byte for byte", async () => {
    const w = copyWorld();
    const [b] = await find(w);
    const t = copyTable(w.ts, 0, b, ground(w, HIGH_DIRT));
    const scn = groundScenario(w, HIGH_DIRT);
    const s1 = new CopyStroke(scn, t, null);
    const c1 = s1.paint(blob(10, 22, 2)).changes;
    applyChanges(scn, c1);
    const m1 = s1.finish().after;
    const before = scn.tiles.slice();
    const s2 = new CopyStroke(scn, t, m1);
    const p2 = s2.paint(blob(12, 22, 2));
    applyChanges(scn, p2.changes);
    expect(decodeCopyMember(s2.finish().after, scn, 0)[0].diamonds.size).toBeGreaterThan(4);
    // (what the game's brush laid of the outer ground was applied as it went: undone after the translated cells)
    applyChanges(scn, p2.changes, "undo");
    applyChanges(scn, p2.applied, "undo");
    expect(scn.tiles).toEqual(before);
  });
});

describe("copied terrain: laid again after the game's brush", () => {
  it("keeps what the lattice still holds as its ground, gives up the rest, and leaves no hard cut", async () => {
    // Re-flagged only: the outer ground is Dirt itself, so the game's brush can paint Grass beside the patch.
    const w = copyWorld({ repaint: "none" });
    const [b] = await find(w);
    const t = copyTable(w.ts, 0, b, ground(w, DIRT));
    const scn = groundScenario(w, DIRT);
    const s = new CopyStroke(scn, t, null);
    const p = s.paint(blob(10, 22, 4));
    applyChanges(scn, p.changes);
    const member = s.finish().after;
    // The game's brush lays Grass two diamonds east, cutting into the patch's edge.
    const cut = paintIsomDiamonds(scn, w.ts, [{ x: 16, y: 22 }, { x: 17, y: 23 }], GRASS, () => 0)!;
    expect(cut.tiles.length).toBeGreaterThan(0);
    const r = relayCopies(scn, member, 0, () => t);
    expect(r.dropped).toBeGreaterThan(0);
    applyChanges(scn, r.changes);
    // No cell keeps a tile of the patch where the lattice under it is no longer the outer ground, and nothing is black.
    const own = new Set(t.pool.filter((x) => !t.gTiles[0].includes(x) && !t.gTiles[1].includes(x)));
    const dirt = isomValueOf(0, DIRT), iw = isomWidth(scn), ih = isomHeight(scn);
    let patchCells = 0;
    for (let at = 0; at < scn.tiles.length; at++) {
      expect(scn.tiles[at] >> 4).not.toBe(0);
      if (!own.has(scn.tiles[at])) continue;
      patchCells++;
      for (const d of diamondsOfRect(Math.floor((at % scn.width) / 2), Math.floor(at / scn.width))) {
        const v = diamondValue(scn.isom, iw, ih, d);
        if (v >= 0) expect(v).toBe(dirt);
      }
    }
    expect(patchCells).toBeGreaterThan(20);
    expect(r.hard).toBeLessThanOrEqual(4);
  });

  it("leaves a tile laid by hand over the patch where it is", async () => {
    const w = copyWorld({ repaint: "none" });
    const [b] = await find(w);
    const t = copyTable(w.ts, 0, b, ground(w, DIRT));
    const scn = groundScenario(w, DIRT);
    const s = new CopyStroke(scn, t, null);
    applyChanges(scn, s.paint(blob(10, 22, 4)).changes);
    const member = s.finish().after;
    // A tile that is neither the patch's nor its ground's, laid by hand on cells in the middle of the patch.
    const patch = new Set(t.pool.filter((x) => !t.gTiles[0].includes(x) && !t.gTiles[1].includes(x)));
    const foreign = w.highDirtGroup << 4;
    expect(t.pool).not.toContain(foreign);
    const hand: number[] = [];
    for (let at = 0; at < scn.tiles.length && hand.length < 3; at++) {
      if (!patch.has(scn.tiles[at]) || Math.floor(at / scn.width) !== 22) continue;
      scn.tiles[at] = foreign;
      hand.push(at);
    }
    expect(hand).toHaveLength(3);
    paintIsomDiamonds(scn, w.ts, [{ x: 16, y: 22 }, { x: 17, y: 23 }], GRASS, () => 0);
    const r = relayCopies(scn, member, 0, () => t);
    applyChanges(scn, r.changes);
    expect(r.dropped).toBeGreaterThan(0);
    for (const at of hand) expect(scn.tiles[at]).toBe(foreign);
  });

  it("leaves a patch the stroke did not reach as it was", async () => {
    const w = copyWorld({ repaint: "none" });
    const [b] = await find(w);
    const t = copyTable(w.ts, 0, b, ground(w, DIRT));
    const scn = groundScenario(w, DIRT, 64, 48);
    const s = new CopyStroke(scn, t, null);
    applyChanges(scn, s.paint(blob(6, 22, 2)).changes);
    const member = s.finish().after;
    paintIsomDiamonds(scn, w.ts, [{ x: 26, y: 22 }], GRASS, () => 0);
    const r = relayCopies(scn, member, 0, () => t);
    expect(r.changes).toEqual([]);
    expect(r.dropped).toBe(0);
  });
});

/* ── The game's own tilesets, where they are here ─────────────────────── */

const GAME = "public/tileset";
const NAMES = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"];
const haveGame = existsSync(`${GAME}/badlands.cv5`);
function loadDir(dir: string, name: string): Tileset {
  const files = readdirSync(dir);
  const f = (ext: string) => { const hit = files.find((x) => x.toLowerCase() === `${name}.${ext}`); return hit ? new Uint8Array(readFileSync(join(dir, hit))) : null; };
  const vx4ex = f("vx4ex");
  return loadTileset({ cv5: f("cv5")!, vf4: f("vf4")!, vr4: f("vr4")!, wpe: f("wpe")!, vx4: vx4ex ?? f("vx4")!, vx4Extended: vx4ex !== null });
}

if (haveGame) {
  describe("copied terrain: the game's tilesets", () => {
    it("yield none: no copies, no blocks", async () => {
      for (const [era, name] of NAMES.entries()) {
        const ts = loadDir(GAME, name);
        const copies = [...terrainCopies(ts).values()];
        expect(copies).toEqual([]);
        expect(await findCopyBlocks(ts, era, copies)).toEqual([]);
      }
    });

    it("find Blizzard's twins: High Sand Dunes' sets made anonymous are re-pointed Sand Dunes sets", async () => {
      // Desert: High Sand Dunes is Sand Dunes' pictures; its flat pair and its edge sets made untyped and given as a copy.
      const ts = loadDir(GAME, "desert");
      const anonymous = new Set<number>();
      const highFlat = ts.groups.findIndex((g, i) => i % 2 === 0 && g.index === 10 && g.edges.left === g.edges.top);
      const sandFlat = ts.groups.findIndex((g, i) => i % 2 === 0 && g.index === 8 && g.edges.left === g.edges.top);
      for (const [i, g] of ts.groups.entries()) if (g.index === 24 || g.index === 26 || g.index === 30) anonymous.add(i);
      anonymous.add(highFlat); anonymous.add(highFlat + 1);
      const groups = ts.groups.map((g, i) => (anonymous.has(i) ? { ...g, index: 0, edges: { left: 0, top: 0, right: 0, bottom: 0 }, stack: { left: 0, top: 0, right: 0, bottom: 0 } } : g));
      const anon = { ...ts, groups };
      const blocks = await findCopyBlocks(anon, 5, [{ group: highFlat, source: 8, sourceGroup: sandFlat }]);
      // High Dirt / High Sand Dunes is Dirt / Sand Dunes again, High Crags' set Crags' set: complete. (High Sandy Sunken
      // Pit's set walks unlike Sandy Sunken Pit's on 5% of its minitiles, and the gate says so.)
      const status = new Map(blocks.map((b) => [b.set, b.status]));
      expect(status.get(23)).toBe("complete");
      expect(status.get(25)).toBe("complete");
    });
  });
}

/* ── A mod's tilesets (SCMJS_COSMONARCHY = the mod's Release folder) ─────── */

const MOD = process.env.SCMJS_COSMONARCHY;
const modDir = MOD ? join(MOD, "mpq", "tileset") : "";
const haveMod = !!MOD && existsSync(modDir);
if (haveMod) {
  describe("copied terrain: a mod's tilesets", () => {
    it("are found in the tilesets that hold copies, and every offered block has a tile for every askable half", async () => {
      let offered = 0;
      for (const [era, name] of NAMES.entries()) {
        const ts = loadDir(modDir, name);
        const copies = [...terrainCopies(ts).values()];
        const blocks = await findCopyBlocks(ts, era, copies);
        for (const b of blocks) {
          if (b.status === "complete") { offered++; expect(b.missing).toEqual([]); expect(b.flags).toBeGreaterThanOrEqual(0.99); }
          expect(copies.some((c) => c.group === b.flat)).toBe(true);
        }
      }
      expect(offered).toBeGreaterThan(5);
    });
  });
}

describe("copied terrain: the terrain file's section", () => {
  it("reads, drops a bad row, writes and reads back", async () => {
    const { readTerrainFile, writeTerrainFile } = await import("../src/formats/mod/terrain");
    const text = JSON.stringify({ format: 1, tilesets: { jungle: { table: "abc", copies: [
      { terrain: 4, height: 1, ground: { terrain: 3 }, pieces: [[0x2400, 0x9950], [0x2401, 0x9951]] },
      { terrain: 4, height: 2, ground: { pair: 900 }, pieces: [[0x2400, 0x3850]] },
      { terrain: 4, height: 7, ground: { terrain: 3 }, pieces: [[1, 2]] },
    ] } } });
    const read = readTerrainFile(text);
    expect(read.dropped).toEqual([{ at: "tilesets.jungle.copies[2]", reason: "terrain" }]);
    expect(read.file.tilesets.jungle.copies).toHaveLength(2);
    const back = readTerrainFile(writeTerrainFile(read.file));
    expect(back.dropped).toEqual([]);
    expect(back.file.tilesets.jungle.copies).toEqual(read.file.tilesets.jungle.copies);
  });
});

/* ── The plugin API and the document ──────────────────────── */

import { primeTileset, type LoadedTileset } from "../src/formats/tileset/load";
import { NO_DOODADS } from "../src/formats/tileset/doodads";
import { Contributions, createPluginApi } from "../src/plugins/host";
import { headlessStore } from "../src/plugins/headless";
import { archiveExtrasAtom, resizeDocumentAtom, scenarioAtom, undoAtom } from "../src/atoms/documentAtoms";

describe("copied terrain: the plugin API", () => {
  it("copies() lists the terrain; tx.paintCopy paints it, one undo step takes it all back; a provided block takes its place", async () => {
    const w = copyWorld();
    primeTileset({ name: "badlands", tileset: w.ts, doodads: NO_DOODADS, atlas: { image: {} as CanvasImageSource, columns: 1, tileSize: 32, count: w.ts.megatileCount, averages: new Uint32Array(w.ts.megatileCount), animation: null } } as unknown as LoadedTileset);
    const doc = await openMapBytes(await writeMapBytes(groundScenario(w, HIGH_DIRT), { format: "scx" }), "c.scx");
    const store = headlessStore(doc);
    const api = createPluginApi(store, { id: "copier", name: "Copier", source: "s" }, new Contributions());
    const list = await api.terrain.copies();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ terrain: GRASS, height: 1, group: w.copy, complete: true, missing: 0 });
    expect(list[0].blocks[0]).toMatchObject({ ground: { terrain: HIGH_DIRT }, complete: true, from: "scan" });
    const before = store.get(scenarioAtom)!.tiles.slice();
    api.document.edit("Grass", (tx) => { expect(tx.paintCopy(blob(10, 22, 3), list[0].id)).toBe(true); });
    expect(store.get(scenarioAtom)!.tiles.filter((t, i) => t !== before[i]).length).toBeGreaterThan(40);
    expect(store.get(archiveExtrasAtom).has(COPY_MEMBER)).toBe(true);
    // Resize moves the footprint with the map
    const member = store.get(archiveExtrasAtom).get(COPY_MEMBER)!;
    store.set(resizeDocumentAtom, { width: 52, height: 48, anchor: "top-left" } as Parameters<typeof resizeDocumentAtom.write>[1]);
    expect(store.get(archiveExtrasAtom).get(COPY_MEMBER)).not.toEqual(member);
    store.set(undoAtom);
    expect(store.get(archiveExtrasAtom).get(COPY_MEMBER)).toEqual(member);
    store.set(undoAtom);
    expect(store.get(archiveExtrasAtom).has(COPY_MEMBER)).toBe(false);
    expect([...store.get(scenarioAtom)!.tiles]).toEqual([...before]);
    const r = api.document.edit("Nothing", (tx) => { expect(tx.paintCopy(blob(10, 22, 1), 6)).toBe(false); });
    expect(r.notes.join(" ")).toMatch(/not a copied terrain/);
    // A provided block: the same pieces, laid against Dirt.
    const [b] = await find(w);
    const handle = api.terrain.provideCopies({ id: "grass", tileset: "badlands", terrain: GRASS, height: 1, ground: { terrain: DIRT }, pieces: b.pieces });
    const given = await api.terrain.copies();
    expect(given[0].blocks).toEqual([{ ground: { terrain: DIRT }, complete: true, from: "copier" }]);
    handle.dispose();
    expect((await api.terrain.copies())[0].blocks[0].from).toBe("scan");
  }, 60_000);
});
