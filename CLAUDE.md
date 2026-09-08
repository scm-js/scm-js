# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based StarCraft 1 / Brood War map editor (React 19 + Vite + TypeScript + Jotai), modelled on
StarEdit / SCMDraft 2. It opens real `.scm`/`.scx` maps (MPQ archives via `mopaq`), renders terrain from
the game's own tileset graphics, and writes playable archives back. `README.md` is the map-maker's
guide (what each layer does, and the table of what is and is not implemented) — read it first; the
technical companions are `docs/file-formats.md`, `docs/game-data.md`, `docs/plugins.md` and
`docs/development.md`. Keep all five current when behaviour changes — they are also the
documentation *site* (`npm run build:docs` → docs.scmjs.dev), which renders them rather
than holding anything of its own.

## Where the details are

This file is the always-true part. Everything else is in `.claude/internals/`, one note per area,
each holding the design, the reasons and the measurements behind it. **Read the note before
changing code in its column** — the notes are largely records of decisions that cost something to
reach, and the traps in them are not visible from the code.

| Working on | Read first |
| --- | --- |
| `src/formats/chk/**` — the container, the section registry, `scenario.ts`, `create.ts`, `mpq/scm.ts` | `chk-format.md` |
| `src/editor/{terrain,isom,blend,symmetry}.ts`, `useTerrainTools`, `data/isomTables.ts` | `terrain.md` |
| `src/editor/{sprites,locations,fog,doodads}.ts` and their hooks, `viewport/fog.ts` | `objects.md` |
| `src/formats/{dat,units}/**`, `src/editor/{units,placement}.ts`, `useUnitTools`, `data/units.ts` | `units.md` |
| `src/editor/{clipboard,history}.ts`, `useClipboardTools` | `clipboard.md` |
| `src/editor/{settings,cuwp,tileset}.ts`, `sections/{players,settings,cuwp}.ts`, the Scenario menu's dialogs | `settings.md` |
| `src/editor/{strings,sounds,switches,textColors}.ts`, `formats/wav.ts`, `audioConvert.ts`, `ui/ColorCodes.tsx` | `strings-sounds.md` |
| `sections/triggers.ts`, `data/triggerDefs.ts`, `formats/triggers/text.ts`, `src/editor/triggers.ts`, trigger claims | `triggers.md` |
| `src/editor/save.ts`, `services/mapIo.ts`, `saveDocument`, `SaveMapDialog` | `saving.md` |
| `src/editor/{resize,validate,find,exchange,statistics,startLocations,sections}.ts`; adding an `atomWithStorage` | `editor-operations.md` |
| `src/editor/{log,diagnostics}.ts`, `DebugConsole`, `useErrorCapture`, adding a log line anywhere | `logging.md` |
| `src/i18n/**`, `scripts/i18n.mjs`, `ko.json`, any user-visible string through `t()`, `api.i18n` | `i18n.md` |
| `src/plugins/{host,api}.ts`, `atoms/pluginAtoms.ts` — the contract, transactions, events, UI surfaces | `plugins-host.md` |
| `src/plugins/{loader,builtin,defaults,registry,updates}.ts`, `vendor-plugins.mjs`, `*-plugin-types.mjs` | `plugins-loading.md` |
| A specific plugin repository, or which plugin is the worked example for an API | `plugins-catalogue.md` |
| `src/gamedata/**`, `scripts/extract-*.mjs`, data sets, `data/gameNames.ts` | `gamedata.md` |
| `desktop/**`, `electron-builder.yml`, `.github/workflows/*`, `docker/`, in-app updates, cutting a release | `desktop-releases.md` |
| `scripts/build-docs.mjs`, `scripts/lib/docs/**`, `ATTRIBUTION.md`, third-party notices | `docs-site.md` |
| `src/formats/tileset/**`, `useTileset` | `tileset.md` |
| `src/components/**`, `MapViewport`, dialogs, hotkeys, drops, the close guard, `services/mapImage.ts` | `viewport-ui.md` |
| `services/preload.ts`, `usePreload`, the splash, `devReactTracks.ts` | `startup.md` |

## Commands

```sh
npm run dev            # Vite dev server, http://localhost:5173
npm run build          # tsc -b (type-check) + vite build
npm run lint           # oxlint
npm test               # vitest run (node environment, ~2s)
npm run test:watch
npx vitest run tests/chk.test.ts          # one file
npx vitest run -t "flood fill"            # tests matching a name
npm run extract        # StarDat/BrooDat.mpq → public/tileset, arr (incl. weapons/upgrades/techdata.dat), game, scripts, unit (BrooDat required)
npm run extract -- --from "/mnt/c/Program Files (x86)/StarCraft"    # or explicit .mpq paths
npm run check:assets   # what is on disk, no archives touched (predev/prebuild run this with --warn)
npm run i18n           # the language catalogues against the source (-- --write brings them up to date)
npm run build:image    # web bundle + docker/Dockerfile -> the `scmjs` image (nginx, no game data)
node scripts/extract-tilesets.mjs         # just the tilesets
node scripts/extract-units.mjs            # just the unit data
```

Dev deep-links (`/?nosplash&layer=units&dialog=playerSettings&mode=tile&tileset=ice&zoom=0.5`) are
the fastest way to reach a specific UI state — see `docs/development.md` and `src/hooks/useDevDeepLinks.ts`.

## Two sources of truth, deliberately

- `scenarioAtom` (`src/atoms/documentAtoms.ts`) holds the parsed `Scenario` — the object that gets
  **written to disk**. It is **mutated in place** (terrain edits, `setScenarioName`, …), not replaced.
- The older UI atoms in `src/atoms/editorAtoms.ts` (`mapNameAtom`, `mapWidthAtom`, `mapTilesetAtom`, …)
  are what the chrome/panels **display**. `loadDocumentAtom` mirrors scenario fields into them on open;
  when you change something in the scenario, update the mirror atom too (and vice versa) or the UI and
  the file will disagree.
- Because the scenario is mutated in place, React does not see terrain changes. `terrainRevisionAtom`
  is a counter bumped after every edit/undo/load; `MapViewport` subscribes to it to repaint. Any new
  code that mutates `scenario.tiles` must bump it (usually via `commitEditAtom`).
- Several maps can be open, but those atoms only ever hold **the map in front**. The others are
  `ParkedDocument` records in `documentsAtom` — the same fields, snapshotted — and switching
  (`activateDocumentAtom`) swaps the records through the atoms. Nothing reads a parked map except
  the tab strip, the Window menu and `api.document.list()`; a hook or panel never needs to know
  there is more than one. **Any new per-document atom must be added to `parkRegisters` /
  `installRegisters` in `documentAtoms.ts`, or it leaks from one map into the next on a switch.**

## Always true

**Dirty sections.** `Scenario.dirty` is a `Set` of section names; on save, `serializeScenario`
re-encodes only those and emits everything else byte for byte. **Any mutation of scenario state must
call `markDirty(scn, "NAME", …)` for every section it affects, or the change is silently dropped on
save.** Modelling a new section means: a codec in `sections/`, decode it in `parseScenario`, a case
in `encodeSection`, and a `tests/chk.test.ts` round-trip. See `chk-format.md`.

**Repaints.** Everything the editor draws is mutated in place, so a change is invisible until its
revision atom is bumped — `terrainRevisionAtom`, `doodadsRevisionAtom`, `unitsRevisionAtom`,
`locationsRevisionAtom`, `settingsRevisionAtom`, `triggersRevisionAtom`, `isomRevisionAtom`,
`gameDataRevisionAtom`. The commit atoms do it; new code that bypasses them must do it itself.

**Game data is never committed.** `fixtures/` (Blizzard maps) and the generated
`public/{tileset,arr,game,scripts,unit}/` are gitignored, and nothing in those trees may be
committed. A clone has no game data until `npm run extract` runs. The app degrades rather than
crashing when the data is absent, so a green test run and a working `npm run dev` **do not** prove
the extraction still works — run it. Never redistribute what it produces, and never add an address
the editor fetches game data from without the user naming it.

**Tests.** They live in `tests/*.test.ts` (and `src/**/*.test.ts` is picked up). Suites needing
`fixtures/maps/*.scx` or `public/tileset/*.cv5` use `describe.skipIf(...)` and skip silently when the
files are absent — **a green run does not mean the real-map suites ran.** vitest still *runs* a
skipped describe's body to collect it, so a suite that reads those files in the body (not inside
`it` / `beforeAll`) must be guarded with `if (have) describe(...)` instead, or CI — which has no
game data — crashes on the read.

**TypeScript.** `tsconfig.app.json` is strict-ish: `noUnusedLocals`, `noUnusedParameters`,
`verbatimModuleSyntax` (use `import type`), `erasableSyntaxOnly` (no enums / parameter properties).
`npm run build` is the type-check; `npm run lint` does not type-check.

**The plugin contract.** `src/plugins/api.ts` is the contract, types only. `PLUGIN_API_VERSION` is 1
and **stays there** — do not bump it for additions; the API is additive and a plugin repository picks
an addition up with `npm update @scm-js/plugin-api`. Anything a plugin needs at *run time* must
arrive on `api` (the npm package is types only, so a value imported from it is undefined). There is
no sandbox: a plugin runs with the page's privileges.

**Translations.** Every user-visible string goes through `t("English text", params)` from
`src/i18n` — a literal always, the extractor reads the source — and `App` remounts on a language
change, so a plain `t` import works anywhere. A string kept in a table is `msg("…")` where written
and `translate(value)` where shown (`unitLabel` / `upgradeLabel` / `techLabel` for the game's
names; `unitName` stays English for the text trigger format and the plugin API). Never `t()` at
module scope. `npm run i18n -- --write` after adding a string, then fill the Korean in
`src/i18n/ko.json`; `tests/i18n.test.ts` fails on a key the catalogue lacks or no longer needs.
`--export ko file.csv` / `--import ko file.csv` are the reviewer's round trip. Map text is never
translated. See `i18n.md`.

**Documentation.** `README.md` and `docs/*.md` are written for *readers* — map makers, mod makers,
contributors — not as implementation notes. A `src/` path may appear only in a guide's closing
`## In the source` table, and an atom or hook name not at all; `tests/docs.test.ts` enforces both.
When behaviour changes, update the prose in the reader's terms and the matching `.claude/internals/`
note in the code's. UI copy and docs prose stay plain — no marketing or AI-sounding register.

**UI, briefly.** All state is Jotai; there is no context/provider layering beyond the default store.
CSS is plain, layered in import order `tokens → base → ui → chrome → panels → viewport → dialogs →
splash` under `src/styles/`, with the design tokens as CSS variables in `tokens.css`. Adding a dialog
means touching *both* the `DialogId` union (`src/atoms/uiAtoms.ts`) and the `REGISTRY` of
`React.lazy` components (`DialogHost.tsx`), and dialog modules **must not** be imported statically
from anything on the startup path or Vite folds them back into the main chunk. See `viewport-ui.md`.
