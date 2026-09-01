# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based StarCraft 1 / Brood War map editor (React 19 + Vite + TypeScript + Jotai), modelled on
StarEdit / SCMDraft 2. It opens real `.scm`/`.scx` maps (MPQ archives via `mopaq`), renders terrain from
the game's own tileset graphics, and writes playable archives back. The README is accurate and
detailed on user-facing behaviour (brush modes, tile id round-trip, deep-links) — read it first.

## Commands

```sh
npm run dev            # Vite dev server, http://localhost:5173
npm run build          # tsc -b (type-check) + vite build
npm run lint           # oxlint
npm test               # vitest run (node environment, ~2s)
npm run test:watch
npx vitest run tests/chk.test.ts          # one file
npx vitest run -t "flood fill"            # tests matching a name
npm run extract        # StarDat/BrooDat.mpq → public/tileset, arr (incl. weapons.dat), game, scripts, unit (BrooDat required)
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
the fastest way to reach a specific UI state — see README and `src/hooks/useDevDeepLinks.ts`.

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
- `create.ts` builds a fresh scenario (File ▸ New); it does not yet emit `VCOD`/unit-settings sections,
  so new maps are not loadable by StarCraft. `scenario.isom` is `null` only when the *file* had no
  `ISOM`; `encodeSection` then omits the section rather than writing a zeroed one.
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
both). `unitAvailability` is PUNI, player-major (`puniIndex`). Both are `null` until the dialog first
applies. `setMapVersion` rewrites VER/TYPE and flips `strings.extended` (STR ↔ STRx: both names go
dirty and the inapplicable one encodes to `null`, which `serializeScenario` treats as "drop").
Unit Settings shows dat defaults for a type on "use default" and seeds its row from them when the
tick comes off; `units.dat` now also yields `buildTime`, `armor`, `groundWeapon`/`airWeapon`
(a turreted vehicle's weapons live on its subunit) and `weapons.dat` ships as `assets.weapons`
(optional — an older extraction shows weapon defaults as 0). `tests/settings.test.ts` pins the codecs,
the section choice per revision and byte-for-byte re-encoding against the fixture maps.

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
