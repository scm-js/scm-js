# The desktop build, releases and in-app updates

`desktop/main.ts` (Electron, bundled by `desktop/vite.config.ts` into `desktop/dist/*.cjs`, `ssr: true` +
`noExternal` so mopaq and the shared extraction ride along, `publicDir: false`) serves `dist/` under
`app://scmjs/` and the game-data prefixes from `userData/gamedata` first, so the renderer's bundled probe
finds an extraction (which is also why `usePreload` skips `warmRemainingTilesets` on the desktop —
the bytes are on local disk already); the window's size, position and maximized state are remembered in
`userData/window.json` (`readWindowState` / `watchWindowState`, saved 500 ms after the last move or
resize and again on close; an off-screen position is dropped, and a first run with no file opens
maximized) and it is shown on `ready-to-show`, so nothing flashes at the unmaximized size, with
`dist/icon.png` as its icon; a close while the renderer says the map has unsaved changes is held
back and handed to the editor (`guardClose` / `closeIpc`, `src/hooks/useCloseGuard.ts`), with
`before-quit` remembering that the close came from a quit so the answer quits rather than closing
one window; the search order is AppImage dir /
next to the executable / userData / env / the platform's install paths (so two archives dropped beside
the app are found). `preload.ts` is
the bridge, typed in `src/gamedata/desktop.ts`; `tsconfig.desktop.json` type-checks it.

`app://scmjs` being an **origin** is the thing that catches people out. A plugin's `fetch` carries it,
so a server whose CORS allowance lists the web origins alone answers the desktop build and the
renderer discards every reply — indistinguishable, from inside a plugin, from the server being
down (it is why the scmjs.dev plugin could not connect from the desktop until `ai-server`'s
`server.allowedOrigins` and its `/v1/auth/start` `returnOrigin` check learned the scheme). The
window-open handler sends anything with an address out to `shell.openExternal` and allows exactly
one kind of window: a **blank named** popup, `window.open("", name)`, which is how a plugin runs an
OAuth sign-in — a browser tab is nobody's `window.opener`, so the callback page would have nothing
to post the session back to. Electron may hand a child window its parent's preload, so the bridge
is not left to that: the window's `additionalArguments` carry `--scmjs-origin=` (the `app://` origin,
or `SCMJS_DEV_URL`'s in dev) and `preload.ts` exposes `window.scmjsDesktop` only when
`location.origin` matches it. The popup is created with none of those arguments and goes on to a
remote origin besides, so it fails that test twice over, and `did-create-window` denies it windows
of its own. Keep it that way — the bridge spawns the game, reads folders and installs updates.

`electron-builder.yml`
packages `dist/` + `desktop/dist/` only (never `node_modules`, never `dist/{tileset,arr,unit,game,scripts}`),
unsigned, with `public/icon.png` as every platform's icon, `electronLanguages: [en-US]` (the 55
Chromium locales were 50 MB unpacked and 12 MB of the zip; the editor has no translations) and
`spellcheck: false` in the window's `webPreferences`; Windows gets an NSIS installer and a **zip**,
never electron-builder's `portable` target, whose SFX re-extracts the whole app into `%TEMP%` on every
launch and can only cover the wait with a static `.bmp` painted over the desktop (`docs/development.md`) — that file, `public/favicon.svg` and
`components/ui/AppLogo.tsx` are one drawing: the splash's wireframe globe (`splash/starfield.ts`) projected
once at a fixed angle and flattened to four paths grouped by depth, in violet rather than the splash's
pink. `scripts/lib/docs/assets/logo.svg` and `scm-js/site`'s copy are the same paths without the
rounded square, and `public/icon-oauth.svg` is the one variant that is *not* a straight copy: an OAuth
consent screen draws the app's icon at around 32 px inside its own circular mask, where the two faintest
lattice tiers become noise and the rest disappears, so that file is full bleed, drops them and thickens
what is left. `icon-512.png` (Discord's app icon) and `icon-120.png` (Google's branding logo, which
must be exactly that size, under 1 MB and opaque) are rendered from it with sharp and committed, since
nothing in a build reads them — they are uploads to those two consoles, and Google re-runs brand
verification when the logo changes, so settle it before submitting. Battle.net's consent page shows no
icon. Re-render both if the drawing changes. `npm run build:desktop` is `scripts/build-desktop.mjs`: `build --mode desktop` (the mode no longer changes anything —
it used to blank the game-data address) + the main bundle + electron-builder, where its arguments pick the packaging
step's platform, architecture and targets (`-- win nsis`, `-- linux AppImage arm64`, `-- --dir`
for an unpacked check, `--skip-web` / `--skip-main` to reuse the bundles on disk, `--` for
electron-builder verbatim); with no arguments it is this OS on `electron-builder.yml`'s targets, which
is what CI runs. The workflow has three channels — `ci` (every push to main: lint, tests and the web
bundle built and thrown away, so a broken bundle fails the push that broke it; **nothing deployed,
no installers and no release**), `nightly` (a daily cron, skipped when main has not moved: the
installers on ONE rolling prerelease whose `nightly` tag is force-moved and whose assets are
replaced with `gh release upload --clobber`, never deleted and recreated) and `v*` tags (permanent
numbered releases, the only ones that accumulate).
**Both hosted builds are releases**: the `pages` job serves the *tag* at `editor.scmjs.dev` (it was
main's HEAD, which was the one artifact whose version nobody could get back to), and the
`nightly-site` job unpacks the nightly's own web zip — never a second build — onto
`nightly.editor.scmjs.dev` as one force-pushed orphan commit on `scm-js/nightly`'s `gh-pages` branch,
carrying the `CNAME` a branch-served Pages site keeps its domain in. Rolling the site back is
dispatching build.yml on an older tag. They are separate origins deliberately: OPFS and every
`scmjs.` key are per origin, so the nightly asks for the game data again and keeps its own
preferences, plugins and recents rather than writing a stored shape the stable build reads back.
Repository variables `PAGES_BASE` (`/` for a custom domain; when it is not `/` the `web` job builds
a second time for Pages) and `NIGHTLY_DOMAIN`, secret `NIGHTLY_PAT` (Contents: write on
`<owner>/nightly`, the `PLUGIN_API_PAT` shape); the nightly deploy skips with a notice without them.
A `v*` tag also pushes the **container image**: the `image` job downloads the `web` job's own zip,
unzips it and builds `docker/Dockerfile` (nginx + `docker/nginx.conf`, no `RUN` step, so
`linux/amd64,linux/arm64` is one buildx manifest and needs no QEMU) to `ghcr.io/<repo>` as `latest`,
the version and the moving `X.Y` / `X`; nightlies publish none, since `latest` is what a `docker run`
takes without asking. `.dockerignore` cuts `dist/{tileset,arr,unit,game,scripts}` out of the context
and the nginx config 404s those paths, so no image can carry Blizzard's data and a container starts at
step 4 of the resolver — mounting an extracted tree over them is how to serve your own.
`npm run build:image` is the local build, and `release.yml` builds and *serves* the image in its
pre-flight, before it tags.
The download buttons on the site are plain hrefs to
`/releases/latest/download/<asset>`, which GitHub redirects to the newest **non-prerelease**
release — so the nightly is invisible to them and nothing needs updating when a version ships;
that redirect resolves a fixed file name, which is why `electron-builder.yml`'s `artifactName`
carries no version (`scmJS-windows-x64-setup.exe`, `scmJS-linux-x86_64.AppImage`, …). Its
`publish:` block is what makes electron-builder write `latest*.yml` beside the installers and
bake `app-update.yml` into the asar — the feed the in-app updater reads; `--publish never` still
means it uploads nothing itself. The version is
`package.json`'s and nothing hardcodes it: `vite.config.ts` defines `__APP_VERSION__`,
`src/version.ts` is what the splash and the About dialog read, CI `npm version`s the field
from the tag (or `<package.json version>-nightly.<date>.<run number>` on main — the run number,
not the SHA, because semver compares alphanumeric identifiers lexically) before building, and
electron-builder writes it into `latest*.yml`. A release is cut by the **Release** workflow
(`.github/workflows/release.yml`, manual dispatch), never by hand: it refuses to run off main,
over an existing tag, or backwards past the last release, runs lint/tests/build *before*
writing anything, then commits the release version (the whole diff is `"version"` in
package.json and the lock; skipped when it already says it) and annotates `vX.Y.Z` on that
commit. It then **dispatches** build.yml on the tag — one dispatch is the whole release, hosted
editor included — because a push made with `GITHUB_TOKEN` starts no workflow run while
`workflow_dispatch` through the API is the exception. A tagged release's notes are `docs/releases/<version>.md` — committed on main
beforehand, read by build.yml's release job out of the tag's own tree (the full three-part
version names it, so cutting `0.3` reads `0.3.0.md`) — or the Release form's `notes` input,
which wins over the file and is passed on as a build.yml dispatch input, so it lives only in
the release; either goes above GitHub's `--generate-notes` list, and with neither the release
carries that list alone. Nothing is required: the pre-flight prints what it found (a dry run
shows the release's body) and says so as a notice when there is nothing.

There is deliberately **no** step moving package.json on to the next version:
`scripts/next-version.mjs` derives what a nightly is called from the release tags instead — a
patch bump of the newest one (`tests/next-version.test.ts`; no tags means nothing has shipped,
so package.json stands; a prerelease tag answers with its release version). A nightly must
sort above the release it follows, or the updater offers a downgrade it cannot install, and
below the release that comes next, or it offers nothing until that version ships; a patch bump
is the only choice that can never be too high, so nothing has to be decided in advance about
whether the next release is 0.9.0 or 1.0.0. That leaves package.json meaning the **last
released version**, which is true without anyone maintaining it.

### In-app updates (`desktop/updater.ts`, `src/editor/updates.ts`)

Desktop only. `desktop/updater.ts` is `electron-updater` over the releases the workflow publishes
(required lazily — Rollup keeps it behind a memoised factory — since `main.ts` is on the critical
path to the first frame); `editor/updates.ts` is the pure state machine and every string shown
(`stateFrom`, `headline`, `canDownload`, `shouldCheckOnStart`, `tests/updates.test.ts`);
`atoms/updateAtoms.ts` holds one answer for the whole app; `hooks/useUpdateCheck.ts` is the startup
check and the single subscription to the updater's progress/downloaded/error events;
`UpdateDialog.tsx` is Help ▸ Check for Updates…. `Preferences.updates` is `{ checkOnStart, nightly }`,
the row shown only when `isDesktop()`.

Finding an update raises a **toast**, not a dialog — the check lands seconds after launch and two
dialogs already open themselves then (Game Data, the Repair plugin), so a third would queue behind
them. `Toast.action` (the one button a toast may carry) opens the same dialog the Help item does, and
the toast has no `ttl` so it waits rather than expiring behind the splash. `autoDownload` is false
and installing goes through `guardedAction(store, …, "quit")` — the window close button's gate —
before `quitAndInstall`.

`UpdateSupport` keeps *checking* and *installing* apart, and both answers come from the updater
rather than from `process.platform`: `support.check` is `isUpdaterActive()`, because `AppImageUpdater`
(chosen for any Linux build with no `package-type` file) refuses when `APPIMAGE` is unset and then
`checkForUpdates()` resolves **null** instead of throwing — reading that as "up to date" is the lie
`check()` maps to `unsupported`. `support.install` is false only on macOS (Squirrel.Mac verifies the
code signature; unsigned cannot apply an update), where the dialog offers the release page instead of
a progress bar. `message()` trims electron-updater's errors, which otherwise carry the whole HTTP
response — headers and `Set-Cookie` — into the dialog.
