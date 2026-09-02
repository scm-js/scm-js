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

The editor needs graphics out of your own StarCraft installation. Blizzard's data is
not redistributable and none of it is in this repository, so the first run extracts it
from archives you already own. Brood War's `BrooDat.mpq` is required.

```sh
npm install
npm run extract   # finds StarDat.mpq / BrooDat.mpq, writes public/
npm run dev       # http://localhost:5173
```

Node 22.18 or newer, because the extraction script relies on Node's built-in type
stripping.

Extraction takes a few seconds and only has to happen once per patch. If it cannot
find your install, point it at one:

```sh
npm run extract -- --from "/mnt/c/Program Files (x86)/StarCraft"
```

Without the data the editor still runs: terrain falls back to flat tileset colours and
units to coloured markers, with a note in the palette saying so. See
[docs/game-data.md](docs/game-data.md) for the full story.

Open a map with Ctrl+O or by dropping it on the window. Ctrl+S saves.

## What works, and what does not

### Map files

| | Status |
| --- | --- |
| Open and save `.scm`, `.scx`, `.chk` | Yes |
| Preserve unmodelled sections, repeated sections and custom archive files | Yes |
| New map, with the full section set StarEdit writes | Yes |
| Resize and crop, with a 3×3 anchor | Yes |
| Switch revision: StarCraft 1.00, Hybrid, Brood War, Remastered | Yes |
| Change a map's tileset | Not yet |
| Open Recent | Names only. A browser hands over file contents rather than a handle, so a listed map has to be reopened from disk. |
| More than one map open at once | Not yet |

### Terrain

| | Status |
| --- | --- |
| Isometric brush | Yes. Needs the map's `ISOM` section; Rebuild ISOM from Tiles recovers a stripped one. |
| Rect, Tile and Blend brushes | Yes |
| Flood fill, fill map, pick tile | Yes |
| Elevation and buildability overlays | Yes |
| Water and lava animation | Yes |
| Symmetry | Partial. Rect, Tile and Fog strokes mirror; objects, the isometric brush and Blend do not. |
| Replace Terrain | Not yet |
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
| Paint: lines, rectangles, ellipses, polygons, stars, freehand, spray, text and an eraser, out of units, sprites, doodads, terrain or fog | Yes, as a plugin (tick it in Plugins ▸ Manage Plugins…, then Tools ▸ Paint…). Outlined or filled, spaced, jittered, per-player; one undo step each. |
| Find a map by what it is (RPG, zone control, cat and mouse, …) and open it; publish a map with revisions | Yes, as a plugin (scm-server: tick it in Plugins ▸ Manage Plugins… and set the server address in its settings). File ▸ Find Map…, File ▸ Export ▸ Publish to scm-server…. Falls back to scmscx.com's database. |
| Auto-place Start Locations | Not yet |

### Triggers

| | Status |
| --- | --- |
| Classic editor: every condition and action, per-item disable | Yes |
| Text editor in SCMDraft's TrigEdit syntax | Yes |
| Script editor: a TypeScript subset that generates triggers | Yes |
| Import and export `.trg` and text triggers | Yes |
| Validate triggers | Yes |
| Mission briefings | Partial. The editor is there, but no fixture map has a briefing, so the field layout follows the community reference and is unverified. |
| Create Unit with Properties (CUWP) | Partial. The slots survive a round trip and the action takes a slot number, but there is no editor for the slots themselves. |
| EUD triggers | Partial. Raw player and unit values are accepted everywhere, and the script's raw level has `Memory` / `SetMemory`. No dedicated EUD UI. |

### Scenario data

| | Status |
| --- | --- |
| Map properties, players, forces, colours (including Remastered RGB) | Yes |
| Unit, upgrade and technology settings, with per-player availability | Yes |
| String editor with a usage list, and unused-string cleanup | Yes |
| Switch names | Yes |
| Sound editor | Partial. Import, remove and adopt archive files all work; playback covers PCM and Ogg, so the game's own ADPCM `.wav`s show as "cannot decode". |

### Tools

| | Status |
| --- | --- |
| Check Map | Yes |
| Find (units, locations, sprites, strings, triggers) | Yes |
| Statistics | Yes |
| Export the map as a PNG, from full art down to a minimap | Yes |
| Import and export strings | Yes |
| Plugins (Plugins ▸ Manage Plugins…) | Yes. Load a `plugin.ts` from a public repository or URL; it can add menu items, context-menu entries, hotkeys, dialogs, floating panels and map tools of its own, and edit the map through undo. See [docs/plugins.md](docs/plugins.md). |
| Look at and edit the file itself: every CHK section, its bytes, what each byte means | Yes, as a plugin (Section Explorer: tick it in Plugins ▸ Manage Plugins…, then Tools ▸ Section Explorer…). A hex editor with the sections listed, fields coloured and named, values edited as numbers, choices, flags or text; sections added, removed, renamed and reordered. |
| Test Map | Not yet. It needs a local StarCraft to hand the file to, which a browser tab cannot do. |

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
and buildability.

The isometric brush ripples outward as it paints: a neighbour that cannot legally
border the new terrain becomes the intermediate one, and cliff faces stack as tall as
the tileset draws them. A single click of high ground gives a small mesa; a wider
brush gives flat high ground inside a cliff ring.

It needs the `ISOM` section, which is the editor's own record rather than anything the
game reads, and which protected maps often strip. Where a map has none, the tab says
so and Rebuild ISOM from Tiles reconstructs it: exact for ground that was laid down
isometrically, a best guess under doodads and hand-placed tiles. The tab also warns
when Rect or Tile edits have left the lattice out of step with the terrain.

Blend exists for joins the cliff sets never had: dirt into a doodad's base, one edge
set into another, a hand-laid shoreline. Click a tile to make it the anchor, and the
palette lists for each side the tiles whose opposite edge continues its pixels, best
seam first, with the mean colour difference under each thumbnail. Nothing in the game
data describes these matches; they are measured off the graphics, so the tileset has
to be extracted.

Rect, Tile and Blend leave `ISOM` alone, which is what SCMDraft does in its
non-isometric modes.

### Doodads

The palette is built from the current tileset's own groups, with StarEdit's categories
and placement rules. Picking a doodad arms placement, and the ghost turns red where
the footprint leaves the map, covers another doodad or sits on the wrong terrain.
Place Anywhere drops that rule; Snap to Grid keeps the footprint on StarEdit's
two-tile isometric grid.

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

Buildings, resources, start locations and beacons snap their placement box to the tile
grid the way StarEdit stores them. Everything else lands where the pointer is, and
Snap to Grid can be turned off for pixel placement, SCMDraft-style.

Placement checks are on by default and refuse a spot with a red ghost and a reason in
the status bar. They are the same rules the game applies when it loads a map and
silently drops units that do not fit: no overlapping collision boxes for ground units
and buildings, buildable tiles under a building's whole placement box, walkable
minitiles under a ground unit's collision box. The unit in the way gets outlined.

The matching Remove Stranded Units toggle on the Terrain palette deletes units that
your terrain edit just made illegal, as part of the same undo step.

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

The **Script Editor** is a TypeScript file per map that generates triggers, at two
levels: one `trigger()` call per trigger, and structured code with variables, `if`,
loops and functions. The structured level compiles down to a state machine built out
of death counters, with no EUD anywhere in it, so what comes out runs on any version
of the game. A built-in simulator runs thirty cycles of the result and tells you what
happened. Full reference in [docs/trigger-script.md](docs/trigger-script.md).

Generated triggers show up in the classic editor with a `script` badge, and hand-made
triggers around the generated block are left alone.

Mission briefings get their own editor over the same record layout with the briefing
action set. No fixture map has a briefing to check against, so treat that one as
untested.

All of these are OK / Apply / Cancel transactions and sit outside undo, as in
StarEdit.

### Scenario settings

The Scenario menu holds the map's own tables, each its own transaction and none of
them in the undo history.

Map Properties, Map Revision, Player Settings, Force Settings and Player Colors cover
the header data. Player Colors includes Remastered's per-slot RGB, where a slot can be
a palette colour, random, the player's choice, or a custom colour, and the section
only exists while some slot needs it.

Unit Settings, Upgrade Settings and Technology Settings edit the cost and availability
tables. A row on "use default" shows the greyed-out numbers from the game's own data
files and seeds itself from them when you untick it. Which layout gets written follows
the map's revision, so a hybrid map keeps both and an original-game map keeps only its
own.

The String Editor lists every string with where it is used, and edits keep their
index, so triggers and locations keep pointing where they did. Control bytes show and
type as `<XX>`, and a row of buttons inserts the game's colour codes.

The Sound Editor joins the map's sound table with the `.wav` files in the archive:
import, play, remove, and adopt files the archive carries but the table does not list.

### Checking and exporting

Tools ▸ Check Map looks for the sections a file of its revision needs, start locations
that do not match the player table, the unit limit, off-map units, a missing or moved
Anywhere, duplicate location names, string capacity, triggers pointing at unused
locations or strings past the end of the table, Play WAV actions with no file in the
archive, switches tested but never set, disabled triggers, and ISOM health.
Double-click an issue to go to it.

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
plugins loaded from their own repositories over the network — nothing about them is built
in — so they can be switched on and off but not removed from the list, and they need a
working connection on the first load of a session. Terrain from Image and scmscx.com start on; Paint,
scm-server and Section Explorer are listed but off until you tick them.

**Terrain from Image**
([scm-js/plugin-image-to-terrain](https://github.com/scm-js/plugin-image-to-terrain)) is
installed by default: File ▸ Import ▸ Terrain from Image…, or
right-click the terrain palette or the map — *Terrain from Image…* takes the marked area
when the Cut / Copy / Paste layer has one, and *Terrain from Image into Area…* first lets
you drag the target rectangle on the map (Esc cancels) and then opens the dialog with it
selected; *Pick on Map…* in the dialog does the same without losing your settings. Bring
the picture in with Choose File, Ctrl+V / Paste (a screenshot), a drop onto the dialog, or
a URL. Choose how it fits the area (stretch, fit inside, fill) and flips; tune brightness,
contrast, saturation, hue and gamma with the *Source* preview following; tick the terrains
it may become. Each terrain has a *key colour* — what in the picture it should match — set
with its swatch or the eyedropper (arm it on a row, click the source), so "this blue is
Water, that green is Jungle" is one click each. *Adaptive colour* fits the picture's range
to the palette's on its own, *Exact key colours* is plain nearest-colour, *Brightness
bands* runs the ticked terrains dark → light (a heightmap); *Weigh* leans the match towards
lightness or hue, *blur* / *despeckle* / *min. region* clean the result up. Apply is one
undo step. *Isometric terrain* paints every lattice diamond with the isometric brush, low
ground first and rare features last, so cliffs and shorelines are generated at every
boundary; *Flat tiles* stamps flat pairs and leaves the ISOM alone.

**Paint** ([scm-js/plugin-paint](https://github.com/scm-js/plugin-paint)) is in the list
but off; tick it in Manage Plugins, then Tools ▸ Paint…, Ctrl+Shift+P, or right-click the
map — *Paint…*. A panel floats
over the map (drag it by its title; it blocks nothing). Pick a tool in it and draw: what
gets laid down is whatever the active layer's palette has picked, so choose a unit and a
player on the Units layer, a doodad on the Doodads layer, a terrain or a tile on the
Terrain layer, fog players on the Fog of War layer, and switch layers to change the brush.
Freehand and Line are drags (Shift snaps a line to 45°); Rectangle and Ellipse drag a box
(Shift squares or rounds it, Alt draws from the centre); Polygon is one click per corner
and a click on the first corner to finish; Star drags from the centre, and the drag turns
it (points and inner radius in the panel, an inner radius of 100% is a regular polygon);
Spray scatters while you drag; Text stamps the panel's text in a 5 × 7 dot font, one
object or one tile per dot; Eraser removes the layer's units, sprites or doodads under the
stroke. *Filled* fills a closed shape in a grid, a staggered grid or at random; *Spacing*
is the distance between objects (auto = the object's own size); *Jitter* nudges them off
their spots; *Width* is the brush width in tiles for terrain and fog and the eraser's and
spray's radius; *Players* keeps the palette's player, cycles 1–8 along the shape, or picks
one at random each; *Units* can skip the spots the Units palette's placement checks
refuse. A count follows the pointer while you draw. Esc drops the shape in progress, and
again (or a right-click) leaves the tool. Terrain is painted as flat tiles like the Rect
brush, so Rebuild ISOM from Tiles afterwards if you want the isometric brush back there.
Every stroke is one undo step.

**scm-server** ([scm-js/plugin-scm-server](https://github.com/scm-js/plugin-scm-server)) is
in the list but off. It is the editor's network side, and everything it adds carries its
own icon so you can tell what leaves the browser: File ▸ Find Map… searches a map
database ([scm-js/scm-server](https://github.com/scm-js/scm-server)) by name, type (melee
or use map settings), genre (RPG, zone control, cat and mouse, tower defense, bound, …),
tileset, size and players, shows what the server worked out about each map, and opens the
one you pick; when the database has nothing, the same dialog searches scmscx.com and
fetches the map from there. File ▸ Export ▸ Publish to scm-server… uploads the open map
with a thumbnail; the server reads the file and fills in its genre, tags and a short
summary. A map you published is recognised when you open it again, so publishing it a
second time makes a new revision instead of a new entry. Plugins ▸ scm-server Settings…
holds the server address and your author key (created on first publish, kept in the
browser, and not recoverable if lost). Which server is yours to choose: the
plugin talks to any address that runs scm-server.

**scmscx.com** ([scm-js/plugin-scm-scx](https://github.com/scm-js/plugin-scm-scx)) is
on from the start. File ▸ Find on scmscx.com… searches the map archive at
[scmscx.com](https://scmscx.com) the way its own search page does (scenario names, file
names, descriptions, unit and force names; sorted by match, upload or modification
time, or name), filters by tileset, players and size, shows each map's minimap and
details, and opens the one you pick. Random picks a map among the matches, and a map
address pasted from the site opens that map. One thing to know: scmscx.com does not
send the CORS header a browser needs to let a page on another site read its answers, so
from an editor served anywhere but scmscx.com the search cannot connect today. The
dialog says so and links to the site, where you can download the map and drop it onto
the editor; the plugin tries the site first every time, so it works with no change once
the site allows it. Settings holds an optional forwarder address for anyone who runs one.

**Section Explorer** ([scm-js/plugin-section-explorer](https://github.com/scm-js/plugin-section-explorer))
is in the list but off. Tick it, then Tools ▸ Section Explorer… (Ctrl+Shift+H) opens the
map file as the game reads it: every section in file order on the left, with badges for
the ones the editor keeps as raw bytes, has never heard of, holds unsaved changes for, or
that repeat or have the wrong length; the bytes of the chosen section in the middle, each
field in its own colour, with the usual hex-editor keys (type hex or text, Tab between
columns, Insert mode, Delete, Ctrl+Z, Ctrl+C / Ctrl+V as hex, Ctrl+F, Ctrl+G); and on the
right what the byte under the cursor is — *Triggers › trigger 3 › actions › action 0 ›
unitId = 0 (Terran Marine)* — with a control to change it (a number, a drop-down of
names, a tick per flag bit, text), the raw readings in every width, and a tree of the
whole section that follows the cursor. Records can be inserted and removed, sections
added, removed, renamed and reordered, and a section or the whole `scenario.chk` exported
or imported. Nothing reaches the map until Apply, which makes the editor read the file
again from scratch — every dialog and the map view follow, and the undo history goes, as
with Resize.

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
| Ctrl+G | grid |

Preferences (Ctrl+,) persist in the browser: the splash screen, whether to confirm
before replacing a modified map, defaults for new maps, and whether water and units
animate at startup. Its Browser storage box lists everything the editor keeps in this
browser — the preferences, the grid settings, the installed plugin list, the copies of
any plugins set to load from storage, and whatever the plugins store — and **Clear all
data** throws the lot away, putting the defaults (and the default plugins) back. The map you have open is not kept in the browser and is not
touched by it.

## Documentation

| Document | Covers |
| --- | --- |
| [docs/game-data.md](docs/game-data.md) | Extracting Blizzard data, and how the graphics get drawn |
| [docs/file-formats.md](docs/file-formats.md) | CHK and MPQ handling, which sections are modelled |
| [docs/trigger-script.md](docs/trigger-script.md) | The scripting language, in full |
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
