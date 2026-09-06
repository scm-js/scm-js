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
