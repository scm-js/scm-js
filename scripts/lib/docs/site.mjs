/**
 * What the documentation site is made of, and where every link in it points.
 *
 * The eleven guides are the repository's own `docs/*.md`, split into
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
    blurb: "Running the editor in the browser, as a desktop app or in a container, and giving it the game's graphics from your StarCraft folder.",
  },
  {
    id: "guide",
    file: "docs/guide.md",
    title: "User guide",
    pageTitle: "StarCraft map editor guide",
    blurb: "How to use the editor: a first map, then each layer and dialog — terrain, units, triggers, settings, testing and saving — replays, plugins, and editing a map together.",
  },
  {
    id: "trigscript",
    file: "docs/trigscript.md",
    title: "TrigScript",
    blurb: "Triggers written as TypeScript: a quick start, triggers made by code, programs that run in StarCraft: Remastered, testing, the workspace and the reference.",
    pageTitle: "TrigScript, StarCraft triggers as code",
  },
  {
    id: "trigscript-language",
    file: "docs/trigscript-language.md",
    title: "TrigScript language",
    blurb: "What a program can say: numbers, arrays, maps, functions, classes, errors, tasks, units, events, input, text, sounds and libraries, and where it differs from TypeScript.",
    pageTitle: "TrigScript language for StarCraft programs",
  },
  {
    id: "trigscript-library",
    file: "docs/trigscript-library.md",
    title: "TrigScript library",
    blurb: "The modules that come with TrigScript: maths, chance, timers, signals, menus and dialogs, cutscenes, the fog as a picture, pixel screens and music, with an example of each.",
    pageTitle: "TrigScript library for StarCraft programs",
  },
  {
    id: "plugins",
    file: "docs/plugins.md",
    title: "Plugins",
    blurb: "Installing plugins, writing your first one, the core concepts, putting things on screen, and a tour of the API.",
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
    blurb: "Where the graphics come from, what is kept, Remastered, mods as data sets, and how the pictures are drawn.",
  },
  {
    id: "development",
    file: "docs/development.md",
    title: "Development",
    blurb: "Running from source, the repository layout and conventions, tests, the desktop app, releases and the docs site.",
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
 * guide it was written in. A relative path naming one of the eleven source documents
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

/**
 * Pages the site used to serve under another address, so a bookmark or a search result
 * still lands. Keyed by the old path, valued by where that content lives now (a page, and
 * an anchor on it where it became part of one). A heading that is still in its document
 * needs no entry here: `redirects` sends its old page to its anchor on its own.
 */
export const MOVED = {
  "/development/desktop-build/": "/development/desktop/",
  "/development/game-data/": "/development/getting-started/",
  "/development/how-the-editor-is-put-together/": "/development/conventions/",
  "/development/releases/": "/development/releases-and-hosting/",
  "/development/the-documentation-site/": "/development/docs-site-and-screenshots/",
  "/development/where-things-are-documented/": "/development/",
  "/game-data/what-the-editor-needs/": "/game-data/what-is-kept/",
  "/map-files/sections/": "/map-files/the-scenario/#known-and-unknown-sections",
  "/trigscript/examples/": "/trigscript/examples-of-triggers/",
  "/trigscript/trigscript-and-eudplib/": "/trigscript/coming-from-eudplib/",
  "/trigscript/variables-and-numbers/": "/trigscript-language/variables-and-numbers/",
  "/trigscript/arrays/": "/trigscript-language/arrays/",
  "/trigscript/tables-maps-and-sets/": "/trigscript-language/tables-maps-and-sets/",
  "/trigscript/control-flow/": "/trigscript-language/control-flow/",
  "/trigscript/reading-the-game/": "/trigscript-language/reading-the-game/",
  "/trigscript/units/": "/trigscript-language/units/",
  "/trigscript/the-games-tables/": "/trigscript-language/the-games-tables-and-memory/",
  "/trigscript/keys-the-mouse-and-chat/": "/trigscript-language/keys-the-mouse-and-chat/",
  "/trigscript/text/": "/trigscript-language/text/",
  "/trigscript/functions-and-classes/": "/trigscript-language/functions/",
};

/**
 * Every address a page may once have had, with where it goes now: each heading below a
 * page's own (a `###` that was a page before its document was regrouped, as each trigger
 * action was) at `/<guide>/<slug>/`, sent to its anchor, and the entries of `MOVED`.
 * An address that is a page today is never redirected.
 */
export function redirects(guides) {
  const live = new Set(guides.flatMap((g) => [g.url, ...g.pages.map((p) => p.url)]));
  const out = new Map();
  for (const g of guides) {
    for (const p of g.pages) {
      for (const h of headingsIn(p.body)) {
        const from = `/${g.id}/${h.slug}/`;
        if (h.depth > 2 && !live.has(from) && !out.has(from)) out.set(from, `${p.url}#${h.slug}`);
      }
    }
  }
  for (const [from, to] of Object.entries(MOVED)) if (!live.has(from)) out.set(from, to);
  return [...out].map(([from, to]) => ({ from, to }));
}
