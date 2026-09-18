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
`SAVE_PRESETS.everything` / `.smallest` are the dialog's two buttons. Nothing here mutates the scenario.

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
