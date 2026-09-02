import { useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  activeLayerAtom, brushSizeAtom, doodadPlacingAtom, locationSnapAtom, selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom,
  spritePlacingAtom, unitPlacingAtom, viewFlagsAtom, zoomAtom,
  type EditorLayer,
} from "../atoms/editorAtoms";
import {
  deleteSelectedDoodadsAtom, deleteSelectedLocationsAtom, deleteSelectedSpritesAtom, deleteSelectedUnitsAtom, nudgeSelectedLocationsAtom, redoAtom, undoAtom,
} from "../atoms/documentAtoms";
import { dialogStackAtom, openDialogAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { cancelMapPickAtom, cancelMapToolAtom, comboOfEvent, pluginHotkeysAtom } from "../atoms/pluginAtoms";
import { ZOOM_LEVELS } from "../components/chrome/MenuBar";
import { useMapFileActions } from "./useMapFileActions";
import { useClipboardTools } from "./useClipboardTools";

const LAYER_KEYS: Record<string, EditorLayer> = { t: "terrain", d: "doodads", u: "units", s: "sprites", l: "locations", f: "fog", c: "clipboard" };
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Global editor hotkeys (UI only). */
export function useHotkeys() {
  const open = useSetAtom(openDialogAtom);
  const setLayer = useSetAtom(activeLayerAtom);
  const setFlags = useSetAtom(viewFlagsAtom);
  const setZoom = useSetAtom(zoomAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const setBrush = useSetAtom(brushSizeAtom);
  const undo = useSetAtom(undoAtom);
  const redo = useSetAtom(redoAtom);
  const deleteUnits = useSetAtom(deleteSelectedUnitsAtom);
  const deleteDoodads = useSetAtom(deleteSelectedDoodadsAtom);
  const deleteSprites = useSetAtom(deleteSelectedSpritesAtom);
  const deleteLocations = useSetAtom(deleteSelectedLocationsAtom);
  const nudgeLocations = useSetAtom(nudgeSelectedLocationsAtom);
  const setSelectedLocations = useSetAtom(selectedLocationsAtom);
  const locationSnap = useAtomValue(locationSnapAtom);
  const setSelectedUnits = useSetAtom(selectedUnitsAtom);
  const setSelectedDoodads = useSetAtom(selectedDoodadsAtom);
  const setSelectedSprites = useSetAtom(selectedSpritesAtom);
  const [placing, setPlacing] = useAtom(unitPlacingAtom);
  const [placingDoodad, setPlacingDoodad] = useAtom(doodadPlacingAtom);
  const [placingSprite, setPlacingSprite] = useAtom(spritePlacingAtom);
  const activeLayer = useAtomValue(activeLayerAtom);
  const dialogs = useAtomValue(dialogStackAtom);
  const { save } = useMapFileActions();
  const clipTools = useClipboardTools();
  const pluginHotkeys = useAtomValue(pluginHotkeysAtom);
  const cancelPick = useSetAtom(cancelMapPickAtom);
  const cancelTool = useSetAtom(cancelMapToolAtom);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // A tick box or radio button keeps focus after a click but has no text to edit, so the hotkeys still apply there.
      const textInput = t?.tagName === "INPUT" && !["checkbox", "radio", "button", "range"].includes((t as HTMLInputElement).type);
      const typing = !!t && (textInput || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === "F1") { e.preventDefault(); open("shortcuts"); return; }
      if (dialogs.length > 0) return;

      // Plugin hotkeys come first, never while typing (a plugin cannot know which fields are safe).
      if (!typing && pluginHotkeys.length > 0) {
        const combo = comboOfEvent(e);
        const hit = pluginHotkeys.find((h) => h.combo === combo);
        if (hit) {
          e.preventDefault();
          try { hit.run(); } catch (err) { console.error(`[plugins] hotkey ${combo} failed`, err); }
          return;
        }
      }

      if (mod && !e.shiftKey) {
        const k = e.key.toLowerCase();
        const map: Record<string, () => void> = {
          n: () => open("newMap"),
          o: () => open("openMap"),
          s: () => { void save(); },
          z: () => { const l = undo(); setStatus(l ? `Undid: ${l}` : "Nothing to undo"); },
          y: () => { const l = redo(); setStatus(l ? `Redid: ${l}` : "Nothing to redo"); },
          x: () => { clipTools.cut(); },
          c: () => { clipTools.copy(); },
          v: () => { clipTools.paste(); },
          g: () => setFlags((f) => ({ ...f, grid: !f.grid })),
          t: () => open("triggerEditor"),
          f: () => open("find"),
          ",": () => open("preferences"),
          "=": () => setZoom((z) => ZOOM_LEVELS.find((v) => v > z) ?? z),
          "+": () => setZoom((z) => ZOOM_LEVELS.find((v) => v > z) ?? z),
          "-": () => setZoom((z) => [...ZOOM_LEVELS].reverse().find((v) => v < z) ?? z),
          "0": () => setZoom(1),
        };
        // Inside a text field the browser keeps its own clipboard and undo.
        if (map[k] && !(typing && ["=", "+", "-", "0", "g", "t", "f", "z", "y", "x", "c", "v"].includes(k))) { e.preventDefault(); map[k](); }
        return;
      }
      if (mod && e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "s") { e.preventDefault(); open("saveAs"); }
        if (k === "z" && !typing) { e.preventDefault(); const l = redo(); setStatus(l ? `Redid: ${l}` : "Nothing to redo"); }
        if (k === "t") { e.preventDefault(); open("textTriggerEditor"); }
        if (k === ")" || k === "0") { e.preventDefault(); setZoom(0.25); }
        return;
      }
      if (e.altKey && e.key === "Enter") { e.preventDefault(); open("mapProperties"); return; }
      if (typing || e.altKey) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (activeLayer === "clipboard") {
          const n = clipTools.deleteRegion();
          if (n > 0) e.preventDefault();
          return;
        }
        if (activeLayer === "doodads") {
          const n = deleteDoodads();
          if (n > 0) { e.preventDefault(); setStatus(`Deleted ${n} doodad${n === 1 ? "" : "s"}`); }
          return;
        }
        if (activeLayer === "sprites") {
          const n = deleteSprites();
          if (n > 0) { e.preventDefault(); setStatus(`Deleted ${n} sprite${n === 1 ? "" : "s"}`); }
          return;
        }
        if (activeLayer === "locations") {
          const n = deleteLocations();
          if (n > 0) { e.preventDefault(); setStatus(`Deleted ${n} location${n === 1 ? "" : "s"}`); }
          return;
        }
        const n = deleteUnits();
        if (n > 0) { e.preventDefault(); setStatus(`Deleted ${n} unit${n === 1 ? "" : "s"}`); }
        return;
      }
      if (e.key === "Escape") {
        // A plugin's pick or tool on the map goes first: Escape cancels it and nothing else.
        if (cancelPick() || cancelTool()) { e.preventDefault(); return; }
        // First Escape leaves placement mode, the next clears the selection.
        if (activeLayer === "clipboard") {
          if (!clipTools.stopPasting()) clipTools.clearSelection();
          return;
        }
        if (activeLayer === "doodads") {
          if (placingDoodad) { setPlacingDoodad(false); setStatus("Stopped placing — click a doodad to select it, or pick one in the palette to place"); }
          else setSelectedDoodads([]);
          return;
        }
        if (activeLayer === "sprites") {
          if (placingSprite) { setPlacingSprite(false); setStatus("Stopped placing — click a sprite to select it, or pick one in the palette to place"); }
          else setSelectedSprites([]);
          return;
        }
        if (activeLayer === "locations") { setSelectedLocations([]); return; }
        if (placing) { setPlacing(false); setStatus("Stopped placing — click a unit to select it, or pick one in the palette to place"); }
        else setSelectedUnits([]);
        return;
      }

      // The arrow keys nudge the selected locations by the snap step (a tile when snapping is off); Shift moves a pixel.
      const arrow = activeLayer === "locations" ? ARROWS[e.key] : undefined;
      if (arrow) {
        const step = e.shiftKey ? 1 : locationSnap || 32;
        const n = nudgeLocations({ dx: arrow[0] * step, dy: arrow[1] * step });
        if (n > 0) { e.preventDefault(); setStatus(`Moved ${n} location${n === 1 ? "" : "s"} by ${step} px`); }
        return;
      }

      const layer = LAYER_KEYS[e.key.toLowerCase()];
      if (layer) setLayer(layer);
      // SCMDraft grows and shrinks the brush with the bracket keys.
      if (e.key === "[") setBrush((b) => Math.max(1, b - 1));
      if (e.key === "]") setBrush((b) => Math.min(7, b + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setLayer, setFlags, setZoom, setStatus, setBrush, undo, redo, save, dialogs.length, deleteUnits, deleteDoodads, deleteSprites, deleteLocations, nudgeLocations, locationSnap, setSelectedUnits, setSelectedDoodads, setSelectedSprites, setSelectedLocations, placing, setPlacing, placingDoodad, setPlacingDoodad, placingSprite, setPlacingSprite, activeLayer, clipTools, pluginHotkeys, cancelPick, cancelTool]);
}
