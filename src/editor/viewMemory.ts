/**
 * The View menu ticks the editor remembers between sessions: the grid, the location names,
 * the two animations and Remastered Graphics. Every other tick (the overlays, and whether
 * units, doodads, sprites, locations and start locations are drawn) starts each session on
 * its default, so nobody opens the editor to a map with its units hidden.
 *
 * What is stored is only the ticks the person has changed (`ViewMemory`), so a tick they
 * never touched can still follow the system: under "reduce motion" the animations start
 * off (`viewMemoryDefaults`). The atoms are in `atoms/editorAtoms.ts` (`viewMemoryAtom`,
 * `viewFlagsAtom`); this module is plain so the installer page can write the key too.
 */
import type { ViewFlags } from "./view";

/** The stored key, under the editor's `scmjs.` prefix like the rest. */
export const VIEW_MEMORY_KEY = "scmjs.viewMenu";

export const REMEMBERED_FLAGS = ["grid", "locationNames", "animateWater", "animateUnits", "hdGraphics"] as const;
export type RememberedFlag = (typeof REMEMBERED_FLAGS)[number];

/** The remembered ticks the person has set; a tick missing here is on its default. */
export type ViewMemory = Partial<Pick<ViewFlags, RememberedFlag>>;

/** What the remembered ticks are before the person sets them. */
export function viewMemoryDefaults(reducedMotion: boolean): Pick<ViewFlags, RememberedFlag> {
  return { grid: false, locationNames: true, animateWater: !reducedMotion, animateUnits: !reducedMotion, hdGraphics: false };
}

/** Only the remembered ticks, and only those that are true or false: whatever else storage held is dropped. */
export function sanitizeViewMemory(value: unknown): ViewMemory {
  const out: ViewMemory = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const k of REMEMBERED_FLAGS) {
    const v = (value as Record<string, unknown>)[k];
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** The key the preferences are kept under (`atoms/preferencesAtoms.ts`). */
const PREFERENCES_KEY = "scmjs.prefs";

/**
 * Up to 0.16, Preferences ▸ View held three of these ticks as what the View menu started
 * with (`animateWater`, `animateUnits`, `hdGraphics` in the stored preferences). Move a
 * choice made there into the View menu's own key, once: only a value that differs from the
 * old default was a choice (the dialog wrote every field on OK), and only when the new key
 * is not there yet. The three fields are then taken out of the stored preferences, so a
 * later clear of the View menu's key does not bring them back. Safe to call any number of
 * times; storage that refuses leaves everything as it was.
 */
export function carryOverViewPreferences(storage: Pick<Storage, "getItem" | "setItem">): void {
  try {
    const raw = storage.getItem(PREFERENCES_KEY);
    if (!raw) return;
    const prefs: unknown = JSON.parse(raw);
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return;
    const old = prefs as Record<string, unknown>;
    if (!("animateWater" in old) && !("animateUnits" in old) && !("hdGraphics" in old)) return;
    if (storage.getItem(VIEW_MEMORY_KEY) === null) {
      const carried: ViewMemory = {};
      if (old.animateWater === false) carried.animateWater = false;
      if (old.animateUnits === false) carried.animateUnits = false;
      if (old.hdGraphics === true) carried.hdGraphics = true;
      if (Object.keys(carried).length > 0) storage.setItem(VIEW_MEMORY_KEY, JSON.stringify(carried));
    }
    const rest = { ...old };
    delete rest.animateWater;
    delete rest.animateUnits;
    delete rest.hdGraphics;
    storage.setItem(PREFERENCES_KEY, JSON.stringify(rest));
  } catch {
    // Not JSON, or storage refused: nothing is carried, and the defaults apply.
  }
}
