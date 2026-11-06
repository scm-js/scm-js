# The command line

`scmjs` is scmJS on the command line. It tells you what a map or replay holds, runs Check
Map on any number of maps, opens a map or replay in scmJS from a terminal, helps you write
a plugin, and builds a BWAPI bot of your own for the play page. It reads files the way the
editor does, so the two agree about every map.

You need Node.js 22.12 or newer. Install it once, and type `scmjs` from then on:

```sh
npm install -g @scm-js/cli
scmjs info "(2)Destination.scx"
```

Or run it without installing, with `npx`, which fetches it the first time:
`npx @scm-js/cli info "(2)Destination.scx"`. Every command has `--help`, and
`scmjs --help` lists them all.

To update an installed copy, run `npm install -g @scm-js/cli@latest`. `scmjs about` says
when there is a newer version.

## Commands

| Command | What it does |
| --- | --- |
| `scmjs info <files…>` | What a map, replay or bot file holds, whichever it is |
| `scmjs map info <maps…>` | A map's size, tileset, players, units, triggers and strings, and its check in one line |
| `scmjs map check <maps…>` | Check Map, as the editor runs it: errors first, then warnings |
| `scmjs map open <map>` | Opens the map in scmJS |
| `scmjs replay info <replays…>` | Who played, on which map, for how long and at what APM |
| `scmjs replay open <replay>` | Opens the replay in scmJS, to watch and analyse |
| `scmjs plugin new <name>` | A plugin to start from, set up to type-check, test, build and publish |
| `scmjs plugin dev` | Opens the editor with your plugin, and reloads it each time you save |
| `scmjs plugin check` | What the editor would make of the plugin: its manifest, files and imports |
| `scmjs bot new`, `init`, `build` | A BWAPI bot of your own, built into a `.scmbot` file for the play page |
| `scmjs bot update` | The newest bot toolchain |
| `scmjs about` | This version and whether there is a newer one, who made it, the desktop app and Docker if they are installed, and where the docs and source are |

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

`scmjs map check` lists what Check Map finds, each with where it is in the map. `--all`
adds the notes as well, and `--strict` fails a map on warnings too. The command exits with
1 when a map fails, so it can stop a build:

```sh
scmjs map check maps/*.scx --strict
```

Checks that need the game's graphics or unit data (units standing where they cannot walk,
for example) are not run here. The editor runs them once you have given it the game data.

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

## In scripts

- `--json` prints what a command found as JSON: one object for one file, a list for
  several. The text output may change between versions, so scripts should use `--json`.
- Exit codes: 0 when all went well, 1 when a map failed its check or something went wrong,
  2 when a file was missing or was the wrong kind for the command.
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
| `cli/src/open.ts` | Finding the desktop app, and handing a file to the editor in a browser |
| `cli/src/bot.ts` | Running the bot toolchain's image in the bot's folder |
| `cli/src/plugin.ts` | A new plugin's files, the plugin check, and the server `plugin dev` runs |
| `src/plugins/devLink.ts` | The editor's half of `plugin dev`: only a plugin served on this computer is taken |
| `cli/src/ui.ts` | Colour, marks, aligned rows, and StarCraft's text colours in a terminal |
| `core/src/index.ts` | The library's surface; the command imports from the editor only what it exports ([core.md](core.md)) |
| `src/hooks/` (the opener hand-over) | The editor's half of the hand-over: only a page on the loopback address that opened it is listened to |
| [@scm-js/replay](https://github.com/scm-js/replay) | The replay reader, shared with the replay viewer plugin |
| `scripts/build-cli.mjs` | Builds `cli/dist/scmjs.mjs` |
