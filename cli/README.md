# scmjs

StarCraft: Brood War maps and replays from the command line, by [scmJS](https://scmjs.dev/editor/).

```sh
npx scmjs info "(2)Destination.scx"     # what a map or replay holds
npx scmjs map check maps/*.scx          # Check Map, as the editor runs it; exits 1 on errors
npx scmjs replay info game.rep          # players, races, APM, map, length
npx scmjs replay open game.rep          # watch it in scmJS: the desktop app, or the editor in your browser
npx scmjs about
```

Every command has `--help` and `--json`. Needs Node.js 22.12 or newer.

The guide is at [docs.scmjs.dev/cli](https://docs.scmjs.dev/cli/). MIT licence.
