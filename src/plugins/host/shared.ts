/**
 * What every part of the plugin host shares: the store, the bag a plugin's contributions land in, and the
 * checks every write and every transaction makes.
 */
import type { createStore } from "jotai";
import { viewOnlyAtom, viewOnlyMessage } from "../../atoms/documentAtoms";
import { logError, logWarn } from "../../editor/log";
import type { EditResult } from "../api";

export type Store = ReturnType<typeof createStore>;

/** Everything one plugin registered, so deactivation can take it all back. */
export class Contributions {
  /** A child bag made by `api.scope()`, so the messages say its scope ended rather than the plugin. */
  readonly scoped: boolean;
  constructor(scoped = false) { this.scoped = scoped; }
  readonly disposables: (() => void)[] = [];
  readonly counts = { menu: 0, contextMenu: 0, hotkeys: 0, events: 0, preferences: 0 };
  /**
   * Set by `dispose` and never cleared: the bag is the plugin's activation, and the only
   * thing that can reach it afterwards is a callback the plugin left behind — a timer, a
   * fetch — whose contributions and edits would otherwise land with nothing to sweep them.
   */
  disposed = false;

  add(dispose: () => void, kind?: keyof Contributions["counts"]) {
    if (this.disposed) {
      // Registered from work that outlived the plugin: take it straight back.
      logWarn("plugins", `A contribution was added after ${this.scoped ? "its scope was disposed" : "the plugin was deactivated"} and has been taken back`);
      try { dispose(); } catch (err) { logError("plugins", "Disposing a contribution failed", err); }
      return { dispose: () => {} };
    }
    this.disposables.push(dispose);
    if (kind) this.counts[kind]++;
    return { dispose: () => { dispose(); const i = this.disposables.indexOf(dispose); if (i >= 0) this.disposables.splice(i, 1); } };
  }

  dispose() {
    this.disposed = true;
    for (const d of this.disposables.splice(0)) {
      try { d(); } catch (err) { logError("plugins", "Disposing a contribution failed", err); }
    }
  }
}

export const EMPTY_RESULT: EditResult = { changed: false, tiles: 0, isom: 0, units: 0, sprites: 0, doodads: 0, locations: 0, fog: 0, notes: [] };

/**
 * A builder that hands back a promise is an `async` one, and a transaction cannot span
 * an await: it commits the moment the builder returns, so everything after that first
 * await mutates the scenario outside the entry and undo cannot take it back. TypeScript
 * refuses one (`Sync` in `api.ts`); a plugin written in plain JavaScript finds out here,
 * in its result's notes and in the console, rather than through an undo that half works.
 */
export function checkSyncBuilder(call: string, returned: unknown, notes: string[]): void {
  if (typeof (returned as PromiseLike<unknown> | null | undefined)?.then !== "function") return;
  const text = `${call}'s builder is async — a transaction commits when the builder returns, so anything after its first await is outside the undo entry. Await before the call, not inside it.`;
  notes.push(text);
  logError("plugins", text);
  // The half after the await runs against a closed transaction, whose every call throws; nobody
  // awaits the builder's promise, so its rejection would otherwise surface as unhandled.
  (returned as PromiseLike<unknown>).then(undefined, (err) => logError("plugins", `${call}'s builder failed after its transaction had closed`, err));
}

/**
 * A transaction ends when its builder returns. A handle kept past that — or the rest of an
 * `async` builder after its first await — used to keep writing to the scenario with nothing
 * recording it; now every call on it throws. The transaction's function properties, and the
 * nested groups of functions (`tx.strings`, `tx.triggers`, …), are wrapped; `tx.scenario` and
 * the numbers are left as they are.
 */
export function sealed<T extends object>(call: string, tx: T, isClosed: () => boolean): T {
  const refuse = () => {
    throw new Error(`${call}'s transaction is closed — it ended when its builder returned, so this call has nothing to record it. Do the work inside the builder, and await before the call rather than inside it.`);
  };
  const wrap = (obj: object): object => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "function") out[k] = (...args: unknown[]) => { if (isClosed()) refuse(); return (v as (...a: unknown[]) => unknown)(...args); };
      else if (isFunctionGroup(v)) out[k] = wrap(v);
      else out[k] = v;
    }
    return out;
  };
  return wrap(tx) as T;
}

const isFunctionGroup = (v: unknown): v is object => {
  if (!v || typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype) return false;
  const values = Object.values(v);
  return values.length > 0 && values.every((f) => typeof f === "function");
};

/** `edit` and `update` on a plugin that has been deactivated do nothing and say so. */
export const DEACTIVATED_NOTE = "the plugin is deactivated";

/** Every write to the map in front starts here: a view-only map (`viewOnlyAtom`) throws, in the words the status bar uses. */
export function assertWritable(store: Store): void {
  const v = store.get(viewOnlyAtom);
  if (v) throw new Error(viewOnlyMessage(v));
}
