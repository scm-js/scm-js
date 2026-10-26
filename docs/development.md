# Development

How to run scmJS from source, how it is tested, built and released, and what to know
before changing it. This is for contributors, and for anyone building the desktop app or
the container image themselves.

Each topic is written down in one place:

| Topic | Where |
| --- | --- |
| What the editor does, for map makers | [guide.md](guide.md); the [README](../README.md) is the short version |
| Installing the editor | [installing.md](installing.md) |
| What happens to a map file on open and save | [file-formats.md](file-formats.md) |
| The scenario format, section by section | [chk-format.md](chk-format.md) |
| Triggers, conditions and actions | [triggers.md](triggers.md) |
| TrigScript, the trigger scripting language | [trigscript.md](trigscript.md); the compiler is in the [TrigScript plugin](https://github.com/scm-js/plugin-trigscript)'s repository |
| Where the graphics come from, data sets, how they are drawn | [game-data.md](game-data.md) |
| Using and writing plugins, the plugin API | [plugins.md](plugins.md), and the reference at [docs.scmjs.dev/api](https://docs.scmjs.dev/api/) |
| Each plugin's internals | its own repository's README |
| Running, building, releasing, contributing | this file |
| Per-area design notes for working on the code | `.claude/internals/*.md`, indexed by [CLAUDE.md](../CLAUDE.md) |
| Provenance of adapted code and data | [ATTRIBUTION.md](../ATTRIBUTION.md) |
| Release notes | [docs/releases/](releases/README.md) |

The design notes under `.claude/internals/` are one file per area of the code (terrain,
saving, the plugin host, sync, …). They record why the code is the way it is, and the
traps that are not visible from the code. Read the note for an area before changing it.

## Getting started

You need Node.js 22.18 or newer (the extraction scripts import TypeScript directly through
Node's type stripping) and git.

```sh
git clone https://github.com/scm-js/scm-js
cd scm-js
npm install
npm run dev            # http://localhost:5173
```

The first `npm run dev` or `npm run build` needs a network connection: a `predev` /
`prebuild` hook fetches the default plugins at their pinned versions into the gitignored
`plugins/` folder, where the build compiles them in (see [Defaults and
vendoring](#defaults-and-vendoring)). After that it works offline. The same hook reports
what game data is on disk, and warns rather than fails when there is none.

**Game data.** The editor draws with StarCraft's own graphics, which are never committed.
Without them terrain is flat colours and units are markers, and everything else works.
There are two ways to get them into a source build:

- **Help ▸ Game Data… in the running dev editor.** Point it at your StarCraft folder, the
  classic game (1.16) or StarCraft: Remastered. This is the recommended way, and the only
  one for Remastered: the copy goes into the browser's storage, as it does for any user.
- **`npm run extract`** reads `StarDat.mpq` and `BrooDat.mpq` from a classic installation
  (it finds them on its own, or takes `--from <folder>`) and writes the files into
  `public/`. It does not read Remastered's files.

[game-data.md](game-data.md#extracting-for-a-source-build) has the details. No build,
container image or hosted site carries the data or an address to fetch it from;
[ATTRIBUTION.md](../ATTRIBUTION.md) has the terms.

### Dev deep links

Query parameters jump straight to a UI state, which is the fastest way to work on a screen
or take a screenshot:

```
/?nosplash                        skip the splash
/?nosplash&layer=units            select a layer: terrain, doodads, units, sprites, locations, fog, clipboard
/?nosplash&dialog=playerSettings  open a dialog by id; repeatable
/?nosplash&dialog=preferences&page=editing   open a dialog at one of its pages
/?nosplash&zoom=0.5&tileset=ice   zoom level and tileset
/?nosplash&mode=tile              terrain palette mode: isom, rect, tile
/?nosplash&layer=fog&fogPlayer=3  view and paint one player's fog
```

An unknown layer or dialog id is reported in the console with the list of valid ones.
React's "Components" performance track is off in development because it slows mounting
badly; set `VITE_REACT_TRACKS=1` to turn it on when profiling renders.

### With the game engine beside it

Tools ▸ Test Map in Browser, and the replay analysis other plugins use, come from the
[scm-sim plugin](https://github.com/scm-js/plugin-scm-sim). The plugin holds no engine: it
opens the play page, which has to be on the editor's own origin at `/play/`, as it is on
scmjs.dev. The play page is built from the scm-sim engine repository, which is not public,
so without it these features do not work in a local build. With a checkout of it, run both
dev servers and put one origin in front of them:

```sh
SCMJS_BASE=/editor/ npm run dev -- --port 5173   # this repository
npm run dev:web                                   # in scm-sim, port 5174
npm run dev:site                                  # this repository: http://localhost:5180/editor/
```

Both dev servers keep their own hot reload. `DEV_SITE_PORT`, `DEV_SITE_EDITOR` and
`DEV_SITE_SIM` change the three ports.

## Commands

```sh
npm run dev               # Vite dev server
npm run dev:site          # one origin over the editor and scm-sim (above)
npm run build             # tsc -b (the type-check) + vite build → dist/
npm run preview           # serve dist/ locally
npm run lint              # oxlint, with the React hook rules; does not type-check
npm test                  # vitest, a few seconds, no browser
npm run test:watch
npm run test:maps         # write tests/maps again from the code that makes them
npm run test:e2e          # the browser tests, against dist/ (build first)
npx vitest run tests/chk.test.ts      # one file
npx vitest run -t "flood fill"        # tests matching a name
npm run extract           # game data from a classic installation → public/
npm run check:assets      # what game data is on disk
npm run i18n              # check the translations against the source (-- --write updates them)
npm run docs:reference    # rewrite the generated tables of the trigger and CHK references
npm run build:docs        # the documentation site → docs-site/
npm run vendor:plugins    # bring plugins/ up to date (predev and prebuild run it)
npm run bundle:runtimes   # copy the default plugins' runtimes into dist/ (desktop and image builds)
npm run build:plugin-types    # the plugin typings → plugin-api/
npm run desktop           # run the desktop app against dist/
npm run build:desktop     # installers for this OS → release/
npm run build:image       # the container image, tagged scmjs
```

`npm run build` is the type-check: `tsc -b` covers the app, the scripts and the desktop
main process (`tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.desktop.json`). The app
config is strict: `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` (so
`import type` for types) and `erasableSyntaxOnly` (so no enums and no constructor
parameter properties). Lint, the tests and the build run on every pull request and every
push to `main`.

## Repository layout

```
index.html      The editor's page, with the boot splash in plain markup
data.html       The Game Data page, on its own
install.html    The page another page of the site frames to install game data
src/
  atoms/        Jotai state: the open documents and their undo history, UI state, the dialog stack, preferences
  editor/       The edits: invertible change lists per layer, placement checks, settings transactions,
                save planning, validation, find, statistics, the log
  data/         Reference tables (tilesets, players, units, upgrades, techs, trigger definitions) and
                the names read out of the loaded game data
  gamedata/     Where the game files come from: the resolver, the browser's stored copies, extraction,
                the desktop bridge's types, data sets
  formats/
    chk/        The scenario: container reader, section registry, typed section codecs, new maps
    mpq/        .scm/.scx open and save on top of mopaq
    text/       Text encodings of the string table
    tileset/    Tileset decoding, the megatile atlas, the terrain catalogue, palette cycling
    dat/        units/flingy/sprites/images.dat, .tbl, GRP, PCX, .lo and iscript decoders
    units/      Unit tables, lazy sprite loading, the frame cache, team colours, the animator
    triggers/   The text trigger format (TrigEdit syntax)
  i18n/         The translator and the language catalogues (ko.json)
  lib/          Small general-purpose helpers
  pages/        The entry points of data.html and install.html
  plugins/      The plugin API (the contract), host, loader, defaults, registry
  services/     File pickers and saving, image export, the startup preload, Test Map, data-set switching
  hooks/        The React side of the tools, file actions, hotkeys, plugins, updates
  components/
    chrome/     Menu bar, toolbar, status bar, toasts, the debug console
    panels/     Left dock (layers and palettes), right dock (minimap, layers, properties), plugin panels
    viewport/   The map canvas: its draw passes, the drags, the context menu, the corner chips
    dialogs/    Every dialog, and the registry that lazy-loads them
    splash/     The splash screen
    ui/         Primitives: buttons, inputs, lists, tabs, the dialog frame, error boundaries
  styles/       Plain CSS, imported in order: tokens → base → ui → chrome → panels → viewport → dialogs → splash
desktop/        The Electron shell: main process, preload bridge, updater
scripts/        Extraction, vendoring, the desktop and docs builds, plugin typings, screenshots
tests/          vitest suites; tests/maps holds the maps they open, made by tests/support
e2e/            Browser tests: Playwright specs that drive the built editor
docs/           These documents, the release notes, the pictures
docker/         The container image
.claude/        The per-area design notes (internals/)
plugins/        Generated: the default plugins' source at their pinned versions (gitignored)
public/         Generated: the extracted game data (gitignored except its README and the icons)
fixtures/       Blizzard maps and archives used by tests (gitignored)
plugin-api/     Generated: the bundled plugin typings (gitignored)
```

## Conventions

These are the rules everything else follows. The design notes in `.claude/internals/` give
the reasons, and the source comments say more.

**State is Jotai, in one store.** There are no context providers. Persisted settings are
`atomWithStorage` atoms under keys starting with `scmjs.`, listed in Preferences ▸
Storage; each key must be registered in the reset table in
`src/atoms/preferencesAtoms.ts`, and a test fails when one is not.

**The scenario is mutated in place.** The parsed scenario that is written to disk is
changed directly, not replaced, so React does not see an edit on its own. Each area has a
revision counter, bumped after every edit, undo and load, that the viewport and panels
subscribe to. The chrome shows some fields (map name, size, tileset) from a second set of
atoms; change one side and you must change the other.

**Several maps can be open.** The state atoms hold only the map in front; the others are
parked records that a tab switch swaps in. A new piece of per-document state must be added
to the park and install lists in `src/atoms/documentAtoms.ts`, or it leaks from one map
into the next.

**Only changed sections are written.** The scenario keeps the set of sections to re-encode
on save, and everything else goes out byte for byte. Code that changes the scenario must
mark every section it touched, or the change is silently lost on save.

**Edits are invertible change lists.** A brush stroke, a placement or a paste produces a
list of `{ before, after }` changes per layer, applied in one fixed order and reversed for
undo. A stroke is one history entry; the depth is a preference (Preferences ▸ Editing ▸
Undo, 200 by default). The settings dialogs and the trigger editors are OK / Apply /
Cancel transactions, whose history entry is the difference between the tables before and
after. Resize and the tileset change sit outside the undo model and clear it.

**Every write goes through the commits.** The commit, undo and redo paths, the settings
and trigger commits and the whole-document changes are where repainting, history and
shared maps hook in. A new way of changing the scenario that bypasses them is invisible to
the other people on a shared map.

**Dialogs are lazy.** Adding one means an id in `src/components/dialogs/ids.ts` and an
entry in the registry in `DialogHost.tsx`, which loads each dialog module on first use.
Nothing on the startup path may import a dialog module statically, or Vite folds it back
into the main chunk.

**Log what is worth explaining later.** The editor keeps a log of what it did, which users
read in View ▸ Debug Console and copy into bug reports. Log counts and labels, never
payloads, and one line per user action, never per tile or per frame. Chatty lines go
behind the console's *Verbose* tick.

**A render that throws is contained.** Each dock panel, the palette, the map view and
every dialog has an error boundary, with one last boundary around the whole application. A
new top-level surface (a dock, a strip, a floating panel host) needs a boundary of its
own.

**User-visible text goes through `t()`.** See [Translations](#translations).

**Plugins get the same API the editor uses.** `src/plugins/api.ts` is the contract. A
plugin's edit goes through the same transaction and history as a brush stroke. See [The
plugin host](#the-plugin-host).

## The plugin host

[plugins.md](plugins.md) is written for someone who has the npm package and none of this
repository. This is the editor's half: where the plugin system lives and how a plugin gets
from an address to a running `activate`.

| File | Holds |
| --- | --- |
| `src/plugins/api.ts` | The public types: the only place the contract is written |
| `src/plugins/host.ts` | Builds one plugin's API over the store; activation, deactivation, inspect and install |
| `src/plugins/loader.ts` | Spec parsing, the manifest fetch, and the fetch / transpile / import pipeline |
| `src/plugins/defaults.ts` | The plugins a fresh editor starts with, each pinned to a tag |
| `src/plugins/registry.ts` | Browse Plugins: reading, searching and caching the registry indexes |
| `src/plugins/widgets.ts` | `api.ui.widgets`: plain DOM in the editor's own class names, and the waiting kit |
| `src/plugins/claims.ts` | The trigger-list claims the trigger editors read |
| `src/plugins/images.ts` | Image loading, clipboard images, and drops and pastes in plugin dialogs |
| `src/plugins/failures.ts` | The toast a failed activation raises |
| `src/plugins/builtin.ts` | The vendored defaults in `plugins/*/`, compiled in |
| `src/plugins/transpile.worker.ts` | TypeScript in a worker, for a `.ts` plugin loaded from source |
| `src/atoms/pluginAtoms.ts` | The installed list, stored code copies, runtimes, contributions, and the requests the viewport serves |
| `src/hooks/usePlugins.ts` | Activates the enabled plugins at startup and keeps the runtimes in step with the list |
| `src/components/dialogs/PluginDialogs.tsx` | Manage Plugins, Browse, the Add / Update confirmation, a plugin dialog's frame |
| `src/components/panels/PluginPanels.tsx` | The floating and docked frames a plugin's panel mounts into |
| `src/components/ui/DialogSlots.tsx` | The footer row a plugin's dialog slot mounts into |

The chrome reads the contributions: the menu bar merges plugin menu items into its model,
the context menus and status bar add theirs, the right dock renders docked panels after
Properties, and the hotkey hook checks plugin key combinations first. The viewport serves
a plugin's map requests: picks, map tools and overlays.

A plugin's `document.edit` commits one history entry through the same path a brush stroke
takes, and `document.update` commits through the settings and trigger commits.
`document.sections` rewrites the file and reloads it, which drops the history. While a map
is shared, every one of those commits also reaches the session. `plugins-host.md` and
`sync.md` in `.claude/internals/` have the details.

### The loading pipeline

1. The spec is parsed into a base URL. `builtin:<name>` is a plugin compiled in from
   `plugins/<name>/`; a `github:` spec or a github.com URL resolves to
   `raw.githubusercontent.com/owner/repo/<ref or HEAD>/<dir>/`; any other URL is a
   manifest, an entry file (a manifest is made up from its name) or a directory holding
   `plugin.json`.
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

Pressing **Add** in Manage Plugins installs nothing. The editor canonicalises the address,
asks GitHub which commit the ref points at, and reads the `plugin.json` at that commit. No
code is fetched, transpiled or imported before the user agrees. The confirmation opens
only once a manifest came back; an address with nothing behind it is reported under the
Add field instead.

The install has three ticks: *Enable it now*, *Pin to this version* (the stored spec
becomes `github:owner/repo@<sha>`) and *Load from a copy saved here* (below). The
**Update** button on a pinned row previews the branch and, when it holds a different
commit, reopens the same dialog with the old commit marked to be replaced.

A listed plugin that is not running is still described: its manifest alone is fetched for
the name, version, description and icon, and cached so the next visit shows them at once.
Browse Plugins hands a chosen entry to the same Add path, so a registry decides what is
listed and never what is trusted.

### Loading from a copy

*Load from a copy saved here* means "prefer the copy". With no copy yet, the load records
every fetched file into browser storage (up to a size cap; a larger plugin stays remote
with a console warning). With a copy, the load has no network path at all and fails on a
file the copy lacks. Reload drops the copy and fetches again; turning the option off drops
it too.

### Defaults and vendoring

The default plugins are ordinary plugins from their own repositories: Aftermath, Paint,
Repair, scm-sim, scmjs.dev, scmscx.com, Stamp Library, Terrain from Image, TrigEdit,
TrigScript and Walkability. All start on except TrigEdit, which is installed but off. Each
is pinned in `src/plugins/defaults.ts` to a **tag**, never a branch, so a push to a plugin
repository cannot change editors already in use, and any release can be rebuilt as it
shipped. Moving a default forward is a commit that changes the tag there. A plugin's
identity is its repository, whatever the version, so an older unpinned spec, the
compiled-in copy and the pinned default are one plugin, not three.

`scripts/vendor-plugins.mjs` writes each default's source at its tag into the gitignored
`plugins/`, where `builtin.ts` compiles it into the bundle. Every build does this, so a
first visit loads no compiler and makes no third-party requests. The script runs from
`predev`, `prebuild` and the desktop build, fetches only what is not already there at the
pinned version, and uses `GITHUB_TOKEN` when set to stay off the anonymous rate limit. A
directory it wrote carries a `vendored.json`; one you put there by hand is left alone.

```sh
npm run vendor:plugins             # bring plugins/ up to date
npm run vendor:plugins -- --force  # fetch again even where the spec matches
npm run vendor:plugins -- --clean  # remove the directory
npm run vendor:plugins -- --list   # print the pinned specs
SCMJS_SKIP_VENDOR=1 npm run build  # skip it: that bundle fetches its defaults at startup
```

`tests/vendor-plugins.test.ts` pins the script's parsing and the rule that no default may
be unpinned.

### Plugin typings

Plugin repositories compile against `@scm-js/plugin-api`, an npm package holding one
`index.d.ts` bundled from `src/plugins/api.ts`.

```sh
npm run build:plugin-types      # → plugin-api/index.d.ts + package.json (gitignored)
npm run publish:plugin-types    # publish to npm and push to github.com/scm-js/plugin-api
```

The build refuses a bundle that still carries an import, since a file naming `jotai` or
`react` is one a plugin repository cannot compile with alone. The version is the API's,
not the editor's: the major is `PLUGIN_API_VERSION`, the minor moves when the declarations
do, and a build that did not change the contract publishes nothing. The `plugin-api` job
in the Build workflow runs it on every build. The push to `scm-js/plugin-api` uses the
`PLUGIN_API_KEY` deploy key (without it the job reports and carries on), and the npm
publish is behind the `PUBLISH_PLUGIN_API` variable, using npm's trusted publishing with
provenance. `tests/plugin-api-package.test.ts` pins the version rule and the no-imports
rule.

Each plugin repository calls the shared workflow `plugin-ci.yml` in `scm-js/.github`. It
type-checks, tests, rebuilds and commits the plugin's `dist/plugin.js` on the main branch,
and at a tag checks that the committed bundle is what the source builds to.

## Tests

### Unit tests

Tests are `tests/*.test.ts` (and any `src/**/*.test.ts`), run by vitest in Node with no
browser. The whole suite takes a few seconds.

The suites open two sets of map files:

- **`tests/maps/`** is committed: five small `.scx` and `.scm` maps built by
  `tests/support/testMaps.ts` from the editor's own code, with nothing of Blizzard's in
  them. They cover the four file revisions, the three archive compressions, an archive
  without a file list, triggers, a briefing, locations, a sound and unit settings, but no
  terrain. `tests/maps.test.ts` fails when the files and the code that makes them
  disagree: run `npm run test:maps` and commit the result. Only generated maps go here.
- **`fixtures/maps/`** holds Blizzard's own maps, on a machine that has them. The suites
  about terrain, doodads and what StarEdit itself writes need these, the extracted data in
  `public/`, or both, and skip silently when the files are absent. CI has neither, so a
  green CI run has not exercised them. Run them locally before touching a tileset decoder,
  the doodad code, the isometric brush or anything under `src/formats/`.

Two suites are worth knowing about:

- `tests/plugin-network.test.ts` fetches, transpiles and imports the real default plugins
  from GitHub. It runs only with `SCMJS_NETWORK_TESTS=1`; CI runs it in the web build and
  the release pre-flight.
- `tests/docs.test.ts` checks these documents: the split into site pages, every relative
  link and picture, the 90-column wrap, and that the plugin guide names only calls the API
  declares.

### Browser tests

`e2e/*.spec.ts` are Playwright specs that drive the built editor in headless Chromium.
They cover what the unit tests cannot: that the bundle starts, that each dialog's chunk
loads and mounts, and that a change made through the chrome ends up in the saved file.

```sh
npx playwright install chromium       # once
npm run build                         # the specs run against dist/
npm run test:e2e
npx playwright test e2e/save.spec.ts  # one file
npx playwright test --ui              # watch a spec run, step through it
```

`npm run test:e2e` serves `dist/` with `vite preview` on port 4173 and does not build, so
build again after changing the editor. To run against something already being served, the
dev server included, set `SCMJS_E2E_URL` to its address.

Every spec runs under the same conditions, set up in `e2e/support/editor.ts`, so a run on
a machine with game data is the run CI makes:

- **No game data.** Terrain is flat colours, and the editor offers Help ▸ Game Data… soon
  after it starts; a spec that uses the chrome closes that first.
- **No network.** Anything not served by the build under test is refused.
- **No native file pickers.** The editor opens through a file input and saves as a
  download, as in Firefox and Safari.

A test also fails if the page threw or logged an error.

| Spec | Checks |
| --- | --- |
| `boot.spec.ts` | A first visit: splash, editor, the Game Data offer, a blank map drawn |
| `dialogs.spec.ts` | Every dialog opens, in English and Korean |
| `save.spec.ts` | A map renamed and saved; every other section comes back byte for byte |
| `errors.spec.ts` | A dialog whose chunk fails closes with a notice; the editor carries on |
| `dataPage.spec.ts` | The Game Data page on its own |
| `installPage.spec.ts` | The page that installs game data for another page of the site |
| `moveIn.spec.ts` | Settings kept at the old address are brought over on the first visit |
| `pluginUpdates.spec.ts` | Checking all plugins for updates, and Update all |
| `docks.spec.ts` | Dragging a dock's edge over a plugin's map view |
| `rulers.spec.ts` | The rulers line up with the map past the scrollbars |

`dialogs.spec.ts` reads the dialog ids from the registry, so a new dialog is covered
without touching the spec; one that renders nothing without a payload must be added to its
`NEEDS_PAYLOAD` list. A failure leaves a trace under `test-results/`;
`npx playwright show-trace <trace.zip>` replays it. CI runs the specs in the web build and
keeps the report of a failed run.

## Translations

The editor's own words can be shown in another language; a map's text is never translated.
English and Korean ship today, chosen in Preferences ▸ General or following the browser.

- **Writing a string.** The English text is the key: `t("Save {name}", { name })`. The
  argument must be a string literal, since the extractor reads the source. A string kept
  in a table is marked `msg("…")` where it is written and shown with `translate(value)`.
  Never call `t()` at module scope, where the language is not yet known. Where one English
  word means two things, `tc("menu", "Open")` adds a context.
- **Placeholders** are a small subset of ICU MessageFormat: `{name}`, `{n, plural, …}` and
  `{x, select, …}`. Korean particles agree with the word before them through `{name|을}`.
- **The catalogues.** `src/i18n/ko.json` maps the English text to the Korean. After adding
  a string, run `npm run i18n -- --write`, which adds the new key with an empty value
  (shown in English until filled in) and drops keys nothing uses. `tests/i18n.test.ts`
  fails on a missing or unused key, a placeholder mismatch, or a `t()` whose argument is
  not a literal.
- **Reviewing.** `npm run i18n -- --export ko ko.csv` writes the catalogue as a
  spreadsheet with the source files each string appears in; `--import ko ko.csv` reads it
  back. The Korean was not written by a native speaker, and a native reader's review is
  welcome.

Plugins get the same translator on `api.i18n`; see [plugins.md](plugins.md#apii18n).
`.claude/internals/i18n.md` covers adding a language and the Korean particle rules.

## Desktop

`desktop/` is an Electron shell around the same web bundle. `main.ts` serves `dist/` under
`app://scmjs/`, looks for a StarCraft installation and extracts the game data into the
app's data folder, opens maps handed over by the file manager, guards the window's close
while a map has unsaved changes, and holds the updater. `preload.ts` exposes that to the
page as `window.scmjsDesktop`, typed in `src/gamedata/desktop.ts`.

```sh
npm run desktop                 # bundle the main process and run Electron against dist/
SCMJS_DEV_URL=http://localhost:5173 npm run desktop    # against the dev server instead
npm run build:desktop           # web build + main bundle + electron-builder for this OS
```

`npm run build:desktop` takes the platform, architectures and targets on the command line;
with none it builds this OS with the targets `electron-builder.yml` lists, which is what
CI does:

```sh
npm run build:desktop -- win                 # Windows: nsis + zip
npm run build:desktop -- win nsis            # just the installer
npm run build:desktop -- linux AppImage x64 arm64
npm run build:desktop -- mac dmg arm64
npm run build:desktop -- --dir               # unpacked app, no installer: the fast check
npm run build:desktop -- win --skip-web      # repackage the dist/ already on disk
npm run build:desktop -- --skip-plugins      # leave plugins/ alone (no vendoring fetch)
```

Platforms are `win`, `mac` and `linux`; architectures `x64`, `ia32`, `arm64`, `armv7l` and
`universal`; any electron-builder target name (`nsis`, `dmg`, `zip`, `AppImage`, `deb`, …)
applies to every platform named. `--skip-web` and `--skip-main` reuse the bundles on disk;
`--publish <mode>` and anything after a bare `--` go to electron-builder unchanged. The
script warns about cross-builds that need tooling the machine may lack (a macOS installer
off a Mac, an NSIS installer without Wine) and runs them anyway; `--dir` and `zip`
cross-build with nothing installed. Output lands in `release/`.

**What ships.** `electron-builder.yml` packs `dist/` and `desktop/dist/` only: never
`node_modules` (Vite bundles everything) and never the game data a developer's `public/`
may hold. Windows gets an NSIS installer and a zip, macOS a dmg per architecture, Linux an
AppImage and a `.deb`. The installers register `.scm`, `.scx` and `.chk`. Of Chromium's
own UI locales only those of the editor's languages are included (`en-US` and `ko`): the
editor's translations are in the bundle, but Chromium reports the system's language to the
page only when its locale is there. A new language needs its locale added to
`electronLanguages`. Builds are unsigned: Windows shows SmartScreen's "unrecognized app"
screen, and macOS refuses the app until the user clears the quarantine attribute.

**What the build adds.** `THIRD-PARTY-NOTICES.txt` in `dist/` carries the licence of every
runtime dependency and compiled-in plugin, generated from `package.json`. The desktop
build and the container image also carry the runtimes the default plugins would otherwise
download on first use (none of today's defaults declares one; eudplib's Pyodide and wheel,
about 15 MB, did), so such a plugin needs no network there.
`scripts/bundle-plugin-runtimes.mjs` reads a `runtime.json` from each pinned default's
repository and puts the files in `dist/plugin-runtime/<plugin>/<version>/`. The hosted
editor and the web zip carry none.

**The app's data folder** is `%APPDATA%\scm-js` on Windows, `~/.config/scm-js` on Linux
and `~/Library/Application Support/scm-js` on macOS. It holds the extracted game data, the
window geometry, and `startup.log`, the milestones of the last launch. `SCMJS_TRACE=1`
echoes them to the terminal. When a launch "hangs and then opens", that log tells a slow
disk, a virus scanner and a slow first paint apart.

**From WSL**, copy a Windows build to the Windows file system before running it. Started
from `\\wsl.localhost\…`, a network share, it takes minutes to open. `WSLENV` passes the
variable on to the Windows process:

```sh
npm run build:desktop -- win --dir          # release/win-unpacked
cp -r release/win-unpacked /mnt/c/Users/<you>/scmjs-test
SCMJS_TRACE=1 WSLENV=SCMJS_TRACE /mnt/c/Users/<you>/scmjs-test/scmJS.exe
```

### In-app updates

The desktop app checks GitHub releases at startup (a preference, on by default) and
through Help ▸ Check for Updates…, using electron-updater over the `latest*.yml` files the
release workflow uploads beside the installers. Finding one raises a toast with a Download
button; nothing downloads or installs unasked, and installing goes through the same
unsaved-changes check as closing the window. A nightly build follows the nightlies, a
stable build follows stable releases, and a preference lets a stable install follow the
nightlies.

Windows, the AppImage and the `.deb` install updates themselves. macOS can see an update
but not install it until the app is code-signed, so it offers the release page. A
development run and an unpacked Linux folder report that they cannot check.
`desktop/updater.ts` is the main-process side, `src/editor/updates.ts` the state machine,
`tests/updates.test.ts` the cases.

## Releases and hosting

`.github/workflows/build.yml` has three channels:

| Channel | Trigger | What it produces |
| --- | --- | --- |
| `ci` | every push to `main` and every pull request | Lint, the unit and browser tests, and a web bundle that is thrown away |
| `nightly` | a daily cron at 07:17 UTC, or a manual run | Installers, a web zip and the updater files on one rolling prerelease, and `scmjs.dev/nightly` |
| `stable` | a pushed `vX.Y.Z` tag | A permanent release, the container image, `scmjs.dev/editor` and the docs site |

The nightly cron exits early when `main` has not moved since the last nightly. The nightly
release is updated in place: its `nightly` tag is moved and its assets replaced, so there
is one prerelease however many nights run. Its notes link `scmjs.dev/nightly`, which runs
the same commit.

### Download links

GitHub redirects `/releases/latest/download/<asset>` to the newest release that is not a
prerelease or a draft, so the download buttons on the site are plain links that never need
updating and never resolve to a nightly:

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

The redirect can only resolve a fixed file name, so asset names carry no version; the
version is in the release title, the notes and `latest*.yml`. To withdraw a bad release,
tick "This is a pre-release" on it and the redirect falls back to the one before.

### The container image

`docker/Dockerfile` is nginx with the built web bundle and the default plugins' runtimes,
pushed to `ghcr.io/scm-js/scm-js` on a tagged release only, as `latest`, the full version,
and the moving `X.Y` and `X`. One manifest covers `linux/amd64` and `linux/arm64`.

```sh
docker run --rm -p 8080:80 ghcr.io/scm-js/scm-js:latest   # http://localhost:8080
npm run build:image                                       # build it locally, tagged scmjs
```

The image carries no game data: `.dockerignore` keeps the extracted trees out and
`docker/nginx.conf` answers 404 for those paths, so a container asks through Help ▸ Game
Data… like the hosted editor. Mounting an extracted tree is in
[game-data.md](game-data.md#the-container-image).

### Cutting a release

Run the **Release** workflow (`.github/workflows/release.yml`) from the Actions tab. It
takes the version (`0.3`, `1.0` and `1` are padded to three parts; blank releases the
version the nightlies have been building), an optional `notes` box, and a `dry_run` tick
that does everything except push.

It refuses to run anywhere but `main`, refuses a version whose tag exists or that is not
newer than the last release, and runs lint, the tests (the network suite included), the
build and a check of the container image before writing anything. Then it commits the
version into `package.json` and the lock file, tags that commit `vX.Y.Z`, and starts the
Build workflow on the tag, which produces everything else.

Nothing moves `package.json` on to a next version afterwards: on `main` it names the last
release. A nightly is named `<base>-nightly.<date>.<run number>`, where the base is a
patch bump of the newest release tag (`scripts/next-version.mjs`). Every job writes the
version into `package.json` before building; Vite injects it as `__APP_VERSION__`, read
through `src/version.ts`, and electron-builder writes it into `latest*.yml`.

The hand-written part of a release's notes comes from `docs/releases/<version>.md` (the
full three-part name), committed to `main` before the release is cut, or from the Release
workflow's `notes` input, which wins over the file. Either goes above GitHub's generated
list of commits. The pre-flight prints what it found, so a dry run shows the body.
`docs/releases/README.md` is the convention.

### The hosted builds

| Address | Deployed | How |
| --- | --- | --- |
| `scmjs.dev/editor` | on a tag, by the `pages` job | GitHub Pages on this repository, built for `/editor/`, served by the site's Cloudflare Worker |
| `scmjs.dev/nightly` | each nightly, by the `nightly-site` job | The same commit built again for `/nightly/`, pushed to `scm-js/nightly`, served by the same Worker |
| `docs.scmjs.dev` | on a tag, by the `docs` job, or by hand | `npm run build:docs`, pushed to `scm-js/docs` |

The hosted editor is one release with everything else: the site, the installers, the image
and the notes come from one tag. To put `scmjs.dev/editor` back on an older version, run
Build on that tag. The docs site can also be deployed without a release, from Actions ▸
Docs site ▸ Run workflow, so a fix to the guides goes live at once; the next release
replaces it with the tag's own pages.

The nightly is built with `SCMJS_SITE=nightly`. The two editors share the `scmjs.dev`
origin, because both need the game's page at `/play/` beside them, and the nightly keeps
its preferences, recent files and plugins under names of its own. The game data is the
exception: both editors and the play page read one copy, so a nightly that changes how
that copy is stored must keep it readable by the last release.

### Variables and secrets

None of these is required: a fork builds and releases without them, and a deploy that
lacks its own is skipped with a notice.

| Name | Kind | For |
| --- | --- | --- |
| `PAGES_BASE` | variable | The hosted editor's base path (`/editor/`); the repository name by default |
| `NIGHTLY_BASE` | variable | The nightly's path on the site (`/nightly/`); without it the nightly site is the web zip at a domain's root |
| `NIGHTLY_HOME` | variable | The site the nightly is a path of; `https://scmjs.dev` by default |
| `NIGHTLY_DOMAIN` | variable | The domain written into the nightly site's `CNAME` |
| `NIGHTLY_PAT` | secret | A token with Contents: write on `<owner>/nightly` |
| `DOCS_DOMAIN`, `DOCS_PAT` | variable, secret | The same pair for the docs site on `<owner>/docs` |
| `CI_BUILD_KEY` | secret | A deploy key on this repository, so the Release workflow can push its commit to a protected `main` |
| `PLUGIN_API_KEY` | secret | A deploy key on `scm-js/plugin-api`, for pushing the plugin typings |
| `PUBLISH_PLUGIN_API` | variable | Turns on the npm publish of `@scm-js/plugin-api` |

The two deploy keys must be listed as bypass actors in the target repository's branch
ruleset.

## Docs site and screenshots

[docs.scmjs.dev](https://docs.scmjs.dev) is built by `npm run build:docs`. The guides are
the nine `docs/*.md` files, split at their `##` headings into pages, with the `###`
beneath as each page's contents. The API reference is generated from the bundled plugin
typings, so a doc comment in `src/plugins/api.ts` is a paragraph on the site.

```sh
npm run build:docs                            # → docs-site/ (gitignored)
python3 -m http.server 8000 -d docs-site      # preview it at http://localhost:8000
node scripts/wrap-docs.mjs                    # rewrap the guides' prose at 90 columns
node scripts/wrap-docs.mjs docs/guide.md      # one file
npm run docs:reference                        # the generated tables in triggers.md and chk-format.md
```

The guides are read on GitHub as well. The site turns a relative link to one of the guides
into a link to its page, and anything else in the repository into a link to GitHub. Prose
is wrapped at 90 columns; `tests/docs.test.ts` fails on an unwrapped file, and
`scripts/wrap-docs.mjs` fixes it, leaving code, tables, headings and generated blocks
alone. The `<!-- generated: … -->` blocks in the trigger and CHK references are written
from the code by `npm run docs:reference`; never edit inside them.

### Guide screenshots

The pictures in the guides are `docs/images/*.webp`, made by
`scripts/guide-screenshots.mjs`. It drives headless Chromium against the dev server, opens
the fixture maps, sets up what each picture shows, and writes WebP files. Re-run it after
a change to the chrome and commit the pictures that changed.

```sh
npm run dev                                   # in one terminal
npm i --no-save playwright sharp              # only this script needs them
npx playwright install chromium               # once
node scripts/guide-screenshots.mjs            # → docs/images/
node scripts/guide-screenshots.mjs --only units,fog
node scripts/guide-screenshots.mjs --scenes plugin-guide
```

It needs the game data and Big Game Hunters, Binary Burghs, Crescent Moon and Ground Zero
from the game's Maps folder in `fixtures/maps/`. Never commit a picture that shows
anything but the editor.

Some scenes have their own needs:

- **`plugin-guide`** needs no fixture map. Each picture is one of the examples in
  `docs/plugins.md`, run in the API Playground; changing an example that has a picture
  means re-running the scene.
- **`api-playground`** installs the API Playground plugin, which is not a default;
  `--playground <url>` points it at a local build.
- **The scmjs.dev and shared-map pictures** run against a stand-in for the service,
  `scripts/lib/guide-scmjs-mock.mjs`, which the script starts itself. When a dialog
  changes, change the scene; when a canned answer no longer fits, change the mock.

## Contributing

- **Keep the documents current.** The nine guides under `docs/` are the documentation site
  and `README.md` is the repository's front page; a behaviour change that is not in them
  is undocumented. Write them for their readers, with `src/` paths only in a guide's
  closing *In the source* section. Keep the matching note in `.claude/internals/` in step
  too.
- **Nothing of Blizzard's goes into git.** Not the extracted data, not the archives, not
  the fixture maps. `.gitignore` covers the generated trees; check before adding a test
  fixture.
- **Record where adapted code comes from.** The rule is in
  [ATTRIBUTION.md](../ATTRIBUTION.md#maintenance-rule): a provenance comment beside
  adapted algorithms and tables, an entry there naming the source and licence, and the
  original notice kept.
- **Run what CI runs**: `npm run lint`, `npm test` and `npm run build`, and
  `npm run test:e2e` after a change to the chrome. With the game data and fixture maps on
  disk the real-data suites run too, and that is the run that counts for anything under
  `src/formats/`.
- **Plugin API changes are additive.** `PLUGIN_API_VERSION` stays where it is for an
  addition. Document the addition in `docs/plugins.md` and with a doc comment in
  `src/plugins/api.ts`, which the reference is generated from. The example plugin at
  [scm-js/plugin-hello-world](https://github.com/scm-js/plugin-hello-world) should keep
  building.
- **The plugins are separate repositories** under
  [github.com/scm-js](https://github.com/scm-js). A change to the editor that a default
  plugin needs ships by moving that plugin's tag in `src/plugins/defaults.ts`.
