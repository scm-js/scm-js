/**
 * HTML for the documentation site: the page shell, the navigation, and the API
 * reference's own pages.
 *
 * Plain strings and plain CSS, like `scm-js/site` — this is a static site of a few dozen
 * pages read once and linked to, and a framework would be more machinery than the thing
 * it builds. The stylesheet is `assets/docs.css` beside this file, in the editor's own
 * palette.
 */
import { renderMarkdown } from "./markdown.mjs";

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

/** `<pre>` for a signature or an example. */
export function codeBlock(code, opts) {
  return `<pre class="code"><code>${highlight(code, opts)}</code></pre>`;
}

/**
 * The shell. `nav` is the whole site's tree with the current page marked, so every page
 * carries the same sidebar and nothing has to be generated per section.
 */
export function page({ title, description, url, body, nav, toc = "", version = "", editorUrl, repoUrl, base = "" }) {
  const heading = title === "scmJS documentation" ? title : `${title} — scmJS documentation`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<meta name="description" content="${escapeHtml(description ?? "")}">
<meta property="og:title" content="${escapeHtml(heading)}">
<meta property="og:description" content="${escapeHtml(description ?? "")}">
<meta property="og:type" content="website">
<link rel="icon" href="${base}/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}/docs.css">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<input type="checkbox" id="menu" class="menu-toggle" hidden>
<header class="top">
  <a class="brand" href="${base}/">
    <img src="${base}/logo.svg" alt="" width="26" height="26">
    <span class="brand-name">scm<b>JS</b></span>
    <span class="brand-sub">docs</span>
  </a>
  <div class="search">
    <input id="q" type="search" placeholder="Search the docs…  /" autocomplete="off" spellcheck="false" aria-label="Search" data-base="${base}">
    <div id="results" hidden></div>
  </div>
  <label class="menu-button" for="menu" aria-label="Menu">Menu</label>
  <nav class="top-links">
    <a href="${editorUrl}">Editor</a>
    <a href="${repoUrl}">GitHub</a>
  </nav>
</header>
<div class="shell">
  <nav class="side" aria-label="Documentation">${nav}</nav>
  <main id="content">
${body}
${footer(version, repoUrl, url)}
  </main>
  ${toc}
</div>
<script src="${base}/search.js" defer></script>
</body>
</html>
`;
}

function footer(version, repoUrl, url) {
  const source = url ? `<a href="${repoUrl}">the repository</a>` : "";
  return `<footer class="page-foot">
  <p>${version ? `scmJS ${escapeHtml(version)} · ` : ""}Generated from ${source}. StarCraft and Brood War are trademarks of Blizzard Entertainment; this project ships none of their data.</p>
</footer>`;
}

/** The sidebar: every section, with the current one open. */
export function navHtml(tree, currentUrl, base = "") {
  const parts = [];
  for (const section of tree) {
    const open = section.pages.some((p) => p.url === currentUrl) || section.url === currentUrl;
    parts.push(`<div class="nav-group${open ? " open" : ""}">`);
    parts.push(`<a class="nav-head${section.url === currentUrl ? " here" : ""}" href="${base}${section.url}">${escapeHtml(section.title)}</a>`);
    if (section.pages.length > 0) {
      parts.push("<ul>");
      for (const p of section.pages) {
        parts.push(`<li><a class="${p.url === currentUrl ? "here" : ""}" href="${base}${p.url}">${escapeHtml(p.title)}</a></li>`);
      }
      parts.push("</ul>");
    }
    parts.push("</div>");
  }
  return parts.join("\n");
}

/** The right-hand contents list, for a page with enough headings to be worth one. */
export function tocHtml(headings) {
  if (headings.length < 2) return "";
  const items = headings.map((h) => `<li><a href="#${h.slug}">${escapeHtml(h.text)}</a></li>`).join("\n");
  return `<aside class="toc" aria-label="On this page"><p class="toc-title">On this page</p><ul>\n${items}\n</ul></aside>`;
}

/* ── the API reference's pages ─────────────────────────────────────────────── */

/** One member of an API group, or of a type: signature, prose, examples. */
export function memberHtml(member, opts) {
  const id = opts.idFor(member.name);
  const summary = member.summary ? renderMarkdown(member.summary, { shift: 3, headingIds: false, rewriteLink: opts.rewriteLink }) : "";
  const examples = member.examples.map((ex) => codeBlock(ex, opts)).join("\n");
  const tags = member.tags
    .filter((t) => t.name !== "param" && t.name !== "returns")
    .map((t) => `<p class="tag"><span>@${escapeHtml(t.name)}</span> ${escapeHtml(t.text)}</p>`)
    .join("\n");
  return `<div class="member" id="${id}">
  <h3><a class="anchor-name" href="#${id}">${escapeHtml(member.name)}</a>${member.optional ? '<span class="opt">optional</span>' : ""}</h3>
  ${codeBlock(member.signature, opts)}
  ${summary}
  ${examples}
  ${tags}
</div>`;
}

/** A supporting type: the declaration as written, plus its members when it is an interface. */
export function typeHtml(decl, opts) {
  const id = opts.idFor(decl.name);
  const summary = decl.summary ? renderMarkdown(decl.summary, { shift: 3, headingIds: false, rewriteLink: opts.rewriteLink }) : "";
  const head = decl.kind === "interface"
    ? codeBlock(`interface ${decl.name}`, opts)
    : codeBlock(decl.signature, opts);
  const members = decl.members.length > 0
    ? `<table class="fields"><tbody>${decl.members.map((m) => fieldRow(m, opts)).join("\n")}</tbody></table>`
    : "";
  const examples = decl.examples.map((ex) => codeBlock(ex, opts)).join("\n");
  return `<div class="type" id="${id}">
  <h3><a class="anchor-name" href="#${id}">${escapeHtml(decl.name)}</a><span class="kind">${decl.kind}</span></h3>
  ${head}
  ${summary}
  ${members}
  ${examples}
</div>`;
}

function fieldRow(member, opts) {
  const doc = member.summary ? renderMarkdown(member.summary, { shift: 4, headingIds: false, rewriteLink: opts.rewriteLink }) : "";
  return `<tr><th><code>${highlight(member.signature.replace(/;$/, ""), opts)}</code></th><td>${doc}</td></tr>`;
}
