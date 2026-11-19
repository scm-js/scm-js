# `scmjs map`: reading, checking and writing maps

The map commands that read a file and write one back without the plugin host or the game: `info`, `check`
(formats and baselines), `dump`, `find`, `new`, `set`, `resize`, the triggers and strings as text, `sounds`, the
archive as a folder (`unpack` / `pack`), `optimize`, `build` (TrigScript) and `fetch`. Changes made through the
plugin host (`map run`, `map edit`, units, terrain, settings) are `cli-map-edit.md`; pictures and layouts
(`preview`, `generate`, `analyze`, `diff --picture`) `cli-map-pictures.md`; the text folder, diff, merge, log and
blame `cli-git.md`.

## Opening a map

- **The editor's code, not a copy.** A map is opened with core's `openMapBytes` (`src/editor/mapFile.ts`, the
  byte-level half of the editor's `openMapFile`) into an `OpenedMap`: built maps restored, members read, warnings —
  what the editor would show. `loadMapInput` / `openMap` (`files.ts`) wrap it with the CLI's errors (`MapReadError`, exit 2;
  `looksLikeScenario` in `readArchive` refuses a file that is not a map).
- **No game data unless a command asks for it.** Statistics are `mapStatistics` with no tileset or dat (no terrain
  table, no building counts); the check is `validateScenario(scn, { extras })`, so the rules that need the tileset or
  units.dat (units on unwalkable ground, …) do not run.
- **`readArchive` where the stored bytes matter.** `readArchive(bytes)` is the archive as it is (chk, extras by name,
  stored, origin, files, problems); `openMapBytes` = `readArchive` + `restoreBuiltMap` + parse. A command that must
  see what the game runs (a built map's built triggers: `map trace`, `map test`, `map sounds`, `map optimize`) uses
  `readArchive`, not the restored map.
- **Counting is one rule**: locations without Anywhere, strings with text (`stringsWithText` in `MapReport`;
  `statistics.strings.set` counts "" slots) — `map info` and `map dump` agree. `map info --json` gives `name` cleaned of
  colour bytes and `rawName` as stored, and `script` (`hasScript(doc.extras)`: whether the map keeps a TrigScript
  script; null when the build's modules are not vendored) — the GitHub Action reads it to know what to build.
- `map info --table`: one row per map (File, Name, Size, Tileset, Version, Players = used slots, Units, Triggers,
  Check) through `ui.table`, by terminal columns. `eachFile(…, silent)` collects without printing for it and for the
  CI formats.

## `map check`

- **Formats** (`report.ts`, pure functions of `CheckReport { file: path as given, name, issues, failed }`): `--format
  text|json|github|junit|sarif`, `--json` = `--format json` (both given and different: exit 2). **github**:
  `::error|warning|notice file=…,title=<map · where>::text` with the runner's escaping (`%`→`%25`, newlines `%0A`; `:`
  and `,` in properties `%3A`/`%2C`); info = notice. **junit**: a testcase per map, a `<failure message="N errors, M
  warnings">` holding every finding when failed, else `<system-out>`. **sarif** 2.1.0: a rule per `where`
  (`scmjs/<slug>`), results at `artifactLocation.uri` = the path with `uriBaseId %SRCROOT%`. `reportPath` = relative
  to cwd with `/`. The levels stay Check Map's: `--strict` changes `failed` and the exit code, not the annotation
  kinds. A file that could not be read is reported apart (`unread`).
- **Baselines** (`baseline.ts`), for old maps whose known findings should not fail CI: `--baseline [file]` checks
  against one, `--write-baseline [file]` writes it (default `.scmjs-baseline.json` in the cwd). The file is `{ about,
  version: 1, maps: { "<path from the file's folder, />": [{ level, where, text, id? }] } }`, maps and entries sorted
  so it diffs well, `id` only when it differs from `text`.
- **A finding's identity** (`findingId`, matched with `where` as a multiset — each known entry answers for one
  finding). `Issue` carries only `{level, text, where, target?}`, no rule code, and the target index shifts, so the
  text is the key with the moving parts taken out: every `Trigger N` / `Briefing N` in the text becomes `Trigger
  @<sha1 of formatTrigger(t, triggerNames(scn))[0..8]>` (whether or not `target` is the trigger — the CUWP "uses slot"
  notes point at the dialog); counts before `units|unit types|strings|tiles|mineral fields|triggers|start
  locations|bytes` (optionally `more`/`other`/`placed`) and `N%` become `#`; `(the first …)` examples are dropped.
  Level is not in the key. Locations, players, switch numbers, unit name + position are kept (they name the thing).
- **Why the trigger's text and not `fingerprintTrigger`**: a `triggers export|import` round trip re-interns strings
  and normalises flag bits, which changes the fingerprint of nearly every trigger (75 of 81 findings on Wakka Wakka
  came back as new); the text form names strings by content and survives renumbering. The price: editing a trigger,
  or renaming a location or switch it names, makes its findings new ("look at them again", in the guide).
- **The command**: a value ending `.scm|.scx|.chk` after `--baseline` is pushed back into the maps (the option takes
  an optional value). A missing file with `--baseline` → exit 2 naming `--write-baseline`; `--write-baseline` reads an
  existing file first so the line says what changed (`(1 new, 1 fixed and dropped)`) and keeps the other maps in it;
  nothing is written when no map could be read; standard input is refused (a map is keyed by its path); write mode
  exits 0. `failed` and the exit code count new findings only; the CI formats get only the new ones; `--json` adds
  `baseline: { file, suppressed, fixed, new, fixedFindings, written? }`. Fixed = known entries no current finding
  answers (notes included, so a baseline written with `--all` does not call its notes fixed when checked without).
  The baseline is matched in English whatever the language (`cli-shell.md`).

## `map dump`

- The whole map as one stable text (`dumpMap` → `MapDump`, `printDump`), for files and git (the textconv recipe is
  `cli-git.md`): header, players, forces, units in **file order** (`unitLine`: name, owner, pixel x,y, and only the
  properties the record sets), sprites, doodads, the settings the map changes, locations numbered from 1 with Anywhere
  counted apart, triggers and briefing in the trigger window's text (`triggersToText`, so `map triggers import` can
  take a part back), strings with text, members with size + sha1 prefix, sections as they would be written
  (`sectionBytes`) with a sha1 each. Every part is printed even when empty (`(none)`) so two dumps line up. Never
  colour.
- **First line `# scmjs map dump 2`** (`DUMP_FORMAT`; bump it when the form changes incompatibly). **No file name in
  it**: git's textconv of a renamed file differed on that line alone. A form change also needs the person's
  `cachetextconv` cache cleared (`cli-git.md`).
- **Settings are only what the map changes** (`changedSettings`): custom units/upgrades/techs with `useDefault` 0;
  availability/levels where the shared column differs from a fresh table, a player's own values only where
  `playerUsesDefault` is 0 — StarEdit leaves bytes in the other players' columns, which made hundreds of lines of
  noise on Blizzard maps; weapons only when some unit is custom.
- Nothing parses the dump (`init`, `map log`, `blame`, `unpack --text` do not), so its form can change with the bump.

## `map find`

`findInScenario` per kind in `FIND_KINDS` order with `limit: Infinity`; triggers and briefing are searched in each
trigger's `formatTrigger` text (the editor's Find reads only the trigger's strings); `hitJson` has `number`. Exit 1
when nothing matched in any map (grep's rule). Sprites and doodads match ids only (no game names without data).

## `map new`, `map set`, `map resize`, `map strings prune`

- **`map new`** (`create.ts#newScenario`) is the editor's `newMapInto` without the store: `flatTerrain(baseTerrain(null),
  null, seeded(1), era)` — **the fill is seeded** (mulberry32) so the same arguments give the same bytes, unlike the
  editor's `Math.random`. **No `--terrain`**: `baseTerrain(null, id)` returns `DIRT` whatever the id (a terrain's tiles
  need the tileset's groups), so such an option would be a silent no-op. `--revision` takes every `MAP_VERSIONS`
  entry. `--players n` = `placeStartLocations(…, replace: false)` **and slots n..7 set Inactive**: the editor leaves
  eight Human slots, but a Human slot without a start location is a Check Map error in melee, and a terminal scaffold
  should pass `map check` as written. Written with `defaultSaveOptions(scn, null, path)` (pkware + encrypt, the Save
  dialog's rule for a fresh map); `.chk` = the bare scenario. An existing file without `--force` → exit 2.
- **`map set`** (`edit.ts#setHeader`): `--name/--description` read through `unescapeStringText` (`<03>` = a colour
  byte, as the strings files); `--revision` → `changeMapVersion`; `--encoding` → `changeTextEncoding`;
  `parseRevision`/`parseEncoding` take any case (CP949 → euc-kr). **A map whose strings are all ASCII is the same
  bytes in every encoding, and the encoding is detected on open**, so no encoding change is made there and the command
  says so. Each field's from → to is said; nothing given → exit 2; written only when something changed (or `--out`, or
  piped). `--settings` is `cli-map-edit.md`.
- **`map resize`** (`resizeMap`): `resizeScenario` with `fill: baseTerrain(null)`, `tileset: null`, `era: scn.era`,
  `random: () => 0.5` — the editor's operation without game data; anchors by name (`ANCHORS`, the dialog's centre by
  default); `--no-clamp` ↔ the dialog's clamp. The same size → exit 2.
- **`map strings prune`** (`pruneStrings` / `pruneScenarioStrings`): `unusedStrings(scn, usages)` **minus empty
  slots** — `""` is a gap the table keeps (an import past the end pads the table, and the gaps read back as ""), the
  same null = "" rule as `map diff` and `map dump`; then `applyStrings(deleteUnused(…))`. `--dry-run` lists and writes
  nothing; lists cut at 20 unless `--all`.

## Triggers and strings as text (`exchange.ts`, `texteditor.ts`)

- **`map triggers export|import [--briefing] [--append] [--allow-empty] [-o]`, `map strings export|import [-o]`**:
  the editor's `exchange.ts` (`triggersToText`/`readTriggerFile`/`encodeTrg`, `formatStringTable`/`parseStringTable`/
  `applyStringImport`) behind `exportTriggers`/`importTriggers`/`exportStrings`/`importStrings`. Text to stdout unless
  `--out`; `.trg` by extension needs `--out`. A `TriggerTextError` becomes "file, line N: …", exit 1, and nothing is
  written. Import writes back in place unless `--out`.
- **Refusals before a map is emptied by mistake**: `importTriggers` refuses a file with no triggers (exit 2) unless
  `--allow-empty`; `trgKind` tells a briefing `.trg` (condition 13, Mission Briefing) from triggers (another condition,
  or an action above 9) and a mismatch is refused; `importStrings` refuses an empty file and a number given on two
  lines. Through MCP, `map_triggers_import` with empty text is an error for the same reason.
- **`map triggers edit` / `map strings edit [--editor] [-o] [--briefing]`** (`editInEditor`): the export written to
  `<tmp>/scmjs-edit-XXXX/<map>.triggers.txt` (`.briefing.txt`, `.strings.txt`), the editor run with stdio inherited,
  then the same import (same parser, same errors). **Editor choice** (`editorCommand`): `--editor`, `VISUAL`, `EDITOR`
  (git's order), else `notepad` / `vi`; `--editor ""` is refused, and so is falling back to vi with no TTY on
  stdin/stdout. **Spawn** (`editorSpawn`): an existing path or a bare word (`/^[\w@%+=:,./\\-]+$/`) runs as is;
  anything else (`code --wait`, a quoted path) runs as git does, `sh -c '<editor> "$@"' <editor> <file>`, so the file
  stays one argument; **on Windows always `shell: true`** (unless an existing `.exe`), since `code` is `code.cmd` and
  Node refuses a `.cmd` without a shell. SIGINT is ignored while the editor runs (git's habit: Ctrl-C in vi must not
  kill the command and strand the file). `-` is refused both ways: the editor needs the terminal.
- **"Nothing changed"**: the text equal after CRLF→LF and `trimEnd` (vi adds a final newline, Notepad may write CRLF),
  or the import gives the same triggers (`sameTriggers`: a comment-only edit), or no string replaced or added (every
  line removed from `strings edit` counts as nothing) — the map is not written. `triggers edit` passes `allowEmpty`:
  emptying the editor is meant.
- **The kept file**: a parse error (exit 1), an editor that exits non-zero, or a failed write keeps the text
  (`tempFolder(…, { untilStopped })`) and the hint names it and the import command to finish with; an editor that
  never started (ENOENT, exit 2) removes it. The error names the file by its base name, the hint by its path. Tests use
  a stand-in Node script given as `--editor '"<node>" "<script>" <mode>'`, which goes through the `sh -c` path.

## `map sounds` (`sounds.ts`)

`map sounds [list] <map>` and `map sounds export <map> [-o]` (`readSounds`/`exportSounds`): `readArchive` (a built
map's sounds are the archive's as is) + `parseScenario(chk)` + `soundList` joined with `stored.unreadable`; then every
other member that is audio by extension (`.wav/.ogg/.mp3`) or magic (RIFF…WAVE, OggS, ID3/MPEG sync). **mopaq decodes
inside `readMembers`** (Huffman + IMA ADPCM sectors), so StarEdit's ADPCM WAVs come out as 16-bit PCM WAVs with no code
here. Lengths: `parseWavHeader` + `wavDuration` (`wavFormatLabel`, core), Ogg from the last page's granule over the
Vorbis rate (Opus: 48 kHz less pre-skip). A WAV-table name the archive lacks is `missing` (`stock` when under `sound\`:
the game's own), one it holds but could not decode is `unreadable`; neither is fatal. Files: `fileFor(basename)`, the
extension the bytes call for when the name has none, `-2`/`-3` on a case-insensitive clash; the folder (default
`<map>-sounds` beside the map) is made only when something is written.

## The archive as a folder: `map unpack` / `map pack` (`archive.ts`)

- **Raw on purpose**: `unpack` writes the archive as it is and `pack` writes it back with `writeArchiveBytes(chk,
  {extras, stored, compression, encrypt, listfile})` (`saveMap` with the editor's sector rule). Nothing is parsed, so
  the folder *is* the file: a built map unpacks into its built scenario + `scmjs\` members and packs back to the same
  built file. (`--text` writes the scenario as a folder of text: `cli-git.md`.)
- **Member → file**: `fileFor` turns `\` into folders and percent-encodes `<>:"|?*`, control characters and `%`
  itself (so `memberFor` decodes without ambiguity); `.`/`..` segments become `%2E…`. Two members differing only in
  case get `.2`, `.3` (the manifest holds the real name).
- **`archive.json`** (`ArchiveManifest`): fileName; scenario {compression, encrypted, sectorSize}; listfile (false = a
  protected map, written back without one); members [{name, file}]; stored {hashTable, sectorSize, unreadable,
  members[{slot, hash, block, sectorSize, file}]} with the bytes in `stored/NNN.bin`; problems; `files` (path → 16 hex
  of sha256 of what the unpack wrote). **Version 1** plain, **2** with the text scenario, **3** only when an ADPCM sound
  is carried in its stored form (below); pack reads 1–3 and says "a newer scmjs wrote it" past that. A version is
  raised only when the folder needs it, so an older scmjs still packs what it can.
- **ADPCM sounds keep their stored form.** mopaq decodes StarEdit's ADPCM WAVs, and a rewrite would store PCM (a map
  can triple in size). `unpack` writes the stored form to `stored/NNN.bin` with `members[].stored = { slot, hash,
  block, sectorSize, file, sha256 }` (sha256 of the decoded file); `pack` hands it back through `keepStoredForm` while
  the WAV's sha256 matches, and says how many changed sounds went in as PCM. (`src/formats/mpq/stored.ts`, shared with
  every save: `saving.md`.) A pre-version-3 pack would have packed the `.bin` as a member, which is why it is a new
  version.
- **Pack**: manifest members + stored + **every other file** in the folder (dotfiles skipped) as a member at
  `memberFor(path)`; `staredit/scenario.chk` (or the text scenario) required; `.chk` output refused when there are
  members; the packed bytes are opened with `openMapBytes` before writing (a folder whose scenario is garbage is
  refused, exit 2). Default output: the manifest's `fileName` beside the folder, else `<folder>.scx`. Compression: the
  manifest's, "other" → pkware; `--compression` overrides; encryption as the manifest says.
- **Unpack never merges** (`clearEarlierUnpack`): a re-unpack removes the earlier unpack's own files (by the manifest's
  `files`, then empty folders, never dot-folders), and refuses another map's unpack (by `fileName`), files changed or
  added since (unless `--force`), and a folder that is no unpack at all (even with `--force`: `--out .` would otherwise
  clear the working directory). For a manifest without `files`, a listed file is "changed" only when it differs from
  what this unpack writes there.

## `map optimize` (`optimize.ts`)

- **Archive-level, one pass of decisions, measured stage by stage.** `readArchive` (a built map's scenario must stay
  the built bytes), then: sounds and other members no trigger or briefing string names (`stringUsages` kinds trigger/
  briefing — any string, text or WAV, so it errs on keeping) and, while the WAV section stays, the WAV table does not
  name; WAV entries whose file is absent and not `sound\…`; `pruneScenarioStrings`; `--strip-editor` = `planSave` with
  `stripTerrainEditing` + `stripBookkeeping` (ISOM TILE DD2 / IVER IVE2 IOWN UPUS SWNM WAV — the registry's
  `editorOnly`; TYPE, the old settings tables in a 205 file, unknown sections, repeats and trailing bytes are left:
  conservative), with `scn.wavs`/`switchNames` nulled first so their strings and the list-only sounds go too. Each stage
  is written with the as-opened compression and its size taken; the compression row is (original − baseline rewrite)
  + (last − final), so the rows add up to the whole.
- **Kept whatever names them**: `trigscript\`, `magenta\`, `scmjs\`, a build's `added`, `--keep <member>` (repeatable;
  exact, or a folder ending in `\`; an unknown name is a warning), and **what the game opens by name** (`GAME_MEMBERS`,
  from StarCraft.exe's strings): `(attributes)`, `(signature)`, `Blizzard_2.cnd`, `Ladder_2..4.cnd`, `League_%d.cnd`,
  `CompUSA_1.cnd`, `KBK_2.cnd`, `PGL_2.cnd`, `Tourn_1.cnd`, `WGT_1.cnd`. Without that list `blizzard_2.cnd` (in nearly
  every Blizzard map) read as junk.
- **Built maps** (`restoreBuiltMap` not plain): the chk is written back byte for byte (the manifest's hash), no WAV,
  string or section step; members referenced by the built or the source scenario stay. **EUD maps** (`usesMemory`: any
  `triggerReferences` ref of kind `memory`): strings left — euddraft-style maps reach strings by place, and a
  re-encoded STR loses bytes past the table.
- **Compression**: PKWARE by default (every version reads it; zlib is Remastered-only, `saving.md`); a map already zlib
  tries both and keeps the smaller; `--compression` forces and writes even when larger. Our PKWARE implode beats
  Blizzard's own (Crescent Moon's scenario 77 → 61 KB with nothing removed). A zlib member is never carried into a
  PKWARE map (1.16.1 could not read it).
- **Stored members move.** `asStoredFor(compression)` writes every member once and keeps, as stored, each whose
  original stored size is smaller than the new one (StarEdit's ADPCM WAVs). **`Creator.addStored` pins a member at its
  old offset** (its key is offset-adjusted), so an archive could not shrink past it; `stored.ts` re-keys and moves
  them (`packStored` lays them from offset 32 round the nameless members; `(attributes)`/`(signature)` are found among
  the nameless by `slotOf` and move too). Single-unit and sector-CRC members (not in SC1 maps; mopaq reads neither) are
  left in place. With members carried, a `(listfile)` naming them is written by hand, since the writer lists only what
  it encoded; a protected map gets none. `writeBest` also tries every member written afresh and keeps the smaller.
  Optimize passes `carryStored: false` to its own writes because it measures both ways itself.
- **Checks**: the result is opened with `openMapBytes` before anything is written; not smaller → the input's bytes
  (to `--out` or a pipe) or nothing, and said. Over the Blizzard maps every kept member decodes byte-identical,
  `diffMaps` shows only STR/WAV and the removed members, and the stripped maps still play (`map rush`).

## `map build`: TrigScript (`build.ts`)

- **The plugin's compiler runs in Node as it is.** `plugins/trigscript/compiler/**` and `script.ts` are DOM-free, so
  the CLI imports the *vendored* source at the editor's pin (`plugins/trigscript/`, `vendored.json`) and the bundle
  carries it: a given scmjs builds exactly what the editor of the same version builds. The compiler is most of the
  bundle's size.
- **Trap: `plugins/` is gitignored and vendored by predev/prebuild**, so a plain `npm test` on a clone has no
  compiler. `build.ts` loads the plugin's value modules lazily in one `trigscript()` (`import()`s, inlined by the
  bundle's `codeSplitting: false`; `import type` stays static), so `main.ts` and the other suites load without them and
  a missing module is a CliError naming `npm run vendor:plugins`; `tests/cli-build.test.ts` is `describe.skipIf(!have)`;
  CI's `web` job vendors before `npm test`; `build-cli.mjs` vendors when `plugins/trigscript/vendored.json` is missing.
- **TypeScript is not bundled** (10 MB; `npx @scm-js/cli info` must not download it): `locateTypeScript` resolves
  `typescript` from the working directory's project, then from beside the command (`createRequire(import.meta.url)` — a
  clone, a global install beside a global TypeScript, or `npx -p @scm-js/cli -p typescript`; in the single executable,
  the copy an MCP bundle carries beside it, `cli-distribution.md`), then `npm root -g`; missing → CliError with the
  install line. **A script compiles with TypeScript 6 and no other.** 7 cannot be used by anything: its package has no
  compiler to call from JavaScript (`main` is `lib/version.cjs`), and `npm install typescript` now gives it. 5 cannot
  compile a script: the plugin's `scriptCompilerOptions` are CommonJS modules with the bundler's resolution, which 5
  refuses as an options error on line 1 of every script ("Option 'bundler' can only be used when 'module' is set to
  'preserve' or to 'es2015' or later"; 6 allows it). Found 2026-11-19 by running `map script import` with 5.9.3; the
  earlier "5 or 6" was doctor finding the package, never a compile. `locateTypeScript(…, use)` takes what it is for:
  `"script"` (the default: `map build`, the import's check, the language server) takes major 6 only, `"plugin"`
  (`run.ts`, which only turns a plugin's source into JavaScript) takes 5 too. One that cannot be used is passed over
  for the next place and kept in `unusable`; when nothing else is found the error names its version and path and says
  `npm install typescript@6` (every install hint says `@6`, since the bare name gives 7), and doctor's row reads
  "7.0.2 is too new" or "5.9.3 is too old". Before this `map_build` said "version.cjs is
  not TypeScript" while doctor showed TypeScript as found (the capstone, 2026-11-18). The compiler takes `ts` as a parameter and
  imports it `import type` only. The standard library text is built from the found TypeScript's `lib/` as
  `bundle/lib.mjs#defaultLib` does (`lib.es2023.d.ts` + references). The user chose this over fetching `typescript.js`
  from jsDelivr (the editor's worker does that); add the fetch only if people ask.
- **The editor's order, headless** (`buildMap`): `scriptState` (no files → CliError; a stale block → CliError, as the
  editor's `bringUpToDate` refuses); names from the scenario (`usedLocations`, `locationName`, `forceName`,
  `readSwitchNames`, `unitCustomName`, `soundList` into `scriptNames`, what `service.ts#names()` reads off the API);
  settings `readSettings(extras)`; libraries = the map's copies only (an import with no copy → CliError: apply it in the
  editor once); `compileScript(…, { lib, libraries, sounds: !check, tests })`; `testWorld` is a port of
  `service.ts#world()` with unit stats only where UNIS/UNIx overrides (no units.dat here); failing tests → `ok: false`;
  `finishSounds` with `loadVorbis` (a project's `wasm-media-encoders/wasm/ogg.wasm` found walking up from cwd, else the
  plugin's `dist/vorbis.wasm` from jsDelivr at its version); `buildScript(…)` → `applyTriggers` + `doc.extras =
  plan.extras` (the editor's Apply). No programs → `writeBack`; programs → `defaultSaveOptions` + `planSave` +
  `buildChk` → `buildOwnMap` → `packBuiltMap({ …, steps: [{ id: "trigscript/build", label: "TrigScript" }] })`. A
  `.chk` output with programs is refused as the editor refuses it. Magenta's member (`magenta\magenta.json`) →
  CliError: its contributions API is the editor's and no plugins run here.
- **`map script export | import | api`** (`script.ts`): the terminal's side of the `map_script_*` tools. `import`
  takes files (in under their base name), folders (every `.ts`/`.tsx` at its path inside; `.d.ts` and `node_modules`
  passed over, since an editor's project has them) and `-` (main.ts from standard input), plus `--remove`; a name given
  twice is refused. It exits 1 when the script does not compile, with the files written all the same. `export` prints
  the text to stdout with the state line on stderr (a pipe gets the script alone; one file is printed bare, several
  each under `// ── name ──`), or writes a folder with `--out`; a map with no script is an error (exit 1), where the
  tool answers with how to write one. `api` takes the words as arguments and the map as `--map`.
- **The script's files without the editor** (for the `map_script_*` tools, `cli-mcp.md`): `readScript` is
  `scriptState` said as `none | applied | unbuilt | stale`; `changeScript` patches the files (a name with text written,
  null removed, the rest kept) through the plugin's `readFiles` / `withFiles`, and compiles nothing. It refuses a name
  outside the plugin's `FILE_NAME`, **and a folder that is only dots** (the plugin's rule lets `../x.ts` through; the
  member would be `trigscript\..\x.ts`), a script left without its entry file, the last file's removal (the triggers
  would be left behind with a manifest and no source) and a Magenta map. `scriptDeclarations` is the plugin's
  `generateDeclarations` over `mapNames`, some 350 KB for a map.
- **Output**: one line (triggers range, programs, sounds, tests, written to, size, TrigScript and TypeScript versions);
  diagnostics as `main.ts:3:27 error …` (tsc's shape); failing tests with name and line; exit 1 and nothing written on
  either. `--test` runs the script's tests first (a failing test refuses the build); `--check` compiles (and tests,
  with `--test`) and writes nothing; `--json` is the `BuildOutcome` plus `file`.

## `map fetch`: maps from scmscx.com (`scmscx.ts`, `fetch.ts`)

- **The site has no documented API.** These are the routes its own pages use (the editor's scm-scx plugin and
  scm-server use the same); Node calls `https://scmscx.com` directly. `scmscx.ts` is the only file that knows the site
  (`ROUTES`, one line each with its shape):
  - `GET /api/uiv2/search/{words}` (words `encodeURIComponent`ed in the path; `?offset=N` pages) → `{ maps: [{ id,
    filename, scenario_name, last_modified, uploaded_time }], total_results }`, **a row per file name** (the same id
    repeats), 300 a page, no size, tileset or players.
  - `GET /api/uiv2/map_info/{id}` → scenario, description, `player_owners[12]` (6 human, 5 computer), forces, `meta:
    { mpq_hash, mpq_size, downloads, uploaded_by, … }`, `properties: { width, height, tileset (ERA), … }`. **An
    unknown or malformed id is 500** "Something went wrong :)", not 404.
  - `GET /api/uiv2/filenames2/{id}` → `[{ filename, modified_time }]`, oldest first, names repeat per time.
  - `GET /api/uiv2/minimap/{id}` → PNG bytes (not used).
  - `GET /api/maps/{mpq_hash}` → the archive, no content-length over HTTP/2; size = `meta.mpq_size`. Unknown → 404.
- **`get`**: `user-agent: scmjs/<version> (+https://docs.scmjs.dev/cli/)` and an AbortController whose 10 s timer is
  **reset on each body chunk** (a slow line downloading a big map is not cut off; a stalled one is). Errors are
  CliErrors, exit 1: did not answer within 10 seconds, could not be reached (undici's `cause.code`), answered 503, has
  no such map (404, and 500 on map_info), not JSON. `base`/`timeout`/`fetch` are options for the tests only — no
  environment variable points it elsewhere. Nothing is cached.
- **The search** merges rows by id and asks `map_info` for the first `--limit` (default 10, max 50 — one page of 300
  rows always covers it), **four at a time**; a row whose details fail stays, blank. Downloads is `meta.downloads`
  ("uploaded N times" is not something the site counts: filenames2's length is names × times seen). No match → exit 1.
- **The download** (`fetchMap`, `--id <id|url>` or `<words> --first`): the name = **the first file name the site
  lists** (oldest, usually the original), else the scenario name, else the id, through `safeFileName` (controls
  dropped, `<>:"/\|?*` → `_`, leading dots and trailing dots/spaces off — so `../x` is `_x` —, Windows device names
  prefixed `_`, 120 characters, `.scm`/`.scx` added by VER when missing). `--out`: `-`, an existing folder or one ending
  in `/`, else the file. **The exists check comes before the bytes are fetched** (exit 2, `--force`). Bytes without the
  MPQ magic → "not a map"; then `loadMapInput` must open it; nothing is written either way. `--json` with `--out -`,
  `--open` with `--out -`, and the download options without `--id`/`--first` are refused (exit 2). `--open` hands the
  written file to `map open`.
- `tests/cli-fetch.test.ts` stands the site in with `http.createServer` (repeated ids, HTML, an MPQ magic with nothing
  behind it, 500, 503, a route that never answers, a download that stalls, a closed port); `SCMJS_LIVE=1` runs the
  live case.

## Open

- `dump.ts#unitLine` tests `validProperties` for the hit points, shields and energy bits, which are `validStates`
  bits, so `map dump` leaves out a unit's changed vitals (ums.scx's Marine at 50%). Fixing it changes the dump's text,
  which people's git diffs show: bump `DUMP_FORMAT` with it.
- `map fetch --json` gives the site's raw name; `map info --json` gives `name` cleaned and `rawName` raw — fetch should
  match.
- `map fetch`: sort orders and the site's filters (tileset, size, players: the scm-scx plugin's `searchPath` has
  them), `/api/uiv2/random`, the site's minimap in the terminal (`paint.ts` could draw its PNG), an MCP tool, a
  progress line for a big download, paging past 300 rows.
- `map sounds import` (the Sound Editor's conversion needs Web Audio); an MCP tool for sounds or for
  `triggers|strings edit` (edit needs a terminal); re-edit after a parse error (`crontab -e`'s "try again?").
- `map build` with a `--build` on `map pack` (pack then build is two commands today; a flag would need TypeScript and
  the vendored compiler at pack time).
- `map optimize`: merging repeated sections and dropping unknown ones (the Save dialog's other ticks); pruning a built
  map's source (rebuild instead); a member is carried as stored by its own size alone, so a few small ones may be
  carried where writing them afresh would pack tighter (the whole file is compared both ways, which bounds it).
- A Check Map rule for zero-size or off-map locations (the editor's `validate.ts`).
- MCP tools for `map unpack|pack`.
- `map info`'s triggers row says "1 (1 conditions, 1 actions)": the counts in parentheses are not plural-aware
  (`map.ts`).
