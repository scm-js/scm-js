/**
 * Triggers → script: the inverse of the compiler, so hand-made triggers can be "ejected"
 * into the Script editor and a generated block can be inspected as source. Uses the
 * first key of each name-table entry (`Units.TerranMarine`, `Locations["Beacon Alpha"]`
 * when the name is not an identifier), a bare number for anything the tables do not
 * cover, and the raw `Condition(...)` / `Action(...)` forms for unknown types — so any
 * record prints, and printing then compiling gives the record back.
 */
import { ActionFlag, ConditionFlag, PlayerGroup, type ActionRecord, type ConditionRecord, type TriggerRecord } from "../formats/chk/sections/triggers";
import { actionDef, aiScriptName, choiceLabel, conditionDef, type ArgKind } from "../data/triggerDefs";
import { TRIGGER_FLAG_NAMES } from "../formats/triggers/text";
import { actionIdent, conditionIdent, memberAccess } from "./api";
import { entryFor, type NameTable, type ScriptNames } from "./names";
import { ACTION_FIELDS, CONDITION_FIELDS } from "./record";

export interface PrintContext {
  names: ScriptNames;
  /** Text of a string-table entry, null when unset. */
  string(index: number): string | null;
}

function ref(table: NameTable, value: number): string {
  const e = entryFor(table, value);
  return e ? memberAccess(table.object, e.keys[0]) : String(value);
}

export function playerRef(names: ScriptNames, value: number): string {
  if (value >= 0 && value < 12) return `P${value + 1}`;
  if (value === PlayerGroup.CurrentPlayer) return "CurrentPlayer";
  if (value === PlayerGroup.AllPlayers) return "AllPlayers";
  return ref(names.players, value);
}

function formatValue(kind: ArgKind, value: number, ctx: PrintContext): string {
  switch (kind) {
    case "player": return playerRef(ctx.names, value);
    case "unit": return ref(ctx.names.units, value);
    case "location": return ref(ctx.names.locations, value);
    case "switch": return ref(ctx.names.switches, value);
    case "aiScript": {
      const e = entryFor(ctx.names.aiScripts, value);
      return e ? memberAccess(ctx.names.aiScripts.object, e.keys[0]) : JSON.stringify(aiScriptName(value));
    }
    case "text": case "wav": return JSON.stringify(ctx.string(value) ?? "");
    case "count": return value === 0 ? '"All"' : String(value);
    case "number": case "amount": case "duration": case "percent": case "cuwp": case "slot": return String(value);
    default: {
      const label = choiceLabel(kind, value);
      return label ? JSON.stringify(label) : String(value);
    }
  }
}

function wrapDisabled(text: string, off: boolean) {
  return off ? `disabled(${text})` : text;
}

export function printCondition(c: ConditionRecord, ctx: PrintContext): string {
  const def = conditionDef(c.type);
  const ident = conditionIdent(c.type);
  const off = (c.flags & ConditionFlag.Disabled) !== 0;
  if (!def || !ident || ident === "Briefing") {
    const r = c as unknown as Record<string, number>;
    return wrapDisabled(`Condition(${CONDITION_FIELDS.map((f) => r[f]).join(", ")})`, off);
  }
  const args = def.args.map((a) => formatValue(a.kind, (c as unknown as Record<string, number>)[a.field], ctx));
  return wrapDisabled(`${ident}(${args.join(", ")})`, off);
}

export function printAction(a: ActionRecord, ctx: PrintContext): string {
  const def = actionDef(a.type);
  const ident = actionIdent(a.type);
  const off = (a.flags & ActionFlag.Disabled) !== 0;
  const r = a as unknown as Record<string, number>;
  if (!def || !ident) return wrapDisabled(`Action(${ACTION_FIELDS.map((f) => r[f]).join(", ")})`, off);
  const args = def.args.map((arg) => formatValue(arg.kind, arg.kind === "textFlags" ? r.flags & ActionFlag.AlwaysDisplay : r[arg.field], ctx));
  return wrapDisabled(`${ident}(${args.join(", ")})`, off);
}

function block(items: string[]): string {
  return items.length ? `[\n${items.map((s) => `  ${s},`).join("\n")}\n]` : "[]";
}

export function printTrigger(t: TriggerRecord, ctx: PrintContext): string {
  const players: string[] = [];
  t.players.forEach((v, i) => { if (v) players.push(playerRef(ctx.names, i)); });
  const known = TRIGGER_FLAG_NAMES.reduce((m, [bit]) => m | bit, 0);
  const flags: string[] = TRIGGER_FLAG_NAMES.filter(([bit]) => t.flags & bit).map(([, name]) => JSON.stringify(name));
  if (t.flags & ~known) flags.push(`0x${(t.flags & ~known).toString(16)}`);
  const parts = [
    players.length === 1 ? players[0] : `[${players.join(", ")}]`,
    block(t.conditions.map((c) => printCondition(c, ctx))),
    block(t.actions.map((a) => printAction(a, ctx))),
  ];
  if (flags.length) parts.push(`[${flags.join(", ")}]`);
  return `trigger(${parts.join(", ")});`;
}

export const SCRIPT_HEADER = `// Trigger script — compiled into a block of the map's trigger list on Build.
// Each trigger(players, conditions, actions, flags?) call becomes one trigger, in order.
`;

export function printScript(triggers: TriggerRecord[], ctx: PrintContext, header = SCRIPT_HEADER): string {
  return header + (triggers.length ? "\n" + triggers.map((t) => printTrigger(t, ctx)).join("\n\n") + "\n" : "");
}
