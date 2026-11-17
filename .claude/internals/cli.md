# The `scmjs` command line

`cli/` is the npm package **`@scm-js/cli`**; its command is `scmjs` (or `npx @scm-js/cli …`, or a single executable
from the GitHub release). It is the editor's own code run under Node: the same map reader, Check Map, trigger text
form, plugin host and save rules, plus the lifted game for the commands that play a map. The shape is the user's: one
command, a noun for each kind of thing, "an impressive UX tool … not overly engineered". The reader's guide is
`docs/cli.md`; the AI tools have their own guide, `docs/ai-tools.md`.

This note is the entry: what holds for every command, where the commands are, and which note to read for each area.

## The commands

The program is built in `cli/src/main.ts` (`buildProgram()`), which only calls one `add…Commands(program)` per command
family (`infocmd.ts`, `mapcmd.ts`, `mapchangecmd.ts`, `gamecmd.ts`, `mapgitcmd.ts`, `sharecmd.ts`, `replaycmd.ts`,
`modcmd.ts`, `plugincmd.ts`, `accountcmd.ts`, `toolcmd.ts`, `librarycmd.ts`). **`scmjs --help` and
each noun's `--help` are the list**, and `COMMAND_GROUPS` (main.ts) orders `map` and `mod` verbs under the guide's task
headings. Today:

- **Top level**: `info`, `share`, `doctor`, `mcp`; nouns `map`, `replay`, `library`, `mod`, `plugin`, `bot`, `account`.
  Hidden (in completion and the guide, named dimly on the overview when it fits): `about`, `completion`, `init`,
  `login`, `logout`, `lsp`, `help`.
- **`map`**: looking inside (`info check dump find preview sounds analyze`), making (`new generate fetch`), changing
  (`set settings resize units locations terrain doodads edit triggers strings optimize unpack pack build run`), git
  (`diff log blame merge`), in the game (`trace cost test coverage rush balance heatmap`), sharing (`open play share`).
- **`replay`**: `info map share sync open watch export`. **`library`**: `maps replays shared get rm unlink rename note`.
  **`mod`**: `info check diff new unpack pack build play test header`. **`plugin`**: `new check dev`. **`bot`**: `new
  init build update run ladder`. **`account`**: `show login logout`.
- **MCP tools**: the names `createMcpServer()` returns (`cli-mcp.md`).

## What holds for every command

- **The editor's code, not a copy, through `@scm-js/core`'s surface.** `tests/core.test.ts` refuses an import from
  `src/` in `cli/src/**` that `core/src/index.ts` does not export from that module, so a new need is a core export first
  (`core.md`). Exceptions: `i18n.ts` → `src/i18n`, `run.ts` → `src/plugins/headless.ts`.
- **Modules return data; only the wiring (`main.ts` and the `*cmd.ts` files) prints.** The MCP server calls the same functions and its stdout is the protocol,
  so a module that printed would corrupt it. `print*` functions make lines; `say`/`note` send working lines to stderr.
- **Exit codes**: 0 done, 1 a failed check or an error during the work, 2 could not start (usage, a missing or wrong
  file, a value refused), 128+n a signal. A loss in a bot game, or nothing to write, is not a failure.
- **`--json` everywhere**, keys in English; **`-` for standard input and output**; **links and a live editor** go
  through the same two functions (`readInput`, `writeOutput`), so every command gets them free.
- **Every printed word through `t()`** from `cli/src/i18n.ts` (English or Korean); files written, map text and
  `--json` keys stay English. `scmjs mcp` and `scmjs lsp` speak English.
- **Children and temp folders end with the command** (`lifecycle.ts`): runners and browsers in their own process group,
  temp folders removed at exit, signals re-raised.
- **The game is the person's own copy**, found or named; the engine is fetched from the play page. Nothing that needs
  it runs in CI, and every such test runs against stand-in runners.
- **The network only when the command is about it**: `about` and `doctor` ask npm (2 s); the game commands fetch the
  engine; `map fetch` asks scmscx.com; the account commands and links-as-input reach scmjs.dev's server; `replay
  export` mirrors the play page; `map build` may fetch the plugin's Vorbis encoder from jsDelivr; `bot update` pulls an
  image. No command checks for updates on its own.
- **The root help is 23 lines** in both languages (`tests/cli.test.ts`): a new top-level row needs one freed
  (`cli-shell.md` "The overview").

## Where the details are

| Working on | Read |
| --- | --- |
| `main.ts`'s program, help, completion, exit codes, `ui.ts`, `files.ts`, pipes, `i18n.ts`/`commanderText.ts`/`ko.json`, `lifecycle.ts`, `doctor.ts`, `about.ts`, `values.ts` | `cli-shell.md` |
| `map info|check|dump|find|new|set|resize|strings prune`, triggers/strings text and `edit`, `sounds`, `unpack|pack`, `optimize`, `build`, `fetch` (`map.ts`, `report.ts`, `baseline.ts`, `dump.ts`, `find.ts`, `create.ts`, `edit.ts`, `exchange.ts`, `texteditor.ts`, `sounds.ts`, `archive.ts`, `optimize.ts`, `build.ts`, `scmscx.ts`, `fetch.ts`) | `cli-maps.md` |
| `map run|edit|units|locations|terrain|doodads|settings`, `map set --settings`, the plugin host under Node (`run.ts`, `mapedit.ts`, `objects.ts`, `terrain.ts`, `settings.ts`) | `cli-map-edit.md` |
| `map preview|generate|analyze`, `map diff --picture`, the copy's files (`preview.ts`, `paint.ts`, `png.ts`, `gamefiles.ts`, `diffpicture.ts`, `generate.ts`, `generatecmd.ts`, `bases.ts`, `analyze.ts`, `walk.ts`) | `cli-map-pictures.md` |
| `map diff|log|blame|merge`, `scmjs init`, `map unpack --text` (`diff.ts`, `history.ts`, `maplog.ts`, `blame.ts`, `merge.ts`, `init.ts`, `source.ts`) | `cli-git.md` |
| The engine and its runners, `map trace|cost|rush|test|coverage|heatmap|balance` (`engine.ts`, `trace.ts`, `weigh.ts`, `rush.ts`, `maptest.ts`, `clips.ts`, `coverage.ts`, `heat.ts`, `heatmap.ts`, `balance.ts`, `runnerwords.ts`) | `cli-game.md` |
| `plugin new|check|dev`, `bot …` (`plugin.ts`, `bot.ts`, `botrun.ts`, `ladder.ts`), the `@scm-js/bot` types (`bot/`, `scripts/build-bot-types.mjs`) | `cli-bots-plugins.md` |
| `replay info|map|watch|export`, a replay's mod, the `mod` commands' CLI side (`replay.ts`, `replaymap.ts`, `watch.ts`, `export.ts`, `browser.ts`, `camera.ts`, `gif.ts`, `replaymod.ts`, `cli/src/mod/`) — the mod design itself is `mods.md` | `cli-replays-mods.md` |
| `scmjs mcp` (`mcp.ts`) | `cli-mcp.md` |
| `map open|play`, `replay open`, the live link, the site's inbox, `scmjs lsp` (`open.ts`, `link.ts`, `lsp.ts`, `src/services/editorLink.ts`, `src/services/inbox.ts`, `useOpenerHandoff`) | `cli-editor.md` |
| `login`, `account`, `map|replay share`, `scmjs share`, `library`, links as input, `replay sync`, `--copy`, `--qr` (`account.ts`, `share.ts`, `replayshare.ts`, `sharefiles.ts`, `clipboard.ts`, `qr.ts`, `library.ts`, `librarycmd.ts`, `weblink.ts`, `replaysync.ts`) | `cli-account.md` |
| The npm bundle, publishing, single executables, package managers, the GitHub Action (`scripts/build-cli.mjs`, `scripts/lib/cli-bundle.mjs`, `runtime.ts`, `sea.ts`, `scripts/build-cli-binary.mjs`, `packaging/`, `action/`) | `cli-distribution.md` |

## The reader's guide (`docs/cli.md`)

- **Organised by task**: Getting started (install, a first look, the cheat sheet, how help works), Your setup, Looking
  inside a map, Making a map, Changing a map, Maps in git, Triggers in the game, Melee maps: layout and balance,
  Replays, Mods, Sharing from the terminal, Bots, AI tools (a pointer to `docs/ai-tools.md`), For developers, Command
  reference, In the source. Old page addresses are forwarded by `MOVED` in `scripts/lib/docs/site.mjs`; when a section
  moves, its `###` slug stays so every `#fragment` still lands.
- **A new command** gets a `###` on the page of its task, a row in the Command reference, a line in the cheat sheet
  when people will reach for it, and a group in `COMMAND_GROUPS`. A new MCP tool gets a row in `docs/ai-tools.md`'s table.
- **A command's section** is: what it is for, an example with real output, an options table, then the edge cases.
  **Examples are run, not written** (the Mods chapter's come from a demo mod made with `mod new --tables` and one value
  changed; the AI tools guide's calls are the built `scmjs mcp` driven over stdio). Pictures (`docs/images/cli-*.webp`)
  are made by `scripts/cli-screenshots.mjs` (`docs-site.md`); re-run it when a command's output changes, with
  `--play-url` at a staged scm-sim deploy when the live play page lacks the newest runner.
- **The Mods chapter is the commands; `docs/mods.md` is the subject** (the play page's hand-over and the mod hash are
  told there, once).
- **Wording**: say who tells whom ("the command tells you", "is reported", "is an error"), never "X is said". An
  option's old name is mentioned only in "Renamed options" under For developers. No notes on what an earlier version of
  the guide said.

## Open

- The guide: a sample of the strings file in place of its description; real output for `plugin check`, `strings
  prune`, `replay share`, `account`; the long paragraphs in Bots; the In the source table (over 90 rows).
- `docs/images/cli-overview.webp` may predate `init` being hidden and `share`/`library` taking rows: compare it with
  `scmjs --help` and re-run `scripts/cli-screenshots.mjs` when they differ.
- Each area's own open work is at the end of its note.
