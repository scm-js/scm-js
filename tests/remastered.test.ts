// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openArchives, readerFor } from "../src/gamedata/archives";
import { ExtractError, extractGameData } from "../src/gamedata/extract";
import { extractRemastered, installRootOf, pickedFilesSource, type RemasteredStorage } from "../src/gamedata/remastered";
import { isProfileId, isRemasteredOrigin, REMASTERED_PROFILE } from "../src/gamedata/profiles";

/**
 * A storage over a lookup by member path, counting what is read and how many reads run at
 * once. A real storage takes either slash; the lookup is asked with the archives' backslash.
 */
function storageOver(lookup: (member: string) => Uint8Array | null, options: { absent?: (path: string) => boolean; hasNames?: boolean } = {}) {
  const reads: string[] = [];
  let running = 0;
  let peak = 0;
  const read = (name: string) => lookup(name.replaceAll("/", "\\"));
  const storage: RemasteredStorage = {
    build: { version: "1.23.10.13515" },
    hasNames: options.hasNames ?? true,
    fileInfo: (name) => (read(name) ? { installed: !options.absent?.(name) } : null),
    async readFile(name) {
      reads.push(name);
      peak = Math.max(peak, ++running);
      await Promise.resolve();
      running--;
      return read(name)!;
    },
  };
  return { storage, reads, peak: () => peak };
}

describe("a folder that is not StarCraft: Remastered", () => {
  it("is refused when the storage has no file names", async () => {
    const { storage } = storageOver(() => new Uint8Array(1), { hasNames: false });
    await expect(extractRemastered(storage)).rejects.toThrow(ExtractError);
  });

  it("is refused when the storage has no unit table", async () => {
    const { storage } = storageOver(() => null);
    await expect(extractRemastered(storage)).rejects.toThrow(/not of StarCraft: Remastered/);
  });

  it("says which table is missing when the storage has some of the game and not the rest", async () => {
    const { storage } = storageOver((path) => (path === "arr\\units.dat" ? new Uint8Array(19876) : null));
    await expect(extractRemastered(storage)).rejects.toThrow(/weapons\.dat is missing/);
  });
});

describe("the installation folder in a folder pick", () => {
  it("is where .build.info is", () => {
    expect(installRootOf(["StarCraft/.build.info", "StarCraft/Data/data/data.000"])).toBe("StarCraft/");
    expect(installRootOf([".build.info", "Data/data/data.000"])).toBe("");
    expect(installRootOf(["Games\\StarCraft\\.build.info"])).toBe("Games/StarCraft/");
  });

  it("is the outermost one, and none when the pick has no installation", () => {
    expect(installRootOf(["a/b/.build.info", "a/.build.info"])).toBe("a/");
    expect(installRootOf(["StarCraft/StarDat.mpq", "StarCraft/notes.build.info"])).toBeNull();
  });

  it("serves the storage's files by their path from that folder, a range at a time", async () => {
    const blob = (text: string) => new Blob([text]);
    const source = pickedFilesSource([
      { path: "StarCraft/.build.info", file: blob("info") },
      { path: "StarCraft/Data/data/data.000", file: blob("0123456789") },
      { path: "StarCraft/Data/data/0000000005.idx", file: blob("idx") },
      { path: "StarCraft/Data/config/ab/cd/abcd", file: blob("config") },
      { path: "Elsewhere/readme.txt", file: blob("no") },
    ])!;
    const text = async (bytes: Promise<Uint8Array>) => new TextDecoder().decode(await bytes);
    expect(await text(source.read(".build.info"))).toBe("info");
    expect(await text(source.read("Data/data/data.000", 3, 4))).toBe("3456");
    expect((await source.list("Data/data")).sort()).toEqual(["0000000005.idx", "data.000"]);
    await expect(source.read("Elsewhere/readme.txt")).rejects.toThrow();
    expect(pickedFilesSource([{ path: "StarCraft/StarDat.mpq", file: blob("") }])).toBeNull();
  });
});

describe("the data set a Remastered installation becomes", () => {
  it("has an id a stored copy can be kept under", () => {
    expect(isProfileId(REMASTERED_PROFILE.id)).toBe(true);
  });

  it("is told from a 1.16 copy by where its stamp says it came from", () => {
    expect(isRemasteredOrigin("StarCraft: Remastered 1.23.10.13515")).toBe(true);
    // The desktop app adds the folder.
    expect(isRemasteredOrigin("StarCraft: Remastered 1.23.10.13515 in C:\\Program Files (x86)\\StarCraft")).toBe(true);
    expect(isRemasteredOrigin("StarDat.mpq + BrooDat.mpq")).toBe(false);
    expect(isRemasteredOrigin("https://gamedata.scmjs.dev/StarEdit.zip")).toBe(false);
    expect(isRemasteredOrigin(undefined)).toBe(false);
  });
});

/*
 * The passes, over real files. A storage is asked asynchronously and the extraction reads
 * synchronously, so `extractRemastered` runs the extraction until it asks for nothing new;
 * what that produces has to be exactly what the extraction produces when it can simply
 * read. The game's own archives stand in for the storage here — the same members under
 * the same paths — so this needs `fixtures/data/` and is skipped without it.
 */
const dataDir = join(__dirname, "..", "fixtures", "data");
const archiveNames = existsSync(dataDir) ? readdirSync(dataDir).filter((n) => /\.mpq$/i.test(n)) : [];
const haveArchives = archiveNames.some((n) => /^stardat/i.test(n)) && archiveNames.some((n) => /^broodat/i.test(n));

describe.skipIf(!haveArchives)("extracting through a storage, against the real archives", () => {
  // Each member is taken out of the archives once; every pass and both tests share the result.
  let reader: ((member: string) => Uint8Array | null) | undefined;
  const cache = new Map<string, Uint8Array | null>();
  const open = () => {
    reader ??= readerFor(openArchives(archiveNames.map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dataDir, name))) }))).archives);
    return (member: string) => {
      const key = member.toLowerCase();
      if (!cache.has(key)) cache.set(key, reader!(member));
      return cache.get(key)!;
    };
  };

  it("produces the files the extraction produces when it reads the archives itself", async () => {
    const read = open();
    const direct = extractGameData(read);
    const { storage, reads, peak } = storageOver(read);
    const fractions: number[] = [];
    const { result, problems, from } = await extractRemastered(storage, (f) => fractions.push(f));

    expect([...result.files.keys()].sort()).toEqual([...direct.files.keys()].sort());
    // Buffer.compare, not toEqual: the tile tables are megabytes, and toEqual walks them an element at a time.
    for (const [path, bytes] of direct.files) expect(Buffer.compare(result.files.get(path)!, bytes), path).toBe(0);
    expect(problems).toEqual([]);
    expect(from).toBe("StarCraft: Remastered 1.23.10.13515");

    // Nothing is read twice, and the storage is not asked for everything at once.
    expect(new Set(reads).size).toBe(reads.length);
    expect(peak()).toBeGreaterThan(1);
    expect(peak()).toBeLessThanOrEqual(24);
    // The bar only moves forward and ends full.
    expect(fractions.every((f, i) => i === 0 || f >= fractions[i - 1] - 1e-9)).toBe(true);
    expect(fractions[fractions.length - 1]).toBe(1);
  }, 60_000);

  it("reports a file the build lists and the installation lacks, and goes on without it", async () => {
    const read = open();
    const { storage } = storageOver(read, { absent: (path) => /marine\.grp$/i.test(path) });
    const { result, problems } = await extractRemastered(storage);
    expect(problems.some((p) => /marine\.grp is not installed/.test(p))).toBe(true);
    expect(result.units.manifest.missing.some((m) => /marine\.grp$/i.test(m))).toBe(true);
    expect(result.tilesets.complete).toHaveLength(8);
  }, 60_000);
});

/*
 * And over a real installation, when one is named: SCM_REMASTERED_DIR=/path/to/StarCraft.
 * Guarded with `if` rather than `skipIf` because the import below needs Node's file system
 * and the installation, neither of which CI has.
 */
const installDir = process.env.SCM_REMASTERED_DIR;
if (installDir) {
  describe("extracting from a real StarCraft: Remastered installation", () => {
    it("yields all eight tilesets with the longer tile tables, and every unit graphic", async () => {
      const { Storage } = await import("kascade");
      const { nodeSource } = await import("kascade/node");
      const storage = await Storage.open(nodeSource(installDir));
      const { result, problems } = await extractRemastered(storage);
      expect(problems).toEqual([]);
      expect(result.tilesets.complete).toHaveLength(8);
      expect(result.units.manifest.missing).toEqual([]);
      // Remastered's megatile table is the wide one, and Badlands has the tiles it added.
      expect(result.files.has("tileset/badlands.vx4ex")).toBe(true);
      expect(result.files.get("tileset/badlands.vx4ex")!.length / 64).toBeGreaterThan(4844);
      expect(result.files.has("tileset/badlands.dddata.bin")).toBe(true);
      expect(result.files.has("tileset/stat_txt.tbl")).toBe(true);
      // The 2x pictures: one per megatile of the same tileset's table, for every tileset.
      const { parseHdTiles } = await import("../src/formats/tileset/hd");
      for (const name of ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"]) {
        const hd = parseHdTiles(result.files.get(`tileset/${name}.hd.vr4`)!);
        expect(hd, name).not.toBeNull();
        expect(hd!.count, name).toBeGreaterThanOrEqual(result.files.get(`tileset/${name}.vx4ex`)!.length / 64);
      }
      // Where the water and lava are: every tileset but the two that have neither, each
      // mask table within its own megatiles and its own masks, and the shared textures.
      const { buildHdEffects, decodeRawDds, parseDdsGrp, parseTileMasks } = await import("../src/formats/tileset/hd");
      const large = parseDdsGrp(result.files.get("tileset/water_large.hd.grp")!)!;
      const fine = parseDdsGrp(result.files.get("tileset/water_fine.hd.grp")!)!;
      const noise = decodeRawDds(result.files.get("tileset/heat_noise.hd.dds")!)!;
      expect([large.length, large[0].width, fine.length, fine[0].width, noise.width]).toEqual([45, 64, 120, 256, 64]);
      for (const name of ["badlands", "ashworld", "jungle", "desert", "ice", "twilight"]) {
        const table = parseTileMasks(result.files.get(`tileset/${name}.hd.tmsk`)!)!;
        const masks = parseHdTiles(result.files.get(`tileset/${name}.hd.mask`)!)!;
        const megatiles = result.files.get(`tileset/${name}.vx4ex`)!.length / 64;
        expect(table.size, name).toBeGreaterThan(0);
        for (const [megatile, mask] of table) {
          expect(megatile, name).toBeLessThan(megatiles);
          expect(mask, name).toBeLessThan(masks.count);
        }
        expect(buildHdEffects(name === "ashworld" ? "heat" : "water", megatiles, table, masks, { large: { bytes: new Uint8Array(0), pictures: large }, fine: { bytes: new Uint8Array(0), pictures: fine }, noise }), name).not.toBeNull();
      }
      for (const name of ["platform", "install"]) expect(result.files.has(`tileset/${name}.hd.tmsk`), name).toBe(false);
      // The 2x sprites: most of the images, each cut down to two layers and still readable,
      // with as many frames as the GRP it stands in for.
      const { animPath, parseAnim } = await import("../src/formats/dat/anim");
      const { decodeGrp } = await import("../src/formats/dat/grp");
      const { decodeImagesDat } = await import("../src/formats/dat/dat");
      const { decodeTbl } = await import("../src/formats/dat/tbl");
      const hdImages = result.units.manifest.hd ?? [];
      expect(hdImages.length).toBeGreaterThan(700);
      const images = decodeImagesDat(result.files.get("arr/images.dat")!);
      const paths = decodeTbl(result.files.get("arr/images.tbl")!);
      let compared = 0;
      for (const image of hdImages) {
        const anim = parseAnim(result.files.get(animPath(image))!);
        expect(anim, `image ${image}`).not.toBeNull();
        expect(anim!.layers.filter((l) => l.size > 0).every((l) => l.name === "diffuse" || l.name === "teamcolor"), `image ${image}`).toBe(true);
        const grpPath = paths[images.grp[image] - 1];
        const grp = grpPath ? result.files.get(`unit/${grpPath.toLowerCase().replaceAll("\\", "/")}`) : undefined;
        if (!grp) continue;
        expect(anim!.frames.length, `image ${image} (${grpPath})`).toBe(decodeGrp(grp).frames.length);
        compared++;
      }
      expect(compared).toBeGreaterThan(700);
    }, 120_000);
  });
}
