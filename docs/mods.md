# Mods

A Brood War *mod* is the game with other data: other unit tables, animation scripts,
pictures, sounds, strings and AI, and in the larger mods other code as well, through
plugins or edits to the game's program. scmJS reads mods as their makers ship them and
keeps a mod as a folder of text and pictures that you can edit with any editor, keep in
git and pack back into the files the scene's launchers load.

Everything here works on your own copy of the game and your own copy of the mod. Nothing
is uploaded, and nothing a mod carries as a program is run.

## Three ways in

**The command line.** `scmjs mod` reads a mod from what it ships as — a folder of files,
an `.mpq`, a self-executing `.exe` or a `.zip` — says what it is, unpacks it into a folder
of text, checks it, compares two versions, packs it again and hands it to the play page.
This is the part that is ready today, and the rest of this guide is mostly about it.

**The play page.** The play page at scmjs.dev/play takes a mod dropped on it, keeps the
files that differ from your game in your browser, and plays with them. `scmjs mod play`
hands a mod to it from a terminal. The play page's support for mods is new and arrives
with its next release; until then the page does not take a mod.

**The editor.** The editor makes maps for a mod through its [data
sets](game-data.md#data-sets-made-from-a-mod): Help ▸ Game Data… ▸ Add a data set… takes a
folder of the mod's archives and loose files and lays them over the game's. Its tables are
read at any width, so its new unit types are in the palette with their names and pictures,
and a map saved with it remembers the data set, which Test Map passes on. The folder holds
`.mpq` archives, a mod's self-executing `.exe` (read for its archive, never run) and the
game's paths; a mod that ships as a `.zip` is unzipped first.

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

The last two lines are [the mod's hash](#the-mods-hash).

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

### Testing with it

```sh
scmjs mod test mymod ridge.scx
scmjs map test ridge.scx --mod mymod
scmjs map trace ridge.scx --mod MyMod.mpq
```

The game engine's runners play a map with the mod's files laid over the game's. They need
an engine whose runners take a mod, which the play page's next release brings; until then
the command says which version it needs and stops.

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
- The Aftermath plugin, the editor's replay viewer, shows the mod and its link, and takes
  the names and costs from the mod's folder when you attach it.

The play page's Save Replay writes the section for a game of a mod from its next release.

### For AI tools

`scmjs mcp` has the mod commands as tools: `mod_info`, `mod_check`, `mod_diff`,
`mod_unpack`, `mod_pack` and `mod_new`. An AI tool can unpack a mod, change a table's text
and pack it again, as you would. See [AI tools](cli.md#ai-tools).

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

- Plugins (`.qdp`, `.bwl`) are kept and listed, never run, and a FireGraft file's edits to
  the game's program are not applied. Playing a mod that needs them waits for the play
  page to run a plugin's code.
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
