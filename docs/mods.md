# Mods

A Brood War *mod* is the game with other data: other unit tables, animation scripts,
pictures, sounds, strings and AI, and in the larger mods other code as well, through
plugins or edits to the game's program. scmJS reads mods as their makers ship them and
keeps a mod as a folder of text and pictures that you can edit with any editor, keep in
git and pack back into the files the scene's launchers load.

Everything here works on your own copy of the game and your own copy of the mod. Nothing
is uploaded, and nothing a mod carries as a program is run on your computer: its plugins
run only inside the game that the play page and the engine's bot runners play.

## Three ways in

**The command line.** `scmjs mod` reads a mod from what it ships as — a folder of files,
an `.mpq`, a self-executing `.exe` or a `.zip` — says what it is, unpacks it into a folder
of text, checks it, compares two versions, packs it again and hands it to the play page.
[The commands](#the-commands) go through each.

**The play page.** The play page at scmjs.dev/play plays a mod from your own copy of
StarCraft, 1.16.1 or Remastered. Add it once (Game Menu ▸ Mods ▸ Add a Mod…: the mod's
folder as its makers ship it, an `.mpq`, a self-executing `.exe` or a `.zip`), and the
page keeps it, runs its plugins and FireGraft project inside the game, seats bots made for
it, and writes the mod into every replay it saves. [On the play page](#on-the-play-page)
has the details. `scmjs mod play` hands a mod to it from a terminal, with a map and a bot
made for the mod if you like.

**The editor.** The editor makes maps for a mod through its [data
sets](game-data.md#data-sets-made-from-a-mod): Help ▸ Game Data… ▸ Add a data set… takes a
folder of the mod's archives and loose files and lays them over the game's. Its tables are
read at any width, so its new unit types are in the palette with their names and pictures,
under the race the mod gives them. Upgrade and technology settings, the trigger editor's
unit lists and the trigger text use the mod's names. A map saved with it remembers the
data set, and every export, share and Test Map build carries it. The folder holds `.mpq`
archives, a mod's self-executing `.exe` (read for its archive, never run) and the game's
paths; a mod that ships as a `.zip` is unzipped first. A replay of a mod opens in the
editor too, and plays with the mod your browser keeps from the play page ([Replays of a
mod](guide.md#replays-of-a-mod)).

To only look at a map made for a mod, nothing needs installing. Opened without the mod,
the map has the terrain the data set in use lacks drawn hatched, and a notice that offers
to switch to the mod's data set when it is installed here, or to draw from the mod's
folder of loose files there and then ([Terrain the data set has not
got](game-data.md#terrain-the-data-set-has-not-got)).

**The Mod Editor.** To change the mod itself, install the [Mod
Editor](https://github.com/scm-js/plugin-mods) plugin from Plugins ▸ Browse Plugins…. File
▸ Open a Mod… opens a mod's folder, an `.mpq`, a mod's self-executing `.exe` or a `.zip`
in a panel under the map, where its tables, strings, pictures, sounds, animation scripts
and AI scripts can be edited. Dropping the mod's folder on the editor opens it too; the
status bar counts the folder's files while the editor reads them. While the mod is open
the editor draws from its files as they are now: change a unit's hit points and Unit
Settings shows the new default. It saves the mod as an MPQ or as the folder of text
`scmjs mod unpack` writes, and plays it on the play page.

## A mod as a folder

`scmjs mod unpack` writes a mod as a folder like this one:

```
mymod/
  mod.json              the mod's name, version, authors and licence, and what the folder needs to pack
  README.md
  tables/units.txt …    the unit, weapon, flingy, sprite, image, upgrade, technology, order,
                        sound, portrait and campaign tables, as PyDAT's text
  strings/stat_txt.txt  the string tables, as PyTBL's text (images.txt, sfxdata.txt, unitnames.txt …)
  iscript/iscript.txt   the animation scripts, as PyICE's text (a mod may have several)
  ai/aiscript.txt       the AI scripts, aiscript.bin and bwscript.bin, as PyAI's text
  overlays/unit/terran/marine.lob.txt …   the overlay offsets, as PyLO's text
  graphics/unit/terran/marine.png …       each GRP as a PNG sheet
  sounds/sound/…        the WAV files, as they are
  grafts/Units.txt …    GPTP's .graft files (requirements, buttons), as graftc's text
  maps/…                the mod's maps
  plugins/, Firegraft/  plugins and FireGraft files, as they are
  files/…               every other file of the game the mod changes, as it is
```

The texts are PyMS's own dialects, so a table exported here reads in PyDAT and the other
way round, and the same for PyTBL, PyICE, PyAI and PyLO. A few lines start `# scmjs:`;
PyMS reads them as comments, and they keep what the text form cannot say (where the game's
own iscript keeps its headers, the order of its table), so the file comes back as it was.
Each table entry's header line names it (`Unit(0):  # Terran Marine`), and the AI script
names units, upgrades and technologies, with the names from the mod's own string tables,
or the game's when the mod has none.

**Pictures.** Each GRP is one PNG: every frame in a cell of the GRP's size, 17 cells to a
row for a unit's facings. The PNG is an indexed picture in a named palette (the jungle
tileset's by default, or the one `mod.json` names; the mod's own `tileset\<name>.wpe` when
it has one, else your game's), with the frame boxes and the palette's name written inside
it, so the GRP that comes back is the same bytes. Draw over a sheet in a program that
keeps its palette and only the pixels you changed change. A picture saved in full colour
is brought to the nearest of the palette's colours when it is packed, and `mod pack` says
how many pixels moved.

**What comes back the same.** Each file is written as text or a picture only when that
text or picture packs back into exactly the same bytes; that check is the packer itself. A
file that would not — a GRP another tool encoded, which reads as the same pictures but in
other bytes, or a file that is not what its name says — is kept as it is under `files/`,
and `mod.json` lists it under `kept` with why. So an unpacked folder packs back into the
mod it came from, file for file, and an edit to one text changes that one file.

**mod.json** holds what a person fills in (`name`, `version`, `authors`, `licence`,
`base`, the game the mod is for) and what packing needs: each table's file and layout,
each string table's text encoding, the palette, where the names came from, the files kept
as bytes, the plugins and FireGraft files and whether they were inside the mod's archive,
and the sources the folder was made from in their load order (`layers`). An unpacked mod's
names stay as they were (`Units.graft`, `arr\units.datex`).

**Tables in other layouts.** A table may be the game's own size, DatExtend's expanded
`.dat` (PyMS's reading, more entries and a wider flingy column), or GPTP's `.datex` (more
entries again, wider columns, no header). Each is written as text in the same way and
packed back in the layout it came in, at the width its text has.

## The commands

### What a mod is

```sh
scmjs mod info "Cosmonarchy BW"
```

```
Cosmonarchy BW
A mod for StarCraft 1.16.1, from a folder of the game's files

  Files            7,769 · 931.1 MB
  Kinds            11 tables (748 KB), 13 scripts (2.0 MB), 3,894 pictures (254.1 MB), 3,527 sounds (553.1 MB), …
  Tables           flingy.datex, images.datex, mapdata.datex, orders.datex, portdata.datex, sfxdata.dat, …
  Extended         flingy.datex: 1,000 entries (the game's 209), GPTP's .datex layout
                   …
                   units.datex: 3,000 entries (the game's 228), GPTP's .datex layout
  Plugins          _qdp-hotloader.qdp (358 KB), aise.qdp (1.0 MB), gptp.qdp (5.9 MB), … — kept, not run
  FireGraft        1161.fgd (555 KB), Cosmonarchy BW.fgp (98 KB) — kept, not applied
  Exe              Cosmonarchy BW.exe: FireGraft's patcher with 1 plugin (id fc724f8c, 358 KB), its archive at byte 804,352
  Layers           Cosmonarchy BW.exe then mpq
  Hash             ac3f86533e4b5a31
  Without plugins  b13e467fb5abb298 (a page that runs none of the plugins)
```

It takes a folder (the game's paths at its root or in a folder under it, as a release
keeps them under `mpq/`), an `.mpq`, a mod's `.exe` or a `.zip`. A folder's own archives
and exes are read too, archives first and loose files over them, the later winning, as the
game lays its own archives. A self-executing exe is read for the archive appended to it,
never run: MPQDraft's self-executing MPQ, or FireGraft's patcher with its plugins listed.
A zip's stored and deflated members are read; a zip64 or encrypted zip is not. An
archive's list of its files is taken as its files; an archive with no list is searched for
the names the game reads. A name the list holds and the archive does not (Cosmonarchy's
loader lists six tileset files it never packed) is left out and said.

The last two lines are [the mod's hash](#the-mods-hash). An `Older hash` line follows them
when the mod holds files an operating system left in its folders (`desktop.ini`,
`Thumbs.db`, `.DS_Store`): the hash it had while those counted.

### A folder to edit

```sh
scmjs mod unpack MyMod.mpq mymod
```

```
✔ My Mod: 1,018 files · 41.3 MB · → mymod
  As text        11 tables, 6 string tables, 1 iscript, 2 AI scripts, 96 overlay files
  As pictures    832 GRPs (the jungle palette)
  As they are    70 other files
  Names          from the mod's string tables
```

`--palette badlands` draws the sheets in another tileset's palette. Unpacking over an
earlier unpack replaces its folders and leaves anything you added beside them.

### Back into an MPQ

```sh
scmjs mod pack mymod                    # mymod.mpq beside the folder
scmjs mod pack mymod -o MyMod.mpq --compression pkware
scmjs mod pack mymod --folder samase/   # the files loose in the game's paths
```

The MPQ has a file list and is compressed with zlib by default (`pkware` is what
Blizzard's own tools wrote, `none` stores the files). The same folder packs into the same
bytes every time. A sound under `sounds/` that is not a WAV (an Ogg, an MP3) is converted
to one with ffmpeg, when ffmpeg is on your PATH. Files outside the known folders are left
out and named.

### Looking for mistakes

```sh
scmjs mod check mymod
```

```
My Mod · ✖ 2 errors (over StarCraft 1.16.1 (2 archives))
  ✖ units 1 (Terran Ghost) ground_weapon: points at weapons 200, past the 130 entries weapons.dat has
  ✖ images 5 grp_file: names unit\custom\nothere.grp, which is in neither the mod nor the game: the game stops when it draws it
```

Errors are what makes the game stop or draw nothing: a reference past its table (a unit's
weapon, flingy or subunit, a flingy's sprite, a sprite's image), a string past its string
table, an image with no GRP or overlay file, an image whose animation script is missing, a
button set or requirement for something the tables do not have. Warnings are what is
probably a mistake: a weapon or animation script the mod added that nothing uses, a sound
row the mod changed whose file is nowhere, units with the same name, tables in both
DatExtend's and GPTP's layouts. What the mod leaves as the game had it is not judged; the
game has leftovers of its own. The check runs over your copy of the game when it finds
one; without one, references to the game's own files are not looked at, and it says so. It
exits 1 when there is an error.

### A changelog

```sh
scmjs mod diff mymod             # what the mod changes in the game
scmjs mod diff v1.mpq mymod      # what changed between two versions
```

```
StarCraft 1.16.1 (2 archives) → mymod · 6 changes

Tables
  Terran Marine: ground weapon damage 6 → 7
  unit 228 added: Terran Maverick
  sound 69 → Bullet\TGoFir00.wav

Animation scripts
  iscript: Terran Marine's GndAttkRpt animation changed

Pictures
  3 pictures changed, 1 added
```

A weapon's change is told through the units that carry it, a sound row's by the file it
plays, an animation script's by the unit drawn with it and the animation that changed.
With one mod, the other side is your copy of the game.

### Starting a mod

```sh
scmjs mod new mymod --name "My Mod"
```

writes `mod.json` and a README of one paragraph. Put the game's files you change under
`files/` at their paths (`files/arr/units.dat`), or the texts in their folders, and pack.
Starting from an existing mod is `mod unpack`.

### Check, then pack

```sh
scmjs mod build mymod -o MyMod.mpq
```

runs `mod check` and, when it finds no error, `mod pack` with the same options. `--force`
packs anyway.

### Playing it

```sh
scmjs mod play mymod --map "(2)Ridge.scx"
```

opens the play page in your browser and hands it every file of the mod, its plugins and
FireGraft files with them, and [the mod's hash](#the-mods-hash); the page keeps the files
that differ from your copy of the game. With `--map` the map starts with the mod. The
hand-over is described in the [command line's guide](cli.md#mods).

```sh
scmjs mod play "Cosmonarchy BW" --map "(4)Exodus 1.0.scx" --bot cosmonarchy-example
```

`--bot` puts a community bot on the other side: one of the play page's bots by its key, or
a `.scmbot` file you built. The map waits on the page's setup screen with the bot in the
row beside yours, saying whether it was [made for the mod](#a-bot-for-your-mod), and you
press Start Game; `--start` starts it at once. `--race` sets the bot's race. The page's
own bots need a scmjs.dev account, and the page asks you to sign in; a file of your own
does not.

### The mod's hash

A mod goes by a hash of sixteen hex digits, worked out the same way by the play page,
`scmjs mod info`, the editor's data sets and the tools that read a replay of the mod, so
one mod has one hash everywhere. It covers every file the mod provides: each file it lays
over the game, loose under its game folders or inside its archives (an `.mpq`, or the
archive inside a FireGraft or MPQDraft loader `.exe`), each plugin it carries as a file,
and its FireGraft project (`.fgp`). It is never compared with anyone's copy of the game,
so two people with different copies give the same mod the same hash, and a release
unpacked into a folder and packed again keeps it. Left out are what is not the mod's
files: a file an archive lists and does not hold, a folder's read-mes, programs and
libraries, and FireGraft's database (`.fgd`). A page that does not run the plugins plays
something else, so beside the hash there is one without the plugins; `mod info` prints
both, and a page that runs none of them presents that one. Each file is a line, its name
and the SHA-256 of its bytes, and the hash is over the sorted lines ([the exact
form](cli.md#playing-a-mod-on-the-play-page)).

**Files an operating system leaves in folders are not the mod's.** Windows Explorer writes
`desktop.ini` and `Thumbs.db` into folders it has shown, the macOS Finder `.DS_Store`, and
a mod's loader that packs its folder into an archive packs them in too. The game never
asks for them, and not every way of reading a folder hands them over: a browser's folder
picker never shows `desktop.ini` or `Thumbs.db`, nor does a folder dropped on the editor,
while a folder dropped on the play page and the command line do. So they have no line in
the hash, wherever they lie, and the same mod has the same hash however it was read. They
are, by name in any case:

| Name | What leaves it |
| --- | --- |
| `desktop.ini` | Windows Explorer, a folder's view and icon |
| `Thumbs.db`, `ehthumbs.db`, `ehthumbs_vista.db` | Windows Explorer and Media Center, thumbnails |
| `.DS_Store`, `Icon` followed by a carriage return | the macOS Finder, a folder's view and icon |
| a name that starts with `._`, and everything under a folder `__MACOSX` | macOS, the second half of a file on a disk that is not its own, and the folder its zips keep those in |
| `.directory` | KDE's file manager, a folder's view |

A file whose name only holds one of these (`mydesktop.ini`, `thumbs.db.txt`) is a file of
the mod like any other. So is every other file a browser's folder picker does not show.
Chrome hides more than the two names above: shortcuts (`.lnk`, `.url`, `.scf`), names
Windows keeps for devices (`aux.wav`, `con.grp`), and names that begin or end with a
space, a dot or `~`; on Windows its list of file types it does not hand to a page adds
`.ini`, `.cfg`, `.dll` and `.manifest`. Those may be a mod's own (a plugin's
`config.ini`), so they keep their lines: a mod read through the folder picker, or dropped
on the editor, is short of them, and its hash says so by being another. Read such a mod
with `scmjs`, or drop its folder on the play page, which reads a dropped folder file by
file.

**The hash before 9 November 2026** had lines for those files, so a mod whose folder holds
any had another hash then: Cosmonarchy's release, with a `desktop.ini` in two of its sound
folders, was `1c41a2d7701fe842` and is `20e1c6d89ae2af75`. A replay saved before that
date, and a mod a browser kept, name the mod by the older hash. It is still taken wherever
hashes are compared, where it can be worked out: `mod info` prints it as `Older hash`, the
replay commands accept it, and the play page finds a mod it kept under the older hash by
the new one and plays an older replay with it. It cannot be worked out by a route that
never saw the files: a folder chosen with the browser's folder picker has no older hash,
so a replay saved before the date is not matched to it. Drop the folder on the play page
instead.

### Testing with it

```sh
scmjs mod test mymod ridge.scx
scmjs map test ridge.scx --mod mymod
scmjs map trace ridge.scx --mod MyMod.mpq
```

The game engine's runners play a map with the mod's files laid over the game's, fetched
from the play page once like any [command that plays the
game](cli.md#commands-that-need-starcraft). These three lay the mod's files only; its
plugins and FireGraft project run beside a bot in `scmjs bot run` and `bot ladder` ([a bot
for your mod](#a-bot-for-your-mod)). A scenario with a bot on the other side is not there
yet.

### Replays of modded games

A replay holds the players' commands, not the files the game read. Played back with other
files, the same commands make another game: a unit costs something else, a building is
somewhere else, and the replay goes its own way. So a replay of a mod says which mod it
was. scmJS adds a short section at the end of the file, after what the game wrote, that
holds the mod's name, [its hash](#the-mods-hash) (with its plugins, or without them when
the page ran none), its makers' link, the plugins that ran and the FireGraft patch
applied. StarCraft itself does not read it: 1.16.1 plays the file as it would the same
file without it, and Remastered steps over it as over any section it does not know. The
[replay package's](https://github.com/scm-js/replay#mod-identity) read-me has the bytes.

What reads it:

- `scmjs replay info` shows it on the `Mod` line. With `--builds` it lists what each
  player ordered, by id until `--mod` names the mod's folder, and then with the mod's
  names and costs. A mod whose data set is not the one the replay names is refused.
- `scmjs map trace --replay` and `map cost --replay` need the mod named with `--mod` and
  check it the same way. A game the mod's plugins ran in is refused, as the engine's
  runners do not run plugins.
- `scmjs replay watch`, `replay export`, `map heatmap`, `map coverage` and
  `map test record` refuse a mod's replay, or leave it out of a list, for now.
- The play page plays it with the mod it names, switching to that mod when your browser
  keeps it, or saying which mod it needs and where its makers publish it ([On the play
  page](#on-the-play-page)).
- The Aftermath plugin, the editor's replay viewer, shows the mod and its link, plays the
  replay with the mod your browser keeps, and takes the names and costs from the mod's
  folder when you attach it ([Replays of a mod](guide.md#replays-of-a-mod)).

The play page writes the section into every replay it saves of a game of a mod: Save
Replay, and Watch the Replay and Analyse in the Editor at the end of a game. A replay
StarCraft itself recorded with a mod has no such section. On the play page, choose the mod
under Mods first; the page then asks whether to watch the replay with the mod or without
it. Such replays are expected to play, but none has been checked yet.

### A bot for your mod

```sh
scmjs mod header "Cosmonarchy BW" --out mybot --bot
```

A [community bot](https://github.com/scm-js/scmbot) made for a mod names the mod's units,
weapons, upgrades and technologies, which BWAPI's own names (`Terran_SCV`) do not cover.
`mod header` writes them for it: `<Mod>.h`, C++ for a bot built with scmbot
(`Cosmonarchy_BW::UnitTypes::Terran_Mason` is a `BWAPI::UnitType`), and `<Mod>.ids.json`,
the same ids and names for bots and tools in other languages. Every name the mod has is
there, not only the ones it added, since a mod may rename everything. Both files carry the
mod's name and [its hash](#the-mods-hash). With `--bot`, `--out` is the bot's folder and
its `scmbot.json` gains the mod; `scmbot build` writes it into the `.scmbot` file, and
when the bot plays, the runners say "made for" the mod when the game's mod is that one,
"plays vanilla data" for a bot made for no mod, and warn (the game still plays) for a bot
made for another. The scmbot repository's `examples/cosmonarchy/` is a small bot for
Cosmonarchy written against such a header. See [the command](cli.md#a-bot-made-for-a-mod)
for the names' rules. To try a bot on the mod without a page,
`scmjs bot run mybot/out/mybot.scmbot "(4)Exodus 1.0.scx" --mod "Cosmonarchy BW"` plays it
with the mod's plugins, and `scmjs bot ladder … --mod` plays a ladder on the mod ([a bot
on a mod](cli.md#a-bot-on-a-mod)).

### For AI tools

`scmjs mcp` has the mod commands as tools: `mod_info`, `mod_check`, `mod_diff`,
`mod_unpack`, `mod_pack`, `mod_new`, `mod_header` and `mod_play`. An AI tool can unpack a
mod, change a table's text and pack it again, as you would, write the header for a bot,
and hand the mod with a map and a bot to the play page in your browser, which it says the
link to and what the page answered. `map_trace` and `map_cost` take a `mod`. See [AI
tools](cli.md#ai-tools).

## On the play page

The play page at [scmjs.dev/play](https://scmjs.dev/play/) runs the game in a browser tab
from your own copy of StarCraft, which it asks for the first time: the folder the game is
installed in. A mod is laid over that copy. A Remastered installation works as well as a
1.16.1 one.

### Adding a mod

Open the Game Menu, then **Mods ▸ Add a Mod…**, and pick the mod's folder as its makers
ship it; **Or choose a .mpq, .exe or .zip** takes a single file instead. Dropping the mod
anywhere on the page does the same. The page says in one line what it found, keeps the
files that differ from your copy of the game in your browser, and plays with the mod from
then on. Nothing is uploaded. A mod of Cosmonarchy's size takes a few minutes the first
time.

The Mods list shows every mod the page keeps, with what each changes. **Use** plays one,
**None** goes back to the game's own data, and **Remove** forgets one. Choosing loads the
page again, since every table and picture is read again through the mod. A mod the page
kept is found again by [its hash](#the-mods-hash) on later visits.

### Its plugins and FireGraft project

A mod's plugins, and the changes its FireGraft project makes to the game's program, run
inside the game on the live engine. The page loads itself again there when you choose or
add a mod with code under Mods, when `scmjs mod play` hands one over, and when a replay or
an invitation to a game needs it, so you never type its address. A game with a mod's
plugins needs 2 GB of the browser's memory; close other tabs if the page says it was given
less.

### Maps and bots

The maps the mod carries are offered beside the page's own, and the setup screen shows a
map's forces and slots as the game's lobby does. With a mod in use, the game's own
computer players are the mod's AI, and their rows say so ("Computer — Cosmonarchy BW's
AI"). A community bot's row says whether it was made for the mod, plays vanilla data, or
was made for another mod, which plays all the same with a warning. The catalogue's
Cosmonarchy Example is a small bot made for Cosmonarchy BW; Options ▸ Community bots ▸ Add
a bot from a file… adds one [you built](#a-bot-for-your-mod). The catalogue's bots need a
scmjs.dev account; your own file does not.

### Games between people

A game between people carries the mod. The host's invitation link names the mod, its hash
and where its makers publish it, and a page that keeps the mod and follows the link loads
itself again on the mod, run the way the host runs it. A joiner without the mod is told
which mod it is and where to get it, and plays nothing until it is added under Mods. A
replay saved by either player is the same file up to where each stopped.

A mod with a FireGraft project and no plugins is the one case the page cannot settle
alone: if you join by typing the invitation on a page opened another way, the page tells
you how the host runs the mod rather than switching. Join by the host's link.

### Replays

A replay saved on the page [names its mod](#replays-of-modded-games). Opening it later,
from Watch a Replay, a drop, a link or the editor, plays it with that mod: the page
switches to the mod when your browser keeps it, and otherwise says which mod it needs and
where its makers publish it, with an **Add a Mod…** button; once you add it, the replay
plays. A browser that keeps another version of the mod is refused with both hashes.

Going back in a replay of a mod whose plugins run starts it again from its first frame and
plays forward, which takes a while; the Watch Replay menu says so under Go to frame.

## From a mod folder to a replay

The whole path, from a mod as its makers ship it to a bot made for it playing you on the
play page, and the game's replay played on from a moment. Cosmonarchy BW is the example;
any mod goes the same way. You need your copy of StarCraft, Node (for
`npm install -g @scm-js/cli`, which gives the `scmjs` command), and Docker for building
the bot. To play the catalogue's example bot instead of your own, skip steps 3 and 4 and
give `--bot cosmonarchy-example` in step 5.

1. **The mod.** Use the release folder as its makers ship it, here `Cosmonarchy BW`, or a
   folder `scmjs mod unpack` wrote. `scmjs mod info "Cosmonarchy BW"` names it, counts its
   files, plugins and FireGraft project, and prints its hash.
2. **Check it.** `scmjs mod check "Cosmonarchy BW"` lists the mistakes it finds across the
   tables, pictures, scripts and sounds, errors first. Nothing here stops on a warning.
3. **A bot for it.** In a new folder beside the mod's, `scmjs bot new` writes a bot to
   start from. Then `scmjs mod header "../Cosmonarchy BW" --bot` writes `Cosmonarchy_BW.h`
   and `Cosmonarchy_BW.ids.json` beside it and names the mod in its `scmbot.json`; the
   command prints how many units, weapons, upgrades and techs it named. Write the bot
   against the header's names (`Cosmonarchy_BW::UnitTypes::Terran_Mason`); the scmbot
   repository's `examples/cosmonarchy/` is one to start from.
4. **Build it.** `scmjs bot build` writes `out/<key>.scmbot`. The first build downloads
   the toolchain, a Docker image. To try it without a page,
   `scmjs bot run out/<key>.scmbot "(4)Exodus 1.0.scx" --mod "../Cosmonarchy BW"` plays
   it, and its first lines say "made for Cosmonarchy BW".
5. **Hand it all to the play page.** With Exodus, one of the mod's maps (`--map` takes the
   map's file, so give its path if it is not in this folder),
   `scmjs mod play "../Cosmonarchy BW" --map "(4)Exodus 1.0.scx" --bot out/<key>.scmbot`
   opens the play page in your browser. The first time, the page asks for your StarCraft
   folder, then keeps the mod (a few minutes for a mod of Cosmonarchy's size) and loads
   again; then Exodus is on the setup screen with its own settings, and the row beside
   yours names your bot "made for Cosmonarchy BW". The terminal says the same and returns.
   With `--bot cosmonarchy-example` the page's own example bot plays instead.
6. **Play.** Press Start Game. The mod's plugins run in the game, the mod's AI plays the
   map's computers, and your bot plays its side.
7. **Save the replay.** Game Menu ▸ Save Replay downloads the game as a `.rep`, with [the
   mod's name and hash](#replays-of-modded-games) at the end of the file.
8. **Read it.** `scmjs replay info game.rep` shows the `Mod` line (Cosmonarchy BW, its
   hash, and its makers' link if you gave the page one) and the `Plugins` line (the four
   that ran, and the FireGraft project). `--builds --mod "../Cosmonarchy BW"` lists what
   each player ordered by the mod's names.
9. **Open it in the editor.** At [scmjs.dev/editor](https://scmjs.dev/editor/), File ▸
   Open Replay… opens it with Aftermath, which shows the mod and its link. The Replay view
   plays the game with the mod the play page kept in step 5, and the analysis plays it
   through the same way: the Game, Analysis and Cast tabs fill as for any replay. With the
   mod's plugins running, the analysis goes at about the game's own pace, so a long game
   takes a while, and the Fights tab lists the fights without playing them again ([Replays
   of a mod](guide.md#replays-of-a-mod)). Help ▸ Game Data… ▸ Add a data set… with the
   mod's folder, or Aftermath's **Attach the Mod's Folder…**, names the units by the mod.
10. **Play from a moment.** Stop the timeline where you want and press Play From Here. The
    play page opens with the mod and its plugins running, at that moment; take a player
    and play on, alone or against a community bot such as yours.

## Working with other tools

- **PyMS.** The folder's texts are PyDAT's, PyTBL's, PyICE's, PyAI's and PyLO's own, so a
  file opens in the PyMS program for it, and one PyMS wrote can replace the one here.
  `# scmjs:` lines are comments to PyMS. aise's AI commands are read; where an AI plugin
  added commands nobody has written down, those bytes stay as `raw_bytes(…)` lines, which
  pack back unchanged, and `mod.json` notes how many.
- **IceCC.** Mods' iscript sources are often IceCC's, with `ub`, `uw` and `pw` lines for
  commands a plugin added; those are read and kept.
- **MPQDraft and the launchers.** `mod pack` writes the MPQ MPQDraft, Chaoslauncher and
  FireGraft's patcher load. A self-executing mod is MPQDraft's own job: make it from the
  MPQ there. scmJS never writes a program.
- **FireGraft.** `.fgp` and `.fgd` files are kept as they are and listed. GPTP's `.graft`
  files, which hold the same buttons and requirements as text, are unpacked to graftc's
  text in `grafts/`.
- **samase.** `mod pack --folder` writes the files loose in the game's paths, as samase
  reads them next to StarCraft: Remastered.
- **SCMDraft and Chkdraft.** A mod's maps are ordinary maps, kept under `maps/`.

## What it does not do yet

- The command line keeps and lists plugins (`.qdp`, `.bwl`) and never runs them on your
  computer; a FireGraft file's edits to the game's program are applied only inside the
  game that the play page and the engine's bot runners play, where the plugins run too.
- `scmjs mod test`, `map test`, `map trace` and `map cost` lay a mod's files over the game
  but run none of its plugins, and have no scenario with a bot on the other side yet.
- With a mod's plugins running, a replay cannot be put back to an earlier moment: going
  back starts it again from the first frame, and Aftermath's Fights tab does not play a
  fight again. Analysing such a replay runs at about the game's own pace.
- In a game between people, a mod with a FireGraft project and no plugins needs the host's
  invitation link; a page joined another way is told, not switched.
- Replays recorded by StarCraft itself with a mod are expected to play with the mod, but
  none has been checked.
- The editor does not open a mod's `.zip` or `.exe` itself; its data sets take a folder (a
  loader `.exe` in the folder is read for its archive).
- `mod pack` does not make a self-executing exe; MPQDraft does.
- PNG sheets need the palette they name when a picture has lost its palette (saved in full
  colour). An untouched sheet carries its own.
- Sounds are copied as they are; an Ogg or MP3 is converted only when packed, and only
  with ffmpeg.
- Remastered's own formats (`.anim`, `.dds`) are kept as bytes.

## In the source

| File | Does |
| --- | --- |
| `src/formats/mod/sources.ts` | What a mod comes in: where the game's paths start in a folder, the archive in a self-executing exe, a zip read |
| `src/formats/mod/hash.ts` | The mod's hash and the hash without plugins, and the names looked for in an archive with no list |
| `src/formats/mod/folder.ts` | The folder's form: where each file goes, each form written and read back with the same function, `mod.json` |
| `src/formats/mod/data.ts` | A mod's tables, string tables and scripts over the game's, and which entries it changed |
| `src/formats/mod/check.ts` | The lints |
| `src/formats/mod/diff.ts` | The changelog, the animation scripts compared an animation at a time |
| `src/formats/dat/` | The codecs: every table in all three layouts, PyMS's texts, GRP, PCX, overlays, iscript, AI scripts, `.graft` |
| `cli/src/mod/` | The `scmjs mod` commands: the source opened, unpack, pack, info, check, diff, new, play, the engine's overlay |
