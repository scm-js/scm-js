/**
 * What the editor starts with after a StarCraft: Remastered copy is made somewhere it is
 * not running — the installer page the play page frames (`pages/install.ts`). The editor's
 * own Game Data dialog does the same through its atoms (`services/gameData.ts`:
 * `turnOnRemasteredGraphics`, `installRemasteredInto`); here there are no atoms, only the
 * storage they are read from, so the two stored choices are written as the atoms would
 * write them: View ▸ Remastered Graphics on (the View menu's remembered ticks,
 * `app/viewMemory.ts`), and — where the copy went in beside the person's 1.16 one —
 * that data set chosen.
 *
 * Only ever at that moment, like the dialog's: the options are the user's from then on.
 */
import { PROFILE_KEY } from "./profiles";
import { carryOverViewPreferences, VIEW_MEMORY_KEY } from "../app/viewMemory";

export function startWithRemastered(storage: Pick<Storage, "getItem" | "setItem">, profile?: string): void {
  try {
    // A choice an older version kept in the preferences moves first, so it is not lost under this one.
    carryOverViewPreferences(storage);
    let ticks: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(storage.getItem(VIEW_MEMORY_KEY) ?? "{}");
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) ticks = parsed as Record<string, unknown>;
    } catch { /* what is there is not the View menu's ticks: the defaults, with this one changed */ }
    if (ticks.hdGraphics !== true) storage.setItem(VIEW_MEMORY_KEY, JSON.stringify({ ...ticks, hdGraphics: true }));
    if (profile) storage.setItem(PROFILE_KEY, JSON.stringify({ profile }));
  } catch { /* storage refused: the editor opens as it was, and the option is in its View menu */ }
}
