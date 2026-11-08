/**
 * `scmjs map log <map>`: the map's history in git in plain words — one entry per commit that touched the file, with
 * what that commit changed in the map's terms ("3 triggers added, 1 changed", "resized 64 × 64 → 96 × 96"). Each
 * entry is `map diff` between the commit's version and its parent's, said in a line; every version is read from git
 * once and parsed once (history.ts).
 */
import { existsSync } from "node:fs";
import type { OpenedMap } from "../../src/editor/mapFile";
import type { UnitRecord } from "../../src/formats/chk/sections/objects";
import { fingerprintTrigger, readBriefing, readTriggers } from "../../src/editor/triggers";
import { usedLocations } from "../../src/editor/locations";
import { TILESETS } from "../../src/data/tilesets";
import { diffMaps, unitKey, type Entry, type MapDiff } from "./diff";
import { lcsMatch } from "./merge";
import { blobIds, commitsTouching, locate, short, Versions, when, type GitFile } from "./history";
import { CliError, num, pc, plural, visible } from "./ui";

export type LogState = "added" | "removed" | "changed" | "same" | "unreadable";

export interface LogEntry {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  /** What became of the map in this commit. */
  state: LogState;
  /** What changed, a few words each ("2 units moved, 1 removed"). */
  changes: string[];
  /** Why a version could not be read, for `unreadable`. */
  error?: string;
}

export interface MapLog { file: string; path: string; rev: string; entries: LogEntry[]; more: boolean }

/** "3 triggers added, 1 changed": the noun with the first count, the other counts after it; nothing for all zeros. */
export function counted(one: string, many: string, counts: [number, string][]): string | null {
  const parts = counts.filter(([n]) => n > 0);
  if (!parts.length) return null;
  return parts.map(([n, what], i) => (i === 0 ? `${num(n)} ${n === 1 ? one : many} ${what}` : `${num(n)} ${what}`)).join(", ");
}

/**
 * Added, removed and changed items of two lists matched by key, as `map diff` matches them (a multiset: a trigger
 * that only moved in the list is neither). An added and a removed item in the same place — between the same two
 * items both lists keep — are one item changed. `reordered`: nothing added or removed, but the order is not the same.
 */
export function listCounts(a: readonly string[], b: readonly string[]): { added: number; removed: number; changed: number; reordered: boolean } {
  const left = new Map<string, number>();
  for (const k of a) left.set(k, (left.get(k) ?? 0) + 1);
  let added = 0;
  for (const k of b) { const n = left.get(k) ?? 0; if (n > 0) left.set(k, n - 1); else added++; }
  let removed = 0;
  for (const n of left.values()) removed += n;
  if (!added && !removed) return { added, removed, changed: 0, reordered: a.some((k, i) => k !== b[i]) };
  // Pair them by place: the runs between the items a longest common subsequence keeps.
  const ids = new Map<string, number>();
  const id = (k: string) => { let v = ids.get(k); if (v === undefined) ids.set(k, (v = ids.size)); return v; };
  const m = lcsMatch(a.map(id), b.map(id));
  let paired = 0, i = 0, j = 0;
  while (i < a.length || j < b.length) {
    let gone = 0;
    while (i < a.length && m[i] < 0) { i++; gone++; }
    const next = i < a.length ? m[i] : b.length;
    paired += Math.min(gone, next - j);
    j = next;
    if (i < a.length) { i++; j++; }
  }
  const changed = Math.min(paired, added, removed);
  return { added: added - changed, removed: removed - changed, changed, reordered: false };
}

/** Units added, removed, moved (the same unit, somewhere else) and changed (the same kind and owner, other properties). */
export function unitCounts(a: readonly UnitRecord[], b: readonly UnitRecord[]): { added: number; removed: number; moved: number; changed: number } {
  const left = new Map<string, number>();
  for (const u of a) left.set(unitKey(u), (left.get(unitKey(u)) ?? 0) + 1);
  const added: UnitRecord[] = [];
  for (const u of b) { const k = unitKey(u), n = left.get(k) ?? 0; if (n > 0) left.set(k, n - 1); else added.push(u); }
  const removed: UnitRecord[] = [];
  for (const u of a) { const k = unitKey(u), n = left.get(k) ?? 0; if (n > 0) { left.set(k, n - 1); removed.push(u); } }
  const pair = (key: (u: UnitRecord) => string) => {
    const pool = new Map<string, number>();
    for (const u of removed) pool.set(key(u), (pool.get(key(u)) ?? 0) + 1);
    let n = 0;
    for (let i = added.length - 1; i >= 0; i--) {
      const k = key(added[i]), c = pool.get(k) ?? 0;
      if (c > 0) {
        pool.set(k, c - 1); n++; added.splice(i, 1);
        removed.splice(removed.findIndex((u) => key(u) === k), 1);
      }
    }
    return n;
  };
  const moved = pair((u) => JSON.stringify({ ...u, serial: 0, x: 0, y: 0 }));
  const changed = pair((u) => `${u.unitId}:${u.owner}`);
  return { added: added.length, removed: removed.length, moved, changed };
}

/** Sections no other part of the diff speaks for, in words. */
const SECTION_WORDS: Record<string, string> = {
  MTXM: "terrain", TILE: "terrain", ISOM: "terrain", MASK: "fog of war", DD2: "doodads", THG2: "sprites",
  UNIS: "unit settings", UNIx: "unit settings", UPGS: "upgrade settings", UPGx: "upgrade settings", TECS: "tech settings", TECx: "tech settings",
  PUNI: "unit availability", UPGR: "upgrade availability", PUPx: "upgrade availability", PTEC: "tech availability", PTEx: "tech availability",
  UPRP: "Create Unit with Properties slots", UPUS: "Create Unit with Properties slots", SWNM: "switch names", WAV: "sound list",
  COLR: "player colours", CRGB: "player colours", ERA: "tileset", DIM: "size", STR: "strings", STRx: "strings", TRIG: "triggers", MBRF: "briefing",
};

const sameEntries = (es: Entry[], c: Entry["change"]) => es.filter((e) => e.change === c).length;
const entryCounts = (es: Entry[]): [number, string][] => [[sameEntries(es, "added"), "added"], [sameEntries(es, "changed"), "changed"], [sameEntries(es, "removed"), "removed"]];

/** What changed between two versions of a map, in a few words each. */
export function describeChange(a: OpenedMap, b: OpenedMap, d: MapDiff = diffMaps({ name: "a", doc: a }, { name: "b", doc: b })): string[] {
  const out: string[] = [];
  const said = new Set<string>();
  const add = (s: string | null, ...sections: string[]) => { if (s && !out.includes(s)) out.push(s); if (s) for (const x of sections) said.add(x); };
  const sa = a.scenario, sb = b.scenario;
  for (const f of d.header) {
    if (f.field === "Name") add("name changed", "SPRP", "STR", "STRx");
    else if (f.field === "Description") add("description changed", "SPRP", "STR", "STRx");
    else if (f.field === "Size") add(`resized ${f.a} → ${f.b}`, "DIM", "MTXM", "TILE", "ISOM", "MASK");
    else if (f.field === "Tileset") add(`tileset ${f.a} → ${f.b}`, "ERA");
    else if (f.field === "Version") add(`version ${f.a} → ${f.b}`, "VER", "IVER", "IVE2", "TYPE");
    else if (f.field === "Text encoding") add(`text encoding ${f.a} → ${f.b}`, "STR", "STRx");
  }
  const people = [...d.players, ...d.forces];
  if (people.length === 1) add(`${people[0].field} ${people[0].a || "(none)"} → ${people[0].b || "(none)"}`, "OWNR", "IOWN", "SIDE", "COLR", "FORC", "STR", "STRx");
  else if (people.length) add(`${num(people.length)} player settings changed`, "OWNR", "IOWN", "SIDE", "COLR", "FORC", "STR", "STRx");
  const u = unitCounts(sa.units, sb.units);
  add(counted("unit", "units", [[u.added, "added"], [u.changed, "changed"], [u.moved, "moved"], [u.removed, "removed"]]), "UNIT");
  add(counted("location", "locations", entryCounts(d.locations)), "MRGN", "STR", "STRx");
  for (const [briefing, one, many, section] of [[false, "trigger", "triggers", "TRIG"], [true, "briefing trigger", "briefing triggers", "MBRF"]] as const) {
    const read = briefing ? readBriefing : readTriggers;
    const c = listCounts(read(sa).map(fingerprintTrigger), read(sb).map(fingerprintTrigger));
    add(c.reordered ? `${many} reordered` : counted(one, many, [[c.added, "added"], [c.changed, "changed"], [c.removed, "removed"]]), section);
  }
  // A string that is a name (the map's, a location's, a force's) is said as that thing's change, not twice.
  const names = new Set<number>();
  for (const x of [sa, sb]) {
    names.add(x.nameIndex); names.add(x.descriptionIndex);
    for (const l of x.locations) names.add(l.nameIndex);
    for (const n of x.forces.nameIndex) names.add(n);
  }
  names.delete(0);
  add(counted("string", "strings", entryCounts(d.strings.filter((e) => !names.has(Number(/^\d+/.exec(e.text)?.[0]))))), "STR", "STRx");
  if (d.members.length && d.members.length <= 2) for (const m of d.members) add(`${m.text.replace(/ \(.*\)$/, "")} ${m.change}`);
  else add(counted("file in the archive", "files in the archive", entryCounts(d.members)));
  for (const s of d.sections) {
    const name = s.name.trim();
    if (said.has(name)) continue;
    const words = SECTION_WORDS[name];
    add(words ? `${words} changed` : `${name} section ${s.change}`, name);
  }
  if (!out.length) out.push("saved again; the map is the same");
  return out;
}

/** A version in a few words, for the commit that added the map. */
export function describeMap(doc: OpenedMap): string {
  const s = doc.scenario;
  return [`${s.width} × ${s.height} ${TILESETS[s.era]?.name ?? ""}`.trim(), plural(s.units.length, "unit"), plural(usedLocations(s).length, "location"), plural(readTriggers(s).length, "trigger")].join(", ");
}

/**
 * The entries of `map log`: the commits `git log <rev> -- <map>` lists (a range A..B too), each compared with its
 * first parent's version — the parent git's history simplification names, which holds the same file.
 */
export async function mapLog(file: string, o: { rev?: string; limit?: number } = {}): Promise<MapLog> {
  const f = locate(file);
  const rev = o.rev ?? "HEAD";
  const commits = commitsTouching(f, rev, { limit: o.limit ? o.limit + 1 : undefined });
  if (!commits.length) throw noHistory(f, file, o.rev);
  const more = o.limit !== undefined && commits.length > o.limit;
  if (more) commits.length = o.limit!;
  const specs = commits.flatMap((c) => [`${c.hash}:${f.path}`, c.parents[0] ? `${c.parents[0]}:${f.path}` : ""]);
  const ids = blobIds(f, specs.filter(Boolean));
  const idOf = new Map<string, string | null>(specs.filter(Boolean).map((s, i) => [s, ids[i]]));
  const versions = new Versions(f, 3);
  versions.expect(specs.map((s) => (s ? idOf.get(s) ?? null : null)));
  const entries: LogEntry[] = [];
  for (const c of commits) {
    const own = idOf.get(`${c.hash}:${f.path}`) ?? null;
    const before = c.parents[0] ? idOf.get(`${c.parents[0]}:${f.path}`) ?? null : null;
    const entry: LogEntry = { hash: c.hash, parents: c.parents, author: c.author, email: c.email, date: c.date, subject: c.subject, state: "changed", changes: [] };
    try {
      if (!own) { entry.state = "removed"; entry.changes = ["map removed"]; }
      else if (!before) { entry.state = "added"; entry.changes = [`map added: ${describeMap(await versions.map(own))}`]; }
      else if (own === before) { entry.state = "same"; entry.changes = ["no change to the map"]; }
      else entry.changes = describeChange(await versions.map(before), await versions.map(own));
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      entry.state = "unreadable";
      entry.error = e.message;
      entry.changes = [`this version could not be read: ${e.message.replace(/^.*?is not a map this can read: /, "")}`];
    }
    entries.push(entry);
  }
  return { file, path: f.path, rev, entries, more };
}

/** The error for a file git has nothing on: not committed yet, or not at that revision. */
export function noHistory(f: GitFile, file: string, rev?: string): CliError {
  if (!rev && existsSync(file)) return new CliError(`${f.path} has no history in git: it is not committed`, `git add "${file}" and commit it; its history starts there.`, 2);
  return new CliError(`git has no history of ${f.path}${rev ? ` in ${rev}` : ""}`, "Check the name, and the revision with git log.", 2);
}

/** Words wrapped to `width` columns, the lines after the first indented by `indent`. */
function wrap(parts: string[], indent: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const [i, p] of parts.entries()) {
    const piece = i < parts.length - 1 ? `${p} ·` : p;
    if (line && indent + visible(line).length + 1 + visible(piece).length > width) { lines.push(line); line = piece; }
    else line = line ? `${line} ${piece}` : piece;
  }
  if (line) lines.push(line);
  return lines.map((l) => " ".repeat(indent) + l);
}

export function printLog(log: MapLog, width = process.stdout.columns || 100): string[] {
  const lines: string[] = [pc.dim(`${log.path} · ${plural(log.entries.length, "commit")}${log.rev === "HEAD" ? "" : ` in ${log.rev}`}`)];
  const authorWidth = Math.min(20, Math.max(...log.entries.map((e) => e.author.length)));
  for (const e of log.entries) {
    lines.push("", `${pc.yellow(short(e.hash))}  ${pc.dim(when(e.date))}  ${pc.cyan(e.author.length > authorWidth ? `${e.author.slice(0, authorWidth - 1)}…` : e.author.padEnd(authorWidth))}  ${pc.bold(e.subject)}`);
    const colour = e.state === "unreadable" ? pc.red : e.state === "same" ? pc.dim : (s: string) => s;
    lines.push(...wrap(e.changes.map(colour), 9, Math.max(40, width)));
  }
  if (log.more) lines.push("", pc.dim("… older commits too (-n shows more)"));
  return lines;
}

