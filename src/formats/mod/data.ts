/**
 * A mod's data as the game would see it: each table, string table and script the mod's own when it has one, else the
 * game's, with what the mod changed known entry by entry. `mod check` and `mod diff` read through this, and the
 * folder's names (the comments beside the tables, the AI script's unit names) come from it. Pure: the files are read
 * through the functions given.
 */
import { DAT_SCHEMAS, DAT_TABLES, type DatTableName } from "../dat/schema";
import { datRow, decodeDat, type DatFile } from "../dat/table";
import { decodeTblFile, tblFromText } from "../dat/tblFile";
import { readIscriptHeaders } from "../dat/iscriptText";
import { cleanLabel, composeUnitName } from "../../data/gameNames";
import type { ModNames } from "./folder";

/** A file by the game's name (`arr\units.dat`, any case), or null when there is none. */
export type ReadMember = (name: string) => Promise<Uint8Array | null>;

export interface ModData {
  /** Each table as the game would read it: the mod's, else the game's. */
  tables: Partial<Record<DatTableName, DatFile>>;
  /** The game's own tables, when a copy was given. */
  base: Partial<Record<DatTableName, DatFile>>;
  /** The tables the mod has, by the member they came from. */
  fromMod: Partial<Record<DatTableName, string>>;
  /** String tables (whole entries), the mod's else the game's; null where neither has one. */
  strings: { stat: string[] | null; unitnames: string[] | null; images: string[] | null; sfxdata: string[] | null; portdata: string[] | null; mapdata: string[] | null };
  /** Which of those the mod has. */
  stringsFromMod: Set<string>;
  /** iscript ids: every header of the mod's iscript files (or the game's), and the game's. */
  iscriptIds: Set<number> | null;
  baseIscriptIds: Set<number> | null;
  /** The mod's iscript files, by member. */
  iscriptFiles: string[];
  names: ModNames;
  /** Files that could not be read as what they are, with why. */
  problems: string[];
}

const STRING_FILES = { stat: "rez\\stat_txt.tbl", unitnames: "rez\\unitnames.tbl", images: "arr\\images.tbl", sfxdata: "arr\\sfxdata.tbl", portdata: "arr\\portdata.tbl", mapdata: "arr\\mapdata.tbl" } as const;

/** A string table's entry as text: up to its first NUL. */
export const entryText = (s: string | undefined): string => (s ?? "").replace(/\0[\s\S]*$/, "");

/**
 * Reads the mod's data over the game's. `modTables` names the mod's table members by table (`arr\units.datex`);
 * `iscripts` the mod's iscript members. `base` is the game's own files, or null when no copy was found.
 */
export async function loadModData(mod: ReadMember, base: ReadMember | null, modTables: Partial<Record<DatTableName, string>>, iscripts: readonly string[] = []): Promise<ModData> {
  const problems: string[] = [];
  const tables: ModData["tables"] = {}, baseTables: ModData["base"] = {}, fromMod: ModData["fromMod"] = {};
  for (const t of DAT_TABLES) {
    const member = modTables[t];
    if (base) {
      const b = await base(DAT_SCHEMAS[t].file);
      if (b) { try { baseTables[t] = decodeDat(t, b); } catch (e) { problems.push(`the game's ${DAT_SCHEMAS[t].file}: ${(e as Error).message}`); } }
    }
    const bytes = member ? await mod(member) : null;
    if (member && bytes) {
      try { tables[t] = decodeDat(t, bytes, { fileName: member }); fromMod[t] = member; continue; } catch (e) { problems.push(`${member}: ${(e as Error).message}`); }
    }
    if (baseTables[t]) tables[t] = baseTables[t];
  }
  const strings = { stat: null, unitnames: null, images: null, sfxdata: null, portdata: null, mapdata: null } as ModData["strings"];
  const stringsFromMod = new Set<string>();
  for (const [key, file] of Object.entries(STRING_FILES) as [keyof typeof STRING_FILES, string][]) {
    let bytes = await mod(file);
    if (bytes) stringsFromMod.add(key); else bytes = base ? await base(file) : null;
    if (!bytes) continue;
    try { strings[key] = decodeTblFile(bytes).strings; } catch (e) { problems.push(`${file}: ${(e as Error).message}`); }
  }
  const idsOf = (bytes: Uint8Array | null, name: string): Set<number> | null => {
    if (!bytes) return null;
    try { return new Set(readIscriptHeaders(bytes).headers.map((h) => h.id)); } catch (e) { problems.push(`${name}: ${(e as Error).message}`); return null; }
  };
  const baseIscriptIds = base ? idsOf(await base("scripts\\iscript.bin"), "the game's scripts\\iscript.bin") : null;
  let iscriptIds: Set<number> | null = null;
  for (const name of iscripts) {
    const ids = idsOf(await mod(name), name);
    if (ids) { iscriptIds ??= new Set(); for (const id of ids) iscriptIds.add(id); }
  }
  iscriptIds ??= baseIscriptIds;
  return { tables, base: baseTables, fromMod, strings, stringsFromMod, iscriptIds, baseIscriptIds, iscriptFiles: [...iscripts], names: namesOf(tables, strings), problems };
}

/** What each unit, weapon, upgrade, technology, image and sound is called, from the string tables. */
export function namesOf(tables: ModData["tables"], strings: ModData["strings"]): ModNames {
  const stat = strings.stat ?? [];
  const label = (id: number) => (id > 0 && id <= stat.length ? cleanLabel(entryText(stat[id - 1])) : "");
  const units: string[] = [];
  const unitCount = tables.units?.count ?? 0;
  for (let id = 0; id < unitCount; id++) {
    // A mod past 228 units names them all in rez\unitnames.tbl (GPTP's DatExtend), the game in stat_txt.tbl.
    const own = strings.unitnames?.[id];
    const entry = own && entryText(own) ? own : id < 228 ? stat[id] : undefined;
    units.push(entry ? composeUnitName(entry.split("\0")) : "");
  }
  const labels = (t: DatFile | undefined) => Array.from({ length: t?.count ?? 0 }, (_, id) => label(t!.columns.label[id]));
  const paths = (t: DatFile | undefined, field: string, list: string[] | null, under: string) =>
    Array.from({ length: t?.count ?? 0 }, (_, id) => { const v = t!.columns[field][id]; return v > 0 && list && v <= list.length ? `${under}${entryText(list[v - 1])}` : ""; });
  return {
    units, weapons: labels(tables.weapons), upgrades: labels(tables.upgrades), technologies: labels(tables.techdata),
    images: paths(tables.images, "grp_file", strings.images, "unit\\"), sounds: paths(tables.sfxdata, "sound_file", strings.sfxdata, "sound\\"),
  };
}

/**
 * The files a GPTP mod names things in beside the game's string tables:
 *
 * - `rez\stat.txt`: PyTBL text the mod's plugin loads as the game's strings (Cosmonarchy's weapons' labels point
 *   past `stat_txt.tbl`'s end, into it).
 * - `arr\weapons.txt`, `upgrades.txt`, `techdata.txt`: the mod's own name lists, one line an entry, which its makers'
 *   data editors show (Cosmonarchy: "Gauss Rifle (Maverick)", "Lobotomy Grenade (Francisco Goska)").
 */
export const NAME_TEXT_FILES = { stat: "rez\\stat.txt", weapons: "arr\\weapons.txt", upgrades: "arr\\upgrades.txt", techdata: "arr\\techdata.txt" } as const;

/** A text file's bytes as text: UTF-8 where it is that, else Windows-1252, as the mods' tools write them. */
export function nameFileText(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return new TextDecoder("windows-1252").decode(bytes); }
}

/**
 * `stat_txt.tbl`'s whole entries with `rez\stat.txt` (null: none) filling those the table leaves empty or does not
 * reach; where both have an entry, the table's stands (the text holds button strings at some of the techs' label
 * numbers).
 */
export function statWithText(table: readonly string[], text: string | null): string[] {
  const lines = text === null ? [] : tblFromText(text.replace(/\r\n/g, "\n"));
  return Array.from({ length: Math.max(lines.length, table.length) }, (_, i) => (entryText(table[i]) ? table[i] : lines[i] ?? ""));
}

/** How many of `rez\stat.txt`'s entries have text. */
export const statTextEntries = (text: string | null): number => (text === null ? 0 : tblFromText(text.replace(/\r\n/g, "\n")).filter((l) => entryText(l)).length);

/**
 * A mod's name list (`arr\upgrades.txt`, …) over a table of `count` entries: one name an entry, `""` where its line is
 * empty (the label stands there); null when there is no list or it has not exactly a line an entry, which is not one.
 */
export function nameList(text: string | null, count: number): string[] | null {
  if (text === null || !count) return null;
  const rows = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return rows.length === count ? rows.map((r) => r.trim()) : null;
}

/** A row with struct fields spread out (`unit_extents.left`). */
export function flatRow(file: DatFile, id: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(datRow(file, id))) {
    if (typeof v === "number") out[k] = v; else for (const [p, n] of Object.entries(v)) out[`${k}.${p}`] = n;
  }
  return out;
}

/** The fields an entry has another value in than in `before` (a field one side does not store counts as 0). */
export function rowChanges(before: DatFile, after: DatFile, id: number): { field: string; before: number; after: number }[] {
  const a = id < before.count ? flatRow(before, id) : {}, b = id < after.count ? flatRow(after, id) : {};
  const out: { field: string; before: number; after: number }[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[k] ?? 0) !== (b[k] ?? 0)) out.push({ field: k, before: a[k] ?? 0, after: b[k] ?? 0 });
  return out;
}

/** Whether entry `id` of a table is the mod's own: added past the game's, or changed from it. Without the game's table, an entry past the game's count. */
export function ownEntry(data: ModData, table: DatTableName, id: number): boolean {
  if (!data.fromMod[table]) return false;
  const base = data.base[table];
  if (!base) return id >= DAT_SCHEMAS[table].entries;
  if (id >= base.count) return true;
  return rowChanges(base, data.tables[table]!, id).length > 0;
}
