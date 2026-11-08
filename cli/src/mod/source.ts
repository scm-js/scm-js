/**
 * A mod as the person names it, opened into its files by the game's names: a folder of loose files (the game's paths
 * at its root or a folder down), one `.mpq`, a self-executing `.exe` (MPQDraft's or FireGraft's — read, never run), a
 * `.zip` of any of these, or a mod folder `scmjs mod unpack` wrote (packed in memory). Archives are laid first, in
 * the order found, and loose files over them, the later winning as the game layers its own archives.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { Archive } from "mopaq";
import { exeArchive, gameName, isMpq, isZip, modRoot, readZip, ModSourceError } from "../../../src/formats/mod/sources";
import { MOD_MANIFEST, readManifest, type ModManifest } from "../../../src/formats/mod/folder";
import { DAT_SCHEMAS, DAT_TABLES } from "../../../src/formats/dat/schema";
import { decodeTblFile } from "../../../src/formats/dat/tblFile";
import type { GameFiles } from "../gamefiles";
import { t } from "../i18n";
import { CliError } from "../ui";

export interface SourceFile {
  /** The name as the source spells it (`arr\units.datex`, `unit/Terran/marine.grp` made `unit\Terran\marine.grp`). */
  name: string;
  size: number;
  read(): Promise<Uint8Array>;
  /** The layer it came from. */
  layer: string;
}

/** A plugin or FireGraft file the mod carries (never run). */
export interface CarriedFile { name: string; bytes: number; read(): Promise<Uint8Array>; member?: string; layer: string }

export type SourceKind = "mod folder" | "folder" | "archive" | "exe" | "zip" | "game";

export interface ModSource {
  /** What the person named. */
  path: string;
  kind: SourceKind;
  name: string;
  /** The layers, in load order. */
  layers: string[];
  /** The mod's files by the game's name (lower case, backslashes). */
  files: Map<string, SourceFile>;
  plugins: CarriedFile[];
  firegraft: CarriedFile[];
  /** A self-executing exe's archive and the FireGraft plugins in its overlay. */
  exes: { file: string; kind: "sempq" | "firegraft"; at: number; plugins: { id: number; size: number }[] }[];
  /** Two files of a folder for one game path (any case): the later is used. */
  duplicates: string[];
  /** Files that are not the game's (a read-me beside the game's folders, a dll), left out. */
  left: string[];
  /** A mod folder's manifest. */
  manifest: ModManifest | null;
  /** Archives with no file list, read by the names the game uses. */
  probed: string[];
}

/** A source's files read by the game's name, any case, or null. */
export const reader = (source: ModSource) => async (name: string): Promise<Uint8Array | null> => {
  const f = source.files.get(gameName(name));
  return f ? f.read() : null;
};

interface Piece { path: string; size: number; read(): Promise<Uint8Array> }

async function walk(dir: string, prefix = ""): Promise<Piece[]> {
  const out: Piece[] = [];
  // (A dot folder is a tool's own — git's, an editor's — never the game's.)
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith("."));
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const full = join(dir, e.name), path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await walk(full, path));
    else if (e.isFile()) { const s = await stat(full); out.push({ path, size: s.size, read: async () => new Uint8Array(await readFile(full)) }); }
  }
  return out;
}

/** The names the game reads, to look for in an archive that has no list of its files. */
function probeNames(archive: Archive): string[] {
  const names = new Set<string>();
  for (const t of DAT_TABLES) { names.add(DAT_SCHEMAS[t].file); names.add(`${DAT_SCHEMAS[t].file}ex`); }
  for (const n of ["rez\\stat_txt.tbl", "rez\\unitnames.tbl", "arr\\images.tbl", "arr\\sfxdata.tbl", "arr\\portdata.tbl", "arr\\mapdata.tbl", "scripts\\iscript.bin", "scripts\\aiscript.bin", "scripts\\bwscript.bin", "unit\\cmdbtns\\cmdicons.grp", "unit\\cmdbtns\\ticon.pcx", "unit\\cmdbtns\\uniticons.grp", "game\\tunit.pcx", "game\\tselect.pcx", "game\\tminimap.pcx", "game\\tblink.pcx", "triggers\\melee.trg"]) names.add(n);
  for (const t of ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"]) for (const ext of ["cv5", "vf4", "vr4", "vx4", "vx4ex", "wpe", "grp", "dddata.dat"]) names.add(ext.includes(".") ? `tileset\\${t}\\${ext}` : `tileset\\${t}.${ext}`);
  for (const [tbl, under] of [["arr\\images.tbl", "unit\\"], ["arr\\sfxdata.tbl", "sound\\"]] as const) {
    try { for (const s of decodeTblFile(archive.readFile(tbl)).strings) { const p = s.replace(/\0[\s\S]*$/, ""); if (p) names.add(under + p); } } catch { /* not in this archive */ }
  }
  return [...names].filter((n) => { try { return !!archive.fileInfo(n); } catch { return false; } });
}

/** Opens what the person named. A mod folder is packed in memory by `pack` (handed in, to keep the modules apart). */
export async function openModSource(path: string, packed: (dir: string, manifest: ModManifest) => Promise<ModSource>): Promise<ModSource> {
  let s;
  try { s = await stat(path); } catch { throw new CliError(t("No file or folder {path}", { path }), t("Name a mod: a folder, an .mpq, a mod's .exe, a .zip, or a folder scmjs mod unpack wrote."), 2); }
  const name = basename(resolve(path)).replace(/\.(mpq|exe|zip)$/i, "");
  if (s.isDirectory()) {
    const manifestPath = join(path, MOD_MANIFEST);
    let manifest: ModManifest | null = null;
    try { manifest = readManifest(await readFile(manifestPath, "utf8")); } catch (e) { if (e instanceof Error && !("code" in e)) throw new CliError(e.message, null, 2); }
    if (manifest) return packed(path, manifest);
    return fromPieces(path, "folder", name, await walk(path));
  }
  const bytes = new Uint8Array(await readFile(path));
  const kind: SourceKind = isZip(bytes) ? "zip" : isMpq(bytes) ? "archive" : bytes[0] === 0x4d && bytes[1] === 0x5a ? "exe" : "archive";
  if (kind === "archive" && !isMpq(bytes)) throw new CliError(t("{path} is not a mod: not an MPQ, a self-executing exe or a zip.", { path }), null, 2);
  return fromPieces(path, kind, name, [{ path: basename(path), size: bytes.length, read: async () => bytes }]);
}

/** The game's own data files as a source (what the proofs unpack): every name given that the copy has. */
export async function gameSource(files: GameFiles, names: readonly string[]): Promise<ModSource> {
  const source = emptySource(files.folder, "game", files.label);
  source.layers.push(files.label);
  for (const n of names) {
    const bytes = await files.read(n);
    if (bytes) source.files.set(gameName(n), { name: n, size: bytes.length, read: async () => bytes, layer: files.label });
  }
  return source;
}

export function emptySource(path: string, kind: SourceKind, name: string): ModSource {
  return { path, kind, name, layers: [], files: new Map(), plugins: [], firegraft: [], exes: [], duplicates: [], left: [], manifest: null, probed: [] };
}

async function fromPieces(path: string, kind: SourceKind, name: string, pieces: Piece[]): Promise<ModSource> {
  const source = emptySource(path, kind, name);
  const loose: Piece[] = [];
  const archives: { label: string; archive: Archive }[] = [];
  let modName: string | null = null;
  const take = async (list: Piece[], depth: number): Promise<void> => {
    for (const p of list) {
      const leaf = p.path.split("/").pop()!.toLowerCase();
      if (/\.(qdp|bwl)$/.test(leaf)) { source.plugins.push({ name: p.path, bytes: p.size, read: p.read, layer: p.path }); continue; }
      if (/\.(fgp|fgd)$/.test(leaf)) { source.firegraft.push({ name: p.path, bytes: p.size, read: p.read, layer: p.path }); continue; }
      if (leaf === "mod.json" && p.path.split("/").length <= 2) {
        try { const n = JSON.parse(new TextDecoder().decode(await p.read())).name; if (typeof n === "string" && n.trim()) modName = n.trim(); } catch { /* not ours to read */ }
        continue;
      }
      if (!/\.(zip|mpq|exe)$/.test(leaf)) { loose.push(p); continue; }
      const bytes = await p.read();
      if (leaf.endsWith(".zip") && isZip(bytes)) {
        if (depth > 2) continue;
        let members;
        try { members = readZip(bytes); } catch (e) { throw new CliError(`${p.path}: ${(e as Error).message}`, null, 2); }
        const prefix = list.length === 1 && depth === 0 ? "" : p.path.replace(/\.zip$/i, "") + "/";
        await take(members.map((m) => ({ path: `${prefix}${m.path}`, size: m.size, read: m.read })), depth + 1);
      } else if (leaf.endsWith(".mpq") && isMpq(bytes)) {
        try { archives.push({ label: p.path, archive: Archive.open(bytes) }); } catch (e) { throw new CliError(t("{file} could not be opened as an archive: {why}", { file: p.path, why: (e as Error).message }), null, 2); }
      } else if (leaf.endsWith(".exe")) {
        const found = exeArchive(bytes);
        if (!found) { source.left.push(p.path); continue; }
        try { archives.push({ label: p.path, archive: Archive.open(found.archive) }); } catch (e) { throw new CliError(t("The archive inside {file} could not be opened: {why}", { file: p.path, why: (e as Error).message }), null, 2); }
        source.exes.push({ file: p.path, kind: found.kind, at: found.at, plugins: found.plugins });
      } else loose.push(p);
    }
  };
  try { await take(pieces, 0); } catch (e) { if (e instanceof ModSourceError) throw new CliError(e.message, null, 2); throw e; }

  for (const { label, archive } of archives) {
    source.layers.push(label);
    // A list of the archive's files may be partial (Blizzard's own are): the names the game reads are looked for too.
    const listed = (archive.files() ?? []).filter((n) => !n.startsWith("("));
    if (!listed.length) source.probed.push(label);
    const seen = new Set(listed.map(gameName));
    const names = [...listed, ...probeNames(archive).filter((n) => !seen.has(gameName(n)))];
    for (const n of names) {
      const info = archive.fileInfo(n);
      if (!info) continue;
      const read = async () => archive.readFile(n);
      const lower = gameName(n);
      if (/\.(qdp|bwl)$/.test(lower)) { source.plugins.push({ name: n.split("\\").pop()!, bytes: info.uncompressedSize, read, member: n, layer: label }); continue; }
      if (/\.(fgp|fgd)$/.test(lower)) { source.firegraft.push({ name: n.split("\\").pop()!, bytes: info.uncompressedSize, read, member: n, layer: label }); continue; }
      source.files.set(lower, { name: n, size: info.uncompressedSize, read, layer: label });
    }
  }
  const root = modRoot(loose.map((p) => p.path));
  if (loose.some((p) => !root || p.path.startsWith(root + "/"))) source.layers.push(root ? `${root}/` : "./");
  for (const p of loose) {
    if (root && !p.path.startsWith(root + "/")) { source.left.push(p.path); continue; }
    const rel = root ? p.path.slice(root.length + 1) : p.path;
    // A file beside the game's folders (a read-me, notes) is not one of the game's.
    if (!rel.includes("/")) { source.left.push(p.path); continue; }
    const lower = gameName(rel);
    const was = source.files.get(lower);
    if (was && was.layer === (root ? `${root}/` : "./")) source.duplicates.push(`${was.name} and ${rel.replace(/\//g, "\\")}`);
    source.files.set(lower, { name: rel.replace(/\//g, "\\"), size: p.size, read: p.read, layer: root ? `${root}/` : "./" });
  }
  // A folder the mod's makers ship holds its launcher: the one exe with an archive in it is named as the mod is.
  if (kind === "folder" && source.exes.length === 1) source.name = source.exes[0].file.split("/").pop()!.replace(/\.exe$/i, "");
  if (modName) source.name = modName;
  return source;
}

/** A path for the person: relative to where they are when that is shorter. */
export const shownPath = (p: string) => { const r = relative(process.cwd(), p); return r && !r.startsWith("..") && r.length < p.length ? r : p; };
