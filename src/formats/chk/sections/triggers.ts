/**
 * TRIG / MBRF: triggers and mission briefings, 2400 bytes each.
 *
 * Both sections share one record layout — sixteen 20-byte conditions, sixty-four 32-byte
 * actions, an execution-flag word, 27 player-group bytes and the game's "current action"
 * byte — and differ only in what the condition/action type bytes mean (a briefing's
 * conditions are all `ConditionType.Briefing` and its actions index `BriefingActionType`).
 *
 * Records are kept close to the bytes: every field of a condition/action is a plain number
 * and the *meaning* of a field for a given type (which of them is the location, which the
 * player, …) lives in `src/data/triggerDefs.ts`, so the codec never has to know a Bring
 * from a Set Deaths. The decoded lists drop only *trailing* empty slots; anything after a
 * type-0 entry that the game would never reach is preserved so a map round-trips.
 *
 * Format reference: https://wiki.staredit.net/wiki/Scenario.chk#.22TRIG.22_-_Triggers
 */
import { Reader, Writer } from "../binary";

export const TRIGGER_STRIDE = 2400;
export const CONDITION_STRIDE = 20;
export const ACTION_STRIDE = 32;
export const MAX_CONDITIONS = 16;
export const MAX_ACTIONS = 64;
/** Player-group bytes per trigger (`PlayerGroup` indices). */
export const PLAYER_GROUP_COUNT = 27;

export interface ConditionRecord {
  /** 1-based location number, 0 = none. */
  location: number;
  /** `PlayerGroup`. */
  player: number;
  amount: number;
  unitId: number;
  /** `Comparison` for numeric conditions; `SwitchState` for Switch. */
  comparison: number;
  /** `ConditionType`. */
  type: number;
  /** `ResourceType` / `ScoreType` / switch number, per type. */
  resource: number;
  /** `ConditionFlag` bits. */
  flags: number;
  /** EUD mask word; 0 in ordinary maps. */
  mask: number;
}

export interface ActionRecord {
  /** 1-based source location, 0 = none. */
  location: number;
  /** String index for text / comment / leaderboard label, 0 = none. */
  text: number;
  /** String index of the WAV file name, 0 = none. */
  wav: number;
  /** Milliseconds for Wait / Transmission / Talking Portrait; WAV duration for Play WAV. */
  time: number;
  /** `PlayerGroup` (first). */
  player: number;
  /** Second player / destination location / amount / AI script code, per type. */
  target: number;
  /** Unit id / `ScoreType` / `ResourceType` / `AllianceStatus`, per type. */
  unitId: number;
  /** `ActionType` (or `BriefingActionType` in MBRF). */
  type: number;
  /** Unit count (0 = all) / `SetModifier` / `SwitchAction` / `Order` / `UnitState`, per type. */
  modifier: number;
  /** `ActionFlag` bits. */
  flags: number;
  padding: number;
  /** EUD mask word; 0 in ordinary maps. */
  mask: number;
}

export interface TriggerRecord {
  conditions: ConditionRecord[];
  actions: ActionRecord[];
  /** `TriggerFlag` bits. */
  flags: number;
  /** 27 bytes, one per `PlayerGroup`; non-zero = the trigger runs for that group. */
  players: number[];
  /** The game's bookkeeping byte (offset 2399); StarEdit writes 0. */
  currentAction: number;
}

/* ── Enumerations ────────────────────────────────────────── */

export const ConditionType = {
  None: 0, CountdownTimer: 1, Command: 2, Bring: 3, Accumulate: 4, Kill: 5,
  CommandTheMost: 6, CommandTheMostAt: 7, MostKills: 8, HighestScore: 9, MostResources: 10,
  Switch: 11, ElapsedTime: 12, Briefing: 13, Opponents: 14, Deaths: 15,
  CommandTheLeast: 16, CommandTheLeastAt: 17, LeastKills: 18, LowestScore: 19, LeastResources: 20,
  Score: 21, Always: 22, Never: 23,
} as const;

export const ActionType = {
  None: 0, Victory: 1, Defeat: 2, PreserveTrigger: 3, Wait: 4, PauseGame: 5, UnpauseGame: 6,
  Transmission: 7, PlayWav: 8, DisplayText: 9, CenterView: 10, CreateUnitWithProperties: 11,
  SetMissionObjectives: 12, SetSwitch: 13, SetCountdownTimer: 14, RunAiScript: 15, RunAiScriptAt: 16,
  LeaderboardControl: 17, LeaderboardControlAt: 18, LeaderboardResources: 19, LeaderboardKills: 20,
  LeaderboardPoints: 21, KillUnit: 22, KillUnitAt: 23, RemoveUnit: 24, RemoveUnitAt: 25,
  SetResources: 26, SetScore: 27, MinimapPing: 28, TalkingPortrait: 29, MuteUnitSpeech: 30,
  UnmuteUnitSpeech: 31, LeaderboardComputerPlayers: 32, LeaderboardGoalControl: 33,
  LeaderboardGoalControlAt: 34, LeaderboardGoalResources: 35, LeaderboardGoalKills: 36,
  LeaderboardGoalPoints: 37, MoveLocation: 38, MoveUnit: 39, LeaderboardGreed: 40,
  SetNextScenario: 41, SetDoodadState: 42, SetInvincibility: 43, CreateUnit: 44, SetDeaths: 45,
  Order: 46, Comment: 47, GiveUnits: 48, ModifyHitPoints: 49, ModifyEnergy: 50, ModifyShields: 51,
  ModifyResourceAmount: 52, ModifyHangarCount: 53, PauseTimer: 54, UnpauseTimer: 55, Draw: 56,
  SetAllianceStatus: 57, DisableDebugMode: 58, EnableDebugMode: 59,
} as const;

export const BriefingActionType = {
  None: 0, Wait: 1, PlayWav: 2, TextMessage: 3, MissionObjectives: 4, ShowPortrait: 5,
  HidePortrait: 6, DisplaySpeakingPortrait: 7, Transmission: 8, SkipTutorialEnabled: 9,
} as const;

/** The 27 player-group slots of a trigger, and the values conditions/actions store. */
export const PlayerGroup = {
  Player1: 0, Player2: 1, Player3: 2, Player4: 3, Player5: 4, Player6: 5, Player7: 6, Player8: 7,
  Player9: 8, Player10: 9, Player11: 10, Player12: 11,
  None: 12, CurrentPlayer: 13, Foes: 14, Allies: 15, NeutralPlayers: 16, AllPlayers: 17,
  Force1: 18, Force2: 19, Force3: 20, Force4: 21,
  Unused1: 22, Unused2: 23, Unused3: 24, Unused4: 25,
  NonAlliedVictoryPlayers: 26,
} as const;

export const Comparison = { AtLeast: 0, AtMost: 1, Exactly: 10 } as const;
export const SwitchState = { Set: 2, Cleared: 3 } as const;
export const SwitchAction = { Set: 4, Clear: 5, Toggle: 6, Randomize: 11 } as const;
export const SetModifier = { SetTo: 7, Add: 8, Subtract: 9 } as const;
/** Set Doodad State / Set Invincibility. */
export const UnitState = { Enable: 4, Disable: 5, Toggle: 6 } as const;
export const Order = { Move: 0, Patrol: 1, Attack: 2 } as const;
export const AllianceStatus = { Enemy: 0, Ally: 1, AlliedVictory: 2 } as const;
export const ResourceType = { Ore: 0, Gas: 1, OreAndGas: 2 } as const;
export const ScoreType = {
  Total: 0, Units: 1, Buildings: 2, UnitsAndBuildings: 3, Kills: 4, Razings: 5, KillsAndRazings: 6, Custom: 7,
} as const;

/** Unit ids beyond units.dat that conditions and actions accept. */
export const UnitClass = { Any: 228, Men: 229, Buildings: 230, Factories: 231 } as const;

export const ConditionFlag = {
  /** Game bookkeeping. */
  Unknown: 0x01,
  Disabled: 0x02,
  AlwaysDisplay: 0x04,
  UnitPropertiesUsed: 0x08,
  UnitTypeUsed: 0x10,
  UnitIdUsed: 0x20,
} as const;

export const ActionFlag = {
  /** Ignore a Wait / Transmission once (game bookkeeping). */
  IgnoreWaitOnce: 0x01,
  Disabled: 0x02,
  AlwaysDisplay: 0x04,
  UnitPropertiesUsed: 0x08,
  UnitTypeUsed: 0x10,
  UnitIdUsed: 0x20,
} as const;

export const TriggerFlag = {
  /** Game bookkeeping: every condition was met this cycle. */
  ConditionsMet: 0x01,
  /** Ignore Defeat / Draw for this trigger. */
  IgnoreGameEnd: 0x02,
  /** Same as a Preserve Trigger action. */
  Preserve: 0x04,
  /** The trigger never runs. */
  Disabled: 0x08,
  /** Skip Wait / text / view actions for the rest of this loop (game bookkeeping). */
  IgnoreDisplay: 0x10,
  /** Game bookkeeping. */
  Paused: 0x20,
  /** Game bookkeeping. */
  WaitSkipDisabled: 0x40,
} as const;

/* ── Codec ───────────────────────────────────────────────── */

export function emptyCondition(): ConditionRecord {
  return { location: 0, player: 0, amount: 0, unitId: 0, comparison: 0, type: 0, resource: 0, flags: 0, mask: 0 };
}

export function emptyAction(): ActionRecord {
  return { location: 0, text: 0, wav: 0, time: 0, player: 0, target: 0, unitId: 0, type: 0, modifier: 0, flags: 0, padding: 0, mask: 0 };
}

export function emptyTrigger(): TriggerRecord {
  return { conditions: [], actions: [], flags: 0, players: Array.from({ length: PLAYER_GROUP_COUNT }, () => 0), currentAction: 0 };
}

const isEmptyCondition = (c: ConditionRecord) =>
  c.type === 0 && c.location === 0 && c.player === 0 && c.amount === 0 && c.unitId === 0 && c.comparison === 0 && c.resource === 0 && c.flags === 0 && c.mask === 0;
const isEmptyAction = (a: ActionRecord) =>
  a.type === 0 && a.location === 0 && a.text === 0 && a.wav === 0 && a.time === 0 && a.player === 0 && a.target === 0 && a.unitId === 0 && a.modifier === 0 && a.flags === 0 && a.padding === 0 && a.mask === 0;

function readCondition(r: Reader): ConditionRecord {
  return {
    location: r.u32(), player: r.u32(), amount: r.u32(), unitId: r.u16(),
    comparison: r.u8(), type: r.u8(), resource: r.u8(), flags: r.u8(), mask: r.u16(),
  };
}

function readAction(r: Reader): ActionRecord {
  return {
    location: r.u32(), text: r.u32(), wav: r.u32(), time: r.u32(), player: r.u32(), target: r.u32(),
    unitId: r.u16(), type: r.u8(), modifier: r.u8(), flags: r.u8(), padding: r.u8(), mask: r.u16(),
  };
}

function trimTrailing<T>(list: T[], isEmpty: (x: T) => boolean): T[] {
  let n = list.length;
  while (n > 0 && isEmpty(list[n - 1])) n--;
  return list.slice(0, n);
}

export function decodeTrigger(r: Reader): TriggerRecord {
  const conditions: ConditionRecord[] = [];
  for (let i = 0; i < MAX_CONDITIONS; i++) conditions.push(readCondition(r));
  const actions: ActionRecord[] = [];
  for (let i = 0; i < MAX_ACTIONS; i++) actions.push(readAction(r));
  const flags = r.u32();
  const players: number[] = [];
  for (let i = 0; i < PLAYER_GROUP_COUNT; i++) players.push(r.u8());
  const currentAction = r.u8();
  return { conditions: trimTrailing(conditions, isEmptyCondition), actions: trimTrailing(actions, isEmptyAction), flags, players, currentAction };
}

export function decodeTriggers(data: Uint8Array): TriggerRecord[] {
  const r = new Reader(data);
  const out: TriggerRecord[] = [];
  while (r.remaining >= TRIGGER_STRIDE) out.push(decodeTrigger(r));
  return out;
}

function writeCondition(w: Writer, c: ConditionRecord) {
  w.u32(c.location).u32(c.player).u32(c.amount).u16(c.unitId).u8(c.comparison).u8(c.type).u8(c.resource).u8(c.flags).u16(c.mask);
}

function writeAction(w: Writer, a: ActionRecord) {
  w.u32(a.location).u32(a.text).u32(a.wav).u32(a.time).u32(a.player).u32(a.target)
    .u16(a.unitId).u8(a.type).u8(a.modifier).u8(a.flags).u8(a.padding).u16(a.mask);
}

export function encodeTrigger(w: Writer, t: TriggerRecord) {
  if (t.conditions.length > MAX_CONDITIONS) throw new Error(`A trigger holds at most ${MAX_CONDITIONS} conditions (got ${t.conditions.length}).`);
  if (t.actions.length > MAX_ACTIONS) throw new Error(`A trigger holds at most ${MAX_ACTIONS} actions (got ${t.actions.length}).`);
  for (const c of t.conditions) writeCondition(w, c);
  w.fill(0, (MAX_CONDITIONS - t.conditions.length) * CONDITION_STRIDE);
  for (const a of t.actions) writeAction(w, a);
  w.fill(0, (MAX_ACTIONS - t.actions.length) * ACTION_STRIDE);
  w.u32(t.flags);
  for (let i = 0; i < PLAYER_GROUP_COUNT; i++) w.u8(t.players[i] ?? 0);
  w.u8(t.currentAction);
}

export function encodeTriggers(triggers: TriggerRecord[]): Uint8Array {
  const w = new Writer(triggers.length * TRIGGER_STRIDE || 16);
  for (const t of triggers) encodeTrigger(w, t);
  return w.finish();
}

/** Deep copy, for working copies and duplicates. */
export function cloneTrigger(t: TriggerRecord): TriggerRecord {
  return {
    conditions: t.conditions.map((c) => ({ ...c })),
    actions: t.actions.map((a) => ({ ...a })),
    flags: t.flags,
    players: t.players.slice(),
    currentAction: t.currentAction,
  };
}

/* ── SWNM: switch names, 256 string indices ──────────────── */

export const SWITCH_COUNT = 256;

export function decodeSwitchNames(data: Uint8Array): number[] {
  const r = new Reader(data);
  const out: number[] = [];
  for (let i = 0; i < SWITCH_COUNT; i++) out.push(r.remaining >= 4 ? r.u32() : 0);
  return out;
}

export function encodeSwitchNames(names: number[]): Uint8Array {
  const w = new Writer(SWITCH_COUNT * 4);
  for (let i = 0; i < SWITCH_COUNT; i++) w.u32(names[i] ?? 0);
  return w.finish();
}
