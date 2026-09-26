/** The shortcut table F1 shows: every command with the keys it answers to now, then the keys that are not commands. */
import { COMMAND_GROUPS, COMMANDS, FIXED_KEYS, formatCombo, type ResolvedHotkeys } from "../../editor/commands";

export interface HotkeyRow {
  /** A `msg()` key; `translate` where shown. */
  label: string;
  keys: string[];
}

export function hotkeyRows(resolved: ResolvedHotkeys): HotkeyRow[] {
  const rows: HotkeyRow[] = [];
  for (const g of COMMAND_GROUPS) {
    for (const c of COMMANDS) {
      if (c.group !== g.id) continue;
      const keys = resolved.byCommand[c.id] ?? [];
      if (keys.length > 0) rows.push({ label: c.label, keys: keys.map(formatCombo) });
    }
  }
  for (const [label, keys] of FIXED_KEYS) rows.push({ label, keys });
  return rows;
}
