# Game data

A map file stores tile *indices* and unit *type ids*. The pixels live in StarCraft's
own archives, which are Blizzard data, not covered by this project's MIT license and
not redistributable. None of them are in this repository. A clone generates them from
an installation you are entitled to use.

Attribution is not permission: see
[ATTRIBUTION.md](../ATTRIBUTION.md#starcraft-and-brood-war-data) before publishing a
fork or a hosted build.

## Where the editor gets it

Every game-data file is fetched through one resolver (`src/gamedata/source.ts`), which
settles the session's source once, in this order:

1. **Bundled**: the build's own `public/` (a clone that ran `npm run extract`, or the
   desktop app's copy, which its protocol serves under the same base). The probe is
   `tileset/manifest.json` or `unit/manifest.json` answering JSON.
2. **Stored**: a copy an earlier upload or download left in the browser's private file
   storage (`src/gamedata/store.ts`, the Origin Private File System, about 27 MB; a
   browser without it holds the files for the session).
3. **Desktop**: the desktop app searches the disk (next to the app, its data folder,
   `$SCM_DATA_DIR`, the usual install locations) and extracts from the first folder
   with the archives; the result is then step 1.
4. **None**: flat colours and markers, and Help ▸ Game Data… opens.

There used to be a fifth step between 3 and 4 — a web address, from a
`VITE_GAME_DATA_URL` build default or a preference over it, serving either an extracted
tree or the two archives. It is gone. Nothing is fetched from an address the user did not
name; when the chain runs out, the editor asks.

## Getting the files

Help ▸ Game Data… shows the current source, and when there is none, the ways to get one:

- **Download from Blizzard.** Blizzard offers the standalone StarCraft map editor as a
  free download, and it carries both archives. The two are the trimmed StarEdit
  distribution rather than the game's own, which matters only in that they are enough:
  they extract to the same files a 1.16 install does, byte for byte. Note that the
  `patch_rt.mpq` in the same package is deliberately not applied — folding it in changes
  seven tables (`units.dat`, `weapons.dat`, `upgrades.dat`, `techdata.dat`, `flingy.dat`,
  `iscript.bin`, `stat_txt.tbl`) and would diverge from every other route.

  The zip is 101 MB and only two of its 152 members are wanted, so `src/gamedata/zip.ts`
  reads the archive's own directory over HTTP `Range` requests and inflates just those two
  with `DecompressionStream("deflate-raw")` — 82 MB transferred, no zip library. It goes
  through a Cloudflare Worker
  ([scm-js/cloudflare-blizzard-forwarder](https://github.com/scm-js/cloudflare-blizzard-forwarder))
  for one reason: `download.blizzard.com` answers with a certificate for
  `*.cloudfront.net`, plain HTTP is mixed content on an HTTPS page, and no route there
  sends `Access-Control-Allow-Origin`. The worker adds the header and forwards ranges;
  it holds nothing and redistributes nothing. The desktop build uses the same address —
  its renderer is an ordinary page and enforces CORS like any other.

- **Use your own StarCraft files.** Pick `StarDat.mpq` and `BrooDat.mpq`, or the folder
  holding them; on the desktop, search the computer or point at the StarCraft folder.
  Remastered installs have neither archive, so a Remastered-only user wants the download.

Either way the extraction runs here and the result is kept, so it happens once. The dialog
also removes a copy, which puts the chain back to where it was.

The container image (`docker/Dockerfile`) carries no game data — Blizzard's files are not
redistributable, so `.dockerignore` cuts the extracted trees out of the build context and
the image's nginx answers 404 for all five of them. A container therefore starts on step 4
and asks, like the hosted build. To serve your own instead, mount an extracted tree over
the paths step 1 probes:

```sh
docker run --rm -p 8080:80 \
  -v "$PWD/public/tileset:/usr/share/nginx/html/tileset:ro" \
  -v "$PWD/public/arr:/usr/share/nginx/html/arr:ro" \
  -v "$PWD/public/unit:/usr/share/nginx/html/unit:ro" \
  -v "$PWD/public/game:/usr/share/nginx/html/game:ro" \
  -v "$PWD/public/scripts:/usr/share/nginx/html/scripts:ro" \
  ghcr.io/scm-js/scm-js:latest
```

That is a copy on your own machine served to your own browser. Publishing such an image,
or serving one from a public address, is redistributing Blizzard's data — see
[ATTRIBUTION.md](../ATTRIBUTION.md#starcraft-and-brood-war-data).

One thing follows an install. The blank map the editor opens on was laid out before there
was a tileset, and `flatTerrain` needs the CV5 to choose between a terrain's variations —
with none it takes variation 0 for every pair, which is invisible under flat colours and
becomes one megatile repeated across the whole map the moment the graphics arrive.
`relayBlankTerrain` (`src/hooks/useMapFileActions.ts`) lays that map again with the real
variations, and only that map: it does nothing once the map has been edited or came from a
file (`src/atoms/gameDataAtoms.ts#blankFillAtom` remembers which fill needs it,
`tests/blank-fill.test.ts`).

Extraction is the same code everywhere: `src/gamedata/extract.ts` is pure (a
`ReadMember` over the archives in, a map of paths to bytes out), `scripts/extract-*.mjs`
wrap it for Node, `src/gamedata/extract.worker.ts` runs it in a browser worker, and
`desktop/main.ts` runs it in the desktop app's main process.

## The game itself

Tools ▸ Test Map needs the *installed* game rather than its data: the desktop build's
main process looks in the same places the archive search does for `StarCraft.exe`
(`x86_64\` and `x86\` for Remastered, the folder itself for 1.16) and for a `Maps` folder,
writes the map into `Maps\scmJS\` and starts the executable (`open -a` on macOS, Wine on
Linux); a folder picked in the dialog is searched first and remembered in Preferences. A
browser has no such reach: Chrome and Edge write into a folder picked once through the
File System Access API, whose handle is kept in IndexedDB (`services/handleStore.ts`,
shared with Open Recent), and other browsers download the file.

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
that drives water cycling. Preferences ▸ Display scales either rate on its own
(0.25× to 4×), so a slow machine — or a preference for a calmer map — can turn one
down without turning it off.

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
