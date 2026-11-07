# The command line

`scmjs` is scmJS on the command line. It tells you what a map or replay holds, runs Check
Map on any number of maps, makes a new map, searches maps, writes a map out as text so git
can show its changes, takes a map's triggers and strings out as text and puts them back,
says what changed between two maps, builds a TrigScript map the way Save does, runs a
plugin over a map, takes a map's archive apart into a folder and puts it back, opens a map
or replay in scmJS from a terminal, helps you write a plugin, builds a BWAPI bot of your
own for the play page, and says what your computer has for each of those. It reads files
the way the editor does, so the two agree about every map.

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
| `scmjs map triggers export|import` | A map's triggers as a text or `.trg` file, and back |
| `scmjs map strings export|import` | A map's strings as a text file, and back |
| `scmjs map strings prune <map>` | Drops the strings nothing in the map refers to |
| `scmjs map set <map>` | The map's name, description, revision or text encoding |
| `scmjs map resize <map>` | Scenario ▸ Resize: the map to another size, anchored |
| `scmjs map diff <a> <b>` | What changed between two maps, or since a git revision with `--rev` |
| `scmjs map build <map>` | Applies the map's TrigScript script and builds its programs into the file, as Save does |
| `scmjs map run <plugin> <map>` | Runs a plugin, or a script written like one, over the map with the plugin API |
| `scmjs map unpack <map>`, `scmjs map pack <folder>` | A map's archive as a folder of files, and back |
| `scmjs replay info <replays…>` | Who played, on which map, for how long and at what APM |
| `scmjs replay open <replay>` | Opens the replay in scmJS, to watch and analyse |
| `scmjs plugin new <name>` | A plugin to start from, set up to type-check, test, build and publish |
| `scmjs plugin dev` | Opens the editor with your plugin, and reloads it each time you save |
| `scmjs plugin check` | What the editor would make of the plugin: its manifest, files and imports |
| `scmjs bot new`, `init`, `build` | A BWAPI bot of your own, built into a `.scmbot` file for the play page |
| `scmjs bot update` | The newest bot toolchain |
| `scmjs bot run <bot> <map>` | Plays the bot against the game's computers on the map, with no page |
| `scmjs doctor` | What this computer has for each command: TypeScript, Docker, StarCraft, the desktop app, and the command for each thing missing |
| `scmjs about` | This version and whether there is a newer one, who made it, the desktop app and Docker if they are installed, and where the docs and source are |
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
`git show` and the pull requests of tools that honour `.gitattributes`. Once, in the
repository:

```sh
git config diff.scmjs.textconv "scmjs map dump"
git config diff.scmjs.xfuncname "^## "
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

The second line makes each hunk's heading the part of the map it is in.
`git config diff.scmjs.cachetextconv true` keeps the text of each version so a long
`git log -p` does not read every map again. The `.gitattributes` lines are committed, so
everyone who clones gets them; the two `git config` lines are per clone (`--global` sets
them for every repository on your computer). `--json` gives the same data as JSON, with
the units and triggers as the records the editor holds.

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

## Replays

`scmjs replay info` reads a replay from any version, from 1.16 to Remastered. It shows the
players in their colours with race, APM and team, the map, the game's length and speed,
when it was played, and how much chat there was. APM is counted the way the replay viewer
counts it: everything a player did except chat, until they left.

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

Two things it needs on your computer. The engine, about 25 MB, is fetched from the play
page the first time and kept in your cache folder; the game's own files come from your
installation of StarCraft, Remastered or 1.16.1, which is looked for in the usual places
or named with `--starcraft` (or `SCMJS_STARCRAFT`). Nothing of the game is fetched or
carried, so this runs where the game is installed and not on a build server. One bot plays
a game; bots against each other is not there yet.

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
TypeScript, Docker for `bot new|build`, a copy of StarCraft and the fetched engine for
`bot run`, the desktop app for `map open`, and whether npm has a newer scmjs.

```
scmjs doctor  what this computer has for each command

✔ Node         v24.13.0 · linux x64
✔ scmjs        0.8.12 · the newest
▲ TypeScript   not found
    scmjs map build and a .ts plugin under scmjs map run compile with it.
    npm install typescript   (in the map's project, or npm install -g typescript)
✔ Docker       29.1.3
▲ StarCraft    not found
    scmjs bot run plays with your own installation's files.
    scmjs bot run … --starcraft <folder>   (or SCMJS_STARCRAFT=<folder>)
✔ Game engine  not fetched yet
✔ Desktop app  not installed

✔ scmjs info, check, dump, diff and the rest need nothing more; the rest is for the commands named
```

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
- Exit codes: 0 when all went well, 1 when a map failed its check, two maps differed,
  nothing matched a search, a build did not go through or something went wrong, 2 when a
  file was missing or was the wrong kind for the command, or an option was not one.
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
| `cli/src/edit.ts` | The header set, the map resized and the unused strings dropped, over the open document |
| `cli/src/report.ts` | Check Map's findings as GitHub annotations, JUnit XML and SARIF |
| `cli/src/dump.ts` | The map as text: every part in file order, the triggers and strings in their text forms, members hashed, sections as they would be written |
| `cli/src/find.ts` | Edit ▸ Find over a map from the terminal: the kinds, the hits and their lines |
| `cli/src/create.ts` | A new map as File ▸ New makes it: the flat fill with a seeded variation, the start locations, the slots closed, the file written as a new map is saved |
| `cli/src/doctor.ts` | The checks: Node, npm's newest, TypeScript, Docker, StarCraft, the engine cache, the desktop app, and what each one is for |
| `cli/src/archive.ts` | The archive as a folder and back: member names as file names, the manifest, the members without a name |
| `cli/src/run.ts`, `src/plugins/headless.ts` | A plugin run over a map: the editor's plugin host with a store, a document and no page, its status, toasts and log reported instead of shown |
| `cli/src/build.ts` | The TrigScript build: finding TypeScript, compiling against the map's names, applying the block, laying the programs in and packing the file |
| `cli/src/completion.ts` | The bash, zsh and fish scripts, generated from the command tree |
| `cli/src/open.ts` | Finding the desktop app, and handing a file to the editor in a browser |
| `cli/src/bot.ts` | Running the bot toolchain's image in the bot's folder |
| `cli/src/botrun.ts` | A bot's game with no page: the engine fetched into the cache, the copy of the game found, scm-sim's runner run and its lines worded |
| `cli/src/plugin.ts` | A new plugin's files, the plugin check, and the server `plugin dev` runs |
| `src/plugins/devLink.ts` | The editor's half of `plugin dev`: only a plugin served on this computer is taken |
| `cli/src/ui.ts` | Colour, marks, aligned rows, and StarCraft's text colours in a terminal |
| `cli/src/banner.ts` | The globe and the command list that `scmjs` on its own prints |
| `core/src/index.ts` | The library's surface; the command imports from the editor only what it exports ([core.md](core.md)) |
| `src/hooks/` (the opener hand-over) | The editor's half of the hand-over: only a page on the loopback address that opened it is listened to |
| [@scm-js/replay](https://github.com/scm-js/replay) | The replay reader, shared with the replay viewer plugin |
| `scripts/build-cli.mjs` | Builds `cli/dist/scmjs.mjs` |
