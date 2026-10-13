/**
 * What the editor starts with after a StarCraft: Remastered copy is made somewhere it is
 * not running — the installer page the play page frames (`pages/install.ts`). The editor's
 * own Game Data dialog does the same through its atoms (`services/gameData.ts`:
 * `turnOnRemasteredGraphics`, `installRemasteredInto`); here there are no atoms, only the
 * storage they are read from, so the two stored choices are written as the atoms would
 * write them: View ▸ Remastered Graphics on, and — where the copy went in beside the
 * person's 1.16 one — that data set chosen.
 *
 * Only ever at that moment, like the dialog's: the options are the user's from then on.
 */
import { PROFILE_KEY } from "./profiles";

/** The key the preferences are kept under (`atoms/preferencesAtoms.ts`). */
const PREFERENCES_KEY = "scmjs.prefs";

export function startWithRemastered(storage: Pick<Storage, "getItem" | "setItem">, profile?: string): void {
  try {
    let prefs: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(storage.getItem(PREFERENCES_KEY) ?? "{}");
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) prefs = parsed as Record<string, unknown>;
    } catch { /* what is there is not preferences: the defaults, with this one changed */ }
    if (prefs.hdGraphics !== true) storage.setItem(PREFERENCES_KEY, JSON.stringify({ ...prefs, hdGraphics: true }));
    if (profile) storage.setItem(PROFILE_KEY, JSON.stringify({ profile }));
  } catch { /* storage refused: the editor opens as it was, and the option is in its View menu */ }
}
