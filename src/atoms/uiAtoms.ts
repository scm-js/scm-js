import { atom } from "jotai";

/* ── Dialog registry ────────────────────────────────────── */

export type DialogId =
  | "newMap"
  | "openMap"
  | "saveAs"
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
  | "missionBriefing"
  | "symmetry"
  | "gridSettings"
  | "preferences"
  | "shortcuts"
  | "validateMap"
  | "find"
  | "about"
  | "confirmClose"
  | "notImplemented";

export interface DialogEntry {
  id: DialogId;
  key: number;
  /** Free-form payload for dialogs that need context (e.g. which unit). */
  payload?: Record<string, unknown>;
}

let dialogSeq = 0;

export const dialogStackAtom = atom<DialogEntry[]>([]);

/** Push a dialog onto the stack (dialogs may stack, e.g. Player Colors from Player Settings). */
export const openDialogAtom = atom(null, (get, set, id: DialogId, payload?: Record<string, unknown>) => {
  set(dialogStackAtom, [...get(dialogStackAtom), { id, key: ++dialogSeq, payload }]);
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
