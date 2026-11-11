/**
 * Units on the map: listing them, placing them (one at a time or as a formation), changing
 * their owner, type and properties, moving and deleting them. Positions are map pixels,
 * the unit's centre, as the UNIT section stores them (32 to a tile); a tile (tx, ty) can be
 * given instead and means that tile's centre.
 */
import type { PluginApi, ReadonlyScenario, UnitRecord } from "../../plugins/api";
import { arr, bool, int, obj, str, tileRect, type JsonSchema } from "../schema";
import { cap, json, ownerOf, requireMap, runEdit, selectUnits, TILE, unitFilterSchema, unitIdByName, unitRow, unitsRect, type UnitFilter } from "./common";
import { ToolError, type AgentTool } from "./types";

interface UnitProps {
  hitPoints?: number;
  shields?: number;
  energy?: number;
  resources?: number;
  hangar?: number;
  cloaked?: boolean;
  burrowed?: boolean;
  liftedOff?: boolean;
  hallucinated?: boolean;
  invincible?: boolean;
}

const propsSchema: Record<string, JsonSchema> = {
  hitPoints: int("Hit points, percent of the type's maximum.", 0, 100),
  shields: int("Shields, percent.", 0, 100),
  energy: int("Energy, percent.", 0, 100),
  resources: int("Minerals or gas the resource holds (mineral fields default to 1500, geysers to 5000).", 0, 0xffffffff),
  hangar: int("Interceptors or scarabs aboard.", 0, 65535),
  cloaked: bool(), burrowed: bool(), liftedOff: bool("A Terran building that starts in the air."), hallucinated: bool(), invincible: bool(),
};

const STATES: [keyof UnitProps, "Cloaked" | "Burrowed" | "InTransit" | "Hallucinated" | "Invincible", "Cloak" | "Burrow" | "InTransit" | "Hallucinated" | "Invincible"][] = [
  ["cloaked", "Cloaked", "Cloak"], ["burrowed", "Burrowed", "Burrow"], ["liftedOff", "InTransit", "InTransit"],
  ["hallucinated", "Hallucinated", "Hallucinated"], ["invincible", "Invincible", "Invincible"],
];

/** A vital is its value plus its "used" bit; a state is its flag plus its "valid" bit (the game applies a state only with both). */
export function propsPatch(api: PluginApi, u: UnitRecord, p: UnitProps): Partial<UnitRecord> {
  const { used, valid, state } = api.consts.unit;
  const out: Partial<UnitRecord> = {};
  let vs = u.validStates, vp = u.validProperties, sf = u.stateFlags;
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, Math.round(v)));
  if (p.hitPoints !== undefined) { out.hitPointsPercent = clamp(p.hitPoints, 100); vs |= used.HitPoints; }
  if (p.shields !== undefined) { out.shieldPercent = clamp(p.shields, 100); vs |= used.Shields; }
  if (p.energy !== undefined) { out.energyPercent = clamp(p.energy, 100); vs |= used.Energy; }
  if (p.resources !== undefined) { out.resourceAmount = clamp(p.resources, 0xffffffff); vs |= used.Resources; }
  if (p.hangar !== undefined) { out.hangarUnits = clamp(p.hangar, 65535); vs |= used.Hangar; }
  for (const [key, s, v] of STATES) {
    const on = p[key];
    if (on === undefined) continue;
    vp |= valid[v];
    sf = on ? sf | state[s] : sf & ~state[s];
    vs |= used.State;
  }
  if (vs !== u.validStates) out.validStates = vs;
  if (vp !== u.validProperties) out.validProperties = vp;
  if (sf !== u.stateFlags) out.stateFlags = sf;
  return out;
}

function hasProps(p: UnitProps): boolean {
  return Object.keys(propsSchema).some((k) => (p as Record<string, unknown>)[k] !== undefined);
}

function resolveUnitId(api: PluginApi, spec: { unitId?: number; unitName?: string }): number {
  if (spec.unitId !== undefined) return spec.unitId;
  if (spec.unitName) return unitIdByName(api, spec.unitName);
  throw new ToolError("Give unitId or unitName for every unit.");
}

/** Where a position spec points, in map pixels. */
function point(scn: ReadonlyScenario, s: { x?: number; y?: number; tx?: number; ty?: number }): { x: number; y: number } {
  const x = s.x ?? (s.tx !== undefined ? s.tx * TILE + TILE / 2 : undefined);
  const y = s.y ?? (s.ty !== undefined ? s.ty * TILE + TILE / 2 : undefined);
  if (x === undefined || y === undefined) throw new ToolError("Give a position: x and y in pixels, or tx and ty in tiles.");
  if (x < 0 || y < 0 || x >= scn.width * TILE || y >= scn.height * TILE) throw new ToolError(`(${x}, ${y}) px is off the map (${scn.width * TILE} × ${scn.height * TILE} px).`);
  return { x, y };
}

/** `count` copies in a near-square block centred on the point, `spacing` pixels apart. */
function formation(api: PluginApi, unitId: number, centre: { x: number; y: number }, count: number, spacing?: number): { x: number; y: number }[] {
  if (count <= 1) return [centre];
  const size = api.palette.unitSize(unitId);
  const step = spacing ?? Math.max(16, Math.max(size.width, size.height) + 4);
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const out: { x: number; y: number }[] = [];
  for (let n = 0; n < count; n++) {
    const c = n % cols, r = Math.floor(n / cols);
    out.push({ x: Math.round(centre.x + (c - (cols - 1) / 2) * step), y: Math.round(centre.y + (r - (rows - 1) / 2) * step) });
  }
  return out;
}

const setSchema = obj({
  player: int("New owner, 1–12.", 1, 12),
  unitId: int("Change the unit type.", 0, 65535),
  ...propsSchema,
}, [], "What to change; fields left out stay as they are.");

export const unitTools: AgentTool[] = [
  {
    name: "list_units",
    description: "List placed units with their record index, type, owner (player 1–12), pixel position (centre), tile, and any non-default properties. Filter by player, type, name or tile area, and page with offset / limit. Record indices are what the other unit tools take; they shift when units are deleted.",
    schema: obj({
      player: int("Only this player's units.", 1, 12),
      unitIds: arr(int(undefined, 0, 65535)),
      name: str("Unit type name contains this, any case."),
      area: tileRect("Only units whose centre lies in this tile rectangle."),
      offset: int(undefined, 0),
      limit: int("Default 200.", 1, 2000),
      summary: bool("Only counts per player and type, no rows."),
    }),
    effect: "read",
    describe: (i) => `List units${i.player ? ` of Player ${i.player}` : ""}${i.name ? ` named "${i.name}"` : ""}`,
    run(i, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      const filter: UnitFilter = { player: i.player as number | undefined, unitIds: i.unitIds as number[] | undefined, name: i.name as string | undefined, area: i.area as UnitFilter["area"] };
      const any = filter.player !== undefined || filter.unitIds || filter.name || filter.area;
      const indices = any ? selectUnits(api, scn, filter) : scn.units.map((_, n) => n);
      if (i.summary) {
        const counts: Record<string, Record<string, number>> = {};
        for (const n of indices) {
          const u = scn.units[n];
          const p = `Player ${u.owner + 1}`;
          const name = api.names.unit(u.unitId);
          (counts[p] ??= {})[name] = (counts[p][name] ?? 0) + 1;
        }
        return json({ total: indices.length, byPlayer: counts });
      }
      const offset = (i.offset as number | undefined) ?? 0;
      const limit = (i.limit as number | undefined) ?? 200;
      const page = indices.slice(offset, offset + limit);
      return cap(json({ total: indices.length, offset, shown: page.length, units: page.map((n) => unitRow(api, scn, n)) }));
    },
  },
  {
    name: "check_unit_placement",
    description: "Whether a unit type can be placed centred at a point under the Units palette's placement checks (terrain, buildability, other units), and what blocks it.",
    schema: obj({ unitId: int(undefined, 0, 65535), unitName: str(), x: int("Pixels.", 0), y: int("Pixels.", 0), tx: int("Tile.", 0, 255), ty: int("Tile.", 0, 255) }),
    effect: "read",
    describe: (i) => `Check placement of ${i.unitName ?? `unit ${i.unitId}`}`,
    run(i, ctx) {
      const scn = requireMap(ctx.api);
      const id = resolveUnitId(ctx.api, i as { unitId?: number; unitName?: string });
      const p = point(scn, i as never);
      const v = ctx.api.query.placement(id, p.x, p.y);
      return json({ unit: ctx.api.names.unit(id), at: p, ok: !v?.problem, problem: v?.problem ?? null, reason: v?.reason ?? null });
    },
  },
  {
    name: "place_units",
    description: "Place units. Each entry is one unit type for one player at a point (x, y in pixels, or tx, ty for a tile's centre); `count` lays that many in a block around the point. Properties (hit points, resources, cloaked, invincible…) can be set at once. Buildings snap to the grid when the palette's snapping is on. With checkPlacement (the default) a unit the placement checks refuse is skipped and reported; with symmetry the units are also placed at their images under Tools ▸ Symmetry. Start locations are unit 214. All of it is one undo step.",
    schema: obj({
      units: arr(obj({
        unitId: int(undefined, 0, 65535),
        unitName: str("Instead of unitId: the type's name (\"Terran Marine\")."),
        player: int("Owner, 1–12 (12 is neutral; resources normally belong to 12).", 1, 12),
        x: int("Pixels.", 0), y: int("Pixels.", 0), tx: int("Tile.", 0, 255), ty: int("Tile.", 0, 255),
        count: int("How many, in a block around the point.", 1, 500),
        spacing: int("Pixels between units in the block.", 1, 512),
        ...propsSchema,
      }, ["player"]), "The units to place.", 500),
      checkPlacement: bool("Skip units the placement checks refuse. Default true."),
      symmetry: bool("Also place at the symmetry images. Default false."),
    }, ["units"]),
    effect: "write",
    describe: (i) => {
      const units = i.units as { unitName?: string; unitId?: number; count?: number; player: number }[];
      const total = units.reduce((n, u) => n + (u.count ?? 1), 0);
      const first = units[0];
      return units.length === 1 ? `Place ${total} × ${first.unitName ?? `unit ${first.unitId}`} for Player ${first.player}` : `Place ${total} units`;
    },
    run(i, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      const check = (i.checkPlacement as boolean | undefined) ?? true;
      const plan = (i.units as (UnitProps & { unitId?: number; unitName?: string; player: number; x?: number; y?: number; tx?: number; ty?: number; count?: number; spacing?: number })[]).map((u) => {
        const unitId = resolveUnitId(api, u);
        if (/^Unit #?\d+$/.test(api.names.unit(unitId)) && unitId > 227) throw new ToolError(`Unit type ${unitId} does not exist in this game's data.`);
        return { u, unitId, owner: ownerOf(u.player), at: formation(api, unitId, point(scn, u), u.count ?? 1, u.spacing) };
      });
      const placed: number[] = [];
      const skipped: string[] = [];
      const result = runEdit(ctx, `Place ${plan.reduce((n, p) => n + p.at.length, 0)} unit(s)`, (tx) => {
        for (const { u, unitId, owner, at } of plan) {
          for (const p0 of at) {
            const points = i.symmetry ? tx.mirrorPoint(p0.x, p0.y) : [p0];
            for (const p of points) {
              if (check && !tx.canPlaceUnit(unitId, p.x, p.y)) { skipped.push(`${api.names.unit(unitId)} at (${p.x}, ${p.y}): ${api.query.placement(unitId, p.x, p.y)?.reason ?? "refused by the placement checks"}`); continue; }
              const index = tx.placeUnit(unitId, owner, p.x, p.y);
              if (hasProps(u)) tx.updateUnits([index], (rec) => propsPatch(api, rec, u));
              placed.push(index);
            }
          }
        }
        if (placed.length === 0) throw new ToolError(`Nothing was placed. ${skipped.slice(0, 10).join("; ")}`);
      });
      const after = requireMap(api);
      ctx.touched({ units: placed, rect: unitsRect(after, placed) });
      return cap(json({ placed: placed.length, indices: placed, skipped: skipped.length ? skipped.slice(0, 40) : undefined, notes: result.notes.length ? result.notes : undefined }));
    },
  },
  {
    name: "update_units",
    description: "Change units chosen by a filter: their owner, type, hit points / shields / energy percent, resources, hangar, and the cloaked, burrowed, lifted-off, hallucinated and invincible states. One undo step.",
    schema: obj({ filter: unitFilterSchema("Which units."), set: setSchema }, ["filter", "set"]),
    effect: "write",
    describe: (i) => `Change units${(i.set as { player?: number }).player ? ` (give to Player ${(i.set as { player?: number }).player})` : ""}`,
    run(i, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      const indices = selectUnits(api, scn, i.filter as UnitFilter);
      if (indices.length === 0) throw new ToolError("No unit matches the filter.");
      const set = i.set as UnitProps & { player?: number; unitId?: number };
      const owner = set.player !== undefined ? ownerOf(set.player) : undefined;
      let changed = 0;
      runEdit(ctx, `Change ${indices.length} unit(s)`, (tx) => {
        changed = tx.updateUnits(indices, (u) => ({
          ...(owner !== undefined ? { owner } : {}),
          ...(set.unitId !== undefined ? { unitId: set.unitId } : {}),
          ...propsPatch(api, u, set),
        }));
      });
      ctx.touched({ units: indices, rect: unitsRect(requireMap(api), indices) });
      return json({ matched: indices.length, changed });
    },
  },
  {
    name: "move_units",
    description: "Move units chosen by a filter by a distance (dx, dy in pixels, or dtx, dty in tiles), or move one unit to a point. Buildings re-snap to the grid when snapping is on. One undo step.",
    schema: obj({
      filter: unitFilterSchema("Which units."),
      dx: int("Pixels.", -8192, 8192), dy: int("Pixels.", -8192, 8192),
      dtx: int("Tiles.", -256, 256), dty: int("Tiles.", -256, 256),
      to: obj({ x: int(undefined, 0), y: int(undefined, 0), tx: int(undefined, 0, 255), ty: int(undefined, 0, 255) }, [], "Only for a single unit: where its centre goes."),
    }, ["filter"]),
    effect: "write",
    describe: () => "Move units",
    run(i, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      const indices = selectUnits(api, scn, i.filter as UnitFilter);
      if (indices.length === 0) throw new ToolError("No unit matches the filter.");
      let dx = ((i.dx as number | undefined) ?? 0) + ((i.dtx as number | undefined) ?? 0) * TILE;
      let dy = ((i.dy as number | undefined) ?? 0) + ((i.dty as number | undefined) ?? 0) * TILE;
      if (i.to) {
        if (indices.length !== 1) throw new ToolError("`to` moves one unit; the filter matched " + indices.length + ".");
        const p = point(scn, i.to as never);
        dx = p.x - scn.units[indices[0]].x;
        dy = p.y - scn.units[indices[0]].y;
      }
      let moved = 0;
      runEdit(ctx, `Move ${indices.length} unit(s)`, (tx) => { moved = tx.moveUnits(indices, dx, dy); });
      ctx.touched({ units: indices, rect: unitsRect(requireMap(api), indices) });
      return json({ matched: indices.length, moved, by: { dx, dy } });
    },
  },
  {
    name: "delete_units",
    description: "Delete the units a filter chooses. One undo step. Record indices of the units after them shift down afterwards, so list again before using indices.",
    schema: obj({ filter: unitFilterSchema("Which units.") }, ["filter"]),
    effect: "destructive",
    describe: () => "Delete units",
    run(i, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      const indices = selectUnits(api, scn, i.filter as UnitFilter);
      if (indices.length === 0) throw new ToolError("No unit matches the filter.");
      const rect = unitsRect(scn, indices);
      const kinds: Record<string, number> = {};
      for (const n of indices) { const name = api.names.unit(scn.units[n].unitId); kinds[name] = (kinds[name] ?? 0) + 1; }
      let removed = 0;
      runEdit(ctx, `Delete ${indices.length} unit(s)`, (tx) => { removed = tx.removeUnits(indices); });
      if (rect) ctx.touched({ rect });
      return json({ removed, kinds });
    },
  },
];
