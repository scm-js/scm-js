import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadMap } from "../src/formats/mpq/scm";
import { parseScenario, tilesetIndex, type Scenario } from "../src/formats/chk/scenario";
import { decodeCv5, loadTileset, type Tileset } from "../src/formats/tileset/decode";
import { TILESET_FILENAMES } from "../src/formats/tileset/load";
import { baseTerrain, flatTerrain } from "../src/formats/tileset/terrain";
import { terrainName, TILESETS } from "../src/data/tilesets";
import { ISOM_TABLES, isomValueOf } from "../src/data/isomTables";
import {
  applyIsomChanges, brushDiamonds, checkIsom, diamondAt, hasIsom, isomReport, isomTables, isomTerrains, paintIsom,
  rebuildIsomFromTiles, STALE_ISOM_SHARE, tilesFromIsom,
} from "../src/editor/isom";
import { applyChanges, stampTerrain } from "../src/editor/terrain";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("isom tables", () => {
  it("has one table per tileset, each ending in the adjacency list's terminator", () => {
    expect(ISOM_TABLES).toHaveLength(8);
    for (const { terrainTypes, terrainTypeMap } of ISOM_TABLES) {
      expect(terrainTypes[0].isomValue).toBeGreaterThan(0);
      expect(terrainTypeMap.at(-1)).toBe(0);
      // Every id the adjacency list mentions is a real terrain type.
      for (const id of terrainTypeMap) expect(id).toBeLessThan(terrainTypes.length);
    }
  });

  it("numbers the flat terrains the way real maps do", () => {
    // Verified against StarEdit-made maps: jungle-family dirt is 1, high dirt 2, water 3.
    expect(isomValueOf(4, 2)).toBe(1);
    expect(isomValueOf(4, 3)).toBe(2);
    expect(isomValueOf(4, 5)).toBe(3);
    expect(isomValueOf(4, 8)).toBe(4);
    expect(isomValueOf(0, 2)).toBe(1);
    expect(isomValueOf(0, 4)).toBe(9);
    expect(isomValueOf(0, 99)).toBe(0);
  });
});

describe("diamond geometry", () => {
  it("maps pixels to the diamond centred on the nearest even lattice point", () => {
    expect(diamondAt(0, 0)).toEqual({ x: 0, y: 0 });
    expect(diamondAt(64, 32)).toEqual({ x: 1, y: 1 });
    expect(diamondAt(128, 0)).toEqual({ x: 2, y: 0 });
    expect(diamondAt(64 * 5 + 3, 32 * 3 - 2)).toEqual({ x: 5, y: 3 });
    // Every pixel lands on a diamond, never on an odd lattice point.
    for (let py = 0; py < 200; py += 7) for (let px = 0; px < 400; px += 11) expect((diamondAt(px, py).x + diamondAt(px, py).y) % 2).toBe(0);
  });

  it("grows the brush along the lattice axes and clips it to the map", () => {
    const scn = { width: 16, height: 8 };
    expect(brushDiamonds(scn, { x: 4, y: 4 }, 1)).toEqual([{ x: 4, y: 4 }]);
    const three = brushDiamonds(scn, { x: 4, y: 4 }, 3);
    expect(three).toHaveLength(9);
    expect(three).toContainEqual({ x: 4, y: 2 });
    expect(three).toContainEqual({ x: 2, y: 4 });
    expect(three.every((d) => (d.x + d.y) % 2 === 0)).toBe(true);
    expect(brushDiamonds(scn, { x: 0, y: 0 }, 3).length).toBeLessThan(9);
  });
});

describe("flat fill", () => {
  it("writes the terrain's tileset-specific ISOM value", () => {
    const cv5 = new Uint8Array(4 * 52);
    const view = new DataView(cv5.buffer);
    for (const group of [2, 3]) { view.setUint16(group * 52, 3, true); view.setUint16(group * 52 + 20, 1, true); }
    const tileset = { groups: decodeCv5(cv5) } as Tileset;
    // Badlands High Dirt (index 3) is ISOM value 2, so its rects hold 32..46.
    const { isom } = flatTerrain(4, 2, { id: 3, group: 2 }, tileset, seeded(1), 0);
    expect([...isom.subarray(0, 4)]).toEqual([40, 42, 32, 34]);
    expect([...isom.subarray(4, 8)]).toEqual([36, 44, 46, 38]);
  });
});

/* ── Against the real thing ─────────────────────────────── */

const TILESET_DIR = join(import.meta.dirname, "..", "public", "tileset");
const MAP_DIR = join(import.meta.dirname, "..", "fixtures", "maps");
const haveTilesets = TILESET_FILENAMES.every((n) => existsSync(join(TILESET_DIR, `${n}.cv5`)));
const maps = existsSync(MAP_DIR) ? readdirSync(MAP_DIR).filter((f) => /\.sc[mx]$/i.test(f)) : [];

function readTileset(era: number): Tileset {
  const name = TILESET_FILENAMES[era];
  const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `${name}.${ext}`)));
  return loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") });
}

async function readMap(file: string): Promise<Scenario> {
  const { chk } = await loadMap(new Uint8Array(readFileSync(join(MAP_DIR, file))));
  return parseScenario(chk);
}

/** Terrain-type index under (x, y), or -1 off the map. */
const indexAt = (scn: Scenario, ts: Tileset, x: number, y: number) => ts.groups[scn.tiles[y * scn.width + x] >> 4]?.index ?? -1;

describe.skipIf(!haveTilesets)("isom tables from real tilesets", () => {
  it("builds a shape-link table whose flat rows carry the CV5 links", () => {
    for (let era = 0; era < 8; era++) {
      const ts = readTileset(era);
      const tables = isomTables(ts, era);
      for (const index of isomTerrains(tables)) {
        const row = tables.links[isomValueOf(era, index)];
        expect(row.terrainType).toBe(index);
        const pair = ts.groups.findIndex((g, i) => i % 2 === 0 && g.index === index);
        expect(row.quads[0].right).toBe(ts.groups[pair].edges.right);
      }
      // Every edge set got its fourteen rows, and their soft-link quadrants know which flat terrain they face.
      const sets = tables.terrainTypes.filter((t, i) => i > tables.terrainTypes.length / 2 && t.isomValue !== 0);
      for (const set of sets) {
        const rows = tables.links.slice(set.isomValue, set.isomValue + 14);
        expect(rows.every((r) => r.terrainType === set.index)).toBe(true);
        expect(rows[0].quads[0].linkId).toBeGreaterThan(0); // edge NW, outer quadrant
        expect(rows[0].quads[2].linkId).toBeGreaterThan(0); // edge NW, inner quadrant
      }
      expect(isomTerrains(tables).length).toBe(TILESETS[era].terrain.length);
    }
  });
});

describe.skipIf(!haveTilesets || maps.length === 0)("isom against StarEdit-made maps", () => {
  for (const file of maps) {
    it(`${file}: regenerating the tiles from ISOM reproduces the map`, async () => {
      const scn = await readMap(file);
      if (!hasIsom(scn)) return;
      const ts = readTileset(tilesetIndex(scn));
      const original = Uint16Array.from(scn.tiles);
      const edit = tilesFromIsom(scn, ts, seeded(5));

      let compared = 0, same = 0;
      for (let y = 0; y < scn.height; y++) {
        for (let x = 0; x < scn.width; x++) {
          const before = ts.groups[original[y * scn.width + x] >> 4]?.index ?? -1;
          if (before <= 1) continue; // doodads sit on top of the terrain the ISOM describes
          compared++;
          if (indexAt(scn, ts, x, y) === before) same++;
        }
      }
      expect(compared).toBeGreaterThan(1000);
      expect(same / compared).toBeGreaterThan(0.995);
      // Undo puts every tile back.
      applyChanges(scn, edit.tiles, "undo");
      expect(scn.tiles).toEqual(original);
      expect(edit.isom).toHaveLength(0);
    });

    it(`${file}: the ISOM agrees with the tiles`, async () => {
      const scn = await readMap(file);
      if (!hasIsom(scn)) return;
      const { rects, mismatched } = checkIsom(scn, readTileset(tilesetIndex(scn)));
      expect(mismatched / rects).toBeLessThan(0.005);
    });

    it(`${file}: rebuilding ISOM from the tiles recovers the original`, async () => {
      const scn = await readMap(file);
      if (!hasIsom(scn)) return;
      const ts = readTileset(tilesetIndex(scn));
      const { isom, unresolved, diamonds } = rebuildIsomFromTiles(scn, ts);
      expect(isom.length).toBe(scn.isom.length);
      // Compare table rows, not raw bits: StarEdit's untouched new-map fill writes the
      // row with a zero flag nibble on all four sides, which means the same thing. The
      // padding column/row has no tiles under it, so nothing can be recovered there;
      // under doodads the original is a guess too.
      const w = Math.floor(scn.width / 2) + 1, h = scn.height + 1;
      let compared = 0, same = 0;
      for (let y = 0; y + 1 < h; y++) {
        for (let x = 0; x + 1 < w; x++) {
          for (let s = 0; s < 4; s++) {
            const i = (y * w + x) * 4 + s;
            compared++;
            if (isom[i] >> 4 === scn.isom[i] >> 4) same++;
          }
        }
      }
      expect(same / compared).toBeGreaterThan(0.96);
      expect(unresolved / diamonds).toBeLessThan(0.1);
      // And what it rebuilt is a lattice the brush machinery accepts.
      const rebuilt = { ...scn, isom } as Scenario & { isom: Uint16Array };
      const { rects, mismatched } = checkIsom(rebuilt, ts);
      expect(mismatched / rects).toBeLessThan(0.02);
    });
  }

  it("paints a cliff that the tileset's own pieces make up, and undoes cleanly", async () => {
    let painted = 0;
    for (const file of maps) {
      const scn = await readMap(file);
      if (!hasIsom(scn)) continue;
      const era = tilesetIndex(scn);
      const ts = readTileset(era);
      const tables = isomTables(ts, era);
      const tilesBefore = Uint16Array.from(scn.tiles);
      const isomBefore = Uint16Array.from(scn.isom);

      // A diamond well inside the map whose neighbourhood is flat base terrain.
      const info = TILESETS[era];
      const base = info.defaultIsom;
      const flat = isomValueOf(era, base);
      const w = Math.floor(scn.width / 2) + 1;
      const R = 4;
      let target: { x: number; y: number } | null = null;
      for (let y = R + 1; y < scn.height - R && !target; y++) {
        for (let x = R + 1; x < w - R - 1; x++) {
          if ((x + y) % 2 !== 0) continue;
          let ok = true;
          for (let dy = -R; dy <= R && ok; dy++) for (let dx = -R; dx <= R; dx++) if (scn.isom[((y + dy) * w + x + dx) * 4] >> 4 !== flat) { ok = false; break; }
          if (ok) target = { x, y };
        }
      }
      const raised = info.terrain.find((t) => t.name === `High ${terrainName(info, base)}`)?.id;
      if (!target || raised === undefined) continue;
      painted++;

      // Paint a 3x3-diamond mesa of the raised terrain: flat high ground inside a full
      // cliff ring. (A single diamond is all ring — no flat tile — just as in StarEdit.)
      const edit = paintIsom(scn, ts, target, raised, 3, seeded(9));
      expect(edit, file).not.toBeNull();
      expect(edit!.tiles.length).toBeGreaterThan(8);
      expect(edit!.isom.length).toBeGreaterThan(8);
      const touched = new Set(edit!.tiles.map((c) => ts.groups[c.after >> 4].index));
      expect(touched.has(raised), file).toBe(true);
      expect([...touched].some((i) => i > tables.terrainTypes.length / 2), file).toBe(true); // an edge set
      expect([...scn.dirty]).toEqual(expect.arrayContaining(["MTXM", "TILE", "ISOM"]));
      // No scratch flags left behind, and the result is as consistent as the original.
      expect([...scn.isom].every((v) => (v & 0x8001) === 0)).toBe(true);
      const check = checkIsom(scn, ts);
      expect(check.mismatched / check.rects, file).toBeLessThan(0.005);
      // A second stroke on top, back to the base terrain, behaves too.
      const more = paintIsom(scn, ts, { x: target.x + 2, y: target.y }, base, 1, seeded(3));
      expect(more).not.toBeNull();
      const again = checkIsom(scn, ts);
      expect(again.mismatched / again.rects, file).toBeLessThan(0.005);

      applyChanges(scn, more!.tiles, "undo");
      applyIsomChanges(scn, more!.isom, "undo");
      applyChanges(scn, edit!.tiles, "undo");
      applyIsomChanges(scn, edit!.isom, "undo");
      expect(scn.tiles, file).toEqual(tilesBefore);
      expect(scn.isom, file).toEqual(isomBefore);
    }
    expect(painted).toBeGreaterThan(0);
  });

  it("refuses terrain the tileset cannot paint and non-diamond points", async () => {
    const scn = await readMap(maps[0]);
    if (!hasIsom(scn)) return;
    const ts = readTileset(tilesetIndex(scn));
    expect(paintIsom(scn, ts, { x: 10, y: 10 }, 99, 1)).toBeNull();
    expect(paintIsom(scn, ts, { x: 10, y: 11 }, TILESETS[tilesetIndex(scn)].defaultIsom, 1)).toBeNull();
  });

  it("reports staleness as what a rebuild would recover, not as raw disagreement", async () => {
    // A rebuild converges in one pass and leaves behind the rects no lattice can produce.
    // Measuring the raw disagreement recommended a repair that could not move the number,
    // for ever, on any map with hand-placed terrain — which is what this pins.
    let stressed = 0;
    for (const file of maps) {
      const scn = await readMap(file);
      if (!hasIsom(scn)) continue;
      const era = tilesetIndex(scn);
      const ts = readTileset(era);

      // As it came from StarEdit: nothing to recover, and no lattice trouble either.
      const pristine = isomReport(scn, ts)!;
      expect(pristine.stale, file).toBe(false);
      expect(pristine.mismatched, file).toBe(pristine.inherent);

      // Rect-brush blocks of every flat terrain over it, leaving the lattice behind.
      const rnd = seeded(7);
      for (const [n, t] of TILESETS[era].terrain.entries()) {
        const group = ts.groups.findIndex((g, i) => i % 2 === 0 && g.index === t.id);
        if (group < 0) continue;
        const bx = 4 + (n * 13) % Math.max(1, scn.width - 20);
        const by = 4 + (n * 7) % Math.max(1, scn.height - 20);
        const cells: number[] = [];
        for (let y = by; y < Math.min(by + 12, scn.height); y++) {
          for (let x = bx; x < Math.min(bx + 12, scn.width); x++) cells.push(y * scn.width + x);
        }
        applyChanges(scn, stampTerrain(scn, ts, { group }, cells, rnd), "do");
      }
      const stale = isomReport(scn, ts)!;
      expect(stale.stale, file).toBe(true);
      expect(stale.inherent, file).toBeLessThan(stale.mismatched);
      stressed++;

      // Rebuild, and the finding must not survive itself: what is left is `inherent`,
      // above the raw threshold on maps like these but no longer worth offering a repair for.
      scn.isom = rebuildIsomFromTiles(scn, ts).isom;
      const after = isomReport(scn, ts)!;
      expect(after.stale, file).toBe(false);
      expect(after.mismatched, file).toBe(stale.inherent);
      expect(after.inherent, file).toBe(after.mismatched);
      expect(isomReport(scn, ts)!.stale, file).toBe(false); // and again
      // And the leftover really is past the raw threshold: measuring `mismatched` alone
      // would have kept the warning — and the repair — up on every one of these maps.
      expect(after.mismatched / after.rects, file).toBeGreaterThan(STALE_ISOM_SHARE);
    }
    expect(stressed).toBeGreaterThan(0);
  });

  it("a freshly created flat map round-trips through the brush machinery", () => {
    const era = 4;
    const ts = readTileset(era);
    const terrain = baseTerrain(ts, TILESETS[era].defaultIsom);
    const { tiles, isom } = flatTerrain(32, 16, terrain, ts, seeded(2), era);
    const scn = { width: 32, height: 16, era, tiles, isom, dirty: new Set<string>() } as unknown as Scenario & { isom: Uint16Array };
    const { rects, mismatched } = checkIsom(scn, ts);
    expect(rects).toBe(16 * 16);
    expect(mismatched).toBe(0);
  });
});
