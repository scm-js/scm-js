/**
 * `scmjs map dump x.scx`: the map as text — one stable, readable form of everything the editor models, in the
 * order the file keeps it, so that a binary map can be read by `git diff` (`.gitattributes` names this command as
 * the file's textconv), grepped, or compared with the editor closed. Nothing is cut or summarised: the triggers are
 * in the trigger window's full text form and the strings as `map strings export` writes them, so the text says
 * everything the map does. The same data is `--json`.
 */
import { createHash } from "node:crypto";
import type { OpenedMap } from "../../src/editor/mapFile";
import { MAP_VERSIONS, mapVersionOf, scenarioDescription, scenarioName, serializeScenario, type Scenario } from "../../src/formats/chk/scenario";
import { parseChk } from "../../src/formats/chk/reader";
import { ANYWHERE_INDEX, type DoodadRecord, type LocationRecord, type SpriteRecord, type UnitRecord } from "../../src/formats/chk/sections/objects";
import { defaultTechRestrictions, defaultTechSettings, defaultUnitAvailability, defaultUnitSettings, defaultUpgradeRestrictions, defaultUpgradeSettings } from "../../src/formats/chk/sections/settings";
import { techName, upgradeName } from "../../src/data/units";
import { weaponName } from "../../src/data/weapons";
import type { TriggerRecord } from "../../src/formats/chk/sections/triggers";
import { readBriefing, readTriggers } from "../../src/editor/triggers";
import { formatStringTable, triggersToText } from "../../src/editor/exchange";
import { forceName } from "../../src/editor/settings";
import { locationName, usedLocations } from "../../src/editor/locations";
import { plainText } from "../../src/editor/textColors";
import { TILESETS } from "../../src/data/tilesets";
import { playerRaceLabel, playerTypeLabel, PLAYER_COLORS } from "../../src/data/players";
import { unitName } from "../../src/data/units";
import { TEXT_ENCODINGS } from "../../src/formats/text/encoding";

/**
 * The text form's revision: in the first line, so a reader (or a later scmjs) knows what it is looking at. 2 (0.13.4):
 * no file name in the first line (the same bytes under another name are the same text), sprites, doodads, the
 * settings that differ from a new map's, a hash beside each section.
 */
export const DUMP_FORMAT = 2;

export interface DumpPlayer { slot: number; type: string; race: string; color: string; force: number }
export interface DumpForce { index: number; name: string; flags: number }
/** `index` is the slot (0 up); `number` is how triggers name it (1 up). */
export interface DumpLocation { index: number; number: number; name: string; left: number; top: number; right: number; bottom: number; flags: number }
export interface DumpMember { name: string; bytes: number; sha1: string }
export interface DumpSection { name: string; bytes: number; sha1: string }
/** A setting that differs from a new map's: the table, the entry (by id and name), the player for a per-player column. */
export interface DumpSetting { table: string; id: number; name: string; player: number | null; values: Record<string, number> }

export interface MapDump {
  format: number;
  file: string;
  map: { name: string; description: string; width: number; height: number; tileset: string; version: string; encoding: string; extendedStrings: boolean };
  players: DumpPlayer[];
  forces: DumpForce[];
  units: UnitRecord[];
  sprites: SpriteRecord[];
  doodads: DoodadRecord[];
  settings: DumpSetting[];
  locations: DumpLocation[];
  triggers: TriggerRecord[];
  briefing: TriggerRecord[];
  /** The string table, index 1 up (`null` is an empty slot). */
  strings: (string | null)[];
  members: DumpMember[];
  /** The scenario's sections as they would be written, with repeats joined. */
  sections: DumpSection[];
}

/** Section bytes by name as they would be written (an edit re-encodes its section), repeats joined in order. */
export function sectionBytes(scn: Scenario): Map<string, Uint8Array> {
  const by = new Map<string, Uint8Array[]>();
  for (const sec of parseChk(serializeScenario(scn)).sections) by.set(sec.name, [...(by.get(sec.name) ?? []), sec.data]);
  return new Map([...by].map(([name, parts]) => {
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    return [name, all];
  }));
}

const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");

type Column = Uint8Array | Uint16Array | Uint32Array;
interface SettingsTable {
  table: string;
  get(scn: Scenario): object | null;
  fresh(): object;
  label(id: number): string;
  /** Columns with a value per player (12 × the entries), the rest one per entry. */
  perPlayer?: readonly string[];
  /** Only entries the map customises (`useDefault` 0) are listed, with every column: what the others hold is unused. */
  custom?: boolean;
  columns: readonly string[];
}

const SETTINGS_TABLES: readonly SettingsTable[] = [
  { table: "units", get: (s) => s.unitSettings, fresh: defaultUnitSettings, label: unitName, custom: true, columns: ["hitPoints", "shields", "armor", "buildTime", "mineralCost", "gasCost", "nameIndex"] },
  { table: "availability", get: (s) => s.unitAvailability, fresh: defaultUnitAvailability, label: unitName, perPlayer: ["playerAvailable", "playerUsesDefault"], columns: ["defaultAvailable", "playerAvailable", "playerUsesDefault"] },
  { table: "upgrades", get: (s) => s.upgradeSettings, fresh: defaultUpgradeSettings, label: upgradeName, custom: true, columns: ["mineralCost", "mineralFactor", "gasCost", "gasFactor", "timeCost", "timeFactor"] },
  { table: "upgrade levels", get: (s) => s.upgradeRestrictions, fresh: defaultUpgradeRestrictions, label: upgradeName, perPlayer: ["playerMax", "playerStart", "playerUsesDefault"], columns: ["defaultMax", "defaultStart", "playerMax", "playerStart", "playerUsesDefault"] },
  { table: "techs", get: (s) => s.techSettings, fresh: defaultTechSettings, label: techName, custom: true, columns: ["mineralCost", "gasCost", "researchTime", "energyCost"] },
  { table: "tech availability", get: (s) => s.techRestrictions, fresh: defaultTechRestrictions, label: techName, perPlayer: ["playerAvailable", "playerResearched", "playerUsesDefault"], columns: ["defaultAvailable", "defaultResearched", "playerAvailable", "playerResearched", "playerUsesDefault"] },
];

/**
 * The unit, upgrade and tech settings that differ from a new map's: a customised entry with its values, an entry
 * whose availability or levels differ (for everyone, or for one player), and a weapon whose damage a customised unit
 * changes. A map that leaves everything to the game lists nothing.
 */
export function changedSettings(scn: Scenario): DumpSetting[] {
  const out: DumpSetting[] = [];
  for (const spec of SETTINGS_TABLES) {
    const table = spec.get(scn) as Record<string, Column> | null;
    if (!table) continue;
    const fresh = spec.fresh() as Record<string, Column>;
    const shared = spec.columns.filter((c) => !spec.perPlayer?.includes(c));
    const count = Math.min(table[shared[0]]?.length ?? 0, fresh[shared[0]]?.length ?? 0) || Math.min(table.useDefault?.length ?? 0, fresh.useDefault?.length ?? 0);
    for (let id = 0; id < count; id++) {
      if (spec.custom) {
        if (table.useDefault[id] !== 0) continue;
        out.push({ table: spec.table, id, name: spec.label(id), player: null, values: Object.fromEntries(spec.columns.map((c) => [c, table[c][id]])) });
        continue;
      }
      const values: Record<string, number> = {};
      for (const c of shared) if (table[c][id] !== fresh[c][id]) values[c] = table[c][id];
      if (Object.keys(values).length) out.push({ table: spec.table, id, name: spec.label(id), player: null, values });
      // A player's own values count only where the player does not take the default (StarEdit leaves other bytes in
      // the columns of players who do, and the game reads none of them).
      for (let player = 0; player < 12 && spec.perPlayer; player++) {
        const at = player * count + id;
        if (table.playerUsesDefault?.[at] !== 0) continue;
        out.push({ table: spec.table, id, name: spec.label(id), player: player + 1, values: Object.fromEntries(spec.perPlayer.filter((c) => c !== "playerUsesDefault").map((c) => [c, table[c][at]])) });
      }
    }
  }
  // Weapons: their damage counts where a customised unit fires them; listed when the map customises any unit.
  const units = scn.unitSettings;
  if (units && units.useDefault.some((v) => v === 0)) {
    units.weaponDamage.forEach((damage, id) => { if (damage || units.weaponBonus[id]) out.push({ table: "weapons", id, name: weaponName(id), player: null, values: { weaponDamage: damage, weaponBonus: units.weaponBonus[id] } }); });
  }
  return out;
}

export function dumpMap(doc: OpenedMap, file: string): MapDump {
  const scn = doc.scenario;
  const colour = (i: number) => PLAYER_COLORS[scn.playerColors[i] ?? 0]?.name ?? String(scn.playerColors[i] ?? 0);
  return {
    format: DUMP_FORMAT,
    file,
    map: {
      name: plainText(scenarioName(scn) ?? ""), description: plainText(scenarioDescription(scn) ?? ""),
      width: scn.width, height: scn.height,
      tileset: TILESETS[scn.era]?.name ?? String(scn.era),
      version: MAP_VERSIONS[mapVersionOf(scn.fileVersion)].label,
      encoding: TEXT_ENCODINGS.find((e) => e.id === scn.strings.encoding)?.label ?? scn.strings.encoding,
      extendedStrings: scn.strings.extended,
    },
    players: Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, type: playerTypeLabel(scn.playerTypes[i] ?? 0), race: playerRaceLabel(scn.playerRaces[i] ?? 0), color: colour(i), force: (scn.forces.playerForce[i] ?? 0) + 1 })),
    forces: Array.from({ length: 4 }, (_, i) => ({ index: i + 1, name: plainText(forceName(scn, i)), flags: scn.forces.flags[i] ?? 0 })),
    units: scn.units,
    sprites: scn.sprites,
    doodads: scn.doodads,
    settings: changedSettings(scn),
    locations: usedLocations(scn).map((index) => { const l: LocationRecord = scn.locations[index]; return { index, number: index + 1, name: plainText(locationName(scn, index)), left: l.left, top: l.top, right: l.right, bottom: l.bottom, flags: l.elevationFlags }; }),
    triggers: readTriggers(scn),
    briefing: readBriefing(scn),
    strings: scn.strings.strings.slice(1),
    members: [...doc.extras].map(([name, bytes]) => ({ name, bytes: bytes.length, sha1: sha1(bytes) })).sort((a, b) => a.name.localeCompare(b.name)),
    sections: [...sectionBytes(scn)].map(([name, bytes]) => ({ name, bytes: bytes.length, sha1: sha1(bytes) })),
  };
}

const owner = (o: number) => (o === 11 ? "Neutral" : `Player ${o + 1}`);

/** One line per unit: what, whose, where, and the properties the record says are set. */
export function unitLine(u: UnitRecord): string {
  const props: string[] = [];
  if (u.resourceAmount) props.push(`resources ${u.resourceAmount}`);
  if (u.validProperties & 0x02 && u.hitPointsPercent !== 100) props.push(`hp ${u.hitPointsPercent}%`);
  if (u.validProperties & 0x04 && u.shieldPercent !== 100) props.push(`shields ${u.shieldPercent}%`);
  if (u.validProperties & 0x08 && u.energyPercent !== 100) props.push(`energy ${u.energyPercent}%`);
  if (u.hangarUnits) props.push(`hangar ${u.hangarUnits}`);
  if (u.stateFlags) props.push(`state ${u.stateFlags}`);
  if (u.relatedSerial) props.push(`related #${u.relatedSerial}`);
  return `${unitName(u.unitId)}  ${owner(u.owner)}  ${u.x},${u.y}${props.length ? `  ${props.join(", ")}` : ""}`;
}

/**
 * The dump as the file git and a reader see: plain text, no colour, a heading per part, every part present even when
 * empty so that two dumps line up part for part.
 */
export function printDump(d: MapDump, scn: Scenario): string {
  // No file name here: git compares this text, and the same bytes under another name are the same map.
  const out: string[] = [`# scmjs map dump ${d.format}`, ""];
  const part = (title: string, lines: string[]) => { out.push(`## ${title}`, ...(lines.length ? lines : ["  (none)"]), ""); };
  part("Map", [
    `  Name         ${d.map.name}`,
    `  Description  ${d.map.description.replace(/\r?\n/g, "\n               ")}`,
    `  Size         ${d.map.width} × ${d.map.height}`,
    `  Tileset      ${d.map.tileset}`,
    `  Version      ${d.map.version}`,
    `  Encoding     ${d.map.encoding}${d.map.extendedStrings ? ", extended strings" : ""}`,
  ]);
  part("Players", d.players.map((p) => `  ${p.slot}  ${p.type.padEnd(10)} ${p.race.padEnd(16)} ${p.color.padEnd(8)} force ${p.force}`));
  part("Forces", d.forces.map((f) => `  ${f.index}  ${f.name}${f.flags ? `  flags ${f.flags}` : ""}`));
  part(`Units (${d.units.length})`, d.units.map((u) => `  ${unitLine(u)}`));
  part(`Sprites (${d.sprites.length})`, d.sprites.map((s) => `  ${spriteLine(s)}`));
  part(`Doodads (${d.doodads.length})`, d.doodads.map((x) => `  doodad ${x.doodadId}  ${owner(x.owner)}  ${x.x},${x.y}${x.disabled ? "  disabled" : ""}`));
  // Anywhere is counted apart, as map info counts the locations placed on the map.
  const placed = d.locations.filter((l) => l.index !== ANYWHERE_INDEX).length;
  part(`Locations (${placed}${placed !== d.locations.length ? ", and Anywhere" : ""})`, d.locations.map((l) => `  ${String(l.number).padStart(3)}  ${l.name}  ${l.left},${l.top}–${l.right},${l.bottom}${l.flags ? `  flags ${l.flags}` : ""}`));
  part(`Settings (${d.settings.length})`, d.settings.map((x) => `  ${x.table}  ${x.name}${x.player === null ? "" : `  player ${x.player}`}  ${Object.entries(x.values).map(([k, v]) => `${k} ${v}`).join(", ")}`));
  part(`Triggers (${d.triggers.length})`, d.triggers.length ? triggersToText(scn, d.triggers).trimEnd().split("\n") : []);
  part(`Briefing (${d.briefing.length})`, d.briefing.length ? triggersToText(scn, d.briefing, true).trimEnd().split("\n") : []);
  // The strings with text: an empty slot is a gap the table keeps, as map info and map diff count them.
  const strings = formatStringTable(scn.strings).trimEnd().split("\n").filter((l) => /\t./.test(l));
  part(`Strings (${strings.length})`, strings.map((l) => `  ${l}`));
  part(`Archive members (${d.members.length})`, d.members.map((m) => `  ${m.name}  ${m.bytes} B  sha1 ${m.sha1.slice(0, 12)}`));
  part("Sections", d.sections.map((s) => `  ${s.name}  ${s.bytes} B  sha1 ${s.sha1.slice(0, 12)}`));
  return out.join("\n");
}

/** A sprite: a unit's sprite by the unit's name, a pure one by its sprites.dat id; whose, where, its flags. */
export function spriteLine(s: SpriteRecord): string {
  const pure = (s.flags & 0x1000) !== 0;
  return `${pure ? `sprite ${s.spriteId}` : `${unitName(s.spriteId)} (unit sprite)`}  ${owner(s.owner)}  ${s.x},${s.y}${s.flags ? `  flags 0x${s.flags.toString(16)}` : ""}`;
}
