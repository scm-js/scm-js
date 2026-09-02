# Plugins

scmJS can load third-party code — a *plugin* — from a public Git repository or any
URL, and let it add menu items, context-menu entries, hotkeys and dialogs, read the
open map and edit it through the same undo model the built-in tools use. This document
is the plugin author's guide and the reference for the host side. Two plugins are the
worked examples for everything below, each in its own repository and installed by default:
**Terrain from Image** ([scm-js/plugin-image-to-terrain](https://github.com/scm-js/plugin-image-to-terrain)),
a dialog, a pick on the map and a terrain transaction; and **Paint**
([scm-js/plugin-paint](https://github.com/scm-js/plugin-paint), listed but off until you
tick it), a floating panel, a tool that owns the pointer and draws its own preview, and
transactions on every layer. Both are
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
  emits `plugin-api/` so a plugin repo can type-check against the exact surface. A manifest's
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
3. The entry file is fetched **as text** and, if it is TypeScript, transpiled in the
   compile worker (`ts.transpileModule`; the editor already ships TypeScript for the
   trigger script). Fetching as text matters: `raw.githubusercontent.com` serves
   `text/plain`, which a browser refuses to `import()` as a module.
4. Relative imports are followed the same way, depth first, and each file becomes a
   `blob:` module URL; the import specifiers are rewritten to those URLs. There is no
   resolver behind a `fetch`, so the loader supplies one (`candidateUrls`): a specifier
   that names no extension — `"./convert"`, how TypeScript is normally written — is
   tried as `.ts`, `.tsx`, `.mts`, `.js`, `.mjs` and then as that directory's `index.*`,
   and a `"./convert.js"` falls back to `convert.ts` the way a TypeScript project means
   it. Circular imports and bare package names are errors with a message that says which
   file.
5. The entry is `import()`ed. Its default export (or a named `activate`) is called with
   the `PluginApi`. Whatever it returns — nothing, a function, or a `Disposable` — is kept
   for deactivation.

Installed plugins live in localStorage (`scmjs.plugins`: spec + enabled flag) and are
activated at startup by `usePlugins`. The *default* plugins (`src/plugins/defaults.ts`)
are merged over that list, so they are always shown and can be turned on or off but not
removed; each says whether it starts on (Terrain from Image does, Paint waits to be
ticked). Being a default buys a plugin nothing else — it is fetched and loaded by the
steps above like any other.

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

A plugin that is listed but **not running** — a default that starts off, or one you
turned off — is still described in Manage Plugins: `describePlugin` does step 1–2 only
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
  "icon": "icon.svg",
  "api": 1
}
```

`name` is the only required field; `id` (a slug for storage keys and log prefixes) is
derived from the name when absent, and `entry` defaults to `plugin.ts`, then `plugin.js`.

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
import type { PluginApi } from "scm-js/plugin-api";

export default function activate(api: PluginApi) {
  api.menu.add("Tools", {
    label: "Say Hello",
    enabled: () => api.document.isOpen(),
    run: () => api.ui.status(`Hello, ${api.document.info()?.name}!`),
  });
}
```

The `import type` line is erased at load time, so it only matters for editing: copy the
`plugin-api/` folder that `npm run build:plugin-types` produces into your repo (or point
`paths` in your `tsconfig.json` at it) and you get completion and checking. Terrain from
Image vendors it and imports `./plugin-api/plugins/api`, so that repository type-checks
on its own with nothing installed but TypeScript.

Everything `add`/`on` returns is a `Disposable`; keep the ones you need to drop early
and forget the rest — deactivation disposes them all. Returning a function from
`activate` runs it at deactivation too, for anything outside the API (timers, sockets).

To develop: serve the folder (`npx serve plugins/hello`), add `http://localhost:3000/`
in Tools ▸ Plugins ▸ Manage Plugins…, and press **Reload** after each change.

## API reference

The complete typings are in `src/plugins/api.ts`; this is the tour. Every method that
reads the map returns `null` / `[]` / `false` when no map is open rather than throwing.

### `api.document`

| | |
| --- | --- |
| `isOpen()` | Whether a scenario is loaded. |
| `info()` | `{ name, description, width, height, tileset, era, version, fileName, modified }`. |
| `scenario()` | The live `Scenario` object, for **reading**. Mutating it directly bypasses undo and dirty tracking. |
| `edit(label, build)` | Run `build(tx)` and record what it did as one undo entry named `label`. Returns an `EditResult` with counts per list. |
| `undo()` / `redo()` | The Edit menu's. |

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
| `paintIsom(diamond, terrainId, extent = 1)` | The isometric brush on one diamond: sets the ISOM and generates the cliff/shore tiles around it. Needs ISOM and the tileset. |

| Objects | |
| --- | --- |
| `makeUnit(unitId, owner, x, y)` | A StarEdit-style record (serial, masks) at map pixels. |
| `addUnits(records)` / `removeUnits(indices)` / `updateUnits(indices, patch)` | |
| `placeUnit(unitId, owner, x, y)` | A unit the way the Units palette places one: a building snaps its placement box to the tile grid (when the palette's *Snap to grid* is on), nothing leaves the map. Returns the index. No checks — |
| `canPlaceUnit(unitId, x, y)` | — ask this first if you want them: the palette's collision and terrain checks with its current options. |
| `makeSprite(kind, id, owner, x, y, opts?)` / `addSprites` / `removeSprites` / `placeSprite(...)` | `placeSprite` is make + add, kept on the map; returns the index. |
| `placeDoodad(doodadId, tx, ty, owner)` / `removeDoodads(indices)` | Doodads stamp MTXM and may carry an overlay sprite; both are handled. |
| `addLocation(bounds, name?)` / `editLocation(index, patch)` / `removeLocations(indices)` | Slot 63 (Anywhere) is refused. |
| `setFog(cells, players, "fog" \| "clear")` | `players` is a bit mask; creates MASK on first use. |
| `note(text)` | A line for the status bar, alongside the label. |

### `api.terrain`

Read-only helpers over the current tileset: `types()` (paintable flat terrains with
name, group, height, buildable), `isomTypes()` (ids the isometric brush can paint),
`hasIsom()`, `tileInfo(id)`, `color(tileId)` (the atlas average, `0xRRGGBB`),
`terrainColor(terrainId)` (mean of the pair's common variations), `heightOf(terrainId)`
(0 low / 1 high / 2 higher, null for anything that is not a flat terrain), `diamondAt(px, py)`,
`isDiamond(d)`, `diamondsIn(rect)` (every lattice diamond whose centre tile is in the
rect), `active()` / `setActive(...)` for the palette's brush, terrain and tile.

### `api.tileset`

`id()`, `name()`, `isLoaded()`, `load()` (resolves `false` when the graphics were never
extracted — that is a normal state, degrade), `raw()` for the decoded `LoadedTileset`.

### `api.selection`

`markedArea()` / `markArea(rect | null)` — the Cut / Copy / Paste layer's marked
rectangle, the editor's one "region" concept; `units()`, `sprites()`, `doodads()`,
`locations()` (indices) with matching setters; `layer()` / `setLayer()`.

### `api.palette`

What the Units, Sprites, Doodads and Fog of War palettes have picked, and what they list —
so a plugin can paint "whatever the user chose" without a picker of its own (Paint does
exactly this: switch layers and its brush follows). The Terrain palette's pick is
`terrain.active()`.

| | |
| --- | --- |
| `active()` / `setActive({...})` | A `PaletteChoice`: `unit` and `owner` (0-based; 0 is Player 1), `spriteKind` with `sprite` / `unitSprite`, `spriteFlipped` / `spriteDisabled`, `doodad` (-1 before one was picked), `fogPlayers` (a bit mask, bit n = player n + 1) and `fogMode`. |
| `playerColor(owner)` | The colour a player's units are shown in, `#rrggbb` — Remastered custom colours included. |
| `unitGroups()` / `unitName(id)` / `unitSize(id)` | The Units palette's grouping, StarEdit's names, and a type's placement box in pixels with `building` / `flyer` flags (a one-tile box without the unit tables). |
| `spriteGroups()` / `spriteName(kind, id)` | The Sprites palette's groups (empty until the unit tables are loaded) and names. |
| `doodadCategories()` / `doodadInfo(id)` | The open map's doodads by category, each with its footprint in tiles (empty without the tileset graphics). |

### `api.ui`

| | |
| --- | --- |
| `status(text)` | The status bar. |
| `dialog(spec)` | Opens a dialog in the editor's chrome. `spec.mount(body, handle)` is called with an empty `<div>` inside the dialog body; return a cleanup function if you need one. `spec.buttons` draws the footer (`{ label, primary?, run?(handle), closes? }`); default is a single Close. `spec.onPaste(transfer, handle)` fires for Ctrl+V anywhere in the dialog while it is the topmost one (a paste into one of your own text fields is left alone unless it carries files), `spec.onDrop` for a drop on the body; a `DialogTransfer` is `{ files, text }`. Returns a handle with `close()`, `isOpen()` and `setTitle(text)`. |
| `panel(spec)` | A panel that floats over the map and blocks nothing: the user keeps drawing, scrolling and using hotkeys while it is open (except while typing in one of its fields). `spec.mount(body, handle)` fills an empty `<div>` as a dialog's does; `width` is in CSS pixels (260 by default) and the panel is as tall as its content; `onClose` fires however it closes. The user drags it by its title bar and closes it with the ×; it opens at the top-right of the map and remembers where it was left for the session. The handle has `close()`, `isOpen()`, `setTitle()`. Open as many as you like; they all close with the plugin. |
| `mapTool(spec)` | Take over the pointer on the map. The viewport hands the tool every press, move and release ahead of the active layer's own tools (`onDown` / `onMove` / `onUp`, each with a `MapPointer`: map pixels, the tile, `inMap`, `down`, and the modifier keys — kept inside the map while a button is held, as the built-in brushes do), hides the layer's brush ghost, shows `name` and `hint` in the HUD, and calls `draw(ctx, view)` last on every repaint so the tool can preview what it will do (`view.x(px)` / `view.y(py)` map to canvas pixels; `view.tilePx`, `view.zoom`, `view.visible`). `handle.redraw()` repaints now; call it from `onMove`. Esc or a right-click calls `onCancel` — return `true` to keep running (you dropped a gesture of your own), otherwise the tool stops — and `onStop(reason)` is told once whichever way it ends: `"stopped"` (your `stop()`), `"cancelled"`, `"document"` (the map closed or changed), `"replaced"` (another tool started; one runs at a time), `"disabled"`. A `pickArea` / `pickTile` in progress is served first. Paint is the worked example. |
| `pickFiles({ accept, multiple })` | The file picker, resolved with `File[]` (empty on cancel). |
| `pickArea({ prompt })` | The user drags a rectangle on the map: the viewport shows a crosshair and a teal marquee, the HUD shows your prompt, and the gesture goes to you ahead of the active layer's tools. Resolves with the tile `Rect` (exclusive `x1` / `y1`), or `null` on Esc / right-click, when no map is open, when the map is replaced meanwhile, or when the plugin is disabled. One pick at a time — starting another cancels the first. A dialog is modal and covers the map, so close yours before picking and reopen it with the result (Terrain from Image does exactly this: *Pick on Map…*). |
| `pickTile({ prompt })` | The same for a single click; resolves with `{ x, y }`. |
| `loadImage(source)` | Decode a `File` / `Blob`, a `data:` URL or an `http(s)` URL into an `ImageBitmap`. A remote URL is fetched with CORS and, failing that, loaded through an `<img crossOrigin>`; a site that allows neither rejects with a message that says to save the picture and choose the file. |
| `readClipboardImage()` | The picture on the system clipboard as a `Blob` (the browser may ask permission), or `null`. For Ctrl+V use `onPaste` instead — it needs no permission. |
| `open(dialogId, payload?)` | Any built-in dialog (`"mapProperties"`, `"unitSettings"`, …). |
| `repaint()` | Bump the terrain revision when you changed something the transaction did not cover. |

### `api.menu` / `api.contextMenu` / `api.hotkeys`

- `menu.add(path, item)`: `path` is a top-level menu (`"File"`, `"Edit"`, `"View"`,
  `"Layer"`, `"Scenario"`, `"Triggers"`, `"Tools"`, `"Plugins"`, `"Help"`) or a submenu
  by label (`"File/Import"`). Plugin items appear after a separator at the end of that
  menu. `item` is `{ label, shortcut?, enabled?(), run() }`.
- `contextMenu.add(surface, item)`: surfaces are `"viewport"` (the map) and
  `"terrainPalette"`. `run(ctx)`, `enabled?(ctx)` and `visible?(ctx)` get a
  `ContextMenuContext`: the tile and pixel under the pointer (viewport), the active
  layer, terrain mode and terrain, and the marked area.
- `hotkeys.add("Ctrl+Shift+I", run)`: modifiers in any order, then a key name. Plugin
  hotkeys are checked before the built-ins and never while typing in a field or while a
  dialog is open.

### `api.events`

`on(event, fn)` for `"document"` (opened, closed, replaced), `"terrain"`, `"units"`,
`"doodads"`, `"locations"`, `"settings"`, `"triggers"`, `"layer"`, `"selection"`, and
`"palette"` (a palette's pick changed: terrain brush, unit and owner, sprite, doodad, fog
players).

### `api.storage`

`get(key, fallback)`, `set(key, value)`, `remove(key)`: JSON in localStorage under a
per-plugin prefix (`scmjs.plugin.<id>.`). Safe when storage is unavailable (falls back to
memory). The user can throw it all away — Preferences ▸ General ▸ Browser storage ▸ Clear
all data sweeps every `scmjs.` key, plugin keys included — so treat what you store as a
convenience, never as the only copy of something.

### `api.plugin`, `api.apiVersion`, `api.log(...)`

Who you are (`id`, `name`, `source`), which API you got, and a console logger with the
plugin's name prefixed.

## Host side (for editor developers)

| File | |
| --- | --- |
| `src/plugins/api.ts` | The public types. Changing them is an API change: bump `PLUGIN_API_VERSION` for anything not backward compatible. |
| `src/plugins/host.ts` | `createPluginApi(store, info)` builds one plugin's `PluginApi` over the Jotai store and a `Contributions` bag that `dispose()` empties; `activatePlugin` / `deactivatePlugin` drive the lifecycle and write `pluginRuntimesAtom`; `inspectPlugin` / `installPlugin` are the confirm-then-add pair, and `rememberManifest` is the manifest cache both it and `describePlugin` write. |
| `src/plugins/loader.ts` | Spec parsing, manifest fetch, the fetch-as-text / transpile / rewrite-imports / blob-URL pipeline, and `previewPlugin` (`canonicalSpec` + the manifest, no code) behind the Add Plugin confirmation. Pure apart from the `fetch`, `transpile` and `createModuleUrl` callbacks it takes, so `tests/plugins.test.ts` runs it in Node. |
| `src/plugins/images.ts` | `loadImage` / `readClipboardImage` behind `api.ui`, and `transferOf` (a `DataTransfer` → `{ files, text }`) that `PluginDialog` uses for `onPaste` / `onDrop`. |
| `src/plugins/builtin.ts` | `import.meta.glob` over `plugins/*/plugin.{ts,json}` — empty, since nothing ships in the bundle. |
| `src/plugins/defaults.ts` | The plugins a fresh editor starts with (`DEFAULT_REMOTE_PLUGINS`, each with whether it starts on, plus any built-in), merged over the stored list by `effectiveInstalls`. |
| `src/atoms/pluginAtoms.ts` | `installedPluginsAtom` (persisted, with `local` per plugin), `pluginCodeAtom` (the stored copies), `pluginRuntimesAtom`, the contribution registries `pluginMenuItemsAtom`, `pluginContextItemsAtom`, `pluginHotkeysAtom`, `mapPickAtom` — the `pickArea` / `pickTile` request the viewport is serving (`cancelMapPickAtom` is what Esc and a right-click write) — and its two siblings `mapToolAtom` (the running `ui.mapTool`, with `cancelMapToolAtom` and `mapToolRevisionAtom` for `redraw`) and `pluginPanelsAtom` (the open `ui.panel`s). |
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

`api.document.edit` is `runTransaction` in `host.ts`: it wraps the scenario in an
`EditTransaction` whose operations apply immediately and accumulate change lists in
`applyEntry` order, then hands the entry to `commitTerrainAtom` (the stranded-doodad /
stranded-unit pass that used to live only inside `useTerrainTools`) so a plugin edit
behaves exactly like a stroke.

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
pairs with `tx.stampTerrain` and leaves the ISOM alone (Rebuild ISOM from Tiles afterwards
if you want the isometric brush back). One undo entry either way.

## Paint

[scm-js/plugin-paint](https://github.com/scm-js/plugin-paint), listed by default and
enabled with its tick in Manage Plugins — Tools ▸ Paint…, `Ctrl+Shift+P`, or *Paint…* on
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
