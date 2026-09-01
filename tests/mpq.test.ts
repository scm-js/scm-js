import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScenario, serializeScenario, scenarioName } from "../src/formats/chk/scenario";
import { loadMap, looksLikeMpq, saveMap, SCENARIO_PATH } from "../src/formats/mpq/scm";

const MAPS_DIR = join(import.meta.dirname, "..", "fixtures", "maps");

function fixtureMaps(): string[] {
  try {
    return readdirSync(MAPS_DIR).filter((f) => /\.(scm|scx|chk)$/i.test(f));
  } catch {
    return [];
  }
}

describe("mpq container", () => {
  it("recognises a bare chk as not an archive", () => {
    expect(looksLikeMpq(new Uint8Array([0x54, 0x59, 0x50, 0x45]))).toBe(false);
  });

  it("round-trips scenario bytes through an archive", async () => {
    const chk = new Uint8Array(64).fill(7);
    const archive = await saveMap(chk);
    expect(looksLikeMpq(archive)).toBe(true);

    const loaded = await loadMap(archive);
    expect(loaded.chk).toEqual(chk);
    expect(loaded.files).toContain(SCENARIO_PATH);
  });

  it("carries extra archive members across a save", async () => {
    const extras = new Map([["staredit\\custom.wav", new Uint8Array([1, 2, 3])]]);
    const loaded = await loadMap(await saveMap(new Uint8Array(8), { extras }));
    expect(loaded.files).toContain("staredit\\custom.wav");
  });

  it("treats a bare chk as its own scenario", async () => {
    const loaded = await loadMap(new Uint8Array([0x54, 0x59, 0x50, 0x45, 4, 0, 0, 0, 82, 65, 87, 66]));
    expect(loaded.archive).toBeNull();
    expect(loaded.chk.length).toBe(12);
  });
});

const maps = fixtureMaps();
describe.skipIf(maps.length === 0)("real maps (fixtures/maps)", () => {
  for (const file of maps) {
    it(`opens and re-saves ${file} without losing sections`, async () => {
      const bytes = new Uint8Array(readFileSync(join(MAPS_DIR, file)));
      const loaded = await loadMap(bytes);
      const scn = parseScenario(loaded.chk);

      expect(scn.width).toBeGreaterThan(0);
      expect(scn.height).toBeGreaterThan(0);
      expect(scn.tiles.length).toBe(scn.width * scn.height);
      expect(scenarioName(scn)).toBeTypeOf("string");

      // An untouched scenario must serialise back to the exact bytes we read.
      expect(serializeScenario(scn)).toEqual(loaded.chk);

      // And it must survive a trip through a freshly written archive.
      const again = await loadMap(await saveMap(serializeScenario(scn)));
      expect(parseScenario(again.chk).tiles).toEqual(scn.tiles);
    });
  }
});
