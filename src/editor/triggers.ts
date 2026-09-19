/**
 * Trigger editing: the scenario-backed name context the text format and the dialogs use,
 * and the list operations the Classic editor performs.
 *
 * Triggers are edited the way settings are — each dialog is its own OK / Apply / Cancel
 * transaction over a working copy, not part of the undo model — so the writers here
 * replace `scn.triggers` / `scn.briefing` wholesale and mark the section dirty; the
 * caller bumps `triggersRevisionAtom` (`commitTriggersAtom`) so lists re-read.
 */
import { markDirty, type Scenario } from "../formats/chk/scenario";
import { getString } from "../formats/chk/sections/strings";
import { ANYWHERE_INDEX } from "../formats/chk/sections/objects";
import {
  ActionFlag, ActionType, Comparison, ConditionFlag, ConditionType, SetModifier, SwitchAction, SwitchState, UnitClass, UnitState,
  cloneTrigger, emptyAction, emptyCondition, emptyTrigger, PlayerGroup, PLAYER_GROUP_COUNT, SWITCH_COUNT, TriggerFlag,
  type ActionRecord, type ConditionRecord, type TriggerRecord,
} from "../formats/chk/sections/triggers";
import { actionDef, conditionDef, DEATHS_TABLE_ADDRESS, UNIT_CLASS_CHOICES, type ActionDef, type ArgKind, type ConditionDef } from "../data/triggerDefs";
import { UNIT_NAMES, UNIT_TYPE_COUNT, unitName } from "../data/units";
import { locationName } from "./locations";
import { internString, unitCustomName } from "./settings";
import type { TriggerNames } from "../formats/triggers/text";

/* ── Names ───────────────────────────────────────────────── */

/** StarEdit's default name for an unnamed switch (1-based, like its dialog). */
export function switchName(scn: Scenario, index: number): string {
  const s = scn.switchNames ? getString(scn.strings, scn.switchNames[index] ?? 0) : null;
  return s ?? `Switch ${index + 1}`;
}

/**
 * A `TriggerNames` over the scenario. `intern` appends to the string table (marking it
 * dirty), so parsing text into a scenario changes it even before the triggers are applied;
 * strings are never removed, so that is harmless.
 */
export function triggerNames(scn: Scenario): TriggerNames {
  const lower = (s: string) => s.trim().toLowerCase();
  return {
    string: (index) => getString(scn.strings, index),
    intern: (text) => internString(scn, text),
    location: (number) => (number === 0 ? "No Location" : locationName(scn, number - 1)),
    locationByName: (name) => {
      const key = lower(name);
      if (key === "anywhere") return ANYWHERE_INDEX + 1;
      for (let i = 0; i < scn.locations.length; i++) {
        const s = getString(scn.strings, scn.locations[i].nameIndex);
        if (s !== null && lower(s) === key) return i + 1;
      }
      const m = /^location (\d+)$/.exec(key);
      if (m) return Number(m[1]) + 1;
      return undefined;
    },
    unit: (id) => UNIT_CLASS_CHOICES.find((u) => u.value === id)?.label ?? unitName(id),
    unitByName: (name) => {
      const key = lower(name);
      const cls = UNIT_CLASS_CHOICES.find((u) => lower(u.label) === key || u.aliases?.some((al) => lower(al) === key));
      if (cls) return cls.value;
      const byDefault = UNIT_NAMES.findIndex((n) => lower(n) === key);
      if (byDefault >= 0) return byDefault;
      // The loaded data set's own names (a mod's): what `unit` printed, so text round-trips.
      for (let id = 0; id < UNIT_NAMES.length; id++) if (lower(unitName(id)) === key) return id;
      if (scn.unitSettings) {
        for (let id = 0; id < UNIT_NAMES.length; id++) {
          const custom = unitCustomName(scn, id);
          if (custom && lower(custom) === key) return id;
        }
      }
      const m = /^unit #(\d+)$/.exec(key);
      return m ? Number(m[1]) : undefined;
    },
    switch: (index) => switchName(scn, index),
    switchByName: (name) => {
      const key = lower(name);
      if (scn.switchNames) {
        for (let i = 0; i < SWITCH_COUNT; i++) {
          const s = getString(scn.strings, scn.switchNames[i]);
          if (s !== null && lower(s) === key) return i;
        }
      }
      const m = /^switch (\d+)$/.exec(key);
      return m && Number(m[1]) >= 1 && Number(m[1]) <= SWITCH_COUNT ? Number(m[1]) - 1 : undefined;
    },
  };
}

/* ── Working copies ──────────────────────────────────────── */

export function readTriggers(scn: Scenario): TriggerRecord[] {
  return scn.triggers.map(cloneTrigger);
}

export function readBriefing(scn: Scenario): TriggerRecord[] {
  return scn.briefing.map(cloneTrigger);
}

/** Replace the trigger list. Marks TRIG dirty only when something differs. */
export function applyTriggers(scn: Scenario, next: TriggerRecord[]) {
  if (sameTriggers(scn.triggers, next)) return;
  scn.triggers = next.map(cloneTrigger);
  markDirty(scn, "TRIG");
}

export function applyBriefing(scn: Scenario, next: TriggerRecord[]) {
  if (sameTriggers(scn.briefing, next)) return;
  scn.briefing = next.map(cloneTrigger);
  markDirty(scn, "MBRF");
}

export function sameTriggers(a: TriggerRecord[], b: TriggerRecord[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => JSON.stringify(t) === JSON.stringify(b[i]));
}

/* ── New conditions and actions ──────────────────────────── */

/** The value a fresh argument of this kind starts with (StarEdit-like defaults). */
export function defaultArgValue(kind: ArgKind): number {
  switch (kind) {
    case "player": return PlayerGroup.CurrentPlayer;
    case "unit": return UnitClass.Any;
    case "location": return ANYWHERE_INDEX + 1;
    case "comparison": return Comparison.AtLeast;
    case "switchState": return SwitchState.Set;
    case "switchAction": return SwitchAction.Set;
    case "modifier": return SetModifier.SetTo;
    case "unitState": return UnitState.Enable;
    case "textFlags": return ActionFlag.AlwaysDisplay;
    case "count": return 1;
    case "amount": return 1;
    case "duration": return 1000;
    case "percent": return 100;
    case "cuwp": return 1;
    case "slot": return 1;
    default: return 0;
  }
}

function seed(record: ConditionRecord | ActionRecord, def: ConditionDef | ActionDef) {
  const r = record as unknown as Record<string, number>;
  for (const arg of def.args) {
    if (arg.kind === "textFlags") r.flags |= defaultArgValue(arg.kind);
    else r[arg.field] = defaultArgValue(arg.kind);
  }
}

export function newCondition(type: number): ConditionRecord {
  const c = { ...emptyCondition(), type };
  const def = conditionDef(type);
  if (def) {
    seed(c, def);
    if (def.args.some((a) => a.kind === "unit")) c.flags |= ConditionFlag.UnitTypeUsed;
  }
  return c;
}

export function newAction(type: number, briefing = false): ActionRecord {
  const a = { ...emptyAction(), type };
  const def = actionDef(type, briefing);
  if (def) {
    seed(a, def);
    if (def.args.some((x) => x.kind === "unit")) a.flags |= ActionFlag.UnitTypeUsed;
  }
  return a;
}

/** Whether the trigger keeps running: a Preserve Trigger action or the equivalent flag. */
export function isPreserved(t: TriggerRecord): boolean {
  return (t.flags & 0x04) !== 0 || t.actions.some((a) => a.type === ActionType.PreserveTrigger);
}

/** Add or remove the Preserve Trigger action (StarEdit's checkbox); the flag is left alone. */
export function setPreserved(t: TriggerRecord, on: boolean): TriggerRecord {
  const next = cloneTrigger(t);
  const has = next.actions.some((a) => a.type === ActionType.PreserveTrigger);
  if (on && !has) next.actions.push(newAction(ActionType.PreserveTrigger));
  if (!on) {
    next.actions = next.actions.filter((a) => a.type !== ActionType.PreserveTrigger);
    next.flags &= ~0x04;
  }
  return next;
}

/* ── List operations (pure: they return a new list) ──────── */

/** A blank trigger for the given player groups (default: All Players). */
export function newTrigger(players: number[] = [PlayerGroup.AllPlayers]): TriggerRecord {
  const t = emptyTrigger();
  for (const p of players) t.players[p] = 1;
  return t;
}

export function insertTrigger(list: TriggerRecord[], at: number, t: TriggerRecord): TriggerRecord[] {
  const next = list.slice();
  next.splice(Math.max(0, Math.min(at, list.length)), 0, t);
  return next;
}

export function removeTriggers(list: TriggerRecord[], indices: number[]): TriggerRecord[] {
  const drop = new Set(indices);
  return list.filter((_, i) => !drop.has(i));
}

/** Move the trigger at `from` to `to` (its index in the resulting list). */
export function moveTrigger(list: TriggerRecord[], from: number, to: number): TriggerRecord[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [t] = next.splice(from, 1);
  next.splice(to, 0, t);
  return next;
}

/** Indices of the triggers that run for any of the given player groups. */
/**
 * The string arguments one action carries, read through its def — the text and the WAV
 * path (`kind: "text" | "wav"`), whichever fields they live in — with the argument's
 * label. Everything that maps strings to their users (the String Editor's usage list, the
 * Sound Editor, Find) reads this so the defs stay the one place that knows the fields.
 */
export function actionStrings(a: ActionRecord, briefing = false): { index: number; kind: "text" | "wav"; label: string; action: string }[] {
  const def = actionDef(a.type, briefing);
  const name = def?.name ?? `Action ${a.type}`;
  const out: { index: number; kind: "text" | "wav"; label: string; action: string }[] = [];
  for (const arg of def?.args ?? []) {
    if ((arg.kind === "text" || arg.kind === "wav") && a[arg.field] > 0) out.push({ index: a[arg.field], kind: arg.kind, label: arg.label, action: name });
  }
  return out;
}

export function triggersFor(list: TriggerRecord[], groups: number[]): number[] {
  const out: number[] = [];
  list.forEach((t, i) => { if (groups.some((g) => t.players[g])) out.push(i); });
  return out;
}

/* ── EUD arithmetic, fingerprints and usage ──────────────── */

/** The player value a Deaths condition or Set Deaths action needs to reach a memory address (EUD): the address's offset into the deaths table, in dwords. */
export function epdOf(address: number): number {
  return (((address & ~3) - DEATHS_TABLE_ADDRESS) / 4) >>> 0;
}

/** The address a (player, unit) pair reaches through the deaths table: `table + player × 4 + unit × 48`. */
export function addressOfEpd(player: number, unit = 0): number {
  return (DEATHS_TABLE_ADDRESS + player * 4 + unit * 48) >>> 0;
}

/**
 * A content fingerprint of a trigger (FNV-1a over its numbers), the same wherever it
 * sits in the list and whatever the game's bookkeeping bits say — what a plugin that
 * generates triggers finds its run by, and what an editor keeps a selection by.
 */
export function fingerprintTrigger(trigger: TriggerRecord): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    for (let i = 0; i < 4; i++) {
      h ^= (n >>> (i * 8)) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  for (const c of trigger.conditions) { mix(c.type); mix(c.location); mix(c.player); mix(c.amount); mix(c.unitId); mix(c.comparison); mix(c.resource); mix(c.flags & ~ConditionFlag.Unknown); mix(c.mask); }
  mix(0xffff);
  for (const a of trigger.actions) { mix(a.type); mix(a.location); mix(a.text); mix(a.wav); mix(a.time); mix(a.player); mix(a.target); mix(a.unitId); mix(a.modifier); mix(a.flags & ~ActionFlag.IgnoreWaitOnce); mix(a.mask); }
  mix(0xfffe);
  mix(trigger.flags & ~TriggerFlag.ConditionsMet);
  for (const p of trigger.players) mix(p);
  return h.toString(16).padStart(8, "0");
}

/** The player slots a record's player field can mean, given the trigger's owners: a slot itself; `Current Player` the owners; a group all twelve; None and an EUD address nothing. */
export function playerSlotsOf(player: number, owners: readonly number[]): number[] {
  if (player < 12) return [player];
  if (player >= PLAYER_GROUP_COUNT || player === PlayerGroup.None) return [];
  if (player === PlayerGroup.CurrentPlayer) {
    const out = new Set<number>();
    for (const o of owners) for (const p of playerSlotsOf(o, [])) out.add(p);
    return [...out].sort((a, b) => a - b);
  }
  return Array.from({ length: 12 }, (_, i) => i);
}

/**
 * Every death-counter cell and switch the triggers read or write — what a plugin that
 * allocates counters of its own must keep clear of. A cell is `[player, unit]`; deaths
 * of a unit class (`Any unit`, `Men`, …) are a sum the game computes and count for nothing.
 */
export function triggerUsage(list: readonly TriggerRecord[]): { cells: [player: number, unit: number][]; switches: number[] } {
  const cells = new Set<number>();
  const switches = new Set<number>();
  for (const t of list) {
    const owners = t.players.flatMap((on, i) => (on ? [i] : []));
    for (const c of t.conditions) {
      if (c.type === ConditionType.Deaths && c.unitId < UNIT_TYPE_COUNT) for (const p of playerSlotsOf(c.player, owners)) cells.add(c.unitId * 12 + p);
      if (c.type === ConditionType.Switch) switches.add(c.resource);
    }
    for (const a of t.actions) {
      if (a.type === ActionType.SetDeaths && a.unitId < UNIT_TYPE_COUNT) for (const p of playerSlotsOf(a.player, owners)) cells.add(a.unitId * 12 + p);
      if (a.type === ActionType.SetSwitch) switches.add(a.target);
    }
  }
  return { cells: [...cells].sort((a, b) => a - b).map((k) => [k % 12, Math.floor(k / 12)]), switches: [...switches].sort((a, b) => a - b) };
}
