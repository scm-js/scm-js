# The documentation site

### The documentation site (`scripts/build-docs.mjs`, `scripts/lib/docs/`)

`docs.scmjs.dev` is `npm run build:docs`, deployed by `docs.yml` onto
`scm-js/docs`'s `gh-pages` branch — one force-pushed orphan commit with a `CNAME`, the
`nightly-site` shape, behind the `DOCS_PAT` secret and the `DOCS_DOMAIN` variable and
skipped with a notice without them. build.yml's `docs` job calls it on every **stable**
tag: the hosted editor, the installers, the notes and the docs are one tag, and every
page's footer carries the version. It can also be run by hand (Actions ▸ Docs site, `ref`
defaulting to main) to put a docs fix live between releases; the footer then reads
"`0.6.0 + main@abc1234`" (`--version`, worked out from `git describe` against the newest
`v*` tag), and the next release's run puts the tag's own pages back. A hand run from main
publishes whatever main says, including prose for unreleased features and main's API
declarations. (`@scm-js/plugin-api` still publishes from main, so a plugin author on the newest
package can be one release ahead of the reference; the API is additive, so what they see
is a member missing from these pages rather than one that behaves differently.)

For search engines: with `--domain` every page gets a canonical link, `og:url` and the card
picture (`assets/og.jpg`, the same 1200×630 cut of `editor-plain.webp` scmjs.dev uses), and
the build writes `sitemap.xml` (every emitted page) and `robots.txt`; a local or `--base`
build has no domain to be absolute against and leaves all of it out. A guide page's
`<meta name=description>` is `summaryOf` — sentences from the top until there is about a
search result's worth, or the page's `###` headings when it opens on a table — while its
card on the section page stays `firstLine`, one sentence. A source may set `pageTitle`, which
makes its pages' `<title>` "`<page> — <pageTitle>`" instead of "… — scmJS StarCraft map editor":
the trigger reference and the CHK reference use it, since those pages are found by the name of
one action or section, and so do the user guide and the map-files guide. Every title names
StarCraft, because nobody searches for "scmJS" yet — a page is found by what it is about. Both references keep their tables in `<!-- generated -->` blocks
(`scripts/lib/generated-blocks.mjs`) rewritten by `npm run docs:reference`.

Two halves, and only the second is generated in any interesting sense. The guides are
`docs/*.md` split at their `##` headings, one page each, with the `###` beneath as the
page's contents list (`markdown.mjs`, `marked`). Nav order is `SOURCES` in `site.mjs`:
`docs/installing.md` first, then `docs/guide.md` (the user guide), then
`docs/trigscript.md` — a guide of its own because as the user guide's `## TrigScript` it
was a thousand lines that buried everything after it; the user guide keeps a short overview
linking into its pages. Then `docs/trigscript-language.md`, the language of programs. It is
here and not in the TrigScript plugin's README because a README the site never shows grows
while a shorter copy in the guide goes stale; the guide's Programs section is a tour that
links into it, so the language is written once. `tests/trigscript-guide.test.ts` compiles every
`ts` / `tsx` block of both against the vendored compiler (multi-file blocks by `// name.ts`
lines, a stand-in `waves` library, the README test's `// what it prints` check through
`simulatePrograms`), so an example that stops compiling after a language change fails here.
`docs/trigscript-library.md` follows the same rule, a page a `trigscript/*` module; its
examples are compiled too, and the first run caught a signal handler returning an action,
copied from `signals.ts`'s own header comment, which still carries it.
`docs/bots.md` (after `cli` in the nav) is the bot guide. It is for three readers, named
in a table at its top: someone who wants to play against a bot (`## Playing against a bot`: what each row of the setup
screen's list is), someone writing one in JavaScript (`## A first bot`, then `## Running a bot`), and someone with a
BWAPI bot (`## Bringing a BWAPI bot`: what plays and what does not, the build, what differs from Windows; the
`scmbot.json` reference stays in the scmbot repository's README, which the section links). The two references
(`## The short way`, `## The interface underneath`) come last, after `## What is not there yet`: the site gives each
`##` a page, so they are pages of their own without a second file. Its pictures (`bot-setup`, `bot-options`,
`bot-playing`) are of the play page and were taken by hand against the local stand-in (the play page is not in this
repository, so no script here can take them): a generated map (`map generate --seed 1207`), `starter.mjs` added as a
file, and for `bot-playing` the fog of war off, 16× until Starter's "a wave of" line is in the chat, the view
scrolled to its marines, then the game's canvas alone (driven through the page's `window.scmsim` hooks).
Its code blocks are type-checked
the same way, against the `@scm-js/bot` bundle, by `tests/bot-package.test.ts` (`.claude/internals/cli-bots-plugins.md`).
**Nothing writes prose**, because a generator that did would be one more document to keep
current. `site.mjs` is the URL
model and, with it, the link rewriter that is the whole reason those documents keep
working here: they are written to be read as GitHub blobs, so `docs/plugins.md` becomes a
page, a bare `#fragment` finds whichever page that heading landed on, and `LICENSE` or
`../../releases` goes back to the repository. A `SOURCES` entry's `omit` (slugs) can drop
`##` sections meant only for the GitHub reader, and a `#fragment` to one resolves to `/`;
no source uses it.

`README.md` is not a source. It is the repository's front page — what scmJS is, *What it
does*, getting started, the documents table, the licence — about a hundred lines, because a
GitHub visitor deciding in thirty seconds and a map maker reading the manual are different
readers, and a README that was also the user guide (1,500 lines) served neither. A link to
`README.md` from a guide resolves to the site's home page, which stands in for it.

The home page's *What it does* list is the README's `## What it does` section, read out
of the README and rendered (`homeHtml`, picture lines dropped since the home page opens on
one), not a hand-written copy, so the two front pages cannot drift. It is found by the
slug `what-it-does`, and `tests/docs.test.ts` fails if the README loses that section.

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

The guide's pictures are `docs/images/*.webp`, referenced from `docs/guide.md` as `images/…` (and from `README.md` as `docs/images/…`)
so they render on GitHub; `site.mjs#linkResolver` sends `docs/images/…` to `/images/…`
(the directory is copied whole) rather than to a blob page, and `tests/docs.test.ts`
fails on a picture the guide names that is not on disk. `scripts/guide-screenshots.mjs`
regenerates them against the dev server and the fixture maps (Playwright and sharp,
installed ad hoc, not dependencies — `docs/development.md#guide-screenshots`); re-run it
when the chrome changes, and never commit a picture that shows anything but the editor.
`scripts/cli-screenshots.mjs` is its sibling for `docs/cli.md`'s `cli-*.webp`: it runs the built
`scmjs` with `FORCE_COLOR=1`/`COLORTERM=truecolor` on `tests/maps/*`, maps `map generate` makes and the engine's
replays, plays the output into a small terminal emulator (SGR, CR/LF, cursor up/down, `2K`, OSC/APC skipped; ▀▄█
painted as two-colour gradients so half-block pictures have no seams; braille painted as dots on the cell's 2 × 4
grid, since DejaVu Sans Mono has none and Chromium's fallback, DejaVu Sans, draws them 10px wide in an 8.43px cell,
which cut the overview globe's right edge off and shifted its rows), renders the cells in DejaVu Sans Mono and
screenshots them at 2× in headless Chromium. WebP comes from the page's own `canvas.toDataURL("image/webp", 1)`,
which Chromium writes lossless (VP8L) at quality 1, so the script needs only Playwright, not sharp; the coloured-cell
pictures (`map preview`, `replay watch`) and the PNGs commands write go at 0.9. `replay watch` runs under
`script -qfec` for a pty and is quit with `q` after six seconds. The QR picture is the encoder (`cli/src/qr.ts`,
loaded with Vite's `ssrLoadModule`) on a fixed link, since a real `map share` needs a session.
Three more scenes: `map-analyze` (the PNG `map analyze --out --scale 8` writes for `(4)Crossing.scx`,
seed 2026), `map-heatmap` and `replay-export`. The last two need games on that map, so `games()` plays a ladder of
`starter.mjs` (scmbot's JavaScript example bot, in the `--bots` folder: no build, so it works where no `.scmbot` is
on the machine) against the game's computers, `--races tzp --games 2`, 18 games, about six minutes the first time and
skipped when a kept `--work` folder has `games/ladder.json`. The heatmap runs with `--parallel 2`: at four, three
replays failed with `ENOMEM` reading the Remastered installation under WSL. `frame()` takes one frame of the WebM
`replay export` wrote by playing it in the script's own page, so ffmpeg is still not needed; `--browser` is handed to
the command as `SCMJS_BROWSER` too. On this machine the Playwright Chromium starts only with the libraries of the
headless-browser recipe on `LD_LIBRARY_PATH`. With seeds 1 and 2 no side is dealt the bottom right start, which the
guide's caption says.
The scmjs.dev pictures (`account`, `my-maps`, `save-to-scmjs`, `ai-menu`,
`assistant`, `review-map`, `generate-map`, `generated-map`, `make-scenario`) run against `scripts/lib/guide-scmjs-mock.mjs`, a
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

The shared-map pictures (`share-join`, `share-editing`, `share-dialog`, scene
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

`ATTRIBUTION.md` is the provenance record and `scripts/lib/notices.mjs`
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

`render.mjs` is the HTML; `highlight.mjs` is the code colouring, for the reference's signatures
and examples and for the guides' fenced blocks. Its TypeScript colouriser's real job is the links —
every declared name in a signature links to where it is documented — and the guides' ```ts blocks
get the same links (`renderMarkdown`'s `code` option, the build's `codeOpts`). `highlightAs` goes by
the fence's language: the ts/js/json family, `sh`, `yaml` and `trigedit`, one regular expression
each rather than a grammar, so the site keeps `marked` as its only dependency. A `text` fence or one
with no language is left as marked's own block, uncoloured. The classes are `k s n c t f` under
`pre` in `docs.css` (`f` is a trigger condition's or action's name). The site is plain
static files in the editor's palette, like `scm-js/site`: one stylesheet, two scripts
(`assets/search.js`, a JSON index fetched on first use and scanned in the page; and
`assets/copy.js`, below), no framework and nothing fetched at runtime. `tests/docs.test.ts` pins the split (a `#` inside
a fenced shell block is not a page; no line of a guide is dropped between them), the link
rules, and the reference's shape; the API cases `describe.skipIf` when the bundle is not on
disk, as a fresh clone's are.

### Copy buttons (`assets/copy.js`)

Every ```` ```sh ```` block, and every plain block that shows a terminal session (a line starting
`$ `), gets a "Copy" button over its top-right corner, added in the page rather than at build
time — it needs script anyway, and a block marked renders itself keeps no wrapper to hang it on.
Which blocks: by `<code>`'s class — `language-sh|bash|shell|zsh`, or no class and a `^\$ ` line.
Not ts/trigedit/yaml: the ask was commands, and ts blocks already own that corner with Try it.
What is copied is what a terminal should run: a session gives only its `$` lines with the `$`
dropped; a shell block loses its `# comments` (a `#` starting a word, outside quotes). That is
not cosmetic: zsh, the Mac's default shell, has `interactivecomments` off, so a pasted
`brew install scm-js/tap/scmjs   # macOS and Linux` passes `#`, `macOS`, `and`, `Linux` to brew.
The button shows on hover/focus and always under `(hover: none)`. **A block copies whole**, so
a block of alternatives ("one of these per platform") copies all of them. So a guide writes one
block per alternative, with the prose naming which is which, rather than one block with a
`# Homebrew` / `# winget` comment per line: installing.md's install commands and cli.md's
updating, shell-completion and `SCMJS_LANG` blocks are split that way.

### Try it links (`scripts/lib/docs/tryit.mjs`)

Every ```ts/```js block in the guides and every `@example` in the reference that mentions `api` is
type-checked **once, in one program** (`runnableSnippets`: each block a `/snippetN.ts`, a globals file
`declare const api: PluginApi`, the bundled `index.d.ts` placed as `node_modules/@scm-js/plugin-api`,
DOM lib, `moduleDetection: force` — the API Playground's own compile settings), and only the blocks
with no diagnostic get a link. Every group in `docs/plugins.md` and the most-used calls in `api.ts` have a
self-contained example, so nearly every candidate gets one. What is left without one is deliberate: the `api.sync` pair (needs a
server) and the guide's "wrong" `async` builder. A new example should run as written — no undeclared
helper, nothing that throws without the tileset graphics (`const [, ground] = api.terrain.types()`
and a guard, not `types()[1].id`), and its own `api.storage` key, since every snippet in the playground
shares one plugin id. The whole pass is well under a second. An error outside the snippets throws,
because it would otherwise fail every link silently. Making an example runnable is how you give it a
link. The link is `EDITOR_URL/?plugin=github:scm-js/plugin-api-playground&playground=1<raw
deflate, base64url>`, the plugin's own link format (its `link.ts`; a test on each side checks the
other's zlib/CompressionStream output). `withTryIt` in `markdown.mjs` wraps both renderers' blocks
(marked's `code` renderer returns `false` for every other block, so they stay marked's own). The
`?plugin=` half is `src/plugins/link.ts` + `hooks/usePluginLink.ts` (see `plugins-loading.md`).


### The terrain tools' pictures (scenes `tile-sheet`, `pin`, `symmetry`, `heal`, `mod-terrain`)

The guide's **Mod terrain** page follows its Terrain page (`## Mod terrain`: *Ground a mod adds*, *Pictures a
mod adds*, *Terrain from other tilesets*, *Drawn borders* — the last three anchors are linked from
`docs/mods.md` and `docs/plugins.md`, keep them). Their pictures:
`palette-sheet`, `terrain-block` (`tile-sheet`, Jungle), `terrain-pin` (`pin`, Badlands ramp #77 stretched),
`symmetry`, `symmetry-differences`, `doodad-twin` (`symmetry`, a 64×64 Desert map the scene builds),
`terrain-heal` (`heal`, Big Game Hunters), and `mod-sheet`, `mod-pieces`, `mod-borrowed`, `mod-borders`
(`mod-terrain`).

- **The symmetry picture is not the `dialogs` scene's.** On an empty map every mode reads 100.0%, which
  shows nothing; the `symmetry` scene builds a mirrored map with one resource out of place, and `dialogs`
  leaves the dialog out so it does not overwrite the picture.
- **`SEEDED_RANDOM`.** The isometric brush picks tile variations with `Math.random`, and the variations do
  not all walk alike, so the report's percentages changed on every run. A scene's init script seeds
  `Math.random`, and `steadyStroke` resets the seed before each stroke. With it every picture but
  `mod-borrowed` comes out byte for byte the same twice (there, eleven palette pixels differ).
- **`mod-terrain` shows a mod's tiles on purpose.** The user allowed Cosmonarchy's tiles in the guide's
  pictures; the pictures are still the editor, and the mod's files are read from `--mod` /
  `--mod-maps` and never copied into the repository. The scene adds the mod through Help ▸ Game Data…,
  runs *Find terrain from other tilesets* (≈11 s) and *Learn from Maps…* (404 maps, ≈30 s).
- **Learn from Maps… in headless Chromium.** The editor uses `showDirectoryPicker` where it exists, which
  nothing can answer headless; the scene's init script deletes it, so the editor falls back to its folder
  input, which Playwright can fill.
- **`sideBySide` takes `{ labels, halves }`.** The defaults are the Remastered picture's; `halves: false`
  sets two whole clips beside each other (`terrain-heal`, `mod-borders`).
- **Two notices are hidden** (`quiet({ updates: true })`): the plugin-updates notice and "scmJS has been
  updated", which a fresh profile gets. Other notices stay in the pictures.
- The headless shell needed libnspr4, libnss3 and libasound on `LD_LIBRARY_PATH` on this machine.

### The API Playground pictures (scene `api-playground`)

The API Playground is not a default, so the scene installs it — from its repository, or from a local
build with `--playground http://localhost:3110/` while working on it. It opens Crescent Moon, runs the
*Place units in a ring* example and takes the hover over `api.document.edit`.

### The plugin guide's pictures (scene `plugin-guide`)

Eight pictures (`plugin-base-check`, `-dialog`, `-waiting`, `-map-tool`, `-overlay`, `-trigger-editor`,
`-recipes`, `-surfaces`) taken by running the guide's *own* examples: `p.example(markers, { before, after })` finds each
fenced ```ts block of `docs/plugins.md` by a line of it, joins them into one snippet (a new run stops the
one before), runs it in the API Playground and closes the playground's panel (a run outlives it; a modal the
example opened is left covering it). The map is `PLUGIN_GUIDE_MAP`, made through the API — no fixture map,
so the scene runs with only the extracted game data. `plugin-surfaces` is annotated from the elements'
bounding boxes, not fixed coordinates; `annotate` takes its marks. The map button in it is the scene's
own line, the guide having no example for one.

**A snippet in the playground speaks as the playground**: `api.commands.register({ id: "open" })` there
replaced the playground's own `api-playground.open`, so Tools ▸ API Playground opened the snippet's panel
instead. That is why the tutorial's command is the dotted `base-check.open`. An example that registers a
command should use an id the playground is unlikely to own, or a dotted one.

Every example was also run once in the real editor (a throwaway local plugin handing out `api`, each
snippet in a `scope()`): the ones that wait for a click aside, all ran. That harness is not in the
repository; `tests/docs.test.ts` and the Try it pass only type-check. The guide's `## Recipes` (a page of its own on the site) were driven the same
way — the brush dragged, the prompts answered — before they were written down as working.

`docs/chk.ksy` is linked from the CHK reference as a relative link, which the resolver sends
to its GitHub blob page (the site does not copy it). The reference's SVG pictures live in
`docs/images/` like the guide's webp shots but are generated, not screenshots — see
`chk-format.md`.

### The AI tools guide (`docs/ai-tools.md`)

The user wants the MCP server's guide to show what it can do, and to be "not a wall of text, … clear,
concise, screenshots if needed only if it adds clarity". It is a guide of its own (site id
`ai-tools`, after `cli` in `SOURCES`), not a chapter of the command line guide, linked from the README's feature list and
from "The AI" in the user guide, which covers the editor's own assistant. `docs/cli.md` keeps a
short `## AI tools` with the one line that sets it up and a pointer, so `/cli/ai-tools/` is still a
page; the `###` sections that lived under it have no redirect (a fragment cannot be forwarded).

- **What lives where.** The guide has the reader's path: setting up, a first request, what to ask,
  working in the editor, changing a map, the tools, files and the game. The commands themselves
  (`map open --live`, `map edit`, `map units`) stay in `docs/cli.md` and are linked, not repeated;
  the guide's table of what a linked map does is the tools' wording of the command's table.
- **Every example is real output**: `map_check` on `tests/maps/ums.scx`, the trigger round trip,
  and the `map_edit` call with its answer from a run against a linked editor.
- **One picture**, `ai-linked.webp`: Big Game Hunters linked to the MCP server after one `map_edit`
  (six Marines and a location), the Edit menu open on "Undo scmjs map edit" and **Linked** in the
  status bar. Made by hand, not by `guide-screenshots.mjs`: the built command's `mcp` driven over
  stdio (`editor_open`, `map_units`, `map_edit`, `editor_show`), `vite preview` with the game data,
  headless Chromium at 1280 × 760 and 2×, then drawn to a 1,920-wide canvas and written as WebP at
  0.82 (245 KB). Retake it when the chrome changes; a scene in the script would need the command
  built and a second page, which no scene has yet.
- A new guide means: the `SOURCES` entry, `GUIDES` in `tests/docs.test.ts` (it ends with "In the
  source"), the count in `CLAUDE.md` and twice in `docs/development.md`, and the README's table.


### One subject, one guide

A subject two guides both explain drifts, so each has one owner and the others keep a short
paragraph and a link:

- **The mod commands** are `docs/mods.md`'s `## The commands`, with every option and output.
  `docs/cli.md` keeps a short `## Mods` (four example lines and a pointer) so `/cli/mods/` is
  still a page, and its Command reference rows link into the mods guide. The `###` pages the
  chapter had are in `MOVED`, since `redirects` only forwards headings still in their
  document.
- **AI tools** are `docs/ai-tools.md`; `docs/cli.md` keeps `## AI tools` the same way.
- **The game's files**: `docs/installing.md` owns the steps (each form of the editor, the
  folder, the archives, the command), `docs/game-data.md` what the files are, which
  StarCraft each form comes from and what is kept. The README and the user guide keep a
  paragraph and a link.
- **The contribution rules** are `CONTRIBUTING.md`, which GitHub shows on a new pull request;
  `docs/development.md`'s `## Contributing` links to it.

### Tables that mirror code

`tests/docs-tables.test.ts` checks the guides' tables that list what the code has, reading the
code through its public entry at run time rather than its source text (the CLI's source moves
between modules): the MCP tool table and its count in `docs/ai-tools.md` (`createMcpServer().tools`),
`docs/cli.md`'s Command reference (`buildProgram()`, walked; every command that is not hidden and
has no commands under it must be named, and nothing that is not a command; a hidden one may be
named), the names in `docs/core.md`'s export table (`core/src/index.ts`; a field name in a code span
goes in `NOT_EXPORTS`), and the default plugins in the user guide's Plugins table and the plugin
guide's *What is available* (`DEFAULT_REMOTE_PLUGINS`). The Command reference cell syntax it reads:
`a|b` (escaped `\|` in the table) names several commands at one place, `[a|b]` optional commands
under the one before, and a span without `scmjs` is a sibling of the cell's last command.
