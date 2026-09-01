# scm-js

A StarCraft 1 / Brood War map editor for the browser, built in homage to **StarEdit**, **SCMDraft 2** and **StarForge**.

> Status: reads, renders and writes real maps. Opening a `.scm`/`.scx` parses its
> `scenario.chk`, draws the terrain from the game's own tileset graphics, and saving
> writes a playable archive back out. The terrain layer's Rect and Tile brushes work,
> with undo, including StarEdit's isometric brush; the other layers are still stubs.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle
npm run lint
npm test
```

## Tileset graphics

A map file only stores tile *indices*; the pixels live in StarCraft's own archives. Put
`StarDat.mpq` and `BrooDat.mpq` in `fixtures/data/` (gitignored) and run:

```sh
node scripts/extract-tilesets.mjs
```

That writes `tileset/*.{cv5,vf4,vr4,vx4,wpe}` into `public/tileset/`, which the app
fetches on demand and rasterises into one megatile atlas per tileset. Until the files
are there the viewport falls back to flat tileset colours and says so.

Water and lava animate the way the game does it: the graphics are 8-bit indexed and
StarCraft rotates a few short bands of the palette every 8 game frames (~336 ms on Fastest; the bands per tileset
are the game's own rotator tables; Space Platform and Installation have none). The editor
keeps the megatiles that touch those bands in a small second atlas and re-rasterises it on
every step. **View ▸ Animate Water** freezes it, like the in-game option.

Round trip, for reference:

```
MTXM tile id ──(id >> 4)──▶ CV5 group ──(id & 15)──▶ VX4 megatile
VX4 megatile ──▶ 16 minitile refs (bit 0 = h-flip) ──▶ VR4 8x8 bitmaps ──▶ WPE palette
```

## Unit graphics

Units are drawn with the game's own sprites, in the owner's team colour. The same
archives hold everything needed; after the tileset step run:

```sh
node scripts/extract-units.mjs
```

That mirrors the relevant part of the MPQ tree into `public/`: `arr/{units,flingy,sprites,images}.dat`
and `arr/images.tbl` (the tables that lead from a unit type to its picture), `game/tunit.pcx`
(team colours), `scripts/iscript.bin` (the animation bytecode) and the `unit/**/*.grp` sprite
sheets plus `unit/**/*.lo?` overlay-position files that the 228 unit types and their idle
animations can reach (~340 GRPs, about 9 MB — found by walking the scripts, so projectiles
and death effects stay out). GRPs and overlay files are fetched lazily the first time they
are needed, so a melee map only pulls minerals, geysers and start locations. Without the
files, units are drawn as player-coloured markers and the Units layer says so; without
`iscript.bin` they are drawn but do not move.

```
units.dat[id].flingy ─▶ flingy.dat.sprite ─▶ sprites.dat.image ─▶ images.dat.grp ─▶ images.tbl ─▶ unit\…\*.grp
GRP palette indices 8–15 ─▶ tunit.pcx row for the player's colour ─▶ tileset WPE palette
images.dat.iscript ─▶ iscript.bin header ─▶ Init / Built / StarEditInit animations ─▶ frames, overlays, turns
```

Player colours honour the map's `COLR` section for the eight playable slots.

### Animation

Placed units run their in-game idle animations (**View ▸ Animate Units**), the way water
animates: the viewport steps every unit's iscript once per game frame (42 ms, "Fastest").
Each unit is a stack of images — shadow, main graphic, overlays — each with its own script,
so you get Missile Turret and tank turrets turning, Hatcheries pulsing, marines looking
around, the Nexus glow, Starport lights, and geyser/refinery smoke. Buildings play their
`Built` animation (what a finished building shows), tanks and Goliaths their `StarEditInit`
(StarEdit's own hook, which adds the turret overlay).

Damage shows too: a building whose hit points are set below two thirds burns (Terran),
sparks (Protoss) or bleeds (Zerg) at the positions its `.lo` file gives, more of them the
lower the HP and with the large effect below one third. Fire is drawn through the tileset's
`ofire`/`bexpl` remap tables (extracted as `public/tileset/<name>.ofire.pcx` etc. by the
tileset script) and blended additively, which is a close stand-in for the game's
palette-index lookup. Cloaked units draw half-transparent.

## Units layer

Picking a unit type in the palette **arms placement**: the ghost under the cursor shows
where it would land and each click on empty ground places one. **Esc** or a **right-click**
stops placing and drops you into select mode (the status bar and the HUD chip say which
mode you are in; the properties panel has *Place …* / *Stop placing* buttons too).

- Buildings — and everything else with the building flag: resources, start locations,
  beacons — snap their placement box to the tile grid, exactly as StarEdit stores them (a
  Command Center's centre is always `tile*32 + 64, 48`). Other units land where the pointer
  is. **Snap to grid** (palette toggle, on by default) turns the snapping off, SCMDraft-style,
  so a building can sit at any pixel.
- **Placement checks**, toggled at the top of the palette and all on by default, refuse a
  spot with a red ghost and a status-bar reason — the same rules the game applies when it
  loads a map and silently drops units that do not fit:
  - **No overlap** — ground units and buildings may not overlap another's collision box
    (flyers and start locations are exempt). The unit in the way is outlined.
  - **Check terrain** — a building needs buildable tiles under its whole placement box; a
    ground unit needs walkable minitiles under its collision box.
  Dragging a selection onto a refused spot snaps it back.
- The Terrain palette has the matching **Remove stranded units** toggle (on by default):
  when you paint terrain (any brush, fill, or the isometric brush) under units that can no
  longer stand there, e.g. water over a base, they are deleted as part of the same undo
  step; the status bar counts them.
- **Click a unit** to select it (Shift toggles), **drag** the selection to move it,
  **drag on empty ground** to box-select, **click empty ground** in select mode to clear the
  selection. **Delete** removes the selection; **Esc** clears it.
- The properties panel edits the owner and the vitals inline; **double-click** a unit (or
  *Unit Properties…*) for everything the `UNIT` record stores: type, owner, position, hit
  points / shields / energy / resources / hangar each with its "used" bit, the five special
  properties as state and "valid" bits, the related-unit serial with its Nydus / add-on
  relation flags, and the unused dword. With several units selected only the fields you
  touch are written to all of them.
- New records are written the way StarEdit writes them: 100% vitals, and the
  "valid"/"used" masks describing only what applies to the type (a mineral field gets a
  1500 resource amount, a High Templar an energy value, a marine neither).

Every placement, move, re-own, property edit and deletion is one undo step, in the same
history as terrain strokes, and marks `UNIT` dirty so it lands in the saved file.

## Sprites layer

The `THG2` section: **pure sprites** — a sprites.dat graphic drawn where it stands, with no
unit behind it (tree canopies, markers, glows) — and **unit sprites**, records the game turns
into a unit of that type when the map loads (StarEdit uses these for Installation doors and
traps, flagged *Disabled* so a door starts closed). The layer works like the Units layer:

- The palette has a tab per kind. **Pure Sprites** lists all 517 sprites.dat entries grouped
  as *Units* (named after the unit whose flingy draws with them), *Effects*, and *Doodads ·
  <tileset>* (named after the GRP file, since the game ships no sprite name table — the
  current map's tileset group opens by default). **Unit Sprites** is the units.dat tree.
  Picking one **arms placement**; each click places one at the pointer, at any pixel — there
  are no placement rules to refuse a spot. **Esc** / right-click stop placing.
- **Flipped** (mirror the graphic) and, for unit sprites, **Disabled** are set on new
  sprites from the palette; the owner comes from the same 12-player strip the Units layer uses.
- **Click** a sprite to select it (Shift toggles), **drag** to move, drag on empty ground to
  box-select, **Delete** removes the selection. Hit-testing uses the graphic's own frame box,
  which is also what is outlined. Doodad overlays are ordinary THG2 records and can be
  selected here too; the properties panel says which doodad one belongs to and warns that
  moving it alone leaves the doodad's tiles behind.
- The properties panel edits owner and the three flags inline; **double-click** (or *Sprite
  Properties…*) edits every field of the record — kind, id (from the matching table), owner,
  position, flags including the raw word, and the unused byte. With several selected only the
  touched fields are written.
- New pure sprites carry just the `0x1000` bit, unit sprites none (plus `0x8000` for
  Disabled), which is what StarEdit writes; doodad overlays keep their CV5 flag word.

Every edit is one undo step and marks `THG2` dirty. `scripts/extract-units.mjs` seeds its
GRP walk from every sprites.dat entry as well as the unit types, so the graphics for every
placeable sprite ship in `public/unit/` (that is also what draws tree canopies on the Doodads
layer).

## Fog of War layer

The **F** layer edits the `MASK` section: one byte per tile, bit *n* set meaning the tile starts
the game **unexplored** for player *n+1*. StarEdit writes `0xFF` everywhere and a map without the
section behaves the same, so the editor reads "no `MASK`" as fog everywhere and adds the section
on the first stroke (undo removes it again).

- **Players** — each player has their own fog; select any of the eight and every stroke,
  area fill and whole-map operation edits the fog of all of them at once (**All** / **None**).
  **View** picks whose fog the viewport and minimap draw; it follows the first selected player
  when you deselect the one on show.
- **Fog** / **Clear** is the brush mode; **Shift**-drag paints the opposite. The brush uses the same
  1×1–7×7 sizes as the terrain brushes (`[` / `]`), drags interpolate so a fast stroke leaves no gaps,
  and one drag is one undo step, in the same history as terrain and unit edits.
- **Alt**-click selects the players that have fog on a tile (the eyedropper); the context menu has
  *Fill Area with Fog* / *Clear Fog in Area* (the 4-connected region with the same state for the
  viewed player) and *Pick Fogged Players Here*.
- **Fog all**, **Clear all** and **Invert** act on the whole map for the selected players; **Copy fog**
  gives every selected player exactly the source player's fog.
- The overlay sits **above units, locations and start markers**, the way the game's fog covers
  all of them: fogged tiles are darkened exactly as the game darkens ground it has explored but
  cannot see — the per-tileset ratio of `dark.pcx` row 18 (about half the light, a touch bluer;
  Ice is lighter), applied as a multiply tint — with the corner between two explored edges cut at
  45° so a diagonal boundary reads as a line rather than a staircase. Explored tiles are left as
  they are. Entering the layer switches the *Fog of War* view toggle on and leaving switches it
  back off (unless you had it on already); the toggle — View menu, Layers-panel eye, or **Show**
  in the palette — hides the overlay at any time. The minimap shows the same picture.

## Terrain layer

The Terrain palette has three modes; two of them place tiles:

| Mode | What it paints | Palette |
| --- | --- | --- |
| **Isometric** | StarEdit's diamond brush: paints a terrain and lays the cliffs and edges around it | the tileset's terrain list |
| **Rect** | flat ground of one terrain type, in left/right tile pairs with StarEdit's random variation mix (or one fixed variation) | terrain types, read off the CV5 |
| **Tile** | any single megatile — cliff pieces, doodad tiles, the lot | a raw MTXM id (decimal or `0x` hex) with group/slot spinners and a readout, over a browser of every CV5 tile group |

The Tile browser searches and filters the same set two ways: **grouped rows** label each
CV5 group and show its 16 slots, and the **grid** view drops the labels for one dense
wall of every matching tile, StarForge-style. Search takes a label substring (`dirt`,
`edge set 12`), a group or CV5 index number, or a `0x` tile id; the kind dropdown narrows
to flat terrain, cliffs and edges, doodad tiles or unlisted groups.

Click-drags paint the brush (1×1 to 7×7, `[` / `]` to resize); the viewport previews
what the brush will leave under the cursor. **Alt+click** picks the tile under the
cursor into the brush — a flat tile picks its terrain type in Rect mode, anything else
drops into Tile mode. Right-click gives **Pick** and **Fill Area** (flood fill by terrain
type in Rect mode, by exact tile otherwise). Every stroke is one undo step (Ctrl+Z /
Ctrl+Y, up to 200).

Rect and Tile painting write `MTXM` and `TILE` together and leave `ISOM` alone, which is
what SCMDraft does in its non-isometric modes: these brushes place tiles the ISOM model
has no vocabulary for. The status bar shows the tile id under the cursor and the
Properties panel breaks it down (group, slot, megatile, elevation, walkability,
buildability).

### The isometric brush

The Isometric tab is the brush StarEdit is built around. The map is overlaid with a
lattice of diamonds (4 tiles wide, 2 tall); clicking sets the diamond under the cursor —
or an N×N block of them, per the brush size — to the chosen terrain, and the change
ripples outward: a neighbour that cannot legally border the new terrain (water beside
high dirt) becomes the intermediate one, and every touched diamond is then rendered
from the tileset's own cliff and edge pieces, cliff faces stacked as tall as the tileset
draws them. A single click of a raised terrain gives a small mesa of cliff ring; a wider
brush gives flat high ground inside it. Each stroke is one undo step covering both the
tiles and the lattice.

The lattice lives in the `ISOM` section, which StarCraft itself never reads — it is the
editor's own record, and StarEdit's brush cannot work without it. Protected maps often
strip it. When a map has no `ISOM`, the Isometric tab says so and the brush is off;
**Rebuild ISOM from tiles** (also under Tools) reconstructs it from the terrain: exact for
ground that was laid down isometrically, a best guess under doodads and for hand-placed
tiles. The tab also reports when the ISOM has drifted from the tiles (after Rect/Tile
edits), since strokes near such areas will not join up until it is rebuilt.

The algorithm is a port of Chkdraft's reverse-engineering of StarEdit (MIT); the shape
tables are derived from the CV5 at load time, and only the per-tileset terrain numbering
and adjacency lists are copied in (`src/data/isomTables.ts`). `tests/isom.test.ts` checks
it against real maps: regenerating every tile from a map's own `ISOM` reproduces the
map, and rebuilding the `ISOM` from the tiles recovers the original.

Terrain-type ids are the CV5 group `index` of each flat pair, which is also what `ISOM`
stores; the names come from Chkdraft's tables and `tests/palette.test.ts` checks them
against the extracted tilesets.

## Map I/O

`.scm`/`.scx` are MPQ archives holding `staredit\scenario.chk`; bare `.chk` files open
too. Open with **File ▸ Open**, Ctrl+O, or by dropping a file anywhere on the window.

Every section is kept in file order, and sections the editor does not model are written
back byte for byte — so saving a map we only partly understand does not destroy the rest
of it. Only sections that were actually edited get re-encoded. Repeated sections keep
the game's own semantics (a later `MTXM` overwrites only its own prefix), which is what
protected maps rely on.

`scenario.chk` is written uncompressed so that older StarCraft builds can read it.

**File ▸ New**, and the map the editor opens on, build a scenario from scratch: a flat
128x128 Badlands map, laid out the way StarEdit does it — MTXM in left/right tile pairs
sharing one random dirt variation, and ISOM as the two flat quads that alternate across
the diamond grid. Saving one writes a CHK this editor reads back, but not yet a map
StarCraft will load: `VCOD` and the unit/upgrade/tech settings sections are not
generated.

Reading requires a [mopaq](https://github.com/jeany55/mopaq) with PKWARE DCL support —
StarCraft compresses nearly every file in its archives, and its own maps, with it.

## Layout

```
src/
  atoms/        Jotai state: editor/document atoms (incl. undo history), UI + dialog stack
  editor/       Terrain and unit edit operations as invertible change lists, placement checks
  data/         Reference tables (tilesets, players/colours, units, upgrades, techs, trigger vocab, samples)
  formats/
    chk/        CHK container, section registry, typed section codecs
    mpq/        .scm/.scx open + save on top of mopaq
    tileset/    cv5/vf4/vr4/vx4/wpe decoding, the megatile atlas, base terrain fills, palette catalogue
    dat/        units/flingy/sprites/images.dat, .tbl, GRP, PCX, .lo and iscript.bin decoders
    units/      Unit data + lazy GRP/.lo/remap loading, per-image frame cache, the iscript animator
  services/     File pickers, drag-and-drop, save-to-disk
  components/
    chrome/     MenuBar (Radix Menubar), ToolBar, StatusBar
    panels/     Left dock (layer rail + palettes, TerrainPalette + TileBrowser), right dock (Minimap, Layers, Properties)
    viewport/   Canvas map view with rulers, hover brush, context menu
    dialogs/    All scenario dialogs + DialogHost registry
    splash/     Square splash card that fades over the editor
    ui/         Primitives: Button, inputs, Check, Group, ListBox, Tabs, Tip, DialogFrame
  styles/       tokens → base → ui → chrome → panels → viewport → dialogs → splash
```

## Dev deep-links

Query params jump straight to a state, handy while iterating on a screen:

```
/?nosplash                       skip the splash
/?nosplash&layer=units           select a layer (terrain|doodads|units|sprites|locations|fog|clipboard)
/?nosplash&dialog=playerSettings open a dialog (any DialogId in src/atoms/uiAtoms.ts; repeatable)
/?nosplash&zoom=0.5&tileset=ice  zoom level and tileset
/?nosplash&mode=tile             terrain palette mode (isom|rect|tile; subtile/index still map to tile)
/?nosplash&layer=fog&fogPlayer=3 view (and paint for) one player's fog
```
