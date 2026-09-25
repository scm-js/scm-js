# Saving

### Saving (`src/editor/save.ts`, `src/services/mapIo.ts`, `useMapFileActions.ts#saveDocument`, `SaveMapDialog`)

`editor/save.ts` is pure: `SaveOptions` (format, compression, encrypt, `omitExtras`, the strip ticks,
`mergeRepeats`, `dropTrailing`), `planSave(scn, extras, options)` → a `SavePlan` (every `currentChk`
section with a fate — kept / dropped / merged — and reason, every extra with `kept`, sizes, counts for
the ticks, warnings in words), `buildChk` / `buildMapFile` (the `.chk` alone or `saveMap` around it;
zlib gets 64 KB sectors, the rest StarEdit's 4 KB). The strip groups are `TERRAIN_EDITING_SECTIONS`
(ISOM, TILE, DD2) and `BOOKKEEPING_SECTIONS` (IVER, IVE2, IOWN, UPUS, SWNM, WAV) — the registry's
`editorOnly` flag, and `tests/save.test.ts` keeps the two in step; nothing the game requires can be
stripped. Merging uses `combine` with the registry's mode, at the first occurrence. `defaultSaveOptions`
is the file's own extension and *the way it was opened* (`mapOriginAtom`), else StarEdit's layout;
`SAVE_PRESETS.everything` / `.smallest` are two of the dialog's three *What to keep* radios (the third,
Custom, shows the five strip ticks; the radio is read back from the ticks — none on, all on, else
Custom — so a stored option set reopens on the right one). Nothing here mutates the scenario.

The dialog (reworked 2026-09-21, the user found the two-column version confusing): file name, format
and *What to keep* in front; **Archive** and **Sections** are `<details>` folds (`.save-more`) whose
summaries carry the current state (compression · encrypted · n of m other files; kept sections ·
chk size). The Archive fold starts open only when the options differ from `defaultSaveOptions` for
this map (compression, encryption, or an omitted extra) — nothing is persisted. The revision hint
under Format shows only when the extension disagrees with `fileVersion`. Check Map shows only with
errors or warnings.

`mapIo.ts` keeps the File System Access handle (`MapFileHandle`, typed locally — the DOM lib lacks the
permission methods) from `pickMapFile`, `droppedHandle` (must be *called* inside the drop event) and
the save picker; `saveBytes(bytes, name, handle)` answers a `SaveOutcome { route: "file" | "picker" |
"download", fileName, handle }` or null for a dismissed picker — a handle write asks
`queryPermission` / `requestPermission` first and falls back to the picker on refusal.
`mapFileHandleAtom` / `mapOriginAtom` / `saveOptionsAtom` (`editorAtoms.ts`) ride on `LoadedDocument`
and are cleared by close; a `"replace"` load keeps the options. `saveDocument(store, req, write?)` is
the one writer: builds (or takes the dialog's) bytes, calls the writer, and on success — unless
`req.copy` — sets path, handle, options, modified=false, recents, then a status line and a toast
(`pushToastAtom` / `toastsAtom`, `Toasts.tsx` bottom-right) worded "Saved" or "Downloaded … in the
browser's downloads folder", since a download is the only route Firefox and Safari have.
`.toasts` sits at **z-index 210** — above the dialog layer (`.dlg-overlay` 100, `.dlg` 101),
below the splash (300). At 60 it was under the overlay's 55% fill and 2px backdrop blur, so
every notice raised from a dialog — a plugin installed, a data set removed, a map exported or
a test map written, five dialog modules raise them — was dimmed and blurred in the one place
the editor most wanted to be read. A toast is then a press *outside* the dialog, so
`DialogFrame` prevents Radix's `onInteractOutside` for a target inside `.toasts`: dismissing a
notice, or pressing its one action, must not close the dialog that raised it. `save(mode)`
in the hook: `"save"` with a path writes with the remembered options; otherwise `askDialog(store,
"saveAs", { copy })` opens `SaveMapDialog` and resolves when it calls `payload.done(true)` (after
`taken`) or leaves the stack — so Close Scenario's Save waits for the whole thing. Save Copy As is the
same dialog with `{ copy: true }`. `tests/save-flow.test.ts` covers the store half with a fake writer.

### Build steps and built maps (`editor/mapBuild.ts`, `services/mapBuild.ts`, 2026-09-18)

Decided with the user for TrigScript going Remastered-only: **one file, built on save**, not
euddraft's source + `-eud.scx` pair (a map maker hosts the wrong one). `api.document.buildSteps.add`
registers `{ id, label, applies(), run({ map, fileName, purpose, signal }) }` on `pluginBuildStepsAtom`;
`services/mapBuild.ts#buildOutgoing` is the single place bytes leave the editor with steps run —
`saveDocument` (the dialog's `req.bytes` are the *plain* bytes and go in as `plain`), `testMapBytes`,
`document.export` (unless `built: false`). With no applicable step it is `buildMapFile` byte for byte
(a test pins that). Steps chain in activation order, each over the last one's output.

`packBuiltMap` does not trust the step's archive layout: it takes the output's **chk** and any
member names the clean map lacks (`added`), and rewrites the archive with the user's save options,
the plan's kept extras and stored members as they were — a step adds members, it cannot change one.
`saveMap`'s `editorMembers` are always zlib and unencrypted (`scmjs\source.chk` = `buildChk(plan)`,
i.e. the scenario *after* the user's strip ticks, same as an unbuilt save; `scmjs\build.json` =
`{ version, chk: sha256 of the built chk, steps, added }`). `openMapFile` hints both names (a
protector's missing listfile), reads `added` through `readMembers`' second pass, and
`restoreBuiltMap` swaps in the source when the hash matches, dropping the editor's members and the
steps' additions from the extras; a mismatch opens the file as it is with a warning and keeps the
members (nothing is lost, the user can get `source.chk` out with any MPQ tool). The built scenario is
parsed once for the sound hints and the source parsed after — two parses only for a built map.

**A step can never cost a save.** Throw, a non-map return, or the notice's *Save without it*
(an `AbortController`; the run is raced against it, since a step may ignore the signal) → the plain
bytes are written, `saveDocument` still returns true and clears modified, and a ttl-0 toast says
why. Test Map throws instead (`TestMapDialog` shows the reason). `.chk` is never built. A `running`
WeakSet makes `export()` from inside a step answer the plain map — Magenta 0.9 and TrigScript 2.6
both call `export()` to feed their own build, so without it the first step to be registered would
recurse. `builtByAtom` (per document: in `parkRegisters` / `installRegisters`, kept across a
`"replace"`) is what lets Save say, once, that the file was built by a step nothing provides now;
it is set from the manifest on open and from the outcome on every non-copy save.

`buildSteps.before({ id, label, applies?, run })` (`pluginBeforeBuildAtom`, added the same day for
TrigScript 3) is the *document* half: handlers run first, inside the same `running` guard and under the
same notice and button, and only then are the plain bytes planned and the steps asked whether they
apply — which is why `buildOutgoing` reads the scenario, extras and stored members from the store
itself rather than taking them from the caller (a handler replaces `archiveExtrasAtom`'s Map), and
why the Save dialog's `plain` bytes are ignored once any handler applied. A handler that throws lands
in `Outgoing.unprepared` (a toast per entry on Save, a throw on Test Map). `applies` exists so a
default plugin with nothing to do does not flash the notice on every save of every map.

Not done, on purpose or yet: the Save dialog does not mention steps or show the built size; there is
no "leave the source out" tick for a release copy; nothing offers to open the stored source of a
changed file. The write-plain-first-then-rewrite idea (so a handle save never waits) was dropped for
the notice's button — two writes of one file is two chances to be interrupted.

`Preferences.save` is where the Save dialog starts (`initialSaveOptions` in `editor/save.ts`):
`saveOptionsAtom` (this session's confirmed options) wins; else `defaultSaveOptions` with
`save.compression` as the fresh-map compression — `"asOpened"` is StarEdit's PKWARE +
encryption, anything else goes unencrypted except PKWARE — and then `save.start` applies a
`SAVE_PRESETS` entry over it. An opened archive's own compression is followed whatever the
preference says.

### Recovery copies (`editor/recovery.ts`, `services/recovery.ts`, `hooks/useRecovery.ts`, `RecoveryDialog`, 2026-09-25)

Slice 1 of `~/preferences-later-plan.md`. A copy per modified open map, in the `recovery` object
store of the `scmjs` IndexedDB database — `handleStore.ts` went to **VERSION 2** for it (the
upgrade only adds missing stores; `onversionchange` closes the connection so an older tab never
blocks the upgrade; `idbRequest(store, …)` is the shared entry point). A record is
`{ key: "<session>:<docId>", session, docId, at, name, fileName, width, height, tileset, size,
chk, extras, stored, origin, builtBy, saveOptions, handle }` — `chk` is `serializeScenario`, so a
restore is `parseScenario` + `loadDocumentAtom`, not the file-opening path (no build-step unpack,
no sound hints; the copy is already the source). A `FileSystemFileHandle` is stored with it so Save
goes back to the file; a `DataCloneError` retries without it.

**Which maps, when.** `planRecovery` is pure: write a map that is modified and changed since its
copy (or never copied); remove the copy of a map no longer modified, no longer open, or with the
preference off. `RecoveryCopier` (one per store, made by `useRecovery`) marks the *front* map
changed on any revision atom, `undoStackAtom`, `archiveExtrasAtom` or `mapModifiedAtom` — a parked
map cannot change, and a switch bumping every revision costs one extra write, nothing more. Writes
happen on the `Preferences.recovery.minutes` interval (default 2, limits 1–30) and on
`visibilitychange` → hidden; removals also run a tick after any `documentsAtom` / `mapModifiedAtom`
change, so a save or close drops its copy at once and a crash straight after a save offers nothing.
All copies of a pass are built synchronously before the first IndexedDB await, so each is the map at
one instant. Over `MAX_COPY_BYTES` (64 MB) is skipped with one `logWarn` per map. Passes are chained
on one promise, never overlapping.

**Whose copies.** `SESSION` is a UUID per page; `holdSessionLock` takes the Web Lock
`scmjs.session:<id>` for the page's life, and `liveSessions` (`navigator.locks.query()`) tells a
window still running from one that ended — `leftoverCopies` offers only the latter. Without Web Locks
every other session's copies count as left over (a second tab would see the first's). Restoring
deletes the old record and the copier writes a fresh one under this session.

**Offer.** `usePreload` calls `offerRecoveryWhenClear` after the preload; it opens `recovery` through
`whenDialogsClear` — `offerGameDataWhenClear`'s wait (plugins started or 5 s, empty dialog stack),
factored out so Game Data and Recover Maps come one after the other. File ▸ Recover Maps… opens the
same dialog; Preferences ▸ Storage has a Recovery copies section (count, size, Discard of leftovers
only — this session's copies go with their maps). *Clear all data* does not touch them, on purpose:
they are work, not settings. Desktop Quit with `confirmClose` on calls `forgetSessionCopies` after
`quitGuard` answered true (every map was asked about); with the question off the copies stay, since
nothing was asked. The browser's `beforeunload` leaves them — that is the accidental-close case.

Not done: the `.bak`/previous-version slice (2 in the plan); copies of a shared map's guest are
written like any other; no age limit on leftovers.

### Keeping the file a save replaces (`services/previousVersions.ts`, `desktop/backup.ts`, `PreviousVersionsDialog`, 2026-09-25)

Slice 2 of the plan, widened: `Preferences.save.backup` (default **on**). `saveBytes` / `saveBlob`
take an optional `BeforeOverwrite` callback, called by `tellBefore` with `handle.getFile()` *after*
the readwrite permission and *before* `createWritable` — on the handle route and on the picker
route (Save As onto an existing file); an empty file (one the picker just made) or an unreadable one
is skipped, and a throwing callback never stops the write. The callback must read the bytes before
it returns: a `File` from a handle goes stale once the file changes. `SaveWriter` gained the same
4th argument, and `saveDocument` passes it only with the preference on (test-pinned).

`keepPrevious(file)`: the desktop first — `bridge.files.backup(file)` (optional on the bridge type,
since an older preload lacks it). The page has no paths, so the preload asks
`webUtils.getPathForFile(file)` and invokes `file:backup`; main's `backupMap` copies to
`<path>.bak` (so `x.scx.bak`, extension kept visible), **only** for an existing regular file ending
`.scm/.scx/.chk` — plugins share the page's privileges and must not get a general copy/overwrite
primitive. On failure, or in a browser, the bytes go to the `previous` store (IndexedDB **VERSION
3**): `{ key: "<name>:<at>", fileName, at, modified, size, bytes }`, trimmed by `overLimits` to 3
per file name, 30 total, 256 MB total (oldest first). Keyed by *name* — a handle has no path and
`isSameEntry` is async per pair — so two different `map.scx` share the three slots.

The Save toast names the kept copy once per session per kind (`explained`); a failure is a warn
toast every time. File ▸ Previous Versions… lists the store (Open → `openFileInto(…, "new")` with
no handle and `name (previous).scx`, so Save asks where; Save As → `saveBytes` with no handle;
Discard). Preferences ▸ Storage has a Previous versions section beside Recovery copies.

Verified headlessly: Save As → Save over an OPFS handle (picker stubbed to OPFS) keeps the version
and the dialog reopens it. The Electron `.bak` path is covered by `backupMap`'s unit test and a
desktop bundle build; not run in a live desktop window.
