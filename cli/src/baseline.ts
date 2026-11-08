/**
 * `scmjs map check --baseline`: a ratchet for maps with many findings. The findings a map has today are written to a
 * JSON file (`--write-baseline`), and later checks report and fail only on findings that file does not hold; the ones
 * it holds that no longer occur are counted as fixed. One file holds any number of maps, each by its path relative to
 * the file's folder, so a folder of maps and its baseline move together.
 *
 * A finding is known by where it is (Players, Triggers, …) and its text with the parts that shift taken out, so an
 * edit elsewhere does not make a known finding new: a trigger's number becomes a hash of the trigger's text as the
 * trigger window writes it (owners, conditions, actions; strings by their text, not their number), so a trigger added
 * above it, or the strings numbered again, changes nothing; counts ("12 units belong to …") and "(the first …)"
 * examples are masked, so one more unit in a dead slot is the same finding. Locations, players, switches and unit
 * positions stay as they are: those name the thing the finding is about.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Scenario } from "../../src/formats/chk/scenario";
import { triggerNames } from "../../src/editor/triggers";
import { formatTrigger, type TriggerNames } from "../../src/formats/triggers/text";
import type { TriggerRecord } from "../../src/formats/chk/sections/triggers";
import type { Issue, IssueLevel } from "../../src/editor/validate";
import { CliError } from "./ui";

/** The file `--baseline` and `--write-baseline` use when given no path: in the working directory. */
export const BASELINE_FILE = ".scmjs-baseline.json";

/** A known finding as the file keeps it: its level and text as reported, and the identity it is matched by when that differs from the text. */
export interface BaselineEntry { level: IssueLevel; where: string; text: string; id?: string }

export interface Baseline {
  /** The file, as given. */
  file: string;
  /** Known findings by map, the map's path relative to the file's folder with `/`. */
  maps: Record<string, BaselineEntry[]>;
}

/** What a map's check is against its baseline: the findings it does not hold, the ones it does, and the ones it holds that are gone. */
export interface BaselineMatch { fresh: Issue[]; suppressed: Issue[]; fixed: BaselineEntry[] }

const ABOUT = "Findings scmjs map check already knows of: a check with --baseline fails only on others. scmjs map check --write-baseline rewrites this file.";

/** Words after a number that make it a count, which changes without the finding changing. */
const COUNTED = /\b\d[\d,]*(?= (?:more |other )?(?:placed )?(?:units?|unit types?|strings?|tiles?|mineral fields?|triggers?|start locations?|bytes)\b)/g;

/** The names a scenario's triggers are written with, made once a scenario. */
const namesOf = new WeakMap<Scenario, TriggerNames>();

/** A trigger as eight hex digits: a hash of its text form, so it is the same trigger wherever it stands in the list. */
export function triggerHash(trigger: TriggerRecord, scn: Scenario, briefing = false): string {
  let names = namesOf.get(scn);
  if (!names) namesOf.set(scn, (names = triggerNames(scn)));
  return createHash("sha1").update(formatTrigger(trigger, names, briefing)).digest("hex").slice(0, 8);
}

/**
 * A finding's identity: its text with a trigger's number made the trigger's hash, counts masked and an example
 * "(the first …)" left out. Two findings with the same identity in one area are the same finding.
 */
export function findingId(issue: Pick<Issue, "text" | "where">, scn: Scenario): string {
  // A trigger is named by its place in the list ("Trigger 12", "Briefing 3") whether or not the finding points at it.
  const text = issue.text
    .replace(/\bTrigger (\d+)\b/g, (whole, n: string) => { const t = scn.triggers[Number(n) - 1]; return t ? `Trigger @${triggerHash(t, scn)}` : whole; })
    .replace(/\bBriefing (\d+)\b/g, (whole, n: string) => { const t = scn.briefing[Number(n) - 1]; return t ? `Briefing @${triggerHash(t, scn, true)}` : whole; });
  return text.replace(COUNTED, "#").replace(/\b\d+%/g, "#%").replace(/\(the first\b[^)]*\)/g, "(the first …)").replace(/\s+/g, " ").trim();
}

const keyOf = (where: string, id: string) => `${where}\u0000${id}`;

/** The map's key in a baseline: its path relative to the baseline file's folder, with `/`. */
export function mapKey(baselineFile: string, mapPath: string): string {
  return relative(dirname(resolve(baselineFile)), resolve(mapPath)).split("\\").join("/") || mapPath;
}

/** The baseline file read; a missing or unreadable one is a CliError (exit 2) saying how to make one. */
export function readBaseline(file: string): Baseline {
  if (!existsSync(file)) throw new CliError(`No baseline ${file}`, `scmjs map check <maps…> --write-baseline${file === BASELINE_FILE ? "" : ` ${file}`} writes one from the findings the maps have now.`, 2);
  let v: unknown;
  try { v = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new CliError(`${file} is not JSON: ${e instanceof Error ? e.message : e}`, null, 2); }
  const maps = (v as { maps?: unknown })?.maps;
  if (typeof maps !== "object" || maps === null || Array.isArray(maps)) throw new CliError(`${file} is not a baseline: it has no "maps".`, "scmjs map check --write-baseline writes one.", 2);
  const out: Baseline = { file, maps: {} };
  for (const [map, list] of Object.entries(maps as Record<string, unknown>)) {
    if (!Array.isArray(list)) throw new CliError(`${file}: "${map}" is not a list of findings.`, null, 2);
    out.maps[map] = list.filter((e): e is BaselineEntry => typeof e === "object" && e !== null && typeof (e as BaselineEntry).text === "string" && typeof (e as BaselineEntry).where === "string")
      .map((e) => ({ level: e.level, where: e.where, text: e.text, ...(typeof e.id === "string" ? { id: e.id } : {}) }));
  }
  return out;
}

/** The map's findings held against its known ones: each known finding answers for one finding with its identity. */
export function matchBaseline(known: readonly BaselineEntry[] | undefined, issues: readonly Issue[], scn: Scenario): BaselineMatch {
  const left = new Map<string, BaselineEntry[]>();
  for (const e of known ?? []) {
    const k = keyOf(e.where, e.id ?? e.text);
    left.set(k, [...(left.get(k) ?? []), e]);
  }
  const fresh: Issue[] = [], suppressed: Issue[] = [];
  for (const i of issues) {
    const list = left.get(keyOf(i.where, findingId(i, scn)));
    if (list?.length) { list.shift(); suppressed.push(i); } else fresh.push(i);
  }
  return { fresh, suppressed, fixed: [...left.values()].flat() };
}

/** The map's findings as the file keeps them, in a steady order so the file diffs well. */
export function baselineEntries(issues: readonly Issue[], scn: Scenario): BaselineEntry[] {
  return issues.map((i) => { const id = findingId(i, scn); return { level: i.level, where: i.where, text: i.text, ...(id !== i.text ? { id } : {}) }; })
    .sort((a, b) => a.where.localeCompare(b.where, "en") || (a.id ?? a.text).localeCompare(b.id ?? b.text, "en"));
}

/**
 * Writes the baseline: the maps checked now with the findings they have, the other maps the file held kept as they
 * were. Returns how many findings it holds in all.
 */
export function writeBaseline(file: string, previous: Baseline | null, now: Record<string, BaselineEntry[]>): number {
  const maps: Record<string, BaselineEntry[]> = { ...previous?.maps, ...now };
  const sorted = Object.fromEntries(Object.keys(maps).sort((a, b) => a.localeCompare(b, "en")).map((k) => [k, maps[k]]));
  writeFileSync(file, JSON.stringify({ about: ABOUT, version: 1, maps: sorted }, null, 2) + "\n");
  return Object.values(sorted).reduce((n, l) => n + l.length, 0);
}
