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

- Pieces that repeat a doodad's pictures (doodad groups are left out, but a mod may copy a doodad's pictures into
  untyped groups) are too few to need a rule: Badlands 12 of 3,525, Jungle 21 of 3,077, nearly all two tiles.

*Where the evidence comes from.* `services/pieces.ts#piecesInFront` (React-free, so the plugin host can use it; the hook
module re-exports it): the map in front's own (one pass over its tiles) merged with the **learned collection** for the
tileset's table, cut, kept for the last (map, terrain revision, tileset, collection) so the view, Alt+click and the
plugin API share one cut. The view re-cuts only while it shows, and
only once the revision has stood still `RECUT_MS` (300): a stroke bumps it every cell. Learning
(`editor/pieceLearn.ts#learnFromMaps`, pure, files and tables injected; `services/pieceLearning.ts`, imported only when
the button is pressed, since it brings `plugins/host.ts#pickFolder` and the map reader): every `.scx`/`.scm` of the
picked folder, opened with `openMapBytes`, counted against `formats/tileset/load.ts#loadTilesetGroups` (the CV5 alone
from the data set in use, no atlas); a map with a tile `lackedGroups` refuses is skipped as `notOurs`, one that throws as
`unreadable`; a `setTimeout(0)` between maps; progress in `pieceLearningAtom` (the view's one-line header shows it in
place of the source line); the end said once, in the status line and a toast, as a finished job is (round 3: the report
used to stay in the palette and took a third of it). Measured in headless Chromium: Cosmonarchy's 404 maps (441 files) in 30 s, all read, Badlands 3,525 pieces,
Platform 1,993, Installation 9, Ashworld 1,599, Jungle 3,077, Desert 1,628, Ice 2,291, Twilight 1,631. Kept by
`services/pieceStore.ts` in `handleStore.ts`' database, a store of its own (`PIECES_STORE`, the database's version 4),
one `Int32Array` of `encodeEvidence` per **`{tileset}/{tableHash}`** (`pieceLearn.ts#tableHash`: two 32-bit hashes of
the CV5's 26 words a record, from the decoded groups, which keep them all). Why the table and not the data set's id:
evidence is about one `.cv5`'s tile ids. Keyed by profile id (slice 2), the mod attached from its folder (id `release`
here, the folder's name) and the same mod installed under its own id kept two collections, so what was learned under
`release` was shown to nobody else; and a mod update that renumbers a table would have shown pieces cut for other tiles.
Learning writes under the tables of the data set in use (`loadTilesetGroups` for all eight) after deleting those eight
keys; *Forget* deletes the same eight; Preferences ▸ Storage ▸ Clear all data (`clearStoredDataAtom`) clears the whole
store and `learnedPiecesAtom`. `learnedPiecesAtom` holds what was read, by key; the Tile tab reads it on mount so
Alt+click can use it before the view has been opened, and the plugin host asks for it on first use.
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
*Left open:* the cut pieces are not named or grouped like doodads (a plugin can name its own, below); a big collection
costs one `mergeEvidence` copy per cut.

**Fill Area with a block (round 3)** floods what the Rect fill reads, `terrainKeyOfTile` (the CV5 index, or the pair for
an untyped group), not the same exact tile: on a mod's varied ground the exact-tile region was one tile (measured on
Scrap Yard in slice 2). The single-tile fill keeps the exact-tile rule.

**Blocks and pieces on the plugin API (round 3)**: `plugins-host.md` has the host side. Here: `editor/pieceList.ts`
(pure) composes what the Pieces view and `api.terrain.pieces()` list — each provided set whose pieces fit the loaded
table (`blockFits`: every non-hole tile inside the table with a picture), in registration order, then the cut entries
less any whose member has the same tile set as a provided piece (the named one wins). `declaredTerrains` makes a plugin's
declared ground `pairTerrain` with the plugin's name; `useTerrainTools.types` appends them for the tileset in front, so the
Rect tab, Replace Terrain, the fills and the status lines name them, and `terrainOf` resolves them before the generic
pair. `api.terrain.types()` still lists the game's types alone.


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

**Borrowed terrain (`editor/borrow.ts`, `editor/borrowLattice.ts`, `services/borrow.ts`, 2026-11-14).** A mod's tileset
holds another game tileset's ground copied in (Cosmonarchy's Badlands: all of Installation's typed groups but two tiles).
The isometric brush lays it by running **on the source tileset's own tables** and translating each tile it lays to a host
tile with the same picture. The spike behind it (`~/mods-under-test/_notes/borrowed-isom-findings.md`, code in the
`scm-js-borrowed-isom` worktree's `spikes/borrowed-isom/`) measured what the design rests on:
- *The copies are dithered, not index-remapped.* A nearest-colour palette map makes 28 of 893 Installation megatiles exact
  in the mod's Badlands, an empirical one 0; inside one picture the same source index lands on different host indices
  (function for 58 of 893), the host colour is among the 3 nearest 96.6% of the time, and the error falls with block size
  (2.11 a pixel → 1.34 at 8×8). And one source picture has several differently dithered copies (median 4 host megatiles,
  3 distinct pictures). So there is no exact table: matching is by pixels.
- *The copy test* (`BORROW_BLOCK` 2.5, `BORROW_PIXEL` 10): the **mean over the 64 blocks** of the 4 × 4-pixel block means'
  difference, a channel, and the mean pixel difference. Calibrated against a negative control, the same sources into the
  *game's* Badlands (none of their art): at 2.5, Installation → mod Badlands 891 of 893, Installation and Twilight → game
  Badlands 0, Ashworld → game Badlands 30 (not inspected). A per-pixel ≤ 10 rule alone admits look-alikes (45 / 189).
  **Not the same test as `tileCopies.ts#samePicture`**, which requires *every* block within 2.5 (a max, stricter than what
  was calibrated); left as it is, noted for whoever owns it.
- *Lossless prefilters.* The overall mean and the 8 × 8 means can never differ more than the 4 × 4 mean does, so a window
  on the overall mean and a coarse 8 × 8 pass at the same bound drop nothing. Per megatile only the 64 block sums are kept
  (`picturesOf`, 384 B: 15 MB for 40k megatiles, not the spike's 122 MB of pixels); pixels are read from the VR4 when a
  candidate gets that far. Installation → mod Badlands: 360 ms (Node), the host summary 164 ms once; all seven sources into
  the mod's Badlands 16 s in Node, 20–25 s in headless Chromium in slices on the page (`Slicing`, a `setTimeout(0)` every ~12 ms) — since moved to workers, see "The scan in a worker" below — JS
  heap 135 → 220 MB peak → 174 MB after.
- *Translation* (`borrowTable`): per source tile (typed groups, used slots) the host tiles showing a copy, preferring the
  same sixteen VF4 words and group flag word, then the same VF4, then any; kept only those of the first one's kind
  (`heal.ts#kindKey`), up to 8. The brush picks among them per cell by `seamStep` against the neighbours (two passes, as
  Heal), because neighbours from separately dithered copies raised the patch's internal seams 283 → 385 in the spike and a
  Heal-like choice took it to 254. Installation → mod Badlands: 1,824 tiles, identical flags 160, same VF4 849, picture
  only 813, stand-ins 2 (the spike's numbers exactly). A source picture with no copy gets the nearest within
  `STAND_IN_BLOCK` 6 / `STAND_IN_PIXEL` 12 as a stand-in (the two Substructure / Floor edge tiles: 5.2 / 7.5).
- *What is offered* (`borrowableTerrains`): a source terrain whose groups and every type on the brush's path to the
  source's base ground (`terrainTypeMap` hops: edge sets and terrains between) are whole, stand-ins at most
  `STAND_IN_SHARE` (a tenth) of a type's tiles — added after the first cut offered "Floor" in five hosts where both of
  Installation's Floor tiles were look-alike stand-ins; and not the host's own ground (every tile with a copy in a typed
  host group — the first cut offered Jungle's Dirt in Badlands). Over Cosmonarchy's eight: Badlands ← Installation (all
  seven) and Jungle (Jungle, Raised Jungle); Platform ← Badlands (Dirt, Rocky Ground); Jungle ← Badlands (Grass, Asphalt);
  Ice ← Badlands (Dirt, Asphalt); Installation, Ashworld, Desert, Twilight nothing. The host's own tileset is never a source.
*The lattice* is the source's ISOM, kept as an archive member per source (`borrowMember`, `scmjs\borrowed-<id>.bin`:
"BOR1", width, height, ERA, then (diamond index u32, value u16) for every diamond **not** the source's base ground). Base
ground = `TILESETS[era].defaultIsom` (what StarEdit fills a new map of that tileset with; Installation: Floor), chosen so a
first stroke lays what it would on a fresh source map. The member is sparse because it rides the history entry
(`HistoryEdit.members`, before/after bytes, stepped beside the pins in `stepPins`) and goes whole over a shared map
(`diffExtras` sends changed members): two Roof strokes = 54 diamonds = 336 bytes; a whole 256 × 256 map borrowed ≈ 100 KB.
Not a Scenario field and not a new atom: archive members are already per document, saved, parked and shared (the pins'
precedent). **Resize** moves it by whole rects (`resizeBorrowMember`; an odd column shift drops it) and the resize entry
now carries the moved members *and the pins* (`entry.members`, `entry.pins`), stepped in `stepWhole` — before, undoing a
resize left the pins file of the new size, which then read as no pins.
*The stroke* (`BorrowStroke`): a shadow scenario in the source's numbering — the lattice, and the source tiles it lays
(`tilesFromIsom`, cached per member object) where it is borrowed, `NO_TILE` (0xFFFF, a group past the table) elsewhere.
The sentinel matters: `IsomPass` reports only cells whose tile *changed*, and a base tile that happened to equal the newly
laid one was never translated (caught by the test comparing with the source's own map). `paintIsomDiamonds` on the shadow;
its tile changes are translated and returned as the host's changes, so **only cells the stroke changes are written**.
Pinned cells: the shadow pass skips them (`kept`). *The check* before a stroke: a borrowed rect whose map tiles
(`editorTiles`, the ground under a doodad) are not a copy of **any slot of the group** the lattice lays there goes back to
base ground (counted in the status line). By group, not exact megatile: a reopened map's shadow is laid afresh with other
variation slots than were painted — the first cut compared megatiles and reported 26 diamonds "written over" on a map
saved and reopened untouched (headless run; pinned by the test that starts the second stroke from a copy of the member).
A cell whose source tile has no host tile (a null rect) is left as it was and counted.
*Where it shows:* the Isometric tab's "From other tilesets" (`BorrowedTerrains.tsx`): a button the first time (scan in
`services/borrow.ts#scanBorrowed`, progress in `borrowScanAtom`), then per source the terrains, kept in IndexedDB
(`BORROW_STORE`, the database's version 5): `table/{host hash}/{source hash}` and `index/{host key}`, keys from
`tilesetHash` (all five files' content, not the CV5 alone: the pictures are what the table is about). Sources are the
game's own tilesets *beneath* the data set (`gameOwnTileset`: a reader's base, else the bundled files, else the stored
copy); with the game's own (or Remastered) data in use nothing is offered (`drawsFromGame`). Terrain ids
`BORROWED_TERRAIN` (0x40000) + era << 8 + index, never written; `isPairTerrain` now stops below them. `useTerrainTools`
paints one when it is the active terrain (map ISOM not required); the first stroke after picking waits for
`borrowContext` (the palette starts it on the click), else says so. Status line: tiles, joins to the map's own ground over
`SEAM_SHOWS`, untranslated, stand-ins, reset diamonds. Measured in headless Chromium on Butcher's Corner with the mod's
folder attached: scan 20–25 s; two joining Roof strokes 176 + 110 tiles (18 / 26 joins showing); undo, redo; Save As,
reopen, a third stroke joined with no reset; Walkability overlay over it; no page errors.
*Left open:* borders were left to drawn borders (below); no rebuild of a lattice for borrowed ground laid without the member (another
editor, the mod's own maps: they start from base ground); walkability is the copies' (462 of 891 Installation megatiles
have a copy that walks the same in the mod's Badlands); the eyedropper does not pick a borrowed terrain; one source per
stroke.

**The scan in a worker (`services/borrowTableClient.ts`, `services/borrowTable.worker.ts`, `editor/borrowWorker.ts`,
2026-11-14).** The tables are worked out in a pool of module workers; the page reads the sources, hashes them, reads kept
tables from IndexedDB, lists the terrains and stores what lands — short steps — and nothing else.
*Shape.* `editor/borrowWorker.ts#borrowWorkerHandler` is the whole worker as a function (a Node test drives it); the worker
module only wires it to `self`. A worker is given the host once (`{kind:"host"}`), then one source at a time (`{kind:
"table", id}`), so `picturesOf(host)` (WeakMap per Tileset object, rebuilt from the parts once) runs once per worker per
scan; it answers `progress` (at most every 100 ms) and the `encodeBorrowTable` Int32Array, its buffer transferred. Tilesets
travel as `TilesetParts`: palette, VR4, VX4 refs, VF4 and the groups packed 18 words a group (index, flag word, sixteen
megatiles) — not 4,094 `Cv5Group` objects; the arrays are the editor's own, so they are *copied* by the clone, never
transferred (that would detach the open map's tileset). For the worker to stay small the table half of `borrow.ts` is its
own module, `editor/borrowTable.ts` (`borrow.ts` re-exports it, so nothing that imported `borrow.ts` changed), and
`heal.ts#kindKey` moved to `formats/tileset/kind.ts` (re-exported by `heal.ts`): through `isom.ts` and `data/tilesets.ts`
the worker would otherwise carry the CHK scenario module and the i18n catalogue. The worker chunk is 5.3 kB.
*Who uses it.* `services/borrow.ts` takes a `BorrowTableMaker` (`ScanDeps.tables`, default `setBorrowTableMaker`'s, else
`slicedTableMaker`, today's path). `main.tsx` sets the worker client, so the command line, `@scm-js/core` and the headless
plugin host (none of which load `main.tsx`) never reach `new Worker(new URL(...))` and keep the sliced path — unlike
`extract.worker`, whose construction the SSR build leaves in the CLI bundle where it only fails at run time. The scan asks
for every missing table at once; the client queues them over the pool; a `WorkerUnavailableError` (no `Worker`, a worker
that would not start or failed: `onerror` rejects everything it and the queue held and marks the client broken) sends that
table to the sliced maker, which runs one table at a time. Workers are terminated when the queue empties (each holds a copy
of the host and its summary). `api.terrain.borrowed({ scan: true })` in the editor gets the workers for free.
*Stop.* `stopBorrowScan()` aborts the scan's `AbortController`: the client terminates the workers, the sliced maker checks
the signal before a table and at each pause, the scan checks it before publishing; it rejects with an `AbortError`
(`isStopped`) and publishes nothing. Each table is stored as it lands, so a stopped scan's finished tables are read back
next time (measured: a second scan after a Stop at 4 s took 5.4 s). The palette shows **Stop** beside the progress.
*Measured* in the built bundle (`vite preview`, headless Chromium, Butcher's Corner, the mod's folder attached, all seven
sources worked out; page busy = the sum of the gaps in a MessageChannel heartbeat; RSS = the whole browser process tree;
a High Dirt stroke painted 4 s into the scan, press to status line):

| path | wall | page busy | longest page task | stroke | RSS peak over before |
| --- | --- | --- | --- | --- | --- |
| page, sliced (no `Worker`) | 22.9–23.5 s | 17.6 s (75%) | 67–69 ms | 195–203 ms | +99–126 MB |
| 1 worker | 15.5 s | 1.65 s (11%) | 23 ms | 108 ms | +155 MB |
| 2 workers (chosen) | 9.3–10.1 s | 1.25 s (12–13%) | 25–26 ms | 120 ms | +243–267 MB |
| 3 workers | 7.0–8.0 s | 1.05 s (13%) | 40–54 ms | 111–124 ms | +339–422 MB |

Each worker costs about 90 MB of the process tree at peak (freed when it ends). The clone: 45.6 MB in 32 ms of
`postMessage` for two workers (two host copies of ~17.8 MB and seven sources), 29.4 MB / 21 ms for one, 61.7 MB / 45–59 ms
for three — back-to-back host clones are what the longest page task grows with. Worker time summed 15.7–17.7 s, the
longest single table 3.3–3.7 s (Jungle into Badlands), which bounds what more workers can win. So `POOL` is 2, bounded by
`navigator.hardwareConcurrency - 1`: one to two halves the wait for ~90 MB; two to three saves 2 s more for ~90 MB and a
longer stall. All seven tables are byte-identical to the page path's (an FNV checksum of every stored Int32Array,
Installation's among them). The scan's one log line (always on, counts only) gives `ms`, `onPage` (tables that fell back),
`workers`, `hostPosts`, `postMs`, `clonedMB`, `workerMsMax`, `workerMsSum`. Another map in front mid-scan (on Ice) broke
nothing: the result is published by host key and was there on coming back. The desktop app serves `app://scmjs/` as a
standard, secure scheme through `net.fetch` of the file, as for the transpile and extraction workers built the same way;
not run in Electron. `tests/borrow.test.ts` "the scan's worker": the handler against `borrowTable`, the pool through an
in-process fake `Worker`, the fallback without `Worker`, a failing worker, a stop.

**A mod's terrain file in the editor (`services/dataSetTerrain.ts`, `editor/terrainFileSection.ts`,
`services/terrainFileSave.ts`, 2026-11-14).** While a data set whose kept `terrain.json` (gamedata.md) is in use, its
sections go into `providedPiecesAtom` / `providedTypesAtom` / `providedBorrowAtom` under the provider
`@dataset:<id>` (`pieceList.ts#DATA_SET_KEY`; `@` cannot start a plugin id), so every reader that serves the plugins'
declarations serves the file's: the Pieces view (a section headed with the data set's name), the Rect tab and fills
(declared pair terrains), the Isometric tab's "From other tilesets" with no scan (`refreshProvided` → `providedTable`).
*Precedence:* a plugin's row goes in ahead of the data set's (`beforeDataSet` in the three `provide*` writers), and every
reader lets the first of a duplicate stand — `pieceSections` now drops a later set's piece whose tiles an earlier set
listed (this also settles two plugins naming one piece: the first registered wins), `declaredTerrains` already did,
`refreshProvided` keeps the first table per source. The file wins over learned and scanned (provided sets come before
the cut; a provided source replaces the scanned one). *Fit:* a section is used only when its `table` equals `tableHash`
of the tileset's groups in the data set in use (`loadTilesetGroups`, CV5 alone); otherwise a warn toast once per
(set, tileset, table) and nothing of it is provided. *Lifecycle:* `applyDataSetTerrain` removes every `@dataset:` row
then adds the current set's (a generation counter drops a stale apply); another data set or the game's own leaves none.
Per data set, not per document: nothing in `parkRegisters`, and nothing is written to a map (shared maps unchanged).
*Regression found on the way and fixed:* `BorrowedTerrains` now calls `refreshProvided` on every mount, and an unscanned
host with no provided table got an empty `borrowHostsAtom` entry, so the palette said "No other tileset's terrain is
whole" instead of offering the scan. `BorrowHostInfo.scanned` now separates "scanned, nothing found" from "only provided
tables known"; an entry that is neither is not published (`tests/borrow.test.ts`).
*Writing:* the Pieces view's **Save as a terrain file…** (`FileDown` icon beside Learn from Maps…) →
`services/terrainFileSave.ts` (loaded on click): `terrainFileSection(tableHash, sectionsFromStore(...), declared types,
tables of every known source via borrowContext)` — pieces as listed (provided first, cut entries folded, duplicates by
block dropped), all of a table's choices as pairs, its stand-ins — merged into the chosen file through
`mapIo.ts#saveComposed` (new: picks the place, reads what is there, then writes; a download starts from the data set in
use's kept file, else empty). Measured on Butcher's Corner with Cosmonarchy's folder attached, built bundle: learn 404
maps 26.5 s, scan 9.4 s, save → 518,081 bytes, 3,373 pieces, 7 borrow tables (9,627 Installation pairs, 9,714
Jungle…); `readTerrainFile` 4–7 ms in Node. Added as a data set from a copy with the file: the Pieces view lists 3,414
pieces under the set's name with nothing learned, the Isometric tab lists Installation and Jungle World with no scan
(the same as the scan; the file without `standIns` had listed Ashworld too, see mods.md), a Roof stroke lays 208 tiles.

**Drawn borders (`editor/borderLattice.ts`, `borderTable.ts`, `borderPass.ts`, `borderRecord.ts`, `services/borders.ts`,
2026-11-14).** Where borrowed ground meets the host's own, a mod's maps lay purpose-drawn pieces. The spike
(`~/mods-under-test/_notes/borders-findings.md`, "Round two"; code in the `scm-js-borders-spike` worktree's
`spikes/borders/`) found the method; this is it, built.
*Shape of a border cell.* The patch's diamonds are laid with the game's brush on a **stand-in** pair of the game's own
terrains (`borderLattice.ts#standInShapes`): flat set when patch and ground are one height (Badlands Grass/Dirt, set 20),
the cliff set (High Dirt/Dirt, set 34) when the patch is higher or lower (`standInFor`, by `megatileHeight` of the
host's copies of X and its Y ground). Every cell the stand-in lays an edge-set tile on is a border cell; its shape is the
edge group's four side links (`A` the ground's soft link, `B` the patch's, `h<n>` hard), the stack values, and `|L`/`|R`.
The stand-in is the game's own Badlands beneath the data set (`gameOwnTileset(store, 0)`, `badlandsStandIns`); a test
hands in its own (`tests/support/borderWorld.ts`, whose set 20 the gated test checks against the game's, link for link).
*Learning* (`borderTable.ts`, evidence a map at a time like `PieceEvidence`: per pair, maps seen and per reading
shape → tile → count; `encode/decodeBorderEvidence` JSON; `mergeBorderEvidence`; `cutBorderTables` picks per pair the
reading — transition cells as neither terrain or as the ground — whose tiles keep to one shape most). Cell classes
(`cellKind`): **X** a host megatile that is a copy of a source *flat* terrain (by every known source's borrow table,
`borderClasses`, packed `era << 10 | index`); **Y** a host typed flat terrain **by picture** (typed pair groups' megatiles,
and any megatile with the same pixels — mod maps lay their ground from untyped duplicates, which first cost Floor/Dirt
6 of its 9 maps); **T** an untyped tile that is no copy of any known source and no picture of the host's typed sets.
A pair is read where a T cell has exactly one X and one Y next to it; for a pair a map shows none of those, within two
cells (a two-cell-thick drawn border; the synthetic world needs it). Using the two-cell reading for every pair made
Floor/Dirt worse (8.8 joins/100 against 1.8): it is the fallback only. **Every known source helps**: with only
Installation's table, other tilesets' copies in the mod count as T and Floor/Dirt read 3 maps, 14–19 joins/100; with all
seven, 8 maps, 0–7 (below). So `services/borders.ts` learns with all known tables, and borders need the scan (or a file's
tables) first; the learn report says so when none is known.
*The pass* (`borderPass.ts#layBorder`): candidates the shape's 8 most-laid tiles, then the sheet pool (untyped non-copy
tiles in groups within 2 of the table's, `sheetPool`) at a cost of +6; cost = Σ positive `seamStep` over 4 neighbours,
passes until settled; a cell whose worst join > `SEAM_SHOWS` gets the pool first, then goes hard (X tile if it leans to
the patch, else the ground's own tile before). Two changes from the spike: **the ground's own tile stays** on the
ground's side wherever it joins (`kept`: no rubble on plain dirt, the spike's `c2`); **exact pruning** of pool
candidates by a lower bound from per-side edge means (|mean diff| ≤ mean |diff|, so the bound never cuts a winner).
*The stroke* (`BorrowStroke`, opts `{ record, borders }`). `finish` now always **settles** the stroke's box plus margin
(`settle`): the map before any borrowed stroke rebuilt from the record, every cell of the window laid as the patch says —
outside the patch its host tile, inside it the lattice's tile (a copy of any slot of the group stands), and with a setup
each border cell whose pair (X from the diamonds around, Y the commonest host terrain within 2 cells before any borrowed
stroke) has a table goes to `layBorder`; without a table, as the brush lays it. Its changes come back in
`result.changes`; the hook applies them and adds them to the same `Stroke`, one undo step. Live strokes show the old
output while dragging; the border comes on mouse-up. *What the patch is* (`inPatch`): the diamonds the brush painted (the
record's `painted`, with the terrain painted, base ground included), else a flat non-base value (maps from before the
record); a painted diamond the brush changed since (an edge, a buffer) is the patch only between borrowed terrains — at
host ground it is not. Three rules came from the browser run, each from cliff walls laid where ground was taken back:
that one; an inner cell whose lattice tile is the source's edge to its base ground next to host ground takes the
patch's flat tile (`nearGround`); with a setup, a cell no stand-in reaches and no patch is near (`nearPatch`) is host
ground (the lattice's leftover edges). And `takeBack` paints only borrowed diamonds (base over host ground laid edges
around nothing). *The check* (`checkAgainstMap`) where a record or
setup exists looks only at rects inside the patch, and there accepts an untyped tile in a recorded cell (a border piece
the cliff stand-in reached inside with); without that, 150 random strokes found 9 false resets, now 0.
**Base ground**: Installation's Floor is its base, so a Floor patch was invisible to the lattice (the old brush laid
partial Floor rects with no edges); `painted` makes it a patch, and the settle lays it whole. **Take back**
(`TAKE_BACK` = index 0xFF, `takeBackId`, a row per source in the list): paints base on the shadow, unpaints, restores
recorded cells; the settle relays the border. All strokes then all taken back → the map byte for byte (tests).
*Review round (2026-11-14).* Two defects in the browser pictures, both reproduced as pure strokes in the gated suite
("the browser session's strokes": the session's pointer path, a brush application per new diamond as the hook does; the
map pixel is 100 left and 50 up of the tile grid the driver named). **(1) Wall pieces left on Dirt after a partial
take-back.** Cells beside painted Substructure diamonds that the take-back's brush turned into edges found no patch
terrain (`xOfCell` read only `inPatch`, which says "not the patch" there), so with no pair they fell to "as the brush
lays it" and kept the source's cliff. Now `xOfCell` looks two diamonds out and then at the painted terrain around, and,
with drawn borders, a cell whose patch terrain is still unknown is host ground. It also no longer falls back to the
stroke's last painted terrain: the answer must not depend on which stroke asks (an audit stroke disagreed with the
painting one). **(2) Floor cut in blocks against Substructure.** The inner-cell rule replaced the lattice's tile with the
patch's flat tile whenever ground was within a diamond (`nearGround`); where two borrowed terrains meet beside Dirt that
overwrote their own edge. It now looks only at the rect's own diamonds (`onGround`). Not a reopen effect: it failed in one
session too. What is left at that junction matches the source's own lattice cell for cell (mean colours compared; the
straight vertical boundary is Installation's own vertical edge, and the door is a variation of the cliff group, picked at
random as the game does), except rects that touch the tileset's ground, which are border cells by design.
Tried and dropped: unpainting the brush's buffer on take-back (it unpainted Floor/Substructure junction edges within
reach and made new holes); taking a painted edge as the patch whenever two painted terrains are around (no change).
**Guards:** `BorrowStroke.strays(box)` — cells no patch diamond touches and no stand-in of their own pair names, not at
their host tile (a pair without a table is laid as the brush lays it and is not counted) — checked after every
drawn-border stroke in the random tests (CI and the mod) and the session test; `latticeEdgesBroken` (rects of two
painted terrains with painted ground all round must hold copies of the lattice's tile) after every stroke, in one
session and after encode/decode. Both fail on the old code. Also a kept ground half whose rect partner is drawn now
takes the shape's own tile where one joins (+1–2 drawn cells on Substructure, +5–12 on Floor/Asphalt; joins unchanged).
Checked, not changed: `d30`'s straight cut is the settle's own outcome (a whole-map settle afterwards changes 0 cells),
not the write window; `d23`'s missing trim is hard cells on the right lobe (`h49,A,A,h49`, `B,h49,h49,B`,
`h52,h54,A,A`, 3–26 tiles each, none joining there) plus kept ground halves elsewhere; no shape there has a variant
under another stack value in the table.
*Record* — a **second member**, `scmjs\borders-<id>.bin` "BRD1" (w, h, era, painted diamond count, cell count, (u32
diamond, u16 terrain) painted, (u32 cell, u16 tile) cells), not a BOR2: an editor that reads only BOR1 still reads and writes the lattice and
carries this member untouched (archive extras), so older and newer editors both open and save without loss. A record
an older editor left stale is read with care: a recorded cell now holding typed host ground is dropped. It rides
`HistoryEdit.members`, resize (`resizeBorderRecord`, beside the lattices in `resizeDocumentAtom`), save and shared maps
like the lattice (members are synced whole).
*Where tables come from* (`services/borders.ts#borderTables`, per pair, first stands): plugin
(`providedBordersAtom`, `beforeDataSet`) > data set's terrain file (`borders` section → same atom under `@dataset:`) >
learned (`learnedBordersAtom`, IndexedDB pieces store `borders/{host tilesetHash}/{source tilesetHash}`, so Forget and
Clear all data drop it). `prepareBorders` loads the stand-in, all known contexts, the learned evidence, and warms the seam
measures (`warmBorderPass`; the first pass on the mod's 23,772 megatiles otherwise pays ~900 ms). `peekBorderSetup` is
null with the switch off (`drawnBordersAtom`, stored as `scmjs.drawnBorders`, default on; memory storage in Node and the
headless host, so on there), unprepared (it starts) or no table.
`refreshProvided` drops the scanned contexts too, so the panel re-reads them after it (its hovers went blank once).
*Numbers* (Cosmonarchy's Badlands, 57 Badlands maps of CMBW-maps, all seven sources known; spike in brackets).
Tables: Substructure/Dirt 10 maps 29 shapes (29), Floor/Dirt 8 maps 36 shapes (43), Floor/Asphalt 8 maps 36 (37); pools
897 / 219 / 326 (938 / 335 / 218). Joins showing per 100 border cells, brush patches drag / notch-and-bar / two strokes:
Substructure/Dirt 5.1 / 3.3 / 2.2 (7.4 / 5.4 / 7.1), hard 18 / 17 / 8 (25 / 27 / 24); Floor/Dirt 7.0 / 1.8 / 0.0
(7.0 / 7.9 / 0.9), hard 34 / 13 / 5 (53 / 54 / 16); Floor/Asphalt 0.0 everywhere (blind measure, as in the spike), hard
0. Pass times (Node, warm): Substructure/Dirt 69 / 127 / 131 ms, Floor/Dirt 21 / 30 / 18, Floor/Asphalt 9 / 17 / 28 —
under 150 ms, so it runs on mouse-up in the stroke, not deferred. In the built bundle the mouse-up of a stroke took
36–132 ms (5 ms without borders). Record 1.8–3.0 KB a patch (6 B a cell, 6 B a painted diamond); 3.2 KB after two
crossing strokes; after the browser session (seven strokes, a take-back, Save As, two more) lattice 768 B, record
3,084 B (86 diamonds, 425 cells).
Learn from Maps over 404 maps: 26 s with borders (the same as without), 74 pairs.
*Dead ends (spike):* same-picture shape classes (≤1% of cells), the sheet pool without the judge, choosing a rect's two
tiles together from the pairs maps lay. *Here:* reading pairs within two cells everywhere (above); the brush's edge ring
as part of the patch (an edge-valued diamond widens the stand-in's patch by a ring).
*Left open:* shapes no map lays stay hard (the cliff sets' inner corners mostly). "Unlike either side" (`borders.unlike`)
counts walkability only since 2026-11-14 (it counted buildability too, which flagged nearly every cliff piece; numbers in
"Follow-ups" below). The
stand-in is the game's Badlands for every host, so a host era with other cliff heights is read through Badlands' shapes.
`tests/borders.test.ts` (made-up world in CI: learn from a map, lay, pins, take back, many strokes, save and reopen;
gated: set 20 against the game's, the game's own maps learn nothing, the mod's numbers).

**Drawn borders, follow-ups (2026-11-14, branch `borders-followups`).** The switch is stored (`scmjs.drawnBorders` in
`STORED_RESETS`, `RELOADS` and `storedLabels.ts`; `atomWithStorage` + `getOnInit` + `createJSONStorage(browserStorage)`,
as `debugConsoleAtom`). The panel shows it unchecked and disabled where no border is known without writing it. Clear
all data now also empties `learnedBordersAtom` and the data set's rows of `providedBordersAtom` live (their store was
already cleared). The status line's count is walkability only: a drawn tile counts when its walkable minitiles
(none / some / all) differ from both the patch's tile and the ground's.

**Copied terrain (`editor/terrainCopyTable.ts`, `editor/terrainCopyLattice.ts`, `services/terrainCopies.ts`, `atoms/copyAtoms.ts`,
`plugins/copies.ts`, `components/panels/CopiedTerrains.tsx`, 2026-11-14).** A mod's tileset holds one of its own typed
terrains S again under other flags (`terrainCopies`: the untyped pair S′, "Mud (mid ground)") and, often, S's edge set E
again beside it: untyped tiles keeping each E piece's picture where the piece shows S, the other side repainted as the
ground G the copy is meant to sit on (Cosmonarchy's Jungle: Mud mid/high × 3 grounds each). Two spike rounds
(`~/mods-under-test/_notes/repointed-isom-findings.md`, code in the `scm-js-repointed-spike` worktree's `spikes/repointed/`;
"re-pointed" was the spike's word, the code says *copied*) found the method; this is it.
*The rule* (`findCopyBlocks`, pure, worker-safe: no scenario, no i18n). Per copy S′, per **flat/flat** set E naming S (cliff
sets are left out — their faces' walk/height bits are drawn by hand: 40% of the cliff pieces failed the flags test,
synthetic cliffs recovered 63% with 7% wrong): candidates are megatiles of untyped groups no typed group uses (S′ left
out); a pair (m, e) shares a whole 8 × 8 minitile at the same place (index), keeps ≥ `KEPT_BLOCKS` (2) whole 4 × 4 blocks of
e (chance does not make those: against another tileset's art the best kept share is ≤ 30% of pixels and no whole blocks),
and the minitiles it keeps whole stand higher by the copy's raise (majority) — else it is another copy's piece. A tile's
best pieces are those within `TIE_PX` (16 px) of its best. *Blocks*: the groups holding candidates, cut where more than
`CLUSTER_GAP` (3) groups hold none, each judged alone (a mod holds the same pieces several times for other grounds). *Layout
found, not assumed*: each E half's row and each variant's slot by side, believed with `LAYOUT_AGREE` (0.6) of the votes,
places the pieces that keep too little S for pixels (mostly-O corners) and breaks ties between variants; a shuffled block
has none (synthetic shuffled: 53% recovered against 76–78% laid out). Pieces whose picture is S alone map to S′'s tile.
Reported when ≥ `MIN_SHAPES` (4) halves and ≥ `MIN_SHARE` (0.5) of them have a piece by pixels — false blocks/sets measured
max 0.42 (p90 0.38) on the synthetic mods, true median 0.58. *One set per block*: each block megatile votes for the set one
of whose pieces it keeps most of (a share of shapes was tried first and favoured small sets: Ice's Snow/Dirt block lost to
Snow/Rocky Snow). *Block key* = two hashes of its tiles' pictures, so a mod update that moves groups finds it again.
*The gate* (`gateBlock`, then on the page `GATE_JOINS`): **askable** halves = E halves that are first in the tileset for their rect's link hash (what
`IsomPass.updateTile` takes; for every set found that is all halves) — each needs a tile (any slot: the game picks any
variation); and the drawn pieces walk as their source pieces with heights raised by the copy's raise on ≥ `GATE_FLAGS`
(0.99) of minitiles, their buildable bit changing as the copy's on ≥ 0.99 of pieces. "rejected" (not listed), "incomplete"
(listed after, marked), "complete". On the page a block that passes is also refused when, on its own outer ground, it
shows more than `GATE_JOINS` (30) joins per 100 border cells beyond what the game's own set shows on the same strokes (S over
O): on Cosmonarchy the blocks that lay well are 0–22 above, the fragments 70–95 above. Measured: every complete clean block 100.0%/100%; the highest failing complete block
96.5% (a Desert block that showed 53.6 joins/100 on its ground); complete cliff sets 88.6–89.8%. Synthetic: none left out →
complete 5/5; half the pieces left out → incomplete 4/5 (the fifth kept a same-picture tile in every half).
*Controls* (spike): the game's eight tilesets yield no copies and no blocks (CI-gated test); synthetic mods 3 layouts × 5
tilesets: recovered 53–78%, wrong 5–9%, a left-out piece never given a wrong tile; Blizzard's twins (High Sand Dunes' sets
made anonymous) found as re-pointed Sand Dunes sets, 3,144 right / 90 wrong over 22 twins; the hand-made Jungle Mud
correspondence 113/120 same tile, 7 same picture.
*The outer ground* (`rankGrounds` + `paintCount` + `chooseOuter`): candidates = top `GROUND_CANDIDATES` (8) grounds (typed flat
terrains, loose pairs outside the block) by mean `seamStep` across the pieces' O-facing sides; each counted by painting the
fixed strokes (`countStrokes`: a diamond, blobs 2–5, lines, an L, a ring, a blob with a hole, four walks) on a 48² map of it,
joins showing per 100 border cells; lowest count, ties within `COUNT_MARGIN` (1 join/100) by the repainted minitiles' VF4
words, typed first. Measured: game sets 88 right + 17 twin of 112 (old mean-step 88 + 16), twins 14/16 (13), the hand-checked
high Mud block's ground right (pair 3672, 7.7 vs next 14.0; the mean step had picked another pair).
*At stroke time* (`chooseBlock`): of the terrain's blocks (complete ones, else the incomplete), the one whose count on the
ground under the stroke (`groundUnder`: the commonest ground round its first diamonds) is lowest; laid against that ground
when its count is within `COUNT_MARGIN` of the block's own outer ground's, else against its own. The palette lists one entry
per source terrain and height (`copiedTerrainId` = `COPIED_TERRAIN` 0x48000 + height << 8 + index, never written).
*The stroke* (`CopyStroke`): a shadow scenario of the tileset's own numbering filled with O, S painted with
`paintIsomDiamonds`; cells the shadow makes S or an E piece are written translated (S → S′ by slot; a piece → its tile, else
another slot of its half, else — incomplete — the pool's best `seamStep` join, counted in `missing`). When G is typed and the
map has ISOM, G is first painted with the game's brush on the real lattice over the footprint and its ring (`applied`/`isom`:
already applied, recorded in the stroke for undo), so the lattice says G under the patch and the game borders it as G. When G
is a loose pair the lattice cannot hold it: a diamond whose rects (and ring) are not already G (or the patch) is refused and
counted ("left: drawn for X which is not under it"). Pins are kept. Symmetry as the isometric brush (`mirrorPixel`).
*The member* `scmjs\copies.bin` "CPY1": w, h, ERA, patch count; per patch S, height, block key, ground id (`t<n>`/`p<group>`),
diamonds (u32, `y * (isomWidth + 1) + x`). One per map. Rides `HistoryEdit.members` (stroke, re-lay), Resize
(`resizeCopyMember`, whole rects; an odd column shift drops it), save, parking and shared maps as the borrowed lattice. A
member for another ERA reads as empty: after Change Tileset it is ignored (not deleted: changing back finds it again,
and the whole-map entry needs no member). A patch whose block key or ground is not known (another version of the mod's
art) is left as laid and never re-laid.
*Re-lay* (`relayCopies`, in `useTerrainTools.endStroke` after every game isometric and borrowed stroke, same entry; only
patches the stroke came within two diamonds of): keep the footprint diamonds the real lattice holds as G with their four
neighbours, and whose rects hold only tiles the patch could lay; then **shrink** until every cell the shadow names lies on
rects of G alone; rewrite the shadow's cells; a cell the patch held that it no longer does takes the tile the real lattice
lays (`tilesFromIsom` on a scratch copy). **A tile that is neither the patch's nor its ground's is never written over**,
in the shadow or out of it: someone laid it over the patch since (the Rect or Tile brush, a borrowed stroke), and a re-lay
set off by a stroke two diamonds away must not take it back (review, 2026-11-14: before, a kept neighbour's edge ring
re-laid such a cell, and a cell the patch gave up went to the lattice's tile whatever it held). Measured on the mod's Jungle (mid Mud on Jungle, G laid first, the game's Jungle
painted 2–3 diamonds away from four sides; joins showing in a 32 × 24 window, the patch alone 16): no re-lay 23–26; re-lay
without the shrink 17–23 (hard cuts left); with it 5–12, cut joins 1–5. A 3-diamond patch that close is given up entirely
(its remaining G cannot hold a diamond with its ring). Heal and Blend rewriting patch cells are not re-laid; a later copy
stroke's check drops diamonds whose rects hold foreign tiles.
*The scan* (`services/terrainCopies.ts`): by itself when the map in front's tileset has a copy (`watchCopiesInFront`, from
App; polls `peekTileset` while it loads); the pixel part in the borrow worker (`{kind:"copies"}`, its own worker started and
ended for it, `borrowTableClient.ts#workerCopyScan`, set in `main.tsx`; `TilesetParts` now carries `links` so the worker sees
edges and stacks), else sliced on the page (CLI, core, headless host); then counts on the page with a pause between grounds.
Kept in `BORROW_STORE` under `copies/{tilesetHash}` (`KEPT_VERSION`), cleared by Clear all data (which empties
`copyHostsAtom`; the next tileset change scans again). Measured on Cosmonarchy's eight (Node): the rule 1–650 ms a tileset; the
whole scan as the editor runs it (rule, the counts of every offered block, the gate) 0.01–6.9 s (Twilight, 30 blocks), the
counts dominating: each ground's count is ~50–80 ms, one slice on the page. Moving the counts into the worker would need
`isom.ts` there (with the scenario and i18n modules it imports): left open. In headless Chromium (dev server, Jungle) the list
was there by the time the mod's folder was attached; not timed further.
*Tiers*: plugin `provideCopies` > data set's `terrain.json` `copies` (`@dataset:` rows) > the scan, per (source, height).
The spike's "maps' commonest neighbour" tier is **not built**: the learned collection keeps sheet joins, not neighbours;
the stroke-time choice reads the map's own ground instead, which agreed with the maps on 10 of the 12 offered blocks.
*Dead ends* (both rounds): "explained pixels" (repaint = G's pictures at the same place: 70% of the worked example's
repainted minitiles exist nowhere else); a colour-histogram ground choice; the share-of-shapes winner; growing the stroke to
avoid missing shapes (4 rounds add 500–2,800 diamonds, the missing share barely moves); the source piece as fallback (2–10×
the seams of the seam/flat fallbacks); mean seam step alone for the ground (wrong on the hold-out); reading the mod's maps'
lattice to compare (the maps lay these blocks freehand: 10–55% shape agreement).
*Left open:* cliff sets; a layout-free fallback for the mostly-O pieces of a shuffled block; Heal/Blend inside a patch;
the maps tier; one terrain per stroke (no take-back).
`tests/terrain-copies.test.ts` (a made tileset in `tests/support/copyWorld.ts`: three layouts, incomplete, rejected, key across
layouts, ground, stroke, pins, pair ground refused, member round trip/resize/save, undo, re-lay; gated: the game's eight,
Blizzard's twins; `SCMJS_COSMONARCHY`: offered blocks complete with flags ≥ 0.99).
