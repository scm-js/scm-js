/**
 * The mod's hash: one rule wherever it is worked out, `@scm-js/mod`'s (its own tests hold the rule itself) — here as
 * `scmjs mod info|play` and `replay --mod` and the editor's data sets come to it. A made mod (a loose game file and a
 * dot file, an MPQ of three members, a plugin, a FireGraft project and database, a read-me) is hashed here; the values
 * pinned below are what the play page's own `buildMod` gave for the same folder, so the routes are tied without
 * anyone's game files. Cosmonarchy's release, when `SCM_COSMONARCHY` names it (or `SCMJS_COSMONARCHY` the download),
 * gives the values `@scm-js/mod` pins for it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Archive, Creator } from "mopaq";
import { isSystemFile, readMod } from "@scm-js/mod";
import { modTree } from "../src/gamedata/archives";
import { dataSetMod, pickedDataSet } from "../src/gamedata/modInput";
import { openMod } from "../cli/src/mod/open";
import { sourceHash } from "../cli/src/mod/hash";
import { HANDED_MEMBERS, notLoose, playSet } from "../cli/src/mod/play";
import { unpackMod } from "../cli/src/mod/unpack";
import { packFolder } from "../cli/src/mod/pack";
import { readManifest } from "../src/formats/mod/folder";
import { isTaggedMod, sourceHashes } from "../cli/src/replaymod";
import { modInfo, printModInfo } from "../cli/src/mod/info";
import type { GameFiles } from "../cli/src/gamefiles";
import { visible } from "../cli/src/ui";

const text = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

/** The play page's `buildMod` over the made folder (scm-sim lift-ts 0215c82), 2026-11-08. */
const PAGE = { hash: "a8069f18058ec876", withoutPlugins: "ac98e7b447476c80" };

/** The made mod's files: loose ones by path in the folder, and the MPQ's members. */
const LOOSE: Record<string, string> = {
  "arr/units.dat": "a made units.dat",
  "lua/.gitignore": "*.bak",
  "plugins/x.qdp": "a plugin's bytes",
  "y.fgp": "a FireGraft project's bytes",
  "y.fgd": "FireGraft's database",
  "README.md": "notes",
};
const MEMBERS: Record<string, string> = {
  "rez\\stat_txt.tbl": "made strings",
  "sound\\made\\new.wav": "RIFF made sound",
  // (as Cosmonarchy's loader archive holds a plugin's own list: a game file, though the page leaves plugins/ out of a folder)
  "plugins\\apply": "a list a plugin reads",
};

function madeMpq(): Uint8Array {
  const mpq = new Creator({ listfile: true });
  for (const [name, data] of Object.entries(MEMBERS)) mpq.addFile(name, text(data));
  return mpq.write();
}

function madeFolder(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "scmjs-modhash-")), "Made");
  const put = (path: string, b: Uint8Array) => { mkdirSync(join(dir, path, ".."), { recursive: true }); writeFileSync(join(dir, path), b); };
  for (const [path, data] of Object.entries(LOOSE)) put(path, text(data));
  put("made.mpq", madeMpq());
  return dir;
}

describe("a made mod hashes as the play page hashes it", () => {
  it("through scmjs: opened from its folder, as a zip of the folder, and as the folder mod unpack writes", async () => {
    const dir = madeFolder();
    const source = await openMod(dir, null);
    expect([...source.files.keys()].sort()).toEqual(["arr\\units.dat", "lua\\.gitignore", "plugins\\apply", "rez\\stat_txt.tbl", "sound\\made\\new.wav"]);
    const h = await sourceHash(source);
    expect({ hash: h.hash, withoutPlugins: h.withoutPlugins }).toEqual(PAGE);
    expect({ files: h.files, plugins: h.plugins, firegraft: h.firegraft }).toEqual({ files: 5, plugins: 1, firegraft: 1 });
    // mod info prints both.
    const info = modInfo(source, h);
    expect(info).toMatchObject(PAGE);
    const lines = printModInfo(info).map(visible).join("\n");
    expect(lines).toContain(`Hash             ${PAGE.hash}`);
    expect(lines).toContain(`Without plugins  ${PAGE.withoutPlugins}`);
    // Unpacked to a folder of text and pictures and packed back in memory: the same files, the same hash.
    const unpacked = join(dir, "..", "unpacked");
    await unpackMod(source, unpacked, { base: null, palette: "jungle" });
    const again = await sourceHash(await openMod(unpacked, null));
    expect({ hash: again.hash, withoutPlugins: again.withoutPlugins }).toEqual(PAGE);
  });

  it("through the editor's data set: a picked folder, and its archive, loose files and code handed over as a plugin hands them", async () => {
    // The Game Data dialog's folder: every file picked, read in the extraction's worker by @scm-js/mod.
    const picked = Object.entries({ ...LOOSE, "made.mpq": madeMpq() }).map(([path, data]) => pickedFile(`Made/${path}`, typeof data === "string" ? text(data) : data));
    const { input } = await pickedDataSet(picked);
    const fromPick = (await readMod(modTree(dataSetMod("Made", input)!))).identity;
    expect({ hash: fromPick.hash, withoutPlugins: fromPick.withoutPlugins }).toEqual(PAGE);
    // A plugin's api.gameData.install: the archive, the loose files by member path, the plugin and FireGraft files.
    const handed = dataSetMod("Made", {
      archives: [{ name: "made.mpq", data: madeMpq() }],
      files: [{ path: "arr/units.dat", data: text(LOOSE["arr/units.dat"]) }, { path: "lua/.gitignore", data: text(LOOSE["lua/.gitignore"]) }],
      code: ["plugins/x.qdp", "y.fgp", "y.fgd"].map((p) => ({ path: p, data: text(LOOSE[p]) })),
    })!;
    const fromApi = (await readMod(modTree(handed))).identity;
    expect({ hash: fromApi.hash, withoutPlugins: fromApi.withoutPlugins }).toEqual(PAGE);
  });

  it("is what mod play hands the page: every file, the members the page would not take loose in an MPQ of their own", async () => {
    const set = await playSet(await openMod(madeFolder(), null));
    expect({ hash: set.hash, withoutPlugins: set.withoutPlugins }).toEqual(PAGE);
    expect(set.files.map((f) => f.path).sort()).toEqual(["arr/units.dat", "firegraft/y.fgd", "firegraft/y.fgp", "lua/.gitignore", "plugins/x.qdp", "rez/stat_txt.tbl", HANDED_MEMBERS, "sound/made/new.wav"].sort());
    const handed = Archive.open(set.files.find((f) => f.path === HANDED_MEMBERS)!.bytes);
    expect((handed.files() ?? []).filter((n) => !n.startsWith("("))).toEqual(["plugins\\apply"]);
    expect([notLoose("plugins\\apply"), notLoose("firegraft\\reqlist.txt"), notLoose("readme.txt"), notLoose("arr\\units.dat")]).toEqual([true, true, true, false]);
  });

  it("names a replay's mod by the hash, without plugins, or the older forms", async () => {
    const source = await openMod(madeFolder(), null);
    const h = await sourceHashes(source, null);
    expect(h.hash).toBe(PAGE.hash);
    expect(isTaggedMod(PAGE.hash, h)).toBe(true);
    expect(isTaggedMod(PAGE.withoutPlugins, h)).toBe(true);
    // The game files alone: what a replay tagged before the plugins had lines names.
    expect(isTaggedMod(h.all, h)).toBe(true);
    expect(h.all).not.toBe(PAGE.withoutPlugins);
    expect(isTaggedMod("0123456789abcdef", h)).toBe(false);
  });
});

describe("@scm-js/core's hash helpers from before @scm-js/mod (deprecated, kept)", () => {
  it("give the package's hash for the same files, and the same older form", async () => {
    const core = await import("../core/src/index");
    const files = [["arr/units.dat", LOOSE["arr/units.dat"]], ["lua/.gitignore", LOOSE["lua/.gitignore"]], ...Object.entries(MEMBERS)].map(([name, data]) => ({ name, bytes: text(data) }));
    const h = await core.modHash({ files, plugins: [{ name: "plugins/x.qdp", bytes: text(LOOSE["plugins/x.qdp"]) }], firegraft: ["y.fgp", "y.fgd"].map((n) => ({ name: n, bytes: text(LOOSE[n]) })) });
    expect({ hash: h.hash, withoutPlugins: h.withoutPlugins }).toEqual(PAGE);
    expect(h.older).toBeUndefined();
    expect(await core.dataSetHash(files)).toBe((await core.modHash({ files })).hash);
    expect(core.gameLine("\\Arr\\Units.dat", "x")).toBe("arr\\units.dat\tx");
    expect(core.pluginLine("Plugins/GPTP.qdp", "x")).toBe("plugins\\gptp.qdp\tx");
    expect(core.isFiregraftProject("Mod.FGP")).toBe(true);
    const seen = await core.modHash({ files: [...files, { name: "sound/desktop.ini", bytes: text("[ViewState]") }] });
    expect(seen.hash).toBe((await core.modHash({ files })).hash);
    expect(seen.older?.left).toEqual(["sound\\desktop.ini"]);
  });
});

/* ── An operating system's files ───────────────────────── */

const SYSTEM: Record<string, string> = { "sound/desktop.ini": "[ViewState]\r\nFolderType=Music\r\n" };

/** The rule as it was until 2026-11-09, written out: every line, sorted by name, SHA-256, sixteen hex digits. */
const ruleAsWas = (files: Record<string, string>) => sha(Object.keys(files).sort().map((n) => `${n}\t${sha(files[n])}`).join("\n")).slice(0, 16);

/** A file as a browser's folder pick hands it over. */
function pickedFile(path: string, bytes: Uint8Array): File {
  const f = new File([bytes as Uint8Array<ArrayBuffer>], path.split("/").pop()!);
  Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
}

describe("an operating system's files are not a mod's", () => {
  it("through scmjs: a folder with them loose and packed into its archive hashes as the folder without, and answers to the hash it had", async () => {
    const dir = madeFolder();
    const put = (path: string, b: Uint8Array) => { mkdirSync(join(dir, path, ".."), { recursive: true }); writeFileSync(join(dir, path), b); };
    const clean = await openMod(dir, null);
    const before = await sourceHashes(clean, null);
    expect(before.older).toEqual([]);
    // Explorer's file in a sound folder, macOS's beside a table and a plugin, and an archive packed from such a folder.
    put("sound/made/desktop.ini", text(SYSTEM["sound/desktop.ini"]));
    put("arr/.DS_Store", text("Bud1"));
    put("arr/._units.dat", text("AppleDouble"));
    put("plugins/._x.qdp", text("AppleDouble"));
    const packedFrom = new Creator({ listfile: true });
    for (const [name, data] of Object.entries(MEMBERS)) packedFrom.addFile(name, text(data));
    packedFrom.addFile("sound\\desktop.ini", text("[ViewState]"));
    put("made.mpq", packedFrom.write());
    const source = await openMod(dir, null);
    expect([...source.files.keys()].sort()).toEqual([...clean.files.keys()].sort());
    expect(source.plugins.map((p) => p.name)).toEqual(clean.plugins.map((p) => p.name));
    const h = await sourceHash(source);
    expect({ hash: h.hash, withoutPlugins: h.withoutPlugins }).toEqual(PAGE);
    expect({ files: h.files, plugins: h.plugins, firegraft: h.firegraft }).toEqual({ files: 5, plugins: 1, firegraft: 1 });
    // The hash it had without plugins: every line, written out. (With plugins it also had a line for `plugins\._x.qdp`,
    // taken for a plugin then; that form is not worked out again.)
    const was: Record<string, string> = {
      "arr\\units.dat": LOOSE["arr/units.dat"], "lua\\.gitignore": LOOSE["lua/.gitignore"], ...MEMBERS, "y.fgp": LOOSE["y.fgp"],
      "sound\\made\\desktop.ini": SYSTEM["sound/desktop.ini"], "arr\\.ds_store": "Bud1", "arr\\._units.dat": "AppleDouble", "sound\\desktop.ini": "[ViewState]",
    };
    expect(h.older?.withoutPlugins).toBe(ruleAsWas(was));
    expect(h.older?.left).toEqual(["arr\\._units.dat", "arr\\.ds_store", "sound\\desktop.ini", "sound\\made\\desktop.ini"]);
    // A replay tagged while those lines counted names the mod by that hash: still this mod. One that never had them does not.
    const hashes = await sourceHashes(source, null);
    expect(hashes.hash).toBe(PAGE.hash);
    // (and the play page's forms before the one rule, the game files alone and those that differ from a copy, with those
    // files' lines: its replays saved until 2026-11-08)
    expect(h.gameFilesOnlyWere).toBe(ruleAsWas(Object.fromEntries(Object.entries(was).filter(([n]) => !n.endsWith(".fgp")))));
    const copy: GameFiles = { folder: "copy", kind: "classic", label: "copy", read: async (n) => (n === "arr\\units.dat" ? text(LOOSE["arr/units.dat"]) : null) };
    const withCopy = await sourceHashes(source, copy);
    const changedWere = ruleAsWas(Object.fromEntries(Object.entries(was).filter(([n]) => !n.endsWith(".fgp") && n !== "arr\\units.dat")));
    expect(withCopy.older).toContain(changedWere);
    expect(isTaggedMod(changedWere, withCopy)).toBe(true);
    for (const older of [h.older!.hash, h.older!.withoutPlugins!, h.gameFilesOnlyWere!]) {
      expect(isTaggedMod(older, hashes), older).toBe(true);
      expect(isTaggedMod(older, before), older).toBe(false);
    }
    // mod info says the older hash and what it counted.
    const lines = printModInfo(modInfo(source, h)).map(visible).join("\n");
    expect(lines).toContain(`Hash             ${PAGE.hash}`);
    expect(lines).toContain(`Older hash       ${h.older!.hash} (with arr\\._units.dat, arr\\.ds_store, sound\\desktop.ini and 1 more, which the hash leaves out)`);
    expect(printModInfo(modInfo(clean, await sourceHash(clean))).map(visible).join("\n")).not.toContain("Older hash");
    // What mod play hands the page has none of them.
    const set = await playSet(source);
    expect(set.hash).toBe(PAGE.hash);
    expect(set.files.some((f) => isSystemFile(f.path))).toBe(false);
  });

  it("through scmjs: a zip made on macOS, and a mod folder Explorer has been in, hash as the mod", async () => {
    const dir = madeFolder();
    const unpacked = join(dir, "..", "unpacked");
    await unpackMod(await openMod(dir, null), unpacked, { base: null, palette: "jungle" });
    const put = (path: string, b: Uint8Array) => { mkdirSync(join(unpacked, path, ".."), { recursive: true }); writeFileSync(join(unpacked, path), b); };
    put("sounds/desktop.ini", text(SYSTEM["sound/desktop.ini"]));
    put("files/lua/Thumbs.db", text("thumbnails"));
    put("tables/.DS_Store", text("Bud1"));
    const manifest = readManifest(new TextDecoder().decode(new Uint8Array(readFileSync(join(unpacked, "mod.json")))))!;
    const packed = await packFolder(unpacked, manifest, { base: null });
    expect(packed.members.some((m) => isSystemFile(m.member))).toBe(false);
    const again = await sourceHash(await openMod(unpacked, null));
    expect({ hash: again.hash, withoutPlugins: again.withoutPlugins }).toEqual(PAGE);
  });

  it("through the editor: a picked folder's are no file and no code of the set, loose or in its archive", async () => {
    const picked = (extra: Record<string, string>, member?: string) => {
      const mpq = new Creator({ listfile: true });
      for (const [name, data] of Object.entries(MEMBERS)) mpq.addFile(name, text(data));
      if (member) mpq.addFile(member, text("[ViewState]"));
      return Object.entries({ ...LOOSE, ...extra }).map(([path, data]) => pickedFile(`Made/${path}`, text(data))).concat(pickedFile("Made/made.mpq", mpq.write()));
    };
    const hashOf = async (files: File[]) => (await readMod(modTree(dataSetMod("Made", (await pickedDataSet(files)).input)!))).identity;
    const clean = await hashOf(picked({}));
    expect(clean.hash).toBe(PAGE.hash);
    const seen = await hashOf(picked({ "sound/made/desktop.ini": SYSTEM["sound/desktop.ini"], "arr/.DS_Store": "Bud1", "plugins/._x.qdp": "AppleDouble", "__MACOSX/arr/._units.dat": "AppleDouble" }, "sound\\desktop.ini"));
    expect({ hash: seen.hash, withoutPlugins: seen.withoutPlugins }).toEqual(PAGE);
    expect(seen.older?.hash).toBeDefined();
    expect(seen.plugins).toEqual(clean.plugins);
  });
});

const cosmonarchy = process.env.SCM_COSMONARCHY ?? (process.env.SCMJS_COSMONARCHY ? join(process.env.SCMJS_COSMONARCHY, "release") : "");
const haveCosmonarchy = !!cosmonarchy && existsSync(join(cosmonarchy, "mpq", "arr", "units.datex"));

describe.skipIf(!haveCosmonarchy)("Cosmonarchy's release (SCM_COSMONARCHY)", () => {
  it("hashes as @scm-js/mod pins it: 7,767 game files, 8 modules of code and the project", { timeout: 120_000 }, async () => {
    const source = await openMod(cosmonarchy, null);
    const h = await sourceHash(source);
    expect({ hash: h.hash, withoutPlugins: h.withoutPlugins, beforeCode: h.beforeCode }).toEqual({ hash: "c94acdf31982fa4b", withoutPlugins: "db23a1f9dd8cef66", beforeCode: "20e1c6d89ae2af75" });
    expect({ files: h.files, plugins: h.plugins, firegraft: h.firegraft }).toEqual({ files: 7767, plugins: 8, firegraft: 1 });
    // The loader exe's archive lists six tileset files it does not hold: left out.
    expect(source.unheld).toHaveLength(6);
    // The dot files under the game's folders are the mod's.
    expect(source.files.has("lua\\.gitignore")).toBe(true);
  });
});
