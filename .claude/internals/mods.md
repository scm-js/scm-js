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
when the mod has images.tbl; a path absent from the mod and (game known) the game. A Remastered copy has no 1.16.1
GRPs/WAVs: `baseHas` probes `unit\terran\marine.grp` and `sound\misc\buzz.wav` and answers null (unknown) for those
folders. `requirement`: graft entry ids past units/upgrades/techdata/orders by file name. `layout-mix`: expanded and
datex tables together (sfxdata excluded: GPTP reads sfxdata.dat).

## Proofs (2026-11-08, this machine)

1. The game's own data members (`gameSource` over `archiveFiles(fixtures/data)`: 11 tables, 6 TBLs, iscript, both AI
   scripts, every `unit\…` path images.tbl names = 832 GRPs + 96 overlays, the PCX palettes, jungle.wpe — 1,018
   members): unpack 22 s, pack 19 s, **1,018 of 1,018 byte-identical**, nothing kept as bytes. AI text has 71
   `raw_bytes` lines (padding). `mod check` on it: **no findings**.
2. Cosmonarchy's release folder (`release/`: the FireGraft exe's archive, then `mpq/`): info names it "Cosmonarchy BW"
   (the folder's one exe with an archive), 11 extended tables (10 `.datex`, sfxdata.dat expanded 20,000). Unpack
   26.7 s, 960 MB: 11 tables, 8 TBLs, 6 iscripts, AI (32,224 raw_bytes lines), 306 overlays, 6 grafts, **169 GRPs as
   PNG**, 1,441 GRPs kept ("another encoder"), 37 GRPs our decoder refuses (empty copy / runs past the end), 3,516
   WAVs, 2,265 other files. Pack 13.1 s: **7,767 of 7,767 members byte-identical**, plus the two FireGraft files back
   in as members; the MPQ (zlib) 774 MB in 52 s.
3. `tests/cli-mod.test.ts` (15; 12 without data), `tests/cli-mcp.test.ts` "the mod tools".

## Traps

- `/\.datex?$/` means ".date" + optional "x" — it does not match `.dat`. Use `/\.dat(?:ex)?$/` (cost a debugging run).
- A Blizzard archive's `(listfile)` is partial (BrooDat lists 22 files): `source.ts` always probes the game's names
  too (tables, TBLs, scripts, images.tbl/sfxdata.tbl paths, tilesets).
- Building the CLI stamps `cli/package.json`'s version; restore it before handing back (`git checkout cli/package.json`).
- The overview holds 23 lines: `mod` took `about`'s row (`about` is hidden there, still works and is in the docs; hidden also drops it from shell completion, `tests/cli-maps.test.ts` says so).
- `tests/core.test.ts` now walks `cli/src/**` (it read only `cli/src/*.ts` before, so subfolder imports were unchecked).

## Open

- The play page's side of `scmjs.play.dataSet` (M1, another slice): the message shape is in `docs/cli.md` "Playing a
  mod on the play page"; the page's own drop hashes *every* file of a mod, `mod play` hashes the files it hands over
  (the changed ones) — the same only when every file differs; reconcile when M1 lands (send the whole-mod hash too?).
  The editor's data-set hash (stamp, `scmjs\dataset.json`, `TestMapFile.dataSet.hash`) is `mod play`'s rule since
  the `mods` merge (`gamedata.md` "Hash"). Gaps left: the CLI's base is the person's game, the editor's the copy it
  laid the set over (another data set's copy, if that was the base); the CLI probes a list-less archive by the game's
  names, the editor by what its extraction asks; and the CLI counts any file under the mod's root, the editor files
  under `GAME_FOLDERS`.
- The runners' `--mod <folder>` and `current.json` `"mods": 1` are this side's assumption; M1/M0 must publish them.
- `map run` (plugins, no engine) has no `--mod`; `map test|trace|cost` and `mod test` do.
- iscript header comments (images using an id) are not written; table comments are.
- `docs/images/cli-overview.webp` predates the `mod` row (re-run `scripts/cli-screenshots.mjs`).
- Writing a 1 GB MPQ holds every member and the output in memory (~2 GB for Cosmonarchy).
