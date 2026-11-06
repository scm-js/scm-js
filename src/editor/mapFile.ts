/**
 * A map file as bytes, in and out — the half of opening and saving that needs no browser.
 *
 * `openMapBytes` is what File ▸ Open, a drop, the command line and `@scm-js/core` all run:
 * the archive read, the scenario parsed, the other members kept, a built map restored to the
 * map it was built from, and the warnings the editor would show. `writeMapBytes` is the
 * reverse. The pickers, handles and downloads around them are `services/mapIo.ts`.
 */
import { parseScenario, type Scenario } from "../formats/chk/scenario";
import { loadMap, readMembers, type MemberInfo, type StoredMembers } from "../formats/mpq/scm";
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

/** Read a map file's bytes (.scm, .scx or a bare .chk) into a parsed scenario and the rest of its archive. */
export async function openMapBytes(bytes: Uint8Array, fileName: string | null): Promise<OpenedMap> {
  const loaded = await loadMap(bytes);
  const problems: string[] = [];
  let members = { extras: new Map<string, Uint8Array>(), stored: null as StoredMembers | null };
  let scenario = parseScenario(loaded.chk);
  let builtBy: BuiltBy[] | null = null;
  if (loaded.archive) {
    // The names a protected archive still gives up: what the scenario refers to, the script's files, a built map's members.
    const hints = [...referencedMembers(scenario), BUILD_SOURCE_MEMBER, BUILD_MANIFEST_MEMBER];
    members = await readMembers(loaded.archive, loaded.files, hints, problems, (extras) => {
      const more: string[] = [];
      for (const [name, bytes] of extras) {
        const key = name.replace(/\//g, "\\").toLowerCase();
        if (key === MANIFEST_MEMBER.toLowerCase()) more.push(...scriptMembersFromManifest(bytes));
        if (key === BUILD_MANIFEST_MEMBER) more.push(...(readBuildManifest(bytes)?.added ?? []));
      }
      return more;
    });
    // A built map gives back the map it was built from; one changed since opens as it is.
    const restored = await restoreBuiltMap(loaded.chk, members.extras);
    if (restored.kind === "restored") { scenario = parseScenario(restored.chk); members.extras = restored.extras; builtBy = restored.builtBy; }
    else if (restored.kind === "changed") problems.push(t("This file was built by {labels}, and its scenario has been changed since by something else, so it is open as the file has it — generated triggers and all. The map from before the build is still inside, as {member}.", { labels: restored.builtBy.map((b) => b.label).join(", "), member: BUILD_SOURCE_MEMBER }));
  }
  scenario.warnings.push(...problems);
  const { extras, stored } = members;
  if (stored) {
    const n = stored.members.length - stored.unreadable.length;
    if (n > 0) scenario.warnings.push(t("{n, plural, one {# archive member has no name the editor knows{list}; it is} other {# archive members have no name the editor knows{list}; they are}} kept in a saved copy exactly as stored.", { n, list: loaded.files ? "" : t(" (the archive has no file list)") }));
  }
  return { scenario, extras, stored, fileName, origin: loaded.scenarioInfo, builtBy };
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
