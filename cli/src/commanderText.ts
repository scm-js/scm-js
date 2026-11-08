/**
 * commander's own words — the help's titles, the `(default: …)` after an option, its error messages — in the reader's
 * language. commander writes them in English with no hook for a catalogue, so they are recognised in what it hands
 * over: a title through `styleTitle`, an option's extras through `optionDescription`, an error through `outputError`.
 * A message this does not know stays commander's English.
 */
import { msg, t, translate } from "./i18n";

/** The titles commander writes, for `styleTitle` to show through `translate`. */
export const TITLES = [msg("Usage:"), msg("Options:"), msg("Arguments:"), msg("Commands:"), msg("Global Options:")];

/** A help title in the reader's language: commander's own, or a group heading the program already made in it. */
export const helpTitle = (title: string) => translate(title);

/** The `(default: …, choices: …)` commander puts after an option's or argument's description. */
export function helpExtras(description: string): string {
  return description.replace(/\((?:default|choices|preset|env): [^)]*\)$/, (extras) => extras
    .replace(/\bdefault: /, t("default: "))
    .replace(/\bchoices: /, t("choices: "))
    .replace(/\bpreset: /, t("preset: "))
    .replace(/\benv: /, t("env: ")));
}

/** commander's suggestion after an unknown command or option, which comes on a line of its own. */
function suggestion(text: string): string {
  return text
    .replace(/\(Did you mean one of (.*)\?\)/, (_, list: string) => t("(Did you mean one of {list}?)", { list }))
    .replace(/\(Did you mean (.*)\?\)/, (_, name: string) => t("(Did you mean {name}?)", { name }));
}

/** An error commander raised (without its `error: `), in the reader's language. */
export function commanderError(text: string): string {
  const [first, ...rest] = text.split("\n");
  const said = errorLine(first);
  return [said, ...rest.map(suggestion)].join("\n");
}

function errorLine(line: string): string {
  let m: RegExpExecArray | null;
  if ((m = /^unknown option '(.*)'$/.exec(line))) return t("unknown option '{name}'", { name: m[1] });
  if ((m = /^unknown command '(.*)'$/.exec(line))) return t("unknown command '{name}'", { name: m[1] });
  if ((m = /^missing required argument '(.*)'$/.exec(line))) return t("missing required argument '{name}'", { name: m[1] });
  if ((m = /^option '(.*)' argument missing$/.exec(line))) return t("option '{flags}' needs a value", { flags: m[1] });
  if ((m = /^required option '(.*)' not specified$/.exec(line))) return t("required option '{flags}' not given", { flags: m[1] });
  if ((m = /^too many arguments(?: for '(.*)')?\. Expected (\d+) arguments? but got (\d+): (.*)\.$/.exec(line))) {
    return m[1]
      ? t("too many arguments for '{command}': {expected} expected, {got} given: {list}.", { command: m[1], expected: m[2], got: m[3], list: m[4] })
      : t("too many arguments: {expected} expected, {got} given: {list}.", { expected: m[2], got: m[3], list: m[4] });
  }
  if ((m = /^option '(.*)' argument '(.*)' is invalid\. Allowed choices are (.*)\.$/.exec(line))) return t("option '{flags}' does not take '{value}': it takes {choices}.", { flags: m[1], value: m[2], choices: m[3] });
  if ((m = /^command-argument value '(.*)' is invalid for argument '(.*)'\. Allowed choices are (.*)\.$/.exec(line))) return t("'{value}' is not one of {choices} ({name}).", { value: m[1], name: m[2], choices: m[3] });
  if ((m = /^(.*) cannot be used with (.*)$/.exec(line))) return t("{a} cannot be used with {b}", { a: m[1], b: m[2] });
  return line;
}
