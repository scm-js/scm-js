# The `scmjs` shell: program, errors, output, pipes, language, processes

What every command shares: how the program is put together, the exit codes, what goes to stdout and stderr, `-` for
the standard streams, the Korean, the processes and temporary folders a command owns, `doctor` and `about`. The entry
note is `cli.md`.

## The program (`cli/src/main.ts`)

- **Built in `buildProgram()`**, not at module load: the help's descriptions are made when the commands are defined,
  so the language must be chosen first. The module does `if (!VITEST) setLocale(chooseLocale(argv))`, then
  `export const program = buildProgram()`, and runs only `if (!process.env.VITEST)`. Tests therefore import the real
  program (English unless they `setLocale("ko")` and build their own). **A child process spawned from a test must be
  spawned without `VITEST*` in its environment**, or the built command reads it as "imported by a test" and does
  nothing (an LSP test hung on exactly that).
- **`run(args, prog)`** is exported; tests run whole commands in-process through it or through
  `program.parseAsync(args, { from: "user" })` with stdout/stderr spied (commander 15 resets option values between
  parses). `scmjs` with no arguments prints the overview (a request, not a mistake).
- **`ScmjsCommand extends Command`** (`createCommand` returns one, so every command is one): `error()` forces exit 2
  for everything commander raises (unknown option or command, missing argument, choices, excess arguments, a required
  option, an argParser's `InvalidArgumentError`); `help({ error: true })` — commander's answer to a noun alone or a
  global option alone — prints to stdout and exits 0; `unknownCommand()` suggests among all commands, hidden ones too
  (`similarNames`: commander's own `suggestSimilar` is not exported; Damerau–Levenshtein ≤ 2 edits, similarity > 0.4).
  Help and `--version` keep commander's exit 0.
- **`-v` only before a command**: `enablePositionalOptions()` on the program, inherited by every command made after
  it. `--lang` and `--no-color` would then be unknown after a command, so `finishProgram` gives every command hidden
  copies. Their values land in each action's `o` as `lang` / `color`: no action may pass `o` whole to something that
  reads a `color` or `lang` field (`watch.ts` has `color?`; `replay watch` passes its fields one by one). `chooseLocale`
  and picocolors read argv themselves, so commander only has to accept the options.
- **`finishProgram(program)`** runs after every command is defined and is the only code that walks other areas'
  commands: the hidden global options; `showHelpAfterError("(scmjs map info --help lists its options)")` per command
  ("its commands" for a noun without an action); a hidden `help [command...]` under every command that has
  subcommands and no action (the program's own `helpCommand(false)`; the path is walked, an unknown word exits 2);
  and the groups.
- **Groups.** `COMMAND_GROUPS` (main.ts) puts `map` and `mod` verbs under task headings, the guide's chapters.
  **commander orders groups by first appearance in `cmd.commands` (creation order)**, so `configureHelp` overrides
  `visibleCommands` (a stable sort by `GROUP_RANK`) and `groupItems`. `map.commands` itself is not reordered, so the
  overview's `map info|check|open|…` term and the completion scripts keep creation order. A `map` command in no group
  fails `tests/cli-program.test.ts`.
- **Terms.** `TERM_WIDTH` (28) caps a term in the overview, so a noun with many verbs shows `map info|check|open|…`
  and the description column stays beside it; a noun's own help uses `TERM_WIDTH + 2` (`subcommandTerm` checks
  `cmd.parent?.parent`), which keeps `triggers export|import|edit` whole. `subcommandTerm` shows a command's own usage
  when it has an action as well as subcommands (`test <map> [tests...]`).
- **Trap: an option declared on a command and its subcommand.** `map test` declares `--json/--frames/--starcraft/
  --engine`, and commander gives an option both declare to the parent wherever it is typed, so `map test record` never
  saw them. `typedOptions(cmd, local, keys)` reads the parent's value when its source is `cli` or `env` — not
  `default`, or the parent's 2,400 frames would leak into `record`.
- **A subcommand name shadows a file name**: `map test record` is a commander subcommand, so a map file literally
  named `record` is taken for it.
- **`--revision`, never `--version`**, on any command: commander answers the program's own `--version` wherever it
  appears (`map set --version` printed the package version).
- **Optional-value options swallow the next word.** `--baseline [file]`, `--clips [folder]`, `--play [player]` take
  the following argument if there is one, so each command checks what it got (a value ending `.scm|.scx|.chk` given to
  `--baseline` is pushed back into the maps; `--clips foo.json` is a tests file). A variadic option eats positionals
  outright: `--keep <member>` is repeatable rather than variadic for that reason.
- Commander pairs `--x` / `--no-x` (`--units` / `--no-units`, `--device` / `--no-device`) leave the value undefined
  unless one is given; test `!== false`, or use `undefined` as "decide for me".

## Exit codes and errors

- **0** done (a difference found by `map diff`, a loss in a bot game, nothing to write: still 0 unless the command's
  own rule says otherwise); **1** a failed check, a difference where that is the answer (`map diff`, `mod diff`, `map
  find` with no hit — diff(1) and grep's rules), an error during the work; **2** the command could not start (usage,
  a missing or wrong-kind file, a value refused, a session missing); **130/143/129** a signal (see "Processes and
  temporary folders"). The guide's "Exit codes" section holds the reader's version.
- **`CliError(message, hint, exitCode)`** (`ui.ts`) is how every module refuses; main.ts's `fail()` prints the message and the
  dim hint. In `run()`'s catch: a `CliError`; else `fileProblem(e)` — ENOENT/EISDIR/ENOTDIR/EACCES/EPERM/EEXIST/EROFS/
  EMFILE/ENFILE (also on `e.cause`) become one line with the path (relative when under cwd), exit 2; ENOSPC exit 1; the
  stack only under `SCMJS_DEBUG`; EPIPE → 0; `CommanderError` → its code; anything else "Something went wrong" + the
  stack + the issues link. **Trap:** `readFileSync(<folder>)` throws EISDIR with no `path` (the read is on a
  descriptor), hence wordings that do not need the path. The stdout/stderr `error` listener exits 0 on EPIPE.
- **Several files** (`eachFile`): a failing file's line goes to stderr in every mode, the rest go on, the exit code is
  the worst; no blank stdout line before a failed file, and no separator after a file that printed nothing.
- **Values are read before anything starts** (`values.ts`'s readers, used by `botRunValues`, `ladderValues` in botrun.ts, `watchValues` in watch.ts, …), so a
  bad option is exit 2 before a game, a download or a browser.
- **Rules the commands keep** (from an end-to-end audit, also in the guide): exit 2 for a command that cannot start;
  `--out` is always written on success, even when nothing changed (optimize writes the input's bytes when it cannot
  shrink them; prune, edit and `map run` likewise, piped too); a folder is never merged into (`map unpack`,
  `mod unpack|new`, `bot ladder` refuse an earlier run's folder unless `--force`, and refuse what is not theirs even
  with it); `--force` means overwrite, nothing else; a path in JSON is as the person typed it; progress goes to stderr.

## Output (`cli/src/ui.ts`)

- picocolors decides colour (`NO_COLOR`, `FORCE_COLOR`, `--no-color`, a pipe). Marks ✔ ✖ ▲ ℹ fall back to ASCII where
  `unicode` is false (the old Windows console). `rows()` aligns label/value pairs (`null` = a blank line, one width for
  all groups); `table()` pads by visible width. `gameText` turns StarCraft's colour bytes into 24-bit colour only when
  `COLORTERM` says truecolor, else drops them.
- **Widths are terminal columns, not `.length`.** `charWidth` binary-searches a sorted range table of East Asian
  Width W/F (Hangul, CJK, kana, full-width, emoji blocks) and zero-width marks (combining, ZWJ, variation selectors,
  conjoining jamo); `columns`, `padColumns`. `rows()`, `table()`, the banner's fit and commander's `displayWidth` all
  use it (the test map "Test Remastered 리마스터" misaligned a column before).
- **`--json` everywhere**: one object, or a list for several files; keys and naming values in English whatever the
  language. A command whose primary output is a map or picture on stdout refuses `--json` when piped (exit 2: both want
  the pipe).
- **Lines while working go to stderr** (`say`, `note` in main.ts; a runner's live lines; fetch lines), so stdout is the
  result alone: `map share … | head -1` is the link, `--json` is parseable, `--out -` is the bytes.

## Pipes and files (`files.ts`, `exchange.ts`)

- **Reading** (`readInput(path)`): `linkedRead(path)` first (a map linked to the editor, `cli-editor.md`), then a web
  address (`isWebAddress`: `^https?://`, so a file named `scmjs.dev/...` is still a file; `cli-account.md`), then `-`
  (all of stdin; empty → exit 2), then the file. A pipe has no name, so its kind is from the bytes alone: `kindOf("",
  bytes)` (MPQ magic, replay, `SCMBOT1`), else `looksLikeChk` (four bytes of `A-Z0-9 `: a section name) → map. The
  input is `{ path: "-", name: "stdin.scx" | "stdin.chk" | "stdin.rep" }`: **the name carries the form**, so the map
  can be written back as it came. `kindOf` calls every MPQ a map (so the mod commands do not use it to tell a map).
- **Writing** (`writeOutput(bytes, path, stdout?)`) is the one writer: `linkedWrite` first (one undo step in the
  editor), a web address refused ("Name a file to write with -o", exit 2 — so every command that writes back over its
  input refuses a link with no code of its own), `-` to the stream, else `writeFileMade` (makes the parent folder;
  `writeError` turns EISDIR/ENOTDIR/EEXIST/EACCES into one line, exit 2). `writeBack(doc, inputPath, out)`
  (exchange.ts) writes a changed map in place unless `--out`, with `defaultSaveOptions` — the editor's Save As rule
  (as-opened compression and encryption, StarEdit's layout for a bare `.chk`), extras and stored members carried; the
  format from `outputFormat` = the output's extension, else the input's, else `doc.fileName`'s, else scx when it came
  as an archive. `defaultSaveOptions` gets `doc.fileName` in place of `-`, so a bare chk keeps StarEdit's layout.
- **`toStdout`**: `out === "-"`, or no `out` and the input `-` — a filter writes where it read. `piping(input, o)`
  says whether the map takes stdout (not with `--dry-run`); then `say` sends the command's words to stderr and
  `outName` prints "standard output". `map set` and `map strings prune` always write when piped, changed or not: the
  next step needs a map. `map new -` skips the exists check and is named "Untitled Scenario"; `map unpack -` defaults
  its folder to `stdin`; text exports treat `--out -` as no `--out`.
- **What a link or a pipe changes elsewhere**: `besideInput(input)` is the path a neighbouring file is named from (the
  input, or its own name in the current folder for a link or a pipe; `replay map`, `replay export`, `replay_map`);
  `fileOnDisk(input)` writes the bytes to a temporary folder for a runner that reads by name.
- **`readTextArg`** reads a text argument or stdin for `-` (both imports). `MapReadError` carries `.reason`, so a
  caller words it without stripping an English prefix.

## The overview (`cli/src/banner.ts`)

- Only the root help (`scmjs`, `--help`, `help`) is ours: `configureHelp({ formatHelp })` sends `!cmd.parent` to
  `rootHelp` and everything else to commander's `Help.prototype.formatHelp`.
- **The globe** (`GLOBE`) is the app mark (favicon.svg / AppLogo.tsx, the splash's sphere) in braille, 16 × 8 cells:
  starfield.ts's `buildSphere(6, 8)` (the logo's own 12 segments are a blur at this size), rotY 0.3, rotX −0.45, near
  half plus the outline, rasterised to 32 × 32 dots by a throwaway script and pasted as a literal. Blank cells are
  spaces, not U+2800. #a06cf0 with truecolor, else magenta. `GLOBE_ASCII` (hand-drawn, `=` for the bright equator)
  where `unicode` is false; with the text wider than the terminal the globe is left out.
- **The root help is held to 23 lines in both languages**, so a 24-row terminal keeps the globe on screen and a line
  for the prompt (`tests/cli.test.ts`); ≤ 80 columns by `columns()`. The groups have no blank line between them nor
  before Options; options are one line; there are no Examples (the guide has them).
- **A new top-level row needs a line freed.** First rule: a one-line description (commander wraps a long one onto a
  second row, which the count sees; at the default width a description has ~47 columns). Hidden is the fallback:
  `about`, `completion`, `init`, `login`, `logout`, `lsp` and `help` are `{ hidden: true }` and named dimly on the last
  group's heading line (`This tool:   also about, completion, …`) only when that fits 80 columns — in Korean it never
  fits, so they are simply absent there. The user's rule for when the overview is full: group commands under a noun
  and point to `scmjs <noun> --help` rather than hide more. Hidden commands are still in the completion scripts and
  in the guide.

## Completion (`cli/src/completion.ts`)

- `completion bash|zsh|fish`: `commandTree(program)` walks commander and three generators write the scripts, so a new
  command or option is in them with no list. The tree keeps hidden commands (`help` only at the top), adds `--lang`
  (choices) and `--help` to every node, and per option `value: none|file|word` (`PATHLIKE` on the `<name>` in the
  flags: file, folder, map, path, png, replay…; an optional `[value]` counts as a flag so `--baseline a.scx` does not
  swallow the map) and `choices` from commander's `argChoices`; arguments from `registeredArguments`.
- bash: lookup functions (`_scmjs_children/options/value/args`) and a walk that skips an option's value, counts
  positionals, and offers value choices → options on `-` → subcommands (+ files when the node runs) → the argument's
  choices or files → options. Tested by sourcing the script in bash with `COMP_WORDS` (`tests/cli-completion.test.ts`).
  fish: `__scmjs_path` walks `commandline -opc` the same way, every rule `-n '__scmjs_at map check'`. zsh:
  `:value:(a b)` / `:value:_files` / `:value: `. **zsh and fish scripts have never been run** (neither shell on the
  development machine).
- Only options with real `.choices()` complete their values (`--lang`, `account login --provider`, `map share|share
  --keep`, `map test --clips-format`, `completion <shell>`). The rest list their values in prose and complete nothing
  (see Open).

## The command line in Korean (`cli/src/i18n.ts`, `commanderText.ts`, `ko.json`)

- **Choosing** (`chooseLocale(args, env, system)`): `--lang ko|en` / `--lang=ko` anywhere before `--`, else
  `SCMJS_LANG`, else the first set of `LC_ALL`, `LC_MESSAGES`, `LANG` (Korean when it starts with `ko`; `C` is English
  — a set POSIX locale decides and the system is not asked), else `Intl.DateTimeFormat().resolvedOptions().locale`
  (Windows has no `LANG`), else English. Read from argv, not commander, because the help is made when the program is
  built. `--lang` is also a real option with choices, so commander refuses `--lang fr`; `SCMJS_LANG=fr` gets one ▲
  line on stderr (`unknownLanguage`), and English.
- **No `t()` at module scope** still holds: every module is evaluated before `buildProgram()` sets the language.
- **The catalogue is separate**: `cli/src/ko.json`, a second tree of `npm run i18n` (`scripts/i18n.mjs` `TREES`;
  `tests/i18n.test.ts` checks both). Not the editor's: the app's catalogue would have grown by the CLI's whole size for
  strings the app never shows, and the bundle would carry the editor's UI. `cli/src/i18n.ts` exports `t`/`msg`/
  `translate` (its catalogue, then the editor's `translate`, so a finding's `where`, tileset and game names come out
  translated), `inEnglish`, `locale`/`setLocale`. It is the one CLI module allowed to import `src/i18n`
  (`tests/core.test.ts` `I18N_EXCEPTION`), since core does not export the translator.
- **The bundle carries the editor's entries its modules ask for**: the leave-out plugin loads a placeholder and
  `renderChunk` replaces it with `editorCatalogueFor(chunk.moduleIds)` (`scripts/lib/cli-bundle.mjs`). It is about a
  third of the editor's catalogue, not less, because the plugin host and atoms pull UI modules in.
- **The line drawn.** Translated: help, descriptions, printed reports, `CliError`s and hints, human sentences inside
  `--json` (a finding's text, a hint, optimize's step labels). English: `--json` keys and naming values (levels, kinds,
  version and tileset labels, game types), every file a command writes (dump, baseline, tests files, init's files and
  `--print`, the plugin starter, ladder.json's labels, mod folders), map text, the trigger text form and the
  dump/unpack formats (so `git diff` reads the same everywhere), text sent to servers, loopback pages, CI formats' rule
  ids and level words (their messages follow the language), the trigger vocabulary inside messages (condition names,
  "always"/"nothing"), debug lines, internal `Error`s. **`scmjs mcp` and `scmjs lsp` call `setLocale("en")`** in their
  actions: the tools are read by a model, and the LSP carries the compiler's English diagnostics (their `--help` is
  still translated).
- **Baselines are matched in English**: `findingId` parses English ("Trigger 2:", counts) and the file is shared
  between computers, so `map check` with a baseline validates a second time `inEnglish`, matches those, and shows the
  same-index findings in the reader's language. Written entries are English.
- **commander's own words** (`commanderText.ts`): titles through `styleTitle` → `translate` ("Usage:", "Options:",
  "Arguments:", "Commands:", "Global Options:"), `(default: …)`/choices/preset/env through `optionDescription` /
  `argumentDescription`, errors through `outputError` matched by regex (unknown option/command, missing argument, option
  needs a value, too many arguments, invalid choice, conflicting options, "Did you mean"). The usage line's
  `[options]` / `[command]` stay (syntax), as does any commander message the regexes do not know.
- Multi-line Korean help texts are broken by hand at ≤ 80 columns. A local named `t` shadows the translator: such
  locals were renamed, keep it that way. A particle after a value is written `{value|은}` so it follows the value's
  last sound. Terms are kept apart: `changed`/`removed` are 변경/삭제, not 변경됨/제거됨 (which mixed with "이름 변경").
- `mod check` findings and `mod diff` lines stay English: `src/formats/mod/{check,diff}.ts` make them, the editor does
  not show them so they are not in its catalogue, and the CLI's catalogue reads `cli/src` only. Translating them means
  moving their words into `cli/src` or a third tree.

## Processes and temporary folders (`cli/src/lifecycle.ts`)

Runners must not outlive scmjs however it dies (`| head`'s EPIPE → `process.exit`, `kill -TERM` from a supervisor,
`timeout`), a ladder's seat processes with them, and no temp folder may stay behind.

- **`spawnOwned(cmd, args, opts)`** spawns with `detached: true` on POSIX, so the child leads its own process group,
  and the group is killed (`process.kill(-pid)`), which takes the match runner's seats and Chromium's renderers. When a
  leader exits, its group gets SIGKILL at once (a seat left by a match that ended badly). Every runner
  (`engine.ts#startRunner`) and the browser (`browser.ts`) go through it; not the text editor (interactive, on the
  terminal), not `open.ts` (meant to outlive us), not `spawnSync` calls (ffmpeg, git: they block the loop, so a signal
  waits for them).
- **`tempFolder(prefix, { untilStopped? })`** = `mkdtempSync` + removal at exit; `removeFolder`; `madeFolder` for an
  `--out` folder the run created (balance), removed only on a signal; `atExit(undo)` for terminal state (watch's
  cursor, registered only when stdout is a TTY). `untilStopped` is for folders kept on purpose (the text editor's,
  kept after a failed import).
- Armed lazily, at the first registration. `process.on("exit")` runs `finish`: undo hooks, SIGTERM to every live
  group, a 150 ms `Atomics.wait`, SIGKILL, then `rmSync` with retries. Synchronous, so it also runs for the EPIPE
  handler's `process.exit` and for an uncaught exception.
- **SIGINT/SIGTERM/SIGHUP are answered only when ours is the sole listener** (`process.listenerCount(sig) > 1` → leave
  it): the text editor ignores SIGINT while the editor runs, `plugin dev`, `replay sync --watch` and `login --device`
  have their own. Then `finish(true)`, raw mode off if stdin was raw (a default-disposition death skips Node's tty
  reset), "▲ Stopped." on stderr when a child was alive, listeners removed and the signal raised again so a shell sees
  a signal death (130/143/129); `process.exit(128+n)` if it did not take.
- SIGKILL of scmjs cannot be answered: the children then run on (detached groups do not get the terminal's signal).
- `tests/cli-lifecycle.test.ts` bundles `tests/support/lifecycleDriver.ts` with rolldown and signals it — the only way
  to test signal handling without the engine. **Kill only pids the test recorded**: a failing run once left `node -e
  setInterval` grandchildren behind.
- `vitest.config.ts` `globalSetup: tests/support/tmpdir.ts` points TMPDIR/TMP/TEMP at one `scmjs-tests-*` folder for
  the run (workers and their children inherit it) and removes it at the end. (`node-compile-cache/` in TMPDIR is
  Node's.)

## `doctor` and `about` (`doctor.ts`, `about.ts`)

- **`doctor`**: `Check { what, state ok|warn|bad, detail, fix?, note?, path? }` for Node (≥ `NODE_MIN` 22.12, the
  only `bad`; never bad in the single executable), scmjs against npm, TypeScript (`findTypeScript`), Docker
  (`dockerVersion`, else `docker --version` for installed-not-running), the desktop app, Claude Code (`mcpCheck`),
  scmjs.dev (`scmjsDevCheck`), the browser (`browserStarts`), StarCraft (`findGameCopy`), the game engine
  (`engineCheck`). Exit 1 only on `bad`. Modelled on `scripts/doctor.mjs`.
- **The Ready table** (`READY`, `readiness(checks)`): command groups → needs, read off the checks by `what` — no probe
  of its own. Node `bad` blocks everything; a check absent from the list blocks nothing (tests hand partial lists); an
  engine never fetched blocks nothing (the first run fetches it); a fetched build lacking a runner kind blocks that
  kind's commands. The copy of the game is named before the runner (the person must supply it; the runner comes by
  itself). A new runner kind in `RUNNERS` needs only a name in `RUNNER_COMMANDS`.
- **Engine check** (`engineCheck(cache, at = SCMJS_PLAY_URL)`): a folder in `SCMJS_PLAY_URL` is read as `--engine`
  would read it; otherwise the **newest build folder by mtime** under `<cache>/engine/` (there is no local "current":
  `ensureEngine` asks the page each run, and writing a file touches its folder). `runnersIn(dir)` matches files against
  `RUNNERS[kind].file`. A build lacking a runner is `warn` with "`scmjs replay watch <replay>` fetches them once the
  play page has them" — not "fetches the newest build", since the page itself may not have the runner yet. **doctor
  cannot tell a runner's modes apart** (rush, test, `--play`, `--events` are modes of the map and replay runners), so it
  says nothing of them; the command finds an older runner and says so.
- **Browser** (`browserStarts(path)`): `<browser> --version`, 5 s; not on Windows or for a `.exe`, where it may open
  a window. Found but not starting is `warn` "does not start" with its first stderr line, and blocks `replay export`
  and `map test --clips`. (Playwright's Chromium on a machine without libnspr4/libnss3 is exactly this case.)
- **Claude Code** (`mcpCheck(config = ~/.claude.json, cwd)`): `mcpServers` at the top, then `projects[cwd]`, then any
  other project's; an entry counts when one of `[command, ...args]` matches `@scm-js/cli|scmjs` and another is exactly
  `mcp`. Always `ok`; the fix `mcpAddLine(install)` when not registered (`claude mcp add scmjs -- npx -y @scm-js/cli
  mcp` for npm; for the single executable the package manager's `scmjs`, else the executable's own path, quoted —
  Scoop's/Homebrew's versioned folders would break a path on update). A missing or unparsable file is a dim "Claude
  Code not found". Nothing else in the file is read. The project-scoped `.mcp.json` is not looked at.
- **scmjs.dev** (`scmjsDevCheck(file, server, headless)`): reads the session file only — "signed in as Ann" or a dim
  "not signed in" with `scmjs login` (`--device` when there is no local browser). `ok` either way.
- **The look**: Node and scmjs are the title line when fine (`scmjs 0.x · the newest · Node v24 · linux x64`), rows
  only when not. Rows in two groups, Tools and The game: mark, bold name, a short `valueOf`, the path dimmed by
  `shortPath` (home → `~`, cut from the left to fit). Fine-but-absent gets a dim `·`, not a tick; notes and fixes only
  under a row that is not ok; the summary is one line when all is ready, else `Not ready` and a line per group.
  `doctorJson` turns the dim-dot state into `state: "absent"` and names `MCP` "Claude Code"; `Check.state` itself is
  unchanged because `readiness` reads it. `doctorReport`/`doctorJson`/`printDoctor` keep their shapes: the MCP
  `doctor` tool calls them.
- **`about`** asks `registry.npmjs.org/@scm-js/cli/latest` (2 s timeout) and shows **Newest**: the update line
  (`updateCommand(install)`: npm's, `scoop update scmjs`, `winget upgrade scm-js.scmjs`, `brew upgrade scmjs`, or the
  releases page) when this is older (`olderThan`, numeric x.y.z), "this one", "<v> on npm" for a build from a clone, or
  "could not ask npm". **Only `about` and `doctor` ask**, so no command is slowed or nags. `install: { kind, manager,
  path, update }` in the JSON; the manager is read off the executable's path (`managerOf`). npm is asked for both kinds
  of install: they are released together with one version.

## Open

- Real `.choices()` for the options that list values in prose: `map check|coverage|test --format`, `map optimize|pack
  --compression`, `map preview|diff --scale`, `map new --tileset|--layout|--revision`, `map set
  --revision|--encoding`, `map resize --anchor`, `map generate --symmetry|--style` (they complete nothing today).
- `--lang` is offered by completion, but no script has been tried in zsh or fish.
- The Korean is Claude's, not a native speaker's: review through `npm run i18n -- --export ko` (the CSV holds both
  trees). A few English fragments remain inside Korean sentences by decision (trigger vocabulary, web-page button
  labels such as "Invite Players", "My Maps").
- The editor catalogue carried in the bundle would shrink if the plugin host stopped pulling UI modules in.
- `expectKind`'s hint for a file of the wrong kind is always "Try: scmjs info …" (`files.ts`), so `replay share
  <map>` is pointed at `info` rather than at `map share`.
