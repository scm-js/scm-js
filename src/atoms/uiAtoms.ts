import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { browserStorage } from "./storage";
import type { DialogId } from "../components/dialogs/ids";
import type { Toast } from "../editor/view";

export type { DialogId, Toast };

/* ── Dialog registry ────────────────────────────────────── */


export interface DialogEntry {
  id: DialogId;
  key: number;
  /** Free-form payload for dialogs that need context (e.g. which unit). */
  payload?: Record<string, unknown>;
}

let dialogSeq = 0;

export const dialogStackAtom = atom<DialogEntry[]>([]);

/** Push a dialog onto the stack (dialogs may stack, e.g. Player Colors from Player Settings). Returns its key. */
export const openDialogAtom = atom(null, (get, set, id: DialogId, payload?: Record<string, unknown>): number => {
  const key = ++dialogSeq;
  set(dialogStackAtom, [...get(dialogStackAtom), { id, key, payload }]);
  return key;
});

/** Close the top-most dialog, or a specific one by key. */
export const closeDialogAtom = atom(null, (get, set, key?: number) => {
  const stack = get(dialogStackAtom);
  if (key === undefined) set(dialogStackAtom, stack.slice(0, -1));
  else set(dialogStackAtom, stack.filter((d) => d.key !== key));
});

/* ── Panels / docks ─────────────────────────────────────── */

export interface PanelVisibility {
  palette: boolean;
  minimap: boolean;
  properties: boolean;
  layers: boolean;
  toolbar: boolean;
  statusbar: boolean;
}

const DEFAULT_PANELS: PanelVisibility = {
  palette: true,
  minimap: true,
  properties: true,
  layers: true,
  toolbar: true,
  statusbar: true,
};

/** View ▸ Panels, remembered (`scmjs.panels`); a panel added later starts shown. */
export const panelsAtom = atomWithStorage<PanelVisibility>("scmjs.panels", DEFAULT_PANELS, {
  ...createJSONStorage<PanelVisibility>(browserStorage),
  getItem: (key, initial) => { const v = createJSONStorage<PanelVisibility>(browserStorage).getItem(key, initial); return v && typeof v === "object" ? { ...DEFAULT_PANELS, ...v } : initial; },
}, { getOnInit: true });

/** The side docks' widths in pixels, remembered together (`scmjs.docks`). */
export const dockWidthsAtom = atomWithStorage<{ left: number; right: number }>("scmjs.docks", { left: 272, right: 248 }, createJSONStorage(browserStorage), { getOnInit: true });
export const leftDockWidthAtom = atom((get) => get(dockWidthsAtom).left, (get, set, width: number) => set(dockWidthsAtom, { ...get(dockWidthsAtom), left: width }));
export const rightDockWidthAtom = atom((get) => get(dockWidthsAtom).right, (get, set, width: number) => set(dockWidthsAtom, { ...get(dockWidthsAtom), right: width }));

/** Transient status-bar message ("Ready", "Saved", …). */
export const statusMessageAtom = atom<string>("Ready");

/* ── Toasts ─────────────────────────────────────────────── */

export const toastsAtom = atom<Toast[]>([]);

let nextToast = 1;
export const pushToastAtom = atom(null, (get, set, toast: Omit<Toast, "id" | "ttl"> & { ttl?: number }): number => {
  const id = nextToast++;
  const ttl = toast.ttl ?? (toast.kind === "error" ? 12000 : 6000);
  set(toastsAtom, [...get(toastsAtom).slice(-3), { ...toast, id, ttl }]);
  return id;
});

export const dismissToastAtom = atom(null, (get, set, id: number) => {
  set(toastsAtom, get(toastsAtom).filter((t) => t.id !== id));
});

