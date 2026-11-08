/**
 * `scripts\aiscript.bin` and `scripts\bwscript.bin` as PyAI text and back, aise's commands included.
 *
 *   script Ter3 {
 *       name_string 1052
 *       bin_file aiscript
 *       broodwar_only 0
 *       staredit_hidden 0
 *       requires_location 0
 *       entry_point Ter3_entry
 *   }
 *
 *   --Ter3_entry--
 *   start_town()
 *   build(1, 109, 80)
 *   goto(Ter3_entry)
 *
 * Blocks are `--Name--` or `:Name`; a command is `name(a, b)` or `name a b`; `#` and `;` start comments; a string is
 * quoted, with `<N>` for a byte that is not plain text. Units, upgrades and technologies are written as numbers (PyAI
 * reads those too; names when a table of them is given). `@` directives are read and ignored; `type name = value`
 * variables are substituted.
 *
 * **Files.** aiscript.bin: u32 offset of the headers; the code; the headers (u32 id, u32 code offset — 0 for a script
 * kept in bwscript.bin — u32 1-based stat_txt.tbl string, u32 flags); a zero u32. bwscript.bin: the same with 8-byte
 * headers (id, code offset). An **expanded** file (aise; past 64 KB) begins with a table of `goto` trampolines with
 * u32 targets: a command's short (u16) block argument points at a trampoline, aise's long ones and `goto` take u32.
 *
 * **Layout.** The assembler writes code in source order — not in the order a script is reached, as PyAI does — so a
 * file disassembles to text that assembles to the same bytes. What PyAI text cannot say about a file goes in comment
 * lines PyAI ignores: `# scmjs: aiscript preamble …` (bytes before the code), `# scmjs: aiscript long-jumps …` (the
 * trampolines' order), `# scmjs: file bwscript` (the code below belongs to bwscript.bin), `# scmjs: bwscript order …`.
 * Without them, code reached only from bwscript scripts goes to bwscript.bin, and a file is expanded when it must be.
 *
 * Command names and argument layouts follow PyMS's PyAI (Help/Programs/PyAI, its AISE command list); its code is not
 * included here. Sources and licenses: ../../../ATTRIBUTION.md
 */

export type AiArgKind =
  | "byte" | "word" | "dword" | "block" | "long_block" | "unit" | "unit_id" | "unit_group" | "upgrade" | "technology"
  | "string" | "point" | "build_at_point" | "area" | "idle_order_flags" | `enum:${string}` | `flags:${string}`;

export interface AiOpcode {
  op: number;
  name: string;
  args: readonly AiArgKind[];
  endsFlow?: boolean;
  /** One of aise's commands (needs the aise plugin in the game). */
  aise?: boolean;
  /**
   * Not in PyAI or aise: a mod's own command whose layout was read off its files, not from a description. The name is
   * ours (`op_a6`); PyAI does not know it.
   */
  inferred?: boolean;
}

const B = "byte", W = "word", D = "dword", BL = "block", LB = "long_block", U = "unit", UG = "unit_group";
const UP = "upgrade", T = "technology", S = "string", PT = "point", AR = "area";
const CMP = "enum:compare", CT = "enum:compare_trig";

const core = (op: number, name: string, args: AiArgKind[] = [], endsFlow = false): AiOpcode => ({ op, name, args, ...(endsFlow ? { endsFlow } : {}) });
const aise = (op: number, name: string, args: AiArgKind[] = []): AiOpcode => ({ op, name, args, aise: true });

/** The opcodes, the game's 0–112 and aise's from 113. */
export const AI_OPCODES: readonly AiOpcode[] = [
  core(0, "goto", [LB], true), core(1, "notowns_jump", [U, BL]), core(2, "wait", [W]), core(3, "start_town"), core(4, "start_areatown"),
  core(5, "expand", [B, BL]), core(6, "build", [B, U, B]), core(7, "upgrade", [B, UP, B]), core(8, "tech", [T, B]), core(9, "wait_build", [B, U]),
  core(10, "wait_buildstart", [B, U]), core(11, "attack_clear"), core(12, "attack_add", [B, U]), core(13, "attack_prepare"), core(14, "attack_do"),
  core(15, "wait_secure"), core(16, "capt_expand"), core(17, "build_bunkers"), core(18, "wait_bunkers"), core(19, "defensebuild_gg", [B, U]),
  core(20, "defensebuild_ag", [B, U]), core(21, "defensebuild_ga", [B, U]), core(22, "defensebuild_aa", [B, U]), core(23, "defenseuse_gg", [B, U]),
  core(24, "defenseuse_ag", [B, U]), core(25, "defenseuse_ga", [B, U]), core(26, "defenseuse_aa", [B, U]), core(27, "defenseclear_gg"),
  core(28, "defenseclear_ag"), core(29, "defenseclear_ga"), core(30, "defenseclear_aa"), core(31, "send_suicide", [B]), core(32, "player_enemy"),
  core(33, "player_ally"), core(34, "default_min", [B]), core(35, "defaultbuild_off"), core(36, "stop", [], true), core(37, "switch_rescue"),
  core(38, "move_dt"), core(39, "debug", [BL, S], true), core(40, "fatal_error"), core(41, "enter_bunker"), core(42, "value_area"),
  core(43, "transports_off"), core(44, "check_transports"), core(45, "nuke_rate", [B]), core(46, "max_force", [W]), core(47, "clear_combatdata"),
  core(48, "random_jump", [B, BL]), core(49, "time_jump", [B, BL]), core(50, "farms_notiming"), core(51, "farms_timing"), core(52, "build_turrets"),
  core(53, "wait_turrets"), core(54, "default_build"), core(55, "harass_factor", [W]), core(56, "start_campaign"), core(57, "race_jump", [BL, BL, BL], true),
  core(58, "region_size", [B, BL]), core(59, "get_oldpeons", [B]), core(60, "groundmap_jump", [BL]), core(61, "place_guard", [U, B]), core(62, "wait_force", [B, U]),
  core(63, "guard_resources", [U]), core(64, "call", [BL]), core(65, "return", [], true), core(66, "eval_harass", [BL]), core(67, "creep", [B]),
  core(68, "panic", [BL]), core(69, "player_need", [B, U]), core(70, "do_morph", [B, U]), core(71, "wait_upgrades"), core(72, "multirun", [BL]),
  core(73, "rush", [B, BL]), core(74, "scout_with", [U]), core(75, "define_max", [B, U]), core(76, "train", [B, U]), core(77, "target_expansion"),
  core(78, "wait_train", [B, U]), core(79, "set_attacks", [B]), core(80, "set_gencmd"), core(81, "make_patrol"), core(82, "give_money"),
  core(83, "prep_down", [B, B, U]), core(84, "resources_jump", [W, W, BL]), core(85, "enter_transport"), core(86, "exit_transport"), core(87, "sharedvision_on", [B]),
  core(88, "sharedvision_off", [B]), core(89, "nuke_location"), core(90, "harass_location"), core(91, "implode"), core(92, "guard_all"),
  core(93, "enemyowns_jump", [U, BL]), core(94, "enemyresources_jump", [W, W, BL]), core(95, "if_dif", [CMP, B, BL]), core(96, "easy_attack", [B, U]), core(97, "kill_thread", [], true),
  core(98, "killable"), core(99, "wait_finishattack"), core(100, "quick_attack"), core(101, "junkyard_dog"), core(102, "fake_nuke"),
  core(103, "disruption_web"), core(104, "recall_location"), core(105, "set_randomseed", [D]), core(106, "if_owned", [U, BL]), core(107, "create_nuke"),
  core(108, "create_unit", [U, W, W]), core(109, "nuke_pos", [W, W]), core(110, "help_iftrouble"), core(111, "allies_watch", [B, BL]), core(112, "try_townpoint", [B, BL]),
  aise(113, "attack_to", [PT, PT]), aise(114, "attack_timeout", [D]),
  aise(115, "issue_order", ["enum:order", W, UG, AR, AR, UG, "flags:issue_order_flags"]),
  aise(116, "deaths", [B, CT, D, UG, LB]),
  aise(117, "idle_orders", ["enum:idle_order", W, W, UG, W, UG, B, "idle_order_flags"]),
  aise(118, "if_attacking", [LB]), aise(119, "unstart_campaign"), aise(120, "max_workers", [B]), aise(121, "under_attack", ["enum:attack_mode"]),
  aise(122, "aicontrol", ["enum:ai_control"]), aise(123, "bring_jump", [B, CT, D, UG, AR, LB]), aise(124, "create_script", [LB, B, AR, B, B]),
  aise(125, "player_jump", [S, LB]), aise(126, "aise_kills", [B, B, CT, D, UG, LB]), aise(127, "wait_rand", [D, D]),
  aise(128, "upgrade_jump", [B, CT, UP, B, LB]), aise(129, "tech_jump", [B, CT, T, B, LB]), aise(130, "random_call", [B, LB]),
  aise(131, "attack_rand", [B, B, U]), aise(132, "supply", [B, CT, W, "enum:supply", UG, "enum:race", LB]),
  aise(133, "time", [CT, D, "enum:time_type", LB]), aise(134, "resources", [B, CT, "enum:resource", D, LB]), aise(135, "set_id", [B]),
  aise(136, "remove_build", [B, UG, B]), aise(137, "guard", [U, PT, B, B, B]), aise(138, "base_layout_old", [U, "enum:layout_action", AR, B, B]),
  aise(139, "print", [S]), aise(140, "attacking", ["enum:bool_compare", LB]), aise(141, "base_layout", [U, "enum:layout_action", AR, B, B, B]),
  aise(142, "unit_avail", [B, CT, "enum:availability", U, LB]), aise(143, "load_bunkers", [AR, U, B, U, B, B]), aise(144, "ping", [W, W, B]),
  aise(145, "reveal_area", [B, AR, W, "enum:reveal_type"]), aise(146, "tech_avail", [B, CT, T, B, LB]), aise(147, "remove_creep", [AR]),
  aise(148, "save_bank", [S]), aise(149, "load_bank", [S]), aise(150, "bank_data_old", [CT, S, S, D, LB]),
  aise(151, "unit_name", [B, U, AR, S, "enum:layout_action"]), aise(152, "bank_data", [CT, D, S, S, LB]),
  aise(153, "lift_land", [U, B, AR, AR, B, B, B]), aise(154, "queue", [B, U, U, B, "enum:queue_flags", AR, B]), aise(155, "aise_debug", [S]),
  aise(156, "replace_unit", [U, U]), aise(157, "defense", [W, U, "enum:defense_type", "enum:defense_direction", "enum:defense_direction"]),
  aise(160, "bw_kills", [B, CT, D, UG, LB]), aise(161, "build_at", [UG, "build_at_point", "flags:build_at_flags"]), aise(162, "debug_name", [S]),
  aise(164, "autosave", [S, B]),
  // Cosmonarchy's aise fork: a long block and its name (1,165 times in its aiscript.bin, always followed by more code).
  { op: 0xa6, name: "op_a6", args: [LB, S], aise: true, inferred: true },
];


const OP_BY_CODE: (AiOpcode | undefined)[] = [];
for (const o of AI_OPCODES) OP_BY_CODE[o.op] = o;
const OP_BY_NAME = new Map(AI_OPCODES.map((o) => [o.name, o]));

/** Named values of the enumerated argument types (a value without a name is written as its number). */
export const AI_ENUMS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  compare: { LessThan: 0, GreaterThan: 1 },
  compare_trig: { AtLeast: 0, AtMost: 1, Set: 7, Add: 8, Subtract: 9, Exactly: 10, Randomize: 11, AtLeast_Call: 128, AtMost_Call: 129, Exactly_Call: 138, AtLeast_Wait: 64, AtMost_Wait: 65, Exactly_Wait: 74 },
  order: {},
  idle_order: { EnableBuiltin: 254, DisableBuiltin: 255 },
  attack_mode: { Always: 0, Default: 1, Never: 2 },
  ai_control: Object.fromEntries([
    "wait_request_resources", "dont_wait_request_resources", "build_gas", "dont_build_gas", "retaliation", "no_retaliation",
    "focus_disabled_units", "dont_focus_disabled_units", "global_enable_spell_focus", "global_disable_spell_focus",
    "global_enable_acid_spore_focus", "global_disable_acid_spore_focus", "global_enable_carrier_focus", "global_disable_carrier_focus",
  ].map((n, i) => [n, i])),
  supply: { Provided: 0, Used: 1, Max: 2, InUnits: 3 },
  race: { Zerg: 0, Terran: 1, Protoss: 2, Any_Total: 16, Any_Max: 17 },
  time_type: { Frames: 0, Minutes: 1 },
  resource: { Ore: 0, Gas: 1, Any: 2 },
  layout_action: { Set: 0, Remove: 1 },
  bool_compare: { False: 0, True: 1, False_Wait: 64, True_Wait: 65, False_Call: 128, True_Call: 129 },
  availability: { Disabled: 0, Enabled: 1, Researched: 2 },
  reveal_type: { Reveal: 0, RevealFog: 1 },
  queue_flags: { Local: 0, Global: 1 },
  defense_type: { Use: 0, Build: 1 },
  defense_direction: { Ground: 0, Air: 1 },
};

/** Flag names of the flag argument types, and their width. */
export const AI_FLAGS: Readonly<Record<string, { bytes: 2 | 4; names: Readonly<Record<string, number>> }>> = {
  issue_order_flags: { bytes: 2, names: { Enemies: 0x01, Own: 0x02, Allied: 0x04, SingleUnit: 0x08, EachAtMostOnce: 0x10, IgnoreDatReqs: 0x40 } },
  build_at_flags: { bytes: 4, names: { AllowUnreachableRegions: 0x1, NotSafe: 0x2, AnyElevation: 0x8, NearResourceBuildings: 0x10, NearResources: 0x20, DontSpreadOut: 0x100, DontPreferUnpowered: 0x200, IgnoreExtraSpace: 0x400, PreferUnpowered: 0x02000000, Remove: 0x80000000 } },
};

/** aise's unit_id values that are not units. */
const UNIT_KEYWORDS: Readonly<Record<string, number>> = { None: 228, Any: 229, Group_Men: 230, Group_Buildings: 231, Group_Factories: 232 };
const POINT_LOCATION = 0xffff, POINT_SCRIPT_AREA = 0xfffe, POINT_TOWN_CENTER = 65500;

/** Script header flag bits. */
export const AI_SCRIPT_FLAGS = { requires_location: 1, staredit_hidden: 2, broodwar_only: 4 } as const;

export class AiScriptTextError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(line > 0 ? `line ${line}: ${message}` : message);
    this.line = line;
  }
}

/** Names for units, upgrades and technologies (stat_txt.tbl's), to write and read them by name. */
export interface AiNames {
  units?: readonly string[];
  upgrades?: readonly string[];
  technologies?: readonly string[];
}

/* ── Values ────────────────────────────────────────────────────────────── */

type Point = [number, number];
type AiValue = number | number[] | Point | [Point, number] | Uint8Array;

interface AiInstruction {
  op: AiOpcode;
  values: AiValue[];
  next: number;
}

const u16 = (d: Uint8Array, at: number) => d[at] | (d[at + 1] << 8);
const u32 = (d: Uint8Array, at: number) => (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0;

/** Payload bytes of an idle-order option word, by its type (0 ends the set; 4 opens a nested set). */
function idleOptionPayload(type: number): number | null {
  return ({ 0: 0, 1: 0, 2: 0, 3: 4, 4: 0, 5: 0, 6: 4, 7: 0, 8: 4, 9: 6, 10: 1 } as Record<number, number>)[type] ?? null;
}

/** The bytes of an idle_order_flags option set starting at `at`, or null when it does not parse. */
function idleFlagsLength(d: Uint8Array, at: number, limit: number): number | null {
  let p = at;
  let depth = 1;
  while (depth > 0) {
    if (p + 2 > limit) return null;
    const word = u16(d, p);
    const type = (word & 0x2f00) >> 8;
    const payload = idleOptionPayload(type);
    if (payload === null) return null;
    p += 2 + payload;
    if (type === 4) depth++;
    else if (type === 0) depth--;
  }
  return p > limit ? null : p - at;
}

function decodeInstruction(d: Uint8Array, pc: number, limit: number, expanded: boolean): AiInstruction | null {
  const op = OP_BY_CODE[d[pc]];
  if (!op || pc >= limit) return null;
  let at = pc + 1;
  const values: AiValue[] = [];
  const need = (n: number) => at + n <= limit;
  for (const kind of op.args) {
    if (kind === "byte" || kind.startsWith("enum:")) { if (!need(1)) return null; values.push(d[at]); at += 1; continue; }
    if (kind === "word" || kind === "unit" || kind === "unit_id" || kind === "upgrade" || kind === "technology" || kind === "block") { if (!need(2)) return null; values.push(u16(d, at)); at += 2; continue; }
    if (kind === "dword") { if (!need(4)) return null; values.push(u32(d, at)); at += 4; continue; }
    if (kind === "long_block") { const n = expanded ? 4 : 2; if (!need(n)) return null; values.push(expanded ? u32(d, at) : u16(d, at)); at += n; continue; }
    if (kind.startsWith("flags:")) { const n = AI_FLAGS[kind.slice(6)].bytes; if (!need(n)) return null; values.push(n === 2 ? u16(d, at) : u32(d, at)); at += n; continue; }
    if (kind === "point" || kind === "build_at_point") { if (!need(4)) return null; values.push([u16(d, at), u16(d, at + 2)]); at += 4; continue; }
    if (kind === "area") { if (!need(6)) return null; values.push([[u16(d, at), u16(d, at + 2)], u16(d, at + 4)]); at += 6; continue; }
    if (kind === "unit_group") {
      if (!need(2)) return null;
      const first = u16(d, at);
      at += 2;
      if (first < 0xff00) { values.push([first]); continue; }
      const n = first & 0xff;
      if (!need(2 * n)) return null;
      const group: number[] = [];
      for (let i = 0; i < n; i++) { group.push(u16(d, at)); at += 2; }
      // A group of one written in the long form must stay so; the marker word says how it was written.
      values.push(n === 1 ? [-1, ...group] : group);
      continue;
    }
    if (kind === "string") {
      let end = at;
      while (end < limit && d[end] !== 0) end++;
      if (end >= limit) return null;
      values.push(d.slice(at, end));
      at = end + 1;
      continue;
    }
    if (kind === "idle_order_flags") {
      const n = idleFlagsLength(d, at, limit);
      if (n === null) return null;
      values.push(d.slice(at, at + n));
      at += n;
      continue;
    }
    return null;
  }
  return { op, values, next: at };
}

/** The block arguments of an instruction: [value index, long?]. */
function blockArgs(op: AiOpcode): { index: number; long: boolean }[] {
  const out: { index: number; long: boolean }[] = [];
  op.args.forEach((k, i) => { if (k === "block" || k === "long_block") out.push({ index: i, long: k === "long_block" }); });
  return out;
}

/* ── Text of values ────────────────────────────────────────────────────── */

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");

/** A C string as PyAI writes it: quoted, `<N>` for control bytes, `#`, `<`, `>`, quotes and bytes that are not UTF-8. */
export function aiStringText(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b >= 0x20 && b < 0x7f) {
      s += b === 0x23 || b === 0x3c || b === 0x3e || b === 0x22 || b === 0x27 ? `<${b}>` : String.fromCharCode(b);
      i++;
      continue;
    }
    // A valid UTF-8 sequence is written as its character; anything else byte by byte.
    const len = b >= 0xf0 && b < 0xf5 ? 4 : b >= 0xe0 ? 3 : b >= 0xc2 && b < 0xe0 ? 2 : 0;
    if (len && i + len <= bytes.length && bytes.subarray(i + 1, i + len).every((c) => (c & 0xc0) === 0x80)) {
      const ch = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(i, i + len));
      if (ch.length > 0 && !ch.includes("�") && new TextEncoder().encode(ch).length === len) { s += ch; i += len; continue; }
    }
    s += `<${b}>`;
    i++;
  }
  return `"${s}"`;
}

/** A string argument's bytes: `<N>` is byte N, other characters UTF-8. */
function stringBytes(text: string): number[] {
  const out: number[] = [];
  const enc = new TextEncoder();
  for (let i = 0; i < text.length; ) {
    const m = /^<(\d{1,3})>/.exec(text.slice(i, i + 5));
    if (m && Number(m[1]) <= 255) { out.push(Number(m[1])); i += m[0].length; continue; }
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    out.push(...enc.encode(ch));
    i += ch.length;
  }
  return out;
}

function pointText(p: Point, buildAt: boolean): string {
  if (buildAt && p[0] === POINT_TOWN_CENTER) return "TownCenter";
  if (p[0] === POINT_LOCATION) return `Loc.${p[1]}`;
  if (p[0] === POINT_SCRIPT_AREA && p[1] === 0) return "ScriptArea";
  return `(${p[0]}, ${p[1]})`;
}

function flagsText(v: number, names: Readonly<Record<string, number>>, bytes: number): string {
  if (!v) return "0";
  const byBit = new Map(Object.entries(names).map(([n, f]) => [f, n]));
  const parts: string[] = [];
  for (let bit = 0; bit < bytes * 8; bit++) {
    const f = 2 ** bit;
    if (Math.floor(v / f) % 2) parts.push(byBit.get(f) ?? `0x${f.toString(16).toUpperCase()}`);
  }
  return parts.join(" | ");
}

function nameOrNumber(v: number, names: readonly string[] | undefined): string {
  const n = names?.[v];
  if (n === undefined || n === "") return String(v);
  return /^[^,()"'#;<>|]+$/.test(n) && n.trim() === n ? n : `"${n.replace(/"/g, "<34>")}"`;
}

/* ── Disassembler ──────────────────────────────────────────────────────── */

interface AiHeader { id: string; address: number; stringId?: number; flags?: number }

interface ParsedFile {
  data: Uint8Array;
  headersAt: number;
  headers: AiHeader[];
  expanded: boolean;
  /** Trampolines: their offsets and targets, in file order. */
  trampolines: { at: number; target: number }[];
  codeStart: number;
}

function parseFile(data: Uint8Array, bw: boolean, name: string): ParsedFile {
  if (data.length < 8) throw new Error(`${name} is too short`);
  const headersAt = u32(data, 0);
  const size = bw ? 8 : 16;
  const headers: AiHeader[] = [];
  let at = headersAt;
  for (;;) {
    if (at + 4 > data.length) throw new Error(`${name}: the script headers have no end`);
    if (u32(data, at) === 0) { at += 4; break; }
    if (at + size > data.length) throw new Error(`${name}: a script header runs past the end`);
    const id = String.fromCharCode(...data.subarray(at, at + 4));
    headers.push(bw ? { id, address: u32(data, at + 4) } : { id, address: u32(data, at + 4), stringId: u32(data, at + 8), flags: u32(data, at + 12) });
    at += size;
  }
  if (at !== data.length) throw new Error(`${name}: ${data.length - at} bytes after the script headers' end`);
  // aise's expanded layout (PyMS's test): headers past 64 KB, or a table of u32 gotos up to the first script.
  const addresses = headers.map((h) => h.address).filter(Boolean);
  const first = addresses.length ? Math.min(...addresses) : headersAt;
  let expanded = headersAt >= 0x10000;
  if (!expanded && addresses.length && first > 4 && (first - 4) % 5 === 0 && first < headersAt) {
    expanded = true;
    for (let p = 4; p < first; p += 5) {
      const t = u32(data, p + 1);
      if (data[p] !== 0 || t < first || t >= headersAt) { expanded = false; break; }
    }
  }
  const trampolines: { at: number; target: number }[] = [];
  let codeStart = 4;
  if (expanded) {
    for (let p = 4; p + 5 <= first && data[p] === 0; p += 5) {
      const t = u32(data, p + 1);
      if (t < first || t >= headersAt) break;
      trampolines.push({ at: p, target: t });
    }
    codeStart = 4 + trampolines.length * 5;
  }
  return { data, headersAt, headers, expanded, trampolines, codeStart };
}

const safeLabel = (id: string) => id.replace(/[^A-Za-z0-9_]/g, (c) => `_${hex2(c.charCodeAt(0))}`);

/** One file's code as text lines, with labels. */
function codeLines(f: ParsedFile, prefix: string, labelOf: Map<number, string>, entryNames: Map<number, string>, names: AiNames, out: string[], fileName: string) {
  const { data, headersAt, expanded } = f;
  const tramp = new Map(f.trampolines.map((t) => [t.at, t.target]));
  const limit = headersAt;
  const inCode = (t: number) => t >= f.codeStart && t < limit;
  // Short block arguments of an expanded file point at trampolines; the text names where the trampoline goes.
  const resolve = (v: number, long: boolean): number | null => {
    if (expanded && !long) { const t = tramp.get(v); return t === undefined ? null : t; }
    return inCode(v) ? v : null;
  };

  const reached = new Map<number, AiInstruction>();
  const targets = new Set<number>();
  const todo: number[] = [];
  for (const a of entryNames.keys()) { targets.add(a); todo.push(a); }
  for (const t of f.trampolines) { targets.add(t.target); todo.push(t.target); }
  while (todo.length) {
    let pc = todo.pop()!;
    while (pc < limit && !reached.has(pc)) {
      const ins = decodeInstruction(data, pc, limit, expanded);
      if (!ins) break;
      const jumps = blockArgs(ins.op).map(({ index, long }) => resolve(ins.values[index] as number, long));
      if (jumps.some((j) => j === null)) break;
      reached.set(pc, ins);
      for (const j of jumps) { targets.add(j!); todo.push(j!); }
      if (ins.op.endsFlow) break;
      pc = ins.next;
    }
  }
  for (const [a, n] of entryNames) labelOf.set(a, n);
  for (const t of [...targets].sort((a, b) => a - b)) if (!labelOf.has(t)) labelOf.set(t, `${prefix}${t.toString(16).toUpperCase().padStart(4, "0")}`);

  let first = limit;
  for (const pc of reached.keys()) first = Math.min(first, pc);
  for (const t of targets) first = Math.min(first, t);
  const preamble = data.subarray(f.codeStart, first);
  if (preamble.length) out.push(`# scmjs: ${fileName} preamble ${bytesNote(preamble)}`);

  const stopList = [...new Set([...targets, ...reached.keys()])].sort((a, b) => a - b);
  let si = 0;
  const nextStop = (from: number) => { while (si < stopList.length && stopList[si] <= from) si++; return si < stopList.length ? Math.min(stopList[si], limit) : limit; };
  const raw: number[] = [];
  const flush = () => { for (let i = 0; i < raw.length; i += 16) out.push(`raw_bytes(${raw.slice(i, i + 16).join(", ")})`); raw.length = 0; };
  let pc = first;
  while (pc < limit) {
    const label = labelOf.get(pc);
    if (label) { flush(); out.push(`--${label}--`); }
    const stop = nextStop(pc);
    const ins = decodeInstruction(data, pc, limit, expanded);
    const jumps = ins ? blockArgs(ins.op).map(({ index, long }) => resolve(ins.values[index] as number, long)) : [];
    if (ins && ins.next <= stop && jumps.every((j) => j !== null && labelOf.has(j))) {
      flush();
      const parts = ins.op.args.map((kind, i) => {
        const v = ins.values[i];
        if (kind === "block" || kind === "long_block") return labelOf.get(resolve(v as number, kind === "long_block")!)!;
        if (kind === "string") return aiStringText(v as Uint8Array);
        if (kind === "unit") return nameOrNumber(v as number, names.units);
        if (kind === "unit_id") return Object.entries(UNIT_KEYWORDS).find(([, n]) => n === v)?.[0] ?? nameOrNumber(v as number, names.units);
        if (kind === "upgrade") return nameOrNumber(v as number, names.upgrades);
        if (kind === "technology") return nameOrNumber(v as number, names.technologies);
        if (kind === "unit_group") {
          const g = v as number[];
          const units = g[0] === -1 ? g.slice(1) : g;
          const text = units.map((u) => Object.entries(UNIT_KEYWORDS).find(([, n]) => n === u)?.[0] ?? nameOrNumber(u, names.units)).join(" | ");
          return g[0] === -1 ? `${text} | Group_Of_One` : text;
        }
        if (kind === "point" || kind === "build_at_point") return pointText(v as Point, kind === "build_at_point");
        if (kind === "area") { const [p, r] = v as [Point, number]; return r ? `${pointText(p, false)} ~ ${r}` : pointText(p, false); }
        if (kind === "idle_order_flags") return `IdleRaw(${Array.from(v as Uint8Array, hex2).join(":")})`;
        if (kind.startsWith("enum:")) return Object.entries(AI_ENUMS[kind.slice(5)]).find(([, n]) => n === v)?.[0] ?? String(v);
        if (kind.startsWith("flags:")) { const fl = AI_FLAGS[kind.slice(6)]; return flagsText(v as number, fl.names, fl.bytes); }
        return String(v);
      });
      out.push(`${ins.op.name}(${parts.join(", ")})`);
      if (ins.op.endsFlow) out.push("");
      pc = ins.next;
    } else {
      for (; pc < stop; pc++) raw.push(data[pc]);
    }
  }
  flush();
}

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
      s += hex2(bytes[i++]);
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
    if (!/^([0-9a-fA-F]{2})+$/.test(part)) throw new AiScriptTextError(`"${part}" is not hex bytes`, line);
    for (let i = 0; i < part.length; i += 2) out.push(parseInt(part.slice(i, i + 2), 16));
  }
  return out;
}

export interface AiScriptToTextOptions {
  names?: AiNames;
}

/** aiscript.bin (and bwscript.bin, when its scripts are kept there) as PyAI text that assembles to the same bytes. */
export function aiscriptToText(aiscript: Uint8Array, bwscript?: Uint8Array | null, options: AiScriptToTextOptions = {}): string {
  const ai = parseFile(aiscript, false, "aiscript.bin");
  const bw = bwscript ? parseFile(bwscript, true, "bwscript.bin") : null;
  const names = options.names ?? {};
  const inBw = ai.headers.filter((h) => h.address === 0);
  if (inBw.length && !bw) throw new Error(`aiscript.bin keeps ${inBw.length} scripts in bwscript.bin (${inBw.slice(0, 3).map((h) => h.id).join(", ")}…), which was not given`);
  const bwById = new Map((bw?.headers ?? []).map((h) => [h.id, h]));
  for (const h of inBw) if (!bwById.has(h.id)) throw new Error(`aiscript.bin keeps ${h.id} in bwscript.bin, which has no such script`);
  const stray = (bw?.headers ?? []).filter((h) => !ai.headers.some((a) => a.id === h.id && a.address === 0));
  if (stray.length) throw new Error(`bwscript.bin has scripts aiscript.bin does not point at (${stray.map((h) => h.id).join(", ")}), which PyAI text cannot say`);

  const out: string[] = [];
  const entryAi = new Map<number, string>();
  const entryBw = new Map<number, string>();
  const used = new Set<string>();
  const labelFor = (id: string) => { let n = `${safeLabel(id)}_entry`; for (let i = 2; used.has(n); i++) n = `${safeLabel(id)}_entry${i}`; used.add(n); return n; };
  const entryLabel = new Map<string, string>();
  for (const h of ai.headers) {
    const map = h.address === 0 ? entryBw : entryAi;
    const address = h.address === 0 ? bwById.get(h.id)!.address : h.address;
    if (!map.has(address)) map.set(address, labelFor(h.id));
    entryLabel.set(h.id, map.get(address)!);
  }

  if (ai.expanded) out.push("# scmjs: aiscript expanded");
  if (bw?.expanded) out.push("# scmjs: bwscript expanded");
  const bwOrder = (bw?.headers ?? []).map((h) => h.id);
  if (bwOrder.join("\u0000") !== inBw.map((h) => h.id).join("\u0000")) out.push(`# scmjs: bwscript order ${bwOrder.join(" ")}`);
  for (const h of ai.headers) {
    const flags = h.flags ?? 0;
    if (flags & ~7) out.push(`# scmjs: script ${h.id} flags ${flags}`);
    out.push(
      `script ${h.id} {`,
      `    name_string ${(h.stringId ?? 0) - 1}`,
      `    bin_file ${h.address === 0 ? "bwscript" : "aiscript"}`,
      `    broodwar_only ${flags & AI_SCRIPT_FLAGS.broodwar_only ? 1 : 0}`,
      `    staredit_hidden ${flags & AI_SCRIPT_FLAGS.staredit_hidden ? 1 : 0}`,
      `    requires_location ${flags & AI_SCRIPT_FLAGS.requires_location ? 1 : 0}`,
      `    entry_point ${entryLabel.get(h.id)}`,
      "}",
      "",
    );
  }
  const aiLabels = new Map<number, string>();
  const aiCode: string[] = [];
  codeLines(ai, "ai_", aiLabels, entryAi, names, aiCode, "aiscript");
  if (ai.expanded) for (let i = 0; i < ai.trampolines.length; i += 16) out.push(`# scmjs: aiscript long-jumps ${ai.trampolines.slice(i, i + 16).map((t) => aiLabels.get(t.target)).join(" ")}`);
  out.push(...aiCode);
  if (bw) {
    const bwLabels = new Map<number, string>();
    const bwCode: string[] = [];
    codeLines(bw, "bw_", bwLabels, entryBw, names, bwCode, "bwscript");
    out.push("", "# scmjs: file bwscript");
    if (bw.expanded) for (let i = 0; i < bw.trampolines.length; i += 16) out.push(`# scmjs: bwscript long-jumps ${bw.trampolines.slice(i, i + 16).map((t) => bwLabels.get(t.target)).join(" ")}`);
    out.push(...bwCode);
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/* ── Assembler ─────────────────────────────────────────────────────────── */

type FileName = "aiscript" | "bwscript";

interface ScriptHeader {
  id: string;
  line: number;
  nameString: number;
  binFile: FileName;
  flags: number;
  entry: string;
}

interface CodeItem {
  kind: "code";
  line: number;
  op: AiOpcode | null;
  /** For `raw_bytes`: the bytes. */
  raw?: number[];
  args: string[];
  file?: FileName;
  label?: undefined;
}

interface LabelItem { kind: "label"; name: string; line: number; file?: FileName }

type Item = CodeItem | LabelItem;

/** Split a command's arguments: top-level commas inside parentheses, else whitespace; quotes kept whole. */
function splitCommand(text: string, line: number): { name: string; args: string[] } {
  const m = /^([A-Za-z_]\w*)\s*(.*)$/.exec(text);
  if (!m) throw new AiScriptTextError(`cannot read "${text}"`, line);
  const rest = m[2].trim();
  const args: string[] = [];
  if (rest.startsWith("(")) {
    if (!rest.endsWith(")")) throw new AiScriptTextError(`"${text}" has no closing parenthesis`, line);
    const inner = rest.slice(1, -1);
    let depth = 0, quote = "", cur = "";
    for (const ch of inner) {
      if (quote) { cur += ch; if (ch === quote) quote = ""; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim() || args.length) args.push(cur.trim());
  } else if (rest) {
    const re = /"[^"]*"|'[^']*'|\S+/g;
    for (const t of rest.match(re) ?? []) args.push(t);
  }
  return { name: m[1].toLowerCase(), args };
}

/** Remove a `#` or `;` comment that is not inside quotes. */
function stripComment(line: string): string {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) { if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" || ch === ";") return line.slice(0, i);
  }
  return line;
}

function parseNumber(token: string): number | null {
  const t = token.trim();
  if (/^0x[0-9a-fA-F]+$/.test(t)) return parseInt(t.slice(2), 16);
  if (/^-?\d+$/.test(t)) return Number(t);
  return null;
}

const VARIABLE_TYPES = new Set(["byte", "word", "dword", "unit", "building", "military", "gg_military", "ag_military", "ga_military", "aa_military", "upgrade", "technology", "string", "compare", "block", "unit_id", "unit_group", "point", "area", "order", "compare_trig"]);

export interface AiScriptFromTextOptions {
  names?: AiNames;
}

export interface AiScriptFiles {
  aiscript: Uint8Array;
  /** Null when no script is kept in bwscript.bin. */
  bwscript: Uint8Array | null;
}

/** aiscript.bin and bwscript.bin from PyAI text (see the module comment for the layout and the `# scmjs:` notes). */
export function aiscriptFromText(text: string, options: AiScriptFromTextOptions = {}): AiScriptFiles {
  const names = options.names ?? {};
  const scripts: ScriptHeader[] = [];
  const items: Item[] = [];
  const variables = new Map<string, string>();
  const preamble: Record<FileName, number[]> = { aiscript: [], bwscript: [] };
  const expandedNote: Record<FileName, boolean> = { aiscript: false, bwscript: false };
  const longJumps: Record<FileName, string[] | null> = { aiscript: null, bwscript: null };
  let bwOrder: string[] | null = null;
  const extraFlags = new Map<string, number>();
  let fileNotes = false;
  let currentFile: FileName = "aiscript";
  let header: ScriptHeader | null = null;

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const n = i + 1;
    const note = /^\s*#\s*scmjs:\s*(.*)$/.exec(rawLine);
    if (note) {
      const words = note[1].trim().split(/\s+/);
      const file = words[0] === "aiscript" || words[0] === "bwscript" ? (words[0] as FileName) : null;
      if (words[0] === "file" && (words[1] === "aiscript" || words[1] === "bwscript")) { currentFile = words[1]; fileNotes = true; }
      else if (file && words[1] === "preamble") preamble[file] = parseBytesNote(words.slice(2).join(" "), n);
      else if (file && words[1] === "expanded") expandedNote[file] = true;
      else if (file && words[1] === "long-jumps") longJumps[file] = [...(longJumps[file] ?? []), ...words.slice(2)];
      else if (words[0] === "bwscript" && words[1] === "order") bwOrder = words.slice(2);
      else if (words[0] === "script" && words[2] === "flags") extraFlags.set(words[1], Number(words[3]));
      return;
    }
    const line = stripComment(rawLine).trim();
    if (!line) return;
    if (header) {
      if (line === "}") { scripts.push(header); header = null; return; }
      const [key, ...rest] = line.split(/\s+/);
      const value = rest.join(" ");
      const num = parseNumber(value);
      switch (key) {
        case "name_string": if (num === null) throw new AiScriptTextError("name_string takes a number", n); header.nameString = num; return;
        case "bin_file": if (value !== "aiscript" && value !== "bwscript") throw new AiScriptTextError("bin_file is aiscript or bwscript", n); header.binFile = value; return;
        case "broodwar_only": case "staredit_hidden": case "requires_location": {
          const on = num !== null ? num !== 0 : /^true$/i.test(value);
          const bit = AI_SCRIPT_FLAGS[key];
          header.flags = on ? header.flags | bit : header.flags & ~bit;
          return;
        }
        case "entry_point": header.entry = value; return;
        default: throw new AiScriptTextError(`"${key}" is not a script header field`, n);
      }
    }
    const scriptStart = /^script\s+(.+?)\s*\{$/.exec(line) ?? /^script\s+(.+?)$/.exec(line);
    if (scriptStart && !line.includes("(")) {
      header = { id: scriptStart[1], line: n, nameString: 0, binFile: "aiscript", flags: 0, entry: "" };
      if (!line.endsWith("{")) header.id = scriptStart[1];
      return;
    }
    if (line === "{") return;
    if (line.startsWith("@")) return;
    const block = /^--(\w+)--$/.exec(line) ?? /^:(\w+)$/.exec(line);
    if (block) { items.push({ kind: "label", name: block[1], line: n, file: fileNotes ? currentFile : undefined }); return; }
    const variable = /^(\w+)\s+(\w+)\s*=\s*(.+)$/.exec(line);
    if (variable && VARIABLE_TYPES.has(variable[1])) { variables.set(variable[2], variable[3].trim()); return; }
    const { name, args } = splitCommand(line, n);
    const resolved = args.map((a) => variables.get(a) ?? a);
    if (name === "raw_bytes") {
      const bytes = resolved.map((a) => { const v = parseNumber(a); if (v === null || v < 0 || v > 255) throw new AiScriptTextError(`raw_bytes takes bytes, not "${a}"`, n); return v; });
      items.push({ kind: "code", line: n, op: null, raw: bytes, args: [], file: fileNotes ? currentFile : undefined });
      return;
    }
    const op = OP_BY_NAME.get(name);
    if (!op) throw new AiScriptTextError(`"${name}" is not an AI script command`, n);
    if (resolved.length !== op.args.length) throw new AiScriptTextError(`${op.name} takes ${op.args.length} argument${op.args.length === 1 ? "" : "s"}, not ${resolved.length}`, n);
    items.push({ kind: "code", line: n, op, args: resolved, file: fileNotes ? currentFile : undefined });
  });
  if (header) throw new AiScriptTextError("script header without its closing }", (header as ScriptHeader).line);
  for (const [id, flags] of extraFlags) { const s = scripts.find((x) => x.id === id); if (s) s.flags = flags; }

  // Which file each item belongs to: as the notes say, else by which scripts reach it.
  if (!fileNotes) assignFiles(items, scripts);
  const labels = new Map<string, { file: FileName; item: number }>();
  items.forEach((it, i) => {
    if (it.kind !== "label") return;
    if (labels.has(it.name)) throw new AiScriptTextError(`block ${it.name} is defined twice`, it.line);
    labels.set(it.name, { file: it.file ?? "aiscript", item: i });
  });
  for (const s of scripts) {
    if (!s.entry) throw new AiScriptTextError(`script ${s.id} has no entry_point`, s.line);
    const l = labels.get(s.entry);
    if (!l) throw new AiScriptTextError(`script ${s.id}'s entry point ${s.entry} is no block`, s.line);
    if (l.file !== s.binFile) throw new AiScriptTextError(`script ${s.id} is in ${s.binFile}.bin but its entry point ${s.entry} is in ${l.file}.bin`, s.line);
  }

  const build = (file: FileName): Uint8Array | null => {
    const own = items.filter((it) => (it.file ?? "aiscript") === file);
    const fileScripts = file === "aiscript" ? scripts : orderScripts(scripts.filter((s) => s.binFile === "bwscript"), bwOrder);
    if (file === "bwscript" && !fileScripts.length && !own.some((it) => it.kind === "code")) return null;
    // Expanded when the text says so, or when the file would not fit in 64 KB otherwise.
    let expanded = expandedNote[file];
    let bytes = layOut(file, own, fileScripts, expanded, preamble[file], longJumps[file], labels, names);
    if (!expanded && bytes === null) { expanded = true; bytes = layOut(file, own, fileScripts, true, preamble[file], longJumps[file], labels, names); }
    return bytes;
  };
  const aiscript = build("aiscript")!;
  const bwscript = build("bwscript");
  return { aiscript, bwscript };
}

function orderScripts(list: ScriptHeader[], order: string[] | null): ScriptHeader[] {
  if (!order) return list;
  const byId = new Map(list.map((s) => [s.id, s]));
  const out = order.map((id) => { const s = byId.get(id); if (!s) throw new AiScriptTextError(`the bwscript order note names ${id}, which is not a bwscript script`, 0); return s; });
  if (out.length !== list.length) throw new AiScriptTextError(`the bwscript order note lists ${out.length} scripts for ${list.length}`, 0);
  return out;
}

/** Code reached from bwscript scripts goes to bwscript.bin; everything else to aiscript.bin. */
function assignFiles(items: Item[], scripts: ScriptHeader[]) {
  const at = new Map<string, number>();
  items.forEach((it, i) => { if (it.kind === "label") at.set(it.name, i); });
  const reach = (entries: string[]) => {
    const seen = new Set<number>();
    const todo = entries.map((e) => at.get(e)).filter((i): i is number => i !== undefined);
    while (todo.length) {
      let i = todo.pop()!;
      while (i < items.length && !seen.has(i)) {
        seen.add(i);
        const it = items[i];
        if (it.kind === "code" && it.op) {
          blockArgs(it.op).forEach(({ index }) => { const t = at.get(it.args[index]); if (t !== undefined) todo.push(t); });
          if (it.op.endsFlow) break;
        }
        i++;
      }
    }
    return seen;
  };
  const bw = reach(scripts.filter((s) => s.binFile === "bwscript").map((s) => s.entry));
  const ai = reach(scripts.filter((s) => s.binFile === "aiscript").map((s) => s.entry));
  items.forEach((it, i) => {
    if (bw.has(i) && ai.has(i)) throw new AiScriptTextError("this code is reached from scripts in both aiscript.bin and bwscript.bin; give each file its own copy", it.line);
    it.file = bw.has(i) ? "bwscript" : "aiscript";
  });
}

/** Encode one argument; returns the bytes, with `blocks` listing (offset in bytes, label, long) to fill later. */
function encodeArg(kind: AiArgKind, text: string, line: number, expanded: boolean, names: AiNames, blocks: { at: number; label: string; long: boolean }[], base: number): number[] {
  const num = (min: number, max: number, what: string) => {
    const v = parseNumber(text);
    if (v === null || v < min || v > max) throw new AiScriptTextError(`${what} takes a number ${min}…${max}, not "${text}"`, line);
    return v;
  };
  const le16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const le32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  const byName = (list: readonly string[] | undefined, what: string, keywords?: Readonly<Record<string, number>>) => {
    const v = parseNumber(text);
    if (v !== null) return v;
    const t = text.replace(/^["']|["']$/g, "");
    if (keywords) { const k = Object.entries(keywords).find(([n]) => n.toLowerCase() === t.toLowerCase()); if (k) return k[1]; }
    const i = list?.findIndex((n) => n.toLowerCase() === t.toLowerCase()) ?? -1;
    if (i < 0) throw new AiScriptTextError(`"${text}" is not a ${what} number${list ? " or name" : ""}`, line);
    return i;
  };
  const point = (t: string, buildAt: boolean): number[] => {
    const s = t.trim();
    if (buildAt && /^towncenter$/i.test(s)) return [...le16(POINT_TOWN_CENTER), 0, 0];
    if (/^scriptarea$/i.test(s)) return [...le16(POINT_SCRIPT_AREA), 0, 0];
    const loc = /^loc\.(\d+)$/i.exec(s);
    if (loc) return [...le16(POINT_LOCATION), ...le16(Number(loc[1]))];
    const xy = /^\(\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s);
    if (xy) return [...le16(Number(xy[1])), ...le16(Number(xy[2]))];
    throw new AiScriptTextError(`"${t}" is not a point ((x, y), Loc.N, ScriptArea${buildAt ? ", TownCenter" : ""})`, line);
  };
  switch (kind) {
    case "byte": return [num(0, 255, kind)];
    case "word": return le16(num(0, 0xffff, kind));
    case "dword": return le32(num(0, 0xffffffff, kind));
    case "block": case "long_block": {
      const long = kind === "long_block";
      blocks.push({ at: base, label: text, long });
      return long && expanded ? [0, 0, 0, 0] : [0, 0];
    }
    case "unit": return le16(byName(names.units, "unit"));
    case "unit_id": return le16(byName(names.units, "unit", UNIT_KEYWORDS));
    case "upgrade": return le16(byName(names.upgrades, "upgrade"));
    case "technology": return le16(byName(names.technologies, "technology"));
    case "unit_group": {
      const parts = text.split("|").map((s) => s.trim());
      const one = parts[parts.length - 1] === "Group_Of_One";
      const units = (one ? parts.slice(0, -1) : parts).map((p) => { const saved = text; text = p; const v = byName(names.units, "unit", UNIT_KEYWORDS); text = saved; return v; });
      if (units.length > 255) throw new AiScriptTextError(`a unit group holds at most 255 units, not ${units.length}`, line);
      return units.length > 1 || one ? [...le16(0xff00 | units.length), ...units.flatMap(le16)] : le16(units[0]);
    }
    case "string": {
      const m = /^"(.*)"$/.exec(text) ?? /^'(.*)'$/.exec(text);
      const bytes = stringBytes(m ? m[1] : text);
      if (bytes.includes(0)) throw new AiScriptTextError("a string cannot hold <0>", line);
      return [...bytes, 0];
    }
    case "point": case "build_at_point": return point(text, kind === "build_at_point");
    case "area": {
      const [p, r] = text.split("~");
      const radius = r === undefined ? 0 : parseNumber(r);
      if (radius === null || radius < 0 || radius > 0xffff) throw new AiScriptTextError(`"${r}" is not a radius (0…65535)`, line);
      return [...point(p, false), ...le16(radius)];
    }
    case "idle_order_flags": {
      const m = /^IdleRaw\(([0-9a-fA-F:]*)\)$/.exec(text.trim());
      if (!m) throw new AiScriptTextError(`idle_orders' flags are written IdleRaw(hex:bytes) here, not "${text}" (PyAI's option names are not read yet)`, line);
      return m[1] ? m[1].split(":").map((h) => parseInt(h, 16)) : [];
    }
    default: {
      if (kind.startsWith("enum:")) {
        const cases = AI_ENUMS[kind.slice(5)];
        const named = Object.entries(cases).find(([n]) => n.toLowerCase() === text.trim().toLowerCase());
        if (named) return [named[1]];
        return [num(0, 255, kind.slice(5))];
      }
      const fl = AI_FLAGS[kind.slice(6)];
      let v = 0;
      for (const part of text.split("|").map((s) => s.trim()).filter(Boolean)) {
        const named = Object.entries(fl.names).find(([n]) => n.toLowerCase() === part.toLowerCase());
        const raw = named ? named[1] : parseNumber(part);
        if (raw === null) throw new AiScriptTextError(`"${part}" is not a ${kind.slice(6)} flag`, line);
        v = (v | raw) >>> 0;
      }
      return fl.bytes === 2 ? le16(v) : le32(v);
    }
  }
}

/** One file's bytes, or null when it does not fit unexpanded. */
function layOut(file: FileName, items: Item[], scripts: ScriptHeader[], expanded: boolean, preamble: number[], longJumpNote: string[] | null, labels: Map<string, { file: FileName; item: number }>, names: AiNames): Uint8Array | null {
  const bw = file === "bwscript";
  // Encode every item once (block arguments as placeholders), to know the offsets.
  const encoded = items.map((it) => {
    if (it.kind === "label") return { bytes: [] as number[], blocks: [] as { at: number; label: string; long: boolean }[] };
    if (!it.op) return { bytes: it.raw!, blocks: [] };
    const blocks: { at: number; label: string; long: boolean }[] = [];
    const bytes = [it.op.op];
    it.op.args.forEach((kind, i) => bytes.push(...encodeArg(kind, it.args[i], it.line, expanded, names, blocks, bytes.length)));
    return { bytes, blocks };
  });
  // Trampolines (expanded): one a block that a short argument names, in the note's order or first use.
  const tramp: string[] = [];
  if (expanded) {
    if (longJumpNote) tramp.push(...longJumpNote);
    else for (const e of encoded) for (const b of e.blocks) if (!b.long && !tramp.includes(b.label)) tramp.push(b.label);
    for (const e of encoded) for (const b of e.blocks) if (!b.long && !tramp.includes(b.label)) throw new AiScriptTextError(`block ${b.label} is jumped to with a short argument but has no trampoline in the long-jumps note`, 0);
  }
  const codeStart = 4 + tramp.length * 5 + preamble.length;
  const offsetOf = new Map<string, number>();
  let at = codeStart;
  const itemAt: number[] = [];
  items.forEach((it, i) => {
    itemAt.push(at);
    if (it.kind === "label") offsetOf.set(it.name, at);
    at += encoded[i].bytes.length;
  });
  const headersAt = at;
  if (!expanded && headersAt > 0xffff) return null;
  const trampAt = new Map(tramp.map((l, i) => [l, 4 + i * 5]));
  const size = headersAt + scripts.length * (bw ? 8 : 16) + 4;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, headersAt, true);
  const target = (label: string, line: number) => {
    const o = offsetOf.get(label);
    if (o === undefined) {
      const l = labels.get(label);
      throw new AiScriptTextError(l ? `block ${label} is in ${l.file}.bin; ${file}.bin cannot jump to it` : `no block ${label}`, line);
    }
    return o;
  };
  tramp.forEach((label, i) => { out[4 + i * 5] = 0; view.setUint32(4 + i * 5 + 1, target(label, 0), true); });
  out.set(preamble, 4 + tramp.length * 5);
  items.forEach((it, i) => {
    const e = encoded[i];
    out.set(e.bytes, itemAt[i]);
    for (const b of e.blocks) {
      const dest = !b.long && expanded ? trampAt.get(b.label)! : target(b.label, it.line);
      if (b.long && expanded) view.setUint32(itemAt[i] + b.at, dest, true);
      else {
        if (dest > 0xffff) throw new AiScriptTextError(`block ${b.label} is past 64 KB, which a short block argument cannot reach`, it.line);
        view.setUint16(itemAt[i] + b.at, dest, true);
      }
    }
  });
  let h = headersAt;
  for (const s of scripts) {
    const id = s.id.padEnd(4, " ").slice(0, 4);
    for (let k = 0; k < 4; k++) out[h + k] = id.charCodeAt(k) & 0xff;
    const address = bw || s.binFile === "aiscript" ? target(s.entry, s.line) : 0;
    view.setUint32(h + 4, address, true);
    if (!bw) { view.setUint32(h + 8, (s.nameString + 1) >>> 0, true); view.setUint32(h + 12, s.flags >>> 0, true); }
    h += bw ? 8 : 16;
  }
  return out;
}
