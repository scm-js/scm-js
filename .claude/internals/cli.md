# The `scmjs` command line

`cli/` is the npm package **`@scm-js/cli`** (its command is `scmjs`): `scmjs about | doctor | info | mcp | lsp | map info|check|open|new|generate|dump|find|fetch|set|resize|triggers|strings|sounds|diff|log|blame|merge|build|run|unpack|pack|trace|cost|rush|balance|test [record]|preview|heatmap|coverage|optimize|analyze |
replay info|map|open|watch|export|share | mod info|unpack|pack|check|diff|new|build|play|test | plugin new|check|dev | bot new|init|build|update|run|ladder`, or `npx @scm-js/cli …`. npm refused the plain name `scmjs` on the first publish (2026-11-06,
E403 "too similar to scss, sockjs"), so the user chose the scope beside @scm-js/replay and @scm-js/plugin-api. The reader's page is `docs/cli.md`. The shape was the user's (2026-11-05): one command, a noun for
each kind of thing (`map`, `replay`, `plugin`, `bot`), "an impressive UX tool … not overly engineered".

**The reader's guide is organised by task** (2026-11-07 rewrite, branch `cli-docs`): `docs/cli.md`'s `##` pages are
Getting started, Looking inside a map, Making a map, Changing a map, Maps in git, Running a map in the game, Replays,
Sharing from the terminal, Bots, For developers, Command reference (every command linked to its section, a cheat
sheet), then In the source. The old build-order pages' addresses are forwarded by `MOVED` in
`scripts/lib/docs/site.mjs`. A new command gets a `###` on the page of its task and a row in the reference. Its
pictures (`docs/images/cli-*.webp`) are made by `scripts/cli-screenshots.mjs` (see `docs-site.md`); re-run it when a
command's output changes, with `--play-url` at a staged scm-sim deploy when the play page lacks the newest runner.

## Design

- **The editor's code, not a copy.** Maps are read with `openMapFile` (`services/mapIo.ts`): built maps restored,
  members read, warnings — what the editor would show. Statistics are `mapStatistics` with no tileset/dat (so no
  terrain table, no building counts); the check is `validateScenario(scn, { extras })`, so the rules that need the
  tileset or units.dat (units on unwalkable ground, …) do not run. Strings go through `t()`, in the language the
  command chose (English or Korean; "The command line in Korean" below). Replays are read by **`@scm-js/replay`** (github.com/scm-js/replay, ~/github/replay), extracted 2026-11-05
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
  The version is the editor's (`package.json`), written into `cli/package.json` by the build and by the release commit (`release.yml`); commit and build date
  are `define`d. **Licences**: the build's `scmjs-cli-notices` plugin reads the bundle's module ids for
  `node_modules/<pkg>` and writes `cli/dist/THIRD-PARTY-NOTICES.txt` with `cliNotices` (`scripts/lib/notices.mjs`,
  throws on a package with no licence file); `cli/LICENSE` is a copy of the root one. Today: @scm-js/replay,
  commander, fflate (via mopaq), mopaq, picocolors; ATTRIBUTION.md has a table for them. Added 2026-11-06 just
  before the first publish, which had gone without either (the publish failed on 2FA first). commander 15 needs Node ≥ 22.12 (`engines`).
  The Vite builds live in `scripts/lib/cli-bundle.mjs` (`bundleCli`, `bundleWeigh`), shared with the single
  executable's CommonJS build ("Without Node" below); the npm bundle differs only by the `__SCMJS_INSTALL__` define.
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
  `src/plugins/builtin.ts` to empty tables and `ko.json` to `{}` (as `build-core.mjs` does; since the Korean slice the
  catalogue is cut to what the bundle's modules ask for instead): 3.66 MB, i.e. the host
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
  a replay of the game saved out (the engine records commands; a `--replay` is a natural next step). Both came with
  `bot ladder` (below): the relay is local, in scm-sim's match runner.

## A ladder: `bot ladder` (`cli/src/ladder.ts`, `engine.ts`) — 2026-11-07

`scmjs bot ladder <bots…> --maps <maps…> [--races r] [--games 1 | --seeds a,b] [--frames 50000] [--out] [--data]
[--parallel 1] [--starcraft] [--engine] [--json]`: every pairing of the sides on every map, a line as each game ends, then
the standing (Elo, games, won/lost/undecided, average length, the bot's ms a frame, its longest frame, frames over
55 ms) and, with three sides or more, the head-to-head. A fork built both ends (scm-sim branch `bot-ladder`).

- **The spike's answer: local lockstep works, no server.** One BWAPI build fits a game's memory, so two bots are two
  copies of the game, each a process with one bot. scm-sim's `src/bwapi/match.ts` (the **match runner**) starts a seat
  a bot (its own file again, `--seat k`) and is itself the relay over the seats' stdin/stdout: each frame a seat runs
  its bot's `think`, sends that frame's commands, waits for the relay's `turn` (protocol.ts's message, one frame a turn)
  and steps it with `ExactNetEngine.stepTurn` — the page's path for a community bot in a game between people
  (`seatBwapiBot` with `net`: BWAPI shared, commands captured). No clock: a turn closes when every seat has sent, so
  the game is the same however fast each bot is. Hashes every 24 frames and the two replays are compared. Evidence:
  McRave vs UAlbertaBot to the end (16,387 frames), 683 comparisons equal, replays byte-identical; the real ladder
  below compared every game's copies the same way. The hosted relay was never needed (and would be wrong for a ladder:
  its clock makes the turn a command lands in depend on timing).
- **One path for both kinds of game**: a bot against the computer is the same runner with one seat (the computer is
  the game's own, `opponents`), so the CLI has one runner and one protocol. JSON lines: `start` {map, copy, seed,
  players [{side, slot, kind, name, race, …}], seats, ms}, `text` {side, text}, `progress` (with `--every`; the ladder
  passes 0), `end` {frame, players, decided, winner (side index), by victory|left|frames|desync, bots [{state
  ended|left|failed|crashed, frames, ms, maxMs, over55, over1s, over10s, commands, kept}], replay {file, bytes, agreed},
  hashes {compared, differedAt}, ms}, `error`. Runner args: `<map> --bot "file|race|datadir" --computer race --seed
  --frames --every --replay`. Exit 0, 1 a bot's copy failed, 2 could not start.
- **The relay ends the game for all seats at one frame**: 48 frames (`SETTLE_FRAMES`) after a seat reports it decided
  (every side has an outcome, or one won; BWAPI calls `onEnd` within 36), or the frame limit; a hash mismatch ends it
  as `desync` (counted by nobody's Elo). A seat that dies, or gives no turn for 60 s (300 s for frame 0, the bots'
  map analysis), is a player who left: `gone` in the next turn; by "left"; its bot `crashed`. Learning files: a seat
  reads `datadir` into `bwapi-data/read`, writes back what `keepable` keeps after `onEnd`, nothing when its copy failed.
- **The CLI half**: `RUNNERS.match` (`matchRunner`/`match-<hash>.mjs`, `scripts/bundle-match-run.mjs` → deploy-play stages
  it); doctor's `RUNNER_COMMANDS.match = "bot ladder"` and a ready row. `ladder.ts`: `parseEntrants` (a `.scmbot`'s
  header gives key and name; `:race` only when the text after the last colon is a race, for Windows paths; `computer`
  expands to one entrant a race of `--races`; duplicates get `-2` keys and labels), `schedule` (seeds outermost, then
  maps, pairs, races, seats: bot vs bot both lobby orders, a bot first against the computer, no computer pairs; rounds
  first so a ladder cut short is even), `replayName` (`<a>-vs-<b>_<map>_<RvR>_seed<n>.rep`, `-2` when taken),
  `eloRatings` (1500, K 32, undecided ½, in **schedule order** so `--parallel` changes nothing; desync and unplayed
  games skipped), `standings`, `headToHead`, `playGame` (one runner process), `runLadder` (a pool of `--parallel`
  workers; `ladder.json` beside the replays), `ladderJson`, `printLadder`. Default folder `ladder-YYYY-MM-DD-HHMM` in the
  cwd (`-2`… when taken): a date alone collides twice a day; the replays, `ladder.json` and `bwapi-data/<key>/` (the
  learning files) together make one ladder something to keep or delete whole. `--json` sends the live lines to stderr.
  Exit 1 when a game was not played, went out of step, or a bot's copy failed; a loss is not a failure. An engine
  build that lacks only a runner says "Fetching the newer runners", not "about 25 MB".
- **Original 1.00 maps**: main.ts opens each `--maps` with `openForEdit` and `trace.ts#gameMap` (VER 59 → a temp
  Brood War copy, removed in a `finally`); the replay is named after the map given. Why: the game *starts* a VER 59
  melee map from its own archive (the runner hands the map's own archive unless a member is zlib/bzip2 or the scenario
  is Remastered's — `mapBytes`' rewrite of a VER 59 map hits 0x1D007C20, the unlifted storm path `map trace` met), but
  the replay runner cannot play a VER 59 replay (same address), and a ladder's point is watching the losses.
- **Replays that play back (found by the first real ladder)**: `replay watch` of McRave–UAlbertaBot on Binary Burghs
  said "the game parted from the replay at 9:41"; the game's replay reads a frame into 544 bytes (scm-sim
  `stream.ts` FRAME_BYTES) and two busy bots recorded frames of 629–697 (each turn holds 480). scm-sim's
  `TurnFeed.recordRoom` (default unlimited, the page unchanged) now caps a turn as recorded, and the match runner gives
  each bot 544 / bots; the rest waits a turn. Checked frame by frame on a 20,727-frame McRave–UAlbertaBot game: the live
  hashes and the replay's played back are the same at every frame. Every other replay of that ladder watched to the
  same winner (frames ≤ 510 bytes). The play page's Save Replay of two busy bots between people still can record such
  frames — a note for scm-sim, not changed.
- **A bot that never gets going**: McRave does not finish its start on (2)Midnight Lagoon in five minutes (the plain
  bot runner neither), so the first ladder's McRave games there ended "no answer for 300 s". A lone seat that dies now
  ends as the computer's win (`by: "left"`, the bot `crashed`, no replay) rather than an error, and `--timeout <s>`
  (default 60; the first frame max(timeout, 300)) is passed to the runner.
- **Traps met**: tests/maps/melee.scx has no resources (the generated maps carry nothing of Blizzard's), so bots
  "stall" there at 0 minerals — not a desync, the replay agreed; use real maps. The replay header's date is the seed
  (offset 8 is the game's seed, the start time in a real game), so a ladder's replays say 1970. scm-sim's main
  checkout had an empty node_modules (the worktree's link pointed at it): unlinked and `npm ci` in the worktree.
- **Measured, the real run** (the built CLI, a staged deploy of scm-sim `bot-ladder` served by `python3 -m
  http.server` over `dist-play`, `SCMJS_PLAY_URL`/`SCMJS_CACHE` pointed at it, the user's Remastered copy):
  `bot ladder mcrave.scmbot:z ualbertabot.scmbot:p example.scmbot:t computer --races tpz --maps "(2)Binary Burghs.scx"
  "(2)Ice Floes.scx" --frames 24000 --parallel 6` (bots built into `.scmbot` from scm-sim's `data/bots` with
  `writeBundle`): 30 games in 9 min 24 s; 6,248 hash comparisons, none different; all 30 replays agreed between the
  copies; every McRave–UAlbertaBot replay (largest frames exactly 544 bytes) and the others tried watched to the game's
  own winner. UAlbertaBot 1618 (12-2), McRave 1581 (9-2-3, 6.96 ms a frame, its start 4.3 s), the computers ~1475–1502,
  ExampleAIModule 1335 (0-14). A seat takes ~1.3 GB resident (10 GB reserved); 6 games at once was fine on 24 cores and
  30 GB. Learning folders filled as expected (McRave's per-opponent `…_BASIL_2026_1 Learning.txt`, UAlbertaBot's
  `<opponent>.txt`).
- `tests/cli-bot-ladder.test.ts` (13): races and entrants (paths with colons, duplicates, errors), the schedule and
  names, the ladder folder, Elo maths (K/2 between equals, draws, skipped games, order independence), the standing and
  head-to-head lines, the game lines, and `runLadder` over a stand-in match runner (`.cjs`: winner by seed, `crash*`
  bot files die, `broken*` maps refused; writes the replay and notes games in the data folders), `--parallel`, and the
  failure paths (no map, no copy, a deploy before the match runner). scm-sim's `tests/bwapi-match.test.ts`: the relay
  over stand-in seats, and two example bots on the served files when present.

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
- **git config** `diff.scmjs.textconv/xfuncname/cachetextconv` and `merge.scmjs.name/driver` (`GIT_SETTINGS`; the merge
  pair added with `map merge`, see "Merging maps") in the repository via `git -C top
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

## Merging maps: `map merge` and git's merge driver (`cli/src/merge.ts`) — 2026-11-07

`scmjs map merge <base> <ours> <theirs> [--out] [--ours|--theirs] [--name] [--dry-run] [--json]`, and `map merge <map>`
alone during a stopped `git merge`. A verb under `map`, so **no overview row** (the `map` term already ends in `…`).

- **Shape**: `runMerge` (command level: shortcuts, writing) → `mergeDocs(base, ours, theirs, out, prefer)` (pure, on
  `OpenedMap`s). `out` is a **second opening of ours's bytes**, changed in place and written with `writeBack`; ours
  itself is only read (the comparisons need it as it was). So the result is ours + theirs's
  delta: every section the merge did not mark dirty is ours's bytes, byte for byte (tested on SIDE alone).
- **Shortcuts first, by bytes** (as git): ours == theirs → `same`; base == theirs → `ours`; base == ours → `theirs`,
  written exactly (no parse). Without `--out` and with ours as the result nothing is written — except in the staged
  mode, where the target is the working-tree file, not stage 2's bytes.
- **Order in `mergeDocs`**: header (revision via `changeMapVersion`, encoding via `changeTextEncoding`) first, since
  the settings pairs and MRGN slots follow the revision; the frame; terrain and objects; locations; triggers;
  briefing; settings; archive members; unmodelled sections; **strings last** (below).
- **Frame** (`mergeFrame`): same width/height/era on all three → fine merge. Otherwise the grid group (DIM, ERA, MTXM,
  TILE, ISOM, MASK, UNIT, THG2, DD2 and the locations' rects) comes whole from the side that changed geometry; both →
  one "Size and tileset" conflict, `--theirs` takes theirs's group. Location names/flags still merge per field then.
- **Terrain** per index on MTXM, TILE, MASK, ISOM (null on one side → whole-value rule). ISOM conflicts are shown at a
  tile (`isomTile`: row = index / ((w/2+1)·4), col·2), so they join the tile rectangles. Conflicting tiles →
  `tileRegions` (8-connected components → bounding boxes, `{x0,y0,x1,y1,count}`). `diffpicture.ts` does not group
  regions (one bounding box); this is new.
- **Units/doodads/sprites** (`instanceDelta` + `mergeInstances`): multiset match by key (units: record minus serial,
  `unitKey`; doodads/sprites: whole record); unmatched base = removed, unmatched side = added; a removed+added pair is
  an *edit* by **serial first** (units; the editor's `updateUnits` keeps it), else same group (unitId:owner,
  doodadId, spriteId:flags) within `MOVE_RADIUS` 4 tiles, nearest first. Per base instance: theirs kept → nothing;
  theirs removed + ours kept → remove; + ours edited → conflict; theirs edited + ours kept → replace; + ours removed →
  conflict; both edited → same key fine, else conflict. Theirs's additions are appended minus ours's identical
  additions (both adding the same unit = once). Serials: a unit in one of ours's slots keeps ours's serial (theirs's
  edit included); an appended unit keeps its own unless taken, then max+1, and `relatedSerial` among appended units
  follows the renumbering. Identical duplicates (two equal marines) are interchangeable, so which one "was removed" is
  first-come; harmless.
- **Locations** per slot, three fields each (rect atomic — a mix of two rects would be a box neither drew — elevation
  flags, name as text). A rename on one side and a move on the other both land.
- **Triggers/briefing**: `triggerKey` = JSON of the record with each `text`/`wav` arg (per `actionDef`'s arg kinds)
  replaced by its **text**, locations **by number**. Not the text form (`formatTrigger`): it names locations, so a
  rename on one side changed every trigger mentioning it (found while designing; the task suggested the text form).
  `mergeList` = diff3 (`lcsMatch`: prefix/suffix trim + DP, a middle over 16M cells counts as one change; `diff3Chunks`)
  then, in a chunk both changed: both inserted at one place (empty base) → ours then theirs minus duplicates; same
  length on all three → item by item; one side only inserted (base a subsequence of it) and the other changed items
  in place (same length) or only deleted → combined; else one conflict for the chunk. Git conflicts on adjacent
  lines; this does not, which is the point for triggers. Conflicts show `summarizeTrigger` lines whole in the data;
  `printMerge` cuts each around the first character where ours and theirs part (`around`, 100 columns).
- **Settings** (`settingsView`): one object per scenario with string references as text (name, description, force
  names, unit names, switch names, WAV paths), merged per top-level key by `mergeValue` (recurses into same-length
  lists/typed arrays and same-key objects; a leaf both changed is a conflict, worded by `describe`). Installed by
  setting fields + `markDirty`; the revision pairs through `unitSettingsSections` & co (new core exports), COLR only
  when the file has it or VER ≥ 205, IOWN with OWNR when there is no separate `editorPlayerTypes`.
- **Strings** (`mergeStrings`), the trap of the design: the table is index-addressed and must not be renumbered (raw
  sections, the editor's rule). Every reference site of `out` is walked (`stringSites`: SPRP, FORC, MRGN, UNIS/x
  names, SWNM, WAV, TRIG/MBRF text+wav). Sites from ours keep their numbers and claim them. A site from theirs (a
  location name taken from theirs, a trigger record from theirs — `foreign`/`foreignActions`) wants theirs's text and
  prefers theirs's number: kept if ours's table has that text there; written there if the number is unclaimed and
  empty, past the end, or referenced in ours only by what was replaced (**an edit in place stays in place** — the test
  checks "Hold the base." is gone); else shares a slot with that text; else the lowest empty slot no version refers
  to; else appended. **Blizzard's maps have all 1024 STR slots** (unused = "" at one offset), so appending overflowed
  the first time the every-map loop ran; the free-slot step came from that. A table pushed over `stringCapacity` by
  the merge is a CliError (ours's own overflow is allowed: the editor's `internString` does it too). Then strings no
  version refers to merge by number (theirs's prune lands; a clash puts theirs's text in a free slot). `renumbered`
  counts theirs's sites that did not get their number — the "Strings N renumbered" line. Both sides appending a
  string at the same new number is the common case (two people each add a trigger).
- **Archive members** by normalised name, bytes; **unmodelled sections** by name, all copies compared as bytes;
  theirs's copies replace ours's at ours's first position, or go after the section theirs had before them.
- **Stored (unnamed) members** are ours's, always — they are pinned blobs; not merged. **Built maps** open restored,
  so the merge is of the sources and the result is written unbuilt (`writeBack` writes the restored map, as for every
  writing command): build again.
- **Output**: `writeBack(out, inputPath, target)` with `inputPath` = `--name` when ours's path has no map extension
  (git's `.merge_file_XXXXXX`), so the format comes from the real name; `out.fileName` set likewise. **Default target
  is ours** (git merge-file and the driver contract agree; the command is the same by hand and under git). With
  `--name` and target = ours, `written.path` is reported as the name (the first run said "written to
  /tmp/…/.merge_file_EE7k6Y").
- **Git driver** (`init.ts` `GIT_SETTINGS`): `merge.scmjs.driver = scmjs map merge %O %A %B --out %A --name %P`,
  `merge.scmjs.name`. git runs it from the repository's top with **relative** temp names (`.merge_file_…`, no
  extension → `asMap` accepts a bare chk by `looksLikeChk`, now exported from files.ts) and quotes the placeholders
  (checked with a space in the map's name). Exit 0 = merged; non-zero = conflict, and git keeps %A as left (ours),
  index stages 1–3 for the path. `.gitattributes` gains `*.scx|scm|chk merge=scmjs` as separate lines;
  `missingLines` now treats a pattern naming its own driver *for the same attribute* as there (diff or merge).
  `printInit` groups the settings rows by prefix (`git config diff.scmjs`, `git config merge.scmjs`).
- **Staged mode** (`stagedInputs`): `git show :1:/:2:/:3:<path from top>`; a missing stage → exit 2 "is it in a merge
  that stopped on it?". The hint after a driver conflict names the map (`--name`), so it reads
  `scmjs map merge "ridge map.scx" --ours (or --theirs) …; then git add …`.
- **Tests** (`tests/cli-map-merge.test.ts`, 23): lcs/diff3/mergeList cases, regions, `around`; ums.scx versions made
  with the editor's functions (units + trigger vs location rename + string edit; both appending a string; byte for
  byte; trigger conflict ± rules; adjacent trigger edits; terrain rectangles; unit edit/remove conflicts; settings
  fields; an unmodelled section); every map in `mapFiles()` (committed + fixtures); shortcuts and the no-write
  conflict path; init's lines. **The git test** runs real `git merge` with the driver, but `scmjs` is not on PATH in
  a test, so the driver is a stand-in `node driver.mjs <url> %O %A %B --out %A --name %P` that POSTs `{cwd, args}`
  to an HTTP server in the test process, which calls `runMerge` — so git must be run with async `execFile` (a
  `spawnSync` would block the server). Checked by hand with the built CLI on PATH and the exact line `init` writes:
  clean merge, conflict, `map merge <map>` / `--theirs`, `git add`, commit.
- **Not done**: an MCP tool (`map_merge`); a picture of terrain conflicts (`diffpicture` could draw `tileRegions`);
  per-conflict choices (only one rule for all; the editor is the place for mixing); merging two resized maps tile by
  tile under an anchor; merging the TrigScript source text inside its member (it is bytes here); `doctor`'s Ready
  table does not name merge (needs nothing beyond git).

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

## A map from a seed: `map generate` (`cli/src/generate.ts`, `generatecmd.ts`, `bases.ts`) — 2026-11-07

`scmjs map generate <out> [--players 2|3|4|6|8] [--size WxH] [--tileset] [--seed n] [--symmetry rotational|mirror-x|mirror-y|diagonal]
[--style open|chokes] [--name] [--rush] [--starcraft] [--force] [--json]` (hidden: `--tilesets <folder>` = a folder laid out
like `public/tileset`, used by the tests; `--engine` for `--rush`). The showpiece of the CLI round; branch `cli-map-generate`.

- **Needs the game's files, by design.** `paintIsom` resolves every rect to a tile through `isomTables(tileset)` — the
  shape-link table is *built from the CV5* (`buildLinks`), only the numbering/adjacency is in `data/isomTables.ts` — and the
  ramps are doodads whose placement rule is `dddata.bin`. So there is no game-data-free mode: `readGraphics` reads
  cv5/vf4/vr4/wpe/vx4(ex) through `gamefiles.ts#readTileset` and `tileset\<name>\dddata.bin` from the copy, as `map preview`
  does, and `openGameFiles`' hint says why. ~0.3 s for a 128 map with the copy (kascade open ~0.2 s), ~25–80 ms the ground,
  ~30–70 ms the walks; 8 players on 256 ~1.5 s.
- **Three pure steps.** `planMap(options, innerSeed)` → `Plan` (a `Lattice`: class LOW/HIGH/WATER per diamond, `locked`
  low ground for bases/aprons, `deco` for the second look, `complex` = the players' template footprint; the complexes;
  free bases; `images` = for every group element, which complex each lands on). `buildScenario` = `layGround` (flat fill of
  the recipe's low terrain, then **one `paintIsomDiamonds` stroke per terrain**: water, high, low deco, high deco; then the
  ramps) + `placeBases` (halls, Melee Wizard lines, start locations, slots n..7 Inactive). `measureMap` = `walkGrid` (VF4
  walkable minitiles, eroded 3 × 3 so a corridor is a unit wide, resource footprints cut out) + `groundFrom` (Dial's
  algorithm, 5/7 steps) per start + `validateScenario(scn, { tileset })` + `spread`. `generateMap` tries `innerSeed(seed, k)`
  for k < 12 (k = 0 is the seed itself), keeps the first within `BALANCE_TOLERANCE` (8%), else the least spread that passes;
  none passing → `LayoutError` → CliError exit 1. Final sweep, 364 option sets (jungle, badlands, ice, ashworld, platform;
  every player count, symmetry, size and style; two seeds): all laid out, 243 on the first inner seed; median spread 3.5%,
  start-to-start never over 6.1%; 18 kept over 8% (worst 16%), nearly all two players `mirror-y` and Ice.
- **`paintIsomDiamonds` (new, `editor/isom.ts`)** is `paintIsom` with a footprint of any shape: every listed diamond set at
  once (`IsomPass.placeMany`), their neighbours queued, one `propagate`, one `updateTiles`. Painting a terrain in one stroke
  is what makes the result independent of diamond order; painting diamond by diamond would ripple each time.
- **Ramps only face south.** Every ramp doodad in every tileset (jungle 12/13, badlands 77/78, ice 0/1, ashworld 45/46,
  platform 156–159) fits only the south-west or south-east cliff edge — measured by scanning `checkDoodadPlacement` round a
  painted plateau. So a complex can never be turned upside down, and **the symmetry acts on positions, not on the bases**:
  `makeTemplate` builds one complex (an isometric-rectangle core plus lobes, the ramp on the core's SE edge toward its east
  corner, an apron, the natural's disc 11–13 tiles down-right of the ramp, a low lane between) for a natural to the right,
  and each player's copy is that template x-flipped when it lies left of centre (`sx`). **What the symmetry places is the
  ramp's foot** (`Template.foot`, the apron's middle): the layout is drawn as fundamental naturals (`fundamentalNaturals`),
  converted to the fundamental foot, snapped to the lattice *before* mapping (so mirrors are exact), and imaged. Every walk
  out of a main is main → ramp → foot → …, so with the feet exact the start-to-start walks match to a percent or two. The
  first version imaged the naturals instead: the naturals matched but a bottom player's walk from its ramp to the middle cut
  the corner past its natural, and single-attempt spreads ran 10–60%. A bottom player's main stands above its ramp,
  toward the centre — it looks odd at first. It also stands between its ramp and anything up the map's side, so the
  free-base candidates keep off the sides (a side base was 6–14% farther for the bottom players).
  For the same reason **`rotational` with 4 or 8 players is the four-way mirror (hv)**: a quarter turn would put a natural on
  a side where its main has no room, and rot90/diag do not map the 2:1 diamond lattice to itself anyway. `diagonal` exists for
  two players on a square map, with the natural on the corner's diagonal; obstacles under it are rasterised approximately.
- **Remastered files cliff pieces with the VF4 ramp bit** (badlands 331–394, jungle 272+, ice 236+, ashworld 143+, …:
  2 × 5 … 8 × 5 pieces); `checkDoodadPlacement` takes them at a ramp's place. Two traps found in turn: (1) nearest-first
  picked them and some do not walk at all, so every fit within 7 tiles is tried and kept only when `walksBetween(top of
  plateau, apron)` holds in a 24-tile window (`walkGrid` takes a window); (2) a 2 × 5 piece passed that walk and
  `map rush` still found **no way out of player 1's main in the game** (Desert, seed 2026, 4 players; the other three
  mains, with the same piece, walked). So the candidates are ordered **first run of ids first** (sorted ids, cut at a gap
  > 20: jungle 12/13, badlands 77/78, ice 0/1, ashworld 45/46, platform 156–159, twilight 0/1 — the ramps every version
  has), the Remastered pieces only when none of those fits. That also makes Remastered and 1.16.1 pick the same ramps.
  The ramp candidates are the `ramp` doodads requiring a group of the recipe's `cliff` edge set (34 jungle family and
  badlands, 16 ashworld, 21 platform); Ice's ramp 0 also requires index 24 and still fits a plain cliff, so the filter is
  "needs the cliff", not "needs only the cliff". All ten sample maps were then walked with `map rush` (SCV): every start
  reaches every other; on the 8-player 192 map one walk of 56 (1 → 2, the longest, 253 tiles) "stopped short", the
  game's own pathing giving up on a long walk, while 2 → 1 arrived.
- **What the brush cannot join** (found as black `tile 0` rects, the `holes` check): two bodies of one class whose tips face
  each other across one diamond — not only across an edge (dx ± 1, dy ± 1) but edge-to-corner, e.g. (0, −2) and (1, +1).
  `squeezed()` fills a diamond with two same-class neighbours more than 120° apart *on the lattice* (u = (dx+dy)/2,
  v = (dx−dy)/2; in tile space the angles are wrong). `settle` applies it to HIGH and WATER, and to each level's deco, plus
  spur removal (< 2 same edge-neighbours), water ≥ 4 steps from high and ≥ 3 from a base, deco only with 3 steps of its own
  level all round. With those, `checkIsom(...).mismatched` is 0 and no tile is 0 on every layout swept.
- **Recipes** (`RECIPES`, CV5 indices): jungle/desert/ice/twilight low 2, high 3, cliff 34, water 5, deco 8/10; badlands
  2/3/34/5, deco grass 6/7; platform 3 (Platform)/5 (High Platform)/21, Space 2 as the water, plating 4/6; ashworld 2/4/16,
  magma 8, shale 6/7 **unbuildable** (`decoBuilds: false` keeps it out of the mains). **Installation has no recipe**: no
  terrain group in its CV5 is buildable (only doodad and unused groups), so it has no melee; refused with exit 2. The
  levels' heights are read off the tileset (`megatileHeight` of the terrain's first megatile): Jungle's High Dirt is the
  middle level, Platform's High Platform the top, so a hard-coded 2 was wrong.
- **Resources** are the Melee Wizard's `layoutBase` (copied into `bases.ts`; the plugin is not in the bundle) with `fits` =
  every tile buildable, all walkable, no ramp minitile, the hall's height, clear of other footprints and ≥ 3 from a ramp.
  Main 9 × 1500 + 5000 gas, line away from the ramp; natural 7, direction the one of 24 farthest from both the ramp and the
  middle, slightly outward; free bases 6, outward. A hall needs its level one tile all round it. The free-base candidates are
  fixed fractions of the map, imaged; images within 8 tiles are one base (a point on an axis), images closer than 30 drop
  the candidate (the diagonal put two side by side before).
- **Balance numbers**: `startSpread` = for every element of the symmetry and every pair of starts whose images are starts,
  the relative difference of their ground distances (always 0 for two players: the one pair is its own image);
  `freeSpread` = each start's walks to the free bases, sorted, against its image's; `spread` = the larger, which the
  retries and `balanced` go by. The walk to the middle (`toMiddle`) is reported but not compared: with a mesa or lake on
  the centre, "the nearest walkable minitile to the centre" depends on the side you come from (90 vs 62 tiles once). With
  three players the fourth complex has no start and its pairs are skipped (`compared` counts both; the summary leaves a part
  out when it compared nothing, so two players read "x% to the free bases" only). Checked against the game (`map rush`,
  SCV): Jungle Duel 1207, own walk 138 tiles, the game 4,468 / 4,486 px (140 tiles); Desert Crossing 2026 (4 players), own
  start-to-start spread 1.5%, the game's diagonals 4,394 vs 4,597 px (4.6%), adjacent pairs within 2%. The maps run in
  scm-sim, so they load.
- **Determinism**: no `Math.random` below `generateOptions` (which picks a seed when none is given and prints it). The same
  seed and options give the same bytes with the same game files (tested with `public/tileset`); the variation of each tile
  comes from the seeded rng, and Remastered and 1.16.1 lay the same tiles where their CV5s agree (the Remastered CV5 has 314
  more groups, the shared ones identical), but that was not compared byte for byte.
- **Overview**: `generate` is a verb under `map`, so no row; doctor's READY row is now `map preview|generate`.
- Tests: `tests/cli-map-generate.test.ts` — options and refusals, inner seeds, the plan's determinism, the middle its own
  image under h/v/rot180/hv (the complexes' footprint + 3 excluded), one template for every player, 3 players' spare
  complex, settle's invariants, the base layout; `describe.skipIf(!public/tileset)`: four maps (no tile 0, `checkIsom` 0,
  Check Map with the tileset, ramps, resources, connected, spread), the ramps as the only way up (`editorTiles` = the map
  without its doodads), same bytes for the same seed, the command end to end with `--tilesets`.
- **Not done**: no trees/rocks/doodads besides ramps, no third level (the tilesets' "high" terrains of the deco kind are
  only looks here), no bridges, no neutral buildings/critters, no back-door paths or island bases; the natural sits at a
  fixed place relative to the ramp (no choice of a wall-off); 4 players on a non-square map use the same corners; no MCP
  tool (`generateMap` is pure and ready for one); `--revision remastered` not offered (always Brood War 1.04).

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

## Cheap wins: `triggers|strings edit`, `--qr`, `map sounds` (`texteditor.ts`, `qr.ts`, `sounds.ts`) — 2026-11-07

- **`map triggers edit` / `map strings edit [--editor] [--out] [--briefing]`** (`editInEditor`): the export written to
  `<tmpdir>/scmjs-edit-XXXX/<map>.triggers.txt` (`.briefing.txt`, `.strings.txt`), the editor run with stdio
  inherited, then `importTriggers`/`importStrings` — the same parser and errors as `import` — and `writeBack` in
  place (`--out` for elsewhere; `-` refused both ways, the editor needs the terminal). **Editor choice** (`editorCommand`):
  `--editor`, `VISUAL`, `EDITOR` (git's order), else `notepad` / `vi`. **Spawn** (`editorSpawn`): an existing path or a
  bare word (`/^[\w@%+=:,./\\-]+$/`) runs as is; anything else (`code --wait`, a quoted path) runs as git does,
  `sh -c '<editor> "$@"' <editor> <file>`, so the file stays one argument; **on Windows always `shell: true`** (unless
  an existing `.exe`), since `code` is `code.cmd` and Node refuses a `.cmd` without a shell. SIGINT is ignored while
  the editor runs (git's habit: Ctrl-C in vi must not kill the command and strand the file). **"Nothing changed"**:
  the text equal after CRLF→LF and `trimEnd` (vi adds a final newline, Notepad may write CRLF), *or* the import gives
  the same triggers (`sameTriggers`; a comment-only edit) / no string replaced or added — the map is then not
  written. **Kept file**: a parse error (exit 1) or an editor that exits non-zero keeps the file and the hint says
  `The map is unchanged; your text is kept in <path>. Fix it there, then: scmjs map triggers import "<map>"
  "<path>"`; an editor that never started (ENOENT, exit 2) removes it. The error message names the file by its base
  name (`ums.triggers.txt, line 3: …`), the hint by its path. Tests (`tests/cli-edit.test.ts`, 8) use a stand-in Node
  script given as `--editor '"<node>" "<script>" <mode>'`, which goes through the `sh -c` path; they pass `dir` so
  kept files land in the test's folder. Tried by hand on a copy of ums.scx: same/comment → nothing changed, drop a
  trigger → 3 → 2 written, broken text → kept + exit 1, `EDITOR=nonexistent` → exit 2, `--editor false` → exit 1.
- **`--qr`** on `map share`, `replay share`, `map play` (after the "Lobby open" line, through `playInLobby`'s `qr`)
  and `account [show]` (each shared room's name, then its code). **Own encoder, no package**: an npm QR package
  would have meant a devDependency in the shared node_modules, a notices entry and an ATTRIBUTION row for ~250 lines
  of well-known algorithm; `qr.ts` is adapted from Project Nayuki's library (MIT, credited in ATTRIBUTION.md under
  "Adapted code", its copyright in the MIT notice list) — byte mode, L/M, versions 1–40, mask by the standard's four
  penalty rules. **Checked once by hand** (scratchpad, not in the repo): module-for-module equal to `qrcode@1.5.4`
  for every mask × both levels × eight texts of 11 to 2,300 bytes, up to version 40 (byte mode forced), its automatic mask choice equal too, and jsQR
  1.4.0 decoding both the matrix and the *terminal lines read back into pixels* (colour, plain and ASCII). The test
  pins the `https://scmjs.dev` matrix, capacities (M v1–10 = 14…213, v40 = 2331; L v40 = 2953), the "HELLO WORLD"
  1-M Reed–Solomon codewords, format bits M0/L0, version bits 7, and that the half blocks read back to the modules.
  **Drawing** (`qrLines`): two rows a line with `▀▄█`, a quiet zone of 2 (4 is the standard's; phones read 2 and the
  width matters); with colour the line is wrapped in `ESC[30;107m` (black on bright white) so a dark theme does not
  invert it; without colour the *light* modules are the marks, i.e. drawn for a dark terminal (qrencode's UTF8
  convention; phones read the inverted code). ASCII fallback (`unicode` false): `##` per module, one line a row —
  74 columns for a plain share link, 90 for one with `?scmjs-server=`. Under the first line, so `| head -1` is
  still the link; `--json` ignores `--qr`. **Not run against scmjs.dev**: no session on this machine; the share,
  play and account tests check the lines.
- **`map sounds [list] <map>` and `map sounds export <map> [--out]`** (`readSounds`/`exportSounds`): `readArchive`
  (not `openMapBytes`: a built map's sounds are the archive's as is) + `parseScenario(chk)` + `soundList` joined
  with `stored.unreadable`; then every other member that is audio by extension (`.wav/.ogg/.mp3`) or magic (RIFF…
  WAVE, OggS, ID3/MPEG sync). **mopaq does the decoding inside `readMembers`** (1.6.x: Huffman + IMA ADPCM sectors),
  so "decoded through mopaq" needs no code here; the campaign fixtures prove it — StarCraft Fortress's
  `1assualt.wav` is 62,416 bytes stored in 19,143 (3.3:1, the ADPCM path; the first sector is plain or PKWARE) and
  comes out a 16-bit PCM WAV of 1.4 s. Lengths: `parseWavHeader`+`wavDuration` (+`wavFormatLabel`, now on core's
  entry), Ogg from the last page's granule over the Vorbis rate (Opus: 48 kHz less pre-skip). A WAV-table name the
  archive lacks is `missing` (`stock` when under `sound\`: the game's own), one it holds but could not decode is
  `unreadable`; neither is fatal. Files: `fileFor(basename)`, the extension the bytes call for when the name has
  none, `-2`/`-3` on a clash (case-insensitive); the folder is made only when something is written (default
  `<map>-sounds` beside it). Seven of the 22 fixture maps carry sounds (15 in StarCraft Fortress); all came out
  playable (`file`: Microsoft PCM). Tests: `tests/cli-sounds.test.ts` (5) on ums.scx's tone and a map made from it
  with an Ogg, a second `tone.wav`, a missing entry and a stock path.
- **Rows.** The root overview is unchanged at 23 lines: all three live under `map …`, `replay …` and `account …`,
  which the overview already shows as one row each. In `scmjs map --help` the term width for a noun's own help is
  `TERM_WIDTH + 2` (`subcommandTerm` checks `cmd.parent?.parent`), so `triggers export|import|edit` is whole beside
  `strings export|import|edit|…` and the column did not widen. In docs/cli.md's Commands table `strings prune` was
  folded into the strings row (`export|import|edit|prune`) and that row went to `map sounds`.
- `@scm-js/core` gained `parseWavHeader`, `wavDuration`, `wavFormatLabel`, `WavInfo` (`core.md`).
- Not built: an MCP tool for sounds or edit (edit needs a terminal; sounds export would want a folder), sounds
  *import* (the Sound Editor's conversion needs Web Audio), re-edit on a parse error (`crontab -e`'s "try again?").

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

## TrigScript in a text editor: `lsp` (`cli/src/lsp.ts`, plugin `language.ts`) — 2026-11-07

`scmjs lsp [--map <map|folder>]` is a Language Server Protocol server on stdio for TrigScript: diagnostics on
open/change (250 ms debounce)/save, completion (+ resolve for signature and docs), hover, definition, document symbols.
Hidden from the overview (the 23 rows, above); `scmjs help lsp` and docs/cli.md "TrigScript in your text editor".

- **Where the language lives: the plugin**, `plugins/trigscript/language.ts` (`ScriptLanguage`, scm-js/plugin-trigscript#81;
  needs a TrigScript release ≥ 4.2.0 vendored before this type-checks and builds — the pin bump is the merge step). It is a TypeScript `LanguageService` over the script laid out exactly as `compileScript` lays it out
  (`trigscript.d.ts` from the map's names, `__trigscript__/<module>` for the stdlib, `__libraries__/<id>/…`, `lib.d.ts`
  = the concatenated es2023 lib) with the compiler's options (`scriptCompilerOptions`, now exported and used by
  `compileScript` itself), and `check()` = `compileScript(…, { sounds: false })`, so the errors *are* the build's.
  Plain data, 1-based, no fs, `ts` passed in. Shared with Monaco so far: the options and `variableNote` (the hover of
  a program's variable). Monaco keeps its own worker-side TS service (its layout is `node_modules/trigscript/…`); moving
  the window onto `ScriptLanguage` in the compile worker is possible later, not done. The CLI file is only the protocol
  and the file system.
- **Trap: `paths` without `baseUrl` and an empty current directory.** `compileScript`'s host says `""`; module
  resolution copes, but printing a type that names a library's module (a hover of `typeof import("waves/spawn")`) goes
  through `getLocalModuleSpecifier`, which computes `getPathsBasePath(...) || baseUrl` → `undefined` → a TypeError
  inside TypeScript. `language.ts` sets the internal `pathsBasePath: "."` on its copy of the options (`withBase`).
  The compiler itself was left alone; an error message that prints such a type could hit the same thing.
- **Which files are a script** (`scriptHomeOf`): the nearest folder above the file called `trigscript` is the script's
  root, as `map unpack` writes the archive's `trigscript\` members; its map is the parent when that is an unpacked map
  (`archive.json` or `staredit/scenario.chk`), else `--map`'s, else none (the fixed names). Without such a folder,
  only `--map` makes a file a script: an unpacked map's own `trigscript/`, or for a map file the nearest folder above
  with `main.ts`/`main.tsx`. Anything else gets nothing, so a client can attach the server to all TypeScript. The
  files are read through the plugin's own `readFiles`/`readLibraries` over a synthetic member map (`trigscript\…`),
  so the extensions and the `@libraries\<id>\library.json` rules are the build's; open documents override disk.
  The map's names: `openMapBytes(scenario.chk)` + `mapNames` (build.ts) with the archive's member names from
  `archive.json` (bytes not read; `soundList` needs names); re-read when the scenario's mtime/size changes. Location
  boxes (tiles) go to the hover.
- **Definitions outside the script's files** (stdlib, `trigscript.d.ts`, `lib.d.ts`, a `--map` file's library copies)
  are written to `<tmpdir>/scmjs-lsp/<sha1(root)[:12]>/<virtual path>` and that file is answered; requests on those
  files are routed back to their script (`shown`), so hover/definition work inside the stdlib. A library's copy in an
  unpacked map is answered as the real file under `trigscript/@libraries/`.
- **Protocol**: `vscode-languageserver` 11 + `vscode-languageserver-textdocument` 1.0.16, devDependencies bundled
  in (+~450 KB: the bundle went 4.95 → 5.40 MB). `createConnection` gets a `StreamMessageReader/Writer`, not the
  streams: given streams, the library calls `process.exit` when they end, which would kill a vitest worker in the
  in-process test. The exit notification still exits (0 after shutdown); the command exits itself when stdin ends.
  Their licence files are `License.txt`, which `scripts/lib/notices.mjs` did not look for (added).
  Console goes to stderr as in `mcp`. One workspace per script root, made single-flight (an open and a request racing
  had made two).
- **Measured** (ums.scx unpacked, a script importing `trigscript/fog` and the example `waves` library): a check
  ≈ 400–530 ms in the bundle (the first ~500, then ~350–450); `compileScript` alone ~200 ms warm for a small script
  without the stdlib. Completion/hover/definition answer from the language service in a few ms.
- **Tests**: `tests/cli-lsp.test.ts` speaks LSP (Content-Length frames) twice — in process over PassThrough pipes, and
  to the built `cli/dist/scmjs.mjs` over stdio (skipped when not built; the child is spawned **without `VITEST*`**,
  which main.ts reads as "imported by a test, do not run" — the first run hung on exactly that). Both skip when the
  vendored plugin has no `language.ts`. Driven for real from **Vim 9.1** (`job_start` with `in_mode/out_mode: 'lsp'`,
  headless): diagnostics, the fix in the buffer clearing them, completion after `locations.`, hovers, definitions into
  `@libraries/waves/spawn.ts` and the cached stdlib, the outline, exit 0. Neovim is not installed here, so the
  docs' Neovim/Helix snippets are unverified; the VS Code extension (`editors/vscode/` in the plugin) too.
- **UX trap, documented**: VS Code's / `ts_ls`'s own TypeScript also checks these files without TrigScript's
  declarations and calls `program`, `units` … unknown. Docs say to set `typescript.validate.enable: false` for the maps
  folder (VS Code), or keep `ts_ls` off it. A later step could have `map unpack` write a `tsconfig.json` and the
  declarations into the folder so a plain TypeScript server agrees.


## `scmjs dap` — designed, not built (2026-11-07)

Asked for as the stretch after `lsp`: a Debug Adapter Protocol server that runs a map in the engine with breakpoints on
triggers or TrigScript lines, a step of a frame / a pass, and variables (switches, death counts, a program's
variables). **Not started in code: the engine side is scm-sim work.** What exists and what is missing:

- **The map runner** (`trace.ts` → scm-sim `src/exact/runMap.ts`, fetched by `engine.ts`) is one-way: argv in, JSON lines
  out (start, progress, end with the folded trace/cost). It has no input channel, so it cannot pause, step, stop at a
  trigger or answer a memory read. The play page can (`scmjs.play.control` pause/resume/step/pass/seek and the
  per-pass `scmjs.play.triggers` lines, plugin-scm-sim `src/debug.ts`, scm-sim `web/handoff.ts`, live-plan D2), but
  only over `postMessage`.
- **TrigScript's debugger** (plugin `compiler/gameDebug.ts`, `debugModel.ts`) records one *test* run in the lifted game
  through a `DebugHost` (a `GameHandle` with `keep/restore` and the cost and memory taps) into a `DebugRecording`, and
  `DebugCursor` walks it forward and back by step/line/frame with breakpoints (`DebugPlace`), watches and the
  programs' variables (`DebugProgram`). The host is the play page's; no Node runner implements `DebugHost`.

The design, in two slices, each needing a scm-sim runner change first:

1. **TrigScript lines (recorded).** scm-sim: a `debugRunner` (or `runMap --debug-test <id>`) that loads TrigScript's
   `dist/gametest.js` beside the lifted game, implements `DebugHost` the way the play page does, runs one test and
   writes the `DebugRecording` (typed arrays as base64) as its end line. scmjs: `dap.ts` = `compileScript` with tests
   (the `modules` it returns are what the runner runs), the runner started as `trace.ts` starts the map runner, then a
   `DebugCursor` over the record answering DAP: `setBreakpoints` → `DebugPlace`s (file = the script's path in an
   unpacked map, as `lsp.ts` resolves it); `next`/`stepIn` → the cursor's step; a custom "step frame" request → the
   next frame; `stepBack`/`reverseContinue` come free (`supportsStepBack`: the record goes both ways); `threads` = one per
   program; `scopes`/`variables` = `DebugProgram.values`, plus the frame's text lines (`shown`). Death counts and
   switches are not in the script's memory span the record keeps: the runner would add a per-frame snapshot of the
   deaths table (`DEATHS_TABLE_ADDRESS`) and the switch dwords, or the record a "game reads" list.
2. **Triggers (live).** scm-sim: the map runner reads JSON lines on stdin with the play page's control set
   (`pause|resume|step|pass|seek`) and writes the page's per-pass triggers line. scmjs: `threads` = the trigger
   owners (P1–P8), a stack frame = the trigger row being run, function breakpoints = trigger names or `#row`, source
   breakpoints = lines of `map triggers export`'s text (the row each starts), `step` = a frame, a custom
   `stepPass`; variables = switches and death counts read through a `read` control message.

Both are DAP over stdio with the same framing as LSP (`Content-Length`), so `vscode-jsonrpc`'s stream reader/writer,
already bundled for `lsp`, would carry it (DAP is not JSON-RPC, but the framing helpers or a 30-line reader do).

## A replay as a clip: `replay export` (`cli/src/export.ts`, `browser.ts`, `camera.ts`, `gif.ts`) — 2026-11-07

`scmjs replay export <rep> [--out x.webm|.mp4|.gif] [--from --to m:ss] [--follow <player>|--at x,y|--all] [--speed]
[--size WxH] [--fps] [--browser] [--starcraft] [--json]`, hidden `--play <url>` (SCMJS_PLAY_URL). Needs scm-sim's
`replay-export` branch deployed (the page's `scmjs.view.record`, `?files=`); an older page answers ready without
`record` and the command says so.

- **Who draws**: the play page's own replay viewer (`/play/?view`), not a renderer of ours. The command serves on
  127.0.0.1 (random port): `/play/…` mirrored from the play page's address (assets and bots kept under
  `<cache>/page/<host>/`, engine files in `<cache>/engine/<build>/` — the same folder `ensureEngine` fills, so the 25 MB
  is shared with `replay watch`; `index.html` and `current.json` asked each time, the last page kept for offline);
  `/<token>/` the framing page (`hostPage()`, inline), `job`, `track`, `replay`, and `files/<path>` = the person's copy
  through `gamefiles.ts` (`servedGamePath`: classic names only — `hd2/`, `anim/`, `*.hd.*`, `.dds` refused, so the page
  draws SD; Remastered's pictures are the editor's copy's own layout, not CASC names). The page reads them as a new
  GameSource kind `served` (`?files=/<token>/files/`, same origin only, interface pack as fallback) and plays named
  (no archives needed, Remastered or 1.16.1). Same origin is why the framing page is ours: the viewer only listens to a
  same-origin parent.
- **Browser, no Playwright**: `browser.ts` finds Chrome/Chromium/Edge/Brave on PATH, the installers' places, then
  Playwright's `chromium-*` cache (newest; headless_shell skipped); `SCMJS_BROWSER`/`--browser` first. Started
  `--headless --remote-debugging-pipe` with a temp profile; CDP is NUL-framed JSON on fds 3/4 (`NulSplitter`, `Cdp`).
  Used only for `Target.createTarget`/`attachToTarget`, `Runtime.enable` (page exceptions into the error's hint;
  `SCMJS_DEBUG=1` prints console, host news and served paths), `Inspector.targetCrashed`, `Browser.close`. Everything
  else goes page → framing page → `fetch` POST to the command (`message`, `clip`, `picture`), which is simpler than
  evaluating over CDP and carries large bodies.
- **Why WebCodecs, not MediaRecorder or screencast** (decided before writing it): MediaRecorder and
  `Page.startScreencast` both run on the wall clock, so a slow picture is a dropped or stretched one and the clip
  cannot be made faster than real time. The page instead steps the game to each picture's frame (the worker's own
  `seek`, forward only; picture i shows frame `from + i·1000·speed/(fps·42)`, the camera read at the fractional
  frame), draws with `renderer.draw` on a canvas sized to the clip (`backing` replaced by `height/rows`; whole-number
  scale is unsmoothed), and hands `new VideoFrame(canvas, {timestamp})` to a `VideoEncoder` (VP9 `vp09.00.41.08`, VP8
  fallback, key frame every 2 s, queue kept ≤ 4). The chunks are muxed in the page (scm-sim `web/webm.ts`: EBML,
  SeekHead with 8-byte positions, Info with Duration, a Cluster per key frame or 30 s, Cues). Exact timing, no
  encoder on the command's side. `rows` = height / round(height/480): 360 at 720p (2×), 540 at 1080p.
- **MP4** = ffmpeg from the WebM (`libx264 -crf 26 -preset medium -pix_fmt yuv420p +faststart`; the WebM for it is
  recorded at 0.2 bit/pixel·frame, the kept WebM at 0.08). No ffmpeg → exit 1 with the install line before anything
  starts. **GIF is always ours** (`gif.ts`), from `format: "frames"` (RGBA per picture POSTed, the page waits for
  `scmjs.view.taken` at most four behind): per-picture median-cut palette over a 15-bit histogram, pixels unchanged
  from the last picture's shown colour transparent (disposal 1), LZW. Measured on 8 s of a fight (1560.rep 20:40):
  ours 11.7 MB; ffmpeg palettegen/paletteuse of the encoded clip 16.2–17.3 MB across four dither/stats settings, and
  blurrier (VP9 noise defeats the transparency). So the brief's "GIF through ffmpeg" was dropped; ~80 ms a 640×360
  picture to quantise.
- **The camera** (`camera.ts`): clicks first (`followTrack`: right-clicks, targeted orders, buildings, pings; hold
  1.5 s, two clicks at a new place, dead zone, cut beyond 1.25 screens, Gaussian ease σ 0.25 s of clip) — **useless
  on pro replays**: after a hotkey the army is sent by minimap clicks across the map (1560.rep 14:00: targets at
  (3744,288), (174,2613) while the army sat at the centre), so the camera showed empty ground. Now `actionTrack` from
  the replay runner (`gameMoments`: `--every 8 --from (from−3 s) --to`, run beside the page's start; the framing page
  asks `/track` only after `loaded`): per moment `aimOf` = the biggest fight (≥ 3 of the player's army within 7 tiles
  of enemy army/workers/buildings, centroid of the busiest view of them and the enemies in reach), else the densest
  view of their army, else of workers+buildings; `placesFromAims` holds until an aim elsewhere lasts 1 s (a fight
  0.4 s), dead zone 0.35 (fight 0.2), cut beyond 1.25 screens; then the same ease. Class has no unit type, so a lone
  overlord by an enemy base read as a fight until the three-unit rule. Clicks remain the fallback when the runner
  fails (camera words say "(by their clicks)"). Player owner = the runner's `start.players[].slot` matched by name.
- **Measured** (WSL, Remastered copy on /mnt/c, Playwright's Chromium 153 with libnspr4/libnss3 from apt-get download
  in LD_LIBRARY_PATH — the machine lacks them; a user's Chrome has them): 1560.rep (31 min ZvP) 14:00–14:30 at 720p24,
  720 pictures, recorded in ~18 s (40/s) after ~3 s load, 9.1 MB WebM; 20:30–20:58 (storm fight) 672 pictures in
  44 s (15/s), 7.1 MB WebM, MP4 10.6 MB; GIF 20:41–20:48 640×360 88 pictures 10.7 MB in 42 s (mostly the page's run
  on to 20:41 and the runner beside it); `--all --speed 16` 0:00–6:00 GIF 480×270 282 pictures 2.2 MB in 8.5 s. The
  page's run-on to `from` is ~1,500 frames/s (≈20 s to reach 20:00); the runner beside it 650–2,000 frames/s under
  that load. First picture's progress says "Going to m:ss in the game…" (`done: 0`).
- Tests: `tests/cli-export.test.ts` (18) — options and refusals, cache and served paths, the framing page's words,
  NUL framing incl. a split UTF-8 character, Cdp ids/errors/events/close, browser candidates over a fake Playwright
  cache, clicks/places/track/aims/settling, LZW past 4,096 codes and GIFs decoded back by a decoder in the test
  (exact pictures, transparency). scm-sim `tests/webm.test.ts` (7) reads the WebM back element by element. No browser
  in CI.
- **Not built / traps**: no sound; no Remastered pictures (would need the editor's HD copy layout served: `.hd.vr4`,
  `unit/hd/main_NNN.anim` slimmed, etc.); `--fog` through a player's eyes is a one-line `options` away but untested;
  the runner's unit class cannot tell larvae/overlords from fighters. Doctor's Browser row finds Playwright's Chromium
  here though it cannot start without those libraries (the command then reports the browser's own stderr). Vite
  empties `--outDir` even outside the root: a staged `engine/` beside a rebuilt page vanished twice. scm-sim's
  `deploy-play.mjs` without `--upload` was refused by the auto-mode classifier here; the page was built with
  `vite build` + env and staged by hand (engine links + `dist-run/replay.mjs` + a `current.json`).

## Where things happened: `map heatmap` (`cli/src/heatmap.ts`, `heat.ts`) — 2026-11-07

`scmjs map heatmap <map> <replays…|folders> [--what deaths|kills|buildings|paths] [--player n|name] [--until m:ss]
[--out p.png|-] [--side-by-side] [--scale n] [--width cols] [--blocks] [--force] [--parallel n] [--starcraft] [--json]`.
A fork built both ends (scm-sim branch `heatmap`, scm-js `cli-map-heatmap`).

- **The runner is the replay runner's `--events` mode, not a new bundle** (as rush is the map runner's): no
  `current.json` key, no `RUNNERS` kind, no doctor row (`RUNNERS.replay.command` now names map heatmap for the
  missing-runner hint). scm-sim's `src/exact/replayEvents.ts` (`ReplayEvents.after(frame)` after every `engine.step`)
  and `runReplay.ts`: `--events` (a bare flag, special-cased in `parseArgs` so it never eats the next argument) runs
  free to the end with no `frame` lines and no stdin; `start` gains `events: 1` (`EVENTS_VERSION`), then `death`
  {frame, unit, player, x, y, by}, `built` {frame, unit, player, x, y}, `walk` {frame, units: x, y, owner, class …}
  every `--sample` (24) frames, and `end` gains `events` {deaths, built, walks, unmatched}. `replay watch` never passes
  the flag, so its lines are unchanged. **An older runner** ignores the flag, sends a `start` without `events` and waits
  on stdin (closed: `startRunner` without `stdin`); `playForEvents` kills it and the command says "a replay runner from
  before map heatmap" (exit 1). The CLI passes the replay path first, before the flags.
- **Deaths are the game's own count**, not "a unit left the lists" (loading, Archon merges and removals also do that):
  after each frame the deaths table (0x58A364, 228 × 12 dwords) is diffed with the frame before; each rise is matched
  to a unit of that type and owner that left the visible/hidden lists (or whose slot came back with another
  uniqueness byte, +0xA5) within `PATIENCE` (8) frames either way, and placed where it last stood. Killer = +0x90 of the
  record (`lastAttackingPlayer`), read after the death when the slot was not reused, < 8 else null. Measured on
  1547.rep (35 min ZvP): 821 deaths placed, 4 rises unmatched, 8 with no killer; legacy_cp949: 89, 0 unmatched,
  75 + 12 by the two players, 2 none. **A Drone into an Extractor is not a death** in the table (checked: 10
  extractors, no drone death near any) — a special case written for it was removed. Buildings: a building type owned
  0–7 that is a new unit, or whose type was not a building the frame before (a Drone), or whose owner was neutral
  (a geyser becomes the Refinery/Extractor/Assimilator **in the same slot**: the first build counted none of them).
  Lair/Hive and Sunken are the same building. What stood at frame 0 is not counted. Walks: units not buildings or
  resources whose tile changed since their last sample, so idle units add nothing. Cost: none measurable (1547.rep's
  game 23.9 s with the tracker, 28.1 s without in a run beside it; the machine's noise is larger).
- **The CLI's pure half (`heat.ts`)**: `GameEvents` (flat number lists: deaths 6 a death with killer −1 for none,
  built 5, walks `frame, n, n × 4`), `takeEvent`, `matchReplay` (sha256 of the map's `readArchive().chk` — or the bytes
  for a bare `.chk` — against the replay's `chk`: "same"; else `sameName` (plainText, spaces folded, case) + width and
  height: "name"; else `--force` "forced", else the reason "played on X (w × h)[, another size]"), `heatPoints`
  (deaths skip `NOT_A_LOSS` = Scarab 85, Nuclear Missile 14, Disruption Web 105, Dark Swarm 202; kills need a killer
  other than the owner; `--player` a number = slot n−1, a name per game through the runner's players; paths take
  class 2 army only — workers' mining lit every mineral line), `tileCounts`, `heatField` (a quarter-tile grid, i.e.
  512 × 512 for 128 × 128 whatever the picture's size, Gaussian blur σ = `SPREAD` tiles: 1.5 deaths/kills, 1
  buildings/paths; `top` = the 99.5th percentile of warm cells so one hot spot does not darken the rest), `fieldAt`
  (bilinear), `heatColor` (magma's five stops; alpha 0 under `HEAT_FLOOR` 0.03, then 0.35 + 0.65√t, ≤ 0.92),
  `greyGround` (luma × 0.5: a tileset colour must not read as heat), `drawHeat`. The first picture took √t on top of the
  alpha's √ and was a wall of orange; linear t reads. `heatmap.ts`: `heatPicture` (grey terrain at a PNG scale,
  minerals/geysers in `GEYSER_LANDMARK` under the heat, start locations framed in `START_LANDMARK` over it, then
  `resizePicture` for a width), `besideEachOther` (preview | gap | heat), `replayFiles` (folders → their `.rep`, numeric
  sort), the cache, `playForEvents`, `heatmapMap`.
- **The cache**: `cacheRoot()/heatmap/v1/<sha256 of the replay>.json.gz` (`.part` then rename), written only when the
  runner reached the end. Duplicates by hash are skipped ("the same replay as one before it"). Every filter runs from
  the cache, so only new replays are played. Sizes: ~1 MB for a 46-minute game, 57–143 KB for 10–15 minutes; the
  walks are most of it (140,626 sampled positions in 1547.rep).
- **Parallel**: `defaultParallel` = min(4, cpus/2, GB of memory); a runner peaks at ~750 MB resident (`/usr/bin/time`,
  the same for a 10- and a 62-minute game). A line per replay as it is done (`replayLine`: `k/n ✔ file  races · length ·
  n deaths · s` or `cached`); `--json`/`--out -` send them to stderr. Exit 2 when no replay matched or `--player` is in
  none, 1 when the game could not play one (the rest still drawn).
- **Measured** (built CLI, scm-sim `heatmap`'s runner bundled and staged with core.js/game.js/base-s1.bin/interface.bin
  and a `current.json` under `python3 -m http.server`, `SCMJS_PLAY_URL`/`SCMJS_CACHE` at it, the Remastered copy; the
  42 replays in scm-sim's `data/replays*`, maps from `replay map`): Fighting Spirit 1.3 — 16 replays (about 9 hours of games,
  15 the same scenario, 1603.rep matched by name), 26 left out by map; 13,417 deaths; 115 s at 4 at a time, 102 s at 8
  (the 62-minute 1600.rep alone is 44 s); 투혼 1.3 — 5 replays, 2,967 deaths, 41 s. Each replay 2,000–2,400 frames a
  second (legacy_cp949, 10 min, 6.7 s). From the cache: 0.7–1.1 s for any `--what` (16 replays, 946,770 army positions
  for paths). `tests/cli-heatmap.test.ts` (19): matching, filters, tiles, blur, field, ramp, picture over the made-up
  tileset, cache, lines, and the command over a stand-in runner (`.cjs`, `played.txt` proves the second run plays
  nothing), replays written with `@scm-js/replay/write`, a stand-in 1.16.1 copy; scm-sim `tests/exact-replay-events.test.ts`
  (a made-up memory: deaths, waiting, reused slots, buildings, walks; and legacy_cp949 pinned: 89 deaths, 40 buildings).
- **Not built**: an MCP tool; a legend inside the PNG (no font); per-race or per-matchup filters; the `--view` of a
  player's fog; a `doctor` line that knows whether the fetched replay runner has `--events` (doctor cannot tell a
  runner's modes apart, as with rush).

## A replay's game: `map trace|cost --replay`, `map test record`, `map test -u` (`trace.ts`, `maptest.ts`) — 2026-11-07

`scmjs map trace [map] --replay <rep> [--order]`, `map cost [map] --replay <rep>`, `map test record <map> <rep> [--name]
[--tests] [--frames]`, `map test -u|--update`. A fork built both ends (scm-js branch `cli-trace-replay`, scm-sim branch
`trace-replay`, PR on jeany55/scm-sim). The play page must deploy the new map runner before the CLI's PR is useful.

- **The runner is the map runner's `--play <rep>` mode** (scm-sim `src/exact/mapReplay.ts`), not a new bundle or
  `current.json` key, so no `RUNNERS` kind and no `doctor` row: `RUNNER_COMMANDS.map` covers it. The game is started
  as `runReplay.ts` starts one (served engine + the copy, `playableReplay` for a later game's replay), then the map
  runner's taps at the gate of frame 0: `installEud` (strings placed when the scenario has `STRx`), `installCost`, then
  **`installTriggerTrace` called directly** with the TRIG of the chk the game runs (the replay engine has no
  `traceTriggers`), and after every `engine.step` the runner closes the turn itself: `trace.endTurn(frame,
  u16[0x6509A0] === 30, …)` as `live.ts#advance` does. The fold takes an `OnFired(copy, frame)` callback (additive in
  `traceFold.ts`) for `--order [n]` (10,000 kept by default, `orderDropped` counts the rest; rows < 0 skipped).
  **A map given** is put into the replay: `writeLegacyReplay(header, playable.commands, mapBytes(map).chk)` — the
  replay's commands with the map's classic scenario; the game loads the map from the replay, so nothing else changes.
  The cost helpers moved from `runMap.ts` to `mapCost.ts` (re-exported); `mapTest.ts`'s end reading is `readEnd(game,
  counts, me)`, shared. Protocol (additive): `start` {mode: "replay", map, replay {name, frames, gameType, players
  [{slot, name, race, type}]}, replaced, copy, seed (the replay's), rows, copies, remastered, localPlayer, ms},
  `progress` as before, `end` {mode, frame, ended (the replay ran out or a side won), reason, by "victory"|"replay"|null,
  passes, trace, cost, order [[frame, player, row]]|null, orderDropped, check {named, gone, ahead, parted}, outcomes (per
  replay player), observed|null, ms}. With `--test` as well: `start`/`end` say `mode: "test"`, `driver: "replay"`; a
  spec with steps is refused. **An older runner** wants a map (`--map is needed`) or runs the map with nobody playing
  (start without `mode`); the CLI kills it and says "from before map trace --replay" / "before tests driven by a replay".
- **The CLI**: `gameRun` in main.ts (shared by trace and cost) — no `--replay`: as before; with it: `replayRun(rep,
  map|null)` → the scenario the report is worded against (the given map's **archive chk as stored**, i.e. a built
  map's built scenario, since that is what the game runs; else the replay's), `differs` = `diffMaps` of the two bare
  chks with `members` dropped (a replay holds none) → `summarizeDiff`, now in `diff.ts` (re-exported by run.ts), and a
  VER 59 map (given or the replay's) as `gameMap`'s converted temp copy. `--frames`/`--every` left at their defaults
  (`getOptionValueSource`) mean the replay's end and a progress line a minute of play (1,440). Report in replay mode:
  rows only for triggers a player in the game owns (1631.rep's map has 1,713 rows, 5 owned), First/Last as
  `gameClock` (42 ms a frame, as `replay info`/`watch`; the scripted mode keeps frames), the winner's names, a ▲ line
  when `check.parted`, an ℹ line when the game type is not Use Map Settings (melee runs the game's own triggers:
  the trace has only row −1 copies), then `orderLines` (cut at 200 unless `--all`). `traceReport().replay` carries it
  all for `--json`, plus `replayFile`, `map`, `differs`.
- **Tests from replays**: a scenario `{ "replay": "x.rep" }` (from the tests file's folder; `replayOf` checks it exists
  at plan time) refuses `setup`/`steps`, runs to `REPLAY_END` (0x7fffffff; the replay's end comes first) unless
  `frames`, and is run as `[map, --test, spec, --play, rep]` (no `--seed`, no replay kept). `judge` now returns
  `value` (what the file would write) and words frames with the clock for replay scenarios; **text is decoded** with
  the map's encoding (`shownText`: the runner hands bytes as char codes; new core export `decodeText`) — before, a
  Korean map's text could never match. `ScenarioResult` gained `index`, `playing`, `parted`, `updated`.
  **`-u`** only touches replay-driven scenarios and only the entries that failed: `VALUE_KEY` per kind (`fired`, `is`,
  `minerals`, `gas`, `shown`, `outcome`, `ended`) gets the game's value; a loosened comparison that still holds stays,
  deleted entries stay deleted (decided: Jest-like snapshots that respect trimming; re-record to regenerate the whole
  list). The scenario then counts as passed and the file is rewritten with `formatTests` (one plain object a line, so
  trimming is deleting lines; hand formatting of the file is not kept). **`record`** plans the scenario with
  placeholder units entries (Men and Buildings per playing player, so the runner counts them), runs it through
  `runTests` (`quiet`, `onEnd` hands back the raw end), builds `snapshotExpect` (triggers owned by a player in the game
  with counts incl. 0, by unique comment else number; switches set + named ones clear; non-chat lines (`/^[^\x02:]{1,40}:\x02/`
  is chat), 20 at most; outcomes; ended; the unit counts in the order asked; minerals/gas; every death count), then
  judges it against the same end and drops any entry that would not hold, and writes it (same name → replaced).
- **Measured** (Remastered copy, a local stage — the four engine files + bundled `run.mjs`/`map.mjs`, gzip, a
  `current.json` — served by `python3 -m http.server`, `SCMJS_PLAY_URL`/`SCMJS_CACHE` at it; `deploy-play.mjs` itself was
  refused by the session's permission classifier as a deploy, even without `--upload`): 1631.rep (UMS 2v2 on 투혼 1.3,
  14,662 frames) traces in 6.2 s end to end, 4.1 s of game ≈ 3,600 frames/s: 9 firings (each player's start triggers at
  frame 2, the victory trigger #1712 for P4 at 14,603 = 10:13), never parted. 1544.rep (UMS 1v1, 70,255 frames) 37 s
  game, 1603.rep (48,765) 26 s — ~1,500–1,900 frames/s with the machine's load average at 10; with both taps off the
  same runs were no faster (noise dominates; the trace is not the cost). The map extracted by `replay map` played
  back in place of the replay's: no `differs`, identical firings. The same map with its 108 mineral fields removed
  (`map run` with a script): "differs (108 units removed)" up front, parted at frame 6. `map test record` on 1631: 40
  expectations in 6.5 s; `map test` passes (40/40); on the mineral-less map 21/40 hold, `-u` rewrote the 19 others
  (units, resources, deaths) and the next run passed. In a replay the game's local player word (0x512684) reads 0,
  so the lines kept are what slot 1's eyes see: on 1631 only chat and "… has left the game", not the start trigger's
  text for P3–P6 — the memory is not poked to change that (it would change the game).
- `tests/cli-trace.test.ts` (+4): the replay run over the stand-in (`FAKE_RUNNER` now takes `--play`/`--order`;
  `OLD_RUNNER` is it from before), the clock and order lines, a map given + parted, melee, cost, the older runner,
  `replayRun`'s comparison and the 1.00 conversion. `tests/cli-map-test.test.ts` (+5): planning, the run with
  `-u` + `updateTests`, `snapshotExpect` round-trip, `recordTest` new + replaced, `formatTests`. scm-sim:
  `tests/exact-map-replay.test.ts` and `exact-map-replay-map.test.ts` (one game a file; skip without engine, copy or
  data/replays-psistorm/1631.rep).
- **Not built**: an MCP tool for `--replay` / `record`; `--order` for `map cost`; a replay from standard input
  (refused: the runner reads a file); `record` of a melee replay was not tried (its game runs the game's own triggers,
  so its snapshot would hold no trigger counts). The scenario-name dispatch: `map test record` is a commander
  subcommand of `map test`, so a map file literally named `record` would be taken for it.

## A map's history: `map log`, `map blame` (`cli/src/history.ts`, `maplog.ts`, `blame.ts`) — 2026-11-07

`scmjs map log <map> [--rev X|A..B] [-n N] [--json]` and `scmjs map blame <map> [--triggers|--locations|--strings|
--units|--settings] [--trigger N|--location NAME|--string N] [--rev X|A..B] [--json]`. Verbs under `map`, so no
overview row. Docs: `docs/cli.md` "A map's history", "Who last changed what".

- **The git layer** (`history.ts`): `locate(file)` = `git -C <file's dir> rev-parse --show-toplevel --show-prefix`
  → `{root, path: prefix + basename}`; **`--show-prefix` rather than `relative(root, resolve(file))`**, so a folder
  reached through a symbolic link still gives git's path (`revisionInput` now uses it too; its messages kept).
  `commitsTouching` = `git log --parents --format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s [--topo-order] [-n] <rev> --
  <path>`: **`--parents` turns on parent rewriting, so `%P` names the nearest ancestors that touched the file**
  (checked in a throwaway repo: without it `%P` is the real parents), and with a range the parents outside it are
  still printed — that is how blame finds the range's edge. A revision starting with `-` is refused (it would be an
  option of git's). `blobIds` = one `git cat-file --batch-check` for every `<commit>:<path>` (missing → null).
  `Versions` reads blobs through `git cat-file --batch`, **24 at a time in the order they will be wanted** (`expect`),
  and parses each once (`loadMapInput`), keeping `keep` parsed maps (log 3, blame 1 — blame keeps snapshots instead).
  spawnSync's `input` is a Buffer: `encoding: "buffer"` with a string input throws ERR_UNKNOWN_ENCODING (first run).
- **`map log`** (`mapLog`): the commits `git log <rev> -- <path>` lists (no `--topo-order`; `-n` asks git for N+1
  to know there are more), each compared with its **rewritten first parent**'s version (same bytes as the real first
  parent's for this path). No version → "map added: 64 × 64 Badlands, 21 units, …" (`describeMap`); none now → "map
  removed"; same blob → "no change to the map"; a version that does not parse → `unreadable`, the rest go on.
  `describeChange` runs `diffMaps` and words it: header fields (name/description changed, `resized a → b`, tileset,
  version, encoding), players + forces (one → `Player 2 race Zerg → Protoss`, more → "N player settings changed"),
  units by `unitCounts` (multiset by `unitKey`, then pairs: same record but x/y = **moved**, same kind + owner =
  **changed**), locations/strings by the diff's change kinds, triggers and briefing by **`listCounts`**: multiset
  added/removed (as map diff), then an added and a removed in the same LCS gap (`lcsMatch` from merge.ts) are one
  **changed**; nothing added/removed but another order = "triggers reordered". **Strings that are names** (SPRP
  name/description, every MRGN `nameIndex`, FORC names, either version) are not counted as strings — "description
  changed · 1 string changed" said one thing twice (first run). Then each changed section no phrase spoke for
  (`said`) in words (`SECTION_WORDS`: terrain, doodads, unit settings, …; else "XXXX section changed"); **section
  names are padded to four (`"STR "`) — trim before looking up** (first run printed "STR  section changed"). Nothing
  at all → "saved again; the map is the same".
- **`map blame`** (`blameMap`): items per kind (`Item {id, content, label, text}`; same thing in two versions ⇔
  id and content equal): triggers id = content = `fingerprintTrigger` (multiset, so a reorder is no change — the
  task's rule, map diff's matching); locations id = slot, content = name + rect + flags (`locationText`'s
  fields); strings id = number, non-empty only (map diff's null = "" rule); units one item per `unitId:owner`,
  content = sha1 of the sorted `unitKey`s; settings by label: header fields, a row per player and force, section
  groups by bytes (`sectionBytes`: Terrain = MTXM+TILE+ISOM, Doodads, Sprites, Fog, UNIS/UNIx, UPGS/UPGx, TECS/TECx,
  PUNI, UPGR/PUPx, PTEC/PTEx, SWNM, WAV) and each archive member by sha1. **The walk is git blame's**: items of the
  top version pending at the first node; nodes in `--topo-order` (children first); at a node, for each rewritten
  parent in order, `matchItems` (first-come, one parent item per child item) hands matched items to the parent;
  what no parent takes is this commit's. So a change made on a branch and merged lands on the branch's commit
  (tested). Same blob on an edge → everything passes, nothing parsed. **Stops as soon as nothing is pending**, so
  only as much history is read as the answer needs (`walked` in the JSON). With `A..B`, items pending at a parent
  outside the list settle on that commit with `boundary` (printed `^` + 7 hex, as git); its author/date from one
  `git show -s`. **Uncommitted**: without `--rev` and with the file on disk, the disk bytes are the top; if they differ
  from `HEAD:<path>` a node `0000…` with parent = the first listed commit comes first, and what it keeps is "Not
  committed yet" (date = the file's mtime). With `--rev X` the file on disk is not read.
  Trigger summaries (`summarizeTrigger`) are made only for the top version (`shown`): the rest need the fingerprint.
- **Output**: git blame's shape, `hash8 (author date label) text` — author column one width for all kinds shown
  (max 24, by terminal columns), labels padded per kind (numbers right-aligned), the text cut to the terminal width
  (120 when piped). Default view = triggers, or settings when the map has none (both computed, one dropped).
  `--trigger N` (1-based, the list's order), `--location` (name, any case, or `#n`), `--string N` → one item: the
  commit's hash, author, date and subject, then the trigger's whole text (`triggersToText`) or the item's text.
- **Measured** (WSL2, built bundle, `/usr/bin/time`): the docs' demo (ums.scx, 8 commits) `map log` 0.5 s. A 201-commit
  history of `(8)StarCraft Fortress.scm` (399 KB, 87 triggers, a string edit per commit, made in the scratchpad):
  `map log` 3.5 s (~17 ms a commit: two parses, one cached, plus `diffMaps`' two serialisations), `-n 10` 0.34 s,
  `map blame` 2.4 s (walks all 201: the oldest triggers are unchanged since the first commit, so every version must
  be read, as git blame must), all five kinds 2.5 s, `--rev HEAD~20..HEAD` 0.43 s; `map info` alone 0.17 s. Peak RSS
  ~400 MB on the full log (V8 not collecting between parses; the batch itself is ~10 MB).
- **Tests** (`tests/cli-map-log.test.ts`, 12): `counted`, `listCounts`, `unitCounts`, `matchItems`, `splitRange`;
  a temp repository (skipped without git) from ums.scx via `setHeader`, `importTriggers`, `resizeMap`, `importStrings`,
  a commit touching another file only, a reorder, a branch + **a merge made by hand** (git cannot merge the binary
  without the driver: `checkout --ours`, apply the side's change, commit) — log words, `-n`, ranges, blame per kind,
  the merge followed to the branch, uncommitted, the range edge, the early stop, and the errors (not a repository,
  not committed, no such file, bad revision, `--all` as a revision).
- **Not done**: renames are not followed (`--follow` linearises and hides merges; the history starts at the name the
  file has, documented); briefing triggers have no blame kind; no MCP tool; trigger text edits blame the string, not
  the trigger (map diff's matching — documented); `map log` has no per-commit `--stat` of the full diff (`git show`
  with textconv does that); `map log --rev A...B` passes through to git, `map blame` refuses `...`.
- **CLI strings** were literals at the time (the extractor read `src/` only); since the Korean slice (2026-11-08)
  every printed word goes through `cli/src/i18n.ts`'s `t()` — see "The command line in Korean" at the end.

## A map as a folder of text: `map unpack --text` / `pack` (`cli/src/source.ts`, `archive.ts`) — 2026-11-07

The user's slice: a map lives in git as a **folder of text** and is rebuilt into the identical scenario, so merges are
line merges and a PR reads the real change. Branch `cli-map-source`. `map dump` (one-way, textconv) is unchanged.

- **Flag `--text`, not `--source`**: "source" already means the TrigScript source a built map carries (`map build`,
  `restoreBuiltMap`, `scmjs\source.chk`), and an unpacked built map has *both*; `--text` says what it writes.
  `archive.json` goes to **version 2** with `scenario.text: "scenario"` (the folder); pack reads 1 and 2 (a 3 says "a
  newer scmjs wrote it"), and with no manifest takes `scenario/sections.json` without `staredit/scenario.chk` as the
  text form. Plain unpack is still version 1, byte for byte as before. An archive member under `scenario\` refuses
  `--text`. Unpacking one form over the other removes the other (`staredit/scenario.chk`, or `scenario/` when it has
  `sections.json`), since pack would otherwise take it for a member; `scenario/` is replaced whole each time.
- **Layout** (`FORMS`, also the read order): `map.json` (TYPE VER DIM ERA SPRP OWNR IOWN SIDE COLR CRGB FORC WAV SWNM
  + the string table's `slots`/`encoding`; players/races/colours/colour modes/force flags **by name** from the codecs'
  const tables, a number when unknown; force 1-based; `tileset` by TILESETS id when era < 8 else `era`; WAV/SWNM as
  lists trimmed of trailing zeros), `strings.txt` (= `formatStringTable`, so `map strings import` takes it), terrain
  grids `terrain.txt` (MTXM) / `isom.txt` / `mask.txt` (hex, a row per line, one `#` comment line), `under-doodads.txt`
  (TILE as `x y tile` where it differs from MTXM — so a tile edit is one file and TILE follows MTXM as the brush does),
  `units.tsv` / `sprites.tsv` / `doodads.tsv` (record fields in file order, flags `0x` hex, a trailing informational
  `name` column never read back), `locations.tsv` (rows for slots that are not all zero, 1-based `location`), `cuwp.tsv`
  (UPRP fields + UPUS `used`), `settings/{units,weapons,availability,upgrades,upgrade-levels,techs,tech-availability}.tsv`
  (one generic struct-of-arrays table: a row per id, per-player columns as 12 comma-separated values, `name` column),
  `triggers.txt` / `briefing.txt` (= `triggersToText`), `sections.json` (every section in file order: `text`, or
  `bytes`, `size` when the header's length is not the data's, `trailing`), `sections/NAME.bin` (trailing spaces
  trimmed, anything outside `[A-Za-z0-9_-]` as `%XX`, case clashes `.2`). A form writes only the keys/columns of its
  sections that are text.
- **The check is the packer** (`scenarioToText`): candidates = modelled, one copy, not cut off, and for STR/STRx the
  one `parseScenario` reads. The files are rendered in memory and run through **`assemble`, the same function pack
  runs**; each text section's encoding is compared with the file's bytes. Equal → text alone. Not equal but equal to
  `encodeSection(model, name)` (**the model is the same, the bytes are not**) → **layout**: the original bytes kept
  under `sections/` with `sha1` = the text's encoding; pack writes them while the text still encodes to that hash,
  else the encoding (= what the editor's Save writes after an edit). Otherwise the text lost something → for TRIG/MBRF
  another round with **records kept** (below), else the section goes to bytes and the round repeats. A form that
  throws demotes its sections. Last, the whole folder is assembled and must equal the CHK **byte for byte**, else a
  CliError (never seen). So an untouched folder packs to the identical scenario, and idempotence follows.
- **`assemble`**: kept sections first (`parseScenario` of them alone), the forms read over that model, every text
  section encoded with **`encodeSection`** (now exported from scenario.ts and core — a save's bytes for one section);
  then a second pass parses the assembled CHK and reads the text again, so a kept section is decoded against the
  text's size and revision; stops when two passes agree (≤ 3). Assembled with `serializeChk` directly, **not**
  `serializeScenario`: its VCOD replacement and MRGN re-dirtying would change kept bytes. With the string table kept as
  bytes, text that adds a string (a trigger naming new text) is refused — it would point past the table.
- **Why STR is "layout" on every Blizzard map** (probed: dirty-one-section re-encode over all 21 maps): StarEdit's
  unused slots point at one shared 0 byte and decode as `""`, which `encodeStrings` gives its own blob, and its order
  differs; the generated maps re-encode exactly. Ashworld Hunters (hybrid) has UPGR/PTEC "layout": `readPair` takes the
  `x` restrictions whole, so the original tables cannot be re-encoded from the model.
- **Why TRIG/MBRF keep records**: the text form normalises — `unitFlags` sets 0x10 "unit type used" on any condition or
  action with a unit argument (StarEdit leaves it clear: 12 of the 16 Blizzard maps), a string is named by its text so a
  duplicated text resolves to the lowest index (Ground Zero), an action's unused text index is dropped (Defenders'
  briefing). With records kept (`bytes` without `sha1`, `Form.keepsRecords`), the trigger form parses the text, then
  replaces each parsed trigger whose `formatTrigger` text (with the current names) equals a kept record's by that
  record (multiset, in order). Unchanged triggers stay byte for byte; an edited or new one is the parsed record, as
  `map triggers import` gives. Measured: an edit to one trigger of Zoo Keeper changes that trigger only in `map diff`.
  A changed message is a **new string** (intern), the old one stays until `strings prune` — triggers.txt decides a
  trigger's text; editing strings.txt alone does not move a trigger (its text then no longer matches → re-parsed
  with the old text → interned back). Documented.
- **Results** (all 21 maps: 5 committed + 16 fixtures, every one byte for byte, `diffMaps` same, text identical on a
  second unpack): every modelled section is text on every map; kept as bytes alone only IVE2/IVER/VCOD (unmodelled);
  layout STR on all 16 Blizzard maps (+ UPGR, PTEC on Ashworld); records TRIG on 11, MBRF on 9. Sizes (KB): generated
  64×64 maps ~124 text vs 3–6 scx (isom 42, terrain 20, PUNI table 16); Blizzard maps 137–680 text (deflated 24–72)
  vs 35–559 scx; ISOM is usually the biggest file (325 KB on Spring Thaw, the largest map here), then terrain and mask; triggers lead on Defenders.
  Kept bytes 3–10 KB on melee maps, up to 340 KB on Wakka Wakka (140 StarEdit TRIG records, **4.7 KB deflated**, git
  stores it compressed). unpack --text 25–190 ms a map in vitest.
- **The language server** reads a text folder: `isUnpackedMap` also accepts `scenario/sections.json`, `readMap` builds
  the scenario with `scenarioFromText`, the stamp is the newest mtime under `scenario/`. The in-process LSP conversation
  test now runs on a text-unpacked map (the built-command run keeps the binary one), so both are covered.
- **Core exports added**: `encodeSection`, `defaultUnitSettings` and its five kin (a text table for a section the base
  model lacks), `locationSlots`, `WEAPON_NAMES`/`weaponName`. docs/core.md's table names them.
- **Tests** (`tests/cli-source.test.ts`, 33 with fixtures, 17 without): every committed map and (skipIf) every fixture
  through `checkMap` (CHK bytes equal, sections parse equal, kept `.bin` = section bytes, extras, `diffMaps` same, no
  modelled section kept as bytes alone, second unpack identical); manifest v2 / no manifest / switching forms / member
  in `scenario\` / built-shaped map / `stableJson`; a synthetic CHK with a 1-byte STR decoy, an odd section name,
  trailing bytes, and a cut-off last section; edits (unit move = UNIT only, re-unpack gives the edited text; tile =
  MTXM+TILE; string; player; location; unit setting; trigger), error messages with file and line, the STR layout kept
  then dropped on an edit. ~1.5 s without fixtures, ~14 s with.
- **Not done / leftovers**: `pack` does not run a TrigScript build (two commands: `map pack` then `map build`; a
  `--build` flag reusing `buildMap` is cheap but needs TypeScript and the vendored compiler at pack time — left for the
  user to ask); no MCP tool (`map_unpack`/`map_pack` with `text`); a `--plain`/normalise option that drops the kept
  STR/TRIG bytes and accepts the editor's layout and the text form's flags (smaller folders for StarEdit maps; the
  first pack would change those sections); `map diff` between two folders (today: pack both); `init` does not offer the
  folder workflow (docs mention it as the alternative); resizing by editing the text is refused by the grids' shape
  checks (use `map resize`); ISOM as hex words is mergeable but not readable — a diamond-per-cell form would be.
## Without Node: single executables (`cli/src/runtime.ts`, `sea.ts`, `scripts/build-cli-binary.mjs`) — 2026-11-07

The user's ask: "most Windows map makers do not have Node installed" — one executable per platform on the
GitHub release, with install recipes. PR on branch `cli-binary`.

**The spike** (Linux x64 under WSL2, Node v24.13.0, Bun 1.4.4; wall time per run over 10 runs, `tests/maps/melee.scx`):

| Option | Worked | Size (Linux; packed) | `--version` | `info melee.scx` |
| --- | --- | --- | --- | --- |
| npm bundle on Node (baseline) | — | 5.5 MB | 148 ms | 182 ms |
| **Node SEA, V8 code cache** | every check below, Windows exe too | 122.9 MB; tar.gz 42.0 MB (Windows exe 91.2 MB, zip 34.2 MB) | **74 ms** | **102 ms** |
| Node SEA, no code cache | the same | 120.9 MB | 136 ms | 169 ms |
| `bun build --compile` | map info/check/dump, `map run` plugin, runners (trace, cost) under Bun | 114 MB; gz 53 MB (Windows 120.6 MB) | 131 ms | 150 ms |
| `bun build --compile --bytecode` | (not re-run beyond startup) | 126.6 MB | 29 ms | 43 ms |
| Deno compile | not tried: 1 and 2 both worked | | | |

`about` is 503 ms (npm) vs 455 ms (SEA): the npm registry call dominates. **Chose Node SEA**: the runners are the
lifted game, and under Bun they would run on JavaScriptCore rather than the V8 the play page, the tests and every
replay check run on (Math functions and number formatting are implementation-defined, so a replay's exactness is
not a given across engines); every Node API the command uses is Node's own. Bun's two advantages — 45 ms faster
start with bytecode, and cross-compiling all four from one machine — did not outweigh a second runtime under the
game. SEA's own cost: three runners in CI, ~120 MB a file (the Node executable).

**How it is built** (`npm run build:cli-binary`, `node scripts/build-cli-binary.mjs [--target linux-x64,darwin-arm64,darwin-x64,win-x64] [--archive] [--check] [--download] [--no-code-cache]`):
1. `bundleCli({ install: "binary" })` → `cli/dist/bin/.work/scmjs.cjs`: **CommonJS** (SEA runs only CJS), entry
   `cli/src/sea.ts`, `__SCMJS_INSTALL__ = "binary"`; `weigh.mjs` built as for npm.
2. Per target, the Node executable: this computer's own (`process.execPath`) for the host target, else the
   official one of **the same version** from nodejs.org, checked against `SHASUMS256.txt` and cached in
   `~/.cache/scmjs-build/node/<version>/<target>/` (`SCMJS_BUILD_CACHE`).
3. The blob (`--experimental-sea-config`): `assets: { "weigh.mjs" }`, `disableExperimentalSEAWarning`, and
   `useCodeCache: true` **only when made by the target's own Node** (code cache is V8- and flag-specific), i.e.
   the host, or darwin-x64 on Apple silicon through Rosetta; otherwise a portable blob any Node of that version
   reads (a Windows exe built from Linux was run through WSL interop: map info/about/trace/cost all fine).
4. `npx --yes postject@1.0.0-alpha.6 … NODE_SEA_BLOB … --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`
   (`--macho-segment-name NODE_SEA` on macOS) — npx, not a devDependency: postject is in the lock only as an
   optional transitive of electron-builder, and making it direct meant hand-editing the lock. macOS: `codesign
   --remove-signature` before and `codesign --sign -` (ad hoc) after, so **a Mac target needs a Mac**.
5. `--version` of the result must say the package version (when it runs here); `--archive` packs
   `scmjs[.exe]` + `LICENSE` + `THIRD-PARTY-NOTICES.txt` (the bundle's notices **plus Node's own LICENSE**, fetched
   from `raw.githubusercontent.com/nodejs/node/<version>/LICENSE` — V8, ICU, OpenSSL… ship inside) into
   `scmjs-<windows|macos|linux>-<arch>.{zip|tar.gz}` (the desktop's naming) and writes a local `SHA256SUMS`. The
   zip is written by hand (`zlib.crc32` + `deflateRawSync`, no fflate import — it is only transitive via mopaq).
   Archives rather than bare executables: the exec bit survives a browser download and they are a third the size.
6. `--check` runs `scripts/check-cli-binary.mjs <exe>` — the hand/CI check: **no `node` or `npm` on PATH** (every
   PATH folder holding one dropped), a temp folder, and: --version, the overview, `about`/`doctor --json` say
   `install.kind: "binary"`, map info (file and stdin), check over tests/maps, new, dump, find, set+diff,
   unpack+pack round trip, triggers export, preview refusing a non-game folder, `map run` with a .js plugin,
   **`map build` with TypeScript from a project's node_modules** (a link to the clone's), `map build` without
   TypeScript failing with the install line, a script run as Node with a file Worker (as runners do), `mcp`
   initialize + tools/list; `--replay <file>` adds replay info/map, `--game` adds `map trace`/`map cost` in the
   game. All pass on Linux (2026-11-07), including `--game` with the cached engine 1248410ad2a0 and Remastered.

**What differs at run time** (all in `runtime.ts`):
- **`import()` from disk works in SEA on Node 24** (TypeScript, `map run`'s plugin modules, runners) — checked
  directly; the build refuses Node < 24 rather than finding out what 22 does. `vm`'s
  `USE_MAIN_CONTEXT_DEFAULT_LOADER` also worked but is not needed.
- **Runners**: `startRunner` spawns `process.execPath`, which in SEA is scmjs itself. `runnerEnv` adds
  `SCMJS_RUN_AS_NODE=1` (only when the "node" is `process.execPath` and this is the binary; `--node` elsewhere is
  left alone); `sea.ts` sees it and calls `runAsNode`, which **rewrites argv**: SEA's is `[exe, exe-as-typed,
  script, …]`, Node's `[node, script, …]`, and the runners decide they are the main module by
  `import.meta.url === pathToFileURL(process.argv[1])`, so `scriptArgv` drops index 1 and resolves the script. The
  CLI is a lazy `import("./main")` in `sea.ts`, so a runner's process never builds the command tree. The variable is
  inherited by the runner's children (as `ELECTRON_RUN_AS_NODE` is); runners spawn none today.
- **`weigh.mjs`** (map cost hands its path to the map runner): `assetFile` writes the SEA asset to
  `cacheRoot()/weigh/<version>-weigh.mjs` (compared each run, written via a `.part` rename) — `process.getBuiltinModule("node:sea")`, no static import of `node:sea`.
- **TypeScript**: `findTypeScript` skips "beside the command" in the binary; the project (cwd) and `npm root -g`
  remain (no npm → caught → "TrigScript compiles with TypeScript…"). doctor's TypeScript note adds that npm comes
  with Node.
- **`about`**: `install: { kind, manager, path, update }` in the JSON, an `Installed` row (`npm package` /
  `single executable[, from Scoop|winget|Homebrew]` + path), Node marked `(inside scmjs)`, and **Newest** offers
  `updateCommand(install)`: npm's line, `scoop update scmjs`, `winget upgrade scm-js.scmjs`, `brew upgrade scmjs`,
  or `download it again from https://github.com/scm-js/scm-js/releases/latest`. The manager is read off the
  executable's path (`managerOf`: `/scoop/apps|shims/`, `/microsoft/winget/`, `/cellar/|/homebrew/|/linuxbrew/`).
  "Newest" still asks npm: both kinds are released together with one version.
- **`doctor`**: the scmjs check's detail gains ` · single executable[, from …]` (so the title line says it; npm
  says nothing more, keeping the docs' sample), its fix is `updateCommand`; `nodeCheck(_, "binary")` is never bad;
  `doctorReport`/`doctorJson` carry `install`; Claude Code's fix is `mcpAddLine` (`claude mcp add scmjs -- scmjs
  mcp` from a package manager, else the executable's own path, quoted when it has spaces; Scoop's/Homebrew's
  versioned folders would break a path on update). `versionCheck(latest?, install?)` takes both for tests;
  "is on npm" became "is out".
- **No top-level await anywhere in `cli/src`** (CJS): `main.ts`'s run is `void run()` now;
  `tests/cli-binary.test.ts` walks every module with TypeScript's parser for an `await` outside a function.

**CI** (`build.yml` `cli-binary`, see `desktop-releases.md`): three runners, `--archive --check`, artifacts
`cli-binary-<os>`; on PRs as a dry run; `release` attaches them and writes `SHA256SUMS` over all assets.
**Recipes** (`packaging/`, `packaging/README.md`): Scoop manifest (autoupdate, hash from `$baseurl/SHA256SUMS`
by `$sha256\s+\*?$basename`), winget 1.9.0 manifests (zip + nested portable, alias `scmjs`; `winget validate`
passed on Windows 11 through WSL), Homebrew formula (on_macos arm/intel, on_linux intel, `bin.install`, test
`--version`, livecheck github_latest); `@VERSION@`-style placeholders filled by `scripts/release-recipes.mjs`
(`scripts/lib/recipes.mjs`, `tests/release-recipes.test.ts`) into ignored `packaging/out/v<version>/`.

**Traps**
- postject on Linux prints `warning: Can't find string offset for section name '.note.100'` many times; harmless,
  hidden unless postject fails.
- A distribution's own Node may lack the SEA fuse (postject then cannot find the sentinel): `--download` uses the
  official build for the host too. `/usr/bin/node` on this machine (NodeSource) has it.
- `cli/dist/bin/` sits inside the npm package's `dist/`; `npm pack`'s prepack empties `cli/dist` first, and the CI
  `cli` job never builds executables, so none can be published to npm. Never commit `cli/dist`.
- The npm bundle's behaviour is unchanged (`__SCMJS_INSTALL__` is "npm", folded to constants); diffed after the
  refactor, the only changes were the new code.

**Leftovers**: signing (Authenticode, Developer ID + notarization) — the hook is after the injection; Linux arm64
and Windows arm64 executables (SEA needs a runner of each; GitHub has `ubuntu-24.04-arm` and `windows-11-arm`);
`useSnapshot` (startup) not tried; winget updates by hand (`wingetcreate update … --submit`; automating it needs a
token secret in scm-js). **Published (2026-11-08):** `scm-js/scoop-bucket` and `scm-js/homebrew-tap` exist and follow
each release by themselves (bucket `excavator.yml`, tap `update.yml`, every 4 h); winget's first version is
microsoft/winget-pkgs#475062. Both repos' main needs PRs, so their workflows push over SSH with a per-repo deploy
key (`CI_BUILD_KEY`), the workflow token read-only. Trap: ScoopInstaller/GithubActions' Excavator sets the push URL to
HTTPS with the workflow token (`src/Helpers.psm1`), so it cannot push past the PR rule — the bucket runs Scoop's
`checkver -Update` in its own steps instead. `packaging/README.md` "Each release" has it all.
## Many games and old maps: `map coverage`, `map check --baseline` (`coverage.ts`, `baseline.ts`) — 2026-11-07

`scmjs map coverage <map> [replays…] [--tests] [--strict] [--format text|json|github|junit|sarif] [--all] [--force]
[--parallel n] [--starcraft]` and `scmjs map check … --baseline [file] | --write-baseline [file]`. One PR (branch
`cli-coverage-baseline`); no scm-sim change — the map runner's `--play` + `--order` already said everything needed.
Docs: `docs/cli.md` "A baseline for old maps" (under Checking a map) and "Which triggers fired across many games"
(Running a map in the game, after "A test from a replay"), reference rows, cheat sheet, AI tools row, exit codes.

- **Coverage = `map trace --replay` per replay, added up.** `runCoverage`: `replayFiles(paths, deep = true)` (new
  `deep` parameter on heatmap's walker; heatmap itself still takes a folder's own files only), dedupe by sha256,
  `matchReplay` against `mapIdentity` (same scenario, else same name + size; `--force` takes the rest) — heatmap's rule,
  so a newer version of a map still takes the old replays — then **non-UMS replays are left out before anything runs**
  (`header.gameType !== 10`: in melee the game runs its own triggers; the trace would hold only row −1 copies, and
  39 of the 42 psistorm replays are melee/1v1/TvB). Each taken replay → `gameMap` (a 1.00 map converted per run, since
  `runMapInGame` deletes its temp copy) → `runMapInGame(map, "trace", { replay, order: true, every: 0, ready })`.
  **`MapRunOptions.ready`** (new, additive): an `Engine` found once, so N games ask the page's `current.json` once and
  parallel workers never race the first fetch into the cache. Workers as heatmap's (`defaultParallel`: half the CPUs,
  ≤ 4, a game per GB). A CliError matching /from before/ (older runner) aborts the whole run; any other error is that
  replay's: listed under left out, `exitCode = 1` (heatmap's convention); none played at all → CliError.
- **Rows owned vs not**: `gameRows` folds a game's `CopyLine`s per map row; `addGames` sums games-fired-in, firings,
  first firing + `firstIn`, latest `lastFail` + its game. The table, the counts and `--strict` cover only rows a player
  in at least one game had a copy of (`players.length`), as `map trace --replay` lists only owned rows — a 1,713-row
  EUD map (투혼) has 5 owned; "N more owned by no player in these games" is said, `--all` lists them, the JSON has
  `owned: false`. Decided: a trigger for P8 cannot be expected to fire when no game had a P8, so it does not fail
  `--strict`.
- **A parted game counts up to the parting.** Always asking `--order` (≤ 10,000 kept by the runner) lets
  `gameRows(lines, rows, parted, order)` count firings with `frame < parted` and the first one; past what the order
  kept, a copy whose `firstFired < parted` counts once. `lastFail` after the parting is not used for "why". Test
  scenarios driven by a replay have no order: the `firstFired` rule only. Games that parted get ▲ in their line and a
  summary line; github/sarif carry a notice/note per parted game, junit a `<system-out>`.
- **`--tests`** = `<map>.tests.json` beside the map; any `.json` among the sources is a tests file too. `readTests` +
  `runTests({ quiet, out: <temp>, onEnd })`: `onEnd` hands the raw end, folded with `shift = p.before.length` (the
  setup's triggers come first); pass/fail is ignored (map test's job); the failed scenarios' replays go to a temp
  folder that is removed. Tests run after the replays, one at a time (runTests is sequential), and runTests asks
  `ensureEngine` again itself (one more `current.json` fetch; not threaded through to keep maptest.ts untouched).
- **Output**: a skipped line per reason (heatmap's `skippedLines`), the header, a line per game as it ends (`k/K ✔|▲|✖
  name  m:ss · n players · n triggers fired [· parted at m:ss, counted to there] · s`), then the summary `✔|▲|✖ map:
  F of N triggers fired in K games; L never fired · X more owned by no player…`, the table (#, Games k/K, Fired, First
  as the game clock, Players from the copies, the trigger window line via trace's `rowText`), cut at 40, then "Never
  fired" with `neverWhy` (the condition, the game, the clock). Test games are named `test "<name>"` (`gameName`). In
  machine formats the live lines go to stderr. `coverageJson` adds per row `number`, `owned`, `firstClock`, `owners`
  (summarizeTrigger's players), plain `text`, `why`. CI forms in report.ts (`CoverageForm`): github warning per
  never-fired (error with `--strict`), junit a case per owned trigger (never fired = `<skipped>`, `<failure>` with
  strict), SARIF rules `scmjs/coverage-never-fired` and `scmjs/coverage-parted`.
- **Measured** (Remastered copy, the engine of scmjs.dev/play build 1248410ad2a0 from the cache, 24 cores): 투혼 map
  from 1631.rep over the 39 psistorm replays: 38 left out (36 other maps, 3 1v1 on 투혼), 1631 played in 7.3 s, 8.6 s
  wall; the result matches `map trace --replay 1631.rep` (4 of 5 fired, #1711 never). Fighting Spirit map from 1603.rep
  with `--force`: 6 UMS replays, 4 at a time, 31 s wall (1603: 34 min of play in 30.5 s); the five from other maps
  parted at 0:00–1:46 and were counted only to there. ums.scx `--tests`: three scenarios in 7.4 s, #2 never fired.
- **`map check --baseline`** (`baseline.ts`): the file is `{ about, version: 1, maps: { "<path from the file's folder,
  />": [{ level, where, text, id? }] } }`, maps sorted, entries sorted by where then identity (diffs well), `id` only
  when it differs from `text`. Default `.scmjs-baseline.json` in the cwd. **Identity** (`findingId`, matched with
  `where` as a multiset — each known entry answers for one finding): `Issue` carries only `{level, text, where,
  target?}`, no rule code, and the target index shifts, so the text is the key with the moving parts taken out:
  every `Trigger N` / `Briefing N` in the text (whether or not `target` is the trigger — the CUWP "uses slot" notes
  point at the dialog) becomes `Trigger @<sha1 of formatTrigger(t, triggerNames(scn))[0..8]>`; counts before
  `units|unit types|strings|tiles|mineral fields|triggers|start locations|bytes` (optionally `more`/`other`/`placed`)
  and `N%` become `#`; `(the first …)` examples are dropped. **Why the trigger's text and not `fingerprintTrigger`**:
  the first try used the fingerprint, and a `triggers export|import` round trip on Wakka Wakka (140 triggers, 81
  findings) changed 75 of them — the import re-interns strings (`a.text` 131 → 65) and normalises flag bits (0 → 16,
  8 → 16) — so every known trigger finding came back as new. The text form names strings by content, which survives
  renumbering; with it, two triggers prepended to Wakka Wakka leave all 81 known and report only the one new finding.
  The price: editing the trigger, or renaming a location/switch it names, makes its findings new (documented as
  "look at them again"). Level is not in the key (a level change with the same text is the same finding). Kept as
  is: locations, players, switch numbers, unit name + position (they name the thing).
- **The command** (main.ts): `--baseline [file]` and `--write-baseline [file]` are optional-value options, so
  `--baseline a.scx b.scx` would take the map as the file: a value ending `.scm|.scx|.chk` is pushed back into the maps
  and the default file used. A missing file with `--baseline` → exit 2 naming `--write-baseline`; with
  `--write-baseline` a missing file is fine and an existing one is read first, so the per-map line says what changed
  (`(1 new, 1 fixed and dropped)`) and the other maps in the file are kept. Nothing is written when no map could be
  read. Standard input is refused (a map is keyed by its path). Write mode exits 0. `failed` and the exit code are
  computed on the new findings only; `--format github|junit|sarif` get `issues` = new only; `--json` adds `baseline:
  { file, suppressed, fixed, new, fixedFindings, written? }`. Fixed = known entries no current finding (notes
  included, so a baseline written with `--all` does not report its notes as fixed when checked without it). Text: `✔
  no new problems · N known, M fixed since the baseline`, `▲ 1 new warning · …`, and the multi-map summary adds `N
  known findings left out, M fixed since the baseline`.
- **MCP**: `map_check` gained `baseline` (read only; writing stays the command's), `map_coverage` (path, replays[],
  tests, force, starcraft, all; lines to stderr, `coverageJson` as data; the client's cancel stops the games through
  `signal`) — 22 tools. No progress notifications for coverage (a game's progress lines are off: `every: 0`).
- **Tests**: `tests/cli-baseline.test.ts` (6: identity, matching, the file, and the command end to end through the
  exported `program.parseAsync(args, { from: "user" })` with stdout/stderr spied — the first CLI test to drive whole
  commands that way; commander 15 resets option values between parses), `tests/cli-coverage.test.ts` (6: folding with
  and without a parting, adding up, the run over `FAKE_RUNNER` with replays written by `@scm-js/replay/write` incl. a
  sub-folder, a duplicate, a melee one, another map's, a non-replay; the CI forms; tests over `FAKE_TEST_RUNNER`; the
  refusals, `--force`, an older runner, a refused map), `tests/cli-mcp.test.ts` +2 and the tool list.
- **Not built**: a per-game breakdown in text (the JSON has each game's count; per-row per-game is not kept); caching
  a replay's trace by its hash and the map's (heatmap caches events; coverage plays every replay each run — a cache
  keyed by replay + map scenario hash would make re-runs after a trigger edit still replay everything, since the map
  changed, so it would only help unchanged maps); progress over MCP; `--since <baseline>` style coverage ratchets;
  `map check --baseline` across renamed maps (the key is the path).
## Fair starts and smaller maps: `map balance`, `map optimize` (`balance.ts`, `optimize.ts`, `relocate.ts`) — 2026-11-07

Branch `cli-balance-optimize`, one PR; nothing in scm-sim changed (the runner facts below are what it would need).

### `map balance <map> --bots a[,b] [--races r] [--games 8 | --seeds] [--frames 30000] [--parallel] [--out] [--no-rush] [--timeout] [--json]`

- **Runner facts (scm-sim `src/bwapi/match.ts` on main = the deployed `match-19e82f98d80f.mjs`, build 1248410ad2a0):**
  (1) **no computer against computer**: `runMatch` throws "a match needs a bot: the game's computers alone are not a
  ladder's game", so `--bots` is required (one bot plays the game's computer, `parseEntrants([bot, "computer"])`).
  (2) **no fixed starts**: `parseArgs` knows only `--bot file|race|data`, `--computer race` and the flags engine,
  starcraft, map, seed, frames, every, replay, hash-every, timeout; the game is started as `{ game: "melee", seed,
  opponents }` and the game deals the start locations. `MatchPlayer` has `slot`, no start, and no line carries a
  position. **What fixed starts would need**: a per-side start in the runner's arguments (e.g. `--bot
  file|race|data|start` and `--computer race@start`, start = player 1–8 of the map's Start Locations), applied by the
  seat to the melee start assignment before the starting units are placed (the same in every seat's copy), and
  `players[].start` (the start location's index or x/y) in the `start` line so the CLI need not play the replay
  back. Computer against computer would need the relay to run one copy with no bot seat (`seats: 0`).
- **So the starts are read back from the replays**: every game's replay (the ladder's `playGame`, into `--out` or a
  `mkdtemp` folder removed in a `finally`) is played by the replay runner's `--events` (`heatmap.ts#playForEvents`,
  ~3.5 s a game: 1.5 s load, 7,862 frames in 1.6 s). `dealtStart`: the centroid of a slot's units in the first
  `walk` sample it appears in (frame 24: the workers set out for the minerals) → the nearest Start Location within 20
  tiles; else its first `built`. `firstContact`: the first `death` whose owner and killer are both the game's two
  slots and differ (`NOT_A_LOSS` skipped: Scarab, Nuke, Disruption Web, Dark Swarm). Side → slot from the match
  runner's `end.players`.
- **Rows** (`balanceReport`): per start, the games a side was dealt it (desync and unplayed left out), won/lost/
  undecided, win rate over decided, **expected** = the mean of each side's own share of decided wins (so a stronger
  side dealt a start more often does not read as a strong start), margin = 1.96 √Σp(1−p) / n, average length and
  contact, the average arrived walk from `map rush` (run first, on its own `gameMap` copy since `runRush` deletes its
  copy; `--no-rush`), and `mainResources`: every field/geyser assigned to its nearest start and kept within 12 tiles
  (amount by `UnitUsed.Resources` as statistics.ts, else the defaults), with the average distance in tiles.
- **Verdict** (`verdictOf`): too-few (< 2 starts with decided games); one-sided when every side that played won or
  lost all its decided games (no game says anything); balanced when every start is within 10 points
  (`BALANCED_WITHIN`) of expected, "Balanced within N%"; chance when the worst is within its margin; else the start,
  its rate, the expected and `differs`: the static number furthest (≥ 10%) from the others' average — gas, minerals,
  the mineral line's or geyser's distance, the rush walks, the first contact — said as a fact.
- **A bot against itself plays each seed once** (`mirrorOnce`, by the bots' bytes): the first real run played both
  lobby orders, and every seed's two games had the same starts and the same winner (Crescent Moon: the same length to
  the second all 8 times; a generated map: 16:20 vs 17:16 once — the learning files differ), so the pair counted one
  game twice and the margin was too small: the first verdict called a start unbalanced on what was three games.
- `doctor` gained a `map balance` row (needs StarCraft, the match and the replay runners); `RUNNERS.match.command` says
  "(and map balance)". MCP `map_balance` (read-only; games 1–50, frames ≤ 50,000, the live lines to stderr).
- Measured (built CLI, the deployed engine from scmjs.dev/play in the cache, the user's Remastered copy, UAlbertaBot
  built into a `.scmbot` from scm-sim's `data/bots` with a hand-made bundle in the scratchpad): bot against the
  computer (`--bots ualbertabot.scmbot:p --races p --games 4 --parallel 4`, Crescent Moon): 47 s, UAlbertaBot 4-0 →
  "one-sided". Mirrors at `--parallel 4`, deduplicated: Crescent Moon 12 games in 269 s (one undecided at 30,000
  frames; start 3 25% vs 52% expected, "cannot tell that from chance (±49%)"); `map generate --seed 7 --players 4`
  12 games in 176 s (start 1 won 1 of 8, outside the ±35% margin, flagged "unbalanced" with no static difference — the
  map is mirrored, so it is the bot's play from the top left, or chance at ~p 0.03); the literal `map generate
  "(4)Test.scx" --seed 7` (2 players: `--players` is not read from the name) 6 games in 131 s, 2-4, "chance". Peak
  resident of the command ~0.75–0.97 GB (the seats are children; ~1.3 GB each). A game is 10–60 s of wall time;
  the rush walks ~4 s before the games.

### `map optimize <map> [--out] [--dry-run] [--strip-editor] [--compression pkware|zlib] [--keep …] [--all] [--json]`

- **Archive-level, one pass of decisions, measured stage by stage.** `readArchive` (not `openMapBytes`: a built
  map's scenario must stay the built bytes), then: sounds (audio by name or magic) and other members no trigger or
  briefing string names (`stringUsages` kinds trigger/briefing — any string, text or WAV, so it errs on keeping) and,
  while the WAV section stays, the WAV table does not name; WAV entries whose file is absent and not `sound\…`;
  `pruneScenarioStrings` (edit.ts, split from `pruneStrings`); `--strip-editor` = `planSave` with
  `stripTerrainEditing` + `stripBookkeeping` (ISOM TILE DD2 / IVER IVE2 IOWN UPUS SWNM WAV — the registry's
  `editorOnly`, the docs' "Editors only. The game never reads it."; TYPE, the old settings tables in a 205 file,
  unknown sections, repeats and trailing bytes are left: conservative), with `scn.wavs`/`switchNames` nulled first so
  their strings and the list-only sounds go too. Each stage is written with the as-opened compression and its size
  taken; the compression row is (original − baseline rewrite) + (last − final), so the rows add up to the whole.
- **Kept whatever names them**: `trigscript\`, `magenta\`, `scmjs\`, a build's `added`, `--keep` (exact, or a folder
  ending in `\`), and **what the game opens by name**: StarCraft.exe's strings hold `(attributes)`, `(signature)`,
  `Blizzard_2.cnd`, `Ladder_2..4.cnd`, `League_%d.cnd`, `CompUSA_1.cnd`, `KBK_2.cnd`, `PGL_2.cnd`, `Tourn_1.cnd`,
  `WGT_1.cnd` (`GAME_MEMBERS`). The first dry run listed `blizzard_2.cnd` ("Blizzard Authentication Candidate
  Scenario", 44 B, in 15 of 16 Blizzard fixtures) as junk.
- **Built maps** (`restoreBuiltMap` not plain): the chk is written back byte for byte (the manifest's hash), no WAV,
  string or section step; members referenced by the built or the source scenario stay. **EUD maps** (`usesMemory`:
  any `triggerReferences` ref of kind `memory`): strings left — euddraft-style maps reach strings by place, and a
  re-encoded STR loses bytes past the table.
- **Compression**: PKWARE by default (every version reads it; zlib is Remastered-only per saving.md's audit), a map
  already zlib tries both and keeps the smaller, `--compression` forces. Our PKWARE implode beats Blizzard's own:
  Crescent Moon's scenario 77 → 61 KB with nothing removed.
- **ADPCM members are carried as stored** — the trap of this slice. StarEdit stores a WAV with ADPCM + Huffman sectors
  (the first sector PKWARE, so `memberInfo` says "pkware"); mopaq decodes them to PCM and any rewrite stores the PCM:
  StarCraft Fortress grew 399 KB → 1.0 MB. `asStoredFor(compression)` writes every member once that way and keeps,
  as stored, each whose original stored size is smaller than the new one. **But `Creator.addStored` pins a member at
  its old offset** (the key is offset-adjusted), so the archive could not shrink past it (Fortress with
  `--strip-editor` saved 0 B). `relocate.ts` moves them: the MPQ cipher copied from mopaq's `crypto.ts` (MIT, not
  exported), sector table decrypted with key−1 and each sector with key+i under the old offset's key, encrypted under
  the new; `packStored` lays them from offset 32 round the nameless members; `(attributes)`/`(signature)` found by
  `slotOf` among the nameless move too. Single-unit and sector-CRC members (not in SC1 maps; mopaq reads neither) are
  left in place. With members carried, a `(listfile)` naming them is written by hand (`listfile: false` + an extra),
  since the writer lists only what it encoded; a protected map (no listfile) gets none. `writeBest` also tries
  every member written afresh and keeps the smaller.
- **Checks**: the result is opened with `openMapBytes` before anything is written; not smaller → nothing written
  (exit 0, said). Verified over the 16 Blizzard fixtures and the 5 test maps (scratchpad script): every kept member
  decodes byte-identical (Fortress 16, Wakka Wakka 14, Race of Death 8 with ADPCM moved and re-keyed), `diffMaps`
  shows only STR/WAV and the removed members; `map rush` runs the optimized Ice Floes (STR pruned to 7 slots) and the
  stripped Crescent Moon (77 → 24 KB) in the game. Sizes, default: Crescent Moon 79,131 → 62,826; Wakka Wakka 572,824
  → 502,969; Race of Death 386,890 → 319,372; Fortress 408,484 → 381,792; Ashworld Hunters unchanged (nothing written).
- MCP `map_optimize` (dry run unless `write`); core gained `memberInfo`, `readWavs`, `applySounds`, `UnitUsed`,
  `triggerReferences` (+ its types).
- Tests: `tests/cli-optimize.test.ts` (8: junk removed and only junk, diff, strip, built map, EUD, compression, bare
  chk, keep/GAME_MEMBERS, relocation of an encrypted adjusted member read back), `tests/cli-balance.test.ts` (10: starts
  and resources, dealt start and contact from events, rows/pairs/verdict kinds, `differs`, the run over a stand-in
  match runner + replay runner both ways round, a bot against itself once a seed, one bot against the computer with no
  replays left, refusals); `cli-mcp` names + a dry run and write, `cli-doctor` the new row.
- **Leftovers**: fixed starts and computer-vs-computer in the match runner (above); the start in the runner's lines;
  balance over several maps at once; a `--pairs` that hands the game a copy with only two Start Locations (decided
  against as the default: the AIs scout fewer places, so first contact would read early); optimize does not merge
  repeated sections or drop unknown ones (the Save dialog's other ticks), and a built map's source is not pruned
  (rebuild); a member is carried as stored by its own size alone, so a few small ones can be carried where writing
  them afresh would have packed tighter (the whole file is compared both ways, which bounds it). Aside: `map rush` on (8)StarCraft Fortress reports "910 walks" for 8 starts on
  the original file too.

**The archives are `scmjs-cli-<os>-<arch>` (2026-11-08, after the 0.12.0 release failed).** The first names were
`scmjs-windows-x64.zip` and so on, which differ only in case from the desktop installers' `scmJS-windows-x64.zip`
(electron-builder's `${productName}-windows-${arch}.zip`, the portable editor). The tag build of v0.12.0 created the
release and then `gh release create … assets/*` got `HTTP 404` from uploads.github.com on `scmJS-windows-x64.zip`, and
gh removed the half-made release — two assets whose names differ only in case cannot both be in a release, and on a
case-insensitive disk (Windows, macOS) a person downloading both would have a clash anyway. So the command's archives
carry `-cli-`: `scmjs-cli-windows-x64.zip`, `scmjs-cli-macos-arm64.tar.gz`, `scmjs-cli-macos-x64.tar.gz`,
`scmjs-cli-linux-x64.tar.gz` (build-cli-binary.mjs `TARGETS[].asset`, `scripts/lib/recipes.mjs`, the packaging
templates, docs/cli.md, docs/installing.md). The file inside each archive is still `scmjs` / `scmjs.exe`. v0.12.0 is a
tag with no release page (its editor, docs, npm packages and image did publish); 0.12.1 is that release, and
`docs/releases/0.12.0.md` became `0.12.1.md`.

## The command line in Korean (`cli/src/i18n.ts`, `commanderText.ts`, `ko.json`) — 2026-11-08

The user's slice: the editor is in Korean, StarCraft's biggest mapping community reads Korean, so `scmjs` speaks it
too. Branch `cli-korean`. Reverses the first slice's "CLI strings are literals".

- **Choosing the language** (`chooseLocale(args, env, system)`): `--lang ko|en` / `--lang=ko` anywhere before `--`,
  else `SCMJS_LANG`, else the first set of `LC_ALL`, `LC_MESSAGES`, `LANG` (Korean when it starts with `ko`; `C` is
  English — a set POSIX locale decides, the system is not asked), else `Intl.DateTimeFormat().resolvedOptions().locale`
  (Windows, which has no `LANG`), else English. Read from `process.argv` rather than commander because the help's
  descriptions are made when the program is built: **main.ts's commands are inside `buildProgram()`** (the whole
  1,400-line body indented once — template literals left alone, their text is output), and the module does
  `if (!VITEST) setLocale(chooseLocale(argv)); export const program = buildProgram();` — tests get English unless
  they `setLocale("ko")` and build their own. `--lang` is also a real option (`.choices(["en","ko"])`) so commander
  takes it anywhere and refuses `--lang fr`. No `t()` at module scope still holds: every module is evaluated before
  main's body sets the language.
- **The catalogue is separate**: `cli/src/ko.json` (1,848 messages, 231 KB on disk), kept by `npm run i18n` as a
  second tree (`scripts/i18n.mjs` `TREES`; `tests/i18n.test.ts` checks both). Why not the editor's: the app's ko.json
  would have grown by its whole size again for strings the app never shows, and the CLI bundle would have carried the
  editor's UI. `cli/src/i18n.ts` exports `t`/`msg`/`translate` (its catalogue, then the editor's `translate`, so a
  finding's `where`, tileset and game names come out translated), `inEnglish`, `locale`/`setLocale`; it is the one CLI
  module allowed to import `src/i18n` (`tests/core.test.ts` `I18N_EXCEPTION`), since core does not export the
  translator (its own build empties the catalogue).
- **Bundle**: the leave-out plugin no longer empties the editor's catalogue; it loads a placeholder and `renderChunk`
  replaces it with the entries the chunk's modules ask for (`editorCatalogueFor(chunk.moduleIds)`: `messagesIn` over
  each `src/**.ts` module in the bundle) — 1,154 of 3,195 entries, ~93 KB (the plugin host and atoms pull UI modules
  in, hence not smaller). `cli/dist/scmjs.mjs`: 5,713,798 → 6,089,246 bytes (+375 KB, +6.6%).
- **Check Map's findings** come from `validateScenario`, already `t()` — they follow the language for free once it is
  set. **Baselines are matched in English**: `findingId` parses English ("Trigger 2:", counts), and the file is shared
  between computers, so `map check` with a baseline in another language validates a second time `inEnglish`, matches
  those, and shows the same-index findings in the reader's language; written entries are English. `fixedFindings`
  print as the file has them (English). Test: a baseline written in Korean holds with `--strict` in both languages.
- **The line drawn**: translated — help, descriptions, printed reports, `CliError`s and hints, human sentences inside
  `--json` (a finding's text, a hint, optimize's step labels). English — `--json` keys and naming values (levels,
  kinds, version and tileset labels in JSON, game types), every file a command writes (dump, baseline, tests files,
  init's README/workflow/.gitattributes and `--print`, plugin starter, ladder.json's entrant labels), map text, the
  trigger text form and the dump/unpack formats (so `git diff` reads the same everywhere), text sent to servers, the
  CI formats' rule ids and level words (their messages follow the language), the trigger vocabulary inside messages
  (condition names, "always"/"nothing", player names in tests files), debug lines, internal `Error`s. **`scmjs mcp` and
  `scmjs lsp` call `setLocale("en")`** in their actions: the MCP tools are read by a model; the LSP carries the
  TrigScript compiler's English diagnostics (their help text in `--help` is translated).
- **commander's own words** (`commanderText.ts`): titles through `styleTitle` → `translate` (`msg()`'d "Usage:",
  "Options:", "Arguments:", "Commands:", "Global Options:"), `(default: …)`/choices/preset/env through
  `optionDescription`/`argumentDescription` overrides, errors through `outputError` matched by regex (unknown
  option/command, missing argument, option needs a value, too many arguments, invalid choice, conflicting options,
  the "Did you mean" line). Not changeable: the usage line's `[options]` / `[command]` (syntax, left), and any
  commander message the regexes do not know (stays English).
- **Width**: `ui.ts` has `charWidth` over a sorted range table of East_Asian_Width W/F (Hangul, CJK, kana, full-width,
  emoji blocks) and zero-width marks (combining, ZWJ, variation selectors, conjoining jamo), binary-searched;
  `columns`, `padColumns`. `rows()` now pads by columns (it was `.length`), banner's fit and title alignment too, and
  commander's `displayWidth` is `columns` so its padding and wrapping count Hangul as two. Root help: 23 lines in
  both languages (`tests/cli.test.ts`), ≤ 80 columns by `columns()`. Multi-line Korean help texts were broken by hand
  at ≤ 80 columns.
- **How it was done**: six parallel agents over disjoint files (main.ts split at `map test`, edits through a locked
  string-replace script), each writing a Korean fragment checked for missing keys, placeholder mismatches and lines
  past 80 columns; merged with ~40 conflicting translations of shared keys settled by hand. Shadowing locals named
  `t` were renamed across a dozen files. `files.ts` gained `MapReadError` (`.reason`), so `fetch` and `map log` no
  longer strip an English prefix.
- **Tests**: `tests/cli-i18n.test.ts` (13): the choice of language, widths and alignment, commander's words, Korean
  help, `info` with the map's own text untouched, `--json` key paths equal in both languages (`info`, `map check`),
  findings in Korean with SARIF rule ids English, a dump identical in both, the baseline across languages,
  `SCMJS_LANG`, `--lang fr` refused. `tests/cli.test.ts`: the Korean overview within 23 lines.
- **Leftovers**: the Korean is Claude's, not a native speaker's — review via `npm run i18n -- --export ko` (the CSV
  holds both trees); docs/cli.md is not in Korean (the docs site's Korean pages are a separate effort); a few English
  fragments remain inside Korean sentences by decision (trigger vocabulary, condition names, web-page button labels
  such as "Invite Players", "My Maps"); `heatmap`'s "no such file" detection still keys on files.ts's English "No
  file " prefix (shows the full Korean message instead); the editor catalogue subset could shrink further if the
  plugin host stopped pulling UI modules in; `--lang` is not in the shell completion's value list.
## The GitHub Action, `map test --clips`, plain-ground pictures (`action/`, `cli/src/clips.ts`) — 2026-11-08, branch `cli-action`

One PR (#186) of three parts: the action, clips of failed tests, and the release job's asset-name guard
(`desktop-releases.md`, end).

**The action** (`action/action.yml` + `action/scripts/{find,install,run,report}.sh` + `action/README.md`, its page):
`uses: scm-js/scm-js/action@v<release>` — GitHub runs an action from a subfolder, so no repository of its own; the
README says how to move it to one (copy the folder, nothing names it). A **composite action of bash scripts**, not a
JavaScript action: nothing to build or vendor (`dist/` with ncc), the logic is the CLI's, and `scmjs` itself is the
dependency. Steps: `find.sh` (version: `latest` → `gh api …/releases/latest`, falling back to where github.com's
`/releases/latest` redirects; the asset `scmjs-cli-<os>-<arch>` from `RUNNER_OS`/`RUNNER_ARCH`; the folder
`$RUNNER_TOOL_CACHE/scmjs-cli/<v>/<os>-<arch>`) → `actions/cache` keyed `scmjs-cli-<v>-<asset>` → `install.sh`
(download + `SHA256SUMS` line by awk, `sha256sum` or `shasum -a 256`, tar/unzip, `GITHUB_PATH`; `install: npm` writes
a two-line `scmjs` wrapper around `npx -y -p @scm-js/cli@<v> [-p typescript@6]`; `none` checks PATH) → `run.sh` →
upload-artifact (pictures) → upload-sarif → `report.sh`. Third-party actions are pinned by commit with the version in a
comment (`tests/action.test.ts` holds that; build.yml itself uses `@v4` tags — the brief assumed otherwise).
- **run.sh never fails**; it writes `$RUNNER_TEMP/scmjs-action/{body.md,status,changed}` and `report.sh` exits with
  the status *after* the summary and the comment, so a failing check still gets its map's changes shown. `export
  NO_COLOR=1` for the whole script: picocolors turns colour on under `GITHUB_ACTIONS`, and the first CI comment was
  full of escape codes. **Bash 3.2-safe** (a Mac's): no mapfile/globstar/assoc arrays.
- **Maps** = `git ls-files -co --exclude-standard -z -- ':(glob)<line>'…` (one glob a line — a line split on spaces
  would break `my maps/*.scx`; default `:(icase)*.scx` etc.), filtered to map extensions and files that exist. git
  rather than bash globs: `**` without bash 4, and ignored folders (node_modules) skipped for free.
- **Check** three or four times (text in a group for the log, `--format github` for annotations whose exit code is the
  verdict, `--json` for counts, `--format sarif`): each is ~0.2 s. `problems` = errors + warnings of the new findings +
  `baseline.suppressed`; `new_problems` = the new ones. Baseline: the input, else `.scmjs-baseline.json` if present.
- **Build**: which maps keep a script is **`map info --json`'s new `script` field** (`hasScript(doc.extras)`, null when
  the build cannot tell; measured no cost on `map info`). An older scmjs lacks the field → a warning, nothing built.
  TypeScript: the repository's `node_modules/typescript`, else `npm install --prefix $work/typescript typescript@6` and
  the build run *from that folder* with the map's absolute path (`findTypeScript` looks from the cwd; a `-g` install
  failed for permissions locally and is not needed). `TYPESCRIPT` in init.ts is held to the scripts by the test.
- **Diff**: base = input, else `pull_request.base.sha`, else `github.event.before` (all zeros = none). Fetched with
  `--depth=1` when the checkout lacks it. Changed maps = `git diff --name-only --no-renames -z <base>` (base vs the
  *working tree*, so a step that edits a map before the action counts — the test relies on it) ∩ the maps; a deleted
  path counts when the globs (bash `[[ == ]]`) would have taken it; new = not in the base tree. Per map: the text
  (`map diff --rev`, exit 0 = "the same map (only the file's bytes differ)"), a jq summary of `--json` (header fields
  by name, then `units +a −r ~c` per part, "sections only"), and with pictures `--picture --out
  $work/pictures/<path>.png` (one artifact keeps the folders). The comment: marker `<!-- scmjs-action:maps -->` on line
  one, found with `gh api …/issues/<n>/comments --paginate`, PATCHed or POSTed with `-F body=@file`; posted only when a
  map changed or one exists to edit; details cut at 80 lines a map and ~45 KB in all (GitHub's limit is 65,536). A
  fork's read-only token → a warning, not a failure. Artifact name `map-pictures-<job>` (`overwrite: true`; two uses
  in one job need `artifact:`), linked by `artifact-url` (GitHub asks for a sign-in).
- **Plain ground** (`preview.ts#plainShade`, `GameGraphics.tileset: Tileset | null`): with no game copy found and none
  named, `map diff --picture` draws each tile a grey by its tile group (id >> 4, hashed into 80–119, blue +10; id 0
  black as the editor's null tile) instead of refusing; `copy: null` in the JSON, a dim line in the terminal, "drawn
  without the game" under a PNG. A named `--starcraft` that is not a copy is still refused. Made for the runner, which
  has no game — without it `pictures: true` could never work there. Real terrain reads as fine noise (each variant
  group differs); the generated test maps are all tile 0, so black. Preview/heatmap/share still need the copy.
- **`scmjs init`** writes a `maps.yml` that uses the action (`uses: scm-js/scm-js/action@v<VERSION>` + `version:
  <VERSION>`, `maps:` one glob or a block, `strict: true`, `pictures: true`, `build: true` only when a map keeps a
  script, else commented; `pull-requests: write`), replacing the npx steps. `mapGlobs(prefix, files, quote = true)`:
  unquoted for the action. A single glob is JSON-quoted when it starts with `*` (a YAML alias otherwise). The map test
  comment line is now `scmjs map test <map> --format github --clips` on a self-hosted runner.
- **Tested for real** by `.github/workflows/action-test.yml` (PRs touching `action/**`, `tests/maps/**`, itself):
  `source` builds the CLI from the branch (`npm ci`, `build:cli`, a `node cli/dist/scmjs.mjs` wrapper, `install:
  none`), changes `tests/maps/melee.scx` (name + resize top-left) and packs a scripted copy of ums.scx, runs the action
  with pictures, SARIF and build, asserts the outputs, the PNG and the comment, then runs it again and asserts one
  comment; `release` (matrix binary/npm) installs the newest release, writes a baseline with it and runs with strict.
  The first push failed on the manifest (`Empty: ` in a plain description is a YAML mapping) — the tests now read
  action.yml and both workflows with js-yaml (in node_modules through the tools, not a dependency; skipped without).
  `tests/action.test.ts`: inputs/outputs == README tables, pins, scripts exist and pass `bash -n`, init's `with:` keys
  are inputs.

**`map test --clips [folder] [--clips-format gif|webm]`** (`clips.ts`): after the verdict (the summary line now
prints before the clips), for each failed scenario with a kept replay, `exportReplay` (DI'd for tests) with the new
`ExportOptions.fromFrame/toFrame` (frames, not m:ss) = `clipWindow(end frame, replay length)`: 8 s (190 frames)
before to 2 s (48) after, inside the game. Named `<tests file minus .json>.<slug>.<kind>` (`ums.tests.x.gif`, `-2` on a
clash) in `<map>.clips/` (stdin: cwd). `--clips` named `--clips` rather than `--video`: one file a failure, and the kind
is its own option. `--clips foo.json` is taken as a tests file (optional value). **Missing machinery**: no browser
found → one `▲ No clips: …` line, nothing tried; the first `CliError` from export (play page too old, browser crash,
no game files) → the same line and the rest untried — such causes repeat for every clip. The exit code stays the
tests'. A replay-driven scenario gets "no clip … it plays bug.rep" (its game is that replay; export draws it).
`--json` adds `clips` + `clipsMissing`; `TestCaseReport.clip` is named in github/junit/sarif as `clip: <path>`.
`IGNORE_LINES` gained `*.clips/` (and this repository's .gitignore). `tests/cli-clips.test.ts` (5).
- **Measured** (WSL, Remastered copy, Playwright's Chromium with `~/.cache/scmjs-headless-libs` on
  `LD_LIBRARY_PATH`): ums.scx with the sample's second scenario broken on purpose (carrier `is: 0`) plus the real third
  failure — 3 scenarios in 10.0 s, two GIFs 640×360, 100 pictures, 8.0 s each (the games ended at 0:40 and 0:25, so no
  "after"), 228 KB and 254 KB, whole command 25 s; WebM the same window 124 KB / 386 KB. Without the libraries: `▲ No
  clips: The browser stopped (exit code 127) … libnspr4.so` once, the tests' result unchanged.

**Leftovers**: the README and docs show `@v0.13.0` (the first release with `action/`; check the number at release);
the action is untested on macOS/Windows runners (Windows needs `unzip` in Git Bash, which the hosted image has);
per-picture links (an artifact is one zip; `archive: false` uploads one file an artifact, and a composite cannot loop
`uses:`); pictures inline in the comment would need hosting outside GitHub; `map coverage` stays out (needs the game);
the clips for a replay-driven scenario could use its replay with the map's own scenario swapped in.
## A melee map's layout: `map analyze` (`cli/src/analyze.ts`, `walk.ts`) — 2026-11-08

`scmjs map analyze <map> [--json] [--picture out.png|-] [--scale n] [--all] [--starcraft dir]`, branch
`cli-map-analyze`. Starts, mains, naturals, every pair's ground and air distance, the narrowest points, terrain shares
and verdicts, **without the engine**: the tileset from the copy (`openGameFiles` → `readTileset`, `readUnitsDat`,
`readSpeedTables`) and pure TypeScript after that. Whole command 0.4–0.8 s (the copy's kascade open ~0.2–0.5 s of it);
the analysis itself 20–140 ms (Spring Thaw 256 × 128, 4 starts: 135 ms; Big Game Hunters, 8 starts: ~100 ms).

- **Grid: minitiles (8 px), octile.** `walk.ts` = the Walkability plugin's pieces copied with attribution (EDT clearance
  by Felzenszwalb–Huttenlocher, `passageWidth`, Dial's algorithm 5/7 with no corner cutting) plus `pathTo` (back down the
  distances, straight steps first), `distancesWithin` (a bounded walk into a Map), `withoutSpecks`, `narrowestOn`.
  Tile resolution was rejected: VF4 walkability is per minitile, and ramps/doodad feet are a few minitiles. **Unit
  size**: a cell is walked when its clearance > 1 (`UNIT_RADIUS`, the plugin's Small default; generate.ts's 3 × 3
  erosion is the Chebyshev version). Tried radius 0 / 1.5 / 2 against the game: 4.2% / 3.4% / 3.1% mean gap vs 3.6% at
  1 — not worth departing from the plugin's default. **Blockers**: every unit or unit-sprite (THG2 without the
  PureSprite bit) whose units.dat flags say building and not flyer, by its collision extents (+1), so resources,
  neutral and player buildings, doors and traps; without units.dat only fields/geysers (bases.ts sizes). Start
  locations do not block (no town hall is placed, unlike the rush's Nexus).
- **Narrow = `passageWidth`** (the shortest of four wall-to-wall lines through the cell) along the shortest path,
  ends (3 tiles) left out, on a wall grid where closed patches standing alone under 16 tiles in area are opened
  (`ROCK_TILES`). The first version measured only terrain specks under one tile and named a 1.3-tile "choke" on Spring
  Thaw between a cliff and a 27-cell rock, and a 1-tile one on Big Game Hunters between a base's field line and its
  geyser; opening every standalone patch < 16 tiles (rocks, doodads, a lone geyser or a few fields) fixed both while a
  cliff, a field line touching it, or a building still counts. The widest-route bottleneck (the plugin's maximin) was
  not used: the brief asked for the narrowest point on the shortest walk.
- **Bases**: resources within `BASE_LINK` 12 tiles are one base when the walk between them (radius-0 open grid,
  `distancesWithin` from each one's nearest open cell) is ≤ straight + 6 tiles; fields < 100 minerals are walls;
  a base needs a geyser or ≥ 3 fields. The first rule (fields 6 tiles, geysers to the nearest field ≤ 10) split
  Spring Thaw's bases whose hall stands between two field groups 12 tiles apart, and left a geyser 10.5 tiles off as
  its own base. **Main** = every base whose middle is within 12 tiles (balance's `MAIN_RADIUS`) of its nearest start;
  the numbers shown are `balance.ts#mainResources` (reused; its signature now takes `Pick<OpenedMap, "scenario">`).
  "Only the nearest base is the main" gave Big Game Hunters (mains in two groups) a natural 5 tiles away. **Natural** =
  the nearest non-main base by ground to its "hall spot" (the cell nearest the resources' middle with clearance ≥ 6
  cells). Spring Thaw and Binary Burghs pick bases 50–90 tiles away: their mains have no base near on foot, so this is
  the honest answer, not a bug.
- **Way out** (JSON `wayOut`) = narrowest point on start → natural; a pair's narrowest within 4 tiles of one is labelled
  `wayOutOf`. **Seconds** = px / `walkSpeed` × 0.042 for Zergling, Marine, Zealot (see units.md for `walkSpeed`; needs
  units/flingy/sprites/images.dat + iscript.bin from the copy, else tiles only and the text says so).
- **Verdicts** (`verdictsOf`, thresholds exported): pairs ≤ `FAIR_WITHIN` 8% (generate's tolerance); with ≥ 3 starts
  the rank comparison (`rankSpread`: each start's sorted walks, rank by rank) decides, since a square of four has near
  and far pairs by design; naturals ≥ 5 tiles from the median (two starts: the larger against the smaller, `apartFrom`
  — a median of two flagged both); no gas where others have it; shared natural; way out ±1 tile; a pair's narrowest
  < 2 tiles; raised (mid + high) ground ±15 points within 12 tiles ("high" alone was 0% on every generated map: Jungle's
  High Dirt is the middle level).
- **Cross-check with `map rush`** (Zergling, Remastered copy, engine 1248410ad2a0 from the cache; scratch script):
  same start point (`testPoint`: 5 tiles toward the middle) to the target start, minus the rush's `off`: mean 3.6%
  shorter than the game, max 13.1% (`map generate --seed 7 --players 2`, an open diagonal); per map Binary Burghs 3.2,
  Spring Thaw 4.4, Big Game Hunters 2.9 (56 walks), Isolation 3.4, Crescent Moon 3.5, Ice Floes 6.8 (one walk; 1 → 2
  "stopped" in the game), Zoo Keeper 2.6 (most of its walks stop or are apart in the game too), generated 4p 5.2,
  generated 2p 10.8. **The command's own figure (centre to centre) against the game's walk: mean |diff| 2.5%, max 8.3%,
  mean +1.6%** over the 103 walks — the start/end offsets roughly cancel. The gap is the game's region-to-region
  pathing (longer than octile-optimal, most on open diagonals) and acceleration/turning; documented, not corrected.
  Zergling seconds run about 0–8% under the rush's (14% on the open 2-player generated map). `map generate`'s own
  `measureMap` numbers for (4)Crossing seed 2026 (141/93/123) are this command's exactly (same metric).
- Core gained `tileGroupOf`, `decodeFlingyDat`, `decodeSpritesDat`, `decodeImagesDat`, `decodeIscript`, `walkSpeed`
  (+ types); doctor's READY row is `map preview|generate|analyze`; MCP `map_analyze` (read-only; `picture` adds the
  PNG as image content).
- Tests: `tests/cli-analyze.test.ts` (21): octile costs, the wall with a gap (detour, crossing only in the gap,
  narrowest = the gap's 4 cells), corners, clearance, specks, bounded walk, ground from flags; spread/median/apartFrom/
  rankSpread/sideOf; clustering with and without the ground predicate; blockers; a 64 × 64 map with a made-up tileset
  (wall with a one-tile gap: naturals, the choke verdict at (32, 40), no gas, the picture's walk through the gap); the
  verdicts' thresholds on both sides; `walkSpeed` over a hand-built iscript.bin; the command through a stand-in
  1.16.1 copy (refusals, report, PNG) and the committed melee map. cli-mcp: names + read-only + scale refusal + a
  real-copy call (`skipIf`); cli-doctor pins the row.
- **Leftovers**: no screenshot in docs (`scripts/cli-screenshots.mjs` not run for it); the picture has no start
  numbers (no font, as preview); unit size is fixed (no `--unit`); speed upgrades and acceleration not modelled; the
  natural is "nearest base on foot", so a map whose designers mean another base reads differently; chokes off the
  shortest walks (a second route's narrows) are not reported — the plugin's BWEM-style areas would be the next step;
  `map generate` could call `analyzeLayout` instead of its own `measureMap` (same numbers) but was left alone.

## Mods: `scmjs mod` (`cli/src/mod/`) — 2026-11-08, slice M3 of the mods plan

The whole design, the proofs and the traps are in **`mods.md`**. Here, what touches the rest of the command:
- The first noun with **its own folder** (`cli/src/mod/*.ts`, imports `../../../src/…`); `tests/core.test.ts` now walks
  `cli/src/**` recursively and matches `(../)+src/`, so the thin-layer rule holds there too.
- **The overview's row** came from `about`, now `{ hidden: true }` (still listed in docs/cli.md's reference). The 23
  lines are held again; the next row needs another freed.
- `map test`'s action is the function `mapTestAction`, shared with `mod test <mod> <map>`; `map test|trace|cost` take
  `--mod`, which writes the mod loose in a temp folder (`overlay.ts`) only after `modArgs` says the engine's runners
  take one (`current.json` `"mods": 1`), and removes it after. On a Remastered copy a mod the runner reloads the
  startup data for also gets the game's own pictures as a layer under it (`--mod <game> --mod <mod>`; the runner's
  own Remastered reader has not got them); `mods.md` "Remastered copy and the engine's reload".
- `mod play` has its own loopback page (`play.ts`), not `open.ts`'s `handOver`: it serves `/manifest`, `/file/<i>` and
  `/map`, builds `File`s in the page and posts `scmjs.play` with `dataSet`; `tests/cli-mod.test.ts` stands in for the page.
- MCP: six tools (`mod_info|check|diff|unpack|pack|new`), 31 in all with `map_analyze`; `mod_unpack`'s data leaves out the manifest.
- **In Korean** (merged after the Korean slice): every printed word of `cli/src/mod/` and the `mod` commands in
  main.ts goes through `t()`, as the rest; the files a mod command writes (mod.json, README, the tables' text) stay
  English, as map unpack's do, and so does the play page hand-over's loopback page, as `open.ts`'s. **Left English**:
  the findings of `mod check` and the lines of `mod diff`, which `src/formats/mod/{check,diff}.ts` make — the editor
  does not show them, so they are not in its catalogue, and the CLI's catalogue reads `cli/src` only; translating them
  means moving their words into `cli/src` (a table of rules to sentences) or a third tree.
- `mapTestAction` carries #186's `--clips` too, but `mod test` does not offer it and `map test --mod --clips` draws
  the clips on the play page without the mod (the replay is the modded game's): a clip of a mod that changes the
  units can go out of step. Not guarded.

- `mod header <mod> [--out] [--namespace] [--bot]` (C4, 2026-11-08): a bot's C++ header and JSON of the mod's ids by
  name; design and Cosmonarchy's numbers in `mods.md` "`mod header`". No MCP tool (a bot author's command). Its
  `Header`/`Ids`/`Bot` rows are new one-word catalogue keys.

## A replay's mod (R1 of the capstone, 2026-11-08, branch `replay-tag`)

scm-sim `docs/mods-plan.md` "Capstone (M10)", decision 3 and slice R1. `@scm-js/replay` 1.1.0 (branch `scmj` in
~/github/replay, worktree replay-tag; **the root `package.json` points at `file:../replay-tag` until it is
published** — switch it back to `^1.1.0`) reads an `SCMJ` tagged section into `Replay.mod` (`ModTag`: v, dataSet
{hash, name, url}, plugins [{name, sha256}], firegraft, noplugins, engine, madeBy; unknown fields kept), and writes it
(`appendModTag`, unpacked raw chunks, browser-safe). Framing: tag, u32 byte length, then a 4-byte size section and the
payload section (as the commands/map are framed) — the length is there because both existing readers (1.0.1 and
scm-sim's `rep.ts`) skip a Remastered tagged section by it. In a legacy file it follows the map directly.

**The loader proof** (2026-11-08, scm-sim-lift `scripts/exact-replay.ts`, lifted 0x4DF570): 1556, 1544 (70,255
frames), legacy_cp949, legacy_cp1252 and things.rep, each untagged and with an SCMJ section appended: identical seed,
units, resources and hash at every printed frame and at the end, same end reason. A negative control (the header
section's checksum flipped) is refused by the loader ("could not load the replay"), so the loader does read the bytes
handed to it; it reads the four sections and nothing after.

`cli/src/replaymod.ts`:
- `replay info`: `Mod` row (name · hash · link) and `Plugins` row from the tag ("none" without); `--builds` (per
  player, each unit/building/upgrade/tech ordered: first frame, order count, one's cost — orders, not outcomes:
  Probe ×186 is spam) and `--mod <mod>` (names + costs via `openMod` → `loadModData` → `namesOf`, the mod's tables
  over the person's copy). Vanilla names are the editor's `gameUnitName` etc. (translated); costs from the copy's
  tables when one is found, else left out. **A tagged replay with no `--mod` shows ids, never the game's names.**
- The check (`checkReplayMod`): `sourceHashes` → `ModHashes {hash, withoutPlugins, all, changed}`; `isTaggedMod`
  accepts any of the four. `hash`/`withoutPlugins` = the one rule (`mods.md` "The mod hash, one rule"); `all` (game
  files alone) and `changed` (those differing from the person's copy; null without one) are the forms R1 tagged with,
  kept so replays tagged before 2026-11-08 still match. Mismatch → CliError naming `hash` and the tag's, hint = the
  makers' link. Untagged + `--mod` → a warning on stderr, then the mod's names. Opened and hashed once per (path,
  starcraft) per process (Cosmonarchy's release: ~5 s, 7,769 files; `ac3f86533e4b5a31`).
- `refuseModReplay`: `replay watch`, `replay export`, `map test record`; `modReplayReason` makes `map heatmap` and
  `map coverage` skip one. `checkPlayedMod` for `map trace|cost --replay`: tag needs `--mod`, same hash, and no
  plugins (`!noplugins && plugins.length` refused: the runners lay files, run no plugin). Untagged replays: unchanged.
- MCP `replay_info` gained `builds`, `mod`, `starcraft`; warnings go into the text.
- Tests: `tests/cli-replay-mod.test.ts` (9, no game data: a two-file mod of units.dat + unitnames.tbl made by the codecs).
- Not done: `replay watch|export` with a mod (needs the replay runner / viewer to take a data set: R2); the hash rule
  will gain the plugins and the project in step 7a — `sourceHashes` must follow.
