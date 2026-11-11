/**
 * `scmjs mod`: a mod read from what it ships as (a folder, an MPQ, a self-executing exe, a zip), unpacked into a folder
 * of text and pictures that packs back into the same bytes, checked, compared, started, handed to the play page and
 * laid under the engine. Every mod here is made by the test from the codecs (no game data); the suites at the end run
 * on the person's own copy of the game (`fixtures/data`) and on Cosmonarchy's release (`SCMJS_COSMONARCHY`) when they
 * are there, and skip otherwise.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
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
import { archiveFiles, storageFiles, type GameFiles } from "../cli/src/gamefiles";
import { codeWords, fitWords, MOD_CODE, modArgs, MOD_OVERLAY, type Engine } from "../cli/src/engine";
import { sourceHash } from "../cli/src/mod/hash";
import { modInfo, printModInfo } from "../cli/src/mod/info";
import { checkModAndMap, gameFilesOrNull, openMod } from "../cli/src/mod/open";
import { gameSource } from "../cli/src/mod/source";
import { unpackMod } from "../cli/src/mod/unpack";
import { checkPackOut, packFolder, packMod, readModFolder, writeMpq } from "../cli/src/mod/pack";
import { checkModSource } from "../cli/src/mod/check";
import { diffModSources, printModDiff } from "../cli/src/mod/diff";
import { newMod } from "../cli/src/mod/new";
import { handoffExtra, pageRace, playBotOf, playOnPage, playSet, type PlayOptions, type PlaySet } from "../cli/src/mod/play";
import { runInNewContext } from "node:vm";
import { gameLayer, modOverlay } from "../cli/src/mod/overlay";
import { runMapInGame } from "../cli/src/trace";
import { CliError, visible } from "../cli/src/ui";
import { TEST_MAPS_DIR } from "./support/maps";
import { PassThrough } from "node:stream";
import { cosmonarchyPath, gameFile, gameImagePaths, haveCosmonarchy, haveGameArchives } from "./support/modFiles";

const root = mkdtempSync(join(tmpdir(), "scmjs-mod-"));
let n = 0;
const tmp = (name = "t") => join(root, `${name}-${++n}`);
afterAll(() => { /* the OS temp folder is the test's; nothing else is written */ });

const latin = (s: string) => new TextEncoder().encode(s);
const latinOf = (b: Uint8Array) => String.fromCharCode(...b);
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

/** What `fn` threw, for its message and exit code. */
const thrown = async (fn: () => Promise<unknown>): Promise<CliError> => {
  try { await fn(); } catch (e) { return e as CliError; }
  throw new Error("nothing was thrown");
};

describe("scmjs mod: what is not a mod", () => {
  it("says what a thing is that holds none of the game's files, in one line (exit 2)", async () => {
    const empty = tmp("emptydir"); mkdirSync(empty);
    const notes = tmp("notes"); mkdirSync(notes); writeFileSync(join(notes, "README.txt"), "hello");
    const exe = join(root, "Not A Mod.exe"); writeFileSync(exe, program());
    const replay = join(root, "a.rep"); writeFileSync(replay, concat(new Uint8Array(12), latin("seRS"), new Uint8Array(64)));
    const cases: [string, RegExp, RegExp][] = [
      [empty, /is an empty folder: there is no mod in it/, /Name a mod/],
      [notes, /holds none of the game's files: it is not a mod/, /Name a mod/],
      [exe, /has no archive in it: it is not a self-executing mod/, /Name a mod/],
      [join(TEST_MAPS_DIR, "melee.scx"), /melee\.scx is a map, not a mod/, /scmjs map info/],
      [join(root, "nope"), /No file or folder/, /Name a mod/],
    ];
    for (const [path, said, hint] of cases) {
      const e = await thrown(() => openMod(path, null));
      expect(e, path).toBeInstanceOf(CliError);
      expect(e.message, path).toMatch(said);
      expect(e.hint ?? "", path).toMatch(hint);
      expect(e.exitCode, path).toBe(2);
    }
    // A replay, said as one when its first bytes are a replay's.
    const r = await thrown(() => openMod(replay, null));
    expect(r.exitCode).toBe(2);
    expect(r.message).toMatch(/a\.rep is a replay, not a mod/);
    expect(r.hint).toMatch(/scmjs replay info/);
    // Unpacking one writes nothing: no folder, no mod.json.
    const into = tmp("up");
    await expect(openMod(empty, null).then((s) => unpackMod(s, into))).rejects.toThrow(/empty folder/);
    expect(existsSync(into)).toBe(false);
  });

  it("says a mod.json that is not JSON, and a folder that is not there, in every command", async () => {
    const mpq = join(root, "for-bad.mpq"); writeFileSync(mpq, await writeMpq(members(madeMod()), "zlib"));
    const dir = tmp("bad4");
    await unpackMod(await openMod(mpq, null), dir);
    writeFileSync(join(dir, "mod.json"), "{ not json\n");
    for (const read of [() => openMod(dir, null), () => readModFolder(dir)]) {
      const e = await thrown(read);
      expect(e).toBeInstanceOf(CliError);
      expect(e.message).toMatch(/mod\.json is not valid JSON/);
      expect(e.message).toContain(join(dir, "mod.json"));
      expect(e.exitCode).toBe(2);
    }
    expect((await thrown(() => readModFolder(join(root, "nope")))).message).toMatch(/^No folder .*nope$/);
    expect((await thrown(() => readModFolder(mpq))).message).toMatch(/is a file, not a mod folder/);
    // A mod.json that is JSON and not scmjs's (a folder of the game's files naming itself) is read as before.
    const own = tmp("named"); writeFolder(own, madeMod()); writeFileSync(join(own, "mod.json"), JSON.stringify({ name: "Named" }));
    expect((await openMod(own, null)).name).toBe("Named");
    await expect(readModFolder(own)).rejects.toThrow(/is not one scmjs wrote/);
  });

  it("says a mod and a map given the wrong way round", async () => {
    const mpq = join(root, "swapped.mpq"); writeFileSync(mpq, await writeMpq(members(madeMod()), "zlib"));
    const map = join(TEST_MAPS_DIR, "ums.scx");
    await expect(checkModAndMap(mpq, map)).resolves.toBeUndefined();
    const e = await thrown(() => checkModAndMap(map, mpq));
    expect(e.message).toMatch(/swapped\.mpq is a mod, not a map: the mod comes first/);
    expect(e.hint).toBe("scmjs mod test <mod> <map>");
    expect(e.exitCode).toBe(2);
    expect((await thrown(() => checkModAndMap(mpq, root))).message).toMatch(/is a folder, not a map/);
  });

  it("packs to standard output with --out -, and refuses what cannot be written so", async () => {
    const mpq = join(root, "piped.mpq"); writeFileSync(mpq, await writeMpq(members(madeMod()), "zlib"));
    const dir = tmp("piped");
    await unpackMod(await openMod(mpq, null), dir);
    const out = new PassThrough(); const chunks: Buffer[] = [];
    out.on("data", (c: Buffer) => chunks.push(c));
    const r = await packMod(dir, await readModFolder(dir), { out: "-", stdout: out });
    expect(r.path).toBe("-");
    expect(Buffer.concat(chunks).length).toBe(r.bytes);
    expect(Archive.open(new Uint8Array(Buffer.concat(chunks))).files()!.length).toBe(madeMod().size);
    expect(existsSync(join(process.cwd(), "-"))).toBe(false);
    // Without a stream to write to (the MCP server's standard output is its protocol), - is refused.
    await expect(packMod(dir, await readModFolder(dir), { out: "-" })).rejects.toThrow(/cannot go to standard output/);
    // A missing folder is made.
    const deep = join(root, "not", "there", "x.mpq");
    expect((await packMod(dir, await readModFolder(dir), { out: deep })).path).toBe(deep);
    expect(existsSync(deep)).toBe(true);
    const refused = (o: Parameters<typeof checkPackOut>[0]) => { try { checkPackOut(o); return null; } catch (e) { return e as CliError; } };
    expect(refused({ out: "-" })).toBeNull();
    expect(refused({ out: "a.MPQ" })).toBeNull();
    expect(refused({ folder: "loose" })).toBeNull();
    for (const [o, said] of [[{ out: "-", json: true }, /--json and the MPQ/], [{ out: "y.mpq", folder: "x" }, /not both/], [{ folder: "-" }, /cannot go to standard output/], [{ out: "rp.json" }, /\.json file; the mod is written as an \.mpq/], [{ out: "noext" }, /no extension/]] as const) {
      const e = refused(o);
      expect(e, JSON.stringify(o)).toBeInstanceOf(CliError);
      expect(e!.message).toMatch(said);
      expect(e!.exitCode).toBe(2);
    }
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
    await expect(newMod(dir)).rejects.toThrow(/is a mod folder already/);
    writeFolder(join(dir, "files"), new Map([["arr\\units.dat", table("units", (f) => { f.columns.hit_points[0] = 45 * 256; })]]));
    const packed = await packMod(dir, await readModFolder(dir), { out: join(root, "new.mpq") });
    expect(packed.members).toBe(1);
    await expect(unpackMod(await openMod(join(root, "new.mpq"), null), root)).rejects.toThrow(/The mod is inside/);
  });

  it("refuses to unpack over a mod folder unless --force, which replaces it whole", async () => {
    const mpq = join(root, "again.mpq"); writeFileSync(mpq, await writeMpq(members(madeMod()), "zlib"));
    const dir = tmp("over");
    await unpackMod(await openMod(mpq, null), dir);
    const file = join(dir, "tables/weapons.txt");
    const edited = readFileSync(file, "utf8").replace("\tdamage_amount 7\n", "\tdamage_amount 12\n");
    writeFileSync(file, edited);
    writeFileSync(join(dir, "tables/added.txt"), "mine");
    writeFileSync(join(dir, "notes.txt"), "mine");
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "HEAD"), "ref");
    // Without --force the edits stay, and the refusal says why (exit 2).
    const refused = await unpackMod(await openMod(mpq, null), dir).catch((e) => e);
    expect(refused).toBeInstanceOf(CliError);
    expect(refused.message).toMatch(/is a mod folder already/);
    expect(refused.hint).toMatch(/--force/);
    expect(refused.exitCode).toBe(2);
    expect(readFileSync(file, "utf8")).toBe(edited);
    // With it, nothing of the earlier folder survives but its dot files.
    await unpackMod(await openMod(mpq, null), dir, { force: true });
    expect(readFileSync(file, "utf8")).toContain("\tdamage_amount 7\n");
    for (const gone of ["tables/added.txt", "notes.txt"]) expect(existsSync(join(dir, gone)), gone).toBe(false);
    expect(readFileSync(join(dir, ".git", "HEAD"), "utf8")).toBe("ref");
    // An empty folder is fine; a file, or a folder holding something else, is refused even with --force.
    const empty = tmp("empty"); mkdirSync(empty);
    await unpackMod(await openMod(mpq, null), empty);
    const file2 = join(root, "a-file"); writeFileSync(file2, "x");
    for (const [target, why] of [[file2, /is a file, not a folder/], [join(file2, "under"), /a file is in its path/]] as const) {
      const e = await unpackMod(await openMod(mpq, null), target, { force: true }).catch((x) => x);
      expect(e, target).toBeInstanceOf(CliError);
      expect(e.message).toMatch(why);
      expect(e.exitCode).toBe(2);
      await expect(newMod(target)).rejects.toThrow(why);
    }
    const other = tmp("other"); mkdirSync(other); writeFileSync(join(other, "keep.txt"), "x");
    await expect(unpackMod(await openMod(mpq, null), other, { force: true })).rejects.toThrow(/is there and is not a mod folder/);
    expect(existsSync(join(other, "keep.txt"))).toBe(true);
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
  it("hands the play page every file of the mod, with the mod's hash", async () => {
    process.env.BROWSER = "none";
    const base = asGame(madeGame());
    const dir = tmp("play"); writeFolder(dir, madeMod());
    const set = await playSet(await openMod(dir, base));
    // The stat_txt.tbl and palette are the game's own and handed over all the same: the page compares, and hashes all.
    expect(set.files.map((f) => f.path)).toContain("arr/weapons.dat");
    expect(set.files.map((f) => f.path)).toContain("rez/stat_txt.tbl");
    expect(set.total.files).toBe(madeMod().size);
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
    const set = await playSet(await openMod(dir, null));
    expect(set.files.length).toBe(madeMod().size);
    let page = "";
    const said: string[] = [];
    const done = playOnPage(set, { play: "http://play.test/", onAddress: (a) => { page = a; }, timeout: 10_000, live: (l) => said.push(visible(l)) });
    while (!page) await new Promise((r) => setTimeout(r, 10));
    await fetch(`${page}/message`, { method: "POST", body: JSON.stringify({ type: "scmjs.play.error", message: "Not this mod" }) });
    expect(await done).toMatchObject({ started: false, error: "Not this mod" });
    // With BROWSER=none nothing is opened, and the line says so with the address.
    expect(said[0]).toBe(`ℹ Open ${page} in a browser to play ${set.name} on the play page`);
  });

  it("refuses --start and --race without --bot, before anything is read", async () => {
    const { buildProgram } = await import("../cli/src/main");
    for (const [flag, said] of [[["--start"], /--start is for a game with a bot/], [["--race", "terran"], /--race is the bot's/]] as const) {
      const e = await buildProgram().exitOverride().parseAsync(["node", "scmjs", "mod", "play", join(root, "no-such-mod"), ...flag]).catch((x) => x);
      expect(e, flag.join(" ")).toBeInstanceOf(CliError);
      expect(e.message).toMatch(said);
      expect(e.exitCode).toBe(2);
    }
  });
});

/**
 * The loopback page `mod play` serves, run as the browser would run it (its script in a context of its own with the
 * page's globals stood in): what it posts to the play page once the page says it is ready, the address it opens, and
 * what the command hears back. The play page's side of the same message is scm-sim's `tests/handoff.test.ts`.
 */
async function handedOver(set: PlaySet, o: PlayOptions, answer: { type: string; [k: string]: unknown }) {
  process.env.BROWSER = "none";
  let page = "";
  const done = playOnPage(set, { play: "http://play.test/?debug", ...o, onAddress: (a) => { page = a; }, timeout: 10_000 });
  while (!page) await new Promise((r) => setTimeout(r, 10));
  const html = await (await fetch(page)).text();
  const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
  const posted: { m: Record<string, unknown>; origin: string }[] = [];
  const win = { postMessage: (m: Record<string, unknown>, origin: string) => posted.push({ m, origin }) };
  const handlers: ((e: unknown) => Promise<void>)[] = [];
  const els: Record<string, { textContent: string; hidden: boolean; onclick: unknown }> = {};
  let opened = "";
  runInNewContext(script, {
    fetch: (u: string, init?: RequestInit) => fetch(new URL(u, page).href, init), File, JSON, Object, Uint8Array, console,
    document: { getElementById: (id: string) => (els[id] ??= { textContent: "", hidden: false, onclick: null }) },
    addEventListener: (type: string, fn: (e: unknown) => Promise<void>) => { if (type === "message") handlers.push(fn); },
    open: (url: string) => { opened = url; return win; },
  });
  await handlers[0]({ origin: "http://play.test", source: win, data: { type: "scmjs.play.ready" } });
  await handlers[0]({ origin: "http://play.test", source: win, data: answer });
  return { opened, posted, outcome: await done };
}

describe("scmjs mod play --bot", () => {
  const made = async () => playSet(await openMod((() => { const d = tmp("bot"); writeFolder(d, madeMod()); return d; })(), null));

  it("reads --bot as a .scmbot file or a key, and --race by name or letter", () => {
    const dir = tmp("botfile"); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mine.scmbot"), latin("SCMBOT"));
    expect(playBotOf("cosmonarchy-example")).toEqual({ key: "cosmonarchy-example" });
    expect(playBotOf(join(dir, "mine.scmbot"))).toEqual({ name: "mine.scmbot", bytes: latin("SCMBOT") });
    expect(() => playBotOf(join(dir, "gone.scmbot"))).toThrow(/No bot file/);
    expect(() => playBotOf("not a key")).toThrow(CliError);
    expect([pageRace("zerg"), pageRace("T"), pageRace("protoss"), pageRace("r")]).toEqual([0, 1, 2, 6]);
    expect(() => pageRace("human")).toThrow(/is not a race/);
  });

  it("asks for the setup screen with the bot unless --start, and the map's own settings for a mod with code", async () => {
    const set = await made();
    expect(handoffExtra(set, {})).toBeNull();
    expect(handoffExtra(set, { bot: { key: "mcrave" } })).toEqual({ setup: true, useMapSettings: null, bot: { key: "mcrave" } });
    expect(handoffExtra({ ...set, plugins: 4, firegraft: 1 }, { bot: { key: "cosmonarchy-example" }, botRace: 1, start: true })).toEqual({ useMapSettings: true, bot: { key: "cosmonarchy-example", race: 1 } });
    expect(handoffExtra(set, { bot: { name: "mine.scmbot", bytes: latin("x") }, botRace: 6 })).toEqual({ setup: true, useMapSettings: null, bot: { file: "mine.scmbot", race: 6 } });
  });

  it("hands a catalogue bot over by its key, and says the page's row for it", async () => {
    const set = { ...(await made()), plugins: 2, firegraft: 1 };
    const map = { name: "(4)Exodus 1.0.scx", bytes: latin("a map") };
    const lines: string[] = [];
    const r = await handedOver(set, { map, bot: { key: "cosmonarchy-example" }, botRace: 1, live: (l) => lines.push(visible(l)) },
      { type: "scmjs.play.shown", name: map.name, bot: "Cosmonarchy Example — made for Cosmonarchy BW" });
    // (a mod with plugins goes to the page at ?lift=live, keeping what the address had)
    expect(new URL(r.opened).searchParams.get("lift")).toBe("live");
    expect(new URL(r.opened).searchParams.has("debug")).toBe(true);
    expect(r.posted).toHaveLength(1);
    const m = r.posted[0].m as { type: string; dataSet: { name: string; hash: string; files: { path: string; file: File }[] }; map: Uint8Array; name: string; setup: boolean; useMapSettings: unknown; bot: unknown };
    expect(r.posted[0].origin).toBe("http://play.test");
    expect(m.type).toBe("scmjs.play");
    expect(m.dataSet.hash).toBe(set.hash);
    expect(m.dataSet.files.map((f) => f.path)).toEqual(set.files.map((f) => f.path));
    expect(new Uint8Array(await m.dataSet.files[0].file.arrayBuffer())).toEqual(set.files[0].bytes);
    expect(m.name).toBe("(4)Exodus 1.0.scx");
    expect(new TextDecoder().decode(m.map)).toBe("a map");
    expect(JSON.parse(JSON.stringify({ setup: m.setup, useMapSettings: m.useMapSettings, bot: m.bot }))).toEqual({ setup: true, useMapSettings: true, bot: { key: "cosmonarchy-example", race: 1 } });
    expect(r.outcome).toMatchObject({ shown: true, started: false, error: null, bot: "Cosmonarchy Example — made for Cosmonarchy BW" });
    expect(r.outcome.said.map((x) => x.type)).toEqual(["scmjs.play.ready", "scmjs.play.shown"]);
    expect(lines).toContain("ℹ The play page is ready: the mod is handed over");
  });

  it("hands a .scmbot file over as a File, and --start starts the game", async () => {
    const set = await made();
    const bytes = latin("SCMBOT bytes");
    const r = await handedOver(set, { map: { name: "a.scx", bytes: latin("m") }, bot: { name: "mine.scmbot", bytes }, botRace: 2, start: true },
      { type: "scmjs.play.started", name: "a.scx", bot: "Mine (your file) — plays vanilla data" });
    // (no plugins: the address as given)
    expect(new URL(r.opened).searchParams.has("lift")).toBe(false);
    const m = r.posted[0].m as { setup?: boolean; useMapSettings: unknown; bot: { file: File; name: string; race: number } };
    expect(m.setup).toBeUndefined();
    expect(m.useMapSettings).toBeNull();
    expect(m.bot.name).toBe("mine.scmbot");
    expect(m.bot.race).toBe(2);
    expect(m.bot.file.name).toBe("mine.scmbot");
    expect(new Uint8Array(await m.bot.file.arrayBuffer())).toEqual(bytes);
    expect(r.outcome).toMatchObject({ started: true, bot: "Mine (your file) — plays vanilla data" });
  });

  it("says the page's wait for a sign-in, then its refusal of a bot it has not got", async () => {
    const set = await made();
    const lines: string[] = [];
    process.env.BROWSER = "none";
    let page = "";
    const done = playOnPage(set, { map: { name: "a.scx", bytes: latin("m") }, bot: { key: "nobody" }, play: "http://play.test/", live: (l) => lines.push(visible(l)), onAddress: (a) => { page = a; }, timeout: 10_000 });
    while (!page) await new Promise((r) => setTimeout(r, 10));
    await fetch(`${page}/message`, { method: "POST", body: JSON.stringify({ type: "scmjs.play.waiting", reason: "sign-in", message: "Playing Nobody takes a scmjs.dev account" }) });
    await fetch(`${page}/message`, { method: "POST", body: JSON.stringify({ type: "scmjs.play.error", message: "This play page has no community bot \"nobody\"" }) });
    expect(await done).toMatchObject({ started: false, error: "This play page has no community bot \"nobody\"" });
    expect(lines).toContain("ℹ Playing Nobody takes a scmjs.dev account");
  });
});

describe("scmjs mod test and --mod", () => {
  const engine = (mods: number): Engine => ({ dir: "/engine", build: "abc", runner: "run.mjs", runners: { map: "map.mjs" }, fetched: 0, mods });

  it("lays a mod under the game only for runners that take one, and says which version that is", async () => {
    expect(modArgs(engine(0), null)).toEqual([]);
    expect(() => modArgs(engine(0), "/x")).toThrow("--mod needs runners of mod overlay version 1 or newer");
    expect(modArgs(engine(1), "/x")).toEqual(["--mod", "/x"]);
    expect(modArgs(engine(MOD_OVERLAY), ["/game", "/x"])).toEqual(["--mod", "/game", "--mod", "/x"]);
    // A bot beside the mod's code (bot run, bot ladder) needs version 2: an engine of 1 says what 2 adds
    expect(MOD_OVERLAY).toBe(2);
    expect(() => modArgs(engine(1), "/x", MOD_CODE)).toThrow(/cannot run its plugins beside a bot: that needs runners of mod overlay version 2 .*loads a mod's plugins and FireGraft project/);
    expect(modArgs(engine(2), "/x", MOD_CODE)).toEqual(["--mod", "/x"]);
  });

  it("writes the mod's code beside its files for a bot's runner: plugins, the project, and mod.json with the hash", async () => {
    const dir = tmp("overlay-code"); writeFolder(dir, madeMod());
    mkdirSync(join(dir, "plugins"), { recursive: true });
    writeFileSync(join(dir, "plugins", "gptp.qdp"), latin("a plugin"));
    mkdirSync(join(dir, "Firegraft"), { recursive: true });
    writeFileSync(join(dir, "Firegraft", "My Mod.fgp"), latin("a project"));
    const overlay = modOverlay(dir, async () => null, { code: true });
    const [folder] = await overlay.layers();
    expect(readFileSync(join(folder, "plugins", "gptp.qdp"), "latin1")).toBe("a plugin");
    expect(readFileSync(join(folder, "firegraft", "My Mod.fgp"), "latin1")).toBe("a project");
    const manifest = JSON.parse(readFileSync(join(folder, "mod.json"), "utf8"));
    const hash = await sourceHash(await openMod(dir, null));
    expect(manifest).toEqual({ name: basename(dir), hash: hash.hash, withoutPlugins: hash.withoutPlugins });
    expect(hash.plugins).toBe(1);
    overlay.remove();
    // without `code` (map trace, map test): the files alone, as before
    const plain = modOverlay(dir, async () => null);
    const [only] = await plain.layers();
    expect(existsSync(join(only, "mod.json"))).toBe(false);
    plain.remove();
  });

  it("says the mod's code and how a bot fits it", () => {
    const code = { name: "Cosmonarchy BW", hash: "ac3f86533e4b5a31", withoutPlugins: "b13e467fb5abb298", plugins: ["Cosmonarchy initialized", "mtl.qdp failed: no"], skipped: [], firegraft: { name: "Cosmonarchy BW.fgp", from: "Cosmonarchy BW.exe", edits: 7 }, hashMs: 1 };
    const words = stripVTControlCharacters(codeWords(code, "ums"));
    expect(words).toMatch(/Cosmonarchy BW · ac3f86533e4b5a31 · 1 plugin loaded · FireGraft project Cosmonarchy BW.fgp \(7 edits\) · the map's own settings/);
    expect(words).toMatch(/mtl.qdp failed: no/);
    const game = { name: code.name, hash: code.hash };
    const plain = (s: string) => stripVTControlCharacters(s);
    expect(plain(fitWords({ mod: { name: "Cosmonarchy BW", hash: code.hash }, fit: "made", words: "" }, game))).toMatch(/made for Cosmonarchy BW$/);
    expect(plain(fitWords({ mod: null, fit: "vanilla", words: "" }, game, "mcrave"))).toMatch(/mcrave: plays vanilla data$/);
    expect(plain(fitWords({ mod: { name: "Other", hash: "0123456789abcdef" }, fit: "other", words: "" }, game))).toMatch(/made for Other \(0123456789abcdef\), not for this game's Cosmonarchy BW \(ac3f86533e4b5a31\): it plays all the same/);
  });

  it("writes the mod's files in the game's paths for the runner, and removes them after", async () => {
    const dir = tmp("overlay"); writeFolder(dir, madeMod());
    const overlay = modOverlay(dir, async () => null);
    const [folder, ...more] = await overlay.layers();
    expect(more).toEqual([]);
    expect(same(readFileSync(join(folder, "arr", "weapons.dat")), madeMod().get("arr\\weapons.dat"))).toBe(true);
    overlay.remove();
    expect(existsSync(folder)).toBe(false);
  });

  it("on a Remastered copy, lays the game's pictures under a mod that has the startup data read again, and takes them out of the report", async () => {
    const game = madeGame();
    game.set("arr\\images.tbl", tbl(["terran\\marine.grp", "terran\\marine.lof", "zerg\\avenger.grp"]));
    game.set("unit\\terran\\marine.lof", encodeLoFile({ frames: [[[0, 0]]] }));
    game.set("unit\\zerg\\avenger.grp", grp(5));
    game.set("game\\tselect.pcx", latin("tselect"));
    const remastered: GameFiles = { ...asGame(game, "StarCraft: Remastered"), kind: "remastered" };
    // An animation script alone: the reload reads every picture images.tbl names, which the runner's Remastered copy has not got.
    const dir = tmp("overlay-rm"); writeFolder(dir, new Map([["scripts\\iscript.bin", ISCRIPT(3)]]));
    const overlay = modOverlay(dir, async () => remastered);
    const [under, mod] = await overlay.layers();
    expect(mod).toBeDefined();
    for (const [name, path] of [["unit\\terran\\marine.grp", "unit/terran/marine.grp"], ["unit\\terran\\marine.lof", "unit/terran/marine.lof"], ["unit\\zerg\\avenger.grp", "unit/zerg/avenger.grp"], ["game\\tselect.pcx", "game/tselect.pcx"], ["arr\\images.tbl", "arr/images.tbl"]]) {
      expect(same(readFileSync(join(under, ...path.split("/"))), game.get(name)), name).toBe(true);
    }
    // The mod's own script is the mod's, not laid twice; no sounds (the reload reads the sound table, not the sounds).
    expect(existsSync(join(under, "scripts", "iscript.bin"))).toBe(false);
    expect(existsSync(join(under, "sound"))).toBe(false);
    expect(same(readFileSync(join(mod, "scripts", "iscript.bin")), ISCRIPT(3))).toBe(true);
    const said = overlay.report({ paths: [under, mod], files: 12, read: ["scripts\\iscript.bin", "unit\\zerg\\avenger.grp", "arr\\images.tbl"], reloaded: { served: 11, refused: [], heapBytes: 1, ms: 1 } });
    expect(said).toMatchObject({ paths: [mod], files: 1, read: ["scripts\\iscript.bin"], reloaded: { refused: [] } });
    expect(said.game).toBeGreaterThanOrEqual(5);
    overlay.remove();
    expect([existsSync(under), existsSync(mod)]).toEqual([false, false]);

    // Tables alone are not read again: nothing under them. A 1.16.1 copy's archives hold the pictures: nothing under either.
    const tables = tmp("overlay-tables"); writeFolder(tables, new Map([["arr\\weapons.dat", madeMod().get("arr\\weapons.dat")!]]));
    const alone = modOverlay(tables, async () => remastered);
    expect(await alone.layers()).toHaveLength(1);
    alone.remove();
    const classic = modOverlay(dir, async () => asGame(game));
    expect(await classic.layers()).toHaveLength(1);
    classic.remove();
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

/**
 * The person's StarCraft: Remastered installation, read-only (SCM_REMASTERED_DIR, else where Battle.net puts it under
 * WSL): what the command's reader answers for the play set's names, and the game's layer it lays under a mod for the
 * runner's reload — against the 1.16.1 archives (`fixtures/data`) for the pictures and overlays.
 */
const remasteredDir = process.env.SCM_REMASTERED_DIR ?? "/mnt/c/Program Files (x86)/StarCraft";
const haveRemastered = existsSync(join(remasteredDir, ".build.info"));

describe.skipIf(!haveRemastered || !haveGameArchives)("a StarCraft: Remastered installation (read-only)", () => {
  it("answers the pictures, overlays, sounds and interface pictures by the game's names", { timeout: 60_000 }, async () => {
    const files = await storageFiles(remasteredDir);
    expect(files.kind).toBe("remastered");
    // The SD pictures and overlays are 1.16.1's, byte for byte.
    for (const name of ["unit\\zerg\\avenger.grp", "unit\\zerg\\drone.loo", "game\\tunit.pcx"]) {
      const got = await files.read(name);
      expect(got?.length, name).toBeGreaterThan(0);
      expect(same(got, gameFile(name)), name).toBe(true);
    }
    // A sound is Remastered's own WAV (louder and longer than 1.16.1's), as the storage holds it under that name.
    const { Storage } = await import("kascade");
    const { nodeSource } = await import("kascade/node");
    const storage = await Storage.open(nodeSource(remasteredDir));
    const sound = "sound\\zerg\\avenger\\zavyes01.wav";
    const wavBytes = await files.read(sound);
    expect(same(wavBytes, await storage.readFile("sound/zerg/avenger/zavyes01.wav"))).toBe(true);
    expect(latinOf(wavBytes!.subarray(0, 4))).toBe("RIFF");
    console.log(`Remastered ${storage.build.version}: avenger.grp ${(await files.read("unit\\zerg\\avenger.grp"))!.length} B = 1.16.1's; drone.loo = 1.16.1's; ${sound} ${wavBytes!.length} B (1.16.1's ${gameFile(sound)?.length ?? 0} B)`);
  });

  it("lays every picture and overlay images.tbl names under a mod with an animation script, each the 1.16.1 archives' bytes", { timeout: 120_000 }, async () => {
    const files = await storageFiles(remasteredDir);
    const dir = tmp("rm-iscript"); writeFolder(dir, new Map([["scripts\\iscript.bin", (await files.read("scripts\\iscript.bin"))!]]));
    const t0 = performance.now();
    const layer = await gameLayer(await openMod(dir, files), files);
    const ms = performance.now() - t0;
    const names = new Set(layer.map((l) => l.member));
    const pictures = [...new Set(gameImagePaths().map(gameName))];
    expect(pictures.filter((p) => !names.has(p))).toEqual([]);
    const differ = layer.filter((l) => l.member.startsWith("unit\\") && !same(l.data, gameFile(l.member))).map((l) => l.member);
    expect(differ).toEqual([]);
    expect(names.has("scripts\\iscript.bin")).toBe(false);
    for (const n of ["arr\\images.dat", "arr\\images.tbl", "arr\\mapdata.dat", "arr\\mapdata.tbl", "game\\tselect.pcx"]) expect(names.has(n), n).toBe(true);
    const bytes = layer.reduce((n, l) => n + l.data.length, 0);
    console.log(`the game's layer under an iscript mod: ${layer.length} files (${pictures.filter((p) => p.endsWith(".grp")).length} GRPs, ${pictures.filter((p) => !p.endsWith(".grp")).length} overlays, ${layer.length - pictures.length} startup files), ${(bytes / 1e6).toFixed(1)} MB, read in ${Math.round(ms)} ms`);
  });
});

/**
 * The end to end: `map trace --mod` on a Remastered copy, with scm-sim's own map runner (bundled from a checkout that
 * has mods: SCM_SIM_DIR, else a sibling `scm-sim` or `scm-sim-mods-plan`, with the engine's files in `data/lifted`).
 * The scene is the runner tests' (scm-sim `tests/exact-mod-runner.test.ts`): a marine beside a computer's supply
 * depot, which it fires on by itself. The mod is the game's animation script with the marine's frame after a shot
 * (`playfram 51`, the muzzle's flash) made the aiming frame (34), scm-sim's `tests/exact-mod-iscript.test.ts` change.
 * The triggers read the frame set of the last twenty images (the game takes images from the top of its table) through
 * EUD Deaths conditions, a row for "frames 34–50" and one for "51–67" an image, run every frame by hyper triggers.
 */
const simDir = [process.env.SCM_SIM_DIR, join(import.meta.dirname, "..", "..", "scm-sim"), join(import.meta.dirname, "..", "..", "scm-sim-mods-plan")]
  .find((d): d is string => !!d && existsSync(join(d, "src", "exact", "modRunner.ts")) && ["core.js", "game.js", "base-s1.bin", "interface.bin"].every((f) => existsSync(join(d, "data", "lifted", f))));

const SCENE = `
const [dir, copy] = process.argv.slice(-2);
const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { sceneMap } = await import("./scripts/real.ts");
const { A, C, Compare, Group, trigger } = await import("./src/sim/triggers/types.ts");
const { gameCopyFiles } = await import("./src/exact/gameCopy.ts");
const { readGameData, unitImage } = await import("./src/data/dat.ts");
const { Anim, readIScript } = await import("./src/data/iscript.ts");
const { decode } = await import("./src/sim/iscript/opcodes.ts");
const DEATHS = 0x58a364, IMAGES = 0x52f568, FIRST = 4980, LAST = 4999, FROM = 51, TO = 34;
const triggers = [], rows = [];
for (let s = FIRST; s <= LAST; s++) for (const set of [TO, FROM]) {
  const eud = (IMAGES + 64 * s + 0x18 - DEATHS) / 4;
  rows.push([s, set]);
  triggers.push(trigger([Group.Player1], [C.deaths(eud, 0, Compare.AtLeast, set * 65536), C.deaths(eud, 0, Compare.AtMost, (set + 17) * 65536 - 1)], [A.preserve()]));
}
for (let k = 0; k < 3; k++) triggers.push(trigger([Group.Player1], [C.always()], [...Array.from({ length: 62 }, () => A.wait(0)), A.preserve()]));
writeFileSync(join(dir, "scene.chk"), sceneMap({ size: [64, 64], frames: 1, map: { units: [{ type: 0, x: 340, y: 288, owner: 0 }, { type: 109, x: 400, y: 288, owner: 1 }] }, triggers }).chk);
writeFileSync(join(dir, "rows.json"), JSON.stringify(rows));
const files = (await gameCopyFiles(copy, new Uint8Array(readFileSync("data/lifted/interface.bin")))).files;
const read = (p) => files.read(p.split("/").join("\\\\"));
const data = readGameData({ read: (p) => { const b = read(p); if (!b) throw new Error("no " + p); return b; } });
const iscript = read("scripts\\\\iscript.bin");
const script = readIScript(iscript).entries.get(data.images.iscript[unitImage(data, 0)]);
let at = script.animations[Anim.GndAttkRpt], shot = false, changed = -1;
for (let i = 0; i < 40 && changed < 0; i++) { const ins = decode(iscript, at); if (ins.def.name === "attackwith") shot = true; else if (shot && ins.def.name === "playfram") changed = ins.offset; at = ins.next; }
if (changed < 0 || (iscript[changed + 1] | iscript[changed + 2] << 8) !== FROM) throw new Error("the marine's script is not as expected");
const modded = iscript.slice(); modded[changed + 1] = TO; modded[changed + 2] = 0;
mkdirSync(join(dir, "mod", "scripts"), { recursive: true });
writeFileSync(join(dir, "mod", "scripts", "iscript.bin"), modded);
`;

describe.skipIf(!haveRemastered || !simDir)("map trace --mod on a Remastered copy, with scm-sim's map runner", () => {
  it("reads the startup data again with nothing refused, and the marine's flash frames become aiming frames", { timeout: 240_000 }, async () => {
    const dir = tmp("rm-trace"); mkdirSync(dir, { recursive: true });
    // The scene and the mod, by scm-sim's own code; the runner bundled as its deploy bundles it, into an engine folder.
    const made = spawnSync(process.execPath, ["--input-type=module", "-e", SCENE, dir, remasteredDir], { cwd: simDir, encoding: "utf8" });
    expect(made.status, made.stderr).toBe(0);
    const engine = join(dir, "engine"), build = join(engine, "b1");
    mkdirSync(build, { recursive: true });
    const bundle = `require("esbuild").build({ entryPoints: ["src/exact/runMap.ts"], outfile: ${JSON.stringify(join(build, "map.mjs"))}, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "error" })`;
    const bundled = spawnSync(process.execPath, ["-e", bundle], { cwd: simDir, encoding: "utf8" });
    expect(bundled.status, bundled.stderr).toBe(0);
    for (const f of ["core.js", "game.js", "base-s1.bin", "interface.bin"]) symlinkSync(join(simDir!, "data", "lifted", f), join(build, f));
    writeFileSync(join(engine, "current.json"), JSON.stringify({ build: "b1", files: ["core.js", "game.js", "base-s1.bin", "interface.bin"], runner: "map.mjs", mapRunner: "map.mjs", mods: MOD_OVERLAY }));
    const rows = JSON.parse(readFileSync(join(dir, "rows.json"), "utf8")) as [number, number][];
    const sets = (trace: { row: number; fired: number }[] | null) => {
      const out = { 34: 0, 51: 0 };
      for (const c of trace ?? []) if (c.row < rows.length) out[rows[c.row][1] as 34 | 51] += c.fired;
      return out;
    };
    const o = { engine, starcraft: remasteredDir, frames: 400, every: 0 };
    const plain = await runMapInGame(join(dir, "scene.chk"), "trace", o);
    const overlay = modOverlay(join(dir, "mod"), () => gameFilesOrNull(remasteredDir));
    const modded = await runMapInGame(join(dir, "scene.chk"), "trace", { ...o, mod: overlay }).finally(() => overlay.remove());
    expect(plain.game.kind).toBe("remastered");
    expect(plain.start?.mod).toBeUndefined();
    const mod = modded.start!.mod!;
    expect(mod).toMatchObject({ files: 1, read: ["scripts\\iscript.bin"], reloaded: { refused: [] } });
    expect(mod.paths).toHaveLength(1);
    expect(mod.game).toBeGreaterThanOrEqual(928);
    const p = sets(plain.end.trace), q = sets(modded.end.trace);
    console.log(`map trace --mod on Remastered: the reload read ${mod.reloaded!.served} files, refused none (${mod.game} of the game's laid under the mod); passes of the triggers seeing frames 34–50 / 51–67: ${p[34]} / ${p[51]} without the mod, ${q[34]} / ${q[51]} with it`);
    expect(plain.end.passes).toBeGreaterThan(150);
    expect(q[51]).toBeLessThan(p[51]);
    expect(q[34] - p[34]).toBe(p[51] - q[51]);
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
