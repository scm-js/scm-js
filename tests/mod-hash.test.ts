/**
 * The mod's hash: one rule wherever it is worked out — the play page (scm-sim `web/modDrop.ts#buildMod`), core
 * (`src/formats/mod/hash.ts`), `scmjs mod info|play` and `replay --mod`, the editor's data sets. A made mod (a loose game
 * file and a dot file, an MPQ of three members, a plugin, a FireGraft project and database, a read-me) is hashed here;
 * the values pinned below are what the play page's own `buildMod` gives for the same folder, so the two implementations
 * are tied without anyone's game files. Cosmonarchy's release, when `SCM_COSMONARCHY` names it (or
 * `SCMJS_COSMONARCHY` the download), gives the page's values for it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Archive, Creator } from "mopaq";
import { dataSetHash, isSystemFile, SYSTEM_FILES } from "../src/formats/mod/sources";
import { firegraftLine, hashLines, hashLinesAsWere, modHash, pluginLine, probeNames } from "../src/formats/mod/hash";
import { dataSetHashOf } from "../src/gamedata/overCopy";
import { isGamePath, splitPickedFiles } from "../src/gamedata/install";
import { openMod } from "../cli/src/mod/open";
import { sourceHash } from "../cli/src/mod/hash";
import { HANDED_MEMBERS, notLoose, playSet } from "../cli/src/mod/play";
import { unpackMod } from "../cli/src/mod/unpack";
import { packFolder } from "../cli/src/mod/pack";
import { readManifest } from "../src/formats/mod/folder";
import { isTaggedMod, sourceHashes } from "../cli/src/replaymod";
import { modInfo, printModInfo } from "../cli/src/mod/info";
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

describe("the mod hash's rule", () => {
  it("is SHA-256 over the sorted name<TAB>sha256 lines, sixteen hex digits; plugins under plugins\\, the project by its name", async () => {
    const lines = [pluginLine("Plugins/GPTP.qdp", "2".repeat(64)), `arr\\units.dat\t${"1".repeat(64)}`, firegraftLine("Mod.FGP", "3".repeat(64))];
    expect(lines[0]).toBe(`plugins\\gptp.qdp\t${"2".repeat(64)}`);
    expect(lines[2]).toBe(`mod.fgp\t${"3".repeat(64)}`);
    const want = sha(`arr\\units.dat\t${"1".repeat(64)}\nmod.fgp\t${"3".repeat(64)}\nplugins\\gptp.qdp\t${"2".repeat(64)}`).slice(0, 16);
    expect(await hashLines(lines)).toBe(want);
  });

  it("takes game files by game name, plugins and projects once by file name, and leaves FireGraft's database out", async () => {
    const h = await modHash({
      files: [{ name: "Arr/Units.dat", bytes: text("u") }],
      plugins: [{ name: "plugins/a.qdp", bytes: text("p") }, { name: "elsewhere/A.QDP", bytes: text("other") }],
      firegraft: [{ name: "m.fgp", bytes: text("f") }, { name: "m.fgd", bytes: text("d") }],
    });
    expect(h.lines).toEqual([`arr\\units.dat\t${sha("u")}`, `m.fgp\t${sha("f")}`]);
    expect(h.pluginLines).toEqual([`plugins\\a.qdp\t${sha("p")}`]);
    expect(h.withoutPlugins).toBe(await hashLines(h.lines));
    // Without plugins or a project the rule is dataSetHash's.
    const plain = await modHash({ files: [{ name: "arr\\units.dat", bytes: text("u") }] });
    expect(plain.hash).toBe(await dataSetHash([{ name: "arr\\units.dat", bytes: text("u") }]));
    expect(plain.withoutPlugins).toBe(plain.hash);
  });

  it("looks into an archive with no list by the play page's names and those its own tables name", () => {
    const images = (() => { const s = "terran\\made.grp\0"; const b = new Uint8Array(4 + s.length); new DataView(b.buffer).setUint16(0, 1, true); new DataView(b.buffer).setUint16(2, 4, true); b.set(text(s), 4); return b; })();
    const names = probeNames((n) => (n === "arr\\images.tbl" ? images : null));
    expect(names).toContain("unit\\terran\\made.grp");
    expect(names).toContain("arr\\units.datex");
    expect(names).toContain("tileset\\jungle.vx4ex");
    expect(names).toContain("unit\\cmdbtns\\cmdicons.grp");
  });
});

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

  it("through the editor's data set: its loose files, its archive's members, its plugins and project", async () => {
    const archive = Archive.open(madeMpq());
    const loose = new Map([["arr\\units.dat", text(LOOSE["arr/units.dat"])], ["lua\\.gitignore", text(LOOSE["lua/.gitignore"])]]);
    const listed = (archive.files() ?? []).filter((n) => !n.startsWith("("));
    const own = (name: string) => loose.get(name) ?? (() => { try { return archive.readFile(name); } catch { return null; } })();
    const code = ["plugins/x.qdp", "y.fgp", "y.fgd"].map((p) => ({ name: p, bytes: text(LOOSE[p]) }));
    const h = await dataSetHashOf([...loose.keys(), ...listed, "tileset\\jungle.cv5"], own, code);
    expect({ hash: h?.hash, withoutPlugins: h?.withoutPlugins }).toEqual(PAGE);
    expect(await dataSetHashOf([], own, code)).toBeNull();
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

/* ── An operating system's files ───────────────────────── */

/** One file of each kind the list names, by a path under a game folder (and the zip folder macOS makes). */
const SYSTEM: Record<string, string> = {
  "sound/desktop.ini": "[ViewState]\r\nFolderType=Music\r\n",
  "sound/made/Desktop.INI": "[ViewState]",
  "unit/Thumbs.db": "thumbnails",
  "unit/ehthumbs.db": "thumbnails",
  "unit/ehthumbs_vista.db": "thumbnails",
  "arr/.DS_Store": "Bud1",
  "arr/._units.dat": "AppleDouble",
  "arr/Icon\r": "",
  "lua/.directory": "[Dolphin]",
  "__MACOSX/arr/._units.dat": "AppleDouble",
  "arr/__MACOSX/units.dat": "anything under that folder",
};
/** Names that only hold one of the list's: files of the mod like any other. */
const NOT_SYSTEM = ["sound/mydesktop.ini", "sound/desktop.ini.bak", "sound/desktop.ini/voice.wav", "unit/thumbs.db.txt", "unit/xthumbs.db", "arr/.ds_store2", "arr/a._b", "arr/_.units.dat", "lua/x.directory", "arr/icon", "my__macosx/units.dat", "__macosx.dat", "samase/config.ini", "lua/.gitignore"];

/** The rule as it was until 2026-11-09, written out: every line, sorted by name, SHA-256, sixteen hex digits. */
const ruleAsWas = (files: Record<string, string>) => sha(Object.keys(files).sort().map((n) => `${n}\t${sha(files[n])}`).join("\n")).slice(0, 16);
const asGameNames = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([p, d]) => [p.replace(/\//g, "\\").toLowerCase(), d]));

describe("an operating system's files are not a mod's", () => {
  const MOD: Record<string, string> = { "arr/units.dat": "a made units.dat", "sound/made/new.wav": "RIFF made sound", "lua/.gitignore": "*.bak" };
  const digests = (files: Record<string, string>) => Object.entries(files).map(([name, data]) => ({ name, bytes: text(data) }));

  it("is told by name alone, any case and either slash; a name that only holds one is a file like any other", () => {
    for (const path of Object.keys(SYSTEM)) {
      expect(isSystemFile(path), path).toBe(true);
      expect(isSystemFile(path.toUpperCase().replace(/\//g, "\\")), path).toBe(true);
    }
    for (const path of NOT_SYSTEM) expect(isSystemFile(path), path).toBe(false);
    // Every name on the list is covered above.
    for (const name of SYSTEM_FILES.names) expect(Object.keys(SYSTEM).some((p) => p.toLowerCase().endsWith(`/${name}`)), JSON.stringify(name)).toBe(true);
  });

  it("the hash is the same with each of them and without, and other with a file that only holds the name", async () => {
    const plain = await modHash({ files: digests(MOD) });
    expect(plain.hash).toBe(ruleAsWas(asGameNames(MOD)));
    expect(plain.older).toBeUndefined();
    for (const [path, data] of Object.entries(SYSTEM)) {
      const withIt = await modHash({ files: digests({ ...MOD, [path]: data }) });
      expect(withIt.hash, path).toBe(plain.hash);
      expect(withIt.withoutPlugins, path).toBe(plain.withoutPlugins);
      expect(withIt.lines, path).toEqual(plain.lines);
      expect(await dataSetHash(digests({ ...MOD, [path]: data })), path).toBe(plain.hash);
      expect(await hashLines([...plain.lines, `${path}\t${sha(data)}`]), path).toBe(plain.hash);
    }
    for (const path of NOT_SYSTEM) {
      const withIt = await modHash({ files: digests({ ...MOD, [path]: "x" }) });
      expect(withIt.hash, path).not.toBe(plain.hash);
      expect(withIt.hash, path).toBe(ruleAsWas(asGameNames({ ...MOD, [path]: "x" })));
      expect(withIt.older, path).toBeUndefined();
    }
    // A plugin's AppleDouble half is no plugin, and a FireGraft project's is no project.
    const code = await modHash({ files: digests(MOD), plugins: [{ name: "plugins/x.qdp", bytes: text("p") }, { name: "plugins/._x.qdp", bytes: text("fork") }], firegraft: [{ name: "__MACOSX/y.fgp", bytes: text("fork") }] });
    expect(code.pluginLines).toEqual([`plugins\\x.qdp\t${sha("p")}`]);
    expect(code.lines).toEqual(plain.lines);
  });

  it("the hash as it was, with their lines, is kept beside it as the older form", async () => {
    const seen = { ...MOD, "sound/desktop.ini": SYSTEM["sound/desktop.ini"], "unit/Thumbs.db": SYSTEM["unit/Thumbs.db"] };
    const h = await modHash({ files: digests(seen), plugins: [{ name: "plugins/x.qdp", bytes: text("p") }] });
    const plain = await modHash({ files: digests(MOD), plugins: [{ name: "plugins/x.qdp", bytes: text("p") }] });
    expect({ hash: h.hash, withoutPlugins: h.withoutPlugins }).toEqual({ hash: plain.hash, withoutPlugins: plain.withoutPlugins });
    expect(h.older).toEqual({
      hash: ruleAsWas({ ...asGameNames(seen), "plugins\\x.qdp": "p" }),
      withoutPlugins: ruleAsWas(asGameNames(seen)),
      left: ["sound\\desktop.ini", "unit\\thumbs.db"],
    });
    expect(h.older!.hash).not.toBe(h.hash);
    // The rule as it was takes every line it is given.
    expect(await hashLinesAsWere(Object.entries(asGameNames(seen)).map(([n, d]) => `${n}\t${sha(d)}`))).toBe(h.older!.withoutPlugins);
  });

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
    expect([...source.system.keys()].sort()).toEqual(["arr\\._units.dat", "arr\\.ds_store", "sound\\desktop.ini", "sound\\made\\desktop.ini"]);
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
    for (const older of [h.older!.hash, h.older!.withoutPlugins, h.gameFilesOnlyWere!]) {
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

  it("through the editor: a picked folder's are no loose member and no code, and its data set hash has no line for one in an archive", async () => {
    const file = (path: string) => { const f = new File([text("x")], path.split("/").pop()!); Object.defineProperty(f, "webkitRelativePath", { value: path }); return f; };
    const split = splitPickedFiles([
      file("Mod/mpq/arr/units.dat"), file("Mod/mpq/sound/desktop.ini"), file("Mod/mpq/sound/cm/Desktop.ini"), file("Mod/mpq/unit/Thumbs.db"),
      file("Mod/mpq/arr/.DS_Store"), file("Mod/plugins/x.qdp"), file("Mod/plugins/._x.qdp"), file("Mod/__MACOSX/mpq/arr/._units.dat"), file("Mod/mpq/samase/config.ini"),
    ]);
    expect(split.files!.map((f) => f.path)).toEqual(["arr/units.dat", "samase/config.ini"]);
    expect(split.code!.map((f) => f.path)).toEqual(["plugins/x.qdp"]);
    expect([isGamePath("sound/desktop.ini"), isGamePath("sound/cm/voice.wav"), isGamePath("samase/config.ini")]).toEqual([false, true, true]);
    // An archive packed from a folder that had one: the member is listed, and is no line.
    const own = new Map([["arr\\units.dat", text("u")], ["sound\\desktop.ini", text("[ViewState]")], ["sound\\cm\\thumbs.db", text("t")]]);
    const read: string[] = [];
    const h = await dataSetHashOf(own.keys(), (n) => { read.push(n); return own.get(n) ?? null; }, [{ name: "plugins/._x.qdp", bytes: text("fork") }]);
    expect(h?.hash).toBe(await dataSetHash([{ name: "arr\\units.dat", bytes: text("u") }]));
    expect(h?.pluginLines).toEqual([]);
    expect(read).toEqual(["arr\\units.dat"]);
  });
});

const cosmonarchy = process.env.SCM_COSMONARCHY ?? (process.env.SCMJS_COSMONARCHY ? join(process.env.SCMJS_COSMONARCHY, "release") : "");
const haveCosmonarchy = !!cosmonarchy && existsSync(join(cosmonarchy, "mpq", "arr", "units.datex"));

describe.skipIf(!haveCosmonarchy)("Cosmonarchy's release (SCM_COSMONARCHY)", () => {
  it("hashes as the play page hashes it: 7,769 game files, 7 plugins and the project", { timeout: 120_000 }, async () => {
    const source = await openMod(cosmonarchy, null);
    const h = await sourceHash(source);
    expect({ hash: h.hash, withoutPlugins: h.withoutPlugins }).toEqual({ hash: "ac3f86533e4b5a31", withoutPlugins: "b13e467fb5abb298" });
    expect({ files: h.files, plugins: h.plugins, firegraft: h.firegraft }).toEqual({ files: 7769, plugins: 7, firegraft: 1 });
    // The loader exe's archive lists six tileset files it does not hold: left out.
    expect(source.unheld).toHaveLength(6);
    // The dot files under the game's folders are the mod's.
    expect(source.files.has("lua\\.gitignore")).toBe(true);
  });
});
