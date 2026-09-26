/**
 * What each trigger reads, writes and names: the switches, death counters, locations,
 * timer, resources, scores, units, strings, sounds, AI scripts and game endings its
 * conditions and actions touch, with the player groups resolved to slots.
 *
 * `triggerUsage` answers "which counters are taken" for a plugin allocating its own; this
 * answers "who talks to whom" — the graph a trigger map draws, a dead-switch check, a
 * "what leads to Victory" search. It reads only the records and the forces, so it is
 * pure and testable without a scenario.
 */
import {
  ActionFlag, ActionType, ConditionFlag, ConditionType, PlayerGroup, PLAYER_GROUP_COUNT, TriggerFlag,
  type ActionRecord, type ConditionRecord, type TriggerRecord,
} from "../formats/chk/sections/triggers";
import { actionDef, conditionDef, type ArgDef } from "../data/triggerDefs";
import { UNIT_TYPE_COUNT } from "../data/units";
import { addressOfEpd } from "./triggers";

/** Every kind of thing a condition or action can refer to. */
export type TriggerRefKind =
  /** A switch; `id` is its 0-based number. */
  | "switch"
  /** A death counter; `id` is the unit id, `players` the slots whose cell it is. */
  | "deaths"
  /** A death counter out of range — an EUD read or write; `address` is the dword it reaches, `id` the unit value as written. */
  | "memory"
  /** A location; `id` is its 0-based slot (63 is Anywhere). */
  | "location"
  /** The countdown timer; `id` is 0. */
  | "timer"
  /** A player's ore or gas; `id` is the `ResourceType`. */
  | "resources"
  /** A player's score; `id` is the `ScoreType`. */
  | "score"
  /** Units of a type; `id` is the unit id (a class id for *Any unit*, *Men*, …). */
  | "units"
  /** Victory, Defeat or Draw; `id` is the action type, `players` the trigger's owners. */
  | "outcome"
  /** A string of the map's string table; `id` is the 1-based string index. */
  | "string"
  /** A sound; `id` is the string index of its file name. */
  | "wav"
  /** A Run AI Script code (four characters as a little-endian u32). */
  | "aiScript"
  /** A Create Unit with Properties slot, 0-based. */
  | "cuwp";

/**
 * `read`: a condition tests it. `write`: an action changes it. `use`: an action names it
 * without changing it — the location units appear at, the text a message shows.
 */
export type TriggerRefAccess = "read" | "write" | "use";

export interface TriggerRef {
  kind: TriggerRefKind;
  access: TriggerRefAccess;
  /** Whether a condition or an action refers to it. */
  part: "condition" | "action";
  /** The condition's or action's position in the trigger. */
  slot: number;
  /** The condition or action type. */
  type: number;
  id: number;
  /**
   * The 0-based player slots it is about, for the kinds that belong to a player
   * (`deaths`, `resources`, `score`, `units`, `outcome`); empty for the rest, and for a
   * condition such as *Command the Most* that compares every player.
   */
  players: number[];
  /** The player group as the record stores it, where the record has one. */
  group?: number;
  /**
   * The group resolves only while the game runs (*Foes*, *Allies*, *Neutral Players*,
   * *Non Allied Victory Players*), so `players` is every slot it could name.
   */
  approximate?: boolean;
  /** `memory`: the address reached (rounded down to a dword). */
  address?: number;
  /** `memory`: the bits a masked record reaches (its `location` field), when the record is masked. */
  mask?: number;
  /** The condition or action is switched off (its Disabled flag); the game skips it. */
  disabled?: boolean;
}

export interface TriggerRefs {
  /** The trigger's index in the list. */
  index: number;
  /** The 0-based slots the trigger runs for. */
  owners: number[];
  /** The player groups ticked in the trigger, as stored. */
  groups: number[];
  /** Set by the Disabled flag, or no player owns it: the game never runs it. */
  inert: boolean;
  refs: TriggerRef[];
}

/** The value of a masked record's `mask` word (Remastered). */
const MASKED_RECORD = 0x4353;
const EIGHT = [0, 1, 2, 3, 4, 5, 6, 7];
const TWELVE = [...EIGHT, 8, 9, 10, 11];

/**
 * The 0-based slots a player group names. `forces` holds each force's slots; `owners` are
 * the groups the trigger is ticked for, which *Current Player* stands for. Groups past the
 * 27 (EUD values) name no slot.
 */
export function resolvePlayers(group: number, owners: readonly number[], forces: readonly (readonly number[])[]): { players: number[]; approximate: boolean } {
  if (group < 0 || group >= PLAYER_GROUP_COUNT) return { players: [], approximate: false };
  if (group < 12) return { players: [group], approximate: false };
  switch (group) {
    case PlayerGroup.CurrentPlayer: {
      const out = new Set<number>();
      let approximate = false;
      for (const o of owners) {
        if (o === PlayerGroup.CurrentPlayer) continue;
        const r = resolvePlayers(o, [], forces);
        r.players.forEach((p) => out.add(p));
        approximate ||= r.approximate;
      }
      return { players: [...out].sort((a, b) => a - b), approximate };
    }
    case PlayerGroup.AllPlayers:
      return { players: EIGHT.slice(), approximate: false };
    case PlayerGroup.Force1: case PlayerGroup.Force2: case PlayerGroup.Force3: case PlayerGroup.Force4:
      return { players: [...(forces[group - PlayerGroup.Force1] ?? [])].sort((a, b) => a - b), approximate: false };
    case PlayerGroup.Foes: case PlayerGroup.Allies: case PlayerGroup.NonAlliedVictoryPlayers:
      return { players: EIGHT.slice(), approximate: true };
    case PlayerGroup.NeutralPlayers:
      return { players: TWELVE.slice(), approximate: true };
    default:
      return { players: [], approximate: false };
  }
}

/** The slots a trigger runs for. */
export function triggerOwners(trigger: TriggerRecord, forces: readonly (readonly number[])[]): number[] {
  const groups = trigger.players.flatMap((on, i) => (on ? [i] : []));
  return resolvePlayers(PlayerGroup.CurrentPlayer, groups, forces).players;
}

/** Every trigger's references, in list order. MBRF when `briefing`, where only strings and sounds mean anything. */
export function triggerReferences(list: readonly TriggerRecord[], forces: readonly (readonly number[])[], briefing = false): TriggerRefs[] {
  return list.map((trigger, index) => {
    const groups = trigger.players.flatMap((on, i) => (on ? [i] : []));
    const owners = resolvePlayers(PlayerGroup.CurrentPlayer, groups, forces).players;
    const refs: TriggerRef[] = [];
    if (!briefing) trigger.conditions.forEach((c, slot) => conditionRefs(c, slot, groups, forces, refs));
    trigger.actions.forEach((a, slot) => actionRefs(a, slot, groups, owners, forces, briefing, refs));
    return { index, owners, groups, inert: (trigger.flags & TriggerFlag.Disabled) !== 0 || owners.length === 0, refs };
  });
}

type Base = Pick<TriggerRef, "part" | "slot" | "type" | "disabled">;

function conditionRefs(c: ConditionRecord, slot: number, groups: number[], forces: readonly (readonly number[])[], out: TriggerRef[]) {
  if (c.type === ConditionType.None) return;
  const base: Base = { part: "condition", slot, type: c.type, ...((c.flags & ConditionFlag.Disabled) !== 0 ? { disabled: true } : {}) };
  const who = () => withPlayers(c.player, groups, forces);
  switch (c.type) {
    case ConditionType.Switch:
      out.push({ ...base, kind: "switch", access: "read", id: c.resource, players: [] });
      break;
    case ConditionType.Deaths:
      deathsRefs(base, "read", c.player, c.unitId, c.mask === MASKED_RECORD ? c.location : undefined, groups, forces, out);
      break;
    case ConditionType.CountdownTimer:
      out.push({ ...base, kind: "timer", access: "read", id: 0, players: [] });
      break;
    case ConditionType.Accumulate:
      out.push({ ...base, kind: "resources", access: "read", id: c.resource, ...who() });
      break;
    case ConditionType.MostResources: case ConditionType.LeastResources:
      out.push({ ...base, kind: "resources", access: "read", id: c.resource, players: [] });
      break;
    case ConditionType.Score:
      out.push({ ...base, kind: "score", access: "read", id: c.resource, ...who() });
      break;
    case ConditionType.HighestScore: case ConditionType.LowestScore:
      out.push({ ...base, kind: "score", access: "read", id: c.resource, players: [] });
      break;
    case ConditionType.Bring: case ConditionType.Command:
      out.push({ ...base, kind: "units", access: "read", id: c.unitId, ...who() });
      break;
    case ConditionType.CommandTheMost: case ConditionType.CommandTheMostAt: case ConditionType.CommandTheLeast: case ConditionType.CommandTheLeastAt:
      out.push({ ...base, kind: "units", access: "read", id: c.unitId, players: [] });
      break;
  }
  for (const arg of conditionDef(c.type)?.args ?? []) {
    if (arg.kind === "location" && c.location > 0) out.push({ ...base, kind: "location", access: "read", id: c.location - 1, players: [] });
  }
}

function actionRefs(a: ActionRecord, slot: number, groups: number[], owners: number[], forces: readonly (readonly number[])[], briefing: boolean, out: TriggerRef[]) {
  if (a.type === 0) return;
  const base: Base = { part: "action", slot, type: a.type, ...((a.flags & ActionFlag.Disabled) !== 0 ? { disabled: true } : {}) };
  const def = actionDef(a.type, briefing);
  // The arguments that name something without changing it, read off the defs table.
  for (const arg of def?.args ?? []) {
    const value = (a as unknown as Record<string, number>)[(arg as ArgDef<string>).field];
    if (briefing && arg.kind !== "text" && arg.kind !== "wav") continue;
    switch (arg.kind) {
      case "text": if (value > 0) out.push({ ...base, kind: "string", access: "use", id: value, players: [] }); break;
      case "wav": if (value > 0) out.push({ ...base, kind: "wav", access: "use", id: value, players: [] }); break;
      case "aiScript": if (value !== 0) out.push({ ...base, kind: "aiScript", access: "use", id: value >>> 0, players: [] }); break;
      case "cuwp": out.push({ ...base, kind: "cuwp", access: "use", id: value, players: [] }); break;
      case "location":
        // Move Location's `target` is the one it moves; every other location argument is a place things happen at.
        if (value > 0) out.push({ ...base, kind: "location", access: a.type === ActionType.MoveLocation && arg.field === "target" ? "write" : "use", id: value - 1, players: [] });
        break;
    }
  }
  if (briefing) return;
  const who = (group = a.player) => withPlayers(group, groups, forces);
  switch (a.type) {
    case ActionType.SetSwitch:
      out.push({ ...base, kind: "switch", access: "write", id: a.target, players: [] });
      break;
    case ActionType.SetDeaths:
      deathsRefs(base, "write", a.player, a.unitId, a.mask === MASKED_RECORD ? a.location : undefined, groups, forces, out);
      break;
    case ActionType.SetCountdownTimer: case ActionType.PauseTimer: case ActionType.UnpauseTimer:
      out.push({ ...base, kind: "timer", access: "write", id: 0, players: [] });
      break;
    case ActionType.SetResources:
      out.push({ ...base, kind: "resources", access: "write", id: a.unitId, ...who() });
      break;
    case ActionType.SetScore:
      out.push({ ...base, kind: "score", access: "write", id: a.unitId, ...who() });
      break;
    case ActionType.CreateUnit: case ActionType.CreateUnitWithProperties:
    case ActionType.KillUnit: case ActionType.KillUnitAt: case ActionType.RemoveUnit: case ActionType.RemoveUnitAt:
    case ActionType.MoveUnit:
      out.push({ ...base, kind: "units", access: "write", id: a.unitId, ...who() });
      break;
    case ActionType.GiveUnits: {
      const from = who(), to = who(a.target);
      out.push({ ...base, kind: "units", access: "write", id: a.unitId, players: union(from.players, to.players), group: a.player, ...(from.approximate || to.approximate ? { approximate: true } : {}) });
      break;
    }
    case ActionType.Order: case ActionType.ModifyHitPoints: case ActionType.ModifyEnergy: case ActionType.ModifyShields:
    case ActionType.ModifyHangarCount: case ActionType.SetInvincibility: case ActionType.SetDoodadState: case ActionType.MoveLocation:
      out.push({ ...base, kind: "units", access: "use", id: a.unitId, ...who() });
      break;
    case ActionType.Victory: case ActionType.Defeat: case ActionType.Draw:
      out.push({ ...base, kind: "outcome", access: "write", id: a.type, players: owners.slice() });
      break;
  }
}

/** `players` / `group` / `approximate` for a record's player group. */
function withPlayers(group: number, owners: number[], forces: readonly (readonly number[])[]): Pick<TriggerRef, "players" | "group" | "approximate"> {
  const r = resolvePlayers(group, owners, forces);
  return { players: r.players, group, ...(r.approximate ? { approximate: true } : {}) };
}

function union(a: number[], b: number[]): number[] {
  return [...new Set([...a, ...b])].sort((x, y) => x - y);
}

/**
 * A Deaths condition or Set Deaths action: a counter when the player is a group or a slot
 * and the unit is a real unit, the sum the game computes for a unit class (which counts
 * as reading *units* of that class), and a memory address for everything else.
 */
function deathsRefs(base: Base, access: TriggerRefAccess, player: number, unitId: number, mask: number | undefined, owners: number[], forces: readonly (readonly number[])[], out: TriggerRef[]) {
  const masked = mask !== undefined ? { mask: mask >>> 0 } : {};
  const address = (slot: number) => addressOfEpd(slot, unitId);
  if (player >= PLAYER_GROUP_COUNT) {
    // An EUD player value: past the 27 groups the game reads it as a raw index into the table.
    out.push({ ...base, kind: "memory", access, id: unitId, players: [], group: player, address: address(player), ...masked });
    return;
  }
  const r = resolvePlayers(player, owners, forces);
  const approximate = r.approximate ? { approximate: true } : {};
  if (unitId < UNIT_TYPE_COUNT && mask === undefined) {
    out.push({ ...base, kind: "deaths", access, id: unitId, players: r.players, group: player, ...approximate });
  } else if (unitId <= 232 && mask === undefined) {
    // Deaths of Any unit / Men / Buildings / Factories: a sum over real counters.
    if (access === "read") out.push({ ...base, kind: "units", access, id: unitId, players: r.players, group: player, ...approximate });
  } else {
    for (const slot of r.players) out.push({ ...base, kind: "memory", access, id: unitId, players: [slot], group: player, address: address(slot), ...approximate, ...masked });
  }
}
