/**
 * `scmjs mod pack <dir> [-o mod.mpq] [--folder <out>]`: a mod folder back into the files the game reads — an MPQ the
 * launchers load (MPQDraft, Chaoslauncher, FireGraft's patcher), or a loose folder in the game's paths (samase on
 * Remastered, or the play page). Every file under the folder's known folders goes in, the texts and pictures turned
 * back into their members by the same functions `mod unpack` checked them with; `mod.json` says what the paths do
 * not. The same folder always gives the same bytes: the members are added in name order, with fixed settings.
 */
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tempFolder } from "../lifecycle";
import type { Writable } from "node:stream";
import { dirname, extname, join, resolve } from "node:path";
import { Creator } from "mopaq";
import { DEFAULT_PALETTE, MOD_MANIFEST, ModFolderError, packFile, type ModManifest, type PackContext } from "../../../src/formats/mod/folder";
import { gameName, isSystemFile } from "../../../src/formats/mod/sources";
import { isModCode } from "../../../src/formats/mod/hash";
import { loadModData } from "../../../src/formats/mod/data";
import { normalizeRaces } from "../../../src/formats/mod/races";
import type { NamedPalette, QuantiseReport } from "../../../src/formats/dat/grpPng";
import type { GameFiles } from "../gamefiles";
import { t } from "../i18n";
import { CliError } from "../ui";
import { STDIO } from "../files";
import { emptySource, folderManifest, type ModSource } from "./source";

export type ModCompression = "zlib" | "pkware" | "none";
export const MOD_COMPRESSIONS: readonly ModCompression[] = ["zlib", "pkware", "none"];

export interface FolderPacked {
  source: ModSource;
  manifest: ModManifest;
  /** Each member and the folder file it came from, in name order. */
  members: { member: string; file: string; data: Uint8Array }[];
  /** Files of the folder that are no member (outside the known folders, a plugin that sat beside the archive). */
  left: string[];
  /** Pictures that were not in their palette's colours and were brought to them. */
  quantised: { file: string; report: QuantiseReport }[];
  /** Sounds converted to WAV. */
  converted: string[];
}

/**
 * Every file under `dir` (forward slashes), in name order. A dot folder (git's, an editor's) is left out; a dot file is
 * not, as it may be one of the mod's (`files/lua/.gitignore`: the mod's hash counts it, so it must pack back). An
 * operating system's file (`isSystemFile`: the `desktop.ini` Explorer puts in `sounds/`) is left out: no mod has one.
 */
async function folderFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = (await readdir(join(dir, prefix), { withFileTypes: true })).filter((e) => !(e.isDirectory() && e.name.startsWith(".")));
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (isSystemFile(path)) continue;
    if (e.isDirectory()) out.push(...await folderFiles(dir, path));
    else if (e.isFile()) out.push(path);
  }
  return out;
}

/** A sound that is not a WAV, as one: ffmpeg, when it is on the PATH, to 16-bit PCM at 22,050 Hz mono (the game's own). */
export async function convertWithFfmpeg(bytes: Uint8Array, file: string): Promise<Uint8Array> {
  const dir = tempFolder("scmjs-sound-");
  try {
    const input = join(dir, `in${file.replace(/^.*(\.[^.]+)$/, "$1")}`), output = join(dir, "out.wav");
    writeFileSync(input, bytes);
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", input, "-ac", "1", "-ar", "22050", "-c:a", "pcm_s16le", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1", output], { stdio: ["ignore", "ignore", "pipe"] });
    if (r.error) throw new Error(t("a sound that is not a WAV is converted with ffmpeg, which is not on the PATH: install it, or convert the sound to a WAV yourself"));
    if (r.status !== 0) throw new Error(t("ffmpeg could not convert it: {why}", { why: String(r.stderr).trim().split("\n")[0] }));
    return new Uint8Array(readFileSync(output));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export interface PackFolderOptions {
  /** The game's files: names when the folder's were the game's, a palette the folder lacks. */
  base?: GameFiles | null;
  convertSound?: PackContext["convertSound"];
}

/** The folder's members, in memory, as a source the other commands read. */
export async function packFolder(dir: string, manifest: ModManifest, options: PackFolderOptions = {}): Promise<FolderPacked> {
  const files = await folderFiles(dir);
  const out = new Map<string, { member: string; file: string; data: Uint8Array }>();
  const left: string[] = [], quantised: FolderPacked["quantised"] = [], converted: string[] = [];
  const base = options.base ?? null;
  const put = (file: string, list: { member: string; data: Uint8Array }[]) => {
    if (!list.length && file !== "mod.json" && !/^readme(\.\w+)?$/i.test(file) && !/^\.[^/]*$/.test(file)) left.push(file);
    for (const m of list) {
      const key = gameName(m.member);
      if (out.has(key)) throw new CliError(t("{file} and {other} are both {member}.", { file, other: out.get(key)!.file, member: m.member }), t("Keep one of them: a mod has one file at each of the game's paths."), 1);
      out.set(key, { member: m.member, file, data: m.data });
    }
  };
  const palettes = new Map<string, NamedPalette | null>();
  const ctx: PackContext = {
    manifest,
    convertSound: options.convertSound ?? convertWithFfmpeg,
    quantised: (file, report) => quantised.push({ file, report }),
  };
  const pack = async (file: string) => {
    const data = new Uint8Array(await readFile(join(dir, file)));
    try {
      const list = await packFile(file, data, ctx);
      if (file.startsWith("sounds/") && !/\.wav$/i.test(file) && list.length) converted.push(file);
      put(file, list);
    } catch (e) {
      // (the file as it is from where the person is, the mod folder's path before it, so that it opens as printed)
      if (e instanceof ModFolderError) { const at = `${e.file}${e.line > 0 ? `:${e.line}` : ""}: `; throw new CliError(`${join(dir, ...e.file.split("/"))}${e.line > 0 ? `:${e.line}` : ""}: ${e.message.startsWith(at) ? e.message.slice(at.length) : e.message}`, null, 1); }
      throw e;
    }
  };
  // Pictures and the AI script last: a picture may need a palette the folder holds, the AI script the names in its tables.
  const later = files.filter((f) => f.startsWith("graphics/") || f.startsWith("ai/"));
  for (const f of files.filter((f) => !later.includes(f))) await pack(f);

  const readOwn = async (name: string) => out.get(gameName(name))?.data ?? null;
  ctx.palette = (name) => {
    if (!palettes.has(name)) palettes.set(name, null);
    return palettes.get(name) ?? null;
  };
  // Palettes are looked up ahead (packFile asks synchronously): the folder's own, else the game's.
  for (const name of new Set([manifest.palette || DEFAULT_PALETTE, ...await sheetPaletteNames(dir, later)])) {
    const own = await readOwn(`tileset\\${name}.wpe`) ?? (base ? await base.read(`tileset\\${name}.wpe`) : null);
    palettes.set(name, own ? { name, colours: own } : null);
  }
  if (later.some((f) => f.startsWith("ai/"))) {
    if (manifest.names === "game" && !base) throw new CliError(t("The AI script names units as the game's string tables do, and no copy of StarCraft was found to read them from."), t("Name the copy with --starcraft (or SCMJS_STARCRAFT); the folder was unpacked with the game's names."), 1);
    const data = manifest.names === "none" ? null : await loadModData(readOwn, manifest.names === "game" && base ? (n) => base.read(n) : null, Object.fromEntries(Object.entries(manifest.tables).map(([table, v]) => [table, v!.file])));
    ctx.names = data?.names ?? null;
  }
  for (const f of later) await pack(f);

  const members = [...out.values()].sort((a, b) => (gameName(a.member) < gameName(b.member) ? -1 : gameName(a.member) > gameName(b.member) ? 1 : 0));
  const source = emptySource(dir, "mod folder", manifest.name || dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop()!);
  source.manifest = manifest;
  source.races = normalizeRaces(manifest.races);
  source.layers.push(...manifest.layers);
  // (A plugin or FireGraft file that was in the mod's archive goes back in as a member, and is the mod's code, not a game file.)
  for (const m of members) if (!isModCode(m.member)) source.files.set(gameName(m.member), { name: m.member, size: m.data.length, read: async () => m.data, layer: m.file });
  for (const p of [...manifest.plugins, ...manifest.firegraft]) {
    const path = join(dir, p.file);
    const carried = { name: p.name, bytes: p.bytes, read: async () => new Uint8Array(await readFile(path)), member: p.member, layer: p.file };
    (manifest.plugins.includes(p) ? source.plugins : source.firegraft).push(carried);
  }
  return { source, manifest, members, left: left.filter((f) => ![...manifest.plugins, ...manifest.firegraft].some((p) => p.file === f)), quantised, converted };
}

/** The palette names the sheets say they were drawn with (read from their text chunks without decoding pictures). */
async function sheetPaletteNames(dir: string, files: string[]): Promise<string[]> {
  const names = new Set<string>();
  for (const f of files.filter((x) => /\.png$/i.test(x))) {
    const bytes = await readFile(join(dir, f));
    const at = bytes.indexOf("scmjs:grp\0");
    if (at < 0) continue;
    const m = /"palette":"([^"]*)"/.exec(bytes.subarray(at, at + 400).toString("latin1"));
    if (m) names.add(m[1]);
  }
  return [...names];
}

export interface PackedMod {
  /** The file or folder written. */
  path: string;
  form: "mpq" | "folder";
  members: number;
  bytes: number;
  compression: ModCompression | null;
  left: string[];
  quantised: { file: string; colours: number; pixels: number }[];
  converted: string[];
}

/** The members as an MPQ: in name order, a (listfile), 4,096-byte sectors as Blizzard's tools wrote, one compression for all. */
export async function writeMpq(members: readonly { member: string; data: Uint8Array }[], compression: ModCompression): Promise<Uint8Array> {
  const creator = new Creator({ sectorSize: 4096, listfile: true, listfileCompress: compression === "pkware" ? "pkware" : "zlib" });
  for (const m of members) creator.addFile(m.member, m.data, { compress: compression === "none" ? false : compression });
  return creator.writeAsync();
}

/** The members as loose files in the game's paths under `out`. */
export async function writeLoose(members: readonly { member: string; data: Uint8Array }[], out: string): Promise<number> {
  let bytes = 0;
  for (const m of members) {
    const path = join(out, ...m.member.split("\\"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, m.data);
    bytes += m.data.length;
  }
  return bytes;
}

export interface PackModOptions extends PackFolderOptions {
  /** The MPQ to write (default: `<folder>.mpq` beside it). */
  out?: string | null;
  /** A loose folder to write instead of an MPQ. */
  folder?: string | null;
  compression?: ModCompression;
  /** Where `out` `-` writes the MPQ (standard output); without it `-` is refused. */
  stdout?: Writable;
}

/**
 * `--out` and `--folder` as `mod pack` and `mod build` take them, checked before anything is read: one or the other,
 * `-` (standard output) for the MPQ alone, and an MPQ's name ending in `.mpq`.
 */
export function checkPackOut(o: { out?: string | null; folder?: string | null; json?: boolean }): void {
  if (o.out && o.folder) throw new CliError(t("--out and --folder: the MPQ or the loose folder, not both."), null, 2);
  if (o.folder === STDIO) throw new CliError(t("--folder writes a folder, which cannot go to standard output."), t("Name a folder, or give --out - for the MPQ."), 2);
  if (o.out === STDIO && o.json) throw new CliError(t("--json and the MPQ both want standard output"), t("Write the MPQ to a file with --out, or leave --json off."), 2);
  if (o.out && o.out !== STDIO && extname(o.out).toLowerCase() !== ".mpq") throw new CliError(extname(o.out) ? t("--out names a {ext} file; the mod is written as an .mpq", { ext: extname(o.out) }) : t("--out names a file with no extension; the mod is written as an .mpq"), null, 2);
}

/** `mod pack`: the folder read and written as an MPQ or a loose folder. */
export async function packMod(dir: string, manifest: ModManifest, o: PackModOptions = {}): Promise<PackedMod> {
  const packed = await packFolder(dir, manifest, o);
  const quantised = packed.quantised.map((q) => ({ file: q.file, colours: q.report.coloursLost.length, pixels: q.report.pixelsChanged }));
  if (o.folder) {
    const out = resolve(o.folder);
    if (out === resolve(dir) || out.startsWith(resolve(dir) + "/")) throw new CliError(t("The loose folder would be written inside the mod folder."), t("Name a folder elsewhere with --folder."), 2);
    const bytes = await writeLoose(packed.members, out);
    return { path: o.folder, form: "folder", members: packed.members.length, bytes, compression: null, left: packed.left, quantised, converted: packed.converted };
  }
  const compression = o.compression ?? "zlib";
  const bytes = await writeMpq(packed.members, compression);
  if (o.out === STDIO) {
    const stdout = o.stdout;
    if (!stdout) throw new CliError(t("The MPQ cannot go to standard output here."), t("Name a file for it."), 2);
    await new Promise<void>((done, fail) => stdout.write(bytes, (e) => (e ? fail(e) : done())));
    return { path: STDIO, form: "mpq", members: packed.members.length, bytes: bytes.length, compression, left: packed.left, quantised, converted: packed.converted };
  }
  const out = o.out ?? `${dir.replace(/[\\/]+$/, "")}.mpq`;
  try {
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(out, bytes);
  } catch (e) { throw new CliError(t("{path} could not be written ({code})", { path: out, code: String((e as NodeJS.ErrnoException).code ?? e) }), null, 2); }
  return { path: out, form: "mpq", members: packed.members.length, bytes: bytes.length, compression, left: packed.left, quantised, converted: packed.converted };
}

/** Whether a path is a folder. */
export async function isFolder(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

/** The manifest of a folder mod unpack or mod new wrote, or a CliError saying what the folder is not. */
export async function readModFolder(dir: string): Promise<ModManifest> {
  let s;
  try { s = await stat(dir); } catch { throw new CliError(t("No folder {folder}", { folder: dir }), t("scmjs mod unpack <mod> <folder> makes one from a mod, scmjs mod new <folder> an empty one."), 2); }
  if (!s.isDirectory()) throw new CliError(t("{folder} is a file, not a mod folder.", { folder: dir }), t("scmjs mod pack takes the folder scmjs mod unpack or scmjs mod new wrote."), 2);
  if (!(await isFile(join(dir, MOD_MANIFEST)))) throw new CliError(t("{folder} has no {file}: it is not a mod folder.", { folder: dir, file: MOD_MANIFEST }), t("scmjs mod unpack <mod> <folder> makes one from a mod, scmjs mod new <folder> an empty one."), 2);
  const manifest = await folderManifest(dir);
  if (!manifest) throw new CliError(t("{file} is not one scmjs wrote (it has no \"scmjs\" version).", { file: join(dir, MOD_MANIFEST) }), null, 2);
  return manifest;
}

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}
