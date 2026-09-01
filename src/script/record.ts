/** The record fields in the order the raw `Condition(...)` / `Action(...)` forms take them (the text format's order). */
import type { ActionRecord, ConditionRecord } from "../formats/chk/sections/triggers";

export const CONDITION_FIELDS = ["type", "location", "player", "amount", "unitId", "comparison", "resource"] as const satisfies readonly (keyof ConditionRecord)[];
export const ACTION_FIELDS = ["type", "location", "text", "wav", "time", "player", "target", "unitId", "modifier"] as const satisfies readonly (keyof ActionRecord)[];
