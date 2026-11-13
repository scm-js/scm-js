import { useCallback, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  activeLayerAtom, clipboardAtom, clipPartsAtom, clipPasteModeAtom, clipPastingAtom, clipSelectionAtom, selectedDoodadsAtom, selectedLocationsAtom,
  selectedSpritesAtom, selectedUnitsAtom,
} from "../atoms/editorAtoms";
import { canEdit, commitEditAtom, scenarioAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { statusMessageAtom } from "../atoms/uiAtoms";
import {
  clipPicture, clipSummary, copyObjects, copyRegion, EMPTY_SELECTION, pasteClip, regionObjects, removeObjects, selectionSize, STRETCHED_CLIP_PARTS, stretchClip,
  type Clip, type ClipParts, type ObjectSelection,
} from "../editor/clipboard";
import { soundAxes, STRETCH_AXES, stretchFromDrag, type StretchAxis, type StretchPlan } from "../editor/stretch";
import type { Rect } from "../editor/terrain";
import { stretchArrow } from "./useDoodadTools";
import type { MapPoint } from "./useTerrainTools";
import { peekTileset } from "../formats/tileset/load";
import { NO_DOODADS } from "../formats/tileset/doodads";
import { t } from "../i18n";

/** What Cut / Copy act on: the rectangle marked on the clipboard layer, or an object layer's selection. */
export type ClipSource = { kind: "region"; rect: Rect } | { kind: "objects"; sel: ObjectSelection };


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

  /** The stretch a drag from a paste's press has asked for so far. */
  const stretch = useRef<{ axis: StretchAxis; steps: number } | null>(null);

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
      setStatus(store.get(scenarioAtom) ? t("Nothing to copy — mark an area on the Cut / Copy / Paste layer, or select objects on their layer") : t("No map open"));
      return false;
    }
    setClip(clip);
    setStatus(t("Copied {clipSummary}", { clipSummary: clipSummary(clip) }));
    return true;
  }, [store, source, take, setClip, setStatus]);

  /** Remove the source's objects as one undo step (terrain and fog stay). Returns how many went. */
  const remove = useCallback((src: ClipSource, kind: "cut" | "delete"): number => {
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
    commit({ label: kind === "cut" ? t("Cut {n, plural, one {# object} other {# objects}}", { n }) : t("Delete {n, plural, one {# object} other {# objects}}", { n }), ...edit });
    return n;
  }, [store, graphics, commit, clearObjectSelections]);

  /** Copy, then take the objects off the map. Terrain and fog are copied but never cut out. */
  const cut = useCallback((): boolean => {
    if (!canEdit(store.get, store.set)) return false;
    const src = source();
    const clip = src && take(src);
    if (!src || !clip) {
      setStatus(store.get(scenarioAtom) ? t("Nothing to cut — mark an area on the Cut / Copy / Paste layer, or select objects on their layer") : t("No map open"));
      return false;
    }
    setClip(clip);
    const n = remove(src, "cut");
    setStatus(t("Cut {what}", { what: clipSummary(clip) }) + (n === 0 ? t(" — copied; terrain and fog stay on the map") : ""));
    return true;
  }, [store, source, take, remove, setClip, setStatus]);

  /** The Delete key on the clipboard layer: the marked area's objects go, nothing is copied. */
  const deleteRegion = useCallback((): number => {
    const rect = store.get(clipSelectionAtom);
    if (!rect || !canEdit(store.get, store.set)) return 0;
    const n = remove({ kind: "region", rect }, "delete");
    setStatus(n > 0 ? t("Deleted {n, plural, one {# object} other {# objects}} in the marked area", { n }) : t("No objects in the marked area (terrain and fog are not deleted)"));
    return n;
  }, [store, remove, setStatus]);

  /** Arm pasting: the clipboard layer shows the clip under the pointer until a click stamps it. */
  const paste = useCallback((): boolean => {
    const clip = store.get(clipboardAtom);
    if (!store.get(scenarioAtom)) { setStatus(t("No map open")); return false; }
    if (!clip) { setStatus(t("Nothing to paste — copy something first")); return false; }
    if (!canEdit(store.get, store.set)) return false;
    if (store.get(activeLayerAtom) !== "clipboard") setLayer("clipboard");
    setPasting(true);
    setStatus(t("Pasting {clipSummary} — click where its top-left corner goes; Esc or right-click to stop", { clipSummary: clipSummary(clip) }));
    return true;
  }, [store, setLayer, setPasting, setStatus]);

  const stopPasting = useCallback((): boolean => {
    if (!store.get(clipPastingAtom)) return false;
    setPasting(false);
    setStatus(t("Stopped pasting — drag on the map to mark an area"));
    return true;
  }, [store, setPasting, setStatus]);

  /**
   * Pull the clip pressed at `from` out towards `p`, the way a doodad stretches: a step
   * for each two tiles of the drag along whichever way the clip's picture has a middle to
   * lay again, or along any of the four with `any`. Returns true when the stretch changed.
   */
  const stretchTo = useCallback((from: MapPoint, p: MapPoint, any = false): boolean => {
    const clip = store.get(clipboardAtom);
    const { tileset } = graphics();
    const picture = clip && clipPicture(clip, store.get(clipPartsAtom));
    if (!clip || !tileset || !picture) {
      if (stretch.current === null) setStatus(t("Only terrain stretches — tick Terrain among the parts to paste"));
      stretch.current = { axis: "se", steps: 0 };
      return false;
    }
    const axes = any ? STRETCH_AXES : soundAxes(tileset, { width: clip.width, height: clip.height, tiles: picture });
    const next = axes.length ? stretchFromDrag(p.px - from.px, p.py - from.py, axes) : { axis: "se" as const, steps: 0 };
    const was = stretch.current;
    if (was && was.axis === next.axis && was.steps === next.steps) return false;
    stretch.current = next;
    if (axes.length === 0) setStatus(t("This piece has no middle that repeats, so it does not stretch — hold Shift to stretch it anyway"));
    else if (next.steps === 0) setStatus(t("Drag {arrows} to stretch the piece — hold Shift for any direction", { arrows: axes.map((a) => `${stretchArrow(a, -1)}${stretchArrow(a, 1)}`).join(" ") }));
    else setStatus(t("Stretching the piece {arrow} by {n, plural, one {# step} other {# steps}} — release to paste its terrain", { arrow: stretchArrow(next.axis, next.steps), n: Math.abs(next.steps) }));
    return true;
  }, [store, graphics, setStatus]);

  const endStretch = useCallback(() => { stretch.current = null; }, []);

  /**
   * What a press at tile (tx, ty) would paste: the clip with its corner there, or, while a
   * drag is pulling it out, its picture stretched, standing where the press put it.
   */
  const ghostAt = useCallback((tx: number, ty: number): { clip: Clip; parts: ClipParts; x: number; y: number; stretched: { axis: StretchAxis; steps: number; plan: StretchPlan } | null } | null => {
    const clip = store.get(clipboardAtom);
    if (!clip) return null;
    const parts = store.get(clipPartsAtom);
    const pull = stretch.current;
    const { tileset } = graphics();
    const long = pull && pull.steps !== 0 && tileset ? stretchClip(tileset, clip, parts, pull.axis, pull.steps) : null;
    if (!long || !pull) return { clip, parts, x: tx, y: ty, stretched: null };
    return { clip: long.clip, parts: STRETCHED_CLIP_PARTS, x: tx + long.offset.x, y: ty + long.offset.y, stretched: { axis: pull.axis, steps: pull.steps, plan: long.plan } };
  }, [store, graphics]);

  /** Stamp the clip with its top-left tile at (tx, ty) as one undo step; the pasted area becomes the marked one. */
  const pasteAt = useCallback((tx: number, ty: number): boolean => {
    const scn = store.get(scenarioAtom);
    const whole = store.get(clipboardAtom);
    if (!scn || !whole || !canEdit(store.get, store.set)) return false;
    const { catalogue, tileset } = graphics();
    // Stretched, it is the picture alone that goes down, as terrain, from wherever the stretch put its corner.
    const ghost = ghostAt(tx, ty);
    if (ghost?.stretched) {
      const { clip: long, x, y, stretched } = ghost;
      const result = pasteClip(scn, long, x, y, { parts: STRETCHED_CLIP_PARTS, mode: store.get(clipPasteModeAtom), catalogue, tileset });
      if (result.counts.tiles === 0) {
        setStatus(t("Nothing pasted") + (result.notes.length ? ` — ${result.notes.join("; ")}` : ""));
        return false;
      }
      clearObjectSelections();
      commit({ label: t("Paste {clipSummary}, stretched", { clipSummary: clipSummary(whole) }), ...result.edit });
      setSelection({ x0: Math.max(0, x), y0: Math.max(0, y), x1: Math.min(scn.width, x + long.width), y1: Math.min(scn.height, y + long.height) });
      const steps = Math.abs(stretched.steps);
      const notes = [...result.notes];
      const spots = Math.round(stretched.plan.islandsPerStep * steps);
      if (spots > 0) notes.push(t("it leaves {n, plural, one {# small spot} other {# small spots}} units cannot walk on, which View ▸ Walkability shows", { n: spots }));
      const base = t("Pasted the terrain stretched {arrow} by {n} ({w}×{h}) at {x}, {y}", { arrow: stretchArrow(stretched.axis, stretched.steps), n: steps, w: long.width, h: long.height, x, y });
      setStatus((notes.length ? `${base} — ${notes.join("; ")}` : base) + t(" · Esc to stop pasting"));
      return true;
    }
    const clip = whole;
    const result = pasteClip(scn, clip, tx, ty, { parts: store.get(clipPartsAtom), mode: store.get(clipPasteModeAtom), catalogue, tileset });
    const c = result.counts;
    const placed = c.tiles + c.doodads + c.units + c.sprites + c.locations + c.fog;
    if (placed === 0 && c.removed === 0) {
      setStatus(t("Nothing pasted") + (result.notes.length ? ` — ${result.notes.join("; ")}` : ""));
      return false;
    }
    clearObjectSelections();
    commit({ label: t("Paste {clipSummary}", { clipSummary: clipSummary(clip) }), ...result.edit });
    setSelection({ x0: Math.max(0, tx), y0: Math.max(0, ty), x1: Math.min(scn.width, tx + clip.width), y1: Math.min(scn.height, ty + clip.height) });
    const bits = [
      c.tiles > 0 ? t("{n, plural, one {# tile} other {# tiles}}", { n: c.tiles }) : null,
      c.doodads > 0 ? t("{n, plural, one {# doodad} other {# doodads}}", { n: c.doodads }) : null,
      c.units > 0 ? t("{n, plural, one {# unit} other {# units}}", { n: c.units }) : null,
      c.sprites > 0 ? t("{n, plural, one {# sprite} other {# sprites}}", { n: c.sprites }) : null,
      c.locations > 0 ? t("{n, plural, one {# location} other {# locations}}", { n: c.locations }) : null,
      c.fog > 0 ? t("fog") : null,
      c.removed > 0 ? t("{n, plural, one {# object} other {# objects}} removed", { n: c.removed }) : null,
    ].filter((b): b is string => b !== null);
    setStatus(t("Pasted {what} at {x}, {y}", { what: bits.join(", "), x: tx, y: ty }) + (result.notes.length ? ` — ${result.notes.join("; ")}` : "") + t(" · Esc to stop pasting"));
    return true;
  }, [store, graphics, ghostAt, commit, clearObjectSelections, setSelection, setStatus]);

  /** Mark the whole map (Edit ▸ Select All on the clipboard layer). */
  const selectAll = useCallback(() => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    setSelection({ x0: 0, y0: 0, x1: scn.width, y1: scn.height });
    setStatus(t("Marked the whole map — {width}×{height} tiles", { width: scn.width, height: scn.height }));
  }, [store, setSelection, setStatus]);

  const clearSelection = useCallback(() => setSelection(null), [setSelection]);

  return useMemo(
    () => ({ source, copy, cut, paste, pasteAt, ghostAt, stretchTo, endStretch, stopPasting, deleteRegion, selectAll, clearSelection }),
    [source, copy, cut, paste, pasteAt, ghostAt, stretchTo, endStretch, stopPasting, deleteRegion, selectAll, clearSelection],
  );
}
