/**
 * `scmjs map find <text> <maps…>`: Edit ▸ Find over any number of maps from the terminal — units, locations, strings,
 * triggers, the briefing, sprites and doodads — a grep for maps. Exits 1 when nothing matched, as grep does, so a
 * script can ask "does any map still say this?".
 */
import type { OpenedMap } from "../../src/editor/mapFile";
import { FIND_KINDS, findInScenario, type FindKind, type FindResult } from "../../src/editor/find";
import { readBriefing, readTriggers, triggerNames } from "../../src/editor/triggers";
import { formatTrigger } from "../../src/formats/triggers/text";
import { msg, t, translate } from "./i18n";
import { CliError, columns, padColumns, pc } from "./ui";

export const KINDS: readonly FindKind[] = FIND_KINDS.map((k) => k.value);

/** `--in units,strings` as kinds, or a CliError naming the ones there are. */
export function parseKinds(spec: string | undefined): FindKind[] {
  if (!spec) return [...KINDS];
  const kinds = spec.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = kinds.filter((k) => !(KINDS as readonly string[]).includes(k));
  if (bad.length) throw new CliError(t("--in does not know {list}", { list: bad.join(", ") }), t("It takes any of {list}, with commas between.", { list: KINDS.join(", ") }), 2);
  return [...new Set(kinds)] as FindKind[];
}

export interface FindHit extends FindResult { file: string }

/**
 * Triggers (or the briefing) whose text, as `map triggers export` writes it, holds the query — conditions and actions
 * with their arguments too (a unit, a location, a player), not only the strings the Find dialog reads. The line that
 * matched is the detail; a number matches the trigger's own number, as in the dialog.
 */
function findTriggers(doc: OpenedMap, kind: "triggers" | "briefing", query: string, matchCase: boolean): FindResult[] {
  const briefing = kind === "briefing";
  const names = triggerNames(doc.scenario);
  const fold = (s: string) => (matchCase ? s : s.toLowerCase());
  const q = fold(query.trim());
  const out: FindResult[] = [];
  (briefing ? readBriefing(doc.scenario) : readTriggers(doc.scenario)).forEach((trig, index) => {
    const lines = formatTrigger(trig, names, briefing).split("\n").map((l) => l.trim());
    const match = q ? lines.find((l) => fold(l).includes(q)) : undefined;
    if (match === undefined && String(index + 1) !== q) return;
    out.push({ kind, index, label: briefing ? t("Briefing {n}", { n: index + 1 }) : t("Trigger {n}", { n: index + 1 }), detail: match ?? t("{c} conditions · {a} actions", { c: trig.conditions.length, a: trig.actions.length }) });
  });
  return out;
}

/** Every match in the map, kind by kind in the dialog's order. */
export function findInMap(doc: OpenedMap, file: string, query: string, kinds: readonly FindKind[], matchCase = false): FindHit[] {
  const out: FindHit[] = [];
  for (const kind of KINDS) {
    if (!kinds.includes(kind)) continue;
    const found = kind === "triggers" || kind === "briefing" ? findTriggers(doc, kind, query, matchCase) : findInScenario(doc.scenario, { kind, query, matchCase, limit: Infinity });
    for (const r of found) out.push({ file, ...r });
  }
  return out;
}

/**
 * A hit for `--json`: as found, with `number` where the text counts from 1 — a trigger's, a location's (its slot plus
 * one, as triggers name it), a string's — beside the 0-based `index`.
 */
export function hitJson(h: FindHit): Omit<FindHit, "file"> & { number?: number } {
  const { file: _f, ...rest } = h;
  const number = h.kind === "triggers" || h.kind === "briefing" || h.kind === "locations" ? h.index + 1 : h.kind === "strings" ? h.index : undefined;
  return number === undefined ? rest : { ...rest, number };
}

const KIND_LABEL: Record<FindKind, string> = { units: msg("unit"), locations: msg("location"), sprites: msg("sprite"), doodads: msg("doodad"), strings: msg("string"), triggers: msg("trigger"), briefing: msg("briefing") };

/** A map's hits as lines: the kind, what matched and where, the way the Find dialog lists them. */
export function printHits(hits: FindHit[]): string[] {
  const width = Math.max(0, ...hits.map((h) => columns(translate(KIND_LABEL[h.kind]))));
  return hits.map((h) => {
    const label = h.label.replace(/\s+/g, " ");
    const where = h.detail.replace(/\s+/g, " ");
    return `  ${pc.cyan(padColumns(translate(KIND_LABEL[h.kind]), width))}  ${label.length > 80 ? `${label.slice(0, 77)}…` : label}${where ? pc.dim(`  ${where}`) : ""}`;
  });
}
