# Plugins

scmJS can load third-party code — a *plugin* — from a public Git repository or any
URL, and let it add menu items, context-menu entries, hotkeys and dialogs, read the
open map and edit it through the same undo model the built-in tools use. This document
is the plugin author's guide and the reference for the host side. The first plugin,
**Terrain from Image**, ships in the repository under `plugins/terrain-from-image/` and
is the worked example for everything below.

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
  emits `plugin-api/` so a plugin repo can type-check against the exact surface.

### Non-goals (version 1)

- **No sandbox.** A plugin runs in the page with the page's privileges: it can read the
  open map, the archive extras and the editor's localStorage, and it can make network
  requests. That is the same trust as a browser extension. The Manage Plugins dialog says
  so before a plugin is enabled, pins remote plugins to the ref you gave, and never
  auto-updates. An iframe sandbox is possible later; it would cost the UI contributions.
- **No React for plugins.** A plugin dialog gets a DOM element to fill (`mount(el)`).
  Sharing the host's React would need import maps and version coupling; a plugin that
  wants a framework can bundle its own into that element.
- **No package imports.** `import x from "some-npm-package"` is refused at load time.
  Relative imports between files in the plugin repo work (the loader fetches them). A
  plugin that needs a library ships a prebuilt bundle and points `plugin.json` at it.

### How a plugin loads

1. The *spec* the user typed is parsed (`loader.ts#parseSpec`):
   - `builtin:<name>` — a plugin compiled into the editor from `plugins/<name>/`.
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
   `blob:` module URL; the import specifiers are rewritten to those URLs. Circular
   imports and bare package names are errors with a message that says which file.
5. The entry is `import()`ed. Its default export (or a named `activate`) is called with
   the `PluginApi`. Whatever it returns — nothing, a function, or a `Disposable` — is kept
   for deactivation.

Installed plugins live in localStorage (`scmjs.plugins`: spec + enabled flag) and are
activated at startup by `usePlugins`. Built-in plugins are always listed and can be
turned off but not removed.

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
`plugins/terrain-from-image/icon.svg` is the worked example.

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
`paths` in your `tsconfig.json` at it) and you get completion and checking. The built-in
plugins import the types relatively (`../../src/plugins/api`) because they live in this
repository.

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
| `makeSprite(kind, id, owner, x, y, opts?)` / `addSprites` / `removeSprites` | |
| `placeDoodad(doodadId, tx, ty, owner)` / `removeDoodads(indices)` | Doodads stamp MTXM and may carry an overlay sprite; both are handled. |
| `addLocation(bounds, name?)` / `editLocation(index, patch)` / `removeLocations(indices)` | Slot 63 (Anywhere) is refused. |
| `setFog(cells, players, "fog" \| "clear")` | `players` is a bit mask; creates MASK on first use. |
| `note(text)` | A line for the status bar, alongside the label. |

### `api.terrain`

Read-only helpers over the current tileset: `types()` (paintable flat terrains with
name, group, height, buildable), `isomTypes()` (ids the isometric brush can paint),
`hasIsom()`, `tileInfo(id)`, `color(tileId)` (the atlas average, `0xRRGGBB`),
`terrainColor(terrainId)` (mean of the pair's common variations), `diamondAt(px, py)`,
`isDiamond(d)`, `diamondsIn(rect)` (every lattice diamond whose centre tile is in the
rect), `active()` / `setActive(...)` for the palette's brush, terrain and tile.

### `api.tileset`

`id()`, `name()`, `isLoaded()`, `load()` (resolves `false` when the graphics were never
extracted — that is a normal state, degrade), `raw()` for the decoded `LoadedTileset`.

### `api.selection`

`markedArea()` / `markArea(rect | null)` — the Cut / Copy / Paste layer's marked
rectangle, the editor's one "region" concept; `units()`, `sprites()`, `doodads()`,
`locations()` (indices) with matching setters; `layer()` / `setLayer()`.

### `api.ui`

| | |
| --- | --- |
| `status(text)` | The status bar. |
| `dialog(spec)` | Opens a dialog in the editor's chrome. `spec.mount(body, handle)` is called with an empty `<div>` inside the dialog body; return a cleanup function if you need one. `spec.buttons` draws the footer (`{ label, primary?, run?(handle), closes? }`); default is a single Close. Returns a handle with `close()`. |
| `pickFiles({ accept, multiple })` | The file picker, resolved with `File[]` (empty on cancel). |
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
`"doodads"`, `"locations"`, `"settings"`, `"triggers"`, `"layer"`, `"selection"`.

### `api.storage`

`get(key, fallback)`, `set(key, value)`, `remove(key)`: JSON in localStorage under a
per-plugin prefix. Safe when storage is unavailable (falls back to memory).

### `api.plugin`, `api.apiVersion`, `api.log(...)`

Who you are (`id`, `name`, `source`), which API you got, and a console logger with the
plugin's name prefixed.

## Host side (for editor developers)

| File | |
| --- | --- |
| `src/plugins/api.ts` | The public types. Changing them is an API change: bump `PLUGIN_API_VERSION` for anything not backward compatible. |
| `src/plugins/host.ts` | `createPluginApi(store, info)` builds one plugin's `PluginApi` over the Jotai store and a `Contributions` bag that `dispose()` empties; `activatePlugin` / `deactivatePlugin` drive the lifecycle and write `pluginRuntimesAtom`. |
| `src/plugins/loader.ts` | Spec parsing, manifest fetch, the fetch-as-text / transpile / rewrite-imports / blob-URL pipeline. Pure apart from the `fetch`, `transpile` and `createModuleUrl` callbacks it takes, so `tests/plugins.test.ts` runs it in Node. |
| `src/plugins/builtin.ts` | `import.meta.glob` over `plugins/*/plugin.{ts,json}`. |
| `src/atoms/pluginAtoms.ts` | `installedPluginsAtom` (persisted), `pluginRuntimesAtom`, and the contribution registries `pluginMenuItemsAtom`, `pluginContextItemsAtom`, `pluginHotkeysAtom`. |
| `src/hooks/usePlugins.ts` | Activates the enabled plugins at startup and keeps runtime in step with the installed list. |
| `src/components/dialogs/PluginDialogs.tsx` | Manage Plugins, and `PluginDialog` — the frame a plugin's `ui.dialog` mounts into. |

Contribution points read the registries: `MenuBar` merges `pluginMenuItemsAtom` into
its menu model (`withPluginItems`), `MapViewport` and `TerrainPalette` append the
matching `pluginContextItemsAtom` entries to their context menus, `useHotkeys` checks
`pluginHotkeysAtom` first. A `Plugins` menu (Manage Plugins… plus anything registered
under `"Plugins"`) sits between Tools and Help.

`api.document.edit` is `runTransaction` in `host.ts`: it wraps the scenario in an
`EditTransaction` whose operations apply immediately and accumulate change lists in
`applyEntry` order, then hands the entry to `commitTerrainAtom` (the stranded-doodad /
stranded-unit pass that used to live only inside `useTerrainTools`) so a plugin edit
behaves exactly like a stroke.

## Terrain from Image

`plugins/terrain-from-image/` — File ▸ Import ▸ Terrain from Image…, and on the terrain
palette's context menu *Terrain from Image into Marked Area…* when the Cut / Copy /
Paste layer has an area marked. `convert.ts` is the pure part: resample the image to one
sample per target cell, optionally smooth it, and match every cell to one of the chosen
terrains by colour (nearest, red-mean weighted) or by brightness (the chosen terrains in
palette order become bands from dark to light — a heightmap). `plugin.ts` is the dialog
and the transaction: **Isometric** paints each lattice diamond in the target with
`tx.paintIsom`, so cliffs and shorelines are generated at every boundary; **Tiles** stamps
flat pairs with `tx.stampTerrain` and leaves the ISOM alone (Rebuild ISOM from Tiles
afterwards if you want the isometric brush back). One undo entry either way.
