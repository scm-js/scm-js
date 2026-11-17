# Maps in the game: the engine, `map trace|cost|rush|test|coverage|heatmap|balance`

The commands that play a map (or a replay of it) in the lifted game: scm-sim's exact engine, fetched from the play
page, over the person's own copy of StarCraft. Bots (`bot run`, `bot ladder`) are `cli-bots-plugins.md`; replays in the
terminal and as clips `cli-replays-mods.md`; the same runners in the single executable `cli-distribution.md`.

**None of this runs in CI**: the engine needs the player's own game files. A CI step that skipped without them would
be green on every runner and mean nothing, so neither `init`'s workflow nor the GitHub Action has one (a comment
names the line for a self-hosted runner). Every suite here runs against stand-in runners (`tests/support/mapRunner.ts`:
`FAKE_RUNNER`, `OLD_RUNNER`, `FAKE_TEST_RUNNER`, `stagedEngine`, `classicCopy`), and the real runs are by hand.

## The engine and the copy of the game (`engine.ts`)

- **The runners are scm-sim's**, bundled and staged by its `deploy-play.mjs` as `play/engine/<build>/<kind>-<hash>.mjs`
  and named in **`play/engine/current.json`** (never cached): `runner` (bots, `src/bwapi/run.ts`), `replayRunner`
  (`src/exact/runReplay.ts`), `mapRunner` (`src/exact/runMap.ts`), `matchRunner` (`src/bwapi/match.ts`), plus `mods`
  (the mod overlay version the runners take). `RUNNERS` (engine.ts) maps kind → key, file pattern and the command
  named when a deploy lacks it; `RUNNER_COMMANDS` the doctor's wording. Each runner takes the served engine files and
  the person's copy (Remastered via kascade, 1.16.1 via the three archives) and runs the play page's own start
  sequence in Node.
- **`ensureEngine(at)`**: a folder with `current.json` (a staged deploy, for tests and development), a folder
  without one (searched for runner files), or the page's URL (`SCMJS_PLAY_URL`, default scmjs.dev/play) →
  `<cache>/engine/<build>/` (`cacheRoot`: `SCMJS_CACHE`, `XDG_CACHE_HOME/scmjs`, `%LOCALAPPDATA%\scmjs\cache`,
  `~/.cache/scmjs`). Every runner `current.json` names is fetched, each file written whole via `.part` + rename; gzip
  bodies are gunzipped when the server did not say so. The fetch line goes to stderr (the third argument is ignored,
  kept for callers' signatures). About 25 MB over the wire, ~105 MB on disk. After a fetch, runner files the deploy
  no longer names are removed from the build's folder (`pruneRunners`: only names matching `RUNNERS[*].file`, never
  `.part` files, which a concurrent fetch writes). A build lacking only a runner says "Fetching the newer runners",
  not the whole download. `runnerFor(engine, kind)` is a CliError naming the command when the deploy has none.
- **`MapRunOptions.ready`**: an `Engine` found once, so a command that plays many games (coverage) asks
  `current.json` once and parallel workers never race the first fetch into the cache.
- **`findGameCopy(named)`**: `--starcraft` / `SCMJS_STARCRAFT`, then the usual folders (`usualGameFolders`: Program
  Files, `/mnt/c` under WSL, `/Applications`, wine). A named folder that is no copy, and no copy at all, are exit 2; a
  `SCMJS_STARCRAFT` naming no copy is said once on stderr with the copy used. Commands that print a lot check
  `--starcraft` before printing anything.
- **`startRunner`**: the runner as a child `node` process (one game a process) through `spawnOwned`
  (`cli-shell.md`), stdin a pipe only when the runner is paced. **The runner is passed as `realpathSync(runner)`**: the
  runners decide "am I main" with `import.meta.url === pathToFileURL(process.argv[1])`, Node gives the module its real
  path, and a cache reached through a symlink made the runner do nothing and exit 0. A runner that ends without an
  `end` line → "stopped without a result" with `noResultHint(dir)` (doctor, then remove the folder).
- **Protocol**: JSON lines on stdout — `start`, `text`, `progress`, a mode's own lines, `end`, `error`. Fields are
  added, never changed, so an older CLI ignores what it does not know.
- **A new kind of run is a mode of an existing runner, not a new bundle**: rush, test and `--play` are the map runner's,
  `--events` the replay runner's. No `current.json` key, no `RUNNERS` kind, no doctor row — the start sequence (the
  archive rewrite, the file-search stand-ins, the terrain check) is the same code. **The price: a runner from before a
  mode ignores the flag** and does its default thing, and its `start` line has no `mode` (or no `events`). The CLI
  checks the start line, kills such a runner and says "The game engine at {dir} is from before map rush" (and so on).
  doctor cannot tell a runner's modes apart, so it says nothing of them.
- **Traps of the runners** (scm-sim side, kept here because the CLI meets them):
  - A runner that writes its `end` line and calls `process.exit(0)` at once loses a result past ~64 KB (still queued on
    the pipe). The runners exit from the write's callback; any new runner must too.
  - **A `deploy-play.mjs` staging folder is gzipped** (plain names, gzip bytes, for the host to serve with
    Content-Encoding). Handed as a folder, the runner gets gzip and dies with "SyntaxError: Invalid or unexpected
    token" ("stopped without a result (exit 1)"). Serve it instead: `python3 -m http.server` in `dist-play`,
    `SCMJS_PLAY_URL=http://127.0.0.1:8765/play`, a scratch `SCMJS_CACHE`; `fetchBytes` gunzips. A folder of plain files
    (data/lifted + a bundled runner + a `current.json`) works as a folder. This is how every real run here is done.
  - **The 1.16.1 game's Storm reads no zlib** (it goes down an error path through `FindFirstFileA`, `FormatMessageA`,
    `LoadLibraryA`, which the engine has no stand-ins for). The map runner writes the archive it hands the game afresh
    with mopaq's `Creator` (scenario pkware, members as they are, nameless members dropped), which also covers `.chk`
    and Remastered scenarios. The bot and match runners hand the map's own archive, so `bot run` refuses a zlib/bzip2
    scenario up front (`checkBotGame`); `tests/maps/ums.scx` is the committed map that is zlib-compressed.
  - **Original 1.00 maps (VER 59) reach code the engine has not lifted** (`0x1D007C20` from Storm). `trace.ts#gameMap`
    converts such a map to Brood War into a temp copy as Map Properties would, and the start line says so. The replay
    runner cannot play a VER 59 replay at all, which is why a ladder converts its maps too.
  - `placeStrings` throws without `STRx`, so "remastered" is decided by that section, not by whether
    `classicScenario` changed bytes (a hybrid map changes too).
- **Temporary copies** (`gameMap`): a map from `-` or a converted 1.00 map goes into a temp folder recorded in a module
  `Set`; `runMapInGame` is a `try/finally` that removes the map's folder only if the set has the path, so a person's
  own map is never touched. `removeGameMap` is exported for `runRush`. A copy written but never run (a bad option
  between `gameMap` and the run) is removed at exit by `lifecycle.ts`.
- **Cancelling**: `MapRunOptions.signal` aborted before the start → no runner; during → the child is killed, the line
  loop ends with stdout, CliError "The run was cancelled". **The exit promise is made right after `spawn`**: made after
  the line loop, it could miss a `close` that came first.
- **Words** (`runnerwords.ts`, its own module so `ladder.ts` can use it without an import cycle): `plainRunnerError`
  drops brackets and parts holding `0x…`, "stack words", `x.dll!`, "no stand-in for"; `endReason`/`endDetail` turn a
  runner's end reason that names addresses or frame-loop words into "the game ended", with the raw text under
  `SCMJS_DEBUG`. No message says "the runner is scm-sim's".
- Progress lines of every game command go to stderr.

## `map trace`, `map cost` (`trace.ts`, `weigh.ts`)

- **The runner** (scm-sim `runMap.ts`, start in `mapGame.ts`): the map started as `game: "ums"` with the person's seat
  idle, `installEud` (strings placed when the scenario has `STRx`) → `installCost` → `engine.traceTriggers()` at the
  gate of frame 0. The trace is **folded as it goes** (`traceFold.ts`: a pass per copy is fired / continued — the first
  record an action with the running flag, slot > 0: a Wait let go — / failed, the last failing condition kept as
  `lastFail`; then `forgetAfter(-1)`), so a long run holds one line per copy. Protocol: `start` {map, copy, seed, rows,
  copies, remastered, ms}, `progress` {frame, passes, ms}, `end` {frame, ended, reason, passes, trace, cost, ms}.
  `--no-trace` / `--no-cost` pick the tap.
- **The weigher is the plugin's model, passed by module path.** The cost tap groups records by map row (`rowOf`: the
  copy whose node + 8 + 2400 holds the record) and weighs them with TrigScript's `remasteredCost.ts`, but the runner is
  another process: `cli/src/weigh.ts` re-exports `RemasteredWeigh` as `weigher(memory)`, and `build-cli.mjs` builds it
  **on its own into `cli/dist/weigh.mjs`**; `trace.ts#weighModule` finds it beside the command (hidden `--weigh` names
  another; the single executable writes it out of its assets).
- **A TrigScript/eudplib program's records are in no map row**: such a program leaves the pass countdown alone, so
  "passes" counts "a state or anything noted" (it read 0 otherwise), and the cost report says how many records ran in no
  trigger of the map. Per-line cost for a TrigScript build is the editor's (not offered here).
- **The CLI**: `runMapInGame(map, "trace"|"cost", o)`; `summarizeRows` (copies → one summary per map row: players,
  fired/continued/failed, first/last, lastFail, done); `printTrace` (a table with core's `summarizeTrigger` cut to the
  terminal, then "Never fired" with the condition's name and slot); `costReport`/`printCost` (average and peak ms where
  anything ran, the limits line, the ungrouped line, costliest rows; tiny numbers get more digits). Both open the map
  first (`openForEdit`) for the row text. `traceJson` / `costJson` are the `--json` shapes, used by the command and the
  MCP tools alike.
- **`--replay <rep>`**: the map runner's `--play` mode (scm-sim `mapReplay.ts`). The game starts as the replay
  runner starts one (`playableReplay` for a later game's replay); the taps as above, but **`installTriggerTrace` is
  called directly** with the TRIG of the chk the game runs (the replay engine has no `traceTriggers`) and the runner
  closes each turn itself (`trace.endTurn(frame, …)` as `live.ts#advance` does). `--order [n]` keeps the firing order
  (10,000 by default; `orderDropped` counts the rest). **A map given** is put into the replay (`writeLegacyReplay` with
  the replay's commands and the map's classic scenario): the game loads the map from the replay, so nothing else
  changes. `end` adds `by`, `order`, `check {named, gone, ahead, parted}`, `outcomes`.
- **`gameRun`** (main.ts, shared by trace and cost): with `--replay`, `replayRun(rep, map|null)` gives the scenario the
  report is worded against — the given map's **archive chk as stored** (a built map's built scenario, since that is
  what the game runs), else the replay's — and `differs` = `diffMaps` of the two bare chks with `members` dropped (a
  replay holds none) → `summarizeDiff`. `--frames`/`--every` left at their defaults (`getOptionValueSource`) mean the
  replay's end and a progress line a minute. Rows are listed only for triggers a player in the game owns (an EUD map
  can have 1,700 rows and 5 owned); First/Last as the game clock (42 ms a frame); a ▲ line when the game parted from
  the replay; an ℹ line when the game type is not Use Map Settings (melee runs the game's own triggers: the trace
  holds only row −1 copies). A replay from standard input is refused (the runner reads a file).
- **In a replay the game's local player word reads 0**, so the text lines kept are what slot 1's eyes see. The memory
  is not poked to change that: it would change the game.
- `MAX_FRAMES` (mcp.ts) caps the MCP tools at ten minutes of game, for the result's size.

## `map rush` (`rush.ts`)

The ground distance between every pair of start locations by the game's own pathing.

- **The map runner's `--rush` mode** (scm-sim `mapRush.ts`, walks from `src/analysis/pathing.ts`): `pathingScenario`
  (a neutral Nexus on every start, Create Unit for P1 at location 1 = `testPoint`, five tiles toward the middle),
  `walkUnits`. **One game for every start**: a `StateKeeper` moment before the first turn; for each later start it is
  restored and location 1 moved in the game's own table to that start's point before the trigger runs — measured
  identical to a game started for that start alone, to the frame and pixel. OWNR slot 1 is made Human in the copy (the
  unit is P1's). units.dat's flags are read from the copy before the game starts, so a flyer or building is refused at
  once ("The Mutalisk does not walk", exit 2). < 2 starts is refused before the game.
- **The runner walks every unit of the local player** (the asked type first), so on a map with pre-placed units for
  P1 it reports a walk per unit per pair — Carriers "arriving" by air, pre-placed SCVs — and sometimes no walk of the
  placed unit at all. The CLI takes, per pair, the walk of the asked type that set out nearest the from-start; none →
  `unwalked` (with `instead` when other units were walked); progress lines are buffered per pair for the same reason.
  The real fix is scm-sim's (walk only the units `pathingScenario` placed).
- **The CLI**: `unitByName` (an id; the editor's name or without the race, case and spaces folded; else a unique
  prefix; else a CliError listing up to six, exit 2 — "Siege Tank" is four units); the map through `gameMap`. Starts are
  labelled by player and `clockOf` (the angle from the middle as a clock hour — geometric, so a base people call 9
  o'clock may read 8). The matrix "px, s" splits into a seconds and a pixels table when wider than the terminal.
  Shortest/longest by pixels; seconds = frames × 42 ms, rounded once (`secondsOf`); pairs with no ground between them
  merged both ways; every pair apart → "an island map".

## `map test`: scenarios for a map's triggers (`maptest.ts`)

Scenarios from a JSON file (`<map>.tests.json` beside the map by default), each one game with setup, timed steps, a
frame count and expectations; a replay of each failed scenario. Sample: `tests/maps/ums.tests.json` (its third
scenario fails for a real reason: ums.scx has no ground, so a Marine is unplaceable).

- **JSON, not YAML**: no dependency (the bundle is one file), `JSON.parse` is exact, map makers see JSON in every
  `--json`, editors validate it. Keys starting `//` are comments. A top-level list is the scenarios; top-level
  `frames`/`seed` are defaults. `onlyKnown` refuses unknown keys at every level with the nearest key (Levenshtein ≤
  max(2, len/3)); a scenario with no `expect` and duplicate names (case-folded) are refused in `readTests` — not in
  `planScenario`, which tests and `recordTest` call with partial scenarios. Every error is exit 2 naming the file,
  scenario and path, raised before any game starts.
- **The decision that shapes it: setup and timed effects are triggers of the map copy, not memory writes.** The
  runner could poke memory between frames, but a replay records only the command stream: a poked game would not play
  back as it ran. So `planScenario` builds a copy from **the archive as stored** (`readArchive`: a built map keeps its
  built triggers, which is what the game runs), prepends the setup (one trigger per 64 actions, condition Always,
  owned by `firstInGame` — the first OWNR 5/6 slot, whose list the game walks first) and appends one trigger per timed
  effect with `Elapsed Time ≥ ceil(at / 16)` (a game second is 16 frames at every speed, and "at least k" first holds
  at the pass whose frame's sixteenth is k, so an effect never lands before its frame; passes are 31 frames apart). Map
  rows in the trace are shifted by the setup's count when judged; the report shows the map's numbers. **No strings are
  added** (no Comment on the test's triggers), so STR/STRx stays byte-identical and an EUD payload placed in the
  strings is not moved (checked on EUD probe maps); a raw `action` that names text does intern, the user's choice.
- **Verbs**: setup and steps share `create`, `kill`, `remove`, `give`, `switch`, `minerals`/`gas`/`deaths` (`"+n"` /
  `"-n"` add), `action` (the trigger window's text form, parsed inside a wrapper trigger — any action). Steps add
  `order` (move/attack/patrol/stop/hold, the person's units of a type in a location) and `chat` — the person's own
  commands, so they are in the replay's stream. Names through `triggerNames(scn)` with `unitByName` as the fallback;
  triggers by number or Comment (`triggerComment`, core).
- **Expectations** (`judge`, pure): trigger fired (a number = exactly, `">= n"`, true/false), switch, deaths,
  minerals/gas, units (a count the runner answers), text (substring of any line shown; **decoded with the map's
  encoding**, `shownText` — the runner hands bytes as char codes, and a Korean map's text could never match before),
  outcome per player, ended. Each result is `{what, ok, actual, value}` with words both ways, using the trace's own
  explanation ("it never fired: Bring (condition 1) said no last, at frame 591").
- **The runner's half** (scm-sim `mapTest.ts`, `runMap.ts --test <spec.json> --replay <out.rep>`): steps handed over
  while the game stands at their frame (orders through the live engine, twelve units a command, picked by centre in
  the location as the game's table has it *now*; chat as a 0x5C command); text every frame (capped at 500). **The end
  is read with the game's own condition routines**: a 20-byte condition record in game memory, the condition table's
  routine called with the current player set to the person, binary-searched on "at least k" for counts — so "in the
  location" is exactly the map's own rule (unit box, elevation flags, carried units). Switches, deaths, resources read
  directly. The replay is `liveReplay(game, chk)`: the scenario the game ran, with the test's triggers.
- **The CLI's run** (`runTests`): a temp folder and one runner process a scenario; the failed scenario's replay
  copied to `--out` (default `<map>.tests/`) as `<tests stem>.<slug>.rep` (`slug` NFC, not NFKD — NFKD split Hangul into
  jamo), and a passing scenario's old replay removed. "the game said:" lines are the game's `WARNING:` lines
  (unplaceable units), which explain most surprises. Formats in `report.ts` (`githubTestAnnotations` with `line=` the
  scenario name's line in its file, found by `JSON.stringify(name)`; junit a case per scenario; SARIF a rule per
  expectation kind). Running scenarios in parallel would work (one process each) but is not done.
- **A mod**: `map test --mod` and `mod test <mod> <map>` share `mapTestAction`; the failed scenarios' replays are tagged
  with the mod (`tagModReplay`, `cli-replays-mods.md`). `mod test` does not offer `--clips`, and `map test --mod --clips`
  draws the clips on the play page without the mod, so a clip of a mod that changes units can go out of step — not
  guarded.
- **Replay-driven scenarios** (`{ "replay": "x.rep" }`, relative to the tests file; `replayOf` checks it at plan time):
  `setup`/`steps` refused; run to the replay's end unless `frames`, as `[map, --test, spec, --play, rep]` (no seed, no
  replay kept). **`-u`** touches only replay-driven scenarios and only failed entries: `VALUE_KEY` per kind gets the
  game's value; a loosened comparison that still holds stays, deleted entries stay deleted (Jest-like snapshots that
  respect trimming); the file is rewritten with `formatTests` (one plain object a line, so trimming is deleting lines;
  hand formatting is not kept). **`record <map> <rep>`** plans with placeholder unit entries (Men and Buildings per
  playing player), runs it, builds `snapshotExpect` (owned triggers with counts incl. 0, switches, non-chat lines —
  `/^[^\x02:]{1,40}:\x02/` is chat — 20 at most, outcomes, ended, unit counts, resources, every death count), judges it
  against the same end, drops any entry that would not hold, and writes it (the same name replaced). A melee replay's
  game runs the game's own triggers, so its snapshot would hold no trigger counts (not tried).
- **`--clips [folder] [--clips-format gif|webm]`** (`clips.ts`): after the verdict (the summary line prints first),
  each failed scenario with a kept replay is exported (`exportReplay`, `cli-replays-mods.md`) over `clipWindow(end
  frame, length)`: 8 s before to 2 s after, inside the game; named `<tests stem>.<slug>.<kind>` in `<map>.clips/`. (`--clips`, not `--video`: one file a failure,
  and the kind is its own option.)
  **Missing machinery is said once**: no browser found → one `▲ No clips: …` line, nothing tried; the first CliError
  from export (page too old, browser crash, no game files) → the same and the rest untried, since such causes repeat.
  The exit code stays the tests'. A replay-driven scenario gets "no clip … it plays bug.rep". `--json` adds `clips` and
  `clipsMissing`; the CI formats name `clip: <path>`.
- **Measured**: a scenario costs about 2 s (1.5 s load, 0.3 s start, the frames). A scenario failed on purpose ended at
  the same frame live and in its kept replay played back by scm-sim's replay runner, with the same outcomes.

## `map coverage`: which triggers fired across many games (`coverage.ts`)

- **Coverage = `map trace --replay` per replay, added up**, plus the map's tests (`--tests`, or any `.json` among the
  sources). `replayFiles(paths, deep = true)`, dedupe by sha256, `matchReplay` against the map (same scenario, else same
  name + size; `--any-map` takes the rest — heatmap's rule, so a newer version of a map still takes the old replays),
  then **non-UMS replays are left out before anything runs** (`header.gameType !== 10`: in melee the game runs its own
  triggers). Each taken replay → `gameMap` (a 1.00 map converted per run, since `runMapInGame` deletes its temp copy) →
  `runMapInGame(map, "trace", { replay, order: true, every: 0, ready })`. Workers as heatmap's. An "older runner" error
  aborts the run; any other error is that replay's (left out, exit 1); none played → CliError.
- **Rows owned vs not**: `gameRows` folds a game's copy lines per map row; `addGames` sums games-fired-in, firings, first
  firing, latest `lastFail`. The table, the counts and `--strict` cover only rows a player in at least one game had a
  copy of; "N more owned by no player in these games" is said, `--all` lists them, the JSON has `owned: false`. A
  trigger for P8 cannot be expected to fire when no game had a P8, so it does not fail `--strict`.
- **A parted game counts up to the parting**: `--order` is always asked, so firings with `frame < parted` count; past
  what the order kept, a copy whose `firstFired < parted` counts once; `lastFail` after the parting is not used for
  "why". Tests driven by a replay have no order: the `firstFired` rule only.
- `--tests` runs after the replays, one at a time (`runTests` is sequential; it asks `ensureEngine` again itself);
  pass/fail is ignored (that is `map test`'s job); their replays go to a temp folder that is removed; their setup
  triggers are shifted out (`shift = p.before.length`).
- Output: a line per game as it ends, the summary, the table (cut at 40), "Never fired" with `neverWhy`. CI forms
  (`CoverageForm` in report.ts): github a warning per never-fired (error with `--strict`), junit a case per owned
  trigger (`<skipped>` / `<failure>`), SARIF `scmjs/coverage-never-fired` and `scmjs/coverage-parted`. MCP
  `map_coverage` stops its games through the request's signal; no progress notifications (`every: 0`).

## `map heatmap`: where things happened (`heatmap.ts`, `heat.ts`)

- **The replay runner's `--events` mode** (scm-sim `replayEvents.ts`): a bare flag, special-cased in the runner's
  `parseArgs` so it never eats the next argument (the CLI passes the replay path first anyway); runs free to the end,
  no `frame` lines, no stdin; `start` gains `events: 1`, then `death` {frame, unit, player, x, y, by}, `built`, `walk`
  {frame, units…} every 24 frames, and `end` gains counts. An older runner sends a `start` without `events` and waits on
  stdin (closed); `playForEvents` kills it.
- **Deaths are the game's own count**, not "a unit left the lists" (loading, Archon merges and removals also do that):
  each frame the deaths table is diffed with the frame before, and each rise is matched to a unit of that type and owner
  that left the lists (or whose slot came back with another uniqueness byte) within 8 frames either way, placed where it
  last stood. The killer is the record's last attacking player, read after the death when the slot was not reused.
  **A Drone into an Extractor is not a death** in the table. Buildings: a building type owned 0–7 that is new, or whose
  type was not a building the frame before (a Drone), or whose owner was neutral (**a geyser becomes the refinery in the
  same slot**). What stood at frame 0 is not counted. Walks: non-building units whose tile changed since their last
  sample. The tracker's cost is below the machine's noise.
- **The pure half (`heat.ts`)**: `GameEvents` (flat number lists), `matchReplay` (sha256 of the map's
  `readArchive().chk` — or the bytes of a bare `.chk` — against the replay's chk: same; else same name + size; else
  `--any-map`), `heatPoints` (deaths skip `NOT_A_LOSS` = Scarab, Nuclear Missile, Disruption Web, Dark Swarm; kills need
  a killer other than the owner; `--player` a number = slot n−1, a name per game; paths take army only — workers'
  mining lit every mineral line; points off the map dropped into `outside`), `heatField` (a quarter-tile grid whatever
  the picture's size, Gaussian blur; `top` = the 99.5th percentile of warm cells so one hot spot does not darken the
  rest), `heatColor` (magma's stops, alpha from a floor; **linear t** — √t on top of the alpha's √ was a wall of
  orange), `greyGround` (luma × 0.5: a tileset colour must not read as heat). `heatPicture` draws grey terrain,
  resources under the heat, starts framed over it.
- **The cache**: `cacheRoot()/heatmap/v1/<sha256 of the replay>.json.gz`, written only when the runner reached the end;
  duplicates by hash skipped. Every filter runs from the cache, so only new replays are played. The walks are most of
  its size.
- **Parallel**: `defaultParallel` = min(4, cpus/2, GB of memory); a runner peaks at ~750 MB resident whatever the game's
  length. A line per replay as it is done (to stderr under `--json`/`--out -`; an updating "playing …" line on a TTY).
  All unreadable or none found → exit 2; some → left out, exit 0; a game that could not play → exit 1, the rest drawn.
  Mod replays are skipped (`modReplayReason`).

## `map balance`: are the starts fair (`balance.ts`)

- **What the match runner cannot do**: no computer against computer (`runMatch` throws "a match needs a bot"), so
  `--bots` is required (one bot plays the game's computer); **no fixed starts** (the game is started as `{ game:
  "melee", seed, opponents }` and deals the start locations; no line carries a position). Fixed starts would need a
  per-side start in the runner's arguments (e.g. `--bot file|race|data|start`), applied by each seat to the melee
  start assignment before the starting units are placed, and `players[].start` in the `start` line; computer against
  computer would need the relay to run one copy with no bot seat.
- **So the starts are read back from the replays**: every game's replay (the ladder's `playGame`, into `--out` or a
  temp folder) is played by the replay runner's `--events` (`playForEvents`, a few seconds a game). `dealtStart`: the
  centroid of a slot's units in the first `walk` sample it appears in (the workers setting out) → the nearest start
  within 20 tiles; else its first `built`. `firstContact`: the first death whose owner and killer are both the game's
  two slots and differ (`NOT_A_LOSS` skipped).
- **Rows** (`balanceReport`): per start, the games a side was dealt it, won/lost/undecided, win rate, **expected** = the
  mean of each side's own share of decided wins (so a stronger side dealt a start more often does not read as a strong
  start), margin = 1.96 √Σp(1−p) / n, average length and contact, the rush walk (`map rush` first, on its own copy;
  `--no-rush`), and `mainResources` (every field and geyser assigned to its nearest start within 12 tiles).
- **Verdict** (`verdictOf`): too few (< 2 starts with decided games); one-sided when every side won or lost all its
  decided games; balanced when every start is within 10 points of expected; chance when the worst is within its
  margin; else the start, its rate, the expected, and the static number that differs most (gas, minerals, distances,
  rush walks, first contact) said as a fact.
- **A bot against itself plays each seed once** (`mirrorOnce`, by the bots' bytes): both lobby orders of one seed gave
  the same starts and nearly always the same winner, so the pair counted one game twice and the margin was too small
  (a start was called unbalanced on what was three games).
- A game is 10–60 s of wall time and a seat ~1.3 GB resident; `map balance` is a few minutes for a dozen games.
  Measured verdicts were honest: a mirrored generated map flagged one start at p ≈ 0.03, which is the bot's play from
  that corner or chance — read the margin.

## Open

- **`scmjs dap`** (designed, not built): a Debug Adapter Protocol server running a map with breakpoints on triggers or
  TrigScript lines. The map runner is one-way (argv in, JSON lines out: no pause, step, or memory read); the play page
  can (`scmjs.play.control`, scm-sim `web/handoff.ts`) but only over `postMessage`; TrigScript's debugger
  (`compiler/gameDebug.ts`, `debugModel.ts`) records one test run through a `DebugHost` the play page implements and no
  Node runner does. Two slices, each needing a scm-sim runner change first: (1) **TrigScript lines, recorded** — a
  runner mode that loads TrigScript's `dist/gametest.js`, implements `DebugHost`, runs one test and writes the
  `DebugRecording` as its end line; `dap.ts` = `compileScript` with tests, then a `DebugCursor` over the record
  answering DAP (`setBreakpoints` → `DebugPlace`s by the script's path in an unpacked map; step-back free since the
  record goes both ways; threads = programs; variables = `DebugProgram.values`; deaths and switches need a per-frame
  snapshot added by the runner). (2) **Triggers, live** — the map runner reads the play page's control set on stdin and
  writes its per-pass triggers line; threads = trigger owners, frames = trigger rows, breakpoints on trigger names or
  `map triggers export` lines, variables read through a `read` control. Both are DAP over stdio with LSP's framing, so
  `vscode-jsonrpc`'s stream reader/writer (bundled for `lsp`) would carry it.
- The map runner: `--by-origin` / per-line cost for a TrigScript build; `--order` for `map cost`; a player leaving and
  the computers' commands in `map test`; expectations at a frame (only the end today, and text/trigger counts over the
  run); the campaign maps.
- `ensureEngine` could take the runner a command needs and check `current.json` before fetching, rather than fetching
  the whole engine and then saying the deploy lacks the runner. Old build folders (~105 MB each) are never pruned: a
  game of another scmjs may be using one.
- `map rush`: the path itself (the runner keeps a point every 64 frames and does not send it); several units in one
  run; the walk-every-unit fix in scm-sim.
- `map test`: scenarios in parallel; a replay's start date is 0 (1969 in `replay info`), as the play page's Save Replay
  leaves it.
- `map coverage`: a per-game breakdown in text; caching a replay's result (key: map scenario hash + replay hash + engine
  build + `--order`) as heatmap caches events — it would only help unchanged maps, since a trigger edit changes the
  key; a coverage ratchet against a baseline.
- `map heatmap`: a legend inside the PNG; per-race or per-matchup filters; a player's fog (`--view`); mod replays.
- `map balance`: fixed starts and computer-vs-computer in the match runner; balance over several maps at once; a
  `--pairs` copy with only two start locations was decided against as the default (the AIs scout fewer places, so
  first contact would read early).
- MCP tools for `map rush`, `map test` (and `record`) and `map heatmap`. (`map_trace`/`map_cost` take `replay`,
  `order`, `every` and `mod`.)
