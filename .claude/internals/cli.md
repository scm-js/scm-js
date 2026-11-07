# The `scmjs` command line

`cli/` is the npm package **`@scm-js/cli`** (its command is `scmjs`): `scmjs about | info | map info|check|open |
replay info|open`, or `npx @scm-js/cli …`. npm refused the plain name `scmjs` on the first publish (2026-11-06,
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
(`core.md`), `map run`, `map unpack|pack` (above). Still proposed:
`map render`, `bot run` (a headless game through scm-sim), `setup --from` for the game files. **Publishing is CI's**
(2026-11-06): `build.yml`'s `cli` job, stable channel only, `build:cli` (stamps the version), checks it equals the
release's, skips a version npm has, `npm publish` by trusted publishing over OIDC with provenance, like `plugin-api`
and `core`. 0.8.8 was published by hand (security key: own terminal, `--browser=false`); every version since from CI.
