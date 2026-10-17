# Plugins

A plugin is a small program the editor loads from a public Git repository or a web
address. It can add menu items, hotkeys, dialogs, panels, map tools and overlays, and it
can read and change the open map through the same undo model the built-in tools use.

This page has eight parts:

- **[Using plugins](#using-plugins)**: installing a plugin, what it is allowed to do, and
  updating or removing it. For map makers.
- **[Your first plugin](#your-first-plugin)**: a small plugin built step by step, from a
  few lines in the playground to a published repository.
- **[Writing a plugin](#writing-a-plugin)**: the files, loading from your machine,
  bundling, translating, testing, debugging and publishing.
- **[Core concepts](#core-concepts)**: the rules that hold across the whole API.
- **[Recipes](#recipes)**: complete snippets for common jobs, such as a problems panel, a
  brush of your own, or triggers generated from a table.
- **[Putting things on screen](#putting-things-on-screen)**: every place a plugin can show
  something, and the options each one takes.
- **[The API, group by group](#the-api-group-by-group)**: what each group is for and the
  rules a signature does not show.
- **[Plugins to read](#plugins-to-read)**: the project's own plugins, by what each one is
  a good example of.

Every call has its own entry in the [API reference](https://docs.scmjs.dev/api/),
generated from the editor's declarations. This page teaches and gives the rules; it links
into the reference for signatures and options. How the editor loads plugins internally is
in [docs/development.md](development.md#the-plugin-host).

## Using plugins

This part is for map makers: how to install and update plugins, and what you are trusting
when you do.

### What is available

These plugins come with the editor and start on: Walkability, Paint, Repair, Terrain from
Image, TrigScript, Stamp Library, scmscx.com, scmjs.dev, scm-sim, eudplib and Aftermath.
TrigEdit, the Text Trigger Editor, comes with the editor too but starts off; tick it on in
Plugins ▸ Manage Plugins… when you need it.

The rest are in Plugins ▸ **Browse Plugins…**: Melee Wizard, Section Explorer, Magenta,
Trigger Map, Timelapse, Hello World and the API Playground among them. The [user
guide](guide.md#plugins) says what each one does and where it appears, and each repository
has its own README.

The plugins that come with the editor are *defaults*: they are built in, so a fresh
install has them without going to the network. A default can be turned off but not
removed.

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

A plugin that needs another one (see [Requiring another
plugin](#requiring-another-plugin)) lists it under *Also installs*.

### Keeping a plugin up to date

A pinned plugin never changes by itself; a push to its repository reaches nobody who has
it installed. To move forward, use the buttons in Plugins ▸ Manage Plugins…:

- **Check for update** on a row asks the repository for its newest release. The answer is
  on the row: *Up to date*, *Could not check*, or an *Update to …* button that shows the
  new manifest and asks before changing anything.
- **Check all for updates** answers every row at once, in a line under the button. It
  reads the plugin lists first and asks a repository only for a plugin no list carries.
- **Update all** appears when two or more rows offer an update. It installs them one after
  another without the confirmation screen, and each plugin keeps its settings. A version
  that needs a newer editor is left, and the line under the button says so.

Only releases (version tags) count; commits pushed after the newest release are not
offered. Browse Plugins also marks *v… available* on a row when its list carries a newer
version than the one you run.

Preferences ▸ Plugins ▸ **Plugin updates** decides whether the editor looks for you. It
reads the plugin list at most once every six hours.

| Choice | What happens |
| --- | --- |
| Tell me (default) | A notice names what is newer, with a button to Manage Plugins. |
| Do nothing | Nothing is checked until you press a row's button. |
| Install them | Newer versions of the plugins you added yourself are installed. Defaults, plugins loading from a saved copy, plugins that are off, and versions that need a newer editor are only named in the notice. |

**Defaults** move with the editor: each release carries the versions it was tested with,
and a default is never checked until you press its button. Updating one makes it an
ordinary plugin fetched from its repository at each start; **Revert** on the row goes back
to the version the editor ships.

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

Browse Plugins reads *registries*: JSON files listing plugins and the address each
installs from. The project's own is
[`scm-js/registry`](https://github.com/scm-js/registry), and the **Sources** button adds
others. A registry only decides what is *offered*; installing from it goes through the
same Add screen and pinning as a pasted address.

Plugins you have that no registry lists (one you added by address, or one a list dropped)
are shown under *Already installed*, marked *not listed*.

## Your first plugin

This part builds one small plugin from nothing to a published repository. The plugin is
**Base Check**: it counts the mineral fields and geysers near each start location, lists
them in a panel, and can set every short mineral field back to the full amount. It is
about seventy-five lines, and it uses the parts of the API most plugins use: reading the
map, a panel, an edit with undo, events, storage, a menu item and a hotkey.

You need nothing installed. The first three steps run in the editor's API Playground; the
files come in step 4.

### Before you start

1. Open the editor and a melee map, or make a map with File ▸ New and a few start
   locations and mineral fields, so the plugin has something to count.
2. Install the [API Playground](https://github.com/scm-js/plugin-api-playground) from
   Plugins ▸ Browse Plugins…, and open Tools ▸ API Playground.

The playground is a code editor in which `api` is already defined. Ctrl+Enter runs what
you wrote against the open map. On the documentation site, steps 1 and 3 have a **Try it**
link that opens the editor with the code already in the playground. [Trying the API
first](#trying-the-api-first) describes the playground in full.

![The API Playground beside the map: the "Place units in a ring" example has run, and the marines it placed are on the map](images/api-playground.webp)

### Step 1: read the map

Reading needs no setup. `api.document.scenario()` is the open map, `api.query` answers
questions about it, and `api.consts` has the numbers the map file uses, so the code does
not hard-code that a vespene geyser is unit 188.

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
editor's own. The list is rebuilt whenever the units change, and clicking a row takes the
view to that start location.

Replace the `for` loop at the end of step 1 with this, keeping `census`, and run again:

```ts
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
entry. Here the edit sets every mineral field holding less than the standard 1500 back to
1500, and flashes the ones it changed.

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

Press Ctrl+Z in the editor and the amounts go back. You did not mark anything as modified,
repaint the map or write the undo record: the transaction does all three.

The function you pass must not be `async`; [Asynchronous
calls](#asynchronous-calls-and-the-one-synchronous-builder) explains why.

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

`plugin.ts` is the three steps put together, with the radius kept as a setting in
`api.storage`, a menu item and a hotkey:

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

- **`activate(api)` wraps everything.** The editor calls it once when the plugin is turned
  on. The `import type` line is only for your code editor and the type-check; it is
  removed before the file runs.
- **Nothing is cleaned up by hand.** The menu item, hotkey, command and panel go when the
  user turns the plugin off (see [What you add is removed for
  you](#what-you-add-is-removed-for-you)). Only the two listeners inside `mount` are
  disposed explicitly, because they should stop when the panel closes.
- **The command is registered once and used twice.** The menu item and the hotkey both
  name it, and another plugin can run it with `api.commands.run("base-check.open")`.

The playground runs a whole `plugin.ts` too: paste it in and `activate` is called, so you
can keep working there until the plugin is ready for its own folder.

### Step 5: load it from your machine

Serve the folder, with cross-origin requests allowed so the editor can fetch from it:

```sh
npx serve --cors .
```

In the editor open Plugins ▸ **Manage Plugins…**, paste `http://localhost:3000/` and
confirm. Tools ▸ Base Check… is now in the menu. After each change to the files, press
**Reload** on the plugin's row. [Loading it from your
machine](#loading-it-from-your-machine) adds the typings for completion in your own code
editor.

If the plugin fails to load, its row in Manage Plugins shows the error. [When something
goes wrong](#when-something-goes-wrong) lists the usual mistakes.

### Step 6: publish it

1. Put the folder in a public GitHub repository.
2. Tag a release (`git tag v1.0.0 && git push --tags`). Tags are what the update check
   offers to people who already have the plugin.
3. Anyone can now install it by pasting `github:you/your-repository` into Manage Plugins.

To have it appear in Browse Plugins as well, see [Getting listed](#getting-listed).

### Where to go next

- [Writing a plugin](#writing-a-plugin) covers each piece in more detail: the manifest,
  the icon, bundling npm dependencies, translating, testing and CI.
- [Core concepts](#core-concepts) has the rules that hold across the whole API.
- [Recipes](#recipes) has complete snippets for common jobs.
- [Plugins to read](#plugins-to-read) lists the project's own plugins by what each one is
  a good example of. [Hello World](https://github.com/scm-js/plugin-hello-world) is the
  smallest, with the build, tests and CI already set up.

## Writing a plugin

A plugin is one TypeScript or JavaScript file exporting an `activate(api)` function, next
to a `plugin.json`, in a public repository. There is no build step to start with: the
editor fetches the source, transpiles it in the browser and calls `activate`.

[Your first plugin](#your-first-plugin) walks through writing one. This part covers each
piece in turn.

### Trying the API first

The [API Playground](https://github.com/scm-js/plugin-api-playground) plugin lets you call
the API before setting anything up. Install it from Plugins ▸ Browse Plugins… and open
Tools ▸ API Playground. Its panel has a code editor where `api` is already defined. Write
a few lines, press Ctrl+Enter, and they run against the open map.

- **Stop** removes everything the run added: menu items, listeners, panels, overlays, map
  tools and timers. Running again stops the previous run first.
- **Undo Run** undoes the run's edits to the map.
- The list at the top has worked examples, one idea each.
- **Export as Plugin…** saves the snippet as a zip holding `plugin.json`, a `plugin.ts`
  with the snippet as the body of `activate`, and the typings and build setup described
  below.
- A whole `plugin.ts` pasted in runs too: its `activate` is called, and what it returns is
  called on **Stop**.

Type `api.` for completion. Hovering over a name shows its documentation, the same text as
the [API reference](https://docs.scmjs.dev/api/).

![Hovering over api.document.edit in the playground shows its documentation](images/api-playground-hover.webp)

On the documentation site, an example that runs as it is written has a **Try it** link. It
opens the editor with the example in the playground, and offers to install the playground
if you do not have it. Nothing runs until you press Run. **Copy Link**, at the foot of the
panel, makes the same kind of link for your own snippet.

Examples without a link are fragments: they need something only your plugin has, such as a
server to talk to or a variable defined elsewhere.

> **Note.** A snippet runs as the playground, so a command or service id without a dot is
> prefixed with the playground's id and can replace the playground's own. Use a dotted id of
> your own (`"my-plugin.open"`) while you try things.

### Starting a plugin

Start from [Hello World](https://github.com/scm-js/plugin-hello-world), or from a snippet
exported from the playground. Hello World's `plugin.ts` is about ninety lines, mostly
comments. The repository also has a Korean catalogue (`ko.ts`) with the test that keeps it
complete, and the typings, type-check, build and CI described below.

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
| `id` | Used for storage keys, command and service names, and log lines. Derived from `name` when absent. |
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

`activate` may be `async`. It may also return a function, which runs when the plugin is
turned off; [What you add is removed for you](#what-you-add-is-removed-for-you) says when
you need one.

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

### Loading it from your machine

Serve the plugin's folder with cross-origin requests allowed:

```sh
npx serve --cors .
```

Paste `http://localhost:3000/` into Plugins ▸ Manage Plugins…, and press **Reload** on its
row after each change.

For completion and type-checking in your own code editor, install the typings:

```sh
npm i -D @scm-js/plugin-api
```

The package is types only: one `index.d.ts`. The `import type` line is removed before the
file runs, so the package matters only for editing and type-checking. A value imported
from it type-checks and is then `undefined` when the plugin runs; everything you need at
run time comes from `api`. The same files are tagged at
[`scm-js/plugin-api`](https://github.com/scm-js/plugin-api) if you prefer a git
dependency.

The package's major version is the API version, so `^1` in `package.json` is right. New
calls arrive in minor versions, since they break nothing that does not use them.

### Imports and dependencies

- **Relative imports work**, with or without an extension (`./convert`, `./convert.js`
  meaning `convert.ts`, or a folder's `index.ts`).
- **Package imports need a bundle.** `import x from "some-package"` is refused when the
  editor loads source, because it has no module resolver. `import type` from
  `@scm-js/plugin-api` is fine, since it is removed first. For a real dependency,
  including a UI framework, ship a bundle (see [Building](#building)).

### Building

A plugin can ship a bundle and name it in the manifest:

```json
"build": "dist/plugin.js"
```

The editor then imports that one file instead of compiling your source file by file. It is
faster for anything bigger than one file, and the only way to use an npm dependency. Keep
`entry` in the manifest too: it is what people read, and what loads when no bundle is
published.

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

### Translating

The editor is in English and Korean, and a plugin is translated the same way: the English
text is the key, and a missing translation shows the English. The project's plugins all
use this pattern:

1. Keep the Korean in a file of its own, `ko.ts`, mapping English to Korean.
2. Register it in `activate`, before anything is shown.
3. Pass every string you show through `api.i18n.t("English text", params)`, always as a
   literal.
4. Strings you hand the editor to show for you are given in English and translated by the
   editor when it draws them. Wrap them in a `msg()` that does nothing at run time, so the
   test below can find them.

```ts
import type { PluginApi } from "@scm-js/plugin-api";
import { KO } from "./ko";

const msg = (text: string) => text; // marks a string the editor translates for us

export default function activate(api: PluginApi) {
  api.i18n.register({ ko: KO });
  api.menu.add("Tools", {
    label: msg("Count units…"),
    run: () => api.ui.alert(api.i18n.t("{n, plural, one {# unit} other {# units}}", { n: api.query.unitsOf(0).length })),
  });
}
```

```ts
// ko.ts
export const KO: Record<string, string> = {
  "Count units…": "유닛 세기…",
  "{n, plural, one {# unit} other {# units}}": "유닛 {n, plural, other {#개}}",
};
```

The strings the editor translates for you are menu labels, fixed context-menu labels,
overlay names, a trigger claim's `label`, `badge` and `openLabel`, and your manifest's
`name`. A product name needs no entry. Map text, such as a scenario's name, is never
translated.

[`api.i18n`](#apii18n) has the placeholder syntax. [Testing](#testing) has the test that
keeps `ko.ts` complete.

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

/** Mineral fields (176–178) and geysers (188) within `radius` pixels of each start. */
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

**The catalogue test.** Because every shown string is a literal inside `t("…")` or
`msg("…")`, a test can read them out of the source and check `ko.ts` against them. This is
the one Hello World ships, shortened:

```ts
// tests/ko.test.ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { KO } from "../ko";

const files = ["plugin.ts"]; // every source file that shows text
const source = files.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).join("\n");
const keys = new Set([...source.matchAll(/\b(?:t|msg)\("((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string));

it("has every string the plugin shows", () => {
  expect([...keys].filter((k) => !(k in KO))).toEqual([]);
});

it("has nothing the plugin no longer shows", () => {
  expect(Object.keys(KO).filter((k) => !keys.has(k))).toEqual([]);
});
```

The whole plugin is tested by running it: load it from your machine, or paste it into the
playground. The shared CI workflow in [Building](#building) runs the type-check and the
tests on every push.

### When something goes wrong

- **The plugin does not load.** The editor raises a notice, and the plugin's row in
  Plugins ▸ Manage Plugins… shows the error: a manifest it could not read, a file it could
  not fetch, an import it refused, or what `activate` threw.
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
| A write throws "… is open to view only". | The map in front was opened to look at only. Check `document.info()?.viewOnly`. |
| Writes do nothing after the plugin was turned off. | A timer or request outlived the plugin. The Debug Console logs each refused write; clear timers in the function `activate` returns. |
| Another plugin's command or service is missing. | Plugins start in no fixed order. Check `has(id)`, or listen for the `"commands"` event or `services.watch`. |
| In the playground, a command or service of yours replaces the playground's. | A snippet runs as the playground. Use a dotted id of your own (`"my-plugin.open"`). |

### Requiring another plugin

A plugin can depend on another, such as a trigger editor that needs a compiler. Name it in
the manifest with the same address you would paste into Manage Plugins:

```json
{ "name": "Magenta", "requires": ["github:scm-js/plugin-eudplib"] }
```

The editor then treats the two as a pair:

- Adding yours adds the required one first, with the same options.
- Turning yours on turns it on, and at startup it starts before yours.
- While yours is on, it cannot be turned off or removed; its row says which plugin needs
  it.

The manifest does not say which version is enough. The two meet through
[`api.services`](#apiservices): the required plugin provides a service with a version, and
yours checks it and explains in its own UI when it is too old. If the required plugin is
missing, yours still starts and sees no service.

### Talking to a server

You call `fetch` yourself. Two things only show up in the desktop app:

- **The desktop app's origin is `app://scmjs`.** The web editor's origin is
  `https://scmjs.dev`, for the stable editor and the nightly alike. Your server's CORS
  settings need to allow both, or desktop requests fail as if the server were down.
- **Open a sign-in popup blank, then point it.** A link opens in the user's real browser,
  which cannot post a session back. Open an empty named window
  (`window.open("", "my-plugin-signin", "width=540,height=720")`) and set its
  `location.href` once your server says where to go.

### Publishing

Put the folder in a public repository and tag each release (`v1.0.0`). What your users see
follows from how they install:

- **Your manifest is all they see before deciding.** Fill in name, version, author,
  description, icon, repository and homepage.
- **They are pinned to a commit.** A push reaches nobody already running the plugin. They
  move forward with the update check, which shows them your new manifest first. Tags are
  what the registry lists and what the update check offers.
- **They may run a copy saved in their browser**, replaced only when they press Reload.

### Getting listed

[`scm-js/registry`](https://github.com/scm-js/registry) is generated from the `scm-js`
organisation: every repository named `plugin-…`, or with both the `scmjs` and `plugin`
topics, is listed with the `plugin.json` at its newest version tag. It refreshes hourly.

For a plugin anywhere else, fill in the [submission
form](https://github.com/scm-js/registry/issues/new?template=submit-plugin.yml) with your
repository's address and the search words you want. The listing reads the rest from your
`plugin.json`. A bot checks the repository right away and replies with what it found, and
then someone reads the code and decides whether to list it.

Any URL serving a file in the same format is a registry, and users can add one under
Sources.

## Core concepts

The rules on this page hold across the whole API. The rest of the guide refers back to
them instead of repeating them.

### Units, players and ids

- **Tiles and pixels.** Terrain, fog and rectangles count tiles. Units, sprites and
  locations are placed in map pixels, 32 to a tile (`api.consts.tile`). A rectangle is
  `{ x0, y0, x1, y1 }` in tiles, with `x1` and `y1` exclusive.
- **Players count from 0.** `owner` 0 is Player 1, as in the map file.
  `api.names.player(slot)` gives the name the editor shows.
- **Ids are the game's.** A unit id is its row in `units.dat` (0 is the Terran Marine),
  and upgrades and technologies likewise. `api.names` turns any of them into a name, and
  `api.consts` has the ones the map file treats specially, so a plugin does not hard-code
  them.

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
`mount`, and the pointer and `draw` hooks of map tools and overlays.

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

For long work, [`api.ui.progress`](https://docs.scmjs.dev/api/ui/#progress) shows a panel
over the map that does not block editing. Check `cancelled()` in your loop. Its `signal`
is an `AbortSignal`, so a `fetch(url, { signal: job.signal })` stops when the user
cancels.

### The three kinds of write

Every change a plugin makes to the map goes through one of three calls, matching the
editor's own three ways of writing: a brush stroke, a dialog's OK, and a raw file edit.

| Call | Covers | Undo | If your function throws |
| --- | --- | --- | --- |
| `document.edit(label, build)` | Terrain and objects: tiles, ISOM, units, sprites, doodads, locations, fog. | One history entry. | Rolled back. |
| `document.update(label, build)` | Tables and settings: triggers, briefing, strings, switch names, name and description, players, forces, unit / upgrade / tech settings, sounds, map revision. | One history entry, as with a settings dialog's OK. | What was written stays, as one entry. |
| `document.sections.*` | The file's raw bytes, any section. | None, and the history is cleared. | Nothing is written. |

In both transactions each operation applies immediately, so a later one sees what an
earlier one did. Calling the transaction after the function has returned throws. The
transaction marks the map modified, saves the right file sections and repaints; you do
none of that yourself.

**The map you read is read-only.** `document.scenario()` is the editor's own live object,
typed read-only all the way down: a line that writes to it does not compile, because a
direct write would skip undo, never be saved and never repaint. Copy what you want to
change (`{ ...scn.units[0], x: 64 }` is an ordinary record) and hand it to a transaction.
A helper of your own that only reads takes `ReadonlyScenario`, or `readonly UnitRecord[]`
for one of its lists.

### What you add is removed for you

Menu items, hotkeys, commands, services, dialogs, panels, overlays, map tools and
listeners are all tracked. Turning the plugin off, reloading it or removing it takes them
away whether or not you cleaned up.

- **Disposables.** Everything `add`, `on`, `register` and `provide` return is a
  `Disposable`. Keep the ones you want to remove early and ignore the rest.
- **Cleanup functions.** A dialog's or panel's `mount` may return a function, which runs
  when it closes. Use it for listeners that should stop with the panel rather than with
  the plugin.
- **What the API cannot see.** Timers, sockets and workers are yours to stop. Return a
  function from `activate` and the editor calls it when the plugin is turned off:

  ```ts
  import type { PluginApi } from "@scm-js/plugin-api";

  export default function activate(api: PluginApi) {
    const timer = setInterval(() => api.log("still running"), 60_000);
    return () => clearInterval(timer);
  }
  ```

- **Late writes are refused.** Once a plugin is turned off, anything it left behind can no
  longer change the map: writes do nothing and log a line in the Debug Console.
- **A part you remove as a whole.** [`api.scope()`](#apiscope) gives a child `api` whose
  registrations go together, for a mode the user turns on and off.

### When no map is open

The editor can have no map open, and a plugin starts before the first map does.

- **Reads answer `null`, `[]` or `false`** instead of throwing. The exception is the
  raw-bytes path, `document.sections`, whose `file()` and `bytes()` throw.
- **Writes change nothing.** `edit` and `update` return a result with `changed: false`.
- **Menu items should say so.** Give an item `enabled: () => api.document.isOpen()` and it
  is greyed out until a map is open.

The game's files may be missing too: the editor works without them, so anything that needs
the tileset, the unit graphics or the game's tables degrades. A terrain operation writes
nothing and says so in its result, `api.data` answers null, and `api.graphics` returns no
picture. Check what you get back, and show a name where a picture is missing.

### Several maps, and maps to look at only

Several maps can be open at once, as tabs. Every call works on the map in front.

- `document.id()` is the map in front, `document.list()` every open map, and
  `document.activate(id)` brings one to the front. Only switch maps when the user asked
  for it.
- `document.open` and `document.create` take `into: "new"` (beside the open map) or
  `into: "current"` (in its place, through the unsaved-changes question). Left out, the
  user's preference decides.
- Key anything you keep per map on `id()`, and drop entries `list()` no longer has:

```ts
const notes = new Map<number, string[]>(); // per open map, by its id

api.events.on("document", (e) => {
  const open = new Set(api.document.list().map((map) => map.id));
  for (const id of notes.keys()) if (!open.has(id)) notes.delete(id);
  if (e.id !== null && !notes.has(e.id)) notes.set(e.id, []);
});
```

**View-only maps.** `document.open(bytes, name, { viewOnly: { label: "Replay" } })` opens
a map to look at, not to change, such as a replay's map or a preview from a website. It
always opens beside the others, and its tab and the status bar show the label. On such a
map:

- Panning, zooming, the layers and selecting work. The editing tools, menus and dialogs
  are off.
- Every write throws with the reason: `edit`, `update`, `sections` writes, `resize`,
  `changeTileset`, `extras`, the clipboard's `cut` and `paste`, `save` and `saveAs` other
  than as a copy, and `sync.start`.
- It is not kept in Open Recent, and closing it asks nothing.
- `document.info()?.viewOnly` and `document.list()` say which maps are like this. File ▸
  Edit a Copy gives the user an ordinary copy to change.

### Events

`api.events.on(event, fn)` returns a `Disposable`. Listeners run after the change, in
plugin activation order, and cannot block or change it. A listener that rewrites the map
(Repair does) causes a new `"document"` event that every listener sees.

| Event | When |
| --- | --- |
| `"document"` | The map in front changed. `reason` is `"open"`, `"new"`, `"close"`, `"replace"` (reparsed after a raw edit) or `"switch"` (another open map came to the front). Carries the map's `id`. |
| `"commit"` | One change was committed: its `reason`, `label`, the tile `area` it touched, and which `parts` changed. For following changes one by one, as Timelapse does. |
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
and you read the new state from the API. A plugin that acts on maps as they open listens
for `"document"` with reason `"open"`:

```ts
api.events.on("document", (e) => {
  if (e.reason === "open") api.ui.status(`Opened ${e.fileName ?? "a map"}`);
});
```

The reference has [an example of
`"commit"`](https://docs.scmjs.dev/api/events/#commitevent).

## Recipes

Complete snippets for common jobs, each using several parts of the API together. Every one
runs in the playground as written; in a plugin, the same lines go inside `activate(api)`.
[The API, group by group](#the-api-group-by-group) explains each call they use.

### A problems panel that follows the map

Check Map's findings in a docked panel, refreshed after every change. Clicking a row goes
to the unit, location or trigger, or opens the settings dialog the problem is in.

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
block tinted by how many it holds. The count is redone when the units change, not on every
repaint, because `draw` runs each time the view moves.

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

A map tool that paints the Terrain palette's current terrain while the button is held, and
commits the whole drag as one undo entry when it is released. Collecting during the drag
and writing once on release is what makes one stroke one Ctrl+Z.

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

A text box whose contents are stored as a file in the map archive, so they travel with the
map and are written on the next Save. The write is delayed until typing pauses.

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

And place units from one, as a single undo entry. A row with anything that is not a number
where a number belongs is skipped:

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

The whole replace is one `document.update`, so it is one undo step under the label given.

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
    api.ui.status(`Replaced in ${hits.length} strings. Ctrl+Z takes it back.`);
  }
}
```

## Putting things on screen

Everything a plugin shows goes through [`api.ui`](https://docs.scmjs.dev/api/ui/), plus
the menu, context-menu and hotkey groups. There is no UI framework: a dialog or panel
hands you an empty element, and you fill it with plain DOM, using `api.ui.widgets` for
controls in the editor's own style.

| Surface | Call | Use it for |
| --- | --- | --- |
| [Status line, notices, questions](#messages-and-questions) | `status`, `toast`, `confirm`, `alert`, `prompt` | A line of feedback, or a simple question. |
| [Dialog](#dialogs) | `dialog(spec)` | A form or workspace that covers the map until closed. |
| [Panel](#panels) | `panel(spec)` | Something kept open while the user works: floating, docked right, or in a strip under the map. |
| [Status item, map button](#status-items-and-map-buttons) | `statusItem(spec)`, `mapButton(spec)` | Something that stays visible without a panel. |
| [Preferences page](#preferences-pages) | `preferencesPage(spec)` | Your plugin's settings. |
| [Dialog slot](#dialog-slots) | `dialogSlot(id, spec)` | A button or row in a built-in dialog's footer. |
| [Map tool](#map-tools) | `mapTool(spec)` | Taking over the pointer on the map. |
| [Overlay](#overlays) | `overlay(spec)` | A drawing over the map the user switches on and off. |
| [Picks](#picking-on-the-map) | `pickArea`, `pickTile`, `pickObject`, `pickFiles` | Asking the user to choose something. |
| [File type](#file-types) | `fileType(spec)` | Opening a kind of file the editor does not. |
| [Map view](#map-views) | `mapView(spec)` | Another way to look at a map, in the map's place. |
| [Menus and keys](#menus-context-menus-and-hotkeys) | `menu.add`, `contextMenu.add`, `hotkeys.add` | Reaching your plugin's commands. |

![The editor with plugin UI in five places, numbered](images/plugin-surfaces.webp)

Where the main pieces appear: a menu item (1), a floating panel (2), a docked panel (3), a
status bar cell (4) and a map button (5). The icon beside each is the plugin's own.

### Messages and questions

- **`status(text)`** sets the status bar line, and `statusText()` reads it back.
- **`toast({ kind, title, detail })`** shows a notice over the map that goes away by
  itself. It is how Save reports.
- **`confirm`, `alert` and `prompt`** ask simple questions in the editor's style.
  `confirm` resolves `false` and `prompt` resolves `null` when the user cancels.
- **`open(id, payload)`** opens one of the editor's own dialogs, such as `"preferences"`
  or `"validateMap"`. **`ask(id)`** does the same for a dialog that answers (`"newMap"`,
  `"saveAs"`, `"confirmClose"`) and resolves `true` when the user went through with it.
  `openDialogs()` lists what is open now.

```ts
// File ▸ New's own dialog, then a word about what came of it.
if (await api.ui.ask("newMap")) api.ui.toast({ kind: "ok", title: "New map", detail: api.document.info()?.name });
else api.ui.status("No new map made.");
```

### Building content

`api.ui.widgets` builds controls that look like the editor's own, as plain DOM elements:

| Widget | What it is |
| --- | --- |
| `button`, `checkbox` | A button (with `primary` and `busy`), a labelled checkbox. |
| `text`, `number`, `select` | Input fields and a drop-down. |
| `segmented` | A few buttons of which one is on, for a short choice that should stay in view. |
| `tabs` | A row of tabs over a panel each. A tab is filled the first time it is shown and kept after. |
| `form` | A two-column grid of labelled fields. |
| `group`, `row`, `column`, `separator` | A titled box, and layout. |
| `hint` | Small dimmed explanatory text. |
| `list` | A list of rows with a label and hint, picked with a click. |
| `spinner`, `progressBar`, `skeleton`, `busy`, `statusLine`, `steps`, `fold` | Waiting and work in progress; see [Showing that work is in progress](#showing-that-work-is-in-progress). |

`api.ui.el(tag, props, ...children)` makes any other element. The [`WidgetsApi`
reference](https://docs.scmjs.dev/api/ui/#widgetsapi) has each widget's options.

**Tooltips.** `api.ui.tooltip(element, content)` puts the editor's own tooltip on an
element of yours. The content is a line of text, or a function that builds what to show
where the pointer is. A function is called again as the pointer moves, so a chart can say
what is under it; return null to show nothing at that spot. Leave out the element's
`title`, or the browser's tooltip shows as well. See [the example in the
reference](https://docs.scmjs.dev/api/ui/#tooltip).

### Dialogs

A dialog is modal and covers the map. `mount(body, handle)` fills an empty element; the
rest of the spec is optional:

| Option | What it does |
| --- | --- |
| `size` | `"sm"`, `"md"`, `"lg"`, `"xl"` or `"full"`. |
| `tall` | A fixed height instead of the content's own, for a body that scrolls or fills. |
| `buttons` | The footer, left to right. Left out, a single Close; an empty list removes the footer. A button's `run` may return `false` to keep the dialog open. |
| `flush` | The body runs edge to edge, for content that draws its own frame. |
| `onPaste`, `onDrop` | Files and text pasted into the dialog or dropped on it. |
| `keepOpenOnEscape` | Keep the dialog open when Esc was meant for something inside it, such as a code editor's popup. |
| `slot` | Offer a slot of your own for other plugins to add to; see [Dialog slots](#dialog-slots). |

The handle `mount` receives can `close()`, `setTitle()` and `setBusy(label)`.

To pick something on the map from a dialog, close it, pick, and reopen it with the result,
as Terrain from Image does. The dialog covers the map, so a pick cannot run while it is
open.

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

### Panels

A panel blocks nothing: the user keeps editing while one is open. Its `mount` works as a
dialog's does, and it closes with its × or `handle.close()`.

| Option | What it does |
| --- | --- |
| `dock` | `"float"` (the default) over the map; `"right"` in the dock under the built-in panels, for anything kept open while working; `"bottom"` in a strip under the map, as wide as the map, for a timeline or a console. |
| `width` | Floating only, in CSS pixels; 260 by default. |
| `height` | Floating: a fixed height, so the body scrolls. Bottom dock: the strip's starting height, which the user then drags. |
| `resizable` | Floating only: a grip at the bottom-right corner. |
| `maximizable` | Floating only: a button in the title strip, or a double-click on it, makes the panel fill the map's area and puts it back. |
| `grow` | Docked right: take the dock's spare height. |
| `flush` | Floating only: the body runs edge to edge. |
| `onClose` | Called when the panel closes, whichever way. |

The handle has `isOpen()`, `setTitle()`, and `maximize()` / `isMaximized()` for a
maximizable panel. [Step 2](#step-2-show-it-in-a-panel) of the tutorial and the [problems
panel](#a-problems-panel-that-follows-the-map) recipe are worked examples.

### Status items and map buttons

These are for things that should stay visible without a panel, like a background job or an
unread count.

- **`statusItem(spec)`** is a cell of your own in the status bar: a line of text beside
  your plugin's icon, a spinner while `busy`, a warning colour with `warn`, and a click.
- **`mapButton(spec)`** is a button in the row at the map's bottom-right corner, with an
  optional `badge` and `active` state. Use it sparingly; the row is small.

Keep the handle and call `set(...)` as things change. See [the status item
example](https://docs.scmjs.dev/api/ui/#statusitemspec) in the reference.

### Preferences pages

A plugin's settings belong on a page of its own in Edit ▸ Preferences, listed under
Plugins, rather than behind a menu item. One page per plugin.

- **`mount(body)`** fills the page. It runs the first time the page is shown, and the page
  stays mounted until the dialog closes.
- **`apply()`** is called on OK and Apply. Without it, write each setting to `api.storage`
  as it changes.
- **`reset()`** is called by Reset to defaults while your page is the one showing.

`api.ui.open("preferences", { page: "plugin:<your id>" })` opens the dialog on your page.
See [the example in the reference](https://docs.scmjs.dev/api/ui/#preferencespagespec).

### Dialog slots

A dialog slot adds a button or row to a built-in dialog's footer, or to another plugin's
dialog that offers one. Your `mount` receives the dialog's fields: the form as the user
sees it, not yet applied to the map. The slot can read a field and fill it in, and the
user still presses OK.

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

### Map tools

A map tool receives every press, move and release on the map before the active layer does,
and can draw a preview. Esc or a right-click stops it, and only one runs at a time. In
`draw`, `view.x(px)` and `view.y(py)` turn map pixels into canvas pixels, and
`view.tilePx` is the size of a tile on screen at the current zoom.

![The Drop marines tool running: two marines placed, a ring under the pointer, and the tool's name and hint in the status bar](images/plugin-map-tool.webp)

The picture shows [the reference's example](https://docs.scmjs.dev/api/ui/#maptoolspec)
running. [A brush of your own](#a-brush-of-your-own) is a fuller one, and Paint is the
plugin to read.

### Overlays

An overlay draws over the map while the user works on any layer, and never takes the
pointer. Each one is a tick in the View menu and a row in the Layers panel. `above` sets
where it draws: over the terrain (the default) or over the objects. Call `redraw()` on the
handle when what it shows changes.

![The Start rings overlay on a four-player map zoomed out: a ring round each start location, and a Start rings row under Overlays in the Layers panel](images/plugin-overlay.webp)

The picture shows [the reference's example](https://docs.scmjs.dev/api/ui/#overlayspec).
[A heat map of where the units are](#a-heat-map-of-where-the-units-are) is a fuller one,
and Walkability is the plugin to read.

### Picking on the map

- **`pickArea`** lets the user drag a rectangle and resolves with it in tiles.
- **`pickTile`** resolves with the tile clicked.
- **`pickObject`** resolves with the unit or location clicked, outlining what is under the
  pointer as it moves.
- **`pickFiles`** opens the browser's file picker and resolves with the files, or an empty
  list.

The map picks resolve `null` on Esc or a right-click. Only one runs at a time, and a new
one cancels the previous.

### File types

`fileType(spec)` lets a plugin open a kind of file the editor doesn't. Once you claim an
extension, a file with it that is dropped on the editor or picked in File ▸ Open comes to
you instead of being read as a map. Several dropped together arrive in one call. The
editor's own `.scm`, `.scx` and `.chk` can't be claimed, and the first plugin to claim an
extension keeps it.

```ts
// Replays dropped on the editor, or picked in File ▸ Open, come here.
api.ui.fileType({
  name: "StarCraft replay",
  extensions: [".rep"],
  open: (files) => api.log(`${files.length} replays: ${files.map((f) => f.name).join(", ")}`),
});
```

### Map views

A map view shows something else where the map is drawn: a replay's game played out, or a
picture of the map made another way. Aftermath's Replay view is one.

You choose which maps offer the view: `offer(true, id)` on the handle offers it on a map
(the one in front when the id is left out), and `show(true)` offers it and shows it. A map
that offers a view has a small switch in the top-left corner of its area, *Map* first and
then your view by its title, and each map stays on whichever the user left it on.
`isShown()` says whether the map in front shows your view now, and `onChange` hears when
that changes.

The editor gives the view one element for its whole life and never moves it, so an iframe
inside isn't loaded again when the user switches back and forth.

```ts
// A view of its own for the maps this plugin opens.
const game = api.ui.mapView({
  title: "Game",
  mount(el) {
    const frame = document.createElement("iframe");
    frame.src = "https://example.com/viewer/";
    frame.style.cssText = "border: 0; width: 100%; height: 100%";
    el.append(frame);
  },
});
game.onChange((shown) => api.log(shown ? "the game is shown" : "the map is shown"));

// A map just opened is the one in front: offer the view there and show it.
if (await api.document.open(bytes, "replay.scx", { viewOnly: { label: "Replay" } })) game.show(true);
```

A view the user can move around should feel like the map itself. These hooks in the spec
carry the editor's controls over to your view while it is shown:

| Hook | When it is called | What to do |
| --- | --- | --- |
| `onShow(look)` | The user switched to your view. `look` is where the map was looking. | Look at the same place, at the same scale as near as you can. |
| `onZoom(look)` | The user zoomed: View ▸ Zoom In or Out, a zoom level, Zoom to Fit, the toolbar or their keys. | Look at `look`, then report it with `setCamera`. |
| `minimap.draw(ctx, m)` | The minimap is drawn. The map's ground is already there. | Draw your own units in place of the map's. |
| `minimap.press(x, y)` | A press or drag on the minimap, at a map pixel. | Look there. |
| `onFog(on)` | View ▸ Fog of War or its button. | Turn your view's own fog on or off. |
| `onRepaint()` | Something `paintOver` draws changed: a View toggle, the grid, a location, another overlay. | Draw over your view again. |

And these calls on the handle tell the editor about your view:

| Call | When to call it |
| --- | --- |
| `setCamera({ x, y, width, height })` | Whenever the view moves, in map pixels. The minimap draws its box there, the toolbar shows the zoom, and switching back to *Map* opens the map on the same place. |
| `wheel(w)` | Your view got the mouse wheel itself, as an iframe does. The editor zooms by the user's own wheel rule and calls `onZoom`. |
| `redrawMinimap()` | Your minimap drawing changed. Cheap; call it as often as you like. |
| `setFog(on)` | Your view's fog changed; `null` greys the toggle. |
| `setPointer(at)` | The pointer moved over your view, for the status bar's tile and position; `null` when it leaves. |
| `paintOver(ctx, view)` | From your own drawing, to draw the grid, locations and other plugins' overlays onto a canvas over your view. |

Without `onRepaint`, the Grid, Locations and Location Names toggles are greyed while your
view is shown; without `onFog`, so is Fog of War. Everything else that belongs to the
hidden map, such as its layers, selection, clipboard and Find, is off while your view is
in front.

```ts
let units: { x: number; y: number; colour: string }[] = [];
const replay = api.ui.mapView({
  title: "Replay",
  mount: (el) => el.append(frame),
  onShow: (look) => viewer.lookAt(look.x, look.y, look.height),
  onZoom: (look) => viewer.lookAt(look.x, look.y, look.height),
  minimap: {
    draw(ctx, m) {
      for (const u of units) { ctx.fillStyle = u.colour; ctx.fillRect(m.x(u.x) - 1, m.y(u.y) - 1, 2, 2); }
    },
    press: (x, y) => viewer.lookAt(x, y),
  },
});
viewer.onMove((c) => replay.setCamera({ x: c.x, y: c.y, width: c.width, height: c.height }));
viewer.onWheel((w) => replay.wheel({ deltaY: w.deltaY, ctrlKey: w.ctrlKey, x: w.mapX, y: w.mapY }));
viewer.onUnits((list) => { units = list; replay.redrawMinimap(); });
```

```ts
// The grid, locations and other overlays over the game, its fog on the editor's toggle, the pointer in the status bar.
const replay = api.ui.mapView({
  title: "Replay",
  mount: (el) => el.append(frame, canvas),
  onRepaint: () => drawOver(),
  onFog: (on) => viewer.fog(on),
});
function drawOver() {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  replay.paintOver(ctx, viewer.mapView());
  drawMyMarks(ctx);
}
viewer.onFogChange((on) => replay.setFog(on));
viewer.onPointer((at) => replay.setPointer(at));
```

### Showing that work is in progress

A dialog that does not change while it works looks broken. `ui.widgets` has one set of
tools for this, so plugins look alike:

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

### Menus, context menus and hotkeys

**`api.menu.add(path, item)`** adds a menu item.

- `path` is a menu (`"Tools"`) or a submenu (`"File/Import"`), always in English.
- A path that names no existing submenu creates one for your plugin (`"Tools/My Plugin"`),
  and one that names no menu creates a top-level menu before Help (`"Account"`).
- The item's `label` is English too: labels are how items find each other, whatever
  language the menu shows. The editor translates it through your catalogues (see
  [Translating](#translating)).
- Items go at the end of the menu unless `after` names an item to follow, by its English
  label.
- `icon: "plugin"` marks the item with your plugin's icon, and `enabled` greys it out.

**`api.contextMenu.add(surface, item)`** adds to a right-click menu. The surfaces are
`"viewport"` (the map) and `"terrainPalette"`. The item's functions receive what was under
the pointer. A fixed `label` is English and translated like a menu label; a function label
is called when the menu opens, so translate it there with `api.i18n.t`.

**`api.hotkeys.add(combo, run)`** adds a key such as `"Ctrl+Shift+I"`. Plugin hotkeys are
tried before the editor's own, and never while the user is typing in a field or a dialog
is open.

All three accept a `command` id instead of `run`; see [`api.commands`](#apicommands).

```ts
// Right-click the map: copy the position of the tile under the pointer.
api.contextMenu.add("viewport", {
  label: (ctx) => (ctx.tile ? `Copy position (${ctx.tile.x}, ${ctx.tile.y})` : "Copy position"),
  enabled: (ctx) => ctx.tile !== null,
  run: (ctx) => { if (ctx.tile) void navigator.clipboard.writeText(`${ctx.tile.x}, ${ctx.tile.y}`); },
});
```

## The API, group by group

This part covers what each group is for and the rules that matter when using it. Each
section links to its page in the [API reference](https://docs.scmjs.dev/api/), which has
every call's signature, options and further examples; the examples here are the ones the
reference does not have.

The examples are written as playground snippets, with `api` already defined. In a plugin
the same lines go inside `activate(api)`. [Core concepts](#core-concepts) has the rules
that hold for every group.

### `api.document`

[Reference](https://docs.scmjs.dev/api/document/)

The open map as a whole.

- **Reading:** `isOpen()`, `info()` (name, size, tileset, whether modified or view-only),
  `history()` (the undo and redo labels), and `scenario()` for the whole parsed map,
  read-only.
- **Writing:** [`edit`](https://docs.scmjs.dev/api/document/#edit) and
  [`update`](https://docs.scmjs.dev/api/document/#update) (see [The three kinds of
  write](#the-three-kinds-of-write)), and `undo()` / `redo()`.
- **Files:** `open`, `create`, `save`, `saveAs`, `close`, `export` (the map as a `File`,
  the way Save writes it, ready to upload) and `renderImage` (a PNG).
- **Testing a built map:** `test(bytes, fileName, { launch })` hands bytes of your own,
  such as a map your plugin built, to Tools ▸ Test Map. On the desktop the game is started
  when `launch` is true (the user's preference when left out). In a browser the file goes
  into the test folder the user picked; with none picked it answers null and never
  downloads.
- **Whole-map changes:** `resize` and `changeTileset`. Both clear the undo history, as the
  editor's own dialogs do.
- **Several open maps:** `id()`, `list()` and `activate(id)`; see [Several
  maps](#several-maps-and-maps-to-look-at-only).
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

A new map beside the open one, and a picture of it:

```ts
if (await api.document.create({ width: 96, height: 96, tileset: "jungle", name: "Sketch", startLocations: 2, into: "new" })) {
  const png = await api.document.renderImage({ pixelsPerTile: 4 });
  if (png) await api.ui.saveFile(png, "sketch.png");
}
```

The open map, written as Save would write it, sent to Test Map:

```ts
const file = await api.document.export();
const outcome = file && (await api.document.test(new Uint8Array(await file.arrayBuffer()), file.name, { launch: false }));
api.ui.status(outcome ? `Written to ${outcome.path}` : "No test folder chosen yet.");
```

### `api.document.sections`

[Reference](https://docs.scmjs.dev/api/document/#sectionsapi)

The map file as a list of sections, as the game reads it and Save writes it, with unsaved
edits already included. Section Explorer is built on it, and Repair uses its helpers.

**Reading.** `list()` gives each section's name, offset, size and what the editor knows
about it. `bytes(index)` is one section's payload, `combined(name)` what the game uses
when a name is repeated, and `file()` the whole file.

**Writing.** `write`, `rename`, `insert`, `remove`, `move` and `replaceFile`. After each:

- The file is parsed again from scratch and becomes the open map, so the change reaches
  every part of the editor, even for sections it does not understand.
- The undo history and selections are cleared, and the `"document"` event fires with
  reason `"replace"`.
- The call returns the parser's `warnings`.
- Indices shift after an insert or remove, so call `list()` again.
- The map is marked modified. The exception is `replaceFile(bytes, { asOpened: true })`,
  which takes the bytes as the file that was opened. Use it for a repair made right after
  `"open"`, so the map does not ask to be saved when nothing the user did changed it. Save
  still writes the bytes.

**Helpers for repairs.** `required()` (the sections this map's revision must have),
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

[Reference](https://docs.scmjs.dev/api/document/#buildstepsapi)

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
  opened again, so generated triggers never appear in the trigger list. See [Opening and
  saving maps](file-formats.md#built-maps).
- **A step cannot cost the user a save.** If `run` throws, the map is saved unbuilt and a
  notice shows your error message, so write it for the user. A *Save without it* button
  aborts the `signal` that `run` is also given. Test Map stops on an error instead.
- `before({ id, label, applies?, run })` runs earlier, on the open map rather than on the
  bytes, and may use `document.update` and `document.edit`. TrigScript uses it to write
  its triggers into the trigger list before every save.
- `builtBy()` says which steps built the file the open map came from.

A bare `.chk` is never built, since it has nowhere to keep the unbuilt copy.

### `EditTransaction`

[Reference](https://docs.scmjs.dev/api/document/#edittransaction)

What `document.edit` passes to its function. When the function returns, the transaction
removes doodads the terrain change broke and units the new ground cannot hold (if the
Units palette's *Remove stranded units* is on), commits and repaints.

- **Terrain:** read and set tiles (`tileAt`, `setTile`, `setTiles`), the editor's brushes
  (`stampTerrain`, `paintIsom`, `fillArea`, `placeBlend`, `replaceTerrain`, `fillFlat`),
  and the ISOM lattice (`rebuildIsom`, `tilesFromIsom`). Most brushes need the tileset
  graphics.
- **Objects:** units (`placeUnit`, `canPlaceUnit`, `addUnits`, `moveUnits`, `updateUnits`,
  `placeStartLocations`, …), sprites, doodads (`placeDoodad`, `convertDoodads`), locations
  (`addLocation`, `editLocation`; slot 63, Anywhere, is protected), fog (`setFog`,
  `floodFog`, …) and `paste` for a whole `Clip`.
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

### `UpdateTransaction`

[Reference](https://docs.scmjs.dev/api/document/#updatetransaction)

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

### `api.settings`

[Reference](https://docs.scmjs.dev/api/settings/)

The same views as the `UpdateTransaction` parts, for reading without a transaction:
players, forces, unit types, upgrades, techs, sounds, unit property slots, whether a unit
is available to a player (`unitAvailable`), and `version()` (revision and text encoding).
Write through `document.update`.

### `api.triggers`

[Reference](https://docs.scmjs.dev/api/triggers/)

Reading triggers and everything needed to show one. Writing is `document.update`.

- **The lists.** `list()` and `briefing()` return copies. A record is 16 conditions and 64
  actions of plain numbers.
- **Showing a trigger.** `summarize` gives the three lines the trigger list shows,
  `comment` a trigger's Comment text, and `text` prints and parses the text trigger
  format. `defs` says what each condition and action type means and which record field
  holds each argument.
- **Making records.** `newTrigger`, `newCondition` and `newAction` make blank records.
  `isPreserved` and `setPreserved` read and set the Preserve Trigger action.
  `triggersFor(list, groups)` finds the triggers some player groups own.
- **Switches and counters.** `switchNames()` gives every switch's name and `switchUsage()`
  how many conditions and actions mention each. `usage()` lists every death counter and
  switch the triggers use, for a plugin that needs counters of its own. `epd` and
  `addressOf` do EUD address arithmetic.
- **What depends on what.**
  [`references()`](https://docs.scmjs.dev/api/triggers/#references) says what each trigger
  reads, writes and names: switches, death counters, memory addresses, locations, the
  timer, resources, scores, units, strings, sounds, AI scripts and Victory / Defeat /
  Draw. The Trigger Map plugin draws its whole graph from this one call.
  - A condition *reads*. An action *writes*, or *uses* something without changing it
    (the location units are created at, the text a message shows).
  - Player groups come resolved to slots, with `approximate` set for groups the game
    settles only while it runs, such as *Foes*. `resolvePlayers(group)` does that
    resolution on its own.

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
line number. The [trigger reference](triggers.md) lists every condition and action in this
form. Use `newTrigger` / `newCondition` / `newAction` to change one field of an existing
record.

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

The *As text* button at the bottom left of the picture is a [dialog slot](#dialog-slots).

### `api.query`

[Reference](https://docs.scmjs.dev/api/query/)

Read-only questions about the open map.

- **What is where:** `unitAt`, `spriteAt`, `doodadAt`, `locationAt`, `unitsIn`, `unitsOf`,
  `startLocations`, `fogAt`.
- **Placement:** `placement(unitId, x, y)` gives the Units palette's verdict with a reason
  in words; `doodadPlacement` checks a doodad's ground.
- **The editor's own tools:** `validate()` (Check Map's issues), `statistics()`,
  `find(options)` (the Ctrl+F search), `strings()`, `stringUsage()`, `unusedStrings()`.

An issue's `target` from `validate()` is a unit, location or trigger that `view.goTo`
accepts, or a settings dialog to open. The [problems
panel](#a-problems-panel-that-follows-the-map) recipe uses both.

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
graphics. Call `load()` first; `ready()` says whether they are already in memory.
Everything is null when the game data was never installed, so degrade instead of throwing.
Values are as the files store them: hit points, for one, are in 256ths.

### `api.gameData`

[Reference](https://docs.scmjs.dev/api/game-data/)

Which set of game files the editor uses, the game's own or a mod's, and the plugin side of
Help ▸ Game Data…. The `"gameData"` event fires on every change.

- **Which set.** `source()` says where the files in use came from, `profile()` which data
  set they belong to, and `profiles()` lists every set with a copy here.
- **Managing sets.** `install(profile, files, progress)` extracts a set from its archives
  and switches to it, `select(id)` switches, and `remove(id)` deletes a set's copy. The
  game's own archives must be among a mod's files, since a mod only replaces files.
- **Reading files.** `read(path)` hands over one of the extracted files as bytes, for a
  plugin that reads the game's formats itself: `arr/units.dat`, `tileset/jungle.cv5`,
  `unit/zerg/drone.grp`. Paths are the archive's, in lower case with forward slashes, and
  `tileset/manifest.json` and `unit/manifest.json` list what was extracted. It answers
  null for a file the copy does not have.

A mod's files replace the game's in the same formats, so `data`, `tileset`, `graphics` and
`names` follow them automatically. Mods that extend the game's table sizes are not
covered. A plugin written only for the game's own data can check `profile().id`
(`"starcraft"`) and turn itself off for anything else.

```ts
const source = api.gameData.source();
api.log(source ? `${source.profile.name}: ${source.label}` : "still starting up");
for (const set of await api.gameData.profiles()) api.log(`data set ${set.id}: ${set.name}`);

const dat = await api.gameData.read("arr/units.dat");
api.log(dat ? `units.dat is ${dat.length} bytes` : "no game data installed");
```

### `api.consts`

[Reference](https://docs.scmjs.dev/api/consts/)

The numbers the map file is written in, so a plugin does not hard-code them: pixels per
tile, the start location and resource unit ids, the unit and sprite flag bits, the
Anywhere location's slot, and `triggers`, which has every condition and action type,
player group and argument value.

For an argument that takes one of a fixed set of values, `api.triggers.defs.choices` gives
the values with their labels:

```ts
// What each argument of a Set Switch action can be.
const def = api.triggers.defs.action(api.consts.triggers.action.SetSwitch);
for (const arg of def?.args ?? []) {
  api.log(arg.label, api.triggers.defs.choices(arg.kind).map((c) => `${c.label} = ${c.value}`));
}
```

### `api.graphics`

[Reference](https://docs.scmjs.dev/api/graphics/)

The images the map view draws, for your own lists and previews.

- **Pictures:** `unitImage`, `spriteImage`, `tileImage` and `doodadImage`, in a player's
  colours where that applies. `playerColor(owner)` is the colour a player's units are
  drawn in.
- **Renders:** `renderRect` draws part of the map as a PNG, and `renderClip` draws a
  `Clip` as the paste preview does.
- **Icons:** `icon(kind, id)` is the game's own button picture for a unit type, an upgrade
  or a technology, as its command card shows it: yellow, or grey or white with
  `{ look: "disabled" }` or `{ look: "selected" }`. It suits a list or a tooltip better
  than a unit's picture from the map.

Rules for using them:

- Call `load()` first; `ready()` says what is already in memory.
- Unit and sprite images and the icons load lazily, so the first request often returns
  null. Call `requestUnit` / `requestSprite` / `requestIcons`, and redraw in
  `onImageLoaded`.
- An image is the editor's own cached canvas: draw from it onto a canvas of yours instead
  of moving it into your page.
- Images are always the classic game's size, even when the user has View ▸ Remastered
  Graphics on.
- With no game data there are no images. Show the name instead.

### `api.commands`

[Reference](https://docs.scmjs.dev/api/commands/)

Named actions, so a menu item, a hotkey, a context-menu entry and another plugin can all
reach the same one.

- An id without a dot is prefixed with your plugin's id (`"convert"` becomes
  `"image-to-terrain.convert"`); one with a dot is used as is, for a name other plugins
  can rely on.
- `run(id)` runs anyone's command and returns what it returns. `list()` gives every
  command registered by every plugin.
- Plugins start in no fixed order, so check `has(id)` or listen for the `"commands"` event
  before calling another plugin's.

```ts
// Every command other plugins offer.
for (const c of api.commands.list()) if (c.pluginId !== api.plugin.id) api.log(c.id, c.title, c.enabled ? "" : "(disabled)");
```

### `api.services`

[Reference](https://docs.scmjs.dev/api/services/)

A command is one action; a service is an object to share, such as an account, a server
connection or a compiler. One plugin provides it by name and others reach it by that name,
whichever starts first.

- `provide(name, object, { version })` holds the object out. Names follow the command
  rule.
- `watch(name, fn)` calls you at once with the object or null, and again whenever the
  provider arrives, changes or goes. Prefer it to `get(name)`, which answers only for now.
  `has(name)` and `list()` say what is provided.
- The object's shape is up to the provider. Publish a `contract.d.ts` in the provider's
  repository for consumers to import with `import type`, and pass a `version` so consumers
  can check it.

The scmjs.dev plugin provides its account this way as `scmjs-dev.account`, and eudplib its
compiler as `eudplib.build`.

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
  onApplied: (report) => { if (report.dropped > 0) showNotice(`${report.dropped} changes no longer applied`); },
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
an edit to a unit someone else deleted is dropped; `onApplied` reports how many.

- `start` answers null when no map is open or another session is already running.
  `current()` is the running session, whichever plugin started it.
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
lattice (`diamondAt`, `diamondsIn`), `floodRegion` and `blendCandidates`. Also the Terrain
palette's current brush (`active` / `setActive`) and Tools ▸ Symmetry (`symmetry` /
`setSymmetry`, `mirror`).

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
decoded data. `load()` resolves `false` when the graphics were never installed, which is a
normal state. `load("jungle")` fetches another tileset without changing the map, which
`graphics.renderClip` needs to draw a clip from a map on that tileset.

### `api.selection`

[Reference](https://docs.scmjs.dev/api/selection/)

The marked area (`markedArea` / `markArea`), the selected units, sprites, doodads and
locations (by index, with a setter for each), the active layer, and the Layers panel's
locks. Listen for the `"selection"` event to follow what the user selects.

### `api.clipboard`

[Reference](https://docs.scmjs.dev/api/clipboard/)

The Cut / Copy / Paste layer, sharing the user's clipboard: `copy`, `cut`, `paste`, `clip`
/ `setClip`, and the parts and paste mode. A `Clip` can be pasted into another map.
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

The formats behind File ▸ Import / Export: SCMDraft's `.trg` trigger files (`encodeTrg` /
`decodeTrg`) and the tab-separated strings file (`formatStrings` / `parseStrings`).

### `api.palette`

[Reference](https://docs.scmjs.dev/api/palette/)

What the Units, Sprites, Doodads and Fog palettes have picked and what they list, so a
plugin can use "whatever the user chose" without a picker of its own. Paint does this. It
also holds the placement rules (collision, terrain, snap to grid, remove stranded units)
that `placeUnit`, `canPlaceUnit` and `query.placement` follow. The Terrain palette's pick
is `terrain.active()`.

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

### `api.ui`

[Reference](https://docs.scmjs.dev/api/ui/)

Everything a plugin shows: messages and questions, dialogs, panels, status items, map
buttons, preferences pages, dialog slots, map tools, overlays, picks, file types, map
views, widgets and tooltips. [Putting things on screen](#putting-things-on-screen) covers
each in turn. Two calls fit nowhere else:

- `saveFile(data, fileName)` writes a file the way the editor's own exports do, and
  `loadImage` / `readClipboardImage` read pictures.
- `repaint()` asks the map view to repaint, for a plugin that changes what its own drawing
  shows. A transaction repaints by itself.

### `api.menu` / `api.contextMenu` / `api.hotkeys`

References: [menu](https://docs.scmjs.dev/api/menu/), [context
menu](https://docs.scmjs.dev/api/context-menu/),
[hotkeys](https://docs.scmjs.dev/api/hotkeys/)

Menu items, right-click entries and keys. The rules are in [Menus, context menus and
hotkeys](#menus-context-menus-and-hotkeys).

### `api.i18n`

[Reference](https://docs.scmjs.dev/api/i18n/)

Translating your plugin the way the editor translates itself: `register` your catalogues,
then `t(text, params)` translates. [Translating](#translating) shows the pattern the
project's plugins follow.

- `tc(context, text, params)` translates identical English meant two ways.
- Placeholders are a subset of ICU MessageFormat: `{name}`, `plural` and `select`. For
  Korean, `{name|을}` picks the particle that agrees with the value (을/를, 이/가, 은/는, 과/와,
  으로/로).
- `language` is the current language (`"en"`, `"ko"`). The `"language"` event fires when
  it changes, so you can relabel what is showing.

### `api.events`

[Reference](https://docs.scmjs.dev/api/events/)

`on(event, fn)` listens for a change. [Events](#events) in Core concepts lists every event
and the rules listeners follow.

### `api.storage`

[Reference](https://docs.scmjs.dev/api/storage/)

`get(key, fallback)`, `set(key, value)` and `remove(key)` keep JSON in the browser under
your plugin's id. `set` returns `false` when the browser refuses (the quota is a few
megabytes for the whole editor), so a plugin storing the user's work can say so. Users can
see and clear your keys in Preferences ▸ Storage, so never keep the only copy of something
there.

```ts
const runs = api.storage.get("runs", 0) + 1;
const kept = api.storage.set("runs", runs);
api.log(kept ? `run number ${runs}` : "the browser's storage is full");
```

For data that belongs to one map, use `document.extras` instead, so it travels with the
file.

### `api.scope()`

[Reference](https://docs.scmjs.dev/api/#root)

A child of your `api` that can be removed as a whole. Everything registered through
`scope.api` (menu items, hotkeys, listeners, panels, dialogs, overlays, map tools,
commands, services) is removed when you call `scope.dispose()`, and the plugin's own
registrations stay. After the dispose, writes to the map through `scope.api` are refused,
as they are for a plugin that has been turned off. Scopes can contain scopes, and turning
the plugin off removes every scope it made.

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

A scope uses the plugin's own id, storage and name in the log. The API Playground runs
each snippet in one. Timers and sockets are not registrations, so clear them yourself.

### `api.plugin`, `api.apiVersion`, `api.log(...)`

[Reference](https://docs.scmjs.dev/api/#root)

Your plugin's `id`, `name` and `source`, the API version, and a logger. `log` writes to
the browser console and to the editor's View ▸ Debug Console, which users copy into bug
reports, so write lines someone else could follow.

```ts
api.log(`${api.plugin.name} (${api.plugin.id}) from ${api.plugin.source}, API ${api.apiVersion}`);
```

## Plugins to read

Each plugin is its own repository with a README, built against the same API. Read the one
closest to what you are writing.

| Plugin | Read it for |
| --- | --- |
| [Hello World](https://github.com/scm-js/plugin-hello-world) | The smallest complete plugin: one menu item and one dialog, a Korean catalogue and its test, the toolchain set up. Copy it to start. |
| [API Playground](https://github.com/scm-js/plugin-api-playground) | `api.scope()` to remove what other code registered, and the plugin API's own typings in a code editor. |
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
| [scm-sim](https://github.com/scm-js/plugin-scm-sim) | A library plugin with no runtime of its own: a service that talks by message to another page of the same origin, with progress and cancellation. |
| [Stamp Library](https://github.com/scm-js/plugin-stamp-library) | `api.storage` for user data, `clipboard.capture`, `tx.paste`, rendered thumbnails. |
| [Trigger Map](https://github.com/scm-js/plugin-trigger-map) | `triggers.references`, a large resizable panel drawn in SVG, a button in the Trigger Editor's slot, `view.goTo` a trigger. |
| [Timelapse](https://github.com/scm-js/plugin-timelapse) | The `"commit"` event, `graphics.renderClip`, IndexedDB for large data, a preferences page. |
| [Aftermath](https://github.com/scm-js/plugin-aftermath) | Claiming a file type, view-only maps from `document.open`, a map view in the map's place, docked and bottom panels, game icons and chart tooltips. |
| [scmjs.dev](https://github.com/scm-js/plugin-scmjs-dev) | Services, its own menu, status items, docked panels, dialog slots, `api.sync` for shared maps. |
