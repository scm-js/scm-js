# Tileset graphics

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

### Remastered terrain: the 2x pictures (`hd.ts`, 2026-10-09)

View ▸ Remastered Graphics (`ViewFlags.hdGraphics`, started from `Preferences.hdGraphics` — one
switch for this and the 2x sprites, `units.md`; off by
default) draws megatiles from `tileset/<name>.hd.vr4` — the installation's
`HD2/TileSet/<name>.dds.vr4`, which `extract.ts` copies when the source has it (only a Remastered
installation does; see `gamedata.md`). The file is u32 size, u16 count, u16 version (0x1002), then
per picture {u32 0, u16 w, u16 h, u32 size, a whole DDS: 128-byte header + DXT1}. **Picture N is
megatile N of the same installation's `vx4ex`**, measured on all eight tilesets (the file has a few
hundred more pictures than megatiles — Badlands 6588 for 6172 — whose purpose is unknown; they are
never asked for). `parseHdTiles` accepts only 64 × 64 DXT1 and the loader only a file with at least
as many pictures as the tileset has megatiles, because a file from other tile tables would draw the
wrong ground silently.

- **Lazy, in pages.** Nine thousand megatiles at 68² RGBA is 160 MB and a map uses a few hundred,
  so `hdSource` decodes one on first use (~0.07 ms) into the next free cell of a 32 × 32-cell canvas
  page (2176², 19 MB) and remembers the slot. Nothing is evicted: a session that browses every
  tile of a tileset in the palette fills nine pages. That is the known ceiling, accepted for now.
- **Gutter 2, not 1.** At 100% a 64-pixel tile is drawn at half size with smoothing on, and the
  sample at the edge reaches a whole source pixel past it.
- **One switch, two objects.** `load.ts#setHdTerrain` is a module variable (the hook sets it from
  the flag) and `peekTileset` / `ensureTileset` answer with a *variant* `LoadedTileset` when it is
  on: same `tileset`, `doodads` and classic atlas image, with `atlas.hd` set. It is a different
  object on purpose — the terrain layer (`layer.assets`), the palette thumbnails and every other
  memo keyed on the loaded tileset redraw on the flip with no code of their own. Both variants
  stay cached, so flipping back and forth fetches nothing. `tilesetSettled(name)` is how
  `useTileset` tells "the classic one is cached but the 2x file has not been asked for yet" from
  "this is the answer"; the classic picture keeps drawing during the fetch. A tileset with no
  usable file is cached as `null` (`hdTerrainMissing`), the hook says so once per game-data
  revision in a toast, and `retryTilesetParts` drops the nulls after an install.
- **`AtlasSource.size`.** `atlasSource` answers 32 or 64 and every blit takes `src.size` for the
  source rect; `atlasTileSize(atlas)` is what smoothing and the terrain layer's whole-factor
  test are decided against (a 2x tile is *reduced* up to 200% and copied exactly there, so the
  layer shifts on scroll at 200%/400% and redraws at 300%). A megatile the file lacks, or no
  `document` (tests), falls back to the classic cell at 32 — callers must not assume one size
  per atlas.
- **What is deliberately not the game's.** No water animation: Remastered animates with a shader
  over a still picture (`<name>.tmsk`, `<name>_mask.dds.grp`, not read), so `animated` is false
  for every 2x cell and the cycle loop idles. `averages` (minimap, tiles under 4 px) stay
  classic. Units and sprites are the GRPs.
- **Checked** in headless Chromium against the real installation: install 942 files / 150 MB in
  ~19 s, Big Game Hunters at 50/100/200% in both modes, no seams, no errors, ~0.5 s from the menu
  click to the repaint including the 15 MB fetch. `tests/hd-terrain.test.ts` builds its own
  `.dds.vr4`; `SCM_REMASTERED_DIR` adds the count check on all eight real files.

### Remastered water and lava (`hd.ts`, `viewport/effectPass.ts`, 2026-10-09)

Supersedes "no water animation" above. Remastered does not animate these tiles: it draws the
terrain and bends the picture. **Water** re-samples the ground at a point offset by two scrolling
normal layers (each mixed between two frames of its own sequence); **lava** offsets by a couple of
pixels driven by scrolling noise, weighted by how red the pixel it reaches is and zero below a dull
red. A mask limits both. All of it measured on the real install:

- **Files.** `HD2/TileSet/<name>.tmsk` — `KSMT`, u16 version 1, u16 count, count × {u16 megatile,
  u16 mask picture} — and `<name>_mask.dds.grp`, the tile container with 64 × 64 DXT1 masks, white
  where the effect is (soft shore edges; submerged rocks are inside). Badlands 465 megatiles / 466
  masks, Jungle 629, Ice 583, Twilight 724; **Ashworld 714 megatiles all on one fully white mask**
  (the red test does the fine work there); Desert 8 megatiles on one white mask; **Space Platform
  and Installation have neither file**. Shared: `HD2/effect/water_normal_1.dds.grp` (45 × 64²),
  `water_normal_2.dds.grp` (120 × 256²), `noise.DDS` (64², uncompressed RGBA). Copied as
  `tileset/<name>.hd.tmsk`, `<name>.hd.mask`, `water_large.hd.grp`, `water_fine.hd.grp`,
  `heat_noise.hd.dds` (15 files, ~9 MB; a Remastered copy is now 1737 files / 375 MB).
- **Which effect** is not in the table — the game knows its tilesets — so `load.ts#effectKind`
  does: Ashworld heat, everything else water (Desert's tar included, a guess).
- **Constants.** The build ships its shaders as text (`ShadersGLSL/water.glsl`,
  `heat_distortion.glsl`). The *amounts* are taken from them — water drift `time / 20`, layer
  offsets −(t/2, t) and −(2t, 1.8t), fine layer × 0.6, bend 0.019 × 0.029 of the screen; heat
  offset (1.9, 0.5), red × 2.4 capped, nothing at red ≤ 0.2 — and **the shaders here are our own
  text**, not copies. What the files do not hold (the engine passes it in) is `RemasteredEffects`
  in the preferences: the ripple layers' size on the map (256 and 96 map px), the frame rate (15),
  set by eye by the user against the spike; Preferences ▸ View ▸ Graphics ▸ Water and lava.
- **Two deliberate departures.** The bend is in *map* pixels (0.019 × 640, 0.029 × 480), so it does
  not grow with the window or shrink with the zoom. The glint is the ripples' alone
  (`normal.z − 1`): the game positions a highlight by the screen's centre, which here would follow
  the viewport, and the unmodified sum lightens all water evenly.
- **Why a pass and not an atlas.** The classic cycle re-rasterises a small atlas of water tiles;
  this effect is continuous across the map (two instances of one megatile differ), so it has to
  be per screen pixel. The viewport stays canvas 2D: `EffectPass` is one WebGL1 canvas, the
  terrain layer and a **mask layer** go in as textures, and its canvas is drawn where the layer
  would be. The mask layer is a second canvas on `GroundLayer` (`viewport/paint/ground.ts`), drawn *inside `blitTiles`* with
  the same snapped rects and shifted with the same `copy` — so the two cannot disagree about a
  shoreline, and a scroll costs what it did. `layer.version` counts draws into them; the pass
  re-uploads only when it moves, so a still view is one draw call a frame and no upload.
  `layer.moving` (any masked tile in view) gates the pass and the 30 fps repaint in the rAF loop
  (`EFFECT_FRAME_MS`); a view with no water pays nothing. The ripple pictures go to the card as
  DXT1 where `WEBGL_compressed_texture_s3tc` exists (4 MB of VRAM, no decode) and are decoded
  otherwise.
- **Off switches, all to still water:** View ▸ Animate Water off; tiles under 4 px; no WebGL;
  a lost context (re-made up to three times, then given up); a copy without the effect files
  (`hd.effects === null`). Map image export is always still.
- **Checked** in headless Chromium (SwiftShader) on the real install: BGH water moves (17.7 % of
  viewport pixels change over 0.5 s) and is byte-still with Animate Water off; Ashworld Hunters'
  lava cracks move (4.2 %); no console errors. Performance on a real GPU, the non-s3tc path and
  context loss are not exercised.

(2026-10-09, after main's viewport split — PR #14 — was pulled under this work: the ground pass is
`viewport/paint/ground.ts#paintGround`, which now takes `Ground.motion` (the pass getter, the time
and the tune, or null with Animate Water off) and answers `{ animated, moving }`; the tile ghosts
are `paint/ghosts.ts` and take `src.size`; sprite smoothing is `paint/objects.ts#spritePx`. The
elevation and buildability overlays are part of the ground layer since that PR, so over moving
water they bend with it.)
