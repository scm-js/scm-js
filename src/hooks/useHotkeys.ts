import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { activeLayerAtom, mapModifiedAtom, viewFlagsAtom, zoomAtom, type EditorLayer } from "../atoms/editorAtoms";
import { dialogStackAtom, openDialogAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { ZOOM_LEVELS } from "../components/chrome/MenuBar";

const LAYER_KEYS: Record<string, EditorLayer> = { t: "terrain", d: "doodads", u: "units", s: "sprites", l: "locations", f: "fog", c: "clipboard" };

/** Global editor hotkeys (UI only). */
export function useHotkeys() {
  const open = useSetAtom(openDialogAtom);
  const setLayer = useSetAtom(activeLayerAtom);
  const setFlags = useSetAtom(viewFlagsAtom);
  const setZoom = useSetAtom(zoomAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const setModified = useSetAtom(mapModifiedAtom);
  const dialogs = useAtomValue(dialogStackAtom);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === "F1") { e.preventDefault(); open("shortcuts"); return; }
      if (dialogs.length > 0) return;

      if (mod && !e.shiftKey) {
        const k = e.key.toLowerCase();
        const map: Record<string, () => void> = {
          n: () => open("newMap"),
          o: () => open("openMap"),
          s: () => { setModified(false); setStatus("Saved (stub — nothing written)"); },
          g: () => setFlags((f) => ({ ...f, grid: !f.grid })),
          t: () => open("triggerEditor"),
          f: () => open("find"),
          ",": () => open("preferences"),
          "=": () => setZoom((z) => ZOOM_LEVELS.find((v) => v > z) ?? z),
          "+": () => setZoom((z) => ZOOM_LEVELS.find((v) => v > z) ?? z),
          "-": () => setZoom((z) => [...ZOOM_LEVELS].reverse().find((v) => v < z) ?? z),
          "0": () => setZoom(1),
        };
        if (map[k] && !(typing && ["=", "+", "-", "0", "g", "t", "f"].includes(k))) { e.preventDefault(); map[k](); }
        return;
      }
      if (mod && e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "s") { e.preventDefault(); open("saveAs"); }
        if (k === "t") { e.preventDefault(); open("textTriggerEditor"); }
        if (k === ")" || k === "0") { e.preventDefault(); setZoom(0.25); }
        return;
      }
      if (e.altKey && e.key === "Enter") { e.preventDefault(); open("mapProperties"); return; }
      if (typing || e.altKey) return;

      const layer = LAYER_KEYS[e.key.toLowerCase()];
      if (layer) setLayer(layer);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setLayer, setFlags, setZoom, setStatus, setModified, dialogs.length]);
}
