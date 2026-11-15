/**
 * What an option's value may be, read one way by every command: a whole number, a length of game (frames, or a
 * time), a race. A command that reads `--frames`, `--seed`, `--from` or `--race` reads it here, so `0:20` or `t`
 * means the same thing wherever it is typed and a bad value is refused the same way (exit 2) before anything runs.
 */
import { t } from "./i18n";
import { raceLetter, type RaceLetter } from "./ladder";
import { CliError } from "./ui";
import { parseClock } from "./watch";

/** `--seed 7`, `--games 3`: a whole number of `least` or more. `name` is the option's, without the dashes. */
export function parseWhole(value: string, name: string, least = 0): number {
  const n = /^\s*-?\d+\s*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(n) || n < least) throw new CliError(least ? t("--{name} takes a whole number of {least} or more, not \"{value}\"", { name, least, value }) : t("--{name} takes a whole number, not \"{value}\"", { name, value }), null, 2);
  return n;
}

/**
 * `--frames 2400` or `--frames 1:40`: a length of game as frames. A bare number is frames (the option says so);
 * anything with a colon is a time on the game's clock, as `--from` and `--until` take it.
 */
export function parseFrames(value: string, name = "frames", least = 1): number {
  const spec = value.trim();
  if (spec.includes(":")) {
    let frames: number;
    try { frames = parseClock(spec, `--${name}`); } catch { throw new CliError(t("--{name} takes a number of frames or a time (m:ss), not \"{value}\"", { name, value }), null, 2); }
    if (frames < least) throw new CliError(t("--{name} takes a number of frames or a time (m:ss), not \"{value}\"", { name, value }), null, 2);
    return frames;
  }
  if (!/^\d+$/.test(spec)) throw new CliError(t("--{name} takes a number of frames or a time (m:ss), not \"{value}\"", { name, value }), null, 2);
  return parseWhole(spec, name, least);
}

const WORD: Record<RaceLetter, RaceWord> = { z: "zerg", t: "terran", p: "protoss", r: "random" };
export type RaceWord = "zerg" | "terran" | "protoss" | "random";

/** `--race t`, `--race Terran`: one race, as its letter. `option` is as typed, with its dashes. */
export function parseRace(value: string, option = "--race"): RaceLetter {
  const r = raceLetter(value);
  if (!r) throw new CliError(t("{option}: \"{value}\" is not a race", { option, value }), t("A race is zerg, terran, protoss or random, or its first letter: z, t, p, r."), 2);
  return r;
}

/** The same, as the word the game's runners take. */
export function parseRaceWord(value: string, option = "--race"): RaceWord { return WORD[parseRace(value, option)]; }
