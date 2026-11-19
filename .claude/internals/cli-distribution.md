# Distributing `scmjs`: the npm bundle, single executables, package managers, the GitHub Action

How the command is built and reaches people: one bundled file on npm, one executable per platform on the GitHub
release (with Scoop, Homebrew and winget recipes), and a GitHub Action for map repositories. The release workflow as a
whole is `desktop-releases.md`.

## The npm bundle (`scripts/build-cli.mjs`, `scripts/lib/cli-bundle.mjs`)

- **One file.** `bundleCli` is a Vite SSR build with `ssr.noExternal: true` and `codeSplitting: false` (rolldown's name
  for inlineDynamicImports) → `cli/dist/scmjs.mjs` with a shebang. commander, picocolors, `@scm-js/replay`, `@scm-js/mod`,
  the MCP SDK and the language-server packages are devDependencies of the root bundled in, so **the published package
  has no dependencies and `npx` fetches one file**. TypeScript is the exception, found at run time (`cli-maps.md`).
  `bundleWeigh` builds `cli/dist/weigh.mjs` on its own (the weigher `map cost` hands the map runner, `cli-game.md`).
  The single executable's CommonJS build shares these functions; the npm bundle differs only by the
  `__SCMJS_INSTALL__` define ("npm", folded to constants).
- **The version is the editor's** (`package.json`), written into `cli/package.json` by the build (`cliVersion`) and by
  the release commit; commit and build date are `define`d. `engines: node >=22.12` (commander 15's floor). npm refused
  the plain name `scmjs` (E403 "too similar to scss, sockjs"), hence `@scm-js/cli`.
- **Type-checked** by `tsconfig.cli.json` (in `tsc -b`'s references): `types: node, vite/client`, `cli/src` only (it
  pulls in the `src/` files it imports). **No top-level await anywhere in `cli/src`**: the single executable is
  CommonJS (`main.ts` runs with `void run()`); `tests/cli-binary.test.ts` walks every module with TypeScript's parser for
  an `await` outside a function.
- **The leave-out plugin** (`scmjs-cli-leave-out`): the host (`host/lifecycle.ts`) imports `src/plugins/builtin.ts`, whose `import.meta.glob`
  of every vendored plugin's `plugin.ts` would be inlined whole by `codeSplitting: false` — TrigScript's workspace,
  Aftermath, the AI assistant, React — nearly doubling the bundle. The plugin resolves `builtin.ts` to empty tables
  (as `build-core.mjs` does) and loads a placeholder for the editor's `ko.json`, which `renderChunk` replaces with the
  entries the chunk's modules ask for (`editorCatalogueFor`). **React is not in the bundle, and stays out only while
  nothing the host reaches imports from `src/hooks/`**: a hook file imports React and jotai's hooks, and **aliasing
  `jotai` to `jotai/vanilla` breaks the build** (tried), so the store-level functions the host and
  `services/gameData.ts` need live in `services/` (`documentActions.ts`) and beside their data, and
  `tests/layering.test.ts` fails on an import from `plugins/` or `services/` into `hooks/`.
- **Licences**: the `scmjs-cli-notices` plugin reads the bundle's module ids for `node_modules/<pkg>` and writes
  `cli/dist/THIRD-PARTY-NOTICES.txt` with `cliNotices` (`scripts/lib/notices.mjs`, which **throws on a package with no
  licence file** and looks for `License.txt` as well as the usual names); `cli/LICENSE` is a copy of the root one.
  ATTRIBUTION.md has a table for the CLI's packages and the adapted code (the QR encoder). A new bundled package needs a
  row there.
- **The layering rule** (`tests/core.test.ts`): any `import { … } from "../../src/…"` in `cli/src/**` (recursively)
  must name only what `core/src/index.ts` exports from that module, so the command stays a thin layer over
  `@scm-js/core` and a new need is an export first (`core.md`). Two exceptions: `i18n.ts` → `src/i18n`, and `run.ts` →
  `src/plugins/headless.ts`.
- **`npm run cli -- …`** builds and runs it; the built file is what e2e's link spec and the binary check use. **Never
  commit `cli/dist`.**

## Publishing to npm

`build.yml`'s `cli` job: stable channel only, `build:cli` (stamps the version), checks it equals the release's, skips a
version npm already has, `npm publish` by trusted publishing over OIDC with provenance, like `plugin-api` and `core`.
The first versions were published by hand (a security key: one's own terminal, `--browser=false`); a trusted publisher
can only be set on npmjs.com once the package exists (the 403 trap in `core.md`). The `@scm-js/bot` types publish
from the same workflow (`cli-bots-plugins.md`).

## Single executables (`cli/src/runtime.ts`, `sea.ts`, `scripts/build-cli-binary.mjs`)

Most Windows map makers do not have Node, so the release carries one executable per platform.

- **Node SEA, chosen over `bun build --compile`** (Deno not tried). Both worked: SEA with a V8 code cache started in
  about half the npm bundle's time; Bun with bytecode was faster still and cross-compiles all four targets from one
  machine. **The runners are the lifted game**, and under Bun they would run on JavaScriptCore rather than the V8 the
  play page, the tests and every replay check run on (Math functions and number formatting are implementation-defined,
  so a replay's exactness is not a given across engines); every Node API the command uses is Node's own. SEA's cost:
  three runners in CI and ~120 MB a file (the Node executable; archives are about a third of that).
- **The build** (`npm run build:cli-binary`, `node scripts/build-cli-binary.mjs [--target …] [--archive] [--check]
  [--download] [--no-code-cache]`):
  1. `bundleCli({ install: "binary" })` → `cli/dist/bin/.work/scmjs.cjs`: **CommonJS** (SEA runs only CJS), entry
     `cli/src/sea.ts`.
  2. Per target, the Node executable: this computer's own for the host target, else the official one of **the same
     version** from nodejs.org, checked against `SHASUMS256.txt` and cached in `~/.cache/scmjs-build/node/<version>/
     <target>/` (`SCMJS_BUILD_CACHE`). The build refuses Node < 24.
  3. The blob (`--experimental-sea-config`): `assets: { "weigh.mjs" }`, `disableExperimentalSEAWarning`, and
     `useCodeCache: true` **only when made by the target's own Node** (a code cache is V8- and flag-specific): the host,
     or darwin-x64 on Apple silicon through Rosetta; otherwise a portable blob any Node of that version reads (a Windows
     exe built on Linux runs fine).
  4. `npx --yes postject@1.0.0-alpha.6 … NODE_SEA_BLOB … --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`
     (`--macho-segment-name NODE_SEA` on macOS) — through npx, not a devDependency: postject is in the lock only as an
     optional transitive of electron-builder, and making it direct meant hand-editing the lock. macOS: `codesign
     --remove-signature` before and `codesign --sign -` (ad hoc) after, so **a Mac target needs a Mac**.
  5. `--version` of the result must say the package version (when it runs here). `--archive` packs `scmjs[.exe]` +
     `LICENSE` + `THIRD-PARTY-NOTICES.txt` (the bundle's notices **plus Node's own LICENSE**, fetched from the Node
     repository at that version — V8, ICU, OpenSSL ship inside) into `scmjs-cli-<windows|macos|linux>-<arch>.{zip|tar.gz}`
     (`TARGETS[].asset`) and writes a local `SHA256SUMS`. The zip is written by hand (`zlib.crc32` + `deflateRawSync`; no
     fflate import, which is only transitive via mopaq). Archives rather than bare executables: the exec bit survives a
     browser download and they are a third the size.
  6. `--check` runs `scripts/check-cli-binary.mjs <exe>`: **no `node` or `npm` on PATH** (every PATH folder holding one
     dropped), a temp folder, and most commands end to end — map info from a file and stdin, check, new, dump, find,
     set+diff, unpack+pack, triggers export, a preview refusing a non-game folder, `map run` with a .js plugin, **`map
     build` with TypeScript from a project's node_modules** and without it (the install line), a script run as Node with
     a file Worker (as runners do), `mcp` initialize + tools/list; `--replay <file>` adds the replay commands, `--game`
     adds `map trace`/`map cost` in the game.
- **The archives are named `scmjs-cli-<os>-<arch>`**, not `scmjs-<os>-<arch>`: the desktop installers are
  `scmJS-windows-x64.zip` (electron-builder's `${productName}-windows-${arch}.zip`), and **two release assets whose
  names differ only in case cannot both be in a GitHub release** — the upload got HTTP 404 and gh removed the half-made
  release; on a case-insensitive disk a person downloading both would clash anyway. The file inside is still `scmjs` /
  `scmjs.exe`. `build-cli-binary.mjs`, `scripts/lib/recipes.mjs`, the packaging templates and the install docs all use
  the name; the release job guards asset names (`desktop-releases.md`).
- **What differs at run time** (`runtime.ts`):
  - **`import()` from disk works in SEA on Node 24** (TypeScript, `map run`'s plugin modules, runners).
  - **Runners**: `startRunner` spawns `process.execPath`, which in SEA is scmjs itself. `runnerEnv` adds
    `SCMJS_RUN_AS_NODE=1` (only when the "node" is `process.execPath` and this is the binary); `sea.ts` sees it and calls
    `runAsNode`, which **rewrites argv**: SEA's is `[exe, exe-as-typed, script, …]`, Node's `[node, script, …]`, and the
    runners decide they are the main module by `import.meta.url === pathToFileURL(process.argv[1])`, so `scriptArgv`
    drops index 1 and resolves the script. The CLI is a lazy `import("./main")` in `sea.ts`, so a runner's process never
    builds the command tree. The variable is inherited by the runner's children (as `ELECTRON_RUN_AS_NODE` is); runners
    spawn none.
  - **`weigh.mjs`** (map cost hands its path to the map runner): `assetFile` writes the SEA asset to
    `cacheRoot()/weigh/<version>-weigh.mjs` (compared each run, written via `.part` + rename), reaching `node:sea` through
    `process.getBuiltinModule` — no static import of `node:sea`.
  - **TypeScript**: beside the command means beside the executable in the binary (`locateTypeScript`:
    `<exe's folder>/typescript/lib/typescript.js`), which only the MCP bundle has; the project (cwd) comes first and
    `npm root -g` last. doctor's TypeScript note adds that npm comes with Node.
  - `about` and `doctor` say `single executable[, from Scoop|winget|Homebrew]` and offer `updateCommand(install)`;
    `nodeCheck` is never bad; Claude Code's fix is the package manager's `scmjs` or the executable's own path
    (`cli-shell.md`).
- **CI**: `build.yml`'s `cli-binary` job on three runners, `--archive --check`, artifacts `cli-binary-<os>`; on pull
  requests as a dry run; the release attaches them and writes `SHA256SUMS` over all assets. The CI `cli` job never
  builds executables, and `npm pack`'s prepack empties `cli/dist` first, so none can be published to npm (`cli/dist/bin/`
  sits inside the package's `dist/`).
- **Traps**: postject on Linux prints `warning: Can't find string offset for section name '.note.100'` many times —
  harmless, hidden unless postject fails. **A distribution's own Node may lack the SEA fuse** (postject then cannot
  find the sentinel): `--download` uses the official build for the host too.

## The MCP bundle (`scripts/lib/mcpb.mjs`, `scripts/lib/zip.mjs`)

For people who use Claude Desktop and never a terminal: `scmjs-mcp-<windows|macos>-<arch>.mcpb`, one file the app
installs, asking for the maps folder (`docs/ai-tools.md` "Claude Desktop"). Built by `--archive` for the targets
with `mcpb: true` (Windows, both Macs; Claude Desktop has no Linux build), or for any target with `--mcpb` (to try
one on Linux).

- **`server.type: "binary"`, the single executable itself**, not `"node"` with the npm bundle. The node type would
  be ~5 MB against ~44 MB, but the docs do not say which Node Claude Desktop runs it with (the bundle needs ≥ 22.12),
  and the game's runners spawn `process.execPath`, which under an app's built-in runtime may be the app. The
  executable is the one `check-cli-binary.mjs` already proves, runners included.
- **The manifest** (`mcpbManifest`, `manifest_version` 0.3): command `${__dirname}/server/scmjs[.exe]`, args `mcp
  --folder ${user_config.maps_folder}`, env `SCMJS_STARCRAFT=${user_config.starcraft}` and `SCMJS_MCPB=1`. Maps
  folder required and **without a default**: tried in Claude Desktop on Windows (2026-11-17), a default of
  `${DOCUMENTS}/StarCraft/Maps` was shown in the field as typed, did not count as filled in ("missing required
  configuration, not enabling automatically" in main.log), and the packer's own rules would pass it to the server
  unreplaced. The person picks the folder with Browse; the guide names StarCraft's own. `tools` is the
  server's own list (the CJS bundle run by the build's Node, `askServer`), each description cut to its first
  sentence; the app shows them before installing. `privacy_policies` is scmjs.dev's, since the account tools talk to
  it. `compatibility.platforms` is the one platform.
- **The zip is ours** (`zip` with a per-file `mode`: version made by Unix, external attributes `0o100755 << 16`, as
  `mcpb pack` writes), not `mcpb pack`: the manifest is validated by **`npx --yes @anthropic-ai/mcpb@2.1.2 validate`**
  (pinned, through npx as postject is; not a devDependency, 40 packages for one check). Without the mode a Mac app
  unpacking the bundle would leave the executable unrunnable.
- **The check** (`check-cli-binary.mjs --mcpb`, passed by the build's `--check`): unpack with `readZip` (modes
  applied), fill the manifest as the app does (`appConfig`, a copy of the packer's rules for the variables we use,
  cross-checked by hand against the real `getMcpConfigForManifest`), start it in the unpacked folder with the
  StarCraft folder empty, and ask `map_info` for the maps folder's `ums.scx` by name, a map outside (refused), and
  `doctor` (knows the bundle, no `${user_config…}` anywhere).
- **Asset names**: `scmjs-mcp-` stays apart from `scmjs-cli-` and electron-builder's `scmJS-` in more than case; the
  release's SHA256SUMS covers them like every asset; the upload-artifact path takes `cli/dist/bin/*.mcpb`.
- **The bundle carries TypeScript** (`typescriptFiles("server")`, 65 files, 9.7 MB, 1.7 MB packed): `lib/typescript.js`,
  the standard library from `lib.es2023.d.ts` down (what `libText` walks), a `package.json` of name, version, licence
  and `main` (the version for doctor, and so Node reads the compiler as CommonJS), `LICENSE.txt` and
  `ThirdPartyNoticeText.txt`. A map maker in Claude Desktop has no npm, and `map_build` was closed to them. Only the
  bundle: the archives for Scoop, winget and Homebrew stay as they were (their users have a terminal). Fetching
  `typescript.js` from a CDN at first use was the other way; it needs the network from a server kept to a folder and
  pins nothing. The check writes a script with `map_script_import` and builds it with `map_build`, in two starts (the
  server answers requests as they come, so a build sent with the import raced it).
- Not signed (`mcpb sign` exists; the app shows "not signed" either way for now).

## Package managers (`packaging/`)

- Recipes (`packaging/README.md` is the procedure, "Each release" section): a Scoop manifest (autoupdate, hash from
  `$baseurl/SHA256SUMS` by `$sha256\s+\*?$basename`), winget manifests (zip + nested portable, alias `scmjs`), a
  Homebrew formula (on_macos arm/intel, on_linux intel, `bin.install`, test `--version`, livecheck github_latest).
  `@VERSION@`-style placeholders are filled by `scripts/release-recipes.mjs` (`scripts/lib/recipes.mjs`,
  `tests/release-recipes.test.ts`) into the ignored `packaging/out/v<version>/`.
- `scm-js/scoop-bucket` and `scm-js/homebrew-tap` follow releases by themselves (bucket `excavator.yml`, tap
  `update.yml`, on crons). Both repositories' main needs pull requests, so their workflows push over SSH with a per-repo
  deploy key (`CI_BUILD_KEY`), the workflow token read-only. **Trap**: ScoopInstaller/GithubActions' Excavator sets the
  push URL to HTTPS with the workflow token, so it cannot push past the pull-request rule — the bucket runs Scoop's
  `checkver -Update` in its own steps instead.
- **The release tells the tap and the bucket**: `build.yml`'s `packages` job (stable only, after the release)
  dispatches the tap's `update.yml -f version=` and the bucket's `excavator.yml` with `PACKAGES_PAT` (fine-grained,
  Actions: write on those two), because the crons alone ran hours apart and a release could take most of a day to
  reach the tap. Without the secret the step is a notice and a failed dispatch a warning, never a failed run; the crons
  stay as the net.
- **winget is by hand** (`wingetcreate update … --submit`). A step opening its pull request through a fork's git data
  API was written and taken out at the user's word: it needed a second, classic `public_repo` token. It is in the git
  history (commit ed42402) if wanted.

## The GitHub Action (`action/`)

`uses: scm-js/scm-js/action@v<release>` — GitHub runs an action from a subfolder, so it needs no repository of its own
(the README says how to move it to one: copy the folder, nothing names it). `action/README.md` is its page.

- **A composite action of bash scripts**, not a JavaScript action: nothing to build or vendor, the logic is the CLI's,
  and `scmjs` itself is the dependency. Steps: `find.sh` (version: `latest` → `gh api …/releases/latest`, falling back
  to where github.com's `/releases/latest` redirects; the asset `scmjs-cli-<os>-<arch>` from `RUNNER_OS`/`RUNNER_ARCH`;
  the folder `$RUNNER_TOOL_CACHE/scmjs-cli/<v>/<os>-<arch>`) → `actions/cache` → `install.sh` (download + the
  `SHA256SUMS` line by awk, `sha256sum` or `shasum -a 256`, tar/unzip, `GITHUB_PATH`; `install: npm` writes a two-line
  `scmjs` wrapper around `npx -y -p @scm-js/cli@<v> [-p typescript@<major>]`; `none` checks PATH) → `run.sh` →
  upload-artifact (pictures) → upload-sarif → `report.sh`. **Third-party actions are pinned by commit** with the version
  in a comment (`tests/action.test.ts` holds that).
- **`run.sh` never fails**; it writes `$RUNNER_TEMP/scmjs-action/{body.md,status,changed}` and `report.sh` exits with
  the status *after* the summary and the comment, so a failing check still gets its map's changes shown. **`export
  NO_COLOR=1`** for the whole script: picocolors turns colour on under `GITHUB_ACTIONS`, and the first comment was full
  of escape codes. **Bash 3.2-safe** (a Mac's): no mapfile, globstar or associative arrays.
- **Maps** = `git ls-files -co --exclude-standard -z -- ':(glob)<line>'…` (one glob a line — a line split on spaces
  would break `my maps/*.scx`; default `:(icase)*.scx` etc.), filtered to map extensions and files that exist. git
  rather than bash globs: `**` without bash 4, and ignored folders skipped for free.
- **Check** three or four times (text in a log group, `--format github` for annotations — its exit code is the verdict
  —, `--json` for counts, `--format sarif`); each is ~0.2 s. `problems` = errors + warnings of the new findings +
  `baseline.suppressed`; `new_problems` = the new ones. Baseline: the input, else `.scmjs-baseline.json` if present.
- **Build**: which maps keep a script is `map info --json`'s `script` field; an older scmjs lacks it → a warning,
  nothing built. TypeScript: the repository's `node_modules/typescript`, else `npm install --prefix
  $work/typescript typescript@<major>` and the build run *from that folder* with the map's absolute path
  (`findTypeScript` looks from the cwd; a `-g` install needs permissions it may not have). `TYPESCRIPT` in init.ts is
  held to the scripts by the test.
- **Diff**: base = the input, else `pull_request.base.sha`, else `github.event.before` (all zeros = none), fetched
  with `--depth=1` when the checkout lacks it. Changed maps = `git diff --name-only --no-renames -z <base>` (base vs the
  **working tree**, so a step that edits a map before the action counts) ∩ the maps; a deleted path counts when the
  globs would have taken it. Per map: `map diff --rev` text (exit 0 = "the same map (only the file's bytes differ)"), a
  jq summary of `--json`, and with pictures `--picture --out $work/pictures/<path>.png` drawn on plain ground (the
  runner has no game; `cli-map-pictures.md`). **The comment**: marker `<!-- scmjs-action:maps -->` on line one, found
  with `gh api …/issues/<n>/comments --paginate`, PATCHed or POSTed with `-F body=@file`; posted only when a map changed
  or one exists to edit; details cut at 80 lines a map and ~45 KB in all (GitHub's limit is 65,536). A fork's read-only
  token → a warning, not a failure. Artifact `map-pictures-<job>` (`overwrite: true`; two uses in one job need
  `artifact:`), linked by `artifact-url` (GitHub asks for a sign-in).
- **Tested for real** by `.github/workflows/action-test.yml` (pull requests touching `action/**`, `tests/maps/**`,
  itself): `source` builds the CLI from the branch (`install: none`), changes `tests/maps/melee.scx` and packs a
  scripted copy of ums.scx, runs the action with pictures, SARIF and build, asserts the outputs, the PNG and the
  comment, then runs again and asserts one comment; `release` (binary and npm) installs the newest release, writes a
  baseline with it and runs strict. **A plain YAML description containing `Empty: ` is a mapping** (the first push
  failed on it), so the tests read action.yml and both workflows with js-yaml (present through the tools, skipped
  without). `tests/action.test.ts`: inputs/outputs == the README's tables, pins, scripts exist and pass `bash -n`, and
  init's `with:` keys are inputs.

## Open

- Signing (Authenticode; Developer ID + notarization) — the hook is after the injection.
- Linux arm64 and Windows arm64 executables (SEA needs a runner of each; GitHub has `ubuntu-24.04-arm` and
  `windows-11-arm`). `useSnapshot` for startup, not tried.
- winget submitted automatically.
- The action on macOS and Windows runners (Windows needs `unzip` in Git Bash, which the hosted image has); per-picture
  links (an artifact is one zip, and a composite cannot loop `uses:`); pictures inline in the comment (would need
  hosting outside GitHub); `map coverage` stays out (it needs the game). Check the version the README and docs show at
  each release.
