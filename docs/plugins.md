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
transactions on every layer; **Walkability** and **Melee Wizard** (both listed but off)
are the read-only analysis drawn over the map and the placement wizard, described at the
end. All are
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
removed; each says whether it starts on (scmscx.com and Terrain from Image do; Paint,
Section Explorer, Walkability and Melee Wizard wait to be ticked). Being a default buys a plugin nothing else — it is fetched and loaded by the
steps above like any other.

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

Listing is therefore automatic, and says nothing about a plugin having been read. The one
field that carries a judgement is `RegistryEntry.reviewed`: the release someone at that
registry read the code of, which the *registry* drops again once the plugin moves past it,
so the editor never has to date a mark — an entry either carries one describing its
`commit` or carries none. The Browse row shows it as a `reviewed` badge beside `default`.
It is not a safety claim: there is no sandbox, and an installed plugin runs with the
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

### The three kinds of write

Everything a plugin can change about the open map goes through one of three, and they
differ in what they cost:

| | what it covers | undo |
| --- | --- | --- |
| `document.edit(label, build)` | terrain and objects — tiles, ISOM, units, sprites, doodads, locations, fog | one history entry, like a brush stroke |
| `document.update(label, build)` | the tables and settings — triggers, briefing, the string table, switch names, the scenario's name and description | none: a settings-dialog transaction, as in StarEdit |
| `document.sections.*` | the file's own bytes, any section, modelled or not | none, and the history is dropped (as Resize) |

They are the editor's own three: a stroke, a dialog's OK, and a raw file edit. Both
transactions apply their operations **as they are called**, so later ones see earlier
ones' results, and both commit once at the end.

### `api.document`

| | |
| --- | --- |
| `isOpen()` | Whether a scenario is loaded. |
| `info()` | `{ name, description, width, height, tileset, era, version, fileName, modified }`. |
| `scenario()` | The live `Scenario` object, for **reading**. Mutating it directly bypasses undo and dirty tracking. |
| `edit(label, build)` | Run `build(tx)` and record what it did as one undo entry named `label`. Returns an `EditResult` with counts per list. |
| `update(label, build)` | The tables and settings, as one settings-style transaction — triggers, strings, switch names, the scenario's properties. Not in the undo model. Returns an `UpdateResult`. |
| `undo()` / `redo()` | The Edit menu's. |
| `open(file, fileName?)` | Open a map file (`File`, `Blob` or bytes; `.scx` / `.scm` / `.chk`) in place of the current one, the way File ▸ Open does. A modified map goes through the Close Scenario dialog first when Preferences say to ask. Resolves `true` once the file is the open document, `false` when the user kept the current map or the file could not be read (the status bar says which). |
| `export({ format?, fileName? })` | The open map as a `File`, exactly as Save writes it, archive extras included: `scx` (default), `scm`, or a bare `chk`. Null with no map. Hand it to a `FormData` and it uploads. |
| `renderImage({ pixelsPerTile?, … })` | A PNG `Blob` of the map as File ▸ Export ▸ Image draws it; 32 pixels per tile is the game's art, 1 is a minimap. Needs the tileset graphics (null without them or without a map). |
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
| `tx.strings` | `list()`, `intern(text)` (an identical entry, else a new one; **never** overwrites, because the old index may be shared with a trigger), `set(index, text)` (overwrite one slot — everything pointing at it sees the new text), `apply(list)` (a whole table; unreferenced trailing blanks are dropped, every other index keeps its place). |
| `tx.switches` | `names()` (256, `""` where a switch has none) and `setName(index, name)`; creates SWNM on the first name. |
| `tx.properties({ name?, description? })` | SPRP. `""` restores the file-name default. |
| `tx.note(text)` | A line for the status bar. |

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

### `api.query`

Reading the open map: what is where, and the analyses the editor already does. Nothing
here writes, and everything answers empty without a map.

| | |
| --- | --- |
| `unitAt(px, py)` / `spriteAt(px, py)` / `doodadAt(tx, ty)` / `locationAt(px, py)` | The topmost thing under a point, or -1 — the same hit-testing the layers use (a sprite's box comes from its loaded GRP, a unit's from units.dat). `locationAt` never picks Anywhere. |
| `unitsIn(rect)` / `spritesIn(rect)` / `locationsIn(rect)` | Units and sprites whose centre is in a tile rect; locations wholly inside it. |
| `unitsOf(owner)` | Every unit a player owns (0-based). |
| `startLocations()` | `{ index, owner, x, y, tx, ty }` per start location, by player. |
| `placement(unitId, x, y)` | The Units palette's verdict: `{ problem: "terrain" \| "collision" \| null, blocker }`. |
| `validate()` | Check Map's `Issue[]` — `{ level, text, where, target? }`, and `target` is what `view.goTo` takes. |
| `statistics()` | Tools ▸ Statistics: tile, terrain, unit, resource and per-player counts. |
| `find(options)` | The Ctrl+F search: `{ kind: "units" \| "locations" \| "sprites" \| "strings" \| "triggers", query, matchCase?, limit? }` → `{ kind, index, label, detail, x?, y? }[]`. |
| `stringUsage()` / `unusedStrings()` | Which records refer to each string index, and which slots nothing refers to. |

A linter plugin is `validate()` plus `find()` plus `view.goTo` and nothing else.

### `api.view`

Where the viewport is looking. A plugin that finds something needs this to show the user
where it is.

| | |
| --- | --- |
| `zoom()` / `setZoom(z)` | Clamped to 0.05…8. |
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
`hasIsom()`, `tileInfo(id)`, `color(tileId)` (the atlas average, `0xRRGGBB`),
`terrainColor(terrainId)` (mean of the pair's common variations), `heightOf(terrainId)`
(0 low / 1 high / 2 higher, null for anything that is not a flat terrain), `diamondAt(px, py)`,
`isDiamond(d)`, `diamondsIn(rect)` (every lattice diamond whose centre tile is in the
rect), `active()` / `setActive(...)` for the palette's brush, terrain and tile.
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

### `api.ui`

| | |
| --- | --- |
| `status(text)` | The status bar. |
| `dialog(spec)` | Opens a dialog in the editor's chrome. `spec.mount(body, handle)` is called with an empty `<div>` inside the dialog body; return a cleanup function if you need one. `spec.buttons` draws the footer (`{ label, primary?, run?(handle), closes? }`); default is a single Close. `spec.onPaste(transfer, handle)` fires for Ctrl+V anywhere in the dialog while it is the topmost one (a paste into one of your own text fields is left alone unless it carries files), `spec.onDrop` for a drop on the body; a `DialogTransfer` is `{ files, text }`. Returns a handle with `close()`, `isOpen()` and `setTitle(text)`. |
| `panel(spec)` | A panel that floats over the map and blocks nothing: the user keeps drawing, scrolling and using hotkeys while it is open (except while typing in one of its fields). `spec.mount(body, handle)` fills an empty `<div>` as a dialog's does; `width` is in CSS pixels (260 by default) and the panel is as tall as its content; `onClose` fires however it closes. The user drags it by its title bar and closes it with the ×; it opens at the top-right of the map and remembers where it was left for the session. The handle has `close()`, `isOpen()`, `setTitle()`. Open as many as you like; they all close with the plugin. |
| `mapTool(spec)` | Take over the pointer on the map. The viewport hands the tool every press, move and release ahead of the active layer's own tools (`onDown` / `onMove` / `onUp`, each with a `MapPointer`: map pixels, the tile, `inMap`, `down`, and the modifier keys — kept inside the map while a button is held, as the built-in brushes do), hides the layer's brush ghost, shows `name` and `hint` in the HUD, and calls `draw(ctx, view)` last on every repaint so the tool can preview what it will do (`view.x(px)` / `view.y(py)` map to canvas pixels; `view.tilePx`, `view.zoom`, `view.visible`). `handle.redraw()` repaints now; call it from `onMove`. Esc or a right-click calls `onCancel` — return `true` to keep running (you dropped a gesture of your own), otherwise the tool stops — and `onStop(reason)` is told once whichever way it ends: `"stopped"` (your `stop()`), `"cancelled"`, `"document"` (the map closed or changed), `"replaced"` (another tool started; one runs at a time), `"disabled"`. A `pickArea` / `pickTile` in progress is served first. Paint is the worked example. |
| `overlay(spec)` | A picture over the map the user can switch on and off, and that stays while they work on any layer: it is listed under View (after the built-in overlays) and in the Layers panel with an eye of its own. `draw(ctx, view)` runs at every repaint while visible, at the slot `above` names — `"terrain"` (under doodad footprints, units, sprites and locations; the default), `"objects"` (under fog of war) or `"everything"` (under a running map tool's drawing only) — with the same `MapView` a map tool gets. `onHover(p)` hears the pointer on every layer, and while a map tool runs, with `null` once when it leaves the map; the overlay never takes the pointer, so clicks go to the active layer's tools. `onToggle(visible)` fires whichever way it was switched. The handle has `show()`, `hide()`, `toggle()`, `isVisible()`, `redraw()` and `remove()`. `visible` is the starting state (true by default); what the user last set an overlay of that name to wins for the session, so a reloaded plugin comes back as it was left. Register at activation and keep the handle; the overlay leaves with the plugin. Walkability is the worked example. |
| `pickFiles({ accept, multiple })` | The file picker, resolved with `File[]` (empty on cancel). |
| `pickArea({ prompt })` | The user drags a rectangle on the map: the viewport shows a crosshair and a teal marquee, the HUD shows your prompt, and the gesture goes to you ahead of the active layer's tools. Resolves with the tile `Rect` (exclusive `x1` / `y1`), or `null` on Esc / right-click, when no map is open, when the map is replaced meanwhile, or when the plugin is disabled. One pick at a time — starting another cancels the first. A dialog is modal and covers the map, so close yours before picking and reopen it with the result (Terrain from Image does exactly this: *Pick on Map…*). |
| `pickTile({ prompt })` | The same for a single click; resolves with `{ x, y }`. |
| `loadImage(source)` | Decode a `File` / `Blob`, a `data:` URL or an `http(s)` URL into an `ImageBitmap`. A remote URL is fetched with CORS and, failing that, loaded through an `<img crossOrigin>`; a site that allows neither rejects with a message that says to save the picture and choose the file. |
| `readClipboardImage()` | The picture on the system clipboard as a `Blob` (the browser may ask permission), or `null`. For Ctrl+V use `onPaste` instead — it needs no permission. |
| `confirm(message, opts?)` / `alert(message, opts?)` / `prompt(message, opts?)` | A yes/no, a note, and a line of text, as dialogs in the editor's chrome rather than the browser's blocking boxes. `confirm` resolves `false` and `prompt` `null` on Cancel, Escape or the ×. Options: `title`, `confirmLabel`, `cancelLabel`, `danger` (a destructive primary button), and for `prompt` also `value`, `placeholder`, `multiline`. |
| `progress(label, { title?, cancellable? })` | A progress panel over the map for long work — it blocks nothing, so report often: `report(0…1, text?)`, `cancelled()` (check it in your loop; the × counts as cancelling, `done()` does not), `done()`, `isOpen()`. A modal dialog covers the map and dims the panel behind it, so start the work from a panel, a menu item, or after closing your dialog. |
| `el(tag, props?, ...children)` | The DOM helper the widgets are built from: `style` takes an object, `on*` keys take listeners, everything else is a property or an attribute. |
| `widgets` | Buttons, fields, forms and lists in the editor's own styles, as plain DOM: `button(label, { primary, danger, ghost, onClick })`, `checkbox(label, { value, radio, name, onChange })` (the `<label>` carries its `input`), `text(...)`, `number({ min, max, step, ... })`, `select(items, ...)`, `form(rows)` (a two-column grid of `{ label, field }`), `group(title, ...children)`, `row(...)`, `column(...)`, `hint(text)`, `separator()`, `list(items, { selected, height, onPick })`. Use them and a plugin's dialog looks like a built-in one; `el` is the escape hatch. |
| `open(dialogId, payload?)` | Any built-in dialog (`"mapProperties"`, `"unitSettings"`, …). |
| `repaint()` | Bump the terrain revision when you changed something the transaction did not cover. |

### `api.menu` / `api.contextMenu` / `api.hotkeys`

- `menu.add(path, item)`: `path` is a top-level menu (`"File"`, `"Edit"`, `"View"`,
  `"Layer"`, `"Scenario"`, `"Triggers"`, `"Tools"`, `"Plugins"`, `"Help"`) or a submenu
  by label (`"File/Import"`). Plugin items appear after a separator at the end of that
  menu, unless `after` names a built-in item or submenu (`after: "Open Recent"`), in
  which case the item sits directly under it. `item` is
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

`on(event, fn)` for `"document"` (opened, closed, replaced), `"terrain"` (fog edits
included — they paint the same revision), `"units"`, `"sprites"` (the doodads revision,
which THG2 records ride on), `"doodads"`, `"locations"`, `"settings"`, `"triggers"`,
`"layer"`, `"selection"`, `"clipboard"` (the marked area or the clip), `"view"` (scrolled,
zoomed, or a View tick moved), `"tool"` (a map tool or pick started or stopped),
`"modified"` (the unsaved-changes flag), and `"palette"` (a palette's pick changed:
terrain brush, unit and owner, sprite, doodad, fog players).

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
| `src/atoms/pluginAtoms.ts` | `installedPluginsAtom` (persisted, with `local` per plugin), `pluginCodeAtom` (the stored copies), `pluginRuntimesAtom`, the contribution registries `pluginMenuItemsAtom`, `pluginContextItemsAtom`, `pluginHotkeysAtom`, `mapPickAtom` — the `pickArea` / `pickTile` request the viewport is serving (`cancelMapPickAtom` is what Esc and a right-click write) — and its siblings `mapToolAtom` (the running `ui.mapTool`, with `cancelMapToolAtom` and `mapToolRevisionAtom` for `redraw`), `pluginOverlaysAtom` (the registered `ui.overlay`s with their visibility — `setOverlayVisibleAtom` is the one writer, `pluginOverlayRevisionAtom` their `redraw`, `overlayVisibilityMemory` what the user last chose per plugin and name) and `pluginPanelsAtom` (the open `ui.panel`s). |
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

[scm-js/plugin-section-explorer](https://github.com/scm-js/plugin-section-explorer), listed
by default and off until ticked, is the worked example for `api.document.sections` and
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

[scm-js/plugin-walkability](https://github.com/scm-js/plugin-walkability), listed by
default and off until ticked, is the worked example for a read-only analysis drawn over
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

[scm-js/plugin-melee-wizard](https://github.com/scm-js/plugin-melee-wizard), listed by
default and off until ticked, is the worked example for `placeUnit` / `canPlaceUnit` /
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
