# User guide

This guide is for map makers. It starts with getting the editor running, walks through
a first map, and then goes through each layer and dialog in turn. TrigScript, triggers
written as code, has [a guide of its own](trigscript.md); the technical side — file
formats, game data, writing plugins, building from source — has documents of its own,
listed in the [README](../README.md#documentation).

> **Beta.** This editor needs to be extensively tested. Keep backups of maps you care
> about, and check anything important in-game before you rely on it.

## Getting started

There are three ways to run scmJS, each covered in [docs/installing.md](installing.md):

- **In the browser** at [editor.scmjs.dev](https://editor.scmjs.dev). Nothing to install,
  and your maps stay on your own disk.
- **As a desktop app** for Windows, macOS and Linux, from the [releases](https://github.com/scm-js/scm-js/releases)
  page. It finds a StarCraft installation on its own and opens a map on a double-click.
- **In a container**, for a server on your own network: `docker run --rm -p 8080:80
  ghcr.io/scm-js/scm-js:latest`, then open `http://localhost:8080`.

On first use the editor asks where to get StarCraft's graphics, which do not ship with
it: a free download from Blizzard, or the `StarDat.mpq` and `BrooDat.mpq` of a classic
installation. See [The graphics](installing.md#the-graphics). Without them the editor
still runs, with terrain in flat colours and units as coloured markers.

### Opening a map

Ctrl+O opens a file, and so does dropping one on the window. A map opens beside the ones
already open, in its own tab (see [The editor window](#the-editor-window)); the one
exception is the blank map the editor starts on, which the first map opened takes the
place of. File ▸ Open Recent lists what you have had open before; in Chrome, Edge and the desktop app it reopens the file
from disk directly. File ▸ Find on scmscx.com… searches the community map archive and
opens the map you pick (see [Plugins](#plugins)); a link like `https://editor.scmjs.dev/scmscx/35b32Dsq`, the id taken from the map's address on the site, opens the editor with that map picked in it. File ▸ Open from scmjs.dev… lists the maps kept on your scmjs.dev
account, every revision you saved there (see [Your scmjs.dev account](#your-scmjsdev-account)).

The Repair plugin checks every map as it opens, the way the game reads it. When something
is missing, damaged or repeated, as it often is in a protected map, it lists each finding
with what the game does about it and a repair you can tick; nothing is changed that you
did not tick, and Tools ▸ Repair Map… runs the check again. Section Explorer, from Plugins ▸ Browse
Plugins…, shows the file section by section and byte by byte. See
[Protected and damaged maps](file-formats.md#protected-and-damaged-maps).

## The editor window

The window has nine parts, numbered in the picture below.

![The editor window with its parts numbered](images/editor.webp)

1. **Menu bar.** Every command is here, with its shortcut beside it. The dot at the right
   end glows while the map has unsaved changes.
2. **Toolbar.** New / open / save, undo and redo, cut / copy / paste, the active layer
   and brush size, the grid, locations and fog-of-war toggles, symmetry, find, zoom, and
   buttons for Player Settings, the Trigger Editor and Test Map.
3. **Layer rail.** The seven layers, top to bottom: Terrain, Doodads, Units, Sprites,
   Locations, Fog of War, Cut / Copy / Paste. The keys `T D U S L F C` switch between
   them.
4. **Palette.** What the active layer places: terrain types and brushes, doodads, unit
   types, sprites, the location list, the fog players, the clipboard options.
5. **Map.** Drag to paint or place, click to select, double-click for properties.
   Right-click opens a context menu, or stops whatever you are placing.
6. **Minimap.** Click or drag on it to move the view.
7. **Layers panel.** The eye hides a layer's objects from the view; the padlock locks a
   layer so its tools stop changing the map. Plugin overlays (Walkability, say) are
   listed under it.
8. **Properties.** What is selected, or what is under the cursor: for a tile its id,
   group, elevation, walkability and buildability; for a unit its owner, position and
   vitals; for a location its bounds and elevation flags.
9. **Status bar.** The tile and pixel under the cursor, the tile id, map size, tileset,
   layer and zoom, and a line saying what the last action did or why it was refused. At
   the right end, your scmjs.dev account (or *Sign in to scmjs.dev*) and the AI's state,
   each a click to open.

Open a second map and a row of tabs appears under the toolbar, one per open map, with a
glowing dot on any that has unsaved changes. Click a tab to switch, or use the Window menu
(Ctrl+Tab and Ctrl+Shift+Tab in the desktop app); the × on a tab, a middle click, or
File ▸ Close closes that map, asking about unsaved changes first. Each map keeps its own
undo history, selection and view, so switching back lands where you left off. With one map
open there is no row: the window looks as it always has. Preferences ▸ General can turn
this off, and then Open and New replace the open map as StarEdit does.

Scroll with the mouse wheel (Shift for sideways), the arrow keys (Shift for half a
screen), a middle-button drag, or the scrollbars, or click on the minimap. A drag that
reaches the edge of the window scrolls the view along with it, so a stroke, a marquee or
a unit being moved can carry on past what is on screen; it speeds up the further past the
edge you push and stops when you let go. Ctrl++ and Ctrl+− zoom, as do the toolbar's magnifiers; Ctrl+0 is 100% and
Ctrl+Shift+0 fits the whole map in the window. Ctrl+G shows the grid, and View ▸ Grid Settings (the
Editing page of Preferences) sets its spacing, colour and style. The panels can be hidden from View ▸ Panels and their widths dragged.

Every layer has its own selection and its own palette. Undo is Ctrl+Z, two hundred steps
deep and shared across all the layers, so a terrain stroke and the units it stranded
come back together. Anything done in a dialog — player settings, triggers, strings — is
its own OK / Apply / Cancel transaction and is not in the undo history, as in StarEdit.

## Your first map

This section walks through a small melee map from start to finish. Everything here is
covered in more depth in the sections that follow.

### 1. Make the map

Ctrl+N opens New Scenario. Pick a tileset — each is shown as its own ground — a size, and
how many players. The terrain list under the size is what the whole map is filled with,
and the preview shows the result at its real scale. *Place automatically* (off by default) lays down one
start location per player in a ring; tick it for this map.

![The New Scenario dialog](images/new-scenario.webp)

Give the map a name and a description — both are what players see in the game lobby —
and press Create.

### 2. Shape the ground

Stay on the Terrain layer and the **Isometric** tab. Pick *High Dirt* (Badlands; every
tileset has a high ground of its own), set the brush to 3×3, and drag across the map.
The cliffs around the high ground are laid for you, and where a stroke meets a terrain
the new one cannot touch, the terrain in between is put in. Painting *Water* works the
same way and gives you a shore.

![A plateau and a lake painted with the isometric brush](images/tutorial-terrain.webp)

The brush size keys are `[` and `]`. Alt+click picks the terrain under the cursor.
Ctrl+Z takes back the whole stroke.

Ramps are not terrain: they are on the **Doodads** layer. Type `ramp` in its search box
to list them, click one, and click on a cliff edge; the ghost is red until the footprint
sits on ground it fits.

### 3. Place the bases

Switch to the **Units** layer (`U`). The start locations are already there. In the
palette, *Special* holds *Start Location* and *Resources* holds the mineral fields and
the Vespene Geyser, or type a name in the search box. Click a type to arm it, then click
on the map to place; Esc or a right-click stops placing.

![A start location with minerals and a geyser](images/tutorial-base.webp)

A mineral field holds 1500 minerals and a geyser 5000 gas when placed; double-click one
to change the amount, or select a whole line and set them all at once. Eight fields and
one geyser is the usual main.

*Snap to grid* keeps buildings and resources on the tile grid where the game expects
them. The two ticks above it are the game's own placement rules; a red ghost means the
game would drop the unit when it loaded the map, and the status bar says why.

For a symmetric map, Tools ▸ Symmetry mirrors what you paint and place across the axis
you choose. The Melee Wizard plugin (Plugins ▸ Browse Plugins…) lays out whole bases with
the mineral line at the distance the game mines fastest from.

### 4. Check the players

Scenario ▸ Player Settings is where each slot's controller, race and colour live. A melee
map needs *Human* and *User Selectable* on every slot that has a start location; that is
what a new map is set to already. Force Settings groups them into teams for the lobby.

A Use Map Settings map is different: give each player a fixed race there. A player left on
*User Selectable* is treated as a melee player by the game, which hands them a base and
workers at their start location and removes every unit you placed for them. Units of a
human slot that nobody takes in the lobby are removed too, so put decorations such as
beacons on Player 12, the neutral one.

### 5. Check the map

Tools ▸ Check Map lists what the game would object to: a start location with no player,
a unit off the map, too many units, and so on. Double-click a line to go to it.

View ▸ Walkability (Ctrl+Shift+W) draws the ground as a unit sees it: which areas
connect, where the chokes are and how wide, and which pockets cannot be reached at all.
It updates as you edit.

### 6. Save and play

Ctrl+S saves. A new map opens the Save dialog the first time, where the name and the
file format are chosen; `.scx` is a Brood War map. From then on Ctrl+S writes the file in
place (Chrome, Edge, the desktop app) or downloads it (Firefox, Safari) — the notice at
the bottom right says which.

Ctrl+F5 is Test Map. Neither StarCraft build opens a map handed to it from the outside,
so the editor writes the map into a `scmJS` folder under the game's *Maps* folder, where
**Single Player ▸ Custom Game** lists it; the desktop app then starts the game as well.

That is a playable melee map. Triggers, briefings, custom unit settings and everything a
"Use Map Settings" map needs are in the sections below.

## Terrain

Terrain is painted with four brushes, each a tab in the palette:

| Brush | Paints |
| --- | --- |
| Isometric | StarEdit's diamond brush. Sets the diamond under the cursor to a terrain and lays the cliffs and edges around it. The one to use for almost everything. |
| Rect | Flat ground of one terrain type, in left/right tile pairs with StarEdit's random variation mix. No cliffs, no edges. |
| Tile | Any single tile by number: cliff pieces, doodad tiles, anything the tileset has. |
| Blend | One tile next to a tile you picked, chosen from those whose facing edge continues it. |

![Cliffs and a shore laid by the isometric brush, with a 3×3 brush ghost](images/terrain-isometric.webp)

Drag to paint. `[` and `]` resize the brush from 1×1 to 7×7, Alt+click picks the terrain
or tile under the cursor, and right-click offers Pick and Fill Area. The Properties panel
breaks the tile under the cursor into group, slot, elevation, walkability and
buildability.

The isometric brush ripples outward as it paints: a neighbour that cannot legally border
the new terrain becomes the intermediate one, and cliff faces stack as tall as the
tileset draws them. A single click of high ground gives a small mesa; a wider brush gives
flat high ground inside a cliff ring. It needs the map's `ISOM` section, which is the
editor's own record rather than anything the game reads, and which protected maps often
strip. Where a map has none, the tab says so and the Repair plugin (Tools ▸ Repair Map…)
reconstructs it: exact for ground that was laid down isometrically, a best guess under
doodads and hand-placed tiles. The tab also warns when Rect or Tile edits have left the
record out of step with the terrain — but only where a rebuild would put it back. Ground
no diamond lattice can describe, which is what hand-placed tiles, blends and other
editors leave behind, is reported as what it is: the brush will not join up there, and
no tool can change that.

![The Rect tab](images/palette-rect.webp) ![The Tile tab](images/palette-tile.webp) ![The Blend tab](images/palette-blend.webp)

Rect lays the flat pairs and nothing else, which is what you want for filling an area you
will shape afterwards, or for ground under a doodad. Tile is for the pieces the isometric
brush will not give you: a single cliff tile, a doodad's tile, a corner the cliff sets do
not have. Blend is for joins the cliff sets never had — dirt into a doodad's base, one
edge set into another, a hand-laid shoreline: click a tile to make it the anchor, and the
palette lists for each side the tiles whose opposite edge continues its pixels, best
seam first, with the mean colour difference under each thumbnail. Rect, Tile and Blend
leave the isometric record alone, which is what SCMDraft does in its non-isometric modes.

Two overlays on the View menu show what the ground means to the game:

![The elevation overlay tints each minitile by its height](images/terrain-elevation.webp)

![The buildability overlay hatches the tiles a building cannot stand on](images/terrain-buildability.webp)

View ▸ Walkability (Ctrl+Shift+W) goes further and draws the ground as a unit walks it:
islands, the areas the map divides into, the chokes between them with their widths, and
the distances between start locations. File ▸ Import ▸ Terrain from Image… turns a
picture into terrain with the isometric brush, over the whole map or a rectangle. Both are
plugins, on from the start; see [Plugins](#plugins).

Tools ▸ Replace Terrain turns every tile of one terrain type (or one exact tile) into
another, over the whole map or the area marked on the Cut / Copy / Paste layer; Fill
Terrain lays the whole map anew. Both are one undo step.

Tools ▸ Symmetry mirrors what you do across the map's axes or about its centre — every
brush, the fills, and placing units, sprites, doodads and locations, each as one undo
step. The axes show on the map while a mode is on, the ghost shows where the images will
land, and a doodad that would have to turn is skipped. Blend, moving and deleting are not
mirrored.

![The Symmetry dialog](images/symmetry.webp)

The Terrain palette's *Remove stranded units* tick deletes the units a stroke has just
made illegal (a building now half on a cliff) as part of the same undo step.

## Doodads

Doodads are the trees, rocks, ruins, ramps and bridges of a map: pieces of terrain that
come with their own tiles and, sometimes, a sprite drawn over them. The palette is built from the current tileset's
own groups, with StarEdit's categories and placement rules.

![The Doodads layer on a Desert map, placing a sand dune](images/doodads.webp)

Picking a doodad arms placement, and the ghost turns red where the footprint leaves the
map, covers another doodad or sits on the wrong terrain. *Place anywhere* drops that
rule; *Snap to grid* keeps the footprint on StarEdit's two-tile isometric grid, which it
does for a move as well as a placement. Right-click or Esc stops placing.

Doodads have no names in the game data, so the search box matches what the data does
say: the category (`bridge`, `temple`, `coastal`), the id (`#12`), the footprint
(`6×6`), the sprite or unit an overlay draws (`hdrock`, `Xel'Naga Temple`), and the
word `ramp` for anything whose tiles carry the ramp bit, which StarEdit files under
cliffs and walls without saying so.

A placed doodad stays whole across the three places a map keeps it — its tiles, its
record and any canopy or door overlay — and removing one restores the ground underneath.
When you want the tiles without the doodad — a ramp to touch up piece by piece, a cliff
edge to paint into — right-click it and choose *Convert Doodad to Terrain* (the Properties
panel has the same button). The tiles stay, the record goes, and an overlay stays on as
an ordinary sprite; from then on the Terrain layer treats the cells as ground, so a
Terrain-only copy carries them and a later doodad leaving them puts them back. *Place
as terrain* in the palette does the same at placement, for laying out ramps and cliff
pieces you mean to work over by hand.

## Units

The Units layer places everything the game has a unit for: the three races' units and
buildings, heroes, critters, resources, start locations, beacons and powerups. The palette groups them by
race, and the search box takes a name or an id.

![The Units layer: marines placed, and a tank refused because it overlaps them](images/units.webp)

Picking a unit type arms placement, and each click on empty ground places one for the
player selected at the top of the palette. Esc or right-click stops placing and drops you
into select mode, where a click selects, a drag on empty ground marks a box, and a drag on
a unit moves it. Del deletes the selection.

**Snap to grid** puts buildings, resources, start locations and beacons on the tile grid
by their placement box, the way StarEdit stores them, and every other unit on the
nearest tile centre. Turn it off for pixel placement, SCMDraft-style. It applies to a
move as well as a placement, so dragging a unit that sits off the grid brings it back
onto it.

The **placement checks** are on by default and refuse a spot with a red ghost and a
reason in the status bar. They are the rules the game applies when it loads a map and
silently drops the units that do not fit: no overlapping collision boxes for ground units
and buildings, buildable tiles under a building's whole placement box, walkable ground
under a unit. The unit in the way gets outlined. Untick them for a stack of units on
purpose, and expect the game to keep only the first.

![Unit Properties](images/unit-properties.webp)

Double-click a unit for every field its record holds: owner, position, hit points,
shields, energy, resources and hangar count with their "used" ticks, the special
properties (cloaked, burrowed, lifted off, hallucinated, invincible), and the related-unit
link an add-on or a Nydus Canal uses. With several units selected, only the fields you
touch are written to all of them, so a mineral line can be set to one amount in one go.

Tools ▸ Auto-place Start Locations puts one start location per player on a ring or in
the corners, each moved to the nearest ground the placement checks accept, and selects
them so you can drag them where you want. For a melee map, the Melee Wizard plugin (Plugins
▸ Browse Plugins…) lays out symmetric start locations with mineral lines and geysers at the
distance the game mines fastest from; see [Plugins](#plugins).

## Sprites

There are two kinds of sprite. Pure sprites are a graphic drawn where it stands with no unit behind it: tree
canopies, markers, glows. Unit sprites are records the game turns into a unit when the
map loads, which is how StarEdit does Installation doors and traps.

![The Sprites layer](images/sprites.webp)

The palette has a tab for each. Pure Sprites lists all 517 entries grouped as Units,
Effects and Doodads, the last named after the graphics file since the game ships no
sprite name table. Placement is free: click anywhere, no rules to refuse a spot. The
*Flipped* and *Disabled* ticks are the sprite flags.

Doodad overlays are ordinary sprite records and can be selected here too. The
Properties panel says which doodad one belongs to and warns that moving it alone leaves
the doodad's tiles behind.

## Locations

Locations are the rectangles that triggers refer to, as in "bring a unit to *Beacon*" or
"create a unit at *Spawn*". A melee map needs none.

![The Locations layer with two locations](images/locations.webp)

Drag on empty ground to create one, drag the eight handles to resize, drag inside to
move, arrow keys to nudge the selected ones (with nothing selected they scroll the view). *Snap* is off, 8 or 16 pixels, one tile or 64 px, and a move
snaps the box's corner rather than the pointer, so a box picked up off-grid lands on
it. The palette lists every location in use, and Scenario ▸ Locations is the same list
as a sortable table.

![Location Properties](images/location-properties.webp)

Double-click one for its name and exact bounds, and for the elevation ticks: a location
applies only on the ticked elevations, which is how you keep a trigger from firing on the
cliff above it. An amber stripe on a location's row marks one that excludes something.

Locations live in a fixed table of slots — 64 in original maps, 255 in Brood War — so
nothing is ever inserted or removed: a new location takes the lowest free slot, deleting
one blanks it, and triggers keep pointing at the slot they named. The last slot is
**Anywhere**, the location every trigger can pick, and the game and other editors depend
on it being exactly the map. It is pinned at the top of the list with a lock, never
drawn, never picked by a click, and cannot be moved, renamed or deleted. If a map's
Anywhere has gone missing or drifted off the map bounds, the editor offers to put it
back.

## Fog of war

The fog of war decides which tiles a player starts the game unable to see. Every player
has their own, and a
map that carries no fog data at all starts fully fogged — which is what a new map does,
and what the editor draws until the first stroke.

![The Fog of War layer at 50% zoom, clearing an area for Player 1](images/fog.webp)

Select any of the eight players at the top of the palette and every stroke and fill edits
all of them at once; *View* picks whose fog the map and minimap show. *Fog* and *Clear*
are the brush modes, Shift-drag paints the opposite, and Alt+click picks up which players
have fog on a tile. Fog All, Clear All, Invert and Copy Fog act on the whole map for the
selected players.

Fogged tiles darken over everything, units and locations included, in the tint the game
itself uses for that tileset.

## Cut, copy and paste

To copy part of a map, drag on it with the Cut / Copy / Paste layer active (`C`) to mark a rectangle, then
Ctrl+C or Ctrl+X. On the object layers the same keys act on the selection instead, and
the clip is the selection's bounding box carrying just those objects, so a base can be
copied from either side.

![A marked area copied and being pasted](images/clipboard.webp)

A piece worth keeping past this map — a ramp, a bridge, a cliff corner — can be saved as a
*stamp* (Edit ▸ Save as Stamp…, or the right-click menu on the marked area) and laid down
on any later map from the Stamps panel; see [Plugins](#plugins).

*Include* says both what a copy takes and what a paste lays down: terrain, doodads,
units, sprites, locations, fog. Terrain carries the ground under the doodads too, so a
paste without doodads shows plain ground rather than half a tree. Doodads are re-stamped
with their overlays, units get fresh serials with add-on and Nydus links kept when both
ends came along, and locations take free slots, which is the one thing a paste can run
out of.

Ctrl+V arms the pointer with a ghost of the clip. A click stamps it and stays armed for
the next; Esc or right-click stops. *Merge* adds to what is there; *Replace* clears the
units, sprites and doodads under the clip first, though never locations. Terrain from a
different tileset is refused, since tile numbers mean something else there, while the
objects still paste. The clip survives File ▸ Open, which is how a base moves between
maps.

## Triggers

Triggers are what turn a map into a scenario: *when* these conditions hold *for* these
players, *do* these actions. In a melee game the map's triggers are ignored and the game
applies its own rules, so a melee map needs none (Blizzard's own carry the three standard
ones — defeat, victory, starting resources — for anyone who opens them as Use Map
Settings); a "Use Map Settings" map is nothing but triggers. Three editors over the same
list, and a fourth for mission briefings. The [trigger reference](triggers.md) has a
page for every condition and action.

To see how a map's triggers fit together, the Trigger Map plugin (Plugins ▸ Browse
Plugins…) draws them as a graph: which triggers set a switch, a death counter or a
location and which ones read it, with a list of switches nothing sets, counters nothing
reads and triggers that never run. See [Plugins](#plugins).

### The Trigger Editor

Ctrl+T. The StarEdit form: a player filter on the left, the trigger list in the middle,
and for the selected trigger its players, up to 16 conditions and up to 64 actions.

![The Trigger Editor on Big Game Hunters' three melee triggers](images/trigger-editor.webp)

Every condition and action the game has is there, each argument gets a widget of its
kind — a player pick, a unit type list, a location list, a number, a text box with the
colour codes — and any value the tables do not list stays selectable as a raw number,
which is how EUD players and odd unit ids get in. An item can be disabled without deleting
it, as in SCMDraft; a disabled one is kept in the file and skipped by the game. *Preserve
trigger* is the flag that keeps a trigger firing more than once.

### The Text Trigger Editor

The same triggers as text, in SCMDraft 2's TrigEdit syntax, so text from SCMDraft pastes
in and text from here pastes back out. Compile checks it and reports the first line that
does not parse. It is a plugin ([TrigEdit](https://github.com/scm-js/plugin-trigedit)),
installed but starting *off*: tick it on in Plugins ▸ Manage Plugins… and Triggers ▸ Text
Trigger Editor… and its Ctrl+Shift+T appear. The text format itself stays in the editor,
so File ▸ Import / Export Triggers read and write the same text whether the plugin is on
or not.

![The Text Trigger Editor](images/text-triggers.webp)

A leading `;` disables a line, and a `Flags:` block carries the trigger flags SCMDraft
has no syntax for. The *Briefing* switch at the top edits the mission briefing in the
same syntax.

### TrigScript

Triggers ▸ TrigScript… is the third editor: triggers as code. It is a plugin, on from the
start, and it has a [guide of its own](trigscript.md) — TypeScript files kept inside
the map, turned into a block of ordinary triggers, with loops and helpers to write them,
and programs that run in the game for a map made for StarCraft: Remastered.

### Mission briefings

Triggers ▸ Mission Briefing… is the same form over the briefing action set: text,
portraits, transmissions and the pauses between them, one briefing per player. The
layout is checked against the briefings on Blizzard's own multiplayer maps.

![The Mission Briefing editor on Ground Zero](images/briefing.webp)

### Unit properties slots

Triggers ▸ Unit Properties Slots… is the table behind the *Create Unit with Properties*
action: 64 slots, each the hit points, shields and energy (as percentages), resources,
hangar count and special states a trigger applies to the units it creates. The action's
argument lists the slots by what they set and opens this editor on one.

![The Unit Properties Slots dialog](images/cuwp.webp)

### EUD

For EUD work, the player pick next to a Deaths condition or Set Deaths action has an
*EPD* box: type a memory address and it becomes the player value that reaches it
through the deaths table, and a raw value shows which address it reaches. Check Map
points out the raw values so they are not mistaken for errors.

File ▸ Import and Export carry triggers as `.trg` files (SCMDraft's format) or as text,
appending to or replacing the map's list. Triggers ▸ Validate Triggers is Check Map
restricted to them.

## TrigScript

TrigScript writes triggers as code: TypeScript files kept inside the map. It is a plugin,
on from the start, and Triggers ▸ TrigScript… opens it as soon as a map is open. Each
`trigger()` call the script makes becomes an ordinary trigger, the same kind the Trigger
Editor shows, and plays on any version of the game. Code inside `program(() => { … })`
runs in the game itself, with variables, arrays, functions and loops, and **a map with a
program in it needs StarCraft: Remastered**.

![The TrigScript editor on a wave-defence script: the files on the left and the code checked as you type](images/trigscript.webp)

TrigScript has a guide of its own, [docs/trigscript.md](trigscript.md):

- [Opening the script](trigscript.md#opening-the-script): the script window, its
  files, Simulate and Apply.
- [Tests](trigscript.md#tests): tests that check the script in the simulator after
  every change.
- [Beside the map](trigscript.md#beside-the-map): the script in a panel over the map.
- [Writing triggers](trigscript.md#writing-triggers): `trigger()` and the helpers for
  writing many at once.
- [Programs](trigscript.md#programs): code that runs in the game.
- [TrigScript beside TypeScript](trigscript.md#trigscript-beside-typescript): what
  works inside a program as it does in TypeScript, and what differs.
- [Examples](trigscript.md#examples): complete scripts to start from.
- [Reference](trigscript.md#reference): every function, and what is not supported.

## Scenario settings

The Scenario menu holds the map's own tables. Each dialog is its own OK / Apply / Cancel
transaction; none of it is in the undo history.

### Map Properties, Players, Forces, Colours

![Map Properties](images/map-properties.webp)

**Map Properties** (Alt+Enter) is the name and description the lobby shows, the tileset,
the size and the revision, with buttons to the rest. Changing the tileset lays the terrain
again with a terrain you pick — tile numbers mean something else in every tileset — and
drops the doodads with it, while units, sprites, locations, fog and triggers stay; or
keep the tile numbers, as SCMDraft does, to see what they draw. **Resize / Crop** grows
or trims the map about a corner or the centre. Both clear the undo history.

![Player Settings](images/player-settings.webp)

**Player Settings** is each slot's controller (Human, Computer, Rescuable, Neutral…),
race, colour and force.

![Force Settings](images/force-settings.webp)

**Force Settings** groups the players into up to four teams and sets, per team, allied
victory, shared vision, allies and random start locations.

**Player Colors** picks each slot's palette colour and, for a Remastered map, a custom
RGB, random, or the player's own choice; the map repaints as you change them.

![Player Colors](images/player-colors.webp)

### Units, upgrades and technology

![Unit Settings](images/unit-settings.webp)

**Unit Settings**, **Upgrade Settings** and **Technology Settings** edit the cost and
availability tables: a unit's hit points, armour, build time, cost and weapon damage, a
custom name, and which players may build it; an upgrade's cost and levels; a
technology's cost and whether each player starts with it or may research it. A row on
*use default* shows the greyed-out numbers from the game's own data files and seeds itself
from them when you untick it.

### Strings

![The String Editor](images/string-editor.webp)

Every piece of text a map carries — its name, the force names, location names, every
trigger message — is a numbered string, and the **String Editor** lists them all with
where each is used. Edits keep their number, so triggers and locations keep pointing
where they did; *Delete unused* clears out what nothing refers to.

The row of buttons inserts the game's colour codes, each drawn in the colour it produces,
and the preview under the box shows the string the way the game draws it. The same codes
work in every field whose text the game draws: the map name and description, force names,
custom unit names, and the text of a trigger or briefing action — each of those fields
shows the string as the game draws it until you click into it, and has a palette button
at its right-hand end.

The previews follow Remastered's rule, where a colour set on one line carries onto the
next. StarCraft 1.16.1 reset the colour at every line break, so a string written before
the remaster can draw in colours its author never chose; the *1.16.1 colours* tick (also
in Preferences ▸ View) switches every preview to the old rendering, and the Repair
plugin offers to write the reset the old game used to supply.

A map file does not say what encoding its text is in. StarEdit wrote whatever code page
Windows was using — EUC-KR on a Korean machine, Shift_JIS on a Japanese one,
Windows-1252 nearly everywhere else — and 1.16.1 still reads the file that way;
Remastered writes UTF-8 and, reading, tries UTF-8 first and then the code page of the
machine it is running on. The editor guesses the encoding from the file's bytes when a
map opens and shows the guess in **Scenario ▸ Map Revision**, where it can be corrected:
Korean text that opened as garbage is a wrong guess, and choosing *Korean* there fixes
every string at once. The same choice decides how the text is written on save, so a map
made for 1.16.1 on a Korean Windows stays readable there; a new map is UTF-8, and moving
a map to Remastered's STRx table makes it UTF-8 too. A character the chosen encoding
cannot hold is written as `?`, and Check Map and the Save dialog both say so beforehand.

### Sounds and switches

The **Sound Editor** joins the map's sound table with the `.wav` files in the archive:
import, play, remove, and adopt files the archive carries but the table does not list.
Import takes any file the browser can decode (MP3, FLAC, AAC, Ogg, WAV in any encoding)
and writes it as PCM WAV in the format picked next to the button; the default, 22050 Hz
16-bit mono, is what the game's own sounds are, and the smaller presets are for maps
chasing the size limit. A *Play WAV* action then names the file.

**Switches** names the 256 switches triggers set and test, so the trigger editors show
"Gate open" rather than "Switch 3".

## Checking, testing and saving

Before a map is played, it can be checked for common mistakes, tried in the game, and
saved in the form you want to release.

### Check Map

![Check Map on a new map: eight players and no start locations yet](images/check-map.webp)

Tools ▸ Check Map looks for what the game would refuse or silently drop: start locations
that do not match the player table, the unit limit (1700), off-map units, a missing or
moved Anywhere, triggers pointing at unused locations or strings past the end of the
table, unit and player values the game does not have, AI scripts it does not ship, Play
WAV actions with no file in the archive, switches tested but never set, and the file's
own health — missing sections, player types where StarEdit's copy disagrees with the
game's, the isometric record. A map with triggers is a scenario, and gets the scenario
checks too: a human player no trigger ever gives Victory or Defeat (in a scenario nobody
wins or loses unless a trigger says so), a missing Set Mission Objectives, and — when
hyper triggers are present — a Wait in another preserved trigger, which stalls that
player's whole trigger queue. Double-click an issue to go to it. The same check runs
inside the Save dialog.

### Test Map

![The Test Map dialog](images/test-map.webp)

Tools ▸ Test Map (Ctrl+F5) hands the map to the game. Neither StarCraft build opens a map
from the outside, so the editor writes it into a `scmJS` folder under the game's Maps
folder, where Single Player ▸ Custom Game lists it. The desktop app finds the
installation (or takes a folder you pick) and starts the game as well; in Chrome and
Edge the map goes into a folder you pick once, and other browsers download it.

### Saving

Ctrl+S writes the map back where it came from. In Chrome, Edge and the desktop app the
editor keeps a handle to the file it opened, so Save writes in place once the browser has
asked for permission. Firefox and Safari give the editor a file's contents but no way to
write it back, so there every save is a download, and the notice at the bottom right says
so. Save As (Ctrl+Shift+S) and Save Copy As open the Save dialog; a copy is written
without the open map changing its name or file.

![The Save dialog](images/save.webp)

The Save dialog asks for a file name, a format and what to keep. Everything else is
folded away underneath and can be left alone:

- **Format**: `.scx` (Brood War), `.scm` (original StarCraft), or a bare `.chk`, the
  scenario alone with no archive around it.
- **What to keep**: *Everything* writes the whole file, so any editor can open it with
  nothing lost. *Smallest that plays* leaves out the parts only an editor reads (the
  isometric record, the editor's copies of the player table and so on) and compresses
  the archive as StarEdit does; the map plays the same, but an editor opening the file
  later has less to work with. *Custom* shows each of those parts with its own tick. The
  map in the editor is not changed either way.
- **Archive** (folded): the compression and StarEdit's encryption tick, and the other
  files in the archive. PKWARE is what StarEdit writes and what Blizzard's own maps are
  stored as, so every StarCraft build reads it; zlib is smaller and needs 1.16.1 or
  Remastered; none is the largest and readable by anything. A map keeps the compression
  it was opened with, and the fold starts open when a map is not stored the usual way.
  The sounds and the files plugins keep in the archive each have a tick, so a copy for
  release can leave them out. A member the editor cannot name — a protected map's
  archive often has no file list — is kept exactly as stored, and the fold says how
  many there are.
- **Sections** (folded): every section the file will hold, with its size and whether it
  changed, was left out or was merged.

If Check Map finds problems, the dialog says how many beside a button that opens it; the
map saves either way.

The options confirmed here are what Ctrl+S reuses for that map from then on.

A save that writes over a file keeps what it replaced. The desktop app copies the old
file to a `.bak` beside it first (`Lagoon.scx` to `Lagoon.scx.bak`, replacing an older
`.bak`), however the map was opened: File ▸ Open, Open Recent, a drop onto the window or a
double-click. If the `.bak` cannot be written (a read-only folder, say), the save still
goes through, a notice says why, and the old file goes to Previous Versions instead. A
browser cannot put a file beside another, so there the
version replaced is kept in the browser's storage, the last three of each file name, and
**File ▸ Previous Versions…** lists them: **Open** puts one in its own tab with
"(previous)" added to its name, and **Save As** writes it out as it was. A download
replaces nothing, so Firefox and Safari have nothing to keep. Preferences ▸ General ▸
Saving turns this off.

A plugin that compiles something into the map, as the eudplib plugin does for scripts
that need Remastered, does it while the file is written. The file you save is the one
the game plays, and it carries the map as you see it in the editor inside, which is what
comes back when you open it again. A notice shows while the build runs, with a button to
save without waiting for it. If the build fails, the map is still saved and the notice
says what went wrong; the file then lacks the built part until a later save succeeds.
Test Map builds the same way and stops on a failure instead.

**Save to scmjs.dev…**, under File and under Account, keeps a copy of the map on your
scmjs.dev account as a numbered revision with a note — a backup with a history, and the
way to reach the same map from another machine. It does not change where Ctrl+S writes.
See [Keeping maps on scmjs.dev](#keeping-maps-on-scmjsdev).

### Recovery copies

While a map has unsaved changes, the editor keeps a copy of it in the browser's storage
(the app's own storage in the desktop app): every two minutes, and whenever the editor
goes to the background — another tab, the window minimised. The copy is removed as soon
as the map is saved or closed, so a copy only survives when the editor closed with work
unsaved: a crash, a closed tab, a power cut.

At the next start the **Recover Maps** dialog lists what was left, with the map's name,
its file, its size and when it was copied. **Restore** opens the map in its own tab with
its changes unsaved, under its old file name, so Ctrl+S writes back to the same file
(after the browser asks again for permission). **Later** keeps the copies for the next
start, and File ▸ Recover Maps… lists them at any time. Maps still open in another tab or
window are never listed there.

Quitting the desktop app and answering Don't Save removes the copies, since that was the
answer. A copy only covers changes up to its time, and it lives in this browser: it is not
a backup of the file, and clearing the site's data removes it. Preferences ▸ General ▸
Recovery turns the copies off or changes how often they are made.

### Export an image

![The Export Image dialog](images/export-image.webp)

File ▸ Export ▸ Image renders the whole map to a PNG, with one dial that decides what
the picture is: at 32 pixels per tile it is the full game art, at 8 or 16 the same
smaller, at 4 and 2 the mean tile colours with units as minimap dots, and at 1 pixel per
tile it is the game's minimap. Units, locations, fog and the grid are each a tick.

To show how a map was made rather than how it ended up, the Timelapse plugin (Plugins ▸
Browse Plugins…) records the map one change at a time and exports the recording as a GIF
or a WebM video; see [Plugins](#plugins).

Tools ▸ Statistics counts what the map holds — units per player, resources, doodads,
triggers, strings — and Ctrl+F finds a unit, location, sprite, string or trigger by name.

## Your scmjs.dev account

[scmjs.dev](https://scmjs.dev) is the project's own service. An account there does three
things for the editor: it keeps maps for you, with a history of revisions and links
that give anyone a copy, it lets you
share the map you have open so others can edit it with you at the same time
([Editing a map together](#editing-a-map-together)), and it pays
for the AI features in the [next section](#the-ai). None of it is required. The editor
works completely without an account, and it sends nothing to scmjs.dev until you use one
of these features — there is no request at startup unless you are already signed in, and
then only to show your balance.

All of it lives in the scmjs.dev plugin, which is installed and on from the start. If
you would rather not see the Account menu at all, turn the plugin off in Plugins ▸
Manage Plugins….

### Signing in

![The Account dialog, signed in](images/account.webp)

The **Account** menu and the cell at the right end of the status bar are the two ways
in; either opens the Account dialog. Sign in with Discord: the provider's own page opens
in a small window, you approve it there, and the window closes itself. The editor never
sees a password, only a display name and an id from the provider.

Signed in, the dialog shows your name, your balance, the sign-in you used, how much of
your map storage is in use, and a list of recent activity — every AI request with what it
cost, and every credit. The buttons top up the balance, open your account page on
scmjs.dev (to link another sign-in, or delete the account and everything with it), open
My Maps, and sign out. Under *Settings* are two ticks: **Use the AI features**, which
takes the whole of Tools ▸ AI away when off and leaves the account and the maps, and
the status-bar cell.

What scmjs.dev keeps is short: the id and display name from your sign-in, a ledger of
what your requests cost, and the maps you store there. It keeps no prompts and no card
details — payment happens on the payment provider's page. The account page deletes all
of it.

### Keeping maps on scmjs.dev

![My Maps: three maps on the account, one with two revisions](images/my-maps.webp)

**Account ▸ My Maps…** — also File ▸ Open from scmjs.dev… — lists the maps on your
account, newest change first, each with a picture, its tileset, size and player count,
and how many revisions it has. The box above the list searches the names, tilesets, file
names and notes. The map you last opened or saved from here is picked when the list
arrives, and its revisions appear on the right: the number, the note you wrote, the file
name, the size and when it was saved. Up and Down move through the list, and Enter opens
the map. **Open** puts the picked revision in the editor, asking first if the map you have
open has unsaved changes; **Download** saves the file to disk as it was uploaded; the
note can be added or edited later and the map renamed. A revision can be deleted, except
the last one — delete the map to remove it.

![Save to scmjs.dev: a second revision of Big Game Hunters with a note](images/save-to-scmjs.webp)

**Account ▸ Save to scmjs.dev…** — also under File, beside Save Copy As — saves the open
map to the account, as a new map or as the next revision of one you pick; the map it was
opened from or last saved to is picked for you. Write a note saying what changed, and
tick whether to include a one-pixel-per-tile picture for the list. The file is what
File ▸ Save would write, with the save options you last confirmed, so what comes back is
playable. It is a copy: Ctrl+S goes on writing to the file on your disk, and nothing on
the account changes until you save there again.

Revisions are numbered in order and a number is never reused. Saving a file whose bytes
are already on the account costs no storage — only the new note is kept — so saving a
note on its own is free. Storage is 250 MB per account on scmjs.dev, shown as a bar in
both dialogs. Maps live on a signed-in account only; the free AI trial cannot store them.

### Giving someone a copy

A link can hand a map to anyone: whoever opens it gets a copy of the map in their own
editor, without signing in. The copy is theirs — it opens as a new file, File ▸ Save
asks where to keep it, and nothing they change reaches your map. To edit a map together
instead, see [Editing a map together](#editing-a-map-together).

**Account ▸ Copy Link to This Map…** saves the open map to your account — as the next
revision of the map it came from, or as a new map — and gives you the link, already on
the clipboard. The link always opens the version you just saved, so a link you have
posted somewhere does not change under the people who follow it; tick *Let the link
follow my later saves* for one that opens whatever you save to that map next.

Pasted into Discord, Slack, a forum or most other places that show previews, a link to
the web editor shows a card with the map's name, who shared it, its tileset, size and
players, and its picture. A link that has been removed shows a card saying it no longer
works.

**Embed…** beside a link in My Maps gives you that card as a picture to put somewhere
yourself, with the link around it: a forum post or signature (BBCode), a GitHub README or
a Discourse forum (Markdown), or a website (HTML). Pick the large picture (1200 × 630) or
the small one (600 × 315) for a signature, and copy the code. The picture's own address
opens nothing: only the link you wrap it in does. When the link is removed, the picture
says the map is no longer shared.

The picture of the map on the card is drawn by your editor when it saves the map to
scmjs.dev, so a map saved without the game's graphics installed gets its size in its
place.

In **My Maps**, the *Links* part of a map lists its links, how many times each was
opened, and **Remove** for each; a removed link stops working at once and the map stays.
*Link to #3* makes a link to the revision you are looking at, *Link to the newest* one
that follows your saves. Deleting a revision removes the links to it, and deleting a map
removes all of its links. A map can have ten links.

Opening a link starts the editor with an *Open a Copy* dialog showing the map's name,
picture, size and who shared it; **Open a copy** opens it. **Account ▸ Open a Map
Link…** takes a link pasted in, which is the way in the desktop editor.

### Balance and costs

The account and the map storage cost nothing. The AI does: each request is charged what
the model's work cost, and the balance in the status bar and the Account dialog is what
you have left. It fills in three steps:

- **A free trial.** The first AI request you make starts one, with no sign-in — one per
  browser. The Account dialog says how much it is worth.
- **Sign-in credit.** Signing in adds a one-time credit (once per sign-in identity) and
  keeps whatever the trial had left. The balance then follows your account, so another
  browser or the desktop app picks it up when you sign in there.
- **Top up.** When that is spent, Top up… in the Account dialog buys credit at cost,
  through a payment page in a new tab. Bought credit does not expire.

Every AI dialog shows what the request cost once it is back and what the session has
cost so far; the *Quality* choice in the AI Options decides how hard the model works on a
request, and so what it costs (see [Options](#options-and-turning-it-off)). Roughly, a
name or a translation costs a few cents and a map plan, a trigger script or a review a
few tens of cents. When the balance runs out the dialog says so and points to the Account
dialog.

## Editing a map together

![Big Game Hunters shared by three people: Kim's pointer beside the marines she just placed, Sam in Player Settings, and the edges of what each of them can see](images/share-editing.webp)

Several people can work on one map at the same time, each in their own editor. One of
them shares the map they have open and sends the others a link; whoever opens it gets the
map in their editor, and from then on every change anyone makes shows up for everyone:
terrain, doodads, units, sprites, locations, fog, the settings dialogs, triggers, strings
and sounds. Each person also sees the others' pointers on the map with their names, a
dashed box in their colour around what each of them has on screen, and which dialog they
are in.

Sharing goes through scmjs.dev: the person who shares needs a signed-in
[account](#your-scmjsdev-account), and the people joining need only the link.

### Sharing a map

![The Share dialog while the map is shared: the link, how long it is kept open, the three people in it, and Leave and End sharing](images/share-dialog.webp)

**Account ▸ Share this Map…** asks for a name for the map (its own name to start with) and
how long to **keep it open**, and copies it to scmjs.dev when you press **Start sharing**.
The dialog then shows the link: **Copy** puts it on the clipboard for you to send. A cell
appears in the status bar — *Shared · 3 people* — and clicking it opens the dialog again.
Pasted into Discord, Slack or a forum, the link shows a card with the map's name, who
shared it and, for a map kept open, its picture.

![Share this Map before sharing starts: the name, Keep it open set to For a week, and what that means](images/share-keep.webp)

*Keep it open* decides what happens when people leave:

- **Until everyone leaves** (the choice to start with) shares the map only while people are
  in it. Nothing is stored: sharing ends when you stop it, half an hour after the last
  person leaves, or when the server restarts.
- **For a day**, **for a week** or **for a month** saves the map to
  [My Maps](#your-scmjsdev-account) and keeps it open at its link, so people can come and
  go as they like, on different days if they want. Each time everyone has left, the map is
  saved as a new revision with a note naming who changed it (*Edited together: Kim, Sam*),
  and the next person to open the link carries on from there. The time counts from the last
  edit, so a map people are working on stays open, and one nobody has touched for that long
  ends. The dialog shows the date: *ends 3 Oct unless someone edits it*.
- **Until I end it** keeps it open with no time limit. It still ends after a year with no
  edits.

When a map kept open ends, only the sharing ends: the map and its revisions stay in My Maps.
If the map in front came from My Maps, sharing it adds a revision to that map rather than
making a second one.

The dialog lists who is in, in the colour their pointer is drawn in, and what each of them
has open. The link is the key: anyone who has it can join and edit, so send it only to
people you want in the map. Only you, as the person who shared it, see the link and the
controls:

- **Remove** sends one person out of the map. They keep what they had.
- **New link** makes the old link stop working without sending anyone out, for when the
  link went further than you meant.
- **Stop sharing** (**End sharing** on a map kept open) ends it for everyone. On a map kept
  open, **Leave** takes only you out and leaves it open for the others; you can change how
  long it stays open here too.

Up to eight people can be in one map, and an account can share five maps at a time,
counting both kinds. A map shared from the desktop app gets a link to the web editor,
since that is what anyone can open.

### Your shared maps

![The Shared maps part of the Account dialog: two maps kept open and one shared until everyone leaves, with who is in each, the last edit and when it ends](images/share-account.webp)

The **Shared maps** part of **Account ▸ Account…** lists every map you are sharing: who is
in it now, the last edit and who made it, and when it ends. Each has **Join**, **Copy
link**, **New link**, how long to keep it open, and **End sharing**. When you are already
sharing five, Share this Map… shows the same list so you can end one first.

![My Maps with a map kept open: marked Shared · 3 editing, with Put #1 into the shared map and End sharing](images/share-mymaps.webp)

A map kept open also has **Embed…** in that list and in the Share dialog. Its picture
can open a copy of the map (the choice it starts with: a link to the newest revision is
made for it) or the shared map itself. The second lets anyone who sees the picture join
and edit, and the dialog says so; **New link** is the way back if it went further than
you meant.

In **My Maps** a map kept open says so (*Shared · 2 editing*, or when it ends), and
**Join** opens it with whoever is there; **Open** still gives you a revision on its own.
While you are in one of your maps kept open, a revision of it has **Put #N into the shared
map**, which replaces the map for everyone with that revision: the way back if someone
spoiled it. Everyone's undo history starts again, as after a resize, and the map as it was
is not kept unless you saved it first.

### Joining

![Joining from a link: the map's name, who shared it, and the name the others will see](images/share-join.webp)

Open the link in a browser and the editor starts with the Join dialog up. In the desktop
app, or in an editor that is already open, paste the link into **Account ▸ Join a Shared
Map…**. The dialog says which map the link leads to, who shared it and how many people are
in it; type the name the others will see you by and press **Join**. The map opens in a new
tab beside whatever you had open (or in place of the empty map the editor starts with).
Closing that tab leaves the shared map.

You can be in one shared map at a time. Joining another leaves the first, which stays
open as an ordinary map.

### Talking to each other

While a shared map is in front, a **Chat** button sits in the bottom-right corner of the
map, next to the tileset and zoom. It opens a small window over the map with what everyone
has written and a line to type in; Enter sends. What you type there goes to everyone in the
map and nowhere else, and typing in it does not trigger the editor's shortcut keys.

When the chat is closed, a new message shows as a notice and as a count on the button. Anyone
who joins later sees what was said before them. The chat is kept only while people are in
the map: it is gone when sharing ends, or when everyone has left a map kept open, and it is
not saved with the map.

### When two people change the same thing

- **Your stroke is never cut in two.** While you hold the mouse button on the map, other
  people's changes wait and arrive when you let go. The same happens while a dialog that
  edits the map is open (Player Settings, the Trigger Editor, Unit Properties and the
  like); the others see that you are in it, next to your pointer and in the Share dialog.
- **The later change wins.** If two people paint the same tile, the change the server got
  second stays. If two people move the same unit, the first move stands and the second is
  dropped, because the unit is no longer where the second person's editor had it; the
  status bar says when some of your change no longer applied. A dialog's OK writes its
  whole table, so if two people change the triggers at the same time, the second OK wins.
  When you see someone in the Trigger Editor, talk before you open it too.
- **Undo is yours.** Ctrl+Z takes back your own changes, not other people's, and leaves a
  tile alone once someone else has painted over it.
- **Resize, a tileset change and a raw section edit** replace the whole map for everyone,
  and everyone's undo history starts again, as it does when you do them alone.

### Saving, and when it ends

Saving is each person's own: File ▸ Save writes your copy to your disk, and anyone in the
map can save at any time. A map shared *until everyone leaves* is kept on scmjs.dev only
while it is shared, and nothing of it is stored there afterwards; a map kept open is one of
the sharer's maps in My Maps, and its revisions stay there after sharing ends. Everyone
still has the map open in their editor when sharing ends, so nobody loses work — save it.

A server restart ends a map shared until everyone leaves, but not a map kept open: the
editors in it reconnect on their own when the server is back and carry on.

If your connection drops, the status bar says *Reconnecting…* and you can keep working:
your changes are kept and sent once the connection is back, and you get everyone else's
changes from while you were gone. The others see you as having lost the connection
meanwhile. If you are away so long that the server has moved on, the shared map opens
again in a new tab with everyone's latest, and your copy stays open in its own tab, with
a note saying how many of your changes the others never got. After two minutes of trying,
the editor gives up and leaves the shared map; the map stays open, and the link still
works.

If the server cannot take one of your changes, your editor leaves the shared map and says
so. The map stays open; save it, or open the link again to carry on with everyone's
latest.

## The AI

![The Tools ▸ AI menu](images/ai-menu.webp)

**Tools ▸ AI** holds the AI features. They come with the editor as part of the scmjs.dev
plugin and run on scmjs.dev, so there is no key to paste and no server to set up. The
first request starts the free trial. [The previous section](#your-scmjsdev-account) covers
the account and what requests cost.

A few things are the same for every feature:

- **What is sent.** Only what the feature needs: what you typed and the map's facts (size,
  tileset, players, what is where). Some features also send a picture of the map, the
  strings or the triggers. The map file itself is never sent.
- **Undo.** Every change the AI makes is one undo step, labelled "AI: …". The exception is
  anything written through a settings dialog (the name and description, strings, triggers,
  players, unit settings). Those changes are left out of the undo history, just like when
  you make them by hand, and the dialogs point this out.
- **Cost.** Every AI dialog shows its progress while you wait, and the cost when it
  finishes.

### The assistant

![The assistant placing a squad for Player 1 on Big Game Hunters](images/assistant.webp)

**Assistant** (Ctrl+Shift+A, or the *AI* cell in the status bar) opens a conversation
about the open map. Ask a question or say what to change. The assistant reads the map and
edits it with the editor's own tools while you watch.

It can **read** everything: the map's facts and statistics, units with all their
properties, doodads, sprites, locations, strings, switches, sounds, the triggers and
trigger script, unit, upgrade and technology settings, fog, terrain, Check Map results,
your selection, and a screenshot of any area.

It can **change** nearly everything the editor can: terrain, units, doodads, sprites,
locations, fog, the map's name, triggers, strings, the trigger script, players and forces,
unit, upgrade and technology settings, and the map's size. It also knows the systems and
layout presets that [Make Scenario](#make-scenario) uses, so "add kill to cash" or "make
this a two-lane defense" takes one step. It draws terrain as shapes, such as a plateau with
a ramp that fits, a lane that stays walkable or a river with a bridge. It can tell you
whether units can walk from one place to another. It also checks the rules the game
enforces without telling you (a player who owns nothing is defeated at once), and fixes
them if you ask.

**Watching a turn.** Each turn shows your message, the answer, and the work in between,
folded into one block. While the turn runs, the block shows its latest steps: **▸** marks
a read and **✎** a change. The strip at the top of the panel shows what the assistant is
doing, how long it has taken and what it has cost so far. When the turn ends, the block
folds to one line showing the step and edit counts, any failures, the time, the cost and
an **Undo** button that reverses all of that turn's edits at once. Open the block to see
every step, the screenshots the assistant took (click one to enlarge it) and its
reasoning.

On the map, the area a step is about to change is outlined, and the result flashes after
the change. The view moves to each step and zooms out if the area is too big to show, but
it never zooms in. If you scroll or zoom yourself, the view stays where you put it for the
rest of the turn. To turn the following off completely, untick *Follow the assistant's
work around the map* in Tools ▸ AI ▸ Options…. You can close the panel while the assistant
works, since the status bar shows the same progress. Escape stops the turn.

**Starting a message.** The chips above the input suggest questions based on the layer
you are on and what you have selected. You can also right-click the map and choose *Ask AI
about this spot / the selection / this area…*. Tick *Picture* to send a screenshot of the
visible area with your message. Player Settings has a *Set up with AI…* button that sets
up players and forces from one sentence.

**Cost and limits.** Every message includes the map's current state: players, counts,
locations, the selection, the view and the latest undo step. The first message about a map
also includes a reference for the tileset, doodads, units and trigger vocabulary.
scmjs.dev caches that reference, so later messages cost little more than the words you
type. After 24 rounds of tool calls the assistant stops and offers to continue. You can
change that number in Options.

### Make Scenario

![Make Scenario: the design document for a four-player madness map](images/make-scenario.webp)

**Make Scenario…** builds a whole scenario from a sentence, such as "a madness map", "an
RPG about a marine lost on a Zerg world" or "a two-lane tower defense". Set the size,
tileset and number of players, then press **Design**.

**The design.** The model starts with a design document and builds nothing until you have
read it. The document covers the genre and premise, the players and forces, each trigger
system and its settings, a plan for the layout and the locations it needs, the objectives
and the briefing. You can edit any of it directly, or open **Change the design first**,
describe what should be different and press **Design again**.

A location name in a system's settings can include `{p}` for the player number, as in
"Spawn {p}". That system is then built once for each player, as long as the numbered
locations exist.

**Building.** **Build** works through the design one step at a time. Each step is a row
that passes or fails separately: the map, terrain and locations, players and forces, each
system, the objectives and briefing, the name, and a Check Map at the end.

- **Terrain.** If the design matches a *layout preset* (corner camps around an arena, lanes
  from spawns to a goal, a walled arena, a bound's winding course, or a town with a chain
  of regions), the editor lays out the terrain itself in about a second. Otherwise the
  model describes the terrain as shapes such as plateaus, lanes, rivers and arenas, and
  the editor draws them with its own brush. That keeps lanes connected and puts ramps and
  bridges only where they fit. This is the slow step, and a clock and the model's
  reasoning show under the rows while it runs.
- **Ramps and bridges.** Ramps always slope down toward the south-west or south-east,
  like the game's own ramps. Ice gets no ramps, and bridges are only drawn in Jungle and
  Space Platform, because those are the only tilesets whose pieces fit what the brush
  draws.
- **Systems.** The editor builds the systems it knows directly from their settings, the
  same way every time, and shows them in green. These include hyper triggers, timed
  spawns, kills paid in minerals, income, waves, lives, shops, healing, respawns,
  teleports, kill zones, leaderboards, countdowns, last standing, alliances, escalation
  stages, and a bound's obstacles and checkpoints. Anything else is written in TrigScript
  and shown in gold, which requires the TrigScript plugin.

When it finishes, choose **Review it…** or **Open the assistant** to keep going.

### Generate Map and Redo Area

![Generate Map: the plan as a coloured grid, with the designer's notes](images/generate-map.webp)

**Generate Map…** lays out a map from a description: the number of players, the kind of
terrain, where the bases go and the symmetry (or let the model choose). The result is a
*plan*, shown before anything is painted. It includes a rough grid of terrain types, the
bases with their mineral lines and geysers, ramps, decoration, a name and description,
and the designer's notes on how the layout is meant to play.

**Apply** paints the plan onto a new map with your chosen size and tileset, or onto the
open map if it is the same size. Terrain is painted with the isometric brush from the
lowest ground up, so cliffs and shores form on their own. Bases are laid out the same way
the Melee Wizard does it, and doodads are scattered where the plan puts them.

![The plan applied: a two-player jungle map with a lake in the middle](images/generated-map.webp)

Treat the result as a starting point. **Refine** sends the plan back along with your
changes ("more room around the naturals", "swap the lake for a plateau"), a picture of
the result, and anything the editor refused or Check Map flagged. The revised plan
replaces the old one, and the earlier result is undone first if nothing else was edited
in between. Ramps are placed as doodads chosen by size, so check them against the cliffs
before you play.

**Redo Area…** does the same for one part of an existing map. Mark an area (or right-click
it and choose *Redo this area with AI…*) and describe what should be there. The model sees
the area and a margin around it, plus a picture, so the new ground joins the old at the
edges.

### Triggers

**Write Triggers…** turns a description into triggers written in [TrigScript](#trigscript),
so the TrigScript plugin must be switched on. The model sees the map's own names for its
units, locations and switches. The script is checked here, and if it fails, the errors go
back to the model for up to two rounds of fixes. **Build** installs it the same way
TrigScript's own Build does, and the source is kept with the map. You can add to the
map's existing script or replace all of its triggers.

**Explain Triggers…** describes what the triggers do in play. It can cover all of them, a
range, or the mission briefing, or answer a question about them. The explanation appears
as it is written. The Trigger Editor, the Text Trigger Editor and Mission Briefing also
have *Explain*, *Write…* and *Ask* buttons.

### Names, briefings, reviews and strings

![Name and Describe: three names to pick from](images/name-describe.webp)

**Name and Describe…** suggests three names with descriptions based on what is on the
map. You can add a hint such as "short and grim" or "in German". Pick one and **Use this**
writes it into Map Properties. Map Properties also has a *Suggest a name* button that fills
in its fields the same way and waits for you to press OK.

**Write Briefing…** writes objectives and narration and creates one mission briefing
trigger per player, with the objectives as a Mission Objectives action and each line as a
Text Message. You can edit the text before it is written.

![Review Map on Big Game Hunters](images/review-map.webp)

**Review Map…** sends a picture of the whole map with its statistics and Check Map results.
It returns a critique and a list of findings marked info, warning or problem, and findings
that refer to a spot on the map have a **Go to** button. The chips offer a melee balance
review, a readability review for scenarios, or "what to change first".

![Rewrite Strings: every string in use, translated, with a tick per row](images/rewrite-strings.webp)

**Rewrite Strings…** applies an instruction to the map's strings, such as translate, fix
spelling and grammar, shorten, or match the map's voice. It can cover every string in use,
or only trigger text, the briefing or names. It shows a before-and-after table with a tick
on every row that would change. **Apply ticked** writes them back in place without
renumbering, so triggers still point at the right strings. The String Editor's *Rewrite
with AI…* button opens the same dialog.

### Options, and turning it off

**Tools ▸ AI ▸ Options…** has a few settings:

- **Quality** sets how much effort the model puts into each request, and so how long it
  takes and what it costs. *Standard* uses the level each feature was tuned for, *Quick*
  is the cheapest and *Thorough* the most careful. You don't choose the model; scmjs.dev
  picks it.
- **Assistant** sets the rounds of tool calls per message and the picture tick. It also
  sets whether the panel floats over the map or docks on the right under the Properties
  panel, and whether the model's reasoning summary shows while it works.

**Use the AI features**, at the top of Options and also in the Account dialog, removes the
whole AI when unticked: the menu, the assistant, the status-bar cell and the AI buttons in
other dialogs. Your account and the maps stored on it are not affected.

## Plugins

Plugins add tools to the editor, and some of what this guide describes is a plugin:
Walkability, Paint, Repair, Terrain from Image, TrigScript, Stamp Library, scmjs.dev
(the account) and the scmscx.com search are installed and on from the start. One more is
installed but starts *off*: TrigEdit, the Text Trigger Editor, which is for text carried
in from SCMDraft rather than for every map. Tick it on in Plugins ▸ Manage Plugins… and
Triggers ▸ Text Trigger Editor… appears. Melee Wizard, Section Explorer, Timelapse and
Trigger Map are a click away.

![Browse Plugins](images/browse-plugins.webp)

Plugins ▸ Browse Plugins… lists the plugins the project publishes; press Install on one
and it shows where the code comes from before adding it. Plugins ▸ Manage Plugins… lists
what is installed, turns each on or off, and takes the address of any other plugin —
a GitHub repository, a link to its `plugin.json`, or `http://localhost:3000/` while you
write one. A plugin that has settings keeps them on its own page under Edit ▸ Preferences
▸ Plugins. There is no sandbox: a plugin has the same access as the editor itself, so only
add plugins you trust. The Add screen says as much and shows the manifest, the repository
and the addresses it will fetch from.

| Plugin | Where | What it does |
| --- | --- | --- |
| [Walkability](https://github.com/scm-js/plugin-walkability) | View ▸ Walkability (Ctrl+Shift+W) | Draws the ground as a unit walks it: islands, the areas the map divides into and the chokes between them with their widths, height seams with no ramp, and the distances between start locations. Reads only. |
| [Paint](https://github.com/scm-js/plugin-paint) | Tools ▸ Paint… (Ctrl+Shift+P) | Freehand, lines, shapes, spray and text, laying down whatever the active layer's palette has picked — so it paints units, doodads, sprites, terrain or fog depending on the layer. |
| [Repair](https://github.com/scm-js/plugin-repair) | on open, Tools ▸ Repair Map… | Reads a map the way the game does and lists what is missing, damaged, repeated or the wrong size, each with the repair and what the game does without it. Rebuilds a stripped isometric record. |
| [Terrain from Image](https://github.com/scm-js/plugin-image-to-terrain) | File ▸ Import ▸ Terrain from Image… | Turns a picture into terrain, over the whole map or a rectangle you drag, painted with the isometric brush so cliffs and shorelines are laid at every boundary. |
| [scmscx.com](https://github.com/scm-js/plugin-scm-scx) | File ▸ Find on scmscx.com… | Searches the map archive at [scmscx.com](https://scmscx.com) by name, tileset, players and size, shows each map's minimap and details, and opens the one you pick. The site's API sends no cross-origin header, so unless the editor is served from scmscx.com the requests go by way of a small forwarder the plugin comes with; its page in Edit ▸ Preferences ▸ Plugins holds its address and how many minimaps to ask for. A link to `editor.scmjs.dev/scmscx/` followed by a map's id on the site opens the editor with the search on that map. |
| [Melee Wizard](https://github.com/scm-js/plugin-melee-wizard) | Tools ▸ Melee Wizard… (Ctrl+Shift+M) | Symmetric start locations, and mineral lines and geysers laid out at the distance the game mines fastest from; presets for main, natural and third; a symmetry check and a resource summary. |
| [TrigScript](https://github.com/scm-js/plugin-trigscript) | Triggers ▸ TrigScript… | Triggers as code: TypeScript files kept inside the map and built into a block of the trigger list — ordinary code that runs when you build, and `program()` bodies that run in the game, built into the saved map by the eudplib plugin (StarCraft: Remastered). See [TrigScript](#trigscript). |
| [Stamp Library](https://github.com/scm-js/plugin-stamp-library) | Tools ▸ Stamp Library… (Ctrl+Shift+L), Edit ▸ Save as Stamp… (Ctrl+Shift+K) | Named pieces — a ramp, a bridge, a cliff corner, a mineral line — saved from the marked area and kept across maps in the browser's storage. Click one and it hangs under the pointer, drawn with the map's graphics, aligned to the isometric lattice it came off; click to lay it down. Search, tags, JSON export and import, and one stamp as a line of text to share. |
| [Section Explorer](https://github.com/scm-js/plugin-section-explorer) | Tools ▸ Section Explorer… (Ctrl+Shift+H) | The map file as the game reads it: every section, a hex editor over the bytes, and what the byte under the cursor means. |
| [Timelapse](https://github.com/scm-js/plugin-timelapse) | View ▸ Timelapse…, the status-bar cell while it records | Records the map as you build it, one frame per change, and plays the recording back with a box around each change. Export it as a GIF or a WebM video. Recordings stay in the browser, and opening the same file again carries on the same recording. |
| [Trigger Map](https://github.com/scm-js/plugin-trigger-map) | Triggers ▸ Trigger Map…, Show in Trigger Map in the Trigger Editor, right-click a location | The triggers as a graph. Pick a trigger to see what it waits for and which triggers set that, and what it changes and which triggers read it; pick a switch, a death counter, a location or Victory to see who writes it and who reads it. A Findings list names switches nothing sets, counters nothing reads, locations that are not there and triggers that never run. |
| [scmjs.dev](https://github.com/scm-js/plugin-scmjs-dev) | Account menu, File ▸ Open from / Save to scmjs.dev…, Tools ▸ AI | Your [scmjs.dev](https://scmjs.dev) account: maps kept on it, links that give anyone a copy of one, a map shared for others to edit with you, and the AI — see [Your scmjs.dev account](#your-scmjsdev-account), [Editing a map together](#editing-a-map-together) and [The AI](#the-ai) above. One tick in its Account dialog turns the AI off and keeps the account. |

![The Walkability overlay on Big Game Hunters](images/walkability.webp)

![The Paint panel, drawing a line of the terrain palette's pick](images/paint.webp)

Each plugin has its own README with the details. Installing plugins, what they are allowed
to do, and writing one are covered in [docs/plugins.md](plugins.md). Browse Plugins
also lists [Hello World](https://github.com/scm-js/plugin-hello-world), an example plugin
with nothing in it but a Tools menu item, kept as the one to copy when writing your own,
and the [API Playground](https://github.com/scm-js/plugin-api-playground), a code editor
for trying the plugin API on the open map before writing a plugin.

## Keyboard and preferences

Press F1 for a list of every shortcut. These are the ones the editor starts with; any of the
commands can be given other keys on Preferences ▸ Hotkeys:

| Keys | |
| --- | --- |
| `T` `D` `U` `S` `L` `F` `C` | switch layer |
| `[` `]` | brush size |
| Alt+click | pick what is under the cursor |
| Ctrl+Z / Ctrl+Y | undo / redo |
| Del / Esc | delete selection / stop placing |
| Ctrl+O, Ctrl+S, Ctrl+N | open, save, new |
| Ctrl+T, Ctrl+Shift+T | trigger editors |
| Ctrl+F | find |
| Ctrl+A | select all on the layer |
| Ctrl+G | grid |
| Ctrl+0, Ctrl+Shift+0 | 100%, zoom to fit |
| Alt+Enter | map properties |
| Ctrl+F5 | test map |
| Ctrl+Tab, Ctrl+Shift+Tab | next / previous open map (desktop app) |
| Ctrl+Shift+A | AI assistant |

![Preferences](images/preferences.webp)

Preferences (Ctrl+,) are kept in the browser. The pages down the left:

- **General** — the editor's language (English or Korean; the default follows the
  browser's, a change applies at once, and a map's own text is untouched by it), the splash
  screen, whether to reopen the last map at startup (the desktop app does it straight
  away; a browser that has to ask before reading the file again offers it in a notice),
  how many recent files to keep, whether each map opens in its own tab, whether to ask
  before replacing a modified map (the same tick decides whether closing the tab or
  quitting the desktop app asks about unsaved changes), the tileset, size and revision a
  new map starts with, and what the Save dialog starts from: how the file was opened, or
  one of its presets, with the compression a map with no file yet gets, and whether a save
  keeps the file it replaces (a `.bak`, or a previous version in a browser); and whether
  to keep [recovery copies](#recovery-copies) of unsaved maps, and how often. The desktop
  app adds whether to check for updates at startup.
- **Editing** — the grid's spacing, colour and style, and what snaps to it (View ▸ Grid
  Settings opens this page); what the palettes start on — the owner of placed units, the
  brush size, the size of a new location; and how many undo levels each map keeps.
- **View** — whether the mouse wheel scrolls (Ctrl+wheel zooms) or zooms, and whether a
  wheel zoom keeps the tile under the pointer in place; whether water and units animate
  and how fast; which cells the status bar shows (the tile, pixel and tile id under the
  cursor, the map size, tileset, layer, zoom and revision); and whether string previews
  follow Remastered's colour rule or 1.16.1's.
- **Testing** — Test Map's folder, and in the desktop app whether the game starts after
  the map is written.
- **Plugins** — what to do when an installed plugin has a newer version (a notice, nothing,
  or install it — see [docs/plugins.md](plugins.md#keeping-a-plugin-up-to-date)),
  and a plugin's own settings when it has a page here.
- **Storage** — where the game data comes from, and a list of everything the editor keeps
  in the browser, one row per setting or cache, with a plugin's own data under its name;
  each row can be cleared on its own, or **Clear all data** throws the lot away. Maps are
  not part of that list and are not touched by it; the recovery copies have their own
  line, with a way to the Recover Maps dialog and a Discard for copies left by earlier
  sessions, and so do the previous versions of saved files. **Export** writes
  the settings and the plugins' own as one file, and **Import** takes such a file into
  another browser or machine; caches and the recent files stay behind.
- **Hotkeys** — every command and its keys. **+** on a row waits for the next keys you
  press and adds them (Esc stops waiting); the × on a key removes it, and a command can have
  several keys or none. Keys used by two commands, or by a command and a plugin, are marked:
  a plugin's keys are tried first, and between two commands the one higher in the list wins.
  Delete, Esc, the arrows, Tab, Enter, Space and F11 keep their own jobs and cannot be given
  to a command. A plain key such as `T` never fires while you type in a text box, and most
  Ctrl shortcuts leave a text box's own undo, clipboard and select-all alone. The browser
  keeps Ctrl+Tab and Ctrl+W for its tabs, so Next Map and Close Map start with no keys
  there; give them others if you want them.

Nothing is written until OK or Apply; **Reset to defaults** puts every page back. The
placement options, the panels and the recent files are remembered too.

## When something goes wrong

If the editor does something strange (or a bug happens) you can check the debug console to see
what happened, use the bug report option to copy it, or use the **Report an Issue** to send it.

### The debug console

**View ▸ Debug Console** opens a strip along the bottom of the window with the log in it:
maps opened and saved, plugins started and stopped, where the game data came from, and
every error the page threw.

![The debug console](images/debug-console.webp)

The log is kept whether the strip is open or not, so opening it *after* something odd
happened still shows what happened. The
last couple of thousand lines are kept; **Clear** empties it, for starting clean before
reproducing something.

**Warnings** and **Errors** narrow the list to what went wrong; the box beside them filters
on any text. **Verbose** adds a line for every edit and every call a plugin makes into the
editor. It answers "which plugin did that?", it is noisy by design, and it turns itself off
when you next load the editor.

### Copying a bug report

**Help ▸ Copy Bug Report** puts the log on the clipboard with a short header above it —
the version, the browser or desktop app, where the game data came from, the map's size and
tileset, and the plugins with their versions — ready to paste into an issue, a forum post
or a message. A long session is trimmed to its most recent lines so the paste fits in an
issue; when it is, the report says so.

The console's own **Copy** does the same without the trim, and **Save…** writes the whole
log to a file, for when it is too long to paste.

### Filing an issue

**Help ▸ Report an Issue…** opens a new issue on GitHub with the report already filled in,
under three questions: what you did, what you expected, and what happened. Answer those,
check the rest, and submit. You need a GitHub account.

The automatic issue contains a truncated log. If the lines that matter are not listed, use **Copy Bug Report** and paste it over the
shortened one.

Nothing is sent until you submit the issue yourself. Every report names the map *file* you
have open, the plugins you have installed and the build you are running. Nothing specific
to you is included.

## What it does not do
This section lists what is currently missing in the editor and the limits worth knowing before you rely on a feature.

### Not implemented

- **Undo for dialogs.** What a dialog writes (player settings, triggers, strings, the
  scenario's tables) is not in the undo history, as in StarEdit; Cancel is the way back.
  Resizing and changing the tileset clear the undo history.
- **Remastered graphics.** The editor draws the classic graphics from the 1.16 archives,
  not Remastered's HD art.

### Browsers and the desktop app

- In Firefox and Safari, every save is a download, and a recent map reopens through
  File ▸ Open instead of straight from disk. Chrome, Edge and the desktop app write in
  place.
- Test Map in the browser writes the map where the game lists it but cannot start the
  game. In Firefox and Safari it downloads the map.
- The Windows zip does not register `.scm`, `.scx` and `.chk`, since nothing is installed.
  A map dragged onto `scmJS.exe` still opens.
- On macOS the app sees a new version but cannot install it until the app is
  code-signed, so it offers the download page instead.

### Terrain and objects

- The isometric brush needs the map's `ISOM` section. The Repair plugin, on by default,
  rebuilds one a protected map had stripped.
- Symmetry mirrors the brushes, the fills and placing things, but not moving, deleting
  or the Blend brush.
- Changing the tileset lays the terrain again and drops the doodads; the units, sprites,
  locations, fog and triggers stay.

### Triggers and text

- In the Trigger dialogs, EUD values are raw numbers: the EPD box turns a memory address
  into the player value that reaches it, but nothing names what an address holds. For
  named reads and writes of the game (a unit's hit points, a player's minerals, the unit
  tables), use a [TrigScript](trigscript.md#programs) program, or the
  [Magenta](https://github.com/scm-js/plugin-magenta) trigger editor (Plugins ▸ Browse
  Plugins…), whose EUD conditions and actions work like the game's own. Both play on
  Remastered only.
- Transmission is the one briefing action no Blizzard map uses, so its layout could not
  be checked against one.
- TrigScript's programs play on Remastered only; `trigger()` works on every version. The
  full list is under [TrigScript's reference](trigscript.md#reference).
- A character the map's text encoding cannot hold is saved as `?`. Check Map and the
  Save dialog say so beforehand.
- The Korean translation was written with a translation, not by a native speaker. A
  review is welcome (see [docs/development.md](development.md#translations)).

### The scmjs.dev features

- The AI, keeping maps on an account and editing a map together all run on scmjs.dev
  and need a connection. The AI starts with a free trial; keeping and sharing maps need an
  account.
- On a shared map, if two people press OK in the same dialog, the second OK wins. A
  resize, a tileset change or a raw section edit starts everyone's undo history again.

### Plugins

A plugin runs with the same access as the editor itself; there is no sandbox. Install
ones from sources you trust. The plugins listed under Browse Plugins… are reviewed
before they are listed.
