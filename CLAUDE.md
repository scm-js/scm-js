# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based StarCraft 1 / Brood War map editor (React 19 + Vite + TypeScript + Jotai), modelled on
StarEdit / SCMDraft 2. It opens real `.scm`/`.scx` maps (MPQ archives via `mopaq`), renders terrain from
the game's own tileset graphics, and writes playable archives back. `README.md` is the map-maker's
guide (what each layer does, and the table of what is and is not implemented) — read it first; the
technical companions are `docs/file-formats.md`, `docs/game-data.md`, `docs/plugins.md` and
`docs/development.md`. Keep all five current when behaviour changes — they are also the
documentation *site* (`npm run build:docs` → docs.scmjs.dev), which renders them rather
than holding anything of its own.

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
npm run build:image    # web bundle + docker/Dockerfile -> the `scmjs` image (nginx, no game data)
node scripts/extract-tilesets.mjs         # just the tilesets
node scripts/extract-units.mjs            # just the unit data
```

Tests live in `tests/*.test.ts` (and `src/**/*.test.ts` is also picked up). Tests that need
`fixtures/maps/*.scx` or `public/tileset/*.cv5` use `describe.skipIf(...)` and skip silently when the
files are absent — so a green run does not necessarily mean the real-map / real-tileset suites ran.
vitest still *runs* a skipped describe's body to collect it, so a suite that reads the files in the body
(not inside `it` / `beforeAll`) must be guarded with `if (have) describe(...)` instead, or CI — which has
no game data — crashes on the read.
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
  `serializeChk` writes each header's **declared** size, not `data.length`: the two differ only for a
  section the reader could not take whole (a length past the end of the file, or a negative one — a
  protection trick the game acts on), and a plain Save must leave such a header as it found it. So
  `serializeChk(parseChk(bytes))` is `bytes` for any input, `insertionPoint` never places a new
  section behind such a tail, and straightening a bad header out is the Repair plugin's job. Everything
  that re-encodes a section sets `declaredSize` to the new length.
- `scenario.ts` decodes only the sections the editor models into typed fields on `Scenario`
  (`tiles`, `isom`, `units`, `locations`, `strings`, players, forces…). Section codecs live in
  `sections/{terrain,objects,players,strings}.ts`.
- `Scenario.dirty` is a `Set` of section names. On save, `serializeScenario` re-encodes **only** dirty
  sections (via `encodeSection`'s switch) and emits everything else byte for byte. New sections with no
  existing occurrence go in *among* the ones already there, at the place `APPEND_ORDER` ranks them
  (`insertionPoint`: after the last section that comes before them, else at the front) — appending
  them at the end instead left a map that got its ISOM back with the lattice past FORC, which no
  editor writes and the Repair plugin then reported as out of order. Any mutation of scenario state must call
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
- `mpq/scm.ts` wraps `mopaq` (≥ 1.4.0, the user's own library at `github.com/jeany55/mopaq`, published
  to npm from a `v*` tag): `.scm`/`.scx` → `staredit\scenario.chk`; bare `.chk` files are accepted.
  Non-scenario archive members are read by `readMembers`: by name where a name is known — the
  `(listfile)` plus `editor/sounds.ts#referencedMembers` (the WAV table, every `wav` action
  argument, the Trigger Script members), probed with `slotOf`, since protectors strip the listfile
  and the sounds are then only findable by the names the scenario carries — into
  `archiveExtrasAtom`, and everything else (no name, or bytes this build cannot decode) as
  `StoredMembers` into `archiveStoredAtom`: mopaq's `members()` / `hashEntries()`, written back
  through `Creator.addStored` pinned at the same offset and hash slot, which is what keeps a
  member encrypted with the offset-adjusted key (StarEdit's extras all are) readable without its
  name. That forces the saved archive's sector size to the source's (`requiredSectorSize`) and
  the hash table to its old size; `planSave`'s fourth argument carries them (`SavePlan.stored`, a
  warning in words) and `buildMapFile`'s fifth hands them to `saveMap`. Before this, a map with no
  listfile lost every extra member on save with no warning — the first outside review found it.
  `saveMap`'s options are compression (`none` / `zlib` / `pkware`),
  StarEdit-style encryption, sector size (4096, Blizzard's) and the listfile; `loadMap` reports how
  `scenario.chk` was stored (`scenarioInfo`, from `archive.fileInfo`). PKWARE is what StarEdit and the
  game's own maps use (fixture flags `0x80010200`), so it is the one compression every build reads; zlib
  needs 1.16.1+.

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
(`symmetryAvailable`). The continuous versions cover objects: `mirrorPixel` (a unit's or sprite's
centre — `useUnitTools` / `useSpriteTools` expose `ghostsAt` and place every image the checks
accept), `mirrorBox` (a location's bounds, `useLocationTools.create`) and `mirrorTileRect` (a
doodad footprint; `keepsShape` drops an image that would turn a non-square one). The isometric
brush paints the diamond under each image of the pointer (`paintIsomAt`). Blend, moving and
deleting are deliberately not covered. The viewport draws the axes on every layer but the
clipboard and draws the mirrored ghosts fainter; `tests/symmetry.test.ts`.

Replace Terrain (`terrain.ts#replaceTerrain` / `matchingTiles`, `useTerrainTools.replace`,
`ReplaceTerrainDialog` in `dialogs/TerrainDialogs.tsx`) swaps a `TerrainPick` — a flat terrain by
ISOM id (matched by CV5 group index like the Rect fill) or one exact tile — for another over the
map or the marked area, through `stampTerrain` / `stampTile`; one undo step, ISOM untouched.

The Isometric brush lives in `src/editor/isom.ts` — a port of Chkdraft's reverse-engineering of StarEdit
(MIT). Read its header comment first. Key facts: the ISOM section is a lattice of diamonds whose values
index a per-tileset *shape-link table* built from the CV5 at load time (`isomTables`, cached per
`Tileset`), plus the copied-in terrain numbering/adjacency in `src/data/isomTables.ts` (an ISOM value is
**not** a CV5 index — `isomValueOf(era, index)` maps between them). `paintIsom` mutates `scn.tiles`
*and* `scn.isom` and returns `{ tiles, isom }` change lists; `HistoryEntry.isom` carries the second list
through undo/redo (`applyIsomChanges`). `hasIsom(scn)` gates the brush: a map without `ISOM` gets a
notice pointing at the Repair plugin; the rebuild itself (`rebuildIsomFromTiles`) is reached only through
`tx.rebuildIsom` on the plugin API — there is no native button or menu item — and creating the section is
the `createdIsom` history case (`commitEditAtom` bumps `isomRevisionAtom` for it). `isomReport` /
`STALE_ISOM_SHARE` live in `editor/isom.ts`; `useIsomStatus` and `api.terrain.checkIsom` both read them. `checkIsom` measures ISOM/tile agreement (`useIsomStatus`, computed on
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

### CUWP (`src/formats/chk/sections/cuwp.ts`, `src/editor/cuwp.ts`, `dialogs/CuwpDialog.tsx`)

`scenario.cuwp` is UPRP (64 `CuwpSlot`s of 20 bytes: valid-state bits, valid-field bits, owner,
hit points / shields / energy as percentages, resources, hangar, state bits, four unused bytes) and
`scenario.cuwpUsed` UPUS (StarEdit's 64 "in use" bytes), both `null` when the file has no section
and modelled on a new map. The *Create Unit with Properties* action stores the slot **1-based** in
`target` (`triggerDefs.ts` kind `cuwp`; the Classic editor's widget lists slots by `cuwpSlotLabel`
and opens the dialog with `payload.slot`). `editor/cuwp.ts`: `readCuwp` / `applyCuwp` (a
settings-style transaction that marks UPRP and UPUS only when they change; a file with no UPUS gets
one only when a tick goes on), `cuwpUsage`, `cuwpSlotView(s)` / `patchCuwpSlot` / `patchCuwp` (the
plugin API's `tx.cuwp` and `settings.cuwpSlots`). Check Map warns on a slot out of 1..64 and notes a
slot that sets nothing. `tests/cuwp.test.ts`.

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

Sections: OWNR is always written together with IOWN (StarEdit's copy, decoded into
`scenario.editorPlayerTypes` — `applyPlayerSettings` sets both, `encodeSection` writes IOWN from it,
and Check Map warns when a file's two disagree); `playerRgb` is CRGB
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
Map Properties also changes the tileset: `editor/tileset.ts#changeTileset` (ERA, the terrain laid
again with `flatTerrain` and ISOM to match, the doodads and their overlay sprites dropped — or
`keepTiles` for ERA alone) through `changeTilesetAtom`, a whole-document transaction like Resize
(`afterWholeDocumentChange` drops the history and bumps every revision; `tilesetFileNameAtom` reads
the settings revision so it re-derives from the mutated ERA). The dialog `ensureTileset`s the new
graphics first so the fill uses real tile ids.
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
behind Ctrl+F. Persisted preferences and the grid look live in `atoms/preferencesAtoms.ts`
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
Repair, Walkability, Terrain from Image and Paint are default plugins, all on
(`src/plugins/defaults.ts`); Melee Wizard, Trigger Script and Section Explorer are installed from
Browse Plugins.
`zoomToFitAtom` is View ▸ Zoom to Fit (Ctrl+Shift+0), `lockedLayersAtom` the Layers panel's padlocks
(the viewport's `onDown` refuses a locked layer's gestures), `cursorPixelAtom` the status bar's Px.
`gridSizeAtom`, `locationSnapAtom`, `placementOptionsAtom` (`scmjs.placement`),
`doodadPlacementAtom` (`scmjs.doodadPlacement`), `panelsAtom` and the dock widths are `atomWithStorage`
now — the two placement bags through `mergedStorage`, and every one of them listed in Preferences ▸
Browser storage, registered in `STORED_RESETS` and so clearable on its own or with the rest.

### Saving (`src/editor/save.ts`, `src/services/mapIo.ts`, `useMapFileActions.ts#saveDocument`, `SaveMapDialog`)

`editor/save.ts` is pure: `SaveOptions` (format, compression, encrypt, `omitExtras`, the strip ticks,
`mergeRepeats`, `dropTrailing`), `planSave(scn, extras, options)` → a `SavePlan` (every `currentChk`
section with a fate — kept / dropped / merged — and reason, every extra with `kept`, sizes, counts for
the ticks, warnings in words), `buildChk` / `buildMapFile` (the `.chk` alone or `saveMap` around it;
zlib gets 64 KB sectors, the rest StarEdit's 4 KB). The strip groups are `TERRAIN_EDITING_SECTIONS`
(ISOM, TILE, DD2) and `BOOKKEEPING_SECTIONS` (IVER, IVE2, IOWN, UPUS, SWNM, WAV) — the registry's
`editorOnly` flag, and `tests/save.test.ts` keeps the two in step; nothing the game requires can be
stripped. Merging uses `combine` with the registry's mode, at the first occurrence. `defaultSaveOptions`
is the file's own extension and *the way it was opened* (`mapOriginAtom`), else StarEdit's layout;
`SAVE_PRESETS.everything` / `.smallest` are the dialog's two buttons. Nothing here mutates the scenario.

`mapIo.ts` keeps the File System Access handle (`MapFileHandle`, typed locally — the DOM lib lacks the
permission methods) from `pickMapFile`, `droppedHandle` (must be *called* inside the drop event) and
the save picker; `saveBytes(bytes, name, handle)` answers a `SaveOutcome { route: "file" | "picker" |
"download", fileName, handle }` or null for a dismissed picker — a handle write asks
`queryPermission` / `requestPermission` first and falls back to the picker on refusal.
`mapFileHandleAtom` / `mapOriginAtom` / `saveOptionsAtom` (`editorAtoms.ts`) ride on `LoadedDocument`
and are cleared by close; a `"replace"` load keeps the options. `saveDocument(store, req, write?)` is
the one writer: builds (or takes the dialog's) bytes, calls the writer, and on success — unless
`req.copy` — sets path, handle, options, modified=false, recents, then a status line and a toast
(`pushToastAtom` / `toastsAtom`, `Toasts.tsx` bottom-right) worded "Saved" or "Downloaded … in the
browser's downloads folder", since a download is the only route Firefox and Safari have.
`.toasts` sits at **z-index 210** — above the dialog layer (`.dlg-overlay` 100, `.dlg` 101),
below the splash (300). At 60 it was under the overlay's 55% fill and 2px backdrop blur, so
every notice raised from a dialog — a plugin installed, a data set removed, a map exported or
a test map written, five dialog modules raise them — was dimmed and blurred in the one place
the editor most wanted to be read. A toast is then a press *outside* the dialog, so
`DialogFrame` prevents Radix's `onInteractOutside` for a target inside `.toasts`: dismissing a
notice, or pressing its one action, must not close the dialog that raised it. `save(mode)`
in the hook: `"save"` with a path writes with the remembered options; otherwise `askDialog(store,
"saveAs", { copy })` opens `SaveMapDialog` and resolves when it calls `payload.done(true)` (after
`taken`) or leaves the stack — so Close Scenario's Save waits for the whole thing. Save Copy As is the
same dialog with `{ copy: true }`. `tests/save-flow.test.ts` covers the store half with a fake writer.

### Strings, sounds, switches (`src/editor/strings.ts`, `sounds.ts`, `switches.ts`)

`stringUsages(scn)` maps every string index to the records that reference it (SPRP, FORC, MRGN,
UNIS/UNIx names, SWNM, WAV, every TRIG/MBRF action's `text` and `wav`); the String Editor edits a
working copy of the table and `applyStrings` writes it back **without renumbering** — it trims only
unreferenced trailing blanks and keeps a blank slot something still points at. `escapeControls` /
`unescapeControls` show bytes below 0x20 as `<XX>` (tab, LF, CR stay literal), and
`editor/textColors.ts` is what those bytes *mean*: `TEXT_CODES` (the community table at
wiki.staredit.net/wiki/Color, whose twelve player colours are the classic BW palette — the
editor's older table was wrong from 0x12 up, with the alignment codes a byte early and 0x18
called black instead of player 9's green), `runsOf` turning a string into coloured runs the
way the game draws it, and the Remastered newline change: 1.16.1 reset the colour at every
line break and Remastered carries it on, so `bleedingLines` finds the lines that render
differently now and `fixBleeding` writes the reset the old game supplied (`RESET_CODE`,
0x02, the cyan that *is* the default), and `inlineRuns` — the same reading flattened to one
line, with a `NEWLINE_MARK` between the lines. `components/ui/ColorCodes.tsx` is the shared
chrome, three surfaces a field takes as many of as it has room for: `ColorCodeBar` (a swatch
per code, refusing the mousedown so the caret it inserts at survives the click),
`StringPreview` (the block plate, on the game's own dark ground in the game's own default
cyan) and `InlineString` (one line, for a list row or a field-shaped box — drawn with
`initialColor: "inherit"`, so text no code coloured keeps the chrome's colour and only a
string that really carries a colour stands out). **`ColorTextField` is the three composed**
and owns the `escapeControls` / `unescapeControls` round trip, so no caller repeats it:
`preview` is `"swap"` (the read surface *is* the field until it takes focus — what lets four
force names each have one), `"below"` (a persistent plate, Map Properties' description and
the String Editor) or `"none"`; `codes` is `"popover"` (a Radix `Popover` on the field's own
button, `onOpenAutoFocus` prevented so the caret stays put), `"bar"` or `"none"`. Going back
to the read surface on blur is deferred one task on purpose — pulling the input out of the
tree while the browser is still moving focus makes the dialog's focus trap take it back, and
clicking from one of these fields into another landed on the dialog. It is used by Map
Properties, the String Editor, force names, custom unit names and a trigger or briefing
action's `text` argument; a `wav` argument and the strings the game never draws (location
names, switch names, trigger comments) deliberately get none of it. `Preferences.classicText`
is the 1.16.1 line-break rule, one setting every preview reads (`useClassicText`), shown in
the String Editor and Preferences ▸ Display. The whole
module is on the plugin API as **`api.text`** (`TextApi` in `plugins/api.ts`,
`host.ts#text`), so no plugin carries a copy of the numbering — the Repair plugin's string
finding is `bleedingLines` / `fixBleeding` over `api.query.strings()`, injected into its
pure `analyze` as `TextHelpers`. `tests/text-colors.test.ts` covers the module and
`tests/plugins.test.ts` the API group. `editor/sounds.ts`
joins `scn.wavs` with `archiveExtrasAtom` (`soundList`, `orphanSounds`, member names normalised for
case and slashes); the Sound Editor's working copy carries both the table and a new extras `Map`, and
apply replaces the atom, so an imported file only reaches the archive on OK / Apply. Import converts
through `services/audioConvert.ts` (`convertToWav` / `decodeAudio`: `formats/wav.ts#decodeWav` first,
else Web Audio `decodeAudioData` in a throw-away `OfflineAudioContext`; an offline render for
resampling / downmix, `WAV_PRESETS` for the targets — the platform decoders cover MP3 / FLAC / AAC / Ogg)
and `formats/wav.ts` (pure: `parseWavHeader` incl. WAVE_FORMAT_EXTENSIBLE, `blockAlign` and the `fmt `
extra bytes; `encodeWav` 8/16-bit PCM; `decodeWav` for 8/16/24/32-bit PCM, float, A-law, µ-law, IMA
ADPCM — the game's own sound encoding — and Microsoft ADPCM, `canDecodeWav` / `wavFrames` /
`wavDuration` off the header; `tests/wav.test.ts` encodes each format on the test side and checks the
decoders against it). A file already a PCM WAV in the target format is kept byte for byte, and a
converted one is renamed `.wav`. `mopaq` cannot read the MPQ-ADPCM-*compressed* members of the game's
own archives — that is the archive's compression, not the WAV encoding, and out of this repository's
hands.
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

`BRIEFING_ACTION_DEFS` puts the portrait slot in `player` (the first group): Blizzard's own maps
say so — `fixtures/maps/(6)Ground Zero.scm` and `(4)Spring Thaw.scx` (gitignored copies from the
install's Maps folder) carry briefings, and `tests/briefing.test.ts` decodes, round-trips through
the text format and re-encodes them; StarEdit sets hint bits (0x04 and the unit-type hints) on every
briefing action that text cannot carry, so that test masks them. `editor/triggers.ts#actionStrings`
is the one walker over an action's text / WAV arguments (the String Editor's usage list, the Sound
Editor and Find all read it). The Text Trigger Editor's Briefing mode edits MBRF in the same syntax.
The Classic editor's player pick carries an EPD box (`epdOf` / `addressOfEpd` over
`DEATHS_TABLE_ADDRESS`) for EUD work.

The text format (`formats/triggers/text.ts`) resolves names through a `TriggerNames` context
(`triggerNames(scn)` in `editor/triggers.ts`) so it is testable without a scenario; unknown names
print as bare numbers and parse back, unknown types print as `Condition N(...)` / `Action N(...)`.
The one thing text cannot carry is the `UnitTypeUsed` hint bit (0x10) — Blizzard's own maps disagree
about it — so `tests/trigger.test.ts` masks the hint bits in its fixture round trip. `intern` appends
to the string table while parsing (never removed, so harmless). Trigger dialogs are settings-style
transactions: `useScenarioForm(scenario, readTriggers)` → `applyTriggers` (marks `TRIG` only on a
real change) → `commitTriggersAtom` (`triggersRevisionAtom`); nothing is in the undo model.
`newCondition` / `newAction` seed StarEdit-like defaults.

### Trigger claims, and the Trigger Script plugin

The Script Editor — the TypeScript-subset language that generates a block of `scenario.triggers`,
its compiler, simulator and Monaco dialog — is the **Trigger Script** plugin
(`github.com/scm-js/plugin-trigger-script`, not a default — installed from Browse Plugins), not the editor: it was moved
out so the editor no longer bundles Monaco and a second TypeScript (the desktop download lost ~14 MB
of the 18 MB those chunks weighed). Its README documents the language and its internals. What stays
here is generic:

- `api.triggers.claim(spec)` (`host.ts`, `pluginTriggerClaimsAtom`, `plugins/claims.ts`): a plugin
  names a run of the trigger list it generates, found by *content* — `spec.locate(list)` is asked
  with whatever list an editor holds, since the Classic editor works on a working copy with local
  inserts — and `TriggerListEditor` badges and locks those rows (`claimBadge`, `claimDescription`,
  `spec.open` as the button), inserts after the run rather than into it, `textOf` in the Text
  Trigger Editor fences every located run in comments, and Import Triggers' replace hint lists
  them. `commitTriggersAtom` no longer relocates anything: the plugin listens to `"triggers"` and
  rewrites its manifest itself. `tests/plugins.test.ts` covers locate/clamp/throw/refresh/dispose.
- The `"commands"` event (`EVENT_ATOMS.commands` = `pluginCommandsAtom`) is how a plugin that calls
  another's commands by id (the AI plugin → `trigger-script.compile` / `.build` / `.declarations` /
  `.state` / `.print` / `.simulate` / `.triggerAtLine` / `.open`) learns they arrived — there is
  deliberately no plugin ordering, so `commands.has` at call time is the contract.
- `DialogSpec.keepOpenOnEscape(target)` lets a plugin dialog keep Escape for something inside it
  (Monaco's popups); `PluginDialog` routes it to `DialogFrame.onEscapeKeyDown`.
- `editor/save.ts` keeps `SCRIPT_MEMBER` / `MANIFEST_MEMBER` (`scmjs\\triggers.ts` / `.json`) only so
  the Save dialog can say what leaving the plugin's members out means; nothing here reads them.
- `data/triggerDefs.ts#DEATHS_TABLE_ADDRESS` is the EPD base the Classic editor's player pick uses
  (the plugin's compiler carries its own copy).
- TypeScript stays a runtime dependency for one job: `plugins/transpile.worker.ts` +
  `transpileClient.ts` turn a `.ts` plugin into JavaScript for the loader (idle-terminated after
  `WORKER_IDLE_MS`, main-thread fallback when the worker cannot start). A plugin cannot transpile the
  plugins loaded before it, so this cannot move out.

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
entry and a `console.error`, not a throw. `ProgressHandle` carries `signal` beside `cancelled()`.
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

`loader.ts` is pure apart from `LoaderDeps` (fetch, transpile, module URL, import, built-ins):
`parseSpec` (`builtin:`, `github:owner/repo[@ref][/dir]`, github.com URLs, any URL to a `plugin.json`
/ entry file / directory) → `resolvePlugin` (manifest, entry) → `bundleModule` (fetch **as text** —
raw.githubusercontent serves `text/plain`, which `import()` refuses — transpile `.ts` in the transpile
worker via `transpileClient#transpileInBackground` / `plugins/transpile.ts`, follow relative imports
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
scmscx.com, Repair, Walkability, Terrain from Image and Paint, each pinned to a tag and
all on; that file is the only place the versions are written down, so read them there
rather than here; Melee Wizard,
Trigger Script and Section Explorer are published in the registry but are not defaults — plus any built-in, each a
`DefaultPlugin { spec, enabled }`), which `effectiveInstalls` merges over
the stored list, so a default is always listed, starts as its entry says unless the stored list says
otherwise, can be turned on or off but not removed, and is otherwise
an ordinary spec; the Manage Plugins row badges it `default`
and hides its Remove button (what the user pastes is canonicalised through `canonicalSpec(parseSpec(...))`,
so pasting the default's own github.com URL is recognised as it rather than duplicating it).
Every default names a **tag, not a branch**, and that one change is what the rest hangs off.
An unpinned default meant a push to a plugin repository changed every editor already in use
and no released version could be rebuilt as it shipped; moving one forward is now a commit
in `defaults.ts` that ships with the next release. `isPinned` therefore counts any explicit
ref that is not a branch name (`MOVING_REFS`) and `unpin` strips any ref, and identity moved
off the spec string: `loader.ts#pluginIdentity` is the repository whatever version follows
it, and `defaults.ts#pluginKey` is that with a *bundled* copy answering for the spec it was
built from. `effectiveInstalls` folds a stored row onto the default with the same key (an
older editor's unpinned spec, or the desktop's `builtin:` copy) instead of listing — and
running — the plugin twice; the default's own spec wins unless the stored one `isPinned`,
which is a version the user chose through the Update button. Browse's `installOf` matches on
the same key.
`scripts/vendor-plugins.mjs` (`npm run vendor:plugins`, run by **`predev` / `prebuild`**
and again by `scripts/build-desktop.mjs` unless `--skip-plugins`) is the other half: it
reads the pinned specs straight out of `defaults.ts` with a regex (importing it would pull
in `builtin.ts`'s Vite-only `import.meta.glob`), fetches each plugin's runtime source at
that tag — the manifest, the icon, every `.ts`/`.js` outside `dist/`, `tests/`,
`.github/`, plus the LICENSE; the *source*, not the plugin's own `dist/plugin.js`, since
Vite tree-shakes what it compiles in, and `@scm-js/plugin-api` is imported with
`import type` and erased before the bundler sees it — and writes it into the gitignored `plugins/<name>/` with a
`vendored.json` naming the spec, which `builtin.ts` reads into `BUILTIN_REPLACES` and the
script itself reads to know which copies are its own (it brings those up to date and
removes ones that stopped being defaults; a hand-made directory is left alone). A copy
already at the pinned spec is skipped, so only the first build after a clone touches the
network and `SCMJS_SKIP_VENDOR=1` opts out entirely (that bundle fetches its defaults at
startup, as before).
**Every** build bundles them, not just the desktop. The reason is the cold path: a `.ts`
plugin must be transpiled before the browser will import it, one transpile starts
`transpile.worker.ts`, and TypeScript is *inlined into that worker* — so five remote `.ts`
defaults dragged 3.4 MB (975 KB gzipped) of compiler onto a first visit. Measured on the
production build with a logging static server, a cold visit went from 1235 KB gzipped / 20
cross-origin requests to 344 KB / none. It is all or nothing: one remote `.ts` default
starts the worker and costs the lot. The rest follows — an installed app and a container on
an intranet start with all five, and nothing third-party is fetched at startup.
What it costs is that the remote loading path is no longer walked by simply opening the
editor. `tests/plugin-network.test.ts` is the deliberate replacement (real fetch, transpile
and `import()` through `data:` URLs in Node; `describe.skipIf` unless
`SCMJS_NETWORK_TESTS=1`), run by build.yml's Web job and release.yml's pre-flight — neither
of which gains a dependency, since the build already needs GitHub to vendor.
`tests/vendor-plugins.test.ts` pins the parse, the file filter and the rule that no default
may be unpinned.

**A plugin repository's typings and its build.** The contract reaches the plugin
repositories as `@scm-js/plugin-api`, a devDependency on `^1` holding one generated
`index.d.ts`: `scripts/build-plugin-types.mjs` bundles it and
`scripts/publish-plugin-api.mjs` publishes it — to **npm**, which is what the plugin
repositories depend on, and to `github.com/scm-js/plugin-api`, which is the audit trail
behind the tarball and holds its README. The `plugin-api` job in build.yml runs it on every
build. Before this each of the nine repositories carried its own copy of the 61-file
emitted tree, refreshed by hand. Nothing is fetched at runtime for it — `import type` is
erased before the loader sees a specifier, which is what lets a plugin depend on a package
at all.
The version is the **API's**, not the editor's: major is `PLUGIN_API_VERSION`, the minor
moves when the declarations do (`nextVersion`, asked of the registry), and the editor
version is in neither file — editor 0.1.0 → 0.2.0 is an ordinary release that semver reads
as a break, and an npm version cannot be republished, so anything in there that moves on
its own would publish out of a build that changed nothing. A build that did not move the
contract publishes, tags and commits nothing. `PLUGIN_API_PAT` is the organisation secret
for the git push (a run without it reports instead of failing); the npm half is behind the
`PUBLISH_PLUGIN_API` repository variable, authenticates by OIDC alone (no npm token, hence no
`registry-url` on that job's `setup-node` — it writes an `.npmrc` with an empty `_authToken`; and
the trusted publisher's **Allowed actions** must permit a *direct* publish, since staging is the
only one allowed by default), and goes out with `--provenance`, which is also
why the package's `repository` names scm-js — provenance attests to where the workflow ran.
`tests/plugin-api-package.test.ts` pins the version rule and the no-imports rule.
`PluginManifest.build` is the other half: a plugin repository publishes a
`dist/plugin.js` (one esbuild call, committed) and names it, and `resolvePlugin` loads
**it** in place of `entry` — one fetch, no transpile worker, no `bundleModule` graph walk,
and the plugin may use npm dependencies, which the source path cannot resolve.
`ResolvedPlugin.built` / `PluginAddresses.built` carry which happened, so
`ConfirmPluginDialog` names the bundle *and* the source it was built from. `entry` stays
required reading and stays what loads for a repository with no build, so a one-file plugin
still needs no toolchain. The shared workflow is
`scm-js/.github/.github/workflows/plugin-ci.yml`, called in six lines by each plugin
repository: type-check, test, rebuild and commit the bundle on main, and at a tag rebuild
and *check* rather than write — esbuild is deterministic and the bundle carries no hash or
date, so a tag whose `dist/plugin.js` is not what its source builds to fails. Its scheduled
run type-checks against the newest `@scm-js/plugin-api`, which is how a moved contract
surfaces. `tests/plugin-network.test.ts` covers both loading paths against the real
repositories.
A failed activation is no longer silent: `plugins/failures.ts` is pure (`pluginFailures`
over the runtimes, `failureToast` with `ttl: 0` so it outlives the splash and a *Plugins…*
button that opens Manage Plugins) and `usePlugins` awaits the pass and reports once per spec
per session. For that to work `activatePlugin` returns the load **in flight** for a spec that
is already loading rather than a resolved promise — React's double mount otherwise had the
second pass reading the runtimes before a single fetch had finished.
Adding a plugin goes through a confirmation first: `PluginsDialog`'s Add canonicalises
the spec (`loader.ts#canonicalSpec`), runs `host.ts#inspectPlugin` → `loader.ts#previewPlugin` —
`resolveCommit` (GitHub's commits API, one request, no token) then
`resolvePlugin(..., { entry: false })` on *that commit*, so one `plugin.json`, no entry
probe and no `import()` — and opens `confirmPlugin` **only once that came back with a
manifest**, handing the `PluginPreview` over in the payload (fetched once; the Update
button on a pinned row does the same). An address with no plugin behind it is answered
under the field instead (`NOT_FOUND` plus the fetch's own message), because a details
screen with no details on it reads as a broken dialog rather than a wrong address.
`ConfirmPluginDialog` shows the manifest (name, version, author, description,
icon), the repository (`PluginSource.webUrl`, derived by `parseSpec` for a GitHub spec)
and homepage links, the manifest / entry / base URLs of the version being installed
(`addressesOf`, recomputed as the pin tick moves), and the not-sandboxed warning.
`installPlugin` is the only writer past it: it seeds the manifest through
`rememberManifest` (shared with `describePlugin`), then `setInstalled` + `activatePlugin`.
Its three options are the dialog's ticks — *Enable it now* (on), *Pin to this version*
(on whenever `PluginPreview.pin` resolved, storing `github:owner/repo@<sha>` instead of
the moving spec; `isPinned` recognises one) and *Load from a copy saved here* (off,
`PluginInstall.local`, the same tick the Manage Plugins row carries under its buttons).
The label and the explanation under it read the same whether that tick is on or off — one
that swapped between describing the copy and describing the fetch read as two different
options — so the only state-dependent part is the size of the copy, shown next to the row's
tick.
A manifest that cannot be read (`PluginPreview.problem`) is a dead end on both screens —
the dialog says so and Add is disabled — `pinProblem` says why there is no pin, and an
unusable spec fails in `add` before any fetch.

`local` is served by `loadDepsFor`: with no copy yet the load runs through
`recordingDeps` and `storeSnapshot` writes every fetched file to `pluginCodeAtom`
(`scmjs.plugin-code`, capped at `MAX_SNAPSHOT`); with a copy it runs through
`storedDeps`, which has no network path at all and errors on a URL the snapshot lacks
(`describePlugin` reads the copy too, so the address is never touched while the option
is on). `PluginRuntime.loadedFrom` records which happened. `reloadPlugin` drops the copy
and re-fetches — the way both a pinned and a stored plugin are moved forward — and
`setInstalled` drops it whenever `local` goes false or the plugin is removed;
`clearStoredDataAtom` `RESET`s the atom with the others. Reload re-fetches whatever the
spec names, so a pinned plugin moves forward through the row's **Check for update** button
instead: it previews `unpin(spec)` and, when the branch holds a different commit, reopens the
confirmation with `replaces` set, which makes `installPlugin` deactivate, unlist and
un-copy the old commit before installing the new one.
That button is on every row with an address to ask, whether or not anything is newer, so
most presses can only answer "nothing is" — it used to say **Update** and put that answer in
one dim line at the top of the pane, which for a button near the bottom of a scrolling list
read as the press doing nothing at all. The answer is a `CheckAnswer` per spec now
(`InstalledPane`'s `checked`): *Up to date* or *Could not check* on the row itself, a toast
beside it, and for a newer commit the button becomes `Update to v…` holding the preview it
was found with, so cancelling the confirmation neither loses the answer nor asks GitHub twice.
Which rows get it is `defaults.ts#updateAddress`, not `isPinned`: vendoring swaps a default's
spec for `builtin:paint`, which is not pinned, so the one button that moves a plugin forward
appeared on every row **except** the ones the editor ships — and only in builds that skipped
vendoring, making the button's presence a fact about the packaging rather than the plugin.
`BUILTIN_REPLACES` holds the spec each bundled copy was built from, which is the address to
ask; a bundled plugin is still asked for nothing until the press. The comparison is by
**commit** (`host.ts#checkForUpdate`), because comparing spec strings called every
tag-pinned install out of date for ever — a tag is never spelt like the hash a check
resolves — which would have had all five defaults offering an update to the code they were
already running; a hash-pinned spec answers for itself, a tag costs one more request, and an
unresolvable ref falls back to the spec comparison. Updating a bundled default installs the
remote pinned spec, which `effectiveInstalls` folds over the default and lets win (that rule
was always there and had no button to reach it), at the cost of the plugin becoming an
ordinary fetch at startup — which `ConfirmPluginDialog` says in place of its "replacing
<commit>" line — so a default whose row spec is no longer the shipped one grows a **Revert**
button: it drops the stored row and `usePlugins` activates the bundled copy again.
`pluginRuntimesAtom` is status/manifest/error per
spec; `usePlugins` (in `App`) keeps the two in step, idempotently per spec. Only
`activatePlugin` used to write that atom, so a listed-but-off plugin was a bare spec in
Manage Plugins until you enabled it — `describePlugin` is the other half:
`resolvePlugin(..., { entry: false })` fetches the one `plugin.json` (no entry probe, no
code, no `import()`) and fills in name/version/description/icon without touching `status`
or `error`, so a plugin the network cannot describe is still merely *off*. One attempt per
spec per store (`forgetDescription`, which `reloadPlugin` calls, asks again); the dialog
triggers it for every row with no manifest, and `pluginManifestCacheAtom`
(`scmjs.plugin-manifests`, built-ins excluded — nothing to fetch and their icon URLs are
build-hashed) renders the next visit from storage while the refresh runs. `PluginRuntime.describing`
and `status: "loading"` both spin the row's badge (`statusLabel`), since a row that
silently rewrites itself when a fetch lands reads as a glitch. Contribution registries
`pluginMenuItemsAtom` / `pluginContextItemsAtom` / `pluginHotkeysAtom` are read by `MenuBar`
(`withPluginItems`, path `"File/Import"` → that submenu after a separator; a `Plugins` menu holds
Manage Plugins…), `MapViewport` and `TerrainPalette` (`plugins/contextMenu.ts#pluginContextRows`,
surfaces `viewport` / `terrainPalette`, the palette got a Radix ContextMenu of its own for this) and
`useHotkeys` (plugin combos first, never while typing). `PluginDialogs.tsx`: Manage Plugins, and
`PluginDialog` — the `DialogFrame` a plugin's `ui.dialog(spec)` mounts plain DOM into (host element
in state, Radix portal timing). `npm run build:plugin-types` bundles the contract into one
gitignored `plugin-api/index.d.ts` and `npm run publish:plugin-types` pushes it to
`github.com/scm-js/plugin-api`, which every plugin repository takes as a devDependency. There is no sandbox: a plugin runs with the page's privileges, and the dialog says so.

`plugins/registry.ts` is Plugins ▸ **Browse Plugins…** (the same dialog, `payload.tab`):
`DEFAULT_REGISTRIES` (`defaults.ts`) plus `userRegistriesAtom` name JSON indexes —
`github.com/scm-js/registry`, generated by an Action from the organisation's repositories
named `plugin-…` *or* carrying the `scmjs` + `plugin` topics (either signal is enough, so listing
is opt-out and the registry's `exclude` list is what holds a repository back) and each plugin's
own `plugin.json` at its newest semver tag (untagged falls back to the default branch), hourly
and on a `repository_dispatch` each plugin repository sends when it changes — which
`parseRegistry` reads into `RegistryEntry`s
(spec canonicalised through `canonicalSpec(parseSpec(...))` so rows match the installed list,
unusable entries dropped and counted), `searchRegistry` ranks and `loadRegistry` caches in
`registryCacheAtom` (`REGISTRY_MAX_AGE` an hour, `registryStateAtom` per-URL status; a failed
refresh keeps the cached list rather than emptying the browser). Nearly every listed plugin is
one the editor already has — the defaults are published from the same repositories — so the pane
splits the results with `groupByInstall` (available first, under headings) behind an All / Not
installed / Installed filter carrying each count, and a row shows its state three ways: the
`.browse-row.is-*` left accent, the one action that fits it (Install / Turn on / Manage, which
switches to the Installed tab and flashes the row through `InstalledPane`'s `focus`) and a
`.plugin-here` line. An entry is only a *spec*:
Install goes through the ordinary `inspectPlugin` → `ConfirmPluginDialog` → `installPlugin`
path, so the manifest is read from the plugin and the pin resolved at install time — a
registry decides what is listed, never what is trusted. `clearStoredDataAtom` resets both
atoms; `.listbox .plugin-row` is shared by the Installed, Browse and Sources lists.
The list is the registries' entries **plus** `registry.ts#unlistedInstalls` — a row per
installed plugin no registry carries, built from the manifest in `pluginRuntimesAtom`,
badged `not listed` and matched on `pluginKey` (passed in, so the module stays free of the
defaults) so a pinned or bundled install is not added beside the entry it is a version of.
Browse is read as the list of plugins there *are*, so a plugin installed from its own
address — or one a registry stopped listing, which is what an `exclude` in
`scm-js/registry`'s `plugins.json` does — went missing from the only place it was looked
for while running perfectly well under Installed. Nothing installed can fall out of the
list now, whatever a registry says, and `BrowseRow` takes the resolved `icon` so those
rows draw the plugin's own.

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
positions kept per plugin + title for the session, opens top-right) — hotkeys keep working since
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
what it found), `api.data` (the decoded `.dat` tables off `peekUnitAssets`), **`api.consts`**
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
The `"document"` event carries a `DocumentEvent { reason, fileName }` (`host.ts#documentEvent` over
`documentChangeAtom`, which `loadDocumentAtom` — `reason` on `LoadedDocument`, `"open"` by default, `"new"`
from File ▸ New, `"replace"` from `replaceScenarioAtom` — and `closeDocumentAtom` write); the other events
carry nothing. Events are notifications in activation order and never intercept; a listener that rewrites
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
takes the button's word (the AI plugin's is *Stop*, since Cancel in a dialog means leaving
it) and `statusLine.set` takes a `Node` in place of the text (a failure line that carries
a link to the settings that would fix it). scmscx.com is the worked example for the kit;
the AI plugin's `Runner` (`ui.ts` there) is a status line with an elapsed clock and a
reasoning fold around it. `base.css` gained `[hidden] { display: none !important }` in
the same pass: `.btn` is `inline-flex`, an author rule that beat the browser's own
`[hidden]`, so the status line's Cancel — and every plugin button hidden with
`el.hidden = true`, which is what plain DOM reaches for — stayed on screen after the
work ended. Nothing here tests the widgets' DOM: the test environment is node, and a
DOM test runner is a dependency the repository does not carry.

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
conveniences the AI plugin asked for: `document.history()` peeks at both stacks' labels and depths,
`terrain.terrainAt(tx, ty)` answers a terrain id for any tile (flat group, else the ISOM diamond via
`isom.ts#isomTerrainAt`, which resolves a cliff row to a joined terrain through its soft links), and
`PlacementVerdict.reason` (`placement.ts#placementReason`, shared with the Units layer's status line) says the
problem in words.

**AI** (`github.com/scm-js/plugin-ai`, not a default) and its server (`github.com/scm-js/ai-server`, Fastify +
Caddy + Postgres, one image on GHCR) are the LLM tooling: the server holds the Anthropic key, the prompt recipes, the
access rules (tokens, per-IP and per-token budgets, bring-your-own-key, and *accounts*: a free trial session per
browser, Discord sign-in through a provider interface, roles with a weekly allowance or `unlimited`, purchased credit
through Stripe Checkout, an account page, and `/v1/admin/*` for the site — the plugin's default access mode talks to
`api.scmjs.dev` and needs no setup) and never any game data; the plugin gathers facts
(terrain vocabulary, statistics, a `renderImage` PNG, the Trigger Script plugin's `declarations` command) and applies what comes back
through the ordinary API — a map plan is a coarse legend grid turned into `paintIsom` strokes plus Melee Wizard's
base geometry (`layout.ts` vendored there), triggers come back as script and go through the Trigger Script
plugin's `compile` → repair rounds → `build` commands (`commands.has` first; the plugin says so when it is off), the assistant panel is a tool-use loop whose tools run in the plugin. `protocol.ts` is the
wire contract, kept identical in both repositories. The editor knows nothing of it beyond the three host additions
above. The 2026-09-05 pass made it the worked example for the "built-in feel" surfaces (`dock: "right"`,
`ui.statusItem`, `ui.dialogSlot`, `view.flash`, plus an `ui.overlay` for a running tool call's footprint —
`intent.ts` there), streamed the `agent` recipe (text `delta`s and a `tool_use` event the moment the model names a
tool; the server's system blocks moved to the one-hour cache in `claude.ts#systemBlocks`), and added the Scenario
workflow: an `ums-design` recipe (the design document, checked server-side against the toolkit catalogue the
request carries) executed by `dialogs/scenario.ts` through `map-plan`, the players/forces update, the plugin's
**toolkit** (`ums.ts`: ~20 trigger-system kinds — hyper, spawn, kill-to-cash, waves, lives, shop, last-standing… —
built by code into text triggers the editor parses; the assistant reaches it through `ums_build` and the genre
guides in `guides.ts` through `guide`) and the `triggers` recipe for `custom` systems. Check Map's scenario checks
(`validate.ts#umsIssues`) are the editor-side half.

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

### Game data sources, extraction, desktop, releases (`src/gamedata/`, `desktop/`, `.github/workflows/build.yml`)

Both loaders fetch every file through `gamedata/source.ts#fetchAsset`, which resolves the session's
`AssetSource` once (`resolveAssetSource`, shared promise; `resetAssetSource` / `setAssetSource` after
Help ▸ Game Data… changes it) by running `locateGameData(deps)` — a pure chain over injected probes
(`tests/gamedata.test.ts` pins the order): **bundled** (`BASE_URL` + `tileset/manifest.json` or
`unit/manifest.json` answers JSON — a dev server answers index.html with 200, hence the parse), **stored**
(`store.ts`: the OPFS copy under `gamedata/` with a `stamp.json` written last; a memory `Map` when there is
no OPFS), **desktop** (`window.scmjsDesktop.gameData.locate()`, then it is bundled again — the source carries
`desktop: true`), **none**. There is deliberately no fifth step: the configured web address
(`VITE_GAME_DATA_URL` and a `gameDataUrl` preference over it, serving an extracted tree or the two archives)
was **removed** along with `installFromUrl`, the `remote` source kind and the CI variable — nothing is
fetched from an address the user did not name, and the chain running out and asking is easier to explain
than four ways of not being asked. The preload's first task is the resolution (progress on the splash for a
desktop extraction); `usePreload` mirrors the source into `gameDataSourceAtom` and opens the `gameData`
dialog with `{ auto: true }` when it ends at none. After an install the dialog calls `retryFailedParts`
(drops the `LazyFiles` nulls) / `retryTilesetParts` and bumps `gameDataRevisionAtom`, which `useTileset` /
`useUnitAssets` depend on — that is how a map already open picks the graphics up. It also calls
`useMapFileActions.ts#relayBlankTerrain`: the startup map was laid by `flatTerrain` with no CV5 to pick
variations from, so every pair took variation 0 — invisible under flat colours, and one megatile repeated
across the map the moment the graphics land. `newMapInto` records that fill in `blankFillAtom`
(`gameDataAtoms.ts`, cleared by `loadDocumentAtom` / `closeDocumentAtom`) and the relay lays the tiles and
ISOM again in place, leaving the map unmodified; it refuses once the map has been edited or has a path, so
a file's own terrain is never touched. `tests/blank-fill.test.ts`.

**Data sets** (`gamedata/profiles.ts`, `services/gameData.ts`): the editor draws from one set of
game files at a time, and a `GameDataProfile` (id + name) names it — `DEFAULT_PROFILE` is the game's
own; any other is a mod's, the same formats with files replaced, installed under its id
(`installDataSet`: the game's two archives required, the mod's archives and loose files laid over
them through `readerFor`'s overlay; `splitPickedFiles` turns a picked folder into that) and stored
under `gamedata-profiles/<id>/` beside the game's `gamedata/` (`store.ts#profileDir`, every store
function takes the id, `listStoredCopies`). The choice is `scmjs.gameData` (`gameDataProfileAtom`,
in `STORED_RESETS`; the resolver reads the key itself through `activeProfileId` since it runs
outside the store) and the chain asks for the chosen set's copy first, falling back to the game's
own with a note in `tried`. `AssetSource.profile` says which set answered. Switching is
`switchDataSet`: everything decoded describes the old files under the same ids, so it drops the lot
(`resetUnitAssets`, `releaseAllTilesets`, `clearFrameCache`, `clearComposedImages`), resolves again
and bumps `gameDataRevisionAtom` — `useUnitAssets` now re-reads `peekUnitAssets` on every bump
rather than keeping what it had. `api.gameData` and the `"gameData"` event are the plugin side
(`host.ts#gameDataApi`). A data set is a name over files in the game's formats: the table sizes,
tileset formats and CHK layouts are the game's, and a mod that extends them is out of scope.

**Names from the data** (`data/gameNames.ts`): `stat_txt.tbl` (entries 0–227 the unit types as
`Name\0Subname\0Category`, read by `decodeTblEntries`; the `label` columns of `weapons.dat` /
`upgrades.dat` / `techdata.dat` point into it, now decoded) gives the game's own names; the editor's
tables are StarEdit's. The rule is per entry: the data's name where it differs from what the
game's own data says for that id, StarEdit's elsewhere — so Blizzard's files change nothing and a
mod's renames show. `GAME_*` there are the game's names where they differ from StarEdit's,
generated from the real files and pinned in `tests/names.test.ts`; `namesFromAssets` builds a
`LoadedNames` (null per slot where the table stands) that `units/load.ts` installs through
`installNames` when the tables arrive, and `unitName` / `weaponName` / `upgradeName` / `techName`
read it first, so every caller follows. `UNIT_NAMES` stays the text trigger format's vocabulary;
`unitByName` accepts the loaded names too. Lists built once at import were the trap here: the
palette's and the settings dialogs' item lists are built per render or on the revision now.
(`UPGRADE_NAMES` had Plasma Shields at 7 where `upgrades.dat` has it at 15; fixed, with
`UPGRADE_RACE`.)

`GameDataDialog.tsx` shows one thing at a time: with data it is a status line ("Now") and Remove copy;
without, the status line is replaced by a caution notice (`.gd-alert`) saying what the editor cannot draw,
because flat colours and coloured markers read as broken rather than unconfigured, and the two routes are
weighted rather than listed — the download is a card (`.gd-card`) carrying the one large button
(`.gd-cta`), the user's own archives the quieter `.gd-alt` under it, and the footer says "Continue without
graphics" so leaving is a choice rather than a dismissal. **Download from Blizzard** (`install.ts#installFromZipUrl` over `BLIZZARD_ZIP_URL`) reads
Blizzard's own free StarEdit package — which carries trimmed StarDat/BrooDat that extract to the same 931
files a 1.16 install does, byte for byte, provided the `patch_rt.mpq` in the same zip is left alone (it
changes seven tables). `zip.ts` is the pure part: a `RangeReader` (`httpRangeReader` over `fetch`, with an
`onProgress` that streams so an 82 MB member does not freeze the bar), `readZipDirectory` (EOCD then the
central directory, Zip64 reported rather than misread), `readZipMember` (the *local* header is measured
rather than trusting the directory's copy of its extra field, then `DecompressionStream("deflate-raw")`)
and `findMembers` (by base name, ignoring folder and case). Only 82 MB of the 101 MB zip is transferred and
no zip library is needed; `tests/zip.test.ts` drives it all over a zip built in the test. It goes through
`github.com/scm-js/cloudflare-blizzard-forwarder`, a Cloudflare Worker at `gamedata.scmjs.dev` that adds
the CORS header and forwards ranges, because `download.blizzard.com` serves a `*.cloudfront.net`
certificate, plain HTTP is mixed content, and no route there sends `Access-Control-Allow-Origin`; the
desktop uses the same address, its renderer being an ordinary page. The second route is **files / folder**
(`installFromFiles` → `extract.worker.ts`, which writes the OPFS copy with sync access handles — the one
write path every browser has, worker-only — or posts the files back for `keepInMemory`) with the desktop's
search / folder picker beside it. The desktop's Remove resolves again with `{ search: false }` so it does
not extract the same files straight back.

`extract.ts` is the extraction itself, pure and dependency-free apart from `iscript.ts` (`.ts` import
specifiers on purpose: Node's type stripping runs it), producing the exact bytes and manifests the old
scripts wrote — `scripts/extract-*.mjs` are thin wrappers now, `archives.ts` is the mopaq side. Never
redistribute what it produces: the forwarder passes Blizzard's own download through and keeps nothing, and
no build ships game data or an address to fetch it from.

`desktop/main.ts` (Electron, bundled by `desktop/vite.config.ts` into `desktop/dist/*.cjs`, `ssr: true` +
`noExternal` so mopaq and the shared extraction ride along, `publicDir: false`) serves `dist/` under
`app://scmjs/` and the game-data prefixes from `userData/gamedata` first, so the renderer's bundled probe
finds an extraction (which is also why `usePreload` skips `warmRemainingTilesets` on the desktop —
the bytes are on local disk already); the window's size, position and maximized state are remembered in
`userData/window.json` (`readWindowState` / `watchWindowState`, saved 500 ms after the last move or
resize and again on close; an off-screen position is dropped, and a first run with no file opens
maximized) and it is shown on `ready-to-show`, so nothing flashes at the unmaximized size, with
`dist/icon.png` as its icon; a close while the renderer says the map has unsaved changes is held
back and handed to the editor (`guardClose` / `closeIpc`, `src/hooks/useCloseGuard.ts`), with
`before-quit` remembering that the close came from a quit so the answer quits rather than closing
one window; the search order is AppImage dir /
next to the executable / userData / env / the platform's install paths (so two archives dropped beside
the app are found). `preload.ts` is
the bridge, typed in `src/gamedata/desktop.ts`; `tsconfig.desktop.json` type-checks it. `electron-builder.yml`
packages `dist/` + `desktop/dist/` only (never `node_modules`, never `dist/{tileset,arr,unit,game,scripts}`),
unsigned, with `public/icon.png` as every platform's icon, `electronLanguages: [en-US]` (the 55
Chromium locales were 50 MB unpacked and 12 MB of the zip; the editor has no translations) and
`spellcheck: false` in the window's `webPreferences`; Windows gets an NSIS installer and a **zip**,
never electron-builder's `portable` target, whose SFX re-extracts the whole app into `%TEMP%` on every
launch and can only cover the wait with a static `.bmp` painted over the desktop (`docs/development.md`) — that file, `public/favicon.svg` and
`components/ui/AppLogo.tsx` are one drawing: the splash's wireframe globe (`splash/starfield.ts`) projected
once at a fixed angle and flattened to four paths grouped by depth, in violet rather than the splash's
pink. `npm run build:desktop` is `scripts/build-desktop.mjs`: `build --mode desktop` (the mode no longer changes anything —
it used to blank the game-data address) + the main bundle + electron-builder, where its arguments pick the packaging
step's platform, architecture and targets (`-- win nsis`, `-- linux AppImage arm64`, `-- --dir`
for an unpacked check, `--skip-web` / `--skip-main` to reuse the bundles on disk, `--` for
electron-builder verbatim); with no arguments it is this OS on `electron-builder.yml`'s targets, which
is what CI runs. The workflow has three channels — `ci` (every push to main: lint, tests and the web
bundle built and thrown away, so a broken bundle fails the push that broke it; **nothing deployed,
no installers and no release**), `nightly` (a daily cron, skipped when main has not moved: the
installers on ONE rolling prerelease whose `nightly` tag is force-moved and whose assets are
replaced with `gh release upload --clobber`, never deleted and recreated) and `v*` tags (permanent
numbered releases, the only ones that accumulate).
**Both hosted builds are releases**: the `pages` job serves the *tag* at `editor.scmjs.dev` (it was
main's HEAD, which was the one artifact whose version nobody could get back to), and the
`nightly-site` job unpacks the nightly's own web zip — never a second build — onto
`nightly.editor.scmjs.dev` as one force-pushed orphan commit on `scm-js/nightly`'s `gh-pages` branch,
carrying the `CNAME` a branch-served Pages site keeps its domain in. Rolling the site back is
dispatching build.yml on an older tag. They are separate origins deliberately: OPFS and every
`scmjs.` key are per origin, so the nightly asks for the game data again and keeps its own
preferences, plugins and recents rather than writing a stored shape the stable build reads back.
Repository variables `PAGES_BASE` (`/` for a custom domain; when it is not `/` the `web` job builds
a second time for Pages) and `NIGHTLY_DOMAIN`, secret `NIGHTLY_PAT` (Contents: write on
`<owner>/nightly`, the `PLUGIN_API_PAT` shape); the nightly deploy skips with a notice without them.
A `v*` tag also pushes the **container image**: the `image` job downloads the `web` job's own zip,
unzips it and builds `docker/Dockerfile` (nginx + `docker/nginx.conf`, no `RUN` step, so
`linux/amd64,linux/arm64` is one buildx manifest and needs no QEMU) to `ghcr.io/<repo>` as `latest`,
the version and the moving `X.Y` / `X`; nightlies publish none, since `latest` is what a `docker run`
takes without asking. `.dockerignore` cuts `dist/{tileset,arr,unit,game,scripts}` out of the context
and the nginx config 404s those paths, so no image can carry Blizzard's data and a container starts at
step 4 of the resolver — mounting an extracted tree over them is how to serve your own.
`npm run build:image` is the local build, and `release.yml` builds and *serves* the image in its
pre-flight, before it tags.
The download buttons on the site are plain hrefs to
`/releases/latest/download/<asset>`, which GitHub redirects to the newest **non-prerelease**
release — so the nightly is invisible to them and nothing needs updating when a version ships;
that redirect resolves a fixed file name, which is why `electron-builder.yml`'s `artifactName`
carries no version (`scmJS-windows-x64-setup.exe`, `scmJS-linux-x86_64.AppImage`, …). Its
`publish:` block is what makes electron-builder write `latest*.yml` beside the installers and
bake `app-update.yml` into the asar — the feed the in-app updater reads; `--publish never` still
means it uploads nothing itself. The version is
`package.json`'s and nothing hardcodes it: `vite.config.ts` defines `__APP_VERSION__`,
`src/version.ts` is what the splash and the About dialog read, CI `npm version`s the field
from the tag (or `<package.json version>-nightly.<date>.<run number>` on main — the run number,
not the SHA, because semver compares alphanumeric identifiers lexically) before building, and
electron-builder writes it into `latest*.yml`. A release is cut by the **Release** workflow
(`.github/workflows/release.yml`, manual dispatch), never by hand: it refuses to run off main,
over an existing tag, or backwards past the last release, runs lint/tests/build *before*
writing anything, then commits the release version (the whole diff is `"version"` in
package.json and the lock; skipped when it already says it) and annotates `vX.Y.Z` on that
commit. It then **dispatches** build.yml on the tag — one dispatch is the whole release, hosted
editor included — because a push made with `GITHUB_TOKEN` starts no workflow run while
`workflow_dispatch` through the API is the exception. A tagged release's notes are `docs/releases/<version>.md` — committed on main
beforehand, read by build.yml's release job out of the tag's own tree (the full three-part
version names it, so cutting `0.3` reads `0.3.0.md`) — or the Release form's `notes` input,
which wins over the file and is passed on as a build.yml dispatch input, so it lives only in
the release; either goes above GitHub's `--generate-notes` list, and with neither the release
carries that list alone. Nothing is required: the pre-flight prints what it found (a dry run
shows the release's body) and says so as a notice when there is nothing.

There is deliberately **no** step moving package.json on to the next version:
`scripts/next-version.mjs` derives what a nightly is called from the release tags instead — a
patch bump of the newest one (`tests/next-version.test.ts`; no tags means nothing has shipped,
so package.json stands; a prerelease tag answers with its release version). A nightly must
sort above the release it follows, or the updater offers a downgrade it cannot install, and
below the release that comes next, or it offers nothing until that version ships; a patch bump
is the only choice that can never be too high, so nothing has to be decided in advance about
whether the next release is 0.9.0 or 1.0.0. That leaves package.json meaning the **last
released version**, which is true without anyone maintaining it.

### The documentation site (`scripts/build-docs.mjs`, `scripts/lib/docs/`)

`docs.scmjs.dev` is `npm run build:docs`, deployed by build.yml's `docs` job onto
`scm-js/docs`'s `gh-pages` branch — one force-pushed orphan commit with a `CNAME`, the
`nightly-site` shape, behind the `DOCS_PAT` secret and the `DOCS_DOMAIN` variable and
skipped with a notice without them. It is a **stable-channel** job: the hosted editor, the
installers, the notes and the docs are one tag, and every page's footer carries the
version. (`@scm-js/plugin-api` still publishes from main, so a plugin author on the newest
package can be one release ahead of the reference; the API is additive, so what they see
is a member missing from these pages rather than one that behaves differently.)

Two halves, and only the second is generated in any interesting sense. The guides are
`README.md` and `docs/*.md` split at their `##` headings, one page each, with the `###`
beneath as the page's contents list (`markdown.mjs`, `marked`) — **nothing writes prose**,
because a generator that did would be a fifth document to keep current against the four
the top of this file names. `site.mjs` is the URL model and, with it, the link rewriter
that is the whole reason those documents keep working here: they are written to be read as
GitHub blobs, so `docs/plugins.md` becomes a page, a bare `#fragment` finds whichever page
that heading landed on, and `LICENSE` or `../../releases` goes back to the repository.

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

`ATTRIBUTION.md` is the provenance record (audited 2026-09-04) and `scripts/lib/notices.mjs`
its mechanical half: the `scmjs-notices` plugin in `vite.config.ts` emits
`dist/THIRD-PARTY-NOTICES.txt` from `package.json`'s runtime `dependencies` plus the
vendored `plugins/*/LICENSE`, failing the build on a dependency with no license file, so
the web zip, the installers and the image carry every bundled license (TypeScript's
Apache-2.0 text above all). Adding a runtime dependency needs no edit there; adding an
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

### In-app updates (`desktop/updater.ts`, `src/editor/updates.ts`)

Desktop only. `desktop/updater.ts` is `electron-updater` over the releases the workflow publishes
(required lazily — Rollup keeps it behind a memoised factory — since `main.ts` is on the critical
path to the first frame); `editor/updates.ts` is the pure state machine and every string shown
(`stateFrom`, `headline`, `canDownload`, `shouldCheckOnStart`, `tests/updates.test.ts`);
`atoms/updateAtoms.ts` holds one answer for the whole app; `hooks/useUpdateCheck.ts` is the startup
check and the single subscription to the updater's progress/downloaded/error events;
`UpdateDialog.tsx` is Help ▸ Check for Updates…. `Preferences.updates` is `{ checkOnStart, nightly }`,
the row shown only when `isDesktop()`.

Finding an update raises a **toast**, not a dialog — the check lands seconds after launch and two
dialogs already open themselves then (Game Data, the Repair plugin), so a third would queue behind
them. `Toast.action` (the one button a toast may carry) opens the same dialog the Help item does, and
the toast has no `ttl` so it waits rather than expiring behind the splash. `autoDownload` is false
and installing goes through `guardedAction(store, …, "quit")` — the window close button's gate —
before `quitAndInstall`.

`UpdateSupport` keeps *checking* and *installing* apart, and both answers come from the updater
rather than from `process.platform`: `support.check` is `isUpdaterActive()`, because `AppImageUpdater`
(chosen for any Linux build with no `package-type` file) refuses when `APPIMAGE` is unset and then
`checkForUpdates()` resolves **null** instead of throwing — reading that as "up to date" is the lie
`check()` maps to `unsupported`. `support.install` is false only on macOS (Squirrel.Mac verifies the
code signature; unsigned cannot apply an update), where the dialog offers the release page instead of
a progress bar. `message()` trims electron-updater's errors, which otherwise carry the whole HTTP
response — headers and `Set-Cookie` — into the dialog.

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
and says so. A decoded tileset is the raw files plus a ~20 MB atlas canvas, and every reader asks
for the *document's* tileset, so `useTileset` calls `releaseTileset` on the one the map just left
(on the transition, not a sweep — a tileset a dialog is loading ahead of a change is never taken
away); a released tileset is fetched again if a later map needs it. `tests/tileset-cache.test.ts`.

The atlas is also why the New Scenario dialog cannot go through `getTileset`: it pictures
all eight tilesets at once, and eight atlases is more memory than the rest of the editor.
`loadTilesetGraphics(name)` is the way round it — the four files the megatile decoder needs,
decoded, *outside* the cache (an already loaded tileset is handed back rather than fetched
again) — and `preview.ts` paints from one: `renderTerrainPatch(tileset, terrain, cols, rows)`
is a `cols`x`rows` block of flat ground as RGBA, laid with `terrain.ts#flatTiles` (the MTXM
half of `flatTerrain`, split out for this) so the picture is the fill a new map really gets.
`hooks/useTilesetPreview.ts` holds the caches: every tileset's card thumbnail and terrain
swatches, rendered one tileset at a time and kept as pixels while the tileset itself is
dropped, plus `useTilesetGraphics` for the selected tileset, held only while the dialog is
mounted so the map preview can be redrawn at any terrain and size.
`components/dialogs/TerrainPreview.tsx` is the two canvases (`PatchThumb`, `MapPreview` —
the map at its own scale with the start locations `idealStarts` would put on it); without
graphics both fall back to the tileset's flat reference colour, as the viewport does.
`tests/tileset-preview.test.ts`.

### Units (`src/formats/dat/`, `src/formats/units/`, `src/editor/units.ts`, `src/hooks/useUnitTools.ts`)

`dat.ts` decodes only the fields the editor needs from the Brood War `arr\*.dat` layout (struct of
arrays; placement box / add-on offset / extents are arrays of structs — the layout is pinned by
`tests/dat.test.ts` against the real file). `units/load.ts` fetches the tables once (`getUnitAssets` /
`peekUnitAssets`) and GRPs lazily (`requestGrp`, `onGrpLoaded` fires so canvases repaint);
`units/sprites.ts` caches one canvas per (image, frame, colour row, tileset palette) in an
`LruCache` (`src/lib/lru.ts`, budgeted in pixel bytes — `FRAME_CACHE_BUDGET`, 64 MB — since
frames range from 8² to 256²; evicted canvases are zero-sized so the bitmap goes at once;
`frameCacheUsage()` reads it; `tests/lru.test.ts`). Team colour =
`tunit.pcx` row `playerColorIndex(scn.playerColors, owner)` (COLR-aware) remapping palette indices
8–15, painted through the *tileset* palette — so sprites need the tileset loaded too. `unitName(id)` and
`UNIT_GROUPS` (ids, not names) live in `src/data/units.ts`; `activeUnitAtom` is a units.dat id.
The special ids have one home each and nothing else may spell them out: `data/units.ts#START_LOCATION`
is 214 (`editor/placement.ts`, `documentAtoms`'s `START_LOCATION_UNIT` and the bare ids in
`services/preload.ts` / `editor/statistics.ts` were four more copies of it) and `editor/units.ts` owns
`MINERAL_FIELD_IDS` / `VESPENE_GEYSER` / `DEFAULT_MINERALS` / `DEFAULT_GAS` beside `isResource`. Plugins
get the lot through `api.consts` rather than writing the numbers again.

Edits are `UnitChange { index, before, after }` lists (insert / remove / replace, removals highest index
first) carried in `HistoryEntry.units`; `applyUnitChanges` marks `UNIT` dirty. `unitsRevisionAtom` is the
repaint trigger for unit changes (the list is mutated in place, like tiles); `selectedUnitsAtom` holds
indices and is cleared by any unit edit/undo. `snapPlacement` is the palette's *Snap to grid*: on, anything
with the Building flag goes on the tile grid by its placement box and everything else on the nearest
tile centre; off, both land at the pointer. It snaps the *destination*, so `moveUnits` brings a unit
that sits off the grid back onto it rather than preserving its offset. `makeUnit` writes
StarEdit-style valid/used masks (see `tests/unit-edit.test.ts`). The viewport draws in `drawOrder` (ground by y, then flyers) and falls back to
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

What paints *first* is a separate problem, and a desktop one: `desktop/main.ts` creates the window with
`show: false` and shows it on `ready-to-show`, which is the renderer's first paint — so until something
paints there is no window at all, and the whole launch reads as a hang followed by the editor appearing
at once. Two things move that frame earlier. `index.html` carries the **boot splash**: the splash card as
plain markup with its own inline styles, scoped to `#boot-splash` and owing nothing to `splash.css`
(which in `npm run dev` does not exist until the bundle runs, and would leave the markup as unstyled
text), so it paints on the HTML alone — the version line's `%APP_VERSION_SHORT%` is filled in by the
`scmjs-html-version` plugin in `vite.config.ts`, since Vite substitutes `%…%` in HTML only for env vars. It is that card in its initial state — same geometry, same "Initializing renderer" line, the
canvas simply unpainted — so the handover is invisible; change it and `splash.css` together.
`SplashScreen` removes it in a **layout** effect (`splash/bootSplash.ts`, before the frame that would
show both) and `App` removes it on the `?nosplash` path, where the real splash never mounts. And `App`
**mounts the chrome two frames late** (`chrome` state): MenuBar, ToolBar, the docks, `MapViewport` and
`DialogHost` in the first commit is well over a thousand renders, which held the first paint behind it —
now the splash paints alone and that commit lands while it is already animating. The veil carries
`.splash-veil.solid` until the chrome is there (nothing behind it to blur yet). Measured on Linux, the
window went from ~420 ms after launch to ~200 ms, and the frame it shows is the splash rather than an
empty rectangle. `showWhenReady` in `desktop/main.ts` is what shows it. The saved maximized state is applied
**there**, not at creation: on Windows `maximize()` is a `ShowWindow` call, so maximizing a
`show: false` window shows it — which used to put a black window on screen at 140 ms and
leave every signal below with nothing to do. Neither platform applies the maximize
synchronously, though, so a window that is going to be maximized is *created* at the work area
of the display it opens on (`openingBounds`) — otherwise the first composited frame was the
window at its created size in a corner, flashing to full screen a moment later — and
`keepRestoreBounds` holds the rectangle the user left behind, which `saveWindowState` writes
while the window is still maximized and the first "restore down" puts it back to. The maximize
itself lands `MAXIMIZE_AFTER_MS` after the window is up rather than as part of showing it, so
the frame the window appears with is one the renderer painted for the size it has (a maximize
in the same frame resized the renderer as the window appeared, leaving the app drawn small in
the corner until the next frame); `traceBounds` puts the geometry of each step in `startup.log`
next to a probe of the renderer's own `innerWidth`. It also does not trust `ready-to-show` alone — a hidden window is not guaranteed to be composited at all (Windows),
and waiting only for that paint meant seconds of no window and then an editor whose splash
had already run behind nothing. The signals are, in order: the paint, `dom-ready` +
`SHOW_AFTER_DOM_MS` (the boot splash is that markup, and the window's `backgroundColor` is
its backdrop), and `SHOW_LATEST_MS` regardless. The renderer stopped depending on any of it:
`SplashScreen` runs its MIN/MAX dwell from the moment the page is **visible**
(`document.visibilityState`), not from mount, since a page in a hidden window neither
animates — rAF does not run in one, which is also why `App`'s two-frame chrome deferral has
a timer behind it — nor is seen. The last launch's milestones are always written to
`<userData>/startup.log` (`%APPDATA%\scm-js` on Windows — Electron takes the folder from
`package.json`'s `name`, not electron-builder's `productName`; `SCMJS_TRACE=1` echoes them to
stdout too), which is how "it hung and then opened" is told apart from a slow exe unpack, a
virus scanner, or the launch path: a Windows build run from `\\wsl.localhost\…` takes 628 ms
to evaluate its main script and never reaches `dom-ready`, so copy `release/win-unpacked` to
`/mnt/c/…` before running it (`docs/development.md`).

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
  and a `REGISTRY` of `React.lazy` components in `src/components/dialogs/DialogHost.tsx`, one
  `import()` per dialog module (dialogs sharing a file share a chunk, each entry rendered in its own
  `Suspense`). Adding a dialog means touching both. The dialog modules must not be imported
  statically from anything on the startup path or Vite folds them back into the main chunk (Vite
  says so: `INEFFECTIVE_DYNAMIC_IMPORT`) — which is why `PluginIconView` lives in `components/ui/`,
  not in `PluginDialogs.tsx`. Splitting them took the main chunk from 1140 KB to 537 KB.
- `MapViewport.tsx` is a single canvas that draws terrain (atlas or fallback colours), overlays
  (grid, locations, start locations, brush ghost) and handles all mouse input for the active layer.
  The terrain blits go into a cached layer canvas (`TerrainLayer`, `terrainLayerRef`) that `draw`
  copies with one `drawImage`: it is redrawn whole when the scroll, size, zoom, tiles, revisions,
  tileset or document change, and only its cycling tiles when the water step moves, so a unit
  animation frame or a hover ghost no longer re-blits every visible megatile. Anything that changes
  what is under the ground must already bump `terrainRevisionAtom` / `doodadsRevisionAtom` (or
  replace the scenario), which is the same contract the repaint itself relies on.
  Every repaint request — a pointer move, a scroll, the `[size, draw]` effect that fires
  whenever `draw`'s identity changes — goes through `scheduleDraw()`, which books one
  `requestAnimationFrame` and coalesces the rest, so a burst of events costs one paint and it
  lands immediately before the browser's own. Call it rather than `draw()` from anything
  event- or render-driven; `draw()` itself is only run by the frame and by the animation loop
  (which serves a booked request instead of painting twice). The object layers' ghosts follow
  the pointer in pixels, so `onMove` schedules a paint on every move there — a terrain or fog
  brush is tile-shaped and only repaints on the crossings.
- `src/editor/platform.ts` is what the chrome says about the shell it is in: `isDesktop()`
  (the Electron bridge is there) and `hostTerms()`, which answers the words — "browser" /
  "app", "this browser" / "this app", "Browser" / "Application" for a heading, and where a
  download lands. The desktop build is the same bundle in a Chromium window, so every
  "this browser" in the copy read wrong there; anything user-visible that names the shell
  goes through it (Preferences ▸ storage's title, the save and export toasts, the plugin
  dialogs' warnings, the sound importer's decoder notes, About). It decides *wording* only
  — what the shell can do is still asked of `desktopBridge()` and the platform APIs.
  `tests/platform.test.ts`.
- `src/hooks/useWindowTitle.ts` keeps `document.title` on the open map — the file name when there is
  one, else the scenario name, with a leading `*` while it is modified, and the plain
  `scmJS — StarCraft Scenario Editor` of `index.html` when nothing is open. Electron mirrors the page
  title into the window title, so the desktop build's title bar and taskbar entry follow it too.
- `src/hooks/useDesktopFiles.ts` is the desktop's "Open with": `desktop/main.ts` holds the single
  instance lock, takes a map path from `argv` / `second-instance` / macOS `open-file`, and sends the
  bytes on `file:open` once the renderer's `files.onOpen` listener says `file:ready`; the hook opens
  them through `guardedAction` like a drop. What sends it one is `fileAssociations` in
  `electron-builder.yml` (`.scm` / `.scx` / `.chk`, one mime type each — electron-builder writes a
  `<mime-type>` block per association into the Linux packages' mime XML and shared-mime-info reads
  only the first of a repeated type): the NSIS installer registers `"$appExe \"%1\""` per extension
  and unregisters on uninstall, the deb / AppImage carry the mime XML and a `MimeType=` desktop entry
  whose `Exec` ends in `%U`, and the macOS bundle gets the `CFBundleDocumentTypes` without which
  Finder routes nothing and `open-file` can never fire. The Windows *zip* registers nothing, as any
  unpacked build does not — dragging a map onto `scmJS.exe` still goes through `argv`.
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
  (`useMapFileActions.ts`, the gate `document.open` / `document.create` share). Electron fires
  `beforeunload` on a window close too but a value returned there cancels it *silently*, which
  is why the browser half is skipped whenever the bridge is there.
- Hotkeys are centralised in `src/hooks/useHotkeys.ts`; file actions (open/save/new, drag-drop) in
  `src/hooks/useMapFileActions.ts` and `src/services/mapIo.ts` (File System Access API with
  `<input>`/download fallbacks).
- CSS is plain, layered in import order `tokens → base → ui → chrome → panels → viewport → dialogs → splash`
  under `src/styles/`; design tokens are CSS variables in `tokens.css`.
