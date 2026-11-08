/**
 * `scmjs map find <text> <maps…>`: Edit ▸ Find over any number of maps from the terminal — units, locations, strings,
 * triggers, the briefing, sprites and doodads — a grep for maps. Exits 1 when nothing matched, as grep does, so a
 * script can ask "does any map still say this?".
 */
import type { OpenedMap } from "../../src/editor/mapFile";
import { FIND_KINDS, findInScenario, type FindKind, type FindResult } from "../../src/editor/find";
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

/** Every match in the map, kind by kind in the dialog's order. */
export function findInMap(doc: OpenedMap, file: string, query: string, kinds: readonly FindKind[], matchCase = false): FindHit[] {
  const out: FindHit[] = [];
  for (const kind of KINDS) {
    if (!kinds.includes(kind)) continue;
    for (const r of findInScenario(doc.scenario, { kind, query, matchCase, limit: Infinity })) out.push({ file, ...r });
  }
  return out;
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
