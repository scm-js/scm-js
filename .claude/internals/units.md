# Units

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
reports a change and units are on screen. **What it costs per frame** (2026-10-04): `sync` runs
before every paint and `tick` 24 times a second, both over every unit on the map, so both are built
to do nothing when nothing happens. `sync` builds its set of live records only once a record turns up
without a sprite (or the counts differ) — the steady state is one map lookup per unit — and
`updateDamage` returns before any path lookup for a healthy unit with no flames. `tickSprite` counts
the waits down and collects the images whose turn it is into a reused list (a script touches only its
own image and what it spawns, so running them after the countdown is the same as interleaved), and a
sprite with none due skips `settle` altogether. That is only right because `settle` is now
order-independent: it settles the **main image first**, then the rest — a shadow that follows the
main graphic sits *under* it in the stack and used to read last frame's value, which the next
tick's settle put right one frame late; with settle skipped on idle frames it would have stayed
wrong for the whole wait. `tick(view)` still advances every sprite (units placed together pulse
together, and would drift apart if the ones out of sight stood still) but reports a change only for
a sprite standing inside `view`; the viewport passes the visible box plus `UNIT_MARGIN`, the margin
the draw pass culls by, so a light blinking across the map no longer repaints the screen.
`tests/animateSynthetic.test.ts` runs the class on a made-up script with no game files; the change
was also run tick for tick against the previous implementation for 3,000 frames with a seeded
`Math.random` (identical but for the follower lag). Measured in Node on 1,700 units of that script:
`sync` 125 → 30 µs a paint; `tick` 83 → 61 µs when most images are waiting and 274 → 290 µs when
every unit's script runs every few frames — so the interpreter was never the cost, a quarter of a
millisecond either way. What a tick costs is the *repaint* it asks for, which is what `view` cuts.
Damage overlays (image 450/472 + the damage `.lo` slot index — the
22 slots are laid out Terran 0–7, Zerg 8–15, Protoss 16–21 — count from `hitPointsPercent`) are re-evaluated in `sync`; `creategasoverlays` spawns smoke
from the special `.lo`. `sprites.ts#getImageFrame` is the per-(image, frame, flip, colour, tileset)
canvas cache; shadows draw as 50% black, `DrawFunction.Remap` images through the tileset's
`<name>.<ofire|gfire|bfire|bexpl>.pcx` table (column 0, blended "lighter"). Anything that needs the
running game (attacks, sounds, projectile sprites, condition jumps) is a no-op. `tests/iscript.test.ts`
and `tests/animate.test.ts` run against the real files when `public/` is populated.

### Remastered sprites: the 2x pictures (`dat/anim.ts`, `dds.ts`, 2026-10-09)

View ▸ Remastered Graphics (the same switch as the 2x terrain, `tileset.md`) makes
`sprites.ts#getImageFrame` draw from `unit/hd/main_NNN.anim` — the installation's
`HD2/anim/main_NNN.anim`, one per images.dat id — where the data set has one.

- **The file** (measured on the real install, all 780): `ANIM`, u16 version (0x0202 for 2x),
  u16, u16 layer count (7), u16 entries (1), ten 32-byte layer names (`diffuse`, `bright`,
  `teamcolor`, `emissive`, `normal`, `specular`, `ao_depth`), then one entry: u16 frames, u16,
  u16 box w, u16 box h, u32 frame-table offset, and per layer {u32 offset, u32 size, u16 w, u16 h}
  → a whole DDS (diffuse DXT5; teamcolor DXT1, present on only 143 of the 780). Frames are 16
  bytes {x, y, offset x, offset y, w, h, …}. **The frame table and the box are in 4x pixels even
  in the 2x file** — `parseAnim` halves them, so offsets can land on a half pixel. **Frame N is
  the GRP's frame N** (counts equal for every image with a GRP; `tests/remastered.test.ts`
  checks it when `SCM_REMASTERED_DIR` is set), which is why the animator, facings and `.lo`
  offsets need no HD knowledge at all. The *box* is not the GRP's (49 × 45.5 against 48 × 48 for
  the Scourge) and is centred on the image position the same way.
- **`slimAnim`.** Whole, the 780 files are 502 MB; `diffuse` + `teamcolor` are 216 MB. The
  extraction keeps those two and writes the others' table rows as absent (offset, size, w, h all
  zero — how the game itself writes a missing layer), so one parser reads both and `slimAnim` is
  idempotent. `extractRemastered` slims *as it reads*: the passes hold every file until the last
  one, and half a gigabyte of sprite sheets in a worker is the difference between working and not.
  `anim.ts` has no imports for the reason `iscript.ts` has none.
- **A rectangle at a time.** A sheet is up to 12 megapixels and a frame is fifty pixels square.
  DXT blocks decode independently, so `dds.ts#decodeDxtRect` decodes only the blocks under the
  frame; no sheet is ever expanded. The parsed anim holds just the file bytes (avg 280 KB).
- **What a frame is.** `ImageFrame` gained `scale` (canvas pixels per map pixel: 1 or 2) and
  `width` / `height` stay in *map* pixels, because every draw already gives the destination size
  from them — so the viewport, ghosts, export and previews needed no change beyond smoothing
  (`zoom < spritePx`, a 2x sprite is being reduced up to 200%). The two callers that read the
  canvas's own pixels did: `UnitPreview` crops by `frame.opaque` (the frame's rectangle, which
  the anim knows without a GRP), and the plugin image producers in `plugins/graphics.ts` pass
  `hd = false`, since `PluginImage` promises a canvas of `width` × `height`.
- **Colour.** Team colour is the mask's red channel: `rgb × (1 − m) + rgb × team × m`, with
  `team` the brightest entry of the `tunit.pcx` ramp through the tileset palette (the row's own
  colour — 244, 4, 4 for red) or the CRGB value. Shadows are the diffuse alpha as black at half
  strength; `DrawFunction.Remap` effects are already in their own colours with the glow in the
  alpha and are drawn "lighter" as before, with no remap table.
- **Fallbacks, all to the GRP:** no anim for the image (105 of the 885 reachable ones, mostly
  shadows and effects — `unit/manifest.json`'s `hd` list says which, fetched once on first use so
  a 1.16 copy costs one request rather than hundreds of failed ones), the anim still on its way
  (nothing waits and nothing flashes a marker), and the eight files with **no box** (503, 582,
  588 — the start location — 756, 787–790), which cannot be centred. So classic and 2x frames
  are mixed on purpose; both live in the one LRU under an `hd:` key prefix, sized by real pixels.
- **Image export** waits for both (`awaitAnims` beside `awaitGrps`): which images have no 2x
  sprite is not known until asked.
- **Checked** in headless Chromium on the real install: 1722 files / 366 MB installed in ~28 s;
  Big Game Hunters and Enslavers 1 at 100% and 200% in both modes — positions, team colour and
  shadows agree with classic; no errors. Not looked at: a damaged building's fire, cloaked units,
  the unit palette thumbnails, an exported image.
