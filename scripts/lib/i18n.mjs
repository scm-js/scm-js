/**
 * The strings the editor asks to have translated, read out of the source.
 *
 * `extractMessages` walks `src/` with the TypeScript compiler (already a dependency —
 * a regular expression would miss a call split over lines and misread a string with an
 * escaped quote) and records every `t("…")`, `tc("context", "…")` and `msg("…")`
 * call whose text is a string literal. A call with anything else in that place — a
 * variable, a template with `${}` in it — is an error: the extractor cannot know what
 * the text will be, so the translator could never see it. `checkCatalogue` compares a
 * language file against what was found: keys nothing asks for, keys with no entry, and
 * translations whose placeholders are not the source's. `scripts/i18n.mjs` is the
 * command over both; `tests/i18n.test.ts` runs the check.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const CONTEXT_SEPARATOR = "\u0004";
const CALLS = new Set(["t", "tc", "msg"]);

/** The catalogue key for a text, with its context in front when it has one — the same rule as `src/i18n/index.ts`. */
export function messageKey(text, context) {
  return context ? `${context}${CONTEXT_SEPARATOR}${text}` : text;
}

export function splitKey(key) {
  const at = key.indexOf(CONTEXT_SEPARATOR);
  return at < 0 ? { context: "", text: key } : { context: key.slice(0, at), text: key.slice(at + 1) };
}

function* sourceFiles(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { yield* sourceFiles(path); continue; }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || name.endsWith(".d.ts")) continue;
    yield path;
  }
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/**
 * Every message in one source text: `{ key, text, context, line }` per call, and an
 * error per call whose text is not a literal.
 */
export function messagesIn(source, fileName = "source.ts") {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const messages = [];
  const errors = [];
  // Only a file that imports the module can be calling its `t`; anywhere else a `t` is
  // some local of that name (a trigger, a tile) and none of this applies.
  const usesI18n = file.statements.some((st) => ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && /(^|\/)i18n(\/[a-z]+)?$/.test(st.moduleSpecifier.text));
  if (!usesI18n) return { messages, errors };
  const lineOf = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && CALLS.has(node.expression.text)) {
      const name = node.expression.text;
      const args = node.arguments;
      const textArg = name === "tc" ? args[1] : args[0];
      const contextArg = name === "tc" ? args[0] : undefined;
      const text = textArg ? literalText(textArg) : null;
      const context = contextArg ? literalText(contextArg) : "";
      if (text === null || context === null) {
        errors.push({ file: fileName, line: lineOf(node), reason: `${name}() takes a string literal, so the translator can see the text` });
      } else {
        messages.push({ key: messageKey(text, context), text, context, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { messages, errors };
}

/**
 * Every message under `root` (a `src/` directory), keyed, with the places it is used.
 * Returns `{ messages: Map<key, { text, context, uses: ["file:line", …] }>, errors }`.
 */
export function extractMessages(root) {
  const messages = new Map();
  const errors = [];
  for (const path of sourceFiles(root)) {
    const rel = relative(root, path).replace(/\\/g, "/");
    const found = messagesIn(readFileSync(path, "utf8"), rel);
    for (const m of found.messages) {
      const entry = messages.get(m.key) ?? { text: m.text, context: m.context, uses: [] };
      entry.uses.push(`${rel}:${m.line}`);
      messages.set(m.key, entry);
    }
    errors.push(...found.errors);
  }
  return { messages, errors };
}

/** The placeholder names a message uses — the same reading as `placeholderNames` in `src/i18n/index.ts`. */
export function placeholderNames(message) {
  const names = [];
  const add = (n) => { if (n && !names.includes(n)) names.push(n); };
  const matchBrace = (s, open) => {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}" && --depth === 0) return i;
    }
    return -1;
  };
  const branches = (options) => {
    const out = [];
    let i = 0;
    while (i < options.length) {
      const open = options.indexOf("{", i);
      if (open < 0) break;
      const close = matchBrace(options, open);
      if (close < 0) break;
      out.push(options.slice(open + 1, close));
      i = close + 1;
    }
    return out;
  };
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
      if (comma2 >= 0) for (const branch of branches(inner.slice(comma2 + 1))) for (const n of placeholderNames(branch)) add(n);
    }
    i = close + 1;
  }
  return names;
}

/**
 * A catalogue against the extracted messages: `missing` keys the source asks for and the
 * file lacks, `unused` keys the file has and nothing asks for, `untranslated` keys whose
 * entry is empty (they show in English; allowed, so a string can be added before its
 * translation), and `mismatched` entries whose placeholders are not the source's.
 */
export function checkCatalogue(messages, catalogue) {
  const missing = [];
  const unused = [];
  const untranslated = [];
  const mismatched = [];
  for (const [key, { text }] of messages) {
    if (!(key in catalogue)) { missing.push(key); continue; }
    const translation = catalogue[key];
    if (!translation) { untranslated.push(key); continue; }
    const want = placeholderNames(text).sort();
    const have = placeholderNames(translation).sort();
    if (want.join("\0") !== have.join("\0")) mismatched.push({ key, want, have });
  }
  for (const key of Object.keys(catalogue)) if (!messages.has(key)) unused.push(key);
  return { missing, unused, untranslated, mismatched };
}

/**
 * The catalogue brought up to date: every extracted key present (a new one empty), every
 * key nothing asks for dropped, and the keys in source order so a diff reads as the
 * source changed. Existing translations are kept as they are.
 */
export function updatedCatalogue(messages, catalogue) {
  const out = {};
  for (const key of messages.keys()) out[key] = catalogue[key] ?? "";
  return out;
}
