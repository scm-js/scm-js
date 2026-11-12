/**
 * A copy of the game in what was handed over is not the mod. A folder that directly holds a `StarDat.mpq` is a copy
 * of the game: its own archives (`GAME_ARCHIVES`) and everything under its `Maps` folder are left out, unread
 * (`gameCopyFiles` in core); the archives among them are said (`ModSource.gameCopy` on the command line), any other file
 * there (a map, a campaign's music) is left out as any file outside the mod is. Found with Cosmonarchy handed over as
 * its download's root, `Release/` beside a whole 1.16.1 `Starcraft/`: the game's archives became layers of the mod. Every archive here is made by the test (tiny files named as the game's, none of the game's bytes); the
 * last suite reads that folder itself where `SCMJS_COSMONARCHY_HANDED` names it (it reads a gigabyte, about a minute)
 * and skips otherwise.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Creator } from "mopaq";
import { GAME_ARCHIVES, gameCopyFiles } from "@scm-js/mod";
import { openMod } from "../cli/src/mod/open";
import { sourceHash } from "../cli/src/mod/hash";
import { modInfo, printModInfo } from "../cli/src/mod/info";
import { unpackMod } from "../cli/src/mod/unpack";
import { readManifest } from "../src/formats/mod/folder";
import { CliError, visible } from "../cli/src/ui";

const text = (s: string) => new TextEncoder().encode(s);
const root = mkdtempSync(join(tmpdir(), "scmjs-gamecopy-"));
let n = 0;
const tmp = (name: string) => join(root, `${name}-${++n}`);

function mpq(members: Record<string, string>): Uint8Array {
  const c = new Creator({ listfile: true });
  for (const [name, data] of Object.entries(members)) c.addFile(name, text(data));
  return c.write();
}

/** A Windows program of 0x300 bytes (one section, its raw data to 0x300), and one with an archive appended (MPQDraft's). */
function program(): Uint8Array {
  const b = new Uint8Array(0x300);
  b[0] = 0x4d; b[1] = 0x5a;
  const v = new DataView(b.buffer);
  v.setUint32(0x3c, 0x40, true);
  v.setUint32(0x40, 0x00004550, true);
  v.setUint16(0x46, 1, true);
  v.setUint16(0x54, 0, true);
  v.setUint32(0x58 + 16, 0x100, true);
  v.setUint32(0x58 + 20, 0x200, true);
  return b;
}
function sempq(members: Record<string, string>): Uint8Array {
  const archive = mpq(members), out = new Uint8Array(0x400 + archive.length);
  out.set(program(), 0); out.set(archive, 0x400);
  return out;
}

/** A zip of stored members, in the order given. */
function zip(entries: { path: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let at = 0;
  for (const e of entries) {
    const name = text(e.path);
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint32(18, e.data.length, true); lv.setUint32(22, e.data.length, true); lv.setUint16(26, name.length, true); local.set(name, 30);
    const c = new Uint8Array(46 + name.length), cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint32(20, e.data.length, true); cv.setUint32(24, e.data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, at, true); c.set(name, 46);
    parts.push(local, e.data); central.push(c);
    at += local.length + e.data.length;
  }
  const dirLength = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, dirLength, true); ev.setUint32(16, at, true);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

function writeTree(dir: string, files: Record<string, Uint8Array>) {
  for (const [path, data] of Object.entries(files)) { const p = join(dir, ...path.split("/")); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, data); }
  return dir;
}

/** A mod's release as its makers ship it: a loader exe with its archive, loose files under `mpq/`, a plugin, a read-me. */
const release = (): Record<string, Uint8Array> => ({
  "Made Mod.exe": sempq({ "arr\\images.dat": "the mod's images", "rez\\stat_txt.tbl": "the mod's strings" }),
  "mpq/arr/units.dat": text("the mod's units"),
  "mpq/unit/terran/marine.grp": text("the mod's marine"),
  "plugins/gptp.qdp": text("a plugin"),
  "README.md": text("notes"),
});

/** A whole 1.16.1 copy of the game, as Cosmonarchy's download carries one: every archive named as the game's. */
const gameCopy = (): Record<string, Uint8Array> => ({
  "StarDat.mpq": mpq({ "scripts\\iscript.bin": "original StarCraft's iscript", "arr\\units.dat": "original units", "arr\\images.dat": "original images" }),
  "BrooDat.mpq": mpq({ "scripts\\iscript.bin": "Brood War's iscript", "arr\\units.dat": "Brood War's units" }),
  "patch_rt.mpq": mpq({ "scripts\\iscript.bin": "1.16.1's iscript", "rez\\network.tbl": "network" }),
  "StarCraft.mpq": mpq({ "smk\\intro.smk": "a cinematic" }),
  "BroodWar.mpq": mpq({ "smk\\ending.smk": "another" }),
  "StarCraft.exe": program(),
  "License.txt": text("licence"),
  "Maps/CMBW-Root/CMBW-editor/CMBW-editor.mpq": mpq({ "arr\\images.dat": "an editor's images" }),
  "Maps/CMBW-Root/CMBW-editor/grafting/graftc.exe": sempq({ "arr\\flingy.dat": "a tool's" }),
  "Maps/Download/a.scx": text("a map"),
});

const handed = () => {
  const files: Record<string, Uint8Array> = {};
  for (const [p, b] of Object.entries(release())) files[`Release/${p}`] = b;
  for (const [p, b] of Object.entries(gameCopy())) files[`Starcraft/${p}`] = b;
  return files;
};

const GAME_COPY_PATHS = [
  "Starcraft/BrooDat.mpq", "Starcraft/BroodWar.mpq", "Starcraft/Maps/CMBW-Root/CMBW-editor/CMBW-editor.mpq",
  "Starcraft/Maps/CMBW-Root/CMBW-editor/grafting/graftc.exe", "Starcraft/StarCraft.mpq", "Starcraft/StarDat.mpq", "Starcraft/patch_rt.mpq",
];

/** What `gameCopyFiles` names in `handed()`: the archives above, and every other file under the copy's Maps folder. */
const GAME_COPY_SET = [...GAME_COPY_PATHS, "Starcraft/Maps/Download/a.scx"].sort();

describe("gameCopyFiles", () => {
  it("names the game's archives beside a StarDat.mpq and every file under its Maps folder, at the root", () => {
    const paths = ["StarDat.mpq", "BrooDat.mpq", "patch_rt.mpq", "StarCraft.mpq", "BroodWar.mpq", "StarCraft.exe", "Local.dll", "Maps/a.scx", "Maps/x.mpq",
      "Maps/Deep/er/still/y.EXE", "Maps/z.zip", "Maps/c/campaign/Day/music/a.ogg", "Maps/x/campaign/x/arr/units.dat", "mod.mpq", "Loader.exe", "arr/units.dat", "Shaders/shader-package.zip"];
    expect([...gameCopyFiles(paths)].sort()).toEqual(["BrooDat.mpq", "BroodWar.mpq", "Maps/Deep/er/still/y.EXE", "Maps/a.scx", "Maps/c/campaign/Day/music/a.ogg", "Maps/x.mpq",
      "Maps/x/campaign/x/arr/units.dat", "Maps/z.zip", "StarCraft.mpq", "StarDat.mpq", "patch_rt.mpq"]);
    // The same paths with no StarDat.mpq beside them: none.
    expect(gameCopyFiles(paths.filter((p) => p !== "StarDat.mpq")).size).toBe(0);
    expect(GAME_ARCHIVES).toEqual(["stardat.mpq", "broodat.mpq", "patch_rt.mpq", "starcraft.mpq", "broodwar.mpq"]);
  });

  it("finds a copy a folder down or deeper, in any case, and only where a StarDat.mpq is", () => {
    const paths = ["Release/patch_rt.mpq", "Release/Maps/r.mpq", "Release/mpq/arr/units.dat", "Games/SC/STARDAT.MPQ", "Games/SC/broodat.MPQ", "games/sc/Patch_RT.mpq",
      "Games/SC/maps/m.mpq", "Games/SC/MAPS/n.exe", "Games/SC/Sub/BrooDat.mpq", "Games/SC/Mapsx/q.mpq", "Games/SC/mod.mpq", "Games/StarDat.mpq.txt", "Games/SC/Maps/readme.txt"];
    expect([...gameCopyFiles(paths)].sort()).toEqual(["Games/SC/MAPS/n.exe", "Games/SC/Maps/readme.txt", "Games/SC/STARDAT.MPQ", "Games/SC/broodat.MPQ", "Games/SC/maps/m.mpq", "games/sc/Patch_RT.mpq"]);
    expect(gameCopyFiles(["patch_rt.mpq", "BrooDat.mpq", "Maps/x.mpq"]).size).toBe(0);
    expect(gameCopyFiles([]).size).toBe(0);
  });

  it("is the same whatever order the paths come in", () => {
    const paths = Object.keys(handed());
    const forward = [...gameCopyFiles(paths)].sort(), backward = [...gameCopyFiles([...paths].reverse())].sort();
    expect(forward).toEqual(GAME_COPY_SET);
    expect(backward).toEqual(forward);
  });
});

describe("scmjs mod: a copy of the game handed over with the mod", () => {
  it("leaves the game's archives out of the mod, unread, and the mod hashes as its release alone", async () => {
    const dir = writeTree(tmp("handed"), handed());
    const whole = await openMod(dir, null), alone = await openMod(join(dir, "Release"), null);
    expect(whole.gameCopy).toEqual(GAME_COPY_PATHS);
    expect(whole.left.some((p) => GAME_COPY_PATHS.includes(p))).toBe(false);
    expect(whole.left).toContain("Starcraft/Maps/Download/a.scx");
    expect(whole.layers).toEqual(["Release/Made Mod.exe", "Release/mpq/"]);
    expect([...whole.files.keys()].sort()).toEqual([...alone.files.keys()].sort());
    expect(whole.files.has("scripts\\iscript.bin")).toBe(false);
    expect(whole.files.get("arr\\images.dat")?.layer).toBe("Release/Made Mod.exe");
    expect(whole.files.get("arr\\units.dat")?.layer).toBe("Release/mpq/");
    expect(whole.plugins.map((p) => p.layer)).toEqual(["Release/plugins/gptp.qdp"]);
    // (named after the one program at the top of the folder given: the release's own is one folder down here, so the
    // folder gives the name, and the release folder named alone is named after its program)
    expect(whole.name).toBe(dir.split("/").pop());
    expect(alone.name).toBe("Made Mod");
    const [a, b] = [await sourceHash(whole), await sourceHash(alone)];
    expect({ hash: a.hash, withoutPlugins: a.withoutPlugins, files: a.files }).toEqual({ hash: b.hash, withoutPlugins: b.withoutPlugins, files: b.files });
    expect(alone.gameCopy).toEqual([]);

    const info = modInfo(whole, a);
    expect(info.gameCopy).toEqual(GAME_COPY_PATHS);
    const lines = printModInfo(info).map(visible).join("\n");
    expect(lines).toContain("▲ Starcraft is a copy of the game. Its own archives (StarDat.mpq, BrooDat.mpq, patch_rt.mpq, StarCraft.mpq, BroodWar.mpq, CMBW-editor.mpq and 1 more) are not part of the mod and were left out.");
    expect(printModInfo(modInfo(alone, b)).map(visible).join("\n")).not.toContain("a copy of the game");

    // mod unpack says so in mod.json's notes.
    const out = tmp("unpacked");
    await unpackMod(whole, out);
    const manifest = readManifest(readFileSync(join(out, "mod.json"), "utf8"));
    expect(manifest.notes).toContain("Starcraft is a copy of the game. Its own archives (StarDat.mpq, BrooDat.mpq, patch_rt.mpq, StarCraft.mpq, BroodWar.mpq, CMBW-editor.mpq and 1 more) are not part of the mod and were left out.");
  });

  it("gives the same mod from a zip whatever order its members are in", async () => {
    const entries = Object.entries(handed()).map(([path, data]) => ({ path, data }));
    const results = [];
    for (const list of [entries, [...entries].reverse()]) {
      const z = join(tmp("zip"), "handed.zip"); mkdirSync(join(z, ".."), { recursive: true }); writeFileSync(z, zip(list));
      const source = await openMod(z, null);
      results.push({ gameCopy: source.gameCopy, files: [...source.files.keys()].sort(), hash: (await sourceHash(source)).hash });
    }
    expect(results[0].gameCopy).toEqual(GAME_COPY_PATHS);
    expect(results[1]).toEqual(results[0]);
    expect(results[0].hash).toBe((await sourceHash(await openMod(writeTree(tmp("release"), release()), null))).hash);
  });

  it("still reads a mod's own exe and archive dropped into the game's folder", async () => {
    const dir = writeTree(tmp("dropped-in"), {
      ...gameCopy(),
      "MyMod.mpq": mpq({ "arr\\units.dat": "the mod's units" }),
      "Loader.exe": sempq({ "rez\\stat_txt.tbl": "the mod's strings" }),
    });
    const source = await openMod(dir, null);
    expect(source.gameCopy.map((p) => p.split("/").pop())).toEqual(["BrooDat.mpq", "BroodWar.mpq", "CMBW-editor.mpq", "graftc.exe", "StarCraft.mpq", "StarDat.mpq", "patch_rt.mpq"]);
    expect(source.layers).toEqual(expect.arrayContaining(["Loader.exe", "MyMod.mpq"]));
    expect(source.files.get("arr\\units.dat")?.layer).toBe("MyMod.mpq");
    expect(source.files.get("rez\\stat_txt.tbl")?.layer).toBe("Loader.exe");
    expect(source.files.has("scripts\\iscript.bin")).toBe(false);
    // The copy is the folder named itself: the sentence names it by the path given.
    expect(printModInfo(modInfo(source)).map(visible).join("\n")).toContain(`▲ ${dir} is a copy of the game.`);
  });

  it("keeps patch_rt.mpq and BrooDat.mpq as the mod's in a folder without StarDat.mpq, and opens a single named one", async () => {
    const dir = writeTree(tmp("old-mod"), {
      "patch_rt.mpq": mpq({ "arr\\units.dat": "an old mod's units" }),
      "BrooDat.mpq": mpq({ "scripts\\iscript.bin": "an old mod's iscript" }),
    });
    const source = await openMod(dir, null);
    expect(source.gameCopy).toEqual([]);
    expect([...source.files.keys()].sort()).toEqual(["arr\\units.dat", "scripts\\iscript.bin"]);
    const single = await openMod(join(dir, "patch_rt.mpq"), null);
    expect(single.kind).toBe("archive");
    expect([...single.files.keys()]).toEqual(["arr\\units.dat"]);
    // Even StarDat.mpq named by itself is opened as it is: the rule is for what a folder or a zip holds.
    const stardat = join(tmp("named"), "StarDat.mpq"); mkdirSync(join(stardat, ".."), { recursive: true }); writeFileSync(stardat, gameCopy()["StarDat.mpq"]);
    expect((await openMod(stardat, null)).files.has("scripts\\iscript.bin")).toBe(true);
  });

  it("refuses a folder that is only a copy of the game, stray files and all, in words without colour", async () => {
    const installation = (): Record<string, Uint8Array> => ({
      "StarDat.mpq": gameCopy()["StarDat.mpq"], "BrooDat.mpq": gameCopy()["BrooDat.mpq"], "patch_rt.mpq": gameCopy()["patch_rt.mpq"],
      "StarCraft.exe": program(), "License.txt": text("licence"), "Local.dll": text("a library"), "lua_lsp/x.lua": text("-- a tool's"),
      "Maps/a.scx": text("a map"), "Maps/Tools/tool.exe": sempq({ "arr\\units.dat": "a tool's" }),
      "Shaders/shader-package.zip": zip([{ path: "shaders/crt.glsl", data: text("a shader") }]),
    });
    const only = writeTree(tmp("only-game"), installation());
    const refused = await openMod(only, null).then(() => null, (e: unknown) => e);
    expect(refused).toBeInstanceOf(CliError);
    expect((refused as CliError).exitCode).toBe(2);
    expect((refused as CliError).message).toBe(`${only} is a copy of the game, and there is no mod in it.`);
    const nested = writeTree(tmp("nested-game"), { "Starcraft/StarDat.mpq": gameCopy()["StarDat.mpq"], "notes.txt": text("x"), "Starcraft/Maps/b.scm": text("a map") });
    await expect(openMod(nested, null)).rejects.toThrow(/^Starcraft is a copy of the game, and there is no mod in it\.$/);
    // One loose file under the game's folders, one plugin, one archive of a mod's or a zip member under the game's
    // folders: a mod, opened.
    for (const [why, extra] of [
      ["a loose table", { "arr/units.dat": text("a mod's units") }],
      ["a plugin", { "plugins/gptp.qdp": text("a plugin") }],
      ["a mod's archive", { "MyMod.mpq": mpq({ "rez\\stat_txt.tbl": "a mod's strings" }) }],
      ["a zip of a mod's files", { "mod.zip": zip([{ path: "unit/terran/marine.grp", data: text("a mod's marine") }]) }],
    ] as [string, Record<string, Uint8Array>][]) {
      const source = await openMod(writeTree(tmp("game-and-mod"), { ...installation(), ...extra }), null);
      expect(source.gameCopy.length, why).toBe(4);
      expect(source.files.size + source.plugins.length, why).toBeGreaterThan(0);
    }
    // Under the copy's Maps folder nothing is a mod's, game folders and all (Cosmonarchy's copy keeps its campaigns at
    // Maps/CMBW-Root/CMBW-maps/campaign/…): still refused.
    const campaigns = writeTree(tmp("game-campaigns"), { ...installation(), "Maps/CMBW-maps/campaign/Day/music/a.ogg": text("music"), "Maps/x/arr/units.dat": text("a map maker's") });
    await expect(openMod(campaigns, null)).rejects.toThrow(`${campaigns} is a copy of the game, and there is no mod in it.`);
  });

  it("opens a mod laid loose in the game's folder, with the copy's Maps left out", async () => {
    const dir = writeTree(tmp("loose-in-game"), {
      "Starcraft/StarDat.mpq": gameCopy()["StarDat.mpq"], "Starcraft/arr/units.dat": text("a mod's units"),
      "Starcraft/Maps/a.scx": text("a map"), "Starcraft/Maps/c/campaign/m.ogg": text("music"),
    });
    const source = await openMod(dir, null);
    expect(source.layers).toEqual(["Starcraft/"]);
    expect([...source.files.keys()]).toEqual(["arr\\units.dat"]);
    expect(source.gameCopy).toEqual(["Starcraft/StarDat.mpq"]);
    expect(source.left).toEqual(expect.arrayContaining(["Starcraft/Maps/a.scx", "Starcraft/Maps/c/campaign/m.ogg"]));
  });
});

/**
 * Cosmonarchy handed over as its download's root on this computer: `Release/` (the mod as its makers ship it) beside
 * `Starcraft/` (a whole 1.16.1 copy). Read-only, slow (`/mnt/c` is about 10 ms a file and `temp.mpq` is ~1 GB).
 */
const handedRoot = process.env.SCMJS_COSMONARCHY_HANDED ?? "";
const haveHanded = !!handedRoot && existsSync(join(handedRoot, "Starcraft", "StarDat.mpq")) && existsSync(join(handedRoot, "Release", "mpq", "arr", "units.datex"));

describe.skipIf(!haveHanded)("Cosmonarchy handed over with a copy of the game (read-only)", () => {
  it("hashes as its release alone, with the game's archives named and left out", { timeout: 900_000 }, async () => {
    const [whole, alone] = await Promise.all([openMod(handedRoot, null), openMod(join(handedRoot, "Release"), null)]);
    const [a, b] = await Promise.all([sourceHash(whole), sourceHash(alone)]);
    const words = (s: typeof a, src: typeof whole) => ({ hash: s.hash, withoutPlugins: s.withoutPlugins, files: s.files, plugins: s.plugins, firegraft: s.firegraft, members: src.files.size });
    console.log(`Cosmonarchy handed over: ${JSON.stringify(words(a, whole))}; its release alone: ${JSON.stringify(words(b, alone))}; left out: ${whole.gameCopy.join(", ")}`);
    expect(words(a, whole)).toEqual(words(b, alone));
    expect(whole.gameCopy.map((p) => p.toLowerCase())).toEqual(expect.arrayContaining(["starcraft/stardat.mpq", "starcraft/broodat.mpq", "starcraft/patch_rt.mpq", "starcraft/starcraft.mpq", "starcraft/broodwar.mpq"]));
    expect(whole.gameCopy.every((p) => p.startsWith("Starcraft/"))).toBe(true);
    expect(whole.files.has("scripts\\iscript.bin")).toBe(alone.files.has("scripts\\iscript.bin"));
  });

  it("refuses the copy of the game alone", { timeout: 900_000 }, async () => {
    const copy = join(handedRoot, "Starcraft");
    await expect(openMod(copy, null)).rejects.toThrow(`${copy} is a copy of the game, and there is no mod in it.`);
  });
});
