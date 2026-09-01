# scm-js

A StarCraft 1 / Brood War map editor for the browser, built in homage to **StarEdit**, **SCMDraft 2** and **StarForge**.

> Status: reads, renders and writes real maps. Opening a `.scm`/`.scx` parses its
> `scenario.chk`, draws the terrain from the game's own tileset graphics, and saving
> writes a playable archive back out. The terrain layer's Rect and Tile brushes work,
> with undo, including StarEdit's isometric brush; the other layers are still stubs.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle
npm run lint
npm test
```

## Tileset graphics

A map file only stores tile *indices*; the pixels live in StarCraft's own archives. Put
`StarDat.mpq` and `BrooDat.mpq` in `fixtures/data/` (gitignored) and run:

```sh
node scripts/extract-tilesets.mjs
```

That writes `tileset/*.{cv5,vf4,vr4,vx4,wpe}` into `public/tileset/`, which the app
fetches on demand and rasterises into one megatile atlas per tileset. Until the files
are there the viewport falls back to flat tileset colours and says so.

Water and lava animate the way the game does it: the graphics are 8-bit indexed and
StarCraft rotates a few short bands of the palette every 8 game frames (~336 ms on Fastest; the bands per tileset
are the game's own rotator tables; Space Platform and Installation have none). The editor
keeps the megatiles that touch those bands in a small second atlas and re-rasterises it on
every step. **View ▸ Animate Water** freezes it, like the in-game option.

Round trip, for reference:

```
MTXM tile id ──(id >> 4)──▶ CV5 group ──(id & 15)──▶ VX4 megatile
VX4 megatile ──▶ 16 minitile refs (bit 0 = h-flip) ──▶ VR4 8x8 bitmaps ──▶ WPE palette
```

## Terrain layer

The Terrain palette has three modes; two of them place tiles:

| Mode | What it paints | Palette |
| --- | --- | --- |
| **Isometric** | StarEdit's diamond brush: paints a terrain and lays the cliffs and edges around it | the tileset's terrain list |
| **Rect** | flat ground of one terrain type, in left/right tile pairs with StarEdit's random variation mix (or one fixed variation) | terrain types, read off the CV5 |
| **Tile** | any single megatile — cliff pieces, doodad tiles, the lot | a raw MTXM id (decimal or `0x` hex) with group/slot spinners and a readout, over a browser of every CV5 tile group |

The Tile browser searches and filters the same set two ways: **grouped rows** label each
CV5 group and show its 16 slots, and the **grid** view drops the labels for one dense
wall of every matching tile, StarForge-style. Search takes a label substring (`dirt`,
`edge set 12`), a group or CV5 index number, or a `0x` tile id; the kind dropdown narrows
to flat terrain, cliffs and edges, doodad tiles or unlisted groups.

Click-drags paint the brush (1×1 to 7×7, `[` / `]` to resize); the viewport previews
what the brush will leave under the cursor. **Alt+click** picks the tile under the
cursor into the brush — a flat tile picks its terrain type in Rect mode, anything else
drops into Tile mode. Right-click gives **Pick** and **Fill Area** (flood fill by terrain
type in Rect mode, by exact tile otherwise). Every stroke is one undo step (Ctrl+Z /
Ctrl+Y, up to 200).

Rect and Tile painting write `MTXM` and `TILE` together and leave `ISOM` alone, which is
what SCMDraft does in its non-isometric modes: these brushes place tiles the ISOM model
has no vocabulary for. The status bar shows the tile id under the cursor and the
Properties panel breaks it down (group, slot, megatile, elevation, walkability,
buildability).

### The isometric brush

The Isometric tab is the brush StarEdit is built around. The map is overlaid with a
lattice of diamonds (4 tiles wide, 2 tall); clicking sets the diamond under the cursor —
or an N×N block of them, per the brush size — to the chosen terrain, and the change
ripples outward: a neighbour that cannot legally border the new terrain (water beside
high dirt) becomes the intermediate one, and every touched diamond is then rendered
from the tileset's own cliff and edge pieces, cliff faces stacked as tall as the tileset
draws them. A single click of a raised terrain gives a small mesa of cliff ring; a wider
brush gives flat high ground inside it. Each stroke is one undo step covering both the
tiles and the lattice.

The lattice lives in the `ISOM` section, which StarCraft itself never reads — it is the
editor's own record, and StarEdit's brush cannot work without it. Protected maps often
strip it. When a map has no `ISOM`, the Isometric tab says so and the brush is off;
**Rebuild ISOM from tiles** (also under Tools) reconstructs it from the terrain: exact for
ground that was laid down isometrically, a best guess under doodads and for hand-placed
tiles. The tab also reports when the ISOM has drifted from the tiles (after Rect/Tile
edits), since strokes near such areas will not join up until it is rebuilt.

The algorithm is a port of Chkdraft's reverse-engineering of StarEdit (MIT); the shape
tables are derived from the CV5 at load time, and only the per-tileset terrain numbering
and adjacency lists are copied in (`src/data/isomTables.ts`). `tests/isom.test.ts` checks
it against real maps: regenerating every tile from a map's own `ISOM` reproduces the
map, and rebuilding the `ISOM` from the tiles recovers the original.

Terrain-type ids are the CV5 group `index` of each flat pair, which is also what `ISOM`
stores; the names come from Chkdraft's tables and `tests/palette.test.ts` checks them
against the extracted tilesets.

## Map I/O

`.scm`/`.scx` are MPQ archives holding `staredit\scenario.chk`; bare `.chk` files open
too. Open with **File ▸ Open**, Ctrl+O, or by dropping a file anywhere on the window.

Every section is kept in file order, and sections the editor does not model are written
back byte for byte — so saving a map we only partly understand does not destroy the rest
of it. Only sections that were actually edited get re-encoded. Repeated sections keep
the game's own semantics (a later `MTXM` overwrites only its own prefix), which is what
protected maps rely on.

`scenario.chk` is written uncompressed so that older StarCraft builds can read it.

**File ▸ New**, and the map the editor opens on, build a scenario from scratch: a flat
128x128 Badlands map, laid out the way StarEdit does it — MTXM in left/right tile pairs
sharing one random dirt variation, and ISOM as the two flat quads that alternate across
the diamond grid. Saving one writes a CHK this editor reads back, but not yet a map
StarCraft will load: `VCOD` and the unit/upgrade/tech settings sections are not
generated.

Reading requires a [mopaq](https://github.com/jeany55/mopaq) with PKWARE DCL support —
StarCraft compresses nearly every file in its archives, and its own maps, with it.

## Layout

```
src/
  atoms/        Jotai state: editor/document atoms (incl. undo history), UI + dialog stack
  editor/       Terrain edit operations as invertible change lists
  data/         Reference tables (tilesets, players/colours, units, upgrades, techs, trigger vocab, samples)
  formats/
    chk/        CHK container, section registry, typed section codecs
    mpq/        .scm/.scx open + save on top of mopaq
    tileset/    cv5/vf4/vr4/vx4/wpe decoding, the megatile atlas, base terrain fills, palette catalogue
  services/     File pickers, drag-and-drop, save-to-disk
  components/
    chrome/     MenuBar (Radix Menubar), ToolBar, StatusBar
    panels/     Left dock (layer rail + palettes, TerrainPalette + TileBrowser), right dock (Minimap, Layers, Properties)
    viewport/   Canvas map view with rulers, hover brush, context menu
    dialogs/    All scenario dialogs + DialogHost registry
    splash/     Square splash card that fades over the editor
    ui/         Primitives: Button, inputs, Check, Group, ListBox, Tabs, Tip, DialogFrame
  styles/       tokens → base → ui → chrome → panels → viewport → dialogs → splash
```

## Dev deep-links

Query params jump straight to a state, handy while iterating on a screen:

```
/?nosplash                       skip the splash
/?nosplash&layer=units           select a layer (terrain|doodads|units|sprites|locations|fog|clipboard)
/?nosplash&dialog=playerSettings open a dialog (any DialogId in src/atoms/uiAtoms.ts; repeatable)
/?nosplash&zoom=0.5&tileset=ice  zoom level and tileset
/?nosplash&mode=tile             terrain palette mode (isom|rect|tile; subtile/index still map to tile)
```
