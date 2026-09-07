# The plugin host and the API surface

### Plugins (`src/plugins/`, `src/atoms/pluginAtoms.ts`, `plugins/*/`)

`docs/plugins.md` is the guide for plugin users and authors (installing, trust, the API tour, and a
"Plugins to read" table pointing at each repository); the host side is `docs/development.md#the-plugin-host`.
`github.com/scm-js/plugin-hello-world` (in the registry, not a default) is the example plugin the guide,
the README and the docs site's home page send a new author to copy; keep it building against the contract.
Keep the tour in step with `src/plugins/api.ts`,
which is the contract (types only, `PLUGIN_API_VERSION` bumps on an incompatible change). A plugin
is `activate(api)` in a `plugin.ts`/`.js` next to a `plugin.json`; `host.ts#createPluginApi` builds
its `PluginApi` over the Jotai store — no React, no atoms exposed — and a `Contributions` bag every
`add`/`on` lands in so `deactivatePlugin` sweeps everything back whatever the plugin returned.
`api.document.edit(label, tx => …)` is `runTransaction`: an `EditTransaction` whose operations
**apply as they are called** (later ones see earlier ones) and accumulate change lists in `applyEntry`
order (terrain through `Stroke`, so a cell written twice is one change), then one `HistoryEntry` goes
to `commitTerrainAtom` — the stranded-doodad / stranded-unit pass pulled out of `useTerrainTools`
(which now calls the same atom) — so a plugin edit undoes, dirties and repaints exactly like a stroke.
Anything that needs the graphics (`stampTerrain`, `fillFlat`, `paintIsom`, `placeDoodad`) degrades
to a `notes` entry and `0` without them, never throws. `terrain.diamondsIn(rect)` is inclusive of the
far edges so a whole-map rect covers the last lattice column and row.
The API is **promise-first**: everything asynchronous returns a `Promise` (a dismissal resolves
`null` / `false` rather than rejecting), `activate` and a dialog button's `run` may be `async`, and
the callbacks that remain are subscriptions — events, DOM handlers, `mount`, a map tool's or
overlay's hooks — each returning a `Disposable` or a cleanup function. The **one** exception is a
transaction's builder: `edit` / `update` commit when `build` returns, so an `async` one would commit
what ran before its first `await` and let the rest mutate the map outside the entry. `Sync<T>` in
`api.ts` (a conditional type resolving to a sentence when `T` is a promise) makes TypeScript refuse
it, and `host.ts#checkSyncBuilder` catches it at runtime for a plain-JavaScript plugin — a `notes`
entry and a `console.error`, not a throw. **A transaction is closed when its builder returns**:
`host.ts#sealed` wraps every function on the `tx` (and the nested function groups of an update's)
so a handle kept past the return, or the half of an async builder after its first await, throws
instead of writing outside the entry — before this, both wrote to the scenario with nothing
recording it. **A builder that throws is rolled back** in `runTransaction`: the change lists it
accumulated are the inverse, `documentAtoms.ts#rollbackEntryAtom` applies them backwards and
repaints without touching the history or the modified flag, and the error is rethrown. `runUpdate`
has no change lists, so on a throw it commits the sections touched (the map reads as modified, the
chrome re-reads) and rethrows; leaving a renamed map under an unmodified title bar was the
alternative. `Contributions.disposed` is the terminal state of a deactivation: `add` after it takes
the contribution straight back with a `console.warn`, and `createPluginApi`'s `gone()` makes every
document write (`edit`, `update`, `open`, `create`, `save`, `saveAs`, `close`, `resize`,
`changeTileset`, `extras.set` / `remove`, and `sectionsApi`'s writes through its `alive` argument)
refuse with a `console.error` — a fetch landing after the user turned the plugin off used to register
menu items and edit the map through the old API object. `loadPlugin` takes `{ accept }` and
`loadAndRun` passes `checkApiVersion`, so an incompatible manifest is refused *between* reading it
and importing the module: the plugin's top-level code never runs. `services.watch` compares the
registration key, not the object, so re-providing the same object under a new version notifies.
All of it came out of the 2026-09-05 outside review of the API's state design (`tests/plugins.test.ts`
pins each). `ProgressHandle` carries `signal` beside `cancelled()`.
`api.document.open(file)` is File ▸ Open without React: `host.ts#openDocument` builds a `File` and
runs `useMapFileActions.ts#openFileInto` (the store-level half of the hook's `openFile`), or, when
`needsCloseConfirm(store)` says the map is modified and Preferences ask, parks an "open"
`PendingAction` in the Close Scenario dialog: `runPending` answers through its `done` callback, and a
dismissal (Cancel, Escape, the ×) is seen from `dialogStackAtom` — the entry leaves without `taken`,
which `proceed` sets before closing (an unmount effect ran once at mount under React's dev double-mount). `document.export()` is `writeMapBytes` with the archive extras as a `File`,
`document.renderImage()` is `exportMapImage` (null without the tileset or a canvas), and
`document.extras` reads and writes `archiveExtrasAtom` (setting marks the map modified) so a plugin
can keep a file of its own in the archive. `MenuItemSpec.icon` (`"plugin"` resolves to the manifest
icon at `menu.add`, so `PluginMenuItem.icon` is always a `PluginIcon`) draws through `PluginIconView`
in the item's indicator slot, and `after` makes `withPluginItems` splice the item under the named
built-in instead of appending after a separator.

`api.ui.pickArea` / `pickTile` / `pickObject` (`host.ts#pickOnMap`) put one `MapPickRequest` in
`mapPickAtom` (`pluginAtoms.ts`); `MapViewport` serves it ahead of every layer (crosshair, teal
marquee, HUD chip with the prompt) and calls its `finish` on mouse-up — for `"object"` on
mouse-down with the unit or location under the pointer (`pickHoverRef`, resolved on every move
with `unitAt` / `locationAt` and drawn as a teal outline with the name; a click on nothing keeps
picking; `kinds` narrows it); `finish` clears the atom and is guarded so the
host's other exits (scenario change, `Contributions` dispose, a newer pick) and `cancelMapPickAtom`
(Esc in `useHotkeys`, right-click in the viewport) all resolve the promise exactly once. A modal
dialog covers the map, so a plugin closes its dialog, picks, and reopens. `images.ts` is
`ui.loadImage` (Blob / `data:` / `http(s)` with a CORS `<img>` fallback), `ui.readClipboardImage`
and `transferOf`, which `PluginDialog` feeds to `DialogSpec.onPaste` (document-level listener
while the dialog is topmost; a paste into the plugin's own text field is left alone unless it
carries files) and `onDrop`. `DialogHandle.setTitle` goes through a title box in the dialog payload.
`PLUGIN_API_VERSION` is 1 and stays there while the only plugins are the scm-js organisation's own
(they move with the editor); a manifest's `api` is the version the plugin *needs*. Do not bump it
for additions.

`api.ui.mapTool` (`host.ts#startMapTool`) is the pointer-owning mode a plugin with a drawing tool
needs: one `MapToolRequest` in `mapToolAtom`, served by `MapViewport` after a pick and ahead of
every layer — `onDown` captures and forwards `MapPointer`s (map px, tile, `inMap`, `down`,
modifiers; clamped to the map while held), `onLeave` sends one `inMap: false` move, the layer's
hover ghost and "placing" HUD chips are hidden while `tooling`, the surface takes the spec's
cursor, and the spec's `draw(ctx, view)` runs at the end of the paint pass (`MapView`: `x(px)` /
`y(py)` to canvas pixels, `tilePx`, `zoom`, `visible`); `mapToolRevisionAtom` is `redraw()`.
`cancelMapToolAtom` (Esc in `useHotkeys`, right-click in the viewport) asks the spec's `onCancel`
first and finishes only when it does not keep the tool; `finish(reason)` is guarded like a pick's,
clears the atom and tells `onStop` once (`stopped` / `cancelled` / `document` / `replaced` /
`disabled`). `api.ui.overlay` (`host.ts#registerOverlay`) is the passive counterpart: a `PluginOverlayEntry` in
`pluginOverlaysAtom` that `MapViewport` draws at the spec's slot (`above`: after the grid, after the
objects, or after the hover ghost but before a map tool's drawing) while `visible`, and whose
`onHover` its `onMove` / `onLeave` feed a `MapPointer` (or null) on every layer and during a tool —
it never owns the pointer. The View menu (after the built-in overlay flags) and the Layers panel
(an *Overlays* group with eyes) list the entries; every visibility write, theirs and the handle's,
goes through `setOverlayVisibleAtom` so `onToggle` fires once per change and
`overlayVisibilityMemory` remembers the user's choice per plugin and name for the session
(`registerOverlay` reads it before the spec's `visible`). `pluginOverlayRevisionAtom` is `redraw()`;
`remove()` and the `Contributions` sweep drop the entry; `pluginOverlaysAtom` is part of the
`"view"` event.
`api.ui.panel` is a floating, non-modal frame over the map (`pluginPanelsAtom`,
`components/panels/PluginPanels.tsx` rendered inside the viewport: draggable title strip,
positions kept per plugin + title for the session, opens top-right; `PanelSpec.height` and
`resizable` — a corner grip, sizes kept like positions, the body a flex column so the plugin's root
can fill it — exist for a plugin that keeps an editor beside the map, TrigScript being the case) — hotkeys keep working since
it is not in the dialog stack. `PanelSpec.dock: "right"` puts the same entry in the right dock
instead (`DockedPluginPanels` in the same file, rendered by `Docks.tsx` after Properties as a
`.panel.plugin-docked` with the built-in panel head; `App.tsx`'s `rightVisible` counts them, so
the dock stays up with every built-in panel hidden; `grow` gives it the spare height). The other
"built-in feel" surfaces added with it: `api.ui.statusItem` (`pluginStatusItemsAtom`,
`host.ts#addStatusItem`; `StatusBar.tsx` renders the cells after the message with the plugin
icon or a `.status-spinner` while `busy`), `api.ui.dialogSlot` (`pluginDialogSlotsAtom`; a
dialog opts in by passing `slot={{ dialog, fields, payload }}` to `DialogFrame`, which renders
`components/ui/DialogSlots.tsx` at the left of the footer — one `<span>` per registration,
`mount`ed with a `DialogSlotHost` whose `fields` read the dialog's working copy live through a
ref; `SlottedDialogId` in `api.ts` is the list of dialogs that pass it and the fields each lends,
keep it in step when adding one) and `api.view.flash` (`host.ts#flashOnMap` resolves the target
to boxes in map pixels *at call time* onto `viewFlashesAtom`; `MapViewport` paints them after
the `"everything"` overlays, gold for `change` and teal for `attention`, and an effect repaints
every frame while any is live, sweeping the list when the last expires). All additive;
`PLUGIN_API_VERSION` stays 1. `api.palette` reads and sets the object palettes' picks
(`activeUnitAtom`, `unitOwnerAtom`, the sprite and doodad atoms, `fogPlayersAtom` / `fogModeAtom`)
and answers names, groups, `unitSize` (placement box) and `doodadInfo`; the `"palette"` event
covers those atoms plus the terrain brush. `tx.placeUnit` snaps through `snapPlacement` with the
palette's snap option, `tx.canPlaceUnit` is `checkPlacement` with `placementOptionsAtom`,
`tx.placeSprite` is make + add + `clampSprite`.

A plugin writes to the map in exactly the three ways the editor itself does, and the API names
them: `document.edit` (terrain and objects, one `HistoryEntry`), **`document.update`**
(`host.ts#runUpdate` — the tables and settings every dialog's OK writes: `tx.triggers` /
`tx.briefing` over `editor/triggers.ts`, `tx.strings` (`internString` / `setString` /
`applyStrings`), `tx.switches`, `tx.properties`; operations apply as they are called, exactly as
`runTransaction`'s do — which is what keeps a working-copy ordering hazard, switch names interning
while a copy of the string table is held, from arising — and the commit runs *both*
`commitTriggersAtom` and `commitSettingsAtom` and re-syncs `mapNameAtom` / `mapDescriptionAtom`;
`UpdateResult.sections` is the sections actually touched, so `changed` is false on a no-op), and
`document.sections` (raw bytes, re-parse, history dropped). `document.update` also carries the Scenario menu's
dialogs — `tx.players` / `tx.forces` (OWNR+IOWN, SIDE, COLR, CRGB, FORC), `tx.unitTypes` (UNIS/UNIx + PUNI),
`tx.upgrades`, `tx.techs`, `tx.sounds` (WAV + archive members), `tx.setVersion` — as *views* and *patches* in
`editor/settings.ts` (`playerSlotViews` / `patchPlayer`, `unitTypeView` / `patchUnitType`, …: effective numbers with
the dat defaults filled in, hit points in whole points, a patch answers with the sections it changed so `runUpdate`'s
`tracked` can report them even on a fresh map where everything is already dirty), and `api.settings` reads the same
views without a transaction; `document.resize` is `resizeDocumentAtom` (history dropped). Around them: `api.triggers`
(read TRIG/MBRF plus `triggerDefs.ts`, the text printer/parser and the `newTrigger` /
`isPreserved` helpers — everything a trigger editor needs that is not a write), `api.query`
(hit-testing through the layers' own functions, `validateScenario`, `mapStatistics`,
`findInScenario`, `stringUsages`), `api.view` (`zoomAtom`, `viewportRectAtom`, `centerViewOnAtom`,
`viewFlagsAtom`, and `goTo` taking the same shape `Issue.target` carries, so a linter can scroll to
what it found; `reveal` is the shortest move that shows a rect, worked out in `host.ts` against
`viewportRectAtom` and `ZOOM_STEPS` — with `fit` the zoom is set first and the target origin is
measured from the centre, because `MapViewport`'s zoom layout-effect keeps the centre — and posted
as a `ViewCenterRequest` with `animate` and `done`; `MapViewport` glides there in its own rAF
loop, eased, 220–600 ms by distance, and gives up with `done(false)` the moment the scroll
position is not where its last frame left it, which is how a wheel, a scrollbar drag or a
minimap click wins without a listener. `done(true)` is deferred two frames past the paint that
moved `viewportRectAtom`, so a plugin can take any `"view"` event *after* the promise settles as
the user's — the scmjs.dev assistant's following rests on exactly that), `api.data` (the decoded `.dat` tables off `peekUnitAssets`), **`api.consts`**
(the numbers a record is *written* in: `TILE_PX`, the special unit ids and default resource amounts
from `editor/units.ts`, the `UnitValid` / `UnitUsed` / `UnitState` / `UnitRelation` / `SpriteFlag`
/ `Elevation` bit masks and `ANYWHERE_INDEX` from `sections/objects.ts`, and `consts.triggers` —
every enumeration in `sections/triggers.ts` (`ConditionType`, `ActionType`, `BriefingActionType`,
`PlayerGroup`, the enumerated arguments, the three flag words) plus `DEATHS_TABLE_ADDRESS`, keyed by
`ArgDef.kind` so `api.consts.triggers[arg.kind]` resolves an argument's values; `api.ts` names their
types as `typeof ConditionType` rather than respelling the literals, so the bundle cannot drift from
the codec. All handed over by identity —
`tests/plugins.test.ts` pins that they are the editor's own objects and not a second copy. They are on
`api` rather than in `@scm-js/plugin-api` because that package is types only: `import type` is erased
before the loader sees the specifier, which is what lets a plugin depend on a package at all, so a
*value* imported from it type-checks and is then undefined. Anything a plugin needs at run time has to
arrive on `api`), `api.graphics`
(`plugins/graphics.ts`: the viewport's own sprite and atlas caches, plus `renderRect`, which is why
`MapImageOptions` grew a `rect` — `renderMapImage` clamps its terrain loop to it and translates the
context, everything else already drew in map coordinates) and `api.commands`
(`pluginCommandsAtom`; ids are namespaced under the plugin unless they carry a dot, and
`menu.add` / `contextMenu.add` / `hotkeys.add` take `command` in place of `run`).
The `"document"` event carries a `DocumentEvent { reason, fileName, id }` (`host.ts#documentEvent` over
`documentChangeAtom`, which `loadDocumentAtom` — `reason` on `LoadedDocument`, `"open"` by default, `"new"`
from File ▸ New, `"replace"` from `replaceScenarioAtom`, `"switch"` from `activateDocumentAtom` and from
`closeDocumentAtom` when another map takes the front — and `closeDocumentAtom` write; `id` is
`activeDocumentIdAtom`, null for a scenario a test set directly). Several maps (2026-09-07, see
`viewport-ui.md`): `api.document` grew `id()`, `list()` (`documentTabsAtom` copied), `activate(id)`
(synchronous — nothing is read), `open(file, fileName?, { into })`, `into` on `create`'s options and
`close(id?)`, all over `useMapFileActions` (`activateDocumentIn`, `closeDocumentIn`, `openTarget`);
the API talks about documents, never tabs, so the strip is the chrome's business and no UI surface was
added. Plugins that keep per-map state key it on `id`; Repair resets on any reason but `"open"`, so a
switch drops its *Restore original* for the map that went behind (a plugin-side improvement, not a
host bug). The other events carry nothing. Events are notifications in activation order and never intercept; a listener that rewrites
the map raises a fresh `"replace"` for the rest — there is deliberately no plugin ordering.
`api.document.sections` also has `trailing()`, `required()`, `defaults(name)` and `rebuild(names?)`
(`editor/sections.ts#defaultSectionBytes` / `rebuildSections` / `requiredSectionNames`), and
`EditTransaction` has `rebuildIsom()`; `api.terrain.checkIsom()` awaits the tileset.
`api.ui` also has `confirm` / `alert` / `prompt` / `progress` (`plugins/prompts.ts`, built on the
plugin dialog and panel — a promise settled from `mount`'s cleanup, since a dismissal presses no
button) and `el` / `widgets` (`plugins/widgets.ts`: plain DOM in the editor's own classes, so a
plugin's dialog looks like a built-in one). The widgets carry the waiting kit — `spinner`,
`progressBar`, `statusLine`, `skeleton`, `busy`, `button().setBusy`, and `DialogHandle.setBusy`
(a `BusyBox` beside the `TitleBox`, so the footer shows a ring and disables its buttons) — whose
styles are the Waiting block at the end of `styles/ui.css`; the reduced-motion rules are there,
so nothing animates in JavaScript. `ui.progress` stays what it was: a panel over the *map*, for
work that runs while the user carries on editing, which a modal dialog covers. All of it is additive — `PLUGIN_API_VERSION` stays 1 —
and a plugin repository picks the addition up with `npm update @scm-js/plugin-api`.
The 2026-09-05 pass moved every plugin onto the kit — each had been drawing its own ring,
bar, veil and skeleton with a scoped `@keyframes` and its own reduced-motion rule — and
two things the plugins needed came back into the contract: `statusLine.cancel(stop, label)`
takes the button's word (the AI assistant's is *Stop*, since Cancel in a dialog means leaving
it) and `statusLine.set` takes a `Node` in place of the text (a failure line that carries
a link to the settings that would fix it). scmscx.com is the worked example for the kit;
the scmjs.dev plugin's `Runner` (`ai/ui.ts` there) is a status line with an elapsed clock and a
reasoning fold around it. `base.css` gained `[hidden] { display: none !important }` in
the same pass: `.btn` is `inline-flex`, an author rule that beat the browser's own
`[hidden]`, so the status line's Cancel — and every plugin button hidden with
`el.hidden = true`, which is what plain DOM reaches for — stayed on screen after the
work ended. Nothing here tests the widgets' DOM: the test environment is node, and a
DOM test runner is a dependency the repository does not carry.
The 2026-09-07 assistant-transcript pass added `steps` and `fold` (the "Work, step by step"
block in `ui.css`): the scmjs.dev plugin had two hand-rolled step lists (Make Scenario's
build stages and the assistant's tool calls) and was about to grow a `<details>` with a live
summary line, an Undo button inside the summary (which needs `preventDefault` or the click
folds the block — `fold.action` carries that) and a tail window (`steps({ tail })` hides all
but the last rows while `running(true)`, in JS rather than `:nth-last-child`, so the number
is an option). The assistant's transcript is the worked example: a `fold` per turn holding a
`steps` list, notes between the rows for the model's words, and a second `fold` for its reasoning.

The beta pass added the rest of what the editor itself does to the contract — read `api.ts` and
`docs/plugins.md` for the list: `document.save` / `saveAs` / `close` / `changeTileset` (`export`
honours the remembered `SaveOptions`), `tx.replaceTerrain` / `fillArea` / `placeBlend` /
`tilesFromIsom` / `mirror` / `moveUnits` / `placeStartLocations` / `updateSprites` / `moveSprites` /
`updateDoodads` / `restoreAnywhere` / `invertFog` / `copyFog` / `floodFog`, `tx.strings.import`,
`tx.cuwp`, `settings.unitAvailable` / `cuwpSlots`, `query.fogAt` / `strings`
(`placement` answers null without a map), `terrain.floodRegion` / `blendCandidates` / `flatGroupOf` /
`symmetry` / `setSymmetry` / `mirror`, `selection.lockedLayers`, `api.clipboard` (`host.ts#clipboardApi`
over `editor/clipboard.ts`, sharing the user's clip), `api.exchange` (`.trg` and the strings text),
`palette.placementOptions` / `doodadPlacement` / `locationSnap` / `fogViewPlayer`, `ui.statusText` /
`toast` / `saveFile` / `ask`, and the `"options"` and `"file"` events. `ui.repaint` bumps
`viewportRepaintAtom` (no event) rather than the terrain revision; `EditResult` is computed after
`commitTerrainAtom` so stranded units and doodads count; a dialog's or panel's disposable leaves the
`Contributions` bag when it closes by itself. `npm run build:plugin-types` is
`scripts/build-plugin-types.mjs`: `dts-bundle-generator` over `src/plugins/api.ts` into a single
`plugin-api/index.d.ts` (128 KB, where the emitted tree was 61 files and 480 KB), a check that the
bundle carries no import at all — `jotai` and `react` above all, but a file the bundler missed is
wrong in the same way — and a `package.json` versioned with the *editor* beside it. Which is why
`EditorLayer` / `TerrainMode` / `ViewFlags` / `Toast` live in `editor/view.ts`, `Preferences` in
`editor/preferences.ts` and `DialogId` in `components/dialogs/ids.ts`, re-exported by the atoms.

`api.document.create(options)` is File ▸ New without React:
`useMapFileActions.ts#newMapInto` (the store-level half of the hook's `newMap`, which now calls it) behind the same
`guardedReplace` gate as `open` — a "new" `PendingAction` carries `done` / `taken` like an "open" one, and the Close
Scenario dialog's `proceed` sets `taken` for both. `NewMapOptions.startLocations` (the dialog's *Place
automatically*, on by default at four players) runs `placeStartLocations` over the scenario *before*
`loadDocumentAtom` installs it: they are part of making the map, so the document is still unmodified and
there is no history entry to undo them from. `tests/new-map.test.ts`. A menu path whose last segment names no submenu makes one for the
plugin (`withPluginItems`: `"Tools/AI"` → an AI submenu at the end of Tools, after a separator; `separator: true`
on an item draws one above it, never doubled); a missing *top* menu still falls back to Plugins. Smaller
conveniences the AI features asked for: `document.history()` peeks at both stacks' labels and depths,
`terrain.terrainAt(tx, ty)` answers a terrain id for any tile (flat group, else the ISOM diamond via
`isom.ts#isomTerrainAt`, which resolves a cliff row to a joined terrain through its soft links), and
`PlacementVerdict.reason` (`placement.ts#placementReason`, shared with the Units layer's status line) says the
problem in words.
