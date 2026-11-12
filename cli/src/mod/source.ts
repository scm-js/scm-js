/**
 * A mod as the person names it, read by `@scm-js/mod` (`readMod`): a folder, one `.mpq`, a self-executing `.exe`
 * (MPQDraft's or FireGraft's — read, never run), a `.zip` of any of these, or a mod folder `scmjs mod unpack` wrote
 * (packed in memory first, then read the same way). What a mod's files are, its layers, its code and its hash are the
 * package's; here they are put in the shape the `mod` commands work with — the game files by name, the plugins and
 * FireGraft files, the code the hash has lines for — and what the command line says before or instead of reading:
 * a path that is not there, an empty folder, a replay, a map or a bot named where a mod goes.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { Archive } from "mopaq";
import {
  fileReaders, firegraftBytes, gameCopyText, gameName, isMpq, isPluginFile, isZip, ModError, moduleBytes, openLayer, readMod,
  type DataSetRace, type Layer, type ModDescription, type ModFiles, type ModMessage,
} from "@scm-js/mod";
import { diskFiles } from "@scm-js/mod/node";
import { MOD_MANIFEST, readManifest, type ModManifest } from "../../../src/formats/mod/folder";
import type { GameFiles } from "../gamefiles";
import { modText, t } from "../i18n";
import { CliError } from "../ui";
import { detectFormat } from "@scm-js/replay";

export interface SourceFile {
  /** The name as the source spells it (`arr\units.datex`, `unit/Terran/marine.grp` made `unit\Terran\marine.grp`). */
  name: string;
  size: number;
  read(): Promise<Uint8Array>;
  /** The layer it came from. */
  layer: string;
}

/**
 * A plugin, library or FireGraft file of the mod (never run): its file name, its size, its bytes, where it is.
 * `member`: inside one of the mod's archives (a plugin there is loaded by no loader). `role`: what the package says
 * a module is (`plugin`, `plugin-loader`, `library`, …), for the code the hash has lines for.
 */
export interface CarriedFile { name: string; bytes: number; read(): Promise<Uint8Array>; member?: string; layer: string; role?: string }

export type SourceKind = "mod folder" | "folder" | "archive" | "exe" | "zip" | "game";

export interface ModSource {
  /** What the person named. */
  path: string;
  kind: SourceKind;
  name: string;
  /** The layers, in the order they are laid (the later wins), as the folder or file given spells them. */
  layers: string[];
  /** The mod's files by the game's name (lower case, backslashes). */
  files: Map<string, SourceFile>;
  /** The plugin files the mod has, and plugins inside its archives (`member`: no loader loads one from there). */
  plugins: CarriedFile[];
  /** Its FireGraft project and database. */
  firegraft: CarriedFile[];
  /**
   * Every module of the mod's code the hash has a line for, by the module's name: the plugin files, the plugins a
   * patcher exe carries in itself, the libraries its plugins load. What a runner or the play page is handed to run it.
   */
  code: CarriedFile[];
  /** A mod folder's manifest (the text form `mod unpack` writes). */
  manifest: ModManifest | null;
  /** The races the mod adds, as its `mod.json` declares them; empty when none are declared. */
  races: DataSetRace[];
  /** Its makers' address, from its `mod.json`. */
  link: string | null;
  /** What `@scm-js/mod` read the mod as (null for the game's own files, `gameSource`), and the files it read it from. */
  description: ModDescription | null;
  tree: ModFiles | null;
  /** A copy of the game in what was given: its archives, as the folder or zip spells them, left out. */
  gameCopy: string[];
  /** Files that are no part of the mod, as the folder spells them. */
  left: string[];
  /** Archives with no list of their files, read by the names the game uses. */
  probed: string[];
  /** Names an archive lists and does not hold, or that could not be read (by game name, with the archive's). */
  unheld: string[];
  /** What `@scm-js/mod` said of the mod, its paths as the folder given spells them. */
  said: ModMessage[];
}

/** A source's files read by the game's name, any case, or null. */
export const reader = (source: ModSource) => async (name: string): Promise<Uint8Array | null> => {
  const f = source.files.get(gameName(name));
  return f ? f.read() : null;
};

/** What a mod is, for a hint after a refusal. */
const nameAMod = () => t("Name a mod: a folder, an .mpq, a mod's .exe, a .zip, or a folder scmjs mod unpack wrote.");

/**
 * A file that is some other kind of thing scmjs reads, said as that kind with the command that reads it; null when it
 * is none of them. A map is a `.chk`, or an archive holding a scenario (a `.scx` or `.scm`, whatever its name).
 */
function otherKind(path: string, bytes: Uint8Array): CliError | null {
  if (detectFormat(bytes)) return new CliError(t("{path} is a replay, not a mod.", { path }), t("scmjs replay info reads a replay."), 2);
  if (bytes.length >= 8 && String.fromCharCode(...bytes.subarray(0, 8)) === "SCMBOT1\n") return new CliError(t("{path} is a bot, not a mod.", { path }), t("scmjs bot run plays a bot."), 2);
  let map = /\.chk$/i.test(path) && !isMpq(bytes);
  if (!map && isMpq(bytes)) { try { map = !!Archive.open(bytes).fileInfo("staredit\\scenario.chk"); } catch { map = false; } }
  if (map) return new CliError(t("{path} is a map, not a mod.", { path }), t("scmjs map info reads a map."), 2);
  return null;
}

/** Nothing of a mod's in it: no game file, no archive laid, no module of code, no FireGraft project. */
const holdsNothing = (d: ModDescription) => !d.files.length && !d.modules.length && !d.patches.length && !d.layers.some((l) => l.kind === "archive");

/** A sentence of the package's as a refusal (exit 2). */
const refusal = (message: ModMessage, hint: string | null = null) => new CliError(modText(message), hint, 2);

/** Opens what the person named. A mod folder is packed in memory by `pack` (handed in, to keep the modules apart). */
export async function openModSource(path: string, packed: (dir: string, manifest: ModManifest) => Promise<ModSource>): Promise<ModSource> {
  let s;
  try { s = await stat(path); } catch { throw new CliError(t("No file or folder {path}", { path }), nameAMod(), 2); }
  if (s.isDirectory()) {
    const manifest = await folderManifest(path);
    if (manifest) return packed(path, manifest);
    const tree = diskFiles(path);
    if (!(await tree.list()).length) throw new CliError(t("{path} is an empty folder: there is no mod in it.", { path }), nameAMod(), 2);
    const source = await describedSource(path, "folder", tree);
    if (holdsNothing(source.description!)) throw new CliError(t("{path} holds none of the game's files: it is not a mod.", { path }), nameAMod(), 2);
    return source;
  }
  const bytes = new Uint8Array(await readFile(path));
  const kind: SourceKind = isZip(bytes) ? "zip" : isMpq(bytes) ? "archive" : bytes[0] === 0x4d && bytes[1] === 0x5a ? "exe" : "archive";
  if (kind === "archive" && !isMpq(bytes)) throw otherKind(path, bytes) ?? new CliError(t("{path} is not a mod: not an MPQ, a self-executing exe or a zip.", { path }), null, 2);
  // (a map or a replay named where a mod goes is said as what it is, before it is read as a mod's archive)
  if (!/\.(mpq|exe|zip)$/i.test(path)) { const other = otherKind(path, bytes); if (other) throw other; }
  const source = await describedSource(path, kind, diskFiles(path), kind === "exe" ? nameAMod() : null);
  if (holdsNothing(source.description!)) throw otherKind(path, bytes) ?? new CliError(t("{path} holds none of the game's files: it is not a mod.", { path }), nameAMod(), 2);
  return source;
}

/**
 * The manifest of a mod folder, or null when the folder has no `mod.json` or one scmjs did not write (a folder of the
 * game's files may carry one declaring its name and races). A `mod.json` that is not JSON at all is said, with where,
 * rather than the folder read as if it had none.
 */
export async function folderManifest(dir: string): Promise<ModManifest | null> {
  const file = resolve(dir, MOD_MANIFEST);
  let text: string;
  try { text = await readFile(file, "utf8"); } catch { return null; }
  try { JSON.parse(text); } catch (e) {
    throw new CliError(t("{file} is not valid JSON: {why}", { file, why: (e as Error).message }), t("Mend it in a text editor, or unpack the mod again into a new folder."), 2);
  }
  try { return readManifest(text); } catch (e) { throw new CliError((e as Error).message, null, 2); }
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
  return { path, kind, name, layers: [], files: new Map(), plugins: [], firegraft: [], code: [], manifest: null, races: [], link: null, description: null, tree: null, gameCopy: [], left: [], probed: [], unheld: [], said: [] };
}

/**
 * The mod in `tree` read by the package (`readMod`), as a source: its game files with a reader each, its plugins and
 * FireGraft files, the code its hash has lines for. A mod that cannot be read at all, or that is a copy of the game
 * and nothing else, is refused in the package's words (`hint` after a refusal of the first kind).
 */
export async function describedSource(path: string, kind: SourceKind, tree: ModFiles, hint: string | null = null): Promise<ModSource> {
  let d: ModDescription;
  try { d = await readMod(tree); } catch (e) { if (e instanceof ModError) throw refusal(e.detail, e.detail.key === "exe-no-archive" ? hint : null); throw e; }
  // (paths as the folder given spells them: a folder's tree starts with its own name, a zip's members with the zip's)
  const top = kind === "folder" ? basename(resolve(path)) : kind === "zip" ? basename(path).replace(/\.zip$/i, "") : "";
  const shown = (p: string) => (top && p.startsWith(`${top}/`) ? p.slice(top.length + 1) : p === top ? "" : p);
  const copyOnly = d.said.find((m) => m.key === "copy-only");
  if (copyOnly) {
    const folder = shown(String(copyOnly.params.folder));
    throw refusal({ ...copyOnly, params: { folder: folder || path } } as ModMessage);
  }
  const layerName = (l: Layer) => (l.kind === "archive" ? shown(l.path) : shown(l.path) ? `${shown(l.path)}/` : "./");
  const source = emptySource(path, kind, d.name);
  source.description = d;
  source.tree = tree;
  source.races = d.races ?? [];
  source.link = d.link ?? null;
  source.layers = d.layers.map(layerName);
  const readOf = fileReaders(tree, d);
  for (const f of d.files) {
    const l = d.layers[f.layer];
    const name = f.member ?? (l.path ? f.path!.slice(l.path.length + 1) : f.path!).replace(/\//g, "\\");
    source.files.set(f.name, { name, size: f.size, read: readOf(f), layer: layerName(l) });
  }
  for (const m of d.modules) {
    if (m.source.kind !== "file" || !isPluginFile(m.name)) continue;
    source.plugins.push({ name: m.name, bytes: m.size, read: () => moduleBytes(tree, m), layer: shown(m.source.path), role: m.role });
  }
  // (a plugin inside one of the mod's archives: listed, never loaded, no line of the hash)
  for (const c of d.carried) {
    if (c.source?.kind !== "member") continue;
    const s = c.source, layer = d.layers.find((l) => l.path === s.archive);
    const archive = layer ? await openLayer(tree, layer) : null;
    const size = (() => { try { return archive?.fileInfo(s.member)?.uncompressedSize ?? 0; } catch { return 0; } })();
    source.plugins.push({ name: c.name, bytes: size, read: async () => archive?.readFile(s.member) ?? new Uint8Array(0), member: s.member, layer: shown(s.archive) });
  }
  for (const f of d.patches[0]?.files ?? []) {
    source.firegraft.push({ name: f.name, bytes: f.size, read: () => firegraftBytes(tree, d, f), ...(f.member ? { member: f.member } : {}), layer: shown(f.archive ?? f.path ?? "") });
  }
  for (const name of Object.keys(d.identity.plugins)) {
    const m = d.modules.find((x) => x.name === name && x.sha256 === d.identity.plugins[name]);
    if (!m) continue;
    const from = m.source.kind === "file" ? m.source.path : m.source.kind === "carried" ? m.source.exe : m.source.archive;
    source.code.push({ name: m.name, bytes: m.size, read: () => moduleBytes(tree, m), layer: shown(from), role: m.role });
  }
  source.gameCopy = d.gameCopy.map(shown).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  source.left = d.left.map((l) => shown(l.path));
  source.probed = d.layers.filter((l) => l.probed).map((l) => shown(l.path));
  source.unheld = d.unreadable.map((u) => u.replace(/ \(([^()]*)\)$/, (_, p: string) => ` (${shown(p)})`));
  source.said = d.said.map((m) => ("path" in m.params && typeof m.params.path === "string" ? { ...m, params: { ...m.params, path: shown(m.params.path) } } as ModMessage : m));
  return source;
}

/** The sentences the package says of the copies of the game left out: one a copy, its folder as the person gave it. */
export function gameCopySaid(source: Pick<ModSource, "path" | "gameCopy">): ModMessage[] {
  return gameCopyText(source.gameCopy, shownPath(source.path));
}

/** A path for the person: relative to where they are when that is shorter. */
export const shownPath = (p: string) => { const r = relative(process.cwd(), p); return r && !r.startsWith("..") && r.length < p.length ? r : p; };
