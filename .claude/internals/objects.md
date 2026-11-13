# Sprites, doodads, locations and fog of war

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

### Doodads (`src/editor/doodads.ts`, `src/hooks/useDoodadTools.ts`)

A doodad is three things: its tiles in `MTXM` only (`placeDoodad` writes nothing to `TILE`, so the
ground beneath survives there), its `DD2` record, and the overlay sprite in `THG2` when the CV5
group names one. `DoodadEdit.tiles` are therefore **MTXM-only** changes (`applyChanges(…, "mtxm")`,
`HistoryEntry.doodadTiles`), and `removeDoodads` puts the ground back from `TILE` through
`groundUnder`. `convertDoodads` (right-click ▸ Convert to Terrain, the panel's *To terrain*,
`tx.convertDoodads`) is the one operation that crosses over: the record goes, the overlay stays as a
plain sprite, and the tiles are re-recorded as **terrain-layer** changes `{ before: id, after: id }`
so `applyChanges` copies them into `TILE` and undo (`under`) puts the old ground back. Writing them
into `TILE` is the point — a terrain-only copy, the ground that returns when a later doodad leaves,
and anything else reading `TILE` now sees the converted tiles as ground; dropping the record alone
would have left those readers showing dirt under a ramp the map still draws. `Stroke.finish` keeps a
change whose `under !== after` even though `before === after`, which is what lets a plugin's
transaction merge a conversion with a stroke over the same cell in one entry. Cells another edit has
covered since, or that `TILE` already holds, are skipped. `DoodadPlacementOptions.asTerrain` (the
palette's *Place as terrain*, off by default) makes `placeAt` go through `placeDoodadAsTerrain` instead:
the same stamp as terrain-layer changes plus the overlay sprite, no record, one entry with `changes`
and `sprites`. It is the palette's option only — `tx.placeDoodad` ignores it, since a plugin says what
it means by calling `convertDoodads`.

**Stretching (`src/editor/stretch.ts`, 2026-11-13).** A drag while a doodad is armed pulls it out along
one of four axes — `se` (2, 1), `ne` (2, −1), `e` (2, 0), `s` (0, 1); the across step is two tiles
because ground is drawn in left/right halves — and places the result as terrain. Why it exists: the long
ramps and bridges of modern maps are doodads pulled apart by hand with the middle laid again in the gap.
The cells of the piece on one line along the axis are a *line*; a stretch by `n` repeats one cell of
every line `n` times. `stretchPlan` picks that cell per line (the *cut*) by coordinate descent on the
total `edgeDistance` (blend.ts) of the piece stretched three steps, starting from the cut straight across
the centre, with (a) a tile beside bare ground costing `BARE_COST` unless the piece as shipped leaves
that side of that tile bare, and (b) a small pull towards the centre. Both were found the hard way:
the first version repeated the middle *index* of each line and laid wall rocks instead of ramp on the
lines whose middle cell is wall (Badlands #77, line through (1,3)/(3,4)/(5,5)); the second treated a
missing tile as free and the optimiser opened holes all over the Platform bridges' decks, since a hole
has no seam. Plans are cached in a `WeakMap` on the piece's `tiles` array (a catalogue's defs are made
once per tileset); the largest doodads plan in ≤ 12 ms an axis.
Measured over the eight tilesets (the mean edge distance of the joins a stretch adds, against the Blend
brush's 16 for a visible seam): bridges along their deck — Badlands 10, Platform 5–7, Jungle 11–13 (drawn
to repeat; they look seamless), Twilight 15, Desert 20, Ice 26; cliff ramps along their cliff — Ashworld,
Twilight, Low Platform 10, Desert 7, Badlands/Jungle 17, Ice 20 (a join every two columns, which is what
hand-made long ramps look like too); wall ramps (Structure, Temple, Compound, Outpost, Basilica) 18–50,
no repeating middle. The fill of a cliff ramp along its cliff is > 90% walkable in every tileset, and on
a plateau painted with the isometric brush a stretched ramp passes `checkDoodadPlacement` wherever the
cliff runs straight for the stretch, on the cliff's diagonal only — `required` is stretched with the
tiles, so the existing check, ghost and red cells needed no change. `stretchDoodad` returns a
`StretchedDoodad`: a `DoodadDef` with the larger footprint plus `stretched` (`from`, `offset` of the
top-left tile, the plan), which is why `ghostAt`, `checkDoodadPlacement`, `drawDoodadGhost`, the
symmetry images and `placeDoodadAsTerrain` take it as they take any def; only the overlay's position
reads `stretched` (one overlay, where the doodad as shipped stands). It is never a DD2 record — the id
names the shipped footprint — so `placeAt` goes the `asTerrain` way whatever the palette's tick says.
The gesture: `ObjectLayer.stretch` (doodads only) turns a placing press that travels into mode
`"stretch"` instead of `"marquee"`; `stretchFromDrag` takes, among the axes it is given, the one the
drag lies closest to (distance from the pointer to the axis, among axes with at least one step).
**Which axes it is given is `soundAxes`, and that rule is the part that cost the most.** The user's first
try produced junk on three of four drags: a ramp smeared across its cliff, a bridge widened into rail
ends. The seam measure does not tell those from the good ones (Badlands #77: 16.5 along the cliff, 13.3
straight down, 17.2 across, 20.4 on the other diagonal). What does, over all 40 ramps and 18 bridges:
(1) for a ramp, `groundContinues` — the share of cell pairs one step apart whose `required` group is the
same — is 78–100% on exactly one diagonal, the cliff's, and ≤ 54% elsewhere, which is also the axis the
ground check accepts on a painted cliff; (2) for anything else, `walkBreaks` — the share of minitile pairs
facing across the added joins that differ in the VF4 walkable bit — is 0–11% along a bridge's deck and
13–50% across it (`SOUND_WALK_BREAKS` 0.12; the gap is narrow at the Ice bridges, which join badly either
way). The ground rule must not be asked of bridges: their ground continues *across* them, along the
channel (Badlands #329: 83% on the junk axis). Shift (`any`) offers all four.
A ramp must also have `islandsPerStep === 0` on that axis. The user's next question was a picture of the
Badlands Structure ramp (#45, 4×4): its ground continues along the wall, so it was offered, and stretched
it is a row of half ramps with wedges of wall between them (34 of 128 added minitiles unwalkable, seam
49) — every line along the wall has two cells, a side each, and no middle. The cliff ramps, Low Platform,
Platform Wall #159, Compound #190/#197 and the catwalks pass; the other wall ramps (Structure,
Substructure, Temple, Outpost, Basilica, and the twins of the three that pass, which the local search
cuts a cell differently) are not offered and the status line says the doodad has no middle.
**Looks alone choose the cut; walkability only reports.** Two attempts to put walking into the objective
both made it worse and are worth not repeating. A cost per walk-break across added joins drove
`walkBreaks` under the threshold on every axis (the measure stops discriminating once it is optimised)
and left the ramp's rocks in place, since they sit at joins the doodad ships with. A cost per extra
connected piece of wall/floor (`Seams.islands`) got its zero by laying the ramp's *wall* across the slope
— 79 of 256 added minitiles unwalkable a step instead of 8 — and passed every axis of every bridge.
What worked is a second pass that cannot make that trade, `borrowFloor`. Within "repeat one cell of each
line", Badlands, Jungle, Ashworld, Ice and Twilight cliff ramps cannot avoid repeating a wall tip (two or
three unwalkable minitiles) on one or two lines: 5–11 unwalkable minitiles a step in a line along the
ramp's top edge. So on a line whose repeated cell is part floor and part wall, the *added* cells may show
another of the piece's tiles (`StretchPlan.fill`) when (a) its walkable minitiles are a superset of the
repeated cell's — it can only add floor; (b) `megatileHeight` is the same; (c) the stretched piece has
strictly fewer separate pieces of wall and floor for it. (c) is what tells a rock from the edge of a wall
that runs along the axis (a bridge's rail, a ramp's side): trading that for floor removes no piece, so it
stays. Best seam among those that qualify. The count is `Seams.islands` (floor 4-connected, wall
8-connected, bare cells neither), and what a *step* adds is `islands(3 steps) − islands(2 steps)`, not the
difference from the shipped piece: pulling the ends apart can part two rocks the doodad ships touching,
once (Badlands #77: +2 whatever the length), which misreported clean ramps as having spots. Result: all
twelve cliff ramps and the Low Platform ramps stretch with 0 unwalkable minitiles in the added cells and
`islandsPerStep` 0; the seam mean also fell (Badlands 16.5 → 13.3). Wall ramps keep theirs (17–66
minitiles a step: no middle), and `placeAt` reports `islandsPerStep` × steps in the status line.
`required` of an added cell stays the repeated cell's, so the ground check is as before. `walkBreaks`,
the soundness measure, is taken *before* this pass for the reason above. A third pass that swapped in
same-walkability tiles for better seams changed nothing on any cliff ramp and was removed; the dark
stripe every two columns along a Badlands ramp's lower edge is not something another tile of the doodad
fixes. Planning is ≤ 35 ms for the largest doodad and axis.
Not done: a mirrored image under a symmetry mode stretches the same doodad the same way (it needs the
doodad's twin and the mirrored axis), tiles from outside the doodad to hide the joins, the plugin API, and
a marked area. `tests/stretch.test.ts`.

The palette's preview size (`doodadThumbSizeAtom`, `scmjs.doodadThumbSize`, small / medium / large)
sets `DoodadThumb`'s box and, through `--doodad-thumb-w` / `-h` on `.doodad-grid`, the cell width the
grid wraps on. Large is sized to stay one per row at the left dock's 220 px drag minimum.

The palette's search is `doodadSearchAtom`, a plain atom so it survives the layer switch that
unmounts `DoodadPalette`; it is editor-wide (not in `parkRegisters`) and not stored. Picking a
search hit does not move `doodadCategoryAtom`, so clearing the search (✕ / Esc) sets the category to
the active doodad's, or the grid would fall back to a category that does not hold it. On mount and
after that clear, the palette scrolls `.doodad.selected` into view once the catalogue has loaded.

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

**Scrambled tables (eudplib output).** eudplib's injector uses MRGN as loader scratch:
`vector_reloc.py` writes XOR'd trigger data over the first 3244 bytes and `payload_init.py`
subtracts an obfuscation key from every dword; the loader restores the real locations in game.
So a built map's slots are random 32-bit boxes, most spanning the map — drawn, a solid
location-tint sheet. `scrambledLocations` = ≥16 used non-Anywhere slots with a coordinate more
than 65536 px off the map. `installRegisters` → `followScrambledLocations` turns
`viewFlags.locations` off for such a map (toast on open, status line on a tab switch) and marks
`locationsAutoHiddenAtom`; the next real map turns it back on only while that marker is set.
`toggleFlagAtom` and the Layers eye clear the marker — the person's choice wins.
`tests/documents.test.ts` pins the open/switch behaviour. The real locations are not
recoverable without running the loader.

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
— over units and locations; the viewport through `drawFogLayer`, which keeps the shape between paints
(see `viewport-ui.md`), the image export directly — as a `multiply` fill of `FOG_TINT[tileset]` (the
per-channel mean of the game's `dark.pcx` row 18, the remap it uses for explored-but-unseen
ground; ~52% luminance, Ice ~66%) with 45° chamfers where two explored tiles meet a fogged corner;
explored tiles are untouched. It shows while `viewFlags.fog` is on; the viewport turns that flag
on when the fog layer is entered and back off on leaving if it was the one that set it.
`fogImageData` gives the minimap the same picture (also drawn with `multiply`).
`tests/fog-edit.test.ts` pins the bit semantics and the MASK round trip.

Display follows the game (2026-10-17 audit, PR 3; runs O4, O5, O11 in the lifted 1.16.1 game):
- THG2 0x4000 is never read by the game; a sprite faces the way its Init script sets. The
  animator no longer flips on it (StarEdit writes it exactly where that script flips the overlay,
  so honouring it mirrored those twice: Installation right doors/traps, Ice/Twilight sprites).
  The static frame-0 paths (zoomed out, map image) still use it as a stand-in for the script.
  The palette's Flipped tick is gone; Sprite Properties / the panel keep the bit, labelled 0x4000.
- Inverted MRGN boxes: Bring finds nothing inside (O5), Create Unit uses the centre. Drawn dashed;
  resizing still normalises.
- MASK: the game sets every tile unexplored before reading it, so `combine` takes a `fill` (MASK
  spec `fill: 0xff`) and `decodeMask` pads with 0xFF.
- Cloak is drawn faint on `validProperties & UnitValid.Cloak` + state (0x40 is never read).
- `strandedUnits` skips buildings: the game makes buildings on any ground and only removes ground
  units touching unwalkable minitiles.
