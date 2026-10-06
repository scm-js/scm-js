# Cut / copy / paste, and history

### Cut / Copy / Paste (`src/editor/clipboard.ts`, `src/hooks/useClipboardTools.ts`, `src/editor/history.ts`)

`editor/history.ts` now owns `HistoryEdit` / `HistoryEntry` and `applyEntry` (the fixed list
order: terrain `changes`, `isom`, `doodadTiles`, `doodads`, `sprites`, `units`, `locations`,
`fog`; reversed on undo) — `documentAtoms` re-exports the type. A `Clip` is self-contained
(size, `era`, MTXM `tiles` *and* TILE `ground`, records with origin-relative pixel positions,
`ClipLocation`s with names, MASK bytes) so it outlives the map it came from. `copyRegion` takes
a tile `Rect` (`regionObjects`: units/sprites by centre, doodads/locations wholly inside,
overlay sprites belong to their doodad), `copyObjects` an `ObjectSelection` (bounding box, those
objects only, never terrain/fog). `pasteClip` and `removeObjects` **apply as they build**, list
by list in `applyEntry` order, so every list is computed against the state the previous one
leaves — this is what makes replace-mode pastes and doodad removals undo/redo cleanly; do not
reorder the steps. Terrain pastes `ground` into both sections and, when doodads are included,
the MTXM picture as `doodadTiles`; `strandedByPaste` decides from the *final* picture which
existing doodads lose a tile (so a self-paste is a no-op), `mode: "replace"` also clears the
area's units/sprites/doodads (locations never). Units get fresh serials and `relatedSerial`
is remapped or dropped; locations go through `addLocation` (free slots, `ensureLocationSlots`
first); a different `era` refuses terrain + doodads but pastes the rest; everything off the
map is skipped with a `notes` entry. ISOM is untouched. Atoms: `clipboardAtom` (kept across
documents), `clipSelectionAtom` (the marked `Rect`, cleared on load/close/resize),
`clipPartsAtom`, `clipPasteModeAtom`, `clipPastingAtom`. The hook's `source()` is layer-aware
(marked area on the clipboard/terrain/fog layers, the selection on object layers); `paste()`
arms the clipboard layer and the viewport's `onDown` calls `pasteAt(tile)` while armed.
`tests/clipboard-edit.test.ts` pins the region rules, both tile layers, serial remapping,
replace/merge, stranding, edge clipping, the full undo/redo round trip and a fixture-map copy
into a blank map.

### Dialog undo (`src/editor/tableHistory.ts`, `recordTables` / `stepTables` in `documentAtoms.ts`)

Added 2026-10-05. A dialog writes its tables and calls `commitSettingsAtom` / `commitTriggersAtom`
with no change list, so the change is found afterwards: every followed `Scenario` has a
**baseline** (a module `WeakMap` keyed by the scenario object — so a parked map keeps its own
without a `ParkedDocument` field, and a re-parse starts afresh), the commit diffs the map against
it (`takeTablesEdit`), pushes `{ label, changes: [], tables }` on the undo stack and moves the
baseline on. A `HistoryEntry` with `tables` has no other part; `applyEntry`, `hasEdits`,
`commitEditAtom` and `SyncCore.step` never see one — `undoAtom` / `redoAtom` branch to
`stepTables` first. The fields are `SYNC_FIELDS` (so a field added there is undoable and synced
together; `FIELD_SECTIONS` is the `markDirty` map for both) plus the string table per slot.

- **Everything else that changes the tables must move the baseline**, or the next dialog's entry
  swallows it and undoing the dialog undoes that too: `installRegisters` (`followTables`),
  `afterWholeDocumentChange` and the sync drain (`rebaseTables`), `commitEditAtom` and
  `afterUnitEdit` (`rebaseStrings` — a location's name is a string that belongs to its own entry),
  `stepTables` (`rebaseAfterTables`). A new path that writes a `SYNC_FIELDS` field or a string
  outside a tables commit needs one of these.
- **Apply checks content.** `applyTables` writes a part only where the map still holds the side
  it expects (`after` on undo); a table someone else wrote since on a shared map is skipped, not
  clobbered. The entry moves to the other stack unchanged either way. On a shared map the result
  goes out through `tap.tables()` as any dialog write does — no new op kind.
- **Triggers are records, not JSON.** `applyTriggers` clones every record on every OK, so identity
  never survives; `diffTables` matches by hash + field compare (`sameRecord`) and re-uses the
  baseline's record for every one that did not change, wherever it moved. Entries share those
  records, so the history holds changed triggers only. This relies on **nothing writing to a
  record of `scn.triggers` / `scn.briefing` in place** (true today: lists are replaced by clones;
  the restore clones too). Same array object as the baseline's `source` = unchanged, no compare.
  Measured (node, dense 16-condition / 64-action records): baseline at open 0.3 ms whatever the
  size; a trigger OK's diff 4 ms at 500 triggers, 35 ms at 5,000, 200 ms at 30,000; a settings OK
  0.3 ms. JSON text per record, the first attempt, was 136 ms at 5,000.
- **A second limit besides depth.** `withinTablesBudget` drops the oldest steps while the
  trigger records the stack alone keeps alive pass `TABLES_BUDGET` (1,000,000 condition + action
  rows, roughly 100 MB at the worst). Found while checking the plugins: TrigScript's Apply and
  Magenta's every edit replace the list through `document.update`, and 200 levels of a
  several-thousand-trigger build would have been gigabytes. The redo stack is not trimmed (it
  only ever holds what was just on the undo stack).
- **Labels** default from `tablesKind` (five strings); a caller passes `{ label }` (the plugin
  host passes the update's). `{ extrasBefore }` (Sound Editor, `runUpdate`) adds the archive's
  files to the entry so a sound's file comes back with its slot. Both commit atoms record, and
  the second of a pair finds nothing left — one entry per `document.update`.
- A scenario put into `scenarioAtom` directly (tests) is not followed: its first commit records
  nothing and starts the baseline. `tests/table-history.test.ts`.
