/**
 * `scmjs mod info <mpq|folder|exe|zip>`: what a mod is — its name, files and sizes by kind, which tables are wider than
 * the game's and in which layout, what it carries that is not run (plugins, FireGraft files), its maps, and the game it
 * is for. Read from names and sizes, plus each table's size; nothing is run.
 */
import { DAT_SCHEMAS, datTableOf } from "../../../src/formats/dat/schema";
import { datShape } from "../../../src/formats/dat/table";
import { gameName } from "../../../src/formats/mod/sources";
import { dot, num, pc, plural, rows, size } from "../ui";
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

const HOW = { dat: "the game's layout", expanded: "DatExtend's expanded layout (PyMS)", datex: "GPTP's .datex layout" } as const;

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
    const t = /^arr\\[^\\]+\.dat(?:ex)?$/.test(gameName(f.name)) ? datTableOf(f.name) : null;
    if (!t) continue;
    const shape = datShape(t, f.size, f.name);
    const standard = DAT_SCHEMAS[t].entries;
    const extended = !!shape && (shape.layout !== "dat");
    tables.push({
      table: t, member: f.name, layout: shape?.layout ?? null, entries: shape?.count ?? null, standard, extended,
      how: !shape ? `${num(f.size)} bytes, which is no layout of ${t}` : shape.layout === "dat" ? `${num(shape.count)} entries${shape.legacy ? ", the original game's (no Brood War columns)" : ""}` : `${num(shape.count)} entries (the game's ${num(standard)}), ${HOW[shape.layout]}`,
    });
  }
  const names = [...source.files.keys()];
  const remastered = names.some((n) => /^(anim|hd2|sd)\\|\.(dds|anim)$/.test(n));
  const game = source.manifest?.base ? `StarCraft ${source.manifest.base}` : remastered ? "StarCraft: Remastered (its own pictures; samase)" : "StarCraft 1.16.1";
  return {
    path: source.path, name: source.name, kind: source.kind, layers: source.layers, files: source.files.size, bytes, kinds, tables,
    extended: tables.filter((t) => t.extended).map((t) => `${t.member.split("\\").pop()}: ${t.how}`),
    scripts: [...source.files.values()].filter((f) => /^scripts\\.*\.bin$/.test(gameName(f.name))).map((f) => f.name).sort(),
    plugins: source.plugins.map((p) => ({ name: p.name.split(/[\\/]/).pop()!, bytes: p.bytes })),
    firegraft: source.firegraft.map((p) => ({ name: p.name.split(/[\\/]/).pop()!, bytes: p.bytes })),
    exes: source.exes, maps: [...source.files.values()].filter((f) => kindOf(f.name) === "maps").map((f) => f.name).sort(),
    game, duplicates: source.duplicates, left: source.left, probed: source.probed,
  };
}

const KIND_WORDS: Record<ModKind, [string, string]> = {
  tables: ["table", "tables"], scripts: ["script", "scripts"], pictures: ["picture", "pictures"], sounds: ["sound", "sounds"], terrain: ["terrain file", "terrain files"],
  strings: ["string table", "string tables"], AI: ["AI script", "AI scripts"], maps: ["map", "maps"], other: ["other file", "other files"],
};

const FROM: Record<ModSource["kind"], string> = {
  "mod folder": "a mod folder scmjs mod unpack wrote", folder: "a folder of the game's files", archive: "an MPQ", exe: "a self-executing mod (its archive read, nothing run)", zip: "a zip", game: "the game's own files",
};

export function printModInfo(r: ModInfo): string[] {
  const lines = [pc.bold(r.name), pc.dim(`A mod for ${r.game}, from ${FROM[r.kind]}`), ""];
  const kinds = MOD_KINDS.filter((k) => r.kinds[k]).map((k) => `${plural(r.kinds[k]!.files, ...KIND_WORDS[k])} ${pc.dim(`(${size(r.kinds[k]!.bytes)})`)}`);
  lines.push(...rows([
    ["Files", `${num(r.files)}${dot}${size(r.bytes)}`],
    ["Kinds", kinds.join(", ") || pc.dim("none")],
    ["Tables", r.tables.length ? r.tables.map((t) => t.member.split("\\").pop()).join(", ") : null],
    ["Extended", r.extended.length ? r.extended[0] : null],
    ...r.extended.slice(1).map((e) => ["", e] as [string, string]),
    ["Scripts", r.scripts.length ? r.scripts.map((s) => s.split("\\").pop()).join(", ") : null],
    ["Plugins", r.plugins.length ? `${r.plugins.map((p) => `${p.name} ${pc.dim(`(${size(p.bytes)})`)}`).join(", ")} ${pc.dim("— kept, not run")}` : null],
    ["FireGraft", r.firegraft.length ? `${r.firegraft.map((p) => `${p.name} ${pc.dim(`(${size(p.bytes)})`)}`).join(", ")} ${pc.dim("— kept, not applied")}` : null],
    ...r.exes.map((e) => ["Exe", `${e.file}: ${e.kind === "firegraft" ? `FireGraft's patcher${e.plugins.length ? ` with ${plural(e.plugins.length, "plugin")} (${e.plugins.map((p) => `id ${p.id.toString(16)}, ${size(p.size)}`).join("; ")})` : ""}` : "MPQDraft's self-executing MPQ"}, its archive at byte ${num(e.at)}`] as [string, string]),
    ["Maps", r.maps.length ? `${plural(r.maps.length, "map")}${r.maps.length <= 4 ? `: ${r.maps.map((m) => m.split("\\").pop()).join(", ")}` : ""}` : null],
    ["Layers", r.layers.length > 1 ? r.layers.map(shownPath).join(pc.dim(" then ")) : null],
  ]));
  if (r.probed.length) lines.push("", `${pc.yellow("▲")} ${r.probed.join(", ")} has no list of its files: only the names the game reads were looked for`);
  if (r.duplicates.length) lines.push("", `${pc.yellow("▲")} ${plural(r.duplicates.length, "file")} twice, in another case: ${r.duplicates.slice(0, 3).join("; ")}${r.duplicates.length > 3 ? " …" : ""}`);
  if (r.left.length) lines.push("", pc.dim(`Not the game's, left out: ${r.left.slice(0, 6).map((l) => l.split("/").pop()).join(", ")}${r.left.length > 6 ? ` and ${num(r.left.length - 6)} more` : ""}`));
  return lines;
}
