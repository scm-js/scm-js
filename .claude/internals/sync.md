# Shared maps: `api.sync`

### Where it lives (`src/editor/sync.ts`, `src/services/sync.ts`, `syncTapAtom` in `documentAtoms.ts`, `mapPointerHeldAtom`)

`docs/plugins.md#apisync` is the plugin author's half and `README.md#editing-a-map-together`
the map maker's. The transport is the scmjs.dev plugin's (`plugin-scmjs-dev/share/`), the
server is ai-server's `src/rooms/` (a sequencer + relay that never opens the map). Built
2026-09-22 after the user picked "fastify websocket on the existing server", "invite link,
anyone (typed name)" and "rooms end; people keep their copy". The invite link is
`<editor>/share/<invite>` (plugin 1.27.0; `?scmjs-room=` before that, dropped with no
fallback since nobody had used it); the host's only part is the `404.html` copy that lets
GitHub Pages open the editor at that path (see `desktop-releases.md`).

**Model: server-ordered ops, deterministic resolution, client rebase.** Not a CRDT, not OT
on indices. Every editor applies the same ops in the server's order through `applyOp`,
which is a pure function of (map, op), so the copies converge. `SyncCore.receive` rolls the
pending (unconfirmed local) ops back, applies the remote one, re-applies the pending ones.
`tests/sync.test.ts` fuzzes three clients over 100 seeds (plus 15 with an invariant check
after *every* step: client copy == confirmed ops + its pending ops from scratch). When it
fails, add that per-step check back first — it found the one real bug in minutes.

**Resolution rules (`applyEditOp`).**
- Grids (MTXM+TILE as `[at, mtxm, tile]` triples, doodad tiles / ISOM / MASK as pairs):
  the value is set, later wins; skipped when the op's `width`/`height` differ (a resize
  came first).
- Units / doodads / sprites: `before` is found **by content** (`findRecord`: the hinted
  index, else the nearest equal record), insertions clamp to the list; a change whose
  record is gone is dropped and counted. Unit serials are *not* de-duplicated: two people
  placing at once get the same serial; it only matters for addon/nydus links and a remap
  would have to rewrite the originator's history too.
- Locations: slot LWW; a *created* location whose slot is taken moves to `firstFreeSlot`;
  the name travels as **text** and is re-interned where it lands (find-or-append), so a
  location op never carries a string index that means something else elsewhere.
- Fields (`SYNC_FIELDS`, what dialogs write whole): per-field LWW, `pack`ed (typed arrays
  as `{ $t, d }`). The string table goes per slot `[i, before, after]`; a slot someone else
  filled meanwhile sends the op's string to a new slot and `remapStrings` points the op's
  own fields (triggers/briefing via `actionDef` args, forces, unit names, switches, wavs)
  at it.
- `reset` (resize, tileset change, `replaceScenarioAtom`): the whole CHK. `beforeWhole`
  clones the scenario first because resize/tileset mutate in place and a rebase must be
  able to put the old one back.
- `extras`: whole members, detected by a `store.sub` on the extras atom (the plugin API and
  the Sound Editor both write it).

**Traps that cost something.**
- **Normalise on commit.** `commitEdit` undoes the editor's own application and re-applies
  the op through `applyOp`. Without it the originator's copy is whatever the tool did, and
  any difference from the resolver (a location name reused vs appended, a clamp) is a
  silent divergence. Do not "optimise" this away.
- **Rollbacks restore contents, not array references.** A fields op that restored
  `scn.strings.strings = prevArray` resurrected strings a later op had appended to a
  *different* array object (fieldsRollback had swapped in a copy). Every rollback of the
  string table now assigns a `slice()` of saved contents, and only when the op touched it.
- **Reversed ops** (an undo sent over the wire) apply parts in undo order; their `edit` is
  the entry E they undid (E's `undo` == what was applied, E's `do` == the rollback) — that
  is also exactly what the redo stack needs. TILE on a reversed terrain change is written
  from the op's third number; `under` on E carries it.
- **Confirms go through the inbox.** An `ack` processed ahead of an earlier queued remote op
  would pop the pending op before the rebase that must move it above that op.
- **Holds.** Remote ops wait while `mapPointerHeldAtom` (set around `MapViewport`'s
  pointer handlers — a stroke is live on the scenario but not committed), while one of
  `HOLDING_DIALOGS` is open (they hold indices / working copies; plugin dialogs are not in
  it, or TrigScript's workspace would freeze the map for an hour), and while the shared map
  is parked. Draining is triggered by `store.sub` on those atoms.
- **Undo on a shared map** goes through `tap.step` → `SyncCore.step` (content resolution),
  not `applyEntry` with raw indices. Remote grid cells are forgotten from non-pending stack
  entries (`forgetCells`), so undo never repaints over someone's newer paint; pending
  entries are instead rewritten in place (`setEntry`) on every rebase.
- **Snapshots** (`session.snapshot()`) serialise synchronously before the first await and
  refuse while anything is pending or waiting — the copy must correspond to one seq.
  The owner calls `start()` and `snapshot()` in the same tick when sharing.
- Selections follow records (identity, then serial+unitId / content), since
  `afterUnitEdit`-style clearing on every remote op would make selecting impossible.

**Resume after a drop (2026-09-23; ai-server 0.14.0, plugin 1.30.0).** No host change:
a resume replay is, to `SyncCore`, just late delivery. The server keeps a dropped person
*away* (1006 only; 1000/1001/1005 is leaving) for `resumeGraceSec`; `hello.resume {token,
seq}` answers `resumed` with the log after `seq`. The plugin keeps every op the session sent
that is not acked (`unacked`, sent or not); in the replay an op `from` itself is
`unacked.shift()` + `confirm()`, anyone else's `receive()`, and what is left is re-sent in
order — resolution does not care that an op is sequenced later than it was made. When the
log no longer reaches back to `seq` the server sends a plain `welcome`; the plugin then
stops the old session (guarded by a generation counter so the old session's `onEnd` /
`send` are ignored) and opens the copy in a new tab, never over the old one. A client ping
every 20 s, with 50 s of silence counting as a drop, catches the half-open socket a browser
would otherwise sit on. Verified headlessly: server-side `terminate()` mid-session, both
paths, maps equal after.

**Deliberately left out (v1).** Per-trigger merging (a dialog OK is
whole-table LWW, the presence line says who is in which dialog); serial remapping;
presence of the other person's selection. A server refusal of an op (`error.about ===
"op"`) ends the plugin's session, since the copy no longer matches.

**Verified headlessly 2026-09-22**: local ai-server (PGlite, fake Discord) + Vite + two,
then three Playwright contexts: share → join from the link → concurrent edits equal →
Ctrl+Z propagates → stroke hold ("stroke", waiting 1, applied on mouse-up) → rename via
`document.update` → late joiner after snapshot-please → resize across three → Leave.
