/**
 * The editor's own words in the user's language.
 *
 * The English text is the key: `t("Save {name}", { name })` reads as it did before, an
 * untranslated string falls back to itself, and editing the English deliberately orphans
 * the Korean — the correct failure, and one `npm run i18n` reports. A catalogue is one
 * flat JSON object per language under `src/i18n/`, its keys the English text (with a
 * context in front, gettext-style, where one English word has two meanings:
 * `tc("menu", "Open")`). `scripts/i18n.mjs` keeps the catalogues' key sets equal to the
 * `t()` / `tc()` / `msg()` calls in the source, and `tests/i18n.test.ts` fails when
 * they have drifted.
 *
 * A message is a small subset of ICU MessageFormat: `{name}`, `{n, plural, one {# map}
 * other {# maps}}` (`=0` exact matches too; `#` is the number), `{x, select, a {…}
 * other {…}}`. Plural categories come from `Intl.PluralRules`, so Korean, which has
 * none, writes only `other`. Korean also needs its particles to agree with the word in
 * front: `{name|을}` appends 을 or 를 (or 이/가, 은/는, 과/와, 으로/로) by the last
 * syllable of the value, so a translation never has to write "{name}(을)를".
 *
 * No library: the platform's `Intl` does the parts that need data, and the rest is a
 * hundred lines here. `t` outside React reads the locale `setLocale` last set (the
 * preference, applied at startup and on change); a component uses `useT` so it
 * re-renders when the language changes.
 */
import ko from "./ko.json";

export type Locale = "en" | "ko";
/** `"auto"` follows the browser (or the desktop app's system language). */
export type LanguagePreference = "auto" | Locale;

export const LOCALES: readonly { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ko", label: "한국어" },
];

export type Catalogue = Record<string, string>;
export type Params = Record<string, string | number>;

const catalogues: Record<Locale, Catalogue> = { en: {}, ko };

let current: Locale = "en";
const listeners = new Set<() => void>();

export function locale(): Locale {
  return current;
}

export function setLocale(next: Locale) {
  if (next === current) return;
  current = next;
  for (const fn of listeners) fn();
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((l) => l.id === value);
}

/** The locale a preference means, given what the browser reports (`navigator.language`). */
export function resolveLocale(preference: LanguagePreference, browserLanguage: string | undefined): Locale {
  if (preference !== "auto") return preference;
  const tag = (browserLanguage ?? "").toLowerCase();
  const primary = tag.split("-")[0];
  return isLocale(primary) ? primary : "en";
}

/** gettext's separator between a context and its text, so a plain text is never a context by accident. */
const CONTEXT_SEPARATOR = "\u0004";

/** The catalogue key for a text, with its context in front when it has one. */
export function messageKey(text: string, context?: string): string {
  return context ? `${context}${CONTEXT_SEPARATOR}${text}` : text;
}

function lookup(key: string, fallback: string): string {
  const hit = catalogues[current][key];
  return hit ? hit : fallback;
}

/** The text in the current language, with its placeholders filled. */
export function t(text: string, params?: Params): string {
  return format(lookup(text, text), params, current);
}

/** `t` with a context: the same English words translated differently in two places. */
export function tc(context: string, text: string, params?: Params): string {
  return format(lookup(messageKey(text, context), text), params, current);
}

/**
 * Marks a string in a table for translation without translating it there — the table
 * keeps the English and whatever shows it calls `translate()` on the value.
 * `TEXT_ENCODINGS`' labels are the worked example. Identity at run time; the extractor
 * sees the call.
 */
export function msg(text: string): string {
  return text;
}

/**
 * `t` for a text that is not a literal here — one `msg()` marked in a table. The same
 * lookup; a different name so the extractor knows not to expect a literal.
 */
export function translate(text: string, params?: Params): string {
  return t(text, params);
}

/* ── Formatting ─────────────────────────────────────────── */

/** The index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Korean particles that change with the syllable before them: (after a final consonant, after a vowel). */
const JOSA: Record<string, [string, string]> = {
  "을": ["을", "를"], "를": ["을", "를"],
  "이": ["이", "가"], "가": ["이", "가"],
  "은": ["은", "는"], "는": ["은", "는"],
  "과": ["과", "와"], "와": ["과", "와"],
  "으로": ["으로", "로"], "로": ["으로", "로"],
};

/** `value` with the particle that follows it — decided by the last syllable, and left unchanged for text that is not Hangul. */
export function josa(value: string, particle: string): string {
  const pair = JOSA[particle];
  if (!pair) return value + particle;
  const last = value.codePointAt(value.length - 1) ?? 0;
  if (last < 0xac00 || last > 0xd7a3) return value + particle;
  const final = (last - 0xac00) % 28; // 0 = open syllable; 8 = ㄹ
  const vowelLike = final === 0 || (particle.endsWith("로") && final === 8);
  return value + (vowelLike ? pair[1] : pair[0]);
}

/**
 * `{name}`, `{n, plural, …}`, `{x, select, …}` and `{name|을}` filled from `params`. A
 * placeholder with no value stays as written, so a missing argument is visible rather
 * than blank. Text outside braces is copied as it is; there is no escape, because no
 * message the editor shows has a literal brace.
 */
export function format(message: string, params: Params | undefined, loc: Locale = current): string {
  if (!message.includes("{")) return message;
  let out = "";
  let i = 0;
  while (i < message.length) {
    const open = message.indexOf("{", i);
    if (open < 0) { out += message.slice(i); break; }
    const close = matchBrace(message, open);
    if (close < 0) { out += message.slice(i); break; }
    out += message.slice(i, open);
    out += placeholder(message.slice(open + 1, close), params, loc);
    i = close + 1;
  }
  return out;
}

function placeholder(inner: string, params: Params | undefined, loc: Locale): string {
  const comma = inner.indexOf(",");
  if (comma < 0) {
    const bar = inner.indexOf("|");
    const name = (bar < 0 ? inner : inner.slice(0, bar)).trim();
    const value = params?.[name];
    if (value === undefined) return `{${inner}}`;
    // As typed: an id, an offset or a map size must not gain grouping separators. `#` in a plural is the formatted one.
    const text = String(value);
    return bar < 0 ? text : josa(text, inner.slice(bar + 1).trim());
  }
  const name = inner.slice(0, comma).trim();
  const rest = inner.slice(comma + 1);
  const comma2 = rest.indexOf(",");
  if (comma2 < 0) return `{${inner}}`;
  const kind = rest.slice(0, comma2).trim();
  const options = rest.slice(comma2 + 1);
  const value = params?.[name];
  if (value === undefined) return `{${inner}}`;
  const branches = parseBranches(options);
  let branch: string | undefined;
  if (kind === "plural" && typeof value === "number") {
    branch = branches.get(`=${value}`) ?? branches.get(new Intl.PluralRules(loc).select(value)) ?? branches.get("other");
    if (branch === undefined) return `{${inner}}`;
    return format(branch.replace(/#/g, new Intl.NumberFormat(loc).format(value)), params, loc);
  }
  if (kind === "select") {
    branch = branches.get(String(value)) ?? branches.get("other");
    if (branch === undefined) return `{${inner}}`;
    return format(branch, params, loc);
  }
  return `{${inner}}`;
}

/** `one {# map} other {# maps}` as a map of key to branch text. */
function parseBranches(options: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < options.length) {
    const open = options.indexOf("{", i);
    if (open < 0) break;
    const close = matchBrace(options, open);
    if (close < 0) break;
    const key = options.slice(i, open).trim();
    if (key) out.set(key, options.slice(open + 1, close));
    i = close + 1;
  }
  return out;
}

/* ── For the extractor's checks, and plugins ────────────── */

/** The placeholder names a message uses, in order of first appearance — what a translation must keep. */
export function placeholderNames(message: string): string[] {
  const names: string[] = [];
  const add = (n: string) => { if (n && !names.includes(n)) names.push(n); };
  let i = 0;
  while (i < message.length) {
    const open = message.indexOf("{", i);
    if (open < 0) break;
    const close = matchBrace(message, open);
    if (close < 0) break;
    const inner = message.slice(open + 1, close);
    const comma = inner.indexOf(",");
    if (comma < 0) {
      const bar = inner.indexOf("|");
      add((bar < 0 ? inner : inner.slice(0, bar)).trim());
    } else {
      add(inner.slice(0, comma).trim());
      // The branches of a plural / select carry placeholders of their own; the keys do not.
      const comma2 = inner.indexOf(",", comma + 1);
      if (comma2 >= 0) for (const branch of parseBranches(inner.slice(comma2 + 1)).values()) for (const n of placeholderNames(branch)) add(n);
    }
    i = close + 1;
  }
  return names;
}

/**
 * A `t` over a catalogue of its own — a plugin's, registered through `api.i18n`. The
 * catalogue is keyed by locale; a locale it lacks falls back to the English text.
 */
export function makeTranslator(catalogueOf: (loc: Locale) => Catalogue | undefined) {
  const look = (key: string, fallback: string) => catalogueOf(current)?.[key] || fallback;
  return {
    t: (text: string, params?: Params) => format(look(text, text), params, current),
    tc: (context: string, text: string, params?: Params) => format(look(messageKey(text, context), text), params, current),
  };
}
