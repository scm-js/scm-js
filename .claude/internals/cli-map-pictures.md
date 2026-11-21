# Pictures and layouts: `map preview`, `map diff --picture`, `map generate`, `map analyze`

The map commands that need the game's graphics or tile tables, read from the person's copy (`gamefiles.ts`), but not
the engine. `map heatmap` draws on the same pieces but needs the engine (`cli-game.md`).

## The person's copy of the game (`gamefiles.ts`)

- `openGameFiles(named)` → `GameFiles { read(member) }` over kascade (Remastered) or mopaq (1.16.1: StarDat, BrooDat,
  patch_rt by name in any case, a later archive wins); `readTileset` (`.vx4ex` first, else `.vx4`); `readUnitsDat`
  (null on failure → each unit one tile); `readSpeedTables` for `analyze`. `findGameCopy` (engine.ts) finds the folder
  (`cli-game.md`); a named folder that is no copy, or no copy at all, is exit 2.
- **A 1.16.1 copy's names are taken in any case**: `gameCopyKind` lists the folder once and matches `StarDat.mpq` /
  `BrooDat.mpq` case-insensitively (`existsSync` of the exact name is case-sensitive on Linux and missed a copy with
  other capitals). scm-sim's runners follow the same rule, so a lower-case copy plays only with an engine from after
  that change.
- **Nothing is cached on disk**: opening the Remastered copy is ~0.2 s through `/mnt/c`, a tileset's files ~50 ms,
  drawing a 128 × 128 map and encoding a PNG ~20 ms; a whole command is about half a second. A real 1.16.1 copy reads
  its archives whole (`readFileSync`; StarDat is tens of MB) — not measured, there was none to hand.
- **Plain ground** (`preview.ts#plainShade`, `GameGraphics.tileset: Tileset | null`): with no copy found and none
  named, `map diff --picture` draws each tile a grey by its tile group (id >> 4, hashed into 80–119, blue +10; id 0
  black as the editor's null tile) instead of refusing; `copy: null` in the JSON, a dim line in the terminal, "drawn
  without the game" under a PNG. A named `--starcraft` that is not a copy is still refused. Made for CI runners, which
  have no game (the GitHub Action's pictures). Real terrain reads as fine noise; `preview`, `heatmap` and `share`'s
  picture still need the copy.

## `map preview` (`preview.ts`, `paint.ts`, `png.ts`)

- **Split so other callers reuse it**: `preview.ts`'s top half is pure — `terrainPicture(scn, tileset, scale)` → RGBA,
  `resizePicture` (separable area average, fractional spans), `placeMarks(scn, unitsDat, factor, w, h)` → `Mark[]`,
  `drawMarks`, `mapPicture(...)` / `previewPng(...)` → `{png, picture, marks, counts}`. `paint.ts` is the terminal
  (pure string functions of a picture + marks); `png.ts` the encoder (RGB colour type 2 unless `alpha`, filter 0,
  one IDAT from `deflateSync`, table CRC-32). `map share`, `replay share`, `map diff --picture`, `heatmap`, `analyze`
  and the MCP `map_preview` all use these. `previewMap(input, map, o, term, stdout)` is the command; `term`
  (`terminalInfo()`: columns, depth truecolor/256/none, unicode, inline protocol) is a parameter so tests set it.
- **Terrain**: each megatile is drawn once at 32 px into a scratch buffer and averaged to `scale × scale`, cached by
  megatile id, then copied per tile (the editor's `FLAT_PX` mean colour is the scale-1 case). An id with no megatile
  (`megatileForTile` −1) is black as the editor draws it. PNG scales are 1–32 powers of two; the terminal draws at the
  next one up from its pixels a tile and reduces.
- **Marks** follow `mapImage.ts`'s minimap dots: units.dat placement box × factor, `max(1, round)`, centred with
  `round(c − w/2)` (= `floor(c)` for a one-pixel dot), clamped inside; order resources → buildings → units (bigger
  first) → start locations on top. Minerals `#5fd7ff`, geysers `#3ddc84`. A start location's box is framed with a 30%
  tint inside when ≥ 4 px each way, solid below; in the terminal its number sits in the cell holding the box's middle.
- **Terminal**: width = `--width`, else `--scale × mapW`, else `min(columns − 1, 2 × mapW, (columns − 1) × mapW /
  mapH)` — the last keeps a tall map within half the columns in rows. `▀` with fg = upper pixel, bg = lower; codes only
  when they change; an odd last row has bg 49. 256 colours: the nearer of the 6×6×6 cube (xterm's steps) and the 24
  greys. **ASCII** (no colour, or `unicode` false): shades ` .:-=+*%@` stretched between the picture's 2nd and 98th
  luma percentile (absolute luma made a jungle map all dots), `#`/`o`/`$` marks, start digits. kitty
  (`KITTY_WINDOW_ID`, `TERM=xterm-kitty`) / iTerm2 (`TERM_PROGRAM=iTerm.app`) on a TTY, not under `TMUX`/`STY`, get the
  PNG inline (kitty `f=100,a=T,q=2,c=cols` in 4096-byte base64 pieces; iTerm2 `]1337;File=inline=1;…`); `--blocks`
  refuses it. **The inline path is tested by string only** — no kitty or iTerm2 to hand.
- `--units` is a hidden twin of `--no-units` (commander keeps `units` undefined unless one is given; `!== false` is
  the test).
- **`tests/maps/*` have no terrain** (MTXM all 0 = megatile 0, black): their pictures are black ground with the marks,
  which is right; `map new` maps draw as dirt.
- **MCP `map_preview`** returns image content (`{type: "image", data: base64, mimeType: "image/png"}`) plus a line of
  facts and `structuredContent`. `scale` 1–8 (schema `max(8)` and a CliError for 3, 5, 6, 7): 8 px a tile on 256 × 256
  is 2048 px, ~1 MB of base64, as much as a model should be sent.

## `map diff --picture` (`diffpicture.ts`)

- Options on the existing command, additive: no flag = the text form. `--out` and `--side-by-side` imply `--picture`;
  `--scale/--width/--blocks/--starcraft` without it are refused (exit 2). The exit code is the comparison's (1 when
  different), picture or not.
- **Pure top half** — now `src/editor/compare.ts`, which the editor's Compare Maps draws from too (`editor-operations.md`); `diffpicture.ts` re-exports it under the names it had (`TILE`, `UnitChange`, `LocationChange`): `diffChanges(a, b)` (no graphics) → a canvas the larger map each way, a `TILE` value per canvas
  tile (same / changed id / a only / b only / neither — **compared by position**, so a resize anchored elsewhere than
  top-left shows everything changed), `unitChanges`, `locationChanges` by slot (the same function `map diff` uses, so
  the two agree), counts, `bounds.tiles` and `bounds.all`. `changePicture(a, b, graphics, …)`; `sideBySide(…)` → `a |
  changes | b`. **`changePicture` throws on two tilesets**: the command draws side by side then, and the legend leaves
  the tiles out (ids of two tilesets mean nothing to each other; `--json` still has the count).
- **Units**: `map diff`'s multiset (`unitKey`, the record minus `serial`), then each removed unit paired with the
  nearest added one of the same type and owner within `MOVE_RADIUS` (4 tiles), nearest pairs first: distance 0 =
  changed in place, else moved. So the legend's `+n −n` are smaller than the text diff's, which counts a move as both.
- **Drawing**: terrain of b (a's terrain for tiles only a has), unchanged tiles darkened, changed tinted magenta,
  one-side tiles striped, padding where neither. **Landmarks are grey** (start locations, minerals, geysers of b's
  kept units): preview's green geysers and red/green slot frames read as added/removed. Locations as outlines (a moved
  one red where it was, yellow where it is); **Anywhere is never drawn**, though counted, since it changes with every
  resize. Units as filled boxes **at least two tiles** (`CHANGE_MIN`: at one tile a marine was a 4 px dot on a 512 px
  PNG); a moved unit also gets its old box's frame and a line between the boxes.
- **Terminal**: half blocks as preview; ASCII gets an **overlay** (`paint.ts#asciiShades`'s `overlay` map, applied
  last) with letters `A R M x / #`, none of them a shade. `--side-by-side` in the terminal: three panels when each gets
  ≥ `MIN_PANEL` (32) columns, i.e. from ~101 columns; else the change picture alone and a dim line saying so.

## A map from a seed: `map generate` (`generate.ts`, `generatecmd.ts`, `bases.ts`)

`scmjs map generate <out> [--players 2|3|4|6|8] [--size] [--tileset] [--seed] [--symmetry] [--style] [--rush] …`
(hidden: `--tilesets <folder>` laid out like `public/tileset`, for the tests; `--engine` for `--rush`). The MCP tool
`map_generate` is `runGenerate` + `printGenerated` without `rush` or `tilesets`.

- **Needs the game's files, by design.** `paintIsom` resolves every rect to a tile through `isomTables(tileset)`, whose
  shape-link table is *built from the CV5* (`buildLinks`) — only the numbering/adjacency is in `data/isomTables.ts` —
  and the ramps are doodads whose placement rule is `dddata.bin`. There is no game-data-free mode.
- **Three pure steps.** `planMap(options, innerSeed)` → `Plan` (a `Lattice`: class LOW/HIGH/WATER per diamond, `locked`
  low ground for bases and aprons, `deco`, `complex` = the players' template footprint; the complexes; free bases;
  `images` = for every group element, which complex each lands on). `buildScenario` = `layGround` (flat fill of the
  recipe's low terrain, then **one `paintIsomDiamonds` stroke per terrain**: water, high, low deco, high deco; then the
  ramps) + `placeBases` (halls, Melee Wizard lines, start locations, slots n..7 Inactive). `measureMap` = `walkGrid`
  (VF4 walkable minitiles eroded 3 × 3 so a corridor is a unit wide, resource footprints cut out) + `groundFrom`
  (Dial's algorithm, 5/7 steps) per start + `validateScenario(scn, { tileset })` + `spread`. `generateMap` tries
  `innerSeed(seed, k)` for k < 12 (k = 0 is the seed itself), keeps the first within `BALANCE_TOLERANCE` (8%), else the
  least spread that passes; none passing → `LayoutError`, exit 1. Over a sweep of every tileset with a recipe, player
  count, symmetry, size and style, every option set laid out and the median spread was a few percent; the worst cases
  are two-player `mirror-y` on Ice.
- **`paintIsomDiamonds`** (`editor/isom.ts`) is `paintIsom` with a footprint of any shape: every listed diamond set at
  once, their neighbours queued, one `propagate`, one `updateTiles`. Painting a terrain in one stroke makes the result
  independent of diamond order; diamond by diamond would ripple each time.
- **Ramps only face south.** Every ramp doodad in every tileset fits only the south-west or south-east cliff edge
  (found by scanning `checkDoodadPlacement` round a painted plateau). So a complex can never be turned upside down, and
  **the symmetry acts on positions, not on the bases**: `makeTemplate` builds one complex (an isometric-rectangle core
  plus lobes, the ramp on the core's SE edge, an apron, the natural's disc down-right of the ramp, a low lane between)
  for a natural to the right, and each player's copy is that template x-flipped when it lies left of centre. **What the
  symmetry places is the ramp's foot** (`Template.foot`): the layout is drawn as fundamental naturals, converted to the
  fundamental foot, snapped to the lattice *before* mapping (so mirrors are exact), and imaged. Every walk out of a main
  is main → ramp → foot → …, so with the feet exact the start-to-start walks match to a percent or two. (Imaging the
  naturals instead let a bottom player's walk cut the corner past its natural, and spreads ran 10–60%.) A bottom
  player's main stands above its ramp, toward the centre — odd-looking but forced — and between its ramp and anything
  up the map's side, so free-base candidates keep off the sides.
- **`rotational` with 4 or 8 players is the four-way mirror**: a quarter turn would put a natural on a side where its
  main has no room, and rot90/diagonal do not map the 2:1 diamond lattice to itself. `diagonal` exists for two players
  on a square map; obstacles under it are rasterised approximately.
- **Ramp candidates: the first run of ids first.** Remastered files cliff pieces with the VF4 ramp bit (2 × 5 … 8 × 5
  pieces) that `checkDoodadPlacement` takes at a ramp's place. Nearest-first picked them, and some do not walk at all;
  a 2 × 5 piece passed our own walk check and `map rush` still found no way out of a main in the game. So each fit within
  7 tiles is kept only when `walksBetween(top of plateau, apron)` holds in a 24-tile window, and candidates are ordered
  **first run of sorted ids first** (cut at a gap > 20: the ramps every version has), Remastered pieces only when none
  of those fits — which also makes Remastered and 1.16.1 pick the same ramps. The candidates are the `ramp` doodads
  requiring a group of the recipe's `cliff` edge set; Ice's ramp 0 also requires another index and still fits a plain
  cliff, so the filter is "needs the cliff", not "needs only the cliff". Generated maps walked with `map rush` reach
  every start from every other; on the largest 8-player layout the game's pathing gave up once on the longest walk.
- **What the brush cannot join** (found as black tile-0 rects by the `holes` check): two bodies of one class whose tips
  face each other across one diamond — across an edge (dx ± 1, dy ± 1) or edge-to-corner, e.g. (0, −2) and (1, +1).
  `squeezed()` fills a diamond with two same-class neighbours more than 120° apart **on the lattice** (u = (dx+dy)/2,
  v = (dx−dy)/2; in tile space the angles are wrong). `settle` applies it to HIGH and WATER and to each level's deco,
  plus spur removal (< 2 same edge-neighbours), water ≥ 4 steps from high and ≥ 3 from a base, deco only with 3 steps
  of its own level all round. With those, `checkIsom(...).mismatched` is 0 and no tile is 0 on every layout swept.
  (`terrain.md` keeps the brush's side of this.)
- **Recipes** (`RECIPES`, CV5 indices) per tileset family; ashworld's shale is **unbuildable** (`decoBuilds: false`
  keeps it out of the mains). **Installation has no recipe**: no terrain group in its CV5 is buildable, so it has no
  melee; refused, exit 2. **Levels' heights are read off the tileset** (`megatileHeight` of the terrain's first
  megatile): Jungle's High Dirt is the middle level, Platform's High Platform the top, so a hard-coded height was
  wrong.
- **Resources** are the Melee Wizard's `layoutBase` (copied into `bases.ts`; the plugin is not in the bundle) with `fits`
  = every tile buildable, all walkable, no ramp minitile, the hall's height, clear of other footprints and ≥ 3 from a
  ramp. Main 9 × 1500 + 5000 gas, line away from the ramp; natural 7; free bases 6. A hall needs its level one tile all
  round. Free-base candidates are fixed fractions of the map, imaged; images within 8 tiles are one base (a point on an
  axis), images closer than 30 drop the candidate.
- **Balance numbers**: `startSpread` = for every element of the symmetry and every pair of starts whose images are
  starts, the relative difference of their ground distances (always 0 for two players: the one pair is its own image);
  `freeSpread` = each start's sorted walks to the free bases against its image's; `spread` = the larger. The walk to
  the middle is reported but **not compared**: with a mesa or lake on the centre, "the nearest walkable minitile to the
  centre" depends on the side you come from. With three players the fourth complex has no start and its pairs are
  skipped. Checked against the game with `map rush`: own walks within a few percent of the game's.
- **Determinism**: no `Math.random` below `generateOptions` (which picks a seed when none is given and prints it). The
  same seed and options give the same bytes with the same game files (tested with `public/tileset`). Remastered and
  1.16.1 should lay the same tiles where their CV5s agree (the shared groups are identical), but that was not compared
  byte for byte. `--players` is not read from the output's name: `"(4)Test.scx"` alone makes two players.

## A melee map's layout: `map analyze` (`analyze.ts`, `walk.ts`)

Starts, mains, naturals, every pair's ground and air distance, the narrowest points, terrain shares and verdicts,
**without the engine**: the tileset, units.dat and speed tables from the copy, pure TypeScript after that (tens of
milliseconds; the copy's open is most of a run). MCP `map_analyze` is read-only; `picture` adds the PNG as image
content. `--out` (hidden old name `--picture`) writes the picture.

- **Grid: minitiles (8 px), octile.** `walk.ts` is the Walkability plugin's pieces copied with attribution (EDT
  clearance by Felzenszwalb–Huttenlocher, `passageWidth`, Dial's algorithm 5/7 with no corner cutting) plus `pathTo`,
  `distancesWithin` (a bounded walk into a Map), `withoutSpecks`, `narrowestOn`. Tile resolution was rejected: VF4
  walkability is per minitile, and ramps and doodad feet are a few minitiles.
- **Unit size**: a cell is walked when its clearance > 1 (`UNIT_RADIUS`, the plugin's Small default; `generate.ts`'s
  3 × 3 erosion is the Chebyshev version). Radii 0, 1.5 and 2 were tried against the game; none was closer enough to
  depart from the plugin's default.
- **Blockers**: every unit or unit-sprite (THG2 without the PureSprite bit) whose units.dat flags say building and not
  flyer, by its collision extents (+1) — resources, neutral and player buildings, doors and traps; without units.dat
  only fields and geysers (bases.ts sizes). Start locations do not block (no town hall is placed, unlike the rush's
  Nexus).
- **Narrow = `passageWidth`** (the shortest of four wall-to-wall lines through the cell) along the shortest path, ends
  (3 tiles) left out, on a wall grid where closed patches standing alone under 16 tiles in area are opened
  (`ROCK_TILES`). Measuring only specks under one tile named false chokes between a cliff and a rock, and between a
  base's field line and its geyser; opening every standalone patch < 16 tiles fixes both while a cliff, a field line
  touching it, or a building still counts. The widest-route bottleneck (the plugin's maximin) is not used: the
  question is the narrowest point on the shortest walk.
- **Bases**: resources within `BASE_LINK` 12 tiles are one base when the walk between them (radius-0 grid) is ≤
  straight + 6 tiles; fields < 100 minerals are walls; a base needs a geyser or ≥ 3 fields. (Tighter rules split bases
  whose hall stands between two field groups and left a far geyser as its own base.) **Main** = every base whose middle
  is within 12 tiles of its nearest start (`balance.ts#mainResources`, reused) — "only the nearest base is the main"
  gave maps with mains in two groups a natural 5 tiles away. **Natural** = the nearest non-main base by ground to its
  hall spot (the cell nearest the resources' middle with clearance ≥ 6 cells). On maps whose mains have no base near on
  foot it is 50–90 tiles away: the honest answer, not a bug.
- **Way out** (`wayOut`) = the narrowest point on start → natural; a pair's narrowest within 4 tiles of one is labelled
  `wayOutOf`. **Seconds** = px / `walkSpeed` × 0.042 for Zergling, Marine, Zealot (`units.md` for `walkSpeed`; needs
  units/flingy/sprites/images.dat + iscript.bin, else tiles only and the text says so).
- **Verdicts** (`verdictsOf`, thresholds exported): pairs ≤ `FAIR_WITHIN` 8% (generate's tolerance); with ≥ 3 starts
  the rank comparison (`rankSpread`) decides, since a square of four has near and far pairs by design; naturals ≥ 5
  tiles from the median (two starts: the larger against the smaller, `apartFrom` — a median of two flagged both); no
  gas where others have it; a shared natural; way out ±1 tile; a pair's narrowest < 2 tiles; raised (mid + high) ground
  ±15 points within 12 tiles ("high" alone was 0% on every generated map, Jungle's High Dirt being the middle level).
- **Against the game** (`map rush`, Zergling, across Blizzard and generated maps): the command's centre-to-centre
  figure is within a mean 2.5% of the game's walk (max ~8%), slightly long on average; the gap is the game's
  region-to-region pathing (longer than octile-optimal, most on open diagonals) and acceleration and turning —
  documented, not corrected. `map generate`'s `measureMap` gives this command's numbers exactly (the same metric).

## Open

- No start-location numbers or legend inside any PNG (there is no font); sprites/doodads overlays, fog and locations
  in `map preview`.
- `map diff --picture`: detecting a shifted resize (an anchor) to compare tiles at the offset; sprites and doodads;
  an MCP image for `map_diff` (the pure functions are ready: `changePicture` + `encodePng`).
- `map generate`: trees, rocks and doodads besides ramps; a third level; bridges; neutral buildings and critters;
  back-door paths and island bases; a choice of where the natural sits (wall-offs); 4 players on a non-square map use
  the same corners; `--revision remastered` (always Brood War 1.04); calling `analyzeLayout` in place of its own
  `measureMap` (same numbers).
- `map analyze`: a `--unit` size; speed upgrades and acceleration; chokes off the shortest walks (BWEM-style areas
  from the Walkability plugin would be the next step); the natural is "nearest base on foot", which may not be the
  base a map's designers mean.
