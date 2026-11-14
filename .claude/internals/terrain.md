# Terrain editing

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
brush paints the diamond under each image of the pointer (`paintIsomAt`), and `ghostDiamondsAt`
previews the same set. Blend and pasting are deliberately not covered. The viewport draws the
axes on every layer but the clipboard and draws the mirrored ghosts fainter.

`symmetryImages` is the one table of a mode's images: each a point map, its linear part (how a
drag's movement turns) and its *element* of the mode's group — reflections XOR (hv: flipX 1,
flipY 2, turn 3), rot90 cyclic (quarter turns clockwise 1–3). `mirroredOwner` uses the element
so a copy's player is consistent whichever corner/player you place from (P1–P2/P3–P4 pairs, or
P1–P4/P5–P8 quads; owners 8–11 untouched); `*Images` variants of `mirrorPixel` /
`mirrorTileRect` carry it, and the unit/sprite/doodad `ghostsAt` apply it when
`symmetryOptionsAtom.players` (stored, `scmjs.symmetry`, default on). Move/delete work by
**matching, not by remembering** what was placed together: each object hook's `select` /
`selectInBox` runs `withMirrorImages` (same kind, nearest within a tolerance — units/sprites
16 px, doodads 32 px by footprint centre, locations `LOCATION_MIRROR_PX` 8 with sorted sides as
the kind), so Delete needs nothing; `beginDrag` runs `mirrorMoves`, which gives the selected
thing nearest the pointer `SAME_MOVE` and its partners their image's linear map (doodads snap
from, and locations clamp over, only the `SAME_MOVE` ones). Locations also resize their
partners (`mirrorPartners` + `boxImage`) — `handleAtPoint` accepts a selection that is one
location plus its images, else the handles would vanish whenever symmetry was on — and the
arrow nudge goes through `moveLocationsMirrored`. Selections made elsewhere (Find, panels, the
plugin API, Ctrl+A) are not expanded. `symmetryAtom` is a derived atom that records the last
mode for `toggleSymmetryAtom` (M, `tools.symmetry`; the toolbar's `SymmetryControl`).
`tests/symmetry.test.ts`.

**The fairness report (`src/editor/fairness.ts`, `useFairness`, 2026-11-13).** `fairnessReport(scn,
tileset, mode)` holds the map against its own image under a symmetry mode at minitile resolution
(`symmetryImages` on a `4w × 4h` grid; a square and its images are one group, judged where its lowest
index is, so every difference is counted once and `places` lie on the top-left side): walkable bit,
height (VF4 mid/high), and the CV5 buildable bit of the tile; plus minerals (176–178 as one kind),
geysers and start locations by `mirror` of their pixel, within 16 px, equal `resourceAmount`. It reads
MTXM. `mask` (a byte per minitile, set on both sides) is what View ▸ Symmetry Differences draws
(`paint/ground.ts`, red for walk/height, amber for build only). `symmetryShares` runs every mode that
fits the map's shape and `likelySymmetry` names the one it was made with (`SYMMETRIC_SHARE` 0.9, a
four-way mode preferred when it holds within 2% of the best): sixteen Blizzard maps drawn freehand
measure 0.05–0.85 under every mode, the one mirrored map 0.989 under `h`. Cost on 256 × 128: all modes
≤ 175 ms, one report ≤ 50 ms; the hook measures only while the overlay or the Symmetry dialog asks, and
keeps the shares apart from the report so picking another mode in the dialog does not re-measure all.
Not counted: the blocks-view and ramp bits (`twinDifference` counts whole flag words, which is why it
says 83 for the Desert cliff ramps where this says 69). The CLI's `map analyze` is the other half of
fairness (distances, bases); this is the tile-level half and is not in the CLI.

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
`STALE_ISOM_SHARE` live in `editor/isom.ts`; `useIsomStatus` and `api.terrain.checkIsom` both read them
(computed on load, not per stroke). `checkIsom` measures **lattice → tiles**: does the lattice reproduce
the tiles that are there. That is *not* the question a rebuild answers, and reporting it alone was a bug
worth remembering: `rebuildIsomFromTiles` votes a lattice out of the tiles, converges in **one** pass,
and leaves behind every rect no lattice can produce — hand-placed tiles, blends, another editor's
ground. Measured over the fixture maps with Rect blocks stamped on, a rebuild took 5–34% disagreement
down to a residue of 2–13% and a second rebuild changed nothing, so a map with hand-laid terrain warned
"ISOM stale (14%)" and recommended a repair that could not move the number, for ever — the Repair
plugin re-ticked it after every press. So `isomReport` runs the rebuild too and answers `inherent`
(the rects it would leave) beside `mismatched`, and **`stale` is what a rebuild would recover**:
`(mismatched - inherent) / rects > STALE_ISOM_SHARE`. The palette badge, its hint, Check Map and the
plugin all read `stale`, and say the leftover is nobody's to fix rather than offering a repair for it.
It deliberately does **not** report how many lattice values a rebuild would write: that number sounds
like the answer and is not — a rebuild rewrites 500–3000 values on a Blizzard map that measures 0%
mismatched, since a different row can mean the same thing. Cost: `checkIsom` is ~2 ms on a 256 × 256
map and the rebuild ~75, so `isomReport` returns on the check alone when `mismatched` is 0, which is
every map StarEdit and this editor write; `rebuildIsomFromTiles` keys its inverse-link table by number
rather than by a template string, which is 131k lookups on that map (89 → 73 ms). `tests/isom.test.ts` validates all of this against the fixture maps; keep those
tests green when touching the CV5 decoder (`edges`, `stack`) or the tables.

Terrain-type ids in the palette are CV5 group indices of flat tile pairs (the same ids `ISOM` stores).
Rect mode paints in left/right pairs following map column parity, sharing one random variation per
pair — the tests in `tests/terrain-edit.test.ts` pin this behaviour.

**Pair terrains — flat ground the tileset does not type (2026-11-10).** A mod's added groups all have CV5
`index` 0 and no links or stack values (Cosmonarchy's Jungle: 2,517 groups past the game's 1,578, used on 81 of its
86 Jungle maps, up to 64% of a map), so they have no ISOM id and `isomTables` has nothing to build from; the maps'
own ISOM under those tiles is unrelated terrain (hand-placed). The tile-laying tools take them through a second
kind of terrain id: `palette.ts#PAIR_TERRAIN` (0x10000) + the pair's even group. `terrainOf` / `pairTerrain`
resolve one, `flatGroupOf` / `matchingTiles` / `replaceTerrain` accept one, the Rect flood compares
`terrainKeyOfTile` (index, or the pair where the index is 0 — before, a flood from an untyped tile took every
untyped tile), `fillMap` leaves ISOM alone for one, and `pickAt` in isometric mode switches to Rect when the
pick is one. They are never written to a map and the isometric brush ignores them (`currentIsomTerrain` falls
back). `api.terrain.types()` is unchanged (the game's types), though `tx.replaceTerrain` and `flatGroupOf` take
the ids since they share the functions.
**Which pairs are offered is a matter of evidence, and the files alone do not give it.** `isLoosePair` is only a
shape (two index-0 groups, same slots, a left and a right that differ, one megatile height, one buildability:
675 of them in that Jungle). Measured before settling: seam distance (`edgeDistance`, pair / wrap / vertical) and
quadrant colour spread do **not** separate flat pairs from seam pieces — the game's own mud-to-dirt edge groups
(index 22) score better on both than several typed flat terrains, and the mod's dry-grass flat (2082) and a
grass seam block (2024) come out the same. So a pair is listed on one of three grounds: (1) `terrainCopies` — every
picture is pixel for pixel a picture of one typed flat pair and the flags differ (megatile VF4 words or the CV5
buildable bit); named "{terrain} ({low|mid|high} ground)" from `megatileHeight`, lowest typed group as the source
where several share pictures (Jungle / High Jungle), flag-for-flag duplicates left out, same megatile in both
halves not a pair at all (Installation 16–46 repeat megatile 1). The game's eight tilesets yield none; Cosmonarchy's
yield 0–7 each (Jungle: Mud at mid 2466 and high 2482). (2) `terrain.ts#laidPairs` — the open map lays the pair
left-on-even-column with the right half beside it in the same slot at least `LAID_PAIR_MIN` (8) times; over the
mod's 86 Jungle maps a pair past the game's groups is laid so on 30–100% of its tiles or on none (seam pieces are
single tiles), and 348 maps on the game's tilesets yield no pair at all. Index-0 groups only: the game's edge
sets are laid in pairs too. (3) the person picks it — the palette's context row in Tile mode, or Alt+click on a
pair laid whole there (`laidPairAt`). `useTerrainTools().types` is the game's types plus the copies (stable per
tileset); `useRectTerrains(tools)` adds the laid pairs and the active ad-hoc pair and is what the Rect tab and
Replace Terrain list — it subscribes to the terrain revision, the tools hook does not. Names: `TerrainType.name`
stays English, `label` is the localized composition, shown through `terrainLabel`. `tests/pair-terrain.test.ts`.
A real isometric brush for such ground needs a table nobody ships (type rows, adjacency, and links for groups laid
out in the mod's own compact blocks, not StarEdit's fourteen shapes) — not attempted.

**The Tile palette's sheet and blocks (`src/editor/tileSheet.ts`, `atoms/tileBlockAtoms.ts`, 2026-11-13).** Why: a
mod's tileset adds thousands of groups (Cosmonarchy's Badlands 1,665 → 4,094, every added one CV5 index 0, no links),
and laid 16 megatiles wide in group order they form the artist's sheet — ruins, buildings, walls, road diagonals, a
picture spanning slots *and* groups, neighbours in the sheet designed neighbours on the map. The game's doodads are laid
the same way (`DoodadDef`: row r = group + r, column c = slot c). 375 of the mod's 404 maps lay this ground by hand, and
the old Tile tab (8×2 blocks with gaps, or a grid whose width follows the panel) could neither show such a picture nor
lay it in one go.
*Model.* `sheetRows(listed, isEmpty)` → one `SheetRow { group, run, blank }` per listed group in order; consecutive groups
share a `run`; a gap of ≤ `SHEET_BRIDGE` (16) groups that are **all empty** (no slot with a megatile, the groups
`tileGroups` leaves out) is filled with `blank` rows of the same run, any other gap starts a run (the palette draws a
dashed break). Measured before choosing the bridge: the mod's Badlands has 220 empty groups, 36 single ones inside its
pictures and runs of 2–64; its added groups (2,385 listed) become 2,429 rows in **one** run. The game's eight tilesets
have one empty stretch of hundreds of groups (between terrain and doodads) and a few of 5–64, which stay breaks.
`blockFromRect(rows, rect, isVoid)` → `TileBlock { cols, rows, ids, origin }`, row-major, `HOLE` (-1) for a void slot
(null megatile, as `drawTile` draws it) or a blank row; null across a run, off the sheet, or all holes. `blockRect`
finds the block's outline again while its rows are listed. Laying: `blockCells` / `layBlock` (holes and off-map cells
skipped, unchanged cells dropped), `patternOrigin` / `patternTileAt` / `layPattern` (floor division, so a drag up or left
of the press steps back whole blocks), and `PatternStroke` — the press is the origin, each copy the pointer's cell
falls in is laid once. `tests/tile-sheet.test.ts`, including every Badlands doodad picked from the sheet equals its
`DoodadDef.tiles` (gated on `public/tileset`), and the mod's Badlands as one run (gated on `SCMJS_COSMONARCHY`).
*Brush.* `useTerrainTools`: `beginStroke` in Tile mode with a block makes a `PatternStroke`; `paintAt` feeds it before
anything else, through the same `Stroke`, `applyChanges`, revision bump and `commitTerrain` — one undo entry per drag,
shared maps and dirty sections as any stroke. Not mirrored under symmetry (a block's pictures cannot be), like a paste;
writes over pins, like Tile and paste; ISOM untouched. Anchor = top-left on the pointer's tile, as `useClipboardTools`'
paste. **Fill Area / Fill Map tile the pattern** (chosen over "the block's first tile"): flood from the clicked cell
lined up on it (not mirrored either), Fill Map lined up on (0, 0); both skip pins. `ghostAt` answers the block's cells;
the viewport draws a `cols × rows` outline instead of the brush square (`tileBlockAtom` is in `REPAINT_ATOMS`).
*State.* `tileBlockAtom` is a palette pick like `activeTileAtom` (global, not in `parkRegisters`), but reads as null
unless the map in front (`scenarioAtom` identity), `tilesetFileNameAtom`, `gameDataRevisionAtom` and `activeTileAtom`
are what they were when it was picked. Writing a block sets `activeTileAtom` to its first tile, so every way of picking
a single tile (palette, eyedropper, Tile # box, Blend, a plugin's `setBrush`) drops it without knowing it exists. The
consequence of a derived read rather than a write: a block picked on map A is hidden while B is in front and **shows
again when A comes back** (with the same active tile). A different tileset or data set never sees it.
*What the data set adds* (`remasteredTiles.ts#addedGroupsFrom`): shown only when the table is longer than Remastered's
(no game table is), from the 1.16 table's end — Cosmonarchy's tables go on from there. A mod built over Remastered's
table would show Remastered's own additions among "added"; nothing in the files tells the two apart. Labelled with the
data set's profile name (a folder attached with `drawFromModFolder` is named after the folder: "Added by Release").
*Left open:* no auto-scroll while dragging a block past the sheet's edge (the wheel works mid-drag); cutting the
sheet into named pieces listed like doodads; anything isometric for the added ground; no plugin API for blocks.

**Pieces: the parts of the sheet maps lay whole (`src/editor/pieces.ts`, 2026-11-13).** *The rule's record.* A tileset is
a sheet 16 wide; maps are counted a **join** of the sheet at a time (`gatherEvidence`: how often a tile is laid, and how
often it has its sheet's right / lower neighbour beside / below it). `cutPieces` keeps a join when the two tiles are laid
together at least half the times the rarer of them is laid (`DEFAULT_CUT.share` 0.5); a piece is a connected run.
Doodad groups and void slots are left out. Measured:
- Cosmonarchy's Badlands, 57 maps: 3,525 pieces, the largest 92 tiles, covering 62% of the added tiles those maps lay
  (Jungle, 86 maps: 70%). One map alone (Butcher's Corner): 355 pieces.
- Maps laid with the game's brushes give none, by construction: neighbouring columns take a pair's left and right
  group, so no two neighbours share a group. All 16 Blizzard fixture maps and the committed test maps: zero (pinned by
  `tests/pieces.test.ts`, and the learn loop over the committed maps in `tests/pieces-view.test.ts`).
- Counting whole laid shapes instead was tried and fails: a piece laid cut short or overlapped is another shape each time
  (Badlands: 5,946 distinct shapes; the share of a shape's tiles laid inside that exact shape is bimodal with a wide
  middle; shapes of 9+ tiles mostly under 10%). Per join, the cut-short lays add up.
- Cutting by the sheet's pixels was not attempted: objects sit on continuous ground and seam distance does not separate
  them ("Pair terrains" above). Pictures: `~/mods-under-test/_notes/terrain/badlands-pieces-{sample,largest}.png`.

*Where the evidence comes from.* `hooks/usePieces.ts#piecesInFront`: the map in front's own (one pass over its tiles)
merged with the **learned collection** for the data set in use (profile id) and the tileset, cut, kept for the last (map,
terrain revision, tileset, collection) so the view and Alt+click share one cut. The view re-cuts only while it shows, and
only once the revision has stood still `RECUT_MS` (300): a stroke bumps it every cell. Learning
(`editor/pieceLearn.ts#learnFromMaps`, pure, files and tables injected; `services/pieceLearning.ts`, imported only when
the button is pressed, since it brings `plugins/host.ts#pickFolder` and the map reader): every `.scx`/`.scm` of the
picked folder, opened with `openMapBytes`, counted against `formats/tileset/load.ts#loadTilesetGroups` (the CV5 alone
from the data set in use, no atlas); a map with a tile `lackedGroups` refuses is skipped as `notOurs`, one that throws as
`unreadable`; a `setTimeout(0)` between maps; progress in `pieceLearningAtom`, the end in `pieceLearnReportAtom` and the
status line. Measured in headless Chromium: Cosmonarchy's 404 maps (441 files) in 30 s, all read, Badlands 3,525 pieces,
Platform 1,993, Installation 9, Ashworld 1,599, Jungle 3,077, Desert 1,628, Ice 2,291, Twilight 1,631. Kept by
`services/pieceStore.ts` in `handleStore.ts`' database, a store of its own (`PIECES_STORE`, the database's version 4),
one `Int32Array` of `encodeEvidence` per `{setId}/{tileset}`; learning again deletes the set's eight keys first; *Forget*
deletes them. A folder attached through the mod-folder notice is id `release` here (the folder's name), so it and an
installed set of the same id share the collection; a set of another id does not. Not cleared by Preferences ▸ Clear
browser data (open). `learnedPiecesAtom` holds what was read, by key; the Tile tab reads it on mount so Alt+click can use
it before the view has been opened.
*Alt+click* (`editor/piecePick.ts#laidPieceAt`, in `useTerrainTools.pickAt`, Tile mode only, before the single-tile
pick): the cell's tile is a piece's and at least one of its four sheet neighbours from the same piece is laid beside it;
the precedent is `laidPairAt`. A piece's corner tile laid alone stays a single-tile pick.

**The same tile twice (`src/editor/tileCopies.ts`, 2026-11-13).** A mod's tileset repeats the game's pictures and its
own. "The same tile" = the same picture *and* the same flags, the flags being `heal.ts#kindKey` (exported for this; the
group's flag word and the megatile's sixteen VF4 words). The same picture under other flags is another tile and stays.
*Grid view*: one entry per exact picture and flags (`uniqueTiles`, the lowest id kept, so the game's tile where a mod
repeats it; with *Added by*, a tile whose key the game's part has is left out). Picture = two 32-bit hashes of the
megatile's 1,024 palette indices with the minitile flips applied, cached per tileset; keys cached per tile. The Grid was
never `drawableTiles` (it listed every slot of the listed groups, a megatile repeated in two slots included);
`drawableTiles` is unchanged (Blend and Heal want one id per megatile and keep their own flag checks). Measured on
Cosmonarchy's Badlands: of 38,328 ground megatiles 12,089 repeat another's picture, 6,923 with the same flags; 1,982 added
megatiles are byte-identical to one of the game's. The Grid's *All groups* goes 41,354 → 32,860 tiles (212 ms the first
time, hashing included), *Added by* 29,848 → 24,235. *Sheet and Groups views hide nothing*: there a tile's place is the
point. *Pieces view* (`collapsePieces`): pieces of one outline whose every cell is the same tile — exact picture, or a
re-dithered copy — are one entry, the most laid kept (ties: lowest first tile), the hover counting the copies. The copy
test is `COPY_BLOCK_MEAN` 2.5 (every 4 × 4 pixel block's mean colour, a channel) and `COPY_CELL_MEAN` 10 (the cell's mean
pixel difference): the isometric spike calibrated it on re-dithered copies and it passed none of the negative controls; a
plain mean over the whole piece is not safe, a small detail such as a console on a wall disappears in it
(`tests/tile-copies.test.ts` pins both sides). A piece that is another entry's picture under other flags is an entry of
its own, placed right after it, its hover naming what differs (height, walkable, buildable — `megatileHeight`, the VF4
walkable bits, the CV5 buildable bit). Measured on the 57 maps' 3,525 Badlands pieces: 238 are an exact picture copy of
another of the same outline (95 with the same flags too); by the copy test 542 have a copy (248 with the same flags);
`collapsePieces` folds 153 and lists 148 as the same picture under other flags: 3,372 entries, ~0.7 s once per cut
(cached with the cut). The coordinator's looser test (a mean 3/255 a pixel) counted 711 / 514; the spike's test is the one
used. With *Added by*, an entry with any member in the game's part is left out (2,691 entries there).
*Left open:* the pieces are not named or grouped like doodads; a big collection costs one `mergeEvidence` copy per cut;
no plugin API.

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

**The seam overlay (View ▸ Seam Overlay, `viewFlags.seams`, 2026-11-13).** `blend.ts#seamStep(tileset, a,
side, b)` is `edgeDistance` across the join less the mean of the two pictures' own *grain* at that edge
(`edgeGrain`: the difference between a megatile's outermost pixel row and the next one in, per side,
cached per tileset). The plain edge distance was tried first and is no use for this: at the Blend
brush's 16, 1–11% of the joins of sixteen Blizzard maps are over it (7% on Badlands, 11% on Ice — rough
rock against rough rock) and 9.8% of those inside a stretched cliff ramp, whose joins the eye finds at
once because the slope is smooth. Against the grain, at `SEAM_SHOWS` 8: 0.2–2% of the maps' joins and
10.7% of the ramp's; a plateau painted with the isometric brush, < 2%. Drawn in `paint/ground.ts`'s
`overlay`, each tile its own half of the line inside its own pixels (a tile is redrawn alone when it
cycles or a scroll uncovers it, so nothing may spill onto a neighbour); any terrain edit redraws the
layer, so a line never outlives the join. It reads the classic VR4 pixels whatever is drawn, like the
Blend brush. The stretch searches its cut by this measure as well as the plain distance (objects.md).

**The Heal brush (`src/editor/heal.ts`, terrain mode `"heal"`, 2026-11-13).** `healTiles(scn, tileset,
cells)` trades a tile for another of the same *kind* that joins its four neighbours better by `seamStep`.
Kind is the CV5 group's whole flag word plus the megatile's sixteen VF4 words, compared as a string key
(`healTables`, per tileset: tiles by kind from `drawableTiles`, and each megatile's mean colour), so
nothing the game reads changes; `HEAL_SAME_GROUND` (mean colour within 14 a channel) keeps dirt from
becoming grass that happens to end on the right pixels. **It only touches a cell with at least one join
over `SEAM_SHOWS`**, and takes a candidate that leaves fewer such joins, or as many and `HEAL_GAIN` less
step in all. The first cut took any improvement and was a lesson in what a "heal" must not do: over a
whole Blizzard Badlands map it changed 19% of the tiles (one variation of dirt for another) for 6% fewer
lines. As it is, over sixteen Blizzard maps a whole-map heal changes 0.1–3.3% of the tiles and removes
30–60% of the lines (Ashworld Hunters 568 → 24), in ≤ 180 ms; on a ramp stretched along its cliff,
Badlands 21 → 13, Twilight 7 → 3, Ice 25 → 21 — little, because few tiles have a ramp tile's flags, and
the stripe along a Badlands ramp's lower edge stays. Cells where `tiles[at] !== editorTiles[at]` (a
placed doodad's) are skipped: a stroke that changes one would strand the doodad. Cells are processed in
order against the neighbours as already changed, twice. The brush goes through `stampAt` like Rect and
Tile (`paintsTiles`), so symmetry, the stroke's undo entry and `commitTerrain` are theirs; `tools.heal(rect?)`
is the tab's button (marked area or whole map, `shownSeams` before and after in the status line).
ISOM is untouched. `tests/heal.test.ts`.

**Pinned tiles (`src/editor/pins.ts`, terrain mode `"pin"`, 2026-11-13).** A pinned tile is skipped by
the brushes that lay terrain by rule — `paintIsom` / `paintIsomDiamonds` (`IsomPass.setTile` returns
early; the pass's `kept` lists the cells), Rect and Heal strokes (`stampAt` → `unpinned`), both fills,
`fillMap`, Replace Terrain, the Heal button — and written by what is pointed at it (Tile, Blend, paste,
doodads). **The lattice still changes under a pinned tile**: only the picture stays, so the ground around
is laid exactly as without the pin (`tests/pins.test.ts` compares the two lattices). That is the point:
the alternative, stopping propagation at a pin, leaves cliffs open.
*Where the pins live:* a member of the map's archive, `scmjs\pins.bin` ("PIN1", width and height u16,
a bit per tile), read through `pinnedTilesAtom` (decoded once per member, `pinsOf`). Not a Scenario
field and not a new atom, because the archive's files already are per-document (parked with the map),
saved, and sent on a shared map by the `store.sub` on the extras atom; `scmjs\dataset.json` is the
precedent for an editor-owned member. A member for another map size reads as no pins.
*History:* `HistoryEdit.pins = { before, after }` (the member's bytes, null for none), not
`tables.extras`: that swaps the whole extras map, and a tables entry can hold nothing else, while a
doodad placed as terrain must pin in the same undo step as its tiles. `pinCellsAtom` writes the member
and answers the part; `commitEditAtom` records an entry that has only pins; undo / redo / rollback call
`stepPins`, and on a shared map the pins are copied onto the entry `tap.step` answers. `hasEdits` does
**not** count pins (it decides whether an op goes over the wire, and a pins-only entry has none).
Resize: `resizeDocumentAtom` moves the pins with `resizePins`; undoing the resize does not bring back
pins it cut off. Auto-pin: `DoodadPlacementOptions.pin` (default on) pins every cell of a doodad that
goes down as terrain, stretched ones included; pastes are not pinned.
*What "hand-laid" means:* `isom.ts#latticeMisses` — a tile whose group's CV5 index is not the one its
rect's lattice resolves to, skipping a placed doodad's cells (`tiles !== editorTiles`). **This is offered
as a button (`handLaidCells`, "Pin All Hand-Laid Tiles"), not applied automatically by the brush**, which
was the first design and is wrong: ground laid with the Rect brush does not match the lattice either
(Rect never writes ISOM), so a brush that protected every mismatch could not paint a plateau over
Rect-laid dirt, and protecting only what it reached by propagation left the plateau without its cliff
edge. An explicit, visible set is the only version that does not break mixed Rect/isometric work.
Overlay: `paint/ground.ts` draws a wash and a corner tab per pinned tile when `viewFlags.pins` or the
Pin tab is open.

Tile values as the game reads them (2026-10-17 audit, PR 3): MTXM bit 15 is a creep flag — the
group is `(id >> 4) & 0x7FF` (`tileGroupOf`, `TILE_CREEP_FLAG` in tileset/decode.ts; run T01:
0x8084 draws as 0x84, flags 0x41FFFF). `megatileForTile`, `tileGroup`, placement, the overlays
and `tileInfo` mask it; the ISOM/TILE editing code does not (it works on StarEdit's own tiles).
Tile height for the far-zoom overlay and the panel is `megatileHeight` (VF4: ≥12 high → high, else
high+mid ≥12 → mid); the CV5 height bits are masked off by the game (0xD8FA) and differ on 19–48%
of megatiles. Check Map counts creep tiles (info) and groups past the CV5 (warn: Remastered draws
tile 0x20, 1.16.1 reads past the table).

`paintIsomDiamonds(scn, tileset, diamonds, terrain)` (2026-11-07, for `scmjs map generate`) is the brush with a footprint of
any shape: `IsomPass.placeMany` sets every listed diamond at once and propagates from all of them, so a plateau or a lake
painted as one stroke does not depend on the order of its diamonds. What the generator learned about the brush (details in
`cli.md` "A map from a seed"): **two bodies of one terrain whose tips face each other across a single diamond** — across an
edge, or edge-to-corner such as (0, −2) and (1, +1) — leave a rect whose links hash to no CV5 group, which `updateTile`
writes as tile 0 (black); fill such a diamond first (the generator's `squeezed`, angles measured on the lattice's u/v
axes). A water diamond needs four steps to high ground (shore, ground, cliff). And every ramp doodad in every tileset
fits only a south-west or south-east cliff edge; Remastered's CV5 adds cliff pieces with the VF4 ramp bit that StarEdit's
placement rule accepts at a ramp's place but that do not walk.
