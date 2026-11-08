/**
 * `scmjs map unpack <map> [--out dir]` and `scmjs map pack <dir> [--out map]`: a map file as a folder and back. The
 * archive's members become files under the folder at their archive paths (`staredit\scenario.chk` →
 * `staredit/scenario.chk`, a sound under `staredit/wav/`, a script under `trigscript/`), and `archive.json` beside
 * them records what a folder cannot: the file's name, how the scenario was stored (compression, encryption),
 * whether the archive had a file list, and the members with no name (a protected map's), kept byte for byte under
 * `stored/`. Pack reads the folder back — the manifest's members, plus any file added to the folder since — and
 * writes the archive as the manifest says, so unpack then pack gives a map the editor and the game read the same.
 * Nothing is parsed or restored on the way: a built map unpacks into its built scenario and its `scmjs\` members.
 *
 * With `--text` the scenario is written as a folder of text instead of one binary file (`source.ts`), and the
 * manifest (version 2) names that folder; pack rebuilds the scenario from it.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { openMapBytes, readArchive, writeArchiveBytes } from "../../src/editor/mapFile";
import { SCENARIO_PATH, type ArchiveCompression, type StoredMembers } from "../../src/formats/mpq/scm";
import { formatOf } from "../../src/editor/save";
import { folderSource, scenarioFromText, scenarioToText, SECTIONS_FILE, TEXT_FOLDER, writeScenarioText, type TextReport } from "./source";
import { t } from "./i18n";
import { CliError } from "./ui";

export const MANIFEST_FILE = "archive.json";
/** Where the members with no name go, `stored/001.bin` on. */
const STORED_DIR = "stored";

type StoredMemberRecord = Omit<StoredMembers["members"][number], "data"> & { file: string };

export interface ArchiveManifest {
  /** 1, or 2 when the scenario is a folder of text (`scenario.text`). */
  version: 1 | 2;
  /** The map file's name, for `pack` to write beside the folder when `--out` says nothing. */
  fileName: string | null;
  scenario: {
    compression: ArchiveCompression | "other" | null; encrypted: boolean; sectorSize: number | null;
    /** The folder that holds the scenario as text, in place of `staredit/scenario.chk` (version 2). */
    text?: string;
  };
  /** Whether the archive carried a (listfile); one that did not is a protected map, and is written without one. */
  listfile: boolean;
  /** Every member read by name: its archive path and the file it is in. */
  members: { name: string; file: string }[];
  /** The members with no name, as `readMembers` carries them, their bytes in the files named. */
  stored: (Omit<StoredMembers, "members"> & { members: StoredMemberRecord[] }) | null;
  /** What could not be read, in the editor's words. */
  problems: string[];
}

/** A character a file system may refuse (Windows's set, and control characters) is written `%XX`; `/` is a folder. */
export function fileFor(member: string): string {
  const hex = (c: string) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  const escape = (part: string) => [...part].map((c) => (c.charCodeAt(0) < 32 || /[<>:"|?*%]/.test(c) ? hex(c) : c)).join("");
  return member.replace(/\\/g, "/").split("/").map((part) => (part === "." || part === ".." ? part.replace(/\./g, "%2E") : escape(part))).join("/");
}

/** The archive path a file under the folder stands for, when no manifest names it. */
export const memberFor = (file: string): string => decodeURIComponent(file.replace(/\\/g, "/")).replace(/\//g, "\\");

export interface MemberLine { name: string; bytes: number; kind: "scenario" | "member" | "stored" }

/** What the archive holds, one line per member, the scenario first. */
export async function listMembers(bytes: Uint8Array): Promise<{ members: MemberLine[]; listfile: boolean; problems: string[] }> {
  const a = await readArchive(bytes);
  const members: MemberLine[] = [{ name: SCENARIO_PATH, bytes: a.chk.length, kind: "scenario" }];
  for (const [name, data] of [...a.extras].sort(([x], [y]) => x.localeCompare(y))) members.push({ name, bytes: data.length, kind: "member" });
  for (const m of a.stored?.members ?? []) members.push({ name: t("(no name, slot {slot})", { slot: m.slot }), bytes: m.data.length, kind: "stored" });
  return { members, listfile: a.files !== null || !a.origin, problems: a.problems };
}

export interface Unpacked {
  dir: string; files: number; bytes: number; stored: number; manifest: ArchiveManifest;
  /** With `text`: how the scenario came out, how many files it is and their size in bytes. */
  text: (TextReport & { files: number; size: number }) | null;
}

export interface UnpackOptions {
  /** The scenario as a folder of text (`scenario/`) instead of `staredit/scenario.chk`. */
  text?: boolean;
}

/** The archive into `dir` (made if need be): its members as files and `archive.json`. */
export async function unpackMap(bytes: Uint8Array, fileName: string, dir: string, options: UnpackOptions = {}): Promise<Unpacked> {
  const a = await readArchive(bytes);
  const out = resolve(dir);
  const scenarioText = options.text ? scenarioToText(a.chk) : null;
  const written: { file: string; data: Uint8Array }[] = scenarioText ? [] : [{ file: fileFor(SCENARIO_PATH), data: a.chk }];
  const members: ArchiveManifest["members"] = [];
  const taken = new Set<string>([fileFor(SCENARIO_PATH).toLowerCase(), MANIFEST_FILE]);
  for (const [name, data] of a.extras) {
    let file = fileFor(name);
    if (scenarioText && file.toLowerCase().startsWith(`${TEXT_FOLDER}/`)) {
      throw new CliError(t("The map has a file {name}, in the folder --text writes the scenario to", { name }), t("Unpack it without --text."));
    }
    // Two names that differ only in case are two members; a file system may not agree.
    if (taken.has(file.toLowerCase())) { let n = 2; while (taken.has(`${file}.${n}`.toLowerCase())) n++; file = `${file}.${n}`; }
    taken.add(file.toLowerCase());
    members.push({ name, file });
    written.push({ file, data });
  }
  let stored: ArchiveManifest["stored"] = null;
  if (a.stored) {
    const records: StoredMemberRecord[] = a.stored.members.map(({ data, ...rest }, i) => {
      const file = `${STORED_DIR}/${String(i + 1).padStart(3, "0")}.bin`;
      written.push({ file, data });
      return { ...rest, file };
    });
    stored = { hashTable: a.stored.hashTable, sectorSize: a.stored.sectorSize, unreadable: a.stored.unreadable, members: records };
  }
  const manifest: ArchiveManifest = {
    version: scenarioText ? 2 : 1, fileName,
    scenario: { compression: a.origin?.compression ?? null, encrypted: a.origin?.encrypted ?? false, sectorSize: a.origin?.sectorSize ?? null, ...(scenarioText ? { text: TEXT_FOLDER } : {}) },
    listfile: a.files !== null || !a.origin, members, stored, problems: a.problems,
  };
  let textBytes = 0;
  try {
    await mkdir(out, { recursive: true });
    // One form of the scenario in the folder, never both: pack would take the other for a member.
    if (scenarioText) {
      await rm(join(out, fileFor(SCENARIO_PATH)), { force: true });
      textBytes = await writeScenarioText(join(out, TEXT_FOLDER), scenarioText.files);
    } else {
      try { if ((await stat(join(out, TEXT_FOLDER, SECTIONS_FILE))).isFile()) await rm(join(out, TEXT_FOLDER), { recursive: true, force: true }); } catch { /* none */ }
    }
    for (const w of written) {
      await mkdir(dirname(join(out, w.file)), { recursive: true });
      await writeFile(join(out, w.file), w.data);
    }
    await writeFile(join(out, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
  } catch (e) {
    throw new CliError(t("{file} could not be written ({reason})", { file: out, reason: String((e as NodeJS.ErrnoException).code ?? e) }));
  }
  return {
    dir: out, files: written.length + (scenarioText?.files.size ?? 0), bytes: written.reduce((n, w) => n + w.data.length, 0) + textBytes,
    stored: a.stored?.members.length ?? 0, manifest,
    text: scenarioText ? { ...scenarioText.report, files: scenarioText.files.size, size: textBytes } : null,
  };
}

export interface PackOptions {
  /** Where the map goes; else the manifest's file name beside the folder, else `<folder>.scx` beside it. */
  out?: string | null;
  /** Compression for every member, over what the manifest says. */
  compression?: ArchiveCompression;
}

export interface Packed {
  path: string; bytes: number; members: number; stored: number; added: string[]; compression: ArchiveCompression; encrypted: boolean;
  /** Whether the scenario was rebuilt from the folder's text. */
  fromText: boolean;
}

/** Every file under `dir`, as paths relative to it with `/`. */
async function filesUnder(dir: string, under = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(under, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(under, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(dir, path)));
    else out.push(relative(dir, path).replace(/\\/g, "/"));
  }
  return out;
}

/** The folder back into a map file. A file in the folder the manifest does not name becomes a member at its path. */
export async function packMap(dirArg: string, options: PackOptions = {}): Promise<Packed> {
  const dir = resolve(dirArg);
  try {
    if (!(await stat(dir)).isDirectory()) throw new CliError(t("{folder} is not a folder", { folder: dirArg }), t("Name the folder scmjs map unpack wrote."), 2);
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new CliError(t("No folder {folder}", { folder: dirArg }), null, 2);
  }
  let manifest: ArchiveManifest | null = null;
  try {
    const raw = JSON.parse(await readFile(join(dir, MANIFEST_FILE), "utf8")) as Partial<ArchiveManifest>;
    if ((raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.members)) throw new Error(typeof raw.version === "number" && raw.version > 2 ? t("version {version}: a newer scmjs wrote it", { version: raw.version }) : t("not an archive.json this reads"));
    const text = raw.version === 2 && typeof raw.scenario?.text === "string" ? raw.scenario.text : undefined;
    manifest = { version: raw.version, fileName: typeof raw.fileName === "string" ? raw.fileName : null, scenario: { compression: raw.scenario?.compression ?? null, encrypted: raw.scenario?.encrypted === true, sectorSize: raw.scenario?.sectorSize ?? null, ...(text ? { text } : {}) }, listfile: raw.listfile !== false, members: raw.members.filter((m): m is { name: string; file: string } => typeof m?.name === "string" && typeof m?.file === "string"), stored: raw.stored ?? null, problems: [] };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new CliError(t("{file} could not be read: {message}", { file: join(dirArg, MANIFEST_FILE), message: String(e instanceof Error ? e.message : e) }), t("Delete it to pack the folder's files as they are."));
  }
  const all = await filesUnder(dir);
  const byLower = new Map(all.map((f) => [f.toLowerCase(), f]));
  const read = async (file: string) => {
    const actual = byLower.get(file.toLowerCase());
    if (!actual) throw new CliError(t("{file} is named in {manifest} but is not in the folder", { file, manifest: MANIFEST_FILE }), t("Take the line out of the manifest, or put the file back."));
    return new Uint8Array(await readFile(join(dir, actual)));
  };
  const scenarioFile = byLower.get(fileFor(SCENARIO_PATH).toLowerCase());
  // The scenario as text: the manifest says so, or (with no manifest) the folder has the text and no scenario file.
  const textFolder = manifest?.scenario.text ?? (!scenarioFile && byLower.has(`${TEXT_FOLDER}/${SECTIONS_FILE}`) ? TEXT_FOLDER : null);
  if (!scenarioFile && !textFolder) throw new CliError(t("{folder} has no {file}", { folder: dirArg, file: fileFor(SCENARIO_PATH) }), t("A map is its scenario; the folder scmjs map unpack writes has one."));
  const chk = textFolder ? scenarioFromText(await folderSource(join(dir, textFolder))) : new Uint8Array(await readFile(join(dir, scenarioFile!)));
  const used = new Set<string>([MANIFEST_FILE]);
  if (textFolder) for (const f of all) { if (f.toLowerCase().startsWith(`${textFolder.toLowerCase()}/`)) used.add(f.toLowerCase()); }
  else used.add(scenarioFile!.toLowerCase());
  const extras = new Map<string, Uint8Array>();
  for (const m of manifest?.members ?? []) {
    extras.set(m.name, await read(m.file));
    used.add(m.file.toLowerCase());
  }
  let stored: StoredMembers | null = null;
  if (manifest?.stored) {
    const members = [];
    for (const r of manifest.stored.members) {
      const { file, ...rest } = r;
      members.push({ ...rest, data: await read(file) });
      used.add(file.toLowerCase());
    }
    stored = { hashTable: manifest.stored.hashTable, sectorSize: manifest.stored.sectorSize, unreadable: manifest.stored.unreadable ?? [], members };
  }
  // Files the manifest does not know: added to the folder since, members at their paths.
  const added: string[] = [];
  for (const file of all) {
    if (used.has(file.toLowerCase())) continue;
    const name = memberFor(file);
    extras.set(name, new Uint8Array(await readFile(join(dir, file))));
    added.push(name);
  }
  const path = options.out ?? join(dirname(dir), manifest?.fileName ?? `${basename(dir)}.scx`);
  const compression: ArchiveCompression = options.compression ?? (manifest?.scenario.compression === "zlib" || manifest?.scenario.compression === "pkware" ? manifest.scenario.compression : manifest?.scenario.compression === "other" ? "pkware" : "none");
  const encrypted = manifest?.scenario.encrypted ?? false;
  let bytes: Uint8Array;
  if (formatOf(path) === "chk") {
    if (extras.size || stored) throw new CliError(t("A bare .chk has no room for the archive's other members."), t("Write an .scx or .scm instead."));
    bytes = chk;
  } else {
    bytes = await writeArchiveBytes(chk, { extras, stored, compression, encrypt: encrypted, listfile: manifest?.listfile ?? true });
  }
  // What was written has to open as a map; the folder's scenario may be anything.
  try {
    await openMapBytes(bytes, basename(path));
  } catch (e) {
    throw new CliError(t("The packed file is not a map the editor reads: {message}", { message: String(e instanceof Error ? e.message : e) }), textFolder ? t("The text in {folder}/ has to make a scenario.", { folder: textFolder }) : t("{file} has to be a scenario.", { file: fileFor(SCENARIO_PATH) }));
  }
  try {
    await writeFile(path, bytes);
  } catch (e) {
    throw new CliError(t("{file} could not be written ({reason})", { file: path, reason: String((e as NodeJS.ErrnoException).code ?? e) }));
  }
  return { path, bytes: bytes.length, members: extras.size, stored: stored?.members.length ?? 0, added, compression, encrypted, fromText: !!textFolder };
}
