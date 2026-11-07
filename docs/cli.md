# The command line

`scmjs` is scmJS on the command line. It reads and writes map files with the editor's own
code, so the two agree about every map, and it does what a terminal is good for:

- **Maps.** What a map holds, Check Map over any number of maps, a new map, a search
  across maps, the Scenario menu's edits, a map's archive as a folder and back.
- **Maps in git and CI.** A map as text so `git diff` shows what changed, triggers and
  strings as files beside the map, what differs between two maps or two revisions, Check
  Map's findings as the annotations a pull request shows, commands that chain in a pipe.
- **The game.** A map's triggers run in the game itself to see which fire and what they
  cost, the distance between its start locations walked by the game's own pathing, a
  replay played in the terminal, a map drawn with the game's own graphics, a TrigScript
  map built as Save builds it, a plugin run over a map with no editor around it.
- **AI tools.** The same commands as an MCP server, so Claude Code and its like can read,
  check and change your maps.
- **Plugins and bots.** A plugin started, checked and reloaded on every save; a BWAPI bot
  of your own built for the play page and played from the terminal.

You need Node.js 22.12 or newer. Install it once, and type `scmjs` from then on:

```sh
npm install -g @scm-js/cli
scmjs info "(2)Destination.scx"
```

Or run it without installing, with `npx`, which fetches it the first time:
`npx @scm-js/cli info "(2)Destination.scx"`. Every command has `--help`, and `scmjs` on
its own, or `scmjs --help`, lists them all beside the scmJS globe.

To update an installed copy, run `npm install -g @scm-js/cli@latest`. `scmjs about` says
when there is a newer version.

## Commands

| Command | What it does |
| --- | --- |
| `scmjs info <files…>` | What a map, replay or bot file holds, whichever it is |
| `scmjs map info <maps…>` | A map's size, tileset, players, units, triggers and strings, and its check in one line; `--table` for a folder of maps |
| `scmjs map check <maps…>` | Check Map, as the editor runs it: errors first, then warnings; `--format github`, `junit` or `sarif` for CI |
| `scmjs map open <map>` | Opens the map in scmJS |
| `scmjs map new <map>` | A new map: flat ground, start locations laid out, the file written |
| `scmjs map dump <map>` | The whole map as text, for `git diff` and `grep` |
| `scmjs map find <text> <maps…>` | Edit ▸ Find across maps: units, locations, strings, triggers |
| `scmjs map fetch <words…>` | Searches scmscx.com, the community's map database, and downloads a map with `--id` or `--first` |
| `scmjs map triggers export|import` | A map's triggers as a text or `.trg` file, and back |
| `scmjs map strings export|import` | A map's strings as a text file, and back |
| `scmjs map strings prune <map>` | Drops the strings nothing in the map refers to |
| `scmjs map set <map>` | The map's name, description, revision or text encoding |
| `scmjs map resize <map>` | Scenario ▸ Resize: the map to another size, anchored |
| `scmjs map diff <a> <b>` | What changed between two maps, or since a git revision with `--rev`; `--picture` draws where |
| `scmjs map merge <base> <ours> <theirs>` | Two versions of a map merged with their common ancestor, part by part, as `git merge` does through it |
| `scmjs map build <map>` | Applies the map's TrigScript script and builds its programs into the file, as Save does |
| `scmjs map run <plugin> <map>` | Runs a plugin, or a script written like one, over the map with the plugin API |
| `scmjs map unpack <map>`, `scmjs map pack <folder>` | A map's archive as a folder of files, and back |
| `scmjs map trace <map>` | Runs the map's triggers in the game with nobody playing: which fired, how often, which never did and what said no |
| `scmjs map cost <map>` | What the map's triggers cost Remastered each frame, in milliseconds, and the costliest triggers |
| `scmjs map rush <map>` | How far apart the start locations are by ground: a unit walked by the game from each to every other, timed |
| `scmjs map preview <map>` | A picture of the map, drawn with your copy of the game's graphics: in the terminal, or as a PNG with `--out` |
| `scmjs map play <map>` | A lobby on the play page with the map, and the invite link to send around |
| `scmjs map share <map>` | A link to the map on scmjs.dev: a copy anyone can open, or with `--edit` a link to edit it together |
| `scmjs replay info <replays…>` | Who played, on which map, for how long and at what APM |
| `scmjs replay map <replay>` | The map the replay was played on, written out as a map file |
| `scmjs replay share <replay>` | A link to the replay on scmjs.dev, which anyone opens to watch it in the editor |
| `scmjs replay open <replay>` | Opens the replay in scmJS, to watch and analyse |
| `scmjs replay watch <replay>` | Plays the replay in the terminal: the minimap as the game goes, each player's figures, the chat |
| `scmjs plugin new <name>` | A plugin to start from, set up to type-check, test, build and publish |
| `scmjs plugin dev` | Opens the editor with your plugin, and reloads it each time you save |
| `scmjs plugin check` | What the editor would make of the plugin: its manifest, files and imports |
| `scmjs bot new`, `init`, `build` | A BWAPI bot of your own, built into a `.scmbot` file for the play page |
| `scmjs bot update` | The newest bot toolchain |
| `scmjs bot run <bot> <map>` | Plays the bot against the game's computers on the map, with no page |
| `scmjs init [folder]` | Sets a folder of maps up for git and GitHub: `git diff` reads maps as text, a workflow checks them on every push, a README lists them |
| `scmjs login`, `scmjs logout` | Signs in to your scmjs.dev account in the browser, and out again |
| `scmjs account` | Who you are signed in as, the storage you use and the maps you are sharing |
| `scmjs doctor` | What this computer has for each command: TypeScript, Docker, StarCraft, the game engine, the desktop app, Claude Code, the command for each thing missing, and which commands are ready |
| `scmjs about` | This version and whether there is a newer one, who made it, the desktop app and Docker if they are installed, and where the docs and source are |
| `scmjs mcp` | The map commands as an MCP server, for Claude Code and other AI tools on your computer |
| `scmjs completion <shell>` | A completion script for bash, zsh or fish |

Commands that take several files take a pattern too: `scmjs map check *.scx`. A file that
cannot be read is reported and the rest carry on.

## Maps

`scmjs map info` (or `scmjs info`) prints a map's summary:

```
Test Scenario
Triggers, a briefing, locations, a sound and unit settings.

  Map        64 × 64 · Badlands · Brood War 1.04
  File       ums.scx · 5.9 KB
  Players    2 slots used · 2 start locations
  Units      21 (14 neutral)
  Resources  12 mineral fields (18,000) · 2 geysers (10,000)
  Triggers   3 (3 conditions, 8 actions) · briefing 1 trigger
  Objects    3 locations · 0 doodads · 2 sprites
  Strings    20 of 20 · 1 sound
  Check      ▲ 1 warning

  Players
    1  Human     Terran  5 units  start location
    2  Computer  Zerg    2 units  start location
```

The map's name and description keep their colours when your terminal supports full colour.

`--table` prints one row per map instead, for a folder of them:

```
File            Name            Size     Tileset       Version         Players  Units  Triggers  Check
ridge.scx       Ridge           96 × 64  Jungle World  Brood War 1.04  2        14     0         ✔ no problems
outpost.scx     Outpost         64 × 64  Badlands      Brood War 1.04  2        21     3         ▲ 1 warning
```

`scmjs map check` lists what Check Map finds, each with where it is in the map. `--all`
adds the notes as well, and `--strict` fails a map on warnings too. The command exits with
1 when a map fails, so it can stop a build:

```sh
scmjs map check maps/*.scx --strict
```

Checks that need the game's graphics or unit data (units standing where they cannot walk,
for example) are not run here. The editor runs them once you have given it the game data.

`--format github` prints each finding as a GitHub Actions annotation, so a workflow that
checks the maps of a pull request puts them on the pull request itself, beside the file,
rather than in the job's log:

```yaml
- run: npx @scm-js/cli map check maps/*.scx --strict --format github
```

`--format junit` writes JUnit XML, one test case per map, for every CI system that takes
test results, and `--format sarif` writes SARIF 2.1.0 for code-scanning tools (GitHub's
`upload-sarif` action, for one). The exit code is the same whatever the format.

## A new map

`scmjs map new ridge.scx` writes the map File ▸ New makes: flat ground, eight open slots
and nothing else, 128 × 128 Badlands unless you say otherwise.

```sh
scmjs map new maps/ridge.scx --size 96x64 --tileset jungle --players 2
```

```
✔ maps/ridge.scx: 96 × 64 · Jungle World · Brood War 1.04 · 2 start locations · 3.0 KB
```

`--size` is the width and height, each 64, 96, 128, 192 or 256, as the New dialog offers
them; `--tileset` one of badlands, platform, install, ashworld, jungle, desert, ice and
twilight; `--name` the map's name, the file's without its extension by default, and
`--description` its description. `--players 2` lays down start locations for players 1 and
2 as Tools ▸ Auto-place would, in a ring (`--layout corners` puts them in the corners) and
closes the other slots, so the map passes Check Map as it is. `--revision remastered`
writes a Remastered revision. A `.chk` name writes the bare scenario. The command refuses
to write over a file that is there unless you pass `--force`.

Without the game's graphics the ground is written by its ids, as the editor does when it
has no game data; the map opens as it should and the editor fills the tiles' looks in when
it saves. The same arguments give the same file, byte for byte, so a map made in a build
step is the same map every time.

## Changing a map from the terminal

Three of the Scenario menu's edits that a script wants without the editor. Each writes the
map back over itself, or to `--out other.scx`, as the trigger and string imports do, and
keeps everything else in the file as it was.

`scmjs map set` is Map Properties: what is given is set, the rest is left, and nothing is
written when nothing changed.

```sh
scmjs map set ridge.scx --name "Ridge <04>2.1" --description "Final for the tournament."
scmjs map set ridge.scx --revision remastered
scmjs map set ridge.scx --encoding euc-kr
```

A name or description reads `<XX>` as the game's colour codes, as the string files do.
`--revision` is one of original, hybrid, broodwar, remastered and remasteredHybrid, and
changes what the editor's revision change does; `--encoding` is how the map's text is
written for 1.16.1 (utf-8, euc-kr, shift_jis, gbk, big5, windows-1251 or windows-1252),
where Remastered reads UTF-8.

`scmjs map resize ridge.scx --size 128x96` is Scenario ▸ Resize. `--anchor` says which
part of the map stays (center by default; top-left, top, top-right, left, right,
bottom-left, bottom or bottom-right), what falls outside the new edge is dropped and said,
and locations that hang past it are pulled inside unless you pass `--no-clamp`. New ground
is the tileset's base terrain.

```
✔ ridge.scx: 96 × 64 → 128 × 96 · written to ridge.scx · 4.1 KB
```

`scmjs map strings prune ridge.scx` is the string editor's Delete Unused: a string no
trigger, location, name, force, sound or setting refers to is blanked, and the blank slots
at the end of the table dropped. Nothing is renumbered, so what the triggers hold stays
right. `--dry-run` lists what would go and writes nothing.

## Triggers and strings as files

A map's triggers and strings can live beside it as text — in version control, where a
change shows as a diff; in any editor, for a search-and-replace across a hundred triggers
— and go back in.

```sh
scmjs map triggers export mymap.scx > triggers.txt
scmjs map triggers import mymap.scx triggers.txt
```

`export` prints the triggers in the text form the editor's trigger window uses (the
[trigger reference](triggers.md) gives every condition and action in it), or writes them
with `--out`; a name ending in `.trg` writes the raw records instead, the file SCMDraft's
Export Triggers makes and reads. `--briefing` does the mission briefing's triggers.
`import` replaces the map's triggers with the file's, or adds them after the map's own
with `--append`, and writes the map back over itself — or to `--out other.scx`. Text the
map cannot resolve, a condition it does not know or a location it does not have, is
refused with its line, and nothing is written.

```sh
scmjs map strings export mymap.scx > strings.txt
scmjs map strings import mymap.scx strings.txt
```

Strings are one line each: the string's number, a tab, its text, with the game's colour
codes written as `<XX>`. Importing sets the numbered strings in place and adds any past
the end; nothing is renumbered, since the map's triggers and locations hold the numbers. A
`#` starts a comment.

A map written back keeps everything else — its sounds and other files, and the way the
scenario was compressed — as Save does in the editor.

## A map as text, and in git

`scmjs map dump ridge.scx` prints the whole map as text: the header, the players and
forces, every unit and location, the triggers in the trigger window's text form, the
strings as `map strings export` writes them, the archive's other files with their sizes
and hashes, and the sections with their sizes. Nothing is cut. It is one stable form of
the map, the same twice over for the same file, so it can be searched with `grep`, kept
beside a map for reading, or given to git.

```
# ridge.scx — scmjs map dump 1

## Map
  Name         Ridge
  Size         96 × 64
  Tileset      Jungle World
  …
## Units (14)
  Start Location  Player 1  336,1744
  Mineral Field (Type 1)  Neutral  176,1552  resources 1500
  …
## Triggers (3)
Trigger("Player 1"){
Conditions:
	Always();
…
```

A map file is binary, so `git diff` says only that it changed. Told to read maps through
this command, git shows what changed in them instead, in `git diff`, `git log -p`,
`git show` and the pull requests of tools that honour `.gitattributes`.
[`scmjs init`](#a-maps-folder-as-a-project) sets this up, or by hand, once in the
repository:

```sh
git config diff.scmjs.textconv "scmjs map dump"
git config diff.scmjs.xfuncname "^## .*"
printf '*.scx diff=scmjs\n*.scm diff=scmjs\n*.chk diff=scmjs\n' >> .gitattributes
```

```
$ git diff
--- a/ridge.scx
+++ b/ridge.scx
@@ -100,7 +100,7 @@ ## Strings (20)
   2	Hold the base.
-  3	Force 1
+  3	Renegades
   4	Force 2
```

The second line makes each hunk's heading the part of the map it is in. Earlier versions
of this page gave it as `"^## "`, which puts a bare `##` there; `scmjs init` replaces that
value. `git config diff.scmjs.cachetextconv true` keeps the text of each version so a long
`git log -p` does not read every map again. The `.gitattributes` lines are committed, so
everyone who clones gets them; the two `git config` lines are per clone (`--global` sets
them for every repository on your computer). `--json` gives the same data as JSON, with
the units and triggers as the records the editor holds.

## A maps folder as a project

`scmjs init` sets a folder of maps up so that git and GitHub look after it, in one
command. Run it in the folder, or name the folder (the files' paths are from it):

```
$ scmjs init maps
maps · 5 maps · in the git repository ladder
  ✔ .gitattributes                 written: maps diff as text and merge part by part
  ✔ .gitignore                     written: the .bak files Save leaves
  ✔ ../.github/workflows/maps.yml  written: checks the 5 maps on push and pull request; scmjs 0.9.0
  ✔ README.md                      written: lists the 5 maps, and the commands
  ✔ git config diff.scmjs          set: textconv, xfuncname, cachetextconv
  ✔ git config merge.scmjs         set: name, driver
ℹ The workflow is at the repository's top, where GitHub reads it, and checks maps/ from there.
```

What each file does:

- **`.gitattributes`** has git read `.scx`, `.scm` and `.chk` files through
  `scmjs map dump`, so `git diff` and `git log -p` show what changed inside a map (see
  [the section above](#a-map-as-text-and-in-git)), and merge them through
  `scmjs map merge`, so two branches that changed one map in different places merge (see
  [Merging two versions of a map](#merging-two-versions-of-a-map)).
- **The git settings** (`diff.scmjs.textconv`, `.xfuncname`, `.cachetextconv`, and
  `merge.scmjs.name` and `.driver`) tell git what that means. They belong to each clone
  rather than to the repository, so they are set in the repository the folder is in;
  everyone who clones it runs `scmjs init` once too, which writes nothing that is there
  already. `git diff` and `git merge` run `scmjs`, so it has to be installed
  (`npm install -g @scm-js/cli`); the command says so when it is not.
- **`.github/workflows/maps.yml`** runs `map check --strict --format github` over the maps
  on every push and pull request, so a map with errors or warnings fails the run and each
  finding shows on the pull request beside the map. A map that keeps a TrigScript script
  also gets `map build --check`, which compiles the script against the map and writes
  nothing. The workflow names this version of `@scm-js/cli`, so a run gives the same
  answer until you change the version in the file, as its first lines say. GitHub reads
  workflows only at a repository's top, so for a folder inside a repository the file goes
  there and names the folder's maps from it.
- **`README.md`** lists the maps (name, file, size, tileset, players) and the commands
  people reach for: `map check`, `map dump`, `map diff --rev HEAD` and settling a merge
  with `map merge`, and the git settings a new clone needs.
- **`.gitignore`** has `*.bak`: the copy of a map the desktop app keeps when Save replaces
  it. The commands themselves write a map back in place or where `--out` says, so they
  leave nothing else behind.

Nothing is overwritten. `.gitattributes` and `.gitignore` get only the lines they lack, at
the end; a `README.md` or workflow that is there is left as it is, and so is a git setting
that holds another value. Each is said on its own line. `--force` replaces the README and
the workflow and sets the git settings; it never takes a line out of the other two files.

In a folder that is not in a git repository, the files are written and the git settings
are not: run `scmjs init` again after `git init`, or give `--git` to have the command run
`git init` there first. It never runs `git init` without being asked.

`--print` writes nothing and prints every file and the `git config` lines instead, for
pasting by hand or reading first. `--json` lists the files and what became of each (with
their text, given `--print` as well). The command exits with 2 when there is no such
folder.

`scmjs help init` has the command's help.

## Searching maps

`scmjs map find <text> <maps…>` is Edit ▸ Find over any number of maps: a unit, location,
sprite or doodad whose name holds the text, a string or a trigger whose text does, and a
number matches a unit id, location slot, string number or trigger number too.

```sh
scmjs map find "Marine" maps/*.scx
```

```
ums.scx  4 matches
  unit     Test Marine  Player 1 · 14, 50
  string   Test Marine  String #13
  string   Bring a Marine to the middle.  String #17
  trigger  Trigger 1  Bring a Marine to the middle.
```

`--in strings,triggers` searches only those kinds (of units, locations, sprites, doodads,
strings, triggers and briefing), and `--case` matches case. A map with no match prints
nothing. The command exits with 1 when nothing matched in any map, like `grep`, so a
script can ask whether any map still says something.

## Maps from scmscx.com

[scmscx.com](https://scmscx.com) is the community's map database: years of StarCraft maps
that people have shared, searchable by name, description and file name. `scmjs map fetch`
searches it and downloads from it. The maps are their makers', and the site's; scmJS only
asks the site, the way its own pages do.

```sh
scmjs map fetch lost temple
```

```
scmscx.com · 2,918 files match "lost temple" · the best 10 maps

  Name                           Size       Tileset       Players  Downloads  Id
  (The Lost Temple 8 Players)    128 × 128  Jungle World  8        246        GDj6p383
  PGT - Lost Temple 2.4 [02]     128 × 128  Jungle World  4        170        B8V7fdyj
  PGT - Lost Temple 2.35 [01]    128 × 128  Jungle World  4        35         jVYB3rBz
  …
```

The list is the site's own order of best matches, a map once however many file names it
was uploaded under. `--limit 25` lists more (up to 50), and `--json` gives the list to a
script. When nothing matches, the command says so and exits with 1.

To download one, give its id, or the map's address on the site, with `--id`; `--first`
downloads the best match for the words instead:

```sh
scmjs map fetch --id B8V7fdyj
scmjs map fetch lost temple --first --out maps/
scmjs map fetch lost temple --first --open
```

The file is named as the site names it, with the characters Windows does not allow in a
file name made `_`, and is written into this folder, or the file or folder `--out` names.
A file that is there already is left alone unless you add `--force`. Before anything is
written the map is opened as the editor opens it, and the command says what it is, as
`map info` begins:

```
PGT - Lost Temple 2.4 [02]
  Map   128 × 128 · Jungle World · StarCraft 1.00
  File  (4)Lost Temple 2.4 PGT.scm · 172 KB
  From  https://scmscx.com/map/B8V7fdyj · uploaded by anonymous · 170 downloads
✔ Written to (4)Lost Temple 2.4 PGT.scm
```

What the site sends that is not a map is refused, and nothing is written. `--open` opens
the map in scmJS once it is written, as `scmjs map open` does, and `--out -` sends it down
a pipe instead of into a file:

```sh
scmjs map fetch lost temple --first --out - | scmjs map info -
```

The command waits ten seconds for the site at most, and says so when the site does not
answer or turns the request down (exit 1). Nothing is kept between runs: each search asks
the site again. A search asks the site once for the list and once more for each map's
details, which is why the list stops at 50.

## Comparing two maps

`scmjs map diff a.scx b.scx` says what changed between two maps, in a map maker's terms:
the name, size, tileset and version; each player's type, race, colour and force; units and
locations added or removed; triggers and briefing triggers added or removed, each on one
line; strings added, removed or changed; the archive's other files; and, underneath, which
sections of the scenario differ at all.

```
old.scx → new.scx

Map
  ~ Name           Ridge → Ridge, revised

Triggers +1 −1
  − Player 1: Bring("Player 1", "Terran Marine", "Middle", At least, 1) → Victory()
  + Player 1: Bring("Player 1", "Terran Marine", "Middle", At least, 4) → Victory()

Strings ~1
  ~ 7  Hold the base. → Hold the base. Reinforcements at 4:00.

Sections
  ~ STR   355 B → 371 B
  ~ TRIG  7.0 KB → 7.0 KB
```

A trigger that changed shows as the old one removed and the new one added. Long lists are
cut at twenty; `--all` lists everything. The command exits with 1 when the maps differ and
0 when they are the same, like `diff`, so a script can ask whether a step changed
anything.

`--rev` compares a map with the version git has of it, so one command says what a commit
changed in a map, or what is not committed yet:

```sh
scmjs map diff --rev HEAD~1 maps/ridge.scx     # what the last commit changed
scmjs map diff --rev main maps/ridge.scx       # what this branch changed
```

The map is read through `git show` at that revision, so this works wherever `git diff`
does; a file that is not in a repository, or not at that revision, is refused with git's
own words.

`--picture` shows where the map changed rather than what. It draws the second map as
[`map preview`](#a-picture-of-a-map) does, with your copy of StarCraft, the ground that
did not change darkened: tiles that changed are tinted magenta, units added are green
boxes, units removed red ones, and a unit moved a few tiles (the same type and owner) is a
yellow box with a frame where it was and a line between them. A unit edited where it stood
is yellow too. Locations that changed are outlined: green when added, red where one was,
yellow where it is now. When one map was resized, the tiles only one of them has are
striped grey. Start locations, mineral fields and geysers are drawn for finding your way,
with start locations and geysers in greys so their colours do not read as changes. Under
the picture a line counts it all:

```
a.scx → b.scx  128 × 128 · twilight · StarCraft: Remastered 1.23.10.13515
..$M$$$.............::::::::$M$:RR:::::::::::::...     ..:$$$$$:
.$$:@@MM........ .....:::::$$::::::::::::::....     ..:::..::.$$
...:@@MM.......    .::.::::::::::::::::::.....    ...:::...AA...
  …
. $$$$$.. ....:::....  ....:$$xxx::$$:... .....:::..............
.$$.3@  .......:::.........:$$:::::::.....   ...:::::......1@.$$
  …
A +3 units  R −1 units  M ~3 units moved  x ~24 tiles  # ~0 locations
```

That is the form without colour, where the letters stand for the marks: `A` added, `R`
removed, `M` moved or edited, `x` a changed tile, `/` a tile only one map has, `#` a
location. In colour it is the picture itself, two pixels a character as `map preview`
draws it. `--out diff.png` writes a PNG at `--scale` pixels a tile (4 by default), and
`--side-by-side` puts the first map, the changes and the second map in one picture,
`a | changes | b` — in the terminal too when it is wide enough for three pictures of 32
columns, else the changes alone. `--json` adds what was drawn to the comparison: how many
tiles, units and locations changed, and the box of tiles round the changed ones.

```sh
scmjs map diff old.scx new.scx --picture
scmjs map diff --rev main maps/ridge.scx --picture --side-by-side --out review.png
```

Tiles are compared by position, so a map resized with its content moved to another side
shows every tile as changed. Maps of two tilesets cannot be drawn as one picture: they are
drawn side by side with nothing marked, and the command says so. The exit code is the
comparison's, 1 when the maps differ, picture or not.

## Merging two versions of a map

When two people change copies of one map, `scmjs map merge` puts both sets of changes into
one map, the way `git merge` puts two versions of a text file together. It takes three
files: the version both started from (the common ancestor, or *base*), yours (*ours*) and
the other one (*theirs*):

```
$ scmjs map merge ridge-base.scx ridge.scx ridge-alex.scx
✔ ridge.scx merged: 3 changes from ours, 2 from theirs · written to ridge.scx
  Units      2 from ours
  Locations  1 from theirs
  Triggers   1 from ours, 1 from theirs
  Strings    1 string of theirs renumbered
```

Each part of the map is compared with the base on both sides. What only one side changed
is taken from that side; what both changed the same way is taken once; what both changed
differently is looked at more closely, and is a conflict only where the two changes really
are to the same thing:

| Part | Merged | A conflict when |
| --- | --- | --- |
| Terrain | Tile by tile (and the isometric record and fog of war the same way) | Both changed the same tile differently; the tiles are listed as rectangles |
| Units, doodads, sprites | One by one. They have no names, so each is matched by what it is: its type, owner, place and properties. A unit removed and one of the same type and owner added within four tiles is one unit moved or edited | Both edited the same unit differently, or one side removed a unit the other edited |
| Locations | By number, and the place, the elevation flags and the name each on their own | Both changed the same field of one location differently |
| Triggers, briefing | As an ordered list: triggers either side added are kept (both, when both added at one place), and triggers either side changed or removed are changed or removed | Both changed the same trigger differently, or one side removed a trigger the other changed |
| Players, forces, unit, upgrade and technology settings, unit properties, switch names, sounds | Field by field: one player's race, one unit's hit points, one force's name | Both changed the same field differently |
| Name, description, revision, text encoding | Each on its own | Both changed it differently |
| Size and tileset | When either side resized the map or changed its tileset, the terrain and everything on it come from that side | Both sides changed the terrain or what is on it, and one of them resized the map or changed its tileset |
| The archive's other files (sounds, scripts) | File by file | Both changed the same file differently |
| Sections the editor does not read | Section by section, compared as bytes | Both changed the same section |

Triggers are matched by what they say, with their text read as text: two maps number their
strings differently, and the same trigger still matches. A location is named in a trigger
by its number, so renaming a location on one side does not count as changing every trigger
that mentions it.

Strings go where what uses them goes. A string theirs changed in place keeps its number in
the merged map; a new string of theirs keeps its number unless ours put another string
there, and then it takes a free one, and the trigger, location or setting that uses it is
changed to match. That is the "renumbered" line above. Strings nothing in the map uses are
merged by number.

Everything the merge did not change is written exactly as it was in your version, and the
file is written as your version was (compressed and encrypted the same way).

### Conflicts

When both sides changed one thing differently, the command says what each side did, writes
nothing, and exits with 1:

```
$ scmjs map merge ridge-base.scx ridge.scx ridge-alex.scx
✖ ridge.scx: 1 conflict; nothing written
  Triggers  1 from ours, 1 from theirs

Conflicts
  Triggers · trigger 1 of the base
      base   Player 1: Always() → Display Text Message(Always Display, "Hold the line.")
      ours   Player 1: Always() → Display Text Message(Always Display, "Hold fast.")
      theirs Player 1: Always() → Display Text Message(Always Display, "Stand firm.")

Add --ours or --theirs to settle each with that side's version.
```

`--ours` or `--theirs` settles every conflict with that side's version and writes the map;
everything that did not conflict is still merged from both. The conflicts are listed
again, marked with the side taken. To settle some one way and some the other, merge with
one of them and change the rest in the editor afterwards.

The merged map is written over your version (the second file), as `git merge-file` does
and as git expects of a merge driver; `--out` writes it somewhere else instead, and
`--out -` to standard output. When only one side changed the map at all, that side's file
is taken exactly as it is. `--dry-run` says what would happen and writes nothing. `--json`
gives the result as JSON: each part's changes, and each conflict with what the base, ours
and theirs had.

### With git

[`scmjs init`](#a-maps-folder-as-a-project) makes the command git's way of merging maps,
or by hand, once in the repository:

```sh
git config merge.scmjs.name "StarCraft maps, part by part (scmjs map merge)"
git config merge.scmjs.driver "scmjs map merge %O %A %B --out %A --name %P"
printf '*.scx merge=scmjs\n*.scm merge=scmjs\n*.chk merge=scmjs\n' >> .gitattributes
```

After that, `git merge`, `git pull` and `git rebase` merge maps that both branches
changed. A map with no conflicts is merged and the merge goes on. A map with a conflict
stops the merge as a text file would: git says
`CONFLICT (content): Merge conflict in ridge.scx`, the command's list says what clashed,
and the file is left as your version. Settle it with the map's name alone, which reads the
three versions git keeps during the merge, then carry on as usual:

```sh
scmjs map merge ridge.scx            # the conflicts again
scmjs map merge ridge.scx --theirs   # settled, and written over ridge.scx
git add ridge.scx
git commit
```

Without the setting, git cannot merge a map at all, and a map both branches changed is
always a conflict. Like `git diff`, `git merge` runs `scmjs` by name, so it has to be
installed in each clone (`npm install -g @scm-js/cli`).

What the merge does not do: it cannot lay one side's terrain over a map the other side
resized, so both changing the ground of a map one of them resized is a conflict over the
whole size. Triggers that a TrigScript script generates are merged as triggers; when both
sides changed the script, its files conflict, and the map should be built again
(`scmjs map build`) once the script is settled. A built map is merged as the map it was
built from and written that way: build it again after merging.

## Building a TrigScript map

A map with a [TrigScript](trigscript.md) script in it is built every time the editor saves
it: the script's `trigger()` calls become triggers in the list, and its `program()`s are
built into the file. `scmjs map build` does the same without the editor, so a map kept in
git can be built where it is checked, and a script edited outside the editor can be
applied from the terminal:

```sh
scmjs map build maps/ridge.scx --test
```

```
✔ ridge.scx: 12 triggers → #4–#15 · 2 programs (Remastered) · 7 tests passed · written to maps/ridge.scx · 48 KB
```

The script is the one the map keeps, with the libraries the map keeps copies of; the map's
names, settings and placed units are what the editor would compile against, and the built
file opens in the editor as the map you were editing, with the build kept beside it,
exactly as a saved one does. `--out` writes the built map to another file. `--test` runs
the script's tests first, in the simulator, and a failing test refuses the build; a map
whose script settings make tests guard the build runs them without the flag. `--check`
compiles, and tests with `--test`, and writes nothing: the check for a pull request. An
error in the script is printed as `main.ts:12:5 error …`, a failing test with its name and
line, and the command exits with 1 with nothing written.

The compiler is TrigScript's own, at the version the editor of this release ships, so the
command and the editor build the same map. It compiles with TypeScript, which is not part
of the command: install it in the map's project (`npm install typescript`) or globally
(`npm install -g typescript`). A sound of two seconds or more is encoded as Ogg Vorbis
with an encoder the command fetches once, unless the project has `wasm-media-encoders`
installed. Two things the editor does that the command does not. The tests' world takes a
unit type's hit points from the map's own settings; the game's unit data, which the editor
reads for the types a map leaves alone, is not on the command line, so a test that counts
on a Marine's forty should set them in the map. And the programs other plugins contribute
to a build are not built here: a map with Magenta's triggers is refused, and is built by
saving it in the editor.

## Running a plugin over a map

`scmjs map run` gives a plugin the editor's [plugin API](plugins.md) with a map open and
no editor around it. The plugin is a folder with a `plugin.json`, the manifest itself, a
single script file, `github:owner/repo`, or a URL — whatever Plugins ▸ Add takes, and a
file on your disk too. A script is a file exporting `activate(api)`, like a plugin's
entry, so a few lines that read or change a map need no plugin around them:

```js
// starts.mjs
export default (api) => {
  const starts = api.document.scenario().units.filter((u) => u.unitId === 214);
  api.ui.status(`${api.document.info().name}: ${starts.length} start locations`);
};
```

```sh
scmjs map run starts.mjs "(4)Fighting Spirit.scx"
scmjs map run ../plugin-repair maps/ridge.scx --command repair --dry-run
```

What the plugin would have shown is printed as it happens: its status line, its toasts and
the warnings and errors in its log. Dialogs and panels register and show nothing, and
asking for a file answers none. `--command <id>` runs one of the commands the plugin
registered after it started, with `--arg` values as its arguments; what the command
returned is in `--json`. The map is written back only when the plugin changed it (`--out`
writes it elsewhere, and writes even an unchanged map), and the closing line says what
changed in the terms of `map diff`. `--dry-run` prints that comparison in full and writes
nothing. A plugin that is TypeScript source needs TypeScript installed, as `map build`
does; a built plugin or a JavaScript script needs nothing more.

This is the editor's own plugin host, so a plugin's logic runs here exactly as it does in
the editor and a plugin can be tried from a terminal, or run over many maps from a shell
loop, before anyone installs it. Saving is the command's job rather than the plugin's:
`api.document.save()` has no file picker to open here.

## A map as a folder

A map file is an archive: the scenario, `staredit\scenario.chk`, beside its sounds, a
TrigScript script's files and whatever else was put in. `scmjs map unpack` writes those
members into a folder at their archive paths, and `scmjs map pack` puts the folder back
together:

```sh
scmjs map unpack ridge.scx            # → ridge/staredit/scenario.chk, ridge/staredit/wav/…, ridge/archive.json
scmjs map unpack ridge.scx --list     # the members and their sizes, nothing written
scmjs map pack ridge                  # → ridge.scx again, beside the folder
```

`archive.json` in the folder records what the files cannot: the map's name, how the
scenario was compressed and whether it was encrypted, whether the archive carried a file
list, and the members a protected map keeps without a name, which go under `stored/` byte
for byte. Pack writes the archive as the manifest says, so an unpacked and repacked map
reads the same in the editor and the game. A file you add to the folder goes in as a
member at its path — a sound dropped into `staredit/wav/`, a script's file under
`trigscript/` — and `--compression none|pkware|zlib` changes how every member is stored.
`--out` names the folder, or the file, to write.

Nothing is parsed or restored on the way, which is the point: the folder is the file as it
is. A map the editor built from a TrigScript script unpacks into its built scenario and
the `scmjs/` members holding the source, and packs back into the same built map. The
packed file is opened as a map before it is written, so a folder whose scenario is not one
is refused rather than written.

## Playing the game: what those commands need

`map trace`, `map cost`, `map rush`, `replay watch` and `bot run` run the game itself, and
`map preview` draws with its graphics. They need two things on your computer, and nothing
on a build server:

- **The game engine**, the play page's, about 25 MB, fetched from scmjs.dev the first time
  a command needs it and kept in your cache folder (`~/.cache/scmjs` on Linux, the
  equivalent elsewhere; `SCMJS_CACHE` moves it). Each command drives it with a runner of
  its own, and a copy fetched before the play page had a runner is completed the next
  time. `map preview` needs no engine.
- **Your own installation of StarCraft**, Remastered or 1.16.1, for the game's own files:
  found in the usual places, or named with `--starcraft <folder>` or `SCMJS_STARCRAFT`.
  Nothing of the game is fetched or carried.

`scmjs doctor` says whether both are there, and what to do when one is not.

## Running a map's triggers in the game

`scmjs map trace` starts the map in the game itself, as a Use Map Settings game with your
seat left idle and the computers as the map has them, runs it for a number of frames, and
notes every condition the game asks and every action it runs. The report is one line per
trigger — how often it fired, when first and last, whose it is — then the triggers that
never fired, each with the condition that said no last:

```
ums.scx 64 × 64, badlands · 3 triggers · seed 1 · Remastered files
  frame    600  20 passes of the triggers
  …

✔ ums.scx: 3 triggers · 2,400 frames (1:40 of play) · 78 passes · 1 fired · 2 never · 1.9 s

  #  Fired  First  Last  Players  Trigger
  1  1      2      2     P1       Always() → Display Text Message(Always Display, "Hold the base."); Play WAV("st…
  2  0      –      –     P1       Bring("Player 1", "Terran Marine", "Middle", At least, 1) → Create Unit with Pr…
  3  0      –      –     P1       Switch("Alarm raised", set) → Victory()

  Never fired (2 of 3)
  ▸ #2  Bring("Player 1", "Terran Marine", "Middle", At least, 1) → Create Unit with Properties("…
      Bring (condition 1) said no last, at frame 2,389
  ▸ #3  Switch("Alarm raised", set) → Victory()
      Switch (condition 1) said no last, at frame 2,389
```

The game runs the triggers once every two seconds or so (a pass), and a trigger that runs
every pass is a preserved one. A count with `+n` after it is a trigger whose Wait held it
and let it go on `n` times. `--frames` is how long to run (24 frames a second; the default
2,400 is 100 seconds of play, and the game may end sooner if a trigger ends it); `--seed`
fixes the game, so the same map and seed give the same run; `--all` lists every trigger
when the map has more than forty. `--json` has the same per trigger as data. Nobody plays,
so what a player would do never happens: a trigger waiting for a unit to be brought
somewhere will say so, which is the point.

`scmjs map cost` runs the map the same way and weighs every trigger the game passes and
every condition and action it runs, as StarCraft: Remastered charges for them — the model
TrigScript's editor uses, measured on the real game, where a Deaths condition costs about
five nanoseconds and the game stays smooth up to about fifteen milliseconds of triggers a
frame. It says what a frame costs on average where the triggers ran and at the most, how
that sits against what a frame can carry, and which triggers cost the most:

```
✔ trigscript-frame-cost.scx: triggers cost 0.025 ms a frame on average where they ran (599 of 601 frames), 1.10 ms at the most (frame 2: 83,787 records, 53,192 triggers)
  Remastered on a fast computer: smooth to about 15 ms of triggers a frame, slows past 37 ms
  83,787 of the records ran in no trigger of the map — a program's own (TrigScript, eudplib), 1.10 ms in all
```

A TrigScript or eudplib program runs its own records through the EUD trigger chain rather
than through the map's trigger list, so for such a map the cost is in the first lines and
the triggers listed are only the ones that start the program; TrigScript's own editor
shows a program's cost line by line.

A map in the original StarCraft 1.00 form is run as Brood War, as the editor would convert
it; the Blizzard campaign maps are not something the engine runs yet. Exits 2 when the
game could not start.

## How far apart the start locations are

`scmjs map rush` measures how long a rush takes between each pair of start locations. The
game itself walks a unit from each start location to every other, by the way a unit sent
there in a game would take, and times each walk. An SCV is walked unless you name another
unit with `--unit`, by its name in the editor (`"Zerg Zergling"`), without the race
(`Zergling`, `Dragoon`) or by its number in units.dat. The table has the starts as rows
(walked from) and columns (walked to), each with where it is on the map as a clock face
from the middle:

```
$ scmjs map rush "(4)Fighting Spirit.scx" --unit Zergling
(4)Fighting Spirit.scx 128 × 128, jungle · 4 start locations · a Zergling walked 12 times · Remastered files
  1 → 2  4,722 px, 38.0 s
  …

✔ (4)Fighting Spirit.scx: a Zergling walked between 4 start locations by the game · 12 walks · 4.0 s

  from ╲ to                    1                 2                 3                 4
  1 1 o'clock                  –  4,722 px, 38.0 s  5,553 px, 45.7 s  4,543 px, 37.0 s
  2 11 o'clock  4,793 px, 38.6 s                 –  4,674 px, 37.3 s  5,658 px, 45.4 s
  3 8 o'clock   5,560 px, 45.0 s  4,875 px, 39.1 s                 –  4,697 px, 37.7 s
  4 4 o'clock   4,596 px, 37.4 s  5,770 px, 45.9 s  4,686 px, 37.6 s                 –

  Shortest 1 → 4: 4,543 px (142 tiles), 37.0 s · air 3,520 px, 1.29× the straight line
  Longest  4 → 2: 5,770 px (180 tiles), 45.9 s · air 5,001 px, 1.15× the straight line
```

The pixels are what the unit walked (32 to a tile) and the seconds are game time at
Fastest. The unit sets out five tiles from its start toward the middle of the map and
stops at the edge of the town hall at the other start — a neutral Nexus stands on every
start while the walks run, so the way ends where a real rush ends, at the base. The two
directions between a pair can differ by a second or so: the way out of each base is not
the same. The shortest and longest walks are set beside the straight line between the two
start locations, the distance a flyer goes. When the terminal is too narrow for both
figures, the seconds and the pixels come as two tables.

A walk that does not arrive is a finding too. Two starts with no ground between them — an
island map, or ground the terrain walls off — are said to have no way; on a map where no
two starts are joined, the report says so and lists the straight lines instead. A unit
that stops short (a wall of minerals or buildings the map places, say), stands stuck, or
is still walking after seven minutes of game time is named with how far from the base it
ended.

The walks run in one game, with nobody else in it; about four seconds for a four-player
map and fifteen for an eight-player one of 256 × 256. `--seed` changes the game's luck (a
unit stepping round another); the default is the one the editor's Walkability plugin uses,
so the two agree. `--json` gives every walk and the matrix as data. A building or a flyer
is refused (exit 2), as is a map with fewer than two start locations. Like `map trace`, it
needs the game engine and your own copy of StarCraft ([what those commands
need](#playing-the-game-what-those-commands-need)); a map in the StarCraft 1.00 form is
walked as Brood War.

## A picture of a map

`scmjs map preview` draws the map with the game's own tileset graphics, read from your
copy of StarCraft. Only the map's own tileset is read, in a fraction of a second, and
nothing of the game is fetched or kept. Without a copy there is no picture: the command
says so, and how to name one.

Over the terrain go the things the minimap shows: a box for each unit in its owner's
colour, as big as the unit is when placed; mineral fields in blue and geysers in green;
the start locations framed in their slot's colour. `--no-units` draws the terrain alone.

In the terminal the picture is as wide as the terminal, at most two columns a tile, and a
map taller than it is wide is drawn no more rows high than half the terminal's columns.
`--width 60` sets the columns, or `--scale 0.5` half a column a tile. Each character is
two pixels, one above the other, in 24-bit colour where the terminal says it has it
(`COLORTERM=truecolor`) and in the nearest of 256 colours where it does not, and a start
location is its player's number. A terminal with no colour, or one that cannot draw the
block characters (the old Windows console), gets letters instead: shades for the ground,
`#` for a building, `o` for a unit, `$` for a mineral field or geyser. kitty and iTerm2
can show a picture themselves and are sent the PNG; `--blocks` asks for the characters
there too. Without colour, a 96 × 96 ice map at `--width 56` looks like this:

```
Ice Floes  96 × 96 · ice · StarCraft: Remastered 1.23.10.13515
%*%=:-.-++***-:+@$$$$$@@%==+.   o  ::.=*@@@@%@*@@@@@@@@@
%+: .-==**+-+=%$$@@1=@@@@@+-+:.     .:.:+%@%@%%*%@%=@@@@
%=-+==+=+=-%%@@@@@@==@@@@@@@@%+=-:    ..   ....:-*@@@@@@
*=-++==-=-=@@@@@@@@@@@@@@@@@@@%.==.     .=***+.:--=%@@%@
      .:..=%@@@@@@@@@@@@@@@@@%: :       ::-=+.    :..:--
--=+=:..==:%@@@@@@@@@@@@@@%*+: +=-:==.              .:-=
*$$$$$$+*+-:+*%@@@@@@@%%%: ===*****++:     -+=+===-
  …
                    ---+@%@@@@@@@@@@@@@@@@@@@@%=:+*+:=*@
++=-. .o .-=++=-:-.      :++-*@@@@@@2-@@@@@@@@@+:.++=: +
%%=+*****+*%@@%***==-  :=+**-+@@$$@@--@@@@@@@*-..*+:-+*@
%+%%*%@%@@*@@*%%@@@===.  .+-.+%@@@@$$$@$@@@*= -+-+=:+@@@
P1  P2  neutral  $ minerals  $ gas  numbers: start locations  # buildings, o units
```

`--out ridge.png` writes a PNG instead, at `--scale` pixels a tile: 1, 2, 4 (the default,
so a 128 × 128 map is 512 pixels square), 8, 16, or 32, the game's own size. `--out -`
writes the PNG to standard output, with what the command says going to standard error, and
`-` as the map reads it from a pipe:

```sh
scmjs map preview ridge.scx --out ridge.png --scale 8
scmjs map new - --tileset ice --players 4 | scmjs map preview - --out - > new.png
```

`--json` describes the picture without drawing it: its form, size and scale, the tileset,
the copy of the game it came from, and how many start locations, units, buildings, mineral
fields and geysers are on it.

## A game on the map, with other people

`scmjs map play ridge.scx` opens scmjs.dev/play in your browser with the map and asks it
for a lobby. The page is the host, as it is when you press Invite Players there, and the
link it makes is printed in the terminal for you to send around:

```
ℹ Opening ridge.scx in the play page in your browser
✔ Lobby open: send this link to the people you want to play with
  https://scmjs.dev/play/?game=invite1x4hunfg
✔ Handed to the play page
```

Opening a lobby needs a scmjs.dev account, so the page asks you to sign in when you are
not, and opens the lobby once you have; the first time, it asks for the game's files too,
as the play page always does. The people you send the link to need their own StarCraft
files and no account. The command waits up to five minutes for the page, and `--json`
prints the link, the invite code and what the page said on the way.

## Replays

`scmjs replay info` reads a replay from any version, from 1.16 to Remastered. It shows the
players in their colours with race, APM and team, the map, the game's length and speed,
when it was played, and how much chat there was. APM is counted the way the replay viewer
counts it: everything a player did except chat, until they left.

`scmjs replay map game.rep` writes out the map the replay was played on: a replay carries
the scenario the game loaded, whole, so the map is there whether or not you still have the
file. It goes beside the replay with its name and `.scx`, or to `--out`, as a bare `.chk`
or an archive like a new map's, and opens in the editor like any map. Only the scenario is
in a replay: a map's sounds and other files are not, so Check Map may say a sound is
missing. `--out -` pipes it: `scmjs replay map game.rep --out - | scmjs map info -`.

### Watching a replay

`scmjs replay watch game.rep` plays the replay in the terminal. The game is the play
page's engine, and the replay plays in it as the game itself plays it; what you see is a
minimap redrawn as it goes, a dot for every unit in its player's colour, buildings as
blocks, mineral fields and geysers dim, and the ground shaded where the terminal has
24-bit colour. Under it: the clock and frame, a line per player with minerals, gas,
supply, units alive and APM so far, and the last three lines of chat as they were said.
Space pauses, `+` and `-` double and halve the speed, `q` stops and leaves the last
picture on screen.

```
legacy_cp949.rep 128 × 128 · jungle                  8:09 frame 11,643  8×
 ⡀ ⠐             ⠐  ⡠⠐⠔⠐⠄⠡                       ⠄⡀⠈⠄
⠨⡂                ⠄      ⠈            ⢀          ⡁⡀ ⡈⡐⣸⡂
⠈⠦                                  ⢴⡇⡄          ⠄  ⢨ ⡾⠂
                                    ⠱⠄⡠⠁
  …
⠰⡣⠲⠠⠂  ⡠          ⢀⠞                                  ⠰⡂
⠈⢯⠈⢀⠂⡀           ⠁                  ⠠                 ⢨⠂

■ Question  P  270/211  78/98  75 units  293 APM
■ Drywater  T  273/308  38/58  51 units  237 APM
```

`--speed 4` plays at four times the game's Fastest (8 by default; the engine runs a
ten-minute game in a few seconds, so any speed holds), `--from 6:30` starts there, and
`--size 80x30` sets the picture's size in characters, where by default it fills as much of
the terminal as the map's shape allows. Into a pipe or a file there is no picture: a line
per player every minute of game (`--every` sets the frames between lines), the chat
between them, and with `--json` a line of JSON per frame with every unit's place, for a
script or a plot. The players' names, colours, chat and APM come from the replay file
itself, read as `replay info` reads it; the figures and the picture from the game.

A player who leaves the game shows as `left at 10:05` on their line from then on, instead
of the zeros the game keeps for them. When the replay has played to its end, the last line
says who won (`Question won`), or, when nobody had won by the time the recording stopped,
that the game ended at the replay's end.

A replay from any version plays; one from a game that held more units at once than 1.16.1
allows is refused, as the play page refuses it.

## Sharing a map from the terminal

`scmjs map share ridge.scx` does what the editor's **Account ▸ Copy Link to This Map…**
does, from the file: the map is saved to your scmjs.dev account and you get a link anyone
can open a copy of it with, in their own editor and without signing in. The copy is
theirs; nothing they do changes yours. The guide's [Giving someone a
copy](guide.md#giving-someone-a-copy) says what such a link does.

```
$ scmjs map share ridge.scx
https://scmjs.dev/editor/map/sJ5Z3w12SFSoLCD6zej-b46a
Ridge · 128 × 128 · 61 KB · revision 1, a new map on your account
Anyone with the link opens a copy in their editor, without signing in.
```

The link comes first, on a line of its own, so `scmjs map share ridge.scx | head -1` is
just the link. When your account already has a map with the same file name, the file is
saved as its next revision rather than a new map, and the line says which; `--new` makes a
new map anyway. Sharing a file that is already on the account unchanged stores nothing
again and gives the link it had. The link opens the revision you shared, so a link you
have posted does not change when you share the map again. `--name` names the map on your
account (the scenario's name otherwise), `--note` is the revision's note, and `-` reads
the map from a pipe. Account ▸ My Maps… in the editor lists the map with its revisions and
links, and removes them.

With a copy of StarCraft on the computer (as for `map preview`), the command draws the
map's picture for the link's card; without one the map goes up without a picture and the
card shows its size instead. `--no-picture` leaves it out.

`--edit` makes a link to edit the map together instead, as **Account ▸ Share this Map…**
does: whoever opens it edits the same map with you, each in their own editor (see the
guide's [Editing a map together](guide.md#editing-a-map-together)). It is open until
everyone has left it, and closes after a while if nobody comes. `--keep day`, `week`,
`month` or `forever` keeps it open that long after its last edit, saved on your account as
a map of its own, or as the next revision of the one with the same file name, as the Share
dialog's *Keep it open* does.

```
$ scmjs map share ridge.scx --edit --keep week
https://scmjs.dev/editor/share/49vlCkKoYvMJGzIah5I0Vo_y
Ridge · 128 × 128 · 61 KB · shared for editing, kept open for a week after its last edit, stored on your account
Anyone with the link edits the map with you in their editor, without signing in.
```

Both need a scmjs.dev account (the guide's [Your scmjs.dev
account](guide.md#your-scmjsdev-account)). `scmjs login` signs in: it opens a page in your
browser, which opens Discord's sign-in as the editor does (`--provider google` or
`battlenet` for the others), and the command says who signed in once you have approved it.
With `BROWSER=none` it prints the page's address for you to open. The sign-in waits two
minutes. Until you sign in, `map share` says "Sign in first: scmjs login" and exits
with 2.

The session is kept in a file only you can read: `~/.config/scmjs/session.json`, or
`%APPDATA%\scmjs\session.json` on Windows. `scmjs logout` ends the session on scmjs.dev
and deletes the file. `scmjs account` (also `scmjs account show`, beside `account login`
and `account logout`) says who you are signed in as, how much of your storage is in use,
and the maps you are sharing for editing with their links; `--json` prints it as JSON. A
refusal from scmjs.dev, such as a full storage or too many maps shared at once, is said in
scmjs.dev's own words. Nothing else of the command talks to scmjs.dev.

| Setting | Effect |
| --- | --- |
| `SCMJS_SESSION` | Another file for the session |
| `SCMJS_SERVER` | Another server than `https://api.scmjs.dev`, such as one of your own; its links carry its address for the editor |

`scmjs replay share game.rep` does the same for a replay: it is stored on your account (My
Maps ▸ Replays; up to 8 MB each, counted with your maps) and the command prints
`https://scmjs.dev/editor/replay/<token>`, which anyone opens to watch it in the editor's
replay viewer, with a card showing the map and the players where links get one. The map's
picture on the card is drawn from the map the replay carries, when your copy of the game
is here; `--note` adds a note, and the same replay shared again gives the link it has.


## For AI tools

`scmjs mcp` speaks the [Model Context Protocol](https://modelcontextprotocol.io) on
standard input and output, so an AI tool that runs on your computer, such as Claude Code,
Cursor or VS Code, can work on your maps with the same code these commands use. The tool
starts `scmjs mcp` as a child process in your maps folder and talks to it over the pipe,
and the paths it gives are files in that folder. Nothing goes on the network except what
the commands themselves fetch: the game engine the first time a map is run in the game,
and npm's newest version for `doctor`.

With Claude Code, once, in the folder your maps are in:

```sh
claude mcp add scmjs -- npx -y @scm-js/cli mcp
```

Other tools take the same thing as JSON in their MCP settings:

```json
{ "mcpServers": { "scmjs": { "command": "npx", "args": ["-y", "@scm-js/cli", "mcp"] } } }
```

Each tool is a command of this page, taking the same arguments by name and answering with
the command's text and its `--json` data:

| Tools | The commands |
| --- | --- |
| `map_info`, `map_check`, `map_dump`, `map_find`, `map_diff` | `map info`, `map check`, `map dump`, `map find`, `map diff`: reading, checking, searching and comparing |
| `map_triggers_export`, `map_triggers_import`, `map_strings_export`, `map_strings_import`, `map_strings_prune` | The triggers and strings as text, in and out; the text is given and taken inline, so the model edits triggers in the [trigger window's text form](triggers.md) |
| `map_set`, `map_resize`, `map_new`, `map_build`, `map_run` | The Scenario menu's edits, a new map, the TrigScript build, a plugin run over the map |
| `map_preview` | `map preview`: the answer is the picture itself, so a model that can see images sees the map |
| `map_trace`, `map_cost` | The triggers run in the game, and what they cost |
| `replay_info`, `replay_map` | What a replay holds, and its map written out |
| `doctor` | What this computer has, so the model knows what it can call |

A map reads as the editor reads it, so what the model is told is what the editor would
show. Tools that change a map write over it unless given `out`, the same as the commands,
so keep your maps in git or hand the tool copies. `map_run` runs a plugin, which is code,
with your privileges, as `scmjs map run` does; the tool asks you before it calls anything,
and you can leave that one unapproved.

`map_preview`, `map_trace` and `map_cost` need [your copy of the
game](#playing-the-game-what-those-commands-need), and the two runs fetch the engine the
first time; a run takes a few seconds and is at most ten minutes of play. `doctor` tells
the model whether the game and the engine are there and what you would need to install, so
it can say so rather than fail. When the game is not in one of the usual places, the model
can pass its folder as `starcraft`, or you can set `SCMJS_STARCRAFT` in the tool's MCP
settings.

## Plugins

`scmjs plugin new "Base Check"` writes a plugin to start from in `plugin-base-check/`: its
manifest, a `plugin.ts` that adds a Tools menu item, the Korean catalogue and the test
that keeps it complete, the typings, the build and the CI that every scm-js plugin uses.
Then:

```sh
cd plugin-base-check
npm install
npm start
```

`npm start` runs `scmjs plugin dev`. It builds the plugin, serves its folder on your own
computer and opens the editor with it. The first time, the editor asks you to add the
plugin, as for any plugin. After that, each time you save a file it builds the plugin
again and the editor reloads it. A build that fails is shown in the terminal and in the
editor, and nothing is reloaded until it is fixed. Ctrl+C stops it.

The editor remembers the plugin by its address, `http://127.0.0.1:5310/`, so it is the
same plugin next time. `--port` serves it on another port, and `--no-open` prints the
editor's address instead of opening it.

`scmjs plugin check` reads the folder the way the editor loads it and says what would go
wrong: a manifest it would refuse, an API version it does not have, a missing icon, entry
or build, a build older than its source, and, for a plugin without a build, imports of
files that are not there or of npm packages. It exits with 1 when the editor would not
load the plugin, so it can stop a CI step. The [plugin guide](plugins.md) covers the rest.

## Bots

`scmjs bot` builds a [BWAPI](https://github.com/bwapi/bwapi) 4.4.0 bot, the C++ AI modules
of the bot tournaments, into one `.scmbot` file. You can then play against it at
[scmjs.dev/play](https://scmjs.dev/play/): **Options → Community bots → Add a bot from a
file…**, then choose it for a computer. It needs
[Docker](https://docs.docker.com/get-docker/): the toolchain is a Docker image, downloaded
the first time, which takes a few GB.

Run the commands in your bot's folder:

```sh
scmjs bot init      # scmbot.json, read from the bot's Visual Studio project
scmjs bot build     # out/<key>.scmbot
```

With no bot yet, `scmjs bot new` writes one to start from, which mines, trains workers and
builds supply. A build needs a licence file for the bot (`LICENSE`, any licence you
choose), since it goes into every build and is shown with the bot.

`scmjs bot update` fetches the newest toolchain, the one the play page expects. The guide
to the toolchain, with what it does for code written for Visual Studio and the fields of
`scmbot.json`, is at [github.com/scm-js/scmbot](https://github.com/scm-js/scmbot).

### Playing a bot from the terminal

`scmjs bot run out/mybot.scmbot "(2)Boxer.scm"` plays the bot against the game's own
computers with no page open: the game is the play page's engine, and the bot sits in the
player's seat.

```
MyBot on (2)Boxer.scm 96 × 96, platform · computer zerg vs bot protoss · seed 12345 · Remastered files
  The map is Boxer!
  frame   1000  P1 computer Z 18/0 8/9  |  P2 bot P 76/0 7/9
  frame   2000  P1 computer Z 204/0 9/9  |  P2 bot P 296/0 9/9
  …
✖ the bot lost at frame 19919 · 41 KB of orders · 0.28 ms a frame game, 0.06 bot · 7.2 s
```

`--race` is the bot's race and `--opponents zerg,terran` the computers', one each;
`--seed` fixes the game, and the same seed, bot and map give the same game; `--frames`
stops a game nobody has won (24 frames a second: 50,000 is about 35 minutes of play);
`--every` sets the frames between progress lines, 0 for none. `--data folder` keeps the
files a bot writes between games (its `bwapi-data/write`), as the play page does. The
bot's own text is printed as it comes, and `--json` keeps everything as data. The command
exits with 1 when the bot printed errors, and 2 when the game could not start.

One bot plays a game; bots against each other is not there yet.

## Opening files in scmJS

`scmjs map open` and `scmjs replay open` open the file in the scmJS desktop app if it is
installed. A replay opens in the replay viewer.

Without the app, they open the editor at scmjs.dev in your browser and hand it the file.
The command serves a small page on your own computer, the page opens the editor, and the
editor takes the file from it. The file never leaves your computer. If the browser blocks
the editor from opening, the page shows a button for it. `--browser` uses the browser even
when the app is installed.

| Setting | Effect |
| --- | --- |
| `SCMJS_APP` | The desktop app's path, where it was installed somewhere unusual |
| `BROWSER=none` | Opens no browser: the command prints the page's address for you to open |

## What this computer has

`scmjs doctor` says what is on this computer of what the commands need beyond Node, and
the command for each thing missing: TypeScript for `map build` and a plugin written in
TypeScript, Docker for `bot new|build`, a copy of StarCraft for the commands that play the
game (`bot run`, `replay watch`, `map trace`, `map cost` and `map preview`), the game
engine those commands use, the desktop app for `map open`, whether Claude Code has been
given `scmjs mcp`, whether you are signed in to scmjs.dev for `map share`, and whether npm
has a newer scmjs. It ends with the commands this computer can run now, and for each one
that cannot, the one thing it lacks.

```
scmjs 0.9.0 · the newest · Node v24.13.0 · linux x64

  Tools
  ✔ TypeScript   6.0.3          ~/maps/node_modules/typescript
  ▲ Docker       not found
      scmjs bot new|init|build run the bot toolchain in it.
      https://docs.docker.com/get-docker/
  ✔ Desktop app  scmJS.exe      /mnt/c/Users/you/AppData/Local/Programs/scmJS/scmJS.exe
  · Claude Code  scmjs mcp not added
      claude mcp add scmjs -- npx -y @scm-js/cli mcp
  · scmjs.dev    not signed in
      scmjs login

  The game
  ✔ StarCraft    Remastered     /mnt/c/Program Files (x86)/StarCraft
  ✔ Game engine  1248410ad2a0   ~/.cache/scmjs/engine

  Not ready
  ✖ bot new|build  Docker not found
```

The game engine is fetched from the play page the first time a command needs it, and kept.
Each command that plays drives it with a runner of its own, and a copy fetched before the
play page had a runner lacks that one; the doctor names the runners the copy holds. The
next command that needs a missing runner fetches it, as long as the play page has it by
then. Until anything is fetched the line says "not fetched yet", and nothing waits on it.

The MCP line only looks for `scmjs mcp` among the servers Claude Code was told about, for
every folder or for the folder you run the doctor in. Not having it is not a problem, and
if Claude Code is not on this computer the line just says so.

A thing that is fine but simply not there, the desktop app, Claude Code or a scmjs.dev
sign-in, gets a dot rather than a tick, and only what is missing has lines under it saying
what to do. When every command can run, the last line says so in one; otherwise it lists
the commands that cannot and the one thing each lacks. `--json` prints the same checks and
the ready list as JSON.

Nothing is changed. The command exits with 1 only when Node itself is older than the
command needs.

## Completions

`scmjs completion bash`, `zsh` or `fish` prints a completion script for the shell, made
from the commands themselves, so every noun, verb and option is in it. Install it once:

```sh
eval "$(scmjs completion bash)"                        # in ~/.bashrc
scmjs completion zsh > ~/.zsh/completions/_scmjs       # a folder on $fpath
scmjs completion fish > ~/.config/fish/completions/scmjs.fish
```

## In scripts

- `--json` prints what a command found as JSON: one object for one file, a list for
  several. The text output may change between versions, so scripts should use `--json`.
- `-` as a map's path is standard input, and `--out -` (or no `--out`, for a map that came
  from `-`) is standard output, so the commands chain in a pipe:

  ```sh
  scmjs map new - --size 64x64 --players 2 | scmjs map set - --name "Ridge" | scmjs map check -
  cat ridge.scx | scmjs map resize - --size 128x96 --out - > ridge-wide.scx
  ```

  What the command says goes to standard error while the map takes standard output, and
  `--json` is refused there, since both want the pipe. A map from a pipe has no name: it
  is `stdin.scx` or `stdin.chk` by its bytes, and is written back in the same form.
- Exit codes: 0 when all went well, 1 when a map failed its check, two maps differed, a
  merge had conflicts it was not told how to settle, nothing matched a search, a build did
  not go through or something went wrong, 2 when a file was missing or was the wrong kind
  for the command, or an option was not one.
- Colour is off when the output is not a terminal, with `NO_COLOR` set, or with
  `--no-color`.
- For what the commands do not do — a script that edits maps, a check of your own — the
  same functions are the [`@scm-js/core` library](core.md); the command is built on them.

## In the source

For developers. The command is built from the editor's own code into a single file. Run it
from a clone with `npm run cli -- <command>`, or build it with `npm run build:cli`.

| File | Does |
| --- | --- |
| `cli/src/main.ts` | The commands, their help and options, and running a command over several files |
| `cli/src/map.ts`, `cli/src/replay.ts` | The map and replay reports, and how they are printed |
| `cli/src/exchange.ts` | Triggers and strings out as files and back in, and writing a map back as it was opened |
| `cli/src/diff.ts` | What changed between two maps, by group, and the section comparison underneath; a map read from a git revision |
| `cli/src/merge.ts` | The three-way merge: each part's rule, the ordered list merge for triggers, units matched without ids, the string table numbered again; git's three versions of a stopped file |
| `cli/src/edit.ts` | The header set, the map resized and the unused strings dropped, over the open document |
| `cli/src/report.ts` | Check Map's findings as GitHub annotations, JUnit XML and SARIF |
| `cli/src/dump.ts` | The map as text: every part in file order, the triggers and strings in their text forms, members hashed, sections as they would be written |
| `cli/src/find.ts` | Edit ▸ Find over a map from the terminal: the kinds, the hits and their lines |
| `cli/src/create.ts` | A new map as File ▸ New makes it: the flat fill with a seeded variation, the start locations, the slots closed, the file written as a new map is saved |
| `cli/src/init.ts` | A folder of maps set up for git and GitHub: the lines and files it lacks, the workflow and README made from the maps, the git settings |
| `cli/src/doctor.ts` | The checks: Node, npm's newest, TypeScript, Docker, StarCraft, the engine cache, the desktop app, and what each one is for |
| `cli/src/archive.ts` | The archive as a folder and back: member names as file names, the manifest, the members without a name |
| `cli/src/run.ts`, `src/plugins/headless.ts` | A plugin run over a map: the editor's plugin host with a store, a document and no page, its status, toasts and log reported instead of shown |
| `cli/src/build.ts` | The TrigScript build: finding TypeScript, compiling against the map's names, applying the block, laying the programs in and packing the file |
| `cli/src/completion.ts` | The bash, zsh and fish scripts, generated from the command tree |
| `cli/src/mcp.ts` | The MCP server: each tool a command's functions, its text and JSON as the result |
| `cli/src/replaymap.ts` | The replay's scenario written out as a map file |
| `cli/src/scmscx.ts`, `cli/src/fetch.ts` | scmscx.com's routes in one place, with the timeout and the errors; the search table, the file name made safe, the download opened before it is written |
| `cli/src/open.ts` | Finding the desktop app, handing a file to the editor in a browser, and a lobby asked of the play page the same way |
| `cli/src/account.ts` | The scmjs.dev sign-in through a page on the loopback address, the session file, and the account |
| `cli/src/share.ts` | A map saved to the account and linked, or opened for editing together, with its facts and picture |
| `cli/src/replayshare.ts` | A replay stored on the account and linked, with the map's picture for the card |
| `cli/src/bot.ts` | Running the bot toolchain's image in the bot's folder |
| `cli/src/engine.ts` | The game engine the playing commands share: the play page's current build fetched into the cache with its runners, the copy of the game found, a runner started |
| `cli/src/botrun.ts` | A bot's game with no page: scm-sim's bot runner run and its lines worded |
| `cli/src/watch.ts` | A replay in the terminal: the braille minimap, its colours and the lines around it, the replay's chat and APM, and the runner paced a picture at a time |
| `cli/src/trace.ts` | A map's triggers run in the game: scm-sim's map runner run, its trace and cost worded against the map's own triggers |
| `cli/src/rush.ts` | The walks between the start locations: the unit found by name, the map runner run in its rush mode, the table of the starts |
| `cli/src/preview.ts`, `cli/src/png.ts` | A map's picture: the terrain from the tileset, reduced to the scale asked, the units, resources and start locations over it, and the PNG written by hand |
| `cli/src/paint.ts` | The picture in a terminal: colour half blocks, the 256-colour fallback, ASCII shades, kitty's and iTerm2's picture protocols |
| `cli/src/gamefiles.ts` | Files out of your copy of the game: a Remastered installation's storage, a 1.16.1 copy's archives in the game's order |
| `cli/src/weigh.ts` | The weigher `map cost` hands the game: TrigScript's model of what Remastered charges, built beside the command |
| `cli/src/plugin.ts` | A new plugin's files, the plugin check, and the server `plugin dev` runs |
| `src/plugins/devLink.ts` | The editor's half of `plugin dev`: only a plugin served on this computer is taken |
| `cli/src/ui.ts` | Colour, marks, aligned rows, and StarCraft's text colours in a terminal |
| `cli/src/banner.ts` | The globe and the command list that `scmjs` on its own prints |
| `core/src/index.ts` | The library's surface; the command imports from the editor only what it exports ([core.md](core.md)) |
| `src/hooks/` (the opener hand-over) | The editor's half of the hand-over: only a page on the loopback address that opened it is listened to |
| [@scm-js/replay](https://github.com/scm-js/replay) | The replay reader, shared with the replay viewer plugin |
| `scripts/build-cli.mjs` | Builds `cli/dist/scmjs.mjs` |
