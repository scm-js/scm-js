/**
 * Map-level tools: what the map is, a picture of it, Check Map, statistics, the Ctrl+F
 * search, the name tables, the user's selection, moving the view, the editor's own
 * documentation, undoing the agent's edits, and starting a new map.
 */
import type { PluginApi, ReadonlyScenario, Rect, TilesetId } from "../../plugins/api";
import { arr, bool, int, obj, str, tileRect } from "../schema";
import { cap, checkRect, json, locationInUse, requireMap, stringOf, TILE } from "./common";
import { LABEL_PREFIX, ToolError, type AgentTool, type ToolImage } from "./types";

const TILESETS: readonly TilesetId[] = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"];

/* ── Overview ───────────────────────────────────────────── */

export function overview(api: PluginApi, scn: ReadonlyScenario): Record<string, unknown> {
  const info = api.document.info();
  const players = api.settings.players().map((p) => ({
    player: p.slot + 1, type: p.typeName, race: p.raceName,
    ...(p.force !== null ? { force: p.force + 1 } : {}),
    units: 0,
  }));
  for (const u of scn.units) if (players[u.owner]) players[u.owner].units++;
  const locations = scn.locations.reduce((n, _, i) => n + (locationInUse(scn, i) ? 1 : 0), 0);
  return {
    name: info?.name, description: info?.description, fileName: info?.fileName,
    widthTiles: scn.width, heightTiles: scn.height, tileset: info?.tileset, version: info?.version,
    modified: info?.modified, viewOnly: info?.viewOnly,
    graphicsLoaded: api.tileset.isLoaded(),
    players,
    forces: api.settings.forces().map((f) => ({
      force: f.force + 1, name: f.name, players: f.players.map((s) => s + 1),
      allied: f.allied, alliedVictory: f.alliedVictory, sharedVision: f.sharedVision, randomStart: f.randomStart,
    })),
    counts: {
      units: scn.units.length, sprites: scn.sprites.length, doodads: scn.doodads.length, locations,
      triggers: api.triggers.list().length, briefingTriggers: api.triggers.briefing().length,
      strings: api.query.strings().filter((s, i) => i > 0 && s).length,
    },
    startLocations: api.query.startLocations().map((s) => ({ player: s.owner + 1, tile: [s.tx, s.ty] })),
    lastUndo: api.document.history().undo,
  };
}

/** The view reports fractional tiles while zoomed; whole tiles that cover it read better. */
const roundRect = (r: Rect): Rect => ({ x0: Math.floor(r.x0), y0: Math.floor(r.y0), x1: Math.ceil(r.x1), y1: Math.ceil(r.y1) });

/** The short state block added to each of the user's messages, so Claude knows what is in front of them. */
export function mapState(api: PluginApi): string {
  const scn = api.document.scenario();
  if (!scn) return "No map is open.";
  const info = api.document.info();
  const sel = {
    units: api.selection.units().length, locations: api.selection.locations().map((i) => i + 1),
    sprites: api.selection.sprites().length, doodads: api.selection.doodads().length,
    markedArea: api.selection.markedArea(), layer: api.selection.layer(),
  };
  const parts = [
    `Map "${info?.name ?? ""}"${info?.fileName ? ` (${info.fileName})` : ""}: ${scn.width}×${scn.height} tiles, ${info?.tileset}, ${scn.units.length} units, ${api.triggers.list().length} triggers${info?.modified ? ", unsaved changes" : ""}${info?.viewOnly ? ", VIEW ONLY" : ""}.`,
    `Tileset graphics ${api.tileset.isLoaded() ? "loaded" : "not loaded"}.`,
    `Visible on screen: tiles ${json(roundRect(api.view.visible()))}. Active layer: ${sel.layer}.`,
  ];
  const picked = [
    sel.units ? `${sel.units} unit(s)` : "", sel.locations.length ? `location(s) ${sel.locations.join(", ")}` : "",
    sel.sprites ? `${sel.sprites} sprite(s)` : "", sel.doodads ? `${sel.doodads} doodad(s)` : "",
    sel.markedArea ? `marked area ${json(sel.markedArea)}` : "",
  ].filter(Boolean);
  if (picked.length) parts.push(`Selected: ${picked.join(", ")} (get_selection lists them).`);
  return parts.join("\n");
}

/* ── Pictures ───────────────────────────────────────────── */

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Without the game's graphics the editor cannot draw terrain, so this draws what it can
 * know from the map alone: a dark ground with a grid, the locations, the units as dots in
 * their players' colours and the start locations as numbered squares.
 */
async function schematic(api: PluginApi, scn: ReadonlyScenario, rect: Rect, ppt: number, locations: boolean): Promise<Blob | null> {
  const w = (rect.x1 - rect.x0) * ppt;
  const h = (rect.y1 - rect.y0) * ppt;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const X = (px: number) => (px / TILE - rect.x0) * ppt;
  const Y = (py: number) => (py / TILE - rect.y0) * ppt;
  g.fillStyle = "#1c1f24";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(255,255,255,0.08)";
  g.lineWidth = 1;
  for (let t = Math.ceil(rect.x0 / 8) * 8; t <= rect.x1; t += 8) { g.beginPath(); g.moveTo((t - rect.x0) * ppt + 0.5, 0); g.lineTo((t - rect.x0) * ppt + 0.5, h); g.stroke(); }
  for (let t = Math.ceil(rect.y0 / 8) * 8; t <= rect.y1; t += 8) { g.beginPath(); g.moveTo(0, (t - rect.y0) * ppt + 0.5); g.lineTo(w, (t - rect.y0) * ppt + 0.5); g.stroke(); }
  if (locations) {
    g.font = `${Math.max(9, Math.min(14, ppt * 1.5))}px sans-serif`;
    scn.locations.forEach((l, i) => {
      if (!locationInUse(scn, i)) return;
      g.strokeStyle = "rgba(90,200,255,0.9)";
      g.fillStyle = "rgba(90,200,255,0.12)";
      g.fillRect(X(l.left), Y(l.top), X(l.right) - X(l.left), Y(l.bottom) - Y(l.top));
      g.strokeRect(X(l.left), Y(l.top), X(l.right) - X(l.left), Y(l.bottom) - Y(l.top));
      g.fillStyle = "rgba(160,225,255,1)";
      g.fillText(stringOf(api, l.nameIndex) || `Location ${i + 1}`, X(l.left) + 2, Y(l.top) + 11);
    });
  }
  for (const u of scn.units) {
    const size = api.palette.unitSize(u.unitId);
    const isStart = u.unitId === api.consts.unit.startLocation;
    g.fillStyle = api.palette.playerColor(u.owner);
    if (isStart) {
      const s = Math.max(6, ppt * 2);
      g.fillRect(X(u.x) - s / 2, Y(u.y) - s / 2, s, s);
      g.fillStyle = "#fff";
      g.fillText(String(u.owner + 1), X(u.x) - 3, Y(u.y) + 4);
      continue;
    }
    const rw = Math.max(2, (size.width / TILE) * ppt);
    const rh = Math.max(2, (size.height / TILE) * ppt);
    if (size.building) g.fillRect(X(u.x) - rw / 2, Y(u.y) - rh / 2, rw, rh);
    else { g.beginPath(); g.arc(X(u.x), Y(u.y), Math.max(1.5, rw / 2), 0, Math.PI * 2); g.fill(); }
  }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/* ── Docs ───────────────────────────────────────────────── */

interface DocSection { level: number; heading: string; start: number; end: number }

function sections(text: string): DocSection[] {
  const out: DocSection[] = [];
  const re = /^(#{1,4}) (.+)$/gm;
  let m: RegExpExecArray | null;
  let fence = false;
  const lines = text.split("\n");
  let offset = 0;
  for (const line of lines) {
    if (line.startsWith("```")) fence = !fence;
    re.lastIndex = 0;
    if (!fence && (m = re.exec(line))) out.push({ level: m[1].length, heading: m[2].trim(), start: offset, end: text.length });
    offset += line.length + 1;
  }
  for (let i = 0; i < out.length; i++) {
    const next = out.slice(i + 1).find((s) => s.level <= out[i].level);
    if (next) out[i].end = next.start;
  }
  return out;
}

/** The docs are a chunk of their own (about 220 KB of Markdown), fetched the first time Claude reads them. */
const DOCS: Record<string, () => Promise<{ default: string }>> = {
  triggers: () => import("../../../docs/triggers.md?raw"),
  guide: () => import("../../../docs/guide.md?raw"),
};

/* ── The tools ──────────────────────────────────────────── */

export const mapTools: AgentTool[] = [
  {
    name: "map_overview",
    description: "The open map at a glance: name, description, size in tiles, tileset, revision, the 12 player slots (controller type, race, force, unit count), the forces, counts of units / sprites / doodads / locations / triggers / strings, start locations, and whether the tileset graphics are loaded. Call it first when you start work on a map.",
    schema: obj({}),
    effect: "read",
    describe: () => "Read the map overview",
    run: (_input, ctx) => json(overview(ctx.api, requireMap(ctx.api))),
  },
  {
    name: "map_image",
    description: "A picture of the map, or part of it, as the editor's File ▸ Export ▸ Image draws it. Use it to see terrain, where things are, and to check your own edits. Without the tileset graphics you get a schematic instead (units as dots in player colours, locations as boxes, no terrain). Pictures cost context, so ask for the area you need at a modest scale.",
    schema: obj({
      area: tileRect("The part to draw, in tiles; the whole map when omitted."),
      pixelsPerTile: int("Output pixels per tile, 1 to 32. Chosen so the picture is at most about 1000 pixels across when omitted. Unit graphics appear from 8 up; below that units are dots.", 1, 32),
      locations: bool("Draw locations with their names. Default true."),
      startLocations: bool("Mark start locations. Default true."),
      grid: bool("Draw a grid line every 8 tiles. Default false."),
      units: bool("Draw units. Default true."),
    }),
    effect: "read",
    describe: (i) => i.area ? `Look at tiles ${(i.area as Rect).x0},${(i.area as Rect).y0}–${(i.area as Rect).x1},${(i.area as Rect).y1}` : "Look at the whole map",
    async run(input, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      const area = input.area ? checkRect(scn, input.area as Rect) : { x0: 0, y0: 0, x1: scn.width, y1: scn.height };
      const span = Math.max(area.x1 - area.x0, area.y1 - area.y0);
      const ppt = Math.max(1, Math.min(32, (input.pixelsPerTile as number | undefined) ?? Math.floor(1000 / span)));
      const locations = (input.locations as boolean | undefined) ?? true;
      await api.tileset.load().catch(() => false);
      let blob = await api.document.renderImage({
        pixelsPerTile: ppt, rect: area, units: (input.units as boolean | undefined) ?? true, sprites: true,
        locations, locationNames: locations, startLocations: (input.startLocations as boolean | undefined) ?? true,
        grid: input.grid ? 8 * TILE : 0,
      });
      let kind = "rendered with the game's graphics";
      if (!blob) {
        blob = await schematic(api, scn, area, Math.max(ppt, 2), locations);
        kind = "a SCHEMATIC (the tileset graphics are not installed, so no terrain is drawn: units are dots in player colours, buildings squares, start locations numbered squares, locations blue boxes)";
      }
      if (!blob) throw new ToolError("The picture could not be drawn in this browser.");
      const image: ToolImage = { mediaType: "image/png", data: await base64(blob) };
      const scale = kind.startsWith("a SCHEMATIC") ? Math.max(ppt, 2) : ppt;
      return {
        text: `Tiles x ${area.x0}–${area.x1 - 1}, y ${area.y0}–${area.y1 - 1} at ${scale} px per tile: image pixel (px, py) is tile (${area.x0} + px/${scale}, ${area.y0} + py/${scale}). This is ${kind}.`,
        images: [image],
      };
    },
  },
  {
    name: "check_map",
    description: "Check Map: every problem the editor knows how to spot (missing sections, units stuck in terrain, triggers that refer to nothing, unused strings, players with no start location…), each with its level and where it is.",
    schema: obj({}),
    effect: "read",
    describe: () => "Check the map for problems",
    run: (_i, ctx) => {
      requireMap(ctx.api);
      const issues = ctx.api.query.validate();
      return cap(json({ count: issues.length, issues: issues.slice(0, 150).map((i) => ({ level: i.level, where: i.where, text: i.text, target: i.target })) }));
    },
  },
  {
    name: "map_statistics",
    description: "Tools ▸ Statistics: units per type and player, buildings, resources (minerals, gas, fields, geysers), doodads, sprites, triggers (conditions, actions, preserved, disabled), briefing, named switches, sounds and terrain coverage.",
    schema: obj({}),
    effect: "read",
    describe: () => "Read the map statistics",
    run: (_i, ctx) => { requireMap(ctx.api); return json(ctx.api.query.statistics()); },
  },
  {
    name: "find",
    description: "The editor's Ctrl+F search over one kind of thing: units, locations, sprites, doodads, strings, triggers or the briefing. Returns indices you can pass to other tools.",
    schema: obj({
      kind: str(undefined, ["units", "locations", "sprites", "doodads", "strings", "triggers", "briefing"]),
      query: str("Text to look for."),
      matchCase: bool(),
      limit: int("At most this many results (default 100).", 1, 1000),
    }, ["kind", "query"]),
    effect: "read",
    describe: (i) => `Search ${i.kind} for "${i.query}"`,
    run: (i, ctx) => {
      requireMap(ctx.api);
      const hits = ctx.api.query.find({ kind: i.kind as "units", query: i.query as string, matchCase: i.matchCase as boolean | undefined, limit: (i.limit as number | undefined) ?? 100 });
      return cap(json({ count: hits.length, results: hits }));
    },
  },
  {
    name: "lookup",
    description: "The names and numbers behind the map's data: unit types, upgrades, technologies, weapons, player controller types, races, player groups (for triggers), trigger conditions / actions / briefing actions, AI scripts, and the value lists trigger arguments take (comparisons, modifiers, orders, alliance, resources, scores, unit states, switch states and actions, text flags). Also the open map's terrains, doodads and sprites (need the tileset graphics). Filter with search.",
    schema: obj({
      what: str(undefined, [
        "units", "upgrades", "techs", "weapons", "player_types", "races", "player_groups", "conditions", "actions", "briefing_actions",
        "ai_scripts", "comparisons", "modifiers", "orders", "alliances", "resources", "scores", "unit_states", "switch_states", "switch_actions",
        "text_flags", "terrains", "doodads", "sprites", "unit_groups",
      ]),
      search: str("Only entries whose name contains this, any case."),
      limit: int("At most this many (default 300).", 1, 2000),
    }, ["what"]),
    effect: "read",
    describe: (i) => `Look up ${String(i.what).replace(/_/g, " ")}${i.search ? ` matching "${i.search}"` : ""}`,
    async run(i, ctx) {
      const api = ctx.api;
      const choice = (kind: Parameters<typeof api.triggers.defs.choices>[0]) => api.triggers.defs.choices(kind).map((c) => ({ value: c.value, label: c.label, ...(c.aliases?.length ? { aliases: c.aliases } : {}) }));
      let rows: readonly { value: number; label: string; aliases?: string[] }[];
      switch (i.what) {
        case "units": rows = api.names.units(); break;
        case "upgrades": rows = api.names.upgrades(); break;
        case "techs": rows = api.names.techs(); break;
        case "weapons": rows = api.names.weapons(); break;
        case "player_types": rows = api.names.playerTypes(); break;
        case "races": rows = api.names.races(); break;
        case "player_groups": rows = choice("player"); break;
        case "conditions": rows = api.names.conditions(); break;
        case "actions": rows = api.names.actions(); break;
        case "briefing_actions": rows = api.names.actions(true); break;
        case "ai_scripts": rows = choice("aiScript"); break;
        case "comparisons": rows = choice("comparison"); break;
        case "modifiers": rows = choice("modifier"); break;
        case "orders": rows = choice("order"); break;
        case "alliances": rows = choice("alliance"); break;
        case "resources": rows = choice("resource"); break;
        case "scores": rows = choice("score"); break;
        case "unit_states": rows = choice("unitState"); break;
        case "switch_states": rows = choice("switchState"); break;
        case "switch_actions": rows = choice("switchAction"); break;
        case "text_flags": rows = choice("textFlags"); break;
        case "unit_groups": rows = api.palette.unitGroups().map((g, n) => ({ value: n, label: `${g.label} (${g.race})`, units: g.units })); break;
        case "terrains":
        case "doodads": {
          requireMap(api);
          if (!(await api.tileset.load().catch(() => false))) throw new ToolError("The tileset graphics are not installed, so the terrains and doodads of this tileset are unknown. The user can add them from Help ▸ Game Data….");
          rows = i.what === "terrains"
            ? api.terrain.types().map((t) => ({ value: t.id, label: t.name, height: api.terrain.heightOf(t.id), buildable: t.buildable, isometric: api.terrain.isomTypes().includes(t.id) }))
            : api.palette.doodadCategories().flatMap((c) => c.doodads.map((d) => ({ value: d.id, label: d.name, category: c.name, sizeTiles: [d.width, d.height] })));
          break;
        }
        case "sprites": {
          await api.data.load().catch(() => false);
          rows = api.palette.spriteGroups().flatMap((g) => g.ids.map((id) => ({ value: id, label: api.palette.spriteName("pure", id), group: g.label })));
          break;
        }
        default: throw new ToolError(`Unknown list ${String(i.what)}.`);
      }
      const q = (i.search as string | undefined)?.toLowerCase();
      const hits = q ? rows.filter((r) => r.label.toLowerCase().includes(q) || (r.aliases ?? []).some((a) => a.toLowerCase().includes(q))) : rows;
      const limit = (i.limit as number | undefined) ?? 300;
      return cap(json({ total: hits.length, shown: Math.min(limit, hits.length), entries: hits.slice(0, limit) }));
    },
  },
  {
    name: "get_selection",
    description: "What the user has selected in the editor right now: units (with their rows), locations, sprites, doodads, the marked area (a tile rect), the active layer, the tile under the pointer and the tiles on screen. Use it when the user says \"these\", \"here\" or \"the selected …\".",
    schema: obj({}),
    effect: "read",
    describe: () => "Read the user's selection",
    run: (_i, ctx) => {
      const api = ctx.api;
      const scn = requireMap(api);
      const units = api.selection.units();
      return cap(json({
        layer: api.selection.layer(),
        markedArea: api.selection.markedArea(),
        units: units.length <= 80 ? units.map((u) => ({ index: u, name: api.names.unit(scn.units[u]?.unitId ?? 0), player: (scn.units[u]?.owner ?? 0) + 1, x: scn.units[u]?.x, y: scn.units[u]?.y })) : { count: units.length, indices: units },
        locations: api.selection.locations().map((l) => ({ number: l + 1, name: api.names.location(l) })),
        sprites: api.selection.sprites(),
        doodads: api.selection.doodads(),
        cursorTile: api.view.cursorTile(),
        visibleTiles: roundRect(api.view.visible()),
      }));
    },
  },
  {
    name: "show_on_map",
    description: "Move the user's view to something and highlight it: a tile area, unit records, a location or a trigger (which opens it in the Trigger Editor). Optionally select the units or locations. Use it to point the user at what you are talking about; it does not change the map.",
    schema: obj({
      area: tileRect("A tile area to bring on screen and flash."),
      units: arr(int(undefined, 0), "Unit record indices to bring on screen, flash and select."),
      location: int("A location number (1-based) to go to and select.", 1, 255),
      trigger: int("A trigger index (0-based) to open in the Trigger Editor.", 0),
      zoomToFit: bool("Zoom out as far as needed to fit. Default true."),
    }),
    effect: "read",
    describe: (i) => i.location ? `Show location ${i.location}` : i.units ? `Show ${(i.units as number[]).length} unit(s)` : i.trigger !== undefined ? `Open trigger #${i.trigger}` : "Show an area",
    async run(i, ctx) {
      const api = ctx.api;
      const scn = requireMap(api);
      const fit = (i.zoomToFit as boolean | undefined) ?? true;
      if (i.area) {
        const r = checkRect(scn, i.area as Rect);
        await api.view.reveal(r, { fit });
        api.view.flash({ rect: r, kind: "attention" });
      }
      if (i.units) {
        const units = (i.units as number[]).filter((u) => u < scn.units.length);
        if (units.length === 1) api.view.goTo({ kind: "unit", index: units[0] });
        else if (units.length) {
          const xs = units.map((u) => scn.units[u].x / TILE), ys = units.map((u) => scn.units[u].y / TILE);
          await api.view.reveal({ x0: Math.floor(Math.min(...xs)), y0: Math.floor(Math.min(...ys)), x1: Math.ceil(Math.max(...xs)) + 1, y1: Math.ceil(Math.max(...ys)) + 1 }, { fit });
          api.selection.setLayer("units");
          api.selection.setUnits(units);
        }
        api.view.flash({ units, kind: "attention" });
      }
      if (i.location !== undefined) {
        const index = (i.location as number) - 1;
        if (!scn.locations[index]) throw new ToolError(`There is no location ${i.location}.`);
        api.view.goTo({ kind: "location", index });
        api.view.flash({ locations: [index], kind: "attention" });
      }
      if (i.trigger !== undefined) api.view.goTo({ kind: "trigger", index: i.trigger as number });
      return "Shown.";
    },
  },
  {
    name: "undo_my_edits",
    description: "Undo the most recent edits you (Claude) made, newest first, one undo step per edit. It stops at the first entry on the undo stack that is not yours, so it never takes back the user's own work.",
    schema: obj({ count: int("How many of your edits to undo (default 1).", 1, 200) }),
    effect: "write",
    describe: (i) => `Undo ${(i.count as number | undefined) ?? 1} of my edits`,
    run: (i, ctx) => {
      const api = ctx.api;
      requireMap(api);
      const want = (i.count as number | undefined) ?? 1;
      const undone: string[] = [];
      while (undone.length < want) {
        const top = api.document.history().undo;
        if (!top || !top.startsWith(LABEL_PREFIX)) break;
        const label = api.document.undo();
        if (!label) break;
        undone.push(label);
      }
      const next = api.document.history().undo;
      return json({ undone, ...(undone.length < want ? { stopped: next ? `The next undo entry is the user's ("${next}"), so I stopped.` : "Nothing left to undo." } : {}) });
    },
  },
  {
    name: "read_docs",
    description: "The editor's own documentation. \"triggers\" is the trigger reference: how the trigger cycle, waits, hyper triggers and player groups work, and a section per condition and action with its exact text form and what the game really does. \"guide\" is the user guide to every part of the editor. Without heading or search you get the outline. Read the section for any condition or action you are not sure of before writing triggers that use it.",
    schema: obj({
      doc: str(undefined, ["triggers", "guide"]),
      heading: str("A heading to read, as the outline shows it (\"Create Unit\", \"Hyper triggers\", \"Players and groups\"). Matching ignores case."),
      search: str("Find the sections that mention this text."),
    }, ["doc"]),
    effect: "read",
    describe: (i) => i.heading ? `Read "${i.heading}" in the ${i.doc} docs` : i.search ? `Search the ${i.doc} docs for "${i.search}"` : `Read the ${i.doc} docs outline`,
    async run(i) {
      const text = (await DOCS[i.doc as string]()).default;
      const all = sections(text);
      if (i.heading) {
        const want = (i.heading as string).trim().toLowerCase();
        const hit = all.find((s) => s.heading.toLowerCase() === want) ?? all.find((s) => s.heading.toLowerCase().includes(want));
        if (!hit) throw new ToolError(`No heading "${i.heading}". Ask without a heading for the outline.`);
        return cap(text.slice(hit.start, hit.end).replace(/<!--[^]*?-->/g, ""), 20_000, "Read a narrower heading.");
      }
      if (i.search) {
        const q = (i.search as string).toLowerCase();
        const leaves = all.filter((s, n) => !all[n + 1] || all[n + 1].level <= s.level);
        const hits = leaves.filter((s) => text.slice(s.start, s.end).toLowerCase().includes(q)).slice(0, 25);
        return json(hits.map((s) => {
          const body = text.slice(s.start, s.end);
          const at = body.toLowerCase().indexOf(q);
          return { heading: s.heading, snippet: body.slice(Math.max(0, at - 120), at + 200).replace(/\s+/g, " ") };
        }));
      }
      return all.filter((s) => s.level <= 3).map((s) => `${"  ".repeat(s.level - 1)}${s.heading}`).join("\n");
    },
  },
  {
    name: "new_map",
    description: "Start a new, blank map the way File ▸ New does: flat ground of the tileset's default terrain, opened beside the current map as a new tab (the current map stays open and unchanged). Every later tool works on the new map.",
    schema: obj({
      width: int("Width in tiles (64, 96, 128, 192, 256 are the usual sizes).", 16, 256),
      height: int("Height in tiles.", 16, 256),
      tileset: str(undefined, TILESETS),
      name: str("The scenario name."),
      description: str("The scenario description."),
      startLocations: int("Start locations to lay down for players 1..N.", 0, 8),
    }, ["width", "height", "tileset"]),
    effect: "write",
    describe: (i) => `Create a new ${i.width}×${i.height} ${i.tileset} map`,
    async run(i, ctx) {
      const ok = await ctx.api.document.create({
        width: i.width as number, height: i.height as number, tileset: i.tileset as TilesetId, into: "new",
        name: i.name as string | undefined, description: i.description as string | undefined,
        startLocations: i.startLocations as number | undefined,
      });
      if (!ok) throw new ToolError("The new map was not created (the user kept the current one).");
      return json(overview(ctx.api, requireMap(ctx.api)));
    },
  },
];
