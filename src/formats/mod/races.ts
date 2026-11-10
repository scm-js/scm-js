/**
 * Races a data set adds to the game's own. A race is a number: a player's record (SIDE in a map, the player record of
 * a replay's header) holds a byte, and 0–7 are the game's — Zerg, Terran, Protoss, then Independent, Neutral, User
 * Select, Random and Inactive. Any other value belongs to the data set in use: a mod may add races, and the game's
 * files say nothing of what they are called (a mod's plugin code does). So a data set may *declare* them, as a small
 * table that rides beside its name (`mod.json`'s `races`, the editor's data set profile, a map's
 * `scmjs\dataset.json`, a replay's tag) and never inside its hashed files.
 *
 * Here: the table's shape and the rule that reads one (`normalizeRaces`), the name of a race by its byte
 * (`raceLabel`), the hints a mod's files give when a person names its races (`raceCandidates`, never taken for facts),
 * and which of the game's three races a list of unit types plays as (`racePlaysAs`, from the units table's group flags).
 */
import type { UnitsDat } from "../dat/dat";
import { decodeTbl } from "../dat/tbl";
import { PLAYER_RACES } from "../../data/players";
import { gameName } from "./sources";

/** A race a data set adds to the game's own. */
export interface DataSetRace {
  /** The race byte: 8–255. (0–7 are the game's and cannot be declared.) */
  id: number;
  /** What it is called, 40 characters at most, trimmed, not empty. */
  name: string;
  /** The lower-case letter its per-race files go by (`game\<letter>console.pcx`, `rez\statbtn<letter>.bin`), when it has them. */
  letter?: string;
  /** The game's race it plays as, where only the game's three are known: 0, 1 or 2. Absent: not declared. */
  like?: 0 | 1 | 2;
}

/** The first race byte a data set may declare; 0–7 are the game's. */
export const FIRST_DATASET_RACE = 8;
/** The longest name a declared race may have. */
export const RACE_NAME_MAX = 40;

/**
 * The game's own eight races by their byte (0 Zerg … 7 Inactive), English as the editor's tables have them (shown
 * through `translate`).
 */
export const GAME_RACE_NAMES: readonly string[] = Array.from({ length: FIRST_DATASET_RACE }, (_, id) => PLAYER_RACES.find((r) => r.value === id)!.label);

/**
 * A table of declared races as every carrier keeps it: each row's `id` an integer 8–255, its `name` trimmed, not empty
 * and at most 40 characters, `letter` one letter a–z (lower-cased) and `like` 0, 1 or 2 when present and valid (an
 * invalid one is left off the row). A row without a usable id or name is dropped, and so is a later row with an id an
 * earlier one has. Sorted by id. Fields a row has beyond these are kept. Anything that is not an array is an empty
 * table; nothing here throws.
 */
export function normalizeRaces(value: unknown): DataSetRace[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const out: DataSetRace[] = [];
  for (const row of value as unknown[]) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const id = r.id;
    if (typeof id !== "number" || !Number.isInteger(id) || id < FIRST_DATASET_RACE || id > 255 || seen.has(id)) continue;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name || name.length > RACE_NAME_MAX) continue;
    const kept: Record<string, unknown> = { ...r, id, name };
    delete kept.letter;
    delete kept.like;
    const letter = typeof r.letter === "string" && /^[a-z]$/i.test(r.letter.trim()) ? r.letter.trim().toLowerCase() : undefined;
    if (letter) kept.letter = letter;
    if (r.like === 0 || r.like === 1 || r.like === 2) kept.like = r.like;
    seen.add(id);
    out.push(kept as unknown as DataSetRace);
  }
  return out.sort((a, b) => a.id - b.id);
}

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

/** How many entries the game's own `rez\network.tbl` has (1.16.1's, the same in Remastered): a mod's past it are its own. */
export const GAME_NETWORK_TBL_ENTRIES = 168;
/** The letters the game's own per-race files go by: Zerg, Terran, Protoss and the neutral console. */
const GAME_RACE_LETTERS = new Set(["z", "t", "p", "n"]);

/** What a mod's files suggest about the races it adds: hints for a person naming them, never names in themselves. */
export interface RaceCandidates {
  /** Strings the mod's `rez\network.tbl` has past the game's own table, with their index there (0-based). */
  names: { index: number; name: string }[];
  /** Letters other than z, t, p and n that have `game\<x>console.pcx` or `rez\statbtn<x>.bin`, sorted. */
  letters: string[];
}

/**
 * The hints a mod's files give about the races it adds. `network` is the mod's `rez\network.tbl` (null when it has
 * none); `gameNetwork` the game's own, from a copy of the game (its length is `GAME_NETWORK_TBL_ENTRIES` without one);
 * `paths` the mod's files by any spelling of their game names. A race's name must never be filled in from these alone.
 */
export function raceCandidates(files: { network?: Uint8Array | null; gameNetwork?: Uint8Array | null; paths: Iterable<string> }): RaceCandidates {
  const names: RaceCandidates["names"] = [];
  if (files.network) {
    const decode = (b: Uint8Array) => { try { return decodeTbl(b); } catch { return []; } };
    const list = decode(files.network);
    const game = files.gameNetwork ? decode(files.gameNetwork).length : 0;
    const from = game || GAME_NETWORK_TBL_ENTRIES;
    for (let i = from; i < list.length; i++) {
      // (Without control characters: a tbl's colour codes are bytes below 0x20.)
      const name = [...list[i]].filter((c) => c.charCodeAt(0) >= 0x20).join("").trim();
      if (name) names.push({ index: i, name });
    }
  }
  const letters = new Set<string>();
  for (const path of files.paths) {
    const m = /^(?:game\\([a-z])console\.pcx|rez\\statbtn([a-z])\.bin)$/.exec(gameName(path));
    const letter = m?.[1] ?? m?.[2];
    if (letter && !GAME_RACE_LETTERS.has(letter)) letters.add(letter);
  }
  return { names, letters: [...letters].sort() };
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
