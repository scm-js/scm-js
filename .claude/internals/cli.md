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
  (`http://127.0.0.1|localhost|[::1]:port`), once, opens it like a drop (`openGivenFiles`), and posts
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

`map unpack|pack|diff`, `map triggers export|import`, `map trigscript build`, `map render`, `map run` (the plugin API
headless), `plugin new|dev|test`, `bot …` from scm-sim, `setup --from` for the game files. **Publishing is CI's** (2026-11-06, at the user's ask): `build.yml`'s `cli` job, on the stable channel
only (a release tag), runs `build:cli` (stamps the version), checks it equals the release's, skips a version npm
has, and `npm publish`es by trusted publishing over OIDC with provenance, like `plugin-api`. Needs a trusted
publisher on npmjs.com for @scm-js/cli: scm-js/scm-js, `build.yml`, no environment, direct publish allowed. 0.8.8
was published by hand (security key: own terminal, `--browser=false`).
