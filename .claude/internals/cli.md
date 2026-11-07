# The `scmjs` command line

`cli/` is the npm package **`@scm-js/cli`** (its command is `scmjs`): `scmjs about | doctor | info | map info|check|open|new|dump|find|set|resize|triggers|strings|diff|build|run|unpack|pack|trace|cost |
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

`about` asks `registry.npmjs.org/@scm-js/cli/latest` (2 s timeout, nothing else in the CLI touches the network) and
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
  (docs/cli.md "A map as text, and in git"): `diff.scmjs.textconv "scmjs map dump"`, `diff.scmjs.xfuncname "^## "`
  (hunk headers name the part), `.gitattributes` `*.scx diff=scmjs`. Verified in a scratch repo: `git diff` and
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
