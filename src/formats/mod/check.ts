/**
 * `scmjs mod check`: the lints across a mod's tables, string tables, scripts and files. Each finding says where it is
 * and, in a line, why it matters. Errors are what makes the game fail or show nothing (a reference past its table, an
 * image with no picture, an image whose script is missing); warnings are what is probably a mistake (a weapon the mod
 * added that nothing uses). What the mod left as the game had it is not judged: the game's own data has leftovers of
 * its own (unused weapons and scripts, sound rows naming files that are not there), and they are not the mod's.
 */
import { DAT_SCHEMAS, DAT_TABLES, type DatTableName } from "../dat/schema";
import { decodeButtonGraft, decodeReqGraft } from "../dat/graft";
import { entryText, ownEntry, type ModData } from "./data";

export interface ModFinding {
  level: "error" | "warning";
  /** What kind of finding: `dangling`, `grp-missing`, `iscript-missing`, `iscript-unused`, `weapon-unused`, `sound-missing`, `string-past`, `button-set`, `requirement`, `layout-mix`, `duplicate-name`, `duplicate-file`. */
  rule: string;
  /** Where: `units 0 (Terran Marine) ground_weapon`, `images.tbl`, `datreq\units.graft entry 12`. */
  where: string;
  why: string;
}

export interface CheckFiles {
  /** Whether the mod has a file, by the game's name. */
  inMod(name: string): boolean;
  /** Whether the game has it; null when no copy of the game was given (or it does not hold such files). */
  inBase: ((name: string) => Promise<boolean | null>) | null;
  /** The mod's `.graft` files. */
  grafts: { member: string; bytes: Uint8Array }[];
}

/** The game's highest iscript id: an id past it is one a mod added (used when no copy of the game was given). */
export const GAME_ISCRIPT_LAST = 411;

/** A name that says it is a placeholder (`Reserved`, `Unused`), which a mod may give many entries. */
const PLACEHOLDER = /^\s*(reserved|unused|\*|)\s*($|\b)/i;

/** Where a table's references point, by the schema's `ref`. */
const TABLE_REFS = new Set<string>(DAT_TABLES);

export async function checkMod(data: ModData, files: CheckFiles): Promise<ModFinding[]> {
  const out: ModFinding[] = [];
  const name = (t: DatTableName, id: number) => {
    const list = t === "units" ? data.names.units : t === "weapons" ? data.names.weapons : t === "upgrades" ? data.names.upgrades : t === "techdata" ? data.names.technologies : null;
    const n = list?.[id];
    return `${t} ${id}${n ? ` (${n})` : ""}`;
  };
  const exists = async (path: string): Promise<boolean | null> => {
    if (files.inMod(path)) return true;
    return files.inBase ? await files.inBase(path) : null;
  };

  // References past their tables: the mod's tables, every entry (the game's own are whole).
  for (const t of DAT_TABLES) {
    const file = data.tables[t];
    if (!file || !data.fromMod[t]) continue;
    for (const field of DAT_SCHEMAS[t].fields) {
      if (!field.ref || field.parts) continue;
      const col = file.columns[field.name];
      for (let id = 0; id < file.count; id++) {
        if (field.count !== undefined && file.layout === "dat" && (id < (field.first ?? 0) || id >= (field.first ?? 0) + field.count)) continue;
        const v = col[id];
        if (TABLE_REFS.has(field.ref)) {
          const target = data.tables[field.ref as DatTableName];
          if (!target) continue;
          // "None" is the game's own count (a unit's 130th weapon, 228th subunit), or the column's all-ones.
          const none = v === DAT_SCHEMAS[field.ref as DatTableName].entries || v === 0xffff || v === 0xff && field.type === "u8" || v === 0xffffffff;
          if (v >= target.count && !none) out.push({ level: "error", rule: "dangling", where: `${name(t, id)} ${field.name}`, why: `points at ${field.ref} ${v}, past the ${target.count} entries ${DAT_SCHEMAS[field.ref as DatTableName].file.replace(/^arr\\/, "")} has` });
        } else if (field.ref.endsWith(".tbl")) {
          const key = field.ref === "stat_txt.tbl" ? "stat" : field.ref.replace(/\.tbl$/, "") as keyof ModData["strings"];
          const list = data.strings[key];
          // units.dat's sublabel is an index into a group of stat_txt's strings, not a string id.
          if (!list || field.name === "sublabel" || v === 0) continue;
          if (v > list.length) out.push({ level: "error", rule: "string-past", where: `${name(t, id)} ${field.name}`, why: `names string ${v}, past the ${list.length} entries of ${field.ref}` });
        } else if (field.ref === "iscript.bin" && data.iscriptIds && !data.iscriptIds.has(v)) {
          out.push({ level: "error", rule: "iscript-missing", where: `${name(t, id)} ${field.name}`, why: `its animation script ${v} is in no iscript the mod or the game has: the image cannot be drawn` });
        }
      }
    }
  }

  // Pictures and overlay files: an image the mod added or changed, or any image when the mod changed images.tbl.
  const images = data.tables.images, itbl = data.strings.images;
  if (images && itbl && (data.fromMod.images || data.stringsFromMod.has("images"))) {
    const overlays = ["shield_overlay", "attack_overlay", "damage_overlay", "special_overlay", "landing_dust_overlay", "lift_off_dust_overlay"];
    for (let id = 0; id < images.count; id++) {
      const own = ownEntry(data, "images", id) || data.stringsFromMod.has("images");
      if (!own) continue;
      for (const field of ["grp_file", ...overlays]) {
        const v = images.columns[field][id];
        if (v === 0 || v > itbl.length) continue;
        const path = `unit\\${entryText(itbl[v - 1])}`;
        const there = await exists(path);
        // Unknown (no copy of the game to look in): only an image the mod itself added or changed is judged.
        if (there === false || (there === null && ownEntry(data, "images", id))) {
          if (field === "grp_file") out.push({ level: "error", rule: "grp-missing", where: `images ${id} grp_file`, why: `names ${path}, which is in neither the mod${files.inBase ? " nor the game" : ""}: the game stops when it draws it` });
          else out.push({ level: "error", rule: "lo-missing", where: `images ${id} ${field}`, why: `names ${path}, which is in neither the mod${files.inBase ? " nor the game" : ""}` });
        }
      }
    }
  }

  // Scripts no image uses: the ids the mod added.
  if (data.iscriptFiles.length && data.iscriptIds && images) {
    const used = new Set<number>();
    for (let id = 0; id < images.count; id++) used.add(images.columns.iscript_id[id]);
    for (const id of [...data.iscriptIds].sort((a, b) => a - b)) {
      const added = data.baseIscriptIds ? !data.baseIscriptIds.has(id) : id > GAME_ISCRIPT_LAST;
      if (added && !used.has(id)) out.push({ level: "warning", rule: "iscript-unused", where: `iscript ${id}`, why: "no image uses it: its animations never play" });
    }
  }

  // Weapons the mod added or changed that no unit carries and no order uses.
  const weapons = data.tables.weapons, units = data.tables.units, orders = data.tables.orders;
  if (weapons && data.fromMod.weapons && units) {
    const used = new Set<number>();
    for (let id = 0; id < units.count; id++) { used.add(units.columns.ground_weapon[id]); used.add(units.columns.air_weapon[id]); }
    for (let id = 0; id < (orders?.count ?? 0); id++) used.add(orders!.columns.weapon_targeting[id]);
    for (let id = 0; id < weapons.count; id++) {
      if (!used.has(id) && ownEntry(data, "weapons", id) && !PLACEHOLDER.test(data.names.weapons[id] ?? "")) out.push({ level: "warning", rule: "weapon-unused", where: name("weapons", id), why: "no unit carries it and no order uses it" });
    }
  }

  // Sound rows the mod added or changed whose file is nowhere.
  const sfx = data.tables.sfxdata, stbl = data.strings.sfxdata;
  if (sfx && stbl && data.fromMod.sfxdata) {
    for (let id = 0; id < sfx.count; id++) {
      const v = sfx.columns.sound_file[id];
      if (v === 0 || v > stbl.length || !ownEntry(data, "sfxdata", id)) continue;
      const path = `sound\\${entryText(stbl[v - 1])}`;
      if ((await exists(path)) === false) out.push({ level: "warning", rule: "sound-missing", where: `sfxdata ${id}`, why: `names ${path}, which is in neither the mod nor the game: the sound is silent` });
    }
  }

  // Buttons and requirements (GPTP's .graft files).
  for (const g of files.grafts) {
    const leaf = g.member.replace(/^.*\\/, "").toLowerCase();
    try {
      if (leaf === "buttons.graft") {
        const b = decodeButtonGraft(g.bytes);
        const count = units?.count ?? 0;
        b.sets.forEach((s, unit) => {
          if (units && unit >= count && s.count) out.push({ level: "error", rule: "button-set", where: `${g.member} unit ${unit}`, why: `a button set for unit ${unit}, past the ${count} units the mod has` });
          if (s.count && s.first + s.count > b.buttons.length) out.push({ level: "error", rule: "button-set", where: `${g.member} unit ${unit}`, why: `its set runs to button ${s.first + s.count - 1}, past the file's ${b.buttons.length}` });
          if (units && s.connected !== 0xffff && s.connected >= count) out.push({ level: "error", rule: "button-set", where: `${g.member} unit ${unit}`, why: `its connected unit ${s.connected} is past the ${count} units` });
        });
        // A unit the mod added that has no set: its command card is empty.
        if (units && data.fromMod.units) for (let unit = DAT_SCHEMAS.units.entries; unit < count; unit++) {
          const n = data.names.units[unit] ?? "";
          if (!ownEntry(data, "units", unit) || PLACEHOLDER.test(n)) continue;
          if (!b.sets[unit] || b.sets[unit].count === 0) out.push({ level: "warning", rule: "button-set", where: name("units", unit), why: `${g.member} gives it no buttons: its command card is empty` });
        }
      } else {
        const target: DatTableName | null = leaf.startsWith("units.") ? "units" : leaf.startsWith("upgrades.") ? "upgrades" : /^(tech|research)\./.test(leaf) ? "techdata" : leaf.startsWith("orders.") ? "orders" : null;
        const table = target ? data.tables[target] : undefined;
        if (!target || !table) continue;
        for (const e of decodeReqGraft(g.bytes).entries) {
          if (e.id >= table.count) out.push({ level: "error", rule: "requirement", where: `${g.member} entry ${e.id}`, why: `requirements for ${target === "techdata" ? "technology" : target.replace(/s$/, "")} ${e.id}, which ${DAT_SCHEMAS[target].file.replace(/^arr\\/, "")} does not have (${table.count} entries)` });
        }
      }
    } catch (e) {
      out.push({ level: "error", rule: "graft", where: g.member, why: `not read: ${(e as Error).message}` });
    }
  }

  // Tables in two extended layouts: DatExtend's expanded .dat and GPTP's .datex are read by different plugins.
  const layouts = new Map<string, string[]>();
  for (const t of DAT_TABLES) {
    const f = data.tables[t];
    if (!f || !data.fromMod[t] || t === "sfxdata" || f.layout === "dat") continue;
    layouts.set(f.layout, [...(layouts.get(f.layout) ?? []), t]);
  }
  if (layouts.size > 1) out.push({ level: "warning", rule: "layout-mix", where: [...layouts.values()].flat().join(", "), why: `${layouts.get("expanded")!.join(", ")} in DatExtend's expanded layout, ${layouts.get("datex")!.join(", ")} in GPTP's .datex: each is read by another plugin` });

  // Units the mod added or renamed that share a name with another.
  if (units) {
    const byName = new Map<string, number[]>();
    data.names.units.forEach((n, id) => { if (n && !PLACEHOLDER.test(n)) byName.set(n.toLowerCase(), [...(byName.get(n.toLowerCase()) ?? []), id]); });
    for (const ids of byName.values()) {
      if (ids.length < 2) continue;
      if (ids.some((id) => id >= DAT_SCHEMAS.units.entries || ownEntry(data, "units", id))) out.push({ level: "warning", rule: "duplicate-name", where: `units ${ids.join(", ")}`, why: `all are called "${data.names.units[ids[0]]}": a map maker cannot tell them apart in the palette` });
    }
  }
  return out;
}
