/**
 * `scmjs map merge <base> <ours> <theirs>`: two versions of a map that share an ancestor, merged part by part, as git
 * merges text line by line. For each part of the map: what only one side changed is taken from that side, what both
 * changed the same way is taken once, and what both changed differently is merged at a finer grain — terrain by tile,
 * units, doodads and sprites by instance, locations by slot and field, triggers as an ordered list, settings by field —
 * or reported as a conflict. Strings travel with what refers to them, and the merged table is numbered so every
 * reference still reads its own text. Sections nothing in the merge touched are written byte for byte, as the editor's
 * Save writes them.
 *
 * `.claude/internals/cli.md` ("Merging maps") has the design, the matching rules and the traps.
 */
import { MAP_VERSIONS, mapVersionOf, markDirty, MODELLED_SECTIONS, techRestrictionSections, techSettingsSections, unitSettingsSections, upgradeRestrictionSections, upgradeSettingsSections, type Scenario, type SectionName } from "../../src/formats/chk/scenario";
import type { ChkSection } from "../../src/formats/chk/reader";
import type { DoodadRecord, LocationRecord, SpriteRecord, UnitRecord } from "../../src/formats/chk/sections/objects";
import type { ActionRecord, TriggerRecord } from "../../src/formats/chk/sections/triggers";
import { openMapBytes, type OpenedMap } from "../../src/editor/mapFile";
import { triggerNames } from "../../src/editor/triggers";
import { applyStrings, stringCapacity, stringUsages } from "../../src/editor/strings";
import { changeMapVersion, changeTextEncoding } from "../../src/editor/settings";
import { plainText } from "../../src/editor/textColors";
import { summarizeTrigger } from "../../src/formats/triggers/text";
import { actionDef } from "../../src/data/triggerDefs";
import { unitName } from "../../src/data/units";
import { TILESETS } from "../../src/data/tilesets";
import { TEXT_ENCODINGS } from "../../src/formats/text/encoding";
import { spawnSync } from "node:child_process";
import { basename, dirname, relative, resolve } from "node:path";
import { looksLikeChk, type Input } from "./files";
import { writeBack, writeOutput, type Written } from "./exchange";
import { msg, t, translate } from "./i18n";
import { CliError, columns, dot, mark, num, padColumns, pc, table } from "./ui";

export type Side = "ours" | "theirs";

/** Something both sides changed, differently, that the merge could not put together. */
export interface Conflict {
  /** The part of the map: Terrain, Units, Triggers, Locations, Players, … */
  part: string;
  /** Which thing in it. */
  what: string;
  /** What it was in the common ancestor, what each side made of it. */
  base: string | null;
  ours: string;
  theirs: string;
}

/** How many changes each side made to a part (each side against the ancestor). */
export interface PartChanges { part: string; ours: number; theirs: number }

export interface MergeResult {
  /** The merged map: `ours` with theirs's changes put in. */
  doc: OpenedMap;
  conflicts: Conflict[];
  changes: PartChanges[];
  /** Strings of theirs that took another number in the merged table (the one they had held something else of ours's). */
  renumbered: number;
}

/* ── Comparing ───────────────────────────────────────────── */

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const listA = Array.isArray(a) || ArrayBuffer.isView(a), listB = Array.isArray(b) || ArrayBuffer.isView(b);
  if (listA || listB) {
    if (!listA || !listB) return false;
    const x = a as ArrayLike<unknown>, y = b as ArrayLike<unknown>;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && !deepEqual(x[i], y[i])) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

function sameBytes(x: Uint8Array | undefined, y: Uint8Array | undefined): boolean {
  if (!x || !y) return x === y;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

type Pick3 = "none" | "ours" | "theirs" | "both" | "conflict";

/** The three-way rule for one value: one side changed it → that side; both the same way → it; both differently → conflict. */
function pick3<T>(b: T, o: T, t: T, eq: (x: T, y: T) => boolean = deepEqual): { value: T; from: Pick3 } {
  if (eq(o, t)) return { value: o, from: eq(o, b) ? "none" : "both" };
  if (eq(b, o)) return { value: t, from: "theirs" };
  if (eq(b, t)) return { value: o, from: "ours" };
  return { value: o, from: "conflict" };
}

/** How many leaves differ between two values (array items, object fields); a value against null counts once. */
function leavesChanged(a: unknown, b: unknown): number {
  if (deepEqual(a, b)) return 0;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return 1;
  const listA = Array.isArray(a) || ArrayBuffer.isView(a), listB = Array.isArray(b) || ArrayBuffer.isView(b);
  if (listA && listB) {
    const x = a as ArrayLike<unknown>, y = b as ArrayLike<unknown>;
    if (x.length !== y.length) return 1;
    let n = 0;
    for (let i = 0; i < x.length; i++) n += leavesChanged(x[i], y[i]);
    return n;
  }
  if (listA || listB) return 1;
  let n = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) n += leavesChanged((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
  return n;
}

const isList = (v: unknown): v is ArrayLike<unknown> => Array.isArray(v) || ArrayBuffer.isView(v);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !isList(v);

/**
 * A value merged field by field: where one side's change is the whole difference, that side's value; where both
 * changed it, the merge goes down into lists of the same length and objects with the same fields, and a leaf both
 * changed differently is a conflict, settled with `prefer`'s value (ours when there is no rule — nothing is written then).
 */
function mergeValue(b: unknown, o: unknown, t: unknown, path: (string | number)[], conflict: (path: (string | number)[], b: unknown, o: unknown, t: unknown) => void, prefer: Side | null): unknown {
  const p = pick3(b, o, t);
  if (p.from !== "conflict") return p.value;
  if (isList(b) && isList(o) && isList(t) && b.length === o.length && o.length === t.length) {
    const items = Array.from({ length: o.length }, (_, i) => mergeValue(b[i], o[i], t[i], [...path, i], conflict, prefer));
    if (ArrayBuffer.isView(o)) return new (o.constructor as new (items: number[]) => ArrayLike<number>)(items as number[]);
    return items;
  }
  if (isRecord(b) && isRecord(o) && isRecord(t)) {
    const keys = Object.keys(o);
    if (deepEqual(keys, Object.keys(t)) && deepEqual(keys, Object.keys(b))) {
      return Object.fromEntries(keys.map((k) => [k, mergeValue(b[k], o[k], t[k], [...path, k], conflict, prefer)]));
    }
  }
  conflict(path, b, o, t);
  return prefer === "theirs" ? t : o;
}

/* ── Lists in order: triggers ───────────────────────────── */

/** For each item of `a`, the index of the item of `b` it is paired with in a longest common subsequence, or -1. */
export function lcsMatch(a: readonly number[], b: readonly number[], limit = 16_000_000): number[] {
  const m: number[] = Array.from({ length: a.length }, () => -1);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) { m[s] = s; s++; }
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; m[ea] = eb; }
  const n = ea - s, k = eb - s;
  // A middle too large to compare item by item (two lists regenerated whole) is one change.
  if (n === 0 || k === 0 || n * k > limit) return m;
  const w = k + 1;
  const L = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = k - 1; j >= 0; j--) L[i * w + j] = a[s + i] === b[s + j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  let i = 0, j = 0;
  while (i < n && j < k) {
    if (a[s + i] === b[s + j]) { m[s + i] = s + j; i++; j++; } else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) i++; else j++;
  }
  return m;
}

/** How many changes a two-way comparison holds: each run between matched items counts its larger side. */
function listChanges(a: readonly number[], b: readonly number[]): number {
  const m = lcsMatch(a, b);
  let n = 0, i = 0, j = 0;
  while (i < a.length || j < b.length) {
    let del = 0;
    while (i < a.length && m[i] < 0) { i++; del++; }
    const next = i < a.length ? m[i] : b.length;
    n += Math.max(del, next - j);
    j = next;
    if (i < a.length) { i++; j++; }
  }
  return n;
}

export interface Chunk { stable: boolean; b: [number, number]; o: [number, number]; t: [number, number] }

/** diff3's chunks: runs all three share (stable), and between them the stretches where ours or theirs differ from the base. */
export function diff3Chunks(B: readonly number[], O: readonly number[], T: readonly number[]): Chunk[] {
  const mo = lcsMatch(B, O), mt = lcsMatch(B, T);
  const out: Chunk[] = [];
  let i = 0, o = 0, t = 0;
  while (i < B.length || o < O.length || t < T.length) {
    const si = i, so = o, st = t;
    while (i < B.length && mo[i] === o && mt[i] === t) { i++; o++; t++; }
    if (i > si) out.push({ stable: true, b: [si, i], o: [so, o], t: [st, t] });
    if (i >= B.length && o >= O.length && t >= T.length) break;
    let k = i;
    while (k < B.length && (mo[k] < 0 || mt[k] < 0)) k++;
    const oe = k < B.length ? mo[k] : O.length, te = k < B.length ? mt[k] : T.length;
    out.push({ stable: false, b: [i, k], o: [o, oe], t: [t, te] });
    i = k; o = oe; t = te;
  }
  return out;
}

/** Where `sub` sits in `list` as a subsequence (first fit), or null when it is not one. */
function alignSub(sub: readonly number[], list: readonly number[]): number[] | null {
  const at: number[] = [];
  let j = 0;
  for (const x of sub) {
    while (j < list.length && list[j] !== x) j++;
    if (j >= list.length) return null;
    at.push(j++);
  }
  return at;
}

export interface ListItem<T> { item: T; from: Side }
export interface ListConflict<T> { base: T[]; ours: T[]; theirs: T[] }

/**
 * diff3 over three lists by key: a stretch only one side changed is that side's; both the same is taken once; both
 * inserting at one place keeps both (ours first); where both changed one stretch, a finer look — items changed in place
 * on both sides are merged item by item, and one side's insertions go round the other's edits or deletions — before
 * the stretch is a conflict.
 */
export function mergeList<T>(B: readonly T[], O: readonly T[], T_: readonly T[], keys: { b: string[]; o: string[]; t: string[] }, prefer: Side | null): { items: ListItem<T>[]; conflicts: ListConflict<T>[] } {
  const ids = new Map<string, number>();
  const id = (k: string) => { let v = ids.get(k); if (v === undefined) { v = ids.size; ids.set(k, v); } return v; };
  const kb = keys.b.map(id), ko = keys.o.map(id), kt = keys.t.map(id);
  const items: ListItem<T>[] = [];
  const conflicts: ListConflict<T>[] = [];
  const eq = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  const take = (from: Side, list: readonly T[], [s, e]: [number, number]) => { for (let i = s; i < e; i++) items.push({ item: list[i], from }); };
  const clash = (b: [number, number], o: [number, number], t: [number, number]) => {
    conflicts.push({ base: B.slice(...b), ours: O.slice(...o), theirs: T_.slice(...t) });
    if (prefer === "theirs") take("theirs", T_, t); else take("ours", O, o);
  };
  for (const c of diff3Chunks(kb, ko, kt)) {
    if (c.stable) { take("ours", O, c.o); continue; }
    const b = kb.slice(...c.b), o = ko.slice(...c.o), t = kt.slice(...c.t);
    if (eq(o, t)) { take("ours", O, c.o); continue; }
    if (eq(b, o)) { take("theirs", T_, c.t); continue; }
    if (eq(b, t)) { take("ours", O, c.o); continue; }
    if (b.length === 0) {
      // Both inserted here: both are kept, ours first, and what theirs inserted that ours did too only once.
      take("ours", O, c.o);
      const left = new Map<number, number>();
      for (const x of o) left.set(x, (left.get(x) ?? 0) + 1);
      for (let i = c.t[0]; i < c.t[1]; i++) {
        const n = left.get(kt[i]) ?? 0;
        if (n > 0) left.set(kt[i], n - 1); else items.push({ item: T_[i], from: "theirs" });
      }
      continue;
    }
    // Item by item: both changed items in place, the stretch the same length on all three.
    if (b.length === o.length && b.length === t.length) {
      for (let p = 0; p < b.length; p++) {
        const oi = c.o[0] + p, ti = c.t[0] + p, bi = c.b[0] + p;
        if (o[p] === t[p] || t[p] === b[p]) items.push({ item: O[oi], from: "ours" });
        else if (o[p] === b[p]) items.push({ item: T_[ti], from: "theirs" });
        else clash([bi, bi + 1], [oi, oi + 1], [ti, ti + 1]);
      }
      continue;
    }
    // One side only inserted (the base runs through it in order); the other changed items in place or deleted some.
    const finer = (x: Side): ListItem<T>[] | null => {
      const [X, kx, cx, Y, ky, cy] = x === "ours" ? [O, ko, c.o, T_, kt, c.t] as const : [T_, kt, c.t, O, ko, c.o] as const;
      const xs = kx.slice(...cx), ys = ky.slice(...cy);
      const at = alignSub(b, xs);
      if (!at) return null;
      const y: Side = x === "ours" ? "theirs" : "ours";
      const result: ListItem<T>[] = xs.map((_, i) => ({ item: X[cx[0] + i], from: x }));
      if (ys.length === b.length) {
        b.forEach((v, p) => { if (ys[p] !== v) result[at[p]] = { item: Y[cy[0] + p], from: y }; });
        return result;
      }
      const kept = alignSub(ys, b);
      if (!kept) return null;
      const keep = new Set(kept);
      const drop = new Set(at.filter((_, p) => !keep.has(p)));
      return result.filter((_, i) => !drop.has(i));
    };
    const merged = finer("theirs") ?? finer("ours");
    if (merged) { items.push(...merged); continue; }
    clash(c.b, c.o, c.t);
  }
  return { items, conflicts };
}

/* ── Things with no ids: units, doodads, sprites ─────────── */

interface InstanceSpec<T> {
  part: string;
  /** Equal keys are the same thing. */
  key: (x: T) => string;
  /** A removed and an added instance can be one edited only within a group (type and owner). */
  group: (x: T) => string;
  x: (v: T) => number;
  y: (v: T) => number;
  /** Units keep their serial number through an edit in the editor: the first thing an edit is paired by. */
  serial?: (v: T) => number;
  text: (v: T) => string;
}

/** How far apart (in pixels) a removed and an added instance of one group may be and still count as one moved. */
const MOVE_RADIUS = 4 * 32;

type InstanceState = { kind: "kept"; at: number } | { kind: "removed" } | { kind: "edited"; at: number };

/** One side against the base: for each base instance, kept (where), removed, or edited (into which); and what it added. */
function instanceDelta<T>(base: readonly T[], side: readonly T[], spec: InstanceSpec<T>): { state: InstanceState[]; added: number[]; changes: number } {
  const byKey = new Map<string, number[]>();
  side.forEach((v, i) => { const k = spec.key(v); const l = byKey.get(k); if (l) l.push(i); else byKey.set(k, [i]); });
  const state: InstanceState[] = base.map((v) => { const at = byKey.get(spec.key(v))?.shift(); return at === undefined ? { kind: "removed" } : { kind: "kept", at }; });
  const used = new Set(state.flatMap((s) => (s.kind === "kept" ? [s.at] : [])));
  const added = new Set(side.map((_, i) => i).filter((i) => !used.has(i)));
  const removed = base.map((_, i) => i).filter((i) => state[i].kind === "removed");
  let changes = removed.length + added.size;
  const pair = (b: number, a: number) => { state[b] = { kind: "edited", at: a }; added.delete(a); changes--; };
  if (spec.serial) {
    const bySerial = new Map<number, number>();
    for (const a of added) if (!bySerial.has(spec.serial(side[a]))) bySerial.set(spec.serial(side[a]), a);
    for (const b of removed) {
      const a = bySerial.get(spec.serial(base[b]));
      if (a !== undefined && added.has(a) && spec.group(side[a]) === spec.group(base[b])) pair(b, a);
    }
  }
  const pairs: { b: number; a: number; d: number }[] = [];
  for (const b of removed) {
    if (state[b].kind !== "removed") continue;
    for (const a of added) {
      if (spec.group(side[a]) !== spec.group(base[b])) continue;
      const d = Math.hypot(spec.x(side[a]) - spec.x(base[b]), spec.y(side[a]) - spec.y(base[b]));
      if (d <= MOVE_RADIUS) pairs.push({ b, a, d });
    }
  }
  pairs.sort((p, q) => p.d - q.d || p.b - q.b || p.a - q.a);
  for (const { b, a } of pairs) if (state[b].kind === "removed" && added.has(a)) pair(b, a);
  return { state, added: [...added].sort((x, y) => x - y), changes };
}

/**
 * Instances merged as sets against the base: theirs's removals and edits applied to ours's instance where ours left it
 * alone, theirs's additions added (once, when ours added the same); an instance one side removed and the other edited,
 * or both edited differently, is a conflict.
 */
function mergeInstances<T>(base: readonly T[], ours: readonly T[], theirs: readonly T[], spec: InstanceSpec<T>, m: Merging): { entries: { item: T; slot: number | null }[]; changed: boolean } {
  const od = instanceDelta(base, ours, spec), td = instanceDelta(base, theirs, spec);
  m.count(spec.part, od.changes, td.changes);
  // Ours's instances in ours's order (`slot` = where in ours's list), with what theirs did to them; then theirs's additions.
  const slots: ({ item: T; slot: number } | null)[] = ours.map((item, slot) => ({ item, slot }));
  const appended: { item: T; slot: null }[] = [];
  let changed = false;
  const conflict = (b: number, ours: string, theirs: string, apply: () => void) => {
    m.conflict({ part: spec.part, what: spec.text(base[b]), base: spec.text(base[b]), ours, theirs });
    if (m.prefer === "theirs") { apply(); changed = true; }
  };
  base.forEach((_, b) => {
    const tk = td.state[b], o = od.state[b];
    if (tk.kind === "kept") return;
    if (tk.kind === "removed") {
      if (o.kind === "kept") { slots[o.at] = null; changed = true; }
      else if (o.kind === "edited") conflict(b, t("changed to {what}", { what: spec.text(ours[o.at]) }), t("removed"), () => { slots[o.at] = null; });
      return;
    }
    const mine = theirs[tk.at];
    if (o.kind === "kept") { slots[o.at] = { item: mine, slot: o.at }; changed = true; }
    else if (o.kind === "removed") conflict(b, t("removed"), t("changed to {what}", { what: spec.text(mine) }), () => { appended.push({ item: mine, slot: null }); });
    else if (spec.key(ours[o.at]) !== spec.key(mine)) conflict(b, t("changed to {what}", { what: spec.text(ours[o.at]) }), t("changed to {what}", { what: spec.text(mine) }), () => { slots[o.at] = { item: mine, slot: o.at }; });
  });
  const oursAdded = new Map<string, number>();
  for (const a of od.added) { const k = spec.key(ours[a]); oursAdded.set(k, (oursAdded.get(k) ?? 0) + 1); }
  for (const a of td.added) {
    const k = spec.key(theirs[a]), n = oursAdded.get(k) ?? 0;
    if (n > 0) oursAdded.set(k, n - 1);
    else { appended.push({ item: theirs[a], slot: null }); changed = true; }
  }
  return { entries: [...slots.filter((v) => v !== null), ...appended], changed };
}

/* ── The merge ───────────────────────────────────────────── */

/** The state of one merge: the three maps, the one being written (`out`, ours's copy) and what has been found. */
class Merging {
  readonly conflicts: Conflict[] = [];
  readonly counts = new Map<string, { ours: number; theirs: number }>();
  /** String references that came from theirs: their key, theirs's text and the number theirs gave it. */
  readonly foreign = new Map<string, { text: string | null; prefer: number }>();
  /** Actions of theirs's triggers in the merged lists: their text and sound fields still hold theirs's numbers. */
  readonly foreignActions = new Set<ActionRecord>();
  readonly base: Scenario;
  readonly ours: Scenario;
  readonly theirs: Scenario;
  readonly out: Scenario;
  readonly prefer: Side | null;
  constructor(base: Scenario, ours: Scenario, theirs: Scenario, out: Scenario, prefer: Side | null) {
    this.base = base; this.ours = ours; this.theirs = theirs; this.out = out; this.prefer = prefer;
  }
  count(part: string, ours: number, theirs: number) {
    if (!ours && !theirs) return;
    const c = this.counts.get(part) ?? { ours: 0, theirs: 0 };
    c.ours += ours; c.theirs += theirs;
    this.counts.set(part, c);
  }
  conflict(c: Conflict) { this.conflicts.push(c); }
}

/** A string by number, null for none; an empty string is none too (an empty slot the table keeps). */
const text = (scn: Scenario, i: number): string | null => (i > 0 ? scn.strings.strings[i] || null : null);
const show = (s: string | null, max = 60) => { if (s === null) return t("(none)"); const p = plainText(s).replace(/\s+/g, " "); return `"${p.length > max ? `${p.slice(0, max - 1)}…` : p}"`; };
const owner = (o: number) => (o === 11 ? t("Neutral") : o < 8 ? t("Player {n}", { n: o + 1 }) : t("Owner {n}", { n: o }));

/* Header: the revision and the text encoding. */

function mergeHeader(m: Merging) {
  const { base, ours, theirs, out } = m;
  const label = (s: Scenario) => `${translate(MAP_VERSIONS[mapVersionOf(s.fileVersion)].label)}${s.strings.extended ? " (STRx)" : ""}`;
  const rev = (s: Scenario) => `${mapVersionOf(s.fileVersion)}:${s.strings.extended}`;
  const v = pick3(rev(base), rev(ours), rev(theirs), (x, y) => x === y);
  if (v.from === "conflict") m.conflict({ part: "Map", what: t("Revision"), base: label(base), ours: label(ours), theirs: label(theirs) });
  if (v.from === "theirs" || (v.from === "conflict" && m.prefer === "theirs")) changeMapVersion(out, mapVersionOf(theirs.fileVersion), theirs.strings.extended);
  const enc = (s: Scenario) => s.strings.encoding;
  const encLabel = (s: Scenario) => { const l = TEXT_ENCODINGS.find((e) => e.id === s.strings.encoding)?.label; return l ? translate(l) : s.strings.encoding; };
  const e = pick3(enc(base), enc(ours), enc(theirs), (x, y) => x === y);
  if (e.from === "conflict") m.conflict({ part: "Map", what: t("Text encoding"), base: encLabel(base), ours: encLabel(ours), theirs: encLabel(theirs) });
  if (e.from === "theirs" || (e.from === "conflict" && m.prefer === "theirs")) changeTextEncoding(out, theirs.strings.encoding);
  m.count("Map", Number(v.from === "ours" || v.from === "conflict") + Number(e.from === "ours" || e.from === "conflict"), Number(v.from === "theirs" || v.from === "conflict") + Number(e.from === "theirs" || e.from === "conflict"));
}

/* Geometry: size, tileset, terrain, and what stands on it. */

const sizeLabel = (s: Scenario) => `${s.width} × ${s.height} ${TILESETS[s.era & 7] ? translate(TILESETS[s.era & 7].name) : t("tileset {n}", { n: s.era })}`;
const sameFrame = (a: Scenario, b: Scenario) => a.width === b.width && a.height === b.height && a.era === b.era;
const rect = (l: LocationRecord | undefined) => (l ? [l.left, l.top, l.right, l.bottom] : [0, 0, 0, 0]);

/** Whether a side changed anything that sits on the map's grid: size, tileset, terrain, units, doodads, sprites, locations' places. */
function geometryChanged(base: Scenario, side: Scenario): boolean {
  if (!sameFrame(base, side)) return true;
  if (!deepEqual(base.tiles, side.tiles) || !deepEqual(base.editorTiles, side.editorTiles) || !deepEqual(base.isom, side.isom) || !deepEqual(base.mask, side.mask)) return true;
  if (!deepEqual(base.units, side.units) || !deepEqual(base.doodads, side.doodads) || !deepEqual(base.sprites, side.sprites)) return true;
  const n = Math.max(base.locations.length, side.locations.length);
  for (let i = 0; i < n; i++) if (!deepEqual(rect(base.locations[i]), rect(side.locations[i]))) return true;
  return false;
}

/** All of the grid's parts from one side, when the two sides' grids cannot be laid over each other (a resize, a tileset). */
function takeGeometry(m: Merging, from: Scenario) {
  const out = m.out;
  out.width = from.width; out.height = from.height; out.era = from.era;
  out.tiles = from.tiles.slice(); out.editorTiles = from.editorTiles.slice();
  out.isom = from.isom ? from.isom.slice() : null; out.mask = from.mask ? from.mask.slice() : null;
  out.units = from.units.map((u) => ({ ...u })); out.doodads = from.doodads.map((d) => ({ ...d })); out.sprites = from.sprites.map((s) => ({ ...s }));
  markDirty(out, "DIM ", "ERA ", "MTXM", "TILE", "ISOM", "MASK", "UNIT", "DD2 ", "THG2");
}

/** Which side's grid the map takes whole, or null to merge tile by tile and instance by instance. */
function mergeFrame(m: Merging): Side | null {
  const { base, ours, theirs } = m;
  if (sameFrame(ours, theirs) && sameFrame(ours, base)) return null;
  const oc = geometryChanged(base, ours), tc = geometryChanged(base, theirs);
  m.count("Size", Number(!sameFrame(base, ours)), Number(!sameFrame(base, theirs)));
  if (!tc) return "ours";
  if (!oc) { takeGeometry(m, theirs); return "theirs"; }
  if (sameFrame(ours, theirs) && !geometryChanged(ours, theirs)) return "ours";
  m.conflict({ part: "Size", what: t("Size and tileset"), base: sizeLabel(base), ours: t("{size}, with the terrain and units on it", { size: sizeLabel(ours) }), theirs: t("{size}, with the terrain and units on it", { size: sizeLabel(theirs) }) });
  if (m.prefer === "theirs") { takeGeometry(m, theirs); return "theirs"; }
  return "ours";
}

/** Conflicting tiles grouped into rectangles: 8-connected regions, each by its bounding box. */
export function tileRegions(tiles: ReadonlySet<number>, width: number): { x0: number; y0: number; x1: number; y1: number; count: number }[] {
  const seen = new Set<number>();
  const out: { x0: number; y0: number; x1: number; y1: number; count: number }[] = [];
  for (const start of [...tiles].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    const r = { x0: start % width, y0: Math.floor(start / width), x1: start % width, y1: Math.floor(start / width), count: 0 };
    while (queue.length) {
      const i = queue.pop()!;
      const x = i % width, y = Math.floor(i / width);
      r.count++;
      r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x); r.y0 = Math.min(r.y0, y); r.y1 = Math.max(r.y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, j = ny * width + nx;
        if ((dx || dy) && nx >= 0 && nx < width && ny >= 0 && tiles.has(j) && !seen.has(j)) { seen.add(j); queue.push(j); }
      }
    }
    out.push(r);
  }
  return out;
}

/** Terrain tile by tile: MTXM, TILE, MASK by tile, ISOM by lattice value (its conflicts shown at the tiles under them). */
function mergeTerrain(m: Merging) {
  const { base, ours, theirs, out } = m;
  const w = out.width, h = out.height;
  const stride = (Math.floor(w / 2) + 1) * 4;
  const isomTile = (i: number) => Math.min(h - 1, Math.floor(i / stride)) * w + Math.min(w - 1, Math.floor((i % stride) / 4) * 2);
  const arrays: { section: SectionName; get: (s: Scenario) => ArrayLike<number> | null; set: (v: Uint16Array | Uint8Array | null) => void; tile: (i: number) => number }[] = [
    { section: "MTXM", get: (s) => s.tiles, set: (v) => { out.tiles = v as Uint16Array; }, tile: (i) => i },
    { section: "TILE", get: (s) => s.editorTiles, set: (v) => { out.editorTiles = v as Uint16Array; }, tile: (i) => i },
    { section: "MASK", get: (s) => s.mask, set: (v) => { out.mask = v as Uint8Array | null; }, tile: (i) => i },
    { section: "ISOM", get: (s) => s.isom, set: (v) => { out.isom = v as Uint16Array | null; }, tile: isomTile },
  ];
  const clash = new Set<number>(), oursTiles = new Set<number>(), theirsTiles = new Set<number>();
  for (const a of arrays) {
    const B = a.get(base), O = a.get(ours), T = a.get(theirs);
    if (!B || !O || !T || B.length !== O.length || B.length !== T.length) {
      const p = pick3(B, O, T);
      if (p.from === "conflict") m.conflict({ part: "Terrain", what: t("the {what, select, ISOM {isometric record} MASK {fog of war} other {tiles}} ({section})", { what: a.section.trim(), section: a.section.trim() }), base: B ? t("present") : t("none"), ours: O ? t("changed") : t("removed"), theirs: T ? t("changed differently") : t("removed") });
      if (p.from === "theirs" || (p.from === "conflict" && m.prefer === "theirs")) { a.set(T ? (T as Uint16Array | Uint8Array).slice() : null); markDirty(out, a.section); }
      continue;
    }
    let next: Uint16Array | Uint8Array | null = null;
    for (let i = 0; i < B.length; i++) {
      const b = B[i], o = O[i], t = T[i];
      if (o !== b) oursTiles.add(a.tile(i));
      if (t === b) continue;
      theirsTiles.add(a.tile(i));
      if (o === t) continue;
      if (o !== b) { clash.add(a.tile(i)); if (m.prefer !== "theirs") continue; }
      next ??= (O as Uint16Array | Uint8Array).slice();
      next[i] = t;
    }
    if (next) { a.set(next); markDirty(out, a.section); }
  }
  m.count("Terrain", oursTiles.size, theirsTiles.size);
  for (const r of tileRegions(clash, w)) {
    m.conflict({ part: "Terrain", what: t("{n, plural, one {# tile} other {# tiles}} at {at}", { n: r.count, at: `${r.x0},${r.y0}${r.x1 !== r.x0 || r.y1 !== r.y0 ? `–${r.x1},${r.y1}` : ""}` }), base: null, ours: t("changed these tiles"), theirs: t("changed them differently") });
  }
}

export const unitKey = (u: UnitRecord) => JSON.stringify({ ...u, serial: 0 });
const unitText = (u: UnitRecord) => (u.resourceAmount
  ? t("{unit} ({owner}) at {x},{y}, {amount} resources", { unit: unitName(u.unitId), owner: owner(u.owner), x: u.x, y: u.y, amount: num(u.resourceAmount) })
  : t("{unit} ({owner}) at {x},{y}", { unit: unitName(u.unitId), owner: owner(u.owner), x: u.x, y: u.y }));

const UNIT_SPEC: InstanceSpec<UnitRecord> = {
  part: "Units", key: unitKey, group: (u) => `${u.unitId}:${u.owner}`, x: (u) => u.x, y: (u) => u.y, serial: (u) => u.serial, text: unitText,
};
const DOODAD_SPEC: InstanceSpec<DoodadRecord> = {
  part: "Doodads", key: (d) => JSON.stringify(d), group: (d) => String(d.doodadId), x: (d) => d.x, y: (d) => d.y, text: (d) => t("doodad {id} at {x},{y}", { id: d.doodadId, x: d.x, y: d.y }),
};
const SPRITE_SPEC: InstanceSpec<SpriteRecord> = {
  part: "Sprites", key: (s) => JSON.stringify(s), group: (s) => `${s.spriteId}:${s.flags}`, x: (s) => s.x, y: (s) => s.y, text: (s) => t("sprite {id} at {x},{y}", { id: s.spriteId, x: s.x, y: s.y }),
};

function mergeObjects(m: Merging) {
  const { base, ours, theirs, out } = m;
  const units = mergeInstances(base.units, ours.units, theirs.units, UNIT_SPEC, m);
  if (units.changed) {
    // A unit in one of ours's places keeps ours's serial (an edit from theirs included); one theirs added keeps its own
    // unless that is taken, and a link between two units theirs added (an add-on, a nydus exit) follows a new number.
    const list = units.entries.map((e) => ({ ...e.item, serial: e.slot === null ? e.item.serial : ours.units[e.slot].serial }));
    const taken = new Set(units.entries.flatMap((e, i) => (e.slot === null ? [] : [list[i].serial])));
    let next = Math.max(0, ...list.map((u) => u.serial));
    const renumber = new Map<number, number>();
    const fresh = units.entries.flatMap((e, i) => (e.slot === null ? [i] : []));
    for (const i of fresh) {
      if (taken.has(list[i].serial)) { renumber.set(list[i].serial, ++next); list[i].serial = next; }
      taken.add(list[i].serial);
    }
    for (const i of fresh) { const r = renumber.get(list[i].relatedSerial); if (r !== undefined && list[i].relatedSerial) list[i].relatedSerial = r; }
    out.units = list;
    markDirty(out, "UNIT");
  }
  const doodads = mergeInstances(base.doodads, ours.doodads, theirs.doodads, DOODAD_SPEC, m);
  if (doodads.changed) { out.doodads = doodads.entries.map((e) => ({ ...e.item })); markDirty(out, "DD2 "); }
  const sprites = mergeInstances(base.sprites, ours.sprites, theirs.sprites, SPRITE_SPEC, m);
  if (sprites.changed) { out.sprites = sprites.entries.map((e) => ({ ...e.item })); markDirty(out, "THG2"); }
}

/* Locations: by slot, each field (place, elevation flags, name) on its own. */

function mergeLocations(m: Merging, frame: Side | null) {
  const { base, ours, theirs, out } = m;
  const blank: LocationRecord = { left: 0, top: 0, right: 0, bottom: 0, nameIndex: 0, elevationFlags: 0 };
  const at = (s: Scenario, i: number) => s.locations[i] ?? blank;
  const name = (s: Scenario, i: number) => text(s, at(s, i).nameIndex);
  const label = (i: number) => { const n = name(base, i) ?? name(ours, i) ?? name(theirs, i); return n ? t("{name} (slot {slot})", { name: show(n), slot: i }) : t("slot {slot}", { slot: i }); };
  const place = (l: number[]) => (l.every((v) => v === 0) ? t("(not placed)") : `${l[0]},${l[1]}–${l[2]},${l[3]}`);
  let changed = false, oc = 0, tc = 0;
  for (let i = 0; i < out.locations.length; i++) {
    const b = at(base, i), o = at(ours, i), t = at(theirs, i);
    const r = frame ? { value: rect(frame === "theirs" ? t : o), from: "none" as Pick3 } : pick3(rect(b), rect(o), rect(t));
    const f = pick3(b.elevationFlags, o.elevationFlags, t.elevationFlags);
    const n = pick3(name(base, i), name(ours, i), name(theirs, i));
    for (const [p, what, fmt] of [[r, msg("{location} place"), (s: LocationRecord) => place(rect(s))], [f, msg("{location} elevation flags"), (s: LocationRecord) => String(s.elevationFlags)], [n, msg("{location} name"), (s: LocationRecord, scn: Scenario) => show(text(scn, s.nameIndex))]] as const) {
      if (p.from === "ours" || p.from === "conflict") oc++;
      if (p.from === "theirs" || p.from === "conflict") tc++;
      if (p.from === "conflict") m.conflict({ part: "Locations", what: translate(what, { location: label(i) }), base: fmt(b, base), ours: fmt(o, ours), theirs: fmt(t, theirs) });
    }
    const theirsWins = (p: { from: Pick3 }) => p.from === "theirs" || (p.from === "conflict" && m.prefer === "theirs");
    const nextRect = theirsWins(r) ? rect(t) : frame ? r.value : rect(o);
    const flags = theirsWins(f) ? t.elevationFlags : o.elevationFlags;
    let nameIndex = o.nameIndex;
    if (theirsWins(n)) { nameIndex = t.nameIndex; m.foreign.set(`location:${i}`, { text: n.from === "conflict" ? name(theirs, i) : n.value, prefer: t.nameIndex }); }
    const next: LocationRecord = { left: nextRect[0], top: nextRect[1], right: nextRect[2], bottom: nextRect[3], elevationFlags: flags, nameIndex };
    if (!deepEqual(next, o)) { out.locations[i] = next; changed = true; }
  }
  m.count("Locations", oc, tc);
  if (changed) markDirty(out, "MRGN");
}

/* Triggers and the briefing: an ordered list, each trigger matched by its content with its strings read as text. */

function stringFields(a: ActionRecord, briefing: boolean): ("text" | "wav")[] {
  const out: ("text" | "wav")[] = [];
  for (const arg of actionDef(a.type, briefing)?.args ?? []) if (arg.kind === "text" || arg.kind === "wav") out.push(arg.field as "text" | "wav");
  return out;
}

/**
 * A trigger as the merge compares it: the whole record, with each text and sound field read as its text — two maps
 * number their strings differently, and the same trigger must match. Locations stay by number: the text form names
 * them, and a location renamed on one side would otherwise change every trigger that mentions it.
 */
export function triggerKey(t: TriggerRecord, scn: Scenario, briefing: boolean): string {
  return JSON.stringify({
    c: t.conditions, f: t.flags, p: t.players, x: t.currentAction,
    a: t.actions.map((a) => { const r: Record<string, unknown> = { ...a }; for (const f of stringFields(a, briefing)) r[f] = text(scn, a[f]); return r; }),
  });
}

/** A trigger on one line, whole (`printMerge` cuts it to the terminal around where the sides differ). */
const triggerText = (t: TriggerRecord, scn: Scenario, briefing: boolean) => {
  const s = summarizeTrigger(t, triggerNames(scn), briefing);
  return `${s.players}: ${s.conditions || "always"} → ${s.actions || "nothing"}`;
};

/** A line cut to `width` characters, the window placed so that character `at` (where the versions part) shows. */
export function around(line: string, at: number, width = 100): string {
  if (line.length <= width) return line;
  const start = Math.max(0, Math.min(at - Math.floor(width / 3), line.length - width + 1));
  const end = start + width - (start > 0 ? 2 : 1);
  return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
}

function mergeTriggers(m: Merging, briefing: boolean) {
  const { base, ours, theirs, out } = m;
  const list = (s: Scenario) => (briefing ? s.briefing : s.triggers);
  const keys = (s: Scenario) => list(s).map((t) => triggerKey(t, s, briefing));
  const k = { b: keys(base), o: keys(ours), t: keys(theirs) };
  const part = briefing ? "Briefing" : "Triggers";
  const ids = new Map<string, number>();
  const id = (x: string) => { let v = ids.get(x); if (v === undefined) { v = ids.size; ids.set(x, v); } return v; };
  m.count(part, listChanges(k.b.map(id), k.o.map(id)), listChanges(k.b.map(id), k.t.map(id)));
  if (deepEqual(k.b, k.t)) return;
  const r = mergeList(list(base), list(ours), list(theirs), k, m.prefer);
  const many = (ts: TriggerRecord[], s: Scenario) => (ts.length ? ts.map((x) => triggerText(x, s, briefing)).join("\n") : t("(none)"));
  for (const c of r.conflicts) {
    const first = list(base).indexOf(c.base[0]) + 1;
    const where = c.base.length === 1 ? t("trigger {first} of the base", { first }) : c.base.length ? t("{n} triggers {first}–{last} of the base", { n: c.base.length, first, last: first + c.base.length - 1 }) : t("triggers added at the same place");
    m.conflict({ part, what: where, base: c.base.length ? many(c.base, base) : null, ours: many(c.ours, ours), theirs: many(c.theirs, theirs) });
  }
  const next = r.items.map((it) => {
    if (it.from === "ours") return it.item;
    const copy: TriggerRecord = { ...it.item, conditions: it.item.conditions.map((c) => ({ ...c })), actions: it.item.actions.map((a) => ({ ...a })), players: it.item.players.slice() };
    for (const a of copy.actions) m.foreignActions.add(a);
    return copy;
  });
  const same = next.length === list(ours).length && next.every((t, i) => t === list(ours)[i]);
  if (same) return;
  if (briefing) { out.briefing = next; markDirty(out, "MBRF"); } else { out.triggers = next; markDirty(out, "TRIG"); }
}

/* Settings: each table field by field, with string references read as text. */

interface SettingsView {
  name: string | null;
  description: string | null;
  playerTypes: number[];
  editorPlayerTypes: number[] | null;
  playerRaces: number[];
  playerColors: number[];
  playerRgb: Scenario["playerRgb"];
  forces: { playerForce: number[]; flags: number[]; names: (string | null)[] };
  unitSettings: Record<string, unknown> | null;
  unitAvailability: Scenario["unitAvailability"];
  upgradeSettings: Scenario["upgradeSettings"];
  upgradeRestrictions: Scenario["upgradeRestrictions"];
  techSettings: Scenario["techSettings"];
  techRestrictions: Scenario["techRestrictions"];
  cuwp: Scenario["cuwp"];
  cuwpUsed: Scenario["cuwpUsed"];
  switchNames: (string | null)[] | null;
  wavs: (string | null)[] | null;
}

function settingsView(s: Scenario): SettingsView {
  const names = (list: ArrayLike<number> | null) => (list ? Array.from(list, (i) => text(s, i)) : null);
  let unitSettings: Record<string, unknown> | null = null;
  if (s.unitSettings) { const { nameIndex, ...rest } = s.unitSettings; unitSettings = { ...rest, names: names(nameIndex) }; }
  return {
    name: text(s, s.nameIndex), description: text(s, s.descriptionIndex),
    playerTypes: s.playerTypes, editorPlayerTypes: s.editorPlayerTypes, playerRaces: s.playerRaces, playerColors: s.playerColors, playerRgb: s.playerRgb,
    forces: { playerForce: s.forces.playerForce, flags: s.forces.flags, names: names(s.forces.nameIndex)! },
    unitSettings, unitAvailability: s.unitAvailability, upgradeSettings: s.upgradeSettings, upgradeRestrictions: s.upgradeRestrictions,
    techSettings: s.techSettings, techRestrictions: s.techRestrictions, cuwp: s.cuwp, cuwpUsed: s.cuwpUsed,
    switchNames: names(s.switchNames), wavs: names(s.wavs),
  };
}

const SETTINGS_PART: Record<keyof SettingsView, string> = {
  name: "Map", description: "Map",
  playerTypes: "Players", editorPlayerTypes: "Players", playerRaces: "Players", playerColors: "Players", playerRgb: "Players", forces: "Forces",
  unitSettings: "Unit settings", unitAvailability: "Unit settings", upgradeSettings: "Upgrades", upgradeRestrictions: "Upgrades",
  techSettings: "Technologies", techRestrictions: "Technologies", cuwp: "Unit properties", cuwpUsed: "Unit properties", switchNames: "Switches", wavs: "Sounds",
};

/** A settings field in words: `Player 3 race`, `Marine hitPoints`, `Force 1 name`. */
function describe(path: (string | number)[]): string {
  const [root, a, b] = path;
  const slot = (i: unknown) => (typeof i === "number" ? ` ${i + 1}` : "");
  switch (root) {
    case "name": return t("Name");
    case "description": return t("Description");
    case "playerTypes": case "editorPlayerTypes": return root === "playerTypes" ? t("Player{n} type", { n: slot(a) }) : t("Player{n} type (StarEdit's copy)", { n: slot(a) });
    case "playerRaces": return t("Player{n} race", { n: slot(a) });
    case "playerColors": return t("Player{n} colour", { n: slot(a) });
    case "playerRgb": return t("Player{n} Remastered colour", { n: typeof b === "number" ? ` ${b + 1}` : "" });
    case "forces": return a === "playerForce" ? t("Player{n} force", { n: slot(b) }) : a === "names" ? t("Force{n} name", { n: slot(b) }) : t("Force{n} flags", { n: slot(b) });
    case "unitSettings": return typeof b === "number" && !String(a).startsWith("weapon") ? (a === "names" ? t("{unit} name", { unit: unitName(b) }) : `${unitName(b)} ${a}`) : `${a}${typeof b === "number" ? ` ${b}` : ""}`;
    case "switchNames": return t("Switch{n} name", { n: slot(a) });
    case "wavs": return t("Sound slot {n}", { n: String(a) });
    case "cuwp": case "cuwpUsed": return typeof b === "string" ? `${t("Slot{n}", { n: slot(a) })} ${b}` : root === "cuwpUsed" ? t("Slot{n} in use", { n: slot(a) }) : t("Slot{n}", { n: slot(a) });
    default: return path.slice(1).map((p) => (typeof p === "number" ? `[${p}]` : p)).join(" ").replace(/ \[/g, "[") || String(root);
  }
}

const valueText = (v: unknown): string => {
  if (v === null || v === undefined) return t("(none)");
  if (typeof v === "string") return show(v);
  if (typeof v !== "object") return String(v);
  const j = JSON.stringify(ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v);
  return j.length > 60 ? `${j.slice(0, 59)}…` : j;
};

/** Mark a revision pair's sections: those the file has, or its revision needs (the editor's rule). */
function markPair(out: Scenario, sections: (scn: Scenario) => SectionName[]) {
  const names = sections(out);
  if (names.length) markDirty(out, ...names);
}

function mergeSettings(m: Merging) {
  const { base, ours, theirs, out } = m;
  const vb = settingsView(base), vo = settingsView(ours), vt = settingsView(theirs);
  const have = (name: string) => out.chk.sections.some((s) => s.name === name);
  for (const key of Object.keys(vo) as (keyof SettingsView)[]) {
    const part = SETTINGS_PART[key];
    m.count(part, leavesChanged(vb[key], vo[key]), leavesChanged(vb[key], vt[key]));
    if (deepEqual(vb[key], vt[key]) || deepEqual(vo[key], vt[key])) continue;
    const merged = mergeValue(vb[key], vo[key], vt[key], [key], (path, b, o, t) => m.conflict({ part, what: describe(path), base: valueText(b), ours: valueText(o), theirs: valueText(t) }), m.prefer);
    if (deepEqual(merged, vo[key])) continue;
    // A string reference that is not ours's text came from theirs: theirs's number for now, and the text it must read.
    const names = (got: (string | null)[], mine: ArrayLike<number> | null, yours: ArrayLike<number> | null, prefix: string): number[] =>
      got.map((s, i) => {
        if (s === text(ours, mine?.[i] ?? 0)) return mine?.[i] ?? 0;
        m.foreign.set(`${prefix}:${i}`, { text: s, prefer: yours?.[i] ?? 0 });
        return yours?.[i] ?? 0;
      });
    switch (key) {
      case "name": case "description": {
        const field = key === "name" ? "nameIndex" : "descriptionIndex";
        m.foreign.set(key, { text: merged as string | null, prefer: theirs[field] });
        out[field] = theirs[field];
        markDirty(out, "SPRP");
        break;
      }
      case "playerTypes": out.playerTypes = (merged as number[]).slice(); markDirty(out, "OWNR"); if (have("IOWN") && !out.editorPlayerTypes) markDirty(out, "IOWN"); break;
      case "editorPlayerTypes": out.editorPlayerTypes = merged ? (merged as number[]).slice() : null; markDirty(out, "IOWN"); break;
      case "playerRaces": out.playerRaces = (merged as number[]).slice(); markDirty(out, "SIDE"); break;
      case "playerColors": out.playerColors = (merged as number[]).slice(); if (have("COLR") || out.fileVersion >= 205) markDirty(out, "COLR"); break;
      case "playerRgb": out.playerRgb = merged as Scenario["playerRgb"]; markDirty(out, "CRGB"); break;
      case "forces": {
        const f = merged as SettingsView["forces"];
        out.forces = { playerForce: f.playerForce.slice(), flags: f.flags.slice(), nameIndex: names(f.names, ours.forces.nameIndex, theirs.forces.nameIndex, "force") };
        markDirty(out, "FORC");
        break;
      }
      case "unitSettings": {
        if (!merged) out.unitSettings = null;
        else {
          const { names: got, ...rest } = merged as { names: (string | null)[] } & Record<string, unknown>;
          out.unitSettings = { ...(rest as unknown as NonNullable<Scenario["unitSettings"]>), nameIndex: Uint16Array.from(names(got, ours.unitSettings?.nameIndex ?? null, theirs.unitSettings?.nameIndex ?? null, "unit")) };
        }
        markPair(out, unitSettingsSections);
        break;
      }
      case "unitAvailability": out.unitAvailability = merged as Scenario["unitAvailability"]; markDirty(out, "PUNI"); break;
      case "upgradeSettings": out.upgradeSettings = merged as Scenario["upgradeSettings"]; markPair(out, upgradeSettingsSections); break;
      case "upgradeRestrictions": out.upgradeRestrictions = merged as Scenario["upgradeRestrictions"]; markPair(out, upgradeRestrictionSections); break;
      case "techSettings": out.techSettings = merged as Scenario["techSettings"]; markPair(out, techSettingsSections); break;
      case "techRestrictions": out.techRestrictions = merged as Scenario["techRestrictions"]; markPair(out, techRestrictionSections); break;
      case "cuwp": out.cuwp = merged as Scenario["cuwp"]; markDirty(out, "UPRP"); break;
      case "cuwpUsed": out.cuwpUsed = merged as Scenario["cuwpUsed"]; markDirty(out, "UPUS"); break;
      case "switchNames": out.switchNames = merged ? names(merged as (string | null)[], ours.switchNames, theirs.switchNames, "switch") : null; markDirty(out, "SWNM"); break;
      case "wavs": out.wavs = merged ? names(merged as (string | null)[], ours.wavs, theirs.wavs, "wav") : null; markDirty(out, "WAV "); break;
    }
  }
}

/* Strings: every reference read as text, and the merged table numbered so each still reads its own. */

interface StringSite { key: string; get: () => number; set: (i: number) => void; foreign: { text: string | null; prefer: number } | null }

function stringSites(m: Merging): StringSite[] {
  const out = m.out;
  const sites: StringSite[] = [];
  const add = (key: string, mark: () => void, get: () => number, put: (i: number) => void, foreign = m.foreign.get(key) ?? null) =>
    sites.push({ key, get, set: (i) => { if (get() !== i) { put(i); mark(); } }, foreign });
  add("name", () => markDirty(out, "SPRP"), () => out.nameIndex, (i) => { out.nameIndex = i; });
  add("description", () => markDirty(out, "SPRP"), () => out.descriptionIndex, (i) => { out.descriptionIndex = i; });
  out.forces.nameIndex.forEach((_, i) => add(`force:${i}`, () => markDirty(out, "FORC"), () => out.forces.nameIndex[i], (v) => { out.forces.nameIndex[i] = v; }));
  out.locations.forEach((_, i) => add(`location:${i}`, () => markDirty(out, "MRGN"), () => out.locations[i].nameIndex, (v) => { out.locations[i].nameIndex = v; }));
  const us = out.unitSettings;
  if (us) us.nameIndex.forEach((_, i) => add(`unit:${i}`, () => markPair(out, unitSettingsSections), () => us.nameIndex[i], (v) => { us.nameIndex[i] = v; }));
  const sw = out.switchNames;
  if (sw) sw.forEach((_, i) => add(`switch:${i}`, () => markDirty(out, "SWNM"), () => sw[i], (v) => { sw[i] = v; }));
  const wavs = out.wavs;
  if (wavs) wavs.forEach((_, i) => add(`wav:${i}`, () => markDirty(out, "WAV "), () => wavs[i], (v) => { wavs[i] = v; }));
  for (const [list, briefing] of [[out.triggers, false], [out.briefing, true]] as const) {
    list.forEach((t, ti) => t.actions.forEach((a, ai) => {
      for (const f of stringFields(a, briefing)) {
        const foreign = m.foreignActions.has(a) ? { text: text(m.theirs, a[f]), prefer: a[f] } : null;
        add(`${briefing ? "briefing" : "trigger"}:${ti}:${ai}:${f}`, () => markDirty(out, briefing ? "MBRF" : "TRIG"), () => a[f], (v) => { a[f] = v; }, foreign);
      }
    }));
  }
  return sites;
}

/**
 * Number the merged map's strings. Ours's references keep their numbers (the table starts as ours's). One of theirs
 * keeps its number where ours's table has the same text there, or where that number is free to take — empty, or held
 * by a string of ours that only what theirs replaced referred to (an edit in place); else it shares a slot already
 * holding the same text; else it takes the lowest empty slot no version refers to (Blizzard's maps carry all 1024 STR
 * slots, mostly empty), else a new one at the end. Strings no version refers to are then merged by number.
 */
function mergeStrings(m: Merging): number {
  const { base, ours, theirs, out } = m;
  const table = out.strings.strings.slice();
  const capacity = stringCapacity(out);
  const refs = (s: Scenario) => new Set(stringUsages(s).keys());
  const baseRefs = refs(base), oursRefs = refs(ours), theirsRefs = refs(theirs);
  const sites = stringSites(m);
  const claimed = new Map<number, string | null>();
  for (const s of sites) if (!s.foreign && s.get() > 0) claimed.set(s.get(), table[s.get()] ?? null);
  let free = 1;
  /** A number for a string with no place of its own: the lowest empty slot nothing refers to, else the end. */
  const place = (want: string): number => {
    for (; free < table.length && free <= capacity; free++) {
      if (!table[free] && !claimed.has(free) && !baseRefs.has(free) && !oursRefs.has(free) && !theirsRefs.has(free)) { table[free] = want; return free++; }
    }
    table.push(want);
    return table.length - 1;
  };
  let renumbered = 0;
  for (const s of sites) {
    if (!s.foreign) continue;
    const { text: want, prefer } = s.foreign;
    let at: number;
    if (!want) at = prefer > 0 && !table[prefer] ? prefer : 0;
    else if (prefer > 0 && table[prefer] === want) at = prefer;
    else if (prefer > 0 && prefer <= capacity && !claimed.has(prefer) && (prefer >= table.length || !table[prefer] || oursRefs.has(prefer))) {
      while (table.length <= prefer) table.push(null);
      table[prefer] = want;
      at = prefer;
    } else {
      at = table.indexOf(want, 1);
      if (at < 1) at = place(want);
    }
    if (at !== prefer) renumbered++;
    if (at > 0) claimed.set(at, want);
    s.set(at);
  }
  // Strings no version refers to: by number, as a table. A clash keeps ours's in place and theirs's in a free slot.
  const n = Math.max(base.strings.strings.length, ours.strings.strings.length, theirs.strings.strings.length);
  for (let i = 1; i < n; i++) {
    const b = text(base, i), o = text(ours, i), t = text(theirs, i);
    if (b === t || theirsRefs.has(i)) continue;
    const mine = !claimed.has(i) && !oursRefs.has(i) && o === b;
    if (baseRefs.has(i) && t === null) { if (mine) table[i] = null; continue; }
    if (mine) { while (table.length <= i) table.push(null); table[i] = t; claimed.set(i, t); continue; }
    if (t !== null && !table.includes(t)) claimed.set(place(t), t);
  }
  // Only a table the merge made longer than the limit is refused (ours's own may be over it already: the editor lets it).
  if (table.length - 1 > Math.max(capacity, out.strings.strings.length - 1)) throw new CliError(t("The merged map needs {n} strings, and its string table holds {capacity}", { n: num(table.length - 1), capacity: num(capacity) }), t("Prune the strings nothing refers to on one side (scmjs map strings prune), then merge again."));
  applyStrings(out, table, stringUsages(out));
  return renumbered;
}

/* The archive's other members, and the sections nothing models. */

function mergeMembers(m: Merging, base: OpenedMap, ours: OpenedMap, theirs: OpenedMap, out: OpenedMap) {
  const norm = (name: string) => name.replace(/\//g, "\\").toLowerCase();
  const index = (d: OpenedMap) => new Map([...d.extras].map(([k, v]) => [norm(k), { name: k, bytes: v }]));
  const b = index(base), o = index(ours), th = index(theirs);
  const sz = (x: { bytes: Uint8Array } | undefined) => (x ? t("{n} bytes", { n: num(x.bytes.length) }) : t("removed"));
  let oc = 0, tc = 0;
  for (const key of new Set([...b.keys(), ...o.keys(), ...th.keys()])) {
    const p = pick3(b.get(key)?.bytes, o.get(key)?.bytes, th.get(key)?.bytes, sameBytes);
    if (p.from === "ours" || p.from === "conflict") oc++;
    if (p.from === "theirs" || p.from === "conflict") tc++;
    const name = (o.get(key) ?? th.get(key) ?? b.get(key))!.name;
    if (p.from === "conflict") m.conflict({ part: "Archive members", what: name, base: b.has(key) ? sz(b.get(key)) : null, ours: sz(o.get(key)), theirs: sz(th.get(key)) });
    if (!(p.from === "theirs" || (p.from === "conflict" && m.prefer === "theirs"))) continue;
    const mine = o.get(key);
    if (mine) out.extras.delete(mine.name);
    const yours = th.get(key);
    if (yours) out.extras.set(mine?.name ?? yours.name, yours.bytes);
  }
  m.count("Archive members", oc, tc);
}

function mergeRawSections(m: Merging) {
  const { base, ours, theirs, out } = m;
  const all = (s: Scenario) => s.chk.sections.filter((x) => !MODELLED_SECTIONS.has(x.name));
  const names = new Set([...all(base), ...all(ours), ...all(theirs)].map((s) => s.name));
  const of = (s: Scenario, name: string) => s.chk.sections.filter((x) => x.name === name);
  const same = (x: ChkSection[], y: ChkSection[]) => x.length === y.length && x.every((s, i) => sameBytes(s.data, y[i].data) && s.declaredSize === y[i].declaredSize);
  let oc = 0, tc = 0;
  for (const name of names) {
    const p = pick3(of(base, name), of(ours, name), of(theirs, name), same);
    if (p.from === "ours" || p.from === "conflict") oc++;
    if (p.from === "theirs" || p.from === "conflict") tc++;
    const bytes = (l: ChkSection[]) => (l.length ? t("{n} bytes", { n: num(l.reduce((n, s) => n + s.data.length, 0)) }) : t("removed"));
    if (p.from === "conflict") m.conflict({ part: "Sections", what: t("{section} (not modelled: compared as bytes)", { section: name.trim() }), base: of(base, name).length ? bytes(of(base, name)) : null, ours: bytes(of(ours, name)), theirs: bytes(of(theirs, name)) });
    if (!(p.from === "theirs" || (p.from === "conflict" && m.prefer === "theirs"))) continue;
    // Theirs's copies take the place of ours's first one; with none of ours's, they go where theirs had them, after the section before.
    const sections = out.chk.sections;
    const first = sections.findIndex((s) => s.name === name);
    const rest = sections.filter((s) => s.name !== name);
    let at = first >= 0 ? sections.slice(0, first).filter((s) => s.name !== name).length : rest.length;
    if (first < 0) {
      const mine = theirs.chk.sections.findIndex((s) => s.name === name);
      const before = mine > 0 ? theirs.chk.sections[mine - 1].name : null;
      const there = before ? rest.findIndex((s) => s.name === before) : -1;
      at = there >= 0 ? there + 1 : mine === 0 ? 0 : rest.length;
    }
    rest.splice(at, 0, ...of(theirs, name).map((s) => ({ ...s, data: s.data.slice() })));
    out.chk = { ...out.chk, sections: rest };
  }
  m.count("Sections", oc, tc);
}

// The parts are identities (the JSON's `part`) and stay English; they are shown through `translate`.
const PART_ORDER = [msg("Map"), msg("Size"), msg("Terrain"), msg("Doodads"), msg("Sprites"), msg("Units"), msg("Locations"), msg("Triggers"), msg("Briefing"), msg("Players"), msg("Forces"), msg("Unit settings"), msg("Upgrades"), msg("Technologies"), msg("Unit properties"), msg("Switches"), msg("Sounds"), msg("Strings"), msg("Archive members"), msg("Sections")];

/**
 * The merge of three opened maps. `out` is a second opening of ours: it is changed in place and is the result (ours's
 * three-way partners are read, never written). With `prefer`, each conflict is settled with that side's version;
 * without, conflicts are listed and the result is ours's version of each — not to be written.
 */
export function mergeDocs(base: OpenedMap, ours: OpenedMap, theirs: OpenedMap, out: OpenedMap, prefer: Side | null = null): MergeResult {
  const m = new Merging(base.scenario, ours.scenario, theirs.scenario, out.scenario, prefer);
  mergeHeader(m);
  const frame = mergeFrame(m);
  if (frame === null) { mergeTerrain(m); mergeObjects(m); }
  mergeLocations(m, frame);
  mergeTriggers(m, false);
  mergeTriggers(m, true);
  mergeSettings(m);
  mergeMembers(m, base, ours, theirs, out);
  mergeRawSections(m);
  const renumbered = mergeStrings(m);
  const changes = [...m.counts].map(([part, c]) => ({ part, ...c })).sort((a, b) => PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part));
  return { doc: out, conflicts: m.conflicts, changes, renumbered };
}

/* ── The command ─────────────────────────────────────────── */

export interface MergeOptions {
  /** Settle each conflict with this side's version. */
  prefer?: Side | null;
  /** The map's name in what is said, and its form when the files' names have none (git's `%P`). */
  name?: string | null;
  /** Where to write; over ours when not given. */
  out?: string | null;
  /** Say what would merge, write nothing. */
  dryRun?: boolean;
  /** The three are git's stages of a conflicted file (`map merge <map>`), for the hint. */
  staged?: boolean;
}

export interface MergeOutcome {
  /** The map, as named for messages. */
  name: string;
  base: string;
  ours: string;
  theirs: string;
  /**
   * same: ours and theirs are the same file. ours / theirs: only that side changed the map, so it is taken whole, byte
   * for byte. merged: part by part.
   */
  kind: "same" | "ours" | "theirs" | "merged";
  conflicts: Conflict[];
  /** The side conflicts were settled with, when there were conflicts and a rule. */
  settled: Side | null;
  changes: PartChanges[];
  renumbered: number;
  /** Where the merged map went; null when nothing was written (conflicts, `--dry-run`, or nothing to change). */
  written: Written | null;
  /** How to settle the conflicts, in the words of where they came from. */
  hint: string | null;
}

/**
 * Merge three inputs and write the result (over ours unless `out`). Byte-identical shortcuts first, as git takes them:
 * the same file on both sides, or one side unchanged, needs no opening and keeps the file exactly. Conflicts without a
 * rule write nothing.
 */
export async function runMerge(inputs: { base: Input; ours: Input; theirs: Input }, o: MergeOptions = {}): Promise<MergeOutcome> {
  const { base, ours, theirs } = inputs;
  const name = o.name ?? (o.staged ? ours.path : ours.name);
  const target = o.out ?? ours.path;
  const outcome: MergeOutcome = {
    name, base: base.name, ours: ours.name, theirs: theirs.name, kind: "merged", conflicts: [], settled: null, changes: [], renumbered: 0, written: null,
    hint: null,
  };
  const whole = async (bytes: Uint8Array) => {
    // Ours is the result already, unless the file is git's working copy (which may hold something else by now).
    if (o.dryRun || (target === ours.path && bytes === ours.bytes && !o.staged)) return;
    const w = await writeOutput(bytes, target);
    outcome.written = o.name && target === ours.path ? { ...w, path: o.name } : w;
  };
  if (sameBytes(ours.bytes, theirs.bytes)) { outcome.kind = "same"; await whole(ours.bytes); return outcome; }
  if (sameBytes(base.bytes, theirs.bytes)) { outcome.kind = "ours"; await whole(ours.bytes); return outcome; }
  if (sameBytes(base.bytes, ours.bytes)) { outcome.kind = "theirs"; await whole(theirs.bytes); return outcome; }

  const open = async (input: Input) => {
    try {
      return await openMapBytes(input.bytes, input.name);
    } catch (e) {
      throw new CliError(t("{name} is not a map this can read: {error}", { name: input.name, error: e instanceof Error ? e.message : String(e) }));
    }
  };
  const [b, x, th, out] = await Promise.all([open(base), open(ours), open(theirs), open(ours)]);
  const r = mergeDocs(b, x, th, out, o.prefer ?? null);
  outcome.conflicts = r.conflicts;
  outcome.changes = r.changes;
  outcome.renumbered = r.renumbered;
  if (r.conflicts.length && !o.prefer) {
    outcome.hint = o.staged || o.name
      ? t("scmjs map merge {name} --ours (or --theirs) settles each with that side's version; then git add {name}", { name: quote(name) })
      : t("Add --ours or --theirs to settle each with that side's version.");
    return outcome;
  }
  if (r.conflicts.length) outcome.settled = o.prefer ?? null;
  // Written in ours's form (the extension of the name given, else ours's), compressed as ours was.
  out.fileName = o.name ? basename(o.name) : ours.name;
  if (!o.dryRun) outcome.written = await writeBack(out, o.name && !/\.(scx|scm|chk)$/i.test(ours.path) ? o.name : ours.path, target);
  // git's driver writes over its temporary copy of ours: the map is what to name.
  if (outcome.written && o.name && target === ours.path) outcome.written = { ...outcome.written, path: o.name };
  return outcome;
}

const quote = (p: string) => (/^[\w./@+-]+$/.test(p) ? p : `"${p}"`);

/**
 * The three versions git holds for a file it could not merge (`git merge` stopped on it): stage 1 the common ancestor,
 * 2 ours, 3 theirs, read with `git show :n:<path>`.
 */
export function stagedInputs(file: string): { base: Input; ours: Input; theirs: Input } {
  const git = (args: string[]) => spawnSync("git", args, { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 });
  const top = git(["-C", dirname(resolve(file)), "rev-parse", "--show-toplevel"]);
  if (top.error) throw new CliError(t("git is not installed, or not on PATH"), t("With one map, scmjs map merge reads the three versions git keeps during a merge."), 2);
  if (top.status !== 0) throw new CliError(t("{file} is not in a git repository", { file }), t("Give the three maps: scmjs map merge <base> <ours> <theirs>."), 2);
  const root = top.stdout.toString().trim();
  const path = relative(root, resolve(file)).split("\\").join("/");
  const stage = (n: number, what: string): Input => {
    const shown = git(["-C", root, "show", `:${n}:${path}`]);
    if (shown.status !== 0) throw new CliError(t("git has no {what} of {path}: is it in a merge that stopped on it?", { what: translate(what), path }), `${t("git status lists the files a merge left unmerged;")} ${shown.stderr.toString().trim().split("\n")[0] || ""}`.trim(), 2);
    const bytes = new Uint8Array(shown.stdout);
    return { path: n === 2 ? file : `:${n}:${path}`, name: `${translate(what)} (${basename(file)})`, bytes, kind: "map" };
  };
  return { base: stage(1, msg("common ancestor")), ours: stage(2, msg("our version")), theirs: stage(3, msg("their version")) };
}

/** A map read for the merge: by its bytes, since git's temporary files have no extension. */
export function asMap(input: Input): Input {
  if (input.kind === "map" || (input.kind === null && looksLikeChk(input.bytes))) return { ...input, kind: "map" };
  throw new CliError(t("{name} is not a map", { name: input.name }), t("scmjs map merge takes three versions of one map: .scm, .scx or .chk."), 2);
}

/** The outcome as lines: one line saying what happened, the parts each side changed, the conflicts. */
export function printMerge(r: MergeOutcome): string[] {
  const where = r.written ? `${dot}${t("written to {path}", { path: r.written.path === "-" ? t("standard output") : pc.cyan(r.written.path) })}` : "";
  const name = pc.bold(r.name);
  if (r.kind === "same") return [`${mark.ok} ${name}: ${t("both sides made the same changes")}${where}`];
  if (r.kind === "ours") return [`${mark.ok} ${name}: ${t("only ours changed it since the common ancestor, so it is ours")}${where}`];
  if (r.kind === "theirs") return [`${mark.ok} ${name}: ${t("only theirs changed it since the common ancestor, so it is theirs")}${where}`];
  const lines: string[] = [];
  const nOurs = r.changes.reduce((n, c) => n + c.ours, 0), nTheirs = r.changes.reduce((n, c) => n + c.theirs, 0);
  const counts = t("{n, plural, one {# change} other {# changes}} from ours, {theirs} from theirs", { n: nOurs, theirs: num(nTheirs) });
  if (r.conflicts.length && !r.settled) lines.push(`${mark.error} ${name}: ${t("{n, plural, one {# conflict} other {# conflicts}}; nothing written", { n: r.conflicts.length })}`);
  else if (r.conflicts.length) lines.push(`${mark.warn} ${t("{name} merged, {n, plural, one {# conflict} other {# conflicts}} settled as {side}:", { name, n: r.conflicts.length, side: r.settled === "ours" ? t("ours") : t("theirs") })} ${counts}${where}`);
  else lines.push(`${mark.ok} ${t("{name} merged:", { name })} ${counts}${where}`);
  const parts = r.changes.filter((c) => c.ours || c.theirs).map((c) => [translate(c.part), [c.ours && t("{n} from ours", { n: num(c.ours) }), c.theirs && t("{n} from theirs", { n: num(c.theirs) })].filter(Boolean).join(", ")]);
  if (r.renumbered) parts.push([translate("Strings"), t("{n, plural, one {# string} other {# strings}} of theirs renumbered", { n: r.renumbered })]);
  if (parts.length) lines.push(...table(parts.map(([p, d]) => [p, pc.dim(d)]), 2));
  if (r.conflicts.length) {
    lines.push("", pc.bold(r.settled ? t("Settled") : t("Conflicts")));
    const shown = r.conflicts.slice(0, 40);
    for (const c of shown) {
      lines.push(`  ${pc.yellow(translate(c.part))}${dot}${c.what}`);
      // Where ours and theirs first part, so a long trigger is cut to show the difference rather than its start.
      let at = 0;
      while (at < c.ours.length && c.ours[at] === c.theirs[at]) at++;
      const labels = { base: t("base"), ours: t("ours"), theirs: t("theirs") };
      const w = Math.max(6, ...Object.values(labels).map(columns));
      const side = (label: string, v: string, colour: (s: string) => string, chosen: boolean) => v.split("\n").map((l, i) => `      ${i ? " ".repeat(w + 1) : `${padColumns(label, w)} `}${colour(around(l, at))}${chosen && i === 0 ? pc.dim(` ${t("(taken)")}`) : ""}`);
      if (c.base !== null) lines.push(...side(labels.base, c.base, pc.dim, false));
      lines.push(...side(labels.ours, c.ours, pc.red, r.settled === "ours"), ...side(labels.theirs, c.theirs, pc.green, r.settled === "theirs"));
    }
    if (r.conflicts.length > shown.length) lines.push(pc.dim(`  ${t("… and {n} more (--json lists them all)", { n: num(r.conflicts.length - shown.length) })}`));
    if (r.hint) lines.push("", pc.dim(r.hint));
  }
  return lines;
}
