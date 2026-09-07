# Loading, installing and updating plugins

`loader.ts` is pure apart from `LoaderDeps` (fetch, transpile, module URL, import, built-ins):
`parseSpec` (`builtin:`, `github:owner/repo[@ref][/dir]`, github.com URLs, any URL to a `plugin.json`
/ entry file / directory) → `resolvePlugin` (manifest, entry) → `bundleModule` (fetch **as text** —
raw.githubusercontent serves `text/plain`, which `import()` refuses — transpile `.ts` in the transpile
worker via `transpileClient#transpileInBackground` / `plugins/transpile.ts`, follow relative imports
depth first, refuse bare package names and cycles, rewrite specifiers to `blob:` URLs) → `import()`.
`candidateUrls` is the resolver a `fetch` does not come with: an extensionless specifier is tried as
`.ts`/`.tsx`/`.mts`/`.js`/`.mjs` and then `index.*`, and `./x.js` falls back to `./x.ts` — the
bundled built-in never needed this because Vite resolved for it, and the first remote load of
Terrain from Image 404ed on `./convert`.
`builtin.ts` (`import.meta.glob` over `plugins/*/plugin.{ts,json}`) is the same `activate(api)` path
minus the fetch, for a plugin bundled into the build — **nothing ships that way**: there is no
`plugins/` directory, the globs are empty and the mechanism is kept only for a fork that wants one.
A manifest `icon` — an emoji, a `data:`/`https:` image, or an image file beside
the manifest — becomes a `PluginIcon` in `loader.ts#resolveIcon` (anything else, `javascript:` above
all, resolves to null and the plugin keeps the default mark); a built-in's file URL comes from a second
`import.meta.glob` in `builtin.ts` because Vite hashes (and here inlines) the asset. It rides on the
runtime and on `PluginInfo`, and `PluginIconView` draws it in the Manage Plugins list and as the title
icon of every dialog the plugin opens. `installedPluginsAtom` persists `{ spec, enabled }`;
`defaults.ts` holds the plugins a fresh editor starts with (`DEFAULT_REMOTE_PLUGINS` —
scmscx.com, Repair, Walkability, Terrain from Image, Paint, TrigScript (a default since 2026-09-07, on) and
scmjs.dev (off), each pinned to a tag; that file is the only place the versions are written down, so read them there
rather than here; Melee Wizard
and Section Explorer are published in the registry but are not defaults — plus any built-in, each a
`DefaultPlugin { spec, enabled }`), which `effectiveInstalls` merges over
the stored list, so a default is always listed, starts as its entry says unless the stored list says
otherwise, can be turned on or off but not removed, and is otherwise
an ordinary spec; the Manage Plugins row badges it `default`
and hides its Remove button (what the user pastes is canonicalised through `canonicalSpec(parseSpec(...))`,
so pasting the default's own github.com URL is recognised as it rather than duplicating it).
Every default names a **tag, not a branch**, and that one change is what the rest hangs off.
An unpinned default meant a push to a plugin repository changed every editor already in use
and no released version could be rebuilt as it shipped; moving one forward is now a commit
in `defaults.ts` that ships with the next release. `isPinned` therefore counts any explicit
ref that is not a branch name (`MOVING_REFS`) and `unpin` strips any ref, and identity moved
off the spec string: `loader.ts#pluginIdentity` is the repository whatever version follows
it, and `defaults.ts#pluginKey` is that with a *bundled* copy answering for the spec it was
built from. `effectiveInstalls` folds a stored row onto the default with the same key (an
older editor's unpinned spec, or the desktop's `builtin:` copy) instead of listing — and
running — the plugin twice; the default's own spec wins unless the stored one `isPinned`,
which is a version the user chose through the Update button. Browse's `installOf` matches on
the same key.
`scripts/vendor-plugins.mjs` (`npm run vendor:plugins`, run by **`predev` / `prebuild`**
and again by `scripts/build-desktop.mjs` unless `--skip-plugins`) is the other half: it
reads the pinned specs straight out of `defaults.ts` with a regex (importing it would pull
in `builtin.ts`'s Vite-only `import.meta.glob`), fetches each plugin's runtime source at
that tag — the manifest, the icon, every `.ts`/`.js` outside `dist/`, `tests/`,
`.github/`, plus the LICENSE; the *source*, not the plugin's own `dist/plugin.js`, since
Vite tree-shakes what it compiles in, and `@scm-js/plugin-api` is imported with
`import type` and erased before the bundler sees it — and writes it into the gitignored `plugins/<name>/` with a
`vendored.json` naming the spec, which `builtin.ts` reads into `BUILTIN_REPLACES` and the
script itself reads to know which copies are its own (it brings those up to date and
removes ones that stopped being defaults; a hand-made directory is left alone). A copy
already at the pinned spec is skipped, so only the first build after a clone touches the
network and `SCMJS_SKIP_VENDOR=1` opts out entirely (that bundle fetches its defaults at
startup, as before).
**Every** build bundles them, not just the desktop. The reason is the cold path: a `.ts`
plugin must be transpiled before the browser will import it, one transpile starts
`transpile.worker.ts`, and TypeScript is *inlined into that worker* — so five remote `.ts`
defaults dragged 3.4 MB (975 KB gzipped) of compiler onto a first visit. Measured on the
production build with a logging static server, a cold visit went from 1235 KB gzipped / 20
cross-origin requests to 344 KB / none. It is all or nothing: one remote `.ts` default
starts the worker and costs the lot. The rest follows — an installed app and a container on
an intranet start with all five, and nothing third-party is fetched at startup.
What it costs is that the remote loading path is no longer walked by simply opening the
editor. `tests/plugin-network.test.ts` is the deliberate replacement (real fetch, transpile
and `import()` through `data:` URLs in Node; `describe.skipIf` unless
`SCMJS_NETWORK_TESTS=1`), run by build.yml's Web job and release.yml's pre-flight — neither
of which gains a dependency, since the build already needs GitHub to vendor.
`tests/vendor-plugins.test.ts` pins the parse, the file filter and the rule that no default
may be unpinned.

**A plugin repository's typings and its build.** The contract reaches the plugin
repositories as `@scm-js/plugin-api`, a devDependency on `^1` holding one generated
`index.d.ts`: `scripts/build-plugin-types.mjs` bundles it and
`scripts/publish-plugin-api.mjs` publishes it — to **npm**, which is what the plugin
repositories depend on, and to `github.com/scm-js/plugin-api`, which is the audit trail
behind the tarball and holds its README. The `plugin-api` job in build.yml runs it on every
build. Before this each of the nine repositories carried its own copy of the 61-file
emitted tree, refreshed by hand. Nothing is fetched at runtime for it — `import type` is
erased before the loader sees a specifier, which is what lets a plugin depend on a package
at all.
The version is the **API's**, not the editor's: major is `PLUGIN_API_VERSION`, the minor
moves when the declarations do (`nextVersion`, asked of the registry), and the editor
version is in neither file — editor 0.1.0 → 0.2.0 is an ordinary release that semver reads
as a break, and an npm version cannot be republished, so anything in there that moves on
its own would publish out of a build that changed nothing. A build that did not move the
contract publishes, tags and commits nothing. `PLUGIN_API_PAT` is the organisation secret
for the git push (a run without it reports instead of failing); the npm half is behind the
`PUBLISH_PLUGIN_API` repository variable, authenticates by OIDC alone (no npm token, hence no
`registry-url` on that job's `setup-node` — it writes an `.npmrc` with an empty `_authToken`; and
the trusted publisher's **Allowed actions** must permit a *direct* publish, since staging is the
only one allowed by default), and goes out with `--provenance`, which is also
why the package's `repository` names scm-js — provenance attests to where the workflow ran.
`tests/plugin-api-package.test.ts` pins the version rule and the no-imports rule.
`PluginManifest.build` is the other half: a plugin repository publishes a
`dist/plugin.js` (one esbuild call, committed) and names it, and `resolvePlugin` loads
**it** in place of `entry` — one fetch, no transpile worker, no `bundleModule` graph walk,
and the plugin may use npm dependencies, which the source path cannot resolve.
`ResolvedPlugin.built` / `PluginAddresses.built` carry which happened, so
`ConfirmPluginDialog` names the bundle *and* the source it was built from. `entry` stays
required reading and stays what loads for a repository with no build, so a one-file plugin
still needs no toolchain. The shared workflow is
`scm-js/.github/.github/workflows/plugin-ci.yml`, called in six lines by each plugin
repository: type-check, test, rebuild and commit the bundle on main, and at a tag rebuild
and *check* rather than write — esbuild is deterministic and the bundle carries no hash or
date, so a tag whose `dist/plugin.js` is not what its source builds to fails. Its scheduled
run type-checks against the newest `@scm-js/plugin-api`, which is how a moved contract
surfaces. `tests/plugin-network.test.ts` covers both loading paths against the real
repositories.
A failed activation is no longer silent: `plugins/failures.ts` is pure (`pluginFailures`
over the runtimes, `failureToast` with `ttl: 0` so it outlives the splash and a *Plugins…*
button that opens Manage Plugins) and `usePlugins` awaits the pass and reports once per spec
per session. For that to work `activatePlugin` returns the load **in flight** for a spec that
is already loading rather than a resolved promise — React's double mount otherwise had the
second pass reading the runtimes before a single fetch had finished.
Adding a plugin goes through a confirmation first: `PluginsDialog`'s Add canonicalises
the spec (`loader.ts#canonicalSpec`), runs `host.ts#inspectPlugin` → `loader.ts#previewPlugin` —
`resolveCommit` (GitHub's commits API, one request, no token) then
`resolvePlugin(..., { entry: false })` on *that commit*, so one `plugin.json`, no entry
probe and no `import()` — and opens `confirmPlugin` **only once that came back with a
manifest**, handing the `PluginPreview` over in the payload (fetched once; the Update
button on a pinned row does the same). An address with no plugin behind it is answered
under the field instead (`NOT_FOUND` plus the fetch's own message), because a details
screen with no details on it reads as a broken dialog rather than a wrong address.
`ConfirmPluginDialog` shows the manifest (name, version, author, description,
icon), the repository (`PluginSource.webUrl`, derived by `parseSpec` for a GitHub spec)
and homepage links, the manifest / entry / base URLs of the version being installed
(`addressesOf`, recomputed as the pin tick moves), and the not-sandboxed warning.
`installPlugin` is the only writer past it: it seeds the manifest through
`rememberManifest` (shared with `describePlugin`), then `setInstalled` + `activatePlugin`.
Its three options are the dialog's ticks — *Enable it now* (on), *Pin to this version*
(on whenever `PluginPreview.pin` resolved, storing `github:owner/repo@<sha>` instead of
the moving spec; `isPinned` recognises one) and *Load from a copy saved here* (off,
`PluginInstall.local`, the same tick the Manage Plugins row carries under its buttons).
The label and the explanation under it read the same whether that tick is on or off — one
that swapped between describing the copy and describing the fetch read as two different
options — so the only state-dependent part is the size of the copy, shown next to the row's
tick.
A manifest that cannot be read (`PluginPreview.problem`) is a dead end on both screens —
the dialog says so and Add is disabled — `pinProblem` says why there is no pin, and an
unusable spec fails in `add` before any fetch.

`local` is served by `loadDepsFor`: with no copy yet the load runs through
`recordingDeps` and `storeSnapshot` writes every fetched file to `pluginCodeAtom`
(`scmjs.plugin-code`, capped at `MAX_SNAPSHOT`); with a copy it runs through
`storedDeps`, which has no network path at all and errors on a URL the snapshot lacks
(`describePlugin` reads the copy too, so the address is never touched while the option
is on). `PluginRuntime.loadedFrom` records which happened. `reloadPlugin` drops the copy
and re-fetches — the way both a pinned and a stored plugin are moved forward — and
`setInstalled` drops it whenever `local` goes false or the plugin is removed;
`clearStoredDataAtom` `RESET`s the atom with the others. Reload re-fetches whatever the
spec names, so a pinned plugin moves forward through the row's **Check for update** button
instead: it previews the repository's newest release and, when that is a different version,
reopens the confirmation with `replaces` set, which makes `installPlugin` deactivate, unlist
and un-copy the old commit before installing the new one.
That button is on every row with an address to ask, whether or not anything is newer, so
most presses can only answer "nothing is" — it used to say **Update** and put that answer in
one dim line at the top of the pane, which for a button near the bottom of a scrolling list
read as the press doing nothing at all. The answer is a `CheckAnswer` per spec now
(`InstalledPane`'s `checked`): *Up to date* or *Could not check* on the row itself, a toast
beside it (worded with the release it found — "the newest commit" answered a question nobody
asked), and for a newer release the button becomes `Update to v…` holding the preview it was
found with, so cancelling the confirmation neither loses the answer nor asks GitHub twice.
Which rows get it is `defaults.ts#updateAddress`, not `isPinned`: vendoring swaps a default's
spec for `builtin:paint`, which is not pinned, so the one button that moves a plugin forward
appeared on every row **except** the ones the editor ships — and only in builds that skipped
vendoring, making the button's presence a fact about the packaging rather than the plugin.
`BUILTIN_REPLACES` holds the spec each bundled copy was built from, which is the address to
ask; a bundled plugin is still asked for nothing until the press. What it asks about is the
newest **release tag** (`loader.ts#listTags` / `newestTag`, ranked here because the API's tag
order is not version order), not the branch tip: `checkForUpdate` used to preview
`unpin(spec)`, which called a plugin out of date the moment anything landed on main after
its tag — a docs commit, a CI-rebuilt `dist/plugin.js` — and the update it then offered was
an untagged commit whose `plugin.json` carried the version already installed, so the button
read `Update to v1.1.2` on a row reading v1.1.2 and taking it stored a commit no release
names. A prerelease tag is not a release for this. A repository with no release tags still
falls back to the branch, which is all it has.
The comparison itself is by **commit** (`host.ts#checkForUpdate`), because comparing spec
strings called every tag-pinned install out of date for ever — a tag is never spelt like the
hash a check resolves — which would have had all five defaults offering an update to the code
they were already running; the installed tag's commit usually comes out of the same tag list
(so the common check is two requests, one fewer than before, and `previewPlugin` takes the
newest release's commit as `opts.commit` rather than asking again), a hash-pinned spec answers
for itself, and an unresolvable ref falls back to the spec comparison. Over that sits the
backstop: `installed.version` is what the plugin is *running* (the row passes
`rt.manifest.version`) and a release naming that version is the release already installed,
whatever the commits say — a retagged or force-pushed release is the author saying nothing new
shipped.
**Unasked** is `plugins/updates.ts` and `Preferences.plugins.updates` (`notify` /
`manual` / `auto`, a Select in Preferences ▸ Plugins): `usePlugins` runs
`runUpdatePass` once per session, `UPDATE_CHECK_DELAY_MS` after the activation pass,
when `shouldCheckPlugins` says one is due (`pluginUpdateCheckAtom`, `scmjs.plugin-updates`,
`RECHECK_MS` from `editor/updates.ts`). It reads the **registries**, not the rows'
addresses: `checkForUpdate` is two or three unauthenticated GitHub requests against a
limit of sixty an hour per address, and six plugins on every launch plus a dev reload
would spend it and then fail the button itself, while the registry index already carries
each listed plugin's version at its newest tag and is cached for an hour.
`updatesFromRegistries` compares that with `runningVersion` (the loaded manifest, else the
cached one) through `compareVersions`; a listed plugin with no version to compare is
skipped, not asked, and only a plugin no registry lists goes to `checkForUpdate`. What is
found lands in `pluginUpdatesAtom` (`PluginUpdateAnswer`, which also replaced
`InstalledPane`'s local `checked` state), so `updateToast`'s *Plugins…* button opens the
pane with *Update to v…* already on the rows — a registry answer has `preview: null` and
the press makes the check that fetches one, then the ordinary confirmation. `auto`
installs through `installPlugin({ replaces, pin: true, local: false })` after a real
address check (the registry may be an hour stale), and `autoUpdateBlock` keeps it off a
default (they move with the editor's releases — turning one into a startup fetch is
what vendoring exists to prevent, and the desktop works offline), a plugin turned off, one
on a saved copy, and a release whose `needsApi` is past `PLUGIN_API_VERSION`;
`autoUpdateToast` says what was installed, what failed and what was left and why. *Check
all for updates* above the list runs the row checks in sequence. `tests/plugin-updates.test.ts`
drives the pass with `UpdateDeps` stand-ins.
Updating a bundled default installs the
remote pinned spec, which `effectiveInstalls` folds over the default and lets win (that rule
was always there and had no button to reach it), at the cost of the plugin becoming an
ordinary fetch at startup — which `ConfirmPluginDialog` says in place of its "replacing
<commit>" line — so a default whose row spec is no longer the shipped one grows a **Revert**
button: it drops the stored row and `usePlugins` activates the bundled copy again.
`pluginRuntimesAtom` is status/manifest/error per
spec; `usePlugins` (in `App`) keeps the two in step, idempotently per spec. Only
`activatePlugin` used to write that atom, so a listed-but-off plugin was a bare spec in
Manage Plugins until you enabled it — `describePlugin` is the other half:
`resolvePlugin(..., { entry: false })` fetches the one `plugin.json` (no entry probe, no
code, no `import()`) and fills in name/version/description/icon without touching `status`
or `error`, so a plugin the network cannot describe is still merely *off*. One attempt per
spec per store (`forgetDescription`, which `reloadPlugin` calls, asks again); the dialog
triggers it for every row with no manifest, and `pluginManifestCacheAtom`
(`scmjs.plugin-manifests`, built-ins excluded — nothing to fetch and their icon URLs are
build-hashed) renders the next visit from storage while the refresh runs. `PluginRuntime.describing`
and `status: "loading"` both spin the row's badge (`statusLabel`), since a row that
silently rewrites itself when a fetch lands reads as a glitch. Contribution registries
`pluginMenuItemsAtom` / `pluginContextItemsAtom` / `pluginHotkeysAtom` are read by `MenuBar`
(`withPluginItems`, path `"File/Import"` → that submenu after a separator; a `Plugins` menu holds
Manage Plugins…), `MapViewport` and `TerrainPalette` (`plugins/contextMenu.ts#pluginContextRows`,
surfaces `viewport` / `terrainPalette`, the palette got a Radix ContextMenu of its own for this) and
`useHotkeys` (plugin combos first, never while typing). `PluginDialogs.tsx`: Manage Plugins, and
`PluginDialog` — the `DialogFrame` a plugin's `ui.dialog(spec)` mounts plain DOM into (host element
in state, Radix portal timing). `npm run build:plugin-types` bundles the contract into one
gitignored `plugin-api/index.d.ts` and `npm run publish:plugin-types` pushes it to
`github.com/scm-js/plugin-api`, which every plugin repository takes as a devDependency. There is no sandbox: a plugin runs with the page's privileges, and the dialog says so.

`plugins/registry.ts` is Plugins ▸ **Browse Plugins…** (the same dialog, `payload.tab`):
`DEFAULT_REGISTRIES` (`defaults.ts`) plus `userRegistriesAtom` name JSON indexes —
`github.com/scm-js/registry`, generated by an Action from the organisation's repositories
named `plugin-…` *or* carrying the `scmjs` + `plugin` topics (either signal is enough, so listing
is opt-out and the registry's `exclude` list is what holds a repository back) and each plugin's
own `plugin.json` at its newest semver tag (untagged falls back to the default branch), hourly
and on a `repository_dispatch` each plugin repository sends when it changes — which
`parseRegistry` reads into `RegistryEntry`s
(spec canonicalised through `canonicalSpec(parseSpec(...))` so rows match the installed list,
unusable entries dropped and counted), `searchRegistry` ranks and `loadRegistry` caches in
`registryCacheAtom` (`REGISTRY_MAX_AGE` an hour, `registryStateAtom` per-URL status; a failed
refresh keeps the cached list rather than emptying the browser). Nearly every listed plugin is
one the editor already has — the defaults are published from the same repositories — so the pane
splits the results with `groupByInstall` (available first, under headings) behind an All / Not
installed / Installed filter carrying each count, and a row shows its state three ways: the
`.browse-row.is-*` left accent, the one action that fits it (Install / Turn on / Manage, which
switches to the Installed tab and flashes the row through `InstalledPane`'s `focus`) and a
`.plugin-here` line. An entry is only a *spec*:
Install goes through the ordinary `inspectPlugin` → `ConfirmPluginDialog` → `installPlugin`
path, so the manifest is read from the plugin and the pin resolved at install time — a
registry decides what is listed, never what is trusted. `clearStoredDataAtom` resets both
atoms; `.listbox .plugin-row` is shared by the Installed, Browse and Sources lists.
The list is the registries' entries **plus** `registry.ts#unlistedInstalls` — a row per
installed plugin no registry carries, built from the manifest in `pluginRuntimesAtom`,
badged `not listed` and matched on `pluginKey` (passed in, so the module stays free of the
defaults) so a pinned or bundled install is not added beside the entry it is a version of.
Browse is read as the list of plugins there *are*, so a plugin installed from its own
address — or one a registry stopped listing, which is what an `exclude` in
`scm-js/registry`'s `plugins.json` does — went missing from the only place it was looked
for while running perfectly well under Installed. Nothing installed can fall out of the
list now, whatever a registry says, and `BrowseRow` takes the resolved `icon` so those
rows draw the plugin's own.
A row's `v…` is the reader's own version, not the index's (`PluginDialogs.tsx#browseVersion`).
An entry carries the version its index was generated from — the newest *release* — which
in the same grey as Manage Plugins' number beside the same plugin read as the copy being
run, and did not move when the plugin was updated: updating scmjs.dev to 1.1.0 left Browse
saying 1.0.4 until the hour-old cache was refreshed, and then said 1.1.0 for a reason that
had nothing to do with the update. So an installed row prints the manifest version out of
`pluginRuntimesAtom` and names the registry's only when `compareVersions` puts it ahead, as
a `v… available` badge — which is the one time the difference is worth reading, and makes
an available update visible in the tab it is not installed from. `unlistedInstalls` already
built its entries from the same manifest, so the two kinds of row now mean the same thing.
Both the version and the icon come through `runtimeOf`, which looks the runtime up by the
*installed* spec: `runtimes[entry.spec]` never hit for anything pinned, so every installed
row had been falling back to `entryIcon` since the defaults were pinned to tags.

**A vendored plugin cannot hand its own module to a worker.** Found when TrigScript became a default
(2026-09-07): its compile worker `import()`s the compiler by `import.meta.url`, which is the module's
`blob:` URL when the loader fetched the plugin and works from a same-origin worker. Compiled in by Vite,
that URL is the plugin's chunk under `assets/`, and the chunk imports `__vitePreload` from the app's
index chunk (Vite wraps every dynamic `import()`, `@vite-ignore` or not, in it), so importing it in a
worker runs the whole app and dies on `document`. Vite's own chunking cannot be told otherwise from the
plugin, and the plugin must work under both bundlers. The plugin's answer: `dist/compiler.js`, the
compiler bundled alone by its `npm run build`, which the worker fetches from jsDelivr at the plugin's
own version tag when `ENTRY_URL` is not `blob:` (`compile.ts#workerModuleUrl`, `version.ts` — the
one place the version is written as code, test-checked against the manifest), the way Monaco and
TypeScript already arrive. Without that it silently fell back to compiling on the main thread — the
probe is `typeof globalThis.ts === "undefined"` after a check, since only the fallback loads
TypeScript into the page. Any plugin that starts a worker from its own module has the same trap.
