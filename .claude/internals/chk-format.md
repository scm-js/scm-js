# The map file fidelity model

### Map file fidelity model (`src/formats/chk/`)

- `reader.ts` parses the CHK container into `ChkFile` — **every** section in file order, repeats kept.
  `sections/registry.ts` declares each section's `CombineMode` (`last` / `overlay` / `append`) and fixed
  size; this mirrors how the game itself resolves duplicated sections (protected maps depend on it).
  A `last`/`first` spec can carry a `minimum`: `combine` passes over shorter copies (they neither
  count nor replace an earlier one), and `SectionKnowledge.minimum` hands it to plugins (Repair's
  collapse uses it). **STR's is 2, measured 2026-10-14 in Remastered** on La Mancha 1.1 (KeSPA,
  protected): real 2470-byte `STR ` first, a 1-byte `STR ` near the end. Taking the last copy lost
  every string, and Repair's on-open collapse then deleted the real table, so the saved map no
  longer loaded ("intended for use with a StarCraft expansion set", in Brood War mode too). Probe
  copies settled the rule: two full tables → the second's name shows (last wins); real + a 2-byte
  count-0 table → loads with `<MISSING>` name (the image's spelling) and description (2 bytes counts). **STRx's is 4**,
  read from Remastered's loader (2026-10-17: `minimum = 2 + 2·isStrx`), not probed. No other
  section has one — if another decoy turns up, probe it the same way (Maps/Download copies, user
  reads the lobby) before adding one.
  `serializeChk` writes each header's **declared** size, not `data.length`: the two differ only for a
  section the reader could not take whole (a length past the end of the file, or a negative one — a
  protection trick the game acts on), and a plain Save must leave such a header as it found it. So
  `serializeChk(parseChk(bytes))` is `bytes` for any input, `insertionPoint` never places a new
  section behind such a tail, and straightening a bad header out is the Repair plugin's job. Everything
  that re-encodes a section sets `declaredSize` to the new length.
- `scenario.ts` decodes only the sections the editor models into typed fields on `Scenario`
  (`tiles`, `isom`, `units`, `locations`, `strings`, players, forces…). Section codecs live in
  `sections/{terrain,objects,players,strings}.ts`.
- `Scenario.dirty` is a `Set` of section names. On save, `serializeScenario` re-encodes **only** dirty
  sections (via `encodeSection`'s switch) and emits everything else byte for byte. New sections with no
  existing occurrence go in *among* the ones already there, at the place `APPEND_ORDER` ranks them
  (`insertionPoint`: after the last section that comes before them, else at the front) — appending
  them at the end instead left a map that got its ISOM back with the lattice past FORC, which no
  editor writes and the Repair plugin then reported as out of order. Any mutation of scenario state must call
  `markDirty(scn, "NAME", ...)` for every section it affects, or the change is silently dropped on save.
  **The names are typed** (2026-10-06): `markDirty` takes `SectionName`, the union of the
  `MODELLED` tuple that `MODELLED_SECTIONS` is built from, so a misspelt name, a missing trailing
  space (`"STR"`) or a section with no encoder (`"VCOD"` — `encodeSection` answers null for it, and
  a dirty section that encodes to null is *left out of the file*) fails `npm run build`;
  `scenario.typecheck.ts` holds it to that. `strSectionName`, the `*Sections` helpers and `sync.ts`'s
  `FIELD_SECTIONS` return the union. All 82 existing calls compiled unchanged — there was no typo
  to find. What this does not catch is a call that is *missing*, and `Scenario.dirty` itself is
  still `Set<string>`: `editor/sections.ts`, the plugin API's read-only view and a dozen tests
  build or edit the set directly, and `tests/` is not type-checked at all.
- **Text encoding.** `StringTable.encoding` (`text/encoding.ts`, `TextEncoding`) is how the string
  table's bytes spell characters — the file carries no note of it. `decodeStrings` guesses from the
  whole table's bytes unless told (`detectTextEncoding`: valid UTF-8 wins outright, else every legacy
  encoding that decodes cleanly is scored by the share of non-ASCII text in its own script; the two
  single-byte pages, which decode anything, are told apart by where the high bytes sit in a word;
  Korean beats Chinese on a tie by table order and a `preferred` list can move that), `encodeStrings`
  writes the table's encoding and `?` for a character it lacks (`unencodableStrings` lists them for
  Check Map, the Save plan and the dialog). Decoding is `TextDecoder`; encoding is a reverse table
  built once per encoding by decoding every byte and lead/trail pair (`reverseTable`). **Node's ICU
  decoders differ from the browser's WHATWG ones**: Node's `euc-kr` is KS X 1001 without the CP949
  extension (8822 syllables silently dropped) and its `windows-1252` maps 0x80–0x9F to C1 controls —
  the latter is pinned by hand (`WINDOWS_1252_HIGH`) so tests and the browser agree, the former is
  skipped in the test (`tests/encoding.test.ts`) and works in Chromium. Before this the table was
  latin1 both ways and the encoder dropped every character to its low byte, so Korean text opened as
  mojibake and typing Korean wrote garbage. `setExtendedStrings(true)` moves the encoding to UTF-8
  (Remastered reads STRx as UTF-8 and nothing else reads it); `setTextEncoding` marks the STR/STRx
  section dirty. `create.ts` starts a new map UTF-8. `decodeTbl` (`dat/tbl.ts`) guesses the same way,
  so a localized `stat_txt.tbl` names units in its own language.
- To model a new section: add a codec in `sections/`, decode it in `parseScenario`, add a case to
  `encodeSection`, and add a `tests/chk.test.ts` round-trip. A new *registry* entry also needs a page
  in `docs/chk-format.md` and a layout in `scripts/lib/chk-reference.mjs#LAYOUTS`
  (`tests/chkReference.test.ts` fails without them): the reference's facts table, index, value and
  flag tables are generated from the registry, `create.ts`, `scenario.ts` (`APPEND_ORDER`, now
  exported for it, `MAP_VERSIONS`, `MODELLED_SECTIONS`) and the codecs' flag consts by
  `npm run docs:reference`; the layouts are written in that module and held to the encoders by
  the test (sizes for every section, offsets for UNIT/THG2/DD2/MRGN/UPRP and the UNIS/UPGS/TECS
  columns). The index's "Holds" column is each page's first sentence, so the prose stays in the doc.
- `create.ts` builds a fresh scenario (File ▸ New) with every section the game requires: the three the
  editor never models — `IVE2`, `VCOD` (StarEdit's fixed verification table, embedded in
  `sections/vcod.ts`; both fixture maps carry it byte for byte) and the empty CUWP slots `UPRP`/`UPUS` —
  go into `chk.sections` as raw bytes (`rawCreatedSections`), everything else is marked dirty and
  encoded on save, with the settings tables (`unitSettings`, `upgradeSettings`, … `wavs`) non-null on
  their defaults and only the Brood War (`x`) layouts of the revision pairs written — Blizzard's own
  Brood War maps carry no UNIS/UPGS/TECS/UPGR/PTEC; a hybrid file is the one with both.
  `requiredSections(fileVersion)` there (common + original layouts below 205 + `x` layouts from 63) is
  what Check Map tests a file against.
  `scenario.isom` is `null` only when the *file* had no `ISOM`; `encodeSection` then omits the section
  rather than writing a zeroed one; the same holds for `mask`, `wavs` and the settings tables.
- `mpq/scm.ts` wraps `mopaq` (≥ 1.4.0, the user's own library at `github.com/jeany55/mopaq`, published
  to npm from a `v*` tag): `.scm`/`.scx` → `staredit\scenario.chk`; bare `.chk` files are accepted.
  Non-scenario archive members are read by `readMembers`: by name where a name is known — the
  `(listfile)` plus `editor/sounds.ts#referencedMembers` (the WAV table, every `wav` action
  argument, the TrigScript entry file and manifest — the manifest's `files` list then names the
  rest through `readMembers`' second pass), probed with `slotOf`, since protectors strip the listfile
  and the sounds are then only findable by the names the scenario carries — into
  `archiveExtrasAtom`, and everything else (no name, or bytes this build cannot decode) as
  `StoredMembers` into `archiveStoredAtom`: mopaq's `members()` / `hashEntries()`, written back
  through `Creator.addStored` pinned at the same offset and hash slot, which is what keeps a
  member encrypted with the offset-adjusted key (StarEdit's extras all are) readable without its
  name. That forces the saved archive's sector size to the source's (`requiredSectorSize`) and
  the hash table to its old size; `planSave`'s fourth argument carries them (`SavePlan.stored`, a
  warning in words) and `buildMapFile`'s fifth hands them to `saveMap`. Before this, a map with no
  listfile lost every extra member on save with no warning — the first outside review found it.
  Protectors also point two hash entries at one block, or one block into another, so stored
  members can share bytes. mopaq before 1.6.1 refused those (`InvalidMember: stored member at
  offset … overlaps another`) and the map could not be saved at all — the first error the counts
  caught with a stack, 2026-10-27. 1.6.1 writes them back over each other (one source archive, so
  the overlapping bytes agree) and refuses only an overlap whose bytes differ; `tests/mpq.test.ts`
  ("share their bytes") is the case. Protectors also write block entries that point past the end
  of the file, up to 4 GB out. mopaq 1.6.1 handed those over as empty members at that offset and
  padded the rewrite out to reach them — tens of megabytes of zeros, or a `RangeError` allocating
  the archive (`new Uint8Array(archiveSize)` in `assemble`, then `new Blob` in `saveBytes`), the
  0.8.2 error counts, 2026-10-27/28. mopaq 1.6.2 leaves them out of `members()`; `scm.ts`'s
  `hasBytes` drops empty stored members on open *and* in `saveMap`, because recovery copies keep
  the members they were made with. ("past the end of the file" is the test.)
  `saveMap`'s options are compression (`none` / `zlib` / `pkware`),
  StarEdit-style encryption, sector size (4096, Blizzard's) and the listfile; `loadMap` reports how
  `scenario.chk` was stored (`scenarioInfo`, from `archive.fileInfo`). PKWARE is what StarEdit and the
  game's own maps use (fixture flags `0x80010200`), so it is the one compression every build reads; zlib
  needs 1.16.1+.
- **Modelling a new section** (checklist; was in `docs/file-formats.md` until 2026-10-16): a codec under
  `sections/`, decode it in `parseScenario`, a case in `encodeSection`, its name in the `MODELLED`
  tuple (`MODELLED_SECTIONS`, the `SectionName` union), and a round trip in `tests/chk.test.ts`. An
  optional section is `null` in the model when the file had none; never write a zeroed one.
- **The byte-for-byte suites need `fixtures/maps/*.scx`**: `tests/chk.test.ts`, `save.test.ts`,
  `settings.test.ts`, `data-settings.test.ts`, `trigger.test.ts`, `briefing.test.ts` and
  `cuwp.test.ts` re-encode Blizzard's maps and skip without them, so a green run on a clone (or CI)
  has not exercised them. Run them locally before changing anything under `src/formats/`.
- **The public docs' split.** `docs/file-formats.md` is the map maker's account (what Save keeps, the
  archive, revisions, protected maps); the text-encoding guess and everything byte-level live in
  `docs/chk-format.md` (the encoding guess is on the `STR` page, the `ISOM` explanation is the
  appendix *The isometric record explained* at the end, after every section's page).

### The reference's extras (2026-09-23): ISOM model, examples, pictures, chk.ksy

`docs/chk-format.md` now explains ISOM in full (lattice, words, values, 14 shapes, worked
example, diamonds → tiles, per-tileset value tables), the CV5 group record under MTXM, STR
control codes and layout facts, a UNIT/STR/ISOM hex example each, VCOD's SHA-256, and a
"How the sections fit together" page. Everything that can be generated is: `npm run
docs:reference` also writes `docs/images/{isom-lattice,isom-shapes,isom-example,chk-references}.svg`
(`scripts/lib/chk-diagrams.mjs`, sized for the site's ~760 px column — wider pictures shrink
their labels to unreadable) and `docs/chk.ksy` (`scripts/lib/chk-kaitai.mjs`, from `LAYOUTS` —
every row needs a `field` or an explicit `id` — plus the trigger record and enums).

Facts found on the eight fixture maps and pinned by `tests/chkReference.test.ts`:
- a diamond's value is stored 8× and the copies always agree; bits 0/15 always clear;
- the flag nibble is fixed by position (`isomWordFlags`), **except** that ground the map was
  started with and never repainted has flags 0 — one flat value per map. Read a word's owner
  from its position, not its flags;
- ISOM shape semantics (`ISOM_SHAPES`, quarters O/I/edge) agree with flat neighbours; which
  terrain of an edge set is outside/inside (`ISOM_EDGE_SETS`) comes from the brush's
  `isomTables` (test needs the tilesets); the worked example is what `paintIsom` paints;
- STR: 1024 slots, unused ones point at one 0 byte right after the offsets; MASK all 0xFF;
  VCOD identical to `defaultVcod()`.
Chkdraft's shape names for the inner corners ("jut in N" etc.) are inconsistent with the
neighbours, so the page describes shapes by which way the corner points.

`chk.ksy` was checked ad hoc (not a dependency): `kaitai-struct-compiler` 0.11 (npm, JS
build) compiles it to JavaScript and Python, and the generated JS parser read all eight maps
with no disagreement against `parseScenario` (units, sprites, doodads, locations, triggers,
strings, ISOM, MTXM). Redo that after changing the generator.

Later the same day: a "Protected maps" page (container tricks, section tricks, a reading
checklist) and hex examples for THG2, DD2, MRGN, FORC, PUNI and UNIx (`recordDump` in
`chk-reference.mjs`, from the real encoders; the "is up to date" test covers them). The
game-behaviour claims on the Protected maps page are the ones the reader, the registry's
combine modes and the Repair plugin's findings already make; nothing new about the game was
asserted, so the probe-map pass (melee/UMS reads, bad values, VCOD) is still owed.

2026-09-28, seven more pictures from the same module: `chk-repeats.svg` (the three combine
modes; its section lists come from `SECTION_SPECS`, so `chkDiagrams` now takes `defs`),
`chk-doodad-layers.svg`, `chk-tile-lookup.svg` (schematic — no tileset pixels, which would be
Blizzard art in the repository), and byte rulers for UNIT, THG2 and MRGN drawn from `LAYOUTS`
(`recordRulerSvg`; each field needs a short label in `RULER_LABELS` or it throws) plus the
trigger record from `CONDITION_FIELDS`/`ACTION_FIELDS`, which `docs/triggers.md` shows too.
`chk-diagrams.mjs` and `chk-reference.mjs` import each other; that is safe only while neither
uses the other's exports at module scope. Rendered to PNG for checking with Playwright's
headless shell (`page.setContent(svg)` + element screenshot); labels that do not fit their box
go under it with a leader, staggered.

### What the game does (2026-10-15): `scripts/lib/chk-game.mjs`

The reference's game facts (Read by, Required, The game accepts, More than one copy, the
index's Map list / Melee / Use Map Settings columns, the "game reads" and "game sizes"
blocks, and the pictures `chk-load`, `chk-reads`, `chk-walk`, `chk-repeats`, `chk-vcod`,
`chk-unit-path`) come from `chk-game.mjs`, **not** from `SECTION_SPECS`. It records
StarCraft 1.16.1: the loader was read from a decompile of the game and every claim that
mattered was run through a copy of the game's own code on 55 probe maps plus 26 variants.
That evidence is private and stays out of every repository (`~/github/scm-sim-reader/
chk-ledger/` LEDGER/LOADER/VCOD/DIFF.md, `chk-run/RESULTS.md`); the docs describe behaviour
in their own words, never code or addresses. `tests/chkReference.test.ts` holds the table
to the registry (every section placed once, editor-only = never read, exact sizes =
registry sizes). The VCOD pseudo-code on the page was run over the probe scenarios and
gives the reader's hashes, including the two the game refused.

The shape of it: the game walks the headers into a list, then runs fixed tables of
(name, handler, required) per revision and pass; table order decides handling order,
file order only orders copies. Passes: map list (9 sections, all required, also re-run at
game creation and start) → "Invalid Scenario" + "unreadable" if VER ≤ 59 else
"Expansion Set" whatever the fault; game start (melee: STR MTXM THG2 UNIT [+COLR at 205];
UMS adds MASK, settings, PUNI, UPRP, MRGN, TRIG) → "Error loading scenario file."; briefing
(STR MBRF) → result ignored. Sizes are exact except MTXM ≤ 131072, FORC ≤ 20 (zero-padded),
STR/MASK any; records whole. VCOD hashes only OWNR+SIDE (12 × 36-byte lobby records).

Where the editor now follows the game (2026-10-15, the follow-up to the docs pass):
- `requiredSections(ver, game = "ums")` in create.ts: `REQUIRED_SECTIONS` is what every game
  needs (map list + melee start), plus COLR from 205, plus TRIG, which only Remastered's map
  list needs (the editor follows Remastered there); `"ums"` adds `REQUIRED_UMS_SECTIONS`
  (MASK PUNI UPRP MRGN) and the original five below 205 or the `x` five from 205. A
  hybrid no longer requires the `x` tables. Check Map: missing "melee" sections are an
  error; missing UMS-only ones a warning, an error when the map has triggers.
- MRGN is written at exactly `locationSlots(fileVersion)` records (64 below 63, 255 from
  63), padded or cut; `setMapVersion` marks MRGN dirty and grows the model when the count
  changes; `locationCapacity` / `firstFreeSlot` stay inside it; Check Map errors on a used
  location past it. `tests/maps/original.scm` was regenerated (MRGN 1280).
- Combine modes: MRGN `last`; the six costs tables `entries` (`EntryLayout` on the spec,
  `reader.ts#layEntries`; plugin API type `CombineMode` gained the value, additive).
  `readPair` in scenario.ts: 205+ reads `x` alone; 59/63 read the original then the `x`
  one on top — costs tables entry by entry (`lay*Settings`), restrictions replaced whole.
  The one approximation: weapon columns go with the unit types that fire them (units.dat),
  so the parser takes them whole from a later copy that customises any unit type.
- Settings dialogs' "beyond the original layout" hint now keys on whether the file writes
  the `x` table, not on `VER`.
- STR keeps `minimum: 2` (Remastered's rule) on purpose.
- Remastered was played with twelve probes (the user's maps folder `CHK/Remastered/`,
  CHECKLIST.txt filled in 2026-10-15). Eleven matched 1.16.1. The one difference: a map
  with no TRIG is *Invalid Scenario* in Remastered's map list, melee included
  (`REMASTERED_NEEDS` in chk-game.mjs; the page's "Which game" lists the eleven). STR
  decoys were already known to differ.

Remastered's loader read (2026-10-17, 1.23.10.13515 dump + Ghidra; private ledgers
`~/github/scm-sim-reader/chk-ledger/REMASTERED-{loader,strings}.md`, tables in
`remastered/chk-tables.txt`). Same machinery and tables as 1.16.1, plus: VER 64 (= 63's
lists, no BW) and 206 (= 205's, needs BW), each with STR (o) + STRx (o) in every pass; the
map-list pass adds TRIG (required, size % 2400, scans for EUD Deaths/Set Deaths) and CRGB
(optional, exactly 32) for all five versions; after the map-list pass no string table →
fail. STR < 2 / STRx < 4 passed over; STRx after STR (table order). Per-string decoding:
UTF-8 → CP949 → Windows-1252, STRx included. DIM > 256 refused; MASK capped at 65,536;
UNIT start location owner ≥ 8 ignored; COLR values ≥ 12 skipped; CRGB mode ≥ 3 copies the
third byte into the lobby colour choice, but probe R13 played every Palette slot in its COLR
colour — the byte makes no difference in a game. UMS TRIG handler obfuscated (not read).
The page's "Where Remastered differs" and `REMASTERED_VERSIONS` / `REMASTERED_SECTIONS`
in chk-game.mjs carry it.

Editor follow-ups this found:
- DONE 2026-10-17: CRGB Palette slots get `[0, 0, COLR]` (was zeros; harmless either way, R13),
  Check Map warns on COLR ≥ 12 (`settings.md`). A first version that drew from the third byte
  was reverted after R13.
- DONE 2026-10-17: VER 64 is `MapVersion` "remasteredHybrid" (label "Remastered 1.21+ without
  Brood War"); `isRemasteredRevision` (64, ≥206) gates STRx in `setMapVersion`, the Map
  Revision dialog (which offers 64 only to a file that already is one) and Check Map's Ogg
  warning. Every numeric `fileVersion` test already treated 64 like 63, as the game does.
- DONE 2026-10-17: `parseScenario` takes STRx only at VER 64/206 (or when the file has no STR
  at all, so the text still shows — Check Map then errors "strings are in STRx"); an unread
  STRx is never dirty, so it is written back byte for byte. Check Map notes the decoy. STRx
  registry `minimum: 4`.
- The editor guesses one encoding for the whole table (`detectTextEncoding`); Remastered
  decides per string (UTF-8 → CP949 → 1252), so a table mixing UTF-8 and CP949 strings reads
  differently.
- Check Map: CRGB ≠ 32 bytes, DIM > 256 and TRIG ≢ 0 mod 2400 are map-list refusals.

Editor audit against the game (2026-10-17, branch `editor-follows-the-game`; private evidence in
`~/github/scm-sim-reader/editor-audit/`, findings C1–C14):
- `setMapVersion` now calls `addMissingSections`: every `requiredSections(newVer)` name and both
  halves `revisionSections` wants are marked dirty when the file lacks them (null settings models
  take the defaults first). Before, a new map or a 205 map moved to 59/63/64 was saved without
  UNIS/UPGS/TECS/UPGR/PTEC and refused at the start of a UMS game (run: AUD V59/V63/C59).
  `tests/support/testMaps.ts` marks those five by hand, which is why the committed maps never showed it.
- STR offsets are u16 in both games; past 64 KB they wrapped silently (AUD S64K: 126 of 700 strings
  wrong). `layoutStrings` / `stringTableOverflow` in `sections/strings.ts`: the layout is unchanged
  unless it overflows, then the longest blob goes last (only a string's start must fit). Save
  (`saveDocument`) throws `strOverflowText` before writing, so the file on disk stays good; Check
  Map has the same error. Internal round trips (`parseScenario(serializeScenario(…))` in sync, tab
  copies) still wrap — they cannot refuse.
  2026-10-31: the check refused untouched maps. A file's offsets may point partway into another
  string (suffix sharing); decoded, each is its own string, and laid out separately a 40 KB
  table "overflowed" by 199 strings. Now (1) Save and Check Map ask `unreachableStrings(scn)`,
  0 unless `STR ` is dirty; (2) the fallback layout (`packed`) also points every string whose
  bytes end another's into it (`suffixHosts`: sort by reversed bytes, a suffix precedes what it
  ends), so any table decoded from a file fits again once edited; (3) STRx takes `packed` when
  its plain layout runs past 64 KB, which only overlap produces. The plain layout is still the
  first choice, so ordinary saves and `tests/maps/` keep their bytes.
- The "STR holds 1024" Check Map error is gone: 1024 is StarEdit's table, the game read string 1500
  (AUD S1500). STRx keeps its 65,535 check.
