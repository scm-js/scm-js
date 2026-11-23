# The desktop build, releases and in-app updates

`desktop/main.ts` (Electron, bundled by `desktop/vite.config.ts` into `desktop/dist/*.cjs`, `ssr: true` +
`noExternal` so mopaq and the shared extraction ride along, `publicDir: false`) serves `dist/` under
`app://scmjs/` and the game-data prefixes from `userData/gamedata` first, so the renderer's bundled probe
finds an extraction (which is also why `usePreload` skips `warmRemainingTilesets` on the desktop —
the bytes are on local disk already); the window's size, position and maximized state are remembered in
`userData/window.json` (`readWindowState` / `watchWindowState`, saved 500 ms after the last move or
resize and again on close; an off-screen position is dropped, and a first run with no file opens
maximized) and it is shown on `ready-to-show`, so nothing flashes at the unmaximized size, with
`dist/icon.png` as its icon; a close while the renderer says the map has unsaved changes is held
back and handed to the editor (`guardClose` / `closeIpc`, `src/hooks/useCloseGuard.ts`), with
`before-quit` remembering that the close came from a quit so the answer quits rather than closing
one window; the search order is AppImage dir /
next to the executable / userData / env / the platform's install paths (so two archives dropped beside
the app are found). `preload.ts` is
the bridge, typed in `src/app/desktop.ts`; `tsconfig.desktop.json` type-checks it.

`app://scmjs` being an **origin** is the thing that catches people out. A plugin's `fetch` carries it,
so a server whose CORS allowance lists the web origins alone answers the desktop build and the
renderer discards every reply — indistinguishable, from inside a plugin, from the server being
down (so `ai-server`'s `server.allowedOrigins` and its `/v1/auth/start` `returnOrigin` check list
the scheme, or the scmjs.dev plugin cannot connect from the desktop). The
window-open handler sends anything with an address out to `shell.openExternal` and allows exactly
one kind of window: a **blank named** popup, `window.open("", name)`, which is how a plugin runs an
OAuth sign-in — a browser tab is nobody's `window.opener`, so the callback page would have nothing
to post the session back to. Electron may hand a child window its parent's preload, so the bridge
is not left to that: the window's `additionalArguments` carry `--scmjs-origin=` (the `app://` origin,
or `SCMJS_DEV_URL`'s in dev) and `preload.ts` exposes `window.scmjsDesktop` only when
`location.origin` matches it. The popup is created with none of those arguments and goes on to a
remote origin besides, so it fails that test twice over, and `did-create-window` denies it windows
of its own. Keep it that way — the bridge spawns the game, reads folders and installs updates.

`electron-builder.yml`
packages `dist/` + `desktop/dist/` only (never `node_modules`, never `dist/{tileset,arr,unit,game,scripts}`),
unsigned, with `public/icon.png` as every platform's icon, `electronLanguages: [en-US, ko]` (the 55
Chromium locales were 50 MB unpacked and 12 MB of the zip; they are only Chromium's own strings, the
editor's Korean is in the bundle — but Chromium reports the OS language as `navigator.language`
only when that locale's `.pak` is shipped. Measured with Electron 44.1.1, `LANG=ko_KR.UTF-8`
under WSLg: with `en-US.pak` alone `navigator.language` is `en-US` (`app.getSystemLocale()` still
`ko-KR`), so *Same as the system* shows English on a Korean OS; with `ko.pak` (+126 KB) it is `ko`,
and `de_DE` falls back to `en-US`. A new editor language needs its locale added here) and
`spellcheck: false` in the window's `webPreferences`; Windows gets an NSIS installer and a **zip**,
never electron-builder's `portable` target, whose SFX re-extracts the whole app into `%TEMP%` on every
launch and can only cover the wait with a static `.bmp` painted over the desktop. `public/icon.png`, `public/favicon.svg` and
`components/ui/AppLogo.tsx` are one drawing: the splash's wireframe globe (`splash/starfield.ts`) projected
once at a fixed angle and flattened to four paths grouped by depth, in violet rather than the splash's
pink. `scripts/lib/docs/assets/logo.svg` and `scm-js/site`'s copy are the same paths without the
rounded square, and `public/icon-oauth.svg` is the one variant that is *not* a straight copy: an OAuth
consent screen draws the app's icon at around 32 px inside its own circular mask, where the two faintest
lattice tiers become noise and the rest disappears, so that file is full bleed, drops them and thickens
what is left. `icon-512.png` (Discord's app icon) and `icon-120.png` (Google's branding logo, which
must be exactly that size, under 1 MB and opaque) are rendered from it with sharp and committed, since
nothing in a build reads them — they are uploads to those two consoles, and Google re-runs brand
verification when the logo changes, so settle it before submitting. Battle.net's consent page shows no
icon. Re-render both if the drawing changes. `npm run build:desktop` is `scripts/build-desktop.mjs`: `build --mode desktop` (the mode changes
nothing) + the main bundle + electron-builder, where its arguments pick the packaging
step's platform, architecture and targets (`-- win nsis`, `-- linux AppImage arm64`, `-- --dir`
for an unpacked check, `--skip-web` / `--skip-main` to reuse the bundles on disk, `--` for
electron-builder verbatim); with no arguments it is this OS on `electron-builder.yml`'s targets, which
is what CI runs. The workflow has three channels — `ci` (every push to main and every pull
request against it: lint, tests and the web
bundle built and thrown away, so a broken bundle fails the push that broke it; **nothing deployed,
no installers and no release**. A pull request runs only `channel` and `web`, both
`permissions: contents: read` at the job; `permissions` takes no expressions, so the write scopes
cannot be made conditional at the top and stay on the jobs a pull request never reaches. `plugin-api` runs on `ci` and **publishes to npm**, and a same-repo
pull request gets the secrets and the OIDC identity, so its `if` excludes `pull_request` by name —
any new job that runs on `ci` needs the same), `nightly` (a daily cron, skipped when main has not moved: the
installers on ONE rolling prerelease whose `nightly` tag is force-moved and whose assets are
replaced with `gh release upload --clobber`, never deleted and recreated) and `v*` tags (permanent
numbered releases, the only ones that accumulate).
The `cli` job publishes `@scm-js/cli` to npm on `v*` tags only (its version is the editor's; see `cli-distribution.md`).
The `bot` job publishes `@scm-js/bot` (the bot types) on the same tags when npm lacks `bot/package.json`'s version, which is its own (the major is `BOT_API`) and which the release script does not set (`cli.md`, "`@scm-js/bot`").
**The command as single executables** (`cli-distribution.md`): the
`cli-binary` matrix (ubuntu-latest → linux-x64, windows-latest → win-x64, macos-latest → darwin-arm64
*and* darwin-x64, the Intel one's Node run under Rosetta) runs `scripts/build-cli-binary.mjs --archive
--check` on Node 24 (`SEA_NODE_VERSION`) on the nightly and stable channels **and on pull requests**
(read-only, artifacts `cli-binary-<os>` only — the third job a pull request runs, which the header
comment says; pushes to main skip it). `release` needs it beside `desktop`, downloads
`{web-zip,desktop-*,cli-binary-*}`, and writes **`SHA256SUMS` over every asset** (installers too)
before `gh release create`/`upload --clobber`; Scoop's autoupdate reads the zip's line from it. So a
failed executable blocks the release as a failed installer does. The recipes the user publishes are
`packaging/` (Scoop bucket, winget-pkgs, Homebrew tap; `packaging/README.md`), filled per release by
`scripts/release-recipes.mjs <version>` from that SHA256SUMS. The `packages` job (stable, after `release`) has the tap and
the bucket take the version at once (`cli-distribution.md`, "The release tells the tap and the bucket"); winget is by hand. No macOS capacity trap is recorded
here: the matrix uses the same `macos-latest` label as `desktop`, one Mac job per run, not a second
(Intel) Mac runner.
**Both hosted builds are releases**: the `pages` job serves the *tag* at `editor.scmjs.dev` (main's
HEAD would be the one artifact whose version nobody could get back to) — which needs the
`github-pages` **environment** to allow the tag: a deployment policy listing the `main` branch alone
rejects the deploy in two seconds with "Tag vX.Y.Z is not allowed to deploy to github-pages due to
environment protection rules", after everything else in the run has passed. The
policy carries a `v*` **tag** rule beside `main` (Settings ▸ Environments, or
`gh api -X POST repos/<owner>/<repo>/environments/github-pages/deployment-branch-policies -f name='v*'
-f type=tag`), and a fork serving its own editor has to add one too. Nothing in the repository can
say this, which is why it is here. The
`nightly-site` job, with the repository variable `NIGHTLY_BASE=/nightly/` (and `NIGHTLY_HOME`,
default `https://scmjs.dev`), puts **a second build of the same commit** — `SCMJS_BASE=/nightly/`,
`SCMJS_SITE=nightly` — into the `nightly/` folder of one force-pushed orphan commit on
`scm-js/nightly`'s `gh-pages` branch, carrying the `CNAME` (still `nightly.editor.scmjs.dev`, the Pages
origin). The front-door worker answers `scmjs.dev/nightly/*` from that folder (and falls back to its
`index.html` for paths with no file, as Pages does at the root). The branch's root holds
`scripts/nightly-site/redirect.html` as `index.html` and `404.html` — the old address is grey (see
below), so a page is the only way to send its visitors on — and `moved.html`, the static hand-off
page `src/moveIn.ts` frames from the nightly (`OLD_ORIGIN` is the old nightly address in that build).
Why a path of the site: `/play/` (the engine, served from R2 by the worker) exists only on
`scmjs.dev`, and scm-sim's `simAddress` looks for it on the editor's own origin — the nightly at its
own domain had no engine, so no Aftermath analysis, Game view or Test Map. On the shared origin the
nightly keeps its storage apart (`src/site.ts`): `browserStorage()` is `namespaced(localStorage,
"nightly")` (`scmjs.x` ↔ `scmjs-nightly.x`, `scmjs-moved` ↔ `scmjs-nightly-moved`; its listing hides
the stable keys), and the handle/recovery database is `scmjs-nightly`. Game data is shared: the nightly installs
at the OPFS root like the stable editor, because `/play/` (Test Map, Aftermath's analysis) reads
copies only from there — under `nightly/`, Test Map asks for the game again. A nightly that finds a stamped copy left under `nightly/` copies it up when the root
has none of that data set (file by file, stamp last — headless Chromium has no
`FileSystemHandle.move`; where the copy fails the data is installed again) and removes the folder. The cost: a nightly that changes the copy's layout or stamp changes it for
the stable editor too, so such a change has to stay readable by the last release. Plugins' own IndexedDB databases (Aftermath's kept casts) are shared. Without
`NIGHTLY_BASE` the job falls back to the old layout: the nightly web zip at the domain's root. Both Pages sites answer an
unknown path with the bundle's `404.html`, which the `scmjs-404` step in `vite.config.ts` copies
from `index.html` — that is how a shared map's `/share/<invite>` link opens the editor (status 404,
but the page runs). The job also writes `<meta name="robots" content="noindex">` into both pages,
so a search finds the stable editor and never the nightly (a `robots.txt` Disallow would stop a
crawler reading that tag, and GitHub Pages cannot send an `X-Robots-Tag` header). `index.html`'s
own description and Open Graph tags are for a link to the editor itself; the
`cloudflare-link-previews` worker strips them from a `/map/` or `/share/` page before writing the
map's in, and sends those pages with `X-Robots-Tag: noindex` — deploy the worker change before an
editor release carries the tags, or a map card shows the editor's title.

**Each hosted deploy carries the earlier builds' `assets/`** (`scripts/keep-old-assets.mjs`): a Pages
deploy, and the nightly's force-pushed commit, replace the whole site, and every chunk is named by
its hash, so a tab opened before a deploy fails the first `import()` it had not made yet — the
"TypeError … in me … in pm" counted in 0.16.0 was a dialog chunk of 0.16.0 asked for after 0.17.0
went out. The site carries `asset-versions.json` (`{ versions: [{ version, files }] }`, newest
first); the `web` job (stable, after `Build (Pages)`, with `pages: read` to ask the Pages API for
`html_url`) and `nightly-site` (against `NIGHTLY_HOME`+`NIGHTLY_BASE`, sparse-checkout widened to
the script, cone mode off) read it from the live site, download the newest three earlier
builds' files not already in `dist`, and write it again with this build on top. Without a list
(the first deploy after the script landed) it crawls the live pages and every chunk they name
(`referencedAssets`, which found 145 of 145 in 0.16.0's artifact, the three missing until the
pages besides `index.html` were seeds). It never fails a deploy; a missing file, or one served
as `text/html`, is dropped from the list. Paths in the list are checked against
`assets/<name>` before anything is fetched. ~12 MB a release, so four builds stay well inside
Pages' 1 GB. The editor's side of the same failure (`ChunkLoadError`, the Reload notice) is in
`viewport-ui.md`.

**`editor.scmjs.dev` is proxied through Cloudflare (orange cloud, SSL Full)**
for the link-preview Worker (private repo `scm-js/cloudflare-link-previews`, deployed as
`scmjs-link-previews`). The Worker runs only on `/map/*` and `/share/*` (zone routes, fail open):
it fetches the Pages page, asks `api.scmjs.dev/v1/previews/…` what the link is, writes Open Graph
tags into the head and makes the status 200. It rewrites only a page containing
`id="boot-splash"`, so **keep that id in `index.html`**, or the cards silently stop. GitHub's own
"File not found" (a deploy without `404.html`, like tag v0.4.0) passes through untouched.
**`nightly.editor.scmjs.dev` must stay grey**: the free Universal certificate is `scmjs.dev` +
`*.scmjs.dev`, one level only, and proxying the two-level name failed the TLS handshake outright
(tried). Its routes exist but do nothing. After a proxy change, check the Pages
settings still show the custom domain's certificate as fine (Pages renews by seeing its own IPs). nginx and the dev server fall back to `index.html` on their own. The nightly prerelease's notes
carry a paragraph linking that site — the release page is the only thing most people open, and the
site is the same run's zip, so it is the cheapest way to try a nightly. That paragraph is written
only when `NIGHTLY_DOMAIN` *and* `NIGHTLY_PAT` are both set (`SITE:` in the `release` job's env is
that pair collapsed to the domain-or-empty; the secret is tested in the expression rather than put
in the environment), which is exactly the condition `nightly-site` deploys under — a fork whose
nightly site was skipped must not be offered a link to a site nobody pushed. Rolling the site back is
dispatching build.yml on an older tag. The nightly namespaces its storage so that it keeps its own
preferences, plugins and recents rather than writing a stored shape the stable build reads back.
Repository variables `PAGES_BASE` (`/` for a custom domain; when it is not `/` the `web` job builds
a second time for Pages) and `NIGHTLY_DOMAIN`, secret `NIGHTLY_PAT` (Contents: write on
`<owner>/nightly`, the `PLUGIN_API_PAT` shape); the nightly deploy skips with a notice without them.
**The hosted editor is at `scmjs.dev/editor/`** (served there once `PAGES_BASE` is
`/editor/`, the worker is deployed and `scmjs.dev` is proxied). One origin with the site, because
OPFS game data and `localStorage` (the sign-in among it) are per origin and the site is to show and
manage both. Nothing in the editor is path-aware beyond Vite's `base` (and `site.ts#onSite`,
which reads the page's address to decide whether the site's items go in the menu bar — `viewport-ui.md`): `SCMJS_BASE` also
serves forks, game data is fetched under `import.meta.env.BASE_URL`, and the plugins' link
helpers take the base off the page's own path. The parts:
- **Pages** stays this repository's site on `editor.scmjs.dev`, built
  a second time for `/editor/` (`Build (Pages)`), so the hosted bundle is not the release zip
  byte for byte; it differs in the base path alone. The browser tests run before that second build,
  at the root; `SCMJS_BASE=/editor/ npm run build`, `vite preview` with the same variable and
  `SCMJS_E2E_URL=http://localhost:<port>/editor/` run them under the path (the fixture matches game
  data paths under the base for that).
- **The worker** (`scm-js/cloudflare-link-previews`, the editor's front door) answers
  `scmjs.dev/editor*` by fetching `editor.scmjs.dev` with the prefix taken off, and does the cards
  on the way. On `editor.scmjs.dev/*` it takes the prefix off too — the `/editor/` build is deployed
  *before* the old address redirects, and the page there asks for `/editor/assets/…` — until its
  `MOVED` variable is `"1"`, when it answers 301 to the new address, path and query kept. Order:
  worker (MOVED 0) and the proxy → `PAGES_BASE` → a release → check the new address → MOVED 1.
  Any other order leaves one of the two addresses asking for assets that are not there.
- **`src/moveIn.ts`** brings the `scmjs.` keys of `localStorage` over from the old origin, once: a
  hidden frame on `editor.scmjs.dev/moved.html` (the worker's own page, `frame-ancestors` and the
  `postMessage` target both `https://scmjs.dev`) posts them back, and keys already present at the new
  address are kept. `main.tsx` imports it second and it ends in a top-level `await`, which is what
  holds every later module — the ones that read storage as they are evaluated — until the answer is
  in (`e2e/moveIn.spec.ts` checks the first paint is in the old address's language). It runs only
  when `location.origin` is `https://scmjs.dev`, so the desktop app, the nightly, a container and
  the dev server never wait. Its two marks (`scmjs-moved`, `scmjs-moved-tries`) are **not** under
  `scmjs.` on purpose: Clear all data removes that prefix, and the next visit would bring everything
  back. It gives up after three visits with no answer (4 s each). The two origins are one *site*, so
  the frame's storage is not partitioned in Chromium, Firefox or Safari — reasoned, not yet seen
  outside headless Chromium. OPFS game data and IndexedDB (file handles) are not carried.
- The server's `AI_SERVER_ALLOWED_ORIGINS` must include `https://scmjs.dev`, and the sign-in
  provider's redirect list whatever it holds for the old origin.

**Analytics** are our own visit count plus Cloudflare Web Analytics beside it (for comparison
while the own count beds in). The own count: a second inline script in `index.html`
loads `/_e.js` when the host is `scmjs.dev` (stable and nightly both — same origin), and
`render.mjs` loads `https://scmjs.dev/_e.js` on `docs.scmjs.dev`. The script is the front-door
worker's (`cloudflare-link-previews`, `tracker` in `worker.js`), which also relays what it sends
(`/_e`) to ai-server's `POST /v1/hits` with the IP/UA/country/region in headers; ai-server hashes
IP+UA with a memory-only salt rotated at UTC midnight and shows it all in `/admin`'s Visitors
section. The script keeps `scmjs.visits` in localStorage (last UTC day/week/month + first week;
flags on a view give weekly/monthly/new without an ID) — labelled "Visit count dates" in
Preferences ▸ Browser storage and left out of preferences export.

**Feature counts** (on by default, the user's decision): `services/usage.ts` `count(name,
props)` gathers lines for 2 min (same name+props → one line with `n`) and hands them to
`window.scmjsHits.track`, which batches up to 20 a beacon; nothing unless `location.hostname` is
`scmjs.dev` (not `HOSTED_SITE`: the stable build is also the zip, container and desktop bundle). Props are words from fixed lists only — never a file/map name,
typed text, or a non-scm-js plugin's id (`pluginCountName` → `other` unless `github:scm-js/…`,
`builtin:`, or listed in the *default* registry). An scm-js plugin is its repository name without `plugin-`, so `github:scm-js/plugin-aftermath` and the bundled `builtin:aftermath` are one row, `aftermath` (ai-server folds older rows the same way). Hook sites: `openDialogAtom` (`dialog`),
`commitEditAtom`/`commitTriggersAtom`/`commitSettingsAtom` (`edit`: `layer`, `part` — `entryParts` joined, plus `pins`, so a Pin stroke is `pins` and not `other` — `mode` on the terrain layer, `symmetry`, and `tool` = the entry's `HistoryEntry.tool`, an `EditTool` word set at the commit site wherever the layer and the terrain tab do not already say what made the edit: `block`/`copied`/`borrowed`/`fill`/`fillMap`/`replace`/`healArea`/`pin`/`unpin`/`pinArea`/`unpinArea`/`pinHandLaid` in `useTerrainTools`, `stretch`/`asTerrain`/`twin` in `useDoodadTools`, `cut`/`delete`/`paste`/`pasteStretch` in `useClipboardTools`, `plugin` in the host's `finishEntry`; a plain brush stroke has none. Without it, stretch, twins, paste stretch, copied and borrowed terrain and blocks are indistinguishable from a plain edit on their layer. **A new tool that commits through an existing mode needs a word added to `EditTool`** — never the label, which carries a doodad's or a clip's name. Nothing reads `tool` to apply, undo or send an edit), `countView` (`view` `{ flag, on, via }`: a View tick the person switched — `toggleFlagAtom` for the menu, toolbar and key (`via: view`), the Heal/Pin/Fog palettes' own checkboxes (`palette`), the Layers panel's eyes (`layers`), the Symmetry dialog (`dialog`). Called at the sites, not from a subscription on `viewFlagsAtom`: `useAutoShow`, `useApplyPreferences`, the scrambled-locations auto-hide, `gameData.ts` and a plugin's `setFlags` write the flags too and are not the person's), `countPlacedUnits` from `commitEditAtom`'s `countEdit` (`unit.place` `{ unit }` = the units.dat id, never `unitName`, which a mod's data can set to anything; ids ≥ 228 → `other`; pure adds only, and `count`'s third argument `times` puts a stroke's 40 Zerglings on one line as `n: 40` — for a public `/stats` page, whose served-side shape is ai-server's and not this repo's), undo/redo, resize, tileset,
`openFileInto`/`newMapInto`/`saveDocument` (`map.open/new/save/build`), `services/mapBuild.ts`
(`map.build.refused` `{ step, plugin }`: a plain `Error` from a plugin's step, its message to the
user, which is not an `error`), Test Map, `api.sync.start`
(`map.share`), the host's menu/context/hotkey `run` wrappers + map buttons (`plugin.use`), file
types (`file.open`), replays (`replay.open` via `countReplays`: file types, the host's `pickFiles`, and a window capture-phase `drop` listener in `useUsageCounts` that sees drops on plugin panels too; deduped by name+size+date for 10 s), installs/toggles, `adoptSource` (`gamedata`; and `map.dataset` `{ mod }` through `countDataSetChange` when the mod in use changes — `modOf` = the profile's name, one line ≤ 40 chars, null for the game's own, StarEdit's download and Remastered, so `none` when back to the game's — plus `mod.add` `{ how: "editor", mod }` in `installDataSetInto` when the copy is a mod, the same line scm-sim's play page sends with how drop/pick/handed/link; `start` carries `mod` when a mod is in use), `log()` at error (`error`: `area`, `type` = `errorKind` — with mopaq's `kind` from a fixed list when the error or its `cause` is an `MpqError` (`MpqError: HashTableFull`, `MapLoadError: MpqError Corrupted`; added 2026-11-19 after a 0.17.0 save failure counted as a bare `MpqError`), never its `detail` —, a caller's
`counted` words — `step` save/prepare/build/pack and `plugin` on the document's three; on the
host's plugin sites `plugin` = `pluginName(spec)` and `step` = `load` (fetch, API
check, import, `resolveActivate`) / `activate` (the plugin's own `activate`) / `deactivate` /
`command` (owner found through the runtimes by `pluginId`) / `button` (map button) / `applies`
(a build step's `applies()`); `useErrorCapture` sends `step` `uncaught` / `rejection`, and for an
`ErrorEvent` whose `error` is null `type` = `messageKind(message)`: `cross-origin`
("Script error."), else `string` (the ResizeObserver notice is a log warning and not counted
from the release after 0.18.0, so a `ResizeObserver` row is from 0.18.0 or earlier) — and
`frame0`…`frame5` from `stackProps` (and, for a render error, the catching boundary's
`surface`; `type` is `ChunkLoadError` for one of the editor's chunks that did not download,
`app/chunks.ts`, rather than the browser's bare `TypeError`): an identifier-only function name and the file:line:col for the
editor's own origin or a `raw.githubusercontent.com/scm-js/…` plugin file, the `blob:` mapped back
through `noteModuleSource` in `browserLoaderDeps`; any other code is `plugin`/`other`; never the
message. A render error (`logRenderError`) counts its own stack and React's component stack
apart (`log`'s `countFrom`): up to three frames go to the components, `in Xy file:line:col`,
because a commit-phase error's own frames are all react-dom (a NotFoundError seen in the counts
was five of them and named no panel). `translated: true` when `pageTranslated()` — Chrome's
`translated-ltr/rtl` on `<html>`, a `<font>` or Edge's `_msttexthash` inside `#root` — since a
translator moving text React owns is the usual cause of that NotFoundError. `domGuard.ts` skips
those calls with a log warning instead (`viewport-ui.md`), so a NotFoundError still counted comes
from a DOM call the guard does not cover. ai-server's `propsOf` keeps 16 keys of 100 chars, hence one prop a frame; at most 6 lines
with frames wait at once (`MAX_STACKS_WAITING`) so a 20-line beacon stays under the worker's 16 KB.
The frames point into the minified bundle, and no source maps are published: to read one, download that release's
`github-pages` artifact from its Build run (`gh run download <id> -n github-pages`, `tar xf artifact.tar`) — its chunk
names are the hosted ones, which the release zip's are not (another base path) — and look at the line:column), Preferences Apply (`preferences`, value only when boolean), `useHotkeys` (`key`), MenuBar
items whose label `isOwnText` (`menu` — a recent file's name is not a catalogue key so never
sent), and `useUsageCounts` (`start`, `plugin.running`, layer/terrain mode/symmetry/map view
subscriptions). A new count must keep to that rule; the privacy page and the guide describe it.
The switch is `Preferences.counting` mirrored to the unprefixed `scmjs.counting` = `off` (the
script reads it; the site's privacy page button writes it too), and at startup the preference
follows that entry, not the other way round. Cloudflare's part: an inline script in `index.html` loads the beacon when `location.hostname` is
`scmjs.dev` (the site's own token, the editor being a path of it), `editor.scmjs.dev` (while it still serves) or `nightly.editor.scmjs.dev`, and
`scripts/lib/docs/render.mjs` does the same for `docs.scmjs.dev`. The switch is the hostname and not
a build flag because the stable Pages site *is* the release zip, the container image and the desktop
bundle (`scmjs://`), and none of those may report. The "real users" figure is the game data
forwarder's own count of `HEAD /StarEdit.zip` (one per install started, web only — the desktop goes
to Blizzard directly), written to its Analytics Engine dataset. The site's privacy page has to
keep saying what is counted.
A `v*` tag also pushes the **container image**: the `image` job downloads the `web` job's own zip,
unzips it and builds `docker/Dockerfile` (nginx + `docker/nginx.conf`, no `RUN` step, so
`linux/amd64,linux/arm64` is one buildx manifest and needs no QEMU) to `ghcr.io/<repo>` as `latest`,
the version and the moving `X.Y` / `X`; nightlies publish none, since `latest` is what a `docker run`
takes without asking. `.dockerignore` cuts `dist/{tileset,arr,unit,game,scripts}` out of the context
and the nginx config 404s those paths, so no image can carry Blizzard's data and a container starts at
step 4 of the resolver — mounting an extracted tree over them is how to serve your own.
`npm run build:image` is the local build, and `release.yml` builds and *serves* the image in its
pre-flight, before it tags.

**Plugin runtimes** (`scripts/bundle-plugin-runtimes.mjs`). Vendoring compiles the
defaults' *source* in, but a plugin's runtime is not source (eudplib's was Pyodide + a wheel + its
`dist/worker.js`, ~15 MB, fetched from jsDelivr on first use — a network dependency in the desktop
app and an intranet container); no default carries one today. The script reads `runtime.json` at each pinned default's
tag (raw.githubusercontent; a 404 means the plugin carries nothing), validates it
(`checkManifest`: one-directory plugin/version names, paths that cannot leave their folder,
https sources only), caches the files in the gitignored `plugin-runtimes/<owner>-<repo>@<ref>/`
(`runtime.json` written last, so a half fetch is refetched) and copies them into
`<dist>/plugin-runtime/<plugin>/<version>/` with the manifest beside them. It runs in
`build-desktop.mjs` *after* vite (which empties `dist/`), in build.yml's `image` job after the
zip is unpacked, in release.yml's image check (which also asserts `.mjs` is served as
`text/javascript` and `.wasm` as `application/wasm` — `docker/nginx.conf`'s `/plugin-runtime/`
location sets `types` itself rather than trusting nginx's mime.types), and in `build:image`.
**Never** in the `web` job: Pages and the nightly site are the web zip, and 15 MB per user is
the CDN's to serve, not Pages' 100 GB/month. `SCMJS_SKIP_VENDOR=1` skips it too. On the plugin
side (as `plugin-eudplib`'s `findBundled` did) it asks for `plugin-runtime/<plugin>/<its own version>/runtime.json`
relative to `document.baseURI` at activation, so an updated plugin whose version the editor
does not carry goes back to the CDN (and on Pages that is one 404 per session). Verified
end to end with the image in headless Chromium and jsDelivr blocked. The desktop's `app://` path was not
run under Electron; it is the same same-origin fetch through `protocol.handle`.
The download buttons on the site are plain hrefs to
`/releases/latest/download/<asset>`, which GitHub redirects to the newest **non-prerelease**
release — so the nightly is invisible to them and nothing needs updating when a version ships;
that redirect resolves a fixed file name, which is why `electron-builder.yml`'s `artifactName`
carries no version (`scmJS-windows-x64-setup.exe`, `scmJS-linux-x86_64.AppImage`, …). Its
`publish:` block is what makes electron-builder write `latest*.yml` beside the installers and
bake `app-update.yml` into the asar — the feed the in-app updater reads; `--publish never` still
means it uploads nothing itself. The version is
`package.json`'s and nothing hardcodes it: `vite.config.ts` defines `__APP_VERSION__`,
`src/version.ts` is what the splash and the About dialog read, CI `npm version`s the field
from the tag (or `<package.json version>-nightly.<date>.<run number>` on main — the run number,
not the SHA, because semver compares alphanumeric identifiers lexically) before building, and
electron-builder writes it into `latest*.yml`. A release is cut by the **Release** workflow
(`.github/workflows/release.yml`, manual dispatch), never by hand: it refuses to run off main,
over an existing tag, or backwards past the last release, runs lint/tests/build *before*
writing anything, then commits the release version (the whole diff is `"version"` in
package.json, the lock, cli/package.json and core/package.json — the npm packages carry the editor's version, and
stamping it only at build time leaves the committed files stale; skipped when it already says it) and annotates `vX.Y.Z` on that
commit. It then **dispatches** build.yml on the tag — one dispatch is the whole release, hosted
editor included — because a push made with `GITHUB_TOKEN` starts no workflow run while
`workflow_dispatch` through the API is the exception. A tagged release's notes are `docs/releases/<version>.md` — committed on main
beforehand, read by build.yml's release job out of the tag's own tree (the full three-part
version names it, so cutting `0.3` reads `0.3.0.md`) — or the Release form's `notes` input,
which wins over the file and is passed on as a build.yml dispatch input, so it lives only in
the release; either goes above GitHub's `--generate-notes` list, and with neither the release
carries that list alone. Nothing is required: the pre-flight prints what it found (a dry run
shows the release's body) and says so as a notice when there is nothing.

There is deliberately **no** step moving package.json on to the next version:
`scripts/next-version.mjs` derives what a nightly is called from the release tags instead — a
patch bump of the newest one (`tests/next-version.test.ts`; no tags means nothing has shipped,
so package.json stands; a prerelease tag answers with its release version). A nightly must
sort above the release it follows, or the updater offers a downgrade it cannot install, and
below the release that comes next, or it offers nothing until that version ships; a patch bump
is the only choice that can never be too high, so nothing has to be decided in advance about
whether the next release is 0.9.0 or 1.0.0. That leaves package.json meaning the **last
released version**, which is true without anyone maintaining it.

### What's New (`src/app/releaseNotes.ts`, `app/bundledReleaseNotes.ts`, `WhatsNewDialog.tsx`, `hooks/useWhatsNew.ts`)

Help ▸ What's New… (`DialogId` `"whatsNew"`, its own chunk; the About
dialog's version line opens it too) shows `docs/releases/*.md` — the files the release job
already reads — **bundled at build time**, not fetched: `app/bundledReleaseNotes.ts` is an eager
`import.meta.glob(…, "?raw")` reached only through `import()` (the dialog's chunk and the
hook's delayed import), ~27 KB that never touches the startup path. Bundled rather than
asked of GitHub so it works offline, has no rate limit and always describes the running
build. Both builds, web included — the web build updates silently and has no other way to say so.

`app/releaseNotes.ts` is the pure part (`tests/release-notes.test.ts`). It reads a
deliberate subset of Markdown into a tree React draws — no `marked` (a dev dependency of
the docs site only) and no `innerHTML`; only `http(s)` links become links. The test parses
every committed notes file and fails on syntax the reader would show raw, so the subset is
enforced on the writer (`docs/releases/README.md` says which). A `## For plugin authors…`
section is folded.

Which notes a build shows is `notesVersionFor`: the newest file no newer than the build's
own release number. A nightly is a patch bump of the last tag, so it lands on the last
release's notes (the user's call: nightlies show the last notes for now); a
notes file committed ahead for a later minor is not shown until that version is the build.

The notice is a toast for the update check's reasons (above), raised once by `useWhatsNew`
5 s after mount, no `ttl`. `whatsNewSeenAtom` (`scmjs.whatsNew`, in `STORED_RESETS` /
`RELOADS`) remembers the **notes'** version, not the build's — comparing builds would
announce the same notes every night on the nightly line. It is written when the toast is
raised and when the dialog is opened. With nothing remembered, `shouldAnnounce` tells only
a *returning* user (any other `scmjs.*` key present, sampled at mount before the plugins
write theirs), so an existing user is told and a fresh install starts quietly. The notes are English only; the dialog chrome is translated.

Not done: the update dialog does not show the *incoming* version's notes (`UpdateInfo.notes`
is carried from electron-updater and unused by `UpdateDialog.tsx`).

### In-app updates (`desktop/updater.ts`, `src/app/updates.ts`)

Desktop only. `desktop/updater.ts` is `electron-updater` over the releases the workflow publishes
(required lazily — Rollup keeps it behind a memoised factory — since `main.ts` is on the critical
path to the first frame); `app/updates.ts` is the pure state machine and every string shown
(`stateFrom`, `headline`, `canDownload`, `shouldCheckOnStart`, `tests/updates.test.ts`);
`atoms/updateAtoms.ts` holds one answer for the whole app; `hooks/useUpdateCheck.ts` is the startup
check and the single subscription to the updater's progress/downloaded/error events;
`UpdateDialog.tsx` is Help ▸ Check for Updates…. `Preferences.updates` is `{ checkOnStart, nightly }`,
the row shown only when `isDesktop()`.

Finding an update raises a **toast**, not a dialog — the check lands seconds after launch and two
dialogs already open themselves then (Game Data, the Repair plugin), so a third would queue behind
them. `Toast.action` (the one button a toast may carry) opens the same dialog the Help item does, and
the toast has no `ttl` so it waits rather than expiring behind the splash. `autoDownload` is false
and installing goes through `guardedAction(store, …, "quit")` — the window close button's gate —
before `quitAndInstall`.

`UpdateSupport` keeps *checking* and *installing* apart, and both answers come from the updater
rather than from `process.platform`: `support.check` is `isUpdaterActive()`, because `AppImageUpdater`
(chosen for any Linux build with no `package-type` file) refuses when `APPIMAGE` is unset and then
`checkForUpdates()` resolves **null** instead of throwing — reading that as "up to date" is the lie
`check()` maps to `unsupported`. `support.install` is false only on macOS (Squirrel.Mac verifies the
code signature; unsigned cannot apply an update), where the dialog offers the release page instead of
a progress bar. **The nightly feed is read directly**: with `allowPrerelease`,
electron-updater's GitHub provider walks the releases feed and follows only tags that parse as
versions (and only alpha/beta channels past a prerelease current version), so the rolling
`nightly` tag is never chosen for a build that is itself a nightly — the check finds nothing.
`check()` calls `setFeedURL` each time: nightly → `{ provider: "generic", url:
".../releases/download/nightly" }` (the `latest*.yml` there names version-less assets that resolve
beside it), stable → the GitHub provider (releases/latest). And an update is
`result.isUpdateAvailable` (semver-greater), not "a different version", which offers a release to
a newer nightly with the line switched off: a downgrade. Verified against the live feeds with
`NsisUpdater` + `forceDevUpdateConfig` under Electron for an older nightly, 0.5.0 and the current
nightly, nightly on and off. A build older than the direct read cannot find the nightly by itself:
install it once from the release page. `message()` trims electron-updater's errors, which otherwise carry the whole HTTP
response — headers and `Set-Cookie` — into the dialog.

**A release asset name must not collide with another's case-insensitively.** gh's upload of the second gets
`HTTP 404` and gh removes the release: v0.12.0 has no release page for that reason (the command line's
`scmjs-windows-x64.zip` and the desktop's `scmJS-windows-x64.zip`; everything else of 0.12.0 published — Pages, docs,
npm, image — and 0.12.1 is the release with the page). The command's archives are `scmjs-cli-<os>-<arch>` for it
(cli-distribution.md). The release job's step "Asset names differ in more than case" (`ls assets | sort -f | uniq -di`) fails the
job with the pair named, before the checksums and `gh release create`. It runs only where the release job runs (a
tag, a dispatch, the nightly — not a plain push to main), so a pull request cannot see a clash; the header of
`scripts/build-cli-binary.mjs` says why the command's archives are `scmjs-cli-…`.
