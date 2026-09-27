/**
 * What the documentation site is made of, and where every link in it points.
 *
 * The nine guides are the repository's own `docs/*.md`, split into
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
    id: "installing",
    file: "docs/installing.md",
    title: "Installing",
    blurb: "Getting to the hosted editor, downloading and installing the desktop app for Windows, macOS and Linux, the container, and getting the game's graphics.",
  },
  {
    id: "guide",
    file: "docs/guide.md",
    title: "User guide",
    pageTitle: "StarCraft map editor guide",
    blurb: "How to use the editor: Your first map, then each layer and dialog - terrain, units, triggers, settings, saving, editing one map with multiple people, map sharing, and how to install plugins.",
  },
  {
    id: "trigscript",
    file: "docs/trigscript.md",
    title: "TrigScript",
    blurb: "Triggers written as TypeScript: the script window, tests, triggers made by code, programs that run in the game on StarCraft: Remastered, examples and the reference.",
    pageTitle: "TrigScript, StarCraft triggers as code",
  },
  {
    id: "plugins",
    file: "docs/plugins.md",
    title: "Plugins",
    blurb: "Installing plugins and what they may do, writing one, and a tour of the API.",
  },
  {
    id: "triggers",
    file: "docs/triggers.md",
    title: "Trigger reference",
    blurb: "Every trigger condition and action: what it does, its arguments, its text form and where it is stored in the map.",
    // A page here is found by the name of one condition or action, so its title says what
    // the name is: "Set Deaths — StarCraft trigger reference".
    pageTitle: "StarCraft trigger reference",
  },
  {
    id: "map-files",
    file: "docs/file-formats.md",
    title: "Opening and saving maps",
    blurb: "What the editor does with a map file: what it preserves, what Save can strip, revisions, protected and built maps.",
    pageTitle: "StarCraft map files",
  },
  {
    id: "chk",
    file: "docs/chk-format.md",
    title: "CHK format reference",
    blurb: "Every section of a scenario file: its byte layout, what a repeat does, whether the game needs it, the values its fields take.",
    pageTitle: "StarCraft CHK format reference",
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
  const omit = new Set(source.omit ?? []);
  const pages = sections.filter((s) => !omit.has(s.slug)).map((s) => ({
    slug: s.slug,
    title: s.title,
    url: `/${source.id}/${s.slug}/`,
    body: s.body,
    headings: headingsIn(s.body).filter((h) => h.depth === 3),
  }));
  // The nav's name for a section is `SOURCES`' own, not the document's `#` heading:
  // `docs/guide.md` calls itself "User guide" too, but a document's own title need not be the nav's.
  return { ...source, title: source.title, docTitle: title, intro, url: `/${source.id}/`, pages, omitted: [...omit] };
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
    // A link to a section the site leaves out goes to what stands in for it: the index.
    for (const slug of guide.omitted ?? []) if (!per.has(slug)) per.set(slug, "/");
    index.set(guide.file, { guide, per });
  }
  return index;
}

/**
 * The link rewriter handed to `renderMarkdown`.
 *
 * Absolute and `mailto:` links are left alone. A bare `#fragment` is resolved within the
 * guide it was written in. A relative path naming one of the nine source documents
 * becomes a page here; anything else in the repository becomes a link to GitHub — a blob
 * for a path inside the tree (the README is the exception: the home page stands in for it), and the repository's own page for one that climbs above it
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
    // The README is the repository's front page; on the site the home page is.
    if (path === "README.md") return "/";
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
