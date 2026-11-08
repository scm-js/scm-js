# @scm-js/cli

StarCraft: Brood War maps, replays and bots from the command line, by [scmJS](https://scmjs.dev/editor/). It installs
the `scmjs` command, built from the editor's own code, so the two agree about every map:

```sh
npm install -g @scm-js/cli
scmjs info "(2)Destination.scx"     # what a map or replay holds
scmjs map check maps/*.scx          # Check Map, as the editor runs it; exits 1 on errors
scmjs map dump ridge.scx            # the whole map as text: git's textconv for maps
scmjs map find "Marine" maps/*.scx  # Edit ▸ Find across maps
scmjs map trace ridge.scx           # the triggers run in the game: which fired, which never did and why
scmjs map preview ridge.scx         # the map as a picture, in the terminal or as a PNG
scmjs map heatmap ridge.scx reps/   # where units died in those replays, as heat over the map
scmjs map play ridge.scx            # a lobby on scmjs.dev/play with the map; the invite link printed
scmjs map share ridge.scx           # a scmjs.dev link anyone can open a copy with (scmjs login first)
scmjs replay info game.rep          # players, races, APM, map, length
scmjs replay watch game.rep         # the replay played in the terminal
scmjs replay map game.rep           # the map it was played on, written out beside it
scmjs replay share game.rep         # a link anyone opens to watch it in the editor (scmjs login first)
scmjs replay open game.rep          # watch it in scmJS: the desktop app, or the editor in your browser
scmjs mcp                           # the map commands as an MCP server, for Claude Code and other AI tools
scmjs doctor                        # what this computer has for each command
```

Or without installing it: `npx @scm-js/cli info "(2)Destination.scx"`.

Every command has `--help` and `--json`, and `-` reads a map from a pipe or writes one to it. The commands that play
the game (`map trace`, `replay watch`, `bot run`) use your own installation of StarCraft. Needs Node.js 22.12 or
newer; without Node, each [release](https://github.com/scm-js/scm-js/releases/latest) has `scmjs` as one program
with Node inside, for Windows, macOS and Linux ([Without Node](https://docs.scmjs.dev/cli/getting-started/#without-node)).

The guide is at [docs.scmjs.dev/cli](https://docs.scmjs.dev/cli/). MIT licence.
