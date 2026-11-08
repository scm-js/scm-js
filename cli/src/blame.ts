/**
 * `scmjs map blame <map>`: like `git blame`, but per thing in the map rather than per line — for each trigger,
 * location, string, group of units and setting, the commit that last changed it.
 *
 * Items are matched between versions as `map diff` matches them: triggers and units by what they are (a trigger that
 * only moved in the list is the same trigger), locations and strings by their number, settings by name. The walk is
 * git blame's: start with every item of the newest version unexplained, go through the commits that touched the file
 * newest first (each before its parents), hand each item to the first parent that has it unchanged, and an item no
 * parent has was changed by that commit. It stops when nothing is left to explain, so the oldest versions of a long
 * history are not read at all.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import type { OpenedMap } from "../../src/editor/mapFile";
import { scenarioDescription, scenarioName, MAP_VERSIONS, mapVersionOf } from "../../src/formats/chk/scenario";
import { fingerprintTrigger, readTriggers, triggerNames } from "../../src/editor/triggers";
import { triggersToText } from "../../src/editor/exchange";
import { summarizeTrigger } from "../../src/formats/triggers/text";
import { forceName } from "../../src/editor/settings";
import { locationName, usedLocations } from "../../src/editor/locations";
import { plainText } from "../../src/editor/textColors";
import { TILESETS } from "../../src/data/tilesets";
import { playerRaceLabel, playerTypeLabel, PLAYER_COLORS } from "../../src/data/players";
import { unitName } from "../../src/data/units";
import { TEXT_ENCODINGS } from "../../src/formats/text/encoding";
import { unitKey } from "./diff";
import { sectionBytes } from "./dump";
import { kindOf, loadMapInput } from "./files";
import { blobIds, commitsTouching, locate, short, Versions, type Commit } from "./history";
import { noHistory } from "./maplog";
import { msg, t, translate } from "./i18n";
import { CliError, columns, padColumns, pc, size } from "./ui";

export const BLAME_KINDS = ["settings", "units", "locations", "triggers", "strings"] as const;
export type BlameKind = (typeof BLAME_KINDS)[number];

/**
 * One thing in a version of the map. Two items are the same thing in two versions when `id` and `content` both
 * agree; `label` and `text` are what the table shows.
 */
export interface Item { id: string; content: string; label: string; text: string }
type Snapshot = Partial<Record<BlameKind, Item[]>>;

const sha1 = (s: string | Uint8Array) => createHash("sha1").update(s).digest("hex");
const owner = (o: number) => (o === 11 ? t("Neutral") : o < 8 ? t("Player {n}", { n: o + 1 }) : t("Owner {n}", { n: o }));
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** `shown`: the text too — only the version blamed needs it, and a trigger's summary is the costly part. */
function triggerItems(doc: OpenedMap, shown: boolean): Item[] {
  const names = triggerNames(doc.scenario);
  return readTriggers(doc.scenario).map((trig, i) => {
    const key = fingerprintTrigger(trig);
    if (!shown) return { id: key, content: key, label: `${i + 1}`, text: "" };
    // The trigger's summary is the text trigger form's words, English in every language.
    const sum = summarizeTrigger(trig, names);
    return { id: key, content: key, label: `${i + 1}`, text: `${sum.players}: ${sum.conditions || "always"} → ${sum.actions || "nothing"}` };
  });
}

function locationItems(doc: OpenedMap): Item[] {
  const s = doc.scenario;
  return usedLocations(s).map((i) => {
    const l = s.locations[i];
    const name = plainText(locationName(s, i));
    const where = `${l.left},${l.top}–${l.right},${l.bottom}${l.elevationFlags ? ` flags ${l.elevationFlags}` : ""}`;
    return { id: `${i}`, content: `${name}\n${where}`, label: name, text: `#${i}  ${where}` };
  });
}

function stringItems(doc: OpenedMap): Item[] {
  const out: Item[] = [];
  const table = doc.scenario.strings.strings;
  // An empty slot is a gap the table keeps, not a string (map diff's rule).
  for (let i = 1; i < table.length; i++) if (table[i]) out.push({ id: `${i}`, content: table[i]!, label: `${i}`, text: plainText(table[i]!).replace(/\s+/g, " ") });
  return out;
}

/** Units by kind and owner: a group changed when one of its units was added, removed, moved or edited. */
function unitItems(doc: OpenedMap): Item[] {
  const groups = new Map<string, { unitId: number; owner: number; keys: string[] }>();
  for (const u of doc.scenario.units) {
    const k = `${u.unitId}:${u.owner}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { unitId: u.unitId, owner: u.owner, keys: [] }));
    g.keys.push(unitKey(u));
  }
  return [...groups].sort(([, a], [, b]) => a.owner - b.owner || a.unitId - b.unitId)
    .map(([k, g]) => ({ id: k, content: sha1(g.keys.sort().join("\n")), label: `${unitName(g.unitId)} · ${owner(g.owner)}`, text: `× ${g.keys.length}` }));
}

/** The sections settings live in, under the name the editor's windows give them (shown through `translate`). */
const SETTING_SECTIONS: [string, string[]][] = [
  [msg("Terrain"), ["MTXM", "TILE", "ISOM"]], [msg("Doodads"), ["DD2"]], [msg("Sprites"), ["THG2"]], [msg("Fog of war"), ["MASK"]],
  [msg("Unit settings"), ["UNIS", "UNIx"]], [msg("Upgrade settings"), ["UPGS", "UPGx"]], [msg("Tech settings"), ["TECS", "TECx"]],
  [msg("Unit availability"), ["PUNI"]], [msg("Upgrade availability"), ["UPGR", "PUPx"]], [msg("Tech availability"), ["PTEC", "PTEx"]],
  [msg("Switch names"), ["SWNM"]], [msg("Sound list"), ["WAV"]],
];

function settingItems(doc: OpenedMap): Item[] {
  const s = doc.scenario;
  const out: Item[] = [];
  // `id` is the English label (what matches the item between versions); `label` is it in the reader's language.
  const add = (id: string, label: string, text: string, content = text) => out.push({ id, content, label, text });
  add("Name", t("Name"), plainText(scenarioName(s) ?? ""));
  add("Description", t("Description"), plainText(scenarioDescription(s) ?? "").replace(/\s+/g, " "));
  add("Size", t("Size"), `${s.width} × ${s.height}`);
  add("Tileset", t("Tileset"), translate(TILESETS[s.era]?.name ?? String(s.era)));
  add("Version", t("Version"), translate(MAP_VERSIONS[mapVersionOf(s.fileVersion)].label));
  add("Text encoding", t("Text encoding"), translate(TEXT_ENCODINGS.find((e) => e.id === s.strings.encoding)?.label ?? s.strings.encoding));
  for (let i = 0; i < 8; i++) {
    const colour = translate(PLAYER_COLORS[s.playerColors[i] ?? 0]?.name ?? String(s.playerColors[i] ?? 0));
    add(`Player ${i + 1}`, t("Player {n}", { n: i + 1 }), t("{type}, {race}, {colour}, force {force}", { type: translate(playerTypeLabel(s.playerTypes[i] ?? 0)), race: translate(playerRaceLabel(s.playerRaces[i] ?? 0)), colour, force: (s.forces.playerForce[i] ?? 0) + 1 }));
  }
  for (let i = 0; i < 4; i++) add(`Force ${i + 1}`, t("Force {n}", { n: i + 1 }), `${plainText(forceName(s, i))}${s.forces.flags[i] ? t(", flags {flags}", { flags: s.forces.flags[i] }) : ""}`);
  const bytes = sectionBytes(s);
  for (const [label, names] of SETTING_SECTIONS) {
    const parts = names.map((n) => bytes.get(n)).filter((b): b is Uint8Array => !!b);
    if (!parts.length) continue;
    const h = createHash("sha1");
    for (const [i, p] of parts.entries()) h.update(names[i]).update(p);
    add(label, translate(label), size(parts.reduce((n, p) => n + p.length, 0)), h.digest("hex"));
  }
  for (const [name, b] of [...doc.extras].sort(([a], [b]) => a.localeCompare(b))) add(`File ${name}`, t("File {name}", { name }), size(b.length), sha1(b));
  return out;
}

const READERS: Record<BlameKind, (doc: OpenedMap, shown: boolean) => Item[]> = { settings: settingItems, units: unitItems, locations: locationItems, triggers: triggerItems, strings: stringItems };

/** What blame needs of one version: the items of the kinds asked for, the map itself dropped. */
export function snapshot(doc: OpenedMap, kinds: readonly BlameKind[], shown = false): Snapshot {
  return Object.fromEntries(kinds.map((k) => [k, READERS[k](doc, shown)]));
}

/** For each item of `child`, the index of the same item in `parent`, or -1. One parent item per child item. */
export function matchItems(child: readonly Item[], parent: readonly Item[]): number[] {
  const pool = new Map<string, number[]>();
  parent.forEach((p, i) => { const k = `${p.id}\0${p.content}`; const l = pool.get(k); if (l) l.push(i); else pool.set(k, [i]); });
  return child.map((c) => pool.get(`${c.id}\0${c.content}`)?.shift() ?? -1);
}

export interface Blamed {
  /** null for a change not committed yet. */
  commit: (Omit<Commit, "parents"> & { boundary: boolean }) | null;
}
export interface BlameRow { label: string; text: string; commit: Blamed["commit"] }

export interface MapBlame {
  file: string;
  path: string;
  /** The revision blamed (`HEAD`), or null for the file as it is, uncommitted changes included. */
  rev: string | null;
  kinds: Partial<Record<BlameKind, BlameRow[]>>;
  /** The version's text of one trigger, for `--trigger N`. */
  detail?: string;
  /** How much of the history was read: commits walked, versions parsed. */
  walked: { commits: number; parsed: number; of: number };
  /** For a change not committed: the file's own date, which stands for "when" in the table. */
  modified?: string;
}

/** A range's two ends: `A..B` → [A, B or HEAD]; anything else is one revision. */
export function splitRange(rev: string): { from: string | null; to: string } {
  if (rev.includes("...")) throw new CliError(t("map blame takes a revision or a range A..B, not {rev}", { rev }), null, 2);
  const at = rev.indexOf("..");
  if (at < 0) return { from: null, to: rev };
  return { from: rev.slice(0, at) || "HEAD", to: rev.slice(at + 2) || "HEAD" };
}

const UNCOMMITTED = "0000000000000000000000000000000000000000";

/**
 * Who last changed each item. Without `rev` it is the file as it is on disk: what differs from HEAD is "not committed
 * yet", as git blame says. With `A..B`, an item older than A is put on the commit at the range's edge, marked as
 * a boundary (git blame's `^`).
 */
export async function blameMap(file: string, kinds: readonly BlameKind[], o: { rev?: string; trigger?: number } = {}): Promise<MapBlame> {
  const f = locate(file);
  const range = o.rev ? splitRange(o.rev) : { from: null, to: "HEAD" };
  const commits = commitsTouching(f, range.from ? `${range.from}..${range.to}` : range.to, { topo: true });
  const onDisk = !o.rev && existsSync(file);
  if (!commits.length) throw range.from ? new CliError(t("No commit in {range} changed {path}", { range: String(o.rev), path: f.path }), t("A wider range, or none, goes further back."), 2) : noHistory(f, file, o.rev);
  const listed = new Map(commits.map((c) => [c.hash, c]));
  // Every version the walk may want, in the order it will want them: one git call for all the blob ids.
  const specs = [`${range.to}:${f.path}`, ...commits.flatMap((c) => [`${c.hash}:${f.path}`, ...c.parents.map((p) => `${p}:${f.path}`)])];
  const ids = blobIds(f, specs);
  const idOf = new Map(specs.map((s, i) => [s, ids[i]]));
  const blob = (hash: string) => idOf.get(`${hash}:${f.path}`) ?? null;
  const versions = new Versions(f, 1);
  versions.expect(ids);
  const snaps = new Map<string, Snapshot>();
  const snap = async (oid: string | null): Promise<Snapshot | null> => {
    if (!oid) return null;
    let s = snaps.get(oid);
    if (!s) { s = snapshot(await versions.map(oid), kinds); snaps.set(oid, s); }
    return s;
  };

  // The version blamed: the file on disk, or the revision's.
  const top = idOf.get(`${range.to}:${f.path}`) ?? null;
  let topDoc: OpenedMap;
  let uncommitted = false;
  if (onDisk) {
    const bytes = new Uint8Array(readFileSync(file));
    topDoc = await loadMapInput({ path: file, name: f.name, bytes, kind: kindOf(f.name, bytes) });
    uncommitted = !top || sha1(bytes) !== sha1(versions.bytes(top));
  } else {
    if (!top) throw new CliError(t("git has no {path} at {rev}", { path: f.path, rev: range.to }), null, 2);
    topDoc = await versions.map(top);
  }
  const topSnap = snapshot(topDoc, kinds, true);
  const rows: Partial<Record<BlameKind, BlameRow[]>> = {};
  for (const k of kinds) rows[k] = topSnap[k]!.map((it) => ({ label: it.label, text: it.text, commit: null }));

  // A node of the walk: the uncommitted file, a listed commit, or (with a range) a commit at its edge.
  type Pending = { kind: BlameKind; row: number; at: number };
  const pending = new Map<string, Pending[]>();
  const put = (node: string, p: Pending) => { const l = pending.get(node); if (l) l.push(p); else pending.set(node, [p]); };
  let open = 0;
  const startAt = uncommitted ? UNCOMMITTED : commits[0]?.hash;
  for (const k of kinds) topSnap[k]!.forEach((_, i) => { put(startAt, { kind: k, row: i, at: i }); open++; });
  const settle = (p: Pending, c: Commit | null, boundary = false) => {
    rows[p.kind]![p.row].commit = c ? { hash: c.hash, author: c.author, email: c.email, date: c.date, subject: c.subject, boundary } : null;
    open--;
  };

  const nodes: { hash: string; parents: string[]; oid: string | null; commit: Commit | null }[] = [
    ...(uncommitted ? [{ hash: UNCOMMITTED, parents: commits[0] ? [commits[0].hash] : [], oid: null, commit: null }] : []),
    ...commits.map((c) => ({ hash: c.hash, parents: c.parents, oid: blob(c.hash), commit: c })),
  ];
  let walked = 0;
  for (const node of nodes) {
    if (open === 0) break;
    const here = pending.get(node.hash);
    if (!here?.length) continue;
    pending.delete(node.hash);
    walked++;
    const own = node.hash === UNCOMMITTED ? topSnap : await snap(node.oid);
    let left = here;
    for (const parent of node.parents) {
      if (!left.length) break;
      // The same blob (a merge that took one side whole): everything passes as it is, nothing parsed.
      if (node.oid && blob(parent) === node.oid) { for (const p of left) put(parent, p); left = []; break; }
      const theirs = await snap(blob(parent));
      if (!theirs || !own) continue;
      const matches = new Map<BlameKind, number[]>();
      const still: Pending[] = [];
      for (const p of left) {
        let m = matches.get(p.kind);
        if (!m) matches.set(p.kind, (m = matchItems(own[p.kind]!, theirs[p.kind]!)));
        const j = m[p.at];
        if (j >= 0) put(parent, { kind: p.kind, row: p.row, at: j }); else still.push(p);
      }
      left = still;
    }
    for (const p of left) settle(p, node.commit);
  }
  // What reached a commit outside the range is older than the range: the edge's commit, marked.
  if (open > 0) {
    const edge = [...pending.keys()].filter((h) => !listed.has(h) && h !== UNCOMMITTED);
    const info = edge.length ? describeCommits(f.root, edge) : new Map<string, Commit>();
    for (const h of edge) for (const p of pending.get(h)!) settle(p, info.get(h) ?? null, true);
  }

  const out: MapBlame = { file, path: f.path, rev: o.rev ?? null, kinds: rows, walked: { commits: walked, parsed: versions.counts.parsed, of: commits.length } };
  if (o.trigger !== undefined) {
    const trig = readTriggers(topDoc.scenario)[o.trigger - 1];
    if (trig) out.detail = triggersToText(topDoc.scenario, [trig]).trimEnd();
  }
  // The file's date stands for "now" on a change not committed, as git blame's own clock does.
  if (uncommitted) out.modified = statSync(file).mtime.toISOString();
  return out;
}

/** Author, date and subject of commits that are not in the walked list (a range's edge). */
function describeCommits(root: string, hashes: string[]): Map<string, Commit> {
  const r = spawnSyncGit(["-C", root, "show", "-s", "--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%s", ...hashes]);
  const out = new Map<string, Commit>();
  for (const rec of r.split("\x1e").filter((s) => s.trim())) {
    const [hash, author, email, date, subject] = rec.replace(/\n+$/, "").split("\x1f");
    out.set(hash, { hash, parents: [], author, email, date, subject });
  }
  return out;
}

const spawnSyncGit = (args: string[]) => spawnSync("git", args, { encoding: "utf8" }).stdout ?? "";

const KIND_TITLE: Record<BlameKind, string> = { settings: msg("Settings"), units: msg("Units"), locations: msg("Locations"), triggers: msg("Triggers"), strings: msg("Strings") };
/** ` · path at rev`, after a title. */
const where = (b: MapBlame) => ` · ${b.rev ? t("{path} at {rev}", { path: b.path, rev: b.rev }) : b.path}`;

/**
 * The table, git blame's shape: `hash (author date label) text`, the columns as wide as their widest cell. A boundary
 * commit's hash starts with `^`, a change not committed is all zeros, as git blame writes them.
 */
export function printBlame(b: MapBlame, width = process.stdout.columns || 120): string[] {
  const lines: string[] = [];
  const all = BLAME_KINDS.filter((k) => b.kinds[k]);
  const who = (r: BlameRow) => (r.commit ? r.commit.author : t("Not committed yet"));
  const day = (r: BlameRow) => (r.commit ? r.commit.date.slice(0, 10) : (b.modified ?? "").slice(0, 10));
  const hash = (r: BlameRow) => (r.commit ? (r.commit.boundary ? `^${short(r.commit.hash, 7)}` : short(r.commit.hash, 8)) : "00000000");
  const rowsOf = all.flatMap((k) => b.kinds[k]!);
  const aw = Math.min(24, Math.max(0, ...rowsOf.map((r) => columns(who(r)))));
  for (const k of all) {
    const rs = b.kinds[k]!;
    if (lines.length) lines.push("");
    lines.push(pc.bold(`${translate(KIND_TITLE[k])} (${rs.length})`) + pc.dim(where(b)));
    if (!rs.length) { lines.push(pc.dim(`  ${t("(none)")}`)); continue; }
    const lw = Math.max(...rs.map((r) => columns(r.label)));
    const numeric = rs.every((r) => /^\d+$/.test(r.label));
    for (const r of rs) {
      const name = who(r);
      const shown = columns(name) > aw ? `${name.slice(0, aw - 1)}…` : name + " ".repeat(aw - columns(name));
      const label = numeric ? r.label.padStart(lw) : r.label + " ".repeat(lw - columns(r.label));
      const head = `${hash(r)} (${shown} ${day(r)} ${label})`;
      const room = Math.max(20, width - columns(head) - 1);
      const colour = r.commit ? (r.commit.boundary ? pc.dim : pc.yellow) : pc.red;
      lines.push(`${colour(hash(r))} ${pc.dim("(")}${pc.cyan(shown)} ${pc.dim(day(r))} ${label}${pc.dim(")")} ${cut(r.text, room)}`);
    }
  }
  return lines;
}

/** One item, with the commit's subject and (for a trigger) its whole text. */
export function printBlameItem(b: MapBlame, kind: BlameKind, row: BlameRow, title: string): string[] {
  const c = row.commit;
  const lines = [pc.bold(title) + pc.dim(where(b)), ""];
  const changed = t("Last changed");
  if (c) {
    lines.push(`  ${pc.dim(changed)}  ${pc.yellow(c.boundary ? `^${short(c.hash, 7)}` : short(c.hash, 8))}${pc.dim(" · ")}${pc.cyan(c.author)}${pc.dim(" · ")}${c.date.slice(0, 16).replace("T", " ")}${c.boundary ? pc.dim(` ${t("(or before: the range starts here)")}`) : ""}`);
    lines.push(`  ${padColumns("", columns(changed))}  ${c.subject}`);
  } else lines.push(`  ${pc.dim(changed)}  ${pc.red(t("not committed yet"))}`);
  lines.push("");
  if (kind === "triggers" && b.detail) lines.push(...b.detail.split("\n").map((l) => `  ${l}`));
  else lines.push(`  ${row.text}`);
  return lines;
}

