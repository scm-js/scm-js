# `scmjs replay` and the command line's side of mods

Replays: `replay info|map|watch|export` (sharing, `replay share` and `replay sync`, are `cli-account.md`; `replay
open` is `cli-editor.md`; a replay's game for triggers is `map trace --replay`, `cli-game.md`). Mods: what the `mod`
commands and the `--mod` options do on the command line's side. **The mod design, its proofs, the hash rule and the
traps are `mods.md`**; this note does not repeat them.

## Reading a replay: `replay info` (`replay.ts`)

- Replays are read by **`@scm-js/replay`** (github.com/scm-js/replay), extracted from Aftermath so the CLI and Aftermath
  share one reader (scm-sim keeps its own `src/replay/`, which feeds the exact engine). A devDependency, bundled into
  the CLI; the editor app does not import it.
- **APM is Aftermath's rule** (`analysis.ts`: no system, chat or leave commands; counted until the player left), so the
  two agree to the unit.
- Player names are coloured by the replay's colours; a race beyond the game's three is named by `replayRaceName` (see
  "Races a mod adds").
- `replay info` of a tagged replay: a `Mod` row (name · hash · link) and a `Plugins` row from the tag ("none"
  without). `--builds` (per player, each unit/building/upgrade/tech ordered: first frame, order count, one's cost —
  **orders, not outcomes**: a Probe ×186 is spam) and `--mod <mod>` (names and costs through `openMod` →
  `loadModData` → `namesOf`, the mod's tables over the person's copy). Vanilla names are the editor's `gameUnitName`
  (translated); costs from the copy's tables when one is found. **A tagged replay with no `--mod` shows ids, never the
  game's names**: they would be wrong. MCP `replay_info` takes `builds`, `mod`, `starcraft`; warnings go into the text.

## `replay map` (`replaymap.ts`)

`rep.chk` (what `@scm-js/replay` parses out of the replay — the game's own copy of the scenario) written **as it is**:
no parse or re-encode, `writeArchiveBytes(chk, {pkware, encrypt, listfile})` (a fresh map's save rule) or bare for
`.chk`; parsed only to name and measure it. Default `<replay>.scx` beside it (`besideInput`); an existing file → exit 2
unless `--force`; a non-map extension refused (`checkMapOut`); the folder made; `--out -` through `writeOutput`. **A
replay holds no archive members** (no sounds), so a map whose triggers play a WAV checks with a "not in the archive"
warning (in the guide). A map can pad its STR, so the bare chk can be far bigger than the archive. MCP `replay_map`
takes `out` and `force`.

## `replay watch`: a replay in the terminal (`watch.ts`)

- **The engine's half is scm-sim's replay runner** (`src/exact/runReplay.ts`): `applyInputs({ replay })` +
  `runStart({})` as the play page does, `ExactReplayEngine` + `ReplayWatch`. JSON lines: `start` (map, frames, players,
  copy, **terrain** = a character a tile from the game's tile flags, `0` unwalkable / `1` low / `2` middle / `3` high),
  `frame` (per player minerals, gas, supply, units alive; `units` = x, y, owner, class 0 other/1 worker/2 army/3
  building/4 resource, visible units only, subunits skipped), `end`. **Paced by standard input**: with no `--every`,
  each line read is a number of frames to step before the next `frame`, so the terminal asks for exactly what the next
  picture needs and the game never runs ahead (Linux pipes would block a free runner anyway, Windows pipes would not).
  The runner plays ~3,700 frames a second with no snapshot.
- **Who left and who won**: the runner reads the game's player records after every frame and adds `left` (per player,
  the frame they left or null) to each `frame` line **once someone has left** (absent before, so lines stay as they
  were), and to `end` always, with `outcomes` and `by` ("victory" when anyone's outcome is a victory, "replay" when the
  replay ran out, null when stopped). Fields, not event lines: the picture wants the state at a frame, and an older CLI
  ignores unknown fields. **The CLI takes both kinds of runner**: `view()` uses the frame's `left[k]`, else
  `Tally.leftBy()` (the replay's own leave commands, the same frame), so an older engine shows the leave too; only the
  winner needs the newer runner.
- **The picture** (`fitPicture`, `drawMinimap`): the map's shape, ≤ 2 dots a tile, within the terminal less the lines
  around it. Dots at `floor(tile × scale)`, a 2 × 2 block for a building when scale ≥ 1; owners weighed per cell
  (building 3, army 2, worker 1, resources 0.5 in their own bucket) and the cell coloured by the heaviest — 24-bit via the
  replay's colour where `COLORTERM` says so, else the nearest of xterm's sixteen; resources grey; **the ground as a
  background shade** by level (truecolor only). Empty cells are spaces, not U+2800. ASCII where `unicode` is false.
  `pictureLines` is always the same height, so the redraw (`\x1b[nA` + `\x1b[2K` a line) lands; the cursor is hidden
  while drawing and shown again at exit (`atExit`). Keys in raw mode: q/Esc/Ctrl-C stop, space pauses, +/- double/halve
  the speed (0.25–64). 12 pictures a second, `round(24 × speed / 12)` frames a step. Chat by `player` id and APM come
  from the replay itself (`Tally`).
- **Not a TTY**: a summary line at each minute of the game clock. The runner is asked `--every 12` (half a second) and
  the first frame whose clock reads the next whole minute is printed — **24 frames is 1.008 s**, so stepping by 1,440
  drifted (1:00, 2:01, 3:01 …). `--every 0` asks the runner past the replay's end. `--json` gives the runner's lines
  with the sides joined in. The start line's map name is the replay's `header.mapName` (the runner gives the file's);
  the end's reason goes through `plainReason`. `--from` past the end is refused. **Two frame counts can share a
  clock** (1,990 and 2,000 frames are both "1:24"): tests that tell events apart by the clock must keep them further
  apart.
- A link or a pipe is written to a temp file first (`fileOnDisk`): the runner reads by name. `--cells` (hidden old name
  `--size`).

## `replay export`: a replay as a clip (`export.ts`, `browser.ts`, `camera.ts`, `gif.ts`)

`--out x.webm|.mp4|.gif`, `--from/--to`, `--follow <player>|--at x,y|--whole-map` (hidden `--all`), `--speed`,
`--resolution` (hidden `--size`), `--fps`, `--browser`; hidden `--play <url>` (`SCMJS_PLAY_URL`). An older play page
answers ready without `record` and the command says so.

- **Who draws: the play page's own replay viewer** (`/play/?view`), not a renderer of ours. The command serves on
  127.0.0.1: `/play/…` mirrored from the play page's address (assets and bots under `<cache>/page/<host>/`, engine files
  in `<cache>/engine/<build>/` — the folder `ensureEngine` fills, so the download is shared with `replay watch`;
  `index.html` and `current.json` asked each time, the last page kept for offline), `/<token>/` the framing page,
  `job`, `track`, `replay`, and `files/<path>` = the person's copy through `gamefiles.ts` (`servedGamePath`: classic
  names only — `hd2/`, `anim/`, `*.hd.*`, `.dds` refused, so the page draws SD). The page reads them as a GameSource of
  kind `served` (same origin only). **Same origin is why the framing page is ours**: the viewer only listens to a
  same-origin parent.
- **A browser, no Playwright**: `findBrowser` looks at `--browser`/`SCMJS_BROWSER`, Chrome/Chromium/Edge/Brave on
  PATH, the installers' places, then Playwright's `chromium-*` cache (newest; headless_shell skipped). Started
  `--headless --remote-debugging-pipe` with a temp profile; CDP is NUL-framed JSON on fds 3/4 (`NulSplitter`, `Cdp`),
  used only for creating and attaching the target, page exceptions (into the error's hint; `SCMJS_DEBUG=1` prints
  console, host news and served paths), crashes and closing. Everything else goes page → framing page → `fetch` POST to
  the command, which is simpler than evaluating over CDP and carries large bodies. The browser runs in its own process
  group (`spawnOwned`), so its renderers die with the command.
- **WebCodecs, not MediaRecorder or screencast**: both of those run on the wall clock, so a slow picture is dropped or
  stretched and a clip cannot be made faster than real time. The page steps the game to each picture's frame (the
  worker's own forward `seek`; picture i shows frame `from + i·1000·speed/(fps·42)`, the camera read at the fractional
  frame), draws on a canvas sized to the clip (whole-number scale unsmoothed), and hands `VideoFrame`s to a
  `VideoEncoder` (VP9, VP8 fallback, a key frame every 2 s, queue ≤ 4). The chunks are muxed in the page (scm-sim
  `web/webm.ts`). Exact timing, no encoder on the command's side.
- **MP4** = ffmpeg from the WebM (`libx264 -crf 26 -preset medium -pix_fmt yuv420p +faststart`; the WebM for it is
  recorded at a higher bit rate than a kept WebM). No ffmpeg → exit 1 with the install line before anything starts.
  **GIF is always ours** (`gif.ts`), from RGBA pictures POSTed by the page (it waits at most four behind): a per-picture
  median-cut palette over a 15-bit histogram, pixels unchanged from the last picture's shown colour made transparent
  (disposal 1), LZW. ffmpeg's palettegen/paletteuse of the encoded clip came out ~50% larger and blurrier (VP9 noise
  defeats the transparency), so GIF never goes through ffmpeg.
- **The camera** (`camera.ts`): `actionTrack` from the replay runner (`gameMoments`, run beside the page's start; the
  framing page asks `/track` only after `loaded`): per moment `aimOf` = the biggest fight (≥ 3 of the player's army
  within 7 tiles of enemy army, workers or buildings), else the densest view of their army, else of workers and
  buildings; `placesFromAims` holds until an aim elsewhere lasts 1 s (a fight 0.4 s), dead zone, cut beyond 1.25
  screens, Gaussian ease. The runner's unit class has no type, so a lone overlord by an enemy base read as a fight
  until the three-unit rule. **Clicks first was useless on pro replays**: after a hotkey the army is sent by minimap
  clicks across the map, so a camera that followed clicks showed empty ground. `followTrack` (clicks) remains the
  fallback when the runner fails ("(by their clicks)"). The followed player is the runner's slot matched by name.
- **Machine trap**: Playwright's Chromium needs libnspr4/libnss3, which the development machine lacks (a person's
  Chrome has them); use `~/.cache/scmjs-headless-libs` on `LD_LIBRARY_PATH`. doctor finds such a browser and says it
  does not start. **Vite empties `--outDir` even outside the root**: a staged `engine/` beside a rebuilt page vanishes.
- Speed: recording runs well above real time; reaching `from` is the page's run-on (~1,500 frames a second), so a clip
  late in a long game spends most of its time getting there ("Going to m:ss in the game…").
- The recording needs a browser and the game's files, so `tests/cli-export.test.ts` covers the pieces (options,
  served paths, NUL framing, Cdp, browser candidates over a fake cache, the camera, LZW and GIFs decoded back) and
  the whole path was run by hand. `map test --clips` uses `exportReplay` with `fromFrame`/`toFrame` (`cli-game.md`).

## A replay's mod (`replaymod.ts`)

- `@scm-js/replay` reads an `SCMJ` tagged section into `Replay.mod` (`ModTag`: v, dataSet {hash, name, url, races},
  plugins [{name, sha256}], firegraft, noplugins, engine, madeBy; unknown fields kept) and writes it (`appendModTag`).
  Framing: tag, u32 byte length, then a size section and the payload section, as the commands and map are framed — the
  length is there because the existing readers skip a Remastered tagged section by it; in a legacy file it follows the
  map directly. **The game's loader reads the four sections and nothing after**: a replay with an `SCMJ` section
  appended plays identically (seed, units, hash at every frame), while a flipped header checksum is refused — so the
  loader does read what it is handed. (`mods.md` "Replays of a mod".)
- **The check** (`checkReplayMod`): `sourceHashes` → `ModHashes {hash, withoutPlugins, all, changed, older}` from
  `@scm-js/mod`'s identity (`mods.md` "The mod hash, one rule"); `isTaggedMod` accepts any of them, so replays tagged
  under an earlier form of the hash still match. Nothing here derives an earlier form itself (`all` is
  `identity.earlier`'s `game-files`, `older` the rest of `identity.earlier`); `changed` is the one form that needs the
  person's copy (null without one). Mismatch → CliError naming both hashes, the hint the makers' link, exit 2.
  Untagged + `--mod` → a warning on stderr, then the mod's names. A mod is opened and hashed once per (path, starcraft)
  per process (a large mod takes seconds).
- **Where a mod replay is refused** (`refuseModReplay`, exit 2): `replay watch`, `replay export`, `map test record` —
  the replay runner and viewer cannot take a data set. `modReplayReason` makes `map heatmap` and `map coverage` skip one.
  `checkPlayedMod` for `map trace|cost --replay`: a tagged replay needs `--mod`, the same hash, and no plugins (the
  runners lay files and run no plugin). Untagged replays: unchanged.
- **Tagging the replays we write** (`ladder.ts#tagModReplay`): the runners write replays without `SCMJ`, so `bot
  ladder --mod` and `map test --mod` / `mod test` append `ModOverlay.tag()` as the play page's `replayTagOf` does:
  dataSet = `hash`, or `withoutPlugins` when the mod carries plugins and none ran; plugins = those carried as files
  minus those the runner said failed (the runner names a plugin by its display name, so a failure is matched by file
  name where it can be); firegraft = the `.fgp` when the start line says it ran; engine `{ lifter: "shipped", build }`;
  `madeBy: "scmjs <version>"`. A file the tag cannot go in (a stand-in runner's) is left alone. `bot run` saves no
  replay.

## Races a mod adds

`replayRaceName(race, tag, races)`: 0–2 by `RACES`, then the tag's `dataSet.races`, then `--mod`'s `mod.json` races,
else `Race {n}`. Races 3–7 stay `Race n` on purpose: no JSON value changes for the game's bytes. `players[].raceId` is
the byte. The matchup letter is the declared `letter`, else the name's first, else `?`. `replayInfo` and MCP
`replay_info` run `replayNamer` before `replayReport`. `heatmap.ts#raceLetter` maps a numeric race to a declared letter,
but `map heatmap` skips every tagged replay, so no table reaches it yet. `mods.md` "Races a mod adds" is the mod side.
`tests/cli-races.test.ts` uses made replays, and the real ones when `SCMJS_COSMONARCHY` names the release.

## The `mod` commands (`cli/src/mod/`)

- **The first noun with its own folder**; `tests/core.test.ts` walks `cli/src/**` recursively and matches `(../)+src/`,
  so the thin-layer rule holds there too. Everything reads mods through `@scm-js/mod` (`mods.md`).
- **`--mod` on the game commands** (`map test|trace|cost`, `bot run|ladder`): the mod is written loose in a temp folder
  (`overlay.ts`) only after `modArgs` says the engine's runners take one (`current.json` `"mods": N`; a command asks for
  the overlay version it needs), and removed after. On a Remastered copy, a mod for which the runner reloads the startup
  data also gets the game's own pictures as a layer under it (`gameLayer`), since the runner's own Remastered reader has
  not got them; **a mod with no game files reloads no startup data** (`@scm-js/mod`'s `readsStartupData`, the engine's
  rule), so a plugins-only mod gets no layer (`mods.md` "Remastered copy and the engine's reload").
- **`mod play`** has its own loopback page (`mod/play.ts`), not `open.ts`'s `handOver`: it serves `/manifest`,
  `/file/<i>` and `/map`, builds `File`s in the page and posts `scmjs.play` with `dataSet`; `--bot|--race|--start`
  fill the setup screen's row (`--start` needs `--bot`); a mod with code goes to `?lift=live`. `--json` sends the
  address to stderr; `BROWSER=none` gets its own line. The hand-over message is `mods.md` "The hand-over from the
  command line". `tests/cli-mod.test.ts` stands in for the page.
- **Mod folders** (`mod/target.ts`): `modTarget(dir, {force, source})` is the one rule for the folders `mod unpack` and
  `mod new` write: not there → made (parents too); empty → taken; holding a `mod.json` `readManifest` accepts → refused
  (exit 2) unless `force`, which removes every top-level entry **except dot names** (`.git` survives; the guide says
  so); anything else non-empty, a file, or a file in the path → refused even with `force`. **The source inside the
  target is refused**, since a forced clear would delete it before a folder source is read (folder sources are read
  lazily). A folder's terrain file is kept across an unpack (`earlierTerrain`). The MCP `mod_unpack`/`mod_new` take
  `force` the same way.
- **What is not a mod** (`mod/source.ts`): `openModSource` refuses (exit 2) a source that holds nothing of the game's
  (`holdsNothing`), named by what it is (`otherKind`: a replay by `detectFormat`, a bot by `SCMBOT1\n`, a map = `.chk`
  or an MPQ with `staredit\scenario.chk` — not `kindOf`, which calls every MPQ a map), an empty folder, an `.exe` with
  no archive. A **mod folder is exempt** (`mod new`'s empty folder is a mod). `folderManifest` separates a `mod.json`
  that is not JSON (an error, with the path) from JSON without `scmjs` (a game-files folder naming itself: read as a
  folder) — `readManifest` (core) returns null for both, which is why `check`/`info` used to fall back silently.
  `mod test` checks the pair first (`checkModAndMap`), since `mapTestAction` would read the mod as a map.
- **`--out`**: `mod pack|build -o -` writes the MPQ to stdout through `packMod(…, { stdout })`; **without a `stdout`
  stream `-` is refused**, so the MCP server (whose stdout is the protocol) cannot be made to write into it.
  `checkPackOut` refuses `-o` with `--folder`, `--folder -`, `--json` with `-o -`, and a non-`.mpq` name. `mod build
  --ignore-errors` (hidden old name `--force`). `mod diff a b` exits 1 when they differ. A text error in a mod folder
  is printed `<folder>/<file>:<line>`.
- **`mod info`**: sizes past 1,024 MB in GB (`bigSize`; `ui.ts#size` has no GB step), a plugin named twice shown by
  path, `slowLine` on stderr after 1.5 s. `terrain` (`mod/terrain.ts`: `readSourceTerrain`, `folderTerrain`,
  `terrainInfo`) and `mod check`'s `terrain-file` / `terrain-table` warnings (`mods.md` "Terrain a mod declares").
  `mod new --tables` = `gameSource` + `unpackMod` (needs a copy of the game).
- **`mod header <mod> [--out] [--namespace] [--bot] [--js]`**: a bot's C++ header (or with `--js` a JavaScript
  module) of the mod's ids by name; `mods.md` "`mod header`". MCP `mod_header` writes into a bot's folder with `bot`.
- **Language**: every printed word of `cli/src/mod/` and the `mod` commands goes through `t()`; the files a mod command
  writes (mod.json, README, the tables' text) and the play hand-over's loopback page stay English. `mod check` findings
  and `mod diff` lines stay English (`cli-shell.md`).

## Open

- `replay watch` and `replay export` of a mod's replay (the replay runner and viewer need to take a data set).
- `replay watch`: a player's fog (`--view` is in the runner, not the command); terrain in a terminal without 24-bit
  colour; one dot per unit whatever its size.
- `replay export`: sound; Remastered pictures (the editor's HD copy layout would have to be served: `.hd.vr4`,
  `unit/hd/main_NNN.anim` slimmed); `--fog` through a player's eyes is one `options` field away but untested; the
  runner's unit class cannot tell larvae and overlords from fighters.
- `mod test --bot` (designed in scm-sim `docs/mods-plan.md`, not built); `--clips` for `mod test`.
- `codeWords` (engine.ts) prints the runner's failed-plugin lines as they come, so they still name `kernel32.dll!…`
  (not passed through `plainRunnerError`).
- The mod hash will gain the plugins and the project (`mods.md`); `sourceHashes` must follow `@scm-js/mod`'s identity.
