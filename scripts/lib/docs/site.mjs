/**
 * What the documentation site is made of, and where every link in it points.
 *
 * The five guides are the repository's own — `README.md` and `docs/*.md` — split into
 * pages by `markdown.mjs`. This module is the map from a source file and a heading to a
 * URL on the site, which is the whole reason the links in those documents keep working:
 * a `[the plugin guide](docs/plugins.md)` written for a GitHub blob page has to become a
 * page here, and a `[LICENSE](LICENSE)` — a file the site does not render — has to
 * become a link back to the repository rather than a 404.
 */
import { headingsIn, slug, splitPages } from "./markdown.mjs";

export const REPO_URL = "https://github.com/scm-js/scm-js";

/**
 * The guides' pictures. `docs/images/` is copied onto the site whole, so a
 * `![...](docs/images/units.webp)` written for GitHub is served from `/images/` here
 * rather than sent back to a blob page, which would show the picture's *page* in place
 * of the picture.
 */
export const IMAGES_DIR = "docs/images";

/**
 * The site's sections, in nav order. `file` is repository-relative, which is also the
 * key a cross-document link resolves against.
 */
export const SOURCES = [
  {
    id: "guide",
    file: "README.md",
    title: "User guide",
    blurb: "What each layer does, how the editor is used, and the table of what is and is not implemented.",
  },
  {
    id: "plugins",
    file: "docs/plugins.md",
    title: "Plugins",
    blurb: "Installing plugins and what they may do, writing one, and a tour of the API.",
  },
  {
    id: "map-files",
    file: "docs/file-formats.md",
    title: "Map files",
    blurb: "The MPQ container, the CHK sections, and how much of a file the editor preserves.",
  },
  {
    id: "game-data",
    file: "docs/game-data.md",
    title: "Game data",
    blurb: "Where the graphics come from, how they are extracted, and what the editor does without them.",
  },
  {
    id: "development",
    file: "docs/development.md",
    title: "Development",
    blurb: "Building the editor and the desktop app, the release channels, and the repository layout.",
  },
];

/** `docs/plugins.md` + `../README.md` → `README.md`; a path that escapes the root is answered as null. */
export function resolvePath(fromFile, href) {
  const base = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")).split("/") : [];
  const parts = href.startsWith("/") ? href.slice(1).split("/") : [...base, ...href.split("/")];
  const out = [];
  let above = 0;
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (out.length > 0) out.pop(); else above += 1; continue; }
    out.push(part);
  }
  return { path: out.join("/"), above };
}

/** One source document, split into the pages the site serves. */
export function buildGuide(source, text) {
  const { title, intro, sections } = splitPages(text);
  const pages = sections.map((s) => ({
    slug: s.slug,
    title: s.title,
    url: `/${source.id}/${s.slug}/`,
    body: s.body,
    headings: headingsIn(s.body).filter((h) => h.depth === 3),
  }));
  // The nav's name for a section is `SOURCES`' own, not the document's `#` heading:
  // `README.md` calls itself "scmJS", which is the repository rather than the section.
  return { ...source, title: source.title, docTitle: title, intro, url: `/${source.id}/`, pages };
}

/**
 * Where a heading lives. A `#fragment` written anywhere in a guide has to find the page
 * that heading ended up on, since splitting at `##` moved most of them off the page the
 * link was written on.
 */
export function headingIndex(guides) {
  const index = new Map();
  for (const guide of guides) {
    const per = new Map();
    for (const page of guide.pages) {
      per.set(page.slug, page.url);
      for (const h of headingsIn(page.body)) if (!per.has(h.slug)) per.set(h.slug, `${page.url}#${h.slug}`);
    }
    index.set(guide.file, { guide, per });
  }
  return index;
}

/**
 * The link rewriter handed to `renderMarkdown`.
 *
 * Absolute and `mailto:` links are left alone. A bare `#fragment` is resolved within the
 * guide it was written in. A relative path naming one of the five source documents
 * becomes a page here; anything else in the repository becomes a link to GitHub — a blob
 * for a path inside the tree, and the repository's own page for one that climbs above it
 * (`../../releases` in `docs/development.md` is written to work that way on github.com).
 */
export function linkResolver(guides, { repoUrl = REPO_URL } = {}) {
  const index = headingIndex(guides);
  return (fromFile, href) => {
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
    const [target, fragment] = splitFragment(href);
    if (target === "") {
      const here = index.get(fromFile);
      const at = here?.per.get(slug(fragment));
      return at ?? href;
    }
    const { path, above } = resolvePath(fromFile, target);
    if (above > 0) return `${repoUrl}/${path}`;
    if (path.startsWith(`${IMAGES_DIR}/`)) return `/images/${path.slice(IMAGES_DIR.length + 1)}`;
    const doc = index.get(path);
    if (doc) {
      const at = fragment ? doc.per.get(slug(fragment)) : null;
      return at ?? doc.guide.url;
    }
    return `${repoUrl}/blob/main/${path}${fragment ? `#${slug(fragment)}` : ""}`;
  };
}

function splitFragment(href) {
  const at = href.indexOf("#");
  return at === -1 ? [href, ""] : [href.slice(0, at), href.slice(at + 1)];
}
