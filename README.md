# scm-js

A StarCraft 1 / Brood War map editor for the browser, built in homage to **StarEdit**, **SCMDraft 2** and **StarForge**.

> Status: UI skeleton. Every screen, panel and dialog is laid out and navigable, but nothing reads or writes real map data yet.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle
npm run lint
```

## Layout

```
src/
  atoms/        Jotai state: editor/document atoms, UI + dialog stack
  data/         Reference tables (tilesets, players/colours, units, upgrades, techs, trigger vocab, samples)
  components/
    chrome/     MenuBar (Radix Menubar), ToolBar, StatusBar
    panels/     Left dock (layer rail + palettes), right dock (Minimap, Layers, Properties)
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
```
