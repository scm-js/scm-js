# CHK format reference

The byte layout of every section of a StarCraft and Brood War scenario file
(`scenario.chk`), with what each section is for, what the game does when a file repeats
it, whether a map can do without it, and the values its fields take.

This is the reference half of [Map files](file-formats.md), which explains what the editor
does with a file as a whole: the archive around the scenario, protected maps, what Save
keeps and what it can strip. The facts in the table at the top of each page (size,
repeats, required, read by) and the value and flag tables come from the code the editor
reads and writes maps with. The byte layouts are checked by its tests against the same
code, which re-encodes Blizzard's own maps byte for byte. The community's older reference
is [wiki.staredit.net/wiki/Scenario.chk](http://wiki.staredit.net/wiki/Scenario.chk),
which this one agrees with except where a page says otherwise.

## The container

A scenario is a flat run of sections, with no header of its own. Each section is a
four-character name, a 32-bit length, and that many bytes of data:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | 4 characters | The name, padded with spaces to four: `VER `, `DIM `, `STR ` |
| 4 | i32 | The length of the data, in bytes |
| 8 | the length | The data |

The next section starts straight after the data. Sections may come in any order, and the
game does not need them in the order StarEdit writes them (the order of this reference).
A name the game does not know is skipped.

All numbers in every section are little-endian. Unsigned unless a layout says `i32`.
Positions are in pixels, and a tile is 32 pixels square. Player slots are numbered from 0
for Player 1 to 11 for Player 12. Text is never stored in a section itself: a section holds
a *string number*, the position of the text in the [string table](#str), and 0 means no
text.

### Repeated sections

The game reads the sections one after another into fixed places in memory, so a section
that appears twice is not simply replaced by its second copy. Each section's page says
which of these applies to it:

- **Only the last copy counts.** Most sections.
- **Every copy is written over the start of the same fixed-size space**, in file order, so
  a later copy replaces only as many bytes as it carries. A second `MTXM` half the size of
  the map rewrites the top half of the terrain and leaves the bottom as the first copy had
  it. The terrain sections, the fog and the locations work this way.
- **Every copy counts.** The records of all of them are one list, in file order: two
  `TRIG` sections are one longer trigger list. Units, sprites, doodads, triggers and
  briefings work this way.

### Odd lengths

A length can be shorter or longer than the section needs, or run past the end of the
file, or be negative, which makes the game read backwards from where it is. Map protectors
use all of these, since each is something the game reads one way and a careless editor
another. [Map files](file-formats.md#protected-and-damaged-maps) says what the editor does
with such a file.

## Sections

In the order StarEdit writes them. *Read by editors* means the game skips the section and
a map plays the same without it. *By revision* means the section is required in some
[revisions](#revisions) of the file and not others.

<!-- generated: index -->
| Section | Holds | Read by | Required |
| --- | --- | --- | --- |
| [`TYPE`](#type) | Which game the file is for | the game |  |
| [`VER␠`](#ver) | The file's revision, which decides which sections the game reads | the game | yes |
| [`IVER`](#iver) | A version stamp older versions of StarEdit wrote | editors |  |
| [`IVE2`](#ive2) | StarEdit's version stamp | editors |  |
| [`VCOD`](#vcod) | A verification table the game checks the file against when it loads a map, and refuses the map when the check fails | the game | yes |
| [`IOWN`](#iown) | StarEdit's own copy of `OWNR` | editors |  |
| [`OWNR`](#ownr) | Who controls each of the 12 player slots: a human, a computer, a rescuable player, a neutral one, or nobody | the game | yes |
| [`ERA␠`](#era) | The tileset | the game | yes |
| [`DIM␠`](#dim) | The map's size in tiles | the game | yes |
| [`SIDE`](#side) | Each player's race | the game | yes |
| [`MTXM`](#mtxm) | The terrain the game draws: one 16-bit tile number per tile, including the tiles of placed doodads | the game | yes |
| [`PUNI`](#puni) | Which unit types each player may build | the game | yes |
| [`UPGR`](#upgr) | How far each player may research each upgrade, and the level they start at, for the 46 upgrades of the original game | the game | by revision |
| [`PTEC`](#ptec) | Whether each player may research each ability, and whether they start with it, for the 24 abilities of the original game | the game | by revision |
| [`UNIT`](#unit) | The units placed on the map, 36 bytes each | the game | yes |
| [`ISOM`](#isom) | The isometric record, which an editor's isometric brush paints with: the lattice of terrain diamonds from which it works out the cliffs and edges between terrain types | editors |  |
| [`TILE`](#tile) | The terrain with the doodads left out: what is under each doodad | editors |  |
| [`DD2␠`](#dd2) | The doodads placed on the map, as objects an editor can select and remove | editors |  |
| [`THG2`](#thg2) | Sprites placed on the map | the game | yes |
| [`MASK`](#mask) | Fog of war at the start: which players begin with each tile unexplored | the game |  |
| [`STR␠`](#str) | The string table | the game | yes |
| [`STRx`](#strx) | The string table of StarCraft: Remastered: the same as `STR` with 32-bit numbers, so the table has no 64 KB limit | the game |  |
| [`UPRP`](#uprp) | The 64 unit properties slots used by the Create Unit with Properties action | the game | yes |
| [`UPUS`](#upus) | Which of the 64 `UPRP` slots StarEdit considers in use | editors |  |
| [`MRGN`](#mrgn) | The locations | the game | yes |
| [`TRIG`](#trig) | The triggers, 2400 bytes each, in the order they run | the game | yes |
| [`MBRF`](#mbrf) | The mission briefings, in the same 2400-byte record as a trigger, with their own set of actions | the game | yes |
| [`SPRP`](#sprp) | The scenario's name and description, as string numbers | the game | yes |
| [`FORC`](#forc) | The four forces: which force each of Players 1 to 8 is in, each force's name, and its settings | the game | yes |
| [`WAV␠`](#wav) | StarEdit's list of the sounds in the map: the name of each sound file in the archive, as a string number | editors |  |
| [`UNIS`](#unis) | Unit settings for the original game | the game | by revision |
| [`UPGS`](#upgs) | Upgrade costs and research times for the 46 upgrades of the original game | the game | by revision |
| [`TECS`](#tecs) | Ability costs, research times and energy costs for the 24 abilities of the original game | the game | by revision |
| [`SWNM`](#swnm) | The names of the 256 switches, as string numbers | editors |  |
| [`COLR`](#colr) | The colour of each of Players 1 to 8 | the game |  |
| [`PUPx`](#pupx) | `UPGR` for Brood War: the same tables, for 61 upgrades | the game | by revision |
| [`PTEx`](#ptex) | `PTEC` for Brood War: the same tables, for 44 abilities | the game | by revision |
| [`UNIx`](#unix) | `UNIS` for Brood War: the same tables, with 130 weapons | the game | by revision |
| [`UPGx`](#upgx) | `UPGS` for Brood War: the same tables for 61 upgrades, with one unused byte after the first | the game | by revision |
| [`TECx`](#tecx) | `TECS` for Brood War: the same tables, for 44 abilities | the game | by revision |
| [`CRGB`](#crgb) | StarCraft: Remastered's player colours | the game |  |
<!-- /generated -->

## Revisions

The [`VER`](#ver) value is the file's revision, and it decides which sections the game
reads. [`TYPE`](#type) goes with it.

<!-- generated: revisions -->
| Revision | `VER` | `TYPE` | Extension |
| --- | --- | --- | --- |
| StarCraft 1.00 | 59 | `RAWS` | `.scm` |
| Hybrid 1.04 | 63 | `RAWS` | `.scm` |
| Brood War 1.04 | 205 | `RAWB` | `.scx` |
| Remastered 1.21+ | 206 | `RAWB` | `.scx` |
<!-- /generated -->

Brood War added units, upgrades and technologies, so it has wider versions of the five
settings tables, under new names: [`UNIS`](#unis) and [`UNIx`](#unix),
[`UPGS`](#upgs) and [`UPGx`](#upgx), [`UPGR`](#upgr) and [`PUPx`](#pupx),
[`TECS`](#tecs) and [`TECx`](#tecx), [`PTEC`](#ptec) and [`PTEx`](#ptex). A StarCraft 1.00
file needs the original five, a Brood War file the `x` five, and a hybrid file both, so the
original game reads one set and Brood War the other. Blizzard's own Brood War maps carry
only the `x` tables.

## TYPE

Which game the file is for. It goes with [`VER`](#ver): see [Revisions](#revisions).

<!-- generated: section TYPE -->
| Name | `TYPE` (54 59 50 45) |
| --- | --- |
| Size | 4 bytes. |
| Read by | The game. |
| Required | No. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | 4 characters | `RAWS` for a StarCraft file, `RAWB` for Brood War |
<!-- /generated -->

## VER

The file's revision, which decides which sections the game reads. The values are in
[Revisions](#revisions).

<!-- generated: section VER -->
| Name | `VER␠` (56 45 52 20) |
| --- | --- |
| Size | 2 bytes. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u16 | The revision; see [Revisions](#revisions) |
<!-- /generated -->

## IVER

A version stamp older versions of StarEdit wrote. Nothing reads it. StarEdit leaves it out
of the maps it writes now, and so does a new map made in the editor.

<!-- generated: section IVER -->
| Name | `IVER` (49 56 45 52) |
| --- | --- |
| Size | 2 bytes. |
| Read by | Editors only. The game skips it. |
| Required | No. |
| More than one copy | Only the last copy counts. |
| In scmJS | Kept as it is and written back unchanged. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u16 | StarEdit's version number, an older form |
<!-- /generated -->

## IVE2

StarEdit's version stamp. The game does not read it.

<!-- generated: section IVE2 -->
| Name | `IVE2` (49 56 45 32) |
| --- | --- |
| Size | 2 bytes. |
| Read by | Editors only. The game skips it. |
| Required | No. |
| More than one copy | Only the last copy counts. |
| In scmJS | Kept as it is and written back unchanged. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u16 | StarEdit's version number; 11 in a map StarEdit saves for Brood War |
<!-- /generated -->

## VCOD

A verification table the game checks the file against when it loads a map, and refuses the
map when the check fails. Every map StarEdit writes carries the same 1040 bytes, and a new
map made in the editor gets them too.

<!-- generated: section VCOD -->
| Name | `VCOD` (56 43 4F 44) |
| --- | --- |
| Size | 1040 bytes. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Only the last copy counts. |
| In scmJS | Kept as it is and written back unchanged. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u32 × 256 | Seeds |
| 1024 | u8 × 16 | Operations |
<!-- /generated -->

## IOWN

StarEdit's own copy of [`OWNR`](#ownr). The game reads `OWNR`; StarEdit shows this one. The
editor writes both the same, and Check Map warns when a file's two disagree.

<!-- generated: section IOWN -->
| Name | `IOWN` (49 4F 57 4E) |
| --- | --- |
| Size | 12 bytes. |
| Read by | Editors only. The game skips it. |
| Required | No. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 12 | StarEdit's copy of each player's [type](#ownr), one byte per player slot, Player 1 first |
<!-- /generated -->

## OWNR

Who controls each of the 12 player slots: a human, a computer, a rescuable player, a
neutral one, or nobody. Players 9 to 12 are normally Neutral or Inactive.

<!-- generated: section OWNR -->
| Name | `OWNR` (4F 57 4E 52) |
| --- | --- |
| Size | 12 bytes. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 12 | Each player's type, one byte per player slot, Player 1 first |

| Value | Type |
| --- | --- |
| 0 | Inactive — the slot does not exist |
| 1 | Computer (game) — set by the game once it starts; rarely stored |
| 2 | Occupied — set by the game for a joined human; rarely stored |
| 3 | Rescuable — units join whoever reaches them |
| 4 | Computer (unused) |
| 5 | Computer — aI-controlled |
| 6 | Human — open slot in the lobby |
| 7 | Neutral — owned by no one; players 9–12 are usually this |
| 8 | Closed — lobby slot closed |
| 9 | Observer |
<!-- /generated -->

## ERA

The tileset. Only the low three bits count; the rest are ignored.

<!-- generated: section ERA -->
| Name | `ERA␠` (45 52 41 20) |
| --- | --- |
| Size | 2 bytes. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u16 | The tileset. The game uses the low three bits |

| Value | Tileset |
| --- | --- |
| 0 | Badlands |
| 1 | Space Platform |
| 2 | Installation |
| 3 | Ashworld |
| 4 | Jungle World |
| 5 | Desert |
| 6 | Ice |
| 7 | Twilight |
<!-- /generated -->

## DIM

The map's size in tiles. The sizes of [`MTXM`](#mtxm), [`TILE`](#tile), [`MASK`](#mask)
and [`ISOM`](#isom) follow from it. StarEdit offers sides of 64, 96, 128, 192 and 256
tiles.

<!-- generated: section DIM -->
| Name | `DIM␠` (44 49 4D 20) |
| --- | --- |
| Size | 4 bytes. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u16 | Width in tiles |
| 2 | u16 | Height in tiles |
<!-- /generated -->

## SIDE

Each player's race.

In a Use Map Settings game, a player whose race is User Selectable gets the melee starting
units of the race they pick, and the units the map places for them are left out. A map that
places units for a player should give that player a race. (This was found playing
StarCraft: Remastered.)

<!-- generated: section SIDE -->
| Name | `SIDE` (53 49 44 45) |
| --- | --- |
| Size | 12 bytes. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 12 | Each player's race, one byte per player slot, Player 1 first |

| Value | Race |
| --- | --- |
| 0 | Zerg |
| 1 | Terran |
| 2 | Protoss |
| 3 | Independent |
| 4 | Neutral |
| 5 | User Selectable |
| 6 | Random |
| 7 | Inactive |
<!-- /generated -->

## MTXM

The terrain the game draws: one 16-bit tile number per tile, including the tiles of placed
doodads. A tile number is a tile group of the tileset times 16 plus the tile's place in the
group, 0 to 15.

<!-- generated: section MTXM -->
| Name | `MTXM` (4D 54 58 4D) |
| --- | --- |
| Size | 2 bytes per tile: width × height × 2. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Every copy is written over the start of the same fixed-size space, in file order, so a later copy replaces only as many bytes as it carries. |
| In scmJS | Read, and written again when you change what it holds. |
<!-- /generated -->

## PUNI

Which unit types each player may build. For every player and unit type there is an answer
of its own and a flag saying whether to use the default answer instead, and one default
answer per unit type.

<!-- generated: section PUNI -->
| Name | `PUNI` (50 55 4E 49) |
| --- | --- |
| Size | 5700 bytes. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 2736 | Per player, per unit type: 1 if the player can build it. Player 1's 228 bytes first |
| 2736 | u8 × 228 | Per unit type: 1 if it can be built, for every player that uses the default |
| 2964 | u8 × 2736 | Per player, per unit type: 1 if the player uses the default |
<!-- /generated -->

## UPGR

How far each player may research each upgrade, and the level they start at, for the 46
upgrades of the original game. Laid out as [`PUNI`](#puni) is: each player's own values, the
defaults, and whether each player uses the defaults. Brood War reads [`PUPx`](#pupx)
instead.

<!-- generated: section UPGR -->
| Name | `UPGR` (55 50 47 52) |
| --- | --- |
| Size | 1748 bytes. |
| Read by | The game. |
| Required | In a StarCraft 1.00 or hybrid file (`VER` below 205). |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 552 | Per player, per upgrade: the highest level they may research. Player 1's 46 bytes first |
| 552 | u8 × 552 | Per player, per upgrade: the level they start at |
| 1104 | u8 × 46 | Per upgrade: the default highest level |
| 1150 | u8 × 46 | Per upgrade: the default starting level |
| 1196 | u8 × 552 | Per player, per upgrade: 1 if the player uses the defaults |
<!-- /generated -->

## PTEC

Whether each player may research each ability, and whether they start with it, for the
24 abilities of the original game. Brood War reads [`PTEx`](#ptex) instead.

<!-- generated: section PTEC -->
| Name | `PTEC` (50 54 45 43) |
| --- | --- |
| Size | 912 bytes. |
| Read by | The game. |
| Required | In a StarCraft 1.00 or hybrid file (`VER` below 205). |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 288 | Per player, per ability: 1 if they may research it. Player 1's 24 bytes first |
| 288 | u8 × 288 | Per player, per ability: 1 if they start with it |
| 576 | u8 × 24 | Per ability: the default for may research |
| 600 | u8 × 24 | Per ability: the default for start with |
| 624 | u8 × 288 | Per player, per ability: 1 if the player uses the defaults |
<!-- /generated -->

## UNIT

The units placed on the map, 36 bytes each. Start locations are units too, of type 214.

A unit record can set the unit's hit points, shields, energy, resources and hangar as
percentages or amounts, and states such as cloaked or burrowed. Each of these is used only
when its bit is set in the record's fields-set or special-states word, so a record can set
the hit points alone.

The units of a human player slot nobody takes are removed when the game starts; Neutral
units stay. (Found playing StarCraft: Remastered.)

<!-- generated: section UNIT -->
| Name | `UNIT` (55 4E 49 54) |
| --- | --- |
| Size | 36 bytes per unit. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Every copy counts: the records of all of them, in file order. |
| In scmJS | Read, and written again when you change what it holds. |

Each unit:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u32 | The unit's serial number, unique in the map; add-ons and nydus canals are linked by it |
| 4 | u16 | X position in pixels |
| 6 | u16 | Y position in pixels |
| 8 | u16 | Unit type |
| 10 | u16 | How the unit is linked to another (relations, below) |
| 12 | u16 | Which special states the record sets (below) |
| 14 | u16 | Which of the following fields the record sets (fields set, below) |
| 16 | u8 | Owner, 0 for Player 1 |
| 17 | u8 | Hit points, per cent of the maximum |
| 18 | u8 | Shields, per cent |
| 19 | u8 | Energy, per cent |
| 20 | u32 | Resources, for a mineral field or geyser |
| 24 | u16 | Units in the hangar: interceptors or scarabs |
| 26 | u16 | The special states themselves |
| 28 | u32 | Unused |
| 32 | u32 | Serial number of the linked unit |

Relations:

| Bit | Meaning |
| --- | --- |
| 0x0200 | Nydus link |
| 0x0400 | Add-on |

Special states:

| Bit | Meaning |
| --- | --- |
| 0x01 | Cloaked |
| 0x02 | Burrowed |
| 0x04 | In transit |
| 0x08 | Hallucinated |
| 0x10 | Invincible |

Fields set:

| Bit | Meaning |
| --- | --- |
| 0x01 | Owner |
| 0x02 | Hit points |
| 0x04 | Shields |
| 0x08 | Energy |
| 0x10 | Resources |
| 0x20 | Hangar |
| 0x40 | State |
<!-- /generated -->

## ISOM

The isometric record, which an editor's isometric brush paints with: the lattice of
terrain diamonds from which it works out the cliffs and edges between terrain types. Only editors
read it. Without it the map plays the same but an editor cannot paint it isometrically
until the record is rebuilt, which the Repair plugin can do from the tiles.

<!-- generated: section ISOM -->
| Name | `ISOM` (49 53 4F 4D) |
| --- | --- |
| Size | (width ÷ 2 + 1) × (height + 1) × 8 bytes. |
| Read by | Editors only. The game skips it. |
| Required | No. |
| More than one copy | Every copy is written over the start of the same fixed-size space, in file order, so a later copy replaces only as many bytes as it carries. |
| In scmJS | Read, and written again when you change what it holds. |
<!-- /generated -->

## TILE

The terrain with the doodads left out: what is under each doodad. Only editors read it,
to put the ground back when a doodad is removed.

<!-- generated: section TILE -->
| Name | `TILE` (54 49 4C 45) |
| --- | --- |
| Size | 2 bytes per tile: width × height × 2. |
| Read by | Editors only. The game skips it. |
| Required | No. |
| More than one copy | Every copy is written over the start of the same fixed-size space, in file order, so a later copy replaces only as many bytes as it carries. |
| In scmJS | Read, and written again when you change what it holds. |
<!-- /generated -->

## DD2

The doodads placed on the map, as objects an editor can select and remove. Only editors
read it: the game sees a doodad as its tiles in [`MTXM`](#mtxm) and its sprite in
[`THG2`](#thg2).

<!-- generated: section DD2 -->
| Name | `DD2␠` (44 44 32 20) |
| --- | --- |
| Size | 8 bytes per doodad. |
| Read by | Editors only. The game skips it. |
| Required | No. |
| More than one copy | Every copy counts: the records of all of them, in file order. |
| In scmJS | Read, and written again when you change what it holds. |

Each doodad:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u16 | Doodad number in the tileset's list of doodads |
| 2 | u16 | X of the middle of the doodad, in pixels |
| 4 | u16 | Y of the middle of the doodad, in pixels |
| 6 | u8 | Owner |
| 7 | u8 | 1 if disabled, else 0 |
<!-- /generated -->

## THG2

Sprites placed on the map. A *pure* sprite (flag 0x1000) is a picture drawn where it stands:
a tree top, a glow, a doodad's overlay. Without that flag the record is a unit sprite, and
the game creates a unit of that type when the map loads; that is how StarEdit places the
Installation's doors and traps. Flag 0x8000 starts such a unit disabled.

<!-- generated: section THG2 -->
| Name | `THG2` (54 48 47 32) |
| --- | --- |
| Size | 10 bytes per sprite. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Every copy counts: the records of all of them, in file order. |
| In scmJS | Read, and written again when you change what it holds. |

Each sprite:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u16 | Sprite number, or the unit type for a unit sprite (see the flags) |
| 2 | u16 | X in pixels |
| 4 | u16 | Y in pixels |
| 6 | u8 | Owner |
| 7 | u8 | Unused |
| 8 | u16 | Flags (below) |

Flags:

| Bit | Meaning |
| --- | --- |
| 0x1000 | Pure sprite |
| 0x4000 | Flipped |
| 0x8000 | Disabled |
<!-- /generated -->

## MASK

Fog of war at the start: which players begin with each tile unexplored. A new map made in
StarEdit or the editor starts every tile unexplored for every player. A map with no `MASK`
plays fully fogged.

<!-- generated: section MASK -->
| Name | `MASK` (4D 41 53 4B) |
| --- | --- |
| Size | 1 byte per tile: width × height. |
| Read by | The game. |
| Required | No. |
| More than one copy | Every copy is written over the start of the same fixed-size space, in file order, so a later copy replaces only as many bytes as it carries. |
| In scmJS | Read, and written again when you change what it holds. |
<!-- /generated -->

## STR

The string table. Every piece of text in the map is here, and other sections refer to it by
number: the scenario name and description, force names, location names, custom unit names,
switch names, sound file names, and the text and sounds of trigger actions.

The section starts with the number of strings, then one offset per string, counted from the
start of the section, and then the text. Each string ends with a 0 byte. String numbers
count from 1: the first offset is string 1. Several strings may share the same offset.
Because the offsets are 16-bit, the whole table must fit in 64 KB.

The table does not say how its bytes spell characters.
[Map files](file-formats.md#what-the-editor-does-with-it) covers how StarEdit, the game and
the editor handle that.

<!-- generated: section STR -->
| Name | `STR␠` (53 54 52 20) |
| --- | --- |
| Size | Whatever the text needs. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |
<!-- /generated -->

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u16 | How many strings there are |
| 2 | u16 × that many | Where each string starts, counted from the start of the section |
| after the offsets | text | The strings, each ending in a 0 byte |

## STRx

The string table of StarCraft: Remastered: the same as [`STR`](#str) with 32-bit numbers,
so the table has no 64 KB limit. Only Remastered reads it, as UTF-8. A map with `STRx`
does not need `STR`.

<!-- generated: section STRx -->
| Name | `STRx` (53 54 52 78) |
| --- | --- |
| Size | Whatever the text needs. |
| Read by | The game. |
| Required | In place of `STR ` on a Remastered map that uses it. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |
<!-- /generated -->

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u32 | How many strings there are |
| 4 | u32 × that many | Where each string starts, counted from the start of the section |
| after the offsets | text | The strings, each ending in a 0 byte |

## UPRP

The 64 unit properties slots used by the
[Create Unit with Properties](triggers.md#create-unit-with-properties) action. A slot is
laid out as a [`UNIT`](#unit) record's properties are, and each field or state is only
applied when its bit is set, so a slot can set the hit points alone.

<!-- generated: section UPRP -->
| Name | `UPRP` (55 50 52 50) |
| --- | --- |
| Size | 1280 bytes: 64 slots of 20. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Each slot:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u16 | Which special states the slot sets (below) |
| 2 | u16 | Which fields the slot sets (below) |
| 4 | u8 | Owner; unused |
| 5 | u8 | Hit points, per cent |
| 6 | u8 | Shields, per cent |
| 7 | u8 | Energy, per cent |
| 8 | u32 | Resources |
| 12 | u16 | Units in the hangar |
| 14 | u16 | The special states themselves |
| 16 | u32 | Unused |

Special states:

| Bit | Meaning |
| --- | --- |
| 0x01 | Cloaked |
| 0x02 | Burrowed |
| 0x04 | In transit |
| 0x08 | Hallucinated |
| 0x10 | Invincible |

Fields set:

| Bit | Meaning |
| --- | --- |
| 0x01 | Owner |
| 0x02 | Hit points |
| 0x04 | Shields |
| 0x08 | Energy |
| 0x10 | Resources |
| 0x20 | Hangar |
<!-- /generated -->

## UPUS

Which of the 64 [`UPRP`](#uprp) slots StarEdit considers in use. The game does not read it.

<!-- generated: section UPUS -->
| Name | `UPUS` (55 50 55 53) |
| --- | --- |
| Size | 64 bytes. |
| Read by | Editors only. The game skips it. |
| Required | No. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 64 | Per slot: 1 if StarEdit considers it in use |
<!-- /generated -->

## MRGN

The locations. A StarCraft 1.00 map has 64 slots and a Brood War map 255. Slot 64 is
*Anywhere*, the whole map. An unused slot has no name and no size.

The elevation word works the other way round from how StarEdit shows it: a set bit
**leaves out** that elevation, so 0 means the location covers every elevation. Conditions
such as [Bring](triggers.md#bring) only count units on the elevations the location
covers.

<!-- generated: section MRGN -->
| Name | `MRGN` (4D 52 47 4E) |
| --- | --- |
| Size | 20 bytes per location. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Every copy is written over the start of the same fixed-size space, in file order, so a later copy replaces only as many bytes as it carries. |
| In scmJS | Read, and written again when you change what it holds. |

Each location:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | i32 | Left edge, in pixels |
| 4 | i32 | Top edge |
| 8 | i32 | Right edge |
| 12 | i32 | Bottom edge |
| 16 | u16 | Name, a string number |
| 18 | u16 | Elevations the location leaves out (below) |

Elevations:

| Bit | Meaning |
| --- | --- |
| 0x01 | Low ground |
| 0x02 | Medium ground |
| 0x04 | High ground |
| 0x08 | Low air |
| 0x10 | Medium air |
| 0x20 | High air |
<!-- /generated -->

## TRIG

The triggers, 2400 bytes each, in the order they run. The record is laid out in the
[trigger reference](triggers.md#the-trigger-record), which also has a page for every
condition and action.

<!-- generated: section TRIG -->
| Name | `TRIG` (54 52 49 47) |
| --- | --- |
| Size | 2400 bytes per trigger. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Every copy counts: the records of all of them, in file order. |
| In scmJS | Read, and written again when you change what it holds. |

Each trigger:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 2400 | One trigger; see [the trigger record](triggers.md#the-trigger-record) |
<!-- /generated -->

## MBRF

The mission briefings, in the same 2400-byte record as a trigger, with their own set of
[actions](triggers.md#mission-briefing-actions).

<!-- generated: section MBRF -->
| Name | `MBRF` (4D 42 52 46) |
| --- | --- |
| Size | 2400 bytes per briefing. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Every copy counts: the records of all of them, in file order. |
| In scmJS | Read, and written again when you change what it holds. |

Each briefing:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 2400 | One briefing, in the same record as a trigger |
<!-- /generated -->

## SPRP

The scenario's name and description, as string numbers.

<!-- generated: section SPRP -->
| Name | `SPRP` (53 50 52 50) |
| --- | --- |
| Size | 4 bytes. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u16 | The scenario's name, a string number |
| 2 | u16 | Its description, a string number |
<!-- /generated -->

## FORC

The four forces: which force each of Players 1 to 8 is in, each force's name, and its
settings. Players 9 to 12 are in no force.

<!-- generated: section FORC -->
| Name | `FORC` (46 4F 52 43) |
| --- | --- |
| Size | 20 bytes. |
| Read by | The game. |
| Required | Yes. The game does not load a map without it. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 8 | The force of each of Players 1 to 8, 0 to 3 |
| 8 | u16 × 4 | The name of each force, a string number |
| 16 | u8 × 4 | Each force's flags (below) |

Force flags:

| Bit | Meaning |
| --- | --- |
| 0x01 | Random start |
| 0x02 | Allied |
| 0x04 | Allied victory |
| 0x08 | Shared vision |
<!-- /generated -->

## WAV

StarEdit's list of the sounds in the map: the name of each sound file in the archive, as a
string number. The game does not read it. A Play WAV or Transmission action stores the
string number of its sound itself, not a place in this list.

<!-- generated: section WAV -->
| Name | `WAV␠` (57 41 56 20) |
| --- | --- |
| Size | 2048 bytes. |
| Read by | Editors only. The game skips it. |
| Required | No. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u32 × 512 | The name of each sound, a string number; 0 for an empty slot |
<!-- /generated -->

## UNIS

Unit settings for the original game. For each unit type that does not use the game's own
values: hit points, shields, armour, build time, costs, name and weapon damage. Brood War
reads [`UNIx`](#unix) instead.

<!-- generated: section UNIS -->
| Name | `UNIS` (55 4E 49 53) |
| --- | --- |
| Size | 4048 bytes. |
| Read by | The game. |
| Required | In a StarCraft 1.00 or hybrid file (`VER` below 205). |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 228 | Per unit type: 1 to use the game's own values and ignore the rest of this section |
| 228 | u32 × 228 | Hit points × 256 |
| 1140 | u16 × 228 | Shields |
| 1596 | u8 × 228 | Armour |
| 1824 | u16 × 228 | Build time, in game frames |
| 2280 | u16 × 228 | Mineral cost |
| 2736 | u16 × 228 | Gas cost |
| 3192 | u16 × 228 | Name, a string number; 0 for the default name |
| 3648 | u16 × 100 | Per weapon: base damage |
| 3848 | u16 × 100 | Per weapon: damage added by each upgrade level |
<!-- /generated -->

## UPGS

Upgrade costs and research times for the 46 upgrades of the original game. Each upgrade has
a cost for its first level and an amount added for each level after. Brood War reads
[`UPGx`](#upgx) instead.

<!-- generated: section UPGS -->
| Name | `UPGS` (55 50 47 53) |
| --- | --- |
| Size | 598 bytes. |
| Read by | The game. |
| Required | In a StarCraft 1.00 or hybrid file (`VER` below 205). |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 46 | Per upgrade: 1 to use the game's own values |
| 46 | u16 × 46 | Mineral cost of the first level |
| 138 | u16 × 46 | Minerals added for each further level |
| 230 | u16 × 46 | Gas cost of the first level |
| 322 | u16 × 46 | Gas added for each further level |
| 414 | u16 × 46 | Research time of the first level, in game frames |
| 506 | u16 × 46 | Time added for each further level |
<!-- /generated -->

## TECS

Ability costs, research times and energy costs for the 24 abilities of the original game.
Brood War reads [`TECx`](#tecx) instead.

<!-- generated: section TECS -->
| Name | `TECS` (54 45 43 53) |
| --- | --- |
| Size | 216 bytes. |
| Read by | The game. |
| Required | In a StarCraft 1.00 or hybrid file (`VER` below 205). |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 24 | Per ability: 1 to use the game's own values |
| 24 | u16 × 24 | Mineral cost |
| 72 | u16 × 24 | Gas cost |
| 120 | u16 × 24 | Research time, in game frames |
| 168 | u16 × 24 | Energy cost |
<!-- /generated -->

## SWNM

The names of the 256 switches, as string numbers. The game does not read it; triggers use
the switches' numbers.

<!-- generated: section SWNM -->
| Name | `SWNM` (53 57 4E 4D) |
| --- | --- |
| Size | 1024 bytes. |
| Read by | Editors only. The game skips it. |
| Required | No. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u32 × 256 | The name of each switch, a string number; 0 for none |
<!-- /generated -->

## COLR

The colour of each of Players 1 to 8. StarCraft: Remastered can override it with
[`CRGB`](#crgb).

<!-- generated: section COLR -->
| Name | `COLR` (43 4F 4C 52) |
| --- | --- |
| Size | 8 bytes. |
| Read by | The game. |
| Required | No. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 8 | The colour of each of Players 1 to 8 |

| Value | Colour |
| --- | --- |
| 0 | Red |
| 1 | Blue |
| 2 | Teal |
| 3 | Purple |
| 4 | Orange |
| 5 | Brown |
| 6 | White |
| 7 | Yellow |
| 8 | Green |
| 9 | Pale Yellow |
| 10 | Tan |
| 11 | Dark Aqua |
| 12 | Pale Green |
| 13 | Bluish Grey |
| 14 | Pale Yellow II |
| 15 | Cyan |
| 16 | Pink |
| 17 | Olive |
| 18 | Lime |
| 19 | Navy |
| 20 | Dark Green |
| 21 | Black |
<!-- /generated -->

## PUPx

[`UPGR`](#upgr) for Brood War: the same tables, for 61 upgrades.

<!-- generated: section PUPx -->
| Name | `PUPx` (50 55 50 78) |
| --- | --- |
| Size | 2318 bytes. |
| Read by | The game. |
| Required | In a hybrid or Brood War file (`VER` 63 and up). |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 732 | Per player, per upgrade: the highest level they may research. Player 1's 61 bytes first |
| 732 | u8 × 732 | Per player, per upgrade: the level they start at |
| 1464 | u8 × 61 | Per upgrade: the default highest level |
| 1525 | u8 × 61 | Per upgrade: the default starting level |
| 1586 | u8 × 732 | Per player, per upgrade: 1 if the player uses the defaults |
<!-- /generated -->

## PTEx

[`PTEC`](#ptec) for Brood War: the same tables, for 44 abilities.

<!-- generated: section PTEx -->
| Name | `PTEx` (50 54 45 78) |
| --- | --- |
| Size | 1672 bytes. |
| Read by | The game. |
| Required | In a hybrid or Brood War file (`VER` 63 and up). |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 528 | Per player, per ability: 1 if they may research it. Player 1's 44 bytes first |
| 528 | u8 × 528 | Per player, per ability: 1 if they start with it |
| 1056 | u8 × 44 | Per ability: the default for may research |
| 1100 | u8 × 44 | Per ability: the default for start with |
| 1144 | u8 × 528 | Per player, per ability: 1 if the player uses the defaults |
<!-- /generated -->

## UNIx

[`UNIS`](#unis) for Brood War: the same tables, with 130 weapons.

<!-- generated: section UNIx -->
| Name | `UNIx` (55 4E 49 78) |
| --- | --- |
| Size | 4168 bytes. |
| Read by | The game. |
| Required | In a hybrid or Brood War file (`VER` 63 and up). |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 228 | Per unit type: 1 to use the game's own values and ignore the rest of this section |
| 228 | u32 × 228 | Hit points × 256 |
| 1140 | u16 × 228 | Shields |
| 1596 | u8 × 228 | Armour |
| 1824 | u16 × 228 | Build time, in game frames |
| 2280 | u16 × 228 | Mineral cost |
| 2736 | u16 × 228 | Gas cost |
| 3192 | u16 × 228 | Name, a string number; 0 for the default name |
| 3648 | u16 × 130 | Per weapon: base damage |
| 3908 | u16 × 130 | Per weapon: damage added by each upgrade level |
<!-- /generated -->

## UPGx

[`UPGS`](#upgs) for Brood War: the same tables for 61 upgrades, with one unused byte after
the first.

<!-- generated: section UPGx -->
| Name | `UPGx` (55 50 47 78) |
| --- | --- |
| Size | 794 bytes. |
| Read by | The game. |
| Required | In a hybrid or Brood War file (`VER` 63 and up). |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 61 | Per upgrade: 1 to use the game's own values |
| 61 | u8 | Unused |
| 62 | u16 × 61 | Mineral cost of the first level |
| 184 | u16 × 61 | Minerals added for each further level |
| 306 | u16 × 61 | Gas cost of the first level |
| 428 | u16 × 61 | Gas added for each further level |
| 550 | u16 × 61 | Research time of the first level, in game frames |
| 672 | u16 × 61 | Time added for each further level |
<!-- /generated -->

## TECx

[`TECS`](#tecs) for Brood War: the same tables, for 44 abilities.

<!-- generated: section TECx -->
| Name | `TECx` (54 45 43 78) |
| --- | --- |
| Size | 396 bytes. |
| Read by | The game. |
| Required | In a hybrid or Brood War file (`VER` 63 and up). |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 44 | Per ability: 1 to use the game's own values |
| 44 | u16 × 44 | Mineral cost |
| 132 | u16 × 44 | Gas cost |
| 220 | u16 × 44 | Research time, in game frames |
| 308 | u16 × 44 | Energy cost |
<!-- /generated -->

## CRGB

StarCraft: Remastered's player colours. For each of Players 1 to 8, how its colour is
chosen, and a colour of its own. The RGB value is used only when the mode is Custom; with
Palette the game uses the [`COLR`](#colr) colour, which is also what every older version
reads.

<!-- generated: section CRGB -->
| Name | `CRGB` (43 52 47 42) |
| --- | --- |
| Size | 32 bytes. |
| Read by | The game. |
| Required | No. |
| More than one copy | Only the last copy counts. |
| In scmJS | Read, and written again when you change what it holds. |

Layout:

| Offset | Type | Holds |
| --- | --- | --- |
| 0 | u8 × 24 | Red, green and blue for each of Players 1 to 8, three bytes each |
| 24 | u8 × 8 | How each player's colour is chosen (modes, below) |

Colour modes:

| Value | Meaning |
| --- | --- |
| 0 | Random |
| 1 | Player choice |
| 2 | Custom |
| 3 | Palette |
<!-- /generated -->

## In the source

| What | Where |
| --- | --- |
| Reading and writing the run of sections, repeats and odd lengths | `src/formats/chk/reader.ts` |
| Each section's size, repeat rule and whether the game reads it | `src/formats/chk/sections/registry.ts` |
| The codecs, and the flag values in the tables here | `src/formats/chk/sections/*.ts` |
| Required sections, and what a new map is made of | `src/formats/chk/create.ts` |
| The revisions and the order sections are written in | `src/formats/chk/scenario.ts` |
| The byte layouts and the generated blocks of this page | `scripts/lib/chk-reference.mjs`, written by `npm run docs:reference` |
