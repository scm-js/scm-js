/**
 * `scmjs map units` and `scmjs map locations`: the map's units and locations as rows a person or a model can point
 * at — a unit by its index in the file, a location by its name or its number — and the pieces `map edit` shares
 * with them: a unit type by name or id, a location by name or number, an area as pixels, tiles or a location, and
 * the units inside one. Nothing here needs the game's files: names are the editor's own tables.
 */
import type { OpenedMap } from "../../src/editor/mapFile";
import type { Scenario } from "../../src/formats/chk/scenario";
import { ANYWHERE_INDEX, isLocationUsed, type UnitRecord } from "../../src/formats/chk/sections/objects";
import { locationName } from "../../src/editor/locations";
import { UnitState, UnitUsed } from "../../src/editor/units";
import { unitName } from "../../src/data/units";
import { plainText } from "../../src/editor/textColors";
import { t } from "./i18n";
import { unitByName } from "./rush";
import { CliError, num, pc, table } from "./ui";

/** Pixels a tile. */
export const TILE = 32;
/** Rows `map units` prints before it cuts the list (`--all` lifts it), as the other listings do. */
export const UNIT_ROWS = 40;

/** A rectangle in map pixels; `right` and `bottom` are just outside it. */
export interface PixelRect { left: number; top: number; right: number; bottom: number }
/** A rectangle in tiles; `x1` and `y1` are just outside it. */
export interface TileRect { x0: number; y0: number; x1: number; y1: number }
/** A part of the map, given one way: pixels, tiles, or a location by name or number. */
export interface Area { rect?: PixelRect; tiles?: TileRect; location?: string | number }
/** Which units: every key given must hold. `unit` is a name or a units.dat id, `player` 1 to 12 (12 is neutral). */
export interface UnitFilter extends Area { unit?: string | number; player?: number }

/** The special properties a unit record can carry, by the word `map edit` sets them with. */
export const UNIT_STATES = [
  ["cloaked", UnitState.Cloaked], ["burrowed", UnitState.Burrowed], ["lifted", UnitState.InTransit],
  ["hallucinated", UnitState.Hallucinated], ["invincible", UnitState.Invincible],
] as const;

export interface UnitRow {
  /** The record's place in the file, 0 up: what `map edit` takes as an index. */
  index: number;
  id: number;
  unit: string;
  /** 1 to 12; 12 is neutral. */
  player: number;
  x: number;
  y: number;
  tileX: number;
  tileY: number;
  /** What the record sets beyond the type's defaults; absent when it sets nothing. */
  resources?: number;
  hitPoints?: number;
  shields?: number;
  energy?: number;
  hangar?: number;
  states?: string[];
}

export interface LocationRow {
  /** How triggers, `map dump` and `map diff` number it, 1 up: what `map edit` takes. */
  number: number;
  /** The slot in the file, 0 up. */
  index: number;
  name: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** The tiles it touches. */
  tiles: TileRect;
  /** Units whose centre is inside it. */
  units: number;
}

export interface UnitListing { file: string; total: number; matched: number; units: UnitRow[] }
export interface LocationListing { file: string; locations: LocationRow[] }

/** A location's name as it is compared and shown: without the game's colour codes. */
export const nameOf = (scn: Scenario, index: number) => plainText(locationName(scn, index));

/** "Player 3", or "Neutral" for 12, in the reader's language. */
export const playerLabel = (player: number) => (player === 12 ? t("Neutral") : t("Player {n}", { n: player }));

/** The unit type a name or id means; the words are `unitByName`'s, with exit 1 (a value in a list, not the command line). */
export function unitType(unit: string | number): number {
  try {
    return unitByName(String(unit));
  } catch (e) {
    if (e instanceof CliError) throw new CliError(e.message, e.hint);
    throw e;
  }
}

const boundsOf = (l: PixelRect): PixelRect => ({ left: Math.min(l.left, l.right), top: Math.min(l.top, l.bottom), right: Math.max(l.left, l.right), bottom: Math.max(l.top, l.bottom) });
const inside = (p: { x: number; y: number }, r: PixelRect) => p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom;

/** The tiles a pixel rectangle touches. */
export const tileRect = (r: PixelRect): TileRect => ({ x0: Math.floor(r.left / TILE), y0: Math.floor(r.top / TILE), x1: Math.ceil(r.right / TILE), y1: Math.ceil(r.bottom / TILE) });

/** The locations in use, in the file's order (Anywhere among them). */
export function locationRows(scn: Scenario): LocationRow[] {
  const rows: LocationRow[] = [];
  scn.locations.forEach((l, index) => {
    if (!isLocationUsed(l)) return;
    const box = boundsOf(l);
    rows.push({ number: index + 1, index, name: nameOf(scn, index), ...box, tiles: tileRect(box), units: scn.units.filter((u) => inside(u, box)).length });
  });
  return rows;
}

/**
 * The slot a name or a number means. A name is matched whole, then without regard to case; a number is the
 * location's number as triggers count it (1 up). A name two locations share, or one that is not there, is an error
 * that lists what the map has.
 */
export function locationIndex(scn: Scenario, ref: string | number): number {
  const used = scn.locations.map((l, i) => (isLocationUsed(l) ? i : -1)).filter((i) => i >= 0);
  const have = () => (used.length ? t("The map has {list}.", { list: used.slice(0, 12).map((i) => `${i + 1} "${nameOf(scn, i)}"`).join(", ") + (used.length > 12 ? ", …" : "") }) : t("The map has no locations."));
  const byNumber = (n: number) => {
    if (Number.isInteger(n) && used.includes(n - 1)) return n - 1;
    throw new CliError(t("There is no location {n}", { n }), have());
  };
  if (typeof ref === "number") return byNumber(ref);
  const exact = used.filter((i) => nameOf(scn, i) === ref);
  const found = exact.length ? exact : used.filter((i) => nameOf(scn, i).toLowerCase() === ref.toLowerCase());
  if (found.length === 1) return found[0];
  if (found.length > 1) throw new CliError(t("{n} locations are called \"{name}\": {list}", { n: found.length, name: ref, list: found.map((i) => i + 1).join(", ") }), t("Name it by its number."));
  if (/^\d+$/.test(ref.trim())) return byNumber(Number(ref));
  throw new CliError(t("No location is called \"{name}\"", { name: ref }), have());
}

/** The area given as `location`, `rect` or `tiles`, with only the keys given; undefined when none was. */
export function areaOf(a: { location?: string | number; rect?: PixelRect; tiles?: TileRect }): Area | undefined {
  const area: Area = {};
  if (a.location !== undefined) area.location = a.location;
  if (a.rect !== undefined) area.rect = a.rect;
  if (a.tiles !== undefined) area.tiles = a.tiles;
  return Object.keys(area).length ? area : undefined;
}

/**
 * An area as pixels, or null when none was given: `rect` as it is, `tiles` times 32, a location's box. Two of the
 * three at once, an empty or inverted rectangle, and one that leaves the map are errors.
 */
export function areaRect(scn: Scenario, area: Area): PixelRect | null {
  const given = [area.rect !== undefined && "rect", area.tiles !== undefined && "tiles", area.location !== undefined && "location"].filter(Boolean);
  if (given.length === 0) return null;
  if (given.length > 1) throw new CliError(t("{list} are given: an area is one of rect (pixels), tiles or location", { list: given.map((k) => `\`${k}\``).join(", ") }));
  if (area.location !== undefined) return boundsOf(scn.locations[locationIndex(scn, area.location)]);
  const r = area.rect ?? { left: area.tiles!.x0 * TILE, top: area.tiles!.y0 * TILE, right: area.tiles!.x1 * TILE, bottom: area.tiles!.y1 * TILE };
  const shown = area.rect ? `${r.left},${r.top}–${r.right},${r.bottom}` : `${area.tiles!.x0},${area.tiles!.y0}–${area.tiles!.x1},${area.tiles!.y1}`;
  if (r.right <= r.left || r.bottom <= r.top) throw new CliError(t("{rect} is empty: the right and bottom edges come after the left and top ones", { rect: shown }));
  if (r.left < 0 || r.top < 0 || r.right > scn.width * TILE || r.bottom > scn.height * TILE) {
    throw new CliError(area.rect
      ? t("{rect} leaves the map, which is {w} × {h} pixels", { rect: shown, w: scn.width * TILE, h: scn.height * TILE })
      : t("{rect} leaves the map, which is {w} × {h} tiles", { rect: shown, w: scn.width, h: scn.height }));
  }
  return r;
}

/** Whether a point is inside a pixel rectangle (its right and bottom edges are outside). */
export const within = inside;

/** The indices of the units a filter holds for, in file order. A filter with nothing in it holds for every unit. */
export function unitsWhere(scn: Scenario, filter: UnitFilter): number[] {
  const id = filter.unit === undefined ? null : unitType(filter.unit);
  if (filter.player !== undefined && !(Number.isInteger(filter.player) && filter.player >= 1 && filter.player <= 12)) throw new CliError(t("`player` is 1 to 12 (12 is neutral), not {value}", { value: String(filter.player) }));
  const box = areaRect(scn, filter);
  const out: number[] = [];
  scn.units.forEach((u, i) => {
    if (id !== null && u.unitId !== id) return;
    if (filter.player !== undefined && u.owner !== filter.player - 1) return;
    if (box && !inside(u, box)) return;
    out.push(i);
  });
  return out;
}

/** A unit record as a row: what it is, whose, where, and the properties the record says are set. */
export function unitRow(u: UnitRecord, index: number): UnitRow {
  const row: UnitRow = { index, id: u.unitId, unit: unitName(u.unitId), player: u.owner + 1, x: u.x, y: u.y, tileX: Math.floor(u.x / TILE), tileY: Math.floor(u.y / TILE) };
  if (u.resourceAmount) row.resources = u.resourceAmount;
  if (u.validStates & UnitUsed.HitPoints && u.hitPointsPercent !== 100) row.hitPoints = u.hitPointsPercent;
  if (u.validStates & UnitUsed.Shields && u.shieldPercent !== 100) row.shields = u.shieldPercent;
  if (u.validStates & UnitUsed.Energy && u.energyPercent !== 100) row.energy = u.energyPercent;
  if (u.hangarUnits) row.hangar = u.hangarUnits;
  const states = UNIT_STATES.filter(([, bit]) => u.stateFlags & bit).map(([word]) => word);
  if (states.length) row.states = states;
  return row;
}

/** The map's units a filter holds for, as rows. */
export function listUnits(doc: OpenedMap, file: string, filter: UnitFilter = {}): UnitListing {
  const scn = doc.scenario;
  const units = unitsWhere(scn, filter).map((i) => unitRow(scn.units[i], i));
  return { file, total: scn.units.length, matched: units.length, units };
}

/** The map's locations, as rows. */
export function listLocations(doc: OpenedMap, file: string): LocationListing {
  return { file, locations: locationRows(doc.scenario) };
}

/** What a row sets, in a few words: "resources 1500, hp 50%, burrowed". */
export function unitProperties(u: UnitRow): string {
  return [
    u.resources !== undefined && t("resources {n}", { n: u.resources }),
    u.hitPoints !== undefined && t("hp {n}%", { n: u.hitPoints }),
    u.shields !== undefined && t("shields {n}%", { n: u.shields }),
    u.energy !== undefined && t("energy {n}%", { n: u.energy }),
    u.hangar !== undefined && t("hangar {n}", { n: u.hangar }),
    ...(u.states ?? []),
  ].filter(Boolean).join(", ");
}

/** The unit rows as lines: a count, then index, type, owner, pixels, tile and properties, cut at `UNIT_ROWS` unless `all`. */
export function printUnits(name: string, r: UnitListing, all = false): string[] {
  const head = r.matched === r.total
    ? t("{n, plural, one {# unit} other {# units}}", { n: r.total })
    : t("{matched} of {n, plural, one {# unit} other {# units}}", { matched: num(r.matched), n: r.total });
  const lines = [`${pc.bold(name)}  ${head}`];
  const shown = all ? r.units : r.units.slice(0, UNIT_ROWS);
  if (shown.length) {
    lines.push(...table([
      // (An empty cell is left uncoloured: colour codes round nothing would keep the row's padding from being trimmed.)
      [...[t("index"), t("unit"), t("player"), t("x,y"), t("tile")].map((h) => pc.dim(h)), ""],
      ...shown.map((u) => { const props = unitProperties(u); return [String(u.index), u.unit, playerLabel(u.player), `${u.x},${u.y}`, `${u.tileX},${u.tileY}`, props ? pc.dim(props) : ""]; }),
    ], 2));
  }
  if (r.units.length > shown.length) lines.push(pc.dim(`  ${t("… and {n} more (--all lists them)", { n: num(r.units.length - shown.length) })}`));
  return lines;
}

/** The location rows as lines: number, name, the box in pixels and in tiles, the units inside. */
export function printLocations(name: string, r: LocationListing): string[] {
  const placed = r.locations.filter((l) => l.index !== ANYWHERE_INDEX).length;
  const lines = [`${pc.bold(name)}  ${t("{n, plural, one {# location} other {# locations}}", { n: placed })}${placed !== r.locations.length ? pc.dim(t(", and Anywhere")) : ""}`];
  if (r.locations.length) {
    lines.push(...table([
      [t("number"), t("name"), t("pixels"), t("tiles"), t("units")].map((h) => pc.dim(h)),
      ...r.locations.map((l) => [String(l.number), l.name, `${l.left},${l.top}–${l.right},${l.bottom}`, `${l.tiles.x0},${l.tiles.y0}–${l.tiles.x1},${l.tiles.y1}`, String(l.units)]),
    ], 2));
  }
  return lines;
}
