# Plugins

scmJS can load third-party code — a *plugin* — from a public Git repository or any
URL, and let it add menu items, context-menu entries, hotkeys and dialogs, read the
open map and edit it through the same undo model the built-in tools use. This document
is the plugin author's guide and the reference for the host side. Two plugins are the
worked examples for everything below, each in its own repository:
**Terrain from Image** ([scm-js/plugin-image-to-terrain](https://github.com/scm-js/plugin-image-to-terrain),
installed by default), a dialog, a pick on the map and a terrain transaction; and **Paint**
([scm-js/plugin-paint](https://github.com/scm-js/plugin-paint), also a default), a floating
panel, a tool that owns the pointer and draws its own preview, and transactions on every
layer; **Walkability** (a default) and **Melee Wizard** (installed from Browse Plugins) are
the read-only analysis drawn over the map and the placement wizard, described
at the end. All are
fetched over the network and transpiled in the browser like anybody else's, which is the
point: the plugins that ship with the editor are the proof the loading path works, not
exceptions to it.

## Design

### Goals

- A plugin is one small TypeScript (or JavaScript) file in a public repo. No build step,
  no npm, no bundler: point the editor at the repo and it runs.
- Plugins never touch scenario internals. Every edit is a *transaction* that becomes one
  undo entry, marks the right sections dirty and lifts stranded doodads and units — the
  same path a brush stroke takes.
- Every contribution is a `Disposable`. Disabling or reloading a plugin removes
  everything it added, whether or not the plugin cleaned up after itself.
- The API is versioned (`PLUGIN_API_VERSION`) and typed: `npm run build:plugin-types`
  rolls the contract into one `index.d.ts`, published as
  [`@scm-js/plugin-api`](https://www.npmjs.com/package/@scm-js/plugin-api), which a plugin
  repository takes as a devDependency (`npm i -D @scm-js/plugin-api`) instead of carrying a
  copy of the editor's emitted tree. A manifest's
  `"api": N` is the version the plugin needs; a host providing an older one refuses to load it.
  The version is 1 and stays there while the only plugins are the ones in the scm-js
  organisation, which move with the editor; the first change that would break a plugin
  written by somebody else bumps it.

### Non-goals (version 1)

- **No sandbox.** A plugin runs in the page with the page's privileges: it can read the
  open map, the archive extras and the editor's localStorage, and it can make network
  requests. That is the same trust as a browser extension. Adding one therefore goes
  through a confirmation screen that says so (see *Adding one*, below), pins remote
  plugins to the ref you gave, and never auto-updates. An iframe sandbox is possible later; it would cost the UI contributions.
- **No React for plugins.** A plugin dialog gets a DOM element to fill (`mount(el)`).
  Sharing the host's React would need import maps and version coupling; a plugin that
  wants a framework can bundle its own into that element.
- **No package imports.** `import x from "some-npm-package"` is refused at load time.
  Relative imports between files in the plugin repo work, with or without a file
  extension (the loader fetches them and resolves the extension itself). A plugin that
  needs a library ships a prebuilt bundle and points `plugin.json` at it.

### How a plugin loads

1. The *spec* the user typed is parsed (`loader.ts#parseSpec`):
   - `builtin:<name>` — a plugin compiled into the editor from `plugins/<name>/`.
     Nothing ships that way today; the mechanism is there for a fork that wants one in
     the bundle.
   - `github:owner/repo`, `github:owner/repo@ref`, `github:owner/repo@ref/sub/dir`,
     or a `https://github.com/owner/repo[/tree/ref[/sub/dir]]` URL — resolved to
     `https://raw.githubusercontent.com/owner/repo/<ref or HEAD>/<dir>/`.
   - Any other URL: `…/plugin.json` is a manifest, `…/x.ts` / `.js` / `.mjs` / `.tsx` is an
     entry file (a manifest is synthesised from its name), anything else is a directory
     holding `plugin.json`. `http://localhost:…` works, which is how you develop one.
2. The manifest is fetched and validated (`PluginManifest`; only `name` is required).
3. The file to import is the manifest's **`build`** when it has one, else its `entry`. A
   `build` is a JavaScript bundle the repository publishes (`dist/plugin.js`), and taking
   it ends the story here: one fetch, no compiler, no import graph, and the plugin may use
   npm dependencies, which the source path below cannot resolve. `entry` stays in the
   manifest either way, because it is what a person reads and what loads for a repository
   that publishes no build.
4. The entry file is fetched **as text** and, if it is TypeScript, transpiled in the
   transpile worker (`ts.transpileModule`; TypeScript is in the editor's bundle for this
   alone). Fetching as text matters: `raw.githubusercontent.com` serves
   `text/plain`, which a browser refuses to `import()` as a module.
5. Relative imports are followed the same way, depth first, and each file becomes a
   `blob:` module URL; the import specifiers are rewritten to those URLs. There is no
   resolver behind a `fetch`, so the loader supplies one (`candidateUrls`): a specifier
   that names no extension — `"./convert"`, how TypeScript is normally written — is
   tried as `.ts`, `.tsx`, `.mts`, `.js`, `.mjs` and then as that directory's `index.*`,
   and a `"./convert.js"` falls back to `convert.ts` the way a TypeScript project means
   it. Circular imports and bare package names are errors with a message that says which
   file.
6. The file is `import()`ed. Its default export (or a named `activate`) is called with
   the `PluginApi`. Whatever it returns — nothing, a function, or a `Disposable` — is kept
   for deactivation.

Installed plugins live in localStorage (`scmjs.plugins`: spec + enabled flag) and are
activated at startup by `usePlugins`. The *default* plugins (`src/plugins/defaults.ts`)
are merged over that list, so they are always shown and can be turned on or off but not
removed; each says whether it starts on (scmscx.com, Repair, Walkability, Terrain from
Image and Paint are the defaults today, and all five start on). Being a default buys
a plugin nothing else — it is fetched and loaded by the steps above like any other.

Each default names a **tag**, not a branch: `github:scm-js/plugin-repair@v1.0.1`. A moving
spec meant a push to a plugin repository changed every editor already in use and no
released version could be rebuilt as it shipped, so moving a default forward is now a
commit in `defaults.ts` that goes out with the next release.

Two things follow from the pin. Every build runs `scripts/vendor-plugins.mjs` first
(`prebuild`, and `scripts/build-desktop.mjs` for its own bundle), which writes each
default's own source at that tag into `plugins/` for `builtin.ts` to glob, so the defaults
are **compiled in rather than fetched** — the same code, since the version is fixed. It is
worth more than it sounds: a `.ts` plugin has to be transpiled before the browser will
import it, one transpile starts the compile worker, and TypeScript is inlined into that
worker, so five remote `.ts` defaults put 3.4 MB (975 KB gzipped) of compiler on the cold
path. Measured on the production build, a first visit went from 1235 KB gzipped to 344 KB.
It is all or nothing — one remote `.ts` default starts the worker and costs the lot — and
the fetching path is still there for a build that skips the vendoring
(`SCMJS_SKIP_VENDOR=1`) and for every plugin the user adds.

And a plugin is now identified by `pluginKey(spec)` (the repository, whatever version
follows it, with a bundled copy answering for the spec it was built from) rather than by
the spec string, which is what keeps `effectiveInstalls` from listing — and running — the
same plugin twice across those forms.

Compiling the defaults in costs the one thing worth naming: the remote loading path used
to be exercised by simply opening the editor, on every machine, every day.
`tests/plugin-network.test.ts` is the deliberate replacement — a real plugin fetched,
transpiled and imported over the network — off unless `SCMJS_NETWORK_TESTS=1`, and run by
CI on the job that vendors and by the release pre-flight.

An activation that fails is no longer silent: `plugins/failures.ts` turns whatever the pass
left in `pluginRuntimesAtom` into one toast naming what did not load, with a button to
Manage Plugins. `activatePlugin` returns the load in flight for a spec that is already
loading, so a caller can await the pass and see the result.

### Browsing a registry

Plugins ▸ **Browse Plugins…** is the same dialog as Manage Plugins with the Browse tab
open. What it lists comes from *registries*: one JSON file per registry, holding an entry
per plugin — the spec to install, and the fields that plugin's own `plugin.json` carries,
so a whole list is shown from one request rather than one manifest fetch per row. The
project's own is `github.com/scm-js/registry`, generated from the organisation itself —
every repository named `plugin-…` or wearing the `scmjs` and `plugin` topics, described by
the `plugin.json` at its newest version tag (an untagged one falls back to its default
branch) — hourly, and within about a minute of a plugin repository saying it changed;
`DEFAULT_REGISTRIES` in `defaults.ts` names it and the user can add more under **Sources**
(`userRegistriesAtom`).

Listing is therefore automatic, and carries no judgement at all: a registry decides what
is *offered*, never what is trusted. There is no review mark, and installing from a Browse
row goes through the same confirmation as an address pasted by hand — which says the one
thing that is always true, that there is no sandbox and an installed plugin runs with the
editor's own privileges.

`plugins/registry.ts` is the whole host side and is pure apart from the fetching:

| | |
| --- | --- |
| `parseRegistry(raw, url)` | Checks the file's shape, canonicalises each entry's spec (`canonicalSpec(parseSpec(...))`, so rows match the installed list), drops entries it cannot use and counts them in `skipped`. One bad row never empties a list. |
| `entryIcon(entry)` | `resolveIcon` against the *plugin's* base, so a manifest's `icon: "icon.svg"` can be copied into the index verbatim. |
| `searchRegistry(entries, query)` | Every word has to match something; name beats tag beats description beats author beats spec. |
| `groupByInstall(entries, stateOf)` | Splits the results into what the editor does not have and what it already lists (turned off counts as installed), each group keeping its order — the Browse pane's grouping and its filter counts. |
| `mergeRegistries(list)` | Entries of every registry, the first to list a spec winning. |
| `loadRegistry(store, url, opts)` | Fetch into `registryCacheAtom` unless the cached copy is younger than `REGISTRY_MAX_AGE` (an hour) or `force` was asked for. A failure records `registryStateAtom` and **keeps** the cached list — the browser shows the last list it had rather than emptying itself because the network blinked. |
| `addRegistry` / `removeRegistry` | The user's list; a default cannot be removed. |

Almost everything a registry lists is a plugin the editor already has — the defaults are
published from the same repositories — so a flat list of rows reads as a copy of the
Installed tab. The pane splits it instead: `groupByInstall` over the search results, the
group that can be installed first under its own heading, and a filter (All / Not installed
/ Installed) carrying the count of each. A row says which it is by an accent down its left
edge, by the one action that fits it (**Install**, **Turn on**, or **Manage**, which
switches to the Installed tab and flashes the row) and by a line naming the state in
words.

An entry is not a way in. Install hands the entry's `spec` to the same
`inspectPlugin` → `ConfirmPluginDialog` → `installPlugin` path a pasted address takes, so
the manifest is read from the plugin itself, the commit is resolved and pinned at install
time (not taken from the index), and the same warning is shown. A registry decides what is
*listed*, never what is trusted — there is no sandbox either way.

Getting a plugin listed is a pull request against `plugins.json` in that repository; the
index's `README.md` has the shape of an entry. Nothing about it is privileged: any URL
serving a file of that shape is a registry, which is how a fork points the editor at its
own plugins without changing any code.

### Adding one

Pressing **Add** in Manage Plugins does not install anything. `previewPlugin` canonicalises
the spec, asks GitHub which commit the spec's ref points at (`resolveCommit`, the public
commits API, one request and no token), and reads the `plugin.json` at that commit through
steps 1–2 above and no further (`resolvePlugin(..., { entry: false })`). No entry file is
fetched, nothing is transpiled and nothing is imported.

The confirmation opens only if that found a manifest. An address that answers with no
plugin behind it is reported under the Add field, and the preview travels to the dialog in
its payload rather than being fetched again.

`ConfirmPluginDialog` shows what came back: the manifest's name, version, author,
description and icon, links to the repository (`PluginSource.webUrl`, which `parseSpec`
derives for a GitHub spec) and homepage, the addresses for the version being installed
(`addressesOf`), and the warning that a plugin has the editor's own access and no sandbox.
The entry is named only when the manifest names one; probing for `plugin.ts` / `plugin.js`
would mean fetching code, which has not been agreed to yet.

Three ticks are read straight into `installPlugin`:

| Tick | Default | Effect |
| --- | --- | --- |
| Enable it now | on | `activatePlugin` after the install; off just lists it. |
| Pin to this version | on, when a commit resolved | Stores `github:owner/repo@<sha>` (`PluginPreview.pin`) instead of the moving spec. `isPinned` recognises one. |
| Load from a copy saved here | off | Stores `PluginInstall.local`; see below. |

The addresses on screen follow the pin tick, since pinning changes which commit every one
of them names. A spec that carries a ref already (`@v1.2`) is resolved the same way: the
pin names the commit that tag points at today.

Reload re-fetches whatever the spec names, so for a pinned plugin it re-fetches the same
commit. Moving to a newer one is the **Update** button on the row: it previews
`unpin(spec)`, and when the branch now holds a different commit it opens this same dialog
with `replaces` set. The install goes through `installPlugin` again with the old spec named,
which deactivates it, drops it from the list and drops its stored copy, because the two
commits are different specs as far as everything else here is concerned. The ticks start
from the old install's own settings.

A manifest that could not be fetched or parsed (`PluginPreview.problem`) stops the add:
the Manage Plugins field says so, with the address that refused underneath, and if the
dialog is reached with one anyway it says the same and disables Add. An unusable *spec*
fails earlier still, before anything is fetched. A manifest asking for a newer `api` than
the host provides is flagged on the dialog (`needsApi`) rather than only failing on load,
and `pinProblem` says why there is no pin (not a GitHub plugin, or GitHub did not answer).

### Loading from a copy in the browser

`PluginInstall.local` means "prefer the copy". `loadDepsFor` in `host.ts` decides what one
activation uses:

- no copy yet: the ordinary deps wrapped in `recordingDeps`, which keeps every fetched
  file. `storeSnapshot` writes them to `pluginCodeAtom` (`scmjs.plugin-code`, keyed by
  spec) when the load succeeds. A snapshot over `MAX_SNAPSHOT` is skipped with a console
  warning and the plugin stays remote.
- a copy: `storedDeps`, which answers out of the snapshot and has no network path at all.
  A URL the snapshot does not hold is an error naming it, so a plugin that grew a file
  since the copy was made says so instead of quietly fetching it. `describePlugin` uses the
  copy too, so the plugin's address is never touched while the option is on.

`PluginRuntime.loadedFrom` records which of the two happened, and the Manage Plugins row
badges it. `reloadPlugin` drops the copy first, so Reload is how both a pinned plugin and a
stored one are moved forward. Turning the option off (`setInstalled`, the row's disk
button) drops the copy as well: turning it on again fetches the plugin rather than reviving
something months old.

A plugin that is listed but **not running** — one you turned off, a default included — is
still described in Manage Plugins: `describePlugin` does step 1–2 only
(`resolvePlugin(..., { entry: false })`), so the name, version, description and icon come
out of one `plugin.json` fetch with no code fetched and nothing executed. The dialog asks
for that the first time it shows a row it has no manifest for, and the answer is kept in
`scmjs.plugin-manifests`, so the next visit renders from storage while the refresh runs
behind it. A description that cannot be fetched changes nothing: the plugin is *off*, not
failed.

## Writing a plugin

`plugin.json`:

```json
{
  "name": "Hello",
  "version": "1.0.0",
  "description": "Says hello from the Tools menu.",
  "entry": "plugin.ts",
  "build": "dist/plugin.js",
  "icon": "icon.svg",
  "api": 1
}
```

`name` is the only required field; `id` (a slug for storage keys and log prefixes) is
derived from the name when absent, and `entry` defaults to `plugin.ts`, then `plugin.js`.

`build` names a JavaScript bundle to load in place of `entry` — see **Building** below.
Leave it out and the editor fetches your source and transpiles it, which is the shortest
way to start.

### The icon

`icon` is the plugin's face in Manage Plugins and in the title bar of every dialog
`api.ui.dialog` opens. Four forms are understood:

| `icon` | What it means |
| --- | --- |
| `"icon.svg"`, `"art/mark.png"` | An image file beside the manifest (`.png .svg .jpg .gif .webp .avif .ico`). |
| `"https://…/mark.png"` | An image anywhere; it is fetched by the browser when the dialog shows. |
| `"data:image/svg+xml,…"` | An image inline in the manifest — nothing extra to fetch. |
| `"🗺️"` | Up to four characters, drawn as text: an emoji is the cheapest icon there is. |

Anything else — another URL scheme, a longer string — is ignored, and the plugin shows
the editor's default plugin mark, as it does when it declares no icon at all or the
image fails to load. Draw for a 30 px square (it is also shown at 14 px in a dialog
title), on nothing: the editor draws no frame or plate behind it, and an icon that is
itself a bordered square reads as a second control next to the row's tick box.
Terrain from Image's `icon.svg` is the worked example.

`plugin.ts`:

```ts
import type { PluginApi } from "@scm-js/plugin-api";

export default function activate(api: PluginApi) {
  api.menu.add("Tools", {
    label: "Say Hello",
    enabled: () => api.document.isOpen(),
    run: () => api.ui.status(`Hello, ${api.document.info()?.name}!`),
  });
}
```

The `import type` line is erased before the file runs, so the package only matters for
editing and checking:

```sh
npm i -D @scm-js/plugin-api
```

One generated `index.d.ts` — the whole contract, no imports of its own, nothing to
configure. **The major is `PLUGIN_API_VERSION`**, so `"^1"` is the range to write and it
is honest: the minor moves whenever the declarations change, and a break would move the
major and `PLUGIN_API_VERSION` together. `npm outdated` and `npm update` then say what you
would expect. The same two files are committed and tagged at
[`scm-js/plugin-api`](https://github.com/scm-js/plugin-api) if you would rather read them
there or depend on a git ref.

It is a *type* dependency: the loader never sees the specifier, which is why a bare
package name here does not break the rule that a plugin's runtime code cannot import
packages.

Everything `add`/`on` returns is a `Disposable`; keep the ones you need to drop early
and forget the rest — deactivation disposes them all. Returning a function from
`activate` runs it at deactivation too, for anything outside the API (timers, sockets).

To develop: serve the folder (`npx serve --cors .`), add `http://localhost:3000/`
in Tools ▸ Plugins ▸ Manage Plugins…, and press **Reload** after each change.

### Building

A plugin can ship a built bundle and name it in the manifest's `build`. It is worth doing
for anything bigger than a single file: the editor fetches one JavaScript file and imports
it, instead of fetching your source, starting the TypeScript compiler in a worker and
walking your imports one file at a time — and only a built plugin can use an npm
dependency, since the source path has no resolver behind its `fetch`.

The organisation's plugins all do it the same way, with one esbuild call in a `build`
script:

```json
"build": "esbuild plugin.ts --bundle --format=esm --target=es2022 --platform=browser --outfile=dist/plugin.js",
"dev": "npm run build -- --watch"
```

and `dist/plugin.js` is committed, because the editor loads it straight from the
repository at whatever ref the spec names. The shared workflow in
[`scm-js/.github`](https://github.com/scm-js/.github) does the rest — a plugin repository
calls it in six lines:

```yaml
name: CI
on:
  push: { branches: [main], tags: ["v*"] }
  pull_request:
  schedule: [{ cron: "0 6 * * 1" }]
permissions: { contents: write }
jobs:
  ci:
    uses: scm-js/.github/.github/workflows/plugin-ci.yml@main
```

It type-checks, tests, rebuilds the bundle and commits it on a push to `main`; at a `v*`
tag it rebuilds and *checks* instead, so the bundle a pinned plugin runs is provably what
its source builds to (esbuild's output is deterministic, and the bundle carries no commit
hash or date for that reason). The scheduled run type-checks against the newest
`@scm-js/plugin-api`, so a contract that moved under the plugin turns a check red rather
than going unnoticed.

The bundle is not minified. What the confirmation dialog offers to show a user is the
repository, and a plugin they cannot read is a plugin they cannot judge.

## API reference

The complete typings are in `src/plugins/api.ts`; this is the tour. Every method that
reads the map returns `null` / `[]` / `false` when no map is open rather than throwing.

### Promises, and the one thing that is synchronous

**Everything asynchronous is a promise.** There is no completion callback and no
`(err, result)` anywhere in the API: `await` it and read the answer, or check it for
`null`. That covers opening, saving, exporting and rendering a map
(`document.open` / `create` / `save` / `saveAs` / `close` / `export` / `renderImage` /
`changeTileset`), loading game data (`tileset.load`, `data.load`, `graphics.load`,
`terrain.checkIsom`), and everything that waits for the user (`ui.pickArea`, `pickTile`,
`pickFiles`, `saveFile`, `loadImage`, `readClipboardImage`, `confirm`, `alert`, `prompt`,
`ask`). A user who dismisses something resolves the promise with `null` or `false`
rather than rejecting, so the ordinary path needs no `try`:

```ts
const rect = await api.ui.pickArea({ prompt: "Pick an area to flatten" });
if (!rect) return;                       // Esc, a right-click, or no map
await api.tileset.load();                // the graphics the fill needs
api.document.edit("Flatten", tx => tx.stampTerrain(rect, terrainId));
```

`activate` itself may be `async` — the host awaits it before the plugin counts as
loaded — and so may a dialog button's `run`, which keeps the dialog open until it
settles and closes it on anything but `false`.

The callbacks that remain are the ones that are genuinely callbacks rather than a
deferred answer: event listeners (`api.on(…)`), the DOM handlers of `ui.widgets`, a
dialog's or panel's `mount`, and the pointer and `draw` hooks of `ui.mapTool` and
`ui.overlay`. Every one of them returns a `Disposable` or a cleanup function, so there
is no `off()` to pair up and nothing to unregister at deactivation.

The **one** exception is a transaction's builder. `document.edit(label, build)` and
`document.update(label, build)` take a **synchronous** `build`: its operations apply as
they are called and the commit closes the transaction the moment it returns. An `async`
builder would therefore commit whatever ran before its first `await` and let the rest
mutate the map outside that entry, where undo cannot reach it. TypeScript refuses one,
and the host also catches it at runtime — the result's `notes` and the console say so —
for a plugin written in plain JavaScript.

```ts
// Wrong: commits at the await, and the placement lands outside the undo entry.
api.document.edit("Place", async tx => {
  await api.data.load();
  tx.placeUnit(0, 0, 128, 128);
});

// Right: await first, then write in one go.
await api.data.load();
api.document.edit("Place", tx => tx.placeUnit(0, 0, 128, 128));
```

Long work of your own gets a progress panel that does not block the editor;
`handle.cancelled()` is the poll and `handle.signal` the same answer as an
`AbortSignal`, so anything that takes one stops with the panel:

```ts
const job = api.ui.progress("Converting", { cancellable: true });
try {
  for (let i = 0; i < steps; i++) {
    if (job.cancelled()) break;
    job.report(i / steps, `Row ${i}`);
    const data = await fetch(url, { signal: job.signal });
  }
} finally {
  job.done();
}
```

### The three kinds of write

Everything a plugin can change about the open map goes through one of three, and they
differ in what they cost:

| | what it covers | undo |
| --- | --- | --- |
| `document.edit(label, build)` | terrain and objects — tiles, ISOM, units, sprites, doodads, locations, fog | one history entry, like a brush stroke |
| `document.update(label, build)` | the tables and settings — triggers, briefing, the string table, switch names, the scenario's name and description, players, forces and colours, unit / upgrade / technology settings, sounds, the map revision | none: a settings-dialog transaction, as in StarEdit |
| `document.sections.*` | the file's own bytes, any section, modelled or not | none, and the history is dropped (as Resize) |

They are the editor's own three: a stroke, a dialog's OK, and a raw file edit. Both
transactions apply their operations **as they are called**, so later ones see earlier
ones' results, and both commit once at the end — which is why the builder is
synchronous (above).

### `api.document`

| | |
| --- | --- |
| `isOpen()` | Whether a scenario is loaded. |
| `info()` | `{ name, description, width, height, tileset, era, version, fileName, modified }`. |
| `scenario()` | The live `Scenario` object, for **reading**. Mutating it directly bypasses undo and dirty tracking. |
| `edit(label, build)` | Run `build(tx)` and record what it did as one undo entry named `label`. Returns an `EditResult` with counts per list. |
| `update(label, build)` | The tables and settings, as one settings-style transaction — triggers, strings, switch names, the scenario's properties, and everything the Scenario menu's dialogs write (see `UpdateTransaction`). Not in the undo model. Returns an `UpdateResult`. |
| `undo()` / `redo()` | The Edit menu's. |
| `history()` | `{ undo, redo, undoDepth, redoDepth }`: the labels the Edit menu shows and how deep each stack is, without moving anything — so a plugin can tell whether its own edit is still the top entry before undoing it. |
| `open(file, fileName?)` | Open a map file (`File`, `Blob` or bytes; `.scx` / `.scm` / `.chk`) in place of the current one, the way File ▸ Open does. A modified map goes through the Close Scenario dialog first when Preferences say to ask. Resolves `true` once the file is the open document, `false` when the user kept the current map or the file could not be read (the status bar says which). |
| `create({ width, height, tileset, name?, description?, terrainId?, startLocations?, startLayout? })` | A blank map in place of the current one, the way File ▸ New makes one — flat ground of the tileset's default terrain (or `terrainId`), an ISOM lattice to match, every section a fresh map needs — through the same unsaved-changes gate as `open`. `startLocations` lays one down for each of players 1..N as `tx.placeStartLocations` would (`"ring"` unless `startLayout` says `"corners"`); they are part of making the map, so a fresh scenario has no history to undo them from. Resolves true once the new map is the open document, false when the user kept the current one. |
| `export({ format?, fileName?, saveOptions? })` | The open map as a `File`, as Save writes it — the save options last confirmed for this map (or their defaults: PKWARE and encryption for a new map, the way it was opened for an opened one), archive extras included — `scx` / `scm` / a bare `chk`; `saveOptions` overrides compression, encryption and what is left out. Null with no map. Hand it to a `FormData` and it uploads. |
| `save({ copy? })` / `saveAs({ copy? })` | File ▸ Save and Save As. `save` writes back where the map came from with its remembered options — into the file when the browser gave a handle, else through the browser's save dialog or as a download — and a map with no file yet goes through the Save dialog; `saveAs` always opens it; `copy` writes a copy and leaves the document's name and clean state alone. Resolve true once written, false when the user dismissed a dialog or the write failed. |
| `close()` | File ▸ Close, through the same unsaved-changes gate as `open`; true once the map is gone. |
| `changeTileset({ tileset, terrainId?, keepTiles? })` | Map Properties' tileset change: ERA moves and the terrain is laid again with `terrainId` (the new tileset's default when omitted) after the new graphics load, the doodads go, everything else stays; `keepTiles` changes only ERA. A transaction outside the undo model that drops both history stacks, like `resize`. |
| `renderImage({ pixelsPerTile?, … })` | A PNG `Blob` of the map as File ▸ Export ▸ Image draws it; 32 pixels per tile is the game's art, 1 is a minimap. Needs the tileset graphics (null without them or without a map). |
| `resize({ width, height, anchor?, terrainId?, clampLocations? })` | Scenario ▸ Resize / Crop Map: content keeps its place relative to the anchor (a 3 × 3 grid, 4 = centre), the new ground is `terrainId` or the tileset's default, objects outside the new bounds are dropped and locations clamped. A transaction outside the undo model that **drops both history stacks**, as the dialog does. Returns the `ResizeResult` (what was dropped), null with no map. |
| `extras` | The files stored in the archive next to `staredit\scenario.chk` — custom sounds, and anything a plugin wants to keep with the map: `list()`, `get(name)`, `set(name, bytes)`, `remove(name)`. Names are archive paths with backslashes; keep yours under a folder of your own (`my-plugin\notes.json`). `set` / `remove` mark the map modified; the members are written on the next Save. |
| `sections` | The scenario at the byte level — see the next section. |

### `api.document.sections`

The CHK as a list of sections, the way the game reads it and Save writes it, with unsaved
edits already encoded: `list()` gives every occurrence in file order as a `SectionInfo`
(`index`, the four-character `name`, `offset`, `size`, `declaredSize` / `truncated` for a
file that ended early, `occurrence` / `occurrences` for a repeated name, `dirty` when the
editor holds changes it will encode there, and `spec` — what the registry knows: `what`,
the combine `mode` on repeat, the fixed `size` the game reads for this map or null, the
record `stride` of a list, and `modelled`, whether the editor decodes it). `bytes(index)`
is a copy of one occurrence's payload, `combined(name)` the bytes the game acts on with
repeats folded the way the registry says, `file()` the whole CHK, `spec(name)` / `known()`
the registry.

The writes — `write(index, bytes)`, `rename(index, name)`, `insert(index, name, bytes)`,
`remove(index)`, `move(from, to)` and `replaceFile(bytes)` — are a different kind of
transaction from `edit`: the edited file is parsed again from scratch and installed as
the open document (`replaceScenarioAtom`), so the change reaches every part of the editor
whether or not it models the section, and, as with Resize, the undo history is dropped
and every selection cleared. The map is marked modified and `"document"` fires. Each
returns `{ warnings }`, what the parser said of the result; a bad index or a name longer
than four characters throws, and so does any write without a map. Indices shift when a
section is inserted or removed before them, so take a fresh `list()` after every edit.
Section Explorer is the worked example.

Around them, what a repair needs: `trailing()` is the bytes after the last chunk the
reader could act on (what follows a header with a negative length, say — Save writes
them back as they are; a `replaceFile` without them drops them), `required()` the names
a file of the open map's revision must carry to load, as Check Map tests them (`STRx` in
place of `STR ` on a Remastered file), `defaults(name)` the bytes File ▸ New would write
for a section on a map of this size, tileset and revision (StarEdit's defaults for a
settings table, the fixed VCOD, an empty list, null terrain; null for a name the editor
cannot produce), and `rebuild(names?)` re-encodes sections from the editor's model the
way Save writes a dirty one and installs the result like any other raw edit — repeated
occurrences collapse into one, a truncated or oversized section comes back at the size
the model encodes to, a string table whose offsets point nowhere is rewritten with every
string the editor could read. Names the editor does not model, and modelled ones whose
model is absent (no ISOM, no settings table), are left alone and missing from the
result's `rebuilt`; omit `names` for every modelled section the map has a model for.
Repair is the worked example for these.

### `EditTransaction`

`tx` applies each operation immediately, so a later operation sees the state the
previous one left (a `tileAt` after a `setTile` reads the new tile). When `build`
returns, the transaction lifts doodads the terrain edit broke, removes units the new
ground cannot hold (when *Remove stranded units* is on, as for a stroke), commits, and
repaints.

| Terrain | |
| --- | --- |
| `tileAt(x, y)` / `groundAt(x, y)` | MTXM / TILE at a cell. |
| `setTile(x, y, id)` | One tile, both sections. |
| `setTiles(cells, id)` | Many; `cells` is a `Rect` or cell indices (`y * width + x`). |
| `stampTerrain(cells, terrainId, variation?)` | The Rect brush: flat pairs by column parity, one random variation per pair. Needs the tileset graphics. Returns tiles changed. |
| `fillFlat(rect, terrainId)` | Lay terrain the way a new map is laid, ISOM lattice included. |
| `rebuildIsom()` | Reconstruct the ISOM from the tiles — for a map that arrived without one, or whose lattice no longer matches after Rect / Tile edits: exact for terrain laid down isometrically, a best guess under doodads and for hand-placed tiles. A missing or wrongly sized ISOM is created (undo removes it again); an existing one gets only the diamonds that differ. Needs the tileset graphics; null without them, else `{ created, changed, diamonds, unresolved }`. |
| `paintIsom(diamond, terrainId, extent = 1)` | The isometric brush on one diamond: sets the ISOM and generates the cliff/shore tiles around it. Needs ISOM and the tileset. |
| `tilesFromIsom()` | The reverse of `rebuildIsom`: every tile regenerated from the lattice, what StarEdit does after an isometric edit. Needs ISOM and the tileset; tiles changed, or null. |
| `replaceTerrain(from, to, rect?)` | Tools ▸ Replace Terrain: every tile matching `from` — `{ kind: "terrain", id }` for a flat terrain by ISOM id, `{ kind: "tile", id }` for one exact tile — becomes `to`, over `rect` or the whole map, pairs laid as the Rect brush lays them. Returns tiles changed. |
| `fillArea(x, y, { terrainId } \| { tileId }, match?)` | The bucket fill: the connected area of the same terrain type (`"terrain"`, the Rect fill's reading — needs the graphics) or the same exact tile (`"tile"`), mirrored under the symmetry mode, laid with a terrain or set to a tile. |
| `placeBlend(x, y, side, id)` | The Blend brush: `id` on the cell beside the anchor on `side`; `terrain.blendCandidates` says what fits. |
| `mirror(cells)` / `mirrorPoint(px, py)` | The cells' (or the pixel's) images under Tools ▸ Symmetry, the way the built-in brushes and palettes take them. |

| Objects | |
| --- | --- |
| `makeUnit(unitId, owner, x, y)` | A StarEdit-style record (serial, masks) at map pixels. |
| `addUnits(records)` / `removeUnits(indices)` / `updateUnits(indices, patch)` | |
| `moveUnits(indices, dx, dy, snap?)` | Shift by a pixel delta. With `snap` (the palette's option by default) the *destination* is snapped — a building to the tile grid by its placement box, anything else to the nearest tile centre — so a unit that sits off the grid is brought onto it. |
| `placeStartLocations({ players, layout?, margin?, replace? })` | Tools ▸ Auto-place Start Locations: one per player (from 1) on a `"ring"` or in the `"corners"`, each moved to the nearest spot the placement checks accept; `replace` removes the existing ones first. Returns `{ changes, placed, removed }`, `placed` null for a player nothing within reach fit. |
| `placeUnit(unitId, owner, x, y)` | A unit the way the Units palette places one: with its *Snap to grid* on, a building's placement box goes on the tile grid and anything else on the nearest tile centre; nothing leaves the map. Returns the index. No checks — |
| `canPlaceUnit(unitId, x, y)` | — ask this first if you want them: the palette's collision and terrain checks with its current options. |
| `makeSprite(kind, id, owner, x, y, opts?)` / `addSprites` / `removeSprites` / `placeSprite(...)` | `placeSprite` is make + add, kept on the map; returns the index. |
| `updateSprites(indices, patch)` / `moveSprites(indices, dx, dy)` | Owner, flags, position — in place, so indices hold. |
| `placeDoodad(doodadId, tx, ty, owner)` / `removeDoodads(indices)` / `updateDoodads(indices, { owner?, disabled? })` | Doodads stamp MTXM and may carry an overlay sprite; all three keep the tiles, the record and the overlay together. |
| `addLocation(bounds, name?, elevationFlags?)` / `editLocation(index, patch)` / `removeLocations(indices)` | Slot 63 (Anywhere) and unused slots are refused by `editLocation`; `addLocation` also puts Anywhere back if it was missing. |
| `restoreAnywhere()` | Anywhere back to the whole map; true when it had to move. |
| `setFog(cells, players, "fog" \| "clear")` | `players` is a bit mask; creates MASK on first use. |
| `invertFog(players)` / `copyFog(from, toMask)` / `floodFog(x, y, player, players, mode)` | The Fog palette's other three: flip the bits, copy one player's fog onto the players in a mask, fill the connected area that shares one player's state. |
| `note(text)` | A line for the status bar, alongside the label. |

### `UpdateTransaction`

The second kind of write. Operations apply immediately — a string interned on one line is
in the table for the trigger added on the next — and the commit at the end marks the map
modified and tells the chrome to re-read. The result is
`{ changed, sections, notes }`: which CHK sections were actually touched (`["TRIG", "STR "]`),
so `changed` is false when every operation was a no-op.

| Triggers | |
| --- | --- |
| `tx.triggers` | TRIG as a list: `list()`, `count()`, `set(list)`, `add(trigger, at?)`, `replace(index, trigger)`, `remove(indices)`, `move(from, to)`, `fromText(source, { replace? })`. |
| `tx.briefing` | MBRF, the same shape. |

| Tables | |
| --- | --- |
| `tx.strings` | `list()`, `intern(text)` (an identical entry, else a new one; **never** overwrites, because the old index may be shared with a trigger), `set(index, text)` (overwrite one slot — everything pointing at it sees the new text; slot 0 is refused), `apply(list)` (a whole table; unreferenced trailing blanks are dropped, every other index keeps its place), `import(text)` (File ▸ Import ▸ Strings' `index<TAB>text` form, see `api.exchange`). |
| `tx.switches` | `names()` (256, `""` where a switch has none) and `setName(index, name)`; creates SWNM on the first name. |
| `tx.properties({ name?, description? })` | SPRP. `""` restores the file-name default. |
| `tx.note(text)` | A line for the status bar. |

| Settings | |
| --- | --- |
| `tx.players` | `list()` — the 12 slots as `PlayerSlotView`s (0-based `slot`, `type` / `typeName`, `race` / `raceName`, and for the eight playable slots `color` (COLR index), `colorHex`, `rgb` (the CRGB custom colour in effect, else null), `force` (0-based) / `forceName`) — and `set(slot, { type?, race?, color?, rgb?, force? })`. `rgb: [r, g, b]` sets a Remastered custom colour, `rgb: null` puts the slot back on its palette colour; CRGB is dropped again when every slot is. OWNR is always written with IOWN. |
| `tx.forces` | `list()` — four `ForceView`s (`name`, `flags` and the `allied` / `alliedVictory` / `sharedVision` / `randomStart` booleans, `players`: the 0-based slots in the force) — and `set(force, { name?, allied?, alliedVictory?, sharedVision?, randomStart?, flags?, players? })`; `players` moves those slots into the force. |
| `tx.unitTypes` | `get(unitId)` — a `UnitTypeView` with the *effective* numbers (units.dat's where the type is on "use default"; hit points in whole points), the type's weapons with their effective damage, `defaults` (the dat's numbers, null without the game data) and `availability` (PUNI: `defaultAvailable` and per player `true` / `false` / `"default"`) — and `set(unitId, patch)`. Setting any number turns "use default" off for the type and seeds its untouched columns from the dat, as the dialog does; `useDefault: true` puts it back; `name` is the custom name (`""` restores the default, the string is interned); `weapons: [{ id, damage?, bonus? }]`; `available: [{ player: 0-based or "default", value: true / false / "default" }]`. Which of UNIS / UNIx is written follows the file's revision. |
| `tx.upgrades` | `get(upgradeId)` — an `UpgradeView` (effective costs and factors, `defaults`, `levels`: the default start and cap and each player's effective `{ start, max, usesDefault }`) — and `set(upgradeId, { useDefault?, mineralCost?, mineralFactor?, gasCost?, gasFactor?, timeCost?, timeFactor?, levels? })` with `levels: [{ player: 0-based or "default", start?, max?, useDefault? }]`. |
| `tx.techs` | `get(techId)` — a `TechView` (effective costs, `defaults`, `state`: the default column and each player's effective `{ available, researched, usesDefault }`) — and `set(techId, { useDefault?, mineralCost?, gasCost?, researchTime?, energyCost?, state? })` with `state: [{ player, available?, researched?, useDefault? }]`. |
| `tx.sounds` | `list()` — the WAV slots in use as `SoundRow`s (`slot`, `path`, `present`, `size`, `usedBy`) — `add(path, bytes?)` (the first free slot, or the slot the path already has; with `bytes` the file goes into the archive under `staredit\wav\`) and `remove(slot, deleteFile?)`. |
| `tx.cuwp` | Triggers ▸ Unit Properties Slots: `list()` / `get(index)` — `CuwpSlotView`s (0-based `index`; `hitPointsPercent`, `shieldsPercent`, `energyPercent`, `resources`, `hangar` as numbers or null where the created units keep the type's default; `cloaked` … `invincible` as booleans or null; `used`, `references`, `summary`) — `set(index, patch, used?)` (a number sets the field and its "applied" bit, null clears it; a boolean forces a state, null leaves it) and `clear(index)`. The *Create Unit with Properties* action stores the slot 1-based in `target`. |
| `tx.setVersion(version, extendedStrings?)` | Scenario ▸ Map Revision: `"original"`, `"hybrid"`, `"broodwar"` or `"remastered"` — VER and TYPE, and the string table's width (STR ↔ STRx) when moving to or from Remastered. |

Ids are the game's: units.dat ids for `unitTypes`, upgrades.dat / techdata.dat ids for
the other two (`api.names.units()` / `upgrades()` / `techs()` list them with their
names). Players are 0-based here, as in the records; the chrome shows `slot + 1`.

```js
api.document.update("Add a countdown", (tx) => {
  const text = tx.strings.intern("30 seconds remaining");
  const trigger = api.triggers.newTrigger();
  trigger.conditions[0] = api.triggers.newCondition(ConditionType.Countdown);
  const say = api.triggers.newAction(ActionType.DisplayText);
  say.text = text;
  trigger.actions[0] = say;
  tx.triggers.add(trigger);
});
```

There is no undo entry, so a plugin that wants one keeps its own copy of what it replaced
(`api.triggers.list()` before, `tx.triggers.set(...)` to put it back).

### `api.settings`

The same views without a transaction, for reading: `players()` / `player(slot)`,
`forces()`, `unitType(id)` / `unitTypes()` (every type with a name), `upgrade(id)` /
`upgrades()`, `tech(id)` / `techs()`, `sounds()`, `unitAvailable(player, unitId)` (PUNI
resolved against its default), `cuwpSlots()` / `cuwpSlot(index)`, `version()`
(`{ version, label, fileVersion, type, extendedStrings, extension }`). Empty lists and
nulls with no map. Writing goes through `document.update`.

### `api.triggers`

Reading triggers, and everything needed to *show* one. Writing is `document.update`.

| | |
| --- | --- |
| `list()` / `briefing()` | TRIG / MBRF, cloned. A record is 16 conditions and 64 actions of plain numbers — the editor's codec knows no types. |
| `defs` | What each type means: `conditions()`, `condition(type)`, `actions(briefing?)`, `action(type, briefing?)`. Each def carries `args`, the argument list in the order StarEdit's TrigEdit shows it, each `{ kind, field, label }` — which record field holds it and what kind of value it is. This is the table the editor's own trigger dialogs and the text printer read; a plugin that wants to render an editable trigger reads the same one. |
| `defs.choices(kind)` / `choiceLabel(kind, value)` / `choiceValue(kind, text)` | The values an enumerated argument can take (comparisons, switch states, resource types, orders …), with their labels and aliases. |
| `text.print(list, { briefing? })` / `text.one(trigger)` / `text.parse(source)` | The text trigger format, resolved against the open map's names. `parse` throws a `TriggerTextError` carrying the line. |
| `names()` | The `TriggerNames` context those use: the map's locations, units, switches and strings, by name and by number. |
| `newTrigger(players?)` / `newCondition(type)` / `newAction(type, briefing?)` | Blank records with StarEdit's defaults. |
| `isPreserved(t)` / `setPreserved(t, on)` | The preserve-trigger flag. |
| `triggersFor(list, groups)` | Indices of the triggers any of those player groups own. |
| `summarize(t, briefing?)` | The three lines the trigger list shows: players, conditions, actions. |
| `comment(t)` | A trigger's `Comment` action text, if it has one. |
| `switchNames()` / `switchUsage()` | SWNM, and how many conditions and actions mention each switch. |
| `claim(spec)` | Tell the editor that a run of the trigger list is *generated* by this plugin. The Trigger Editor badges those rows (`spec.badge`, the plugin's id by default), locks them and shows `spec.describe(index, list)` with a button that calls `spec.open(index, list)` (`spec.openLabel`, `Open <plugin name>` by default) in place of the form; the Text Trigger Editor fences them in comments; Import Triggers says what a replace would remove. The run is found by content: `spec.locate(list)` is asked with whatever list an editor holds — the map's, or a working copy with local inserts in it — and answers `{ start, count }` or null when the records are not there (edited by hand, or gone), so keep a hash of what you generated and look for it, as the Trigger Script plugin does. `spec.label` is the words a sentence uses (`"the trigger script"`). The handle has `refresh()` (after a rebuild, so editors ask `locate` again) and `remove()`; the claim leaves with the plugin. |

**Generating triggers.** There is no fluent builder here on purpose: `tx.triggers.fromText`
already is one, and it is a better one. A record is 16 conditions and 64 actions of bare numbers,
so building one field by field means knowing which field each argument lives in
(`defs.action(type).args` will tell you, but you have to ask); writing the trigger in the
text format instead means writing what the map maker would read in the Text Trigger
Editor, and getting the names resolved against the open map for free.

```ts
const source = `
Trigger("Player 1"){
Conditions:
  Bring("Current Player", "Any unit", "Beacon Alpha", At least, 1);
Actions:
  Display Text Message(Always Display, "You found it!");
  Preserve Trigger();
}`;
api.document.update("Add the beacon trigger", (tx) => {
  tx.triggers.fromText(source);      // throws with the line number when it does not parse
});
```

`fromText` is the whole of it — it parses, interns the strings the text names, resolves
`"Beacon Alpha"` against the map's own locations, and appends (or replaces the list with
`{ replace: true }`). `triggers.text.parse` is the same parse without the write, for a
plugin that wants the records first; `text.print` goes back the other way, so a plugin can
read what it wrote. Reach for `newTrigger` / `newCondition` / `newAction` when you are
editing one field of an existing record, not when you are producing a run of them.

### `api.query`

Reading the open map: what is where, and the analyses the editor already does. Nothing
here writes, and everything answers empty without a map.

| | |
| --- | --- |
| `unitAt(px, py)` / `spriteAt(px, py)` / `doodadAt(tx, ty)` / `locationAt(px, py)` | The topmost thing under a point, or -1 — the same hit-testing the layers use (a sprite's box comes from its loaded GRP, a unit's from units.dat). `locationAt` never picks Anywhere. |
| `unitsIn(rect)` / `spritesIn(rect)` / `locationsIn(rect)` | Units and sprites whose centre is in a tile rect; locations wholly inside it. |
| `unitsOf(owner)` | Every unit a player owns (0-based). |
| `startLocations()` | `{ index, owner, x, y, tx, ty }` per start location, by player. |
| `placement(unitId, x, y)` | The Units palette's verdict: `{ problem: "terrain" \| "collision" \| null, blocker, reason }` — `reason` is the problem in words ("the ground is unwalkable", "it overlaps Terran Marine"), null when it fits. Null with no map. |
| `fogAt(tx, ty)` | The MASK bits at a tile (bit n = player n + 1 starts fogged; every bit when the map has no MASK). |
| `strings()` | The string table as it stands. |
| `validate()` | Check Map's `Issue[]` — `{ level, text, where, target? }`, and `target` is what `view.goTo` takes. |
| `statistics()` | Tools ▸ Statistics: tile, terrain, unit, resource and per-player counts, the briefing's too. |
| `find(options)` | The Ctrl+F search: `{ kind: "units" \| "locations" \| "sprites" \| "doodads" \| "strings" \| "triggers" \| "briefing", query, matchCase?, limit? }` → `{ kind, index, label, detail, x?, y? }[]`. |
| `stringUsage()` / `unusedStrings()` | Which records refer to each string index, and which slots nothing refers to. |

A linter plugin is `validate()` plus `find()` plus `view.goTo` and nothing else.

### `api.view`

Where the viewport is looking. A plugin that finds something needs this to show the user
where it is.

| | |
| --- | --- |
| `zoom()` / `setZoom(z)` | Clamped to 0.05…8 (the zoom control's own steps run 0.25…4). |
| `visible()` | The tiles on screen, as a `Rect`. |
| `center(x, y)` | Scroll so a tile is in the middle. |
| `goTo(target)` | `{ kind: "tile", x, y }`, or `{ kind: "unit" \| "sprite" \| "location", index }` — scrolls there and selects the object. An `Issue.target` from `query.validate()` is one of these. |
| `cursorTile()` | The tile under the pointer, as the status bar shows it. |
| `flags()` / `setFlags(patch)` | The View menu's ticks: `grid`, `locations`, `locationNames`, `units`, `sprites`, `doodads`, `fog`, `elevation`, `buildability`, `startLocations`, `animateWater`, `animateUnits`. |
| `gridSize()` / `setGridSize(8 \| 16 \| 32 \| 64 \| 128)` | Grid spacing in map pixels. |

### `api.data`

The game's own tables as the editor decoded them — `units.dat` and its neighbours — for
the numbers `api.names` only labels: hit points, costs, build times, armour, weapons,
flags, the sprite and image each unit draws through. `ready()`, `load()`, then `units()`,
`weapons()`, `upgrades()`, `techs()`, `sprites()`, `flingy()`, `images()`, plus
`race(unitId)` and `imagePath(imageId)`. Everything is null until the tables are loaded,
and stays null when the game data was never extracted — degrade, do not throw.

### `api.consts`

The numbers a record is *written* in, so a plugin does not carry the hex itself. These are
the editor's own tables (`sections/objects.ts`, `editor/units.ts`), handed over at run time.

| | |
| --- | --- |
| `tile` | 32 — map pixels to a tile. UNIT and THG2 store pixels; MTXM, MRGN and the brushes count tiles. |
| `unit.startLocation` | 214, the Start Location marker. |
| `unit.mineralFields` / `unit.vespeneGeyser` | `[176, 177, 178]` and 188. `isResource(unitId)` is either. |
| `unit.defaultMinerals` / `unit.defaultGas` | 1500 and 5000, what StarEdit writes on a fresh resource. |
| `unit.valid` / `unit.used` / `unit.state` / `unit.relation` | The four UNIT bit masks: `validProperties` (which special-property fields the game reads), `validStates` (which of the record's fields are set at all), `stateFlags` (the properties themselves), `relationType` (`NydusLink`, `Addon`). |
| `sprite.flags` | THG2's `PureSprite` / `Flipped` / `Disabled`. `PureSprite` is the one that decides whether `spriteId` is a sprites.dat id the game only draws, or a units.dat id it creates the unit for. |
| `location.anywhere` | 63. That slot is Anywhere and the editor protects it everywhere — no builder returns it, `locationAt` never picks it, the viewport draws no box for it. `tx.restoreAnywhere()` is what puts it back. |
| `location.elevation` | `elevationFlags`. A **set** bit *excludes* that elevation, so 0 means everywhere. |

Why this is on `api` and not in the npm package: `@scm-js/plugin-api` is types only, and
`import type` is erased before the loader sees the specifier — which is exactly what lets
a plugin depend on a package at all. A *value* imported from it type-checks and is then
undefined at run time. Anything you need while the plugin runs has to arrive on `api`.

### `api.graphics`

The pictures the viewport draws, for a plugin's own lists and previews. Nothing is
rendered anew: a unit or sprite frame comes out of the same cache the viewport blits
from, so listing five hundred units costs about what the Units palette costs.

| | |
| --- | --- |
| `ready()` / `load()` | `{ tileset, units }` — whether the graphics and the tables are in memory, and a fetch for both. |
| `unitImage(unitId, { owner? })` | A `{ image, width, height }` canvas in the player's colours, in the unit's editor pose. |
| `spriteImage(kind, id, { owner?, flipped? })` | The same for a THG2 sprite. |
| `tileImage(tileId)` | One 32 × 32 megatile of the open map's tileset. |
| `doodadImage(doodadId)` | A doodad drawn from the tiles it stamps. |
| `renderRect(rect, options?)` | Part of the map as File ▸ Export ▸ Image draws it, cropped to a tile rect, as a PNG `Blob`. `pixelsPerTile` defaults to 8 here. |
| `playerColor(owner)` | `#rrggbb`. |
| `requestUnit(id)` / `requestSprite(kind, id)` / `onImageLoaded(fn)` | GRPs load lazily, so the first `unitImage` for a type is often null: ask for it, redraw on `onImageLoaded`, and the list fills in. |

### `api.commands`

Named things a plugin can do, so a menu item, a hotkey, a context entry and another
plugin all reach the same one.

```js
api.commands.register({ id: "convert", title: "Convert Image…", run: () => open() });
api.menu.add("Tools", { label: "Convert Image…", command: "convert" });
api.hotkeys.add("Ctrl+Shift+I", { command: "convert" });
```

`register(spec)` returns a `Disposable`; `run(id, ...args)` runs one, whoever registered
it (`undefined` when there is no such command or its `enabled()` says no); `has(id)` and
`list()` (`{ id, title, pluginId, enabled }[]`) see every plugin's. An id without a dot is
namespaced under the plugin (`"convert"` → `"image-to-terrain.convert"`); one with a dot
is taken as it is, so a plugin can publish a stable name for others to call.

### `api.terrain`

Read-only helpers over the current tileset: `types()` (paintable flat terrains with
name, group, height, buildable), `isomTypes()` (ids the isometric brush can paint),
`hasIsom()`, `tileInfo(id)`; `terrainAt(tx, ty)` — the terrain id (as `types()` lists them) a tile belongs to: its own group when it is flat ground, else what the ISOM lattice says there (under a cliff, one of the two terrains it joins), null when neither tells, `color(tileId)` (the atlas average, `0xRRGGBB`),
`terrainColor(terrainId)` (mean of the pair's common variations), `heightOf(terrainId)`
(0 low / 1 high / 2 higher, null for anything that is not a flat terrain), `diamondAt(px, py)`,
`isDiamond(d)`, `diamondsIn(rect)` (every lattice diamond whose centre tile is in the
rect), `floodRegion(x, y, match?)` (the bucket fill's area, by terrain type or exact
tile), `blendCandidates(anchorTileId, side, options?)` (the Blend palette's ranked list,
with the pixel distance of each seam), `flatGroupOf(terrainId)` (the even CV5 group of a
flat pair), `active()` / `setActive(...)` for the palette's brush, terrain, tile, size and
Rect variation, and the symmetry mode: `symmetry()` / `setSymmetry(mode)` (`"none"`,
`"h"`, `"v"`, `"hv"`, `"rot180"`, `"rot90"`, `"diag"`, `"adiag"`),
`symmetryAvailable(mode)` (the last three need a square map), `mirror(cells)` and
`mirrorPoint(px, py)` — the images the built-in brushes paint and the palettes place on,
so a plugin edit can honour the user's setting the way `tx.fillArea` does by itself.
`checkIsom()` is asynchronous: it waits for the tileset graphics (rejecting when they are
missing) and resolves with how well the ISOM describes the tiles — `rects` measured,
`mismatched` among them, `stale` when the share is past what the palette warns at — or
null when the map has no ISOM or no map is open.

### `api.tileset`

`id()`, `name()`, `isLoaded()`, `load()` (resolves `false` when the graphics were never
extracted — that is a normal state, degrade), `raw()` for the decoded `LoadedTileset`.

### `api.selection`

`markedArea()` / `markArea(rect | null)` — the Cut / Copy / Paste layer's marked
rectangle, the editor's one "region" concept; `units()`, `sprites()`, `doodads()`,
`locations()` (indices, copied — sort yours freely) with matching setters; `layer()` /
`setLayer()`; `lockedLayers()` / `setLayerLocked(layer, on)` for the Layers panel's
padlocks (a locked layer's tools refuse to change the map).

### `api.clipboard`

The Cut / Copy / Paste layer, sharing the user's own clip: `clip()` / `setClip(clip |
null)`; `copy(source?)` and `cut(source?)`, where `source` is `{ rect }` for a tile rect
or `{ units?, sprites?, doodads?, locations? }` for objects by index — omitted, they take
what Ctrl+C would: the object layer's selection, else the marked area — with the parts
ticked in `parts()`; `paste(tx, ty, { parts?, mode? })`, the clip's top-left at a tile, one
undo step, the pasted area marked afterwards, returning the `PasteResult` (counts per
list, notes for what was skipped); `parts()` / `setParts(patch)`, `mode()` / `setMode("merge"
| "replace")`, `pasting()` / `setPasting(on)` (arm the layer so the next click stamps),
and `summary(clip)`. A `Clip` is self-contained — it outlives the map it came from and
pastes into another, with terrain and doodads refused across tilesets.

### `api.exchange`

The file formats behind File ▸ Import / Export: `encodeTrg(triggers)` / `decodeTrg(bytes)`
for SCMDraft's raw `.trg` (2400-byte records; string indices are the map's own), and
`formatStrings()` / `parseStrings(text)` for the `index<TAB>text` strings file (control
bytes as `<XX>`), which `tx.strings.import` applies.

### `api.palette`

What the Units, Sprites, Doodads and Fog of War palettes have picked, and what they list —
so a plugin can paint "whatever the user chose" without a picker of its own (Paint does
exactly this: switch layers and its brush follows). The Terrain palette's pick is
`terrain.active()`.

| | |
| --- | --- |
| `active()` / `setActive({...})` | A `PaletteChoice`: `unit` and `owner` (0-based; 0 is Player 1), `spriteKind` with `sprite` / `unitSprite`, `spriteFlipped` / `spriteDisabled`, `doodad` (-1 before one was picked), `fogPlayers` (a bit mask, bit n = player n + 1), `fogMode` and `fogViewPlayer` (whose fog the viewport draws). |
| `placementOptions()` / `setPlacementOptions(patch)` | The Units palette's rules — `checkCollision`, `checkTerrain`, `snapToGrid`, `removeStranded` — which govern `placeUnit`, `canPlaceUnit`, `query.placement` and whether an edit removes stranded units. Remembered in the browser (`scmjs.placement`), so a change outlives the session. |
| `doodadPlacement()` / `setDoodadPlacement(patch)` | The Doodads palette's `placeAnywhere` and `snapToGrid` (the two-tile isometric grid, never View ▸ Grid Settings' spacing). Remembered in the browser (`scmjs.doodadPlacement`). |
| `locationSnap()` / `setLocationSnap(step)` | The Locations layer's snap step in pixels (0 off, 8, 16, 32, 64). |
| `playerColor(owner)` | The colour a player's units are shown in, `#rrggbb` — Remastered custom colours included. |
| `unitGroups()` / `unitName(id)` / `unitSize(id)` | The Units palette's grouping, StarEdit's names, and a type's placement box in pixels with `building` / `flyer` flags (a one-tile box without the unit tables). |
| `spriteGroups()` / `spriteName(kind, id)` | The Sprites palette's groups (empty until the unit tables are loaded) and names. |
| `doodadCategories()` / `doodadInfo(id)` | The open map's doodads by category, each with its footprint in tiles (empty without the tileset graphics). |

### `api.names`

The names behind the numbers a map stores, so a plugin that shows raw values need not
carry the game's tables: `unit(id)` / `units()` (StarEdit's names, plus *Any unit*, *Men*,
*Buildings*, *Factories* for the trigger classes 228–231), `upgrade` / `upgrades`, `tech`
/ `techs`, `weapon` / `weapons`, `playerType` / `playerTypes` (OWNR controllers), `race` /
`races` (SIDE), `playerGroup` / `playerGroups` (the 27 trigger groups), `condition` /
`conditions` and `action(type, briefing?)` / `actions(briefing?)` (trigger and briefing
types), `aiScript(code)`. The list forms return `{ value, label }[]` for a drop-down. The
per-map ones read the open scenario and answer a placeholder without one: `string(index)`
(null for 0 or out of range), `location(index)` (0-based slot; 63 is Anywhere),
`switch(index)`, `player(slot)`, and `tile(id)` — the terrain a MTXM id belongs to, null
without the tileset graphics.

### `api.text`

StarCraft's `<XX>` text control codes — bytes 0x01–0x1F in a string, which set the colour,
move the text or hide it. This is the editor's own table, the one the String Editor's
buttons and preview are drawn from, so a plugin that shows or rewrites map text carries no
copy of its own. Worth using rather than reimplementing: the numbering is easy to get
wrong, and the editor's own table was wrong from 0x12 up until it was checked against the
classic player palette.

| | |
| --- | --- |
| `codes()` / `code(byte)` | Every byte the game gives a meaning, in order, or one of them (null for a byte it ignores). A `TextCode` is `{ byte, code, label, effect, rgb, player? }` — `effect` is `"color"`, `"mimic"`, `"invisible"`, `"align"`, `"clip"`, `"nothing"` or `"space"`, and `rgb` is `#rrggbb` for the colours and null for the rest. The twelve that are a player colour carry `player`. |
| `insertable()` | The codes worth offering as buttons: everything but tab, the newlines and the byte that does nothing. |
| `defaultColor()` | What the game starts a string in. |
| `escape(byte)` | `<0E>`, the way every StarCraft editor writes a control byte. |
| `runs(text, options?)` | The string split into lines of coloured runs, the way the game draws it: `TextLine { runs, align }`, `TextRun { text, color, invisible, clipped }`. `invisible` marks what an `<0B>` / `<14>` hides rather than dropping it, `clipped` what an `<0C>` cut off, and `align` reads `<12>` / `<13>`. |
| `plain(text)` | The text with every control byte removed — what the string actually says. |
| `bleedingLines(text)` / `fixBleeding(text)` | See below. |

**The Remastered newline change.** StarCraft 1.16.1 reset the text colour at every line
break; Remastered carries it onto the next line of the same string. So a multi-line string
written before the remaster — most map descriptions, objectives and briefing text — can be
drawn today in colours its author never chose. `runs` models Remastered's rule; pass
`{ resetPerLine: true }` to see the old rendering. `bleedingLines(text)` returns the lines
that differ (`{ line, carried }`, `carried` being the whole `TextCode` inherited), and
`fixBleeding(text)` writes the default colour at the head of each of them so both games
draw the string alike — idempotent, and it never changes what the string says. The Repair
plugin's string finding is exactly these two functions over `api.query.strings()`.

Text *stacking* — the 1.16.1 trick of drawing lines on top of each other — is a different
thing, and there is nothing here for it: Remastered does not render the overlap at all, and
the intended picture *was* the overlap, so there is nothing to restore it to.

### `api.ui`

| | |
| --- | --- |
| `status(text)` / `statusText()` | The status bar. |
| `toast({ kind?, title, detail?, ttl? })` | A notice over the map that leaves by itself — how Save reports (`"ok"`, `"info"`, `"warn"`, `"error"`; `ttl` 0 keeps it until dismissed). |
| `saveFile(data, fileName)` | Write bytes or a `Blob` to disk the way the editor's own exports do: through the browser's save dialog where it has one, else as a download. Resolves `{ route, fileName }`, or null when dismissed. |
| `dialog(spec)` | Opens a dialog in the editor's chrome. `spec.mount(body, handle)` is called with an empty `<div>` inside the dialog body; return a cleanup function if you need one. `spec.buttons` draws the footer (`{ label, primary?, run?(handle), closes? }`); default is a single Close. `spec.onPaste(transfer, handle)` fires for Ctrl+V anywhere in the dialog while it is the topmost one (a paste into one of your own text fields is left alone unless it carries files), `spec.onDrop` for a drop on the body; a `DialogTransfer` is `{ files, text }`. Escape closes the dialog unless `spec.keepOpenOnEscape(target)` answers true for the element the key landed on — for something inside that handles Escape itself, such as a code editor dismissing its own popups. Returns a handle with `close()`, `isOpen()` and `setTitle(text)`. |
| `panel(spec)` | A panel that floats over the map and blocks nothing: the user keeps drawing, scrolling and using hotkeys while it is open (except while typing in one of its fields). `spec.mount(body, handle)` fills an empty `<div>` as a dialog's does; `width` is in CSS pixels (260 by default) and the panel is as tall as its content; `onClose` fires however it closes. The user drags it by its title bar and closes it with the ×; it opens at the top-right of the map and remembers where it was left for the session. The handle has `close()`, `isOpen()`, `setTitle()`. Open as many as you like; they all close with the plugin. |
| `mapTool(spec)` | Take over the pointer on the map. The viewport hands the tool every press, move and release ahead of the active layer's own tools (`onDown` / `onMove` / `onUp`, each with a `MapPointer`: map pixels, the tile, `inMap`, `down`, and the modifier keys — kept inside the map while a button is held, as the built-in brushes do), hides the layer's brush ghost, shows `name` and `hint` in the HUD, and calls `draw(ctx, view)` last on every repaint so the tool can preview what it will do (`view.x(px)` / `view.y(py)` map to canvas pixels; `view.tilePx`, `view.zoom`, `view.visible`). `handle.redraw()` repaints now; call it from `onMove`. Esc or a right-click calls `onCancel` — return `true` to keep running (you dropped a gesture of your own), otherwise the tool stops — and `onStop(reason)` is told once whichever way it ends: `"stopped"` (your `stop()`), `"cancelled"`, `"document"` (the map closed or changed), `"replaced"` (another tool started; one runs at a time), `"disabled"`. A `pickArea` / `pickTile` in progress is served first. Paint is the worked example. |
| `overlay(spec)` | A picture over the map the user can switch on and off, and that stays while they work on any layer: it is listed under View (after the built-in overlays) and in the Layers panel with an eye of its own. `draw(ctx, view)` runs at every repaint while visible, at the slot `above` names — `"terrain"` (under doodad footprints, units, sprites and locations; the default), `"objects"` (under fog of war) or `"everything"` (under a running map tool's drawing only) — with the same `MapView` a map tool gets. `onHover(p)` hears the pointer on every layer, and while a map tool runs, with `null` once when it leaves the map; the overlay never takes the pointer, so clicks go to the active layer's tools. `onToggle(visible)` fires whichever way it was switched. The handle has `show()`, `hide()`, `toggle()`, `isVisible()`, `redraw()` and `remove()`. `visible` is the starting state (true by default); what the user last set an overlay of that name to wins for the session, so a reloaded plugin comes back as it was left. Register at activation and keep the handle; the overlay leaves with the plugin. Walkability is the worked example. |
| `pickFiles({ accept, multiple })` | The file picker, resolved with `File[]` (empty on cancel). |
| `pickArea({ prompt })` | The user drags a rectangle on the map: the viewport shows a crosshair and a teal marquee, the HUD shows your prompt, and the gesture goes to you ahead of the active layer's tools. Resolves with the tile `Rect` (exclusive `x1` / `y1`), or `null` on Esc / right-click, when no map is open, when the map is replaced meanwhile, or when the plugin is disabled. One pick at a time — starting another cancels the first. A dialog is modal and covers the map, so close yours before picking and reopen it with the result (Terrain from Image does exactly this: *Pick on Map…*). |
| `pickTile({ prompt })` | The same for a single click; resolves with `{ x, y }`. |
| `loadImage(source)` | Decode a `File` / `Blob`, a `data:` URL or an `http(s)` URL into an `ImageBitmap`. A remote URL is fetched with CORS and, failing that, loaded through an `<img crossOrigin>`; a site that allows neither rejects with a message that says to save the picture and choose the file. |
| `readClipboardImage()` | The picture on the system clipboard as a `Blob` (the browser may ask permission), or `null`. For Ctrl+V use `onPaste` instead — it needs no permission. |
| `confirm(message, opts?)` / `alert(message, opts?)` / `prompt(message, opts?)` | A yes/no, a note, and a line of text, as dialogs in the editor's chrome rather than the browser's blocking boxes. `confirm` resolves `false` and `prompt` `null` on Cancel, Escape or the ×. Options: `title`, `confirmLabel`, `cancelLabel`, `danger` (a destructive primary button), and for `prompt` also `value`, `placeholder`, `multiline`. |
| `progress(label, { title?, cancellable? })` | A progress panel over the map for long work — it blocks nothing, so report often: `report(0…1, text?)`, `cancelled()` (check it in your loop; the × counts as cancelling, `done()` does not), `signal` (the same answer as an `AbortSignal`, for `fetch` and anything else that takes one), `done()`, `isOpen()`. A modal dialog covers the map and dims the panel behind it, so start the work from a panel, a menu item, or after closing your dialog. |
| `el(tag, props?, ...children)` | The DOM helper the widgets are built from: `style` takes an object, `on*` keys take listeners, everything else is a property or an attribute. |
| `widgets` | Buttons, fields, forms and lists in the editor's own styles, as plain DOM: `button(label, { primary, danger, ghost, onClick })`, `checkbox(label, { value, radio, name, onChange })` (the `<label>` carries its `input`), `text(...)`, `number({ min, max, step, ... })`, `select(items, ...)`, `form(rows)` (a two-column grid of `{ label, field }`), `group(title, ...children)`, `row(...)`, `column(...)`, `hint(text)`, `separator()`, `list(items, { selected, height, onPick })`. Use them and a plugin's dialog looks like a built-in one; `el` is the escape hatch. |
| `open(dialogId, payload?)` | Any built-in dialog (`"mapProperties"`, `"unitSettings"`, …), fire and forget. |
| `ask(dialogId, payload?)` | A built-in dialog that answers — `"saveAs"`, `"confirmClose"`, `"newMap"` — resolving true when it went through, false when it was dismissed. |
| `repaint()` | Redraw the viewport when you changed something the transaction did not cover (an overlay's picture, say). Raises no event. |

### `api.menu` / `api.contextMenu` / `api.hotkeys`

- `menu.add(path, item)`: `path` is a top-level menu (`"File"`, `"Edit"`, `"View"`,
  `"Layer"`, `"Scenario"`, `"Triggers"`, `"Tools"`, `"Plugins"`, `"Help"`) or a submenu
  by label (`"File/Import"`). Plugin items appear after a separator at the end of that
  menu, unless `after` names a built-in item or submenu (`after: "Open Recent"`), in
  which case the item sits directly under it. A last segment that names no submenu gets
  one of the plugin's own at the end of the menu (`"Tools/AI"`), so a plugin with many
  items can keep them together; `separator: true` on an item draws a line above it (never
  two in a row). `item` is
  `{ label, shortcut?, icon?, after?, enabled?(), run() }`. `icon` puts a mark in front
  of the label: `"plugin"` for the plugin's own icon (the manifest's), or any
  `PluginIcon` — use it for items that do something no built-in does, such as reaching
  a server, so the user can tell at a glance which entries are the plugin's.
- `contextMenu.add(surface, item)`: surfaces are `"viewport"` (the map) and
  `"terrainPalette"`. `run(ctx)`, `enabled?(ctx)` and `visible?(ctx)` get a
  `ContextMenuContext`: the tile and pixel under the pointer (viewport), the active
  layer, terrain mode and terrain, and the marked area.
- `hotkeys.add("Ctrl+Shift+I", run)`: modifiers in any order, then a key name. Plugin
  hotkeys are checked before the built-ins and never while typing in a field or while a
  dialog is open.
- All three take `{ command: "id" }` (or `command:` on the item) instead of a `run` of
  their own — see `api.commands`. A context item's command is called with the
  `ContextMenuContext` as its argument.

### `api.events`

`on(event, fn)` for `"document"` (opened, closed, replaced), `"terrain"` (every committed
edit, stroke, undo and redo bumps it, terrain or not — fog edits included — so it is the
"something changed on the map" event), `"units"`, `"sprites"` (the doodads revision,
which THG2 records ride on), `"doodads"`, `"locations"`, `"settings"` (every settings
dialog's OK, Map Properties included), `"triggers"`, `"layer"`, `"selection"`,
`"clipboard"` (the marked area or the clip), `"view"` (scrolled, zoomed, a View tick
moved, or an overlay registered or toggled), `"tool"` (a map tool or pick started or
stopped), `"modified"` (the unsaved-changes flag), `"palette"` (a palette's pick
changed: terrain brush, unit and owner, sprite, doodad, fog players), `"options"` (an
editing option moved: symmetry, placement and doodad rules, location snap, the fog view
player, clip parts and paste mode, locked layers, the grid look, Preferences), `"file"`
(the document's name or handle after a Save, its save options, the archive extras, the
recent list) and `"commands"` (a plugin registered or removed a command — how a plugin
that calls another's by id learns it has arrived, since plugins activate in no fixed
order; check `commands.has` in the listener).

The `"document"` listener is handed a `DocumentEvent`: `reason` is `"open"` (File ▸ Open,
a drop, `document.open` from any plugin), `"new"` (File ▸ New, the startup map included),
`"close"`, or `"replace"` (the open map parsed again from edited bytes — a
`document.sections` write, by any plugin, yours included), and `fileName` is the file's
name or null. A plugin that acts on maps as they open listens for `"open"` and lets the
rest pass; the other events carry nothing.

Listeners are notifications, not a pipeline: they run after the change, in the order the
plugins were activated, and cannot veto, delay or reorder one another. There is no plugin
ordering and none is planned — a listener that rewrites the map in response (Repair does,
through `document.sections`) simply raises a fresh `"document"` event with reason
`"replace"`, which every other listener sees in turn, so whatever a plugin computed from
the earlier state is recomputed from the later one.

### `api.storage`

`get(key, fallback)`, `set(key, value)`, `remove(key)`: JSON in localStorage under a
per-plugin prefix (`scmjs.plugin.<id>.`). Safe when storage is unavailable (falls back to
memory). The user can see and throw it away — Preferences ▸ General ▸ Browser storage lists
your keys as one row under your plugin's id, opening onto the values, with a Clear button of
its own, and Clear all data sweeps every `scmjs.` key — so treat what you store as a
convenience, never as the only copy of something, and keep it small and readable.

### `api.plugin`, `api.apiVersion`, `api.log(...)`

Who you are (`id`, `name`, `source`), which API you got, and a console logger with the
plugin's name prefixed.

## Host side (for editor developers)

| File | |
| --- | --- |
| `src/plugins/api.ts` | The public types. Changing them is an API change: bump `PLUGIN_API_VERSION` for anything not backward compatible. |
| `src/plugins/host.ts` | `createPluginApi(store, info)` builds one plugin's `PluginApi` over the Jotai store and a `Contributions` bag that `dispose()` empties; `activatePlugin` / `deactivatePlugin` drive the lifecycle and write `pluginRuntimesAtom`; `inspectPlugin` / `installPlugin` are the confirm-then-add pair, and `rememberManifest` is the manifest cache both it and `describePlugin` write. |
| `src/plugins/loader.ts` | Spec parsing, manifest fetch, the fetch-as-text / transpile / rewrite-imports / blob-URL pipeline, and `previewPlugin` (`canonicalSpec` + the manifest, no code) behind the Add Plugin confirmation. Pure apart from the `fetch`, `transpile` and `createModuleUrl` callbacks it takes, so `tests/plugins.test.ts` runs it in Node. |
| `src/plugins/claims.ts` | `locateClaims(claims, list)` asks every `api.triggers.claim` where its run is in a given list (a `locate` that throws is a skipped claim, answers are clamped), plus `claimAt`, `claimBadge` and `claimDescription` — what the Trigger Editor, the Text Trigger Editor and Import Triggers read. |
| `src/plugins/images.ts` | `loadImage` / `readClipboardImage` behind `api.ui`, and `transferOf` (a `DataTransfer` → `{ files, text }`) that `PluginDialog` uses for `onPaste` / `onDrop`. |
| `src/plugins/builtin.ts` | `import.meta.glob` over `plugins/*/plugin.{ts,json}` — empty, since nothing ships in the bundle. |
| `src/plugins/defaults.ts` | The plugins a fresh editor starts with (`DEFAULT_REMOTE_PLUGINS`, each with whether it starts on, plus any built-in), merged over the stored list by `effectiveInstalls`. |
| `src/atoms/pluginAtoms.ts` | `installedPluginsAtom` (persisted, with `local` per plugin), `pluginCodeAtom` (the stored copies), `pluginRuntimesAtom`, the contribution registries `pluginMenuItemsAtom`, `pluginContextItemsAtom`, `pluginHotkeysAtom`, `mapPickAtom` — the `pickArea` / `pickTile` request the viewport is serving (`cancelMapPickAtom` is what Esc and a right-click write) — and its siblings `mapToolAtom` (the running `ui.mapTool`, with `cancelMapToolAtom` and `mapToolRevisionAtom` for `redraw`), `pluginOverlaysAtom` (the registered `ui.overlay`s with their visibility — `setOverlayVisibleAtom` is the one writer, `pluginOverlayRevisionAtom` their `redraw`, `overlayVisibilityMemory` what the user last chose per plugin and name) `pluginPanelsAtom` (the open `ui.panel`s) and `pluginTriggerClaimsAtom` (the live `api.triggers.claim`s, each with a revision the handle's `refresh` bumps). |
| `src/hooks/usePlugins.ts` | Activates the enabled plugins at startup and keeps runtime in step with the installed list. |
| `src/components/dialogs/PluginDialogs.tsx` | Manage Plugins, `ConfirmPluginDialog` (the Add Plugin confirmation), and `PluginDialog` — the frame a plugin's `ui.dialog` mounts into. |
| `src/components/panels/PluginPanels.tsx` | The floating frames `ui.panel` mounts into, rendered inside the viewport: a draggable title strip, a close button, positions remembered per plugin and title for the session. |

Contribution points read the registries: `MenuBar` merges `pluginMenuItemsAtom` into
its menu model (`withPluginItems`), `MapViewport` and `TerrainPalette` append the
matching `pluginContextItemsAtom` entries to their context menus, `useHotkeys` checks
`pluginHotkeysAtom` first. A `Plugins` menu (Manage Plugins… plus anything registered
under `"Plugins"`) sits between Tools and Help.

`api.ui.pickArea` / `pickTile` are `pickOnMap` in `host.ts`: one `MapPickRequest` at a
time goes into `mapPickAtom`, and `MapViewport` serves it ahead of every layer — crosshair
cursor, a teal marquee with its size, a HUD chip with the prompt — calling the request's
`finish` on mouse-up; `finish` clears the atom itself and is guarded against running twice.
The host also finishes it with `null` when the scenario atom changes, when the plugin's
`Contributions` are disposed, or when a newer pick starts; `useHotkeys` (Esc) and the
viewport's right-click write `cancelMapPickAtom`.

`api.ui.mapTool` is `startMapTool` there: one `MapToolRequest` in `mapToolAtom`, which
`MapViewport` serves after a pick and ahead of every layer — its `onDown` captures the
pointer and forwards the gesture as `MapPointer`s, `onLeave` sends one `inMap: false`
move, the layer's hover ghost and "placing" chips stay hidden, the surface takes the
tool's cursor, and the tool's `draw` runs at the end of the paint pass with a `MapView`
built from the current scroll and zoom. `finish(reason)` is guarded like a pick's and
clears the atom; `cancelMapToolAtom` (Esc, right-click) asks the spec's `onCancel` first
and only finishes when it does not keep the tool.

`api.ui.overlay` is `registerOverlay` there: one `PluginOverlayEntry` in
`pluginOverlaysAtom`. `MapViewport` runs each visible entry's `draw` at its slot — after
the grid, after the locations and start locations, or after the hover ghost and before a
map tool's own drawing — inside a `save` / `restore`, and its `onMove` / `onLeave` forward
a `MapPointer` (or `null`) to every visible entry with an `onHover` before doing anything
else, so overlays hear the pointer on every layer and during a tool. The View menu and the
Layers panel list the entries and write `setOverlayVisibleAtom`, which the handle's
`show` / `hide` / `toggle` also go through, so the spec's `onToggle` fires once per change
however it came; the atom also records the choice in `overlayVisibilityMemory`, which
`registerOverlay` consults before the spec's `visible`. `remove()` (and the plugin's
`Contributions` disposal) takes the entry out of the list.

`api.document.edit` is `runTransaction` in `host.ts`: it wraps the scenario in an
`EditTransaction` whose operations apply immediately and accumulate change lists in
`applyEntry` order, then hands the entry to `commitTerrainAtom` (the stranded-doodad /
stranded-unit pass that used to live only inside `useTerrainTools`) so a plugin edit
behaves exactly like a stroke. `tx.rebuildIsom` is `rebuildIsomFromTiles` from
`editor/isom.ts`: over an existing lattice of the right size it diffs into the entry's
`isom` list, otherwise it sets `scenario.isom` and records the section as the entry's
`createdIsom` (undo puts `null` back; `commitEditAtom` bumps `isomRevisionAtom` for it, so
the palette re-measures). The editor has no rebuild button of its own any more — the
Repair plugin is where the user reaches this.

The `"document"` event's payload is `documentEvent` in `host.ts`, read off
`documentChangeAtom` (`atoms/documentAtoms.ts`): `loadDocumentAtom` records the
`reason` the caller passed (`"open"` by default, `"new"` from File ▸ New,
`"replace"` from `replaceScenarioAtom`) together with the scenario object it applies to,
and `closeDocumentAtom` records `"close"`; a scenario installed some other way (a test
setting the atom directly) is reported as an open or a close by what is there. The
sections calls Repair relies on live in `editor/sections.ts`: `defaultSectionBytes`
(a fresh `createScenario` on the map's size, tileset and revision, one section marked
dirty, encoded and picked out — the raw created sections for IVE2 / VCOD / UPRP / UPUS),
`rebuildSections` (the given names added to a copy's dirty set, `serializeScenario`,
`parseScenario`) and `requiredSectionNames` (`requiredSections` with `STRx` substituted
on an extended-strings file).

## Terrain from Image

[scm-js/plugin-image-to-terrain](https://github.com/scm-js/plugin-image-to-terrain), installed
by default — File ▸ Import ▸ Terrain from Image…, and on the terrain
palette's and the map's context menus *Terrain from Image…* (into the marked area when the
Cut / Copy / Paste layer has one) and *Terrain from Image into Area…*, which first has you
drag the target rectangle on the map (`api.ui.pickArea`) and then opens the dialog with it
selected. In the dialog, *Pick on Map…* does the same round trip — the dialog closes, you
drag, it reopens with the picture and every setting kept (the state lives in a `Session`
object outside the dialog for exactly this reason).

The picture can come from a file, Ctrl+V or *Paste* (a screenshot on the clipboard), a
drop onto the dialog, or a URL (`api.ui.loadImage`). *Fit* places it — stretched, fitted
inside (uncovered cells are left alone) or covering the area — with flips and smooth or
nearest sampling (one pixel per tile for pixel art). *Adjust* is brightness, contrast,
saturation, hue, gamma, auto-levels and invert, applied before matching and shown in the
*Source* preview. Every terrain in the list has a **key colour** — what in the picture it
should match; by default its own tiles' average, changed with the swatch or the eyedropper
(arm it on a row, click the source preview), remembered per tileset.

`convert.ts` is the pure part and that repository's `tests/convert.test.ts` pins it: resample
to one sample per target cell, `adjustSamples`, `boxBlur`, then match every cell in OKLab
(`makeMatcher`) — *Adaptive* fits the picture's lightness and chroma ranges onto the
palette's (gain capped so a flat picture is not stretched into noise) and rescales hue so
the murky tile averages' hue spread counts as much as their lightness spread; *Exact* is
plain distance to the key colours; *Brightness bands* makes the ticked terrains, in order,
equal bands from the picture's darkest to its brightest cell (a heightmap). The *Weigh*
slider moves between lightness and hue. Clean-up follows: `majorityFilter` (despeckle) and
`removeSmallRegions` (islands below a size join their commonest neighbour). `plugin.ts`
is the dialog and the transaction: **Isometric** paints each lattice diamond in the target
with `tx.paintIsom` — the diamond's terrain is the majority of the four cells around its
centre (`diamondTerrain`), and terrains are painted low ground first, rare ones last
(`paintOrder`), so the brush's one-diamond bleed eats into common ground rather than thin
features — and cliffs and shorelines are generated at every boundary; **Tiles** stamps flat
pairs with `tx.stampTerrain` and leaves the ISOM alone (Tools ▸ Repair Map… afterwards
rebuilds it, if you want the isometric brush back). One undo entry either way.

## Paint

[scm-js/plugin-paint](https://github.com/scm-js/plugin-paint), a default — Tools ▸ Paint…,
`Ctrl+Shift+P`, or *Paint…* on
the map's right-click menu then opens a panel that floats
over the map (`api.ui.panel`). Pick a tool in it — freehand, line, rectangle, ellipse,
polygon, star, spray, text, eraser — and draw on the map; the *brush* is whatever the
active layer's palette has picked (`api.palette.active()` and `api.terrain.active()`,
refreshed on the `"palette"` and `"layer"` events): flat terrain or a tile, a doodad, a
unit for a player, a sprite, or fog for some players. Closed shapes can be filled (grid,
staggered grid, random), objects are spaced along the outline (auto = their own size) and
can be jittered, units and sprites can cycle through players 1–8 or take random ones, and
units can skip the spots the Units palette's placement checks refuse (`tx.canPlaceUnit`).
Every stroke is one `api.document.edit`.

`shapes.ts` is the pure part and that repository's `tests/shapes.test.ts` pins it: a tool's
drag becomes an outline `Path` (`linePath`, `rectPath`, `ellipsePath`, `starPath`, with
`constrainSquare` / `constrainAngle` for Shift and `boxFromCenter` for Alt); objects come
from `samplePath` (arc length, so corners are not doubled) plus `fillPoints` inside a
closed shape, then `jitterPoints` and `dedupePoints`; tiles and fog cells come from
`strokeCells` (a Bresenham walk dilated by a round brush of the panel's width) plus
`fillCells` (cells whose centre is inside); `textCells` lays a 5 × 7 dot font (`font.ts`)
out as cells, which become one object per dot or `width × width` tiles per dot. A
deterministic generator seeded on mouse-down makes the preview and the commit scatter the
same way. `plugin.ts` is the panel, the running `api.ui.mapTool` (the gesture per tool,
`onCancel` returning `true` to drop a shape and keep painting, `draw` for the dashed
outline, the per-point boxes in player colour, the eraser's crosses and the count), and
the transaction: `stampTerrain` / `setTiles` / `setFog` for cells, `placeUnit` /
`placeSprite` / `placeDoodad` for points, `removeUnits` / `removeSprites` / `removeDoodads`
for the eraser.

## scmscx.com

[scm-js/plugin-scm-scx](https://github.com/scm-js/plugin-scm-scx), a default that starts
on, is the editor's one network plugin: File ▸ Find on scmscx.com… searches the
StarCraft map archive at scmscx.com and opens the map you pick through `document.open`,
and Plugins ▸ scmscx.com Settings… holds an optional forwarder address. It shows the
other side of `document.open`: the bytes come from a third party's server, under the
file name that server knows the map by, and the editor's own Close Scenario question
still comes first. scmscx.com has no documented API — its About page says the routes
its front end uses are open and may change — so `client.ts` there mirrors those routes
(`/api/uiv2/search`, `/api/uiv2/map_info`, `/api/maps/{mpq_hash}`) and leaves every
default parameter out of the query string exactly as the site does, so the URLs match
the ones the site makes for itself.

The site sends no CORS headers, which is a constraint worth knowing about before writing
a plugin against any third-party API: a browser lets a page read a cross-origin answer
only when the server says so, and an `<img>` is the one thing exempt from that. The
plugin therefore tries the site first (`ScmscxClient.connect()` probes each base with
the newest-uploads search and takes the first that answers JSON), then a forwarder if
one is set, and when nothing answers the dialog says why, links to the site's search
page for the query, and reminds the user that a downloaded map can be dropped onto the
editor. The minimaps still show either way. The editor itself runs no forwarder.

## Section Explorer

[scm-js/plugin-section-explorer](https://github.com/scm-js/plugin-section-explorer),
installed from Plugins ▸ Browse Plugins…, is the worked example for `api.document.sections` and
`api.names`: Tools ▸ Section Explorer… (`Ctrl+Shift+H`) is a hex editor that knows the map
file. The left pane is `sections.list()` with badges for what the registry and the buffer
say (raw, unknown, unsaved, edited, repeated, wrong size, cut short); the middle is a hex
view of `sections.bytes(index)` drawn only for the rows on screen, coloured by the field
each byte belongs to; the right is the inspector — the section's description, find and
go-to, the field under the cursor with its path, value, meaning and an editing control,
the raw readings in every width, and a structure tree that pages long arrays and follows
the cursor.

`layout.ts` there is the node model: a *schema* (a struct of fields, an array of records,
a primitive) is instantiated at an offset into a `Node` tree whose children are built on
demand, so a terrain section of 32,768 tiles costs nothing until a row of it is looked
at; `pathAt` / `leafAt` descend by arithmetic through fixed-stride arrays, `leavesIn`
walks a byte range for the hex view's colours, and a leaf's `Semantic` says how its value
is shown (`describe`, with the record's sibling values, so an action's `target` reads as
a location, an amount or an AI script depending on the type byte) and edited (a number,
a drop-down from `api.names`, flag ticks, text). `layouts.ts` is every section: the
record shapes of UNIT / THG2 / DD2 / MRGN / TRIG / MBRF with one-line summaries, the
fixed tables (VCOD, the settings and restriction tables per revision, PUNI, FORC, CRGB,
…), the per-cell terrain and fog sections, and the string table, whose layout is read
off its own offsets (one leaf per distinct blob, however many indices share it). A
section longer than its layout gets a trailing-bytes leaf; a name with no layout is
shown as plain bytes. `buffer.ts` is the edit buffer — overwrite, insert, remove, resize,
with its own undo that merges a run of typing into one step — and Apply writes every
changed buffer through `sections.write`, which is what makes the editor parse the file
again. Both pure modules have tests in that repository.

## Walkability

[scm-js/plugin-walkability](https://github.com/scm-js/plugin-walkability), a default that
starts on, is the worked example for a read-only analysis drawn over
the map: Tools ▸ Walkability… (`Ctrl+Shift+W`) reads every tile's sixteen VF4 words
through `api.tileset.raw()` (`groups[id >> 4].megatiles[id & 15]` → `megatileFlags`),
marks the ground under every building and resource (`api.data.units()` extents, or
`api.palette.unitSize` without the tables) and hands the grid to `analysis.ts`, the pure
part with that repository's tests: an exact Euclidean distance transform for clearance,
4-connected components for islands, a BWEM-style watershed over the clearance map for
areas and the chokes between them (where two areas first touch is the widest point of
the narrowest passage; too small an area, or a meeting point nearly as wide as the area
itself, means they were one), seams (open cells at different heights touching with no
ramp), and per start-location pair the ground distance (Dial's algorithm, no corner
cutting) and the widest route (a flood by descending bottleneck) whose narrowest point
is measured with `passageWidth`. `api.query.startLocations()` and
`api.query.placement(106, …)` (a Command Center's footprint) give the start rows and the
"hall spot not buildable" problem.

The result is an `api.ui.overlay` registered at activation (`above: "objects"`, off
until switched on) — View ▸ Walkability, the Layers panel, `Ctrl+Shift+W` or the panel's
tick — whose `draw` blits one `ImageData` per view mode (areas, islands, clearance,
height, walkable) scaled from minitiles to canvas pixels with smoothing off, then rings,
labels and markers in canvas coordinates through `view.x` / `view.y`; `onHover` writes
the cell under the pointer into the panel. Because an overlay never takes the pointer,
the picture stays up while units and doodads are placed on it, and the analysis follows
every edit (the `"terrain"`, `"units"`, `"doodads"`, `"settings"` and `"document"`
events, debounced) while it is showing or the panel is open. Picking an area is a
`pickTile`. The panel (`api.ui.panel`) holds the settings, the readout and the problems;
*Details…* opens a second panel with every start location, pair, island, area and choke,
with `api.view.center` / `api.view.goTo` behind each row; *Copy report* is the text
summary. The plugin never writes to the map.

## Melee Wizard

[scm-js/plugin-melee-wizard](https://github.com/scm-js/plugin-melee-wizard), installed from
Browse Plugins, is the worked example for `placeUnit` / `canPlaceUnit` /
`updateUnits` inside one `document.edit`, and for a map tool whose press-and-drag is
previewed with `draw`: Tools ▸ Melee Wizard… (`Ctrl+Shift+M`). `layout.ts` there is the
pure geometry with its tests: `ringPositions` enumerates the tile positions of a
footprint at exactly the game's three-tile gap from the 4 × 3 hall (Chebyshev, the rule
the game applies to resource depots), `layoutBase` grows the mineral line along that
ring from the position nearest the pointed direction, wrapping round the hall's corner,
and puts the geyser on its own ring past the end of the line; `symmetryImages` gives the
point maps of the nine layouts (identity first, the across-the-map image second, so a
2-of-4 game still faces players), `rectImages` maps a footprint and snaps it back, and
`baseImages` lays a base out again for an image that swaps the axes (a rotation by 90°
or a diagonal mirror), since a 2 × 1 patch cannot turn on its side. `symmetryGaps` and
`summarizeBases` are the checks.

`plugin.ts` runs three tools on `api.ui.mapTool`: start locations (hover shows the hall
and its images with player labels, a click places them, replacing the players' old ones
when the option says so), base (press for the hall spot — inside an existing start
location's footprint snaps to it — drag for the direction, every footprint of every
image previewed with `api.query.placement` colouring the refused ones red, release to
place through `placeUnit` with `updateUnits` setting the amount), and the blocking
patch. *Bases at every start location* mirrors one layout when the starts follow the
symmetry (`api.query.startLocations()` against the images, within a tile) and lays each
out otherwise. *Mirror selected units* maps `api.selection.units()` through the images,
resolving each image's player by composing the maps, and *Check symmetry* selects what
`symmetryGaps` reports through `api.selection.setUnits`.

## Repair

[scm-js/plugin-repair](https://github.com/scm-js/plugin-repair), a default that starts
on, is the worked example for the `"document"` event's payload, `document.sections`'s
`defaults` / `rebuild` / `trailing` / `required`, and `tx.rebuildIsom`. When a map opens
it reads the file the way the game does and, when something is wrong, lists it in a
dialog with a tick per finding; Tools ▸ Repair Map… runs the same check by hand, and
*Check maps when they open* in the dialog's footer turns the automatic one off.

`chk.ts` there is the container reader (the editor's own rules: a chunk whose length runs
past the file keeps what is there and is marked truncated, a negative length stops the
read and leaves the rest as trailing bytes), `analyze.ts` turns a chunk list plus what the
editor knows (`sections.known()`, `sections.required()`, `sections.defaults("VCOD")`,
`terrain.checkIsom()`) into findings — each with a level, a title, a note saying what the
game does with the file as it is, a `Repair` and whether it is ticked by default — and
`repair.ts` applies the byte-level repairs to a chunk list, resolving indices to chunk
objects first so removals never shift a later one. All three are pure and tested. The
findings cover the container (negative and truncated lengths, junk names, trailing bytes
— which are recovered as sections when that is what they are — repeats, sizes off the
registry's, stray record bytes), the sections a file of the revision must carry (a missing
MTXM is restored from TILE and a missing TILE copied from MTXM, everything else on
`defaults`), the header values (DIM, ERA's high bits, VER, TYPE, OWNR and SIDE), the
string table's offsets, unit records the game cannot place, a VCOD that is not StarEdit's,
the order of the sections, a blank TILE, and the ISOM (missing, wrongly sized or stale —
`rebuild-isom`). `plugin.ts` gathers the inputs, shows the dialog, and applies a repair in
three steps: the byte-level ones as one `replaceFile`, then `sections.rebuild` for the
names that asked for it, then one `document.edit` with `tx.rebuildIsom`. The bytes as the
map came in are kept in memory until the next map opens, and *Restore original* puts them
back through `replaceFile`.

## Trigger Script

[scm-js/plugin-trigger-script](https://github.com/scm-js/plugin-trigger-script), installed
from Browse Plugins, is the Script Editor: a TypeScript-subset language kept as a file inside
the map (`scmjs\triggers.ts`, with a build manifest in `scmjs\triggers.json`) and compiled
into a block of the trigger list. It used to be part of the editor and was moved out so
the editor no longer carries Monaco and a second TypeScript; the plugin fetches both from
a CDN when the dialog first opens (Monaco as jsDelivr's bundled ESM build, TypeScript into
a blob worker with a main-thread fallback). It is the worked example for
`api.triggers.claim` — the manifest holds a hash of the generated records, `locate` looks
for them at the recorded start and then anywhere in the list, so the Trigger Editor badges
and locks the block wherever local edits moved it, and a hand edit *inside* it makes the
block stale (ordinary triggers again; the next Build appends a fresh one) — and for a
plugin publishing commands for other plugins: `trigger-script.state`, `.declarations`,
`.compile`, `.build`, `.print`, `.simulate`, `.triggerAtLine` and `.open`, which the AI
plugin calls through `api.commands.run` after checking `commands.has`, listening to the
`"commands"` event since plugins activate in no fixed order. Its source keeps the
compiler out of the browser-specific parts (`compiler/` is pure, tested under vitest with
the real `typescript` package, and vendors the trigger tables it reads), which is what
lets the same modules run in the worker.

## AI

[scm-js/plugin-ai](https://github.com/scm-js/plugin-ai), not a default, is the worked
example for calling another plugin's commands, `api.document.create` and a plugin's own submenu, and the
first plugin that needs a server: [scm-js/ai-server](https://github.com/scm-js/ai-server)
holds the Anthropic key, the prompt recipes, the access rules and the budgets, and
never any game data. The split is deliberate — the editor already has everything that
makes a map a map, so the model never emits tiles. Each recipe takes the facts the
plugin gathered (the tileset's terrain vocabulary, statistics, a rendered picture, the
script's declarations) and answers with a *plan* or *text* the plugin applies through
the ordinary API: a map plan is a coarse grid of legend characters the plugin turns into
isometric brush strokes (so cliffs and shores draw themselves), bases laid with the
Melee Wizard's geometry, doodads scattered by category; a trigger request answers in the
Trigger Script plugin's language, is compiled through that plugin's `trigger-script.compile`
command, repaired against the diagnostics, and built with `trigger-script.build` (so it
needs that plugin on, and says so when it is not); a review sends `document.renderImage`;
the assistant panel is a tool-use loop whose tools — reads, screenshots, and one
undoable write (or one settings transaction) each — are defined and run in the plugin,
with the server adding the system prompt and the caching. The assistant is the reason
`document.update` grew the settings family, `api.settings` and `document.resize`: its
sixty-odd tools reach everything the editor's dialogs write. With every message it sends
the map's facts (players, counts, what is selected, where the view is, the top of the
undo stack) and, once per map, a *reference* block built from `api.terrain.types()`,
`api.palette.doodadCategories()`, `api.settings.unitTypes()`, `api.triggers.defs` and
the text format — the server keeps it as a cached system block, and puts a cache
breakpoint on the conversation, so a long session with screenshots is read from the
cache rather than re-billed each round. `protocol.ts`, kept identical in both
repositories, is the contract.
Tools ▸ AI holds the whole of it; Settings there takes the server's address, an access
token the operator issued, or your own Anthropic key, which is forwarded and never
stored on the server.
