# Resize, validation, find, preferences, import/export, statistics, menus

### Resize, validation, find, preferences (`src/editor/resize.ts`, `validate.ts`, `find.ts`, `src/atoms/preferencesAtoms.ts`)

`validate.ts#umsIssues` is the scenario half of Check Map, run only when the map has a live
trigger (a map without triggers is melee): through `triggerRunsFor` (a trigger's 27 player
bytes resolved to slots 0–7 via All Players and the forces) it warns on a human player no
trigger gives Victory or Defeat and notes a missing Set Mission Objectives; `isHyperTrigger`
recognises the community's hyper triggers (preserved, unconditional, ≥ 8 Wait 0s that are
nearly all of the actions) and, when they are present, warns on any other preserved trigger
carrying a Wait, since that stalls the player's queue. `tests/validate.test.ts`.
`resizeScenario` is a transaction outside the undo model, applied through `resizeDocumentAtom`
(drops both stacks, bumps every revision, mirrors width/height into the display atoms). `dx` is
forced even so left/right tile pairs keep their columns; ISOM is `rebuildIsomFromTiles` when a
tileset is loaded, else the flat fill's lattice; objects outside the new bounds are dropped,
locations clamped, Anywhere reset. `validateScenario(scn, { extras, isom })` is pure and
revision-aware about required sections; `Issue.target` drives the dialog's go-to, and
`payload.only === "triggers"` is Triggers ▸ Validate Triggers. `editor/find.ts` is the pure search
behind Ctrl+F. `Preferences.multipleMaps` (on by default, Preferences ▸ General ▸ Open maps) is read by
`openTarget` in `useMapFileActions` only — see `viewport-ui.md` for the several-maps design. Persisted preferences and the grid look live in `atoms/preferencesAtoms.ts`
(`atomWithStorage`, `getOnInit` because startup hooks read through
`store.get`) and are applied once by `hooks/useApplyPreferences.ts` before the deep links;
`atoms/storage.ts` is the one `localStorage` accessor everything persisted shares (a memory
`Storage` when the browser has none — `storagePersists()` says which), knows that every key
the editor writes starts with `scmjs.` (`storedKeys` / `storedSize` / `clearStoredData`),
carries `mergedStorage(defaults)` — the `atomWithStorage` storage that merges a stored
settings *object* over its defaults, so a field added later still has one — and backs
Preferences ▸ Browser storage. `STORED_RESETS` in `preferencesAtoms.ts` is the table
mapping each stored key to the atom that owns it; `clearStoredKeysAtom` takes a list of
keys, `RESET`s the atoms among them (the default comes back *live*, which is the whole
point — the plugin host reloads the default set, the grid goes back to its look) and
sweeps the rest with `removeStoredKeys`, and `clearStoredDataAtom` is that over everything
(`ownedStoredKeys()` plus whatever is stored, so a plugin's keys and an older version's go
too). Keep `STORED_RESETS` complete: a key missing from it can only be removed, leaving
the value live until a reload — `tests/storage.test.ts` greps the source for every
`atomWithStorage("scmjs.…")` and fails when one is not in the table. The dialog's list
(`StorageSection` in `MiscDialogs.tsx`) is one row per key — a plugin's own keys grouped
per plugin — each opening onto the stored value and each with its own Clear button beside
the Clear all;
document-replacing actions (New / Open / Close / drop) go through `useMapFileActions().guard(PendingAction)`,
which parks the action in `confirmClose`'s payload while the map is modified. `tests/resize.test.ts`,
`tests/validate.test.ts`, `tests/find.test.ts`.

### Import / export, statistics, menus (`src/editor/exchange.ts`, `statistics.ts`, `dialogs/ExchangeDialogs.tsx`, `StatisticsDialog.tsx`)

`editor/exchange.ts` is the pure file-format layer behind File ▸ Import / Export: `.trg` is the raw
2400-byte TRIG records (SCMDraft-compatible, string indices are the map's own), text triggers go
through `formats/triggers/text.ts` with `triggerNames(scn)`, and strings are `index<TAB>text` with
`<XX>` control bytes (`applyStringImport` sets indices in place and appends past the end). Import
Triggers appends or replaces through `applyTriggers` / `applyBriefing` + `commitTriggersAtom`; Import
Strings and the String Editor re-sync `mapNameAtom` / `mapDescriptionAtom` after apply because the
chrome reads the mirror atoms. `editor/statistics.ts#mapStatistics` feeds Tools ▸ Statistics. Menu
items may carry a `payload` handed to `openDialogAtom` (Validate Triggers is `validateMap` with
`{ only: "triggers" }`); Edit ▸ Delete / Select All (`selectAllAtom`, also Ctrl+A) / Deselect act on the
active layer's selection like the Del / Esc keys; `useTerrainTools().fillMap` is Tools ▸ Fill Terrain
(whole map via `flatTerrain`, so the ISOM lattice is regenerated to match, one undo entry). Open Recent
(`recentFilesAtom`, persisted as `scmjs.recents`) reopens from the file handle kept in IndexedDB
(`services/handleStore.ts`, key `recent:<name>`; `pushRecentAtom` stores it on open and save,
`useMapFileActions.ts#openRecentInto` asks permission and opens through the unsaved-changes gate);
without a handle (Firefox, Safari) an entry is listed and reopens through File ▸ Open. There are no
menu stubs left: Tools ▸ Auto-place Start Locations is `editor/startLocations.ts` (`AutoStartsDialog`),
Test Map is `services/testMap.ts` (`TestMapDialog`, Ctrl+F5, the toolbar's Test) — the desktop's
`game` bridge writes into the game's `Maps\scmJS` folder and starts the executable, a browser writes
into a folder picked once (handle in IndexedDB) or downloads — and Replace Terrain is above. scmscx.com,
Repair, Walkability, Terrain from Image, Paint, TrigScript and scmjs.dev are default plugins, all on
but scmjs.dev (`src/plugins/defaults.ts`); Melee Wizard and Section Explorer are installed from
Browse Plugins.
`zoomToFitAtom` is View ▸ Zoom to Fit (Ctrl+Shift+0), `lockedLayersAtom` the Layers panel's padlocks
(the viewport's `onDown` refuses a locked layer's gestures), `cursorPixelAtom` the status bar's Px.
`gridSizeAtom`, `locationSnapAtom`, `placementOptionsAtom` (`scmjs.placement`),
`doodadPlacementAtom` (`scmjs.doodadPlacement`), `panelsAtom` and the dock widths are `atomWithStorage`
now — the two placement bags through `mergedStorage`, and every one of them listed in Preferences ▸
Browser storage, registered in `STORED_RESETS` and so clearable on its own or with the rest.
