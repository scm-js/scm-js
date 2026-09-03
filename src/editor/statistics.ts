/**
 * Tools ▸ Statistics: the map's contents counted up. Pure over the scenario plus whatever
 * game data happens to be loaded — the tileset for terrain by type, units.dat to tell
 * buildings from mobile units — and degrades to "n/a" without them.
 */
import { MAP_VERSIONS, mapVersionOf, tilesetIndex, type Scenario } from "../formats/chk/scenario";
import { ANYWHERE_INDEX, isLocationUsed, UnitUsed } from "../formats/chk/sections/objects";
import { PLAYER_SLOTS } from "../formats/chk/sections/players";
import { UnitFlag, type UnitsDat } from "../formats/dat/dat";
import type { Tileset } from "../formats/tileset/decode";
import { isFlatPair } from "../formats/tileset/palette";
import { TILESETS, type TerrainName } from "../data/tilesets";
import { playerRaceLabel, playerTypeLabel } from "../data/players";
import { START_LOCATION, unitName } from "../data/units";
import { DEFAULT_GAS, DEFAULT_MINERALS, isResource } from "./units";
import { spriteKind } from "./sprites";
import { isPreserved } from "./triggers";
import { tileGroup } from "../formats/chk/sections/terrain";
import { TriggerFlag } from "../formats/chk/sections/triggers";

export interface PlayerStatistics {
  slot: number;
  type: string;
  race: string;
  units: number;
  /** Null when units.dat is not loaded. */
  buildings: number | null;
  startLocations: number;
}

export interface MapStatistics {
  width: number;
  height: number;
  tileset: string;
  revision: string;
  sections: number;
  strings: { slots: number; set: number; extended: boolean };
  players: PlayerStatistics[];
  /** Units whose owner byte is past the twelve slots. */
  unownedUnits: number;
  units: { total: number; buildings: number | null; top: { id: number; name: string; count: number }[] };
  resources: { minerals: number; gas: number; fields: number; geysers: number };
  doodads: number;
  sprites: { pure: number; unit: number };
  locations: number;
  triggers: { count: number; conditions: number; actions: number; preserved: number; disabled: number };
  /** MBRF: the briefing's records and the actions in them. */
  briefings: { count: number; actions: number };
  switchesNamed: number;
  sounds: number;
  /** Tiles per terrain type ("Edges and cliffs" for the unnamed edge sets), most common first; null without the tileset graphics. */
  terrain: { name: string; tiles: number }[] | null;
}

const MINERAL_FIELD_MAX = 178;

export function mapStatistics(scn: Scenario, tileset: Tileset | null, terrainNames: readonly TerrainName[] | null, dat: UnitsDat | null): MapStatistics {
  const players: PlayerStatistics[] = Array.from({ length: PLAYER_SLOTS }, (_, slot) => ({
    slot, type: playerTypeLabel(scn.playerTypes[slot] ?? 0), race: playerRaceLabel(scn.playerRaces[slot] ?? 0), units: 0, buildings: dat ? 0 : null, startLocations: 0,
  }));
  let unownedUnits = 0;
  let buildings = 0;
  const byType = new Map<number, number>();
  const resources = { minerals: 0, gas: 0, fields: 0, geysers: 0 };
  for (const u of scn.units) {
    byType.set(u.unitId, (byType.get(u.unitId) ?? 0) + 1);
    const isBuilding = dat ? (dat.flags[u.unitId] & UnitFlag.Building) !== 0 : false;
    if (isBuilding) buildings++;
    const p = players[u.owner];
    if (p) {
      p.units++;
      if (isBuilding && p.buildings !== null) p.buildings++;
      if (u.unitId === START_LOCATION) p.startLocations++;
    } else unownedUnits++;
    if (isResource(u.unitId)) {
      const mineral = u.unitId <= MINERAL_FIELD_MAX;
      const amount = u.validStates & UnitUsed.Resources ? u.resourceAmount : mineral ? DEFAULT_MINERALS : DEFAULT_GAS;
      if (mineral) { resources.minerals += amount; resources.fields++; } else { resources.gas += amount; resources.geysers++; }
    }
  }
  const top = [...byType].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 10).map(([id, count]) => ({ id, name: unitName(id), count }));

  let conditions = 0, actions = 0, preserved = 0, disabled = 0;
  for (const t of scn.triggers) {
    conditions += t.conditions.length;
    actions += t.actions.length;
    if (isPreserved(t)) preserved++;
    if (t.flags & TriggerFlag.Disabled) disabled++;
  }
  let briefingActions = 0;
  for (const t of scn.briefing) briefingActions += t.actions.length;

  let terrain: MapStatistics["terrain"] = null;
  if (tileset && terrainNames) {
    const counts = new Map<string, number>();
    const nameOf = new Map<number, string>();
    // Flat pairs carry the terrain id; every other group with an index is an edge set — cliff
    // faces and the seams between two terrains — which the CV5 does not name.
    tileset.groups.forEach((g, i) => {
      const name = g.index === 0 ? "Null" : g.index === 1 ? "Doodads"
        : isFlatPair(tileset, i & ~1) ? terrainNames.find((n) => n.id === g.index)?.name ?? `Terrain ${g.index}`
          : g.index >= 2 ? "Edges and cliffs" : "Other";
      nameOf.set(i, name);
    });
    for (const id of scn.tiles) {
      const name = nameOf.get(tileGroup(id)) ?? `Group ${tileGroup(id)} (not in the tileset)`;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    terrain = [...counts].sort((a, b) => b[1] - a[1]).map(([name, tiles]) => ({ name, tiles }));
  }

  return {
    width: scn.width,
    height: scn.height,
    tileset: TILESETS[tilesetIndex(scn)]?.name ?? `Tileset ${scn.era}`,
    revision: MAP_VERSIONS[mapVersionOf(scn.fileVersion)].label,
    sections: scn.chk.sections.length,
    strings: { slots: scn.strings.strings.length - 1, set: scn.strings.strings.filter((s, i) => i > 0 && s !== null).length, extended: scn.strings.extended },
    players,
    unownedUnits,
    units: { total: scn.units.length, buildings: dat ? buildings : null, top },
    resources,
    doodads: scn.doodads.length,
    sprites: { pure: scn.sprites.filter((s) => spriteKind(s) === "pure").length, unit: scn.sprites.filter((s) => spriteKind(s) === "unit").length },
    locations: scn.locations.filter((l, i) => i !== ANYWHERE_INDEX && isLocationUsed(l)).length,
    triggers: { count: scn.triggers.length, conditions, actions, preserved, disabled },
    briefings: { count: scn.briefing.length, actions: briefingActions },
    switchesNamed: scn.switchNames ? scn.switchNames.filter((s) => s !== 0).length : 0,
    sounds: scn.wavs ? scn.wavs.filter((w) => w !== 0).length : 0,
    terrain,
  };
}

/** The same numbers as plain text, for the clipboard. */
export function statisticsText(s: MapStatistics): string {
  const na = (v: number | null) => (v === null ? "n/a" : String(v));
  const lines = [
    `Map: ${s.width} × ${s.height} ${s.tileset}, ${s.revision}, ${s.sections} sections`,
    `Strings: ${s.strings.set} set of ${s.strings.slots} (${s.strings.extended ? "STRx" : "STR"})`,
    `Units: ${s.units.total} (buildings ${na(s.units.buildings)})${s.unownedUnits ? `, ${s.unownedUnits} with an owner past player 12` : ""}`,
    ...s.units.top.map((t) => `  ${t.count} × ${t.name}`),
    `Resources: ${s.resources.minerals} minerals in ${s.resources.fields} fields, ${s.resources.gas} gas in ${s.resources.geysers} geysers`,
    "Players:",
    ...s.players.map((p) => `  ${p.slot + 1}. ${p.type}, ${p.race}: ${p.units} units, ${na(p.buildings)} buildings, ${p.startLocations} start location${p.startLocations === 1 ? "" : "s"}`),
    `Doodads: ${s.doodads}; sprites: ${s.sprites.pure} pure, ${s.sprites.unit} unit; locations: ${s.locations}`,
    `Triggers: ${s.triggers.count} (${s.triggers.conditions} conditions, ${s.triggers.actions} actions, ${s.triggers.preserved} preserved, ${s.triggers.disabled} disabled); briefing: ${s.briefings.count} record${s.briefings.count === 1 ? "" : "s"}, ${s.briefings.actions} actions`,
    `Switches named: ${s.switchesNamed}; sounds: ${s.sounds}`,
  ];
  if (s.terrain) {
    lines.push("Terrain:");
    for (const t of s.terrain) lines.push(`  ${t.tiles} × ${t.name}`);
  }
  return lines.join("\n") + "\n";
}
