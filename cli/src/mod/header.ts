/**
 * `scmjs mod header <mod>`: a mod's unit, weapon, upgrade and technology ids by name, for a bot made for that mod —
 * `<Mod>.h`, C++ for a BWAPI bot built with the scmbot toolchain (C++17: `inline const BWAPI::UnitType Mason(7);`),
 * and `<Mod>.ids.json`, the same for bots and tools in other languages. Both carry the mod's name and hash (`hash.ts`,
 * the rule `mod info` and the play page share), so a bot says which mod it was made for. With `--bot`, the output
 * folder is a bot's (it has `scmbot.json`) and `scmbot.json` gains `mod: { name, hash, link? }`, which the toolchain
 * writes into the `.scmbot` file's header and the runners compare with the game's mod.
 *
 * The names are the mod's as the editor shows them (`loadModData`/`namesOf`: `rez\unitnames.tbl` for a mod past the
 * game's 228 units, else `stat_txt.tbl`; the tables' labels for weapons, upgrades and technologies), every one of
 * them, not only those past the game's: a total conversion renames everything.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadModData, nameFileText, nameList, NAME_TEXT_FILES, namesOf, statTextEntries, statWithText, type ModData } from "../../../src/formats/mod/data";
import { CliError } from "../ui";
import { t } from "../i18n";
import type { GameFiles } from "../gamefiles";
import { iscriptMembers, modTables } from "./check";
import { sourceHash } from "./hash";
import { reader, type ModSource } from "./source";

export interface HeaderEntry { id: number; name: string; identifier: string }

export interface ModHeader {
  mod: { name: string; hash: string; link?: string };
  /** The C++ namespace, and the files' base name. */
  namespace: string;
  units: HeaderEntry[];
  weapons: HeaderEntry[];
  upgrades: HeaderEntry[];
  techs: HeaderEntry[];
}

/** C++'s keywords, and the names Windows' and BWAPI's headers make macros of, which an identifier must not be. */
const RESERVED = new Set([
  "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand", "bitor", "bool", "break", "case", "catch", "char", "char8_t", "char16_t", "char32_t",
  "class", "compl", "concept", "const", "consteval", "constexpr", "constinit", "const_cast", "continue", "co_await", "co_return", "co_yield", "decltype",
  "default", "delete", "do", "double", "dynamic_cast", "else", "enum", "explicit", "export", "extern", "false", "float", "for", "friend", "goto", "if",
  "inline", "int", "long", "mutable", "namespace", "new", "noexcept", "not", "not_eq", "nullptr", "operator", "or", "or_eq", "private", "protected",
  "public", "register", "reinterpret_cast", "requires", "return", "short", "signed", "sizeof", "static", "static_assert", "static_cast", "struct",
  "switch", "template", "this", "thread_local", "throw", "true", "try", "typedef", "typeid", "typename", "union", "unsigned", "using", "virtual",
  "void", "volatile", "wchar_t", "while", "xor", "xor_eq",
  "NULL", "TRUE", "FALSE", "IN", "OUT", "OPTIONAL", "ERROR", "DELETE", "VOID", "CONST", "INFINITE", "PASCAL", "CALLBACK", "WINAPI", "APIENTRY",
  "BOOL", "BYTE", "WORD", "DWORD", "UINT", "INT", "CHAR", "LONG", "SHORT", "FLOAT", "HANDLE", "MAX_PATH", "min", "max", "small", "far", "near",
  "assert", "errno", "stdin", "stdout", "stderr", "EOF",
]);

/**
 * A name made a C++ identifier: every run of characters other than letters, digits and `_` becomes one `_`, the ends
 * trimmed of `_`; a leading digit is prefixed with `_`, as is a keyword or a Windows macro's name. Empty when nothing
 * of the name is left (a name in another script): the caller gives such an entry `<Kind>_<id>`.
 */
export function identifierOf(name: string): string {
  let id = name.replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!id) return "";
  if (/^[0-9]/.test(id) || RESERVED.has(id)) id = `_${id}`;
  return id;
}

/**
 * Rows that name nothing a bot can make or use: no name, or the game's own placeholders — "None", "Reserved",
 * "Unused" (with or without a subname in brackets), "*", and a data editor's "Extended Tech #54" for a row past the
 * game's that nothing fills. The game's "None" entries (unit 228, weapon 130, upgrade 61,
 * tech 44) are among them; GPTP mods name the rows they keep free "Reserved".
 */
export function unusedName(name: string): boolean {
  const n = name.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
  return !n || n === "*" || n === "none" || n === "reserved" || n === "unused" || /^extended (unit|weapon|upgrade|tech|technology) #\d+$/.test(n);
}

/**
 * The named entries of one kind, with an identifier each, unique within the kind: the first entry of a name keeps the
 * identifier, a later one with the same is suffixed `_<id>`.
 */
export function headerEntries(names: readonly string[], kind: string): HeaderEntry[] {
  const out: HeaderEntry[] = [];
  const taken = new Set<string>();
  names.forEach((raw, id) => {
    const name = (raw ?? "").trim();
    if (unusedName(name)) return;
    let identifier = identifierOf(name) || `${kind}_${id}`;
    if (taken.has(identifier)) identifier = `${identifier}_${id}`;
    while (taken.has(identifier)) identifier = `${identifier}_`;
    taken.add(identifier);
    out.push({ id, name, identifier });
  });
  return out;
}

/** The header's content from the mod's names. */
export function modHeaderOf(mod: ModHeader["mod"], names: ModData["names"], namespace?: string): ModHeader {
  if (namespace !== undefined && (!namespace || identifierOf(namespace) !== namespace)) throw new CliError(t("--namespace takes a C++ identifier (letters, digits and _, not starting with a digit), not \"{value}\"", { value: namespace ?? "" }), null, 2);
  const ns = namespace ?? (identifierOf(mod.name) || "Mod");
  return {
    mod, namespace: ns,
    units: headerEntries(names.units, "Unit"), weapons: headerEntries(names.weapons, "Weapon"),
    upgrades: headerEntries(names.upgrades, "Upgrade"), techs: headerEntries(names.technologies, "Tech"),
  };
}

/** A C++ string literal. */
// eslint-disable-next-line no-control-regex
const cString = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
/** A name in a C++ line comment (no line breaks, nothing that ends the line). */
// eslint-disable-next-line no-control-regex
const comment = (s: string) => s.replace(/[\x00-\x1f]/g, " ");

/** `<Mod>.h`. `date` is the day it says it was written on (YYYY-MM-DD). */
export function headerText(h: ModHeader, date: string): string {
  const kinds: [string, string, string, HeaderEntry[]][] = [
    ["UnitTypes", "BWAPI::UnitType", "Units", h.units], ["WeaponTypes", "BWAPI::WeaponType", "Weapons", h.weapons],
    ["UpgradeTypes", "BWAPI::UpgradeType", "Upgrades", h.upgrades], ["TechTypes", "BWAPI::TechType", "Techs", h.techs],
  ];
  const lines = [
    `// ${comment(h.mod.name)}: its unit, weapon, upgrade and technology ids by name, for a bot made for it.`,
    `// Generated by \`scmjs mod header\` from ${comment(h.mod.name)} (hash ${h.mod.hash}) on ${date}. Do not edit: run it again.`,
    `// ${h.units.length} units, ${h.weapons.length} weapons, ${h.upgrades.length} upgrades, ${h.techs.length} techs.`,
    "#pragma once",
    "#include <BWAPI.h>",
    "",
    `namespace ${h.namespace}`,
    "{",
    `  inline constexpr const char *MOD_NAME = ${cString(h.mod.name)};`,
    `  inline constexpr const char *MOD_HASH = ${cString(h.mod.hash)};`,
  ];
  for (const [ns, type, , list] of kinds) {
    lines.push("", `  namespace ${ns}`, "  {");
    for (const e of list) lines.push(`    inline const ${type} ${e.identifier}(${e.id});${e.identifier === e.name ? "" : `  // ${comment(e.name)}`}`);
    lines.push("  }");
  }
  lines.push("", "  namespace Ids", "  {");
  for (const [, , ns, list] of kinds) {
    lines.push(`    namespace ${ns}`, "    {");
    for (const e of list) lines.push(`      constexpr int ${e.identifier} = ${e.id};`);
    lines.push("    }");
  }
  lines.push("  }", "}", "");
  return lines.join("\n");
}

/** `<Mod>.ids.json`. */
export function idsJson(h: ModHeader): string {
  const kind = (list: HeaderEntry[]) => list.map((e) => ({ id: e.id, name: e.name, identifier: e.identifier }));
  return JSON.stringify({ mod: h.mod, units: kind(h.units), weapons: kind(h.weapons), upgrades: kind(h.upgrades), techs: kind(h.techs) }, null, 2) + "\n";
}

/** `scmbot.json` with `mod` set (in its place when it had one, else last), the rest as it was. */
export function withMod(scmbotJson: string, mod: ModHeader["mod"]): string {
  let c: Record<string, unknown>;
  try { c = JSON.parse(scmbotJson); } catch { throw new CliError(t("scmbot.json cannot be read as JSON."), null, 2); }
  if (!c || typeof c !== "object" || Array.isArray(c)) throw new CliError(t("scmbot.json cannot be read as JSON."), null, 2);
  c.mod = { name: mod.name, hash: mod.hash, ...(mod.link ? { link: mod.link } : {}) };
  return JSON.stringify(c, null, 2) + "\n";
}

export interface HeaderOptions {
  /** The folder to write in (the bot's with `bot`); the working folder by default. */
  out?: string;
  namespace?: string;
  /** `out` is a bot's folder: `scmbot.json` gains the mod. */
  bot?: boolean;
  /** The day written into the header (YYYY-MM-DD); today by default. */
  date?: string;
}

export interface HeaderResult {
  mod: ModHeader["mod"];
  namespace: string;
  counts: { units: number; weapons: number; upgrades: number; techs: number };
  files: { header: string; ids: string; scmbot: string | null };
  /** Tables the names came from the copy of the game for (the mod has not got them). */
  fromGame: string[];
  /** How many entries of the mod's `rez\stat.txt` were read over `stat_txt.tbl`'s (0: it has none). */
  statText: number;
  /** The mod's own name lists taken over the tables' labels (`arr\weapons.txt`, …). */
  lists: string[];
}

/**
 * The names a bot author knows the mod's types by, read through `loadModData`'s tables and string tables with what GPTP
 * mods add to them:
 *
 * - `rez\stat.txt`: PyTBL text a GPTP mod's plugin loads as the game's strings (Cosmonarchy's weapons' labels point
 *   past `stat_txt.tbl`'s end, into it). It fills the entries the table leaves empty or does not reach; where both
 *   have an entry, the table's stands (the text holds button strings at some of the techs' label numbers).
 * - `arr\weapons.txt`, `upgrades.txt`, `techdata.txt`: the mod's own name lists, one line an entry, which its makers'
 *   data editors show (Cosmonarchy: "Gauss Rifle (Maverick)", "Stim Packs (Maverick)"). Taken when the list has a line
 *   for every entry of its table, over the labels; an empty line keeps the label.
 *
 * Units are named as the editor and the play page name them (`rez\unitnames.tbl`, else `stat_txt.tbl`).
 */
export async function modNames(source: ModSource, data: ModData): Promise<{ names: ModData["names"]; statText: number; lists: string[] }> {
  const text = async (name: string): Promise<string | null> => {
    const f = source.files.get(name);
    return f ? nameFileText(await f.read()) : null;
  };
  const statText = await text(NAME_TEXT_FILES.stat);
  const names = namesOf(data.tables, { ...data.strings, stat: statWithText(data.strings.stat ?? [], statText) });
  const lists: string[] = [];
  for (const [table, kind] of [["weapons", "weapons"], ["upgrades", "upgrades"], ["techdata", "technologies"]] as const) {
    const rows = nameList(await text(NAME_TEXT_FILES[table]), data.tables[table]?.count ?? 0);
    if (!rows) continue;
    names[kind] = names[kind].map((label, id) => rows[id] || label);
    lists.push(NAME_TEXT_FILES[table]);
  }
  return { names, statText: statTextEntries(statText), lists };
}

/** Writes `<Mod>.h` and `<Mod>.ids.json` for the mod (and the mod into the bot's `scmbot.json` with `bot`). */
export async function writeModHeader(source: ModSource, base: GameFiles | null, o: HeaderOptions = {}): Promise<HeaderResult> {
  const out = resolve(o.out ?? ".");
  const scmbot = join(out, "scmbot.json");
  if (o.bot && !existsSync(scmbot)) throw new CliError(t("{folder} has no scmbot.json: --bot writes into a bot's folder.", { folder: o.out ?? "." }), t("scmjs bot init or scmjs bot new writes one; without --bot the files go in any folder."), 2);
  const data = await loadModData(reader(source), base ? (n) => base.read(n) : null, modTables(source), iscriptMembers(source));
  if (!data.tables.units) throw new CliError(t("{mod} has no units.dat, and no copy of StarCraft was found to read the game's: there are no units to name.", { mod: source.name }), t("Name your copy of the game with --starcraft."));
  const names = await modNames(source, data);
  const hash = await sourceHash(source);
  const link = source.link ?? undefined;
  const h = modHeaderOf({ name: source.name, hash: hash.hash, ...(link ? { link } : {}) }, names.names, o.namespace);
  const date = o.date ?? new Date().toISOString().slice(0, 10);
  mkdirSync(out, { recursive: true });
  const header = join(out, `${h.namespace}.h`), ids = join(out, `${h.namespace}.ids.json`);
  writeFileSync(header, headerText(h, date));
  writeFileSync(ids, idsJson(h));
  if (o.bot) writeFileSync(scmbot, withMod(readFileSync(scmbot, "utf8"), h.mod));
  const fromGame = (["units", "weapons", "upgrades", "techdata"] as const).filter((k) => data.tables[k] && !data.fromMod[k]);
  return {
    mod: h.mod, namespace: h.namespace,
    counts: { units: h.units.length, weapons: h.weapons.length, upgrades: h.upgrades.length, techs: h.techs.length },
    // (paths as typed: the folder named with --out, or none for the working folder's)
    files: { header: join(o.out ?? "", `${h.namespace}.h`), ids: join(o.out ?? "", `${h.namespace}.ids.json`), scmbot: o.bot ? join(o.out ?? "", "scmbot.json") : null }, fromGame, statText: names.statText, lists: names.lists,
  };
}
