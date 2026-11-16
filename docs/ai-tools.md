# AI tools

`scmjs mcp` lets an AI tool on your computer, such as Claude Code, Cursor or Claude
Desktop, work on your maps. You ask in words, and the model reads, checks, changes and
runs the map with the editor's own code. With the map open in the editor, you watch each
change arrive and undo the ones you do not want.

![Big Game Hunters linked to an AI tool: the squad it placed is one step in Edit ▸ Undo](images/ai-linked.webp)

This guide is for the AI tool you already use. The editor also has an assistant of its own
under **Tools ▸ AI**, which the user guide covers in [The AI](guide.md#the-ai).

## Getting started

Add the server to your AI tool once, then ask about a map.

### Setting it up

You need [`scmjs`](cli.md#installing), or Node.js for `npx` to fetch it. The AI tool
starts `scmjs mcp` itself and talks to it over the [Model Context
Protocol](https://modelcontextprotocol.io); you never run it by hand.

With Claude Code, once, in the folder your maps are in:

```sh
claude mcp add scmjs -- npx -y @scm-js/cli mcp
```

If `scmjs` is installed, from a package manager, a download or `npm install -g`, name it
directly instead, which starts faster:

```sh
claude mcp add scmjs -- scmjs mcp
```

`scmjs doctor` prints the line for your copy, and its Claude Code line reads "scmjs mcp
added" once the server is known. Inside Claude Code, `/mcp` shows whether it is connected.
The line above adds the server for you alone. To add it for everyone who works on a
repository of maps, put `--scope project` after `add`: Claude Code then writes it to
`.mcp.json` at the repository's top, for you to commit.

Other tools take the same thing as JSON:

```json
{ "mcpServers": { "scmjs": { "command": "npx", "args": ["-y", "@scm-js/cli", "mcp"] } } }
```

| Tool | Where the JSON goes |
| --- | --- |
| Cursor | `.cursor/mcp.json` in the maps folder, or `~/.cursor/mcp.json` for every folder, with `"type": "stdio"` added beside `command` |
| Claude Desktop | `claude_desktop_config.json`, which Settings ▸ Developer ▸ Edit Config opens |
| Other tools | Their own MCP settings; each tool's documentation says where |

The tools take paths in the folder the server was started in, and refuse a path outside
it. An AI tool that works in a project folder, as Claude Code does, starts the server
there, so the paths are files in your maps folder. When a tool starts the server somewhere
else, the first refusal names the folder it was started in. Add `--allow-outside` after
`mcp` then, and the tools take paths anywhere on the computer.

### A first request

Start the AI tool in your maps folder and ask about a map:

> What is in ums.scx, and does Check Map find anything?

The model calls `map_info` and `map_check`, and answers from what they return. This is
`map_check` on the test map:

```
ums.scx  ▲ 1 warning
  ▲ Nothing makes Player 1 lose: no Defeat, and no Victory or Draw for another player. A scenario
    does not end when a player's units are gone. · Triggers
```

The tools run the same code as the editor and the commands, so what the model is told
about a map is what Check Map in the editor would show.

### What to ask

Ask as you would ask a person who has the commands. The model chooses which tools to call;
these are the ones each request is for.

| A request | The tools for it |
| --- | --- |
| "What is in ridge.scx, and does Check Map find anything?" | `map_info`, `map_check` |
| "Which triggers never fire, and why?" | `map_trace` |
| "Open ridge.scx in the editor so I can watch what you change." | `editor_open` |
| "Make the units I have selected invincible." | `editor_state`, `map_edit` |
| "Change the opening message to 'Hold the ridge.' and show me what changed." | `map_triggers_export`, `map_triggers_import`, `map_diff` |
| "Which of my maps still mention the Marine?" | `map_find` |
| "Give Player 1 six more Marines in the Base location and make the Ghost invincible." | `map_units`, `map_locations`, `map_edit` |
| "Put a plateau in the middle with a ramp on its south side, and a few lakes around it." | `map_terrain`, `map_edit`, `map_preview` |
| "Make me a four-player desert map to start from." | `map_generate` |
| "Show me the map." | `map_preview`, which answers with the picture |
| "Is this melee map fair? Where are the chokes?" | `map_analyze` |
| "Do the triggers slow the game down?" | `map_cost` |
| "Which triggers never fired in the replays in replays/?" | `map_coverage` |
| "What changed in ridge.scx since the last commit?" | `map_diff` with `rev` |
| "How much smaller can this map get?" | `map_optimize`, a dry run |
| "What does this mod change in the game?" | `mod_info`, `mod_diff` |

## Working in the editor

Ask the model to open the map in the editor, or link it yourself with
[`scmjs map open --live`](cli.md#keeping-a-map-linked-to-the-editor). The map opens in the
editor in your browser, and from then on the tools work on the map in front of you.

| | While the map is linked |
| --- | --- |
| A tool that reads the map | Reads what the editor has, your unsaved changes included |
| A tool that changes the map | Changes it in the editor. **Edit ▸ Undo** names the tool and takes its change back whole |
| The file on disk | Changes only on a save: yours with **File ▸ Save**, or the model's with `editor_save` |

The model can also use what is on your screen:

- **What you have selected.** `editor_state` tells it which units and locations are
  selected and which part of the map is in view, so "these units" and "here" mean
  something.
- **Pointing.** `editor_show` brings a place into view and flashes it, with the units or
  locations it names selected.
- **A picture.** `editor_picture` is the map as the editor draws it, with the editor's own
  game data, so the model needs no copy of StarCraft to look at the map.

If you edit the map while a tool is working on it, the tool starts again from what the
editor has now, and your edit is kept. The status bar shows **Linked** while the map is
linked. The link ends with `editor_close`, when you close the map or the small scmjs tab
beside it, or when the AI tool stops the server; the map stays open. The [command line
guide](cli.md#keeping-a-map-linked-to-the-editor) has the rest: what waits for a dialog,
what stays on your computer, and that the desktop app does not link yet.

## Changing a map

The model changes a map with the same tools whether it is linked to the editor or a file
on disk. A file is written over unless the tool is given `out`.

### Triggers and strings

Triggers and strings travel as text: the model exports them, changes the text and imports
it again. Here is "Change the opening message to 'Hold the ridge.' and show me what
changed" on the test map `ums.scx`, with what each tool was given and what it answered.
The model first asks for the triggers as text, with `map_triggers_export` and
`{ "path": "ums.scx" }`:

```
Trigger("Player 1"){
Conditions:
	Always();

Actions:
	Display Text Message(Always Display, "Hold the base.");
	Play WAV("staredit\\wav\\tone.wav", 1000);
	Set Mission Objectives("Bring a Marine to the middle.");
	Comment("Opening");
}
…
```

It changes the message in that text and hands the whole text back, with
`map_triggers_import` and `{ "path": "ums.scx", "text": "…", "out": "ums-fixed.scx" }`:

```
ums.scx: 3 → 3 triggers
Written to ums-fixed.scx (4076 bytes)
```

Then it compares the two, with `map_diff` and `{ "a": "ums.scx", "b": "ums-fixed.scx" }`,
and tells you what the answer says:

```
ums.scx → ums-fixed.scx

Map
  ~ Strings        20 → 21

Triggers +1 −1
  − Player 1: Always() → Display Text Message(Always Display, "Hold the base."); Play WAV(…
  + Player 1: Always() → Display Text Message(Always Display, "Hold the ridge."); Play WAV(…

Strings +1
  + 21  Hold the ridge.

Sections
  ~ STR   355 B → 373 B
  ~ TRIG  7.0 KB → 7.0 KB
```

The old message is still in the string table, as after any trigger import, until
`map_strings_prune` drops it. Without `out`, the import would have written over `ums.scx`.

### Units and locations

`map_units` and `map_locations` list what the map has, and `map_edit` takes a list of
edits that are applied together or not at all. With two units selected in the linked map,
"make these invincible, put a Marine beside them and add a location called Ramp" is
`editor_state`, then one `map_edit`:

```json
{ "path": "ums.scx", "edits": [
  { "op": "update_units", "indices": [17, 18], "invincible": true },
  { "op": "place_unit", "unit": "Terran Marine", "player": 1, "x": 400, "y": 1700 },
  { "op": "add_location", "name": "Ramp", "tiles": { "x0": 20, "y0": 40, "x1": 24, "y1": 44 } }
] }
```

```
  0  update_units  2 units changed
  1  place_unit    Terran Marine · Player 1 · 400,1700 · unit 21
  2  add_location  4  Ramp · 640,1280–768,1408
✔ ums.scx: 3 edits · 1 setting changed, 3 units added, 2 units removed, 1 location added, 1 string added · written to the editor, as one undo step · 4.0 KB
```

An edit also moves and removes units, adds, changes and removes locations, places sprites
and sets fog. [Editing units, locations, sprites and
fog](cli.md#editing-units-locations-sprites-and-fog) lists every kind of edit and its
fields. A position is used as given unless the edit says `snap`, which puts a building on
the building grid, or `check`, which refuses a position the editor would refuse.

### Terrain and doodads

`map_edit` also paints terrain and places doodads. The model reads the tileset's terrains
and the lie of the land with `map_terrain`, which draws the map as a grid of letters, and
the doodads with `map_doodads`. "Put a plateau in the middle with a ramp on its south
side, and a few lakes around it" on a flat jungle map is one `map_edit`:

```json
{ "path": "ridge.scx", "edits": [
  { "op": "paint_terrain", "terrain": "Water", "cover": 0.12, "grain": 10, "seed": 7, "symmetry": "rot180" },
  { "op": "paint_terrain", "terrain": "High Dirt", "tiles": { "x0": 20, "y0": 16, "x1": 44, "y1": 40 }, "shape": "ellipse" },
  { "op": "place_doodad", "doodad": "ramp", "tileX": 30, "tileY": 38, "within": 8 }
] }
```

```
  0  paint_terrain  Water · 2,080 tiles changed
  1  paint_terrain  High Dirt · 786 tiles changed
  2  place_doodad   Cliff #13 · 32,38 · 6 × 6 · doodad 0
✔ ridge.scx: 3 edits · 4 sections changed · written to ridge.scx · 11 KB
```

![The map after the edits: lakes mirrored through the centre and a plateau of high dirt with a ramp at its foot](images/cli-map-edit-terrain.webp)

Terrain is painted with the editor's isometric brush, so the cliff round the plateau and
the shore round each lake form on their own, and the ramp goes where StarEdit would let it
go. [Painting terrain and placing doodads](cli.md#painting-terrain-and-placing-doodads)
has every field: shapes, patches placed by a seed, symmetry, scattering doodads over an
area.

These edits read the tileset from [your copy of the game](#the-tools-that-need-the-game).
Painting does not move what stands on the ground, so ask the model to look at the result
(`map_preview`, or `editor_picture` on a linked map) and to run `map_check`.

For a whole map to start from, `map_generate` writes a symmetric melee map from a seed:
mains on high ground with a ramp each, naturals, free bases and a middle, walked and
checked before it is written.

### Everything else

| To change | The tool |
| --- | --- |
| The name, description, revision or text encoding | `map_set` |
| The size | `map_resize` |
| A TrigScript map, built from its script | `map_build` |
| Anything else the plugin API reaches, such as player settings or single tiles, with a script the model writes | `map_run` |

## The tools

There are 45. Each but the `editor_` tools is a command of the [command line
guide](cli.md), and its arguments are the command's options by name: `--dry-run` is
`dryRun`, `--in` is `in`. A tool answers with the command's text and, beside it, the
command's `--json` data.

| Tools | What they do | Write files |
| --- | --- | --- |
| `map_info`, `map_check`, `map_dump`, `map_find`, `map_diff` | Read, check, search and compare maps. `map_check` takes a `baseline` file and lists only the findings it does not hold | No |
| `map_triggers_export`, `map_strings_export` | The triggers and the strings as text, in the [trigger window's text form](triggers.md) and as `<number><TAB><text>` lines | No |
| `map_triggers_import`, `map_strings_import`, `map_strings_prune` | The text back into the map, passed inline, and the unused strings dropped | Yes |
| `map_units`, `map_locations` | [The units and the locations as rows](cli.md#listing-units-and-locations): a unit's index, type, player and position, filtered by type, player or area; a location's number, name and bounds | No |
| `map_terrain`, `map_doodads` | [The terrain and the doodads](cli.md#listing-terrain-and-doodads): the tileset's terrains with the tiles each covers and the map as a grid of letters; the doodads placed, and the ones the tileset has | No |
| `map_edit` | [A list of edits](cli.md#editing-units-locations-sprites-and-fog) to units, locations, sprites, fog, [terrain and doodads](cli.md#painting-terrain-and-placing-doodads), applied together or not at all | Yes |
| `map_set`, `map_resize`, `map_new`, `map_build`, `map_run` | The Scenario menu's edits, a new map, the TrigScript build, a plugin run over the map | Yes |
| `map_generate` | [A symmetric melee map from a seed](cli.md#a-melee-map-from-a-seed), walked and checked before it is written | Yes |
| `map_optimize` | The map made smaller | Only with `write: true` |
| `map_preview` | The map as a picture: the answer is the PNG itself, so a model that can see images sees the map | No |
| `map_analyze` | A melee map's layout: starts, naturals, the walks between starts, their narrowest points and the verdicts; with `picture`, the PNG too | No |
| `map_trace`, `map_cost`, `map_coverage` | The triggers run in the game, what they cost, and which fired across many replays | No |
| `map_balance` | Games played on a melee map with your bots, to see whether its starts are fair. It takes minutes | No |
| `replay_info`, `replay_map` | What a replay holds, with `builds` what each player ordered and with `mod` the mod's names; and the replay's map written out | `replay_map` |
| `mod_info`, `mod_check`, `mod_diff` | [Mods](cli.md#mods): what a mod is, its check, a changelog | No |
| `mod_unpack`, `mod_pack`, `mod_new`, `mod_header` | The mod as a folder of text and back, a new one, and [the ids for a bot](cli.md#a-bot-made-for-a-mod), written into a bot's folder with `bot` | Yes |
| `mod_play` | The mod [handed to the play page](cli.md#playing-a-mod-on-the-play-page) with a `map` and a `bot`. It opens your browser and answers with the page's link and what the page told it | No |
| `editor_open`, `editor_state`, `editor_show`, `editor_picture`, `editor_save`, `editor_close` | A map [linked to the editor](#working-in-the-editor): open it there, what you have selected and in view, bring a place into view, the map as the editor draws it, save, end the link | `editor_save` |
| `doctor` | What this computer has, so the model knows what it can call | No |

A few tools differ from their commands:

- `map_optimize` is a dry run unless given `write: true` or `dryRun: false`, the other way
  round from the command.
- `map_find` takes `kinds` and `matchCase` as well as `in` and `case`, `map_run` takes
  `args` as well as `arg`, and `map_preview` takes `marks` as well as `units`.
- `map_run` takes `game: false` where the command takes `--no-game`, and `map_generate`
  has no `rush`.
- `map_trace` and `map_cost` take `mod`, `replay`, `order` and `every`, as the commands
  take `--mod`, `--replay`, `--order` and `--every`. With `replay`, the map's `path` may
  be left out.
- `map_edit` takes the list itself as `edits`, where the command takes a file. An edit
  that cannot be done comes back as an error naming it, such as
  `edits[1] (remove_units): there is no unit 99: the map's units are 0 to 20`, and nothing
  is written.
- `mod_play` waits `wait` seconds for the page, 300 by default.
- The tools answer in English whatever the language of the commands, since the model reads
  them.

The rest of the commands are not tools: `map test`, `map rush`, `map heatmap`, `map log`,
`map blame`, `map merge`, `map unpack` and `pack`, `map sounds`, `map fetch`, sharing,
`replay watch` and `export`, the bot and plugin commands, and `init`. An AI tool that can
run commands in a terminal, as Claude Code can, runs those as you would.

## Your files and the game

What the tools may touch on your computer, and which of them need your copy of StarCraft.

### What the tools can do to your files

- **They stay in the maps folder**, unless you started the server with `--allow-outside`.
  The one exception is `starcraft`, the folder of your copy of the game, which is only
  read. They take no [scmjs.dev links](cli.md#links-in-place-of-files) either, since
  fetching one reaches past the folder; with `--allow-outside` they read links as the
  commands do, or `scmjs library get` downloads one into the folder first.
- **A tool that changes a map writes over it** unless given `out`, like the command. Keep
  your maps in git, or ask for copies. Every tool that only reads is marked so for the AI
  tool, so one that asks before a write can tell them apart.
- **A linked map is changed in the editor, not on disk**, until it is saved there. `out`
  still writes a file.
- **An argument a tool does not take is refused**, with the ones it does take, so a
  misspelt `dryRun` cannot write over a map:
  ``map_strings_prune: `dry_run` is not an argument of map_strings_prune: it takes `path`, `dryRun`, `out` ``.
- **`map_run` runs a plugin, which is code, with your privileges**, as `scmjs map run`
  does, and a plugin named by `github:` or a URL is fetched first. The AI tool asks you
  before it calls a tool, and you can leave this one unapproved.
- **Nothing else goes on the network** except what the commands themselves fetch: the game
  engine the first time a map is run in the game, and npm's newest version for `doctor`.
  `mod_play` opens the play page in your browser.
- **A failure is an answer the model can act on**, not a broken connection:
  `No file nosuch.scx` with `Check the name.` under it.

### The tools that need the game

`map_preview`, `map_analyze`, `map_terrain`, `map_doodads`, `map_generate`, `map_trace`,
`map_cost`, `map_coverage` and `map_balance` need [your copy of the
game](cli.md#commands-that-need-starcraft), and the ones that run it fetch the engine the
first time. `map_edit` needs it for terrain, doodads, `snap` and `check`, and for nothing
else. `map_run` gives a script the game's data when a copy is there, and runs without when
it is not: the terrain and doodad parts of the plugin API then do nothing and say so.
`doctor` tells the model whether the game and the engine are there and what you would need
to install, so it can tell you instead of failing. When the game is not in one of the
usual places, the model can pass its folder as `starcraft`, or you can set
`SCMJS_STARCRAFT` in the tool's MCP settings.

A trace or cost run takes a few seconds and plays at most ten minutes of game.
`map_coverage` plays whole replays and `map_balance` whole games, so they take as long as
the commands do. While a trace or cost run plays, an AI tool that shows progress is sent
the frame reached, and cancelling the request stops the game.

## In the source

| File | What it holds |
| --- | --- |
| `cli/src/mcp.ts` | The MCP server: each tool a command's functions, its text and JSON as the result |
| `cli/src/link.ts` | A map linked to the editor: the page between the command and the editor, and the reads and writes that go through it |
| `src/services/editorLink.ts` | The editor's end of a link: the map handed over, a changed one taken back as an undo step, the selection and the view |
| `cli/src/mapedit.ts`, `cli/src/objects.ts` | `map_edit` and the lists of units and locations |
| `cli/src/terrain.ts` | `map_terrain`, `map_doodads` and what the terrain and doodad edits lay |
