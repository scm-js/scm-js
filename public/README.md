# Generated game data

Everything in this directory except `favicon.svg` and this file is **extracted from a
StarCraft installation and is not checked in** — it is Blizzard game data, not scm-js
MIT-licensed content. Generate it once per clone with:

    npm run extract        # or: npm run extract -- --from "<StarCraft install dir>"

See [ATTRIBUTION.md](../ATTRIBUTION.md#starcraft-and-brood-war-data) before publishing
these files in a fork, release, or hosted build: attribution does not grant
redistribution rights.

## What lands here

    tileset/<name>.cv5     terrain groups -> megatile indices
    tileset/<name>.vx4     megatile -> 16 minitile refs   (or .vx4ex, 32-bit, Remastered)
    tileset/<name>.vr4     8x8 minitile bitmaps, palette indices
    tileset/<name>.vf4     per-minitile walkability / elevation flags
    tileset/<name>.wpe     256-colour palette
    tileset/<name>.<ofire|gfire|bfire|bexpl>.pcx   effect colour remaps
    tileset/<name>.dddata.bin                      doodad placement table
    tileset/stat_txt.tbl   doodad category names
    tileset/manifest.json  which tilesets came out complete

    arr/{units,flingy,sprites,images}.dat, arr/images.tbl   unit type -> picture
    arr/{weapons,upgrades,techdata}.dat                       defaults the settings dialogs show
    game/tunit.pcx         team-colour remap rows
    scripts/iscript.bin    animation bytecode
    unit/**/*.grp          sprite sheets reachable from units, sprites and doodads
    unit/**/*.lo?          overlay attachment points (damage fires, smoke)
    unit/manifest.json     the images/GRPs the reachability walk selected

Tileset names, in ERA order: badlands, platform, install, ashworld, jungle, desert, ice,
twilight. The last three are Brood War and only exist in `BrooDat.mpq`.

Without these files the app still runs: the viewport falls back to flat per-tileset
colours and units to player-coloured markers, and each says so. `npm run check:assets`
reports what is present.
