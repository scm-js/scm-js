# The plugins themselves

One entry per plugin repository: what it is, which part of the API it is the worked example for,
and the design points and traps that cost something to settle. The reader's version is the table in
`docs/plugins.md#plugins-to-read`; each repository's README documents its own internals. The pinned
versions of the defaults are `src/plugins/defaults.ts` and nothing here; a version named below is a
compatibility fact (what an older copy lacks), not a pin.

The defaults, all starting on except TrigEdit: Aftermath, Paint, Repair, scm-sim, scmjs.dev,
scmscx.com, Stamp Library, Terrain from Image, TrigEdit, TrigScript, Walkability. The rest are
installed from Browse Plugins: Melee Wizard, Section Explorer, Magenta, Trigger Map, Timelapse, the
Mod Editor, Hello World, the API Playground.

## The defaults

**Aftermath** (`github.com/scm-js/plugin-aftermath`) is the replay viewer: it claims the replay file
type, opens the replay's map view-only through `document.open`, and draws its own map view in the
map's place, with docked and bottom panels for the timeline, charts and analysis. It `requires`
scm-sim, whose `analyse` it plays a replay through to get what happened in it, and at scmjs.dev it
shows the game itself (the play page's game view) in the map's place. It is the worked example for
claiming a file type, view-only maps, a map view in the map's place, game icons and chart tooltips.
The editor side of view-only documents and the map view is `plugins-host.md`.

**Paint** (`github.com/scm-js/plugin-paint`) is the worked example for `ui.mapTool`, `ui.panel` and
`api.palette`: `plugin.ts` is the panel, the per-tool gestures and the transaction, `shapes.ts` /
`font.ts` the pure geometry with `tests/shapes.test.ts`. Its brush is the active layer's palette
pick, so it paints on the Terrain (flat pairs or the Tile brush's tile), Doodads, Units, Sprites and
Fog of War layers alike.

**Repair** (`github.com/scm-js/plugin-repair`) is the unprotector that explains itself, and the
worked example for the `"document"` payload, `sections.defaults` / `rebuild` / `trailing` /
`required` and `tx.rebuildIsom`. On every `"open"` it parses `sections.file()` with its own
container reader (`chk.ts`) and runs `analyze.ts` (pure: chunks + `known()` + `required()` + the
default VCOD + the ISOM report → findings, each with a level, what the game does with the file as it
is, a `Repair` and a recommended tick). `plan.ts` splits them, because the user found a dialog on
open annoying "since it's going to be on basically every map": **safe** = `repair && recommended`,
made straight away on open with `replaceFile(…, { asOpened: true })` so the map stays unmodified (a
rebuild / `tx.rebuildIsom` is settled by one more `replaceFile(sections.file(), { asOpened: true })`);
**review** = any other error or warning; **notes** = other info. What is left shows in a
`ui.statusItem` cell ("Repaired 3 · 1 to review", none for a clean map) that opens the dialog:
per-finding *Apply* buttons, a folded *Repaired* list with *Undo* (= Restore original, which marks the
map modified — the plugin cannot tell whether a Save happened since), notes and an *Advanced* fold.
The safe pass is skipped when the map is already modified by the time the async check lands, or a
`sync` session is running (it would broadcast a whole replace); the cell then says "Repair: N to
fix". The Preferences page is a select, key `on-open`: `auto` (default) / `ask` (a dialog when an
error or warning came back) / `off`; the older `ask-on-open: false` reads as `off`. Tools ▸ Repair
Map… is the manual run. `repair.ts` applies the byte-level repairs to the chunk list by object
identity (one `replaceFile`), then the plugin runs `sections.rebuild` and one `document.edit` with
`tx.rebuildIsom`. The bytes as the map came in stay in memory until the next open for *Restore
original*. Rebuild ISOM from Tiles lives here, not in the editor.

The one **content** finding is the Remastered newline-colour change: `analyze` takes the table from
`api.query.strings()` and the reading of it from `api.text` (as `TextHelpers`, so the module stays
pure and testable against a stand-in, and the colour numbering lives only in the editor — `colors.ts`
there is that interface and a `snippet` for the quote the finding carries), and answers a
payload-free `set-strings` repair, applied through `document.update` rather than `replaceFile` — so
it marks STR dirty and keeps the undo history. **Order matters**: it runs *after* `replaceFile`, which
installs a whole new scenario and would drop it, and *before* any `sections.rebuild`, since a rebuild
re-encodes STR from the model it wrote into; the strings are read again at that point rather than
carried in the repair, since the byte-level pass may have moved them. It is a warning with
`recommended: false`: whether the map was authored before or after the remaster is the one thing
the plugin cannot know, so it explains and never ticks itself.

**scm-sim** (`github.com/scm-js/plugin-scm-sim`) is the way from the editor to scm-sim, the game
engine served beside it at `/play/`. It is a library plugin with no runtime of its own: the engine is
another program on the same origin (private, never vendored), and the plugin only talks to its pages
by message — the worked example for a service that talks by message to another page, with progress
and cancellation. One service, `scm-sim.engine` version 1 (`contract.d.ts`):

- `present` (is there a play page beside this editor — `src/address.ts`, scmjs.dev or a localhost
  stand-in under `/editor/`) and `status()`, whose flags (`pathing`, `measure`, `tests`, `copies`,
  `debug`, …) say what the play page beside this editor answers. **Every call beyond `analyse` needs
  a play page deployed with it**: on an older page the flag is null and the call rejects in words, and
  callers (TrigScript, Walkability, Aftermath) hide the feature rather than fail.
- `analyse(replay, { onProgress, signal })` → a `ReplayTimeline` (units born / done / morph / given /
  died, each player's numbers every 48 frames, research, positions). The timeline's types are a copy
  of scm-sim's `src/analysis/timeline.ts`; `ReplayTimeline.version` says which form (2: a `died`
  event names the unit the game credited with the kill; 3: `check.parted`, the frame from which the
  game the engine played is no longer the replay's, the engine taking replays from 1.18 and
  Remastered by rewriting them in 1.16.1's form).
- `play(map?)`, and `playReplay({ replay, name, frame, player })`: the replay opened on the play page
  paused at `frame`, through the player's eyes (Aftermath's *Play From Here*).
- `pathing(scenario?, options)` → a `PathingResult` (the game's region partition as a minitile grid,
  and test units walked by the game between the start locations, each with its outcome, frames and
  route; left out, the scenario is the open map's `export({ format: "chk", built: false })`). A
  StarEdit copy of the game is enough for it; nobody plays.
- `measure(scenario?, options)` → a `MeasureResult`: groups (`count` ≤ 12 made at `from`, one alone
  then all, each unit's `times` as it gets two tiles past the middle of the way) and bases
  (`starts` / `bases`, minerals per game minute at each worker count, read from the base's own
  fields). The engine starts these games with a fixed seed, so the numbers repeat.
- `test`, `testCopies` and `debug`: TrigScript's in-game tests, tests of several players, and the
  debugger.
- The game view hands on the wheel turned over it (`onWheel`, with the map pixel under the pointer)
  and says the map pixel under the pointer (`onPointer`, null off it); Aftermath gives them to the
  editor's zoom (`MapViewHandle.wheel`) and status bar (`MapViewHandle.setPointer`).

`src/bridge.ts` frames `/play/analyse.html` out of sight (`scmjs.sim.ready / analyse / progress /
result / error / cancel`; the frame sits behind a `FrameHost` so the conversation is tested without a
DOM); `src/play.ts` is the `scmjs.play` hand-off. It is a test target (`ui.testTarget`): "This
browser" on Preferences ▸ Testing with the game-type form (`src/page.ts#testSettingsForm`) under it,
Tools ▸ Test in Browser drawn by the editor; on an editor without the call, the old Tools item and the
form on its own page come back (`src/target.ts#testTargetCall`). Tools ▸ Debug Triggers in Browser
(`src/debug.ts`, logic in `src/debugModel.ts`) frames the play page in a bottom panel
(`ui.panel({ dock: "bottom", height: 440 })` — the host honours `height` for a bottom panel, though
`PanelSpec.height`'s comment says floating only) and hands it the built map with `debug: true`. The
built map's TRIG rows are matched to the editor's by bytes in the plugin, so no host API was added;
rows a build step added open nothing.

**scmjs.dev** (`github.com/scm-js/plugin-scmjs-dev`) is the account and the AI in one plugin, and its
server (`github.com/scm-js/ai-server`, Fastify + Caddy + Postgres, one image on GHCR) is a service the
project runs at `api.scmjs.dev`. **One plugin, not two**: an account plugin and an AI plugin following
its sign-in through `api.services` (`github.com/scm-js/plugin-ai`, archived with a notice) needed a
shape-matched copy of the contract, a provider delegation, two Settings dialogs, two status cells and
an activation-order dance for one relationship with one service. The rules:

- The plugin has **no field for a server or a token** (the server keeps `access.tokens` for an
  operator's own tools and forks). The one way to point a development build at a local server is the
  `?scmjs-server=` query on the editor's address (`account.ts#serverOverride`, stored, cleared by
  `?scmjs-server=` empty, shown in the Account dialog only while in use).
- With **no session stored the plugin makes no request at startup** (a session from last time is
  refreshed so the status bar shows the balance) — a default that phoned home was the thing the
  game-data resolver was cleaned of.
- *Use the AI features* (`Settings.ai`, in the Account dialog's settings and at the top of Tools ▸
  AI ▸ Options…) puts the whole AI group in and takes it out again — `ai/install.ts` keeps every
  `Disposable` and returns the cleanup, `slots.ts` likewise — leaving the account and the maps.
- One **Quality** choice (`quick` / `standard` / `thorough` → effort `low` / the server's per-recipe
  default / `high`, `ai/ui.ts#QUALITY_EFFORT`) and **no model id shown anywhere**; the runner says
  "Asking scmjs.dev…"; a failed request links to the Account dialog (sign in / top up), never to a
  settings screen.
- The AI runs on **the person's own Anthropic key** unless their role pays for it (admins):
  Preferences ▸ scmjs.dev ▸ *Your Anthropic key*, checked by the server's free `POST /v1/key/check`
  before it is kept, and sent with recipe calls only — never in the service's `headers()`, so
  Aftermath cannot cast on it. The server never serves `cast` or `/v1/speech` to an own key (the
  voices are its ElevenLabs account); `api.scmjs.dev` runs with `AI_SERVER_BYOK=1`.
- The assistant **keeps the server's `<map_state>` block** in its history: the `agent` answer hands
  it back (`output.state`) and `keepState` puts it at the end of the message it was added to.
  Without it, every request sent that message changed, and the models — which drop a replayed
  thinking block, and every later one, when the conversation before it changed — ran each round
  without the earlier rounds' reasoning. The server's call log counts what is still dropped
  (*Thinking lost* in `npm run report` and on `/admin`); the history trim (`trimHistory` /
  `fitHistory`) still drops it once per trim, by design.

The server holds the Anthropic key for the roles it pays for, the prompt recipes, the access rules
(per-IP and per-session budgets, and *accounts*: a free trial session per browser, Discord sign-in
through a provider interface, roles with a weekly allowance or `unlimited`, purchased credit through
Stripe Checkout, an account page, `/v1/admin/*` for the site) and never any game data. The plugin
gathers facts (terrain vocabulary, statistics, a `renderImage` PNG, the TrigScript plugin's
`declarations` command with `{ compact: true }`) and applies what comes back through the ordinary
API. Make Scenario asks `map-plan` for the **shape language** (`language: "shapes"`, statements in
tiles that `ai/shapes.ts` compiles to a one-tile grid; `ai/layout.ts` turns the grid into
`paintIsom` strokes plus Melee Wizard's base geometry). A `plateau` with `ramps` gets its lower
corner cut at the lattice's 2:1 slope and a wide apron of the tileset's ramp pair, and `ai/ramps.ts`
fits the ramp doodad afterwards with `query.doodadPlacement`, the same for `bridge` over a channel it
paints. **Measured, not derived:** ramps fit only straight south-facing diagonal cliff runs, and only
for the pairs in `VERIFIED_RAMPS` / `VERIFIED_BRIDGES` — Ice's cliff ramps, Platform's Space walls and
the Compound/Basilica walls need pieces the brush never draws, and only Jungle's and Platform's
bridges fit the brush's shores; scattered doodads are then checked against the ground as painted.
**Layout presets** (`ai/presets.ts`: `corner-camps`, `lanes`, `arena`, `bound`, `town-regions`) are
stored shape programs the design names in `layout`, sent to `ums-design` as `presets` like the
toolkit kinds; the plugin lays them out with no terrain call, so the planner is asked only for
layouts no preset describes. The assistant reaches all of it through `ai/tools/layout.ts` —
`layout_presets` / `layout_preset`, `paint_shapes` (area-relative via `shiftShapes`), `place_ramp` /
`place_bridge` (the fitters on ground already there), `reachable` (`ai/reach.ts`: a flood fill over
VF4 walkability) and `scenario_rules` (ownerless players — defeated at once, triggers dead — with
`fix: true` placing an Overlord keeper).

Triggers come back as TrigScript and go through the TrigScript plugin's `compile` → repair rounds →
`build` commands (`commands.has` first; the plugin says so when TrigScript is off). The assistant
panel is a tool-use loop whose tools run in the plugin; its transcript is a `widgets.fold` per turn
holding a `widgets.steps` list — `Tool.describe(input, ctx)` / `Tool.report(result)` phrase each row,
with a generic fallback in `tools/common.ts`; a round's text is the answer until the round turns out
to call tools, when it is demoted to a note in the block; `groupTurns` rebuilds the blocks on reopen;
the server's agent prompt tells the model not to announce a step before taking it. `protocol.ts` is
the wire contract, kept identical in both repositories. The editor knows nothing of it beyond the
host additions.

The plugin also owns the **Account** top-level menu, a status-bar cell, the Account dialog (balance,
ledger, storage, top-up, the two ticks) and map storage over the server's `/v1/maps`
(`ai-server/src/maps/`: maps with numbered revisions and notes, bytes keyed by account + sha256 in an
`ObjectStore` — memory / directory / GCS through a dependency-free JSON-API client — a per-role
`storageMb` cap over `maps.capMb`, checked in a transaction that locks the user row). It is the worked
example for the "built-in feel" surfaces (`dock: "right"`, `ui.statusItem`, `ui.dialogSlot`,
`view.flash`, plus a `ui.overlay` for a running tool call's footprint — `ai/intent.ts` there — and
`view.reveal` to follow the calls round the map: `followBox` there is the footprint's box or null for
an empty or whole-map one, the reveal is awaited with `fit` before the tool runs, and a `"view"` event
that is neither a reveal's nor a tool's own means the user took the view — `followMap` off for the
rest of the turn; the preference is on by default), for a contribution group put in and taken out by a
setting, and for `api.sync` (shared maps, `sync.md`). The server streams the `agent` recipe (text
`delta`s and a `tool_use` event the moment the model names a tool; the system blocks are on the
one-hour cache in `claude.ts#systemBlocks`), and the Scenario workflow is an `ums-design` recipe (the
design document, checked server-side against the toolkit catalogue the request carries) executed by
`ai/dialogs/scenario.ts` through `map-plan`, the players/forces update, the plugin's **toolkit**
(`ai/ums.ts`: ~20 trigger-system kinds — hyper, spawn, kill-to-cash, waves, lives, shop,
last-standing… — built by code into text triggers the editor parses; the assistant reaches it through
`ums_build` and the genre guides in `ai/guides.ts` through `guide`) and the `triggers` recipe for
`custom` systems. Check Map's scenario checks (`validate.ts#umsIssues`) are the editor-side half.

**scmscx.com** (`github.com/scm-js/plugin-scm-scx`) searches scmscx.com, the StarCraft map archive,
and opens the picked map through `document.open`. There is no documented API: `client.ts` there
mirrors the routes the site's own front end uses (`/api/uiv2/search[/{words}]` with every default
parameter left out as the site does, `/api/uiv2/random`, `/api/uiv2/map_info`,
`/api/uiv2/filenames2`, `/api/maps/{mpq_hash}` for the file, `/api/uiv2/minimap` as an `<img>`),
reverse-engineered from its bundle and confirmed against the site's source
(`github.com/scmscx/scmscx.com`, `crates/bwmapserver`). The site sends **no CORS headers** and has no
CORS layer, so a page served from anywhere but scmscx.com cannot read those routes: the client takes
a list of bases (`connect()` probes each with the newest-uploads search and takes the first that
answers JSON), the plugin passes the site first and an optional forwarder from its Settings second,
and the dialog explains the block and links to the site when nothing answers. The editor runs no
forwarder of its own and must not grow one for this — the user decided that; the fix belongs on the
site (a `CorsLayer` on its GET routes). The plugin also reads its own link off the page:
`<editor>/scmscx/<id>` (the site's map id) makes `activate` put the address back to the editor's own
with `history.replaceState` and open the Find dialog with that map selected over the newest uploads —
a confirmation, nothing downloads before Open. It works because every path serves the editor's page
(`404.html` on Pages); the link-preview Worker does not route `/scmscx/*` (the user declined cards for
it), so on GitHub Pages the link answers 404 with the page and a pasted link shows no card. The same
pattern as the scmjs.dev plugin's `/map/<token>`; the path helpers are the plugin's own (`format.ts`).
It is the worked example for every waiting widget with cancellation.

**Stamp Library** (`github.com/scm-js/plugin-stamp-library`) is the clipboard-plus-storage-plus-panel
plugin for the extended-terrain parts bin, and the worked example for the three additions it asked of
the host — `clipboard.capture` (a clip built as `copy` would but not put on the clipboard, with a
`parts` override), `tx.paste` (`pasteClip` inside `runTransaction`: its lists fold into the entry's
in `applyEntry` order, `createdMask` carried, and `serial` bumped past `nextSerial(scn)` so a later
`makeUnit` cannot reuse a pasted unit's serial) and `graphics.renderClip` (`graphics.ts#renderClip`,
the viewport's paste-ghost pass without the viewport: tiles, then units / sprites / doodad overlays
from the sprite cache, then location boxes; drawn with the graphics of the clip's *own* era via
`peekTileset(TILESET_FILENAMES[era])`, so a foreign clip is null rather than wrong tiles) — plus
`storage.set` returning `false` on a refused write. `library.ts` there is the pure half (tests): a
`Stamp` is a `Clip` + name / tags / notes / `used` / `origin`, stored as one `stamp.<id>` record
(typed arrays as little-endian base64) under an `index` of ids, the share file
`{ format: "scmjs-stamps", version: 1, stamps }` being the same records so one stamp as text and a
whole library are one parser. `origin` is the capture rectangle's corner: `snapToLattice` keeps both
offsets from it even, which is what puts a piece back on the isometric lattice it was copied off
(Shift bypasses). The panel floats by default with a Dock / Float button that closes and reopens it
on the other side (`settings.dock`; the docked form was starved for height under three built-in
panels in a 900 px window). Stamping is a `ui.mapTool` whose `draw` blits the cached full-size
`renderClip` scaled to `view.tilePx`; a click is one `document.edit` with `tx.paste`, the pasted rect
then marked as a paste marks it. It captures every part (`ALL_PARTS`) and lets the stamping ticks
choose, so nothing is lost at save time; a foreign-tileset stamp can still lay down its objects.

**Terrain from Image** (`github.com/scm-js/plugin-image-to-terrain`: `plugin.json` / `plugin.ts` /
`convert.ts` / `icon.svg`, `@scm-js/plugin-api` as a devDependency so it type-checks alone, and
`tests/convert.test.ts` under its own vitest) is the worked example for a dialog built from widgets,
paste and drop, picking an area from a dialog, and a whole picture in one edit. It lives outside this
repository on purpose, so that the plugin the editor ships is loaded by the ordinary path; its
internals are documented there. Changing `src/plugins/api.ts` reaches it through
`github.com/scm-js/plugin-api`, which build.yml republishes on every push to main (never from a pull
request). `tests/plugins.test.ts` covers the host side (loader, host, transactions, lifecycle, menu
merge, context rows, picks, transfers, the defaults list, the add-confirmation preview and install,
map tools, panels, the palette API, placement, and the real-tileset suite via `primeTileset`).

**TrigEdit** (`github.com/scm-js/plugin-trigedit`, a default that starts **off**: the text syntax is
for people carrying triggers in from SCMDraft, and the Trigger Editor and TrigScript cover the rest)
is the Text Trigger Editor, a ~100-line dialog over the editor-owned format: `text.ts` there is the
pure half (the comment fencing over `api.triggers.claims`, the error line off
`TriggerTextError.line`, the gutter and status words; tests), `plugin.ts` the dialog — radios,
Compile / Format / Reload, word wrap, a `<textarea>` with a gutter, the `Compile & Close` / `Cancel` /
`Apply` footer — compiling with `tx.triggers.fromText(text, { replace: true })` (or `tx.briefing`)
inside one `document.update`, so a parse error leaves the map untouched. It is the worked example for
`triggers.claims()` and `DialogSpec.slot` (it offers `"trigedit.text"` with a live `text` field and a
`briefing` payload getter, where the scmjs.dev plugin mounts Explain / Write / Ask). Menu item
`Triggers ▸ Text Trigger Editor…` with `after: "Trigger Editor…"` and the `Ctrl+Shift+T` hotkey;
TrigScript's `after: "Text Trigger Editor…"` anchors on it — with TrigEdit off there is no such item
and TrigScript's goes to the end of the menu, which is what an unfound anchor does anyway. The
`trigedit.open` command takes `{ briefing?: boolean }`. If it grows Monaco it should take TrigScript's
loaded copy through `api.services` rather than download a second one.

**TrigScript** (`github.com/scm-js/plugin-trigscript`) is TypeScript kept inside the map: the
script's ordinary code runs when it is applied and records one trigger per `trigger()` call, and code
inside `program(() => …)` runs in the game, built into the map by TrigScript's own compiler when the
map is saved (a map with a program needs Remastered). It is the worked example for build steps
(`document.buildSteps.before` applies the script ahead of the bytes; `buildSteps.add` builds the
programs), claimed triggers (`triggers.claim`), a resizable panel workspace (`DialogSpec.flush` /
`buttons: []` and `PanelSpec.flush` exist for it: `shell.ts` is a script-agnostic VS Code-like frame,
`editor.ts` the controller over it), files kept in the map, and published commands (`compile`,
`build`, `declarations`, and the `build` service — `trigscript.build`, whose version 2 adds
`provideLibrary`, TrigScript modules another plugin provides for scripts to import). The language,
library and guide are `docs/trigscript*.md`; the plugin's own repository has its design notes and
plan. Facts found on the way that hold for anyone reading the game or writing triggers:

- **The compile never runs on the main thread** (`compile.ts`: a blob module, then a fresh worker on
  the release's `dist/compiler.js`, then `CompilerUnavailable`). A main-thread fallback could be
  frozen by an endless build-time loop. A TrigScript fetched as its one built bundle (a registry
  install, not the compiled-in default) has no `compileScript` in its blob worker; the worker reports
  that as fatal and the bundle route takes over.
- **The trigger schedule** (`compiler/simulate.ts`, as `docs/triggers.md` gives it, measured through
  the lifted 1.16.1): one frame counts down the wait slots at `msPerFrame` (42, Fastest), then the
  pass countdown (starts at 1, a pass on the frame it is found at 0, the pass resets it to 30), so
  passes fall on frames 2, 33, 64…; a Wait that runs out sets it to 1. A program first runs on frame
  2; hyper triggers give a pass every 2 frames. One wait slot per player; a held trigger resumes at
  its action without its conditions; Transmission holds like a Wait for its modified time (nothing
  for a computer or with no location); Elapsed Time is `frame / 16`.
- **The unit classes**: the game's Any unit … Factories are 229 … 232, and 228 is "None" (a Blizzard
  melee map's defeat trigger is "commands at most 0 of 231", Buildings). `api.names.units()` has a
  "None" entry at 228 so that an entry's place is still its value.
- **Keys Remastered never reports**: F2–F4 (the camera keys), F5 and F6 (`compiler/input.ts#DEAF_KEYS`
  keeps them out of the `Key` type, so writing one is an error rather than a silent key).
- A Use Map Settings computer's slot byte (0x57F1B4) is 5, a melee one's 1. Elapsed Time and the
  countdown count game seconds of sixteen frames.
- The objectives, a leaderboard's label, a transmission and a unit type's name are re-read by the
  game on every draw, so a text made at run time goes through a string reserved per kind and is
  written only on the computers of the players the action is for.
- `tests/trigscript-guide.test.ts` compiles every example of the TrigScript guides against the
  vendored plugin, so a guide change that uses a new call lands in the same commit as the pin that
  brings it.

**Walkability** (`github.com/scm-js/plugin-walkability`) is the read-only analysis drawn over the map
and the worked example for `api.ui.overlay`: `analysis.ts` there builds a minitile grid from
`api.tileset.raw()`'s VF4 words plus the ground under buildings and resources, and computes an exact
Euclidean clearance transform, 4-connected islands, a BWEM-style watershed into areas with the chokes
between them (measured with `passageWidth`), height seams (open cells at different heights touching
with no ramp), and per start pair the ground distance (Dial's) and the widest route's narrowest point;
`plugin.ts` registers one overlay at activation (`above: "objects"`, off until switched on from View,
the Layers panel, `Ctrl+Shift+W` or the panel), blits one `ImageData` per view mode in its `draw`,
reads the cell under the pointer in `onHover`, picks an area through `pickTile`, and re-runs on the
terrain/units/doodads/settings/document events while the overlay shows or the panel is open, so the
picture follows the units being placed on it. The settings panel holds the readout and the problems; a
*Details…* panel lists the rest. It never writes. Its panel also has the game walk the map through
scm-sim's `pathing()` (`api.services.watch("scm-sim.engine")`, no `requires`: the section is absent
without the engine): `game.ts` matches the game's walks with the estimate's pairs (stopped / stuck /
time ran out / no ground / ≥ 30 % and ≥ 10 tiles longer / units the game could not place), overlay
mode `game` draws the regions grid and each unit's route, and an edit only marks the walks out of date
(a run is 10–40 s); `vendor/scm-sim.d.ts` is the contract's copy. With scm-sim's `measure()` it times a
group of twelve through every listed choke (`chokeEnds`: a straight open line through the choke from
one of its areas to the other; judged by ten of twelve against one alone, stragglers counted — the
last of twelve is decided by one straggler) and mines at every start location and any hall clicked at
8 / 16 / 24 workers, warning when one start mines ≥ 5 % less than another.

## From Browse Plugins

**API Playground** (`github.com/scm-js/plugin-api-playground`) is a panel with Monaco where `api` is a
global: Ctrl+Enter runs the snippet, Stop takes back what it registered, Undo Run undoes its edits,
snippets live in `api.storage`, Export as Plugin writes a stored zip (`zip.ts`, no dependency) of a
Hello-World-shaped repository with the snippet as `activate`'s body. It is the worked example for
**`api.scope()`** (see `plugins-host.md`). Points that cost something:

- **Monaco is TrigScript's bundle, imported under `?instance=playground`** so it is a *separate
  module instance*. Sharing TrigScript's would share one TS language service: TrigScript
  `setExtraLibs` on every name change and re-sets the compiler options on close, and each program
  would see the other's files. The theme is TrigScript's, rule for rule, because Monaco writes token
  colours into global `.mtkN` classes and two instances with different themes repaint each other.
  `MonacoEnvironment` is global and both set it to the same two worker files.
- **Compiling is Monaco's own TS worker** (`getEmitOutput`, `noEmit: false`, `sourceMap`,
  `moduleDetection: force` so top-level `await` works and the snippet's names are module-local). The
  plugin API's `index.d.ts` is bundled as text (`--alias:playground-api-types=… --loader:.d.ts=text`,
  typed by `modules.d.ts`) and placed at `file:///node_modules/@scm-js/plugin-api/` with a
  `package.json`, plus a globals file `declare const api: import("@scm-js/plugin-api").PluginApi`.
- **Running** is a `blob:` module whose first line (prelude, same line so no line shift) takes `api`,
  `console` and the timers from `globalThis[Symbol.for("scmjs.apiPlayground")]` by run id. `api` is
  `{ ...scope.api, log }`; timers are wrapped so Stop can clear them (the scope cannot see them).
  Errors map back to the snippet line through the emitted source map (`sourcemap.ts`, VLQ → per-line
  table); the map is also inlined so DevTools shows the TypeScript. A loop that never yields hangs the
  page — no worker can hold `api`.
- The run, its output and the scope **outlive the panel**: closing it keeps a snippet's own panel or
  menu item working, and reopening still offers Stop.
- **Links** (`link.ts`): `?playground=1<raw deflate, base64url>` puts a snippet in the editor as a new
  unsaved one, with a warning line in the output, and **never runs it**; changes not saved are only
  replaced after a confirm. It waits for the map to be on screen (`api.view.visible()` non-empty, or
  the first `"view"` event) so nothing opens over the splash, and strips the parameter so a reload
  does not ask again. Copy Link writes the same format; the docs site's Try it links are written by
  Node's zlib in `scripts/lib/docs/tryit.mjs` and checked against `decodeSnippet` in the plugin's
  tests.
- A pasted `plugin.ts` runs as a plugin: a function default export is called with the run's `api`
  after the module loads, and its return value (function or `Disposable`) is run first on Stop.
- `tests/examples.test.ts` type-checks every example twice with the real `typescript` — as a snippet
  (global `api`) and as the exported `plugin.ts` with the starter's tsconfig — so an API change that
  breaks one goes red.

**Hello World** (`github.com/scm-js/plugin-hello-world`) is the smallest complete plugin, the one to
copy: one menu item and one dialog, a Korean catalogue and its test, the toolchain set up.
`scmjs plugin new` writes a plugin of the same kind (a menu item, the Korean catalogue and its test,
the build and CI).

**Magenta** (`github.com/scm-js/plugin-magenta`) is the UX-first trigger editor: sentences with chips
in a resizable floating or docked panel, one search row for native types and its EUD catalogue
(`src/catalogue/eud.json`, Remastered entries lowered to plain Deaths / Set Deaths records with the
masked word), and counter copies / comparisons / per-player copies as generated runs it claims. Its
`docs/plan.md` is the design. Its rows are built by TrigScript's `trigscript.build` service, which
makes it the worked example for `requires` and a service from another plugin, `document.update` for
single records, and EUD constants. It keeps pure copies of `epdOf` / fingerprint / usage so its tests
run without the editor; the host's `api.triggers.epd / addressOf / fingerprint / usage` and
`consts.triggers.maskedRecord` came from it. Two readouts are plugin-side only: *In plain words*
(prose + what the trigger shares with the list) and *Dry run*, a second panel that runs the list from
the map's state without the game (`src/model/simulate.ts` there), reporting what it cannot know
instead of guessing. Trust rules (`src/model/ownership.ts`): a hook / scan / counter step is private
to the trigger carrying its cell, so Duplicate and Paste re-home them on fresh cells, a row's ✕ keeps
a definition another trigger still carries, Delete prunes; the store forgets its undo on any external
change (a snapshot is the whole list); an unreadable `magenta\magenta.json` (newer version / bad JSON)
blocks writes behind a notice instead of decoding empty. `src/model/preflight.ts` keeps a source
revision (FNV over trigger fingerprints, the sidecar's build parts and the host's
locations/units/strings) as `settings.lastBuild` so the Build button says built / stale / not built,
and blocks a build on errors with Show links. Below map revision 206, `check()` puts an `info`
problem with `code: "revision"` under every EUD row and offers Set revision to Remastered
(`tx.setVersion("remastered")`); `info` on purpose, because Remastered plays VER 205 maps with EUD
fine (SCMDraft writes 205), so the lines only say the map is *marked* for an older client. **A docked
root needs `height: 100%`**, because the dock's body is a scrolling block, not a flex column.

**Melee Wizard** (`github.com/scm-js/plugin-melee-wizard`) places symmetric start locations and
bases, the worked example for placing units with the editor's placement checks and honouring
symmetry: `layout.ts` there is the ring of footprint positions at the game's three-tile Chebyshev gap
from the 4 × 3 hall, the mineral line grown along it from the pointed direction (wrapping round the
hall's corner), the geyser past the line's end, the nine symmetries as point maps (an image that swaps
the axes gets the base laid out again, since a 2 × 1 patch cannot turn), and the symmetry / summary
checks; `plugin.ts` is three map tools (starts, a press-and-drag base with `api.query.placement`
colouring the preview, a blocking patch) over `placeUnit` / `canPlaceUnit` / `updateUnits` in one
`document.edit`, plus bases at every start location, mirroring the selection and the symmetry check.

**Mod Editor** (`github.com/scm-js/plugin-mods`, needs editor 0.13.0 or later) edits a mod beside the
map: File ▸ Open a Mod… (a folder, `.mpq`, a mod's `.exe`, `.zip`, or a folder `scmjs mod unpack`
wrote; `ui.fileType` with `openFolder` so a dropped folder lands there too) opens a bottom panel with
Tables, Strings, Pictures, Sounds, Overlays, Scripts (PyICE / PyAI in TrigScript's Monaco, fetched
from jsDelivr at a tag; storage key `monacoDist` points it elsewhere) and Requirements and Buttons
(the `datreq\*.graft` files). It is the worked example for **a data set held in memory**:
`gameData.attach(profile, read, { hash })` with a reader over the session's current files (the
`GameDataReadContext` `member` / `under`, host side in `plugins-host.md` "The Mod Editor's asks"), so
the palette, settings defaults and drawn units follow every edit; a mod under 64 MB is hashed before
attaching, a larger one attaches without a hash and `gameData.rehash(hash)` follows once worked out.
Also `ui.pickFiles({ directory: true })`, `graphics.grpImage` (Pictures), `gameData.storedPath`. The
codecs and the folder form are `@scm-js/core`'s (the mod formats and the WAV codec). The session
(`session.ts`) has no DOM, so the tests drive it in Node from a mod made by the codecs;
`SCMJS_COSMONARCHY=<release folder with mpq/>` adds a large-mod test. A file nobody changed saves byte
for byte. **Play** is the `scmjs.play` message conversation with `/play/` on the same origin (a dev
server of the editor alone has none); with plugin-scm-sim installed, `services.watch("scm-sim.live")`
turns it into Start Test Game, and table edits, imported pictures and moved buttons go into the
running game (iscript, sounds and strings wait for a restart; a game between people refuses). The
mods side of the editor is `mods.md`; why all of `arr\` is kept in the stored copy (its `mapdata` /
`portdata` diff) is in `gamedata.md`.

**Section Explorer** (`github.com/scm-js/plugin-section-explorer`) is the annotated hex editor and the
worked example for `api.document.sections` and `api.names`. The host side is `src/editor/sections.ts`:
`currentChk(scn)` is `parseChk(serializeScenario(scn))` — the file Save would write, dirty sections
encoded, every occurrence with its offset — `sectionInfos` decorates it with the registry
(`SectionKnowledge`: mode, the fixed size for this map, stride, `modelled` from `MODELLED_SECTIONS` in
`scenario.ts`, which is the list `encodeSection` handles), and the writes (`replaceSectionData`,
`renameSection`, `insertSection`, `removeSection`, `moveSection`, `editRaw`, `parseRaw`) mutate that
`ChkFile` and parse a fresh `Scenario` from it. `host/sections.ts#sectionsApi` installs the result through
`documentAtoms.ts#replaceScenarioAtom` — `loadDocumentAtom` with the same file name and extras, then
modified — so a raw edit to any section, modelled or not, reaches the whole editor, at the cost of the
history (as Resize). `api.names` is the editor's own tables (`UNIT_NAMES`, `UPGRADE_NAMES`,
`TECH_NAMES`, `WEAPON_NAMES`, `PLAYER_TYPES`, `PLAYER_RACES`, the trigger defs and AI scripts) plus
the open map's strings, locations and switches, so plugins showing raw values carry no tables of
their own. In the plugin, `layout.ts` (schemas → lazily instantiated `Node` trees with `pathAt` /
`leavesIn` and per-leaf `Semantic`s) and `layouts.ts` (every section's shape and the meanings of its
fields, the string table read off its own offsets) are pure and tested there; `buffer.ts` is the edit
buffer with its own undo; `hexview.ts` and `inspector.ts` are the panes. `tests/plugins.test.ts`
covers the sections and names API against a new map.

**Timelapse** (`github.com/scm-js/plugin-timelapse`) records one frame per `"commit"` and plays the
recording back / exports GIF (gifenc) or WebM (MediaRecorder); the worked example for the `"commit"`
event, `graphics.renderClip`, IndexedDB for large data and a preferences page. Design points that
cost something to settle: frames are **taken by diffing the whole MTXM against the recorder's copy**,
not from the event's `area` (sub-millisecond at 256², and immune to any commit path that
under-reports); the area is only the highlight box. Objects are packed Int32Arrays stored whole, only
on frames where they changed. A key frame every 64 frames bounds seeking. Recordings go to
**IndexedDB** (`scmjs-timelapse`: `recordings` summaries + `frames` keyed `[id, index]`, one
transaction per frame so they never disagree) because `api.storage` is a few MB of JSON. A reopened
file **continues** its recording when the file name matches and `seek(frames, last)` equals the map
as opened — replaying the frames rather than keeping a "tail" copy that a debounced write could leave
stale. Playback draws the terrain incrementally (a clip cut to the dirty rect through `renderClip`)
and the objects as one tile-less clip over it (parts.doodads on so overlays draw; the doodad tiles it
re-blits are harmless). GIF: one palette quantised from the first and last frames, unchanged pixels
set to a reserved transparent index with dispose 1 — 298 frames at 512² come to 519 KB in 3.5 s.

**Trigger Map** (`github.com/scm-js/plugin-trigger-map`) is the worked example for
`triggers.references` (host side in `triggers.md`), a large resizable panel drawn in SVG, a button in
the Trigger Editor's slot and `view.goTo` a trigger. `graph.ts` folds the references into trigger
nodes and thing nodes (`<kind>:<id>`, `timer`, `memory:<address>`; Ore-and-gas splits into both) with
one link per (trigger, thing, access); a `use` flows thing → trigger like a read, so "inputs" = reads
+ uses and "outputs" = writes. The focus view is five columns (writers-of-inputs · inputs · focus ·
outputs · readers-of-outputs, mirrored for a thing), each node placed once in the nearest column,
outer columns ordered by barycentre, capped at 10 with a "more" node. Death counters are one node per
*unit* (players on the edge label), not per cell: per-cell nodes made eight copies of every Current
Player counter. Findings check "read, never written" for switches and the timer only — deaths, units,
ore and score change in play. Writers in an inert trigger or a disabled action do not count. The SVG
is sized in JS (`MIN_SCALE` 0.8, ResizeObserver) — a CSS max-width fit shrank the 5-column graph to
~8px text in an 800px box. Focus survives edits by fingerprint remapping; a focus asked for before the
panel mounts is held as `pending` (the panel mounts after `ui.panel` returns — the right-click entry
lost its focus to that). The Trigger Editor button reads the `selected` / `modified` slot fields and
confirms before `close()`, which discards. `trigger-map.focus` is a dotted command id so other plugins
can call it.

## Archived

**eudplib** (`github.com/scm-js/plugin-eudplib`) was the library plugin that built EUD programs with
eudplib compiled for Pyodide. TrigScript builds every program itself and Magenta hands its rows to
`trigscript.build`, so nothing requires it; the repository is archived, not deleted, so tagged
releases keep serving anyone pinning it. The runtime bundling it needed
(`scripts/bundle-plugin-runtimes.mjs`, the desktop and the container, and the runtime's licence
files in the third-party notices) stays as a mechanism with no default using it. A map built by
euddraft still opens with its locations hidden (`src/editor/locations.ts`); that is about the maps,
not the plugin.
