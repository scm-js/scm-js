# Map files

What is inside a StarCraft map file, and what scmJS does with it. This is for anyone who
wants to know what happens to their file: map makers deciding what to keep in a release
copy, people fixing a broken or protected map, and developers reading the format for the
first time. The [user guide](../README.md#saving) covers the Save dialog itself; this
document explains the file it writes.

The short version: the editor opens `.scm`, `.scx` and bare `.chk` files, rewrites only
the parts of the scenario you changed, and copies everything else through byte for byte,
including things it does not understand. A map loses nothing by passing through the
editor unless you ask for it in the Save dialog.

## The archive

A `.scm` or `.scx` file is an MPQ archive, the container format Blizzard used for its
games' data. The scenario itself is one member of that archive, always named
`staredit\scenario.chk`. Everything else in the archive is extra: custom sounds, custom
graphics, files another editor or a plugin put there. The editor keeps those members and
writes them back on save, so a map with its own sound files comes out of the editor with
them still inside. A bare `.chk` file, the scenario with no archive around it, opens too;
some tools pass scenarios around that way.

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

## The scenario

The scenario is a flat sequence of chunks. Each chunk is a four-character name, a length,
and that many bytes of data: `MTXM` holds the terrain, `UNIT` the placed units, `TRIG`
the triggers. The complete list is under [Sections](#sections). The community
reference for the layout of every section is
[wiki.staredit.net/wiki/Scenario.chk](http://wiki.staredit.net/wiki/Scenario.chk).

### How the game reads a file

The game reads the chunks one after another into fixed-size buffers, so a section that
appears twice in a file is not simply replaced by its second copy. What happens depends
on the section:

| Behaviour | Sections | What a repeat does |
| --- | --- | --- |
| Overlay | `MTXM`, `TILE`, `ISOM`, `MASK`, `MRGN` | The second copy overwrites only as many bytes as it carries. A second `MTXM` half the size of the map rewrites the top half and leaves the bottom as the first copy had it. |
| Append | `UNIT`, `THG2`, `DD2 `, `TRIG`, `MBRF` | The copies concatenate into one list. Two `TRIG` sections are one longer trigger list. |
| Last | everything else | The later copy replaces the earlier one. |

A section can also be shorter or longer than the game expects, carry a name that is not a
real section, or declare a length that runs past the end of the file. The game copes with
all of it in its own particular ways, and *protected* maps rely on exactly that: a map
protector writes a file that the game reads correctly and that a naive editor reads
wrongly, so opening and saving it in that editor produces a different map.

### What the editor does with it

The editor keeps every chunk in the order it found it, repeats included, and reproduces
the game's reading when it decodes them. Opening a protected map shows what the game
would show.

On save, only the sections you changed are written from the editor's own model. Edit a
trigger and `TRIG` is re-encoded; every other chunk, known or not, is written back from
the bytes it came in with, in its original order and with its original repeats. A section
that has to be added, because the map had none and an edit created one, goes in among the
others at the place StarEdit would put it rather than at the end. Bytes after the last
chunk are kept as well, unless the Save dialog is told to drop them.

Two consequences are worth knowing:

- A file another editor wrote with a section this one does not model keeps that section.
  Nothing is lost by opening a map here, whatever made it.
- Repeated sections stay repeated. If you want a protected map flattened into one clean
  copy of each section, that is a deliberate choice: the Save dialog's *Merge repeated
  sections into one* tick does it using the same rules the game uses, and the Repair plugin
  explains each finding before it changes anything.

The scenario's own strings live in one table, `STR ` (or `STRx` on a Remastered map),
and every name in the file points into it by number: the scenario name and description,
force names, location names, custom unit names, switch names, sound file paths, and the
text and sound of every trigger action. Index 0 means no string. Because raw sections
keep pointing at the numbers they were written with, the editor never renumbers the
table on save; a string that stops being used is blanked, not removed. `STR ` addresses
its strings with 16-bit offsets, so the whole table has to fit in 64 KB; `STRx` uses
32-bit offsets and has no such limit.

## Sections

Every section the editor knows. *Modelled* sections are decoded into the editor's own
model and re-encoded when you change them; the rest are carried as bytes. *Required*
sections are ones the game refuses to load a map without, and Tools ▸ Check Map reports
a missing one as an error.

**Identity**

| Section | Holds | Modelled | Required |
| --- | --- | --- | --- |
| `TYPE` | `RAWS` (original StarCraft) or `RAWB` (Brood War) | yes | |
| `VER ` | the file revision, see [Revisions](#revisions) | yes | yes |
| `IVER`, `IVE2` | StarEdit's version stamps, read by nothing | | |
| `VCOD` | a 1040-byte verification table, the same in every unprotected map; the game refuses a map without it | | yes |

**Players**

| Section | Holds | Modelled | Required |
| --- | --- | --- | --- |
| `OWNR` | each slot's type: human, computer, rescuable, neutral, unused | yes | yes |
| `IOWN` | StarEdit's own copy of the player types; the editor writes both and Check Map warns when a file's two disagree | yes | |
| `SIDE` | each slot's race | yes | yes |
| `COLR` | each slot's colour, from the classic palette | yes | |
| `CRGB` | Remastered's per-slot RGB colours and colour modes | yes | |
| `FORC` | the four forces: names, membership, allied victory and the other flags | yes | yes |

**The map**

| Section | Holds | Modelled | Required |
| --- | --- | --- | --- |
| `DIM ` | width and height in tiles | yes | yes |
| `ERA ` | the tileset | yes | yes |
| `MTXM` | the terrain as the game draws it, one tile id per cell, doodads included | yes | yes |
| `TILE` | the terrain under the doodads, StarEdit's copy; editor-only | yes | |
| `ISOM` | the isometric record: the lattice of terrain diamonds the isometric brush paints; editor-only | yes | |
| `DD2 ` | the placed doodads as objects, so an editor can select and remove one; editor-only | yes | |
| `MASK` | fog of war: which players start with each tile unexplored | yes | |

**Objects**

| Section | Holds | Modelled | Required |
| --- | --- | --- | --- |
| `UNIT` | every placed unit, 36 bytes each | yes | yes |
| `THG2` | sprites, both pure sprites and the unit-shaped ones | yes | yes |
| `MRGN` | locations: 64 slots on an original map, 255 on Brood War; slot 64 is Anywhere | yes | yes |

**Text and sound**

| Section | Holds | Modelled | Required |
| --- | --- | --- | --- |
| `STR `, `STRx` | the string table, 16-bit or 32-bit offsets | yes | yes |
| `SPRP` | which strings are the scenario name and description | yes | yes |
| `SWNM` | switch names; editor-only | yes | |
| `WAV ` | the list of sound files, for the Sound Editor; editor-only | yes | |

**Triggers**

| Section | Holds | Modelled | Required |
| --- | --- | --- | --- |
| `TRIG` | the triggers, 2400 bytes each | yes | yes |
| `MBRF` | the mission briefing, in the same record | yes | yes |
| `UPRP` | the 64 Create Unit with Properties slots | yes | yes |
| `UPUS` | which of those slots StarEdit considers in use; editor-only | yes | |

**Settings**

| Section | Holds | Modelled | Required |
| --- | --- | --- | --- |
| `PUNI` | which unit types each player may build | yes | yes |
| `UNIS`, `UNIx` | unit settings: hit points, shields, armour, build time, cost, weapon damage, names | yes | by revision |
| `UPGS`, `UPGx` | upgrade costs and times | yes | by revision |
| `UPGR`, `PUPx` | upgrade levels each player starts at and may reach | yes | by revision |
| `TECS`, `TECx` | technology costs and times | yes | by revision |
| `PTEC`, `PTEx` | which technologies each player starts with and may research | yes | by revision |

The settings pairs are the original and Brood War layouts of the same table; the next
section says which a file needs. Anything not in these tables is a section the editor
does not know, carried through untouched.

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

The revision is the `VER ` value, and it decides which sections the game reads:

| Revision | `VER ` | `TYPE` | Extension | Plays in |
| --- | --- | --- | --- | --- |
| StarCraft 1.00 | 59 | `RAWS` | `.scm` | every version of the game |
| Hybrid 1.04 | 63 | `RAWS` | `.scm` | every version; carries both settings layouts |
| Brood War 1.04 | 205 | `RAWB` | `.scx` | Brood War and Remastered |
| Remastered 1.21+ | 206 | `RAWB` | `.scx` | Remastered only, with `STRx` |

Brood War widened the settings tables, because it added units, upgrades and technologies,
and gave the wider versions new names:

| Original | Brood War | Table |
| --- | --- | --- |
| `UNIS` (100 weapons) | `UNIx` (130) | unit settings |
| `UPGS` (46 upgrades) | `UPGx` (61) | upgrade settings |
| `UPGR` | `PUPx` | upgrade restrictions |
| `TECS` (24 techs) | `TECx` (44) | technology settings |
| `PTEC` | `PTEx` | technology restrictions |

A 1.00 map needs the original five; a Brood War map needs the `x` five; a hybrid map
needs both, which is the whole point of a hybrid: the original game reads one set and
Brood War the other. Blizzard's own Brood War maps carry only the `x` layouts.

The editor keeps one model at the Brood War width and writes whichever layouts the
file's revision calls for, plus any the file already carried, so a hybrid map stays a
hybrid. Changing the revision in Scenario ▸ Map Revision rewrites `VER ` and `TYPE`,
switches the string table between `STR ` and `STRx` for Remastered, and leaves every
string index where it was, so triggers and locations keep pointing at the right text.
It does not discard the tables the new revision no longer needs; the Save dialog lists
what will be written.

## New maps

File ▸ New writes a Brood War map with the section set StarEdit writes for one: the
tables above with the `x` layouts of the settings pairs only, and without `IVER`,
`SWNM` and `CRGB`, which StarEdit adds when there is something to put in them. The
terrain is one
flat terrain type at the size and tileset chosen in the dialog, laid as StarEdit lays it,
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
