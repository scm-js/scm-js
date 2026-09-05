/**
 * Tools ▸ Check Map: what would stop the game loading the map, what will surprise a
 * player, and what is merely worth knowing. Pure over the scenario (plus the archive
 * extras for sound paths and the ISOM health the hook already measured), so the checks
 * are testable; `ValidateMapDialog` renders the list and jumps to the targets.
 */
import { MAP_VERSIONS, mapVersionOf, type Scenario } from "../formats/chk/scenario";
import { requiredSections } from "../formats/chk/create";
import { isLocationUsed } from "../formats/chk/sections/objects";
import { PlayerType } from "../formats/chk/sections/players";
import { getString } from "../formats/chk/sections/strings";
import { ActionFlag, ActionType, ConditionFlag, ConditionType, PlayerGroup, SwitchAction, TriggerFlag, type TriggerRecord } from "../formats/chk/sections/triggers";
import { actionDef, AI_SCRIPT_CHOICES, aiScriptCode, conditionDef } from "../data/triggerDefs";
import { START_LOCATION, UNIT_TYPE_COUNT, unitName } from "../data/units";
import { UnitClass } from "../formats/chk/sections/triggers";
import type { DialogId } from "../components/dialogs/ids";
import type { IsomStatus } from "./isom";
import { CUWP_SLOTS, cuwpSlotActive } from "./cuwp";
import { isAnywhereIntact, locationName } from "./locations";
import { TILE_PX } from "./units";

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
  // The original-layout settings pairs are what StarCraft 1.00 reads; a Brood War map (205+)
  // carries only the `x` layouts (Blizzard's own do), a hybrid one both.
  const required = requiredSections(scn.fileVersion);
  const missing = required.filter((n) => !hasSection(scn, n) && !(n === "STR " && scn.strings.extended && hasSection(scn, "STRx")));
  if (missing.length > 0) {
    add("error", `Missing ${missing.map((n) => n.trim()).join(", ")} — the game will not load this map.`, "File", { kind: "dialog", id: "mapRevision" });
  }
  add("info", `Map revision: ${MAP_VERSIONS[mapVersionOf(scn.fileVersion)].label} (VER ${scn.fileVersion}, ${scn.type}, ${scn.strings.extended ? "STRx" : "STR"}).`, "Header");
  // What the parser noticed on the way in: a section cut short, a DIM that had to be guessed.
  for (const w of scn.warnings) add("warn", w, "File");

  // ── Players and start locations ──
  if (scn.editorPlayerTypes && scn.editorPlayerTypes.some((t, i) => t !== scn.playerTypes[i])) {
    add("warn", "The player types StarEdit shows (IOWN) differ from the ones the game reads (OWNR); another tool wrote one and not the other. Player Settings rewrites both.", "Players", { kind: "dialog", id: "playerSettings" });
  }
  const starts = scn.units.map((u, index) => ({ u, index })).filter(({ u }) => u.unitId === START_LOCATION);
  scn.playerTypes.forEach((type, p) => {
    const mine = starts.filter(({ u }) => u.owner === p);
    const playable = type === PlayerType.Human || type === PlayerType.Computer;
    if (playable && mine.length === 0) add("error", `No start location for Player ${p + 1} (slot is ${type === PlayerType.Human ? "Human" : "Computer"}).`, "Players", { kind: "dialog", id: "playerSettings" });
    if (!playable && type !== PlayerType.Rescuable && mine.length > 0) add("warn", `Player ${p + 1} has a start location but its slot is not playable.`, "Players", { kind: "unit", index: mine[0].index });
    if (mine.length > 1) add("warn", `Player ${p + 1} has ${mine.length} start locations; the game uses one.`, "Units", { kind: "unit", index: mine[1].index });
  });

  // ── Units ──
  if (scn.units.length === 0) add("info", "The map has no units.", "Units");
  if (scn.units.length > UNIT_LIMIT) add("error", `${scn.units.length} units — the game holds at most ${UNIT_LIMIT}.`, "Units");
  scn.units.forEach((u, index) => {
    if (u.x < 0 || u.y < 0 || u.x >= scn.width * TILE_PX || u.y >= scn.height * TILE_PX) {
      add("error", `${unitName(u.unitId)} (Player ${u.owner + 1}) is outside the map at ${u.x}, ${u.y}.`, "Units", { kind: "unit", index });
    }
    if (u.owner >= scn.playerTypes.length) add("warn", `${unitName(u.unitId)} is owned by player ${u.owner + 1}, which does not exist.`, "Units", { kind: "unit", index });
  });

  // ── Locations ──
  if (!isAnywhereIntact(scn)) add("warn", "Location 63 'Anywhere' is not the whole map; triggers that use Anywhere will not see everything.", "Locations", { kind: "location", index: 63 });
  const seenNames = new Map<string, number>();
  scn.locations.forEach((l, index) => {
    if (!isLocationUsed(l)) return;
    const name = locationName(scn, index).toLowerCase();
    const first = seenNames.get(name);
    if (first !== undefined) add("info", `Locations ${first} and ${index} are both named '${locationName(scn, index)}'.`, "Locations", { kind: "location", index });
    else seenNames.set(name, index);
  });

  // ── Strings ──
  const count = scn.strings.strings.length - 1;
  const capacity = scn.strings.extended ? STRX_CAPACITY : STR_CAPACITY;
  if (count > capacity) add("error", `${count} strings — the ${scn.strings.extended ? "STRx" : "STR"} table holds ${capacity}.`, "Strings", { kind: "dialog", id: "stringEditor" });

  // ── Triggers ──
  const tested = new Set<number>();
  const set = new Set<number>();
  const stringOk = (i: number) => i < scn.strings.strings.length;
  const checkTrigger = (t: TriggerRecord, index: number, where: string, briefing: boolean) => {
    const target: IssueTarget | undefined = briefing ? { kind: "dialog", id: "missionBriefing" } : { kind: "trigger", index };
    const label = briefing ? `Briefing ${index + 1}` : `Trigger ${index + 1}`;
    if (t.flags & TriggerFlag.Disabled) add("info", `${label} is disabled.`, where, target);
    const checkLocation = (value: number, what: string) => {
      if (value === 0) return;
      const slot = value - 1;
      if (!scn.locations[slot] || !isLocationUsed(scn.locations[slot])) add("warn", `${label}: ${what} uses location ${slot}, which does not exist.`, where, target);
    };
    const checkString = (value: number, what: string) => {
      if (value > 0 && !stringOk(value)) add("error", `${label}: ${what} refers to string #${value}, past the end of the table.`, where, target);
    };
    const checkUnit = (value: number, what: string) => {
      const klass = (Object.values(UnitClass) as number[]).includes(value);
      if (value >= UNIT_TYPE_COUNT && !klass) add("warn", `${label}: ${what} names unit type ${value}, which the game does not have (types run to ${UNIT_TYPE_COUNT - 1}, the classes ${UnitClass.Any}–${UnitClass.Factories}).`, where, target);
    };
    const checkPlayer = (value: number, what: string) => {
      if (value > 26) add("info", `${label}: ${what} uses player value ${value} — beyond the game's groups, so a memory address (EUD) or a mistake.`, where, target);
    };
    for (const c of t.conditions) {
      if (c.flags & ConditionFlag.Disabled) continue;
      const def = conditionDef(c.type);
      if (!def) { add("warn", `${label}: condition type ${c.type} is not one the editor knows; it is kept as it is.`, where, target); continue; }
      for (const a of def.args) {
        if (a.kind === "location") checkLocation(c[a.field], def.name);
        if (a.kind === "unit") checkUnit(c[a.field], def.name);
        if (a.kind === "player") checkPlayer(c[a.field], def.name);
        if (a.kind === "switch" && c.type === ConditionType.Switch) tested.add(c[a.field]);
      }
    }
    for (const a of t.actions) {
      if (a.flags & ActionFlag.Disabled) continue;
      const def = actionDef(a.type, briefing);
      if (!def) { add("warn", `${label}: action type ${a.type} is not one the editor knows; it is kept as it is.`, where, target); continue; }
      for (const arg of def.args) {
        if (arg.kind === "location") checkLocation(a[arg.field], def.name);
        if (arg.kind === "unit") checkUnit(a[arg.field], def.name);
        if (arg.kind === "player") checkPlayer(a[arg.field], def.name);
        if (arg.kind === "aiScript" && !AI_SCRIPT_CHOICES.some((c) => aiScriptCode(c.id) === a[arg.field])) add("warn", `${label}: ${def.name} runs AI script ${a[arg.field].toString(16)}, which is not one the game ships.`, where, target);
        if (arg.kind === "text") checkString(a[arg.field], def.name);
        if (arg.kind === "wav") {
          checkString(a[arg.field], def.name);
          const path = a[arg.field] > 0 ? getString(scn.strings, a[arg.field]) : null;
          if (path && ctx.extras && ![...ctx.extras.keys()].some((k) => normalize(k) === normalize(path))) {
            add("warn", `${label}: ${def.name} plays '${path}', which is not in the archive.`, where, target);
          }
        }
        if (arg.kind === "switch" && a.type === ActionType.SetSwitch && a.modifier !== SwitchAction.Clear) set.add(a[arg.field]);
        if (arg.kind === "cuwp") {
          const slot = a[arg.field];
          if (slot < 1 || slot > CUWP_SLOTS) add("warn", `${label}: ${def.name} names properties slot ${slot}; the slots are 1 to ${CUWP_SLOTS}.`, where, target);
          else if (!scn.cuwp || !cuwpSlotActive(scn.cuwp[slot - 1])) add("info", `${label}: ${def.name} uses slot ${slot}, which sets nothing (Triggers ▸ Unit Properties Slots…).`, where, { kind: "dialog", id: "cuwpEditor" });
        }
      }
    }
  };
  scn.triggers.forEach((t, i) => checkTrigger(t, i, "Triggers", false));
  // An Ogg plays in Remastered only; an older revision's game skips it.
  if (scn.wavs && scn.fileVersion < 206) {
    scn.wavs.forEach((i, slot) => {
      const path = i > 0 ? getString(scn.strings, i) : null;
      if (path && /\.ogg$/i.test(path)) add("warn", `Sound ${slot} is an Ogg (${path}); only Remastered plays those, and this map's revision is ${MAP_VERSIONS[mapVersionOf(scn.fileVersion)].label}.`, "Sounds", { kind: "dialog", id: "soundEditor" });
    });
  }
  scn.briefing.forEach((t, i) => checkTrigger(t, i, "Briefing", true));
  for (const s of [...tested].sort((a, b) => a - b)) {
    if (!set.has(s)) add("warn", `Switch ${s + 1} is tested by a condition but no action ever sets it.`, "Triggers", { kind: "dialog", id: "switches" });
  }
  for (const i of umsIssues(scn)) add(i.level, i.text, i.where, i.target);

  // ── Terrain ──
  if (ctx.isom?.kind === "missing") add("warn", "The map has no ISOM section: the isometric brush needs one (the Repair plugin rebuilds it: Tools ▸ Repair Map…).", "Terrain");
  if (ctx.isom?.kind === "ready" && ctx.isom.stale) {
    const pct = Math.round((ctx.isom.check.mismatched / Math.max(1, ctx.isom.check.rects)) * 100);
    add("warn", `ISOM disagrees with the tiles on ${pct}% of the map (the Repair plugin rebuilds it: Tools ▸ Repair Map…).`, "Terrain");
  }

  const order: Record<IssueLevel, number> = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => order[a.level] - order[b.level]);
}

/* ── Scenario (UMS) checks ──────────────────────────────── */

/** A trigger's player list as the set of slots 0–7 it runs for, through the groups (All Players, a force, Player N). */
export function triggerRunsFor(t: TriggerRecord, scn: Pick<Scenario, "forces" | "playerTypes">): Set<number> {
  const out = new Set<number>();
  const players = t.players;
  for (let p = 0; p < 8; p++) {
    if (players[p]) out.add(p);
    if (players[PlayerGroup.AllPlayers]) out.add(p);
    const force = scn.forces.playerForce[p];
    if (force !== undefined && players[PlayerGroup.Force1 + force]) out.add(p);
  }
  return out;
}

/** Whether a trigger looks like one of the community's hyper triggers: preserved, unconditional, mostly Wait 0. */
export function isHyperTrigger(t: TriggerRecord): boolean {
  const live = t.actions.filter((a) => a.type !== ActionType.None && !(a.flags & ActionFlag.Disabled));
  const waits = live.filter((a) => a.type === ActionType.Wait && a.time <= 1);
  const preserved = live.some((a) => a.type === ActionType.PreserveTrigger);
  const alwaysOnly = t.conditions.every((c) => c.type === ConditionType.None || c.type === ConditionType.Always || (c.flags & ConditionFlag.Disabled));
  return preserved && alwaysOnly && waits.length >= 8 && waits.length >= live.length - 2;
}

/**
 * What a scenario (a map with triggers) needs that a melee map does not: a way for every
 * human player to win and to lose, objectives to read, and Waits that do not fight the
 * hyper triggers. A map with no triggers is melee and gets none of these.
 */
export function umsIssues(scn: Scenario): Issue[] {
  const issues: Issue[] = [];
  const live = scn.triggers.filter((t) => !(t.flags & TriggerFlag.Disabled));
  if (live.length === 0) return issues;
  const humans = scn.playerTypes.map((t, p) => (t === PlayerType.Human ? p : -1)).filter((p) => p >= 0 && p < 8);
  const actionsOf = (t: TriggerRecord) => t.actions.filter((a) => a.type !== ActionType.None && !(a.flags & ActionFlag.Disabled));
  const has = (type: number) => (t: TriggerRecord) => actionsOf(t).some((a) => a.type === type);
  const reach = (type: number) => {
    const set = new Set<number>();
    for (const t of live.filter(has(type))) for (const p of triggerRunsFor(t, scn)) set.add(p);
    return set;
  };
  const victory = reach(ActionType.Victory), defeat = reach(ActionType.Defeat), objectives = reach(ActionType.SetMissionObjectives);
  const noVictory = humans.filter((p) => !victory.has(p));
  const noDefeat = humans.filter((p) => !defeat.has(p));
  const noObjectives = humans.filter((p) => !objectives.has(p));
  const list = (ps: number[]) => ps.map((p) => `Player ${p + 1}`).join(", ");
  if (noVictory.length > 0) issues.push({ level: "warn", text: `No trigger gives ${list(noVictory)} Victory; in a scenario a player wins only when a trigger says so.`, where: "Triggers", target: { kind: "dialog", id: "triggerEditor" } });
  if (noDefeat.length > 0) issues.push({ level: "warn", text: `No trigger gives ${list(noDefeat)} Defeat; without one that player can never lose (a scenario does not end when their units are gone).`, where: "Triggers", target: { kind: "dialog", id: "triggerEditor" } });
  if (noObjectives.length > 0) issues.push({ level: "info", text: `No Set Mission Objectives for ${list(noObjectives)}; the objectives box will show the melee text.`, where: "Triggers", target: { kind: "dialog", id: "triggerEditor" } });
  const hypers = live.map((t, i) => ({ t, i })).filter(({ t }) => isHyperTrigger(t));
  if (hypers.length > 0) {
    issues.push({ level: "info", text: `Hyper triggers present (${hypers.length} trigger${hypers.length === 1 ? "" : "s"}): every other trigger fires about twelve times a second instead of once every two.`, where: "Triggers", target: { kind: "trigger", index: scn.triggers.indexOf(hypers[0].t) } });
    live.forEach((t) => {
      if (isHyperTrigger(t)) return;
      const acts = actionsOf(t);
      if (acts.some((a) => a.type === ActionType.Wait) && acts.some((a) => a.type === ActionType.PreserveTrigger)) {
        const index = scn.triggers.indexOf(t);
        issues.push({ level: "warn", text: `Trigger ${index + 1} has a Wait and Preserve Trigger: with hyper triggers on, a Wait stalls that player's whole trigger queue (the hyper triggers included). Use a death counter as the timer instead.`, where: "Triggers", target: { kind: "trigger", index } });
      }
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
