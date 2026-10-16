/**
 * Tools ▸ Check Map: what would stop the game loading the map, what will surprise a
 * player, and what is merely worth knowing. Pure over the scenario (plus the archive
 * extras for sound paths and the ISOM health the hook already measured), so the checks
 * are testable; `ValidateMapDialog` renders the list and jumps to the targets.
 */
import { MAP_VERSIONS, mapVersionOf, tilesetIndex, type Scenario } from "../formats/chk/scenario";
import { requiredSections } from "../formats/chk/create";
import { isLocationUsed } from "../formats/chk/sections/objects";
import { PlayerType } from "../formats/chk/sections/players";
import { getString, unencodableStrings } from "../formats/chk/sections/strings";
import { textEncodingInfo } from "../formats/text/encoding";
import { msg, t, translate } from "../i18n";
import { ActionFlag, ActionType, ConditionFlag, ConditionType, PlayerGroup, SwitchAction, TriggerFlag, type TriggerRecord } from "../formats/chk/sections/triggers";
import { actionDef, AI_SCRIPT_CHOICES, aiScriptCode, conditionDef } from "../data/triggerDefs";
import { isRemasteredOnlyTile } from "../data/remasteredTiles";
import { START_LOCATION, UNIT_TYPE_COUNT, unitLabel } from "../data/units";
import { UnitClass } from "../formats/chk/sections/triggers";
import type { DialogId } from "../components/dialogs/ids";
import type { IsomStatus } from "./isom";
import { CUWP_SLOTS, cuwpSlotActive } from "./cuwp";
import { isAnywhereIntact, locationCapacity, locationName } from "./locations";
import { TILE_PX } from "./units";
import { findStockSound, isStockPath, type StockSounds } from "./stockSounds";

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
}

/** The game keeps at most this many units in play; StarEdit refuses to place more. */
export const UNIT_LIMIT = 1700;
/** String slots the game's fixed table holds. */
export const STR_CAPACITY = 1024;
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
  const absent = (n: string) => !hasSection(scn, n) && !(n === "STR " && scn.strings.extended && hasSection(scn, "STRx"));
  const missingAll = requiredSections(scn.fileVersion, "melee").filter(absent);
  const missingUms = requiredSections(scn.fileVersion, "ums").filter((n) => absent(n) && !missingAll.includes(n));
  const names = (list: string[]) => list.map((n) => n.trim()).join(", ");
  if (missingAll.length > 0) {
    add("error", t("Missing {join} — the game will not load this map.", { join: names(missingAll) }), msg("File"), { kind: "dialog", id: "mapRevision" });
  }
  if (missingUms.length > 0) {
    add(scn.triggers.length > 0 ? "error" : "warn", t("Missing {join} — a Use Map Settings game of this map stops as it starts. Melee and the other game types do not need them.", { join: names(missingUms) }), msg("File"), { kind: "dialog", id: "mapRevision" });
  }
  add("info", t("Map revision: {label} (VER {ver}, {type}, {table}).", { label: MAP_VERSIONS[mapVersionOf(scn.fileVersion)].label, ver: scn.fileVersion, type: scn.type, table: scn.strings.extended ? "STRx" : "STR" }), msg("Header"));
  // What the parser noticed on the way in: a section cut short, a DIM that had to be guessed.
  for (const w of scn.warnings) add("warn", w, msg("File"));

  // ── Players and start locations ──
  if (scn.editorPlayerTypes && scn.editorPlayerTypes.some((trig, i) => trig !== scn.playerTypes[i])) {
    add("warn", t("The player types StarEdit shows (IOWN) differ from the ones the game reads (OWNR); another tool wrote one and not the other. Player Settings rewrites both."), msg("Players"), { kind: "dialog", id: "playerSettings" });
  }
  const starts = scn.units.map((u, index) => ({ u, index })).filter(({ u }) => u.unitId === START_LOCATION);
  scn.playerTypes.forEach((type, p) => {
    const mine = starts.filter(({ u }) => u.owner === p);
    const playable = type === PlayerType.Human || type === PlayerType.Computer;
    // A human without one cannot join; a computer in a scenario often owns only what the triggers give it, so that is a warning.
    if (playable && mine.length === 0) add(type === PlayerType.Human ? "error" : "warn", t("No start location for Player {n} (slot is {type}).", { n: p + 1, type: type === PlayerType.Human ? t("Human") : t("Computer") }), msg("Players"), { kind: "dialog", id: "playerSettings" });
    if (!playable && type !== PlayerType.Rescuable && mine.length > 0) add("warn", t("Player {v} has a start location but its slot is not playable.", { v: p + 1 }), msg("Players"), { kind: "unit", index: mine[0].index });
    if (mine.length > 1) add("warn", t("Player {v} has {length} start locations; the game uses one.", { v: p + 1, length: mine.length }), msg("Units"), { kind: "unit", index: mine[1].index });
  });

  // ── Units ──
  if (scn.units.length === 0) add("info", t("The map has no units."), msg("Units"));
  if (scn.units.length > UNIT_LIMIT) add("error", t("{length} units — the game holds at most {UNIT_LIMIT}.", { length: scn.units.length, UNIT_LIMIT }), msg("Units"));
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
  const capacity = scn.strings.extended ? STRX_CAPACITY : STR_CAPACITY;
  if (count > capacity) add("error", t("{count} strings — the {table} table holds {capacity}.", { count, table: scn.strings.extended ? "STRx" : "STR", capacity }), msg("Strings"), { kind: "dialog", id: "stringEditor" });
  const lost = unencodableStrings(scn.strings);
  if (lost.length > 0) {
    const chars = [...new Set(lost.flatMap((l) => l.chars))];
    const shown = chars.slice(0, 8).join(" ") + (chars.length > 8 ? " …" : "");
    add("error", t("{n, plural, one {# string uses} other {# strings use}} characters {encoding} cannot hold ({chars}); they will be saved as '?'. Choose a text encoding that holds them (Scenario ▸ Map Revision).", { n: lost.length, encoding: translate(textEncodingInfo(scn.strings.encoding).label), chars: shown }), msg("Strings"), { kind: "dialog", id: "mapRevision" });
  }

  // ── Triggers ──
  const tested = new Set<number>();
  const set = new Set<number>();
  const stringOk = (i: number) => i < scn.strings.strings.length;
  const checkTrigger = (trig: TriggerRecord, index: number, where: string, briefing: boolean) => {
    const target: IssueTarget | undefined = briefing ? { kind: "dialog", id: "missionBriefing" } : { kind: "trigger", index };
    const label = briefing ? `Briefing ${index + 1}` : `Trigger ${index + 1}`;
    if (trig.flags & TriggerFlag.Disabled) add("info", t("{label} is disabled.", { label }), where, target);
    const checkLocation = (value: number, what: string) => {
      if (value === 0) return;
      const slot = value - 1;
      if (!scn.locations[slot] || !isLocationUsed(scn.locations[slot])) add("warn", t("{label}: {what} uses location {slot}, which does not exist.", { label, what, slot }), where, target);
    };
    const checkString = (value: number, what: string) => {
      if (value > 0 && !stringOk(value)) add("error", t("{label}: {what} refers to string #{value}, past the end of the table.", { label, what, value }), where, target);
    };
    const checkUnit = (value: number, what: string) => {
      const klass = (Object.values(UnitClass) as number[]).includes(value);
      if (value >= UNIT_TYPE_COUNT && !klass) add("warn", t("{label}: {what} names unit type {value}, which the game does not have (types run to {v}, the classes {Any}–{Factories}).", { label, what, value, v: UNIT_TYPE_COUNT - 1, Any: UnitClass.Any, Factories: UnitClass.Factories }), where, target);
    };
    const checkPlayer = (value: number, what: string) => {
      if (value > 26) add("info", t("{label}: {what} uses player value {value} — beyond the game's groups, so a memory address (EUD) or a mistake.", { label, what, value }), where, target);
    };
    for (const c of trig.conditions) {
      if (c.flags & ConditionFlag.Disabled) continue;
      const def = conditionDef(c.type);
      if (!def) { add("warn", t("{label}: condition type {type} is not one the editor knows; it is kept as it is.", { label, type: c.type }), where, target); continue; }
      for (const a of def.args) {
        if (a.kind === "location") checkLocation(c[a.field], def.name);
        if (a.kind === "unit") checkUnit(c[a.field], def.name);
        if (a.kind === "player") checkPlayer(c[a.field], def.name);
        if (a.kind === "switch" && c.type === ConditionType.Switch) tested.add(c[a.field]);
      }
    }
    for (const a of trig.actions) {
      if (a.flags & ActionFlag.Disabled) continue;
      const def = actionDef(a.type, briefing);
      if (!def) { add("warn", t("{label}: action type {type} is not one the editor knows; it is kept as it is.", { label, type: a.type }), where, target); continue; }
      for (const arg of def.args) {
        if (arg.kind === "location") checkLocation(a[arg.field], def.name);
        if (arg.kind === "unit") checkUnit(a[arg.field], def.name);
        if (arg.kind === "player") checkPlayer(a[arg.field], def.name);
        if (arg.kind === "aiScript" && !AI_SCRIPT_CHOICES.some((c) => aiScriptCode(c.id) === a[arg.field])) add("warn", t("{label}: {name} runs AI script {toString}, which is not one the game ships.", { label, name: def.name, toString: a[arg.field].toString(16) }), where, target);
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
  scn.triggers.forEach((trig, i) => checkTrigger(trig, i, msg("Triggers"), false));
  // An Ogg plays in Remastered only; an older revision's game skips it.
  if (scn.wavs && scn.fileVersion < 206) {
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

  // Tiles only Remastered has: doodads it added. Worth knowing rather than wrong — the map
  // plays in Remastered — but it is drawn only from Remastered's files, here and in the game.
  const era = tilesetIndex(scn);
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
  const noVictory = humans.filter((p) => !victory.has(p));
  const noDefeat = humans.filter((p) => !defeat.has(p));
  const noObjectives = humans.filter((p) => !objectives.has(p));
  const list = (ps: number[]) => ps.map((p) => `Player ${p + 1}`).join(", ");
  if (noVictory.length > 0) issues.push({ level: "warn", text: t("No trigger gives {list} Victory; in a scenario a player wins only when a trigger says so.", { list: list(noVictory) }), where: msg("Triggers"), target: { kind: "dialog", id: "triggerEditor" } });
  if (noDefeat.length > 0) issues.push({ level: "warn", text: t("No trigger gives {list} Defeat; without one that player can never lose (a scenario does not end when their units are gone).", { list: list(noDefeat) }), where: msg("Triggers"), target: { kind: "dialog", id: "triggerEditor" } });
  if (noObjectives.length > 0) issues.push({ level: "info", text: t("No Set Mission Objectives for {list}; the objectives box will show the melee text.", { list: list(noObjectives) }), where: msg("Triggers"), target: { kind: "dialog", id: "triggerEditor" } });
  const hypers = live.map((trig, i) => ({ trig, i })).filter(({ trig }) => isHyperTrigger(trig));
  if (hypers.length > 0) {
    issues.push({ level: "info", text: t("Hyper triggers present ({length, plural, one {# trigger} other {# triggers}}): the game goes through the triggers every 2 frames instead of every 31, about twelve times a second at Fastest.", { length: hypers.length }), where: msg("Triggers"), target: { kind: "trigger", index: scn.triggers.indexOf(hypers[0].trig) } });
    // A player has one wait slot (docs/triggers.md#waits): a preserved Wait of a player who also
    // runs hyper triggers fights them for it — above them it holds them up, below them it starves.
    live.forEach((trig) => {
      if (isHyperTrigger(trig)) return;
      const acts = actionsOf(trig);
      if (!acts.some((a) => a.type === ActionType.Wait) || !acts.some((a) => a.type === ActionType.PreserveTrigger)) return;
      const players = triggerRunsFor(trig, scn);
      const sharing = hypers.filter(({ trig: h }) => [...triggerRunsFor(h, scn)].some((p) => players.has(p)));
      if (sharing.length === 0) return;
      const index = scn.triggers.indexOf(trig);
      const above = sharing.every(({ trig: h }) => scn.triggers.indexOf(h) > index);
      const text = above
        ? t("Trigger {v} has a Wait and Preserve Trigger above the hyper triggers: while its Wait runs it holds the player's one wait slot, so the hyper triggers stop and the triggers run every 31 frames instead of every 2. Use a death counter as the timer instead.", { v: index + 1 })
        : t("Trigger {v} has a Wait and Preserve Trigger below the hyper triggers: they keep the player's one wait slot busy, so its Wait can start only in the one slow pass between their runs. Use a death counter as the timer instead.", { v: index + 1 });
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
