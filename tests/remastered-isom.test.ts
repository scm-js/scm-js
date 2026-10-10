// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Scenario } from "../src/formats/chk/scenario";
import { loadTileset, type Tileset } from "../src/formats/tileset/decode";
import { baseTerrain, flatTerrain } from "../src/formats/tileset/terrain";
import { TILESETS } from "../src/data/tilesets";
import { checkIsom, isomTables, isomTerrains, paintIsom } from "../src/editor/isom";
import { extractRemastered } from "../src/gamedata/remastered";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/*
 * Remastered's tile tables are longer than 1.16's — hundreds of doodad groups were added,
 * some of them in the group range terrain normally keeps to — and the isometric brush
 * builds its tables from every group in the file. This paints the same strokes through
 * both and expects the same map: the additions must not change what the brush lays.
 *
 * Needs the 1.16 files in `public/tileset/` and a real installation named by
 * SCM_REMASTERED_DIR, so it is skipped everywhere else (and guarded with `if`, since it
 * imports `kascade/node`).
 */
const installDir = process.env.SCM_REMASTERED_DIR;
if (installDir && existsSync("public/tileset/badlands.cv5")) {
  describe("the isometric brush over Remastered's tile tables", () => {
    it("lays the same tiles as over the 1.16 tables, on every tileset", async () => {
      const { Storage } = await import("kascade");
      const { nodeSource } = await import("kascade/node");
      const { result } = await extractRemastered(await Storage.open(nodeSource(installDir)));
      const names = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"];
      for (const [era, name] of names.entries()) {
        const cf = (ext: string) => new Uint8Array(readFileSync(`public/tileset/${name}.${ext}`));
        const rf = (ext: string) => result.files.get(`tileset/${name}.${ext}`)!;
        const classic = loadTileset({ cv5: cf("cv5"), vf4: cf("vf4"), vr4: cf("vr4"), wpe: cf("wpe"), vx4: cf("vx4"), vx4Extended: false });
        const remastered = loadTileset({ cv5: rf("cv5"), vf4: rf("vf4"), vr4: rf("vr4"), wpe: rf("wpe"), vx4: rf("vx4ex"), vx4Extended: true });
        const run = (ts: Tileset) => {
          const terrain = baseTerrain(ts, TILESETS[era].defaultIsom);
          const { tiles, isom } = flatTerrain(96, 96, terrain, ts, seeded(2), era);
          const scn = { width: 96, height: 96, era, tiles, editorTiles: tiles.slice(), isom, dirty: new Set<string>() } as unknown as Scenario & { isom: Uint16Array };
          const terrains = isomTerrains(isomTables(ts, era));
          const pick = seeded(77), random = seeded(5);
          let painted = 0;
          for (let i = 0; i < 1500; i++) {
            const x = Math.floor(pick() * 48), y = Math.floor(pick() * 96);
            const terrainType = terrains[Math.floor(pick() * terrains.length)];
            if (paintIsom(scn, ts, { x: (x + y) % 2 === 0 ? x : x + 1, y }, terrainType, 1 + Math.floor(pick() * 4), random)) painted++;
          }
          return { tiles: scn.tiles, isom: scn.isom, painted, terrains, mismatched: checkIsom(scn, ts).mismatched };
        };
        const a = run(classic), b = run(remastered);
        expect(b.terrains, name).toEqual(a.terrains);
        expect(a.painted, name).toBeGreaterThan(1000);
        expect(Buffer.compare(Buffer.from(b.tiles.buffer), Buffer.from(a.tiles.buffer)), `${name} tiles`).toBe(0);
        expect(Buffer.compare(Buffer.from(b.isom.buffer), Buffer.from(a.isom.buffer)), `${name} ISOM`).toBe(0);
        expect(b.mismatched, name).toBe(a.mismatched);
      }
    }, 300_000);

    it("has the tile groups Check Map says only Remastered has, and no others", async () => {
      const { Storage } = await import("kascade");
      const { nodeSource } = await import("kascade/node");
      const { isRemasteredOnlyTile, tileGroupRanges } = await import("../src/data/remasteredTiles");
      const { result } = await extractRemastered(await Storage.open(nodeSource(installDir)));
      const names = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"];
      const filled = (cv5: Uint8Array, group: number) => { for (let i = 0; i < 32; i++) if (cv5[group * 52 + 20 + i] !== 0) return true; return false; };
      for (const [era, name] of names.entries()) {
        const classic = new Uint8Array(readFileSync(`public/tileset/${name}.cv5`));
        const remastered = result.files.get(`tileset/${name}.cv5`)!;
        const ranges = tileGroupRanges(era);
        expect([ranges.classic, ranges.remastered], name).toEqual([classic.length / 52, remastered.length / 52]);
        for (let group = 0; group < ranges.remastered + 8; group++) {
          // Remastered's alone: past the 1.16 table, or a group 1.16 left empty that Remastered filled.
          const only = group < ranges.remastered && (group >= ranges.classic || (!filled(classic, group) && filled(remastered, group)));
          expect(isRemasteredOnlyTile(era, group << 4), `${name} group ${group}`).toBe(only);
        }
      }
    }, 120_000);
  });
} else {
  it.skip("the isometric brush over Remastered's tile tables (needs public/tileset and SCM_REMASTERED_DIR)", () => {});
}
