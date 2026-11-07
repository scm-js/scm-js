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

Done 2026-11-06: triggers/strings export-import, diff, completions (above), on `@scm-js/core` (`core.md`). Still
proposed: `map unpack|pack`, `map build` (TrigScript headless — a spike first), `map run` (the plugin API headless),
`map render`, `bot run` (a headless game through scm-sim), `setup --from` for the game files. **Publishing is CI's**
(2026-11-06): `build.yml`'s `cli` job, stable channel only, `build:cli` (stamps the version), checks it equals the
release's, skips a version npm has, `npm publish` by trusted publishing over OIDC with provenance, like `plugin-api`
and `core`. 0.8.8 was published by hand (security key: own terminal, `--browser=false`); every version since from CI.
