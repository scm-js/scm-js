# The map file fidelity model

### Map file fidelity model (`src/formats/chk/`)

- `reader.ts` parses the CHK container into `ChkFile` — **every** section in file order, repeats kept.
  `sections/registry.ts` declares each section's `CombineMode` (`last` / `overlay` / `append`) and fixed
  size; this mirrors how the game itself resolves duplicated sections (protected maps depend on it).
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
  `encodeSection`, and add a `tests/chk.test.ts` round-trip.
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
  `saveMap`'s options are compression (`none` / `zlib` / `pkware`),
  StarEdit-style encryption, sector size (4096, Blizzard's) and the listfile; `loadMap` reports how
  `scenario.chk` was stored (`scenarioInfo`, from `archive.fileInfo`). PKWARE is what StarEdit and the
  game's own maps use (fixture flags `0x80010200`), so it is the one compression every build reads; zlib
  needs 1.16.1+.
