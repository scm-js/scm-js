/**
 * The open map as the bytes Save would write, section by section, and raw edits to them.
 *
 * The scenario keeps the file it was read from (`Scenario.chk`) and re-encodes only the
 * dirty sections on save, so "the current bytes of a section" is not a field anywhere —
 * it is what `serializeScenario` would emit. `currentChk` runs that serialisation and
 * parses the result back into a `ChkFile`, which gives every occurrence in write order
 * with its offset; `sectionInfos` decorates those with what the registry knows.
 *
 * A raw edit (`editRaw`) goes the other way: mutate that `ChkFile`, serialise it and
 * parse a fresh `Scenario` from the bytes. The typed model is rebuilt from scratch, so an
 * edit to any section — modelled or not — is seen by every part of the editor, at the
 * cost of the undo history, which the caller drops the way Resize does. Nothing here
 * touches the store; `replaceScenarioAtom` installs the result.
 */
import { combine, parseChk, serializeChk, type ChkFile, type ChkSection, type CombineMode } from "../formats/chk/reader";
import { createScenario, rawCreatedSections, requiredSections } from "../formats/chk/create";
import { MODELLED_SECTIONS, parseScenario, scenarioName, serializeScenario, type Scenario } from "../formats/chk/scenario";
import { SECTION_SPECS, sizeOf, specFor, type Dim } from "../formats/chk/sections/registry";

/** What the registry knows about a section name, sized for one map. */
export interface SectionKnowledge {
  name: string;
  /** "Placed units", "String table", … */
  what: string;
  /** How the game combines repeated occurrences. */
  mode: CombineMode;
  /** The fixed buffer the game reads the section into, for this map's size; null when the length varies. */
  size: number | null;
  /** The record length of a list section, or null. */
  stride: number | null;
  /** Whether the editor decodes the section into its model and re-encodes it on save. */
  modelled: boolean;
}

/** One occurrence of a section in the file, as Save would write it. */
export interface SectionInfo {
  /** Position in the file's section list — what the byte-level calls take. */
  index: number;
  /** The four characters as stored (`"VER "` keeps its space); junk in a protected map. */
  name: string;
  /** Byte offset of the eight-byte chunk header within the CHK. */
  offset: number;
  /** Payload length. */
  size: number;
  /** The length field as written; differs from `size` only when the file ended early. */
  declaredSize: number;
  truncated: boolean;
  /** Which occurrence of this name it is, 0-based, and how many the file has. */
  occurrence: number;
  occurrences: number;
  /** Whether the editor has unsaved changes it will encode into this section on save. */
  dirty: boolean;
  /** The registry entry, or null for a section the editor has never heard of. */
  spec: SectionKnowledge | null;
}

/** A section name is four characters; shorter ones are padded with spaces, as the game's own are. */
export function sectionName(name: string): string {
  if (name.length > 4) throw new RangeError(`A section name is four characters: "${name}"`);
  return name.padEnd(4, " ");
}

export function sectionKnowledge(name: string, dim: Dim): SectionKnowledge | null {
  const spec = specFor(name);
  if (!spec) return null;
  return {
    name: spec.name,
    what: spec.what,
    mode: spec.mode,
    size: sizeOf(spec, dim) ?? null,
    stride: spec.stride ?? null,
    modelled: MODELLED_SECTIONS.has(spec.name),
  };
}

/** Every section the registry knows, in its order. */
export function knownSections(dim: Dim): SectionKnowledge[] {
  return [...SECTION_SPECS.keys()].map((name) => sectionKnowledge(name, dim)!);
}

/** The file Save would write, parsed back so every section has its offset. */
export function currentChk(scn: Scenario): ChkFile {
  return parseChk(serializeScenario(scn));
}

export function sectionInfos(scn: Scenario, file: ChkFile = currentChk(scn)): SectionInfo[] {
  const dim = { width: scn.width, height: scn.height };
  const counts = new Map<string, number>();
  for (const s of file.sections) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return file.sections.map((s, index) => {
    const occurrence = seen.get(s.name) ?? 0;
    seen.set(s.name, occurrence + 1);
    return {
      index,
      name: s.name,
      offset: s.offset,
      size: s.data.length,
      declaredSize: s.declaredSize,
      truncated: s.truncated === true,
      occurrence,
      occurrences: counts.get(s.name) ?? 1,
      dirty: scn.dirty.has(s.name),
      spec: sectionKnowledge(s.name, dim),
    };
  });
}

/** The bytes the game acts on for a name — repeats combined the way the registry says — or null when absent. */
export function combinedSection(scn: Scenario, name: string, file: ChkFile = currentChk(scn)): Uint8Array | null {
  const spec = specFor(name);
  const dim = { width: scn.width, height: scn.height };
  return combine(file, name, spec?.mode ?? "last", spec ? sizeOf(spec, dim) : undefined);
}

/* ── Raw edits ──────────────────────────────────────────── */

function checkIndex(file: ChkFile, index: number, allowEnd = false) {
  const max = allowEnd ? file.sections.length : file.sections.length - 1;
  if (!Number.isInteger(index) || index < 0 || index > max) throw new RangeError(`No section at index ${index} (the file has ${file.sections.length}).`);
}

const chunk = (name: string, data: Uint8Array): ChkSection => ({ name: sectionName(name), offset: -1, declaredSize: data.length, data: data.slice() });

/** Replace one occurrence's payload. */
export function replaceSectionData(file: ChkFile, index: number, data: Uint8Array) {
  checkIndex(file, index);
  const s = file.sections[index];
  file.sections[index] = { ...s, data: data.slice(), declaredSize: data.length, truncated: undefined };
}

/** Rename one occurrence. */
export function renameSection(file: ChkFile, index: number, name: string) {
  checkIndex(file, index);
  file.sections[index] = { ...file.sections[index], name: sectionName(name) };
}

/** Insert a section before `index` (`sections.length` appends). */
export function insertSection(file: ChkFile, index: number, name: string, data: Uint8Array) {
  checkIndex(file, index, true);
  file.sections.splice(index, 0, chunk(name, data));
}

export function removeSection(file: ChkFile, index: number) {
  checkIndex(file, index);
  file.sections.splice(index, 1);
}

/** Move the occurrence at `from` so it sits at `to` in the resulting list. */
export function moveSection(file: ChkFile, from: number, to: number) {
  checkIndex(file, from);
  checkIndex(file, to);
  const [s] = file.sections.splice(from, 1);
  file.sections.splice(to, 0, s);
}

/**
 * Apply `mutate` to the file Save would write and parse a fresh scenario from the result.
 * The returned scenario is a new object with an empty dirty set — every section it
 * carries is now the file's own bytes — and `warnings` says what the parser thought of it.
 */
export function editRaw(scn: Scenario, mutate: (file: ChkFile) => void): Scenario {
  const file = currentChk(scn);
  mutate(file);
  return parseScenario(serializeChk(file));
}

/** Parse a whole CHK the way File ▸ Open does, for a plugin that rewrote the file itself. */
export function parseRaw(bytes: Uint8Array): Scenario {
  return parseScenario(bytes.slice());
}

/**
 * The bytes File ▸ New writes for a section, for a map of this one's size, tileset and
 * revision: StarEdit's defaults for the settings tables, the fixed VCOD, empty lists,
 * null terrain. Null for a name the editor cannot produce (one it does not model, or a
 * modelled one that is optional and absent on a new map — CRGB, SWNM).
 */
export function defaultSectionBytes(scn: Scenario, name: string): Uint8Array | null {
  const raw = rawCreatedSections().find((s) => s.name === name);
  if (raw) return raw.data.slice();
  if (!MODELLED_SECTIONS.has(name)) return null;
  const fresh = createScenario({ width: scn.width, height: scn.height, era: scn.era, name: scenarioName(scn) ?? "Untitled Scenario" });
  fresh.fileVersion = scn.fileVersion;
  fresh.type = scn.type;
  fresh.strings.extended = scn.strings.extended;
  const file = parseChk(serializeScenario({ ...fresh, dirty: new Set([...fresh.dirty, name]) }));
  return file.sections.find((s) => s.name === name)?.data.slice() ?? null;
}

/** What `rebuildSections` did: the parser's remarks and the sections actually re-encoded. */
export interface RebuildResult {
  warnings: string[];
  rebuilt: string[];
}

/**
 * Re-encode sections from the editor's model — the way Save writes a dirty section — and
 * parse the result as a fresh scenario. Repeated occurrences collapse into one, a
 * truncated or oversized section comes back at the size the model encodes to, and a string
 * table with offsets pointing nowhere is rewritten with every string the editor could read.
 * Names the editor does not model, and modelled ones whose model is absent (`isom` null,
 * no settings table), are left as they are and missing from `rebuilt`; omit `names` to
 * rebuild every modelled section the map has a model for.
 */
export function rebuildSections(scn: Scenario, names?: readonly string[]): { scenario: Scenario; result: RebuildResult } {
  const wanted = (names ?? [...MODELLED_SECTIONS]).map(sectionName).filter((n) => MODELLED_SECTIONS.has(n));
  const dirty = new Set([...scn.dirty, ...wanted]);
  const bytes = serializeScenario({ ...scn, dirty });
  const file = parseChk(bytes);
  const present = new Set(file.sections.map((s) => s.name));
  const scenario = parseScenario(bytes);
  return { scenario, result: { warnings: [...scenario.warnings], rebuilt: wanted.filter((n) => present.has(n)) } };
}

/** The sections a file of this map's revision must carry to load, as Check Map tests them. */
export function requiredSectionNames(scn: Scenario): string[] {
  return requiredSections(scn.fileVersion).map((n) => (n === "STR " && scn.strings.extended ? "STRx" : n));
}
