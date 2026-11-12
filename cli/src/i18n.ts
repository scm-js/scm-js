/**
 * The command's own words in the reader's language — the editor's translator (`src/i18n/index.ts`) over a catalogue
 * of the command's own, `cli/src/ko.json`.
 *
 * The rules are the editor's: the English text is the key, `t("…")` takes a literal (`npm run i18n` reads them out of
 * `cli/src` into this catalogue, as it reads `src/` into the editor's), a string kept in a table is `msg("…")` where
 * written and `translate(value)` where shown, and nothing calls `t` at module scope — the language is fixed by
 * `main.ts` before it builds the program, after every module has been evaluated. A text the command's catalogue does
 * not have is looked up in the editor's, so Check Map's findings, the game's names and the editor's table labels
 * (`where` of a finding, tileset names) come out in the same language.
 *
 * What stays English, whatever the language: `--json` keys, the files the command writes (a dump, a baseline, a
 * README, a workflow, a test file), map text, and the MCP server and language server (main.ts sets English for them).
 */
import { renderMessage, type ModMessage } from "@scm-js/mod";
import { format, isLocale, locale, setLocale, translate as editorText, type Locale, type Params } from "../../src/i18n";
import ko from "./ko.json";

export { locale, setLocale, type Locale };

const catalogues: Record<Locale, Record<string, string>> = { en: {}, ko };

/** The text in the reader's language, with its placeholders filled (`{name}`, ICU plurals, Korean particles). */
export function t(text: string, params?: Params): string {
  return inLanguage(text, params);
}

function inLanguage(text: string, params?: Params): string {
  const hit = catalogues[locale()][text];
  return hit ? format(hit, params, locale()) : editorText(text, params);
}

/** Marks a string in a table for translation; identity at run time. Shown through `translate`. */
export function msg(text: string): string {
  return text;
}

/** `t` for a text that is not a literal here: a `msg()` in a table, or one of the editor's (a finding's `where`). */
export function translate(text: string, params?: Params): string {
  return inLanguage(text, params);
}

/**
 * A sentence `@scm-js/mod` hands over as data (an error's `detail`, a line of what it said of a mod), in the reader's
 * language: its English template looked up as any other text, a parameter that is itself a sentence the same way. The
 * catalogue holds every template of `MOD_MESSAGES` (`npm run i18n` adds them for a tree that imports the package).
 * An archive that could not be opened carries the reason twice: `why`, the archive library's English text, which the
 * English sentence shows, and `reason`, the same as a sentence of the package's, which a translation shows instead
 * (where a message has no `reason`, `why` stands in for it).
 */
export function modText(message: ModMessage): string {
  return renderMessage(message, (template, params) => inLanguage(template, "why" in params && !("reason" in params) ? { ...params, reason: params.why } : params));
}

/** A language tag (`ko`, `ko-KR`, `ko_KR.UTF-8`) as one of ours, or null. */
function localeOf(tag: string | undefined): Locale | null {
  const primary = (tag ?? "").trim().toLowerCase().split(/[-_.@]/)[0];
  return isLocale(primary) ? primary : null;
}

/**
 * The language the command speaks: `--lang ko|en` (or `--lang=ko`) anywhere before `--`, else `SCMJS_LANG`, else the
 * POSIX locale (the first of `LC_ALL`, `LC_MESSAGES`, `LANG` that is set: Korean when it starts with `ko`), else the
 * system's as Node's Intl reads it (Windows has no `LANG`), else English. Read from the arguments rather than from
 * commander, because the help's descriptions are made in the language when the program is built.
 */
export function chooseLocale(args: readonly string[], env: Record<string, string | undefined> = process.env, system: string | undefined = systemLanguage()): Locale {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") break;
    if (a === "--lang") return localeOf(args[i + 1]) ?? "en";
    if (a.startsWith("--lang=")) return localeOf(a.slice("--lang=".length)) ?? "en";
  }
  if (env.SCMJS_LANG) return localeOf(env.SCMJS_LANG) ?? "en";
  const posix = env.LC_ALL || env.LC_MESSAGES || env.LANG;
  if (posix) return localeOf(posix) === "ko" ? "ko" : "en";
  return localeOf(system) ?? "en";
}

/**
 * `SCMJS_LANG` when it names a language this does not speak and decides (no `--lang` given): the command speaks
 * English then, and says so once (`--lang xx` is refused by the option itself).
 */
export function unknownLanguage(args: readonly string[], env: Record<string, string | undefined> = process.env): string | null {
  for (const a of args) {
    if (a === "--") break;
    if (a === "--lang" || a.startsWith("--lang=")) return null;
  }
  return env.SCMJS_LANG && !localeOf(env.SCMJS_LANG) ? env.SCMJS_LANG : null;
}

function systemLanguage(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return undefined; }
}

/** Runs `fn` in English and goes back to the language before: a finding's identity in a baseline file is its English text. */
export function inEnglish<T>(fn: () => T): T {
  const was = locale();
  setLocale("en");
  try { return fn(); } finally { setLocale(was); }
}

