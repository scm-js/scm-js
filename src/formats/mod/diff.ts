/**
 * `scmjs mod diff`: what changed between two mods, as a changelog a person reads — "Terran Marine: ground weapon
 * damage 6 → 7", "unit 230 added: Terran Maverick", "iscript: Terran Marine's GndAttkRpt animation changed",
 * "3 pictures changed, 1 added", "sound 69 → Bullet\TGoFir00.wav". Each side is a mod over the game: a file a mod does
 * not have is the game's, so a mod diffed against the game itself says everything the mod changes. Pure.
 */
import { DAT_SCHEMAS, DAT_TABLES, type DatField, type DatTableName } from "../dat/schema";
import { decodeTblFile } from "../dat/tblFile";
import { ISCRIPT_ANIMS, ISCRIPT_OPCODES, readIscriptHeaders } from "../dat/iscriptText";
import { entryText, rowChanges, type ModData } from "./data";
import { gameName } from "./sources";

export type ModChangeKind = "table" | "strings" | "iscript" | "ai" | "pictures" | "overlays" | "sounds" | "grafts" | "maps" | "files";

export interface ModChange {
  kind: ModChangeKind;
  /** The line a person reads. */
  text: string;
  /** For a table: which and what. */
  table?: DatTableName;
  id?: number;
  field?: string;
  before?: number | string | null;
  after?: number | string | null;
  /** For a group of files: their names. */
  files?: string[];
}

/** A field's name in words: `damage_amount` → "damage". */
const WORDS: Record<string, string> = {
  damage_amount: "damage", damage_bonus: "damage bonus", hit_points: "hit points", shield_amount: "shields", mineral_cost: "minerals", vespene_cost: "gas",
  build_time: "build time", weapon_cooldown: "cooldown", maximum_range: "range", minimum_range: "minimum range", sight_range: "sight",
  supply_required: "supply", supply_provided: "supply provided", graphics: "graphics", sound_file: "sound file", grp_file: "picture",
};
const words = (field: string) => WORDS[field] ?? field.replace(/_/g, " ").replace(/\./g, " ");

/** A field's value as a person reads it: hit points whole, supply in units, flags by name. */
function valueText(field: DatField | undefined, part: string | undefined, v: number): string {
  if (!field || part) return String(v);
  const t = field.text;
  if (t?.kind === "hitPoints") return v % 256 ? (v / 256).toFixed(2) : String(v / 256);
  if (t?.kind === "supply") return v % 2 ? `${v / 2}` : String(v / 2);
  if (t?.kind === "bool") return v ? "yes" : "no";
  return String(v);
}

function flagsText(field: DatField, before: number, after: number): string {
  const t = field.text;
  if (t?.kind !== "flags") return "";
  const parts: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    const a = (before >>> bit) & 1, b = (after >>> bit) & 1;
    if (a === b) continue;
    const n = t.names[bit] || `0x${(2 ** bit).toString(16)}`;
    parts.push(`${b ? "+" : "−"}${n.replace(/_/g, " ")}`);
  }
  return parts.join(" ");
}

/** An iscript id's animations, each as its instructions reached from the entry point (labels as visit order). */
function iscriptAnimations(bytes: Uint8Array): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const { headers } = readIscriptHeaders(bytes);
  const byOp = new Map(ISCRIPT_OPCODES.map((o) => [o.op, o]));
  const u16 = (at: number) => bytes[at] | (bytes[at + 1] << 8);
  const walk = (start: number): string => {
    const order = new Map<number, number>([[start, 0]]);
    const queue = [start];
    const lines: string[] = [];
    while (queue.length && lines.length < 4000) {
      let at = queue.shift()!;
      lines.push(`@${order.get(at)}`);
      for (let n = 0; n < 1000 && at < bytes.length; n++) {
        const op = byOp.get(bytes[at]);
        if (!op) { lines.push(`?${bytes[at]}`); break; }
        let p = at + 1;
        const args: string[] = [];
        for (const k of op.args) {
          if (k === "b") { args.push(String(bytes[p])); p += 1; }
          else if (k === "s") { args.push(String((bytes[p] << 24) >> 24)); p += 1; }
          else if (k === "w" || k === "f") { args.push(String(u16(p))); p += 2; }
          else if (k === "L") {
            const target = u16(p); p += 2;
            if (!order.has(target)) { order.set(target, order.size); queue.push(target); }
            args.push(`@${order.get(target)}`);
          } else { const c = bytes[p]; p += 1; const list: number[] = []; for (let i = 0; i < c; i++) { list.push(u16(p)); p += 2; } args.push(list.join(",")); }
        }
        lines.push(`${op.name} ${args.join(" ")}`);
        if (op.endsFlow) break;
        at = p;
      }
    }
    return lines.join("\n");
  };
  for (const h of headers) out.set(h.id, h.anims.map((a) => (a ? walk(a) : "")));
  return out;
}

export interface DiffSide {
  data: ModData;
  /** A file of this side (the mod's, else the game's), by the game's name. */
  read(name: string): Promise<Uint8Array | null>;
  /** The mod's own files, by the game's name (lower case). */
  names: string[];
}

/** What an image is, for a person: the unit drawn with it, else its picture's path. */
function imageLabels(data: ModData): Map<number, string> {
  const out = new Map<number, string>();
  const { units, flingy, sprites } = data.tables;
  if (units && flingy && sprites) {
    for (let u = units.count - 1; u >= 0; u--) {
      const f = units.columns.graphics[u];
      const s = f < flingy.count ? flingy.columns.sprite[f] : -1;
      const img = s >= 0 && s < sprites.count ? sprites.columns.image[s] : -1;
      if (img >= 0 && data.names.units[u]) out.set(img, data.names.units[u]);
    }
  }
  data.names.images?.forEach((p, i) => { if (!out.has(i) && p) out.set(i, p); });
  return out;
}

const KIND_OF_FILE: [RegExp, ModChangeKind, string, string][] = [
  [/\.grp$/, "pictures", "picture", "pictures"], [/\.lo[a-z]$/, "overlays", "overlay file", "overlay files"], [/\.(wav|ogg)$/, "sounds", "sound", "sounds"],
  [/\.graft$/, "grafts", ".graft file", ".graft files"], [/^maps\\.*\.(scm|scx|chk)$/, "maps", "map", "maps"],
];

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;

export async function diffMods(a: DiffSide, b: DiffSide): Promise<ModChange[]> {
  const out: ModChange[] = [];
  const nameOf = (side: ModData, t: DatTableName, id: number): string => {
    const list = t === "units" ? side.names.units : t === "weapons" ? side.names.weapons : t === "upgrades" ? side.names.upgrades : t === "techdata" ? side.names.technologies : null;
    return list?.[id] || "";
  };
  const label = (t: DatTableName, id: number) => {
    const n = nameOf(b.data, t, id) || nameOf(a.data, t, id);
    const what = t === "techdata" ? "technology" : t === "sfxdata" ? "sound" : t === "portdata" ? "portrait" : t === "mapdata" ? "campaign map" : t.replace(/s$/, "");
    return n ? n : `${what} ${id}`;
  };
  const what = (t: DatTableName) => (t === "techdata" ? "technology" : t === "sfxdata" ? "sound" : t === "portdata" ? "portrait" : t === "mapdata" ? "campaign map" : t.replace(/s$/, ""));

  // Tables, entry by entry.
  for (const t of DAT_TABLES) {
    const before = a.data.tables[t], after = b.data.tables[t];
    if (!before || !after) continue;
    if (!a.data.fromMod[t] && !b.data.fromMod[t]) continue;
    const fields = new Map(DAT_SCHEMAS[t].fields.map((f) => [f.name, f]));
    const count = Math.max(before.count, after.count);
    for (let id = 0; id < count; id++) {
      if (id >= before.count) { const n = nameOf(b.data, t, id); out.push({ kind: "table", table: t, id, text: `${what(t)} ${id} added${n ? `: ${n}` : ""}` }); continue; }
      if (id >= after.count) { out.push({ kind: "table", table: t, id, text: `${what(t)} ${id} removed` }); continue; }
      for (const c of rowChanges(before, after, id)) {
        const [fname, part] = c.field.split(".");
        const field = fields.get(fname);
        let text: string;
        if (t === "sfxdata" && fname === "sound_file") text = `sound ${id} → ${entryText(b.data.strings.sfxdata?.[c.after - 1]) || c.after}`;
        else if (t === "images" && fname === "grp_file") text = `image ${id} → ${entryText(b.data.strings.images?.[c.after - 1]) || c.after}`;
        else if (field?.text?.kind === "flags") text = `${label(t, id)}: ${words(fname)} ${flagsText(field, c.before, c.after)}`;
        else text = `${label(t, id)}: ${words(c.field)} ${valueText(field, part, c.before)} → ${valueText(field, part, c.after)}`;
        // A weapon is read through the units that carry it.
        if (t === "weapons") {
          const carriers: string[] = [];
          const units = b.data.tables.units;
          for (let u = 0; units && u < units.count && carriers.length < 4; u++) {
            const g = units.columns.ground_weapon[u] === id, air = units.columns.air_weapon[u] === id;
            if ((g || air) && b.data.names.units[u]) carriers.push(`${b.data.names.units[u]}: ${g ? "ground" : "air"} weapon`);
          }
          if (carriers.length && fname !== "label") text = `${carriers.join(", ")} ${words(c.field)} ${valueText(field, part, c.before)} → ${valueText(field, part, c.after)}`;
        }
        out.push({ kind: "table", table: t, id, field: c.field, before: c.before, after: c.after, text });
      }
    }
  }

  // String tables, entry by entry.
  const stringFiles = new Set([...a.names, ...b.names].filter((n) => n.endsWith(".tbl")));
  for (const name of [...stringFiles].sort()) {
    const [x, y] = [await a.read(name), await b.read(name)];
    if (x && y && same(x, y)) continue;
    let sa: string[] = [], sb: string[] = [];
    try { sa = x ? decodeTblFile(x).strings : []; sb = y ? decodeTblFile(y).strings : []; } catch { out.push({ kind: "strings", text: `${name} changed (not read as a string table)`, files: [name] }); continue; }
    const leaf = name.replace(/^.*\\/, "");
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      if (sa[i] === sb[i]) continue;
      const show = (s: string | undefined) => (s === undefined ? "none" : JSON.stringify(s.replace(/\0+$/, "").replace(/\0/g, " | ")));
      out.push({ kind: "strings", text: `${leaf} ${i + 1}: ${show(sa[i])} → ${show(sb[i])}`, before: sa[i] ?? null, after: sb[i] ?? null, id: i + 1, files: [name] });
    }
  }

  // iscript, an animation at a time.
  const iscripts = new Set([...a.names, ...b.names].filter((n) => /^scripts\\(?!aiscript|bwscript).*\.bin$/.test(n)));
  if (!iscripts.size && (a.names.includes("scripts\\iscript.bin") || b.names.includes("scripts\\iscript.bin"))) iscripts.add("scripts\\iscript.bin");
  const imageNames = imageLabels(b.data);
  const images = b.data.tables.images;
  for (const name of [...iscripts].sort()) {
    const [x, y] = [await a.read(name), await b.read(name)];
    if (x && y && same(x, y)) continue;
    let ma: Map<number, string[]>, mb: Map<number, string[]>;
    try { ma = x ? iscriptAnimations(x) : new Map(); mb = y ? iscriptAnimations(y) : new Map(); } catch { out.push({ kind: "iscript", text: `${name} changed`, files: [name] }); continue; }
    const scriptName = (id: number) => {
      for (let i = 0; images && i < images.count; i++) if (images.columns.iscript_id[i] === id && imageNames.get(i)) return imageNames.get(i)!;
      return `iscript ${id}`;
    };
    for (const id of [...new Set([...ma.keys(), ...mb.keys()])].sort((p, q) => p - q)) {
      const pa = ma.get(id), pb = mb.get(id);
      if (!pa) { out.push({ kind: "iscript", id, text: `iscript ${id} added (${scriptName(id)})` }); continue; }
      if (!pb) { out.push({ kind: "iscript", id, text: `iscript ${id} removed` }); continue; }
      const changed: string[] = ISCRIPT_ANIMS.filter((_, i) => (pa[i] ?? "") !== (pb[i] ?? ""));
      if (changed.length) out.push({ kind: "iscript", id, text: `iscript: ${scriptName(id)}'s ${changed.join(", ")} animation${changed.length === 1 ? "" : "s"} changed` });
    }
  }

  // AI scripts.
  for (const name of ["scripts\\aiscript.bin", "scripts\\bwscript.bin"]) {
    if (!a.names.includes(name) && !b.names.includes(name)) continue;
    const [x, y] = [await a.read(name), await b.read(name)];
    if (x && y && same(x, y)) continue;
    out.push({ kind: "ai", text: `AI: ${name.replace(/^.*\\/, "")} ${!x ? "added" : !y ? "removed" : "changed"}`, files: [name] });
  }

  // Files, counted by kind.
  const counted = new Map<ModChangeKind, { changed: string[]; added: string[]; removed: string[]; one: string; many: string }>();
  const all = new Set([...a.names, ...b.names]);
  for (const name of [...all].sort()) {
    if (/\.(tbl)$/.test(name) || /^arr\\[^\\]+\.dat(?:ex)?$/.test(name) || /^scripts\\.*\.bin$/.test(name)) continue;
    const [x, y] = [await a.read(name), await b.read(name)];
    if (x && y && same(x, y)) continue;
    const [, kind, one, many] = KIND_OF_FILE.find(([re]) => re.test(gameName(name))) ?? [null, "files" as ModChangeKind, "other file", "other files"];
    const group = counted.get(kind) ?? { changed: [], added: [], removed: [], one, many };
    (x && y ? group.changed : y ? group.added : group.removed).push(name);
    counted.set(kind, group);
  }
  for (const [kind, g] of counted) {
    const parts = [g.changed.length ? `${plural(g.changed.length, g.one, g.many)} changed` : "", g.added.length ? `${g.changed.length ? g.added.length.toLocaleString("en") : plural(g.added.length, g.one, g.many)} added` : "", g.removed.length ? `${g.changed.length || g.added.length ? g.removed.length.toLocaleString("en") : plural(g.removed.length, g.one, g.many)} removed` : ""].filter(Boolean);
    out.push({ kind, text: parts.join(", "), files: [...g.changed, ...g.added, ...g.removed] });
  }
  return out;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
