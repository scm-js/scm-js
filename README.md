# scm-js

A StarCraft 1 / Brood War map editor for the browser, built in homage to **StarEdit**, **SCMDraft 2** and **StarForge**.

> Status: reads, renders and writes real maps. Opening a `.scm`/`.scx` parses its
> `scenario.chk`, draws the terrain from the game's own tileset graphics, and saving
> writes a playable archive back out. The terrain layer's Rect, Subtile and Index
> brushes work, with undo; the isometric brush and the other layers are still stubs.

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

Round trip, for reference:

```
MTXM tile id ──(id >> 4)──▶ CV5 group ──(id & 15)──▶ VX4 megatile
VX4 megatile ──▶ 16 minitile refs (bit 0 = h-flip) ──▶ VR4 8x8 bitmaps ──▶ WPE palette
```

## Terrain layer

The Terrain palette has the four modes SCMDraft has. Three of them place tiles:

| Mode | What it paints | Palette |
| --- | --- | --- |
| **Isometric** | *(not yet)* | the tileset's terrain list |
| **Rect** | flat ground of one terrain type, in left/right tile pairs with StarEdit's random variation mix (or one fixed variation) | terrain types, read off the CV5 |
| **Subtile** | any single megatile — cliff pieces, doodad tiles, the lot | every CV5 tile group, 16 slots each, filterable by kind |
| **Index** | a raw MTXM id you type (decimal or `0x` hex) | the same browser, plus group/slot spinners and a readout |

Click-drags paint the brush (1×1 to 7×7, `[` / `]` to resize); the viewport previews
what the brush will leave under the cursor. **Alt+click** picks the tile under the
cursor into the brush — a flat tile picks its terrain type in Rect mode, anything else
drops into Subtile. Right-click gives **Pick** and **Fill Area** (flood fill by terrain
type in Rect mode, by exact tile otherwise). Every stroke is one undo step (Ctrl+Z /
Ctrl+Y, up to 200).

Painting writes `MTXM` and `TILE` together and leaves `ISOM` alone, which is what
SCMDraft does in its non-isometric modes: these brushes place tiles the ISOM model has no
vocabulary for, and the ISOM brush, once it exists, will rebuild the cells it touches.
The status bar shows the tile id under the cursor and the Properties panel breaks it
down (group, slot, megatile, elevation, walkability, buildability).

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
/?nosplash&mode=subtile          terrain palette mode (isom|rect|subtile|index)
```
