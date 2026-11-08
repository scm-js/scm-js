/**
 * `scmjs map unpack --text` and the `pack` of what it writes: the scenario as a folder of text files, so a map can
 * live in git as text — a moved unit is a changed line, two people's edits merge line by line, and a review reads the
 * real change — and be packed back into the same map.
 *
 * The scenario (`staredit\scenario.chk`) is a list of sections. Each section the editor models is written in a text
 * form (`map.json` for the header and players, `terrain.txt`, `units.tsv`, `strings.txt`, `triggers.txt`, …) and
 * every other one — and any section a text form cannot hold exactly — is kept byte for byte under `sections/`.
 * `sections.json` lists them all in the file's order, which is the order pack writes them in.
 *
 * Packing reads the text back into the editor's own model and encodes each section with the editor's own encoder
 * (`encodeSection`), so what an edited text means is what the same edit in the editor would save. Unpacking checks
 * that before it writes anything: it runs the packer over the files it is about to write and compares the result with
 * the map, section by section. A section whose text encodes to its own bytes is text alone. One whose text encodes to
 * what the editor's model of it encodes to, but not to the file's bytes (the string table's layout in a map StarEdit
 * wrote, a hybrid map's pair of tables that disagree) is text plus its bytes as they were, used for as long as the
 * text still encodes to what it did (`sha1`); changed, the text is encoded as the editor would save it. A section
 * whose text would lose anything is kept as bytes. So an untouched folder packs back into the scenario it came from,
 * byte for byte.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { encodeSection, MODELLED_SECTIONS, parseScenario, type Scenario } from "../../src/formats/chk/scenario";
import { parseChk, serializeChk, type ChkSection } from "../../src/formats/chk/reader";
import { PlayerRace, PlayerType, ColorMode, ForceFlag, PLAYER_SLOTS, FORCE_SLOTS } from "../../src/formats/chk/sections/players";
import { locationSlots, type DoodadRecord, type LocationRecord, type SpriteRecord, type UnitRecord } from "../../src/formats/chk/sections/objects";
import {
  defaultTechRestrictions, defaultTechSettings, defaultUnitAvailability, defaultUnitSettings, defaultUpgradeRestrictions, defaultUpgradeSettings,
} from "../../src/formats/chk/sections/settings";
import type { CuwpSlot } from "../../src/formats/chk/sections/cuwp";
import { TEXT_ENCODINGS, type TextEncoding } from "../../src/formats/text/encoding";
import { decodeTrg, formatStringTable, parseStringTable, triggersFromText, triggersToText } from "../../src/editor/exchange";
import { triggerNames } from "../../src/editor/triggers";
import { formatTrigger, TriggerTextError } from "../../src/formats/triggers/text";
import type { TriggerRecord } from "../../src/formats/chk/sections/triggers";
import { plainText } from "../../src/editor/textColors";
import { TILESETS } from "../../src/data/tilesets";
import { PLAYER_COLORS } from "../../src/data/players";
import { techName, unitName, upgradeName } from "../../src/data/units";
import { weaponName } from "../../src/data/weapons";
import { t } from "./i18n";
import { CliError } from "./ui";

/** The folder under an unpacked map that holds its scenario as text. */
export const TEXT_FOLDER = "scenario";
/** The list of the scenario's sections, in the file's order. */
export const SECTIONS_FILE = "sections.json";
/** Where sections kept as bytes go, under the text folder. */
const BYTES_DIR = "sections";
/** The text form's revision, in `sections.json`: a later scmjs that changes a form incompatibly bumps it. */
export const TEXT_FORMAT = 1;

/** One section of the scenario, in `sections.json`. */
export interface SectionEntry {
  /** The section's four-character name, as the file has it (`"VER "`). */
  name: string;
  /** The text file that holds it, under the text folder. */
  text?: string;
  /**
   * Its bytes as they were: the section itself when there is no `text`; with `sha1`, its layout; with neither, its
   * records (the triggers), each kept while its text is unchanged.
   */
  bytes?: string;
  /** With `text` and `bytes`: the SHA-1 of what the text encodes to. While it still does, the kept bytes are written. */
  sha1?: string;
  /** The length the section's header declares, when that is not its bytes' (a section that ran past the file's end). */
  size?: number;
}

export interface SectionsList {
  format: number;
  sections: SectionEntry[];
  /** Bytes after the last section, when the file has any. */
  trailing?: string;
}

/** How the scenario came out as text. */
export interface TextReport {
  /** Sections written as text alone. */
  text: string[];
  /** Sections written as text with their bytes kept as a layout (equal in the editor's model, not byte for byte). */
  layout: string[];
  /** Sections written as text with their records kept: a trigger whose text is unchanged packs as the record it was. */
  records: string[];
  /** Sections kept as bytes, and why. */
  bytes: { name: string; why: string }[];
}

/* ── Reading and writing cells ──────────────────────────── */

type Kind = "u8" | "u16" | "u32" | "i32";
const LIMITS: Record<Kind, [number, number]> = { u8: [0, 0xff], u16: [0, 0xffff], u32: [0, 0xffffffff], i32: [-0x80000000, 0x7fffffff] };
const HEX_DIGITS: Record<Kind, number> = { u8: 2, u16: 4, u32: 8, i32: 8 };

/** A text file that does not read: the file, the line and what is wrong. `form` says which file it was. */
export class TextFormError extends CliError {
  readonly form: string;
  constructor(form: string, line: number | null, message: string) {
    super(line ? t("{file}, line {line}: {message}", { file: `${TEXT_FOLDER}/${form}`, line, message }) : `${TEXT_FOLDER}/${form}: ${message}`, t("Each file's form is in docs.scmjs.dev/cli, \"A map as a folder of text\"."));
    this.form = form;
  }
}

const hex = (n: number, digits: number) => n.toString(16).padStart(digits, "0");

function cell(value: number, kind: Kind, asHex = false): string {
  return asHex ? `0x${hex(value >>> 0, HEX_DIGITS[kind])}` : String(value);
}

function number(text: string, kind: Kind, fail: (message: string) => never): number {
  const s = text.trim();
  if (!/^(-?\d+|0x[0-9a-f]+)$/i.test(s)) fail(t("\"{text}\" is not a number", { text }));
  const n = /^0x/i.test(s) ? parseInt(s.slice(2), 16) : Number(s);
  const [lo, hi] = LIMITS[kind];
  if (!Number.isSafeInteger(n) || n < lo || n > hi) fail(t("{value} is out of range ({lo} to {hi})", { value: s, lo, hi }));
  return n;
}

/** Lines that are neither blank nor a `#` comment, with their 1-based numbers. */
function contentLines(body: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  body.replace(/^\uFEFF/, "").split(/\r?\n/).forEach((text, i) => { if (text.trim() !== "" && !text.startsWith("#")) out.push({ line: i + 1, text }); });
  return out;
}

/** Text for an informational cell: one line, no tabs, no colour codes. */
const label = (text: string | null | undefined) => plainText(text ?? "").replace(/[\t\r\n]+/g, " ").trim();

/* ── Tables (.tsv) ──────────────────────────────────────── */

interface Column { name: string; kind: Kind; hex?: boolean }

interface TableRow { line: number; get(name: string): string }

/**
 * A tab-separated table: a header naming the columns, a row per line. `name` as the last header is informational
 * (a unit's or location's name, for reading) and may be left empty; it is never read back.
 */
function formatTable(columns: readonly string[], rows: readonly string[][]): string {
  return [columns.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n") + "\n";
}

function readTable(form: string, body: string, columns: readonly string[]): TableRow[] {
  const lines = contentLines(body);
  if (!lines.length) throw new TextFormError(form, null, t("the header line is missing; it is: {columns}", { columns: columns.join(" ") }));
  const header = lines[0].text.split("\t").map((c) => c.trim());
  const named = header[header.length - 1] === "name";
  const expected = named ? header.slice(0, -1) : header;
  if (expected.join("\t") !== columns.join("\t")) throw new TextFormError(form, lines[0].line, t("the columns are {columns}, not {header}", { columns: `${columns.join(" ")}${named ? " name" : ""}`, header: header.join(" ") }));
  return lines.slice(1).map(({ line, text }) => {
    const cells = text.split("\t");
    if (cells.length !== header.length && !(named && cells.length === header.length - 1)) {
      throw new TextFormError(form, line, t("{n} columns, the header has {header}", { n: cells.length, header: header.length }));
    }
    return { line, get: (name: string) => cells[columns.indexOf(name)] ?? "" };
  });
}

/** A record's fields as columns, in the order the file stores them. */
function recordCells<R>(r: R, columns: readonly Column[]): string[] {
  return columns.map((c) => cell((r as Record<string, number>)[c.name], c.kind, c.hex));
}

function recordFrom<R>(form: string, row: TableRow, columns: readonly Column[]): R {
  const out: Record<string, number> = {};
  for (const c of columns) out[c.name] = number(row.get(c.name), c.kind, (m) => { throw new TextFormError(form, row.line, `${c.name}: ${m}`); });
  return out as R;
}

const UNIT_COLUMNS: Column[] = [
  { name: "serial", kind: "u32" }, { name: "x", kind: "u16" }, { name: "y", kind: "u16" }, { name: "unitId", kind: "u16" },
  { name: "relationType", kind: "u16", hex: true }, { name: "validProperties", kind: "u16", hex: true }, { name: "validStates", kind: "u16", hex: true },
  { name: "owner", kind: "u8" }, { name: "hitPointsPercent", kind: "u8" }, { name: "shieldPercent", kind: "u8" }, { name: "energyPercent", kind: "u8" },
  { name: "resourceAmount", kind: "u32" }, { name: "hangarUnits", kind: "u16" }, { name: "stateFlags", kind: "u16", hex: true },
  { name: "unused", kind: "u32" }, { name: "relatedSerial", kind: "u32" },
];
const SPRITE_COLUMNS: Column[] = [
  { name: "spriteId", kind: "u16" }, { name: "x", kind: "u16" }, { name: "y", kind: "u16" }, { name: "owner", kind: "u8" },
  { name: "unused", kind: "u8" }, { name: "flags", kind: "u16", hex: true },
];
const DOODAD_COLUMNS: Column[] = [
  { name: "doodadId", kind: "u16" }, { name: "x", kind: "u16" }, { name: "y", kind: "u16" }, { name: "owner", kind: "u8" }, { name: "disabled", kind: "u8" },
];
const LOCATION_COLUMNS: Column[] = [
  { name: "left", kind: "i32" }, { name: "top", kind: "i32" }, { name: "right", kind: "i32" }, { name: "bottom", kind: "i32" },
  { name: "nameIndex", kind: "u16" }, { name: "elevationFlags", kind: "u16", hex: true },
];
const CUWP_COLUMNS: Column[] = [
  { name: "validProperties", kind: "u16", hex: true }, { name: "validFields", kind: "u16", hex: true }, { name: "owner", kind: "u8" },
  { name: "hitPointsPercent", kind: "u8" }, { name: "shieldsPercent", kind: "u8" }, { name: "energyPercent", kind: "u8" },
  { name: "resources", kind: "u32" }, { name: "hangar", kind: "u16" }, { name: "stateFlags", kind: "u16", hex: true }, { name: "unused", kind: "u32" },
];

/* ── Grids ──────────────────────────────────────────────── */

/** A grid of hex numbers, a row per line — so a changed cell is a changed line. */
function formatGrid(comment: string, values: ArrayLike<number>, width: number, digits: number): string {
  const lines = [`# ${comment}`];
  for (let at = 0; at < values.length; at += width) {
    const row: string[] = [];
    for (let i = at; i < at + width && i < values.length; i++) row.push(hex(values[i], digits));
    lines.push(row.join(" "));
  }
  return lines.join("\n") + "\n";
}

function readGrid(form: string, body: string, width: number, height: number, kind: Kind): number[] {
  const lines = contentLines(body);
  if (lines.length !== height) throw new TextFormError(form, null, t("{n} rows, the map's size needs {height}", { n: lines.length, height }));
  const out: number[] = [];
  for (const { line, text } of lines) {
    const cells = text.trim().split(/\s+/);
    if (cells.length !== width) throw new TextFormError(form, line, t("{n} cells, the map's size needs {width}", { n: cells.length, width }));
    for (const c of cells) out.push(number(`0x${c}`, kind, (m) => { throw new TextFormError(form, line, m); }));
  }
  return out;
}

/* ── Struct-of-arrays settings tables ───────────────────── */

type Table = Record<string, Uint8Array | Uint16Array | Uint32Array>;

interface SettingsSpec {
  file: string;
  sections: readonly string[];
  columns: { name: string; kind: Kind; perPlayer?: boolean }[];
  label: (id: number) => string;
  get(scn: Scenario): Table | null;
  /** The table, made on its defaults when the scenario has none yet. */
  ensure(scn: Scenario): Table;
}

function settingsForm(spec: SettingsSpec): Form {
  const header = ["id", ...spec.columns.map((c) => c.name)];
  const countOf = (t: Table) => t[spec.columns.find((c) => !c.perPlayer)!.name].length;
  return {
    file: spec.file,
    sections: spec.sections,
    write(scn) {
      const t = spec.get(scn)!;
      const count = countOf(t);
      const rows: string[][] = [];
      for (let id = 0; id < count; id++) {
        rows.push([String(id), ...spec.columns.map((c) => c.perPlayer
          ? Array.from({ length: PLAYER_SLOTS }, (_, p) => String(t[c.name][p * count + id])).join(",")
          : String(t[c.name][id])), label(spec.label(id))]);
      }
      return formatTable([...header, "name"], rows);
    },
    read(scn, body) {
      const table = spec.ensure(scn);
      const count = countOf(table);
      const seen = new Set<number>();
      for (const row of readTable(spec.file, body, header)) {
        const fail = (m: string): never => { throw new TextFormError(spec.file, row.line, m); };
        const id = number(row.get("id"), "u16", fail);
        if (id >= count) fail(t("id {id} is past the table's {count} entries", { id, count }));
        if (seen.has(id)) fail(t("id {id} is listed twice", { id }));
        seen.add(id);
        for (const c of spec.columns) {
          if (c.perPlayer) {
            const values = row.get(c.name).split(",");
            if (values.length !== PLAYER_SLOTS) fail(t("{column}: {slots} values separated by commas, one per player, not {n}", { column: c.name, slots: PLAYER_SLOTS, n: values.length }));
            values.forEach((v, p) => { table[c.name][p * count + id] = number(v, c.kind, (m) => fail(`${c.name}: ${m}`)); });
          } else {
            table[c.name][id] = number(row.get(c.name), c.kind, (m) => fail(`${c.name}: ${m}`));
          }
        }
      }
      if (seen.size !== count) throw new TextFormError(spec.file, null, t("{missing} of the {count} ids are missing; every one has a row", { missing: count - seen.size, count }));
    },
  };
}

/* ── The forms ──────────────────────────────────────────── */

/** A text file and the sections it holds. `text` is the set of sections in text form; a form writes only theirs. */
interface Form {
  file: string;
  sections: readonly string[];
  write(scn: Scenario, text: ReadonlySet<string>): string;
  /** `kept` has the records-kept sections' bytes as they were, by section name. */
  read(scn: Scenario, body: string, text: ReadonlySet<string>, kept: ReadonlyMap<string, Uint8Array>): void;
  /** Whether the form can keep a section's records (`SectionEntry.bytes` without `sha1`). */
  keepsRecords?: boolean;
}

const keyOf = (table: Record<string, number>, value: number): string | number => Object.keys(table).find((k) => table[k] === value) ?? value;
const squash = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");
const COLOR_NAMES: Record<string, number> = Object.fromEntries(PLAYER_COLORS.map((c) => [c.name, c.id]));

/** A value from `map.json`: a name from `table`, or a number. */
function valueOf(form: string, what: string, v: unknown, table: Record<string, number>, kind: Kind = "u8"): number {
  if (typeof v === "number") return number(String(v), kind, (m) => { throw new TextFormError(form, null, `${what}: ${m}`); });
  if (typeof v === "string") {
    const key = Object.keys(table).find((k) => squash(k) === squash(v));
    if (key !== undefined) return table[key];
    throw new TextFormError(form, null, t("{what}: \"{value}\" is not one of {list} (or a number)", { what, value: String(v), list: Object.keys(table).join(", ") }));
  }
  throw new TextFormError(form, null, t("{what} is missing", { what }));
}

function intOf(form: string, what: string, v: unknown, kind: Kind): number {
  if (typeof v !== "number") throw new TextFormError(form, null, v === undefined ? t("{what} is missing", { what }) : t("{what}: a number, not {value}", { what, value: JSON.stringify(v) }));
  return number(String(v), kind, (m) => { throw new TextFormError(form, null, `${what}: ${m}`); });
}

/** JSON with one value per line where it helps a diff: objects open, lists of plain values and list items on one line. */
export function stableJson(value: unknown, indent = ""): string {
  const inline = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
    if (v && typeof v === "object") {
      const entries = Object.entries(v).filter(([, x]) => x !== undefined);
      return entries.length ? `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }` : "{}";
    }
    return JSON.stringify(v);
  };
  if (Array.isArray(value)) {
    if (!value.length || value.every((v) => v === null || typeof v !== "object")) return inline(value);
    return `[\n${value.map((v) => `${indent}  ${inline(v)}`).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, x]) => x !== undefined);
    if (!entries.length) return "{}";
    return `{\n${entries.map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${stableJson(v, `${indent}  `)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

const trimZeros = (values: readonly number[]) => { let n = values.length; while (n > 0 && !values[n - 1]) n--; return values.slice(0, n); };

const MAP_SECTIONS = ["TYPE", "VER ", "DIM ", "ERA ", "SPRP", "STR ", "STRx", "OWNR", "IOWN", "SIDE", "COLR", "CRGB", "FORC", "WAV ", "SWNM"] as const;

const mapForm: Form = {
  file: "map.json",
  sections: MAP_SECTIONS,
  write(scn, text) {
    const has = (n: string) => text.has(n);
    const out: Record<string, unknown> = {};
    if (has("TYPE")) out.type = scn.type;
    if (has("VER ")) out.version = scn.fileVersion;
    if (has("DIM ")) { out.width = scn.width; out.height = scn.height; }
    if (has("ERA ")) { if (scn.era < TILESETS.length) out.tileset = TILESETS[scn.era].id; else out.era = scn.era; }
    if (has("SPRP")) { out.nameString = scn.nameIndex; out.descriptionString = scn.descriptionIndex; }
    if (has("STR ") || has("STRx")) out.strings = { slots: scn.strings.strings.length - 1, encoding: scn.strings.encoding };
    const players = ["OWNR", "IOWN", "SIDE", "COLR", "CRGB", "FORC"].some(has);
    if (players) {
      out.players = Array.from({ length: PLAYER_SLOTS }, (_, i) => {
        const p: Record<string, unknown> = { slot: i + 1 };
        if (has("OWNR")) p.type = keyOf(PlayerType, scn.playerTypes[i]);
        if (has("IOWN") && scn.editorPlayerTypes) p.editorType = keyOf(PlayerType, scn.editorPlayerTypes[i]);
        if (has("SIDE")) p.race = keyOf(PlayerRace, scn.playerRaces[i]);
        if (i < FORCE_SLOTS) {
          if (has("COLR")) p.color = keyOf(COLOR_NAMES, scn.playerColors[i]);
          if (has("CRGB") && scn.playerRgb) { p.colorMode = keyOf(ColorMode, scn.playerRgb.mode[i]); p.rgb = scn.playerRgb.rgb[i]; }
          if (has("FORC")) p.force = scn.forces.playerForce[i] + 1;
        }
        return p;
      });
    }
    if (has("FORC")) {
      out.forces = [0, 1, 2, 3].map((f) => {
        const flags = scn.forces.flags[f];
        const named = Object.entries(ForceFlag).filter(([, bit]) => flags & bit).map(([k]) => k);
        const rest = flags & ~Object.values(ForceFlag).reduce((a, b) => a | b, 0);
        return { force: f + 1, nameString: scn.forces.nameIndex[f], flags: rest ? [...named, rest] : named };
      });
    }
    if (has("WAV ") && scn.wavs) out.sounds = trimZeros(scn.wavs);
    if (has("SWNM") && scn.switchNames) out.switches = trimZeros(scn.switchNames);
    return stableJson(out) + "\n";
  },
  read(scn, body, text) {
    const form = "map.json";
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(body.replace(/^\uFEFF/, "")) as Record<string, unknown>;
    } catch (e) {
      throw new TextFormError(form, null, t("not JSON: {message}", { message: String(e instanceof Error ? e.message : e) }));
    }
    if (!m || typeof m !== "object" || Array.isArray(m)) throw new TextFormError(form, null, t("not a JSON object"));
    const has = (n: string) => text.has(n);
    if (has("TYPE")) {
      if (typeof m.type !== "string" || m.type.length > 4) throw new TextFormError(form, null, t("type: up to four characters, RAWB for Brood War or RAWS"));
      scn.type = m.type;
    }
    if (has("VER ")) scn.fileVersion = intOf(form, "version", m.version, "u16");
    if (has("DIM ")) { scn.width = intOf(form, "width", m.width, "u16"); scn.height = intOf(form, "height", m.height, "u16"); }
    if (has("ERA ")) {
      if (m.tileset !== undefined) {
        const i = TILESETS.findIndex((t) => typeof m.tileset === "string" && (squash(t.id) === squash(m.tileset) || squash(t.name) === squash(m.tileset)));
        if (i < 0) throw new TextFormError(form, null, t("tileset: \"{tileset}\" is not one of {list}", { tileset: String(m.tileset), list: TILESETS.map((ts) => ts.id).join(", ") }));
        scn.era = i;
      } else scn.era = intOf(form, "era", m.era, "u16");
    }
    if (has("SPRP")) { scn.nameIndex = intOf(form, "nameString", m.nameString, "u16"); scn.descriptionIndex = intOf(form, "descriptionString", m.descriptionString, "u16"); }
    if (has("STR ") || has("STRx")) {
      const s = m.strings as { slots?: unknown; encoding?: unknown } | undefined;
      const slots = intOf(form, "strings.slots", s?.slots, has("STRx") ? "u32" : "u16");
      const encoding = TEXT_ENCODINGS.find((e) => e.id === s?.encoding)?.id;
      if (!encoding) throw new TextFormError(form, null, t("strings.encoding: one of {list}", { list: TEXT_ENCODINGS.map((e) => e.id).join(", ") }));
      scn.strings = { strings: Array.from({ length: slots + 1 }, () => null), extended: has("STRx"), encoding: encoding as TextEncoding };
    }
    if (["OWNR", "IOWN", "SIDE", "COLR", "CRGB", "FORC"].some(has)) {
      if (!Array.isArray(m.players)) throw new TextFormError(form, null, t("players: a list with an entry per slot"));
      const bySlot = new Map<number, Record<string, unknown>>();
      for (const p of m.players as Record<string, unknown>[]) bySlot.set(intOf(form, "players: slot", p?.slot, "u8"), p);
      const player = (i: number) => {
        const p = bySlot.get(i + 1);
        if (!p) throw new TextFormError(form, null, t("players: slot {slot} is missing", { slot: i + 1 }));
        return p;
      };
      if (has("OWNR")) scn.playerTypes = Array.from({ length: PLAYER_SLOTS }, (_, i) => valueOf(form, `player ${i + 1} type`, player(i).type, PlayerType));
      if (has("IOWN")) scn.editorPlayerTypes = Array.from({ length: PLAYER_SLOTS }, (_, i) => valueOf(form, `player ${i + 1} editorType`, player(i).editorType, PlayerType));
      if (has("SIDE")) scn.playerRaces = Array.from({ length: PLAYER_SLOTS }, (_, i) => valueOf(form, `player ${i + 1} race`, player(i).race, PlayerRace));
      if (has("COLR")) scn.playerColors = Array.from({ length: FORCE_SLOTS }, (_, i) => valueOf(form, `player ${i + 1} color`, player(i).color, COLOR_NAMES));
      if (has("CRGB")) {
        scn.playerRgb = {
          mode: Array.from({ length: FORCE_SLOTS }, (_, i) => valueOf(form, `player ${i + 1} colorMode`, player(i).colorMode, ColorMode)),
          rgb: Array.from({ length: FORCE_SLOTS }, (_, i) => {
            const rgb = player(i).rgb;
            if (!Array.isArray(rgb) || rgb.length !== 3) throw new TextFormError(form, null, t("player {slot} rgb: three numbers, [red, green, blue]", { slot: i + 1 }));
            return rgb.map((v) => intOf(form, `player ${i + 1} rgb`, v, "u8")) as [number, number, number];
          }),
        };
      }
      if (has("FORC")) {
        const playerForce = Array.from({ length: FORCE_SLOTS }, (_, i) => {
          const f = player(i).force;
          if (typeof f !== "number" || !Number.isInteger(f) || f < 1 || f > 256) throw new TextFormError(form, null, t("player {slot} force: a number from 1", { slot: i + 1 }));
          return f - 1;
        });
        if (!Array.isArray(m.forces)) throw new TextFormError(form, null, t("forces: a list of the four forces"));
        const forces = new Map<number, Record<string, unknown>>();
        for (const f of m.forces as Record<string, unknown>[]) forces.set(intOf(form, "forces: force", f?.force, "u8"), f);
        const nameIndex: number[] = [], flags: number[] = [];
        for (let f = 0; f < 4; f++) {
          const force = forces.get(f + 1);
          if (!force) throw new TextFormError(form, null, t("forces: force {force} is missing", { force: f + 1 }));
          nameIndex.push(intOf(form, `force ${f + 1} nameString`, force.nameString, "u16"));
          if (!Array.isArray(force.flags)) throw new TextFormError(form, null, t("force {force} flags: a list of {list}", { force: f + 1, list: Object.keys(ForceFlag).join(", ") }));
          flags.push((force.flags as unknown[]).reduce<number>((a, v) => a | valueOf(form, `force ${f + 1} flags`, v, ForceFlag), 0));
        }
        scn.forces = { playerForce, nameIndex, flags };
      }
    }
    const list = (key: string, length: number) => {
      const v = m[key];
      if (!Array.isArray(v)) throw new TextFormError(form, null, t("{key}: a list of string numbers", { key }));
      if (v.length > length) throw new TextFormError(form, null, t("{key}: at most {length} entries", { key, length }));
      return Array.from({ length }, (_, i) => (i < v.length ? intOf(form, key, v[i], "u32") : 0));
    };
    if (has("WAV ")) scn.wavs = list("sounds", 512);
    if (has("SWNM")) scn.switchNames = list("switches", 256);
  },
};

const stringsForm: Form = {
  file: "strings.txt",
  sections: ["STR ", "STRx"],
  write: (scn) => formatStringTable(scn.strings),
  read(scn, body) {
    const parsed = parseStringTable(body);
    if (parsed.errors.length) throw new TextFormError("strings.txt", parsed.errors[0].line, parsed.errors[0].message);
    const table = scn.strings.strings;
    for (const { index, text } of parsed.entries) {
      while (table.length <= index) table.push(null);
      table[index] = text;
    }
  },
};

const gridForm = (file: string, section: string, comment: string, kind: Kind,
  get: (scn: Scenario) => ArrayLike<number> | null, set: (scn: Scenario, v: number[]) => void,
  size: (scn: Scenario) => [number, number]): Form => ({
  file, sections: [section],
  write: (scn) => { const [w, h] = size(scn); return formatGrid(comment.replace("{w}", String(w)).replace("{h}", String(h)), get(scn)!, w, HEX_DIGITS[kind]); },
  read: (scn, body) => { const [w, h] = size(scn); set(scn, readGrid(file, body, w, h, kind)); },
});

const terrainForm = gridForm("terrain.txt", "MTXM", "MTXM: {w} × {h} tiles, a row per line; each is a tile id in hex (the tileset's group × 16 + its megatile).", "u16",
  (scn) => scn.tiles, (scn, v) => { scn.tiles = Uint16Array.from(v); }, (scn) => [scn.width, scn.height]);
const isomForm = gridForm("isom.txt", "ISOM", "ISOM: the isometric lattice, {h} rows of {w} words in hex (four per diamond cell).", "u16",
  (scn) => scn.isom, (scn, v) => { scn.isom = Uint16Array.from(v); }, (scn) => [(Math.floor(scn.width / 2) + 1) * 4, scn.height + 1]);
const maskForm = gridForm("mask.txt", "MASK", "MASK: {w} × {h} tiles of fog of war, a byte in hex per tile (bit n hides it from player n + 1).", "u8",
  (scn) => scn.mask, (scn, v) => { scn.mask = Uint8Array.from(v); }, (scn) => [scn.width, scn.height]);

/** TILE as where it differs from MTXM: the ground under doodads, which is all StarEdit's copy adds. */
const underDoodadsForm: Form = {
  file: "under-doodads.txt",
  sections: ["TILE"],
  write(scn) {
    const rows: string[][] = [];
    for (let i = 0; i < scn.editorTiles.length; i++) {
      if (scn.editorTiles[i] !== scn.tiles[i]) rows.push([String(i % scn.width), String(Math.floor(i / scn.width)), hex(scn.editorTiles[i], 4)]);
    }
    return formatTable(["x", "y", "tile"], rows);
  },
  read(scn, body) {
    const tiles = scn.tiles.slice(0, scn.width * scn.height);
    const editor = new Uint16Array(scn.width * scn.height);
    editor.set(tiles);
    for (const row of readTable("under-doodads.txt", body, ["x", "y", "tile"])) {
      const fail = (m: string): never => { throw new TextFormError("under-doodads.txt", row.line, m); };
      const x = number(row.get("x"), "u16", fail), y = number(row.get("y"), "u16", fail);
      if (x >= scn.width || y >= scn.height) fail(t("{x},{y} is outside the map ({width} × {height})", { x, y, width: scn.width, height: scn.height }));
      editor[y * scn.width + x] = number(`0x${row.get("tile").trim()}`, "u16", fail);
    }
    scn.editorTiles = editor;
  },
};

const recordsForm = <R>(file: string, section: string, columns: Column[], get: (scn: Scenario) => R[], set: (scn: Scenario, rows: R[]) => void, name?: (r: R) => string): Form => ({
  file, sections: [section],
  write: (scn) => formatTable([...columns.map((c) => c.name), ...(name ? ["name"] : [])], get(scn).map((r) => [...recordCells(r, columns), ...(name ? [label(name(r))] : [])])),
  read: (scn, body) => set(scn, readTable(file, body, columns.map((c) => c.name)).map((row) => recordFrom<R>(file, row, columns))),
});

const unitsForm = recordsForm<UnitRecord>("units.tsv", "UNIT", UNIT_COLUMNS, (scn) => scn.units, (scn, r) => { scn.units = r; }, (u) => unitName(u.unitId));
const spritesForm = recordsForm<SpriteRecord>("sprites.tsv", "THG2", SPRITE_COLUMNS, (scn) => scn.sprites, (scn, r) => { scn.sprites = r; },
  (s) => (s.flags & 0x1000 ? "" : unitName(s.spriteId)));
const doodadsForm = recordsForm<DoodadRecord>("doodads.tsv", "DD2 ", DOODAD_COLUMNS, (scn) => scn.doodads, (scn, r) => { scn.doodads = r; });

const blankLocation = (): LocationRecord => ({ left: 0, top: 0, right: 0, bottom: 0, nameIndex: 0, elevationFlags: 0 });

/** MRGN: a row per location slot that holds anything, numbered as triggers number them (1 up). */
const locationsForm: Form = {
  file: "locations.tsv",
  sections: ["MRGN"],
  write(scn) {
    const rows: string[][] = [];
    scn.locations.forEach((l, i) => {
      if (LOCATION_COLUMNS.every((c) => !(l as unknown as Record<string, number>)[c.name])) return;
      rows.push([String(i + 1), ...recordCells(l, LOCATION_COLUMNS), label(scn.strings.strings[l.nameIndex])]);
    });
    return formatTable(["location", ...LOCATION_COLUMNS.map((c) => c.name), "name"], rows);
  },
  read(scn, body) {
    const locations = Array.from({ length: locationSlots(scn.fileVersion) }, blankLocation);
    const seen = new Set<number>();
    for (const row of readTable("locations.tsv", body, ["location", ...LOCATION_COLUMNS.map((c) => c.name)])) {
      const fail = (m: string): never => { throw new TextFormError("locations.tsv", row.line, m); };
      const n = number(row.get("location"), "u16", fail);
      if (n < 1) fail(t("locations are numbered from 1"));
      if (seen.has(n)) fail(t("location {n} is listed twice", { n }));
      seen.add(n);
      while (locations.length < n) locations.push(blankLocation());
      locations[n - 1] = recordFrom<LocationRecord>("locations.tsv", row, LOCATION_COLUMNS);
    }
    scn.locations = locations;
  },
};

/** UPRP's 64 slots (numbered 1 up, as Create Unit with Properties names them), and UPUS's "in use" byte as `used`. */
const cuwpForm: Form = {
  file: "cuwp.tsv",
  sections: ["UPRP", "UPUS"],
  write(scn, text) {
    const props = text.has("UPRP") && scn.cuwp, used = text.has("UPUS") && scn.cuwpUsed;
    const columns = ["slot", ...(props ? CUWP_COLUMNS.map((c) => c.name) : []), ...(used ? ["used"] : [])];
    const count = Math.max(props ? props.length : 0, used ? used.length : 0);
    return formatTable(columns, Array.from({ length: count }, (_, i) => [String(i + 1), ...(props ? recordCells(props[i], CUWP_COLUMNS) : []), ...(used ? [used[i] ? "1" : "0"] : [])]));
  },
  read(scn, body, text) {
    const props = text.has("UPRP"), used = text.has("UPUS");
    const columns = ["slot", ...(props ? CUWP_COLUMNS.map((c) => c.name) : []), ...(used ? ["used"] : [])];
    const slots: CuwpSlot[] = [], inUse: boolean[] = [];
    for (const row of readTable("cuwp.tsv", body, columns)) {
      const fail = (m: string): never => { throw new TextFormError("cuwp.tsv", row.line, m); };
      const n = number(row.get("slot"), "u8", fail);
      if (n !== slots.length + 1 && n !== inUse.length + 1) fail(t("slot {n} out of order; the slots run 1, 2, 3 …", { n }));
      if (props) slots.push(recordFrom<CuwpSlot>("cuwp.tsv", row, CUWP_COLUMNS));
      if (used) inUse.push(number(row.get("used"), "u8", fail) !== 0);
    }
    if (props) scn.cuwp = slots;
    if (used) scn.cuwpUsed = inUse;
  },
};

const unitSettingsColumns = ["useDefault", "hitPoints", "shields", "armor", "buildTime", "mineralCost", "gasCost", "nameIndex"];
const settingsForms: Form[] = [
  settingsForm({
    file: "settings/units.tsv", sections: ["UNIS", "UNIx"], label: unitName,
    columns: unitSettingsColumns.map((name) => ({ name, kind: name === "hitPoints" ? "u32" : name === "useDefault" || name === "armor" ? "u8" : "u16" })),
    get: (scn) => scn.unitSettings as unknown as Table | null,
    ensure: (scn) => (scn.unitSettings ??= defaultUnitSettings()) as unknown as Table,
  }),
  settingsForm({
    file: "settings/weapons.tsv", sections: ["UNIS", "UNIx"], label: weaponName,
    columns: [{ name: "weaponDamage", kind: "u16" }, { name: "weaponBonus", kind: "u16" }],
    get: (scn) => scn.unitSettings as unknown as Table | null,
    ensure: (scn) => (scn.unitSettings ??= defaultUnitSettings()) as unknown as Table,
  }),
  settingsForm({
    file: "settings/availability.tsv", sections: ["PUNI"], label: unitName,
    columns: [{ name: "playerAvailable", kind: "u8", perPlayer: true }, { name: "defaultAvailable", kind: "u8" }, { name: "playerUsesDefault", kind: "u8", perPlayer: true }],
    get: (scn) => scn.unitAvailability as unknown as Table | null,
    ensure: (scn) => (scn.unitAvailability ??= defaultUnitAvailability()) as unknown as Table,
  }),
  settingsForm({
    file: "settings/upgrades.tsv", sections: ["UPGS", "UPGx"], label: upgradeName,
    columns: ["useDefault", "mineralCost", "mineralFactor", "gasCost", "gasFactor", "timeCost", "timeFactor"].map((name) => ({ name, kind: name === "useDefault" ? "u8" : "u16" })),
    get: (scn) => scn.upgradeSettings as unknown as Table | null,
    ensure: (scn) => (scn.upgradeSettings ??= defaultUpgradeSettings()) as unknown as Table,
  }),
  settingsForm({
    file: "settings/upgrade-levels.tsv", sections: ["UPGR", "PUPx"], label: upgradeName,
    columns: [{ name: "playerMax", kind: "u8", perPlayer: true }, { name: "playerStart", kind: "u8", perPlayer: true }, { name: "defaultMax", kind: "u8" }, { name: "defaultStart", kind: "u8" }, { name: "playerUsesDefault", kind: "u8", perPlayer: true }],
    get: (scn) => scn.upgradeRestrictions as unknown as Table | null,
    ensure: (scn) => (scn.upgradeRestrictions ??= defaultUpgradeRestrictions()) as unknown as Table,
  }),
  settingsForm({
    file: "settings/techs.tsv", sections: ["TECS", "TECx"], label: techName,
    columns: ["useDefault", "mineralCost", "gasCost", "researchTime", "energyCost"].map((name) => ({ name, kind: name === "useDefault" ? "u8" : "u16" })),
    get: (scn) => scn.techSettings as unknown as Table | null,
    ensure: (scn) => (scn.techSettings ??= defaultTechSettings()) as unknown as Table,
  }),
  settingsForm({
    file: "settings/tech-availability.tsv", sections: ["PTEC", "PTEx"], label: techName,
    columns: [{ name: "playerAvailable", kind: "u8", perPlayer: true }, { name: "playerResearched", kind: "u8", perPlayer: true }, { name: "defaultAvailable", kind: "u8" }, { name: "defaultResearched", kind: "u8" }, { name: "playerUsesDefault", kind: "u8", perPlayer: true }],
    get: (scn) => scn.techRestrictions as unknown as Table | null,
    ensure: (scn) => (scn.techRestrictions ??= defaultTechRestrictions()) as unknown as Table,
  }),
];

/**
 * TRIG and MBRF in the trigger window's text. The text names strings by what they say and sets flags as SCMDraft does
 * (a condition with a unit sets "unit type used", which StarEdit leaves clear), so a map StarEdit wrote does not come
 * back byte for byte from it. With the section's records kept, a trigger whose text is unchanged — the same text as a
 * kept record prints, with the map's names as they are now — packs as that record; an edited or new one is read from
 * its text, as `map triggers import` would.
 */
const triggerForm = (file: string, section: string, briefing: boolean): Form => ({
  file, sections: [section], keepsRecords: true,
  write: (scn) => triggersToText(scn, briefing ? scn.briefing : scn.triggers, briefing),
  read(scn, body, _text, kept) {
    let list: TriggerRecord[];
    try {
      list = triggersFromText(scn, body.replace(/^\uFEFF/, ""), briefing);
    } catch (e) {
      if (e instanceof TriggerTextError) throw new TextFormError(file, e.line, e.message.replace(/^Line \d+: /, ""));
      throw e;
    }
    const original = kept.get(section);
    if (original?.length) {
      let records: TriggerRecord[] = [];
      try { records = decodeTrg(original); } catch { /* not whole records: nothing to keep */ }
      const names = triggerNames(scn);
      const pool = new Map<string, TriggerRecord[]>();
      for (const r of records) { const key = formatTrigger(r, names, briefing); pool.set(key, [...(pool.get(key) ?? []), r]); }
      list = list.map((r) => pool.get(formatTrigger(r, names, briefing))?.shift() ?? r);
    }
    if (briefing) scn.briefing = list; else scn.triggers = list;
  },
});

/**
 * Every form, in the order pack reads them: the header and the string table first (the rest refer to both), the
 * triggers last (they name locations, switches and units by what the files before them say).
 */
const FORMS: Form[] = [
  mapForm, stringsForm, terrainForm, underDoodadsForm, isomForm, maskForm,
  unitsForm, spritesForm, doodadsForm, locationsForm, cuwpForm, ...settingsForms,
  triggerForm("triggers.txt", "TRIG", false), triggerForm("briefing.txt", "MBRF", true),
];

/** The file a text section is listed under: the one that holds most of it (`strings.txt` for the string table). */
function primaryFile(name: string): string {
  if (name === "STR " || name === "STRx") return stringsForm.file;
  return FORMS.find((f) => f.sections.includes(name))!.file;
}

const formsFor = (text: ReadonlySet<string>) => FORMS.filter((f) => f.sections.some((s) => text.has(s)));

/* ── Bytes ──────────────────────────────────────────────── */

const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");
const same = (a: Uint8Array | null | undefined, b: Uint8Array | null | undefined) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/** A section's file name under `sections/`: its name without trailing spaces, anything a file system may refuse as `%XX`. */
function bytesFileFor(name: string, taken: Set<string>): string {
  const base = [...name.replace(/ +$/, "")].map((c) => (/[A-Za-z0-9_-]/.test(c) ? c : `%${hex(c.charCodeAt(0), 2).toUpperCase()}`)).join("") || "%20";
  let file = `${BYTES_DIR}/${base}.bin`;
  for (let n = 2; taken.has(file.toLowerCase()); n++) file = `${BYTES_DIR}/${base}.${n}.bin`;
  taken.add(file.toLowerCase());
  return file;
}

/* ── Packing ────────────────────────────────────────────── */

/** What pack reads: a text file's contents, or a file's bytes, by path under the text folder; null when there is none. */
export interface TextSource {
  text(path: string): string | null;
  bytes(path: string): Uint8Array | null;
}

interface Assembled {
  chk: Uint8Array;
  /** Each text section's bytes as its text encodes them (before a kept layout replaces them), by position. */
  encoded: Map<number, Uint8Array>;
}

/** The scenario from the folder's text and kept bytes, in the order `sections.json` lists. */
function assemble(list: SectionsList, source: TextSource): Assembled {
  const kept = (path: string) => {
    const b = source.bytes(path);
    if (!b) throw new TextFormError(SECTIONS_FILE, null, t("{path} is listed but not in the folder", { path }));
    return b;
  };
  const sectionOf = (e: SectionEntry, data: Uint8Array): ChkSection => ({ name: e.name, offset: -1, declaredSize: e.size ?? data.length, data });
  const raw = list.sections.map((e) => (e.text ? null : kept(e.bytes ?? "")));
  const trailing = list.trailing ? kept(list.trailing) : undefined;
  const text = new Set(list.sections.filter((e) => e.text).map((e) => e.name));
  const forms = formsFor(text);
  const records = new Map(list.sections.filter((e) => e.text && e.bytes && !e.sha1).map((e) => [e.name, kept(e.bytes!)]));
  const bodies = new Map(forms.map((f) => {
    const body = source.text(f.file);
    if (body === null) throw new TextFormError(f.file, null, t("the file is missing; {list} lists {sections} in it", { list: SECTIONS_FILE, sections: f.sections.filter((s) => text.has(s)).map((s) => s.trim()).join(", ") }));
    return [f.file, body];
  }));
  // The sections kept as bytes come first; the text is read over them. A second pass reads the text over the whole
  // scenario the first one made, so that a kept section's model is decoded against the text's size and revision.
  let chk = serializeChk({ sections: list.sections.flatMap((e, i) => (raw[i] ? [sectionOf(e, raw[i]!)] : [])), trailing });
  let encoded = new Map<number, Uint8Array>();
  for (let pass = 0; pass < 3; pass++) {
    const scn = parseScenario(chk);
    const strings = text.has("STR ") || text.has("STRx") ? null : JSON.stringify(scn.strings.strings);
    for (const f of forms) f.read(scn, bodies.get(f.file)!, text, records);
    // A trigger's text names its strings by what they say; one the table lacks is added to it. With the table kept as
    // bytes there is nowhere to add it, and the trigger would point past the table.
    if (strings !== null && JSON.stringify(scn.strings.strings) !== strings) {
      throw new TextFormError(formsFor(text).some((f) => f.file === "triggers.txt") ? "triggers.txt" : "briefing.txt", null, t("a string here is not in the map's string table, which this folder keeps as bytes; add the string in the editor first"));
    }
    encoded = new Map();
    const sections = list.sections.map((e, i) => {
      if (raw[i]) return sectionOf(e, raw[i]!);
      const data = encodeSection(scn, e.name);
      if (!data) throw new TextFormError(primaryFile(e.name), null, t("the text has nothing to write for section {section}", { section: e.name.trim() }));
      encoded.set(i, data);
      return sectionOf({ name: e.name }, e.bytes && e.sha1 && e.sha1 === sha1(data) ? kept(e.bytes) : data);
    });
    const next = serializeChk({ sections, trailing });
    if (same(next, chk)) break;
    chk = next;
  }
  return { chk, encoded };
}

/** `sections.json`, checked. */
function readSectionsList(body: string | null): SectionsList {
  if (body === null) throw new TextFormError(SECTIONS_FILE, null, t("the file is missing; it lists the scenario's sections"));
  let raw: Partial<SectionsList>;
  try { raw = JSON.parse(body) as Partial<SectionsList>; } catch (e) { throw new TextFormError(SECTIONS_FILE, null, t("not JSON: {message}", { message: String(e instanceof Error ? e.message : e) })); }
  if (raw?.format !== TEXT_FORMAT) throw new TextFormError(SECTIONS_FILE, null, t("format {format} is not one this scmjs reads ({known}); a newer scmjs wrote it", { format: String(raw?.format), known: TEXT_FORMAT }));
  if (!Array.isArray(raw.sections)) throw new TextFormError(SECTIONS_FILE, null, t("sections: the list of the scenario's sections"));
  for (const e of raw.sections) {
    if (typeof e?.name !== "string" || e.name.length !== 4) throw new TextFormError(SECTIONS_FILE, null, t("a section's name is four characters, not {name}", { name: String(JSON.stringify(e?.name)) }));
    if (!e.text && !e.bytes) throw new TextFormError(SECTIONS_FILE, null, t("section {name} names neither a text file nor its bytes", { name: JSON.stringify(e.name) }));
    if (e.text && (!MODELLED_SECTIONS.has(e.name) || !FORMS.some((f) => f.sections.includes(e.name)))) throw new TextFormError(SECTIONS_FILE, null, t("section {name} has no text form; keep it as bytes", { name: JSON.stringify(e.name) }));
    if (e.text && e.bytes && !e.sha1 && !FORMS.some((f) => f.keepsRecords && f.sections.includes(e.name))) throw new TextFormError(SECTIONS_FILE, null, t("section {name} names its bytes without a sha1, and its text keeps no records", { name: JSON.stringify(e.name) }));
  }
  return { format: TEXT_FORMAT, sections: raw.sections, trailing: typeof raw.trailing === "string" ? raw.trailing : undefined };
}

/** The scenario's bytes from a folder of text (the `scenario/` of an unpacked map). */
export function scenarioFromText(source: TextSource): Uint8Array {
  return assemble(readSectionsList(source.text(SECTIONS_FILE)), source).chk;
}

/** A folder on disk as a `TextSource`. */
export async function folderSource(dir: string): Promise<TextSource> {
  const files = new Map<string, Uint8Array>();
  const walk = async (at: string) => {
    for (const e of await readdir(at, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const path = join(at, e.name);
      if (e.isDirectory()) await walk(path);
      else files.set(relative(dir, path).replace(/\\/g, "/").toLowerCase(), new Uint8Array(await readFile(path)));
    }
  };
  await walk(dir);
  return {
    bytes: (path) => files.get(path.toLowerCase()) ?? null,
    text: (path) => { const b = files.get(path.toLowerCase()); return b ? new TextDecoder().decode(b) : null; },
  };
}

/* ── Unpacking ──────────────────────────────────────────── */

export interface ScenarioText {
  /** Every file, by path under the text folder: text as strings, kept sections as bytes. */
  files: Map<string, string | Uint8Array>;
  report: TextReport;
}

/**
 * The scenario as text: which sections can be text, the files, and the check that packing them gives the scenario
 * back byte for byte. A section the check finds the text cannot hold is kept as bytes, and the check runs again.
 */
export function scenarioToText(chkBytes: Uint8Array): ScenarioText {
  const chk = parseChk(chkBytes);
  const model = parseScenario(chkBytes);
  const counts = new Map<string, number>();
  for (const s of chk.sections) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  const why = new Map<string, string>();
  const text = new Set<string>();
  for (const s of chk.sections) {
    if (!MODELLED_SECTIONS.has(s.name) || !FORMS.some((f) => f.sections.includes(s.name))) why.set(s.name, t("not modelled"));
    else if (counts.get(s.name)! > 1) why.set(s.name, t("{n} copies", { n: counts.get(s.name)! }));
    else if (s.truncated || s.declaredSize !== s.data.length) why.set(s.name, t("its length runs past the file"));
    else if ((s.name === "STR " && model.strings.extended) || (s.name === "STRx" && !model.strings.extended)) why.set(s.name, t("not the string table the game reads"));
    else text.add(s.name);
  }
  const reference = new Map<string, Uint8Array | null>([...text].map((n) => [n, encodeSection(model, n)]));
  /** Text sections whose records are kept, after a round found their text alone does not give their bytes. */
  const withRecords = new Set<string>();
  for (let round = 0; ; round++) {
    const files = new Map<string, string | Uint8Array>();
    const taken = new Set<string>();
    const entries: SectionEntry[] = chk.sections.map((s) => {
      if (text.has(s.name) && withRecords.has(s.name)) {
        const file = bytesFileFor(s.name, taken);
        files.set(file, s.data);
        return { name: s.name, text: primaryFile(s.name), bytes: file };
      }
      if (text.has(s.name)) return { name: s.name, text: primaryFile(s.name) };
      const file = bytesFileFor(s.name, taken);
      files.set(file, s.data);
      return { name: s.name, bytes: file, ...(s.declaredSize !== s.data.length ? { size: s.declaredSize } : {}) };
    });
    const list: SectionsList = { format: TEXT_FORMAT, sections: entries };
    if (chk.trailing?.length) { list.trailing = `${BYTES_DIR}/trailing.bin`; files.set(list.trailing, chk.trailing); }
    for (const f of formsFor(text)) files.set(f.file, f.write(model, text));
    const source: TextSource = {
      text: (p) => { const v = files.get(p); return typeof v === "string" ? v : null; },
      bytes: (p) => { const v = files.get(p); return v instanceof Uint8Array ? v : null; },
    };
    let lost: string[] = [];
    try {
      const { encoded } = assemble(list, source);
      chk.sections.forEach((s, i) => {
        const got = encoded.get(i);
        if (!got || same(got, s.data)) return;
        // Not the file's bytes. The same as the editor's model of it encodes to: keep the bytes as its layout.
        if (!withRecords.has(s.name) && same(got, reference.get(s.name))) {
          const file = bytesFileFor(s.name, taken);
          files.set(file, s.data);
          Object.assign(entries[i], { bytes: file, sha1: sha1(got) });
        } else lost.push(s.name);
      });
    } catch (e) {
      if (!(e instanceof TextFormError) || round > 20) throw e;
      lost = FORMS.find((f) => f.file === e.form)?.sections.filter((n) => text.has(n)) ?? [];
      if (!lost.length) throw e;
      for (const n of lost) why.set(n, t("its text does not read back ({message})", { message: e.message }));
    }
    if (lost.length) {
      for (const n of lost) {
        // Text that keeps records gets one more round with them before the section goes back to bytes.
        if (!withRecords.has(n) && !why.has(n) && FORMS.some((f) => f.keepsRecords && f.sections.includes(n))) { withRecords.add(n); continue; }
        text.delete(n);
        if (!why.has(n)) why.set(n, t("its text would lose something the model holds"));
      }
      continue;
    }
    files.set(SECTIONS_FILE, stableJson(list) + "\n");
    // The whole check: the folder packs into the scenario it came from.
    if (!same(assemble(list, source).chk, chkBytes)) throw new CliError(t("The scenario's text does not pack back into the same scenario."), t("Please report it: https://github.com/scm-js/scm-js/issues — scmjs map unpack without --text keeps the scenario as it is."));
    const textNames = chk.sections.filter((s) => text.has(s.name)).map((s) => s.name);
    return {
      files,
      report: {
        text: textNames.filter((n) => !entries.find((e) => e.name === n)!.bytes),
        layout: textNames.filter((n) => !!entries.find((e) => e.name === n)!.sha1),
        records: textNames.filter((n) => withRecords.has(n)),
        bytes: [...new Set(chk.sections.filter((s) => !text.has(s.name)).map((s) => s.name))].map((name) => ({ name, why: why.get(name)! })),
      },
    };
  }
}

/** Write the text folder: what was there goes first, so a section no longer kept as bytes leaves no file behind. */
export async function writeScenarioText(dir: string, files: Map<string, string | Uint8Array>): Promise<number> {
  await rm(dir, { recursive: true, force: true });
  let bytes = 0;
  for (const [path, data] of files) {
    const at = join(dir, path);
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, data);
    bytes += typeof data === "string" ? Buffer.byteLength(data) : data.length;
  }
  return bytes;
}
