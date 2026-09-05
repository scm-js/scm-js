/**
 * Save options: what File ▸ Save As offers before a file is written, and the pure functions
 * behind the dialog's preview and the write itself.
 *
 * Saving has three layers, and the options touch all of them:
 * - the CHK sections `serializeScenario` produces (`currentChk`), which can be thinned —
 *   editor-only sections the game never reads, sections the format reference does not
 *   know, repeated sections collapsed to what the game acts on, bytes after the last
 *   section;
 * - the archive around it (`mpq/scm.ts#saveMap`): compression method, StarEdit-style
 *   encryption, which of the other members ride along;
 * - the file name and extension.
 *
 * `planSave` is the whole decision as data — every section with its fate and every extra
 * member with a tick — so the dialog shows what will be written before it is; `buildChk`
 * and `buildMapFile` turn the same options into bytes. Nothing here touches the store or
 * the scenario: stripping a section from the *file* leaves the open document as it is,
 * which is the point of a "smallest that plays" save that is not the working copy.
 */
import { combine, serializeChk, type ChkFile, type ChkSection } from "../formats/chk/reader";
import { SECTION_SPECS, sizeOf, specFor } from "../formats/chk/sections/registry";
import type { Scenario } from "../formats/chk/scenario";
import { requiredSectorSize, saveMap, STAREDIT_SECTOR_SIZE, type ArchiveCompression, type MemberInfo, type StoredMembers } from "../formats/mpq/scm";

/**
 * The archive members the Trigger Script plugin keeps its source and build manifest in
 * (`scmjs\triggers.ts`, `scmjs\triggers.json`, next to `staredit\scenario.chk`). The
 * editor never reads them; it knows the names so the Save dialog can say what leaving
 * them out means.
 */
export const SCRIPT_MEMBER = "scmjs\\triggers.ts";
export const MANIFEST_MEMBER = "scmjs\\triggers.json";
import { currentChk } from "./sections";

export type MapFormat = "scx" | "scm" | "chk";

export interface SaveOptions {
  format: MapFormat;
  /** How every archive member is compressed; ignored for a bare .chk. */
  compression: ArchiveCompression;
  /** Encrypt the members as StarEdit does. Every StarCraft build reads it. */
  encrypt: boolean;
  /** Archive members left out of the file, by name. */
  omitExtras: string[];
  /** Leave out ISOM, TILE and DD2: the terrain-editing data the game never reads. */
  stripTerrainEditing: boolean;
  /** Leave out IVER, IVE2, IOWN, UPUS, SWNM and WAV: editor bookkeeping the game never reads. */
  stripBookkeeping: boolean;
  /** Leave out sections whose names the format reference does not know. */
  stripUnknown: boolean;
  /** Collapse a section that occurs more than once into the bytes the game would act on. */
  mergeRepeats: boolean;
  /** Drop bytes after the last section header the file could parse. */
  dropTrailing: boolean;
}

/** The sections `stripTerrainEditing` removes. */
export const TERRAIN_EDITING_SECTIONS: readonly string[] = ["ISOM", "TILE", "DD2 "];
/** The sections `stripBookkeeping` removes. */
export const BOOKKEEPING_SECTIONS: readonly string[] = ["IVER", "IVE2", "IOWN", "UPUS", "SWNM", "WAV "];

/** Everything kept, no compression: the file as the editor has always written it. */
export const DEFAULT_SAVE_OPTIONS: SaveOptions = {
  format: "scx",
  compression: "none",
  encrypt: false,
  omitExtras: [],
  stripTerrainEditing: false,
  stripBookkeeping: false,
  stripUnknown: false,
  mergeRepeats: false,
  dropTrailing: false,
};

/** The extension of a file name, as a format, when it is one the editor writes. */
export function formatOf(fileName: string | null | undefined): MapFormat | null {
  const ext = fileName?.split(".").pop()?.toLowerCase();
  return ext === "scx" || ext === "scm" || ext === "chk" ? ext : null;
}

/**
 * What Save As starts from: the file's own extension (else `.scm` below the Brood War
 * revision, as StarEdit names them), and the archive stored the way it was opened — a map
 * that came in PKWARE-compressed and encrypted, Blizzard's own layout, goes out the same
 * way. A new map, or one opened from a bare .chk, gets StarEdit's layout too, since it is
 * what every build of the game reads.
 */
export function defaultSaveOptions(scn: Scenario, origin: MemberInfo | null, fileName: string | null): SaveOptions {
  const format = formatOf(fileName) ?? (scn.fileVersion < 205 ? "scm" : "scx");
  const compression: ArchiveCompression = origin
    ? (origin.compression === "zlib" || origin.compression === "pkware" ? origin.compression : "none")
    : "pkware";
  return { ...DEFAULT_SAVE_OPTIONS, format, compression, encrypt: origin ? origin.encrypted : true };
}

/** Two ready-made settings the dialog offers as buttons. */
export const SAVE_PRESETS = {
  /** Every section and member kept; compression as it is. */
  everything: (o: SaveOptions): SaveOptions => ({
    ...o, stripTerrainEditing: false, stripBookkeeping: false, stripUnknown: false, mergeRepeats: false, dropTrailing: false,
  }),
  /** The smallest file that plays the same: StarEdit's compression, editor data left out. */
  smallest: (o: SaveOptions): SaveOptions => ({
    ...o, compression: "pkware", encrypt: true, stripTerrainEditing: true, stripBookkeeping: true, stripUnknown: true, mergeRepeats: true, dropTrailing: true,
  }),
} as const;

export type SectionFate = "kept" | "dropped" | "merged";

/** One occurrence of a section in the output, with what the options do to it. */
export interface PlannedSection {
  /** Position in `currentChk`'s section list. */
  index: number;
  name: string;
  /** The registry's description, or null for a name it does not know. */
  what: string | null;
  size: number;
  fate: SectionFate;
  /** Why it is dropped or merged, in words. */
  reason?: string;
  /** Whether the editor has unsaved changes it encodes into this section. */
  dirty: boolean;
  editorOnly: boolean;
}

export type ExtraKind = "sound" | "script" | "file";

export interface PlannedExtra {
  name: string;
  size: number;
  kind: ExtraKind;
  kept: boolean;
}

/** The members carried as stored — the ones with no name the editor knows — and what happens to them. */
export interface PlannedStored {
  members: StoredMembers;
  count: number;
  /** Bytes they occupy in the archive. */
  size: number;
  /** False for a bare .chk, the one format that cannot carry them. */
  kept: boolean;
}

export interface SavePlan {
  /** The CHK as it will be written. */
  file: ChkFile;
  sections: PlannedSection[];
  extras: PlannedExtra[];
  /** Null when the archive had nothing the editor could not name. */
  stored: PlannedStored | null;
  /** Bytes of the CHK before and after the options. */
  chkSizeBefore: number;
  chkSize: number;
  /** Counts the dialog shows next to its ticks — what each option would act on, whether or not it is on. */
  counts: { unknown: number; repeated: number; trailing: number; terrainEditing: number; bookkeeping: number };
  /** Consequences worth reading before pressing Save. */
  warnings: string[];
}

/** What an archive member is, from its path. */
export function extraKind(name: string): ExtraKind {
  const key = name.replace(/\//g, "\\").toLowerCase();
  if (key === SCRIPT_MEMBER.toLowerCase() || key === MANIFEST_MEMBER.toLowerCase()) return "script";
  if (key.startsWith("staredit\\wav\\") || /\.(wav|ogg|mp3)$/.test(key)) return "sound";
  return "file";
}

/**
 * Decide every section's and member's fate under `options`, without writing anything.
 * The section list is `currentChk` — the bytes Save would emit with dirty sections
 * re-encoded — so a section the editor is about to rewrite is judged on its new size.
 */
export function planSave(scn: Scenario, extras: Map<string, Uint8Array>, options: SaveOptions, storedMembers: StoredMembers | null = null): SavePlan {
  const source = currentChk(scn);
  const dim = { width: scn.width, height: scn.height };
  const occurrences = new Map<string, number>();
  for (const s of source.sections) occurrences.set(s.name, (occurrences.get(s.name) ?? 0) + 1);

  const counts = {
    unknown: source.sections.filter((s) => !specFor(s.name)).length,
    repeated: [...occurrences.values()].filter((n) => n > 1).length,
    trailing: source.trailing?.length ?? 0,
    terrainEditing: source.sections.filter((s) => TERRAIN_EDITING_SECTIONS.includes(s.name)).length,
    bookkeeping: source.sections.filter((s) => BOOKKEEPING_SECTIONS.includes(s.name)).length,
  };

  const merged = new Set<string>();
  const sections: PlannedSection[] = [];
  const out: ChkSection[] = [];
  source.sections.forEach((s, index) => {
    const spec = specFor(s.name);
    const planned: PlannedSection = {
      index, name: s.name, what: spec?.what ?? null, size: s.data.length, fate: "kept", dirty: scn.dirty.has(s.name), editorOnly: spec?.editorOnly === true,
    };
    if (options.stripTerrainEditing && TERRAIN_EDITING_SECTIONS.includes(s.name)) {
      planned.fate = "dropped"; planned.reason = "terrain editing data";
    } else if (options.stripBookkeeping && BOOKKEEPING_SECTIONS.includes(s.name)) {
      planned.fate = "dropped"; planned.reason = "editor bookkeeping";
    } else if (options.stripUnknown && !spec) {
      planned.fate = "dropped"; planned.reason = "not in the format reference";
    } else if (options.mergeRepeats && spec && (occurrences.get(s.name) ?? 0) > 1) {
      if (merged.has(s.name)) {
        planned.fate = "dropped"; planned.reason = "merged into the first occurrence";
      } else {
        merged.add(s.name);
        const data = combine(source, s.name, spec.mode, sizeOf(spec, dim)) ?? s.data;
        planned.fate = "merged";
        planned.reason = `${occurrences.get(s.name)} occurrences combined as the game reads them`;
        planned.size = data.length;
        out.push({ ...s, data, declaredSize: data.length, truncated: undefined });
      }
    }
    if (planned.fate === "kept") out.push(s);
    sections.push(planned);
  });

  const file: ChkFile = { sections: out };
  if (source.trailing && !options.dropTrailing) file.trailing = source.trailing;

  const omitted = new Set(options.omitExtras.map((n) => n.toLowerCase()));
  const planned: PlannedExtra[] = [...extras].map(([name, data]) => ({
    name, size: data.length, kind: extraKind(name), kept: options.format !== "chk" && !omitted.has(name.toLowerCase()),
  }));

  const stored: PlannedStored | null = storedMembers && storedMembers.members.length > 0
    ? { members: storedMembers, count: storedMembers.members.length, size: storedMembers.members.reduce((n, m) => n + m.data.length, 0), kept: options.format !== "chk" }
    : null;

  const warnings: string[] = [];
  if (options.stripTerrainEditing && counts.terrainEditing > 0) {
    warnings.push("Without ISOM, TILE and DD2 the isometric brush and the Doodads layer have nothing to work with when the file is opened in an editor again. The map plays the same.");
  }
  if (options.stripBookkeeping && counts.bookkeeping > 0) {
    warnings.push("Switch names and the sound list are lost to editors; the game does not read them.");
  }
  if (options.stripUnknown && counts.unknown > 0) {
    warnings.push(`${counts.unknown} section${counts.unknown === 1 ? "" : "s"} with names the format reference does not know are left out. Another editor or a protector may have put them there.`);
  }
  if (options.format === "chk" && (extras.size > 0 || stored)) {
    warnings.push("A bare .chk is the scenario alone: the archive's other files are not written.");
  }
  if (stored?.kept) {
    const n = stored.count;
    warnings.push(`${n} archive member${n === 1 ? " has" : "s have"} no name the editor knows${stored.members.unreadable.length > 0 ? ", or could not be decoded" : ""}; ${n === 1 ? "it is" : "they are"} written back exactly as stored, and the archive keeps its ${stored.members.sectorSize}-byte sectors${options.compression === "zlib" && stored.members.sectorSize !== 0x10000 ? " (zlib would otherwise use 64 KB ones)" : ""}.`);
  }
  const sounds = planned.filter((e) => e.kind === "sound" && !e.kept && options.format !== "chk").length;
  if (sounds > 0) warnings.push(`${sounds} sound file${sounds === 1 ? "" : "s"} left out will not play.`);
  if (planned.some((e) => e.kind === "script" && !e.kept && options.format !== "chk")) {
    warnings.push("Without the trigger script members the generated triggers stay but their source is gone.");
  }
  if (options.compression === "zlib" && options.format !== "chk") {
    warnings.push("zlib needs StarCraft 1.16.1 or Remastered; older builds do not read it.");
  }

  const chkSize = out.reduce((n, s) => n + 8 + s.data.length, 0) + (file.trailing?.length ?? 0);
  const chkSizeBefore = source.sections.reduce((n, s) => n + 8 + s.data.length, 0) + (source.trailing?.length ?? 0);
  return { file, sections, extras: planned, stored, chkSizeBefore, chkSize, counts, warnings };
}

/** The scenario bytes the plan describes. */
export function buildChk(plan: SavePlan): Uint8Array {
  return serializeChk(plan.file);
}

/** The archive members the plan keeps. */
export function keptExtras(plan: SavePlan, extras: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const kept = new Map<string, Uint8Array>();
  for (const e of plan.extras) {
    const data = extras.get(e.name);
    if (e.kept && data) kept.set(e.name, data);
  }
  return kept;
}

/**
 * The whole file: the CHK alone for `.chk`, else the archive around it. zlib works best
 * with big sectors; PKWARE and uncompressed use StarEdit's 4 KB, the layout the game's own
 * maps carry.
 */
export async function buildMapFile(scn: Scenario, extras: Map<string, Uint8Array>, options: SaveOptions, plan?: SavePlan, stored: StoredMembers | null = null): Promise<Uint8Array> {
  plan ??= planSave(scn, extras, options, stored);
  const chk = buildChk(plan);
  if (options.format === "chk") return chk;
  const kept = plan.stored?.kept ? plan.stored.members : null;
  return saveMap(chk, {
    extras: keptExtras(plan, extras),
    stored: kept,
    compress: options.compression,
    encrypt: options.encrypt,
    sectorSize: requiredSectorSize(kept, options.compression === "zlib" ? 0x10000 : STAREDIT_SECTOR_SIZE),
  });
}

/** The names the registry marks editor-only, for the tests that keep the two lists above in step with it. */
export function editorOnlySections(): string[] {
  return [...SECTION_SPECS.values()].filter((s) => s.editorOnly).map((s) => s.name);
}

/** Human-readable size. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
