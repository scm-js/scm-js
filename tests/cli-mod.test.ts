/**
 * `scmjs mod`: a mod read from what it ships as (a folder, an MPQ, a self-executing exe, a zip), unpacked into a folder
 * of text and pictures that packs back into the same bytes, checked, compared, started, handed to the play page and
 * laid under the engine. Every mod here is made by the test from the codecs (no game data); the suites at the end run
 * on the person's own copy of the game (`fixtures/data`) and on Cosmonarchy's release (`SCMJS_COSMONARCHY`) when they
 * are there, and skip otherwise.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Archive } from "mopaq";
import { DAT_SCHEMAS, DAT_TABLES, type DatTableName } from "../src/formats/dat/schema";
import { decodeDat, emptyDat, encodeDat } from "../src/formats/dat/table";
import { encodeTblFile, decodeTblFile } from "../src/formats/dat/tblFile";
import { iscriptFromText } from "../src/formats/dat/iscriptText";
import { aiscriptFromText } from "../src/formats/dat/aiscript";
import { encodeLoFile } from "../src/formats/dat/loFile";
import { encodeGrpImage, frameFromPicture } from "../src/formats/dat/grpFile";
import { encodeReqGraft } from "../src/formats/dat/graft";
import { dataSetHash, exeArchive, gameName, modRoot, readZip } from "../src/formats/mod/sources";
import { readManifest } from "../src/formats/mod/folder";
import { archiveFiles, type GameFiles } from "../cli/src/gamefiles";
import { modArgs, MOD_OVERLAY, type Engine } from "../cli/src/engine";
import { modInfo, printModInfo } from "../cli/src/mod/info";
import { openMod } from "../cli/src/mod/open";
import { gameSource } from "../cli/src/mod/source";
import { unpackMod } from "../cli/src/mod/unpack";
import { packFolder, packMod, readModFolder, writeMpq } from "../cli/src/mod/pack";
import { checkModSource } from "../cli/src/mod/check";
import { diffModSources, printModDiff } from "../cli/src/mod/diff";
import { newMod } from "../cli/src/mod/new";
import { playOnPage, playSet } from "../cli/src/mod/play";
import { modOverlay } from "../cli/src/mod/overlay";
import { visible } from "../cli/src/ui";
import { cosmonarchyPath, haveCosmonarchy, haveGameArchives } from "./support/modFiles";

const root = mkdtempSync(join(tmpdir(), "scmjs-mod-"));
let n = 0;
const tmp = (name = "t") => join(root, `${name}-${++n}`);
afterAll(() => { /* the OS temp folder is the test's; nothing else is written */ });

const latin = (s: string) => new TextEncoder().encode(s);
const same = (a: Uint8Array | null | undefined, b: Uint8Array | null | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/* ── A made game and made mods ─────────────────────────────────────────── */

const PALETTE = (() => { const p = new Uint8Array(1024); for (let i = 0; i < 256; i++) { p[i * 4] = i; p[i * 4 + 1] = 255 - i; p[i * 4 + 2] = (i * 7) & 255; } return p; })();
const grp = (seed: number) => {
  const px = new Uint8Array(64);
  for (let i = 0; i < 64; i++) px[i] = (i * seed) % 5 === 0 ? 0 : 1 + ((i + seed) % 200);
  return encodeGrpImage({ width: 8, height: 8, frames: [frameFromPicture(px, 8, 8), frameFromPicture(px.map((v) => (v ? v + 1 : 0)), 8, 8)] });
};
const wav = (tone: number) => { const b = new Uint8Array(48); b.set(latin("RIFF"), 0); new DataView(b.buffer).setUint32(4, 40, true); b.set(latin("WAVEfmt "), 8); b[44] = tone; return b; };
const ISCRIPT = (wait: number) => iscriptFromText(`.headerstart\nIsId          \t0\nType          \t0\nInit          \tS0_Init\n.headerend\n\nS0_Init:\n\tplayfram          \t0x00\n\twait              \t${wait}\n\tend\n`);
const AI = aiscriptFromText(`script Test {\n    name_string 1\n    bin_file aiscript\n    broodwar_only 0\n    staredit_hidden 0\n    requires_location 0\n    entry_point Test_entry\n}\n\n--Test_entry--\nstart_town()\nwait(100)\nstop()\n`).aiscript;
const tbl = (strings: string[]) => encodeTblFile({ strings: strings.map((s) => `${s}\0`), encoding: "windows-1252" });
const table = (t: DatTableName, edit?: (f: ReturnType<typeof emptyDat>) => void, count?: number) => {
  const f = emptyDat(t, count);
  if (t === "units") for (let i = 0; i < f.count; i++) { f.columns.ground_weapon[i] = 130; f.columns.air_weapon[i] = 130; f.columns.subunit1[i] = 228; f.columns.subunit2[i] = 228; }
  edit?.(f);
  return encodeDat(f);
};

/** The made game's files, by name: every table, the string tables, a script, a picture, two sounds, the palette. */
function madeGame(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const t of DAT_TABLES) {
    files.set(DAT_SCHEMAS[t].file, table(t, (f) => {
      if (t === "images") f.columns.grp_file[0] = 1;
      if (t === "weapons") f.columns.damage_amount[0] = 6;
      if (t === "units") f.columns.ground_weapon[0] = 0;
      if (t === "sfxdata") f.columns.sound_file[69] = 1;
    }));
  }
  files.set("rez\\stat_txt.tbl", tbl(Array.from({ length: 228 }, (_, i) => (i === 0 ? "Terran Marine\0*\0Ground Units" : `Unit ${i}\0*\0Other`))));
  files.set("arr\\images.tbl", tbl(["terran\\marine.grp"]));
  files.set("arr\\sfxdata.tbl", tbl(["Bullet\\TMaFir00.wav", "Bullet\\TGoFir00.wav"]));
  files.set("scripts\\iscript.bin", ISCRIPT(1));
  files.set("unit\\terran\\marine.grp", grp(3));
  files.set("sound\\Bullet\\TMaFir00.wav", wav(1));
  files.set("sound\\Bullet\\TGoFir00.wav", wav(2));
  files.set("tileset\\jungle.wpe", PALETTE);
  return files;
}

const asGame = (files: Map<string, Uint8Array>, label = "the made game"): GameFiles => {
  const byName = new Map([...files].map(([k, v]) => [gameName(k), v]));
  return { folder: "made", kind: "classic", label, read: async (m) => byName.get(gameName(m)) ?? null };
};

/** A mod with one of each kind of file, as members. */
function madeMod(): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  const game = madeGame();
  m.set("arr\\weapons.dat", table("weapons", (f) => { f.columns.damage_amount[0] = 7; }));
  m.set("arr\\sfxdata.dat", table("sfxdata", (f) => { f.columns.sound_file[69] = 2; }));
  m.set("rez\\stat_txt.tbl", game.get("rez\\stat_txt.tbl")!);
  m.set("scripts\\iscript.bin", ISCRIPT(2));
  m.set("scripts\\aiscript.bin", AI);
  m.set("unit\\terran\\marine.grp", grp(4));
  m.set("unit\\terran\\marine.lof", encodeLoFile({ frames: [[[1, 2], [3, -4]], [[0, 0], [5, 6]]] }));
  m.set("sound\\Bullet\\TGoFir00.wav", wav(9));
  m.set("datreq\\Units.graft", encodeReqGraft({ start: 0, entries: [{ id: 1, words: [0xff02, 111, 0xffff] }] }));
  m.set("tileset\\jungle.wpe", PALETTE);
  m.set("glue\\readme.bin", latin("anything at all"));
  return m;
}

function writeFolder(dir: string, files: Map<string, Uint8Array>) {
  for (const [name, data] of files) { const p = join(dir, ...name.split("\\")); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, data); }
}

/** A Windows program of 0x300 bytes: one section, its raw data to 0x300. */
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
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

async function zip(entries: { path: string; data: Uint8Array; deflate?: boolean }[]): Promise<Uint8Array> {
  const locals: Uint8Array[] = [], central: Uint8Array[] = [];
  let at = 0;
  for (const e of entries) {
    const body = e.deflate ? new Uint8Array(await new Response(new Blob([e.data]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()) : e.data;
    const name = latin(e.path);
    const local = new Uint8Array(30 + name.length); const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, e.deflate ? 8 : 0, true); lv.setUint32(18, body.length, true); lv.setUint32(22, e.data.length, true); lv.setUint16(26, name.length, true); local.set(name, 30);
    const c = new Uint8Array(46 + name.length); const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, e.deflate ? 8 : 0, true); cv.setUint32(20, body.length, true); cv.setUint32(24, e.data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, at, true); c.set(name, 46);
    locals.push(local, body); central.push(c);
    at += local.length + body.length;
  }
  const dir = concat(...central);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, dir.length, true); ev.setUint32(16, at, true);
  return concat(...locals, dir, end);
}

const members = (m: Map<string, Uint8Array>) => [...m].map(([member, data]) => ({ member, data }));

/* ── Reading what a mod ships as ───────────────────────────────────────── */

describe("scmjs mod info: what a mod ships as", () => {
  it("finds the game's paths at a folder's root or one folder down, and the archive in a self-executing exe", async () => {
    expect(modRoot(["mpq/arr/units.dat", "mpq/unit/x.grp", "README.md"])).toBe("mpq");
    expect(modRoot(["arr/units.dat", "unit/terran/marine.grp"])).toBe("");
    const mpq = await writeMpq(members(madeMod()), "zlib");
    const plugin = latin("PLUGINBYTES!");
    const overlay = new Uint8Array(24); const ov = new DataView(overlay.buffer);
    ov.setUint32(0, 0x46474550, true); ov.setUint32(4, 1, true); ov.setUint32(8, 1, true); ov.setUint32(12, 0xfc724f8c, true); ov.setUint32(16, plugin.length, true);
    const firegraft = concat(program(), overlay, plugin, mpq);
    expect(exeArchive(firegraft)).toMatchObject({ kind: "firegraft", at: 0x300 + 24 + plugin.length, plugins: [{ id: 0xfc724f8c, size: plugin.length }] });
    const sempq = concat(program(), new Uint8Array(0x100), mpq);
    expect(exeArchive(sempq)).toMatchObject({ kind: "sempq", at: 0x400, plugins: [] });
    expect(exeArchive(program())).toBeNull();
  });

  it("reads a folder, an MPQ, an exe and a zip alike, and names what each carries", async () => {
    const mod = madeMod();
    const mpqBytes = await writeMpq(members(mod), "pkware");
    const folder = tmp("folder");
    writeFolder(join(folder, "mpq"), mod);
    mkdirSync(join(folder, "plugins"));
    writeFileSync(join(folder, "plugins", "gptp.qdp"), latin("not run"));
    writeFileSync(join(folder, "README.md"), "notes");
    const mpq = join(root, "made.mpq"); writeFileSync(mpq, mpqBytes);
    const exe = join(root, "Made Mod.exe"); writeFileSync(exe, concat(program(), new Uint8Array(0x100), mpqBytes));
    const z = join(root, "made.zip"); writeFileSync(z, await zip([...mod].map(([name, data], i) => ({ path: `Made/${name.replace(/\\/g, "/")}`, data, deflate: i % 2 === 0 }))));
    for (const path of [folder, mpq, exe, z]) {
      const r = modInfo(await openMod(path, null));
      expect(r.files, path).toBe(mod.size);
      expect(r.kinds.tables?.files, path).toBe(2);
      expect(r.kinds.AI?.files, path).toBe(1);
      expect(r.scripts, path).toEqual(["scripts\\aiscript.bin", "scripts\\iscript.bin"]);
    }
    const fromFolder = modInfo(await openMod(folder, null));
    expect(fromFolder.plugins).toEqual([{ name: "gptp.qdp", bytes: 7 }]);
    expect(fromFolder.left).toEqual(["README.md"]);
    expect(fromFolder.layers).toEqual(["mpq/"]);
    const fromExe = modInfo(await openMod(exe, null));
    expect(fromExe.kind).toBe("exe");
    expect(fromExe.exes[0]).toMatchObject({ kind: "sempq", at: 0x400 });
    expect(fromExe.name).toBe("Made Mod");
    const lines = printModInfo(fromExe).map(visible).join("\n");
    expect(lines).toMatch(/^Made Mod\nA mod for StarCraft 1\.16\.1, from a self-executing mod/);
    expect(lines).toContain("MPQDraft's self-executing MPQ");
    // An extended table is named with its layout and width.
    const wide = new Map([["arr\\units.datex", table("units", undefined, 300).subarray(0, 0)]]);
    wide.set("arr\\units.datex", new Uint8Array(300 * 99));
    const wideMpq = join(root, "wide.mpq"); writeFileSync(wideMpq, await writeMpq(members(wide), "zlib"));
    expect(modInfo(await openMod(wideMpq, null)).extended).toEqual(["units.datex: 300 entries (the game's 228), GPTP's .datex layout"]);
    // A zip's members read whether stored or deflated.
    const read = readZip(readFileSync(z));
    expect(await read[0].read()).toEqual(mod.get([...mod.keys()][0]));
  });
});

/* ── The folder ────────────────────────────────────────────────────────── */

describe("scmjs mod unpack / pack", () => {
  it("writes each file as text or a picture that packs back to the same bytes, and the same MPQ every time", async () => {
    const mod = madeMod();
    const mpq = join(root, "roundtrip.mpq"); writeFileSync(mpq, await writeMpq(members(mod), "zlib"));
    const dir = tmp("unpacked");
    const r = await unpackMod(await openMod(mpq, null), dir);
    expect(r.forms).toMatchObject({ table: 2, strings: 1, iscript: 1, ai: 1, overlay: 1, graphics: 1, sound: 1, graft: 1, file: 2 });
    expect(r.kept).toEqual([]);
    expect(r.names).toBe("mod");
    for (const f of ["tables/weapons.txt", "tables/sfxdata.txt", "strings/stat_txt.txt", "iscript/iscript.txt", "ai/aiscript.txt", "overlays/unit/terran/marine.lof.txt", "graphics/unit/terran/marine.png", "sounds/sound/Bullet/TGoFir00.wav", "grafts/Units.txt", "files/glue/readme.bin", "files/tileset/jungle.wpe", "mod.json"]) expect(existsSync(join(dir, f)), f).toBe(true);
    // The texts are PyMS's: PyDAT's entries, PyTBL's escapes, PyLO's frames.
    const weapons = readFileSync(join(dir, "tables/weapons.txt"), "utf8");
    expect(weapons).toMatch(/^Weapon\(0\):\n\tlabel 0\n\tgraphics 0\n/);
    expect(weapons).toContain("\tdamage_amount 7\n");
    expect(readFileSync(join(dir, "strings/stat_txt.txt"), "utf8").split("\n")[0]).toBe("Terran Marine<0>*<0>Ground Units<0>");
    expect(readFileSync(join(dir, "overlays/unit/terran/marine.lof.txt"), "utf8")).toBe("Frame:\n    (1, 2)\n    (3, -4)\n\nFrame:\n    (0, 0)\n    (5, 6)\n\n");
    const manifest = await readModFolder(dir);
    expect(manifest).toMatchObject({ scmjs: 1, name: "roundtrip", base: "1.16.1", palette: "jungle", names: "mod", tables: { weapons: { file: "arr\\weapons.dat", layout: "dat", entries: 130 } }, encodings: { "strings/stat_txt.txt": "utf-8" }, kept: [] });

    const packed = await packFolder(dir, manifest);
    expect(packed.members.map((m) => m.member).sort()).toEqual([...mod.keys()].sort());
    for (const m of packed.members) expect(same(m.data, mod.get(m.member)), m.member).toBe(true);
    const a = await packMod(dir, manifest, { out: join(root, "a.mpq") });
    const b = await packMod(dir, manifest, { out: join(root, "b.mpq") });
    expect(same(readFileSync(a.path), readFileSync(b.path))).toBe(true);
    expect(a).toMatchObject({ form: "mpq", members: mod.size, compression: "zlib", left: [] });
    const archive = Archive.open(new Uint8Array(readFileSync(a.path)));
    expect(archive.files()!.sort()).toEqual([...mod.keys()].sort());
    for (const [name, data] of mod) expect(same(archive.readFile(name), data), name).toBe(true);
    const loose = await packMod(dir, manifest, { folder: tmp("loose") });
    expect(same(readFileSync(join(loose.path, "unit", "terran", "marine.grp")), mod.get("unit\\terran\\marine.grp"))).toBe(true);
    // Unpacking the packed MPQ again gives the same folder text.
    const again = tmp("again");
    await unpackMod(await openMod(a.path, null), again);
    expect(readFileSync(join(again, "ai/aiscript.txt"), "utf8")).toBe(readFileSync(join(dir, "ai/aiscript.txt"), "utf8"));
  });

  it("changes only the member whose text was edited", async () => {
    const mpq = join(root, "edit.mpq"); writeFileSync(mpq, await writeMpq(members(madeMod()), "zlib"));
    const dir = tmp("edit");
    await unpackMod(await openMod(mpq, null), dir);
    const file = join(dir, "tables/weapons.txt");
    writeFileSync(file, readFileSync(file, "utf8").replace("\tdamage_amount 7\n", "\tdamage_amount 12\n"));
    writeFileSync(join(dir, "files/glue/added.bin"), "new");
    const packed = await packFolder(dir, await readModFolder(dir));
    const byName = new Map(packed.members.map((m) => [m.member, m.data]));
    expect(decodeDat("weapons", byName.get("arr\\weapons.dat")!).columns.damage_amount[0]).toBe(12);
    expect(same(byName.get("arr\\sfxdata.dat"), madeMod().get("arr\\sfxdata.dat"))).toBe(true);
    expect(new TextDecoder().decode(byName.get("glue\\added.bin"))).toBe("new");
    writeFileSync(file, "Weapon(0):\n\tdamage_amount lots\n");
    await expect(packFolder(dir, await readModFolder(dir))).rejects.toThrow(/tables\/weapons\.txt:2: expected an entry header/);
  });

  it("keeps as bytes what does not come back the same, and says why", async () => {
    const mod = new Map<string, Uint8Array>();
    // Two equal frames written apart: the pictures read the same, the game's encoder would share them.
    const one = encodeGrpImage({ width: 4, height: 4, frames: [frameFromPicture(new Uint8Array(16).fill(5), 4, 4)] });
    const v = new DataView(one.buffer);
    const offset = v.getUint32(6 + 4, true), size = one.length - offset;
    const two = new Uint8Array(6 + 16 + size * 2); const tv = new DataView(two.buffer);
    tv.setUint16(0, 2, true); tv.setUint16(2, 4, true); tv.setUint16(4, 4, true);
    for (const f of [0, 1]) { two.set(one.subarray(6, 14), 6 + f * 8); tv.setUint32(6 + f * 8 + 4, 22 + f * size, true); two.set(one.subarray(offset), 22 + f * size); }
    mod.set("unit\\split.grp", two);
    mod.set("arr\\units.dat", new Uint8Array(7));
    mod.set("tileset\\jungle.wpe", PALETTE);
    const mpq = join(root, "kept.mpq"); writeFileSync(mpq, await writeMpq(members(mod), "zlib"));
    const dir = tmp("kept");
    const r = await unpackMod(await openMod(mpq, null), dir);
    expect(r.kept.map((k) => [k.why.replace(/:.*/, ""), k.files])).toEqual([
      ["another encoder wrote it", ["files/unit/split.grp"]],
      ["not read as the table", ["files/arr/units.dat"]],
    ]);
    const packed = await packFolder(dir, await readModFolder(dir));
    for (const m of packed.members) expect(same(m.data, mod.get(m.member)), m.member).toBe(true);
  });

  it("starts an empty mod, and refuses a folder that is there", async () => {
    const dir = tmp("new");
    const r = await newMod(dir, "My Mod");
    expect(r.files).toEqual(["mod.json", "README.md"]);
    expect(readManifest(readFileSync(join(dir, "mod.json"), "utf8"))).toMatchObject({ scmjs: 1, name: "My Mod", base: "1.16.1" });
    expect(readFileSync(join(dir, "README.md"), "utf8").split("\n").filter((l) => l.trim()).length).toBe(2);
    await expect(newMod(dir)).rejects.toThrow(/is there and is not empty/);
    writeFolder(join(dir, "files"), new Map([["arr\\units.dat", table("units", (f) => { f.columns.hit_points[0] = 45 * 256; })]]));
    const packed = await packMod(dir, await readModFolder(dir), { out: join(root, "new.mpq") });
    expect(packed.members).toBe(1);
    await expect(unpackMod(await openMod(join(root, "new.mpq"), null), root)).rejects.toThrow(/is there and is not an unpacked mod/);
  });
});

/* ── Check, diff ───────────────────────────────────────────────────────── */

describe("scmjs mod check", () => {
  it("finds nothing in the game itself, and exactly a dangling weapon and a missing GRP in a mod that has them", async () => {
    const game = madeGame();
    const base = asGame(game);
    const gameDir = tmp("game"); writeFolder(gameDir, game);
    expect((await checkModSource(await openMod(gameDir, base), base)).findings).toEqual([]);
    const broken = new Map<string, Uint8Array>([
      ["arr\\units.dat", table("units", (f) => { f.columns.ground_weapon[0] = 0; f.columns.ground_weapon[1] = 200; })],
      ["arr\\images.dat", table("images", (f) => { f.columns.grp_file[0] = 1; f.columns.grp_file[5] = 2; })],
      ["arr\\images.tbl", tbl(["terran\\marine.grp", "custom\\nothere.grp"])],
    ]);
    const dir = tmp("broken"); writeFolder(dir, broken);
    const r = await checkModSource(await openMod(dir, base), base);
    expect(r.findings.map((f) => [f.rule, f.where])).toEqual([["dangling", "units 1 (Unit 1) ground_weapon"], ["grp-missing", "images 5 grp_file"]]);
    expect(r.failed).toBe(true);
    expect(r.findings[0].why).toBe("points at weapons 200, past the 130 entries weapons.dat has");
    // Without a copy of the game: an image the mod added is judged by the mod's files alone.
    const alone = new Map(broken);
    alone.set("arr\\images.dat", table("images", (f) => { f.columns.grp_file[999] = 2; }, 1000));
    alone.set("scripts\\iscript.bin", ISCRIPT(1));
    alone.set("arr\\weapons.dat", table("weapons"));
    const dir2 = tmp("alone"); writeFolder(dir2, alone);
    const r2 = await checkModSource(await openMod(dir2, null), null);
    expect(r2.findings.map((f) => [f.rule, f.where])).toEqual([["dangling", "units 1 ground_weapon"], ["grp-missing", "images 999 grp_file"]]);
    expect(r2.notes.join(" ")).toMatch(/No copy of StarCraft was found/);
  });
});

describe("scmjs mod diff", () => {
  it("reads as a changelog: weapons through the units that carry them, sounds by file, scripts by animation, files counted", async () => {
    const base = asGame(madeGame());
    const dir = tmp("diff"); writeFolder(dir, madeMod());
    const r = await diffModSources(await openMod(dir, base), null, base);
    const text = r.changes.map((c) => c.text);
    expect(text).toContain("Terran Marine: ground weapon damage 6 → 7");
    expect(text).toContain("sound 69 → Bullet\\TGoFir00.wav");
    expect(text).toContain("iscript: Terran Marine's Init animation changed");
    expect(text).toContain("1 picture changed");
    expect(text).toContain("1 sound changed");
    expect(text).toContain("AI: aiscript.bin added");
    const lines = printModDiff(r).map(visible);
    expect(lines[0]).toMatch(/^the made game → .* · \d+ changes$/);
    expect(lines).toContain("Tables");
    const self = await diffModSources(await openMod(dir, base), await openMod(dir, base), base);
    expect(self.same).toBe(true);
  });
});

/* ── Play, test ────────────────────────────────────────────────────────── */

describe("scmjs mod play", () => {
  it("hands the play page the files that differ from the game, with the data set's hash", async () => {
    process.env.BROWSER = "none";
    const base = asGame(madeGame());
    const dir = tmp("play"); writeFolder(dir, madeMod());
    const set = await playSet(await openMod(dir, base), base);
    // The stat_txt.tbl and palette are the game's own: not handed over.
    expect(set.same).toBe(2);
    expect(set.files.map((f) => f.path)).toContain("arr/weapons.dat");
    expect(set.files.map((f) => f.path)).not.toContain("rez/stat_txt.tbl");
    expect(set.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(set.hash).toBe(await dataSetHash(set.files.map((f) => ({ name: f.name, bytes: f.bytes }))));
    let page = "";
    const map = { name: "melee.scx", bytes: latin("a map") };
    const done = playOnPage(set, { map, play: "http://play.test/", onAddress: (a) => { page = a; }, timeout: 10_000 });
    while (!page) await new Promise((r) => setTimeout(r, 10));
    const html = await (await fetch(page)).text();
    expect(html).toContain("handoff=1");
    expect(html).toContain('type: "scmjs.play", dataSet: { name: m.name, hash: m.hash, files }');
    const manifest = await (await fetch(`${page}/manifest`)).json();
    expect(manifest).toEqual({ name: set.name, hash: set.hash, files: set.files.map((f) => ({ path: f.path, size: f.bytes.length })), map: "melee.scx" });
    expect(new Uint8Array(await (await fetch(`${page}/file/0`)).arrayBuffer())).toEqual(set.files[0].bytes);
    expect(new TextDecoder().decode(new Uint8Array(await (await fetch(`${page}/map`)).arrayBuffer()))).toBe("a map");
    await fetch(`${page}/message`, { method: "POST", body: JSON.stringify({ type: "scmjs.play.started", name: "melee.scx" }) });
    expect(await done).toMatchObject({ started: true, error: null });
  });

  it("says the play page's refusal", async () => {
    process.env.BROWSER = "none";
    const dir = tmp("refused"); writeFolder(dir, madeMod());
    const set = await playSet(await openMod(dir, null), null);
    expect(set.against).toBeNull();
    expect(set.files.length).toBe(madeMod().size);
    let page = "";
    const done = playOnPage(set, { play: "http://play.test/", onAddress: (a) => { page = a; }, timeout: 10_000 });
    while (!page) await new Promise((r) => setTimeout(r, 10));
    await fetch(`${page}/message`, { method: "POST", body: JSON.stringify({ type: "scmjs.play.error", message: "Not this mod" }) });
    expect(await done).toMatchObject({ started: false, error: "Not this mod" });
  });
});

describe("scmjs mod test and --mod", () => {
  const engine = (mods: number): Engine => ({ dir: "/engine", build: "abc", runner: "run.mjs", runners: { map: "map.mjs" }, fetched: 0, mods });

  it("lays a mod under the game only for runners that take one, and says which version that is", async () => {
    expect(modArgs(engine(0), null)).toEqual([]);
    expect(() => modArgs(engine(0), "/x")).toThrow(`--mod needs runners of mod overlay version ${MOD_OVERLAY} or newer`);
    expect(modArgs(engine(MOD_OVERLAY), "/x")).toEqual(["--mod", "/x"]);
  });

  it("writes the mod's files in the game's paths for the runner, and removes them after", async () => {
    const dir = tmp("overlay"); writeFolder(dir, madeMod());
    const overlay = modOverlay(dir, async () => null);
    const folder = await overlay.folder();
    expect(same(readFileSync(join(folder, "arr", "weapons.dat")), madeMod().get("arr\\weapons.dat"))).toBe(true);
    overlay.remove();
    expect(existsSync(folder)).toBe(false);
  });
});

/* ── The person's own game, and Cosmonarchy ────────────────────────────── */

describe.skipIf(!haveGameArchives)("the game's own data (fixtures/data)", () => {
  const files = haveGameArchives ? archiveFiles(join(import.meta.dirname, "..", "fixtures", "data")) : null!;
  const names = async () => {
    const out: string[] = DAT_TABLES.map((t) => DAT_SCHEMAS[t].file);
    out.push("rez\\stat_txt.tbl", "arr\\images.tbl", "arr\\sfxdata.tbl", "arr\\portdata.tbl", "arr\\mapdata.tbl", "rez\\network.tbl", "scripts\\iscript.bin", "scripts\\aiscript.bin", "scripts\\bwscript.bin", "tileset\\jungle.wpe");
    for (const p of new Set(decodeTblFile((await files.read("arr\\images.tbl"))!).strings.map((s) => s.replace(/\0+$/, "")))) out.push(`unit\\${p}`);
    for (const p of ["game\\tunit.pcx", "game\\tselect.pcx", "game\\tminimap.pcx", "game\\tblink.pcx", "game\\thpbar.pcx", "unit\\cmdbtns\\ticon.pcx"]) out.push(p);
    for (const t of ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"]) for (const f of ["ofire", "gfire", "bfire", "bexpl", "dark", "shift", "trans50", "light"]) out.push(`tileset\\${t}\\${f}.pcx`);
    return out;
  };

  it("unpacks every data member to text and pictures and packs each back byte for byte", { timeout: 180_000 }, async () => {
    const source = await gameSource(files, await names());
    const dir = tmp("game-data");
    const r = await unpackMod(source, dir, { base: files });
    expect(r.kept).toEqual([]);
    expect(r.forms).toMatchObject({ table: 11, iscript: 1, ai: 2, overlay: 96 });
    expect(r.forms.graphics).toBeGreaterThanOrEqual(832);
    const packed = await packFolder(dir, await readModFolder(dir), { base: files });
    expect(packed.members.length).toBe(source.files.size);
    const byName = new Map(packed.members.map((m) => [gameName(m.member), m.data]));
    for (const [name, f] of source.files) expect(same(byName.get(name), await f.read()), name).toBe(true);
  });

  it("finds nothing to say about the game's own data", { timeout: 60_000 }, async () => {
    const source = await gameSource(files, await names());
    const r = await checkModSource(source, files);
    expect(r.findings).toEqual([]);
  });
});

describe.skipIf(!haveCosmonarchy)("Cosmonarchy's release (SCMJS_COSMONARCHY)", () => {
  it("names it and its extended tables", { timeout: 60_000 }, async () => {
    const r = modInfo(await openMod(cosmonarchyPath("release"), null));
    expect(r.name).toBe("Cosmonarchy BW");
    expect(r.exes[0]).toMatchObject({ kind: "firegraft" });
    expect(r.extended).toContain("units.datex: 3,000 entries (the game's 228), GPTP's .datex layout");
    expect(r.extended).toContain("sfxdata.dat: 20,000 entries (the game's 1,144), DatExtend's expanded layout (PyMS)");
    expect(r.plugins.map((p) => p.name)).toContain("gptp.qdp");
    expect(r.firegraft.map((p) => p.name).sort()).toEqual(["1161.fgd", "Cosmonarchy BW.fgp"]);
  });
});
