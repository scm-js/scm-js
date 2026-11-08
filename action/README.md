# scmjs maps: a GitHub Action

Checks the StarCraft: Brood War maps in a repository with
[scmjs](https://docs.scmjs.dev/cli), the scmJS editor's command line, on every push and pull
request:

- **Check Map**, as the editor runs it, over every map. Each finding shows on the pull
  request beside its map, and errors (or warnings too, with `strict`) fail the run.
- **What changed** in each map a pull request touches: the header, players, units,
  locations, triggers, strings and files, in one comment on the pull request that later
  pushes edit rather than repeat. With `pictures`, a PNG of where each map changed.
- **The TrigScript build** of each map that keeps a script, with `build`: the script is
  compiled against the map and nothing is written.

The shortest workflow, `.github/workflows/maps.yml`:

```yaml
name: Maps
on: [push, pull_request]
permissions:
  contents: read
  pull-requests: write
jobs:
  maps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: scm-js/scm-js/action@v0.13.0
```

That checks every `.scx`, `.scm` and `.chk` file in the repository, and comments on a pull
request that changes one. `scmjs init` in a folder of maps writes a workflow like this one
for you (see [Setting up a folder of maps](https://docs.scmjs.dev/cli#setting-up-a-folder-of-maps)).

The whole of it:

```yaml
name: Maps
on:
  push:
  pull_request:
permissions:
  contents: read
  pull-requests: write   # the comment on a pull request
  security-events: write # sarif: true
jobs:
  maps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # The repository's own TypeScript for the TrigScript build (optional: without it the
      # action installs typescript@6 for the run).
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - uses: scm-js/scm-js/action@v0.13.0
        id: maps
        with:
          version: 0.13.0
          maps: |
            maps/*.scx
            maps/**/*.scm
          strict: true
          baseline: maps/.scmjs-baseline.json
          sarif: true
          pictures: true
          build: true
      - run: echo "${{ steps.maps.outputs.problems }} problems, ${{ steps.maps.outputs.new_problems }} new"
```

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `version` | `latest` | The scmjs release to run: `0.13.0` or `v0.13.0`, or `latest` for the newest. Pin it, so a run gives the same answer until you move it. |
| `install` | `binary` | `binary`: the release's single executable for the runner (Linux x64, macOS x64 and arm64, Windows x64), checked against the release's `SHA256SUMS` and cached between runs. `npm`: `npx @scm-js/cli`, which needs Node on the runner. `none`: `scmjs` is on `PATH` already. |
| `maps` | every map | Globs from the repository's top, one a line: `maps/*.scx`, `maps/**/*.scm`. `*` stays within a folder and `**` crosses folders. Empty: every `.scx`, `.scm` and `.chk` file git knows of, tracked or not ignored. |
| `check` | `true` | Run Check Map over the maps. |
| `strict` | `false` | Fail the run on warnings as well as errors. |
| `baseline` | | A baseline file written by `scmjs map check --write-baseline`: its findings are known, and only new ones fail the run. Empty: `.scmjs-baseline.json` at the repository's top, when there is one. |
| `sarif` | `false` | Upload the findings to code scanning as well, where they are kept and tracked across runs. Needs `security-events: write`. |
| `diff` | `true` | Compare each map that differs from the base with its version there. |
| `base` | | The revision to compare with. Empty: on a pull request its base, on a push the commit before it. |
| `pictures` | `false` | Draw where each changed map changed (`scmjs map diff --picture`) and attach the PNGs to the run as an artifact. |
| `comment` | `true` | On a pull request, put what changed in one comment, edited by each later run. Needs `pull-requests: write`. |
| `build` | `false` | Compile the TrigScript script of each map that keeps one (`scmjs map build --check`), writing nothing. |
| `artifact` | `map-pictures-<job>` | The pictures' artifact name. A job that uses the action twice gives each its own. |
| `token` | `github.token` | The token the action downloads the release and comments with. |

## Outputs

| Output | What it holds |
| --- | --- |
| `problems` | The errors and warnings Check Map found over all the maps, known ones included. |
| `new_problems` | The errors and warnings the baseline does not hold; the same as `problems` without a baseline. |
| `changed_maps` | The maps that differ from the base, as a JSON list of paths (`fromJSON()` reads it). |

## What a run does

1. Puts `scmjs` on `PATH`, as `install` says. Later steps of the job can run it too.
2. Runs `scmjs map check` over the maps three ways: as text for the job's log, with
   `--format github` for the findings beside each map, and with `--json` for the counts
   (and with `--format sarif` when `sarif` is on). With a baseline, only new findings
   count.
3. With `build`, asks `scmjs map info` which maps keep a TrigScript script and runs
   `scmjs map build --check` on each.
4. Lists the maps that differ from the base (`git diff` against it; the action fetches the
   base commit when the checkout lacks it) and, for each, runs `scmjs map diff --rev <base>`:
   the text goes in the job's log and, folded, in the comment, with a line saying in a few
   words what changed. A new or removed map is said to be. With `pictures`,
   `scmjs map diff --picture` draws each, and the PNGs go into one artifact the comment
   links to (GitHub asks people to sign in to download an artifact).
5. Writes all of it to the job's summary, comments on the pull request, and then fails the
   run if Check Map or a build did.

The pictures are drawn with the ground in plain greys, one a kind of tile: GitHub's runners
have no copy of StarCraft, whose graphics `scmjs map preview` and `map diff --picture`
otherwise draw with. The changes are marked the same either way. On a runner of your own
with the game installed, the pictures have the game's terrain.

A pull request from a fork gets a token that cannot write, so it gets no comment; the
findings, the summary and the pictures are still there.

## What it does not run

`scmjs map test`, `map trace`, `map coverage` and the other commands that play a map need
the game itself, and a copy of StarCraft that GitHub's runners do not have. Run them on your
computer, or on a runner of your own with the game installed (`runs-on: self-hosted`),
after the action has put `scmjs` on `PATH`:

```yaml
      - uses: scm-js/scm-js/action@v0.13.0
      - run: scmjs map test maps/ridge.scx --format github --clips
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: failed-tests
          path: maps/ridge.clips/
```

`--clips` keeps a GIF of the last seconds of each failed scenario, drawn by the play page's
replay viewer in a browser on the runner (Chrome, Chromium or Edge), beside the replay
`map test` keeps anyway.

## Moving it to a repository of its own

The action lives in the `action/` folder of the scmjs repository, which is why its name is
`scm-js/scm-js/action` and its versions are the editor's release tags. To give it a
repository of its own (`scm-js/check-maps`, say), copy `action.yml`, `scripts/` and this page
there unchanged — nothing in them names the folder — tag a release, and change `uses:` to
`scm-js/check-maps@v1`. `scmjs init` writes the `uses:` line into the workflows it makes, so
the command would change with it.
