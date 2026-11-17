# The command line and the editor: opening, `map play`, the live link, `scmjs lsp`

How a terminal reaches a page: `map open` / `replay open` (the desktop app or a browser hand-over), `map play` (a lobby
on the play page), `map open --live` and the MCP `editor_*` tools (a map linked to the open editor), and `scmjs lsp`
(TrigScript in a text editor). The site's own pages use the same hand-over through an inbox.

## Opening (`open.ts`, `src/hooks/useOpenerHandoff.ts`)

- **The desktop app** when it is there: `SCMJS_APP`, else the installers' places (Windows
  `%LOCALAPPDATA%\Programs\scmJS\scmJS.exe` and Program Files; macOS `/Applications/scmJS.app` via `open -a`; Linux
  `/opt/scmJS/…`; **WSL**: the Windows app, found through `cmd.exe /c echo %LOCALAPPDATA%` + `wslpath`, the file passed
  as a Windows path). Launched detached with the path (not through `spawnOwned`: it is meant to outlive us).
  `desktop/main.ts`'s `mapArg` takes `.rep` too, and `sendOpen` reads a replay without adding it to `MapFiles` (that
  allowlist is for maps the renderer may write). `useDesktopFiles` goes through `openGivenFiles`, which waits for
  `pluginsStartedAtom` and hands claimed files (a replay → Aftermath) to plugins.
- **Else a browser hand-over** (`handOver`): the command serves a random-token page on 127.0.0.1 (random port) and
  opens it in the default browser (`BROWSER=none` prints the address instead; WSL uses `cmd.exe /c start`). The page
  `window.open`s the editor with `?handoff=1` (a button if the popup is blocked). The editor posts `scmjs.ready` to its
  opener; the page answers **every** ready with `scmjs.open {files:[{name, bytes}]}`; the editor accepts it only from
  `window.opener` with a loopback origin (`http://127.0.0.1|localhost|[::1]:port`) or the editor's own origin (the play
  page's "Analyse in the Editor"), once, opens it like a drop (`openGivenFiles`), and posts `scmjs.taken`, which the
  page forwards to the command, which exits. The page also forwards every other `scmjs.*` message the opened page posts
  (`POST /<token>/message`, string fields only); `scmjs.taken` ends the wait.
- **Why this way round**: a hosted page fetching from localhost meets Chrome's local-network-access prompt and
  Safari's mixed-content block; a loopback page posting to the window it opened meets neither. **It depends on
  scmjs.dev sending no Cross-Origin-Opener-Policy header** (`window.opener` must survive).
- **Trap: React StrictMode runs the effect twice in dev.** The first run removed `?handoff` from the address and the
  second returned early, so nothing listened. `HANDOFF` is read once at module load, `handedOver` is module-level, and
  the page re-sends on each ready because the first listener is gone before it arrives.
- `map open <link>` / `replay open <link>` open the link itself in the browser (no download, no extra open counted).
- **The site's inbox** (`src/services/inbox.ts`, the second effect in `useOpenerHandoff`): the same hand-over without a
  second tab, for the site's own pages (the home page, its library, the play page). A dropped file is not a click, and
  a browser opens a tab only on one, so the opener's way cost the visitor a press. Pages of one origin share the
  browser's private file storage: the page writes the files to the folder `scmjs-inbox` (`meta.json` = `{ v, at,
  target, lobby?, files: [{ name }] }`, written last, the bytes beside it as `0`, `1`, …) and sends the tab to
  `/editor/?inbox=1`; the editor reads what is for `target: "editor"` and was left within ten minutes, empties the
  folder, takes `?inbox` out of the address and opens the files like a drop. The play page reads the same folder for
  `target: "play"`. Three hands on one format: the site's `open.js` writes, this and scm-sim's `web/inbox.ts` read (the
  play page also writes). `INBOX` is read once at module load and `inboxTaken` guards the effect, for the StrictMode
  reason above. Nothing outside the origin can write there, so there is no origin check to make. The opener's way stays:
  it is the only one a loopback page has, and the site falls back to it where the storage cannot be written.

## `map play`: a lobby from a map (`open.ts`)

- **The same hand-over, to the play page** (`playInLobby` → `handOver(…, { lobby: true })`): the page posts
  `scmjs.open {files, lobby: true}`; the play page's half (scm-sim `web/handoff.ts`) answers `scmjs.waiting {reason:
  "files" | "sign-in", message}`, `scmjs.invite {link, invite, name}` as soon as the game exists, `scmjs.error
  {message}`, then `scmjs.taken`. With `lobby`, the page keeps a problem on screen and a later Invite Players still
  sends `invite` + `taken`, so the command keeps waiting rather than exiting.
- `LobbyOutcome {link, invite, name, waited[], error}`; the command prints the link (`--qr` draws it), exits 1 with the
  page's error when no link came. Default page `PLAY_PAGE_URL` = scmjs.dev/play; `SCMJS_PLAY_URL` / hidden `--play` for
  a dev server. A five-minute wait (a sign-in and a game-files download may be on the way). **No `scmjs login`
  needed**: the page signs in itself. Under `--json` the hand-over's lines go to stderr; with `BROWSER=none` it says
  "Open <address> …" instead of "Opening …".
- **Testing a page by hand**: a page a script drives seats nobody without `setup` in its address
  (`?relay=http://localhost:8799&setup=`). When patching a served page's script by string replacement, check the
  replacement applied: a silent miss leaves the old page in, which looked like a protocol bug.

## A map linked to the editor (`link.ts`, `src/services/editorLink.ts`)

`scmjs map open --live <map>` and the MCP `editor_open` hand the map over as `map open` does and keep the loopback
page open as a relay, so the commands and tools work on the map the person sees.

- **The whole design is two hooks**: `readInput` asks `linkedRead(path)` first and `writeOutput` asks
  `linkedWrite(path, bytes)` first (`cli-shell.md`). So every command and tool that reads or writes a map works on a
  linked one with no code of its own: the map as the editor has it, unsaved changes included, and a changed map put
  back as **one undo step** (`applyDocumentAtom`, `clipboard.md` "Whole-document undo"). `--out` writes a file as
  always. `Input.live` / `Written.live` say which happened; `outName`, the MCP `written()`, `printEdits`, `printRun` and
  `printBuild` word it ("written to the editor, as one undo step").
- **Three parties.** The *owner* (`LinkOwner`) is the process that opened the link: an HTTP server on 127.0.0.1 and a
  line in `<cache>/links/<sha256(path)>.json` (`{ path, port, key, pid }`, mode 600). The *page* relays: the owner's
  requests come down an event stream (`/<token>/events`; a map's bytes fetched from `/<token>/blob/<id>`) and go to the
  editor by `postMessage`; the editor's answers and its own requests go up by POST (`/<token>/up`, a line of JSON then
  the bytes; the response is the answer). A *peer* is any other scmjs process: it finds the line by the file's path and
  POSTs `/rpc` with the key in a header. `linkFor` checks this process's own links, then the line, and drops a line
  whose owner no longer answers `alive`.
- **Why the page and not a socket from the editor**: the reasons under "Opening". The page holds a Web Lock so a
  background tab is not frozen, and says so when the link ends; its event stream closing (the tab closed) ends the link
  on the owner's side.
- **The editor's end** is loaded only when a hand-over carries `link: true` from a loopback origin (`await import`, so
  it is not in the startup chunk). The map opens with a `MapFileHandle` whose `createWritable` sends the bytes to the
  owner, so **File ▸ Save writes the file on disk with no download**; `getFile` asks for the file as it is on disk
  (previous versions). The handle is marked `TRANSIENT` (`diskFiles.ts`) and `storeHandle` refuses it: it is a channel,
  not something IndexedDB can keep. Requests: `read`, `apply { label, base }`, `state`, `show`, `picture`, `save`,
  `ping`, `gamedata`, `gamefile`; either side may send `ended`.
- **Scoped to the document that came through it.** Every request is answered for that map alone and only while it is
  in front (`behind` otherwise: the registers hold only the front map). So a local page that opens the editor and links
  a map gains nothing it did not hand over itself — which is why there is no consent prompt. Nothing is evaluated; the
  methods are the list above.
- **Stale writes are refused, not merged.** The editor counts commits to the linked map (`rev`, from
  `commitNoticeAtom` and the extras atom). `read` answers the count, the command remembers it per path and sends it
  back as `base`; a different count is `changed` ("The map changed in the editor while the command ran"). The MCP
  `tool()` wrapper runs the tool once more on `changed`; a terminal command says to run it again. A write with no read
  before it (`map new` over the file) carries no base and is taken as it is.
- **Holds**: `apply` waits up to 20 s while a stroke is under way or one of sync's `HOLDING_DIALOGS` is open, then
  `busy`. The owner waits 45 s for any answer.
- **Undo labels** (`setLinkLabel`): `scmjs map triggers import` from commander's `preAction` hook, and the same words
  from an MCP tool's name with its underscores as spaces.
- **An older editor** ignores `link`, opens a copy and answers a plain `scmjs.taken`; the page reports `linked: "old"`
  and the command says the editor cannot link yet. A refused open (the unsaved-changes gate) is `linked: "no"`. `--live`
  with a web link is refused.
- **The MCP tools**: `editor_open`, `editor_state` (layer, zoom, the view in tiles, selected units with type, player and
  pixels, locations, doodads, sprites, the marked area), `editor_show` (`viewApi.reveal` + `flashOnMap`, selects),
  `editor_picture` (`exportMapImage` with the editor's own game data, at most ~1,600 px on the long side),
  `editor_save`, `editor_close`. `path` may be left out when one map is linked (`allLinks`). **Addressing is `map
  edit`'s**: units by index from 0, locations by `number` from 1 (slot as `index`); `editor_show` resolves a location
  name or number with `locationIndex` on the map read through the link, so the editor is only ever told slots.
- **The editor lends its game data** (`gamedata`, `gamefile { path }`, the first methods that are not the map's): a
  command's plugin host needs a tileset and the unit tables to paint terrain or seed a unit's row, and on a linked map
  the right ones are the editor's — what the person sees, with no installation. `linkedGame(path)` asks `gamedata`
  (`kind`, `profile`, `name`, `hash`) and answers a `LentGame` whose `readStored(path)` is `gamefile`, each file asked
  once and kept as a promise. The same `LentGame` is answered while the stamp (`kind|profile|hash`) is the same, so
  `loadGameCopy` keeps what it decoded; a `reader` source with no hash is asked afresh every call. `headless.ts#GameCopy`
  has `readStored` because the editor's copy is an extraction (its `unit/manifest.json` among the paths). **Scope**: the
  editor answers only `GAME_FILE` paths (tileset tables and megatiles, the doodad table, `stat_txt.tbl`,
  `arr/*.dat|datex|txt|tbl`, `rez/*.tbl|txt`, `iscript.bin`, `tunit.pcx`, `unit/manifest.json`) — no GRP, sound or 2x
  file — and answers a **copy** of the bytes, because the reply transfers its buffer and a data set in memory would
  lose its own file. An editor without these methods answers `unknown`: "nothing to borrow", not an error. Through the
  relay, painting a 64 × 64 map with a lent tileset takes under a second; the files asked are the few MB the loaders
  need. (How the host uses it: `cli-map-edit.md`.)
- **Traps**: (1) **The event stream's headers do not leave Node until something is written**, so the owner writes a
  comment at once; without it a stand-in page using `fetch` waited for ever (a browser's `EventSource` did not care).
  (2) In the Playwright spec the pages' requests are routed through the test's own process (`context.route`), so the
  command must be run with `execFile`, **never `execFileSync`**: the blocking form deadlocks with "The editor did not
  answer". (3) The spec's init script also runs in the blank window the page opens first, where `localStorage` throws.
  (4) `e2e/link.spec.ts` passes over one page error by its exact text, `Failed to execute 'open' on 'Window': The
  provided callback is no longer runnable.`: Chromium reports it now and then from inside the link page's
  `window.open` while Playwright holds the new window at its first line; the call still returns the window and the
  link goes on. No browser without a debugger attached shows it.
- Tests: `tests/link.test.ts` (the owner, peers, the editor's end with a data set in memory, refusals, `linkedGame`
  over a stand-in page), `e2e/link.spec.ts` (builds the CLI first).

## TrigScript in a text editor: `scmjs lsp` (`lsp.ts`)

`scmjs lsp [--map <map|folder>]`: a Language Server Protocol server on stdio for TrigScript — diagnostics on
open/change (250 ms debounce)/save, completion (+ resolve for signature and docs), hover, definition, document symbols.
Hidden from the overview. On a TTY it is a CliError (exit 2); an end with no shutdown logs why on stderr.

- **The language lives in the plugin**: `plugins/trigscript/language.ts` (`ScriptLanguage`), a TypeScript
  `LanguageService` over the script laid out exactly as `compileScript` lays it out (`trigscript.d.ts` from the map's
  names, `__trigscript__/<module>` for the stdlib, `__libraries__/<id>/…`, `lib.d.ts` = the concatenated es2023 lib),
  with the compiler's options (`scriptCompilerOptions`), and `check()` = `compileScript(…, { sounds: false })`, so the
  errors *are* the build's. Plain data, 1-based, no fs, `ts` passed in. Monaco keeps its own worker-side service (its
  layout is `node_modules/trigscript/…`); moving the window onto `ScriptLanguage` is possible, not done. The CLI file is
  only the protocol and the file system.
- **Trap: `paths` without `baseUrl` and an empty current directory.** `compileScript`'s host says `""`; module
  resolution copes, but printing a type that names a library's module (a hover of `typeof import("waves/spawn")`) goes
  through `getLocalModuleSpecifier`, which computes `getPathsBasePath(...) || baseUrl` → `undefined` → a TypeError
  inside TypeScript. `language.ts` sets the internal `pathsBasePath: "."` on its copy of the options (`withBase`). The
  compiler itself is untouched; an error message that prints such a type could hit the same thing.
- **Which files are a script** (`scriptHomeOf`): the nearest folder above the file called `trigscript` is the script's
  root, as `map unpack` writes the archive's `trigscript\` members; its map is the parent when that is an unpacked map
  (`archive.json`, `staredit/scenario.chk`, or the text form's `scenario/sections.json`), else `--map`'s, else none (the
  fixed names). Without such a folder only `--map` makes a file a script. Anything else gets nothing, so a client can
  attach the server to all TypeScript. Files are read through the plugin's own `readFiles`/`readLibraries` over a
  synthetic member map, so the extensions and `@libraries\<id>\library.json` rules are the build's; open documents
  override disk. The map's names: `openMapBytes(scenario.chk)` (or `scenarioFromText`) + `mapNames` (build.ts) with the
  archive's member names from `archive.json`; re-read when the scenario's stamp changes. Location boxes go to the hover.
- **Definitions outside the script's files** (stdlib, `trigscript.d.ts`, `lib.d.ts`, a `--map` file's library copies)
  are written to `<tmpdir>/scmjs-lsp/<sha1(root)[:12]>/<virtual path>` and that file is answered; requests on those
  files are routed back to their script, so hover and definition work inside the stdlib. A library's copy in an
  unpacked map is answered as the real file under `trigscript/@libraries/`.
- **Protocol**: `vscode-languageserver` + `vscode-languageserver-textdocument`, bundled. **`createConnection` gets a
  `StreamMessageReader/Writer`, not the streams**: given streams, the library calls `process.exit` when they end, which
  would kill a vitest worker in the in-process test. The exit notification still exits; the command exits itself when
  stdin ends. Their licence files are `License.txt`, which `scripts/lib/notices.mjs` looks for. Console goes to stderr.
  One workspace per script root, made single-flight (an open and a request racing made two). English always
  (`setLocale("en")`).
- **Speed**: a check is a few hundred ms in the bundle; completion, hover and definition answer in a few ms.
- **Tests** (`tests/cli-lsp.test.ts`) speak LSP (Content-Length frames) in process over PassThrough pipes (on a
  text-unpacked map) and to the built `cli/dist/scmjs.mjs` over stdio (skipped when not built; the child is spawned
  **without `VITEST*`**). Both skip when the vendored plugin has no `language.ts`. Driven for real from Vim 9.1
  (`job_start` with `in_mode/out_mode: 'lsp'`); the guide's Neovim and Helix snippets and the plugin's VS Code extension
  have not been tried.
- **UX trap, documented**: VS Code's or `ts_ls`'s own TypeScript also checks these files without TrigScript's
  declarations and calls `program`, `units` … unknown. The guide says to set `typescript.validate.enable: false` for the
  maps folder, or keep `ts_ls` off it.

## Open

- The live link: the desktop app (`--live` always uses the browser; the app needs a channel from main to the renderer);
  a file changed on disk by something else (a git checkout) reaching the editor; the editor's own edits as events to
  the command; terminal commands for `state` / `show` / `picture`; a reload of the editor's tab re-linking; running a
  command's edit inside the editor (`cli-map-edit.md`).
- `lsp`: `map unpack` writing a `tsconfig.json` and the declarations into the folder so a plain TypeScript server
  agrees; Monaco on `ScriptLanguage`.
