# The `scmjs` command line

`cli/` is the npm package **`@scm-js/cli`** (its command is `scmjs`): `scmjs about | doctor | info | map info|check|open|new|dump|find|set|resize|triggers|strings|diff|build|run|unpack|pack |
replay info|open | plugin new|check|dev | bot new|init|build|update|run`, or `npx @scm-js/cli …`. npm refused the plain name `scmjs` on the first publish (2026-11-06,
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
