# Maps in git: `map diff`, `scmjs init`, `map merge`, `map log`, `map blame`, the text folder

A map is a binary archive; these commands make git useful on it anyway: a diff in words, a text form for `git diff`, a
merge driver, history and blame by map content, and a folder of text that rebuilds the identical scenario. The GitHub
Action that runs `map check` / `map diff` on pull requests is in `cli-distribution.md`.

## `map diff` (`diff.ts`)

- `diffMaps(a, b)` → groups: header / players / forces (field a → b), units (a multiset by the record minus `serial`,
  `unitKey`), locations (by slot; unplaced on both sides is nothing), triggers and briefing (a multiset by
  `fingerprintTrigger`, text by `summarizeTrigger` cut at 110; `triggersReordered` / `briefingReordered` when equal as
  multisets but not in order), strings (by index), archive members (name-normalised, byte compare), sections.
- **Strings: null and "" are one thing.** A string appended past the end pads the table with gaps that come back as ""
  on reopen; counting them read as dozens of additions.
- **Sections are compared as they would be written**: `parseChk(serializeScenario(s))` (`sectionBytes`), since
  `scn.chk.sections` holds the bytes as parsed and an in-memory edit only marks a section dirty — comparing the parsed
  bytes saw no change after an edit.
- Numbers: `Entry.number` (strings; locations from 1, as triggers number them) and `Entry.index` (a location's slot).
  Rows are `N  what` for added, removed and changed alike. Exit 1 when different, like diff(1). Lists cut at 20
  unless `--all`. `summarizeDiff` (the one-line form `map run`, `map trace --replay` and the MCP tools print) is here.
- **`--rev <rev> <map>`** (`revisionInput`): `locate(file)`, then `git -C <root> show <rev>:<path>` into an `Input`
  named `<rev>:<basename>` (kind from the bytes); git's own first stderr line is the hint, exit 2. **A `..` range is
  refused**: `git show A..B:path` prints nothing and exits 0, which read as a blank map. `A...[B]` is `git merge-base A
  (B|HEAD)`. The pairing is checked (`--rev` with two maps, or one map without it, is refused). `--picture` is
  `cli-map-pictures.md`.

## The text form in git: `map dump` as textconv

- `.gitattributes` `*.scx diff=scmjs` (and `.scm`, `.chk`) with `diff.scmjs.textconv "scmjs map dump"`,
  `diff.scmjs.xfuncname "^## .*"`, `diff.scmjs.cachetextconv true`. **xfuncname must match the whole heading**: git
  puts what the expression *matched* in the hunk header, so `"^## "` showed a bare `##`. git's temp blob keeps the
  basename, and `kindOf` reads the bytes anyway.
- **`cachetextconv` is keyed on the textconv command string only**: a changed program with the same command keeps
  showing the old text until `git update-ref -d refs/notes/textconv/scmjs`. So a change to the dump's form needs that
  line (it is in the guide); the setting is kept for speed. `map dump`'s format number and its "no file name" rule are
  `cli-maps.md`.

## `scmjs init` (`init.ts`)

`scmjs init [folder] [--print] [--git] [--force] [--json]` makes a folder of maps a project git and GitHub look after.
Hidden from the overview (its row was given to `share`); `scmjs map --help`, `scmjs help init` and the guide name it.
`initFolder` does everything (with `print` it computes it all and writes nothing); `printInit` is the report,
`printRecipe` the paste-able text. Paths in the report and `--json` are **from the folder** (from the cwd they were
`../../../../tmp/…`). Exit 2 for a missing folder or a file.

- **`.gitattributes`** (`ATTRIBUTE_LINES`: `diff=scmjs` and `merge=scmjs` per extension, as separate lines) and
  **`.gitignore`** (`IGNORE_LINES`: `*.bak` — the desktop app's Save writes `<map>.bak` —, `*.tests/`, `*.clips/`;
  nothing else is left beside a map: the CLI writes in place or to `--out`, `map unpack`'s folder is meant to be kept,
  temp copies go to the temp dir). Line files get **only the lines they lack**, appended under a comment
  (`missingLines`); a pattern that already names its own driver for the same attribute (`*.scm diff=mine`) is left
  alone. `--force` never removes lines. This bends "write only files that are not there" on purpose: both files are
  common in an existing repository, and appending is not overwriting.
- **`.github/workflows/maps.yml`** (`workflowText`) **at the repository's top** (`git rev-parse --show-toplevel`), not
  in the folder: GitHub reads workflows only there, so the map globs are from the top (`mapGlobs`: all three extensions
  plus any other spelling found, since globs are case-sensitive on the runner and the action errors only when no glob
  matches). It uses the action (`uses: scm-js/scm-js/action@v<VERSION>` + `version:`, `strict: true`, `pictures:
  true`, `pull-requests: write`, `build: true` only when a map keeps a script, else commented). A single glob is
  JSON-quoted when it starts with `*` (a YAML alias otherwise); `mapGlobs(…, quote)` leaves them unquoted for the
  action's `maps:` block. `map test` is a comment line for a self-hosted runner (it needs the game; a step that skipped
  without it would be green on every GitHub runner and mean nothing).
- **An existing workflow**: one it wrote (`Written by scmjs init` + a 10-space `maps:`) gets the new folder's globs
  added (`workflowGlobs`/`withGlobs`); one it did not write is left, and the lines to add are said. The "checks
  <folder>/ from there" note is said only when true.
- **The build line**: which maps keep a script is `hasScript(extras)` (a map that gains a script later needs the line by
  hand; the file's comment says how). TypeScript comes from a second `npx -p typescript@<major>`, where
  `findTypeScript`'s "beside the command" `createRequire` finds it in the same npx folder (verified against a published
  package). `TYPESCRIPT` is held to package.json's major, and to the action's scripts, by the tests.
- **`README.md`** (`readmeText`): a table of the maps (name via `gameText` + `visible`, `|` escaped, link URL-encoded
  with `(`/`)`), the commands with the folder's own globs, and the git lines a fresh clone needs (git config is per
  clone; "run `scmjs init` again" is the answer, since it writes nothing it need not).
- **git config** (`GIT_SETTINGS`: `diff.scmjs.textconv/xfuncname/cachetextconv`, `merge.scmjs.name/driver`) in the
  repository via `git -C top config`; compared with `git config --get` (any scope); another value is left alone (▲)
  unless `--force`; `OLD_SETTINGS` (the old `"^## "`) is replaced without `--force`. **Never `.trim()` git's output**:
  that old value ends in a space and compared unequal. No repository: nothing set, a note; `--git` runs `git init`
  (never otherwise). A note when `scmjs` is not on PATH (`onPath`, PATHEXT on Windows), since git runs it by name.
- **Checks before writing**: `InitMap.fails` (an error or warning, as `strict` would fail on) → a note naming them with
  the `--write-baseline` line to run from the top. A folder with no maps whose subfolders have some (`mapFolders`, 3
  deep) is refused (exit 2) unless `--force`. `--print` states are `would-write|would-replace|would-add`.

## `map merge` and git's merge driver (`merge.ts`)

`scmjs map merge <base> <ours> <theirs> [--out] [--ours|--theirs] [--name] [--dry-run] [--json]`, and `map merge
<map>` alone during a stopped `git merge`.

- **Shape**: `runMerge` (shortcuts, writing) → `mergeDocs(base, ours, theirs, out, prefer)` (pure, on `OpenedMap`s).
  `out` is **a second opening of ours's bytes**, changed in place and written with `writeBack`; ours itself is only
  read, since the comparisons need it as it was. So the result is ours + theirs's delta, and every section the merge
  did not mark dirty is ours's bytes, byte for byte.
- **Shortcuts first, by bytes** (as git): ours == theirs → same; base == theirs → ours; base == ours → theirs, written
  exactly (no parse). Without `--out` and with ours as the result nothing is written — except in the staged mode, where
  the target is the working-tree file, not stage 2's bytes.
- **Order**: header first (revision via `changeMapVersion`, encoding via `changeTextEncoding`), since the settings pairs
  and MRGN slots follow the revision; the frame; terrain and objects; locations; triggers; briefing; settings; archive
  members; unmodelled sections; **strings last**.
- **Frame** (`mergeFrame`): same width/height/era on all three → a fine merge. Otherwise the grid group (DIM, ERA, MTXM,
  TILE, ISOM, MASK, UNIT, THG2, DD2 and the locations' rects) comes whole from the side that changed geometry; both
  sides → one "Size and tileset" conflict, `--theirs` takes theirs's group. Location names and flags still merge per
  field.
- **Terrain** per index on MTXM, TILE, MASK, ISOM. ISOM conflicts are shown at a tile (`isomTile`: row = index /
  ((w/2+1)·4), col·2) so they join the tile rectangles; conflicting tiles → `tileRegions` (8-connected components →
  bounding boxes).
- **Units, doodads, sprites** (`instanceDelta` + `mergeInstances`): a multiset match by key (units: the record minus
  serial; doodads/sprites: the whole record); a removed+added pair is an *edit* by **serial first** (units; the editor's
  `updateUnits` keeps it), else the same group within `MOVE_RADIUS` 4 tiles, nearest first. Per base instance the
  usual three-way table (one side edited and the other removed = a conflict; both edited to the same key = fine).
  Theirs's additions are appended minus ours's identical additions. Serials: a unit in one of ours's slots keeps ours's
  serial; an appended one keeps its own unless taken (then max+1), and `relatedSerial` follows the renumbering.
  Identical duplicates are interchangeable, so which one "was removed" is first-come: harmless.
- **Locations** per slot, three fields each: the rect atomic (a mix of two rects would be a box neither drew), elevation
  flags, name as text. A rename on one side and a move on the other both land.
- **Triggers and briefing**: `triggerKey` = JSON of the record with each `text`/`wav` argument replaced by its
  **text** and locations **by number**. Not the trigger window's text form (`formatTrigger`): it names locations, so a
  rename on one side changed every trigger mentioning it. `mergeList` = diff3 (`lcsMatch`: prefix/suffix trim + DP, a
  middle over 16M cells counts as one change; `diff3Chunks`), then in a chunk both changed: both inserted at one place →
  ours then theirs minus duplicates; same length on all three → item by item; one side only inserted and the other
  changed items in place or only deleted → combined; else one conflict for the chunk. **git conflicts on adjacent
  lines; this does not** — the point for triggers. `printMerge` cuts each conflicting line around the first character
  where ours and theirs part (`around`, 100 columns), keeping a trigger's owners (up to `: `) at the start.
- **Settings** (`settingsView`): one object per scenario with string references as text, merged per top-level key by
  `mergeValue` (recursing into same-length lists and same-key objects; a leaf both changed is a conflict). Installed by
  setting fields + `markDirty`; the revision's section pairs through `unitSettingsSections` & co (core), COLR only when
  the file has it or VER ≥ 205, IOWN with OWNR when there is no separate `editorPlayerTypes`.
- **Strings** (`mergeStrings`), the trap of the design: the table is index-addressed and must not be renumbered (raw
  sections, the editor's rule). Every reference site of `out` is walked (`stringSites`: SPRP, FORC, MRGN, UNIS/x
  names, SWNM, WAV, TRIG/MBRF text+wav). Sites from ours keep their numbers and claim them. A site from theirs wants
  theirs's text and prefers theirs's number: kept if ours's table has that text there; written there if the number is
  unclaimed and empty, past the end, or referenced in ours only by what was replaced (**an edit in place stays in
  place**); else it shares a slot with that text; else the lowest empty slot no version refers to; else appended.
  **Blizzard's maps have all 1024 STR slots** (unused = ""), so appending overflowed until the free-slot step. A table
  pushed over `stringCapacity` by the merge is a CliError (ours's own overflow is allowed, as the editor's
  `internString` allows it). Strings no version refers to merge by number. `renumbered` counts theirs's sites that did
  not get their number ("Strings N renumbered"). Both sides appending a string at the same new number is the common
  case (two people each add a trigger).
- **Archive members** by normalised name, bytes; **unmodelled sections** by name, all copies compared as bytes,
  theirs's copies at ours's first position or after the section theirs had before them. **Stored (unnamed) members are
  ours's**, always (pinned blobs). **Built maps** open restored, so the merge is of the sources and the result is
  written unbuilt: build again.
- **Output**: `writeBack(out, inputPath, target)` with `inputPath` = `--name` when ours's path has no map extension
  (git's `.merge_file_XXXXXX`), so the format comes from the real name, and the written path is reported as the name.
  **The default target is ours** (git merge-file and the driver contract agree; the command is the same by hand and
  under git). `kind: "conflicts"` when conflicts were left.
- **The driver** (`init.ts` `GIT_SETTINGS`): `merge.scmjs.driver = scmjs map merge %O %A %B --out %A --name %P`. git
  runs it from the repository's top with **relative** temp names with no extension (`asMap` accepts a bare chk by
  `looksLikeChk`) and quotes the placeholders. Exit 0 = merged; non-zero = conflict, git keeps %A as left (ours) and
  stages 1–3 for the path.
- **Staged mode** (`stagedInputs`): `git show :1:/:2:/:3:<path from top>`; a missing stage → exit 2 "is it in a merge
  that stopped on it?". The hint after a driver conflict names the map, so it reads `scmjs map merge "ridge map.scx"
  --ours (or --theirs) …; then git add …`.
- **The git test** runs a real `git merge` with the driver, but `scmjs` is not on PATH in a test, so the driver is a
  stand-in script that POSTs `{cwd, args}` to an HTTP server in the test process, which calls `runMerge` — so **git
  must be run with async `execFile`**: a `spawnSync` would block the server.

## `map log`, `map blame` (`history.ts`, `maplog.ts`, `blame.ts`)

- **The git layer** (`history.ts`): `locate(file)` = `git -C <dir> rev-parse --show-toplevel --show-prefix` →
  `{root, path: prefix + basename}` — **`--show-prefix`, not `relative(root, resolve(file))`**, so a folder reached
  through a symbolic link still gives git's path. `locate` refuses a folder (it had a history in which every commit
  "removed the map") and a web link (before git's own "cannot change to 'https:/…'"). A revision starting with `-` is
  refused (it would be an option of git's). `blobIds` = one `git cat-file --batch-check` for every
  `<commit>:<path>`; `Versions` reads blobs through `git cat-file --batch`, **24 at a time in the order they will be
  wanted**, and parses each once, keeping a few parsed maps. spawnSync's `input` is a Buffer: `encoding: "buffer"` with
  a string input throws ERR_UNKNOWN_ENCODING.
- **`--parents` turns on parent rewriting**, so `%P` names the nearest ancestors that touched the file (without it `%P`
  is the real parents), and with a range the parents outside it are still printed — that is how blame finds the
  range's edge. **But parent rewriting also makes git walk the whole history first and emit it by commit date**, so a
  commit dated before its parent came after it. `map log` therefore asks the plain `git log --format=%H [-n] <rev> --
  <path>` order apart and puts the `--parents` records in it (`commitsTouching` without `topo`; `-n` on that call,
  asking for N+1 to know there are more). Blame uses `--topo-order` and is unaffected.
- **`map log`** (`mapLog`): each commit compared with its rewritten first parent's version (the same bytes as the real
  first parent's for this path). No version → "map added: 64 × 64 Badlands, 21 units, …" (`describeMap`); none now →
  "map removed"; same blob → "no change to the map"; an unreadable version → `unreadable`, the rest go on.
  `describeChange` words `diffMaps`: header fields, players and forces (one → the change, more → a count), units by
  `unitCounts` (same record but x/y = moved, same kind + owner = changed), locations and strings, triggers and briefing
  by `listCounts` (a multiset added/removed, then an added and a removed in the same LCS gap = one changed; none but
  another order = "triggers reordered"). **Strings that are names** (SPRP, every MRGN name, FORC names) are not
  counted as strings — "description changed · 1 string changed" said one thing twice. Then each changed section no
  phrase spoke for, in words (`SECTION_WORDS`). **Section names are padded to four (`"STR "`): trim before looking
  up.** Nothing at all → "saved again; the map is the same".
- **`map blame`** (`blameMap`): items per kind (`Item {id, content, label, text}`; the same thing in two versions ⇔ id
  and content equal): triggers id = content = `fingerprintTrigger` (a multiset, so a reorder is no change, as `map
  diff`); locations id = slot, content = name + rect + flags; strings id = number, non-empty only; units one item per
  `unitId:owner`, content = sha1 of the sorted `unitKey`s; settings by label (header fields, a row per player and
  force, section groups by bytes, each archive member by sha1).
- **The walk is git blame's**: items of the top version pending at the first node; nodes in `--topo-order` (children
  first); at a node, for each rewritten parent in order, `matchItems` (first-come, one parent item per child item)
  hands matched items to the parent; what no parent takes is this commit's. So a change made on a branch and merged
  lands on the branch's commit. Same blob on an edge → everything passes, nothing parsed. **It stops as soon as nothing
  is pending** (`walked` in the JSON). With `A..B`, items pending at a parent outside the list settle on it as
  `boundary` (`^` + 7 hex, as git). **Uncommitted**: without `--rev` and with the file on disk differing from
  `HEAD:<path>`, a node `0000…` comes first and what it keeps is "Not committed yet" (date = the file's mtime).
  Trigger summaries are made only for the top version; the rest need the fingerprint.
- **Output**: git blame's shape, `hash8 (author date label) text`, cut to the terminal (120 when piped). Default view =
  triggers, or settings when the map has none. `--trigger N` (1-based), `--location` (name, any case, number from 1, or
  `#n`), `--string N` → one item: the commit, then the trigger's whole text or the item's text.
- **Cost**: `map log` is ~two parses and two serialisations a commit (~17 ms on a 400 KB map); blame must read every
  version back to the oldest unchanged item, as git blame must. A long full log holds a few hundred MB resident (V8 not
  collecting between parses).
- **Tests** make a temporary repository from ums.scx with the editor's functions; **git cannot merge the binary
  without the driver**, so the test's merge is made by hand (`checkout --ours`, apply the side's change, commit).

## A map as a folder of text: `map unpack --text` / `map pack` (`source.ts`, `archive.ts`)

The map lives in git as a folder of text and is rebuilt into the identical scenario, so merges are line merges and a
pull request reads the real change. (`map dump` is the one-way form for textconv.)

- **`--text`, not `--source`**: "source" already means the TrigScript source a built map carries (`map build`,
  `restoreBuiltMap`, `scmjs\source.chk`), and an unpacked built map has both. `archive.json` version 2 with
  `scenario.text: "scenario"` (the folder); with no manifest, `scenario/sections.json` without
  `staredit/scenario.chk` is the text form. A plain unpack is still version 1, byte for byte as before. An archive
  member under `scenario\` refuses `--text`. Unpacking one form over the other removes the other (pack would otherwise
  take it for a member); `scenario/` is replaced whole each time.
- **Layout** (`FORMS`, also the read order): `map.json` (TYPE VER DIM ERA SPRP OWNR IOWN SIDE COLR CRGB FORC WAV SWNM
  and the string table's `slots`/`encoding`; players, races, colours, colour modes, force flags **by name** from the
  codecs' tables, a number when unknown; forces 1-based; `tileset` by id when era < 8 else `era`), `strings.txt` (=
  `formatStringTable`, so `map strings import` takes it), terrain grids `terrain.txt` (MTXM) / `isom.txt` / `mask.txt`
  (hex, a row a line), `under-doodads.txt` (TILE as `x y tile` where it differs from MTXM — so a tile edit is one file
  and TILE follows MTXM as the brush does), `units.tsv` / `sprites.tsv` / `doodads.tsv` (record fields in file order,
  flags hex, a trailing `name` column never read back), `locations.tsv` (slots not all zero, 1-based `location`),
  `cuwp.tsv`, `settings/*.tsv` (one struct-of-arrays form: a row per id, per-player columns as 12 comma-separated
  values), `triggers.txt` / `briefing.txt` (= `triggersToText`), `sections.json` (every section in file order: `text`,
  or `bytes`, `size` when the header's length is not the data's, `trailing`), `sections/NAME.bin` (names escaped as
  `%XX`, case clashes `.2`). A form writes only the keys and columns of its sections that are text.
- **The check is the packer** (`scenarioToText`): candidates = modelled, one copy, not cut off, and for STR/STRx the one
  `parseScenario` reads. The files are rendered in memory and run through **`assemble`, the same function `pack`
  runs**; each text section's encoding is compared with the file's bytes. Equal → text alone. Not equal but equal to
  `encodeSection(model, name)` (**the model is the same, the bytes are not**) → **layout**: the original bytes kept under
  `sections/` with `sha1` = the text's encoding; pack writes them while the text still encodes to that hash, else the
  encoding (what the editor's Save writes after an edit). Otherwise the text lost something → for TRIG/MBRF another
  round with **records kept**, else the section goes to bytes and the round repeats. A form that throws demotes its
  sections. Last, the whole folder is assembled and must equal the CHK **byte for byte**, else a CliError. So an
  untouched folder packs to the identical scenario, and idempotence follows.
- **`assemble`**: kept sections first (`parseScenario` of them alone), the forms read over that model, every text
  section encoded with **`encodeSection`** (a save's bytes for one section, exported from core); then a second pass
  parses the assembled CHK and reads the text again, so a kept section is decoded against the text's size and
  revision; it stops when two passes agree (≤ 3). Assembled with `serializeChk` directly, **not `serializeScenario`**:
  its VCOD replacement and MRGN re-dirtying would change kept bytes. With the string table kept as bytes, text that
  adds a string is refused (it would point past the table).
- **Why STR is "layout" on every Blizzard map**: StarEdit's unused slots point at one shared 0 byte and decode as "",
  which `encodeStrings` gives its own blob, and its order differs; maps the editor wrote re-encode exactly. Ashworld
  Hunters has UPGR/PTEC as layout: `readPair` takes the `x` restrictions whole, so the original tables cannot be
  re-encoded from the model.
- **Why TRIG/MBRF keep records**: the text form normalises — `unitFlags` sets 0x10 "unit type used" on any condition or
  action with a unit argument (StarEdit leaves it clear on most Blizzard maps), a string is named by its text so a
  duplicated text resolves to the lowest index, an action's unused text index is dropped. With records kept (`bytes`
  without `sha1`, `Form.keepsRecords`), the trigger form parses the text, then replaces each parsed trigger whose
  `formatTrigger` text (with the current names) equals a kept record's by that record (a multiset, in order).
  Unchanged triggers stay byte for byte; an edited or new one is the parsed record, as `map triggers import` gives.
  **A changed message is a new string** (interned); the old one stays until `strings prune`. triggers.txt decides a
  trigger's text: editing strings.txt alone does not move a trigger (its text then no longer matches → re-parsed with
  the old text → interned back). In the guide.
- **Results over every committed and fixture map**: byte for byte, `diffMaps` same, text identical on a second
  unpack; every modelled section is text; only unmodelled sections (IVE2/IVER/VCOD) are kept as bytes alone. A
  folder is bigger than the map (ISOM is usually the largest file), but git stores the kept bytes compressed.
- **The language server reads a text folder too**: `isUnpackedMap` accepts `scenario/sections.json`, `readMap` builds
  the scenario with `scenarioFromText`, the stamp is the newest mtime under `scenario/` (`cli-editor.md`).

## Open

- `map merge`: an MCP tool; a picture of terrain conflicts (`diffpicture` could draw `tileRegions`); per-conflict
  choices (one rule for all today; the editor is the place for mixing); merging two resized maps tile by tile under an
  anchor; merging the TrigScript source text inside its member (bytes today).
- `map log` / `map blame`: renames are not followed (`--follow` linearises and hides merges; documented); no blame kind
  for briefing triggers; no MCP tools; a trigger text edit blames the string, not the trigger (documented); no
  per-commit `--stat` (`git show` with textconv does that); `map log --rev A...B` passes through to git while `map
  blame` refuses `...`; `map log` on a file that is not a map lists every commit as unreadable instead of refusing up
  front.
- `map log` counts Anywhere among the locations in "map added: … N locations" (`describeMap` uses `usedLocations`);
  `map info` and `map dump` do not. It should count as they do.
- The text folder: `pack --build`; MCP `map_unpack`/`map_pack` with `text`; a normalising option that drops the kept
  STR/TRIG bytes for smaller folders of StarEdit maps (the first pack would change those sections); `map diff` between
  two folders (pack both today); `init` offering the folder workflow; resizing by editing the text (refused by the
  grids' shape checks: use `map resize`); an ISOM form a person can read (hex words merge but do not read).
