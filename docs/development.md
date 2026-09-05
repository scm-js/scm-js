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

`scripts/build-desktop.mjs` is those steps, and its arguments say what the packaging step
builds — with none it is this OS and the targets `electron-builder.yml` lists for it, which
is what CI runs:

```sh
npm run build:desktop -- win                 # Windows: nsis + zip
npm run build:desktop -- win nsis            # just the installer
npm run build:desktop -- linux AppImage x64 arm64
npm run build:desktop -- mac dmg arm64
npm run build:desktop -- --dir               # unpacked app, no installer — the fast check
npm run build:desktop -- win --skip-web      # repackage the dist/ already on disk
npm run build:desktop -- --skip-plugins      # leave plugins/ alone (no vendoring fetch)
```

Before the bundle it runs `scripts/vendor-plugins.mjs` — as `npm run dev` and
`npm run build` do, in their `predev` / `prebuild` hooks — which writes each default
plugin's own source, at the tag `src/plugins/defaults.ts` pins, into the gitignored
`plugins/`, where `src/plugins/builtin.ts` globs it into the build. See
[docs/plugins.md](plugins.md) for why: the short version is 890 KB gzipped off a first
visit, and an installed app or a container that starts with all five plugins and no
network.

It only fetches what is not already there at the pinned version, so the first build after
a clone needs a connection and every one after it is offline and instant. `--force`
re-fetches, `--clean` removes the directory, `--list` prints the specs, and
`SCMJS_SKIP_VENDOR=1` skips the step for a build with no network and no copy yet — that
bundle then fetches its defaults at startup, the way the editor did before. `GITHUB_TOKEN`,
if set, keeps the one file-list request per plugin off the anonymous rate limit; CI sets it.
`--skip-plugins` is the same skip for `build:desktop` alone.

A directory in `plugins/` carries a `vendored.json` naming the spec it came from, which is
how the script knows which copies are its own: those it brings up to date or removes when
they stop being defaults, and one you put there by hand it leaves alone.

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

`.github/workflows/build.yml` has three channels, and the release list only grows when
a version is cut:

| channel | trigger | what lands |
| --- | --- | --- |
| `ci` | every push to `main` | lint, tests, and the web bundle built and thrown away. Nothing is deployed and nothing is released. |
| `nightly` | a daily cron at 07:17 UTC, or a manual dispatch with the `nightly` input ticked | installers for Windows, macOS x64/arm64 and Linux AppImage/deb, a zip of the web bundle, and electron-updater's `latest*.yml`, all on one rolling prerelease — plus that same zip unpacked onto `nightly.editor.scmjs.dev`. |
| `stable` | a pushed `vX.Y.Z` tag | a permanent release with the same assets, its notes (see below), the container image on GHCR, and the Pages deploy of `editor.scmjs.dev`. |

`tsc -b` covers `desktop/` through `tsconfig.desktop.json`, so a main-process type error
fails a push to `main`; only the packaging step waits for the nightly. The cron exits
early when `main` has not moved since the last one, so an idle week produces no builds.

The nightly is **updated in place**: the `nightly` tag is force-moved to the commit and
the assets are replaced with `gh release upload --clobber`. It is never deleted and
recreated — that would reset the download counts and re-notify everyone watching
releases. So there is one prerelease in the list, permanently, however many nights run.

### Download links

GitHub redirects `/releases/latest/download/<asset>` to the newest release that is *not*
a prerelease or a draft. The download buttons on the site are therefore plain `<a href>`s
that never need updating, never touch the API (and so cannot be rate-limited), and never
resolve to a nightly:

```
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-windows-x64-setup.exe
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-windows-x64.zip
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-macos-arm64.dmg
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-macos-x64.dmg
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-linux-x86_64.AppImage
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-linux-amd64.deb
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-web.zip
```

and the nightly's own, on its fixed tag:

```
https://github.com/scm-js/scm-js/releases/download/nightly/scmJS-windows-x64-setup.exe
```

That redirect can only resolve a fixed file name, which is why `electron-builder.yml`'s
`artifactName` carries no version. The cost is that two downloaded versions share a name
in the browser's downloads folder; the version is in the release title, the notes and
`latest*.yml`. To un-promote a bad stable release, tick "This is a pre-release" on it and
the redirect falls back to the one before — no new tag, no rebuild.

### The container image

`docker/Dockerfile` is nginx with the built web bundle in it, pushed to
`ghcr.io/scm-js/scm-js` by the `image` job on a tagged release only:

```sh
docker run --rm -p 8080:80 ghcr.io/scm-js/scm-js:latest   # http://localhost:8080
```

The tags are `latest`, the full version and the moving `X.Y` and `X`
(`docker/metadata-action` reads them off the tag the run is on). A nightly publishes no
image: an installer is something you choose and can roll back by keeping the old file,
while `latest` in a registry is what a `docker run` picks up without asking, so only a
version cut on purpose goes there.

Two decisions are worth knowing:

- **It copies a bundle rather than building one.** The `web` job has already built,
  linted and tested the zip the release carries; the image job downloads that artifact
  and unzips it, so the image cannot differ from the download. It also makes
  `--platform linux/amd64,linux/arm64` free — with no `RUN` step there is nothing to
  emulate, and the files are the same bytes on either architecture, so buildx writes one
  manifest list and needs no QEMU. A node build stage would have cost minutes per
  architecture to produce identical output.
- **It carries no game data.** `vite build` copies `public/` into `dist/`, so a clone
  that ran `npm run extract` has Blizzard's extracted trees sitting in the bundle;
  `.dockerignore` cuts them back out of the build context rather than trusting them to be
  absent, and the nginx config answers 404 for those five paths so the manifest probe
  gets an honest answer. A container starts at step 4 of the resolver and asks through
  Help ▸ Game Data…, exactly like the hosted build. Mounting your own tree over those
  paths is in [game-data.md](game-data.md#getting-the-files).

Locally, `npm run build:image` builds the bundle and the image (tagged `scmjs`). The
Release workflow builds and *serves* the image before it tags anything — a request for
the page, one hashed asset and a check that `/tileset/manifest.json` 404s — so a broken
Dockerfile stops the release instead of landing on `latest`.

### Cutting a release

Run the **Release** workflow (`.github/workflows/release.yml`) from the Actions tab. It
takes the version to release — `0.3`, `1.0` and `1` are accepted and padded to three
parts, and blank promotes the line the nightlies have already been building, so what
people have been testing is what ships — an optional `notes` box (below), and a `dry_run`
tick that does everything except push.

It refuses to run anywhere but `main`, refuses a version whose tag exists, refuses one
that is not newer than the last release (going backwards would offer nobody an update and
would still take over the `/releases/latest` redirect, since GitHub calls the most
recently *published* release the latest), and runs the same lint, tests and build the
Build workflow does **before** writing anything — a workflow that stops before tagging
costs nothing, while a tag pointing at a failing commit has to be deleted by hand. Then:

1. `package.json` and the lock go to the released version and are committed. The whole
   diff is `"version"`, in the two files. Before the very first release there is nothing
   to commit and the tag goes on the commit that is already there.
2. `vX.Y.Z` (annotated) tags that commit.

There is no third step moving `package.json` on, and that is the point of
`scripts/next-version.mjs`. A nightly is named `<base>-nightly.<date>.<run number>`, and
the base is a **patch bump of the newest release tag** — worked out, never recorded. So
`package.json` on `main` means something true and self-maintaining: *the version that was
last released*.

Why a patch bump and not a guess at the next real version: a nightly has to sort above the
release it follows (or the in-app updater offers nightly users a downgrade it cannot
install) and below the release that comes next (or it offers them nothing until that
version finally ships). A patch bump is the only choice that can never be too high —
after `v0.8.0` the nightlies are `0.8.1-nightly.…`, which is below `0.8.1`, `0.9.0` and
`1.0.0` alike. Nothing has to be decided in advance about what comes next: cut `1.0.0`
whenever the breaking change lands and every nightly user is offered it. The two edges,
both tested in `tests/next-version.test.ts`: with no release tags nothing has shipped, so
`package.json`'s own version is used as it stands, and a prerelease tag (`v1.0.0-beta.1`)
answers with its release version, since `1.0.0-nightly.…` sorts above `1.0.0-beta.1` and
below `1.0.0`.

### Release notes

A tagged release's body is what someone wrote, followed by GitHub's generated list of
commits and pull requests. What someone wrote comes from one of two places:

- `docs/releases/<version>.md`, committed to `main` before the release is cut and read by
  the Build workflow out of the **tag's own tree**. The name is the full three-part
  version, so cutting `0.3` reads `docs/releases/0.3.0.md`. This is the normal way: the
  notes are reviewed like any other change and stay with the commit they describe.
- The Release workflow's `notes` input, for a one-off not worth committing. It wins over
  the file and is handed to Build as a dispatch input, so it lives only in the release —
  re-running Build on that tag by hand falls back to the file.

Neither is required. With nothing written the release carries the generated list alone, as
every release did before; the Release workflow says so as a notice in its pre-flight,
where it also prints the notes it found, so a dry run shows exactly what the release will
read like. `docs/releases/README.md` is the convention.

The Build workflow is then **dispatched on the tag** rather than left to the tag push,
because a push made with the repository's own `GITHUB_TOKEN` starts no further workflow
run (GitHub's recursion guard) — `workflow_dispatch` through the API is the documented
exception, and dispatching on `refs/tags/vX.Y.Z` puts Build in exactly the state the push
would have — and that one dispatch is the whole release, the hosted editor included, since
Pages now serves the tag. (A PAT in a secret would make the tag push trigger Build
directly; this needs no secret.)

### Versions

The version comes from the tag, or `scripts/next-version.mjs` plus
`-nightly.<date>.<run number>` on `main`; the workflow warns when a tag and `package.json`
disagree. Every job `npm version`s it into `package.json` before building,
`vite.config.ts` injects that as `__APP_VERSION__`, `src/version.ts` is where the splash
and the About dialog read it, and electron-builder writes it into `latest*.yml`. The run
number rather than the short SHA orders same-day nightlies, since semver compares
alphanumeric prerelease identifiers lexically. `package.json` in the repository is only
ever set by the Release workflow, so a clean checkout builds as the last released version
rather than as a number nobody chose.

No build carries game data or an address to fetch it from, and CI has no game data, so the
real-data test suites skip there.

### The two hosted builds

`editor.scmjs.dev` is the newest tag and `nightly.editor.scmjs.dev` is `main` as of the
last nightly. The point of the split is that everything the project ships is now a version
you can name: the hosted editor, the installers, the container image and the release notes
are one build, so "it's broken on the website" has an answer.

| | deployed by | from |
| --- | --- | --- |
| `editor.scmjs.dev` | the `pages` job, on the `stable` channel | GitHub Pages on this repository |
| `nightly.editor.scmjs.dev` | the `nightly-site` job, on the `nightly` channel | one force-pushed orphan commit on `scm-js/nightly`'s `gh-pages` branch |

The nightly site is the release's own web zip unpacked, never a second build, the way the
container image is. The push is a single orphan commit each time, so that repository stays
the size of one bundle instead of growing by 5 MB a night, and it carries `CNAME` (where a
branch-served Pages site keeps its custom domain, so it has to be in every push) and
`.nojekyll`.

They are **separate origins**, which is deliberate and not free. The extracted game data
lives in OPFS and every `scmjs.` setting in `localStorage`, both scoped to the origin, so
the nightly asks for the game data again and keeps its own preferences, recents, installed
plugins and plugin code snapshots. What that buys is a nightly that cannot write a stored
shape the stable build then reads back — worth more than the second download, for a channel
whose whole job is to be ahead of the stable one.

To put `editor.scmjs.dev` back on an older version, dispatch Build on that tag: the deploy
is the only thing a re-run rewrites. Un-promoting a release (ticking "This is a
pre-release") moves the download redirect but not the site.

Three repository variables and one secret, none of them required — a fork builds and
releases without any of them:

| | |
| --- | --- |
| `PAGES_BASE` | the hosted build's base path; `/` for a custom domain, and the default is the repository name. When it is not `/` the `web` job builds the bundle a second time, since the release zip is always rooted. |
| `NIGHTLY_DOMAIN` | the domain written into the nightly site's `CNAME`. Unset, the deploy is skipped. |
| `NIGHTLY_PAT` (secret) | a fine-grained token whose only permission is Contents: write on `<owner>/nightly`, because a repository's own `GITHUB_TOKEN` cannot write to another repository. A **repository** secret on this repository, not an organisation one like `PLUGIN_API_PAT`: only `build.yml` reads it, and an org secret is readable by every workflow in every repository it is shared with. Unset, the deploy is skipped with a notice rather than failing the nightly. |

### In-app updates

`desktop/updater.ts` (main process, `electron-updater`), `src/editor/updates.ts` (the pure
state machine and every string it shows), `src/atoms/updateAtoms.ts`,
`src/hooks/useUpdateCheck.ts` (the startup check and the one event subscription) and
`components/dialogs/UpdateDialog.tsx`. `tests/updates.test.ts`.

The feed is the `latest.yml` / `latest-mac.yml` / `latest-linux.yml` the desktop job
uploads; `electron-builder.yml`'s `publish:` block is what makes electron-builder write
them and bake `app-update.yml` into the asar. Version comparison is the `version` field
inside those files rather than the git tag, so the moving `nightly` tag is not a problem,
and the version-free asset names mean the download URL under that tag is always current.
`electron-updater` derives `allowPrerelease` from whether the *running* version has a
prerelease component, so a nightly build follows nightlies and a stable build follows
stable on their own; the Preferences tick (`updates.nightly`) overrides it so a stable
install can opt in. `electron-updater` is required lazily — Rollup keeps it behind a
memoised factory in `main.cjs` — because `desktop/main.ts` is on the critical path to the
first painted frame.

**Finding an update raises a toast, not a dialog.** The check lands seconds after launch,
by which time the user has started doing something, and two dialogs already open
themselves at startup (Game Data when there is none, the Repair plugin on a map that needs
it) — a third would queue behind them. The toast carries a Download button
(`Toast.action`, the only button a toast may have) that opens the same dialog Help ▸ Check
for Updates… opens, and it has no `ttl`, so it waits to be answered rather than expiring
behind the splash.

Nothing downloads or installs unasked: `autoDownload` is false, and installing goes
through `guardedAction(store, …, "quit")` — the same unsaved-changes gate as the window's
close button — before `quitAndInstall`. `autoInstallOnAppQuit` stays true so "Later" on a
downloaded update means "next time I quit".

Two things `UpdateSupport` exists to keep honest:

- **Checking and installing are separate questions.** `support.check` is the updater's own
  `isUpdaterActive()`, not a guess from `process.platform`, because `AppImageUpdater` — the
  implementation chosen for *any* Linux build with no `package-type` file — refuses when
  `APPIMAGE` is not in the environment, and then `checkForUpdates()` resolves **null**
  instead of throwing. Reading that null as "up to date" told the user they were current
  when nothing had been fetched; `check()` maps it to `unsupported`. `support.install` is
  false only on macOS, where Squirrel.Mac verifies the code signature and an unsigned build
  cannot apply what it downloaded. Windows (NSIS), the AppImage and the `.deb` (through
  dpkg or apt, asking for privileges) all install. Where `install` is false the dialog
  offers the release page, never a progress bar that would fail at the end.
- **electron-updater's errors carry the whole HTTP response**, response headers and
  `Set-Cookie` included. `message()` keeps the first line, names the cases worth naming
  (404, 403, 5xx, the socket errors) and caps the rest, so a failed check is one sentence
  and no session cookie reaches the screen.

Verified against a packaged Linux build: an unpacked-folder run reports that it cannot
check; the AppImage reaches GitHub (a 404 on a repository with no releases reads as "No
release was found for this build"); and against a local `generic` feed the whole path runs
— toast, dialog, download, "ready to install".

## Plugin typings

`npm run build:plugin-types` (`scripts/build-plugin-types.mjs`) rolls the contract into
**one** `plugin-api/index.d.ts` with `dts-bundle-generator` over `src/plugins/api.ts`,
plus a `package.json`. `npm run publish:plugin-types` (`scripts/publish-plugin-api.mjs`)
publishes those two files as **`@scm-js/plugin-api`** on npm and commits and tags them at
[`scm-js/plugin-api`](https://github.com/scm-js/plugin-api) — the registry is what plugin
repositories depend on (`^1`), the repository is the audit trail behind the tarball. Each
of them used to carry a hand-refreshed copy of the 61-file, 480 KB emitted tree.

The version is the **API's**: major is `PLUGIN_API_VERSION`, the minor moves when the
declarations do, and the editor's own version is deliberately not in it — editor 0.1.0 to
0.2.0 is an ordinary release that semver would read as a break, and an npm version cannot
be republished once it is wrong. `nextVersion` asks the registry what is published and
bumps from that; a build that did not move the contract publishes nothing, tags nothing and
commits nothing. `tsc` emits one declaration per
module the entry reaches, which is why the bundling step exists at all; the build refuses
a bundle that still carries an import, since one that names `jotai` or `react` (or a file
the bundler missed) is a plugin repository that cannot compile with the file alone.

build.yml's `plugin-api` job runs on every build, since a contract that moved on main is
one plugin authors can have today. The git push uses the `PLUGIN_API_PAT` organisation
secret and reports rather than fails when it is absent; the npm publish is behind the
`PUBLISH_PLUGIN_API` repository variable, because a tarball needs the scope and npm's
trusted publishing set up and cannot be taken back once it is out. It goes out with
`--provenance`, so the package page names the workflow run and the commit. Authentication
is OIDC alone — there is no npm token, which is why the job's `setup-node` has no
`registry-url` (that writes an `.npmrc` holding an empty `_authToken` for npm to present
instead of exchanging its OIDC one). The trusted publisher on npmjs.com names this
repository and `build.yml`, leaves Environment blank, and must have **Allowed actions**
permitting a *direct* publish — staging is always allowed and direct is opt-in, and
without it a correct publisher still answers `403 OIDC permission denied for this action`. The plain types
the contract shares with the chrome — `EditorLayer`,
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
  data/         Reference tables (tilesets, players/colours, units, upgrades, techs, trigger definitions), and
                the names read out of the loaded game data in front of them (gameNames.ts)
  gamedata/     Where the game files come from: the resolver chain, the stored copies (one per data set),
                the extraction and its worker, the desktop bridge's types, data-set profiles
  formats/
    chk/        CHK container, section registry, typed section codecs
    mpq/        .scm/.scx open + save on top of mopaq
    tileset/    cv5/vf4/vr4/vx4/wpe decoding, megatile atlas, terrain catalogue, palette
    dat/        units/flingy/sprites/images.dat, .tbl, GRP, PCX, .lo and iscript.bin decoders
    units/      Unit data, lazy GRP/.lo/remap loading, frame cache, the iscript animator
    triggers/   TrigEdit-syntax printer and parser
  plugins/      Plugin API (the contract), host, loader, built-in registry
  services/     Map open/save pickers, PNG export, startup preload, game data switching
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

All of it is published as [docs.scmjs.dev](https://docs.scmjs.dev), built by
`npm run build:docs` (`scripts/build-docs.mjs`) and deployed by build.yml's `docs` job on
a tag, like the hosted editor. Two halves: these documents split at their `##` headings
into pages, and the plugin API reference generated from the bundled `plugin-api/index.d.ts`
— so a doc comment in `src/plugins/api.ts` is a paragraph on the site, and a member with
none shows as a bare signature. Nothing on the site is prose a generator wrote, and these
files stay where all of it is maintained.

| Topic | File |
| --- | --- |
| What the editor does, for map makers | [../README.md](../README.md) |
| CHK and MPQ handling, section coverage | [file-formats.md](file-formats.md) |
| Extracting and using Blizzard data | [game-data.md](game-data.md) |
| The trigger scripting language | the [Trigger Script plugin](https://github.com/scm-js/plugin-trigger-script)'s README |
| Writing and installing plugins, the plugin API | [plugins.md](plugins.md) |
| Per-subsystem implementation notes | [../CLAUDE.md](../CLAUDE.md) |
| Provenance of adapted code and data | [../ATTRIBUTION.md](../ATTRIBUTION.md) |
