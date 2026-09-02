# Development

Node.js 22.18 or newer. The unit extraction script imports TypeScript directly and
depends on Node's built-in type stripping.

```sh
npm install
npm run extract   # one-time: see docs/game-data.md
npm run dev       # http://localhost:5173
npm run build     # tsc -b (type-check) + vite build
npm run lint      # oxlint
npm test          # vitest run, node environment, ~2s
```

`npm run build` is the type-check; `npm run lint` does not type-check.
`tsconfig.app.json` sets `noUnusedLocals`, `noUnusedParameters`,
`verbatimModuleSyntax` (so `import type`) and `erasableSyntaxOnly` (so no enums and no
parameter properties).

## Tests

Tests live in `tests/*.test.ts`, and `src/**/*.test.ts` is picked up too.

```sh
npx vitest run tests/chk.test.ts     # one file
npx vitest run -t "flood fill"       # by name
npm run test:watch
```

Suites that need real map files (`fixtures/maps/*.scx`) or real tileset files
(`public/tileset/*.cv5`) use `describe.skipIf(...)` and skip in silence when those are
absent. A green run does not by itself mean the real-data suites ran. `fixtures/` and
the generated `public/{tileset,arr,game,scripts,unit}/` are gitignored, and nothing in
those trees may be committed.

## Repository layout

```
src/
  atoms/        Jotai state: editor/document atoms (incl. undo history), UI + dialog stack
  editor/       Invertible edits and placement checks for every map layer
  data/         Reference tables (tilesets, players/colours, units, upgrades, techs, trigger definitions)
  formats/
    chk/        CHK container, section registry, typed section codecs
    mpq/        .scm/.scx open + save on top of mopaq
    tileset/    cv5/vf4/vr4/vx4/wpe decoding, megatile atlas, terrain catalogue, palette
    dat/        units/flingy/sprites/images.dat, .tbl, GRP, PCX, .lo and iscript.bin decoders
    units/      Unit data, lazy GRP/.lo/remap loading, frame cache, the iscript animator
    triggers/   TrigEdit-syntax printer and parser
  script/       The TypeScript-subset trigger compiler and its simulator
  plugins/      Plugin API (the contract), host, loader, built-in registry
  services/     Map open/save pickers, PNG export, startup preload
  components/
    chrome/     MenuBar (Radix Menubar), ToolBar, StatusBar
    panels/     Left dock (layer rail + palettes), right dock (Minimap, Layers, Properties), plugin panels
    viewport/   Canvas map view with rulers, hover brush, context menu
    dialogs/    All scenario dialogs + DialogHost registry
    splash/     Splash card that fades over the editor
    ui/         Primitives: Button, inputs, Check, Group, ListBox, Tabs, Tip, DialogFrame
  styles/       tokens → base → ui → chrome → panels → viewport → dialogs → splash
plugins/        Built-in plugins (plugin.json + plugin.ts each), bundled by Vite, loaded like remote ones
```

State is all Jotai, with no context or provider layering beyond the default store.
CSS is plain, layered in that import order, with design tokens as CSS variables in
`tokens.css`.

Two deliberate sources of truth: `scenarioAtom` holds the parsed `Scenario` that gets
written to disk and is mutated in place, while the older atoms in `editorAtoms.ts`
(`mapNameAtom`, `mapWidthAtom`, …) are what the chrome displays. Change one and you
have to change the other. Because the scenario is mutated rather than replaced, React
does not see terrain edits; `terrainRevisionAtom` and its siblings are counters bumped
after every edit, and the viewport subscribes to them.

Adding a dialog means touching two places: the `DialogId` union in
`src/atoms/uiAtoms.ts` and the `REGISTRY` in
`src/components/dialogs/DialogHost.tsx`.

`CLAUDE.md` goes into more detail on each subsystem than this file does.

## Dev deep-links

Query params jump straight to a UI state, which is the fastest way to iterate on a
screen. See `src/hooks/useDevDeepLinks.ts`.

```
/?nosplash                       skip the splash
/?nosplash&layer=units           select a layer (terrain|doodads|units|sprites|locations|fog|clipboard)
/?nosplash&dialog=playerSettings open a dialog (any DialogId; repeatable)
/?nosplash&zoom=0.5&tileset=ice  zoom level and tileset
/?nosplash&mode=tile             terrain palette mode (isom|rect|tile)
/?nosplash&layer=fog&fogPlayer=3 view and paint one player's fog
```

## Startup

`src/services/preload.ts` runs an ordered list of tasks that actually await the work
the editor needs to be warm: the startup tileset, the unit tables, the GRPs a blank
map draws, then the startup document. The splash shows real progress and leaves when
the tasks are done. Do not add a task that is not awaiting something, because the
bar reaching the end is the promise that the editor is ready.

Every task is best-effort. A failure is logged as "unavailable" and stepped over,
since missing game data is a normal state everywhere else.

`src/devReactTracks.ts` disables React 19's dev-only Components performance track,
which serialises props for every render and turned mounting the chrome into about
seven seconds of blocked main thread. Set `VITE_REACT_TRACKS=1` to keep it when you
want to profile renders. Production builds never had the problem.

## Where things are documented

| Topic | File |
| --- | --- |
| What the editor does, for map makers | [../README.md](../README.md) |
| CHK and MPQ handling, section coverage | [file-formats.md](file-formats.md) |
| Extracting and using Blizzard data | [game-data.md](game-data.md) |
| The trigger scripting language | [trigger-script.md](trigger-script.md) |
| Writing and installing plugins, the plugin API | [plugins.md](plugins.md) |
| Per-subsystem implementation notes | [../CLAUDE.md](../CLAUDE.md) |
| Provenance of adapted code and data | [../ATTRIBUTION.md](../ATTRIBUTION.md) |
