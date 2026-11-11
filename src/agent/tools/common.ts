/**
 * Helpers every tool file shares: finding the open map, the numbering the tools speak
 * (players 1–12 and locations 1–255, as the game and the trigger text count them; record
 * indices 0-based, as the editor stores them), compact rows, and the two write paths.
 */
import type { EditResult, EditTransaction, PluginApi, ReadonlyScenario, Rect, UpdateResult, UpdateTransaction } from "../../plugins/api";
import { arr, int, obj, str, tileRect, type JsonSchema } from "../schema";
import { ToolError, type ToolContext } from "./types";

export const TILE = 32;
export const ANYWHERE = 64;

export function requireMap(api: PluginApi): ReadonlyScenario {
  const scn = api.document.scenario();
  if (!scn) throw new ToolError("No map is open. Ask the user to open one, or create one with new_map.");
  return scn;
}

export function requireWritable(api: PluginApi): ReadonlyScenario {
  const scn = requireMap(api);
  if (api.document.info()?.viewOnly) throw new ToolError("This map is open to look at only (a replay's map or a preview). Nothing on it can be changed.");
  return scn;
}

/** Player 1–12 (as the game counts) to the 0-based owner byte. */
export function ownerOf(player: number): number {
  if (!Number.isInteger(player) || player < 1 || player > 12) throw new ToolError(`Player ${player} does not exist: players are 1 to 12 (12 is the neutral player).`);
  return player - 1;
}

/** A 1-based location number to its record index, checked against the map. */
export function locationIndex(scn: ReadonlyScenario, number: number): number {
  if (!Number.isInteger(number) || number < 1 || number > scn.locations.length) {
    throw new ToolError(`There is no location ${number}. This map has slots 1 to ${scn.locations.length}; list_locations shows the ones in use.`);
  }
  return number - 1;
}

/** A location slot holds a location when it has a name or a box (Anywhere aside). */
export function locationInUse(scn: ReadonlyScenario, index: number): boolean {
  const l = scn.locations[index];
  if (!l || index === ANYWHERE - 1) return false;
  return l.nameIndex !== 0 || l.left !== 0 || l.top !== 0 || l.right !== 0 || l.bottom !== 0;
}

export function checkRect(scn: ReadonlyScenario, r: Rect, what = "area"): Rect {
  const x0 = Math.max(0, Math.min(r.x0, r.x1));
  const x1 = Math.min(scn.width, Math.max(r.x0, r.x1));
  const y0 = Math.max(0, Math.min(r.y0, r.y1));
  const y1 = Math.min(scn.height, Math.max(r.y0, r.y1));
  if (x1 <= x0 || y1 <= y0) throw new ToolError(`The ${what} ${JSON.stringify(r)} is empty or off the map (the map is ${scn.width} × ${scn.height} tiles).`);
  return { x0, y0, x1, y1 };
}

export const json = (value: unknown): string => JSON.stringify(value);

/** Keep one result from flooding the context; the model is told how to ask for the rest. */
export function cap(text: string, max = 60_000, hint = "Ask for a smaller range to see the rest."): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters cut. ${hint})`;
}

/* ── Writes ─────────────────────────────────────────────── */

/** `document.edit` under the agent's label: terrain and objects, one undo entry, rolled back if `build` throws. */
export function runEdit(ctx: ToolContext, label: string, build: (tx: EditTransaction) => void): EditResult {
  requireWritable(ctx.api);
  try {
    return ctx.api.document.edit(ctx.label(label), build);
  } catch (err) {
    throw err instanceof ToolError ? err : new ToolError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * `document.update` under the agent's label. An update is not rolled back on a throw, so
 * when the builder fails after writing something (a trigger text that interned strings
 * and then failed to parse), the partial entry is undone here: a failed tool call leaves
 * the map as it was.
 */
export function runUpdate(ctx: ToolContext, label: string, build: (tx: UpdateTransaction) => void): UpdateResult {
  requireWritable(ctx.api);
  const full = ctx.label(label);
  const before = ctx.api.document.history().undoDepth;
  try {
    return ctx.api.document.update(full, build);
  } catch (err) {
    const h = ctx.api.document.history();
    if (h.undoDepth > before && h.undo === full) ctx.api.document.undo();
    throw err instanceof ToolError ? err : new ToolError(err instanceof Error ? err.message : String(err));
  }
}

/* ── Units ──────────────────────────────────────────────── */

export function unitRow(api: PluginApi, scn: ReadonlyScenario, index: number): Record<string, unknown> {
  const u = scn.units[index];
  const { used, valid, state } = api.consts.unit;
  const row: Record<string, unknown> = {
    index, unitId: u.unitId, name: api.names.unit(u.unitId), player: u.owner + 1,
    x: u.x, y: u.y, tile: [Math.floor(u.x / TILE), Math.floor(u.y / TILE)],
  };
  if (u.validStates & used.HitPoints && u.hitPointsPercent !== 100) row.hitPoints = u.hitPointsPercent;
  if (u.validStates & used.Shields && u.shieldPercent !== 100) row.shields = u.shieldPercent;
  if (u.validStates & used.Energy && u.energyPercent !== 100) row.energy = u.energyPercent;
  if (u.validStates & used.Resources) row.resources = u.resourceAmount;
  if (u.validStates & used.Hangar && u.hangarUnits) row.hangar = u.hangarUnits;
  const states = (Object.keys(state) as (keyof typeof state)[])
    .filter((k) => (u.stateFlags & state[k]) !== 0 && (u.validProperties & valid[k === "Cloaked" ? "Cloak" : k === "Burrowed" ? "Burrow" : k]) !== 0);
  if (states.length) row.states = states.map((s) => s.toLowerCase());
  if (u.relatedSerial) row.linkedTo = u.relatedSerial;
  return row;
}

export interface UnitFilter {
  indices?: number[];
  player?: number;
  unitIds?: number[];
  name?: string;
  area?: Rect;
}

export const unitFilterSchema = (description: string): JsonSchema => obj({
  indices: arr(int(undefined, 0), "Unit record indices, as list_units gives them."),
  player: int("Only this player's units (1–12).", 1, 12),
  unitIds: arr(int(undefined, 0, 65535), "Only these unit types."),
  name: str("Only unit types whose name contains this text, any case (\"zergling\", \"Mineral\")."),
  area: tileRect("Only units whose centre lies in this tile rectangle."),
}, [], description);

/** The units a filter names; every field narrows, and an empty filter matches nothing (never "all" by accident). */
export function selectUnits(api: PluginApi, scn: ReadonlyScenario, f: UnitFilter): number[] {
  const any = f.indices !== undefined || f.player !== undefined || f.unitIds !== undefined || f.name !== undefined || f.area !== undefined;
  if (!any) throw new ToolError("Name the units: give indices, a player, unit types, a name or an area.");
  let out = f.indices ? f.indices.filter((i) => i >= 0 && i < scn.units.length) : scn.units.map((_, i) => i);
  if (f.indices && out.length !== f.indices.length) {
    const bad = f.indices.filter((i) => i < 0 || i >= scn.units.length);
    throw new ToolError(`No unit record at ${bad.join(", ")}: the map has ${scn.units.length} units (indices 0–${scn.units.length - 1}). Indices shift after units are deleted; list them again.`);
  }
  if (f.player !== undefined) { const owner = ownerOf(f.player); out = out.filter((i) => scn.units[i].owner === owner); }
  if (f.unitIds) { const ids = new Set(f.unitIds); out = out.filter((i) => ids.has(scn.units[i].unitId)); }
  if (f.name) { const q = f.name.toLowerCase(); out = out.filter((i) => api.names.unit(scn.units[i].unitId).toLowerCase().includes(q)); }
  if (f.area) { const inside = new Set(api.query.unitsIn(checkRect(scn, f.area))); out = out.filter((i) => inside.has(i)); }
  return out;
}

/** The rect around some unit records, in tiles, for flashing them. */
export function unitsRect(scn: ReadonlyScenario, indices: readonly number[]): Rect | undefined {
  if (indices.length === 0) return undefined;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of indices) {
    const u = scn.units[i];
    if (!u) continue;
    x0 = Math.min(x0, u.x); y0 = Math.min(y0, u.y); x1 = Math.max(x1, u.x); y1 = Math.max(y1, u.y);
  }
  if (!Number.isFinite(x0)) return undefined;
  return { x0: Math.floor(x0 / TILE), y0: Math.floor(y0 / TILE), x1: Math.floor(x1 / TILE) + 1, y1: Math.floor(y1 / TILE) + 1 };
}

/** Case-insensitive lookups the tools offer by name as well as by number. */
export function unitIdByName(api: PluginApi, name: string): number {
  const q = name.trim().toLowerCase();
  const all = api.names.units();
  const exact = all.find((u) => u.label.toLowerCase() === q);
  if (exact) return exact.value;
  const partial = all.filter((u) => u.label.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0].value;
  if (partial.length > 1) throw new ToolError(`"${name}" matches ${partial.length} unit types: ${partial.slice(0, 12).map((u) => `${u.label} (${u.value})`).join(", ")}. Use the exact name or the id.`);
  throw new ToolError(`No unit type is called "${name}". lookup with what "units" lists them.`);
}

export function stringOf(api: PluginApi, index: number): string {
  return index > 0 ? api.names.string(index) ?? "" : "";
}
