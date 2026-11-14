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
