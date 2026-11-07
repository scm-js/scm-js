/**
 * `scmjs map set | resize | strings prune`: the edits of the Scenario menu that a script wants without the editor —
 * the header (name, description, revision, text encoding), the size, and the strings nothing refers to. Each is the
 * editor's own function over the open document; main.ts writes the map back with `writeBack`.
 */
import type { OpenedMap } from "../../src/editor/mapFile";
import { MAP_VERSIONS, mapVersionOf, scenarioDescription, scenarioName, setScenarioDescription, setScenarioName, type MapVersion } from "../../src/formats/chk/scenario";
import { changeMapVersion, changeTextEncoding } from "../../src/editor/settings";
import { TEXT_ENCODINGS, type TextEncoding } from "../../src/formats/text/encoding";
import { resizeScenario, type ResizeResult } from "../../src/editor/resize";
import { baseTerrain } from "../../src/formats/tileset/terrain";
import { applyStrings, deleteUnused, stringUsages, unusedStrings } from "../../src/editor/strings";
import { plainText } from "../../src/editor/textColors";
import { CliError } from "./ui";

export const VERSIONS = Object.keys(MAP_VERSIONS) as MapVersion[];
export const ENCODINGS = TEXT_ENCODINGS.map((e) => e.id);

export interface HeaderOptions { name?: string; description?: string; version?: string; encoding?: string }
export interface FieldChange { field: string; from: string; to: string }

/** Sets what is given, and says what changed; a version or encoding that is not one is refused with the list. */
export function setHeader(doc: OpenedMap, o: HeaderOptions): FieldChange[] {
  const scn = doc.scenario;
  const out: FieldChange[] = [];
  if (o.version !== undefined && !(VERSIONS as string[]).includes(o.version)) throw new CliError(`--version takes ${VERSIONS.join(", ")}, not "${o.version}"`, null, 2);
  if (o.encoding !== undefined && !(ENCODINGS as string[]).includes(o.encoding)) throw new CliError(`--encoding takes ${ENCODINGS.join(", ")}, not "${o.encoding}"`, null, 2);
  if (o.name !== undefined) {
    const from = scenarioName(scn) ?? "";
    if (from !== o.name) { setScenarioName(scn, o.name); out.push({ field: "Name", from: plainText(from), to: plainText(o.name) }); }
  }
  if (o.description !== undefined) {
    const from = scenarioDescription(scn) ?? "";
    if (from !== o.description) { setScenarioDescription(scn, o.description); out.push({ field: "Description", from: plainText(from), to: plainText(o.description) }); }
  }
  if (o.version !== undefined) {
    const from = mapVersionOf(scn.fileVersion);
    if (from !== o.version) { changeMapVersion(scn, o.version as MapVersion); out.push({ field: "Version", from: MAP_VERSIONS[from].label, to: MAP_VERSIONS[o.version as MapVersion].label }); }
  }
  if (o.encoding !== undefined) {
    const from = scn.strings.encoding;
    if (from !== o.encoding) { changeTextEncoding(scn, o.encoding as TextEncoding); out.push({ field: "Text encoding", from: TEXT_ENCODINGS.find((e) => e.id === from)?.label ?? from, to: TEXT_ENCODINGS.find((e) => e.id === o.encoding)?.label ?? o.encoding }); }
  }
  return out;
}

/** The Resize dialog's anchor grid by name, row-major 0–8. */
export const ANCHORS: Record<string, number> = { "top-left": 0, top: 1, "top-right": 2, left: 3, center: 4, centre: 4, right: 5, "bottom-left": 6, bottom: 7, "bottom-right": 8 };

export function parseAnchor(spec: string): number {
  const n = ANCHORS[spec.trim().toLowerCase()];
  if (n === undefined) throw new CliError(`--anchor takes ${Object.keys(ANCHORS).filter((k) => k !== "centre").join(", ")}, not "${spec}"`, null, 2);
  return n;
}

export interface ResizeOutcome extends ResizeResult { from: { width: number; height: number }; to: { width: number; height: number } }

/** Scenario ▸ Resize: the map moved under the anchor, the new ground base terrain (no tileset here, as the editor without game data). */
export function resizeMap(doc: OpenedMap, o: { width: number; height: number; anchor: number; clampLocations: boolean }): ResizeOutcome {
  const scn = doc.scenario;
  const from = { width: scn.width, height: scn.height };
  if (from.width === o.width && from.height === o.height) throw new CliError(`${from.width} × ${from.height} is the map's size already`, null, 2);
  const r = resizeScenario(scn, { width: o.width, height: o.height, anchor: o.anchor, fill: baseTerrain(null), tileset: null, era: scn.era, clampLocations: o.clampLocations, random: () => 0.5 });
  return { ...r, from, to: { width: scn.width, height: scn.height } };
}

export interface PrunedString { index: number; text: string }

/** Strings nothing refers to, blanked (never renumbered: the rest keep their places) and the trailing blanks dropped. */
export function pruneStrings(doc: OpenedMap, { dryRun = false } = {}): PrunedString[] {
  const scn = doc.scenario;
  const usages = stringUsages(scn);
  const removed = unusedStrings(scn, usages).map((index) => ({ index, text: plainText(scn.strings.strings[index] ?? "") }));
  if (!dryRun && removed.length) applyStrings(scn, deleteUnused(scn.strings.strings, usages), usages);
  return removed;
}
