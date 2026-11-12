/**
 * `scmjs mod info <mpq|folder|exe|zip>`: what a mod is — its name, files and sizes by kind, which tables are wider than
 * the game's and in which layout, what it carries that is not run (plugins, FireGraft files), its maps, and the game it
 * is for, and the mod's hash (the name the play page and a replay know it by: `hash.ts`). Read from names and sizes,
 * plus each table's size, and every file's bytes for the hash; nothing is run.
 */
import { gameName, kindOf, leafOf, kindTotals, MOD_KINDS, say, tableShape, type DataSetRace, type ModKind } from "@scm-js/mod";
import { modText, t } from "../i18n";
import { dot, num, pc, rows, size } from "../ui";
import type { SourceHash } from "./hash";
import { gameCopySaid, shownPath, type ModSource } from "./source";

export { kindOf, MOD_KINDS, type ModKind };

export interface ModTableInfo { table: string; member: string; layout: "dat" | "expanded" | "datex" | null; entries: number | null; standard: number; extended: boolean; how: string }

/**
 * A self-executing exe of the mod: its form, where its archive is, and the plugins it carries in itself. `kind` is the
 * released field (`firegraft` for FireGraft's patcher, `sempq` for any other), `form` the reader's own word.
 */
export interface ModExe { file: string; kind: "sempq" | "firegraft"; form: "firegraft-patcher" | "mpqdraft-sempq" | "archive-after-program"; at: number; plugins: { id: number; size: number; name: string | null }[] }

export interface ModInfo {
  path: string;
  name: string;
  kind: ModSource["kind"];
  layers: string[];
  files: number;
  bytes: number;
  kinds: Partial<Record<ModKind, { files: number; bytes: number }>>;
  tables: ModTableInfo[];
  /** Tables wider than the game's: `units.datex (3,000 entries, GPTP's .datex)`. */
  extended: string[];
  scripts: string[];
  /** Each by its file's name; `path` where in the mod it is (two plugins of one name are told apart by it). */
  plugins: { name: string; bytes: number; path: string }[];
  firegraft: { name: string; bytes: number; path: string }[];
  exes: ModExe[];
  /**
   * Libraries (`.dll`) of the mod's code: in its plugins folder, or beside the program that holds it. A plugin of its
   * may load one; each has a line in the hash.
   */
  libraries: string[];
  maps: string[];
  /** The game the mod is for, as far as its files say. */
  game: string;
  /** The races the mod adds, as its mod.json declares them (empty when none are declared). */
  races: DataSetRace[];
  duplicates: string[];
  left: string[];
  /** A copy of the game in what was handed over: its own archives, as the folder spells them, not read (not the mod's). */
  gameCopy: string[];
  probed: string[];
  /** Members an archive lists and does not hold, or that could not be read: left out. */
  unheld: string[];
  /** Anything else `@scm-js/mod` said of the mod (an archive a plugin loader packs its folder into, laid as that folder; …), in words. */
  said: string[];
  /** The mod's hash, and without the lines of its code (null when not worked out). */
  hash: string | null;
  withoutPlugins: string | null;
  /**
   * The hash by the rule before 2026-11-11 (when a patcher exe's own plugins, the libraries and a FireGraft project
   * found only through FireGraft's own list had no line), where it differs; null otherwise. A replay tagged, or a mod
   * kept, before then names the mod by it.
   */
  beforeCode: string | null;
  /**
   * The hash as it was while an operating system's files (`left`: `sound\desktop.ini`, …) had lines; null when the
   * mod has no such file. A replay tagged before 2026-11-09, or a mod a browser kept then, names the mod by it.
   */
  older: { hash: string; withoutPlugins: string; left: string[] } | null;
}

/** The layout a table is in, in words. */
function howWords(layout: "expanded" | "datex"): string {
  return layout === "expanded" ? t("DatExtend's expanded layout (PyMS)") : t("GPTP's .datex layout");
}

export function modInfo(source: ModSource, hash: SourceHash | null = null): ModInfo {
  const d = source.description;
  const { files, bytes, kinds } = kindTotals(source.files.values());
  const tables: ModTableInfo[] = [];
  for (const f of [...source.files.values()].sort((a, b) => (gameName(a.name) < gameName(b.name) ? -1 : 1))) {
    const shape = tableShape(f.name, f.size);
    if (!shape) continue;
    const { table, layout, entries, standard, extended } = shape;
    tables.push({
      table, member: f.name, layout, entries, standard, extended,
      how: !layout || entries === null ? t("{bytes} bytes, which is no layout of {table}", { bytes: num(f.size), table })
        : layout === "dat" ? (shape.legacy ? t("{n, plural, one {# entry} other {# entries}}, the original game's (no Brood War columns)", { n: entries }) : t("{n, plural, one {# entry} other {# entries}}", { n: entries }))
        : t("{n, plural, one {# entry} other {# entries}} (the game's {standard}), {how}", { n: entries, standard: num(standard), how: howWords(layout) }),
    });
  }
  const base = source.manifest?.base ?? d?.manifest?.base;
  const game = base ? `StarCraft ${base}` : d?.game === "remastered" ? t("StarCraft: Remastered (its own pictures; samase)") : "StarCraft 1.16.1";
  // (the exes that hold the mod, each with the plugins it carries in itself)
  const exes: ModExe[] = [];
  for (const l of d?.layers ?? []) {
    if (l.kind !== "archive" || !["firegraft-patcher", "mpqdraft-sempq", "self-executing"].includes(l.by)) continue;
    // (in the exe's order; the names they give themselves, where they give one, are `named.patcherPlugins` in the same order)
    const plugins = (d?.modules ?? []).filter((m) => m.source.kind === "carried" && m.source.exe === l.path && m.role !== "patcher")
      .sort((a, b) => (a.source.kind === "carried" && b.source.kind === "carried" ? a.source.index - b.source.index : 0));
    const named = d!.named.patcherPlugins.filter((p) => p.exe === l.path);
    exes.push({
      file: source.layers[d!.layers.indexOf(l)], kind: l.by === "firegraft-patcher" ? "firegraft" : "sempq", form: l.by === "firegraft-patcher" ? "firegraft-patcher" : l.by === "mpqdraft-sempq" ? "mpqdraft-sempq" : "archive-after-program", at: l.at ?? 0,
      plugins: plugins.map((m, i) => ({ id: m.id ?? 0, size: m.size, name: named[i]?.name ?? null })),
    });
  }
  return {
    path: source.path, name: source.name, kind: source.kind, layers: source.layers, files, bytes, kinds, tables,
    extended: tables.filter((x) => x.extended).map((x) => `${x.member.split("\\").pop()}: ${x.how}`),
    scripts: [...source.files.values()].filter((f) => /^scripts\\.*\.bin$/.test(gameName(f.name))).map((f) => f.name).sort(),
    plugins: source.plugins.map((p) => ({ name: leafOf(p.name), bytes: p.bytes, path: carriedPath(p) })),
    firegraft: source.firegraft.map((p) => ({ name: leafOf(p.name), bytes: p.bytes, path: carriedPath(p) })),
    exes, libraries: source.code.filter((c) => c.role === "library").map((c) => c.name),
    maps: [...source.files.values()].filter((f) => kindOf(f.name) === "maps").map((f) => f.name).sort(),
    game, races: source.races, duplicates: (d?.duplicates ?? []).map((x) => x.paths.map((p) => p.split("/").pop()).join(" and ")),
    left: source.left, gameCopy: source.gameCopy, probed: source.probed, unheld: source.unheld,
    said: source.said.filter((m) => !SAID_HERE.has(m.key)).map(modText),
    hash: hash?.hash ?? null, withoutPlugins: hash?.withoutPlugins ?? null, beforeCode: hash?.beforeCode ?? null,
    // (without plugin files, the older hash without them is the older hash itself)
    older: hash?.older ? { ...hash.older, withoutPlugins: hash.older.withoutPlugins ?? hash.older.hash } : null,
  };
}

/** What `@scm-js/mod` says that `mod info` says in a line of its own: the rest is printed as the package says it. */
const SAID_HERE = new Set(["game-copy", "copy-only", "unheld", "duplicate", "no-game-files"]);

/** Where a carried file is: its path in the folder or zip, or the archive it is a member of with the member's name. */
const carriedPath = (p: ModSource["plugins"][number]) => (p.member ? `${p.layer}: ${p.member}` : p.layer || p.name);

/** A size as `size` gives it, and past a thousand megabytes in gigabytes. */
export const bigSize = size;

/** Carried files by name, each by its path where another has the same name. */
function carriedList(list: ModInfo["plugins"]): string {
  const twice = new Set(list.filter((p, i) => list.findIndex((q) => q.name.toLowerCase() === p.name.toLowerCase()) !== i).map((p) => p.name.toLowerCase()));
  return list.map((p) => `${twice.has(p.name.toLowerCase()) ? p.path : p.name} ${pc.dim(`(${bigSize(p.bytes)})`)}`).join(", ");
}

/** A count of files of one kind, in words. */
function kindWords(kind: ModKind, n: number): string {
  switch (kind) {
    case "tables": return t("{n, plural, one {# table} other {# tables}}", { n });
    case "scripts": return t("{n, plural, one {# script} other {# scripts}}", { n });
    case "pictures": return t("{n, plural, one {# picture} other {# pictures}}", { n });
    case "sounds": return t("{n, plural, one {# sound} other {# sounds}}", { n });
    case "terrain": return t("{n, plural, one {# terrain file} other {# terrain files}}", { n });
    case "strings": return t("{n, plural, one {# string table} other {# string tables}}", { n });
    case "AI": return t("{n, plural, one {# AI script} other {# AI scripts}}", { n });
    case "maps": return t("{n, plural, one {# map} other {# maps}}", { n });
    default: return t("{n, plural, one {# other file} other {# other files}}", { n });
  }
}

/** A mod for the game, from where. */
function fromWords(kind: ModSource["kind"], game: string): string {
  switch (kind) {
    case "mod folder": return t("A mod for {game}, from a mod folder scmjs mod unpack wrote", { game });
    case "folder": return t("A mod for {game}, from a folder of the game's files", { game });
    case "archive": return t("A mod for {game}, from an MPQ", { game });
    case "exe": return t("A mod for {game}, from a self-executing mod (its archive read, nothing run)", { game });
    case "zip": return t("A mod for {game}, from a zip", { game });
    default: return t("A mod for {game}, from the game's own files", { game });
  }
}

/** A declared race's byte and what else is declared of it: "race 69, letter a, plays as Terran". */
function raceDetail(r: DataSetRace): string {
  const like = r.like === 0 ? t("plays as Zerg") : r.like === 1 ? t("plays as Terran") : r.like === 2 ? t("plays as Protoss") : "";
  return [t("race {n}", { n: r.id }), r.letter ? t("letter {letter}", { letter: r.letter }) : "", like].filter(Boolean).join(", ");
}

export function printModInfo(r: ModInfo): string[] {
  const lines = [pc.bold(r.name), pc.dim(fromWords(r.kind, r.game)), ""];
  const kinds = MOD_KINDS.filter((k) => r.kinds[k]).map((k) => `${kindWords(k, r.kinds[k]!.files)} ${pc.dim(`(${bigSize(r.kinds[k]!.bytes)})`)}`);
  // (a plugin by the name it gives itself and the id the patcher keeps it under; an id of four letters as its letters)
  const idWord = (id: number) => { const s = String.fromCharCode(id & 0xff, (id >>> 8) & 0xff, (id >>> 16) & 0xff, id >>> 24); return /^[A-Za-z0-9]{4}$/.test(s) ? s : id.toString(16).padStart(8, "0"); };
  const patcher = (e: ModExe) => e.plugins.length
    ? t("FireGraft's patcher with {n, plural, one {# plugin} other {# plugins}} ({list})", { n: e.plugins.length, list: e.plugins.map((p) => `${p.name ? `${p.name}, ` : ""}id ${idWord(p.id)}, ${size(p.size)}`).join("; ") })
    : t("FireGraft's patcher");
  const exeWhat = (e: ModExe) => e.form === "firegraft-patcher" ? patcher(e) : e.form === "mpqdraft-sempq" ? t("MPQDraft's self-executing MPQ") : t("a program with an archive after it");
  lines.push(...rows([
    [t("Files"), `${num(r.files)}${dot}${bigSize(r.bytes)}`],
    [t("Kinds"), kinds.join(", ") || pc.dim(t("none"))],
    [t("Tables"), r.tables.length ? r.tables.map((x) => x.member.split("\\").pop()).join(", ") : null],
    [t("Extended"), r.extended.length ? r.extended[0] : null],
    ...r.extended.slice(1).map((e) => ["", e] as [string, string]),
    [t("Scripts"), r.scripts.length ? r.scripts.map((s) => s.split("\\").pop()).join(", ") : null],
    [t("Plugins"), r.plugins.length ? `${carriedList(r.plugins)} ${pc.dim(t("— kept, not run"))}` : null],
    ["FireGraft", r.firegraft.length ? `${carriedList(r.firegraft)} ${pc.dim(t("— kept, not applied"))}` : null],
    ...r.exes.map((e) => ["Exe", t("{file}: {what}, its archive at byte {at}", { file: e.file, what: exeWhat(e), at: num(e.at) })] as [string, string]),
    [t("Races"), r.races.length ? r.races.map((x) => `${x.name} ${pc.dim(`(${raceDetail(x)})`)}`).join(", ") : null],
    [t("Maps"), r.maps.length ? `${t("{n, plural, one {# map} other {# maps}}", { n: r.maps.length })}${r.maps.length <= 4 ? `: ${r.maps.map((m) => m.split("\\").pop()).join(", ")}` : ""}` : null],
    [t("Layers"), r.layers.length > 1 ? r.layers.map(shownPath).join(pc.dim(` ${t("then")} `)) : null],
    [t("Hash"), r.hash],
    [t("Without plugins"), r.hash && r.withoutPlugins && r.withoutPlugins !== r.hash ? `${r.withoutPlugins} ${pc.dim(t("(a page that runs none of the plugins)"))}` : null],
    [t("Earlier hash"), r.beforeCode ? `${r.beforeCode} ${pc.dim(t("(by the rule before 2026-11-11, when only plugin files had lines)"))}` : null],
    [t("Older hash"), r.older ? `${r.older.hash} ${pc.dim(!r.older.left.length
      ? t("(with an operating system's files, which the hash leaves out)")
      : r.older.left.length > 3
        ? t("(with {list} and {more} more, which the hash leaves out)", { list: r.older.left.slice(0, 3).join(", "), more: num(r.older.left.length - 3) })
        : t("(with {list}, which the hash leaves out)", { list: r.older.left.join(", ") }))}` : null],
  ]));
  for (const said of gameCopySaid(r)) lines.push("", `${pc.yellow("▲")} ${modText(said)}`);
  if (r.libraries.length) lines.push("", `${pc.yellow("▲")} ${t("{n, plural, one {A library} other {Libraries}} of the mod's code: {list}. A plugin of the mod may need {n, plural, one {it} other {them}}; {n, plural, one {it is} other {they are}} in the mod's hash, and nothing here loads {n, plural, one {it} other {them}}.", { list: r.libraries.join(", "), n: r.libraries.length })}`);
  if (r.probed.length) lines.push("", `${pc.yellow("▲")} ${t("{archives} has no list of its files: only the names the game reads were looked for", { archives: r.probed.join(", ") })}`);
  for (const said of r.said) lines.push("", `${pc.yellow("▲")} ${said}`);
  if (r.unheld.length) lines.push("", pc.dim(modText(say("unheld", { list: r.unheld.slice(0, 3).join(", "), more: Math.max(0, r.unheld.length - 3) }))));
  if (r.duplicates.length) lines.push("", `${pc.yellow("▲")} ${t("{n, plural, one {# file} other {# files}} twice, in another case: {list}", { n: r.duplicates.length, list: `${r.duplicates.slice(0, 3).join("; ")}${r.duplicates.length > 3 ? " …" : ""}` })}`);
  if (r.left.length) lines.push("", pc.dim(r.left.length > 6
    ? t("Not the game's, left out: {list} and {more} more", { list: r.left.slice(0, 6).map((l) => l.split("/").pop()).join(", "), more: num(r.left.length - 6) })
    : t("Not the game's, left out: {list}", { list: r.left.map((l) => l.split("/").pop()).join(", ") })));
  return lines;
}
