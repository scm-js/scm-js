/**
 * Data sets. The editor draws from one set of game files at a time — Blizzard's own, or a
 * mod's that replaces them in the same formats — and a *profile* names one. The default is
 * the game's; any other is a copy in the browser's private file storage installed under
 * its own id (`store.ts`), and the one in use is remembered under `scmjs.gameData`
 * (`atoms/gameDataAtoms.ts#gameDataProfileAtom` is the atom over that key; the resolver reads
 * the key itself, since it runs outside the store).
 *
 * A profile is only a name over a set of files in the game's formats — its tables at any
 * width (`formats/dat/table.ts`), its tilesets at any size — and nothing in the editor knows
 * which set is loaded beyond what the files say (names, types, pictures) and this label.
 */
import { browserStorage } from "../atoms/storage";
import { normalizeRaces, type DataSetRace } from "../formats/mod/races";

export interface GameDataProfile {
  /** Lower-case letters, digits and hyphens, up to 40 characters; the copy's folder name. */
  id: string;
  /** What the dialog and the status line call it. */
  name: string;
  /**
   * Where the data set's makers publish it (an `http(s)` address), when known. A map made
   * with the data set records it, so that someone who opens the map without the data set
   * is told where to get it. The editor never fetches it.
   */
  url?: string;
  /**
   * The races the data set adds to the game's own (race bytes 8–255), when they are declared:
   * no game file says what a mod's races are called. Kept with the profile's id
   * (`keptRaces`), so they outlive a new release of the mod and a re-attach.
   */
  races?: DataSetRace[];
}

export const DEFAULT_PROFILE: GameDataProfile = { id: "starcraft", name: "StarCraft: Brood War" };

/**
 * The data set a StarCraft: Remastered installation is installed as, beside a copy of the
 * 1.16 files (`remastered.ts`). Here, with the two below, rather than there: the startup
 * path asks whether a copy is Remastered's, and that module brings the extraction with it.
 */
export const REMASTERED_PROFILE: GameDataProfile = { id: "remastered", name: "StarCraft: Remastered" };

/** What the origin of every copy made from a Remastered installation starts with (its stamp's `from`). */
export const REMASTERED_ORIGIN = "StarCraft: Remastered";

/**
 * Whether a copy came from a Remastered installation, by where its stamp says it is from —
 * which is what says the copy carries Remastered's own pictures and not only the tables.
 */
export const isRemasteredOrigin = (from: string | undefined): boolean => from?.startsWith(REMASTERED_ORIGIN) ?? false;

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
  const url = typeof profile.url === "string" && /^https?:\/\/\S+$/i.test(profile.url.trim()) ? profile.url.trim() : undefined;
  const races = normalizeRaces(profile.races);
  return { id: profile.id, name: name || profile.id, ...(url ? { url } : {}), ...(races.length ? { races } : {}) };
}

/* ── Races a data set adds ──────────────────────────────── */

/** The stored key: `{ "<profile id>": DataSetRace[] }`, the races declared for each data set. */
export const RACES_KEY = "scmjs.dataSetRaces";

/**
 * Whether a data set takes declared races: not the game's own, nor a Remastered
 * installation's, whose races are the game's eight.
 */
export const takesRaces = (id: string) => isProfileId(id) && !isDefaultProfile(id) && id !== REMASTERED_PROFILE.id;

function readKept(): Record<string, unknown> {
  try {
    const raw = browserStorage().getItem(RACES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * The races kept for the data set `id` — an empty table when they were declared as none —
 * or null when nothing was ever declared for it here.
 */
export function keptRaces(id: string): DataSetRace[] | null {
  if (!takesRaces(id)) return null;
  const kept = readKept();
  return Object.prototype.hasOwnProperty.call(kept, id) ? normalizeRaces(kept[id]) : null;
}

/**
 * The stored table with `races` (normalized) for the data set `id`, for
 * `gameDataAtoms.ts#keepRacesAtom` to write: the one writer of the key, so that Preferences ▸
 * Storage can clear and import it live. An empty table is kept too: it says the set has
 * none, and a map's races do not replace it. Null for the game's own sets, which take none.
 */
export function racesTableWith(id: string, races: readonly DataSetRace[]): Record<string, DataSetRace[]> | null {
  if (!takesRaces(id)) return null;
  const table: Record<string, DataSetRace[]> = {};
  for (const [k, v] of Object.entries(readKept())) if (isProfileId(k)) table[k] = normalizeRaces(v);
  table[id] = normalizeRaces(races);
  return table;
}

/**
 * The races of a data set: those kept for its id; none when nothing is kept, and none for
 * the game's own. A profile's own `races` is not read here: a profile handed in with races
 * (`attach`, `install`, a folder's `mod.json`) has them kept first, so clearing what is
 * kept clears them everywhere.
 */
export function racesOf(profile: Pick<GameDataProfile, "id"> | null | undefined): DataSetRace[] {
  if (!profile || !takesRaces(profile.id)) return [];
  return keptRaces(profile.id) ?? [];
}

/** `profile` carrying its races (`racesOf`), or without the field when it has none. */
export function withRaces<P extends GameDataProfile>(profile: P): P {
  const races = racesOf(profile);
  const { races: _was, ...rest } = profile;
  void _was;
  return (races.length ? { ...rest, races } : rest) as P;
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
