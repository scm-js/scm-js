/**
 * `scmjs map diff a.scx b.scx`: what changed between two maps, in the map maker's terms — the header, players,
 * units, locations, triggers, strings, the archive's other members — and, underneath, which scenario sections
 * differ at all. Exits 1 when the maps differ, like diff(1), so a script can ask "did this change anything?".
 */
import { MAP_VERSIONS, mapVersionOf, scenarioDescription, scenarioName, serializeScenario, type Scenario } from "../../src/formats/chk/scenario";
import { parseChk } from "../../src/formats/chk/reader";
import type { TriggerRecord } from "../../src/formats/chk/sections/triggers";
import type { UnitRecord } from "../../src/formats/chk/sections/objects";
import type { OpenedMap } from "../../src/editor/mapFile";
import { fingerprintTrigger, readBriefing, readTriggers, triggerNames } from "../../src/editor/triggers";
import { summarizeTrigger } from "../../src/formats/triggers/text";
import { forceName } from "../../src/editor/settings";
import { locationName } from "../../src/editor/locations";
import { plainText } from "../../src/editor/textColors";
import { TILESETS } from "../../src/data/tilesets";
import { playerRaceLabel, playerTypeLabel } from "../../src/data/players";
import { unitName } from "../../src/data/units";
import { TEXT_ENCODINGS } from "../../src/formats/text/encoding";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { kindOf, type Input } from "./files";
import { locate } from "./history";
import { CliError, mark, num, pc, plural, size } from "./ui";

export type Change = "added" | "removed" | "changed";

export interface FieldChange { field: string; a: string; b: string }
export interface Entry { change: Change; text: string; a?: string; b?: string }
export interface SectionChange { name: string; change: Change; a: number; b: number }

export interface MapDiff {
  a: string;
  b: string;
  same: boolean;
  header: FieldChange[];
  players: FieldChange[];
  forces: FieldChange[];
  units: Entry[];
  locations: Entry[];
  triggers: Entry[];
  briefing: Entry[];
  strings: Entry[];
  members: Entry[];
  sections: SectionChange[];
}

const field = (field: string, a: string, b: string): FieldChange | null => (a === b ? null : { field, a, b });

function header(a: Scenario, b: Scenario): FieldChange[] {
  const enc = (s: Scenario) => TEXT_ENCODINGS.find((e) => e.id === s.strings.encoding)?.label ?? s.strings.encoding;
  return [
    field("Name", plainText(scenarioName(a) ?? ""), plainText(scenarioName(b) ?? "")),
    field("Description", plainText(scenarioDescription(a) ?? ""), plainText(scenarioDescription(b) ?? "")),
    field("Size", `${a.width} × ${a.height}`, `${b.width} × ${b.height}`),
    field("Tileset", TILESETS[a.era]?.name ?? String(a.era), TILESETS[b.era]?.name ?? String(b.era)),
    field("Version", MAP_VERSIONS[mapVersionOf(a.fileVersion)].label, MAP_VERSIONS[mapVersionOf(b.fileVersion)].label),
    field("Text encoding", enc(a), enc(b)),
    field("Strings", `${a.strings.strings.length - 1}${a.strings.extended ? " (extended)" : ""}`, `${b.strings.strings.length - 1}${b.strings.extended ? " (extended)" : ""}`),
  ].filter((f): f is FieldChange => f !== null);
}

function players(a: Scenario, b: Scenario): FieldChange[] {
  const out: FieldChange[] = [];
  for (let slot = 0; slot < 8; slot++) {
    const who = `Player ${slot + 1}`;
    for (const f of [
      field(`${who} type`, playerTypeLabel(a.playerTypes[slot] ?? 0), playerTypeLabel(b.playerTypes[slot] ?? 0)),
      field(`${who} race`, playerRaceLabel(a.playerRaces[slot] ?? 0), playerRaceLabel(b.playerRaces[slot] ?? 0)),
      field(`${who} colour`, String(a.playerColors[slot] ?? 0), String(b.playerColors[slot] ?? 0)),
      field(`${who} force`, String((a.forces.playerForce[slot] ?? 0) + 1), String((b.forces.playerForce[slot] ?? 0) + 1)),
    ]) if (f) out.push(f);
  }
  return out;
}

function forces(a: Scenario, b: Scenario): FieldChange[] {
  const out: FieldChange[] = [];
  for (let i = 0; i < 4; i++) {
    const f = field(`Force ${i + 1}`, plainText(forceName(a, i)), plainText(forceName(b, i)));
    if (f) out.push(f);
    const g = field(`Force ${i + 1} flags`, String(a.forces.flags[i] ?? 0), String(b.forces.flags[i] ?? 0));
    if (g) out.push(g);
  }
  return out;
}

/** Added and removed items of two lists, matched by a key; the same key on both sides is no change. */
function multiset<T>(as: readonly T[], bs: readonly T[], key: (t: T) => string, text: (t: T, side: Scenario) => string, sa: Scenario, sb: Scenario): Entry[] {
  const count = new Map<string, number>();
  for (const x of as) count.set(key(x), (count.get(key(x)) ?? 0) + 1);
  const added: T[] = [];
  for (const y of bs) {
    const k = key(y), n = count.get(k) ?? 0;
    if (n > 0) count.set(k, n - 1); else added.push(y);
  }
  const removed: T[] = [];
  for (const x of as) {
    const k = key(x), n = count.get(k) ?? 0;
    if (n > 0) { count.set(k, n - 1); removed.push(x); }
  }
  return [...removed.map((x) => ({ change: "removed" as const, text: text(x, sa) })), ...added.map((y) => ({ change: "added" as const, text: text(y, sb) }))];
}

const owner = (o: number) => (o === 11 ? "Neutral" : o < 8 ? `Player ${o + 1}` : `Owner ${o}`);
/** A unit as `map diff` matches it: the whole record but its serial number. */
export const unitKey = (u: UnitRecord) => JSON.stringify({ ...u, serial: 0 });
const unitText = (u: UnitRecord) => `${unitName(u.unitId)} (${owner(u.owner)}) at ${u.x},${u.y}${u.resourceAmount ? `, ${u.resourceAmount.toLocaleString("en-US")} resources` : ""}`;

const locationText = (s: Scenario, i: number) => { const l = s.locations[i]; return `${plainText(locationName(s, i))} ${l.left},${l.top}–${l.right},${l.bottom}${l.elevationFlags ? ` flags ${l.elevationFlags}` : ""}`; };

/** Locations by slot: placed on one side only (added, removed), or on both with another name, place or flags (changed). */
export function locationChanges(a: Scenario, b: Scenario): { index: number; change: Change }[] {
  const out: { index: number; change: Change }[] = [];
  const n = Math.max(a.locations.length, b.locations.length);
  const placed = (s: Scenario, i: number) => { const l = s.locations[i]; return !!l && (l.left !== l.right || l.top !== l.bottom); };
  for (let i = 0; i < n; i++) {
    const pa = placed(a, i), pb = placed(b, i);
    if (!pa && !pb) continue;
    if (pa && !pb) out.push({ index: i, change: "removed" });
    else if (!pa && pb) out.push({ index: i, change: "added" });
    else if (locationText(a, i) !== locationText(b, i)) out.push({ index: i, change: "changed" });
  }
  return out;
}

function locations(a: Scenario, b: Scenario): Entry[] {
  return locationChanges(a, b).map(({ index: i, change }) =>
    change === "changed" ? { change, text: `${i}`, a: locationText(a, i), b: locationText(b, i) } : { change, text: `${i}: ${locationText(change === "removed" ? a : b, i)}` });
}

function triggers(a: Scenario, b: Scenario, briefing: boolean): Entry[] {
  const list = (s: Scenario) => (briefing ? readBriefing(s) : readTriggers(s));
  const text = (t: TriggerRecord, s: Scenario) => {
    const sum = summarizeTrigger(t, triggerNames(s), briefing);
    const line = `${sum.players}: ${sum.conditions || "always"} → ${sum.actions || "nothing"}`;
    return line.length > 110 ? `${line.slice(0, 107)}…` : line;
  };
  return multiset(list(a), list(b), fingerprintTrigger, text, a, b);
}

function strings(a: Scenario, b: Scenario): Entry[] {
  const out: Entry[] = [];
  const n = Math.max(a.strings.strings.length, b.strings.strings.length);
  const show = (s: string) => { const p = plainText(s).replace(/\s+/g, " "); return p.length > 70 ? `${p.slice(0, 67)}…` : p; };
  // An unset slot and an empty one are the same thing: a gap the table keeps so the numbers after it hold.
  const at = (s: Scenario, i: number) => s.strings.strings[i] || null;
  for (let i = 1; i < n; i++) {
    const sa = at(a, i), sb = at(b, i);
    if (sa === sb) continue;
    if (sa !== null && sb === null) out.push({ change: "removed", text: `${i}: ${show(sa)}` });
    else if (sa === null && sb !== null) out.push({ change: "added", text: `${i}: ${show(sb)}` });
    else out.push({ change: "changed", text: `${i}`, a: show(sa!), b: show(sb!) });
  }
  return out;
}

function members(a: OpenedMap, b: OpenedMap): Entry[] {
  const norm = (name: string) => name.replace(/\//g, "\\").toLowerCase();
  const ma = new Map([...a.extras].map(([k, v]) => [norm(k), { name: k, bytes: v }]));
  const mb = new Map([...b.extras].map(([k, v]) => [norm(k), { name: k, bytes: v }]));
  const out: Entry[] = [];
  for (const [k, x] of ma) {
    const y = mb.get(k);
    if (!y) out.push({ change: "removed", text: `${x.name} (${size(x.bytes.length)})` });
    else if (!same(x.bytes, y.bytes)) out.push({ change: "changed", text: x.name, a: size(x.bytes.length), b: size(y.bytes.length) });
  }
  for (const [k, y] of mb) if (!ma.has(k)) out.push({ change: "added", text: `${y.name} (${size(y.bytes.length)})` });
  return out;
}

function same(x: Uint8Array, y: Uint8Array): boolean {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** Section bytes by name as they would be written (an edit re-encodes its section), repeats joined in order. */
function sections(a: Scenario, b: Scenario): SectionChange[] {
  const gather = (s: Scenario) => {
    const by = new Map<string, Uint8Array[]>();
    for (const sec of parseChk(serializeScenario(s)).sections) by.set(sec.name, [...(by.get(sec.name) ?? []), sec.data]);
    return new Map([...by].map(([name, parts]) => { const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { all.set(p, at); at += p.length; } return [name, all]; }));
  };
  const sa = gather(a), sb = gather(b);
  const out: SectionChange[] = [];
  for (const [name, x] of sa) {
    const y = sb.get(name);
    if (!y) out.push({ name, change: "removed", a: x.length, b: 0 });
    else if (!same(x, y)) out.push({ name, change: "changed", a: x.length, b: y.length });
  }
  for (const [name, y] of sb) if (!sa.has(name)) out.push({ name, change: "added", a: 0, b: y.length });
  return out;
}

export function diffMaps(a: { name: string; doc: OpenedMap }, b: { name: string; doc: OpenedMap }): MapDiff {
  const sa = a.doc.scenario, sb = b.doc.scenario;
  const d: MapDiff = {
    a: a.name, b: b.name, same: false,
    header: header(sa, sb), players: players(sa, sb), forces: forces(sa, sb),
    units: multiset(sa.units, sb.units, unitKey, unitText, sa, sb),
    locations: locations(sa, sb),
    triggers: triggers(sa, sb, false), briefing: triggers(sa, sb, true),
    strings: strings(sa, sb), members: members(a.doc, b.doc), sections: sections(sa, sb),
  };
  d.same = [d.header, d.players, d.forces, d.units, d.locations, d.triggers, d.briefing, d.strings, d.members, d.sections].every((l) => l.length === 0);
  return d;
}

const sign = { added: pc.green("+"), removed: pc.red("−"), changed: pc.yellow("~") };

/** The diff as lines: each group that has something, long lists cut unless `all`. */
export function printDiff(d: MapDiff, all = false): string[] {
  const lines: string[] = [`${pc.bold(d.a)} ${pc.dim("→")} ${pc.bold(d.b)}`];
  if (d.same) return [...lines, `${mark.ok} The maps are the same`];
  const limit = all ? Infinity : 20;
  const group = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push("", pc.bold(title));
    for (const l of items.slice(0, limit)) lines.push(`  ${l}`);
    if (items.length > limit) lines.push(pc.dim(`  … and ${num(items.length - limit)} more (--all lists them)`));
  };
  const fields = (fs: FieldChange[]) => fs.map((f) => `${sign.changed} ${f.field.padEnd(14)} ${pc.red(f.a || pc.dim("(none)"))} ${pc.dim("→")} ${pc.green(f.b || pc.dim("(none)"))}`);
  const entries = (es: Entry[]) => es.map((e) => (e.change === "changed" ? `${sign.changed} ${e.text}  ${pc.red(e.a ?? "")} ${pc.dim("→")} ${pc.green(e.b ?? "")}` : `${sign[e.change]} ${e.text}`));
  group("Map", fields(d.header));
  group("Players", fields([...d.players, ...d.forces]));
  group(`Units ${pc.dim(counts(d.units))}`, entries(d.units));
  group(`Locations ${pc.dim(counts(d.locations))}`, entries(d.locations));
  group(`Triggers ${pc.dim(counts(d.triggers))}`, entries(d.triggers));
  group(`Briefing ${pc.dim(counts(d.briefing))}`, entries(d.briefing));
  group(`Strings ${pc.dim(counts(d.strings))}`, entries(d.strings));
  group("Archive members", entries(d.members));
  group("Sections", d.sections.map((s) => `${sign[s.change]} ${s.name.padEnd(4)}  ${s.change === "changed" ? `${size(s.a)} ${pc.dim("→")} ${size(s.b)}` : size(s.change === "added" ? s.b : s.a)}`));
  return lines;
}

function counts(es: Entry[]): string {
  const n = (c: Change) => es.filter((e) => e.change === c).length;
  return [n("added") && `+${n("added")}`, n("removed") && `−${n("removed")}`, n("changed") && `~${n("changed")}`].filter(Boolean).join(" ");
}

/**
 * The map as it was at a git revision (`--rev HEAD~1`): `git show <rev>:<path from the repository's root>`, read as
 * an Input named `<rev>:<file>`. A path outside a repository, a revision that is not one, or a file the revision
 * does not have is refused with git's own words.
 */
export function revisionInput(rev: string, file: string): Input {
  const f = locate(file);
  if (!rev || rev.startsWith("-")) throw new CliError(`${rev || "An empty revision"} is not a revision`, "A commit, branch or tag: HEAD~1, main, v1.0.", 2);
  const shown = spawnSync("git", ["-C", f.root, "show", `${rev}:${f.path}`], { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 });
  if (shown.status !== 0) throw new CliError(`git has no ${f.path} at ${rev}`, shown.stderr.toString().trim().split("\n")[0] || null, 2);
  const bytes = new Uint8Array(shown.stdout);
  const name = `${rev}:${basename(file)}`;
  return { path: name, name, bytes, kind: kindOf(file, bytes) };
}

/** The change in a few words: "3 units added, 1 string changed". */
export function summarizeDiff(d: MapDiff): string {
  const parts: string[] = [];
  const list = (name: string, es: { change: string }[]) => {
    const n = (c: string) => es.filter((e) => e.change === c).length;
    if (n("added")) parts.push(`${plural(n("added"), name)} added`);
    if (n("removed")) parts.push(`${plural(n("removed"), name)} removed`);
    if (n("changed")) parts.push(`${plural(n("changed"), name)} changed`);
  };
  const fields = d.header.length + d.players.length + d.forces.length;
  if (fields) parts.push(`${plural(fields, "setting")} changed`);
  list("unit", d.units); list("location", d.locations); list("trigger", d.triggers); list("briefing trigger", d.briefing); list("string", d.strings); list("file", d.members);
  if (!parts.length && d.sections.length) parts.push(`${plural(d.sections.length, "section")} changed`);
  return parts.join(", ");
}
