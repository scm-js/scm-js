/**
 * A map file as bytes, in and out — the half of opening and saving that needs no browser.
 *
 * `openMapBytes` is what File ▸ Open, a drop, the command line and `@scm-js/core` all run:
 * the archive read, the scenario parsed, the other members kept, a built map restored to the
 * map it was built from, and the warnings the editor would show. `writeMapBytes` is the
 * reverse. The pickers, handles and downloads around them are `services/mapIo.ts`.
 */
import { parseChk } from "../formats/chk/reader";
import { parseScenario, type Scenario } from "../formats/chk/scenario";
import { SECTION_SPECS } from "../formats/chk/sections/registry";
import { loadMap, MapLoadError, readMembers, requiredSectorSize, saveMap, SCENARIO_PATH, STAREDIT_SECTOR_SIZE, type ArchiveCompression, type MemberInfo, type StoredMembers } from "../formats/mpq/scm";
import { referencedMembers } from "./sounds";
import { buildMapFile, DEFAULT_SAVE_OPTIONS, MANIFEST_MEMBER, scriptMembersFromManifest, type MapFormat, type SaveOptions } from "./save";
import { BUILD_MANIFEST_MEMBER, BUILD_SOURCE_MEMBER, readBuildManifest, restoreBuiltMap, type BuiltBy } from "./mapBuild";
import { t } from "../i18n";

/** What a map file held, read the way the editor reads it. */
export interface OpenedMap {
  scenario: Scenario;
  /** The archive's other members (sounds, scripts, anything else) by name, as read. */
  extras: Map<string, Uint8Array>;
  /** Members carried as stored (`readMembers`); none when omitted. */
  stored?: StoredMembers | null;
  fileName: string | null;
  /** How the scenario was stored in the archive it came from; null for a bare .chk. */
  origin?: MemberInfo | null;
  /** The build steps the file names, when the map was restored from a built one. */
  builtBy?: BuiltBy[] | null;
}

/** A map file's archive as it is: the scenario's bytes and every other member, nothing restored or parsed. */
export interface ArchiveContents {
  /** `staredit\scenario.chk` as stored — a built map's built scenario, not its source. */
  chk: Uint8Array;
  /** Every other member read by name. */
  extras: Map<string, Uint8Array>;
  /** Members with no name the archive gives up, carried as stored; null when there are none. */
  stored: StoredMembers | null;
  /** How the scenario was stored; null for a bare .chk. */
  origin: MemberInfo | null;
  /** The archive's (listfile), or null when it has none (a protected map) — or is a bare .chk. */
  files: string[] | null;
  /** What could not be read, in the editor's words. */
  problems: string[];
}

/**
 * Read a map file's bytes as an archive: the scenario's bytes and the other members, by name where the archive —
 * its (listfile), what the scenario refers to, a script's manifest, a build's — gives one up, as stored where not.
 * `openMapBytes` builds on this; `scmjs map unpack` takes it as it is.
 */
export async function readArchive(bytes: Uint8Array): Promise<ArchiveContents> {
  const loaded = await loadMap(bytes);
  if (!looksLikeScenario(loaded.chk)) {
    throw new MapLoadError(loaded.archive
      ? t("The archive's {path} holds no section a map has", { path: SCENARIO_PATH })
      : t("Neither an MPQ archive nor a scenario (no section a map has)"));
  }
  const problems: string[] = [];
  let members = { extras: new Map<string, Uint8Array>(), stored: null as StoredMembers | null };
  if (loaded.archive) {
    // The names a protected archive still gives up: what the scenario refers to, the script's files, a built map's members.
    const hints = [...referencedMembers(parseScenario(loaded.chk)), BUILD_SOURCE_MEMBER, BUILD_MANIFEST_MEMBER];
    members = await readMembers(loaded.archive, loaded.files, hints, problems, (extras) => {
      const more: string[] = [];
      for (const [name, bytes] of extras) {
        const key = name.replace(/\//g, "\\").toLowerCase();
        if (key === MANIFEST_MEMBER.toLowerCase()) more.push(...scriptMembersFromManifest(bytes));
        if (key === BUILD_MANIFEST_MEMBER) more.push(...(readBuildManifest(bytes)?.added ?? []));
      }
      return more;
    });
  }
  return { chk: loaded.chk, ...members, origin: loaded.scenarioInfo, files: loaded.files, problems };
}

/**
 * Whether bytes are a scenario at all: at least one whole section (its length fits in the file) of a name the game
 * reads. Every map the game plays has several — protected ones too, since the game reads the sections the same way
 * from the start — while a text file, an empty file or random bytes have none: their first length runs past the end.
 * Without this, any bytes opened as a blank 64 × 64 map, and a Save wrote a map over them.
 */
export function looksLikeScenario(chk: Uint8Array): boolean {
  return parseChk(chk).sections.some((s) => !s.truncated && SECTION_SPECS.has(s.name));
}

export interface WriteArchiveOptions {
  extras?: Map<string, Uint8Array>;
  /** Members carried as stored; the archive then keeps their sector size. */
  stored?: StoredMembers | null;
  /** How every member is compressed; uncompressed when omitted. */
  compression?: ArchiveCompression;
  encrypt?: boolean;
  /** Write a (listfile) naming the members (default on). */
  listfile?: boolean;
}

/** The archive around a scenario's bytes as given — `readArchive` the other way; the editor's sector rule (zlib likes big sectors). */
export function writeArchiveBytes(chk: Uint8Array, options: WriteArchiveOptions = {}): Promise<Uint8Array> {
  const compression = options.compression ?? "none";
  return saveMap(chk, {
    extras: options.extras, stored: options.stored ?? null, compress: compression, encrypt: options.encrypt ?? false, listfile: options.listfile ?? true,
    sectorSize: requiredSectorSize(options.stored, compression === "zlib" ? 0x10000 : STAREDIT_SECTOR_SIZE),
  });
}

/** Read a map file's bytes (.scm, .scx or a bare .chk) into a parsed scenario and the rest of its archive. */
export async function openMapBytes(bytes: Uint8Array, fileName: string | null): Promise<OpenedMap> {
  const archive = await readArchive(bytes);
  const problems = archive.problems;
  const members = { extras: archive.extras, stored: archive.stored };
  let scenario = parseScenario(archive.chk);
  let builtBy: BuiltBy[] | null = null;
  if (archive.origin) {
    // A built map gives back the map it was built from; one changed since opens as it is.
    const restored = await restoreBuiltMap(archive.chk, members.extras);
    if (restored.kind === "restored") { scenario = parseScenario(restored.chk); members.extras = restored.extras; builtBy = restored.builtBy; }
    else if (restored.kind === "changed") problems.push(t("This file was built by {labels}, and its scenario has been changed since by something else, so it is open as the file has it — generated triggers and all. The map from before the build is still inside, as {member}.", { labels: restored.builtBy.map((b) => b.label).join(", "), member: BUILD_SOURCE_MEMBER }));
  }
  scenario.warnings.push(...problems);
  const { extras, stored } = members;
  if (stored) {
    const n = stored.members.length - stored.unreadable.length;
    if (n > 0) scenario.warnings.push(t("{n, plural, one {# archive member has no name the editor knows{list}; it is} other {# archive members have no name the editor knows{list}; they are}} kept in a saved copy exactly as stored.", { n, list: archive.files ? "" : t(" (the archive has no file list)") }));
  }
  return { scenario, extras, stored, fileName, origin: archive.origin, builtBy };
}

export interface WriteOptions {
  format: MapFormat;
  extras?: Map<string, Uint8Array>;
  /** Members carried as stored, from the archive the map was opened from. */
  stored?: StoredMembers | null;
  /** Compression, stripping and the rest; everything kept and uncompressed when omitted. */
  options?: Partial<Omit<SaveOptions, "format">>;
}

/** Serialise the scenario to the bytes that belong in the target file. */
export async function writeMapBytes(scenario: Scenario, options: WriteOptions): Promise<Uint8Array> {
  return buildMapFile(scenario, options.extras ?? new Map(), { ...DEFAULT_SAVE_OPTIONS, ...options.options, format: options.format }, undefined, options.stored ?? null);
}
