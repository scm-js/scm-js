/**
 * `.graft` files (GPTP's grafting, the successor of a Firegraft `.fgp`): requirements and buttons as data the game
 * loads from `datreq\*.graft`, as binary and as the text the CMBW editor's `graftc` reads and writes.
 *
 * **Requirements** (`units.graft`, `upgrades.graft`, `research.graft`, `tech.graft`, `orders.graft`) are the game's
 * own requirement script, a stream of u16: a leading 0, then each entry — its id, its opcodes (0xFF00 and up) and
 * their parameters, ended by 0xFFFF (an upgrade's levels each end with one: 0xFF1F … 0xFFFF 0xFF20 … 0xFFFF) — and a
 * last 0xFFFF. Text:
 *
 *   #DAT REQ:
 *   1:
 *     0xFF02
 *     111
 *     0xFFFF
 *
 * **Buttons** (`buttons.graft`): u32 button count, u32 unit count, u32 status-entry count; the buttons (u16 position,
 * u16 icon, u32 condition, u32 action, u16 condition parameter, u16 action parameter, u16 enabled string, u16
 * disabled string — conditions and actions by index into GPTP's tables); a set a unit (u32 button count, u32 first
 * button index, u32 connected unit); a status entry a unit (u32 unit id, u32 status function, u32 display function).
 * Text:
 *
 *   #BUTTONS:
 *   1:
 *   1, 130, 1, 2, 0, 0, 373, 0          position, icon, condition, action, condition and action parameters, strings
 *   Unit 1: 1, 65535, 2, 1               button set[, connected unit[, status function, display function]]
 *   Unit 4: -1                           no buttons
 *
 * What graftc's text cannot say about a file (a nonzero leading word, a status entry for another unit) goes in
 * `# scmjs:` comment lines, so a file comes back byte for byte. The layouts are read off GPTP's loader
 * (`hooks/grafting/grafting.cpp`) and the files Cosmonarchy ships; graftc's own code is not included here.
 */

export class GraftTextError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(line > 0 ? `line ${line}: ${message}` : message);
    this.line = line;
  }
}

const num = (t: string, line: number): number => {
  const s = t.trim();
  const v = /^-?0x[0-9a-fA-F]+$/.test(s) ? parseInt(s.replace("-", ""), 16) * (s.startsWith("-") ? -1 : 1) : /^-?\d+$/.test(s) ? Number(s) : NaN;
  if (Number.isNaN(v)) throw new GraftTextError(`"${t.trim()}" is not a number`, line);
  return v;
};

const hexWord = (v: number) => `0x${v.toString(16).toUpperCase().padStart(4, "0")}`;

/* ── Requirements ──────────────────────────────────────────────────────── */

export interface ReqGraft {
  /** The leading word (0 in every file seen). */
  start: number;
  /** Entries in file order: the id, then every word up to and including the entry's last 0xFFFF. */
  entries: { id: number; words: number[] }[];
}

export function decodeReqGraft(data: Uint8Array): ReqGraft {
  if (data.length % 2 || data.length < 4) throw new Error(`a requirements .graft is whole u16s, at least two (${data.length} bytes)`);
  const w = Array.from({ length: data.length / 2 }, (_, i) => data[i * 2] | (data[i * 2 + 1] << 8));
  const entries: ReqGraft["entries"] = [];
  let i = 1;
  for (;;) {
    if (i >= w.length) throw new Error("requirements .graft has no end (0xFFFF)");
    const id = w[i++];
    if (id === 0xffff) break;
    const words: number[] = [];
    // An entry runs to a 0xFFFF that is followed by something other than an opcode (an id, or the table's end).
    for (;;) {
      if (i >= w.length) throw new Error(`requirements .graft: entry ${id} has no end`);
      const v = w[i++];
      words.push(v);
      if (v === 0xffff && (i >= w.length || w[i] < 0xff00 || w[i] === 0xffff)) break;
    }
    entries.push({ id, words });
  }
  if (i !== w.length) throw new Error(`requirements .graft: ${(w.length - i) * 2} bytes after its end`);
  return { start: w[0], entries };
}

export function encodeReqGraft(graft: ReqGraft): Uint8Array {
  const w = [graft.start, ...graft.entries.flatMap((e) => [e.id, ...e.words]), 0xffff];
  const out = new Uint8Array(w.length * 2);
  w.forEach((v, i) => {
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new Error(`${v} is not a u16`);
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = v >> 8;
  });
  return out;
}

export function reqGraftToText(graft: ReqGraft): string {
  const out = graft.start ? [`# scmjs: start ${graft.start}`] : [];
  out.push("#DAT REQ:");
  for (const e of graft.entries) {
    out.push(`${e.id}:`);
    for (const v of e.words) out.push(`  ${v >= 0xff00 ? hexWord(v) : v}`);
    out.push("");
  }
  return `${out.join("\n")}\n`;
}

export function reqGraftFromText(text: string): ReqGraft {
  const graft: ReqGraft = { start: 0, entries: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const note = /^\s*#\s*scmjs:\s*start\s+(\S+)/.exec(raw);
    if (note) { graft.start = num(note[1], n); return; }
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const head = /^(\S+)\s*:\s*(.*)$/.exec(line);
    if (head) {
      graft.entries.push({ id: num(head[1], n), words: [] });
      for (const v of head[2].split(/[\s,]+/).filter(Boolean)) graft.entries[graft.entries.length - 1].words.push(num(v, n));
      return;
    }
    const entry = graft.entries[graft.entries.length - 1];
    if (!entry) throw new GraftTextError("a value before any entry (id:)", n);
    for (const v of line.split(/[\s,]+/).filter(Boolean)) entry.words.push(num(v, n));
  });
  return graft;
}

/* ── Buttons ───────────────────────────────────────────────────────────── */

export interface GraftButton {
  position: number;
  icon: number;
  condition: number;
  action: number;
  conditionParam: number;
  actionParam: number;
  enabledString: number;
  disabledString: number;
}

export interface ButtonGraft {
  buttons: GraftButton[];
  /** A set a unit: how many buttons, from which, and the connected unit (0xFFFF none). */
  sets: { count: number; first: number; connected: number }[];
  /** A status entry a unit: [unit id, status function, display function]. */
  status: [number, number, number][];
}

const BUTTON = 20, SET = 12, STATUS = 12;

export function decodeButtonGraft(data: Uint8Array): ButtonGraft {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 12) throw new Error("buttons .graft is shorter than its header");
  const nb = v.getUint32(0, true), nu = v.getUint32(4, true), ns = v.getUint32(8, true);
  const size = 12 + nb * BUTTON + nu * SET + ns * STATUS;
  if (data.length !== size) throw new Error(`buttons .graft is ${data.length} bytes; its counts (${nb}, ${nu}, ${ns}) make ${size}`);
  const buttons: GraftButton[] = [];
  for (let i = 0, p = 12; i < nb; i++, p += BUTTON) {
    buttons.push({
      position: v.getUint16(p, true), icon: v.getUint16(p + 2, true), condition: v.getUint32(p + 4, true), action: v.getUint32(p + 8, true),
      conditionParam: v.getUint16(p + 12, true), actionParam: v.getUint16(p + 14, true), enabledString: v.getUint16(p + 16, true), disabledString: v.getUint16(p + 18, true),
    });
  }
  const sets: ButtonGraft["sets"] = [];
  for (let i = 0, p = 12 + nb * BUTTON; i < nu; i++, p += SET) sets.push({ count: v.getUint32(p, true), first: v.getUint32(p + 4, true), connected: v.getUint32(p + 8, true) });
  const status: ButtonGraft["status"] = [];
  for (let i = 0, p = 12 + nb * BUTTON + nu * SET; i < ns; i++, p += STATUS) status.push([v.getUint32(p, true), v.getUint32(p + 4, true), v.getUint32(p + 8, true)]);
  return { buttons, sets, status };
}

export function encodeButtonGraft(g: ButtonGraft): Uint8Array {
  const out = new Uint8Array(12 + g.buttons.length * BUTTON + g.sets.length * SET + g.status.length * STATUS);
  const v = new DataView(out.buffer);
  v.setUint32(0, g.buttons.length, true); v.setUint32(4, g.sets.length, true); v.setUint32(8, g.status.length, true);
  let p = 12;
  for (const b of g.buttons) {
    v.setUint16(p, b.position, true); v.setUint16(p + 2, b.icon, true); v.setUint32(p + 4, b.condition, true); v.setUint32(p + 8, b.action, true);
    v.setUint16(p + 12, b.conditionParam, true); v.setUint16(p + 14, b.actionParam, true); v.setUint16(p + 16, b.enabledString, true); v.setUint16(p + 18, b.disabledString, true);
    p += BUTTON;
  }
  for (const s of g.sets) { v.setUint32(p, s.count, true); v.setUint32(p + 4, s.first, true); v.setUint32(p + 8, s.connected >>> 0, true); p += SET; }
  for (const [u, s, d] of g.status) { v.setUint32(p, u, true); v.setUint32(p + 4, s, true); v.setUint32(p + 8, d, true); p += STATUS; }
  return out;
}

const NO_UNIT = 0xffff;

/**
 * graftc's text. The buttons are cut into sets at every place a unit's set starts or ends, so each unit names one set
 * and buttons no unit uses are kept as sets of their own; a unit's status entry is written on its line when it is the
 * unit's own (`[unit, …]`), and with a note otherwise.
 */
export function buttonGraftToText(g: ButtonGraft): string {
  const cuts = new Set<number>([0, g.buttons.length]);
  for (const s of g.sets) if (s.count) { cuts.add(s.first); cuts.add(s.first + s.count); }
  const bounds = [...cuts].filter((c) => c <= g.buttons.length).sort((a, b) => a - b);
  const setAt = new Map<number, number>();
  const out: string[] = [];
  if (g.status.length !== g.sets.length) out.push(`# scmjs: status entries ${g.status.length}`);
  out.push("#BUTTONS:");
  for (let i = 0; i + 1 < bounds.length; i++) {
    setAt.set(bounds[i], i);
    out.push(`${i}:`);
    for (const b of g.buttons.slice(bounds[i], bounds[i + 1])) out.push(`${b.position}, ${b.icon}, ${b.condition}, ${b.action}, ${b.conditionParam}, ${b.actionParam}, ${b.enabledString}, ${b.disabledString}`);
    out.push("");
  }
  const units = Math.max(g.sets.length, g.status.length);
  for (let u = 0; u < units; u++) {
    const s = g.sets[u];
    const st = g.status[u];
    const parts: string[] = [];
    if (s) {
      if (!s.count) {
        if (s.first !== 0) out.push(`# scmjs: unit ${u} first ${s.first}`);
        parts.push("-1");
      } else {
        const id = setAt.get(s.first);
        const next = bounds[bounds.indexOf(s.first) + 1];
        if (id === undefined || next !== s.first + s.count) throw new Error(`unit ${u}'s buttons (${s.first}, ${s.count}) overlap another set's, which the text cannot say`);
        parts.push(String(id));
      }
    }
    const own = st && st[0] === u;
    if (st && !own && (st[0] || st[1] || st[2])) out.push(`# scmjs: unit ${u} status ${st.join(" ")}`);
    if (s && (s.connected !== NO_UNIT || own)) parts.push(String(s.connected));
    if (own) parts.push(String(st[1]), String(st[2]));
    if (s) out.push(`Unit ${u}: ${parts.join(", ")}`);
  }
  return `${out.join("\n")}\n`;
}

export function buttonGraftFromText(text: string): ButtonGraft {
  const sets = new Map<number, { start: number; buttons: GraftButton[] }>();
  const order: number[] = [];
  const units: { unit: number; set: number; connected: number; status?: [number, number]; line: number }[] = [];
  const firstNotes = new Map<number, number>();
  const statusNotes = new Map<number, [number, number, number]>();
  let statusCount: number | null = null;
  let current: number | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const note = /^\s*#\s*scmjs:\s*(.*)$/.exec(raw);
    if (note) {
      const w = note[1].trim().split(/\s+/);
      if (w[0] === "status" && w[1] === "entries") statusCount = num(w[2], n);
      else if (w[0] === "unit" && w[2] === "first") firstNotes.set(num(w[1], n), num(w[3], n));
      else if (w[0] === "unit" && w[2] === "status") statusNotes.set(num(w[1], n), [num(w[3], n), num(w[4], n), num(w[5], n)]);
      return;
    }
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const unit = /^unit\s+(\S+)\s*:\s*(.*)$/i.exec(line);
    if (unit) {
      const v = unit[2].split(",").map((s) => num(s, n));
      units.push({ unit: num(unit[1], n), set: v[0], connected: v[1] ?? NO_UNIT, status: v.length >= 4 ? [v[2], v[3]] : undefined, line: n });
      return;
    }
    const head = /^(\S+)\s*:$/.exec(line);
    if (head) {
      current = num(head[1], n);
      if (sets.has(current)) throw new GraftTextError(`button set ${current} is defined twice`, n);
      sets.set(current, { start: 0, buttons: [] });
      order.push(current);
      return;
    }
    const v = line.split(",").map((s) => num(s, n));
    if (v.length !== 8) throw new GraftTextError(`a button is 8 numbers (position, icon, condition, action, two parameters, two strings), not ${v.length}`, n);
    if (current === null) throw new GraftTextError("a button before any set (id:)", n);
    sets.get(current)!.buttons.push({ position: v[0], icon: v[1], condition: v[2], action: v[3], conditionParam: v[4], actionParam: v[5], enabledString: v[6], disabledString: v[7] });
  });
  const buttons: GraftButton[] = [];
  for (const id of order) { const s = sets.get(id)!; s.start = buttons.length; buttons.push(...s.buttons); }
  const count = units.reduce((m, u) => Math.max(m, u.unit + 1), 0);
  const graftSets: ButtonGraft["sets"] = Array.from({ length: count }, () => ({ count: 0, first: 0, connected: NO_UNIT }));
  const status: ButtonGraft["status"] = Array.from({ length: statusCount ?? count }, () => [0, 0, 0] as [number, number, number]);
  for (const u of units) {
    if (u.set === -1) graftSets[u.unit] = { count: 0, first: firstNotes.get(u.unit) ?? 0, connected: u.connected };
    else {
      const s = sets.get(u.set);
      if (!s) throw new GraftTextError(`no button set ${u.set}`, u.line);
      graftSets[u.unit] = { count: s.buttons.length, first: s.start, connected: u.connected };
    }
    if (u.status && u.unit < status.length) status[u.unit] = [u.unit, u.status[0], u.status[1]];
  }
  for (const [u, st] of statusNotes) if (u < status.length) status[u] = st;
  return { buttons, sets: graftSets, status };
}
