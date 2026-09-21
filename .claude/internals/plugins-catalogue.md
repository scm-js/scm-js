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
the plugin gathers facts (terrain vocabulary, statistics, a `renderImage` PNG, the TrigScript
plugin's `declarations` command with `{ compact: true }`) and applies what comes back through the ordinary API — a map plan is
a coarse legend grid turned into `paintIsom` strokes plus Melee Wizard's base geometry (`ai/layout.ts`;
since 2026-09-06 Make Scenario asks `map-plan` for the **shape language** instead — `language: "shapes"`,
statements in tiles that `ai/shapes.ts` compiles to a one-tile grid; a `plateau` with `ramps` gets its
lower corner cut at the lattice's 2:1 slope and a wide apron of the tileset's ramp pair, and `ai/ramps.ts`
fits the ramp doodad afterwards with `query.doodadPlacement`, the same for `bridge` over a channel it
paints. **Measured, not derived:** ramps fit only straight south-facing diagonal cliff runs, and only for
the pairs in `VERIFIED_RAMPS` / `VERIFIED_BRIDGES` — Ice's cliff ramps, Platform's Space walls and the
Compound/Basilica walls need pieces the brush never draws, and only Jungle's and Platform's bridges fit the
brush's shores; scattered doodads are then checked against the ground as painted. **Layout presets**
(`ai/presets.ts`: `corner-camps`, `lanes`, `arena`, `bound`, `town-regions`) are stored shape programs the design names in `layout`, sent to
`ums-design` as `presets` like the toolkit kinds; the plugin lays them out with no terrain call, so the
planner is asked only for layouts no preset describes). The assistant reaches all of it through
`ai/tools/layout.ts` — `layout_presets` / `layout_preset`, `paint_shapes` (area-relative via `shiftShapes`),
`place_ramp` / `place_bridge` (the fitters on ground already there), `reachable` (`ai/reach.ts`: a flood fill
over VF4 walkability, the check the lanes defect needed) and `scenario_rules` (ownerless players — defeated at
once, triggers dead — with `fix: true` placing an Overlord keeper)
vendored there), triggers come back as TrigScript and go through the TrigScript plugin's `compile` →
repair rounds → `build` commands (`commands.has` first; the plugin says so when it is off), the
assistant panel is a tool-use loop whose tools run in the plugin (its transcript, since 2026-09-07, is a
`widgets.fold` per turn holding a `widgets.steps` list — `Tool.describe(input, ctx)` / `Tool.report(result)`
phrase each row, with a generic fallback in `tools/common.ts`; a round's text is the answer until the round
turns out to call tools, when it is demoted to a note in the block; `groupTurns` rebuilds the blocks on
reopen; the server's agent prompt tells the model not to announce a step before taking it). `protocol.ts` is the wire contract,
kept identical in both repositories. The editor knows nothing of it beyond the host additions above.
The plugin also owns the **Account** top-level menu, a status-bar cell, the Account dialog (balance,
ledger, storage, top-up, the two ticks) and map storage over the server's `/v1/maps`
(`ai-server/src/maps/`: maps with numbered revisions and notes, bytes keyed by account + sha256 in an
`ObjectStore` — memory / directory / GCS through a dependency-free JSON-API client — a per-role
`storageMb` cap over `maps.capMb`, checked in a transaction that locks the user row). It is the worked
example for the "built-in feel" surfaces (`dock: "right"`, `ui.statusItem`, `ui.dialogSlot`,
`view.flash`, plus an `ui.overlay` for a running tool call's footprint — `ai/intent.ts` there — and
`view.reveal` to follow the calls round the map: `followBox` there is the footprint's box or null for
an empty or whole-map one, the reveal is awaited with `fit` before the tool runs, and a `"view"` event
that is neither a reveal's nor a tool's own means the user took the view — `followMap` off for the
rest of the turn; the preference is on by default) and for
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

**Stamp Library** (`github.com/scm-js/plugin-stamp-library`, a default that starts on since 2026-09-07) is the
clipboard-plus-storage-plus-panel plugin for the extended-terrain parts bin, and the worked example for the
three additions it asked of the host — `clipboard.capture` (a clip built as `copy` would but not put on the
clipboard, with a `parts` override), `tx.paste` (`pasteClip` inside `runTransaction`: its lists fold into the
entry's in `applyEntry` order, `createdMask` carried, and `serial` bumped past `nextSerial(scn)` so a later
`makeUnit` cannot reuse a pasted unit's serial) and `graphics.renderClip` (`graphics.ts#renderClip`, the
viewport's paste-ghost pass without the viewport: tiles, then units / sprites / doodad overlays from the
sprite cache, then location boxes; drawn with the graphics of the clip's *own* era via
`peekTileset(TILESET_FILENAMES[era])`, so a foreign clip is null rather than wrong tiles) — plus
`storage.set` returning `false` on a refused write. `library.ts` there is the pure half (tests): a `Stamp` is
a `Clip` + name / tags / notes / `used` / `origin`, stored as one `stamp.<id>` record (typed arrays as
little-endian base64) under an `index` of ids, the share file `{ format: "scmjs-stamps", version: 1,
stamps }` being the same records so one stamp as text and a whole library are one parser. `origin` is the
capture rectangle's corner: `snapToLattice` keeps both offsets from it even, which is what puts a piece back
on the isometric lattice it was copied off (Shift bypasses). The panel floats by default with a Dock / Float
button that closes and reopens it on the other side (`settings.dock`; the docked form was starved for height
under three built-in panels in a 900 px window). Stamping is a `ui.mapTool` whose `draw` blits the cached
full-size `renderClip` scaled to `view.tilePx`; a click is one `document.edit` with `tx.paste`, the pasted
rect then marked as a paste marks it. It captures every part (`ALL_PARTS`) and lets the stamping ticks
choose, so nothing is lost at save time; a foreign-tileset stamp can still lay down its objects.

**Magenta** (`github.com/scm-js/plugin-magenta`, not a default, 2026-09-12): the UX-first trigger editor — sentences with
chips in a resizable floating panel, one search row for native types + its EUD catalogue (`src/catalogue/eud.json`, 43
Remastered entries lowered to plain Deaths / Set Deaths records with the masked word) + Tier A+ counter copies /
comparisons / per-player copies as generated runs it claims. Its `docs/plan.md` is the design. It keeps pure copies
of `epdOf` / fingerprint / usage so its tests run without the editor; the host grew `api.triggers.epd / addressOf /
fingerprint / usage` and `consts.triggers.maskedRecord` for everyone else that day. 0.5.0 (2026-09-15) added the two
readouts: *In plain words* (prose + what the trigger shares with the list) and *Dry run*, a second panel that runs the
list from the map's state without the game (`src/model/simulate.ts` there), reporting what it cannot know instead of
guessing. Both are plugin-side only; no host addition. 0.7.0 (2026-09-17, after the `~/magenta.md` review) is the
trust pass, plugin-side only: `src/model/ownership.ts` there — a hook / scan / counter step is private to the trigger
carrying its cell, so Duplicate and Paste re-home them on fresh cells, a row's ✕ keeps a definition another trigger
still carries, Delete prunes; the store forgets its undo on any external change (a snapshot is the whole list); an
unreadable `magenta\magenta.json` (newer version / bad JSON) blocks writes behind a notice instead of decoding empty;
hooks are sent to the build server in list order; the local-read (`local: true` catalogue entries) and
deferred-location checks; the key recipe went onto MSQC. 0.8.0 (same day): `src/model/preflight.ts` — a source revision (FNV over trigger
fingerprints + the sidecar's build parts + the host's locations/units/strings strings) kept as `settings.lastBuild`
so the head's Build button says built / stale / not built; a preflight (MSQC's reserved player/unit/location slots,
rows' locations, chat messages, camera name, music present, the server's `/health` `magentaSpec` + plugin list +
maxMapBytes) that blocks the build on errors with Show links; eud-server reports `magentaSpec` (uncommitted there).
Dock: `PanelSpec.dock: "right"` + `grow` behind a `layout` storage record (`src/ui/layout.ts`), a draggable
`.mg-divider` (row or stacked under 440 px), ☰ hides the list; a docked root needs `height: 100%` because the dock's
body is a scrolling block, not a flex column.
0.8.1 (2026-09-17, uncommitted): the revision check — Magenta never reads the map's VER otherwise; `check()` takes
`fileVersion` / `versionLabel` / `magentaRow(kind, index)` and, below 206, puts an `info` problem with `code: "revision"`
under every EUD row, counter step, comparison and build row (one per grouped entry, none on a disabled row); the editor
renders those lines under its private rows too and adds one offer line with a Set revision to Remastered button
(`host.setRemastered()` → `tx.setVersion("remastered")`, STRx by default as the dialog does); the panel re-renders on the
`settings` event so Scenario ▸ Map Revision clears the lines. `info` on purpose: Remastered plays VER 205 maps with EUD
fine (SCMDraft writes 205), so the list's badge stays quiet and the lines only say the map is *marked* for an older client.
0.9.0 (2026-09-17, uncommitted): the build server is gone. `plugin.json` `requires: ["github:scm-js/plugin-eudplib"]`
(the host's new manifest field); `src/ui/build.ts` takes `api.services.get("eudplib.build")` (contract vendored as
`vendor/eudplib.ts`, `import type` only), calls `ensure({ reason })` — the library's own install dialog — then `build({ map,
plugins, sources: { magenta: MAGENTA_PY } })`; `python/magenta.py` moved in from eud-server and `scripts/embed-python.mts`
writes it into `src/generated/magentaPy.ts` (`tests/python.test.ts` fails on drift and pins its `SPEC_VERSION` to
`MAGENTA_SPEC_VERSION`, so the two halves of the spec ship together and the old `/health magentaSpec` preflight is
unnecessary); `preflight.ts` `ServerHealth` → `Runtime | null` (one error when the library is off), `LastBuild` lost
`server`; Settings lost the Build server field; the dialog watches the service so Manage Plugins toggles re-render it.
The probe-map script's `--build URL` still speaks the old server's route — to move onto the library's Node runner.

**eudplib** (`github.com/scm-js/plugin-eudplib`, not a default, 2026-09-17, v0.1.0 tagged and on jsDelivr) is the library
plugin behind every EUD build: eudplib 0.81.0 compiled for Pyodide (`wheel/eudplib-wasm.patch` gates the StormLib
wrapper behind a `stormlib` cargo feature and drops the epscript/babel build steps — build config only, the recipe and
the Docker toolchain are in `wheel/`; the spike that proved it is `~/github/eudplib-wasm`, byte-identical CHKs against
the native euddraft on 3 of 4 captured Magenta payloads, the 4th a hash-seed ordering swap), euddraft's `pluginLoader.py`
and eight bundled plugins at a00aef1, `python/driver.py` (LoadMap → hooks → CompressPayload → SaveMap, no freeze, no
message boxes) and `python/mpqshim.py` (the eight-method archive class over an in-memory registry, set onto the
extension module through a fake `eudplib` package entry before the real import; `platform.system` answers Linux while
eudplib imports). The service is `eudplib.build` (`contract.d.ts`; `provide("build", …, { version: 1 })`): `versions`,
`state()`, `downloadBytes`, `ensure({ reason })` — the modal install dialog, one shared in-flight install, decline not
remembered — and `build({ map, plugins, sources, files, options })` (`files`, 0.2.0: data files written to `/work/files/<name>`
for a plugin setting to name — TrigScript's IR goes this way; the value rule forbids only backslash paths, so a forward-slash
path is a legal setting). mopaq is bundled for the archive halves (`src/archive.ts`);
the Python is inlined into `dist/worker.js`; the worker is a `blob:` bootstrap that `import()`s `dist/worker.js` from the
plugin's own tag on jsDelivr (the vendored-worker trap), Pyodide 314.0.7 from its CDN, `typing-extensions` from
Pyodide's distribution; the eight download files (14.7 MB) go into `caches.open("eudplib-<versions>")` as the "installed"
state and the worker's own fetches hit the HTTP cache. **One build per worker**: eudplib keeps the map and the game
loop in module state and a second `LoadMap` fails with "Game loop start is already set", so every build starts a fresh
Python (~2 s from cache; a probe map builds in 3.7 s in the browser, measured headlessly 2026-09-17 through Magenta's
dialog on the v0.1.0 tag). A caller's `sources` land in `/ed/plugins/<name>.py`, so a caller can shadow a bundled plugin
— Magenta ships `magenta.py` this way and eud-server (Cloud Run, `eud.scmjs.dev`) is superseded. `scripts/smoke.mts`
runs the built worker under Node with the `pyodide` npm package as the CDN stand-in.

**TrigEdit** (`github.com/scm-js/plugin-trigedit`, a default since 2026-09-07 that starts **off**: the text syntax is for
people carrying triggers in from SCMDraft, and the Trigger Editor and TrigScript cover the rest) is the Text Trigger
Editor, moved out of `TriggerDialogs.tsx` as a ~100-line dialog over the editor-owned format: `text.ts` there is the
pure half (the comment fencing over `api.triggers.claims`, the error line off `TriggerTextError.line`, the gutter and
status words; tests), `plugin.ts` the dialog — radios, Compile / Format / Reload, word wrap, a `<textarea>` with a
gutter, the `Compile & Close` / `Cancel` / `Apply` footer — compiling with `tx.triggers.fromText(text, { replace: true })`
(or `tx.briefing`) inside one `document.update`, so a parse error leaves the map untouched. It is the worked example
for the two host additions it asked for, `triggers.claims()` and `DialogSpec.slot` (it offers `"trigedit.text"` with a
live `text` field and a `briefing` payload getter, which is where scmjs.dev ≥ 1.14.5 mounts Explain / Write / Ask).
Menu item `Triggers ▸ Text Trigger Editor…` with `after: "Trigger Editor…"` and the `Ctrl+Shift+T` hotkey, both
formerly the editor's; TrigScript's `after: "Text Trigger Editor…"` anchors on it, hence its place before TrigScript in
`defaults.ts` — with TrigEdit off there is no such item and TrigScript's goes to the end of the menu, which is what an
unfound anchor does anyway. The `trigedit.open` command takes `{ briefing?: boolean }`. No bundle weight moved (a textarea), so the
case for the move is the growth it allows — highlighting, completion, Monaco — without the editor carrying it; if it
grows Monaco it should take TrigScript's loaded copy through `api.services` rather than download a second one.

**TrigScript 3.0.0 (2026-09-18)** dropped the death-counter back end: `program()` is Remastered only, built by the
eudplib plugin at save time. It is the worked example for `buildSteps.before` (apply the script ahead of the bytes) and
for contributing to the eudplib library's one build step (`eudplib.contribute`), and it no longer writes a `-eud.scx`
beside the map or has a Build / target switch. `tests/trigscript-guide.test.ts` accepts an example that makes a program
and no trigger. Pinned as the default 2026-09-18 after the probe was played; the guide's five pictures were retaken the same day
(`--scenes trigscript`), on a script that also has plain `trigger()` calls, since a program adds no row for the Trigger
Editor picture to badge, with waves four seconds apart so Simulate's 480 frames reach the last one.

**TrigScript 3.1 (2026-09-18)** relaid the workspace as VS Code lays one out — `shell.ts` is a script-agnostic frame
(Explorer sections, tabs + icon actions, a bottom panel of views, status bar items, keyed corner notifications, a popup
menu), `editor.ts` the controller over it, one `commands` table feeding the capture-phase key handler, the … menu and
Monaco's palette. Icons are codicons through the font Monaco's stylesheet already inlines. It is what the host's
`DialogSpec.flush` / `buttons: []` and `PanelSpec.flush` exist for. The guide's scene drives it by keys (Ctrl+F5,
Ctrl+Shift+B) and reads `.tsd-statusbar` / `.tsd-view .tsd-list`; the dialog is closed by `.dlg-close`.

**TrigScript 3.2 (2026-09-18)** is slice 2 of its plan — reads, text with values, `random(n)`, the bitwise operators,
IR version 3 — and touched nothing in the host. A read is a comparing condition called without its comparison and amount
(plus plainer names and the player facts); its lowering reads the game's table where one is the value and otherwise
searches with the condition itself, so a read means what the condition means. `name(p)` / `color(p)` travel inside a
string as private-use marks, which only `displayText` / `print` inside a program accept. What the probe taught, for
anyone reading the game's tables: a Use Map Settings computer's slot byte (0x57F1B4) is 5, a melee one's 1; Elapsed Time
and the countdown count game seconds of sixteen frames. The guide's examples use the new calls, so
`tests/trigscript-guide.test.ts` needs the vendored plugin at 3.2.0 or later. No picture changed.

**TrigScript 3.3 (2026-09-18)** is slice 3 — units on the map as objects (`unitsAt` / `unitsOf` / `allUnits` loops,
`first` / `nearest` / `randomUnit` picks, fields, verbs), `stats()` over the game's tables, IR version 4 — and again
touched nothing in the host's API. The brand `Unit<n>` of a unit *type* became `UnitType<n>` and `Unit` is the instance
(the plan had this in slice 1; it happened here, with a hint appended to the TypeScript error a script using the old
name gets). `stats(x)` is one function for five tables: the index is a plain number when the script runs, so the
compiler reads the `__kind` brand off the argument's type and hands it to the runtime as a second argument. A unit
variable is pointer + EPD + the slot's uniqueness byte, checked before every use (sprite, order not "die", same byte);
the unit of a loop's turn is not checked, which is why a `sleep()` inside a unit loop is an error and not a feature.
The scans walk all 1700 slots with conditions whose address is bumped per slot (eudplib's EUDLoopUnit2 trick) and
pass over dying units, so `first()` after `kill()` is the next unit. `compiler/tables.ts` is the one list of `stats()`
fields, every one taken from Magenta's verified catalogue. Simulate now starts from the map's placed units and
locations (`editor.ts#simulatedMap`). The guide's examples use the new calls, so `tests/trigscript-guide.test.ts` needs
the vendored plugin at 3.3.0 or later: the README change and the pin land in one commit. **This slice found the unit
classes one too low in the editor** (`UnitClass` had Any unit 228 … Factories 231; the game has 229 … 232, 228 being
"None" — a Blizzard melee map's defeat trigger is "commands at most 0 of 231", Buildings): fixed in `sections/triggers.ts`,
in both plugins' vendored copies, and `api.names.units()` gained a "None" entry at 228 so that an entry's place is
still its value.

**TrigScript 3.4 (2026-09-18)** is slice 4 — what the players do: `keyPressed`, `clicked`, `mouse`, `underMouse`,
`chatted(p, "-spawn {n} {what:unit}")` with captures typed from the pattern by template-literal types, and
`centerLocation`; IR version 5; nothing in the host's API. The build gains two of the eudplib library's bundled euddraft
plugins, composed by the compiler (`compiler/input.ts#buildPlugins`), in this order: chatEvent → trigscript → MSQC →
eudTurbo. Both plugins take a *name* from eudplib's namespace wherever they take an address or a death-counter unit,
so the lowering registers `EUDArray(12)`s / `EUDVariable`s (`tsin_*`) and nothing of the map's — no death counter,
switch or string — is used (Magenta uses death counters because its rows are ordinary trigger conditions). chatEvent is
given no messages: it only finds the local player's line, the lowering matches every pattern itself on that computer,
and the pattern's number and up to three values go through MSQC's `val` to everyone (chatEvent's own result is local —
it prints "desync" beside it). That is why a typed number stops at 2²⁰ − 1 and a pattern has at most three captures
(a command unit per human each). What it does take: one free location among the first 63 for MSQC, eight more in a row
when the mouse is read (allocated highest-first from the names the compile was given; a map with no room gets a
diagnostic), unit type 58 and `QCPlayer: 11` — the values Magenta's probes were played with (MSQC reads 11 as
0-based, so Player 12). An input is an `input` leaf expression that never counts as "moving" for the sleep rule;
`chatted()` / `mouse()` initialisers become records of the program's numbers, the former with a `truth` boolean on the
binding so `if (m)` and `m != null` work; the input functions throw while the script's own statements run
(`Collector.running`), since `if (keyPressed(…))` outside a program would be a truthy object. An action's `variable`
became `variables` (a unit type may be one, stopped at 228 in the lowering). **This slice found the lowering one frame
slow**: `sleep(n)` set the wait to n and the frame entry spent a frame counting it down, so `sleep(frames(1))` ran every
other frame — half of all one-frame inputs would have been missed; the wait is n − 1 now, as the simulator always had
it. The interpreter has `press` / `click` / `type` / `moveMouse` for slice 5's `test()`; the editor's Simulate presses
nothing and says so. The probe was played three times and everything passed but one key: **the game never reports F6**
(silent when first in MSQC's settings and silent when third; F7, F8, `1`, Q, W, E answered), so `input.ts#DEAF_KEYS`
keeps it out of the `Key` type and `keyPressed` says why to a script that gets past the types. As with 3.2 and 3.3 the guide's new examples need the vendored plugin at 3.4.0: README and pin in
one commit.

**TrigScript 3.5 (2026-09-18)** is slice 5 of a plan whose order changed that day: the language before the tooling
(5 signed numbers, 6 arrays and keyed tables, 7 functions that are called, 8 recursion, then 9 `test()` + debugger and
10 examples — each of 5–8 changes what a debugger has to show, and each has a probe to play). A program's `number`
is a **signed 32-bit integer** wrapping as `x | 0`, with `u32` beside it and `u8` / `u16` stopping at both ends;
division is towards zero, `>>>` is apart from `>>`, a number below zero prints its minus sign. Programs are Remastered
only since 3.0, so stopping at 0 — parity with a death counter — had nothing left to match. The design that keeps it
cheap: `compiler/numbers.ts` is a pass over the IR (IR 6) that types every number once and writes `unsigned` into the
five operations that care (a comparison — `true | "left" | "right"`, a number against a `u32` compared exactly —
`/ %`, `min` / `max`, a printed number, and `>>` → `>>>`), so **neither backend works a type out**; it removes the
casts (`u32(x)`, `i32(x)`, `x >>> 0`), refuses a number mixed with a `u32` in arithmetic, and writes `max(v, 0)` where
a signed value goes into the game unless it can see the value is never below zero — including a variable into which
only such values are ever stored (a fixpoint over a first pass that must *keep* the casts, or the second pass has lost
the types). So the backends' stores are what they were. In the Python a signed order is both sides plus 0x80000000,
division is eudplib's `f_div_towards_zero` (a constant divisor goes in as a signed int), a signed print is a `ptr2s` of
"-" or "" before the magnitude. Breaking for a script that counted on stopping at 0: the plugin's README says declare a
`u8` / `u16` or write `Math.max(x - 1, 0)`. The probe (`probes/numbers.ts`, also a build fixture and checked line by
line against the simulator) was played once, every line as expected. README and pin in one commit, as before.

**TrigScript 3.6 (2026-09-18)** is slice 6: arrays, and with them a **heap**. A fixed array (`let hp = [10, 20, 30]`, a
variable index, `for…of`, per player or `shared`) is static cells; a list the script made, indexed by a value of the
program, is a read-only table in the map; and an array something pushes to is a handle on a block of a pool every program
shares — powers of two, a full block exchanged for one twice the size, a given-back block kept for the next array of that
size, and **a declaration first gives back what its handle held**, which is what stands in for a collector. The user
turned down a declared capacity ("is it truly growable then?"), asked for the pool's size to be a setting — it is one of
the *map's* (`trigscript\settings.json`, the workspace's Settings view, Ctrl+,), because the built map depends on it —
and asked about a stack: the pool's top is reserved for slice 8's saved frames, and locals stay cells of their own because
a condition or an action reaches a cell directly. The simulator counts blocks exactly as the lowering hands them out, so
both run out at the same push; the probe's 20 000 pushes at 500 a frame did not stutter and stopped at 4 096 in both.
`Record` / `Map` / `Set` keyed by the library's branded ids are arrays with a cell an id, front end only. One compiler
change with reach: of a method call that is not known at build time the *object* is hoisted, not the method. The user
then asked for the whole slice before shipping: **arrays of records** are an array a field with a record of one a
binding of *cells* (so `w.delay = 9` writes the array and `const w = waves[i]` copies the index, not the record — a
reference, as TypeScript's is), a list of records of the script is a table a field (the wave table), **arrays of units**
are three arrays of numbers behind two IR nodes (`unitPart` gives a unit's pointer, EPD and uniqueness byte, `unitAt`
makes the unit of three numbers again, re-checked like any kept unit — which is why a squad, unlike a loop over the game's
units, may be kept across a `sleep()`), and `for…of` over a `Map` or a `Set` is a `for` over every id with the body under
an `if`. IR 9.

**TrigScript 3.7 (2026-09-19)** is slice 7: **functions that are called**. The decision is made while the body is walked,
not before it: a function is inlined where it is first met, exactly as 3.6 did (so a function used once builds into what
it always did — `spawn(3)` still unrolls), and met again *at the same arrays* the front end tries it with every parameter
a variable, the attempt's diagnostics swapped out and thrown away. It fails when the function sleeps (the program wakes up
inside it), holds a `rose()` / `once()` (a latch belongs to a place in the source), or does not compile that way (the
player of `setResources(p, …)`); then it stays inlined and the hint on its line says why. When it holds, the *first*
call's node is changed in place to match. After the walk, a function left with one call that is still part of the
program is inlined there again, and arrays no node names are dropped. Turned down: two full passes (an array's identity
differs between them, and a function that takes an array is a copy *an array passed*) and trying at the first call (a
function used once would lose `n = 3` folding into its body). IR 10 is `Program.functions` and `Call.fn`; every argument
is worked out before any parameter is set, since an argument may be a call of the same function. The lowering makes each
an `EUDFunc` of **no arguments**: parameters and results are the program's own cells, a row a player, so nothing of
eudplib's argument passing is used — which is also what slice 8's saved frames need. Ten calls of a fifteen-statement
function measured 735 objects for 1462 and a built map of 53 KB for 81 KB. With it: the Simulate view lists the
interpreter's faults first, and an array written empty is one that grows whoever pushes to it. The probe
(`probes/functions.ts`, also a build fixture and checked line by line against the simulator) was played once, every line
as expected, 2000 calls in one frame without a stutter. README and pin in one commit, as before.

**TrigScript 3.8 (2026-09-19)** is slice 8: **recursion**. A function's cells are the program's own, one of each, so a
function that comes back into itself would write over what its outer run needs. The front end makes a function a called
one the moment it meets it inside itself (no second call from outside needed; the outer inlined walk is thrown away),
and `compiler/recursion.ts` — after the numbers are typed and after the program has been checked as the script wrote it,
since a rewritten loop would trip the frozen-loop check — finds the cycles of the call graph and makes each function on
one safe to re-enter. **Every call that may come back is a statement of its own**, because a backend computes an
expression through temporaries no frame knows of: operands to its left go into temporaries, and `?:`, `&&`, `||` and
loop conditions holding one become the `if`s they mean. Each such call carries `saves` — every variable of its function
but the call's own result, no liveness on purpose — and the handles of the arrays declared in the function, which the
pass makes growing ones so a frame keeps four cells and not the array. IR 11. **eudplib's `EUDFunc` cannot recurse** (one
return address, and not callable until its body is whole), so the lowering gives a recursive function triggers of its
own ended by one whose next-trigger field is the return address, kept a second time in a variable because reading
memory back costs some thirty-five triggers and writing a variable out two. Decided with the user: the limit is a
**depth in calls** in the workspace's Settings beside the heap's size (1 024; 16 to 65 536; the IR file's `stack`), and
the stack is **an array of its own**, not the heap's top as slice 6 left it, so that an overflow never depends on what
the arrays hold and Simulate and the game stop at the same call. The interpreter runs such a body apart from its caller
(`ProgramRun.drive`): nested generators ended JavaScript's stack near a thousand deep. Refused: a function that sleeps
and calls itself, such a call inside a loop over units, a function that calls itself on every path. Riders: a parameter
given a plain value may be assigned, and `c ? 1 : 0` is a number. Not fixed, found on the way: the Python's `and` / `or`
evaluate every side (EUDAnd over conditions already built) where the interpreter short-circuits. The probe
(`probes/recursion.ts`) was played once: as expected, the overflow said in red. If `fib(20)` in one frame ever pauses too
long, the plan has the faster stack (variable triggers chained frame by frame, a trigger a cell to bring back).

**TrigScript 3.9 (2026-09-19)** is slice 8½, six parts and their leftovers, each with a probe that was played: **the
array methods that take a function** (the arrow is copied into the loop the method becomes — front end only, which is why
a function cannot be kept as a value), **patterns and spread** (front end only), **arrays inside things** (IR 12: a
grid is one flat array read at `y * w + x`; rows that grow are four arrays of handles, the holder owning the block),
**texts as values** (IR 13: a text only ever given literals is its number in the built map's string table, a made text
is bytes in a heap block with its length kept in a third cell, a character is a code point; the objectives, a
leaderboard's label, a transmission and a unit type's name take a made text through a string the build reserves per
kind, written only on the computers of the players the action is for, because the game re-reads those on every draw —
the spike that found this was played), **classes** (an instance is a record, a method a function handed the instance,
the class of every instance settled at build time; IR 14 is a text in the cells of a row; an instance pushed to an array
is constructed on its row) and **a `Map` / `Set` over any number or over units** (open addressing written as IR by the
front end, no IR change, JavaScript's insertion order, tested against JavaScript itself; a unit's key is its place plus
its uniqueness byte sixteen bits up). The last step before shipping was a documentation pass: the plugin README's
*Programs* got headings, a contents table, *TrigScript beside TypeScript* and *What a program does not have*, with
`tests/readme.test.ts` compiling every example; the guide's section here got the same features, four examples and a
shorter copy of the comparison table — **keep the two tables in step**. Writing the examples found three front-end
gaps, mended in the release: a loop emptied by the *value* of `pop()` was refused as never changing, a comma in a
`for`'s update was refused, and `names.pop() ?? other` of an empty array of texts gave "" — the last changed the IR a
text pop emits (a `textTernary` on the length), built through eudplib but not replayed in the game. Next is slice 9,
`test()` and the debugger.

**TrigScript 3.10 (2026-09-20)** is slice 9, which changed nothing of the language and needed no probe (nothing reaches
the Python): **folders in the Explorer** (`tree.ts`: the files as a tree; a move rewrites the imports that pointed at
what moved, with an Undo on the notice), **a simulated world with units and players** (`compiler/world.ts`, shared by
the trigger interpreter and the programs': `createUnit` makes units, the unit actions act on them, `bring` / `command`
count them, a reused place of the unit table has another uniqueness byte; with the map's player settings a program or a
trigger of a force runs for each of its players — so Simulate of a script that waits for the enemy to die now waits,
where unit conditions used to be false) and **`test()`** (`compiler/testing.ts`: Vitest's names, imported from
`"trigscript"` and never globals; a world of its own per test as `sim`; run in the compile worker after a compile that
went through, the report plain data; margin marks, the failure at its line, a Testing view in a new activity bar, Test
Results, a per-map setting that lets a failing test refuse the build). **Test (F5) became Play (F5)**, the user's
decision, and a program takes a `name`. 3.10.1 the same day: what several players did alike in a frame is one Simulate
row (`P1–P8 · …`) — found when the guide's Simulate picture, on an eight-player map, no longer held the waves. The guide
has a *Tests* part and a sixth picture (`trigscript-tests`, a second script `TRIGSCRIPT_TESTS` in
`scripts/guide-screenshots.mjs`); all six were taken again because the workspace gained the activity bar.
`tests/trigscript-guide.test.ts` now runs the tests inside an example that has any, so it needs the vendored plugin at
3.10.0 or later.

**3.10.2 (2026-09-20), after an outside review (`~/trigScriptReport.md`):** the variable hover says what a number is
(`describeVariable` — it still said "never below 0", false since 3.5); **the compile never runs on the main thread** —
blob module, then a fresh worker on the release's `dist/compiler.js`, then `CompilerUnavailable` with a 5 s memory, where
there used to be a main-thread fallback that an endless build-time loop could freeze; a TrigScript fetched as its one
built bundle (a registry install, not this compiled-in default) handed its worker a blob with no `compileScript` in it
and every compile failed — the worker now reports that as fatal and the bundle route takes over; a failed Save build
reads *Saved without its programs* and a good one *edited since* once the script changes. The shared plugin CI gained
an `artifacts` input so `dist/compiler.js` is compared with its source at a tag as `dist/plugin.js` is.
