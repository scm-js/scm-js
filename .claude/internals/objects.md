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
