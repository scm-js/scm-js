# Game data

A map file holds numbers: a tile id per cell, a unit type per placed unit. The pictures
those numbers refer to are in StarCraft's own archives, `StarDat.mpq` and `BrooDat.mpq`.
That is Blizzard's data, not covered by this project's MIT license and not
redistributable, so none of it ships with the editor. The editor gets it from a copy of
the game you are entitled to use, extracts what it needs once, and keeps the result.

This document is for anyone who wants to know where the graphics come from, what is kept
where, how a mod's files can be used in place of the game's, and how the pictures are
drawn. The [user guide](../README.md#the-graphics) covers the first-run dialog itself;
building the editor from source, which needs the same files on disk, is in
[Extracting for a source build](#extracting-for-a-source-build).

Attribution is not permission. Before publishing a fork or hosting a build, read
[ATTRIBUTION.md](../ATTRIBUTION.md#starcraft-and-brood-war-data).

## What the editor needs

Two archives from a classic (1.16) installation, `StarDat.mpq` and `BrooDat.mpq`. Brood
War's is required: its unit table is the layout the editor reads, and the Ice, Desert and
Twilight tilesets exist only there. A `patch_rt.mpq` beside them is applied over both,
as the game applies it. Remastered installations carry none of these files; the download
route below is for them.

Out of the archives come about 930 files, 30 MB in all:

| Files | For |
| --- | --- |
| `tileset/<name>.cv5`, `.vx4`, `.vr4`, `.vf4`, `.wpe` | the terrain of each tileset: tile groups, megatiles, minitile pixels, walkability and height flags, the palette |
| `tileset/<name>.ofire.pcx` and the other three remaps, `<name>.dddata.bin`, `stat_txt.tbl` | the fire and explosion colours, the doodad placement table, the doodad and unit names |
| `arr/units.dat`, `flingy.dat`, `sprites.dat`, `images.dat`, `images.tbl` | the chain from a unit type to its picture |
| `arr/weapons.dat`, `upgrades.dat`, `techdata.dat` | the defaults the Unit, Upgrade and Technology Settings dialogs show |
| `game/tunit.pcx` | the team colour rows |
| `scripts/iscript.bin` | the animation scripts |
| `unit/**/*.grp`, `unit/**/*.lo?` | about 750 sprite sheets and their overlay positions |

The eight tilesets, in the order the map file numbers them, are Badlands, Space
Platform, Installation, Ashworld, Jungle, Desert, Ice and Twilight.

Without any of this the editor still runs. Terrain is drawn in flat colours, one per
tileset, units and sprites as coloured markers, and everything else works: every layer,
every dialog, opening and saving. The palette that would need the graphics says so.

## Where it looks

The editor settles on one source of game data when it starts, in this order:

1. **A data set you chose.** When a [data set](#data-sets) other than the game's own is
   selected, its stored copy is asked for first. If that copy is gone, the editor says so
   and continues with the game's own files.
2. **Bundled with the build.** A clone that ran `npm run extract` serves the files from
   its `public/` folder. The desktop app serves its own extraction the same way.
3. **A copy kept in the browser.** An earlier download or upload left the extracted files
   in the browser's private storage for this site. The copy survives reloads and browser
   restarts and is about 30 MB; Help ▸ Game Data… shows it and removes it. A browser
   with no such storage holds the files for the session only.
4. **The desktop app's search.** The desktop app looks for the two archives next to the
   app (an AppImage's folder, the install folder, an unzipped folder, so two files dropped
   beside the app are found), in its own data folder, in `SCM_DATA_DIR` or
   `STARCRAFT_DIR` from the environment, in the platform's usual install locations
   (`C:\Program Files (x86)\StarCraft`, `/Applications/StarCraft`, a Wine prefix on
   Linux), and in `~/StarCraft` and `~/Games/StarCraft`. The first folder with the
   archives is extracted into the app's data folder, which is then step 2. Someone whose
   game is where the installer put it never sees a dialog.
5. **Nothing.** The editor runs without graphics and opens Help ▸ Game Data… to offer
   the routes below.

Nothing is ever fetched from an address you did not name. Earlier versions could take a
web address to load the files from; that route was removed once Blizzard's own package
became installable in one click, because a chain that runs out and asks is easier to
understand than a silent fetch.

The browser's private storage is per site, so [editor.scmjs.dev](https://editor.scmjs.dev)
and [nightly.editor.scmjs.dev](https://nightly.editor.scmjs.dev) each keep their own copy
and each ask once.

## Getting the files

Help ▸ Game Data… shows the current source and, when there is none, the two ways to get
one.

**Download from Blizzard.** Blizzard offers the standalone StarCraft map editor as a
free download, and the package carries both archives. They are the trimmed StarEdit
distribution rather than the game's own, which matters only in that they are enough:
they extract to the same files a 1.16 installation produces. The package is a 101 MB zip
of which only the two archives are wanted, so the editor reads the zip's own directory
and fetches just those members, 82 MB, using HTTP range requests, then inflates them in
the browser. The package's `patch_rt.mpq` is left alone.

The download goes through a small forwarder at `gamedata.scmjs.dev`
([scm-js/cloudflare-blizzard-forwarder](https://github.com/scm-js/cloudflare-blizzard-forwarder))
rather than straight to Blizzard, because a web page cannot read Blizzard's download
server directly: its HTTPS certificate is for a different name, plain HTTP is blocked on
an HTTPS page, and it sends no cross-origin header. The forwarder adds that header and
passes the range requests through. It stores nothing and serves nothing of its own. The
desktop app uses the same address, since its window is an ordinary web page with the same
rules.

**Use your own files.** Pick `StarDat.mpq` and `BrooDat.mpq`, or the folder holding
them. The desktop app can also search the computer, or take the StarCraft folder you
point it at. A `patch_rt.mpq` in the folder is applied over the two, as it is in the
game.

Either way the extraction runs on your machine, in a background thread in the browser
and in the app's own process on the desktop, and the result is kept so it happens once.
Open maps pick the graphics up as they arrive. The same dialog removes a copy, which puts
the editor back to whatever step of the search it would have reached without it.

### The container image

The container image at `ghcr.io/scm-js/scm-js` carries no game data and refuses to
serve the paths the files would be at, so a container starts at step 5 and asks, like
the hosted editor. To serve your own extraction to your own browser instead, mount an
extracted tree over those paths:

```sh
docker run --rm -p 8080:80 \
  -v "$PWD/public/tileset:/usr/share/nginx/html/tileset:ro" \
  -v "$PWD/public/arr:/usr/share/nginx/html/arr:ro" \
  -v "$PWD/public/unit:/usr/share/nginx/html/unit:ro" \
  -v "$PWD/public/game:/usr/share/nginx/html/game:ro" \
  -v "$PWD/public/scripts:/usr/share/nginx/html/scripts:ro" \
  ghcr.io/scm-js/scm-js:latest
```

That is a copy on your own machine served to your own browser. Publishing an image with
the files inside, or serving one from a public address, is redistributing Blizzard's
data; see [ATTRIBUTION.md](../ATTRIBUTION.md#starcraft-and-brood-war-data).

## Data sets

The editor draws from one set of game files at a time, and a *data set* names one. The
default is the game's own. Any other is a mod's: the same files in the same formats with
some of them replaced, its own `units.dat`, graphics, sounds or `stat_txt.tbl`. Help ▸
Game Data… installs one beside the game's files and switches between them; the *Data
sets* list appears once there is a second one, and the choice is remembered.

To add one, give it a name and pick a folder. The folder has to hold the game's two
archives, because a mod replaces files rather than bringing the rest, together with the
mod's own files: any `.mpq` archives, and loose files under `arr`, `unit`, `tileset`,
`game`, `scripts` or `rez` folders, the way the mod's own loader lays them over the game.
Anything else in the folder is ignored. The copy is stored under its own name beside the
game's, so removing one leaves the others alone. On the desktop the app's own extraction
is always the game's; a mod's copy lives in the browser-style storage there as anywhere
else.

Switching drops everything decoded from the previous files, since the same ids now mean
different pictures, and loads again from the new ones; an open map stays open and picks
the new graphics up as they arrive. Plugins see the switch through `api.gameData`.

A data set is a name over files in the game's formats, nothing more. The table sizes
(228 unit types, 130 weapons, 61 upgrades, 44 technologies), the tileset formats and the
map file's own fixed-width sections are the game's, so a mod that extends them, with more
unit types, a longer `.dat` layout or extended tilesets, is not a data set and is not
supported.

### Names

The game names things in `stat_txt.tbl`: entries 0 to 227 are the unit types, and the
weapon, upgrade and technology tables each point into the same file. The editor's own
name tables are StarEdit's, which read better in about fifty places ("Cargo Ship
(Unused)" where the game says "Unused") and are the vocabulary the text trigger format
and other editors share.

The rule is per entry: where the loaded data's name differs from what the game's own data
says for that id, the loaded name shows; everywhere else, StarEdit's stands. With
Blizzard's files nothing changes. With a mod's, whatever it renamed shows the new name in
every palette, list and dialog, and the text trigger parser accepts both names, so a
trigger printed under a mod reads back.

## Testing a map in the game

Tools ▸ Test Map needs the installed game rather than its data. Neither version of
StarCraft opens a map handed to it from outside, so the editor writes the map into a
`scmJS` folder under the game's `Maps` folder, where Single Player ▸ Custom Game lists
it. The desktop app finds the installation in the same places the archive search looks,
takes a folder you pick and remembers it, and starts the game: the executable itself on
Windows, `open -a` on macOS, Wine elsewhere. A browser has no such reach. Chrome and Edge
write into a folder you pick once and remember; other browsers download the file.

## Extracting for a source build

A clone has no game data until it is extracted. The script finds the archives on its own
or takes them as arguments:

```sh
npm run extract                                                     # look for an installation
npm run extract -- --from "/mnt/c/Program Files (x86)/StarCraft"     # a folder
npm run extract -- path/to/StarDat.mpq path/to/BrooDat.mpq           # the archives themselves
SCM_DATA_DIR=~/games/sc npm run extract                              # from the environment
```

With no arguments it looks in `SCM_DATA_DIR` or `STARCRAFT_DIR`, then in the
repository's own `fixtures/data/`, then in the usual install locations for the platform,
including the Windows drives a WSL session sees under `/mnt`. A `patch_rt.mpq` found with
the two is applied over them.

| Command | Does |
| --- | --- |
| `npm run extract` | everything |
| `npm run extract:tilesets` | the tileset graphics only |
| `npm run extract:units` | the unit tables, sprites and scripts only |
| `npm run check:assets` | report what is on disk without opening any archive |

Everything lands in `public/` (its [README](../public/README.md) is the inventory),
which is gitignored along with `fixtures/`. The run takes a few seconds and can be
repeated at any time; repeat it after a game patch or after changing what the scripts
take. `npm run dev` and `npm run build` warn when the files are missing and carry on,
because the editor degrades rather than crashing without them. That also means a green
test run and a working dev server prove nothing about the extraction; run it.

## How terrain is drawn

Each tileset is five files. A tile id in the map file leads through them to pixels:

```
MTXM tile id ──(id >> 4)──▶ CV5 group ──(id & 15)──▶ VX4 megatile
VX4 megatile ──▶ 16 minitile refs (bit 0 = flipped) ──▶ VR4 8×8 bitmaps ──▶ WPE palette
```

A tile is a 32×32 megatile made of sixteen 8×8 minitiles, each an index into the
tileset's 256-colour palette. The CV5 groups megatiles into terrain types with their
variations and edge pieces, which is where the terrain palette's list of terrains comes
from. The VF4 holds each minitile's walkability and height, which the elevation and
buildability overlays, the placement checks and the Walkability plugin all read.

The editor rasterises each tileset once into one large image, the *atlas*, and draws the
map by copying tiles out of it. Only the tileset the open map uses is decoded; the others
are fetched into the browser's cache in the background so a later map opens faster, but
not decoded, since a decoded tileset is about 20 MB of pixels.

### Water and lava

The graphics are indexed colour, and StarCraft animates water and lava by rotating a few
short bands of the palette every eight game frames, about a third of a second at the
Fastest speed. The band tables per tileset are the game's own; Space Platform and
Installation have none. The editor keeps a second small atlas of just the megatiles that
touch those bands and redraws it on each step. View ▸ Animate Water turns it on, and
Preferences ▸ Display sets the speed from a quarter to four times the game's. The minimap
and the far zoom levels, which draw average tile colours, do not animate.

## How units are drawn

A unit type leads to its picture through four tables:

```
units.dat[id].flingy ─▶ flingy.dat.sprite ─▶ sprites.dat.image ─▶ images.dat.grp
   ─▶ images.tbl ─▶ unit\…\*.grp
```

A GRP is a sprite sheet: a set of frames in the tileset's palette, with one frame per
facing for anything that turns. The extraction walks this chain from all 228 unit types
and from all 517 entries of the sprite table, so pure sprites and doodad overlays have
graphics as well. Sprite sheets are fetched the first time something needs them, so a
melee map pulls minerals, geysers and start locations and nothing else.

Team colour is palette indices 8 to 15 of a GRP, remapped through the row of
`tunit.pcx` for the owning player's colour and painted through the tileset's palette.
Sprites therefore need the tileset loaded as well. Pink and the custom RGB colours a
Remastered map can set have no row to remap to, so the editor synthesises a ramp for
them.

### Animation

Placed units run their idle animations when View ▸ Animate Units is on. Every unit's
script is stepped once per game frame, 42 ms at Fastest, on the same clock as the water,
and Preferences ▸ Display scales the rate on its own.

Each unit is a stack of images, shadow, body and overlays, each with its own script.
Buildings play their *Built* animation; tanks and Goliaths play *StarEditInit*,
StarEdit's own hook, which adds the turret. That is what gives turning turrets, pulsing
Hatcheries, marines looking around, the Nexus glow, Starport lights and refinery smoke.

Damage overlays follow hit points: a building below two thirds burns (Terran), sparks
(Protoss) or bleeds (Zerg) at the positions its `.lo` file gives, with more of them the
lower the hit points and the large effect below one third. Fire draws through the
tileset's own remap tables, extracted beside its graphics. Cloaked units draw half
transparent. Anything that needs the running game, attacks, sounds, projectiles and
condition jumps, is skipped.

## In the source

For developers. The extraction is one module shared by every route, and the drawing is
under `src/formats/`:

| File | Does |
| --- | --- |
| `src/gamedata/source.ts` | The search order above, as a chain over injected probes so `tests/gamedata.test.ts` can pin it without a browser. |
| `src/gamedata/store.ts` | The browser's copies, in the Origin Private File System: `gamedata/` for the game's own, `gamedata-profiles/<id>/` per data set, a stamp file written last so a half-written copy counts as nothing. |
| `src/gamedata/install.ts`, `zip.ts` | The two install routes. `zip.ts` reads a zip's directory and single members over HTTP ranges with no zip library; `tests/zip.test.ts` drives it over a zip built in the test. |
| `src/gamedata/extract.ts` | The extraction: archives in as a `ReadMember`, a map of paths to bytes out, no file system and no network. It imports only `iscript.ts`, so Node runs it without a build step. |
| `src/gamedata/extract.worker.ts`, `scripts/extract-*.mjs`, `desktop/main.ts` | The three places it runs: a browser worker, the Node scripts, the desktop's main process (which also holds the disk search and Test Map). |
| `src/gamedata/archives.ts`, `scripts/lib/archives.mjs` | Opening the archives with [mopaq](https://github.com/jeany55/mopaq), later archives winning, with a mod's loose files as an overlay; and finding them on disk. |
| `src/gamedata/profiles.ts`, `src/services/gameData.ts` | Data sets: the id and name, the stored choice, and the switch that drops every decoded table and loads again. |
| `src/data/gameNames.ts` | The per-entry naming rule; `tests/names.test.ts` pins the differences against the real files. |
| `src/formats/tileset/` | `decode.ts` for the five files, `atlas.ts` for the atlas, `terrain.ts` for the terrain catalogue read from the CV5, `palette.ts` for the terrain names, `cycle.ts` for the palette bands, `doodads.ts` for `dddata.bin`, `load.ts` for fetching and the per-tileset cache. |
| `src/formats/dat/` | Decoders for the `.dat` tables, `.tbl`, GRP, PCX, `.lo` and the iscript bytecode. |
| `src/formats/units/` | The unit tables and lazy sprite loading, the per-frame canvas cache with its byte budget, team colours, and the animator. |
| `src/services/testMap.ts` | Test Map's browser half. |

Two things to know before changing any of it. The manifests the extraction writes are
what the loaders probe for, so changing what is extracted means re-running it and
checking the app against the result, not only the tests. And `tests/dat.test.ts`,
`tests/iscript.test.ts`, `tests/animate.test.ts`, `tests/palette.test.ts` and
`tests/tileset.test.ts` run against the real files in `public/` and skip when they are
absent, so a green run on a clone without them has not exercised the decoders.
