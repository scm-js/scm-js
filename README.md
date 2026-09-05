# scmJS

A StarCraft and Brood War map editor that runs in a browser tab, built in homage to
StarEdit, SCMDraft 2 and StarForge.

It opens real `.scm`, `.scx` and `.chk` files, draws them with the game's own tileset
and unit graphics, and writes archives the game will play. Sections and archive
members it does not understand are copied through untouched, so a map only loses what
you deliberately change.

> **Beta.** Nothing here has shipped a campaign yet. Keep backups of maps you care
> about, and check anything important in-game before you rely on it.

## Getting started

Four ways to run it:

- **In the browser.** [editor.scmjs.dev](https://editor.scmjs.dev) is the newest numbered
  release — the same build as the installers below, so a bug report there names a version.
  It asks for StarCraft's graphics on first use and can fetch them from Blizzard in one
  click. [nightly.editor.scmjs.dev](https://nightly.editor.scmjs.dev) is `main`, rebuilt
  each night; being a separate site it asks for the graphics again and keeps its own
  settings, plugins and recent files.
- **As a desktop app.** The [releases](../../releases) page has installers for Windows,
  macOS and Linux, and a Windows zip to unpack and run without installing (the numbered
  releases are the tagged versions; `nightly` is one rolling prerelease built from `main`).
  On first start the app looks for a StarCraft installation and extracts
  what it needs; two archives dropped next to the app are found too. It checks for a newer
  version at startup and offers it in a notice — never installing on its own — and
  **Help ▸ Check for Updates…** asks whenever you like.
- **In a container.** Every numbered release publishes one, so the editor is a
  `docker run` away — nothing to build, and nothing to uninstall afterwards:

  ```sh
  docker run --rm -p 8080:80 ghcr.io/scm-js/scm-js:latest   # then http://localhost:8080
  ```

  It is nginx serving the release's own web bundle, so it behaves like the hosted editor:
  everything lives in the browser you open it from, and it asks for the graphics on first
  use. `:latest` is the newest numbered release (never a nightly); `:0.1.0`, `:0.1` and
  `:0` pin as far as you like.
- **From source**, below.

The editor draws terrain and units with graphics out of StarCraft's own archives.
Blizzard's data is not redistributable and none of it is in this repository, so the
editor looks for it in three places: files bundled with the build, a copy it kept in the
browser earlier, and — in the desktop app — a StarCraft installation on the disk. When
none of those answers it opens **Help ▸ Game Data…**, which offers two ways to fix that:

- **Download from Blizzard.** Blizzard offers the standalone StarCraft map editor as a
  free download, and it carries the two archives the graphics come from. No account, and
  nothing to find on your own disk — this is the one that works if you have never owned
  a copy of the 1.16 game.
- **Use your own files.** Pick `StarDat.mpq` and `BrooDat.mpq`, or the folder holding
  them. Brood War's `BrooDat.mpq` is required, and Remastered installations carry
  neither archive — they come from a classic (1.16) install, or from the download above.

Either way the extraction runs in the browser and the result is kept for next time.

The same dialog holds **data sets**. The game's own files are one; a mod that replaces
them in the game's own formats — its own units, graphics, sounds and names over the
same ids — can be installed beside them as another and switched to, and the editor then
draws, names and lists what that mod's data says. *Add a data set…* takes a name and a
folder holding the mod's files (loose, or as `.mpq` archives) together with `StarDat.mpq`
and `BrooDat.mpq`, which the mod's files are laid over. A unit, weapon, upgrade or
technology the mod renamed shows its new name everywhere the editor names one; the rest
keep StarEdit's. What a data set cannot be is a mod that *extends* the tables past the
game's sizes — more than 228 unit types, say — since the map format itself has no room
for those; see [docs/game-data.md](docs/game-data.md#data-sets).

```sh
npm install
npm run extract   # finds StarDat.mpq / BrooDat.mpq, writes public/
npm run dev       # http://localhost:5173
```

Node 22.18 or newer, because the extraction script relies on Node's built-in type
stripping. If the script cannot find your install, point it at one:

```sh
npm run extract -- --from "/mnt/c/Program Files (x86)/StarCraft"
```

`npm run extract` is optional: a clone without it behaves like the hosted build and
asks through Help ▸ Game Data…. Without any data the editor still runs, with flat
tileset colours for terrain and coloured markers for units. See
[docs/game-data.md](docs/game-data.md) for the full story and
[docs/development.md](docs/development.md) for the desktop and release builds.

Open a map with Ctrl+O or by dropping it on the window. Ctrl+S saves.

### A new scenario

Ctrl+N opens the New Scenario dialog. The eight tilesets are shown as their own ground
rather than as coloured squares, the terrain list under the size shows every flat terrain
the tileset paints — this is the fill the map is made of, so what you see there is what
the map will look like — and the preview draws the scenario at its real size and terrain,
so a 64×64 map reads as coarser ground than a 256×256 one. Start locations are optional
and on by default: one per player on a ring, each moved to the nearest ground it fits on,
laid down with the terrain. They are part of the map from the moment it exists, so there
is nothing to undo them from — untick *Place automatically*, or delete them on the Units
layer. Without game data the dialog falls back to flat tileset colours and says so, as
the map view itself does.

### Saving

Ctrl+S writes the map back where it came from. In Chrome, Edge and the desktop app the
editor keeps a handle to the file it opened (from the Open dialog, a drop or the Save
dialog), so Save writes in place after the browser has asked once for permission. Firefox
and Safari hand over a file's contents but no way back to it, so there every save is a
download and the notice that appears bottom-right says so; look in the downloads folder.
Save As (Ctrl+Shift+S) and Save Copy As open the Save dialog — a copy is written without
the open map changing its name or file — and a map that has no file yet goes through it on
its first Ctrl+S. When a save is done, a notice appears bottom-right with the name and size,
the status bar says the same, and the dot next to the map's name in the menubar stops glowing.

The Save dialog is where the file's shape is decided, with everything it will write listed
on the right before it is:

- **Format**: `.scx`, `.scm`, or a bare `.chk` (the scenario alone, no archive).
- **Compression**: PKWARE is what StarEdit writes and what Blizzard's own maps are stored
  as, so every StarCraft build reads it; zlib is smaller and needs 1.16.1 or Remastered;
  none is the largest and readable by anything. A map keeps the compression it was opened
  with by default; a new map gets StarEdit's. StarEdit's encryption is a tick beside it.
- **Other files in the archive**: the sounds and the files plugins keep there (the Trigger
  Script plugin's source, say), each with a tick, so a copy for release can leave them out.
- **Sections**: the game reads none of ISOM, TILE, DD2 (the terrain-editing data), IVER,
  IVE2, IOWN, UPUS, SWNM or WAV (editor bookkeeping); each group can be left out, as can
  sections the format reference does not know, and repeated sections can be merged into
  the one the game would act on. The dialog says what each costs an editor later (no
  isometric brush without ISOM, for instance); the map in the editor is not changed.
  *Everything* and *Smallest that plays* set the ticks in one go.
- **Check Map** runs alongside, with its counts and a button to the full list.

The options confirmed in the dialog are what Ctrl+S reuses for that map from then on.

## What works, and what does not

### Map files

| | Status |
| --- | --- |
| Open and save `.scm`, `.scx`, `.chk` | Yes. Save writes in place where the browser allows it (Chrome, Edge, the desktop app) and downloads elsewhere; the Save dialog chooses compression (PKWARE as StarEdit, zlib, none), encryption, which archive files ride along and which editor-only sections are left out, and shows what it will write first. |
| Preserve unmodelled sections, repeated sections and custom archive files | Yes |
| New map, with the full section set StarEdit writes | Yes |
| Resize and crop, with a 3×3 anchor | Yes |
| Switch revision: StarCraft 1.00, Hybrid, Brood War, Remastered | Yes |
| Change a map's tileset | Yes, in Map Properties: ERA changes and the terrain is laid again with the new tileset's terrain (tile numbers mean something else in every tileset; the doodads go with them, everything else stays), or keep the tile numbers as SCMDraft does. Clears the undo history. |
| Open Recent | Yes. In Chrome, Edge and the desktop app a recent map reopens from disk (the file handle is kept in the browser; it asks once before reading). Firefox and Safari keep the names and reopen through File ▸ Open. |
| Open a map from the file manager | Yes, in the desktop app. The installers (Windows setup, `.deb`, AppImage, macOS) register `.scm`, `.scx` and `.chk`, so a double-click, "Open with", a drag onto the app's icon or a path on the command line opens the map — in the running window when one is already up. The Windows zip registers nothing (nothing is installed), but a map dragged onto `scmJS.exe` still opens. Dropping a map anywhere on the window works in every build, and in the browser. |
| In-app updates | Yes, in the desktop app. It checks GitHub at startup (a preference, on by default) and offers what it finds in a notice; Help ▸ Check for Updates… asks on demand. Nothing downloads or installs without being asked. Windows, the Linux AppImage and the `.deb` apply the update themselves; macOS can see one but not install it until the app is code-signed, so it offers the download page instead. |
| More than one map open at once | No. One map per tab or window; open the editor twice. |

### Terrain

| | Status |
| --- | --- |
| Isometric brush | Yes. Needs the map's `ISOM` section; the Repair plugin (on by default) rebuilds a stripped one. |
| Rect, Tile and Blend brushes | Yes |
| Flood fill, fill map, pick tile | Yes |
| Elevation and buildability overlays | Yes |
| Water and lava animation | Yes |
| Symmetry | Yes. The Isometric, Rect and Tile brushes, the fills, the Fog brush, and placing units, sprites, doodads and locations all land on the images of the spot too (mirror, both axes, 180°, 90° and the diagonals on a square map). Moving and deleting are not mirrored, and neither is Blend. |
| Replace Terrain | Yes. One terrain type (or one exact tile) becomes another, over the whole map or the marked area, laid as the Rect brush lays it; one undo step. |
| Elevation and buildability overlays | Yes: ground height per minitile, unbuildable tiles hatched. |
| Terrain from Image | Yes, as a plugin installed by default (File ▸ Import, or right-click the terrain palette / map: *into Area…* lets you drag the target first). File, paste, drop or URL; colour adjustments; key colours per terrain with an eyedropper; despeckle and island removal. |

### Objects

| | Status |
| --- | --- |
| Doodads: catalogue, placement rules, overlays, move, delete | Yes |
| Units: placement checks, properties, team colours, idle animation | Yes |
| Sprites: pure and unit sprites, flags, properties | Yes |
| Locations: create, resize, snap, rename, elevation flags | Yes |
| Fog of war, per player | Yes |
| Cut, copy and paste, including between maps | Yes |
| Paint: lines, rectangles, ellipses, polygons, stars, freehand, spray, text and an eraser, out of units, sprites, doodads, terrain or fog | Yes, as a plugin (on by default): Tools ▸ Paint…. Outlined or filled, spaced, jittered, per-player; one undo step each. |
| Find a map and open it | Yes, as a plugin (scmscx.com, on by default): File ▸ Find on scmscx.com… searches the map archive by name, tileset, players and size, shows minimaps, and opens the map you pick. |
| Auto-place Start Locations | Yes. Tools ▸ Auto-place Start Locations puts one per player on a ring or in the corners, each moved to the nearest ground the placement checks accept, as one undo step. The Melee Wizard plugin (install it from Plugins ▸ Browse Plugins…, then Tools ▸ Melee Wizard…) does the elaborate version: click where Player 1 starts and the others land on its images under the symmetry you chose, with bases. |
| Lock a layer | Yes, in the Layers panel: a locked layer's tools stop changing the map. |
| Lay out a base's resources: the mineral line on the three-tile ring, the geyser past its end, for every player at once | Yes, as a plugin (Melee Wizard). Press on the hall spot and drag towards the minerals; presets for main, natural and third; amounts, end-patch amounts, mineral types; spots the map refuses are shown in red and left out. Also bases at every start location in one go, a blocking patch tool, mirroring the selected units, a symmetry check and a resource summary. |
| See what a unit can walk: islands, unreachable pockets, the areas a map divides into and the chokes between them with widths, cliff seams with no ramp, ground distances between start locations | Yes, as a plugin (Walkability, installed by default: View ▸ Walkability or Ctrl+Shift+W). Read from the VF4 minitile flags with buildings and resources as walls, drawn over the map as an overlay that stays on while you place units and follows every edit; hover reads the ground under the pointer; Tools ▸ Walkability… is the settings and the lists. |

### Triggers

| | Status |
| --- | --- |
| Classic editor: every condition and action, per-item disable | Yes |
| Text editor in SCMDraft's TrigEdit syntax | Yes |
| Script editor: a TypeScript subset that generates triggers | Yes, as a plugin (Trigger Script: install it from Plugins ▸ Browse Plugins…, then Triggers ▸ Script Editor…). |
| Import and export `.trg` and text triggers | Yes |
| Validate triggers | Yes |
| Mission briefings | Yes: the classic editor, the text editor's Briefing mode, Find and Statistics. The field layout is checked against the briefings on Blizzard's own maps (Ground Zero, Spring Thaw), which put the portrait slot where the community reference does not. Transmission is the one action no Blizzard map uses. |
| Create Unit with Properties (CUWP) | Yes. Triggers ▸ Unit Properties Slots… edits the 64 slots (vitals, resources, hangar, the special states), the action picks a slot by what it sets, and Check Map flags a slot that sets nothing. |
| EUD triggers | Yes, as far as an editor without an address database goes: any raw player and unit value is accepted, the player pick has an EPD box that turns a memory address into the player value a Deaths condition or Set Deaths action needs (and shows the address a raw value reaches), Check Map points out the raw values, and the script's raw level has `Memory` / `SetMemory`. |

### Scenario data

| | Status |
| --- | --- |
| Map properties, players, forces, colours (including Remastered RGB) | Yes |
| Unit, upgrade and technology settings, with per-player availability | Yes |
| String editor with a usage list, and unused-string cleanup | Yes |
| Switch names | Yes |
| Sound editor | Import converts MP3, FLAC, AAC, Ogg and any WAV to PCM WAV at a chosen rate; play, remove, adopt archive files and re-encode a listed `.wav` all work. The editor reads every WAV encoding the game and the usual tools produce itself (8 to 32-bit PCM, float, A-law, µ-law, IMA and Microsoft ADPCM), so the game's own sounds play and convert; MP3, Ogg and FLAC go through the browser's decoders. |

### Tools

| | Status |
| --- | --- |
| Check Map | Yes |
| Find (units, locations, sprites, strings, triggers) | Yes |
| Statistics | Yes |
| Export the map as a PNG, from full art down to a minimap | Yes |
| Import and export strings | Yes |
| Plugins (Plugins ▸ Browse Plugins… / Manage Plugins…) | Yes. Search the project's published plugins and install one, or load a `plugin.ts` from any public repository or URL; it can add menu items, context-menu entries, hotkeys, dialogs, floating panels and map tools of its own, and edit the map through undo. See [docs/plugins.md](docs/plugins.md). |
| Look at and edit the file itself: every CHK section, its bytes, what each byte means | Yes, as a plugin (Section Explorer: tick it in Plugins ▸ Manage Plugins…, then Tools ▸ Section Explorer…). A hex editor with the sections listed, fields coloured and named, values edited as numbers, choices, flags or text; sections added, removed, renamed and reordered. |
| Repair a protected or damaged map: missing, repeated, mis-sized or hidden sections, a stripped ISOM | Yes, as a plugin (Repair, on by default: it checks every map as it opens, and Tools ▸ Repair Map… runs it by hand) |
| Test Map | Yes (Ctrl+F5). Neither StarCraft build opens a map from the outside, so Test Map writes the map into a `scmJS` folder under the game's Maps folder, where Single Player ▸ Custom Game lists it, and the desktop app starts the game as well. In Chrome and Edge the map goes into a folder you pick once (the game's Maps folder); other browsers download it. |
| Generate a map from a description, write triggers from one, explain triggers, name and describe the map, write a briefing, get a critique, translate the strings, or ask an assistant to make changes | Yes, as a plugin (AI: install it from Plugins ▸ Browse Plugins…, then Tools ▸ AI). It needs a server that holds an Anthropic key — [scm-js/ai-server](https://github.com/scm-js/ai-server) is one to deploy — or your own key typed into its settings. Every change it makes is one undo step. |

## Working in the editor

Layers along the left rail: Terrain, Doodads, Units, Sprites, Locations, Fog of War
and Cut/Copy/Paste, on the keys `T D U S L F C`. Each has its own palette and its own
selection. Undo is Ctrl+Z, 200 steps deep, shared across every layer, so a terrain
stroke and the units it stranded come back together.

### Terrain

Four brush modes:

| Mode | Paints |
| --- | --- |
| Isometric | StarEdit's diamond brush. Sets the diamond under the cursor to a terrain and lays the cliffs and edges around it. |
| Rect | Flat ground of one terrain type, in left/right tile pairs with StarEdit's random variation mix. |
| Tile | Any single megatile: cliff pieces, doodad tiles, anything in the CV5. |
| Blend | One tile next to a tile you picked, chosen from those whose facing edge continues it. |

Drag to paint, `[` and `]` resize the brush from 1×1 to 7×7, Alt+click picks the tile
under the cursor, and right-click offers Pick and Fill Area. The status bar shows the
tile id and the Properties panel breaks it into group, slot, elevation, walkability
and buildability. View ▸ Elevation Overlay tints the ground by height, minitile by
minitile, and Buildability Overlay hatches what a building cannot stand on.

Tools ▸ Replace Terrain turns every tile of one terrain type (or one exact tile) into
another, over the whole map or the area marked on the Cut / Copy / Paste layer, laid the
way the Rect brush lays it; Fill Terrain lays the whole map anew.

Tools ▸ Symmetry mirrors what you do across the map's axes or about its centre — every
brush, the fills, and placing units, sprites, doodads and locations, each as one undo
step. The ghost shows where the images will land, and a doodad that would have to turn
is skipped. Blend, moving and deleting are not mirrored.

The isometric brush ripples outward as it paints: a neighbour that cannot legally
border the new terrain becomes the intermediate one, and cliff faces stack as tall as
the tileset draws them. A single click of high ground gives a small mesa; a wider
brush gives flat high ground inside a cliff ring.

It needs the `ISOM` section, which is the editor's own record rather than anything the
game reads, and which protected maps often strip. Where a map has none, the tab says
so and the Repair plugin (Tools ▸ Repair Map…) reconstructs it: exact for ground that was laid down
isometrically, a best guess under doodads and hand-placed tiles. The tab also warns
when Rect or Tile edits have left the lattice out of step with the terrain.

Blend exists for joins the cliff sets never had: dirt into a doodad's base, one edge
set into another, a hand-laid shoreline. Click a tile to make it the anchor, and the
palette lists for each side the tiles whose opposite edge continues its pixels, best
seam first, with the mean colour difference under each thumbnail. Nothing in the game
data describes these matches; they are measured off the graphics, so the tileset has
to be extracted.

Rect, Tile, Blend and Replace Terrain leave `ISOM` alone, which is what SCMDraft does in
its non-isometric modes.

The Layers panel locks a layer with the padlock: its tools stop changing the map until
you unlock it, while selecting and looking still work.

### Doodads

The palette is built from the current tileset's own groups, with StarEdit's categories
and placement rules. Picking a doodad arms placement, and the ghost turns red where
the footprint leaves the map, covers another doodad or sits on the wrong terrain.
Place Anywhere drops that rule; Snap to Grid keeps the footprint's left column on an
even tile — StarEdit's two-tile isometric grid, always two tiles whatever View ▸ Grid
Settings shows. It snaps a move as well as a placement, and it snaps where the doodad
lands rather than how far it went, so a doodad sitting on an odd column is brought onto
the grid by dragging it.

Doodads have no names in the game data, so the search box matches what the data does
say: the category (`bridge`, `temple`, `coastal`), the id (`#12`), the footprint
(`6×6`), the sprite or unit an overlay draws (`hdrock`, `Xel'Naga Temple`), and the
word `ramp` for anything whose tiles carry the ramp bit, which StarEdit files under
cliffs and walls without saying so.

A placed doodad stays coherent across all three places a map keeps it: its tiles, its
record and any canopy or door overlay. Removing one restores the ground underneath.

### Units

Picking a unit type arms placement, and each click on empty ground places one. Esc or
right-click stops placing and drops you into select mode.

**Snap to Grid** puts buildings, resources, start locations and beacons on the tile grid
by their placement box, the way StarEdit stores them, and every other unit on the nearest
tile centre. Turn it off for pixel placement, SCMDraft-style — then everything lands
exactly where the pointer is. It applies to a move as well as a placement, so dragging a
unit that sits off the grid brings it back onto it. Sprites are always placed by the
pixel; the Doodads and Locations layers have snaps of their own (View ▸ Grid Settings
gathers all three).

Placement checks are on by default and refuse a spot with a red ghost and a reason in
the status bar. They are the same rules the game applies when it loads a map and
silently drops units that do not fit: no overlapping collision boxes for ground units
and buildings, buildable tiles under a building's whole placement box, walkable
minitiles under a ground unit's collision box. The unit in the way gets outlined.

The matching Remove Stranded Units toggle on the Terrain palette deletes units that
your terrain edit just made illegal, as part of the same undo step.

Tools ▸ Auto-place Start Locations puts one start location per player on a ring or in
the corners, each moved to the nearest ground the placement checks accept, and selects
them so you can drag them where you want; the Melee Wizard plugin lays out symmetric
starts and bases from a point you pick.

Double-click a unit for every field its record holds: hit points, shields, energy,
resources and hangar with their "used" bits, the five special properties, the
related-unit link with its Nydus and add-on flags. With several units selected, only
the fields you touch are written to all of them. New units are written the way
StarEdit writes them, with masks describing only what applies to the type.

### Sprites

Two kinds. Pure sprites are a graphic drawn where it stands with no unit behind it:
tree canopies, markers, glows. Unit sprites are records the game turns into a unit
when the map loads, which is how StarEdit does Installation doors and traps.

The palette has a tab for each. Pure Sprites lists all 517 entries grouped as Units,
Effects and Doodads, the last named after the graphics file since the game ships no
sprite name table. Placement is free: click anywhere, no rules to refuse a spot.

Doodad overlays are ordinary sprite records and can be selected here too. The
properties panel says which doodad one belongs to and warns that moving it alone
leaves the doodad's tiles behind.

### Locations

The rectangles triggers refer to. Locations live in a fixed table of slots, 64 in
original maps and 255 in Brood War, so nothing is ever inserted or removed: a new
location takes the lowest free slot, deleting one blanks it, and a selection survives
every edit.

Drag on empty ground to create one, drag the eight handles to resize, arrow keys to
nudge. Snap is off, 8, 16, one tile or 64 px, and a move snaps the box's corner rather
than the pointer, so a box picked up off-grid lands on it. The palette lists every
slot in use, and Scenario ▸ Locations is the same list as a sortable table.

Each location can exclude elevations, which is how you keep a trigger from firing on
the cliff above it. The editor shows them as ticks the way StarEdit does, though the
file stores the bits inverted. An amber stripe on a location's tab marks one that
excludes something.

The last slot is Anywhere, the location every trigger can pick, and the game and other
editors depend on it being exactly the map. It is pinned at the top of the list with a
lock, never drawn, never picked by a click, and cannot be moved, renamed or deleted.
If a map's Anywhere has gone missing or drifted off the map bounds, the editor offers
to put it back.

A box stored inverted, with right below left, is a known trick and survives: it draws
and hit-tests as its normalised rectangle and moves without losing the inversion.

### Fog of war

Which tiles a player starts the game unable to see. Every player has their own, and a
map that carries no fog data at all starts fully fogged, which is how the editor reads
it until the first stroke.

Select any of the eight players and every stroke and fill edits all of them at once;
View picks whose fog the viewport and minimap draw. Fog and Clear are the brush modes,
Shift-drag paints the opposite, and Alt+click picks up which players have fog on a
tile. Fog All, Clear All, Invert and Copy Fog act on the whole map for the selected
players.

Fogged tiles darken over everything, units and locations included, the way the game's
fog does. The tint is the game's own: the ratio of `dark.pcx` row 18 for the tileset,
about half the light and a touch bluer, with the corner between two explored edges cut
at 45° so a diagonal boundary reads as a line rather than a staircase.

### Cut, copy and paste

Drag on the map with the C layer active to mark a rectangle, then Ctrl+C or Ctrl+X. On
the object layers the same keys act on the selection instead, and the clip is the
selection's bounding box carrying just those objects, so a base can be copied from
either side.

Include says both what a copy takes and what a paste lays down: terrain, doodads,
units, sprites, locations, fog. Terrain carries both the picture and the ground under
the doodads, so a paste without doodads shows plain ground rather than half a tree.
Doodads are re-stamped with their overlays, units get fresh serials with add-on and
Nydus links kept when both ends came along, and locations take free slots, which is
the one thing a paste can run out of.

Ctrl+V arms the pointer with a ghost of the clip. A click stamps it and stays armed
for the next. Merge adds to what is there; Replace clears the units, sprites and
doodads under the clip first, though never locations. Terrain from a different tileset
is refused, since tile ids mean nothing there, while the objects still paste. The clip
survives File ▸ Open, which is how a base moves between maps.

### Triggers

Three editors over the trigger list, and a fourth for mission briefings.

The **Trigger Editor** (Ctrl+T) is the StarEdit form: a player filter, the trigger
list, and per trigger its players, up to 16 conditions and up to 64 actions. Every
condition and action the game has is there, each argument gets a widget of its kind,
and any value the tables do not list stays selectable as a raw number, which is how
EUD players and odd unit ids get in. Items can be disabled individually as in
SCMDraft.

The **Text Trigger Editor** (Ctrl+Shift+T) is SCMDraft 2's TrigEdit syntax, so its
text pastes in and back out. A leading `;` disables a line, and a `Flags:` block
carries the trigger flags SCMDraft has no syntax for.

The **Script Editor** is a plugin, Trigger Script
([scm-js/plugin-trigger-script](https://github.com/scm-js/plugin-trigger-script)): a
TypeScript file per map that generates triggers, at two levels — one `trigger()` call
per trigger, and structured code with variables, `if`, loops and functions, which
compiles down to a state machine built out of death counters, with no EUD anywhere in
it, so what comes out runs on any version of the game. A built-in simulator runs thirty
cycles of the result and tells you what happened. It is in the plugin list from the
start but off; tick it and Triggers ▸ Script Editor… appears. The language is described
in that repository's README.

Triggers a plugin generates show up in the classic editor with a badge and are locked
there, with a button to the plugin's own editor; the text editor fences them in
comments; hand-made triggers around them are left alone.

Mission briefings get their own editor over the same record layout with the briefing
action set, and the Text Trigger Editor has a Briefing mode in the same syntax. The
layout is checked against the briefings on Blizzard's own multiplayer maps.

Triggers ▸ Unit Properties Slots is the table behind *Create Unit with Properties*: 64
slots, each the hit points, shields and energy (as percentages), resources, hangar count
and special states a trigger applies to the units it creates. The action's argument
lists the slots by what they set and opens the editor on one.

For EUD work, the player pick next to a Deaths condition or Set Deaths action has an
EPD box: type a memory address and it becomes the player value that reaches it through
the deaths table, and a raw value shows which address it reaches.

All of these are OK / Apply / Cancel transactions and sit outside undo, as in
StarEdit.

### Scenario settings

The Scenario menu holds the map's own tables, each its own transaction and none of
them in the undo history.

Map Properties, Map Revision, Player Settings, Force Settings and Player Colors cover
the header data. Map Properties can change the tileset: tile numbers mean something
else in every tileset, so the terrain is laid again with a terrain you pick and the
doodads go with it, while units, sprites, locations, fog and triggers stay; or keep the
tile numbers, as SCMDraft does, to see what they draw. It clears the undo history like
a resize. Player Colors includes Remastered's per-slot RGB, where a slot can be
a palette colour, random, the player's choice, or a custom colour, and the section
only exists while some slot needs it.

Unit Settings, Upgrade Settings and Technology Settings edit the cost and availability
tables. A row on "use default" shows the greyed-out numbers from the game's own data
files and seeds itself from them when you untick it. Which layout gets written follows
the map's revision, so a hybrid map keeps both and an original-game map keeps only its
own.

The String Editor lists every string with where it is used, and edits keep their
index, so triggers and locations keep pointing where they did. Control bytes show and
type as `<XX>`, a row of buttons inserts the game's colour codes — each drawn in the
colour it produces — and a preview under the box shows the string the way the game
draws it: colours applied, `<12>` / `<13>` alignment honoured, and the text an `<0B>`
hides struck through rather than dropped. The list beside it draws each string the same
way, on one line.

**Every field whose text the game draws takes the codes**, not just that one: the map
name and description, force names, custom unit names, and the text argument of a trigger
or briefing action. Those fields show the string the way the game draws it until you
click into them, and the escaped `<XX>` source while you type — so a colour costs no
extra chrome in a list of four force names. The palette button at the right-hand end of
each opens the same bar of codes, and inserts at the caret. Strings the game never draws
— location names, switch names, trigger comments — take no codes, since a colour in one
would only mean something to the editor.

The previews follow **Remastered's** rule, where a colour set on one line carries onto
the next. StarCraft 1.16.1 reset the colour at every line break, so a string written
before the remaster can draw in colours its author never chose; the *1.16.1 colours*
tick in the String Editor (and Preferences ▸ Display) switches every preview to the old
rendering, and the Repair plugin offers to write the reset the old game used to supply.
(Text *stacking* — overlapping lines drawn on top of each other — is a separate 1.16.1
trick, and Remastered does not render it at all.)

The Sound Editor joins the map's sound table with the `.wav` files in the archive:
import, play, remove, and adopt files the archive carries but the table does not list.
Import takes any file the browser can decode (MP3, FLAC, AAC, Ogg, WAV in any encoding)
and writes it as PCM WAV in the format picked next to the button; the default, 22050 Hz
16-bit mono, is what the game's own sounds are, and the other presets are the rates its
mixer takes, down to 11025 Hz 8-bit for maps chasing the size limit. A PCM WAV already in
that format is stored byte for byte, and "keep as they are" stores PCM WAVs and Oggs
unchanged (an Ogg plays in Remastered only, and Check Map says so on an older revision).
The Format column reads each file's header, the Length column comes off it, and Convert
re-encodes a listed `.wav` in place. WAVs are decoded by the editor itself in every
encoding the game and the usual tools produce — 8 to 32-bit PCM, float, A-law, µ-law,
IMA and Microsoft ADPCM — so a sound lifted from the game's archives plays and converts;
MP3, Ogg and FLAC go through the browser's decoders and an offline render resamples.

### Checking and exporting

Tools ▸ Check Map looks for the sections a file of its revision needs, what the parser
noticed on the way in, player types where StarEdit's copy disagrees with the game's,
start locations that do not match the player table, the unit limit, off-map units, a
missing or moved Anywhere, duplicate location names, string capacity, triggers pointing
at unused locations or strings past the end of the table, unit and player values the
game does not have, AI scripts it does not ship, condition and action types the editor
does not know, properties slots that set nothing, Play WAV actions with no file in the
archive, Oggs on a map older than Remastered, switches tested but never set, disabled
triggers, and ISOM health. Double-click an issue to go to it.

Tools ▸ Test Map (Ctrl+F5) hands the map to the game. Neither StarCraft build opens a
map from the outside, so the editor writes it into a `scmJS` folder under the game's
Maps folder, where Single Player ▸ Custom Game lists it; the desktop app finds the
installation (or takes a folder you pick) and starts the game as well, while a browser
writes into a folder you pick once — Chrome and Edge — or downloads the file.

File ▸ Export ▸ Image renders the whole map to a PNG, with one dial that decides what
the picture is:

| Scale | A 128×128 map | Draws |
| --- | --- | --- |
| 32 px/tile | 4096×4096 | Full game art: tileset graphics, unit and sprite sheets |
| 16, 8 | 2048, 1024 | The same, smaller |
| 4, 2 | 512, 256 | Mean tile colours, units as minimap dots |
| 1 | 128×128 | The game's minimap |

Those breaks are the viewport's own far-zoom thresholds, so an export looks like the
map does on screen at that zoom. Units, locations, fog and the grid are each a tick,
and the ones a given scale cannot draw grey out.

### Plugins

Plugins ▸ Browse Plugins… searches the plugins this project publishes and installs the
one you pick. The list comes from a file the project keeps
([scm-js/registry](https://github.com/scm-js/registry)); being on it means the editor
offers the plugin, not that it has been vetted — installing one still shows you where the
code comes from first, and there is no sandbox. Under **Sources** you can add someone
else's list, and every registry says when it was last read.

Most of what is listed is already in the editor, so the list is split: what you do not
have yet comes first, then what you do, and the buttons above the list (All, Not
installed, Installed) show how many of each there are. Every row says where it stands —
**Install** for one you do not have, **Turn on** for one that is installed but switched
off, and **Manage** to see it under Installed.

Plugins ▸ Manage Plugins… lists what is installed. Paste a link and press Add. Any
address the browser can read will do: a github.com repository (or a folder inside one,
`https://github.com/owner/repo/tree/v1.2/plugins/my-plugin`), the short form
`github:owner/repo@v1.2`, a link straight to a `plugin.json` on another host
(`https://gitlab.com/owner/repo/-/raw/main/plugin.json`), a `.ts`/`.js` entry file, a
folder holding `plugin.json`, or `http://localhost:3000/` while you write one. A plugin
is one TypeScript file with an `activate(api)` export.

Add does not install anything straight away. It reads the plugin's `plugin.json`, and
for a plugin on GitHub it also asks which commit the address points at. Neither request
fetches or runs any of the plugin's code. What comes back is shown on an **Add Plugin**
screen: the name, version, author and description from the manifest, links to the
repository and homepage, and the addresses the manifest and the code will be fetched
from. The same screen says what you are agreeing to. There is no sandbox, so a plugin has
the same access as the editor itself: it can change the map you have open and anything
you save afterwards, add menu items and hotkeys, store data in your browser, and make
network requests. Only add plugins you trust. Cancel leaves nothing behind.

Three ticks on that screen decide how it is installed:

- **Enable it now** runs the plugin once it is added. Untick it to add the plugin to the
  list and start it later.
- **Pin to this version** is on by default for a plugin on GitHub. It stores the exact
  commit (`github:owner/repo@0123456…`) rather than a branch, so the editor loads the
  same code every time and a new push by the author does not reach you. The **Update**
  button on a pinned row looks for a newer commit and shows it on the same screen before
  anything changes. Plugins from other addresses cannot be pinned, since there is no
  version to name.
- **Load from a copy saved here** is off by default. With it on, the files from the first
  load are saved in your browser and run from then on, and the plugin's address is not
  contacted again until you press Reload. Use it if you would rather nothing was fetched
  at startup.

Both settings can be changed later from the list: every row carries a **Load from a copy
saved here** tick under its buttons, with the size of the copy beside it, and a pinned row
is badged *pinned* and carries the Update button.
An address with no plugin behind it (a wrong link, or a dev server that is not up) is
reported under the Add field and nothing is added, so the Add Plugin screen only ever
opens with a manifest to show. The tick at the left of a row turns a plugin off without
removing it; Reload fetches one again from its address and replaces any stored copy.
[docs/plugins.md](docs/plugins.md) has the API.

Plugins marked *default* are the ones the editor lists from the start. They are ordinary
plugins from their own repositories, each **pinned to the version this release was tested
with** — the badge on the row says *pinned* — so a new push by an author does not change
the editor under you, and every copy of a given version runs the same code. Moving one
forward is part of the next release. They can be switched on and off but not removed from
the list. scmscx.com, Repair, Walkability, Terrain from Image and Paint are the defaults,
and all five start on. Melee Wizard, Trigger Script and Section Explorer are not in that
list: install them from Plugins ▸ Browse Plugins… like any other.

All five are **built into the editor** — the same pinned versions, taken from the same
repositories when the editor was built — so they need no connection to start and nothing
is fetched from anywhere else when you open the page. That is what makes the desktop app
work offline and the container image work on a network that cannot reach GitHub. Plugins
you add yourself are fetched from their addresses as before, and if one does not load, a
notice says so rather than leaving you to find a menu item missing.

Each lives in its own repository and is versioned separately from the editor, so its own
README is where its features are documented. One line each, the five defaults first:

| Plugin | Where | What it does |
| --- | --- | --- |
| [scmscx.com](https://github.com/scm-js/plugin-scm-scx) | File ▸ Find on scmscx.com… | Searches the map archive at [scmscx.com](https://scmscx.com) and opens the map you pick. The site sends no CORS header, so the search cannot connect from an editor served anywhere else today; the dialog says so and links to the site. |
| [Repair](https://github.com/scm-js/plugin-repair) | on open, Tools ▸ Repair Map… | Reads a map the way the game does and lists what is missing, damaged, repeated or the wrong size, each with the repair and what the game does without it. Also where Rebuild ISOM from Tiles lives. |
| [Walkability](https://github.com/scm-js/plugin-walkability) | View ▸ Walkability (Ctrl+Shift+W) | Draws the ground as a unit walks it: islands, the areas the map divides into and the chokes between them, height seams with no ramp, and the distances between start locations. Reads only. |
| [Terrain from Image](https://github.com/scm-js/plugin-image-to-terrain) | File ▸ Import ▸ Terrain from Image… | Turns a picture into terrain, over the whole map or a rectangle you drag — painted with the isometric brush, so cliffs and shorelines are generated at every boundary. |
| [Paint](https://github.com/scm-js/plugin-paint) | Tools ▸ Paint… (Ctrl+Shift+P) | Freehand, lines, shapes, spray and text, laying down whatever the active layer's palette has picked — so it paints units, doodads, sprites, terrain or fog depending on the layer. |
| [Melee Wizard](https://github.com/scm-js/plugin-melee-wizard) | Tools ▸ Melee Wizard… (Ctrl+Shift+M) | The parts of a ladder-style map that are geometry: symmetric start locations, and mineral lines and geysers laid out at the distance the game mines fastest from. |
| [Trigger Script](https://github.com/scm-js/plugin-trigger-script) | Triggers ▸ Script Editor… | A TypeScript file kept inside the map, checked against the map's own names and compiled into a block of the trigger list — including `if`, loops and variables, lowered to a death-counter state machine. |
| [Section Explorer](https://github.com/scm-js/plugin-section-explorer) | Tools ▸ Section Explorer… (Ctrl+Shift+H) | The map file as the game reads it: every section in file order, an annotated hex editor over the bytes, and what the byte under the cursor means. |
| [AI](https://github.com/scm-js/plugin-ai) | Tools ▸ AI | Generates and reviews maps, writes triggers and briefings, rewrites strings, and an assistant panel that edits the map from a description. Needs a server to talk to, or your own Anthropic key. |

## Keyboard

F1 lists the lot. The ones worth knowing up front:

| Keys | |
| --- | --- |
| `T` `D` `U` `S` `L` `F` `C` | switch layer |
| `[` `]` | brush size |
| Alt+click | pick what is under the cursor |
| Ctrl+Z / Ctrl+Y | undo / redo |
| Del / Esc | delete selection / stop placing |
| Ctrl+T, Ctrl+Shift+T | trigger editors |
| Ctrl+F | find |
| Ctrl+A | select all on the layer |
| Ctrl+G | grid |
| Ctrl+Shift+0 | zoom to fit |
| Ctrl+F5 | test map |

Preferences (Ctrl+,) persist in the browser: the splash screen, whether to confirm
before replacing a modified map — the same tick decides whether closing the tab or
quitting the desktop app asks about unsaved changes — defaults for new maps, whether
water and units animate at startup and how fast each runs (0.25× to 4× the game's own
speed), Test Map's folder and launch tick, and — in the desktop app — whether to check
for updates at startup and whether to follow the nightly builds. The grid,
the location snap, the Units and Doodads palettes' placement options, which panels are
shown and how wide they are, and the recent files are remembered too. Its Browser storage
box (Application storage in the desktop app) lists everything the editor keeps, one row per
setting or cache, with a plugin's own data under its name: open a row to see exactly what is
stored, clear that one row, or **Clear all data** to throw the lot away — the file handles
behind Open Recent and Test Map included. Whatever goes is back on its default at once
rather than at the next reload, the default plugins included. The map you have open is
never kept there and is not touched by any of it.

## Documentation

All of it is also a site — [docs.scmjs.dev](https://docs.scmjs.dev) — with these documents
as pages, a search box, and a reference for every call in the plugin API generated from
the editor's own declarations. It is built from the tag the hosted editor runs, so the
version in its footer is the one at [editor.scmjs.dev](https://editor.scmjs.dev). These
files stay the source; the site renders them.

| Document | Covers |
| --- | --- |
| [docs/game-data.md](docs/game-data.md) | Extracting Blizzard data, and how the graphics get drawn |
| [docs/file-formats.md](docs/file-formats.md) | CHK and MPQ handling, which sections are modelled |
| [docs/plugins.md](docs/plugins.md) | Writing and installing plugins; the plugin API |
| [docs/development.md](docs/development.md) | Building, testing, repository layout |
| [ATTRIBUTION.md](ATTRIBUTION.md) | Provenance of adapted algorithms, tables and dependencies |

## License

The original scm-js source is MIT-licensed; see [LICENSE](LICENSE). That license does
not cover upstream code, packages, research, names or game data.
[ATTRIBUTION.md](ATTRIBUTION.md) records where each of those came from, and
source-level credit sits beside the code it applies to.

StarCraft and Brood War are trademarks of Blizzard Entertainment. This is a fan
project, not affiliated with or endorsed by Blizzard Entertainment.
