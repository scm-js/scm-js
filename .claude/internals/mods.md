# Mods: the folder and `scmjs mod`

Slice M3 of the mods plan (scm-sim branch `mods-plan`, `docs/mods-plan.md`; built 2026-11-08 on branch `mod-cli`, from
`mods-formats` = M2's codecs, see `units.md` "Codecs for mods (M2)"). The reader's page is `docs/mods.md` (the
fifteenth guide) and the "Mods" page of `docs/cli.md`.

## Where things are

- **Core (pure, exported from `core/src/index.ts`, "Mods: a mod as a folder" block):**
  - `src/formats/mod/sources.ts` — `gameName` (lower case, backslashes: the key everywhere), `modRoot` (the game's
    paths at the root or **one folder down only**, so `unit/terran/` under a root is not a second root),
    `exeArchive` (FireGraft `PEGF` overlay first, then SEMPQ at 512-byte boundaries after the PE's last section, then
    any `MPQ\x1A` with a sane header), `readZip` (central directory, stored + deflate via
    `DecompressionStream("deflate-raw")`, no zip64/encryption), `dataSetHash`.
  - `src/formats/mod/hash.ts` — the mod hash (`modHash`, `modHashOfDigests`, `hashLines`, the line forms) and
    `probeNames` for a list-less archive; "The mod hash, one rule" below. `sources.ts` holds `SYSTEM_FILES` /
    `isSystemFile`: an operating system's files, which have no line and are no file of a mod's.
  - `src/formats/mod/folder.ts` — the form: `placeOf(member)` (rule: member → folder file), `memberOf(file, manifest)`
    (inverse, with `manifest.members` overrides), `renderMember` / `renderAiScripts` (unpack, checked), `packFile`
    (pack), `recordRendered` + `tidyManifest` (the manifest), `ModManifest` (`mod.json`).
  - `src/formats/mod/data.ts` — `loadModData`: each table/string table/iscript the mod's else the game's, the game's
    own beside, `ownEntry` (added past the game's count, or `rowChanges` non-empty vs the game's row; without a game,
    past the standard count), `namesOf` (unitnames.tbl[id] when non-empty, else stat_txt[id] for id < 228; labels
    1-based into stat_txt).
  - `src/formats/mod/check.ts`, `diff.ts` — the lints and the changelog.
- **CLI:** `cli/src/mod/{source,open,unpack,pack,info,check,diff,new,play,overlay}.ts`; registrations in `main.ts`
  under `mod`; MCP tools `mod_info|check|diff|unpack|pack|new` in `mcp.ts`. `engine.ts` gained `EngineCurrent.mods`,
  `Engine.mods`, `MOD_OVERLAY = 1`, `modArgs`; `maptest.ts`/`trace.ts` an option `mod: { folder() }`.

## Decisions (taken by the user, 2026-11-08 — do not reopen)

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
(It was written believing a Remastered copy has no 1.16.1 GRPs/WAVs; it has both at the classic names — see
"Remastered copy and the engine's reload" — so on either copy both probes answer and the lints look.) `requirement`: graft entry ids past units/upgrades/techdata/orders by file name. `layout-mix`: expanded and
datex tables together (sfxdata excluded: GPTP reads sfxdata.dat).

## Proofs (2026-11-08, this machine)

1. The game's own data members (`gameSource` over `archiveFiles(fixtures/data)`: 11 tables, 6 TBLs, iscript, both AI
   scripts, every `unit\…` path images.tbl names = 832 GRPs + 96 overlays, the PCX palettes, jungle.wpe — 1,018
   members): unpack 22 s, pack 19 s, **1,018 of 1,018 byte-identical**, nothing kept as bytes. AI text has 71
   `raw_bytes` lines (padding). `mod check` on it: **no findings**.
2. Cosmonarchy's release folder (`release/`: the FireGraft exe's archive, then `mpq/`): info names it "Cosmonarchy BW"
   (the folder's one exe with an archive), 11 extended tables (10 `.datex`, sfxdata.dat expanded 20,000). Unpack
   26.7 s, 960 MB: 11 tables, 8 TBLs, 6 iscripts, AI (32,224 raw_bytes lines), 306 overlays, 6 grafts, **169 GRPs as
   PNG**, 1,441 GRPs kept ("another encoder"), 37 GRPs refused at the time (uncompressed GRPs, the interface pictures'
   own format — read and written since 5e631bc, so 206 come out as PNG now; `units.md` has the finding), 3,516
   WAVs, 2,265 other files. Pack 13.1 s: **7,767 of 7,767 members byte-identical**, plus the two FireGraft files back
   in as members; the MPQ (zlib) 774 MB in 52 s. (Since `mod-hash` the two dot files count: 7,769, 2,267 other
   files; the unpacked folder hashes as the release, `ac3f86533e4b5a31`.)
3. `tests/cli-mod.test.ts` (15; 12 without data), `tests/cli-mcp.test.ts` "the mod tools".

## Traps

- `/\.datex?$/` means ".date" + optional "x" — it does not match `.dat`. Use `/\.dat(?:ex)?$/` (cost a debugging run).
- A Blizzard archive's `(listfile)` is partial (BrooDat lists 22 files). `source.ts` probed the game's names in every
  archive until `mod-hash`; now, as the play page, a listed archive is its list and only a list-less one is probed, so
  BrooDat.mpq named as a mod reads as its 22 listed files. The proofs over the game's own data use `gameSource` (names
  given), not this.
- Building the CLI stamps `cli/package.json`'s version; restore it before handing back (`git checkout cli/package.json`).
- The overview holds 23 lines: `mod` took `about`'s row (`about` is hidden there, still works and is in the docs; hidden also drops it from shell completion, `tests/cli-maps.test.ts` says so).
- `tests/core.test.ts` now walks `cli/src/**` (it read only `cli/src/*.ts` before, so subfolder imports were unchecked).

## Remastered copy and the engine's reload (2026-11-08, branch `cli-remastered-unit`)

The gap: `map test|trace|cost --mod` with an iscript/picture/startup-data mod on a **Remastered** copy stopped with
"neither the mod nor the game has unit\zerg\avenger.grp". The brief blamed the command's reader (`gamefiles.ts`); it
was not. **The runner reads the installation itself** (it gets `--starcraft <folder>`): scm-sim
`src/exact/gameCopy.ts#remasteredFiles` reads, before the game, only the tileset names + `ENGINE_DATA` (its storage is
async and the game reads synchronously), so the reload's 928 `unit\…` files and `arr\mapdata.*` were never there.
`gamefiles.ts#storageFiles` already answered every one of them, measured: all 928 images.tbl files (832 GRPs + 96
`.lo?`) present and **byte-equal to fixtures/data's 1.16.1 archives**, 11.6 MB; 1,118 of the 1,123 sfxdata sounds
(Remastered's own WAVs at the root names, 278 MB; 1.16.1's are under `SD/`); all 137 `PLAY_MEMBERS`.

The fix is on this side, because the runner takes `--mod` repeatedly (later wins) and reads a folder layer lazily
(`looseLayer`): `mod/overlay.ts#gameLayer` — on a Remastered copy, for a mod the runner will reload for (same rule as
scm-sim's `readsStartupData`: a `STARTUP_NAMES` file or a `unit\` file) — reads the `STARTUP_NAMES` plus every file
images.tbl names (the mod's images.tbl when it has one) that the mod has not got, from `gamefiles.ts`, 24 at a time
(~0.4 s warm, 935 files, 11.8 MB), writes them to a second temp folder, and the runner gets `--mod <game> --mod <mod>`.
No sounds: the reload reads only `sfxdata.dat/.tbl`; WAVs are asked for in play and a refused one is harmless (the
runner without a mod has none from Remastered either). A 1.16.1 copy: no layer (its archives hold them, the runner
reads those). Because the game layer is a mod layer, the runner's `start.mod` counts it: `ModOverlay.report` takes it
out (`paths` without it, `files` = the mod's own, `read` filtered to the mod's names, `game: n` added). The start
line's `mod` is now kept: `TraceStartLine.mod` / `TestStartLine.mod` (`engine.ts#RunnerModReport`), in `map
trace|cost --json` and `map test --json` as `mod`, and printed under the first line by `engine.ts#modWords`.

Proof (this machine, Remastered 1.23.10.13515, scm-sim `mods-plan` 287b592's runner bundled):
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

## Replays of a mod (R1, 2026-11-08)

A replay's `SCMJ` section names the mod by its hash. `scmjs replay info --mod`, `map trace|cost --replay --mod` check a
mod against it with `cli/src/replaymod.ts#sourceHashes` / `isTaggedMod`: the one rule below (with or without plugins),
and R1's two older forms (game files alone; those differing from the person's copy) for replays tagged before it.
Details and the loader proof: `cli.md` "A replay's mod".

## The mod hash, one rule (2026-11-08, branch `mod-hash`)

Decided 2026-11-08 (mods plan, "R1, as built": the old rule compared a mod with the person's own copy, so one release
hashed three ways). Implemented by the play page (scm-sim `lift-ts`: `src/mods/inspect.ts` `hashLines`/`pluginLine`/
`firegraftLine`/`runningHash`, `web/modDrop.ts#buildMod`); here `src/formats/mod/hash.ts` (core: `modHash`,
`modHashOfDigests`, `hashLines`, `pluginLine`, `firegraftLine`, `probeNames`), `cli/src/mod/hash.ts#sourceHash`, the
editor's `overCopy.ts#dataSetHashOf` (`gamedata.md` "Hash"), Aftermath's `modreplay.ts` (loose files only).

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
- Loose-file rule, as the page's: `modRoot` now looks at any depth (the page's; it was root-or-one-down); under the
  root, a file beside the game's folders, under a top `plugins/` or `firegraft/`, or a `.dll` is left out; `mod.json`
  at the top is the name, deeper it is a file. **Dot files count** (the page counts them); dot *folders* are still
  skipped here (`walk`, pack's `folderFiles`) — the page's drop walk does not skip them, so a `.git/` *under the mod's
  root* would be hashed there and not here (a page-side fix to ask for). Pack keeps dot files now (`files/lua/.gitignore`
  round-trips) and leaves a top-level dot file out of "left".
- A mod folder (`mod unpack` output) packed in memory keeps code members (`Firegraft\*.fgp` back in as members) out of
  `source.files`, so it hashes as the release it came from.

**Test vector.** Cosmonarchy's release folder (read-only, `SCM_COSMONARCHY` or `SCMJS_COSMONARCHY/release`):
**`ac3f86533e4b5a31`**, without plugins **`b13e467fb5abb298`** — page's `buildMod` and `scmjs mod info` alike, and the
unpacked folder too. 7,777 lines: 7,769 game names + 7 plugin lines + `cosmonarchy bw.fgp` (the brief's "7,762 game
names" was the page's `built.lines` (7,770, which holds the `.fgp`) less 8). The CLI counted 7,767 before; the
line-by-line diff of the game names (page vs CLI) was exactly two, both dot files the CLI's walk skipped:

```
433d432   < lua\.gitignore
7366d7364 < unit\cmdbtns\.cmdicons.grp-ojvamg
```

Not the six phantom members (both left them out already: `fileInfo` null), not case, not `.qdp`/`.fgp` counted as game
names. `plugins\apply`, `plugins\pluginlist.txt` and five `firegraft\*.txt` are game names (members of the exe's
archive), on both sides.

**`mod play` hands every file** (no comparison with the copy any more; the page keeps those that differ), loose
plugins under `plugins/`, FireGraft files under `firegraft/`, and the game names the page would not take loose
(`play.ts#notLoose`: no folder, top `plugins\`/`firegraft\`, `.dll`/archive/code extensions — Cosmonarchy's 7 above)
inside one stored MPQ `scmjs-members.mpq`. Proof: the hand-over run through the page's own `buildMod` (pieces as
`inputFromHanded` makes them) gives `ac3f86533e4b5a31` / `b13e467fb5abb298` for the release and the made mod's pinned
values. Without the MPQ the page's hash of a hand-over lost those 7 lines.

**Made mod** (`tests/mod-hash.test.ts`, no game data): loose `arr/units.dat`, `lua/.gitignore`, `plugins/x.qdp`,
`y.fgp`, `y.fgd`, `README.md`, and `made.mpq` (`rez\stat_txt.tbl`, `sound\made\new.wav`, `plugins\apply`); the page's
tool on the same folder: **`a8069f18058ec876`** / **`ac98e7b447476c80`**, pinned. The test checks the CLI (folder,
unpacked folder), the editor's `dataSetHashOf`, `playSet`, and the replay forms against them.

Known gaps: `mod pack --folder` writes members loose, so a loose copy of a mod whose archive held `plugins\…`,
`firegraft\…` or top-level members, or whose plugins were loose beside it, hashes otherwise on the page (only an MPQ
carries those); the editor's folder route takes loose files only under `GAME_FOLDERS` (the page: anything under the
root) and orders own archives by name (the page: as given); the page's `GAME_FOLDERS` lacks `datreq`, `samase`,
`lua`, `config` for finding the root (scoring only).

### An operating system's files have no line (2026-11-09, branch `mod-hash-system-files`)

**Why.** The rule said nothing of `desktop.ini` and its kind, and they are not handed over alike by every route, so a
mod was named by how its folder had been read. Decided (the user's): the rule leaves them out everywhere, and the hash
with their lines stays accepted as an older form wherever hashes are matched.

**The list** is `sources.ts#SYSTEM_FILES` / `isSystemFile(path)` (core exports both), by name alone, any case, either
slash: names `desktop.ini`, `thumbs.db`, `ehthumbs.db`, `ehthumbs_vista.db`, `.ds_store`, `icon\r`, `.directory`; a
name starting `._` (AppleDouble); anything under a folder `__macosx`. Only names certain never to be a game file. The
same list is copied in scm-sim (`src/mods/inspect.ts`), plugin-aftermath (`modreplay.ts`) and plugin-mods (`source.ts`,
until it can take core's): change all four together.

**What a browser's folder handle hides** (so what the list had to cover at least). Not a Windows attribute and not in
the File System Access specification (it only forbids "", ".", ".." and separators, and leaves the rest to the
implementation): Chromium's `FileSystemAccessManagerImpl::IsSafePathComponent`
(`content/browser/file_system_access/file_system_access_manager_impl.cc`), which directory iteration applies to every
child (`FileSystemAccessDirectoryHandleImpl::DidReadDirectory` → `GetChildURL`) on every system. Read at main
(2026-11-09) and at release tags 131 to 150; measured in headless Chromium 153 on Linux with a dropped folder of 45
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
alone (an entry walk, `<input webkitdirectory>` and Node see everything). Closed the same day for a folder dropped on
the editor, which is listed by its entry and only read by its handle (`plugins-host.md`, "A dropped folder is listed by
its entry and read by its handle"); the folder picker has only the handle and stays short.

**Where the filter is.** (1) In the hash: `hashLines` drops a system file's line itself, `modHashOfDigests` marks a
digest by the name it was given (a plugin's line keeps only the leaf, so `__MACOSX/y.fgp` is told there), and
`dataSetHashOfDigests` filters; any caller gets the same hash whatever list it made. (2) Where the list of a mod's
files is built, so counts agree and nothing of theirs is taken for the mod's: `cli/src/mod/source.ts#fromPieces`
(loose pieces first of all, before the plugin and archive tests: macOS's `._gptp.qdp` was a plugin until now; archive
members), `pack.ts#folderFiles` (the `desktop.ini` Explorer puts in a mod folder's `sounds/`), the editor's
`install.ts#splitPickedFiles` / `isGamePath` / `installDataSet` and `overCopy.ts#dataSetHashOf` (not even read). The
files themselves may stay in a kept or installed copy: nothing asks for them.

**The older form.** `hashLinesAsWere` is the rule as it was. `ModHash.older { hash, withoutPlugins, left }` is there
when system files were among the digests given. The command line keeps what it saw in `ModSource.system` (by game
name; also named in `left`) and digests it for that alone: `sourceHash` → `older`, `gameFilesOnlyWere`;
`replaymod.ts#sourceHashes` → `ModHashes.older[]` (the four forms as they were), which `isTaggedMod` takes. `mod info`
prints `Older hash … (with …, which the hash leaves out)` and `--json` has `older`. Not worked out again: a mod whose
AppleDouble half of a plugin or project (`._x.qdp`) was a plugin's line then; the editor's stamp (a data set installed
before keeps the hash it was stamped with until it is installed again; nothing in the editor compares hashes — a
map's data set is matched by id — and the play page takes an older stamp by its own older form).

**Measured** on Cosmonarchy's release as it is on this machine (`/mnt/c/Cosmonarchy/Release`, copied to a Linux disk;
7,796 files, `mpq/sound/desktop.ini` and `mpq/sound/cm/desktop.ini`, 44 bytes each). A finding first: **the two files
are also members of `temp.mpq`**, the archive the mod's hotloader packs `mpq/` into when the game is launched, so every
route that reads archives had their lines whether or not the loose files were handed over. Four trees: with and
without the loose files ("seen" / "not seen"), each with and without `temp.mpq`.

| Route | before: seen | before: not seen | before, no `temp.mpq`: seen / not seen | after, all four |
| --- | --- | --- | --- | --- |
| `scmjs mod info` | `1c41a2d7701fe842` | `1c41a2d7701fe842` | `1c41…` / `20e1c6d89ae2af75` | `20e1c6d89ae2af75` |
| the play page's `buildMod` (in Node) | `1c41…` | `1c41…` | `1c41…` / `20e1…` | `20e1…` |
| scm-sim's runners (`modHashOf`: the exe's archive and `mpq/`, no `temp.mpq`) | `1c41…` | `20e1…` | `1c41…` / `20e1…` | `20e1…` |
| the Mod Editor (`session.hash()`, core 0.13.0) | `1c41…` | `1c41…` | `1c41…` / `20e1…` | `20e1…` |
| the editor's data set stamp (the worker's `onmessage` in Node) | `1c41…` | `1c41…` | `1c41…` / `20e1…` | `20e1…` |
| Aftermath's `folderHashes` (loose files only) | `75c10a2152fb8e0e` | `cb799542a475430f` | the same two | `cb799542a475430f` |

Without plugins: `49815591a7a5a504` before, `db23a1f9dd8cef66` after. Files 7,769 → 7,767. `older` is
`1c41a2d7701fe842` / `49815591a7a5a504` wherever the two files were seen, loose or in `temp.mpq` (Aftermath:
`75c10a2152fb8e0e` when loose). The made mod's pinned values (`a8069f18058ec876` / `ac98e7b447476c80`) are unchanged:
it holds none.

## `mod header` (C4 of the capstone, 2026-11-08, branch `mod-header`)

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
- Tests: `tests/cli-mod-header.test.ts` (made mod: tbl/unitnames names, a 230-unit `.dat`, stat.txt fill, a name list,
  `--namespace`, `--bot`).

## `bot run --mod`, `bot ladder --mod`: overlay 2 (C4, 2026-11-08, branch `mod-header`)

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
- **Proof** (2026-11-08, local engine folder with `current.json` `mods: 2` and the bundled runners): `bot run
  cosmonarchy-example.scmbot "(4)Exodus 1.0.scx" --mod <release> --race terran --seed 7`: "made for Cosmonarchy BW",
  4 plugins, FireGraft 7 edits, defeat at frame 11,308, 12.26 + 0.52 ms a frame, 150.9 s.

## `mod play --bot`, `mod_header`, `mod_play` (C6 of the capstone, 2026-11-08, branch `mod-surface`)

scm-sim `docs/mods-plan.md` "C6, as built"; the page's side is scm-sim branch `mod-handoff-bot` (`web/handed.ts`
`readBot`, `web/main.ts` `handedBotKey`/`seatedBotRow`, `web/setup.ts` `choose`, `web/smoke-mod-play.mjs`).
- **`mod play <mod> --map <map> --bot <bot> [--race r] [--start]`** (`cli/src/mod/play.ts`): `playBotOf` — a path
  (`.scmbot`, a separator, or an existing file) is read and handed as bytes, else a key (`[A-Za-z0-9][\w.-]{0,63}`,
  the page checks it against its catalogue); `pageRace` (z/t/p/r and the names → 0/1/2/6); `--bot` needs `--map`,
  `--race` needs `--bot`. `handoffExtra(set, o)` is what the manifest gains as `handoff` (absent without a bot, so
  the old manifest shape stands): `setup: true` unless `--start`, `useMapSettings: true` for a mod with plugins or a
  FireGraft project (the runners' rule) else `null` (the page's guess — **send null, not absent**: the page reads an
  absent `useMapSettings` as true, the first editors' default), `bot: { key | file: <name>, race? }`. The loopback page
  fetches `/<token>/bot` for a file and posts `bot: { file: File, name, race? }`. `PlayOutcome.bot` is the row the page
  answers `shown`/`started` with; `scmjs.play.waiting` (the page's sign-in for a catalogue bot) prints as
  `scmjs.waiting` does; `ready` is now forwarded and printed ("ready", then "ready again" after the page loads on the
  kept mod).
- **`?lift=live` (all `mod play`, not only `--bot`)**: a mod with plugins or a FireGraft project is handed to the page
  at `?lift=live` unless the address has a `lift` already (`PlayOptions.lift` overrides). Before C6, `mod play` of
  Cosmonarchy ran the game without its plugins (the page runs them only there) — a finding of this slice.
- **`--start` without `--bot`** changes nothing: a handed map without `setup` always started at once (unchanged).
- **MCP**: `mod_header` (path, out, namespace, bot, starcraft; `destructiveHint`) → `writeModHeader`, the data its
  `HeaderResult`. `mod_play` (path, map, bot, race enum, start, wait 10–900 s, starcraft; `openWorldHint`) →
  `playOnPage` with `onAddress` kept: the text is the outcome, `Hand-over page: <link>`, the page's message types; the
  data `{ link, name, hash, withoutPlugins, files, started, shown, error, bot, said }`; a page error is `isError`; the
  timeout's CliError gains the link. Its live lines go to stderr. `map_trace`/`map_cost` gained `mod` (the commands'
  `--mod`: `modOverlay` handed to `runMapInGame`, removed after). 33 tools.
- **Help**: `bot run` and `bot ladder` say `--mod` needs `"mods": 2`; `bot build` says it needs Docker.
- **Tests**: `tests/cli-mod.test.ts` "scmjs mod play --bot" (5) runs **the loopback page's own script** in a `vm`
  context (fetch, File, `open`, `addEventListener` stood in) and checks the message it posts after `ready` — key and
  file, `setup`, `useMapSettings`, `?lift=live` kept beside the address's own query; `tests/cli-mcp.test.ts`
  "mod_header and mod_play" (2) plus the tool list and `map_trace` `mod` on an engine without mods.
- **Proof** (the real CLI against a dev server, scm-sim `web/smoke-mod-play.mjs`): see scm-sim's record.

## A copy of the game is not the mod (2026-11-09, branch `mod-game-copy`)

**Why.** Someone handed over `C:\Cosmonarchy` as a mod: `Release/` (the mod as shipped) beside `Starcraft/` (a whole
1.16.1 copy: `StarDat/BrooDat/patch_rt/StarCraft/BroodWar.mpq`, `StarCraft.exe`, `Maps/CMBW-Root/CMBW-editor/
CMBW-editor.mpq` and `…/grafting/graftc.exe`). Every opener laid every `.mpq`/`.exe` it found as a layer of the mod, so
the game's archives became the mod's files. In the Mod Editor (Windows' folder order, `StarDat.mpq` last) the mod
carried original StarCraft's 34,880-byte `scripts\iscript.bin` and a replay failed ("script 12052 at 167 lacks the SCPE
marker"). The command line had the same walk; its byte order put `patch_rt.mpq` last instead, so it carried 1.16.1's
iscript (40,482 bytes, from `Starcraft/patch_rt.mpq`), `arr\units.dat` from patch_rt and `arr\images.dat` from
`CMBW-editor.mpq`: wrong in another way, and a hash no other route gave.

**The rule** (the same in scm-sim's play page and plugin-mods' Mod Editor: change all three together). A folder that
directly holds `StarDat.mpq` (any case) is a copy of the game; `gameCopyFiles` names `GAME_ARCHIVES` directly in that
folder and **every file under its `Maps` folder** (any case, any depth). None of them is read or is the mod's. In the
walk an archive by name (`.mpq`/`.exe`/`.zip`, so the five too) goes to `gameCopy` and is said; any other (a map, a
campaign's music) goes to `left` like every file outside the mod, and never reaches the loose files, so it neither
scores a root in `modRoot` nor counts for the refusal. A copy's `Maps` is the person's maps folder: the first cut took
only archives there, and Cosmonarchy's `Starcraft/` alone still opened as "a mod" of 441 files, because its campaigns
sit at `Maps/CMBW-Root/CMBW-maps/campaign/…` and `campaign` is one of `GAME_FOLDERS`, so that folder became the root.
Everything else in the game folder (a mod's own exe or archive dropped in, loose `arr/…` files, plugins) is as before.
Applied to each list a walk is given — a folder's files, a zip's members (`fromPieces#take`: `kind === "folder" ||
depth > 0`) — never to a single named file: `scmjs mod info patch_rt.mpq` (old mods ship so), even `StarDat.mpq` named
alone, opens as before.

**Where.** Core `src/formats/mod/sources.ts`: `GAME_ARCHIVES`, `gameCopyFiles(paths)` (exported in core's Mods block).
CLI `cli/src/mod/source.ts`: `ModSource.gameCopy` (the archives, paths as the folder/zip spells them, sorted; not in
`left`, which means "not the game's"), `gameCopyFolders` (per copy: the folder as handed over, or the named path when
the copy is the folder itself / a zip's root; leaf names), `gameCopyWords` (the sentence, through `t()`; past six,
`and {n} more`). The sentence is a ▲ line in `mod info` (so `mod_info` over MCP), `gameCopy` in `--json`, and an
English note in `mod unpack`'s `mod.json` (`inEnglish`, so `mod_unpack`'s lines too). No other command printed
`probed`, so none prints this. When a copy was left out and nothing of a mod remains, `fromPieces` throws
`CliError(…, 2)`: "{folder} is a copy of the game, and there is no mod in it." Nothing remains (the same in the three
repositories) = no archive laid as a layer, no plugin or FireGraft file, and no loose file (a zip's members count as
loose) with a `GAME_FOLDERS` segment other than `maps` before its name — what `modRoot` scores. Read-me, dlls,
`lua_lsp/`, a `Shaders/*.zip` of `.glsl` files and anything under the copy's `Maps` do not make a mod. No documented or
tested flow hands the game's own folder to `scmjs mod` (`gameSource` takes the game's files by name;
`overlay.ts#gameLayer` reads `gamefiles.ts`; the check tests' "game" is loose files).
Not changed: `src/gamedata/install.ts` (Add a data set from a folder names the three archives on purpose), the hash rule,
layer order otherwise, `temp.mpq`.

**Measured** (`scmjs mod info --json`, `/mnt/c/Cosmonarchy`, ~50 s each):

| | files | hash / without plugins | layers |
| --- | --- | --- | --- |
| root, before | 7,892 | `898987e2e9b750b4` / `a34a3c2a6ccfbfad` | the exe, `temp.mpq`, 6 of `Starcraft/`'s archives, `mpq/` |
| root, after | 7,767 | `20e1c6d89ae2af75` / `db23a1f9dd8cef66` | `Release/Cosmonarchy BW.exe`, `Release/temp.mpq`, `Release/mpq/` |
| `Release/`, before and after | 7,767 | `20e1c6d89ae2af75` / `db23a1f9dd8cef66` | |

`gameCopy` after: 7 files (the five archives, `CMBW-editor.mpq`, `graftc.exe`). `scmjs mod info
/mnt/c/Cosmonarchy/Starcraft` (the copy alone): before, "a mod" of every archive's files; with archives-only under
`Maps`, 441 files rooted at `Maps/CMBW-Root/CMBW-maps`; now refused, exit 2. Tests: `tests/mod-game-copy.test.ts`
(made archives only; the last suite runs only where `SCMJS_COSMONARCHY_HANDED` names the folder, ~50 s).

## Races a mod adds (2026-11-10, branch `mod-races`)

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
  manifest without races serialises byte for byte as before. `ModSource.races` (CLI): `packFolder` sets it from the
  manifest; `fromPieces` reads it from a top-level (or one-down) `mod.json` beside the name. `mod unpack` writes the
  source's races, else those of the folder's earlier `mod.json` (a new release unpacked over keeps them).
- **Hash**: top-level `mod.json` was already out of the hash (a folder's name file; a mod folder's manifest is never a
  member). `tests/races.test.ts` pins it: raw folder with/without `mod.json` races, unpacked folder with/without.
- **CLI**: `mod info` `races` + a `Races` row; `mod check` `hints: string[]` (`racesHint`, `modRaceCandidates` — reads
  the mod's and the copy's `network.tbl`), printed with `mark.info`, not counted in errors/warnings, never fails;
  `mod play --race` / `mod_play race` (now a string) take a declared name or id (`pageRace(race, source.races)`, parsed
  after the mod is opened). Measured on the release: candidates Askosi, Bloodsummon, Kogri, Forerunner (168–171) and
  letters a, f; the race-69 player's 52 build orders plays as Terran (1).
- Editor routes in: the Game Data dialog's folder route reads a `mod.json` directly in the picked folder
  (`install.ts#pickedFolderRaces`); a plugin's `api.gameData.setRaces`; a map's `dataset.json` for the set in use.
  Not done: an editor dialog to name races; `api.gameData.raceCandidates` gives nothing for a stored copy
  (`gamedata.md`).

## Open

- The hash is one rule everywhere since `mod-hash` ("The mod hash, one rule" above, with its known gaps). The copy
  now holds every `arr\` table (the Mod Editor's `mapdata`/`portdata` mismatch); no longer matters for the hash.
- The Mod Editor plugin's API asks (reader `under`/`member`, `rehash`, `storedPath`, the worked-out manifest, folder
  picks and drops) are in `plugins-host.md` "The Mod Editor's asks".
- The runners' `--mod <folder>` and `current.json` `"mods"` (now 2) are scm-sim's to publish with a deploy.
- `map run` (plugins, no engine) has no `--mod`; `map test|trace|cost` and `mod test` do.
- iscript header comments (images using an id) are not written; table comments are.
- `docs/images/cli-overview.webp` predates the `mod` row (re-run `scripts/cli-screenshots.mjs`).
- Writing a 1 GB MPQ holds every member and the output in memory (~2 GB for Cosmonarchy).
