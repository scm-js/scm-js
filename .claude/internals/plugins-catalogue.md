# The plugins themselves

**scmjs.dev** (`github.com/scm-js/plugin-scmjs-dev`, a default that starts **off** — listed and badged *default*, ticked on by the user) is the account and the
AI in one plugin, and its server (`github.com/scm-js/ai-server`, Fastify + Caddy + Postgres, one image on
GHCR) is a service the project runs at `api.scmjs.dev`. It used to be two plugins — scmjs.dev (account,
map storage, the `scmjs-dev.account` service) and AI (`github.com/scm-js/plugin-ai`, now archived with
a notice), the AI following the other's sign-in through `api.services` — and was merged on 2026-09-05
because the split only ever described the split: a shape-matched copy of the contract, a provider
delegation, two Settings dialogs, two status cells and an activation-order dance for one relationship
with one service. The rules that came with the merge: the plugin has **no field for a server, a token
or a key** (the server keeps `access.byok` and `access.tokens` for an operator's own tools and forks,
`byok` now off by default and its README says so); the one way to point a development build at a
local server is the `?scmjs-server=` query on the editor's address (`account.ts#serverOverride`,
stored, cleared by `?scmjs-server=` empty, shown in the Account dialog only while in use); with **no
session stored the plugin makes no request at startup** (a session from last time is refreshed so the
status bar shows the balance — a default that phoned home was the thing the game-data resolver was
cleaned of); *Use the AI features* (`Settings.ai`, in the Account dialog's settings and at the top of
Tools ▸ AI ▸ Options…) puts the whole AI group in and takes it out again — `ai/install.ts` keeps every
`Disposable` and returns the cleanup, `slots.ts` likewise — leaving the account and the maps; the
model/effort knobs became one **Quality** choice (`quick` / `standard` / `thorough` → effort `low` /
the server's per-recipe default / `high`, `ai/ui.ts#QUALITY_EFFORT`) and **no model id is shown
anywhere**, the runner says "Asking scmjs.dev…"; a failed request links to the Account dialog (sign in
/ top up), never to a settings screen. The server holds the Anthropic key, the prompt recipes, the
access rules (per-IP and per-session budgets, and *accounts*: a free trial session per browser,
Discord sign-in through a provider interface, roles with a weekly allowance or `unlimited`, purchased
credit through Stripe Checkout, an account page, `/v1/admin/*` for the site) and never any game data;
the plugin gathers facts (terrain vocabulary, statistics, a `renderImage` PNG, the Trigger Script
plugin's `declarations` command) and applies what comes back through the ordinary API — a map plan is
a coarse legend grid turned into `paintIsom` strokes plus Melee Wizard's base geometry (`ai/layout.ts`;
since 2026-09-06 Make Scenario asks `map-plan` for the **shape language** instead — `language: "shapes"`,
statements in tiles that `ai/shapes.ts` compiles to a one-tile grid; a `plateau` with `ramps` gets its
lower corner cut at the lattice's 2:1 slope and a wide apron of the tileset's ramp pair, and `ai/ramps.ts`
fits the ramp doodad afterwards with `query.doodadPlacement`, the same for `bridge` over a channel it
paints. **Measured, not derived:** ramps fit only straight south-facing diagonal cliff runs, and only for
the pairs in `VERIFIED_RAMPS` / `VERIFIED_BRIDGES` — Ice's cliff ramps, Platform's Space walls and the
Compound/Basilica walls need pieces the brush never draws, and only Jungle's and Platform's bridges fit the
brush's shores; `DOODAD_MARGIN` keeps scattered doodads two tiles inside their ground)
vendored there), triggers come back as script and go through the Trigger Script plugin's `compile` →
repair rounds → `build` commands (`commands.has` first; the plugin says so when it is off), the
assistant panel is a tool-use loop whose tools run in the plugin. `protocol.ts` is the wire contract,
kept identical in both repositories. The editor knows nothing of it beyond the host additions above.
The plugin also owns the **Account** top-level menu, a status-bar cell, the Account dialog (balance,
ledger, storage, top-up, the two ticks) and map storage over the server's `/v1/maps`
(`ai-server/src/maps/`: maps with numbered revisions and notes, bytes keyed by account + sha256 in an
`ObjectStore` — memory / directory / GCS through a dependency-free JSON-API client — a per-role
`storageMb` cap over `maps.capMb`, checked in a transaction that locks the user row). It is the worked
example for the "built-in feel" surfaces (`dock: "right"`, `ui.statusItem`, `ui.dialogSlot`,
`view.flash`, plus an `ui.overlay` for a running tool call's footprint — `ai/intent.ts` there) and for
a contribution group put in and taken out by a setting. The server streams the `agent` recipe (text
`delta`s and a `tool_use` event the moment the model names a tool; the system blocks are on the
one-hour cache in `claude.ts#systemBlocks`), and the Scenario workflow is an `ums-design` recipe (the
design document, checked server-side against the toolkit catalogue the request carries) executed by
`ai/dialogs/scenario.ts` through `map-plan`, the players/forces update, the plugin's **toolkit**
(`ai/ums.ts`: ~20 trigger-system kinds — hyper, spawn, kill-to-cash, waves, lives, shop,
last-standing… — built by code into text triggers the editor parses; the assistant reaches it through
`ums_build` and the genre guides in `ai/guides.ts` through `guide`) and the `triggers` recipe for
`custom` systems. Check Map's scenario checks (`validate.ts#umsIssues`) are the editor-side half.

**Terrain from Image** is the first worked example and lives in its own repository,
`github.com/scm-js/plugin-image-to-terrain` (`plugin.json` / `plugin.ts` / `convert.ts` /
`icon.svg`, `@scm-js/plugin-api` as a devDependency so it type-checks alone, and
`tests/convert.test.ts` under its own vitest). It used to be `plugins/terrain-from-image/` here; it was moved out precisely so the
plugin the editor ships is loaded by the ordinary path, and its internals are documented there
(`docs/plugins.md` only points at it). Changing `src/plugins/api.ts` reaches it through
`github.com/scm-js/plugin-api`, which build.yml republishes on every push to main. `tests/plugins.test.ts` covers the host side
(loader, host, transactions, lifecycle, menu merge, context rows, picks, transfers, the defaults
list, the add-confirmation preview and install, map tools, panels, the palette API, placement, and the
real-tileset suite via `primeTileset`).

**Paint** (`github.com/scm-js/plugin-paint`, a default that starts on) is the worked example for
`ui.mapTool`, `ui.panel` and `api.palette`: `plugin.ts` is the panel, the per-tool gestures and
the transaction, `shapes.ts` / `font.ts` the pure geometry with `tests/shapes.test.ts`. Its brush
is the active layer's palette pick, so it paints on the Terrain (flat pairs or the Tile brush's
tile), Doodads, Units, Sprites and Fog of War layers alike. `docs/plugins.md` no longer describes the
plugins one by one: each repository's README does, and the guide ends with a table saying which
part of the API each one is the worked example for.

**scmscx.com** (`github.com/scm-js/plugin-scm-scx`, a default that starts on) searches scmscx.com,
the StarCraft map archive, and opens the picked map through `document.open`. There is no documented
API: `client.ts` there mirrors the routes the site's own front end uses (`/api/uiv2/search[/{words}]`
with every default parameter left out as the site does, `/api/uiv2/random`, `/api/uiv2/map_info`,
`/api/uiv2/filenames2`, `/api/maps/{mpq_hash}` for the file, `/api/uiv2/minimap` as an `<img>`),
reverse-engineered from its bundle and confirmed against the site's source
(`github.com/scmscx/scmscx.com`, `crates/bwmapserver`). The site sends **no CORS headers** and has
no CORS layer, so a page served from anywhere but scmscx.com cannot read those routes: the client
takes a list of bases (`connect()` probes each with the newest-uploads search and takes the first
that answers JSON), the plugin passes the site first and an optional forwarder from its Settings
second, and the dialog explains the block and links to the site when nothing answers. The editor
runs no forwarder of its own and must not grow one for this — the user decided that; the fix belongs
on the site (a `CorsLayer` on its GET routes).

**Section Explorer** (`github.com/scm-js/plugin-section-explorer`, not a default — installed from Browse Plugins) is the
annotated hex editor and the worked example for `api.document.sections` and `api.names`. The host side
is `src/editor/sections.ts`: `currentChk(scn)` is `parseChk(serializeScenario(scn))` — the file Save
would write, dirty sections encoded, every occurrence with its offset — `sectionInfos` decorates it
with the registry (`SectionKnowledge`: mode, the fixed size for this map, stride, `modelled` from
`MODELLED_SECTIONS` in `scenario.ts`, which is the list `encodeSection` handles), and the writes
(`replaceSectionData`, `renameSection`, `insertSection`, `removeSection`, `moveSection`, `editRaw`,
`parseRaw`) mutate that `ChkFile` and parse a fresh `Scenario` from it. `host.ts#sectionsApi` installs
the result through `documentAtoms.ts#replaceScenarioAtom` — `loadDocumentAtom` with the same file
name and extras, then modified — so a raw edit to any section, modelled or not, reaches the whole
editor, at the cost of the history (as Resize). `api.names` is the editor's own tables (`UNIT_NAMES`,
`UPGRADE_NAMES`, `TECH_NAMES`, `WEAPON_NAMES`, `PLAYER_TYPES`, `PLAYER_RACES`, the trigger defs and AI
scripts) plus the open map's strings, locations and switches, so plugins showing raw values carry no
tables of their own. In the plugin, `layout.ts` (schemas → lazily instantiated `Node` trees with
`pathAt` / `leavesIn` and per-leaf `Semantic`s) and `layouts.ts` (every section's shape and the
meanings of its fields, the string table read off its own offsets) are pure and tested there;
`buffer.ts` is the edit buffer with its own undo; `hexview.ts` and `inspector.ts` are the panes.
`tests/plugins.test.ts` covers the sections and names API against a new map.

**Repair** (`github.com/scm-js/plugin-repair`, a default that starts on) is the unprotector that explains
itself, and the worked example for the `"document"` payload, `sections.defaults` / `rebuild` / `trailing`
/ `required` and `tx.rebuildIsom`: on every `"open"` it parses `sections.file()` with its own container
reader (`chk.ts`), runs `analyze.ts` (pure: chunks + `known()` + `required()` + the default VCOD + the
ISOM report → findings, each with a level, what the game does with the file as it is, a `Repair` and a
recommended tick) and opens its dialog only when an error or warning came back; Tools ▸ Repair Map… is
the manual run. `repair.ts` applies the byte-level repairs to the chunk list by object identity (one
`replaceFile`), then the plugin runs `sections.rebuild` and one `document.edit` with `tx.rebuildIsom`.
The bytes as the map came in stay in memory until the next open for *Restore original*.
The one **content** finding is the Remastered newline-colour change: `analyze` takes the table
from `api.query.strings()` and the reading of it from `api.text` (as `TextHelpers`, so the module
stays pure and testable against a stand-in, and the colour numbering lives only in the editor —
`colors.ts` there is that interface and a `snippet` for the quote the finding carries), and answers
a payload-free `set-strings` repair, applied through `document.update` rather than `replaceFile` —
so it marks STR dirty and keeps the undo history. It runs *after* `replaceFile`, which installs a
whole new scenario and would drop it, and *before* any `sections.rebuild`, since a rebuild
re-encodes STR from the model it wrote into; the strings are read again at that point rather than
carried in the repair, since the byte-level pass may have moved them.
It is a warning with `recommended: false`: whether the map was authored before or after the
remaster is the one thing the plugin cannot know, so it explains and never ticks itself. It moved
Rebuild ISOM from Tiles out of the editor.

**Walkability** (`github.com/scm-js/plugin-walkability`, a default that starts on) is the read-only
analysis drawn over the map and the worked example for `api.ui.overlay`: `analysis.ts` there builds a
minitile grid from `api.tileset.raw()`'s VF4 words plus the ground under buildings and resources, and
computes an exact Euclidean clearance transform, 4-connected islands, a BWEM-style watershed into areas
with the chokes between them (measured with `passageWidth`), height seams (open cells at different
heights touching with no ramp), and per start pair the ground distance (Dial's) and the widest route's
narrowest point; `plugin.ts` registers one overlay at activation (`above: "objects"`, off until
switched on from View, the Layers panel, `Ctrl+Shift+W` or the panel), blits one `ImageData` per view
mode in its `draw`, reads the cell under the pointer in `onHover`, picks an area through `pickTile`,
and re-runs on the terrain/units/doodads/settings/document events while the overlay shows or the panel
is open, so the picture follows the units being placed on it. The settings panel holds the readout and
the problems; a *Details…* panel lists the rest. It never writes.

**Melee Wizard** (`github.com/scm-js/plugin-melee-wizard`, not a default — installed from Browse Plugins) places symmetric
start locations and bases: `layout.ts` there is the ring of footprint positions at the game's three-tile
Chebyshev gap from the 4 × 3 hall, the mineral line grown along it from the pointed direction (wrapping
round the hall's corner), the geyser past the line's end, the nine symmetries as point maps (an image that
swaps the axes gets the base laid out again, since a 2 × 1 patch cannot turn), and the symmetry / summary
checks; `plugin.ts` is three map tools (starts, a press-and-drag base with `api.query.placement` colouring
the preview, a blocking patch) over `placeUnit` / `canPlaceUnit` / `updateUnits` in one `document.edit`,
plus bases at every start location, mirroring the selection and the symmetry check.
