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

For search engines: with `--domain` every page gets a canonical link, `og:url` and the card
picture (`assets/og.jpg`, the same 1200×630 cut of `editor-plain.webp` scmjs.dev uses), and
the build writes `sitemap.xml` (every emitted page) and `robots.txt`; a local or `--base`
build has no domain to be absolute against and leaves all of it out. A guide page's
`<meta name=description>` is `summaryOf` — sentences from the top until there is about a
search result's worth, or the page's `###` headings when it opens on a table — while its
card on the section page stays `firstLine`, one sentence. A source may set `pageTitle`, which
makes its pages' `<title>` "`<page> — <pageTitle>`" instead of "… — scmJS documentation": the
trigger reference and the CHK reference use it, since those pages are found by the name of one
action or section. Both references keep their tables in `<!-- generated -->` blocks
(`scripts/lib/generated-blocks.mjs`) rewritten by `npm run docs:reference`.

Two halves, and only the second is generated in any interesting sense. The guides are
`README.md` and `docs/*.md` split at their `##` headings (nav order is `SOURCES` in
`site.mjs`; `docs/installing.md` is first, above the user guide, and holds what README's
*Getting started* used to — README keeps a short summary pointing at it), one page each, with the `###`
beneath as the page's contents list (`markdown.mjs`, `marked`) — **nothing writes prose**,
because a generator that did would be a fifth document to keep current against the four
the top of this file names. `site.mjs` is the URL model and, with it, the link rewriter
that is the whole reason those documents keep working here: they are written to be read as
GitHub blobs, so `docs/plugins.md` becomes a page, a bare `#fragment` finds whichever page
that heading landed on, and `LICENSE` or `../../releases` goes back to the repository.
A `SOURCES` entry's `omit` (slugs) drops `##` sections that are only for the GitHub
reader — README's *Documentation* (the sidebar is the index) and *License* (the footer
links LICENSE and ATTRIBUTION.md) — and a `#fragment` to an omitted section resolves to `/`.

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

`docs/file-formats.md` (titled "Opening and saving maps") and `docs/chk-format.md` split
one subject: a fact about the format — a byte layout, what the game does with a repeat,
which revision needs which table, how the game reads `STR` text — goes only in the CHK
reference, which is editor-neutral apart from each page's "In scmJS" row; a fact about
what scmJS does with a file goes only in `file-formats.md`, which links to the reference
instead of restating it. The section list was once kept by hand in both and drifted, so
the generated index in `chk-format.md` is the only one.

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
`localStorage["scmjs.plugins"]` (the plugin was a default that shipped *off*; the row
stays so the pictures do not hang on that) and
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

The shared-map pictures (2026-09-22: `share-join`, `share-editing`, `share-dialog`, scene
`scmjs-share`) add rooms to the same mock: `POST /v1/rooms`, `GET /v1/rooms/:invite`
(answered signed out) and a hand-written RFC 6455 server on `/v1/rooms/socket` (masked
frames in, continuations joined, no dependency) that numbers, acks and relays ops like
ai-server's `rooms/service.ts`. The scene drives a second browser context (`p.other()`,
seeded with the plugin row only, the server arriving through the link's `?scmjs-server=`),
which joins as Kim and places four marines — those reach the owner's page as real sync ops.
`rooms.guest` seats "Sam" with no socket (dialog `playerSettings`, so the label reads "in
Player Settings"), and `rooms.pin` overrides a person's `px`/`py` in every presence relayed,
because a headless page's pointer is wherever the last click left it; positions are worked
out from the owner's `view` as the room last heard it. The Share dialog's link input is
rewritten to `https://editor.scmjs.dev/?scmjs-room=…` before the picture.

`ATTRIBUTION.md` is the provenance record (audited 2026-09-23) and `scripts/lib/notices.mjs`
its mechanical half: the `scmjs-notices` plugin in `vite.config.ts` emits
`dist/THIRD-PARTY-NOTICES.txt` from `package.json`'s runtime `dependencies` plus the
vendored `plugins/*/LICENSE`, failing the build on a dependency with no license file, so
the web zip, the installers and the image carry every bundled license (TypeScript's
Apache-2.0 text above all). The plugin runtimes (eudplib's Pyodide, wheel and worker) are
copied in *after* vite, so `bundle-plugin-runtimes.mjs` appends each runtime's `licenses/`
files to that file itself (`withRuntimeNotices`, idempotent, throws on a runtime with none)
— Pyodide's MPL-2.0 is the one that matters. Adding a runtime dependency needs no edit there; adding an
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

### Try it links (`scripts/lib/docs/tryit.mjs`, 2026-09-23)

Every ```ts/```js block in the guides and every `@example` in the reference that mentions `api` is
type-checked **once, in one program** (`runnableSnippets`: each block a `/snippetN.ts`, a globals file
`declare const api: PluginApi`, the bundled `index.d.ts` placed as `node_modules/@scm-js/plugin-api`,
DOM lib, `moduleDetection: force` — the API Playground's own compile settings), and only the blocks
with no diagnostic get a link: 14 of 30 candidates at the time, the rest being deliberate fragments
(`socket`, `settings`). The whole pass is well under a second. An error outside the snippets throws,
because it would otherwise fail every link silently. Making an example runnable is how you give it a
link — three were rewritten that way (`document.edit`, `view.flash`, the pickArea flatten in
`plugins.md`). The link is `EDITOR_URL/?plugin=github:scm-js/plugin-api-playground&playground=1<raw
deflate, base64url>`, the plugin's own link format (its `link.ts`; a test on each side checks the
other's zlib/CompressionStream output). `withTryIt` in `markdown.mjs` wraps both renderers' blocks
(marked's `code` renderer returns `false` for every other block, so they stay marked's own). The
`?plugin=` half is `src/plugins/link.ts` + `hooks/usePluginLink.ts` (see `plugins-loading.md`).


`docs/chk.ksy` is linked from the CHK reference as a relative link, which the resolver sends
to its GitHub blob page (the site does not copy it). The reference's SVG pictures live in
`docs/images/` like the guide's webp shots but are generated, not screenshots — see
`chk-format.md`.
