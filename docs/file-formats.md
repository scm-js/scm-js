# Opening and saving maps

This section contains documentation on what scmJS does with a StarCraft map file when it opens and saves one. This is for anyone
who wants to know what happens to their file: map makers deciding what to keep in a
release copy, and people fixing a broken or protected map. The
[user guide](../README.md#saving) covers the Save dialog itself; this document explains
the file it writes. The format itself, section by section, is in the
[CHK format reference](chk-format.md).

The short version: the editor opens `.scm`, `.scx` and bare `.chk` files, rewrites only
the parts of the scenario you changed, and copies everything else through byte for byte,
including things it does not understand and things it cannot even name. A map loses
nothing by passing through the editor unless you ask for it in the Save dialog.

## The archive

A `.scm` or `.scx` file is an MPQ archive, the container format Blizzard used for its
games' data. The scenario itself is one member of that archive, always named
`staredit\scenario.chk`. Everything else in the archive is extra: custom sounds, custom
graphics, files another editor or a plugin put there. The editor keeps those members and
writes them back on save, so a map with its own sound files comes out of the editor with
them still inside. A bare `.chk` file, the scenario with no archive around it, opens too;
some tools pass scenarios around that way.

An archive names its members in a `(listfile)`, and protectors often remove it. The
editor then finds the members the scenario itself refers to — its sound table, the
trigger script members — by asking for them by name, so a protected map's sounds are
still listed and editable. Anything left that it cannot name is carried across a save
exactly as stored, at the same place in the archive, so the game finds it as before;
the Save dialog says how many such members there are. Two things follow from
carrying them that way: the archive keeps the sector size it came with (zlib's larger
sectors are not used), and a bare `.chk` cannot hold them. A member the editor can name
but not decode is kept the same way.

The Save dialog decides how the scenario is stored in the archive:

| Option | What it means |
| --- | --- |
| **PKWARE** | The compression StarEdit uses and every Blizzard map is stored with. Every version of the game reads it. |
| **zlib** | Smaller. Read by 1.16.1 and Remastered, not by older builds. |
| **None** | The largest, readable by anything. |
| **Encrypt** | StarEdit's own light encryption of the member. It hides nothing from a map editor; it is there for files that other tools expect encrypted. |

A map is written back the way it was opened: the editor reads how the scenario was
stored and offers the same layout, so a map that came in as PKWARE goes out as PKWARE. A
new map gets StarEdit's layout, PKWARE and encrypted, with 4 KB sectors. A member stored
with a method the editor can read but not write (bzip2, for one) is written back with
whichever layout the dialog shows.

The same dialog can leave things out of the file. Each extra archive member has a tick.
So do the *editor-only* sections of the scenario, explained under
[What the game reads and what it skips](#what-the-game-reads-and-what-it-skips), and so
do sections the editor does not recognise and bytes left after the last section. None of
those ticks change the map you have open, only the file being written.

### Built maps

A plugin can put a compiler between the map and the disk; the eudplib plugin does, for
scripts that need Remastered's extended triggers. The file then holds two scenarios.
`staredit\scenario.chk` is the compiler's output, which is what the game reads.
`scmjs\source.chk` is the map as the editor shows it, and `scmjs\build.json` records
which steps ran, which archive members they added, and the SHA-256 of the built scenario.
Both are zlib-compressed whatever the dialog's compression says, since the game never
opens them.

Opening such a file gives back the map from `scmjs\source.chk`, so the trigger list
shows your triggers and not the generated ones. That only happens while the built
scenario still has the recorded hash. If another editor or a protector has changed it
since, the editor cannot tell which of the two you mean, so it opens the file as it
stands, says so, and leaves both members where they are. A bare `.chk` is never built.

## The scenario

The scenario is a flat sequence of sections, each a four-character name, a length and
that many bytes of data: `MTXM` holds the terrain, `UNIT` the placed units, `TRIG` the
triggers. The [CHK format reference](chk-format.md) has a page for every section with its
byte layout, and explains what the game does when a file
[repeats a section](chk-format.md#repeated-sections) or
[gives one an odd length](chk-format.md#odd-lengths). Map protectors rely on those cases:
a protected map is written so that the game reads it correctly and a naive editor reads it
wrongly, so opening and saving it in that editor produces a different map.

### What the editor does with it

The editor keeps every section in the order it found it, repeats included, and reproduces
the game's reading when it decodes them. Opening a protected map shows what the game
would show.

On save, only the sections you changed are written from the editor's own model. Edit a
trigger and `TRIG` is re-encoded; every other section, known or not, is written back from
the bytes it came in with, in its original order and with its original repeats. A section
that has to be added, because the map had none and an edit created one, goes in among the
others at the place StarEdit would put it rather than at the end. Bytes after the last
section are kept as well, unless the Save dialog is told to drop them.

Two consequences are worth knowing:

- A file another editor wrote with a section this one does not model keeps that section.
  Nothing is lost by opening a map here, whatever made it.
- Repeated sections stay repeated. If you want a protected map flattened into one clean
  copy of each section, that is a deliberate choice: the Save dialog's *Merge repeated
  sections into one* tick does it using the same rules the game uses, and the Repair plugin
  explains each finding before it changes anything.

Every piece of text in the map lives in one string table, [`STR `](chk-format.md#str)
(or [`STRx`](chk-format.md#strx) on a Remastered map), and the other sections point into
it by number. Because raw sections keep pointing at the numbers they were written with,
the editor never renumbers the table on save; a string that stops being used is blanked,
not removed.

Neither table says how its bytes spell characters; the `STR ` page says what StarEdit
wrote and how each version of the game reads it. The editor follows the game's reading:
a table that is valid UTF-8 is UTF-8; otherwise every legacy encoding that decodes the
bytes without error is scored by how much of the non-ASCII text falls in its own script,
and the best guess is shown in Scenario ▸ Map Revision for the user to correct. Korean and Chinese bytes are
often valid in each other's encoding, so a tie goes to Korean. The table is written back
in the encoding chosen, `?` standing in for a character it cannot hold, which Check Map
and the Save dialog report first. `stat_txt.tbl` and the other game tables are read the
same way, so a localized install names its units in its own language.

## Sections

The [CHK format reference](chk-format.md#sections) lists every section the editor knows,
with a page for each. The editor decodes all of them into its own model, and re-encodes
them when you change them, except `VCOD`, `IVER` and `IVE2`, which it only ever carries as
bytes. Any section not in that list is one the editor does not know, and it is carried
through untouched. Tools ▸ Check Map reports a section the game requires and the file
lacks as an error.

### What the game reads and what it skips

Nine sections are read by editors and skipped by the game: `ISOM`, `TILE` and `DD2 `
for terrain editing, and `IVER`, `IVE2`, `IOWN`, `UPUS`, `SWNM` and `WAV ` as
bookkeeping. The Save dialog can leave each group out, and *Smallest that plays* leaves
out both. The map plays the same without them. What changes is what an editor can do
with the file afterwards:

- Without `ISOM`, the isometric brush has nothing to paint with. The Repair plugin can
  rebuild the record from the tiles, and does a good job on terrain that was laid
  isometrically to begin with.
- Without `TILE` and `DD2 `, doodads are no longer objects. Their tiles are still in the
  terrain and their sprites are still in `THG2`, but an editor cannot pick one up or
  restore the ground beneath it.
- Without `SWNM` and `WAV `, switches lose their names and the Sound Editor its list; the
  triggers that use them are unaffected.
- `IOWN`, `IVER`, `IVE2` and `UPUS` are StarEdit's own notes and cost nothing.

Stripping these is what map protectors and "map compressors" have always done. It is
reversible only as far as the Repair plugin can reconstruct the record, so keep an
unstripped copy of any map you are still working on.

### Sections a map may not have

`ISOM`, `MASK`, `WAV `, `CRGB`, `SWNM`, the CUWP slots and every settings table are
optional, and the editor writes none of them into a file that had none: a map without a
`MASK` section stays without one, rather than gaining an all-clear fog table it never
had. A map with no `MASK` plays as fully fogged for every player, which is also how the
editor shows it. A map with no `ISOM` cannot use the isometric brush until the record is
rebuilt.

## Revisions

The revision is the `VER ` value. It decides which sections the game reads, and so which
versions of the game can play the map:

| Revision | `VER ` | `TYPE` | Extension | Plays in |
| --- | --- | --- | --- | --- |
| StarCraft 1.00 | 59 | `RAWS` | `.scm` | every version of the game |
| Hybrid 1.04 | 63 | `RAWS` | `.scm` | every version; carries both settings layouts |
| Brood War 1.04 | 205 | `RAWB` | `.scx` | Brood War and Remastered |
| Remastered 1.21+ | 206 | `RAWB` | `.scx` | Remastered only, with `STRx` |

Brood War widened the five settings tables and gave the wider versions new names, so a
1.00 map carries the original five, a Brood War map the `x` five, and a hybrid both; the
[CHK format reference](chk-format.md#revisions) lists the pairs. The editor keeps one model at the Brood War width and writes whichever layouts the
file's revision calls for, plus any the file already carried, so a hybrid map stays a
hybrid. Changing the revision in Scenario ▸ Map Revision rewrites `VER ` and `TYPE`,
switches the string table between `STR ` and `STRx` for Remastered (and the text to
UTF-8 with it), sets the text encoding the table is written in, and leaves every
string index where it was, so triggers and locations keep pointing at the right text.
It does not discard the tables the new revision no longer needs; the Save dialog lists
what will be written.

## New maps

File ▸ New writes a Brood War map with the section set StarEdit writes for one: the
`x` layouts of the settings tables only, and without `IVER`,
`SWNM` and `CRGB`, which StarEdit adds when there is something to put in them. The terrain is
one flat terrain type at the size and tileset chosen in the dialog, laid as StarEdit lays it,
in left/right tile pairs that share a variation, with a matching isometric record. The
location table has 255 slots with Anywhere in place, the fog table starts every player
unexplored, and the start locations the dialog places are part of the new map rather
than an edit to it, so there is nothing to undo.

## Protected and damaged maps

A protected map is one written to be played but not edited: sections repeated, resized or
given nonsense names, the archive's file list removed, the scenario member renamed or
duplicated, or `VCOD` and `ISOM` stripped. Nothing about the format is secret, so every
trick depends on an editor reading the file differently from the game.

The editor opens what the game would play. Where the archive itself is damaged so that
the scenario cannot be read, the error says so. Where the scenario is readable, the
Repair plugin, on by default, checks it on every open and shows a dialog only when it
finds something: a missing required section, a repeat, a wrong size, a stripped
isometric record, and the one content finding, strings whose colours render differently
since Remastered changed how a line break resets the colour. Each finding says what the
game does with the file as it is, what the repair would change, and whether it is
recommended; nothing is changed until you say so, and the original bytes stay available
to restore. Tools ▸ Repair Map… runs the same check by hand.

The editor does not add protection. Its Save dialog can strip the editor-only sections,
which is the part of protection that costs an editor something, and that is as far as it
goes.

## Looking at the bytes

The Section Explorer plugin, installed from Plugins ▸ Browse Plugins…, is a hex editor
over the scenario: every section with what the editor knows about it, its bytes coloured
by field, each value shown with its meaning, and sections added, removed, renamed or
reordered. An edit there is applied by rewriting the file and reading it back, so a raw
change to any section, modelled or not, reaches the whole editor, at the cost of the undo
history.

Plugins reach the same thing through `api.document.sections` in the
[plugin API](plugins.md#apidocumentsections): the file as Save would write it, every
occurrence with its offset, and the same replace, rename, insert, remove and move
operations.

## In the source

For developers. Everything above is implemented under `src/formats/chk/` and
`src/formats/mpq/`, with the file-level policy in `src/editor/`:

| File | Does |
| --- | --- |
| `src/formats/mpq/scm.ts` | Opens and writes the archive over [mopaq](https://github.com/jeany55/mopaq): finds `staredit\scenario.chk`, accepts a bare `.chk`, reports how the member was stored, keeps the other members. |
| `src/formats/chk/reader.ts` | Parses the chunk stream into a `ChkFile`: every occurrence in order, truncation and negative lengths recorded, trailing bytes kept. `layer()` reproduces the game's overwrite semantics. |
| `src/formats/chk/sections/registry.ts` | One entry per known section: combine mode, fixed size (some depend on the map's dimensions), record stride, and the `editorOnly` flag the Save dialog's strip groups are built from. |
| `src/formats/chk/scenario.ts` | The `Scenario` model, `parseScenario` and `serializeScenario`, the `dirty` set that decides what is re-encoded, the revision table, `revisionSections` for the settings pairs, and the insertion order for a section the file did not have. |
| `src/formats/chk/sections/*.ts` | The codecs: `terrain`, `objects` (units, sprites, doodads, locations), `players`, `strings`, `settings`, `triggers`, `cuwp`, `sounds`, and the `vcod` table. |
| `src/formats/chk/create.ts` | File ▸ New, and `requiredSections(version)`, which Check Map tests a file against. |
| `src/editor/save.ts` | The save plan: strip groups, merging repeats with the registry's mode, the sector size per compression, and the warnings the dialog shows. |
| `src/editor/mapBuild.ts`, `src/services/mapBuild.ts` | Built maps: packing the step's output with the source beside it, restoring the source on open, and running the steps without letting one cost a save. |
| `src/editor/sections.ts` | Section-level reads and writes for the Section Explorer plugin and `api.document.sections`. |
| `src/editor/validate.ts` | Check Map. |
| `src/data/triggerDefs.ts`, `src/formats/triggers/text.ts` | Which field of a trigger record holds which argument, and the text format. |

The rules that matter when changing any of it:

- Any code that mutates the scenario has to mark every section it touched dirty, or the
  change never reaches the file.
- To model a new section: add a codec under `sections/`, decode it in `parseScenario`,
  add a case to `encodeSection`, add it to `MODELLED_SECTIONS`, and add a round trip to
  `tests/chk.test.ts`.
- Optional sections are `null` in the model when the file had none, and the encoder
  omits them then. Do not write a zeroed one.
- The tests re-encode Blizzard's own maps byte for byte: `tests/chk.test.ts`,
  `tests/save.test.ts`, `tests/settings.test.ts`, `tests/data-settings.test.ts`,
  `tests/trigger.test.ts`, `tests/briefing.test.ts` and `tests/cuwp.test.ts` run against
  `fixtures/maps/*.scx`, which is gitignored (Blizzard data) and skipped when absent. A
  green run on a clone without the fixtures has not exercised them.
