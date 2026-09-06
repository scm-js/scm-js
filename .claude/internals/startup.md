# Startup preload and the splash

### Startup preload (`src/services/preload.ts`, `src/hooks/usePreload.ts`)

The splash used to run a fixed 3.3 s script of invented log lines while the real fetches happened behind
it, so you landed in the editor on top of the viewport's own "Loading … terrain" plate and unit markers.
`runPreload` replaces that with an ordered `PreloadTask[]` that actually awaits the work — the startup
tileset (`ensureTileset`), the unit tables (`getUnitAssets`), the GRPs a blank map draws (`warmUnitGrps`),
and finally the startup document itself (injected by the hook, which subscribes to `scenarioAtom` so it
does not race `useStartupMap`). Progress lands in `preloadStepAtom` / `preloadLogAtom`; the splash shows
it and only leaves once `done`, held to `MIN_MS`/`MAX_MS` bounds. **Do not add a task that is not really
awaiting something** — the bar reaching the end is the promise that the editor is warm.

Tasks carry a `weight` (the tileset is worth ~6× the rest) and may `report(0..1)` within themselves;
`onTilesetProgress` in `formats/tileset/load.ts` is a *module-level* subscription rather than an argument
to `getTileset` because the loader shares one promise per tileset and child effects (`MapViewport` →
`useTileset`) run before the root's, so the preload is often not the caller that starts the load. Every
task is best-effort: a failure is logged as "unavailable" and stepped over, since missing game data is a
normal state everywhere else. `warmRemainingTilesets` then pulls the other seven tilesets' *bytes* into
the HTTP cache — bytes only, because an atlas is ~20 MB of pixels and decoding all eight would cost more
resident memory than the rest of the editor.

The splash canvas draws the wireframe sphere, the orbiting rings and the progress sweep through one
shared projection, so the rings genuinely pass behind and in front of the sphere. It is deliberately
off-theme (pink, scoped to `--sp-*` in `splash.css`); `tokens.css` stays the editor's gold + teal.

What paints *first* is a separate problem, and a desktop one: `desktop/main.ts` creates the window with
`show: false` and shows it on `ready-to-show`, which is the renderer's first paint — so until something
paints there is no window at all, and the whole launch reads as a hang followed by the editor appearing
at once. Two things move that frame earlier. `index.html` carries the **boot splash**: the splash card as
plain markup with its own inline styles, scoped to `#boot-splash` and owing nothing to `splash.css`
(which in `npm run dev` does not exist until the bundle runs, and would leave the markup as unstyled
text), so it paints on the HTML alone — the version line's `%APP_VERSION_SHORT%` is filled in by the
`scmjs-html-version` plugin in `vite.config.ts`, since Vite substitutes `%…%` in HTML only for env vars. It is that card in its initial state — same geometry, same "Initializing renderer" line, the
canvas simply unpainted — so the handover is invisible; change it and `splash.css` together.
`SplashScreen` removes it in a **layout** effect (`splash/bootSplash.ts`, before the frame that would
show both) and `App` removes it on the `?nosplash` path, where the real splash never mounts. And `App`
**mounts the chrome two frames late** (`chrome` state): MenuBar, ToolBar, the docks, `MapViewport` and
`DialogHost` in the first commit is well over a thousand renders, which held the first paint behind it —
now the splash paints alone and that commit lands while it is already animating. The veil carries
`.splash-veil.solid` until the chrome is there (nothing behind it to blur yet). Measured on Linux, the
window went from ~420 ms after launch to ~200 ms, and the frame it shows is the splash rather than an
empty rectangle. `showWhenReady` in `desktop/main.ts` is what shows it. The saved maximized state is applied
**there**, not at creation: on Windows `maximize()` is a `ShowWindow` call, so maximizing a
`show: false` window shows it — which used to put a black window on screen at 140 ms and
leave every signal below with nothing to do. Neither platform applies the maximize
synchronously, though, so a window that is going to be maximized is *created* at the work area
of the display it opens on (`openingBounds`) — otherwise the first composited frame was the
window at its created size in a corner, flashing to full screen a moment later — and
`keepRestoreBounds` holds the rectangle the user left behind, which `saveWindowState` writes
while the window is still maximized and the first "restore down" puts it back to. The maximize
itself lands `MAXIMIZE_AFTER_MS` after the window is up rather than as part of showing it, so
the frame the window appears with is one the renderer painted for the size it has (a maximize
in the same frame resized the renderer as the window appeared, leaving the app drawn small in
the corner until the next frame); `traceBounds` puts the geometry of each step in `startup.log`
next to a probe of the renderer's own `innerWidth`. It also does not trust `ready-to-show` alone — a hidden window is not guaranteed to be composited at all (Windows),
and waiting only for that paint meant seconds of no window and then an editor whose splash
had already run behind nothing. The signals are, in order: the paint, `dom-ready` +
`SHOW_AFTER_DOM_MS` (the boot splash is that markup, and the window's `backgroundColor` is
its backdrop), and `SHOW_LATEST_MS` regardless. The renderer stopped depending on any of it:
`SplashScreen` runs its MIN/MAX dwell from the moment the page is **visible**
(`document.visibilityState`), not from mount, since a page in a hidden window neither
animates — rAF does not run in one, which is also why `App`'s two-frame chrome deferral has
a timer behind it — nor is seen. The last launch's milestones are always written to
`<userData>/startup.log` (`%APPDATA%\scm-js` on Windows — Electron takes the folder from
`package.json`'s `name`, not electron-builder's `productName`; `SCMJS_TRACE=1` echoes them to
stdout too), which is how "it hung and then opened" is told apart from a slow exe unpack, a
virus scanner, or the launch path: a Windows build run from `\\wsl.localhost\…` takes 628 ms
to evaluate its main script and never reaches `dom-ready`, so copy `release/win-unpacked` to
`/mnt/c/…` before running it (`docs/development.md`).

`src/devReactTracks.ts` (imported first by `main.tsx`, and only there) exists because React 19's
dev-only "Components" performance track made startup unusable: it logs every component render to the
performance timeline and serialises its props, and mounting the chrome is ~1700 renders in one commit —
about **seven seconds of unbroken main thread**, during which the splash cannot paint a frame. Measured
in dev: worst long task 6978 ms → 142 ms with the track off. A production build never had the problem
(zero long tasks), so this only makes `npm run dev` behave like the built app. It works by hiding
`console.timeStamp` (part of react-dom's one-time `supportsUserTiming` check) for exactly as long as
react-dom takes to evaluate — hence "imported first", and hence the microtask that puts it back.
`VITE_REACT_TRACKS=1` keeps React's track if you want to profile renders. If startup ever feels frozen
again, measure `longtask` entries before blaming the loading code.
