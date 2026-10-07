# Browser tests

### Playwright (`e2e/`, `playwright.config.ts`, 2026-10-06)

Added because every suite under `tests/` is node-environment and store-level: nothing rendered
a component, loaded a chunk or touched a browser API. The first three specs are the ones that
catch the most for the least — boot, every dialog, one open → edit → save → read-back. Not yet
written, in the order they were proposed: the mirror atoms and dialog undo through the chrome,
several maps and a switch (`parkRegisters` from the outside), the close guard and recovery
(real `beforeunload` / IndexedDB), pointer tools on the canvas, hotkeys with real key events;
later still, a shared map in two contexts and the Electron build through `_electron`.

**Against the build, not the dev server.** `webServer` is `vite preview` on 4173 over `dist/`,
and `npm run test:e2e` does not build (the `prebuild` vendoring step talks to GitHub, and CI has
just built anyway). So a local run tests the *last* build — the trap is editing `src/`, running
the specs and reading a result about old code. `SCMJS_E2E_URL=http://localhost:5173/` runs them
against the dev server instead. CI runs them in the Web job straight after `Build`, and must stay
before `Build (Pages)`, which rewrites `dist/` for another base path.

**The fixture (`e2e/support/editor.ts`) makes every machine CI.** One `page.route("**/*")`:

- `/tileset|unit|arr|game|scripts/…` on the server under test is fulfilled with a 200 HTML
  page — what `vite preview`'s SPA fallback answers for a file that is not in `dist/`, and so
  exactly what CI gets. `probeManifest` fails its `JSON.parse`, the source resolves to `none`.
  A 404 would do the same but Chromium logs it as a console error, which the fixture fails on.
- Any other origin is aborted (update checks, plugin services). Measured: no console noise
  from the aborts, the callers all catch.
- `showOpenFilePicker` / `showSaveFilePicker` are deleted in an init script, because Playwright
  cannot drive them. Open is then the hidden `<input type=file>` (`filechooser` event) and Save
  is a download — the Firefox/Safari route. **The handle route (`writeThrough`, the `.bak` /
  previous versions callback) is not exercised**; `saving.md` mentions stubbing the picker to
  OPFS, which is how a spec for it would go.

After each test the fixture asserts no `pageerror` and no `console.error`
(`editor.allowErrors(/…/)` for a test that expects one).

**The Game Data offer is the thing that bites.** With source `none`, `offerGameDataWhenClear`
opens the dialog once the plugins have started (or 5 s) *and the dialog stack is empty* — so
on a plain `?nosplash` it lands within a second or two, on top of whatever a spec is clicking,
and after a `?dialog=x` deep link it lands the moment `x` closes. Hence
`editor.dismissGameDataOffer()` first in any spec that uses the chrome, and hence
`dialogs.spec.ts` tags the dialog it opened (`data-e2e`) and asserts *that element* is gone
rather than "no dialog is open".

**`dialogs.spec.ts` reads the ids from `DialogHost.tsx`'s source** (a regex over the `REGISTRY`
literal: `id: from(`), not by importing it — the module graph is React and the lazies. A
registry entry written another way is missed; the "registry was read" test only pins the count
above 40. `confirmPlugin` and `pluginDialog` render nothing without a payload and are skipped
by name in `NEEDS_PAYLOAD`; everything else opens over the blank startup map with no payload,
including the ones that are normally opened *for* something (`unitProperties`, `confirmClose`,
`recovery`, `update`). Korean is `test.use({ locale: "ko-KR" })` — the `language: "auto"`
preference follows `navigator.language` — and one test per language checks the first menu's
label against `ko.json`, so a run that silently fell back to English fails.

**`errors.spec.ts` fails a dialog without a test hook.** A second `page.route` for
`**/assets/StatisticsDialog-*.js` aborts the chunk (later routes win over the fixture's), the
lazy rejects, and the dialog's boundary closes it. Three console errors are expected and allowed
by pattern: Chromium's `Failed to load resource`, Vite's `dynamically imported module`, and the
log's own mirrored `Render failed`. It opens the dialog from the menu *after*
`dismissGameDataOffer()` rather than by deep link, because the offer lands the moment the stack
empties — which is exactly what closing the failed dialog does. The panel, map and crash-screen
fallbacks have no spec: nothing in the bundle throws on request, and a hook to make it do so was
not thought worth shipping.

**Reading a saved file in the spec (`e2e/support/formats.ts`).** Importing
`src/formats/chk/scenario` from a spec fails: the section registry imports `src/i18n`, which
imports `ko.json` bare, and Node's ESM loader (which Playwright's transform leaves in charge
of JSON) wants an import attribute. So the worker-scoped `formats` fixture starts a Vite server
in middleware mode and `ssrLoadModule`s the two modules — the same transform vitest gives
`tests/`. Only types are imported statically. `tsconfig.e2e.json` (a fourth `tsc -b` reference)
type-checks the specs with the app's options, since those type imports pull `src/` in.

`ColorTextField` (Map Properties' name) is a `role="textbox"` div until clicked and an
`<input>` after: assert the text on the div, click, then fill the input.

Timings on an M-series laptop: 100 tests, ~18 s, 4 skipped (the two payload dialogs × two
languages). `@playwright/test` is a devDependency; its `playwright` dependency is also what
`scripts/guide-screenshots.mjs` imports (`sharp` is still `--no-save`).
