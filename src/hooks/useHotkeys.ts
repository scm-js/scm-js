import { useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  activeLayerAtom, brushSizeAtom, centerViewOnAtom, doodadPlacingAtom, locationSnapAtom, selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom,
  spritePlacingAtom, unitPlacingAtom, viewFlagsAtom, viewportRectAtom, zoomAtom, zoomToFitAtom,
} from "../atoms/editorAtoms";
import {
  deleteSelectedDoodadsAtom, deleteSelectedLocationsAtom, deleteSelectedSpritesAtom, deleteSelectedUnitsAtom, nudgeSelectedLocationsAtom, redoAtom, scenarioAtom, selectAllAtom, undoAtom,
} from "../atoms/documentAtoms";
import { hotkeysAtom } from "../atoms/preferencesAtoms";
import { commandById, comboOf, firesWhileTyping, isModifierKey } from "../editor/commands";
import { dialogStackAtom, openDialogAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { cancelMapPickAtom, cancelMapToolAtom, comboOfEvent, pluginHotkeysAtom } from "../atoms/pluginAtoms";
import { ZOOM_LEVELS } from "../components/chrome/MenuBar";
import { stepDocumentIn, useMapFileActions } from "./useMapFileActions";
import { useClipboardTools } from "./useClipboardTools";
import { t } from "../i18n";

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/**
 * Global editor hotkeys (UI only). The rebindable ones are `editor/commands.ts`, matched
 * through `hotkeysAtom`; Delete, Escape and the arrows depend on the layer and stay inline.
 */
export function useHotkeys() {
  const store = useStore();
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
  const selectAll = useSetAtom(selectAllAtom);
  const zoomToFit = useSetAtom(zoomToFitAtom);

  const hotkeys = useAtomValue(hotkeysAtom);

  useEffect(() => {
    const zoomIn = () => setZoom((z) => ZOOM_LEVELS.find((v) => v > z) ?? z);
    const zoomOut = () => setZoom((z) => [...ZOOM_LEVELS].reverse().find((v) => v < z) ?? z);
    const redoOne = () => { const l = redo(); setStatus(l ? t("Redid: {l}", { l }) : t("Nothing to redo")); };
    // What each command in `editor/commands.ts` does; the keys come from the resolved table.
    const run: Record<string, () => void> = {
      "file.new": () => open("newMap"),
      "file.open": () => open("openMap"),
      "file.save": () => { void save(); },
      "file.saveAs": () => open("saveAs"),
      "file.close": () => open("confirmClose"),
      "file.properties": () => open("mapProperties"),
      "edit.undo": () => { const l = undo(); setStatus(l ? t("Undid: {l}", { l }) : t("Nothing to undo")); },
      "edit.redo": redoOne,
      "edit.cut": () => { clipTools.cut(); },
      "edit.copy": () => { clipTools.copy(); },
      "edit.paste": () => { clipTools.paste(); },
      "edit.selectAll": () => {
        if (!store.get(scenarioAtom)) return;
        if (activeLayer === "clipboard") { clipTools.selectAll(); return; }
        const n = selectAll(activeLayer);
        if (!["doodads", "sprites", "locations", "units"].includes(activeLayer)) setLayer("units");
        // The same words as Edit ▸ Select All.
        setStatus(activeLayer === "doodads" ? t("Selected {n, plural, one {# doodad} other {# doodads}}", { n })
          : activeLayer === "sprites" ? t("Selected {n, plural, one {# sprite} other {# sprites}}", { n })
            : activeLayer === "locations" ? t("Selected {n, plural, one {# location} other {# locations}}", { n })
              : t("Selected {n, plural, one {# unit} other {# units}}", { n }));
      },
      "edit.find": () => open("find"),
      "view.grid": () => setFlags((f) => ({ ...f, grid: !f.grid })),
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomActual": () => setZoom(1),
      "view.zoomFit": () => { zoomToFit(); },
      "layer.terrain": () => setLayer("terrain"),
      "layer.doodads": () => setLayer("doodads"),
      "layer.units": () => setLayer("units"),
      "layer.sprites": () => setLayer("sprites"),
      "layer.locations": () => setLayer("locations"),
      "layer.fog": () => setLayer("fog"),
      "layer.clipboard": () => setLayer("clipboard"),
      // SCMDraft grows and shrinks the brush with the bracket keys.
      "brush.smaller": () => setBrush((b) => Math.max(1, b - 1)),
      "brush.larger": () => setBrush((b) => Math.min(7, b + 1)),
      "tools.triggers": () => open("triggerEditor"),
      "tools.testMap": () => open("testMap", { run: true }),
      "tools.preferences": () => open("preferences"),
      "window.next": () => stepDocumentIn(store, 1),
      "window.previous": () => stepDocumentIn(store, -1),
      "help.shortcuts": () => open("shortcuts"),
    };

    const onKey = (e: KeyboardEvent) => {
      // Mid-composition keystrokes (Hangul, kana, pinyin): the IME owns them, and the
      // key it reports is not the character being typed.
      if (e.isComposing || e.keyCode === 229) return;
      if (isModifierKey(e.key)) return;
      const target = e.target as HTMLElement | null;
      // A tick box or radio button keeps focus after a click but has no text to edit, so the hotkeys still apply there.
      const textInput = target?.tagName === "INPUT" && !["checkbox", "radio", "button", "range"].includes((target as HTMLInputElement).type);
      const typing = !!target && (textInput || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      const mod = e.ctrlKey || e.metaKey;
      const combo = comboOf(e);
      const id = hotkeys.byCombo.get(combo);
      const command = id ? commandById(id) : undefined;

      if (command?.inDialogs) { e.preventDefault(); run[command.id]?.(); return; }
      if (dialogs.length > 0) return;

      // Plugin hotkeys come first, never while typing (a plugin cannot know which fields are safe).
      if (!typing && pluginHotkeys.length > 0) {
        const pluginCombo = comboOfEvent(e);
        const hit = pluginHotkeys.find((h) => h.combo === pluginCombo);
        if (hit) {
          e.preventDefault();
          try { hit.run(); } catch (err) { console.error(`[plugins] hotkey ${pluginCombo} failed`, err); }
          return;
        }
      }

      if (command) {
        // Inside a text field the browser keeps its own clipboard, selection, undo — and the text.
        if (typing && !firesWhileTyping(command, combo)) return;
        e.preventDefault();
        run[command.id]?.();
        return;
      }
      if (typing || mod || e.altKey) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (activeLayer === "clipboard") {
          const n = clipTools.deleteRegion();
          if (n > 0) e.preventDefault();
          return;
        }
        if (activeLayer === "doodads") {
          const n = deleteDoodads();
          if (n > 0) { e.preventDefault(); setStatus(t("Deleted {n, plural, one {# doodad} other {# doodads}}", { n })); }
          return;
        }
        if (activeLayer === "sprites") {
          const n = deleteSprites();
          if (n > 0) { e.preventDefault(); setStatus(t("Deleted {n, plural, one {# sprite} other {# sprites}}", { n })); }
          return;
        }
        if (activeLayer === "locations") {
          const n = deleteLocations();
          if (n > 0) { e.preventDefault(); setStatus(t("Deleted {n, plural, one {# location} other {# locations}}", { n })); }
          return;
        }
        const n = deleteUnits();
        if (n > 0) { e.preventDefault(); setStatus(t("Deleted {n, plural, one {# unit} other {# units}}", { n })); }
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
          if (placingDoodad) { setPlacingDoodad(false); setStatus(t("Stopped placing — click a doodad to select it, or pick one in the palette to place")); }
          else setSelectedDoodads([]);
          return;
        }
        if (activeLayer === "sprites") {
          if (placingSprite) { setPlacingSprite(false); setStatus(t("Stopped placing — click a sprite to select it, or pick one in the palette to place")); }
          else setSelectedSprites([]);
          return;
        }
        if (activeLayer === "locations") { setSelectedLocations([]); return; }
        if (placing) { setPlacing(false); setStatus(t("Stopped placing — click a unit to select it, or pick one in the palette to place")); }
        else setSelectedUnits([]);
        return;
      }

      const arrow = ARROWS[e.key];
      if (arrow) {
        e.preventDefault();
        // On the Locations layer with something selected the arrows nudge it by the snap
        // step (a tile when snapping is off), Shift by a pixel. Otherwise they scroll the
        // view — two tiles, or half a screen with Shift.
        if (activeLayer === "locations" && store.get(selectedLocationsAtom).length > 0) {
          const step = e.shiftKey ? 1 : locationSnap || 32;
          const n = nudgeLocations({ dx: arrow[0] * step, dy: arrow[1] * step });
          if (n > 0) setStatus(t("Moved {n, plural, one {# location} other {# locations}} by {step} px", { n, step }));
          return;
        }
        const v = store.get(viewportRectAtom);
        const dx = arrow[0] * (e.shiftKey ? Math.max(1, Math.round(v.w / 2)) : 2);
        const dy = arrow[1] * (e.shiftKey ? Math.max(1, Math.round(v.h / 2)) : 2);
        store.set(centerViewOnAtom, { x: v.x + v.w / 2 + dx, y: v.y + v.h / 2 + dy });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, open, setLayer, setFlags, setZoom, setStatus, setBrush, undo, redo, save, dialogs.length, deleteUnits, deleteDoodads, deleteSprites, deleteLocations, nudgeLocations, locationSnap, setSelectedUnits, setSelectedDoodads, setSelectedSprites, setSelectedLocations, placing, setPlacing, placingDoodad, setPlacingDoodad, placingSprite, setPlacingSprite, activeLayer, clipTools, pluginHotkeys, cancelPick, cancelTool, selectAll, zoomToFit, hotkeys]);
}
