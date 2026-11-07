# The `scmjs` command line

`cli/` is the npm package **`@scm-js/cli`** (its command is `scmjs`): `scmjs about | doctor | info | map info|check|open|new|dump|find|fetch|set|resize|triggers|strings|diff|build|run|unpack|pack|trace|cost|rush|test |
replay info|open|watch | plugin new|check|dev | bot new|init|build|update|run`, or `npx @scm-js/cli …`. npm refused the plain name `scmjs` on the first publish (2026-11-06,
E403 "too similar to scss, sockjs"), so the user chose the scope beside @scm-js/replay and @scm-js/plugin-api. The reader's page is `docs/cli.md`. The shape was the user's (2026-11-05): one command, a noun for
each kind of thing (`map`, `replay`, `plugin`, `bot`), "an impressive UX tool … not overly engineered".

## Design

- **The editor's code, not a copy.** Maps are read with `openMapFile` (`services/mapIo.ts`): built maps restored,
  members read, warnings — what the editor would show. Statistics are `mapStatistics` with no tileset/dat (so no
  terrain table, no building counts); the check is `validateScenario(scn, { extras })`, so the rules that need the
  tileset or units.dat (units on unwalkable ground, …) do not run. Strings go through `t()`, which is English in
  Node. Replays are read by **`@scm-js/replay`** (github.com/scm-js/replay, ~/github/replay), extracted 2026-11-05
  from Aftermath's `replay.ts` at the user's "extract replay" so the CLI and Aftermath share one reader (there had
  been three copies: Aftermath, a CLI copy, and scm-sim's own `src/replay/`, which feeds the exact engine and was
  left alone). It is a devDependency here, bundled into the CLI; the editor app does not import it. APM in
  `cli/src/replay.ts` copies Aftermath's `analysis.ts` rule (no system/chat/leave; until the player left) so the
  two agree (227 vs 226 before).
- **On `@scm-js/core`'s surface** (2026-11-06, `core.md`): `tests/core.test.ts` refuses any `import { … } from
  "../../src/…"` in `cli/src` that is not a name `core/src/index.ts` exports from that module, so the command stays a
  thin layer over the library and a new need is an export first. Maps are opened with `openMapBytes`
  (`src/editor/mapFile.ts`, the byte-level half of `openMapFile`) into an `OpenedMap`, not a `LoadedDocument`.
- **One file.** `scripts/build-cli.mjs` is a Vite SSR build with `ssr.noExternal: true` and `codeSplitting: false`
  (rolldown's name for inlineDynamicImports) → `cli/dist/scmjs.mjs` (~670 KB, shebang). commander, picocolors and
  @scm-js/replay are devDependencies of the root bundled in, so the published package has no dependencies and `npx` fetches one file.
  The version is the editor's (`package.json`), written into `cli/package.json` by the build; commit and build date
  are `define`d. **Licences**: the build's `scmjs-cli-notices` plugin reads the bundle's module ids for
  `node_modules/<pkg>` and writes `cli/dist/THIRD-PARTY-NOTICES.txt` with `cliNotices` (`scripts/lib/notices.mjs`,
  throws on a package with no licence file); `cli/LICENSE` is a copy of the root one. Today: @scm-js/replay,
  commander, fflate (via mopaq), mopaq, picocolors; ATTRIBUTION.md has a table for them. Added 2026-11-06 just
  before the first publish, which had gone without either (the publish failed on 2FA first). commander 15 needs Node ≥ 22.12 (`engines`).
- **Type-checked** by `tsconfig.cli.json` (in `tsc -b`'s references): `types: node, vite/client`, `cli/src` only
  (it pulls in the `src/` files it imports). `tests/cli.test.ts` covers the pieces; `npm run cli -- …` runs it.
- **Output** (`cli/src/ui.ts`): picocolors decides colour (`NO_COLOR`, `FORCE_COLOR`, `--no-color`, a pipe). Marks
  ✔ ✖ ▲ ℹ fall back to ASCII on the old Windows console. `rows()` aligns label/value pairs (`null` = blank line,
  one width for all groups); `table()` pads by visible width. `gameText` turns StarCraft's colour bytes into 24-bit
  colour only when `COLORTERM` says truecolor, else drops them; replays colour player names by the replay's colours.
  `--json` everywhere: one object, or a list for several files. Exit codes: 1 failed check / error, 2 a missing or
  wrong-kind file. A failing file in a list is reported on stderr and the rest go on.
- **The overview's banner** (`cli/src/banner.ts`, 2026-11-06, the user's "the scmjs wireframe in ascii art"): only
  the root help (`scmjs`, `--help`, `help`) — `configureHelp({ formatHelp })` in main.ts sends `!cmd.parent` to
  `rootHelp` and everything else to `Help.prototype.formatHelp`, so `scmjs map --help` is commander's. `GLOBE` is
  the app mark (favicon.svg / AppLogo.tsx, the splash's sphere) in braille, 16 × 8 cells: starfield.ts's
  `buildSphere(6, 8)` (the logo's own 12 segments are a blur at this size), rotY 0.3, rotX −0.45, near half only
  plus the outline, rasterised to 32 × 32 dots by a throwaway script and pasted in as a literal; blank cells are
  spaces, not U+2800. Coloured #a06cf0 with truecolor, else magenta. `GLOBE_ASCII` (hand-drawn, `=` for the bright
  equator) replaces it where `ui.ts`'s `unicode` is false; with the text wider than the terminal the globe is left
  out. The root help is held to 23 lines (a 24-row terminal keeps the globe on screen): the options are one line and
  the old Examples block went (docs/cli.md has examples). main.ts exports `program` and skips running it under
  `VITEST`, so tests/cli.test.ts reads the real help.

`about` asks `registry.npmjs.org/@scm-js/cli/latest` (2 s timeout; besides it only `doctor` (the same call), the engine
fetch of the game commands and `map fetch` (scmscx.com, below) touch the network) and
shows **Newest**: the install line when this is older (`olderThan`, numeric x.y.z), "this one", "<v> on npm" for a
build from a clone, or "could not ask npm". Only `about` asks, so no command is slowed or nags (the user's ask,
2026-11-06, after "how do they update").

## Bots (`cli/src/bot.ts`)

`scmjs bot new|init [project]|build` = `docker run --rm -i(t) -v <cwd>:/bot -e SCMBOT_FOLDER=<folder name> [-u uid:gid,
not on Windows] ghcr.io/scm-js/scmbot <args>` (SCMBOT_IMAGE overrides), stdio inherited, the toolchain's exit code
passed on; `update` = `docker pull`. Says "not installed" vs "not running" from `docker --version` / `docker version`.
The toolchain lives in the public github.com/scm-js/scmbot (its README is the guide), mirrored from scm-sim's
native/ — see scm-sim's docs/own-bots.md. Added 2026-11-06 with "Made by Jeany", Docker, Play and Bots in `about`
(the user's ask). `SCMBOT_COMMAND=scmjs bot` makes the toolchain's messages say `scmjs bot build` (scmbot#1).

## Plugins (`cli/src/plugin.ts`)

- `plugin new [name] [--dir]` writes `plugin-<id>/` from `pluginFiles`: Hello World's layout (manifest with
  `build: dist/plugin.js`, `plugin.ts` with a Tools item and a pane, `ko.ts` + `tests/ko.test.ts`, tsconfig as Hello
  World's, the shared `scm-js/.github` plugin CI without `secrets: inherit` (its push falls back to GITHUB_TOKEN),
  README, MIT LICENSE with `git config user.name`). package.json has `start: scmjs plugin dev`, `check: scmjs plugin
  check` and `@scm-js/cli ^<this version>` as a devDependency. Verified: npm install, test, typecheck, build pass.
  Trap: a comment in the starter that says `t("…")` is read by the catalogue test as a string.
- `plugin check [folder]` = the loader's view: `validateManifest`, api vs PLUGIN_API_VERSION, icon (`resolveIcon`
  against a fake base to tell a file), entry, build present and newer than the sources; with no build, relative
  imports followed (`./x.js` → x.ts, dir/index) and package imports refused, as the source loader does. `--json`,
  `--all`, `--strict`, exit 1.
- `plugin dev [folder] [--port 5310] [--no-open]`: `npm run build` first and on change when the manifest names a
  build and package.json has the script (else the source is served as is), then the check; a loopback server with
  CORS, `access-control-allow-private-network`, no-store, no node_modules/.git, nothing outside the folder; SSE at
  `/__scmjs/events`; fs.watch recursive, debounced, ignoring node_modules/.git and the build's file and folder (a
  removed dist/ otherwise built twice). The editor's half: plugins-loading.md, `?plugin-dev=`.

## Maps in git (`cli/src/exchange.ts`, `diff.ts`, `completion.ts`) — 2026-11-06, first slice on `@scm-js/core`

- `map triggers export|import [--briefing] [--append] [--out]`, `map strings export|import [--out]`: the editor's
  `exchange.ts` (`triggersToText`/`readTriggerFile`/`encodeTrg`, `formatStringTable`/`parseStringTable`/
  `applyStringImport`) behind `exportTriggers`/`importTriggers`/`exportStrings`/`importStrings`. Text to stdout unless
  `--out`; `.trg` by extension needs `--out`. A `TriggerTextError` becomes a CliError "file, line N: …" and nothing
  is written. **`writeBack`** writes in place unless `--out`, with `defaultSaveOptions(scn, origin, path)` — the
  editor's own Save As rule (as-opened compression + encryption, StarEdit layout for a bare .chk), extras and stored
  members carried — format from the output name's extension, else the input's.
- `map diff a b [--json] [--all]`: `diffMaps` → groups header/players/forces (field a→b), units (multiset by the
  record minus `serial`), locations (by index; unplaced both sides = nothing), triggers + briefing (multiset by
  `fingerprintTrigger`, text by `summarizeTrigger` cut at 110), strings (by index; **null and "" are one thing** — a
  string appended past the end pads the table with gaps that come back as "" on reopen, which read as 79 additions
  before), members (name-normalised, byte compare), sections (**bytes as they would be written**:
  `parseChk(serializeScenario(s))`, since `scn.chk.sections` holds the bytes as parsed and an in-memory edit only
  marks dirty — the first version compared `scn.chk.sections` and saw no change after an edit). Exit 1 when
  different, like diff(1); docs say so under exit codes. Lists cut at 20 unless `--all`.
- `completion bash|zsh|fish` (**hidden** from the overview so the root help stays within 23 lines; documented, and
  `scmjs help completion`): `commandTree(program)` walks commander (`cmd.options` minus hidden, `cmd.commands`
  minus `_hidden`/help) and three generators write the scripts, so a new command is in them with no list. bash:
  nested `case` on the typed path → `compgen -W`, else files; `bash -n` in the test. zsh: one function per command,
  `_arguments -C` + `_describe`. fish: `__fish_seen_subcommand_from` chains; options as `-l`/`-s`. zsh/fish are not
  syntax-checked here (neither shell is on this machine).
- **Overview term cap** (`main.ts` `TERM_WIDTH` 28): a noun with many verbs shows `map info|check|open|…` so the
  description column stays beside it and the banner's 80×23 holds; the noun's own help lists all. The test in
  cli.test.ts skips hidden commands and asserts the ellipsis.

## TrigScript build (`cli/src/build.ts`) — 2026-11-06, second slice

- **The spike's answer: the plugin's compiler runs in Node as it is.** `plugins/trigscript/compiler/**` and `script.ts`
  are DOM-free (the plugin's own `scripts/build-fixture.mts` builds probe maps under Node), so the CLI imports the
  *vendored* source at the editor's pin (`plugins/trigscript/`, `vendored.json`) and Vite bundles it: `scmjs 0.8.x`
  builds exactly what the editor 0.8.x builds. The bundle grew from ~750 KB to ~3.1 MB (the compiler is ~2.3 MB).
- **TypeScript is not bundled** (10 MB; `npx @scm-js/cli info` must not download it): `loadTypeScript` resolves
  `typescript` from the working directory's project, then from beside the command (`createRequire(import.meta.url)`
  — a clone, or a global install beside a global TypeScript), then from `npm root -g`; missing → CliError with the
  install line. The compiler takes `ts` as a parameter (`compileScript(ts, …)`) and imports it `import type` only,
  so nothing in the bundle pulls it. The standard library text is built from the found TypeScript's `lib/` the way
  `bundle/lib.mjs#defaultLib` does (`lib.es2023.d.ts` + references). The user chose this over fetching
  `typescript.js` from jsDelivr (the editor's worker does that); add the fetch only if people ask.
- **The editor's order, headless** (`buildMap`): `scriptState` (no files → CliError; stale block → CliError, the
  editor's `bringUpToDate` refuses too); names from the scenario with core's `usedLocations`/`locationName`/
  `forceName`/`readSwitchNames`/`unitCustomName`/`soundList` into `scriptNames` (what `service.ts#names()` reads off
  the API); settings `readSettings(extras)`; libraries = the map's copies only (`readLibraries` + `libraryImports`;
  an import with no copy → CliError: apply in the editor once); `compileScript(…, { lib, libraries, sounds: !check,
  tests: --test || testsGuardBuild ? { world } : undefined })`; `testWorld` is a port of `service.ts#world()` with
  unit stats only where UNIS/UNIx overrides (no units.dat here — documented); failing tests → `ok: false`;
  `finishSounds` with `loadVorbis` (project's `wasm-media-encoders/wasm/ogg.wasm` by walking up from cwd, else the
  plugin's `dist/vorbis.wasm` from jsDelivr at `VERSION`); `buildScript(list, extras, files, compiled, internString)`
  → `applyTriggers` + `doc.extras = plan.extras` (the block, files, manifest, sounds — the editor's Apply);
  no programs → `writeBack`; programs → `defaultSaveOptions` + `planSave` + `buildChk` → `buildOwnMap({ chk,
  compiled: {ir, strings, input, triggers: []}, settings })` (refused → CliError) → `packBuiltMap({ sourceChk, extras:
  keptExtras, stored, built, steps: [{ id: "trigscript/build", label: "TrigScript" }], options })`. A `.chk` output
  with programs is refused as the editor refuses it. Magenta's member (`magenta\magenta.json`) → CliError: the
  contributions API is the editor's; the CLI has no plugins running.
- **Trap (CI failed first, run 42320575013): `plugins/` is gitignored and vendored by predev/prebuild**, so a plain
  `npm test` on a clone has no compiler. Fixes: `build.ts` loads the plugin's value modules lazily in one
  `trigscript()` (`import()`s, inlined by the bundle's `codeSplitting: false`; `import type` stays static), so
  `main.ts` and the other CLI suites load without them and a missing module is a CliError naming `npm run
  vendor:plugins`; `tests/cli-build.test.ts` is `describe.skipIf(!have)` like the game-data suites; the `web` job
  runs `npm run vendor:plugins` before `npm test` (so CI does run them); `build-cli.mjs` vendors when
  `plugins/trigscript/vendored.json` is missing, and the `cli` job passes `GITHUB_TOKEN` to it.
- **Core exports added for it**: `readSwitchNames`, `soundList`/`SoundRow`, `buildChk`, `keptExtras`, `buildMapFile`,
  `packBuiltMap`/`PackInput`. `tests/core.test.ts`'s CLI list now names every `cli/src` module (exchange, diff,
  completion had been left off the list and were not being checked; all pass).
- **Output**: `✔ name: N triggers → #a–#b · N programs (Remastered) · N sounds · N tests passed · written to … · size
  TrigScript 4.1.0, TypeScript 6.0.3`; diagnostics as `main.ts:3:27 error …` (tsc's shape); failing tests with name
  and line; exit 1 and nothing written on either. `--json` is the `BuildOutcome` plus `file` (the build log in
  `log`). `tests/cli-build.test.ts` (7 tests, ~2 s): names/world, triggers + test + idempotence, error, failing test
  + `--check`, programs (reopen: `builtBy` TrigScript, source restored, raw CHK has the payload's triggers), `.chk`
  refusal, no script. E2E from `/tmp` with the dist worked first time.

## Plugins over a map (`cli/src/run.ts`) — 2026-11-06, third slice

- **Flaky CI fixed 2026-11-07 (run 42333075108 on #137; main's run after #134 failed the same way):** the log wakes
  listeners on a `setTimeout` (coalesced), so whether the host's `logInfo(info.name, "Update: Rename")` records
  reached the sink before `dispose()` was timing — 4 events locally, 6 on CI. Two changes: `attachSinks`'s detach
  **flushes** the log first (deterministic, tested with a `logWarn` before detach), and `run.ts` prints only
  `warn`/`error` entries — the info tier is the host's own trace (edit records, command timing), which the status line
  already said; `api.log` is `console.log`, so a plugin's own output reaches the terminal regardless.

- `scmjs map run <plugin> <map> [--command id] [--arg v...] [--out] [--dry-run] [--json]`: `runHeadless` from
  `src/plugins/headless.ts` (design and traps in `plugins-host.md`, "The host without the editor"); the Node half
  (`nodeLoaderDeps`, `sourceFor`) is in `run.ts`, since the editor's tree has no Node types. The target is
  `sourceFor`: an existing path → `file:` source (folder → `plugin.json`, `.json` → manifest, script extension →
  entry), else `parseSpec` (github:/URL). Events (status, toasts, log lines that are not the host's own info) are
  printed live in text mode and kept in the outcome for `--json`. After `activate` (and the command), `modified()`
  decides: changed → `diffMaps` against the input bytes reopened, for the one-line summary (`summarizeDiff`) and the
  full `--dry-run` listing; written with `writeBack` unless `--dry-run`; `--out` writes even an unchanged map (asked
  for). Errors: loader's `PluginLoadError` → CliError with the `plugin check` hint; a throw in `activate` → "failed in
  activate: …"; an unknown command lists the plugin's own. `activate`'s return is its deactivation, not a result
  (the test first expected data from it — wrong); only `--command`'s return is `result`.
- **Bundle trap**: the first build with the host in it was 6.2 MB (from 3.1): `host.ts` imports `builtin.ts`, whose
  `import.meta.glob` of every vendored plugin's `plugin.ts` is inlined whole by `codeSplitting: false` — TrigScript's
  workspace, Aftermath, the AI assistant, React. `build-cli.mjs`'s `scmjs-cli-leave-out` plugin resolves
  `src/plugins/builtin.ts` to empty tables and `ko.json` to `{}` (as `build-core.mjs` does): 3.66 MB, i.e. the host
  and atoms cost ~0.5 MB. React (~50 KB) is still in: `host.ts` and `services/gameData.ts` import helpers from
  `hooks/useDoodadTools|useSpriteTools|useMapFileActions`, which import React and jotai's hooks, so aliasing `jotai`
  to `jotai/vanilla` breaks the build (tried) — moving those helpers out of the hook files would take it out. `tests/cli-run.test.ts` (5 tests): sources, a JS plugin folder (events, diff, written, reopen), `--command` +
  `--dry-run` + unknown command, an unchanged map and a `.ts` script through TypeScript, and the failure messages.
## The archive as a folder (`cli/src/archive.ts`) — 2026-11-06

- `map unpack <map> [--out dir] [--list]` / `map pack <dir> [--out map] [--compression m]`, on two new core exports
  split out of `openMapBytes`: **`readArchive(bytes)`** (the archive as it is — chk, extras by name, stored, origin,
  files, problems; `openMapBytes` = `readArchive` + `restoreBuiltMap` + parse) and **`writeArchiveBytes(chk, {extras,
  stored, compression, encrypt, listfile})`** (`saveMap` with the editor's sector rule). Raw on purpose: a built map
  unpacks into its built scenario + `scmjs\` members and packs back to the same built file; nothing is parsed, so
  the folder *is* the file.
- Member → file: `fileFor` turns `\` into folders and percent-encodes `<>:"|?*`, control characters and `%` itself
  (so `memberFor` can decode without ambiguity); `.`/`..` segments become `%2E…`. Two members differing only in case
  get `.2`, `.3` suffixes (the manifest holds the real name). `archive.json` (`ArchiveManifest` v1): fileName,
  scenario {compression, encrypted, sectorSize}, listfile (false = protected map, written without one), members
  [{name, file}], stored {hashTable, sectorSize, unreadable, members[{slot, hash, block, sectorSize, file}]} with
  the bytes in `stored/NNN.bin`, problems. Pack: manifest members + stored + **every other file** in the folder
  (dotfiles skipped) as a member at `memberFor(path)`; `staredit/scenario.chk` required; `.chk` output refused with
  members; the packed bytes are opened with `openMapBytes` before writing (a folder whose scenario is garbage is
  refused). Default output: the manifest's `fileName` beside the folder, else `<folder>.scx`. Compression: manifest's,
  "other" → pkware, none → none; `--compression` overrides; encryption as the manifest says.
- `tests/cli-archive.test.ts` (7): names, list, ums round trip (chk bytes equal, extras equal, origin equal, diff
  same), an added file + zlib, a protected map (no listfile, pkware+encrypted, one nameless member kept byte for
  byte, `files` null after pack), a built-shaped map, refusals.

## Bots in a game (`cli/src/botrun.ts`) — 2026-11-06, fifth slice

- `scmjs bot run <bot.scmbot> <map> [--race] [--opponents] [--seed] [--frames] [--every] [--data] [--starcraft]
  [--engine] [--json]`. **The spike's answer:** scm-sim already played a `.scmbot` under Node (`src/bwapi/node.ts`),
  but from the repository's private source and `data/`; what was missing was a runner that takes the *served*
  engine files and a *copy of the game*. That is scm-sim's `src/bwapi/run.ts` (PR jeany55/scm-sim#38): the page's
  `installed()` sequence in Node — `GameCore(generated)`, `parseImage(base-s1.bin)`, `installNamedFiles` with the
  interface pack before the copy's files (Remastered via kascade, 1.16.1 via the three archives), the engine's own
  data (`arr/*.dat`, iscript, tileset cv5/vf4) read from the same copy — then `Bwapi.load` in the person's seat as
  `startBotGame` does. Bundled by `scripts/bundle-run.mjs` (esbuild, 233 KB, mopaq + kascade inside) and staged by
  `deploy-play.mjs` as `play/engine/<build>/run-<hash>.mjs`, named with the build in **`play/engine/current.json`**
  (never cached) — the one address the CLI asks. Same seed → same game (checked across both kinds of copy).
- **The CLI's half**: `ensureEngine(at)`: a folder with `current.json` (a staged deploy, for tests and development)
  or the page's URL (`SCMJS_PLAY_URL`, default scmjs.dev/play) → `<cache>/engine/<build>/` (`cacheRoot`: SCMJS_CACHE,
  XDG_CACHE_HOME/scmjs, %LOCALAPPDATA%\scmjs\cache, ~/.cache/scmjs), each file written whole via `.part` + rename;
  gzip bodies gunzipped if the server did not say so. `findGameCopy`: `--starcraft`/SCMJS_STARCRAFT, then the usual
  folders (Program Files, /mnt/c under WSL, /Applications, wine). The runner runs as a child `node` process (one game
  a process) and its JSON lines (`start`, `text`, `progress`, `end`, `error`) are worded by `wordLine` live and kept
  for `--json`. Exit: runner's (0 ran, 1 the bot printed errors, 2 could not start); a loss is not a failure (a
  `--expect` could be added). **Never runs in CI**: it needs the player's own game files.
- `tests/cli-bot-run.test.ts` (4): cache/usual folders/copy kinds; a staged folder and a fetch from a local http
  server (gzip bodies, cache hit second time, 404); a stand-in runner script (`.cjs`, prints the protocol) through
  `runBotGame` with live lines; the failure paths. The real runner was exercised by hand (and scm-sim's own test).
- Not in this slice: bot against bot (two processes synced through the relay — one BWAPI build fits a game's memory),
  a replay of the game saved out (the engine records commands; a `--replay` is a natural next step).

## Replays in the terminal (`cli/src/watch.ts`, `engine.ts`) — 2026-11-06

`scmjs replay watch <rep> [--speed x] [--from m:ss] [--size WxH] [--every n] [--json] [--starcraft] [--engine]`: the
first of the "things people can see" slice (the user: "replay watch first"), the demo that gets screenshotted.

- **The engine's half is scm-sim's `src/exact/runReplay.ts`** (PR jeany55/scm-sim, branch `replay-runner`), modelled on
  the bot runner: the served engine files + the player's copy of the game (`src/exact/gameCopy.ts`, the copy-reading
  helpers run.ts had, as a module; run.ts keeps its own copy because its program block runs when its module is the
  entry — importing run.ts into another bundle would run *both* programs), `applyInputs({ replay })` + `runStart({})`
  as `web.ts#startExactReplayInPage` does, `ExactReplayEngine` + `ReplayWatch`. JSON lines: `start` (map, frames,
  players, copy, **terrain** = a char a tile from the game's tile flags, `0` unwalkable / `1` low / `2` middle / `3` high
  — OpenBW's `tile_t::flags` in the high half of each dword at `ADDR.tileFlags`), `frame` (per player minerals, gas,
  supply used/available, units alive; `units` = x, y in map pixels, owner, class 0 other/1 worker/2 army/3 building/4
  resource, four numbers a unit, the visible list only, subunits skipped), `end` (frame, ended, check from
  `ReplayWatch`). **Paced by standard input**: with no `--every`, each line read is a number of frames to step before
  the next `frame`; EOF or anything else ends it. So the terminal asks for exactly what the next picture needs and the
  game never runs ahead (Linux pipes would block a free runner anyway, Windows pipes would not). `--every N` runs free
  for a dump. Bundled by `scripts/bundle-replay-run.mjs` (esbuild, ~210 KB), staged by `deploy-play.mjs` as
  `play/engine/<build>/replay-<hash>.mjs` and named `replayRunner` (+ `replayRunnerBytes`) in `current.json`; `runner`
  stays the bot's. Measured: load 1.5 s + start 0.4 s, ~3,700 frames/s stepping with no snapshot; legacy_cp949.rep
  (10:08) end to end in 5.6 s free. `tests/exact-replay-run.test.ts` plays 1,000 frames of it (skips without the engine
  or a copy).
- **`cli/src/engine.ts`** is what `botrun.ts` had for the engine and the copy of the game, shared: `cacheRoot`,
  `ensureEngine` (now fetches **every** runner `current.json` names — `RUNNERS` maps kind → key + file pattern + command;
  a folder without current.json is searched for `run-*`/`replay-*`), `runnerFor(engine, kind)` (a CliError naming the
  command when the deploy had none), `findGameCopy`, `startRunner` (the child process, stdin a pipe when paced).
  botrun.ts re-exports the old names so doctor.ts and the tests are untouched. A sibling slice (`map trace|cost`) adds
  its `mapRunner` the same way.
- **The picture (`watch.ts`)**: `fitPicture` keeps the map's shape, ≤ 2 dots a tile, within the terminal less the
  lines around it (title, blank, a line per player, three of chat). `drawMinimap` lights dots at `floor(tile × scale)`,
  a 2 × 2 block for a building when scale ≥ 1, weighs owners per cell (building 3, army 2, worker 1, resources 0.5 in
  their own bucket) and colours the cell by the heaviest: 24-bit via the replay's `#rrggbb` where `COLORTERM` says so,
  else `nearestAnsi` of xterm's sixteen; resources grey `#6f7a86`; the **ground as a background shade** by level
  (truecolor only), none where unwalkable. Empty cells are spaces, not U+2800 (as the banner). ASCII where ui.ts's
  `unicode` is false: `#` building, `o` unit, `.` resource. `pictureLines` is always the same height so the redraw
  (`\x1b[nA` + `\x1b[2K` a line) lands; the cursor is hidden while drawing. Keys in raw mode: q/Esc/Ctrl-C stop, space
  pauses, +/- double/halve the speed (0.25–64). Pacing: `fps` 12 pictures a second, `round(24 × speed / fps)` frames
  a step. **The replay's own part** comes from `@scm-js/replay` as `replay info`'s does: `sidesOf` joins the runner's
  slots to the replay's names and colours; `Tally` walks the commands up to the frame for chat (by `player` id) and APM
  (Aftermath's rule, not chat/leave/system, until the player left). Not a TTY: `summaryLine` every `--every` frames
  (1,440 = a minute) with chat lines between, or `--json` lines (start with the sides, frames with `units`, end).
- `tests/cli-watch.test.ts` (14): the geometry (a 64 × 64 map at one dot a tile, dot by dot), colours (24-bit, sixteen,
  none, ASCII), the layout's height and text, the clock, `Tally`, `ensureEngine`'s runners, and the driver over a
  stand-in runner speaking the protocol: pipe, JSON, and the terminal path with a `PassThrough` as the keys (`+` then
  `q`, the frame count checks the pacing). Verified for real: the built CLI over a staged folder (symlinks to
  data/lifted + the bundled runner + a current.json) in a `script(1)` pseudo-terminal at 100 × 44 — 72 × 36 cells, 30
  redraws from 7:30 to the end at 64×, blue/brown/grey dots and 1,116 background shades in the capture.
- **Not in this slice**: the replay runner does not report who left or won (the CLI shows 0/0 for a player who left);
  no terrain in a terminal without 24-bit colour; `--view` (whose fog) is in the runner but not the command (the
  picture shows everyone); one dot per unit whatever its size.
- **Who left and who won (2026-11-07, `cli-polish` + scm-sim `replay-runner-ends`)**: the runner reads the game's own
  player records after every frame (type at `0x57EEE0 + 36 × slot + 8` turns 10 PlayerLeft / 11 ComputerLeft) and adds
  `left` (per player in `players` order, the frame they left or null) to each `frame` line **once someone has left**
  (absent before, so lines stay as they were), and to `end` always, with `outcomes` (`live.ts#outcomeOf`, the bytes at
  0x58D700) and `by` ("victory" when anyone's outcome is a victory, "replay" when the replay ran out, null when stopped).
  Fields, not event lines: the picture wants the state at a frame, and an older CLI ignores unknown fields. legacy_cp949:
  the leave lands at 14,402, the leave command's own frame; Question "victory", Drywater "defeat", `by` "victory";
  scr_mapname32 and things.rep end `by` "replay" with no outcomes. **The CLI takes both runners**: `view()` uses the
  frame's `left[k]`, else `Tally.leftBy()` (the replay's own leave commands, the same frame) — so an old deploy shows
  the leave too; only the winner needs the new runner. `pictureLines` spans the three figure columns with
  `left at m:ss` (widths from the players still in), `summaryLine` likewise; `--json` frames add `left` to that
  player's object; `watchSummary` adds "· <names> won" or "· ended at the replay's end" after a run to the end
  (`WatchOutcome.sides` for the replay's names). Trap met in the test: 1,990 and 2,000 frames are both "1:24" (`duration`
  rounds), so the stand-in's game leave is at 1,900 to tell it from the replay command at 2,000.

## New, dump, find, doctor (`cli/src/create.ts`, `dump.ts`, `find.ts`, `doctor.ts`) — 2026-11-07, the DX slice

The user asked for "suggestions on how to improve our cli tool … for DX and technical people" and took the first
slice proposed: four thin layers on existing library code, plus a git recipe.

- **`map dump <map> [--json]`**: the whole map as one stable text (`dumpMap` → `MapDump`, `printDump`): header,
  players, forces, units in **file order** (`unitLine`: name, owner, pixel x,y, and only the properties the record
  says are set), used locations, triggers and briefing in the trigger window's full text (`triggersToText`, so
  `map triggers import` could take the part back), strings as `formatStringTable`, members with size + sha1 prefix,
  sections as they would be written (`sectionBytes`, the same gather `diff.ts` uses — moved here, exported). Every
  part is printed even when empty (`(none)`) so two dumps line up. No colour ever (it is for files and git), first
  line `# <file> — scmjs map dump 1` (`DUMP_FORMAT`, bump when the form changes incompatibly). **The git recipe**
  (docs/cli.md "A map as text, and in git"): `diff.scmjs.textconv "scmjs map dump"`, `diff.scmjs.xfuncname "^## .*"`
  (hunk headers name the part; **0.9.0 shipped `"^## "`**, and git puts what the expression *matched* in the header,
  so it showed a bare `##` — found by `scmjs init`'s demo, 2026-11-07), `.gitattributes` `*.scx diff=scmjs`. Verified in a scratch repo: `git diff` and
  `git log -p` show a string change as text; git's temp blob keeps the basename so `kindOf` sees the bytes anyway.
- **`map find <text> <maps…> [--in kinds] [--case] [--json]`**: `findInScenario` per kind in `FIND_KINDS` order with
  `limit: Infinity`; exit 1 when nothing matched in any map (grep's rule — docs say so under exit codes). A map with
  no hit returns `lines: []`, and **`eachFile` now prints no separator for a file that printed nothing** (`printed`
  replaces `first`) — the only change to the shared loop. Sprites/doodads match ids only here (no game data names).
- **`map new <map>`**: `newScenario` = the editor's `newMapInto` without the store: `flatTerrain(baseTerrain(null), null, seeded(1), era)` — **the fill is seeded** (mulberry32) so the same
  arguments give the same bytes (tested), unlike the editor's `Math.random`; **no `--terrain`**: `baseTerrain(null,
  id)` returns `DIRT` whatever the id (a terrain's tiles need the tileset's groups), so the option the first commit
  had was a silent no-op and went (CI-review fix); `createScenario`; `setMapVersion` for `--revision
  remastered` (**not `--version`**: commander answers the program's own flag wherever it appears — found when `map
  set --version` printed 0.8.11); `--players n` = `placeStartLocations(scn, null, null, {…DEFAULT_START_PLACEMENT, replace: false,
  placement: DEFAULT_PLACEMENT})` **and slots n..7 set Inactive** via read/applyPlayerSettings — the editor leaves
  eight Human slots, but a Human slot without a start location is a Check Map error in melee, and a terminal scaffold
  should pass `map check` as written. Written with `defaultSaveOptions(scn, null, path)` (pkware + encrypt, the Save
  dialog's rule for a fresh map); `.chk` = bare scenario. Refuses an existing file without `--force` (exit 2). New
  core exports for it: `flatTerrain`/`baseTerrain`/`DIRT` (`formats/tileset/terrain.ts`, DOM-free, dirt ids without
  a tileset), `DEFAULT_START_PLACEMENT`/`StartLayout`, `DEFAULT_PLACEMENT`/`PlacementOptions` (placement.ts was
  already in the walk through startLocations).
- **`doctor [--json]`**: `Check { what, state ok|warn|bad, detail, fix?, note? }` for Node (≥ `NODE_MIN` 22.12.0,
  the only `bad`), scmjs vs npm (`newestVersion`, the one other network call besides `about`), TypeScript
  (`findTypeScript`, now exported from build.ts; version from the `typescript` package.json up the path), Docker
  (`dockerVersion`, else `docker --version` for installed-not-running), StarCraft (`findGameCopy`), the engine cache
  (`cacheRoot()/engine/<build>/`), the desktop app. Exit 1 only on `bad`. Modelled on `scripts/doctor.mjs`.
- **Overview**: `doctor` took the 23rd line, so the blank line between the banner and the first group went
  (banner.ts; the globe's bottom row, which carries no text, separates them). Its description had to fit one line
  (col width ≈ 47): "what this computer has for each command". The `map` term is now `map info|check|open|new|…`;
  the test takes any verbs before the ellipsis. `tests/core.test.ts`'s list of cli modules has the four new names.
- **Doctor brought up to date (2026-11-07, branch `cli-doctor`)** after `replay watch`, `map trace|cost`, `mcp` and pipes:
  - **Engine runners.** `engineCheck(cache, at = SCMJS_PLAY_URL)`: a folder in `SCMJS_PLAY_URL` is looked at as
    `--engine` would (current.json's build subfolder, else the files beside); otherwise the **newest build by folder
    mtime** under `<cache>/engine/` (there is no local "current": `ensureEngine` asks the page each run, and writing a
    file into a build touches its folder). `runnersIn(dir)` matches the files against `RUNNERS[kind].file`, the same
    patterns `ensureEngine` uses, so a new kind in `RUNNERS` needs only a name in `RUNNER_COMMANDS`. A build lacking a
    runner is `warn`, with the fix "`scmjs replay watch <replay>` fetches them once the play page has them" — **not**
    "fetches the newest build": on 2026-11-07 the live `play/engine/current.json` (build 1248410ad2a0) named only the
    bot runner, so a fetch would not have helped, and runnerFor's error says the same. Nothing fetched stays `ok`
    "not fetched yet". The check carries `engine: { dir, build|null, runners }` (in `--json` too).
  - **Ready summary** (`readiness(checks)` → `Ready { commands, ok, lacks? }[]`, `readyLines` wraps at 80 columns,
    three lines today): a fixed table `READY` of groups → needs, read **off the checks by `what`** ("TypeScript",
    "Docker", "StarCraft" warn/bad; a runner kind missing from a fetched build) — no probe of its own; Node `bad`
    blocks every group with "Node"; a check absent from the list blocks nothing (the tests hand it partial lists).
    The copy of the game is named before the runner (the user must supply it; the runner comes by itself). An engine
    never fetched blocks nothing (the first run fetches it). It replaced the old last line ("need nothing more");
    blocked still prints "Something blocks scmjs itself" above it. `map preview` is **not** in `READY` yet (the
    command was being added in parallel) — add its row with its needs; the StarCraft note already names it.
  - **MCP** (`mcpCheck(config = ~/.claude.json, cwd)`): `mcpServers` at the top (every folder) and
    `projects[cwd].mcpServers`, then any other project's; an entry counts when one of `[command, ...args]` matches
    `@scm-js/cli|scmjs` and another is exactly `mcp` (npx, a global `scmjs`, `node …/scmjs.mjs`). Always `ok`; the
    fix `claude mcp add scmjs -- npx -y @scm-js/cli mcp` (`MCP_ADD`) when not registered here; a missing or
    unparsable file is a quiet dim "Claude Code not found". Nothing else in the file is read out. The project-scoped
    `.mcp.json` is not looked at.
  - `doctorReport`/`doctorJson`/`printDoctor` keep their names and shapes (the MCP server's `doctor` tool calls them);
    JSON gained `ready` and the engine check's `engine`. `tests/cli-doctor.test.ts`: runners in fake cache folders
    (mtimes via `utimesSync`), a staged folder, the ready table from given checks, the 80-column fit, `~/.claude.json`
    variants in temp files.

- **The look (2026-11-07, user: "it kinda just lists a whole bunch of stuff, hard to read")**: `printDoctor` is laid
  out, the checks unchanged (`Check` gained `path`, additive). Node and scmjs are the **title line** when fine
  (`scmjs 0.9.0 · the newest · Node v24 · linux x64`), rows only when not. Rows in two groups, `Tools` (TypeScript,
  Docker, Desktop app, Claude Code) and `The game` (StarCraft, Game engine): mark, bold name, a short `valueOf` (the
  detail without its path; the engine's build id; `scmJS.exe`), then the path dimmed via `shortPath` (home → `~`,
  cut from the left to the terminal's columns). Fine-but-absent (`not installed`, `not found`, `scmjs mcp not added`)
  gets a dim `·`, not a tick. Notes/fixes only under a row that is not ok (Claude Code: the add line alone). The
  summary: one line when all ready, else `Not ready` + a line per group with `lackLine` (a few words; the fixes are in
  the rows above). `readyLines(ready, checks)` and `printDoctor(r, width)` take what tests need.

## `scmjs init` (`cli/src/init.ts`) — 2026-11-07, after 0.9.0

`scmjs init [folder] [--print] [--git] [--force] [--json]`: a folder of maps made a project git and GitHub look after.
`initFolder` does everything (and with `print` computes it all and writes nothing); `printInit` is the one-line-each
report, `printRecipe` the paste-able text. Writes:

- **`.gitattributes`** (`ATTRIBUTE_LINES`) and **`.gitignore`** (`IGNORE_LINES` = `*.bak` only — checked what is left
  beside a map: the CLI writes in place or to `--out`, `map unpack`'s folder is meant to be kept (no `*-unpacked/`
  except for stdin), `map preview` writes only to a named `--out`, `trace` copies go to the temp dir; the desktop
  app's Save writes `<map>.bak`, `desktop/backup.ts`). Line files get **only the lines they lack**, appended under a
  comment (`missingLines`); a `.gitattributes` pattern that already names a diff driver (`*.scm diff=mine`) is left
  alone. `--force` never removes lines. This bends "write only files that are not there" deliberately: both files
  are common in an existing repository and appending is not overwriting.
- **`.github/workflows/maps.yml`** (`workflowText`) **at the repository's top** (`git rev-parse --show-toplevel`),
  not in the folder — GitHub reads workflows only there; map globs are then `maps/*.scx` from the top (`mapGlobs`,
  one per extension *as written*, since globs are case-sensitive on the runner; quoted dir when it has shell
  characters; `*.scx` with a note when the folder has no maps). Check: `npx -y @scm-js/cli@<VERSION> map check …
  --strict --format github`, `run: |` block scalars so no path can break the YAML (validated with js-yaml once).
  **Build step only for maps that keep a script**, listed by name: `map build` on a map without one is a CliError
  (exit 1) and loads TypeScript first, so "run it on every map" was not an option, and `map info --json` says nothing
  about scripts. Detection is `hasScript(extras)` (new in build.ts: the plugin's `readFiles`, dynamic import, null
  when not vendored). A map that gains a script later needs the line added by hand (the comment in the file says
  how). The build line is `npx -y -p @scm-js/cli@<v> -p typescript@6 scmjs map build --check <map>`: two `-p` put
  TypeScript in the same npx folder, where `findTypeScript`'s "beside the command" `createRequire` finds it —
  **verified against the published 0.9.0** (compiled, TypeScript 6.0.3). `TYPESCRIPT` is held to package.json's
  major by the test.
- **`README.md`** (`readmeText`): a table of the maps (name via `gameText` + `visible`, colour bytes gone, `|`
  escaped, link URL-encoded with `(`/`)`), the three commands with the folder's own globs and first map, and the git
  lines a fresh clone needs (git config is per clone; "run `scmjs init` again" is the answer since it writes nothing).
- **git config** `diff.scmjs.textconv/xfuncname/cachetextconv` (`GIT_SETTINGS`) in the repository via `git -C top
  config`; compared with `git config --get` (any scope); another value is `other` (▲, left alone) unless `--force`;
  `OLD_SETTINGS` (the 0.9.0 `^## `) is replaced without `--force`. **Trap: never `.trim()` git's output** — the old
  value ends in a space and compared unequal. No repository: nothing set, a note; `--git` runs `git init` (never
  otherwise). A note when `scmjs` is not on PATH (`onPath`, PATHEXT on Windows), since git runs it by name.

Paths in the report (and `--json`'s `files[].path`) are **from the folder** — from the cwd they were
`../../../../tmp/…` in the tests. Exit 2 for a missing folder or a file.

**In the overview** under "Maps and replays:" (a one-line description: a wrapped one costs a row). It was hidden at
first — the root help was at 23 lines — until the blank lines between the groups went (see "The overview's rows"
below); the user asked for `scmjs init`, not `map init`. The `map` noun's help (`map.addHelpText("after", …)`) names
it too. `doctor`'s Ready table unchanged (init needs nothing beyond git, optional).

## CI slice: check formats, info --table, diff --rev, set, resize, strings prune (`report.ts`, `edit.ts`) — 2026-11-07

The second DX slice (the user's "go for it" on the second suggestion round), stacked on the first (#137's branch).

- **`map check --format text|json|github|junit|sarif`** (`report.ts`, pure functions of `CheckReport { file: path as
  given, name, issues, failed }`). `--json` = `--format json`. **github**: `::error|warning|notice file=…,title=<map ·
  where>::text` with the runner's escaping (`%`→`%25`, newlines →`%0A`; `:`/`,` in properties →`%3A`/`%2C`), info =
  notice. **junit**: a testcase per map (`name` = the map's name or the path, `classname`/`file` = the path), a
  `<failure message="N errors, M warnings">` holding every finding when `failed`, else `<system-out>`. **sarif** 2.1.0:
  a rule per `where` (`scmjs/<slug>`), results at `artifactLocation.uri` = path with `uriBaseId %SRCROOT%`, levels
  error/warning/note. `reportPath` = relative to cwd with `/`. The levels stay Check Map's: `--strict` changes `failed`
  and the exit code, not the annotation kinds. **`eachFile` gained `silent`** (collect, print nothing) for this and
  for `info --table`; results carry `{file, error}` for a file that failed, filtered out before formatting.
- **`map info --table`**: one row per map (File, Name, Size, Tileset, Version, Players = used slots, Units, Triggers,
  Check) via `ui.table`. **`ui.table` now pads by terminal columns** (`columns()`: Hangul/CJK/kana/full-width = 2), since
  the test map "Test Remastered 리마스터" misaligned the column — `rows()` still pads by `.length` (labels are ASCII).
- **`map diff --rev <rev> <map>`** (`diff.ts#revisionInput`): `git -C <dir> rev-parse --show-toplevel`, then `git -C
  <root> show <rev>:<path from root, '/'>` into an `Input` named `<rev>:<basename>` (kind from the bytes). git's own
  first stderr line is the hint; exit 2. `[b]` is optional now and the pairing is checked (`--rev` with two maps, or
  one map without it, is refused). Test makes a temp repository; `describe.skipIf(!hasGit)`.
- **`map set`** (`edit.ts#setHeader`): `--name/--description` read through `unescapeStringText` (`<03>` = colour, as
  the string files); `--revision` (**not `--version`**, which commander answers as the program's flag — found when it
  printed 0.8.11; `map new` was renamed too on the #137 branch) → `changeMapVersion`; `--encoding` → `changeTextEncoding`.
  Says each field's from → to; writes only when something changed (or `--out`). Nothing given = exit 2.
- **`map resize`** (`resizeMap`): `resizeScenario` with `fill: baseTerrain(null)`, `tileset: null`, `era: scn.era`,
  `random: () => 0.5` — the editor without game data; anchors by name (`ANCHORS`, centre default 4 as the dialog);
  `--no-clamp` ↔ the dialog's clamp (default on). Same size = exit 2. `--size` reuses `create.ts#parseSize`.
- **`map strings prune`** (`pruneStrings`): `unusedStrings(scn, usages)` **minus empty slots** (`""` is a gap the
  table keeps, same as diff/dump's null = "" rule — the first run listed nineteen blank lines after an import past
  the end), then `applyStrings(deleteUnused(…))`. `--dry-run` lists and writes nothing; lists cut at 20 unless `--all`.
- `tests/core.test.ts` cli list: + `edit`, `report`. Overview unchanged (23 lines; the new verbs are under `map`'s `…`).

## Pipes: `-` for standard input and output (`files.ts`, `exchange.ts`) — 2026-11-06

- **`readInput("-")`** reads all of stdin (a `Readable` parameter for tests); empty → CliError exit 2. A pipe has no
  name, so the kind is from the bytes alone: `kindOf("", bytes)` (MPQ magic, replay, `SCMBOT1`) else `looksLikeChk`
  (four bytes of `A-Z0-9 ` — a section name, `VER `/`TYPE`/`MTXM`) → `map`. The input is `{ path: "-", name:
  "stdin.scx" | "stdin.chk" | "stdin.rep" }`; the **name carries the form** so `writeBack` can write it back as it came.
- **`toStdout(inputPath, out)`** = `out === "-"` or (no `out` and input `-`): a filter writes where it read. `writeBack`
  takes an optional `Writable`; `writeOutput(bytes, path, stdout?)` is the one writer (file, or the stream for `-`),
  used by `writeBack`, `build.ts`'s packed map and `create.ts` (`map new -`). `outputFormat(doc, inputPath, out)` =
  `formatOf(out) ?? formatOf(inputPath) ?? formatOf(doc.fileName) ?? (origin ? "scx" : "chk")` — the last two are the
  pipe's cases; `defaultSaveOptions` gets `doc.fileName` in place of `-` so a bare chk keeps StarEdit's layout rule.
- **main.ts**: `piping(input, o)` says whether the map takes stdout (not with `--dry-run`) and **refuses `--json`**
  there (exit 2: both want the pipe); `say(piped, …lines)` sends a writing command's words to **stderr** while the map
  has stdout (`run`'s live lines too); `outName(w)` prints "standard output" for `-`. `map set` and `strings prune`
  **always write when piped**, changed or not — the next step needs a map. `map new -` skips the exists check and
  names the map "Untitled Scenario". `unpack -` defaults its folder to `stdin`. Text exports treat `--out -` as none.
- Verified by hand with the built file: `cat ums.scx | map set - | map resize - | map strings prune - | map info -`,
  a bare chk through `info -`, `map new - | map check -`, the `--json` refusal and the empty pipe.
  `tests/cli-pipes.test.ts` (4) covers the readers/writers with streams.

## MCP server (`cli/src/mcp.ts`) — 2026-11-06, the user's pick from the "wow" list

- **`scmjs mcp`** = the map commands as Model Context Protocol tools on stdio, built on the official
  `@modelcontextprotocol/sdk` (`McpServer` + `StdioServerTransport`, zod schemas → JSON Schema) rather than a
  hand-written JSON-RPC loop: protocol negotiation, `ping`, errors and the client for the tests come with it. Cost:
  the bundle 3.66 → 4.49 MB (SDK, zod 4, zod-to-json-schema, ajv with its four helpers — all MIT/ISC/BSD, in
  ATTRIBUTION.md's CLI table and the notices). `createMcpServer()` returns `{ server, tools }` so the start line and
  the test know the count without reaching into the SDK's privates.
- **One tool per command, the command's functions underneath**: `map_info|check|dump|find|diff`, `map_triggers_export|
  import`, `map_strings_export|import|prune`, `map_set|resize|new|build|run`, `replay_info` — each calls the same
  module the commander action does (`mapReport`, `dumpMap`, `importTriggers`, `writeBack`, …), never main.ts, so the
  two cannot drift in what they do, only in how they print. A result is `content: [{text}]` = the command's lines
  with `visible()` stripping colour (picocolors is on when the client's pipe looks like a TTY to nobody, but strip
  anyway), plus `structuredContent` = the `--json` shape (`toJson`: Uint8Array → array, Map → object). No
  `outputSchema`s: the shapes are the command's TypeScript types and would be a second copy to keep. Triggers and
  strings go **inline as text** (`text` argument; `.trg` bytes are not offered) — that is the point: the model edits
  the trigger window's text and imports it. `annotations`: `readOnlyHint` on the readers, `destructiveHint` on the
  writers, `openWorldHint` on `map_run` (it loads code from github:/URLs). `instructions` (exported `INSTRUCTIONS`)
  tell the client how the tools fit; docs/cli.md "For AI tools" says the same for people.
- **Failures are results, not protocol errors**: a `CliError` → `isError: true` with message + hint, so the model
  can act on "No file x / Check the name"; an SDK-level error would only say the tool failed. `map_build` with
  `ok: false` is also `isError` (compile errors as text).
- **stdout is the protocol.** `serveStdio` points `console.log|info|debug|warn|error` at stderr before serving
  (the headless plugin host's `api.log` is `console.log`; a plugin's print would otherwise corrupt the stream), and
  the modules called never `print()` themselves (main.ts does the printing — the reason the split existed).
  `StdioServerTransport` does not close on stdin's end, so `serveStdio` waits on `process.stdin` `end` (or the
  server's `onclose`) and closes the server; without it Node exited with 13 "unsettled top-level await".
- **Overview**: `mcp` took a line in "This tool:", so the `help [command]` row is hidden (`program.createCommand("help")`
  + `_hidden`, `addHelpCommand`) — `scmjs help map` still works and `-h, --help` is on the same screen; 23 lines held.
- `tests/cli-mcp.test.ts` (7): the SDK `Client` over `InMemoryTransport.createLinkedPair()` — tool list with
  descriptions, annotations and instructions; info/dump; check; triggers export → import `--append` to `out` → diff;
  strings by number + header in place; find + new; failures as text. A stdio smoke (initialize, tools/list, two
  calls) was run by hand against the built file.
- **The game tools (2026-11-07): `map_trace`, `map_cost`, `doctor`** — 19 tools. Each calls the command's functions:
  `gameMap` + `runMapInGame` + `printTrace|printCost`, and for the data `traceJson`/`costJson`, which trace.ts now
  exports with the `--json` shape (main.ts still builds the same objects inline — additive-only edits there while
  other slices were open; switch it to the two functions when convenient, so the shapes cannot drift); `doctor` is
  `doctorReport` → `printDoctor` + `doctorJson`. Arguments `path`, `frames`, `seed`, `starcraft`, `all`; no `every`
  (fixed 600) and no `engine`: a person sets `SCMJS_PLAY_URL` / `SCMJS_STARCRAFT` in the client's server settings,
  and tests hand `createMcpServer({ engine, weigh })` a staged folder and a stand-in weigher (the options exist for
  that). `readOnlyHint` on all three. The runner's **live lines go to stderr** (`STDERR(visible(line))` as `live`,
  including ensureEngine's "Fetching the game engine" line), and when the request carries `_meta.progressToken` each
  runner `progress` line becomes a `notifications/progress` (frame of frames) through `trace.ts`'s new `onProgress`
  option — no stdout write anywhere (the test spies `process.stdout.write`). A 1.00 map's "converted to Brood War"
  note leads the text. Rows are cut by the command's own limits (40 rows, 20 never-fired; `all` lifts them), table
  width 140 (`process.stdout.columns` is undefined on the pipe).
- **`-` is refused** on `path`, `out`, `a`, `b` and `paths` by the `tool()` wrapper: to the commands it is
  stdin/stdout, which are the protocol here — `map_info` on `-` would have read the client's messages as a map and
  hung, `out: "-"` would have written a map into the stream. Found while adding the game tools; applies to every tool.
- **Trap (fixed in scm-sim #41, deployed 2026-11-07): the runners lost a big result.** All three runners wrote the
  `end` line and called `process.exit(0)` at once; a write to a pipe past ~64 KB is still queued then and is dropped,
  so the CLI saw no `end` ("the runner stopped without a result (exit 0)") — on ums.scx a cost of 9,600 frames (98 KB)
  came through and 14,400 failed three times out of three. The runners now exit from the write's callback; verified
  live (14,400 frames, 147 KB, complete). `MAX_FRAMES` is ten minutes for both tools now, for the result's size.
- **Trap: a `deploy-play.mjs` staging folder is gzipped** (`dist-play/play/engine/<build>/*` are .gz bytes under plain
  names, for the host to serve with Content-Encoding). `--engine <that folder>` / `SCMJS_PLAY_URL=<folder>` hands the
  runner gzip and it dies with "SyntaxError: Invalid or unexpected token" (shown as "stopped without a result (exit
  1)"). Serve it instead — `python3 -m http.server` in `dist-play`, `SCMJS_PLAY_URL=http://127.0.0.1:8765/play` —
  `fetchBytes` gunzips. A folder of plain files (data/lifted + a bundled runner) works as a folder.
- Measured 2026-11-07 by hand, the built `scmjs.mjs mcp` driven over stdio (initialize, initialized, tools/list,
  tools/call), the user's Remastered copy, scm-sim-map-run's staged deploy served locally, a fresh `SCMJS_CACHE`:
  first `map_trace` ums.scx 600 frames 2.2 s with the engine fetch (107,618,906 bytes unpacked in the cache — "about
  25 MB" is the download) — 20 passes, #1 fired once at frame 2, #2 (Bring) and #3 (Switch) never, said no last at
  frame 591; 2,400 frames 1.8 s (78 passes, frame 2,389); 43,200 frames 2.8 s. `map_cost` 600 frames 1.8 s: 0.00003
  ms a frame on average (20 of 600 frames), 0.00006 ms at most (frame 2: 7 records, 3 triggers). `doctor` 0.3 s.
  Against scmjs.dev (no `mapRunner` in its current.json yet, build 1248410ad2a0): the tool fetches the whole engine
  **first** and only then says "has no map runner" — ensureEngine does not know which runner the caller needs; a
  `need` argument checked against current.json before fetching would save the 25 MB. The doctor's "Game engine ✔
  fetched" says nothing of the map runner either.
- Tests (`tests/cli-mcp.test.ts`, now 12): the stand-in runner, `stagedEngine` and `classicCopy` moved from
  cli-trace.test.ts to `tests/support/mapRunner.ts` for both; trace (text, data, progress notifications, stderr
  lines, nothing on stdout), cost with a stand-in weigher, and the failures as text (not a copy of the game, a deploy
  without a map runner, no weigher beside the source, a map the game refused, frames past the cap), `-` refused,
  `doctor` with `fetch` stubbed (npm offline).
- **A cancelled request stops the game (2026-11-07, `cli-polish`)**: `play` hands `extra.signal` to `runMapInGame`
  as `signal`; on `notifications/cancelled` the SDK aborts it, the runner is killed and the tool returns `isError`
  "The run was cancelled" — which the SDK then **drops** (`Protocol._onrequest` sends nothing for an aborted request;
  the client's `callTool` has already rejected). So the test checks what can be seen: the client's call rejects, the
  stand-in's pid is gone within a moment (the kill follows the cancellation over the transport), and the server answers
  the next call. The message itself is tested in cli-trace.test.ts. Without the line the test times out (checked).

## Triggers in the game: `map trace`, `map cost` (`cli/src/trace.ts`, `engine.ts`, `weigh.ts`) — 2026-11-07

The user took the parent's first-slice proposal ("`map trace` and `map cost` second"); a fork built both ends.

- **The runner is scm-sim's `src/exact/runMap.ts`** (PR on jeany55/scm-sim, branch `map-runner`), modelled on the bot
  runner: the served engine files + the player's copy of the game (`src/exact/gameCopy.ts`, the helpers the bot runner
  had inline, written as a shared module — the sibling fork for `replay watch` wrote the identical file, so both PRs add
  it; `run.ts` still keeps its own copies), the map started as `game: "ums"` with the person's seat idle, `installEud`
  (strings placed when the scenario has `STRx`) → `installCost` → `engine.traceTriggers()` at the gate of frame 0. The
  trace is **folded as it goes** (`foldTrace`: a pass per copy is fired / continued (first record an action with the
  running flag, slot > 0: a Wait let go) / failed (a condition answered 0, the last such kept as `lastFail`), then
  `forgetAfter(-1)`), so a long run holds one line per copy. The cost tap groups records by map row (`rowOf`: the copy
  whose node + 8 + 2400 holds the record) and takes a **weigher by module path** (`--weigh`): the model is the plugin's
  (`remasteredCost.ts`) and the runner is another process, so `cli/src/weigh.ts` re-exports `RemasteredWeigh` as
  `weigher(memory)` + `SMOOTH_MS`/`MOST_MS`, and `build-cli.mjs` builds it **on its own into `cli/dist/weigh.mjs`**
  (a second Vite SSR build, 34 KB; `trace.ts#weighModule` finds it beside the command, or `--weigh`, hidden). Bundled by
  `scripts/bundle-map-run.mjs` → `dist-run/map.mjs` (242 KB), staged by `deploy-play.mjs` as `map-<hash>.mjs` and named
  in `current.json` as **`mapRunner`/`mapRunnerBytes`** (`runner` stays the bot's; `ensureEngine` fetches both, and a
  deploy before this has `mapRunner: null` → CliError "no map runner yet"). Protocol: JSON lines `start` {map, copy,
  seed, rows, copies, remastered, ms}, `progress` {frame, passes, ms}, `end` {frame, ended, reason, passes, trace:
  CopyReport[] | null, cost: CostSeries | null, ms}, `error`. Flags `--no-trace` / `--no-cost` pick the tap.
- **Traps found by running it (each cost a sitting):** (1) **the 1.16.1 game's storm reads no zlib** — tests/maps/ums.scx
  is zlib-compressed (melee.scx pkware) and the game went down storm's error path (`FindFirstFileA` on the executable,
  `FormatMessageA`, `LoadStringA`, `OutputDebugStringA`, `LoadLibraryA`: "no stand-in for …" one after another); the
  runner now writes the archive it hands the game afresh with mopaq's `Creator` (scenario pkware, members as they are,
  nameless members dropped), which also covers `.chk` and Remastered scenarios in one place. The stand-ins added on the
  way (`standInFileSearch`: the Find*/FormatMessage/LoadString/OutputDebugString imports answered "nothing", set on
  **every** slot with the key — the game and storm each import them) are kept, harmless. (2) **Original StarCraft 1.00
  maps (VER 59) reach code the engine has not lifted** (`0x1D007C20` from storm `0x1503AAE8`), the Blizzard campaign
  maps among them; `trace.ts#gameMap` converts such a map to Brood War into a temp copy as Map Properties would, and
  the start line says so. (3) `placeStrings` throws without `STRx`, so "remastered" is decided by that section, not by
  whether `classicScenario` changed bytes (a hybrid map changes too). (4) A TrigScript/eudplib program's records are in
  no map row: `passes` is counted as "a state or anything noted" (such a program leaves the pass countdown alone, so
  `passRan` was never true and the count read 0), and the cost report says how many records ran in no trigger of the map.
- **The CLI half**: on main's `cli/src/engine.ts` (from `replay watch`, #141): `RUNNERS` gained `map: { key:
  "mapRunner", file: /^map(-hash)?\.(mjs|cjs)$/ }`, `EngineCurrent` the two keys, and the staged-folder check takes any
  runner; `trace.ts` uses `runnerFor(engine, "map")` + `startRunner` with its own line loop (the fork had written a
  second engine.ts first — merged away). `trace.ts`: `runMapInGame(map,
  "trace"|"cost", o)`, `summarizeRows` (copies → one summary per map row: players, fired/continued/failed, first/last,
  lastFail, done), `printTrace` (a `ui.table` with the row text from core's `summarizeTrigger` cut to the terminal's
  width, then "Never fired" with `conditionDef(type).name` and the slot), `costReport`/`printCost` (average and peak ms
  where anything ran, the limits line, the ungrouped line, costliest rows by ms a frame they ran in; tiny numbers get
  more digits). Both commands open the map first (`openForEdit`) for the row text; `--frames 2400`, `--every 600`,
  `--seed 1`, `--all`, `--starcraft`, hidden `--engine`. Overview unchanged (23 lines; the verbs are under `map …`).
  `tests/cli-trace.test.ts` (stand-in runner, as cli-bot-run), the weigher checked where plugins/ is vendored;
  `tests/core.test.ts` cli list + `engine`, `trace`, `weigh`. Measured on the user's Remastered copy with a staged deploy
  served by `python3 -m http.server` over dist-play: ums.scx trace 2,400 frames in ~3 s; `trigscript-frame-cost.scx`
  cost: 0.025 ms a frame on average, 1.10 ms at frame 2 (83,787 records, 53,192 triggers, the program's start).
- Not built: `--by-origin`/by-line cost for a TrigScript build (the editor has it); bot-run's `--every` wording reused as
  is; the campaign maps (engine). (The `doctor` line for the map runner came with `cli-doctor`.)
- **Temporary copies and cancelling (2026-11-07, `cli-polish`)**: `gameMap`'s copies (a map from `-`, a 1.00 map
  converted) went into `mkdtemp` folders nobody deleted — invisible for a command, a leak for the MCP server. `gameMap`
  now records each path in a module `Set`; `runMapInGame` is a `try/finally` around the old body (`runMap`) that removes
  the map's folder if (and only if) the set has the path, so neither caller changed and a person's own map is never
  touched — success, a refused map, or a failure before the runner started (no copy of the game) alike. A copy written
  but never run (a bad `--frames` between `gameMap` and the run in main.ts) still stays; the command exits anyway.
  `MapRunOptions.signal`: aborted before the start → no runner; during → `child.kill()` (SIGTERM), the line loop ends
  with stdout, then CliError "The run was cancelled: …". The exit promise is now made right after `spawn` (it was made
  after the loop, which could miss a `close` that came first). The stand-in runner (`tests/support/mapRunner.ts`)
  takes a map named `slow.scx`: it writes its pid beside the map (`slow.scx.pid`) and waits to be killed — no `--sleep`
  flag, since `runMapInGame` passes no free arguments to the runner.

## Start to start: `map rush` (`cli/src/rush.ts`) — 2026-11-07

`scmjs map rush <map> [--unit <name>] [--seed n] [--json]`: the ground distance between every pair of start locations
by the game's own pathing — a unit walked from each start to every other, frames, pixels, outcome, beside the straight
line. A fork built both ends (scm-sim branch `map-rush`).

- **The runner is the map runner's `--rush` mode, not a fourth bundle.** scm-sim's `src/exact/mapGame.ts` is
  `runMap.ts`'s start (mapBytes → the copy's files → install → `applyInputs`/`runStart` → `attach`) as a module, with an
  `edit(chk, files)` hook; `runMap.ts` uses it for trace/cost and dispatches `--rush` (`--unit <id>`, `--limit
  <frames>`, `--seed`, default `ANALYSIS_SEED` 12345) to `src/exact/mapRush.ts`. Why one runner: the start is the same
  code (the zlib/pkware rewrite, the file-search stand-ins, the terrain check), no `current.json` key, no `RUNNERS` kind
  and no `doctor` line. The price: **a runner from before ignores `--rush` and runs the triggers**, so its `start` has no
  `mode` — `rush.ts` kills it and says "a map runner from before map rush" (tested with the trace's stand-in, which is
  exactly such a runner). `RUNNER_COMMANDS.map` still reads "map trace|cost" (cli-doctor and cli-mcp tests pin the
  wording; doctor cannot tell a runner's modes apart anyway).
- **One game for every start** (one game a process; `scripts/pathing.ts` needed a process per start). The walks are
  `src/analysis/pathing.ts`'s: `pathingScenario` (neutral Nexus on every start, Create Unit for P1 at location 1 =
  `testPoint`, five tiles toward the middle), `walkUnits` (its own StateKeeper moment once the unit exists, a restore
  before each walk). `mapRush.ts` takes a `StateKeeper` moment **before the first turn**; for each later start it
  restores it and moves location 1 in the game's own table (`0x58DC60`, left/top/right/bottom) to that start's point
  before the trigger has run. Measured identical to a game started for that start alone, to the frame and pixel
  (Fighting Spirit, Crescent Moon; scm-sim `tests/exact-map-rush-fresh.test.ts` pins the numbers a fresh game gives, and
  `exact-map-rush.test.ts` the rush's). OWNR slot 1 is made Human in the copy (the unit is P1's; a map giving slot 1 to a
  computer would seat the person elsewhere) and the runner fails if the person is not in slot 1. `WalkHooks.walked` now
  gets the walk as a third argument (additive) so a `walk` line goes out as each ends. units.dat's flags are read from
  the copy before the game starts, so a flyer/building is refused in ~1.3 s.
- **Protocol**: `start` {mode: "rush", map, copy, seed, unit, starts [{owner, x, y}], walks, ms}, `walk` {from, to
  (slots 0–7), unit, outcome, frames, travelled, off (px from the start walked to at the end), regions, air (start to
  start), at (where it set out), ms}, `end` {mode, walks, ms {load, start, walk, total}}, `error`.
- **The CLI**: `unitByName` (an id; the editor's name or without "Terran/Zerg/Protoss", case and spaces folded; else a
  unique prefix; else CliError listing up to six, exit 2 — "Siege Tank" is four). The map goes through `trace.ts#gameMap`
  (a 1.00 map such as Lost Temple is converted; `removeGameMap` is now exported for `runRush`'s `finally`). Report:
  starts labelled by player and `clockOf` (the angle from the middle as a clock hour — geometric, so Lost Temple's
  left base reads 8, not the 9 people may call it), matrix cells "px, s" right-aligned, split into a seconds and a
  pixels table when wider than the terminal (8 starts at 100 columns); shortest/longest of the arrived by frames, with
  air and the ratio; `apart` pairs merged both ways ("No ground joins 1 ↔ 3"), every pair apart → "an island map" and
  the straight lines; other outcomes one line each. Seconds = frames × 42 ms. The runner's "does not walk" becomes
  "The Mutalisk does not walk", exit 2.
- **Measured** (Remastered copy, staged deploy over `python3 -m http.server`, fresh cache): Lost Temple (1.00, converted)
  SCV 12 walks 3.9 s, shortest 3 → 4 30.5 s, longest 1 → 4 53.8 s; Destination Zergling 41.9 / 42.9 s, 2.8 s; Fighting
  Spirit Zergling 37.0–45.9 s, 4.2 s; Octopus (8 starts, 256 × 256) 56 walks 15.9 s; Sapphire Isles and Archipelago
  every pair apart, ~3 s.
- **Not built**: an MCP tool (`map_rush`); the path itself (the runner keeps a point every 64 frames and does not send
  it); several units in one run; the editor's own Walkability numbers are the same code but not compared here.

## Unit tests for triggers: `map test` (`cli/src/maptest.ts`) — 2026-11-07

`scmjs map test <map> [tests…] [--format text|json|github|junit|sarif] [--json] [--out] [--frames] [--seed]
[--starcraft] [--engine]`: scenarios from a JSON file (`<map>.tests.json` beside the map by default), each one game
with setup, timed steps, a frame count and expectations; a replay of each failed scenario. A fork built both ends
(scm-sim branch `map-test`, PR on jeany55/scm-sim). Sample: `tests/maps/ums.tests.json` (three scenarios, the third
fails for a real reason: ums.scx has no ground, so a Marine is unplaceable).

- **JSON, not YAML**: no dependency (the bundle is one file, `ssr.noExternal`), `JSON.parse` is exact, map makers see
  JSON in every `--json`, editors validate it. Comments would be nice; not worth a parser. A top-level list is taken as
  the scenarios; top-level `frames`/`seed` are defaults.
- **The decision that shaped it: setup and timed effects are triggers of the map copy, not memory writes.** The runner
  could poke switches/deaths/resources or call the game's action routines between frames (`testGame.ts#action` does,
  for TrigScript's tests), but a replay records only the command stream: a poked game would not play back as it ran.
  So `planScenario` builds a copy from **the archive as stored** (`readArchive`, not `openMapBytes`: a built map keeps
  its built triggers, which is what the game runs; `map trace` hands the file as is for the same reason), prepends the
  setup (one trigger per 64 actions, condition Always, owned by `firstInGame` — the first OWNR 5/6 slot, whose list the
  game walks first) and appends one trigger per timed effect with `Elapsed Time ≥ ceil(at / 16)` (scm-sim's measured
  rule: a game second is 16 frames at every speed, and "elapsed time at least k" first holds at the pass whose frame's
  sixteenth is k, so an effect never lands before its frame; it lands on the first pass once the clock gets there,
  passes 31 frames apart). Map rows in the trace are shifted by the setup's count when judged; numbers in the report are
  the map's. **No strings are added** (no Comment on the test's triggers) so STR/STRx stays byte-identical — an EUD
  payload placed in the strings is not moved; a raw `action` that names text does intern, the user's choice. Checked:
  two Magenta EUD probe maps (probe-6-units, eud-3-reads) show the same lines and fire the same first trigger with and
  without a prepended setup. A program that counts on its triggers' places could still notice; not seen.
- **Verbs**: setup/steps share `create`, `kill`, `remove`, `give`, `switch` (+`state`), `minerals`/`gas`/`deaths`
  (number sets, `"+n"`/`"-n"` add/subtract), `action` (the trigger window's text form, parsed by `parseTriggers` inside a
  wrapper trigger — any action). Steps add `order` (move/attack/patrol/stop/hold, the person's units of a type in a
  location) and `chat` — **the runner's**, the person's own commands, so they are in the replay's stream. Names go
  through `triggerNames(scn)` (units incl. classes and custom names, locations, switches) with `rush.ts#unitByName` as
  the fallback ("Marine" without the race); triggers by the number trace prints or the Comment (`triggerComment`, new
  in core with the trigger enums `ConditionType`, `ActionType`, `PlayerGroup`, … — docs/core.md lists them). Every
  error is a CliError exit 2 naming the file, scenario and path (`"ums.tests.json: "x": setup[0].location: the map has
  no location "Moon" (it has "Base", …)`), raised before any game starts.
- **Expectations** (`judge`, pure): trigger fired (Compare: number = exactly, `">= n"` etc., true/false), switch,
  deaths, minerals/gas, units (a count query the runner answers), text (substring of `plainText` of any line shown),
  outcome (per player 1–8, `"none"`), ended. Each result is `{what, ok, actual}` with words both ways ("trigger #2 fired —
  it never fired: Bring (condition 1) said no last, at frame 591", the trace's own explanation).
- **The runner's half** (scm-sim `src/exact/mapTest.ts`, `runMap.ts --test <spec.json> --replay <out.rep>`; the trace
  fold moved to `src/exact/traceFold.ts` for both): `startMapGame`, `installEud` as the trace, the trace folded per
  frame; steps handed over while the game stands at their frame (orders as `RenderCommand`s through
  `ExactLiveEngine.step`, twelve units a command; the units picked by centre in the location as the game's table has
  it *now*; chat as testGame's 0x5C command through `queueCommand`); text from `triggerView()` every frame (capped at
  500). **The end is read with the game's own condition routines**: a 20-byte condition record of ours in `L.alloc`
  memory, `callAt(table 0x515A98[type], ecx = record)` with the current player set to the person and the registers put
  back — Bring with a location, Command without — binary-searched on "at least k" for the count (≈ 11 calls a query), so
  "in the location" is exactly the map's own rule (the unit box, the location's elevation flags, carried units). Switches
  (0x58DC40), deaths (0x58A364, non-zero only), minerals/gas (0x57F0F0 rows) read directly; outcomes `outcomeOf`.
  Replay: `liveReplay(game, map.chk)` — the classic scenario the game ran, with the test's triggers. Protocol `start`
  {mode: "test", …, localPlayer}, `end` {mode, frame, ended, reason, passes, trace, observed {switches, deaths,
  resources, counts, texts, outcomes, steps}, replay, ms}. **An older runner ignores `--test`** and its start has no mode:
  the CLI kills it and says "a map runner from before map test" (tested with the trace's stand-in, which is one).
- **The CLI's run** (`runTests`): one temp folder a scenario (copy via `writeArchiveBytes` uncompressed with the
  archive's members — the runner rewrites it pkware anyway; spec.json; game.rep), one runner process a scenario
  (one game a process), the failed scenario's replay copied to `--out` (default `<map>.tests/` beside the map; `slug` of
  the name, NFC not NFKD — NFKD split Hangul into jamo in the test), the temp folder removed in `finally`. Lines live per
  scenario; the header waits for the first `start` (map size, copy kind). "the game said:" lines are the `WARNING:`
  lines the game printed (unplaceable units), which explain most surprises. Formats in `report.ts`
  (`githubTestAnnotations` with `line=` — the scenario name's line in its file, found by `JSON.stringify(name)` in the
  text — `junitTestXml` a case per scenario with `time`, `sarifTestJson` a rule per expectation kind).
- **CI: no step.** The engine needs the player's game files; a step that skipped without them would be green on every
  GitHub runner and mean nothing. `workflowText` adds a comment saying so, with the line for a self-hosted runner;
  `IGNORE_LINES` gained `*.tests/` (and this repository's .gitignore too, since the sample sits in tests/maps/).
- **Measured** (Remastered copy, staged deploy `node scripts/deploy-play.mjs --no-bots` in the scm-sim worktree,
  `python3 -m http.server` over dist-play, `SCMJS_PLAY_URL=http://127.0.0.1:8765/play`, a scratch `SCMJS_CACHE`):
  ums.scx's three scenarios in 5.6 s (≈ 1.9 s each: 1.5 s load, 0.3 s start, the frames); the failed one's replay reads
  with `replay info` (600 frames, scmjs vs Surtur Brood) and plays back to its end with scm-sim's replay runner; the
  replay's map (`replay map`) has the setup trigger first. **Fidelity**: a scenario with a chat line, a Carrier ordered
  to the middle and the switch set at 0:05, failed on purpose (expects defeat), ends in victory at frame 234 live and its
  kept replay, played by scm-sim's replay runner, ends at 234 with outcomes victory/defeat, `by` "victory". original.scm (converted), remastered.scx, melee.scx,
  hybrid.scm each pass a setup + step smoke scenario. scm-sim `tests/exact-map-test.test.ts`: three Marines ordered
  from location 1 to 2 by a step all counted there by Bring, the trigger waiting for them fires, chat shown.
- Overview unchanged (23 lines; `test` is under `map …`); `RUNNER_COMMANDS.map` still "map trace|cost" (doctor's tests
  pin it); `RUNNERS.map.command` now names trace, cost, rush and test. `tests/cli-map-test.test.ts` (8): the small
  forms, planning (the triggers, the spec, the words), the refusals, the sample, judging, the stand-in runner
  (`FAKE_TEST_RUNNER` in tests/support/mapRunner.ts: answers from `SCMJS_TEST_ANSWER`, logs specs to `SCMJS_TEST_SPECS`),
  the three formats.
- **Not built**: a player leaving (the game has one person; a departure is `net.ts`'s, a game between people); the
  computers' commands; expectations at a frame (only the end, and text/trigger counts over the whole run); an MCP tool
  (`map_test`); running scenarios in parallel (one process each would work; memory per game ~ the lifted image);
  the replay's start date is 0 (1969 in `replay info`) — `saveReplay.ts` leaves it, as the play page's Save Replay does.

## A map's picture: `map preview` (`cli/src/preview.ts`, `paint.ts`, `png.ts`, `gamefiles.ts`) — 2026-11-07

`scmjs map preview <map> [--out p.png|-] [--scale n] [--width cols] [--no-units] [--blocks] [--starcraft] [--json]`.

- **Split for reuse (the MCP server can return the PNG as image content):** `preview.ts`'s top half is pure —
  `terrainPicture(scn, tileset, scale)` → RGBA, `resizePicture` (separable area average, fractional spans),
  `placeMarks(scn, unitsDat, factor, w, h)` → `Mark[]` (boxes in picture pixels, kind start/building/unit/mineral/geyser,
  colour, start label), `drawMarks`, and `mapPicture(map, {tileset, units}, {scale} | {width})` / `previewPng(...)` →
  `{png, picture, marks, counts}`. `paint.ts` is the terminal (pure string functions of a picture + marks); `png.ts`
  the encoder (RGB colour type 2 unless `alpha`, filter 0 every row, one IDAT from `deflateSync`, table CRC-32);
  `gamefiles.ts` the copy: `openGameFiles(named)` → `GameFiles { read(member) }` over kascade (Remastered) or mopaq
  (1.16.1: StarDat, BrooDat, patch_rt by name in any case, later wins), `readTileset` (`.vx4ex` first, else `.vx4`),
  `readUnitsDat` (null on failure → each unit one tile). `previewMap(input, map, o, term, stdout)` is the command;
  `term` (`terminalInfo()`: columns, depth truecolor/256/none, unicode, inline protocol) is a parameter so tests set it.
- **Core exports added**: `loadTileset`, `megatileForTile`, `drawMegatile`, `MEGATILE_PX`, `Tileset`, `TilesetFiles`,
  `decodeUnitsDat`, `UnitsDat`, `unitGeometry`, `UnitGeometry`, `displayColorHex` (COLR + Remastered CRGB, what the
  editor's export uses rather than `PLAYER_COLORS` directly). docs/core.md has a row for them.
- **Terrain**: each megatile is drawn once at 32 px into a scratch buffer and averaged to `scale × scale`
  (`32/scale` px a side), cached by megatile id, then copied per tile — the editor's `FLAT_PX` mean colour is the
  `scale 1` case. Id with no megatile (`megatileForTile` −1) is black as the editor draws it; megatile 0 is drawn
  (black anyway). PNG scales are 1–32 powers of two; the terminal draws at the next one up from its pixels a tile and
  reduces (`--scale` there may be a fraction: a column is one picture pixel, a row two).
- **Marks** follow `mapImage.ts`'s minimap dots: units.dat placement box × factor, `max(1, round)`, centred with
  `round(c − w/2)` (= `floor(c)` for a one-pixel dot, which the test pins), clamped inside; order resources →
  buildings → units (bigger first) → start locations on top. Minerals `#5fd7ff` (the editor's), geysers `#3ddc84`.
  A start location's box is its own placement size; framed (edge `round(min/8)`) with a 30% tint inside when ≥ 4 px
  each way, solid below; in the terminal its number sits in the cell holding the box's middle (`labelCells`).
- **Terminal**: width = `--width`, else `--scale × mapW`, else `min(columns − 1, 2 × mapW, (columns − 1) × mapW / mapH)`
  — the last keeps a tall map within half the columns in rows. `▀` with fg = upper pixel, bg = lower; codes only when
  they change; an odd last row has bg 49. 256: `ansi256` = nearer of the 6×6×6 cube (xterm's 0/95/135/…/255 steps)
  and the 24 greys. **ASCII** (no colour, or `unicode` false): shades ` .:-=+*%@` stretched between the picture's 2nd
  and 98th luma percentile (the first try used absolute luma and a jungle map was all dots), `#`/`o`/`$` marks, start
  digits; coloured with fg codes where colour exists. kitty (`KITTY_WINDOW_ID`, `TERM=xterm-kitty`) / iTerm2
  (`TERM_PROGRAM=iTerm.app`) on a TTY, not under `TMUX`/`STY`, get the PNG inline (kitty `f=100,a=T,q=2,c=cols` in
  4096-byte base64 pieces; iTerm2 `]1337;File=inline=1;width=cols;preserveAspectRatio=1`), at the PNG scale ≥ 8 px a
  column (cap 32); `--blocks` refuses it. **The inline path is tested by string only** — no kitty or iTerm2 here.
- **Measured** (WSL, the Remastered copy on /mnt/c): kascade `Storage.open` ~190 ms, a tileset's five files ~50 ms
  (vr4 3.5 MB the bulk), units.dat 3 ms; the copy opened and read ~230 ms in all; drawing a 128 × 128 map at 4 px + encoding the PNG ~22 ms. Whole command (node start
  included) 0.43–0.50 s for the terminal and for a 512 px PNG; 0.83 s for 3072 px at scale 32 (3 MB PNG). So nothing is
  cached on disk. A stand-in 1.16.1 copy (StarDat/BrooDat written with mopaq from the Remastered files) gave a PNG
  **byte-identical** to the Remastered one, 0.23 s; a real 1.16.1 copy reads its archives whole (`readFileSync`, the
  real StarDat is tens of MB) — not measured, there is none on this machine.
- **Traps**: `tests/maps/*` have **no terrain** (MTXM all 0 = megatile 0, black) — their preview is black ground with
  the marks, which is right; `map new` maps have DIRT ids and draw as ground. `gameCopyKind` wants `StarDat.mpq` /
  `BrooDat.mpq` spelled so (existsSync is case-sensitive on Linux), while `classicArchives` takes any case — a copy
  with capitals is not found by `findGameCopy` there (not changed here; engine.ts is shared). **Fixed 2026-11-07
  (`cli-polish`)**: `gameCopyKind` lists the folder once (`readdirSafe`) and takes both names in any case; Remastered
  detection is unchanged. scm-sim's runners had the same rule (`gameCopy.ts`, `bwapi/run.ts`: `existsSync` of the exact
  names, archives opened by them) and would have refused the copy the CLI now finds — fixed there in the same round
  (`replay-runner-ends`), so a lower-case copy plays only with a deploy from after it. The `--units` option is
  hidden beside `--no-units` (commander keeps `units` undefined unless one is given; `!== false` is the test).
- Tests: `tests/cli-preview.test.ts` (14): PNG chunks/CRC/inflate both colour types; half blocks 24-bit and 256 from a
  known picture; `ansi256` points; ASCII with marks and a number; the start number's cell; inline protocols; widths;
  terrain at 1/4/32 from a made-up tileset; marks placed (unit at map px → pixel and cell); a PNG's IHDR; a stand-in
  1.16.1 copy built with mopaq (order, case, later archive's palette wins, missing tileset) and the command end to end
  through it; option refusals before the copy is looked for; and `describe.skipIf(!findGameCopy)` the real copy
  (badlands megatiles, units.dat's command centre 128 wide, ums.scx in the terminal and as a PNG to a stream).
- Not built: start-location numbers inside the PNG (no font), sprites/doodads' overlays, fog, locations, a `doctor`
  line naming this command, the MCP tool (the pure functions are ready for it).

## Where a map changed: `map diff --picture` (`cli/src/diffpicture.ts`) — 2026-11-07

`scmjs map diff a b [--rev r] --picture [--out p.png|-] [--side-by-side] [--scale n] [--width cols] [--blocks]
[--starcraft] [--json]`: options on the existing command, additive (no flag = the text form, unchanged). `--out` and
`--side-by-side` imply `--picture`; `--scale/--width/--blocks/--starcraft` without it are refused (exit 2). Exit code
is the comparison's (1 when different), picture or not. Overview unchanged.

- **Pure top half, as preview.ts's**: `diffChanges(a, b)` (no graphics) → canvas = the larger map each way, a `TILE`
  value per canvas tile (same / changed id / a only / b only / neither — **compared by position**, so a resize anchored
  elsewhere than top-left shows everything changed), `unitChanges`, `locationChanges` by slot, counts, `bounds.tiles`
  (changed ids only) and `bounds.all` (tiles + units + locations, in tiles). `changePicture(a, b, graphics, {scale |
  width})` → `{picture, scale, marks, changes, diff}`; `sideBySide(a, b, {a, b graphics}, o)` → `a | changes | b`
  (`a | b` for two tilesets) with the panels' marks offset, gap `GAP_COLOR` (`2 × scale` px, 4–32; 2 columns in the
  terminal). `changePicture` **throws** on two tilesets; the command draws side by side then, with a note, and the
  legend leaves the tiles out (ids of two tilesets mean nothing to each other; `--json` still has the count).
- **Units**: `map diff`'s multiset (`unitKey`, now exported from diff.ts, the record minus `serial`), then each removed
  unit paired with the nearest added one of the same `unitId` + `owner` within `MOVE_RADIUS` (4 tiles), nearest pairs
  first (greedy over all candidates, sorted by distance then index): distance 0 = `changed` (edited in place), else
  `moved`. So the legend's `+n −n` are smaller than the text diff's `Units +n −n`, which counts a move as both.
  `diff.ts`'s `locations()` was split into the exported `locationChanges` (index + change) so the two agree.
- **Drawing**: terrain at a whole PNG scale (`terrainPicture` of b, a's terrain for tiles only a has), unchanged tiles
  darkened to `DIM` 0.6, changed tinted `TILE_COLOR` magenta at 0.6, one-side tiles striped (`band = max(2, s/2)` px
  diagonals, white 0.55 / dimmed), `PAD_COLOR` where neither; fitted to a width by `resizePicture` like `mapPicture`.
  Then landmarks = `placeMarks` over b's **kept** units filtered to start/mineral/geyser, with start locations and
  geysers recoloured grey (`START_LANDMARK`, `GEYSER_LANDMARK`): the first PNG had preview's green geysers and red/green
  slot frames, which read as added/removed. Changes on top: locations as outlines (`max(1, scale/8)`; changed = red
  frame where it was if the box moved + yellow where it is; **Anywhere (63) never drawn**, though counted, since it
  changes with every resize); units as filled boxes of the placement size but **at least two tiles** (`CHANGE_MIN`; at
  one tile a marine was a 4 px dot on a 512 px PNG), a dark edge when ≥ 4 px, order removed → changed → moved → added;
  a moved unit also gets a frame of its old box and a line between the boxes' middles.
- **Terminal**: `halfBlocks` as preview; ASCII gets an **overlay** — `paint.ts#asciiShades` gained an optional
  `overlay` map (cell → char + colour) applied last, and `sgr` is exported for the legend. Letters `A R M x / #`, none
  of them a shade. `--side-by-side` in the terminal: three panels of `terminalWidth(W, H, room/3 + 1)` columns when ≥
  `MIN_PANEL` (32), i.e. from ~101 columns; else the change picture alone and a dim line saying so; a header line names
  the panels. kitty/iTerm2 get the PNG inline as preview does (`--blocks` refuses). `--json` = the `MapDiff` plus
  `picture: DiffPictureReport` (counts, bounds, layout, size, copy, ms).
- **Measured** (Crescent Moon 128 × 128, Remastered copy on /mnt/c): whole command 0.47–0.52 s (copy ~260 ms, drawing
  ~40 ms) for the terminal, a 512 px PNG and the 1552 px side-by-side; the text diff alone 0.2 s.
- Tests `tests/cli-diffpicture.test.ts` (12): pairing (nearest first, radius, owner, edited in place), tiles/bounds on a
  resized canvas, the change picture at scale 1 and 4 from preview's made-up tileset (changed tile, the moved marine's
  box, line and old frame, the dark edge, added/removed/location outline/stripes/pad), two tilesets refused + side by
  side, ASCII overlay + legend, the command through a stand-in 1.16.1 copy with jungle and ice (option refusals, the
  narrow fallback, three panels at 160 columns, the tileset note, a PNG to a stream), and the real copy (skipIf).
- Not built: an MCP `map_diff` image (the pure functions are ready — `changePicture` + `encodePng`), labels inside the
  PNG (no font), detecting a shifted resize (anchor) to compare tiles at the offset, sprites/doodads, a `doctor` row.

## `replay map`, and the picture over MCP (`cli/src/replaymap.ts`, `mcp.ts`) — 2026-11-07, before the release

- **`scmjs replay map <rep> [--out map|-] [--force]`**: `rep.chk` (what `@scm-js/replay` parses out of the replay —
  the game's own copy of the scenario) written **as it is**, no parse/re-encode, with `writeArchiveBytes(chk,
  {pkware, encrypt, listfile})` (a fresh map's save rule) or bare for `.chk`; parsed only to name and measure it.
  Default `<replay>.scx` beside it; exists → exit 2 unless `--force`; `--out -` through `writeOutput`. A replay holds
  no members (sounds), so a map whose triggers play a WAV checks with the "not in the archive" warning — docs say so.
  Measured on legacy_cp949.rep: 투혼 1.3, 117 KB archive, the bare chk 4.1 MB (the map pads its STR).
- **`map_preview` tool** returns MCP **image content** (`{type: "image", data: base64, mimeType: "image/png"}`) plus a
  text line of facts and `structuredContent` (size, tileset, picture, counts, ms) — the reason `preview.ts` was split
  into pure functions. `scale` 1–8 (schema `max(8)` and a CliError for 3/5/6/7; 8 px a tile on 256 × 256 is 2048 px,
  ~1 MB of base64, which is as much as a model should be sent). `starcraft` as the game tools take it. **`replay_map`
  tool** = the command (`out`, `force`); `-` is refused by the `tool()` wrapper as everywhere.
- Tests: `tests/cli-mcp.test.ts` — `replay_map` from a replay stub (`{chk}` is all `writeReplayMap` reads, and `kindOf`
  must see a replay: the stub file is written with a real header? no — the test calls through a temp `.rep` only where
  a real one is on the machine, `describe.skipIf`), `map_preview` against the copy of the game (`skipIf(!findGameCopy)`),
  the no-copy failure as `isError`. `tests/cli-replaymap.test.ts` covers `writeReplayMap` with a stub replay.

## `map play`: a lobby from a map (`cli/src/open.ts`) — 2026-11-07

- **The same hand-over as `map open`, to the play page.** `handOver(input, url, {lobby, onMessage, onAddress, timeout,
  what})`: the loopback page posts `scmjs.open {files, lobby: true}` on `scmjs.ready`, and **forwards every other
  `scmjs.*` message** the opened page posts to `POST /<token>/message` (string fields only); `scmjs.taken` ends the
  wait, the rest go to `onMessage`. The old `/taken` route went; `map open` goes through the same path. The play
  page's half is scm-sim's `web/handoff.ts` (jeany55/scm-sim#44): `scmjs.waiting {reason: "files" | "sign-in",
  message}`, `scmjs.invite {link, invite, name}` as soon as `POST /v1/games` answered, `scmjs.error {message}`
  (with `lobby`, the page keeps the problem on screen and a later Invite Players there still sends `invite` +
  `taken`, so the command keeps waiting rather than exits), then `scmjs.taken`. Origin rule as the editor's:
  loopback or the page's own origin; **scmjs.dev/play must send no Cross-Origin-Opener-Policy header** (it does not).
- `playInLobby(input, {play, live, onAddress, timeout})` → `LobbyOutcome {link, invite, name, waited[], error}`;
  the command prints the link with `live`, exits 1 with the page's error when no link came. Default page
  `PLAY_PAGE_URL` = scmjs.dev/play, `SCMJS_PLAY_URL`/hidden `--play` for a dev server. Five-minute wait (a sign-in
  and a game-files download may be on the way). Needs no `scmjs login`: the page signs in itself.
- **Verified by hand** against scm-sim's `play-handoff` branch: vite on 5312 (`?relay=http://localhost:8799&setup=` —
  a page a script drives seats nobody without `setup`), `scripts/relay.ts --port 8799`, headless Chromium
  (`~/.cache/scmjs-headless-libs`) opening the command's loopback page: ready → invite
  (`http://localhost:5312/?relay=…&game=invite1x4hunfg`) → taken, the relay listing the game in `lobby` state.
  **Trap:** a python `str.replace` of the page's script with no `assert` silently left the old page in — the symptom
  was the old "Opened in the editor" text and a 404 on `/taken`; check the replacement applied.
- `tests/cli-play.test.ts` (3): a stand-in page reads the loopback page and posts the messages; the error-then-retry
  path; the timeout.

## Maps from scmscx.com: `map fetch` (`cli/src/scmscx.ts`, `fetch.ts`) — 2026-11-07

`scmjs map fetch <words…> [--limit n] [--json]` lists the best matches; `--id <id|scmscx.com/map/<id>>` or `<words…>
--first` downloads one `[--out file|folder|-] [--force] [--open]`. **The fourth network call** (with `about`/`doctor`'s
npm ask and the engine fetch), only when the command is run; nothing cached.

- **The site has no documented API.** These are the routes its own pages use; the editor's plugin
  (`~/github/plugin-scm-scx/client.ts`, through a Cloudflare forwarder for want of CORS) and scm-server
  (`src/scmscx.ts`) use the same. Node calls `https://scmscx.com` directly. **Verified with curl on 2026-11-07:**
  - `GET /api/uiv2/search/{words}` (words `encodeURIComponent`ed in the path; `?offset=N` pages, `sort=` defaults to
    relevancy) → 200 `{ maps: [{ id, filename, scenario_name, last_modified, uploaded_time }], total_results }`, **a
    row per file name** (the same id repeats), 300 a page; "lost temple" → 2,918 rows. No match → `{maps: [],
    total_results: 0}`. The rows have no size, tileset or players.
  - `GET /api/uiv2/map_info/{id}` → `{ scenario, scenario_description, player_owners[12] (6 human, 5 computer),
    player_side, forces, wavs, processing, internal_id, meta: { mpq_hash, mpq_size, chk_size, chkhash, downloads, views,
    uploaded_by, uploaded_time, last_downloaded, last_viewed }, properties: { width, height, tileset (ERA), ver,
    triggers, units, doodads, … } }` (~0.27 s). **An unknown or malformed id is 500** "Something went wrong :)", not 404.
  - `GET /api/uiv2/filenames2/{id}` → `[{ filename, modified_time }]`, oldest first, names repeat per time.
  - `GET /api/uiv2/minimap/{id}` → PNG bytes (served as `application/octet-stream`); not used here.
  - `GET /api/maps/{mpq_hash}` → the archive, `application/octet-stream`, `cache-control: no-store`, no
    content-length over HTTP/2; size = `meta.mpq_size` (175,785 for B8V7fdyj). Unknown hash → 404, empty body.
- **`scmscx.ts` is the only file that knows the site** (`ROUTES`, one line each with its shape): `get` = fetch with
  `user-agent: scmjs/<version> (+https://docs.scmjs.dev/cli/)` and an AbortController whose 10 s timer is **reset on
  each body chunk** (a slow line downloading a big map is not cut off; a stalled one is). Errors are CliError exit 1:
  "<host> did not answer within 10 seconds", "could not be reached (ECONNREFUSED|ENOTFOUND…)" (undici's `cause.code`),
  "answered 503 Service Unavailable", "has no such map" (404, and 500 on map_info), "not JSON". `base`/`timeout`/
  `fetch` are options for the tests only — no environment variable points it elsewhere.
- **The search** merges rows by id (name = control bytes stripped, else the file name) and asks `map_info` for the
  first `--limit` (default 10, max 50 — one page of 300 rows always covers it; no paging), **four at a time**; a row
  whose details fail stays, blank. Table: Name (cut to fit, 24–48 columns), Size, Tileset (`TILESETS[era & 7]`),
  Players (humans, `+ n computer`), Downloads (`meta.downloads`; "uploaded N times" is not something the site counts —
  filenames2's length is names × times seen, not uploads), Id. No match → exit 1, as `map find`.
- **The download** (`fetchMap`): `map_info` + filenames2 → the name = **the first file name the site lists** (oldest,
  usually the original), else the scenario name, else the id, through `safeFileName` (controls dropped, `<>:"/\|?*`
  → `_`, leading dots and trailing dots/spaces off — so `../x` is `_x` —, Windows device names prefixed `_`, 120
  characters, `.scm`/`.scx` added by VER ≥ 205 when missing). `--out`: `-`, an existing folder or one ending in `/`
  (joined with the name), else the file. **The exists check comes before the bytes are fetched** (exit 2, `--force`).
  Bytes without the MPQ magic → "not a map (n B, no archive header)"; then `loadMapInput` (`openMapBytes`) — a
  failure is "not a map this can read"; nothing is written either way. Then `writeOutput` (the pipes' writer), and
  the lines are `map info`'s first ones (title, Map, File) + From (page, uploader, downloads) + "Written to", via
  `say` (stderr when `--out -`). `--json` with `--out -` and `--open` with `--out -` are refused (exit 2); `--out`,
  `--force`, `--open` without `--id`/`--first` too. `--open` = `openInScmjs` on the written file.
- **Measured** by hand: the search with ten details 0.6 s from WSL; four maps downloaded in all while building it.
- `tests/cli-fetch.test.ts` (11 + 1 live): a `http.createServer` stand-in (search JSON with repeated ids, map_info,
  filenames2, ums.scx's bytes, HTML, an MPQ magic with nothing behind it, 500, 503, a route that never answers, a
  download that stalls after 100 bytes, a closed port), the user agent, naming, `-` to a `PassThrough`, refusals.
  `SCMJS_LIVE=1 npx vitest run tests/cli-fetch.test.ts` runs the live one (search 3 + one download).
- Not built: sort orders and the site's filters (tileset, size, players — `searchPath` in the plugin has them all),
  `/api/uiv2/random`, the minimap in the terminal (`map preview` needs the game's tileset; the site's PNG could be
  shown with `paint.ts`), an MCP tool, a progress line for a big download, paging past the first 300 rows.

## scmjs.dev from the terminal: `login`, `logout`, `account`, `map share` (`account.ts`, `share.ts`) — 2026-11-07

Phase one of "share links from files on disk". Server half: ai-server 0.36.0 (`POST /v1/auth/start { cli: true }`).

- **The sign-in** is the editor's popup flow with `open.ts`'s loopback page as the opener. The command serves
  `http://127.0.0.1:<random port>/<random token>`, and **asks `POST /v1/auth/start { provider, returnOrigin: <that
  origin>, cli: true }` itself** (Node: no Origin header) before opening the browser; the page gets the provider's URL
  baked in, `window.open`s it as a named popup (no `noopener` — the callback posts to `window.opener`; a button when
  the browser blocks a window it opens by itself), takes the `scmjs-ai-auth` message only from the server's origin and
  that popup, and POSTs `{session}` to `/<token>/session` (refused unless `Origin` is the page's own). The command
  checks the session with `GET /v1/account` (kind must be `account`) before keeping it, and answers the page's POST
  with the name or the error, so the tab says "Signed in as Ann" or why not. Two minutes (`SIGN_IN_TIMEOUT_MS`); the
  server's state lives 10. `BROWSER=none` prints the address (`openBrowser`). **Why the command, not the page, asks for
  the start:** the page then never calls the server, so **no CORS change at all** — the narrowest option. The server
  accepts a loopback return origin only for `cli: true` (any port, plain http, 127.0.0.1/localhost/[::1]), refuses
  `cli: true` with an Origin header (a web page cannot claim to be the command), and never lets `cli` reach a
  non-loopback origin; `allowedOrigins` is untouched. The callback page drops "go back to the editor" for a loopback
  origin.
- **The session file** (`sessionPath`): `SCMJS_SESSION`, else `%APPDATA%\scmjs\session.json` on Windows, else
  `$XDG_CONFIG_HOME|~/.config/scmjs/session.json` (macOS too). `{ server, session, name, provider, savedAt }`, written
  via `.part` + rename, file 600 and folder 700 (chmod after write: `writeFileSync`'s `mode` applies only to a new
  file). **A session is sent only to the server it came from**: `requireSession(server)` refuses a file whose `server`
  differs from `SCMJS_SERVER` ("Sign in first: scmjs login", exit 2, the hint names both) — so a local-server session
  never reaches api.scmjs.dev. `logout` POSTs `/v1/auth/logout` to the file's own server (unreachable is no reason to
  keep the file) and deletes it. `account` refreshes the stored name when the provider's changed, since the doctor's
  row reads the name from the file and makes no request.
- **`Client`**: JSON or FormData, bearer, `AbortSignal.timeout` (30 s, 120 s for uploads and rooms), refusals as
  `CliError(server's message + "Try again in N seconds.")`; 401/`unauthorized` → exit 2 with "scmjs login signs in
  again."; an unreachable server says the `cause.code` (`ECONNREFUSED`; fetch's own refusal of a "bad port" such as 9
  says "bad port"). `missingOk` turns a 404 into null for a server without that part (rooms off, maps off).
- **`map share <map>`**: `GET /v1/maps`, the newest map whose head `fileName` equals this one (case-insensitive) — the
  server has no "same map" notion, the file name is the CLI's rule (`--new` skips it). Same sha256 as its head →
  nothing uploaded, `GET /v1/maps/:id` and the existing link to that revision reused (else one made); else `POST
  /v1/maps/:id/revisions` or `POST /v1/maps` (multipart: `file`, `fileName`, `name` on create only, `note`, `meta`,
  `picture`), then `POST /v1/maps/:id/links { revision: head }` — pinned, the editor dialog's default. `meta` as the
  plugin's `metaOf`: plain scenario name (`visible(gameText())`), `tilesetOf` id (not the display name — the first run
  sent "Badlands"), seated/human slots from `playerTypes` (1,2,3,5,6 / 2,6), units, triggers, a 1 px/tile PNG
  thumbnail ≤ 150 KB. **The picture** is `previewPng` at `clamp(floor(512 / max(w,h)), 1, 8)` px a tile, halved until
  ≤ 900 KB (the server takes 1 MB, PNG or JPEG), only when `findGameCopy` finds a copy; none → uploaded without one
  (the server makes no card; the guide already says such a link's card shows the size), and the third line says
  why. A `--starcraft` folder that is not a copy is an error, not a silent "no picture". A map from `-` is named
  `<scenario name>.scx|.chk` (`shareFileName`), since `stdin.scx` would match every piped map.
- **`--edit [--keep day|week|month|forever]`**: `POST /v1/rooms { name, map: base64 }` (live: nothing else — the
  server's `create` reads only those) or with `keepDays` 1/7/30/null (the plugin's `KEEP_CHOICES`; "Until everyone
  leaves" = no `keepDays`) plus `fileName`, `note`, `meta`, `picture` base64 and `mapId` of the same-file-name map, so
  a kept room is that map's next revision as in the editor. Rooms take MPQs only (`mapLooksRight`): a bare `.chk` is
  packed with `writeArchiveBytes` first. **Trap: a live room the CLI opens has nobody in it** — the editor's owner
  joins at once, the command does not — so the server's idle sweep (`rooms.idleMinutes`, 30 on the example config)
  closes it if nobody comes; the line says "if nobody comes, it closes after a while".
- **Links**: `https://scmjs.dev/editor/map/<token>` / `share/<invite>`, plus `?scmjs-server=<server>` when
  `SCMJS_SERVER` is not api.scmjs.dev (the plugin's `linkTo` rule), so a link made against a local server opens there.
  Output: the link alone on the first line (`| head -1`), the facts, a dim line of what the link does.
- **Overview**: `account show|login|logout` is a row under "This tool:" (one-line description); the `login` / `logout`
  shortcuts stay **hidden** (as `completion`), since the account row names them; `map share` is under `map …`. Found
  by: `map share` without a session says `scmjs login`, the doctor's row says it, `scmjs help account`, docs. Hidden
  commands are not in the completion scripts either (`commandTree` skips `_hidden`). The rows for `init` and `account`
  came from dropping the blank lines between the groups — see "The overview's rows".
- **Doctor**: `scmjsDevCheck(file, server)` reads the file only — "signed in as Ann" + the file's path, or a dim `·
  not signed in` (`not signed in to scmjs.dev` for a session from another server) with `scmjs login` under it, state
  `ok` either way like Claude Code's; in `Tools`; `readiness` untouched.
- **Verified end to end (2026-11-07)**: a local ai-server (PGlite, maps in memory, kept rooms, a fake Discord whose
  token/userinfo answer through `fetch`) on 127.0.0.1:18787; the built command with `BROWSER=none` printed the page;
  headless Chromium opened it, the page opened the popup by itself, `context.route("https://discord.com/**")` sent it
  straight to the callback with the state, the callback posted to the loopback page, the command printed "Signed in
  ... as Ann", the file was `-rw-------`. Then `map share` (new map, unchanged, a pipe), `--edit`, `--keep week`,
  `account`, `doctor`, `logout` (the old session then 401), and the errors. `tests/cli-share.test.ts` (16) does the same
  against an `http.createServer` stand-in. Not built: an MCP tool for sharing, a `--follow` link (the newest
  revision), listing or removing links and maps (`account maps`), ending a shared room from the terminal.

## `replay share` (`cli/src/replayshare.ts`) — 2026-11-07, on the sign-in branch

- One request: `POST /v1/replays` multipart `file` + `fileName` + `note?` + `picture?` + `link=1`, which answers
  the stored replay's facts (`ReplayView`: map, players, matchup, frames, game type, when) **and its first link**
  (ai-server #18 made `link=1` for this); the same bytes again answer 200 `existing: true` with the link that is
  there. `linkTo("replay", token)` → `https://scmjs.dev/editor/replay/<token>` (the editor's scmjs.dev plugin v1.40.0
  opens it in Aftermath by a synthetic drop; the Worker's card from `/v1/previews/replay/:token`). Limits are the
  server's (8 MB a replay, 500 replays, the account's storage cap): their messages are printed as they come.
- **The map's picture for the card** is drawn here, not on the server (it has no game graphics): `parseScenario(rep.chk)`
  → `previewPng(scn, graphics, {width})` under 900 KB, as `share.ts#picturesOf` does for a map; none without a copy
  of the game, `--no-picture` to skip. A replay from `-` is named `replay.rep`.
- `tests/cli-replay-share.test.ts` (3) against a stand-in server parsing the multipart with `Request.formData()`.
  Not run against the real server here (ai-server #18 was open); the agent that built #18 drove the editor end.

## Opening (`cli/src/open.ts`)

- **Desktop app**: `SCMJS_APP`, else the installers' places (Windows `%LOCALAPPDATA%\Programs\scmJS\scmJS.exe` and
  Program Files; macOS `/Applications/scmJS.app` via `open -a`; Linux `/opt/scmJS/…`; **WSL**: the Windows app,
  found through `cmd.exe /c echo %LOCALAPPDATA%` + `wslpath`, the file passed as a Windows path). Launched detached
  with the path; `desktop/main.ts`'s `mapArg` now takes `.rep` too, and `sendOpen` reads a replay without adding it
  to `MapFiles` (that allowlist is for maps the renderer may write). `useDesktopFiles` goes through
  `openGivenFiles`, which waits for `pluginsStartedAtom` and hands claimed files (a replay → Aftermath) to plugins.
  An app older than this change ignores a `.rep` argument (it just focuses).
- **Browser hand-over**: the command serves a random-token page on 127.0.0.1 (random port), opens it in the
  default browser (`BROWSER=none` skips that and the address is printed; WSL uses `cmd.exe /c start`). The page
  `window.open`s the editor with `?handoff=1` (a button if the popup is blocked). The editor
  (`src/hooks/useOpenerHandoff.ts`) posts `scmjs.ready` to its opener; the page answers **every** ready with
  `scmjs.open` {files:[{name, bytes}]}; the editor accepts it only from `window.opener` with a loopback origin
  (`http://127.0.0.1|localhost|[::1]:port`) or the editor's own origin (scmjs.dev/play's "Analyse in the Editor"
  after a game, scm-sim `web/replayFile.ts`), once, opens it like a drop (`openGivenFiles`), and posts
  `scmjs.taken`, which the page forwards to the command, which exits. Why this way round: a hosted page fetching
  from localhost meets Chrome's local-network-access prompt and Safari's mixed-content block; a loopback page
  posting to the window it opened meets neither. No COOP header on scmjs.dev, which this depends on (window.opener).
- **Trap (cost a run)**: React StrictMode runs the effect twice in dev. The first run removed `?handoff` from the
  address and the second returned early, so nothing listened. `HANDOFF` is read once at module load, `handedOver`
  is module-level, and the page re-sends on each ready because the first listener is gone before it arrives.
- Checked 2026-11-05 against `npx vite` with headless Chromium: `ums.scx` opened ("Opened ums.scx — 64×64, 21
  units"), `legacy_cp949.rep` opened in Aftermath (view-only, timeline, APM 276/227). The desktop launch from WSL
  was not run (it would open the app on the user's screen).

## Next (proposed to the user)

Done 2026-11-06: triggers/strings export-import, diff, completions, `map build` (above), on `@scm-js/core`
(`core.md`), `map run`, `map unpack|pack`, `bot run` (above). Still proposed:
`map render`, `bot run` (a headless game through scm-sim), `setup --from` for the game files. **Publishing is CI's**
(2026-11-06): `build.yml`'s `cli` job, stable channel only, `build:cli` (stamps the version), checks it equals the
release's, skips a version npm has, `npm publish` by trusted publishing over OIDC with provenance, like `plugin-api`
and `core`. 0.8.8 was published by hand (security key: own terminal, `--browser=false`); every version since from CI.

## The overview's rows (`cli/src/banner.ts`) — 2026-11-07

`rootHelp` prints the three groups **with no blank line between them**; the one blank line is before Options. That
freed two of the 23 rows (a 24-row terminal keeps the globe on screen; `tests/cli.test.ts` holds the count), which
`init [folder]` and `account show|login|logout` took. A new top-level row now needs a line freed again: a one-line
description is the first rule (commander wraps a long one onto a second row, which the count sees), and a hidden
command (`{ hidden: true }`: `completion`, `login`, `logout`, `help`) is the fallback.
