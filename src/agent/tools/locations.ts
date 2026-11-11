/**
 * Locations: the named boxes triggers test and act at. Tools number them 1–255 as the
 * trigger text and the game do (64 is Anywhere); the box can be given in tiles or pixels.
 */
import type { PluginApi, ReadonlyScenario } from "../../plugins/api";
import { arr, int, obj, str, tileRect } from "../schema";
import { ANYWHERE, checkRect, json, locationIndex, locationInUse, requireMap, runEdit, stringOf, TILE } from "./common";
import { ToolError, type AgentTool } from "./types";

const ELEVATIONS = ["low ground", "medium ground", "high ground", "low air", "medium air", "high air"] as const;
type Elevation = (typeof ELEVATIONS)[number];

function elevationBits(api: PluginApi, excluded: readonly Elevation[]): number {
  const e = api.consts.location.elevation;
  const bits: Record<Elevation, number> = {
    "low ground": e.LowGround, "medium ground": e.MediumGround, "high ground": e.HighGround,
    "low air": e.LowAir, "medium air": e.MediumAir, "high air": e.HighAir,
  };
  return excluded.reduce((n, name) => n | bits[name], 0);
}

function excludedOf(flags: number): Elevation[] {
  return ELEVATIONS.filter((_, bit) => (flags & (1 << bit)) !== 0);
}

function row(api: PluginApi, scn: ReadonlyScenario, index: number): Record<string, unknown> {
  const l = scn.locations[index];
  const out: Record<string, unknown> = {
    number: index + 1, name: stringOf(api, l.nameIndex) || `Location ${index + 1}`,
    tiles: { x0: Math.floor(Math.min(l.left, l.right) / TILE), y0: Math.floor(Math.min(l.top, l.bottom) / TILE), x1: Math.ceil(Math.max(l.left, l.right) / TILE), y1: Math.ceil(Math.max(l.top, l.bottom) / TILE) },
    pixels: { left: l.left, top: l.top, right: l.right, bottom: l.bottom },
  };
  if (l.right < l.left || l.bottom < l.top) out.inverted = true;
  if (l.elevationFlags) out.excludes = excludedOf(l.elevationFlags);
  return out;
}

const boxSchema = {
  area: tileRect("The box in tiles (x1, y1 exclusive)."),
  pixels: obj({ left: int(undefined, 0), top: int(undefined, 0), right: int(undefined, 0), bottom: int(undefined, 0) }, ["left", "top", "right", "bottom"], "The box in map pixels, for boxes that do not follow the tile grid."),
};

function boundsOf(scn: ReadonlyScenario, i: Record<string, unknown>): { left: number; top: number; right: number; bottom: number } | null {
  if (i.pixels) return i.pixels as { left: number; top: number; right: number; bottom: number };
  if (i.area) {
    const r = checkRect(scn, i.area as never, "location box");
    return { left: r.x0 * TILE, top: r.y0 * TILE, right: r.x1 * TILE, bottom: r.y1 * TILE };
  }
  return null;
}

/** Triggers that mention each location, so a delete can say what it would break. */
function usersOf(api: PluginApi, indices: readonly number[]): Record<number, number[]> {
  const want = new Set(indices);
  const out: Record<number, number[]> = {};
  for (const t of api.triggers.references()) {
    for (const r of t.refs) {
      if (r.kind !== "location" || !want.has(r.id)) continue;
      const users = (out[r.id + 1] ??= []);
      if (!users.includes(t.index)) users.push(t.index);
    }
  }
  return out;
}

export const locationTools: AgentTool[] = [
  {
    name: "list_locations",
    description: "The map's locations: number (what triggers and the other location tools use), name, box in tiles and pixels, and the elevations it excludes. Location 64 is Anywhere, the whole map.",
    schema: obj({ search: str("Only names containing this, any case.") }),
    effect: "read",
    describe: () => "List the locations",
    run(i, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      const q = (i.search as string | undefined)?.toLowerCase();
      const rows = scn.locations.map((_, n) => n).filter((n) => locationInUse(scn, n)).map((n) => row(api, scn, n))
        .filter((r) => !q || String(r.name).toLowerCase().includes(q));
      return json({ count: rows.length, slots: scn.locations.length, anywhere: ANYWHERE, locations: rows });
    },
  },
  {
    name: "create_location",
    description: "Add a location in the lowest free slot. Give its name and its box (tiles or pixels). Location names should be unique: the trigger text refers to locations by name. Returns its number.",
    schema: obj({
      name: str("The location's name."),
      ...boxSchema,
      excludeElevations: arr(str(undefined, ELEVATIONS), "Elevations units are NOT counted on (default: none excluded, so every unit counts)."),
    }, ["name"]),
    effect: "write",
    describe: (i) => `Create location "${i.name}"`,
    run(i, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      const bounds = boundsOf(scn, i);
      if (!bounds) throw new ToolError("Give the location's box: area (tiles) or pixels.");
      const name = i.name as string;
      const clash = scn.locations.findIndex((l, n) => locationInUse(scn, n) && stringOf(api, l.nameIndex) === name);
      let slot = -1;
      runEdit(ctx, `Create location "${name}"`, (tx) => {
        slot = tx.addLocation(bounds, name, elevationBits(api, (i.excludeElevations as Elevation[] | undefined) ?? []));
        if (slot < 0) throw new ToolError("The location table is full (every slot is in use).");
      });
      ctx.touched({ locations: [slot] });
      return json({ number: slot + 1, ...row(api, requireMap(api), slot), ...(clash >= 0 ? { warning: `Location ${clash + 1} already has this name; the trigger text will match the first one. Rename one of them.` } : {}) });
    },
  },
  {
    name: "edit_location",
    description: "Rename a location, move or resize its box (tiles or pixels), or change the elevations it excludes. Anywhere (64) cannot be changed.",
    schema: obj({
      number: int("The location's number.", 1, 255),
      name: str(),
      ...boxSchema,
      excludeElevations: arr(str(undefined, ELEVATIONS)),
    }, ["number"]),
    effect: "write",
    describe: (i) => `Change location ${i.number}${i.name ? ` → "${i.name}"` : ""}`,
    run(i, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      const index = locationIndex(scn, i.number as number);
      if (index === ANYWHERE - 1) throw new ToolError("Anywhere (location 64) is the whole map and cannot be edited.");
      const bounds = boundsOf(scn, i);
      let ok = false;
      runEdit(ctx, `Change location ${index + 1}`, (tx) => {
        ok = tx.editLocation(index, {
          ...(i.name !== undefined ? { name: i.name as string } : {}),
          ...bounds,
          ...(i.excludeElevations ? { elevationFlags: elevationBits(api, i.excludeElevations as Elevation[]) } : {}),
        });
      });
      if (!ok) throw new ToolError(`Location ${index + 1} could not be changed.`);
      ctx.touched({ locations: [index] });
      return json(row(api, requireMap(api), index));
    },
  },
  {
    name: "delete_locations",
    description: "Delete locations by number. Triggers that use them are not changed and will point at an empty slot; the result lists them so you can fix or remove them.",
    schema: obj({ numbers: arr(int(undefined, 1, 255), undefined, 255) }, ["numbers"]),
    effect: "destructive",
    describe: (i) => `Delete location(s) ${(i.numbers as number[]).join(", ")}`,
    run(i, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      const indices = (i.numbers as number[]).map((n) => locationIndex(scn, n));
      if (indices.includes(ANYWHERE - 1)) throw new ToolError("Anywhere (location 64) cannot be deleted.");
      const names = indices.map((n) => stringOf(api, scn.locations[n].nameIndex) || `Location ${n + 1}`);
      const users = usersOf(api, indices);
      let removed = 0;
      runEdit(ctx, `Delete ${indices.length} location(s)`, (tx) => { removed = tx.removeLocations(indices); });
      return json({ removed, names, ...(Object.keys(users).length ? { stillUsedByTriggers: users } : {}) });
    },
  },
];
