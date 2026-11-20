import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Creator } from "mopaq";
import { parseScenario, serializeScenario, scenarioName } from "../src/formats/chk/scenario";
import { fitStored, loadMap, looksLikeMpq, readMembers, saveMap, SCENARIO_PATH, unreachableStored } from "../src/formats/mpq/scm";
import { createScenario } from "../src/formats/chk/create";
import { applySounds, referencedMembers, wavMemberName } from "../src/editor/sounds";
import { internString } from "../src/editor/settings";
import { openMapFile, writeMapBytes } from "../src/services/mapIo";
import { mapFiles } from "./support/maps";
import { DEFAULT_SAVE_OPTIONS, MANIFEST_MEMBER, planSave, SCRIPT_MEMBER, scriptMembersFromManifest } from "../src/editor/save";

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

  it("finds a script's other files through its manifest when there is no listfile", async () => {
    const scn = createScenario({ width: 32, height: 32, era: 0 });
    const manifest = new TextEncoder().encode(JSON.stringify({ version: 2, start: 0, count: 0, hash: "0:0", sources: [], files: ["main.ts", "ai/waves.ts"], sourceHash: "x" }));
    const bytes = await saveMap(serializeScenario(scn), {
      extras: new Map([[SCRIPT_MEMBER, new Uint8Array([1])], ["trigscript\\ai\\waves.ts", new Uint8Array([2])], [MANIFEST_MEMBER, manifest], ["trigscript\\orphan.ts", new Uint8Array([3])]]),
      listfile: false, compress: "pkware", encrypt: true,
    });
    const loaded = await loadMap(bytes);
    expect(loaded.files).toBeNull();
    const more = (extras: ReadonlyMap<string, Uint8Array>) => { const m = extras.get(MANIFEST_MEMBER); return m ? scriptMembersFromManifest(m) : []; };
    const { extras, stored } = await readMembers(loaded.archive!, loaded.files, referencedMembers(scn), undefined, more);
    expect([...extras.keys()].sort()).toEqual([MANIFEST_MEMBER, SCRIPT_MEMBER, "trigscript\\ai\\waves.ts"].sort());
    // The file the manifest does not list is nameless, and stays stored as it is.
    expect(stored!.members).toHaveLength(1);
    expect(scriptMembersFromManifest(new TextEncoder().encode("{not json"))).toEqual([]);
    expect(scriptMembersFromManifest(new TextEncoder().encode(JSON.stringify({ files: ["../x.ts", "ok.ts", 5] })))).toEqual(["trigscript\\ok.ts"]);
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

  it("saves a map whose unnamed members share their bytes", async () => {
    // What protectors write: a second hash entry for the same bytes. Save used to refuse the
    // whole map with "stored member at offset … overlaps another".
    const { bytes } = await protectedMap();
    const a = (await loadMap(bytes)).archive!;
    const hashTable = a.hashEntries();
    const free = hashTable.findIndex((h) => h.blockIndex === 0xffffffff);
    const twin = new Creator({ sectorSize: a.sectorSize, hashTable, listfile: false });
    for (const m of a.members()) {
      twin.addStored(m);
      if (m.slot === a.slotOf("unknown\\member.bin")) twin.addStored({ ...m, slot: free, hash: { ...m.hash, hashA: m.hash.hashA ^ 1 } });
    }
    const doc = await openMapFile(new File([(await twin.writeAsync()) as unknown as BlobPart], "probe.scx"));
    expect(doc.stored!.members).toHaveLength(2);
    expect(doc.stored!.members[0].block.filePos).toBe(doc.stored!.members[1].block.filePos);
    const saved = await loadMap(await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras, stored: doc.stored }));
    expect(await saved.archive!.readFileAsync("unknown\\member.bin")).toEqual(other);
    expect(await saved.archive!.readFileAsync(WAV)).toEqual(sound);
    // Both entries still name the one copy of the bytes, where it was.
    const at = doc.stored!.members[0].block.filePos;
    expect(saved.archive!.members().filter((m) => m.block.filePos === at)).toHaveLength(2);
  });

  it("saves a map whose block table points a member past the end of the file", async () => {
    // A protector's fake block, as mopaq before 1.6.2 hands it over: no bytes, at its offset.
    // Carried, the save was padded with zeros out to it — or, near 4 GB, threw a RangeError.
    const { bytes } = await protectedMap();
    const doc = await openMapFile(new File([bytes as unknown as BlobPart], "probe.scx"));
    const [m] = doc.stored!.members;
    const free = doc.stored!.hashTable.findIndex((h) => h.blockIndex === 0xffffffff);
    const fake = { ...m, slot: free, hash: { ...m.hash, hashA: m.hash.hashA ^ 1 }, block: { ...m.block, filePos: 50_000_000 }, data: new Uint8Array(0) };
    const stored = { ...doc.stored!, members: [...doc.stored!.members, fake] };
    const out = await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras, stored });
    const plain = await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras, stored: doc.stored });
    expect(out.length).toBe(plain.length);
    const saved = await loadMap(out);
    expect(await saved.archive!.readFileAsync("unknown\\member.bin")).toEqual(other);
    expect(await saved.archive!.readFileAsync(WAV)).toEqual(sound);
  });

  /**
   * A protector's table sized to its files: four slots holding the scenario, the sound and two
   * members nothing names. Laid over it, a save had no slot for its (listfile) — mopaq's
   * `HashTableFull`, and the map could not be saved at all (0.17.0's error counts).
   */
  async function fullTable(scn = (() => { const s = createScenario({ width: 32, height: 32, era: 0 }); const w = s.wavs!.slice(); w[0] = internString(s, WAV); applySounds(s, w); return s; })()) {
    const probe = (await loadMap(await saveMap(new Uint8Array(8), { listfile: false }))).archive!;
    const blank = probe.hashEntries().find((h) => h.blockIndex === 0xffffffff)!;
    const c = new Creator({ sectorSize: 4096, listfile: false, hashTable: Array.from({ length: 4 }, () => ({ ...blank })) });
    c.addFile(SCENARIO_PATH, serializeScenario(scn), { compress: "pkware" });
    c.addFile(WAV, sound, { compress: "pkware" });
    c.addFile("unknown\\a.bin", other);
    c.addFile("unknown\\b.bin", new Uint8Array([1, 2, 3, 4]));
    const doc = await openMapFile(new File([(await c.writeAsync()) as unknown as BlobPart], "probe.scx"));
    expect(doc.stored!.members).toHaveLength(2);
    expect(doc.stored!.hashTable).toHaveLength(4);
    return doc;
  }

  it("leaves out the members nothing names when the hash table has no room for the save's files", async () => {
    const doc = await fullTable();
    const plan = planSave(doc.scenario, doc.extras, { ...DEFAULT_SAVE_OPTIONS, format: "scx" }, doc.stored);
    expect(plan.stored!.dropped).toBe(2);
    expect(plan.warnings.join(" ")).toMatch(/2 archive members nothing in the map names are left out/);
    expect(plan.warnings.join(" ")).not.toMatch(/written back exactly as stored/);
    const saved = await loadMap(await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras, stored: doc.stored }));
    expect(await saved.archive!.readFileAsync(WAV)).toEqual(sound);
    expect(saved.archive!.fileInfo("unknown\\a.bin")).toBeNull();
    expect(saved.archive!.members()).toHaveLength(3);
    expect(saved.files).toEqual([SCENARIO_PATH, WAV]);
  });

  it("keeps a stored member the scenario has come to name, and drops the (listfile) before it", async () => {
    const doc = await fullTable();
    // As when Repair mends the strings after the map was opened: the table now names both.
    const wavs = doc.scenario.wavs!.slice();
    wavs[1] = internString(doc.scenario, "unknown\\a.bin");
    applySounds(doc.scenario, wavs);
    expect(planSave(doc.scenario, doc.extras, { ...DEFAULT_SAVE_OPTIONS, format: "scx" }, doc.stored).stored!.dropped).toBe(1);
    const one = await loadMap(await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras, stored: doc.stored }));
    expect(await one.archive!.readFileAsync("unknown\\a.bin")).toEqual(other);
    expect(one.archive!.fileInfo("unknown\\b.bin")).toBeNull();
    expect(one.files).not.toBeNull();
    // Both named: they fill two slots, the scenario and the sound the other two, and the (listfile) goes.
    wavs[2] = internString(doc.scenario, "unknown\\b.bin");
    applySounds(doc.scenario, wavs);
    const both = await loadMap(await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras, stored: doc.stored }));
    expect(both.files).toBeNull();
    expect(await both.archive!.readFileAsync("unknown\\b.bin")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(await both.archive!.readFileAsync(WAV)).toEqual(sound);
    // One more file and nothing can give way: a plain message, not mopaq's.
    await expect(writeMapBytes(doc.scenario, { format: "scx", extras: new Map([...doc.extras, ["more.txt", other]]), stored: doc.stored })).rejects.toThrow(/no room for the files this save writes/);
  });

  it("counts the stored members no name reaches", async () => {
    const doc = await fullTable();
    expect(unreachableStored(doc.stored, referencedMembers(doc.scenario))).toEqual({ count: 2, size: 8 });
    expect(unreachableStored(doc.stored, ["UNKNOWN/A.BIN"])).toEqual({ count: 1, size: 4 });
    expect(fitStored(doc.stored, 1, true)).toEqual({ members: doc.stored!.members, dropped: 0, listfile: true });
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

// The committed maps always, Blizzard's where they are installed.
describe("map files (tests/maps, fixtures/maps)", () => {
  for (const { name: file, path } of mapFiles()) {
    it(`opens and re-saves ${file} without losing sections`, async () => {
      const bytes = new Uint8Array(readFileSync(path));
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
      const loaded = await loadMap(new Uint8Array(readFileSync(path)));
      const scn = parseScenario(loaded.chk);
      const all = await readMembers(loaded.archive!, loaded.files, referencedMembers(scn));
      // Strip the list, as a protector would, then open and save through the editor's path.
      const stripped = await loadMap(await saveMap(loaded.chk, { extras: all.extras, listfile: false, compress: "pkware", encrypt: true }));
      expect(stripped.files).toBeNull();
      const members = await readMembers(stripped.archive!, null, referencedMembers(scn));
      // A member the scenario names (a sound in its WAV table) is found by that name; the rest come across as stored.
      expect(members.extras.size + (members.stored?.members.length ?? 0)).toBe(all.extras.size);
      const saved = await loadMap(await saveMap(serializeScenario(scn), { extras: members.extras, stored: members.stored }));
      for (const [name, data] of all.extras) expect(await saved.archive!.readFileAsync(name)).toEqual(data);
      expect(saved.chk).toEqual(loaded.chk);
    }, 30_000);
  }
});
