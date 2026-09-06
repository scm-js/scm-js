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
