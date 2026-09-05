# Plugins

A plugin is a small program the editor loads from a public Git repository or a web
address. Once loaded it can add menu items, context-menu entries, hotkeys, dialogs,
floating panels, map tools and overlays, and it can read and change the open map through
the same undo model the built-in tools use. Some of what the user guide describes is a
plugin: Walkability, Paint, Repair, Terrain from Image and the scmscx.com search are
installed from the start, and Melee Wizard, Trigger Script, Section Explorer and AI are a
click away in Plugins ▸ Browse Plugins…. The [user guide](../README.md#plugins) lists
them with what each one does.

This document is in three parts, for two readers:

- **Using plugins** is for anyone who uses the editor: how to install a plugin, what a
  plugin is allowed to do, and how to update or remove one.
- **Writing a plugin** and **The API, group by group** are for someone writing one. The
  complete reference, one page per API group, is generated from the editor's own
  declarations at [docs.scmjs.dev/api](https://docs.scmjs.dev/api/); the tour here says
  what each group is for and how the pieces fit.

How the editor loads plugins on the inside, for someone working on the editor itself, is
in [docs/development.md](development.md#the-plugin-host).

## Using plugins

### Finding and installing one

Plugins ▸ **Browse Plugins…** lists the plugins the project publishes. Press **Install**
on one and the editor shows where the code comes from and asks before it adds anything.
Plugins ▸ **Manage Plugins…** lists what is installed, turns each plugin on or off, and
takes the address of any plugin that is not on the list.

Five plugins are *defaults*. They are on the list from the start and compiled into the
editor, so a fresh install has them without touching the network. They are ordinary
plugins from their own repositories and can be turned off, but not removed.

An address can take any of these forms:

| Address | What it points at |
| --- | --- |
| `github:owner/repo` | A GitHub repository, at its default branch. |
| `github:owner/repo@v1.2` | A tag, a branch or a commit of it. |
| `github:owner/repo@v1.2/plugins/mine` | A folder inside a repository, for several plugins in one. |
| `https://github.com/owner/repo/tree/v1.2/plugins/mine` | The same, as the URL copied from the browser's address bar. |
| `https://…/plugin.json` | A plugin's manifest anywhere: GitLab, a gist, your own server. |
| `https://…/plugin.ts` | A single plugin file with no manifest. |
| `http://localhost:3000/` | A folder holding `plugin.json`, served from your own machine. This is how a plugin is developed. |

### What you are trusting

**There is no sandbox.** A plugin runs with the same access as the editor itself: it can
read and change the map you have open, read and write the files stored in the map archive,
read and write the editor's own browser storage, and make network requests. That is the
same trust a browser extension asks for. Only add plugins you trust, and prefer ones whose
source you can read.

Before any code is fetched, the Add screen shows what the plugin says about itself: its
name, version, author, description and icon out of its `plugin.json`, links to the
repository and homepage, and the addresses the code will be fetched from. Nothing else has
been downloaded or run at that point, so this is your chance to check the repository.

The Add screen has three ticks:

| Tick | Default | What it does |
| --- | --- | --- |
| Enable it now | on | Start the plugin as soon as it is added. Off adds it to the list and leaves it for later. |
| Pin to this version | on | Store the exact commit the address points at today, so the plugin never changes under you. See the next section. |
| Load from a copy saved here | off | Keep a copy of the plugin's files in this browser and load from that copy, never from the address, until you press Reload. |

### Keeping a plugin up to date

A pinned plugin never changes on its own. A push to its repository reaches nobody who has
it installed. **Check for update** on its row in Manage Plugins asks the repository what it
holds now. When that is a newer commit the button becomes *Update to …*, which shows the
new version's manifest and asks before anything changes, the same way the Add screen did;
when it is not, the row says *Up to date*. Nothing of the plugin is fetched or run by the
check itself.

The defaults have the button too, including in the builds that compile them in. A bundled
plugin is asked for nothing — not at startup, not when the list is drawn — until you press
it. Updating one turns it into an ordinary plugin fetched from its repository, each time
the editor starts; the confirmation says so, *Load from a copy saved here* is the nearest
way back to how it behaved, and **Revert** on the row returns it to the version this
editor ships.

**Reload** fetches the plugin again from its address and replaces any copy saved in the
browser. For a pinned plugin that is the same commit again, so the update check is the way
forward and Reload is for a plugin you are writing.

Turning a plugin off takes back everything it added: menu items, hotkeys, dialogs, panels,
overlays and its event listeners. **Remove** takes it off the list as well. A default
cannot be removed, only turned off.

A plugin that fails to load says so: a notice appears with a button to Manage Plugins,
where the row shows the error.

### Where a plugin keeps its data

A plugin can keep settings in the browser. Preferences ▸ General ▸ Browser storage lists
them as one row under the plugin's id, with a button to clear them, and Clear all data
sweeps them with the rest.

A plugin can also keep files inside the map archive, next to the scenario itself. The
Trigger Script plugin stores its script there, so the script travels with the map. The
Save dialog lists those files and can leave them out.

### Sources

Browse Plugins reads *registries*: JSON files, each listing plugins with the address to
install them from. The project's own is
[`scm-js/registry`](https://github.com/scm-js/registry). The **Sources** button shows the
lists being searched and takes the address of another. A registry decides only what is
*offered*. Installing from a Browse row goes through the same Add screen, the same manifest
fetch and the same pinning as an address you pasted by hand.

A registry decides what is offered, not what exists, so Browse also shows the plugins you
have that no registry lists — one you pasted in by address, or one a list has stopped
carrying. They are marked *not listed* and sit under *Already installed*, with no Install
to press. Nothing you have installed is missing from Browse.

## Writing a plugin

A plugin is one TypeScript or JavaScript file that exports an `activate(api)` function,
sitting next to a `plugin.json` in a public repository. There is nothing to install and no
build step to start with: the editor fetches your source, transpiles it in the browser and
calls `activate` with the whole API.

The place to start is [Hello World](https://github.com/scm-js/plugin-hello-world), a
complete plugin kept as small as it can be: one Tools menu item that opens a pane saying
hello with the name of the open map. It is in Browse Plugins if you want to see it run,
and its repository is the one to copy: `plugin.ts` is about sixty lines, most of them
comments, and the typings, the type-check, the build and the CI workflow described below
are all set up in it. What follows explains the same pieces one at a time.

### The two files

`plugin.json`:

```json
{
  "name": "Hello",
  "version": "1.0.0",
  "description": "Says hello from the Tools menu.",
  "entry": "plugin.ts",
  "icon": "icon.svg",
  "api": 1
}
```

`name` is the only required field. `id`, used for storage keys and log prefixes, is
derived from the name when absent. `entry` defaults to `plugin.ts`, then `plugin.js`.
`api` is the API version the plugin needs (see **The typings**). Two optional fields are
covered below: `icon` and `build`.

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

Everything `add` and `on` return is a `Disposable`. Keep the ones you need to drop early
and forget the rest: turning the plugin off disposes them all. A function returned from
`activate` runs at deactivation too, for anything the API does not know about, such as
timers or sockets.

### Developing locally

Serve the folder and add it to the editor:

```sh
npx serve --cors .
```

Then paste `http://localhost:3000/` into Plugins ▸ Manage Plugins… and press **Reload**
on its row after each change.

### The typings

```sh
npm i -D @scm-js/plugin-api
```

That package is the whole toolchain: one generated `index.d.ts`, types only, nothing to
configure. The `import type` line in `plugin.ts` is erased before the file runs, so the
package matters only while editing and type-checking. The same files are committed and
tagged at [`scm-js/plugin-api`](https://github.com/scm-js/plugin-api) if you would rather
depend on a git ref.

The package's **major version is the API version**, and its minor version moves when the
declarations do, so `^1` in your `package.json` means what it says. Your manifest's
`"api": 1` is the version you *need*: an editor offering an older one refuses to load the
plugin rather than failing halfway through `activate`. Additions to the API do not move the
version, because a new call appearing on `api` breaks nothing that does not use it. The
version is reserved for a change that would.

### What the editor does for you

- **Every edit is one undo entry.** You never touch the scenario's internals.
  `api.document.edit` takes a label and a builder, applies your operations as you call
  them, and commits them as a single history entry. It is the path a brush stroke takes,
  so the right file sections are marked dirty, the canvas repaints, and doodads or units
  your terrain edit stranded are lifted in the same entry. `api.document.update` is the
  same shape for the tables that live outside the undo model, and
  `api.document.sections` for raw bytes. See **The three kinds of write**.
- **Everything you add is taken back for you.** A menu item, hotkey, context-menu entry,
  dialog, panel, overlay, map tool or event listener each hand you a `Disposable`, and the
  editor keeps its own list of them besides. Turning your plugin off, reloading it or
  removing it sweeps the lot whether or not you cleaned up.
- **Reading the map is always safe.** Every method that reads answers `null`, `[]` or
  `false` when no map is open, rather than throwing. You do not have to guard the empty
  editor.
- **The graphics may not be there.** The user may not have installed Blizzard's data, and
  the editor works without it. Anything that needs the tileset degrades instead of
  failing: a terrain operation writes nothing and leaves a note on its result. Check what
  you get back rather than assuming.

### Imports and dependencies

- **Write plain DOM, not React.** `api.ui.dialog` and `api.ui.panel` hand you an element
  to fill. `api.ui.el` and `api.ui.widgets` build content in the editor's own styles, so a
  plain-DOM dialog looks like a built-in one without copying any CSS. If you want a
  framework, bundle one into that element; it is yours.
- **Relative imports work, with or without the extension.** `./convert`, `./convert.js`
  (resolving to `convert.ts`, the way a TypeScript project means it), or a folder with an
  `index.ts` are all tried. A cycle is an error naming the file.
- **Bare package names do not work on the source path.** `import x from "some-package"`
  is refused when the editor loads your source, because there is no module resolver
  behind a `fetch`. An `import type` from `@scm-js/plugin-api` is fine: the compiler
  erases it before the loader sees the name. For a real dependency, ship a bundle and
  name it in the manifest's `build` (see **Building**).

### The icon

`icon` is the plugin's face in Manage Plugins and in the title bar of every dialog the
plugin opens. Four forms are understood:

| `icon` | What it means |
| --- | --- |
| `"icon.svg"`, `"art/mark.png"` | An image file beside the manifest (`.png .svg .jpg .gif .webp .avif .ico`). |
| `"https://…/mark.png"` | An image anywhere, fetched by the browser when the dialog shows. |
| `"data:image/svg+xml,…"` | An image inline in the manifest, nothing extra to fetch. |
| `"🗺️"` | Up to four characters, drawn as text. An emoji is the cheapest icon there is. |

Anything else is ignored and the plugin shows the editor's default plugin mark, as it does
with no icon at all or one that fails to load. Draw for a 30 px square (it is also shown at
14 px in a dialog title) on nothing: the editor draws no frame behind it, and an icon that
is itself a bordered square reads as a second control next to the row's tick box. Terrain
from Image's `icon.svg` is a worked example.

### Building

A plugin can ship a built bundle and name it in the manifest:

```json
"build": "dist/plugin.js"
```

The editor then fetches that one file and imports it, in place of fetching your source,
starting the TypeScript compiler in a worker and walking your imports one file at a time.
It is worth doing for anything bigger than a single file, and it is the only way to use an
npm dependency. `entry` stays in the manifest either way: it is what a person reads, and
what loads for a repository that publishes no build.

The organisation's plugins all build the same way, with one esbuild call:

```json
"build": "esbuild plugin.ts --bundle --format=esm --target=es2022 --platform=browser --outfile=dist/plugin.js",
"dev": "npm run build -- --watch"
```

`dist/plugin.js` is committed, because the editor loads it straight from the repository at
whatever version the address names. The shared workflow in
[`scm-js/.github`](https://github.com/scm-js/.github) does the rest. A plugin repository
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

It type-checks, tests, rebuilds the bundle and commits it on a push to `main`. At a `v*`
tag it rebuilds and *checks* instead, so the bundle a pinned plugin runs is provably what
its source builds to (esbuild's output is deterministic, and the bundle carries no commit
hash or date for that reason). The weekly run type-checks against the newest
`@scm-js/plugin-api`, so a change in the contract turns a check red instead of going
unnoticed.

Ship the bundle unminified. What the Add screen offers a user is your repository, and a
plugin they cannot read is a plugin they cannot judge.

### What your users see

Three things follow from **What you are trusting** above and are worth writing for:

- **Your manifest is all they see before deciding.** Fill in the name, version, author,
  description, icon, repository and homepage. It is the only thing a user has to judge
  you by.
- **They are pinned to a commit and never auto-updated.** Installing stores the commit
  your address pointed at, so a push of yours reaches nobody already running the plugin.
  They move forward with the update check on the row, which shows them the new manifest
  first. Tag
  your releases: a tag is what the registry lists, and what a considered version looks
  like from the outside.
- **They may be running a copy saved in their browser.** That copy is replaced only when
  they press Reload.

### Getting listed

The project's registry, [`scm-js/registry`](https://github.com/scm-js/registry), is
generated from the organisation itself: every repository named `plugin-…`, or carrying
both the `scmjs` and `plugin` topics, is listed with the `plugin.json` at its newest
version tag (an untagged repository falls back to its default branch). It refreshes hourly
and within about a minute of a plugin repository saying it changed.

For a plugin outside the organisation, open a pull request against that repository's
`plugins.json`; its README has the shape of an entry. Any URL serving a file of that shape
is a registry, and a user can add one under Sources.

## The API, group by group

The complete typings are the package's own `index.d.ts`, and every call has a page at
[docs.scmjs.dev/api](https://docs.scmjs.dev/api/). This part is the tour: what each group
is for, how the pieces fit together, and the rules a signature does not show. Every method
that reads the map answers `null`, `[]` or `false` when no map is open, rather than
throwing.

### Asynchronous calls, and the one synchronous builder

**Everything asynchronous returns a promise.** There is no completion callback and no
`(err, result)` pair anywhere in the API. `await` the call and read the answer. When the
user dismisses something (Esc, Cancel, a right-click, the ×), the promise resolves with
`null` or `false` rather than rejecting, so the ordinary path needs no `try`. That covers:

- opening, saving, exporting and rendering a map: `document.open`, `create`, `save`,
  `saveAs`, `close`, `export`, `renderImage`, `changeTileset`;
- loading game data: `tileset.load`, `data.load`, `graphics.load`, `terrain.checkIsom`,
  and installing, switching and removing a data set through `gameData`;
- everything that waits for the user: `ui.pickArea`, `pickTile`, `pickFiles`, `saveFile`,
  `loadImage`, `readClipboardImage`, `confirm`, `alert`, `prompt`, `ask`.

```ts
const rect = await api.ui.pickArea({ prompt: "Pick an area to flatten" });
if (!rect) return;                       // Esc, a right-click, or no map
await api.tileset.load();                // the graphics the fill needs
api.document.edit("Flatten", tx => tx.stampTerrain(rect, terrainId));
```

`activate` itself may be `async`; the editor awaits it before the plugin counts as loaded.
So may a dialog button's `run`, which keeps the dialog open until it settles and closes it
on anything but `false`.

The callbacks that remain are real callbacks rather than deferred answers: event
listeners (`api.events.on`), the DOM handlers of `ui.widgets`, a dialog's or panel's
`mount`, and the pointer and `draw` hooks of `ui.mapTool` and `ui.overlay`. Each returns
a `Disposable` or a cleanup function, so there is no `off()` to pair up and nothing to
unregister at deactivation.

**The one exception is a transaction's builder.** `document.edit(label, build)` and
`document.update(label, build)` take a *synchronous* `build`. Its operations apply as they
are called, and the transaction commits the moment `build` returns. An `async` builder
would commit whatever ran before its first `await` and let the rest change the map
outside that entry, where undo cannot reach it. TypeScript refuses one, and the editor
also catches it at runtime for a plugin written in plain JavaScript: the result's `notes`
and the console say so.

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

Long work of your own gets a progress panel that does not block the editor.
`handle.cancelled()` is the poll and `handle.signal` is an `AbortSignal` with the same
answer, so anything that takes one stops with the panel:

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

Everything a plugin can change about the open map goes through one of three calls. They
are the editor's own three ways of writing (a brush stroke, a dialog's OK, a raw file
edit) and they differ in what they cost:

| | What it covers | Undo |
| --- | --- | --- |
| `document.edit(label, build)` | Terrain and objects: tiles, ISOM, units, sprites, doodads, locations, fog. | One history entry, like a brush stroke. |
| `document.update(label, build)` | The tables and settings: triggers, briefing, the string table, switch names, the scenario's name and description, players, forces and colours, unit / upgrade / technology settings, sounds, the map revision. | None. It is a settings-dialog transaction, as in StarEdit. |
| `document.sections.*` | The file's own bytes, any section, modelled by the editor or not. | None, and the undo history is dropped, as after Resize. |

Both transactions apply their operations **as they are called**, so a later operation
sees the result of an earlier one, and both commit once at the end. That is why the
builder is synchronous.

### `api.document`

The open map as a whole: opening, saving and closing it, its properties, and the entry
points to the three kinds of write.

| | |
| --- | --- |
| `isOpen()` | Whether a scenario is loaded. |
| `info()` | `{ name, description, width, height, tileset, era, version, fileName, modified }`. |
| `scenario()` | The live `Scenario` object, for **reading**. Changing it directly bypasses undo and dirty tracking. |
| `edit(label, build)` | Run `build(tx)` and record what it did as one undo entry named `label`. Returns an `EditResult` with counts per list. |
| `update(label, build)` | The tables and settings as one settings-style transaction (see `UpdateTransaction`). Not in the undo model. Returns an `UpdateResult`. |
| `undo()` / `redo()` | The Edit menu's. |
| `history()` | `{ undo, redo, undoDepth, redoDepth }`: the labels the Edit menu shows and how deep each stack is, without moving anything. A plugin can tell whether its own edit is still the top entry before undoing it. |
| `open(file, fileName?)` | Open a map file (`File`, `Blob` or bytes; `.scx`, `.scm` or `.chk`) in place of the current one, as File ▸ Open does. A modified map goes through the Close Scenario dialog first when Preferences say to ask. Resolves `true` once the file is the open document, `false` when the user kept the current map or the file could not be read (the status bar says which). |
| `create({ width, height, tileset, name?, description?, terrainId?, startLocations?, startLayout? })` | A blank map in place of the current one, as File ▸ New makes one: flat ground of the tileset's default terrain (or `terrainId`), an ISOM lattice to match, and every section a fresh map needs. Goes through the same unsaved-changes gate as `open`. `startLocations` lays one down for each of players 1..N as `tx.placeStartLocations` would (`"ring"` unless `startLayout` says `"corners"`); they are part of making the map, so there is no history entry to undo them from. |
| `export({ format?, fileName?, saveOptions? })` | The open map as a `File`, as Save writes it: the save options last confirmed for this map (or their defaults), archive extras included, as `scx`, `scm` or a bare `chk`. `saveOptions` overrides compression, encryption and what is left out. Null with no map. Hand it to a `FormData` and it uploads. |
| `save({ copy? })` / `saveAs({ copy? })` | File ▸ Save and Save As. `save` writes back where the map came from with its remembered options, and a map with no file yet goes through the Save dialog; `saveAs` always opens it. `copy` writes a copy and leaves the document's name and clean state alone. Resolve `true` once written, `false` when the user dismissed a dialog or the write failed. |
| `close()` | File ▸ Close, through the same unsaved-changes gate as `open`. `true` once the map is gone. |
| `changeTileset({ tileset, terrainId?, keepTiles? })` | Map Properties' tileset change: the terrain is laid again with `terrainId` (the new tileset's default when omitted) after the new graphics load, the doodads go, and everything else stays. `keepTiles` changes only the tileset id. Outside the undo model; drops both history stacks, like `resize`. |
| `renderImage({ pixelsPerTile?, … })` | A PNG `Blob` of the map as File ▸ Export ▸ Image draws it. 32 pixels per tile is the game's art, 1 is a minimap. Needs the tileset graphics; null without them or without a map. |
| `resize({ width, height, anchor?, terrainId?, clampLocations? })` | Scenario ▸ Resize / Crop Map: content keeps its place relative to the anchor (a 3 × 3 grid, 4 = centre), new ground is `terrainId` or the tileset's default, objects outside the new bounds are dropped and locations clamped. Outside the undo model; **drops both history stacks**, as the dialog does. Returns the `ResizeResult` (what was dropped), null with no map. |
| `extras` | The files stored in the archive next to `staredit\scenario.chk`: custom sounds, and anything a plugin wants to keep with the map. `list()`, `get(name)`, `set(name, bytes)`, `remove(name)`. Names are archive paths with backslashes; keep yours under a folder of your own (`my-plugin\notes.json`). `set` and `remove` mark the map modified, and the members are written on the next Save. |
| `sections` | The scenario at the byte level. See the next section. |

### `api.document.sections`

The map file as a list of sections, the way the game reads it and Save writes it, with
unsaved edits already encoded. Section Explorer is built on the reads and writes; Repair
on the helpers.

**Reading.** `list()` gives every occurrence in file order as a `SectionInfo`: `index`,
the four-character `name`, `offset`, `size`, `declaredSize` and `truncated` for a file
that ended early, `occurrence` / `occurrences` for a repeated name, `dirty` when the
editor holds changes it will encode there, and `spec`, which is what the editor knows
about that name (`what`, the combine `mode` on repeat, the fixed `size` the game reads for
this map or null, the record `stride` of a list, and `modelled`, whether the editor
decodes it). `bytes(index)` is a copy of one occurrence's payload, `combined(name)` the
bytes the game acts on with repeats folded the way the game folds them, `file()` the whole
file, and `spec(name)` / `known()` the section table.

**Writing.** `write(index, bytes)`, `rename(index, name)`, `insert(index, name, bytes)`,
`remove(index)`, `move(from, to)` and `replaceFile(bytes)` are a different kind of
transaction from `edit`. The edited file is parsed again from scratch and installed as the
open document, so the change reaches every part of the editor whether or not it models the
section. As with Resize, the undo history is dropped and every selection cleared; the map
is marked modified and the `"document"` event fires with reason `"replace"`. Each returns
`{ warnings }`, what the parser said of the result. A bad index or a name longer than four
characters throws, and so does any write without a map. Indices shift when a section is
inserted or removed before them, so take a fresh `list()` after every edit.

**Helpers for a repair.**

| | |
| --- | --- |
| `trailing()` | The bytes after the last chunk the reader could act on (what follows a header with a negative length, say). Save writes them back as they are; a `replaceFile` without them drops them. |
| `required()` | The section names a file of the open map's revision must carry to load, as Check Map tests them (`STRx` in place of `STR ` on a Remastered file). |
| `defaults(name)` | The bytes File ▸ New would write for that section on a map of this size, tileset and revision: StarEdit's defaults for a settings table, the fixed VCOD, an empty list, null terrain. Null for a name the editor cannot produce. |
| `rebuild(names?)` | Re-encode sections from the editor's model, the way Save writes a dirty one, and install the result like any other raw edit. Repeated occurrences collapse into one, a truncated or oversized section comes back at the size the model encodes to, and a string table whose offsets point nowhere is rewritten with every string the editor could read. Names the editor does not model, and modelled ones whose model is absent (no ISOM, no settings table), are left alone and missing from the result's `rebuilt`. Omit `names` for every modelled section the map has a model for. |

### `EditTransaction`

What `document.edit` hands its builder. `tx` applies each operation immediately, so a
later operation sees the state the previous one left: a `tileAt` after a `setTile` reads
the new tile. When `build` returns, the transaction lifts the doodads the terrain edit
broke, removes the units the new ground cannot hold (when *Remove stranded units* is on,
as for a stroke), commits, and repaints.

| Terrain | |
| --- | --- |
| `tileAt(x, y)` / `groundAt(x, y)` | MTXM / TILE at a cell. |
| `setTile(x, y, id)` | One tile, both sections. |
| `setTiles(cells, id)` | Many. `cells` is a `Rect` or cell indices (`y * width + x`). |
| `stampTerrain(cells, terrainId, variation?)` | The Rect brush: flat pairs by column parity, one random variation per pair. Needs the tileset graphics. Returns tiles changed. |
| `fillFlat(rect, terrainId)` | Lay terrain the way a new map is laid, ISOM lattice included. |
| `rebuildIsom()` | Reconstruct the ISOM from the tiles, for a map that arrived without one or whose lattice no longer matches after Rect / Tile edits. Exact for terrain laid down isometrically, a best guess under doodads and for hand-placed tiles. A missing or wrongly sized ISOM is created (undo removes it again); an existing one gets only the diamonds that differ. Needs the tileset graphics; null without them, else `{ created, changed, diamonds, unresolved }`. |
| `paintIsom(diamond, terrainId, extent = 1)` | The isometric brush on one diamond: sets the ISOM and generates the cliff and shore tiles around it. Needs ISOM and the tileset. |
| `tilesFromIsom()` | The reverse of `rebuildIsom`: every tile regenerated from the lattice, what StarEdit does after an isometric edit. Needs ISOM and the tileset. Tiles changed, or null. |
| `replaceTerrain(from, to, rect?)` | Tools ▸ Replace Terrain: every tile matching `from` (`{ kind: "terrain", id }` for a flat terrain by ISOM id, `{ kind: "tile", id }` for one exact tile) becomes `to`, over `rect` or the whole map, pairs laid as the Rect brush lays them. Returns tiles changed. |
| `fillArea(x, y, { terrainId } \| { tileId }, match?)` | The bucket fill: the connected area of the same terrain type (`"terrain"`, the Rect fill's reading; needs the graphics) or the same exact tile (`"tile"`), mirrored under the symmetry mode, laid with a terrain or set to a tile. |
| `placeBlend(x, y, side, id)` | The Blend brush: `id` on the cell beside the anchor on `side`. `terrain.blendCandidates` says what fits. |
| `mirror(cells)` / `mirrorPoint(px, py)` | The cells' (or the pixel's) images under Tools ▸ Symmetry, the way the built-in brushes and palettes take them. |

| Objects | |
| --- | --- |
| `makeUnit(unitId, owner, x, y)` | A StarEdit-style record (serial, masks) at map pixels. |
| `addUnits(records)` / `removeUnits(indices)` / `updateUnits(indices, patch)` | |
| `moveUnits(indices, dx, dy, snap?)` | Shift by a pixel delta. With `snap` (the palette's option by default) the *destination* is snapped: a building to the tile grid by its placement box, anything else to the nearest tile centre. A unit that sits off the grid is brought onto it. |
| `placeStartLocations({ players, layout?, margin?, replace? })` | Tools ▸ Auto-place Start Locations: one per player (from 1) on a `"ring"` or in the `"corners"`, each moved to the nearest spot the placement checks accept. `replace` removes the existing ones first. Returns `{ changes, placed, removed }`; `placed` is null for a player nothing within reach fit. |
| `placeUnit(unitId, owner, x, y)` | A unit the way the Units palette places one: with its *Snap to grid* on, a building's placement box goes on the tile grid and anything else on the nearest tile centre; nothing leaves the map. Returns the index. Makes no checks. |
| `canPlaceUnit(unitId, x, y)` | The palette's collision and terrain checks with its current options. Ask this before `placeUnit` if you want them. |
| `makeSprite(kind, id, owner, x, y, opts?)` / `addSprites` / `removeSprites` / `placeSprite(...)` | `placeSprite` is make + add, kept on the map. Returns the index. |
| `updateSprites(indices, patch)` / `moveSprites(indices, dx, dy)` | Owner, flags, position, in place, so indices hold. |
| `placeDoodad(doodadId, tx, ty, owner)` / `removeDoodads(indices)` / `updateDoodads(indices, { owner?, disabled? })` | Doodads stamp tiles and may carry an overlay sprite. All three keep the tiles, the record and the overlay together. |
| `addLocation(bounds, name?, elevationFlags?)` / `editLocation(index, patch)` / `removeLocations(indices)` | Slot 63 (Anywhere) and unused slots are refused by `editLocation`. `addLocation` also puts Anywhere back if it was missing. |
| `restoreAnywhere()` | Anywhere back to the whole map. `true` when it had to move. |
| `setFog(cells, players, "fog" \| "clear")` | `players` is a bit mask. Creates MASK on first use. |
| `invertFog(players)` / `copyFog(from, toMask)` / `floodFog(x, y, player, players, mode)` | The Fog palette's other three: flip the bits, copy one player's fog onto the players in a mask, fill the connected area that shares one player's state. |
| `note(text)` | A line for the status bar, alongside the label. |

### `UpdateTransaction`

What `document.update` hands its builder: the second kind of write. Operations apply
immediately (a string interned on one line is in the table for the trigger added on the
next), and the commit at the end marks the map modified and tells the chrome to re-read.
The result is `{ changed, sections, notes }`: `sections` lists the file sections actually
touched (`["TRIG", "STR "]`), so `changed` is false when every operation was a no-op.

| Triggers | |
| --- | --- |
| `tx.triggers` | TRIG as a list: `list()`, `count()`, `set(list)`, `add(trigger, at?)`, `replace(index, trigger)`, `remove(indices)`, `move(from, to)`, `fromText(source, { replace? })`. |
| `tx.briefing` | MBRF, the same shape. |

| Tables | |
| --- | --- |
| `tx.strings` | `list()`; `intern(text)` (an identical entry, else a new one; it **never** overwrites, because the old index may be shared with a trigger); `set(index, text)` (overwrite one slot, so everything pointing at it sees the new text; slot 0 is refused); `apply(list)` (a whole table; unreferenced trailing blanks are dropped, every other index keeps its place); `import(text)` (File ▸ Import ▸ Strings' `index<TAB>text` form, see `api.exchange`). |
| `tx.switches` | `names()` (256 entries, `""` where a switch has none) and `setName(index, name)`. Creates SWNM on the first name. |
| `tx.properties({ name?, description? })` | The scenario's name and description. `""` restores the file-name default. |
| `tx.note(text)` | A line for the status bar. |

| Settings | |
| --- | --- |
| `tx.players` | `list()` gives the 12 slots as `PlayerSlotView`s: 0-based `slot`, `type` / `typeName`, `race` / `raceName`, and for the eight playable slots `color` (COLR index), `colorHex`, `rgb` (the Remastered custom colour in effect, else null), `force` (0-based) / `forceName`. `set(slot, { type?, race?, color?, rgb?, force? })` writes one. `rgb: [r, g, b]` sets a custom colour, `rgb: null` puts the slot back on its palette colour; the custom-colour section is dropped again when every slot is back. OWNR is always written with IOWN. |
| `tx.forces` | `list()` gives four `ForceView`s (`name`, `flags` and the `allied` / `alliedVictory` / `sharedVision` / `randomStart` booleans, `players`: the 0-based slots in the force). `set(force, { name?, allied?, alliedVictory?, sharedVision?, randomStart?, flags?, players? })`; `players` moves those slots into the force. |
| `tx.unitTypes` | `get(unitId)` gives a `UnitTypeView` with the *effective* numbers (units.dat's where the type is on "use default"; hit points in whole points), the type's weapons with their effective damage, `defaults` (the dat's numbers, null without the game data) and `availability` (`defaultAvailable` and per player `true` / `false` / `"default"`). `set(unitId, patch)`: setting any number turns "use default" off for the type and seeds its untouched columns from the dat, as the dialog does; `useDefault: true` puts it back; `name` is the custom name (`""` restores the default; the string is interned); `weapons: [{ id, damage?, bonus? }]`; `available: [{ player: 0-based or "default", value: true / false / "default" }]`. Which of UNIS / UNIx is written follows the file's revision. |
| `tx.upgrades` | `get(upgradeId)` gives an `UpgradeView` (effective costs and factors, `defaults`, `levels`: the default start and cap and each player's effective `{ start, max, usesDefault }`). `set(upgradeId, { useDefault?, mineralCost?, mineralFactor?, gasCost?, gasFactor?, timeCost?, timeFactor?, levels? })` with `levels: [{ player: 0-based or "default", start?, max?, useDefault? }]`. |
| `tx.techs` | `get(techId)` gives a `TechView` (effective costs, `defaults`, `state`: the default column and each player's effective `{ available, researched, usesDefault }`). `set(techId, { useDefault?, mineralCost?, gasCost?, researchTime?, energyCost?, state? })` with `state: [{ player, available?, researched?, useDefault? }]`. |
| `tx.sounds` | `list()` gives the WAV slots in use as `SoundRow`s (`slot`, `path`, `present`, `size`, `usedBy`). `add(path, bytes?)` takes the first free slot, or the slot the path already has; with `bytes` the file goes into the archive under `staredit\wav\`. `remove(slot, deleteFile?)`. |
| `tx.cuwp` | Triggers ▸ Unit Properties Slots. `list()` / `get(index)` give `CuwpSlotView`s: 0-based `index`; `hitPointsPercent`, `shieldsPercent`, `energyPercent`, `resources`, `hangar` as numbers, or null where the created units keep the type's default; `cloaked` … `invincible` as booleans or null; `used`, `references`, `summary`. `set(index, patch, used?)`: a number sets the field and its "applied" bit, null clears it; a boolean forces a state, null leaves it. `clear(index)`. The *Create Unit with Properties* action stores the slot 1-based in `target`. |
| `tx.setVersion(version, extendedStrings?)` | Scenario ▸ Map Revision: `"original"`, `"hybrid"`, `"broodwar"` or `"remastered"`. Sets VER and TYPE, and the string table's width (STR ↔ STRx) when moving to or from Remastered. |

Ids are the game's: units.dat ids for `unitTypes`, upgrades.dat and techdata.dat ids for
the other two (`api.names.units()` / `upgrades()` / `techs()` list them with their names).
Players are 0-based here, as in the records; the chrome shows `slot + 1`.

```js
const { condition, action, comparison, player } = api.consts.triggers;

api.document.update("Add a countdown", (tx) => {
  const trigger = api.triggers.newTrigger([player.Player1]);
  const timer = api.triggers.newCondition(condition.CountdownTimer);
  timer.comparison = comparison.AtMost;
  timer.amount = 30;
  trigger.conditions[0] = timer;

  const say = api.triggers.newAction(action.DisplayText);
  say.text = tx.strings.intern("30 seconds remaining");   // interned above, readable here
  trigger.actions[0] = say;
  trigger.actions[1] = api.triggers.newAction(action.PreserveTrigger);
  tx.triggers.add(trigger);
});
```

There is no undo entry, so a plugin that wants one keeps its own copy of what it replaced:
`api.triggers.list()` before, `tx.triggers.set(...)` to put it back.

### `api.settings`

The same views as `tx.players`, `tx.forces` and the rest, for reading without a
transaction: `players()` / `player(slot)`, `forces()`, `unitType(id)` / `unitTypes()`
(every type with a name), `upgrade(id)` / `upgrades()`, `tech(id)` / `techs()`,
`sounds()`, `unitAvailable(player, unitId)` (resolved against its default), `cuwpSlots()`
/ `cuwpSlot(index)`, and `version()` (`{ version, label, fileVersion, type,
extendedStrings, extension }`). Empty lists and nulls with no map. Writing goes through
`document.update`.

### `api.triggers`

Reading triggers, and everything needed to *show* one. Writing is `document.update`.

| | |
| --- | --- |
| `list()` / `briefing()` | TRIG / MBRF, cloned. A record is 16 conditions and 64 actions of plain numbers; the editor's codec knows no types. |
| `defs` | What each type means: `conditions()`, `condition(type)`, `actions(briefing?)`, `action(type, briefing?)`. Each def carries `args`, the argument list in the order StarEdit's TrigEdit shows it, each `{ kind, field, label }`: which record field holds the argument and what kind of value it is. The editor's own trigger dialogs and the text printer read this same table. |
| `defs.choices(kind)` / `choiceLabel(kind, value)` / `choiceValue(kind, text)` | The values an enumerated argument can take (comparisons, switch states, resource types, orders …), with their labels and aliases. |
| `text.print(list, { briefing? })` / `text.one(trigger)` / `text.parse(source)` | The text trigger format, resolved against the open map's names. `parse` throws a `TriggerTextError` carrying the line. |
| `names()` | The `TriggerNames` context those use: the map's locations, units, switches and strings, by name and by number. |
| `newTrigger(players?)` / `newCondition(type)` / `newAction(type, briefing?)` | Blank records with StarEdit's defaults. |
| `isPreserved(t)` / `setPreserved(t, on)` | The preserve-trigger flag. |
| `triggersFor(list, groups)` | Indices of the triggers any of those player groups own. |
| `summarize(t, briefing?)` | The three lines the trigger list shows: players, conditions, actions. |
| `comment(t)` | A trigger's `Comment` action text, if it has one. |
| `switchNames()` / `switchUsage()` | SWNM, and how many conditions and actions mention each switch. |
| `claim(spec)` | Mark a run of the trigger list as *generated* by this plugin. See below. |

**Generating triggers.** There is no fluent builder here on purpose, because
`tx.triggers.fromText` already is one, and a better one. A record is 16 conditions and 64
actions of bare numbers, so building one field by field means knowing which field each
argument lives in (`defs.action(type).args` will tell you, but you have to ask). Writing
the trigger in the text format instead means writing what the map maker would read in the
Text Trigger Editor, with the names resolved against the open map for free.

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

`fromText` parses, interns the strings the text names, resolves `"Beacon Alpha"` against
the map's own locations, and appends (or replaces the list with `{ replace: true }`).
`triggers.text.parse` is the same parse without the write, for a plugin that wants the
records first, and `text.print` goes the other way, so a plugin can read what it wrote.
Reach for `newTrigger` / `newCondition` / `newAction` when editing one field of an
existing record, not when producing a run of them.

**Claiming generated triggers.** `claim(spec)` tells the editor that a run of the trigger
list is generated by this plugin. The Trigger Editor badges those rows (`spec.badge`, the
plugin's id by default), locks them, and shows `spec.describe(index, list)` with a button
that calls `spec.open(index, list)` (`spec.openLabel`, "Open <plugin name>" by default) in
place of the form. The Text Trigger Editor fences the run in comments, and Import Triggers
says what a replace would remove. The run is found by content: `spec.locate(list)` is asked
with whatever list an editor holds (the map's, or a working copy with local inserts in
it) and answers `{ start, count }`, or null when the records are not there because they
were edited by hand or removed. So keep a hash of what you generated and look for it, as
the Trigger Script plugin does. `spec.label` is the words a sentence uses ("the trigger
script"). The handle has `refresh()`, for after a rebuild so editors ask `locate` again,
and `remove()`. The claim leaves with the plugin.

### `api.query`

Reading the open map: what is where, and the analyses the editor already does. Nothing
here writes, and everything answers empty without a map. A linter plugin is `validate()`
plus `find()` plus `view.goTo` and nothing else.

| | |
| --- | --- |
| `unitAt(px, py)` / `spriteAt(px, py)` / `doodadAt(tx, ty)` / `locationAt(px, py)` | The topmost thing under a point, or -1. The same hit-testing the layers use: a sprite's box comes from its loaded graphic, a unit's from units.dat. `locationAt` never picks Anywhere. |
| `unitsIn(rect)` / `spritesIn(rect)` / `locationsIn(rect)` | Units and sprites whose centre is in a tile rect; locations wholly inside it. |
| `unitsOf(owner)` | Every unit a player owns (0-based). |
| `startLocations()` | `{ index, owner, x, y, tx, ty }` per start location, by player. |
| `placement(unitId, x, y)` | The Units palette's verdict: `{ problem: "terrain" \| "collision" \| null, blocker, reason }`. `reason` is the problem in words ("the ground is unwalkable", "it overlaps Terran Marine"), null when it fits. Null with no map. |
| `fogAt(tx, ty)` | The MASK bits at a tile (bit n = player n + 1 starts fogged; every bit when the map has no MASK). |
| `strings()` | The string table as it stands. |
| `validate()` | Check Map's `Issue[]`: `{ level, text, where, target? }`, where `target` is what `view.goTo` takes. |
| `statistics()` | Tools ▸ Statistics: tile, terrain, unit, resource and per-player counts, the briefing's too. |
| `find(options)` | The Ctrl+F search: `{ kind: "units" \| "locations" \| "sprites" \| "doodads" \| "strings" \| "triggers" \| "briefing", query, matchCase?, limit? }` → `{ kind, index, label, detail, x?, y? }[]`. |
| `stringUsage()` / `unusedStrings()` | Which records refer to each string index, and which slots nothing refers to. |

### `api.view`

Where the viewport is looking. A plugin that finds something needs this to show the user
where it is.

| | |
| --- | --- |
| `zoom()` / `setZoom(z)` | Clamped to 0.05…8 (the zoom control's own steps run 0.25…4). |
| `visible()` | The tiles on screen, as a `Rect`. |
| `center(x, y)` | Scroll so a tile is in the middle. |
| `goTo(target)` | `{ kind: "tile", x, y }`, or `{ kind: "unit" \| "sprite" \| "location", index }`: scrolls there and selects the object. An `Issue.target` from `query.validate()` is one of these. |
| `cursorTile()` | The tile under the pointer, as the status bar shows it. |
| `flags()` / `setFlags(patch)` | The View menu's ticks: `grid`, `locations`, `locationNames`, `units`, `sprites`, `doodads`, `fog`, `elevation`, `buildability`, `startLocations`, `animateWater`, `animateUnits`. |
| `gridSize()` / `setGridSize(8 \| 16 \| 32 \| 64 \| 128)` | Grid spacing in map pixels. |
| `flash(target)` | Highlight something on the map for a moment: `{ rect }` (tiles), `{ units: [i…] }`, `{ locations: [i…] }` or `{ tiles: [{ x, y }…] }`, each with an optional `kind` (`"change"`, gold, the default, or `"attention"`, teal) and `ms` (600). It swells a little and fades by itself, several may run at once, and it never takes the pointer. The shared way to say "this just changed" or "look here", so every plugin's flash looks the same. |

### `api.data`

The game's own tables as the editor decoded them (`units.dat` and its neighbours), for
the numbers `api.names` only labels: hit points, costs, build times, armour, weapons,
flags, and the sprite and image each unit draws through. `ready()`, `load()`, then
`units()`, `weapons()`, `upgrades()`, `techs()`, `sprites()`, `flingy()`, `images()`,
plus `race(unitId)` and `imagePath(imageId)`. Everything is null until the tables are
loaded, and stays null when the game data was never extracted. Degrade, do not throw.

### `api.gameData`

Which set of game files the editor draws from (the game's own, or a mod's that replaces
them in the same formats), and installing, switching and removing sets. This is the
plugin side of Help ▸ Game Data….

| | |
| --- | --- |
| `source()` | Where the files come from: `kind`, a `label`, the `profile` they belong to, `desktop` when the app extracted them. Null while startup is still resolving. |
| `profile()` / `profiles()` | The data set in use, and every set with a copy here (the game's own first). |
| `install(profile, files, progress?)` | Extract a set from its files and switch to it. |
| `select(id)` | Switch sets, dropping everything decoded from the previous one and redrawing. A set with no copy falls back to the game's own. |
| `remove(id)` | Drop a copy. |

The `"gameData"` event fires on any of them. `files` is `{ archives, files? }`: the
archives, with `StarDat.mpq` and `BrooDat.mpq` among them (a mod replaces files, it does
not bring the rest; the game's own are read first, then the others in the order given,
later winning), and loose files by member path (`arr/units.dat`), read before any archive.
A `File` from `ui.pickFiles` or a `Uint8Array` both serve.

A data set is a name over files in the game's own formats. The table sizes, the tileset
formats and the map file's fixed-width sections are the game's, so a mod that extends
them past 228 unit types or into an extended `.dat` layout is not covered. What *is*
covered follows on its own: `data` decodes the set's tables, `tileset` and `graphics`
draw its files, and `names` shows what it renamed. A plugin written for the game's own
data can read `profile().id` (`"starcraft"` is the game's) and grey itself out under any
other.

### `api.consts`

The numbers a record is *written* in, so a plugin does not carry the hex itself. These are
the editor's own tables, the very objects its codec encodes with, handed over at run time
rather than copied.

| | |
| --- | --- |
| `tile` | 32, map pixels to a tile. UNIT and THG2 store pixels; MTXM, MRGN and the brushes count tiles. |
| `unit.startLocation` | 214, the Start Location marker. |
| `unit.mineralFields` / `unit.vespeneGeyser` | `[176, 177, 178]` and 188. `isResource(unitId)` is either. |
| `unit.defaultMinerals` / `unit.defaultGas` | 1500 and 5000, what StarEdit writes on a fresh resource. |
| `unit.valid` / `unit.used` / `unit.state` / `unit.relation` | The four UNIT bit masks: `validProperties` (which special-property fields the game reads), `validStates` (which of the record's fields are set at all), `stateFlags` (the properties themselves), `relationType` (`NydusLink`, `Addon`). |
| `sprite.flags` | THG2's `PureSprite` / `Flipped` / `Disabled`. `PureSprite` decides whether `spriteId` is a sprites.dat id the game only draws, or a units.dat id it creates the unit for. |
| `location.anywhere` | 63. That slot is Anywhere, and the editor protects it everywhere: no builder returns it, `locationAt` never picks it, the viewport draws no box for it. `tx.restoreAnywhere()` puts it back. |
| `location.elevation` | `elevationFlags`. A **set** bit *excludes* that elevation, so 0 means everywhere. |
| `triggers` | The numbers a TRIG / MBRF record is written in. See below. |

**`consts.triggers`.** A trigger record is sixteen conditions and sixty-four actions of
plain numbers, and `triggers.defs` only says which *field* each argument lives in. This
says what to put in it. `condition` and `action` (and `briefingAction`, where the same
byte means something else) are the type numbers; `player` holds the 27 player-group
values, which are also the indices of a trigger's own `players` array; and the rest are
the enumerated arguments: `comparison`, `switchState`, `switchAction`, `modifier`,
`unitState` (Set Doodad State / Set Invincibility), `order`, `alliance`, `resource`,
`score`, and `unitClass` for the four ids past units.dat (*Any unit*, *Men*, *Buildings*,
*Factories*). `conditionFlags`, `actionFlags` and `triggerFlags` are the flag bits, and
`deathsTable` is the address an EUD player value is counted from
(`epd = (address - deathsTable) / 4 + 0x2000`).

Those argument keys are `ArgDef.kind`, so a generic argument editor can look one up with
the kind the def handed it:

```js
const arg = api.triggers.defs.action(record.type).args[0];
const values = api.consts.triggers[arg.kind];      // e.g. { AtLeast: 0, AtMost: 1, Exactly: 10 }
```

For *generating* a run of triggers, `tx.triggers.fromText` is still the better tool: it
resolves location and unit names against the open map, which no constant can. These are
for editing a field of an existing record, and for reading one back
(`record.type === api.consts.triggers.condition.Bring`).

Why this is on `api` and not in the npm package: `@scm-js/plugin-api` is types only, and
`import type` is erased before the loader sees the specifier, which is exactly what lets a
plugin depend on a package at all. A *value* imported from it type-checks and is then
undefined at run time. Anything you need while the plugin runs has to arrive on `api`.

### `api.graphics`

The pictures the viewport draws, for a plugin's own lists and previews. Nothing is
rendered anew: a unit or sprite frame comes out of the same cache the viewport blits
from, so listing five hundred units costs about what the Units palette costs.

| | |
| --- | --- |
| `ready()` / `load()` | `{ tileset, units }`: whether the graphics and the tables are in memory, and a fetch for both. |
| `unitImage(unitId, { owner? })` | A `{ image, width, height }` canvas in the player's colours, in the unit's editor pose. |
| `spriteImage(kind, id, { owner?, flipped? })` | The same for a THG2 sprite. |
| `tileImage(tileId)` | One 32 × 32 megatile of the open map's tileset. |
| `doodadImage(doodadId)` | A doodad drawn from the tiles it stamps. |
| `renderRect(rect, options?)` | Part of the map as File ▸ Export ▸ Image draws it, cropped to a tile rect, as a PNG `Blob`. `pixelsPerTile` defaults to 8 here. |
| `playerColor(owner)` | `#rrggbb`. |
| `requestUnit(id)` / `requestSprite(kind, id)` / `onImageLoaded(fn)` | Graphics load lazily, so the first `unitImage` for a type is often null. Ask for it, redraw on `onImageLoaded`, and the list fills in. |

### `api.commands`

Named things a plugin can do, so that a menu item, a hotkey, a context entry and another
plugin all reach the same one.

```js
api.commands.register({ id: "convert", title: "Convert Image…", run: () => open() });
api.menu.add("Tools", { label: "Convert Image…", command: "convert" });
api.hotkeys.add("Ctrl+Shift+I", { command: "convert" });
```

`register(spec)` returns a `Disposable`. `run(id, ...args)` runs one, whoever registered
it (`undefined` when there is no such command or its `enabled()` says no); `has(id)` and
`list()` (`{ id, title, pluginId, enabled }[]`) see every plugin's. An id without a dot is
namespaced under the plugin (`"convert"` → `"image-to-terrain.convert"`); one with a dot
is taken as it is, so a plugin can publish a stable name for others to call.

### `api.terrain`

Read-only helpers over the current tileset, plus the Terrain palette's own pick and the
symmetry mode.

| | |
| --- | --- |
| `types()` | The paintable flat terrains, with name, group, height and buildable. |
| `isomTypes()` / `hasIsom()` | The ids the isometric brush can paint, and whether the map has an ISOM section. |
| `tileInfo(id)` | What the tileset says about one tile. |
| `terrainAt(tx, ty)` | The terrain id (as `types()` lists them) a tile belongs to: its own group when it is flat ground, else what the ISOM lattice says there (under a cliff, one of the two terrains it joins). Null when neither tells. |
| `color(tileId)` / `terrainColor(terrainId)` | The tile's average colour (`0xRRGGBB`), and the mean of a terrain's common variations. |
| `heightOf(terrainId)` | 0 low, 1 high, 2 higher. Null for anything that is not a flat terrain. |
| `flatGroupOf(terrainId)` | The even CV5 group of a flat pair. |
| `diamondAt(px, py)` / `isDiamond(d)` / `diamondsIn(rect)` | The ISOM lattice: the diamond under a pixel, whether a value is one, and every diamond whose centre tile is in the rect. |
| `floodRegion(x, y, match?)` | The bucket fill's area, by terrain type or exact tile. |
| `blendCandidates(anchorTileId, side, options?)` | The Blend palette's ranked list, with the pixel distance of each seam. |
| `active()` / `setActive(...)` | The palette's brush, terrain, tile, size and Rect variation. |
| `symmetry()` / `setSymmetry(mode)` | Tools ▸ Symmetry: `"none"`, `"h"`, `"v"`, `"hv"`, `"rot180"`, `"rot90"`, `"diag"`, `"adiag"`. |
| `symmetryAvailable(mode)` | The last three need a square map. |
| `mirror(cells)` / `mirrorPoint(px, py)` | The images the built-in brushes paint and the palettes place on, so a plugin edit can honour the user's setting the way `tx.fillArea` does by itself. |
| `checkIsom()` | Asynchronous. Waits for the tileset graphics (rejecting when they are missing) and resolves with how well the ISOM describes the tiles: `rects` measured, `mismatched` among them, `stale` when the share is past what the palette warns at. Null when the map has no ISOM or no map is open. |

### `api.tileset`

`id()`, `name()`, `isLoaded()`, `load()` (resolves `false` when the graphics were never
extracted; that is a normal state, so degrade), and `raw()` for the decoded
`LoadedTileset`.

### `api.selection`

`markedArea()` / `markArea(rect | null)` is the Cut / Copy / Paste layer's marked
rectangle, the editor's one "region" concept. `units()`, `sprites()`, `doodads()` and
`locations()` are indices, copied, so sort yours freely; each has a setter (`setUnits`,
`setSprites`, `setDoodads`, `setLocations`). `layer()` / `setLayer()` is the active
layer, and `lockedLayers()` / `setLayerLocked(layer, on)` the Layers panel's padlocks (a
locked layer's tools refuse to change the map).

### `api.clipboard`

The Cut / Copy / Paste layer, sharing the user's own clip.

| | |
| --- | --- |
| `clip()` / `setClip(clip \| null)` | What is on the clipboard. A `Clip` is self-contained: it outlives the map it came from and pastes into another, with terrain and doodads refused across tilesets. |
| `copy(source?)` / `cut(source?)` | `source` is `{ rect }` for a tile rect or `{ units?, sprites?, doodads?, locations? }` for objects by index. Omitted, they take what Ctrl+C would: the object layer's selection, else the marked area, with the parts ticked in `parts()`. |
| `paste(tx, ty, { parts?, mode? })` | The clip's top-left at a tile, as one undo step, with the pasted area marked afterwards. Returns the `PasteResult`: counts per list, and notes for what was skipped. |
| `parts()` / `setParts(patch)` | Which parts a copy takes and a paste lays down. |
| `mode()` / `setMode("merge" \| "replace")` | Whether a paste clears the area first. |
| `pasting()` / `setPasting(on)` | Arm the layer so the next click stamps. |
| `summary(clip)` | The clip in words. |

### `api.exchange`

The file formats behind File ▸ Import / Export. `encodeTrg(triggers)` / `decodeTrg(bytes)`
are SCMDraft's raw `.trg` (2400-byte records; string indices are the map's own), and
`formatStrings()` / `parseStrings(text)` the `index<TAB>text` strings file (control bytes
as `<XX>`), which `tx.strings.import` applies.

### `api.palette`

What the Units, Sprites, Doodads and Fog of War palettes have picked, and what they list,
so a plugin can paint "whatever the user chose" without a picker of its own. Paint does
exactly this: switch layers and its brush follows. The Terrain palette's pick is
`terrain.active()`.

| | |
| --- | --- |
| `active()` / `setActive({...})` | A `PaletteChoice`: `unit` and `owner` (0-based; 0 is Player 1), `spriteKind` with `sprite` / `unitSprite`, `spriteFlipped` / `spriteDisabled`, `doodad` (-1 before one was picked), `fogPlayers` (a bit mask, bit n = player n + 1), `fogMode` and `fogViewPlayer` (whose fog the viewport draws). |
| `placementOptions()` / `setPlacementOptions(patch)` | The Units palette's rules: `checkCollision`, `checkTerrain`, `snapToGrid`, `removeStranded`. They govern `placeUnit`, `canPlaceUnit`, `query.placement` and whether an edit removes stranded units. Remembered in the browser, so a change outlives the session. |
| `doodadPlacement()` / `setDoodadPlacement(patch)` | The Doodads palette's `placeAnywhere` and `snapToGrid` (the two-tile isometric grid, not the View menu's grid spacing). Remembered in the browser. |
| `locationSnap()` / `setLocationSnap(step)` | The Locations layer's snap step in pixels (0 off, 8, 16, 32, 64). |
| `playerColor(owner)` | The colour a player's units are shown in, `#rrggbb`, Remastered custom colours included. |
| `unitGroups()` / `unitName(id)` / `unitSize(id)` | The Units palette's grouping, StarEdit's names, and a type's placement box in pixels with `building` / `flyer` flags (a one-tile box without the unit tables). |
| `spriteGroups()` / `spriteName(kind, id)` | The Sprites palette's groups (empty until the unit tables are loaded) and names. |
| `doodadCategories()` / `doodadInfo(id)` | The open map's doodads by category, each with its footprint in tiles (empty without the tileset graphics). |

### `api.names`

The names behind the numbers a map stores, so a plugin that shows raw values need not
carry the game's tables.

- The game's tables: `unit(id)` / `units()` (StarEdit's names, plus *Any unit*, *Men*,
  *Buildings*, *Factories* for the trigger classes 228–231; under a mod's data set, the
  mod's own name for anything it renamed, by the rule in
  [docs/game-data.md](game-data.md#names)), `upgrade` / `upgrades`, `tech` / `techs`,
  `weapon` / `weapons`, `playerType` / `playerTypes` (OWNR controllers), `race` / `races`
  (SIDE), `playerGroup` / `playerGroups` (the 27 trigger groups), `condition` /
  `conditions` and `action(type, briefing?)` / `actions(briefing?)` (trigger and
  briefing types), and `aiScript(code)`. The list forms return `{ value, label }[]` for a
  drop-down.
- The open map's: `string(index)` (null for 0 or out of range), `location(index)`
  (0-based slot; 63 is Anywhere), `switch(index)`, `player(slot)`, and `tile(id)`, the
  terrain a tile id belongs to (null without the tileset graphics). Each answers a
  placeholder without a map.

### `api.text`

StarCraft's `<XX>` text control codes: bytes 0x01–0x1F in a string, which set the colour,
move the text or hide it. This is the editor's own table, the one the String Editor's
buttons and preview are drawn from, so a plugin that shows or rewrites map text carries no
copy of its own. Use it rather than reimplementing it: the numbering is easy to get wrong,
and the editor's own table was wrong from 0x12 up until it was checked against the
classic player palette.

| | |
| --- | --- |
| `codes()` / `code(byte)` | Every byte the game gives a meaning, in order, or one of them (null for a byte it ignores). A `TextCode` is `{ byte, code, label, effect, rgb, player? }`. `effect` is `"color"`, `"mimic"`, `"invisible"`, `"align"`, `"clip"`, `"nothing"` or `"space"`; `rgb` is `#rrggbb` for the colours and null for the rest; the twelve that are a player colour carry `player`. |
| `insertable()` | The codes worth offering as buttons: everything but tab, the newlines and the byte that does nothing. |
| `defaultColor()` | What the game starts a string in. |
| `escape(byte)` | `<0E>`, the way every StarCraft editor writes a control byte. |
| `runs(text, options?)` | The string split into lines of coloured runs, the way the game draws it: `TextLine { runs, align }`, `TextRun { text, color, invisible, clipped }`. `invisible` marks what an `<0B>` / `<14>` hides rather than dropping it, `clipped` what an `<0C>` cut off, and `align` reads `<12>` / `<13>`. |
| `plain(text)` | The text with every control byte removed: what the string actually says. |
| `bleedingLines(text)` / `fixBleeding(text)` | See below. |

**The Remastered newline change.** StarCraft 1.16.1 reset the text colour at every line
break; Remastered carries it onto the next line of the same string. So a multi-line string
written before the remaster (most map descriptions, objectives and briefing text) can be
drawn today in colours its author never chose. `runs` models Remastered's rule; pass
`{ resetPerLine: true }` to see the old rendering. `bleedingLines(text)` returns the lines
that differ (`{ line, carried }`, `carried` being the whole `TextCode` inherited), and
`fixBleeding(text)` writes the default colour at the head of each of them so both games
draw the string alike. It is idempotent and never changes what the string says. The
Repair plugin's string finding is exactly these two functions over `api.query.strings()`.

Text *stacking*, the 1.16.1 trick of drawing lines on top of each other, is a different
thing, and there is nothing here for it: Remastered does not render the overlap at all,
and the intended picture *was* the overlap, so there is nothing to restore it to.

### `api.ui`

Everything a plugin shows: the status bar and toasts, dialogs and floating panels, the
two ways to draw on the map, and the pickers.

| | |
| --- | --- |
| `status(text)` / `statusText()` | The status bar. |
| `toast({ kind?, title, detail?, ttl? })` | A notice over the map that leaves by itself, the way Save reports. `kind` is `"ok"`, `"info"`, `"warn"` or `"error"`; `ttl` 0 keeps it until dismissed. |
| `saveFile(data, fileName)` | Write bytes or a `Blob` to disk the way the editor's own exports do: through the browser's save dialog where it has one, else as a download. Resolves `{ route, fileName }`, or null when dismissed. |
| `dialog(spec)` | A dialog in the editor's chrome. See below. |
| `panel(spec)` | A panel that floats over the map and blocks nothing, or one docked at the right beside the built-in panels. See below. |
| `statusItem(spec)` | A cell of your own in the status bar: text, the plugin's icon, a spinner while `busy`, a click. See below. |
| `dialogSlot(dialogId, spec)` | Add a button or a row to a built-in dialog. See below. |
| `mapTool(spec)` | Take over the pointer on the map. See below. |
| `overlay(spec)` | A picture drawn over the map that the user can switch on and off. See below. |
| `pickFiles({ accept, multiple })` | The file picker, resolved with `File[]` (empty on cancel). |
| `pickArea({ prompt })` | The user drags a rectangle on the map. The viewport shows a crosshair and a marquee, the HUD shows your prompt, and the gesture goes to you ahead of the active layer's tools. Resolves with the tile `Rect` (exclusive `x1` / `y1`), or `null` on Esc or a right-click, when no map is open, when the map is replaced meanwhile, or when the plugin is disabled. One pick at a time; starting another cancels the first. |
| `pickTile({ prompt })` | The same for a single click. Resolves with `{ x, y }`. |
| `loadImage(source)` | Decode a `File` / `Blob`, a `data:` URL or an `http(s)` URL into an `ImageBitmap`. A remote URL is fetched with CORS and, failing that, loaded through an `<img crossOrigin>`; a site that allows neither rejects with a message that says to save the picture and choose the file. |
| `readClipboardImage()` | The picture on the system clipboard as a `Blob` (the browser may ask permission), or `null`. For Ctrl+V use a dialog's `onPaste` instead, which needs no permission. |
| `confirm(message, opts?)` / `alert(message, opts?)` / `prompt(message, opts?)` | A yes/no, a note, and a line of text, as dialogs in the editor's chrome rather than the browser's blocking boxes. `confirm` resolves `false` and `prompt` `null` on Cancel, Escape or the ×. Options: `title`, `confirmLabel`, `cancelLabel`, `danger` (a destructive primary button), and for `prompt` also `value`, `placeholder`, `multiline`. |
| `progress(label, { title?, cancellable? })` | A progress panel over the map for long work. It blocks nothing, so report often: `report(0…1, text?)`, `cancelled()` (check it in your loop; the × counts as cancelling, `done()` does not), `signal` (an `AbortSignal` with the same answer), `done()`, `isOpen()`. A modal dialog covers the map and dims the panel behind it, so start the work from a panel, a menu item, or after closing your dialog. |
| `el(tag, props?, ...children)` | The DOM helper the widgets are built from: `style` takes an object, `on*` keys take listeners, everything else is a property or an attribute. |
| `widgets` | Buttons, fields, forms and lists in the editor's own styles, as plain DOM: `button(label, { primary, danger, ghost, busy, onClick })` (the button carries `setBusy(on)`), `checkbox(label, { value, radio, name, onChange })` (the `<label>` carries its `input`), `text(...)`, `number({ min, max, step, ... })`, `select(items, ...)`, `form(rows)` (a two-column grid of `{ label, field }`), `group(title, ...children)`, `row(...)`, `column(...)`, `hint(text)`, `separator()`, `list(items, { selected, height, onPick })`, and the five ways to wait: `spinner`, `progressBar`, `statusLine`, `skeleton`, `busy` (see below). Use them and a plugin's dialog looks like a built-in one; `el` is the escape hatch. |
| `open(dialogId, payload?)` | Any built-in dialog (`"mapProperties"`, `"unitSettings"`, …), fire and forget. |
| `ask(dialogId, payload?)` | A built-in dialog that answers (`"saveAs"`, `"confirmClose"`, `"newMap"`), resolving `true` when it went through and `false` when it was dismissed. |
| `repaint()` | Redraw the viewport when you changed something a transaction did not cover, such as an overlay's picture. Raises no event. |

**Dialogs.** `dialog(spec)` opens a dialog in the editor's chrome. `spec.mount(body,
handle)` is called with an empty `<div>` inside the dialog body; return a cleanup
function if you need one. `spec.buttons` draws the footer (`{ label, primary?,
run?(handle), closes? }`); the default is a single Close. `spec.onPaste(transfer, handle)`
fires for Ctrl+V anywhere in the dialog while it is the topmost one (a paste into one of
your own text fields is left alone unless it carries files), and `spec.onDrop` for a drop
on the body; a `DialogTransfer` is `{ files, text }`. Escape closes the dialog unless
`spec.keepOpenOnEscape(target)` answers true for the element the key landed on, which is
for something inside that handles Escape itself, such as a code editor dismissing its
own popups. The handle has `close()`, `isOpen()`, `setTitle(text)` and
`setBusy(label | false)`.

A dialog is modal and covers the map. To pick something on the map from a dialog, close
the dialog, pick, and reopen it with the result. Terrain from Image does exactly this
with its *Pick on Map…* button.

**Waiting.** Anything a plugin fetches, decodes or counts leaves the user looking at a
dialog that has not changed, and a dialog that does not say it is working reads as one
that is broken. `ui.widgets` has one vocabulary for it, so a plugin waits the way the
editor waits — and so a reduced-motion setting is honoured without your having to think
about it:

| | |
| --- | --- |
| `spinner({ size, label })` | The turning ring: on its own to put beside your own text, or with a `label` beside it. `size` is `"sm"`, `"md"` (the default) or `"lg"`. |
| `progressBar({ value, label, percent, width })` | A bar with the percentage after it and a line under it. `set(0…1, label?)` moves it; `set(null)` gives the sliding bar for work whose length is not known. Cheap to call per chunk — it repaints only when the bar actually moves. |
| `statusLine({ text })` | The line along the bottom of a dialog, with `set(text, "ok" \| "warn" \| "error")`, `busy(text)`, `progress(text, 0…1 \| null)`, `cancel(stop \| null)` (a Cancel beside the line) and `clear()`. |
| `skeleton({ width, height, lines, block })` | A grey stand-in for content that has not arrived, in the shape it will take: a line, `lines` of them, or a `block` where a picture goes. |
| `busy(target, label \| { label, dim })` | Cover a box while what is in it is being replaced: dimmed, deaf to clicks, a ring and a label over it. Returns `{ set(label), done() }`; `done()` uncovers it. |
| `button(label, { busy })` / `button.setBusy(on)` | A ring in front of a button's label, and the button disabled — so the press that started the work cannot be repeated. |
| `dialog.setBusy(label \| false)` | The dialog itself is working: a ring and the label at the left of the footer, every footer button disabled. A button's own `run` already does this while its promise is pending; this is for work no button started. |

Which to reach for: a **spinner** where the wait has no size, a **progress bar** where it
does (a download, a pass over every trigger), **skeletons** for a list or a pane you are
about to fill — they say more than an empty box, and nothing jumps when the answer lands
— and **busy** for a list being replaced by a different one. Put the outcome, the error
and the Cancel on one **status line** so a dialog has a single voice, and leave the field
that started the work live: the user changing their mind should not have to wait for the
answer they no longer want. Every long call is a good place for an `AbortSignal`, and
`statusLine.cancel(stop)` is where the user reaches it.

```js
const status = api.ui.widgets.statusLine();
const search = api.ui.widgets.button("Search", { onClick: () => void run() });

async function run() {
  const stop = new AbortController();
  const cover = api.ui.widgets.busy(results, "Searching…");
  status.busy("Searching…");
  status.cancel(() => stop.abort());
  search.setBusy(true);
  try {
    const found = await fetch(url, { signal: stop.signal }).then((r) => r.json());
    status.set(`${found.length} found.`, "ok");
    fill(results, found);
  } catch (err) {
    status.set(err.name === "AbortError" ? "Stopped." : String(err), "error");
  } finally {
    cover.done();
    search.setBusy(false);
    status.cancel(null);
  }
}
```

`ui.progress(label)` is the other half of this: a panel over the *map* for work that runs
while the user carries on editing. A dialog covers the map, so anything a dialog starts
belongs on that dialog's own status line, not in a progress panel behind it.

**Panels.** `panel(spec)` floats over the map and blocks nothing: the user keeps drawing,
scrolling and using hotkeys while it is open (except while typing in one of its fields).
`spec.mount(body, handle)` fills an empty `<div>` as a dialog's does; `width` is in CSS
pixels (260 by default) and the panel is as tall as its content; `onClose` fires however
it closes. The user drags it by its title bar and closes it with the ×. It opens at the
top-right of the map and remembers where it was left for the session. The handle has
`close()`, `isOpen()` and `setTitle()`. Open as many as you like; they all close with the
plugin.

`dock: "right"` puts the panel in the right dock instead, under Minimap, Layers and
Properties, with the same head and hide button the built-in panels have — the plugin's
icon, the title, and the hide button as its close. That is the choice for anything the
user keeps open while working: an assistant, a readout, a list they go back to. A docked
panel keeps the dock on screen even when every built-in panel in it is hidden. `grow: true`
lets it take the dock's spare height (a transcript wants that; a short readout does not).
`width` is ignored when docked, since the dock has its own width.

**Status items.** `statusItem({ text, title?, busy?, warn?, onClick? })` is a cell in the
status bar with the plugin's icon, for a plugin that works in the background and should
stay visible without a panel — "AI · working 12 s", "3 problems", "Synced". `busy` swaps
the icon for a spinner, `warn` paints the cell as a warning, `onClick` makes it a button.
Keep the handle and `set(patch)` it as things move; `remove()` takes it away, and so does
disabling the plugin.

**Dialog slots.** `dialogSlot(dialogId, { mount })` adds to a built-in dialog. Each time
that dialog opens, `mount(body, host)` runs with an empty `<span>` at the left of the
dialog's footer; fill it with the widgets and it reads as part of the dialog. `host` says
which dialog (`host.dialog`), what it was opened with (`host.payload`), and lends the
dialog's **working copy** as `host.fields` — the values in the form, not yet applied to
the map — so a button can fill a field in and leave OK to the person. The dialogs and
the fields each one lends:

| Dialog id | Fields |
| --- | --- |
| `mapProperties` | `name`, `description` |
| `textTriggerEditor` | `text` (the whole editor); `payload.briefing` says which list is shown |
| `triggerEditor`, `stringEditor`, `playerSettings`, `missionBriefing` | none — a slot only |

A field is `{ get(), set(value) }`, read live: a slot mounted once sees every keystroke.
`host.close()` closes the dialog. Return a cleanup from `mount` if you started anything;
it runs when the dialog closes, and the registration itself leaves with `dispose()` or the
plugin.

**Map tools.** `mapTool(spec)` takes over the pointer on the map. The viewport hands the
tool every press, move and release ahead of the active layer's own tools (`onDown` /
`onMove` / `onUp`, each with a `MapPointer`: map pixels, the tile, `inMap`, `down`, and
the modifier keys, kept inside the map while a button is held, as the built-in brushes
do). It hides the layer's brush ghost, shows `name` and `hint` in the HUD, and calls
`draw(ctx, view)` last on every repaint so the tool can preview what it will do
(`view.x(px)` / `view.y(py)` map to canvas pixels; `view.tilePx`, `view.zoom`,
`view.visible`). `handle.redraw()` repaints now; call it from `onMove`. Esc or a
right-click calls `onCancel`: return `true` to keep running (you dropped a gesture of your
own), otherwise the tool stops. `onStop(reason)` is told once, whichever way it ends:
`"stopped"` (your `stop()`), `"cancelled"`, `"document"` (the map closed or changed),
`"replaced"` (another tool started; one runs at a time) or `"disabled"`. A `pickArea` /
`pickTile` in progress is served first. Paint is the worked example.

**Overlays.** `overlay(spec)` is a picture over the map that the user can switch on and
off, and that stays while they work on any layer. It is listed under View (after the
built-in overlays) and in the Layers panel with an eye of its own. `draw(ctx, view)` runs
at every repaint while visible, at the slot `above` names: `"terrain"` (under doodad
footprints, units, sprites and locations; the default), `"objects"` (under fog of war) or
`"everything"` (under a running map tool's drawing only), with the same `MapView` a map
tool gets. `onHover(p)` hears the pointer on every layer, and while a map tool runs, with
`null` once when it leaves the map. The overlay never takes the pointer, so clicks go to
the active layer's tools. `onToggle(visible)` fires whichever way it was switched. The
handle has `show()`, `hide()`, `toggle()`, `isVisible()`, `redraw()` and `remove()`.
`visible` is the starting state (true by default); what the user last set an overlay of
that name to wins for the session, so a reloaded plugin comes back as it was left.
Register at activation and keep the handle; the overlay leaves with the plugin.
Walkability is the worked example.

### `api.menu` / `api.contextMenu` / `api.hotkeys`

- `menu.add(path, item)`: `path` is a top-level menu (`"File"`, `"Edit"`, `"View"`,
  `"Layer"`, `"Scenario"`, `"Triggers"`, `"Tools"`, `"Plugins"`, `"Help"`) or a submenu
  by label (`"File/Import"`). Plugin items appear after a separator at the end of that
  menu, unless `after` names a built-in item or submenu (`after: "Open Recent"`), in
  which case the item sits directly under it. A last segment that names no submenu gets
  one of the plugin's own at the end of the menu (`"Tools/AI"`), so a plugin with many
  items can keep them together; `separator: true` on an item draws a line above it
  (never two in a row). `item` is `{ label, shortcut?, icon?, after?, enabled?(), run() }`.
  `icon` puts a mark in front of the label: `"plugin"` for the plugin's own icon (the
  manifest's), or any `PluginIcon`. Use it for items that do something no built-in does,
  such as reaching a server, so the user can tell at a glance which entries are the
  plugin's.
- `contextMenu.add(surface, item)`: surfaces are `"viewport"` (the map) and
  `"terrainPalette"`. `run(ctx)`, `enabled?(ctx)` and `visible?(ctx)` get a
  `ContextMenuContext`: the tile and pixel under the pointer (viewport), the active
  layer, terrain mode and terrain, and the marked area.
- `hotkeys.add("Ctrl+Shift+I", run)`: modifiers in any order, then a key name. Plugin
  hotkeys are checked before the built-ins and never while typing in a field or while a
  dialog is open.
- All three take `{ command: "id" }` (or `command:` on the item) instead of a `run` of
  their own; see `api.commands`. A context item's command is called with the
  `ContextMenuContext` as its argument.

### `api.events`

`on(event, fn)` returns a `Disposable`. Listeners are notifications, not a pipeline: they
run after the change, in the order the plugins were activated, and cannot veto, delay or
reorder one another. There is no plugin ordering and none is planned. A listener that
rewrites the map in response (Repair does, through `document.sections`) raises a fresh
`"document"` event with reason `"replace"`, which every other listener sees in turn, so
whatever a plugin computed from the earlier state is recomputed from the later one.

| Event | When |
| --- | --- |
| `"document"` | A map was opened, closed or replaced. The listener is handed a `DocumentEvent`: `reason` is `"open"` (File ▸ Open, a drop, `document.open` from any plugin), `"new"` (File ▸ New, the startup map included), `"close"`, or `"replace"` (the open map parsed again from edited bytes, by a `document.sections` write from any plugin, yours included), and `fileName` is the file's name or null. A plugin that acts on maps as they open listens for `"open"` and lets the rest pass. Every other event carries nothing. |
| `"terrain"` | Every committed edit, stroke, undo and redo, terrain or not, fog edits included. It is the "something changed on the map" event. |
| `"units"`, `"doodads"`, `"locations"` | Those lists changed. |
| `"sprites"` | The sprites changed (they share the doodads' revision, since a doodad's overlay sprite is one). |
| `"settings"` | Every settings dialog's OK, Map Properties included. |
| `"triggers"` | The trigger or briefing list changed. |
| `"layer"`, `"selection"` | The active layer, or what is selected on it. |
| `"clipboard"` | The marked area or the clip changed. |
| `"view"` | Scrolled, zoomed, a View tick moved, or an overlay registered or toggled. |
| `"tool"` | A map tool or a pick started or stopped. |
| `"modified"` | The unsaved-changes flag. |
| `"palette"` | A palette's pick changed: terrain brush, unit and owner, sprite, doodad, fog players. |
| `"options"` | An editing option moved: symmetry, placement and doodad rules, location snap, the fog view player, clip parts and paste mode, locked layers, the grid look, Preferences. |
| `"file"` | The document's name or handle after a Save, its save options, the archive extras, or the recent list. |
| `"commands"` | A plugin registered or removed a command. This is how a plugin that calls another's by id learns it has arrived, since plugins activate in no fixed order; check `commands.has` in the listener. |
| `"gameData"` | The game data source changed: installed, switched to another data set, or a copy removed. `gameData.source()` says what it is now, and everything drawn or named from the data is worth redoing. |

### `api.storage`

`get(key, fallback)`, `set(key, value)` and `remove(key)` keep JSON in the browser's
storage under a per-plugin prefix (`scmjs.plugin.<id>.`), falling back to memory when
storage is unavailable. The user can see and throw it away: Preferences ▸ General ▸
Browser storage lists your keys as one row under your plugin's id, opening onto the
values, with a Clear button of its own, and Clear all data sweeps every key the editor
owns. So treat what you store as a convenience, never as the only copy of something, and
keep it small and readable.

### `api.plugin`, `api.apiVersion`, `api.log(...)`

Who you are (`id`, `name`, `source`), which API version you got, and a console logger
with the plugin's name prefixed.

## Plugins to read

Every plugin the editor ships is a repository of its own, compiled against the same
declarations, with a README of its own. Each is the worked example for part of the API
above. Read the one nearest to what you are writing.

| Plugin | Read it for |
| --- | --- |
| [Hello World](https://github.com/scm-js/plugin-hello-world) | The smallest complete plugin: a manifest, one `menu.add`, one `ui.dialog`, and the toolchain around them. Copy it to start your own. |
| [Paint](https://github.com/scm-js/plugin-paint) | `ui.mapTool` and `ui.panel`: a tool that owns the pointer, previews with `draw`, and commits one `document.edit` per stroke; a brush that follows the active layer's pick through `api.palette` and `api.terrain`. |
| [Walkability](https://github.com/scm-js/plugin-walkability) | `ui.overlay`: a read-only analysis drawn over the map, re-run on the editing events, with a panel for the readout. Reads the tileset through `tileset.raw()` and never writes. |
| [Terrain from Image](https://github.com/scm-js/plugin-image-to-terrain) | A dialog with `ui.widgets`, `onPaste` / `onDrop`, `ui.loadImage`, the close-pick-reopen round trip with `ui.pickArea`, and a whole picture painted in one `document.edit` with `tx.paintIsom`. |
| [Melee Wizard](https://github.com/scm-js/plugin-melee-wizard) | `placeUnit` / `canPlaceUnit` / `updateUnits` in one transaction, `query.placement` colouring a preview, and `terrain.symmetry` honoured by a plugin's own geometry. |
| [Repair](https://github.com/scm-js/plugin-repair) | The `"document"` event's payload, `document.sections` (`defaults`, `rebuild`, `trailing`, `required`, `replaceFile`), `tx.rebuildIsom`, and `api.text` for the Remastered newline finding. |
| [Section Explorer](https://github.com/scm-js/plugin-section-explorer) | `document.sections` reads and writes as a hex editor, and `api.names` for showing what a byte means. |
| [scmscx.com](https://github.com/scm-js/plugin-scm-scx) | `document.open` with bytes fetched from a third party, and what a site with no CORS headers means for a plugin. |
| [Trigger Script](https://github.com/scm-js/plugin-trigger-script) | `triggers.claim`, a dialog that keeps Escape for its own editor, files kept with the map through `document.extras`, and commands published for other plugins. |
| [AI](https://github.com/scm-js/plugin-ai) | The "built-in feel" surfaces: a panel with `dock: "right"`, `ui.statusItem` for its phase, `ui.dialogSlot` buttons in Map Properties and the trigger editors, `view.flash` and an overlay for what a tool call touches. Also calling another plugin's commands after the `"commands"` event, `document.create`, a submenu of the plugin's own, and the settings family of `document.update`. |
