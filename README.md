# scm-js

A browser-based StarCraft / Brood War scenario editor, built in homage to
**StarEdit**, **SCMDraft 2**, and **StarForge**.

> **Beta status.** Existing `.scm`, `.scx`, and bare `.chk` maps can be opened,
> rendered, edited, and round-tripped. Unmodelled CHK sections and MPQ members are
> preserved. New maps are written with every section the game requires — StarEdit's
> `VCOD` verification table and the unit, upgrade and technology settings tables on
> their defaults — so they have the same section set as a map StarEdit creates.

## What works

| Area | Status | Highlights |
| --- | --- | --- |
| Map I/O | Working for existing maps | MPQ/CHK open and save, unknown-data preservation, drag-and-drop, PNG export |
| Terrain | Working | Isometric, rectangular, raw-tile, fill, pick, animation, and undo |
| Doodads | Working | Tileset catalogue, placement rules, overlays, selection, movement, and undo |
| Units | Working | Placement validation, properties, team colours, game sprites, and idle animations |
| Sprites | Working | Pure and unit sprites, flags, properties, selection, and movement |
| Locations | Working | Create, resize, snap, rename, elevation flags, and `Anywhere` protection |
| Fog of War | Working | Per-player paint, fill, copy, invert, overlay, and undo |
| Triggers | Working | Classic (StarEdit-style) editor, TrigEdit-syntax text editor, mission briefings; every condition and action |
| Trigger script | Working | A TypeScript subset in Monaco, type-checked against the open map, compiled into a locked block of the trigger list — raw `trigger()` calls plus a structured level (variables, if / while, functions) lowered to a death-counter state machine, with a built-in simulator |
| Scenario/data dialogs | Working | Map properties, revision, players, forces, colours, unit / upgrade / technology settings, strings, sounds, switches, resize |
| Tools | Working | Check Map, Find, Statistics, Symmetry, trigger and string import/export, persisted preferences |

## Run locally

Use Node.js 22.18 or newer. The unit extraction script imports TypeScript directly and
depends on Node's built-in type stripping.

```sh
npm install
npm run extract  # one-time: pull the game data out of your StarCraft archives
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle
npm run lint
npm test
```

No Blizzard data is checked in, so `npm run extract` is the step that makes the editor
render anything: see [Game data](#game-data) below. `npm run dev` and `npm run build`
warn (but do not fail) when it has not been run; `npm run check:assets` reports what is
present.

`npm test` skips the real-map and real-tileset suites when the gitignored files under
`fixtures/maps/` and `fixtures/data/` are not installed.

## Game data

A map file only stores tile *indices*; the pixels live in StarCraft's own archives. Those
files are Blizzard game data, **not** covered by this project's MIT license and not
redistributable, so none of them are in this repository — a clone generates them from an
installation you are entitled to use. Attribution does not itself grant redistribution
rights; see [ATTRIBUTION.md](ATTRIBUTION.md#starcraft-and-brood-war-data) before
publishing a fork or hosted build.

```sh
npm run extract                                              # auto-detect
npm run extract -- --from "/mnt/c/Program Files (x86)/StarCraft"
npm run extract -- path/to/StarDat.mpq path/to/BrooDat.mpq
SCM_DATA_DIR=~/games/sc npm run extract
```

With no arguments it looks for `StarDat.mpq` / `BrooDat.mpq` (and `patch_rt.mpq`, which
wins over both) in `$SCM_DATA_DIR`, then `fixtures/data/` (gitignored), then the usual
install locations — including the Windows drives a WSL session sees under `/mnt`. Brood
War's archive is required: its `units.dat` is the layout the decoder expects, and the Ice,
Desert and Twilight tilesets only exist there. Everything lands in `public/`
([inventory](public/README.md)), which is gitignored; the run takes a few seconds and is
idempotent, so re-run it after a patch or after changing what the scripts extract.

`npm run extract:tilesets` and `npm run extract:units` redo one half
(`scripts/extract-tilesets.mjs`, `scripts/extract-units.mjs`; both take the same
arguments). `npm run check:assets` reports what is on disk without touching the archives.

### Tileset graphics

`public/tileset/<name>.{cv5,vf4,vr4,vx4,wpe}` is what the app fetches on demand and
rasterises into one megatile atlas per tileset. Until the files are there the viewport
falls back to flat tileset colours and says so.

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
archives hold everything needed; `npm run extract` (or `npm run extract:units` on its
own) mirrors the relevant part of the MPQ tree into `public/`: `arr/{units,flingy,sprites,images}.dat`
and `arr/images.tbl` (the tables that lead from a unit type to its picture), `arr/weapons.dat`,
`arr/upgrades.dat` and `arr/techdata.dat` (the defaults the settings dialogs show), `game/tunit.pcx`
(team colours), `scripts/iscript.bin` (the animation bytecode) and the `unit/**/*.grp` sprite
sheets plus `unit/**/*.lo?` overlay-position files that the 228 unit types and their idle
animations can reach. The walk is also seeded from all 517 `sprites.dat` entries for the
Sprites and Doodads layers (about 750 GRPs and 12 MB in the current manifest). GRPs and
overlay files are fetched lazily the first time they are needed, so a melee map only
pulls minerals, geysers and start locations. Without the files, units are drawn as
player-coloured markers and the Units layer says so; without `iscript.bin` they are drawn
but do not move.

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

## Doodads layer

The Doodads layer builds its palette directly from the current tileset's CV5 groups,
using `stat_txt.tbl` for StarEdit's categories and `dddata.bin` for placement rules.
Picking a doodad arms placement; its ghost turns red wherever the footprint leaves the
map, covers another doodad, or does not match the required terrain. **Place anywhere**
disables the terrain/overlap rule, and **Snap to grid** keeps the footprint on StarEdit's
two-tile isometric grid.

Doodads have no names of their own, so the search box above the category drop-down matches
what the data does say: the category (`bridge`, `temple`, `coastal`), the id (`#12`), the
footprint (`6×6` or `6x6`), the name of the sprite or unit an overlay draws (`hdrock`,
`Xel'Naga Temple`), and the word `ramp` for any doodad whose tiles carry the VF4 ramp bit —
StarEdit files ramps under the cliff, wall and building categories without saying so. A
query searches every category and lists the hits under their headings; several words must
all match, and Esc or the × clears it. The drop-down is the plain browse view.

A placed doodad is kept as one coherent edit across all three representations StarEdit
uses: its tiles in `MTXM`, its `DD2 ` record, and any canopy, door, or trap overlay in
`THG2`. Click to select, Shift-click to toggle, drag to move, box-select on empty ground,
and Delete to remove. The owner and disabled state are editable; every placement, move,
property change, and deletion is one undo step. `TILE` retains the ground underneath so
removing a doodad can restore it.

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

## Locations layer

The `MRGN` section: the rectangles triggers refer to. MRGN is a fixed table of slots — 64
in original maps, 255 in Brood War — so nothing is ever inserted or removed: a new
location takes the lowest free slot and deleting one blanks it, which is why a selection
survives every edit. The layer looks and works the way StarEdit / SCMDraft's does:

- Locations draw as **translucent teal plates** with their name in a dark tab at the top-left
  (View ▸ *Location Names* hides the tabs); overlaps stack darker. An amber stripe on the tab
  marks a location that excludes some elevation. Entering the layer switches View ▸ *Locations*
  on if it was off.
- **Drag on empty ground to create** a location: the ghost shows its size in tiles and it takes
  the first free slot, named `Location <slot>` like StarEdit's. *New* in the palette (or *New
  Location Here* in the context menu) drops a 4×4-tile one instead.
- **Click** selects (Shift adds; the selected one goes gold and the minimap outlines it), **drag**
  moves the whole selection, **drag one of the eight handles** resizes — through the opposite
  edge flips the box rather than collapsing it. **Arrow keys** nudge by the snap step (Shift:
  one pixel), **Delete** blanks the slots, **Esc** clears the selection.
- **Snap** (palette: off / 8 / 16 / tile / 64 px) applies to creating, moving and resizing; a
  move snaps the box's corner rather than the pointer, so a box picked up off-grid lands on it.
- The palette lists every slot in use with its tile coordinates; a row selects and scrolls the
  map to the location when it is off screen, double-click opens its properties. The properties
  panel edits the name and the four edges in place (a value lands on Enter / blur) and ticks the
  six elevations; **double-click** (or *Location Properties…*) edits everything at once, and
  Scenario ▸ *Locations…* is the same list as a sortable table.
- **Elevation flags** are stored inverted: a *set* bit **excludes** that elevation, so 0 means
  the location applies everywhere and StarEdit's ticked box is a clear bit. The UI shows ticks.
- Renaming reuses an identical string already in the table (StarEdit's own recycling) and
  otherwise appends one; undo takes the appended string out again. Deleting keeps the old name
  string, as StarEdit does.
- A box stored **inverted** (right < left or bottom < top — a known trick) is drawn and hit-tested
  as its normalised rectangle and moves without losing the inversion; dragging a handle
  normalises it, and the properties dialog accepts an inverted box typed on purpose.

**Location 64.** Slot 63 is *Anywhere*, the location every trigger can pick, and the game and
other editors depend on it being exactly the map. It is pinned at the top of the list with a
lock, never drawn on the map (it would wash every map in tint), never picked by a click, and
cannot be moved, resized, renamed or deleted — the properties dialog shows it read-only.
Creating a location on a map whose Anywhere is missing puts it back in the same undo step
(keeping an existing name), and a map whose Anywhere has drifted off the map bounds shows an
*off map* badge with a **Reset to map bounds** button. A short MRGN (or one missing entirely) is
grown to its full capacity on the first edit.

Every edit is one undo step and marks `MRGN` (and `STR`/`STRx` for a new name) dirty.
`tests/location-edit.test.ts` pins the slot rules, the Anywhere handling, snapping, handles,
picking and the round trip, and checks every fixture map keeps Anywhere in slot 63.

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

The Terrain palette has four modes; three of them place tiles:

| Mode | What it paints | Palette |
| --- | --- | --- |
| **Isometric** | StarEdit's diamond brush: paints a terrain and lays the cliffs and edges around it | the tileset's terrain list |
| **Rect** | flat ground of one terrain type, in left/right tile pairs with StarEdit's random variation mix (or one fixed variation) | terrain types, read off the CV5 |
| **Tile** | any single megatile — cliff pieces, doodad tiles, the lot | a raw MTXM id (decimal or `0x` hex) with group/slot spinners and a readout, over a browser of every CV5 tile group |
| **Blend** | one tile at a time, next to a tile you picked on the map, chosen from the tiles whose facing edge continues it | the anchor tile, then Left / Top / Right / Bottom lists of matches ranked by how well the pixels along the shared edge agree |

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

**Blend** is for the joins the cliff sets never had — dirt into a doodad's base, one
edge set into another, a hand-laid shoreline. Click a tile on the map to make it the
*anchor*; the palette then lists, for each side, the tiles whose opposite edge continues
the anchor's pixels (the anchor's right column against each candidate's left column, and
so on), best seam first, with the mean colour difference (Δ) under each thumbnail — 0 is
pixel-identical, a designed pair scores under 8, and the **Tolerance** box cuts the list
off (16 by default). The kind dropdown narrows the pool the way the Tile browser does.
Clicking a match places it in that neighbour cell as one undo step and makes it the Tile
brush's tile; with **Follow** on (the default) the anchor moves onto the placed tile so
the next click continues the seam. The viewport outlines the anchor and its four
neighbours. There is no lookup table for any of this in the game data — it is read off
the VR4 pixels, so the graphics must be extracted.

Rect, Tile and Blend painting write `MTXM` and `TILE` together and leave `ISOM` alone,
which is what SCMDraft does in its non-isometric modes: these brushes place tiles the ISOM
model has no vocabulary for. The status bar shows the tile id under the cursor and the
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

The algorithm is a port of [Chkdraft](https://github.com/TheNitesWhoSay/Chkdraft)'s
reverse-engineering of StarEdit (MIT, copyright Justin Forsberg); the shape
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
the diamond grid. Saving one writes the same set of sections a StarEdit map has: the
fixed `VCOD` verification table (identical in every unprotected map), `IVE2`, empty CUWP
slots (`UPRP`/`UPUS`), an all-fogged `MASK`, and the unit / upgrade / technology settings
tables in the Brood War layouts on their `.dat` defaults (Blizzard's own Brood War maps
carry only those; a hybrid map is the one that needs both) — see
`src/formats/chk/create.ts`. **Tools ▸ Check Map** lists what a file of its revision is
still missing.

Reading requires a [mopaq](https://github.com/jeany55/mopaq) with PKWARE DCL support —
StarCraft compresses nearly every file in its archives, and its own maps, with it.

### Exporting a picture of the map

**File ▸ Export ▸ Image** renders the whole map to a PNG. There is one dial — the scale —
and it decides what the picture is:

| Scale | A 128x128 map | What it draws |
| --- | --- | --- |
| 32 px/tile | 4096x4096 | The game's own art: tileset graphics, unit and sprite GRPs |
| 16, 8 px/tile | 2048, 1024 | The same, smaller |
| 4, 2 px/tile | 512, 256 | Terrain from mean tile colours, units as minimap dots |
| 1 px/tile | 128x128 | The game's minimap |

The two places where the picture changes character are the viewport's own far-zoom
thresholds, so an export looks like what the map looks like on screen at that zoom: below
8 px a tile a unit is too small for its graphic and becomes a minimap dot (sized by its
placement box, resources in cyan, sprites dropping out as they do on the game's minimap),
and below 4 px terrain is filled from the precomputed mean megatile colours.

Units, sprites, locations and their names, start locations, fog of war (per player) and
the grid are each a tick; the ones a given scale cannot draw grey out. The dialog previews
the render at thumbnail size, so the ticks can be judged before a multi-megapixel PNG is
encoded, and the file name follows the scale (`<map>-minimap.png` at the small end) until
you type one of your own.

## Triggers

The `TRIG` section (and `MBRF`, the mission briefings, which share its layout). Three editors
under the Triggers menu edit the same list:

- **Trigger Editor** (Ctrl+T) is the StarEdit form: a player filter, the trigger list, and per
  trigger its players, conditions (up to 16) and actions (up to 64). Every condition and action
  the game has is available, each argument gets a widget of its kind — player group, unit
  (custom names shown when the map sets them), location, switch, AI script, text, number —
  and any value the tables do not list (an EUD player, an out-of-range unit) stays selectable as
  raw. Items can be disabled individually, as in SCMDraft. The comment field is the trigger's
  Comment action and "Preserve trigger" is its Preserve Trigger action.
- **Text Trigger Editor** (Ctrl+Shift+T) shows the same triggers in SCMDraft 2's TrigEdit
  syntax and compiles them back on Compile / Apply / Compile & Close, reporting the first error
  with its line. Argument order follows SCMDraft, so its text pastes in; a leading `;` disables
  a line, unknown names may be written as bare numbers, and a `Flags:` block carries the
  trigger flags SCMDraft has no syntax for (`Preserve`, `Disabled`, `Ignore Game End`). Format
  reprints the text; Reload discards edits.
- **Mission Briefing Editor** is the same form over MBRF with the briefing action set (no
  fixture map has a briefing, so its field layout follows the community reference unverified).
- **Script Editor** is a TypeScript editor (Monaco) over a script that *generates* triggers —
  see below.

All are OK / Apply / Cancel transactions outside undo, like the settings dialogs. Strings
typed into text arguments are appended to the string table as you type and never removed, so a
cancelled edit can leave an unused string behind. A trigger re-encodes byte for byte; the one
thing the text form cannot carry is StarEdit's "unit type used" hint bit, which Blizzard's own
maps set inconsistently.

### Trigger script

The Script Editor holds one TypeScript file per map. At the current *raw* level it is a
typed spelling of the trigger list — one `trigger(players, conditions, actions, flags?)` call
per trigger, conditions and actions as function calls with the same argument order as the
text editor:

```ts
const beacon = Bring(CurrentPlayer, Units.AnyUnit, Locations["Beacon Alpha"], "At least", 1);

trigger([P1, Players.Force2], [beacon, Switch(Switches.DoorOpen, "set")], [
  DisplayText("Always Display", "You found it!"),
  SetDeaths(P1, Units.TerranMarine, "Add", 5),
  disabled(SetSwitch(Switches.DoorOpen, "toggle")),
  PreserveTrigger(),
], ["Preserve"]);
```

The declarations it is checked against are generated from the open map, so `Locations.`,
`Switches.`, `Units.` (custom names included) and `Players.` (force names included) complete
to what the map has, and a location passed where a unit belongs is a type error before you
build. Every value must be a compile-time constant: literals, `const`s, arithmetic on them,
array spreads. Raw numbers are accepted wherever a name is (EUD players, odd unit ids), and
unknown types can be written as `Condition(type, …)` / `Action(type, …)`.

**Build** compiles the script and installs its triggers as one contiguous *block* of the
map's trigger list, replacing the previous block (or appending the first). The Trigger
Editor shows those triggers with a `script` badge and refuses to edit them — "Open Script
Editor" jumps to the source line — and the text editor fences them in comments. Hand-made
triggers around the block are untouched; inserting one before the block simply moves it (the
block is found by content, not by position). Editing a generated trigger elsewhere makes the
block *stale*: it turns back into ordinary triggers and the next Build appends a fresh block.
**Import map triggers** does the reverse — it rewrites the hand-made triggers as script (in
their order around the block) and rebuilds, so the whole list is script-generated from then on.

The source and a build manifest are stored in the map archive itself (`scmjs\triggers.ts`
and `scmjs\triggers.json` next to `staredit\scenario.chk`), so they travel with the `.scx`;
edits are saved as you type, and only Build changes triggers. Type errors come from the
TypeScript language service, compiler errors from a worker; both land in the editor and in the
problems list.

#### Structured code

Everything at the top level that is not a `trigger()` call or a `const` is a *program*:

```ts
program({ owner: P8, hyperTriggers: true });   // optional; defaults: P1, no hyper triggers

let wave = 0;
let alarm = false;

function spawn(count: number) {
  CreateUnit(P2, Units.ZergZergling, count, Locations.Spawn);
  wave += 1;
}

while (true) {
  if (Bring(P1, Units.AnyUnit, Locations.Beacon, ">=", 1) && !alarm) {
    alarm = true;
    DisplayText("Always Display", "They are coming.");
  }
  if (alarm) spawn(4);
  if (wave >= 10 || Deaths(P1, Units.TerranMarine, ">=", 50)) { Defeat(); }
  Wait(2000);
}
```

There is no EUD trickery in this: the program compiles to ordinary triggers that run on any
version of the game, using the two things trigger lists can already do.

- **Variables are death counters** (`let n = 0`) on units that can never die — the "(Unused)"
  entries of units.dat, Cantina first — twelve players per unit, so there are hundreds. Booleans
  (`let f = false`) are switches. Values are unsigned 32-bit, `-=` stops at 0. `n += 5`,
  `n = 3`, `n++` are one action each; an operation between two variables (`a += b`, `a = b`,
  `a < b`) is the classic binary decomposition and costs about 64 triggers, so keep those out of
  hot loops. There is no multiplication or division between variables (the game has no
  instruction for it); `*`, `/`, `%` work on constants.
- **Control flow is a program counter.** Each basic block is a run of triggers that test
  `pc == S`, in list order, so straight-line code runs *within one trigger cycle*; a loop's back
  edge waits for the next cycle. `while (true) { … }` is therefore a game loop running once per
  cycle — every ~2 s at Normal speed, every frame with `hyperTriggers: true`. `if` / `else`,
  `while`, `do`, `for`, `break`, `continue` all work; `&&`, `||`, `!` are lowered to
  disjunctive normal form, one trigger per case, with negation folded into the comparison where
  the game can express it (`!Bring(… ">=", 1)` → `at most 0`) and a "skip" trigger where it
  cannot (`!CommandTheMost(…)`).
- **Functions are inlined** at every call. A parameter binds to a constant, or, when the
  argument is a variable, to that variable (by reference); `return` works, return *values* do not.
  Locals inside a function get their own storage per call site.
- **The program is one thread running as one player** — the `owner`. It runs only while that
  player is in the game, and `CurrentPlayer` means that player. Conditions from the trigger
  vocabulary (`Bring`, `Switch`, …) can be used in `if` and `while` directly; `random()` is a
  randomized switch.

Every generated trigger carries a `Comment` naming its source line (`L18: cycles++`), which is
what the Trigger Editor shows as the trigger's title; `comments: false` turns that off. The
program's variables avoid every death counter and switch the map's hand-made triggers touch, and
the toolbar's program summary lists where each one lives.

**Simulate** runs the compiled triggers for thirty cycles in a built-in trigger-cycle interpreter
and lists every action that ran (with its cycle and source line) and each variable's final value.
It models exactly what the compiler relies on — death counters, switches, preserve, list order —
and answers unit conditions with "false"; the same interpreter is what the test suite uses to
prove programs behave. For EUD work the raw level also offers `Memory(address, comparison, value)`
and `SetMemory(address, modifier, value)`, the standard `Deaths` at player `EPD(address)` forms.

## Scenario settings

The **Scenario** menu's dialogs edit the map's own tables. Each is a transaction — OK,
Apply or Cancel — and is not part of the undo history, as in StarEdit.

- **Map Properties** — name and description (`SPRP` + the string table), with the
  tileset, size, revision and a player summary, and the map's counts of everything.
- **Map Revision** — `VER`/`TYPE`: StarCraft 1.00 (59, RAWS), Hybrid 1.04 (63, RAWS),
  Brood War 1.04 (205, RAWB) or Remastered 1.21+ (206, RAWB). Remastered may write the
  32-bit string table (`STRx`); leaving it converts back to `STR`. String indices never
  change, so triggers and locations keep pointing where they did. The dialog lists which
  revision-specific sections the file carries.
- **Player Settings** — controller (`OWNR`, with `IOWN` kept in step), race (`SIDE`),
  colour (`COLR`) and force (`FORC`) for the twelve slots; players 9–12 have no colour
  choice and no force.
- **Force Settings** — the four force names, membership and flags (random start,
  allies, allied victory, shared vision). A renamed force reuses an identical string
  from the table, else appends one.
- **Player Colors** — the `COLR` palette entry per slot, plus Remastered's `CRGB`: a
  slot can be *palette*, *random predefined*, *player's choice* or a *custom RGB*. The
  section only exists while some slot needs it. Custom colours show in the editor's
  swatches; sprites on the map keep their palette colour.
- **Unit Settings** — `UNIS`/`UNIx` and `PUNI`, with the unit's sprite in the frame. A
  type on *use default* shows its `units.dat` / `weapons.dat` numbers greyed out; untick
  it and the row is seeded from them. Hit points, shields, armor, build time, cost, a
  custom name, the weapons' damage and upgrade bonus (per weapon — a turreted vehicle
  shows its turret's), and per-player availability (default / enabled / disabled over a
  global default). Which of `UNIS`/`UNIx` is written follows the revision: both for a
  hybrid map, and whichever the file already had is always kept current.
- **Resize / Crop Map** — new size, fill terrain and a 3×3 anchor (the offset is kept
  even so left/right tile pairs stay aligned), with "clamp locations". Units, sprites and
  doodads outside the new bounds are dropped; locations are shifted and clamped, never
  dropped; Anywhere is reset; ISOM is rebuilt from the tiles when the tileset is loaded.
  Not undoable — it clears the history, like the settings dialogs.
- **Unit Properties** (double-click a unit, Units layer) — every `UNIT` field, with the
  unit drawn in its owner's colour.

- **Upgrade Settings** — `UPGS`/`UPGx` and `UPGR`/`PUPx`. Per upgrade: use-default
  (greyed `upgrades.dat` costs, seeded into the row when unticked), a base and a
  per-level factor for minerals, gas and research time, and start / maximum levels per
  player over a default pair. Ids 46–60 only exist for Brood War maps.
- **Technology Settings** — `TECS`/`TECx` and `PTEC`/`PTEx`. Per ability: use-default
  (`techdata.dat`), minerals, gas, research time and energy; availability per player
  (default / available / researched / disabled) over "available by default" and
  "researched by default". Ids 24–43 are Brood War only.

- **String Editor** — every entry of `STR`/`STRx` with where it is used (name,
  description, forces, locations, unit names, switches, sounds, trigger and briefing
  actions). Edits keep their index, so triggers and locations keep pointing where they
  did; control bytes are shown and typed as `<XX>` and a row of buttons inserts the
  game's colour and layout codes. *Delete unused* blanks unreferenced entries and only
  trailing blanks are dropped from the table.
- **Sound Editor** — the `WAV` table joined with the archive's `staredit\wav\` members:
  import `.wav`/`.ogg` files, play them (Web Audio; PCM and Ogg decode, ADPCM does not),
  remove them, and adopt files the archive carries but the table does not list.
- **Switches** — the 256 `SWNM` names with how many conditions and actions use each.

Every settings dialog writes whichever layout pair its revision reads plus any the file
already carries, so a hybrid map keeps both and an original-game map only its own.

## Tools, checks and preferences

- **Check Map** (Tools ▸ Check Map…) — the sections a file of its revision needs to load,
  start locations against the player table, the unit limit and off-map units, Anywhere,
  duplicate location names, string capacity, triggers pointing at unused locations or
  strings past the table, Play WAV files missing from the archive, switches tested but
  never set, disabled triggers, and ISOM health. Double-click an issue to go there.
  **Triggers ▸ Validate Triggers** is the same run filtered to trigger issues.
- **Find** (Ctrl+F) — units, locations, sprites, strings and triggers; *Go To* selects
  and centres, or opens the String Editor on the entry.
- **Statistics** (Tools ▸ Statistics…) — counts of everything in the map, per player and
  per terrain, with *Copy as text*.
- **Import / Export** (File menu) — triggers as `.trg` (the raw `TRIG` records, as
  SCMDraft exports them) or as TrigEdit text, and strings as a tab-separated `.txt`
  (`index<TAB>text`, control bytes as `<XX>`); importing triggers can append or replace.
- **Symmetry** (Tools ▸ Symmetry…, toolbar) — mirror horizontally, vertically or both,
  rotate 180°, and on square maps rotate 90° or mirror across either diagonal. Every
  cell a Rect, Tile or Fog stroke (or its area fill) covers is painted on its mirror
  images too, as one undo step, and the Rect brush still lays proper left/right pairs
  across the seam. The axes are drawn while a mode is active. The Isometric and Blend
  brushes and object placement are not mirrored.
- **Fill Terrain** (Tools) — the whole map with the active terrain, pairs and ISOM
  regenerated, as one undo step. **Edit ▸ Select All / Deselect / Delete** act on the
  active layer. **Open Recent** lists this session's names only, since a browser hands
  over file contents rather than handles.
- **Grid Settings** — spacing, colour, opacity, lines / dots / crosses, and the location
  and doodad snapping; remembered across sessions.
- **Preferences** (Ctrl+,) — persisted in the browser: the splash screen, confirming
  before New / Open / Close / a dropped file replaces a modified map, new-scenario
  defaults, and whether water and units animate on startup. Only options something
  reads are listed.

## Layout

```
src/
  atoms/        Jotai state: editor/document atoms (incl. undo history), UI + dialog stack
  editor/       Invertible edits and placement checks for every working map layer
  data/         Reference tables (tilesets, players/colours, units, upgrades, techs, trigger definitions)
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

## Attribution and license

The original scm-js source is MIT-licensed; see [LICENSE](LICENSE). That license does
not replace the licenses or ownership of upstream code, packages, research, names, or
game data.

[ATTRIBUTION.md](ATTRIBUTION.md) records the provenance of adapted algorithms and data
tables, community format references, editor inspirations and their creators, direct npm
dependencies, generated Blizzard resources, repository artwork, and AI-assisted commits.
Source-level attribution is also kept beside the Chkdraft-derived and iscript-reference
code so it survives extraction from this README.

StarCraft and Brood War are trademarks of Blizzard Entertainment. This fan project is
not affiliated with or endorsed by Blizzard Entertainment.
