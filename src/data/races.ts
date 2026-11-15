/**
 * The races of the data set in use, as the editor names them. A race is a byte (SIDE); 0–7 are the game's own and any
 * other belongs to the data set, which may declare what its races are called (`formats/mod/races.ts`). The table of
 * the data set in use is installed here whenever the session's source changes (`gamedata/source.ts`), as the loaded
 * unit names are in `data/units.ts`, so code with no store in reach names races the same way.
 */
import type { DataSetRace } from "@scm-js/mod";
import { GAME_RACE_NAMES, raceChoices, raceLabel } from "../formats/mod/races";
import { t, translate } from "../i18n";

let installed: readonly DataSetRace[] = [];

/** Make `races` the table of the data set in use (`[]` for the game's own, or none declared). */
export function installDataSetRaces(races: readonly DataSetRace[]): void {
  installed = races.map((r) => ({ ...r }));
}

/** The races the data set in use declares; empty for the game's own. */
export const dataSetRaces = (): readonly DataSetRace[] => installed;

/** A race byte named in English, as the plugin API and the persisted texts have it: the game's, the data set's, else `Race {n}`. */
export const dataSetRaceLabel = (value: number, races: readonly DataSetRace[] = installed): string => raceLabel(value, races);

/** A race byte as the chrome shows it: the game's in the language in use, the data set's as it spells it, else "Race {n}". */
export function raceText(value: number, races: readonly DataSetRace[] = installed): string {
  const game = GAME_RACE_NAMES[value];
  if (game !== undefined) return translate(game);
  return races.find((r) => r.id === value)?.name ?? t("Race {n}", { n: value });
}

/**
 * The choices a race select offers: the game's eight, then the data set's, and `keep` (a value a map holds that is
 * neither) as "Race {n}" so it stays selected and is written back as it was. Labels are for a `Select`, which shows
 * them through `translate`.
 */
export function raceOptions(keep: number | null = null, races: readonly DataSetRace[] = installed): { value: number; label: string }[] {
  const list = raceChoices(races);
  if (keep !== null && !list.some((o) => o.value === keep)) list.push({ value: keep, label: t("Race {n}", { n: keep }) });
  return list;
}
