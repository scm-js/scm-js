/**
 * `scmjs mod info <mpq|folder|exe|zip>`: what a mod is — its name, files and sizes by kind, which tables are wider than
 * the game's and in which layout, what it carries that is not run (plugins, FireGraft files), its maps, and the game it
 * is for. Read from names and sizes, plus each table's size; nothing is run.
 */
import { DAT_SCHEMAS, datTableOf } from "../../../src/formats/dat/schema";
import { datShape } from "../../../src/formats/dat/table";
import { gameName } from "../../../src/formats/mod/sources";
import { t } from "../i18n";
import { dot, num, pc, rows, size } from "../ui";
import { shownPath, type ModSource } from "./source";

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
  plugins: { name: string; bytes: number }[];
  firegraft: { name: string; bytes: number }[];
  exes: ModSource["exes"];
  maps: string[];
  /** The game the mod is for, as far as its files say. */
  game: string;
  duplicates: string[];
  left: string[];
  probed: string[];
}

/** The layout a table is in, in words. */
function howWords(layout: "expanded" | "datex"): string {
  return layout === "expanded" ? t("DatExtend's expanded layout (PyMS)") : t("GPTP's .datex layout");
}

export function modInfo(source: ModSource): ModInfo {
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
    plugins: source.plugins.map((p) => ({ name: p.name.split(/[\\/]/).pop()!, bytes: p.bytes })),
    firegraft: source.firegraft.map((p) => ({ name: p.name.split(/[\\/]/).pop()!, bytes: p.bytes })),
    exes: source.exes, maps: [...source.files.values()].filter((f) => kindOf(f.name) === "maps").map((f) => f.name).sort(),
    game, duplicates: source.duplicates, left: source.left, probed: source.probed,
  };
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

export function printModInfo(r: ModInfo): string[] {
  const lines = [pc.bold(r.name), pc.dim(fromWords(r.kind, r.game)), ""];
  const kinds = MOD_KINDS.filter((k) => r.kinds[k]).map((k) => `${kindWords(k, r.kinds[k]!.files)} ${pc.dim(`(${size(r.kinds[k]!.bytes)})`)}`);
  const patcher = (e: ModInfo["exes"][number]) => e.plugins.length
    ? t("FireGraft's patcher with {n, plural, one {# plugin} other {# plugins}} ({list})", { n: e.plugins.length, list: e.plugins.map((p) => `id ${p.id.toString(16)}, ${size(p.size)}`).join("; ") })
    : t("FireGraft's patcher");
  lines.push(...rows([
    [t("Files"), `${num(r.files)}${dot}${size(r.bytes)}`],
    [t("Kinds"), kinds.join(", ") || pc.dim(t("none"))],
    [t("Tables"), r.tables.length ? r.tables.map((x) => x.member.split("\\").pop()).join(", ") : null],
    [t("Extended"), r.extended.length ? r.extended[0] : null],
    ...r.extended.slice(1).map((e) => ["", e] as [string, string]),
    [t("Scripts"), r.scripts.length ? r.scripts.map((s) => s.split("\\").pop()).join(", ") : null],
    [t("Plugins"), r.plugins.length ? `${r.plugins.map((p) => `${p.name} ${pc.dim(`(${size(p.bytes)})`)}`).join(", ")} ${pc.dim(t("— kept, not run"))}` : null],
    ["FireGraft", r.firegraft.length ? `${r.firegraft.map((p) => `${p.name} ${pc.dim(`(${size(p.bytes)})`)}`).join(", ")} ${pc.dim(t("— kept, not applied"))}` : null],
    ...r.exes.map((e) => ["Exe", t("{file}: {what}, its archive at byte {at}", { file: e.file, what: e.kind === "firegraft" ? patcher(e) : t("MPQDraft's self-executing MPQ"), at: num(e.at) })] as [string, string]),
    [t("Maps"), r.maps.length ? `${t("{n, plural, one {# map} other {# maps}}", { n: r.maps.length })}${r.maps.length <= 4 ? `: ${r.maps.map((m) => m.split("\\").pop()).join(", ")}` : ""}` : null],
    [t("Layers"), r.layers.length > 1 ? r.layers.map(shownPath).join(pc.dim(` ${t("then")} `)) : null],
  ]));
  if (r.probed.length) lines.push("", `${pc.yellow("▲")} ${t("{archives} has no list of its files: only the names the game reads were looked for", { archives: r.probed.join(", ") })}`);
  if (r.duplicates.length) lines.push("", `${pc.yellow("▲")} ${t("{n, plural, one {# file} other {# files}} twice, in another case: {list}", { n: r.duplicates.length, list: `${r.duplicates.slice(0, 3).join("; ")}${r.duplicates.length > 3 ? " …" : ""}` })}`);
  if (r.left.length) lines.push("", pc.dim(r.left.length > 6
    ? t("Not the game's, left out: {list} and {more} more", { list: r.left.slice(0, 6).map((l) => l.split("/").pop()).join(", "), more: num(r.left.length - 6) })
    : t("Not the game's, left out: {list}", { list: r.left.map((l) => l.split("/").pop()).join(", ") })));
  return lines;
}
