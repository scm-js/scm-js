# `scmjs plugin` and `scmjs bot`: building, playing, a ladder, the bot types

The developer commands: plugins for the editor (`plugin new|check|dev`), BWAPI and JavaScript bots (`bot
new|init|build|update` through Docker, `bot run`, `bot ladder`), and the `@scm-js/bot` types package beside them. The
engine, its runners and the copy of the game are `cli-game.md`; a bot or ladder on a mod is `mods.md` ("`bot run
--mod`, `bot ladder --mod`").

## Plugins (`plugin.ts`)

- **`plugin new [name] [-o folder] [--id]`** writes `plugin-<id>/` from `pluginFiles`: Hello World's layout (manifest
  with `build: dist/plugin.js`, `plugin.ts` with a Tools item and a pane, `ko.ts` + `tests/ko.test.ts`, Hello World's
  tsconfig, the shared `scm-js/.github` plugin CI without `secrets: inherit` (its push falls back to GITHUB_TOKEN),
  README, MIT LICENSE with `git config user.name`). package.json has `start: scmjs plugin dev`, `check: scmjs plugin
  check` and `@scm-js/cli ^<this version>` as a devDependency; a generated plugin installs, tests, type-checks and
  builds as written. A name that slugs to nothing is refused (it does not become `my-plugin`); `--dir` is the hidden
  old name of `-o`. **Trap: a comment in the starter that says `t("…")` is read by the catalogue test as a string.**
- **`plugin check [folder]`** = the loader's view: `validateManifest`, api vs `PLUGIN_API_VERSION`, icon (`resolveIcon`
  against a fake base), entry, build present and newer than the sources; with no build, relative imports followed
  (`./x.js` → x.ts, dir/index) and package imports refused, as the source loader does. An `id` that is not already
  `pluginIdOf`'s slug is a warning naming the slug the editor keeps; a `version` that is not x.y.z an info (the loader
  refuses neither). `--json`, `--all`, `--strict`, exit 1.
- **`plugin dev [folder] [--port 5310] [--no-open]`**: `npm run build` first and on change when the manifest names a
  build and package.json has the script (else the source is served as is), then the check after each change (the first
  error is said, not "no editor connected"); a loopback server with CORS, `access-control-allow-private-network`,
  no-store, no node_modules/.git, nothing outside the folder; SSE at `/__scmjs/events`; `fs.watch` recursive,
  debounced, ignoring node_modules/.git and **the build's own file and folder** (a removed `dist/` otherwise built
  twice). `--no-open` says "Open <url>". It keeps its own SIGINT handler. The editor's half is `plugins-loading.md`,
  `?plugin-dev=`.
- Running a plugin over a map is `map run` (`cli-map-edit.md`).

## The bot toolchain through Docker (`bot.ts`)

`bot new|init [project]|build` = `docker run --rm -i(t) -v <cwd>:/bot -e SCMBOT_FOLDER=<folder name> -e
SCMBOT_COMMAND="scmjs bot" [-u uid:gid, not on Windows] ghcr.io/scm-js/scmbot <args>` (`SCMBOT_IMAGE` overrides),
stdio inherited, the toolchain's exit code passed on; `update` = `docker pull`. `SCMBOT_COMMAND` makes the toolchain's
messages say `scmjs bot build`. "Not installed" vs "not running" is told from `docker --version` / `docker version`;
Docker missing, or 125–127 from `docker run`, is exit 2. `bot build` checks `scmbot.json`'s licence file before Docker.
The toolchain lives in the public github.com/scm-js/scmbot (its README is the guide), mirrored from scm-sim's
`native/`.

## `bot run` (`botrun.ts`)

- `scmjs bot run <bot> <map> [--race] [--opponents] [--seed] [--frames] [--every] [--data] [--starcraft] [--engine]
  [--mod] [--ums|--melee] [--json]`: the bot runner (`run.ts` in scm-sim) plays the page's `installed()` sequence in
  Node — `GameCore`, the interface pack before the copy's files, the engine's own data read from the same copy — then
  loads the bot in the person's seat as `startBotGame` does. Same seed → same game, across both kinds of copy. Its JSON
  lines (`start`, `text`, `progress`, `end`, `error`) are worded live by `wordLine` and kept for `--json`.
- **Exit**: the runner's — 0 ran, 1 the bot printed errors, 2 could not start. **A loss is not a failure** (shown ▲).
- **Checks before the game** (`botRunValues` reads every value through `values.ts`; `checkBotGame` reads both files):
  files swapped, a replay given as the map, a bot folder given (the hint names `out/<key>.scmbot`), an unreadable map,
  a **zlib/bzip2 scenario** (refused: the bot runner hands the map's own archive and 1.16.1's Storm has no zlib —
  `cli-game.md`), and the start-location count for a melee game.
- **`gameKind`**: with a mod and neither `--ums` nor `--melee`, a melee-looking map (`looksLikeMapSettings`, the
  runner's own test, copied) gets `--melee` when the mod carries no plugins as files. **The runner's
  `useMapSettings` counts a FireGraft project with 0 edits as code**, which seated the bot alone and "won at frame 48";
  scm-sim should count plugins (or a project with edits). A start line with no non-bot player → `alone` and a warning.
- **The bot's player is called "oracle" by the engine**, so text lines are given the bot's name here (the engine
  should name the player). `replay info`'s "Game oracle hosted by …" is the same name in the file.
- `bot run --ums --opponents …`: the opponents do nothing in a UMS game, and nothing says so.

## JavaScript bots

- The runners play a JavaScript bot's module (`BOT_API` 1, the public guide `docs/bots.md`) as BWAPI's client: BWAPI
  with no bot linked, its GameData read each frame (scm-sim `docs/js-bots-plan.md`). The bot-less BWAPI is **inside**
  `run.mjs` and `match.mjs`, so the CLI fetches nothing new; an engine from before them refuses the file as "not a bot
  file".
- The CLI's half (`files.ts`): `isJsBot` by extension (`.js`/`.mjs`/`.ts`; a `.scmbot` is told by its magic),
  `jsBotName` (the file's name, as the runner names it), `typeScriptBotProblem` (`process.features.typescript`: Node
  strips types itself from 22.18 while the CLI's floor is 22.12, so an older Node is told to compile). `checkBotGame`
  skips the kind check for one; `parseEntrants` names one after its file. The runner imports the bot's module from its
  path.
- Seen once with the Starter bot attacking in a wave of 16: "a command of 11 bytes did not fit in this turn and was
  dropped" errors, and exit 1 for them — a group order's size against the turn's room, on the runner or layer side, not
  looked into.

## `bot ladder` (`ladder.ts`)

`scmjs bot ladder <bots…> --maps <maps…> [--races r] [--games 1 | --seeds a,b] [--frames 50000] [--out] [--data]
[--parallel 1] [--timeout 60] [--mod] [--json]`: every pairing of the sides on every map, a line as each game ends, then
the standing (Elo, games, won/lost/undecided, average length, a bot's ms a frame, its longest frame, frames over 55 ms)
and, with three sides or more, the head-to-head.

- **Local lockstep, no server.** One BWAPI build fits a game's memory, so two bots are two copies of the game, each a
  process with one bot. scm-sim's **match runner** (`src/bwapi/match.ts`) starts a seat per bot (its own file again,
  `--seat k`) and is itself the relay over the seats' stdin/stdout: each frame a seat runs its bot, sends that frame's
  commands, waits for the relay's `turn` and steps it with `ExactNetEngine.stepTurn` — the play page's path for a
  community bot in a game between people. **No clock**: a turn closes when every seat has sent, so the game is the
  same however fast each bot is. Hashes every 24 frames and the seats' replays are compared; long bot-against-bot games
  compared equal at every hash and gave byte-identical replays. The hosted relay is not used and would be wrong for a
  ladder: its clock makes the turn a command lands in depend on timing.
- **One path for both kinds of game**: a bot against the computer is the same runner with one seat (the computer is
  the game's own), so the CLI has one runner and one protocol. `end` carries frame, players, decided, winner, `by`
  victory|left|frames|desync, per bot {state ended|left|failed|crashed, frames, ms, maxMs, over55, over1s, over10s,
  commands, kept}, replay {file, bytes, agreed}, hashes {compared, differedAt}. Runner exit 0, 1 a bot's copy failed, 2
  could not start.
- **The relay ends the game for all seats at one frame**: 48 frames (`SETTLE_FRAMES`) after a seat reports it decided
  (BWAPI calls `onEnd` within 36), or at the frame limit; a hash mismatch ends it as `desync` (counted in nobody's Elo).
  A seat that dies, or gives no turn for `--timeout` seconds (max(timeout, 300) for frame 0, the bots' map analysis),
  is a player who left: `gone` in the next turn, `by: "left"`, its bot `crashed`. A lone seat that dies ends as the
  computer's win, not an error: some bots never finish their start on some maps in five minutes. Learning files: a
  seat reads `--data`'s folder into `bwapi-data/read` and writes back what `keepable` keeps after `onEnd`, nothing
  when its copy failed.
- **Replays that play back**: the game's replay reads a frame into 544 bytes (scm-sim `FRAME_BYTES`) and two busy bots
  recorded frames of 600–700 (each turn holds 480), so `replay watch` parted from such a game. scm-sim's
  `TurnFeed.recordRoom` caps a turn as recorded and the match runner gives each bot 544 / bots; the rest waits a turn.
  Checked frame by frame on a long game: the live hashes and the replay's played back agree at every frame. The play
  page's Save Replay of two busy bots between people can still record such frames (a note for scm-sim).
- **The CLI half**: `parseEntrants` (a `.scmbot`'s header gives key and name; `:race` only when the text after the last
  colon is a race, for Windows paths; `computer` expands to one entrant a race of `--races`; duplicates get `-2` keys
  and labels; `x:bogus` after an existing file says "not a race"), `schedule` (seeds outermost, then maps, pairs, races,
  seats: bot vs bot both lobby orders, a bot first against the computer, no computer pairs; rounds first so a ladder
  cut short is even), `replayName` (`<a>-vs-<b>_<map>_<RvR>_seed<n>.rep`, `-2` when taken), `eloRatings` (1500, K 32,
  undecided ½, in **schedule order** so `--parallel` changes nothing; desync and unplayed skipped), `standings`,
  `headToHead`, `playGame` (one runner process), `runLadder` (a pool of `--parallel` workers; `ladder.json` beside the
  replays). Exit 1 when a game was not played, went out of step, or a bot's copy failed; a loss is not a failure.
  `--json` sends the live lines to stderr.
- **The folder**: default `ladder-YYYY-MM-DD-HHMM` in the cwd (`-2`… when taken: a date alone collides twice a day); the
  replays, `ladder.json` and `bwapi-data/<key>/` (the learning files) together make one ladder something to keep or
  delete whole. `clearLadderFolder` refuses an earlier ladder's folder unless `--force`, which removes top-level `*.rep`
  and `ladder.json` and keeps `bwapi-data`. A Ctrl-C'd ladder still leaves its folder (made before the first game; the
  runner writes into it).
- **Original 1.00 maps**: each `--maps` is opened and passed through `trace.ts#gameMap` (VER 59 → a temp Brood War copy,
  removed in a `finally`); the replay is named after the map given. Why: the game *starts* a VER 59 melee map from its
  own archive, but the replay runner cannot play a VER 59 replay, and a ladder's point is watching the losses.
- **Traps**: `tests/maps/melee.scx` has no resources (the generated maps carry nothing of Blizzard's), so bots stall
  at 0 minerals — not a desync; use real maps. **The replay header's date is the seed** (offset 8 is the game's seed,
  the start time in a real game), so a ladder's replays say 1970. A seat takes ~1.3 GB resident (10 GB reserved); six
  games at once is fine on a 24-core, 30 GB machine.
- A mod's ladder tags each replay with the mod (`tagModReplay`, `cli-replays-mods.md`).

## `@scm-js/bot`, the bot types (`bot/`, `scripts/build-bot-types.mjs`)

The public guide is `docs/bots.md`. The types package beside it:

- **Name**: `@scm-js/bot`, beside `core`, `cli`, `mod`, `replay` (singular nouns; `plugin-api` is the one `-api`).
  Folder `bot/` as `core/` and `cli/` are; `repository.directory` is `bot`.
- **What it holds**: `bot/src/api.ts` and `bot/src/kit.ts`, **byte-for-byte copies** of scm-sim's `src/bot/api.ts` and
  `src/bot/kit.ts` (the source of truth stays there), and `bot/src/index.ts` (ours: `export *` of both). The tarball is
  `dist/index.d.ts`, `README.md`, `LICENSE`, `package.json`: `dts-bundle-generator` on `tsconfig.bot.json` (strict,
  `lib: ES2023`, `types: []`, **`stripInternal`** so `@internal` members are not in an author's completion), no imports.
  **Types only**: `exports` has a `types` condition alone, and the declared values (`BOT_API`, `UnitTypes`, `easyBot`…)
  do not exist at run time; the guide says `import type` / JSDoc. A bot imports nothing at run time anyway (the page runs
  one file).
- **Version**: major = `BOT_API` (the build refuses a mismatch), as plugin-api's major is its API's. Set by hand in
  `bot/package.json`; bump the minor when the copies change, the major only if `BOT_API` does. Not the editor's version:
  the interface does not move with editor releases.
- **Keeping in step**: `node scripts/build-bot-types.mjs --from <scm-sim checkout>` copies the two files (refusing a
  file that imports anything but `./api.ts`), prints the checkout's commit for the commit message, and builds; `--check
  <scm-sim checkout>` fails when the copies differ. Compare against scm-sim's main. CI has no scm-sim, so the comparison
  is by hand, or `SCM_SIM_DIR=<checkout> npx vitest run tests/bot-package.test.ts`.
- **Tests** (`tests/bot-package.test.ts`): the copies import only each other; name, major, `files`, `exports`, no
  dependencies; the bundle builds with `BOT_API = 1` and without the internals; and **every `js`/`ts` block of
  `docs/bots.md` and `bot/README.md` type-checks against the bundle** in a temp folder with `node_modules/@scm-js/bot`
  (checkJs, strict, `noImplicitAny: false` because the guide's Starter indexes `ARMY` by `game.race.name` as plain JS
  does). A block with `export default` is a module (given the JSDoc `EasyBot`, or `BotModule` when it has `create(`,
  unless it has its own); a block with `game.` and no default export is wrapped in `onFrame(game)`; the `api.` listings
  are not checked. A misspelt method in the guide fails the suite. `tests/docs.test.ts` lets `useTech` and
  `useMapSettings` through its hook-name check: they are the interface's.
- **Publishing**: the first version was published by hand (`cd bot && npm pack --dry-run` — prepack builds; four files
  — then `npm publish --access public --browser=false` from `bot/` in a real terminal for the security key's web 2FA).
  Later versions: `build.yml`'s `bot` job on a stable release publishes when npm does not have `bot/package.json`'s
  version, over OIDC. It needs the trusted publisher on npmjs.com for `@scm-js/bot` (this repository, `build.yml`,
  direct publish allowed — the 403 trap in `core.md`), which can only be set once the package exists. The release script
  does not set this version (`desktop-releases.md`).

## Open

- `bot new --js`: a starter folder for a JavaScript bot (`package.json` with `@scm-js/bot` as a devDependency and the
  guide's Starter). `bot new` today runs the Docker toolchain only.
- `bot run` saves no replay (`--replay` would be the natural step; the engine records commands).
- The runner fixes noted above (scm-sim's): count a FireGraft project with no edits as no code; name the bot's player;
  the dropped 11-byte commands of a big group order.
