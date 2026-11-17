# The viewport, the UI and image export

### Image export (`src/services/mapImage.ts`)

File ▸ Export ▸ Image is one dialog with one dial — `pixelsPerTile` — and `renderMapImage`
is a standalone re-implementation of the viewport's draw pass with `sx = sy = 0` over the
whole map (it shares no code with `MapViewport`: the viewport's passes are plain functions in
`viewport/paint/`, and the export keeps its own copies — it draws an area at an offset with
its own options). There is no "map vs minimap" mode: the two thresholds
where the picture changes character are the viewport's own far-zoom ones — `drawsSprites`
(< 8 px/tile → `drawUnitDots`, the game's minimap dots, and sprites drop out) and `FLAT_PX`
(< 4 px/tile → `atlas.averages` instead of atlas blits) — so 1 px/tile *is* the minimap and
nothing special-cases it. Units are drawn in their *editor* pose (`getUnitSprite` /
`getImageFrame`, never `UnitAnimator`), so an export is deterministic.

`loadMapImageAssets` must run first: it ensures the tileset and the unit tables (the dots
need units.dat placement boxes too) and, when the scale draws graphics, awaits every GRP
the records need via `awaitGrps` — which lives in `formats/units/load.ts` and the startup
preload shares — so nothing lands as a marker just because a fetch had not finished.
Missing game data stays a degradation, never a failure. `ExportImageDialog`
(`dialogs/FileDialogs.tsx`) previews the same render at thumbnail scale and greys out the
ticks the chosen scale cannot honour; note it holds the preview host in state rather than a
ref, because the Radix portal mounts a commit after the dialog component and a `useRef`
read in the first effect pass is still null.

### UI

- All state is Jotai; there is no context/provider layering beyond the default store.
- **Dock edges** (`useDockResize`) capture the pointer on the handle rather than
  listening on `window`: a plugin's map view can be an iframe (a replay's game), which swallows the
  moves and the release, so a `window` listener leaves the dock frozen mid-drag and then following
  the pointer after it comes back.
  The width is set once a frame (each change lays the map out again and writes `scmjs.docks`); the
  right dock may take 45% of the window (a replay's side panel wants room), the left keeps 480.
  `e2e/docks.spec.ts` drags across an iframe.
- The kit is `src/components/ui/index.tsx`. `Select` is a native `<select>` and stays the default;
  `IconSelect` is radix's Select dressed as one, for the single case a native control cannot do —
  a row with a drawing in it (the language picker's flags, `FlagIcon.tsx`). It renders through a
  portal, so it works inside a dialog, and `.opt-icon` holds the icon column open for a row without
  one so the labels line up.
- Dialogs: `DialogId` union in `src/atoms/uiAtoms.ts`, a stack (`openDialogAtom`/`closeDialogAtom`),
  and a `REGISTRY` of `React.lazy` components in `src/components/dialogs/DialogHost.tsx`, one
  `import()` per dialog module (dialogs sharing a file share a chunk, each entry rendered in its own
  `Suspense`). Adding a dialog means touching both. The dialog modules must not be imported
  statically from anything on the startup path or Vite folds them back into the main chunk (Vite
  says so: `INEFFECTIVE_DYNAMIC_IMPORT`) — which is why `PluginIconView` lives in `components/ui/`,
  not in `PluginDialogs.tsx`. Split, the main chunk is 537 KB rather than 1140 KB.
- **Error boundaries** (`components/ui/ErrorBoundary.tsx`, `chrome/CrashScreen.tsx`).
  Three tiers. `Guarded` (the in-place notice, Try again / Show the log) wraps `MapViewport` in
  `App.tsx` and each panel body in `Docks.tsx` — inside the `.panel`, so the head and its hide
  button survive; `.surface-error` is `flex: 1` so it takes the room of whatever it replaces, in
  the body row or a dock column. `DialogHost` wraps each entry *outside* its `Suspense` (a chunk
  that fails to load rejects the lazy and is a render error like any other) with a `null`
  fallback and `onError` → `closeDialogAtom(entry.key)` + an error toast carrying Show the log:
  the notice cannot be drawn inside the dialog, since `DialogFrame` is part of what failed.
  `React.lazy` keeps a rejection, so a dialog whose chunk failed stays failed until a reload. The last one is around `<App />` in
  `main.tsx`, inside the jotai `Provider`, and shows `CrashScreen`. Its Try again remounts
  `App` over the same store: the maps, the dialog stack and the plugins are all still there,
  `useStartupMap` steps aside because a scenario is open, `usePlugins` re-activates nothing
  already active, and `usePreload` runs again (its `started` is a ref) — a second game-data
  probe and its log lines, nothing else. The menu bar has its own `Guarded` (`bar`:
  the notice is one `--h-menubar` row, not `flex: 1`, which in `.app`'s column would take the
  editor's height) — without it a menu's failure takes the whole editor to `CrashScreen`. The toolbar,
  tab strip and status bar have no boundary of their own and fall to that last one. **A new top-level surface** (a dock, a strip,
  a floating panel host) gets a boundary of its own; anything inside an existing one is covered.
  **Page translators** (`src/domGuard.ts`). Chrome's translator swaps the text nodes React
  owns for `<font>` wrappers (facebook/react#11538), and react-dom's `removeChild` /
  `insertBefore` then throw `NotFoundError` while committing: the properties panel and palette
  as the layer changes, and Radix's `MenuItemIndicator` (the Layer menu's check mark). `domGuard` patches `Node.prototype` so both calls skip a node
  whose parent is not `this` and `logWarn` it (`call`, `nodeName`, `translated`) — a warning, so
  it is not an `error` count; the same mismatch from our own code would be a bug, hence the line.
  `translate="no"` was rejected: the chrome is English and Korean only. `e2e/translated.spec.ts`
  imitates the translator (and a `MutationObserver` for later text) and switches layers through
  the menu; without the import it fails with that error, caught as `surface: menu bar`.
  Logging is not done by any of them; see
  `logging.md`. Checked in headless Chromium with a component rigged to throw in a panel, the
  map and `App` (rig not committed); `e2e/errors.spec.ts` keeps the dialog path.
- **Leaving a dialog with edits asks first**. `useScenarioForm` returns a third value,
  a `FormGuard` (`dirty`, set by the setter; `touch()` for the copies edited in place, as the
  unit / upgrade / tech settings' typed arrays are; `clean()`), and `DialogFrame`'s `guard` prop
  takes it: while dirty, everything that reaches Radix's `onOpenChange` — Escape, a press on the
  dim, the close button — swaps the footer for "Discard the changes made in this dialog?" with
  Discard / Keep editing instead of closing, and a second Escape goes back to editing. Cancel is
  not asked about, and the frame calls `clean()` after OK / Apply (after the dialog's own
  `setList(read…)`, so that write does not leave it dirty). Wired for the dialogs whose copy is
  real work: Trigger Editor, Mission Briefing, String Editor, Sound Editor, Switches, Unit /
  Upgrade / Technology Settings. The small settings dialogs keep Escape as a plain cancel on
  purpose. It is "touched", not a diff: an edit typed and typed back still asks.
- Preferences (`dialogs/PreferencesDialog.tsx`, its own chunk) is a `.split` with a page list
  (`.prefs-nav`) on the left and one page mounted on the right; `payload.page` picks the page
  (`?dialog=preferences&page=view` in a deep link, `dlgWith(…, { page })` in the menu). Every
  page edits one working copy — the `Preferences` object plus the grid's spacing, look and
  snaps, which keep their own atoms — written on OK/Apply. The footer has two resets, both
  on the working copy only. **Reset this page** puts back what the page in front shows:
  `PREFERENCES_PAGE_KEYS` in `editor/preferences.ts` is the one page → `Preferences` keys
  table, and the dialog's `PAGE_PARTS` adds Editing's grid parts; on Testing it also calls
  the mounted test targets' `reset`, on a plugin page that page's `spec.reset`; disabled on
  Storage (nothing there is a setting) and on a plugin page with no `reset`. **Reset
  everything…** asks first by swapping the footer (`footerLeft` = the question, `footer` =
  Cancel + a danger button, so OK / Cancel / Apply are hidden while it asks), then resets
  every built-in page and calls `reset` on the plugin pages in `visited` and the test
  targets in `targetSettings` — only pages that were mounted, since `reset` is specified for
  a page that has been shown and an unshown page's `apply` never runs. `counting` is in
  `NEVER_RESET` and neither reset touches it (on is its default, so a reset could only turn
  it back on). `tests/preferences.test.ts` fails when a key of `Preferences` is on no page's
  list and not in `NEVER_RESET`: **a new preference must be added to the table.** General
  holds Language, Startup, Maps (`tc("preferences", "Maps")` → 맵: a bare "Maps" is the game's folder in Test Map's text and stays untranslated), Privacy; Files holds New scenario, Saving, Recovery. The Storage page's clears act at once on the atoms, so `StorageSection` reports
  the keys it cleared and the dialog re-reads those parts (`KEY_PARTS`). `"gridSettings"` is
  a `DialogId` (plugins may open it): its registry entry is `GridSettingsDialog`, a
  wrapper that opens Preferences on Editing. Sections are `.prefs-section` — the group box's
  legend styling without the frame — and hints are one sentence (`Hint`); the fieldset
  `Group` is not used here. The Test Map folder rows (`dialogs/TestFolder.tsx`) are shared
  with Tools ▸ Test Map; the desktop path lives in the preferences, the browser's handle in
  IndexedDB and so is written at once, not on OK.
- **Preferences' filter box** (2026-11-16, `PreferencesDialog.tsx` + `preferencesFilter.ts`). A text field
  above the page list (`.prefs-side` > `.prefs-search`, then `.prefs-nav`). With words in it the
  dialog renders `.prefs-results` in `.prefs-page` instead of the page in front: every built-in page,
  drawn whole by the same components (`results` = `content` with Testing, Plugins and Hotkeys
  adjusted) under a `.prefs-results-head`, and a layout effect + `MutationObserver` runs
  `filterSections`, which sets `hidden` on each `.prefs-section` whose **rendered text** (every text
  node, so a closed `<select>`'s options and a closed `<details>` count; an open `<details>` is opened
  when its inside matches) lacks a word, and on a page group with nothing left. Words are AND,
  substring, `NFC` + `toLowerCase`, so Korean works with no extra step. **There is no keyword table on
  purpose**: a second list of words drifts from the labels the first time one is edited, while this
  way a section added to a page later is searchable with nothing to register. `IconSelect` writes its
  option labels into a `hidden` span for the same reason (radix's list is in the DOM only while
  open), which is how "한국어" finds Language. Rejected: per-section keywords; matching the
  `t()` strings of the source (the catalogue does not know which section a string is drawn in,
  and run-time text such as `hostTerms()` and the storage rows would be missed); rendering the
  pages off screen just to read their text (two mounts of everything for no gain). What the
  results mount: Storage's sections do their IndexedDB lookups (once per filtering session — the
  results stay mounted while the words change; the same reads the Storage page does) and the
  observer re-filters when they come back. **Testing is drawn without `targetSettings`**, so no
  test target's `settings.mount` runs and nothing joins `targetSettings` — registering is what makes
  OK / Reset reach a target — and a target whose label matches is a `ResultRow` that opens Testing;
  a plugin's own page is the same, a row matched on `plugin.name` opening `plugin:<id>`, never
  mounted (a mounted page is in `visited` and gets `apply` on OK). The Testing instance kept
  mounted for its targets stays hidden behind the results; `useTestFolder(reread)` reads the
  browser's folder handle again when it shows, since the results' copy may have changed it.
  The page in front stays mounted but `hidden` (its local state and scroll come back: `savedScroll`);
  choosing a page in the list clears the box (`choose`). While the results show nothing is
  `is-active` in the list and **Reset this page is disabled** with a title saying why (it would
  reset a page nobody can see); Reset everything is untouched. **On Hotkeys the box narrows the page
  itself** (`HotkeysPage` `filter`), not the results: rows match on `translate(label)` or on a key
  as `formatCombo` shows it, the whole key or its start up to a `+` (`keyMatches`: "Ctrl+S" is
  not Ctrl+Shift+S, "Ctrl" is every Ctrl key); a row capturing keys stays; Reset this page still
  resets every hotkey and says so. In the results the same component draws the table alone
  (`inResults`), so + and × work there. Focus: the box is `type="text"` so `DialogFrame`'s
  open-focus puts the cursor in it (before, the dialog element itself had focus; no page has a text
  field). Esc: `onEscapeKeyDown` empties a non-empty box and keeps the dialog; an empty box lets
  Esc close as before (the Hotkeys capture listener still takes Esc first while waiting for keys).
  Edit ▸ Find's resolved keys (Ctrl+F by default) focus the box from anywhere in the `.dlg` — a
  listener on the dialog element, so a dialog opened on top does not reach it; a plain key bound
  to Find is left to a focused text field. Tests: `tests/preferencesFilter.test.ts` (matching),
  `e2e/preferences.spec.ts` (a control in the results reaching OK, Apply and Reset everything
  while filtering, the Hotkeys narrowing, Esc, Ctrl+F).
- The wheel over the map is a non-passive listener on the scroller in `MapViewport.tsx` (a
  React `onWheel` is passive and cannot `preventDefault`): Ctrl/Cmd+wheel always zooms a
  step of `ZOOM_STEPS` and takes the event from the browser's page zoom; `Preferences.view.wheel === "zoom"` makes a plain wheel zoom too, Shift+wheel
  staying the scroller's sideways scroll. Trackpad deltas are summed to one notch (40 px).
  `zoomAnchorRef` holds the pointer position when `view.zoomToCursor` is on; the zoom
  `useLayoutEffect` keeps that point in place, or the centre when nothing set it (menu,
  keyboard, toolbar).
- **The viewport is five files and a folder**.
  `MapViewport.tsx` keeps what needs the component: the atoms, the refs, the frame scheduling,
  the animation / glide / zoom / wheel / auto-pan effects, and the pointer handlers. Around it:
  - `paint/` — the draw passes, plain functions of a `PaintView` (context, scale, scroll, size,
    visible tiles, fonts) and the thing they draw: `ground.ts` (the cached terrain layer, the
    loading plate, the no-graphics noise), `grid.ts` (grid, rulers, symmetry axes), `objects.ts`
    (`spritePainter` — how a unit / sprite / marker is put down — and `drawObjects`),
    `locations.ts`, `ghosts.ts` (what a tool is about to do under the pointer) and `view.ts`
    (the type, the `INK` / `DASH` constants, `strokeBox` / `strokeTileRect` / `sizeChip` /
    `markedTiles` / `draggedBox`, flashes). `draw` is the list of passes in painter's order and
    the conditions for each; a pass takes no refs and reads no atoms. `fog.ts` is this
    shape too. `mapImage.ts` has its own copies (it draws an area at an offset with its own
    options); the passes are what it would share if that is ever worth the coupling.
  - `gestures.ts` — one object per drag (`ObjectGesture` for units / doodads / sprites, one
    class rather than three copies of the same forty lines; `LocationGesture`; `AreaGesture` for the clip
    area and a plugin's pick; `StrokeGesture` for terrain and fog; `{ kind: "tool" }` for a
    plugin's tool, which the component serves itself because a tool also hears the pointer
    with no button down). The viewport holds **one** `gestureRef` — a second button pressed
    during a drag is a `pointermove`, never a second `pointerdown`, so there is never more
    than one live — and `onDown` is `gestureFor(sample)` (which layer starts what), `onMove`
    is `gesture.move(sample)`, `onUp` is `gesture.up()`. A gesture keeps the tools it started
    with for its whole life. `draw` reads the gesture's public fields (`mode`, `from`, `to`)
    for the marquee, the create box and the marked area. No DOM, no React:
    `tests/viewport-gestures.test.ts` drives them with stand-in tools. A new layer's drag is a
    `begin…Gesture` here and a branch in `gestureFor`, not a new ref and three new blocks.
  - `ViewportMenu.tsx` — the context menu's rows, rendered *inside* `ContextMenu.Content`, so
    they are built only while the menu is open (Radix mounts the content then). `onContextMenu`
    puts the tile and pixel in `menuTarget` state — no mirror of the open state and no refs
    read during render — which keeps the plugin contract (`visible` / `label` /
    `enabled` run when the menu opens, with that click's context — see `plugins-host.md`).
    It acts through the viewport's own tool objects (`tools` prop): the tool hooks hold drag
    state in refs and must not be instantiated twice.
  - `ViewportHud.tsx` — the corner chips and `PluginMapButtons`, with the atoms only they read.
  **Repaint-only atoms are not subscriptions** (`REPAINT_ATOMS`): the palette picks, the
  owner, the snap, `unitsRevisionAtom`, the plugin overlay / tool / `ui.repaint` counters and
  `onGrpLoaded` are things `draw` reaches through the store or through objects mutated in
  place, so the viewport listens with `store.sub(atom, scheduleDraw)` and does not render for
  them. A `useAtomValue` "only read so … redraws" would be a render of the whole component and a
  new `ctxItems` for each. A value `draw` *closes over* still has to be a
  subscription and a dep.
  **Comparing two builds' pictures.** A script drives both builds in headless Chromium with
  the game data through 127 states (every layer's hover, drag mid-way and result; grid /
  elevation / buildability / fog; five zooms × seven scrolls; context menus; middle-button
  pan; wheel zoom) with `Math.random` seeded and animation off, hashing the canvas and the
  rulers and reading the HUD text, the menu rows and the surface's cursor after each, at
  100%, 125% and 200% display scale. Unticking View ▸ Animate Water is not enough to make
  such a run repeatable: the water's palette step follows the wall clock until then and
  stays where it was, so two builds (or one build
  under load) can freeze on different steps and every state with water in it differs for
  nothing. The script pins `performance.now` before the page loads, which holds it at step 0.
- **The ground layer holds the elevation and buildability overlays too**
  (`paint/ground.ts`). Redrawn on every paint — an animation frame, a ghost under the pointer
  — they cost up to 16 `fillRect`s a visible tile, ~170,000 at 25% over high ground. They
  are a property of the tile, so `blitTiles` lays them down with the tile, in the tile's
  own device pixels, and the two flags are part of the layer's key. Counted in headless
  Chrome over 60 pointer moves on the Units layer at 25% with both overlays and the fog on:
  238 `fillRect`s against 394,978 redrawing them each paint, and a tenth of the time in the
  frame callbacks.
  Three things follow.
  The grid is drawn over the tint rather than under it. A
  tile's overlay must not spill onto its neighbours, because a tile is redrawn alone when it
  cycles or a scroll uncovers it: the minitile tints partition the tile exactly (no
  `+ 0.5` overlap), and the hatch is `hatchStamp` — the diagonal drawn once per tile size
  into a small canvas and copied — because one `stroke()` through every tile of a pass comes
  out a level different at the line ends depending on how many tiles the pass held (Skia
  smooths a path by its whole shape; found by comparing a shifted layer with a whole redraw).
  That comparison (toggle View ▸ Doodads twice to force the redraw) is 0 mismatches of 47 at
  100% and 200% display scale, after scrolls and after water steps; at 125% and 150% it
  finds strips of smoothed terrain a shift leaves up to 3/255 off at 25% and 50% zoom —
  **not the overlays'**: a build without them has the same count, and the scroll check
  below, made on noise tileset files, does not see it. Nothing shows; nobody has fixed it.
  The fog is cached the same way (`fog.ts#drawFogLayer`, `fogLayerRef`): the tint filled
  into a layer of its own, keyed by scenario, terrain revision (fog edits repaint through
  it), player, tileset and view, and multiplied onto the canvas — pixel for pixel what the
  `multiply` fill gave. It is redrawn whole on a scroll; what it saves is the path of every
  visible tile and its four neighbours on each animation frame. Location names are measured
  once (`paint/locations.ts#textWidth`, cleared when a web font arrives). `unitAt` does not
  sort every unit to find the topmost hit. And the canvas-size effect compares in whole
  device pixels: against `size.w * dpr` at 125% / 150% with an odd width it never matches,
  so every run of the effect — each commit, selection, palette pick — would reallocate the canvas.
- `MapViewport.tsx` is a single canvas that draws terrain (atlas or fallback colours), overlays
  (grid, locations, start locations, brush ghost) and handles all mouse input for the active layer.
  The terrain blits go into a cached layer canvas (`GroundLayer`, `groundLayerRef`) that `draw`
  copies with one `drawImage`: it is redrawn whole when the size, zoom, tiles, revisions,
  tileset or document change, shifted when the view scrolls (below), and only its cycling tiles
  are redrawn when the water step moves, so a unit
  animation frame or a hover ghost does not re-blit every visible megatile. Anything that changes
  what is under the ground must already bump `terrainRevisionAtom` / `doodadsRevisionAtom` (or
  replace the scenario), which is the same contract the repaint itself relies on.
  **A tile the data set has not got is hatched** (`viewport/missingTile.ts`): `Ground.lacks` is
  `remasteredTiles.ts#mapLacks(tiles, era, groups, terrainRevision + doodadsRevision)` — a 4,096-byte table of the
  groups `tilesetHasTile` refuses, or **null when the map uses none of them**, worked out once per tile array, tileset
  and revision (a `WeakMap`), so a map with all its terrain takes the ordinary path with one null test a tile. In
  `blitTiles` a lacked tile gets `megatile = -1` *before* `megatileForTile` (which by the eleven-bit rule would hand
  most of a mod's tiles another group's megatile: BattleGuard over 1.16 is 464 black and 844 wrong, over Remastered
  nearly all wrong), is filled with `missingTilePattern` and `continue`s: no overlay (elevation / buildability of a
  tile nobody knows), no mask picture (black in the mask, so no water bends over it), never `animated`. The pattern
  is one stamp a device scale (plate `--bg-2`, lines `--warn` at 0.6, period 8 screen px "\" — the buildability
  hatch is one blue "/" a tile), written pixel by pixel so it tiles without antialiasing, and laid from the map's
  corner by `CanvasPattern.setTransform(translate(-ox, -oy))`: a strip a scroll uncovers continues its neighbours'
  lines, and the layer's shift-and-blit stays exact. Same at the flat zooms (< 4 px a tile). A megatile of -1 that
  is *not* lacked (an in-range group naming a megatile the table has not got) stays black. The minimap
  (`panels/minimapTerrain.ts#fillTerrain`, split out of `MinimapPanel` so `tests/missing-terrain.test.ts` runs it
  without a canvas) asks `missingTileRgb(px, py)` — period 4, lines 2, `--warn` at full strength, in the picture's
  own pixels — and `mapImage.ts#drawTerrain` fills with the same pattern at scale 1 (its context is already
  translated to the map's corner). Not marked, on purpose: the paste and brush ghosts (`paint/ghosts.ts`: a
  transient preview at part strength; palette tiles are the tileset's own and always exist; a clip copied off
  missing tiles previews by the eleven-bit rule and is hatched once pasted), the tile palette, doodad thumbs and the New
  Scenario previews (they draw the *tileset's* tiles, never a map's), and `plugins/graphics.ts` /
  `api.terrain.color` (a plugin asks for a tile id's picture or colour of the loaded tileset; null/another tile —
  changing what a plugin gets is a contract change, not taken here). `useMissingTerrain`, mounted here
  with `useTileset`'s `loaded`, is the notice — see `gamedata.md` "Terrain the data set lacks".
- **The Tile tab at the palette's default width.** The palette's content is ~216 px wide there. (1) Sharing a row
  with four or five view buttons, the group filter gets ~76 px, so "Doodad tiles" reads "Doodad" and "Added by
  Cosmonarchy" "Added by Cc". The filter is `flex: 1 1 150px` and the buttons one unshrinking group (`.tile-filter`, `.tile-views`), so they share
  a row only where the palette has room and take a row each otherwise — always the same layout at a given width,
  whatever the filter says (letting the filter's own text decide the wrap makes the rows jump on a pick). (2) With a
  block picked, the `Single tile` button makes a `1fr` info-grid column grow to its content and push the Ground
  value out of the panel; the column is `minmax(0, 1fr)` and the block row wraps. (3) In the Pieces view the line
  "From this map and N learned maps" is left ~7 px beside the buttons; it and Forget (which is about that line) are one group, the
  other buttons another, wrapping the same way. `tileBrowserAtom` (view, filter, search, full size) holds the
  tab's state, not `useState`: Radix unmounts a tab's content, so the tab would come back on grouped rows. Not stored, on
  purpose — a session starts where a newcomer expects. `e2e/tilePalette.spec.ts` holds both.
  The Symmetry dialog's report buttons are sentences; `.btn.wrap` lets such a button wrap inside its container.
- **The Tile tab's sheet** (`panels/TileBrowser.tsx#TileSheet`, model and reasons in `terrain.md`). A third
  `TileView` beside grouped rows and the grid: one canvas per visible row (16 slots, `drawTile`, blank rows `drawVoid`),
  windowed by binary search over a `tops` array (rows touch; a run break adds `SHEET_BREAK` 7 px), so 4,000 rows cost
  ~100 canvases. Group numbers sit in a 34 px column (9 px mono), every row while tiles are ≥ 14 px, else every fourth
  group and each run's first. Tile size fits the panel — the left dock is 220–480 px (`useDockResize`), so 8–26 px — or,
  with the full-size toggle, the atlas' 32 px with sideways scroll. Pointer capture on the content div: a click picks a
  tile, a drag a block clamped to its start's run; a wheel mid-drag re-reads the last pointer. The outline is one div
  (the drag, else the block via `blockRect`, else the tile). The view, filter and size are `tileBrowserAtom`'s (above). The filter's *Added by {name}* option is `TileFilter = "added"`.
  The brush-size controls (palette, toolbar, Properties) show the block's size while one is active.
  Checked in headless Chromium: Badlands doodad picked whole and laid, a 4-copy pattern drag = one undo
  entry; Cosmonarchy's Badlands through the mod-folder notice (folder handed over in 1.7 s), its added groups as the
  sheet, a 12×10 building and a 4×9 wall pattern laid; no console errors.
- **The Tile tab's Pieces view** (`panels/TilePieces.tsx`, rule and numbers in `terrain.md` "Pieces"). The
  fourth `TileView`. Entries (`collapsePieces`) laid out in shelves by `editor/pieceShelves.ts#shelfLayout` at 16 px a tile,
  a piece wider than the panel scaled to the largest whole pixel size that fits; windowed by `shelvesIn` over the shelf
  tops with 400 px to spare, one canvas per piece drawn in its own outline (holes left transparent). 3,372 entries on the
  mod's Badlands scroll without a hitch in headless Chromium. Filter and search apply by any member's first group (the
  "Added by" filter: no member below the added range). The head is **one line**: where the pieces come from (the
  full text in its title when the panel cuts it short — at 420 px "…and 32 learned maps" is cut), Forget as an eraser
  icon, Learn from Maps…, *Most laid first* as an icon; while learning the source text gives way to the progress bar
  (`.progress-track`). The learn's outcome is said once, in the status line and a toast — not kept in the palette,
  where it would take a third of the panel. Provided sets (`api.terrain.providePieces`) come first, each under a heading line
  (`.pieces-heading`, 20 px), laid out as their own shelves and stacked with the cut ones into one windowed layout; the
  search box also matches a provided piece's name and category. A click is `tileBlockAtom ←
  pieceBlock`, so laying, ghost, pattern and fills are the block's; the Sheet view outlines it through `blockRect`.
- **Toasts with several buttons** (`Toast.actions`): a row under the text (`.toast-actions`, wraps),
  each `{ label, run, keep? }`; pressing one dismisses the toast unless `keep` (the terrain notice's folder button:
  the picker can be backed out of, and the notice should still be there). `Toast.action` is one button beside the
  text.
  **A scroll shifts the layer.** Redrawn whole on every scroll frame, the layer costs one
  `drawImage` per visible megatile, 10,793 of them at 25% in a 1400×900 window. It is
  anchored at the scroll position *rounded to a device pixel* (`ox`, `oy`), with each tile at
  `round(tx · tilePx · dpr) − ox`, so a tile's pixels do not depend on the scroll and a scroll over the same ground is a self-`drawImage` of the layer (composite
  `copy`) plus the tiles under the uncovered strips (`blitTiles`, a tile to spare each way).
  Counted in headless Chrome: 200–900 blits for a wheel notch at 25%, 50–260 at 100%. The
  shift is skipped where an unsmoothed blit enlarges by a non-whole factor (`exact`: 150%
  zoom, or ≥100% on a display scaled to 125% / 150%) — half the samples there fall exactly
  between two source pixels and which side they land depends on where on the canvas the tile
  is, so a moved tile and a fresh one differ by pixel columns; those scales redraw whole,
  and they are the ones with few tiles on screen. `layer.animated` is only ever
  raised by a shift and is put right by the next water step, which visits every visible tile.
  Checked by hashing the canvas after each of 13 scrolls against a forced whole redraw at
  eight zooms and four display scales, with noise tileset files generated for the purpose:
  identical everywhere except 75% on a 125% display, where smoothed channels differ by 1/255.
  (A scroll set to a fractional position paints twice in Chrome, before and after it snaps;
  that is Chrome, not the shift.)
  Three per-paint costs are avoided too: the rulers are redrawn only when their own axis's
  scroll, scale, length or hovered tile changes (`rulerKeysRef`), not on every paint, an
  animation frame included; the font tokens are
  read with `getComputedStyle` once per paint at most (`uiFont()` / `monoFont()`); and the
  units and sprites are culled to the view *before* the painter's-order sort rather than
  after, so a paint does not build and sort a record per unit on the map.
  **The terrain revision means the ground.** Bumping `terrainRevisionAtom` for every entry
  would throw the terrain layer away and recolour the minimap on every unit move or location
  nudge, so `commitEditAtom`, undo, redo and `rollbackEntryAtom` go through `bumpGround` (`documentAtoms.ts`): an entry that `touchesGround` (`history.ts` — tiles,
  ISOM, doodad tiles, fog, a created ISOM/MASK) bumps the terrain revision, and one that does not
  bumps `objectEditRevisionAtom` instead, which nothing draws from. Units, doodads/sprites and
  locations repaint through their own revisions. The second counter is
  there for the plugin API: `"terrain"` is documented as every committed edit, so
  `EVENT_ATOMS.terrain` listens to both, and exactly one moves per commit — the event fires
  once per commit. A component that shows something an object edit changes must subscribe to
  that object's revision, not the terrain one. `tests/revisions.test.ts`; checked headlessly
  (place / move / undo / redo a unit, create / undo a location: viewport and minimap follow).
- `MinimapPanel.tsx` paints in two effects. The first draws the picture — terrain, locations,
  unit dots, start locations, fog — into a canvas of its own (`pictureRef`), with the terrain's
  `ImageData` kept in `terrainRef` under a key of what it was computed from, so a unit drag
  redraws the dots over the same pixels. The second copies the picture and strokes the view
  rectangle, and is all a scroll runs: with `viewportRectAtom` in a single effect's deps, every
  scroll frame would recompute 65,536 pixels, every dot and the fog.
  Every repaint request — a pointer move, a scroll, the `[size, draw]` effect that fires
  whenever `draw`'s identity changes — goes through `scheduleDraw()`, which books one
  `requestAnimationFrame` and coalesces the rest, so a burst of events costs one paint and it
  lands immediately before the browser's own. Call it rather than `draw()` from anything
  event- or render-driven; `draw()` itself is only run by the frame and by the animation loop
  (which serves a booked request instead of painting twice). **`draw`'s deps are only what
  it closes over** — `react-hooks/exhaustive-deps` is on (`.oxlintrc.json`) and calls anything
  else unnecessary. A value that should repaint without being read in `draw` (a revision of
  something mutated in place, a palette choice the tools read from the store) goes in
  `REPAINT_ATOMS` instead (above), which repaints without a render. The object layers' ghosts follow
  the pointer in pixels, so `onMove` schedules a paint on every move there — a terrain or fog
  brush is tile-shaped and only repaints on the crossings.
- **The view follows a drag.** The surface takes pointer capture on the press, and the
  stroke clamps to the map (`clampToMap`, "like StarEdit"), so without this a drag past the
  window repaints one edge tile forever while the view stands still. `autoPanFrom(e)` at the top of `onMove` books a rAF loop
  (`panRef`) whenever a gesture is live — `gestureRef` holds one, whichever kind — and the pointer is inside the
  `EDGE_BAND` (28 px) of the scroller's client rect or beyond it. The speed ramps
  quadratically from `PAN_MIN` to `PAN_MAX` px/s with how far past the band the pointer
  pushed, in *screen* pixels, so the view moves at the same rate at every zoom; each frame
  carries the sub-pixel remainder (`pan.dx/dy`) or the slowest push would never round up to a
  whole pixel. The point of the loop is the last line of `panFrame`: after it scrolls it
  **replays the last move**, because the pointer is not moving and nothing else would tell
  the gesture that the ground under it had changed. That is what `MoveEvent` is for — `onMove`
  and `toolPointer` take the shape rather than a `React.PointerEvent`, and `lastMoveRef` keeps
  a snapshot of the last one (never the event itself). `onUp` stops the pan, and it stops
  itself when the gesture ends or the scroll clamps at the map's edge. It cancels a `glide`
  in progress rather than fighting it.
- **Panning without a drag.** The middle button pans (`panDragRef`, ground follows the pointer);
  the press is cancelled, which also suppresses the compatibility mouse event Chromium's own
  middle-click autoscroll rides on. The arrow keys scroll the view two tiles, half a screen with
  Shift, through `viewportRectAtom` + `centerViewOnAtom` in `useHotkeys` — on the Locations layer
  they still nudge, but only while something is selected. Verified headlessly: a rect
  stroke carried 950 px past the edge as one continuous line, the pan stopped on release, hovering
  the band with no button did nothing.
- `src/editor/platform.ts` is what the chrome says about the shell it is in: `isDesktop()`
  (the Electron bridge is there) and `hostTerms()`, which answers the words — "browser" /
  "app", "this browser" / "this app", "Browser" / "Application" for a heading, and where a
  download lands. The desktop build is the same bundle in a Chromium window, so every
  "this browser" in the copy reads wrong there; anything user-visible that names the shell
  goes through it (Preferences ▸ storage's title, the save and export toasts, the plugin
  dialogs' warnings, the sound importer's decoder notes, About). It decides *wording* only
  — what the shell can do is still asked of `desktopBridge()` and the platform APIs.
  `tests/platform.test.ts`.
- **Several maps at once**. `documentAtoms.ts` keeps the open maps as `documentsAtom:
  DocumentSlot[]` — `{ id, parked }`, `parked` null for the one the registers (the document atoms
  in `documentAtoms.ts` / `editorAtoms.ts`) hold, a `ParkedDocument` snapshot for the rest. The
  design decision: the registers stay the one thing every hook and panel reads, and a switch
  (`activateDocumentAtom`) is `parkRegisters` + `installRegisters`, a few dozen atom writes and one
  full repaint — both, and closing the last map, walk the one `REGISTERS` table (field of
  `ParkedDocument`, atom, empty value), so a per-document atom is declared once; the scenario, the
  selections, the zoom and the view are handled beside it, and a gesture (the placing modes, the Blend
  anchor) is ended on every install and close; nothing is re-parsed and a parked map has no subscriptions, no viewport and no
  analysis running, so the one-map case is unchanged and a background map costs memory only. The
  alternative, one Jotai store per map with the Provider swapped, remounts the whole tree and loses
  component state (`useTileset`'s), and the plugin host holds the default store — rejected.
  Per-map: the file, handle, origin, save options, modified, blank fill, both history stacks, the
  five selections, the marked clip area, zoom and the view centre (read back from `viewportRectAtom`
  and restored through `centerViewOnAtom`, since the scroll lives in the scroller element).
  Global: the active layer, brushes, palette picks, view flags, symmetry, the clipboard itself.
  `loadDocumentAtom` takes `into: "tab" | "replace"` (default replace;
  `"replace"` reason keeps the slot); `openTarget` in `services/documentActions.ts`
  decides from the `multipleMaps` preference and `isUntouchedBlank` (no file, no changes, no history
  — the startup map is replaced rather than kept beside the first real map, so opening one map still
  leaves one map). `needsCloseConfirm(store, pending)` answers false for an open/new that goes beside.
  `closeDocumentAtom` brings the neighbour to the right (else left) forward with reason `"switch"`.
  The tab strip is `chrome/TabStrip.tsx` under the toolbar, rendered only from the second map; the
  Window menu lists the same maps (Ctrl+Tab / Ctrl+Shift+Tab on the desktop only — the browser owns
  them); there is deliberately no tab reordering yet. `useTileset` does not release a tileset a
  parked map draws with (`parkedTilesetsAtom`); releasing it is the one thing that would make a switch
  slow (~20 MB atlas rasterised again each way). `useCloseGuard` asks on `anyModifiedAtom`, and the
  desktop's close and File ▸ Exit go through `quitGuard`, which brings each modified map forward and
  asks the Close Scenario dialog about it in turn (Don't Save moves on, Cancel keeps the window).
  `tests/documents.test.ts` covers all of it; headless check (two fixtures dropped, switch,
  scroll restored, both tilesets held then one released on close, Window menu, preference off).
- **View-only maps** (for the replay viewer). `viewOnlyAtom` (`editorAtoms.ts`, so
  `uiAtoms.ts` can read it without a cycle; re-exported from `documentAtoms.ts`) is a per-document
  register — parked/installed with the rest, kept on a `"replace"` reload, cleared on close — set
  from `LoadedDocument.viewOnly`, which only `openFileInto(…, viewOnly)` passes (from a plugin's
  `document.open(…, { viewOnly })`, always beside, never through the unsaved gate). A view-only map
  never enters Open Recent. **The trap:** almost every edit path mutates the scenario *before* its
  commit (strokes paint live, drags move live, dialogs write the tables), so a guard at the commit
  alone is too late. The gates are where edits *start*: `MapViewport` (`objectLayer()` wraps the
  layer so select/marquee still work and drag/place are no-ops; the location adapter loses handles,
  move and create; terrain/fog strokes and paste-at return before starting), `openDialogAtom`
  refuses `EDITING_DIALOGS` (covers double-click, menus, context menu, `ui.open`), the menu bar /
  context menu disable their editing rows and the toolbar leaves them out (Edit a Copy in Save's
  place; the rule is `atoms/viewModeAtoms.ts`, see plugins-host.md "What else carries over"), `App` hides the left dock, the Properties
  and Layers panels are hidden (not merely disabled: Aftermath's replay layout needs the column; View has every layer switch), the delete/convert/nudge atoms and the clipboard hook call
  `canEdit`, `save()` and `saveDocument` refuse anything but a copy. The **backstop** is in the
  commit atoms: `commitEditAtom` / `commitTerrainAtom` roll the already-applied entry back
  (`rollbackEntryAtom`), the table commits take the diff and `applyTables(…, "undo")` it, resize /
  change tileset / replace / undo / redo refuse. `canEdit(get, set)` puts the reason on the status
  bar. Plugins: `assertWritable` in `plugins/host/shared.ts` throws from `runTransaction`, `runUpdate`, section
  writes, `extras`, clipboard cut/paste, `resize`, `changeTileset`, `save`/`saveAs` unless a copy,
  `sync.start`. Exception: `sections.replaceFile(…, { asOpened: true })` is taken (Repair's on-open
  pass is a reading of the file, and replay maps are often protected ones it makes readable).
  Not covered: a plugin writing through `scenario()`/`tx.scenario` directly — typed read-only, no
  proxy. File ▸ Edit a Copy (`editCopyIn`) re-parses the serialised scenario into a new unsaved,
  modified tab. `tests/viewOnly.test.ts`.
- `src/hooks/useWindowTitle.ts` keeps `document.title` on the open map — the file name when there is
  one, else the scenario name, with a leading `*` while it is modified, and the plain
  `scmJS — StarCraft Scenario Editor` of `index.html` when nothing is open. Electron mirrors the page
  title into the window title, so the desktop build's title bar and taskbar entry follow it too.
- `src/hooks/useDesktopFiles.ts` is the desktop's "Open with": `desktop/main.ts` holds the single
  instance lock, takes a map path from `argv` / `second-instance` / macOS `open-file`, and sends the
  bytes and the path on `file:open` once the renderer's `files.onOpen` listener says `file:ready`; the
  hook opens them with a `diskHandle(path)` (see `saving.md`, desktop maps go by path) through
  `guardedAction` like a drop. What sends it one is `fileAssociations` in
  `electron-builder.yml` (`.scm` / `.scx` / `.chk`, one mime type each — electron-builder writes a
  `<mime-type>` block per association into the Linux packages' mime XML and shared-mime-info reads
  only the first of a repeated type): the NSIS installer registers `"$appExe \"%1\""` per extension
  and unregisters on uninstall, the deb / AppImage carry the mime XML and a `MimeType=` desktop entry
  whose `Exec` ends in `%U`, and the macOS bundle gets the `CFBundleDocumentTypes` without which
  Finder routes nothing and `open-file` can never fire. The Windows *zip* registers nothing, as any
  unpacked build does not — dragging a map onto `scmJS.exe` still goes through `argv`.
- **The menu bar on the site** (three doors, Editor / Play / Replays, and one header). `site.ts#onSite(at, desktop)` is the rule and `platform.ts#isOnSite()` asks it of the page: the origin is
  `SITE_ORIGIN` (the stable editor at `/editor/` and the nightly at `/nightly/`), or the host is `localhost` /
  `127.0.0.1` and the path starts with `/editor/` (a stand-in for the site: `npm run dev:site`). It is the scm-sim
  plugin's `simAddress` rule on purpose — where the play page is, the site is — and the two must stay in step. The
  desktop app is refused first, whatever its window loaded. `SITE_ORIGIN` lives in `site.ts` (`moveIn.ts` re-exports
  it; `site.ts` must stay free of imports, since `atoms/storage.ts` and `moveIn.ts` read it before storage is).
  `tests/site.test.ts`. **Off the site**: `MenuBar` renders a plain `div.brand` and the bare
  `.menubar-doc`. On it: `a.brand` (scm in the pink, JS in `--text`, as the splash title; `/` or `/ko/` by the editor's
  language, the site header's own rule), and after the menus `.menubar-rest` holding the map's name and `SiteNav`
  (`chrome/SiteNav.tsx`): Play `/play/`, Replays `/replay/`, the game data chip, Library `/library` (`SITE_PAGES`).
  - *The chip* is `copies.ts#heldGameData` over `listStoredCopies()`, listed again on `gameDataSourceAtom` /
    `gameDataRevisionAtom` as the Game Data page does, in the site header's words and tooltips (`site/header.js` is the
    third place the rule lives: none / download / classic / remastered / both, a mod's set not counted). It links to
    `/editor/data`, the header's address for `data.html`. It says what the *browser holds*, so a build with bundled
    data (a stand-in over a checkout with `public/tileset`) reads "No game data" over drawn terrain; its tooltip then
    says the files come with the build. `GameDataPage`'s mark link uses `isOnSite()` too.
  - *Replays is the current door* (`.here`, `aria-current`) when the map in front is view-only **and** a plugin's
    file type claims `.rep` (`fileTypes.ts#opensReplays`). The editor cannot tell a replay's map from another
    view-only one — `ViewOnly.label` is the plugin's translated word — and Aftermath is the only thing that opens
    one, so that is the test. A plugin that opened view-only previews would light it wrongly.
  - *No account button*: the scmjs.dev plugin's account is the Account menu (before Help) and a status bar cell;
    nothing of a plugin's is at the bar's right end, and there is no API that puts something there.
  - *Leaving*: plain same-tab `<a href>`s, like the site header's. `useCloseGuard`'s `beforeunload` is what asks
    with unsaved changes — the same question as closing the tab, nothing new to keep in step (checked in headless
    Chromium: clean goes at once, a painted map gets the browser's dialog, Cancel stays). The editor's own Close
    Scenario dialog (`quitGuard`, Save first) is not used: after Don't Save the `beforeunload` listener would ask
    a second time unless it were told to stand down, and a new tab for every door was rejected as unlike the site.
    Every *other* link in the editor (`window.open(…, "_blank")`: docs, issues) goes off the origin and stays so.
  - *Narrow* (`chrome.css`, "A narrow window"): `.menubar-rest` is `flex: 1 1 0` and a size container, so its width
    is exactly the room the menus leave, whatever the language and however many menus plugins added, and the steps
    are container queries on it: ≤520 the chip's words go (dot + tooltip stay), ≤300 the map's name (it ellipsizes
    before that; its dot stays), ≤240 Library and the paddings tighten, ≤156 Replays, ≤92 Play, ≤52 the chip. Each
    number is the measured width of the row that must fit, plus a few px: English with the Account menu is 733 px of
    brand and menus, so at the desktop's 900 px minimum (the only stated minimum; a browser has none) the room is
    161 px and holds dot, Play, Replays and the chip's dot. Korean menus are narrower (637). Re-measure if a door is
    added or a label grows. The menus are never pushed: they are `flex: none` before the container.
  `e2e/startScreen.spec.ts` covers both sides (see `e2e.md`).
- **The start screen** (`viewport/StartScreen.tsx`, in `.map-stack` under its own `Guarded`). Shown
  while `scenarioAtom` is null **and** the editor has started — the editor still starts on StarEdit's blank map
  (`useStartupMap`), so this is what File ▸ Close Map on the last map leaves. "Started" is `preloadStepAtom.done`
  (the preload's last task waits for the startup map; without the gate the screen flashes for the moment before
  that map exists) or a map having been open since the page loaded (`mapSeen`, a module variable: `App` remounts on
  a language change and on the crash screen's Try again, and the second preload that retry starts never finishes
  with no map open). Making it the landing view instead would mean not creating the startup map, and `documentReady` in
  `usePreload` then never resolves (the splash would sit until `MAX_MS`); it also changes what every plugin and
  deep link finds at start. Not done; it is a decision, not an oversight.
  It opens nothing itself: the drop zone is the Open dialog's `.dropzone` with no handlers (a drop bubbles to
  `App`'s `onDrop`, and `.app.drop-target .start-drop` is the highlight), New map… is `openDialog("newMap")`, Open a
  file… is `pickMapFile(pickerFileTypes(store))` into `guard({ action: "open" })` — the Open dialog's Browse without
  the dialog — and a recent row is `openRecent` (a row without a handle leads to the picker; the menu greys those).
  The words follow the plugins: "or a mod's folder" only while a file type has `openFolder` (`opensFolders`), the
  replay sentence only while one claims `.rep`, and "in Replays" in it only on the site, where there is such a door.
  From your library (`/library`) is on the site only. `z-index: 5`: over the viewport's notices (same level, later
  in the DOM), under a plugin's floating panel (6). Two columns, one below 620 px of map area (a container query:
  the docks decide that width, not the window). After a close the minimap keeps the closed map's picture and the
  bar its name — both left alone.
- Dropping a map on the window is `App.tsx`'s `onDrop`, and the same file has a **document-level**
  pair of listeners behind it, because two things render outside `.app`: the splash and every dialog
  (Radix portals them to the body). A drop that reaches no handler is navigation — the window loads
  the file and the app is gone — so the document cancels `dragover` (without which no drop event
  fires at all) and cancels every drop, opening the file only when nothing already claimed it
  (`defaultPrevented`; React's own listeners, on the root container and on each portal container,
  run first). `desktop/main.ts`'s `will-navigate` is the backstop: anything that is not the app's
  own origin is refused, and an `http(s)` one goes out to the browser like `setWindowOpenHandler`'s.
- `src/hooks/useCloseGuard.ts` is leaving the editor altogether with unsaved changes, gated on
  the same `confirmClose` preference and the same three facts as `needsCloseConfirm`. A browser
  gets `beforeunload` (added and removed with the unsaved state, so a clean document keeps the
  page's back/forward cache) and prints its own generic question — the page cannot word it, show
  a dialog or save first. The desktop build does the real thing: `desktop/main.ts#guardClose`
  holds the window's close back while `window.scmjsDesktop.window` says the map is dirty, asks
  the renderer, and the hook opens the ordinary Close Scenario dialog with a `"quit"`
  `PendingAction` — so Save writes through the same path as File ▸ Save — then answers with
  `respondClose`. A dismissal reaches it as false through `guardedAction`
  (`services/documentActions.ts`, the gate `document.open` / `document.create` share). Electron fires
  `beforeunload` on a window close too but a value returned there cancels it *silently*, which
  is why the browser half is skipped whenever the bridge is there.
- Hotkeys: `src/editor/commands.ts` is the one list of rebindable commands (id, label, group,
  `defaults` / `webDefaults`, `inText`, `inDialogs`) and the combo grammar (`comboOf`: Ctrl
  folds Cmd in, letters/digits from `e.key` when it is one else from `e.code` — so AZERTY
  Ctrl+A is Ctrl+A but Ctrl+Shift+0 is not `)` and a Hangul layout still hits Ctrl+S; `+` is
  `Plus`). `Preferences.hotkeys` holds only the commands the user changed, each with its whole
  list (`[]` = unbound); `withBinding` drops an entry equal to the defaults. `hotkeysAtom`
  (preferencesAtoms.ts) resolves them through a derived `hotkeyOverridesAtom` so an unrelated
  preference does not re-render the menus. `useHotkeys` order: `inDialogs` commands (F1) →
  return if a dialog is open → plugin hotkeys (still `comboOfEvent`, their own format; a
  plugin wins a clash) → the command (text fields: only `inText` and only with Ctrl/Alt/F-key,
  `firesWhileTyping`) → Delete / Escape / arrows inline, which are layer-dependent and
  `reservedReason` keeps off-limits for binding. MenuBar / ToolBar / F1 (`dialogs/hotkeys.ts`
  `hotkeyRows`) read labels through `shortcutOf`; `LAYERS` carries no key. The
  Hotkeys page captures on a window **capture-phase** listener with stopPropagation, so neither
  DialogFrame's Escape nor the editor's hotkeys see the key being bound. "Typing" is
  `takesText` (commands.ts), shared with plugin dialogs' paste: text inputs, textareas,
  contentEditable **and an element with an `editContext`** — Monaco 0.56+ takes text through the
  EditContext API on a plain `div.native-edit-context`; without it, typing S in the API
  Playground's code box switches layers and Ctrl+V pastes onto the map. Tests: `tests/hotkeys.test.ts`.
- Status bar cells: `Preferences.statusBar` (eight booleans, Preferences ▸ View), read by
  `StatusBar.tsx` through `statusBarCellsAtom` so the bar does not re-render on unrelated
  preference changes. The message, the symmetry badge and plugin status items are not
  optional. Ctrl+A's status line uses the same plural `t()` strings as Edit ▸ Select All.
  Neither is a folder being read (a dropped folder before a plugin has it, a folder picked for one):
  `folderReadsAtom` cells, spinner and a count, before the plugin items — the editor's one wait that
  is not a plugin's, so it borrows their `plugin-status` / `status-spinner` look (see `plugins-host.md`).
- File actions (open/save/new, drag-drop) are in
  `src/services/documentActions.ts` (the hook `useMapFileActions` wraps it for components) and `src/services/mapIo.ts` (File System Access API with
  `<input>`/download fallbacks).
- **Interface size** (2026-11-16, `Preferences.interfaceSize`: 100 / 115 / 130, Preferences ▸ View ▸ Interface;
  `styles/size.css`, `editor/interfaceSize.ts`). At 115 / 130 the root carries `data-ui-size` and
  `--ui-zoom` (1.15 / 1.3); at 100 neither is there and **no rule of `size.css` applies**, every rule being under
  `:root[data-ui-size]` (`tests/interfaceSize.test.ts` checks that), so the default is byte for byte what it was
  (screenshots against `origin/main`: identical). It is CSS `zoom` **per surface**: `.app`'s children but `.body`,
  `.body`'s but `.map-column`, `.map-column`'s but `.map-stack`, the chrome laid over the map (`.map-view-switch`,
  `.map-hud`, the notices, the start screen, a plugin's floating panel), and what is portalled to the body (`.dlg`,
  `[data-radix-popper-content-wrapper] > *` — the content, never the wrapper, which floating-ui positions in page
  pixels and then measures with the zoomed content inside — the plugin tooltip, the splash card, the crash card).
  **The map is never inside a zoomed box, and that is the point.** `MapViewport`'s pointer arithmetic is
  `clientX - rect.left + scrollLeft`: page pixels against the scroller's own, equal only at zoom 1. Rejected:
  zooming the page and zooming `.map-stack` back by `1 / z` (Chromium multiplies the two to 0.99999994, and
  `getBoundingClientRect` came back 299.98 for 300); the browser's / Electron's page zoom (it is the map's zoom
  too, and the map would have to draw at fractional pixels per tile to undo it); scaling the type and spacing
  tokens (1,174 px literals in `src/styles`, plus inline sizes, icon sizes and virtualised row heights in TS —
  a rewrite, and plugins would follow only where they use the tokens). **The second trap** is sub-pixel: Chromium
  draws the map canvas at its box *rounded* to the pixel (checked by comparing a screenshot with `getImageData`:
  exact at the rounded spot, no resampling) while the pointer is measured against the box itself. 28 px × 1.3 =
  36.4 put the map's corner at y = 103.19, drawn at 103, and a press on a tile's first row read the row above. So
  what sits above and left of the map — the menu bar (and its error bar), the toolbar, the tab strip, the left
  dock (its width also as `--dock-w`) — is sized `calc(round(h × z, 1px) / z + 0.01px)`, which Blink lays out as a
  whole number of page pixels (the `+ 0.01px` beats the 1/64 px truncation of `h / z × z`). `e2e/interfaceSize.spec.ts`
  reads the tile under the first and last pixel of a tile and fails (6, 9 for 6, 10) without the rounding.
  Inside a zoomed surface a length is the surface's own pixels: what comes from the window is divided by `--ui-zoom`
  (`.dlg`'s `max-width` / `max-height`, `.full` / `.tall`, the select's `--radix-select-trigger-width`, the sound
  picker's available height, a menu's `--radix-popper-available-height` — menus scroll then — and the splash
  card's `vmin`, which also gets a `72vh` cap since a 4:5 card is height-bound), and code that turns a pointer
  position into a place divides by `zoomOf(el)` (`currentCSSZoom`): `useDockResize` (and `max(zoom)` for the right
  dock's 45%), the console's grip, the bottom plugin strip, a floating plugin panel's drag and grip (its position is
  kept in its own pixels now), the Tile tab's three hit tests, and the plugin tooltip's placement (sized × zoom,
  placed ÷ zoom). Radix's slider, the minimap (`box.width` ratio) and Monaco (it walks the ancestors' `zoom`;
  checked in TrigScript at 130%) need nothing. Two layout steps only under the attribute: the right dock's panels
  sit in `.dock-panels` (a plain flex column, the same layout at 100%), which scrolls at a larger size instead of
  running over the status bar, and the toolbar is a size container that drops the Layer / Brush labels below 1240 own px and Players / Triggers / Test's words
  below 1120 own px (natural width ~1,250 with the brush group). **The same overlap and toolbar crush happen at
  100% in a window under ~1,050 × 600**; not changed here, to keep 100% untouched. Early: `index.html` sets the
  attribute in an inline script from `localStorage["%SCMJS_PREFS_KEY%"]` (vite.config fills in the nightly's
  namespaced key) before the boot splash paints, and its own `:root[data-ui-size] #boot-splash .card` matches
  `.splash-card`; `useApplyPreferences` keeps it on `interfaceSizeAtom` after. What does not follow: canvases in
  the chrome (minimap, Tile tab, a plugin's charts) are stretched, not redrawn at the finer density; the rulers
  stay the map's 20 px; native `title` tooltips and `<select>` popups are the system's. Plugin code that mixes
  `getBoundingClientRect` / `clientX` with `clientWidth` is off by the zoom: Aftermath's timeline draws its hover
  line at 1.3× the pointer's offset at 130% (its seek, which uses `rect.width`, is right) — `docs/plugins.md`
  says how to write it.
- **Notices kept until closed** (`Preferences.keepNotices`, off by default). `pushToastAtom` still stores the
  time asked for (`defaultToastTtl`: 6 s, 12 s for an error); `Toasts` asks `toastLifetime(toast, keep)`, which is 0
  while the preference is on, so a plugin's `ui.toast` with its own time is held too, and turning it off later
  starts each notice's own time from then. Up to four are shown (`slice(-3)`); while the preference is on and two or
  more are up, a *Close all* (`dismissAllToastsAtom`) sits above them. Each notice's × is a button, so Tab reaches it.
- CSS is plain, layered in import order `tokens → base → ui → chrome → panels → viewport → dialogs → splash → size`
  under `src/styles/`; design tokens are CSS variables in `tokens.css`.
