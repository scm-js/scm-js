/**
 * The vocabulary the trigger script shares between its three consumers — the generated
 * declarations (`declarations.ts`), the compiler (`compiler.ts`) and the printer
 * (`print.ts`): which identifier each condition/action goes by, what TypeScript type each
 * argument kind has, and the string unions the enumerated kinds accept.
 *
 * Identifiers are the `ConditionType` / `ActionType` keys (`Bring`, `DisplayText`,
 * `KillUnitAt`) rather than TrigEdit's spaced names, so the script reads like code;
 * argument order is still the table's, so a text trigger and its script form line up.
 */
import {
  ACTION_DEFS, CHOICES, CONDITION_DEFS, type ActionDef, type ArgKind, type ConditionDef,
} from "../data/triggerDefs";
import { ActionType, ConditionType } from "../formats/chk/sections/triggers";

function keyOf(table: Record<string, number>, value: number): string | undefined {
  for (const [k, v] of Object.entries(table)) if (v === value) return k;
  return undefined;
}

export function conditionIdent(type: number): string | undefined {
  return keyOf(ConditionType, type);
}

export function actionIdent(type: number): string | undefined {
  return keyOf(ActionType, type);
}

/** Script identifier → definition. Mission Briefing is a briefing-only condition and has no script form. */
export const CONDITION_IDENTS: ReadonlyMap<string, ConditionDef> = new Map(
  CONDITION_DEFS.filter((d) => d.type !== ConditionType.Briefing).map((d) => [conditionIdent(d.type)!, d]),
);
export const ACTION_IDENTS: ReadonlyMap<string, ActionDef> = new Map(ACTION_DEFS.map((d) => [actionIdent(d.type)!, d]));

/** The names of the string-union types for enumerated argument kinds. */
export const CHOICE_TYPES: Partial<Record<ArgKind, string>> = {
  comparison: "Comparison",
  switchState: "SwitchState",
  switchAction: "SwitchAction",
  modifier: "Modifier",
  unitState: "UnitState",
  order: "OrderKind",
  alliance: "Alliance",
  resource: "ResourceKind",
  score: "ScoreKind",
  textFlags: "TextDisplay",
};

/** Every spelling a choice kind accepts, in table order (labels first, then aliases). */
export function choiceSpellings(kind: ArgKind): string[] {
  const out: string[] = [];
  for (const c of CHOICES[kind] ?? []) {
    out.push(c.label);
    for (const al of c.aliases ?? []) out.push(al);
  }
  return out;
}

/** The TypeScript type of an argument of this kind. */
export function argType(kind: ArgKind): string {
  switch (kind) {
    case "player": return "PlayerId";
    case "unit": return "UnitId";
    case "location": return "LocationId";
    case "switch": return "SwitchId";
    case "text": case "wav": return "string";
    case "aiScript": return "AiScriptId | string";
    case "count": return "Count";
    case "number": case "amount": case "duration": case "percent": case "cuwp": case "slot": return "number";
    default: return `${CHOICE_TYPES[kind] ?? "number"} | number`;
  }
}

const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with implements interface let package private protected public static yield".split(" "));

/** A parameter name for an argument label: `Unit at` → `unitAt`; reserved words get a trailing underscore. */
export function paramName(label: string): string {
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const id = words.map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1))).join("");
  if (/^\d/.test(id) || id === "") return `_${id}`;
  return RESERVED.has(id) ? `${id}_` : id;
}

export const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A property key as it appears in a declaration: bare when it is an identifier, quoted otherwise. */
export function propertyKey(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

/** A member access as it appears in a script: `Units.TerranMarine` or `Units["Terran Marine"]`. */
export function memberAccess(object: string, key: string): string {
  return IDENTIFIER.test(key) ? `${object}.${key}` : `${object}[${JSON.stringify(key)}]`;
}
