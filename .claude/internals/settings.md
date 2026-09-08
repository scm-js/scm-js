# Scenario settings and CUWP

### CUWP (`src/formats/chk/sections/cuwp.ts`, `src/editor/cuwp.ts`, `dialogs/CuwpDialog.tsx`)

`scenario.cuwp` is UPRP (64 `CuwpSlot`s of 20 bytes: valid-state bits, valid-field bits, owner,
hit points / shields / energy as percentages, resources, hangar, state bits, four unused bytes) and
`scenario.cuwpUsed` UPUS (StarEdit's 64 "in use" bytes), both `null` when the file has no section
and modelled on a new map. The *Create Unit with Properties* action stores the slot **1-based** in
`target` (`triggerDefs.ts` kind `cuwp`; the Classic editor's widget lists slots by `cuwpSlotLabel`
and opens the dialog with `payload.slot`). `editor/cuwp.ts`: `readCuwp` / `applyCuwp` (a
settings-style transaction that marks UPRP and UPUS only when they change; a file with no UPUS gets
one only when a tick goes on), `cuwpUsage`, `cuwpSlotView(s)` / `patchCuwpSlot` / `patchCuwp` (the
plugin API's `tx.cuwp` and `settings.cuwpSlots`). Check Map warns on a slot out of 1..64 and notes a
slot that sets nothing. `tests/cuwp.test.ts`.

### Scenario settings (`src/editor/settings.ts`, `src/formats/chk/sections/{players,settings}.ts`)

The Map Revision, Player Settings, Force Settings, Player Colors and Unit Settings dialogs edit the
scenario directly and are **not** in the undo model — each dialog is its own OK / Apply / Cancel
transaction, as in StarEdit. They read a working copy through `useScenarioForm(scenario, read)`
(re-read whenever the scenario *object* changes, so a `?dialog=` deep link that opens before the
startup map exists fills in, and a dialog left open across File ▸ Open does not write stale values),
write back through the `apply*` functions in `editor/settings.ts` (which `markDirty` only what
changed), and end with `commitSettingsAtom` — it sets modified, bumps `settingsRevisionAtom` (what the
dialogs and Map Properties subscribe to) and the units/doodads revisions, since colours reach every
drawn sprite. Strings the dialogs need (force names, custom unit names) go through `internString`:
an identical entry is reused, otherwise one is appended — never overwritten, because the old index
may be shared with a trigger.

Sections: OWNR is always written together with IOWN (StarEdit's copy, decoded into
`scenario.editorPlayerTypes` — `applyPlayerSettings` sets both, `encodeSection` writes IOWN from it,
and Check Map warns when a file's two disagree); `playerRgb` is CRGB
(Remastered: an RGB triple and a `ColorMode` per playable slot; `null` = no section, and Player
Colors drops it again when every slot is back on `Palette`) — `displayColorHex` is the colour a slot shows
anywhere in the chrome and `playerTeamColor` what its sprites are painted with (`TeamColorSpec`: a `tunit.pcx`
row for the sixteen classic colours, else an RGB — Pink … Black and any CRGB custom colour — for which
`teamColor.ts` synthesises a ramp and `sprites.ts` draws through a palette copy with slots 8–15 overridden,
since the tileset palettes have no pink to remap to; `tests/team-color.test.ts`). `unitSettings` is
one model for UNIS (100 weapons) and UNIx (130), read from UNIx when both exist; `unitSettingsSections`
decides which to write (the file's revision plus whichever it already carries, so a hybrid map keeps
both). `unitAvailability` is PUNI, player-major (`puniIndex`). Both are `null` when the file has no
section (a new map has them). The upgrade and technology tables follow the same pattern:
`upgradeSettings` is UPGS (46 upgrades) / UPGx (61, plus one pad byte after the use-default column),
`upgradeRestrictions` UPGR / PUPx (player-major max / start levels over a global default pair,
`upgradeIndex`, `upgradeLevels`; `DEFAULT_UPGRADE_MAX` is upgrades.dat's `maxRepeats`, what StarEdit
writes for a fresh map), `techSettings` TECS (24 techs) / TECx (44), `techRestrictions` PTEC / PTEx
(`techIndex`, `techState`). The model is always the Brood War width and the original-layout encoders
trim it (`decode*` re-strides the per-player tables). `revisionSections` in `scenario.ts` chooses
which of a pair to write — the revision's plus whichever the file (or its dirty set) already has —
through `unitSettingsSections`, `upgradeSettingsSections`, `upgradeRestrictionSections`,
`techSettingsSections`, `techRestrictionSections`. `wavs` is the WAV table (`sections/sounds.ts`,
512 string indices of `staredit\wav\…` paths; the files themselves are archive extras). Defaults
for the dialogs come from `assets.upgrades` / `assets.techs` (`upgrades.dat`, `techdata.dat` — decoded
in `dat.ts`, optional like `weapons.dat`). `tests/data-settings.test.ts` pins the codecs, the
re-striding, the new-map section set and byte-for-byte re-encoding of the fixture maps. `setMapVersion` rewrites VER/TYPE and flips `strings.extended` (STR ↔ STRx: both names go
dirty and the inapplicable one encodes to `null`, which `serializeScenario` treats as "drop").
The Map Revision dialog also carries the text encoding (`MapVersionView.textEncoding`,
`changeTextEncoding`, `tx.setTextEncoding` on the plugin API): the select is disabled with STRx
ticked (UTF-8 is forced), and the hint under it counts what the *chosen* encoding would lose
against the live table (`unencodableStrings` over `{ ...scenario.strings, encoding }`). See
`chk-format.md` for the model. This dialog is also the worked example of the translation
pattern (`i18n.md`): every string goes through `useT()`'s `t`, the encoding labels through
`translate()`.
Map Properties also changes the tileset: `editor/tileset.ts#changeTileset` (ERA, the terrain laid
again with `flatTerrain` and ISOM to match, the doodads and their overlay sprites dropped — or
`keepTiles` for ERA alone) through `changeTilesetAtom`, a whole-document transaction like Resize
(`afterWholeDocumentChange` drops the history and bumps every revision; `tilesetFileNameAtom` reads
the settings revision so it re-derives from the mutated ERA). The dialog `ensureTileset`s the new
graphics first so the fill uses real tile ids.
Upgrade / Technology Settings (`DataDialogs.tsx`) share `CatalogueList` (a race-grouped id list) and
follow Unit Settings exactly: `useScenarioForm(read*Settings)`, in-place typed-array edits plus a
`bump`, `apply*Settings(clone…)`, `commitSettingsAtom`; the per-player rows show the effective value
through `upgradeLevels` / `techState` while on Default.
Unit Settings shows dat defaults for a type on "use default" and seeds its row from them when the
tick comes off; `units.dat` now also yields `buildTime`, `armor`, `groundWeapon`/`airWeapon`
(a turreted vehicle's weapons live on its subunit) and `weapons.dat` ships as `assets.weapons`
(optional — an older extraction shows weapon defaults as 0). `tests/settings.test.ts` pins the codecs,
the section choice per revision and byte-for-byte re-encoding against the fixture maps.
