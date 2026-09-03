/**
 * What each trigger condition and action *means*: its name, and which record fields hold
 * which arguments. Everything that presents a trigger — the Classic editor's argument
 * editors, the text format's printer and parser, the script API's typings — reads this
 * table rather than knowing the field layout itself.
 *
 * Argument order follows SCMDraft 2's text triggers (TrigEdit), so text pasted from the
 * community's usual editor parses here and ours reads back there. Field assignments are
 * from the staredit.net Scenario.chk reference; the ones nothing in `fixtures/` exercises
 * are marked so.
 */
import type { ActionRecord, ConditionRecord } from "../formats/chk/sections/triggers";
import {
  ActionType, AllianceStatus, BriefingActionType, Comparison, ConditionType, Order, PlayerGroup,
  ResourceType, ScoreType, SetModifier, SwitchAction, SwitchState, UnitClass, UnitState,
} from "../formats/chk/sections/triggers";

export type ArgKind =
  | "player" | "unit" | "location" | "switch"
  | "comparison" | "switchState" | "switchAction" | "modifier" | "unitState" | "order" | "alliance"
  | "resource" | "score" | "aiScript" | "textFlags"
  | "text" | "wav"
  | "number" | "amount" | "count" | "duration" | "percent" | "cuwp" | "slot";

export type ConditionField = keyof ConditionRecord;
export type ActionField = keyof ActionRecord;

export interface ArgDef<F extends string> {
  kind: ArgKind;
  field: F;
  label: string;
}

export interface ConditionDef {
  type: number;
  name: string;
  args: ArgDef<ConditionField>[];
}

export interface ActionDef {
  type: number;
  name: string;
  args: ArgDef<ActionField>[];
  /** Text / Transmission: the `AlwaysDisplay` flag is an argument of its own. */
  hasTextFlags?: boolean;
}

const c = (kind: ArgKind, field: ConditionField, label: string): ArgDef<ConditionField> => ({ kind, field, label });
const a = (kind: ArgKind, field: ActionField, label: string): ArgDef<ActionField> => ({ kind, field, label });

const COMPARE_AMOUNT = [c("comparison", "comparison", "Comparison"), c("amount", "amount", "Amount")];

export const CONDITION_DEFS: ConditionDef[] = [
  { type: ConditionType.Accumulate, name: "Accumulate", args: [c("player", "player", "Player"), ...COMPARE_AMOUNT, c("resource", "resource", "Resource")] },
  { type: ConditionType.Always, name: "Always", args: [] },
  { type: ConditionType.Bring, name: "Bring", args: [c("player", "player", "Player"), c("unit", "unitId", "Unit"), c("location", "location", "Location"), ...COMPARE_AMOUNT] },
  { type: ConditionType.Command, name: "Command", args: [c("player", "player", "Player"), c("unit", "unitId", "Unit"), ...COMPARE_AMOUNT] },
  { type: ConditionType.CommandTheLeast, name: "Command the Least", args: [c("unit", "unitId", "Unit")] },
  { type: ConditionType.CommandTheLeastAt, name: "Command the Least At", args: [c("unit", "unitId", "Unit"), c("location", "location", "Location")] },
  { type: ConditionType.CommandTheMost, name: "Command the Most", args: [c("unit", "unitId", "Unit")] },
  { type: ConditionType.CommandTheMostAt, name: "Command the Most At", args: [c("unit", "unitId", "Unit"), c("location", "location", "Location")] },
  { type: ConditionType.CountdownTimer, name: "Countdown Timer", args: [...COMPARE_AMOUNT] },
  { type: ConditionType.Deaths, name: "Deaths", args: [c("player", "player", "Player"), c("unit", "unitId", "Unit"), ...COMPARE_AMOUNT] },
  { type: ConditionType.ElapsedTime, name: "Elapsed Time", args: [...COMPARE_AMOUNT] },
  { type: ConditionType.HighestScore, name: "Highest Score", args: [c("score", "resource", "Score")] },
  { type: ConditionType.Kill, name: "Kill", args: [c("player", "player", "Player"), c("unit", "unitId", "Unit"), ...COMPARE_AMOUNT] },
  { type: ConditionType.LeastKills, name: "Least Kills", args: [c("unit", "unitId", "Unit")] },
  { type: ConditionType.LeastResources, name: "Least Resources", args: [c("resource", "resource", "Resource")] },
  { type: ConditionType.LowestScore, name: "Lowest Score", args: [c("score", "resource", "Score")] },
  { type: ConditionType.MostKills, name: "Most Kills", args: [c("unit", "unitId", "Unit")] },
  { type: ConditionType.MostResources, name: "Most Resources", args: [c("resource", "resource", "Resource")] },
  { type: ConditionType.Never, name: "Never", args: [] },
  { type: ConditionType.Opponents, name: "Opponents", args: [c("player", "player", "Player"), ...COMPARE_AMOUNT] },
  { type: ConditionType.Score, name: "Score", args: [c("player", "player", "Player"), c("score", "resource", "Score"), ...COMPARE_AMOUNT] },
  { type: ConditionType.Switch, name: "Switch", args: [c("switch", "resource", "Switch"), c("switchState", "comparison", "State")] },
  { type: ConditionType.Briefing, name: "Mission Briefing", args: [] },
];

const PLAYER = a("player", "player", "Player");
const UNIT = a("unit", "unitId", "Unit");
const LOCATION = a("location", "location", "Location");
const COUNT = a("count", "modifier", "Count");
const MODIFIER = a("modifier", "modifier", "Modifier");
const TEXT = a("text", "text", "Text");
const LABEL = a("text", "text", "Label");
const DISPLAY = a("textFlags", "flags", "Display");

export const ACTION_DEFS: ActionDef[] = [
  { type: ActionType.CenterView, name: "Center View", args: [LOCATION] },
  { type: ActionType.Comment, name: "Comment", args: [TEXT] },
  { type: ActionType.CreateUnit, name: "Create Unit", args: [PLAYER, UNIT, COUNT, LOCATION] },
  { type: ActionType.CreateUnitWithProperties, name: "Create Unit with Properties", args: [PLAYER, UNIT, COUNT, LOCATION, a("cuwp", "target", "Properties")] },
  { type: ActionType.Defeat, name: "Defeat", args: [] },
  { type: ActionType.DisplayText, name: "Display Text Message", args: [DISPLAY, TEXT], hasTextFlags: true },
  { type: ActionType.Draw, name: "Draw", args: [] },
  { type: ActionType.GiveUnits, name: "Give Units to Player", args: [a("player", "player", "From"), a("player", "target", "To"), UNIT, COUNT, LOCATION] },
  { type: ActionType.KillUnit, name: "Kill Unit", args: [PLAYER, UNIT] },
  { type: ActionType.KillUnitAt, name: "Kill Unit At Location", args: [PLAYER, UNIT, COUNT, LOCATION] },
  { type: ActionType.LeaderboardControl, name: "Leader Board Control", args: [LABEL, UNIT] },
  { type: ActionType.LeaderboardControlAt, name: "Leader Board Control At Location", args: [LABEL, UNIT, LOCATION] },
  { type: ActionType.LeaderboardGreed, name: "Leader Board Greed", args: [a("amount", "target", "Goal")] },
  { type: ActionType.LeaderboardKills, name: "Leader Board Kills", args: [LABEL, UNIT] },
  { type: ActionType.LeaderboardPoints, name: "Leader Board Points", args: [LABEL, a("score", "unitId", "Score")] },
  { type: ActionType.LeaderboardResources, name: "Leader Board Resources", args: [LABEL, a("resource", "unitId", "Resource")] },
  { type: ActionType.LeaderboardGoalControl, name: "Leaderboard Goal Control", args: [LABEL, UNIT, a("amount", "target", "Goal")] },
  { type: ActionType.LeaderboardGoalControlAt, name: "Leaderboard Goal Control At Location", args: [LABEL, UNIT, a("amount", "target", "Goal"), LOCATION] },
  { type: ActionType.LeaderboardGoalKills, name: "Leaderboard Goal Kills", args: [LABEL, UNIT, a("amount", "target", "Goal")] },
  { type: ActionType.LeaderboardGoalPoints, name: "Leaderboard Goal Points", args: [LABEL, a("score", "unitId", "Score"), a("amount", "target", "Goal")] },
  { type: ActionType.LeaderboardGoalResources, name: "Leaderboard Goal Resources", args: [LABEL, a("amount", "target", "Goal"), a("resource", "unitId", "Resource")] },
  { type: ActionType.LeaderboardComputerPlayers, name: "Leaderboard Computer Players", args: [a("unitState", "modifier", "State")] },
  { type: ActionType.MinimapPing, name: "Minimap Ping", args: [LOCATION] },
  { type: ActionType.ModifyEnergy, name: "Modify Unit Energy", args: [PLAYER, UNIT, a("percent", "target", "Percent"), COUNT, LOCATION] },
  { type: ActionType.ModifyHangarCount, name: "Modify Unit Hanger Count", args: [PLAYER, UNIT, a("amount", "target", "Amount"), COUNT, LOCATION] },
  { type: ActionType.ModifyHitPoints, name: "Modify Unit Hit Points", args: [PLAYER, UNIT, a("percent", "target", "Percent"), COUNT, LOCATION] },
  { type: ActionType.ModifyResourceAmount, name: "Modify Unit Resource Amount", args: [PLAYER, a("amount", "target", "Amount"), COUNT, LOCATION] },
  { type: ActionType.ModifyShields, name: "Modify Unit Shield Points", args: [PLAYER, UNIT, a("percent", "target", "Percent"), COUNT, LOCATION] },
  { type: ActionType.MoveLocation, name: "Move Location", args: [PLAYER, UNIT, a("location", "location", "Unit at"), a("location", "target", "Move")] },
  { type: ActionType.MoveUnit, name: "Move Unit", args: [PLAYER, UNIT, COUNT, a("location", "location", "From"), a("location", "target", "To")] },
  { type: ActionType.MuteUnitSpeech, name: "Mute Unit Speech", args: [] },
  { type: ActionType.Order, name: "Order", args: [PLAYER, UNIT, a("location", "location", "From"), a("location", "target", "To"), a("order", "modifier", "Order")] },
  { type: ActionType.PauseGame, name: "Pause Game", args: [] },
  { type: ActionType.PauseTimer, name: "Pause Timer", args: [] },
  { type: ActionType.PlayWav, name: "Play WAV", args: [a("wav", "wav", "WAV"), a("duration", "time", "Duration")] },
  { type: ActionType.PreserveTrigger, name: "Preserve Trigger", args: [] },
  { type: ActionType.RemoveUnit, name: "Remove Unit", args: [PLAYER, UNIT] },
  { type: ActionType.RemoveUnitAt, name: "Remove Unit At Location", args: [PLAYER, UNIT, COUNT, LOCATION] },
  { type: ActionType.RunAiScript, name: "Run AI Script", args: [a("aiScript", "target", "Script")] },
  { type: ActionType.RunAiScriptAt, name: "Run AI Script At Location", args: [a("aiScript", "target", "Script"), LOCATION] },
  { type: ActionType.SetAllianceStatus, name: "Set Alliance Status", args: [PLAYER, a("alliance", "unitId", "Status")] },
  { type: ActionType.SetCountdownTimer, name: "Set Countdown Timer", args: [MODIFIER, a("duration", "time", "Seconds")] },
  { type: ActionType.SetDeaths, name: "Set Deaths", args: [PLAYER, UNIT, MODIFIER, a("amount", "target", "Amount")] },
  { type: ActionType.SetDoodadState, name: "Set Doodad State", args: [PLAYER, UNIT, LOCATION, a("unitState", "modifier", "State")] },
  { type: ActionType.SetInvincibility, name: "Set Invincibility", args: [PLAYER, UNIT, LOCATION, a("unitState", "modifier", "State")] },
  { type: ActionType.SetMissionObjectives, name: "Set Mission Objectives", args: [TEXT] },
  { type: ActionType.SetNextScenario, name: "Set Next Scenario", args: [a("text", "text", "Scenario")] },
  { type: ActionType.SetResources, name: "Set Resources", args: [PLAYER, MODIFIER, a("amount", "target", "Amount"), a("resource", "unitId", "Resource")] },
  { type: ActionType.SetScore, name: "Set Score", args: [PLAYER, MODIFIER, a("amount", "target", "Amount"), a("score", "unitId", "Score")] },
  { type: ActionType.SetSwitch, name: "Set Switch", args: [a("switch", "target", "Switch"), a("switchAction", "modifier", "Action")] },
  { type: ActionType.TalkingPortrait, name: "Talking Portrait", args: [UNIT, a("duration", "time", "Duration")] },
  { type: ActionType.Transmission, name: "Transmission", args: [DISPLAY, TEXT, UNIT, LOCATION, MODIFIER, a("duration", "target", "Duration"), a("wav", "wav", "WAV"), a("duration", "time", "WAV duration")], hasTextFlags: true },
  { type: ActionType.UnmuteUnitSpeech, name: "Unmute Unit Speech", args: [] },
  { type: ActionType.UnpauseGame, name: "Unpause Game", args: [] },
  { type: ActionType.UnpauseTimer, name: "Unpause Timer", args: [] },
  { type: ActionType.Victory, name: "Victory", args: [] },
  { type: ActionType.Wait, name: "Wait", args: [a("duration", "time", "Milliseconds")] },
  { type: ActionType.DisableDebugMode, name: "Disable Debug Mode", args: [] },
  { type: ActionType.EnableDebugMode, name: "Enable Debug Mode", args: [] },
];

/**
 * Mission briefing actions. The portrait slot lives in the record's first player group
 * (`player`), as Blizzard's own briefings show (`tests/briefing.test.ts` reads the ones on
 * Ground Zero and Spring Thaw: Show Portrait, Display Speaking Portrait and Text Message
 * all round-trip) — not in the second group the community reference names. Transmission
 * follows the same layout: slot in `player`, the duration modifier's amount in `target`
 * with the modifier byte, the text's own time in `time`; no Blizzard map uses it, so that
 * one rests on the reference and on SCMDraft's reading of it.
 */
export const BRIEFING_ACTION_DEFS: ActionDef[] = [
  { type: BriefingActionType.Wait, name: "Wait", args: [a("duration", "time", "Milliseconds")] },
  { type: BriefingActionType.PlayWav, name: "Play WAV", args: [a("wav", "wav", "WAV"), a("duration", "time", "Duration")] },
  { type: BriefingActionType.TextMessage, name: "Text Message", args: [TEXT, a("duration", "time", "Duration")] },
  { type: BriefingActionType.MissionObjectives, name: "Mission Objectives", args: [TEXT] },
  { type: BriefingActionType.ShowPortrait, name: "Show Portrait", args: [UNIT, a("slot", "player", "Slot")] },
  { type: BriefingActionType.HidePortrait, name: "Hide Portrait", args: [a("slot", "player", "Slot")] },
  { type: BriefingActionType.DisplaySpeakingPortrait, name: "Display Speaking Portrait", args: [a("slot", "player", "Slot"), a("duration", "time", "Duration")] },
  { type: BriefingActionType.Transmission, name: "Transmission", args: [TEXT, a("slot", "player", "Slot"), MODIFIER, a("amount", "target", "Amount"), a("duration", "time", "Duration"), a("wav", "wav", "WAV")] },
  { type: BriefingActionType.SkipTutorialEnabled, name: "Skip Tutorial Enabled", args: [] },
];

const byType = <T extends { type: number }>(defs: T[]) => new Map(defs.map((d) => [d.type, d]));
const byName = <T extends { name: string }>(defs: T[]) => new Map(defs.map((d) => [d.name.toLowerCase(), d]));

const CONDITIONS_BY_TYPE = byType(CONDITION_DEFS);
const CONDITIONS_BY_NAME = byName(CONDITION_DEFS);
const ACTIONS_BY_TYPE = byType(ACTION_DEFS);
const ACTIONS_BY_NAME = byName(ACTION_DEFS);
const BRIEFING_BY_TYPE = byType(BRIEFING_ACTION_DEFS);
const BRIEFING_BY_NAME = byName(BRIEFING_ACTION_DEFS);

export const conditionDef = (type: number) => CONDITIONS_BY_TYPE.get(type);
export const conditionDefByName = (name: string) => CONDITIONS_BY_NAME.get(name.trim().toLowerCase());
export const actionDef = (type: number, briefing = false) => (briefing ? BRIEFING_BY_TYPE : ACTIONS_BY_TYPE).get(type);
export const actionDefByName = (name: string, briefing = false) => (briefing ? BRIEFING_BY_NAME : ACTIONS_BY_NAME).get(name.trim().toLowerCase());

/* ── Enumerated argument values ──────────────────────────── */

export interface Choice {
  value: number;
  label: string;
  /** Extra spellings the text parser accepts. */
  aliases?: string[];
}

/** The 27 player-group slots, in `PlayerGroup` order. */
export const PLAYER_GROUP_CHOICES: Choice[] = [
  ...Array.from({ length: 12 }, (_, i) => ({ value: i, label: `Player ${i + 1}`, aliases: [`P${i + 1}`] })),
  { value: PlayerGroup.None, label: "None", aliases: ["Player 13"] },
  { value: PlayerGroup.CurrentPlayer, label: "Current Player" },
  { value: PlayerGroup.Foes, label: "Foes" },
  { value: PlayerGroup.Allies, label: "Allies" },
  { value: PlayerGroup.NeutralPlayers, label: "Neutral Players" },
  { value: PlayerGroup.AllPlayers, label: "All Players", aliases: ["All players"] },
  { value: PlayerGroup.Force1, label: "Force 1" },
  { value: PlayerGroup.Force2, label: "Force 2" },
  { value: PlayerGroup.Force3, label: "Force 3" },
  { value: PlayerGroup.Force4, label: "Force 4" },
  { value: PlayerGroup.Unused1, label: "Unused 1" },
  { value: PlayerGroup.Unused2, label: "Unused 2" },
  { value: PlayerGroup.Unused3, label: "Unused 3" },
  { value: PlayerGroup.Unused4, label: "Unused 4" },
  { value: PlayerGroup.NonAlliedVictoryPlayers, label: "Non Allied Victory Players", aliases: ["Non AV Players"] },
];

export const UNIT_CLASS_CHOICES: Choice[] = [
  { value: UnitClass.Any, label: "Any unit", aliases: ["Any Unit"] },
  { value: UnitClass.Men, label: "Men" },
  { value: UnitClass.Buildings, label: "Buildings" },
  { value: UnitClass.Factories, label: "Factories" },
];

export const CHOICES: Partial<Record<ArgKind, Choice[]>> = {
  player: PLAYER_GROUP_CHOICES,
  comparison: [
    { value: Comparison.AtLeast, label: "At least", aliases: ["atleast", ">="] },
    { value: Comparison.AtMost, label: "At most", aliases: ["atmost", "<="] },
    { value: Comparison.Exactly, label: "Exactly", aliases: ["=="] },
  ],
  switchState: [
    { value: SwitchState.Set, label: "set", aliases: ["true"] },
    { value: SwitchState.Cleared, label: "not set", aliases: ["cleared", "clear", "false"] },
  ],
  switchAction: [
    { value: SwitchAction.Set, label: "set" },
    { value: SwitchAction.Clear, label: "clear", aliases: ["cleared"] },
    { value: SwitchAction.Toggle, label: "toggle" },
    { value: SwitchAction.Randomize, label: "randomize", aliases: ["random", "randomise"] },
  ],
  modifier: [
    { value: SetModifier.SetTo, label: "Set To", aliases: ["setto", "set"] },
    { value: SetModifier.Add, label: "Add" },
    { value: SetModifier.Subtract, label: "Subtract", aliases: ["sub"] },
  ],
  unitState: [
    { value: UnitState.Enable, label: "enable", aliases: ["enabled"] },
    { value: UnitState.Disable, label: "disable", aliases: ["disabled"] },
    { value: UnitState.Toggle, label: "toggle" },
  ],
  order: [
    { value: Order.Move, label: "move" },
    { value: Order.Patrol, label: "patrol" },
    { value: Order.Attack, label: "attack" },
  ],
  alliance: [
    { value: AllianceStatus.Enemy, label: "Enemy" },
    { value: AllianceStatus.Ally, label: "Ally", aliases: ["Allied"] },
    { value: AllianceStatus.AlliedVictory, label: "Allied Victory" },
  ],
  resource: [
    { value: ResourceType.Ore, label: "ore", aliases: ["minerals"] },
    { value: ResourceType.Gas, label: "gas" },
    { value: ResourceType.OreAndGas, label: "ore and gas", aliases: ["both"] },
  ],
  score: [
    { value: ScoreType.Total, label: "Total" },
    { value: ScoreType.Units, label: "Units" },
    { value: ScoreType.Buildings, label: "Buildings" },
    { value: ScoreType.UnitsAndBuildings, label: "Units and buildings" },
    { value: ScoreType.Kills, label: "Kills" },
    { value: ScoreType.Razings, label: "Razings" },
    { value: ScoreType.KillsAndRazings, label: "Kills and razings" },
    { value: ScoreType.Custom, label: "Custom" },
  ],
  textFlags: [
    { value: 0, label: "Don't Always Display", aliases: ["Dont Always Display", "Never Display"] },
    { value: 4, label: "Always Display" },
  ],
};

export function choiceLabel(kind: ArgKind, value: number): string | undefined {
  return CHOICES[kind]?.find((c) => c.value === value)?.label;
}

export function choiceValue(kind: ArgKind, text: string): number | undefined {
  const key = text.trim().toLowerCase();
  const list = CHOICES[kind];
  if (!list) return undefined;
  for (const c of list) {
    if (c.label.toLowerCase() === key) return c.value;
    if (c.aliases?.some((al) => al.toLowerCase() === key)) return c.value;
  }
  return undefined;
}

/* ── AI scripts ──────────────────────────────────────────── */

/** Encode a four-character script code the way the action stores it (little-endian u32). */
export function aiScriptCode(id: string): number {
  if (id.length !== 4) throw new Error(`AI script codes are four characters: "${id}"`);
  return (id.charCodeAt(0) | (id.charCodeAt(1) << 8) | (id.charCodeAt(2) << 16) | (id.charCodeAt(3) << 24)) >>> 0;
}

export function aiScriptId(code: number): string {
  return String.fromCharCode(code & 0xff, (code >>> 8) & 0xff, (code >>> 16) & 0xff, (code >>> 24) & 0xff);
}

/** The scripts StarEdit offers, by code. Campaign scripts print as their code. */
export const AI_SCRIPT_NAMES: Record<string, string> = {
  TMCu: "Terran Custom Level", ZMCu: "Zerg Custom Level", PMCu: "Protoss Custom Level",
  TMCx: "Terran Expansion Custom Level", ZMCx: "Zerg Expansion Custom Level", PMCx: "Protoss Expansion Custom Level",
  TLOf: "Terran Campaign Easy", TMED: "Terran Campaign Medium", THIf: "Terran Campaign Difficult", TSUP: "Terran Campaign Insane", TARE: "Terran Campaign Area Town",
  ZLOf: "Zerg Campaign Easy", ZMED: "Zerg Campaign Medium", ZHIf: "Zerg Campaign Difficult", ZSUP: "Zerg Campaign Insane", ZARE: "Zerg Campaign Area Town",
  PLOf: "Protoss Campaign Easy", PMED: "Protoss Campaign Medium", PHIf: "Protoss Campaign Difficult", PSUP: "Protoss Campaign Insane", PARE: "Protoss Campaign Area Town",
  TLOx: "Expansion Terran Campaign Easy", TMEx: "Expansion Terran Campaign Medium", THIx: "Expansion Terran Campaign Difficult", TSUx: "Expansion Terran Campaign Insane", TARx: "Expansion Terran Campaign Area Town",
  ZLOx: "Expansion Zerg Campaign Easy", ZMEx: "Expansion Zerg Campaign Medium", ZHIx: "Expansion Zerg Campaign Difficult", ZSUx: "Expansion Zerg Campaign Insane", ZARx: "Expansion Zerg Campaign Area Town",
  PLOx: "Expansion Protoss Campaign Easy", PMEx: "Expansion Protoss Campaign Medium", PHIx: "Expansion Protoss Campaign Difficult", PSUx: "Expansion Protoss Campaign Insane", PARx: "Expansion Protoss Campaign Area Town",
  Suic: "Send All Units on Strategic Suicide Missions", SuiR: "Send All Units on Random Suicide Missions",
  Rscu: "Switch Computer Player to Rescue Passive",
  "+Vi0": "Turn ON Shared Vision for Player 1", "+Vi1": "Turn ON Shared Vision for Player 2", "+Vi2": "Turn ON Shared Vision for Player 3", "+Vi3": "Turn ON Shared Vision for Player 4",
  "+Vi4": "Turn ON Shared Vision for Player 5", "+Vi5": "Turn ON Shared Vision for Player 6", "+Vi6": "Turn ON Shared Vision for Player 7", "+Vi7": "Turn ON Shared Vision for Player 8",
  "-Vi0": "Turn OFF Shared Vision for Player 1", "-Vi1": "Turn OFF Shared Vision for Player 2", "-Vi2": "Turn OFF Shared Vision for Player 3", "-Vi3": "Turn OFF Shared Vision for Player 4",
  "-Vi4": "Turn OFF Shared Vision for Player 5", "-Vi5": "Turn OFF Shared Vision for Player 6", "-Vi6": "Turn OFF Shared Vision for Player 7", "-Vi7": "Turn OFF Shared Vision for Player 8",
  MvTe: "Move Dark Templars to Region", ClrC: "Clear Previous Combat Data",
  Enmy: "Set Player to Enemy", Ally: "Set Player to Ally", VluA: "Value This Area Higher",
  EnBk: "Enter Closest Bunker", StTg: "Set Generic Command Target", StPt: "Make These Units Patrol",
  EnTr: "Enter Transport", ExTr: "Exit Transport", NuHe: "AI Nuke Here", HaHe: "AI Harass Here",
  JYDg: "Set Unit Order To: Junk Yard Dog", DWHe: "Disruption Web Here", ReHe: "Recall Here",
};

export const AI_SCRIPT_CHOICES: { id: string; name: string }[] = Object.entries(AI_SCRIPT_NAMES).map(([id, name]) => ({ id, name }));

export function aiScriptName(code: number): string {
  const id = aiScriptId(code);
  return AI_SCRIPT_NAMES[id] ?? id;
}

/** A script by display name or four-character code; undefined when neither matches. */
export function aiScriptByName(text: string): number | undefined {
  const t = text.trim();
  if (t.length === 4 && (t in AI_SCRIPT_NAMES || /^[\x20-\x7e]{4}$/.test(t))) return aiScriptCode(t);
  const key = t.toLowerCase();
  const hit = AI_SCRIPT_CHOICES.find((s) => s.name.toLowerCase() === key);
  return hit ? aiScriptCode(hit.id) : undefined;
}
