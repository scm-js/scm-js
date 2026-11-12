/**
 * Races a data set adds to the game's own. A race is a number: a player's record (SIDE in a map, the player record of
 * a replay's header) holds a byte, and 0–7 are the game's — Zerg, Terran, Protoss, then Independent, Neutral, User
 * Select, Random and Inactive. Any other value belongs to the data set in use: a mod may add races, and the game's
 * files say nothing of what they are called (a mod's plugin code does). So a data set may *declare* them, as a small
 * table that rides beside its name (`mod.json`'s `races`, the editor's data set profile, a map's
 * `scmjs\dataset.json`, a replay's tag) and never inside its hashed files.
 *
 * The table's shape, the rule that reads one (`normalizeRaces`) and the hints a mod's files give when a person names its
 * races (`raceCandidates`, never taken for facts) are `@scm-js/mod`'s. Here, what is the editor's: the name of a race by
 * its byte (`raceLabel`), the choices a menu offers, and which of the game's three races a list of unit types plays as
 * (`racePlaysAs`, from the units table's group flags).
 */
import type { DataSetRace, RaceCandidates } from "@scm-js/mod";
import type { UnitsDat } from "../dat/dat";
import { PLAYER_RACES } from "../../data/players";

/** The first race byte a data set may declare; 0–7 are the game's. */
export const FIRST_DATASET_RACE = 8;

/**
 * The game's own eight races by their byte (0 Zerg … 7 Inactive), English as the editor's tables have them (shown
 * through `translate`).
 */
export const GAME_RACE_NAMES: readonly string[] = Array.from({ length: FIRST_DATASET_RACE }, (_, id) => PLAYER_RACES.find((r) => r.value === id)!.label);

/** Whether two tables say the same (after `normalizeRaces`): the same ids, names, letters and `like`s, in order. */
export function sameRaces(a: readonly DataSetRace[], b: readonly DataSetRace[]): boolean {
  return a.length === b.length && a.every((r, i) => r.id === b[i].id && r.name === b[i].name && r.letter === b[i].letter && r.like === b[i].like);
}

/**
 * A race by its byte: the game's own name (English, as `playerRaceLabel` gives it), else the name `races` declares,
 * else `Race {id}`. With no table it is `playerRaceLabel`.
 */
export function raceLabel(id: number, races: readonly DataSetRace[] = []): string {
  return GAME_RACE_NAMES[id] ?? races.find((r) => r.id === id)?.name ?? `Race ${id}`;
}

/** The races to offer for a choice: the game's eight in StarEdit's order, then the declared ones by id. */
export function raceChoices(races: readonly DataSetRace[] = []): { value: number; label: string }[] {
  return [...PLAYER_RACES.map((r) => ({ value: r.value, label: r.label })), ...races.filter((r) => r.id >= FIRST_DATASET_RACE).map((r) => ({ value: r.id, label: r.name }))];
}

/** Whether there is anything in `RaceCandidates` to offer. */
export const hasRaceCandidates = (c: RaceCandidates) => c.names.length > 0 || c.letters.length > 0;

/**
 * Which of the game's three races a player plays as, from the units they build or own: the Zerg, Terran or Protoss
 * group flag (units.dat's StarEdit group flags, bits 0–2) most of `unitIds` carry. Null when none carries one, when two
 * are carried by as many, or with no units: unknown, not guessed. A unit counts once per flag it carries.
 */
export function racePlaysAs(unitIds: Iterable<number>, units: Pick<UnitsDat, "groupFlags">): 0 | 1 | 2 | null {
  const counts = [0, 0, 0];
  for (const id of unitIds) {
    const g = units.groupFlags[id] ?? 0;
    for (let bit = 0; bit < 3; bit++) if (g & (1 << bit)) counts[bit]++;
  }
  const most = Math.max(...counts);
  if (most === 0 || counts.filter((c) => c === most).length > 1) return null;
  return counts.indexOf(most) as 0 | 1 | 2;
}
