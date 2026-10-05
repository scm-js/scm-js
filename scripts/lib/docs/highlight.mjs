/**
 * Code colouring for the documentation site: the reference's signatures and examples, and
 * the fenced blocks of the guides.
 *
 * Regular expressions, not a grammar. The site is static files with no dependency beyond
 * `marked`, the blocks are short examples, and what a reader needs is to tell a comment
 * from a string from a call at a glance — not a parse.
 */

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const KEYWORDS = new Set([
  "interface", "type", "const", "let", "var", "function", "return", "import", "export", "from", "as", "await", "async",
  "new", "class", "extends", "implements", "readonly", "declare", "keyof", "typeof", "in", "of", "is", "infer", "this",
  "null", "undefined", "true", "false", "void", "never", "unknown", "any", "string", "number", "boolean", "object",
  "symbol", "bigint", "if", "else", "for", "while", "switch", "case", "break", "continue", "default", "throw", "try",
  "catch", "finally", "Promise", "Partial", "Omit", "Pick", "Record", "Array", "Readonly",
]);

const TOKENS = /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)/g;

/**
 * A small TypeScript colouriser, and the only reason it exists is the links: a type in a
 * signature is the reader's next question, so every name the bundle declares becomes a
 * link to where it is documented. `urlFor(name)` answers null for a name with no page.
 */
export function highlight(code, { names = new Set(), urlFor = () => null } = {}) {
  let out = "";
  let at = 0;
  for (const m of code.matchAll(TOKENS)) {
    out += escapeHtml(code.slice(at, m.index));
    at = m.index + m[0].length;
    const [, line, block, str, num, ident] = m;
    if (line || block) out += `<span class="c">${escapeHtml(m[0])}</span>`;
    else if (str) out += `<span class="s">${escapeHtml(str)}</span>`;
    else if (num) out += `<span class="n">${escapeHtml(num)}</span>`;
    else if (ident) {
      const href = names.has(ident) ? urlFor(ident) : null;
      if (href) out += `<a class="t" href="${href}">${escapeHtml(ident)}</a>`;
      else if (KEYWORDS.has(ident)) out += `<span class="k">${escapeHtml(ident)}</span>`;
      else out += escapeHtml(ident);
    }
  }
  return out + escapeHtml(code.slice(at));
}

/**
 * The other languages the guides' fences name: one expression each, its groups in the
 * order of the classes beside it. A string stops at the end of its line, so the
 * apostrophe in a shell comment's prose cannot swallow the lines after it.
 */
const STRING = `("(?:\\\\.|[^"\\\\\\n])*"|'[^'\\n]*')`;
const HASH_COMMENT = `((?<=^|\\s)#[^\\n]*)`;
const MODES = {
  sh: [new RegExp(`${HASH_COMMENT}|${STRING}`, "gm"), ["c", "s"]],
  // A key is the name before the colon that opens a line, after a list dash or not.
  yaml: [new RegExp(`${HASH_COMMENT}|${STRING}|((?<=^[ \\t]*(?:- )?)[\\w.-]+(?=:))`, "gm"), ["c", "s", "k"]],
  // The trigger text format: a condition's or action's name runs up to its bracket, spaces included.
  trigedit: [new RegExp(`(//[^\\n]*)|${STRING}|((?<=^[ \\t]*)[A-Za-z][A-Za-z ]*(?=\\())|(\\b\\d+\\b)`, "gm"), ["c", "s", "f", "n"]],
};

const ALIASES = {
  ts: "ts", typescript: "ts", tsx: "ts", js: "ts", javascript: "ts", jsx: "ts", json: "ts",
  sh: "sh", bash: "sh", shell: "sh", zsh: "sh",
  yaml: "yaml", yml: "yaml",
  trigedit: "trigedit",
};

/**
 * A fenced block's HTML by the language its fence names, or null for a language with no
 * colouring here (`text`, or no language at all) — the caller leaves that block as it was.
 * `opts` is `highlight`'s, and only the TypeScript family links names.
 */
export function highlightAs(lang, code, opts) {
  const mode = ALIASES[(lang ?? "").toLowerCase()];
  if (!mode) return null;
  if (mode === "ts") return highlight(code, opts);
  const [pattern, classes] = MODES[mode];
  let out = "";
  let at = 0;
  for (const m of code.matchAll(pattern)) {
    out += escapeHtml(code.slice(at, m.index));
    at = m.index + m[0].length;
    const cls = classes[m.slice(1).findIndex((g) => g !== undefined)];
    out += `<span class="${cls}">${escapeHtml(m[0])}</span>`;
  }
  return out + escapeHtml(code.slice(at));
}
