# Mods: the folder and `scmjs mod`

Slice M3 of the mods plan (scm-sim `docs/mods-plan.md`), on M2's codecs (`units.md` "Codecs for mods (M2)"). The
reader's page is `docs/mods.md` and the "Mods" page of `docs/cli.md`.

## Where things are

- **Reading a mod is `@scm-js/mod`'s** (`/home/jeany/github/mod`, `ADOPTION.md` there; section "@scm-js/mod adopted"
  below). Nothing here decides what a mod's files are, its layers, its code or its hash. Where the sections further
  down name `sources.ts`, `hash.ts`, `fromPieces`, `dataSetHashOf` or `splitPickedFiles`, that is the code the package
  replaced: the rules they record are the package's (where the two disagreed, ADOPTION.md "Where the copies
  disagreed" says which was kept).
- **Core (pure, exported from `core/src/index.ts`, "Mods" block):** re-exports the package's names it had (list in
  "@scm-js/mod adopted"); its own:
  - `src/formats/mod/folder.ts` — the form: `placeOf(member)` (rule: member → folder file), `memberOf(file, manifest)`
    (inverse, with `manifest.members` overrides), `renderMember` / `renderAiScripts` (unpack, checked), `packFile`
    (pack), `recordRendered` + `tidyManifest` (the manifest), `ModManifest` (`mod.json`).
  - `src/formats/mod/data.ts` — `loadModData`: each table/string table/iscript the mod's else the game's, the game's
    own beside, `ownEntry` (added past the game's count, or `rowChanges` non-empty vs the game's row; without a game,
    past the standard count), `namesOf` (unitnames.tbl[id] when non-empty, else stat_txt[id] for id < 228; labels
    1-based into stat_txt).
  - `src/formats/mod/check.ts`, `diff.ts` — the lints and the changelog.
  - `src/formats/mod/races.ts` — the editor's half of races: `raceLabel`, `raceChoices`, `GAME_RACE_NAMES`, `sameRaces`,
    `racePlaysAs`, `hasRaceCandidates`. `normalizeRaces`, `raceCandidates`, `DataSetRace` are the package's.
- **CLI:** `cli/src/mod/{source,open,unpack,pack,info,check,diff,new,play,overlay,hash}.ts`; registrations in `main.ts`
  under `mod`; MCP tools `mod_info|check|diff|unpack|pack|new` in `mcp.ts`. `engine.ts` has `EngineCurrent.mods`,
  `Engine.mods`, `MOD_OVERLAY`, `modArgs`; `maptest.ts`/`trace.ts` an option `mod: { folder() }`.

## @scm-js/mod adopted

**Shape.** `cli/src/mod/source.ts#describedSource(path, kind, tree)` = `readMod(tree)` (a `diskFiles` tree from
`@scm-js/mod/node`; for a text-form folder `pack.ts#packFolder` builds a `filesOf(…, { layout: "game" })` tree of its
members, `plugins/<name>` for each non-member `manifest.plugins`, `firegraft/<name>` for each `manifest.firegraft`) put
in the commands' `ModSource`: `files` (from `d.files` + `fileReaders`), `plugins` (plugin-file modules, and
`d.carried` members inside archives with `member`), `firegraft` (`d.patches[0].files`), **`code`** (every module
`identity.plugins` has a line for, by module name: plugin files, a patcher's carried plugins, libraries),
`description`, `link`, `races`, `said` (paths shown), `gameCopy`/`left`/`probed`/`unheld` (paths shown: the folder's or
zip's own name stripped). `ModSource` has no `exes`, `beside`, `duplicates` or `system` (read `description`).
`hash.ts#sourceHash` is `identity` + `beforeCode` + `older` (`left` = `older.files`) + `earlier` ("@scm-js/mod 1.1.0"
below). Refusals:
`ModError` → `CliError(modText(e.detail), …, 2)` (`exe-no-archive` keeps the "Name a mod" hint); `copy-only` from
`d.said` is thrown with the folder as given. The CLI still sniffs replays, maps, bots, and an empty folder, before
reading.

**What moved with it.** `overlay.ts`: `readsStartupData`/`STARTUP_NAMES` are the package's (`identity.readsStartupData`:
a plugins-only mod gets no game layer; scm-sim's runner follows the same rule);
`writeCode` writes `source.code` under `plugins/` by module name and `mod.json` `{ name, hash, withoutPlugins, link }`
from `identity`; `modTag` names the data set by `hash` / `withoutPlugins` / `runningHash(lines, plugins, ran +
libraries)`. `play.ts#playSet` hands `source.code` under `plugins/` and takes `identity` (no own digest). `unpack.ts`
writes `source.code` that is not a plugin file into `plugins/` too (so an unpacked patcher mod packs back to the
release's hash — not for a library: package gap, `tests/cli-mod.test.ts` `it.fails`). `replaymod.ts#sourceHashes`:
"@scm-js/mod 1.1.0" below. `info.ts`: `kindOf`, `MOD_KINDS`, `kindTotals`, `tableShape` from the package;
`libraries`; `exes[].form` (with `kind` beside it, below); `beforeCode` ("Earlier hash" row) and `said` (package
sentences other than game-copy/unheld/duplicate).

**Editor.** `modInput.ts#pickedDataSet(files)`: game archives = the pick's `gameCopyFiles` ∩ `isGameArchive`; races by
`isModJsonPath` + `readModJson`; the whole pick goes as `GameDataFiles.picked`. `dataSetMod(name, input)` makes
`ExtractRequest.mod` (picked as picked; or the API's `archives`/`files`/`code` in game layout: archives at top, files
at their paths, `.qdp/.bwl/.dll` under `plugins/`, `.fgp/.fgd` under `firegraft/`). The worker: `archives.ts#modTree`
→ `readMod` → `identity.hash` is the stamp's hash; `d.files` winners under `isMemberPath` are preloaded as the overlay
over the game's archives; the play set asks the mod's winners first. `folderSet.ts` takes
`modRoot`/`GAME_FOLDERS`/`isSystemFile`/`inDotFolder` from the package.

**Words.** `scripts/lib/i18n.mjs#extractMessages` adds every `MOD_MESSAGES` template to a tree that imports
`@scm-js/mod` (both do), so both `ko.json` hold all 79; `cli/src/i18n.ts#modText` and `install.ts`'s `modText`
render a `ModMessage` through `translate`. `tests/i18n.test.ts` "@scm-js/mod's sentences".

**Measured** (`scmjs mod info`, the five real mods): Burning Ground exe and folder `c76bfa18e9fc4fb5` /
`0ed055cf80a95bd0`, SC Revolution `d9e4e6ff76c7e71d` / `bb3f273690cf8d8d`, earlier `90b8c22d9cb4ba31`, TriFresh
`ea488d3ac3575bda`, Cosmonarchy release `c94acdf31982fa4b` / `db23a1f9dd8cef66`, earlier `20e1c6d89ae2af75`, older
`1c41a2d7701fe842`. Cosmonarchy's release reads in 3.0 s from a Linux-disk copy. Outputs under
`~/mods-under-test/_out/adopt-scm-js/`.

**Compatibility.** Core keeps every released export (`core.md` "Mod names from `@scm-js/mod`"). `mod info --json` keeps
0.13.3's fields: `exes[].kind` (`firegraft`/`sempq`) beside `form`, `older.withoutPlugins` a string (the older hash
when there are no plugin files). `replaymod.ts#sourceHashes` accepts the forms 0.13.1–0.13.3 accepted ("@scm-js/mod
1.1.0" below). No replay was ever tagged by the oldest of them: the play page's `SCMJ` tag has followed the all-files
rule from its first write ("no real modded replay exists before R2"), so a tag written before the system-files rule is
`older.hash` (Cosmonarchy `1c41a2d7701fe842`); bots and ladders (scm-sim C4/C5) came after the rule too. The game
files alone and the files that differ from a copy were never a tag's rule: they were the editor's data set stamp (up
to 0.12.1) and the page's kept-mod key, matched by the page, not by these commands. Kept anyway (cheap, and what
released versions accepted). `folderSet` serves every folder under a root found by the game's folders
(Cosmonarchy's `config/`, `datreq/`, `lua/`, `samase/`: 102 files), and nothing when no game folder is there.
`overlay.ts` leaves out a file its archive cannot give (SC Revolution's `wardendth00.wav` would make `map test --mod`
throw). `patcherPluginWords` is not used: `mod info`'s Exe row carries sizes and four-letter ids, which its sentence
has not (its Korean is in the catalogues). `pickedDataSet`/`dataSetMod` live in `src/gamedata/modInput.ts`, imported
by the Game Data dialog and dynamically by `installDataSet`, and `install.ts#runWorker` imports `renderMessage` only
when the worker posts a message, so the editor's startup `source` chunk holds no package code (only the catalogue's
80 entries): 319,758 bytes, against 335,994 with the package imported there.

## @scm-js/mod 1.1.0

`^1.1.0` (or later) in `package.json` and `core/package.json`. What it gives (ADOPTION.md "What the last two adopters
found"):

- **Earlier forms.** `SourceHash.earlier` is `identity.earlier`; nothing here reads the system files' bytes again or
  works out `gameFilesOnly` of its own. `replaymod.ts#sourceHashes`: `all` = the `game-files` entry; `older` = every
  hash and `withoutPlugins` of `earlier` that is not `hash`/`withoutPlugins`/`all`, plus `changedWere` (the differing
  files with `identity.older.lines`: the one form that needs the person's copy, so it stays here). The package's
  `game-files`, `game-files-older` and `older.lines` equal the forms this code worked out itself, checked over ten
  mods (Cosmonarchy release, Burning Ground folder, SC Revolution exe, TriFresh exe and folder, remove-protoss, EUD
  Enabler, ThunderGraft, BWMetaAI's patch_rt.mpq, Cosmonarchy Plus). **One form more is accepted**:
  `before-unlisted-project` (scm-sim's reader before `@scm-js/mod` 1.0.0; SC Revolution `693bf4a83f3a69a1`).
- **Lines by hand.** `replaymod.ts` (the differing files) and `legacy.ts` (`gameLine`, `modHashOfDigests`) write lines
  with `gameFileLine`; legacy's names are core's `gameName` first (no leading backslash), so the values are 0.13.3's.
- **Archives opened once.** `source.ts#describedSource` and the extraction worker pass one `archives` map to `readMod`,
  `fileReaders`, `openLayer` (a plugin inside an archive) and `firegraftBytes`. No `close()`: the CLI's readers live as
  long as the `ModSource` (a command, an MCP call, `replaymod`'s per-process cache on purpose), the worker is terminated.
- **Words.** The package's templates are in both `ko.json`. `archive-unopenable` / `exe-archive-unopenable` carry a
  hidden `reason` (a message); the Korean entries show `{reason}` in place of `{why}`, the English is untouched. The
  check allows it (`i18n.md`); both `modText`s let `why` stand in where a message has no `reason`.
- Not taken from the package: `info.ts#SAID_HERE` (which `said` keys `mod info` prints on lines of its own: a choice of
  this command, not a group `MOD_MESSAGE_GROUPS` has); `scripts/lib/i18n.mjs` asks for every template (all groups are
  shown somewhere); `openModSource` still reads a named file whole to tell what it is before `diskFiles` reads it again
  (Burning Ground's exe: 519 MB twice; not something the package gives).

From 1.2.0 an archive without a list of its files is searched for the names 1.16.1's own image, sound and portrait
tables give too (the package carries them, names only), as the play page searches with the person's tables, so such
an archive's hash is the page's. No reader here passes `ReadOptions.tables`, which is deprecated and no longer asked.
The hash such an archive had under the narrower search is in `identity.earlier` (`without-stock-names`), which
`replaymod.ts` takes whole. SC Revolution, the one mod in hand without a list, carries its own tables.

## Decisions (taken by the user — do not reopen)

- PyMS's dialects and graftc's text are *the* text forms; indexed PNG sheets with the palette named (default
  `jungle`; `mod.json` `palette`; the mod's own `tileset\<name>.wpe` first, else the game's).
- aise-fork raw AI regions stay `raw_bytes(...)` lines (lossless) with a note in `mod.json`.
- Names for the AI text and the tables' header comments: the mod's `stat_txt.tbl` / `unitnames.tbl` when it has
  either, else the game's (`manifest.names`: `mod` | `game` | `none`).
- `mod pack` writes each table in the layout it came from; the browser and the command line never write an exe.

## The check is the packer

`renderMember` renders, then calls **the same helper `packFile` uses** on the text *as read back through UTF-8*
(`asRead`), and keeps the text only when the bytes are identical; else `files/<path>` + `kept[{why, files}]`.
`reason()` strips numbers (`frame N`, `line N`) so alike failures group. GRPs: first the cheap
`encodeGrpImage(decodeGrpImage(b)) === b` (Cosmonarchy's other-encoder GRPs fail here: "another encoder wrote it"),
then PNG and back. At pack a sheet uses **its own PLTE** when indexed with 256 entries (so no game copy is needed for an
untouched or palette-keeping edit); only an RGBA sheet needs the named palette (`packFolder` looks palettes up ahead:
the folder's `tileset\<name>.wpe`, else the game's).

**Names must be computed the same way at unpack and pack** or the AI text resolves differently: `names: "mod"`
uses only the mod's own files at both ends (no game), `"game"` the mod over the game at both ends (pack then needs a
copy and says so). `aiNames` blanks duplicate names (later ones) and names that read as numbers.

## mod.json

`scmjs` (format 1), name, version, authors, licence, base, layers, palette, names, tables `{t: {file, layout, entries,
legacy?}}`, encodings `{file: TextEncoding}` (detectTextEncoding says `utf-8` for pure ASCII — fine, it round-trips),
members `{file: member | [ai, bw]}` only where the path does not give the member back exactly, plugins/firegraft
`[{name, bytes, file, member?}]` (`member` = it was inside the mod's archive, so pack puts it back), maps, kept, notes.
Sorted by `tidyManifest` so the same folder writes the same file.

## Lints (`check.ts`) — scoped so the game's own data is clean

The game's own data has leftovers (5 iscript ids no image uses, 29 weapons no unit/order uses, 4 sfx rows naming
missing WAVs, duplicate unit names Tank Turret/Duke Turret/Unused…), so the soft lints judge only what the mod
**added or changed** (`ownEntry`): weapon-unused, sound-missing, iscript-unused (ids not in the game's iscript; without
a game, ids > `GAME_ISCRIPT_LAST` = 411), duplicate-name, button-set "no buttons". Hard lints over every entry of the
mod's tables: `dangling` (ref ≥ target count, except "none" = the target's **standard** count — 130 weapons, 228
units — or all-ones; Cosmonarchy's datex tables still use 130/228 as none), `string-past` (1-based, 0 none; units'
`sublabel` skipped: not a string id), `iscript-missing`. `grp-missing`/`lo-missing`: images the mod owns, or every image
when the mod has images.tbl; a path absent from the mod and (game known) the game. `baseHas` probes
`unit\terran\marine.grp` and `sound\misc\buzz.wav` and answers null (unknown) for a kind the copy has neither of.
(A Remastered copy has both at the classic names — see "Remastered copy and the engine's reload" — so on either copy
both probes answer and the lints look.) `requirement`: graft entry ids past units/upgrades/techdata/orders by file name. `layout-mix`: expanded and
datex tables together (sfxdata excluded: GPTP reads sfxdata.dat).

## Proofs

1. The game's own data members (`gameSource` over `archiveFiles(fixtures/data)`: 11 tables, 6 TBLs, iscript, both AI
   scripts, every `unit\…` path images.tbl names = 832 GRPs + 96 overlays, the PCX palettes, jungle.wpe — 1,018
   members): unpack 22 s, pack 19 s, **1,018 of 1,018 byte-identical**, nothing kept as bytes. AI text has 71
   `raw_bytes` lines (padding). `mod check` on it: **no findings**.
2. Cosmonarchy's release folder (`release/`: the FireGraft exe's archive, then `mpq/`): info names it "Cosmonarchy BW"
   (the folder's one exe with an archive), 11 extended tables (10 `.datex`, sfxdata.dat expanded 20,000). Unpack
   26.7 s, 960 MB: 11 tables, 8 TBLs, 6 iscripts, AI (32,224 raw_bytes lines), 306 overlays, 6 grafts, **206 GRPs as
   PNG** (37 of them uncompressed GRPs, the interface pictures' own format; `units.md` has the finding), 1,441 GRPs
   kept ("another encoder"), 3,516 WAVs, 2,267 other files (the two dot files among them). Pack 13.1 s: **every member
   byte-identical**, plus the two FireGraft files back in as members; the MPQ (zlib) 774 MB in 52 s. The unpacked
   folder hashes as the release.
3. `tests/cli-mod.test.ts`, `tests/cli-mcp.test.ts` "the mod tools".

## Traps

- `/\.datex?$/` means ".date" + optional "x" — it does not match `.dat`. Use `/\.dat(?:ex)?$/` (cost a debugging run).
- A Blizzard archive's `(listfile)` is partial (BrooDat lists 22 files). As on the play page, a listed archive is its
  list and only a list-less one is probed, so BrooDat.mpq named as a mod reads as its 22 listed files. The proofs over
  the game's own data use `gameSource` (names given), not this.
- Building the CLI stamps `cli/package.json`'s version; restore it before handing back (`git checkout cli/package.json`).
- The overview holds 23 lines: `mod` took `about`'s row (`about` is hidden there, still works and is in the docs; hidden also drops it from shell completion, `tests/cli-maps.test.ts` says so).
- `tests/core.test.ts` walks `cli/src/**`; a walk of `cli/src/*.ts` alone leaves subfolder imports unchecked.

## Remastered copy and the engine's reload

Without the game layer below, `map test|trace|cost --mod` with an iscript/picture/startup-data mod on a **Remastered**
copy stops with "neither the mod nor the game has unit\zerg\avenger.grp". The command's reader (`gamefiles.ts`) is not
the cause: **the runner reads the installation itself** (it gets `--starcraft <folder>`): scm-sim
`src/exact/gameCopy.ts#remasteredFiles` reads, before the game, only the tileset names + `ENGINE_DATA` (its storage is
async and the game reads synchronously), so the reload's 928 `unit\…` files and `arr\mapdata.*` are never there.
`gamefiles.ts#storageFiles` answers every one of them, measured: all 928 images.tbl files (832 GRPs + 96
`.lo?`) present and **byte-equal to fixtures/data's 1.16.1 archives**, 11.6 MB; 1,118 of the 1,123 sfxdata sounds
(Remastered's own WAVs at the root names, 278 MB; 1.16.1's are under `SD/`); all 137 `PLAY_MEMBERS`.

The layer is on this side, because the runner takes `--mod` repeatedly (later wins) and reads a folder layer lazily
(`looseLayer`): `mod/overlay.ts#gameLayer` — on a Remastered copy, for a mod the runner will reload for (same rule as
scm-sim's `readsStartupData`: a `STARTUP_NAMES` file or a `unit\` file) — reads the `STARTUP_NAMES` plus every file
images.tbl names (the mod's images.tbl when it has one) that the mod has not got, from `gamefiles.ts`, 24 at a time
(~0.4 s warm, 935 files, 11.8 MB), writes them to a second temp folder, and the runner gets `--mod <game> --mod <mod>`.
No sounds: the reload reads only `sfxdata.dat/.tbl`; WAVs are asked for in play and a refused one is harmless (the
runner without a mod has none from Remastered either). A 1.16.1 copy: no layer (its archives hold them, the runner
reads those). Because the game layer is a mod layer, the runner's `start.mod` counts it: `ModOverlay.report` takes it
out (`paths` without it, `files` = the mod's own, `read` filtered to the mod's names, `game: n` added). The start
line's `mod` is kept: `TraceStartLine.mod` / `TestStartLine.mod` (`engine.ts#RunnerModReport`), in `map
trace|cost --json` and `map test --json` as `mod`, and printed under the first line by `engine.ts#modWords`.

Proof (Remastered 1.23.10.13515):
`tests/cli-mod.test.ts` "map trace --mod on a Remastered copy" — the runner tests' marine-and-depot scene, 40 EUD
rows reading the frame set (dword at image +0x18, images at 0x52F568, 64 bytes, used from slot 4999 down) of images
4980–4999, hyper triggers for 200 passes in 400 frames; the mod = the game's iscript with the marine's GndAttkRpt
`playfram 51` → 34. Reload served 936, **refused none**; frames 34–50 / 51–67 seen 345 / 95 passes without, 369 / 71
with (24 = 12 shots × marine + shadow moved). Without the layer the bundled runner fails as above (checked).
The same mod through `--starcraft fixtures/data` (1.16.1, no layer): the same 369 / 71.

Not done (scm-sim's side, read-only here): `gameCopy.ts#remasteredFiles` could hold the reload's files itself when a
mod reloads; then this layer is redundant (harmless: same bytes). Sounds by name in play on a Remastered copy are
still refused by the runner. `protoss\archon\parmin00.wav` is only under `SD/` in Remastered (neither the play set
nor `gamefiles.ts` falls back to `SD/`).

## Replays of a mod (R1)

A replay's `SCMJ` section names the mod by its hash. `scmjs replay info --mod`, `map trace|cost --replay --mod` check a
mod against it with `cli/src/replaymod.ts#sourceHashes` / `isTaggedMod`: the one rule below (with or without plugins),
and R1's two older forms (game files alone; those differing from the person's copy) for replays tagged before it.
Details and the loader proof: `cli-replays-mods.md` "A replay's mod".

## The mod hash, one rule

Decided (mods plan, "R1, as built"): a rule that compares a mod with the person's own copy hashes one release three
ways, so the hash depends on the mod alone. The play page's side is scm-sim `src/mods/inspect.ts`
`hashLines`/`pluginLine`/`firegraftLine`/`runningHash` and `web/modDrop.ts#buildMod`; here it is `@scm-js/mod`'s
(above), with core exporting `modHash`, `modHashOfDigests`, `hashLines`, `pluginLine`, `firegraftLine`, `probeNames`,
`cli/src/mod/hash.ts#sourceHash`, the editor's data set stamp (`gamedata.md` "Hash"), and Aftermath's `modreplay.ts`
(loose files only).

- One line per game name the mod lays over the game: loose files under its root and the members of its archives (an
  `.mpq`, the archive in a loader exe), lower case, backslashes. An archive's **list** is its files; only a list-less
  archive is probed (`probeNames` = the page's `namesToProbe` list + the archive's own images/sfxdata/portdata.tbl
  paths; the page also reads the person's copy's three tables there — the one place its set can depend on a copy). A
  listed member the archive does not hold (`fileInfo` null) is left out (`ModSource.unheld`, printed by `mod info`). An
  archive member `.qdp/.bwl/.fgp/.fgd` is never a game name.
- One line per plugin carried **as a file** (`.qdp`/`.bwl` anywhere in the folder): `plugins\<leaf>` lower case,
  first wins by leaf. A plugin *inside* the mod's archive is no line (the page does not load it).
- One line per FireGraft project `.fgp` (loose, or a member): `<leaf>` lower case. `.fgd` is no line.
- `name\tsha256`, sorted by name, joined `\n`, SHA-256, 16 hex. Without plugins = the same minus the plugin lines
  (the `.fgp` line stays): what a page running none presents (`runningHash` with nothing running).
- Loose-file rule, as the page's: `modRoot` looks at any depth (the page's); under the
  root, a file beside the game's folders, under a top `plugins/` or `firegraft/`, or a `.dll` is left out; `mod.json`
  at the top is the name, deeper it is a file. **Dot files count** (the page counts them); dot *folders* are still
  skipped here (`walk`, pack's `folderFiles`) — the page's drop walk does not skip them, so a `.git/` *under the mod's
  root* would be hashed there and not here (a page-side fix to ask for). Pack keeps dot files (`files/lua/.gitignore`
  round-trips) and leaves a top-level dot file out of "left".
- A mod folder (`mod unpack` output) packed in memory keeps code members (`Firegraft\*.fgp` back in as members) out of
  `source.files`, so it hashes as the release it came from.

**Test vector.** Cosmonarchy's release folder (read-only, `SCM_COSMONARCHY` or `SCMJS_COSMONARCHY/release`):
**`ac3f86533e4b5a31`**, without plugins **`b13e467fb5abb298`** — page's `buildMod` and `scmjs mod info` alike, and the
unpacked folder too. 7,777 lines: 7,769 game names + 7 plugin lines + `cosmonarchy bw.fgp` (the page's `built.lines`
is 7,770, which holds the `.fgp`). A walk that skips dot files counts 7,767; the line-by-line diff of the game names
(page vs such a walk) is exactly two, both dot files:

```
433d432   < lua\.gitignore
7366d7364 < unit\cmdbtns\.cmdicons.grp-ojvamg
```

Not the six phantom members (both leave them out: `fileInfo` null), not case, not `.qdp`/`.fgp` counted as game
names. `plugins\apply`, `plugins\pluginlist.txt` and five `firegraft\*.txt` are game names (members of the exe's
archive), on both sides.

**`mod play` hands every file** (no comparison with the copy; the page keeps those that differ), loose
plugins under `plugins/`, FireGraft files under `firegraft/`, and the game names the page would not take loose
(`play.ts#notLoose`: no folder, top `plugins\`/`firegraft\`, `.dll`/archive/code extensions — Cosmonarchy's 7 above)
inside one stored MPQ `scmjs-members.mpq`. Proof: the hand-over run through the page's own `buildMod` (pieces as
`inputFromHanded` makes them) gives `ac3f86533e4b5a31` / `b13e467fb5abb298` for the release and the made mod's pinned
values. Without the MPQ the page's hash of a hand-over loses those 7 lines.

**Made mod** (`tests/mod-hash.test.ts`, no game data): loose `arr/units.dat`, `lua/.gitignore`, `plugins/x.qdp`,
`y.fgp`, `y.fgd`, `README.md`, and `made.mpq` (`rez\stat_txt.tbl`, `sound\made\new.wav`, `plugins\apply`); the page's
tool on the same folder: **`a8069f18058ec876`** / **`ac98e7b447476c80`**, pinned. The test checks the CLI (folder,
unpacked folder), `playSet`, and the replay forms against them.

Known gaps: `mod pack --folder` writes members loose, so a loose copy of a mod whose archive held `plugins\…`,
`firegraft\…` or top-level members, or whose plugins were loose beside it, hashes otherwise on the page (only an MPQ
carries those); the editor's folder route takes loose files only under `GAME_FOLDERS` (the page: anything under the
root) and orders own archives by name (the page: as given); the page's `GAME_FOLDERS` lacks `datreq`, `samase`,
`lua`, `config` for finding the root (scoring only).

### An operating system's files have no line

**Why.** `desktop.ini` and its kind are not handed over alike by every route, so a rule that counts them names a
mod by how its folder was read. Decided (the user's): the rule leaves them out everywhere, and the hash
with their lines stays accepted as an older form wherever hashes are matched.

**The list** is `SYSTEM_FILES` / `isSystemFile(path)` (the package's; core exports both), by name alone, any case, either
slash: names `desktop.ini`, `thumbs.db`, `ehthumbs.db`, `ehthumbs_vista.db`, `.ds_store`, `icon\r`, `.directory`; a
name starting `._` (AppleDouble); anything under a folder `__macosx`. Only names certain never to be a game file. The
same list is copied in scm-sim (`src/mods/inspect.ts`), plugin-aftermath (`modreplay.ts`) and plugin-mods (`source.ts`,
until it can take core's): change all four together.

**What a browser's folder handle hides** (so what the list had to cover at least). Not a Windows attribute and not in
the File System Access specification (it only forbids "", ".", ".." and separators, and leaves the rest to the
implementation): Chromium's `FileSystemAccessManagerImpl::IsSafePathComponent`
(`content/browser/file_system_access/file_system_access_manager_impl.cc`), which directory iteration applies to every
child (`FileSystemAccessDirectoryHandleImpl::DidReadDirectory` → `GetChildURL`) on every system. Read at Chromium's main
and at release tags 131 to 150; measured in headless Chromium 153 on Linux with a dropped folder of 45
probe names, its entry walk against its handle walk (27 hidden):

- `base::IsReservedNameOnWindows`: the names `desktop.ini`, `thumbs.db`, `conin$`, `conout$`, and a device name
  (`con`, `prn`, `aux`, `nul`, `com1`–`9`, `lpt1`–`9`, `clock$`) alone or before the first dot (`aux.wav`, `nul.txt`);
- extensions `.lnk`, `.scf`, `.url`, and a `{CLSID}` extension;
- `base::i18n::IsFilenameLegal` after one leading dot is dropped: any of `"*/:<>?\|`, a control or format character
  (so `Icon\r`, a soft hyphen, a zero-width space), a first or last character that is white space, `.` or `~`
  (`~x.wav`, `x.wav~`, `..x`, a trailing dot or space);
- **Windows only, read from the source and not run**: file types the download table marks DANGEROUS
  (`download_file_types.asciipb`: `.ini`, `.cfg`, `.dll`, `.manifest`, `.scf`), and a `~` in a name that could be an
  8.3 short name.
- Seen by the handle: `.DS_Store`, `._x`, `__MACOSX/`, `.directory`, `ehthumbs.db`, `.gitignore`, `x.local`, and on
  Linux `x.ini`, `x.cfg`, `x.dll`, `x.manifest`.

Of these only `desktop.ini`, `thumbs.db` and `Icon\r` are on our list. The rest may be a mod's own files
(Cosmonarchy's `mpq/samase/config.ini`, `mtl.ini`, `mtl_campaign.ini`: on Windows Chrome a handle would not hand them
over), so they keep their lines: a route that cannot read one has a mod short of a file, and another hash is the truth
about it. **That gap is in the reading, not in the hash**: closing it means not reading a mod's folder through a handle
alone (an entry walk, `<input webkitdirectory>` and Node see everything). A folder dropped on the editor is listed by
its entry and only read by its handle (`plugins-host.md`, "A dropped folder is listed by its entry and read by its
handle"); the folder picker has only the handle and stays short.

**Where the filter is.** (1) In the hash: `hashLines` drops a system file's line itself, `modHashOfDigests` marks a
digest by the name it was given (a plugin's line keeps only the leaf, so `__MACOSX/y.fgp` is told there), and
`dataSetHashOfDigests` filters; any caller gets the same hash whatever list it made. (2) Where the list of a mod's
files is built, so counts agree and nothing of theirs is taken for the mod's: loose pieces are tested first of all,
before the plugin and archive tests (otherwise macOS's `._gptp.qdp` is a plugin), and archive members too;
`pack.ts#folderFiles` (the `desktop.ini` Explorer puts in a mod folder's `sounds/`); the editor's `folderSet.ts`. The
files themselves may stay in a kept or installed copy: nothing asks for them.

**The older form.** `hashLinesAsWere` is the rule with those lines. `ModHash.older { hash, withoutPlugins, left }` is
there when system files were among the digests given: `sourceHash` → `older`; `replaymod.ts#sourceHashes` →
`ModHashes.older[]`, which `isTaggedMod` takes. `mod info` prints `Older hash … (with …, which the hash leaves out)`
and `--json` has `older`. Not worked out again: a mod whose AppleDouble half of a plugin or project (`._x.qdp`) was a
plugin's line under the older rule; the editor's stamp (a data set installed under the older rule keeps the hash it
was stamped with until it is installed again; nothing in the editor compares hashes — a map's data set is matched by
id — and the play page takes an older stamp by its own older form).

**Measured** on Cosmonarchy's release (`/mnt/c/Cosmonarchy/Release`, copied to a Linux disk; 7,796 files,
`mpq/sound/desktop.ini` and `mpq/sound/cm/desktop.ini`, 44 bytes each). A finding first: **the two files are also
members of `temp.mpq`**, the archive the mod's hotloader packs `mpq/` into when the game is launched, so every route
that reads archives meets them whether or not the loose files are handed over. Over four trees (with and without the
loose files, each with and without `temp.mpq`) every route — `scmjs mod info`, the play page's `buildMod` (in Node),
scm-sim's runners (`modHashOf`: the exe's archive and `mpq/`, no `temp.mpq`), the Mod Editor (`session.hash()`), the
editor's data set stamp (the worker's `onmessage` in Node) — gives `20e1c6d89ae2af75`, without plugins
`db23a1f9dd8cef66`, 7,767 files; Aftermath's `folderHashes` (loose files only) gives `cb799542a475430f`. `older` is
`1c41a2d7701fe842` / `49815591a7a5a504` wherever the two files were seen, loose or in `temp.mpq` (Aftermath:
`75c10a2152fb8e0e` when loose). The made mod's pinned values (`a8069f18058ec876` / `ac98e7b447476c80`) hold none.

## `mod header` (C4 of the capstone)

`cli/src/mod/header.ts`: `<Mod>.h` (C++17, `inline const BWAPI::UnitType X(id);` in `<Ns>::UnitTypes` / `WeaponTypes`
/ `UpgradeTypes` / `TechTypes`, `constexpr int` in `<Ns>::Ids::{Units,Weapons,Upgrades,Techs}`, `MOD_NAME`, `MOD_HASH`
= `sourceHash().hash`, the full one) and `<Mod>.ids.json`; `--bot` adds `mod: { name, hash, link? }` to the bot's
`scmbot.json` (in place when present, else last; `link` from `mod.json`'s `link`/`url`/`homepage`). The toolchain side
(the `.scmbot` header's `mod`, the runners' "made for" line) is scm-sim's, `docs/mods-plan.md` "C4, as built".
- **Names** (`modNames`): `loadModData` → `namesOf` with two GPTP additions found on Cosmonarchy. (1) `rez\stat.txt`,
  PyTBL text a plugin loads as the game's strings: weapons' labels are 2000+ and `stat_txt.tbl` has 1,813 entries.
  It fills only entries the tbl leaves empty or does not reach — **not** an override: at the techs' labels (313…) the
  text holds button tooltips ("Memphis Requires: Scrapyard") where the tbl is empty or right. (2) `arr\weapons.txt`,
  `upgrades.txt`, `techdata.txt`: the makers' name lists, one line an entry, taken over the labels when the line
  count equals the table's count (1,001 / 100 / 100); the techs' labels are junk without them. Units stay
  `unitnames.tbl` (as the editor and the page); `arr\units.txt` (3,003 lines) is not used.
- **Identifiers**: runs of non-`[A-Za-z0-9_]` → `_`, trimmed; leading digit, a C++ keyword or a Windows macro name →
  `_` prefix; nothing left → `<Kind>_<id>`; duplicates: first keeps, later `_<id>`. Skipped: empty, None, Reserved,
  Unused (with a bracketed subname too), `*`, `Extended Tech #n` (a data editor's filler).
- **Cosmonarchy** (release, hash ac3f86533e4b5a31): 621 units, 330 weapons, 67 upgrades, 54 techs, all identifiers
  unique; Mason 7, Ministry 106, Supply Depot 109, Stockade 111, Quarry 174, Talos 20, Maverick 0, Sieve 419,
  Ogun 494 (worker mode) / 497 (smithy mode). The header compiles with the toolchain's flags, plain and MSVC-compat
  (em++ -std=c++17 against `native/` of scm-sim). 4.7 s, mostly the hash.
- **`--js`** (scm-sim js-bots J4): `<Mod>.mjs` (`moduleText`: `MOD_NAME`, `MOD_HASH`, four frozen objects,
  a default export) and the ids JSON, no `.h`; refused with `--bot`. Identifiers by `jsIdentifierOf` (no C++
  keyword/macro prefix) — the rule scm-sim's `src/bwapi/jsData.ts` copies for a JavaScript bot's `init.data.UnitTypes`
  in a mod's game, over names read as here (scm-sim `readUnitLabels`: unitnames.tbl whole entries, stat_txt for <228,
  "Name (Subtitle)"). **Keep the two in step**: on Cosmonarchy (hash c94acdf31982fa4b) all 621 unit names agree
  (checked by a bot importing the module in a game). Weapons, upgrades and techs are not renamed at run time (BWAPI's
  names): the module is how a JavaScript bot gets the mod's names for those.
- Tests: `tests/cli-mod-header.test.ts` (made mod: tbl/unitnames names, a 230-unit `.dat`, stat.txt fill, a name list,
  `--namespace`, `--bot`, `--js` imported as a module).

## `bot run --mod`, `bot ladder --mod`: overlay 2 (C4)

- **Overlay version 2** (`engine.ts`: `MOD_OVERLAY` 2, `MOD_CODE` 2; `modArgs(engine, layers, need = 1)`): files-only
  commands (`map test|trace|cost`, `mod test`) still ask for 1, so an engine of 1 keeps serving them; `bot run` and
  `bot ladder` ask for 2 and an engine of 1 is refused with the sentence naming what 2 adds. scm-sim writes `"mods": 2`
  (`scripts/lib/engine-current.mjs`, `src/exact/modRunner.ts`).
- **What 2 carries** (`modOverlay(path, base, { code: true })`, `writeCode`): the temporary folder gains `plugins/`
  (the plugins the mod carries as files; one inside its archive is not loaded by the page, so not written),
  `firegraft/` (the `.fgp` and `.fgd`, from the patcher exe's archive for a release) and `mod.json`
  `{ name, hash, withoutPlugins, link? }` from `sourceHash`. **The runner takes `mod.json`'s hash as the mod's**:
  the loose folder cannot be hashed again to the same lines (a release's `plugins\apply` and `Firegraft\*.txt` are
  archive members of its exe that `writeLoose` puts under `plugins/` and `Firegraft/`, which both the page's loose
  rule and the runner's walk leave out). Given a release folder directly, the runner works the hash out itself by the
  same rule and gets ac3f86533e4b5a31 (scm-sim `src/bwapi/modCode.ts`).
- **The start line** gains `game` ("ums" | "melee"), `code` (`RunnerCodeReport`: name, hash, without plugins, each
  plugin's init in the runner's words, those skipped, the FireGraft project and its edit count, hash ms) and `fit`
  (`BotFitReport`; the ladder's start has `fits` by side). `codeWords` / `fitWords` word them (translated: the runner's
  own `words` are English and not shown). The ladder prints them once, after the first game that has a start, and
  `ladder.json` keeps `mod` per game.
- `--ums` / `--melee` pass through; the runner's default is the map's own settings when the map looks made for them
  (the page's `looksLikeMapSettings`) or the mod has plugins.
- **Proof** (a local engine folder with `current.json` `mods: 2` and the bundled runners): `bot run
  cosmonarchy-example.scmbot "(4)Exodus 1.0.scx" --mod <release> --race terran --seed 7`: "made for Cosmonarchy BW",
  4 plugins, FireGraft 7 edits, defeat at frame 11,308, 12.26 + 0.52 ms a frame, 150.9 s.

## `mod play --bot`, `mod_header`, `mod_play` (C6 of the capstone)

scm-sim `docs/mods-plan.md` "C6, as built"; the page's side is scm-sim's `web/handed.ts`
`readBot`, `web/main.ts` `handedBotKey`/`seatedBotRow`, `web/setup.ts` `choose`, `web/smoke-mod-play.mjs`.
- **`mod play <mod> --map <map> --bot <bot> [--race r] [--start]`** (`cli/src/mod/play.ts`): `playBotOf` — a path
  (`.scmbot`, a separator, or an existing file) is read and handed as bytes, else a key (`[A-Za-z0-9][\w.-]{0,63}`,
  the page checks it against its catalogue); `pageRace` (z/t/p/r and the names → 0/1/2/6); `--bot` needs `--map`,
  `--race` needs `--bot`. `handoffExtra(set, o)` is what the manifest gains as `handoff` (absent without a bot, so
  a manifest without one keeps its shape): `setup: true` unless `--start`, `useMapSettings: true` for a mod with plugins or a
  FireGraft project (the runners' rule) else `null` (the page's guess — **send null, not absent**: the page reads an
  absent `useMapSettings` as true, the first editors' default), `bot: { key | file: <name>, race? }`. The loopback page
  fetches `/<token>/bot` for a file and posts `bot: { file: File, name, race? }`. `PlayOutcome.bot` is the row the page
  answers `shown`/`started` with; `scmjs.play.waiting` (the page's sign-in for a catalogue bot) prints as
  `scmjs.waiting` does; `ready` is forwarded and printed ("ready", then "ready again" after the page loads on the
  kept mod).
- **`?lift=live` (all `mod play`, not only `--bot`)**: a mod with plugins or a FireGraft project is handed to the page
  at `?lift=live` unless the address has a `lift` already (`PlayOptions.lift` overrides): the page runs a mod's plugins
  only there, and without it Cosmonarchy runs without its plugins.
- **`--start` without `--bot`** changes nothing: a handed map without `setup` starts at once.
- **MCP**: `mod_header` (path, out, namespace, bot, starcraft; `destructiveHint`) → `writeModHeader`, the data its
  `HeaderResult`. `mod_play` (path, map, bot, race enum, start, wait 10–900 s, starcraft; `openWorldHint`) →
  `playOnPage` with `onAddress` kept: the text is the outcome, `Hand-over page: <link>`, the page's message types; the
  data `{ link, name, hash, withoutPlugins, files, started, shown, error, bot, said }`; a page error is `isError`; the
  timeout's CliError gains the link. Its live lines go to stderr. `map_trace`/`map_cost` have `mod` (the commands'
  `--mod`: `modOverlay` handed to `runMapInGame`, removed after).
- **Help**: `bot run` and `bot ladder` say `--mod` needs `"mods": 2`; `bot build` says it needs Docker.
- **Tests**: `tests/cli-mod.test.ts` "scmjs mod play --bot" runs **the loopback page's own script** in a `vm`
  context (fetch, File, `open`, `addEventListener` stood in) and checks the message it posts after `ready` — key and
  file, `setup`, `useMapSettings`, `?lift=live` kept beside the address's own query; `tests/cli-mcp.test.ts`
  "mod_header and mod_play" plus the tool list and `map_trace` `mod` on an engine without mods.
- **Proof** (the real CLI against a dev server, scm-sim `web/smoke-mod-play.mjs`): see scm-sim's record.

## A copy of the game is not the mod

**Why.** A mod is often handed over inside a folder that also holds a whole game copy: `C:\Cosmonarchy` has `Release/`
(the mod as shipped) beside `Starcraft/` (a whole 1.16.1 copy: `StarDat/BrooDat/patch_rt/StarCraft/BroodWar.mpq`,
`StarCraft.exe`, `Maps/CMBW-Root/CMBW-editor/CMBW-editor.mpq` and `…/grafting/graftc.exe`). An opener that lays every
`.mpq`/`.exe` it finds as a layer of the mod makes the game's archives the mod's files: in Windows' folder order
(`StarDat.mpq` last) the mod carries original StarCraft's 34,880-byte `scripts\iscript.bin` and a replay fails ("script
12052 at 167 lacks the SCPE marker"); in byte order `patch_rt.mpq` comes last instead, so it carries 1.16.1's iscript
(40,482 bytes, from `Starcraft/patch_rt.mpq`), `arr\units.dat` from patch_rt and `arr\images.dat` from
`CMBW-editor.mpq`: wrong in another way, and a hash no other route gives.

**The rule** (the same in scm-sim's play page and plugin-mods' Mod Editor: change all three together). A folder that
directly holds `StarDat.mpq` (any case) is a copy of the game; `gameCopyFiles` names `GAME_ARCHIVES` directly in that
folder and **every file under its `Maps` folder** (any case, any depth). None of them is read or is the mod's. In the
walk an archive by name (`.mpq`/`.exe`/`.zip`, so the five too) goes to `gameCopy` and is said; any other (a map, a
campaign's music) goes to `left` like every file outside the mod, and never reaches the loose files, so it neither
scores a root in `modRoot` nor counts for the refusal. A copy's `Maps` is the person's maps folder: taking only
archives there is not enough — Cosmonarchy's `Starcraft/` alone would open as "a mod" of 441 files, because its
campaigns sit at `Maps/CMBW-Root/CMBW-maps/campaign/…` and `campaign` is one of `GAME_FOLDERS`, so that folder would
become the root. Everything else in the game folder (a mod's own exe or archive dropped in, loose `arr/…` files,
plugins) is read as usual. Applied to each list a walk is given — a folder's files, a zip's members — never to a single
named file: `scmjs mod info patch_rt.mpq` (old mods ship so), even `StarDat.mpq` named alone, opens as a mod.

**Where.** `GAME_ARCHIVES`, `gameCopyFiles(paths)` are the package's (re-exported in core's Mods block). CLI:
`ModSource.gameCopy` (the archives, paths as the folder/zip spells them with its own name stripped, sorted; not in
`left`, which means "not the game's"). The sentence is a ▲ line in `mod info` (so `mod_info` over MCP), `gameCopy` in
`--json`, and an English note in `mod unpack`'s `mod.json` (`inEnglish`, so `mod_unpack`'s lines too). No other command
prints `probed`, so none prints this. When a copy was left out and nothing of a mod remains, the refusal (`copy-only`)
is exit 2: "{folder} is a copy of the game, and there is no mod in it." Nothing remains (the same in the three
repositories) = no archive laid as a layer, no plugin or FireGraft file, and no loose file (a zip's members count as
loose) with a `GAME_FOLDERS` segment other than `maps` before its name — what `modRoot` scores. Read-me, dlls,
`lua_lsp/`, a `Shaders/*.zip` of `.glsl` files and anything under the copy's `Maps` do not make a mod. No documented or
tested flow hands the game's own folder to `scmjs mod` (`gameSource` takes the game's files by name;
`overlay.ts#gameLayer` reads `gamefiles.ts`; the check tests' "game" is loose files).
Not affected: Add a data set from a folder (names the three archives on purpose), the hash rule, layer order
otherwise, `temp.mpq`.

**Measured** (`scmjs mod info --json`, `/mnt/c/Cosmonarchy`, ~50 s each): the root reads as `Release/` does — 7,767
files, `20e1c6d89ae2af75` / `db23a1f9dd8cef66`, layers `Release/Cosmonarchy BW.exe`, `Release/temp.mpq`,
`Release/mpq/` (with the copy's archives laid as layers it is 7,892 files and `898987e2e9b750b4`); `gameCopy` is 7
files (the five archives, `CMBW-editor.mpq`, `graftc.exe`). `scmjs mod info /mnt/c/Cosmonarchy/Starcraft` (the copy
alone) is refused, exit 2. Tests: `tests/mod-game-copy.test.ts` (made archives only; the last suite runs only where
`SCMJS_COSMONARCHY_HANDED` names the folder, ~50 s).

## Races a mod adds

The contract is shared with Aftermath and the play page (scm-sim `docs/mods-plan.md` keeps the durable record): a race
is a byte, 0–7 the game's, anything else the data set's; carried unchanged everywhere; `Race {n}` when unnamed. Found
on a Cosmonarchy replay (a player of race 69, the mod's fourth race; ids 69–71 are in the plugin's code, never a file).

- **Core** `src/formats/mod/races.ts` (exported in core's Mods block): `DataSetRace { id 8–255, name ≤ 40, letter?,
  like? 0|1|2 }`; `normalizeRaces(unknown)` (never throws; invalid rows dropped, a bad `letter`/`like` dropped from a
  row that stays, first of a duplicate id wins, extra fields kept, sorted); `sameRaces`; `GAME_RACE_NAMES` (from
  `PLAYER_RACES`, English); `raceLabel(id, races = [])` (= `playerRaceLabel` with no table; a row cannot take 0–7);
  `raceChoices`; `raceCandidates({ network, gameNetwork?, paths })` — names past the game's `rez\network.tbl` length
  (the copy's, else `GAME_NETWORK_TBL_ENTRIES` = 168, BrooDat's; StarDat's has 142) and letters ∉ {z,t,p,n} with
  `game\<x>console.pcx` or `rez\statbtn<x>.bin`; `racePlaysAs(unitIds, { groupFlags })` — per-bit counts of group
  flags bits 0–2, the most; a tie, no flags or no units → null.
- **mod.json** `ModManifest.races?`: `readManifest` and `tidyManifest` normalize and **delete the key when empty**, so a
  manifest without races serialises byte for byte as one written without the field. `ModSource.races` (CLI): `packFolder`
  sets it from the manifest; `describedSource` from a top-level (or one-down) `mod.json` beside the name. `mod unpack`
  writes the source's races, else those of the folder's earlier `mod.json` (a new release unpacked over keeps them).
- **Hash**: top-level `mod.json` is out of the hash (a folder's name file; a mod folder's manifest is never a
  member). `tests/races.test.ts` pins it: raw folder with/without `mod.json` races, unpacked folder with/without.
- **CLI**: `mod info` `races` + a `Races` row; `mod check` `hints: string[]` (`racesHint`, `modRaceCandidates` — reads
  the mod's and the copy's `network.tbl`), printed with `mark.info`, not counted in errors/warnings, never fails;
  `mod play --race` / `mod_play race` (a string) take a declared name or id (`pageRace(race, source.races)`, parsed
  after the mod is opened). Measured on the release: candidates Askosi, Bloodsummon, Kogri, Forerunner (168–171) and
  letters a, f; the race-69 player's 52 build orders plays as Terran (1).
- Editor routes in: the Game Data dialog's folder route reads a `mod.json` directly in the picked folder
  (`modInput.ts#pickedDataSet`); a plugin's `api.gameData.setRaces`; a map's `dataset.json` for the set in use.
  Not done: an editor dialog to name races; `api.gameData.raceCandidates` gives nothing for a stored copy
  (`gamedata.md`).

## A patcher exe's overlay, and an archive whose tables lie before its header

Found on two mods kept outside every repository (SC Revolution 2.2, Burning Ground 2.00); the fixes are general and
name neither. mopaq 1.6.3 (`Archive.open(data, { offset })`) is needed.

**FireGraft's patcher overlay** (`exeArchive`, core's `legacy.ts`; the same reader is scm-sim `src/mods/unpack.ts`, and
the layout with its evidence is scm-sim `docs/patcher.md`). Five samples, two builds of the program ("FG Patcher",
`PatchLoader.pdb`): the program's own header holds the overlay's offset at 0x18 (the program seeks there and reads
`PEGF`; all five = the program's end). Then u32 **count**, u32 **form** (1 in all five; copied through by the program),
and per plugin u32 id, u32 size, u32 0 **and its bytes at once** (interleaved: read from the program's code — after
`PEGF` it reads the count into its loop counter, then per plugin three words and `size` bytes). No terminator; the
archive follows at a 512-byte boundary, where storm looks. Count and form swapped with the entries grouped reads right
only for one plugin (Cosmonarchy, SC Revolution): Burning Ground's two (`EUDE`, GPTP) then read as "MPQDraft's
self-executing MPQ" with none. TriFresh / remove-protoss (count 0) are FireGraft's patcher with no plugins, not
MPQDraft's, and say so. Refused with `PatcherError`
(a `ModSourceError`; `what` in a few English words, the sentence through `t()` in the CLI and the editor's install): a
form other than 1, more than 256 plugins, a third word not 0, a plugin past the file's end or not starting `MZ`, a
patcher with no archive after it. `libraryName` names a plugin by its export directory (`GPTP.qdp`, `GPTP-v2.41.qdp`;
the UPX-packed EUD Enabler says `qdp.dll`); `mod info` prints `name, id <hex or four letters>, size`.

**`ExeArchive` is `bytes` (the whole exe) and `at`**, not a slice from the header: every caller opens
`Archive.open(found.bytes, { offset: found.at })`, because a slice cannot reach tables before the header.
`mpqHeaderAt` does not believe a version 0 header's own size (SC Revolution writes 0xFFFFFFFF); it requires the
tables' wrapped positions inside the file instead (believing the size rejects the header, so `exeArchive` returns null
and `mod info` says "Files 0 · 0 B" with no word why).

**mopaq 1.6.3** (its CHANGELOG has the rules and StormLib's places): positions modulo 2^32; a cut table read as far as
it goes (block table cut, hash table's missing slots empty); a table of 256 MB or more is a fake header; header size
and archive size not believed; the scan passes over a fake header. **And storm's lookup**: StarCraft 1.16.1's
storm.dll (0x15014610) returns an entry of the asked locale at once but otherwise keeps the *last* neutral match. SC
Revolution puts a garbage decoy (flags `0x80020100`, IMPLODE|ADJUST_KEY without ENCRYPTED, bytes of nothing) at each
name's home slot and the real entry later; taking the first match reads the decoy (`units.dat` 61,062 bytes of
nothing), mopaq reads the real one (19,876). 490 of its 732 named slots are such decoys or fillers.

**SC Revolution** has no `(listfile)`: the CLI probes (`probeNames`) and finds 205 files (11 tables of 1.16.1's sizes,
both AI and iscript, 91 pictures, 97 sounds, 4 string tables), hash `90b8c22d9cb4ba31`. Its FireGraft project
(`Firegraft\ModDatResurection - New.fgp`, named by the patcher's own `Firegraft\datalist.txt`) is **not** found here:
the probe list has no FireGraft names, and adding them would change list-less archives' hashes on one side only
(the page's `namesToProbe` would need the same). scm-sim's runners find it through the datalist for loading only.

**Libraries beside the exe**: `libraries` in `mod info` and `--json` (for an exe named alone, the `.dll`s in its
folder; in a folder, those in the exe's folder, still in `left`). Burning Ground's GPTP imports 17 functions from
`fmod.dll` (beside its exe), so it cannot load without it; Cosmonarchy's folder has `discord_game_sdk.dll`. The hash
rule leaves `.dll` out (a plugin inside the exe has no line either).

**What each command does with the patcher's own plugins**: `mod info` lists them (`exes[].plugins`: id, at, size,
name; never bytes); `mod unpack`, `mod play` and the bot runners' folder (`overlay.ts#writeCode`) carry only plugins
that are files, so none of these. The page does not run them (scm-sim `web/modDrop.ts` names them only).

Measured (`scmjs mod info`):

| exe | read |
| --- | --- |
| SC Revolution 2.2 (21 MB) | 205 files · 41.1 MB, 1 plugin (GPTP-v2.41.qdp), probed, `90b8c22d9cb4ba31` |
| Burning Ground 2.00 (519 MB) | 2 plugins (qdp.dll id EUDE 13 KB; GPTP.qdp 483 KB), ▲ fmod.dll; 2,882 files, `0ed055cf80a95bd0` both |
| TriFresh | "FireGraft's patcher"; 66 files, `ea488d3ac3575bda` both |
| remove-protoss | "FireGraft's patcher"; 11 files, `fbd2edc992e7377e` both |
| Cosmonarchy BW.exe | qdp-hotloader.qdp named, ▲ discord_game_sdk.dll; 7 files, `e18fe9901e9edd71` both |
| Cosmonarchy release folder | 7,767 files, `20e1c6d89ae2af75` / `db23a1f9dd8cef66` |

Tests: `tests/cli-mod.test.ts` "reads FireGraft's patcher in both forms…" and "says why an exe is not read…", the bytes
made by `tests/support/patcherExe.ts` (a copy of scm-sim's). Not done: `mod unpack` writing the patcher's plugins out;
any hash line for them (a decision for all four repositories).

## Open

- The hash is one rule everywhere ("The mod hash, one rule" above, with its known gaps).
- The Mod Editor plugin's API asks (reader `under`/`member`, `rehash`, `storedPath`, the worked-out manifest, folder
  picks and drops) are in `plugins-host.md` "The Mod Editor's asks".
- The runners' `--mod <folder>` and `current.json` `"mods"` (2) are scm-sim's to publish with a deploy.
- `map run` (plugins, no engine) has no `--mod`; `map test|trace|cost` and `mod test` do.
- iscript header comments (images using an id) are not written; table comments are.
- Writing a 1 GB MPQ holds every member and the output in memory (~2 GB for Cosmonarchy).

## Terrain a mod declares

`terrain.json` beside `mod.json` (found by `mod.json`'s rule — `formats/mod/terrain.ts#isTerrainFilePath` mirrors
`@scm-js/mod`'s `isModJsonPath`, which the package does not export for another name — and needing no `mod.json`): per
tileset `{ table, terrains, pieces, borrow }`, what `provideTypes` / `providePieces` / `provideBorrowTable` take, so
every user of the mod gets them without learning or scanning. **Core** `src/formats/mod/terrain.ts` (exported beside the
races functions): `readTerrainFile` never throws (bad rows dropped with `{at, reason}`; limits `TERRAIN_LIMITS`; a
`format` other than 1 uses nothing and keeps the whole; unknown keys kept per level, an unknown tileset name kept under
the file's extra and written back), `writeTerrainFile` (fixed key order, one row per line: a 3,373-piece file diffs by
row), `withTerrainSection`, `sectionAgainstTable` (rows the loaded table has no pictures for), `terrainFileCounts`.
A borrow row also carries `standIns` (source tiles whose tile is only the nearest picture): without it a
file offers more than the scan does (Ashworld's Dirt in Cosmonarchy's Badlands: its 21 stand-ins are past the tenth
`borrowableTerrains` allows, but a provided table has no stand-ins to count); `providedTable(…, standIns)` marks them, and
`BorrowTableSpec.standIns?` is the optional API twin. **Hash**: not one of the mod's files (top-level or one-down, not in a
game folder: `@scm-js/mod` never reads it as a member); `tests/terrain-file.test.ts` pins `sourceHash` with and without
it; measured on Cosmonarchy's release copy: `c94acdf31982fa4b` both ways. **CLI** (`cli/src/mod/terrain.ts`):
`ModSource.terrain` (`describedSource` reads it from the tree beside the mod; `packFolder` from a mod folder's root);
`mod info` `terrain: {path, tilesets: counts, dropped}` and a `Terrain` row per tileset; `mod check` warnings
`terrain-file` (each dropped row, each row the table has no picture for) and `terrain-table` (a section whose `table` is
not `tableHash` of the mod's own `tileset\<id>.cv5`, else the game copy's; neither → a note); `mod unpack` writes the
release's `terrain.json` as it was, else the one of the folder unpacked over (`modTarget` reads it before the folder is
cleared, `earlierTerrain`). `mod pack` does not put it in the MPQ (it is not a game file).
**Borders:** a section may carry `borders: [{ source, terrain, ground, shapes:
{ shape: [tile, …] } }]` — a drawn border between a borrowed terrain (`terrain`, the source's CV5 index) and the host's
ground (`ground`), shapes named as `editor/modTerrain/borderLattice.ts` reads them (terrain.md "Drawn borders"). Read with the same
never-throw rules (limits `borders` 2048 rows, 1024 shapes a row, 80 characters a shape, 64 tiles a shape; new drop reason
`terrain` for an index outside 0–255; a second row for one pair is `duplicate`); `sectionAgainstTable` flags a row with a
tile the table has no picture for; written one row per line after `borrow`, only when there are any (a file with none
reads as one without the field). `tests/terrain-file.test.ts`'s example of an unknown key kept is `shading`. **Save as a terrain file…** writes every pair's table the editor has (learned, the file's, a
plugin's) — Cosmonarchy's Badlands after learning 404 maps: 74 borders, 984 shapes, the file 518,081 → 579,597 bytes.
`mod info` counts borders and shapes per tileset; `mod check` warns on their rows like the others. In the editor the
section goes into `providedBordersAtom` under `@dataset:<id>`, behind any plugin's (`beforeDataSet`). Measured: a data
set added from a copy holding that file, nothing learned or scanned, draws the border on the first Substructure stroke
(56 cells drawn, 2 hard).

**`terrain.json`'s `copies` section:** rows `{ terrain, height, ground: {terrain}|{pair}, pieces: [[piece, tile]…] }`
(`formats/mod/terrain.ts#TerrainFileCopy`, at most `TERRAIN_LIMITS.copies` 256 a tileset, dropped as `terrain` / `pair` /
`empty`); written only when non-empty, so older files and older editors are unchanged (an older editor keeps it as an unknown
key). `mod info` counts the blocks per tileset, `mod check` lists rows whose tiles are past the table or pictureless
(`sectionAgainstTable`), `mod unpack` keeps the file as it was. In the editor, `applyDataSetTerrain` turns them into
`providedCopiesAtom` rows under `@dataset:`; **Save as a terrain file…** writes every offered block with the ground it is
drawn for. See terrain.md "Copied terrain".
