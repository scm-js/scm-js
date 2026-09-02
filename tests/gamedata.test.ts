import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openArchives, readerFor } from "../src/gamedata/archives";
import { describeExtraction, ExtractError, extractGameData, extractTilesets, extractUnits, TILESET_NAMES } from "../src/gamedata/extract";
import { pickArchives } from "../src/gamedata/install";
import { fromUrl, locateGameData, normalizeBase, type LocateDeps } from "../src/gamedata/source";
import type { StoredCopy } from "../src/gamedata/store";

const DATA = join(__dirname, "..", "fixtures", "data");
const PUBLIC = join(__dirname, "..", "public");
const archives = existsSync(DATA) ? readdirSync(DATA).filter((n) => /\.mpq$/i.test(n)) : [];
const haveArchives = archives.some((n) => /^stardat/i.test(n)) && archives.some((n) => /^broodat/i.test(n));

/* ── Extraction ─────────────────────────────────────────── */

describe.skipIf(!haveArchives)("extraction against the real archives", () => {
  const opened = openArchives(archives.map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(DATA, name))) })));
  const read = readerFor(opened.archives);

  it("opens both archives in the game's order", () => {
    expect(opened.problems).toEqual([]);
    expect(opened.archives.map((a) => a.name.toLowerCase())).toEqual(["stardat.mpq", "broodat.mpq"]);
  });

  it("extracts every tileset complete, with the shared names file", () => {
    const { complete, incomplete, manifest, files } = extractTilesets(read);
    expect(incomplete).toEqual([]);
    expect(complete).toEqual([...TILESET_NAMES]);
    expect(manifest.shared).toEqual(["stat_txt.tbl"]);
    expect(files.has("tileset/badlands.cv5")).toBe(true);
    expect(files.has("tileset/ice.dddata.bin")).toBe(true);
    expect(files.has("tileset/badlands.ofire.pcx")).toBe(true);
    // The manifest's keys keep the order the Node script always wrote: tilesets, then shared.
    expect(Object.keys(manifest)).toEqual([...TILESET_NAMES, "shared"]);
  });

  it("walks the iscripts to the same GRP set as before", () => {
    const { files, manifest } = extractUnits(read);
    expect(manifest.missing).toEqual([]);
    expect(manifest.grps.length).toBeGreaterThan(700);
    expect(manifest.overlays.length).toBeGreaterThan(50);
    expect(files.has("arr/units.dat")).toBe(true);
    expect(files.has("scripts/iscript.bin")).toBe(true);
    // The manifest keeps the game's backslashes (as `public/unit/manifest.json` always has); the file keys are URL paths.
    for (const grp of manifest.grps.slice(0, 20)) expect(files.has(`unit/${grp.replaceAll("\\", "/")}`)).toBe(true);
  });

  it("produces the same files byte for byte as public/, when that was extracted", () => {
    if (!existsSync(join(PUBLIC, "unit", "manifest.json"))) return;
    const { files } = extractGameData(read);
    let compared = 0;
    for (const [path, data] of files) {
      const onDisk = join(PUBLIC, path);
      if (!existsSync(onDisk)) continue;
      expect(Buffer.from(data).equals(readFileSync(onDisk)), path).toBe(true);
      compared++;
    }
    expect(compared).toBe(files.size);
  });

  it("describes what came out", () => {
    const x = extractGameData(read);
    expect(describeExtraction(x)).toMatch(/^8 of 8 tilesets, \d+ unit graphics$/);
    expect(x.bytes).toBeGreaterThan(20 * 1048576);
  });
});

describe("extraction over a reader with nothing in it", () => {
  const empty = () => null;

  it("reports every tileset incomplete rather than throwing", () => {
    const { complete, incomplete, files } = extractTilesets(empty);
    expect(complete).toEqual([]);
    expect(incomplete).toEqual([...TILESET_NAMES]);
    expect([...files.keys()]).toEqual(["tileset/manifest.json"]);
  });

  it("refuses the unit half with a named table", () => {
    expect(() => extractUnits(empty)).toThrow(ExtractError);
    expect(() => extractUnits(empty)).toThrow(/units\.dat is missing/);
  });

  it("refuses the original game's units.dat", () => {
    const read = (m: string) => (m.endsWith("units.dat") ? new Uint8Array(19876 - 1000) : new Uint8Array(16));
    expect(() => extractUnits(read)).toThrow(/Brood War layout/);
  });
});

/* ── Picking archives ───────────────────────────────────── */

describe("pickArchives", () => {
  const file = (name: string) => ({ name }) as File;

  it("takes the two archives out of a folder listing, StarDat first", () => {
    const picked = pickArchives([file("readme.txt"), file("broodat.mpq"), file("StarDat.mpq"), file("patch_rt.mpq"), file("Music.mpq")]);
    expect(picked.map((f) => f.name)).toEqual(["StarDat.mpq", "broodat.mpq", "patch_rt.mpq"]);
  });

  it("names what is missing", () => {
    expect(() => pickArchives([file("StarDat.mpq")])).toThrow(/BrooDat\.mpq missing/);
    expect(() => pickArchives([file("map.scx")])).toThrow(/No StarCraft archives/);
  });
});

/* ── The chain ──────────────────────────────────────────── */

const copy: StoredCopy = { where: "opfs", from: "StarDat.mpq + BrooDat.mpq", at: "2026-09-02T00:00:00Z", files: 933, bytes: 30 * 1048576, summary: "8 of 8 tilesets" };

function deps(over: Partial<LocateDeps> & { answers?: string[] } = {}): LocateDeps & { calls: string[] } {
  const answers = over.answers ?? [];
  const calls: string[] = [];
  return {
    calls,
    bundledBase: "/",
    probeManifest: async (url) => { calls.push(`manifest ${url}`); return answers.includes(url); },
    probeFile: async (url) => { calls.push(`file ${url}`); return answers.includes(url); },
    stored: async () => null,
    desktop: null,
    configuredUrl: "",
    installFromUrl: async (base) => { calls.push(`install ${base}`); return { ...copy, from: base }; },
    ...over,
  };
}

describe("locateGameData", () => {
  it("takes the bundled files first and asks nothing else", async () => {
    const d = deps({ answers: ["/tileset/manifest.json"] });
    const source = await locateGameData(d);
    expect(source.kind).toBe("bundled");
    expect(source.base).toBe("/");
    expect(d.calls).toEqual(["manifest /tileset/manifest.json"]);
  });

  it("accepts a build with only the unit half bundled", async () => {
    const source = await locateGameData(deps({ answers: ["/unit/manifest.json"] }));
    expect(source.kind).toBe("bundled");
  });

  it("then the stored copy", async () => {
    const source = await locateGameData(deps({ stored: async () => copy }));
    expect(source.kind).toBe("stored");
    expect(source.stored).toBe(copy);
    expect(source.label).toContain("30 MB");
    expect(source.tried).toEqual(["Nothing bundled with this build"]);
  });

  it("then the desktop's disk search, which makes the files bundled", async () => {
    const progress: string[] = [];
    const d = deps({
      desktop: {
        platform: "linux",
        version: "0",
        gameData: {
          status: async () => ({ status: "missing", searched: [] }),
          locate: async () => ({ status: "ready", from: "/games/StarCraft", files: 933, bytes: 1, at: "" }),
          pickFolder: async () => null,
          clear: async () => {},
          onProgress: () => () => {},
          searchDirs: async () => [],
        },
      },
    });
    const source = await locateGameData(d, (_, label) => progress.push(label));
    expect(source.kind).toBe("bundled");
    expect(source.label).toBe("Extracted from /games/StarCraft");
    expect(progress[0]).toBe("Looking for a StarCraft installation");
  });

  it("then the configured address serving the extracted tree", async () => {
    const d = deps({ configuredUrl: "https://data.example/sc", answers: ["https://data.example/sc/tileset/manifest.json"] });
    const source = await locateGameData(d);
    expect(source.kind).toBe("remote");
    expect(source.base).toBe("https://data.example/sc/");
  });

  it("or the address serving the archives, which are installed as the stored copy", async () => {
    const d = deps({ configuredUrl: "https://data.example/sc/", answers: ["https://data.example/sc/StarDat.mpq"] });
    const source = await locateGameData(d);
    expect(source.kind).toBe("stored");
    expect(source.stored?.from).toBe("https://data.example/sc/");
    expect(d.calls).toContain("install https://data.example/sc/");
  });

  it("ends at none with the reasons in order", async () => {
    const source = await locateGameData(deps({ configuredUrl: "https://data.example/none" }));
    expect(source.kind).toBe("none");
    expect(source.tried).toEqual([
      "Nothing bundled with this build",
      "No copy kept in the browser",
      "Nothing at https://data.example/none/ (neither tileset/manifest.json nor StarDat.mpq answered)",
    ]);
  });

  it("says when no address is configured", async () => {
    const source = await locateGameData(deps());
    expect(source.tried[2]).toBe("No web address configured");
  });

  it("carries a failed install on to none rather than throwing", async () => {
    const d = deps({ configuredUrl: "https://x/", answers: ["https://x/StarDat.mpq"], installFromUrl: async () => { throw new Error("CORS"); } });
    const source = await locateGameData(d);
    expect(source.kind).toBe("none");
    expect(source.tried.at(-1)).toBe("https://x/: CORS");
  });
});

describe("fromUrl and normalizeBase", () => {
  it("normalises the address to one trailing slash", () => {
    expect(normalizeBase("  https://x/y ")).toBe("https://x/y/");
    expect(normalizeBase("https://x/y/")).toBe("https://x/y/");
    expect(normalizeBase("")).toBe("");
  });

  it("answers null and a reason when nothing is there", async () => {
    const tried: string[] = [];
    expect(await fromUrl(deps(), "https://x/", tried)).toBeNull();
    expect(tried).toEqual(["Nothing at https://x/ (neither tileset/manifest.json nor StarDat.mpq answered)"]);
  });
});
