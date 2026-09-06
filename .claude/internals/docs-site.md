# The documentation site

### The documentation site (`scripts/build-docs.mjs`, `scripts/lib/docs/`)

`docs.scmjs.dev` is `npm run build:docs`, deployed by build.yml's `docs` job onto
`scm-js/docs`'s `gh-pages` branch — one force-pushed orphan commit with a `CNAME`, the
`nightly-site` shape, behind the `DOCS_PAT` secret and the `DOCS_DOMAIN` variable and
skipped with a notice without them. It is a **stable-channel** job: the hosted editor, the
installers, the notes and the docs are one tag, and every page's footer carries the
version. (`@scm-js/plugin-api` still publishes from main, so a plugin author on the newest
package can be one release ahead of the reference; the API is additive, so what they see
is a member missing from these pages rather than one that behaves differently.)

Two halves, and only the second is generated in any interesting sense. The guides are
`README.md` and `docs/*.md` split at their `##` headings, one page each, with the `###`
beneath as the page's contents list (`markdown.mjs`, `marked`) — **nothing writes prose**,
because a generator that did would be a fifth document to keep current against the four
the top of this file names. `site.mjs` is the URL model and, with it, the link rewriter
that is the whole reason those documents keep working here: they are written to be read as
GitHub blobs, so `docs/plugins.md` becomes a page, a bare `#fragment` finds whichever page
that heading landed on, and `LICENSE` or `../../releases` goes back to the repository.

The reference is read out of `plugin-api/index.d.ts` — the *bundle* rather than the source
tree, because that one file with no imports is exactly what a plugin repository compiles
against. `api.mjs` parses it with the TypeScript compiler API (doc comments out of the
leading trivia, not `node.jsDoc`, which is not public), takes `PluginApi`'s `…Api`
properties as the pages, and `assignTypes` puts a supporting type on the page of the only
group that can reach it — transitively, so `IsomReport` and `Diamond` both land under
`terrain` — leaving what two groups share on `/api/types/`. So `src/plugins/api.ts` is the
only place the reference is written: a group with no doc comment reads as a bare interface
name on the site (`tests/docs.test.ts` fails when one does), and an `@example` there shows
up as a code block *and* in a plugin author's editor tooltip.

`docs/file-formats.md` and `docs/game-data.md` are written for *readers* — map makers
deciding what to strip from a file, people repairing a protected map, mod makers,
developers meeting the format — and not as implementation notes: those are this file
and the source's own comments. Each ends with one `## In the source` table pointing a
developer at the modules, and that table is the only place a `src/` path may appear;
`tests/docs.test.ts` fails on a `src/` path anywhere else in them, on an atom or hook
name anywhere in them, and on a section after that one. When behaviour changes, update
the prose in the reader's terms and this file in the code's. `docs/development.md` is the
contributor's guide (running, building, releasing, the plugin host, the conventions) and
may name files, but the *reasons* and the measurements behind a decision stay here and in
the source comments; it points at this file for them.

The guide's pictures are `docs/images/*.webp`, referenced from `README.md` by that path
so they render on GitHub; `site.mjs#linkResolver` sends `docs/images/…` to `/images/…`
(the directory is copied whole) rather than to a blob page, and `tests/docs.test.ts`
fails on a picture the guide names that is not on disk. `scripts/guide-screenshots.mjs`
regenerates them against the dev server and the fixture maps (Playwright and sharp,
installed ad hoc, not dependencies — `docs/development.md#guide-screenshots`); re-run it
when the chrome changes, and never commit a picture that shows anything but the editor.
The scmjs.dev pictures (2026-09-06: `account`, `my-maps`, `save-to-scmjs`, `ai-menu`,
`assistant`, `name-describe`, `review-map`, `rewrite-strings`, `generate-map`,
`generated-map`, `make-scenario`) run against `scripts/lib/guide-scmjs-mock.mjs`, a
stand-in for the ai-server on port 8765 that the script points the plugin at by seeding
`localStorage["scmjs.plugins"]` (the plugin is a default that ships *off*, so without a
stored row turning it on there is no Account menu to photograph) and
`localStorage["scmjs.plugin.scmjs-dev.settings"]` (`serverUrl` + a session) before the
page loads: the account and ledger are constants, the map storage is real (multipart
parsed by hand, dedup by hash, dates rewritten by the scene afterwards so the list reads
like a week's work), and the recipe answers are canned per recipe — `map-plan` is
procedural over the request's terrain vocabulary and doodad categories, `agent` is a
three-turn script keyed on whether the request carries tool results and reads Player 1's
start location out of the `list_units` result, the rest are text written for Big Game
Hunters. Chosen over running the real server because a live run needs an OAuth provider,
a model key and gives a different picture every time; the mock is not a test of anything
and must stay honest to what the dialogs would show. `--scenes scmjs-ai` runs one scene;
`--only` still filters pictures within it.

`ATTRIBUTION.md` is the provenance record (audited 2026-09-04) and `scripts/lib/notices.mjs`
its mechanical half: the `scmjs-notices` plugin in `vite.config.ts` emits
`dist/THIRD-PARTY-NOTICES.txt` from `package.json`'s runtime `dependencies` plus the
vendored `plugins/*/LICENSE`, failing the build on a dependency with no license file, so
the web zip, the installers and the image carry every bundled license (TypeScript's
Apache-2.0 text above all). Adding a runtime dependency needs no edit there; adding an
*adapted* algorithm or table needs an entry in `ATTRIBUTION.md` and a provenance comment
(`tests/notices.test.ts`).

`render.mjs` is the HTML and a small TypeScript colouriser whose real job is the links —
every declared name in a signature links to where it is documented. The site is plain
static files in the editor's palette, like `scm-js/site`: one stylesheet, one script
(`assets/search.js`, a JSON index fetched on first use and scanned in the page), no
framework and nothing fetched at runtime. `tests/docs.test.ts` pins the split (a `#` inside
a fenced shell block is not a page; no line of a guide is dropped between them), the link
rules, and the reference's shape; the API cases `describe.skipIf` when the bundle is not on
disk, as a fresh clone's are.
