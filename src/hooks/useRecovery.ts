import { useEffect } from "react";
import { useAtomValue, useStore, type Atom } from "jotai";
import {
  activeDocumentIdAtom, archiveExtrasAtom, documentsAtom, documentTabsAtom, doodadsRevisionAtom, isomRevisionAtom, loadDocumentAtom, locationsRevisionAtom,
  settingsRevisionAtom, terrainRevisionAtom, triggersRevisionAtom, undoStackAtom, unitsRevisionAtom,
} from "../atoms/documentAtoms";
import { mapModifiedAtom, saveOptionsAtom, screenAtom } from "../atoms/editorAtoms";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { openDialogAtom, pushToastAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { leftoverCopies, planRecovery, recoveryKey } from "../editor/recovery";
import { PREFERENCE_LIMITS } from "../editor/preferences";
import { baseName, logError, logInfo, logWarn } from "../editor/log";
import { parseScenario } from "../formats/chk/scenario";
import {
  copyOf, entryOf, holdSessionLock, listCopies, liveSessions, loadCopy, MAX_COPY_BYTES, putCopy, removeCopy, SESSION, type RecoveryEntry,
} from "../services/recovery";
import { openTarget } from "./useMapFileActions";
import { whenDialogsClear } from "./usePreload";
import { t } from "../i18n";

type Store = ReturnType<typeof useStore>;

/** Everything a change to the map in front moves; any of them marks it as changed since its copy. */
const EDIT_SIGNALS: Atom<unknown>[] = [
  terrainRevisionAtom, unitsRevisionAtom, doodadsRevisionAtom, locationsRevisionAtom, isomRevisionAtom, settingsRevisionAtom, triggersRevisionAtom,
  undoStackAtom, archiveExtrasAtom, mapModifiedAtom,
];

/** The copier for one store: which maps changed, which have a copy, and one write at a time. */
export class RecoveryCopier {
  private changed = new Set<number>();
  private written = new Set<number>();
  private tooBig = new Set<number>();
  private queue: Promise<void> = Promise.resolve();

  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  markFront() {
    const id = this.store.get(activeDocumentIdAtom);
    if (id !== null) this.changed.add(id);
  }

  /** Write what is due and drop what is not wanted; `onlyRemove` for the quick pass after a save or close. */
  flush(onlyRemove = false): Promise<void> {
    this.queue = this.queue.then(() => this.run(onlyRemove)).catch((err) => logError("recovery", "The recovery copy pass failed", err));
    return this.queue;
  }

  /** Drop every copy this session made (the desktop's Quit, once every map was asked about). */
  forgetAll(): Promise<void> {
    this.queue = this.queue.then(async () => {
      for (const id of this.written) await removeCopy(recoveryKey(SESSION, id));
      this.written.clear();
    });
    return this.queue;
  }

  private async run(onlyRemove: boolean) {
    const { store } = this;
    const enabled = store.get(preferencesAtom).recovery.enabled;
    const docs = store.get(documentsAtom);
    const frontModified = store.get(mapModifiedAtom);
    const open = docs.map((d) => ({ id: d.id, modified: d.parked ? d.parked.modified : frontModified, changed: this.changed.has(d.id) }));
    const plan = planRecovery(open, this.written, enabled);

    for (const id of plan.remove) {
      this.written.delete(id);
      this.changed.delete(id);
      await removeCopy(recoveryKey(SESSION, id));
    }
    if (onlyRemove) return;

    // Every copy is made before the first write waits, so each is the map as it is now.
    const tabs = new Map(store.get(documentTabsAtom).map((i) => [i.id, i]));
    const copies = plan.write.flatMap((id) => {
      const info = tabs.get(id);
      const slot = docs.find((d) => d.id === id);
      const copy = info && slot ? copyOf(store.get, info, slot.parked) : null;
      this.changed.delete(id);
      if (copy && copy.size > MAX_COPY_BYTES) {
        if (!this.tooBig.has(id)) logWarn("recovery", "Map too large for a recovery copy", { file: baseName(copy.fileName), bytes: copy.size });
        this.tooBig.add(id);
        return [];
      }
      return copy ? [copy] : [];
    });
    for (const copy of copies) {
      try {
        await putCopy(copy);
        this.written.add(copy.docId);
      } catch (err) {
        logError("recovery", "Could not write a recovery copy", err, { file: baseName(copy.fileName), bytes: copy.size });
      }
    }
  }
}

let copier: RecoveryCopier | null = null;

/**
 * Keep a recovery copy of every map with unsaved changes (`Preferences.recovery`): every
 * few minutes, and when the page is hidden (another tab, the window minimised, the laptop
 * lid), each map changed since its last copy is written to IndexedDB. A copy goes as soon
 * as its map is saved or closed, and when copies are switched off. What a session leaves
 * behind is offered back at the next start (`offerRecoveryWhenClear`).
 */
export function useRecovery() {
  const store = useStore();
  const { enabled, minutes } = useAtomValue(preferencesAtom).recovery;

  useEffect(() => {
    holdSessionLock();
    const c = new RecoveryCopier(store);
    copier = c;
    const unsubs = EDIT_SIGNALS.map((a) => store.sub(a, () => c.markFront()));
    // A save or a close drops its copy straight away, not at the next tick.
    let pending = false;
    const soon = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; void c.flush(true); }, 0);
    };
    unsubs.push(store.sub(documentsAtom, soon), store.sub(mapModifiedAtom, soon));
    const hidden = () => { if (document.visibilityState === "hidden") void c.flush(); };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      for (const u of unsubs) u();
      document.removeEventListener("visibilitychange", hidden);
      if (copier === c) copier = null;
    };
  }, [store]);

  useEffect(() => {
    // Switched off: this session's copies go now.
    if (!enabled) { void copier?.flush(true); return; }
    const every = Math.min(PREFERENCE_LIMITS.recoveryMinutes.max, Math.max(PREFERENCE_LIMITS.recoveryMinutes.min, minutes)) * 60_000;
    const timer = setInterval(() => { void copier?.flush(); }, every);
    return () => clearInterval(timer);
  }, [enabled, minutes]);
}

/** Write the due copies now (a test, or a plugin-free way to force one). */
export function flushRecovery(): Promise<void> {
  return copier?.flush() ?? Promise.resolve();
}

/** Drop this session's copies; see `RecoveryCopier.forgetAll`. */
export function forgetSessionCopies(): Promise<void> {
  return copier?.forgetAll() ?? Promise.resolve();
}

/* ── Coming back ────────────────────────────────────────── */

/** The copies left by sessions that have ended, newest first, without their bytes. */
export async function leftoverEntries(): Promise<RecoveryEntry[]> {
  const [records, live] = await Promise.all([listCopies(), liveSessions()]);
  return leftoverCopies(records, SESSION, live).map(entryOf);
}

/**
 * Open a copy as a map with unsaved changes, in its own tab (or in place of the untouched
 * startup map), under its file name and with its handle when one was kept, so Save writes
 * back where the map came from. The copy is dropped once the map is open — from then on it
 * is this session's to copy. False, with a notice, when the copy is gone or unreadable.
 */
export async function restoreCopy(store: Store, key: string): Promise<boolean> {
  const record = await loadCopy(key);
  if (!record) {
    store.set(pushToastAtom, { kind: "warn", title: t("That recovery copy is gone"), detail: t("It was restored or discarded in another window.") });
    return false;
  }
  let scenario;
  try {
    scenario = parseScenario(record.chk);
  } catch (err) {
    logError("recovery", "Could not read a recovery copy", err, { file: baseName(record.fileName) });
    store.set(pushToastAtom, { kind: "error", title: t("Could not restore {name}", { name: record.name }), detail: err instanceof Error ? err.message : String(err) });
    return false;
  }
  store.set(loadDocumentAtom, {
    scenario, extras: record.extras, stored: record.stored, fileName: record.fileName, handle: record.handle, origin: record.origin, builtBy: record.builtBy,
    reason: "open", into: openTarget(store, "new"),
  });
  store.set(saveOptionsAtom, record.saveOptions);
  store.set(mapModifiedAtom, true);
  store.set(screenAtom, "editor");
  copier?.markFront();
  await removeCopy(record.key);
  void copier?.flush();
  logInfo("recovery", "Restored a recovery copy", { file: baseName(record.fileName), age: Math.round((Date.now() - record.at) / 1000) });
  store.set(statusMessageAtom, t("Restored {name} from its recovery copy — not saved yet.", { name: record.name }));
  return true;
}

/** Throw a copy away. */
export function discardCopy(key: string): Promise<void> {
  return removeCopy(key);
}

/**
 * At start, once the splash is gone and nothing else is asking: open the Recover Maps
 * dialog when an earlier session left copies behind.
 */
export async function offerRecoveryWhenClear(store: Store): Promise<void> {
  const entries = await leftoverEntries();
  if (entries.length === 0) return;
  logInfo("recovery", "Recovery copies found from an earlier session", { count: entries.length });
  whenDialogsClear(store, () => { store.set(openDialogAtom, "recovery", { auto: true }); });
}
