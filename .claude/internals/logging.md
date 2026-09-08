# The log, the debug console and diagnostics

### The buffer (`src/editor/log.ts`, `src/editor/diagnostics.ts`, `src/atoms/logAtoms.ts`, `src/components/chrome/DebugConsole.tsx`, `src/hooks/useErrorCapture.ts`)

`README.md#when-something-goes-wrong` is the user's half; `docs/development.md#how-the-editor-is-put-together`
has the paragraph for contributors. This is why it is shaped the way it is.

**The problem it solves.** Everything the editor knew about a misbehaving session went to
`console.error` — behind a key most map makers never press — or to a toast that expired
before it was read. `plugins/failures.ts` exists because silence was the bug for exactly
one case (a default plugin that did not load); this is the general answer. There is no
plugin sandbox and six plugins ship on by default, so "which plugin touched the map" is a
question the editor could not answer at all before this.

**It records whether the console is open or not.** A log that starts when the window opens
can only ever catch a second occurrence, and the interesting failures do not repeat on
request. What is always on is cheap — document lifecycle, plugin activations, saves, the
game-data resolution and every uncaught error — tens of lines in a session. The chatty
tier (`isVerbose()`) is off until someone is hunting; it is not persisted, because a build
left tracing every plugin call across sessions is a slow editor nobody asked for.

**Not an atom.** Writes come from `plugins/host.ts`, `graphics.ts`, `services/preload.ts`,
`hooks/useMapFileActions.ts` and a `window.onerror` handler — none of which have a store —
and a Jotai atom would re-render the panel once per entry. `log.ts` is a plain module with
its own coalesced subscription (`NOTIFY_MS`, 100 ms); `atoms/logAtoms.ts` holds only the
three flags and the derived diagnostics facts. `DebugConsole` bumps one counter on a flush
and renders the filtered tail (`SHOWN`, 400 rows) — a few thousand DOM rows would cost far
more than the buffer ever does, which is the actual performance hazard here, not the writes.

**Two rules for a call site**, both of which the type signature is shaped to enforce:

- **Counts, not payloads.** `LogData` is `Record<string, scalar>`. An entry holding an
  edit's `changes` array would pin thousands of cell records for as long as the ring holds
  the line and quietly defeat GC — the buffer is bounded in *entries*, so it is only
  bounded in memory if entries are small. `runTransaction`'s line logs `EditResult`'s
  counts for this reason, never the lists.
- **User intent, not the inner loop.** One line per stroke, never per tile; nothing on the
  paint path, the pointer path, or inside a transaction's cell writes. `commitEditAtom` is
  verbose-only for exactly this reason: a painting session commits a stroke every time the
  mouse comes up, and at the always-on tier that would push everything worth reading out of
  the ring within a minute.

**Repeats collapse over a window, not just back to back.** The first flood found in
practice was a round-robin, not a loop: the menu bar's `enabled` predicates make each
plugin ask `document.isOpen()` every time the menu is drawn, so six plugins interleave and
consecutive-only collapsing (what a browser console does) caught almost none of it. An
identical line within `COLLAPSE_MS` (1 s) now bumps the entry already in the ring wherever
it sits, among the last `COLLAPSE_WATCHED` (64) distinct lines. The bumped entry keeps its
**first** sighting's time, so the list still reads in order and an entry never drifts; a
flood that outlasts the window starts another line with its own count rather than becoming
one number with no shape. A verbose stroke went from ~40 lines to 6.

**The console mirror is above the collapse**, so `console.warn` / `console.error` still fire
once per occurrence exactly as they did before — a stack in a real console is clickable and
one in a text log is not, and `tests/plugins.test.ts` counts those calls. `info` is not
mirrored: the always-on tier would fill a developer's console with the editor's own chatter.

**The header is worth more than the entries.** Most support questions are answered by
`diagnostics.ts` alone — build, browser or desktop, where the game data resolved (a missing
or partial extraction explains a whole class of "the map draws wrong"), the map's shape, and
the plugins with versions and errors. What it deliberately leaves out: full file paths
(`log.ts#baseName` trims them — a desktop path carries the user's own name), the user agent
beyond its engine and OS (`shortAgent`), and anything from a plugin's stored settings. The
README says what a copy contains before anyone copies it; keep that promise if you add a
fact here.

**Help ▸ Copy Bug Report carries the log too, capped.** It used to copy the header alone,
which had the discoverability backwards: the item beside Report an Issue… is the only copy
most map makers will ever find, and it produced the weaker artifact while the full one hid
behind View ▸ Debug Console ▸ Copy. The reason it was header-only was size — a GitHub issue
body stops at 65536 characters and a paste over that is *rejected*, not trimmed, so a bad
session was a report that could not be filed. `formatLog`'s fourth argument is a character
budget (`BUG_REPORT_BUDGET`, 48000) over the entries, never the header; it renders newest
first, stops when the next entry would not fit, and folds what it left out into the same
`… N earlier entries` line the ring's own drops use, with a different wording and a pointer
at Save…. It keeps one entry however big, since a copy of nothing helps nobody. The
always-on tier is tens of lines a session, so it cuts nothing in the ordinary case; it bites
on verbose and on error floods. The console's own Copy stays uncapped — that is the
deliberate hunter's path, and Save… has no paste to fit inside.

**Stacks are scrubbed on the way out, not on the way in.** `e.stack` is the one long string
an entry may hold and the third door a user's own name can reach a shared log through, after
the map path and the user agent: a desktop frame is `file:///C:/Users/<name>/…`.
`scrubFrame` cuts each frame's paths to their base name, keeping `:line:col`, and
`formatLog` applies it — so Copy and Save are clean while the `console.warn`/`console.error`
mirror keeps the clickable path a developer needs. A run with one separator and no scheme or
drive letter in front is left alone, or `bad ratio 3/4` becomes `bad ratio 4`.

**Instrumentation is one walk, not two hundred call sites.** `host.ts#instrument` wraps
every function on the API object at the bottom of `createPluginApi`. That works because the
function builds one fresh literal per plugin, so the wrappers are private to it and the path
they log (`document.edit`, `ui.pickObject`) needs no bookkeeping. Depth 3, plain objects
only, and objects with more than 200 keys are skipped (`api.consts` is a data table with
nothing to wrap). Off, a call costs one frame and a boolean — nothing beside the store reads
underneath it — and the message is built inside the gate, never before it.

**Storage.** `scmjs.console` and `scmjs.consoleHeight` are `atomWithStorage` keys like any
other: both need their row in `preferencesAtoms.ts#STORED_RESETS` and their label in
`MiscDialogs.tsx#STORED_LABELS`, or `tests/storage.test.ts` fails. The height atom lives in
`atoms/logAtoms.ts` rather than in the component so the reset table can import it without
pulling a component onto the startup path.

**What was left out of the first version**, deliberately: the Electron main process, whose
updater and file logs live outside the renderer and would need a bridge and a merge; and any
tap on the editor's own hot paths. `tests/log.test.ts` pins the ring, the collapsing, the
error shapes, the redaction and the header's wording — all of it pure, none of it eyeballed.
