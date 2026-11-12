# `@scm-js/core`, the library

`core/` is the npm package **`@scm-js/core`**: the editor's map code — open, check, triggers, strings, units,
locations, settings, resize, write — for Node and the browser, no game data. The reader's page is `docs/core.md`.
Decided 2026-11-06 at the user's "scm-js/core sounds like a great idea", after the CLI's next slices (triggers
export/import, map diff, map run) all wanted the same functions a script would: publish the layer once, and let the
command and other people's tools sit on it.

## Design

- **One source tree, three builds.** Nothing moved out of `src/`. `core/src/index.ts` is a list of re-exports —
  *that list is the public API* — and `scripts/build-core.mjs` bundles what is behind it, as `build-cli.mjs` does for
  the command and `vite build` for the editor. So the editor, the command and the package run the same functions,
  byte for byte, and "core 0.8.11 reads what editor 0.8.11 reads" is true by construction. The editor does **not**
  import the package (a workspace or npm hop would put a build between `npm run dev` and a fix, and the editor needs
  far more of `editor/*` than the API should promise — drag handles, hit tests); the layering is enforced as a
  *direction* instead, below. A path alias for new code is a possible later step, not done.
- **The direction** (`tests/core.test.ts`): walking the import graph from the entry, no module reached *at run time*
  may be under `src/atoms`, `src/components`, `src/hooks`, `src/services`, `src/gamedata`, `desktop/` or be the
  plugin host/builtin/registry/updates/defaults/devLink; the only package imported at run time is what
  `core/package.json` declares (mopaq), and react/jotai are reached by neither value nor type. **Type-only edges into
  the UI are not followed** (`api.ts` takes `DialogId`, `MapImageOptions`, `TestMapOutcome` types from
  components/services; those files import atoms by value) — what the declarations may name is the build's check,
  not the walk's. The walk treats `import { type X }` with all-type specifiers as erased, like `import type`.
- **The command is a thin layer**, also by test: every `import { … } from "../../src/…"` in `cli/src` must be a name
  the entry exports from that same module. A CLI slice that needs something new adds the export first — that is the
  signal the surface wants it. `src/editor/mapFile.ts` (`openMapBytes` / `writeMapBytes`, the byte-level half of
  `services/mapIo.ts`'s `openMapFile`, split out for this) is what both import; `OpenedMap` is `LoadedDocument`
  without the handle/UI fields, and the CLI uses it so it no longer types against `atoms/documentAtoms`.
- **The build.** Vite SSR, `noExternal: true` except `rollupOptions.external` = the package's dependencies (mopaq;
  set in both `ssr.external` and `rollupOptions.external`, belt and braces — only the pair was tried) → `core/dist/index.mjs`, ~330 KB, one `import … from "mopaq"`.
  A `pre` plugin resolves `src/i18n/ko.json` to `export default {}` — the catalogue is a third of the editor's words
  and the library is English (`t()` falls back to its key); the CLI still bundles it (not changed here). The
  declarations are `dts-bundle-generator` on `tsconfig.core.json` (`declaration: true`, otherwise the CLI's config)
  → one `index.d.ts`, ~74 KB; the build throws on any import other than a dependency (`importsIn` from
  `build-plugin-types.mjs`) and on the words `jotai`/`react`. THIRD-PARTY-NOTICES.txt is written only when a
  node_modules module is actually in the bundle (`coreNotices`), which today is never.
- **Version = the editor's**, like the CLI and unlike `@scm-js/replay` (1.x) and `@scm-js/plugin-api`
  (`PLUGIN_API_VERSION.minor`). Same source, same release, no second ceremony; semver's reading of 0.x is accepted.
  `build:core` stamps `package.json`'s version into `core/package.json`, and the release commit (`release.yml`) writes it there too, so the committed file says the last release.
- **Publishing**: `build.yml`'s `core` job, a copy of `cli`'s — stable channel, version checked against the release,
  a version npm already has skipped, a Node import smoke of `dist/index.mjs`, trusted publishing over OIDC. **Needs a
  trusted publisher on npmjs.com for `@scm-js/core`** (scm-js/scm-js, `build.yml`, no environment, direct publish
  allowed — the same 403 trap as plugin-api's note) before the first release; until then the job fails at publish.
  `build:core` also runs in the `web` job on every PR so a type change that breaks the declaration bundle is seen
  before a release.
- **Surface rules.** Read/apply pairs and change lists as the editor has them (no new facade; the guide explains
  `applyUnitChanges`). Section *records* are exported as types; `PlayerType`/`PlayerRace`/`ColorMode`/`ForceFlag`
  are values (a test setting slots Inactive needed them). Not in v1: anything needing the tileset/dat
  (`changeTileset`, placement, sprites, map image), the plugin host, sync, saving to disk. An export, once
  released, stays or goes with a note in the guide.

## Mod names from `@scm-js/mod` (2026-11-12)

`@scm-js/mod` is a dependency beside mopaq (`core/package.json`, `EXTERNAL` in `build-core.mjs`, `index.d.ts` imports
its types). The Mods block re-exports its names under the old ones (`fileDigest` = `sha256Hex`, `ModSourceError` =
`ModError`, `isModCode` = `isCodeFile`, `PatcherPlugin` = `CarriedModule`, `RACE_NAME_MAX` = `MAX_RACE_NAME`), plus
`readMod`, `MOD_MESSAGES`, `renderMessage` and the description types. **Nothing released is removed** (the planner's
rule, 2026-11-12): `src/formats/mod/legacy.ts` keeps `modHash`, `modHashOfDigests`, `dataSetHash`,
`dataSetHashOfDigests`, `gameLine`, `isFiregraftProject`, `ModHash`, `ModHashInput`, `Digest` with their signatures over
the package's `hashLines`/`pluginLine`/`firegraftLine` (deprecated; the same inputs give the package's lines' hash,
`tests/mod-hash.test.ts` "@scm-js/core's hash helpers"), core's `gameName` (no leading backslash, as released),
`pluginLine`/`firegraftLine` taking a path, and `exeArchive`/`ExeArchive` with 0.13.3's `kind` and `archive` beside
`form`/`bytes`/`at`. **Breaking, cannot be kept:** `probeNames` is the package's `(archive, tables?) => Promise<string[]>`
(0.13.3: `(read) => string[]`, sync); the package's needs an opened archive and is async. **Changed values:**
`GAME_FOLDERS` is the game's 24 (0.13.3: 28), `DataSetRace` has an index signature, `normalizeRaces` keeps at most 248
rows. `PatcherError.what` and `libraryName` were never released (main after 0.13.3): `PatcherError` is the package's.
Who imports these (grep of `/home/jeany/github/plugin-*`, 2026-11-12): plugin-mods (and its two worktrees) import from
core `Digest`, `GAME_FOLDERS`, `exeArchive` (uses `.kind`, `.archive`), `gameName`, `isMpq`, `isZip`, `modHash` (tests),
`modHashOfDigests`, `modRoot`, `readZip`; nothing else imports these names or `src/formats/mod/*`.

## Checked

`node --input-type=module -e 'import("./core/dist/index.mjs")'` on tests/maps/ums.scx: open → statistics → Check Map
(0/1/1) → triggers as text → write → reopen, and `createScenario` → write → open; 162 exports; no `window.`/
`document.`/`navigator.` and no Korean in the bundle. `tests/core.test.ts` runs the same through the source entry on
every committed map, plus a two-player map built from `createScenario` + `applyPlayerSettings` + `addUnits` that
passes Check Map (a fresh map has eight Human slots and fails on start locations otherwise — the editor's real rule).

## Next

Done 2026-11-07 (`map generate`, `cli.md` "A map from a seed"): the first exports that need a tileset to do anything —
`paintIsom`/`paintIsomDiamonds`/`checkIsom`/`hasIsom`/`isomTables`/`diamondAt` (`editor/isom.ts`), `applyChanges`
(`editor/terrain.ts`), `buildDoodadCatalogue` (`formats/tileset/doodads.ts`), `checkDoodadPlacement`/`placeDoodad`/
`applyDoodadChanges`/`DEFAULT_DOODAD_PLACEMENT` (`editor/doodads.ts`), `symmetryImages`/`mirroredOwner` (`editor/symmetry.ts`),
and `megatileHeight`/`groupBuildable`/`TileFlag` beside `loadTileset`. The walk stayed clean (doodads.ts reaches
editor/sprites.ts; symmetry.ts reaches i18n, which the entry had already). docs/core.md has a "Terrain and doodads" row.

Done 2026-11-07 (`map unpack --text`, `cli.md` "A map as a folder of text"): `encodeSection` (scenario.ts, was
private — the bytes a save writes for one section from the model; the text folder encodes each section with it and
assembles with `serializeChk`, not `serializeScenario`), `defaultUnitSettings` and the other five settings defaults,
`locationSlots`, `WEAPON_NAMES`/`weaponName`. docs/core.md's table names them.

Done 2026-11-07 (`map merge`, `cli.md` "Merging maps"): `unitSettingsSections`, `upgradeSettingsSections`,
`upgradeRestrictionSections`, `techSettingsSections`, `techRestrictionSections` exported — which of a revision pair a
direct write to the table marks dirty; docs/core.md "How an edit works" has a "By hand" paragraph for them. The
export list's parser in `tests/core.test.ts` reads names between the braces, so **a comment inside an `export { … }`
list hides the next name** (the first try put one there and the test said the name was not exported); comments go
above the statement.

Done 2026-11-07 (`map balance`, `map optimize`): `memberInfo` (scm.ts: how a member is stored), `readWavs` and
`applySounds` (the WAV table, as the Sound Editor edits it), `UnitUsed` (which fields of a unit record are set, for
a resource's amount) and `triggerReferences` with `TriggerRef`/`TriggerRefs`/`TriggerRefKind` (triggerRefs.ts, pure;
its `memory` refs tell an EUD map). `cli.md` "Fair starts and smaller maps".

Done 2026-11-07 (`map sounds`): `parseWavHeader`, `wavDuration`, `wavFormatLabel` and `WavInfo` from
`formats/wav.ts` (pure; its one import is `t` for the format label's words). `cli.md` "Cheap wins".
Done 2026-11-08 (branch `mods-api`, for the Mod Editor's sounds): the rest of the codec from the same module —
`decodeWav`, `decodePcmWav`, `decodeImaAdpcm` (exported for this), `encodeWav`, `isPlainPcm`, `canDecodeWav`,
`wavFrames`, `wavCodecName`, `WAV_FORMAT`, `PcmAudio`, `WavBits`; no new edge, so the layering test is unchanged.
`tests/wav.test.ts` "the WAV codec in @scm-js/core".

Done 2026-11-07 (the DX slice: `map new|dump|find`, `doctor`): added `flatTerrain`/`baseTerrain`/`DIRT`
(`formats/tileset/terrain.ts` — works with a null tileset, dirt ids, so it is not "needs the tileset"),
`DEFAULT_START_PLACEMENT` + its types, `DEFAULT_PLACEMENT`/`PlacementOptions` (placement.ts was already in the walk
via `placeStartLocations`). `cli.md` "New, dump, find, doctor".

Done 2026-11-06 (both CLI slices): `map triggers export|import`, `map strings`, `map diff`, `map build` — the last
added `readSwitchNames`, `soundList`, `buildChk`/`keptExtras`/`buildMapFile` and `packBuiltMap` to the entry (the
save plan and the built-file packer, so a script can do what Save does; `cli.md`); `map unpack|pack` added
`readArchive`/`writeArchiveBytes` (`mapFile.ts`: the archive as it is, which `openMapBytes` now builds on). A `@scm-js/core`
alias inside the repository for new code and the plugin host (towards `scmjs map run`). A browser smoke (the
package claims to bundle; untested in a page).

Done 2026-11-10 (races a mod adds, `mods.md`): `normalizeRaces`, `sameRaces`, `raceLabel`, `raceChoices`,
`raceCandidates`, `hasRaceCandidates`, `racePlaysAs`, `GAME_RACE_NAMES`, `FIRST_DATASET_RACE`, `RACE_NAME_MAX`,
`GAME_NETWORK_TBL_ENTRIES`, `DataSetRace`, `RaceCandidates` from `formats/mod/races.ts` (imports `data/players`,
`dat/tbl`, `mod/sources`: no new edge for the walk). `ModManifest.races?`. The editor's `data/races.ts` (installed table,
translated text) is not exported.
