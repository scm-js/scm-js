/**
 * A mod as a folder of text and pictures, and back (`scmjs mod unpack` / `mod pack`). Each file of the mod in the
 * game's paths (a *member*) has one place in the folder:
 *
 *   tables/units.txt …            the eleven `arr\*.dat` tables (or `.datex`) as PyDAT TXT
 *   strings/stat_txt.txt …        every `.tbl` as PyTBL text
 *   iscript/iscript.txt …         each `scripts\*.bin` iscript as PyICE text
 *   ai/aiscript.txt               `scripts\aiscript.bin` and `bwscript.bin` as one PyAI text
 *   overlays/<path>.txt           each `.lo?` as PyLO text (`overlays/unit/terran/marine.lob.txt`)
 *   graphics/<path>.png           each GRP as an indexed PNG sheet (`graphics/unit/terran/marine.png`)
 *   sounds/<path>                 each `.wav` as it is
 *   grafts/<name>.txt             `datreq\*.graft` as graftc's text
 *   maps/<path>                   the mod's maps (`maps\…\*.scx`)
 *   plugins/, Firegraft/          `.qdp`/`.bwl` and `.fgp`/`.fgd`, as they are
 *   files/<path>                  everything else, as it is
 *
 * and `mod.json` says what the folder alone cannot: the mod's name and the rest a person fills in, each table's
 * layout (the game's `.dat`, DatExtend's expanded `.dat` or GPTP's `.datex`), each string table's text encoding, a
 * member whose name the folder's path does not give (a string table outside `arr\` and `rez\`, a name's case), and
 * which members were **kept as bytes and why**.
 *
 * **The check is the packer.** `renderMember` writes a member's text or picture, packs it back with the same function
 * `packFile` uses, and keeps the text only when the bytes come back identical; otherwise the member goes under
 * `files/` as it is and the reason is recorded. So a folder fresh from an unpack packs back to the same members, byte
 * for byte, and an edit to a text changes the member it came from and nothing else.
 *
 * Pure: the command line does the reading and writing of files.
 */
import { DAT_SCHEMAS, datTableOf, type DatTableName } from "../dat/schema";
import { datFromText, datToText, decodeDat, encodeDat, type DatLayout } from "../dat/table";
import { decodeTblFile, encodeTblFile, tblFromText, tblToText } from "../dat/tblFile";
import { iscriptFromText, iscriptToText } from "../dat/iscriptText";
import { aiscriptFromText, aiscriptToText, type AiNames } from "../dat/aiscript";
import { decodeLoFile, encodeLoFile, loFromText, loToText } from "../dat/loFile";
import { decodeGrpImage, encodeGrpImage } from "../dat/grpFile";
import { grpToPng, pngToGrp, type NamedPalette, type QuantiseReport } from "../dat/grpPng";
import { buttonGraftFromText, buttonGraftToText, decodeButtonGraft, decodeReqGraft, encodeButtonGraft, encodeReqGraft, reqGraftFromText, reqGraftToText } from "../dat/graft";
import { decodePng, isPng } from "../png";
import type { TextEncoding } from "../text/encoding";
import { gameName } from "@scm-js/mod";
import { normalizeRaces, type DataSetRace } from "@scm-js/mod";

/** The manifest's file name, at the folder's root. */
export const MOD_MANIFEST = "mod.json";
/** The folder format's version, `scmjs` in the manifest. */
export const MOD_FORMAT = 1;
/** The palette a GRP's sheet is drawn with when the manifest names none. */
export const DEFAULT_PALETTE = "jungle";

export const MOD_FOLDERS = {
  tables: "tables", strings: "strings", iscript: "iscript", ai: "ai", overlays: "overlays", graphics: "graphics",
  sounds: "sounds", grafts: "grafts", maps: "maps", plugins: "plugins", firegraft: "Firegraft", files: "files",
} as const;

/** What form a member takes in the folder. */
export type MemberForm = "table" | "strings" | "iscript" | "ai" | "overlay" | "graphics" | "sound" | "graft" | "map" | "plugin" | "firegraft" | "file";

export interface ModTable {
  /** The member: `arr\units.dat`, `arr\units.datex`. */
  file: string;
  layout: DatLayout;
  /** Entries in the file, for a reader (the text says them all). */
  entries: number;
  /** units.dat from before Brood War (no Brood War columns). */
  legacy?: true;
}

/** A plugin or FireGraft file: kept as it is, never run. `member` when it was a file of the mod's archive. */
export interface ModCarried { name: string; bytes: number; file: string; member?: string }

/** `mod.json`. */
export interface ModManifest {
  /** The folder format's version (`MOD_FORMAT`). */
  scmjs: number;
  name: string;
  version: string;
  authors: string[];
  licence: string;
  /** The game the mod is for. */
  base: string;
  /** The sources the folder was made from, in load order (a later one's files over an earlier one's). */
  layers: string[];
  /** The palette the GRPs' sheets are drawn with: a tileset's name (`tileset\<name>.wpe`, the mod's own first). */
  palette: string;
  /** Where the names written beside the tables and in the AI text came from: the mod's string tables, the game's, or none. */
  names: "mod" | "game" | "none";
  /** Each table's member and layout, by table. */
  tables: Partial<Record<DatTableName, ModTable>>;
  /** Each string table's text encoding, by its file in the folder. */
  encodings: Record<string, TextEncoding>;
  /** Folder files whose member the path alone does not name (two for `ai/aiscript.txt`: aiscript, bwscript). */
  members: Record<string, string | string[]>;
  plugins: ModCarried[];
  firegraft: ModCarried[];
  /** The mod's maps, by member. */
  maps: string[];
  /** Members that have a text or picture form but were kept as bytes under `files/`, grouped by why. */
  kept: { why: string; files: string[] }[];
  /** Anything else a person should know about the folder (raw bytes in a text, …). */
  notes: string[];
  /**
   * The races the mod adds to the game's own (race bytes 8–255), when the person who made the folder declared them: no
   * file of a mod says what its races are called. Absent when none are declared. `mod.json` is no file of the mod, so
   * declaring a race leaves the mod's hash as it was.
   */
  races?: DataSetRace[];
}

export function emptyManifest(name = ""): ModManifest {
  return {
    scmjs: MOD_FORMAT, name, version: "0.1.0", authors: [], licence: "", base: "1.16.1", layers: [], palette: DEFAULT_PALETTE,
    names: "none", tables: {}, encodings: {}, members: {}, plugins: [], firegraft: [], maps: [], kept: [], notes: [],
  };
}

/** A manifest as read from `mod.json`, every field filled; null when it is not one of ours. */
export function readManifest(text: string): ModManifest | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!raw || typeof raw !== "object" || typeof (raw as { scmjs?: unknown }).scmjs !== "number") return null;
  const m = { ...emptyManifest(), ...(raw as Partial<ModManifest>) };
  // (A row that is no race is dropped, never thrown on: the rest of the folder reads as before.)
  if ("races" in m) {
    const races = normalizeRaces(m.races);
    if (races.length) m.races = races; else delete m.races;
  }
  if (m.scmjs > MOD_FORMAT) throw new ModFolderError(`${MOD_MANIFEST} is of folder format ${m.scmjs}, which a newer scmjs wrote`, MOD_MANIFEST, 0);
  return m;
}

/** A problem with a file of the folder, said with the file and, when there is one, the line. */
export class ModFolderError extends Error {
  readonly file: string;
  readonly line: number;
  constructor(message: string, file: string, line: number) {
    super(`${file}${line > 0 ? `:${line}` : ""}: ${message}`);
    this.file = file;
    this.line = line;
  }
}

/* ── Paths ─────────────────────────────────────────────────────────────── */

/** A member's path as a folder path: `\` is `/`, and a character a file system may refuse (and `%`) is `%XX`. */
export function folderPath(member: string): string {
  const hex = (c: string) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  const escape = (part: string) => [...part].map((c) => (c.charCodeAt(0) < 32 || /[<>:"|?*%]/.test(c) ? hex(c) : c)).join("");
  return member.replace(/\\/g, "/").replace(/^\/+/, "").split("/").map((part) => (part === "." || part === ".." ? part.replace(/\./g, "%2E") : escape(part))).join("/");
}

/** The member a folder path stands for (`folderPath` undone). */
export function memberPath(path: string): string {
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* a stray % is itself */ }
  return decoded.replace(/\//g, "\\");
}

const leafOf = (p: string) => p.replace(/^.*[\\/]/, "");
const stemOf = (p: string) => leafOf(p).replace(/\.[^.]*$/, "");

/** Where a string table usually lives, by its name: the game's own four under `arr\`, the rest under `rez\`. */
const ARR_TABLES = new Set(["images", "sfxdata", "portdata", "mapdata"]);
const isMap = (lower: string) => /^maps\\.+\.(scm|scx|chk)$/.test(lower);
const AUDIO = /\.(wav|ogg|mp3|flac)$/i;

/** The place a member takes in the folder by its name alone, before any check. */
export function placeOf(member: string): { form: MemberForm; file: string } {
  const lower = gameName(member);
  const path = folderPath(member);
  const F = MOD_FOLDERS;
  const table = /^arr\\[^\\]+\.dat(?:ex)?$/.test(lower) ? datTableOf(lower) : null;
  if (table) return { form: "table", file: `${F.tables}/${table}.txt` };
  if (lower.endsWith(".tbl")) return { form: "strings", file: `${F.strings}/${folderPath(stemOf(member))}.txt` };
  if (/^scripts\\(aiscript|bwscript)\.bin$/.test(lower)) return { form: "ai", file: `${F.ai}/aiscript.txt` };
  if (/^scripts\\.+\.bin$/.test(lower)) return { form: "iscript", file: `${F.iscript}/${folderPath(stemOf(member))}.txt` };
  if (/\.lo[a-z]$/.test(lower)) return { form: "overlay", file: `${F.overlays}/${path}.txt` };
  if (lower.endsWith(".grp")) return { form: "graphics", file: `${F.graphics}/${path.replace(/\.grp$/i, "")}.png` };
  if (lower.endsWith(".wav")) return { form: "sound", file: `${F.sounds}/${path}` };
  if (lower.endsWith(".graft")) return { form: "graft", file: `${F.grafts}/${folderPath(stemOf(member))}.txt` };
  if (isMap(lower)) return { form: "map", file: `${F.maps}/${path.replace(/^maps\//i, "")}` };
  if (/\.(qdp|bwl)$/.test(lower)) return { form: "plugin", file: `${F.plugins}/${folderPath(leafOf(member))}` };
  if (/\.(fgp|fgd)$/.test(lower)) return { form: "firegraft", file: `${F.firegraft}/${folderPath(leafOf(member))}` };
  return { form: "file", file: `${F.files}/${path}` };
}

/**
 * The member (or members) a folder file stands for, and its form; null for a file that is no member (the manifest,
 * a read-me, a plugin that sat beside the archive rather than in it, anything outside the known folders).
 */
export function memberOf(file: string, manifest: ModManifest): { form: MemberForm; members: string[] } | null {
  const parts = file.split("/");
  const top = parts[0], rest = parts.slice(1).join("/");
  const named = manifest.members[file];
  const given = named === undefined ? null : Array.isArray(named) ? named : [named];
  const F = MOD_FOLDERS;
  if (parts.length < 2) return null;
  const under = (form: MemberForm, fallback: string[]) => ({ form, members: given ?? fallback });
  switch (top) {
    case F.tables: {
      const t = rest.replace(/\.txt$/i, "") as DatTableName;
      if (!/\.txt$/i.test(rest) || !DAT_SCHEMAS[t]) return null;
      return under("table", [manifest.tables[t]?.file ?? `arr\\${t}.dat`]);
    }
    case F.strings: {
      if (!/\.txt$/i.test(rest)) return null;
      const stem = memberPath(rest.replace(/\.txt$/i, ""));
      return under("strings", [`${ARR_TABLES.has(stem.toLowerCase()) ? "arr" : "rez"}\\${stem}.tbl`]);
    }
    case F.iscript: return /\.txt$/i.test(rest) ? under("iscript", [`scripts\\${memberPath(rest.replace(/\.txt$/i, ""))}.bin`]) : null;
    case F.ai: return /^aiscript\.txt$/i.test(rest) ? under("ai", ["scripts\\aiscript.bin", "scripts\\bwscript.bin"]) : null;
    case F.overlays: return /\.lo[a-z]\.txt$/i.test(rest) ? under("overlay", [memberPath(rest.replace(/\.txt$/i, ""))]) : null;
    case F.graphics: return /\.png$/i.test(rest) ? under("graphics", [`${memberPath(rest.replace(/\.png$/i, ""))}.grp`]) : null;
    case F.sounds: return AUDIO.test(rest) ? under("sound", [memberPath(rest.replace(/\.(ogg|mp3|flac)$/i, ".wav"))]) : under("file", [memberPath(rest)]);
    case F.grafts: return /\.txt$/i.test(rest) ? under("graft", [`datreq\\${memberPath(rest.replace(/\.txt$/i, ""))}.graft`]) : null;
    case F.maps: return under("map", [`maps\\${memberPath(rest)}`]);
    case F.plugins: case F.firegraft: {
      const carried = [...manifest.plugins, ...manifest.firegraft].find((p) => p.file === file);
      return carried?.member ? { form: top === F.plugins ? "plugin" : "firegraft", members: [carried.member] } : null;
    }
    case F.files: return under("file", [memberPath(rest)]);
    default: return null;
  }
}

/* ── Names ─────────────────────────────────────────────────────────────── */

/** What the entries of the tables are called, for the text's comments and the AI script's arguments. */
export interface ModNames {
  units: string[];
  weapons: string[];
  upgrades: string[];
  technologies: string[];
  /** A GRP path an image (`unit\…`), for its comment. */
  images?: string[];
  /** A WAV path a sound row (`sound\…`), for its comment. */
  sounds?: string[];
}

/** The AI script's names: a name used twice, or one that reads as a number, is left out (written as its number). */
export function aiNames(names: ModNames | null | undefined): AiNames | undefined {
  if (!names) return undefined;
  const clean = (list: readonly string[]) => {
    const seen = new Set<string>();
    return list.map((n) => {
      const key = n.toLowerCase();
      if (!n || seen.has(key) || /^\s*(0x[0-9a-f]+|\d+)\s*$/i.test(n)) return "";
      seen.add(key);
      return n;
    });
  };
  return { units: clean(names.units), upgrades: clean(names.upgrades), technologies: clean(names.technologies) };
}

const TABLE_NAMES: Partial<Record<DatTableName, keyof ModNames>> = { units: "units", weapons: "weapons", upgrades: "upgrades", techdata: "technologies", images: "images", sfxdata: "sounds" };

/* ── The forms, both ways (one function each way, shared by the check and pack) ──────── */

const utf8 = new TextEncoder();
const fromUtf8 = (b: Uint8Array) => new TextDecoder().decode(b);
/** The text as it will be read back from its file (UTF-8 there and back). */
const asRead = (text: string) => fromUtf8(utf8.encode(text));

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function tableText(table: DatTableName, bytes: Uint8Array, member: string, names: ModNames | null | undefined): { text: string; info: ModTable } {
  const dat = decodeDat(table, bytes, { fileName: member });
  const list = TABLE_NAMES[table] ? names?.[TABLE_NAMES[table]!] : undefined;
  const text = datToText(dat, null, { name: list ? (id) => list[id] || undefined : undefined });
  return { text, info: { file: member, layout: dat.layout, entries: dat.count, ...(dat.legacy ? { legacy: true as const } : {}) } };
}

function tableBytes(table: DatTableName, text: string, info: ModTable | undefined): Uint8Array {
  const schema = DAT_SCHEMAS[table];
  const layout = info?.layout;
  // The width is the text's (every entry is written); the standard layout's is the game's count.
  const file = datFromText(table, text, layout === "dat" ? { layout: "dat", count: schema.entries } : layout ? { layout } : {});
  if (info?.legacy && file.layout === "dat") file.legacy = true;
  return encodeDat(file);
}

const stringsBytes = (text: string, encoding: TextEncoding) => encodeTblFile({ strings: tblFromText(text), encoding });

const isButtons = (member: string) => /^buttons\.graft$/i.test(leafOf(member));
const graftText = (member: string, bytes: Uint8Array) => (isButtons(member) ? buttonGraftToText(decodeButtonGraft(bytes)) : reqGraftToText(decodeReqGraft(bytes)));
const graftBytes = (member: string, text: string) => (isButtons(member) ? encodeButtonGraft(buttonGraftFromText(text)) : encodeReqGraft(reqGraftFromText(text)));

const loBytes = (text: string) => encodeLoFile(loFromText(text));

async function sheetPalette(png: Uint8Array, named: (name: string) => NamedPalette | null): Promise<NamedPalette> {
  const img = await decodePng(png);
  let note: { palette?: string } | null = null;
  try { note = img.text["scmjs:grp"] ? JSON.parse(img.text["scmjs:grp"]) : null; } catch { note = null; }
  const name = note?.palette ?? DEFAULT_PALETTE;
  // An untouched sheet (or one edited by a program that keeps its palette) holds the palette it was drawn with: its
  // indices are the GRP's, whatever the palette's name.
  if (img.indexed && img.indexed.palette.length >= 1024) {
    const rgb = new Uint8Array(768);
    for (let i = 0; i < 256; i++) rgb.set(img.indexed.palette.subarray(i * 4, i * 4 + 3), i * 3);
    return { name, colours: rgb };
  }
  const p = named(name);
  if (!p) throw new Error(`the picture is not in its palette's colours any more, and the palette "${name}" was not found (the mod's tileset\\${name}.wpe, or the game's)`);
  return p;
}

/* ── Unpack: a member to its place in the folder, checked ──────────────── */

export interface RenderContext {
  names?: ModNames | null;
  /** The palette GRPs are drawn with; none keeps every GRP as bytes. */
  palette?: NamedPalette | null;
}

export interface Rendered {
  form: MemberForm;
  /** The folder file. */
  file: string;
  data: Uint8Array;
  /** Set when a member with a text or picture form was kept as bytes: why. */
  kept?: string;
  /** A table's layout, for the manifest. */
  table?: ModTable;
  /** A string table's encoding, for the manifest. */
  encoding?: TextEncoding;
  /** Something the manifest's notes should say. */
  note?: string;
}

/** Why a codec refused a file, without the numbers that differ file to file (so the manifest groups alike failures). */
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").replace(/\b(frame|line|entry|offset|at|byte|bytes) \d+/g, "$1 N").slice(0, 200);

/**
 * One member in its folder form, checked by packing the form back: the text (or picture) when the bytes come back
 * the same, else the bytes under `files/` with why. AI scripts come in a pair: `renderAiScripts`.
 */
export async function renderMember(member: string, bytes: Uint8Array, ctx: RenderContext = {}): Promise<Rendered> {
  const place = placeOf(member);
  const asBytes = (why?: string): Rendered => ({ form: "file", file: `${MOD_FOLDERS.files}/${folderPath(member)}`, data: bytes, ...(why ? { kept: why } : {}) });
  const checked = (text: string, back: Uint8Array, extra: Partial<Rendered> = {}): Rendered =>
    same(back, bytes) ? { form: place.form, file: place.file, data: utf8.encode(text), ...extra } : asBytes("its text packs back to other bytes");
  try {
    switch (place.form) {
      case "table": {
        const table = datTableOf(member)!;
        const { text, info } = tableText(table, bytes, member, ctx.names);
        return checked(text, tableBytes(table, asRead(text), info), { table: info });
      }
      case "strings": {
        const tbl = decodeTblFile(bytes);
        const text = tblToText(tbl.strings);
        return checked(text, stringsBytes(asRead(text), tbl.encoding), { encoding: tbl.encoding });
      }
      case "iscript": {
        const text = iscriptToText(bytes);
        return checked(text, iscriptFromText(asRead(text)));
      }
      case "overlay": {
        const text = loToText(decodeLoFile(bytes));
        return checked(text, loBytes(asRead(text)));
      }
      case "graft": {
        const text = graftText(member, bytes);
        return checked(text, graftBytes(member, asRead(text)));
      }
      case "graphics": {
        const image = decodeGrpImage(bytes);
        // The cheap test first: a GRP another encoder wrote decodes to the same pictures but encodes to other bytes here.
        if (!same(encodeGrpImage(image), bytes)) return asBytes("another encoder wrote it: the pictures are the same, the bytes are not");
        if (!ctx.palette) return asBytes("no palette to draw it with");
        const text: Record<string, string> = {};
        if (/^[\x20-\xff]*$/.test(member)) text["scmjs:path"] = member;
        const png = await grpToPng(image, ctx.palette, { text });
        const back = await pngToGrp(png, await sheetPalette(png, () => ctx.palette ?? null));
        return same(back.grp, bytes) ? { form: "graphics", file: place.file, data: png } : asBytes("its picture packs back to other bytes");
      }
      case "ai": return asBytes("an AI script is read with its pair (aiscript.bin and bwscript.bin together)");
      default: return { form: place.form, file: place.file, data: bytes };
    }
  } catch (e) {
    return asBytes(`not read as ${place.form === "graphics" ? "a GRP" : place.form === "table" ? "the table" : place.form === "strings" ? "a string table" : place.form === "overlay" ? "an overlay file" : place.form === "graft" ? "a .graft" : place.form}: ${reason(e)}`);
  }
}

/** `scripts\aiscript.bin` and `bwscript.bin` as one PyAI text, checked; either may be absent from the mod. */
export function renderAiScripts(ai: { member: string; bytes: Uint8Array } | null, bw: { member: string; bytes: Uint8Array } | null, ctx: RenderContext = {}): Rendered[] {
  const keep = (m: { member: string; bytes: Uint8Array }, why: string): Rendered => ({ form: "file", file: `${MOD_FOLDERS.files}/${folderPath(m.member)}`, data: m.bytes, kept: why });
  if (!ai) return bw ? [keep(bw, "bwscript.bin is read with the aiscript.bin that names its scripts, which the mod does not have")] : [];
  try {
    const names = aiNames(ctx.names);
    const text = aiscriptToText(ai.bytes, bw?.bytes ?? null, { names });
    const back = aiscriptFromText(asRead(text), { names });
    const ok = same(back.aiscript, ai.bytes) && (bw ? !!back.bwscript && same(back.bwscript, bw.bytes) : back.bwscript === null);
    if (!ok) return [keep(ai, "its text packs back to other bytes"), ...(bw ? [keep(bw, "its text packs back to other bytes")] : [])];
    const raw = text.split("\n").filter((l) => /^\s*raw_bytes\(/.test(l)).length;
    return [{
      form: "ai", file: `${MOD_FOLDERS.ai}/aiscript.txt`, data: utf8.encode(text),
      ...(raw ? { note: `ai/aiscript.txt has ${raw} raw_bytes lines: bytes the text does not name as commands (padding, or opcodes of an AI plugin's own), kept as they are` } : {}),
    }];
  } catch (e) {
    const why = `not read as an AI script: ${reason(e)}`;
    return [keep(ai, why), ...(bw ? [keep(bw, why)] : [])];
  }
}

/* ── Pack: a folder file back to its member ────────────────────────────── */

export interface PackContext {
  manifest: ModManifest;
  names?: ModNames | null;
  /** A palette by name, for a sheet that is no longer in its own palette's colours. */
  palette?: (name: string) => NamedPalette | null;
  /** A sound that is not a WAV (`sounds/…/x.ogg`) as a WAV. */
  convertSound?: (bytes: Uint8Array, file: string) => Promise<Uint8Array>;
  /** What quantising a picture lost, by file. */
  quantised?: (file: string, report: QuantiseReport) => void;
}

/** A line number out of a codec's message (`line 12: …`). */
const lineOf = (e: unknown) => { const m = /^line (\d+): /.exec(e instanceof Error ? e.message : ""); return m ? Number(m[1]) : (e as { line?: number })?.line ?? 0; };
const withoutLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^line \d+: /, "");

/** The members a folder file stands for, with their bytes; none for a file that is no member. */
export async function packFile(file: string, data: Uint8Array, ctx: PackContext): Promise<{ member: string; data: Uint8Array }[]> {
  const of = memberOf(file, ctx.manifest);
  if (!of) return [];
  const [member] = of.members;
  try {
    switch (of.form) {
      case "table": {
        const table = datTableOf(member) ?? (file.replace(/^.*\//, "").replace(/\.txt$/i, "") as DatTableName);
        const info = ctx.manifest.tables[table];
        return [{ member, data: tableBytes(table, fromUtf8(data), info?.file && gameName(info.file) === gameName(member) ? info : { file: member, layout: /\.datex$/i.test(member) ? "datex" : "dat", entries: DAT_SCHEMAS[table].entries }) }];
      }
      case "strings": return [{ member, data: stringsBytes(fromUtf8(data), ctx.manifest.encodings[file] ?? "windows-1252") }];
      case "iscript": return [{ member, data: iscriptFromText(fromUtf8(data)) }];
      case "ai": {
        const out = aiscriptFromText(fromUtf8(data), { names: aiNames(ctx.names) });
        return [{ member, data: out.aiscript }, ...(out.bwscript ? [{ member: of.members[1] ?? "scripts\\bwscript.bin", data: out.bwscript }] : [])];
      }
      case "overlay": return [{ member, data: loBytes(fromUtf8(data)) }];
      case "graft": return [{ member, data: graftBytes(member, fromUtf8(data)) }];
      case "graphics": {
        if (!isPng(data)) throw new Error("not a PNG");
        const palette = await sheetPalette(data, ctx.palette ?? (() => null));
        const { grp, report } = await pngToGrp(data, palette);
        if (report.pixelsChanged || report.pixelsAlphaRounded) ctx.quantised?.(file, report);
        return [{ member, data: grp }];
      }
      case "sound": {
        if (/\.wav$/i.test(file)) return [{ member, data }];
        if (!ctx.convertSound) throw new Error("a sound that is not a WAV needs converting, and nothing here converts it");
        return [{ member, data: await ctx.convertSound(data, file) }];
      }
      default: return [{ member, data }];
    }
  } catch (e) {
    if (e instanceof ModFolderError) throw e;
    throw new ModFolderError(withoutLine(e), file, lineOf(e));
  }
}

/* ── The manifest from what an unpack rendered ─────────────────────────── */

/**
 * Records a rendered member in the manifest: its table layout, encoding, a name the path does not give, why it was
 * kept as bytes, a note. `layer` is the member's own name as the source spelled it.
 */
export function recordRendered(manifest: ModManifest, members: readonly string[], r: Rendered): void {
  if (r.table) manifest.tables[datTableOf(r.table.file)!] = r.table;
  if (r.encoding) manifest.encodings[r.file] = r.encoding;
  if (r.note) manifest.notes.push(r.note);
  if (r.kept) {
    const group = manifest.kept.find((k) => k.why === r.kept);
    if (group) group.files.push(r.file); else manifest.kept.push({ why: r.kept, files: [r.file] });
  }
  if (r.form === "map") manifest.maps.push(members[0]);
  // A member whose name the path alone would not give back, exactly, is named.
  if (r.form === "ai") {
    const [ai, bw] = members;
    if (ai !== "scripts\\aiscript.bin" || (bw !== undefined && bw !== "scripts\\bwscript.bin")) manifest.members[r.file] = bw === undefined ? [ai] : [ai, bw];
  } else if (r.form !== "plugin" && r.form !== "firegraft") {
    const back = memberOf(r.file, { ...manifest, members: {} });
    if (!back || back.members[0] !== members[0]) manifest.members[r.file] = members[0];
  }
}

/** Sorts a manifest's lists, so the same folder always writes the same `mod.json`. */
export function tidyManifest(m: ModManifest): ModManifest {
  const byName = <T>(list: T[], key: (t: T) => string) => list.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const sortObject = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  byName(m.kept, (k) => k.why).forEach((k) => byName(k.files, (f) => f));
  byName(m.plugins, (p) => p.file);
  byName(m.firegraft, (p) => p.file);
  byName(m.maps, (x) => x);
  m.members = sortObject(m.members);
  m.encodings = sortObject(m.encodings);
  m.tables = Object.fromEntries(Object.entries(m.tables).sort(([a], [b]) => (a < b ? -1 : 1))) as ModManifest["tables"];
  m.notes = [...new Set(m.notes)].sort();
  // (Absent when there are none, so a folder that declares none writes the file it always did.)
  if ("races" in m) {
    const races = normalizeRaces(m.races);
    if (races.length) m.races = races; else delete m.races;
  }
  return m;
}
