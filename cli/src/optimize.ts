/**
 * `scmjs map optimize <map>`: the map made smaller without changing what the game plays. In order: the archive members
 * nothing plays or names (sounds no trigger or briefing plays and the sound list does not name, then any other file
 * the game never opens), the sound list's entries for files the map does not hold, the strings nothing refers to,
 * with `--strip-editor` the sections only editors read, and last the compression every member is written with.
 * Each step is measured as the file it leaves, so the table says what each one saved.
 *
 * What is never touched: the scenario of a built map (its hash is what lets the editor give back the source), the
 * TrigScript, Magenta and build members (`trigscript\`, `magenta\`, `scmjs\`), the strings of a map that writes to the
 * game's memory (EUD: such a map can reach a string by its place), members with no name (carried as stored), and
 * members stored with a compression the editor cannot write (StarEdit's sounds are ADPCM, which is smaller than any
 * lossless method: they are carried exactly as stored, at the offset they had).
 */
import { openMapBytes, readArchive, writeArchiveBytes } from "../../src/editor/mapFile";
import { loadMap, memberInfo, SCENARIO_PATH, type ArchiveCompression, type StoredMembers } from "../../src/formats/mpq/scm";
import { parseScenario, type Scenario } from "../../src/formats/chk/scenario";
import { BUILD_MANIFEST_MEMBER, BUILD_SOURCE_MEMBER, readBuildManifest, restoreBuiltMap } from "../../src/editor/mapBuild";
import { applySounds, readWavs, soundList } from "../../src/editor/sounds";
import { stringUsages } from "../../src/editor/strings";
import { triggerReferences } from "../../src/editor/triggerRefs";
import { buildChk, DEFAULT_SAVE_OPTIONS, planSave } from "../../src/editor/save";
import { pruneScenarioStrings } from "./edit";
import { packStored } from "./relocate";
import { audioType } from "./sounds";
import { t } from "./i18n";
import { CliError, dot, mark, num, pc, size, table } from "./ui";

/** Folders of members the game never opens but the editor and its plugins need: kept whatever refers to them. */
export const KEPT_FOLDERS = ["scmjs\\", "trigscript\\", "magenta\\"] as const;
/**
 * Members the game itself opens by name (found in StarCraft.exe's strings): the archive's attributes and signature,
 * and the authentication markers of Blizzard's, ladder and tournament maps (`blizzard_2.cnd`, `ladder_2.cnd`, …).
 */
/** The game's own members an archive may hold without listing them, tried by name so they can be moved. */
const GAME_NAMES = ["(attributes)", "(signature)"];
export const GAME_MEMBERS = /^(\(attributes\)|\(signature\)|[a-z]+_(\d+|%d)\.cnd)$/i;

export type Compression = "zlib" | "pkware";
export const COMPRESSIONS: readonly Compression[] = ["pkware", "zlib"];

export interface OptimizeOptions {
  /** Drop the sections only editors read (the Save dialog's two editor groups). */
  stripEditor?: boolean;
  /** The compression to write every member with; by default PKWARE, or the smaller of the two for a map already in zlib. */
  compression?: Compression;
  /** Members (or folders, ending in `\`) to keep though nothing refers to them. */
  keep?: readonly string[];
}

export type StepKey = "sounds" | "members" | "strings" | "sections" | "compression";

export interface Removed {
  kind: "sound" | "entry" | "member" | "string" | "section";
  /** The member's path, the sound list's path, the string's text or the section's name. */
  name: string;
  /** The string's number, or the sound list's slot (1-based, as the Sound Editor shows it). */
  index: number | null;
  /** Bytes the member or section held; 0 for an entry or a string. */
  bytes: number;
  why: string;
}

export interface OptimizeStep {
  key: StepKey;
  label: string;
  /** What it did, in a few words: "2 sounds, 1 list entry", "pkware → zlib". */
  did: string;
  /** Bytes it saved (negative when the step made the file larger). */
  saved: number;
  /** Why the step did not run, when it did not. */
  skipped: string | null;
}

export interface OptimizeResult {
  file: string;
  before: number;
  after: number;
  steps: OptimizeStep[];
  removed: Removed[];
  compression: { from: string; to: string; encrypted: boolean };
  /** The map is built (its scenario is a build step's output): the scenario steps were left out. */
  built: boolean;
  /** The map's triggers write to the game's memory: strings were left alone. */
  eud: boolean;
  /** Members carried exactly as stored: compressed by a method the editor cannot write. */
  asStored: string[];
  /** Members kept though nothing in the scenario names them, and why: the game opens it, a tool's files, --keep. */
  kept: { name: string; why: string }[];
  warnings: string[];
  /** The optimized file. */
  bytes: Uint8Array;
}

const norm = (name: string) => name.replace(/\//g, "\\").toLowerCase();
const AUDIO_NAME = /\.(wav|ogg|mp3)$/i;
const isStock = (path: string) => norm(path).startsWith("sound\\");

/** The paths a scenario's trigger and briefing actions name (any of their strings, so a sound is never mistaken for unused). */
function playedPaths(scn: Scenario): Set<string> {
  const out = new Set<string>();
  for (const [index, uses] of stringUsages(scn)) {
    if (!uses.some((u) => u.kind === "trigger" || u.kind === "briefing")) continue;
    const text = scn.strings.strings[index];
    if (text) out.add(norm(text));
  }
  return out;
}

/** The paths the sound list (the WAV section, the Sound Editor's) names. */
function listedPaths(scn: Scenario): Set<string> {
  const out = new Set<string>();
  for (const i of scn.wavs ?? []) { const text = i > 0 ? scn.strings.strings[i] : null; if (text) out.add(norm(text)); }
  return out;
}

/** Whether any trigger writes to or reads the game's memory through a death counter out of range (EUD). */
export function usesMemory(scn: Scenario): boolean {
  const forces = [[], [], [], []];
  return [...triggerReferences(scn.triggers, forces), ...triggerReferences(scn.briefing, forces, true)].some((t) => t.refs.some((r) => r.kind === "memory"));
}

/** `--keep` as a test: a member named exactly, or one under a folder given with a trailing slash. */
export function keepTest(patterns: readonly string[]): (name: string) => boolean {
  const list = patterns.map(norm).filter(Boolean);
  return (name) => { const key = norm(name); return list.some((p) => (p.endsWith("\\") ? key.startsWith(p) : key === p)); };
}

/** The compression an archive member was stored with, as the editor names it. */
const compressionWord = (c: ArchiveCompression | "other" | null) => (c === null ? t("a bare scenario") : c === "other" ? t("another method") : c === "none" ? "none" : c === "pkware" ? "PKWARE" : "zlib");

/**
 * The map made smaller: what each step removed and saved, and the file. Nothing is written here; `bytes` is the
 * result, already opened again the way the editor opens a map (a result that does not open is an error).
 */
export async function optimizeMap(bytes: Uint8Array, file: string, o: OptimizeOptions = {}): Promise<OptimizeResult> {
  let archive;
  try { archive = await readArchive(bytes); } catch (e) { throw new CliError(t("{file} is not a map this can read: {message}", { file, message: String(e instanceof Error ? e.message : e) }), null, 2); }
  const bare = !archive.origin;
  const strip = !!o.stripEditor;
  const warnings: string[] = [];
  const removed: Removed[] = [];
  const keepAsked = keepTest(o.keep ?? []);

  const restored = bare ? { kind: "plain" as const } : await restoreBuiltMap(archive.chk, archive.extras);
  const built = restored.kind !== "plain";
  const scn = parseScenario(archive.chk);
  const sourceBytes = [...archive.extras].find(([n]) => norm(n) === BUILD_SOURCE_MEMBER)?.[1];
  let source: Scenario | null = null;
  if (built && sourceBytes) { try { source = parseScenario(sourceBytes); } catch { source = null; } }
  const manifestBytes = [...archive.extras].find(([n]) => norm(n) === BUILD_MANIFEST_MEMBER)?.[1];
  const addedByBuild = new Set((manifestBytes ? readBuildManifest(manifestBytes)?.added ?? [] : []).map(norm));
  const eud = !built && usesMemory(scn);

  // What refers to a member: the actions that play it, and, while the sound list stays, the list. A built map's
  // scenario is not changed, so its list stays whatever --strip-editor says.
  const listKept = !strip || built;
  const referenced = new Set<string>([...playedPaths(scn), ...(source ? playedPaths(source) : [])]);
  const listed = new Set<string>([...listedPaths(scn), ...(source ? listedPaths(source) : [])]);
  if (listKept) for (const p of listed) referenced.add(p);

  // Which members go, and why.
  const keptFolders: { name: string; why: string }[] = [];
  const goSounds = new Set<string>(), goMembers = new Set<string>();
  for (const [name, data] of archive.extras) {
    const key = norm(name);
    const why = GAME_MEMBERS.test(key) ? t("the game opens it") : KEPT_FOLDERS.some((f) => key.startsWith(f)) ? t("TrigScript, Magenta or build file") : addedByBuild.has(key) ? t("added by the build") : keepAsked(name) ? "--keep" : null;
    if (why) { keptFolders.push({ name, why }); continue; }
    if (referenced.has(key)) continue;
    const sound = AUDIO_NAME.test(name) || audioType(data) !== null;
    if (sound) {
      goSounds.add(name);
      removed.push({ kind: "sound", name, index: null, bytes: data.length, why: listed.has(key) ? t("no trigger or briefing plays it, and the sound list goes with --strip-editor") : t("no trigger or briefing plays it, and the sound list does not name it") });
    } else {
      goMembers.add(name);
      removed.push({ kind: "member", name, index: null, bytes: data.length, why: t("the game never opens it, and nothing in the map names it") });
    }
  }

  // How the archive is written: compressed as it came (what measures the removals), the members the editor cannot
  // write carried as they are stored, a file list only where the archive had one.
  const loaded = bare ? null : await loadMap(bytes);
  const opened = archive.origin?.compression ?? null;
  const asOpened: ArchiveCompression = opened === "zlib" || opened === "pkware" ? opened : opened === "other" ? "pkware" : "none";
  const encrypt = archive.origin?.encrypted ?? false;
  const listfile = archive.files !== null;
  // A member stays exactly as stored where that is smaller than the editor writes it: StarEdit stores a sound with
  // ADPCM, lossy and about a quarter of the size, which no lossless method comes near. Decided once a compression, by
  // writing every member that way and comparing each one's stored size.
  const asStoredBy = new Map<ArchiveCompression, Set<string>>();
  const asStoredFor = async (compression: ArchiveCompression): Promise<Set<string>> => {
    const known = asStoredBy.get(compression);
    if (known) return known;
    const set = new Set<string>();
    const a = loaded?.archive;
    if (a && archive.extras.size) {
      const probe = (await loadMap(await writeArchiveBytes(archive.chk, { extras: archive.extras, compression, encrypt, listfile: false }))).archive!;
      for (const name of archive.extras.keys()) {
        const was = memberInfo(a, name)?.storedSize, now = memberInfo(probe, name)?.storedSize;
        // (A member with no stored bytes is not carried by the writer at all: it is written afresh.)
        if (was !== undefined && now !== undefined && was > 0 && was < now) set.add(name);
      }
    }
    asStoredBy.set(compression, set);
    return set;
  };
  const rawFor = (names: readonly string[]): StoredMembers | null => {
    const a = loaded?.archive;
    const all = a?.members() ?? [];
    const raw = a ? names.flatMap((name) => { const slot = a.slotOf(name); const member = all.find((m) => m.slot === slot); return member ? [{ member, name }] : []; }) : [];
    // Members with no name in the file list may still be the game's own, found by name: those can move too.
    const found = a ? GAME_NAMES.flatMap((name) => { const slot = a.slotOf(name); const member = archive.stored?.members.find((m) => m.slot === slot); return member ? [{ member, name }] : []; }) : [];
    if (!raw.length && !found.length) return archive.stored;
    // Moved up to the archive's start (re-keyed where the key depends on the offset), so they do not pin its end.
    const pinned = (archive.stored?.members ?? []).filter((m) => !found.some((f) => f.member === m));
    raw.push(...found);
    return { hashTable: archive.stored?.hashTable ?? a!.hashEntries(), sectorSize: archive.stored?.sectorSize ?? a!.sectorSize, members: [...pinned, ...packStored(raw, pinned)], unreadable: archive.stored?.unreadable ?? [] };
  };
  // Removals are applied stage by stage, so each stage's file is measured with only the steps before it.
  const goSoundsNow = new Set<string>(), goMembersNow = new Set<string>();
  const extrasNow = () => new Map([...archive.extras].filter(([n]) => !goSoundsNow.has(n) && !goMembersNow.has(n)));
  let sectionsNow = false;
  const chkNow = () => (built ? archive.chk : buildChk(planSave(scn, new Map(), { ...DEFAULT_SAVE_OPTIONS, format: "chk", stripTerrainEditing: sectionsNow, stripBookkeeping: sectionsNow })));
  /** The archive as it stands, every member in `compression` but those smaller as stored (unless `rewriteAll`). */
  const write = async (compression: ArchiveCompression, rewriteAll = false): Promise<Uint8Array> => {
    const chk = chkNow();
    if (bare) return chk;
    const all = extrasNow();
    const kept = [...all.keys()];
    const asStored = rewriteAll ? new Set<string>() : await asStoredFor(compression);
    const extras = new Map([...all].filter(([n]) => !asStored.has(n)));
    const stored = rawFor(kept.filter((n) => asStored.has(n)));
    if (stored === archive.stored || !listfile) return writeArchiveBytes(chk, { extras, stored, compression, encrypt, listfile });
    // Members carried as stored are not in the file list the writer makes, so the list is written here, naming them too.
    extras.set("(listfile)", new TextEncoder().encode([SCENARIO_PATH, ...kept].join("\r\n")));
    return writeArchiveBytes(chk, { extras, stored, compression, encrypt, listfile: false });
  };
  /** The smaller of the archive with the members carried as stored and with every member written afresh. */
  const writeBest = async (compression: ArchiveCompression): Promise<{ bytes: Uint8Array; asStored: string[] }> => {
    const asStored = [...(await asStoredFor(compression))].filter((n) => extrasNow().has(n));
    const carried = await write(compression);
    if (!asStored.length) return { bytes: carried, asStored };
    const fresh = await write(compression, true);
    return fresh.length <= carried.length ? { bytes: fresh, asStored: [] } : { bytes: carried, asStored };
  };

  const steps: OptimizeStep[] = [];
  let last = (await writeBest(asOpened)).bytes;
  const baseline = last.length;
  const measure = async (key: StepKey, label: string, did: string, skipped: string | null, changed: boolean) => {
    const next = changed ? (await writeBest(asOpened)).bytes : last;
    steps.push({ key, label, did, saved: last.length - next.length, skipped });
    last = next;
  };

  // 1. Sounds nothing plays or lists, and the list's entries for files the map does not hold.
  if (!built && !strip) {
    const wavs = readWavs(scn);
    for (const row of soundList(scn, archive.extras)) {
      if (row.member || isStock(row.path) || !row.path) continue;
      wavs[row.slot] = 0;
      removed.push({ kind: "entry", name: row.path, index: row.slot + 1, bytes: 0, why: t("the map holds no such file") });
    }
    applySounds(scn, wavs);
  }
  for (const n of goSounds) goSoundsNow.add(n);
  const entries = removed.filter((r) => r.kind === "entry").length;
  await measure("sounds", t("Unused sounds"), [goSounds.size ? t("{n, plural, one {# sound} other {# sounds}}", { n: goSounds.size }) : "", entries ? t("{n, plural, one {# list entry} other {# list entries}}", { n: entries }) : ""].filter(Boolean).join(", ") || t("none"), bare ? t("a bare scenario holds no sounds") : null, goSounds.size + entries > 0);

  // 2. Every other member nothing names.
  for (const n of goMembers) goMembersNow.add(n);
  await measure("members", t("Other files"), goMembers.size ? t("{n, plural, one {# file} other {# files}}", { n: goMembers.size }) : t("none"), bare ? t("a bare scenario holds no other files") : null, goMembers.size > 0);

  // 3. Strings nothing refers to. With --strip-editor the switch names and the sound list go too, so their strings do.
  let strings = 0;
  const stringsSkipped = built ? t("a built map's scenario is the build's output; prune the source in the editor and build again") : eud ? t("the triggers write to the game's memory (EUD), which can reach a string by its place") : null;
  if (!stringsSkipped) {
    if (strip) { scn.wavs = null; scn.switchNames = null; }
    for (const s of pruneScenarioStrings(scn)) { removed.push({ kind: "string", name: s.text, index: s.index, bytes: 0, why: t("nothing in the map refers to it") }); strings++; }
  }
  await measure("strings", t("Unused strings"), strings ? t("{n, plural, one {# string} other {# strings}}", { n: strings }) : t("none"), stringsSkipped, strings > 0);

  // 4. With --strip-editor: the sections only editors read.
  let sectionsSkipped: string | null = strip ? null : t("with --strip-editor");
  if (strip && built) sectionsSkipped = t("a built map's scenario is left as it was built");
  if (strip && !built) {
    sectionsNow = true;
    const plan = planSave(scn, new Map(), { ...DEFAULT_SAVE_OPTIONS, format: "chk", stripTerrainEditing: true, stripBookkeeping: true });
    for (const s of plan.sections.filter((x) => x.fate === "dropped")) removed.push({ kind: "section", name: s.name.trim(), index: null, bytes: s.size + 8, why: s.reason ?? t("editors only") });
  }
  const dropped = removed.filter((r) => r.kind === "section");
  await measure("sections", t("Editor sections"), dropped.length ? dropped.map((r) => r.name).join(", ") : t("none"), sectionsSkipped, dropped.length > 0);

  // 5. The compression: PKWARE by default (every version of the game reads it), the smaller of the two for a map that
  // was in zlib already (only Remastered opens it either way), or the one asked for.
  let to: ArchiveCompression = asOpened;
  let final = last;
  let carried: string[] = [];
  if (!bare) {
    const tries: Compression[] = o.compression ? [o.compression] : opened === "zlib" ? ["zlib", "pkware"] : ["pkware"];
    let best: { c: Compression; bytes: Uint8Array; asStored: string[] } | null = null;
    for (const c of tries) { const b = await writeBest(c); if (!best || b.bytes.length < best.bytes.length) best = { c, ...b }; }
    to = best!.c;
    final = best!.bytes;
    carried = best!.asStored;
    if (to === "zlib") warnings.push(opened === "zlib" ? t("The map stays in zlib, which only StarCraft: Remastered opens; --compression pkware makes a file every version opens.") : t("zlib: only StarCraft: Remastered opens the map; 1.16.1 and older cannot."));
  }
  // The rewrite itself (sector sizes, tables, the file list) counts with the compression: the file as opened against
  // the same file written as the editor writes it, nothing removed.
  steps.push({ key: "compression", label: t("Compression"), did: bare ? t("none") : to === opened ? t("{compression}, rewritten", { compression: compressionWord(to) }) : `${compressionWord(opened)} → ${compressionWord(to)}`, saved: bytes.length - baseline + (last.length - final.length), skipped: bare ? t("a bare scenario is not compressed") : null });

  if (carried.length) warnings.push(carried.length <= 3 ? t("{names} {n, plural, one {is} other {are}} carried as stored: smaller so than anything the editor writes (StarEdit stores a sound with ADPCM, a lossy compression the editor reads but cannot write).", { names: carried.join(", "), n: carried.length }) : t("{n, plural, one {# member is} other {# members are}} carried as stored: smaller so than anything the editor writes (StarEdit stores a sound with ADPCM, a lossy compression the editor reads but cannot write).", { n: carried.length }));
  if (archive.stored?.members.length) warnings.push(t("{n, plural, one {# member with no name the editor knows is} other {# members with no name the editor knows are}} kept exactly as stored.", { n: archive.stored.members.length }));
  if (strip && dropped.length) warnings.push(t("Without these sections an editor opening the map has no isometric terrain, no doodads as objects, no sound list and no switch names. The map plays the same; keep the original to go on editing."));

  // The result must open as the editor opens a map.
  try { await openMapBytes(final, file); } catch (e) { throw new CliError(t("The optimized map did not open again ({message}); nothing was written.", { message: String(e instanceof Error ? e.message : e) }), t("This is a bug in scmjs: the map as it was would help.")); }

  return {
    file, before: bytes.length, after: final.length, steps, removed,
    compression: { from: compressionWord(opened), to: bare ? compressionWord(null) : compressionWord(to), encrypted: encrypt },
    built, eud, asStored: carried, kept: keptFolders, warnings, bytes: final,
  };
}

/** `--json`: the result without the file's bytes. */
export function optimizeJson(r: OptimizeResult, extra: Record<string, unknown> = {}) {
  const { bytes: _bytes, ...rest } = r;
  return { ...rest, saved: r.before - r.after, ...extra };
}

/** Bytes as the table shows them: "12.0 KB", "−1.2 KB" for a step that grew the file, "-" for nothing. */
const savedWord = (n: number) => (n === 0 ? pc.dim("-") : n < 0 ? pc.yellow(`+${size(-n)}`) : size(n));
const percent = (before: number, after: number) => (before ? Math.round(((before - after) / before) * 1000) / 10 : 0);

/** "412 KB → 301 KB (−27%)". */
export function sizeLine(before: number, after: number): string {
  const p = percent(before, after);
  return `${size(before)} ${mark.arrow} ${size(after)} ${pc.dim(`(${p >= 0 ? "−" : "+"}${Math.abs(p)}%)`)}`;
}

/** The report's lines: the sizes, the steps as a table, what went, and the warnings. */
export function printOptimize(r: OptimizeResult, o: { dryRun?: boolean; written?: string | null; all?: boolean } = {}): string[] {
  const smaller = r.after < r.before;
  const head = !smaller
    ? `${mark.info} ${pc.bold(r.file)}: ${size(r.before)}; ${r.after > r.before
      ? (o.dryRun ? t("the editor cannot write it smaller {bigger}, so nothing would be written", { bigger: pc.dim(t("(it would be {size})", { size: size(r.after) })) }) : t("the editor cannot write it smaller {bigger}, so nothing was written", { bigger: pc.dim(t("(it would be {size})", { size: size(r.after) })) }))
      : (o.dryRun ? t("the editor cannot write it smaller, so nothing would be written") : t("the editor cannot write it smaller, so nothing was written"))}`
    : `${o.dryRun ? mark.info : mark.ok} ${pc.bold(r.file)}: ${sizeLine(r.before, r.after)}${o.dryRun ? pc.dim(` ${t("if written (--dry-run: nothing written)")}`) : o.written ? `${dot}${t("written to {file}", { file: o.written })}` : ""}`;
  const out = [head, ""];
  out.push(...table([
    [t("Step"), "", t("Saved")].map((h) => pc.dim(h)),
    ...r.steps.map((s) => [s.label, s.skipped ? pc.dim(t("skipped: {why}", { why: s.skipped })) : s.did, s.skipped && !s.saved ? pc.dim("-") : savedWord(s.saved)]),
  ], 2));
  const limit = o.all ? Infinity : 20;
  const word: Record<Removed["kind"], string> = { sound: t("sound"), entry: t("list entry"), member: t("file"), string: t("string"), section: t("section") };
  const show = (t: string) => { const p = t.replace(/\s+/g, " "); return p.length > 60 ? `${p.slice(0, 57)}…` : p; };
  if (r.removed.length) {
    out.push("", pc.bold(o.dryRun ? t("Would go") : t("Removed")));
    const lines = r.removed.map((x) => {
      const what = x.kind === "string" ? `${pc.dim(String(x.index).padStart(4))} ${show(x.name)}` : x.kind === "entry" ? `${pc.dim(t("slot {n}", { n: String(x.index) }))} ${x.name}` : x.name;
      return [pc.dim(word[x.kind]), what, pc.dim(x.bytes ? `${size(x.bytes)} · ${x.why}` : x.why)];
    });
    out.push(...table(lines.slice(0, limit), 2));
    if (r.removed.length > limit) out.push(pc.dim(`  ${t("… and {n} more (--all lists them)", { n: num(r.removed.length - limit) })}`));
  }
  if (r.kept.length) {
    const groups = new Map<string, string[]>();
    for (const k of r.kept) groups.set(k.why, [...(groups.get(k.why) ?? []), k.name]);
    out.push("", ...[...groups].map(([why, names]) => pc.dim(`  ${t("Kept ({why}): {names}", { why, names: `${names.slice(0, 6).join(", ")}${names.length > 6 ? t(", … {n} in all", { n: num(names.length) }) : ""}` })}`)));
  }
  for (const w of r.warnings) out.push(`${mark.warn} ${w}`);
  return out;
}
