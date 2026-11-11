/**
 * `scmjs mod info <mpq|folder|exe|zip>`: what a mod is — its name, files and sizes by kind, which tables are wider than
 * the game's and in which layout, what it carries that is not run (plugins, FireGraft files), its maps, and the game it
 * is for, and the mod's hash (the name the play page and a replay know it by: `hash.ts`). Read from names and sizes,
 * plus each table's size, and every file's bytes for the hash; nothing is run.
 */
import { DAT_SCHEMAS, datTableOf } from "../../../src/formats/dat/schema";
import { datShape } from "../../../src/formats/dat/table";
import { gameName } from "../../../src/formats/mod/sources";
import type { DataSetRace } from "../../../src/formats/mod/races";
import { t } from "../i18n";
import { dot, num, pc, rows, size } from "../ui";
import type { SourceHash } from "./hash";
import { gameCopyFolders, gameCopyWords, shownPath, type ModSource } from "./source";

/** The kinds of file a mod changes, in the order they are named (the play page names them alike). */
export const MOD_KINDS = ["tables", "scripts", "pictures", "sounds", "terrain", "strings", "AI", "maps", "other"] as const;
export type ModKind = (typeof MOD_KINDS)[number];

/** A file's kind by its game name. */
export function kindOf(name: string): ModKind {
  const lower = gameName(name);
  const [top] = lower.split("\\");
  if (/^scripts\\(aiscript|bwscript)\.bin$/.test(lower)) return "AI";
  if (top === "scripts") return "scripts";
  if (top === "arr") return lower.endsWith(".tbl") ? "strings" : /\.dat(ex)?$/.test(lower) ? "tables" : "other";
  if (top === "tileset") return "terrain";
  if (top === "maps" || /\.sc[mx]$/.test(lower)) return "maps";
  if (/\.(wav|ogg)$/.test(lower) || top === "sound" || top === "music") return "sounds";
  if (lower.endsWith(".tbl") || top === "font") return "strings";
  if (/\.(grp|pcx|lo[a-z]|dds|anim|smk|spk|bmp|png)$/.test(lower) || ["unit", "game", "dlgs", "cursor", "portrait"].includes(top)) return "pictures";
  return "other";
}

export interface ModTableInfo { table: string; member: string; layout: "dat" | "expanded" | "datex" | null; entries: number | null; standard: number; extended: boolean; how: string }

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
  exes: ModSource["exes"];
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
  /** Members an archive lists and does not hold: left out. */
  unheld: string[];
  /** The mod's hash, and without its plugins' lines (null when not worked out). */
  hash: string | null;
  withoutPlugins: string | null;
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
  const kinds: ModInfo["kinds"] = {};
  let bytes = 0;
  for (const f of source.files.values()) {
    const k = kindOf(f.name);
    const c = kinds[k] ?? { files: 0, bytes: 0 };
    c.files++; c.bytes += f.size; kinds[k] = c;
    bytes += f.size;
  }
  const tables: ModTableInfo[] = [];
  for (const f of [...source.files.values()].sort((a, b) => (gameName(a.name) < gameName(b.name) ? -1 : 1))) {
    const table = /^arr\\[^\\]+\.dat(?:ex)?$/.test(gameName(f.name)) ? datTableOf(f.name) : null;
    if (!table) continue;
    const shape = datShape(table, f.size, f.name);
    const standard = DAT_SCHEMAS[table].entries;
    const extended = !!shape && (shape.layout !== "dat");
    tables.push({
      table, member: f.name, layout: shape?.layout ?? null, entries: shape?.count ?? null, standard, extended,
      how: !shape ? t("{bytes} bytes, which is no layout of {table}", { bytes: num(f.size), table })
        : shape.layout === "dat" ? (shape.legacy ? t("{n, plural, one {# entry} other {# entries}}, the original game's (no Brood War columns)", { n: shape.count }) : t("{n, plural, one {# entry} other {# entries}}", { n: shape.count }))
        : t("{n, plural, one {# entry} other {# entries}} (the game's {standard}), {how}", { n: shape.count, standard: num(standard), how: howWords(shape.layout) }),
    });
  }
  const names = [...source.files.keys()];
  const remastered = names.some((n) => /^(anim|hd2|sd)\\|\.(dds|anim)$/.test(n));
  const game = source.manifest?.base ? `StarCraft ${source.manifest.base}` : remastered ? t("StarCraft: Remastered (its own pictures; samase)") : "StarCraft 1.16.1";
  return {
    path: source.path, name: source.name, kind: source.kind, layers: source.layers, files: source.files.size, bytes, kinds, tables,
    extended: tables.filter((x) => x.extended).map((x) => `${x.member.split("\\").pop()}: ${x.how}`),
    scripts: [...source.files.values()].filter((f) => /^scripts\\.*\.bin$/.test(gameName(f.name))).map((f) => f.name).sort(),
    plugins: source.plugins.map((p) => ({ name: p.name.split(/[\\/]/).pop()!, bytes: p.bytes, path: carriedPath(p) })),
    firegraft: source.firegraft.map((p) => ({ name: p.name.split(/[\\/]/).pop()!, bytes: p.bytes, path: carriedPath(p) })),
    exes: source.exes, maps: [...source.files.values()].filter((f) => kindOf(f.name) === "maps").map((f) => f.name).sort(),
    game, races: source.races, duplicates: source.duplicates, left: source.left, gameCopy: source.gameCopy, probed: source.probed, unheld: source.unheld,
    hash: hash?.hash ?? null, withoutPlugins: hash?.withoutPlugins ?? null, older: hash?.older ?? null,
  };
}

/** Where a carried file is: its path in the folder or zip, or the archive it is a member of with the member's name. */
const carriedPath = (p: ModSource["plugins"][number]) => (p.member ? `${p.layer}: ${p.member}` : p.name);

/** A size as `size` gives it, and past a thousand megabytes in gigabytes. */
export const bigSize = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : size(bytes));

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
  const patcher = (e: ModInfo["exes"][number]) => e.plugins.length
    ? t("FireGraft's patcher with {n, plural, one {# plugin} other {# plugins}} ({list})", { n: e.plugins.length, list: e.plugins.map((p) => `id ${p.id.toString(16)}, ${size(p.size)}`).join("; ") })
    : t("FireGraft's patcher");
  lines.push(...rows([
    [t("Files"), `${num(r.files)}${dot}${bigSize(r.bytes)}`],
    [t("Kinds"), kinds.join(", ") || pc.dim(t("none"))],
    [t("Tables"), r.tables.length ? r.tables.map((x) => x.member.split("\\").pop()).join(", ") : null],
    [t("Extended"), r.extended.length ? r.extended[0] : null],
    ...r.extended.slice(1).map((e) => ["", e] as [string, string]),
    [t("Scripts"), r.scripts.length ? r.scripts.map((s) => s.split("\\").pop()).join(", ") : null],
    [t("Plugins"), r.plugins.length ? `${carriedList(r.plugins)} ${pc.dim(t("— kept, not run"))}` : null],
    ["FireGraft", r.firegraft.length ? `${carriedList(r.firegraft)} ${pc.dim(t("— kept, not applied"))}` : null],
    ...r.exes.map((e) => ["Exe", t("{file}: {what}, its archive at byte {at}", { file: e.file, what: e.kind === "firegraft" ? patcher(e) : t("MPQDraft's self-executing MPQ"), at: num(e.at) })] as [string, string]),
    [t("Races"), r.races.length ? r.races.map((x) => `${x.name} ${pc.dim(`(${raceDetail(x)})`)}`).join(", ") : null],
    [t("Maps"), r.maps.length ? `${t("{n, plural, one {# map} other {# maps}}", { n: r.maps.length })}${r.maps.length <= 4 ? `: ${r.maps.map((m) => m.split("\\").pop()).join(", ")}` : ""}` : null],
    [t("Layers"), r.layers.length > 1 ? r.layers.map(shownPath).join(pc.dim(` ${t("then")} `)) : null],
    [t("Hash"), r.hash],
    [t("Without plugins"), r.hash && r.withoutPlugins && r.withoutPlugins !== r.hash ? `${r.withoutPlugins} ${pc.dim(t("(a page that runs none of the plugins)"))}` : null],
    [t("Older hash"), r.older ? `${r.older.hash} ${pc.dim(r.older.left.length > 3
      ? t("(with {list} and {more} more, which the hash leaves out)", { list: r.older.left.slice(0, 3).join(", "), more: num(r.older.left.length - 3) })
      : t("(with {list}, which the hash leaves out)", { list: r.older.left.join(", ") }))}` : null],
  ]));
  for (const copy of gameCopyFolders(r)) lines.push("", `${pc.yellow("▲")} ${gameCopyWords(copy)}`);
  if (r.probed.length) lines.push("", `${pc.yellow("▲")} ${t("{archives} has no list of its files: only the names the game reads were looked for", { archives: r.probed.join(", ") })}`);
  if (r.unheld.length) lines.push("", pc.dim(t("Listed by its archive and not in it, left out: {list}", { list: `${r.unheld.slice(0, 3).join(", ")}${r.unheld.length > 3 ? ` ${t("and {n} more", { n: num(r.unheld.length - 3) })}` : ""}` })));
  if (r.duplicates.length) lines.push("", `${pc.yellow("▲")} ${t("{n, plural, one {# file} other {# files}} twice, in another case: {list}", { n: r.duplicates.length, list: `${r.duplicates.slice(0, 3).join("; ")}${r.duplicates.length > 3 ? " …" : ""}` })}`);
  if (r.left.length) lines.push("", pc.dim(r.left.length > 6
    ? t("Not the game's, left out: {list} and {more} more", { list: r.left.slice(0, 6).map((l) => l.split("/").pop()).join(", "), more: num(r.left.length - 6) })
    : t("Not the game's, left out: {list}", { list: r.left.map((l) => l.split("/").pop()).join(", ") })));
  return lines;
}
