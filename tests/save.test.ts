import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createScenario, requiredSections } from "../src/formats/chk/create";
import { parseChk, serializeChk } from "../src/formats/chk/reader";
import { parseScenario, serializeScenario } from "../src/formats/chk/scenario";
import { loadMap, readExtras, SCENARIO_PATH } from "../src/formats/mpq/scm";
import {
  BOOKKEEPING_SECTIONS, buildChk, buildMapFile, DEFAULT_SAVE_OPTIONS, defaultSaveOptions, editorOnlySections, extraKind, formatBytes, formatOf,
  MANIFEST_MEMBER, planSave, SAVE_PRESETS, SCRIPT_MEMBER, TERRAIN_EDITING_SECTIONS, type SaveOptions,
} from "../src/editor/save";

const MAPS_DIR = join(import.meta.dirname, "..", "fixtures", "maps");
const fixtures = (() => { try { return readdirSync(MAPS_DIR).filter((f) => /\.scx$/i.test(f)); } catch { return []; } })();

const fresh = () => createScenario({ width: 64, height: 64, era: 0, name: "save" });
const opts = (o: Partial<SaveOptions> = {}): SaveOptions => ({ ...DEFAULT_SAVE_OPTIONS, ...o });
const names = (scn: ReturnType<typeof fresh>, o: SaveOptions) => planSave(scn, new Map(), o).file.sections.map((s) => s.name);

describe("save options", () => {
  it("keeps the registry's editor-only list and the two strip groups in step", () => {
    expect([...TERRAIN_EDITING_SECTIONS, ...BOOKKEEPING_SECTIONS].sort()).toEqual(editorOnlySections().sort());
  });

  it("writes the same bytes as serializeScenario when nothing is stripped", () => {
    const scn = fresh();
    const plan = planSave(scn, new Map(), opts());
    expect(buildChk(plan)).toEqual(serializeScenario(scn));
    expect(plan.sections.every((s) => s.fate === "kept")).toBe(true);
    expect(plan.chkSize).toBe(plan.chkSizeBefore);
    expect(plan.warnings).toEqual([]);
  });

  it("strips the terrain-editing and bookkeeping groups, and only those", () => {
    const scn = fresh();
    const all = names(scn, opts());
    const noTerrain = names(scn, opts({ stripTerrainEditing: true }));
    expect(all.filter((n) => !noTerrain.includes(n)).sort()).toEqual(["DD2 ", "ISOM", "TILE"]);
    const noBooks = names(scn, opts({ stripBookkeeping: true }));
    expect(all.filter((n) => !noBooks.includes(n)).sort()).toEqual([...BOOKKEEPING_SECTIONS].filter((n) => all.includes(n)).sort());
    // What is left still satisfies the game.
    const smallest = names(scn, SAVE_PRESETS.smallest(opts()));
    for (const req of requiredSections(scn.fileVersion)) expect(smallest).toContain(req);
    const plan = planSave(scn, new Map(), SAVE_PRESETS.smallest(opts()));
    expect(plan.chkSize).toBeLessThan(plan.chkSizeBefore);
    expect(plan.warnings.join(" ")).toMatch(/isometric brush/);
    expect(plan.sections.filter((s) => s.fate === "dropped").every((s) => s.editorOnly)).toBe(true);
  });

  it("drops unknown sections and trailing bytes only when asked, and counts them either way", () => {
    const scn = fresh();
    scn.chk.sections.push({ name: "JUNK", offset: -1, declaredSize: 3, data: new Uint8Array([1, 2, 3]) });
    scn.chk.trailing = new Uint8Array([9, 9]);
    const kept = planSave(scn, new Map(), opts());
    expect(kept.counts.unknown).toBe(1);
    expect(kept.counts.trailing).toBe(2);
    expect(kept.file.trailing).toEqual(new Uint8Array([9, 9]));
    expect(kept.sections.find((s) => s.name === "JUNK")?.what).toBeNull();
    const stripped = planSave(scn, new Map(), opts({ stripUnknown: true, dropTrailing: true }));
    expect(stripped.file.sections.some((s) => s.name === "JUNK")).toBe(false);
    expect(stripped.file.trailing).toBeUndefined();
    expect(parseChk(buildChk(stripped)).trailing).toBeUndefined();
    expect(stripped.warnings.join(" ")).toMatch(/format reference/);
  });

  it("merges repeated sections the way the game reads them", () => {
    const scn = fresh();
    const bytes = serializeScenario(scn);
    // A second, partial MTXM overlaying the first two tiles, and a second UNIT list: protector staples.
    const file = parseChk(bytes);
    const mtxm = file.sections.find((s) => s.name === "MTXM")!;
    file.sections.push({ name: "MTXM", offset: -1, declaredSize: 4, data: new Uint8Array([0x34, 0x12, 0x78, 0x56]) });
    file.sections.push({ name: "UNIT", offset: -1, declaredSize: 36, data: new Uint8Array(36).fill(1) });
    const doubled = parseScenario(serializeChk(file));
    const plan = planSave(doubled, new Map(), opts({ mergeRepeats: true }));
    expect(plan.counts.repeated).toBe(2);
    const out = parseChk(buildChk(plan));
    expect(out.sections.filter((s) => s.name === "MTXM")).toHaveLength(1);
    const merged = out.sections.find((s) => s.name === "MTXM")!.data;
    expect(merged.length).toBe(mtxm.data.length);
    expect([merged[0], merged[1], merged[2], merged[3]]).toEqual([0x34, 0x12, 0x78, 0x56]);
    expect(merged[4]).toBe(mtxm.data[4]);
    const units = out.sections.filter((s) => s.name === "UNIT");
    expect(units).toHaveLength(1);
    expect(units[0].data.length).toBe(36); // the empty first list plus one record
    expect(plan.sections.filter((s) => s.fate === "merged").map((s) => s.name).sort()).toEqual(["MTXM", "UNIT"]);
    // Untouched, both copies survive.
    expect(parseChk(buildChk(planSave(doubled, new Map(), opts()))).sections.filter((s) => s.name === "MTXM")).toHaveLength(2);
  });

  it("classifies archive members and leaves out the ones unticked", async () => {
    const scn = fresh();
    const extras = new Map<string, Uint8Array>([
      ["staredit\\wav\\hello.wav", new Uint8Array([1])],
      [SCRIPT_MEMBER, new Uint8Array([2])],
      [MANIFEST_MEMBER, new Uint8Array([3])],
      ["readme.txt", new Uint8Array([4])],
    ]);
    expect(extraKind("staredit\\wav\\hello.wav")).toBe("sound");
    expect(extraKind("STAREDIT/WAV/x.WAV")).toBe("sound");
    expect(extraKind(SCRIPT_MEMBER)).toBe("script");
    expect(extraKind("readme.txt")).toBe("file");

    const plan = planSave(scn, extras, opts({ omitExtras: ["staredit\\wav\\hello.wav", SCRIPT_MEMBER] }));
    expect(plan.extras.map((e) => e.kept)).toEqual([false, false, true, true]);
    expect(plan.warnings.join(" ")).toMatch(/1 sound file left out/);
    expect(plan.warnings.join(" ")).toMatch(/trigger script/);
    const loaded = await loadMap(await buildMapFile(scn, extras, opts({ omitExtras: ["staredit\\wav\\hello.wav", SCRIPT_MEMBER] })));
    expect(loaded.files?.sort()).toEqual([SCENARIO_PATH, MANIFEST_MEMBER, "readme.txt"].sort());

    // A bare .chk carries no members at all and says so.
    const chk = planSave(scn, extras, opts({ format: "chk" }));
    expect(chk.extras.every((e) => !e.kept)).toBe(true);
    expect(chk.warnings.join(" ")).toMatch(/bare \.chk/);
    expect(await buildMapFile(scn, extras, opts({ format: "chk" }))).toEqual(serializeScenario(scn));
  });

  it("round-trips every compression and the StarEdit-style encryption", async () => {
    const scn = fresh();
    const extras = new Map([["staredit\\wav\\a.wav", new Uint8Array(3000).fill(7)]]);
    const chk = serializeScenario(scn);
    const sizes: Record<string, number> = {};
    for (const compression of ["none", "zlib", "pkware"] as const) {
      for (const encrypt of [false, true]) {
        const bytes = await buildMapFile(scn, extras, opts({ compression, encrypt }));
        const loaded = await loadMap(bytes);
        expect(loaded.chk).toEqual(chk);
        expect(await readExtras(loaded.archive!, loaded.files)).toEqual(extras);
        expect(loaded.scenarioInfo).toMatchObject({ compression, encrypted: encrypt, size: chk.length });
        sizes[`${compression}-${encrypt}`] = bytes.length;
      }
    }
    expect(sizes["pkware-false"]).toBeLessThan(sizes["none-false"] / 2);
    expect(sizes["zlib-false"]).toBeLessThan(sizes["none-false"] / 2);
    expect(loadMap(await buildMapFile(scn, extras, opts({ compression: "pkware", encrypt: true })))).resolves.toMatchObject({ scenarioInfo: { sectorSize: 4096 } });
  });

  it("starts Save As from the file's extension and the way it was stored", () => {
    const scn = fresh();
    expect(formatOf("x.SCM")).toBe("scm");
    expect(formatOf("x.png")).toBeNull();
    expect(formatOf(null)).toBeNull();
    expect(defaultSaveOptions(scn, null, null)).toMatchObject({ format: "scx", compression: "pkware", encrypt: true });
    expect(defaultSaveOptions(scn, null, "old.scm")).toMatchObject({ format: "scm" });
    const origin = { compression: "none" as const, encrypted: false, storedSize: 1, size: 1, sectorSize: 4096 };
    expect(defaultSaveOptions(scn, origin, "a.scx")).toMatchObject({ compression: "none", encrypt: false });
    expect(defaultSaveOptions(scn, { ...origin, compression: "zlib", encrypted: true }, "a.scx")).toMatchObject({ compression: "zlib", encrypt: true });
    expect(defaultSaveOptions(scn, { ...origin, compression: "other" }, "a.scx")).toMatchObject({ compression: "none" });
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
  });
});

if (fixtures.length > 0) describe("save options on the fixture maps", () => {
  for (const f of fixtures) {
    it(`${f}: writes the same scenario back under every preset and reads Blizzard's layout`, async () => {
      const loaded = await loadMap(new Uint8Array(readFileSync(join(MAPS_DIR, f))));
      expect(loaded.scenarioInfo).toMatchObject({ compression: "pkware", encrypted: true, sectorSize: 4096 });
      const scn = parseScenario(loaded.chk);
      const extras = await readExtras(loaded.archive!, loaded.files);
      const kept = defaultSaveOptions(scn, loaded.scenarioInfo, f);
      expect(kept).toMatchObject({ compression: "pkware", encrypt: true, format: "scx" });
      const out = await loadMap(await buildMapFile(scn, extras, kept));
      expect(out.chk).toEqual(loaded.chk);
      expect(out.scenarioInfo).toMatchObject({ compression: "pkware", encrypted: true, sectorSize: 4096 });
      // Compressed by us within a third of Blizzard's own size either way.
      expect(out.scenarioInfo!.storedSize).toBeLessThan(loaded.scenarioInfo!.storedSize * 1.34);

      const small = SAVE_PRESETS.smallest(kept);
      const plan = planSave(scn, extras, small);
      for (const req of requiredSections(scn.fileVersion)) expect(plan.file.sections.some((s) => s.name === req)).toBe(true);
      const smaller = await loadMap(await buildMapFile(scn, extras, small, plan));
      const back = parseScenario(smaller.chk);
      expect(back.units.length).toBe(scn.units.length);
      expect(back.triggers.length).toBe(scn.triggers.length);
      expect(back.isom).toBeNull();
      expect(smaller.scenarioInfo!.storedSize).toBeLessThan(out.scenarioInfo!.storedSize);
    });
  }
});
