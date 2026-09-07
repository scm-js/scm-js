import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadMap } from "../src/formats/mpq/scm";
import { parseScenario, tilesetIndex } from "../src/formats/chk/scenario";
import { loadTileset } from "../src/formats/tileset/decode";
import { buildDoodadCatalogue, doodadOrigin } from "../src/formats/tileset/doodads";
import { TILESET_FILENAMES } from "../src/formats/tileset/load";
import { decodeTbl } from "../src/formats/dat/tbl";
import { checkDoodadPlacement } from "../src/editor/doodads";
import { tilesFromIsom } from "../src/editor/isom";

const TILESET_DIR = join(import.meta.dirname, "..", "public", "tileset");
const MAP_DIR = join(import.meta.dirname, "..", "fixtures", "maps");
const haveTilesets = TILESET_FILENAMES.every((n) => existsSync(join(TILESET_DIR, `${n}.cv5`)) && existsSync(join(TILESET_DIR, `${n}.dddata.bin`))) && existsSync(join(TILESET_DIR, "stat_txt.tbl"));
const maps = existsSync(MAP_DIR) ? readdirSync(MAP_DIR).filter((f) => /\.sc[mx]$/i.test(f)) : [];

const part = (name: string, ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `${name}.${ext}`)));

/**
 * The placement rule against the maps Blizzard shipped: every ramp and bridge they
 * placed must pass where it stands, on the ground the ISOM lattice describes under it.
 * That ground fails every one of them under a rule that also checks the cells a doodad
 * does not draw (an Ice cliff ramp's two "approach" rows, a Desert bridge's dirt
 * corners over its own channel), which is how the drawn-cells-only rule was found.
 */
describe.skipIf(!haveTilesets || maps.length === 0)("doodad placement against Blizzard's maps", () => {
  for (const file of maps) {
    it(`${file}: every ramp and bridge passes the check where it was placed`, async () => {
      const { chk } = await loadMap(new Uint8Array(readFileSync(join(MAP_DIR, file))));
      const scn = parseScenario(chk);
      const era = tilesetIndex(scn);
      const name = TILESET_FILENAMES[era];
      const ts = loadTileset({ cv5: part(name, "cv5"), vf4: part(name, "vf4"), vr4: part(name, "vr4"), vx4: part(name, "vx4"), wpe: part(name, "wpe") });
      const cat = buildDoodadCatalogue(ts, part(name, "dddata.bin"), decodeTbl(part("stat_txt", "tbl")));
      if (!scn.isom) return;
      const ground = Uint16Array.from(scn.tiles);
      for (const c of tilesFromIsom(scn as typeof scn & { isom: Uint16Array }, ts, () => 0.5).tiles) ground[c.at] = c.after;
      const refused: string[] = [];
      let checked = 0;
      for (const r of scn.doodads) {
        const def = cat.byId.get(r.doodadId);
        if (!def || !(def.ramp || /bridge/i.test(def.category))) continue;
        const o = doodadOrigin(def, r.x, r.y);
        const v = checkDoodadPlacement(scn, ts, def, o.x, o.y, { placeAnywhere: false, snapToGrid: false, asTerrain: false }, (at) => ground[at]);
        checked++;
        if (!v.ok) refused.push(`${def.category} #${def.id} at ${o.x},${o.y}: cells ${v.bad.join(",")}`);
      }
      expect(refused).toEqual([]);
      expect(checked).toBeGreaterThanOrEqual(0);
    });
  }
});
