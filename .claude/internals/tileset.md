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
