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
import type { LocationRecord, UnitRecord } from "../../src/formats/chk/sections/objects";
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

/** The text form's revision: in the first line, so a reader (or a later scmjs) knows what it is looking at. */
export const DUMP_FORMAT = 1;

export interface DumpPlayer { slot: number; type: string; race: string; color: string; force: number }
export interface DumpForce { index: number; name: string; flags: number }
export interface DumpLocation { index: number; name: string; left: number; top: number; right: number; bottom: number; flags: number }
export interface DumpMember { name: string; bytes: number; sha1: string }
export interface DumpSection { name: string; bytes: number }

export interface MapDump {
  format: number;
  file: string;
  map: { name: string; description: string; width: number; height: number; tileset: string; version: string; encoding: string; extendedStrings: boolean };
  players: DumpPlayer[];
  forces: DumpForce[];
  units: UnitRecord[];
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
    locations: usedLocations(scn).map((index) => { const l: LocationRecord = scn.locations[index]; return { index, name: plainText(locationName(scn, index)), left: l.left, top: l.top, right: l.right, bottom: l.bottom, flags: l.elevationFlags }; }),
    triggers: readTriggers(scn),
    briefing: readBriefing(scn),
    strings: scn.strings.strings.slice(1),
    members: [...doc.extras].map(([name, bytes]) => ({ name, bytes: bytes.length, sha1: sha1(bytes) })).sort((a, b) => a.name.localeCompare(b.name)),
    sections: [...sectionBytes(scn)].map(([name, bytes]) => ({ name, bytes: bytes.length })),
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
  const out: string[] = [`# ${d.file} — scmjs map dump ${d.format}`, ""];
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
  part(`Locations (${d.locations.length})`, d.locations.map((l) => `  ${String(l.index).padStart(3)}  ${l.name}  ${l.left},${l.top}–${l.right},${l.bottom}${l.flags ? `  flags ${l.flags}` : ""}`));
  part(`Triggers (${d.triggers.length})`, d.triggers.length ? triggersToText(scn, d.triggers).trimEnd().split("\n") : []);
  part(`Briefing (${d.briefing.length})`, d.briefing.length ? triggersToText(scn, d.briefing, true).trimEnd().split("\n") : []);
  part(`Strings (${d.strings.filter((s) => s).length})`, formatStringTable(scn.strings).trimEnd().split("\n").filter(Boolean).map((l) => `  ${l}`));
  part(`Archive members (${d.members.length})`, d.members.map((m) => `  ${m.name}  ${m.bytes} B  sha1 ${m.sha1.slice(0, 12)}`));
  part("Sections", d.sections.map((s) => `  ${s.name}  ${s.bytes} B`));
  return out.join("\n");
}
