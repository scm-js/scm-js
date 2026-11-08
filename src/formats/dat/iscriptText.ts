/**
 * `scripts\iscript.bin` as text and back, in the PyICE / IceCC dialect:
 *
 *   .headerstart
 *   IsId          	3
 *   Type          	1
 *   Init          	Script3_Init
 *   Death         	[NONE]
 *   .headerend
 *
 *   Script3_Init:
 *   	playfram          	0x00
 *   	wait              	1
 *   	end
 *
 * A command's arguments may be written `cmd a b` or `cmd(a, b)`; numbers in decimal or `0x` hex; `#` starts a comment.
 * Beside PyICE's commands this reads IceCC's raw-data lines — `ub n` (a byte), `uw n` (a word), `pw Label` (a label's
 * offset as a word) — which mods use to write opcodes a plugin added (Cosmonarchy's `flagjmp` is `ub 62`, `ub flags`,
 * `pw Label`), and the unknown opcodes' other spellings (`unused_0c` for `__0c`).
 *
 * **Layout.** The assembler lays a file out as IceCC does: the table pointer, `00 00 FF FF 00 00`, all the code in
 * source order, then the headers in source order, then the id table (in header order) and its `FF FF 00 00` end. The
 * game's own file is laid out differently (headers among the code, 1,364 zero bytes up front, the table in another
 * order); the disassembler notes such a file's layout in comment lines PyICE ignores —
 *
 *   # scmjs: preamble 00*1366 …     the bytes from offset 2 to the first header or code
 *   # scmjs: headers inline          each header block is written where it stands in the text
 *   # scmjs: table 198 199 200 …     the id table's order
 *
 * — so that any iscript.bin disassembles to text that assembles to the same bytes. Bytes no script reaches are kept
 * as `ub` lines, so nothing is lost either.
 *
 * Opcode names and argument layouts follow PyMS's command reference (Help/Programs/PyICE); its code is not included
 * here. Sources and licenses: ../../../ATTRIBUTION.md
 */

/** Argument kinds: `b` u8, `s` s8, `w` u16, `f` a frame (u16, written in hex when a frameset), `L` a label (u16 offset), `N` a u8 count and that many u16 sounds. */
export type IscriptArgKind = "b" | "s" | "w" | "f" | "L" | "N";

export interface IscriptOpcode {
  op: number;
  name: string;
  args: readonly IscriptArgKind[];
  /** Execution does not continue past it (`goto`, `end`, `return`). */
  endsFlow?: boolean;
}

const def = (op: number, name: string, args: string, endsFlow = false): IscriptOpcode => ({ op, name, args: [...args] as IscriptArgKind[], ...(endsFlow ? { endsFlow } : {}) });

/** The 69 opcodes of 1.16.1, by number. */
export const ISCRIPT_OPCODES: readonly IscriptOpcode[] = [
  def(0x00, "playfram", "f"), def(0x01, "playframtile", "f"), def(0x02, "sethorpos", "s"), def(0x03, "setvertpos", "s"),
  def(0x04, "setpos", "ss"), def(0x05, "wait", "b"), def(0x06, "waitrand", "bb"), def(0x07, "goto", "L", true),
  def(0x08, "imgol", "wss"), def(0x09, "imgul", "wss"), def(0x0a, "imgolorig", "w"), def(0x0b, "switchul", "w"),
  def(0x0c, "__0c", ""), def(0x0d, "imgoluselo", "wss"), def(0x0e, "imguluselo", "wss"), def(0x0f, "sprol", "wss"),
  def(0x10, "highsprol", "wss"), def(0x11, "lowsprul", "wss"), def(0x12, "uflunstable", "w"), def(0x13, "spruluselo", "wss"),
  def(0x14, "sprul", "wss"), def(0x15, "sproluselo", "wb"), def(0x16, "end", "", true), def(0x17, "setflipstate", "b"),
  def(0x18, "playsnd", "w"), def(0x19, "playsndrand", "N"), def(0x1a, "playsndbtwn", "ww"), def(0x1b, "domissiledmg", ""),
  def(0x1c, "attackmelee", "N"), def(0x1d, "followmaingraphic", ""), def(0x1e, "randcondjmp", "bL"), def(0x1f, "turnccwise", "b"),
  def(0x20, "turncwise", "b"), def(0x21, "turn1cwise", ""), def(0x22, "turnrand", "b"), def(0x23, "setspawnframe", "b"),
  def(0x24, "sigorder", "b"), def(0x25, "attackwith", "b"), def(0x26, "attack", ""), def(0x27, "castspell", ""),
  def(0x28, "useweapon", "b"), def(0x29, "move", "b"), def(0x2a, "gotorepeatattk", ""), def(0x2b, "engframe", "b"),
  def(0x2c, "engset", "b"), def(0x2d, "__2d", ""), def(0x2e, "nobrkcodestart", ""), def(0x2f, "nobrkcodeend", ""),
  def(0x30, "ignorerest", ""), def(0x31, "attkshiftproj", "b"), def(0x32, "tmprmgraphicstart", ""), def(0x33, "tmprmgraphicend", ""),
  def(0x34, "setfldirect", "b"), def(0x35, "call", "L"), def(0x36, "return", "", true), def(0x37, "setflspeed", "w"),
  def(0x38, "creategasoverlays", "b"), def(0x39, "pwrupcondjmp", "L"), def(0x3a, "trgtrangecondjmp", "wL"), def(0x3b, "trgtarccondjmp", "wwL"),
  def(0x3c, "curdirectcondjmp", "wwL"), def(0x3d, "imgulnextid", "ss"), def(0x3e, "__3e", ""), def(0x3f, "liftoffcondjmp", "L"),
  def(0x40, "warpoverlay", "f"), def(0x41, "orderdone", "b"), def(0x42, "grdsprol", "wss"), def(0x43, "__43", ""),
  def(0x44, "dogrddamage", ""),
];

const BY_NAME = new Map<string, IscriptOpcode>();
for (const o of ISCRIPT_OPCODES) BY_NAME.set(o.name, o);
// The unknown opcodes' other spellings (IceCC and mods' sources).
for (const o of ISCRIPT_OPCODES.filter((o) => o.name.startsWith("__"))) {
  const hex = o.name.slice(2);
  for (const alias of [`unused_${hex}`, `unknown_${hex}`, `unk_${hex}`, `unused${hex}`, `unknown${hex}`]) BY_NAME.set(alias, o);
}

/** The header's animation entry points, in header order, as PyICE names them. */
export const ISCRIPT_ANIMS = [
  "Init", "Death", "GndAttkInit", "AirAttkInit", "Unused1", "GndAttkRpt", "AirAttkRpt", "CastSpell", "GndAttkToIdle",
  "AirAttkToIdle", "Unused2", "Walking", "WalkingToIdle", "SpecialState1", "SpecialState2", "AlmostBuilt", "Built",
  "Landing", "LiftOff", "IsWorking", "WorkingToIdle", "WarpIn", "Unused3", "StarEditInit", "Disable", "Burrow",
  "UnBurrow", "Enable",
] as const;

/** How many entry points a header of each type has, in PyMS's table (the game's own file is laid out this way). */
export const ISCRIPT_TYPE_ANIMS: Readonly<Record<number, number>> = {
  0: 2, 1: 2, 2: 4, 12: 14, 13: 14, 14: 16, 15: 16, 20: 22, 21: 22, 23: 24, 24: 26, 26: 28, 27: 28, 28: 28, 29: 28,
};

/**
 * Header sizes differ between compilers: PyMS (and the game's file) give a type the entry points of PyMS's table; IceCC
 * writes `type + 1` of them (one fewer for the even types, so a type 0 header holds Init alone), and takes types PyMS
 * does not know (3, 25). Mods' binaries are mostly IceCC's.
 */
export type IscriptEntryRule = "icecc" | "pyms";

/** How many entry points a header of `type` has under a rule, or undefined when the rule has no such type. */
export function iscriptEntryCount(type: number, rule: IscriptEntryRule): number | undefined {
  if (rule === "icecc") return type < ISCRIPT_ANIMS.length ? type + 1 : undefined;
  return ISCRIPT_TYPE_ANIMS[type];
}

const ANIM_INDEX = new Map(ISCRIPT_ANIMS.map((a, i) => [a.toLowerCase(), i]));

export class IscriptTextError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(line > 0 ? `line ${line}: ${message}` : message);
    this.line = line;
  }
}

/* ── Reading the binary ───────────────────────────────────────────────── */

interface Decoded {
  op: IscriptOpcode;
  args: number[];
  /** Offset of the next instruction. */
  next: number;
}

function u16(d: Uint8Array, at: number): number {
  return d[at] | (d[at + 1] << 8);
}

/** The instruction at `pc`, or null when the byte is no opcode or the instruction would run past `limit`. */
function decodeAt(d: Uint8Array, pc: number, limit: number): Decoded | null {
  const op = ISCRIPT_OPCODES[d[pc]];
  if (!op || pc >= limit) return null;
  const args: number[] = [];
  let at = pc + 1;
  for (const k of op.args) {
    if (k === "N") {
      if (at >= limit) return null;
      const n = d[at++];
      args.push(n);
      for (let i = 0; i < n; i++) { if (at + 2 > limit) return null; args.push(u16(d, at)); at += 2; }
    } else if (k === "b" || k === "s") {
      if (at >= limit) return null;
      const v = d[at++];
      args.push(k === "s" && v > 127 ? v - 256 : v);
    } else {
      if (at + 2 > limit) return null;
      args.push(u16(d, at));
      at += 2;
    }
  }
  return { op, args, next: at };
}

function labelArgs(ins: Decoded): number[] {
  const out: number[] = [];
  ins.op.args.forEach((k, i) => { if (k === "L") out.push(ins.args[i]); });
  return out;
}

export interface IscriptHeaderInfo {
  id: number;
  type: number;
  offset: number;
  /** Entry point offsets in header order; 0 = none. */
  anims: number[];
}

interface RawHeader { id: number; offset: number; type: number }

function readTable(data: Uint8Array): { table: number; raw: RawHeader[]; end: number } {
  if (data.length < 4) throw new Error("iscript.bin is too short");
  const table = u16(data, 0);
  const raw: RawHeader[] = [];
  let at = table;
  for (;;) {
    if (at + 4 > data.length) throw new Error("iscript.bin: the id table has no end");
    const id = u16(data, at), offset = u16(data, at + 2);
    at += 4;
    if (id === 0xffff) break;
    if (offset + 8 > data.length || data[offset] !== 0x53 || data[offset + 1] !== 0x43 || data[offset + 2] !== 0x50 || data[offset + 3] !== 0x45) {
      throw new Error(`iscript ${id}: no "SCPE" header at ${offset}`);
    }
    raw.push({ id, offset, type: data[offset + 4] });
  }
  return { table, raw, end: at };
}

/** The headers under a rule, or null when a type is unknown to it or a header would overlap the next or the table. */
function headersUnder(data: Uint8Array, table: number, raw: RawHeader[], rule: IscriptEntryRule): IscriptHeaderInfo[] | null {
  const out: IscriptHeaderInfo[] = [];
  for (const r of raw) {
    const count = iscriptEntryCount(r.type, rule);
    if (count === undefined || r.offset + 8 + count * 2 > table) return null;
    out.push({ ...r, anims: Array.from({ length: count }, (_, i) => u16(data, r.offset + 8 + i * 2)) });
  }
  const sorted = [...new Set(out.map((h) => h.offset))].sort((a, b) => a - b);
  const size = new Map(out.map((h) => [h.offset, 8 + h.anims.length * 2]));
  for (let i = 0; i + 1 < sorted.length; i++) if (sorted[i] + size.get(sorted[i])! > sorted[i + 1]) return null;
  return out;
}

/** Whether the headers sit packed one after another and end at the table, as a compiler that collects them writes. */
function packed(headers: IscriptHeaderInfo[], table: number): boolean {
  const sorted = [...headers].sort((a, b) => a.offset - b.offset);
  return sorted.every((h, i) => h.offset + 8 + h.anims.length * 2 === (sorted[i + 1]?.offset ?? table));
}

/**
 * The id table and the headers it points at, in table order. Without a rule, the one the file was written with: the
 * rule under which its headers sit packed before the table (IceCC's layout), else PyMS's when it fits, else IceCC's.
 */
export function readIscriptHeaders(data: Uint8Array, rule?: IscriptEntryRule): { table: number; headers: IscriptHeaderInfo[]; end: number; rule: IscriptEntryRule } {
  const { table, raw, end } = readTable(data);
  const rules: IscriptEntryRule[] = rule ? [rule] : ["icecc", "pyms"];
  const tried = rules.map((r) => ({ rule: r, headers: headersUnder(data, table, raw, r) }));
  const pick = tried.find((t) => t.headers && packed(t.headers, table)) ?? tried.find((t) => t.rule === "pyms" && t.headers) ?? tried.find((t) => t.headers);
  if (!pick?.headers) throw new Error(`iscript.bin: its headers fit ${rule ? `the ${rule} rule` : "neither PyMS's nor IceCC's header sizes"} (types ${[...new Set(raw.map((r) => r.type))].join(", ")})`);
  return { table, headers: pick.headers, end, rule: pick.rule };
}

/* ── Disassembler ─────────────────────────────────────────────────────── */

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
const pad = (s: string) => `${s.padEnd(17)}\t`;

function bytesNote(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; ) {
    let n = 1;
    while (i + n < bytes.length && bytes[i + n] === bytes[i]) n++;
    if (n >= 4) { parts.push(`${hex2(bytes[i])}*${n}`); i += n; continue; }
    let s = "";
    const start = i;
    while (i < bytes.length && i - start < 64) {
      let r = 1;
      while (i + r < bytes.length && bytes[i + r] === bytes[i]) r++;
      if (r >= 4) break;
      s += hex2(bytes[i]);
      i++;
    }
    parts.push(s);
  }
  return parts.join(" ");
}

function parseBytesNote(text: string, line: number): number[] {
  const out: number[] = [];
  for (const part of text.trim().split(/\s+/).filter(Boolean)) {
    const rep = /^([0-9a-fA-F]{2})\*(\d+)$/.exec(part);
    if (rep) { for (let i = 0; i < Number(rep[2]); i++) out.push(parseInt(rep[1], 16)); continue; }
    if (!/^([0-9a-fA-F]{2})+$/.test(part)) throw new IscriptTextError(`"${part}" is not hex bytes`, line);
    for (let i = 0; i < part.length; i += 2) out.push(parseInt(part.slice(i, i + 2), 16));
  }
  return out;
}

const DEFAULT_PREAMBLE = [0x00, 0x00, 0xff, 0xff, 0x00, 0x00];

export interface IscriptToTextOptions {
  /** A comment for a header, written above it (PyICE lists the images.dat entries that use it). */
  headerComment?: (id: number) => string | undefined;
}

/** iscript.bin as PyICE text that assembles (with `iscriptFromText`) to the same bytes. */
export function iscriptToText(data: Uint8Array, options: IscriptToTextOptions = {}): string {
  const { table, headers, end, rule } = readIscriptHeaders(data);
  if (end !== data.length) throw new Error(`iscript.bin: ${data.length - end} bytes after the id table's end`);
  const headerAt = new Map<number, IscriptHeaderInfo>();
  for (const h of headers) {
    if (headerAt.has(h.offset)) throw new Error(`iscript ${h.id} shares its header with ${headerAt.get(h.offset)!.id}, which the text form cannot say`);
    headerAt.set(h.offset, h);
  }
  const headerEnd = (h: IscriptHeaderInfo) => h.offset + 8 + h.anims.length * 2;
  const insideHeader = (at: number) => headers.some((h) => at > h.offset && at < headerEnd(h));
  for (const h of headers) for (const a of h.anims) if (a && (a < 2 || a >= table || insideHeader(a) || headerAt.has(a))) throw new Error(`iscript ${h.id}: an entry point at ${a}, outside the code`);

  // Follow every entry point: the instructions reached, and the offsets something jumps to.
  const reached = new Map<number, Decoded>();
  const targets = new Set<number>();
  const todo: number[] = [];
  for (const h of headers) for (const a of h.anims) if (a) { targets.add(a); todo.push(a); }
  while (todo.length) {
    let pc = todo.pop()!;
    while (pc < table && !reached.has(pc) && !headerAt.has(pc)) {
      const ins = decodeAt(data, pc, table);
      // A jump outside the code means this is not code after all (a plugin's opcode the table does not know, read as
      // another): the path stops, and the bytes are kept as they are.
      if (!ins || labelArgs(ins).some((t) => t < 2 || t >= table || insideHeader(t))) break;
      reached.set(pc, ins);
      for (const t of labelArgs(ins)) { targets.add(t); todo.push(t); }
      if (ins.op.endsFlow) break;
      pc = ins.next;
    }
  }

  // Where the items start: the first header or reached instruction.
  const sortedHeaders = [...headers].sort((a, b) => a.offset - b.offset);
  let first = table;
  for (const h of headers) first = Math.min(first, h.offset);
  for (const pc of reached.keys()) first = Math.min(first, pc);
  for (const t of targets) first = Math.min(first, t);

  // IceCC's layout: every header after all the code, packed, in table order, and the table right after them.
  const codeEnd = sortedHeaders.length ? sortedHeaders[0].offset : table;
  let iceLayout = headers.every((h, i) => h === sortedHeaders[i]);
  for (let i = 0; iceLayout && i < sortedHeaders.length; i++) {
    const next = i + 1 < sortedHeaders.length ? sortedHeaders[i + 1].offset : table;
    if (headerEnd(sortedHeaders[i]) !== next) iceLayout = false;
  }
  for (const pc of reached.keys()) if (pc >= codeEnd) iceLayout = false;
  for (const t of targets) if (t >= codeEnd) iceLayout = false;

  // Names: an entry point is called after the first header (in table order) that starts there.
  const names = new Map<number, string>();
  for (const h of headers) h.anims.forEach((a, i) => { if (a && !names.has(a)) names.set(a, `Script${h.id}_${ISCRIPT_ANIMS[i]}`); });
  for (const t of [...targets].sort((a, b) => a - b)) if (!names.has(t)) names.set(t, `L${hex4(t)}`);

  const out: string[] = [];
  const preamble = data.subarray(2, first);
  if (preamble.length !== DEFAULT_PREAMBLE.length || preamble.some((b, i) => b !== DEFAULT_PREAMBLE[i])) out.push(`# scmjs: preamble ${bytesNote(preamble)}`);
  if (rule !== "icecc") out.push(`# scmjs: entries ${rule}`);
  if (!iceLayout) {
    out.push("# scmjs: headers inline");
    if (headers.some((h, i) => h !== sortedHeaders[i])) out.push(`# scmjs: table ${headers.map((h) => h.id).join(" ")}`);
  }

  const writeHeader = (h: IscriptHeaderInfo) => {
    out.push("", "# ----------------------------------------------------------------------------- #");
    const note = options.headerComment?.(h.id);
    if (note) for (const l of note.split("\n")) out.push(`# ${l}`);
    out.push(".headerstart", `${pad("IsId")}${h.id}`, `${pad("Type")}${h.type}`);
    h.anims.forEach((a, i) => out.push(`${pad(ISCRIPT_ANIMS[i])}${a ? names.get(a) : "[NONE]"}`));
    out.push(".headerend", "# ----------------------------------------------------------------------------- #", "");
  };

  const formatArgs = (ins: Decoded): string[] => {
    const parts: string[] = [];
    let i = 0;
    for (const k of ins.op.args) {
      if (k === "N") { const n = ins.args[i++]; parts.push(String(n)); for (let j = 0; j < n; j++) parts.push(String(ins.args[i++])); continue; }
      const v = ins.args[i++];
      if (k === "L") parts.push(names.get(v)!);
      else if (k === "f") parts.push(v % 17 ? String(v) : `0x${hex2(v)}`);
      else parts.push(String(v));
    }
    return parts;
  };

  // In IceCC's layout a header can go anywhere among the code; put each before the code it starts, keeping their order.
  const placeAt = new Map<number, IscriptHeaderInfo[]>();
  if (iceLayout) {
    let floor = first;
    for (const h of sortedHeaders) {
      const starts = h.anims.filter((a) => a);
      const want = Math.max(floor, starts.length ? Math.min(...starts) : codeEnd);
      floor = Math.min(want, codeEnd);
      placeAt.set(floor, [...(placeAt.get(floor) ?? []), h]);
    }
  }

  const stops = new Set<number>([...targets, ...reached.keys(), ...headers.map((h) => h.offset), ...placeAt.keys()]);
  const stopList = [...stops].sort((a, b) => a - b);
  let si = 0;
  // `pc` only grows, so the next stop is found by walking the sorted list forward.
  const nextStop = (from: number, limit: number) => {
    while (si < stopList.length && stopList[si] <= from) si++;
    return si < stopList.length ? Math.min(stopList[si], limit) : limit;
  };
  const limit = iceLayout ? codeEnd : table;
  let pc = first;
  const raw: number[] = [];
  const flushRaw = () => {
    for (let i = 0; i < raw.length; i += 16) out.push(`\t${pad("ub")}${raw.slice(i, i + 16).join(" ")}`);
    raw.length = 0;
  };
  while (pc < limit || (iceLayout && placeAt.has(pc))) {
    for (const h of placeAt.get(pc) ?? []) { flushRaw(); writeHeader(h); }
    if (pc >= limit) break;
    const h = !iceLayout ? headerAt.get(pc) : undefined;
    if (h) { flushRaw(); writeHeader(h); pc = headerEnd(h); continue; }
    if (names.has(pc)) { flushRaw(); out.push(`${names.get(pc)}:`); }
    const stop = nextStop(pc, limit);
    const ins = decodeAt(data, pc, limit);
    // An instruction is written as one when it decodes, ends before the next place something else starts and jumps only
    // to named places; otherwise (bytes no script reaches, an opcode a plugin added) its bytes are kept as they are.
    if (ins && ins.next <= stop && labelArgs(ins).every((t) => names.has(t))) {
      flushRaw();
      const args = formatArgs(ins);
      out.push(args.length ? `\t${pad(ins.op.name)}${args.join(" ")}` : `\t${ins.op.name}`);
      if (ins.op.endsFlow) out.push("");
      pc = ins.next;
    } else {
      for (; pc < stop; pc++) raw.push(data[pc]);
    }
  }
  flushRaw();
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/* ── Assembler ────────────────────────────────────────────────────────── */

interface CodeItem {
  kind: "code";
  line: number;
  op: IscriptOpcode | null;
  /** For raw lines: the bytes, or label names for `pw`. */
  rawKind?: "ub" | "uw" | "pw";
  args: (number | string)[];
  size: number;
}

interface LabelItem { kind: "label"; name: string; line: number }

interface HeaderItem {
  kind: "header";
  line: number;
  id: number;
  type: number;
  anims: (string | null)[];
}

type Item = CodeItem | LabelItem | HeaderItem;

function parseNumber(token: string): number | null {
  if (/^-?0x[0-9a-fA-F]+$/.test(token)) return token.startsWith("-") ? -parseInt(token.slice(3), 16) : parseInt(token.slice(2), 16);
  if (/^-?\d+$/.test(token)) return Number(token);
  return null;
}

function splitArgs(rest: string): string[] {
  return rest.replace(/[(),]/g, " ").trim().split(/\s+/).filter(Boolean);
}

export interface IscriptFromTextOptions {
  /** Header sizes when the text does not say (`# scmjs: entries …`); default IceCC's, which mods' sources are written for. */
  entries?: IscriptEntryRule;
  /** Collects what was dropped (an entry point past its header's size). */
  warnings?: string[];
}

/** iscript.bin from PyICE / IceCC text (see the module comment for the layout and the `# scmjs:` notes). */
export function iscriptFromText(text: string, options: IscriptFromTextOptions = {}): Uint8Array {
  let preamble = DEFAULT_PREAMBLE;
  let rule: IscriptEntryRule = options.entries ?? "icecc";
  let inline = false;
  let tableOrder: number[] | null = null;
  const items: Item[] = [];
  let header: HeaderItem | null = null;

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const n = i + 1;
    const note = /^\s*#\s*scmjs:\s*(\w+)\s*(.*)$/.exec(rawLine);
    if (note) {
      if (note[1] === "preamble") preamble = parseBytesNote(note[2], n);
      else if (note[1] === "headers" && note[2].trim() === "inline") inline = true;
      else if (note[1] === "entries" && (note[2].trim() === "pyms" || note[2].trim() === "icecc")) rule = note[2].trim() as IscriptEntryRule;
      else if (note[1] === "table") tableOrder = splitArgs(note[2]).map((t) => { const v = parseNumber(t); if (v === null) throw new IscriptTextError(`"${t}" is not an id`, n); return v; });
      return;
    }
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) return;
    if (header) {
      if (/^\.headerend$/i.test(line)) { items.push(header); header = null; return; }
      const [key, value, ...more] = line.split(/\s+/);
      if (value === undefined || more.length) throw new IscriptTextError(`expected "Name value" in a header, got "${line}"`, n);
      const lower = key.toLowerCase();
      if (lower === "isid" || lower === "type") {
        const v = parseNumber(value);
        if (v === null) throw new IscriptTextError(`${key} takes a number, not "${value}"`, n);
        if (lower === "isid") header.id = v; else header.type = v;
        return;
      }
      const at = ANIM_INDEX.get(lower);
      if (at === undefined) throw new IscriptTextError(`"${key}" is not a header entry`, n);
      header.anims[at] = /^\[none\]$/i.test(value) ? null : value;
      return;
    }
    if (/^\.headerstart$/i.test(line)) { header = { kind: "header", line: n, id: -1, type: -1, anims: [] }; return; }
    let rest = line;
    const label = /^([A-Za-z_][\w]*)\s*:(.*)$/.exec(line);
    if (label) {
      items.push({ kind: "label", name: label[1], line: n });
      rest = label[2].trim();
      if (!rest) return;
    }
    const m = /^([A-Za-z_]\w*)(.*)$/.exec(rest);
    if (!m) throw new IscriptTextError(`cannot read "${rest}"`, n);
    const name = m[1].toLowerCase();
    const args = splitArgs(m[2]);
    if (name === "ub" || name === "uw" || name === "pw") {
      if (!args.length) throw new IscriptTextError(`${name} needs a value`, n);
      const values = args.map((a) => {
        const v = parseNumber(a);
        if (name === "pw") return v ?? a;
        if (v === null) throw new IscriptTextError(`${name} takes numbers, not "${a}"`, n);
        return v;
      });
      items.push({ kind: "code", line: n, op: null, rawKind: name, args: values, size: values.length * (name === "ub" ? 1 : 2) });
      return;
    }
    const op = BY_NAME.get(name);
    if (!op) throw new IscriptTextError(`"${m[1]}" is not an iscript command`, n);
    const values: (number | string)[] = args.map((a) => parseNumber(a) ?? a);
    let size = 1;
    let want = 0;
    for (const k of op.args) {
      if (k === "N") {
        const count = values[want];
        if (typeof count !== "number") throw new IscriptTextError(`${op.name} starts with the number of sounds`, n);
        size += 1 + 2 * count;
        want += 1 + count;
      } else { size += k === "b" || k === "s" ? 1 : 2; want++; }
    }
    if (values.length !== want) throw new IscriptTextError(`${op.name} takes ${want} argument${want === 1 ? "" : "s"}, not ${values.length}`, n);
    items.push({ kind: "code", line: n, op, args: values, size });
  });
  if (header) throw new IscriptTextError(".headerstart without .headerend", (header as HeaderItem).line);

  const headers = items.filter((it): it is HeaderItem => it.kind === "header");
  const counts = new Map<HeaderItem, number>();
  for (const h of headers) {
    if (h.id < 0) throw new IscriptTextError("header without an IsId", h.line);
    if (h.type < 0) throw new IscriptTextError("header without a Type", h.line);
    const count = iscriptEntryCount(h.type, rule);
    if (count === undefined) throw new IscriptTextError(`${h.type} is not a header type ${rule === "pyms" ? `PyMS knows (${Object.keys(ISCRIPT_TYPE_ANIMS).join(", ")})` : `(0–${ISCRIPT_ANIMS.length - 1})`}`, h.line);
    counts.set(h, count);
    h.anims.forEach((a, i) => {
      if (i >= count && a) options.warnings?.push(`line ${h.line}: a type ${h.type} header has ${count} entry point${count === 1 ? "" : "s"} under the ${rule} rule, so ${ISCRIPT_ANIMS[i]} (${a}) is not written`);
    });
  }
  const headerSize = (h: HeaderItem) => 8 + counts.get(h)! * 2;

  // Addresses.
  const labels = new Map<string, number>();
  const headerOffset = new Map<HeaderItem, number>();
  const codeOffset = new Map<CodeItem, number>();
  let at = 2 + preamble.length;
  const place = (it: Item) => {
    if (it.kind === "label") {
      if (labels.has(it.name)) throw new IscriptTextError(`label ${it.name} is defined twice`, it.line);
      labels.set(it.name, at);
    } else if (it.kind === "code") { codeOffset.set(it, at); at += it.size; }
    else { headerOffset.set(it, at); at += headerSize(it); }
  };
  for (const it of items) if (inline || it.kind !== "header") place(it);
  if (!inline) for (const h of headers) place(h);
  const tableAt = at;
  if (tableAt > 0xffff) throw new IscriptTextError(`the scripts take ${tableAt} bytes, past the 65535 an iscript.bin offset reaches`, 0);

  let order = headers;
  if (tableOrder) {
    const byId = new Map(headers.map((h) => [h.id, h]));
    order = (tableOrder as number[]).map((id) => { const h = byId.get(id); if (!h) throw new IscriptTextError(`the table note names ${id}, which has no header`, 0); return h; });
    if (order.length !== headers.length) throw new IscriptTextError(`the table note lists ${order.length} ids for ${headers.length} headers`, 0);
  }
  const seen = new Set<number>();
  for (const h of headers) { if (seen.has(h.id)) throw new IscriptTextError(`IsId ${h.id} is used by two headers`, h.line); seen.add(h.id); }

  const out = new Uint8Array(tableAt + order.length * 4 + 4);
  const put16 = (o: number, v: number) => { out[o] = v & 0xff; out[o + 1] = (v >> 8) & 0xff; };
  const resolve = (v: number | string, line: number): number => {
    if (typeof v === "number") return v;
    const a = labels.get(v);
    if (a === undefined) throw new IscriptTextError(`no label ${v}`, line);
    return a;
  };
  put16(0, tableAt);
  out.set(preamble, 2);
  for (const it of items) {
    if (it.kind === "label") continue;
    if (it.kind === "header") {
      const o = headerOffset.get(it)!;
      out.set([0x53, 0x43, 0x50, 0x45, it.type, 0, 0, 0], o);
      for (let i = 0; i < counts.get(it)!; i++) {
        const a = it.anims[i];
        put16(o + 8 + i * 2, a ? resolve(a, it.line) : 0);
      }
      continue;
    }
    let p = codeOffset.get(it)!;
    if (!it.op) {
      for (const v of it.args) {
        if (it.rawKind === "ub") { checkRange(v as number, -128, 255, "ub", it.line); out[p++] = (v as number) & 0xff; }
        else { const w = resolve(v, it.line); checkRange(w, -32768, 65535, it.rawKind!, it.line); put16(p, w & 0xffff); p += 2; }
      }
      continue;
    }
    out[p++] = it.op.op;
    let i = 0;
    for (const k of it.op.args) {
      if (k === "N") {
        const count = it.args[i++] as number;
        checkRange(count, 0, 255, it.op.name, it.line);
        out[p++] = count;
        for (let j = 0; j < count; j++) { const v = resolve(it.args[i++], it.line); checkRange(v, 0, 65535, it.op.name, it.line); put16(p, v); p += 2; }
        continue;
      }
      const v = resolve(it.args[i++], it.line);
      if (k === "b" || k === "s") { checkRange(v, -128, 255, it.op.name, it.line); out[p++] = v & 0xff; }
      else { checkRange(v, -32768, 65535, it.op.name, it.line); put16(p, v & 0xffff); p += 2; }
    }
  }
  let t = tableAt;
  for (const h of order) { put16(t, h.id); put16(t + 2, headerOffset.get(h)!); t += 4; }
  put16(t, 0xffff);
  return out;
}

function checkRange(v: number, min: number, max: number, what: string, line: number) {
  if (!Number.isInteger(v) || v < min || v > max) throw new IscriptTextError(`${v} is out of range for ${what} (${min}…${max})`, line);
}
