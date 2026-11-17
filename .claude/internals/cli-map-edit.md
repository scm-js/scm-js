# Changing a map through the plugin host: `map run`, `map edit`, units, terrain, settings

Every command here changes a map with the editor's own plugin host running under Node (`src/plugins/headless.ts`,
`plugins-host.md` "The host without the editor"): `map run` (a plugin over a map), `map edit` (a list of edits),
`map units|locations|terrain|doodads|settings` (the readers a model needs before it edits) and `map set --settings`.
Their MCP tools (`map_run`, `map_edit`, `map_units`, `map_locations`, `map_terrain`, `map_doodads`, `map_settings`,
`map_set`, `map_generate`) are the same functions (`cli-mcp.md`).

## The host under Node (`run.ts`)

- **`run.ts` is the one module that imports the host.** It holds the Node half (`nodeLoaderDeps`, `sourceFor`) since
  the editor's tree has no Node types, and re-exports the `PluginApi` / `EditTransaction` types, so `mapedit.ts`,
  `terrain.ts` and `settings.ts` import the host from `./run` and the layering test's one exception (`run.ts` →
  `headless.ts`) stands.
- **`openHost`** wraps `headlessApi(doc, name, sinks)` — a store with the document, `createPluginApi` with an info made
  from a name, nothing loaded or activated — and sends `console.*` to stderr until `dispose` (an Error as `name:
  message`). stdout is for the result, and under `scmjs mcp` it is the protocol.
- **The host's log wakes listeners on a `setTimeout`** (coalesced), so whether the host's own records reached a sink
  before `dispose()` was timing (CI saw a different count than a laptop). `attachSinks`'s detach **flushes** the log
  first, and `run.ts` prints only `warn`/`error` entries: the info tier is the host's own trace (edit records,
  command timing), which the status line already says. A plugin's `api.log` is `console.log`, so its own output
  reaches the terminal regardless.
- **The host is given the person's copy of the game when the work needs it** (`giveHostGame(doc, starcraft?)` →
  `headless.ts#loadGameCopy`, `plugins-host.md` "A host with a copy of the game"). `GameFiles` (`gamefiles.ts`, the
  copy `map preview` reads) is the `GameCopy` (`label`, `read(member)`), set as a `reader` asset source with no base,
  so the editor's own loaders read and decode; the map's tileset and the unit tables are awaited **before** a host is
  made, because the host reads what is in memory when it starts (`peekTileset`, `peekUnitAssets`). None found and none
  named → null, and the caller decides. Opened copies are kept by folder for the MCP server's later calls.
- **On a linked map the editor lends its game data first** (`link.ts#linkedGame`, `cli-editor.md`): what the person
  sees (a mod's tileset, a data set in memory) with no installation. `giveHostGame` takes it for a map read through a
  link (`files.ts#livePathOf`, a `WeakMap` from the `OpenedMap`) unless `--starcraft` names a folder, and falls back to
  the installation when the editor has none or the lent copy lacks the map's tileset.
- **A call never depends on the calls before it.** The decoded data is the editor's module state, one per process,
  and the MCP server is one process. So a host that is to have no game data drops it first (`noHostGame` →
  `dropGameCopy`: `dropDecodedData`, a `none` source). Otherwise a unit placed after a terrain call would get
  `makeUnit`'s defaults *with* the tables and one placed before would not. The price: a terrain edit after a
  units-only edit decodes the tileset and tables again (~150 ms; the copy stays open).
- **Without a copy, the host is limited** (measured with a probe script): `api.gameData.source()` is `none`,
  `api.tileset.load()` false, `terrain.types()` empty, `tx.paintIsom` false, `fillFlat`/`stampTerrain`/`heal` 0 tiles,
  `tx.placeDoodad` −1, `tx.canPlaceUnit` always false, `unitGeometry` the fallback (a building not snapped to the build
  grid), and `makeUnit(null, …)` writes 100% hit points and the resource amount, with the shields/energy "used" and
  cloak/burrow "valid" bits off (the game takes its defaults). **`removeDoodads` with the empty catalogue drops the
  records and leaves their tiles in MTXM** — wrong, silently. Hence the opt-in rules below.

## `map run <plugin> <map>` (`run.ts`)

- `runHeadless` with a source from `sourceFor`: an existing path → `file:` source (folder → `plugin.json`, `.json` →
  manifest, script extension → entry); only `github:`, `builtin:`, `http(s):` go to `parseSpec`. A missing path, a file
  that is no plugin, or a folder without `plugin.json` is refused here (exit 2). `nodeLoaderDeps.fetchText` drops
  `build` from a local manifest whose build file is missing but whose entry is there (`sourceWhenNotBuilt`), so a
  plugin folder runs before its first build.
- Events (status, toasts, log lines that are not the host's own info) are printed live in text mode and kept for
  `--json`. After `activate` (and the `--command`), `modified()` decides: changed → `diffMaps` against the input bytes
  reopened, for the one-line `summarizeDiff` and the `--dry-run` listing; written with `writeBack` unless
  `--dry-run`; `--out` writes even an unchanged map. `activate`'s return is its deactivation, not a result; only
  `--command`'s return is `result`. `--arg` without `--command` is refused. Loader errors → CliError with the `plugin
  check` hint; a throw in `activate` → "failed in activate: …"; an unknown command lists the plugin's own.
- **Waiting for un-awaited work** (`settle`): a command such as `run: () => { void session.check(); }` returns at once.
  The run waits until (a) no timer set during the run is pending (`trackTimers` wraps `setTimeout`/`clearTimeout` for
  the run) and (b) `process.getActiveResourcesInfo()` has no kind above its count before the plugin started — counted
  **per kind**, since a CloseReq ending can hide a new Timeout in a plain total — 10 s at most.
- **The game by default** when there is a copy (a plugin may ask for anything); `--no-game` / `game: false` runs as
  CI will. `game: null` in the outcome when none was found.
- `headless.ts` answers what a page would: `api.document.save` resolves true, `saveAs` false (they reached for the
  page's file APIs), `api.ui.toast("text")` takes a string as the title.

## `map edit <map> --edits <file>` (`mapedit.ts`, `objects.ts`)

- **The list is JSON**: a list, or `{ "edits": [...] }`, so the tool's argument and the command's file are one shape;
  `--edits -` reads stdin, refused when the map is `-` too. Kinds by `op`: `place_unit`, `move_units`,
  `update_units`, `remove_units`, `add_location`, `edit_location`, `remove_locations`, `place_sprite`,
  `remove_sprites`, `set_fog`, `paint_terrain`, `place_doodad`, `scatter_doodads`, `remove_doodads` (`EDIT` in
  mapedit.ts is the list). One entry per placed thing rather than lists inside a tool: the list *is* the batch.
- **All or nothing.** The whole list is one `api.document.edit("map edit", tx => …)`. An edit that cannot be done
  throws inside the builder; `runTransaction` rolls the earlier edits back and rethrows, and `editMap` turns it into
  `edits[2] (remove_units): …` with the reason's own hint first. Nothing is written because `writeBack` is never
  reached. Exit 1 for an edit the map refuses; 2 for a file that is not JSON or an entry that is not an edit
  (`parseEdits`).
- **Read and written by the usual two**: `editMap` reads the "before" side of the diff with `loadMapInput(input)` and
  writes with `writeBack` only — never `openMapBytes` on raw bytes — so a map linked to the editor is read from the
  editor and written back to it as one undo step.
- **An index means the map before the call** (units, sprites, doodads). A model lists once and then removes and
  updates; a removal early in the list must not shift what a later index means. `Tracker` tags every record with its
  starting index in a `WeakMap` by identity: removing splices and leaves the other records the objects they were;
  `updateUnits` makes a new object in place, so the update is wrapped in `carry`, which moves the tag. A placed
  record's tag holds its result, and `settle()` writes the index it has in the finished map (null when a later edit
  removed it). `where` looks at the map as it stands at that edit. An index past the end or one an earlier edit
  removed is an error; a `where` that matches nothing is not (a shell loop over many maps removing Map Revealers must
  not fail on a map with none) and its line says so. An empty `where` is refused: it would be every unit.
- **Locations by name or number, the number from 1.** plugin-ai and the plugin API count slots from 0; `map dump`,
  `map diff`, `map blame` and triggers count from 1, and the tool's answer carries `printDiff` lines. One numbering in
  everything the model reads beat matching the plugin API, so `map_locations` lists `number` (with `index` beside it
  in the data). A name is matched whole, then without case; two locations with the name → an error listing their
  numbers. Adding or renaming onto a name another location has is refused, so a name goes on meaning one location.
  Anywhere cannot be changed or removed.
- **Units.** A type is `rush.ts#unitByName` (the editor's name, without the race, a unique prefix, or an id), a player
  1–12. `place_unit` is `tx.makeUnit` + `tx.addUnits`, **not `tx.placeUnit`**, which snaps to a tile's centre with the
  palette's snap on (100,100 → 112,112) where pixels were asked for. Properties follow plugin-ai's `update_units`: a
  vital sets its `validStates` bit, a state sets or clears its `stateFlags` bit and sets the `validProperties` bit;
  the owner is set without the Owner bit (the game does not read it). `move_units` takes a position for exactly one
  unit or `dx`/`dy` for any number; leaving the map is an error.
- **`snap` and `check` on `place_unit`** need the game: `snap` on a building places it with `tx.placeUnit` (the
  palette's snap, the build grid for a building), reads the position back and removes it, then makes the unit as
  above so properties and index tracking stay one path; `check` is `api.query.placement` at the final position, its
  reason in the refusal ("the ground is unbuildable", "it overlaps Terran Command Center").
- **Sprites and fog.** `place_sprite` takes `sprite` (a sprites.dat id, pure) or `unit` (a unit sprite, by name),
  `player` 1 by default, `flipped`, `disabled` (unit sprites only; the editor's default, off). `remove_sprites` by
  `indices` (the order `map dump` lists them) or `where`. `set_fog` is `tx.setFog` over the tiles an area touches,
  players 1–8. `map diff` has no group for sprites or fog, so they show as THG2 / MASK changed; the edit's own line
  says what was done.
- **Opt in to the game by the list.** `needsGame(edits)`: any terrain or doodad kind, or a `place_unit` with `snap` or
  `check`. A list without them looks for no copy and writes the same bytes everywhere — which is why `snap`/`check` are
  fields and not the default: the same list must do the same on CI (no game) and on a desk. `snap`/`check` on a copy
  without unit tables (1.16.1 lacking `patch_rt.mpq`) are refused rather than silently skipped.
- **The schema a model is shown** (`EDIT_ARGUMENT`): one flat strict object with every field once and `op` an enum,
  not a `z.discriminatedUnion` of strict objects. The union with a description on every field was about twice the size
  (`rect`, `tiles` and `where` repeated in every kind) and a `oneOf`, which not every client reads. `parseEdits` then
  holds each edit to its kind with the strict union (`EDIT`), for the file and the tool alike, so the words are the
  same: `` edits[0] (place_unit): `dx` is not a field of place_unit: it takes … ``. What the SDK's validation catches
  first reads `` map_edit: `edits[0].x` takes a number, not a string `` — `edits[N]` from 0 on purpose, as JSON
  counts; the printed rows are numbered from 0 too. The description says which kind takes which fields, terrain kinds
  first since they need the most saying. `tests/cli-mcp.test.ts` bounds the tool's size.

## `map units`, `map locations` (`objects.ts`)

`map_dump` lists units without indices (and is the whole map), `map_info` only counts, so these two list what an edit
addresses. Rows: index, type, player, pixels, tile, and what the record sets (by `validStates`, states by name); the
text is cut at 40 (`--all`), the data never. Filters `--unit --player --location --rect --tiles`. `objects.ts` holds
what `mapedit.ts` shares: `unitType`, `locationIndex`, `areaRect` (rect / tiles / location, one of them; empty,
inverted and off-map refused), `unitsWhere`.

## Terrain and doodads (`terrain.ts`)

- **`paint_terrain`** is `tx.paintIsom(d, id, 1)` a diamond, the editor's own brush, so cliffs and shores are its.
  `strokeDiamonds`: `api.terrain.diamondsIn(cells)`; `ellipse` keeps the diamonds whose centre tile (2x, y) is inside
  the ellipse in the area; `cover` ranks the diamonds by value noise (a lattice `grain` tiles apart, eased, hashed from
  `seed`) and keeps the top share, which gives patches rather than speckle; `symmetry` sets the editor's mode for the
  call (`api.terrain.setSymmetry`, restored in `finally`), takes each diamond's centre pixel (64x, 32y) through
  `tx.mirrorPoint` and back through `diamondAt`, deduplicated. `cover` is the share *before* the images. Tiles changed
  are counted by comparing `scn.tiles` before and after (the transaction has no count per stroke).
- **The terrain is reproducible from a seed, the exact tiles are not**: the host passes `Math.random` for a terrain's
  variations (said in the guide; a seeded brush would need the host to take a `random`).
- **No `replace_terrain`.** `tx.replaceTerrain` is the Rect brush's (flat tiles swapped, edges left as they were),
  which a model would use across heights and get wrong; an isometric replace needs each diamond's terrain, and a
  diamond's centre is a tile corner.
- **Doodads.** A reference (`doodadsOf`) is an id, a name ("Jungle #180": a doodad has only its category and id), a
  category (any of its doodads), or `ramp` (every doodad with the ramp bit). `place_doodad` asks
  `api.query.doodadPlacement` (StarEdit's rule, not the palette's switch) and tries the choices in an order from the
  list's seeded run; `within` walks the tiles around by distance — that is what makes "a ramp near here" work without
  the model knowing which of a tileset's cliff shapes it painted; `force` is `tx.placeDoodad` as it is.
  `scatter_doodads` tries random spots (twenty a doodad wanted) and places where the rule says yes, whole inside the
  area. `remove_doodads` is `tx.removeDoodads`, safe once the catalogue is loaded. A third `Tracker` (`"doodad"`)
  gives doodad indices the units' meaning. One seeded run (`seeded(1)`) serves every edit of a list that gives no
  `seed`, so two `place_doodad` of a category need not be the same doodad and a list is still reproducible.
- **`map terrain`** (`listTerrain`): the tileset's terrains (id, name, height worded Low/Mid/High as the Terrain
  palette does — Jungle's High Dirt is 1, Badlands' is 2 —, buildable, tiles, share) and a grid, a character a cell by
  majority: a letter a terrain (lower case at height 0), `#` an edge tile `terrainAt` gives no terrain, `*` a doodad's,
  `?` neither; 64 columns unless `--cell`. The grid is what lets a model see heights without a picture. **`map
  doodads`** (`listDoodads`): placed rows (index, top-left tile by `doodadOrigin`'s rounding), the categories with
  their ramp counts, and with `--category`/`--palette` the placeable ones with the ground each needs (`groundFor`).
  Both need the tileset: no copy → `needTileset`, exit 2.

## Settings: `map settings`, `map set --settings` (`settings.ts`)

- **The writer is `map set`, not `map edit`.** Settings are declarative ("what is given is set, the rest left", `map
  set`'s words), `map edit` is a list of operations, and `map_edit`'s schema would have doubled. So `map_set` takes six
  list arguments (`players`, `forces`, `units`, `upgrades`, `techs`, `switches`: `SETTINGS`, zod, strict) and the
  command takes `--settings <file>` with the same object (`parseSettings`; `-` reads stdin, refused when the map is `-`
  too). A header-only `map set` prints exactly what it always did.
- **One `api.document.update` an entry** (the dialogs' OK), so a force name is interned, a pair of sections chosen by
  revision and CRGB kept in step by the editor's own `patch*` functions. Players and forces from 1 (`"default"` for
  the default column of PUNI / UPGR / PTEC); a colour is a name from `PLAYER_COLORS`, a number or `[r, g, b]` (a name or
  number clears a custom colour); a weapon is named, not numbered, and must be one the unit fights with
  (`api.settings.unitType(id).weapons`), since `patchUnitType` sets any weapon id it is given.
- **Names first.** Every entry is resolved (`byName`: whole name any case, else the one name holding the words; a
  number is the value) into a `plan` of closures before any runs, so a bad name in entry 1 leaves entry 0 unset in
  memory too, not only unwritten.
- **Numbers need the game's tables** (`needsTables`): `patchUnitType` / `patchUpgrade` / `patchTech` seed a row from
  the dat when "use default" comes off **only if the dat is there**; without it the row stays zeros (a Zergling with no
  build time and no cost). So a number, a `weapons` entry or `useDefault: false` makes `applySettings` call
  `giveHostGame` and refuse without a copy or without unit tables; names, availability, levels, state, players,
  forces and switches drop the copy and need none.
- **What changed is read, not assumed**: each step takes the thing's fields before and after as label → text
  (`playerFields`, `forceFields`, `unitFields`, `upgradeFields`, `techFields`) and reports the labels that differ
  (`SettingChange`). So "uses the game's numbers yes → no" shows without being asked for, and setting what is already
  so reports and writes nothing.
- **The reader lists what the map changes**, not every type: a unit off the defaults, named, or with any availability
  set; an upgrade or technology off the defaults or whose levels / state differ from a fresh map's tables.
  `--unit`/`--upgrade`/`--tech` show one row alone, and only then is the game looked for (not an error when absent),
  for its numbers beside the map's; the default listing needs no copy and is the same everywhere. Switch names are
  `readSwitchNames` (the API has no read outside a transaction).
- `tests/docs.test.ts` reads `useDefault` as a hook name (`use[A-Z]\w+`); it is on that test's allowed list rather
  than renamed, since the plugin API and plugin-ai call it that.

## Open

- Run `map edit` inside the linked editor (the link carries the edit's result only): a map on a mod's tileset is
  painted here with the installation's tables, and the editor would use its own.
- Terrain: `replace_terrain`, heal, pins, blocks and paste; stretched ramps (`placeStretchedDoodad`); doodads
  mirrored under a symmetry (needs `doodadTwin`); units and doodads moved or removed when terrain is painted under them
  (the editor's "remove stranded" is the palette's, not the transaction's); a seeded brush.
- Units and locations: elevation flags on locations; a count on `place_unit`; the affected indices of
  `move`/`update`/`remove` in the data (only counts today); sprite names (ids only without a table).
- Settings: sounds (`tx.sounds.add` wants the file's bytes), the CUWP slots (`tx.cuwp`), the tileset change
  (`api.document.changeTileset`), a single trigger added or replaced (triggers travel whole as text), and `--settings`
  output that round-trips through `map settings --json` (the reader's rows are effective values, the writer's are
  patches).
- `map diff` groups for terrain, doodads, sprites and fog (they show as sections changed).
- `map run`: React is still in the bundle because `host.ts` and `services/gameData.ts` import helpers from hook files
  (`cli-distribution.md`).
