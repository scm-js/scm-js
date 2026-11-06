# The `scmjs` command line

`cli/` is the npm package `scmjs` (not published yet, 2026-11-05): `npx scmjs about | info | map info|check|open |
replay info|open`. The reader's page is `docs/cli.md`. The shape was the user's (2026-11-05): one command, a noun for
each kind of thing (`map`, `replay`, later `plugin`, `bot` — scm-sim's scmbot toolchain is meant to move under
`scmjs bot`), "an impressive UX tool … not overly engineered".

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
- **One file.** `scripts/build-cli.mjs` is a Vite SSR build with `ssr.noExternal: true` and `codeSplitting: false`
  (rolldown's name for inlineDynamicImports) → `cli/dist/scmjs.mjs` (~670 KB, shebang). commander, picocolors and
  @scm-js/replay are devDependencies of the root bundled in, so the published package has no dependencies and `npx` fetches one file.
  The version is the editor's (`package.json`), written into `cli/package.json` by the build; commit and build date
  are `define`d. commander 15 needs Node ≥ 22.12 (`engines`).
- **Type-checked** by `tsconfig.cli.json` (in `tsc -b`'s references): `types: node, vite/client`, `cli/src` only
  (it pulls in the `src/` files it imports). `tests/cli.test.ts` covers the pieces; `npm run cli -- …` runs it.
- **Output** (`cli/src/ui.ts`): picocolors decides colour (`NO_COLOR`, `FORCE_COLOR`, `--no-color`, a pipe). Marks
  ✔ ✖ ▲ ℹ fall back to ASCII on the old Windows console. `rows()` aligns label/value pairs (`null` = blank line,
  one width for all groups); `table()` pads by visible width. `gameText` turns StarCraft's colour bytes into 24-bit
  colour only when `COLORTERM` says truecolor, else drops them; replays colour player names by the replay's colours.
  `--json` everywhere: one object, or a list for several files. Exit codes: 1 failed check / error, 2 a missing or
  wrong-kind file. A failing file in a list is reported on stderr and the rest go on.

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
headless), `plugin new|dev|test`, `bot …` from scm-sim, `setup --from` for the game files. Publishing `scmjs` to npm
is the user's step (`cd cli && npm publish`, prepack builds).
