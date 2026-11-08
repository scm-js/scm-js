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
- **A file per GRP, not per image (found 2026-10-12, by the user: a Command Center drew its
  classic body under Remastered's working overlay).** `HD2/anim/` has 868 files for 999 images:
  where two images.dat entries name one GRP only one has a `main_NNN.anim`, and the other is
  drawn from it — a Command Center is image 275 and its file is 63's. 128 of the 131 images
  with no file are so. `anim.ts#imagesSharingGrp` names an image's GRP-mates;
  `load.ts#requestAnim` falls to the first of them the manifest's `hd` list has
  (`sharedAnims`, cleared with the data set); and the extraction takes a GRP-mate's file
  where the mate is not itself reachable (329 for 330, 547 for 548 — in `hd` without being in
  `images`), under the mate's own number, so nothing is stored twice. A copy made before this
  has 101 of the 103 already and lacks those two until it is installed again.
- **A frame may reach past the box, and a shared sheet is in the other image's colours (2026-10-13,
  both found on the play page first and ported from scm-sim's `web/renderer.ts`).** The box is what
  a frame is centred by, not what holds it: an Overlord flying north reaches a tenth of its height
  past it, a Pylon's shadow does too. `drawAnimFrame` used to push such a frame back inside (the
  unit jerked between facings, the shadow sat short); it now places the frame at its own offset
  and grows the canvas by the overhang **on both sides**, so the middle is still the box's and
  every caller goes on centring by `width` / `height` — which are therefore per frame, not per
  image. And a glow drawn from a GRP-mate's sheet (`load.ts#animImage` says whose) is that image's
  finished picture: protoss building fire (488–490) came out in the terran fire's orange.
  `glowOrder` turns red, green and blue round to the order that brings the one remap table's
  colour nearest the other's (red and blue swap). How Remastered itself colours it is in no file
  read here. Neither was looked at in a browser in the editor; the comparison picture in the
  guide was re-shot after them.
- **A turret stands where the body's special overlay file says (2026-10-13, found by the user on
  a Remastered Siege Tank).** The game sets a subunit's image offset to slot 0 of the body's
  images.dat special overlay `.lo` at the body's frame (`tank.lol`: about 10 px up and 9–13
  behind the hull's middle; `stank.lol` −9, −16; `goliath.lol` all zero) — OpenBW's
  `set_image_offset(…, get_image_lo_offset(main_image, 2, 0))`, and what the play page reads
  from the engine as each image's own offset. The editor drew the turret at the body's centre in
  both modes. Classic hid it (the turret's GRP frames sit in the middle of their box, so it read
  as a tank with the turret a little far forward); Remastered's frames have the pivot at the
  box's middle and the barrels ahead of it, and the turret hung off the front of the hull.
  `animate.ts` pins the pose's turret overlay (`StarEditInit`'s `imgol` of the subunit's image)
  to that slot through `ImageState.lo`, or gives a subunit sprite a `mount`; `settleImage`
  mirrors a pinned x when the body's frame is flipped. The still pose goes through
  `sprites.ts#turretOffset` (viewport below the animator, map image, plugin graphics). The map
  image does not wait for the `.lo`, so a turret whose file has never been asked for is exported
  at the centre.
- **Fallbacks, all to the GRP:** no anim for the image or any image of its GRP (2 of the 885
  reachable ones — `unit/manifest.json`'s `hd` list says which have one, fetched once on first use so
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

Links and gas the game reads (2026-10-17 audit, OB1/OB3; runs O3/O3b/O7 in the lifted 1.16.1):
- The game links an add-on to its building, or two Nydus Canals, only when **both** records name
  each other's serial; the relation word is ignored (StarEdit writes 0x200 on both). `linkPlaced`
  (units.ts) runs after every placement in `useUnitTools.placeAt`: an add-on at `ADDON_OFFSET`
  (+96, +16 px from the host's centre, every pair in Blizzard's maps) of a free same-owner host,
  the reverse, or a Nydus Canal to its owner's last free canal. `updateSelected` calls
  `pairRelated` when a related serial changes, so the dialog's one field sets both ends.
- `makeUnit` gives Refinery/Extractor/Assimilator (`GAS_BUILDINGS`, or the ResourceContainer flag)
  5000 gas with the Resources bit; without it the game gives them 0.

## Codecs for mods (M2)

Added 2026-11-08 for the mods plan (`scm-sim` branch mods-plan, `docs/mods-plan.md`, slice M2): every data file a mod
changes, read **and written**, beside the editor's old readers (`dat.ts`, `tbl.ts`, `grp.ts`, `pcx.ts`, `lo.ts`, `iscript.ts` decode only what the
editor draws; since M4 `dat.ts` reads through `decodeDat` and `iscript.ts` through `readIscriptHeaders` — see
`gamedata.md` "Data sets widened"). All are pure, no
game data, exported from `@scm-js/core` (index.ts "Mods" block), and walk clean in `tests/core.test.ts`.

- **One schema** (`schema.ts`, `DAT_SCHEMAS`): the eleven tables field by field in file order, PyMS's names (so PyDAT
  TXT round-trips), `u8/u16/u32`, struct fields as `parts` (placement box, add-on position, extents), the standard
  layout's sub-ranges (`first`/`count`: infestation and add-on 106–201, the selection sounds 0–105, sprites' bar and
  circle 130–516), the two Brood War columns (`broodWar`, absent from the 19192-byte original units.dat), the widths
  that change by layout, the PyDAT TXT coders (bool, flags with PyMS's bit names, hit points whole/fraction, supply
  whole/half) and `ref` (what a value points at, for M3's `mod check`). Plain JSON — `JSON.stringify(DAT_SCHEMAS)` is
  the publishable schema the plan's "verified schema" starts from.
- **Three widths, from the length** (`table.ts`, `datShape`): the game's size → `dat`; `.datex` file name → GPTP's
  layout; any other multiple of an entry → DatExtend's expanded layout as PyMS reads it, else `.datex`. Expanded and
  `.datex` store every column at the full count; expanded widens only units' flingy to u16 (97 B a unit), `.datex`
  also units' ground and air weapon and orders' weapon (99 B a unit, 23 an order — GPTP's `datext.cpp` table says 97
  for units but its loader widens three columns, and Cosmonarchy's 297,000-byte units.datex is 3,000 × 99). GPTP reads
  sfxdata.dat, not `.datex`; Cosmonarchy's is the expanded layout at 20,000 entries. PyMS's rules (units a multiple of
  12, 250–912, 228–250 reserved) and GPTP's limits are informational in the schema, never applied. Columns are typed
  arrays at the widest width (entry-major for structs), rows are objects, a field outside its sub-range is absent.
- **PyDAT TXT** is PyMS's `_export` as read from AbstractDAT/DATCoders (not run — executing PyMS was refused here):
  `Unit(0):`, tab, `name value`, blank line; portdata's `idle.*`/`talking.*` order via `textOrder`; orders' format name
  `targeting` is exported `weapon_targeting`, which is our field name. One extension: a set flag bit beyond PyDAT's
  bit count (sfxdata flags bits 6–7, availability bits 10–15) is written `flag_0x400 True` rather than dropped.
- **TBL** (`tblFile.ts`): entries are spans to the next *distinct* offset (PyTBL's rule, shared/out-of-order offsets
  read right), encoding guessed as `tbl.ts` does and kept for writing. PyTBL text: `<N>` for < 32 and `#<>`.
- **GRP** (`grpFile.ts`): the game's encoder, measured: transparent runs always skip (≤127), runs of ≥4 equal pixels
  repeat (≤63), else copy (≤63) — but a run is only measured as far as the copy still has room, so a run starting
  near byte 60 of a copy is copied; trailing transparency is written; a frame equal to an earlier one shares its
  offset. **All 833 GRPs images.tbl names are byte-identical.** Cosmonarchy's 1,569 GRPs (another encoder): 162
  identical, the rest decode-equal, ours 4.3% larger in all (169.2 MB vs 162.3 MB).
- **PCX** (`pcxFile.ts`): header kept; RLE per line; `thpbar.pcx` has an odd bytes-per-line (19), kept. 77/77 of the
  game's PCXs tried are byte-identical. **LO** (`loFile.ts`): offsets kept; 8 of the game's 96 share frames, which PyLO
  text cannot say — a first comment line `# scmjs: offsets …` carries them, so text round-trips too (96/96).
- **iscript** (`iscriptText.ts`): PyICE/IceCC text, `cmd a b` or `cmd(a, b)`, IceCC raw lines `ub`/`uw`/`pw` and the
  unknowns' other spellings (`unused_0c`). Assembled in IceCC's layout (table pointer, `00 00 FF FF 00 00`, code in
  source order, headers in source order, table, `FF FF 00 00`) because that is what reproduces mods' binaries. **Header
  size is compiler-dependent**: IceCC writes `type + 1` entry points (one fewer than PyMS for even types; types 3 and
  25 exist), PyMS/the game use PyMS's table — the disassembler detects which (headers packed before the table under a
  rule) and writes `# scmjs: entries pyms` when needed; the assembler warns when a listed entry point does not fit.
  The game's file needs `# scmjs: preamble 00*1366 FFFF0000`, `headers inline` and a `table` order note. Unreached bytes
  (the game's: single alignment zeros before headers) are `ub` lines. **Proof:** the game's iscript.bin and all six of
  Cosmonarchy's `iscript_*.txt` → their `.bin` byte-identical, and each `.bin` → text → same bytes. Cosmonarchy's
  dialect differences: `ub 62 / ub flags / pw Label` for GPTP's `flagjmp` (opcode 0x3E repurposed), `unused_0c`.
- **AI scripts** (`aiscript.ts`): PyAI text (`script ID { … }`, `--Block--`/`:Block`, `name(args)` or `name a b`,
  `#`/`;`, variables, `@` lines ignored), the game's 113 opcodes and aise's 113–164 with PyAI's argument types (enums,
  flags, unit groups, points `Loc.N`/`ScriptArea`/`(x, y)`, areas `~ r`). Code in source order (PyAI orders by reach),
  so files round-trip; notes: `aiscript preamble` (the game's has 1,504 zero bytes), `aiscript expanded` +
  `long-jumps` (aise's trampoline table — Cosmonarchy's has 1,814), `file bwscript` (code below goes to bwscript.bin;
  without notes, code reached only from bwscript scripts goes there), `bwscript order`. Not done: PyAI's idle_orders
  flag syntax (written `IdleRaw(hex:bytes)`), unit names (numbers unless `names` are given). **Proof:** the game's
  aiscript.bin + bwscript.bin and Cosmonarchy's (555 KB, expanded) both byte-identical. But Cosmonarchy's aise fork
  ("aize", no public source found) adds opcode 0xA6 (layout read off the data: long block + name string, ours `op_a6`,
  `inferred`) and redefines at least 0xA4 (a string-encoded sub-language: "var Exactly|wait …"), so ~60% of its code
  is `raw_bytes` lines — lossless, not readable. The game's files decode fully (71 raw lines = padding zeros).
- **.graft** (`graft.ts`): requirement files are the game's u16 requirement stream (leading 0; an entry ends at a
  0xFFFF followed by a non-opcode, so upgrade levels stay together); buttons.graft is three u32 counts, 20-byte
  buttons, 12-byte sets (count, first index, connected), 12-byte status entries (unit, status fn, display fn) — from
  GPTP's `grafting.cpp`. Text is graftc's (README/format.txt); the disassembler cuts sets at every unit's range bounds
  (430 sets + unreferenced runs in Cosmonarchy's). All six of Cosmonarchy's files byte-identical both ways.
- **PNG ↔ GRP** (`../png.ts`, `grpPng.ts`): PNG via `CompressionStream("deflate")` (async, browser and Node 18+). A
  sheet is an indexed PNG of the named palette (index 0 transparent) with `tEXt scmjs:grp` (palette name, frame size,
  columns, each frame's box), so GRP → PNG → GRP is byte-identical (833/833 of the game's, 13 s in all, ≤0.6 s the
  largest); other PNGs are quantised to the nearest palette colour (weighted RGB), reported per lost colour.
- **Performance** (this machine): units.datex 3,000 × 99 decode+encode+text ≈ 0.6 s (10 MB of text); sfxdata 20,000
  entries ≈ 0.4 s; the game's iscript.bin disassembly 53 ms; Cosmonarchy's aiscript.bin 81 ms to text, 180 ms back;
  the largest Cosmonarchy GRP (3.2 MB) encodes in 0.46 s.
- **Tests**: `tests/formats-{dat,tbl,graphics,iscript,aiscript,graft}.test.ts`; the game's files from
  `fixtures/data/*.mpq` (`tests/support/modFiles.ts`), Cosmonarchy's from `SCMJS_COSMONARCHY` (the download's root);
  both skip when absent.
