/**
 * Terrain and the other object layers: a readable terrain map, the isometric and flat
 * brushes, fills and replacement, doodads, sprites, fog of war, start locations, and the
 * two map-wide operations (resize, change tileset). Everything to do with terrain needs the
 * tileset graphics — the brushes are the editor's own, which work from the tileset's files.
 */
import type { Diamond, PluginApi, ReadonlyScenario, Rect, TerrainType, TilesetId } from "../../plugins/api";
import { arr, bool, int, obj, str, tileRect } from "../schema";
import { cap, checkRect, json, ownerOf, requireMap, requireWritable, runEdit, TILE } from "./common";
import { ToolError, type AgentTool } from "./types";

const ANCHORS = ["top-left", "top", "top-right", "left", "centre", "right", "bottom-left", "bottom", "bottom-right"] as const;
const CODES = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!$%&*+=<>?@^~";

async function needGraphics(api: PluginApi): Promise<void> {
  requireMap(api);
  if (!(await api.tileset.load().catch(() => false))) {
    throw new ToolError("The tileset graphics are not installed, so terrain cannot be read or painted. The user can add StarCraft's graphics from Help ▸ Game Data…; units, locations, triggers and settings work without them.");
  }
}

function terrainLabel(t: TerrainType): string {
  return t.label ?? t.name;
}

function resolveTerrain(api: PluginApi, value: number | string | undefined): TerrainType {
  const types = api.terrain.types();
  if (value === undefined) throw new ToolError("Name the terrain (lookup terrains lists this tileset's).");
  if (typeof value === "number") {
    const t = types.find((x) => x.id === value);
    if (!t) throw new ToolError(`No terrain ${value} on this tileset. Its terrains: ${types.map((x) => `${x.id} ${terrainLabel(x)}`).join(", ")}.`);
    return t;
  }
  const q = value.trim().toLowerCase();
  const exact = types.find((x) => terrainLabel(x).toLowerCase() === q || x.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = types.filter((x) => terrainLabel(x).toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  throw new ToolError(`"${value}" ${partial.length ? `matches ${partial.map(terrainLabel).join(", ")}` : "is not a terrain of this tileset"}. Its terrains: ${types.map((x) => `${x.id} ${terrainLabel(x)}`).join(", ")}.`);
}

const terrainArg = { terrainId: int("The terrain's id (lookup terrains).", 0, 65535), terrain: str("Or the terrain's name (\"High Dirt\", \"Water\").") };
const terrainOf = (api: PluginApi, i: Record<string, unknown>) => resolveTerrain(api, (i.terrainId as number | undefined) ?? (i.terrain as string | undefined));

/** Tile rows of an ellipse inscribed in the rect. */
function ellipseRows(r: Rect): { y: number; x0: number; x1: number }[] {
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const rx = (r.x1 - r.x0) / 2, ry = (r.y1 - r.y0) / 2;
  const out: { y: number; x0: number; x1: number }[] = [];
  for (let y = r.y0; y < r.y1; y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const half = rx * Math.sqrt(1 - dy * dy);
    const x0 = Math.max(r.x0, Math.round(cx - half)), x1 = Math.min(r.x1, Math.round(cx + half));
    if (x1 > x0) out.push({ y, x0, x1 });
  }
  return out;
}

function diamondsFor(api: PluginApi, r: Rect, shape: "rectangle" | "ellipse"): Diamond[] {
  if (shape === "rectangle") return api.terrain.diamondsIn(r);
  const seen = new Set<string>();
  const out: Diamond[] = [];
  for (const row of ellipseRows(r)) {
    for (const d of api.terrain.diamondsIn({ x0: row.x0, y0: row.y, x1: row.x1, y1: row.y + 1 })) {
      const k = `${d.x},${d.y}`;
      if (!seen.has(k)) { seen.add(k); out.push(d); }
    }
  }
  return out;
}

function doodadRow(api: PluginApi, scn: ReadonlyScenario, index: number): Record<string, unknown> {
  const d = scn.doodads[index];
  const info = api.palette.doodadInfo(d.doodadId);
  const w = info?.width ?? 1, h = info?.height ?? 1;
  return { index, doodadId: d.doodadId, name: info?.name ?? `Doodad ${d.doodadId}`, topLeftTile: [Math.round(d.x / TILE - w / 2), Math.round(d.y / TILE - h / 2)], sizeTiles: [w, h], player: d.owner + 1, ...(d.disabled ? { disabled: true } : {}) };
}

function spriteRow(api: PluginApi, scn: ReadonlyScenario, index: number): Record<string, unknown> {
  const s = scn.sprites[index];
  const flags = api.consts.sprite.flags;
  const kind = s.flags & flags.PureSprite ? "pure" : "unit";
  return { index, spriteId: s.spriteId, kind, name: api.palette.spriteName(kind, s.spriteId), player: s.owner + 1, x: s.x, y: s.y, ...(s.flags & flags.Flipped ? { flipped: true } : {}), ...(s.flags & flags.Disabled ? { disabled: true } : {}) };
}

const inArea = (x: number, y: number, r: Rect | undefined) => !r || (x / TILE >= r.x0 && x / TILE < r.x1 && y / TILE >= r.y0 && y / TILE < r.y1);

export const terrainTools: AgentTool[] = [
  {
    name: "terrain_map",
    description: "The terrain as a character grid: one letter per tile (or per step × step block), with a legend naming each terrain (with its height level and whether it is buildable). Cliffs, ramps, shores and doodads show as the terrain the ISOM says they belong to. Use it to plan where things go and to check terrain edits; map_image shows the same visually.",
    schema: obj({ area: tileRect("Default: the whole map."), step: int("Tiles per character (default: 1, or 2 for maps wider than 128).", 1, 8) }),
    effect: "read",
    describe: (i) => i.area ? "Read the terrain of an area" : "Read the terrain map",
    async run(i, ctx) {
      const api = ctx.api;
      await needGraphics(api);
      const scn = requireMap(api);
      const r = i.area ? checkRect(scn, i.area as Rect) : { x0: 0, y0: 0, x1: scn.width, y1: scn.height };
      const step = (i.step as number | undefined) ?? (r.x1 - r.x0 > 128 ? 2 : 1);
      const types = new Map(api.terrain.types().map((t) => [t.id, t]));
      const code = new Map<number | null, string>();
      const counts = new Map<number | null, number>();
      const rows: string[] = [];
      for (let y = r.y0; y < r.y1; y += step) {
        let line = "";
        for (let x = r.x0; x < r.x1; x += step) {
          const id = api.terrain.terrainAt(x, y);
          if (!code.has(id)) code.set(id, id === null ? "." : CODES[code.size % CODES.length]);
          counts.set(id, (counts.get(id) ?? 0) + 1);
          line += code.get(id);
        }
        rows.push(`${String(y).padStart(3, " ")} ${line}`);
      }
      const ticks = Array.from({ length: Math.ceil((r.x1 - r.x0) / step) }, (_, n) => ((r.x0 + n * step) % 10 === 0 ? String(((r.x0 + n * step) / 10) % 10) : " ")).join("");
      const legend = [...code.entries()].map(([id, c]) => {
        if (id === null) return `${c} = unknown`;
        const t = types.get(id);
        return `${c} = ${t ? terrainLabel(t) : `terrain ${id}`} (id ${id}${t ? `, height ${t.height}${t.buildable ? ", buildable" : ""}` : ""}) ${counts.get(id)} cell(s)`;
      });
      return cap([`Area x ${r.x0}–${r.x1 - 1}, y ${r.y0}–${r.y1 - 1}; ${step} tile(s) per character. The tick row marks every 10th x (its tens digit).`, ...legend, "", `    ${ticks}`, ...rows].join("\n"), 70_000, "Ask for an area or a larger step.");
    },
  },
  {
    name: "paint_terrain",
    description: "Paint terrain over a tile rectangle, or the ellipse inside it, with the editor's brushes. The isometric brush (the default where the map has an ISOM lattice) lays StarEdit-style terrain with proper cliffs, ramps edges and shores between heights, in diamonds of 2×1 tiles, so edges come out slightly jagged. The flat brush lays plain tiles of one terrain with no transitions. One undo step.",
    schema: obj({
      ...terrainArg,
      area: tileRect(),
      shape: str("Default rectangle.", ["rectangle", "ellipse"]),
      brush: str("Default isometric when the map supports it.", ["isometric", "flat"]),
    }, ["area"]),
    effect: "write",
    describe: (i) => `Paint ${i.terrain ?? `terrain ${i.terrainId}`} over ${(i.area as Rect).x1 - (i.area as Rect).x0}×${(i.area as Rect).y1 - (i.area as Rect).y0} tiles`,
    async run(i, ctx) {
      const api = ctx.api;
      await needGraphics(api);
      const scn = requireWritable(api);
      const t = terrainOf(api, i);
      const r = checkRect(scn, i.area as Rect);
      const shape = (i.shape as "rectangle" | "ellipse" | undefined) ?? "rectangle";
      const iso = (i.brush as string | undefined) !== "flat" && api.terrain.hasIsom() && api.terrain.isomTypes().includes(t.id);
      if (i.brush === "isometric" && !iso) throw new ToolError(api.terrain.hasIsom() ? `${terrainLabel(t)} cannot be painted with the isometric brush on this tileset; use brush flat.` : "This map has no ISOM lattice, so only the flat brush works (or rebuild the ISOM in the editor first).");
      let failed = 0;
      const result = runEdit(ctx, `Paint ${terrainLabel(t)}`, (tx) => {
        if (iso) {
          for (const d of diamondsFor(api, r, shape)) if (!tx.paintIsom(d, t.id)) failed++;
        } else if (shape === "rectangle") {
          tx.fillFlat(r, t.id);
        } else {
          const cells: number[] = [];
          for (const row of ellipseRows(r)) for (let x = row.x0; x < row.x1; x++) cells.push(row.y * scn.width + x);
          tx.stampTerrain(cells, t.id);
        }
      });
      ctx.touched({ rect: r });
      return json({ terrain: terrainLabel(t), brush: iso ? "isometric" : "flat", tilesChanged: result.tiles, ...(failed ? { diamondsRefused: failed } : {}), notes: result.notes.length ? result.notes : undefined });
    },
  },
  {
    name: "fill_terrain",
    description: "The bucket fill: the connected area around a tile that has the same terrain (match terrain, the default) or the exact same tile (match tile) becomes the new terrain, laid flat.",
    schema: obj({ x: int("Tile x.", 0, 255), y: int("Tile y.", 0, 255), ...terrainArg, match: str(undefined, ["terrain", "tile"]) }, ["x", "y"]),
    effect: "write",
    describe: (i) => `Fill around tile ${i.x},${i.y} with ${i.terrain ?? `terrain ${i.terrainId}`}`,
    async run(i, ctx) {
      const api = ctx.api;
      await needGraphics(api);
      requireWritable(api);
      const t = terrainOf(api, i);
      let changed = 0;
      runEdit(ctx, `Fill with ${terrainLabel(t)}`, (tx) => { changed = tx.fillArea(i.x as number, i.y as number, { terrainId: t.id }, i.match as "terrain" | "tile" | undefined); });
      return json({ tilesChanged: changed });
    },
  },
  {
    name: "replace_terrain",
    description: "Tools ▸ Replace Terrain: every tile of one flat terrain becomes another, over an area or the whole map.",
    schema: obj({ from: str("Terrain name or id to replace."), to: str("Terrain name or id to lay instead."), area: tileRect("Default: the whole map.") }, ["from", "to"]),
    effect: "write",
    describe: (i) => `Replace ${i.from} with ${i.to}`,
    async run(i, ctx) {
      const api = ctx.api;
      await needGraphics(api);
      const scn = requireWritable(api);
      const asValue = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : v);
      const from = resolveTerrain(api, asValue(i.from as string));
      const to = resolveTerrain(api, asValue(i.to as string));
      const r = i.area ? checkRect(scn, i.area as Rect) : undefined;
      let changed = 0;
      runEdit(ctx, `Replace ${terrainLabel(from)} with ${terrainLabel(to)}`, (tx) => { changed = tx.replaceTerrain({ kind: "terrain", id: from.id }, { kind: "terrain", id: to.id }, r); });
      if (r) ctx.touched({ rect: r });
      return json({ tilesChanged: changed });
    },
  },
  {
    name: "list_doodads",
    description: "Placed doodads (trees, rocks, ramps, bridges, structures that are part of the terrain): index, id, name, top-left tile, size and owner.",
    schema: obj({ area: tileRect("Only doodads centred in this area.") }),
    effect: "read",
    describe: () => "List doodads",
    async run(i, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      await api.tileset.load().catch(() => false);
      const r = i.area as Rect | undefined;
      const rows = scn.doodads.map((_, n) => n).filter((n) => inArea(scn.doodads[n].x, scn.doodads[n].y, r)).map((n) => doodadRow(api, scn, n));
      return cap(json({ count: rows.length, doodads: rows }));
    },
  },
  {
    name: "place_doodads",
    description: "Place doodads by id or name (lookup doodads lists this tileset's, with their size) with their top-left tile. With checkGround (the default) a doodad whose required ground is not there is skipped and reported, as StarEdit would refuse it.",
    schema: obj({
      doodads: arr(obj({ doodadId: int(undefined, 0, 65535), name: str(), tx: int(undefined, 0, 255), ty: int(undefined, 0, 255), player: int("Owner; default 12 (neutral).", 1, 12) }, ["tx", "ty"]), undefined, 500),
      checkGround: bool("Default true."),
    }, ["doodads"]),
    effect: "write",
    describe: (i) => `Place ${(i.doodads as unknown[]).length} doodad(s)`,
    async run(i, ctx) {
      const api = ctx.api;
      await needGraphics(api);
      requireWritable(api);
      const all = api.palette.doodadCategories().flatMap((c) => c.doodads);
      const check = (i.checkGround as boolean | undefined) ?? true;
      const plan = (i.doodads as { doodadId?: number; name?: string; tx: number; ty: number; player?: number }[]).map((d) => {
        let id = d.doodadId;
        if (id === undefined && d.name) {
          const q = d.name.toLowerCase();
          id = (all.find((x) => x.name.toLowerCase() === q) ?? all.find((x) => x.name.toLowerCase().includes(q)))?.id;
        }
        if (id === undefined) throw new ToolError(`No doodad "${d.name ?? "?"}" on this tileset (lookup doodads).`);
        return { id, d };
      });
      const placed: number[] = [], skipped: string[] = [];
      runEdit(ctx, `Place ${plan.length} doodad(s)`, (tx) => {
        for (const { id, d } of plan) {
          if (check) {
            const v = api.query.doodadPlacement(id, d.tx, d.ty);
            if (v && !v.ok) { skipped.push(`${api.palette.doodadInfo(id)?.name ?? id} at ${d.tx},${d.ty}: ${v.outOfBounds ? "off the map" : `${v.bad.length} cell(s) lack the ground it needs`}`); continue; }
          }
          const n = tx.placeDoodad(id, d.tx, d.ty, ownerOf(d.player ?? 12));
          if (n < 0) skipped.push(`${id} at ${d.tx},${d.ty}: unknown or off the map`);
          else placed.push(n);
        }
      });
      if (plan.length) ctx.touched({ rect: { x0: Math.min(...plan.map((p) => p.d.tx)), y0: Math.min(...plan.map((p) => p.d.ty)), x1: Math.max(...plan.map((p) => p.d.tx)) + 4, y1: Math.max(...plan.map((p) => p.d.ty)) + 4 } });
      return json({ placed: placed.length, indices: placed, skipped: skipped.length ? skipped : undefined });
    },
  },
  {
    name: "delete_doodads",
    description: "Remove doodads by index, as list_doodads numbers them. Their records go and their tiles go back to the ground under them. One undo step.",
    schema: obj({ indices: arr(int(undefined, 0), undefined, 5000) }, ["indices"]),
    effect: "destructive",
    describe: (i) => `Delete ${(i.indices as unknown[]).length} doodad(s)`,
    run(i, ctx) {
      requireWritable(ctx.api);
      let removed = 0;
      runEdit(ctx, `Delete ${(i.indices as unknown[]).length} doodad(s)`, (tx) => { removed = tx.removeDoodads(i.indices as number[]); });
      return json({ removed });
    },
  },
  {
    name: "list_sprites",
    description: "Placed sprites: pure sprites (decorations) and unit sprites (doors, traps): index, id, kind, name, owner, pixel position, flipped / disabled.",
    schema: obj({ area: tileRect("Only sprites in this area.") }),
    effect: "read",
    describe: () => "List sprites",
    async run(i, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      await api.data.load().catch(() => false);
      const r = i.area as Rect | undefined;
      const rows = scn.sprites.map((_, n) => n).filter((n) => inArea(scn.sprites[n].x, scn.sprites[n].y, r)).map((n) => spriteRow(api, scn, n));
      return cap(json({ count: rows.length, sprites: rows }));
    },
  },
  {
    name: "place_sprites",
    description: "Place sprites: kind pure (a decoration, sprites.dat id — lookup sprites) or unit (a unit drawn as a sprite, such as a door, units.dat id), at a pixel point or a tile's centre.",
    schema: obj({
      sprites: arr(obj({
        spriteId: int(undefined, 0, 65535), kind: str(undefined, ["pure", "unit"]), player: int(undefined, 1, 12),
        x: int(undefined, 0), y: int(undefined, 0), tx: int(undefined, 0, 255), ty: int(undefined, 0, 255),
        flipped: bool(), disabled: bool("Unit sprites: start disabled (a closed door)."),
      }, ["spriteId", "kind", "player"]), undefined, 500),
    }, ["sprites"]),
    effect: "write",
    describe: (i) => `Place ${(i.sprites as unknown[]).length} sprite(s)`,
    run(i, ctx) {
      const api = ctx.api;
      const scn = requireWritable(api);
      const rows = i.sprites as { spriteId: number; kind: "pure" | "unit"; player: number; x?: number; y?: number; tx?: number; ty?: number; flipped?: boolean; disabled?: boolean }[];
      const placed: number[] = [];
      runEdit(ctx, `Place ${rows.length} sprite(s)`, (tx) => {
        for (const s of rows) {
          const x = s.x ?? (s.tx !== undefined ? s.tx * TILE + TILE / 2 : undefined);
          const y = s.y ?? (s.ty !== undefined ? s.ty * TILE + TILE / 2 : undefined);
          if (x === undefined || y === undefined || x >= scn.width * TILE || y >= scn.height * TILE) throw new ToolError("Every sprite needs a position on the map: x, y in pixels or tx, ty in tiles.");
          placed.push(tx.placeSprite(s.kind, s.spriteId, ownerOf(s.player), x, y, { flipped: s.flipped, disabled: s.disabled }));
        }
      });
      return json({ placed: placed.length, indices: placed });
    },
  },
  {
    name: "delete_sprites",
    description: "Remove sprites by index, as list_sprites numbers them. Indices after them shift down. One undo step.",
    schema: obj({ indices: arr(int(undefined, 0), undefined, 5000) }, ["indices"]),
    effect: "destructive",
    describe: (i) => `Delete ${(i.indices as unknown[]).length} sprite(s)`,
    run(i, ctx) {
      requireWritable(ctx.api);
      let removed = 0;
      runEdit(ctx, `Delete ${(i.indices as unknown[]).length} sprite(s)`, (tx) => { removed = tx.removeSprites(i.indices as number[]); });
      return json({ removed });
    },
  },
  {
    name: "set_fog",
    description: "Fog of war at the start of the game: fog (black until explored) or clear an area for some players.",
    schema: obj({ area: tileRect(), players: arr(int(undefined, 1, 12), undefined, 12), mode: str(undefined, ["fog", "clear"]) }, ["area", "players", "mode"]),
    effect: "write",
    describe: (i) => `${i.mode === "fog" ? "Fog" : "Clear fog over"} an area for player(s) ${(i.players as number[]).join(", ")}`,
    run(i, ctx) {
      const api = ctx.api;
      const scn = requireWritable(api);
      const r = checkRect(scn, i.area as Rect);
      const mask = (i.players as number[]).reduce((m, p) => m | (1 << ownerOf(p)), 0);
      let changed = 0;
      runEdit(ctx, i.mode === "fog" ? "Fog an area" : "Clear fog", (tx) => { changed = tx.setFog(r, mask, i.mode as "fog" | "clear"); });
      ctx.touched({ rect: r });
      return json({ tilesChanged: changed });
    },
  },
  {
    name: "place_start_locations",
    description: "Tools ▸ Auto-place Start Locations: one per player 1..N on a ring or in the corners, each moved to the nearest spot the placement checks accept. replace removes the existing ones first.",
    schema: obj({ players: int(undefined, 1, 8), layout: str(undefined, ["ring", "corners"]), replace: bool(), margin: int("Tiles from the edge.", 0, 64) }, ["players"]),
    effect: "write",
    describe: (i) => `Place ${i.players} start locations`,
    run(i, ctx) {
      requireWritable(ctx.api);
      let placed = 0;
      runEdit(ctx, `Place ${i.players} start locations`, (tx) => {
        const r = tx.placeStartLocations({ players: i.players as number, layout: i.layout as "ring" | "corners" | undefined, replace: i.replace as boolean | undefined, margin: i.margin as number | undefined });
        placed = r.placed.filter(Boolean).length;
      });
      return json({ placed, startLocations: ctx.api.query.startLocations().map((s) => ({ player: s.owner + 1, tile: [s.tx, s.ty] })) });
    },
  },
  {
    name: "resize_map",
    description: "Scenario ▸ Resize / Crop Map. Content keeps its place relative to the anchor; new ground is the given terrain (the tileset's default otherwise); units, sprites and doodads outside the new size are dropped and locations pulled inside. Its undo entry is the editor's own \"Resize\", not one of yours.",
    schema: obj({ width: int(undefined, 1, 256), height: int(undefined, 1, 256), anchor: str("Default centre.", ANCHORS), terrainId: int(undefined, 0, 65535) }, ["width", "height"]),
    effect: "destructive",
    describe: (i) => `Resize the map to ${i.width}×${i.height}`,
    run(i, ctx) {
      requireWritable(ctx.api);
      const anchor = ANCHORS.indexOf((i.anchor as (typeof ANCHORS)[number] | undefined) ?? "centre");
      const r = ctx.api.document.resize({ width: i.width as number, height: i.height as number, anchor, terrainId: i.terrainId as number | undefined });
      if (!r) throw new ToolError("The map could not be resized.");
      return json(r);
    },
  },
  {
    name: "change_tileset",
    description: "Scenario ▸ Map Properties ▸ Tileset: switch the map to another tileset. The terrain is laid again with the new tileset's terrain (tile numbers do not carry across) and doodads go; units, locations and triggers stay. Its undo entry is the editor's own.",
    schema: obj({ tileset: str(undefined, ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"]), terrainId: int("The new tileset's terrain to fill with.", 0, 65535) }, ["tileset"]),
    effect: "destructive",
    describe: (i) => `Change the tileset to ${i.tileset}`,
    async run(i, ctx) {
      requireWritable(ctx.api);
      const r = await ctx.api.document.changeTileset({ tileset: i.tileset as TilesetId, terrainId: i.terrainId as number | undefined });
      if (!r) throw new ToolError("The tileset could not be changed.");
      return json(r);
    },
  },
];
