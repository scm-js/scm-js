# Development

How to run scmJS from source, how it is built and released, and what to know before
changing it. This is for anyone running the editor locally, building the desktop app or
the container, or contributing. The [user guide](../README.md) says what the editor does;
[file-formats.md](file-formats.md) and [game-data.md](game-data.md) explain the map file
and the game data; [plugins.md](plugins.md) is for plugin authors. Per-subsystem notes for
someone working deep in one area are in [CLAUDE.md](../CLAUDE.md), which is written for
an AI assistant but is the most detailed description of the code there is.

## Getting started

You need Node.js 22.18 or newer (the extraction scripts import TypeScript directly and
rely on Node's built-in type stripping) and git. A StarCraft installation is optional: the
editor runs without the game's graphics, and the first run offers to download them.

```sh
git clone https://github.com/scm-js/scm-js
cd scm-js
npm install
npm run extract        # optional: the game's graphics, from an installation you own
npm run dev            # http://localhost:5173
```

The first `npm run dev` or `npm run build` needs a network connection: a `predev` /
`prebuild` hook fetches the five default plugins at their pinned versions into the
gitignored `plugins/` folder, where the build compiles them in (see
[Defaults and vendoring](#defaults-and-vendoring)). After that it is offline. The same
hook reports what game data is on disk and warns, rather than fails, when there is none.

`npm run extract` looks for `StarDat.mpq` and `BrooDat.mpq` on its own or takes a path;
the details and what comes out are in [game-data.md](game-data.md#extracting-for-a-source-build).
Without it terrain is flat colours and units are markers, and everything else works.

### Everyday commands

```sh
npm run dev            # Vite dev server
npm run build          # tsc -b (the type-check) + vite build → dist/
npm run preview        # serve dist/ locally
npm run lint           # oxlint; does not type-check
npm test               # vitest, a few seconds, no browser
npm run test:watch
npx vitest run tests/chk.test.ts      # one file
npx vitest run -t "flood fill"        # tests matching a name
npm run check:assets   # what game data is on disk
```

`npm run build` is the type-check: `tsc -b` covers the app, the scripts and the desktop
main process (`tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.desktop.json`). The
app config is strict: `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` (so
`import type` for types) and `erasableSyntaxOnly` (so no enums and no constructor
parameter properties). Lint and build both run on every push, so run them before one.

### Dev deep-links

Query parameters jump straight to a UI state, which is the fastest way to iterate on a
screen or take a screenshot:

```
/?nosplash                        skip the splash
/?nosplash&layer=units            select a layer: terrain, doodads, units, sprites, locations, fog, clipboard
/?nosplash&dialog=playerSettings  open a dialog by id; repeatable
/?nosplash&zoom=0.5&tileset=ice   zoom level and tileset
/?nosplash&mode=tile              terrain palette mode: isom, rect, tile
/?nosplash&layer=fog&fogPlayer=3  view and paint one player's fog
```

An unknown dialog id is reported in the console with the list of valid ones.

In development, React 19's "Components" performance track is switched off, because it
serialises every render's props and turned mounting the chrome into seconds of blocked
main thread. Set `VITE_REACT_TRACKS=1` to have it back when profiling renders.

## Repository layout

```
src/
  atoms/        Jotai state: the document and its undo history, UI state, the dialog stack, preferences
  editor/       The edits: invertible change lists per layer, placement checks, settings transactions,
                save planning, validation, find, statistics
  data/         Reference tables (tilesets, players, units, upgrades, techs, trigger definitions) and
                the names read out of the loaded game data
  gamedata/     Where the game files come from: the resolver, the browser's stored copies, extraction,
                the desktop bridge's types, data sets
  formats/
    chk/        The scenario: container reader, section registry, typed section codecs, new maps
    mpq/        .scm/.scx open and save on top of mopaq
    tileset/    Tileset decoding, the megatile atlas, the terrain catalogue, palette cycling
    dat/        units/flingy/sprites/images.dat, .tbl, GRP, PCX, .lo and iscript decoders
    units/      Unit tables, lazy sprite loading, the frame cache, team colours, the animator
    triggers/   The text trigger format (TrigEdit syntax)
  plugins/      The plugin API (the contract), host, loader, defaults, registry
  services/     File pickers and saving, image export, the startup preload, Test Map, data-set switching
  hooks/        The React side of the tools, file actions, hotkeys, plugins, updates
  components/
    chrome/     Menu bar, toolbar, status bar, toasts
    panels/     Left dock (layers and palettes), right dock (minimap, layers, properties), plugin panels
    viewport/   The map canvas, rulers, hover ghosts, context menu
    dialogs/    Every dialog, and the registry that lazy-loads them
    splash/     The splash screen
    ui/         Primitives: buttons, inputs, lists, tabs, the dialog frame
  styles/       Plain CSS, imported in order: tokens → base → ui → chrome → panels → viewport → dialogs → splash
desktop/        The Electron shell: main process, preload bridge, updater
scripts/        Extraction, vendoring, the desktop and docs builds, plugin typings, screenshots
tests/          vitest suites
docs/           These documents, the release notes, the guide's pictures
docker/         The container image
plugins/        Generated: the default plugins' source at their pinned versions (gitignored)
public/         Generated: the extracted game data (gitignored except its README and the icons)
fixtures/       Blizzard maps and archives used by tests (gitignored)
plugin-api/     Generated: the bundled plugin typings (gitignored)
```

## How the editor is put together

The conventions that everything else follows. Each is explained in more depth in
[CLAUDE.md](../CLAUDE.md), and the source comments say why.

**State is Jotai, and there is one store.** No context providers, no Redux. Persisted
settings are `atomWithStorage` atoms under keys starting with `scmjs.`, listed in
Preferences ▸ Browser storage; every such key has to be registered in the reset table in
`src/atoms/preferencesAtoms.ts`, and a test fails when one is not.

**The scenario is mutated in place.** `scenarioAtom` holds the parsed `Scenario` that is
written to disk, and edits change it directly rather than replacing it. React therefore
does not see an edit on its own: each area has a revision counter (`terrainRevisionAtom`
and its siblings) that is bumped after every edit, undo and load, and the viewport and
panels subscribe to those. A second set of atoms mirrors the fields the chrome displays
(map name, size, tileset); change one side and you have to change the other.

**Only changed sections are written.** `Scenario.dirty` is the set of section names to
re-encode on save; everything else goes out byte for byte. Any code that mutates the
scenario must mark every section it touched, or the change is silently lost on save.
[file-formats.md](file-formats.md#in-the-source) has the rest.

**Edits are invertible change lists.** A brush, a placement or a paste produces a list of
`{ before, after }` changes per layer, applied by one function in one fixed order and
reversed for undo. A stroke is one history entry (200 levels). The settings dialogs, the
trigger editors, resize, and the tileset change are transactions outside the undo model,
as in StarEdit: each is its own OK / Apply / Cancel.

**Dialogs are lazy.** Adding one means a `DialogId` in `src/components/dialogs/ids.ts`
and an entry in the registry in `DialogHost.tsx`, which loads each dialog module on
first use. Nothing on the startup path may import a dialog module statically, or Vite
folds it back into the main chunk.

**Plugins get the same API the editor uses.** `src/plugins/api.ts` is the contract; the
host builds it over the store with no React and no atoms exposed. A plugin's edit goes
through the same transaction and history as a brush stroke. See
[The plugin host](#the-plugin-host).

## Tests

Tests are `tests/*.test.ts` (and any `src/**/*.test.ts`), run by vitest in Node with no
browser. The whole suite takes a few seconds.

Some suites need real Blizzard files: maps in `fixtures/maps/*.scx` and extracted data in
`public/`. Those use `describe.skipIf(...)` and skip silently when the files are absent,
so a green run on a fresh clone has not exercised them. CI has no game data and always
skips them; run them locally before touching a codec, a decoder or the isometric brush.
`fixtures/` and the generated `public/` trees are gitignored, and nothing in them may be
committed.

Two suites are worth knowing about:

- `tests/plugin-network.test.ts` fetches, transpiles and imports the real default plugins
  from GitHub. It is off unless `SCMJS_NETWORK_TESTS=1`, and CI runs it in the web build
  and the release pre-flight, since opening the editor no longer walks that path.
- `tests/docs.test.ts` checks these documents: the split into site pages, every relative
  link, every picture, and that the plugin guide names only calls the API declares.

## Game data

The editor draws with StarCraft's own graphics, which are not redistributable and are
never committed. A clone extracts them from an installation with `npm run extract`; a
build without them falls back to flat colours and asks the user through
Help ▸ Game Data…. No build, container image or hosted site carries the data or an
address to fetch it from. [game-data.md](game-data.md) covers where the editor looks,
the download route and the extraction; [ATTRIBUTION.md](../ATTRIBUTION.md) the terms.

## Desktop build

`desktop/` is an Electron shell around the same web bundle. `main.ts` serves `dist/`
under `app://scmjs/`, searches the disk for the game archives and extracts them into the
app's data folder, opens maps handed over by the file manager, guards the window's close
while a map has unsaved changes, and holds the updater. `preload.ts` exposes that to the
page as `window.scmjsDesktop`, typed in `src/gamedata/desktop.ts`.

```sh
npm run desktop                 # bundle the main process and run Electron against dist/
SCMJS_DEV_URL=http://localhost:5173 npm run desktop    # against the dev server instead
npm run build:desktop           # web build + main bundle + electron-builder for this OS
```

`npm run build:desktop` takes the packaging step's platform, architectures and targets
on the command line; with none it builds this OS with the targets `electron-builder.yml`
lists, which is what CI does:

```sh
npm run build:desktop -- win                 # Windows: nsis + zip
npm run build:desktop -- win nsis            # just the installer
npm run build:desktop -- linux AppImage x64 arm64
npm run build:desktop -- mac dmg arm64
npm run build:desktop -- --dir               # unpacked app, no installer: the fast check
npm run build:desktop -- win --skip-web      # repackage the dist/ already on disk
npm run build:desktop -- --skip-plugins      # leave plugins/ alone (no vendoring fetch)
```

Platforms are `win`, `mac` and `linux`; architectures `x64`, `ia32`, `arm64`, `armv7l`
and `universal`; any electron-builder target name (`nsis`, `dmg`, `zip`, `AppImage`,
`deb`, …) applies to every platform named. `--skip-web` and `--skip-main` reuse the
bundles on disk, `--publish <mode>` and anything after a bare `--` go to electron-builder
as they are. Cross-building is electron-builder's business: the script warns about
combinations that need tooling the machine may lack (a macOS installer off a Mac, an
NSIS installer without Wine) and runs them anyway; `--dir` and `zip` cross-build with
nothing installed. Output lands in `release/`.

The build also writes `THIRD-PARTY-NOTICES.txt` into `dist/`: the license text of every
runtime dependency and of the compiled-in plugins, generated by `scripts/lib/notices.mjs`
from `package.json` rather than from a list, so it rides in the web zip, the installers
and the container image without anyone maintaining it.

What ships is decided by `electron-builder.yml`: `dist/` and `desktop/dist/` only, never
`node_modules` (Vite bundles everything, mopaq and the extraction included) and never the
game data a developer's `public/` may hold. Windows gets an NSIS installer and a zip
(not electron-builder's `portable` target, which re-extracts the whole app on every
launch), macOS a dmg per architecture, Linux an AppImage and a `.deb`. The installers
register `.scm`, `.scx` and `.chk`. Asset names carry no version, for the reason under
[Download links](#download-links). Only `en-US` of Chromium's locales is included, since
the editor has no translations. Builds are unsigned: Windows shows SmartScreen's
"unrecognized app" screen, and macOS refuses an unsigned app until the user clears the
quarantine attribute.

The app's data folder is the platform's usual one for an app named `scm-js`
(`%APPDATA%\scm-js` on Windows, `~/.config/scm-js` on Linux,
`~/Library/Application Support/scm-js` on macOS). It holds the extracted game data, the
remembered window geometry in `window.json`, and `startup.log`, the milestones of the
last launch (process start, main script, window created, `dom-ready`, which signal showed
the window, and the window geometry at each step). `SCMJS_TRACE=1` echoes the same to
the terminal. When a launch "hangs and then opens", that log is what tells a slow disk, a
virus scanner reading the binaries, and a slow first paint apart.

The launch itself is arranged so that something is on screen early: the window is
created hidden and shown on the renderer's first paint, `index.html` carries a boot
splash in plain markup so that paint needs no stylesheet or bundle, and the app mounts
its chrome two frames after the splash. The saved maximized state is applied after the
window is shown. The reasons, and the measurements behind them, are in the comments in
`desktop/main.ts` and `src/App.tsx`.

### Running the Windows build from WSL

The desktop build cross-builds from WSL, but where the packaged app is run from changes
the launch more than anything in the code: `\\wsl.localhost\…` is a network share, and
Chromium loading its binaries and then every asset through it takes minutes. The same
build, launched from the WSL filesystem and from `C:`:

| milestone | `/mnt/c/…` | `\\wsl.localhost\…` |
| --- | --- | --- |
| main script evaluated | 47 ms | 628 ms |
| window created | 142 ms | 963 ms |
| `dom-ready` | 215 ms | not within 25 s |

So copy it over first:

```sh
npm run build:desktop -- win --dir          # release/win-unpacked
cp -r release/win-unpacked /mnt/c/Users/<you>/scmjs-test
SCMJS_TRACE=1 WSLENV=SCMJS_TRACE /mnt/c/Users/<you>/scmjs-test/scmJS.exe
```

`WSLENV` forwards the variable into the Windows process. From WSL, the app's data folder
is `/mnt/c/Users/<you>/AppData/Roaming/scm-js`.

### In-app updates

The desktop app checks GitHub releases at startup (a preference, on by default) and
through Help ▸ Check for Updates…, using electron-updater over the `latest*.yml` feed
files the release workflow uploads beside the installers. Finding one raises a toast with
a Download button rather than a dialog; nothing downloads or installs unasked, and
installing goes through the same unsaved-changes gate as closing the window. A nightly
build follows the nightlies and a stable build follows stable releases; a preference lets
a stable install opt into nightlies.

Windows, the AppImage and the `.deb` install updates themselves. macOS can see one but
not install it until the app is code-signed, so the dialog offers the release page there.
A development run (`npm run desktop`) and an unpacked Linux folder report that they
cannot check, since the updater has nothing it could replace. `desktop/updater.ts` is the main-process side,
`src/editor/updates.ts` the state machine and every string, `tests/updates.test.ts` the
cases.

## The plugin host

[plugins.md](plugins.md) is written for someone who has the npm package and none of this
repository. This is the editor's half: where the plugin system lives and how a plugin
gets from an address to a running `activate`.

| File | |
| --- | --- |
| `src/plugins/api.ts` | The public types, and the only place the contract is written. `PLUGIN_API_VERSION` bumps for a change that is not backward compatible; additions leave it alone. |
| `src/plugins/host.ts` | `createPluginApi(store, info)` builds one plugin's `PluginApi` over the store, with a `Contributions` bag that `dispose()` empties. `activatePlugin` / `deactivatePlugin` drive the lifecycle; `inspectPlugin` / `installPlugin` are the confirm-then-add pair. |
| `src/plugins/loader.ts` | Spec parsing, the manifest fetch, and the fetch / transpile / rewrite-imports / blob-URL pipeline. Pure apart from the callbacks it takes, so the tests run it in Node. |
| `src/plugins/defaults.ts` | The plugins a fresh editor starts with, each pinned to a tag. |
| `src/plugins/registry.ts` | Browse Plugins: parsing, searching and caching the JSON indexes. |
| `src/plugins/claims.ts` | The trigger-list claims the trigger editors read. |
| `src/plugins/images.ts` | Image loading, clipboard images, and drop / paste transfers for plugin dialogs. |
| `src/plugins/failures.ts` | The toast a failed activation raises. |
| `src/plugins/builtin.ts` | `import.meta.glob` over `plugins/*/`, where the vendored defaults land. |
| `src/plugins/transpile.worker.ts` | TypeScript in a worker, for a `.ts` plugin loaded from source. |
| `src/atoms/pluginAtoms.ts` | The installed list, the stored code copies, the runtimes, the contribution registries, and the one-at-a-time requests the viewport serves: picks, map tools, overlays, panels, claims. |
| `src/hooks/usePlugins.ts` | Activates the enabled plugins at startup and keeps the runtimes in step with the list. |
| `src/components/dialogs/PluginDialogs.tsx` | Manage Plugins, Browse, the Add / Update confirmation, and the frame a plugin's dialog mounts into. |
| `src/components/panels/PluginPanels.tsx` | The floating frames a plugin's panel mounts into. |

The chrome reads the registries: the menu bar merges plugin menu items into its model,
the viewport and the terrain palette append the matching context items, and the hotkey
hook checks plugin combos first. The viewport also serves the requests: a pick ahead of
every layer, then a running map tool, then the overlays at their slots in the paint pass,
each with a guarded `finish` so its promise settles exactly once however it ends.

A plugin's `document.edit` wraps the scenario in a transaction whose operations apply as
they are called and accumulate change lists, then commits one history entry through the
same path a brush stroke takes, stranded-object pass included. `document.update` is the
settings-and-triggers equivalent, committing through the settings and triggers commits.
`document.sections` rewrites the file and installs the re-parsed scenario, which is why
it drops the history.

### The loading pipeline

1. The spec is parsed into a base URL. `builtin:<name>` is a plugin compiled in from
   `plugins/<name>/`; a `github:` spec or a github.com URL resolves to
   `raw.githubusercontent.com/owner/repo/<ref or HEAD>/<dir>/`; any other URL is a
   manifest, an entry file (a manifest is synthesised from its name) or a directory
   holding `plugin.json`.
2. The manifest is fetched and validated; only `name` is required.
3. The file to import is the manifest's `build` when it has one (a committed bundle, one
   fetch, no transpile), else its `entry`.
4. That file is fetched as text and, if it is TypeScript, transpiled in the worker.
   Fetching as text matters: `raw.githubusercontent.com` serves `text/plain`, which a
   browser refuses to import as a module.
5. Relative imports are followed depth first, and each file becomes a `blob:` module URL
   with its specifiers rewritten. An extensionless specifier is tried as `.ts`, `.tsx`,
   `.mts`, `.js`, `.mjs` and then as that directory's `index.*`; `./x.js` falls back to
   `./x.ts`. Cycles and bare package names are errors naming the file.
6. The module is imported and its default export (or a named `activate`) is called with
   the API. Whatever it returns is kept for deactivation.

### Adding one

Pressing **Add** in Manage Plugins installs nothing. The editor canonicalises the
address, asks GitHub which commit the ref points at, and reads the `plugin.json` at that
commit. No entry file is fetched, nothing is transpiled and nothing is imported; probing
for `plugin.ts` would mean fetching code the user has not agreed to. The confirmation
opens only once a manifest came back; an address with nothing behind it is reported under
the Add field instead.

The install is the only writer past the dialog. Its three ticks are *Enable it now*,
*Pin to this version* (the stored spec becomes `github:owner/repo@<sha>`) and *Load from
a copy saved here* (below). The **Update** button on a pinned row previews the branch and,
when it holds a different commit, reopens the same dialog with the old commit marked to be
replaced.

A listed plugin that is not running is still described: the manifest alone is fetched to
fill in name, version, description and icon, and the answers are cached in browser
storage so the next visit renders from them while the refresh runs. Browse Plugins reads
the registry indexes the same way and hands a chosen entry to the same Add path, so a
registry decides what is listed and never what is trusted.

### Loading from a copy

*Load from a copy saved here* means "prefer the copy". With no copy yet, the load records
every fetched file into browser storage (capped; a larger plugin stays remote with a
console warning). With a copy, the load has no network path at all and errors on a file
the copy lacks, so a plugin that grew a file since the copy was made says so rather than
fetching it. Reload drops the copy and fetches again; turning the option off drops it too.

### Defaults and vendoring

The five default plugins (scmscx.com, Repair, Walkability, Terrain from Image and Paint)
are ordinary plugins from their own repositories, each pinned in `src/plugins/defaults.ts`
to a **tag**, never a branch, so that a push to a plugin repository cannot change every
editor already in use and any release can be rebuilt as it shipped. Moving a default
forward is a commit that changes the tag there. A plugin's identity is its repository,
whatever version follows, which is what keeps an older editor's unpinned spec, the
compiled-in copy and the pinned default from being listed and run as three plugins.

`scripts/vendor-plugins.mjs` writes each default's source at its tag into the gitignored
`plugins/`, where `builtin.ts` compiles it into the bundle. It runs from `predev`,
`prebuild` and the desktop build, fetches only what is not already there at the pinned
version, and honours `GITHUB_TOKEN` to stay off the anonymous rate limit (CI sets it).
A directory it wrote carries a `vendored.json`; one you put there by hand is left alone.

```sh
npm run vendor:plugins             # bring plugins/ up to date
npm run vendor:plugins -- --force  # fetch again even where the spec matches
npm run vendor:plugins -- --clean  # remove the directory
npm run vendor:plugins -- --list   # print the pinned specs
SCMJS_SKIP_VENDOR=1 npm run build  # skip it: that bundle fetches its defaults at startup
```

Every build compiles them in, not only the desktop, because of the cold path: one remote
`.ts` plugin starts the transpile worker, and TypeScript is inlined into that worker, so
five remote defaults put 3.4 MB (975 KB gzipped) of compiler onto a first visit. Measured
on the production build, a cold visit went from 1235 KB gzipped and 20 cross-origin
requests to 344 KB and none. `tests/vendor-plugins.test.ts` pins the script's parsing and
the rule that no default may be unpinned.

## Plugin typings

Plugin repositories compile against `@scm-js/plugin-api`, an npm package holding one
generated `index.d.ts` bundled from `src/plugins/api.ts`.

```sh
npm run build:plugin-types      # → plugin-api/index.d.ts + package.json (gitignored)
npm run publish:plugin-types    # publish to npm and push to github.com/scm-js/plugin-api
```

The build refuses a bundle that still carries an import, since a file naming `jotai` or
`react` is one a plugin repository cannot compile with alone. The version is the API's,
not the editor's: the major is `PLUGIN_API_VERSION`, the minor moves when the
declarations do, and a build that did not move the contract publishes nothing. The
`plugin-api` job in the Build workflow runs it on every build; the git push needs the
`PLUGIN_API_PAT` organisation secret (it reports rather than fails without it) and the
npm publish is behind the `PUBLISH_PLUGIN_API` repository variable, authenticating by
OIDC through npm's trusted publishing with `--provenance`. Setting that up is in
`scripts/publish-plugin-api.mjs` and the job's comments. `tests/plugin-api-package.test.ts`
pins the version rule and the no-imports rule.

The shared workflow each plugin repository calls, `scm-js/.github`'s `plugin-ci.yml`,
type-checks, tests, rebuilds and commits the plugin's `dist/plugin.js` on its main branch,
and at a tag checks that the committed bundle is what the source builds to.

## Releases

`.github/workflows/build.yml` has three channels, and the release list only grows when a
version is cut:

| channel | trigger | what lands |
| --- | --- | --- |
| `ci` | every push to `main` | lint, tests and the web bundle, built and thrown away. Nothing is deployed and nothing is released. |
| `nightly` | a daily cron at 07:17 UTC, or a manual dispatch with the `nightly` input ticked | installers for Windows, macOS (x64 and arm64) and Linux (AppImage and deb), a zip of the web bundle and the updater's `latest*.yml`, all on one rolling prerelease, plus that zip unpacked onto `nightly.editor.scmjs.dev`. |
| `stable` | a pushed `vX.Y.Z` tag | a permanent release with the same assets, its notes, the container image on GHCR, the Pages deploy of `editor.scmjs.dev`, and the docs site. |

The cron exits early when `main` has not moved since the last nightly. The nightly is
updated in place: its `nightly` tag is force-moved and its assets replaced, never deleted
and recreated, so there is one prerelease in the list however many nights run.

### Download links

GitHub redirects `/releases/latest/download/<asset>` to the newest release that is not a
prerelease or a draft, so the download buttons on the site are plain links that never
need updating and never resolve to a nightly:

```
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-windows-x64-setup.exe
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-windows-x64.zip
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-macos-arm64.dmg
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-macos-x64.dmg
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-linux-x86_64.AppImage
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-linux-amd64.deb
https://github.com/scm-js/scm-js/releases/latest/download/scmJS-web.zip
https://github.com/scm-js/scm-js/releases/download/nightly/scmJS-windows-x64-setup.exe
```

That redirect can only resolve a fixed file name, which is why the asset names carry no
version; the version is in the release title, the notes and `latest*.yml`. To un-promote
a bad release, tick "This is a pre-release" on it and the redirect falls back to the one
before.

### The container image

`docker/Dockerfile` is nginx with the built web bundle, pushed to `ghcr.io/scm-js/scm-js`
by the `image` job on a tagged release only, as `latest`, the full version, and the
moving `X.Y` and `X`. A nightly publishes no image, because `latest` is what a
`docker run` picks up without asking.

```sh
docker run --rm -p 8080:80 ghcr.io/scm-js/scm-js:latest   # http://localhost:8080
npm run build:image                                       # build it locally, tagged scmjs
```

The image copies the release's own web zip rather than building one, so it cannot differ
from the download, and with no `RUN` step one buildx manifest covers `linux/amd64` and
`linux/arm64` without emulation. It carries no game data: `.dockerignore` cuts the
extracted trees out of the build context and `docker/nginx.conf` answers 404 for those
paths, so a container asks through Help ▸ Game Data… like the hosted build. Mounting an
extracted tree over those paths is in [game-data.md](game-data.md#the-container-image).

### Cutting a release

Run the **Release** workflow (`.github/workflows/release.yml`) from the Actions tab. It
takes the version (`0.3`, `1.0` and `1` are padded to three parts; blank promotes the
line the nightlies have been building), an optional `notes` box, and a `dry_run` tick
that does everything except push.

It refuses to run anywhere but `main`, refuses a version whose tag exists, refuses one
that is not newer than the last release, and runs lint, tests (the network suite
included), the build and a check of the container image before writing anything. Then it
commits the version into `package.json` and the lock file, tags that commit `vX.Y.Z`, and
dispatches the Build workflow on the tag. The dispatch is necessary because a push made
with the repository's own token starts no further workflow run; that one dispatch is the
whole release, the hosted editor and the docs site included.

There is no step moving `package.json` on to a next version. A nightly is named
`<base>-nightly.<date>.<run number>` where the base is a patch bump of the newest release
tag, worked out by `scripts/next-version.mjs`. A patch bump is the one choice that sorts
above the release it follows and below whatever comes next, whether that is a patch, a
minor or a major, so the updater is never offered a downgrade and never starved. It also
leaves `package.json` on `main` meaning something true: the last released version.

### Release notes

The hand-written part of a release comes from `docs/releases/<version>.md`, committed to
`main` before the release is cut and read from the tag's own tree (the full three-part
name: cutting `0.3` reads `0.3.0.md`), or from the Release workflow's `notes` input, which
wins over the file and lives only in the release. Either goes above GitHub's generated
list of commits; with neither, the release carries that list alone. The pre-flight prints
what it found, so a dry run shows the body. `docs/releases/README.md` is the convention.

### Versions

The version is the tag's, or the nightly name on `main`. Every job writes it into
`package.json` before building; `vite.config.ts` injects it as `__APP_VERSION__`,
`src/version.ts` is where the splash and About read it, the boot splash in `index.html`
gets it through a small Vite plugin, and electron-builder writes it into `latest*.yml`.
The run number rather than a commit hash orders same-day nightlies, since semver compares
prerelease identifiers as strings.

### The two hosted builds

| | deployed by | from |
| --- | --- | --- |
| `editor.scmjs.dev` | the `pages` job, on a tag | GitHub Pages on this repository |
| `nightly.editor.scmjs.dev` | the `nightly-site` job, each nightly | one force-pushed orphan commit on `scm-js/nightly`'s `gh-pages` branch, carrying `CNAME` |
| `docs.scmjs.dev` | the `docs` job, on a tag | the same shape, on `scm-js/docs` |

The hosted editor is a release like every other way of running the editor: the site, the
installers, the image and the notes are one tag. The nightly site is the nightly's own
web zip unpacked, never a second build. To put `editor.scmjs.dev` back on an older
version, dispatch Build on that tag; the deploy is the only thing a re-run rewrites.

The two editors are separate origins on purpose. The extracted game data lives in the
browser's private file storage and every setting in `localStorage`, both per origin, so
the nightly asks for the game data again and keeps its own preferences, recents and
plugins rather than writing a stored shape the stable build then reads back.

### Variables and secrets

None of these is required: a fork builds and releases without any of them, and each
deploy that lacks its own is skipped with a notice.

| | Kind | For |
| --- | --- | --- |
| `PAGES_BASE` | variable | The hosted editor's base path: `/` for a custom domain, the repository name by default. When it is not `/`, the `web` job builds a second bundle for Pages, since the release zip is always rooted. |
| `NIGHTLY_DOMAIN` | variable | The domain written into the nightly site's `CNAME`. |
| `NIGHTLY_PAT` | repository secret | A fine-grained token with Contents: write on `<owner>/nightly`, since a repository's own token cannot write to another repository. |
| `DOCS_DOMAIN`, `DOCS_PAT` | variable, repository secret | The same pair for the docs site on `<owner>/docs`. |
| `PLUGIN_API_PAT` | organisation secret | Pushes the plugin typings to `scm-js/plugin-api`. |
| `PUBLISH_PLUGIN_API` | variable | Turns on the npm publish of `@scm-js/plugin-api`. |

## The documentation site

[docs.scmjs.dev](https://docs.scmjs.dev) is `npm run build:docs`, deployed by the `docs`
job on a tag so the site, the hosted editor and the installers are one version. It has
two halves. The guides are `README.md` and `docs/*.md`, split at their `##` headings into
pages with the `###` beneath as each page's contents; nothing on the site is prose a
generator wrote, and these files stay where it is maintained. The reference is generated
from the bundled plugin typings, so a doc comment in `src/plugins/api.ts` is a paragraph
on the site and a member with none shows as a bare signature.

```sh
npm run build:docs                                  # → docs-site/ (gitignored)
node scripts/build-docs.mjs --out /some/dir
```

The guides are written to be read on GitHub as well; the site's link rewriter turns a
relative link to one of the five documents into a page and anything else in the
repository into a link back to GitHub, and `tests/docs.test.ts` checks every link and
picture.

### Guide screenshots

The pictures in the user guide are `docs/images/*.webp`, made by
`scripts/guide-screenshots.mjs` against the dev server and the fixture maps: it drives a
headless Chromium through Playwright, opens the maps, paints and places what each picture
shows, and writes WebP files, lossless for a dialog and lossy for a window of terrain.
Re-run it after a change to the chrome and commit the pictures that changed.

```sh
npm run dev                                   # in one terminal
npm i --no-save playwright sharp              # not dependencies: only this script needs them
npx playwright install chromium               # once
node scripts/guide-screenshots.mjs            # → docs/images/
node scripts/guide-screenshots.mjs --only units,fog
```

It needs the game data extracted and Big Game Hunters, Binary Burghs, Crescent Moon and
Ground Zero from the game's own Maps folder in `fixtures/maps/`. Never commit a picture
that shows anything but the editor.

## Contributing

- **Keep the documents current.** `README.md`, `docs/file-formats.md`, `docs/game-data.md`,
  `docs/plugins.md` and this file are the documentation site; a behaviour change that is
  not in them is undocumented. `CLAUDE.md` carries the implementation detail and is kept in
  step with the code too.
- **Nothing of Blizzard's goes into git.** Not the extracted data, not the archives, not
  the fixture maps. `.gitignore` covers the generated trees; check before adding a test
  fixture.
- **Record where adapted code comes from.** The rule is in
  [ATTRIBUTION.md](../ATTRIBUTION.md#maintenance-rule): a provenance comment beside
  adapted algorithms and tables, an entry there naming the source and license, and the
  original notice kept.
- **Run what CI runs**: `npm run lint`, `npm test` and `npm run build`. With the game data
  and fixture maps on disk, the real-data suites run too, and that is the run that counts
  for anything under `src/formats/`.
- **Plugin API changes are additive.** `PLUGIN_API_VERSION` stays where it is for an
  addition; document the addition in `docs/plugins.md` and with a doc comment in
  `src/plugins/api.ts`, which is what the reference is generated from. The example plugin
  at [scm-js/plugin-hello-world](https://github.com/scm-js/plugin-hello-world) should
  keep building.
- **The plugins are separate repositories** under [github.com/scm-js](https://github.com/scm-js).
  A change to the editor that a default plugin needs is released by moving that plugin's
  tag in `src/plugins/defaults.ts`.

## Where things are documented

| Topic | Where |
| --- | --- |
| What the editor does, for map makers | [README.md](../README.md) |
| What is in a map file and what the editor does with it | [file-formats.md](file-formats.md) |
| Where the graphics come from, data sets, how they are drawn | [game-data.md](game-data.md) |
| Using, installing and writing plugins, the plugin API | [plugins.md](plugins.md), and the generated reference at [docs.scmjs.dev/api](https://docs.scmjs.dev/api/) |
| The trigger scripting language | the [Trigger Script plugin](https://github.com/scm-js/plugin-trigger-script)'s README |
| Each plugin's internals | its own repository's README |
| Running, building, releasing, contributing | this file |
| Per-subsystem implementation notes | [CLAUDE.md](../CLAUDE.md) |
| Provenance of adapted code and data | [ATTRIBUTION.md](../ATTRIBUTION.md) |
| Release notes | [docs/releases/](releases/README.md) |
