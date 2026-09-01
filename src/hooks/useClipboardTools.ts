import { useCallback, useMemo } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  activeLayerAtom, clipboardAtom, clipPartsAtom, clipPasteModeAtom, clipPastingAtom, clipSelectionAtom, selectedDoodadsAtom, selectedLocationsAtom,
  selectedSpritesAtom, selectedUnitsAtom,
} from "../atoms/editorAtoms";
import { commitEditAtom, scenarioAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { statusMessageAtom } from "../atoms/uiAtoms";
import {
  clipSummary, copyObjects, copyRegion, EMPTY_SELECTION, pasteClip, regionObjects, removeObjects, selectionSize, type Clip, type ObjectSelection,
} from "../editor/clipboard";
import type { Rect } from "../editor/terrain";
import { peekTileset } from "../formats/tileset/load";
import { NO_DOODADS } from "../formats/tileset/doodads";

/** What Cut / Copy act on: the rectangle marked on the clipboard layer, or an object layer's selection. */
export type ClipSource = { kind: "region"; rect: Rect } | { kind: "objects"; sel: ObjectSelection };

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Cut / Copy / Paste, bound to the editor's live state so the menu, toolbar, hotkeys and
 * the viewport share one implementation. Copy and Cut take the clipboard layer's marked
 * rectangle (everything in it, per the palette's *Include* ticks) or, on an object
 * layer, the selection; Paste arms the clipboard layer, where the clip follows the
 * pointer until a click stamps it (`pasteAt`). Every edit is one undo step.
 */
export function useClipboardTools() {
  const store = useStore();
  const commit = useSetAtom(commitEditAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const setClip = useSetAtom(clipboardAtom);
  const setSelection = useSetAtom(clipSelectionAtom);
  const setPasting = useSetAtom(clipPastingAtom);
  const setLayer = useSetAtom(activeLayerAtom);
  const tilesetName = useAtomValue(tilesetFileNameAtom);

  const graphics = useCallback(() => {
    const loaded = peekTileset(tilesetName);
    return { catalogue: loaded?.doodads ?? NO_DOODADS, tileset: loaded?.tileset ?? null };
  }, [tilesetName]);

  const clearObjectSelections = useCallback(() => {
    store.set(selectedUnitsAtom, []);
    store.set(selectedDoodadsAtom, []);
    store.set(selectedSpritesAtom, []);
    store.set(selectedLocationsAtom, []);
  }, [store]);

  /** The rectangle or selection a Cut / Copy would take right now, or null when there is nothing. */
  const source = useCallback((): ClipSource | null => {
    if (!store.get(scenarioAtom)) return null;
    const layer = store.get(activeLayerAtom);
    const objects = (sel: Partial<ObjectSelection>): ClipSource | null => {
      const full = { ...EMPTY_SELECTION, ...sel };
      return selectionSize(full) > 0 ? { kind: "objects", sel: full } : null;
    };
    if (layer === "units") return objects({ units: store.get(selectedUnitsAtom) });
    if (layer === "sprites") return objects({ sprites: store.get(selectedSpritesAtom) });
    if (layer === "doodads") return objects({ doodads: store.get(selectedDoodadsAtom) });
    if (layer === "locations") return objects({ locations: store.get(selectedLocationsAtom) });
    const rect = store.get(clipSelectionAtom);
    return rect ? { kind: "region", rect } : null;
  }, [store]);

  const take = useCallback((src: ClipSource): Clip | null => {
    const scn = store.get(scenarioAtom);
    if (!scn) return null;
    const { catalogue } = graphics();
    const parts = store.get(clipPartsAtom);
    return src.kind === "region" ? copyRegion(scn, src.rect, parts, catalogue) : copyObjects(scn, src.sel, parts, catalogue);
  }, [store, graphics]);

  /** Copy the source to the clipboard; false (with a status message) when there is nothing to copy. */
  const copy = useCallback((): boolean => {
    const src = source();
    const clip = src && take(src);
    if (!clip) {
      setStatus(store.get(scenarioAtom) ? "Nothing to copy — mark an area on the Cut / Copy / Paste layer, or select objects on their layer" : "No map open");
      return false;
    }
    setClip(clip);
    setStatus(`Copied ${clipSummary(clip)}`);
    return true;
  }, [store, source, take, setClip, setStatus]);

  /** Remove the source's objects as one undo step (terrain and fog stay). Returns how many went. */
  const remove = useCallback((src: ClipSource, label: string): number => {
    const scn = store.get(scenarioAtom);
    if (!scn) return 0;
    const { catalogue, tileset } = graphics();
    const parts = store.get(clipPartsAtom);
    const all = src.kind === "region" ? regionObjects(scn, src.rect, catalogue) : src.sel;
    const sel: ObjectSelection = {
      units: parts.units ? all.units : [], sprites: parts.sprites ? all.sprites : [], doodads: parts.doodads ? all.doodads : [], locations: parts.locations ? all.locations : [],
    };
    const n = selectionSize(sel);
    if (n === 0) return 0;
    const edit = removeObjects(scn, sel, catalogue, tileset);
    clearObjectSelections();
    commit({ label: `${label} ${plural(n, "object")}`, ...edit });
    return n;
  }, [store, graphics, commit, clearObjectSelections]);

  /** Copy, then take the objects off the map. Terrain and fog are copied but never cut out. */
  const cut = useCallback((): boolean => {
    const src = source();
    const clip = src && take(src);
    if (!src || !clip) {
      setStatus(store.get(scenarioAtom) ? "Nothing to cut — mark an area on the Cut / Copy / Paste layer, or select objects on their layer" : "No map open");
      return false;
    }
    setClip(clip);
    const n = remove(src, "Cut");
    setStatus(`Cut ${clipSummary(clip)}${n === 0 ? " — copied; terrain and fog stay on the map" : ""}`);
    return true;
  }, [store, source, take, remove, setClip, setStatus]);

  /** The Delete key on the clipboard layer: the marked area's objects go, nothing is copied. */
  const deleteRegion = useCallback((): number => {
    const rect = store.get(clipSelectionAtom);
    if (!rect) return 0;
    const n = remove({ kind: "region", rect }, "Delete");
    setStatus(n > 0 ? `Deleted ${plural(n, "object")} in the marked area` : "No objects in the marked area (terrain and fog are not deleted)");
    return n;
  }, [store, remove, setStatus]);

  /** Arm pasting: the clipboard layer shows the clip under the pointer until a click stamps it. */
  const paste = useCallback((): boolean => {
    const clip = store.get(clipboardAtom);
    if (!store.get(scenarioAtom)) { setStatus("No map open"); return false; }
    if (!clip) { setStatus("Nothing to paste — copy something first"); return false; }
    if (store.get(activeLayerAtom) !== "clipboard") setLayer("clipboard");
    setPasting(true);
    setStatus(`Pasting ${clipSummary(clip)} — click where its top-left corner goes; Esc or right-click to stop`);
    return true;
  }, [store, setLayer, setPasting, setStatus]);

  const stopPasting = useCallback((): boolean => {
    if (!store.get(clipPastingAtom)) return false;
    setPasting(false);
    setStatus("Stopped pasting — drag on the map to mark an area");
    return true;
  }, [store, setPasting, setStatus]);

  /** Stamp the clip with its top-left tile at (tx, ty) as one undo step; the pasted area becomes the marked one. */
  const pasteAt = useCallback((tx: number, ty: number): boolean => {
    const scn = store.get(scenarioAtom);
    const clip = store.get(clipboardAtom);
    if (!scn || !clip) return false;
    const { catalogue, tileset } = graphics();
    const result = pasteClip(scn, clip, tx, ty, { parts: store.get(clipPartsAtom), mode: store.get(clipPasteModeAtom), catalogue, tileset });
    const c = result.counts;
    const placed = c.tiles + c.doodads + c.units + c.sprites + c.locations + c.fog;
    if (placed === 0 && c.removed === 0) {
      setStatus(`Nothing pasted${result.notes.length ? ` — ${result.notes.join("; ")}` : ""}`);
      return false;
    }
    clearObjectSelections();
    commit({ label: `Paste ${clipSummary(clip)}`, ...result.edit });
    setSelection({ x0: Math.max(0, tx), y0: Math.max(0, ty), x1: Math.min(scn.width, tx + clip.width), y1: Math.min(scn.height, ty + clip.height) });
    const bits = [
      c.tiles > 0 ? plural(c.tiles, "tile") : null, c.doodads > 0 ? plural(c.doodads, "doodad") : null, c.units > 0 ? plural(c.units, "unit") : null,
      c.sprites > 0 ? plural(c.sprites, "sprite") : null, c.locations > 0 ? plural(c.locations, "location") : null, c.fog > 0 ? "fog" : null,
      c.removed > 0 ? `${plural(c.removed, "object")} removed` : null,
    ].filter((b): b is string => b !== null);
    setStatus(`Pasted ${bits.join(", ")} at ${tx}, ${ty}${result.notes.length ? ` — ${result.notes.join("; ")}` : ""} · Esc to stop pasting`);
    return true;
  }, [store, graphics, commit, clearObjectSelections, setSelection, setStatus]);

  /** Mark the whole map (Edit ▸ Select All on the clipboard layer). */
  const selectAll = useCallback(() => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    setSelection({ x0: 0, y0: 0, x1: scn.width, y1: scn.height });
    setStatus(`Marked the whole map — ${scn.width}×${scn.height} tiles`);
  }, [store, setSelection, setStatus]);

  const clearSelection = useCallback(() => setSelection(null), [setSelection]);

  return useMemo(
    () => ({ source, copy, cut, paste, pasteAt, stopPasting, deleteRegion, selectAll, clearSelection }),
    [source, copy, cut, paste, pasteAt, stopPasting, deleteRegion, selectAll, clearSelection],
  );
}
