/**
 * TrigScript's declarations as something to look things up in. The compiler generates one text for a map (the
 * language's functions and types, then the map's own names: its locations, switches, sounds, the units as it names
 * them), which the editor's code window reads whole. It is some 350 KB, far more than a model should be handed, so
 * this cuts it into entries — a declaration with the comment above it — and answers a search with the entries that
 * match, and no search with what there is to search for.
 *
 * Nothing here knows the plugin: it reads the text. What it relies on is how the generator lays the text out — a
 * section line (`// ── Conditions ──`), declarations starting at the left margin, their members indented — which
 * `tests/cli-script.test.ts` holds it to with the real text where the vendored plugin is there.
 */

export interface ApiEntry {
  /** The section line it is under ("Conditions", "The map"); the first section is the language itself. */
  section: string;
  /** What is declared: a function's, constant's, type's or namespace's name. */
  name: string;
  /** function, const, type, interface or namespace. */
  kind: string;
  /** The comment and the declaration, as generated. */
  lines: string[];
}

/** Where the generator repeats every name inside `declare module "trigscript"`: the same entries again. */
const REPEAT = /^\/\/ ── The same names, as a module/;
const SECTION = /^\/\/ ── (.+?) ─*$/;
const DECLARED = /^(?:declare\s+)?(function|const|let|var|namespace|module|class|type|interface)\s+([A-Za-z_$][\w$]*|"[^"]*")/;

/** The text cut into entries, in its order; the repeat of the names as a module left out. */
export function apiEntries(text: string): ApiEntry[] {
  const out: ApiEntry[] = [];
  let section = "The language";
  let block: string[] = [];
  let declared = false;
  let inComment = false;
  const flush = () => {
    while (block.length && block[block.length - 1].trim() === "") block.pop();
    const m = declared ? DECLARED.exec(block.find((l) => DECLARED.test(l))!) : null;
    if (m) out.push({ section, name: m[2].replace(/"/g, ""), kind: m[1] === "let" || m[1] === "var" ? "const" : m[1], lines: block });
    block = [];
    declared = false;
  };
  for (const line of text.split("\n")) {
    if (REPEAT.test(line)) break;
    if (!inComment) {
      const s = SECTION.exec(line);
      if (s) { flush(); section = s[1] === "TrigScript" ? "The language" : s[1]; continue; }
      if (line.startsWith("/*")) flush();
      // A declaration starts an entry, unless what is held so far is only its comment.
      else if (DECLARED.test(line)) { if (declared) flush(); declared = true; }
      // A line comment at the margin belongs to no entry (the opening lines).
      else if (line.startsWith("//")) { flush(); continue; }
      // A comment with a blank line after it is nobody's.
      else if (line.trim() === "" && !declared) { block = []; continue; }
    }
    block.push(line);
    const open = line.lastIndexOf("/*"), close = line.lastIndexOf("*/");
    if (!inComment && open >= 0 && close < open) inComment = true;
    else if (inComment && close >= 0) inComment = false;
  }
  flush();
  return out;
}

/** An entry too long to hand over whole (a table of every unit, an interface of forty members) answers with its matching members. */
const LONG = 40;
/** A search's answer in characters, more or less: beyond it, the entries left are counted and named. */
export const API_BUDGET = 14_000;

const wordsOf = (query: string) => query.toLowerCase().split(/[\s,]+/).filter(Boolean);
const has = (text: string, words: readonly string[]) => { const t = text.toLowerCase(); return words.every((w) => t.includes(w)); };

/** A long entry's members that match, each with the comment above it, under the entry's first line. */
function matchingMembers(e: ApiEntry, words: readonly string[]): string[] | null {
  const start = e.lines.findIndex((l) => DECLARED.test(l));
  const body = e.lines.slice(start + 1);
  const found: string[] = [];
  let comment: string[] = [];
  let inComment = false;
  for (const line of body) {
    const trimmed = line.trim();
    if (inComment || trimmed.startsWith("/**") || trimmed.startsWith("//")) {
      if (trimmed.startsWith("/**")) comment = [];
      comment.push(line);
      inComment = trimmed.startsWith("//") ? false : !trimmed.endsWith("*/");
      continue;
    }
    if (has([...comment, line].join("\n"), words)) found.push(...comment, line);
    comment = [];
  }
  return found.length ? [e.lines[start], ...found, "  …"] : null;
}

export interface ApiAnswer {
  /** The entries found, as text to read. */
  lines: string[];
  shown: number;
  /** The names of matching entries the budget left out. */
  more: string[];
}

/**
 * The entries a search finds: every word in the entry's name, comment or declaration, whatever the case. An entry
 * whose name holds a word comes before one that only mentions it; a long entry answers with its matching members,
 * unless its own name is what was asked for.
 */
export function searchApi(entries: readonly ApiEntry[], query: string, budget = API_BUDGET): ApiAnswer {
  const words = wordsOf(query);
  if (!words.length) return { lines: [], shown: 0, more: [] };
  const hits: { e: ApiEntry; rank: number; lines: string[] }[] = [];
  for (const e of entries) {
    const name = e.name.toLowerCase();
    const exact = words.length === 1 && name === words[0];
    const named = words.every((w) => name.includes(w));
    if (e.lines.length > LONG && !exact) {
      const members = matchingMembers(e, words);
      if (members) hits.push({ e, rank: named ? 1 : 2, lines: members });
      else if (named) hits.push({ e, rank: 1, lines: [...e.lines.slice(0, LONG), `  … ${e.lines.length - LONG} more lines: search for a member's name`] });
      continue;
    }
    if (!has(e.lines.join("\n"), words)) continue;
    hits.push({ e, rank: exact ? 0 : named ? 1 : 2, lines: e.lines.length > LONG * 3 ? [...e.lines.slice(0, LONG * 3), `  … ${e.lines.length - LONG * 3} more lines`] : e.lines });
  }
  hits.sort((a, b) => a.rank - b.rank);
  const lines: string[] = [], more: string[] = [];
  let used = 0, shown = 0, section = "";
  for (const h of hits) {
    const size = h.lines.reduce((n, l) => n + l.length + 1, 0);
    if (shown > 0 && used + size > budget) { more.push(h.e.name); continue; }
    if (h.e.section !== section) { section = h.e.section; lines.push(`// ── ${section} ──`); }
    lines.push(...h.lines, "");
    used += size;
    shown++;
  }
  return { lines, shown, more: [...new Set(more)] };
}

/** A table's members (`readonly Elder: Location<1>;`), by the name a script writes: quoted ones and comments left out. */
function memberNames(e: ApiEntry): string[] {
  const out: string[] = [];
  for (const l of e.lines) { const m = /^\s+(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*[:(<]/.exec(l); if (m) out.push(m[1]); }
  return [...new Set(out)];
}

/** The tables of the map's own things, whose members are worth listing whole: they are what differs from map to map. */
const MAP_TABLES = ["locations", "switches", "sounds", "forces"];
/** A name the map never gave: `Switch12`, `Location7`. */
const UNNAMED = /^(?:Switch|Location)\d+$/;
/** Names a list holds before it says how many more there are, and a table's members before it only counts them. */
const MOST_NAMES = 150, SMALL_TABLE = 20;

/**
 * What there is to search for: the generator's opening comment (what a script is), then each section's names — the
 * functions in full, the types and tables by name — and the map's own locations, switches and sounds as a script
 * writes them. A table of the game's things (units, orders, weapons) says how many it has.
 */
export function apiOverview(text: string, entries: readonly ApiEntry[]): string[] {
  const lines: string[] = [];
  for (const l of text.split("\n")) {
    if (!l.startsWith("//")) break;
    if (/Generated for the open map/.test(l)) continue;
    lines.push(l.replace(/^\/\/ ?/, "").replace(/^── (.+?) ─*$/, "$1"));
  }
  const shown = (name: string) => !name.startsWith("__");
  for (const section of [...new Set(entries.map((e) => e.section))]) {
    const of = entries.filter((e) => e.section === section && shown(e.name));
    lines.push("", `${section}:`);
    const names = (kind: (k: string) => boolean) => [...new Set(of.filter((e) => kind(e.kind)).map((e) => e.name))];
    const list = (label: string, all: string[]) => { if (all.length) lines.push(`  ${label}: ${all.slice(0, MOST_NAMES).join(", ")}${all.length > MOST_NAMES ? `, … ${all.length - MOST_NAMES} more` : ""}`); };
    list("functions", names((k) => k === "function"));
    list("types", names((k) => k === "type" || k === "interface" || k === "class"));
    list("namespaces", names((k) => k === "namespace" || k === "module"));
    const consts = of.filter((e) => e.kind === "const");
    list("values", [...new Set(consts.filter((e) => e.lines.length <= 3).map((e) => e.name))]);
    for (const tbl of consts.filter((e) => e.lines.length > 3)) {
      const members = memberNames(tbl).filter(shown);
      if (MAP_TABLES.includes(tbl.name)) list(`${tbl.name}.*`, members.filter((n) => !UNNAMED.test(n)));
      else if (members.length <= SMALL_TABLE) list(`${tbl.name}.*`, members);
      else lines.push(`  ${tbl.name}.*: ${members.length} names`);
    }
  }
  return lines;
}
