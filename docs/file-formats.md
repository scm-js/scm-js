# Map files

How scm-js reads and writes `.scm`, `.scx` and `.chk`, and how much of a file it
understands. For the user-facing summary see the [README](../README.md).

## Containers

`.scm` and `.scx` are MPQ archives. The scenario itself is the archive member
`staredit\scenario.chk`; everything else in the archive (custom sounds, graphics,
whatever a map author put there) is unrelated to the scenario data. Bare `.chk`
files open directly.

`src/formats/mpq/scm.ts` wraps [mopaq](https://github.com/jeany55/mopaq) for both
directions. Reading needs PKWARE DCL decompression, because that is what StarCraft
compresses nearly every file in its own archives with. Non-scenario members are held
in `archiveExtrasAtom` and written back on save, so a map's custom content survives a
round trip through the editor. `scenario.chk` is written uncompressed, which older
StarCraft builds need.

## The fidelity model

A CHK file is a flat sequence of `NAME` + length + payload chunks. The same section
can appear more than once, and the game resolves the repeats in a specific way, so a
parser that keeps only the last occurrence of each section will silently change what
a protected map does.

`src/formats/chk/reader.ts` therefore parses the container into a `ChkFile` that
keeps **every** section in file order, repeats included.
`src/formats/chk/sections/registry.ts` declares each section's combine mode and the
fixed buffer size the game reads it into:

| Mode | Meaning |
| --- | --- |
| `last` | a later occurrence replaces the earlier one outright |
| `overlay` | a later occurrence overwrites only its own prefix of the buffer |
| `append` | occurrences concatenate into one list |

`src/formats/chk/scenario.ts` then decodes the sections the editor models into typed
fields on a `Scenario`. `Scenario.dirty` is a set of section names, and
`serializeScenario` re-encodes only the dirty ones. Everything else is emitted byte
for byte, in its original order and with its original repeats. Saving a map the
editor only partly understands does not damage the parts it does not.

Any code that mutates scenario state has to call `markDirty(scn, "NAME")` for every
section it affects, or the change never reaches the file.

## Section coverage

Decoded into typed fields and re-encoded when edited:

| Section | Holds |
| --- | --- |
| `TYPE`, `VER `, `IVE2` | map type and revision |
| `DIM `, `ERA ` | dimensions, tileset |
| `SPRP` | scenario name and description |
| `STR `, `STRx` | string table (16-bit / Remastered 32-bit offsets) |
| `OWNR`, `IOWN`, `SIDE`, `COLR`, `CRGB`, `FORC` | players, races, colours, forces |
| `MTXM`, `TILE`, `ISOM` | terrain |
| `MASK` | fog of war |
| `UNIT`, `THG2`, `DD2 ` | units, sprites, doodads |
| `MRGN` | locations |
| `TRIG`, `MBRF`, `SWNM` | triggers, briefings, switch names |
| `UNIS`/`UNIx`, `PUNI` | unit settings and availability |
| `UPGS`/`UPGx`, `UPGR`/`PUPx` | upgrade settings and restrictions |
| `TECS`/`TECx`, `PTEC`/`PTEx` | technology settings and restrictions |
| `WAV ` | sound table |

Kept as raw bytes and written back unchanged:

| Section | Why |
| --- | --- |
| `VCOD` | StarEdit's fixed verification table, identical in every unprotected map |
| `UPRP`, `UPUS` | CUWP slots; triggers reference them by number, and there is no editor for them yet |
| `IVER` | obsolete StarEdit version stamp |
| anything else | unknown or undocumented sections a map happens to carry |

To model a new section: add a codec under `sections/`, decode it in `parseScenario`,
add a case to `encodeSection`, and add a round-trip test to `tests/chk.test.ts`.

## Revision pairs

Brood War widened several tables and gave the wider versions new names. The editor's
model is always the Brood War width, and the original-layout encoders trim it on the
way out. `revisionSections` in `scenario.ts` decides which of a pair to write: the
one the file's revision calls for, plus whichever the file already carries. A hybrid
map keeps both `UNIS` and `UNIx`; an original-game map keeps only `UNIS`.

| Original | Brood War | Table |
| --- | --- | --- |
| `UNIS` (100 weapons) | `UNIx` (130) | unit settings |
| `UPGS` (46 upgrades) | `UPGx` (61) | upgrade settings |
| `UPGR` | `PUPx` | upgrade restrictions |
| `TECS` (24 techs) | `TECx` (44) | technology settings |
| `PTEC` | `PTEx` | technology restrictions |

`setMapVersion` rewrites `VER `/`TYPE` and flips the string table between `STR ` and
`STRx`. String indices never change, so triggers and locations keep pointing where
they did.

## New maps

`src/formats/chk/create.ts` builds File ▸ New from nothing, with the same section set
a StarEdit map has: `IVE2`, `VCOD` and the empty CUWP slots as raw bytes, everything
else marked dirty and encoded on save. Terrain is a flat 128×128 Badlands fill laid
out the way StarEdit lays it out, in left/right tile pairs sharing one random
variation, with `ISOM` as the two flat quads that alternate across the diamond grid.

Only the Brood War layouts of the revision pairs are written. Blizzard's own Brood
War maps carry no `UNIS`/`UPGS`/`TECS`/`UPGR`/`PTEC`; a file with both layouts is a
hybrid.

`requiredSections(fileVersion)` is the list Tools ▸ Check Map tests a file against:
the common sections, plus the original layouts below revision 205, plus the `x`
layouts from revision 63.

## Sections that may be absent

`ISOM`, `MASK`, `WAV `, `CRGB` and the settings tables are `null` when the file had
no such section, and `encodeSection` then omits them rather than writing a zeroed
one. This matters: a map with no `MASK` behaves as fully fogged, and a map with no
`ISOM` cannot be edited with the isometric brush until the lattice is rebuilt from
the tiles.

## Looking at the bytes

A plugin can read and rewrite the file at the section level through
`api.document.sections` (`src/editor/sections.ts`): `currentChk` serialises the open
scenario — dirty sections encoded, everything else byte for byte — and parses the result
back so every occurrence has its offset, and a raw edit mutates that `ChkFile` and
parses a fresh `Scenario` from it, which `replaceScenarioAtom` installs in place of the
open one. The Section Explorer plugin (listed by default, off until ticked) is the
annotated hex editor built on that: every section with what the registry knows about
it, its bytes coloured by field, and the meaning of each value.

