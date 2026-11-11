/**
 * What the Scenario menu's dialogs edit: the map's name and description, the player slots
 * and forces, unit / upgrade / technology settings, the Create Unit with Properties slots,
 * the string table and the sound list. All through `document.update`, as the dialogs do.
 */
import type { PluginApi } from "../../plugins/api";
import { arr, bool, int, obj, str } from "../schema";
import { cap, json, ownerOf, requireMap, runUpdate, unitIdByName } from "./common";
import { ToolError, type AgentTool } from "./types";

function named(list: { value: number; label: string }[], value: string | number | undefined, what: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const q = value.trim().toLowerCase();
  const hit = list.find((x) => x.label.toLowerCase() === q) ?? list.find((x) => x.label.toLowerCase().startsWith(q));
  if (!hit) throw new ToolError(`"${value}" is not a ${what}. One of: ${list.map((x) => x.label).join(", ")}.`);
  return hit.value;
}

/** Availability rows: player 0 means the global default column, value "default" follows it. */
function availability(rows: { player: number; value: "available" | "unavailable" | "default" }[] | undefined) {
  return rows?.map((r) => ({ player: r.player === 0 ? ("default" as const) : r.player - 1, value: r.value === "default" ? ("default" as const) : r.value === "available" }));
}

const playerColumn = int("1–12, or 0 for the default every player follows unless set.", 0, 12);

function unitTarget(api: PluginApi, u: { unitId?: number; unitName?: string }): number {
  if (u.unitId !== undefined) return u.unitId;
  if (u.unitName) return unitIdByName(api, u.unitName);
  throw new ToolError("Give unitId or unitName.");
}

function byName(list: { value: number; label: string }[], id: number | undefined, name: string | undefined, what: string): number {
  if (id !== undefined) return id;
  if (name) {
    const q = name.toLowerCase();
    const hit = list.find((x) => x.label.toLowerCase() === q) ?? list.filter((x) => x.label.toLowerCase().includes(q))[0];
    if (hit) return hit.value;
  }
  throw new ToolError(`Name the ${what} by id or by name (lookup lists them).`);
}

export const scenarioTools: AgentTool[] = [
  {
    name: "set_map_properties",
    description: "Set the scenario's name and description (what the game lobby shows). An empty string puts back the default.",
    schema: obj({ name: str(), description: str() }),
    effect: "write",
    describe: (i) => i.name !== undefined ? `Rename the map to "${i.name}"` : "Change the map description",
    run(i, ctx) {
      requireMap(ctx.api);
      runUpdate(ctx, "Map properties", (tx) => tx.properties({ name: i.name as string | undefined, description: i.description as string | undefined }));
      return json(ctx.api.document.info());
    },
  },
  {
    name: "set_players",
    description: "Player Settings and Colors: each slot's controller (type: Human, Computer, Neutral, Rescuable, Open, Closed… — lookup player_types), race (Zerg, Terran, Protoss, User Select, Random… — lookup races), colour (palette index 0–11, or rgb for a custom colour) and force (1–4). Players are 1–12; colours and forces apply to players 1–8.",
    schema: obj({
      players: arr(obj({
        player: int(undefined, 1, 12),
        type: str("Controller type name."), race: str("Race name."),
        color: int("Palette colour index.", 0, 255),
        rgb: arr(int(undefined, 0, 255), "A custom colour [r, g, b] (Remastered).", 3),
        paletteColor: bool("true: drop a custom rgb colour and go back to the palette colour."),
        force: int(undefined, 1, 4),
      }, ["player"]), undefined, 12),
    }, ["players"]),
    effect: "write",
    describe: (i) => `Change player settings for ${(i.players as { player: number }[]).map((p) => `P${p.player}`).join(", ")}`,
    run(i, ctx) {
      const api = ctx.api;
      requireMap(api);
      const rows = i.players as { player: number; type?: string; race?: string; color?: number; rgb?: number[]; paletteColor?: boolean; force?: number }[];
      const patches = rows.map((p) => ({
        slot: ownerOf(p.player),
        patch: {
          type: named(api.names.playerTypes(), p.type, "controller type"),
          race: named(api.names.races(), p.race, "race"),
          color: p.color,
          rgb: p.paletteColor ? null : p.rgb ? (p.rgb.slice(0, 3) as [number, number, number]) : undefined,
          force: p.force !== undefined ? p.force - 1 : undefined,
        },
      }));
      runUpdate(ctx, "Player settings", (tx) => { for (const { slot, patch } of patches) tx.players.set(slot, patch); });
      return json(api.settings.players().map((p) => ({ player: p.slot + 1, type: p.typeName, race: p.raceName, color: p.colorHex, force: p.force !== null ? p.force + 1 : null })));
    },
  },
  {
    name: "set_forces",
    description: "Force Settings: each force's name, its flags (allied, allied victory, shared vision, random start positions) and which players 1–8 are in it (players named move from their old force).",
    schema: obj({
      forces: arr(obj({
        force: int(undefined, 1, 4), name: str(),
        allied: bool(), alliedVictory: bool(), sharedVision: bool(), randomStart: bool(),
        players: arr(int(undefined, 1, 8)),
      }, ["force"]), undefined, 4),
    }, ["forces"]),
    effect: "write",
    describe: () => "Change force settings",
    run(i, ctx) {
      requireMap(ctx.api);
      const rows = i.forces as { force: number; name?: string; allied?: boolean; alliedVictory?: boolean; sharedVision?: boolean; randomStart?: boolean; players?: number[] }[];
      runUpdate(ctx, "Force settings", (tx) => {
        for (const f of rows) tx.forces.set(f.force - 1, { name: f.name, allied: f.allied, alliedVictory: f.alliedVictory, sharedVision: f.sharedVision, randomStart: f.randomStart, players: f.players?.map((p) => p - 1) });
      });
      return json(ctx.api.settings.forces().map((f) => ({ force: f.force + 1, name: f.name, players: f.players.map((p) => p + 1), allied: f.allied, alliedVictory: f.alliedVictory, sharedVision: f.sharedVision, randomStart: f.randomStart })));
    },
  },
  {
    name: "read_settings",
    description: "The Unit, Upgrade or Technology Settings tables: costs, hit points, armour, build / research times, weapon damage, custom names, and per-player availability or levels. Ask for ids, or modifiedOnly for what the map changed from the game's defaults.",
    schema: obj({ table: str(undefined, ["units", "upgrades", "techs"]), ids: arr(int(undefined, 0, 65535), undefined, 300), modifiedOnly: bool() }, ["table"]),
    effect: "read",
    describe: (i) => `Read ${i.table} settings`,
    run(i, ctx) {
      const s = ctx.api.settings;
      requireMap(ctx.api);
      const ids = i.ids as number[] | undefined;
      const rows: { id: number; useDefault: boolean }[] = i.table === "units"
        ? (ids ? ids.map((n) => s.unitType(n)).filter((v) => v !== null) : s.unitTypes())
        : i.table === "upgrades" ? (ids ? ids.map((n) => s.upgrade(n)).filter((v) => v !== null) : s.upgrades())
          : (ids ? ids.map((n) => s.tech(n)).filter((v) => v !== null) : s.techs());
      const shown = i.modifiedOnly ? rows.filter((r) => !r.useDefault || ("customName" in r && (r as { customName: string }).customName)) : rows;
      return cap(json({ count: shown.length, rows: shown }), 60_000, "Ask for specific ids.");
    },
  },
  {
    name: "set_unit_settings",
    description: "Unit Settings: per unit type, hit points, shields, armour, build time, mineral and gas cost, weapon damage and bonus, a custom name (\"\" restores it), whether it uses the game's defaults, and who may build it. Setting any number turns \"use default\" off for that type, seeded from the game's values.",
    schema: obj({
      units: arr(obj({
        unitId: int(undefined, 0, 65535), unitName: str(),
        useDefault: bool(), name: str("Custom name."),
        hitPoints: int(undefined, 0, 167772), shields: int(undefined, 0, 65535), armor: int(undefined, 0, 255),
        buildTime: int("In game frames (24 = one second at Fastest is about 15).", 0, 65535),
        mineralCost: int(undefined, 0, 65535), gasCost: int(undefined, 0, 65535),
        weapons: arr(obj({ id: int(undefined, 0, 255), damage: int(undefined, 0, 65535), bonus: int(undefined, 0, 65535) }, ["id"])),
        availability: arr(obj({ player: playerColumn, value: str(undefined, ["available", "unavailable", "default"]) }, ["player", "value"]), "Who may build it."),
      }), undefined, 228),
    }, ["units"]),
    effect: "write",
    describe: (i) => `Change unit settings for ${(i.units as unknown[]).length} type(s)`,
    run(i, ctx) {
      const api = ctx.api;
      requireMap(api);
      const rows = i.units as Record<string, unknown>[];
      const patches = rows.map((u) => ({ id: unitTarget(api, u as never), u }));
      runUpdate(ctx, "Unit settings", (tx) => {
        for (const { id, u } of patches) {
          tx.unitTypes.set(id, {
            useDefault: u.useDefault as boolean | undefined, name: u.name as string | undefined,
            hitPoints: u.hitPoints as number | undefined, shields: u.shields as number | undefined, armor: u.armor as number | undefined,
            buildTime: u.buildTime as number | undefined, mineralCost: u.mineralCost as number | undefined, gasCost: u.gasCost as number | undefined,
            weapons: u.weapons as { id: number; damage?: number; bonus?: number }[] | undefined,
            available: availability(u.availability as never),
          });
        }
      });
      return cap(json(patches.map(({ id }) => api.settings.unitType(id))));
    },
  },
  {
    name: "set_upgrade_settings",
    description: "Upgrade Settings: costs and their per-level factors, research time, and per player the level they start at and the most they may reach.",
    schema: obj({
      upgrades: arr(obj({
        upgradeId: int(undefined, 0, 255), upgradeName: str(), useDefault: bool(),
        mineralCost: int(undefined, 0, 65535), mineralFactor: int(undefined, 0, 65535), gasCost: int(undefined, 0, 65535), gasFactor: int(undefined, 0, 65535),
        timeCost: int(undefined, 0, 65535), timeFactor: int(undefined, 0, 65535),
        levels: arr(obj({ player: playerColumn, start: int(undefined, 0, 255), max: int(undefined, 0, 255), useDefault: bool() }, ["player"])),
      }), undefined, 61),
    }, ["upgrades"]),
    effect: "write",
    describe: (i) => `Change ${(i.upgrades as unknown[]).length} upgrade setting(s)`,
    run(i, ctx) {
      const api = ctx.api;
      requireMap(api);
      const rows = (i.upgrades as Record<string, unknown>[]).map((u) => ({ id: byName(api.names.upgrades(), u.upgradeId as number | undefined, u.upgradeName as string | undefined, "upgrade"), u }));
      runUpdate(ctx, "Upgrade settings", (tx) => {
        for (const { id, u } of rows) {
          tx.upgrades.set(id, {
            useDefault: u.useDefault as boolean | undefined,
            mineralCost: u.mineralCost as number | undefined, mineralFactor: u.mineralFactor as number | undefined,
            gasCost: u.gasCost as number | undefined, gasFactor: u.gasFactor as number | undefined,
            timeCost: u.timeCost as number | undefined, timeFactor: u.timeFactor as number | undefined,
            levels: (u.levels as { player: number; start?: number; max?: number; useDefault?: boolean }[] | undefined)?.map((l) => ({ ...l, player: l.player === 0 ? "default" as const : l.player - 1 })),
          });
        }
      });
      return cap(json(rows.map(({ id }) => api.settings.upgrade(id))));
    },
  },
  {
    name: "set_tech_settings",
    description: "Technology Settings: costs, research time, energy cost, and per player whether the tech is available and already researched.",
    schema: obj({
      techs: arr(obj({
        techId: int(undefined, 0, 255), techName: str(), useDefault: bool(),
        mineralCost: int(undefined, 0, 65535), gasCost: int(undefined, 0, 65535), researchTime: int(undefined, 0, 65535), energyCost: int(undefined, 0, 65535),
        state: arr(obj({ player: playerColumn, available: bool(), researched: bool(), useDefault: bool() }, ["player"])),
      }), undefined, 44),
    }, ["techs"]),
    effect: "write",
    describe: (i) => `Change ${(i.techs as unknown[]).length} technology setting(s)`,
    run(i, ctx) {
      const api = ctx.api;
      requireMap(api);
      const rows = (i.techs as Record<string, unknown>[]).map((t) => ({ id: byName(api.names.techs(), t.techId as number | undefined, t.techName as string | undefined, "technology"), t }));
      runUpdate(ctx, "Technology settings", (tx) => {
        for (const { id, t } of rows) {
          tx.techs.set(id, {
            useDefault: t.useDefault as boolean | undefined,
            mineralCost: t.mineralCost as number | undefined, gasCost: t.gasCost as number | undefined,
            researchTime: t.researchTime as number | undefined, energyCost: t.energyCost as number | undefined,
            state: (t.state as { player: number; available?: boolean; researched?: boolean; useDefault?: boolean }[] | undefined)?.map((s) => ({ ...s, player: s.player === 0 ? "default" as const : s.player - 1 })),
          });
        }
      });
      return cap(json(rows.map(({ id }) => api.settings.tech(id))));
    },
  },
  {
    name: "unit_property_slots",
    description: "The 64 Create Unit with Properties slots (what the action's slot number refers to, 1–64): read them, or set / clear some. A field set to null goes back to the unit's default.",
    schema: obj({
      set: arr(obj({
        slot: int(undefined, 1, 64), clear: bool("Empty the slot."),
        hitPoints: int(undefined, 0, 100), shields: int(undefined, 0, 100), energy: int(undefined, 0, 100), resources: int(undefined, 0, 0xffffffff), hangar: int(undefined, 0, 65535),
        cloaked: bool(), burrowed: bool(), liftedOff: bool(), hallucinated: bool(), invincible: bool(),
      }, ["slot"]), "Slots to change; omit to only read.", 64),
    }),
    effect: (i) => ((i as { set?: unknown[] }).set?.length ? "write" : "read"),
    describe: (i) => (i.set as unknown[] | undefined)?.length ? `Set ${(i.set as unknown[]).length} unit-property slot(s)` : "Read the unit-property slots",
    run(i, ctx) {
      const api = ctx.api;
      requireMap(api);
      const set = i.set as Record<string, unknown>[] | undefined;
      if (set?.length) {
        runUpdate(ctx, "Unit property slots", (tx) => {
          for (const s of set) {
            const slot = (s.slot as number) - 1;
            if (s.clear) { tx.cuwp.clear(slot); continue; }
            tx.cuwp.set(slot, {
              hitPointsPercent: s.hitPoints as number | undefined, shieldsPercent: s.shields as number | undefined, energyPercent: s.energy as number | undefined,
              resources: s.resources as number | undefined, hangar: s.hangar as number | undefined,
              cloaked: s.cloaked as boolean | undefined, burrowed: s.burrowed as boolean | undefined, inTransit: s.liftedOff as boolean | undefined,
              hallucinated: s.hallucinated as boolean | undefined, invincible: s.invincible as boolean | undefined,
            }, true);
          }
        });
      }
      return cap(json(api.settings.cuwpSlots().filter((s) => s.used || s.references > 0).map((s) => ({ slot: s.index + 1, summary: s.summary, usedByActions: s.references }))));
    },
  },
  {
    name: "list_strings",
    description: "The string table: index and text, with what refers to each string. Filter by text, or list only the unused ones.",
    schema: obj({ search: str(), unusedOnly: bool(), offset: int(undefined, 0), limit: int("Default 200.", 1, 5000) }),
    effect: "read",
    describe: (i) => i.unusedOnly ? "List unused strings" : `List strings${i.search ? ` containing "${i.search}"` : ""}`,
    run(i, ctx) {
      const api = ctx.api;
      requireMap(api);
      const strings = api.query.strings();
      const usage = api.query.stringUsage();
      const unused = new Set(api.query.unusedStrings());
      const q = (i.search as string | undefined)?.toLowerCase();
      const rows = strings.map((text, index) => ({ index, text }))
        .filter((r) => r.index > 0 && r.text !== null && (!q || r.text.toLowerCase().includes(q)) && (!i.unusedOnly || unused.has(r.index)))
        .map((r) => ({ ...r, usedBy: (usage.get(r.index) ?? []).slice(0, 6).map((u) => `${u.kind}: ${u.label}`) }));
      const offset = (i.offset as number | undefined) ?? 0;
      const limit = (i.limit as number | undefined) ?? 200;
      return cap(json({ total: rows.length, offset, strings: rows.slice(offset, offset + limit) }));
    },
  },
  {
    name: "set_strings",
    description: "Overwrite string-table entries by index. Everything that points at an entry (a unit's name, a location, every trigger message using it) shows the new text, so check list_strings' usedBy first; to change one message only, rewrite its trigger instead.",
    schema: obj({ strings: arr(obj({ index: int(undefined, 1), text: str() }, ["index", "text"]), undefined, 2000) }, ["strings"]),
    effect: "write",
    describe: (i) => `Change ${(i.strings as unknown[]).length} string(s)`,
    run(i, ctx) {
      requireMap(ctx.api);
      const rows = i.strings as { index: number; text: string }[];
      runUpdate(ctx, `Change ${rows.length} string(s)`, (tx) => { for (const s of rows) tx.strings.set(s.index, s.text); });
      return "Changed.";
    },
  },
  {
    name: "list_sounds",
    description: "The map's sound list (WAV slots): the path triggers play, whether the file is in the map archive, its size, and which triggers use it. Adding sound files needs the user (they come from their disk).",
    schema: obj({}),
    effect: "read",
    describe: () => "List the sounds",
    run(_i, ctx) {
      requireMap(ctx.api);
      return cap(json(ctx.api.settings.sounds().map((s) => ({ slot: s.slot, path: s.path, present: s.present, size: s.size, usedBy: s.usedBy.slice(0, 8) }))));
    },
  },
];
