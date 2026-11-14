# @scm-js/cli

StarCraft: Brood War maps, replays, mods and bots from the command line, by [scmJS](https://scmjs.dev/editor/). It
installs the `scmjs` command, built from the editor's own code, so the two agree about every map.

```sh
npm install -g @scm-js/cli
```

Or without installing it: `npx @scm-js/cli info "(2)Destination.scx"`.

Look inside a map:

```sh
scmjs info "(2)Destination.scx"     # what a map, replay or bot file holds
scmjs map check maps/*.scx          # Check Map, as the editor runs it; exits 1 on errors
scmjs map find "Marine" maps/*.scx  # Edit ▸ Find across maps
scmjs map preview ridge.scx         # the map as a picture, in the terminal or as a PNG
```

Keep maps in git:

```sh
scmjs init                          # this folder of maps: text diffs, part-by-part merges, a GitHub check
scmjs map diff --rev HEAD~1 ridge.scx   # what the last commit changed in the map
scmjs map log ridge.scx             # the map's history, in the map's terms
scmjs map triggers edit ridge.scx   # the triggers in your text editor
```

Run a map in the game, with your own copy of StarCraft:

```sh
scmjs map trace ridge.scx           # which triggers fired, which never did and why
scmjs map test ridge.scx            # the scenarios in ridge.tests.json, played and checked
scmjs map generate "(2)Duel.scx" --seed 7   # a symmetric melee map to play
scmjs map analyze "(2)Duel.scx"     # starts, naturals, walks and chokes
```

Replays, mods and bots:

```sh
scmjs replay watch game.rep         # the replay played in the terminal
scmjs replay export game.rep        # a video or GIF of it
scmjs map heatmap ridge.scx reps/   # where units died in those replays, as heat over the map
scmjs mod unpack MyMod.mpq mymod    # a mod as a folder of text and pictures, and `mod pack` back
scmjs bot run mybot.js ridge.scx    # a bot against the game's computers
```

Share, and the rest:

```sh
scmjs map share ridge.scx           # a scmjs.dev link anyone can open a copy with (scmjs login first)
scmjs map play ridge.scx            # a lobby on scmjs.dev/play with the map; the invite link printed
scmjs mcp                           # the commands as an MCP server, for Claude Code and other AI tools
scmjs doctor                        # what this computer has for each command
```

Every command has `--help` and `--json`, and `-` reads a map from a pipe or writes one to it. Needs Node.js 22.12 or
newer; without Node, install it with Homebrew, Scoop or winget, or download it as one program from the
[releases page](https://github.com/scm-js/scm-js/releases/latest) ([Installing](https://docs.scmjs.dev/cli/getting-started/#installing)).

The guide is at [docs.scmjs.dev/cli](https://docs.scmjs.dev/cli/). MIT licence.
