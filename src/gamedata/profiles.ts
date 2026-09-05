/**
 * Data sets. The editor draws from one set of game files at a time — Blizzard's own, or a
 * mod's that replaces them in the same formats — and a *profile* names one. The default is
 * the game's; any other is a copy in the browser's private file storage installed under
 * its own id (`store.ts`), and the one in use is remembered under `scmjs.gameData`
 * (`atoms/gameDataAtoms.ts#gameDataProfileAtom` is the atom over that key; the resolver reads
 * the key itself, since it runs outside the store).
 *
 * A profile is only a name over a set of files: the formats, the table sizes and the ids
 * are the game's, and nothing in the editor knows which set is loaded beyond the names it
 * shows (`data/gameNames.ts`) and this label. A mod that extends the tables is not covered.
 */
import { browserStorage } from "../atoms/storage";

export interface GameDataProfile {
  /** Lower-case letters, digits and hyphens, up to 40 characters; the copy's folder name. */
  id: string;
  /** What the dialog and the status line call it. */
  name: string;
}

export const DEFAULT_PROFILE: GameDataProfile = { id: "starcraft", name: "StarCraft: Brood War" };

/** The stored key: `{ "profile": "<id>" }`. */
export const PROFILE_KEY = "scmjs.gameData";

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function isProfileId(id: unknown): id is string {
  return typeof id === "string" && ID.test(id);
}

export const isDefaultProfile = (id: string) => id === DEFAULT_PROFILE.id;

/** `name` reduced to an id: `"Cosmonarchy BW"` → `"cosmonarchy-bw"`; empty when nothing is left. */
export function profileIdFrom(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/** A profile as it may be stored: id checked, name trimmed and never empty. Null for an unusable id. */
export function normalizeProfile(profile: GameDataProfile): GameDataProfile | null {
  if (!isProfileId(profile.id)) return null;
  const name = profile.name.trim();
  return { id: profile.id, name: name || profile.id };
}

/** The id the user chose, read straight from storage; the default when none or unusable. */
export function activeProfileId(): string {
  try {
    const raw = browserStorage().getItem(PROFILE_KEY);
    if (!raw) return DEFAULT_PROFILE.id;
    const parsed: unknown = JSON.parse(raw);
    const id = typeof parsed === "object" && parsed !== null ? (parsed as { profile?: unknown }).profile : undefined;
    return isProfileId(id) ? id : DEFAULT_PROFILE.id;
  } catch {
    return DEFAULT_PROFILE.id;
  }
}
