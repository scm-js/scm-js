import { atom } from "jotai";

/* ── Dialog registry ────────────────────────────────────── */

export type DialogId =
  | "newMap"
  | "openMap"
  | "saveAs"
  | "exportImage"
  | "mapProperties"
  | "resizeMap"
  | "mapRevision"
  | "playerSettings"
  | "forceSettings"
  | "playerColors"
  | "unitSettings"
  | "upgradeSettings"
  | "techSettings"
  | "stringEditor"
  | "soundEditor"
  | "switches"
  | "locationList"
  | "unitProperties"
  | "locationProperties"
  | "spriteProperties"
  | "triggerEditor"
  | "textTriggerEditor"
  | "scriptEditor"
  | "missionBriefing"
  | "symmetry"
  | "gridSettings"
  | "preferences"
  | "shortcuts"
  | "validateMap"
  | "statistics"
  | "importTriggers"
  | "exportTriggers"
  | "importStrings"
  | "exportStrings"
  | "find"
  | "about"
  | "confirmClose"
  | "notImplemented"
  | "plugins"
  | "confirmPlugin"
  | "pluginDialog"
  | "gameData";

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

export const panelsAtom = atom<PanelVisibility>({
  palette: true,
  minimap: true,
  properties: true,
  layers: true,
  toolbar: true,
  statusbar: true,
});

export const leftDockWidthAtom = atom<number>(272);
export const rightDockWidthAtom = atom<number>(248);

/** Transient status-bar message ("Ready", "Saved", …). */
export const statusMessageAtom = atom<string>("Ready");

/* ── Toasts ─────────────────────────────────────────────── */

/**
 * A short notice over the map that leaves by itself — what a save says when it is done,
 * since the status bar line is easy to miss and the menubar dot only stops glowing.
 */
export interface Toast {
  id: number;
  kind: "ok" | "info" | "warn" | "error";
  title: string;
  detail?: string;
  /** Milliseconds before it leaves on its own; 0 keeps it until dismissed. */
  ttl: number;
}

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

