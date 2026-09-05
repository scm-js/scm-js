import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScenario, serializeScenario, scenarioName } from "../src/formats/chk/scenario";
import { loadMap, looksLikeMpq, readMembers, saveMap, SCENARIO_PATH } from "../src/formats/mpq/scm";
import { createScenario } from "../src/formats/chk/create";
import { applySounds, referencedMembers, wavMemberName } from "../src/editor/sounds";
import { internString } from "../src/editor/settings";
import { openMapFile, writeMapBytes } from "../src/services/mapIo";
import { MANIFEST_MEMBER, SCRIPT_MEMBER } from "../src/editor/save";

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

describe("members without a file list", () => {
  const WAV = wavMemberName("probe.wav");
  const sound = new Uint8Array(5000).map((_, i) => (i * 13) & 0xff);
  const other = new Uint8Array([9, 8, 7, 6]);

  /** A protected-map shape: sounds referenced by the WAV table, another member nobody names, no (listfile). */
  async function protectedMap() {
    const scn = createScenario({ width: 32, height: 32, era: 0 });
    const wavs = scn.wavs!.slice();
    wavs[0] = internString(scn, WAV);
    applySounds(scn, wavs);
    const bytes = await saveMap(serializeScenario(scn), {
      extras: new Map([[WAV, sound], ["unknown\\member.bin", other]]),
      listfile: false, compress: "pkware", encrypt: true,
    });
    return { scn, bytes };
  }

  it("names the sounds the scenario refers to", () => {
    const scn = createScenario({ width: 32, height: 32, era: 0 });
    const wavs = scn.wavs!.slice();
    wavs[3] = internString(scn, WAV);
    applySounds(scn, wavs);
    expect(referencedMembers(scn)).toEqual([WAV, SCRIPT_MEMBER, MANIFEST_MEMBER]);
  });

  it("reads a referenced member by name and keeps the rest as stored", async () => {
    const { scn, bytes } = await protectedMap();
    const loaded = await loadMap(bytes);
    expect(loaded.files).toBeNull();
    const { extras, stored } = await readMembers(loaded.archive!, loaded.files, referencedMembers(scn));
    expect([...extras.keys()]).toEqual([WAV]);
    expect(extras.get(WAV)).toEqual(sound);
    expect(stored).not.toBeNull();
    expect(stored!.members).toHaveLength(1);
    expect(stored!.sectorSize).toBe(loaded.archive!.sectorSize);
    expect(stored!.unreadable).toEqual([]);
  });

  it("writes an unnamed member back where it was, still readable by its name", async () => {
    const { scn, bytes } = await protectedMap();
    const loaded = await loadMap(bytes);
    const members = await readMembers(loaded.archive!, loaded.files, referencedMembers(scn));
    // Ask for zlib's 64 KB sectors: the stored member wins, since its sector table was written for 4 KB.
    const saved = await loadMap(await saveMap(serializeScenario(scn), { extras: members.extras, stored: members.stored, compress: "zlib", sectorSize: 0x10000 }));
    expect(saved.archive!.sectorSize).toBe(4096);
    expect(await saved.archive!.readFileAsync("unknown\\member.bin")).toEqual(other);
    expect(await saved.archive!.readFileAsync(WAV)).toEqual(sound);
    expect(saved.files).toEqual([SCENARIO_PATH, WAV]);
    expect(saved.chk).toEqual(serializeScenario(scn));
  });

  it("loses nothing between File ▸ Open and Save", async () => {
    const { bytes } = await protectedMap();
    const doc = await openMapFile(new File([bytes as unknown as BlobPart], "probe.scx"));
    expect(doc.extras.get(WAV)).toEqual(sound);
    expect(doc.stored!.members).toHaveLength(1);
    expect(doc.scenario.warnings.join(" ")).toMatch(/1 archive member has no name .* no file list/);
    const saved = await loadMap(await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras, stored: doc.stored }));
    expect(await saved.archive!.readFileAsync("unknown\\member.bin")).toEqual(other);
    expect(await saved.archive!.readFileAsync(WAV)).toEqual(sound);
    // And a second pass carries the same member again.
    const again = await openMapFile(new File([(await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras, stored: doc.stored })) as unknown as BlobPart], "probe.scx"));
    expect(again.stored!.members).toHaveLength(1);
  });

  it("fills in what an incomplete file list leaves out", async () => {
    const scn = createScenario({ width: 32, height: 32, era: 0 });
    const wavs = scn.wavs!.slice();
    wavs[0] = internString(scn, WAV);
    applySounds(scn, wavs);
    const bytes = await saveMap(serializeScenario(scn), { extras: new Map([[WAV, sound], ["listed.txt", other]]) });
    const loaded = await loadMap(bytes);
    // Pretend the list named only one of the two.
    const { extras, stored } = await readMembers(loaded.archive!, ["listed.txt"], referencedMembers(scn));
    expect([...extras.keys()].sort()).toEqual([WAV, "listed.txt"].sort());
    expect(stored).toBeNull();
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

    it(`keeps every member of ${file} when its file list is gone`, async () => {
      const loaded = await loadMap(new Uint8Array(readFileSync(join(MAPS_DIR, file))));
      const scn = parseScenario(loaded.chk);
      const all = await readMembers(loaded.archive!, loaded.files, referencedMembers(scn));
      // Strip the list, as a protector would, then open and save through the editor's path.
      const stripped = await loadMap(await saveMap(loaded.chk, { extras: all.extras, listfile: false, compress: "pkware", encrypt: true }));
      expect(stripped.files).toBeNull();
      const members = await readMembers(stripped.archive!, null, referencedMembers(scn));
      expect(members.stored!.members.length).toBe(all.extras.size);
      const saved = await loadMap(await saveMap(serializeScenario(scn), { extras: members.extras, stored: members.stored }));
      for (const [name, data] of all.extras) expect(await saved.archive!.readFileAsync(name)).toEqual(data);
      expect(saved.chk).toEqual(loaded.chk);
    });
  }
});
