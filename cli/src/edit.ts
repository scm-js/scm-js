/**
 * `scmjs map set | resize | strings prune`: the edits of the Scenario menu that a script wants without the editor —
 * the header (name, description, revision, text encoding), the size, and the strings nothing refers to. Each is the
 * editor's own function over the open document; main.ts writes the map back with `writeBack`.
 */
import type { OpenedMap } from "../../src/editor/mapFile";
import { MAP_VERSIONS, mapVersionOf, scenarioDescription, scenarioName, setScenarioDescription, setScenarioName, type MapVersion, type Scenario } from "../../src/formats/chk/scenario";
import { changeMapVersion, changeTextEncoding } from "../../src/editor/settings";
import { TEXT_ENCODINGS, type TextEncoding } from "../../src/formats/text/encoding";
import { resizeOffset, resizeScenario, type ResizeResult } from "../../src/editor/resize";
import { ANYWHERE_INDEX, isLocationUsed } from "../../src/formats/chk/sections/objects";
import { locationName } from "../../src/editor/locations";
import { unitName } from "../../src/data/units";
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
/** A word compared the way a person types it: any case, with or without spaces, dashes and underscores. */
const loose = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

/** `--revision Remastered`, `--revision brood-war`: one of `VERSIONS`, in any case, or exit 2 with the list. */
export function parseRevision(value: string): MapVersion {
  const found = VERSIONS.find((v) => loose(v) === loose(value));
  if (!found) throw new CliError(t("--revision takes {list}, not \"{value}\"", { list: VERSIONS.join(", "), value }), null, 2);
  return found;
}

/** `--encoding UTF-8`, `--encoding cp949`: one of `ENCODINGS`, in any case (CP949 is EUC-KR's Windows name), or exit 2. */
export function parseEncoding(value: string): TextEncoding {
  const v = loose(value);
  const found = ENCODINGS.find((e) => loose(e) === v) ?? (v === "cp949" ? "euc-kr" : v === "sjis" || v === "cp932" ? "shift_jis" : undefined);
  if (!found) throw new CliError(t("--encoding takes {list}, not \"{value}\"", { list: ENCODINGS.join(", "), value }), null, 2);
  return found;
}

/** Whether every string of the map is plain ASCII, which every encoding writes the same: an encoding then changes nothing. */
export function plainAsciiText(scn: Scenario): boolean {
  return scn.strings.strings.every((s) => s === null || /^[\x00-\x7f]*$/.test(s));
}

/**
 * Name and description read as `map strings import` reads a line: `<03>` and the like are the game's colour codes,
 * `\<` a plain bracket — for `map set`, `map new` and `map generate` alike.
 */
export const mapText = (given: string): string => unescapeStringText(given);

export function setHeader(doc: OpenedMap, given: HeaderOptions): FieldChange[] {
  const scn = doc.scenario;
  const out: FieldChange[] = [];
  const o = {
    ...given, name: given.name === undefined ? undefined : mapText(given.name), description: given.description === undefined ? undefined : mapText(given.description),
    version: given.version === undefined ? undefined : parseRevision(given.version), encoding: given.encoding === undefined ? undefined : parseEncoding(given.encoding),
  };
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
  // Plain ASCII text is the same bytes in every encoding, and a map does not record which it was written in (it is
  // read from the text): the change would not stick, so it is not made.
  if (o.encoding !== undefined && !plainAsciiText(scn)) {
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

/** Something the resize dropped: what, whose, where it was (pixels, before the move). */
export interface DroppedThing { kind: "unit" | "sprite" | "doodad"; name: string; owner: number; x: number; y: number }

export interface ResizeOutcome extends ResizeResult {
  from: { width: number; height: number }; to: { width: number; height: number };
  /** Every unit, sprite and doodad that fell outside, in file order; start locations among the units. */
  dropped: DroppedThing[];
  /** Locations pulled inside that came out with no width or height (clamped), or left past the edge (`--no-clamp`). */
  collapsed: string[];
  outside: string[];
}

/** Scenario ▸ Resize: the map moved under the anchor, the new ground base terrain (no tileset here, as the editor without game data). */
export function resizeMap(doc: OpenedMap, o: { width: number; height: number; anchor: number; clampLocations: boolean }): ResizeOutcome {
  const scn = doc.scenario;
  const from = { width: scn.width, height: scn.height };
  if (from.width === o.width && from.height === o.height) throw new CliError(t("{width} × {height} is the map's size already", { width: from.width, height: from.height }), null, 2);
  // What will fall off, worked out the way the resize moves things (it says only how many).
  const { dx, dy } = resizeOffset(from.width, from.height, o.width, o.height, o.anchor);
  const outside = (x: number, y: number) => x + dx * 32 < 0 || y + dy * 32 < 0 || x + dx * 32 >= o.width * 32 || y + dy * 32 >= o.height * 32;
  const dropped: DroppedThing[] = [
    ...scn.units.filter((u) => outside(u.x, u.y)).map((u) => ({ kind: "unit" as const, name: unitName(u.unitId), owner: u.owner, x: u.x, y: u.y })),
    ...scn.sprites.filter((x) => outside(x.x, x.y)).map((x) => ({ kind: "sprite" as const, name: x.flags & 0x1000 ? `sprite ${x.spriteId}` : unitName(x.spriteId), owner: x.owner, x: x.x, y: x.y })),
    ...scn.doodads.filter((x) => outside(x.x, x.y)).map((x) => ({ kind: "doodad" as const, name: `doodad ${x.doodadId}`, owner: x.owner, x: x.x, y: x.y })),
  ];
  const r = resizeScenario(scn, { width: o.width, height: o.height, anchor: o.anchor, fill: baseTerrain(null), tileset: null, era: scn.era, clampLocations: o.clampLocations, random: () => 0.5 });
  const w = o.width * 32, h = o.height * 32;
  const names = { collapsed: [] as string[], outside: [] as string[] };
  scn.locations.forEach((l, i) => {
    if (i === ANYWHERE_INDEX || !isLocationUsed(l)) return;
    const name = plainText(locationName(scn, i));
    if (o.clampLocations && (l.left === l.right || l.top === l.bottom)) names.collapsed.push(name);
    if (!o.clampLocations && [l.left, l.right].some((x) => x < 0 || x > w) || !o.clampLocations && [l.top, l.bottom].some((y) => y < 0 || y > h)) names.outside.push(name);
  });
  return { ...r, from, to: { width: scn.width, height: scn.height }, dropped, ...names };
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
