/**
 * Switch names (SWNM): 256 string indices, 0 for an unnamed switch. Edited as one
 * settings-style transaction; the section is created on the first name a map gets.
 */
import { markDirty, type Scenario } from "../formats/chk/scenario";
import { getString } from "../formats/chk/sections/strings";
import { ActionType, ConditionType, SWITCH_COUNT } from "../formats/chk/sections/triggers";
import { internString } from "./settings";

/** The 256 names, "" where a switch has none. */
export function readSwitchNames(scn: Scenario): string[] {
  return Array.from({ length: SWITCH_COUNT }, (_, i) => (scn.switchNames ? getString(scn.strings, scn.switchNames[i] ?? 0) : null) ?? "");
}

/** Per switch, how many Switch conditions and Set Switch actions refer to it across the triggers. */
export function switchUsage(scn: Scenario): number[] {
  const out = Array.from({ length: SWITCH_COUNT }, () => 0);
  const count = (i: number) => { if (i >= 0 && i < SWITCH_COUNT) out[i]++; };
  for (const t of scn.triggers) {
    for (const c of t.conditions) if (c.type === ConditionType.Switch) count(c.resource);
    for (const a of t.actions) if (a.type === ActionType.SetSwitch) count(a.target);
  }
  return out;
}

/**
 * Install edited names: a changed non-empty name is interned (an identical string is
 * reused, else appended), a cleared one becomes 0. Marks SWNM dirty only on a change.
 */
export function applySwitchNames(scn: Scenario, names: readonly string[]): boolean {
  const current = readSwitchNames(scn);
  const table = scn.switchNames ? scn.switchNames.slice() : Array.from({ length: SWITCH_COUNT }, () => 0);
  let changed = false;
  for (let i = 0; i < SWITCH_COUNT; i++) {
    const name = names[i] ?? "";
    if (name === current[i]) continue;
    table[i] = name === "" ? 0 : internString(scn, name);
    changed = true;
  }
  if (!changed) return false;
  scn.switchNames = table;
  markDirty(scn, "SWNM");
  return true;
}
