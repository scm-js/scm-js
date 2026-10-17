# Opening and saving maps

What scmJS does with a StarCraft map file when it opens and saves one. This is for map
makers deciding what to keep in a release copy, for people fixing a broken or protected
map, and for anyone writing a tool that reads what the editor writes. The [user
guide](guide.md#saving) covers the Save dialog itself; the format, section by section, is
in the [CHK format reference](chk-format.md).

The short version: the editor opens `.scm`, `.scx` and bare `.chk` files, rewrites only
the parts of the scenario you changed, and copies everything else through byte for byte,
including things it does not understand. A map loses nothing by passing through the editor
unless you ask for it in the Save dialog.

## The archive

A `.scm` or `.scx` file is an MPQ archive, the container format Blizzard used for its
games' data. The scenario is one member of that archive, always named
`staredit\scenario.chk`. Everything else in the archive is extra: custom sounds, custom
graphics, files another editor or a plugin put there. The editor keeps those members and
writes them back on save, so a map with its own sound files keeps them. A bare `.chk`
file, the scenario with no archive around it, opens too; some tools pass scenarios around
that way.

An archive whose file list was removed, as protectors often do, still opens. The editor
asks for the members the scenario refers to (its sounds, its script files) by name, so
they are still listed and editable. Any member it cannot name is carried across a save
exactly as stored, and the Save dialog says how many there are. A bare `.chk` cannot hold
them.

The Save dialog's **Archive** fold decides how the scenario is stored:

| Option | What it means |
| --- | --- |
| **PKWARE** | The compression StarEdit uses and every Blizzard map is stored with. Every version of the game reads it. |
| **zlib** | Smaller. Read by 1.16.1 and Remastered, not by older builds. |
| **None** | The largest, readable by anything. |
| **Encrypt** | StarEdit's light encryption of the members. It hides nothing from a map editor; some tools expect it. |

A map is written back the way it was opened: a map that came in as PKWARE goes out as
PKWARE. A new map gets StarEdit's layout, PKWARE and encrypted. A member stored with a
method the editor can read but not write (bzip2, for one) is written with whichever layout
the dialog shows.

### Built maps

A plugin can put a compiler between the map and the disk; the eudplib plugin does, for
scripts that need Remastered's extended triggers. The file then holds two scenarios:

- `staredit\scenario.chk` is the compiler's output, which is what the game reads.
- `scmjs\source.chk` is the map as the editor shows it.
- `scmjs\build.json` records which steps ran, which archive members they added, and the
  SHA-256 of the built scenario.

The two `scmjs\` members are always zlib-compressed, since the game never opens them.

Opening such a file gives back the map from `scmjs\source.chk`, so the trigger list shows
your triggers and not the generated ones. That only happens while the built scenario still
has the recorded hash. If another editor or a protector has changed it since, the editor
cannot tell which of the two you mean, so it opens the file as it stands, says so, and
leaves both members where they are. A bare `.chk` is never built.

## The scenario

The scenario is a flat sequence of sections, each a four-character name, a length and that
many bytes of data: `MTXM` holds the terrain, `UNIT` the placed units, `TRIG` the
triggers. The [CHK format reference](chk-format.md) has a page for every section, and
explains what the game does when a file [repeats a
section](chk-format.md#repeated-sections) or [gives one an odd
length](chk-format.md#odd-lengths). Map protectors rely on those cases: a protected map is
written so that the game reads it correctly and a naive editor reads it wrongly.

### What the editor does with it

The editor keeps every section in the order it found it, repeats included, and reads them
the way the game does. Opening a protected map shows what the game would show.

On save, only the sections you changed are written from the editor's own model. Edit a
trigger and `TRIG` is re-encoded; every other section, known or not, is written back from
the bytes it came in with, in its original order and with its original repeats. A section
an edit creates goes in where StarEdit would put it, not at the end. Bytes after the last
section are kept too, unless the Save dialog is told to drop them. So:

- A section this editor does not model survives. Nothing is lost by opening a map here,
  whatever made it.
- Repeated sections stay repeated. Flattening a protected map into one copy of each
  section is a deliberate choice: the Save dialog's *Merge repeated sections into one*
  does it by the game's own rules.

Every piece of text in the map lives in one string table, [`STR `](chk-format.md#str) (or
[`STRx`](chk-format.md#strx) on a Remastered map), and other sections point into it by
number. The editor never renumbers the table on save, since sections it carries as bytes
still point at the old numbers; a string that stops being used is blanked, not removed.

The table does not say which character encoding its text is in. The editor guesses as the
game would read it and shows the guess in Scenario ▸ Map Revision, where you can change
it. The text is written back in that encoding; a character it cannot hold becomes `?`,
which Check Map and the Save dialog report. The [`STR`](chk-format.md#str) page says how
the guess is made.

### Known and unknown sections

The [CHK format reference](chk-format.md#sections) lists every section the editor knows.
It decodes all of them into its own model and re-encodes them when you change them, except
`VCOD`, `IVER` and `IVE2`, which it only carries as bytes. Any other section is carried
through untouched. Tools ▸ Check Map reports a section the game requires and the file
lacks as an error.

### Sections a map may not have

`ISOM`, `MASK`, `WAV `, `CRGB`, `SWNM`, the CUWP slots and every settings table may be
missing from a map, and the editor does not add one to a file that had none: a map without
`MASK` stays without it, rather than gaining an all-clear fog table. The game is stricter.
A melee game never reads `MASK`, the CUWP slots or the settings tables, but a Use Map
Settings game needs them and stops at the start without them (see [What a map
needs](chk-format.md#what-a-map-needs)). The editor shows a map with no `MASK` fully
fogged, which is how a melee game starts. A map with no `ISOM` cannot use the isometric
brush until the record is rebuilt.

## Saving

### What to keep

The Save dialog's **What to keep** choice decides what goes into the file. None of it
changes the map you have open, only the file being written.

| Choice | What the file holds |
| --- | --- |
| **Everything** | Every section and archive member. The file opens in any editor with nothing lost. |
| **Smallest that plays** | All five ticks below, and StarEdit's PKWARE compression with encryption. The map plays the same; an editor opening it later has less to work with. |
| **Custom** | The ticks you choose. |

The five ticks under **Custom**:

- Leave out terrain editing data: `ISOM`, `TILE` and `DD2 `.
- Leave out editor bookkeeping: `IVER`, `IVE2`, `IOWN`, `UPUS`, `SWNM` and `WAV `.
- Leave out sections the format reference does not know.
- Merge repeated sections into one, by the game's rules.
- Drop bytes after the last section.

Each extra archive member also has its own tick in the **Archive** fold.

### What the game reads and what it skips

The nine sections in the first two ticks are read by editors and skipped by the game. The
map plays the same without them. What changes is what an editor can do with the file
afterwards:

- Without `ISOM`, the isometric brush has nothing to paint with. The Repair plugin can
  rebuild the record from the tiles, and does well on terrain that was laid isometrically
  to begin with.
- Without `TILE` and `DD2 `, doodads are no longer objects. Their tiles are still in the
  terrain and their sprites in `THG2`, but an editor cannot pick one up or restore the
  ground beneath it.
- Without `SWNM` and `WAV `, switches lose their names and the Sound Editor its list; the
  triggers that use them are unaffected.
- `IOWN`, `IVER`, `IVE2` and `UPUS` are StarEdit's own notes and cost nothing.

Stripping these is what map protectors and "map compressors" have always done. It can be
undone only as far as the Repair plugin can rebuild the record, so keep an unstripped copy
of any map you are still working on.

### The file you replace

A save that writes over a file keeps what it replaced. The desktop app copies the old file
to a `.bak` beside it (`Lagoon.scx` to `Lagoon.scx.bak`). A browser cannot write beside
the file, so it keeps the last three versions of each file name in its own storage, listed
in File ▸ Previous Versions…. A download replaces nothing, so Firefox and Safari have
nothing to keep. While a map has unsaved changes, the editor also keeps a recovery copy of
it, offered at the next start if the editor closed without saving.

The user guide covers both: [Saving](guide.md#saving) and [Recovery
copies](guide.md#recovery-copies).

## Revisions

The revision is the `VER ` value. It decides which sections the game reads, and so which
versions of the game can play the map:

| Revision | `VER ` | `TYPE` | Extension | Plays in |
| --- | --- | --- | --- | --- |
| StarCraft 1.00 | 59 | `RAWS` | `.scm` | every version of the game |
| Hybrid 1.04 | 63 | `RAWS` | `.scm` | every version; carries both settings layouts |
| Brood War 1.04 | 205 | `RAWB` | `.scx` | Brood War and Remastered |
| Remastered 1.21+ | 206 | `RAWB` | `.scx` | Remastered only, with `STRx` |

What the revision changes in the file:

- **Settings tables.** Brood War widened the five settings tables and gave the wider
  versions new names: a 1.00 map carries the original five, a Brood War map the `x` five,
  and a hybrid both (the [CHK format reference](chk-format.md#revisions) lists the pairs).
  The editor reads them as the game does, and writes whichever layouts the revision calls
  for plus any the file already carried, so a hybrid map stays a hybrid.
- **Locations.** A 1.00 file has 64 location slots and every later revision 255, the only
  sizes the game accepts. A 1.00 map is saved with its first 64, and Check Map names any
  location past them.

Scenario ▸ Map Revision changes the revision. It rewrites `VER ` and `TYPE`, switches the
string table between `STR ` and `STRx` for Remastered (and the text to UTF-8 with it), and
sets the encoding the text is written in. Every string keeps its number, so triggers and
locations still point at the right text. Tables the new revision no longer needs are not
discarded; the Save dialog lists what will be written.

## New maps

File ▸ New writes a Brood War map with the sections StarEdit writes for one: the `x`
layouts of the settings tables only, and no `IVER`, `SWNM` or `CRGB`, which StarEdit adds
when there is something to put in them. The terrain is one flat terrain type at the size
and tileset chosen, laid as StarEdit lays it, with a matching isometric record. The
location table has 255 slots with Anywhere in place, the fog table starts every player
unexplored, and the start locations the dialog places are part of the new map, so there is
nothing to undo.

## Replays

A replay (`.rep`) is not a map, but it carries the map it was played on. With the
Aftermath plugin, File ▸ Open Replay… opens that map in a view-only tab, beside the replay
viewer. A view-only map is never saved as itself, and the editor never writes a `.rep`.
**Save a Copy** or **Edit a Copy** gives you an ordinary map to keep.

## Protected and damaged maps

A protected map is one written to be played but not edited: sections repeated, resized or
given nonsense names, the archive's file list removed, the scenario member renamed or
duplicated, or `VCOD` and `ISOM` stripped. Nothing about the format is secret, so every
trick depends on an editor reading the file differently from the game. The editor reads
what the game would play. If the archive is damaged so badly that the scenario cannot be
read, the error says so.

When the scenario is readable, the Repair plugin, on by default, checks it on every open.
It looks for:

- a missing required section, a repeated section, or one of the wrong size;
- a stripped isometric record;
- content problems, such as strings whose colours look different in Remastered, which
  changed how a line break resets the colour.

What happens to a finding depends on what the repair would change:

- **A safe repair**, one that only writes what the game already does with the file or puts
  back what the editor needs, is made as the map opens. The map does not count as changed
  for it.
- **Anything else** waits in the status bar. Each finding says what the game does with the
  file as it is and what the repair would change, and nothing changes until you say so.
  The original bytes stay available to restore.

Preferences ▸ Plugins ▸ Repair can make the plugin ask before every repair. Tools ▸ Repair
Map… runs the same check by hand.

The editor does not add protection. The Save dialog can strip the editor-only sections,
which is the part of protection that costs an editor something, and that is as far as it
goes.

## Looking at the bytes

The Section Explorer plugin, installed from Plugins ▸ Browse Plugins…, is a hex editor
over the scenario: every section with what the editor knows about it, its bytes coloured
by field, each value shown with its meaning, and sections added, removed, renamed or
reordered. An edit there rewrites the file and reads it back, so a raw change to any
section reaches the whole editor, at the cost of the undo history.

Plugins reach the same thing through `api.document.sections` in the [plugin
API](plugins.md#apidocumentsections): the file as Save would write it, every occurrence
with its offset, and the same replace, rename, insert, remove and move operations.

## In the source

For developers. The archive and the scenario are under `src/formats/mpq/` and
`src/formats/chk/`, and the file-level policy is in `src/editor/`:

| File | Does |
| --- | --- |
| `src/formats/mpq/scm.ts` | Opens and writes the archive over [mopaq](https://github.com/jeany55/mopaq): finds the scenario, accepts a bare `.chk`, reports how the member was stored, keeps the other members. |
| `src/formats/chk/reader.ts` | Reads the run of sections: every occurrence in order, odd lengths, trailing bytes. |
| `src/formats/chk/sections/registry.ts` | One entry per known section: how copies combine, its size, and which Save groups it belongs to. |
| `src/formats/chk/scenario.ts` | The scenario model, reading and writing it, the revisions, and where a new section goes. |
| `src/formats/chk/sections/*.ts` | The codecs for each kind of section. |
| `src/formats/chk/create.ts` | File ▸ New, and the sections Check Map requires. |
| `src/formats/text/encoding.ts` | The text encodings and how one is guessed. |
| `src/editor/save.ts` | The save plan: what to keep, merging repeats, compression, and the dialog's warnings. |
| `src/editor/mapBuild.ts`, `src/services/mapBuild.ts` | Built maps: packing, restoring the source on open, running the steps. |
| `src/editor/sections.ts` | Section-level reads and writes for the Section Explorer plugin and `api.document.sections`. |
| `src/editor/validate.ts` | Check Map. |

[development.md](development.md) covers the tests and the conventions for changing any of
this.
