# Plugins

A plugin is a small program the editor loads from a public Git repository or a web
address. It can add menu items, hotkeys, dialogs, panels, map tools and overlays, and it
can read and change the open map through the same undo model the built-in tools use.

This page has five parts, and ends with a list of [plugins to read](#plugins-to-read):

- **[Using plugins](#using-plugins)**: what is available, how to install one, what a
  plugin is allowed to do, and how to update or remove one.
- **[Your first plugin](#your-first-plugin)**: a small plugin built step by step, from a
  few lines in the playground to a published repository.
- **[Writing a plugin](#writing-a-plugin)**: each piece in detail: the playground, the
  two files, typings, bundling, debugging, testing, publishing.
- **[Recipes](#recipes)**: complete snippets for common jobs, such as a problems panel,
  a brush of your own, or triggers generated from a table.
- **[The API, group by group](#the-api-group-by-group)**: what each part of the API is
  for, the rules a signature does not show, and an example for each. Every call has its
  own entry in the [API reference](https://docs.scmjs.dev/api/), generated from the
  editor's declarations.

How the editor loads plugins internally is in
[docs/development.md](development.md#the-plugin-host).

## Using plugins

This part is for map makers: which plugins there are, how to install and update them,
and what you are trusting when you do.

### What is available

Nine plugins are installed and on from the start, and one more is installed but off. The
rest are in Plugins ▸ **Browse Plugins…**. The [user guide](guide.md#plugins)
describes each in more detail, and each repository has its own README.

| Plugin | Starts | Where it appears | What it does |
| --- | --- | --- | --- |
| [Walkability](https://github.com/scm-js/plugin-walkability) | on | View ▸ Walkability | Shows the ground as units walk it: islands, chokes and their widths, distances between starts. |
| [Paint](https://github.com/scm-js/plugin-paint) | on | Tools ▸ Paint… | Freehand, lines, shapes, spray and text with whatever the active layer's palette has picked. |
| [Repair](https://github.com/scm-js/plugin-repair) | on | on open, Tools ▸ Repair Map… | Finds what is missing, damaged or the wrong size in a map file, and repairs it. |
| [Terrain from Image](https://github.com/scm-js/plugin-image-to-terrain) | on | File ▸ Import ▸ Terrain from Image… | Turns a picture into terrain with the isometric brush. |
| [TrigScript](https://github.com/scm-js/plugin-trigscript) | on | Triggers ▸ TrigScript… | Triggers written as TypeScript, kept inside the map. |
| [Stamp Library](https://github.com/scm-js/plugin-stamp-library) | on | Tools ▸ Stamp Library… | Saved pieces of map (a ramp, a mineral line) to lay down again on any map. |
| [scmscx.com](https://github.com/scm-js/plugin-scm-scx) | on | File ▸ Find on scmscx.com… | Searches the scmscx.com map archive and opens the map you pick. |
| [scmjs.dev](https://github.com/scm-js/plugin-scmjs-dev) | on | Account menu | Your scmjs.dev account: stored maps, share links, editing a map together. |
| [eudplib](https://github.com/scm-js/plugin-eudplib) | on | (none of its own) | A library other plugins build EUD maps with. TrigScript and Magenta use it. |
| [TrigEdit](https://github.com/scm-js/plugin-trigedit) | off | Triggers ▸ Text Trigger Editor… | The text trigger format, for triggers carried over from SCMDraft. |
| [Melee Wizard](https://github.com/scm-js/plugin-melee-wizard) | Browse | Tools ▸ Melee Wizard… | Symmetric start locations, mineral lines and geysers. |
| [Section Explorer](https://github.com/scm-js/plugin-section-explorer) | Browse | Tools ▸ Section Explorer… | The map file's sections in a hex editor, with what each byte means. |
| [Magenta](https://github.com/scm-js/plugin-magenta) | Browse | Triggers ▸ Magenta… | A trigger editor where each trigger reads as a sentence, with Remastered EUD conditions and actions. |
| [Trigger Map](https://github.com/scm-js/plugin-trigger-map) | Browse | Triggers ▸ Trigger Map… | The triggers as a graph: what each one waits for and what it changes, and what does not fit together. |
| [Timelapse](https://github.com/scm-js/plugin-timelapse) | Browse | View ▸ Timelapse… | Records the map as you build it and exports the recording as a GIF or video. |
| [Aftermath](https://github.com/scm-js/plugin-aftermath) | Browse | File ▸ Open Replay… | Plays a replay back over its map: heat maps, build orders, APM. |
| [Hello World](https://github.com/scm-js/plugin-hello-world) | Browse | Tools ▸ Hello World… | An example plugin to copy when writing your own. |
| [API Playground](https://github.com/scm-js/plugin-api-playground) | Browse | Tools ▸ API Playground | A code editor with the plugin API in scope. Runs a few lines against the open map, and exports them as a new plugin. |

The installed ones are *defaults*: they are built into the editor, so a fresh install has
them without going to the network. A default can be turned off but not removed.

### Installing one

![Browse Plugins](images/browse-plugins.webp)

- **From the list.** Plugins ▸ **Browse Plugins…**, then **Install** on a row.
- **From an address.** Plugins ▸ **Manage Plugins…**, then paste the address.
- **From a link.** A link to the editor ending in `?plugin=github:scm-js/<repository>`
  offers that plugin when the editor opens: the same confirmation as Browse Plugins if it
  is not installed, or a notice with **Turn It On** if it is installed but off. The
  documentation's **Try it** links use this to offer the API Playground. Only the
  project's own repositories can be named this way.

In every case the editor shows where the code comes from and asks before it adds anything.
An address can take any of these forms:

| Address | What it points at |
| --- | --- |
| `github:owner/repo` | A GitHub repository, at its default branch. |
| `github:owner/repo@v1.2` | A tag, branch or commit of it. |
| `github:owner/repo@v1.2/plugins/mine` | A folder inside a repository, for several plugins in one. |
| `https://github.com/owner/repo/tree/v1.2/plugins/mine` | The same, copied from the browser's address bar. |
| `https://…/plugin.json` | A plugin's manifest anywhere: GitLab, a gist, your own server. |
| `https://…/plugin.ts` | A single plugin file with no manifest. |
| `http://localhost:3000/` | A folder holding `plugin.json` on your own machine, while you write a plugin. |

### What you are trusting

**There is no sandbox.** A plugin has the same access as the editor: it can read and
change the open map, read and write the files in the map archive and the editor's browser
storage, and make network requests. It is the same trust a browser extension asks for, so
only add plugins you trust.

Before any code is fetched, the Add screen shows what the plugin says about itself (name,
version, author, description and icon from its `plugin.json`), links to its repository,
and the addresses the code will come from. Nothing has run yet, so this is the moment to
look at the repository. The screen has three options:

| Option | Default | What it does |
| --- | --- | --- |
| Enable it now | on | Start the plugin as soon as it is added. |
| Pin to this version | on | Store the exact commit the address points at today, so the plugin never changes under you. |
| Load from a copy saved here | off | Keep a copy of the plugin's files in this browser and load from that until you press Reload. |

A plugin that needs another one (see [Requiring another plugin](#requiring-another-plugin))
lists it under *Also installs*.

### Keeping a plugin up to date

A pinned plugin never changes by itself; a push to its repository reaches nobody who has
it installed. To move forward:

- **Check for update** on a row in Manage Plugins asks the repository for its newest
  release. If it is newer, the button becomes *Update to …*, which shows the new manifest
  and asks before changing anything. **Check all for updates** does every row.
- Only releases (version tags) count. Commits pushed after the newest release are not
  offered.
- Browse Plugins also marks *v… available* on a row when its list carries a newer version
  than the one you run.

Preferences ▸ Plugins ▸ **Plugin updates** decides whether the editor looks for you. It
reads the plugin list at most once every six hours, one request however many plugins you
have.

| Choice | What happens |
| --- | --- |
| Tell me (default) | A notice names what is newer, with a button to Manage Plugins. |
| Do nothing | Nothing is checked until you press a row's button. |
| Install them | Newer versions of the plugins you added yourself are installed. Defaults, plugins loading from a saved copy, plugins that are off, and versions that need a newer editor are only named in the notice. |

**Defaults** move with the editor: each release carries the versions it was tested with,
and a built-in default is never checked until you press its button. Updating one makes it
an ordinary plugin fetched from its repository at each start; **Revert** on the row goes
back to the version the editor ships.

The other buttons on a row:

- **Reload** fetches the plugin again and replaces any saved copy. For a pinned plugin
  that is the same commit, so it is mostly for plugins you are writing.
- **Turning a plugin off** removes everything it added: menu items, hotkeys, dialogs,
  panels, overlays and listeners.
- **Remove** also takes it off the list. Defaults cannot be removed.

A plugin that fails to load raises a notice with a button to Manage Plugins, where its row
shows the error.

### Where a plugin keeps its data

- **In the browser.** A plugin's settings appear in Preferences ▸ Storage as one row under
  its id, with a button to clear them. Clear all data removes them too.
- **In the map.** A plugin can keep files inside the map archive, so they travel with the
  map. TrigScript keeps its scripts this way. The Save dialog lists these files and can
  leave them out.

### Sources

Browse Plugins reads *registries*: JSON files listing plugins and the address each installs
from. The project's own is [`scm-js/registry`](https://github.com/scm-js/registry), and the
**Sources** button adds others. A registry only decides what is *offered*; installing from
it goes through the same Add screen and pinning as a pasted address.

Plugins you have that no registry lists (one you added by address, or one a list dropped)
are shown under *Already installed*, marked *not listed*.

## Your first plugin

This part builds one small plugin from nothing to a published repository. The plugin is
**Base Check**: it counts the mineral fields and geysers near each start location, lists
them in a panel, and can set every short mineral field back to the full amount. It is
about sixty lines, and it uses the parts of the API most plugins use: reading the map,
a panel, an edit with undo, events, storage, a menu item and a hotkey.

You need nothing installed. The first three steps run in the editor's API Playground;
the files come in step 4.

### Before you start

1. Open the editor and a melee map, or make a map with File ▸ New and a few start
   locations and mineral fields, so the plugin has something to count.
2. Install the [API Playground](https://github.com/scm-js/plugin-api-playground) from
   Plugins ▸ Browse Plugins…, and open Tools ▸ API Playground.

The playground is a code editor in which `api` is already defined. Ctrl+Enter runs what
you wrote against the open map. On the documentation site each step below has a **Try
it** link that opens the editor with the code already in the playground.
[Trying the API first](#trying-the-api-first) describes the playground in full.

![The API Playground beside the map: the "Place units in a ring" example has run, and the marines it placed are on the map](images/api-playground.webp)

### Step 1: read the map

Reading needs no setup. `api.document.scenario()` is the open map, `api.query` answers
questions about it, and `api.consts` has the numbers the map file uses, so the code
does not hard-code that a vespene geyser is unit 188.

```ts
const { tile, unit } = api.consts;
const radius = 12 * tile; // unit positions are in pixels; a tile is 32 of them

function census() {
  const units = api.document.scenario()?.units ?? [];
  return api.query.startLocations().map((start) => {
    const near = units.filter((u) => Math.hypot(u.x - start.x, u.y - start.y) <= radius);
    return {
      start,
      minerals: near.filter((u) => api.consts.isResource(u.unitId) && u.unitId !== unit.vespeneGeyser).length,
      geysers: near.filter((u) => u.unitId === unit.vespeneGeyser).length,
    };
  });
}

for (const row of census()) {
  api.log(api.names.player(row.start.owner), `${row.minerals} mineral fields, ${row.geysers} geysers`);
}
```

Run it and the playground's output lists one line per start location. Two things to
notice:

- **Nothing throws without a map.** `scenario()` answers `null` and `startLocations()` an
  empty list, so the code above prints nothing instead of failing.
- **Players count from 0.** `start.owner` 0 is Player 1, as in the map file.
  `api.names.player` turns the slot into the name the editor shows.

### Step 2: show it in a panel

A panel floats over the map without blocking it. Its `mount` function receives an empty
element to fill, and `api.ui.widgets` builds lists, buttons and fields that look like the
editor's own. The list is rebuilt whenever the units change, and clicking a row takes
the view to that start location.

```ts
const { tile, unit } = api.consts;
const radius = 12 * tile;

function census() {
  const units = api.document.scenario()?.units ?? [];
  return api.query.startLocations().map((start) => {
    const near = units.filter((u) => Math.hypot(u.x - start.x, u.y - start.y) <= radius);
    return {
      start,
      minerals: near.filter((u) => api.consts.isResource(u.unitId) && u.unitId !== unit.vespeneGeyser).length,
      geysers: near.filter((u) => u.unitId === unit.vespeneGeyser).length,
    };
  });
}

api.ui.panel({
  title: "Base Check",
  width: 280,
  mount(body) {
    const show = () => {
      const items = census().map((row) => ({
        label: api.names.player(row.start.owner),
        hint: `${row.minerals} minerals · ${row.geysers} gas`,
        value: row.start,
      }));
      body.replaceChildren(
        items.length > 0
          ? api.ui.widgets.list(items, { onPick: (start) => api.view.goTo({ kind: "unit", index: start.index }) })
          : api.ui.widgets.hint("This map has no start locations."),
      );
    };
    show();
    const subscriptions = [api.events.on("units", show), api.events.on("document", show)];
    return () => subscriptions.forEach((s) => s.dispose());
  },
});
```

Place or delete a mineral field while the panel is open and the count follows. The
function `mount` returns is its cleanup: it runs when the panel closes, and here it stops
the two listeners. The `"document"` event covers opening another map or switching tabs.

### Step 3: change the map

Every change to terrain or objects goes through `api.document.edit`. It takes the label
Edit ▸ Undo will show and a function, and everything the function does becomes one undo
entry. Here the edit sets every mineral field holding less than the standard 1500 back
to 1500, and flashes the ones it changed.

```ts
const { unit } = api.consts;
const units = api.document.scenario()?.units ?? [];
const short = units.flatMap((u, index) =>
  api.consts.isResource(u.unitId) && u.unitId !== unit.vespeneGeyser && u.resourceAmount < unit.defaultMinerals ? [index] : [],
);

const result = api.document.edit("Top up minerals", (tx) =>
  tx.updateUnits(short, () => ({ resourceAmount: unit.defaultMinerals })),
);
if (result.changed) api.view.flash({ units: short });
api.ui.status(`${result.units} mineral fields topped up`);
```

Press Ctrl+Z in the editor and the amounts go back. You did not mark anything as
modified, repaint the map or write the undo record: the transaction does all three.

The function you pass must not be `async`. Fetch, load and ask the user before the call,
then write in one go. [Asynchronous calls](#asynchronous-calls-and-the-one-synchronous-builder)
has the reason.

### Step 4: make it a plugin

A plugin is two files in a folder: `plugin.json`, which describes it, and `plugin.ts`,
which exports a function the editor calls with `api`.

In the playground, **Export as Plugin…** saves a zip with both files and the typings and
build setup already in place. Or make the folder by hand:

`plugin.json`:

```json
{
  "name": "Base Check",
  "version": "1.0.0",
  "description": "Counts the resources at each start location and tops up short mineral fields.",
  "entry": "plugin.ts",
  "icon": "⛏️",
  "api": 1
}
```

`plugin.ts` is the three snippets above put together, with the setting for the radius
kept in `api.storage`, a menu item and a hotkey:

```ts
import type { PluginApi } from "@scm-js/plugin-api";

export default function activate(api: PluginApi) {
  const { tile, unit } = api.consts;
  const w = api.ui.widgets;
  let radius = api.storage.get("radius", 12); // in tiles
  let panel: ReturnType<typeof api.ui.panel> | null = null;

  const isMineral = (id: number) => api.consts.isResource(id) && id !== unit.vespeneGeyser;

  function census() {
    const units = api.document.scenario()?.units ?? [];
    return api.query.startLocations().map((start) => {
      const near = units.filter((u) => Math.hypot(u.x - start.x, u.y - start.y) <= radius * tile);
      return {
        start,
        minerals: near.filter((u) => isMineral(u.unitId)).length,
        geysers: near.filter((u) => u.unitId === unit.vespeneGeyser).length,
      };
    });
  }

  function topUp() {
    const units = api.document.scenario()?.units ?? [];
    const short = units.flatMap((u, index) => (isMineral(u.unitId) && u.resourceAmount < unit.defaultMinerals ? [index] : []));
    const result = api.document.edit("Top up minerals", (tx) =>
      tx.updateUnits(short, () => ({ resourceAmount: unit.defaultMinerals })),
    );
    if (result.changed) api.view.flash({ units: short });
    api.ui.status(`${result.units} mineral fields topped up`);
  }

  function open() {
    if (panel?.isOpen()) return;
    panel = api.ui.panel({
      title: "Base Check",
      width: 280,
      mount(body) {
        const rows = api.ui.el("div");
        const show = () => {
          const items = census().map((row) => ({
            label: api.names.player(row.start.owner),
            hint: `${row.minerals} minerals · ${row.geysers} gas`,
            value: row.start,
          }));
          rows.replaceChildren(
            items.length > 0
              ? w.list(items, { onPick: (start) => api.view.goTo({ kind: "unit", index: start.index }) })
              : w.hint("This map has no start locations."),
          );
        };
        const field = w.number({
          value: radius,
          min: 4,
          max: 40,
          onChange: (value) => {
            radius = value;
            api.storage.set("radius", value);
            show();
          },
        });
        body.append(w.form([{ label: "Radius (tiles)", field }]), rows, w.button("Top up minerals", { onClick: topUp }));
        show();
        const subscriptions = [api.events.on("units", show), api.events.on("document", show)];
        return () => subscriptions.forEach((s) => s.dispose());
      },
    });
  }

  api.commands.register({ id: "base-check.open", title: "Base Check", run: open });
  api.menu.add("Tools", { label: "Base Check…", command: "base-check.open", enabled: () => api.document.isOpen() });
  api.hotkeys.add("Ctrl+Alt+B", { command: "base-check.open" });
}
```

![Base Check running: its panel lists four players with seven mineral fields and one geyser each, over a map with a start location, a mineral line and a geyser](images/plugin-base-check.webp)

What changed from the snippets:

- **`activate(api)` wraps everything.** The editor calls it once when the plugin is
  turned on. The `import type` line is only for your code editor and the type-check; it is
  removed before the file runs.
- **Nothing is cleaned up by hand.** The menu item, hotkey, command and panel are removed
  when the user turns the plugin off. Only the two listeners inside `mount` are disposed
  explicitly, because they should stop when the panel closes, not when the plugin does.
- **The command is registered once and used twice.** The menu item and the hotkey both
  name it, and another plugin can run it with `api.commands.run("base-check.open")`. An id
  with a dot in it is used exactly as written; one without is prefixed with the plugin's
  id.

The playground runs a whole `plugin.ts` too: paste it in and `activate` is called, so you
can keep working there until the plugin is ready for its own folder.

### Step 5: load it from your machine

Serve the folder, with cross-origin requests allowed so the editor can fetch from it:

```sh
npx serve --cors .
```

In the editor open Plugins ▸ **Manage Plugins…**, paste `http://localhost:3000/` and
confirm. Tools ▸ Base Check… is now in the menu. After each change to the files, press
**Reload** on the plugin's row.

For completion and type-checking in your own code editor, install the typings in the
folder:

```sh
npm i -D @scm-js/plugin-api
```

If the plugin fails to load, the editor raises a notice and the plugin's row in Manage
Plugins shows the error. View ▸ Debug Console has every `api.log` line, the edits the
plugin made and any listener that threw. [When something goes wrong](#when-something-goes-wrong)
lists the usual mistakes.

### Step 6: publish it

1. Put the folder in a public GitHub repository.
2. Tag a release (`git tag v1.0.0 && git push --tags`). Tags are what the update check
   offers to people who already have the plugin.
3. Anyone can now install it by pasting `github:you/your-repository` into Manage Plugins.

To have it appear in Browse Plugins as well, see [Getting listed](#getting-listed).

### Where to go next

- [Writing a plugin](#writing-a-plugin) covers each piece in more detail: the manifest,
  the icon, bundling npm dependencies, testing, CI, and what your users see when they
  install.
- [Recipes](#recipes) has complete snippets for common jobs.
- [The API, group by group](#the-api-group-by-group) has an example for every part of
  the API.
- [Plugins to read](#plugins-to-read) lists the project's own plugins by what each one is
  a good example of. [Hello World](https://github.com/scm-js/plugin-hello-world) is the
  smallest, with the build and CI already set up.

## Writing a plugin

A plugin is one TypeScript or JavaScript file exporting an `activate(api)` function, next
to a `plugin.json`, in a public repository. There is no build step to start with: the
editor fetches the source, transpiles it in the browser and calls `activate`.

[Your first plugin](#your-first-plugin) walks through writing one. This part is the
reference for each piece.

### Trying the API first

The [API Playground](https://github.com/scm-js/plugin-api-playground) plugin lets you
call the API before setting anything up. Install it from Plugins ▸ Browse Plugins… and
open Tools ▸ API Playground. Its panel has a code editor where `api` is already defined.
Write a few lines, press Ctrl+Enter, and they run against the open map.

- **Stop** removes everything the run added: menu items, listeners, panels, overlays,
  map tools and timers. Running again stops the previous run first.
- **Undo Run** undoes the run's edits to the map.
- The list at the top has worked examples, one idea each.
- **Export as Plugin…** saves the snippet as a zip holding `plugin.json`, a `plugin.ts`
  with the snippet as the body of `activate`, and the typings and build setup described
  below.
- A whole `plugin.ts` pasted in runs too: its `activate` is called, and what it returns
  is called on **Stop**.

Type `api.` for completion. Hovering over a name shows its documentation, the same text
as the [API reference](https://docs.scmjs.dev/api/).

![Hovering over api.document.edit in the playground shows its documentation](images/api-playground-hover.webp)

On the documentation site, an example that runs as it is written has a **Try it** link.
It opens the editor with the example in the playground, and offers to install the
playground if you do not have it. Nothing runs until you press Run. **Copy Link**, at the
foot of the panel, makes the same kind of link for your own snippet.

Examples without a link are fragments: they need something only your plugin has, such as
a server to talk to.

### Starting a plugin

Start from [Hello World](https://github.com/scm-js/plugin-hello-world), or from a snippet
exported from the playground. Hello World's `plugin.ts` is about sixty lines, mostly
comments, and the typings, type-check, build and CI described below are already set up
in it.

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

| Field | Meaning |
| --- | --- |
| `name` | The only required field. |
| `id` | Used for storage keys and log lines. Derived from `name` when absent. |
| `version`, `description`, `author`, `homepage` | Shown on the Add screen and in Manage Plugins. |
| `entry` | The source file. Defaults to `plugin.ts`, then `plugin.js`. |
| `api` | The API version the plugin needs. An older editor refuses to load it. |
| `icon` | See [The icon](#the-icon). |
| `build` | A pre-built bundle to load instead of the source. See [Building](#building). |
| `requires` | Other plugins this one needs. See [Requiring another plugin](#requiring-another-plugin). |

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

Everything `add` and `on` return is a `Disposable`. Keep the ones you want to remove early
and ignore the rest: turning the plugin off disposes all of them. A function returned from
`activate` also runs when the plugin is turned off, for things the API does not know about,
such as timers or sockets:

```ts
import type { PluginApi } from "@scm-js/plugin-api";

export default function activate(api: PluginApi) {
  const timer = setInterval(() => api.log("still running"), 60_000);
  return () => clearInterval(timer);
}
```

`activate` may be `async`.

### Developing locally

```sh
npx serve --cors .
```

Paste `http://localhost:3000/` into Plugins ▸ Manage Plugins…, and press **Reload** on its
row after each change.

### The typings

```sh
npm i -D @scm-js/plugin-api
```

The package is types only: one `index.d.ts`. The `import type` line is removed before the
file runs, so the package matters only for editing and type-checking. The same files are
tagged at [`scm-js/plugin-api`](https://github.com/scm-js/plugin-api) if you prefer a git
dependency.

The package's major version is the API version, so `^1` in `package.json` is right. New
calls do not change the version, since they break nothing that does not use them; the
version is kept for a change that would.

### What the editor does for you

- **Every edit is one undo entry.** `api.document.edit` takes a label and a function,
  applies your operations, and commits them as one history entry, the way a brush stroke
  is recorded. The right file sections are saved, the map repaints, and doodads or units
  your terrain change left stranded are handled in the same entry. If your function
  throws, the edit is rolled back.
- **What you add is removed for you.** Menu items, hotkeys, dialogs, panels, overlays,
  map tools and listeners are all tracked, and turning the plugin off, reloading or
  removing it takes them away whether or not you cleaned up.
- **The map you read cannot be written by accident.** `document.scenario()` and a
  transaction's `scenario` are typed read-only all the way down, so a change has to go
  through `edit`, `update` or `sections`, where it is recorded.
- **Reading is safe with no map open.** Reads answer `null`, `[]` or `false` instead of
  throwing. The exception is the raw-bytes path, `document.sections`, whose `file()` and
  `bytes()` throw.
- **The game's graphics may be missing.** The editor works without Blizzard's data, so
  anything needing the tileset degrades: a terrain operation writes nothing and says so in
  its result. Check what you get back.

### Imports and dependencies

- **Relative imports work**, with or without an extension (`./convert`, `./convert.js`
  meaning `convert.ts`, or a folder's `index.ts`).
- **Package imports need a bundle.** `import x from "some-package"` is refused when the
  editor loads source, because it has no module resolver. `import type` from
  `@scm-js/plugin-api` is fine, since it is removed first. For a real dependency, ship a
  bundle (see [Building](#building)).
- **There is no UI framework to import.** Dialogs and panels hand you a DOM element, and
  `api.ui.widgets` builds controls in the editor's style. If you want a framework, bundle
  it.

### The icon

`icon` is shown in Manage Plugins and in the title bar of your plugin's dialogs.

| `icon` | Meaning |
| --- | --- |
| `"icon.svg"`, `"art/mark.png"` | An image beside the manifest (`.png .svg .jpg .gif .webp .avif .ico`). |
| `"https://…/mark.png"` | An image anywhere. |
| `"data:image/svg+xml,…"` | An image inline in the manifest. |
| `"🗺️"` | Up to four characters, drawn as text. |

Anything else, or an image that fails to load, shows the default plugin mark. Draw for a
30 px square (it is also shown at 14 px) with no frame: an icon that is a bordered square
looks like a second checkbox next to the row's own. Terrain from Image's `icon.svg` is an
example.

### Building

A plugin can ship a bundle and name it in the manifest:

```json
"build": "dist/plugin.js"
```

The editor then imports that one file instead of compiling your source file by file. It
is faster for anything bigger than one file, and the only way to use an npm dependency.
Keep `entry` in the manifest too: it is what people read, and what loads when no bundle
is published.

The project's plugins all build with one esbuild command:

```json
"build": "esbuild plugin.ts --bundle --format=esm --target=es2022 --platform=browser --outfile=dist/plugin.js",
"dev": "npm run build -- --watch"
```

Commit `dist/plugin.js`, because the editor loads it straight from the repository at the
version the address names. The shared workflow in
[`scm-js/.github`](https://github.com/scm-js/.github) does the rest:

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

- On a push to `main` it type-checks, tests, rebuilds the bundle and commits it.
- On a `v*` tag it rebuilds and checks the committed bundle matches, so a pinned version
  is exactly what its source builds to.
- Weekly, it type-checks against the newest `@scm-js/plugin-api`.

Ship the bundle unminified. Users judge a plugin by reading its repository.

### When something goes wrong

- **The plugin does not load.** The editor raises a notice, and the plugin's row in
  Plugins ▸ Manage Plugins… shows the error: a manifest it could not read, a file it
  could not fetch, an import it refused, or what `activate` threw.
- **It loads and misbehaves.** View ▸ Debug Console lists when each plugin started, every
  `api.log` line, each edit a plugin made, and every listener that threw. Turn on
  **Verbose** to add a line for every call your plugin makes into the editor. It is noisy,
  and it turns itself off when the editor is next loaded.
- **Someone else reports a problem.** Help ▸ Copy Bug Report puts that log on the
  clipboard under a header naming the editor's version and each plugin's, so ask for it.

![The debug console](images/debug-console.webp)

The mistakes that come up most:

| What you see | Why |
| --- | --- |
| A change does not appear after you edit the file. | The editor is running the copy it fetched. Press **Reload** on the plugin's row. |
| `fetch` of your local folder fails. | The folder is served without cross-origin headers. Use `npx serve --cors .`. |
| "a transaction builder must be synchronous". | The function given to `document.edit` or `document.update` is `async`. Await before the call. |
| A line that writes to `scenario()` does not compile. | The map is read-only by design. Make the change in a transaction. |
| A constant imported from `@scm-js/plugin-api` is `undefined`. | The package is types only. Take values from `api.consts`. |
| `import x from "some-package"` is refused. | The editor loads source without a module resolver. Ship a bundle; see [Building](#building). |
| A terrain call changes nothing and returns 0, false or null. | The tileset graphics are not loaded or not installed. `await api.tileset.load()` first, and handle `false`. |
| A unit lands in the top-left corner. | Units are placed in pixels, not tiles. Multiply by `api.consts.tile`. |
| Writes do nothing after the plugin was turned off. | A timer or request outlived the plugin. The Debug Console logs each refused write; clear timers in the function `activate` returns. |
| In the playground, a command or service of yours replaces the playground's. | A snippet runs as the playground, so its ids are prefixed with the playground's id. Use a dotted id of your own (`"my-plugin.open"`). |

### Testing

The project's plugins keep their logic in files that take plain data and never touch
`api`, and test those files alone. `plugin.ts` is then a thin layer that reads from the
API, calls the logic and writes the result back. Paint's geometry, Terrain from Image's
conversion and Stamp Library's storage format are all tested this way.

For Base Check that means moving the counting into a file of its own:

```ts
// census.ts
import type { UnitRecord } from "@scm-js/plugin-api";

export interface Start { owner: number; x: number; y: number }

/** Mineral fields and geysers within `radius` pixels of each start. */
export function census(units: readonly UnitRecord[], starts: readonly Start[], radius: number) {
  return starts.map((start) => {
    const near = units.filter((u) => Math.hypot(u.x - start.x, u.y - start.y) <= radius);
    return {
      owner: start.owner,
      minerals: near.filter((u) => u.unitId >= 176 && u.unitId <= 178).length,
      geysers: near.filter((u) => u.unitId === 188).length,
    };
  });
}
```

and testing it with [Vitest](https://vitest.dev), with no editor involved:

```ts
// tests/census.test.ts
import { expect, it } from "vitest";
import type { UnitRecord } from "@scm-js/plugin-api";
import { census } from "../census";

const unit = (unitId: number, x: number, y: number) => ({ unitId, x, y }) as UnitRecord;

it("counts only what is inside the radius", () => {
  const units = [unit(176, 100, 100), unit(177, 140, 100), unit(188, 100, 180), unit(176, 900, 900)];
  expect(census(units, [{ owner: 0, x: 100, y: 100 }], 200)).toEqual([{ owner: 0, minerals: 2, geysers: 1 }]);
});
```

When the logic needs a few calls of the API, give it a parameter typed as just those
calls, and pass the real `api.text` in the plugin and a stand-in in the test. Repair's
string checks are written this way:

```ts
import type { PluginApi } from "@scm-js/plugin-api";

type TextHelpers = Pick<PluginApi["text"], "bleedingLines" | "fixBleeding">;

export function repairs(strings: readonly (string | null)[], text: TextHelpers) {
  return strings.flatMap((s, index) => (s && text.bleedingLines(s).length > 0 ? [{ index, fixed: text.fixBleeding(s) }] : []));
}
```

The whole plugin is tested by running it: load it from your machine, or paste it into
the playground. The shared CI workflow in [Building](#building) runs the type-check and
the tests on every push.

### What your users see

- **Your manifest is all they see before deciding.** Fill in name, version, author,
  description, icon, repository and homepage.
- **They are pinned to a commit.** A push reaches nobody already running the plugin. They
  move forward with the update check, which shows them your new manifest first. Tag your
  releases: tags are what the registry lists and what the update check offers.
- **They may run a copy saved in their browser**, replaced only when they press Reload.

### Requiring another plugin

A plugin can depend on another, such as a trigger editor that needs a compiler. Name it
in the manifest with the same address you would paste into Manage Plugins:

```json
{ "name": "Magenta", "requires": ["github:scm-js/plugin-eudplib"] }
```

The editor then treats the two as a pair:

- Adding yours adds the required one first, with the same options.
- Turning yours on turns it on, and at startup it starts before yours.
- While yours is on, it cannot be turned off or removed; its row says which plugin needs it.

The manifest does not say which version is enough. The two meet through `api.services`:
the required plugin provides a service with a version, and yours checks it and explains in
its own UI when it is too old. If the required plugin is missing, yours still starts and
sees no service.

### Talking to a server

You call `fetch` yourself. Two things only show up in the desktop app:

- **The desktop app's origin is `app://scmjs`.** The web builds are
  `https://editor.scmjs.dev` and `https://nightly.editor.scmjs.dev`. Your server's CORS
  settings need to allow all three, or desktop requests fail as if the server were down.
- **Open a sign-in popup blank, then point it.** A link opens in the user's real browser,
  which cannot post a session back. Open an empty named window
  (`window.open("", "my-plugin-signin", "width=540,height=720")`) and set its
  `location.href` once your server says where to go.

### Getting listed

[`scm-js/registry`](https://github.com/scm-js/registry) is generated from the `scm-js`
organisation: every repository named `plugin-…`, or with both the `scmjs` and `plugin`
topics, is listed with the `plugin.json` at its newest version tag. It refreshes hourly.

For a plugin anywhere else, fill in the
[submission form](https://github.com/scm-js/registry/issues/new?template=submit-plugin.yml)
with your repository's address and the search words you want. The listing reads the rest
from your `plugin.json`. A bot checks the repository right away and replies with what it
found, and then someone reads the code and decides whether to list it.

Any URL serving a file in the same format is a registry, and users can add one under
Sources.

## Recipes

Complete snippets for common jobs, each using several parts of the API together. Every
one runs in the playground as written; in a plugin, the same lines go inside
`activate(api)`. [The API, group by group](#the-api-group-by-group) explains each call
they use.

### A problems panel that follows the map

Check Map's findings in a docked panel, refreshed after every change. Clicking a row
goes to the unit, location or trigger, or opens the settings dialog the problem is in.

```ts
const w = api.ui.widgets;

api.ui.panel({
  title: "Problems",
  dock: "right",
  grow: true,
  mount(body) {
    const show = () => {
      const issues = api.query.validate();
      body.replaceChildren(
        issues.length === 0
          ? w.hint("Check Map finds nothing wrong.")
          : w.list(issues.map((issue) => ({ label: issue.text, title: `${issue.level}: ${issue.where}`, value: issue.target })), {
              onPick: (target) => {
                if (!target) return;
                if (target.kind === "dialog") api.ui.open(target.id);
                else api.view.goTo(target);
              },
            }),
      );
    };
    show();
    const subscriptions = [api.events.on("commit", show), api.events.on("document", show)];
    return () => subscriptions.forEach((s) => s.dispose());
  },
});
```

### A heat map of where the units are

An overlay drawn from the map's own data: units counted in blocks of four tiles, and each
block tinted by how many it holds. The count is redone when the units change, not on
every repaint, because `draw` runs each time the view moves.

```ts
const BLOCK = 4; // tiles
let blocks = new Map<string, number>();

function count() {
  blocks = new Map();
  for (const u of api.document.scenario()?.units ?? []) {
    const key = `${Math.floor(u.x / api.consts.tile / BLOCK)},${Math.floor(u.y / api.consts.tile / BLOCK)}`;
    blocks.set(key, (blocks.get(key) ?? 0) + 1);
  }
}
count();

const overlay = api.ui.overlay({
  name: "Unit density",
  draw(ctx, view) {
    const size = BLOCK * view.tilePx;
    for (const [key, units] of blocks) {
      const [bx, by] = key.split(",").map(Number);
      ctx.fillStyle = `rgba(255, 120, 40, ${Math.min(0.7, units * 0.12)})`;
      ctx.fillRect(view.x(bx * BLOCK * api.consts.tile), view.y(by * BLOCK * api.consts.tile), size, size);
    }
  },
});

for (const event of ["units", "document"] as const) {
  api.events.on(event, () => {
    count();
    overlay.redraw();
  });
}
```

![A docked Problems panel listing Check Map's findings, and the Unit density overlay tinting the blocks of the map that hold units](images/plugin-recipes.webp)

### A brush of your own

A map tool that paints the Terrain palette's current terrain while the button is held,
and commits the whole drag as one undo entry when it is released. Collecting during the
drag and writing once on release is what makes one stroke one Ctrl+Z.

```ts
await api.tileset.load();
const stroke = new Map<string, { d: { x: number; y: number }; px: number; py: number }>();

function add(px: number, py: number) {
  const d = api.terrain.diamondAt(px, py);
  if (api.terrain.isDiamond(d)) stroke.set(`${d.x},${d.y}`, { d, px, py });
  tool.redraw();
}

const tool = api.ui.mapTool({
  name: "Terrain pencil",
  hint: "drag to paint, Esc to stop",
  onDown(p) { add(p.px, p.py); },
  onMove(p) { if (p.down) add(p.px, p.py); },
  onUp() {
    const terrain = api.terrain.active().terrain; // whatever the Terrain palette has picked
    const diamonds = [...stroke.values()].map((s) => s.d);
    stroke.clear();
    api.document.edit("Terrain pencil", (tx) => { for (const d of diamonds) tx.paintIsom(d, terrain); });
  },
  draw(ctx, view) {
    ctx.fillStyle = "#ffd24a";
    for (const { px, py } of stroke.values()) ctx.fillRect(view.x(px) - 3, view.y(py) - 3, 6, 6);
  },
});
```

### Copies of the selection under the symmetry setting

Place a copy of every selected unit at each of its mirror positions, following whatever
Tools ▸ Symmetry is set to, with the Units palette's placement checks.

```ts
const scn = api.document.scenario();
const selected = api.selection.units();

if (!scn || selected.length === 0) {
  api.ui.status("Select some units first.");
} else if (api.terrain.symmetry() === "none") {
  api.ui.status("Turn on Tools ▸ Symmetry first.");
} else {
  const originals = selected.map((index) => scn.units[index]);
  const result = api.document.edit("Mirror units", (tx) => {
    for (const u of originals) {
      // The first point is the unit's own position; the rest are its images.
      for (const p of tx.mirrorPoint(u.x, u.y).slice(1)) {
        if (tx.canPlaceUnit(u.unitId, p.x, p.y)) tx.placeUnit(u.unitId, u.owner, p.x, p.y);
      }
    }
  });
  api.ui.status(`${result.units} units placed`);
}
```

### Triggers generated from a table

Attack waves written as data and turned into triggers through the text format. The
triggers name a location, so the snippet adds it first if the map does not have one.

```ts
const waves = [
  { after: 60, unit: "Zerg Zergling", count: 8 },
  { after: 180, unit: "Zerg Hydralisk", count: 6 },
  { after: 300, unit: "Zerg Ultralisk", count: 2 },
];

if (api.triggers.names().locationByName("Spawn") === undefined) {
  const t = api.consts.tile;
  api.document.edit("Add the Spawn location", (tx) => {
    tx.addLocation({ left: 2 * t, top: 2 * t, right: 6 * t, bottom: 6 * t }, "Spawn");
  });
}

const source = waves.map((wave) => `
Trigger("Player 8"){
Conditions:
  Elapsed Time(At least, ${wave.after});
Actions:
  Create Unit("Player 8", "${wave.unit}", ${wave.count}, "Spawn");
}`).join("\n");

try {
  let added = 0;
  api.document.update("Add the waves", (tx) => { added = tx.triggers.fromText(source); });
  api.ui.status(`${added} triggers added`);
} catch (error) {
  api.ui.status(String(error)); // a parse error names the line
}
```

A plugin that regenerates its triggers should also [claim them](#apitriggers), so the
Trigger Editor shows them as generated and the user does not edit them by hand.

### Notes kept inside the map

A text box whose contents are stored as a file in the map archive, so they travel with
the map and are written on the next Save. The write is delayed until typing pauses.

```ts
const FILE = "my-plugin\\notes.txt";

function read() {
  const bytes = api.document.extras.get(FILE);
  return bytes ? new TextDecoder().decode(bytes) : "";
}

api.ui.panel({
  title: "Map notes",
  width: 320,
  mount(body) {
    const area = api.ui.el("textarea", { rows: 10, style: { width: "100%" }, value: read() });
    let timer = 0;
    area.addEventListener("input", () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (api.document.isOpen()) api.document.extras.set(FILE, new TextEncoder().encode(area.value));
      }, 400);
    });
    // Another map opened, or came to the front: show its notes.
    const subscription = api.events.on("document", () => { area.value = read(); });
    body.append(area, api.ui.widgets.hint("Stored in the map file on the next Save."));
    return () => {
      clearTimeout(timer);
      subscription.dispose();
    };
  },
});
```

### Units out to a spreadsheet and back

Export every unit as a CSV file:

```ts
const scn = api.document.scenario();
if (scn) {
  const rows = scn.units.map((u) => [u.unitId, api.names.unit(u.unitId), u.owner + 1, u.x, u.y].join(","));
  const csv = ["id,name,player,x,y", ...rows].join("\n");
  await api.ui.saveFile(new Blob([csv], { type: "text/csv" }), "units.csv");
}
```

And place units from one, as a single undo entry. A row with anything that is not a
number where a number belongs is skipped:

```ts
const [file] = await api.ui.pickFiles({ accept: ".csv" });
if (file) {
  const rows = (await file.text()).split("\n").slice(1).map((line) => line.split(","));
  const result = api.document.edit("Import units", (tx) => {
    for (const [id, , player, x, y] of rows) {
      const values = [id, player, x, y].map(Number);
      if (values.every(Number.isFinite)) tx.placeUnit(values[0], values[1] - 1, values[2], values[3]);
    }
  });
  api.ui.status(`${result.units} units placed`);
}
```

### Find and replace in every string

`document.update` has no undo entry, so the snippet keeps the table as it was and puts an
**Undo replace** cell in the status bar that restores it.

```ts
const find = await api.ui.prompt("Find in every string");
const replacement = find ? await api.ui.prompt(`Replace "${find}" with`) : null;

if (find && replacement !== null) {
  const before = api.query.strings();
  const hits = before.flatMap((text, index) => (text?.includes(find) ? [index] : []));
  if (hits.length === 0) {
    api.ui.status("Not found.");
  } else if (await api.ui.confirm(`Replace in ${hits.length} strings?`, { confirmLabel: "Replace" })) {
    api.document.update("Replace in strings", (tx) => {
      for (const index of hits) tx.strings.set(index, (before[index] ?? "").split(find).join(replacement));
    });
    const undo = api.ui.statusItem({
      text: "Undo replace",
      onClick: () => {
        api.document.update("Undo replace", (tx) => tx.strings.apply(before));
        undo.remove();
      },
    });
  }
}
```

## The API, group by group

This part covers what each group is for and the rules that matter when using it, with an
example for each. For every call's signature and options, follow the **Reference** link
under each heading or start at [docs.scmjs.dev/api](https://docs.scmjs.dev/api/).

The examples are written as playground snippets, with `api` already defined. In a plugin
the same lines go inside `activate(api)`.

Three conventions hold everywhere:

- **Tiles and pixels.** Terrain, fog and rectangles count tiles. Units, sprites and
  locations are placed in map pixels, 32 to a tile (`api.consts.tile`). A rectangle is
  `{ x0, y0, x1, y1 }` in tiles, with `x1` and `y1` exclusive.
- **Players count from 0.** `owner` 0 is Player 1, as in the map file.
- **Ids are the game's.** A unit id is its row in `units.dat` (0 is the Terran Marine),
  and upgrades and technologies likewise. `api.names` turns any of them into a name.

### Asynchronous calls, and the one synchronous builder

**Asynchronous calls return promises.** There are no completion callbacks. When the user
dismisses something (Esc, Cancel, a right-click, the ×), the promise resolves with `null`
or `false` instead of rejecting, so the normal path needs no `try`. This covers opening,
saving and exporting maps, loading game data, and everything that waits for the user
(pickers, `confirm`, `prompt` and so on).

```ts
const rect = await api.ui.pickArea({ prompt: "Pick an area to flatten" });
if (rect) {                                   // null: Esc, a right-click, or no map
  await api.tileset.load();                   // the graphics the fill needs
  const [, ground] = api.terrain.types();     // the tileset's second flat terrain
  if (ground) api.document.edit("Flatten", (tx) => tx.stampTerrain(rect, ground.id));
  else api.ui.status("The tileset graphics are not installed.");
}
```

The remaining callbacks are real callbacks: event listeners, widget handlers, a dialog's
`mount`, and the pointer and `draw` hooks of map tools and overlays. Each returns a
`Disposable` or cleanup function.

**A transaction's function must be synchronous.** `document.edit(label, build)` and
`document.update(label, build)` commit the moment `build` returns. An `async` function
would commit at its first `await`, and the rest would change the map outside the undo
entry. TypeScript refuses one, and the editor catches it at run time too.

Wrong, because the edit commits at the `await` and the placement lands outside it:

```ts
api.document.edit("Place", async (tx) => {
  await api.data.load();
  tx.placeUnit(0, 0, 128, 128);
});
```

Right: await first, then write.

```ts
await api.data.load();
api.document.edit("Place", (tx) => { tx.placeUnit(0, 0, 128, 128); });
```

For long work, `api.ui.progress` shows a panel over the map that does not block editing.
Check `cancelled()` in your loop. Its `signal` is an `AbortSignal`, so a
`fetch(url, { signal: job.signal })` stops when the user cancels.

```ts
const triggers = api.triggers.list();
const job = api.ui.progress("Reading triggers", { cancellable: true });
try {
  for (let i = 0; i < triggers.length && !job.cancelled(); i++) {
    job.report(i / triggers.length, `Trigger ${i + 1} of ${triggers.length}`);
    await new Promise((next) => setTimeout(next, 20)); // the slow part of your work goes here
  }
} finally {
  job.done();
}
```

### The three kinds of write

Every change a plugin makes to the map goes through one of three calls, matching the
editor's own three ways of writing: a brush stroke, a dialog's OK, and a raw file edit.

| Call | Covers | Undo | If your function throws |
| --- | --- | --- | --- |
| `document.edit(label, build)` | Terrain and objects: tiles, ISOM, units, sprites, doodads, locations, fog. | One history entry. | Rolled back. |
| `document.update(label, build)` | Tables and settings: triggers, briefing, strings, switch names, name and description, players, forces, unit / upgrade / tech settings, sounds, map revision. | None, as with a settings dialog. | What was written stays. |
| `document.sections.*` | The file's raw bytes, any section. | None, and the history is cleared. | Nothing is written. |

In both transactions each operation applies immediately, so a later one sees what an
earlier one did. Calling the transaction after the function has returned throws.

Once a plugin is turned off, anything it left behind can no longer change the map: writes
do nothing and log a line in the Debug Console.

### `api.document`

[Reference](https://docs.scmjs.dev/api/document/)

The open map as a whole.

- **Reading:** `isOpen()`, `info()` (name, size, tileset, whether modified), `history()`
  (the undo and redo labels), and `scenario()` for the whole parsed map. It is the
  editor's own live object, typed read-only: a line that writes to it does not compile,
  because a direct write skips undo, is not saved and never repaints. Copy what you want
  to change (`{ ...scn.units[0], x: 64 }` is an ordinary record) and hand it to a
  transaction. A helper of your own that only reads takes `ReadonlyScenario`, or
  `readonly UnitRecord[]` for one of its lists.
- **Writing:** `edit` and `update` (above), and `undo()` / `redo()`.
- **Files:** `open`, `create`, `save`, `saveAs`, `close`, `export` (the map as a `File`,
  the way Save writes it, ready to upload) and `renderImage` (a PNG).
- **Whole-map changes:** `resize` and `changeTileset`. Both clear the undo history, as the
  editor's own dialogs do.
- **Several open maps:** `id()` is the map in front, `list()` every open map, `activate(id)`
  brings one to the front. Every other call works on the map in front. Key anything you
  keep per map on `id()`. Only switch maps when the user asked for it.
- **Files inside the archive:** `extras` lists, reads and writes files stored next to the
  scenario (`list`, `get`, `set`, `remove`). Keep yours in a folder of your own
  (`my-plugin\notes.json`); they are written on the next Save.

Reading, and a file of the plugin's own that travels with the map:

```ts
const info = api.document.info();
if (info) api.log(`${info.name}: ${info.width} × ${info.height}, ${info.tileset}${info.modified ? ", unsaved changes" : ""}`);

const name = "my-plugin\\notes.json";
const stored = api.document.extras.get(name);
const notes = stored ? JSON.parse(new TextDecoder().decode(stored)) : { opened: 0 };
notes.opened++;
api.document.extras.set(name, new TextEncoder().encode(JSON.stringify(notes)));
api.log(`runs of this snippet on this map: ${notes.opened}`);
```

A new map, and a picture of it:

```ts
if (await api.document.create({ width: 96, height: 96, tileset: "jungle", name: "Sketch", startLocations: 2 })) {
  const png = await api.document.renderImage({ pixelsPerTile: 4 });
  if (png) await api.ui.saveFile(png, "sketch.png");
}
```

### `api.document.sections`

[Reference](https://docs.scmjs.dev/api/document/)

The map file as a list of sections, as the game reads it and Save writes it, with unsaved
edits already included. Section Explorer is built on it, and Repair uses its helpers.

- **Reading:** `list()` gives each section's name, offset, size and what the editor knows
  about it. `bytes(index)` is one section's payload, `combined(name)` what the game uses
  when a name is repeated, and `file()` the whole file.
- **Writing:** `write`, `rename`, `insert`, `remove`, `move` and `replaceFile`. After each,
  the file is parsed again from scratch and becomes the open map, so the change reaches
  every part of the editor even for sections it does not understand. The undo history and
  selections are cleared, and the `"document"` event fires with reason `"replace"`. Each
  returns the parser's `warnings`. Indices shift after an insert or remove, so call
  `list()` again.
- **Helpers for repairs:** `required()` (the sections this map's revision must have),
  `defaults(name)` (what File ▸ New would write), `trailing()` (bytes after the last
  readable section), `chkOf(file)` (the scenario inside an `.scx` / `.scm`) and
  `rebuild(names?)` (re-encode sections from the editor's model, fixing sizes, repeats and
  broken string offsets).

```ts
// Sections the map must have and does not, and sections that appear more than once.
const sections = api.document.sections.list();
const present = new Set(sections.map((s) => s.name));
api.log("missing:", api.document.sections.required().filter((name) => !present.has(name)));
api.log("repeated:", [...new Set(sections.filter((s) => s.occurrences > 1).map((s) => s.name))]);
```

### `api.document.buildSteps`

[Reference](https://docs.scmjs.dev/api/document/)

For a plugin that compiles something into the map, such as a script turned into triggers.
A build step runs whenever the map leaves the editor (Save, Test Map and
`document.export`), so the user keeps one file and keeps editing the unbuilt map.

```ts
api.document.buildSteps.add({
  id: "compile",
  label: "My Compiler",
  // Only maps that carry the plugin's source file are built.
  applies: () => api.document.extras.get("my-plugin\\main.txt") !== null,
  async run({ map, fileName, purpose }) {
    api.log(`building ${fileName} (${map.length} bytes) for ${purpose}`);
    return map; // an .scx in, an .scx out: return your compiled map here
  },
});
```

- `applies()` is asked on every save and must be cheap. While it is false, Save is
  unchanged.
- `run` gets the map as Save would write it and returns the built map. Steps from several
  plugins run one after another, in activation order. `purpose` is `"save"`, `"test"` or
  `"export"`.
- The editor keeps the unbuilt scenario inside the file and shows that one when the map is
  opened again, so generated triggers never appear in the trigger list. See
  [Opening and saving maps](file-formats.md#built-maps).
- **A step cannot cost the user a save.** If `run` throws, the map is saved unbuilt and a
  notice shows your error message, so write it for the user. A *Save without it* button
  aborts the `signal` that `run` is also given. Test Map stops on an error instead.
- `before({ id, label, applies?, run })` runs earlier, on the open map rather than on the
  bytes, and may use `document.update` and `document.edit`. TrigScript uses it to write
  its triggers into the trigger list before every save.
- `builtBy()` says which steps built the file the open map came from.

A bare `.chk` is never built, since it has nowhere to keep the unbuilt copy.

### `EditTransaction`

[Reference](https://docs.scmjs.dev/api/document/)

What `document.edit` passes to its function. When the function returns, the transaction
removes doodads the terrain change broke and units the new ground cannot hold (if the
Units palette's *Remove stranded units* is on), commits and repaints.

- **Terrain:** read and set tiles (`tileAt`, `setTile`, `setTiles`), the editor's brushes
  (`stampTerrain`, `paintIsom`, `fillArea`, `placeBlend`, `replaceTerrain`, `fillFlat`),
  and the ISOM lattice (`rebuildIsom`, `tilesFromIsom`). Most brushes need the tileset
  graphics.
- **Objects:** units (`placeUnit`, `canPlaceUnit`, `addUnits`, `moveUnits`,
  `updateUnits`, `placeStartLocations`, …), sprites, doodads (`placeDoodad`,
  `convertDoodads`), locations (`addLocation`, `editLocation`; slot 63, Anywhere, is
  protected), fog (`setFog`, `floodFog`, …) and `paste` for a whole `Clip`.
- **Symmetry:** `mirror` and `mirrorPoint` give the positions Tools ▸ Symmetry would also
  paint, so your edit can follow the user's setting.
- `note(text)` adds a line to the status bar message.

`placeUnit` places the way the Units palette does but makes no checks; ask `canPlaceUnit`
first if you want them.

Several operations, one undo entry: a ring of eight marines round the middle of the map,
with a location over them.

```ts
const info = api.document.info();
if (info) {
  const t = api.consts.tile;
  const cx = (info.width * t) / 2;
  const cy = (info.height * t) / 2;
  const result = api.document.edit("Ring of marines", (tx) => {
    for (let i = 0; i < 8; i++) {
      const x = cx + Math.cos((i * Math.PI) / 4) * 3 * t;
      const y = cy + Math.sin((i * Math.PI) / 4) * 3 * t;
      if (tx.canPlaceUnit(0, x, y)) tx.placeUnit(0, 0, x, y);
    }
    tx.addLocation({ left: cx - 4 * t, top: cy - 4 * t, right: cx + 4 * t, bottom: cy + 4 * t }, "The Ring");
  });
  api.ui.status(`${result.units} marines, ${result.locations} location`);
}
```

Terrain with the isometric brush, which draws the cliffs and shores for you:

```ts
await api.tileset.load();
const [terrain] = api.terrain.isomTypes();
if (terrain !== undefined) {
  api.document.edit("Paint a patch", (tx) => {
    for (const d of api.terrain.diamondsIn({ x0: 8, y0: 8, x1: 16, y1: 16 })) tx.paintIsom(d, terrain);
  });
}
```

### `UpdateTransaction`

[Reference](https://docs.scmjs.dev/api/document/)

What `document.update` passes to its function. The result's `sections` lists the file
sections actually changed, and `changed` is false when nothing was.

| Part | What it covers |
| --- | --- |
| `tx.triggers`, `tx.briefing` | The trigger and briefing lists: `list`, `add`, `replace`, `remove`, `move`, `set`, `fromText`. |
| `tx.strings` | The string table. `intern(text)` reuses an identical string or adds one and never overwrites, since an index may be shared. `set(index, text)` overwrites a slot. |
| `tx.switches` | Switch names. |
| `tx.properties` | The scenario's name and description. |
| `tx.players`, `tx.forces` | Player slots (type, race, colour, force) and the four forces. |
| `tx.unitTypes`, `tx.upgrades`, `tx.techs` | Unit, upgrade and technology settings, with the game's defaults alongside. |
| `tx.sounds`, `tx.cuwp` | WAV slots, and the unit property slots used by *Create Unit with Properties*. |
| `tx.setVersion`, `tx.setTextEncoding` | The map revision and the text encoding. |

A settings change, the way a dialog's OK makes one:

```ts
api.document.update("Set up the scenario", (tx) => {
  tx.properties({ name: "Last Stand", description: "Hold the ring for ten minutes." });
  tx.unitTypes.set(0, { hitPoints: 80, name: "Veteran Marine" });
  tx.switches.setName(0, "Gate is open");
});
```

A trigger built record by record:

```ts
const { condition, action, comparison, player } = api.consts.triggers;

api.document.update("Add a countdown", (tx) => {
  const trigger = api.triggers.newTrigger([player.Player1]);
  const timer = api.triggers.newCondition(condition.CountdownTimer);
  timer.comparison = comparison.AtMost;
  timer.amount = 30;
  trigger.conditions[0] = timer;

  const say = api.triggers.newAction(action.DisplayText);
  say.text = tx.strings.intern("30 seconds remaining");
  trigger.actions[0] = say;
  trigger.actions[1] = api.triggers.newAction(action.PreserveTrigger);
  tx.triggers.add(trigger);
});
```

There is no undo entry. To offer one, keep a copy of what you replaced
(`api.triggers.list()` before) and put it back with `tx.triggers.set(...)`.

### `api.settings`

[Reference](https://docs.scmjs.dev/api/settings/)

The same views as the `UpdateTransaction` parts, for reading without a transaction:
players, forces, unit types, upgrades, techs, sounds, unit property slots, and
`version()` (revision and text encoding). Write through `document.update`.

```ts
for (const p of api.settings.players().slice(0, 8)) {
  api.log(`Player ${p.slot + 1}: ${p.typeName}, ${p.raceName}, ${p.forceName ?? "no force"}`);
}
const marine = api.settings.unitType(0);
if (marine) api.log(`${marine.name}: ${marine.hitPoints} HP${marine.useDefault ? " (the game's default)" : ""}`);
```

### `api.triggers`

[Reference](https://docs.scmjs.dev/api/triggers/)

Reading triggers and everything needed to show one. Writing is `document.update`.

- `list()` and `briefing()` return copies. A record is 16 conditions and 64 actions of
  plain numbers.
- `defs` says what each condition and action type means and which record field holds each
  argument. `text` prints and parses the text trigger format. `summarize` gives the three
  lines the trigger list shows.
- `newTrigger`, `newCondition` and `newAction` make blank records.
- `usage()` lists every death counter and switch the triggers use, for a plugin that needs
  counters of its own. `epd` and `addressOf` do EUD address arithmetic.
- `references()` says what each trigger reads, writes and names: switches, death
  counters, memory addresses, locations, the countdown timer, ore and gas, scores, units,
  strings, sounds, AI scripts and Victory / Defeat / Draw. A condition reads; an action
  writes, or *uses* something without changing it (the location units are created at, the
  text a message shows). Player groups come resolved to slots, with `approximate` set for
  groups the game settles only while it runs, such as *Foes*. `resolvePlayers(group)` does
  that resolution on its own.

Every trigger as the trigger list shows it:

```ts
for (const trigger of api.triggers.list()) {
  const line = api.triggers.summarize(trigger);
  api.log(`${line.players}: ${line.conditions} → ${line.actions}`);
}
```

Switches a condition tests that no action ever sets. The Trigger Map plugin draws its
whole graph from this one call.

```ts
const refs = api.triggers.references().flatMap((t) => t.refs).filter((r) => r.kind === "switch");
const set = new Set(refs.filter((r) => r.access === "write").map((r) => r.id));
const neverSet = [...new Set(refs.filter((r) => r.access === "read" && !set.has(r.id)).map((r) => r.id))];
api.log(neverSet.map((id) => api.names.switch(id)));
```

**To generate triggers, write text.** `tx.triggers.fromText` parses the text format,
interns its strings and resolves names against the open map. That is easier than filling
records field by field:

```ts
const source = `
Trigger("Player 1"){
Conditions:
  Bring("Current Player", "Any unit", "Anywhere", At least, 1);
Actions:
  Display Text Message(Always Display, "You have arrived.");
  Preserve Trigger();
}`;
try {
  api.document.update("Add the arrival trigger", (tx) => { tx.triggers.fromText(source); });
} catch (error) {
  api.ui.status(String(error)); // a parse error names the line
}
```

A location or unit the text names has to exist in the map, or the parse fails with the
line number. The [trigger reference](triggers.md) lists every condition and action in
this form. Use `newTrigger` / `newCondition` / `newAction` to change one field of an
existing record.

**Claiming generated triggers.** `claim(spec)` marks a run of the trigger list as made by
your plugin. The Trigger Editor badges and locks those rows and shows your description
with a button that opens your plugin. The Text Trigger Editor fences them off, and Import
Triggers warns before replacing them.

The run is found by content: `spec.locate(list)` returns `{ start, count }`, or null when
the triggers were edited or removed. Keep a fingerprint of each trigger you generated and
search for them, as TrigScript does. Call `refresh()` on the handle after regenerating.
`claims()` lists every plugin's claimed runs.

```ts
const mine = new Set<string>(); // fingerprints of the triggers this plugin generated

api.document.update("Generate", (tx) => {
  const trigger = api.triggers.newTrigger();
  trigger.actions[0] = api.triggers.newAction(api.consts.triggers.action.PreserveTrigger);
  mine.add(api.triggers.fingerprint(trigger));
  tx.triggers.add(trigger);
});

api.triggers.claim({
  label: "the wave generator",
  badge: "waves",
  locate(list) {
    const start = list.findIndex((t) => mine.has(api.triggers.fingerprint(t)));
    if (start < 0) return null;
    let count = 1;
    while (start + count < list.length && mine.has(api.triggers.fingerprint(list[start + count]))) count++;
    return { start, count };
  },
  describe: () => "Made by the wave generator. Change the waves there, not here.",
});
```

Open Triggers ▸ Trigger Editor… after running it: the new row carries the badge and is
locked, and the form is replaced by your description.

![The Trigger Editor with a claimed trigger: the row has a "waves" badge and the right-hand side shows the plugin's description in place of the form. An "As text" button added by a plugin is at the bottom left](images/plugin-trigger-editor.webp)

The *As text* button at the bottom left of the picture is a [dialog slot](#apiui).

### `api.query`

[Reference](https://docs.scmjs.dev/api/query/)

Read-only questions about the open map.

- **What is where:** `unitAt`, `spriteAt`, `doodadAt`, `locationAt`, `unitsIn`,
  `unitsOf`, `startLocations`, `fogAt`.
- **Placement:** `placement(unitId, x, y)` gives the Units palette's verdict with a reason
  in words; `doodadPlacement` checks a doodad's ground.
- **The editor's own tools:** `validate()` (Check Map's issues), `statistics()`,
  `find(options)` (the Ctrl+F search), `strings()`, `stringUsage()`, `unusedStrings()`.

A map linter is mostly `validate()` and somewhere to go. An issue's `target` is a unit,
location or trigger that `view.goTo` accepts, or a settings dialog to open:

```ts
const issues = api.query.validate();
for (const issue of issues) api.log(issue.level, issue.where, issue.text);

const target = issues.find((i) => i.target)?.target;
if (target?.kind === "dialog") api.ui.open(target.id);
else if (target) api.view.goTo(target);
```

Where a Command Center fits, asked the way the Units palette asks:

```ts
const at = await api.ui.pickTile({ prompt: "Click where the Command Center should go" });
if (at) {
  const t = api.consts.tile;
  const verdict = api.query.placement(106, at.x * t, at.y * t); // 106 is the Terran Command Center
  api.ui.status(verdict?.problem ? `Blocked: ${verdict.reason}` : "It fits.");
}
```

### `api.view`

[Reference](https://docs.scmjs.dev/api/view/)

Where the map view is looking, and showing the user something.

- `zoom` / `setZoom`, `visible()`, `center(x, y)`, `cursorTile()`, the View menu's options
  (`flags` / `setFlags`) and grid size.
- `goTo(target)` scrolls to a tile, unit, sprite or location and selects it, or opens the
  Trigger Editor on a trigger (`{ kind: "trigger", index }`).
- `reveal(rect)` glides the view to show an area, and resolves `false` if the user moved
  the view first. A plugin following its own work should stop following then.
- `flash(target)` briefly highlights tiles, units or locations. Use it for "this just
  changed" so every plugin's highlight looks the same.

```ts
// Visit each start location in turn, until the user takes the view back.
for (const start of api.query.startLocations()) {
  const area = { x0: start.tx - 6, y0: start.ty - 6, x1: start.tx + 6, y1: start.ty + 6 };
  if (!(await api.view.reveal(area))) break;
  api.view.flash({ units: [start.index], kind: "attention" });
  await new Promise((next) => setTimeout(next, 800));
}
```

### `api.data`

[Reference](https://docs.scmjs.dev/api/data/)

The game's own tables (`units.dat` and the rest): hit points, costs, weapons, flags,
graphics. Call `load()` first. Everything is null when the game data was never installed,
so degrade instead of throwing.

```ts
if (await api.data.load()) {
  const units = api.data.units()!;
  // units.dat keeps hit points in 256ths.
  api.log(`Marine: ${units.hitPoints[0] / 256} HP, ${units.mineralCost[0]} minerals, ${api.data.race(0)}`);
} else {
  api.log("no game data installed");
}
```

### `api.gameData`

[Reference](https://docs.scmjs.dev/api/game-data/)

Which set of game files the editor uses (the game's own, or a mod's), and installing,
switching and removing sets; the plugin side of Help ▸ Game Data…. The `"gameData"` event
fires on every change.

A mod's files replace the game's in the same formats, so `data`, `tileset`, `graphics` and
`names` follow them automatically. Mods that extend the game's table sizes are not
covered. A plugin written only for the game's own data can check `profile().id`
(`"starcraft"`) and turn itself off for anything else.

`read(path)` hands over one of the extracted files as bytes, for a plugin that reads the
game's formats itself: `arr/units.dat`, `tileset/jungle.cv5`, `unit/zerg/drone.grp`. Paths
are the archive's, in lower case with forward slashes, and `tileset/manifest.json` and
`unit/manifest.json` list what was extracted. It answers null for a file the copy does
not have.

```ts
const source = api.gameData.source();
api.log(source ? `${source.profile.name}: ${source.label}` : "still starting up");

const dat = await api.gameData.read("arr/units.dat");
api.log(dat ? `units.dat is ${dat.length} bytes` : "no game data installed");
```

### `api.consts`

[Reference](https://docs.scmjs.dev/api/consts/)

The numbers the map file is written in, so a plugin does not hard-code them: pixels per
tile, the start location and resource unit ids, the unit and sprite flag bits, the
Anywhere location's slot, and `triggers`, which has every condition and action type,
player group and argument value.

```ts
// Make the selected units invincible: the state bit, and the two masks that say it is set.
const { state, valid, used } = api.consts.unit;
const selected = api.selection.units();
api.document.edit("Invincible", (tx) => tx.updateUnits(selected, (u) => ({
  stateFlags: u.stateFlags | state.Invincible,
  validProperties: u.validProperties | valid.Invincible,
  validStates: u.validStates | used.State,
})));
```

For an argument that takes one of a fixed set of values, `api.triggers.defs.choices`
gives the values with their labels:

```ts
// What each argument of a Set Switch action can be.
const def = api.triggers.defs.action(api.consts.triggers.action.SetSwitch);
for (const arg of def?.args ?? []) {
  api.log(arg.label, api.triggers.defs.choices(arg.kind).map((c) => `${c.label} = ${c.value}`));
}
```

These live on `api` rather than in the npm package because the package is types only. A
value imported from it type-checks and is then `undefined` at run time. Anything you need
while running has to come from `api`.

### `api.graphics`

[Reference](https://docs.scmjs.dev/api/graphics/)

The images the map view draws, for your own lists and previews: `unitImage`,
`spriteImage`, `tileImage`, `doodadImage`, `renderRect` (part of the map as a PNG) and
`renderClip` (a `Clip` as the paste preview draws it).

Unit and sprite images load lazily, so the first request often returns null. Call
`requestUnit` / `requestSprite`, and redraw in `onImageLoaded`. An image is the editor's
own cached canvas: draw from it onto a canvas of yours instead of moving it into your
page.

```ts
await api.graphics.load();
api.ui.panel({
  title: "Marine",
  mount(body) {
    const show = () => {
      const picture = api.graphics.unitImage(0, { owner: 1 }); // in Player 2's colours
      if (!picture) { body.textContent = api.names.unit(0); return; } // not loaded, or no graphics
      const canvas = api.ui.el("canvas", { width: picture.width, height: picture.height });
      canvas.getContext("2d")?.drawImage(picture.image, 0, 0);
      body.replaceChildren(canvas);
    };
    api.graphics.requestUnit(0);
    const loaded = api.graphics.onImageLoaded(show);
    show();
    return () => loaded.dispose();
  },
});
```

### `api.commands`

[Reference](https://docs.scmjs.dev/api/commands/)

Named actions, so a menu item, a hotkey, a context-menu entry and another plugin can all
reach the same one:

```ts
api.commands.register({ id: "count", title: "Count units", run: () => api.document.scenario()?.units.length ?? 0 });
api.menu.add("Tools", { label: "Count units", command: "count" });
api.hotkeys.add("Ctrl+Alt+U", { command: "count" });

// Any plugin can run it by its full id, and gets what it returns.
api.log(api.commands.run(`${api.plugin.id}.count`));
```

An id without a dot is prefixed with your plugin's id (`"convert"` becomes
`"image-to-terrain.convert"`); one with a dot is used as is, for a name other plugins can
rely on. `run(id)` runs anyone's command. Since plugins start in no fixed order, check
`has(id)` or listen for the `"commands"` event before calling another plugin's.

### `api.services`

[Reference](https://docs.scmjs.dev/api/services/)

A command is one action; a service is an object to share, such as an account, a server
connection or a compiler. One plugin provides it by name and others reach it by that name,
whichever starts first.

```ts
interface Clock { now(): number }

// The provider. The name becomes "<plugin id>.clock".
api.services.provide<Clock>("clock", { now: () => Date.now() }, { version: 1 });

// A consumer, in any plugin, whichever of the two started first.
api.services.watch<Clock>(`${api.plugin.id}.clock`, (clock, info) => {
  api.log(clock ? `clock v${info?.version}: ${clock.now()}` : "no clock yet");
});
```

`watch` calls you immediately and again whenever the provider changes. Names follow the
command rule. The object's shape is up to the provider: publish a `contract.d.ts` in its
repository for consumers to import with `import type`, and pass a `version` to `provide`
so consumers can check it. The scmjs.dev plugin provides its account this way as
`scmjs-dev.account`, and eudplib its compiler as `eudplib.build`.

### `api.sync`

[Reference](https://docs.scmjs.dev/api/sync/)

Editing a map together. The editor turns each change to the map into an *op* (plain JSON)
and applies other people's ops in the order a server gives. Your plugin carries them
between the two. The scmjs.dev plugin's shared maps are built on this.

This example needs a server of your own, so it has no Try it link:

```ts
const session = api.sync.start({
  send: (op) => socket.send(JSON.stringify({ type: "op", op })),
  onEnd: (reason) => leaveRoom(reason),
});
socket.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.type === "ack") session?.confirm();      // the server accepted our oldest op
  if (msg.type === "op") session?.receive(msg.op); // someone else's, in the server's order
};
```

**The server's job is small:** put everyone's ops in one order, confirm each to its
sender, and pass it on to the others. It never needs to read the map.

**The editor does the rest.** Your own ops apply at once. If someone else's arrives before
the server has confirmed yours, the editor undoes yours, applies theirs and reapplies
yours, so every editor ends with the same map. Changes find their objects by content, so
an edit to a unit someone else deleted is dropped.

- `start` answers null when no map is open or another session is already running.
- Incoming ops wait while the user holds a mouse button on the map, while a dialog that
  edits the map is open, or while another map is in front (`holding()` says which).
- `snapshot()` is the map as a file for people joining. It is null while anything is
  pending.
- One session runs at a time. It ends on `stop()`, when the map closes, or when the plugin
  is turned off. If the server rejects one of your ops, end the session: your copy no
  longer matches.

### `api.terrain`

[Reference](https://docs.scmjs.dev/api/terrain/)

Read-only help with the current tileset: the terrains that can be painted (`types`,
`isomTypes`), what a tile is (`tileInfo`, `terrainAt`, `color`, `heightOf`), the ISOM
lattice (`diamondAt`, `diamondsIn`), `floodRegion` and `blendCandidates`. Also the
Terrain palette's current brush (`active` / `setActive`) and Tools ▸ Symmetry
(`symmetry` / `setSymmetry`, `mirror`).

```ts
await api.tileset.load();
for (const t of api.terrain.types()) api.log(t.id, t.name, `height ${t.height}`, t.buildable ? "buildable" : "");

// How much of the map is the same ground as the tile under the pointer.
const { x, y } = api.view.cursorTile();
api.ui.status(`${api.terrain.floodRegion(x, y).length} tiles in this region`);
```

`checkIsom()` measures how well the ISOM lattice matches the tiles. Offer a rebuild when
it reports `stale`, not merely `mismatched`: some mismatch (hand-placed tiles, blends)
never goes away.

```ts
const report = await api.terrain.checkIsom();
if (report?.stale && (await api.ui.confirm("The isometric data is out of step with the tiles. Rebuild it?"))) {
  api.document.edit("Rebuild ISOM", (tx) => { tx.rebuildIsom(); });
}
```

### `api.tileset`

[Reference](https://docs.scmjs.dev/api/tileset/)

The open map's tileset: `id()`, `name()`, `isLoaded()`, `load()` and `raw()` for the
decoded data. `load()` resolves `false` when the graphics were never installed, which is
a normal state. `load("jungle")` fetches another tileset without changing the map, which
`graphics.renderClip` needs to draw a clip from a map on that tileset.

```ts
if (await api.tileset.load()) api.log(`${api.tileset.name()} is loaded`);
else api.ui.toast({ kind: "warn", title: "No tileset graphics", detail: "Install them from Help ▸ Game Data…" });
```

### `api.selection`

[Reference](https://docs.scmjs.dev/api/selection/)

The marked area (`markedArea` / `markArea`), the selected units, sprites, doodads and
locations (by index, with a setter for each), the active layer, and the Layers panel's
locks.

```ts
// Select Player 1's units inside the marked area.
const area = api.selection.markedArea();
if (area) {
  const mine = new Set(api.query.unitsOf(0));
  api.selection.setLayer("units");
  api.selection.setUnits(api.query.unitsIn(area).filter((i) => mine.has(i)));
} else {
  api.ui.status("Mark an area on the Clipboard layer first.");
}
```

### `api.clipboard`

[Reference](https://docs.scmjs.dev/api/clipboard/)

The Cut / Copy / Paste layer, sharing the user's clipboard: `copy`, `cut`, `paste`,
`clip` / `setClip`, and the parts and paste mode. A `Clip` can be pasted into another map.
`capture()` returns what `copy` would take without touching the user's clipboard, for a
plugin that keeps its own clips, like Stamp Library.

```ts
// Take the top-left 8 × 8 tiles without touching the user's clipboard,
// and stamp them twice in one undo entry.
const clip = api.clipboard.capture({ rect: { x0: 0, y0: 0, x1: 8, y1: 8 } });
if (clip) {
  api.ui.status(api.clipboard.summary(clip));
  api.document.edit("Stamp twice", (tx) => {
    tx.paste(clip, 8, 0);
    tx.paste(clip, 16, 0);
  });
}
```

### `api.exchange`

[Reference](https://docs.scmjs.dev/api/exchange/)

The formats behind File ▸ Import / Export: SCMDraft's `.trg` trigger files
(`encodeTrg` / `decodeTrg`) and the tab-separated strings file (`formatStrings` /
`parseStrings`).

```ts
// The triggers as a .trg file SCMDraft opens.
const trg = api.exchange.encodeTrg(api.triggers.list());
await api.ui.saveFile(trg, "triggers.trg");
```

### `api.palette`

[Reference](https://docs.scmjs.dev/api/palette/)

What the Units, Sprites, Doodads and Fog palettes have picked and what they list, so a
plugin can use "whatever the user chose" without a picker of its own. Paint does this.
It also holds the placement rules (collision, terrain, snap to grid, remove stranded
units) that `placeUnit`, `canPlaceUnit` and `query.placement` follow. The Terrain
palette's pick is `terrain.active()`.

```ts
// Place whatever the Units palette has picked, for the player it has picked.
const { unit, owner } = api.palette.active();
const at = await api.ui.pickTile({ prompt: `Click where the ${api.palette.unitName(unit)} goes` });
if (at) {
  const t = api.consts.tile;
  api.document.edit("Place", (tx) => { tx.placeUnit(unit, owner, at.x * t + t / 2, at.y * t + t / 2); });
}
```

### `api.names`

[Reference](https://docs.scmjs.dev/api/names/)

The names behind the numbers in a map: units, upgrades, techs, weapons, player types,
races, player groups, trigger types and AI scripts from the game (with a mod's own names
under a mod's data set, see [docs/game-data.md](game-data.md#names)), and strings,
locations, switches, players and tiles from the open map. The list forms return
`{ value, label }[]` for a drop-down.

```ts
// How many of each unit type the map has, by name.
const counts = new Map<string, number>();
for (const u of api.document.scenario()?.units ?? []) {
  const name = api.names.unit(u.unitId);
  counts.set(name, (counts.get(name) ?? 0) + 1);
}
api.log([...counts].sort((a, b) => b[1] - a[1]));

// A list form, straight into a drop-down.
const upgrade = api.ui.widgets.select(api.names.upgrades());
```

### `api.text`

[Reference](https://docs.scmjs.dev/api/text/)

StarCraft's text control codes (bytes 0x01–0x1F, written `<XX>`), from the same table the
String Editor uses. Use it rather than your own copy: the numbering is easy to get wrong.

- `codes()` lists every code; `runs(text)` splits a string into coloured runs the way the
  game draws it; `plain(text)` removes the codes.
- **Colour carried across lines.** The original game reset the colour at each line break;
  Remastered carries it on. `bleedingLines` finds lines that now draw in a colour their
  author did not choose, and `fixBleeding` fixes them without changing the text.
- **Stacked text.** The original game drew `Name<12>by Author` as two pieces on one line;
  Remastered does not. `stackedLines` finds these lines and `flattenStacks` lays them out
  left to right. The original look cannot be restored, so offer this repair rather than
  applying it by default.

Repair's string checks are these functions over `api.query.strings()`.

```ts
// Every string in the map as the game would draw it, one coloured span per run.
const lines = api.query.strings().flatMap((s) => (s ? api.text.runs(s) : []));
api.ui.dialog({
  title: "Strings as the game draws them",
  mount(body) {
    body.style.background = "#000";
    for (const line of lines.slice(0, 40)) {
      body.append(api.ui.el("div", {}, ...line.runs.map((run) => api.ui.el("span", { style: { color: run.color } }, run.text))));
    }
  },
});
```

```ts
// Fix every string whose colour carries onto a line that did not ask for it.
const strings = api.query.strings();
const result = api.document.update("Fix carried colours", (tx) => {
  strings.forEach((s, i) => {
    if (s && api.text.bleedingLines(s).length > 0) tx.strings.set(i, api.text.fixBleeding(s));
  });
});
api.ui.status(result.changed ? "Strings repaired." : "Nothing to repair.");
```

### `api.ui`

[Reference](https://docs.scmjs.dev/api/ui/)

Everything a plugin shows. The main pieces:

| Call | What it is |
| --- | --- |
| `status`, `toast` | The status bar, and a notice over the map that goes away by itself. |
| `confirm`, `alert`, `prompt` | Simple questions in the editor's style. |
| `dialog(spec)` | A modal dialog. |
| `panel(spec)` | A panel that floats over the map, or sits in the right-hand dock. |
| `statusItem(spec)` | A cell of your own in the status bar. |
| `mapButton(spec)` | A button in the row at the map's bottom-right corner. |
| `dialogSlot(id, spec)` | A button or row added to a built-in dialog's footer. |
| `preferencesPage(spec)` | A page of your own in Edit ▸ Preferences. |
| `mapTool(spec)` | Take over the pointer on the map. |
| `overlay(spec)` | A drawing over the map the user can switch on and off. |
| `pickArea`, `pickTile`, `pickObject`, `pickFiles` | Ask the user to choose something. |
| `widgets`, `el` | Build dialog and panel content in the editor's style. |
| `progress` | A progress panel over the map for long work. |
| `saveFile`, `loadImage`, `readClipboardImage` | Files and pictures. |
| `open`, `ask`, `openDialogs` | Built-in dialogs. |

![The editor with plugin UI in five places, numbered](images/plugin-surfaces.webp)

Where the main pieces appear: a menu item (1), a floating panel (2), a docked panel (3),
a status bar cell (4) and a map button (5). The icon beside each is the plugin's own.

There is no framework here. A dialog or panel gives you an empty element, and you fill
it with plain DOM. `api.ui.widgets` builds buttons, fields, forms and lists in the
editor's own style, and `api.ui.el(tag, props, ...children)` makes any other element.

**Questions** resolve with the answer, or `null` / `false` when the user cancels:

```ts
const name = await api.ui.prompt("Name the map", { value: api.document.info()?.name, confirmLabel: "Rename" });
if (name) {
  api.document.update("Rename", (tx) => tx.properties({ name }));
  api.ui.toast({ kind: "ok", title: "Renamed", detail: name });
}
```

**Dialogs** are modal and cover the map. `mount(body, handle)` fills an empty element;
`buttons` sets the footer (an empty list removes it); `onPaste` and `onDrop` receive
pasted or dropped files and text. To pick something on the map from a dialog, close it,
pick, and reopen it with the result, as Terrain from Image does. A dialog can offer a slot
of its own (`spec.slot`) for other plugins to add to.

```ts
const w = api.ui.widgets;
const owner = w.select(Array.from({ length: 8 }, (_, slot) => ({ value: slot, label: api.names.player(slot) })));
const count = w.number({ value: 4, min: 1, max: 12 });

api.ui.dialog({
  title: "Place marines",
  size: "sm",
  mount: (body) => body.append(
    w.form([{ label: "Player", field: owner }, { label: "How many", field: count }]),
    w.hint("They are placed in a row from the middle of the view."),
  ),
  buttons: [
    { label: "Cancel" },
    {
      label: "Place",
      primary: true,
      run: () => {
        const view = api.view.visible();
        const t = api.consts.tile;
        const y = ((view.y0 + view.y1) / 2) * t;
        const x = ((view.x0 + view.x1) / 2) * t;
        api.document.edit("Place marines", (tx) => {
          for (let i = 0; i < Number(count.value); i++) tx.placeUnit(0, Number(owner.value), x + i * t, y);
        });
      },
    },
  ],
});
```

![The Place marines dialog: a Player drop-down, a How many field, a hint, and Cancel and Place buttons](images/plugin-dialog.webp)

**Panels** block nothing: the user keeps editing while one is open. A floating panel can
be dragged and, with `resizable: true`, resized. `dock: "right"` puts it in the dock
under the built-in panels, which suits anything kept open while working.

```ts
// A unit count that follows the map, docked under the built-in panels.
api.ui.panel({
  title: "Unit count",
  dock: "right",
  mount(body) {
    const show = () => { body.textContent = `${api.document.scenario()?.units.length ?? 0} units`; };
    show();
    const sub = api.events.on("units", show);
    return () => sub.dispose();
  },
});
```

**Status items and map buttons** are for things that should stay visible without a panel,
like a background job or an unread count. Keep the handle and call `set(...)` as things
change. Use map buttons sparingly; the row is small.

```ts
// Check Map's problem count in the status bar; a click opens the full list.
const count = () => api.query.validate().filter((i) => i.level !== "info").length;
const cell = api.ui.statusItem({ text: `${count()} problems`, onClick: () => api.ui.open("validateMap") });
api.events.on("commit", () => {
  const n = count();
  cell.set({ text: `${n} problems`, warn: n > 0 });
});
```

**Preferences pages** are where settings belong, rather than behind a menu item of your
own. One page per plugin, listed under Plugins.

```ts
const settings = api.storage.get("settings", { dock: "float" });
let pending: (() => void) | null = null;

api.ui.preferencesPage({
  mount(body) {
    const w = api.ui.widgets;
    const dock = w.select([{ value: "float", label: "Floating" }, { value: "right", label: "Docked" }], { value: settings.dock });
    body.append(w.form([{ label: "Panel", field: dock }]), w.hint("Where the panel opens."));
    pending = () => api.storage.set("settings", { dock: dock.value });
  },
  // OK and Apply write it; Cancel leaves the stored value alone.
  apply: () => pending?.(),
});
api.ui.open("preferences", { page: `plugin:${api.plugin.id}` });
```

**Dialog slots** add a button or row to a built-in dialog's footer, or to another
plugin's dialog that offers one. Your `mount` receives the dialog's fields: the form as
the user sees it, not yet applied to the map. The slot can read a field and fill it in,
and the user still presses OK.

| Dialog id | Fields it lends |
| --- | --- |
| `mapProperties` | `name`, `description` |
| `triggerEditor`, `missionBriefing` | `selected`, `modified` |
| `stringEditor`, `playerSettings` | none |
| `trigedit.text` (TrigEdit's Text Trigger Editor) | `text` |

`selected` is the index of the selected trigger as text (`""` for none), and setting it
selects a different row. `modified` is `"1"` while the dialog holds changes that have not
been applied. Closing the dialog from a slot discards those changes, so ask first when it
is set.

```ts
// A button in the Trigger Editor that shows the selected trigger as text.
api.ui.dialogSlot("triggerEditor", {
  mount(body, dlg) {
    body.append(api.ui.widgets.button("As text", { onClick: () => {
      const trigger = api.triggers.list()[Number(dlg.fields.selected.get())];
      if (trigger) void api.ui.alert(api.triggers.text.one(trigger), { title: "Trigger text" });
    } }));
  },
});
```

**Map tools** receive every press, move and release on the map before the active layer
does, and can draw a preview. Esc or a right-click stops the tool, and only one runs at a
time. Paint is the example.

```ts
// Click to drop a marine, with a ring under the pointer. Esc or a right-click ends the tool.
let at: { px: number; py: number } | null = null;
const tool = api.ui.mapTool({
  name: "Drop marines",
  hint: "click to place, Esc to stop",
  onMove(p) { at = p.inMap ? p : null; tool.redraw(); },
  onDown(p) { api.document.edit("Drop a marine", (tx) => { tx.placeUnit(0, 0, p.px, p.py); }); },
  draw(ctx, view) {
    if (!at) return;
    ctx.strokeStyle = "#ffd24a";
    ctx.beginPath();
    ctx.arc(view.x(at.px), view.y(at.py), view.tilePx / 2, 0, Math.PI * 2);
    ctx.stroke();
  },
});
```

![The Drop marines tool running: two marines placed, a ring under the pointer, and the tool's name and hint in the status bar](images/plugin-map-tool.webp)

In `draw`, `view.x(px)` and `view.y(py)` turn map pixels into canvas pixels, and
`view.tilePx` is the size of a tile on screen at the current zoom.

**Overlays** draw over the map while the user works on any layer, and never take the
pointer. They appear under View and in the Layers panel with a visibility toggle.
Walkability is the example.

```ts
// A ring twelve tiles wide round every start location, listed under View ▸ Overlays.
const overlay = api.ui.overlay({
  name: "Start rings",
  above: "objects",
  draw(ctx, view) {
    ctx.strokeStyle = "#ffd24a";
    ctx.lineWidth = 2;
    for (const start of api.query.startLocations()) {
      ctx.beginPath();
      ctx.arc(view.x(start.x), view.y(start.y), 12 * view.tilePx, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
});
api.events.on("units", () => overlay.redraw());
```

![The Start rings overlay on a four-player map zoomed out: a ring round each start location, and a Start rings row under Overlays in the Layers panel](images/plugin-overlay.webp)

**Showing that work is in progress.** A dialog that does not change while it works looks
broken. `ui.widgets` has one set of tools for this, so plugins look alike:

| Widget | When to use it |
| --- | --- |
| `spinner` | Waiting for something of unknown length. |
| `progressBar` | Work whose length is known, such as a download. |
| `skeleton` | A grey placeholder in the shape of a list or picture that is coming. |
| `busy(target)` | Cover a box while its contents are replaced. |
| `button(label, { busy })` | Disable a button while the work it started runs. |
| `statusLine` | One line at the bottom of a dialog for progress, the result, errors and a Cancel. |
| `steps`, `fold` | Work in stages, and a block folded to one summary line. |

A search dialog that uses four of them. The `wait` stands in for a request to a server:

```ts
const w = api.ui.widgets;

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("stopped")); });
  });
}

api.ui.dialog({
  title: "Find units",
  mount(body) {
    const query = w.text({ placeholder: "marine" });
    const results = api.ui.el("div", { style: { minHeight: "120px" } });
    const status = w.statusLine({ text: "Type part of a unit's name." });
    const search = w.button("Search", { primary: true, onClick: () => void run() });
    body.append(w.row(query, search), results, status);

    async function run() {
      const stop = new AbortController();
      const cover = w.busy(results, "Searching…");
      status.busy("Searching…");
      status.cancel(() => stop.abort(), "Stop");
      search.setBusy(true);
      try {
        await wait(1500, stop.signal); // your fetch goes here, with { signal: stop.signal }
        const found = api.query.find({ kind: "units", query: query.value });
        results.replaceChildren(w.list(found.map((f) => ({ label: f.label, hint: f.detail, value: f.index }))));
        status.set(`${found.length} found.`, "ok");
      } catch (error) {
        status.set(stop.signal.aborted ? "Stopped." : String(error), stop.signal.aborted ? "warn" : "error");
      } finally {
        cover.done();
        search.setBusy(false);
        status.cancel(null);
      }
    }
  },
});
```

![The Find units dialog while it searches: the Search button and the results box show a spinner, and the status line reads Searching… with a Stop button](images/plugin-waiting.webp)

Work started from a dialog belongs on that dialog's status line. `ui.progress` is for work
that runs while the user carries on editing the map.

### `api.menu` / `api.contextMenu` / `api.hotkeys`

References: [menu](https://docs.scmjs.dev/api/menu/),
[context menu](https://docs.scmjs.dev/api/context-menu/),
[hotkeys](https://docs.scmjs.dev/api/hotkeys/)

- **`menu.add(path, item)`.** `path` is a menu (`"Tools"`) or a submenu (`"File/Import"`),
  always in English, and so is the item's `label`: labels are how items find each other,
  whatever language the menu shows. The editor translates built-in labels itself, and
  yours through the catalogues you register with `api.i18n`. Items go at the end
  of the menu unless `after` names an item to follow. A path that names no existing
  submenu creates one for your plugin (`"Tools/AI"`), and one that names no menu creates
  a top-level menu before Help (`"Account"`). `icon: "plugin"` marks an item with your
  plugin's icon.
- **`contextMenu.add(surface, item)`.** Surfaces are `"viewport"` (the map) and
  `"terrainPalette"`. The item's functions receive what was under the pointer. A fixed
  `label` is English and translated like a menu label; a function label is called when
  the menu opens, so translate it there with `api.i18n.t`.
- **`hotkeys.add("Ctrl+Shift+I", run)`.** Plugin hotkeys are checked before the built-in
  ones, and never while typing or while a dialog is open.

All three accept a `command` id instead of `run`; see `api.commands`.

```ts
api.menu.add("Tools", {
  label: "Count units…",
  icon: "plugin",
  enabled: () => api.document.isOpen(),
  run: () => api.ui.alert(`Player 1 has ${api.query.unitsOf(0).length} units.`),
});

// Right-click the map: copy the position of the tile under the pointer.
api.contextMenu.add("viewport", {
  label: (ctx) => (ctx.tile ? `Copy position (${ctx.tile.x}, ${ctx.tile.y})` : "Copy position"),
  enabled: (ctx) => ctx.tile !== null,
  run: (ctx) => { if (ctx.tile) void navigator.clipboard.writeText(`${ctx.tile.x}, ${ctx.tile.y}`); },
});

api.hotkeys.add("Ctrl+Alt+G", () => api.view.setFlags({ grid: !api.view.flags().grid }));
```

### `api.i18n`

[Reference](https://docs.scmjs.dev/api/i18n/)

Translating your plugin the way the editor translates itself: the English text is the
key, and a missing translation shows the English.

```ts
api.i18n.register({ ko: {
  "Count units…": "유닛 세기…",
  "{n, plural, one {# unit} other {# units}}": "유닛 {n, plural, other {#개}}",
} });
api.menu.add("Tools", {
  label: "Count units…", // English: the menu shows it through the catalogue above
  run: () => api.ui.alert(api.i18n.t("{n, plural, one {# unit} other {# units}}", { n: api.query.unitsOf(0).length })),
});
```

- `t(text, params)` translates; `tc(context, text, params)` does the same for identical
  English meant two ways.
- Placeholders are a subset of ICU MessageFormat: `{name}`, `plural` and `select`. For
  Korean, `{name|을}` picks the particle that agrees with the value (을/를, 이/가, 은/는,
  과/와, 으로/로).
- Menu labels, fixed context-menu labels, overlay names and a trigger claim's `label`,
  `badge` and `openLabel` are the exception: give them in English and
  the editor translates them with your catalogues when it draws them. Your manifest's
  `name` is shown the same way once the plugin is running, so a descriptive name
  ("Stamp Library") can have an entry; a product name needs none.
- `language` is the current language (`"en"`, `"ko"`). The `"language"` event fires when
  it changes, so you can relabel what is showing.

The editor's `scripts/i18n.mjs` can check a plugin's catalogues against its source too;
see [docs/development.md](development.md#translations).

### `api.events`

[Reference](https://docs.scmjs.dev/api/events/)

`on(event, fn)` returns a `Disposable`. Listeners run after the change, in plugin
activation order, and cannot block or change it. A listener that rewrites the map (Repair
does) causes a new `"document"` event that every listener sees.

| Event | When |
| --- | --- |
| `"document"` | The map in front changed. `reason` is `"open"`, `"new"`, `"close"`, `"replace"` (reparsed after a raw edit) or `"switch"` (another open map came to the front). Carries the map's `id`. |
| `"commit"` | One change was committed: `reason` (`"edit"`, `"undo"`, `"redo"`, `"tables"`, `"whole"`, `"remote"`), its `label`, the tile `area` it touched, and which `parts` changed. For following changes one by one, as Timelapse does. |
| `"terrain"` | Any committed map edit, undo or redo. |
| `"units"`, `"doodads"`, `"sprites"`, `"locations"` | That list changed. |
| `"settings"`, `"triggers"` | A settings dialog's OK; the trigger or briefing list. |
| `"layer"`, `"selection"`, `"clipboard"` | The active layer, the selection, the marked area or clip. |
| `"view"`, `"tool"` | The view moved or its options changed; a map tool or pick started or stopped. |
| `"palette"`, `"options"` | A palette's pick; an editing option or preference. |
| `"modified"`, `"file"` | The unsaved-changes flag; the file's name, save options, archive files or recent list. |
| `"commands"`, `"services"` | A plugin added or removed a command or service. |
| `"dialogs"` | A dialog opened or closed. |
| `"gameData"`, `"language"` | The game data or the editor's language changed. |

Only `"document"` and `"commit"` carry a payload. The others say that something changed,
and you read the new state from the API.

```ts
api.events.on("document", (e) => {
  if (e.reason === "open") api.ui.status(`Opened ${e.fileName ?? "a map"}`);
});

// Flash where each change landed, and log what kind of change it was.
api.events.on("commit", (e) => {
  if (e.area) api.view.flash({ rect: e.area, kind: "attention" });
  const parts = Object.entries(e.parts).filter(([, changed]) => changed).map(([part]) => part);
  api.log(e.reason, e.label, parts);
});
```

A plugin that acts on maps as they open listens for `"open"`. One that keeps data per map
keys it on `id` and drops entries `document.list()` no longer has:

```ts
const notes = new Map<number, string[]>(); // per open map, by its id

api.events.on("document", (e) => {
  const open = new Set(api.document.list().map((map) => map.id));
  for (const id of notes.keys()) if (!open.has(id)) notes.delete(id);
  if (e.id !== null && !notes.has(e.id)) notes.set(e.id, []);
});
```

### `api.storage`

[Reference](https://docs.scmjs.dev/api/storage/)

`get(key, fallback)`, `set(key, value)` and `remove(key)` keep JSON in the browser under
your plugin's id. `set` returns `false` when the browser refuses (the quota is a few
megabytes for the whole editor), so a plugin storing the user's work can say so. Users
can see and clear your keys in Preferences ▸ Storage, so never keep the only copy of
something there.

```ts
const runs = api.storage.get("runs", 0) + 1;
const kept = api.storage.set("runs", runs);
api.log(kept ? `run number ${runs}` : "the browser's storage is full");
```

For data that belongs to one map, use `document.extras` instead, so it travels with the
file.

### `api.scope()`

[Reference](https://docs.scmjs.dev/api/)

A child of your `api` that can be removed as a whole. Everything registered through
`scope.api` (menu items, hotkeys, listeners, panels, dialogs, overlays, map tools,
commands, services) is removed when you call `scope.dispose()`, and the plugin's own
registrations stay. After the dispose, writes to the map through `scope.api` are refused,
as they are for a plugin that has been turned off, so a timer or a request that finishes
late cannot change the map. Scopes can contain scopes, and turning the plugin off removes
every scope it made.

```ts
// A mode the user turns on and off: its menu item and listener come and go together.
let mode: ReturnType<typeof api.scope> | null = null;

api.menu.add("Tools", {
  label: "Toggle Watch Mode",
  run: () => {
    if (mode) {
      mode.dispose();
      mode = null;
      return;
    }
    mode = api.scope();
    mode.api.menu.add("Tools", { label: "Watch Mode is on", enabled: () => false });
    mode.api.events.on("commit", (e) => api.log("changed:", e.label));
  },
});
```

It is for a plugin that runs other code for a while and then takes it back: the API
Playground runs each snippet in a scope. A scope uses the plugin's own id, storage and
name in the log. Timers and sockets are not registrations, so clear them yourself.

### `api.plugin`, `api.apiVersion`, `api.log(...)`

[Reference](https://docs.scmjs.dev/api/)

Your plugin's `id`, `name` and `source`, the API version, and a logger. `log` writes to
the browser console and to the editor's View ▸ Debug Console, which users copy into bug
reports, so write lines someone else could follow. The console also records when your
plugin starts, the edits it makes, and listeners that throw; with **Verbose** on, it
records every API call.

```ts
api.log(`${api.plugin.name} (${api.plugin.id}) from ${api.plugin.source}, API ${api.apiVersion}`);
```

## Plugins to read

Each plugin is its own repository with a README, built against the same API. Read the one
closest to what you are writing.

| Plugin | Read it for |
| --- | --- |
| [Hello World](https://github.com/scm-js/plugin-hello-world) | The smallest complete plugin, with the toolchain set up. Copy it to start. |
| [Paint](https://github.com/scm-js/plugin-paint) | A map tool with a preview, one `document.edit` per stroke, a panel, and following the active palette. |
| [Walkability](https://github.com/scm-js/plugin-walkability) | A read-only overlay recomputed on edit events, with a panel for the readout. |
| [Terrain from Image](https://github.com/scm-js/plugin-image-to-terrain) | A dialog built from widgets, paste and drop, picking an area from a dialog, a whole picture in one edit. |
| [Melee Wizard](https://github.com/scm-js/plugin-melee-wizard) | Placing units with the editor's placement checks, and honouring symmetry. |
| [Repair](https://github.com/scm-js/plugin-repair) | Acting on the `"document"` event, `document.sections` and its repair helpers, `api.text`. |
| [Section Explorer](https://github.com/scm-js/plugin-section-explorer) | Reading and writing raw sections, and `api.names`. |
| [scmscx.com](https://github.com/scm-js/plugin-scm-scx) | Opening a map fetched from another site, and every waiting widget with cancellation. |
| [TrigScript](https://github.com/scm-js/plugin-trigscript) | Build steps, claimed triggers, a resizable panel workspace, files kept in the map, published commands. |
| [TrigEdit](https://github.com/scm-js/plugin-trigedit) | Printing and parsing the text format, `claims`, and a dialog offering a slot to other plugins. |
| [Magenta](https://github.com/scm-js/plugin-magenta) | `requires` and a service from another plugin, `document.update` for single records, EUD constants. |
| [eudplib](https://github.com/scm-js/plugin-eudplib) | A library plugin: one versioned service, a Web Worker, a large runtime downloaded once. |
| [Stamp Library](https://github.com/scm-js/plugin-stamp-library) | `api.storage` for user data, `clipboard.capture`, `tx.paste`, rendered thumbnails. |
| [Trigger Map](https://github.com/scm-js/plugin-trigger-map) | `triggers.references`, a large resizable panel drawn in SVG, a button in the Trigger Editor's slot, `view.goTo` a trigger. |
| [Timelapse](https://github.com/scm-js/plugin-timelapse) | The `"commit"` event, `graphics.renderClip`, IndexedDB for large data, a preferences page. |
| [Aftermath](https://github.com/scm-js/plugin-aftermath) | Reading a file format of its own and drawing it over the map with an overlay. |
| [API Playground](https://github.com/scm-js/plugin-api-playground) | `api.scope()` to remove what other code registered, the plugin API's own typings in a code editor. |
| [scmjs.dev](https://github.com/scm-js/plugin-scmjs-dev) | Services, its own menu, status items, docked panels, dialog slots, `api.sync` for shared maps. |
