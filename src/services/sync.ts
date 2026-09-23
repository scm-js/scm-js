/**
 * A shared map's session over the editor's store: `editor/sync.ts` does the resolving and
 * the rebasing; this puts it between the store and whoever carries the ops (the scmjs.dev
 * plugin's room, through `api.sync`).
 *
 * The map in front when the session starts is the shared one. Its commits, undos, dialog
 * writes, archive files and whole-document changes reach the session through
 * `syncTapAtom` and go out as ops. Other people's ops, and the server's confirmations of
 * ours, queue in one inbox in the order they came, and are applied when nothing is in the
 * way: not while a stroke or a drag is under way on the map (it is live but not yet
 * recorded, and would be cut in two), not while a dialog that edits the map is open (it
 * holds indices and a working copy), not while another map is in front. Then the map is
 * repainted, the selections follow their records, and the local history forgets the cells
 * someone else has since written.
 */
import type { createStore } from "jotai";
import {
  activeDocumentIdAtom, archiveExtrasAtom, archiveStoredAtom, documentsAtom, doodadsRevisionAtom, isomRevisionAtom, loadDocumentAtom, locationsRevisionAtom,
  redoStackAtom, scenarioAtom, settingsRevisionAtom, syncTapAtom, terrainRevisionAtom, triggersRevisionAtom, undoStackAtom, unitsRevisionAtom, type SyncTap,
} from "../atoms/documentAtoms";
import {
  mapDescriptionAtom, mapFileHandleAtom, mapFilePathAtom, mapModifiedAtom, mapNameAtom, mapOriginAtom, mapPointerHeldAtom, mapVersionAtom, saveOptionsAtom,
  selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom,
} from "../atoms/editorAtoms";
import { dialogStackAtom, type DialogId } from "../atoms/uiAtoms";
import { mapVersionOf, parseScenario, scenarioDescription, scenarioName, serializeScenario, type Scenario } from "../formats/chk/scenario";
import { isLocationUsed } from "../formats/chk/sections/objects";
import {
  SyncCore, captureFields, captureStrings, forgetCells, isSyncOp, type FieldsBaseline, type SyncCells, type SyncDoc, type SyncOp,
} from "../editor/sync";
import { logInfo, logWarn } from "../editor/log";
import { DEFAULT_SAVE_OPTIONS, defaultSaveOptions } from "../editor/save";
import { writeMapBytes } from "./mapIo";
import type { SyncHold, SyncReport, SyncSession, SyncStartOptions } from "../plugins/api";

type Store = ReturnType<typeof createStore>;

export type { SyncHold, SyncReport, SyncSession, SyncStartOptions } from "../plugins/api";

/** Dialogs that hold indices into the map or a working copy of its tables: other people's changes wait while one is open. */
const HOLDING_DIALOGS: ReadonlySet<DialogId> = new Set<DialogId>([
  "mapProperties", "resizeMap", "mapRevision", "playerSettings", "forceSettings", "playerColors", "unitSettings", "upgradeSettings", "techSettings",
  "stringEditor", "soundEditor", "switches", "locationList", "unitProperties", "locationProperties", "spriteProperties", "triggerEditor",
  "missionBriefing", "cuwpEditor", "replaceTerrain", "autoStarts", "importTriggers", "importStrings",
]);

/** The records a selection points at, so it can find them again after the lists moved. */
function selectedRecords<T extends object>(list: readonly T[], indices: readonly number[]): T[] {
  return indices.map((i) => list[i]).filter((r): r is T => r !== undefined);
}

function reselect<T extends object>(list: readonly T[], records: readonly T[], same: (a: T, b: T) => boolean): number[] {
  const out: number[] = [];
  for (const r of records) {
    let i = list.indexOf(r);
    if (i < 0) i = list.findIndex((x) => same(x, r) && !out.includes(list.indexOf(x)));
    if (i >= 0 && !out.includes(i)) out.push(i);
  }
  return out;
}

const sameShape = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

const sessions = new WeakMap<Store, SyncSession>();

/** The session running on a store, if any. */
export function currentSync(store: Store): SyncSession | null {
  return sessions.get(store) ?? null;
}

export function startSync(store: Store, options: SyncStartOptions): SyncSession | null {
  const id = store.get(activeDocumentIdAtom);
  const first = store.get(scenarioAtom);
  if (store.get(syncTapAtom) || id === null || !first) return null;

  const core = new SyncCore();
  let base: FieldsBaseline = captureFields(first);
  let extrasBase = store.get(archiveExtrasAtom);
  let before: Scenario | null = null;
  /** Ops to apply and confirmations (null), in arrival order. */
  const inbox: (SyncOp | null)[] = [];
  let applying = false;
  let ended = false;

  const inFront = () => store.get(activeDocumentIdAtom) === id;
  const docOf = (): SyncDoc => ({ scn: store.get(scenarioAtom)!, extras: store.get(archiveExtrasAtom) });
  const send = (op: SyncOp) => {
    try {
      options.send(op);
    } catch (err) {
      logWarn("sync", "The session's send failed", { error: String(err) });
    }
  };
  const quiet = () => ended || applying || !inFront() || !store.get(scenarioAtom);

  const tap: SyncTap = {
    owns: () => !ended && inFront(),
    edit(_get, _set, entry) {
      if (quiet()) return;
      const doc = docOf();
      const op = core.commitEdit(doc, entry);
      base = captureStrings(doc.scn, base);
      if (op) send(op);
    },
    step(_get, _set, entry, direction) {
      const doc = docOf();
      const r = core.step(doc, entry, direction);
      base = captureStrings(doc.scn, base);
      send(r.op);
      return r.entry;
    },
    tables() {
      if (quiet()) return;
      const doc = docOf();
      const op = core.commitFields(doc, base);
      base = captureFields(doc.scn);
      if (op) send(op);
    },
    beforeWhole() {
      if (quiet()) return;
      const scn = store.get(scenarioAtom);
      // Resize and a tileset change rework the scenario in place; the copy is what a
      // rebase puts back if someone else's change turns out to come first.
      before = scn ? parseScenario(serializeScenario(scn)) : null;
    },
    whole(_get, _set, label) {
      if (quiet() || !before) return;
      const doc = docOf();
      send(core.commitReset(doc, before, label));
      before = null;
      base = captureFields(doc.scn);
      extrasBase = doc.extras;
    },
  };

  const holding = (): SyncHold | null => {
    if (!inFront()) return "behind";
    if (store.get(mapPointerHeldAtom)) return "stroke";
    if (store.get(dialogStackAtom).some((d) => HOLDING_DIALOGS.has(d.id))) return "dialog";
    return null;
  };

  const drain = () => {
    if (ended || applying || inbox.length === 0 || holding()) return;
    applying = true;
    const report: SyncReport = { ops: 0, dropped: 0, lost: 0 };
    try {
      const doc = docOf();
      const scnBefore = doc.scn;
      const extrasBefore = doc.extras;
      const cells: SyncCells = { tiles: [], isom: [], fog: [] };
      const picks = {
        units: selectedRecords(scnBefore.units, store.get(selectedUnitsAtom)),
        doodads: selectedRecords(scnBefore.doodads, store.get(selectedDoodadsAtom)),
        sprites: selectedRecords(scnBefore.sprites, store.get(selectedSpritesAtom)),
      };
      for (const item of inbox.splice(0)) {
        if (item === null) { core.confirm(); continue; }
        const r = core.receive(doc, item);
        report.ops++;
        report.dropped += r.applied.dropped;
        report.lost += r.lost;
        if (r.applied.cells) {
          cells.tiles.push(...r.applied.cells.tiles);
          cells.isom.push(...r.applied.cells.isom);
          cells.fog.push(...r.applied.cells.fog);
        }
      }
      if (report.ops === 0) return;

      if (doc.scn !== scnBefore) {
        // A whole-document change (theirs, or ours applied again on top of theirs): the
        // document is installed again as a re-parse is — same slot, history dropped.
        store.set(loadDocumentAtom, {
          scenario: doc.scn, extras: doc.extras, stored: store.get(archiveStoredAtom), fileName: store.get(mapFilePathAtom),
          handle: store.get(mapFileHandleAtom), origin: store.get(mapOriginAtom), reason: "replace",
        });
      } else {
        const mine = new Set(core.pending.map((p) => p.entry));
        forgetCells([...store.get(undoStackAtom), ...store.get(redoStackAtom)].filter((e) => !mine.has(e)), cells);
        const scn = doc.scn;
        store.set(selectedUnitsAtom, reselect(scn.units, picks.units, (a, b) => a.serial === b.serial && a.unitId === b.unitId));
        store.set(selectedDoodadsAtom, reselect(scn.doodads, picks.doodads, sameShape));
        store.set(selectedSpritesAtom, reselect(scn.sprites, picks.sprites, sameShape));
        store.set(selectedLocationsAtom, store.get(selectedLocationsAtom).filter((i) => scn.locations[i] && isLocationUsed(scn.locations[i])));
        store.set(mapNameAtom, scenarioName(scn) ?? store.get(mapFilePathAtom) ?? "Untitled Scenario");
        store.set(mapDescriptionAtom, scenarioDescription(scn) ?? "");
        store.set(mapVersionAtom, mapVersionOf(scn.fileVersion));
        for (const a of [terrainRevisionAtom, unitsRevisionAtom, doodadsRevisionAtom, locationsRevisionAtom, isomRevisionAtom, settingsRevisionAtom, triggersRevisionAtom]) {
          store.set(a, store.get(a) + 1);
        }
      }
      if (doc.extras !== extrasBefore) store.set(archiveExtrasAtom, doc.extras);
      store.set(mapModifiedAtom, true);
      base = captureFields(doc.scn);
      extrasBase = doc.extras;
    } catch (err) {
      // An op this editor cannot apply leaves the copy out of step with everyone else's;
      // the only safe thing is to end the session and say so.
      logWarn("sync", "A shared change could not be applied; the session ends", { error: String(err) });
      applying = false;
      end("stopped");
      return;
    } finally {
      applying = false;
    }
    if (report.ops > 0) options.onApplied?.(report);
  };

  const unsubs = [
    store.sub(archiveExtrasAtom, () => {
      if (quiet()) return;
      const doc = docOf();
      const op = core.commitExtras(doc, extrasBase);
      extrasBase = doc.extras;
      if (op) send(op);
    }),
    store.sub(mapPointerHeldAtom, drain),
    store.sub(dialogStackAtom, drain),
    store.sub(documentsAtom, () => {
      if (!store.get(documentsAtom).some((d) => d.id === id)) end("closed");
      else drain();
    }),
  ];

  function end(reason: "closed" | "stopped") {
    if (ended) return;
    ended = true;
    inbox.length = 0;
    for (const u of unsubs) u();
    if (store.get(syncTapAtom) === tap) store.set(syncTapAtom, null);
    if (sessions.get(store) === session) sessions.delete(store);
    logInfo("sync", "Shared editing ended", { reason });
    options.onEnd?.(reason);
  }

  store.set(syncTapAtom, tap);
  logInfo("sync", "Shared editing started", { document: id });

  const session: SyncSession = {
    documentId: id,
    receive(op) {
      if (ended || !isSyncOp(op)) return false;
      inbox.push(op);
      drain();
      return true;
    },
    confirm() {
      if (ended) return;
      inbox.push(null);
      drain();
    },
    snapshot: async () => {
      const scn = store.get(scenarioAtom);
      if (ended || !scn || !inFront() || core.pending.length || inbox.length) return null;
      // Everything is read now, before the first await: the file is this moment's map.
      const copy = parseScenario(serializeScenario(scn));
      const extras = new Map(store.get(archiveExtrasAtom));
      const stored = store.get(archiveStoredAtom);
      const remembered = store.get(saveOptionsAtom) ?? defaultSaveOptions(scn, store.get(mapOriginAtom), store.get(mapFilePathAtom));
      return writeMapBytes(copy, { format: remembered.format, extras, stored, options: { ...DEFAULT_SAVE_OPTIONS, ...remembered } });
    },
    pending: () => core.pending.length,
    waiting: () => inbox.length,
    holding: () => (ended ? null : holding()),
    stop: () => end("stopped"),
  };
  sessions.set(store, session);
  return session;
}
