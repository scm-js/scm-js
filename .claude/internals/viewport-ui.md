# The viewport, the UI and image export

### Image export (`src/services/mapImage.ts`)

File ▸ Export ▸ Image is one dialog with one dial — `pixelsPerTile` — and `renderMapImage`
is a standalone re-implementation of the viewport's draw pass with `sx = sy = 0` over the
whole map (it deliberately shares no code with `MapViewport`, which is entangled with
scroll, layers, hover and gestures). There is no "map vs minimap" mode: the two thresholds
where the picture changes character are the viewport's own far-zoom ones — `drawsSprites`
(< 8 px/tile → `drawUnitDots`, the game's minimap dots, and sprites drop out) and `FLAT_PX`
(< 4 px/tile → `atlas.averages` instead of atlas blits) — so 1 px/tile *is* the minimap and
nothing special-cases it. Units are drawn in their *editor* pose (`getUnitSprite` /
`getImageFrame`, never `UnitAnimator`), so an export is deterministic.

`loadMapImageAssets` must run first: it ensures the tileset and the unit tables (the dots
need units.dat placement boxes too) and, when the scale draws graphics, awaits every GRP
the records need via `awaitGrps` — which lives in `formats/units/load.ts` and the startup
preload shares — so nothing lands as a marker just because a fetch had not finished.
Missing game data stays a degradation, never a failure. `ExportImageDialog`
(`dialogs/FileDialogs.tsx`) previews the same render at thumbnail scale and greys out the
ticks the chosen scale cannot honour; note it holds the preview host in state rather than a
ref, because the Radix portal mounts a commit after the dialog component and a `useRef`
read in the first effect pass is still null.

### UI

- All state is Jotai; there is no context/provider layering beyond the default store.
- Dialogs: `DialogId` union in `src/atoms/uiAtoms.ts`, a stack (`openDialogAtom`/`closeDialogAtom`),
  and a `REGISTRY` of `React.lazy` components in `src/components/dialogs/DialogHost.tsx`, one
  `import()` per dialog module (dialogs sharing a file share a chunk, each entry rendered in its own
  `Suspense`). Adding a dialog means touching both. The dialog modules must not be imported
  statically from anything on the startup path or Vite folds them back into the main chunk (Vite
  says so: `INEFFECTIVE_DYNAMIC_IMPORT`) — which is why `PluginIconView` lives in `components/ui/`,
  not in `PluginDialogs.tsx`. Splitting them took the main chunk from 1140 KB to 537 KB.
- `MapViewport.tsx` is a single canvas that draws terrain (atlas or fallback colours), overlays
  (grid, locations, start locations, brush ghost) and handles all mouse input for the active layer.
  The terrain blits go into a cached layer canvas (`TerrainLayer`, `terrainLayerRef`) that `draw`
  copies with one `drawImage`: it is redrawn whole when the scroll, size, zoom, tiles, revisions,
  tileset or document change, and only its cycling tiles when the water step moves, so a unit
  animation frame or a hover ghost no longer re-blits every visible megatile. Anything that changes
  what is under the ground must already bump `terrainRevisionAtom` / `doodadsRevisionAtom` (or
  replace the scenario), which is the same contract the repaint itself relies on.
  Every repaint request — a pointer move, a scroll, the `[size, draw]` effect that fires
  whenever `draw`'s identity changes — goes through `scheduleDraw()`, which books one
  `requestAnimationFrame` and coalesces the rest, so a burst of events costs one paint and it
  lands immediately before the browser's own. Call it rather than `draw()` from anything
  event- or render-driven; `draw()` itself is only run by the frame and by the animation loop
  (which serves a booked request instead of painting twice). The object layers' ghosts follow
  the pointer in pixels, so `onMove` schedules a paint on every move there — a terrain or fog
  brush is tile-shaped and only repaints on the crossings.
- `src/editor/platform.ts` is what the chrome says about the shell it is in: `isDesktop()`
  (the Electron bridge is there) and `hostTerms()`, which answers the words — "browser" /
  "app", "this browser" / "this app", "Browser" / "Application" for a heading, and where a
  download lands. The desktop build is the same bundle in a Chromium window, so every
  "this browser" in the copy read wrong there; anything user-visible that names the shell
  goes through it (Preferences ▸ storage's title, the save and export toasts, the plugin
  dialogs' warnings, the sound importer's decoder notes, About). It decides *wording* only
  — what the shell can do is still asked of `desktopBridge()` and the platform APIs.
  `tests/platform.test.ts`.
- `src/hooks/useWindowTitle.ts` keeps `document.title` on the open map — the file name when there is
  one, else the scenario name, with a leading `*` while it is modified, and the plain
  `scmJS — StarCraft Scenario Editor` of `index.html` when nothing is open. Electron mirrors the page
  title into the window title, so the desktop build's title bar and taskbar entry follow it too.
- `src/hooks/useDesktopFiles.ts` is the desktop's "Open with": `desktop/main.ts` holds the single
  instance lock, takes a map path from `argv` / `second-instance` / macOS `open-file`, and sends the
  bytes on `file:open` once the renderer's `files.onOpen` listener says `file:ready`; the hook opens
  them through `guardedAction` like a drop. What sends it one is `fileAssociations` in
  `electron-builder.yml` (`.scm` / `.scx` / `.chk`, one mime type each — electron-builder writes a
  `<mime-type>` block per association into the Linux packages' mime XML and shared-mime-info reads
  only the first of a repeated type): the NSIS installer registers `"$appExe \"%1\""` per extension
  and unregisters on uninstall, the deb / AppImage carry the mime XML and a `MimeType=` desktop entry
  whose `Exec` ends in `%U`, and the macOS bundle gets the `CFBundleDocumentTypes` without which
  Finder routes nothing and `open-file` can never fire. The Windows *zip* registers nothing, as any
  unpacked build does not — dragging a map onto `scmJS.exe` still goes through `argv`.
- Dropping a map on the window is `App.tsx`'s `onDrop`, and the same file has a **document-level**
  pair of listeners behind it, because two things render outside `.app`: the splash and every dialog
  (Radix portals them to the body). A drop that reaches no handler is navigation — the window loads
  the file and the app is gone — so the document cancels `dragover` (without which no drop event
  fires at all) and cancels every drop, opening the file only when nothing already claimed it
  (`defaultPrevented`; React's own listeners, on the root container and on each portal container,
  run first). `desktop/main.ts`'s `will-navigate` is the backstop: anything that is not the app's
  own origin is refused, and an `http(s)` one goes out to the browser like `setWindowOpenHandler`'s.
- `src/hooks/useCloseGuard.ts` is leaving the editor altogether with unsaved changes, gated on
  the same `confirmClose` preference and the same three facts as `needsCloseConfirm`. A browser
  gets `beforeunload` (added and removed with the unsaved state, so a clean document keeps the
  page's back/forward cache) and prints its own generic question — the page cannot word it, show
  a dialog or save first. The desktop build does the real thing: `desktop/main.ts#guardClose`
  holds the window's close back while `window.scmjsDesktop.window` says the map is dirty, asks
  the renderer, and the hook opens the ordinary Close Scenario dialog with a `"quit"`
  `PendingAction` — so Save writes through the same path as File ▸ Save — then answers with
  `respondClose`. A dismissal reaches it as false through `guardedAction`
  (`useMapFileActions.ts`, the gate `document.open` / `document.create` share). Electron fires
  `beforeunload` on a window close too but a value returned there cancels it *silently*, which
  is why the browser half is skipped whenever the bridge is there.
- Hotkeys are centralised in `src/hooks/useHotkeys.ts`; file actions (open/save/new, drag-drop) in
  `src/hooks/useMapFileActions.ts` and `src/services/mapIo.ts` (File System Access API with
  `<input>`/download fallbacks).
- CSS is plain, layered in import order `tokens → base → ui → chrome → panels → viewport → dialogs → splash`
  under `src/styles/`; design tokens are CSS variables in `tokens.css`.
