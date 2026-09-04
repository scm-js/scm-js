/**
 * The Markdown half of `scripts/build-docs.mjs`: splitting the repository's own guides
 * into pages, and rendering them.
 *
 * Nothing here writes documentation. `README.md` is the map-maker's guide and
 * `docs/*.md` the technical companions, and they stay the source — this turns them into
 * a site so the same words can be read at a URL instead of on a GitHub blob page. A
 * generator that *wrote* prose would be a fifth thing to keep current; a generator that
 * renders what is already maintained is not.
 *
 * A guide is split at its `##` headings, one page each, because `README.md` alone is 800
 * lines and "Working in the editor" is half of it. The `###` beneath a `##` become the
 * page's own contents list, which is what a heading three levels down is for.
 */
import { Marked } from "marked";

/**
 * GitHub's heading slug, which is what the source documents' own `#fragment` links
 * already point at: lower case, punctuation dropped, spaces to hyphens.
 */
export function slug(text) {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/ +/g, "-");
}

/** Strip the inline markup a heading may carry, so it can be a title and a slug. */
export function plainText(md) {
  return md
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

/**
 * Headings outside fenced code. The fences matter: `docs/development.md` has shell
 * blocks full of `# comments`, and every one of them would otherwise become a page.
 */
export function headingsIn(source) {
  const out = [];
  let fence = null;
  for (const line of source.split("\n")) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) { fence = fence ? null : f[1][0]; continue; }
    if (fence) continue;
    const h = /^(#{1,6}) +(.*?)\s*#*\s*$/.exec(line);
    if (h) out.push({ depth: h[1].length, text: plainText(h[2]), slug: slug(plainText(h[2])) });
  }
  return out;
}

/**
 * One guide split into pages: the `#` title, whatever comes before the first `##`, and a
 * page per `##`. A document with no `##` at all is one page — nothing in this repository
 * is shaped that way, but a generator that dropped the body of one would be a silent
 * hole in the site rather than an error.
 */
export function splitPages(source) {
  const lines = source.split("\n");
  let title = "";
  const intro = [];
  const sections = [];
  let current = null;
  let fence = null;
  for (const line of lines) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) fence = fence ? null : f[1][0];
    if (!fence) {
      const h1 = /^# +(.*)$/.exec(line);
      if (h1 && !title) { title = plainText(h1[1]); continue; }
      const h2 = /^## +(.*)$/.exec(line);
      if (h2) {
        const text = plainText(h2[1]);
        current = { title: text, slug: slug(text), lines: [] };
        sections.push(current);
        continue;
      }
    }
    (current ? current.lines : intro).push(line);
  }
  return {
    title,
    intro: intro.join("\n").trim(),
    sections: sections.map((s) => ({ title: s.title, slug: s.slug, body: s.lines.join("\n").trim() })),
  };
}

/**
 * Markdown to HTML.
 *
 * `rewriteLink(href)` is where a relative `docs/plugins.md` becomes a page on this site
 * and everything else in the repository becomes a link to GitHub — see `links.mjs`.
 * `shift` moves the heading levels, because a page's own `<h1>` is the `##` it was split
 * at, so its `###` have to render as `<h2>` rather than starting a second level 3.
 */
export function renderMarkdown(source, { rewriteLink = (h) => h, shift = 0, headingIds = true } = {}) {
  const seen = new Map();
  const marked = new Marked({ gfm: true }, {
    walkTokens: (token) => {
      if (token.type === "link" || token.type === "image") token.href = rewriteLink(token.href) ?? token.href;
    },
  });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const level = Math.min(6, Math.max(1, depth + shift));
        if (!headingIds) return `<h${level}>${inner}</h${level}>\n`;
        // The id is the source heading's own slug, so a `#fragment` written in one of
        // these documents still lands where it did on GitHub. A repeat gets a suffix.
        const base = slug(plainText(tokens.map((t) => t.raw ?? "").join("")));
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        const id = n === 1 ? base : `${base}-${n}`;
        return `<h${level} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>\n`;
      },
    },
  });
  return marked.parse(source).trim();
}
