/**
 * Tools ▸ Check Map: what would stop the game loading the map, what will surprise a
 * player, and what is merely worth knowing. Pure over the scenario (plus the archive
 * extras for sound paths and the ISOM health the hook already measured), so the checks
 * are testable; `ValidateMapDialog` renders the list and jumps to the targets.
 */
import { isRemasteredRevision, MAP_VERSIONS, mapVersionOf, tilesetIndex, type Scenario } from "../formats/chk/scenario";
import { requiredSections } from "../formats/chk/create";
import { isLocationUsed } from "../formats/chk/sections/objects";
import { FORCE_SLOTS, isPaletteMode, PlayerType } from "../formats/chk/sections/players";
import { getString, stringTableOverflow, unencodableStrings } from "../formats/chk/sections/strings";
import { textEncodingInfo } from "../formats/text/encoding";
import { msg, t, translate } from "../i18n";
import { ActionFlag, ActionType, ConditionFlag, ConditionType, PlayerGroup, SwitchAction, SwitchState, TriggerFlag, type TriggerRecord } from "../formats/chk/sections/triggers";
import { actionDef, AI_SCRIPT_CHOICES, aiScriptCode, aiScriptId, conditionDef } from "../data/triggerDefs";
import { isRemasteredOnlyTile } from "../data/remasteredTiles";
import { START_LOCATION, UNIT_TYPE_COUNT, unitLabel } from "../data/units";
import { PLAYER_COLORS } from "../data/players";
import { UnitClass } from "../formats/chk/sections/triggers";
import type { DialogId } from "../components/dialogs/ids";
import type { IsomStatus } from "./isom";
import { CUWP_SLOTS, cuwpSlotActive } from "./cuwp";
import { isAnywhereIntact, locationCapacity, locationName } from "./locations";
import { CLASSIC_COLORS } from "./settings";
import { TILE_PX } from "./units";
import { findStockSound, isStockPath, type StockSounds } from "./stockSounds";
import { gameAcceptsSize, gameReadSections, gameSizeRule, KNOWN_VERSIONS, vcodPasses, type GameRead, type SizeRule } from "../formats/chk/game";
import { PlayerRace } from "../formats/chk/sections/players";
import { encodeText } from "../formats/text/encoding";
import { TILESETS } from "../data/tilesets";
import type { UnitsDat } from "../formats/dat/dat";
import { TILE_CREEP_FLAG, tileGroupOf, type Tileset } from "../formats/tileset/decode";
import { terrainFits } from "./placement";
import { isResource, unitGeometry } from "./units";

export type IssueLevel = "error" | "warn" | "info";

export type IssueTarget =
  | { kind: "location"; index: number }
  | { kind: "unit"; index: number }
  | { kind: "trigger"; index: number }
  | { kind: "dialog"; id: DialogId };

export interface Issue {
  level: IssueLevel;
  text: string;
  where: string;
  target?: IssueTarget;
}

export interface ValidateContext {
  /** Non-scenario archive members, for the sound paths triggers play. */
  extras?: Map<string, Uint8Array>;
  /** The game's own sounds, when the game data lists them: a trigger may play one with no file in the map. */
  stockSounds?: StockSounds | null;
  /** The ISOM health `useIsomStatus` measured; omitted = not checked. */
  isom?: IsomStatus;
  /** units.dat, for the unit rules that depend on a type's flags; omitted = those are skipped or counted plainly. */
  units?: UnitsDat | null;
  /** The map's tileset, for units standing where they cannot walk; omitted = not checked. */
  tileset?: Tileset | null;
}

/** units.dat group flag the game keeps a User Selectable player's placed units by: critters, resources, beacons, doors, power-ups. */
const NEUTRAL_GROUP = 0x80;
/** What a melee game keeps of the placed units besides start locations: Player 12's mineral fields, geyser and critters. */
const MELEE_KEPT = new Set([176, 177, 178, 188, 89, 90, 93, 94, 95, 96]);
/** In-game slot types whose placed units the game creates (human, computer, rescuable, unused, neutral; open ones once filled). */
const CREATED_SLOT_TYPES = new Set([1, 2, 3, 4, 5, 6, 7]);
/** Resource amounts, CUWP resources and Modify Unit Resource Amount are kept as 16 bits. */
const RESOURCE_LIMIT = 0xffff;
/** What StarCraft 1.16.1 shows of the map name, description and a force name, in bytes. */
const NAME_BYTES = 31, DESCRIPTION_BYTES = 255, FORCE_NAME_BYTES = 29;
/** The scripts Run AI Script runs for a human or rescuable owner; a computer runs any. */
/** Actions the game refuses for Players 9–12 and None. */
const PLAYERS_1_TO_8_ONLY: ReadonlySet<number> = new Set([ActionType.CreateUnit, ActionType.CreateUnitWithProperties, ActionType.SetResources, ActionType.SetScore]);
const HUMAN_AI_SCRIPTS = new Set(["EnBk", "EnTr", "ExTr", "DWHe", "PB3F", ...Array.from({ length: 8 }, (_, i) => `+Vi${i}`), ...Array.from({ length: 8 }, (_, i) => `-Vi${i}`)]);

/** A size rule in words, for Check Map. */
function sizeRuleText(rule: SizeRule): string {
  if ("exactly" in rule) return t("exactly {n} bytes", { n: rule.exactly });
  if ("multiple" in rule) return t("whole records of {n} bytes", { n: rule.multiple });
  if ("atMost" in rule) return t("at most {n} bytes", { n: rule.atMost });
  return "";
}

/** The game keeps at most this many units in play; StarEdit refuses to place more. */
export const UNIT_LIMIT = 1700;
/**
 * Why a map whose STR table runs past 64 KB cannot be saved: Check Map's error, and the
 * reason Save gives for refusing.
 */
export function strOverflowText(n: number): string {
  return t("{n, plural, one {# string starts} other {# strings start}} past the first 64 KB of the STR table, which is as far as its offsets reach; the game would show other text in their place. Shorten or remove text, or move the map to a Remastered revision (Scenario ▸ Map Revision), whose STRx table has no such limit.", { n });
}

/** String slots the editor keeps in an STRx table. */
export const STRX_CAPACITY = 65535;

const normalize = (name: string) => name.replace(/\//g, "\\").toLowerCase();

/** The original-game section each Brood War `x` section supersedes. */

/** Whether the file has (or will write) a section. */
function hasSection(scn: Scenario, name: string): boolean {
  return scn.chk.sections.some((s) => s.name === name) || scn.dirty.has(name);
}

export function validateScenario(scn: Scenario, ctx: ValidateContext = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (level: IssueLevel, text: string, where: string, target?: IssueTarget) => { issues.push({ level, text, where, target }); };

  // ── Sections the game needs ──
  // Every game needs the map-list sections and the terrain, sprites and units; only Use Map
  // Settings reads the fog, locations, triggers and settings tables (docs/chk-format.md).
  // The game takes STRx in place of STR only in a Remastered revision (VER 64 or 206).
  const remastered = isRemasteredRevision(scn.fileVersion);
  const strxOnly = scn.strings.extended && !hasSection(scn, "STR ");
  const absent = (n: string) => !hasSection(scn, n) && !(n === "STR " && strxOnly);
  const missingAll = requiredSections(scn.fileVersion, "melee").filter(absent);
  const missingUms = requiredSections(scn.fileVersion, "ums").filter((n) => absent(n) && !missingAll.includes(n));
  const names = (list: string[]) => list.map((n) => n.trim()).join(", ");
  if (strxOnly && !remastered) {
    add("error", t("The strings are in STRx, which the game reads only in a Remastered revision, so this map shows as Invalid Scenario. Map Revision fixes it: choose Remastered to keep STRx, or press OK as it is to move the strings to STR."), msg("File"), { kind: "dialog", id: "mapRevision" });
  } else if (!remastered && hasSection(scn, "STRx")) {
    add("info", t("The file also has a STRx string table, which the game does not read in this revision. The editor shows the STR text, as the game does."), msg("File"), { kind: "dialog", id: "mapRevision" });
  }
  if (missingAll.length > 0) {
    add("error", t("Missing {join} — the game will not load this map.", { join: names(missingAll) }), msg("File"), { kind: "dialog", id: "mapRevision" });
  }
  if (missingUms.length > 0) {
    add(scn.triggers.length > 0 ? "error" : "warn", t("Missing {join} — a Use Map Settings game of this map stops as it starts. Melee and the other game types do not need them.", { join: names(missingUms) }), msg("File"), { kind: "dialog", id: "mapRevision" });
  }
  add("info", t("Map revision: {label} (VER {ver}, {type}, {table}).", { label: MAP_VERSIONS[mapVersionOf(scn.fileVersion)].label, ver: scn.fileVersion, type: scn.type, table: scn.strings.extended ? "STRx" : "STR" }), msg("Header"));
  // What the parser noticed on the way in: a section cut short, a DIM that had to be guessed.
  for (const w of scn.warnings) add("warn", w, msg("File"));

  // ── What the game accepts of each section ──
  // Every copy of a section a read takes must have the length the game insists on, and lie
  // inside the file (docs/chk-format.md, Lengths). A section the save rewrites is right by then.
  const ums = scn.triggers.length > 0;
  if (!KNOWN_VERSIONS.includes(scn.fileVersion)) {
    add("error", t("VER {ver} is not a revision the game knows (59, 63 and 205, and Remastered's 64 and 206), so the map list shows the map as Invalid Scenario. Map Revision sets a known one.", { ver: scn.fileVersion }), msg("File"), { kind: "dialog", id: "mapRevision" });
  }
  const judged = new Set<string>();
  for (const read of ["list", "melee", "ums", "briefing"] as GameRead[]) {
    for (const name of gameReadSections(read, scn.fileVersion, remastered)) {
      if (judged.has(name) || scn.dirty.has(name)) continue;
      const rule = gameSizeRule(name, scn.fileVersion);
      const bad = scn.chk.sections.find((s) => s.name === name && (s.truncated || !gameAcceptsSize(rule, s.data.length)));
      if (!bad) continue;
      judged.add(name);
      const what = bad.truncated
        ? t("{name} runs past the end of the file", { name: name.trim() })
        : t("{name} has a copy of {length} bytes where the game takes {rule}", { name: name.trim(), length: bad.data.length, rule: sizeRuleText(rule) });
      if (read === "list") add("error", t("{what}, so the map list shows the map as Invalid Scenario.", { what }), msg("File"));
      else if (read === "melee") add("error", t("{what}, so the game refuses to start the map (Error loading scenario file).", { what }), msg("File"));
      else if (read === "ums") add(ums ? "error" : "warn", t("{what}, so a Use Map Settings game of this map stops as it starts.", { what }), msg("File"));
      else add("warn", t("{what}, so the mission briefing does not play.", { what }), msg("Briefing"));
    }
  }
  // A VCOD other than StarEdit's passes the game's check only for some players.
  if (scn.chk.sections.some((s) => s.name === "VCOD" && !vcodPasses(s.data, scn.playerTypes, scn.playerRaces))) {
    add("warn", t("The map's VCOD fails the game's check for these player types and races, so as it stands the map shows as Invalid Scenario. Saving writes StarEdit's table in its place, which passes for any players."), msg("File"), { kind: "dialog", id: "playerSettings" });
  }
  if (scn.width > 256 || scn.height > 256) {
    add("error", t("The map is {width} × {height}. Remastered's map list refuses a side longer than 256, and StarCraft 1.16.1 runs past its terrain buffers.", { width: scn.width, height: scn.height }), msg("File"), { kind: "dialog", id: "mapProperties" });
  }
  const era = tilesetIndex(scn);
  const tilesetName = translate(TILESETS[era]?.name ?? "") || String(era);
  if (era > 4 && scn.fileVersion < 205) {
    add("warn", t("The map is on {tileset}, a Brood War tileset, at the revision {label}: StarCraft without Brood War refuses it, so it loads only in Brood War. Choose a Brood War revision, or a StarCraft tileset.", { tileset: tilesetName, label: MAP_VERSIONS[mapVersionOf(scn.fileVersion)].label }), msg("File"), { kind: "dialog", id: "mapRevision" });
  }
  if (era === 2 && !ums) {
    add("warn", t("Installation maps play only as Use Map Settings: the game refuses them for melee and the other game types."), msg("File"));
  }

  // ── Players and start locations ──
  if (scn.editorPlayerTypes && scn.editorPlayerTypes.some((trig, i) => trig !== scn.playerTypes[i])) {
    add("warn", t("The player types StarEdit shows (IOWN) differ from the ones the game reads (OWNR); another tool wrote one and not the other. Player Settings rewrites both."), msg("Players"), { kind: "dialog", id: "playerSettings" });
  }
  // COLR holds twelve colours: older versions show a wrong one past them, and Remastered skips
  // the value (docs/chk-format.md, COLR). A slot on a Remastered colour mode does not use it.
  // Only a Brood War revision (205, 206) reads COLR at all.
  const colorName = (c: number) => translate(PLAYER_COLORS[c]?.name ?? "") || String(c);
  if (scn.fileVersion < 205 && scn.playerColors.some((c, p) => c !== p)) {
    add("info", t("This revision does not read the player colours (COLR): in the game every player has their slot's usual colour."), msg("Players"), { kind: "dialog", id: "playerColors" });
  }
  for (let p = 0; p < FORCE_SLOTS && scn.fileVersion >= 205; p++) {
    if (scn.playerTypes[p] !== PlayerType.Human && scn.playerTypes[p] !== PlayerType.Computer) continue;
    if (scn.playerColors[p] < CLASSIC_COLORS || (scn.playerRgb && !isPaletteMode(scn.playerRgb.mode[p]))) continue;
    add("warn", t("Player {n}'s colour, {name}, is past the twelve the game takes as a palette colour: older versions show a wrong colour and Remastered the player's usual one.", { n: p + 1, name: colorName(scn.playerColors[p]) }), msg("Players"), { kind: "dialog", id: "playerColors" });
  }
  const starts = scn.units.map((u, index) => ({ u, index })).filter(({ u }) => u.unitId === START_LOCATION);
  scn.playerTypes.forEach((type, p) => {
    const mine = starts.filter(({ u }) => u.owner === p);
    const playable = type === PlayerType.Human || type === PlayerType.Computer;
    // Melee puts a player's start units at the start location, and without one the player is
    // eliminated at once. A Use Map Settings game starts fine; only the view starts at the top-left.
    if (playable && mine.length === 0) {
      const slot = type === PlayerType.Human ? t("Human") : t("Computer");
      if (!ums) add(type === PlayerType.Human ? "error" : "warn", t("No start location for Player {n} (slot is {type}): in a melee game that player gets no start units and is eliminated at once.", { n: p + 1, type: slot }), msg("Players"), { kind: "dialog", id: "playerSettings" });
      else add("info", t("No start location for Player {n} (slot is {type}): in a Use Map Settings game the view starts at the top-left corner.", { n: p + 1, type: slot }), msg("Players"), { kind: "dialog", id: "playerSettings" });
    }
    // StarCraft 1.16.1 writes a start location of Players 9–12 past the end of its table.
    if (p >= 8 && mine.length > 0) add("error", t("Player {v} has a start location. Only Players 1–8 can: StarCraft 1.16.1 writes it past the end of its table, and Remastered ignores it.", { v: p + 1 }), msg("Players"), { kind: "unit", index: mine[0].index });
    else if (!playable && type !== PlayerType.Rescuable && mine.length > 0) add("warn", t("Player {v} has a start location but its slot is not playable.", { v: p + 1 }), msg("Players"), { kind: "unit", index: mine[0].index });
    if (mine.length > 1) add("warn", t("Player {v} has {length} start locations; the game uses the last one in the unit list.", { v: p + 1, length: mine.length }), msg("Units"), { kind: "unit", index: mine[mine.length - 1].index });
  });

  // ── Units the game leaves out ──
  // What the game does with the placed units at the start (docs/chk-format.md, UNIT). Use Map
  // Settings: a User Selectable player keeps only neutral-flagged types and gets melee start
  // units, and units of a slot that is not in the game are never made. Melee: only start
  // locations and Player 12's resources and critters stay.
  const placed = scn.units.map((u, index) => ({ u, index })).filter(({ u }) => u.unitId !== START_LOCATION);
  if (ums) {
    for (let p = 0; p < FORCE_SLOTS; p++) {
      const mine = placed.filter(({ u }) => u.owner === p);
      if (mine.length === 0) continue;
      if (!CREATED_SLOT_TYPES.has(scn.playerTypes[p])) {
        add("warn", t("{n, plural, one {# unit belongs} other {# units belong}} to Player {v}, whose slot is not in the game, so the game never creates them. Make the slot Human, Computer, Rescuable or Neutral in Player Settings.", { n: mine.length, v: p + 1 }), msg("Units"), { kind: "unit", index: mine[0].index });
        continue;
      }
      if (scn.playerRaces[p] !== PlayerRace.UserSelectable) continue;
      const dropped = mine.filter(({ u }) => !ctx.units || ((ctx.units.groupFlags[u.unitId] ?? 0) & NEUTRAL_GROUP) === 0);
      if (dropped.length > 0) add("warn", t("Player {v}'s race is User Selectable, so in a Use Map Settings game the game removes their {n, plural, one {# placed unit} other {# placed units}} and gives them melee start units instead. Choose a race in Player Settings.", { v: p + 1, n: dropped.length }), msg("Units"), { kind: "dialog", id: "playerSettings" });
    }
  } else {
    const dropped = placed.filter(({ u }) => !(u.owner === 11 && MELEE_KEPT.has(u.unitId)));
    const resources = dropped.filter(({ u }) => isResource(u.unitId));
    if (resources.length > 0) add("warn", t("{n, plural, one {# mineral field or geyser belongs} other {# mineral fields and geysers belong}} to a player other than Player 12; a melee game keeps only Player 12's.", { n: resources.length }), msg("Units"), { kind: "unit", index: resources[0].index });
    if (dropped.length > resources.length) add("info", t("This map has no triggers, so it plays as melee, where the game keeps only start locations and Player 12's resources and critters: {n, plural, one {# other placed unit is} other {# other placed units are}} for Use Map Settings only.", { n: dropped.length - resources.length }), msg("Units"));
  }

  // ── Units ──
  if (scn.units.length === 0) add("info", t("The map has no units."), msg("Units"));
  // Start locations take no unit slot; past the limit the game makes no more and the map still loads.
  if (placed.length > UNIT_LIMIT) add("warn", t("{length} units — the game holds at most {UNIT_LIMIT}, and creates none past that.", { length: placed.length, UNIT_LIMIT }), msg("Units"));
  const overflowing = scn.units.map((u, index) => ({ u, index })).filter(({ u }) => u.resourceAmount > RESOURCE_LIMIT && isResource(u.unitId));
  if (overflowing.length > 0) add("warn", t("{n, plural, one {# unit holds} other {# units hold}} more than {limit} resources; the game keeps 16 bits, so 70000 becomes 4464.", { n: overflowing.length, limit: RESOURCE_LIMIT }), msg("Units"), { kind: "unit", index: overflowing[0].index });
  // Ground units touching ground they cannot walk on are removed at the start ("Unit unplaceable").
  if (ctx.tileset && ctx.units) {
    let stranded = 0;
    scn.units.forEach((u, index) => {
      const g = unitGeometry(ctx.units ?? null, u.unitId);
      if (g.building || terrainFits(scn, ctx.tileset!, g, u.unitId, u.x, u.y)) return;
      if (stranded++ < 10) add("warn", t("{unitName} (Player {v}) at {x}, {y} touches ground it cannot walk on; the game removes it at the start (Unit unplaceable).", { unitName: unitLabel(u.unitId), v: u.owner + 1, x: u.x, y: u.y }), msg("Units"), { kind: "unit", index });
    });
    if (stranded > 10) add("warn", t("{n} more units stand where they cannot walk.", { n: stranded - 10 }), msg("Units"));
  }
  scn.units.forEach((u, index) => {
    if (u.x < 0 || u.y < 0 || u.x >= scn.width * TILE_PX || u.y >= scn.height * TILE_PX) {
      add("error", t("{unitName} (Player {v}) is outside the map at {x}, {y}.", { unitName: unitLabel(u.unitId), v: u.owner + 1, x: u.x, y: u.y }), msg("Units"), { kind: "unit", index });
    }
    if (u.owner >= scn.playerTypes.length) add("warn", t("{unitName} is owned by player {v}, which does not exist.", { unitName: unitLabel(u.unitId), v: u.owner + 1 }), msg("Units"), { kind: "unit", index });
  });

  // ── Locations ──
  const slots = locationCapacity(scn);
  scn.locations.forEach((l, index) => {
    if (index >= slots && isLocationUsed(l)) {
      add("error", t("Location {n} is past the {slots} slots a StarCraft 1.00 file holds, and is lost on save. Move it to a lower slot, or change the map's revision.", { n: index, slots }), msg("Locations"), { kind: "location", index });
    }
  });
  if (!isAnywhereIntact(scn)) add("warn", t("Location 63 'Anywhere' is not the whole map; triggers that use Anywhere will not see everything."), msg("Locations"), { kind: "location", index: 63 });
  const seenNames = new Map<string, number>();
  scn.locations.forEach((l, index) => {
    if (!isLocationUsed(l)) return;
    const name = locationName(scn, index).toLowerCase();
    const first = seenNames.get(name);
    if (first !== undefined) add("info", t("Locations {first} and {index} are both named '{locationName}'.", { first, index, locationName: locationName(scn, index) }), msg("Locations"), { kind: "location", index });
    else seenNames.set(name, index);
  });

  // ── Strings ──
  const count = scn.strings.strings.length - 1;
  if (scn.strings.extended && count > STRX_CAPACITY) add("error", t("{count} strings — the {table} table holds {capacity}.", { count, table: "STRx", capacity: STRX_CAPACITY }), msg("Strings"), { kind: "dialog", id: "stringEditor" });
  // The game has no fixed number of STR strings (1024 is StarEdit's own table); what it cannot
  // do is reach a string that starts past the 16-bit offsets' 64 KB.
  const unreachable = stringTableOverflow(scn.strings);
  if (unreachable > 0) add("error", strOverflowText(unreachable), msg("Strings"), { kind: "dialog", id: "stringEditor" });
  // StarCraft 1.16.1 shows only so many bytes of the names (colour codes count).
  const bytesOf = (index: number) => { const s = getString(scn.strings, index); return s ? encodeText(s, scn.strings.encoding).length : 0; };
  if (bytesOf(scn.nameIndex) > NAME_BYTES) add("info", t("The map name is {n} bytes; StarCraft 1.16.1 shows only the first {max}.", { n: bytesOf(scn.nameIndex), max: NAME_BYTES }), msg("Strings"), { kind: "dialog", id: "mapProperties" });
  if (bytesOf(scn.descriptionIndex) > DESCRIPTION_BYTES) add("info", t("The map description is {n} bytes; StarCraft 1.16.1 shows only the first {max}.", { n: bytesOf(scn.descriptionIndex), max: DESCRIPTION_BYTES }), msg("Strings"), { kind: "dialog", id: "mapProperties" });
  scn.forces.nameIndex.forEach((index, f) => {
    if (bytesOf(index) > FORCE_NAME_BYTES) add("info", t("Force {v}'s name is {n} bytes; StarCraft 1.16.1 shows only the first {max}.", { v: f + 1, n: bytesOf(index), max: FORCE_NAME_BYTES }), msg("Strings"), { kind: "dialog", id: "forceSettings" });
  });
  // StarCraft 1.16.1 shows text byte by byte in the local code page; only Remastered reads UTF-8.
  if (!remastered && scn.strings.encoding === "utf-8") {
    const wide = scn.strings.strings.filter((s) => s && [...s].some((c) => c.charCodeAt(0) > 0x7f)).length;
    if (wide > 0) add("info", t("{n, plural, one {# string is} other {# strings are}} written as UTF-8 with characters outside ASCII: Remastered reads them, StarCraft 1.16.1 shows other characters in their place.", { n: wide }), msg("Strings"), { kind: "dialog", id: "mapRevision" });
  }
  const lost = unencodableStrings(scn.strings);
  if (lost.length > 0) {
    const chars = [...new Set(lost.flatMap((l) => l.chars))];
    const shown = chars.slice(0, 8).join(" ") + (chars.length > 8 ? " …" : "");
    add("error", t("{n, plural, one {# string uses} other {# strings use}} characters {encoding} cannot hold ({chars}); they will be saved as '?'. Choose a text encoding that holds them (Scenario ▸ Map Revision).", { n: lost.length, encoding: translate(textEncodingInfo(scn.strings.encoding).label), chars: shown }), msg("Strings"), { kind: "dialog", id: "mapRevision" });
  }

  // ── Settings ──
  // The game takes a custom unit name only with the type's other custom settings.
  if (scn.unitSettings) {
    const named = Array.from({ length: UNIT_TYPE_COUNT }, (_, id) => id).filter((id) => scn.unitSettings!.useDefault[id] && scn.unitSettings!.nameIndex[id]);
    if (named.length > 0) add("warn", t("{n, plural, one {# unit type has} other {# unit types have}} a custom name but uses the default settings ({first}); the game reads the name only together with the other custom settings, so it shows the usual name. Untick Use default unit settings in Unit Settings.", { n: named.length, first: unitLabel(named[0]) }), msg("Settings"), { kind: "dialog", id: "unitSettings" });
  }
  scn.cuwp?.forEach((slot, i) => {
    if (cuwpSlotActive(slot) && slot.resources > RESOURCE_LIMIT) add("warn", t("Properties slot {v} gives {amount} resources; the game keeps 16 bits, so it becomes {wrapped}.", { v: i + 1, amount: slot.resources, wrapped: slot.resources & RESOURCE_LIMIT }), msg("Triggers"), { kind: "dialog", id: "cuwpEditor" });
  });

  // ── Triggers ──
  // A type past the game's tables: 1.16.1 calls past their end (a crash); Remastered runs
  // whatever follows, which is no action at all or the wrong one.
  const unknownLevel: IssueLevel = remastered ? "warn" : "error";
  const unknownText = remastered ? t("Remastered does something else in its place") : t("StarCraft 1.16.1 crashes when the trigger reaches it");
  const tested = new Set<number>();
  const set = new Set<number>();
  const stringOk = (i: number) => i < scn.strings.strings.length;
  const checkTrigger = (trig: TriggerRecord, index: number, where: string, briefing: boolean) => {
    const target: IssueTarget | undefined = briefing ? { kind: "dialog", id: "missionBriefing" } : { kind: "trigger", index };
    const label = briefing ? `Briefing ${index + 1}` : `Trigger ${index + 1}`;
    if (trig.flags & TriggerFlag.Disabled) add("info", t("{label} is disabled.", { label }), where, target);
    if (!briefing && (trig.flags & TriggerFlag.IgnoreGameEnd)) add("warn", t("{label} has flag 0x02 (Defeat Others): each time its actions run, every other player in the game without a result is defeated, and its own Defeat or Draw never takes effect.", { label }), where, target);
    const checkLocation = (value: number, what: string, condition = false) => {
      if (value === 0) {
        add("warn", condition
          ? t("{label}: {what} has no location, so it is never true.", { label, what })
          : t("{label}: {what} has no location, so it does nothing (a Transmission shows no text either).", { label, what }), where, target);
        return;
      }
      const slot = value - 1;
      if (!scn.locations[slot] || !isLocationUsed(scn.locations[slot])) add("warn", t("{label}: {what} uses location {slot}, which does not exist.", { label, what, slot }), where, target);
    };
    const checkString = (value: number, what: string) => {
      if (value > 0 && !stringOk(value)) add("warn", t("{label}: {what} refers to string #{value}, past the end of the table, so the game shows nothing.", { label, what, value }), where, target);
    };
    const checkUnit = (value: number, what: string) => {
      const klass = (Object.values(UnitClass) as number[]).includes(value);
      if (value >= UNIT_TYPE_COUNT && !klass) add("warn", t("{label}: {what} names unit type {value}, which the game does not have (types run to {v}, the classes {Any}–{Factories}).", { label, what, value, v: UNIT_TYPE_COUNT - 1, Any: UnitClass.Any, Factories: UnitClass.Factories }), where, target);
    };
    const checkPlayer = (value: number, what: string) => {
      if (value > 26) add("info", t("{label}: {what} uses player value {value} — beyond the game's groups, so a memory address (EUD) or a mistake.", { label, what, value }), where, target);
    };
    // The game plays a briefing only when its first condition is Mission Briefing; in a trigger that condition is never true.
    if (briefing && trig.conditions[0]?.type !== ConditionType.Briefing) add("warn", t("{label} does not start with the Mission Briefing condition, so the game never plays it.", { label }), where, target);
    for (const c of trig.conditions) {
      if (c.type === ConditionType.None) break;
      if (c.flags & ConditionFlag.Disabled) continue;
      const def = conditionDef(c.type);
      if (!def) { add(unknownLevel, t("{label}: condition type {type} is not one the game has; {what}.", { label, type: c.type, what: unknownText }), where, target); continue; }
      if (!briefing && c.type === ConditionType.Briefing) add("warn", t("{label}: Mission Briefing is never true in a trigger, so the trigger never runs.", { label }), where, target);
      for (const a of def.args) {
        if (a.kind === "location") checkLocation(c[a.field], def.name, true);
        if (a.kind === "unit") checkUnit(c[a.field], def.name);
        if (a.kind === "player") checkPlayer(c[a.field], def.name);
        // A switch tested for Cleared that nothing sets is simply always true.
        if (a.kind === "switch" && c.type === ConditionType.Switch && c.comparison !== SwitchState.Cleared) tested.add(c[a.field]);
      }
    }
    const owners = triggerRunsFor(trig, scn);
    const humanOnly = owners.size > 0 && [...owners].every((p) => scn.playerTypes[p] === PlayerType.Human || scn.playerTypes[p] === PlayerType.Rescuable);
    for (const a of trig.actions) {
      if (a.type === ActionType.None) break;
      if (a.flags & ActionFlag.Disabled) continue;
      const def = actionDef(a.type, briefing);
      if (!def) { add(unknownLevel, t("{label}: action type {type} is not one the game has; {what}.", { label, type: a.type, what: unknownText }), where, target); continue; }
      // These refuse Players 9–12 (and None) in the game.
      if (!briefing && PLAYERS_1_TO_8_ONLY.has(a.type) && a.player >= PlayerGroup.Player9 && a.player <= PlayerGroup.None) {
        add("warn", t("{label}: {name} does nothing for {player}; the game takes only Players 1–8 there.", { label, name: def.name, player: a.player === PlayerGroup.None ? t("None") : t("Player {v}", { v: a.player + 1 }) }), where, target);
      }
      if (!briefing && a.type === ActionType.ModifyResourceAmount && a.target > RESOURCE_LIMIT) {
        add("warn", t("{label}: {name} sets {amount}; the game keeps 16 bits, so it becomes {wrapped}.", { label, name: def.name, amount: a.target, wrapped: a.target & RESOURCE_LIMIT }), where, target);
      }
      if (!briefing && humanOnly && (a.type === ActionType.RunAiScript || a.type === ActionType.RunAiScriptAt) && !HUMAN_AI_SCRIPTS.has(aiScriptId(a.target))) {
        add("warn", t("{label}: {name} runs {script} for human or rescuable players only; for them the game runs just the few scripts that act on a player (EnBk, EnTr, ExTr, DWHe, PB3F, +Vi, -Vi), so this one does nothing.", { label, name: def.name, script: aiScriptId(a.target) }), where, target);
      }
      for (const arg of def.args) {
        if (arg.kind === "location") checkLocation(a[arg.field], def.name);
        if (arg.kind === "unit") checkUnit(a[arg.field], def.name);
        if (arg.kind === "player") checkPlayer(a[arg.field], def.name);
        if (arg.kind === "aiScript" && !AI_SCRIPT_CHOICES.some((c) => aiScriptCode(c.id) === a[arg.field])) add("info", t("{label}: {name} runs AI script {id}, which is not one StarEdit lists; the game runs it if its script files have it (the campaign scripts are there too).", { label, name: def.name, id: aiScriptId(a[arg.field]) }), where, target);
        if (arg.kind === "text") checkString(a[arg.field], def.name);
        if (arg.kind === "wav") {
          checkString(a[arg.field], def.name);
          const path = a[arg.field] > 0 ? getString(scn.strings, a[arg.field]) : null;
          if (path && ctx.extras && ![...ctx.extras.keys()].some((k) => normalize(k) === normalize(path))) {
            // A path into the game's sound folder plays from the game's files. Without the
            // list there is no telling a real one from a typo, so only a listed miss is said.
            if (!isStockPath(path)) add("warn", t("{label}: {name} plays '{path}', which is not in the archive.", { label, name: def.name, path }), where, target);
            else if (ctx.stockSounds && !findStockSound(ctx.stockSounds, path)) add("warn", t("{label}: {name} plays '{path}', which is not in the archive and not one of the sounds the game lists.", { label, name: def.name, path }), where, target);
          }
        }
        if (arg.kind === "switch" && a.type === ActionType.SetSwitch && a.modifier !== SwitchAction.Clear) set.add(a[arg.field]);
        if (arg.kind === "cuwp") {
          const slot = a[arg.field];
          if (slot < 1 || slot > CUWP_SLOTS) add("warn", t("{label}: {name} names properties slot {slot}; the slots are 1 to {CUWP_SLOTS}.", { label, name: def.name, slot, CUWP_SLOTS }), where, target);
          else if (!scn.cuwp || !cuwpSlotActive(scn.cuwp[slot - 1])) add("info", t("{label}: {name} uses slot {slot}, which sets nothing (Triggers ▸ Unit Properties Slots…).", { label, name: def.name, slot }), where, { kind: "dialog", id: "cuwpEditor" });
        }
      }
    }
  };
  scn.triggers.forEach((trig, i) => {
    checkTrigger(trig, i, msg("Triggers"), false);
    // Each ticked owner that reaches a player gives that player a copy of its own.
    const twice: number[] = [];
    for (let p = 0; p < FORCE_SLOTS; p++) {
      const force = scn.forces.playerForce[p];
      const n = (trig.players[p] ? 1 : 0) + (trig.players[PlayerGroup.AllPlayers] ? 1 : 0) + (force !== undefined && trig.players[PlayerGroup.Force1 + force] ? 1 : 0);
      if (n > 1) twice.push(p + 1);
    }
    if (twice.length > 0 && !(trig.flags & TriggerFlag.Disabled)) add("warn", t("Trigger {v} is ticked more than once for {players} (a player and All Players, or a player and their force): each tick gives that player a copy, so the trigger runs twice.", { v: i + 1, players: twice.map((p) => t("Player {v}", { v: p })).join(", ") }), msg("Triggers"), { kind: "trigger", index: i });
  });
  // An Ogg plays in Remastered only; an older revision's game skips it.
  if (scn.wavs && !remastered) {
    scn.wavs.forEach((i, slot) => {
      const path = i > 0 ? getString(scn.strings, i) : null;
      if (path && /\.ogg$/i.test(path)) add("warn", t("Sound {slot} is an Ogg ({path}); only Remastered plays those, and this map's revision is {label}.", { slot, path, label: MAP_VERSIONS[mapVersionOf(scn.fileVersion)].label }), msg("Sounds"), { kind: "dialog", id: "soundEditor" });
    });
  }
  scn.briefing.forEach((trig, i) => checkTrigger(trig, i, msg("Briefing"), true));
  for (const s of [...tested].sort((a, b) => a - b)) {
    if (!set.has(s)) add("warn", t("Switch {v} is tested by a condition but no action ever sets it.", { v: s + 1 }), msg("Triggers"), { kind: "dialog", id: "switches" });
  }
  for (const i of umsIssues(scn)) add(i.level, i.text, i.where, i.target);

  // ── Terrain ──
  if (ctx.isom?.kind === "missing") add("warn", t("The map has no ISOM section: the isometric brush needs one (the Repair plugin rebuilds it: Tools ▸ Repair Map…)."), msg("Terrain"));
  // Only what a rebuild would recover: the rest is terrain no lattice describes, and
  // warning about it recommends a repair that cannot move the number.
  if (ctx.isom?.kind === "ready" && ctx.isom.report.stale) {
    const { rects, mismatched, inherent } = ctx.isom.report;
    const pct = Math.round(((mismatched - inherent) / Math.max(1, rects)) * 100);
    add("warn", t("ISOM is behind the tiles on {pct}% of the map (the Repair plugin rebuilds it: Tools ▸ Repair Map…).", { pct }), msg("Terrain"));
  }

  // Bit 15 of a tile is the game's creep flag; a group past the tileset's table is drawn as
  // plain ground by Remastered and read past the table's end by 1.16.1.
  let creep = 0, outside = 0, firstOutside = -1;
  for (let i = 0; i < scn.tiles.length; i++) {
    if (scn.tiles[i] & TILE_CREEP_FLAG) creep++;
    if (ctx.tileset && tileGroupOf(scn.tiles[i]) >= ctx.tileset.groups.length && !isRemasteredOnlyTile(era, scn.tiles[i])) {
      if (firstOutside < 0) firstOutside = i;
      outside++;
    }
  }
  if (creep > 0) add("info", t("{n, plural, one {# tile carries} other {# tiles carry}} the creep flag (bit 15): the game draws the tile the other bits name, and Zerg can build there.", { n: creep }), msg("Terrain"));
  if (outside > 0) add("warn", t("{n, plural, one {# tile names a group} other {# tiles name groups}} this tileset does not have (the first at {x}, {y}): Remastered draws plain ground there, and StarCraft 1.16.1 reads past the end of its tileset table.", { n: outside, x: firstOutside % scn.width, y: Math.floor(firstOutside / scn.width) }), msg("Terrain"));

  // Tiles only Remastered has: doodads it added. Worth knowing rather than wrong — the map
  // plays in Remastered — but it is drawn only from Remastered's files, here and in the game.
  let added = 0, first = -1;
  for (let i = 0; i < scn.tiles.length; i++) {
    if (!isRemasteredOnlyTile(era, scn.tiles[i])) continue;
    if (first < 0) first = i;
    added++;
  }
  if (added > 0) {
    add("info", t("{n, plural, one {# tile is} other {# tiles are}} from what StarCraft: Remastered added to this tileset (the first at {x}, {y}). The map draws in full only with Remastered's game data, and the 1.16 game's files do not have these tiles.", { n: added, x: first % scn.width, y: Math.floor(first / scn.width) }), msg("Terrain"));
  }

  const order: Record<IssueLevel, number> = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}

/* ── Scenario (UMS) checks ──────────────────────────────── */

/** A trigger's player list as the set of slots 0–7 it runs for, through the groups (All Players, a force, Player N). */
export function triggerRunsFor(trig: TriggerRecord, scn: Pick<Scenario, "forces" | "playerTypes">): Set<number> {
  const out = new Set<number>();
  const players = trig.players;
  for (let p = 0; p < 8; p++) {
    if (players[p]) out.add(p);
    if (players[PlayerGroup.AllPlayers]) out.add(p);
    const force = scn.forces.playerForce[p];
    if (force !== undefined && players[PlayerGroup.Force1 + force]) out.add(p);
  }
  return out;
}

/** Whether a trigger looks like one of the community's hyper triggers: preserved, unconditional, mostly Wait 0. */
export function isHyperTrigger(trig: TriggerRecord): boolean {
  const live = trig.actions.filter((a) => a.type !== ActionType.None && !(a.flags & ActionFlag.Disabled));
  const waits = live.filter((a) => a.type === ActionType.Wait && a.time <= 1);
  const preserved = live.some((a) => a.type === ActionType.PreserveTrigger);
  const alwaysOnly = trig.conditions.every((c) => c.type === ConditionType.None || c.type === ConditionType.Always || (c.flags & ConditionFlag.Disabled));
  return preserved && alwaysOnly && waits.length >= 8 && waits.length >= live.length - 2;
}

/**
 * What a scenario (a map with triggers) needs that a melee map does not: a way for every
 * human player to win and to lose, objectives to read, and Waits that do not fight the
 * hyper triggers. A map with no triggers is melee and gets none of these.
 */
export function umsIssues(scn: Scenario): Issue[] {
  const issues: Issue[] = [];
  const live = scn.triggers.filter((trig) => !(trig.flags & TriggerFlag.Disabled));
  if (live.length === 0) return issues;
  const humans = scn.playerTypes.map((trig, p) => (trig === PlayerType.Human ? p : -1)).filter((p) => p >= 0 && p < 8);
  const actionsOf = (trig: TriggerRecord) => trig.actions.filter((a) => a.type !== ActionType.None && !(a.flags & ActionFlag.Disabled));
  const has = (type: number) => (trig: TriggerRecord) => actionsOf(trig).some((a) => a.type === type);
  const reach = (type: number) => {
    const set = new Set<number>();
    for (const trig of live.filter(has(type))) for (const p of triggerRunsFor(trig, scn)) set.add(p);
    return set;
  };
  const victory = reach(ActionType.Victory), defeat = reach(ActionType.Defeat), objectives = reach(ActionType.SetMissionObjectives);
  // A player also loses when another player in the game wins, draws, or runs a trigger with
  // flag 0x02: the game defeats everyone left without a result that pass.
  const ending = new Set<number>(victory);
  for (const p of reach(ActionType.Draw)) ending.add(p);
  for (const trig of live.filter((x) => x.flags & TriggerFlag.IgnoreGameEnd)) for (const p of triggerRunsFor(trig, scn)) ending.add(p);
  const inGame = (p: number) => scn.playerTypes[p] === PlayerType.Human || scn.playerTypes[p] === PlayerType.Computer;
  const noVictory = humans.filter((p) => !victory.has(p));
  const noDefeat = humans.filter((p) => !defeat.has(p) && ![...ending].some((q) => q !== p && inGame(q)));
  const noObjectives = humans.filter((p) => !objectives.has(p));
  const list = (ps: number[]) => ps.map((p) => `Player ${p + 1}`).join(", ");
  if (noVictory.length > 0) issues.push({ level: "warn", text: t("No trigger gives {list} Victory; in a scenario a player wins only when a trigger says so.", { list: list(noVictory) }), where: msg("Triggers"), target: { kind: "dialog", id: "triggerEditor" } });
  if (noDefeat.length > 0) issues.push({ level: "warn", text: t("Nothing makes {list} lose: no Defeat, and no Victory or Draw for another player. A scenario does not end when a player's units are gone.", { list: list(noDefeat) }), where: msg("Triggers"), target: { kind: "dialog", id: "triggerEditor" } });
  if (noObjectives.length > 0) issues.push({ level: "info", text: t("No Set Mission Objectives for {list}; the objectives box will show the melee text.", { list: list(noObjectives) }), where: msg("Triggers"), target: { kind: "dialog", id: "triggerEditor" } });
  const hypers = live.map((trig, i) => ({ trig, i })).filter(({ trig }) => isHyperTrigger(trig));
  if (hypers.length > 0) {
    issues.push({ level: "info", text: t("Hyper triggers present ({length, plural, one {# trigger} other {# triggers}}): the game goes through the triggers every 2 frames instead of every 31, about twelve times a second at Fastest.", { length: hypers.length }), where: msg("Triggers"), target: { kind: "trigger", index: scn.triggers.indexOf(hypers[0].trig) } });
    // A player has one wait slot (docs/triggers.md#waits), which a Wait and a person's
    // Transmission both take: in a trigger of a player who also runs hyper triggers it fights
    // them for it — above them it holds them up, below them it starves, and a one-shot one
    // below them may never start at all.
    live.forEach((trig) => {
      if (isHyperTrigger(trig)) return;
      const acts = actionsOf(trig);
      const players = triggerRunsFor(trig, scn);
      const waits = acts.some((a) => a.type === ActionType.Wait) || (acts.some((a) => a.type === ActionType.Transmission) && [...players].some((p) => scn.playerTypes[p] === PlayerType.Human));
      if (!waits) return;
      const sharing = hypers.filter(({ trig: h }) => [...triggerRunsFor(h, scn)].some((p) => players.has(p)));
      if (sharing.length === 0) return;
      const index = scn.triggers.indexOf(trig);
      const above = sharing.every(({ trig: h }) => scn.triggers.indexOf(h) > index);
      const preserved = acts.some((a) => a.type === ActionType.PreserveTrigger) || (trig.flags & TriggerFlag.Preserve) !== 0;
      if (above && !preserved) return;
      const text = above
        ? t("Trigger {v} has a Wait and Preserve Trigger above the hyper triggers: while its Wait runs it holds the player's one wait slot, so the hyper triggers stop and the triggers run every 31 frames instead of every 2. Use a death counter as the timer instead.", { v: index + 1 })
        : preserved
          ? t("Trigger {v} has a Wait and Preserve Trigger below the hyper triggers: they keep the player's one wait slot busy, so its Wait can start only in the one slow pass between their runs. Use a death counter as the timer instead.", { v: index + 1 })
          : t("Trigger {v} waits (a Wait, or a Transmission for a person) below the hyper triggers: they keep the player's one wait slot busy, so it may never start. Move it above them, or time it with a death counter.", { v: index + 1 });
      issues.push({ level: "warn", text, where: msg("Triggers"), target: { kind: "trigger", index } });
    });
  }
  return issues;
}

/** Only the issues about triggers, briefings and switches — Triggers ▸ Validate Triggers. */
export function triggerIssues(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.where === "Triggers" || i.where === "Briefing");
}

export function issueCounts(issues: Issue[]): Record<IssueLevel, number> {
  const counts: Record<IssueLevel, number> = { error: 0, warn: 0, info: 0 };
  for (const i of issues) counts[i.level]++;
  return counts;
}
