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

## Desktop build

`desktop/` is an Electron shell around the same web bundle: `main.ts` serves `dist/`
under `app://scmjs/` and answers the game-data IPC (search the disk, extract, pick a
folder), `preload.ts` exposes it as `window.scmjsDesktop` (typed in
`src/gamedata/desktop.ts`). Extracted files go to the user data directory and are served
under the same base, so the renderer finds them as bundled.

```sh
npm run build:desktop   # web build in desktop mode + main bundle + electron-builder for this OS
npm run desktop         # bundle the main process and run Electron against dist/
```

`scripts/build-desktop.mjs` is those three steps, and its arguments say what the packaging
step builds — with none it is this OS and the targets `electron-builder.yml` lists for it,
which is what CI runs:

```sh
npm run build:desktop -- win                 # Windows: nsis + zip
npm run build:desktop -- win nsis            # just the installer
npm run build:desktop -- linux AppImage x64 arm64
npm run build:desktop -- mac dmg arm64
npm run build:desktop -- --dir               # unpacked app, no installer — the fast check
npm run build:desktop -- win --skip-web      # repackage the dist/ already on disk
```

Platforms are `win` / `mac` / `linux`, architectures `x64` / `ia32` / `arm64` / `armv7l` /
`universal`, and any electron-builder target name (`nsis`, `dmg`, `zip`,
`AppImage`, `deb`, …) applies to every platform named; `--publish <mode>` and anything after
a bare `--` go to electron-builder as they are. `--skip-web` and `--skip-main` reuse the
bundles on disk when only the packaging is being changed. Cross-building is electron-builder's
business: the script warns about the combinations that need tooling the machine may not have
(a macOS installer anywhere but on a Mac, an NSIS one without wine) and runs them anyway —
`--dir` and `zip` cross-build with nothing installed.

Windows gets an NSIS installer and a **zip**, not electron-builder's `portable` target.
That target is a 7-Zip SFX, and its NSIS template (`app-builder-lib/templates/nsis/portable.nsi`)
does `RMDir /r $INSTDIR` and then re-extracts the whole app into `%TEMP%` on *every* launch —
there is no cache, whether or not `unpackDirName` is pinned — so it pays a multi-hundred-megabyte
unpack each time, before any of our code exists to say so. The one thing it offers to cover that
wait is `portable.splashImage`, a single `.bmp` handed to the NSIS BgImage plugin, which paints a
backdrop over the whole desktop; it cannot animate, and the boot splash in `index.html` cannot
help because Electron has not started. A zip is unpacked once by the user and every launch after
it is the ordinary one measured above.

`electron-builder.yml` packages `dist/` and `desktop/dist/` only — never `node_modules`
(everything is bundled by Vite) and never the game data a developer's `public/` holds.
Builds are unsigned for now.

What the download weighs is almost all Electron. The Windows zip is about 158 MB, of which the
Electron executable is 103 MB compressed and the app's own asar 5 MB (20 MB unpacked, 14 MB of it
TypeScript shipped twice: the transpile worker the plugin loader runs `.ts` plugins through,
and its main-thread fallback). `electronLanguages: [en-US]` drops Chromium's other 54 UI locales, which were 50 MB
unpacked and 12 MB of the zip; the editor has no translations, so nothing is lost. The DirectX and
Vulkan DLLs (`dxcompiler.dll`, `dxil.dll`, `vk_swiftshader.dll`; 38 MB unpacked, 15 MB zipped)
are Chromium's WebGPU and software-Vulkan back ends, which a canvas-2D editor never reaches — they
could go in an `afterPack` hook, but that needs a run on real Windows first and has not been done. The first run opens maximized (1400 × 900 is what restoring it
down gives back); after that the window comes back the size, position and maximized state it
was left at, kept in `window.json` in the user data directory and saved half a second after
the last move or resize as well as on close, so a session that ends in a crash or a kill still
remembers. A position that no longer lands on any attached screen is dropped and the platform
places the window. Closing the window (or quitting) while the open map has unsaved changes is
held back in the main process and handed to the editor, which asks with its own Close Scenario
dialog — Save goes through the ordinary File ▸ Save path (which, with a file handle from the
open or save picker, writes in place; see below); in a browser tab the same preference
arms `beforeunload`, where all the page can do is make the browser ask its own generic question
(`src/hooks/useCloseGuard.ts`). The icon comes from `public/icon.png`, the same file electron-builder
turns into the `.ico` / `.icns`. `SCMJS_DEV_URL=http://localhost:5173 npm run desktop`
points the window at the dev server.

Saving (`src/hooks/useMapFileActions.ts#saveDocument`, `src/services/mapIo.ts`) keeps the File
System Access handle a Chromium browser or Electron gives for a file — from `showOpenFilePicker`,
a drop's `getAsFileSystemHandle()` (requested inside the drop event) or `showSaveFilePicker` —
in `mapFileHandleAtom`, so Ctrl+S writes in place after one permission prompt; without a handle it
goes through the save picker, and without the API (Firefox, Safari) it downloads, and the toast
says which happened (`pushToastAtom`, `components/chrome/Toasts.tsx`). The Save dialog
(`SaveMapDialog`, `payload.copy` for Save Copy As) previews `editor/save.ts#planSave` and hands
the built bytes to `saveDocument`; `askDialog` lets a caller — Close Scenario's Save — await its
answer the way `guardedAction` awaits the close confirmation. The options confirmed there are
kept per document in `saveOptionsAtom` and reused by Ctrl+S.

## Releases

`.github/workflows/build.yml` has two channels: every push to `main` deploys the web
bundle to GitHub Pages and recreates the rolling `latest` prerelease (installers for
Windows, macOS x64/arm64, Linux AppImage/deb, and a zip of the web bundle); a pushed
`vX.Y.Z` tag makes a numbered release with the same assets and generated notes. The
version comes from the tag, or `<package.json version>-latest.<date>.<sha>` on `main`
(the workflow warns when a tag and `package.json` disagree); both jobs `npm version` it
into `package.json` before building, and `vite.config.ts` injects that as
`__APP_VERSION__` — `src/version.ts` is where the splash and the About dialog read it,
and electron-builder names the installers after it. Bumping the app's version means
editing `package.json` and nothing else. Repository
variables: `GAME_DATA_URL` (the hosted build's game-data address) and `PAGES_BASE`
(`/` for a custom domain; default is the repository name). CI has no game data, so the
real-data test suites skip there.

## Plugin typings

`npm run build:plugin-types` (`scripts/build-plugin-types.mjs`) emits the declarations a
plugin repository vendors as `plugin-api/`: `tsc -p tsconfig.plugin-api.json`, then only
what `plugins/api.d.ts` reaches through its imports is kept (the atoms and hooks the
editor's own modules touch are pruned), a tree that still names `jotai` or `react` fails
the build, and an `index.d.ts` plus a `package.json` carrying the API and editor versions
go on top. The plain types the contract shares with the chrome — `EditorLayer`,
`TerrainMode`, `ViewFlags`, `Toast` (`editor/view.ts`), `Preferences`
(`editor/preferences.ts`), `DialogId` (`components/dialogs/ids.ts`) — live outside the
atom modules for that reason. Two external names remain, `mopaq` and `typescript`,
reached through type-only imports; a plugin repository compiles with `skipLibCheck`
and needs neither installed.

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

### The first frame

The desktop shell keeps its window hidden until the renderer's first paint
(`desktop/main.ts`), so whatever paints first is how soon the app appears at all.
Two things keep that early:

- `index.html` carries a **boot splash** — the splash card as plain markup with its
  own inline styles, painting before the stylesheet arrives and long before the
  bundle evaluates. It is a copy of `styles/splash.css` in its initial state, so
  change both together; `SplashScreen` drops it in a layout effect once it has
  mounted (`splash/bootSplash.ts`), and `App` drops it on the `?nosplash` path.
- `App` **defers the chrome by two frames**. Mounting the menu bar, toolbar, docks,
  viewport and dialog host is one commit of well over a thousand renders, and doing
  it in the first commit blocked the first paint behind it. The splash paints alone,
  the chrome follows. The veil is opaque (`.splash-veil.solid`) until it is there,
  since there is nothing behind it to see through yet.

The saved **maximized state is applied when the window is shown, not when it is created**.
On Windows `maximize()` is a `ShowWindow` call: maximizing a `show: false` window shows it.
Doing it up front defeated the whole arrangement — the window appeared black at 140 ms and
stayed that way until the renderer painted, and every signal below found it visible already
and did nothing.

But neither Windows nor an X11 window manager applies that maximize synchronously, so the
first composited frame could still be the window at its created size in a corner, jumping to
full screen a moment later. A window that is going to be maximized is therefore **created at
the work area** of the display it will open on (`openingBounds`), which makes that frame the
right size and place. The rectangle the user actually left behind is no longer the window's
own idea of its restored size, so `keepRestoreBounds` holds it: it is what gets saved while
the window is still maximized, and where the first "restore down" puts the window.

The maximize is then applied `MAXIMIZE_AFTER_MS` (60 ms) *after* the window is on screen, not
as part of showing it: a maximize landing in the same frame resizes the renderer at the moment
the window appears, and what is on screen until the next frame arrives is the one painted for
the old size — the app in a small rectangle in the corner of a window that is already big.
The window is created at the size the maximize is going to give it, so the delay costs nothing
visible. `startup.log` carries the geometry of each step (`traceBounds`: created, shown,
maximized) and the renderer's own `innerWidth`/`innerHeight` a second later, which is what
tells a window that is the wrong size apart from a renderer that never got the resize.

`ready-to-show` is the frame the shell wants, but it is not a promise: a window that is
not on screen is not guaranteed to be composited, and on Windows one that never announced
a paint meant seconds of no window at all, followed by an editor whose splash had already
run, animated and dismissed itself where nobody could see it. So `showWhenReady` in
`desktop/main.ts` takes three signals — the paint, then `dom-ready` plus
`SHOW_AFTER_DOM_MS` (the boot splash is made of that markup, and the window's own
`backgroundColor` is its backdrop, so the worst case is a frame or two of flat dark), then
`SHOW_LATEST_MS` regardless.

The renderer no longer depends on any of that being quick. `SplashScreen` counts both its
minimum and maximum dwell **from the moment the page is visible**, not from mount — a page
in a hidden window neither animates (the card is a `requestAnimationFrame` loop, and those
do not run in one) nor is seen — so a launch that takes a while to put the window up still
shows the splash instead of skipping it. `App`'s two-frame chrome deferral has a timer
behind it for the same reason.

### Running the Windows build from WSL

The desktop build cross-builds from WSL, and where the packaged app is *run from* changes
the launch more than anything in the code: `\\wsl.localhost\…` is a 9p share, and Chromium
loading 380 MB of binaries and then every asset through it is minutes, not milliseconds. A
measured comparison of the same build, from the WSL filesystem and from `C:`:

| milestone | `/mnt/c/…` | `\\wsl.localhost\…` |
| --- | --- | --- |
| main script evaluated | 47 ms | 628 ms |
| window created | 142 ms | 963 ms |
| `dom-ready` | 215 ms | not within 25 s |

So copy it over first, and launch it from there:

```sh
npm run build:desktop -- win --dir          # release/win-unpacked
cp -r release/win-unpacked /mnt/c/Users/<you>/scmjs-test
SCMJS_TRACE=1 WSLENV=SCMJS_TRACE /mnt/c/Users/<you>/scmjs-test/scmJS.exe
```

`WSLENV` is what forwards an environment variable into a Windows process; `SCMJS_TRACE=1`
then echoes the trace to the terminal as well as the file. Note that the app's user data is
`%APPDATA%\scm-js` — Electron takes the folder from `package.json`'s `name`, not from
electron-builder's `productName` — which from WSL is
`/mnt/c/Users/<you>/AppData/Roaming/scm-js`.

`SCMJS_TRACE=1` writes the launch's milestones — process creation, main script, app ready,
window created, `dom-ready`, `did-finish-load`, and which signal showed the window — to
`<userData>/startup.log` (always — the file holds the last launch). "It hung for a few seconds and then opened" has several possible
causes on one machine (a virus scanner reading 380 MB of binaries, the main bundle, the
first paint) and only the timings tell them apart.

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
| The trigger scripting language | the [Trigger Script plugin](https://github.com/scm-js/plugin-trigger-script)'s README |
| Writing and installing plugins, the plugin API | [plugins.md](plugins.md) |
| Per-subsystem implementation notes | [../CLAUDE.md](../CLAUDE.md) |
| Provenance of adapted code and data | [../ATTRIBUTION.md](../ATTRIBUTION.md) |
