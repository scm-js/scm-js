# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based StarCraft 1 / Brood War map editor (React 19 + Vite + TypeScript + Jotai), modelled on
StarEdit / SCMDraft 2. It opens real `.scm`/`.scx` maps (MPQ archives via `mopaq`), renders terrain from
the game's own tileset graphics, and writes playable archives back. `README.md` is the map-maker's
guide (what each layer does, and the table of what is and is not implemented) — read it first; the
technical companions are `docs/file-formats.md`, `docs/game-data.md`, `docs/trigger-script.md` and
`docs/development.md`. Keep all five current when behaviour changes.

## Commands

```sh
npm run dev            # Vite dev server, http://localhost:5173
npm run build          # tsc -b (type-check) + vite build
npm run lint           # oxlint
npm test               # vitest run (node environment, ~2s)
npm run test:watch
npx vitest run tests/chk.test.ts          # one file
npx vitest run -t "flood fill"            # tests matching a name
npm run extract        # StarDat/BrooDat.mpq → public/tileset, arr (incl. weapons/upgrades/techdata.dat), game, scripts, unit (BrooDat required)
npm run extract -- --from "/mnt/c/Program Files (x86)/StarCraft"    # or explicit .mpq paths
npm run check:assets   # what is on disk, no archives touched (predev/prebuild run this with --warn)
node scripts/extract-tilesets.mjs         # just the tilesets
node scripts/extract-units.mjs            # just the unit data
```

Tests live in `tests/*.test.ts` (and `src/**/*.test.ts` is also picked up). Tests that need
`fixtures/maps/*.scx` or `public/tileset/*.cv5` use `describe.skipIf(...)` and skip silently when the
files are absent — so a green run does not necessarily mean the real-map / real-tileset suites ran.
`fixtures/` is gitignored (Blizzard data, not redistributable), and so are the generated
`public/{tileset,arr,game,scripts,unit}/` — a clone has no game data until `npm run extract` runs, and
nothing in those trees may be committed. `scripts/extract-assets.mjs` is the front end (archive
discovery lives in `scripts/lib/archives.mjs`, `--check` reports what is on disk); re-run it after
changing what the two extractors take (the unit script's reachability walk decides which GRPs / `.lo`
files ship). The app degrades rather than crashing when the data is absent, so a green test run and a
working `npm run dev` do not prove the extraction still works — run it.

The `tsconfig.app.json` is strict-ish: `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`
(use `import type`), `erasableSyntaxOnly` (no enums / parameter properties). `npm run build` is the
type-check; `npm run lint` does not type-check.

Dev deep-links (`/?nosplash&layer=units&dialog=playerSettings&mode=tile&tileset=ice&zoom=0.5`) are
the fastest way to reach a specific UI state — see `docs/development.md` and `src/hooks/useDevDeepLinks.ts`.

## Architecture

### Two sources of truth, deliberately

- `scenarioAtom` (`src/atoms/documentAtoms.ts`) holds the parsed `Scenario` — the object that gets
  **written to disk**. It is **mutated in place** (terrain edits, `setScenarioName`, …), not replaced.
- The older UI atoms in `src/atoms/editorAtoms.ts` (`mapNameAtom`, `mapWidthAtom`, `mapTilesetAtom`, …)
  are what the chrome/panels **display**. `loadDocumentAtom` mirrors scenario fields into them on open;
  when you change something in the scenario, update the mirror atom too (and vice versa) or the UI and
  the file will disagree.
- Because the scenario is mutated in place, React does not see terrain changes. `terrainRevisionAtom`
  is a counter bumped after every edit/undo/load; `MapViewport` subscribes to it to repaint. Any new
  code that mutates `scenario.tiles` must bump it (usually via `commitEditAtom`).

### Map file fidelity model (`src/formats/chk/`)

- `reader.ts` parses the CHK container into `ChkFile` — **every** section in file order, repeats kept.
  `sections/registry.ts` declares each section's `CombineMode` (`last` / `overlay` / `append`) and fixed
  size; this mirrors how the game itself resolves duplicated sections (protected maps depend on it).
- `scenario.ts` decodes only the sections the editor models into typed fields on `Scenario`
  (`tiles`, `isom`, `units`, `locations`, `strings`, players, forces…). Section codecs live in
  `sections/{terrain,objects,players,strings}.ts`.
- `Scenario.dirty` is a `Set` of section names. On save, `serializeScenario` re-encodes **only** dirty
  sections (via `encodeSection`'s switch) and emits everything else byte for byte. New sections with no
  existing occurrence are inserted per `APPEND_ORDER`. Any mutation of scenario state must call
  `markDirty(scn, "NAME", ...)` for every section it affects, or the change is silently dropped on save.
- To model a new section: add a codec in `sections/`, decode it in `parseScenario`, add a case to
  `encodeSection`, and add a `tests/chk.test.ts` round-trip.
- `create.ts` builds a fresh scenario (File ▸ New) with every section the game requires: the three the
  editor never models — `IVE2`, `VCOD` (StarEdit's fixed verification table, embedded in
  `sections/vcod.ts`; both fixture maps carry it byte for byte) and the empty CUWP slots `UPRP`/`UPUS` —
  go into `chk.sections` as raw bytes (`rawCreatedSections`), everything else is marked dirty and
  encoded on save, with the settings tables (`unitSettings`, `upgradeSettings`, … `wavs`) non-null on
  their defaults and only the Brood War (`x`) layouts of the revision pairs written — Blizzard's own
  Brood War maps carry no UNIS/UPGS/TECS/UPGR/PTEC; a hybrid file is the one with both.
  `requiredSections(fileVersion)` there (common + original layouts below 205 + `x` layouts from 63) is
  what Check Map tests a file against.
  `scenario.isom` is `null` only when the *file* had no `ISOM`; `encodeSection` then omits the section
  rather than writing a zeroed one; the same holds for `mask`, `wavs` and the settings tables.
- `mpq/scm.ts` wraps `mopaq`: `.scm`/`.scx` → `staredit\scenario.chk`; bare `.chk` files are accepted.
  Non-scenario archive members are kept in `archiveExtrasAtom` and written back on save so custom
  sounds/graphics survive. `scenario.chk` is written uncompressed on purpose.

### Terrain editing (`src/editor/terrain.ts`, `src/hooks/useTerrainTools.ts`)

Edits are **invertible change lists** (`TileChange { at, before, after }`). Brush functions
(`stampTile`, `stampTerrain`, `floodRegion`, …) are pure: they compute changes without touching the
scenario. `applyChanges(scn, changes, "do" | "undo")` applies them and marks `MTXM` + `TILE` dirty.
`useTerrainTools` applies changes live during a drag (bumping the revision so the canvas repaints) and
calls `commitEditAtom` once on mouse-up so the whole stroke is one undo entry (200 levels). `ISOM` is
intentionally left untouched by the Rect/Tile brushes, matching SCMDraft's non-isometric modes.

Symmetry (`src/editor/symmetry.ts`, `symmetryAtom`): `mirrorRect` / `mirrorIndices` turn a brush
footprint or flood region into the set of cells including its images, and the Rect / Tile / Fog
brushes run their normal stamp over that set — so pairs still come from column parity and `Stroke`
needs no extra merging. Square-only modes (rot90, diag, adiag) act as `none` on non-square maps
(`symmetryAvailable`). `mirrorPixel` exists for object placement but nothing uses it yet; ISOM and
Blend are deliberately not covered. The viewport draws the axes; `tests/symmetry.test.ts`.

The Isometric brush lives in `src/editor/isom.ts` — a port of Chkdraft's reverse-engineering of StarEdit
(MIT). Read its header comment first. Key facts: the ISOM section is a lattice of diamonds whose values
index a per-tileset *shape-link table* built from the CV5 at load time (`isomTables`, cached per
`Tileset`), plus the copied-in terrain numbering/adjacency in `src/data/isomTables.ts` (an ISOM value is
**not** a CV5 index — `isomValueOf(era, index)` maps between them). `paintIsom` mutates `scn.tiles`
*and* `scn.isom` and returns `{ tiles, isom }` change lists; `HistoryEntry.isom` carries the second list
through undo/redo (`applyIsomChanges`). `hasIsom(scn)` gates the brush: a map without `ISOM` gets a
notice and **Rebuild ISOM from tiles** (`rebuildIsomFromTiles`, `useIsomRebuild`), which is also the
`createdIsom` history case. `checkIsom` measures ISOM/tile agreement (`useIsomStatus`, computed on
load, not per stroke). `tests/isom.test.ts` validates all of this against the fixture maps; keep those
tests green when touching the CV5 decoder (`edges`, `stack`) or the tables.

Terrain-type ids in the palette are CV5 group indices of flat tile pairs (the same ids `ISOM` stores).
Rect mode paints in left/right pairs following map column parity, sharing one random variation per
pair — the tests in `tests/terrain-edit.test.ts` pin this behaviour.

The Blend brush (`src/editor/blend.ts`) is pixel-based: `edgeTable` lifts every megatile's four
outermost pixel strips straight from the VR4 (cached per `Tileset` in a WeakMap, ~40 ms once), and
`blendCandidates(tileset, anchorId, side)` ranks `drawableTiles` (one id per megatile) by
`edgeDistance` between the anchor's side and the candidate's *opposite* side — mean |ΔRGB| over the
32 pixels, 0..255; designed L/R pairs measure 0.2–8, so `DEFAULT_BLEND_OPTIONS.maxDistance` is 16.
The mode does not stroke: `paintsTiles("blend")` is false, a click on the map is `pickAt` setting
`blendAnchorAtom` (map coordinates, read back through `scenarioAtom` + `terrainRevisionAtom` so the
listed tile follows undo), and the palette's `tools.blendAt(side, id)` is the only writer —
`placeBlend` on the neighbour cell, committed through `commitTerrain`, then the anchor moves onto it
when `blendFollowAtom` is set. `tests/blend.test.ts` pins the edge extraction (including the minitile
flip bit), ranking and placement against a synthetic tileset and the designed seams of the real ones.

### Sprites (`src/editor/sprites.ts`, `src/hooks/useSpriteTools.ts`, `src/data/sprites.ts`)

`scenario.sprites` is the `THG2` list. `SpriteChange { index, before, after }` lists (insert / remove /
replace, removals highest index first) are carried in `HistoryEntry.sprites` — the same slot a doodad's
overlay sprite uses — and applied by `applySpriteChanges` (marks `THG2` dirty). `applyList` there is the
generic in-place list applier the doodad codec shares; `editor/doodads.ts` re-exports the sprite pieces.
`spriteKind(r)` reads `SpriteFlag.PureSprite`: a *pure* sprite's `spriteId` is a sprites.dat id, a *unit*
sprite's a units.dat id. `makeSprite` writes StarEdit's flags (pure → `0x1000` only; unit → 0, plus
`Disabled`); doodad overlays are the exception (`makeOverlaySprite`, whole CV5 flag word). Hit-testing
(`spriteAt`, `spritesInBox`) takes a `sizeOf` callback — the hook reads the loaded GRP's frame box via
`requestGrp`, tests pass a constant. Repaints go through `doodadsRevisionAtom` (it already covered
`scenario.sprites`); `selectedSpritesAtom` is cleared by any entry with `sprites`. Names come from
`spriteCatalogue(assets)` — the unit whose flingy uses the sprite, else the GRP file name, grouped by
`thingy\tileset\<ts>` path — there is no sprite name table in the game data. `scripts/extract-units.mjs`
seeds the GRP walk from all 517 sprites.dat images so pure sprites (and doodad overlays) can be drawn.
`tests/sprite-edit.test.ts` pins the flags, ordering and the THG2 round trip.

### Locations (`src/editor/locations.ts`, `src/hooks/useLocationTools.ts`)

`scenario.locations` is the `MRGN` table — fixed slots (64 original / 255 BW, `locationCapacity`),
never inserted into or removed from — so `LocationChange { index, before, after }` is always a
replacement and `selectedLocationsAtom` (slot indices) survives edits; `afterUnitEdit` only prunes
slots that stopped being `isLocationUsed`. A change may carry a `string` (`LocationStringChange`)
when a name had to be appended to the string table (`nameString` reuses an identical string first,
like StarEdit); `applyLocationChanges` pops it again on undo and marks `MRGN` + `STR`/`STRx`.
`locationsRevisionAtom` is the repaint trigger and `locationsAtom` (the drawable list, Anywhere
excluded, normalised px bounds) derives from it. **Slot 63 is Anywhere** and is protected
everywhere: `editable()` filters it out of every builder, `locationAt` never picks it, the
viewport draws no box or handles for it, and the only writer is `restoreAnywhere` (also folded
into `addLocation` when the slot is unused). `ensureLocationSlots` grows a short table to
capacity outside the undo model (blank slots mean nothing). Elevation bits are *inverted* (set =
excluded; `Elevation`/`ELEVATIONS` in `sections/objects.ts`). The hook applies moves/resizes live
during a drag (`beginMove`/`beginResize` → `dragTo` → `endDrag` commits one entry); snapping is
`locationSnapAtom` (0 = off) and a move snaps the first box's corner, not the pointer.
`dragBounds` turns a create-drag into the grid cells it touched. `tests/location-edit.test.ts`
pins all of this, including against the fixture maps.

### Fog of war (`src/editor/fog.ts`, `src/hooks/useFogTools.ts`, `src/components/viewport/fog.ts`)

`scenario.mask` is the `MASK` section (one byte per tile, bit n = player n+1 starts *unexplored*),
`null` when the file had none — which the game and the editor both read as fog everywhere. Edits
are `TileChange` lists over the mask bytes (`paintFog`, `fillFog`, `invertFog`, `copyFog`,
`floodFog`), carried in `HistoryEntry.fog` and applied by `applyFogChanges` (marks `MASK` dirty).
`ensureMask` creates the 0xFF section on the first edit and the entry records it as `createdMask`
so undo sets the mask back to `null` (`encodeSection` then omits the section, like ISOM). The
brush paints the bit mask in `fogPlayersAtom` in `fogModeAtom` ("fog" / "clear"; Shift inverts a
stroke), reuses `brushSizeAtom` / `brushRect` and `Stroke`, and repaints through
`terrainRevisionAtom`. `drawFogOverlay` draws the *viewed* player's (`fogViewPlayerAtom`) fogged tiles last
in `MapViewport` — over units and locations — as a `multiply` fill of `FOG_TINT[tileset]` (the
per-channel mean of the game's `dark.pcx` row 18, the remap it uses for explored-but-unseen
ground; ~52% luminance, Ice ~66%) with 45° chamfers where two explored tiles meet a fogged corner;
explored tiles are untouched. It shows while `viewFlags.fog` is on; the viewport turns that flag
on when the fog layer is entered and back off on leaving if it was the one that set it.
`fogImageData` gives the minimap the same picture (also drawn with `multiply`).
`tests/fog-edit.test.ts` pins the bit semantics and the MASK round trip.

### Cut / Copy / Paste (`src/editor/clipboard.ts`, `src/hooks/useClipboardTools.ts`, `src/editor/history.ts`)

`editor/history.ts` now owns `HistoryEdit` / `HistoryEntry` and `applyEntry` (the fixed list
order: terrain `changes`, `isom`, `doodadTiles`, `doodads`, `sprites`, `units`, `locations`,
`fog`; reversed on undo) — `documentAtoms` re-exports the type. A `Clip` is self-contained
(size, `era`, MTXM `tiles` *and* TILE `ground`, records with origin-relative pixel positions,
`ClipLocation`s with names, MASK bytes) so it outlives the map it came from. `copyRegion` takes
a tile `Rect` (`regionObjects`: units/sprites by centre, doodads/locations wholly inside,
overlay sprites belong to their doodad), `copyObjects` an `ObjectSelection` (bounding box, those
objects only, never terrain/fog). `pasteClip` and `removeObjects` **apply as they build**, list
by list in `applyEntry` order, so every list is computed against the state the previous one
leaves — this is what makes replace-mode pastes and doodad removals undo/redo cleanly; do not
reorder the steps. Terrain pastes `ground` into both sections and, when doodads are included,
the MTXM picture as `doodadTiles`; `strandedByPaste` decides from the *final* picture which
existing doodads lose a tile (so a self-paste is a no-op), `mode: "replace"` also clears the
area's units/sprites/doodads (locations never). Units get fresh serials and `relatedSerial`
is remapped or dropped; locations go through `addLocation` (free slots, `ensureLocationSlots`
first); a different `era` refuses terrain + doodads but pastes the rest; everything off the
map is skipped with a `notes` entry. ISOM is untouched. Atoms: `clipboardAtom` (kept across
documents), `clipSelectionAtom` (the marked `Rect`, cleared on load/close/resize),
`clipPartsAtom`, `clipPasteModeAtom`, `clipPastingAtom`. The hook's `source()` is layer-aware
(marked area on the clipboard/terrain/fog layers, the selection on object layers); `paste()`
arms the clipboard layer and the viewport's `onDown` calls `pasteAt(tile)` while armed.
`tests/clipboard-edit.test.ts` pins the region rules, both tile layers, serial remapping,
replace/merge, stranding, edge clipping, the full undo/redo round trip and a fixture-map copy
into a blank map.

### Scenario settings (`src/editor/settings.ts`, `src/formats/chk/sections/{players,settings}.ts`)

The Map Revision, Player Settings, Force Settings, Player Colors and Unit Settings dialogs edit the
scenario directly and are **not** in the undo model — each dialog is its own OK / Apply / Cancel
transaction, as in StarEdit. They read a working copy through `useScenarioForm(scenario, read)`
(re-read whenever the scenario *object* changes, so a `?dialog=` deep link that opens before the
startup map exists fills in, and a dialog left open across File ▸ Open does not write stale values),
write back through the `apply*` functions in `editor/settings.ts` (which `markDirty` only what
changed), and end with `commitSettingsAtom` — it sets modified, bumps `settingsRevisionAtom` (what the
dialogs and Map Properties subscribe to) and the units/doodads revisions, since colours reach every
drawn sprite. Strings the dialogs need (force names, custom unit names) go through `internString`:
an identical entry is reused, otherwise one is appended — never overwritten, because the old index
may be shared with a trigger.

Sections: OWNR is always written together with IOWN (StarEdit's copy); `playerRgb` is CRGB
(Remastered: an RGB triple and a `ColorMode` per playable slot; `null` = no section, and Player
Colors drops it again when every slot is back on `Palette`) — `displayColorHex` is the colour a slot shows
anywhere in the chrome and `playerTeamColor` what its sprites are painted with (`TeamColorSpec`: a `tunit.pcx`
row for the sixteen classic colours, else an RGB — Pink … Black and any CRGB custom colour — for which
`teamColor.ts` synthesises a ramp and `sprites.ts` draws through a palette copy with slots 8–15 overridden,
since the tileset palettes have no pink to remap to; `tests/team-color.test.ts`). `unitSettings` is
one model for UNIS (100 weapons) and UNIx (130), read from UNIx when both exist; `unitSettingsSections`
decides which to write (the file's revision plus whichever it already carries, so a hybrid map keeps
both). `unitAvailability` is PUNI, player-major (`puniIndex`). Both are `null` when the file has no
section (a new map has them). The upgrade and technology tables follow the same pattern:
`upgradeSettings` is UPGS (46 upgrades) / UPGx (61, plus one pad byte after the use-default column),
`upgradeRestrictions` UPGR / PUPx (player-major max / start levels over a global default pair,
`upgradeIndex`, `upgradeLevels`; `DEFAULT_UPGRADE_MAX` is upgrades.dat's `maxRepeats`, what StarEdit
writes for a fresh map), `techSettings` TECS (24 techs) / TECx (44), `techRestrictions` PTEC / PTEx
(`techIndex`, `techState`). The model is always the Brood War width and the original-layout encoders
trim it (`decode*` re-strides the per-player tables). `revisionSections` in `scenario.ts` chooses
which of a pair to write — the revision's plus whichever the file (or its dirty set) already has —
through `unitSettingsSections`, `upgradeSettingsSections`, `upgradeRestrictionSections`,
`techSettingsSections`, `techRestrictionSections`. `wavs` is the WAV table (`sections/sounds.ts`,
512 string indices of `staredit\wav\…` paths; the files themselves are archive extras). Defaults
for the dialogs come from `assets.upgrades` / `assets.techs` (`upgrades.dat`, `techdata.dat` — decoded
in `dat.ts`, optional like `weapons.dat`). `tests/data-settings.test.ts` pins the codecs, the
re-striding, the new-map section set and byte-for-byte re-encoding of the fixture maps. `setMapVersion` rewrites VER/TYPE and flips `strings.extended` (STR ↔ STRx: both names go
dirty and the inapplicable one encodes to `null`, which `serializeScenario` treats as "drop").
Upgrade / Technology Settings (`DataDialogs.tsx`) share `CatalogueList` (a race-grouped id list) and
follow Unit Settings exactly: `useScenarioForm(read*Settings)`, in-place typed-array edits plus a
`bump`, `apply*Settings(clone…)`, `commitSettingsAtom`; the per-player rows show the effective value
through `upgradeLevels` / `techState` while on Default.
Unit Settings shows dat defaults for a type on "use default" and seeds its row from them when the
tick comes off; `units.dat` now also yields `buildTime`, `armor`, `groundWeapon`/`airWeapon`
(a turreted vehicle's weapons live on its subunit) and `weapons.dat` ships as `assets.weapons`
(optional — an older extraction shows weapon defaults as 0). `tests/settings.test.ts` pins the codecs,
the section choice per revision and byte-for-byte re-encoding against the fixture maps.

### Resize, validation, find, preferences (`src/editor/resize.ts`, `validate.ts`, `find.ts`, `src/atoms/preferencesAtoms.ts`)

`resizeScenario` is a transaction outside the undo model, applied through `resizeDocumentAtom`
(drops both stacks, bumps every revision, mirrors width/height into the display atoms). `dx` is
forced even so left/right tile pairs keep their columns; ISOM is `rebuildIsomFromTiles` when a
tileset is loaded, else the flat fill's lattice; objects outside the new bounds are dropped,
locations clamped, Anywhere reset. `validateScenario(scn, { extras, isom })` is pure and
revision-aware about required sections; `Issue.target` drives the dialog's go-to, and
`payload.only === "triggers"` is Triggers ▸ Validate Triggers. `editor/find.ts` is the pure search
behind Ctrl+F. Persisted preferences and the grid look live in `atoms/preferencesAtoms.ts`
(`atomWithStorage` with a memory fallback, `getOnInit` because startup hooks read through
`store.get`) and are applied once by `hooks/useApplyPreferences.ts` before the deep links;
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
`{ only: "triggers" }`); Edit ▸ Delete / Select All / Deselect act on the active layer's selection like
the Del / Esc keys; `useTerrainTools().fillMap` is Tools ▸ Fill Terrain (whole map via `flatTerrain`, so
the ISOM lattice is regenerated to match, one undo entry). Open Recent lists names only — browsers hand
over file contents, not handles. Replace Terrain, Auto-place Start Locations
and Test Map are still `stub()` entries in `MenuBar.tsx`; Terrain from Image (on) and Paint (off until ticked) are default plugins (`src/plugins/defaults.ts`).

### Strings, sounds, switches (`src/editor/strings.ts`, `sounds.ts`, `switches.ts`)

`stringUsages(scn)` maps every string index to the records that reference it (SPRP, FORC, MRGN,
UNIS/UNIx names, SWNM, WAV, every TRIG/MBRF action's `text` and `wav`); the String Editor edits a
working copy of the table and `applyStrings` writes it back **without renumbering** — it trims only
unreferenced trailing blanks and keeps a blank slot something still points at. `escapeControls` /
`unescapeControls` show bytes below 0x20 as `<XX>` (tab, LF, CR stay literal). `editor/sounds.ts`
joins `scn.wavs` with `archiveExtrasAtom` (`soundList`, `orphanSounds`, member names normalised for
case and slashes); the Sound Editor's working copy carries both the table and a new extras `Map`, and
apply replaces the atom, so an imported file only reaches the archive on OK / Apply.
`editor/switches.ts` edits SWNM (`applySwitchNames` creates the section on the first name and interns
names; `switchUsage` counts Switch conditions and Set Switch actions). `tests/strings.test.ts` and
`tests/sounds.test.ts` pin the usage map, the escape round trip and the WAV / extras join.

### Triggers (`src/formats/chk/sections/triggers.ts`, `src/data/triggerDefs.ts`, `src/formats/triggers/text.ts`, `src/editor/triggers.ts`)

`scenario.triggers` is TRIG and `scenario.briefing` MBRF — the same 2400-byte record (16 × 20-byte
conditions, 64 × 32-byte actions, flags, 27 player-group bytes, the game's current-action byte),
differing only in what the type bytes mean. Records stay close to the bytes: every field is a
number and `triggerDefs.ts` says which field holds which argument for each type (`ArgDef { kind,
field, label }`, argument order = SCMDraft's TrigEdit). Everything that shows a trigger — the Classic
editor's widgets, the text printer/parser, later the script API's typings — reads that table; the
codec knows no types. Decoding drops only *trailing* empty condition/action slots, so anything after
a type-0 entry survives; encoding pads back to 16/64. `switchNames` is SWNM (null when absent).

The text format (`formats/triggers/text.ts`) resolves names through a `TriggerNames` context
(`triggerNames(scn)` in `editor/triggers.ts`) so it is testable without a scenario; unknown names
print as bare numbers and parse back, unknown types print as `Condition N(...)` / `Action N(...)`.
The one thing text cannot carry is the `UnitTypeUsed` hint bit (0x10) — Blizzard's own maps disagree
about it — so `tests/trigger.test.ts` masks the hint bits in its fixture round trip. `intern` appends
to the string table while parsing (never removed, so harmless). Trigger dialogs are settings-style
transactions: `useScenarioForm(scenario, readTriggers)` → `applyTriggers` (marks `TRIG` only on a
real change) → `commitTriggersAtom` (`triggersRevisionAtom`); nothing is in the undo model.
`newCondition` / `newAction` seed StarEdit-like defaults.

### Trigger script (`src/script/`, `src/editor/script.ts`, `dialogs/ScriptEditorDialog.tsx`)

A TypeScript-subset language that *generates* a block of `scenario.triggers`, at two levels: raw
`trigger(players, conditions, actions, flags?)` calls (1:1 with records) and *structured* code —
every other top-level statement — lowered to a death-counter state machine (no EUD, runs on every
game version; the EUD-address route was dropped because trigger nodes are heap-allocated by the
game and their addresses unknowable at save time).

- `names.ts` turns the scenario into five `NameTable`s (players, units, locations, switches, AI
  scripts); each entry's keys are an identifier derived from the display name first (`identifier()`:
  `Terran Marine` → `TerranMarine`), the display name itself second (`Units["Terran Marine"]`), then
  custom names — unique per table by construction. `declarations.ts` generates the `.d.ts` from them
  plus a fixed runtime; it is **`noLib`** (the runtime declares the dozen global types TS insists on and
  nothing else — no `Math`, no `Array.prototype`), values are *branded literal types*
  (`UnitId<0> = 0 & Brand<"unit">`; plain numbers still pass, a `LocationId` where a `UnitId` belongs
  does not), enumerated kinds are string unions of the `CHOICES` labels and aliases, and every
  condition/action is a `declare function` whose identifier is its `ConditionType`/`ActionType` key
  (`api.ts`; parameter names come from the def labels, reserved words get a trailing underscore).
  `program(options)`, `random()`, `Memory` / `SetMemory` (Deaths at player `EPD(addr)`,
  `DEATHS_TABLE_ADDRESS`) are declared there too.
- `compiler.ts` builds a real `ts.createProgram` (declarations + script, in-memory host) and walks
  the script's AST; it takes the `typescript` namespace as an argument so `tests/script.test.ts`
  (Node) and `compile.worker.ts` (bundled) share it. Every argument is evaluated by asking the checker
  for the expression's literal type (`literalOf`, intersections included), else folding arithmetic /
  template strings, else following a `const` initialiser — `value()`. `value()` consults the
  structured `Scope` first (a `let` is never a constant, whatever the checker narrowed it to; a
  function parameter bound to a constant is one) and `initializer()` follows **const** declarations
  only. Arrays flatten spreads and follow consts (`list()`); `disabled(x)` sets the Disabled flag;
  `Condition(type, …)` / `Action(type, …)` are the raw escape hatch. Diagnostics from the *whole*
  program are reported; the compiler's own carry `source: "compiler"`. Strings are **not** interned
  in the compiler: text/wav fields hold local ids into `CompileResult.strings` and
  `editor/script.ts#resolveStrings` interns them at build time. `CompileOptions.reservedDeaths` /
  `reservedSwitches` (from `editor/script.ts#reservedStorage`: what the hand triggers outside the block
  and the switch names use) keep variables off storage the map already uses. `CompileResult.variables`
  and `.program` describe the allocation for the UI.
- `run()` sorts top-level statements: `const` / `trigger()` / `program()` / function declarations /
  everything else (the program, in order). Raw triggers come first in the output, then the program's,
  then hyper triggers (`lower.ts#hyperTriggers`, three preserved triggers of 63 `Wait(0)`).
- `lower.ts` is the machine and knows no TypeScript. Read its header: a basic block is a run of
  preserved triggers testing `pc == S` in list order (so straight-line code runs within one cycle and a
  back edge costs one); `[S, C] → THEN` followed by `[S] → ELSE` is negation by ordering. `Allocator`
  hands out death counters player-major over `VARIABLE_UNITS` (the "(Unused)" units, Cantina first) and
  switches from 255 down. `Machine` queues actions (`action`), writes steps (`step` / `raw`, always
  prefixed with the pc condition and a `Comment` label when `comments` is on), ends states (`jump`,
  `next`, `loopHeader` — which reuses an empty current state), and does arithmetic: `addConst` is one
  action, `addVar` the 32+32-step binary decomposition through a temp (`move` is the destructive
  32-step half), `assign` handles `c + Σ±v` (constants first, adds before subtracts so saturation only
  bites when the true result is negative, via a temp when `x` appears in its own RHS other than as the
  leading `+x`), `compareVars` builds saturating differences into temps that the caller releases after
  the branch (`tempsHeld` / `releaseTo`). `Bool` trees go through `toDnf` (negation to the leaves,
  `negateCondition` flips comparisons around their amount; a leaf the game cannot negate becomes a
  *negative literal*) and `branch` emits one trigger per product, skip steps for negative literals,
  and a fallthrough to ELSE; it asserts a branch never targets the state it is tested in (which is why
  `do … while` gets a check state of its own). State 0 is the entry (every counter is 0 at game start),
  `halt` is 0xFFFFFFFF.
- `structured.ts` walks the statements: `let` → `dc` (number-like type) or `switch` (boolean-like),
  bound in a `Scope` keyed by declaration node (so shadowing and inlining resolve as the checker does);
  `linear()` reduces numeric expressions to `c + Σ±v`; `bool()` builds `Bool` trees (comparisons with a
  constant are one Deaths condition; between variables they cancel common terms then go through
  `compareVars`; `random()` randomizes a scratch switch first); functions are inlined per call with
  parameters bound to constants or by-reference variables, `return` jumping to a lazily created end
  state; `dead` tracks unreachable code after `break` / `continue` / `return` / an endless loop so
  the final `halt` jump is only emitted when the program can reach it. TypeScript's literal narrowing
  on `let` booleans (`f = true; if (f == g)` → "no overlap") is a real type error, not a compiler bug.
- `simulate.ts` is the trigger-cycle interpreter (Deaths / Switch / Always / Never built in, other
  conditions via callback, non-modelled actions logged as events, preserve semantics, add wraps and
  subtract saturates like the game). `tests/script-structured.test.ts` compiles programs and asserts
  the simulation; the dialog's **Simulate** button runs the same thing for 30 cycles.
- `print.ts` is the inverse (eject) for raw records; a generated program prints as raw
  `trigger()` calls (structured source cannot be recovered). `tests/script.test.ts` pins
  print → compile → identical records on the fixture maps (hint bits masked, compared through the text
  format so duplicate string-table entries do not matter).
- `editor/script.ts`: the source and a manifest are archive members (`SCRIPT_MEMBER`,
  `MANIFEST_MEMBER` in `archiveExtrasAtom`, so they save with the `.scx`). The manifest records
  `start`, `count`, a hash of the encoded block (`hashTriggers`) and per-trigger source lines;
  `findBlock` looks at `start` first and then anywhere in the list, so a hand trigger inserted before
  the block moves it (`commitTriggersAtom` calls `relocateScriptBlock`), while an edit *inside* it makes
  the block stale (`scriptState().stale`) and `buildScript` appends a fresh one. `sourceHash` gives
  `unbuilt`. `buildScript(..., { takeOver })` replaces the whole list — the "Import map triggers"
  path, after `printScript` of the hand triggers around the block. `scriptStateAtom` derives all of
  this; the Classic editor takes the manifest and re-finds the block in its *working copy* (indices
  drift under local inserts), badges those rows `script`, locks their editing and offers
  "Open Script Editor" with `payload.line`. Generated program triggers show their `Comment` (`L18:
  cycles++`) as the row title.
- `monaco.ts` is only ever `import()`ed (by the dialog): Monaco 0.56's tree-shaken entry points
  (`monaco-editor/editor/editor.api`, `features/register.all`, only the TypeScript language), the two
  workers via Vite `?worker`, `typescriptDefaults` set `noLib` with the generated file as the one extra
  lib, and a theme from `tokens.css`. `compileClient.ts` talks to `compile.worker.ts` (latest request
  wins, `CompileSuperseded` for the rest; falls back to the main thread if the worker cannot start;
  `CompileOptions` ride along). `typescript` is therefore a runtime dependency (bundled into the worker,
  ~3.5 MB; Monaco's own TS worker is another copy — running the compiler inside Monaco's worker via
  `customWorkerPath` needs a classic script, which Vite's dev server cannot serve, so two copies it is).
  The dialog writes the source into the extras on every change (debounced check, 350 ms) and holds the
  Monaco host in `useState`, not a ref (Radix portal timing, as in `ExportImageDialog`);
  `DialogFrame.onEscapeKeyDown` exists so Escape inside the editor dismisses Monaco's popups instead of
  closing the dialog.

### Plugins (`src/plugins/`, `src/atoms/pluginAtoms.ts`, `plugins/*/`)

`docs/plugins.md` is the author's guide and API tour; keep it in step with `src/plugins/api.ts`,
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

`loader.ts` is pure apart from `LoaderDeps` (fetch, transpile, module URL, import, built-ins):
`parseSpec` (`builtin:`, `github:owner/repo[@ref][/dir]`, github.com URLs, any URL to a `plugin.json`
/ entry file / directory) → `resolvePlugin` (manifest, entry) → `bundleModule` (fetch **as text** —
raw.githubusercontent serves `text/plain`, which `import()` refuses — transpile `.ts` in the compile
worker via `compileClient#transpileInBackground` / `plugins/transpile.ts`, follow relative imports
depth first, refuse bare package names and cycles, rewrite specifiers to `blob:` URLs) → `import()`.
`candidateUrls` is the resolver a `fetch` does not come with: an extensionless specifier is tried as
`.ts`/`.tsx`/`.mts`/`.js`/`.mjs` and then `index.*`, and `./x.js` falls back to `./x.ts` — the
bundled built-in never needed this because Vite resolved for it, and the first remote load of
Terrain from Image 404ed on `./convert`.
`builtin.ts` (`import.meta.glob` over `plugins/*/plugin.{ts,json}`) is the same `activate(api)` path
minus the fetch, for a plugin bundled into the build — **nothing ships that way**: there is no
`plugins/` directory, the globs are empty and the mechanism is kept only for a fork that wants one.
A manifest `icon` — an emoji, a `data:`/`https:` image, or an image file beside
the manifest — becomes a `PluginIcon` in `loader.ts#resolveIcon` (anything else, `javascript:` above
all, resolves to null and the plugin keeps the default mark); a built-in's file URL comes from a second
`import.meta.glob` in `builtin.ts` because Vite hashes (and here inlines) the asset. It rides on the
runtime and on `PluginInfo`, and `PluginIconView` draws it in the Manage Plugins list and as the title
icon of every dialog the plugin opens. `installedPluginsAtom` persists `{ spec, enabled }`;
`defaults.ts` holds the plugins a fresh editor starts with (`DEFAULT_REMOTE_PLUGINS` —
`github:scm-js/plugin-image-to-terrain` on, `github:scm-js/plugin-paint` off — plus any built-in, each a
`DefaultPlugin { spec, enabled }`), which `effectiveInstalls` merges over
the stored list, so a default is always listed, starts as its entry says unless the stored list says
otherwise, can be turned on or off but not removed, and is otherwise
an ordinary spec fetched over the network on every start; the Manage Plugins row badges it `default`
and hides its Remove button (`add` canonicalises what the user pastes through `parseSpec(...).display`,
so pasting the default's own github.com URL is recognised as it rather than duplicating it).
`pluginRuntimesAtom` is status/manifest/error per
spec; `usePlugins` (in `App`) keeps the two in step, idempotently per spec. Contribution registries
`pluginMenuItemsAtom` / `pluginContextItemsAtom` / `pluginHotkeysAtom` are read by `MenuBar`
(`withPluginItems`, path `"File/Import"` → that submenu after a separator; a `Plugins` menu holds
Manage Plugins…), `MapViewport` and `TerrainPalette` (`plugins/contextMenu.ts#pluginContextRows`,
surfaces `viewport` / `terrainPalette`, the palette got a Radix ContextMenu of its own for this) and
`useHotkeys` (plugin combos first, never while typing). `PluginDialogs.tsx`: Manage Plugins, and
`PluginDialog` — the `DialogFrame` a plugin's `ui.dialog(spec)` mounts plain DOM into (host element
in state, Radix portal timing). `npm run build:plugin-types` emits `plugin-api/` (gitignored) for
external repos. There is no sandbox: a plugin runs with the page's privileges, and the dialog says so.

`api.ui.pickArea` / `pickTile` (`host.ts#pickOnMap`) put one `MapPickRequest` in `mapPickAtom`
(`pluginAtoms.ts`); `MapViewport` serves it ahead of every layer (crosshair, teal marquee, HUD chip
with the prompt) and calls its `finish` on mouse-up; `finish` clears the atom and is guarded so the
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
`disabled`). `api.ui.panel` is a floating, non-modal frame over the map (`pluginPanelsAtom`,
`components/panels/PluginPanels.tsx` rendered inside the viewport: draggable title strip,
positions kept per plugin + title for the session, opens top-right) — hotkeys keep working since
it is not in the dialog stack. `api.palette` reads and sets the object palettes' picks
(`activeUnitAtom`, `unitOwnerAtom`, the sprite and doodad atoms, `fogPlayersAtom` / `fogModeAtom`)
and answers names, groups, `unitSize` (placement box) and `doodadInfo`; the `"palette"` event
covers those atoms plus the terrain brush. `tx.placeUnit` snaps through `snapPlacement` with the
palette's snap option, `tx.canPlaceUnit` is `checkPlacement` with `placementOptionsAtom`,
`tx.placeSprite` is make + add + `clampSprite`.

**Terrain from Image** is the first worked example and lives in its own repository,
`github.com/scm-js/plugin-image-to-terrain` (`plugin.json` / `plugin.ts` / `convert.ts` /
`icon.svg`, a vendored `plugin-api/` so it type-checks alone, and `tests/convert.test.ts` under its
own vitest). It used to be `plugins/terrain-from-image/` here; it was moved out precisely so the
plugin the editor ships is loaded by the ordinary path, and its internals are documented there and
in `docs/plugins.md`. Changing `src/plugins/api.ts` means re-running `npm run build:plugin-types`
and refreshing that repository's `plugin-api/`. `tests/plugins.test.ts` covers the host side
(loader, host, transactions, lifecycle, menu merge, context rows, picks, transfers, the defaults
list, map tools, panels, the palette API, placement, and the real-tileset suite via
`primeTileset`).

**Paint** (`github.com/scm-js/plugin-paint`, the second default, listed but not enabled) is the worked example for
`ui.mapTool`, `ui.panel` and `api.palette`: `plugin.ts` is the panel, the per-tool gestures and
the transaction, `shapes.ts` / `font.ts` the pure geometry with `tests/shapes.test.ts`. Its brush
is the active layer's palette pick, so it paints on the Terrain (flat pairs or the Tile brush's
tile), Doodads, Units, Sprites and Fog of War layers alike. `docs/plugins.md` ends with a tour of
both plugins.

### Tileset graphics (`src/formats/tileset/`)

`load.ts` fetches `public/tileset/<name>.{cv5,vx4,vf4,vr4,wpe}` on demand and caches per tileset
(`getTileset` / `peekTileset` / `ensureTileset`); `decode.ts` parses them; `atlas.ts` rasterises one
megatile atlas (canvas ImageData) that the viewport blits from; `terrain.ts` derives the terrain-type
catalogue and variations from the CV5; `palette.ts` holds names (from Chkdraft's tables — verified
against real files in `tests/palette.test.ts`). `cycle.ts` is palette colour cycling — StarCraft
animates water/lava by rotating short bands of the WPE palette (tables from Chkdraft's `color_cycler.h`,
per tileset in ERA order), so the atlas keeps a second small canvas of just the cycling megatiles
(`atlas.animation`) and `setAtlasStep` re-rasterises it; always blit via `atlasSource(atlas, megatile)`,
never index `atlas.image` directly. `MapViewport` drives the step from the wall clock in a rAF loop
gated on `viewFlags.animateWater`. Averages (minimap, far zoom) stay at step 0. `src/hooks/useTileset.ts` exposes `{ loaded, loading, error }`;
when files are missing (`TilesetMissingError`) the viewport falls back to flat per-tileset colours
and says so.

### Units (`src/formats/dat/`, `src/formats/units/`, `src/editor/units.ts`, `src/hooks/useUnitTools.ts`)

`dat.ts` decodes only the fields the editor needs from the Brood War `arr\*.dat` layout (struct of
arrays; placement box / add-on offset / extents are arrays of structs — the layout is pinned by
`tests/dat.test.ts` against the real file). `units/load.ts` fetches the tables once (`getUnitAssets` /
`peekUnitAssets`) and GRPs lazily (`requestGrp`, `onGrpLoaded` fires so canvases repaint);
`units/sprites.ts` caches one canvas per (image, frame, colour row, tileset palette). Team colour =
`tunit.pcx` row `playerColorIndex(scn.playerColors, owner)` (COLR-aware) remapping palette indices
8–15, painted through the *tileset* palette — so sprites need the tileset loaded too. `unitName(id)` and
`UNIT_GROUPS` (ids, not names) live in `src/data/units.ts`; `activeUnitAtom` is a units.dat id.

Edits are `UnitChange { index, before, after }` lists (insert / remove / replace, removals highest index
first) carried in `HistoryEntry.units`; `applyUnitChanges` marks `UNIT` dirty. `unitsRevisionAtom` is the
repaint trigger for unit changes (the list is mutated in place, like tiles); `selectedUnitsAtom` holds
indices and is cleared by any unit edit/undo. `snapPlacement` puts anything with the Building flag on the
tile grid by its placement box; `makeUnit` writes StarEdit-style valid/used masks (see
`tests/unit-edit.test.ts`). The viewport draws in `drawOrder` (ground by y, then flyers) and falls back to
coloured markers while a GRP loads or when the assets are missing. The UNIT bit masks (`UnitValid`,
`UnitUsed`, `UnitState`, `UnitRelation`) live in `sections/objects.ts`; `UnitPropertiesDialog` edits every
record field on the selection (payload `{ indices }`), writing only touched fields via `updateSelected`.

Placement (`src/editor/placement.ts`): `checkPlacement` applies the palette's `placementOptionsAtom`
(collision = overlapping collision boxes of non-flyers; terrain = buildable tiles under a building's
placement box / walkable VF4 minitiles under a unit's collision box) — `useUnitTools.ghostAt` carries the
verdict, `placeAt` and `endDrag` refuse on it. `strandedUnits` finds units a terrain edit invalidated;
`useTerrainTools.commitTerrain` removes them in the *same* `HistoryEntry` (`changes` + `units`) when
`removeStranded` is on. `unitPlacingAtom` is the "armed" state: the palette arms it, Esc / right-click
(`stopPlacing`) disarm it, and only then does a click on empty ground place.

Animation (`src/formats/dat/iscript.ts`, `lo.ts`, `src/formats/units/animate.ts`): `iscript.ts` is
dependency-free so `scripts/extract-units.mjs` can import it under Node's type stripping and walk the
scripts for reachable images (`walkAnimation`, `IMAGE_SPAWN_OPS`). `UnitAnimator` keeps one `SpriteState`
per record (matched by object, then by serial across replacements), each a bottom-to-top `images` stack
running Init → StarEditInit (turreted vehicles) or Built (buildings); `tick()` is one game frame and the
viewport's rAF loop drives it alongside water cycling (`GAME_FRAME_MS`), repainting only when `tick()`
reports a change and units are on screen. Damage overlays (image 450/472 + the damage `.lo` slot index — the
22 slots are laid out Terran 0–7, Zerg 8–15, Protoss 16–21 — count from `hitPointsPercent`) are re-evaluated in `sync`; `creategasoverlays` spawns smoke
from the special `.lo`. `sprites.ts#getImageFrame` is the per-(image, frame, flip, colour, tileset)
canvas cache; shadows draw as 50% black, `DrawFunction.Remap` images through the tileset's
`<name>.<ofire|gfire|bfire|bexpl>.pcx` table (column 0, blended "lighter"). Anything that needs the
running game (attacks, sounds, projectile sprites, condition jumps) is a no-op. `tests/iscript.test.ts`
and `tests/animate.test.ts` run against the real files when `public/` is populated.

### Image export (`src/services/mapImage.ts`)

File ▸ Export ▸ Image is one dialog with one dial — `pixelsPerTile` — and `renderMapImage`
is a standalone re-implementation of the viewport's draw pass with `sx = sy = 0` over the
whole map (it deliberately shares no code with `MapViewport`, which is entangled with
scroll, layers, hover and gestures). There is no "map vs minimap" mode: the two thresholds
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

### Startup preload (`src/services/preload.ts`, `src/hooks/usePreload.ts`)

The splash used to run a fixed 3.3 s script of invented log lines while the real fetches happened behind
it, so you landed in the editor on top of the viewport's own "Loading … terrain" plate and unit markers.
`runPreload` replaces that with an ordered `PreloadTask[]` that actually awaits the work — the startup
tileset (`ensureTileset`), the unit tables (`getUnitAssets`), the GRPs a blank map draws (`warmUnitGrps`),
and finally the startup document itself (injected by the hook, which subscribes to `scenarioAtom` so it
does not race `useStartupMap`). Progress lands in `preloadStepAtom` / `preloadLogAtom`; the splash shows
it and only leaves once `done`, held to `MIN_MS`/`MAX_MS` bounds. **Do not add a task that is not really
awaiting something** — the bar reaching the end is the promise that the editor is warm.

Tasks carry a `weight` (the tileset is worth ~6× the rest) and may `report(0..1)` within themselves;
`onTilesetProgress` in `formats/tileset/load.ts` is a *module-level* subscription rather than an argument
to `getTileset` because the loader shares one promise per tileset and child effects (`MapViewport` →
`useTileset`) run before the root's, so the preload is often not the caller that starts the load. Every
task is best-effort: a failure is logged as "unavailable" and stepped over, since missing game data is a
normal state everywhere else. `warmRemainingTilesets` then pulls the other seven tilesets' *bytes* into
the HTTP cache — bytes only, because an atlas is ~20 MB of pixels and decoding all eight would cost more
resident memory than the rest of the editor.

The splash canvas draws the wireframe sphere, the orbiting rings and the progress sweep through one
shared projection, so the rings genuinely pass behind and in front of the sphere. It is deliberately
off-theme (pink, scoped to `--sp-*` in `splash.css`); `tokens.css` stays the editor's gold + teal.

`src/devReactTracks.ts` (imported first by `main.tsx`, and only there) exists because React 19's
dev-only "Components" performance track made startup unusable: it logs every component render to the
performance timeline and serialises its props, and mounting the chrome is ~1700 renders in one commit —
about **seven seconds of unbroken main thread**, during which the splash cannot paint a frame. Measured
in dev: worst long task 6978 ms → 142 ms with the track off. A production build never had the problem
(zero long tasks), so this only makes `npm run dev` behave like the built app. It works by hiding
`console.timeStamp` (part of react-dom's one-time `supportsUserTiming` check) for exactly as long as
react-dom takes to evaluate — hence "imported first", and hence the microtask that puts it back.
`VITE_REACT_TRACKS=1` keeps React's track if you want to profile renders. If startup ever feels frozen
again, measure `longtask` entries before blaming the loading code.

### UI

- All state is Jotai; there is no context/provider layering beyond the default store.
- Dialogs: `DialogId` union in `src/atoms/uiAtoms.ts`, a stack (`openDialogAtom`/`closeDialogAtom`),
  and a `REGISTRY: Record<DialogId, ComponentType<DialogProps>>` in
  `src/components/dialogs/DialogHost.tsx`. Adding a dialog means touching both.
- `MapViewport.tsx` is a single canvas that draws terrain (atlas or fallback colours), overlays
  (grid, locations, start locations, brush ghost) and handles all mouse input for the active layer.
- Hotkeys are centralised in `src/hooks/useHotkeys.ts`; file actions (open/save/new, drag-drop) in
  `src/hooks/useMapFileActions.ts` and `src/services/mapIo.ts` (File System Access API with
  `<input>`/download fallbacks).
- CSS is plain, layered in import order `tokens → base → ui → chrome → panels → viewport → dialogs → splash`
  under `src/styles/`; design tokens are CSS variables in `tokens.css`.
