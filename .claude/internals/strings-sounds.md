# Strings, sounds and switches

### Strings, sounds, switches (`src/editor/strings.ts`, `sounds.ts`, `switches.ts`)

`stringUsages(scn)` maps every string index to the records that reference it (SPRP, FORC, MRGN,
UNIS/UNIx names, SWNM, WAV, every TRIG/MBRF action's `text` and `wav`); the String Editor edits a
working copy of the table and `applyStrings` writes it back **without renumbering** — it trims only
unreferenced trailing blanks and keeps a blank slot something still points at. `escapeControls` /
`unescapeControls` show bytes below 0x20 as `<XX>` (tab, LF, CR stay literal), and
`editor/textColors.ts` is what those bytes *mean*: `TEXT_CODES` (the community table at
wiki.staredit.net/wiki/Color, whose twelve player colours are the classic BW palette — the
editor's older table was wrong from 0x12 up, with the alignment codes a byte early and 0x18
called black instead of player 9's green), `runsOf` turning a string into coloured runs the
way the game draws it, and the Remastered newline change: 1.16.1 reset the colour at every
line break and Remastered carries it on, so `bleedingLines` finds the lines that render
differently now and `fixBleeding` writes the reset the old game supplied (`RESET_CODE`,
0x02, the cyan that *is* the default), and `inlineRuns` — the same reading flattened to one
line, with a `NEWLINE_MARK` between the lines. `components/ui/ColorCodes.tsx` is the shared
chrome, three surfaces a field takes as many of as it has room for: `ColorCodeBar` (a swatch
per code, refusing the mousedown so the caret it inserts at survives the click),
`StringPreview` (the block plate, on the game's own dark ground in the game's own default
cyan) and `InlineString` (one line, for a list row or a field-shaped box — drawn with
`initialColor: "inherit"`, so text no code coloured keeps the chrome's colour and only a
string that really carries a colour stands out). **`ColorTextField` is the three composed**
and owns the `escapeControls` / `unescapeControls` round trip, so no caller repeats it:
`preview` is `"swap"` (the read surface *is* the field until it takes focus — what lets four
force names each have one), `"below"` (a persistent plate, Map Properties' description and
the String Editor) or `"none"`; `codes` is `"popover"` (a Radix `Popover` on the field's own
button, `onOpenAutoFocus` prevented so the caret stays put), `"bar"` or `"none"`. Going back
to the read surface on blur is deferred one task on purpose — pulling the input out of the
tree while the browser is still moving focus makes the dialog's focus trap take it back, and
clicking from one of these fields into another landed on the dialog. It is used by Map
Properties, the String Editor, force names, custom unit names and a trigger or briefing
action's `text` argument; a `wav` argument and the strings the game never draws (location
names, switch names, trigger comments) deliberately get none of it. `Preferences.classicText`
is the 1.16.1 line-break rule, one setting every preview reads (`useClassicText`), shown in
the String Editor and Preferences ▸ Display. The whole
module is on the plugin API as **`api.text`** (`TextApi` in `plugins/api.ts`,
`host.ts#text`), so no plugin carries a copy of the numbering — the Repair plugin's string
finding is `bleedingLines` / `fixBleeding` over `api.query.strings()`, injected into its
pure `analyze` as `TextHelpers`, and its stacked-text finding is `stackedLines` /
`flattenStacks` the same way (the lines 1.16.1 drew at more than one alignment at once,
and those lines laid out left to right; a head-of-line alignment code places the line and
is not a stack). `tests/text-colors.test.ts` covers the module and
`tests/plugins.test.ts` the API group. `editor/sounds.ts`
joins `scn.wavs` with `archiveExtrasAtom` (`soundList`, `orphanSounds`, member names normalised for
case and slashes); the Sound Editor's working copy carries both the table and a new extras `Map`, and
apply replaces the atom, so an imported file only reaches the archive on OK / Apply. Import converts
through `services/audioConvert.ts` (`convertToWav` / `decodeAudio`: `formats/wav.ts#decodeWav` first,
else Web Audio `decodeAudioData` in a throw-away `OfflineAudioContext`; an offline render for
resampling / downmix, `WAV_PRESETS` for the targets — the platform decoders cover MP3 / FLAC / AAC / Ogg)
and `formats/wav.ts` (pure: `parseWavHeader` incl. WAVE_FORMAT_EXTENSIBLE, `blockAlign` and the `fmt `
extra bytes; `encodeWav` 8/16-bit PCM; `decodeWav` for 8/16/24/32-bit PCM, float, A-law, µ-law, IMA
ADPCM — the game's own sound encoding — and Microsoft ADPCM, `canDecodeWav` / `wavFrames` /
`wavDuration` off the header; `tests/wav.test.ts` encodes each format on the test side and checks the
decoders against it). A file already a PCM WAV in the target format is kept byte for byte, and a
converted one is renamed `.wav`. `mopaq` cannot read the MPQ-ADPCM-*compressed* members of the game's
own archives — that is the archive's compression, not the WAV encoding, and out of this repository's
hands.
**The game's own sounds** (`editor/stockSounds.ts`, `ui/SoundPicker.tsx`, 2026-10-12). A trigger's
`wav` is a path the game opens through its archives, so `sound\Terran\Marine\TMaYes00.wav` plays
with no file in the map and no WAV entry (the game never reads WAV). The list is `arr/sfxdata.tbl`
(1127 names under `sound\`, 1123 distinct: a few files repeat and the first spelling stands), and
whose voice a sound is comes from `units.dat`'s voice columns — ready u16[106], what start/end
u16[228], annoyed start/end u16[106], yes start/end u16[106], all **sfxdata.dat ids**, which
`sfxdata.dat`'s first column (u32 per sound, 9 bytes a sound, 1144 of them) turns into 1-based tbl
entries. `buildStockSounds` is pure and complete without the two dat files (then no voices);
folders are grouped case aside (the table has `Protoss\CARRIER` and `Protoss\Carrier`) and ordered
races first. `formats/units/load.ts#getStockSounds` fetches on first use, null when the copy has no
tbl (one made before the extraction copied it — the picker says to reinstall), dropped with the
unit tables on a data-set switch and retried after an install; `useStockSounds` is the hook.
`SoundField` replaced the bare text input of the `wav` arg kind in `TriggerDialogs.tsx`: the text
field stays (any path can be typed), **Browse…** is a radix Popover (portalled, so it works inside
the dialog; Escape closes it alone) with the unit's lines first when the same action has a `unit`
arg (`ItemEditor` passes it), then the map's sounds, then the game's by folder; search is every
word in the path, a unit's shown name or the moment (`pissed` is accepted for annoyed). The labels
are `tc("unit voice", …)` because Ready / What / Yes already mean other things in the catalogue.
1100 rows are plain DOM with `content-visibility: auto` per folder; no virtual list was needed.
Check Map (`validate.ts`) used to call every stock path "not in the archive": now a path under
`sound\` is silent unless the list is loaded and lacks it. **Nothing plays a stock sound yet.**
Measured the same day: in BrooDat/StarDat 3 of 1127 open, the rest are MPQ IMA-ADPCM members
`mopaq` does not decode (needs ADPCM, likely Huffman with it); a Remastered install has the same
two tables and its sounds are plain PCM (1123 files, 278 MB), to be read on demand or copied
opt-in. Not verified in the game: that a stock path plays in both 1.16 and Remastered from a map
with no WAV entry — standard practice among map makers, and what the format says, but no probe map
has been played.
`editor/switches.ts` edits SWNM (`applySwitchNames` creates the section on the first name and interns
names; `switchUsage` counts Switch conditions and Set Switch actions). `tests/strings.test.ts` and
`tests/sounds.test.ts` pin the usage map, the escape round trip and the WAV / extras join.
