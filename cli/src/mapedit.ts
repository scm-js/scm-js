/**
 * `scmjs map edit <map> --edits edits.json`: a list of changes to the map's objects — units placed, moved, changed
 * and removed, locations added, changed and removed, sprites, fog — applied as one step, or not at all. The list is
 * JSON, made for a program (an AI tool through `map_edit`, a script) rather than typed by hand.
 *
 * The changes go through the editor's own plugin host with no editor around it (`run.ts#openHost`): one
 * `api.document.edit`, the transaction a plugin gets, so a unit is placed and a location named exactly as a plugin
 * would do it. An edit that cannot be done throws inside the transaction, which takes back what the earlier edits
 * did; nothing is written, and the error names the edit by its place in the list (`edits[2]`).
 *
 * The host has no game data here, so what needs the game's files is not offered: doodads (their tiles are in the
 * tileset's doodad table) and the placement checks. A position is taken as given.
 */
import { z } from "zod";
import type { OpenedMap } from "../../src/editor/mapFile";
import type { SpriteRecord, UnitRecord } from "../../src/formats/chk/sections/objects";
import { unitName } from "../../src/data/units";
import { diffMaps, printDiff, summarizeDiff, type MapDiff } from "./diff";
import { writeBack, type Written } from "./exchange";
import { loadMapInput, toStdout, STDIO, type Input } from "./files";
import { t } from "./i18n";
import { areaRect, locationIndex, nameOf, playerLabel, TILE, tileRect, UNIT_STATES, unitsWhere, unitType, within, type PixelRect } from "./objects";
import { openHost, type EditTransaction, type PluginApi } from "./run";
import { CliError, dot, mark, num, pc, size } from "./ui";

/* ── The list's shape ───────────────────────────────────────── */

const upTo = (most: number) => z.number().int().min(0).max(most);
/** A pixel or a tile on the largest map (256 tiles of 32 pixels). */
const pixel = upTo(256 * 32), tile = upTo(256);
const player = z.number().int().min(1).max(12);
const unitRef = z.union([z.string().min(1), upTo(0xffff)]);
const locationRef = z.union([z.string().min(1), z.number().int().min(1).max(255)]);
const rect = z.strictObject({ left: pixel, top: pixel, right: pixel, bottom: pixel });
const tiles = z.strictObject({ x0: tile, y0: tile, x1: tile, y1: tile });
const area = { rect: rect.optional(), tiles: tiles.optional(), location: locationRef.optional() };
const at = { x: pixel.optional(), y: pixel.optional(), tileX: tile.optional(), tileY: tile.optional() };
const percent = upTo(100).optional();
const properties = {
  hitPoints: percent, shields: percent, energy: percent, resources: upTo(0xffffffff).optional(), hangar: upTo(0xffff).optional(),
  cloaked: z.boolean().optional(), burrowed: z.boolean().optional(), lifted: z.boolean().optional(), hallucinated: z.boolean().optional(), invincible: z.boolean().optional(),
};
const indices = z.array(upTo(0xffff)).min(1).optional();
const whichUnits = { indices, where: z.strictObject({ unit: unitRef.optional(), player: player.optional(), ...area }).optional() };

/** The fields of each kind of edit, by its `op`. */
const OPS = {
  place_unit: { unit: unitRef, player, ...at, ...properties },
  move_units: { ...whichUnits, ...at, dx: z.number().int().optional(), dy: z.number().int().optional() },
  update_units: { ...whichUnits, player: player.optional(), ...properties },
  remove_units: { ...whichUnits },
  add_location: { name: z.string().min(1), rect: rect.optional(), tiles: tiles.optional() },
  edit_location: { location: locationRef, name: z.string().min(1).optional(), rect: rect.optional(), tiles: tiles.optional() },
  remove_locations: { locations: z.array(locationRef).min(1) },
  place_sprite: { sprite: upTo(516).optional(), unit: unitRef.optional(), player: player.optional(), ...at, flipped: z.boolean().optional(), disabled: z.boolean().optional() },
  remove_sprites: { indices, where: z.strictObject({ sprite: upTo(0xffff).optional(), unit: unitRef.optional(), player: player.optional(), ...area }).optional() },
  set_fog: { players: z.array(z.number().int().min(1).max(8)).min(1), mode: z.enum(["fog", "clear"]), ...area },
} as const;

export const EDIT_OPS = Object.keys(OPS) as (keyof typeof OPS)[];

/** The words for an `op` that is none of the kinds: they say why doodads are not among them. */
const NOT_AN_OP = `\`op\` is one of ${EDIT_OPS.join(", ")} (doodads are not among them: they need the game's tileset files, which this does not read)`;

const fields = (keys: readonly string[]) => keys.map((k) => `\`${k}\``).join(", ");
/** An edit of one kind: its fields and no others, a stray one named with those it takes. */
const editOf = <K extends keyof typeof OPS>(op: K) => z.strictObject({ op: z.literal(op), ...OPS[op] }, {
  error: (issue) => (issue.code === "unrecognized_keys" ? `${fields(issue.keys)} ${issue.keys.length === 1 ? "is not a field" : "are not fields"} of ${op}: it takes ${fields(Object.keys(OPS[op]))}` : undefined),
});

/** One edit: the fields of its kind and no others. */
export const EDIT = z.discriminatedUnion("op", [
  editOf("place_unit"), editOf("move_units"), editOf("update_units"), editOf("remove_units"),
  editOf("add_location"), editOf("edit_location"), editOf("remove_locations"),
  editOf("place_sprite"), editOf("remove_sprites"), editOf("set_fog"),
], { error: () => NOT_AN_OP });

export type MapEdit = z.infer<typeof EDIT>;

/**
 * An edit as an AI tool is shown it (`map_edit`'s argument): one object holding every field any kind takes, each
 * once. The kinds as a `oneOf` of ten objects made 11 KB of schema, most of it `rect`, `tiles` and `where` again
 * and again; this is 3 KB, and a schema without `oneOf` is one every client reads. Which fields a kind takes is in
 * the tool's description, and `parseEdits` holds each edit to its kind's.
 */
export const EDIT_ARGUMENT = z.strictObject({
  op: z.enum(EDIT_OPS, { error: () => NOT_AN_OP }),
  unit: unitRef.optional().describe("a unit type: its name, or its units.dat id"),
  player: player.optional().describe("1 to 12; 12 is neutral"),
  x: pixel.optional().describe("a position in pixels, with y"), y: pixel.optional(),
  tileX: tile.optional().describe("a position as a tile (its centre), with tileY, in place of x and y"), tileY: tile.optional(),
  dx: z.number().int().optional().describe("move_units: pixels to move by, with dy"), dy: z.number().int().optional(),
  indices: indices.describe("units (or sprites) by index, counted before this call"),
  where: z.strictObject({ unit: unitRef.optional(), sprite: upTo(0xffff).optional(), player: player.optional(), ...area }).optional().describe("units (or sprites) that are all of these, in place of indices"),
  name: z.string().min(1).optional().describe("a location's name"),
  location: locationRef.optional().describe("a location: its name, or its number"),
  locations: z.array(locationRef).min(1).optional(),
  rect: rect.optional().describe("an area in pixels; right and bottom are just outside it"),
  tiles: tiles.optional().describe("an area in tiles; x1 and y1 are just outside it"),
  sprite: upTo(516).optional().describe("a sprites.dat id"),
  flipped: z.boolean().optional(), disabled: z.boolean().optional(),
  players: z.array(z.number().int().min(1).max(8)).min(1).optional().describe("set_fog: whose fog, 1 to 8"),
  mode: z.enum(["fog", "clear"]).optional(),
  hitPoints: percent.describe("percent"), shields: percent, energy: percent, resources: upTo(0xffffffff).optional(), hangar: upTo(0xffff).optional(),
  cloaked: z.boolean().optional(), burrowed: z.boolean().optional(), lifted: z.boolean().optional(), hallucinated: z.boolean().optional(), invincible: z.boolean().optional(),
}, { error: (issue) => (issue.code === "unrecognized_keys" ? `${fields(issue.keys)} ${issue.keys.length === 1 ? "is not a field" : "are not fields"} of an edit` : undefined) });

/** How an edit is named: its place in the list, from 0, as JSON counts. */
const place = (i: number) => `edits[${i}]`;

/**
 * The edits a JSON value holds: a list, or an object with the list as `edits` (the `map_edit` tool's argument, so
 * one file serves both). The first entry that is not an edit is refused with its place and what is wrong with it.
 */
export function parseEdits(value: unknown): MapEdit[] {
  const list = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { edits?: unknown }).edits) ? (value as { edits: unknown[] }).edits : null;
  const hint = t("A list such as [{ \"op\": \"place_unit\", \"unit\": \"Terran Marine\", \"player\": 1, \"x\": 400, \"y\": 1600 }]; scmjs map edit --help lists the kinds.");
  if (!list) throw new CliError(t("The edits are a JSON list, or an object with the list as \"edits\""), hint, 2);
  if (!list.length) throw new CliError(t("The list of edits is empty"), hint, 2);
  return list.map((entry, i) => {
    const r = EDIT.safeParse(entry);
    if (r.success) return r.data;
    const op = entry && typeof entry === "object" && typeof (entry as { op?: unknown }).op === "string" ? ` (${(entry as { op: string }).op})` : "";
    const said = r.error.issues.map((issue) => {
      const message = issue.message.replace(/^Invalid input: /, "");
      const path = issue.path.map((p, k) => (typeof p === "number" ? `[${p}]` : `${k ? "." : ""}${String(p)}`)).join("");
      return path && path !== "op" ? `\`${path}\`: ${message}` : message;
    });
    throw new CliError(`${place(i)}${op}: ${said.join("; ")}`, t("Nothing was changed."), 2);
  });
}

/* ── What each edit did ─────────────────────────────────────── */

interface Box { left: number; top: number; right: number; bottom: number }
interface LocationNamed { number: number; index: number; name: string }

/**
 * What an edit did. An `index` is the record's place in the map as it is written (null when a later edit of the same
 * list removed it); a `number` is a location's, as triggers count it.
 */
export type EditResult =
  | { op: "place_unit"; unit: string; player: number; x: number; y: number; index: number | null }
  | { op: "move_units" | "update_units" | "remove_units" | "remove_sprites"; matched: number; changed: number }
  | ({ op: "add_location" } & LocationNamed & Box)
  | ({ op: "edit_location"; changed: boolean } & LocationNamed & Box)
  | { op: "remove_locations"; removed: LocationNamed[] }
  | { op: "place_sprite"; kind: "pure" | "unit"; sprite: string; player: number; x: number; y: number; index: number | null }
  | { op: "set_fog"; mode: "fog" | "clear"; players: number[]; tiles: number };

export interface MapEditOutcome {
  /** One result an edit, in the list's order. */
  edits: EditResult[];
  /** Whether the map is different for them. */
  modified: boolean;
  /** The change as `map diff` sees it, when there is one. */
  diff: MapDiff | null;
  written: Written | null;
}

export interface EditOptions {
  /** Where the map goes; null writes over the input. */
  out?: string | null;
  /** Apply the edits in memory, say what they change and write nothing. */
  dryRun?: boolean;
}

/** An edit that cannot be done: the list stops there and nothing is written. */
class Refused extends Error {}
const refuse = (message: string): never => { throw new Refused(message); };

/**
 * Which record is which while the list is applied. An index a caller gives is the record's place before the call, so
 * a removal earlier in the list does not shift what the later edits point at; the place a new record ends up in is
 * known only when the whole list is done.
 */
class Tracker<T extends object> {
  private readonly tags = new WeakMap<T, { was: number | null; placed: { index: number | null } | null }>();
  private readonly gone = new Map<number, number>();
  private readonly count: number;
  private readonly list: () => readonly T[];
  private readonly what: "unit" | "sprite";
  constructor(list: () => readonly T[], what: "unit" | "sprite") {
    this.list = list;
    this.what = what;
    const now = list();
    this.count = now.length;
    now.forEach((r, i) => this.tags.set(r, { was: i, placed: null }));
  }
  /** Where the records at these indices (as the map had them before the call) are now. */
  pick(indices: readonly number[]): number[] {
    const now = new Map<number, number>();
    this.list().forEach((r, i) => { const was = this.tags.get(r)?.was; if (was !== null && was !== undefined) now.set(was, i); });
    return [...new Set(indices)].map((was) => {
      if (was >= this.count) {
        refuse(this.count === 0 ? (this.what === "unit" ? t("there is no unit {index}: the map has no units", { index: was }) : t("there is no sprite {index}: the map has no sprites", { index: was }))
          : this.what === "unit" ? t("there is no unit {index}: the map's units are 0 to {last}", { index: was, last: this.count - 1 }) : t("there is no sprite {index}: the map's sprites are 0 to {last}", { index: was, last: this.count - 1 }));
      }
      const at = now.get(was);
      if (at === undefined) refuse(this.what === "unit" ? t("unit {index} was removed by {edit}", { index: was, edit: place(this.gone.get(was) ?? 0) }) : t("sprite {index} was removed by {edit}", { index: was, edit: place(this.gone.get(was) ?? 0) }));
      return at!;
    });
  }
  /** The record now at `index` was placed by an edit, whose result takes its final index. */
  placed(index: number, result: { index: number | null }): void { this.tags.set(this.list()[index], { was: null, placed: result }); }
  /** A change that replaces the records at `indices` in place (an update makes a new record): the tags go with them. */
  carry<R>(indices: readonly number[], change: () => R): R {
    const before = indices.map((i) => this.list()[i]);
    const r = change();
    indices.forEach((i, k) => { const tag = this.tags.get(before[k]); const now = this.list()[i]; if (tag && now && now !== before[k]) this.tags.set(now, tag); });
    return r;
  }
  /** Records at `indices` are about to go, by the edit at `edit`. */
  removing(indices: readonly number[], edit: number): void {
    for (const i of indices) { const was = this.tags.get(this.list()[i])?.was; if (was !== null && was !== undefined) this.gone.set(was, edit); }
  }
  /** The list is done: each placed record's result takes the index it has now. */
  settle(): void { this.list().forEach((r, i) => { const tag = this.tags.get(r); if (tag?.placed) tag.placed.index = i; }); }
}

/* ── Applying ───────────────────────────────────────────────── */

type Position = { x?: number; y?: number; tileX?: number; tileY?: number };
type Properties = { hitPoints?: number; shields?: number; energy?: number; resources?: number; hangar?: number; cloaked?: boolean; burrowed?: boolean; lifted?: boolean; hallucinated?: boolean; invincible?: boolean };

/** A position in pixels: `x` and `y`, or the centre of the tile `tileX`, `tileY`; null when neither was given. */
function pointOf(e: Position, tx: EditTransaction): { x: number; y: number } | null {
  const pixels = e.x !== undefined || e.y !== undefined, tile = e.tileX !== undefined || e.tileY !== undefined;
  if (!pixels && !tile) return null;
  if (pixels && tile) refuse(t("a position is `x` and `y` (pixels) or `tileX` and `tileY`, not both"));
  if (pixels ? e.x === undefined || e.y === undefined : e.tileX === undefined || e.tileY === undefined) refuse(pixels ? t("`x` and `y` go together") : t("`tileX` and `tileY` go together"));
  const p = pixels ? { x: e.x!, y: e.y! } : { x: e.tileX! * TILE + TILE / 2, y: e.tileY! * TILE + TILE / 2 };
  if (p.x >= tx.width * TILE || p.y >= tx.height * TILE) {
    refuse(pixels ? t("{x},{y} is off the map, which is {w} × {h} pixels", { x: e.x!, y: e.y!, w: tx.width * TILE, h: tx.height * TILE }) : t("tile {x},{y} is off the map, which is {w} × {h} tiles", { x: e.tileX!, y: e.tileY!, w: tx.width, h: tx.height }));
  }
  return p;
}

/** The record fields an edit's properties set, with the bits that say each is set; null when it gives none. */
function propertiesOf(e: Properties, consts: PluginApi["consts"]): ((rec: UnitRecord) => Partial<UnitRecord>) | null {
  const { used, state, valid } = consts.unit;
  const bits = { cloaked: [state.Cloaked, valid.Cloak], burrowed: [state.Burrowed, valid.Burrow], lifted: [state.InTransit, valid.InTransit], hallucinated: [state.Hallucinated, valid.Hallucinated], invincible: [state.Invincible, valid.Invincible] } as const;
  const given = e.hitPoints !== undefined || e.shields !== undefined || e.energy !== undefined || e.resources !== undefined || e.hangar !== undefined || UNIT_STATES.some(([word]) => e[word] !== undefined);
  if (!given) return null;
  return (rec) => {
    const patch: Partial<UnitRecord> = {};
    let validStates = rec.validStates, stateFlags = rec.stateFlags, validProperties = rec.validProperties;
    if (e.hitPoints !== undefined) { patch.hitPointsPercent = e.hitPoints; validStates |= used.HitPoints; }
    if (e.shields !== undefined) { patch.shieldPercent = e.shields; validStates |= used.Shields; }
    if (e.energy !== undefined) { patch.energyPercent = e.energy; validStates |= used.Energy; }
    if (e.resources !== undefined) { patch.resourceAmount = e.resources; validStates |= used.Resources; }
    if (e.hangar !== undefined) { patch.hangarUnits = e.hangar; validStates |= used.Hangar; }
    for (const [word] of UNIT_STATES) {
      const on = e[word];
      if (on === undefined) continue;
      const [stateBit, validBit] = bits[word];
      stateFlags = on ? stateFlags | stateBit : stateFlags & ~stateBit;
      validProperties |= validBit;
      validStates |= used.State;
    }
    return { ...patch, validStates, stateFlags, validProperties };
  };
}

/** The area an edit names, in pixels: `rect`, `tiles` or a `location`; null when it names none. */
function boxOf(tx: EditTransaction, e: { rect?: PixelRect; tiles?: { x0: number; y0: number; x1: number; y1: number }; location?: string | number }): PixelRect | null {
  return areaRect(tx.scenario as OpenedMap["scenario"], e);
}

const named = (tx: EditTransaction, index: number): LocationNamed & Box => {
  const scn = tx.scenario as OpenedMap["scenario"];
  const l = scn.locations[index];
  return { number: index + 1, index, name: nameOf(scn, index), left: l.left, top: l.top, right: l.right, bottom: l.bottom };
};

/** Apply the list inside one transaction; a `Refused` (or the editor's own error) leaves at the edit that threw it. */
function applyEdits(api: PluginApi, tx: EditTransaction, edits: readonly MapEdit[], at: (i: number) => void): EditResult[] {
  const scn = tx.scenario as OpenedMap["scenario"];
  const units = new Tracker<UnitRecord>(() => scn.units, "unit");
  const sprites = new Tracker<SpriteRecord>(() => scn.sprites, "sprite");
  const anywhere = api.consts.location.anywhere;
  const results: EditResult[] = [];

  /** The units an edit points at, as they stand now: by index (before the call) or by what they are. */
  const unitsOf = (e: { indices?: number[]; where?: Parameters<typeof unitsWhere>[1] }): number[] => {
    if ((e.indices === undefined) === (e.where === undefined)) refuse(t("name the units with `indices` or with `where`, one of the two"));
    if (e.indices) return units.pick(e.indices);
    if (!Object.keys(e.where!).length) refuse(t("an empty `where` is every unit on the map: give it a unit type, a player or an area"));
    return unitsWhere(scn, e.where!);
  };
  /** A location an edit may change: one in use that is not Anywhere. */
  const ownLocation = (ref: string | number): number => {
    const index = locationIndex(scn, ref);
    if (index === anywhere) refuse(t("Anywhere covers the whole map and cannot be changed or removed"));
    return index;
  };
  /** A name no other location has, so that the name goes on meaning one location. */
  const freeName = (name: string, except = -1) => {
    const other = scn.locations.findIndex((l, i) => i !== except && (l.nameIndex !== 0 || l.left !== l.right || l.top !== l.bottom) && nameOf(scn, i).toLowerCase() === name.toLowerCase());
    if (other >= 0) refuse(t("location {n} is already called \"{name}\"", { n: other + 1, name: nameOf(scn, other) }));
  };

  edits.forEach((e, i) => {
    at(i);
    switch (e.op) {
      case "place_unit": {
        const id = unitType(e.unit);
        const p = pointOf(e, tx) ?? refuse(t("say where: `x` and `y` (pixels), or `tileX` and `tileY`"));
        const rec = tx.makeUnit(id, e.player - 1, p.x, p.y);
        Object.assign(rec, propertiesOf(e, api.consts)?.(rec));
        const [index] = tx.addUnits([rec]);
        const result: EditResult = { op: e.op, unit: unitName(id), player: e.player, x: p.x, y: p.y, index: null };
        units.placed(index, result);
        results.push(result);
        break;
      }
      case "move_units": {
        const which = unitsOf(e);
        const to = pointOf(e, tx);
        const by = e.dx !== undefined || e.dy !== undefined;
        if ((to !== null) === by) refuse(to ? t("a move is to a position (`x` and `y`, or `tileX` and `tileY`) or by `dx` and `dy`, not both") : t("say where to: `x` and `y`, `tileX` and `tileY`, or `dx` and `dy` to move by"));
        if (to && which.length > 1) refuse(t("{n} units match, and a position is for one: move several by `dx` and `dy`", { n: which.length }));
        const dx = e.dx ?? 0, dy = e.dy ?? 0;
        for (const k of which) {
          const u = scn.units[k];
          if (!to && (u.x + dx < 0 || u.y + dy < 0 || u.x + dx >= tx.width * TILE || u.y + dy >= tx.height * TILE)) refuse(t("{unit} at {x},{y} would leave the map", { unit: unitName(u.unitId), x: u.x, y: u.y }));
        }
        const changed = units.carry(which, () => tx.updateUnits(which, (u) => (to ? to : { x: u.x + dx, y: u.y + dy })));
        results.push({ op: e.op, matched: which.length, changed });
        break;
      }
      case "update_units": {
        const which = unitsOf(e);
        const set = propertiesOf(e, api.consts);
        if (!set && e.player === undefined) refuse(t("nothing to change: give `player`, `hitPoints`, `shields`, `energy`, `resources`, `hangar` or a state"));
        const changed = units.carry(which, () => tx.updateUnits(which, (u) => ({ ...(e.player === undefined ? {} : { owner: e.player - 1 }), ...set?.(u) })));
        results.push({ op: e.op, matched: which.length, changed });
        break;
      }
      case "remove_units": {
        const which = unitsOf(e);
        units.removing(which, i);
        results.push({ op: e.op, matched: which.length, changed: tx.removeUnits(which) });
        break;
      }
      case "add_location": {
        const box = boxOf(tx, { rect: e.rect, tiles: e.tiles }) ?? refuse(t("say where: `rect` (pixels) or `tiles`"));
        freeName(e.name);
        const index = tx.addLocation(box, e.name);
        if (index < 0) refuse(t("the map's location table is full ({n} locations)", { n: scn.locations.length - 1 }));
        results.push({ op: e.op, ...named(tx, index) });
        break;
      }
      case "edit_location": {
        const index = ownLocation(e.location);
        const box = boxOf(tx, { rect: e.rect, tiles: e.tiles });
        if (!box && e.name === undefined) refuse(t("nothing to change: give `name`, `rect` or `tiles`"));
        if (e.name !== undefined) freeName(e.name, index);
        const changed = tx.editLocation(index, { ...(e.name === undefined ? {} : { name: e.name }), ...box });
        results.push({ op: e.op, changed, ...named(tx, index) });
        break;
      }
      case "remove_locations": {
        const which = [...new Set(e.locations.map(ownLocation))];
        const removed = which.map((index) => { const { number, name } = named(tx, index); return { number, index, name }; });
        tx.removeLocations(which);
        results.push({ op: e.op, removed });
        break;
      }
      case "place_sprite": {
        if ((e.sprite === undefined) === (e.unit === undefined)) refuse(t("give `sprite` (a sprites.dat id) or `unit` (a unit drawn as a sprite), one of the two"));
        const kind = e.unit === undefined ? "pure" : "unit";
        const id = e.unit === undefined ? e.sprite! : unitType(e.unit);
        if (kind === "pure" && e.disabled !== undefined) refuse(t("`disabled` is for a unit sprite"));
        const p = pointOf(e, tx) ?? refuse(t("say where: `x` and `y` (pixels), or `tileX` and `tileY`"));
        const who = e.player ?? 1;
        const index = tx.placeSprite(kind, id, who - 1, p.x, p.y, { flipped: e.flipped, disabled: e.disabled });
        const result: EditResult = { op: e.op, kind, sprite: kind === "unit" ? unitName(id) : `sprite ${id}`, player: who, x: p.x, y: p.y, index: null };
        sprites.placed(index, result);
        results.push(result);
        break;
      }
      case "remove_sprites": {
        if ((e.indices === undefined) === (e.where === undefined)) refuse(t("name the sprites with `indices` or with `where`, one of the two"));
        let which: number[];
        if (e.indices) which = sprites.pick(e.indices);
        else {
          const w = e.where!;
          if (!Object.keys(w).length) refuse(t("an empty `where` is every sprite on the map: give it a sprite, a unit, a player or an area"));
          if (w.sprite !== undefined && w.unit !== undefined) refuse(t("`sprite` and `unit` are two kinds of sprite: give one"));
          const unit = w.unit === undefined ? null : unitType(w.unit);
          const box = boxOf(tx, w);
          const pure = api.consts.sprite.flags.PureSprite;
          which = [];
          scn.sprites.forEach((s, k) => {
            const isPure = (s.flags & pure) !== 0;
            if (w.sprite !== undefined && !(isPure && s.spriteId === w.sprite)) return;
            if (unit !== null && !(!isPure && s.spriteId === unit)) return;
            if (w.player !== undefined && s.owner !== w.player - 1) return;
            if (box && !within(s, box)) return;
            which.push(k);
          });
        }
        sprites.removing(which, i);
        results.push({ op: e.op, matched: which.length, changed: tx.removeSprites(which) });
        break;
      }
      case "set_fog": {
        const box = boxOf(tx, e);
        const cells = box ? tileRect(box) : { x0: 0, y0: 0, x1: tx.width, y1: tx.height };
        const players = [...new Set(e.players)].sort((a, b) => a - b);
        results.push({ op: e.op, mode: e.mode, players, tiles: tx.setFog(cells, players.reduce((m, p) => m | (1 << (p - 1)), 0), e.mode) });
        break;
      }
    }
  });
  units.settle();
  sprites.settle();
  return results;
}

/**
 * Apply the edits to the map and write it back (unless `dryRun`). All of them or none: an edit that cannot be done
 * is a CliError naming it, and nothing is written. `input` is what `doc` was loaded from; it is read once more for
 * the comparison, with the same loader.
 */
export async function editMap(input: Input, doc: OpenedMap, edits: readonly MapEdit[], options: EditOptions = {}): Promise<MapEditOutcome> {
  const before = await loadMapInput(input);
  const host = openHost(doc, "map edit");
  try {
    let results: EditResult[] = [], current = 0;
    try {
      host.api.document.edit("map edit", (tx) => { results = applyEdits(host.api, tx, edits, (i) => { current = i; }); });
    } catch (e) {
      // The reason's own hint first (what the map has, how a unit is named), then what became of the list.
      const reason = e instanceof Error ? e.message : String(e);
      const hint = [e instanceof CliError ? e.hint : null, t("Nothing was changed: the edits are applied together or not at all.")].filter(Boolean).join(" ");
      throw new CliError(`${place(current)} (${edits[current].op}): ${reason}`, hint);
    }
    const modified = host.modified();
    const after = host.document();
    const name = input.name;
    const outcome: MapEditOutcome = { edits: results, modified, diff: modified ? diffMaps({ name, doc: before }, { name: options.out && options.out !== STDIO ? options.out : name, doc: after }) : null, written: null };
    // Changed, or --out named, or the map going down a pipe: the next step needs a map either way.
    if ((modified || options.out || toStdout(input.path, options.out)) && !options.dryRun) outcome.written = await writeBack(after, input.path, options.out ?? null);
    return outcome;
  } finally {
    host.dispose();
  }
}

/* ── Printing ───────────────────────────────────────────────── */

const box = (b: Box) => `${b.left},${b.top}–${b.right},${b.bottom}`;
const units = (n: number) => t("{n, plural, one {# unit} other {# units}}", { n });
const spriteCount = (n: number) => t("{n, plural, one {# sprite} other {# sprites}}", { n });

/** What an edit did, in a few words. */
export function editLine(r: EditResult): string {
  switch (r.op) {
    case "place_unit": return `${r.unit}${dot}${playerLabel(r.player)}${dot}${r.x},${r.y}${dot}${r.index === null ? t("removed again") : t("unit {index}", { index: r.index })}`;
    case "move_units": return r.matched ? t("{what} moved", { what: units(r.changed) }) + (r.changed < r.matched ? pc.dim(` ${t("({n} already there)", { n: r.matched - r.changed })}`) : "") : pc.yellow(t("no unit matches"));
    case "update_units": return r.matched ? t("{what} changed", { what: units(r.changed) }) + (r.changed < r.matched ? pc.dim(` ${t("({n} already so)", { n: r.matched - r.changed })}`) : "") : pc.yellow(t("no unit matches"));
    case "remove_units": return r.matched ? t("{what} removed", { what: units(r.changed) }) : pc.yellow(t("no unit matches"));
    case "add_location": return `${r.number}  ${r.name}${dot}${box(r)}`;
    case "edit_location": return `${r.number}  ${r.name}${dot}${box(r)}${r.changed ? "" : pc.dim(` ${t("(as it was)")}`)}`;
    case "remove_locations": return r.removed.map((l) => `${l.number}  ${l.name}`).join(", ");
    case "place_sprite": return `${r.kind === "unit" ? t("{unit} (unit sprite)", { unit: r.sprite }) : r.sprite}${dot}${playerLabel(r.player)}${dot}${r.x},${r.y}${dot}${r.index === null ? t("removed again") : t("sprite {index}", { index: r.index })}`;
    case "remove_sprites": return r.matched ? t("{what} removed", { what: spriteCount(r.changed) }) : pc.yellow(t("no sprite matches"));
    case "set_fog": return `${r.mode === "fog" ? t("{n, plural, one {# tile} other {# tiles}} fogged", { n: r.tiles }) : t("{n, plural, one {# tile} other {# tiles}} cleared", { n: r.tiles })}${dot}${r.players.map((p) => playerLabel(p)).join(", ")}`;
  }
}

/** Edits listed before the rest are cut (`--all` lists them). */
export const EDIT_ROWS = 40;

/**
 * The outcome as lines: a line an edit (its place in the list, its kind, what it did), with `dryRun` the change as
 * `map diff` prints it, then the closing line with the change in a few words and where the map went.
 */
export function printEdits(name: string, r: MapEditOutcome, { dryRun = false, all = false } = {}): string[] {
  const shown = all ? r.edits : r.edits.slice(0, EDIT_ROWS);
  const width = Math.max(0, ...shown.map((e) => e.op.length));
  const lines = shown.map((e, i) => `  ${pc.dim(`${String(i).padStart(String(r.edits.length - 1).length)}  ${e.op.padEnd(width)}`)}  ${editLine(e)}`);
  if (r.edits.length > shown.length) lines.push(pc.dim(`  ${t("… and {n} more (--all lists them)", { n: num(r.edits.length - shown.length) })}`));
  if (dryRun && r.diff) lines.push("", ...printDiff(r.diff, all), "");
  const count = t("{n, plural, one {# edit} other {# edits}}", { n: r.edits.length });
  // (A map linked to the editor is changed there, not on disk: link.ts.)
  const where = (w: Written) => (w.path === STDIO ? t("standard output") : w.live ? t("the editor, as one undo step") : pc.cyan(w.path));
  const written = r.written ? `${t("written to {where}", { where: where(r.written) })}${dot}${size(r.written.bytes)}` : null;
  if (!r.modified) lines.push(`${mark.ok} ${pc.bold(name)}: ${count}${dot}${written ? t("unchanged, written to {path}", { path: where(r.written!) }) : t("the map is unchanged")}`);
  else lines.push(`${dryRun ? mark.info : mark.ok} ${pc.bold(name)}: ${count}${dot}${r.diff ? summarizeDiff(r.diff) : t("changed")}${dot}${written ?? pc.dim(t("not written (--dry-run)"))}`);
  return lines;
}
