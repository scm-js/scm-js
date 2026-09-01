# Game data

A map file stores tile *indices* and unit *type ids*. The pixels live in StarCraft's
own archives, which are Blizzard data, not covered by this project's MIT license and
not redistributable. None of them are in this repository. A clone generates them from
an installation you are entitled to use.

Attribution is not permission: see
[ATTRIBUTION.md](../ATTRIBUTION.md#starcraft-and-brood-war-data) before publishing a
fork or a hosted build.

## Extracting

```sh
npm run extract                                              # auto-detect
npm run extract -- --from "/mnt/c/Program Files (x86)/StarCraft"
npm run extract -- path/to/StarDat.mpq path/to/BrooDat.mpq
SCM_DATA_DIR=~/games/sc npm run extract
```

With no arguments the script looks for `StarDat.mpq` and `BrooDat.mpq` (and
`patch_rt.mpq`, which wins over both) in `$SCM_DATA_DIR`, then in `fixtures/data/`,
then in the usual install locations, including the Windows drives a WSL session sees
under `/mnt`.

Brood War's archive is required. Its `units.dat` is the layout the decoder expects,
and the Ice, Desert and Twilight tilesets only exist there.

Everything lands in `public/` ([inventory](../public/README.md)), which is gitignored.
The run takes a few seconds and is idempotent, so re-run it after a patch or after
changing what the scripts extract.

| Command | Does |
| --- | --- |
| `npm run extract` | everything |
| `npm run extract:tilesets` | tileset graphics only |
| `npm run extract:units` | unit tables, sprites and scripts only |
| `npm run check:assets` | report what is on disk, touching no archives |

`npm run dev` and `npm run build` warn when the data is missing but do not fail. The
app degrades instead of crashing: flat tileset colours instead of terrain, coloured
markers instead of unit sprites, with a note in the relevant palette. A green test
run and a working dev server therefore do not prove extraction still works. Run it.

`scripts/extract-assets.mjs` is the front end; archive discovery lives in
`scripts/lib/archives.mjs`.

## Tileset graphics

`public/tileset/<name>.{cv5,vf4,vr4,vx4,wpe}` is what the app fetches on demand and
rasterises into one megatile atlas per tileset (`src/formats/tileset/`).

```
MTXM tile id ──(id >> 4)──▶ CV5 group ──(id & 15)──▶ VX4 megatile
VX4 megatile ──▶ 16 minitile refs (bit 0 = h-flip) ──▶ VR4 8×8 bitmaps ──▶ WPE palette
```

`load.ts` fetches and caches per tileset, `decode.ts` parses the five files,
`atlas.ts` rasterises the atlas the viewport blits from, `terrain.ts` derives the
terrain-type catalogue and its variations from the CV5, and `palette.ts` holds the
terrain names (from Chkdraft's tables, checked against real files in
`tests/palette.test.ts`).

### Water animation

The graphics are 8-bit indexed, and StarCraft animates water and lava by rotating a
few short bands of the WPE palette every 8 game frames, about 336 ms on Fastest. The
band tables per tileset are the game's own; Space Platform and Installation have
none.

The atlas keeps a second small canvas holding just the megatiles that touch those
bands, and `setAtlasStep` re-rasterises it on each step. Always blit through
`atlasSource(atlas, megatile)` rather than indexing `atlas.image` directly. Averages
used by the minimap and far zoom stay at step 0.

## Unit graphics

`npm run extract:units` mirrors the part of the MPQ tree that leads from a unit type
to its picture:

| Files | For |
| --- | --- |
| `arr/{units,flingy,sprites,images}.dat`, `arr/images.tbl` | the lookup chain |
| `arr/{weapons,upgrades,techdata}.dat` | defaults the settings dialogs show |
| `game/tunit.pcx` | team colour rows |
| `scripts/iscript.bin` | animation bytecode |
| `unit/**/*.grp`, `unit/**/*.lo?` | sprite sheets and overlay positions |

```
units.dat[id].flingy ─▶ flingy.dat.sprite ─▶ sprites.dat.image ─▶ images.dat.grp
   ─▶ images.tbl ─▶ unit\…\*.grp
GRP palette indices 8–15 ─▶ tunit.pcx row for the player's colour ─▶ tileset WPE palette
images.dat.iscript ─▶ iscript.bin header ─▶ Init / Built / StarEditInit ─▶ frames, overlays, turns
```

The GRP walk is seeded from the 228 unit types *and* all 517 `sprites.dat` entries, so
pure sprites and doodad overlays have graphics too. That is about 750 GRPs and 12 MB
in the current manifest. GRPs and overlay files are fetched lazily the first time
they are needed, so a melee map only pulls minerals, geysers and start locations.

Team colour comes from the `tunit.pcx` row for the player's colour, remapping palette
indices 8–15, painted through the *tileset* palette. Sprites therefore need the
tileset loaded as well. Pink and the custom Remastered colours have no row to remap
to, so `teamColor.ts` synthesises a ramp for them.

### Animation

Placed units run their in-game idle animations (View ▸ Animate Units). The viewport
steps every unit's iscript once per game frame (42 ms, "Fastest"), the same rAF loop
that drives water cycling.

Each unit is a stack of images (shadow, main graphic, overlays), each with its own
script. Buildings play their `Built` animation; tanks and Goliaths play
`StarEditInit`, StarEdit's own hook, which adds the turret overlay. That gives
turning turrets, pulsing Hatcheries, marines looking around, the Nexus glow, Starport
lights and refinery smoke.

Damage overlays are re-evaluated from hit points: a building below two thirds burns
(Terran), sparks (Protoss) or bleeds (Zerg) at the positions its `.lo` file gives,
more of them the lower the HP, with the large effect below one third. Fire draws
through the tileset's `ofire`/`gfire`/`bfire`/`bexpl` remap tables, extracted
alongside the tileset files, blended additively as a stand-in for the game's
palette-index lookup. Cloaked units draw half transparent.

Anything that needs the running game (attacks, sounds, projectiles, condition jumps)
is a no-op. `src/formats/dat/iscript.ts` is dependency-free so the extraction script
can import it under Node's type stripping and walk the scripts for reachable images.
