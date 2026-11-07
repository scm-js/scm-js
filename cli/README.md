# @scm-js/cli

StarCraft: Brood War maps and replays from the command line, by [scmJS](https://scmjs.dev/editor/). It installs the
`scmjs` command:

```sh
npm install -g @scm-js/cli
scmjs info "(2)Destination.scx"     # what a map or replay holds
scmjs map check maps/*.scx          # Check Map, as the editor runs it; exits 1 on errors
scmjs map dump ridge.scx            # the whole map as text: git's textconv for maps
scmjs map find "Marine" maps/*.scx  # Edit ▸ Find across maps
scmjs replay info game.rep          # players, races, APM, map, length
scmjs replay open game.rep          # watch it in scmJS: the desktop app, or the editor in your browser
scmjs replay map game.rep           # the map it was played on, written out beside it
scmjs mcp                           # the map commands as an MCP server, for Claude Code and other AI tools
scmjs about
```

Or without installing it: `npx @scm-js/cli info "(2)Destination.scx"`.

Every command has `--help` and `--json`. Needs Node.js 22.12 or newer.

The guide is at [docs.scmjs.dev/cli](https://docs.scmjs.dev/cli/). MIT licence.
