/**
 * `scmjs map set | resize | strings prune`: the edits of the Scenario menu that a script wants without the editor —
 * the header (name, description, revision, text encoding), the size, and the strings nothing refers to. Each is the
 * editor's own function over the open document; main.ts writes the map back with `writeBack`.
 */
import type { OpenedMap } from "../../src/editor/mapFile";
import { MAP_VERSIONS, mapVersionOf, scenarioDescription, scenarioName, setScenarioDescription, setScenarioName, type MapVersion, type Scenario } from "../../src/formats/chk/scenario";
import { changeMapVersion, changeTextEncoding } from "../../src/editor/settings";
import { TEXT_ENCODINGS, type TextEncoding } from "../../src/formats/text/encoding";
import { resizeScenario, type ResizeResult } from "../../src/editor/resize";
import { baseTerrain } from "../../src/formats/tileset/terrain";
import { applyStrings, deleteUnused, stringUsages, unusedStrings } from "../../src/editor/strings";
import { unescapeStringText } from "../../src/editor/exchange";
import { plainText } from "../../src/editor/textColors";
import { msg, t } from "./i18n";
import { CliError } from "./ui";

export const VERSIONS = Object.keys(MAP_VERSIONS) as MapVersion[];
export const ENCODINGS = TEXT_ENCODINGS.map((e) => e.id);

export interface HeaderOptions { name?: string; description?: string; version?: string; encoding?: string }
export interface FieldChange { field: string; from: string; to: string }

/**
 * Sets what is given, and says what changed; a version or encoding that is not one is refused with the list. A name
 * or description is read as `map strings import` reads a line: `<03>` and the like are the game's colour codes.
 */
export function setHeader(doc: OpenedMap, given: HeaderOptions): FieldChange[] {
  const scn = doc.scenario;
  const out: FieldChange[] = [];
  const o = { ...given, name: given.name === undefined ? undefined : unescapeStringText(given.name), description: given.description === undefined ? undefined : unescapeStringText(given.description) };
  if (o.version !== undefined && !(VERSIONS as string[]).includes(o.version)) throw new CliError(t("--revision takes {list}, not \"{value}\"", { list: VERSIONS.join(", "), value: o.version }), null, 2);
  if (o.encoding !== undefined && !(ENCODINGS as string[]).includes(o.encoding)) throw new CliError(t("--encoding takes {list}, not \"{value}\"", { list: ENCODINGS.join(", "), value: o.encoding }), null, 2);
  if (o.name !== undefined) {
    const from = scenarioName(scn) ?? "";
    if (from !== o.name) { setScenarioName(scn, o.name); out.push({ field: msg("Name"), from: plainText(from), to: plainText(o.name) }); }
  }
  if (o.description !== undefined) {
    const from = scenarioDescription(scn) ?? "";
    if (from !== o.description) { setScenarioDescription(scn, o.description); out.push({ field: msg("Description"), from: plainText(from), to: plainText(o.description) }); }
  }
  if (o.version !== undefined) {
    const from = mapVersionOf(scn.fileVersion);
    if (from !== o.version) { changeMapVersion(scn, o.version as MapVersion); out.push({ field: msg("Version"), from: MAP_VERSIONS[from].label, to: MAP_VERSIONS[o.version as MapVersion].label }); }
  }
  if (o.encoding !== undefined) {
    const from = scn.strings.encoding;
    if (from !== o.encoding) { changeTextEncoding(scn, o.encoding as TextEncoding); out.push({ field: msg("Text encoding"), from: TEXT_ENCODINGS.find((e) => e.id === from)?.label ?? from, to: TEXT_ENCODINGS.find((e) => e.id === o.encoding)?.label ?? o.encoding }); }
  }
  return out;
}

/** The Resize dialog's anchor grid by name, row-major 0–8. */
export const ANCHORS: Record<string, number> = { "top-left": 0, top: 1, "top-right": 2, left: 3, center: 4, centre: 4, right: 5, "bottom-left": 6, bottom: 7, "bottom-right": 8 };

export function parseAnchor(spec: string): number {
  const n = ANCHORS[spec.trim().toLowerCase()];
  if (n === undefined) throw new CliError(t("--anchor takes {list}, not \"{value}\"", { list: Object.keys(ANCHORS).filter((k) => k !== "centre").join(", "), value: spec }), null, 2);
  return n;
}

export interface ResizeOutcome extends ResizeResult { from: { width: number; height: number }; to: { width: number; height: number } }

/** Scenario ▸ Resize: the map moved under the anchor, the new ground base terrain (no tileset here, as the editor without game data). */
export function resizeMap(doc: OpenedMap, o: { width: number; height: number; anchor: number; clampLocations: boolean }): ResizeOutcome {
  const scn = doc.scenario;
  const from = { width: scn.width, height: scn.height };
  if (from.width === o.width && from.height === o.height) throw new CliError(t("{width} × {height} is the map's size already", { width: from.width, height: from.height }), null, 2);
  const r = resizeScenario(scn, { width: o.width, height: o.height, anchor: o.anchor, fill: baseTerrain(null), tileset: null, era: scn.era, clampLocations: o.clampLocations, random: () => 0.5 });
  return { ...r, from, to: { width: scn.width, height: scn.height } };
}

export interface PrunedString { index: number; text: string }

/**
 * Strings nothing refers to, blanked (never renumbered: the rest keep their places) and the trailing blanks dropped.
 * An empty slot is a gap the table keeps so the numbers after it hold, not a string, so it is neither listed nor counted.
 */
export function pruneStrings(doc: OpenedMap, { dryRun = false } = {}): PrunedString[] {
  return pruneScenarioStrings(doc.scenario, { dryRun });
}

/** `pruneStrings` on a scenario alone (`map optimize` prunes the built file's scenario, which no `OpenedMap` holds). */
export function pruneScenarioStrings(scn: Scenario, { dryRun = false } = {}): PrunedString[] {
  const usages = stringUsages(scn);
  const removed = unusedStrings(scn, usages).filter((index) => scn.strings.strings[index] !== "").map((index) => ({ index, text: plainText(scn.strings.strings[index] ?? "") }));
  if (!dryRun && removed.length) applyStrings(scn, deleteUnused(scn.strings.strings, usages), usages);
  return removed;
}
